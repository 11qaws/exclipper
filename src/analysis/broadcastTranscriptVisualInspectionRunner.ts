import {
  DEFAULT_BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_BATCH_SIZE,
  MAX_BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_BATCH_SIZE,
  assertBroadcastTranscriptVisualInspectionPlan,
  createBroadcastTranscriptVisualFramePreparationQueue,
  createBroadcastTranscriptVisualPreparedFrameReceipt,
  createBroadcastTranscriptVisualProviderBatchQueue,
  createBroadcastTranscriptVisualProviderSettlement,
  createBroadcastTranscriptVisualProviderSettlementLedger,
  inspectBroadcastTranscriptVisualInspectionPublication,
  recordBroadcastTranscriptVisualProviderSettlement,
  serializeBroadcastTranscriptVisualProviderSettlementLedger,
  type BroadcastTranscriptVisualFramePreparationTask,
  type BroadcastTranscriptVisualInspectionPlan,
  type BroadcastTranscriptVisualInspectionPublicationStatus,
  type BroadcastTranscriptVisualPreparedFrameReceipt,
  type BroadcastTranscriptVisualEditorialFinding,
  type BroadcastTranscriptVisualProviderFailureReason,
  type BroadcastTranscriptVisualProviderSettlement,
  type BroadcastTranscriptVisualProviderSettlementLedger,
  type BroadcastTranscriptVisualProviderTask,
} from "./broadcastTranscriptVisualInspectionQueue";

export const BROADCAST_TRANSCRIPT_VISUAL_INSPECTION_RUNNER_SCHEMA_VERSION =
  "1.0.0" as const;
export const DEFAULT_BROADCAST_TRANSCRIPT_VISUAL_FRAME_CONCURRENCY = 2;
export const MAX_BROADCAST_TRANSCRIPT_VISUAL_FRAME_CONCURRENCY = 8;
export const DEFAULT_BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_ATTEMPT_COUNT = 3;
export const MAX_BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_ATTEMPT_COUNT = 8;

type FourFrameContentFingerprints =
  BroadcastTranscriptVisualPreparedFrameReceipt["frameContentFingerprints"];

export interface BroadcastTranscriptVisualProviderDispatchIntent {
  readonly cellId: string;
  readonly operationId: string;
  readonly attemptOrdinal: number;
  readonly providerModelRevision: string;
  readonly frameBundleKey: string;
  readonly requestedFrameContentFingerprints: FourFrameContentFingerprints;
  readonly replacesOutcomeUnknown: boolean;
}

/**
 * The runner checkpoint is deliberately storage-agnostic. The caller owns its
 * persistence, while this module requires an exact readback after every
 * transition before it permits another provider request.
 */
export interface BroadcastTranscriptVisualInspectionRunnerCheckpoint {
  readonly schemaVersion:
    typeof BROADCAST_TRANSCRIPT_VISUAL_INSPECTION_RUNNER_SCHEMA_VERSION;
  readonly planFingerprint: string;
  readonly sourceFingerprint: string;
  readonly revision: number;
  readonly preparedFrameReceipts: readonly BroadcastTranscriptVisualPreparedFrameReceipt[];
  readonly providerLedger: BroadcastTranscriptVisualProviderSettlementLedger;
  /**
   * A non-empty list means a provider batch was durably armed. If a process
   * resumes from this state, no request is repeated: every intent is first
   * sealed as outcome-unknown.
   */
  readonly activeProviderDispatches: readonly BroadcastTranscriptVisualProviderDispatchIntent[];
}

export type BroadcastTranscriptVisualInspectionPersistCause =
  | "frame-prepared"
  | "provider-dispatch-armed"
  | "provider-settled"
  | "recovered-dispatch-sealed";

export interface BroadcastTranscriptVisualInspectionPersistTransition {
  readonly cause: BroadcastTranscriptVisualInspectionPersistCause;
  readonly previousRevision: number;
  readonly resultingRevision: number;
  readonly cellIds: readonly string[];
}

export interface BroadcastTranscriptVisualFrameAdapterRequest {
  readonly planFingerprint: string;
  readonly sourceFingerprint: string;
  readonly task: BroadcastTranscriptVisualFramePreparationTask;
  readonly signal?: AbortSignal;
}

export interface BroadcastTranscriptVisualProviderAttemptRequest {
  readonly planFingerprint: string;
  readonly sourceFingerprint: string;
  readonly task: BroadcastTranscriptVisualProviderTask;
  readonly providerModelRevision: string;
  readonly operationId: string;
  readonly attemptOrdinal: number;
}

interface BroadcastTranscriptVisualProviderAdapterResultBase {
  readonly cellId: string;
  readonly operationId: string;
}

export type BroadcastTranscriptVisualProviderAdapterResult =
  | (BroadcastTranscriptVisualProviderAdapterResultBase & {
      readonly outcome: "completed";
      readonly editorialFinding: Exclude<
        BroadcastTranscriptVisualEditorialFinding,
        "music-or-mv-only"
      >;
      readonly summaryKo: string;
      readonly providerResponseFingerprint: string;
    })
  | (BroadcastTranscriptVisualProviderAdapterResultBase & {
      readonly outcome: "excluded-music-only";
      readonly editorialFinding: "music-or-mv-only";
      readonly summaryKo: string;
      readonly providerResponseFingerprint: string;
    })
  | (BroadcastTranscriptVisualProviderAdapterResultBase & {
      readonly outcome: "retryable" | "outcome-unknown";
      readonly failureReason: BroadcastTranscriptVisualProviderFailureReason;
    });

export interface BroadcastTranscriptVisualProviderFailureClassification {
  readonly outcome: "retryable" | "outcome-unknown";
  readonly failureReason: BroadcastTranscriptVisualProviderFailureReason;
}

