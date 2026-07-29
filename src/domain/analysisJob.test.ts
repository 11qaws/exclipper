import { describe, expect, it } from "vitest";

import { ANALYSIS_STAGES } from "./analysisRun";
import {
  createAnalysisJob,
  isEligibleForAutomaticCleanup,
  nextStageToRun,
  parseAnalysisJob,
  remainingStageCount,
  transitionAnalysisJob,
  type AnalysisJob,
  type AnalysisJobEvent,
} from "./analysisJob";

const IDENTITY = { scheme: "local-file-sampled-sha256-v1", key: "abc" };
const RUN_ID = "run-1";

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
  (stage) => ({ type: "STAGE_COMMITTED", runId: RUN_ID, stage }) as const,
);

describe("analysis job", () => {
  describe("current durable parser", () => {
    it("returns one canonical current job", () => {
      const job = createAnalysisJob({
        jobId: "job-current",
        identity: {
          scheme: "exclipper-input-signature-v1",
          key: "input-current",
          offsetMs: -250,
        },
      });

      expect(parseAnalysisJob(job)).toEqual(job);
    });

    it.each([
      {
        name: "an unsupported nested field",
        value: { ...newJob(), legacyResumeToken: "old-token" },
      },
      {
        name: "an unknown status",
        value: { ...newJob(), status: "interrupted" },
      },
      {
        name: "duplicate run ids",
        value: { ...newJob(), runIds: ["run-1", "run-1"] },
      },
      {
        name: "a running job without the latest active run",
        value: {
          ...newJob(),
          status: "running",
          runIds: ["run-1"],
          activeRunId: "run-2",
        },
      },
    ])("rejects $name", ({ value }) => {
      expect(() => parseAnalysisJob(value)).toThrow(TypeError);
    });
  });

  it("starts queued with nothing committed", () => {
    const job = newJob();
    expect(job.status).toBe("queued");
    expect(job.lastCommittedStage).toBeNull();
    expect(nextStageToRun(job)).toBe(ANALYSIS_STAGES[0]);
  });

  describe("remembering every run it spawned", () => {
    it("accumulates a run id each time work restarts", () => {
      const job = drive(newJob(), [
        { type: "START", runId: "run-1" },
        { type: "PAUSE", runId: "run-1" },
        { type: "RESUME", runId: "run-2" },
        { type: "SOURCE_LOST", runId: "run-2", availability: "needsPermission" },
        { type: "SOURCE_RECONNECTED", runId: "run-3" },
      ]);
      expect(job.runIds).toEqual(["run-1", "run-2", "run-3"]);
    });

    it("keeps the old run ids through an invalidation", () => {
      // 지우려면 어디에 있는지 알아야 한다. 여기서 잊으면 낡은 실행 결과가
      // 영원히 남고 용량 집계가 조용히 어긋난다.
      const invalidated = drive(newJob(), [
        { type: "START", runId: "run-1" },
        ...ALL_STAGES_COMMITTED,
        { type: "ALL_STAGES_DONE", runId: RUN_ID, quality: "usable" },
        { type: "INVALIDATE", reasonCode: "model_manifest_changed" },
      ]);
      expect(invalidated.runIds).toEqual(["run-1"]);
    });
  });

  it("rejects a transition that is not defined", () => {
    // 조용히 무시하면 상태가 어긋난 채 진행되고, 그 어긋남은 한참 뒤에 다른
    // 증상으로 나타난다.
    const outcome = transitionAnalysisJob(newJob(), {
      type: "PAUSE",
      runId: RUN_ID,
    });
    expect(outcome.accepted).toBe(false);
    if (!outcome.accepted) expect(outcome.reason).toBe("undefined_transition");
  });

  describe("pausing keeps the work", () => {
    it("returns to the same stage after a pause and resume", () => {
      const paused = drive(newJob(), [
        { type: "START", runId: "run-1" },
        { type: "STAGE_COMMITTED", runId: RUN_ID, stage: "preflight" },
        { type: "STAGE_COMMITTED", runId: RUN_ID, stage: "fastPass" },
        { type: "PAUSE", runId: RUN_ID },
      ]);
      expect(paused.status).toBe("paused");
      expect(paused.lastCommittedStage).toBe("fastPass");
      expect(paused.activeRunId).toBeNull();

      const resumed = drive(paused, [{ type: "RESUME", runId: "run-2" }]);
      // 재개는 되돌리지 않는다 — 확정된 스테이지 다음부터다. 이것이 곧 캐시다.
      expect(resumed.lastCommittedStage).toBe("fastPass");
      expect(nextStageToRun(resumed)).toBe("seedClustering");
      expect(resumed.activeRunId).toBe("run-2");
    });

    it("counts only the stages still to do", () => {
      const job = drive(newJob(), [
        { type: "START", runId: "run-1" },
        { type: "STAGE_COMMITTED", runId: RUN_ID, stage: "preflight" },
        { type: "STAGE_COMMITTED", runId: RUN_ID, stage: "fastPass" },
      ]);
      expect(remainingStageCount(job)).toBe(ANALYSIS_STAGES.length - 2);
    });
  });

  describe("losing the source blocks rather than fails", () => {
    it("keeps committed stages when the source goes away", () => {
      const blocked = drive(newJob(), [
        { type: "START", runId: "run-1" },
        { type: "STAGE_COMMITTED", runId: RUN_ID, stage: "preflight" },
        { type: "SOURCE_LOST", runId: RUN_ID, availability: "needsPermission" },
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
        { type: "SOURCE_LOST", runId: RUN_ID, availability: "missing" },
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
        runId: RUN_ID,
        stage: "deepPass",
      });
      expect(outcome.accepted).toBe(false);
      if (!outcome.accepted) expect(outcome.reason).toBe("stage_order_violation");
    });

    it("refuses a delayed stage commit from an older run", () => {
      const paused = drive(newJob(), [
        { type: "START", runId: "run-1" },
        { type: "PAUSE", runId: "run-1" },
      ]);
      const current = drive(paused, [{ type: "RESUME", runId: "run-2" }]);
      const outcome = transitionAnalysisJob(current, {
        type: "STAGE_COMMITTED",
        runId: "run-1",
        stage: "preflight",
      });

      expect(outcome.accepted).toBe(false);
      if (!outcome.accepted) {
        expect(outcome.reason).toBe("run_fence_mismatch");
      }
      expect(outcome.job.activeRunId).toBe("run-2");
      expect(outcome.job.lastCommittedStage).toBeNull();
    });

    it("refuses to complete before every stage is committed", () => {
      const running = drive(newJob(), [
        { type: "START", runId: "run-1" },
        { type: "STAGE_COMMITTED", runId: RUN_ID, stage: "preflight" },
      ]);
      const outcome = transitionAnalysisJob(running, {
        type: "ALL_STAGES_DONE",
        runId: RUN_ID,
        quality: "usable",
      });
      expect(outcome.accepted).toBe(false);
      if (!outcome.accepted) expect(outcome.reason).toBe("stage_order_violation");
    });

    it("keeps suspect or unknown output unfinished", () => {
      const done = drive(newJob(), [
        { type: "START", runId: "run-1" },
        ...ALL_STAGES_COMMITTED,
      ]);
      for (const quality of ["suspect", "unknown"] as const) {
        const outcome = transitionAnalysisJob(done, {
          type: "ALL_STAGES_DONE",
          runId: RUN_ID,
          quality,
        });
        expect(outcome.accepted, quality).toBe(false);
        if (!outcome.accepted) expect(outcome.reason).toBe("quality_not_usable");
      }
    });

    it("records a fully verified zero-candidate broadcast as a distinct completion", () => {
      const completed = drive(newJob(), [
        { type: "START", runId: "run-1" },
        ...ALL_STAGES_COMMITTED,
        { type: "ALL_STAGES_DONE", runId: RUN_ID, quality: "empty" },
      ]);

      expect(completed.status).toBe("completedEmpty");
      expect(completed.quality).toBe("empty");
      expect(nextStageToRun(completed)).toBeNull();
    });

    it("completes when every stage is committed and the output is usable", () => {
      const completed = drive(newJob(), [
        { type: "START", runId: "run-1" },
        ...ALL_STAGES_COMMITTED,
        { type: "ALL_STAGES_DONE", runId: RUN_ID, quality: "usable" },
      ]);
      expect(completed.status).toBe("completed");
      expect(nextStageToRun(completed)).toBeNull();
      expect(remainingStageCount(completed)).toBe(0);
    });

    it("absorbs events once terminal", () => {
      const completed = drive(newJob(), [
        { type: "START", runId: "run-1" },
        ...ALL_STAGES_COMMITTED,
        { type: "ALL_STAGES_DONE", runId: RUN_ID, quality: "usable" },
      ]);
      const outcome = transitionAnalysisJob(completed, {
        type: "PAUSE",
        runId: RUN_ID,
      });
      expect(outcome.accepted).toBe(false);
      if (!outcome.accepted) expect(outcome.reason).toBe("terminal_state_absorbing");
    });

    it("requires a reason code for every terminal failure", () => {
      const running = drive(newJob(), [{ type: "START", runId: "run-1" }]);
      const outcome = transitionAnalysisJob(running, {
        type: "FATAL",
        runId: RUN_ID,
        reasonCode: "",
      });
      expect(outcome.accepted).toBe(false);
      if (!outcome.accepted) expect(outcome.reason).toBe("missing_reason_code");
    });
  });

  describe("re-analysis returns the same job rather than making a new one", () => {
    it("sends a completed job back to queued and clears its progress", () => {
      const completed = drive(newJob(), [
        { type: "START", runId: "run-1" },
        ...ALL_STAGES_COMMITTED,
        { type: "ALL_STAGES_DONE", runId: RUN_ID, quality: "usable" },
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

    it("can re-analyse a completed empty broadcast", () => {
      const completed = drive(newJob(), [
        { type: "START", runId: "run-1" },
        ...ALL_STAGES_COMMITTED,
        { type: "ALL_STAGES_DONE", runId: RUN_ID, quality: "empty" },
      ]);
      const invalidated = drive(completed, [
        { type: "INVALIDATE", reasonCode: "reanalysis_requested" },
      ]);

      expect(invalidated.status).toBe("queued");
      expect(invalidated.quality).toBe("unknown");
    });

    it("lets a failed job be retried", () => {
      const failed = drive(newJob(), [
        { type: "START", runId: "run-1" },
        { type: "FATAL", runId: RUN_ID, reasonCode: "worker_crashed" },
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
        { type: "ALL_STAGES_DONE", runId: RUN_ID, quality: "usable" },
      ]);
      expect(isEligibleForAutomaticCleanup(completed, RETENTION + 1, RETENTION)).toBe(true);
      expect(isEligibleForAutomaticCleanup(completed, RETENTION - 1, RETENTION)).toBe(false);
    });

    it("collects a completed empty job by the same retention policy", () => {
      const completed = drive(newJob(), [
        { type: "START", runId: "run-1" },
        ...ALL_STAGES_COMMITTED,
        { type: "ALL_STAGES_DONE", runId: RUN_ID, quality: "empty" },
      ]);

      expect(isEligibleForAutomaticCleanup(completed, RETENTION + 1, RETENTION)).toBe(true);
    });

    it("never collects paused or blocked work, however old", () => {
      // 지우면 "한 번 들어온 영상은 마무리한다"는 약속을 화면이 스스로 깬다.
      const paused = drive(newJob(), [
        { type: "START", runId: RUN_ID },
        { type: "PAUSE", runId: RUN_ID },
      ]);
      const blocked = drive(newJob(), [
        { type: "START", runId: "run-1" },
        { type: "SOURCE_LOST", runId: RUN_ID, availability: "needsPermission" },
      ]);
      const ancient = RETENTION * 100;
      expect(isEligibleForAutomaticCleanup(paused, ancient, RETENTION)).toBe(false);
      expect(isEligibleForAutomaticCleanup(blocked, ancient, RETENTION)).toBe(false);
    });
  });
});
