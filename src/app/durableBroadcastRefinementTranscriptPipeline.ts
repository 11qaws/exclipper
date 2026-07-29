import type { BroadcastContextTranscriptionChunk } from "../analysis/broadcastContextSamplingPlan";
import {
  broadcastRefinementTranscriptCheckpointCanComplete,
  broadcastRefinementTranscriptCheckpointMatchesInput,
  createBroadcastRefinementTranscriptCheckpoint,
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
  type BroadcastTranscriptFragmentRecoveryProgress,
} from "../analysis/broadcastTranscriptFragmentRecovery";
import type {
  BroadcastTranscriptWorkerFragment,
  BroadcastTranscriptWorkerRunResult,
} from "../analysis/broadcastTranscriptWorkerClient";
import type { BroadcastTranscriptChunkAbstention } from "../analysis/broadcastTranscriptWorkerProtocol";
import {
  checkpointBroadcastContextSessionRefinementTranscriptIfUnchanged,
  type AnalysisResultStore,
} from "../storage/analysisResultStore";
import type { BroadcastContextSessionRecord } from "../storage/broadcastContextSessionStore";

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
  ) => Promise<BroadcastTranscriptWorkerRunResult>;
  readonly wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  readonly onProgress?: (
    progress: BroadcastTranscriptFragmentRecoveryProgress,
  ) => void;
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

function isOutcomeUnknownGap(
  gap: BroadcastRefinementTranscriptGap,
): boolean {
  return gap.reason === "in-flight" || gap.reason === "outcome-unknown";
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

  const persistCheckpoint = async (
    next: BroadcastRefinementTranscriptCheckpoint,
  ): Promise<void> => {
    const serialized =
      serializeBroadcastRefinementTranscriptCheckpoint(next);
    const replaced =
      await checkpointBroadcastContextSessionRefinementTranscriptIfUnchanged(
        options.store,
        session,
        {
          refinementTranscriptInputSignature:
            options.refinementTranscriptInputSignature,
          refinementTranscriptCheckpointJson: serialized,
          recordedAt: new Date().toISOString(),
        },
      );
    if (!replaced) {
      throw new DurableBroadcastRefinementTranscriptPipelineError(
        "후보 대사 체크포인트를 저장하는 동안 세션이 갱신됐어요.",
      );
    }
    const reopened = await options.store.getBroadcastContextSession(
      options.runId,
    );
    if (
      reopened === null ||
      reopened.refinementTranscriptInputSignature !==
        options.refinementTranscriptInputSignature ||
      reopened.refinementTranscriptCheckpointJson !== serialized ||
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
    checkpoint = next;
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

  const settledChunkIds = new Set([
    ...checkpoint.successfulFragments.map(({ chunkId }) => chunkId),
    ...checkpoint.abstentions.map(({ chunkId }) => chunkId),
  ]);
  const gapByChunkId = new Map(
    checkpoint.gaps.map((gap) => [gap.chunkId, gap]),
  );
  const mayRetryAmbiguous =
    checkpoint.gaps.every((gap) => !isOutcomeUnknownGap(gap)) ||
    options.allowOutcomeUnknownRetry;
  const runnableChunks = checkpoint.plannedChunks.flatMap((planned) => {
    if (settledChunkIds.has(planned.chunkId)) return [];
    const gap = gapByChunkId.get(planned.chunkId);
    if (
      gap !== undefined &&
      isOutcomeUnknownGap(gap) &&
      !mayRetryAmbiguous
    ) {
      return [];
    }
    const sourceChunk = plannedById.get(planned.chunkId);
    if (sourceChunk === undefined) {
      throw new DurableBroadcastRefinementTranscriptPipelineError(
        "후보 대사 체크포인트의 구간을 원본 계획에서 찾지 못했어요.",
      );
    }
    return [sourceChunk];
  });

  let providerAttemptCount = 0;
  if (runnableChunks.length > 0) {
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
      runAttempt: options.runAttempt,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.wait === undefined ? {} : { wait: options.wait }),
      ...(options.onProgress === undefined
        ? {}
        : { onProgress: options.onProgress }),
      onAttemptStarting: async (
        requested,
        quotaAttemptOrdinal,
      ): Promise<void> => {
        throwIfAborted(options.signal);
        let inFlight = checkpoint;
        for (const chunk of requested) {
          inFlight = recordBroadcastRefinementTranscriptGap(inFlight, {
            chunkId: chunk.chunkId,
            reason: "in-flight",
            attemptCount: quotaAttemptOrdinal + 1,
          });
        }
        await persistCheckpoint(inFlight);
      },
      onAttemptSettled: async (
        result,
        quotaAttemptOrdinal,
      ): Promise<void> => {
        let settled = checkpoint;
        for (const fragment of result.fragments) {
          settled = recordBroadcastRefinementTranscriptSuccess(
            settled,
            fragment.chunkId,
            fragment.result,
          );
        }
        for (const abstention of result.abstentions) {
          settled =
            abstention.reason === "no-audio"
              ? recordBroadcastRefinementTranscriptAbstention(
                  settled,
                  abstention.chunkId,
                  "no-audio",
                  null,
                )
              : recordBroadcastRefinementTranscriptAbstention(
                  settled,
                  abstention.chunkId,
                  "no-speech",
                  abstention.speechActivityReceipt,
                );
        }
        for (const gap of result.gaps) {
          settled =
            gap.reason === "no-audio"
              ? recordBroadcastRefinementTranscriptGap(settled, {
                  chunkId: gap.chunkId,
                  reason: "decode-failed",
                  attemptCount: quotaAttemptOrdinal + 1,
                })
              : recordBroadcastRefinementTranscriptGap(settled, {
                  chunkId: gap.chunkId,
                  reason: gap.reason,
                  attemptCount: quotaAttemptOrdinal + 1,
                });
        }
        await persistCheckpoint(settled);
      },
    });
    providerAttemptCount = recovery.attemptedCount;
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
