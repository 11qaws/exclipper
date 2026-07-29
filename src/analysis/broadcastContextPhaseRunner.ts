import {
  BROADCAST_CONTEXT_PHASE_LEDGER_PHASES,
  broadcastContextPhaseLedgerCanComplete,
  normalizeBroadcastContextPhaseLedger,
  reduceBroadcastContextPhaseLedger,
  summarizeBroadcastContextPhaseLedger,
} from "./broadcastContextPhaseLedger";
import type {
  BroadcastContextPhaseLedger,
  BroadcastContextPhaseLedgerEvent,
  BroadcastContextPhaseLedgerJsonValue,
  BroadcastContextPhaseLedgerModelReceipt,
  BroadcastContextPhaseLedgerRejectionReason,
  BroadcastContextPhaseLedgerStatus,
  BroadcastContextPhaseLedgerSummary,
  BroadcastContextPhaseLedgerUnit,
  BroadcastContextPhaseLedgerUnitIdentity,
} from "./broadcastContextPhaseLedger";

export const DEFAULT_BROADCAST_CONTEXT_PHASE_RUNNER_EXECUTIONS_PER_INVOCATION =
  3;
export const MAX_BROADCAST_CONTEXT_PHASE_RUNNER_EXECUTIONS_PER_INVOCATION = 8;
export const DEFAULT_BROADCAST_CONTEXT_PHASE_RUNNER_CONCURRENCY = 1;
export const MAX_BROADCAST_CONTEXT_PHASE_RUNNER_CONCURRENCY = 8;

export const BROADCAST_CONTEXT_RECONCILIATION_UNRESOLVED_REASON =
  "runner_reconciliation_outcome_unresolved";
export const BROADCAST_CONTEXT_INVALID_RECONCILIATION_RESULT_REASON =
  "runner_invalid_reconciliation_result";
export const BROADCAST_CONTEXT_INVALID_EXECUTION_RESULT_REASON =
  "runner_invalid_execution_result";
export const BROADCAST_CONTEXT_FAILURE_CLASSIFICATION_REASON =
  "runner_failure_classification_failed";

export interface BroadcastContextPhaseExecutionResult {
  readonly result?: BroadcastContextPhaseLedgerJsonValue;
  readonly modelReceipt?: BroadcastContextPhaseLedgerModelReceipt;
}

export type BroadcastContextPhaseReconciliationResult =
  | {
      readonly disposition: "succeeded";
      readonly operationId: string;
      readonly inputDigest: string;
      readonly result: BroadcastContextPhaseLedgerJsonValue;
      readonly modelReceipt?: BroadcastContextPhaseLedgerModelReceipt;
    }
  | {
      readonly disposition: "not-dispatched";
      readonly operationId: string;
      readonly inputDigest: string;
      readonly reasonCode: string;
      readonly modelReceipt?: BroadcastContextPhaseLedgerModelReceipt;
    }
  | {
      readonly disposition: "unresolved";
      readonly operationId: string;
      readonly inputDigest: string;
      readonly reasonCode: string;
      readonly modelReceipt?: BroadcastContextPhaseLedgerModelReceipt;
    };

export type BroadcastContextPhaseFailureClassification =
  | {
      readonly disposition: "retryable-gap";
      readonly reasonCode: string;
      readonly modelReceipt?: BroadcastContextPhaseLedgerModelReceipt;
    }
  | {
      readonly disposition: "outcome-unknown";
      readonly reasonCode: string;
      readonly modelReceipt?: BroadcastContextPhaseLedgerModelReceipt;
    }
  | {
      readonly disposition: "failed";
      readonly reasonCode: string;
      readonly modelReceipt?: BroadcastContextPhaseLedgerModelReceipt;
    };

export interface BroadcastContextPhaseRetryOperationRequest {
  readonly identity: BroadcastContextPhaseLedgerUnitIdentity;
  readonly nextAttemptOrdinal: number;
  readonly usedOperationIds: readonly string[];
}

export type BroadcastContextPhasePersistCause =
  | "reconciliation-started"
  | "reconciliation-succeeded"
  | "reconciliation-not-dispatched"
  | "reconciliation-unresolved"
  | "retry-planned"
  | "execution-started"
  | "execution-succeeded"
  | "execution-failed";

export interface BroadcastContextPhasePersistedTransition {
  readonly cause: BroadcastContextPhasePersistCause;
  readonly eventType: BroadcastContextPhaseLedgerEvent["type"];
  readonly phase: BroadcastContextPhaseLedgerUnit["phase"];
  readonly unitId: string;
  readonly previousStatus: BroadcastContextPhaseLedgerStatus;
  readonly resultingStatus: BroadcastContextPhaseLedgerStatus;
  readonly previousOperationId: string;
  readonly resultingOperationId: string;
  readonly previousAttemptOrdinal: number;
  readonly resultingAttemptOrdinal: number;
}

