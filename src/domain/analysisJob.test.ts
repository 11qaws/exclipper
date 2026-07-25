import { describe, expect, it } from "vitest";

import { ANALYSIS_STAGES } from "./analysisRun";
import {
  createAnalysisJob,
  isEligibleForAutomaticCleanup,
  nextStageToRun,
  remainingStageCount,
  transitionAnalysisJob,
  type AnalysisJob,
  type AnalysisJobEvent,
} from "./analysisJob";

const IDENTITY = { scheme: "local-file-sampled-sha256-v1", key: "abc" };

function newJob(): AnalysisJob {
  return createAnalysisJob({ jobId: "job-1", identity: IDENTITY });
}

/** 이벤트를 순서대로 적용한다. 거부되면 그 자리에서 실패시킨다. */
function drive(job: AnalysisJob, events: readonly AnalysisJobEvent[]): AnalysisJob {
  return events.reduce((current, event) => {
    const outcome = transitionAnalysisJob(current, event);
    if (!outcome.accepted) {
      throw new Error(`거부됨: ${event.type} → ${outcome.reason}`);
    }
    return outcome.job;
  }, job);
}

const ALL_STAGES_COMMITTED: readonly AnalysisJobEvent[] = ANALYSIS_STAGES.map(
  (stage) => ({ type: "STAGE_COMMITTED", stage }) as const,
);

