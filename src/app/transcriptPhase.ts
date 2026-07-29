/**
 * Phase rules for the broadcast transcript pipeline.
 *
 * Transcription used to wait for the fast local scan to finish, serialising a
 * network-bound stage behind a CPU-bound one. The two share no resources, so
 * the uniform-sample portion of the map now starts the moment the run is
 * live, and the event-anchored portion follows once the scan has produced
 * reaction peaks. The checkpoint-resume machinery that already survives a
 * refresh is what carries the hand-off: the second phase subtracts whatever
 * the first phase persisted and transcribes only the remainder.
 */

import {
  createContentFingerprint,
  type ContentDigestAdapter,
} from "../security/contentFingerprint";

export type TranscriptPhase = "uniform" | "event-boost";

export interface TranscriptStartInput {
  /** True once the fast scan committed and candidates exist. */
  readonly analysisComplete: boolean;
  /** Lifecycle status of the analysis run, null before a run exists. */
  readonly analysisRunStatus: string | null;
  /** Current transcript pipeline status. */
  readonly broadcastTranscriptStatus: string;
}

/** Which portion of the sampling plan this pass is allowed to cover. */
export function transcriptPhaseFor(analysisComplete: boolean): TranscriptPhase {
  return analysisComplete ? "event-boost" : "uniform";
}

/**
 * The per-phase identity that stops a phase from re-entering itself while
 * letting the next phase begin. Spend consent is the run itself, so the run id
 * is part of the key: a new run never inherits a previous run's fence.
 */
export function transcriptOperationKey(
  runId: string,
  contentFingerprint: string,
  phase: TranscriptPhase,
  attemptOrdinal = 0,
  sourceIdentityFence?: string,
): string {
  if (!Number.isSafeInteger(attemptOrdinal) || attemptOrdinal < 0) {
    throw new RangeError("Transcript attempt ordinal must be a non-negative integer.");
  }
  if (sourceIdentityFence !== undefined) {
    if (
      sourceIdentityFence.length === 0 ||
      sourceIdentityFence.length > 160 ||
      /[\p{Cc}\p{Cf}]/u.test(sourceIdentityFence)
    ) {
      throw new TypeError("Transcript source identity fence is invalid.");
    }
  }
  // The durable seal describes exact source input, not one retry wave. Retry
  // identity belongs to each quota operation; including it here would make a
  // completed generation impossible to restore after a reload.
  const base = `${runId}:${contentFingerprint}:${phase}`;
  return sourceIdentityFence === undefined
    ? base
    : `${base}:identity-${sourceIdentityFence}`;
}

/**
 * Compacts descriptive source/provider identity material into the bounded
 * fence accepted by `transcriptOperationKey`.
 *
 * Roster, ASR, worker, VAD and route revisions together are already longer
 * than the operation contract for some broadcasts. Truncation would permit
 * collisions, so the complete length-delimited material is hashed instead.
 */
export async function createTranscriptSourceIdentityFence(
  parts: readonly string[],
  adapter: ContentDigestAdapter | null = globalThis.crypto?.subtle ?? null,
): Promise<string> {
  if (
    parts.length === 0 ||
    parts.some(
      (part) =>
        typeof part !== "string" ||
        part.length === 0 ||
        part.length > 2_048 ||
        /[\p{Cc}\p{Cf}]/u.test(part),
    )
  ) {
    throw new TypeError("Transcript source identity material is invalid.");
  }
  return createContentFingerprint(
    ["exclipper.transcript-source-identity-fence.v1", ...parts],
    adapter,
  );
}

export interface TranscriptContextSealInput {
  readonly analysisComplete: boolean;
  readonly broadcastTranscriptStatus: string;
  readonly completedChapterCount: number;
  readonly requiredEventBoostOperationKey: string | null;
  readonly sealedOperationKey: string | null;
}

export type TranscriptContextReadiness =
  | "not-ready"
  | "ready"
  | "visual-evidence-required";

/**
 * Whether a transcript pass may start now.
 *
 * - A running pass is never pre-empted: phases serialise, so no in-flight
 *   billed chunk is ever aborted by a phase change.
 * - The uniform phase needs a live run — pressing start is what consents to
 *   spend, so nothing transcribes at file-select time.
 * - The event-boost phase needs the scan to have completed, because it exists
 *   to densify around reaction peaks that only the scan can provide.
 */
export function canStartTranscriptRun(input: TranscriptStartInput): boolean {
  if (input.broadcastTranscriptStatus === "running") {
    return false;
  }
  if (input.analysisComplete) {
    return true;
  }
  return input.analysisRunStatus === "running";
}

/** Whether an editor-triggered retry still has transcript evidence to recover. */
export function transcriptNeedsExplicitRetry(
  status: string,
  chapterCount: number,
): boolean {
  return (
    status === "failed" ||
    status === "completedWithGaps" ||
    (status !== "completed" && chapterCount === 0)
  );
}

/**
 * A browser that vanished after starting a paid request cannot distinguish
 * "provider never saw it" from "provider completed but the response was
 * lost". Reopening such a durable fence requires explicit editor consent,
 * just like an explicit outcome-unknown response.
 */
export function transcriptGapRequiresExplicitBillingRetry(
  reason: string,
  attemptCount: number,
): boolean {
  return (
    reason === "outcome-unknown" ||
    (reason === "in-flight" && attemptCount > 0)
  );
}

/**
 * The whole-context phase may only observe a durable, final event-boost map.
 *
 * Checking the operation key is what closes the React effect ordering race:
 * on the render where fast scan completes, the old uniform map may still say
 * `completed`, but it is not the required event-boost seal.
 */
export function transcriptIsSealedForContext(
  input: TranscriptContextSealInput,
): boolean {
  return transcriptContextReadiness(input) === "ready";
}

/**
 * Distinguishes an incomplete transcript from a complete transcript whose
 * every source-fenced cell abstained. The latter must not be retranscribed:
 * it requires the separate four-frame visual lane before context can publish.
 */
export function transcriptContextReadiness(
  input: TranscriptContextSealInput,
): TranscriptContextReadiness {
  const exactFinalSeal =
    input.analysisComplete &&
    input.broadcastTranscriptStatus === "completed" &&
    input.requiredEventBoostOperationKey !== null &&
    input.sealedOperationKey === input.requiredEventBoostOperationKey;
  if (!exactFinalSeal) return "not-ready";
  return (
    input.completedChapterCount > 0
      ? "ready"
      : "visual-evidence-required"
  );
}
