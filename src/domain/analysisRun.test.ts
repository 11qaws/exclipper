import { describe, expect, it } from "vitest";

import {
  createAnalysisRun,
  reduceAnalysisRun,
  type AnalysisRunEvent,
  type AnalysisRunState,
} from "./analysisRun";

const makeCreated = (): AnalysisRunState =>
  createAnalysisRun({
    runId: "run-1",
    analysisSpecId: "spec-1",
    sessionId: "session-1",
    writerEpoch: 4,
    inputSignature: "input-signature-1",
    modelManifestHash: "model-hash-1",
  });

function apply(
  state: AnalysisRunState,
  event: AnalysisRunEvent,
): AnalysisRunState {
  const outcome = reduceAnalysisRun(state, event);
  expect(outcome.accepted).toBe(true);
  if (!outcome.accepted) {
    throw new Error(`Expected accepted transition, got ${outcome.reason}`);
  }
  return outcome.state;
}

function makeRunning(): AnalysisRunState {
  let state = apply(makeCreated(), { type: "RUN_START_REQUESTED" });
  state = apply(state, {
    type: "RUN_MANIFEST_COMMITTED",
    workerEpoch: 1,
  });
  return state;
}

describe("AnalysisRun reducer", () => {
  it("commits a full happy path only after final result reopen verification", () => {
    let state = makeRunning();
    state = apply(state, { type: "CHUNK_COMMIT_SUCCEEDED" });
    expect(state.hasPartialResult).toBe(true);

    state = apply(state, {
      type: "ALL_PLANNED_INTERVALS_COVERED",
      activeChunkCount: 0,
    });
    expect(state.status).toBe("finalizing");

    state = apply(state, {
      type: "FINAL_RESULT_COMMITTED",
      commitId: "final-commit-1",
    });
    expect(state.status).toBe("completing");

    state = apply(state, {
      type: "FULL_RESULT_REOPEN_VERIFIED",
      plannedCoverageComplete: true,
      activeChunkCount: 0,
    });
    expect(state.status).toBe("completed");
  });

  it("rejects events that are not defined for the current lifecycle state", () => {
    const state = makeCreated();
    const outcome = reduceAnalysisRun(state, { type: "CHUNK_RESULT_READY" });

    expect(outcome).toEqual({
      accepted: false,
      state,
      reason: "undefined_transition",
    });
  });

  it("keeps stage independent across pause and confirmed same-session resume", () => {
    let state = makeRunning();
    state = apply(state, { type: "STAGE_ADVANCED", stage: "fastPass" });
    state = apply(state, { type: "PAUSE_REQUESTED" });

    const tooEarly = reduceAnalysisRun(state, {
      type: "PAUSE_RECORD_COMMITTED",
      checkpointId: "checkpoint-1",
    });
    expect(tooEarly).toMatchObject({
      accepted: false,
      reason: "pause_not_confirmed",
    });

    state = apply(state, { type: "ACTIVE_CHUNKS_CHECKPOINTED" });
    state = apply(state, { type: "ALL_WORKERS_PAUSED_ACK" });
    state = apply(state, {
      type: "PAUSE_RECORD_COMMITTED",
      checkpointId: "checkpoint-1",
    });
    expect(state.status).toBe("paused");
    expect(state.stage).toBe("fastPass");

    const wrongSession = reduceAnalysisRun(state, {
      type: "RESUME_REQUESTED_SAME_SESSION",
      sessionId: "old-session",
      writerEpoch: 4,
      analysisSpecId: "spec-1",
      modelManifestHash: "model-hash-1",
      nextWorkerEpoch: 2,
    });
    expect(wrongSession).toMatchObject({
      accepted: false,
      reason: "resume_context_mismatch",
    });

    state = apply(state, {
      type: "RESUME_REQUESTED_SAME_SESSION",
      sessionId: "session-1",
      writerEpoch: 4,
      analysisSpecId: "spec-1",
      modelManifestHash: "model-hash-1",
      nextWorkerEpoch: 2,
    });
    expect(state.status).toBe("resuming");

    state = apply(state, {
      type: "NEW_WORKER_EPOCH_COMMITTED",
      workerEpoch: 2,
      workerInstanceId: "worker-2",
      taskId: "task-2",
    });
    expect(state).toMatchObject({
      status: "running",
      stage: "fastPass",
      workerEpoch: 2,
    });
  });

  it("requires an explicit, documented gap decision before limited completion", () => {
    let state = makeRunning();
    state = apply(state, {
      type: "UNRESOLVED_GAPS_FOUND",
      unresolvedGapCount: 1,
      allGapsDocumented: true,
    });

    const missingApproval = reduceAnalysisRun(state, {
      type: "GAPS_ACCEPTED_BY_USER",
      approvals: [],
    });
    expect(missingApproval).toMatchObject({
      accepted: false,
      reason: "gap_approval_missing",
    });

    state = apply(state, {
      type: "GAPS_ACCEPTED_BY_USER",
      approvals: [
        {
          gapId: "gap-1",
          reason: "decoder could not read this interval",
          approvedBy: "local-user",
        },
      ],
    });
    state = apply(state, {
      type: "FINAL_RESULT_COMMITTED",
      commitId: "final-gap-commit",
    });

    const wrongCompletion = reduceAnalysisRun(state, {
      type: "FULL_RESULT_REOPEN_VERIFIED",
      plannedCoverageComplete: true,
      activeChunkCount: 0,
    });
    expect(wrongCompletion).toMatchObject({
      accepted: false,
      reason: "completion_target_mismatch",
    });

    state = apply(state, {
      type: "GAPPED_RESULT_REOPEN_VERIFIED",
      plannedCoverageExplained: true,
      acceptedGapsHaveApproval: true,
      activeChunkCount: 0,
    });
    expect(state).toMatchObject({
      status: "completedWithGaps",
      acceptedGapCount: 1,
    });
  });

  it("does not confirm cancellation before both a write fence and worker stop", () => {
    let state = apply(makeRunning(), { type: "CANCEL_REQUESTED" });
    expect(state.status).toBe("cancelling");

    const premature = reduceAnalysisRun(state, {
      type: "CANCELLATION_COMMITTED",
      writeFenceCommitted: true,
      writerEpochInvalidated: false,
    });
    expect(premature).toMatchObject({
      accepted: false,
      reason: "cancellation_not_fenced",
    });

    state = apply(state, { type: "WORKERS_TERMINATED" });
    state = apply(state, {
      type: "CANCELLATION_COMMITTED",
      writeFenceCommitted: true,
      writerEpochInvalidated: false,
    });
    expect(state.status).toBe("cancelled");
  });

  it("distinguishes fatal failure from session interruption", () => {
    let failed = apply(makeRunning(), {
      type: "FATAL_ERROR",
      reasonCode: "analysis_chunk_decode_failed",
    });
    expect(failed.status).toBe("failing");
    failed = apply(failed, { type: "FAILURE_RECORD_COMMITTED" });

    const interrupted = apply(makeRunning(), { type: "SESSION_LOST" });
    expect(failed.status).toBe("failed");
    expect(interrupted.status).toBe("interrupted");
  });

  it("makes every terminal state absorbing", () => {
    const terminalStates: AnalysisRunState[] = [
      { ...makeCreated(), status: "completed" },
      { ...makeCreated(), status: "completedWithGaps", acceptedGapCount: 1 },
      { ...makeCreated(), status: "cancelled" },
      {
        ...makeCreated(),
        status: "failed",
        reasonCode: "analysis_chunk_decode_failed",
      },
      {
        ...makeCreated(),
        status: "interrupted",
        interruptionReason: "session_lost",
      },
    ];

    for (const state of terminalStates) {
      const outcome = reduceAnalysisRun(state, { type: "RUN_START_REQUESTED" });
      expect(outcome).toEqual({
        accepted: false,
        state,
        reason: "terminal_state_absorbing",
      });
    }
  });
});