export interface BroadcastTranscriptVisualProviderOperationIdRequest {
  readonly planFingerprint: string;
  readonly sourceFingerprint: string;
  readonly cellId: string;
  readonly attemptOrdinal: number;
  readonly usedOperationIds: readonly string[];
}

export interface RunBroadcastTranscriptVisualInspectionOptions {
  readonly plan: BroadcastTranscriptVisualInspectionPlan;
  readonly checkpoint: BroadcastTranscriptVisualInspectionRunnerCheckpoint;
  readonly providerModelRevision: string;
  readonly maximumFrameConcurrency?: number;
  readonly maximumProviderBatchSize?: number;
  readonly maximumProviderAttemptCount?: number;
  /**
   * Consent is bound to the exact unknown operation, not merely a cell. A
   * confirmation therefore cannot silently authorize another unknown retry.
   */
  readonly confirmedOutcomeUnknownOperationIds?: readonly string[];
  readonly signal?: AbortSignal;
  readonly prepareFrames: (
    request: BroadcastTranscriptVisualFrameAdapterRequest,
  ) => Promise<FourFrameContentFingerprints>;
  readonly executeProviderBatch: (
    requests: readonly BroadcastTranscriptVisualProviderAttemptRequest[],
    signal?: AbortSignal,
  ) => Promise<readonly BroadcastTranscriptVisualProviderAdapterResult[]>;
  readonly classifyProviderFailure: (
    error: unknown,
    requests: readonly BroadcastTranscriptVisualProviderAttemptRequest[],
  ) =>
    | BroadcastTranscriptVisualProviderFailureClassification
    | Promise<BroadcastTranscriptVisualProviderFailureClassification>;
  readonly createProviderOperationId: (
    request: BroadcastTranscriptVisualProviderOperationIdRequest,
  ) => string | Promise<string>;
  readonly persistAndReadback: (
    checkpoint: BroadcastTranscriptVisualInspectionRunnerCheckpoint,
    transition: BroadcastTranscriptVisualInspectionPersistTransition,
  ) => Promise<BroadcastTranscriptVisualInspectionRunnerCheckpoint>;
}

export interface BroadcastTranscriptVisualFramePreparationFailure {
  readonly cellId: string;
  readonly causeValue: unknown;
}

export interface BroadcastTranscriptVisualInspectionRunnerStatistics {
  readonly resumedPreparedFrameCount: number;
  readonly preparedFrameCount: number;
  readonly recoveredDispatchCount: number;
  readonly providerBatchExecutionCount: number;
  readonly providerCellExecutionCount: number;
  readonly automaticRetryCount: number;
  readonly confirmedOutcomeUnknownRetryCount: number;
  readonly persistedTransitionCount: number;
}

export type BroadcastTranscriptVisualInspectionRunnerBlockedStatus =
  | "blocked-frame-preparation"
  | "blocked-outcome-unknown"
  | "blocked-retry-limit"
  | "blocked-provider"
  | "blocked-publication";

interface BroadcastTranscriptVisualInspectionRunnerResultBase {
  readonly checkpoint: BroadcastTranscriptVisualInspectionRunnerCheckpoint;
  readonly publication: BroadcastTranscriptVisualInspectionPublicationStatus;
  readonly framePreparationFailures: readonly BroadcastTranscriptVisualFramePreparationFailure[];
  readonly statistics: BroadcastTranscriptVisualInspectionRunnerStatistics;
}

export type BroadcastTranscriptVisualInspectionRunnerResult =
  | (BroadcastTranscriptVisualInspectionRunnerResultBase & {
      readonly status: "completed";
      readonly complete: true;
    })
  | (BroadcastTranscriptVisualInspectionRunnerResultBase & {
      readonly status: BroadcastTranscriptVisualInspectionRunnerBlockedStatus;
      readonly complete: false;
    });

export type BroadcastTranscriptVisualInspectionRunnerErrorCode =
  | "INVALID_CHECKPOINT"
  | "INVALID_CONFIGURATION"
  | "PERSISTENCE_FAILED"
  | "PERSISTENCE_READBACK_MISMATCH"
  | "OPERATION_ID_FAILED"
  | "PROVIDER_FAILURE_CLASSIFICATION_FAILED"
  | "INTERRUPTED";

export class BroadcastTranscriptVisualInspectionRunnerError extends Error {
  public readonly name = "BroadcastTranscriptVisualInspectionRunnerError";

  public constructor(
    public readonly code: BroadcastTranscriptVisualInspectionRunnerErrorCode,
    message: string,
    public readonly lastPersistedCheckpoint: BroadcastTranscriptVisualInspectionRunnerCheckpoint | null,
    public readonly attemptedCheckpoint: BroadcastTranscriptVisualInspectionRunnerCheckpoint | null,
    public readonly causeValue: unknown = null,
  ) {
    super(message);
  }
}

interface MutableRunnerStatistics {
  resumedPreparedFrameCount: number;
  preparedFrameCount: number;
  recoveredDispatchCount: number;
  providerBatchExecutionCount: number;
  providerCellExecutionCount: number;
  automaticRetryCount: number;
  confirmedOutcomeUnknownRetryCount: number;
  persistedTransitionCount: number;
}

class AsyncTransitionMutex {
  private tail: Promise<void> = Promise.resolve();

