/**
 * `BroadcastContextSessionRecord`의 outer-shell durable 경계다.
 *
 * whole-context와 semantic-refinement는 각자 checkpoint 의미를 소유하고,
 * 이 모듈은 한 current session을 여는 일과 exact CAS/readback만 소유한다.
 * 호출자는 이미 확보한 AI 결과를 닫아 둔 순수 checkpoint builder를 넘긴다.
 * 같은 expected snapshot의 timeout/retry에서는 builder 결과를 재사용하고,
 * 실제 CAS conflict로 durable snapshot이 바뀐 경우에만 새 snapshot 위에
 * builder를 다시 적용한다.
 */

import {
  AnalysisResultStoreError,
  type AnalysisResultStore,
} from "../storage/analysisResultStore";
import {
  BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
  assertBroadcastContextSessionRecord,
  cloneBroadcastContextSessionRecord,
  type BroadcastContextSessionRecord,
} from "../storage/broadcastContextSessionStore";
import {
  runDurableAnalysisMutation,
  type DurableAnalysisMutationContext,
  type DurableAnalysisMutationFailure,
  type DurableAnalysisMutationIdentity,
  type DurableAnalysisMutationPolicy,
  type DurableAnalysisMutationReconciliation,
  type DurableAnalysisMutationResult,
} from "./durableAnalysisMutation";

export type DurableBroadcastContextSessionStore = Pick<
  AnalysisResultStore,
  "getBroadcastContextSession" | "replaceBroadcastContextSessionIfUnchanged"
>;

export interface DurableBroadcastContextSessionIdentity
  extends DurableAnalysisMutationIdentity {
  readonly inputSignature: string;
}

interface DurableBroadcastContextSessionOperation {
  readonly store: DurableBroadcastContextSessionStore;
  readonly identity: DurableBroadcastContextSessionIdentity;
  readonly isCurrent: (
    identity: DurableBroadcastContextSessionIdentity,
  ) => boolean;
  readonly signal?: AbortSignal;
  readonly policy?: Partial<DurableAnalysisMutationPolicy>;
}

export type LoadDurableBroadcastContextSessionOptions =
  DurableBroadcastContextSessionOperation;

export type DurableBroadcastContextSessionTransform = (
  expected: BroadcastContextSessionRecord,
  context: DurableAnalysisMutationContext,
) =>
  | BroadcastContextSessionRecord
  | Promise<BroadcastContextSessionRecord>;

export interface TransformDurableBroadcastContextSessionOptions
  extends DurableBroadcastContextSessionOperation {
  readonly expected: BroadcastContextSessionRecord;
  /**
   * 이미 계산된 evidence를 현재 session에 투영하는 checkpoint builder다.
   * provider/AI 호출은 이 callback 밖에서 한 번만 수행해야 한다.
   */
  readonly transform: DurableBroadcastContextSessionTransform;
}

export type DurableBroadcastContextSessionResult =
  DurableAnalysisMutationResult<BroadcastContextSessionRecord>;

type SessionReconciliation =
  DurableAnalysisMutationReconciliation<BroadcastContextSessionRecord>;

class BroadcastContextSessionTransformError extends Error {
  public constructor(
    readonly reasonCode: string,
    cause?: unknown,
  ) {
    super("Broadcast context session transform is invalid.", { cause });
    this.name = "BroadcastContextSessionTransformError";
  }
}

function hasIdentityText(
  identity: DurableBroadcastContextSessionIdentity,
): boolean {
  return (
    identity.runId.trim().length > 0 &&
    identity.operationToken.trim().length > 0 &&
    identity.inputSignature.trim().length > 0
  );
}

function permanentAtZero(reasonCode: string): DurableBroadcastContextSessionResult {
  return {
    status: "permanent-failure",
    reasonCode,
    attempts: 0,
  };
}

function staleAtZero(reasonCode: string): DurableBroadcastContextSessionResult {
  return {
    status: "stale",
    reasonCode,
    attempts: 0,
  };
}

function sessionJson(value: BroadcastContextSessionRecord): string {
  return JSON.stringify(value);
}

function sessionsExactlyMatch(
  left: BroadcastContextSessionRecord,
  right: BroadcastContextSessionRecord,
): boolean {
  return sessionJson(left) === sessionJson(right);
}

