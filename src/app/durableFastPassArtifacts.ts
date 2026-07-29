import {
  AnalysisResultStoreError,
  type AnalysisManifestRecord,
  type AnalysisResultStore,
  type AnalysisTerminalRecord,
  type FastPassResultArtifactBundle,
  type FinalAnalysisResultRecord,
} from "../storage/analysisResultStore";
import {
  runDurableAnalysisMutation,
  type DurableAnalysisMutationFailure,
  type DurableAnalysisMutationIdentity,
  type DurableAnalysisMutationPolicy,
  type DurableAnalysisMutationResult,
} from "./durableAnalysisMutation";

/**
 * Fast-pass publication에 필요한 저장 표면만 좁혀 둔다.
 *
 * `provisionalResult`는 현재 getter가 없는 비공개 중간 산출물이다. 이 어댑터는
 * stage cursor를 전진시키는 공개 확정 경계만 소유하므로 manifest/final/terminal
 * 세 레코드만 exact readback한다.
 */
export type DurableFastPassArtifactStore = Pick<
  AnalysisResultStore,
  | "insertManifestIfAbsent"
  | "getManifest"
  | "getFinalResult"
  | "getTerminalRecord"
  | "commitFastPassResultBundleIfAbsent"
>;

type StableFastPassRecord =
  | AnalysisManifestRecord
  | FinalAnalysisResultRecord
  | AnalysisTerminalRecord;

export interface DurableFastPassArtifactOperationInput {
  readonly store: DurableFastPassArtifactStore;
  readonly runId: string;
  readonly operationToken: string;
  readonly isCurrent: (identity: DurableAnalysisMutationIdentity) => boolean;
  readonly signal?: AbortSignal;
  readonly policy?: Partial<DurableAnalysisMutationPolicy>;
}

export interface CommitDurableFastPassManifestInput
  extends DurableFastPassArtifactOperationInput {
  readonly manifest: AnalysisManifestRecord;
}

export interface CommitDurableFastPassResultInput
  extends DurableFastPassArtifactOperationInput {
  /**
   * 분석 시작 전에 확정한 manifest와 같은 snapshot이어야 한다. 최종 결과 저장
   * 시에도 다시 확인해 다른 입력/모델의 결과가 같은 run에 붙지 않게 한다.
   */
  readonly manifest: AnalysisManifestRecord;
  readonly finalResult: FinalAnalysisResultRecord;
  readonly terminal: AnalysisTerminalRecord;
}

export interface DurableFastPassResultCommitReceipt {
  readonly manifest: AnalysisManifestRecord;
  readonly finalResult: FinalAnalysisResultRecord;
  readonly terminal: AnalysisTerminalRecord;
  readonly attempts: Readonly<{
    readonly manifest: number;
    readonly finalResult: number;
    readonly terminal: number;
    readonly bundleReadback: number;
  }>;
  readonly recovered: boolean;
}

export type DurableFastPassArtifactName =
  | "manifest"
  | "finalResult"
  | "terminal"
  | "bundleReadback";

export type DurableFastPassResultCommitFailure =
  | {
      readonly status: "stale";
      readonly artifact: DurableFastPassArtifactName;
      readonly reasonCode: string;
      readonly attempts: number;
    }
  | {
      readonly status: "permanent-failure";
      readonly artifact: DurableFastPassArtifactName;
      readonly reasonCode: string;
      readonly attempts: number;
    }
  | {
      readonly status: "retry-exhausted";
      readonly artifact: DurableFastPassArtifactName;
      readonly reasonCode: string;
      readonly attempts: number;
    }
  | {
      readonly status: "aborted";
      readonly artifact: DurableFastPassArtifactName;
      readonly attempts: number;
    };

export type DurableFastPassResultCommitResult =
  | {
      readonly status: "succeeded";
      readonly value: DurableFastPassResultCommitReceipt;
    }
  | DurableFastPassResultCommitFailure;

