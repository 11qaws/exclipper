import type { BroadcastContextTranscriptionChunk } from "../analysis/broadcastContextSamplingPlan";
import {
  broadcastRefinementTranscriptCheckpointCanComplete,
  broadcastRefinementTranscriptCheckpointMatchesInput,
  createBroadcastRefinementTranscriptCheckpoint,
  mergeBroadcastRefinementTranscriptCheckpoints,
  parseBroadcastRefinementTranscriptCheckpointJson,
  recordBroadcastRefinementTranscriptAbstention,
  recordBroadcastRefinementTranscriptGap,
  recordBroadcastRefinementTranscriptSuccess,
  serializeBroadcastRefinementTranscriptCheckpoint,
  type BroadcastRefinementTranscriptCheckpoint,
  type BroadcastRefinementTranscriptGap,
} from "../analysis/broadcastRefinementTranscriptCheckpoint";
import {
  nextTranscriptFragmentManualGeneration,
  recoverBroadcastTranscriptFragments,
  transcriptFragmentQuotaOperationId,
  type BroadcastTranscriptFragmentRecoveryProgress,
} from "../analysis/broadcastTranscriptFragmentRecovery";
import type {
  BroadcastTranscriptWorkerFragment,
  BroadcastTranscriptWorkerRunResult,
} from "../analysis/broadcastTranscriptWorkerClient";
import type {
  BroadcastTranscriptChunkAbstention,
  BroadcastTranscriptChunkGapReason,
  BroadcastTranscriptDispatchIntent,
} from "../analysis/broadcastTranscriptWorkerProtocol";
import type { AnalysisResultStore } from "../storage/analysisResultStore";
import {
  checkpointBroadcastContextSessionRefinementTranscript,
  type BroadcastContextSessionRecord,
} from "../storage/broadcastContextSessionStore";
import { transformDurableBroadcastContextSession } from "./durableBroadcastContextSession";

type DurableRefinementTranscriptStore = Pick<
  AnalysisResultStore,
  "getBroadcastContextSession" | "replaceBroadcastContextSessionIfUnchanged"
>;

export interface RunDurableBroadcastRefinementTranscriptPipelineOptions {
  readonly store: DurableRefinementTranscriptStore;
  readonly initialSession: BroadcastContextSessionRecord;
  readonly runId: string;
  readonly refinementTranscriptInputSignature: string;
  readonly chunks: readonly BroadcastContextTranscriptionChunk[];
  /** Identity generation only; this value never grants retry permission. */
  readonly editorRetryGeneration: number;
  /**
   * True for exactly one invocation after an editor explicitly confirms a
   * retry. It is deliberately separate from the operation generation.
   */
  readonly allowOutcomeUnknownRetry: boolean;
  readonly signal?: AbortSignal;
  readonly runAttempt: (
    chunks: readonly BroadcastContextTranscriptionChunk[],
    quotaAttemptOrdinal: number,
    attemptIndex: number,
    persistence: DurableBroadcastRefinementTranscriptAttemptPersistence,
  ) => Promise<BroadcastTranscriptWorkerRunResult>;
  readonly wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  readonly onProgress?: (
    progress: BroadcastTranscriptFragmentRecoveryProgress,
  ) => void;
}

export interface DurableBroadcastRefinementTranscriptAttemptPersistence {
  readonly onDispatchIntent: (
    intent: BroadcastTranscriptDispatchIntent,
  ) => Promise<void>;
  readonly onPartialResult: (
    chunkId: string,
    result: BroadcastTranscriptWorkerFragment["result"],
  ) => Promise<void>;
  readonly onChunkAbstention: (
    abstention: BroadcastTranscriptChunkAbstention,
  ) => Promise<void>;
  readonly onChunkGap: (
    chunkId: string,
    reason: BroadcastTranscriptChunkGapReason,
  ) => Promise<void>;
}

export type DurableBroadcastRefinementTranscriptPipelineStatus =
  | "completed"
  | "blocked-retryable-gap"
  | "blocked-outcome-unknown"
  | "blocked-mixed";

