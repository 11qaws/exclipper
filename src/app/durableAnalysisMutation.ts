/**
 * 한 번의 durable mutation을 실행하고 같은 기대값을 다시 읽어 확인한다.
 *
 * 이 모듈은 stage 규칙을 소유하지 않는다. 호출자가 현재 `runId`와
 * `operationToken`, bridge 결과의 실패 종류, readback 비교 규칙을 넘긴다.
 * 따라서 App의 presentation state나 특정 저장소 구현이 재시도 정책에 섞이지
 * 않는다.
 */

export interface DurableAnalysisMutationIdentity {
  readonly runId: string;
  readonly operationToken: string;
}

export type DurableAnalysisMutationFailure =
  | {
      readonly kind: "retry";
      readonly reasonCode: string;
    }
  | {
      readonly kind: "stale";
      readonly reasonCode: string;
    }
  | {
      readonly kind: "permanent";
      readonly reasonCode: string;
    };

export interface DurableAnalysisMutationConflict {
  readonly kind: "conflict";
  readonly reasonCode: string;
}

type DurableAnalysisRetryFailure = Extract<
  DurableAnalysisMutationFailure,
  { readonly kind: "retry" }
>;

type DurableAnalysisTerminalFailure = Exclude<
  DurableAnalysisMutationFailure,
  DurableAnalysisRetryFailure
>;

export type DurableAnalysisMutationAttempt =
  | { readonly kind: "accepted" }
  | DurableAnalysisMutationConflict
  | DurableAnalysisMutationFailure;

export type DurableAnalysisMutationReconciliation<Value> =
  | {
      readonly kind: "succeeded";
      readonly value: Value;
    }
  | DurableAnalysisMutationFailure;

export type DurableAnalysisMutationPhase =
  | "mutation"
  | "readback"
  | "reconciliation";

export interface DurableAnalysisMutationPolicy {
  readonly maximumAttempts: number;
  readonly mutationTimeoutMs: number;
  readonly readbackTimeoutMs: number;
  readonly initialBackoffMs: number;
  readonly maximumBackoffMs: number;
}

export const DEFAULT_DURABLE_ANALYSIS_MUTATION_POLICY: DurableAnalysisMutationPolicy =
  Object.freeze({
    maximumAttempts: 8,
    mutationTimeoutMs: 5_000,
    readbackTimeoutMs: 5_000,
    initialBackoffMs: 250,
    maximumBackoffMs: 10_000,
  });

export interface DurableAnalysisMutationContext {
  readonly identity: DurableAnalysisMutationIdentity;
  readonly attemptNumber: number;
  /**
   * outer abort와 watchdog timeout을 함께 반영한다. callback은 가능한 경우 이
   * signal을 실제 작업에 전달해야 한다.
   */
  readonly signal: AbortSignal;
}

export interface DurableAnalysisMutationOptions<Expected, Readback, Value> {
  readonly identity: DurableAnalysisMutationIdentity;
  readonly expected: Expected;
  readonly isCurrent: (identity: DurableAnalysisMutationIdentity) => boolean;
  readonly mutate: (
    context: DurableAnalysisMutationContext,
  ) => Promise<DurableAnalysisMutationAttempt>;
  readonly readback: (
    context: DurableAnalysisMutationContext,
  ) => Promise<Readback>;
  readonly reconcile: (input: {
    readonly identity: DurableAnalysisMutationIdentity;
    readonly attemptNumber: number;
    readonly expected: Expected;
    readonly readback: Readback;
    /**
     * `null`이면 mutation이 명시적으로 accepted됐다. 값이 있으면 timeout 또는
     * transient storage 실패 뒤 readback으로 이미 commit됐는지 확인하는 중이다.
     */
    readonly mutationIssue:
      | DurableAnalysisRetryFailure
      | DurableAnalysisMutationConflict
      | null;
  }) => DurableAnalysisMutationReconciliation<Value>;
  /**
   * 알 수 없는 예외는 기본적으로 permanent다. 저장소 오류처럼 재시도 가능한
   * 예외만 호출자가 명시적으로 `retry`로 분류한다.
   */
  readonly classifyThrown?: (
    cause: unknown,
    phase: DurableAnalysisMutationPhase,
  ) => DurableAnalysisMutationFailure;
  readonly signal?: AbortSignal;
  readonly policy?: Partial<DurableAnalysisMutationPolicy>;
}

