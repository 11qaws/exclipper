/**
 * 파이프라인이 **실제로 하는 일**의 순서.
 *
 * 한때 여덟이었고 그 중 셋(`benchmark` · `prepareModels` · `boundary`)은 코드
 * 어디에서도 일어나지 않았다. 없는 단계를 목록에 두면 진행률이 시작하자마자
 * 이유 없이 차오르고, 정작 몇 분씩 걸리는 전체 맥락 탐색은 어느 단계에도 속하지
 * 않아 화면에서 사라진다 — **없는 일에 시간을 배분하고 있는 일은 안 보이는**
 * 상태가 된다.
 *
 * 이름은 코드에 있는 말을 쓴다. `boundary` 는 검토 화면에서 사용자가 하는 구간
 * 편집을 가리키므로 파이프라인 단계 이름으로 쓰지 않는다.
 */
export const ANALYSIS_STAGES = [
  /** 원본 열기 · 메타데이터 · 지문 계산 */
  "preflight",
  /** 방송 **전체**를 오디오·화면·채팅으로 훑는다 */
  "fastPass",
  /** 피크를 묶고 후보를 선별한다 */
  "seedClustering",
  /** 잠정·최종 결과를 저장한다 */
  "commitFastResult",
  /** 방송 전역 맥락 탐색 (원격 호출 여러 번) */
  "broadcastContext",
  /** 후보만 다시 읽는 정밀 분석 (유료) */
  "deepPass",
  /** 공개 게이트 · 순위 확정 */
  "publication",
] as const;

export type AnalysisStage = (typeof ANALYSIS_STAGES)[number];
export type AnalysisCompletionTarget = "completed" | "completedWithGaps";

type AnalysisRunBase = {
  readonly runId: string;
  readonly analysisSpecId: string;
  readonly sessionId: string;
  readonly writerEpoch: number;
  readonly inputSignature: string;
  readonly modelManifestHash: string;
  readonly workerEpoch: number;
  readonly fenceEpoch: number;
  readonly stage: AnalysisStage;
  readonly hasPartialResult: boolean;
};

export type AnalysisRunState =
  | (AnalysisRunBase & { readonly status: "created" })
  | (AnalysisRunBase & { readonly status: "starting" })
  | (AnalysisRunBase & { readonly status: "running" })
  | (AnalysisRunBase & {
      readonly status: "pausing";
      readonly activeChunksCheckpointed: boolean;
      readonly allWorkersPaused: boolean;
    })
  | (AnalysisRunBase & {
      readonly status: "paused";
      readonly pauseCheckpointId: string;
    })
  | (AnalysisRunBase & {
      readonly status: "resuming";
      readonly requestedWorkerEpoch: number;
    })
  | (AnalysisRunBase & {
      readonly status: "awaitingGapDecision";
      readonly unresolvedGapCount: number;
    })
  | (AnalysisRunBase & {
      readonly status: "finalizing";
      readonly completionTarget: AnalysisCompletionTarget;
      readonly acceptedGapCount: number;
    })
  | (AnalysisRunBase & {
      readonly status: "completing";
      readonly completionTarget: AnalysisCompletionTarget;
      readonly acceptedGapCount: number;
      readonly finalResultCommitId: string;
    })
  | (AnalysisRunBase & { readonly status: "completed" })
  | (AnalysisRunBase & {
      readonly status: "completedWithGaps";
      readonly acceptedGapCount: number;
    })
  | (AnalysisRunBase & {
      readonly status: "cancelling";
      readonly workersTerminated: boolean;
    })
  | (AnalysisRunBase & { readonly status: "cancelled" })
  | (AnalysisRunBase & {
      readonly status: "failing";
      readonly reasonCode: string;
    })
  | (AnalysisRunBase & {
      readonly status: "failed";
      readonly reasonCode: string;
    })
  | (AnalysisRunBase & {
      readonly status: "interrupted";
      readonly interruptionReason:
        | "session_lost"
        | "pause_timeout"
        | "session_will_end";
    });

export type GapApprovalRecord = {
  readonly gapId: string;
  readonly reason: string;
  readonly approvedBy: string;
};

