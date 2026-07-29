import {
  ANALYSIS_STAGES,
  type AnalysisStage,
} from "../domain/analysisRun";
import {
  transitionAnalysisJob,
  type AnalysisJob,
} from "../domain/analysisJob";
import {
  ANALYSIS_JOB_RECORD_SCHEMA_VERSION,
  AnalysisResultStoreError,
  analysisCompletionSnapshotsExactlyMatch,
  type AnalysisCompletionDurableReadback,
  type AnalysisCompletionDurableSnapshot,
  type AnalysisJobRecord,
  type AnalysisResultStore,
} from "../storage/analysisResultStore";
import {
  commitAnalysisStage,
  failAnalysisJob,
  JOB_IDENTITY_SCHEME,
  jobIdFor,
  pauseAnalysisJob,
  startAnalysisJob,
  type JobBridgeOutcome,
} from "./analysisJobBridge";
import {
  classifyDurableAnalysisBridgeRejection,
  runDurableAnalysisMutation,
  type DurableAnalysisMutationAttempt,
  type DurableAnalysisMutationIdentity,
  type DurableAnalysisMutationPolicy,
  type DurableAnalysisMutationReconciliation,
  type DurableAnalysisMutationResult,
} from "./durableAnalysisMutation";

export interface DurableAnalysisJobOperationInput {
  readonly store: AnalysisResultStore;
  readonly inputSignature: string;
  readonly runId: string;
  readonly operationToken: string;
  readonly isCurrent: (identity: DurableAnalysisMutationIdentity) => boolean;
  readonly signal?: AbortSignal;
  readonly policy?: Partial<DurableAnalysisMutationPolicy>;
}

export interface StartDurableAnalysisJobInput
  extends DurableAnalysisJobOperationInput {
  readonly otherRunningJobCount?: number;
}

export interface CommitDurableAnalysisStageInput
  extends DurableAnalysisJobOperationInput {
  readonly stage: AnalysisStage;
}

export interface CompleteDurableAnalysisJobInput
  extends DurableAnalysisJobOperationInput {
  readonly quality: "usable" | "empty";
  readonly expectedDurableSnapshot: AnalysisCompletionDurableSnapshot;
}

export interface FailDurableAnalysisJobInput
  extends DurableAnalysisJobOperationInput {
  readonly reasonCode: string;
}

export type DurableAnalysisJobOperationResult =
  DurableAnalysisMutationResult<AnalysisJob>;

type AnalysisJobExpectation =
  | { readonly kind: "start" }
  | { readonly kind: "stage"; readonly stage: AnalysisStage }
  | { readonly kind: "complete"; readonly quality: "usable" | "empty" }
  | { readonly kind: "pause" }
  | { readonly kind: "fail"; readonly reasonCode: string };

function asMutationAttempt(
  outcome: JobBridgeOutcome,
): DurableAnalysisMutationAttempt {
  if (outcome.ok) {
    return { kind: "accepted" };
  }

  /*
   * start/pause/fail을 같은 operationToken으로 다시 실행하면 bridge transition은
   * 이미 적용된 상태를 `undefined_transition` 또는
   * `terminal_state_absorbing`으로 거부한다. 이 둘은 readback이 정확한 결과를
   * 증명할 수 있으므로 conflict처럼 조정한다. 실제로 다른 상태라면 아래
   * operation별 reconcile이 permanent 또는 stale로 끝낸다.
   */
  if (
    outcome.failure === "transition" &&
    (outcome.reason === "undefined_transition" ||
      outcome.reason === "terminal_state_absorbing")
  ) {
    return {
      kind: "conflict",
      reasonCode: "analysis_job_transition_already_applied",
    };
  }
  return classifyDurableAnalysisBridgeRejection(outcome);
}

function classifyStoreException(
  cause: unknown,
  phase: "mutation" | "readback" | "reconciliation",
): Extract<
  DurableAnalysisMutationAttempt,
  { readonly kind: "retry" | "stale" | "permanent" }
