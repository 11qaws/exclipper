import type { AnalysisLanguage } from "../domain/analysisLanguage";
import type { AnalysisResultStore } from "../storage/analysisResultStore";
import {
  checkpointBroadcastContextSessionVisualInspection,
  type BroadcastContextSessionRecord,
} from "../storage/broadcastContextSessionStore";
import { createBroadcastTranscriptVisualBrowserMediaAdapter } from "../analysis/broadcastTranscriptVisualBrowserMedia";
import {
  parseAndProjectBroadcastTranscriptVisualContext,
  parseBroadcastTranscriptVisualInspectionRunnerCheckpointJson,
  serializeBroadcastTranscriptVisualInspectionRunnerCheckpoint,
  type BroadcastTranscriptVisualContextProjection,
} from "../analysis/broadcastTranscriptVisualContextProjection";
import {
  createBroadcastTranscriptVisualInspectionPlan,
  type BroadcastTranscriptVisualInspectionPlan,
} from "../analysis/broadcastTranscriptVisualInspectionQueue";
import {
  BROADCAST_TRANSCRIPT_VISUAL_TRANSPORT_MODE,
  DEFAULT_BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_ATTEMPT_COUNT,
  createBroadcastTranscriptVisualInspectionRunnerCheckpoint,
  runBroadcastTranscriptVisualInspection,
  type BroadcastTranscriptVisualInspectionRunnerBlockedStatus,
  type BroadcastTranscriptVisualInspectionRunnerCheckpoint,
  type BroadcastTranscriptVisualInspectionPersistTransition,
} from "../analysis/broadcastTranscriptVisualInspectionRunner";
import {
  BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_MODEL_REVISION,
  classifyBroadcastTranscriptVisualProviderFailure,
  createBroadcastTranscriptVisualProviderBatchAdapter,
  createBroadcastTranscriptVisualProviderOperationId,
} from "../analysis/broadcastTranscriptVisualProviderClient";
import {
  parseBroadcastTranscriptResolvedEvidenceCheckpointJson,
} from "../analysis/broadcastTranscriptResolvedEvidence";
import type { CandidatePassBCastRosterId } from "../analysis/participantRoster";
import {
  loadDurableBroadcastContextSession,
  transformDurableBroadcastContextSession,
  type DurableBroadcastContextSessionResult,
} from "./durableBroadcastContextSession";

const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;

export type BroadcastVisualInspectionPhaseStatus =
  | "preparing"
  | "analyzing";

export interface BroadcastVisualInspectionPhaseProgress {
  readonly status: BroadcastVisualInspectionPhaseStatus;
  readonly plannedCellCount: number;
  readonly preparedCellCount: number;
  readonly settledCellCount: number;
  readonly projection: BroadcastTranscriptVisualContextProjection | null;
  readonly chapters: readonly BroadcastContextSessionRecord["chapters"][number][];
}

export type DurableBroadcastVisualInspectionPhaseResult =
  | {
      readonly status: "completed";
      readonly plan: BroadcastTranscriptVisualInspectionPlan;
      readonly projection: BroadcastTranscriptVisualContextProjection | null;
      readonly session: BroadcastContextSessionRecord;
    }
  | {
      readonly status: "blocked";
      readonly reason:
        | "source-file-required"
        | BroadcastTranscriptVisualInspectionRunnerBlockedStatus;
      readonly plan: BroadcastTranscriptVisualInspectionPlan;
      readonly projection: BroadcastTranscriptVisualContextProjection | null;
      readonly session: BroadcastContextSessionRecord;
    };

export interface RunDurableBroadcastVisualInspectionPhaseOptions {
  readonly store: AnalysisResultStore;
  readonly runId: string;
  readonly inputSignature: string;
  readonly operationToken: string;
  readonly transcriptSeal: string;
  readonly sourceDurationMs: number;
  readonly sourceFile: File | null;
  readonly participantId: string;
  readonly castRosterId: CandidatePassBCastRosterId | null;
  readonly outputLanguage: AnalysisLanguage;
  readonly signal?: AbortSignal;
  readonly isCurrent: () => boolean;
  readonly onProgress?: (
    progress: BroadcastVisualInspectionPhaseProgress,
  ) => void;
  readonly retryDelay?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  readonly createMediaAdapter?: typeof createBroadcastTranscriptVisualBrowserMediaAdapter;
  readonly createProviderAdapter?: typeof createBroadcastTranscriptVisualProviderBatchAdapter;
}

