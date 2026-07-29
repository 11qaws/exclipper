import type { AnalysisResultStore } from "../storage/analysisResultStore";
import {
  cloneBroadcastContextSessionRecord,
  type BroadcastContextSessionRecord,
} from "../storage/broadcastContextSessionStore";

export type DurableBroadcastTranscriptCheckpointStore = Pick<
  AnalysisResultStore,
  | "insertBroadcastContextSessionIfAbsent"
  | "replaceBroadcastContextSessionIfUnchanged"
  | "getBroadcastContextSession"
>;

export interface DurableBroadcastTranscriptCheckpointPolicy {
  readonly maximumAttempts: number;
  readonly initialBackoffMs: number;
  readonly maximumBackoffMs: number;
}

const DEFAULT_POLICY: DurableBroadcastTranscriptCheckpointPolicy =
  Object.freeze({
    maximumAttempts: 5,
    initialBackoffMs: 100,
    maximumBackoffMs: 1_600,
  });

export interface CommitDurableBroadcastTranscriptCheckpointOptions {
  readonly store: DurableBroadcastTranscriptCheckpointStore;
  readonly expected: BroadcastContextSessionRecord | null;
  readonly replacement: BroadcastContextSessionRecord;
  /**
   * Reapply a cumulative transcript snapshot after exact readback proves that
   * an earlier checkpoint from this same run committed with a lost
   * acknowledgement. Returning null treats the readback as a true conflict.
   */
  readonly rebaseReplacement?: (
    current: BroadcastContextSessionRecord,
    pending: BroadcastContextSessionRecord,
  ) => BroadcastContextSessionRecord | null;
  readonly signal?: AbortSignal;
  readonly policy?: Partial<DurableBroadcastTranscriptCheckpointPolicy>;
}

export class DurableBroadcastTranscriptCheckpointError extends Error {
  public readonly name = "DurableBroadcastTranscriptCheckpointError";
}

function exact(
  left: BroadcastContextSessionRecord | null,
  right: BroadcastContextSessionRecord | null,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function policyFor(
  value: Partial<DurableBroadcastTranscriptCheckpointPolicy> | undefined,
): DurableBroadcastTranscriptCheckpointPolicy {
  const policy = { ...DEFAULT_POLICY, ...value };
  if (
    !Number.isSafeInteger(policy.maximumAttempts) ||
    policy.maximumAttempts < 1 ||
    policy.maximumAttempts > 20 ||
    !Number.isSafeInteger(policy.initialBackoffMs) ||
    policy.initialBackoffMs < 0 ||
    !Number.isSafeInteger(policy.maximumBackoffMs) ||
    policy.maximumBackoffMs < policy.initialBackoffMs ||
    policy.maximumBackoffMs > 60_000
  ) {
    throw new RangeError("Invalid durable transcript checkpoint policy.");
  }
  return policy;
}

function abortError(): DOMException {
  return new DOMException(
    "The durable transcript checkpoint was aborted.",
    "AbortError",
  );
}

function waitForBackoff(
  delayMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (signal?.aborted === true) return Promise.reject(abortError());
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(finish, delayMs);
    const onAbort = (): void => finish(abortError());
    function finish(error?: DOMException): void {
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      if (error === undefined) resolve();
      else reject(error);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Commits one fixed transcript-session snapshot and proves it by exact
 * readback. The replacement is frozen for the whole operation: a lost
 * acknowledgement never creates a new timestamped write, and a genuinely
 * newer durable snapshot is never overwritten.
 */
export async function commitDurableBroadcastTranscriptCheckpoint(
  options: CommitDurableBroadcastTranscriptCheckpointOptions,
): Promise<BroadcastContextSessionRecord> {
  const policy = policyFor(options.policy);
  let expected =
    options.expected === null
      ? null
      : cloneBroadcastContextSessionRecord(options.expected);
  let replacement = cloneBroadcastContextSessionRecord(options.replacement);
  if (
    (expected !== null && expected.runId !== replacement.runId) ||
    (expected !== null &&
      expected.inputSignature !== replacement.inputSignature)
  ) {
    throw new DurableBroadcastTranscriptCheckpointError(
      "Transcript checkpoint snapshots do not share one run fence.",
    );
  }

  let mutationAccepted = false;
  let lastFailure: unknown = null;
  for (let attempt = 0; attempt < policy.maximumAttempts; attempt += 1) {
    if (options.signal?.aborted === true) throw abortError();
    if (!mutationAccepted) {
      try {
        mutationAccepted =
          expected === null
            ? await options.store.insertBroadcastContextSessionIfAbsent(
                replacement,
              )
            : await options.store.replaceBroadcastContextSessionIfUnchanged(
                expected,
                replacement,
              );
      } catch (error) {
        lastFailure = error;
      }
    }

    let readback: BroadcastContextSessionRecord | null = null;
    let readbackSucceeded = true;
    try {
      readback = await options.store.getBroadcastContextSession(
        replacement.runId,
      );
      if (exact(readback, replacement)) {
        return cloneBroadcastContextSessionRecord(replacement);
      }
    } catch (error) {
      lastFailure = error;
      readbackSucceeded = false;
    }

    if (
      readbackSucceeded &&
      !exact(readback, expected) &&
      !exact(readback, replacement)
    ) {
      const rebased =
        mutationAccepted || readback === null
          ? null
          : options.rebaseReplacement?.(readback, replacement) ?? null;
      if (rebased === null) {
        throw new DurableBroadcastTranscriptCheckpointError(
          "A newer durable transcript checkpoint already owns this run.",
        );
      }
      if (
        rebased.runId !== replacement.runId ||
        rebased.inputSignature !== replacement.inputSignature
      ) {
        throw new DurableBroadcastTranscriptCheckpointError(
          "A rebased transcript checkpoint escaped its run fence.",
        );
      }
      expected = cloneBroadcastContextSessionRecord(readback);
      replacement = cloneBroadcastContextSessionRecord(rebased);
      mutationAccepted = false;
    }
    if (
      readbackSucceeded &&
      !mutationAccepted &&
      !exact(readback, expected)
    ) {
      throw new DurableBroadcastTranscriptCheckpointError(
        "The durable transcript checkpoint compare-and-swap conflicted.",
      );
    }
    if (attempt + 1 < policy.maximumAttempts) {
      await waitForBackoff(
        Math.min(
          policy.maximumBackoffMs,
          policy.initialBackoffMs * 2 ** attempt,
        ),
        options.signal,
      );
    }
  }

  throw new DurableBroadcastTranscriptCheckpointError(
    mutationAccepted
      ? "The transcript checkpoint committed but exact readback stayed unavailable."
      : "The transcript checkpoint could not be committed after safe retries.",
    { cause: lastFailure },
  );
}