export interface RunBroadcastContextPhaseLedgerOptions {
  readonly ledger: BroadcastContextPhaseLedger;
  /**
   * Fresh provider executions allowed for one logical unit in this invocation.
   * There is intentionally no lifetime attempt ceiling: a caller may start a
   * later invocation after a durable checkpoint and capped backoff.
   */
  readonly maximumExecutionsPerInvocation?: number;
  readonly maximumConcurrency?: number;
  /**
   * Reconciles only the exact already-persisted operation. Implementations may
   * query a coordinator cache or replay the same operation/lease transport,
   * but must never allocate a new operation ID.
   */
  readonly reconcile: (
    identity: BroadcastContextPhaseLedgerUnitIdentity,
  ) => Promise<BroadcastContextPhaseReconciliationResult>;
  readonly execute: (
    identity: BroadcastContextPhaseLedgerUnitIdentity,
  ) => Promise<BroadcastContextPhaseExecutionResult | void>;
  readonly classifyFailure: (
    error: unknown,
    identity: BroadcastContextPhaseLedgerUnitIdentity,
  ) =>
    | BroadcastContextPhaseFailureClassification
    | Promise<BroadcastContextPhaseFailureClassification>;
  readonly createRetryOperationId: (
    request: BroadcastContextPhaseRetryOperationRequest,
  ) => string | Promise<string>;
  readonly persist: (
    ledger: BroadcastContextPhaseLedger,
    transition: BroadcastContextPhasePersistedTransition,
  ) => Promise<void>;
}

export type BroadcastContextPhaseRunnerErrorCode =
  | "INVALID_LEDGER"
  | "INVALID_ATTEMPT_LIMIT"
  | "INVALID_CONCURRENCY"
  | "TRANSITION_REJECTED"
  | "PERSISTENCE_FAILED"
  | "RETRY_OPERATION_ID_FAILED"
  | "INVALID_EXECUTION_RESULT"
  | "CLASSIFICATION_FAILED";

export class BroadcastContextPhaseRunnerError extends Error {
  public readonly name = "BroadcastContextPhaseRunnerError";

  public constructor(
    public readonly code: BroadcastContextPhaseRunnerErrorCode,
    message: string,
    public readonly lastPersistedLedger: BroadcastContextPhaseLedger | null,
    public readonly attemptedLedger: BroadcastContextPhaseLedger | null,
    public readonly identity: BroadcastContextPhaseLedgerUnitIdentity | null,
    public readonly transitionRejection:
      | BroadcastContextPhaseLedgerRejectionReason
      | null,
    public readonly causeValue: unknown = null,
  ) {
    super(message);
  }
}

export interface BroadcastContextPhaseRunnerBlockingUnit {
  readonly phase: BroadcastContextPhaseLedgerUnit["phase"];
  readonly unitId: string;
  readonly status: Exclude<BroadcastContextPhaseLedgerStatus, "succeeded">;
  readonly operationId: string;
  readonly attemptOrdinal: number;
  readonly reasonCode: string | null;
}

export interface BroadcastContextPhaseRecoveryAction {
  readonly kind: "reconcile-current-operation";
  readonly phase: BroadcastContextPhaseLedgerUnit["phase"];
  readonly unitId: string;
  readonly inputDigest: string;
  readonly operationId: string;
  readonly attemptOrdinal: number;
  readonly maximumReconciliationsPerInvocation: 1;
}

export interface BroadcastContextPhaseRunnerStatistics {
  readonly providerExecutionCount: number;
  readonly reconciliationExecutionCount: number;
  readonly reconciliationSucceededCount: number;
  readonly reconciliationNotDispatchedCount: number;
  readonly reconciliationUnresolvedCount: number;
  readonly resumedSucceededCount: number;
  readonly recoveredInFlightCount: number;
  readonly plannedRetryCount: number;
  readonly persistedTransitionCount: number;
}

export type BroadcastContextPhaseRunnerBlockedStatus =
  | "blocked-retryable-gap"
  | "blocked-outcome-unknown"
  | "blocked-reconciling"
  | "blocked-invocation-budget"
  | "blocked-failed"
  | "blocked-mixed";

interface BroadcastContextPhaseRunnerResultBase {
  readonly ledger: BroadcastContextPhaseLedger;
  readonly summary: BroadcastContextPhaseLedgerSummary;
  readonly statistics: BroadcastContextPhaseRunnerStatistics;
  readonly recoveryActions: readonly BroadcastContextPhaseRecoveryAction[];
}