interface FastPassBundleSnapshot {
  readonly manifest: AnalysisManifestRecord | null;
  readonly finalResult: FinalAnalysisResultRecord | null;
  readonly terminal: AnalysisTerminalRecord | null;
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${label} must not be empty.`);
  }
}

function freezeJsonValue(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    freezeJsonValue(child);
  }
}

/**
 * 호출자가 재시도 도중 원본 객체를 바꿔도 동일 bytes 의미를 계속 쓰도록 한 번만
 * JSON snapshot을 만든다. 저장소도 JSON-only이므로 이 복제 경계와 일치한다.
 */
function stableJsonSnapshot<Record extends StableFastPassRecord>(
  record: Record,
): Record {
  const serialized = JSON.stringify(record);
  if (serialized === undefined) {
    throw new TypeError("Fast-pass artifact must be JSON serializable.");
  }
  const snapshot = JSON.parse(serialized) as Record;
  freezeJsonValue(snapshot);
  return snapshot;
}

function jsonValuesExactlyMatch(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (
    typeof left !== "object" ||
    left === null ||
    typeof right !== "object" ||
    right === null
  ) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    return (
      left.length === right.length &&
      left.every((value, index) =>
        jsonValuesExactlyMatch(value, right[index]),
      )
    );
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(rightRecord, key) &&
        jsonValuesExactlyMatch(leftRecord[key], rightRecord[key]),
    )
  );
}

function identityFor(
  input: DurableFastPassArtifactOperationInput,
): DurableAnalysisMutationIdentity {
  assertNonEmpty(input.runId, "runId");
  assertNonEmpty(input.operationToken, "operationToken");
  return {
    runId: input.runId,
    operationToken: input.operationToken,
  };
}

function currentConflict(
  input: DurableFastPassArtifactOperationInput,
  identity: DurableAnalysisMutationIdentity,
  reasonCode: string,
): DurableAnalysisMutationFailure {
  try {
    return input.isCurrent(identity)
      ? { kind: "permanent", reasonCode }
      : {
          kind: "stale",
          reasonCode: "fast_pass_artifact_operation_stale",
        };
  } catch {
    return {
      kind: "permanent",
      reasonCode: "fast_pass_artifact_fence_check_failed",
    };
  }
}

function classifyStoreException(
  artifact: DurableFastPassArtifactName,
  cause: unknown,
  phase: "mutation" | "readback" | "reconciliation",
): DurableAnalysisMutationFailure {
  if (phase === "reconciliation") {
    return {
      kind: "permanent",
      reasonCode: `fast_pass_${artifact}_reconciliation_failed`,
    };
  }
  if (cause instanceof AnalysisResultStoreError) {
    return ["STORE_CLOSED", "INVALID_PAYLOAD", "SCHEMA_MISMATCH"].includes(
      cause.code,
    )
      ? {
          kind: "permanent",
          reasonCode: `fast_pass_${artifact}_store_rejected`,
        }
      : {
          kind: "retry",
          reasonCode: `fast_pass_${artifact}_store_unavailable`,
        };
  }
  return phase === "readback"
    ? {
        kind: "retry",
        reasonCode: `fast_pass_${artifact}_readback_failed`,
      }
    : {
        kind: "permanent",
        reasonCode: `fast_pass_${artifact}_write_failed`,
      };
}

function mutationOptions(
  input: DurableFastPassArtifactOperationInput,
): Pick<
  Parameters<typeof runDurableAnalysisMutation>[0],
  "signal" | "policy"
> {
  return {
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.policy === undefined ? {} : { policy: input.policy }),
  };
}

function commitStableManifest(
  input: DurableFastPassArtifactOperationInput,
  expected: AnalysisManifestRecord,
): Promise<DurableAnalysisMutationResult<AnalysisManifestRecord>> {
  const identity = identityFor(input);
  if (expected.runId !== identity.runId) {
    throw new TypeError("manifest runId must match the operation runId.");
  }

  return runDurableAnalysisMutation({
    identity,
    expected,
    isCurrent: input.isCurrent,
    mutate: async ({ identity: currentIdentity }) => {
      if (!input.isCurrent(currentIdentity)) {
        return {
          kind: "stale",
          reasonCode: "fast_pass_artifact_operation_stale",
        };
      }
      const inserted = await input.store.insertManifestIfAbsent(expected);
      return inserted
        ? { kind: "accepted" }
        : {
            kind: "conflict",
            reasonCode: "fast_pass_manifest_conflict",
          };
    },
    readback: () => input.store.getManifest(identity.runId),
    reconcile: ({ readback }) => {
      if (readback === null) {
        return {
          kind: "retry",
          reasonCode: "fast_pass_manifest_readback_missing",
        };
      }
      return jsonValuesExactlyMatch(readback, expected)
        ? { kind: "succeeded", value: expected }
        : currentConflict(
            input,
            identity,
            "fast_pass_manifest_conflict",
          );
    },
    classifyThrown: (cause, phase) =>
      classifyStoreException("manifest", cause, phase),
    ...mutationOptions(input),
  });
}

function validateFastPassBundle(
  input: CommitDurableFastPassResultInput,
  manifest: AnalysisManifestRecord,
  finalResult: FinalAnalysisResultRecord,
  terminal: AnalysisTerminalRecord,
): void {
  const records = [manifest, finalResult, terminal] as const;
  for (const record of records) {
    if (record.runId !== input.runId) {
      throw new TypeError(
        "Every fast-pass artifact must match the operation runId.",
      );
    }
  }
  if (
    manifest.inputSignature !== finalResult.inputSignature ||
    manifest.inputSignature !== terminal.inputSignature ||
    manifest.modelManifestHash !== finalResult.modelManifestHash ||
    manifest.modelManifestHash !== terminal.modelManifestHash ||
    manifest.schemaVersion !== finalResult.schemaVersion ||
    manifest.schemaVersion !== terminal.schemaVersion
  ) {
    throw new TypeError(
      "Fast-pass manifest, final result, and terminal must share one schema/input/model fence.",
    );
  }
  if (
    terminal.resultRecordKind !== "finalResult" ||
    terminal.resultArtifactId !== finalResult.artifactId ||
    !["completed", "completedWithGaps"].includes(terminal.outcome)
  ) {
    throw new TypeError(
      "Fast-pass terminal must point to the supplied completed final result.",
    );
  }
}

function failedArtifactResult<Value>(
  artifact: DurableFastPassArtifactName,
  result: Exclude<
    DurableAnalysisMutationResult<Value>,
    { readonly status: "succeeded" }
  >,
): DurableFastPassResultCommitFailure {
  return result.status === "aborted"
    ? {
        status: "aborted",
        artifact,
        attempts: result.attempts,
      }
    : {
        status: result.status,
        artifact,
        reasonCode: result.reasonCode,
        attempts: result.attempts,
      };
}

function asArtifactFailure(
  artifact: DurableFastPassArtifactName,
  result:
    | DurableAnalysisMutationResult<AnalysisManifestRecord>
    | DurableAnalysisMutationResult<FinalAnalysisResultRecord>
    | DurableAnalysisMutationResult<AnalysisTerminalRecord>
    | DurableAnalysisMutationResult<FastPassBundleSnapshot>,
): DurableFastPassResultCommitFailure {
  if (result.status === "succeeded") {
    throw new TypeError("A successful artifact cannot be mapped as a failure.");
  }
  return failedArtifactResult(
    artifact,
    result,
  );
}

function readFastPassBundle(
  input: DurableFastPassArtifactOperationInput,
): Promise<FastPassBundleSnapshot> {
  return Promise.all([
    input.store.getManifest(input.runId),
    input.store.getFinalResult(input.runId),
    input.store.getTerminalRecord(input.runId),
  ]).then(([manifest, finalResult, terminal]) => ({
    manifest,
    finalResult,
    terminal,
  }));
}

function bundleConflictReason(
  readback: FastPassBundleSnapshot,
  expected: FastPassResultArtifactBundle,
): string | null {
  if (
    readback.manifest !== null &&
    !jsonValuesExactlyMatch(readback.manifest, expected.manifest)
  ) {
    return "fast_pass_manifest_conflict";
  }
  if (
    readback.finalResult !== null &&
    !jsonValuesExactlyMatch(readback.finalResult, expected.finalResult)
  ) {
    return "fast_pass_finalResult_conflict";
  }
  if (
    readback.terminal !== null &&
    !jsonValuesExactlyMatch(readback.terminal, expected.terminal)
  ) {
    return "fast_pass_terminal_conflict";
  }
  return null;
}

function commitStableBundle(
  input: DurableFastPassArtifactOperationInput,
  expected: FastPassResultArtifactBundle,
): Promise<DurableAnalysisMutationResult<FastPassResultArtifactBundle>> {
  const identity = identityFor(input);
  return runDurableAnalysisMutation({
    identity,
    expected,
    isCurrent: input.isCurrent,
    mutate: async ({ identity: currentIdentity }) => {
      if (!input.isCurrent(currentIdentity)) {
        return {
          kind: "stale",
          reasonCode: "fast_pass_artifact_operation_stale",
        };
      }
      const committed =
        await input.store.commitFastPassResultBundleIfAbsent(expected);
      return committed
        ? { kind: "accepted" }
        : {
            kind: "conflict",
            reasonCode: "fast_pass_bundle_atomic_conflict",
          };
    },
    readback: () => readFastPassBundle(input),
    reconcile: ({ readback }) => {
      if (
        readback.manifest !== null &&
        readback.finalResult !== null &&
        readback.terminal !== null &&
        jsonValuesExactlyMatch(readback.manifest, expected.manifest) &&
        jsonValuesExactlyMatch(readback.finalResult, expected.finalResult) &&
        jsonValuesExactlyMatch(readback.terminal, expected.terminal)
      ) {
        return {
          kind: "succeeded",
          value: {
            manifest: readback.manifest,
            finalResult: readback.finalResult,
            terminal: readback.terminal,
          },
        };
      }
      const conflictReason = bundleConflictReason(readback, expected);
      if (conflictReason !== null) {
        return currentConflict(
          input,
          identity,
          conflictReason,
        );
      }
      return {
        kind: "retry",
        reasonCode: "fast_pass_bundle_readback_missing",
      };
    },
    classifyThrown: (cause, phase) =>
      classifyStoreException("bundleReadback", cause, phase),
    ...mutationOptions(input),
  });
}

function bundleFailureArtifact(
  result: Exclude<
    DurableAnalysisMutationResult<FastPassResultArtifactBundle>,
    { readonly status: "succeeded" }
  >,
): DurableFastPassArtifactName {
  if (result.status === "aborted") return "bundleReadback";
  if (result.reasonCode === "fast_pass_manifest_conflict") {
    return "manifest";
  }
  if (result.reasonCode === "fast_pass_finalResult_conflict") {
    return "finalResult";
  }
  if (result.reasonCode === "fast_pass_terminal_conflict") {
    return "terminal";
  }
  return "bundleReadback";
}

export function commitDurableFastPassManifest(
  input: CommitDurableFastPassManifestInput,
): Promise<DurableAnalysisMutationResult<AnalysisManifestRecord>> {
  const manifest = stableJsonSnapshot(input.manifest);
  return commitStableManifest(input, manifest);
}

/**
 * `commitFastResult` stage가 사용할 단일 공개 경계.
 *
 * finalResult만 쓴 뒤 cursor를 전진시키지 않는다. 동일 immutable snapshot의
 * manifest, finalResult, write-once terminal을 차례로 커밋하고 마지막에 세
 * 레코드를 모두 다시 읽어 exact match한 뒤에만 `succeeded`를 반환한다.
 */
export function commitDurableFastPassResult(
  input: CommitDurableFastPassResultInput,
): Promise<DurableFastPassResultCommitResult> {
  const manifest = stableJsonSnapshot(input.manifest);
  const finalResult = stableJsonSnapshot(input.finalResult);
  const terminal = stableJsonSnapshot(input.terminal);
  validateFastPassBundle(input, manifest, finalResult, terminal);

  return (async () => {
    const manifestResult = await commitStableManifest(input, manifest);
    if (manifestResult.status !== "succeeded") {
      return asArtifactFailure("manifest", manifestResult);
    }

    const bundleCommit = await commitStableBundle(input, {
      manifest,
      finalResult,
      terminal,
    });
    if (bundleCommit.status !== "succeeded") {
      return asArtifactFailure(
        bundleFailureArtifact(bundleCommit),
        bundleCommit,
      );
    }

    return {
      status: "succeeded",
      value: {
        manifest,
        finalResult,
        terminal,
        attempts: {
          manifest: manifestResult.attempts,
          finalResult: bundleCommit.attempts,
          terminal: bundleCommit.attempts,
          bundleReadback: bundleCommit.attempts,
        },
        recovered: manifestResult.recovered || bundleCommit.recovered,
      },
    };
  })();
}