export interface DurableBroadcastRefinementTranscriptPipelineResult {
  readonly status: DurableBroadcastRefinementTranscriptPipelineStatus;
  readonly complete: boolean;
  readonly session: BroadcastContextSessionRecord;
  readonly checkpoint: BroadcastRefinementTranscriptCheckpoint;
  readonly fragments: readonly BroadcastTranscriptWorkerFragment[];
  readonly abstentions: readonly BroadcastTranscriptChunkAbstention[];
  readonly blockingGaps: readonly BroadcastRefinementTranscriptGap[];
  readonly providerAttemptCount: number;
}

export class DurableBroadcastRefinementTranscriptPipelineError extends Error {
  public readonly name = "DurableBroadcastRefinementTranscriptPipelineError";
}

function assertRunnableSession(
  session: BroadcastContextSessionRecord,
  runId: string,
): void {
  if (
    session.runId !== runId ||
    session.contextInputSignature === null ||
    session.contextInputCheckpointJson === null ||
    session.contextPhaseLedgerJson === null ||
    session.contextResultJson === null
  ) {
    throw new DurableBroadcastRefinementTranscriptPipelineError(
      "완료된 방송 전체 맥락 세션이 없어 후보 구간 대사를 복구할 수 없어요.",
    );
  }
}

function abortError(): DOMException {
  return new DOMException(
    "Broadcast refinement transcript pipeline was aborted.",
    "AbortError",
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw abortError();
}

function waitForRecoveryBatch(
  delayMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (signal?.aborted === true) return Promise.reject(abortError());
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

function isOutcomeUnknownGap(
  gap: BroadcastRefinementTranscriptGap,
): boolean {
  return gap.reason === "in-flight" || gap.reason === "outcome-unknown";
}

function isAutomaticallyRetryableRefinementGap(
  gap: BroadcastRefinementTranscriptGap,
): boolean {
  return (
    gap.reason === "decode-failed" ||
    gap.reason === "transcription-failed" ||
    gap.reason === "rate-limited"
  );
}

function blockingStatus(
  gaps: readonly BroadcastRefinementTranscriptGap[],
): Exclude<
  DurableBroadcastRefinementTranscriptPipelineStatus,
  "completed"
> {
  const hasUnknown = gaps.some(isOutcomeUnknownGap);
  const hasRetryable = gaps.some((gap) => !isOutcomeUnknownGap(gap));
  if (hasUnknown && hasRetryable) return "blocked-mixed";
  return hasUnknown
    ? "blocked-outcome-unknown"
    : "blocked-retryable-gap";
}

function chunkMap(
  chunks: readonly BroadcastContextTranscriptionChunk[],
): ReadonlyMap<string, BroadcastContextTranscriptionChunk> {
  const byId = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));
  if (byId.size !== chunks.length) {
    throw new DurableBroadcastRefinementTranscriptPipelineError(
      "후보 대사 복구 계획에 중복된 조각 ID가 있어요.",
    );
  }
  return byId;
}

