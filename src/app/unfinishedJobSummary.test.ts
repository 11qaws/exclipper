import { describe, expect, it } from "vitest";

import { ANALYSIS_STAGES } from "../domain/analysisRun";
import {
  createAnalysisJob,
  transitionAnalysisJob,
  type AnalysisJob,
  type AnalysisJobEvent,
} from "../domain/analysisJob";
import {
  committedPercent,
  deleteConfirmationText,
  selectUnfinishedJobs,
  summarizeUnfinishedJob,
} from "./unfinishedJobSummary";

const SIX_HOURS = 6 * 60 * 60 * 1000;

function drive(job: AnalysisJob, events: readonly AnalysisJobEvent[]): AnalysisJob {
  return events.reduce((current, event) => {
    const outcome = transitionAnalysisJob(current, event);
    if (!outcome.accepted) throw new Error(`거부됨: ${event.type} → ${outcome.reason}`);
    return outcome.job;
  }, job);
}

/** 스테이지 `stagesDone` 개까지 확정한 뒤 멈춘 작업. */
function pausedAt(stagesDone: number, jobId = "job-1"): AnalysisJob {
  const base = createAnalysisJob({
    jobId,
    identity: { scheme: "local-file-sampled-sha256-v1", key: jobId },
  });
  return drive(base, [
    { type: "START", runId: "run-1" },
    ...ANALYSIS_STAGES.slice(0, stagesDone).map(
      (stage) => ({ type: "STAGE_COMMITTED", stage }) as const,
    ),
    { type: "PAUSE" },
  ]);
}

/** 이어서 돌 수 있는 경우. 파이프라인이 스테이지를 확정하게 되면 이것이 기본이 된다. */
function summarize(job: AnalysisJob, title = "릴레이 방송") {
  return summarizeUnfinishedJob({
    job,
    title,
    sourceDurationMs: SIX_HOURS,
    resumeSupported: true,
  });
}

/** 지금의 기본값 — 건너뛸 스테이지가 없어 처음부터 다시 돈다. */
function summarizeToday(job: AnalysisJob, title = "릴레이 방송") {
  return summarizeUnfinishedJob({ job, title, sourceDurationMs: SIX_HOURS });
}