export type AnalysisRunEvent =
  | { readonly type: "RUN_START_REQUESTED" }
  | {
      readonly type: "RUN_MANIFEST_COMMITTED";
      readonly workerEpoch: number;
    }
  | { readonly type: "STAGE_ADVANCED"; readonly stage: AnalysisStage }
  | { readonly type: "CHUNK_RESULT_READY" }
  | { readonly type: "CHUNK_COMMIT_SUCCEEDED" }
  | {
      readonly type: "ALL_PLANNED_INTERVALS_COVERED";
      readonly activeChunkCount: number;
    }
  | {
      readonly type: "UNRESOLVED_GAPS_FOUND";
      readonly unresolvedGapCount: number;
      readonly allGapsDocumented: boolean;
    }
  | { readonly type: "RETRY_GAPS_REQUESTED" }
  | {
      readonly type: "GAPS_ACCEPTED_BY_USER";
      readonly approvals: readonly GapApprovalRecord[];
    }
  | {
      readonly type: "GAPS_ACCEPTED_BY_EXPLICIT_POLICY";
      readonly policyId: string;
      readonly disclosedBeforeStart: boolean;
      readonly approvals: readonly GapApprovalRecord[];
    }
  | {
      readonly type: "FINAL_RESULT_COMMITTED";
      readonly commitId: string;
    }
  | {
      readonly type: "FULL_RESULT_REOPEN_VERIFIED";
      readonly plannedCoverageComplete: boolean;
      readonly activeChunkCount: number;
    }
  | {
      readonly type: "GAPPED_RESULT_REOPEN_VERIFIED";
      readonly plannedCoverageExplained: boolean;
      readonly acceptedGapsHaveApproval: boolean;
      readonly activeChunkCount: number;
    }
  | { readonly type: "PAUSE_REQUESTED" }
  | { readonly type: "ACTIVE_CHUNKS_CHECKPOINTED" }
  | { readonly type: "ALL_WORKERS_PAUSED_ACK" }
  | {
      readonly type: "PAUSE_RECORD_COMMITTED";
      readonly checkpointId: string;
    }
  | { readonly type: "PAUSE_TIMEOUT" }
  | {
      readonly type: "RESUME_REQUESTED_SAME_SESSION";
      readonly sessionId: string;
      readonly writerEpoch: number;
      readonly analysisSpecId: string;
      readonly modelManifestHash: string;
      readonly nextWorkerEpoch: number;
    }
  | {
      readonly type: "NEW_WORKER_EPOCH_COMMITTED";
      readonly workerEpoch: number;
      readonly workerInstanceId: string;
      readonly taskId: string;
    }
  | { readonly type: "SESSION_WILL_END" }
  | { readonly type: "RESUME_WITH_CHANGED_SNAPSHOT" }
  | { readonly type: "CANCEL_REQUESTED" }
  | { readonly type: "WORKERS_TERMINATED" }
  | {
      readonly type: "CANCELLATION_COMMITTED";
      readonly writeFenceCommitted: boolean;
      readonly writerEpochInvalidated: boolean;
    }
  | { readonly type: "FATAL_ERROR"; readonly reasonCode: string }
  | { readonly type: "FAILURE_RECORD_COMMITTED" }
  | { readonly type: "SESSION_LOST" };

export type AnalysisRunRejectionReason =
  | "terminal_state_absorbing"
  | "undefined_transition"
  | "worker_epoch_not_advanced"
  | "invalid_worker_identity"
  | "invalid_stage_order"
  | "active_chunks_remaining"
  | "gaps_not_documented"
  | "gap_approval_missing"
  | "explicit_policy_not_predeclared"
  | "invalid_commit_id"
  | "pause_not_confirmed"
  | "resume_context_mismatch"
  | "resume_worker_epoch_mismatch"
  | "cancellation_not_fenced"
  | "missing_reason_code"
  | "completion_target_mismatch"
  | "coverage_not_verified";

export type AnalysisRunTransitionOutcome =
  | { readonly accepted: true; readonly state: AnalysisRunState }
  | {
      readonly accepted: false;
      readonly state: AnalysisRunState;
      readonly reason: AnalysisRunRejectionReason;
    };

export type CreateAnalysisRunInput = {
  readonly runId: string;
  readonly analysisSpecId: string;
  readonly sessionId: string;
  readonly writerEpoch: number;
  readonly inputSignature: string;
  readonly modelManifestHash: string;
  readonly stage?: AnalysisStage;
};

