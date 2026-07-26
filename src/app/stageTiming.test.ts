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

describe("inner spans", () => {
  it("adds up repeats of the same label rather than keeping the last one", () => {
    // 후보마다 도는 호출은 한 번의 시간이 아니라 총합이 궁금하다.
    const timer = new StageTimer(SIX_HOURS);
    timer.begin(0);
    timer.addSpan("candidate-pass-b", 1_000);
    timer.addSpan("candidate-pass-b", 2_500);
    timer.mark("deepPass", 10_000);
    expect(timer.report().spans).toEqual([{ label: "candidate-pass-b", elapsedMs: 3_500 }]);
  });

  it("puts the heaviest span first", () => {
    const timer = new StageTimer(SIX_HOURS);
    timer.begin(0);
    timer.addSpan("light", 100);
    timer.addSpan("heavy", 9_000);
    timer.mark("broadcastContext", 10_000);
    expect(timer.report().spans.map((one) => one.label)).toEqual(["heavy", "light"]);
  });

  it("ignores a negative or non-finite duration instead of corrupting the total", () => {
    // 시계가 뒤로 가면 음수가 나온다. 그것을 더하면 합이 줄어 원인을 못 찾는다.
    const timer = new StageTimer(SIX_HOURS);
    timer.begin(0);
    timer.addSpan("x", 500);
    timer.addSpan("x", -900);
    timer.addSpan("x", Number.NaN);
    timer.mark("broadcastContext", 1_000);
    expect(timer.report().spans).toEqual([{ label: "x", elapsedMs: 500 }]);
  });

  it("measures between the handle being made and called", () => {
    const timer = new StageTimer(SIX_HOURS);
    timer.begin(0);
    timer.startSpan("fetch", 1_000)(3_400);
    timer.mark("broadcastContext", 5_000);
    expect(timer.report().spans).toEqual([{ label: "fetch", elapsedMs: 2_400 }]);
  });

  it("omits the inner section entirely when nothing inside was measured", () => {
    // 제목만 있고 아래가 빈 절은 무언가 빠진 것처럼 보인다.
    const timer = new StageTimer(SIX_HOURS);
    timer.begin(0);
    timer.mark("preflight", 1_000);
    expect(formatStageTimingReport(timer.report())).not.toContain("스테이지 안쪽 구간");
  });

  it("shows the inner section once there is something in it", () => {
    const timer = new StageTimer(SIX_HOURS);
    timer.begin(0);
    timer.addSpan("youtube-caption-fetch", 800);
    timer.mark("broadcastContext", 60_000);
    const text = formatStageTimingReport(timer.report());
    expect(text).toContain("스테이지 안쪽 구간");
    expect(text).toContain("youtube-caption-fetch");
  });
});
