import { describe, expect, it } from "vitest";

import { formatStageTimingReport, StageTimer } from "./stageTiming";

const SIX_HOURS = 6 * 3_600_000;

function timerWith(marks: readonly [string, number][]) {
  const timer = new StageTimer(SIX_HOURS);
  timer.begin(0);
  for (const [stage, atMs] of marks) {
    timer.mark(stage as never, atMs);
  }
  return timer;
}

describe("stage timing", () => {
  it("measures each stage as the gap since the previous boundary", () => {
    // 스테이지 사이에는 빈틈이 없다. 경계 하나로 충분하고, 시작·끝을 둘 다
    // 표시하면 그 둘이 어긋날 자리가 생긴다.
    const report = timerWith([
      ["preflight", 2_000],
      ["fastPass", 62_000],
      ["seedClustering", 65_000],
    ]).report();

    expect(report.timings.map((one) => one.elapsedMs)).toEqual([2_000, 60_000, 3_000]);
    expect(report.totalMs).toBe(65_000);
  });

  it("reports shares that can be compared with the estimated weights", () => {
    const report = timerWith([
      ["preflight", 10_000],
      ["fastPass", 100_000],
    ]).report();
    expect(report.measuredWeights.preflight).toBe(10);
    expect(report.measuredWeights.fastPass).toBe(90);
  });

  it("omits stages that never ran rather than reporting them as instant", () => {
    // 0초로 적으면 "빠른 단계" 로 읽힌다. 안 돈 것과 빨리 끝난 것은 다르다.
    const report = timerWith([["preflight", 1_000]]).report();
    expect(report.timings).toHaveLength(1);
    expect(report.measuredWeights.deepPass).toBeUndefined();
  });

  it("returns empty shares instead of dividing by zero", () => {
    // 0 으로 나눈 값은 그럴듯한 숫자로 보인다.
    const report = timerWith([["preflight", 0]]).report();
    expect(report.measuredWeights).toEqual({});
  });

  it("relates each stage to the source duration so length-bound work is visible", () => {
    // 원본 길이에 정비례하는 구간과 상수 구간을 가려내는 것이 이 값의 목적이다.
    const report = timerWith([
      ["preflight", 2_000],
      ["fastPass", 602_000],
    ]).report();
    const fastPass = report.timings.find((one) => one.stage === "fastPass");
    expect(fastPass?.ratioOfSourceDuration).toBeCloseTo(600_000 / SIX_HOURS, 10);
  });

  it("says so plainly when nothing was measured", () => {
    expect(formatStageTimingReport(new StageTimer(SIX_HOURS).report())).toBe(
      "스테이지 실측 없음",
    );
  });

  it("prints a table that can be pasted next to the estimates", () => {
    const text = formatStageTimingReport(
      timerWith([
        ["preflight", 2_000],
        ["fastPass", 602_000],
      ]).report(),
    );
    expect(text).toContain("preflight");
    expect(text).toContain("fastPass");
    expect(text).toContain("실측 가중치");
  });
});