export type DurableAnalysisMutationResult<Value> =
  | {
      readonly status: "succeeded";
      readonly value: Value;
      readonly attempts: number;
      readonly recovered: boolean;
    }
  | {
      readonly status: "stale";
      readonly reasonCode: string;
      readonly attempts: number;
    }
  | {
      readonly status: "permanent-failure";
      readonly reasonCode: string;
      readonly attempts: number;
    }
  | {
      readonly status: "retry-exhausted";
      readonly reasonCode: string;
      readonly attempts: number;
    }
  | {
      readonly status: "aborted";
      readonly attempts: number;
    };

class DurableAnalysisWatchdogError extends Error {
  public readonly phase: "mutation" | "readback";

  public constructor(phase: "mutation" | "readback") {
    super(`Durable analysis ${phase} watchdog expired.`);
    this.name = "DurableAnalysisWatchdogError";
    this.phase = phase;
  }
}

class DurableAnalysisAbortError extends Error {
  public constructor() {
    super("Durable analysis mutation was aborted.");
    this.name = "DurableAnalysisAbortError";
  }
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${label} must not be empty.`);
  }
}

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer.`);
  }
  return value;
}

function resolvePolicy(
  override: Partial<DurableAnalysisMutationPolicy> | undefined,
): DurableAnalysisMutationPolicy {
  const policy = {
    ...DEFAULT_DURABLE_ANALYSIS_MUTATION_POLICY,
    ...override,
  };
  return {
    maximumAttempts: positiveSafeInteger(
      policy.maximumAttempts,
      "maximumAttempts",
    ),
    mutationTimeoutMs: positiveSafeInteger(
      policy.mutationTimeoutMs,
      "mutationTimeoutMs",
    ),
    readbackTimeoutMs: positiveSafeInteger(
      policy.readbackTimeoutMs,
      "readbackTimeoutMs",
    ),
    initialBackoffMs: positiveSafeInteger(
      policy.initialBackoffMs,
      "initialBackoffMs",
    ),
    maximumBackoffMs: positiveSafeInteger(
      policy.maximumBackoffMs,
      "maximumBackoffMs",
    ),
  };
}

function validFailure<Failure extends DurableAnalysisMutationFailure>(
  failure: Failure,
): Failure {
  assertNonEmpty(failure.reasonCode, "reasonCode");
  return failure;
}

function validConflict(
  conflict: DurableAnalysisMutationConflict,
): DurableAnalysisMutationConflict {
  assertNonEmpty(conflict.reasonCode, "reasonCode");
  return conflict;
}

export interface DurableAnalysisBridgeRejection {
  readonly failure: "storage" | "transition" | "conflict";
  readonly retryable: boolean;
  readonly reason: string;
}

/**
 * `analysisJobBridge`의 현재 구조를 runner의 명시적 분류로 옮긴다.
 *
 * `stage_order_violation`은 timeout 직전에 이전 write가 성공했을 수 있으므로
 * readback 전에는 permanent로 단정하지 않는다. 반대로 run fence 불일치는
 * 현재 operation이 아니므로 재시도하지 않는다.
 */
export function classifyDurableAnalysisBridgeRejection(
  rejection: DurableAnalysisBridgeRejection,
): Exclude<DurableAnalysisMutationAttempt, { readonly kind: "accepted" }> {
  if (rejection.failure === "storage") {
    return rejection.retryable
      ? {
          kind: "retry",
          reasonCode: "analysis_job_storage_failure",
        }
      : {
          kind: "permanent",
          reasonCode: "analysis_job_storage_rejected",
        };
  }
  if (
    rejection.failure === "conflict" ||
    rejection.reason === "stage_order_violation"
  ) {
    return {
      kind: "conflict",
      reasonCode: "analysis_job_commit_conflict",
    };
  }
  if (rejection.reason === "run_fence_mismatch") {
    return {
      kind: "stale",
      reasonCode: "analysis_job_run_fence_mismatch",
    };
  }
  return {
    kind: "permanent",
    reasonCode: "analysis_job_transition_rejected",
  };
}

function classifyThrown(
  cause: unknown,
  phase: DurableAnalysisMutationPhase,
  classifier:
    | DurableAnalysisMutationOptions<unknown, unknown, unknown>["classifyThrown"]
    | undefined,
): DurableAnalysisMutationFailure {
  if (classifier === undefined) {
    return {
      kind: "permanent",
      reasonCode: `${phase}_exception`,
    };
  }
  try {
    return validFailure(classifier(cause, phase));
  } catch {
    return {
      kind: "permanent",
      reasonCode: "failure_classifier_failed",
    };
  }
}