describe("unfinished job summary", () => {
  describe("progress", () => {
    it("reports nothing committed as zero", () => {
      expect(committedPercent(pausedAt(0))).toBe(0);
    });

    it("counts only committed stages", () => {
      // 스테이지 수가 홀수라 절반이 딱 떨어지지 않는다. 비율 자체를 검사한다.
      const half = Math.floor(ANALYSIS_STAGES.length / 2);
      expect(committedPercent(pausedAt(half))).toBe(
        Math.round((half / ANALYSIS_STAGES.length) * 100),
      );
    });

    it("always reaches a hundred once every stage is committed", () => {
      // 진행률을 보여도 되는 이유가 이것이다 — 후보 개수와 달리 반드시 도달한다.
      expect(committedPercent(pausedAt(ANALYSIS_STAGES.length))).toBe(100);
    });
  });

  describe("the two times", () => {
    it("shows the remaining time against the full time", () => {
      // 대비가 없으면 "약 4분" 이 큰지 작은지 알 수 없다. 그 대비가 돌아올 이유다.
      const summary = summarize(pausedAt(6));
      expect(summary.remainingLabel).toMatch(/^약 /);
      expect(summary.fromScratchLabel).toMatch(/^처음부터 약 /);
    });

    it("leaves less to do the further along it is", () => {
      const early = summarize(pausedAt(2));
      const late = summarize(pausedAt(6));
      const minutes = (label: string) => Number(/(\d+)/.exec(label)?.[1] ?? 0);
      expect(minutes(late.remainingLabel)).toBeLessThan(minutes(early.remainingLabel));
    });

    it("keeps the full time fixed however far along it is", () => {
      expect(summarize(pausedAt(2)).fromScratchLabel).toBe(
        summarize(pausedAt(6)).fromScratchLabel,
      );
    });
  });

  describe("the primary button is whatever actually unblocks it", () => {
    it("offers to reconnect when the file is unreachable", () => {
      // 안내를 거쳐 다시 누르게 만들면 첫 클릭에서 이탈한다.
      const blocked = drive(pausedAt(4), [
        { type: "RESUME", runId: "run-2" },
        { type: "SOURCE_LOST", availability: "needsPermission" },
      ]);
      const summary = summarize(blocked);
      expect(summary.action).toBe("reconnect");
      expect(summary.actionLabel).toBe("연결하고 이어서");
    });

    it("offers to resume when the file is still there", () => {
      expect(summarize(pausedAt(4)).action).toBe("resume");
    });

    it("offers to retry after a failure", () => {
      const failed = drive(pausedAt(4), [
        { type: "RESUME", runId: "run-2" },
        { type: "FATAL", reasonCode: "worker_crashed" },
      ]);
      expect(summarize(failed).action).toBe("retry");
    });
  });

  describe("why it stopped", () => {
    it("separates an expired permission from a missing file", () => {
      // 하나는 클릭 한 번, 하나는 파일을 찾아야 한다. 같은 문구로 묶으면
      // 필요 없는 탐색을 시킨다.
      const expired = drive(pausedAt(3), [
        { type: "RESUME", runId: "run-2" },
        { type: "SOURCE_LOST", availability: "needsPermission" },
      ]);
      const missing = drive(pausedAt(3, "job-2"), [
        { type: "RESUME", runId: "run-2" },
        { type: "SOURCE_LOST", availability: "missing" },
      ]);
      expect(summarize(expired).blockedReason).not.toBe(summarize(missing).blockedReason);
      expect(summarize(expired).blockedReason).not.toBeNull();
    });

    it("says nothing when the source is fine", () => {
      expect(summarize(pausedAt(3)).blockedReason).toBeNull();
    });
  });

  describe("the list", () => {
    function input(job: AnalysisJob, title: string) {
      return { job, title, sourceDurationMs: SIX_HOURS, resumeSupported: true };
    }

    it("drops finished and discarded work", () => {
      const done = drive(pausedAt(0, "done"), [
        { type: "RESUME", runId: "run-2" },
        ...ANALYSIS_STAGES.map((stage) => ({ type: "STAGE_COMMITTED", stage }) as const),
        { type: "ALL_STAGES_DONE", quality: "usable" },
      ]);
      const thrown = drive(pausedAt(2, "thrown"), [{ type: "ABANDON" }]);
      const emptyDone = drive(pausedAt(0, "empty-done"), [
        { type: "RESUME", runId: "run-2" },
        ...ANALYSIS_STAGES.map((stage) => ({ type: "STAGE_COMMITTED", stage }) as const),
        { type: "ALL_STAGES_DONE", quality: "empty" },
      ]);
      const kept = pausedAt(3, "kept");

      const rows = selectUnfinishedJobs([
        input(done, "끝난 것"),
        input(emptyDone, "정상적으로 비어 있는 것"),
        input(thrown, "버린 것"),
        input(kept, "남은 것"),
      ]);
      expect(rows.map((one) => one.jobId)).toEqual(["kept"]);
    });

    it("puts the closest to finishing first", () => {
      // 돌아올 이유가 가장 큰 것이 먼저 보여야 한다.
      const rows = selectUnfinishedJobs([
        input(pausedAt(1, "early"), "이제 시작"),
        input(pausedAt(6, "late"), "거의 다 됨"),
        input(pausedAt(3, "middle"), "중간"),
      ]);
      expect(rows.map((one) => one.jobId)).toEqual(["late", "middle", "early"]);
    });

    it("never mentions a candidate count", () => {
      // 최종 선별 전이라 어떤 개수도 지키지 못할 약속이 된다.
      const rows = selectUnfinishedJobs([input(pausedAt(5, "a"), "릴레이 방송")]);
      const text = JSON.stringify(rows);
      expect(text).not.toMatch(/후보/);
      expect(text).not.toMatch(/\d+\s*개/);
    });
  });

  it("says what deleting costs, not just that it deletes", () => {
    // "정말 삭제할까요?" 로는 이미 지불한 유료 분석을 버린다는 것을 알 수 없다.
    const summary = summarize(pausedAt(6));
    const text = deleteConfirmationText(summary);
    expect(text.body).toContain(`${summary.percent}%`);
    expect(text.body).toContain("유료");
  });
});

describe("when the pipeline cannot skip what is already done", () => {
  // 파이프라인이 `fastPass` 하나만 스테이지로 확정하므로 건너뛸 것이 없다.
  it("says it restarts instead of promising to continue", () => {
    // "이어서" 라고 하고 처음부터 돌면, 그 한 번으로 이 화면의 모든 시간 표시를
    // 못 믿게 된다.
    const summary = summarizeToday(pausedAt(6));
    expect(summary.action).toBe("restart");
    expect(summary.actionLabel).toBe("처음부터 다시 분석");
  });

  it("quotes the whole time, not the time minus what is already done", () => {
    // 확정된 만큼을 빼면 하지 않을 절약을 약속하게 된다.
    const early = summarizeToday(pausedAt(1));
    const late = summarizeToday(pausedAt(7));
    expect(late.remainingLabel).toBe(early.remainingLabel);
  });

  it("drops the comparison rather than printing the same number twice", () => {
    // 같은 숫자를 괄호로 한 번 더 보여 주는 것은 대비가 아니라 소음이다.
    expect(summarizeToday(pausedAt(4)).fromScratchLabel).toBe("");
  });

  it("still says reconnect first when the file is unreachable", () => {
    const blocked = drive(pausedAt(4), [
      { type: "RESUME", runId: "run-2" },
      { type: "SOURCE_LOST", availability: "needsPermission" },
    ]);
    expect(summarizeToday(blocked).action).toBe("reconnect");
    expect(summarizeToday(blocked).actionLabel).toBe("연결하고 다시 분석");
  });

  it("keeps the progress figure, which is true either way", () => {
    // 어디까지 됐는지는 사실이다. 다시 돈다고 그 사실이 바뀌지는 않는다.
    expect(summarizeToday(pausedAt(4)).percent).toBe(
      Math.round((4 / ANALYSIS_STAGES.length) * 100),
    );
  });
});