  public async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release: () => void = () => undefined;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function boundedString(value: unknown, maximumLength = 2_048): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value.trim() === value &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

function signalIsAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function frameFingerprintsEqual(
  left: FourFrameContentFingerprints,
  right: FourFrameContentFingerprints,
): boolean {
  return left.every((fingerprint, index) => fingerprint === right[index]);
}

function cellOrdinalMap(
  plan: BroadcastTranscriptVisualInspectionPlan,
): ReadonlyMap<string, number> {
  return new Map(plan.cells.map((cell, ordinal) => [cell.cellId, ordinal]));
}

function normalizedReceipts(
  plan: BroadcastTranscriptVisualInspectionPlan,
  receipts: readonly BroadcastTranscriptVisualPreparedFrameReceipt[],
): readonly BroadcastTranscriptVisualPreparedFrameReceipt[] {
  const ordinalByCellId = cellOrdinalMap(plan);
  return [...receipts].sort(
    (left, right) =>
      (ordinalByCellId.get(left.cellId) ?? Number.MAX_SAFE_INTEGER) -
      (ordinalByCellId.get(right.cellId) ?? Number.MAX_SAFE_INTEGER),
  );
}

function normalizedDispatches(
  plan: BroadcastTranscriptVisualInspectionPlan,
  dispatches: readonly BroadcastTranscriptVisualProviderDispatchIntent[],
): readonly BroadcastTranscriptVisualProviderDispatchIntent[] {
  const ordinalByCellId = cellOrdinalMap(plan);
  return [...dispatches].sort(
    (left, right) =>
      (ordinalByCellId.get(left.cellId) ?? Number.MAX_SAFE_INTEGER) -
      (ordinalByCellId.get(right.cellId) ?? Number.MAX_SAFE_INTEGER),
  );
}

function providerSettlementForCell(
  ledger: BroadcastTranscriptVisualProviderSettlementLedger,
  cellId: string,
): BroadcastTranscriptVisualProviderSettlement | undefined {
  return ledger.settlements.find((settlement) => settlement.cellId === cellId);
}

function validateCheckpoint(
  checkpoint: unknown,
  plan: BroadcastTranscriptVisualInspectionPlan,
): asserts checkpoint is BroadcastTranscriptVisualInspectionRunnerCheckpoint {
  assertBroadcastTranscriptVisualInspectionPlan(plan);
  if (
    !isRecord(checkpoint) ||
    !hasExactKeys(checkpoint, [
      "schemaVersion",
      "planFingerprint",
      "sourceFingerprint",
      "revision",
      "preparedFrameReceipts",
      "providerLedger",
      "activeProviderDispatches",
    ]) ||
    checkpoint.schemaVersion !==
      BROADCAST_TRANSCRIPT_VISUAL_INSPECTION_RUNNER_SCHEMA_VERSION ||
    checkpoint.planFingerprint !== plan.planFingerprint ||
    checkpoint.sourceFingerprint !== plan.sourceFence.sourceFingerprint ||
    !Number.isSafeInteger(checkpoint.revision) ||
    (checkpoint.revision as number) < 0 ||
    !Array.isArray(checkpoint.preparedFrameReceipts) ||
    !Array.isArray(checkpoint.activeProviderDispatches)
  ) {
    throw new BroadcastTranscriptVisualInspectionRunnerError(
      "INVALID_CHECKPOINT",
      "The visual inspection runner checkpoint does not match its exact plan fence.",
      null,
      null,
    );
  }

  const typed =
    checkpoint as unknown as BroadcastTranscriptVisualInspectionRunnerCheckpoint;
  try {
    serializeBroadcastTranscriptVisualProviderSettlementLedger(
      typed.providerLedger,
      plan,
    );
    const frameQueue =
      createBroadcastTranscriptVisualFramePreparationQueue(plan);
    createBroadcastTranscriptVisualProviderBatchQueue({
      plan,
      framePreparationQueue: frameQueue,
      preparedFrameReceipts: typed.preparedFrameReceipts,
    });
  } catch (error) {
    throw new BroadcastTranscriptVisualInspectionRunnerError(
      "INVALID_CHECKPOINT",
      "The visual inspection runner checkpoint contains invalid receipts or provider settlements.",
      null,
      null,
      error,
    );
  }

  const receiptsByCellId = new Map(
    typed.preparedFrameReceipts.map((receipt) => [receipt.cellId, receipt]),
  );
  for (const settlement of typed.providerLedger.settlements) {
    const receipt = receiptsByCellId.get(settlement.cellId);
    if (
      receipt === undefined ||
      !frameFingerprintsEqual(
        receipt.frameContentFingerprints,
        settlement.requestedFrameContentFingerprints,
      )
    ) {
      throw new BroadcastTranscriptVisualInspectionRunnerError(
        "INVALID_CHECKPOINT",
        "Every durable provider settlement requires its exact prepared four-frame receipt.",
        null,
        null,
      );
    }
  }

  if (
    typed.activeProviderDispatches.length >
      MAX_BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_BATCH_SIZE ||
    new Set(
      typed.activeProviderDispatches.map(({ cellId }) => cellId),
    ).size !== typed.activeProviderDispatches.length ||
    new Set(
      typed.activeProviderDispatches.map(({ operationId }) => operationId),
    ).size !== typed.activeProviderDispatches.length
  ) {
    throw new BroadcastTranscriptVisualInspectionRunnerError(
      "INVALID_CHECKPOINT",
      "A runner checkpoint may contain only one bounded provider batch with unique cells and operations.",
      null,
      null,
    );
  }

  const usedOperationIds = new Set(
    typed.providerLedger.settlements.map(({ operationId }) => operationId),
  );
  for (const rawDispatch of typed.activeProviderDispatches) {
    if (
      !isRecord(rawDispatch) ||
      !hasExactKeys(rawDispatch, [
        "cellId",
        "operationId",
        "attemptOrdinal",
        "providerModelRevision",
        "frameBundleKey",
        "requestedFrameContentFingerprints",
        "replacesOutcomeUnknown",
      ])
    ) {
      throw new BroadcastTranscriptVisualInspectionRunnerError(
        "INVALID_CHECKPOINT",
        "A provider dispatch intent is malformed.",
        null,
        null,
      );
    }
    const dispatch =
      rawDispatch as unknown as BroadcastTranscriptVisualProviderDispatchIntent;
    const receipt = receiptsByCellId.get(dispatch.cellId);
    const previous = providerSettlementForCell(
      typed.providerLedger,
      dispatch.cellId,
    );
    if (
      receipt === undefined ||
      !boundedString(dispatch.operationId, 256) ||
      usedOperationIds.has(dispatch.operationId) ||
      !boundedString(dispatch.providerModelRevision, 512) ||
      !Number.isSafeInteger(dispatch.attemptOrdinal) ||
      dispatch.attemptOrdinal < 0 ||
      dispatch.attemptOrdinal >=
        MAX_BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_ATTEMPT_COUNT ||
      dispatch.frameBundleKey !== receipt.frameBundleKey ||
      !Array.isArray(dispatch.requestedFrameContentFingerprints) ||
      dispatch.requestedFrameContentFingerprints.length !== 4 ||
      !frameFingerprintsEqual(
        dispatch.requestedFrameContentFingerprints,
        receipt.frameContentFingerprints,
      ) ||
      typeof dispatch.replacesOutcomeUnknown !== "boolean" ||
      previous?.outcome === "completed" ||
      previous?.outcome === "excluded-music-only" ||
      dispatch.attemptOrdinal !==
        (previous === undefined ? 0 : previous.attemptOrdinal + 1) ||
      dispatch.replacesOutcomeUnknown !==
        (previous?.outcome === "outcome-unknown")
    ) {
      throw new BroadcastTranscriptVisualInspectionRunnerError(
        "INVALID_CHECKPOINT",
        "A provider dispatch intent is stale or does not match its prepared frame receipt.",
        null,
        null,
      );
    }
    usedOperationIds.add(dispatch.operationId);
  }
}

export function assertBroadcastTranscriptVisualInspectionRunnerCheckpoint(
  checkpoint: unknown,
  plan: BroadcastTranscriptVisualInspectionPlan,
): asserts checkpoint is BroadcastTranscriptVisualInspectionRunnerCheckpoint {
  validateCheckpoint(checkpoint, plan);
}

export function createBroadcastTranscriptVisualInspectionRunnerCheckpoint(input: {
  readonly plan: BroadcastTranscriptVisualInspectionPlan;
  readonly revision?: number;
  readonly preparedFrameReceipts?: readonly BroadcastTranscriptVisualPreparedFrameReceipt[];
  readonly providerLedger?: BroadcastTranscriptVisualProviderSettlementLedger;
  readonly activeProviderDispatches?: readonly BroadcastTranscriptVisualProviderDispatchIntent[];
}): BroadcastTranscriptVisualInspectionRunnerCheckpoint {
  assertBroadcastTranscriptVisualInspectionPlan(input.plan);
  const checkpoint: BroadcastTranscriptVisualInspectionRunnerCheckpoint = {
    schemaVersion:
      BROADCAST_TRANSCRIPT_VISUAL_INSPECTION_RUNNER_SCHEMA_VERSION,
    planFingerprint: input.plan.planFingerprint,
    sourceFingerprint: input.plan.sourceFence.sourceFingerprint,
    revision: input.revision ?? 0,
    preparedFrameReceipts: normalizedReceipts(
      input.plan,
      input.preparedFrameReceipts ?? [],
    ),
    providerLedger:
      input.providerLedger ??
      createBroadcastTranscriptVisualProviderSettlementLedger(input.plan),
    activeProviderDispatches: normalizedDispatches(
      input.plan,
      input.activeProviderDispatches ?? [],
    ),
  };
  validateCheckpoint(checkpoint, input.plan);
  return checkpoint;
}

function checkpointWith(
  checkpoint: BroadcastTranscriptVisualInspectionRunnerCheckpoint,
  plan: BroadcastTranscriptVisualInspectionPlan,
  changes: {
    readonly preparedFrameReceipts?: readonly BroadcastTranscriptVisualPreparedFrameReceipt[];
    readonly providerLedger?: BroadcastTranscriptVisualProviderSettlementLedger;
    readonly activeProviderDispatches?: readonly BroadcastTranscriptVisualProviderDispatchIntent[];
  },
): BroadcastTranscriptVisualInspectionRunnerCheckpoint {
  return createBroadcastTranscriptVisualInspectionRunnerCheckpoint({
    plan,
    revision: checkpoint.revision + 1,
    preparedFrameReceipts:
      changes.preparedFrameReceipts ?? checkpoint.preparedFrameReceipts,
    providerLedger: changes.providerLedger ?? checkpoint.providerLedger,
    activeProviderDispatches:
      changes.activeProviderDispatches ?? checkpoint.activeProviderDispatches,
  });
}

function configurationInteger(
  value: number,
  minimum: number,
  maximum: number,
): boolean {
  return (
    Number.isSafeInteger(value) && value >= minimum && value <= maximum
  );
}

function validProviderFailureClassification(
  value: unknown,
): value is BroadcastTranscriptVisualProviderFailureClassification {
  if (!isRecord(value)) return false;
  if (value.outcome === "retryable") {
    return ["rate-limited", "provider-unavailable", "invalid-response"].includes(
      String(value.failureReason),
    );
  }
  return (
    value.outcome === "outcome-unknown" &&
    ["operation-interrupted", "timeout-after-dispatch"].includes(
      String(value.failureReason),
    )
  );
}

function statusForPublication(
  publication: BroadcastTranscriptVisualInspectionPublicationStatus,
  frameFailureCount: number,
): BroadcastTranscriptVisualInspectionRunnerBlockedStatus {
  if (
    frameFailureCount > 0 ||
    publication.missingPreparedCellIds.length > 0
  ) {
    return "blocked-frame-preparation";
  }
  if (publication.outcomeUnknownCellIds.length > 0) {
    return "blocked-outcome-unknown";
  }
  if (publication.retryableCellIds.length > 0) {
    return "blocked-retry-limit";
  }
  if (publication.pendingProviderCellIds.length > 0) {
    return "blocked-provider";
  }
  return "blocked-publication";
}

function buildResult(
  checkpoint: BroadcastTranscriptVisualInspectionRunnerCheckpoint,
  plan: BroadcastTranscriptVisualInspectionPlan,
  framePreparationFailures: readonly BroadcastTranscriptVisualFramePreparationFailure[],
  statistics: MutableRunnerStatistics,
): BroadcastTranscriptVisualInspectionRunnerResult {
  const publication = inspectBroadcastTranscriptVisualInspectionPublication({
    plan,
    preparedFrameReceipts: checkpoint.preparedFrameReceipts,
    providerLedger: checkpoint.providerLedger,
  });
  const immutableStatistics: BroadcastTranscriptVisualInspectionRunnerStatistics =
    { ...statistics };
  if (publication.publicationReady) {
    return {
      status: "completed",
      complete: true,
      checkpoint,
      publication,
      framePreparationFailures,
      statistics: immutableStatistics,
    };
  }
  return {
    status: statusForPublication(
      publication,
      framePreparationFailures.length,
    ),
    complete: false,
    checkpoint,
    publication,
    framePreparationFailures,
    statistics: immutableStatistics,
  };
}

function providerAdapterResultToSettlement(input: {
  readonly result: BroadcastTranscriptVisualProviderAdapterResult;
  readonly request: BroadcastTranscriptVisualProviderAttemptRequest;
  readonly plan: BroadcastTranscriptVisualInspectionPlan;
  readonly receipt: BroadcastTranscriptVisualPreparedFrameReceipt;
}): BroadcastTranscriptVisualProviderSettlement {
  const base = {
    plan: input.plan,
    cellId: input.request.task.cellId,
    preparedFrameReceipt: input.receipt,
    providerModelRevision: input.request.providerModelRevision,
    operationId: input.request.operationId,
    attemptOrdinal: input.request.attemptOrdinal,
  };
  switch (input.result.outcome) {
    case "completed":
      return createBroadcastTranscriptVisualProviderSettlement({
        ...base,
        outcome: input.result.outcome,
        editorialFinding: input.result.editorialFinding,
        summaryKo: input.result.summaryKo,
        providerResponseFingerprint:
          input.result.providerResponseFingerprint,
      });
    case "excluded-music-only":
      return createBroadcastTranscriptVisualProviderSettlement({
        ...base,
        outcome: input.result.outcome,
        editorialFinding: input.result.editorialFinding,
        summaryKo: input.result.summaryKo,
        providerResponseFingerprint:
          input.result.providerResponseFingerprint,
      });
    case "retryable":
    case "outcome-unknown":
      return createBroadcastTranscriptVisualProviderSettlement({
        ...base,
        outcome: input.result.outcome,
        failureReason: input.result.failureReason,
      });
  }
  throw new TypeError("The provider returned an unsupported visual outcome.");
}

function syntheticFailureResult(
  request: BroadcastTranscriptVisualProviderAttemptRequest,
  classification: BroadcastTranscriptVisualProviderFailureClassification,
): BroadcastTranscriptVisualProviderAdapterResult {
  return {
    cellId: request.task.cellId,
    operationId: request.operationId,
    outcome: classification.outcome,
    failureReason: classification.failureReason,
  };
}

function validatedProviderResults(
  requests: readonly BroadcastTranscriptVisualProviderAttemptRequest[],
  results: readonly BroadcastTranscriptVisualProviderAdapterResult[],
): readonly BroadcastTranscriptVisualProviderAdapterResult[] | null {
  if (!Array.isArray(results) || results.length !== requests.length) {
    return null;
  }
  const resultByOperationId = new Map<
    string,
    BroadcastTranscriptVisualProviderAdapterResult
  >();
  for (const result of results) {
    if (
      !isRecord(result) ||
      !boundedString(result.cellId, 256) ||
      !boundedString(result.operationId, 256) ||
      resultByOperationId.has(result.operationId)
    ) {
      return null;
    }
    resultByOperationId.set(
      result.operationId,
      result as unknown as BroadcastTranscriptVisualProviderAdapterResult,
    );
  }
  const ordered: BroadcastTranscriptVisualProviderAdapterResult[] = [];
  for (const request of requests) {
    const result = resultByOperationId.get(request.operationId);
    if (result === undefined || result.cellId !== request.task.cellId) {
      return null;
    }
    ordered.push(result);
  }
  return ordered;
}

/**
 * Executes the no-speech/no-audio visual lane without allowing an unverified
 * write, an unknown provider outcome, or a missing frame bundle to disappear.
 *
 * Local frame extraction is bounded and parallel. Provider batches are
 * deliberately sequential: a batch is durably armed before dispatch and every
 * resulting settlement is persisted and read back before another paid request
 * may start.
 */
export async function runBroadcastTranscriptVisualInspection(
  options: RunBroadcastTranscriptVisualInspectionOptions,
): Promise<BroadcastTranscriptVisualInspectionRunnerResult> {
  assertBroadcastTranscriptVisualInspectionPlan(options.plan);
  validateCheckpoint(options.checkpoint, options.plan);

  const maximumFrameConcurrency =
    options.maximumFrameConcurrency ??
    DEFAULT_BROADCAST_TRANSCRIPT_VISUAL_FRAME_CONCURRENCY;
  const maximumProviderBatchSize =
    options.maximumProviderBatchSize ??
    DEFAULT_BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_BATCH_SIZE;
  const maximumProviderAttemptCount =
    options.maximumProviderAttemptCount ??
    DEFAULT_BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_ATTEMPT_COUNT;
  if (
    !configurationInteger(
      maximumFrameConcurrency,
      1,
      MAX_BROADCAST_TRANSCRIPT_VISUAL_FRAME_CONCURRENCY,
    ) ||
    !configurationInteger(
      maximumProviderBatchSize,
      1,
      MAX_BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_BATCH_SIZE,
    ) ||
    !configurationInteger(
      maximumProviderAttemptCount,
      1,
      MAX_BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_ATTEMPT_COUNT,
    ) ||
    !boundedString(options.providerModelRevision, 512)
  ) {
    throw new BroadcastTranscriptVisualInspectionRunnerError(
      "INVALID_CONFIGURATION",
      "The visual inspection runner limits or provider model revision are invalid.",
      options.checkpoint,
      null,
    );
  }

  const confirmedUnknownOperationIds = new Set(
    options.confirmedOutcomeUnknownOperationIds ?? [],
  );
  if (
    confirmedUnknownOperationIds.size !==
      (options.confirmedOutcomeUnknownOperationIds ?? []).length ||
    [...confirmedUnknownOperationIds].some(
      (operationId) => !boundedString(operationId, 256),
    )
  ) {
    throw new BroadcastTranscriptVisualInspectionRunnerError(
      "INVALID_CONFIGURATION",
      "Outcome-unknown confirmations must be unique exact operation IDs.",
      options.checkpoint,
      null,
    );
  }

  let checkpoint = options.checkpoint;
  const statistics: MutableRunnerStatistics = {
    resumedPreparedFrameCount: checkpoint.preparedFrameReceipts.length,
    preparedFrameCount: 0,
    recoveredDispatchCount: 0,
    providerBatchExecutionCount: 0,
    providerCellExecutionCount: 0,
    automaticRetryCount: 0,
    confirmedOutcomeUnknownRetryCount: 0,
    persistedTransitionCount: 0,
  };

  const persist = async (
    attempted: BroadcastTranscriptVisualInspectionRunnerCheckpoint,
    cause: BroadcastTranscriptVisualInspectionPersistCause,
    cellIds: readonly string[],
  ): Promise<void> => {
    const exactAttemptedJson = JSON.stringify(attempted);
    const transition: BroadcastTranscriptVisualInspectionPersistTransition = {
      cause,
      previousRevision: checkpoint.revision,
      resultingRevision: attempted.revision,
      cellIds,
    };
    let readback: BroadcastTranscriptVisualInspectionRunnerCheckpoint;
    try {
      readback = await options.persistAndReadback(attempted, transition);
    } catch (error) {
      throw new BroadcastTranscriptVisualInspectionRunnerError(
        "PERSISTENCE_FAILED",
        "The visual inspection checkpoint write/readback failed.",
        checkpoint,
        attempted,
        error,
      );
    }
    try {
      validateCheckpoint(readback, options.plan);
    } catch (error) {
      throw new BroadcastTranscriptVisualInspectionRunnerError(
        "PERSISTENCE_READBACK_MISMATCH",
        "The visual inspection checkpoint readback is invalid.",
        checkpoint,
        attempted,
        error,
      );
    }
    if (JSON.stringify(readback) !== exactAttemptedJson) {
      throw new BroadcastTranscriptVisualInspectionRunnerError(
        "PERSISTENCE_READBACK_MISMATCH",
        "The visual inspection checkpoint readback does not exactly match the attempted write.",
        checkpoint,
        attempted,
      );
    }
    checkpoint = readback;
    statistics.persistedTransitionCount += 1;
  };

  const receiptFor = (
    cellId: string,
  ): BroadcastTranscriptVisualPreparedFrameReceipt => {
    const receipt = checkpoint.preparedFrameReceipts.find(
      (candidate) => candidate.cellId === cellId,
    );
    if (receipt === undefined) {
      throw new BroadcastTranscriptVisualInspectionRunnerError(
        "INVALID_CHECKPOINT",
        "A provider operation lost its durable prepared-frame receipt.",
        checkpoint,
        null,
      );
    }
    return receipt;
  };

  const commitSettlement = async (
    settlement: BroadcastTranscriptVisualProviderSettlement,
    cause:
      | "provider-settled"
      | "recovered-dispatch-sealed",
  ): Promise<void> => {
    const dispatch = checkpoint.activeProviderDispatches.find(
      ({ cellId }) => cellId === settlement.cellId,
    );
    if (
      dispatch === undefined ||
      dispatch.operationId !== settlement.operationId ||
      dispatch.attemptOrdinal !== settlement.attemptOrdinal
    ) {
      throw new BroadcastTranscriptVisualInspectionRunnerError(
        "INVALID_CHECKPOINT",
        "A provider settlement does not match the durably armed dispatch.",
        checkpoint,
        null,
      );
    }
    const providerLedger =
      recordBroadcastTranscriptVisualProviderSettlement(
        checkpoint.providerLedger,
        options.plan,
        settlement,
        {
          allowOutcomeUnknownReplacement:
            dispatch.replacesOutcomeUnknown,
        },
      );
    const attempted = checkpointWith(checkpoint, options.plan, {
      providerLedger,
      activeProviderDispatches:
        checkpoint.activeProviderDispatches.filter(
          ({ cellId }) => cellId !== settlement.cellId,
        ),
    });
    await persist(attempted, cause, [settlement.cellId]);
  };

  // A recovered armed request may already have reached the provider. Seal it
  // before any new call; re-execution now requires exact editor confirmation.
  for (const dispatch of [...checkpoint.activeProviderDispatches]) {
    const settlement = createBroadcastTranscriptVisualProviderSettlement({
      plan: options.plan,
      cellId: dispatch.cellId,
      preparedFrameReceipt: receiptFor(dispatch.cellId),
      providerModelRevision: dispatch.providerModelRevision,
      operationId: dispatch.operationId,
      attemptOrdinal: dispatch.attemptOrdinal,
      outcome: "outcome-unknown",
      failureReason: "operation-interrupted",
    });
    await commitSettlement(settlement, "recovered-dispatch-sealed");
    statistics.recoveredDispatchCount += 1;
  }

  if (signalIsAborted(options.signal)) {
    throw new BroadcastTranscriptVisualInspectionRunnerError(
      "INTERRUPTED",
      "The visual inspection run was interrupted before frame preparation.",
      checkpoint,
      null,
    );
  }

  const frameQueue =
    createBroadcastTranscriptVisualFramePreparationQueue(options.plan);
  const preparedCellIds = new Set(
    checkpoint.preparedFrameReceipts.map(({ cellId }) => cellId),
  );
  const missingFrameTasks = frameQueue.tasks.filter(
    ({ cellId }) => !preparedCellIds.has(cellId),
  );
  const framePreparationFailures: BroadcastTranscriptVisualFramePreparationFailure[] =
    [];
  const frameTransitionMutex = new AsyncTransitionMutex();
  let nextFrameTaskIndex = 0;
  let fatalFrameError: unknown = null;
  const runFrameWorker = async (): Promise<void> => {
    while (fatalFrameError === null) {
      const taskIndex = nextFrameTaskIndex;
      nextFrameTaskIndex += 1;
      const task = missingFrameTasks[taskIndex];
      if (task === undefined) return;
      if (signalIsAborted(options.signal)) {
        fatalFrameError =
          new BroadcastTranscriptVisualInspectionRunnerError(
            "INTERRUPTED",
            "The visual inspection run was interrupted during frame preparation.",
            checkpoint,
            null,
          );
        return;
      }
      let receipt: BroadcastTranscriptVisualPreparedFrameReceipt;
      try {
        const frameContentFingerprints = await options.prepareFrames({
          planFingerprint: options.plan.planFingerprint,
          sourceFingerprint: options.plan.sourceFence.sourceFingerprint,
          task,
          ...(options.signal === undefined
            ? {}
            : { signal: options.signal }),
        });
        receipt = createBroadcastTranscriptVisualPreparedFrameReceipt({
          plan: options.plan,
          cellId: task.cellId,
          frameContentFingerprints,
        });
      } catch (error) {
        framePreparationFailures.push({
          cellId: task.cellId,
          causeValue: error,
        });
        continue;
      }

      try {
        await frameTransitionMutex.runExclusive(async () => {
          if (fatalFrameError !== null) return;
          const alreadyPersisted =
            checkpoint.preparedFrameReceipts.some(
              ({ cellId }) => cellId === receipt.cellId,
            );
          if (alreadyPersisted) return;
          const attempted = checkpointWith(checkpoint, options.plan, {
            preparedFrameReceipts: [
              ...checkpoint.preparedFrameReceipts,
              receipt,
            ],
          });
          await persist(attempted, "frame-prepared", [receipt.cellId]);
          statistics.preparedFrameCount += 1;
        });
      } catch (error) {
        fatalFrameError = error;
      }
    }
  };
  await Promise.all(
    Array.from(
      {
        length: Math.min(
          maximumFrameConcurrency,
          missingFrameTasks.length,
        ),
      },
      () => runFrameWorker(),
    ),
  );
  if (fatalFrameError !== null) {
    if (fatalFrameError instanceof Error) throw fatalFrameError;
    throw new BroadcastTranscriptVisualInspectionRunnerError(
      "INVALID_CHECKPOINT",
      "Frame preparation stopped with an invalid fatal error value.",
      checkpoint,
      null,
      fatalFrameError,
    );
  }

  const providerQueue = createBroadcastTranscriptVisualProviderBatchQueue({
    plan: options.plan,
    framePreparationQueue: frameQueue,
    preparedFrameReceipts: checkpoint.preparedFrameReceipts,
    maximumBatchSize: maximumProviderBatchSize,
  });
  const providerTasks = providerQueue.batches.flatMap(({ tasks }) => tasks);
  const consumedUnknownConfirmations = new Set<string>();

  while (true) {
    if (signalIsAborted(options.signal)) {
      if (statistics.providerBatchExecutionCount > 0) break;
      throw new BroadcastTranscriptVisualInspectionRunnerError(
        "INTERRUPTED",
        "The visual inspection run was interrupted before provider dispatch.",
        checkpoint,
        null,
      );
    }

    const eligible = providerTasks
      .map((task) => {
        const previous = providerSettlementForCell(
          checkpoint.providerLedger,
          task.cellId,
        );
        if (
          previous?.outcome === "completed" ||
          previous?.outcome === "excluded-music-only"
        ) {
          return null;
        }
        if (
          previous?.outcome === "outcome-unknown" &&
          (!confirmedUnknownOperationIds.has(previous.operationId) ||
            consumedUnknownConfirmations.has(previous.operationId))
        ) {
          return null;
        }
        const attemptOrdinal =
          previous === undefined ? 0 : previous.attemptOrdinal + 1;
        if (attemptOrdinal >= maximumProviderAttemptCount) return null;
        return {
          task,
          previous,
          attemptOrdinal,
        };
      })
      .filter(
        (
          value,
        ): value is {
          readonly task: BroadcastTranscriptVisualProviderTask;
          readonly previous:
            | BroadcastTranscriptVisualProviderSettlement
            | undefined;
          readonly attemptOrdinal: number;
        } => value !== null,
      );
    if (eligible.length === 0) break;

    const batch = eligible.slice(0, maximumProviderBatchSize);
    const usedOperationIds = [
      ...checkpoint.providerLedger.settlements.map(
        ({ operationId }) => operationId,
      ),
    ];
    const requests: BroadcastTranscriptVisualProviderAttemptRequest[] = [];
    const dispatches: BroadcastTranscriptVisualProviderDispatchIntent[] = [];
    for (const entry of batch) {
      let operationId: string;
      try {
        operationId = await options.createProviderOperationId({
          planFingerprint: options.plan.planFingerprint,
          sourceFingerprint: options.plan.sourceFence.sourceFingerprint,
          cellId: entry.task.cellId,
          attemptOrdinal: entry.attemptOrdinal,
          usedOperationIds: [...usedOperationIds],
        });
      } catch (error) {
        throw new BroadcastTranscriptVisualInspectionRunnerError(
          "OPERATION_ID_FAILED",
          "A fresh provider operation ID could not be created.",
          checkpoint,
          null,
          error,
        );
      }
      if (
        !boundedString(operationId, 256) ||
        usedOperationIds.includes(operationId)
      ) {
        throw new BroadcastTranscriptVisualInspectionRunnerError(
          "OPERATION_ID_FAILED",
          "A provider operation ID is invalid or already used.",
          checkpoint,
          null,
          operationId,
        );
      }
      usedOperationIds.push(operationId);
      const request: BroadcastTranscriptVisualProviderAttemptRequest = {
        planFingerprint: options.plan.planFingerprint,
        sourceFingerprint: options.plan.sourceFence.sourceFingerprint,
        task: entry.task,
        providerModelRevision: options.providerModelRevision,
        operationId,
        attemptOrdinal: entry.attemptOrdinal,
      };
      requests.push(request);
      dispatches.push({
        cellId: entry.task.cellId,
        operationId,
        attemptOrdinal: entry.attemptOrdinal,
        providerModelRevision: options.providerModelRevision,
        frameBundleKey: entry.task.frameBundleKey,
        requestedFrameContentFingerprints:
          entry.task.frameContentFingerprints,
        replacesOutcomeUnknown:
          entry.previous?.outcome === "outcome-unknown",
      });
      if (entry.previous?.outcome === "retryable") {
        statistics.automaticRetryCount += 1;
      } else if (entry.previous?.outcome === "outcome-unknown") {
        consumedUnknownConfirmations.add(entry.previous.operationId);
        statistics.confirmedOutcomeUnknownRetryCount += 1;
      }
    }

    const armedCheckpoint = checkpointWith(checkpoint, options.plan, {
      activeProviderDispatches: dispatches,
    });
    await persist(
      armedCheckpoint,
      "provider-dispatch-armed",
      dispatches.map(({ cellId }) => cellId),
    );

    statistics.providerBatchExecutionCount += 1;
    statistics.providerCellExecutionCount += requests.length;
    let adapterResults:
      | readonly BroadcastTranscriptVisualProviderAdapterResult[]
      | null;
    try {
      const returned = await options.executeProviderBatch(
        requests,
        options.signal,
      );
      adapterResults = validatedProviderResults(requests, returned);
    } catch (providerError) {
      let classification: BroadcastTranscriptVisualProviderFailureClassification;
      if (signalIsAborted(options.signal)) {
        classification = {
          outcome: "outcome-unknown",
          failureReason: "operation-interrupted",
        };
      } else {
        try {
          classification = await options.classifyProviderFailure(
            providerError,
            requests,
          );
        } catch (classificationError) {
          classification = {
            outcome: "outcome-unknown",
            failureReason: "operation-interrupted",
          };
          for (const request of requests) {
            const unknownSettlement =
              providerAdapterResultToSettlement({
                result: syntheticFailureResult(
                  request,
                  classification,
                ),
                request,
                plan: options.plan,
                receipt: receiptFor(request.task.cellId),
              });
            await commitSettlement(
              unknownSettlement,
              "provider-settled",
            );
          }
          throw new BroadcastTranscriptVisualInspectionRunnerError(
            "PROVIDER_FAILURE_CLASSIFICATION_FAILED",
            "The provider failure could not be classified; every armed operation was sealed as outcome-unknown.",
            checkpoint,
            null,
            classificationError,
          );
        }
        if (!validProviderFailureClassification(classification)) {
          classification = {
            outcome: "outcome-unknown",
            failureReason: "operation-interrupted",
          };
        }
      }
      adapterResults = requests.map((request) =>
        syntheticFailureResult(request, classification),
      );
    }

    if (adapterResults === null) {
      const classification: BroadcastTranscriptVisualProviderFailureClassification =
        {
          outcome: "outcome-unknown",
          failureReason: "operation-interrupted",
        };
      adapterResults = requests.map((request) =>
        syntheticFailureResult(request, classification),
      );
    }

    for (const [index, request] of requests.entries()) {
      const result = adapterResults[index];
      if (result === undefined) {
        throw new BroadcastTranscriptVisualInspectionRunnerError(
          "INVALID_CHECKPOINT",
          "A normalized provider batch result unexpectedly lost a cell.",
          checkpoint,
          null,
        );
      }
      let settlement: BroadcastTranscriptVisualProviderSettlement;
      try {
        settlement = providerAdapterResultToSettlement({
          result,
          request,
          plan: options.plan,
          receipt: receiptFor(request.task.cellId),
        });
      } catch {
        settlement = createBroadcastTranscriptVisualProviderSettlement({
          plan: options.plan,
          cellId: request.task.cellId,
          preparedFrameReceipt: receiptFor(request.task.cellId),
          providerModelRevision: request.providerModelRevision,
          operationId: request.operationId,
          attemptOrdinal: request.attemptOrdinal,
          outcome: "outcome-unknown",
          failureReason: "operation-interrupted",
        });
      }
      await commitSettlement(settlement, "provider-settled");
    }
  }

  return buildResult(
    checkpoint,
    options.plan,
    framePreparationFailures.sort((left, right) => {
      const ordinalByCellId = cellOrdinalMap(options.plan);
      return (
        (ordinalByCellId.get(left.cellId) ?? Number.MAX_SAFE_INTEGER) -
        (ordinalByCellId.get(right.cellId) ?? Number.MAX_SAFE_INTEGER)
      );
    }),
    statistics,
  );
}
