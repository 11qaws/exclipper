import type { BroadcastContextTranscriptionChunk } from "./broadcastContextSamplingPlan";
import type {
  BroadcastTranscriptWorkerFragment,
  BroadcastTranscriptWorkerRunResult,
} from "./broadcastTranscriptWorkerClient";
import type {
  BroadcastTranscriptChunkGap,
  BroadcastTranscriptChunkGapReason,
  BroadcastTranscriptQuotaOperationNamespace,
} from "./broadcastTranscriptWorkerProtocol";
import { isBroadcastTranscriptChunkId } from "./broadcastTranscriptWorkerProtocol";

export const MAX_BROADCAST_TRANSCRIPT_FRAGMENT_ATTEMPTS = 3;
const QUOTA_ATTEMPT_GENERATION_STRIDE =
  MAX_BROADCAST_TRANSCRIPT_FRAGMENT_ATTEMPTS + 1;
const RETRY_DELAYS_MS = [1_000, 2_000] as const;

export interface BroadcastTranscriptFragmentRecoveryProgress {
  readonly attemptNumber: number;
  readonly maximumAttemptCount: number;
  readonly requestedCount: number;
  readonly recoveredCount: number;
  readonly remainingCount: number;
  readonly waitingBeforeRetryMs: number | null;
}

export interface BroadcastTranscriptFragmentRecoveryResult {
  readonly fragments: readonly BroadcastTranscriptWorkerFragment[];
  /** A successfully decoded fragment with no usable speech is resolved evidence. */
  readonly noAudioGaps: readonly BroadcastTranscriptChunkGap[];
  /** Safe retries that still failed after the bounded automatic recovery waves. */
  readonly unresolvedRetryableGaps: readonly BroadcastTranscriptChunkGap[];
  /** A request that may already have been billed; never blindly resent. */
  readonly outcomeUnknownGaps: readonly BroadcastTranscriptChunkGap[];
  readonly attemptedCount: number;
  readonly concurrencyOutcomes: readonly string[];
}

export interface RecoverBroadcastTranscriptFragmentsOptions {
  readonly chunks: readonly BroadcastContextTranscriptionChunk[];
  readonly manualAttemptGeneration: number;
  readonly signal?: AbortSignal;
  readonly runAttempt: (
    chunks: readonly BroadcastContextTranscriptionChunk[],
    quotaAttemptOrdinal: number,
    attemptIndex: number,
  ) => Promise<BroadcastTranscriptWorkerRunResult>;
  readonly wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  readonly onProgress?: (
    progress: BroadcastTranscriptFragmentRecoveryProgress,
  ) => void;
}

function abortError(): DOMException {
  return new DOMException("Broadcast transcript recovery was aborted.", "AbortError");
}