function validateCurrentSession(
  value: unknown,
  identity: DurableBroadcastContextSessionIdentity,
): SessionReconciliation {
  if (typeof value !== "object" || value === null) {
    return {
      kind: "permanent",
      reasonCode: "broadcast_context_session_record_invalid",
    };
  }
  const candidate = value as Partial<BroadcastContextSessionRecord>;
  if (
    candidate.kind !== "broadcastContextSession" ||
    candidate.schemaVersion !== BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION
  ) {
    return {
      kind: "permanent",
      reasonCode: "broadcast_context_session_schema_mismatch",
    };
  }
  if (candidate.runId !== identity.runId) {
    return {
      kind: "stale",
      reasonCode: "broadcast_context_session_run_mismatch",
    };
  }
  if (candidate.inputSignature !== identity.inputSignature) {
    return {
      kind: "stale",
      reasonCode: "broadcast_context_session_input_mismatch",
    };
  }
  try {
    // Completion/checkpoint boundaries accept only the exact current schema.
    assertBroadcastContextSessionRecord(candidate);
    return {
      kind: "succeeded",
      value: cloneBroadcastContextSessionRecord(candidate),
    };
  } catch {
    return {
      kind: "permanent",
      reasonCode: "broadcast_context_session_record_invalid",
    };
  }
}

function validateReplacement(
  value: unknown,
  identity: DurableBroadcastContextSessionIdentity,
): BroadcastContextSessionRecord {
  const validation = validateCurrentSession(value, identity);
  if (validation.kind !== "succeeded") {
    throw new BroadcastContextSessionTransformError(
      validation.kind === "stale"
        ? "broadcast_context_session_transform_identity_mismatch"
        : validation.reasonCode,
    );
  }
  return validation.value;
}

function classifySessionException(
  cause: unknown,
  phase: "mutation" | "readback" | "reconciliation",
): DurableAnalysisMutationFailure {
  if (cause instanceof BroadcastContextSessionTransformError) {
    return {
      kind: "permanent",
      reasonCode: cause.reasonCode,
    };
  }
  if (phase === "reconciliation") {
    return {
      kind: "permanent",
      reasonCode: "broadcast_context_session_reconciliation_failed",
    };
  }
  if (cause instanceof AnalysisResultStoreError) {
    return ["STORE_CLOSED", "INVALID_PAYLOAD", "SCHEMA_MISMATCH"].includes(
      cause.code,
    )
      ? {
          kind: "permanent",
          reasonCode: "broadcast_context_session_store_rejected",
        }
      : {
          kind: "retry",
          reasonCode: "broadcast_context_session_store_unavailable",
        };
  }
  /*
   * 일부 IndexedDB 구현은 DOMException을 store error로 감싸기 전에 거부한다.
   * transform 자체의 예외는 위 전용 error로 닫았으므로 여기서는 bounded
   * storage retry가 안전하다.
   */
  return {
    kind: "retry",
    reasonCode:
      phase === "readback"
        ? "broadcast_context_session_readback_failed"
        : "broadcast_context_session_store_unavailable",
  };
}

function genericIdentity(
  identity: DurableBroadcastContextSessionIdentity,
): DurableAnalysisMutationIdentity {
  return {
    runId: identity.runId,
    operationToken: identity.operationToken,
  };
}

function currentFence(
  options: DurableBroadcastContextSessionOperation,
): (identity: DurableAnalysisMutationIdentity) => boolean {
  return (identity) =>
    identity.runId === options.identity.runId &&
    identity.operationToken === options.identity.operationToken &&
    options.isCurrent(options.identity);
}

/**
 * 현재 run/input의 session을 watchdog과 bounded retry로 한 번 연다.
 * missing은 아직 앞선 transaction이 보이지 않는 경우일 수 있어 retry하며,
 * 다른 run/input은 stale, current schema 밖의 레코드는 permanent로 닫는다.
 */
export function loadDurableBroadcastContextSession(
  options: LoadDurableBroadcastContextSessionOptions,
): Promise<DurableBroadcastContextSessionResult> {
  if (!hasIdentityText(options.identity)) {
    return Promise.resolve(
      permanentAtZero("broadcast_context_session_identity_invalid"),
    );
  }
  return runDurableAnalysisMutation({
    identity: genericIdentity(options.identity),
    expected: options.identity,
    isCurrent: currentFence(options),
    mutate: () => Promise.resolve({ kind: "accepted" }),
    readback: () =>
      options.store.getBroadcastContextSession(options.identity.runId),
    reconcile: ({ readback }) => {
      if (readback === null) {
        return {
          kind: "retry",
          reasonCode: "broadcast_context_session_missing",
        };
      }
      return validateCurrentSession(readback, options.identity);
    },
    classifyThrown: classifySessionException,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.policy === undefined ? {} : { policy: options.policy }),
  });
}

/**
 * 한 exact session snapshot을 변환하고 CAS 뒤 exact readback으로 확정한다.
 *
 * - timeout/storage outcome-unknown: 같은 replacement를 재사용한다.
 * - CAS false + replacement exact readback: 이미 commit된 성공으로 복구한다.
 * - CAS false + 다른 current snapshot: 그 snapshot을 새 expected로 삼아
 *   checkpoint builder만 다시 적용한다.
 * - 다른 run/input 또는 current schema 밖의 readback: 쓰지 않고 종료한다.
 */