export type BroadcastContextPhaseRunnerResult =
  | (BroadcastContextPhaseRunnerResultBase & {
      readonly status: "completed";
      readonly complete: true;
      readonly blockingUnits: readonly [];
    })
  | (BroadcastContextPhaseRunnerResultBase & {
      readonly status: BroadcastContextPhaseRunnerBlockedStatus;
      readonly complete: false;
      readonly blockingUnits: readonly BroadcastContextPhaseRunnerBlockingUnit[];
    });

interface MutableRunnerStatistics {
  providerExecutionCount: number;
  reconciliationExecutionCount: number;
  reconciliationSucceededCount: number;
  reconciliationNotDispatchedCount: number;
  reconciliationUnresolvedCount: number;
  resumedSucceededCount: number;
  recoveredInFlightCount: number;
  plannedRetryCount: number;
  persistedTransitionCount: number;
}

interface BroadcastContextPhaseUnitKey {
  readonly phase: BroadcastContextPhaseLedgerUnit["phase"];
  readonly unitId: string;
}

type BroadcastContextPhaseUnitStep =
  | { readonly kind: "stop" }
  | { readonly kind: "continue" }
  | {
      readonly kind: "execute";
      readonly identity: BroadcastContextPhaseLedgerUnitIdentity;
    };

