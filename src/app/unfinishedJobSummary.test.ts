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

function summarize(job: AnalysisJob, title = "릴레이 방송") {
  return summarizeUnfinishedJob({ job, title, sourceDurationMs: SIX_HOURS });
}

describe("unfinished job summary", () => {
  describe("progress", () => {
    it("reports nothing committed as zero", () => {
      expect(committedPercent(pausedAt(0))).toBe(0);
    });

    it("counts only committed stages", () => {
      expect(committedPercent(pausedAt(ANALYSIS_STAGES.length / 2))).toBe(50);
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
      return { job, title, sourceDurationMs: SIX_HOURS };
    }

    it("drops finished and discarded work", () => {
      const done = drive(pausedAt(0, "done"), [
        { type: "RESUME", runId: "run-2" },
        ...ANALYSIS_STAGES.map((stage) => ({ type: "STAGE_COMMITTED", stage }) as const),
        { type: "ALL_STAGES_DONE", quality: "usable" },
      ]);
      const thrown = drive(pausedAt(2, "thrown"), [{ type: "ABANDON" }]);
      const kept = pausedAt(3, "kept");

      const rows = selectUnfinishedJobs([
        input(done, "끝난 것"),
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
    const text = deleteConfirmationText(summarize(pausedAt(6)));
    expect(text.body).toContain("75%");
    expect(text.body).toContain("유료");
  });
});