> {
  if (phase === "reconciliation") {
    return {
      kind: "permanent",
      reasonCode: "analysis_job_reconciliation_failed",
    };
  }
  if (cause instanceof AnalysisResultStoreError) {
    return ["STORE_CLOSED", "INVALID_PAYLOAD", "SCHEMA_MISMATCH"].includes(
      cause.code,
    )
      ? {
          kind: "permanent",
          reasonCode: "analysis_job_store_rejected",
        }
      : {
          kind: "retry",
          reasonCode: "analysis_job_store_unavailable",
        };
  }
  /*
   * IndexedDB implementations may reject with a DOMException before wrapping
   * it. Mutation bridge calls normally catch their own failures; the direct
   * readback is the important path here and remains retryable.
   */
  return phase === "readback"
    ? {
        kind: "retry",
        reasonCode: "analysis_job_readback_failed",
      }
    : {
        kind: "permanent",
        reasonCode: "analysis_job_mutation_failed",
      };
}

function success(
  job: AnalysisJob,
): DurableAnalysisMutationReconciliation<AnalysisJob> {
  return { kind: "succeeded", value: job };
}

function retry(
  reasonCode: string,
): DurableAnalysisMutationReconciliation<AnalysisJob> {
  return { kind: "retry", reasonCode };
}

function stale(
  reasonCode: string,
): DurableAnalysisMutationReconciliation<AnalysisJob> {
  return { kind: "stale", reasonCode };
}

function permanent(
  reasonCode: string,
): DurableAnalysisMutationReconciliation<AnalysisJob> {
  return { kind: "permanent", reasonCode };
}

function currentJob(
  record: AnalysisJobRecord | null,
  inputSignature: string,
): AnalysisJob | DurableAnalysisMutationReconciliation<AnalysisJob> {
  if (record === null) {
    return retry("analysis_job_readback_missing");
  }
  if (
    record.jobId !== jobIdFor(inputSignature) ||
    record.job.identity.scheme !== JOB_IDENTITY_SCHEME ||
    record.job.identity.key !== inputSignature
  ) {
    return permanent("analysis_job_identity_mismatch");
  }
  return record.job;
}

function isReconciliation(
  value: AnalysisJob | DurableAnalysisMutationReconciliation<AnalysisJob>,
): value is DurableAnalysisMutationReconciliation<AnalysisJob> {
  return "kind" in value;
}

function runRelation(
  job: AnalysisJob,
  runId: string,
  allowNotStarted: boolean,
): "current" | "not-started" | "stale" | "missing" {
  if (job.activeRunId !== null && job.activeRunId !== runId) {
    return "stale";
  }
  const latestRunId = job.runIds.at(-1);
  if (latestRunId === runId) {
    return "current";
  }
  if (job.runIds.includes(runId)) {
    return "stale";
  }
  if (allowNotStarted) {
    return "not-started";
  }
  return latestRunId === undefined ? "missing" : "stale";
}

function committedStageIndex(stage: AnalysisStage | null): number {
  return stage === null ? -1 : ANALYSIS_STAGES.indexOf(stage);
}