class BroadcastContextPhaseTransitionMutex {
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function unitIdentity(
  ledger: BroadcastContextPhaseLedger,
  unit: BroadcastContextPhaseLedgerUnit,
): BroadcastContextPhaseLedgerUnitIdentity {
  return Object.freeze({
    fence: ledger.fence,
    phase: unit.phase,
    unitId: unit.unitId,
    inputDigest: unit.inputDigest,
    operationId: unit.operationId,
    attemptOrdinal: unit.attemptOrdinal,
  });
}

function findUnit(
  ledger: BroadcastContextPhaseLedger,
  phase: BroadcastContextPhaseLedgerUnit["phase"],
  unitId: string,
): BroadcastContextPhaseLedgerUnit {
  const unit = ledger.units.find(
    (candidate) =>
      candidate.phase === phase && candidate.unitId === unitId,
  );
  if (unit === undefined) {
    throw new BroadcastContextPhaseRunnerError(
      "TRANSITION_REJECTED",
      "The durable context unit disappeared while the runner was active.",
      ledger,
      null,
      null,
      "unit_not_found",
    );
  }
  return unit;
}

function transitionMetadata(
  cause: BroadcastContextPhasePersistCause,
  event: BroadcastContextPhaseLedgerEvent,
  previousUnit: BroadcastContextPhaseLedgerUnit,
  resultingUnit: BroadcastContextPhaseLedgerUnit,
): BroadcastContextPhasePersistedTransition {
  return Object.freeze({
    cause,
    eventType: event.type,
    phase: previousUnit.phase,
    unitId: previousUnit.unitId,
    previousStatus: previousUnit.status,
    resultingStatus: resultingUnit.status,
    previousOperationId: previousUnit.operationId,
    resultingOperationId: resultingUnit.operationId,
    previousAttemptOrdinal: previousUnit.attemptOrdinal,
    resultingAttemptOrdinal: resultingUnit.attemptOrdinal,
  });
}

async function applyAndPersistTransition(
  ledger: BroadcastContextPhaseLedger,
  event: BroadcastContextPhaseLedgerEvent,
  cause: BroadcastContextPhasePersistCause,
  persist: RunBroadcastContextPhaseLedgerOptions["persist"],
  statistics: MutableRunnerStatistics,
  rejectionCode: BroadcastContextPhaseRunnerErrorCode = "TRANSITION_REJECTED",
): Promise<BroadcastContextPhaseLedger> {
  const previousUnit = findUnit(ledger, event.phase, event.unitId);
  const outcome = reduceBroadcastContextPhaseLedger(ledger, event);
  if (!outcome.accepted) {
    throw new BroadcastContextPhaseRunnerError(
      rejectionCode,
      `The durable context transition ${event.type} was rejected.`,
      ledger,
      null,
      unitIdentity(ledger, previousUnit),
      outcome.reason,
    );
  }
  const resultingUnit = findUnit(
    outcome.ledger,
    event.phase,
    event.unitId,
  );
  const metadata = transitionMetadata(
    cause,
    event,
    previousUnit,
    resultingUnit,
  );
  try {
    await persist(outcome.ledger, metadata);
  } catch (error) {
    throw new BroadcastContextPhaseRunnerError(
      "PERSISTENCE_FAILED",
      `The durable context transition ${event.type} could not be persisted.`,
      ledger,
      outcome.ledger,
      unitIdentity(ledger, previousUnit),
      null,
      error,
    );
  }
  statistics.persistedTransitionCount += 1;
  return outcome.ledger;
}

async function sealOutcomeUnknown(
  ledger: BroadcastContextPhaseLedger,
  identity: BroadcastContextPhaseLedgerUnitIdentity,
  reasonCode: string,
  cause: BroadcastContextPhasePersistCause,
  options: RunBroadcastContextPhaseLedgerOptions,
  statistics: MutableRunnerStatistics,
): Promise<BroadcastContextPhaseLedger> {
  return applyAndPersistTransition(
    ledger,
    {
      type: "UNIT_OUTCOME_UNKNOWN",
      ...identity,
      reasonCode,
    },
    cause,
    options.persist,
    statistics,
  );
}

function executionSuccessEvent(
  result: BroadcastContextPhaseExecutionResult | void,
  identity: BroadcastContextPhaseLedgerUnitIdentity,
): BroadcastContextPhaseLedgerEvent | null {
  if (result === undefined) {
    return { type: "UNIT_SUCCEEDED", ...identity };
  }
  if (
    !isPlainRecord(result) ||
    Object.keys(result).some(
      (key) => key !== "result" && key !== "modelReceipt",
    )
  ) {
    return null;
  }
  return {
    type: "UNIT_SUCCEEDED",
    ...identity,
    ...(Object.hasOwn(result, "result") ? { result: result.result } : {}),
    ...(Object.hasOwn(result, "modelReceipt")
      ? { modelReceipt: result.modelReceipt }
      : {}),
  };
}

function classifiedFailureEvent(
  classification: unknown,
  identity: BroadcastContextPhaseLedgerUnitIdentity,
): BroadcastContextPhaseLedgerEvent | null {
  if (
    !isPlainRecord(classification) ||
    (classification.disposition !== "retryable-gap" &&
      classification.disposition !== "outcome-unknown" &&
      classification.disposition !== "failed") ||
    typeof classification.reasonCode !== "string" ||
    Object.keys(classification).some(
      (key) =>
        key !== "disposition" &&
        key !== "reasonCode" &&
        key !== "modelReceipt",
    )
  ) {
    return null;
  }
  return {
    type:
      classification.disposition === "retryable-gap"
        ? "UNIT_RETRYABLE_GAP"
        : classification.disposition === "failed"
          ? "UNIT_FAILED"
          : "UNIT_OUTCOME_UNKNOWN",
    ...identity,
    reasonCode: classification.reasonCode,
    ...(Object.hasOwn(classification, "modelReceipt")
      ? { modelReceipt: classification.modelReceipt }
      : {}),
  };
}

function reconciliationSettlementEvent(
  value: unknown,
  identity: BroadcastContextPhaseLedgerUnitIdentity,
): BroadcastContextPhaseLedgerEvent {
  const unresolved = (
    reasonCode: string,
  ): BroadcastContextPhaseLedgerEvent => ({
    type: "UNIT_RECONCILIATION_UNRESOLVED",
    ...identity,
    reasonCode,
  });
  if (
    !isPlainRecord(value) ||
    value.operationId !== identity.operationId ||
    value.inputDigest !== identity.inputDigest ||
    (value.disposition !== "succeeded" &&
      value.disposition !== "not-dispatched" &&
      value.disposition !== "unresolved")
  ) {
    return unresolved(
      BROADCAST_CONTEXT_INVALID_RECONCILIATION_RESULT_REASON,
    );
  }
  const optionalReceipt =
    Object.hasOwn(value, "modelReceipt")
      ? { modelReceipt: value.modelReceipt }
      : {};
  if (value.disposition === "succeeded") {
    if (
      !Object.hasOwn(value, "result") ||
      Object.keys(value).some(
        (key) =>
          key !== "disposition" &&
          key !== "operationId" &&
          key !== "inputDigest" &&
          key !== "result" &&
          key !== "modelReceipt",
      )
    ) {
      return unresolved(
        BROADCAST_CONTEXT_INVALID_RECONCILIATION_RESULT_REASON,
      );
    }
    return {
      type: "UNIT_RECONCILIATION_SUCCEEDED",
      ...identity,
      result: value.result,
      ...optionalReceipt,
    };
  }
  if (
    typeof value.reasonCode !== "string" ||
    value.reasonCode.length === 0 ||
    Object.keys(value).some(
      (key) =>
        key !== "disposition" &&
        key !== "operationId" &&
        key !== "inputDigest" &&
        key !== "reasonCode" &&
        key !== "modelReceipt",
    )
  ) {
    return unresolved(
      BROADCAST_CONTEXT_INVALID_RECONCILIATION_RESULT_REASON,
    );
  }
  return {
    type:
      value.disposition === "not-dispatched"
        ? "UNIT_RECONCILIATION_NOT_DISPATCHED"
        : "UNIT_RECONCILIATION_UNRESOLVED",
    ...identity,
    reasonCode: value.reasonCode,
    ...optionalReceipt,
  };
}

function blockingUnit(
  unit: Exclude<
    BroadcastContextPhaseLedgerUnit,
    { readonly status: "succeeded" }
  >,
): BroadcastContextPhaseRunnerBlockingUnit {
  return Object.freeze({
    phase: unit.phase,
    unitId: unit.unitId,
    status: unit.status,
    operationId: unit.operationId,
    attemptOrdinal: unit.attemptOrdinal,
    reasonCode:
      unit.status === "retryable-gap" ||
        unit.status === "outcome-unknown" ||
        unit.status === "failed"
        ? unit.reasonCode
        : null,
  });
}

function blockedStatus(
  blockingUnits: readonly BroadcastContextPhaseRunnerBlockingUnit[],
): BroadcastContextPhaseRunnerBlockedStatus {
  const statuses = new Set(blockingUnits.map(({ status }) => status));
  if (statuses.size === 1 && statuses.has("retryable-gap")) {
    return "blocked-retryable-gap";
  }
  if (statuses.size === 1 && statuses.has("outcome-unknown")) {
    return "blocked-outcome-unknown";
  }
  if (statuses.size === 1 && statuses.has("reconciling")) {
    return "blocked-reconciling";
  }
  if (statuses.size === 1 && statuses.has("failed")) {
    return "blocked-failed";
  }
  if (statuses.size === 1 && statuses.has("pending")) {
    return "blocked-invocation-budget";
  }
  return "blocked-mixed";
}

function frozenStatistics(
  statistics: MutableRunnerStatistics,
): BroadcastContextPhaseRunnerStatistics {
  return Object.freeze({ ...statistics });
}

function buildResult(
  ledger: BroadcastContextPhaseLedger,
  statistics: MutableRunnerStatistics,
): BroadcastContextPhaseRunnerResult {
  const summary = summarizeBroadcastContextPhaseLedger(ledger);
  const recoveryActions = Object.freeze(
    ledger.units
      .filter(
        ({ status }) =>
          status === "outcome-unknown" || status === "reconciling",
      )
      .map(
        (unit): BroadcastContextPhaseRecoveryAction =>
          Object.freeze({
            kind: "reconcile-current-operation",
            phase: unit.phase,
            unitId: unit.unitId,
            inputDigest: unit.inputDigest,
            operationId: unit.operationId,
            attemptOrdinal: unit.attemptOrdinal,
            maximumReconciliationsPerInvocation: 1,
          }),
      ),
  );
  if (broadcastContextPhaseLedgerCanComplete(ledger)) {
    return Object.freeze({
      status: "completed",
      complete: true,
      ledger,
      summary,
      statistics: frozenStatistics(statistics),
      recoveryActions,
      blockingUnits: Object.freeze([] as const),
    });
  }
  const blockingUnits = Object.freeze(
    ledger.units
      .filter(
        (
          unit,
        ): unit is Exclude<
          BroadcastContextPhaseLedgerUnit,
          { readonly status: "succeeded" }
        > => unit.required && unit.status !== "succeeded",
      )
      .map(blockingUnit),
  );
  return Object.freeze({
    status: blockedStatus(blockingUnits),
    complete: false,
    ledger,
    summary,
    statistics: frozenStatistics(statistics),
    recoveryActions,
    blockingUnits,
  });
}

async function runWithMaximumConcurrency(
  unitKeys: readonly BroadcastContextPhaseUnitKey[],
  maximumConcurrency: number,
  runUnit: (
    unitKey: BroadcastContextPhaseUnitKey,
    stopRequested: () => boolean,
  ) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  let hasError = false;
  let firstError: unknown = null;
  const workerCount = Math.min(maximumConcurrency, unitKeys.length);

  const worker = async (): Promise<void> => {
    while (!hasError) {
      const index = cursor;
      cursor += 1;
      const unitKey = unitKeys[index];
      if (unitKey === undefined) return;
      try {
        await runUnit(unitKey, () => hasError);
      } catch (error) {
        if (!hasError) {
          hasError = true;
          firstError = error;
        }
      }
    }
  };

  await Promise.all(
    Array.from({ length: workerCount }, () => worker()),
  );
  if (hasError) throw firstError;
}

async function reconcileRecoveredUnits(
  ledger: BroadcastContextPhaseLedger,
  options: RunBroadcastContextPhaseLedgerOptions,
  statistics: MutableRunnerStatistics,
  transitionMutex: BroadcastContextPhaseTransitionMutex,
  maximumConcurrency: number,
): Promise<BroadcastContextPhaseLedger> {
  let current = ledger;
  const unitKeys = ledger.units
    .filter(
      ({ status }) =>
        status === "in-flight" ||
        status === "outcome-unknown" ||
        status === "reconciling",
    )
    .map(({ phase, unitId }) => ({ phase, unitId }));

  await runWithMaximumConcurrency(
    unitKeys,
    maximumConcurrency,
    async ({ phase, unitId }, stopRequested) => {
      if (stopRequested()) return;
      const identity =
        await transitionMutex.runExclusive<BroadcastContextPhaseLedgerUnitIdentity | null>(
          async () => {
            if (stopRequested()) return null;
            const unit = findUnit(current, phase, unitId);
            if (
              unit.status !== "in-flight" &&
              unit.status !== "outcome-unknown" &&
              unit.status !== "reconciling"
            ) {
              return null;
            }
            if (unit.status === "in-flight") {
              statistics.recoveredInFlightCount += 1;
            }
            if (unit.status !== "reconciling") {
              const interruptedIdentity = unitIdentity(current, unit);
              current = await applyAndPersistTransition(
                current,
                {
                  type: "UNIT_RECONCILIATION_STARTED",
                  ...interruptedIdentity,
                },
                "reconciliation-started",
                options.persist,
                statistics,
              );
            }
            const reconcilingUnit = findUnit(current, phase, unitId);
            return unitIdentity(current, reconcilingUnit);
          },
        );
      if (identity === null || stopRequested()) return;

      statistics.reconciliationExecutionCount += 1;
      let settlementEvent: BroadcastContextPhaseLedgerEvent;
      try {
        settlementEvent = reconciliationSettlementEvent(
          await options.reconcile(identity),
          identity,
        );
      } catch {
        settlementEvent = {
          type: "UNIT_RECONCILIATION_UNRESOLVED",
          ...identity,
          reasonCode: BROADCAST_CONTEXT_RECONCILIATION_UNRESOLVED_REASON,
        };
      }

      await transitionMutex.runExclusive(async () => {
        const candidate = reduceBroadcastContextPhaseLedger(
          current,
          settlementEvent,
        );
        if (!candidate.accepted) {
          settlementEvent = {
            type: "UNIT_RECONCILIATION_UNRESOLVED",
            ...identity,
            reasonCode:
              BROADCAST_CONTEXT_INVALID_RECONCILIATION_RESULT_REASON,
          };
        }
        const cause: BroadcastContextPhasePersistCause =
          settlementEvent.type === "UNIT_RECONCILIATION_SUCCEEDED"
            ? "reconciliation-succeeded"
            : settlementEvent.type ===
                "UNIT_RECONCILIATION_NOT_DISPATCHED"
              ? "reconciliation-not-dispatched"
              : "reconciliation-unresolved";
        current = await applyAndPersistTransition(
          current,
          settlementEvent,
          cause,
          options.persist,
          statistics,
        );
        if (settlementEvent.type === "UNIT_RECONCILIATION_SUCCEEDED") {
          statistics.reconciliationSucceededCount += 1;
        } else if (
          settlementEvent.type === "UNIT_RECONCILIATION_NOT_DISPATCHED"
        ) {
          statistics.reconciliationNotDispatchedCount += 1;
        } else {
          statistics.reconciliationUnresolvedCount += 1;
        }
      });
    },
  );
  return current;
}

/**
 * Runs every planned context unit as a crash-safe sequence.
 *
 * `in-flight` means a paid request may already have left the browser. A
 * recovered in-flight/outcome-unknown unit first enters durable
 * `reconciling`, then queries or replays only its exact existing operation.
 * A matching terminal result is consumed, proven non-dispatch becomes a
 * retryable gap, and unresolved ambiguity keeps the same operation identity.
 * Only an explicit `retryable-gap` receives a fresh billing identity.
 */
export async function runBroadcastContextPhaseLedger(
  options: RunBroadcastContextPhaseLedgerOptions,
): Promise<BroadcastContextPhaseRunnerResult> {
  const normalized = normalizeBroadcastContextPhaseLedger(options.ledger);
  if (normalized === null) {
    throw new BroadcastContextPhaseRunnerError(
      "INVALID_LEDGER",
      "The context phase ledger is not valid.",
      null,
      null,
      null,
      null,
    );
  }
  const maximumConcurrency =
    options.maximumConcurrency ??
    DEFAULT_BROADCAST_CONTEXT_PHASE_RUNNER_CONCURRENCY;
  if (
    !Number.isSafeInteger(maximumConcurrency) ||
    maximumConcurrency < 1 ||
    maximumConcurrency > MAX_BROADCAST_CONTEXT_PHASE_RUNNER_CONCURRENCY
  ) {
    throw new BroadcastContextPhaseRunnerError(
      "INVALID_CONCURRENCY",
      "The context phase concurrency is outside the supported bounds.",
      normalized,
      null,
      null,
      null,
    );
  }
  const maximumExecutionsPerInvocation =
    options.maximumExecutionsPerInvocation ??
    DEFAULT_BROADCAST_CONTEXT_PHASE_RUNNER_EXECUTIONS_PER_INVOCATION;
  if (
    !Number.isSafeInteger(maximumExecutionsPerInvocation) ||
    maximumExecutionsPerInvocation < 1 ||
    maximumExecutionsPerInvocation >
      MAX_BROADCAST_CONTEXT_PHASE_RUNNER_EXECUTIONS_PER_INVOCATION
  ) {
    throw new BroadcastContextPhaseRunnerError(
      "INVALID_ATTEMPT_LIMIT",
      "The per-invocation context execution limit is outside the supported bounds.",
      normalized,
      null,
      null,
      null,
    );
  }

  const statistics: MutableRunnerStatistics = {
    providerExecutionCount: 0,
    reconciliationExecutionCount: 0,
    reconciliationSucceededCount: 0,
    reconciliationNotDispatchedCount: 0,
    reconciliationUnresolvedCount: 0,
    resumedSucceededCount: normalized.units.filter(
      ({ status }) => status === "succeeded",
    ).length,
    recoveredInFlightCount: 0,
    plannedRetryCount: 0,
    persistedTransitionCount: 0,
  };
  const transitionMutex = new BroadcastContextPhaseTransitionMutex();
  let ledger = await reconcileRecoveredUnits(
    normalized,
    options,
    statistics,
    transitionMutex,
    maximumConcurrency,
  );
  const executionCountByUnit = new Map<string, number>();
  const executionCountFor = (
    phase: BroadcastContextPhaseLedgerUnit["phase"],
    unitId: string,
  ): number => executionCountByUnit.get(`${phase}\u0000${unitId}`) ?? 0;

  const sealAndThrow = (
    executionIdentity: BroadcastContextPhaseLedgerUnitIdentity,
    reasonCode: string,
    errorCode: "INVALID_EXECUTION_RESULT" | "CLASSIFICATION_FAILED",
    message: string,
    causeValue: unknown = null,
  ): Promise<never> =>
    transitionMutex.runExclusive<never>(async () => {
      ledger = await sealOutcomeUnknown(
        ledger,
        executionIdentity,
        reasonCode,
        "execution-failed",
        options,
        statistics,
      );
      throw new BroadcastContextPhaseRunnerError(
        errorCode,
        message,
        ledger,
        null,
        executionIdentity,
        null,
        causeValue,
      );
    });

  const commitTerminalOrSeal = async (
    event: BroadcastContextPhaseLedgerEvent,
    executionIdentity: BroadcastContextPhaseLedgerUnitIdentity,
    success: boolean,
  ): Promise<void> => {
    const terminalError =
      await transitionMutex.runExclusive<BroadcastContextPhaseRunnerError | null>(
        async () => {
          const outcome = reduceBroadcastContextPhaseLedger(ledger, event);
          if (!outcome.accepted) {
            const reasonCode = success
              ? BROADCAST_CONTEXT_INVALID_EXECUTION_RESULT_REASON
              : BROADCAST_CONTEXT_FAILURE_CLASSIFICATION_REASON;
            ledger = await sealOutcomeUnknown(
              ledger,
              executionIdentity,
              reasonCode,
              "execution-failed",
              options,
              statistics,
            );
            return new BroadcastContextPhaseRunnerError(
              success
                ? "INVALID_EXECUTION_RESULT"
                : "CLASSIFICATION_FAILED",
              success
                ? "The context provider returned a result that cannot be stored durably."
                : "The context provider failure could not be classified safely.",
              ledger,
              null,
              executionIdentity,
              outcome.reason,
            );
          }
          ledger = await applyAndPersistTransition(
            ledger,
            event,
            success ? "execution-succeeded" : "execution-failed",
            options.persist,
            statistics,
          );
          return null;
        },
      );
    if (terminalError !== null) throw terminalError;
  };

  const runUnit = async (
    { phase, unitId }: BroadcastContextPhaseUnitKey,
    stopRequested: () => boolean,
  ): Promise<void> => {
    while (!stopRequested()) {
      const step =
        await transitionMutex.runExclusive<BroadcastContextPhaseUnitStep>(
          async () => {
            if (stopRequested()) return { kind: "stop" };
            const unit = findUnit(ledger, phase, unitId);
            if (
              unit.status === "succeeded" ||
              unit.status === "outcome-unknown" ||
              unit.status === "reconciling" ||
              unit.status === "failed"
            ) {
              return { kind: "stop" };
            }
            if (unit.status === "in-flight") {
              throw new BroadcastContextPhaseRunnerError(
                "TRANSITION_REJECTED",
                "An in-flight context unit remained after recovery.",
                ledger,
                null,
                unitIdentity(ledger, unit),
                "undefined_transition",
              );
            }
            if (unit.status === "retryable-gap") {
              if (
                executionCountFor(phase, unitId) >=
                maximumExecutionsPerInvocation
              ) {
                return { kind: "stop" };
              }
              const nextAttemptOrdinal = unit.attemptOrdinal + 1;
              const currentIdentity = unitIdentity(ledger, unit);
              let nextOperationId: string;
              try {
                nextOperationId = await options.createRetryOperationId({
                  identity: currentIdentity,
                  nextAttemptOrdinal,
                  usedOperationIds: ledger.usedOperationIds,
                });
              } catch (error) {
                throw new BroadcastContextPhaseRunnerError(
                  "RETRY_OPERATION_ID_FAILED",
                  "A fresh context retry operation identity could not be created.",
                  ledger,
                  null,
                  currentIdentity,
                  null,
                  error,
                );
              }
              ledger = await applyAndPersistTransition(
                ledger,
                {
                  type: "UNIT_RETRY_PLANNED",
                  ...currentIdentity,
                  nextOperationId,
                },
                "retry-planned",
                options.persist,
                statistics,
                "RETRY_OPERATION_ID_FAILED",
              );
              statistics.plannedRetryCount += 1;
              return { kind: "continue" };
            }

            if (
              executionCountFor(phase, unitId) >=
              maximumExecutionsPerInvocation
            ) {
              return { kind: "stop" };
            }
            const pendingIdentity = unitIdentity(ledger, unit);
            ledger = await applyAndPersistTransition(
              ledger,
              { type: "UNIT_STARTED", ...pendingIdentity },
              "execution-started",
              options.persist,
              statistics,
            );
            const inFlightUnit = findUnit(ledger, phase, unitId);
            return {
              kind: "execute",
              identity: unitIdentity(ledger, inFlightUnit),
            };
          },
        );
      if (step.kind === "stop") return;
      if (step.kind === "continue") continue;

      const executionIdentity = step.identity;
      const executionCountKey =
        `${executionIdentity.phase}\u0000${executionIdentity.unitId}`;
      executionCountByUnit.set(
        executionCountKey,
        executionCountFor(
          executionIdentity.phase,
          executionIdentity.unitId,
        ) + 1,
      );
      statistics.providerExecutionCount += 1;
      let executionResult: BroadcastContextPhaseExecutionResult | void;
      try {
        executionResult = await options.execute(executionIdentity);
      } catch (executionError) {
        let classification: BroadcastContextPhaseFailureClassification;
        try {
          classification = await options.classifyFailure(
            executionError,
            executionIdentity,
          );
        } catch (classificationError) {
          return sealAndThrow(
            executionIdentity,
            BROADCAST_CONTEXT_FAILURE_CLASSIFICATION_REASON,
            "CLASSIFICATION_FAILED",
            "The context provider failure could not be classified safely.",
            classificationError,
          );
        }
        const failureEvent = classifiedFailureEvent(
          classification,
          executionIdentity,
        );
        if (failureEvent === null) {
          return sealAndThrow(
            executionIdentity,
            BROADCAST_CONTEXT_FAILURE_CLASSIFICATION_REASON,
            "CLASSIFICATION_FAILED",
            "The context provider failure could not be classified safely.",
            classification,
          );
        }
        await commitTerminalOrSeal(
          failureEvent,
          executionIdentity,
          false,
        );
        continue;
      }

      const successEvent = executionSuccessEvent(
        executionResult,
        executionIdentity,
      );
      if (successEvent === null) {
        return sealAndThrow(
          executionIdentity,
          BROADCAST_CONTEXT_INVALID_EXECUTION_RESULT_REASON,
          "INVALID_EXECUTION_RESULT",
          "The context provider returned a result that cannot be stored durably.",
        );
      }
      await commitTerminalOrSeal(successEvent, executionIdentity, true);
      return;
    }
  };

  for (const phase of BROADCAST_CONTEXT_PHASE_LEDGER_PHASES) {
    const phaseUnitKeys = normalized.units
      .filter((unit) => unit.phase === phase)
      .map(({ unitId }) => ({ phase, unitId }));
    await runWithMaximumConcurrency(
      phaseUnitKeys,
      maximumConcurrency,
      runUnit,
    );
    const phaseSucceeded = ledger.units
      .filter((unit) => unit.phase === phase)
      .every((unit) => unit.status === "succeeded");
    if (!phaseSucceeded) break;
  }

  return buildResult(ledger, statistics);
}