const TERMINAL_ANALYSIS_STATUSES = new Set<AnalysisRunState["status"]>([
  "completed",
  "completedWithGaps",
  "cancelled",
  "failed",
  "interrupted",
]);

const FATAL_ALLOWED_STATUSES = new Set<AnalysisRunState["status"]>([
  "starting",
  "running",
  "pausing",
  "resuming",
  "awaitingGapDecision",
  "finalizing",
  "completing",
]);

const CANCEL_ALLOWED_STATUSES = new Set<AnalysisRunState["status"]>([
  "created",
  "starting",
  "running",
  "pausing",
  "paused",
  "resuming",
  "awaitingGapDecision",
  "finalizing",
]);

const NEXT_STAGE: Partial<Record<AnalysisStage, AnalysisStage>> = {
  preflight: "fastPass",
  fastPass: "seedClustering",
  seedClustering: "commitFastResult",
  commitFastResult: "broadcastContext",
  broadcastContext: "deepPass",
  deepPass: "publication",
};

export function createAnalysisRun(
  input: CreateAnalysisRunInput,
): AnalysisRunState {
  return {
    runId: input.runId,
    analysisSpecId: input.analysisSpecId,
    sessionId: input.sessionId,
    writerEpoch: input.writerEpoch,
    inputSignature: input.inputSignature,
    modelManifestHash: input.modelManifestHash,
    workerEpoch: 0,
    fenceEpoch: 0,
    stage: input.stage ?? "preflight",
    hasPartialResult: false,
    status: "created",
  };
}

export function isAnalysisRunTerminal(state: AnalysisRunState): boolean {
  return TERMINAL_ANALYSIS_STATUSES.has(state.status);
}

function baseOf(state: AnalysisRunState): AnalysisRunBase {
  return {
    runId: state.runId,
    analysisSpecId: state.analysisSpecId,
    sessionId: state.sessionId,
    writerEpoch: state.writerEpoch,
    inputSignature: state.inputSignature,
    modelManifestHash: state.modelManifestHash,
    workerEpoch: state.workerEpoch,
    fenceEpoch: state.fenceEpoch,
    stage: state.stage,
    hasPartialResult: state.hasPartialResult,
  };
}

function accept(state: AnalysisRunState): AnalysisRunTransitionOutcome {
  return { accepted: true, state };
}

function reject(
  state: AnalysisRunState,
  reason: AnalysisRunRejectionReason,
): AnalysisRunTransitionOutcome {
  return { accepted: false, state, reason };
}

function interrupt(
  state: AnalysisRunState,
  interruptionReason: Extract<
    AnalysisRunState,
    { readonly status: "interrupted" }
  >["interruptionReason"],
): AnalysisRunTransitionOutcome {
  return accept({
    ...baseOf(state),
    status: "interrupted",
    fenceEpoch: state.fenceEpoch + 1,
    interruptionReason,
  });
}

function approvalsAreComplete(
  approvals: readonly GapApprovalRecord[],
  expectedCount: number,
): boolean {
  return (
    approvals.length === expectedCount &&
    approvals.every(
      ({ gapId, reason, approvedBy }) =>
        gapId.trim().length > 0 &&
        reason.trim().length > 0 &&
        approvedBy.trim().length > 0,
    )
  );
}

function assertNever(value: never): never {
  throw new Error(`Unhandled AnalysisRun state: ${JSON.stringify(value)}`);
}