function reconcileJob(
  inputSignature: string,
  runId: string,
  expectation: AnalysisJobExpectation,
  record: AnalysisJobRecord | null,
): DurableAnalysisMutationReconciliation<AnalysisJob> {
  const jobOrFailure = currentJob(record, inputSignature);
  if (isReconciliation(jobOrFailure)) {
    return jobOrFailure;
  }
  const job = jobOrFailure;
  const relation = runRelation(job, runId, expectation.kind === "start");
  if (relation === "stale") {
    return stale("analysis_job_superseded_by_another_run");
  }
  if (relation === "missing") {
    return permanent("analysis_job_run_missing");
  }

  switch (expectation.kind) {
    case "start":
      if (relation === "current" && job.status === "running") {
        return success(job);
      }
      if (relation === "not-started") {
        return retry("analysis_job_start_not_committed");
      }
      return permanent("analysis_job_start_state_mismatch");

    case "stage":
      if (
        committedStageIndex(job.lastCommittedStage) >=
        committedStageIndex(expectation.stage)
      ) {
        return success(job);
      }
      if (job.status === "running" && job.activeRunId === runId) {
        return retry("analysis_job_stage_not_committed");
      }
      return permanent("analysis_job_stage_state_mismatch");

    case "complete": {
      const expectedStatus =
        expectation.quality === "usable" ? "completed" : "completedEmpty";
      if (
        job.status === expectedStatus &&
        job.quality === expectation.quality &&
        job.activeRunId === null
      ) {
        return success(job);
      }
      if (job.status === "running" && job.activeRunId === runId) {
        return retry("analysis_job_completion_not_committed");
      }
      return permanent("analysis_job_completion_state_mismatch");
    }

    case "pause":
      if (job.status === "paused" && job.activeRunId === null) {
        return success(job);
      }
      if (job.status === "running" && job.activeRunId === runId) {
        return retry("analysis_job_pause_not_committed");
      }
      return permanent("analysis_job_pause_state_mismatch");

    case "fail":
      if (
        job.status === "failed" &&
        job.activeRunId === null &&
        job.lastReasonCode === expectation.reasonCode
      ) {
        return success(job);
      }
      if (job.status === "running" && job.activeRunId === runId) {
        return retry("analysis_job_failure_not_committed");
      }
      return permanent("analysis_job_failure_state_mismatch");
  }
}

function completionStorageFailure(cause: unknown): JobBridgeOutcome {
  const retryable =
    !(cause instanceof AnalysisResultStoreError) ||
    !["STORE_CLOSED", "INVALID_PAYLOAD", "SCHEMA_MISMATCH"].includes(
      cause.code,
    );
  return {
    ok: false,
    failure: "storage",
    retryable,
    reason: String((cause as Error)?.message ?? cause),
  };
}

async function completeAnalysisJobAgainstSnapshot(
  input: CompleteDurableAnalysisJobInput,
): Promise<JobBridgeOutcome> {
  const jobId = jobIdFor(input.inputSignature);
  try {
    const existing = await input.store.getJob(jobId);
    if (existing === null) {
      return {
        ok: false,
        failure: "transition",
        retryable: false,
        reason: "analysis_job_missing",
      };
    }
    if (
      existing.jobId !== jobId ||
      existing.job.identity.scheme !== JOB_IDENTITY_SCHEME ||
      existing.job.identity.key !== input.inputSignature
    ) {
      return {
        ok: false,
        failure: "transition",
        retryable: false,
        reason: "analysis_job_identity_mismatch",
      };
    }

    let completedJob: AnalysisJob;
    const expectedStatus =
      input.quality === "usable" ? "completed" : "completedEmpty";
    if (
      existing.job.status === expectedStatus &&
      existing.job.quality === input.quality &&
      existing.job.activeRunId === null &&
      existing.job.runIds.at(-1) === input.runId
    ) {
      completedJob = existing.job;
    } else {
      const transition = transitionAnalysisJob(existing.job, {
        type: "ALL_STAGES_DONE",
        runId: input.runId,
        quality: input.quality,
      });
      if (!transition.accepted) {
        return {
          ok: false,
          failure: "transition",
          retryable: false,
          reason: transition.reason,
        };
      }
      completedJob = transition.job;
    }

    const replacement: AnalysisJobRecord = {
      schemaVersion: ANALYSIS_JOB_RECORD_SCHEMA_VERSION,
      jobId,
      job: completedJob,
      lastActivityAt: new Date().toISOString(),
      bytes: existing.bytes,
    };
    const committed =
      await input.store.replaceJobIfAnalysisSnapshotUnchanged(
        existing,
        replacement,
        input.expectedDurableSnapshot,
      );
    if (!committed) {
      return {
        ok: false,
        failure: "conflict",
        retryable: false,
        reason: "analysis_job_or_completion_snapshot_changed",
      };
    }
    return { ok: true, job: completedJob };
  } catch (cause) {
    return completionStorageFailure(cause);
  }
}