async function waitWithAbort(
  delayMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (signal?.aborted === true) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    const timeout = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function isAutomaticallyRetryableTranscriptGap(
  reason: BroadcastTranscriptChunkGapReason,
): boolean {
  return (
    reason === "decode-failed" ||
    reason === "transcription-failed" ||
    reason === "rate-limited"
  );
}

/**
 * Creates disjoint coordinator generations for:
 *
 * - automatic fragment repair inside one editor attempt, and
 * - a later editor-triggered retry.
 *
 * Without the stride, automatic retry 1 and manual generation +1 would reuse
 * the same terminal quota operation and receive a 409.
 */
export function transcriptFragmentQuotaAttemptOrdinal(
  manualAttemptGeneration: number,
  attemptIndex: number,
): number {
  if (
    !Number.isSafeInteger(manualAttemptGeneration) ||
    manualAttemptGeneration < 0 ||
    !Number.isSafeInteger(attemptIndex) ||
    attemptIndex < 0 ||
    attemptIndex >= MAX_BROADCAST_TRANSCRIPT_FRAGMENT_ATTEMPTS
  ) {
    throw new RangeError("Transcript fragment attempt identity is invalid.");
  }
  const ordinal =
    manualAttemptGeneration * QUOTA_ATTEMPT_GENERATION_STRIDE + attemptIndex;
  if (!Number.isSafeInteger(ordinal)) {
    throw new RangeError("Transcript fragment attempt identity is too large.");
  }
  return ordinal;
}

/**
 * Returns the first manual generation whose automatic attempt ordinals are
 * strictly newer than every durable fragment attempt.
 *
 * Stored `attemptCount` is one plus the last quota ordinal. Legacy records
 * used a small local count; treating those values with the same formula may
 * skip a generation, but can never reuse a terminal operation.
 */
export function nextTranscriptFragmentManualGeneration(
  storedAttemptCounts: readonly number[],
): number {
  let nextOrdinal = 0;
  for (const attemptCount of storedAttemptCounts) {
    if (
      !Number.isSafeInteger(attemptCount) ||
      attemptCount < 0
    ) {
      throw new RangeError("Stored transcript fragment attempt count is invalid.");
    }
    nextOrdinal = Math.max(nextOrdinal, attemptCount);
  }
  return Math.ceil(nextOrdinal / QUOTA_ATTEMPT_GENERATION_STRIDE);
}

export function transcriptFragmentQuotaOperationId(
  namespace: BroadcastTranscriptQuotaOperationNamespace,
  quotaAttemptOrdinal: number,
  chunkId: string,
): string {
  if (
    !["uniform", "event-boost", "refinement"].includes(namespace) ||
    !Number.isSafeInteger(quotaAttemptOrdinal) ||
    quotaAttemptOrdinal < 0 ||
    !isBroadcastTranscriptChunkId(chunkId)
  ) {
    throw new RangeError("Transcript fragment quota operation identity is invalid.");
  }
  return `transcript-${namespace}-g${quotaAttemptOrdinal}-${chunkId}`;
}

function validateAttemptResult(
  chunks: readonly BroadcastContextTranscriptionChunk[],
  result: BroadcastTranscriptWorkerRunResult,
): void {
  const requestedIds = new Set(chunks.map(({ chunkId }) => chunkId));
  const settledIds = new Set<string>();
  for (const { chunkId } of result.fragments) {
    if (!requestedIds.has(chunkId) || settledIds.has(chunkId)) {
      throw new Error("Transcript fragment recovery received an invalid result.");
    }
    settledIds.add(chunkId);
  }
  for (const { chunkId } of result.gaps) {
    if (!requestedIds.has(chunkId) || settledIds.has(chunkId)) {
      throw new Error("Transcript fragment recovery received an invalid gap.");
    }
    settledIds.add(chunkId);
  }
  if (
    result.requestedCount !== chunks.length ||
    settledIds.size !== chunks.length
  ) {
    throw new Error("Transcript fragment recovery did not settle every request.");
  }
}

/**
 * Preserves every successful fragment and retries only known-safe failures.
 *
 * The caller keeps the transcript phase in `running` for this entire function.
 * Therefore no whole-context request can observe the intermediate gaps as a
 * completed transcript map.
 */
export async function recoverBroadcastTranscriptFragments(
  options: RecoverBroadcastTranscriptFragmentsOptions,
): Promise<BroadcastTranscriptFragmentRecoveryResult> {
  if (options.chunks.length === 0) {
    return {
      fragments: [],
      noAudioGaps: [],
      unresolvedRetryableGaps: [],
      outcomeUnknownGaps: [],
      attemptedCount: 0,
      concurrencyOutcomes: [],
    };
  }
  const originalOrder = new Map(
    options.chunks.map((chunk, index) => [chunk.chunkId, index]),
  );
  if (originalOrder.size !== options.chunks.length) {
    throw new Error("Transcript fragment recovery requires unique chunk IDs.");
  }

  const successful = new Map<string, BroadcastTranscriptWorkerFragment>();
  const noAudio = new Map<string, BroadcastTranscriptChunkGap>();
  const outcomeUnknown = new Map<string, BroadcastTranscriptChunkGap>();
  let pending = [...options.chunks];
  let unresolvedRetryable = new Map<string, BroadcastTranscriptChunkGap>();
  const concurrencyOutcomes: string[] = [];
  let attemptedCount = 0;

  for (
    let attemptIndex = 0;
    attemptIndex < MAX_BROADCAST_TRANSCRIPT_FRAGMENT_ATTEMPTS &&
    pending.length > 0;
    attemptIndex += 1
  ) {
    if (options.signal?.aborted === true) throw abortError();
    attemptedCount = attemptIndex + 1;
    options.onProgress?.({
      attemptNumber: attemptedCount,
      maximumAttemptCount: MAX_BROADCAST_TRANSCRIPT_FRAGMENT_ATTEMPTS,
      requestedCount: pending.length,
      recoveredCount: successful.size,
      remainingCount: pending.length,
      waitingBeforeRetryMs: null,
    });

    const attemptResult = await options.runAttempt(
      pending,
      transcriptFragmentQuotaAttemptOrdinal(
        options.manualAttemptGeneration,
        attemptIndex,
      ),
      attemptIndex,
    );
    validateAttemptResult(pending, attemptResult);
    concurrencyOutcomes.push(attemptResult.concurrencyOutcome);

    for (const fragment of attemptResult.fragments) {
      successful.set(fragment.chunkId, fragment);
      unresolvedRetryable.delete(fragment.chunkId);
    }

    const nextRetryable = new Map<string, BroadcastTranscriptChunkGap>();
    for (const gap of attemptResult.gaps) {
      if (gap.reason === "no-audio") {
        noAudio.set(gap.chunkId, gap);
      } else if (gap.reason === "outcome-unknown") {
        outcomeUnknown.set(gap.chunkId, gap);
      } else if (isAutomaticallyRetryableTranscriptGap(gap.reason)) {
        nextRetryable.set(gap.chunkId, gap);
      }
    }
    unresolvedRetryable = nextRetryable;
    pending = pending.filter(({ chunkId }) => nextRetryable.has(chunkId));

    if (
      pending.length > 0 &&
      attemptIndex + 1 < MAX_BROADCAST_TRANSCRIPT_FRAGMENT_ATTEMPTS
    ) {
      const retryDelayMs =
        RETRY_DELAYS_MS[Math.min(attemptIndex, RETRY_DELAYS_MS.length - 1)] ??
        2_000;
      options.onProgress?.({
        attemptNumber: attemptedCount,
        maximumAttemptCount: MAX_BROADCAST_TRANSCRIPT_FRAGMENT_ATTEMPTS,
        requestedCount: pending.length,
        recoveredCount: successful.size,
        remainingCount: pending.length,
        waitingBeforeRetryMs: retryDelayMs,
      });
      await (options.wait ?? waitWithAbort)(retryDelayMs, options.signal);
    }
  }

  const byOriginalOrder = <T extends { readonly chunkId: string }>(
    values: Iterable<T>,
  ): T[] =>
    [...values].sort(
      (left, right) =>
        (originalOrder.get(left.chunkId) ?? Number.MAX_SAFE_INTEGER) -
        (originalOrder.get(right.chunkId) ?? Number.MAX_SAFE_INTEGER),
    );

  return {
    fragments: byOriginalOrder(successful.values()),
    noAudioGaps: byOriginalOrder(noAudio.values()),
    unresolvedRetryableGaps: byOriginalOrder(unresolvedRetryable.values()),
    outcomeUnknownGaps: byOriginalOrder(outcomeUnknown.values()),
    attemptedCount,
    concurrencyOutcomes,
  };
}