describe("analysis job", () => {
  it("starts queued with nothing committed", () => {
    const job = newJob();
    expect(job.status).toBe("queued");
    expect(job.lastCommittedStage).toBeNull();
    expect(nextStageToRun(job)).toBe(ANALYSIS_STAGES[0]);
  });

  it("rejects a transition that is not defined", () => {
    // 조용히 무시하면 상태가 어긋난 채 진행되고, 그 어긋남은 한참 뒤에 다른
    // 증상으로 나타난다.
    const outcome = transitionAnalysisJob(newJob(), { type: "PAUSE" });
    expect(outcome.accepted).toBe(false);
    if (!outcome.accepted) expect(outcome.reason).toBe("undefined_transition");
  });

  describe("pausing keeps the work", () => {
    it("returns to the same stage after a pause and resume", () => {
      const paused = drive(newJob(), [
        { type: "START", runId: "run-1" },
        { type: "STAGE_COMMITTED", stage: "preflight" },
        { type: "STAGE_COMMITTED", stage: "benchmark" },
        { type: "PAUSE" },
      ]);
      expect(paused.status).toBe("paused");
      expect(paused.lastCommittedStage).toBe("benchmark");
      expect(paused.activeRunId).toBeNull();

      const resumed = drive(paused, [{ type: "RESUME", runId: "run-2" }]);
      // 재개는 되돌리지 않는다 — 확정된 스테이지 다음부터다. 이것이 곧 캐시다.
      expect(resumed.lastCommittedStage).toBe("benchmark");
      expect(nextStageToRun(resumed)).toBe("prepareModels");
      expect(resumed.activeRunId).toBe("run-2");
    });

    it("counts only the stages still to do", () => {
      const job = drive(newJob(), [
        { type: "START", runId: "run-1" },
        { type: "STAGE_COMMITTED", stage: "preflight" },
        { type: "STAGE_COMMITTED", stage: "benchmark" },
      ]);
      expect(remainingStageCount(job)).toBe(ANALYSIS_STAGES.length - 2);
    });
  });

  describe("losing the source blocks rather than fails", () => {
    it("keeps committed stages when the source goes away", () => {
      const blocked = drive(newJob(), [
        { type: "START", runId: "run-1" },
        { type: "STAGE_COMMITTED", stage: "preflight" },
        { type: "SOURCE_LOST", availability: "needsPermission" },
      ]);
      expect(blocked.status).toBe("blocked");
      expect(blocked.source).toBe("needsPermission");
      expect(blocked.lastCommittedStage).toBe("preflight");

      const back = drive(blocked, [{ type: "SOURCE_RECONNECTED", runId: "run-2" }]);
      expect(back.status).toBe("running");
      expect(back.source).toBe("connected");
      expect(back.lastCommittedStage).toBe("preflight");
    });

    it("refuses to start while the source is unavailable", () => {
      const blocked = drive(newJob(), [
        { type: "START", runId: "run-1" },
        { type: "SOURCE_LOST", availability: "missing" },
      ]);
      const outcome = transitionAnalysisJob(blocked, { type: "RESUME", runId: "run-2" });
      expect(outcome.accepted).toBe(false);
      if (!outcome.accepted) expect(outcome.reason).toBe("undefined_transition");
    });
  });

  describe("invariants", () => {
    it("allows only one running job at a time", () => {
      const outcome = transitionAnalysisJob(
        newJob(),
        { type: "START", runId: "run-1" },
        { otherRunningJobCount: 1 },
      );
      expect(outcome.accepted).toBe(false);
      if (!outcome.accepted) expect(outcome.reason).toBe("another_job_is_running");
    });

    it("refuses a stage committed out of order", () => {
      // 순서가 깨진 채 커밋되면 재개 지점이 거짓이 되고, 그 위에서 캐시가
      // 잘못된 산출물을 재사용한다.
      const running = drive(newJob(), [{ type: "START", runId: "run-1" }]);
      const outcome = transitionAnalysisJob(running, {
        type: "STAGE_COMMITTED",
        stage: "deepPass",
      });
      expect(outcome.accepted).toBe(false);
      if (!outcome.accepted) expect(outcome.reason).toBe("stage_order_violation");
    });

    it("refuses to complete before every stage is committed", () => {
      const running = drive(newJob(), [
        { type: "START", runId: "run-1" },
        { type: "STAGE_COMMITTED", stage: "preflight" },
      ]);
      const outcome = transitionAnalysisJob(running, {
        type: "ALL_STAGES_DONE",
        quality: "usable",
      });
      expect(outcome.accepted).toBe(false);
      if (!outcome.accepted) expect(outcome.reason).toBe("stage_order_violation");
    });

    it("refuses to complete when the output is not usable", () => {
      // `done` 과 "쓸 만하다"를 한 값에 섞으면 캐시가 붙는 순간 쓸모없는 결과가
      // 영구히 재사용된다.
      const done = drive(newJob(), [
        { type: "START", runId: "run-1" },
        ...ALL_STAGES_COMMITTED,
      ]);
      for (const quality of ["empty", "suspect", "unknown"] as const) {
        const outcome = transitionAnalysisJob(done, { type: "ALL_STAGES_DONE", quality });
        expect(outcome.accepted, quality).toBe(false);
        if (!outcome.accepted) expect(outcome.reason).toBe("quality_not_usable");
      }
    });

    it("completes when every stage is committed and the output is usable", () => {
      const completed = drive(newJob(), [
        { type: "START", runId: "run-1" },
        ...ALL_STAGES_COMMITTED,
        { type: "ALL_STAGES_DONE", quality: "usable" },
      ]);
      expect(completed.status).toBe("completed");
      expect(nextStageToRun(completed)).toBeNull();
      expect(remainingStageCount(completed)).toBe(0);
    });

    it("absorbs events once terminal", () => {
      const completed = drive(newJob(), [
        { type: "START", runId: "run-1" },
        ...ALL_STAGES_COMMITTED,
        { type: "ALL_STAGES_DONE", quality: "usable" },
      ]);
      const outcome = transitionAnalysisJob(completed, { type: "PAUSE" });
      expect(outcome.accepted).toBe(false);
      if (!outcome.accepted) expect(outcome.reason).toBe("terminal_state_absorbing");
    });

    it("requires a reason code for every terminal failure", () => {
      const running = drive(newJob(), [{ type: "START", runId: "run-1" }]);
      const outcome = transitionAnalysisJob(running, { type: "FATAL", reasonCode: "" });
      expect(outcome.accepted).toBe(false);
      if (!outcome.accepted) expect(outcome.reason).toBe("missing_reason_code");
    });
  });

  describe("re-analysis returns the same job rather than making a new one", () => {
    it("sends a completed job back to queued and clears its progress", () => {
      const completed = drive(newJob(), [
        { type: "START", runId: "run-1" },
        ...ALL_STAGES_COMMITTED,
        { type: "ALL_STAGES_DONE", quality: "usable" },
      ]);
      const invalidated = drive(completed, [
        { type: "INVALIDATE", reasonCode: "model_manifest_changed" },
      ]);
      // 같은 jobId·identity 를 유지해야 이력과 식별이 이어진다.
      expect(invalidated.jobId).toBe(completed.jobId);
      expect(invalidated.identity).toEqual(completed.identity);
      expect(invalidated.status).toBe("queued");
      expect(invalidated.lastCommittedStage).toBeNull();
      expect(invalidated.quality).toBe("unknown");
      expect(invalidated.lastReasonCode).toBe("model_manifest_changed");
    });

    it("lets a failed job be retried", () => {
      const failed = drive(newJob(), [
        { type: "START", runId: "run-1" },
        { type: "FATAL", reasonCode: "worker_crashed" },
      ]);
      expect(failed.status).toBe("failed");
      const retried = drive(failed, [{ type: "RETRY", runId: "run-2" }]);
      expect(retried.status).toBe("running");
    });
  });

  describe("automatic cleanup never touches unfinished work", () => {
    const RETENTION = 30 * 24 * 60 * 60 * 1000;

    it("collects a completed job past its retention", () => {
      const completed = drive(newJob(), [
        { type: "START", runId: "run-1" },
        ...ALL_STAGES_COMMITTED,
        { type: "ALL_STAGES_DONE", quality: "usable" },
      ]);
      expect(isEligibleForAutomaticCleanup(completed, RETENTION + 1, RETENTION)).toBe(true);
      expect(isEligibleForAutomaticCleanup(completed, RETENTION - 1, RETENTION)).toBe(false);
    });

    it("never collects paused or blocked work, however old", () => {
      // 지우면 "한 번 들어온 영상은 마무리한다"는 약속을 화면이 스스로 깬다.
      const paused = drive(newJob(), [{ type: "START", runId: "run-1" }, { type: "PAUSE" }]);
      const blocked = drive(newJob(), [
        { type: "START", runId: "run-1" },
        { type: "SOURCE_LOST", availability: "needsPermission" },
      ]);
      const ancient = RETENTION * 100;
      expect(isEligibleForAutomaticCleanup(paused, ancient, RETENTION)).toBe(false);
      expect(isEligibleForAutomaticCleanup(blocked, ancient, RETENTION)).toBe(false);
    });
  });
});