function fenceFailure(
  identity: DurableAnalysisMutationIdentity,
  isCurrent: DurableAnalysisMutationOptions<
    unknown,
    unknown,
    unknown
  >["isCurrent"],
): DurableAnalysisTerminalFailure | null {
  try {
    return isCurrent(identity)
      ? null
      : {
          kind: "stale",
          reasonCode: "analysis_mutation_fence_stale",
        };
  } catch {
    return {
      kind: "permanent",
      reasonCode: "analysis_mutation_fence_check_failed",
    };
  }
}

function terminalResult<Value>(
  failure: DurableAnalysisTerminalFailure,
  attempts: number,
): DurableAnalysisMutationResult<Value> {
  return failure.kind === "stale"
    ? {
        status: "stale",
        reasonCode: failure.reasonCode,
        attempts,
      }
    : {
        status: "permanent-failure",
        reasonCode: failure.reasonCode,
        attempts,
      };
}

function boundedOperation<Value>(
  phase: "mutation" | "readback",
  timeoutMs: number,
  outerSignal: AbortSignal,
  operation: (signal: AbortSignal) => Promise<Value>,
): Promise<Value> {
  if (outerSignal.aborted) {
    return Promise.reject(new DurableAnalysisAbortError());
  }

  const controller = new AbortController();
  return new Promise<Value>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof globalThis.setTimeout> | null = null;

    const cleanup = (): void => {
      if (timeout !== null) {
        globalThis.clearTimeout(timeout);
        timeout = null;
      }
      outerSignal.removeEventListener("abort", onOuterAbort);
    };
    const settleResolved = (value: Value): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const settleRejected = (cause: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        cause instanceof Error
          ? cause
          : new Error("Durable analysis operation rejected.", { cause }),
      );
    };
    const onOuterAbort = (): void => {
      controller.abort();
      settleRejected(new DurableAnalysisAbortError());
    };

    outerSignal.addEventListener("abort", onOuterAbort, { once: true });
    timeout = globalThis.setTimeout(() => {
      controller.abort();
      settleRejected(new DurableAnalysisWatchdogError(phase));
    }, timeoutMs);

    Promise.resolve()
      .then(() => operation(controller.signal))
      .then(settleResolved, settleRejected);
  });
}

function waitForBackoff(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DurableAnalysisAbortError());
  }
  return new Promise<void>((resolve, reject) => {
    let timeout: ReturnType<typeof globalThis.setTimeout> | null = null;
    let settled = false;
    const cleanup = (): void => {
      if (timeout !== null) {
        globalThis.clearTimeout(timeout);
        timeout = null;
      }
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new DurableAnalysisAbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    timeout = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }, delayMs);
  });
}

function retryDelayMs(
  attemptNumber: number,
  policy: DurableAnalysisMutationPolicy,
): number {
  const exponent = Math.min(Math.max(0, attemptNumber - 1), 30);
  return Math.min(
    policy.maximumBackoffMs,
    policy.initialBackoffMs * 2 ** exponent,
  );
}

function abortedResult<Value>(
  attempts: number,
): DurableAnalysisMutationResult<Value> {
  return { status: "aborted", attempts };
}

/**
 * transient mutation 실패도 readback을 먼저 수행한다. timeout 직전에 실제
 * transaction이 commit된 outcome-unknown 상태에서 같은 mutation을 불필요하게
 * 반복하지 않기 위해서다.
 */