export async function runDurableBroadcastRefinementTranscriptPipeline(
  options: RunDurableBroadcastRefinementTranscriptPipelineOptions,
): Promise<DurableBroadcastRefinementTranscriptPipelineResult> {
  if (
    !Number.isSafeInteger(options.editorRetryGeneration) ||
    options.editorRetryGeneration < 0
  ) {
    throw new DurableBroadcastRefinementTranscriptPipelineError(
      "후보 대사 재시도 세대가 올바르지 않아요.",
    );
  }
  assertRunnableSession(options.initialSession, options.runId);
  throwIfAborted(options.signal);

  const plannedInput = {
    refinementInputSignature: options.refinementTranscriptInputSignature,
    plannedChunks: options.chunks,
  } as const;
  const plannedById = chunkMap(options.chunks);
  let session = options.initialSession;
  let checkpoint: BroadcastRefinementTranscriptCheckpoint;

  const hasStoredCheckpoint =
    session.refinementTranscriptInputSignature !== null &&
    session.refinementTranscriptCheckpointJson !== null;
  if (
    hasStoredCheckpoint &&
    session.refinementTranscriptInputSignature ===
      options.refinementTranscriptInputSignature
  ) {
    const restored = parseBroadcastRefinementTranscriptCheckpointJson(
      session.refinementTranscriptCheckpointJson as string,
    );
    if (
      restored === null ||
      !broadcastRefinementTranscriptCheckpointMatchesInput(
        restored,
        plannedInput,
      )
    ) {
      throw new DurableBroadcastRefinementTranscriptPipelineError(
        "저장된 후보 대사 체크포인트가 현재 구간 계획과 일치하지 않아요.",
      );
    }
    checkpoint = restored;
  } else if (
    session.refinementTranscriptInputSignature === null &&
    session.refinementTranscriptCheckpointJson === null
  ) {
    checkpoint = createBroadcastRefinementTranscriptCheckpoint(plannedInput);
  } else if (hasStoredCheckpoint) {
    // A changed exact input gets a fresh empty checkpoint. None of the paid
    // transcript evidence from the previous range plan is silently reused.
    checkpoint = createBroadcastRefinementTranscriptCheckpoint(plannedInput);
  } else {
    throw new DurableBroadcastRefinementTranscriptPipelineError(
      "후보 대사 체크포인트의 서명과 데이터가 서로 맞지 않아요.",
    );
  }

  let checkpointPersistenceOrdinal = 0;
  const persistCheckpoint = async (
    next: BroadcastRefinementTranscriptCheckpoint,
  ): Promise<void> => {
    const parentContext = {
      inputSignature: session.contextInputSignature,
      inputCheckpointJson: session.contextInputCheckpointJson,
      phaseLedgerJson: session.contextPhaseLedgerJson,
      resultJson: session.contextResultJson,
    };
    checkpointPersistenceOrdinal += 1;
    const operationToken =
      `refinement-transcript:${options.runId}:` +
      `${options.refinementTranscriptInputSignature}:` +
      `${checkpointPersistenceOrdinal}`;
    const committed = await transformDurableBroadcastContextSession({
      store: options.store,
      identity: {
        runId: options.runId,
        operationToken,
        inputSignature: session.inputSignature,
      },
      expected: session,
      isCurrent: (identity) =>
        options.signal?.aborted !== true &&
        identity.runId === options.runId &&
        identity.operationToken === operationToken &&
        identity.inputSignature === session.inputSignature,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      transform: (current) => {
        if (
          current.contextInputSignature !== parentContext.inputSignature ||
          current.contextInputCheckpointJson !==
            parentContext.inputCheckpointJson ||
          current.contextPhaseLedgerJson !== parentContext.phaseLedgerJson ||
          current.contextResultJson !== parentContext.resultJson
        ) {
          throw new DurableBroadcastRefinementTranscriptPipelineError(
            "The parent context changed while refinement transcript evidence was being checkpointed.",
          );
        }
        let merged = next;
        if (
          current.refinementTranscriptInputSignature ===
            options.refinementTranscriptInputSignature &&
          current.refinementTranscriptCheckpointJson !== null
        ) {
          const durableCheckpoint =
            parseBroadcastRefinementTranscriptCheckpointJson(
              current.refinementTranscriptCheckpointJson,
            );
          if (durableCheckpoint === null) {
            throw new DurableBroadcastRefinementTranscriptPipelineError(
              "The durable refinement transcript checkpoint is invalid.",
            );
          }
          merged = mergeBroadcastRefinementTranscriptCheckpoints(
            durableCheckpoint,
            next,
          );
        } else if (
          current.refinementTranscriptInputSignature ===
            session.refinementTranscriptInputSignature &&
          current.refinementTranscriptCheckpointJson ===
            session.refinementTranscriptCheckpointJson
        ) {
          /*
           * The caller intentionally installed a new exact plan over the
           * checkpoint it loaded. A CAS rebase may repeat that replacement
           * only while the child still equals that loaded snapshot.
           */
          merged = next;
        } else if (
          current.refinementTranscriptInputSignature !== null ||
          current.refinementTranscriptCheckpointJson !== null
        ) {
          throw new DurableBroadcastRefinementTranscriptPipelineError(
            "Another refinement transcript plan already owns this context.",
          );
        }
        const serialized =
          serializeBroadcastRefinementTranscriptCheckpoint(merged);
        return checkpointBroadcastContextSessionRefinementTranscript(current, {
          refinementTranscriptInputSignature:
            options.refinementTranscriptInputSignature,
          refinementTranscriptCheckpointJson: serialized,
          recordedAt: new Date().toISOString(),
        });
      },
    });
    if (committed.status !== "succeeded") {
      throw new DurableBroadcastRefinementTranscriptPipelineError(
        `후보 대사 체크포인트를 저장하는 동안 세션이 갱신됐어요. ${committed.status}`,
      );
    }
    const reopened = committed.value;
    const reopenedCheckpoint =
      reopened.refinementTranscriptCheckpointJson === null
        ? null
        : parseBroadcastRefinementTranscriptCheckpointJson(
            reopened.refinementTranscriptCheckpointJson,
          );
    if (
      reopened.refinementTranscriptInputSignature !==
        options.refinementTranscriptInputSignature ||
      reopenedCheckpoint === null ||
      reopened.contextInputSignature !== session.contextInputSignature ||
      reopened.contextInputCheckpointJson !==
        session.contextInputCheckpointJson ||
      reopened.contextPhaseLedgerJson !== session.contextPhaseLedgerJson ||
      reopened.contextResultJson !== session.contextResultJson
    ) {
      throw new DurableBroadcastRefinementTranscriptPipelineError(
        "저장한 후보 대사 체크포인트를 정확히 다시 확인하지 못했어요.",
      );
    }
    session = reopened;
    checkpoint = reopenedCheckpoint;
  };
  let transitionTail: Promise<void> = Promise.resolve();
  const persistTransition = async (
    transition: (
      current: BroadcastRefinementTranscriptCheckpoint,
    ) => BroadcastRefinementTranscriptCheckpoint,
  ): Promise<void> => {
    const committed = transitionTail.then(async () => {
      throwIfAborted(options.signal);
      await persistCheckpoint(transition(checkpoint));
    });
    transitionTail = committed.catch(() => undefined);
    await committed;
  };

  if (
    session.refinementTranscriptInputSignature !==
      options.refinementTranscriptInputSignature ||
    session.refinementTranscriptCheckpointJson !==
      serializeBroadcastRefinementTranscriptCheckpoint(checkpoint)
  ) {
    await persistCheckpoint(checkpoint);
  }

  // A browser or tab may have stopped after the in-flight seal but before the
  // response checkpoint. That state has an ambiguous billing outcome.
  const recoveredInFlight = checkpoint.gaps.filter(
    ({ reason }) => reason === "in-flight",
  );
  if (recoveredInFlight.length > 0) {
    let sealed = checkpoint;
    for (const gap of recoveredInFlight) {
      sealed = recordBroadcastRefinementTranscriptGap(sealed, {
        ...gap,
        reason: "outcome-unknown",
      });
    }
    await persistCheckpoint(sealed);
  }

  if (broadcastRefinementTranscriptCheckpointCanComplete(checkpoint)) {
    return {
      status: "completed",
      complete: true,
      session,
      checkpoint,
      fragments: checkpoint.successfulFragments,
      abstentions: checkpoint.abstentions,
      blockingGaps: [],
      providerAttemptCount: 0,
    };
  }

  const explicitlyRetryableAmbiguousChunkIds = new Set(
    options.allowOutcomeUnknownRetry
      ? checkpoint.gaps
          .filter(isOutcomeUnknownGap)
          .map(({ chunkId }) => chunkId)
      : [],
  );
  const consumedAmbiguousRetryChunkIds = new Set<string>();
  /*
   * A route-changed settlement is known-safe to retry, but only after the
   * caller has started a fresh invocation and therefore had a chance to
   * refresh provider health and route selection. A route drift produced by
   * this invocation is deliberately left for the next invocation.
   */
  const retryableRouteChangedChunkIds = new Set(
    checkpoint.gaps
      .filter(({ reason }) => reason === "route-changed")
      .map(({ chunkId }) => chunkId),
  );
  const consumedRouteChangedChunkIds = new Set<string>();
  const runnableChunksForCurrentCheckpoint =
    (): readonly BroadcastContextTranscriptionChunk[] => {
      const settledChunkIds = new Set([
        ...checkpoint.successfulFragments.map(({ chunkId }) => chunkId),
        ...checkpoint.abstentions.map(({ chunkId }) => chunkId),
      ]);
      const gapByChunkId = new Map(
        checkpoint.gaps.map((gap) => [gap.chunkId, gap]),
      );
      return checkpoint.plannedChunks.flatMap((planned) => {
        if (settledChunkIds.has(planned.chunkId)) return [];
        const gap = gapByChunkId.get(planned.chunkId);
        const runnable =
          gap === undefined ||
          (gap !== undefined &&
            isAutomaticallyRetryableRefinementGap(gap)) ||
          (gap !== undefined &&
            gap.reason === "route-changed" &&
            retryableRouteChangedChunkIds.has(gap.chunkId) &&
            !consumedRouteChangedChunkIds.has(gap.chunkId)) ||
          (gap !== undefined &&
            isOutcomeUnknownGap(gap) &&
            explicitlyRetryableAmbiguousChunkIds.has(gap.chunkId) &&
            !consumedAmbiguousRetryChunkIds.has(gap.chunkId));
        /*
         * Route drift requires a fresh health/route selection in the caller.
         * Replaying it inside this frozen-route invocation would repeat the
         * same known-safe gap without changing the route.
         */
        if (!runnable) return [];
        const sourceChunk = plannedById.get(planned.chunkId);
        if (sourceChunk === undefined) {
          throw new DurableBroadcastRefinementTranscriptPipelineError(
            "The refinement transcript cell is absent from its frozen plan.",
          );
        }
        return [sourceChunk];
      });
    };

  let providerAttemptCount = 0;
  let recoveryBatchCount = 0;
  while (!broadcastRefinementTranscriptCheckpointCanComplete(checkpoint)) {
    const runnableChunks = runnableChunksForCurrentCheckpoint();
    if (runnableChunks.length === 0) break;
    for (const chunk of runnableChunks) {
      const gap = checkpoint.gaps.find(
        ({ chunkId }) => chunkId === chunk.chunkId,
      );
      if (gap !== undefined && isOutcomeUnknownGap(gap)) {
        consumedAmbiguousRetryChunkIds.add(chunk.chunkId);
      }
      if (gap?.reason === "route-changed") {
        consumedRouteChangedChunkIds.add(chunk.chunkId);
      }
    }
    const automaticGeneration = nextTranscriptFragmentManualGeneration(
      checkpoint.gaps.map(({ attemptCount }) => attemptCount),
    );
    const manualAttemptGeneration = Math.max(
      automaticGeneration,
      options.editorRetryGeneration,
    );
    const recovery = await recoverBroadcastTranscriptFragments({
      chunks: runnableChunks,
      manualAttemptGeneration,
      runAttempt: (requested, quotaAttemptOrdinal, attemptIndex) =>
        options.runAttempt(
          requested,
          quotaAttemptOrdinal,
          attemptIndex,
          {
            onDispatchIntent: async (intent): Promise<void> => {
              const planned = plannedById.get(intent.chunkId);
              const expectedOperationId =
                transcriptFragmentQuotaOperationId(
                  "refinement",
                  quotaAttemptOrdinal,
                  intent.chunkId,
                  intent.operationScope ?? undefined,
                );
              if (
                planned === undefined ||
                intent.sourceStartMs !== planned.sourceStartMs ||
                intent.sourceEndMs !== planned.sourceEndMs ||
                intent.attemptOrdinal !== quotaAttemptOrdinal ||
                intent.operationNamespace !== "refinement" ||
                intent.operationId !== expectedOperationId
              ) {
                throw new DurableBroadcastRefinementTranscriptPipelineError(
                  "Refinement transcript dispatch intent does not match its frozen cell.",
                );
              }
              await persistTransition((current) =>
                recordBroadcastRefinementTranscriptGap(current, {
                  chunkId: intent.chunkId,
                  reason: "in-flight",
                  attemptCount: quotaAttemptOrdinal + 1,
                }),
              );
            },
            onPartialResult: async (chunkId, result): Promise<void> => {
              await persistTransition((current) =>
                recordBroadcastRefinementTranscriptSuccess(
                  current,
                  chunkId,
                  result,
                ),
              );
            },
            onChunkAbstention: async (abstention): Promise<void> => {
              await persistTransition((current) =>
                abstention.reason === "no-audio"
                  ? recordBroadcastRefinementTranscriptAbstention(
                      current,
                      abstention.chunkId,
                      "no-audio",
                      null,
                    )
                  : recordBroadcastRefinementTranscriptAbstention(
                      current,
                      abstention.chunkId,
                      "no-speech",
                      abstention.speechActivityReceipt,
                    ),
              );
            },
            onChunkGap: async (chunkId, reason): Promise<void> => {
              await persistTransition((current) =>
                recordBroadcastRefinementTranscriptGap(current, {
                  chunkId,
                  reason,
                  attemptCount: quotaAttemptOrdinal + 1,
                }),
              );
            },
          },
        ),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.wait === undefined ? {} : { wait: options.wait }),
      ...(options.onProgress === undefined
        ? {}
        : { onProgress: options.onProgress }),
      onAttemptSettled: async (
        result,
        quotaAttemptOrdinal,
      ): Promise<void> => {
        await transitionTail;
        const settledIds = new Set([
          ...checkpoint.successfulFragments.map(({ chunkId }) => chunkId),
          ...checkpoint.abstentions.map(({ chunkId }) => chunkId),
          ...checkpoint.gaps
            .filter(
              ({ reason, attemptCount }) =>
                reason !== "in-flight" &&
                attemptCount === quotaAttemptOrdinal + 1,
            )
            .map(({ chunkId }) => chunkId),
        ]);
        const resultIds = [
          ...result.fragments.map(({ chunkId }) => chunkId),
          ...result.abstentions.map(({ chunkId }) => chunkId),
          ...result.gaps.map(({ chunkId }) => chunkId),
        ];
        if (!resultIds.every((chunkId) => settledIds.has(chunkId))) {
          throw new DurableBroadcastRefinementTranscriptPipelineError(
            "Refinement transcript worker completed before terminal checkpoint readback.",
          );
        }
      },
    });
    providerAttemptCount += recovery.attemptedCount;
    recoveryBatchCount += 1;
    if (
      broadcastRefinementTranscriptCheckpointCanComplete(checkpoint) ||
      runnableChunksForCurrentCheckpoint().length === 0
    ) {
      break;
    }
    /*
     * One recovery call remains a bounded three-wave batch. Every transition
     * above has already survived durable CAS + exact readback before the next
     * unique quota generation starts.
     */
    const continuationDelayMs = Math.min(
      30_000,
      4_000 * 2 ** Math.min(recoveryBatchCount - 1, 3),
    );
    await (options.wait ?? waitForRecoveryBatch)(
      continuationDelayMs,
      options.signal,
    );
  }

  const blockingGaps = checkpoint.gaps;
  if (!broadcastRefinementTranscriptCheckpointCanComplete(checkpoint)) {
    return {
      status: blockingStatus(blockingGaps),
      complete: false,
      session,
      checkpoint,
      fragments: checkpoint.successfulFragments,
      abstentions: checkpoint.abstentions,
      blockingGaps,
      providerAttemptCount,
    };
  }

  return {
    status: "completed",
    complete: true,
    session,
    checkpoint,
    fragments: checkpoint.successfulFragments,
    abstentions: checkpoint.abstentions,
    blockingGaps: [],
    providerAttemptCount,
  };
}
