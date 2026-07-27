import { describe, expect, it } from "vitest";

import type { AnalysisJobStatus } from "./analysisJob";
import {
  DEFAULT_RETENTION_POLICY,
  idleDays,
  planRetention,
  type RetentionPolicy,
  type StoredJobFootprint,
} from "./storageRetention";

const DAY = 24 * 60 * 60 * 1000;
const GB = 1024 * 1024 * 1024;
const NOW = 1_800_000_000_000;

const POLICY: RetentionPolicy = {
  capBytes: 1 * GB,
  retentionMs: 30 * DAY,
  staleAfterMs: 30 * DAY,
};

function job(
  jobId: string,
  status: AnalysisJobStatus,
  ageDays: number,
  bytes = 100 * 1024 * 1024,
): StoredJobFootprint {
  return { jobId, status, lastActivityAt: NOW - ageDays * DAY, bytes };
}

const UNFINISHED: readonly AnalysisJobStatus[] = [
  "queued",
  "running",
  "paused",
  "blocked",
  "failed",
];

describe("storage retention", () => {
  it("does nothing when everything is recent and small", () => {
    const plan = planRetention([job("a", "completed", 1), job("b", "paused", 2)], NOW, POLICY);
    expect(plan.evict).toEqual([]);
    expect(plan.flagStale).toEqual([]);
    expect(plan.stillOverCap).toBe(false);
  });

  describe("unfinished work is never deleted automatically", () => {
    it.each(UNFINISHED)("keeps a %s job that is a year old", (status) => {
      // 지우면 "한 번 들어온 영상은 마무리한다"는 약속을 앱이 스스로 깬다.
      const plan = planRetention([job("a", status, 365)], NOW, POLICY);
      expect(plan.evict).toEqual([]);
    });

    it("keeps unfinished work even when that means staying over the cap", () => {
      // 상한을 못 맞추는 쪽이 옳은 실패다. 꽉 찼다고 알리는 것은 정직하고,
      // 미완료를 지워 자리를 만드는 것은 그렇지 않다.
      const plan = planRetention(
        [job("a", "paused", 200, 2 * GB), job("b", "completed", 1, 100)],
        NOW,
        POLICY,
      );
      expect(plan.evict.map((one) => one.jobId)).toEqual([]);
      expect(plan.stillOverCap).toBe(true);
    });

    it("flags an old unfinished job instead of deleting it", () => {
      const plan = planRetention([job("a", "paused", 45)], NOW, POLICY);
      expect(plan.evict).toEqual([]);
      expect(plan.flagStale).toEqual(["a"]);
    });

    it("does not flag a job that is currently running", () => {
      // 진행 중인 것에 "방치됨" 을 붙이면 명백히 거짓말이다.
      const plan = planRetention([job("a", "running", 365)], NOW, POLICY);
      expect(plan.flagStale).toEqual([]);
    });
  });

  describe("retention applies to completed work only", () => {
    it("evicts a completed job past the retention window", () => {
      const plan = planRetention([job("a", "completed", 31)], NOW, POLICY);
      expect(plan.evict).toEqual([
        { jobId: "a", reason: "past_retention", bytes: 100 * 1024 * 1024 },
      ]);
    });

    it("keeps a completed job inside the window", () => {
      const plan = planRetention([job("a", "completed", 29)], NOW, POLICY);
      expect(plan.evict).toEqual([]);
    });

    it("evicts a completed empty job rather than flagging it unfinished", () => {
      const plan = planRetention([job("a", "completedEmpty", 31)], NOW, POLICY);
      expect(plan.evict).toEqual([
        { jobId: "a", reason: "past_retention", bytes: 100 * 1024 * 1024 },
      ]);
      expect(plan.flagStale).toEqual([]);
    });
  });

  it("deletes an abandoned job at once, whatever its age", () => {
    // 사용자가 이미 버린다고 말했다. 30일을 더 들고 있을 이유가 없다.
    const plan = planRetention([job("a", "abandoned", 0)], NOW, POLICY);
    expect(plan.evict).toEqual([{ jobId: "a", reason: "abandoned", bytes: 100 * 1024 * 1024 }]);
  });

  describe("over the cap", () => {
    it("evicts the oldest completed jobs until it fits", () => {
      const plan = planRetention(
        [
          job("newest", "completed", 1, 500 * 1024 * 1024),
          job("oldest", "completed", 3, 500 * 1024 * 1024),
          job("middle", "completed", 2, 500 * 1024 * 1024),
        ],
        NOW,
        POLICY,
      );
      // 1.5GB 만 남으면 되므로 가장 오래된 하나면 충분하다.
      expect(plan.evict.map((one) => one.jobId)).toEqual(["oldest"]);
      expect(plan.evict[0]?.reason).toBe("over_cap");
      expect(plan.bytesAfter).toBe(1000 * 1024 * 1024);
      expect(plan.stillOverCap).toBe(false);
    });

    it("stops as soon as it fits rather than clearing everything", () => {
      // 600×3 = 1800MB, 상한 1024MB. 하나만 지우면 1200MB 로 아직 넘으므로 둘,
      // 셋째는 남는다.
      const plan = planRetention(
        [
          job("a", "completed", 5, 600 * 1024 * 1024),
          job("b", "completed", 4, 600 * 1024 * 1024),
          job("c", "completed", 3, 600 * 1024 * 1024),
        ],
        NOW,
        POLICY,
      );
      expect(plan.evict.map((one) => one.jobId)).toEqual(["a", "b"]);
      expect(plan.bytesAfter).toBeLessThanOrEqual(POLICY.capBytes);
    });

    it("skips protected jobs while looking for room", () => {
      const plan = planRetention(
        [
          job("paused-oldest", "paused", 10, 600 * 1024 * 1024),
          job("done-newer", "completed", 2, 600 * 1024 * 1024),
        ],
        NOW,
        POLICY,
      );
      expect(plan.evict.map((one) => one.jobId)).toEqual(["done-newer"]);
    });

    it("counts an abandoned job's space as already freed", () => {
      // 버려진 것을 지우면 자리가 나므로, 그 뒤에도 완료본을 또 지우면 과잉 삭제다.
      const plan = planRetention(
        [job("trash", "abandoned", 1, 600 * 1024 * 1024), job("keep", "completed", 5, 300 * 1024 * 1024)],
        NOW,
        POLICY,
      );
      expect(plan.evict.map((one) => one.jobId)).toEqual(["trash"]);
      expect(plan.bytesAfter).toBe(300 * 1024 * 1024);
    });
  });

  it("never plans the same job twice", () => {
    const plan = planRetention(
      [
        job("old-and-big", "completed", 90, 900 * 1024 * 1024),
        job("also-big", "completed", 80, 900 * 1024 * 1024),
      ],
      NOW,
      POLICY,
    );
    const ids = plan.evict.map((one) => one.jobId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe("the default cap against measured sizes", () => {
    // 근거 4컷까지 저장하면 방송당 10~30MB. 상한 2GB 가 실제로 무엇을 담는지 고정해
    // 둔다 — 저장하는 것이 늘어 이 경계를 넘으면 여기서 먼저 깨진다.
    function broadcasts(count: number, megabytesEach: number) {
      return Array.from({ length: count }, (_, index) =>
        job(`b${index}`, "completed", index % 20, megabytesEach * 1024 * 1024),
      );
    }

    it("holds a hundred broadcasts at the middle of that range", () => {
      const plan = planRetention(broadcasts(100, 20), NOW, DEFAULT_RETENTION_POLICY);
      expect(plan.evict).toEqual([]);
      expect(plan.stillOverCap).toBe(false);
    });

    it("starts evicting past sixty-eight at the worst case", () => {
      // 30MB 짜리만 쌓이면 68개에서 2GB 다. 주 4회 기준 약 4개월.
      expect(planRetention(broadcasts(68, 30), NOW, DEFAULT_RETENTION_POLICY).evict).toEqual([]);
      expect(
        planRetention(broadcasts(70, 30), NOW, DEFAULT_RETENTION_POLICY).evict.length,
      ).toBeGreaterThan(0);
    });
  });

  it("reports idle days for the stale label", () => {
    expect(idleDays(job("a", "paused", 45), NOW)).toBe(45);
  });
});