/** Pure reducer for one immutable AnalysisSpec execution attempt. */
export function reduceAnalysisRun(
  state: AnalysisRunState,
  event: AnalysisRunEvent,
): AnalysisRunTransitionOutcome {
  if (isAnalysisRunTerminal(state)) {
    return reject(state, "terminal_state_absorbing");
  }

  if (event.type === "SESSION_LOST") {
    return interrupt(state, "session_lost");
  }

  if (
    event.type === "CANCEL_REQUESTED" &&
    CANCEL_ALLOWED_STATUSES.has(state.status)
  ) {
    return accept({
      ...baseOf(state),
      status: "cancelling",
      fenceEpoch: state.fenceEpoch + 1,
      workersTerminated: false,
    });
  }

  if (
    event.type === "FATAL_ERROR" &&
    FATAL_ALLOWED_STATUSES.has(state.status)
  ) {
    if (event.reasonCode.trim().length === 0) {
      return reject(state, "missing_reason_code");
    }
    return accept({
      ...baseOf(state),
      status: "failing",
      fenceEpoch: state.fenceEpoch + 1,
      reasonCode: event.reasonCode,
    });
  }

  switch (state.status) {
    case "created":
      if (event.type === "RUN_START_REQUESTED") {
        return accept({ ...baseOf(state), status: "starting" });
      }
      return reject(state, "undefined_transition");

    case "starting":
      if (event.type === "RUN_MANIFEST_COMMITTED") {
        if (event.workerEpoch <= state.workerEpoch) {
          return reject(state, "worker_epoch_not_advanced");
        }
        return accept({
          ...baseOf(state),
          status: "running",
          workerEpoch: event.workerEpoch,
        });
      }
      return reject(state, "undefined_transition");

    case "running":
      if (event.type === "STAGE_ADVANCED") {
        if (NEXT_STAGE[state.stage] !== event.stage) {
          return reject(state, "invalid_stage_order");
        }
        return accept({ ...state, stage: event.stage });
      }

      if (event.type === "CHUNK_RESULT_READY") {
        return accept(state);
      }

      if (event.type === "CHUNK_COMMIT_SUCCEEDED") {
        return accept({ ...state, hasPartialResult: true });
      }

      if (event.type === "ALL_PLANNED_INTERVALS_COVERED") {
        if (event.activeChunkCount !== 0) {
          return reject(state, "active_chunks_remaining");
        }
        return accept({
          ...baseOf(state),
          status: "finalizing",
          completionTarget: "completed",
          acceptedGapCount: 0,
        });
      }

      if (event.type === "UNRESOLVED_GAPS_FOUND") {
        if (
          event.unresolvedGapCount <= 0 ||
          !event.allGapsDocumented
        ) {
          return reject(state, "gaps_not_documented");
        }
        return accept({
          ...baseOf(state),
          status: "awaitingGapDecision",
          unresolvedGapCount: event.unresolvedGapCount,
        });
      }

      if (event.type === "PAUSE_REQUESTED") {
        return accept({
          ...baseOf(state),
          status: "pausing",
          activeChunksCheckpointed: false,
          allWorkersPaused: false,
        });
      }
      return reject(state, "undefined_transition");

    case "pausing":
      if (event.type === "ACTIVE_CHUNKS_CHECKPOINTED") {
        return accept({ ...state, activeChunksCheckpointed: true });
      }
      if (event.type === "ALL_WORKERS_PAUSED_ACK") {
        return accept({ ...state, allWorkersPaused: true });
      }
      if (event.type === "PAUSE_RECORD_COMMITTED") {
        if (!state.activeChunksCheckpointed || !state.allWorkersPaused) {
          return reject(state, "pause_not_confirmed");
        }
        if (event.checkpointId.trim().length === 0) {
          return reject(state, "invalid_commit_id");
        }
        return accept({
          ...baseOf(state),
          status: "paused",
          pauseCheckpointId: event.checkpointId,
        });
      }
      if (event.type === "PAUSE_TIMEOUT") {
        return interrupt(state, "pause_timeout");
      }
      return reject(state, "undefined_transition");

    case "paused":
      if (event.type === "RESUME_REQUESTED_SAME_SESSION") {
        if (
          event.sessionId !== state.sessionId ||
          event.writerEpoch !== state.writerEpoch ||
          event.analysisSpecId !== state.analysisSpecId ||
          event.modelManifestHash !== state.modelManifestHash
        ) {
          return reject(state, "resume_context_mismatch");
        }
        if (event.nextWorkerEpoch <= state.workerEpoch) {
          return reject(state, "worker_epoch_not_advanced");
        }
        return accept({
          ...baseOf(state),
          status: "resuming",
          requestedWorkerEpoch: event.nextWorkerEpoch,
        });
      }
      if (event.type === "SESSION_WILL_END") {
        return interrupt(state, "session_will_end");
      }
      if (event.type === "RESUME_WITH_CHANGED_SNAPSHOT") {
        return accept({
          ...baseOf(state),
          status: "cancelling",
          fenceEpoch: state.fenceEpoch + 1,
          workersTerminated: false,
        });
      }
      return reject(state, "undefined_transition");

    case "resuming":
      if (event.type === "NEW_WORKER_EPOCH_COMMITTED") {
        if (event.workerEpoch !== state.requestedWorkerEpoch) {
          return reject(state, "resume_worker_epoch_mismatch");
        }
        if (
          event.workerInstanceId.trim().length === 0 ||
          event.taskId.trim().length === 0
        ) {
          return reject(state, "invalid_worker_identity");
        }
        return accept({
          ...baseOf(state),
          status: "running",
          workerEpoch: event.workerEpoch,
        });
      }
      return reject(state, "undefined_transition");

    case "awaitingGapDecision":
      if (event.type === "RETRY_GAPS_REQUESTED") {
        return accept({ ...baseOf(state), status: "running" });
      }

      if (event.type === "GAPS_ACCEPTED_BY_USER") {
        if (!approvalsAreComplete(event.approvals, state.unresolvedGapCount)) {
          return reject(state, "gap_approval_missing");
        }
        return accept({
          ...baseOf(state),
          status: "finalizing",
          completionTarget: "completedWithGaps",
          acceptedGapCount: event.approvals.length,
        });
      }

      if (event.type === "GAPS_ACCEPTED_BY_EXPLICIT_POLICY") {
        if (
          !event.disclosedBeforeStart ||
          event.policyId.trim().length === 0
        ) {
          return reject(state, "explicit_policy_not_predeclared");
        }
        if (!approvalsAreComplete(event.approvals, state.unresolvedGapCount)) {
          return reject(state, "gap_approval_missing");
        }
        return accept({
          ...baseOf(state),
          status: "finalizing",
          completionTarget: "completedWithGaps",
          acceptedGapCount: event.approvals.length,
        });
      }
      return reject(state, "undefined_transition");

    case "finalizing":
      if (event.type === "FINAL_RESULT_COMMITTED") {
        if (event.commitId.trim().length === 0) {
          return reject(state, "invalid_commit_id");
        }
        return accept({
          ...baseOf(state),
          status: "completing",
          completionTarget: state.completionTarget,
          acceptedGapCount: state.acceptedGapCount,
          finalResultCommitId: event.commitId,
        });
      }
      return reject(state, "undefined_transition");

    case "completing":
      if (event.type === "FULL_RESULT_REOPEN_VERIFIED") {
        if (state.completionTarget !== "completed") {
          return reject(state, "completion_target_mismatch");
        }
        if (
          !event.plannedCoverageComplete ||
          event.activeChunkCount !== 0
        ) {
          return reject(state, "coverage_not_verified");
        }
        return accept({ ...baseOf(state), status: "completed" });
      }

      if (event.type === "GAPPED_RESULT_REOPEN_VERIFIED") {
        if (state.completionTarget !== "completedWithGaps") {
          return reject(state, "completion_target_mismatch");
        }
        if (
          !event.plannedCoverageExplained ||
          !event.acceptedGapsHaveApproval ||
          event.activeChunkCount !== 0
        ) {
          return reject(state, "coverage_not_verified");
        }
        return accept({
          ...baseOf(state),
          status: "completedWithGaps",
          acceptedGapCount: state.acceptedGapCount,
        });
      }
      return reject(state, "undefined_transition");

    case "cancelling":
      if (event.type === "WORKERS_TERMINATED") {
        return accept({ ...state, workersTerminated: true });
      }
      if (event.type === "CANCELLATION_COMMITTED") {
        if (
          !event.writeFenceCommitted ||
          (!state.workersTerminated && !event.writerEpochInvalidated)
        ) {
          return reject(state, "cancellation_not_fenced");
        }
        return accept({ ...baseOf(state), status: "cancelled" });
      }
      return reject(state, "undefined_transition");

    case "failing":
      if (event.type === "FAILURE_RECORD_COMMITTED") {
        return accept({
          ...baseOf(state),
          status: "failed",
          reasonCode: state.reasonCode,
        });
      }
      return reject(state, "undefined_transition");

    case "completed":
    case "completedWithGaps":
    case "cancelled":
    case "failed":
    case "interrupted":
      return reject(state, "terminal_state_absorbing");

    default:
      return assertNever(state);
  }
}