function reconcileCompletion(
  inputSignature: string,
  runId: string,
  expectation: Extract<AnalysisJobExpectation, { readonly kind: "complete" }>,
  expectedSnapshot: AnalysisCompletionDurableSnapshot,
  readback: AnalysisCompletionDurableReadback,
): DurableAnalysisMutationReconciliation<AnalysisJob> {
  if (
    readback.snapshot === null ||
    !analysisCompletionSnapshotsExactlyMatch(
      expectedSnapshot,
      readback.snapshot,
    )
  ) {
    return stale("analysis_job_completion_snapshot_changed");
  }
  return reconcileJob(
    inputSignature,
    runId,
    expectation,
    readback.job,
  );
}

function runDurableJobOperation(
  input: DurableAnalysisJobOperationInput,
  expectation: AnalysisJobExpectation,
  mutate: () => Promise<JobBridgeOutcome>,
): Promise<DurableAnalysisJobOperationResult> {
  return runDurableAnalysisMutation({
    identity: {
      runId: input.runId,
      operationToken: input.operationToken,
    },
    expected: expectation,
    isCurrent: input.isCurrent,
    mutate: async () => asMutationAttempt(await mutate()),
    readback: () => input.store.getJob(jobIdFor(input.inputSignature)),
    reconcile: ({ expected, readback }) =>
      reconcileJob(input.inputSignature, input.runId, expected, readback),
    classifyThrown: classifyStoreException,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.policy === undefined ? {} : { policy: input.policy }),
  });
}

export function startDurableAnalysisJob(
  input: StartDurableAnalysisJobInput,
): Promise<DurableAnalysisJobOperationResult> {
  return runDurableJobOperation(input, { kind: "start" }, () =>
    startAnalysisJob({
      store: input.store,
      inputSignature: input.inputSignature,
      runId: input.runId,
      ...(input.otherRunningJobCount === undefined
        ? {}
        : { otherRunningJobCount: input.otherRunningJobCount }),
    }),
  );
}

export function commitDurableAnalysisStage(
  input: CommitDurableAnalysisStageInput,
): Promise<DurableAnalysisJobOperationResult> {
  return runDurableJobOperation(
    input,
    { kind: "stage", stage: input.stage },
    () =>
      commitAnalysisStage(
        input.store,
        input.inputSignature,
        input.runId,
        input.stage,
      ),
  );
}

export function completeDurableAnalysisJob(
  input: CompleteDurableAnalysisJobInput,
): Promise<DurableAnalysisJobOperationResult> {
  const expectation = {
    kind: "complete" as const,
    quality: input.quality,
  };
  return runDurableAnalysisMutation({
    identity: {
      runId: input.runId,
      operationToken: input.operationToken,
    },
    expected: expectation,
    isCurrent: input.isCurrent,
    mutate: async () =>
      asMutationAttempt(await completeAnalysisJobAgainstSnapshot(input)),
    readback: () =>
      input.store.getAnalysisCompletionReadback(
        jobIdFor(input.inputSignature),
        input.runId,
      ),
    reconcile: ({ expected, readback }) =>
      reconcileCompletion(
        input.inputSignature,
        input.runId,
        expected,
        input.expectedDurableSnapshot,
        readback,
      ),
    classifyThrown: classifyStoreException,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.policy === undefined ? {} : { policy: input.policy }),
  });
}

export function pauseDurableAnalysisJob(
  input: DurableAnalysisJobOperationInput,
): Promise<DurableAnalysisJobOperationResult> {
  return runDurableJobOperation(input, { kind: "pause" }, () =>
    pauseAnalysisJob(input.store, input.inputSignature, input.runId),
  );
}

export function failDurableAnalysisJob(
  input: FailDurableAnalysisJobInput,
): Promise<DurableAnalysisJobOperationResult> {
  const reasonCode =
    input.reasonCode.length > 0 ? input.reasonCode : "unknown_failure";
  return runDurableJobOperation(
    input,
    { kind: "fail", reasonCode },
    () =>
      failAnalysisJob(
        input.store,
        input.inputSignature,
        input.runId,
        reasonCode,
      ),
  );
}