export function transformDurableBroadcastContextSession(
  options: TransformDurableBroadcastContextSessionOptions,
): Promise<DurableBroadcastContextSessionResult> {
  if (!hasIdentityText(options.identity)) {
    return Promise.resolve(
      permanentAtZero("broadcast_context_session_identity_invalid"),
    );
  }

  const initialValidation = validateCurrentSession(
    options.expected,
    options.identity,
  );
  if (initialValidation.kind !== "succeeded") {
    return Promise.resolve(
      initialValidation.kind === "stale"
        ? staleAtZero(initialValidation.reasonCode)
        : permanentAtZero(initialValidation.reasonCode),
    );
  }

  let expectedSnapshot = initialValidation.value;
  let preparedExpectedJson: string | null = null;
  let preparedReplacement: BroadcastContextSessionRecord | null = null;
  /*
   * Once a CAS has been dispatched its outcome can be unknown even when the
   * operation token becomes stale.  Keep only the readback lane open: a retry
   * while this flag is set must not dispatch the stale mutation again.
   */
  let completionReadbackPending = false;
  const recoveryAwareFence = (
    candidate: DurableAnalysisMutationIdentity,
  ): boolean =>
    candidate.runId === options.identity.runId &&
    candidate.operationToken === options.identity.operationToken &&
    (completionReadbackPending || options.isCurrent(options.identity));

  return runDurableAnalysisMutation({
    identity: genericIdentity(options.identity),
    expected: options.identity,
    isCurrent: recoveryAwareFence,
    mutate: async (context) => {
      if (completionReadbackPending) {
        /*
         * The previous CAS was already dispatched and its exact outcome still
         * needs proving.  Ask the generic runner to proceed directly to
         * readback instead of replaying a now-stale transform.
         */
        return { kind: "accepted" };
      }

      const expectedJson = sessionJson(expectedSnapshot);
      if (
        preparedReplacement === null ||
        preparedExpectedJson !== expectedJson
      ) {
        let replacement: BroadcastContextSessionRecord;
        try {
          replacement = await options.transform(
            cloneBroadcastContextSessionRecord(expectedSnapshot),
            context,
          );
        } catch (cause) {
          throw cause instanceof BroadcastContextSessionTransformError
            ? cause
            : new BroadcastContextSessionTransformError(
                "broadcast_context_session_transform_failed",
                cause,
              );
        }
        preparedReplacement = validateReplacement(
          replacement,
          options.identity,
        );
        preparedExpectedJson = expectedJson;
      }

      let stillCurrent: boolean;
      try {
        stillCurrent = options.isCurrent(options.identity);
      } catch {
        return {
          kind: "permanent",
          reasonCode: "analysis_mutation_fence_check_failed",
        };
      }
      if (!stillCurrent) {
        return {
          kind: "stale",
          reasonCode: "analysis_mutation_fence_stale",
        };
      }

      completionReadbackPending = true;
      const replaced =
        await options.store.replaceBroadcastContextSessionIfUnchanged(
          expectedSnapshot,
          preparedReplacement,
        );
      return replaced
        ? { kind: "accepted" }
        : {
            kind: "conflict",
            reasonCode: "broadcast_context_session_cas_conflict",
          };
    },
    readback: () =>
      options.store.getBroadcastContextSession(options.identity.runId),
    reconcile: ({ readback }) => {
      if (readback === null) {
        /*
         * Absence cannot prove whether an outcome-unknown CAS committed.
         * Preserve readback-only recovery for the next bounded attempt.
         */
        return {
          kind: "retry",
          reasonCode: "broadcast_context_session_readback_missing",
        };
      }
      const validation = validateCurrentSession(readback, options.identity);
      if (validation.kind !== "succeeded") return validation;

      const currentSnapshot = validation.value;
      if (
        preparedReplacement !== null &&
        sessionsExactlyMatch(currentSnapshot, preparedReplacement)
      ) {
        return {
          kind: "succeeded",
          value: currentSnapshot,
        };
      }

      if (sessionsExactlyMatch(currentSnapshot, expectedSnapshot)) {
        completionReadbackPending = false;
        if (!options.isCurrent(options.identity)) {
          return {
            kind: "stale",
            reasonCode: "analysis_mutation_fence_stale",
          };
        }
        return {
          kind: "retry",
          reasonCode: "broadcast_context_session_commit_not_visible",
        };
      }

      completionReadbackPending = false;
      if (!options.isCurrent(options.identity)) {
        return {
          kind: "stale",
          reasonCode:
            "broadcast_context_session_cas_conflict_after_fence_stale",
        };
      }
      expectedSnapshot = currentSnapshot;
      preparedExpectedJson = null;
      preparedReplacement = null;
      return {
        kind: "retry",
        reasonCode: "broadcast_context_session_conflict_rebase",
      };
    },
    classifyThrown: classifySessionException,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.policy === undefined ? {} : { policy: options.policy }),
  });
}