export async function runDurableAnalysisMutation<Expected, Readback, Value>(
  options: DurableAnalysisMutationOptions<Expected, Readback, Value>,
): Promise<DurableAnalysisMutationResult<Value>> {
  assertNonEmpty(options.identity.runId, "runId");
  assertNonEmpty(options.identity.operationToken, "operationToken");
  const policy = resolvePolicy(options.policy);
  const outerSignal = options.signal ?? new AbortController().signal;
  let lastRetryReason = "transient_failure";

  for (
    let attemptNumber = 1;
    attemptNumber <= policy.maximumAttempts;
    attemptNumber += 1
  ) {
    if (outerSignal.aborted) {
      return abortedResult(attemptNumber - 1);
    }
    const beforeAttemptFence = fenceFailure(
      options.identity,
      options.isCurrent,
    );
    if (beforeAttemptFence !== null) {
      return terminalResult(beforeAttemptFence, attemptNumber - 1);
    }

    let mutationIssue:
      | DurableAnalysisRetryFailure
      | DurableAnalysisMutationConflict
      | null = null;
    let mutationResult: DurableAnalysisMutationAttempt;
    try {
      mutationResult = await boundedOperation(
        "mutation",
        policy.mutationTimeoutMs,
        outerSignal,
        (signal) =>
          options.mutate({
            identity: options.identity,
            attemptNumber,
            signal,
          }),
      );
    } catch (cause) {
      if (cause instanceof DurableAnalysisAbortError || outerSignal.aborted) {
        return abortedResult(attemptNumber);
      }
      mutationResult =
        cause instanceof DurableAnalysisWatchdogError
          ? {
              kind: "retry",
              reasonCode: "mutation_timeout",
            }
          : classifyThrown(cause, "mutation", options.classifyThrown);
    }

    if (mutationResult.kind === "stale" || mutationResult.kind === "permanent") {
      return terminalResult(
        validFailure(mutationResult),
        attemptNumber,
      );
    }
    if (mutationResult.kind === "retry") {
      mutationIssue = validFailure(mutationResult);
    } else if (mutationResult.kind === "conflict") {
      mutationIssue = validConflict(mutationResult);
    }

    const afterMutationFence = fenceFailure(
      options.identity,
      options.isCurrent,
    );
    if (afterMutationFence !== null) {
      return terminalResult(afterMutationFence, attemptNumber);
    }

    let readback: Readback;
    try {
      readback = await boundedOperation(
        "readback",
        policy.readbackTimeoutMs,
        outerSignal,
        (signal) =>
          options.readback({
            identity: options.identity,
            attemptNumber,
            signal,
          }),
      );
    } catch (cause) {
      if (cause instanceof DurableAnalysisAbortError || outerSignal.aborted) {
        return abortedResult(attemptNumber);
      }
      const readbackFailure =
        cause instanceof DurableAnalysisWatchdogError
          ? {
              kind: "retry" as const,
              reasonCode: "readback_timeout",
            }
          : classifyThrown(cause, "readback", options.classifyThrown);
      if (
        readbackFailure.kind === "stale" ||
        readbackFailure.kind === "permanent"
      ) {
        return terminalResult(
          validFailure(readbackFailure),
          attemptNumber,
        );
      }
      lastRetryReason = validFailure(readbackFailure).reasonCode;
      if (attemptNumber >= policy.maximumAttempts) {
        return {
          status: "retry-exhausted",
          reasonCode: lastRetryReason,
          attempts: attemptNumber,
        };
      }
      try {
        await waitForBackoff(
          retryDelayMs(attemptNumber, policy),
          outerSignal,
        );
      } catch {
        return abortedResult(attemptNumber);
      }
      continue;
    }

    const afterReadbackFence = fenceFailure(
      options.identity,
      options.isCurrent,
    );
    if (afterReadbackFence !== null) {
      return terminalResult(afterReadbackFence, attemptNumber);
    }

    let reconciliation: DurableAnalysisMutationReconciliation<Value>;
    try {
      reconciliation = options.reconcile({
        identity: options.identity,
        attemptNumber,
        expected: options.expected,
        readback,
        mutationIssue,
      });
    } catch (cause) {
      reconciliation = classifyThrown(
        cause,
        "reconciliation",
        options.classifyThrown,
      );
    }

    if (reconciliation.kind === "succeeded") {
      const finalFence = fenceFailure(options.identity, options.isCurrent);
      if (finalFence !== null) {
        return terminalResult(finalFence, attemptNumber);
      }
      if (outerSignal.aborted) {
        return abortedResult(attemptNumber);
      }
      return {
        status: "succeeded",
        value: reconciliation.value,
        attempts: attemptNumber,
        recovered: attemptNumber > 1 || mutationIssue !== null,
      };
    }
    if (
      reconciliation.kind === "stale" ||
      reconciliation.kind === "permanent"
    ) {
      return terminalResult(
        validFailure(reconciliation),
        attemptNumber,
      );
    }
    lastRetryReason = validFailure(reconciliation).reasonCode;
    if (attemptNumber >= policy.maximumAttempts) {
      return {
        status: "retry-exhausted",
        reasonCode: lastRetryReason,
        attempts: attemptNumber,
      };
    }

    try {
      await waitForBackoff(
        retryDelayMs(attemptNumber, policy),
        outerSignal,
      );
    } catch {
      return abortedResult(attemptNumber);
    }
  }

  return {
    status: "retry-exhausted",
    reasonCode: lastRetryReason,
    attempts: policy.maximumAttempts,
  };
}
