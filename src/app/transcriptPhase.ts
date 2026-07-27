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
): string {
  if (!Number.isSafeInteger(attemptOrdinal) || attemptOrdinal < 0) {
    throw new RangeError("Transcript attempt ordinal must be a non-negative integer.");
  }
  return `${runId}:${contentFingerprint}:${phase}:attempt-${attemptOrdinal}`;
}

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
    chapterCount === 0
  );
}
