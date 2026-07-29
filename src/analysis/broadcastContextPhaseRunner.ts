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

export const DEFAULT_BROADCAST_CONTEXT_PHASE_RUNNER_ATTEMPTS = 3;
export const MAX_BROADCAST_CONTEXT_PHASE_RUNNER_ATTEMPTS = 8;
export const DEFAULT_BROADCAST_CONTEXT_PHASE_RUNNER_EXECUTIONS_PER_INVOCATION =
  3;
export const DEFAULT_BROADCAST_CONTEXT_PHASE_RUNNER_CONCURRENCY = 1;
export const MAX_BROADCAST_CONTEXT_PHASE_RUNNER_CONCURRENCY = 8;

export const BROADCAST_CONTEXT_RECOVERED_IN_FLIGHT_REASON =
  "runner_recovered_persisted_in_flight";
export const BROADCAST_CONTEXT_INVALID_EXECUTION_RESULT_REASON =
  "runner_invalid_execution_result";
export const BROADCAST_CONTEXT_FAILURE_CLASSIFICATION_REASON =
  "runner_failure_classification_failed";

export interface BroadcastContextPhaseExecutionResult {
  readonly result?: BroadcastContextPhaseLedgerJsonValue;
  readonly modelReceipt?: BroadcastContextPhaseLedgerModelReceipt;
}

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
    };

export interface BroadcastContextPhaseRetryOperationRequest {
  readonly identity: BroadcastContextPhaseLedgerUnitIdentity;
  readonly nextAttemptOrdinal: number;
  readonly usedOperationIds: readonly string[];
}

export type BroadcastContextPhasePersistCause =
  | "recovery-seal"
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
   * Absolute lifetime ceiling encoded by the durable attempt ordinal.
   * Keep this higher than the per-invocation budget so an editor-confirmed
   * retry can still run after an automatic retry wave is exhausted.
   */
  readonly maximumAttemptCount?: number;
  /** Fresh provider executions allowed for one logical unit in this call. */
  readonly maximumExecutionsPerInvocation?: number;
  readonly maximumConcurrency?: number;
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

export interface BroadcastContextPhaseRunnerStatistics {
  readonly providerExecutionCount: number;
  readonly resumedSucceededCount: number;
  readonly recoveredInFlightCount: number;
  readonly plannedRetryCount: number;
  readonly persistedTransitionCount: number;
}

export type BroadcastContextPhaseRunnerBlockedStatus =
  | "blocked-retryable-gap"
  | "blocked-outcome-unknown"
  | "blocked-attempt-limit"
  | "blocked-mixed";

interface BroadcastContextPhaseRunnerResultBase {
  readonly ledger: BroadcastContextPhaseLedger;
  readonly summary: BroadcastContextPhaseLedgerSummary;
  readonly statistics: BroadcastContextPhaseRunnerStatistics;
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
      classification.disposition !== "outcome-unknown") ||
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
        : "UNIT_OUTCOME_UNKNOWN",
    ...identity,
    reasonCode: classification.reasonCode,
    ...(Object.hasOwn(classification, "modelReceipt")
      ? { modelReceipt: classification.modelReceipt }
      : {}),
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
      unit.status === "retryable-gap" || unit.status === "outcome-unknown"
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
  if (statuses.size === 1 && statuses.has("pending")) {
    return "blocked-attempt-limit";
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
  if (broadcastContextPhaseLedgerCanComplete(ledger)) {
    return Object.freeze({
      status: "completed",
      complete: true,
      ledger,
      summary,
      statistics: frozenStatistics(statistics),
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
    blockingUnits,
  });
}

async function markRecoveredInFlightUnits(
  ledger: BroadcastContextPhaseLedger,
  options: RunBroadcastContextPhaseLedgerOptions,
  statistics: MutableRunnerStatistics,
): Promise<BroadcastContextPhaseLedger> {
  let current = ledger;
  const interruptedUnitKeys = ledger.units
    .filter(({ status }) => status === "in-flight")
    .map(({ phase, unitId }) => ({ phase, unitId }));
  for (const { phase, unitId } of interruptedUnitKeys) {
    const unit = findUnit(current, phase, unitId);
    if (unit.status !== "in-flight") continue;
    current = await sealOutcomeUnknown(
      current,
      unitIdentity(current, unit),
      BROADCAST_CONTEXT_RECOVERED_IN_FLIGHT_REASON,
      "recovery-seal",
      options,
      statistics,
    );
    statistics.recoveredInFlightCount += 1;
  }
  return current;
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

/**
 * Runs every planned context unit as a crash-safe sequence.
 *
 * `in-flight` means a paid request may already have left the browser. A
 * recovered in-flight unit is therefore sealed as `outcome-unknown` before any
 * new provider call. Only an explicit `retryable-gap` receives a fresh billing
 * identity, and every accepted state transition is durably persisted before
 * the runner performs the next side effect.
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
  const maximumAttemptCount =
    options.maximumAttemptCount ??
    DEFAULT_BROADCAST_CONTEXT_PHASE_RUNNER_ATTEMPTS;
  if (
    !Number.isSafeInteger(maximumAttemptCount) ||
    maximumAttemptCount < 1 ||
    maximumAttemptCount > MAX_BROADCAST_CONTEXT_PHASE_RUNNER_ATTEMPTS
  ) {
    throw new BroadcastContextPhaseRunnerError(
      "INVALID_ATTEMPT_LIMIT",
      "The context phase attempt limit is outside the supported bounds.",
      normalized,
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
    Math.min(
      maximumAttemptCount,
      DEFAULT_BROADCAST_CONTEXT_PHASE_RUNNER_EXECUTIONS_PER_INVOCATION,
    );
  if (
    !Number.isSafeInteger(maximumExecutionsPerInvocation) ||
    maximumExecutionsPerInvocation < 1 ||
    maximumExecutionsPerInvocation >
      MAX_BROADCAST_CONTEXT_PHASE_RUNNER_ATTEMPTS
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
    resumedSucceededCount: normalized.units.filter(
      ({ status }) => status === "succeeded",
    ).length,
    recoveredInFlightCount: 0,
    plannedRetryCount: 0,
    persistedTransitionCount: 0,
  };
  let ledger = await markRecoveredInFlightUnits(
    normalized,
    options,
    statistics,
  );
  const transitionMutex = new BroadcastContextPhaseTransitionMutex();
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
              unit.status === "outcome-unknown"
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
              if (nextAttemptOrdinal >= maximumAttemptCount) {
                return { kind: "stop" };
              }
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
              unit.attemptOrdinal >= maximumAttemptCount ||
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