export class DurableBroadcastVisualInspectionPhaseError extends Error {
  public readonly name = "DurableBroadcastVisualInspectionPhaseError";

  public constructor(
    public readonly code:
      | "SESSION_INVALID"
      | "TRANSCRIPT_EVIDENCE_INVALID"
      | "VISUAL_CHECKPOINT_INVALID"
      | "DURABLE_CHECKPOINT_REJECTED",
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
  }
}

function abortError(): DOMException {
  return new DOMException("Broadcast visual inspection was cancelled.", "AbortError");
}

function ensureCurrent(
  options: Pick<
    RunDurableBroadcastVisualInspectionPhaseOptions,
    "isCurrent" | "signal"
  >,
): void {
  if (options.signal?.aborted === true || !options.isCurrent()) {
    throw abortError();
  }
}

function defaultRetryDelay(
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(abortError());
      return;
    }
    let timer: ReturnType<typeof globalThis.setTimeout> | null =
      globalThis.setTimeout(() => {
        timer = null;
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, delayMs);
    const onAbort = (): void => {
      if (timer !== null) {
        globalThis.clearTimeout(timer);
        timer = null;
      }
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function settledCellCount(
  projection: BroadcastTranscriptVisualContextProjection,
): number {
  return (
    projection.publication.completedCellIds.length +
    projection.publication.excludedMusicOnlyCellIds.length
  );
}

function emitProgress(
  options: RunDurableBroadcastVisualInspectionPhaseOptions,
  status: BroadcastVisualInspectionPhaseStatus,
  plan: BroadcastTranscriptVisualInspectionPlan,
  session: BroadcastContextSessionRecord,
  projection: BroadcastTranscriptVisualContextProjection | null,
): void {
  options.onProgress?.({
    status,
    plannedCellCount: plan.cells.length,
    preparedCellCount:
      projection?.runnerCheckpoint.preparedFrameReceipts.length ?? 0,
    settledCellCount:
      projection === null ? 0 : settledCellCount(projection),
    projection,
    chapters: session.chapters,
  });
}

async function runDurableSessionOperation(
  options: RunDurableBroadcastVisualInspectionPhaseOptions,
  operationSuffix: string,
  run: (
    isCurrent: (
      identity: {
        readonly runId: string;
        readonly operationToken: string;
        readonly inputSignature: string;
      },
    ) => boolean,
  ) => Promise<DurableBroadcastContextSessionResult>,
): Promise<BroadcastContextSessionRecord> {
  const operationToken = `${options.operationToken}:${operationSuffix}`;
  const retryDelay = options.retryDelay ?? defaultRetryDelay;
  let retryCycle = 0;
  for (;;) {
    ensureCurrent(options);
    const result = await run((identity) => {
      return (
        options.isCurrent() &&
        options.signal?.aborted !== true &&
        identity.runId === options.runId &&
        identity.inputSignature === options.inputSignature &&
        identity.operationToken === operationToken
      );
    });
    switch (result.status) {
      case "succeeded":
        return result.value;
      case "retry-exhausted":
        retryCycle += 1;
        await retryDelay(
          Math.min(
            MAX_RETRY_DELAY_MS,
            DEFAULT_RETRY_BASE_DELAY_MS *
              2 ** Math.min(retryCycle - 1, 5),
          ),
          options.signal,
        );
        break;
      case "aborted":
      case "stale":
        throw abortError();
      case "permanent-failure":
        throw new DurableBroadcastVisualInspectionPhaseError(
          "DURABLE_CHECKPOINT_REJECTED",
          `Broadcast visual checkpoint was rejected: ${result.reasonCode}`,
        );
    }
  }
}

function assertExactSessionFence(
  session: BroadcastContextSessionRecord,
  options: RunDurableBroadcastVisualInspectionPhaseOptions,
  transcriptEvidenceCheckpointJson: string,
): void {
  if (
    session.runId !== options.runId ||
    session.inputSignature !== options.inputSignature ||
    session.sourceDurationMs !== options.sourceDurationMs ||
    session.transcriptSealOperationKey !== options.transcriptSeal ||
    session.transcriptEvidenceCheckpointJson !==
      transcriptEvidenceCheckpointJson
  ) {
    throw new DurableBroadcastVisualInspectionPhaseError(
      "SESSION_INVALID",
      "The visual phase no longer matches the exact transcript session.",
    );
  }
}

function projectStoredCheckpoint(
  transcriptEvidenceCheckpointJson: string,
  visualInspectionCheckpointJson: string,
): BroadcastTranscriptVisualContextProjection {
  const projection = parseAndProjectBroadcastTranscriptVisualContext({
    transcriptEvidenceCheckpointJson,
    visualInspectionCheckpointJson,
  });
  if (projection === null) {
    throw new DurableBroadcastVisualInspectionPhaseError(
      "VISUAL_CHECKPOINT_INVALID",
      "The stored visual checkpoint does not match the current transcript evidence.",
    );
  }
  const usesDifferentProviderModel =
    projection.runnerCheckpoint.providerLedger.settlements.some(
      ({ providerModelRevision }) =>
        providerModelRevision !==
        BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_MODEL_REVISION,
    ) ||
    projection.runnerCheckpoint.activeProviderDispatches.some(
      ({ providerModelRevision }) =>
        providerModelRevision !==
        BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_MODEL_REVISION,
    );
  if (usesDifferentProviderModel) {
    throw new DurableBroadcastVisualInspectionPhaseError(
      "VISUAL_CHECKPOINT_INVALID",
      "The stored visual checkpoint belongs to a different provider model revision.",
    );
  }
  return projection;
}

/**
 * Runs the current-schema visual evidence lane: transcript abstentions plus a
 * bounded source-distributed set of dialogue cells for participant grounding.
 * The lane is free-r2 only. Every local receipt, dispatch arm, and settlement
 * is committed with CAS and proved by an exact readback before a later bounded
 * invocation may replace retryable or outcome-unknown work.
 */
export async function runDurableBroadcastVisualInspectionPhase(
  options: RunDurableBroadcastVisualInspectionPhaseOptions,
): Promise<DurableBroadcastVisualInspectionPhaseResult> {
  ensureCurrent(options);
  let session = await runDurableSessionOperation(
    options,
    "load",
    (isCurrent) =>
      loadDurableBroadcastContextSession({
        store: options.store,
        identity: {
          runId: options.runId,
          inputSignature: options.inputSignature,
          operationToken: `${options.operationToken}:load`,
        },
        isCurrent,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }),
  );
  const transcriptEvidenceCheckpointJson =
    session.transcriptEvidenceCheckpointJson;
  if (transcriptEvidenceCheckpointJson === null) {
    throw new DurableBroadcastVisualInspectionPhaseError(
      "TRANSCRIPT_EVIDENCE_INVALID",
      "Visual inspection requires the sealed transcript abstention evidence.",
    );
  }
  assertExactSessionFence(
    session,
    options,
    transcriptEvidenceCheckpointJson,
  );
  const transcriptEvidence =
    parseBroadcastTranscriptResolvedEvidenceCheckpointJson(
      transcriptEvidenceCheckpointJson,
    );
  if (
    transcriptEvidence === null ||
    transcriptEvidence.sourceDurationMs !== options.sourceDurationMs ||
    transcriptEvidence.sourceFingerprint !== options.inputSignature
  ) {
    throw new DurableBroadcastVisualInspectionPhaseError(
      "TRANSCRIPT_EVIDENCE_INVALID",
      "The transcript abstention evidence is invalid for this analysis input.",
    );
  }
  const plan = createBroadcastTranscriptVisualInspectionPlan(
    transcriptEvidence,
  );

  let projection =
    session.transcriptVisualInspectionCheckpointJson === null
      ? null
      : projectStoredCheckpoint(
          transcriptEvidenceCheckpointJson,
          session.transcriptVisualInspectionCheckpointJson,
        );
  emitProgress(options, "preparing", plan, session, projection);
  if (projection?.publication.publicationReady === true) {
    return { status: "completed", plan, projection, session };
  }
  if (plan.cells.length === 0) {
    return { status: "completed", plan, projection: null, session };
  }
  if (options.sourceFile === null) {
    return {
      status: "blocked",
      reason: "source-file-required",
      plan,
      projection,
      session,
    };
  }

  const createMediaAdapter =
    options.createMediaAdapter ??
    createBroadcastTranscriptVisualBrowserMediaAdapter;
  const createProviderAdapter =
    options.createProviderAdapter ??
    createBroadcastTranscriptVisualProviderBatchAdapter;
  const mediaAdapter = createMediaAdapter({
    sourceFile: options.sourceFile,
    plan,
  });
  const providerAdapter = createProviderAdapter({
    participantId: options.participantId,
    runId: options.runId,
    castRosterId: options.castRosterId,
    outputLanguage: options.outputLanguage,
    maximumConcurrency: 2,
  });
  if (
    providerAdapter.transportMode !==
      BROADCAST_TRANSCRIPT_VISUAL_TRANSPORT_MODE ||
    providerAdapter.providerModelRevision !==
      BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_MODEL_REVISION
  ) {
    mediaAdapter.dispose();
    throw new DurableBroadcastVisualInspectionPhaseError(
      "VISUAL_CHECKPOINT_INVALID",
      "The visual provider adapter does not match the current free-r2 contract.",
    );
  }
  let checkpoint: BroadcastTranscriptVisualInspectionRunnerCheckpoint =
    projection?.runnerCheckpoint ??
    createBroadcastTranscriptVisualInspectionRunnerCheckpoint({ plan });

  try {
    emitProgress(options, "analyzing", plan, session, projection);
    const result = await runBroadcastTranscriptVisualInspection({
      plan,
      checkpoint,
      providerModelRevision:
        BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_MODEL_REVISION,
      maximumFrameConcurrency: 2,
      maximumProviderBatchSize: 2,
      maximumProviderAttemptCount:
        DEFAULT_BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_ATTEMPT_COUNT,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      mediaEvidence: mediaAdapter,
      executeProviderBatch: providerAdapter.executeProviderBatch,
      classifyProviderFailure:
        classifyBroadcastTranscriptVisualProviderFailure,
      createProviderOperationId:
        createBroadcastTranscriptVisualProviderOperationId,
      persistAndReadback: async (
        attemptedCheckpoint: BroadcastTranscriptVisualInspectionRunnerCheckpoint,
        transition: BroadcastTranscriptVisualInspectionPersistTransition,
      ) => {
        ensureCurrent(options);
        const exactCheckpointJson =
          serializeBroadcastTranscriptVisualInspectionRunnerCheckpoint(
            attemptedCheckpoint,
            plan,
          );
        const expectedSession = session;
        session = await runDurableSessionOperation(
          options,
          `checkpoint:${transition.resultingRevision}:${transition.cause}`,
          (isCurrent) =>
            transformDurableBroadcastContextSession({
              store: options.store,
              identity: {
                runId: options.runId,
                inputSignature: options.inputSignature,
                operationToken:
                  `${options.operationToken}:checkpoint:` +
                  `${transition.resultingRevision}:${transition.cause}`,
              },
              expected: expectedSession,
              isCurrent,
              ...(options.signal === undefined
                ? {}
                : { signal: options.signal }),
              transform: (current) => {
                assertExactSessionFence(
                  current,
                  options,
                  transcriptEvidenceCheckpointJson,
                );
                return checkpointBroadcastContextSessionVisualInspection(
                  current,
                  {
                    transcriptVisualInspectionCheckpointJson:
                      exactCheckpointJson,
                    recordedAt: new Date().toISOString(),
                  },
                );
              },
            }),
        );
        if (
          session.transcriptVisualInspectionCheckpointJson !==
          exactCheckpointJson
        ) {
          throw new DurableBroadcastVisualInspectionPhaseError(
            "DURABLE_CHECKPOINT_REJECTED",
            "The visual checkpoint readback was not byte-for-byte exact.",
          );
        }
        projection = projectStoredCheckpoint(
          transcriptEvidenceCheckpointJson,
          exactCheckpointJson,
        );
        checkpoint =
          parseBroadcastTranscriptVisualInspectionRunnerCheckpointJson(
            exactCheckpointJson,
            plan,
          )!;
        emitProgress(
          options,
          transition.cause === "frame-prepared" ? "preparing" : "analyzing",
          plan,
          session,
          projection,
        );
        return checkpoint;
      },
    });
    if (
      result.checkpoint.transportMode !==
      BROADCAST_TRANSCRIPT_VISUAL_TRANSPORT_MODE
    ) {
      throw new DurableBroadcastVisualInspectionPhaseError(
        "VISUAL_CHECKPOINT_INVALID",
        "The visual checkpoint is not bound to the current free-r2 lane.",
      );
    }
    checkpoint = result.checkpoint;
    const exactFinalJson =
      serializeBroadcastTranscriptVisualInspectionRunnerCheckpoint(
        checkpoint,
        plan,
      );
    projection = projectStoredCheckpoint(
      transcriptEvidenceCheckpointJson,
      exactFinalJson,
    );
    emitProgress(options, "analyzing", plan, session, projection);
    return result.status === "completed"
      ? { status: "completed", plan, projection, session }
      : {
          status: "blocked",
          reason: result.status,
          plan,
          projection,
          session,
        };
  } finally {
    mediaAdapter.dispose();
  }
}
