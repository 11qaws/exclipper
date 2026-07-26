import { describe, expect, it } from "vitest";

import {
  STAGE_WEIGHTS,
  computeProgressAxis,
  formatSingleRemaining,
  normalizeStageWeights,
} from "./analysisProgressAxis";
import { ANALYSIS_STAGES, type AnalysisStage } from "../domain/analysisRun";
import { estimateAnalysisDurationRangeMs } from "./progressEstimate";

const SIX_HOURS_MS = 6 * 3_600_000;

function sumOf(weights: Readonly<Record<AnalysisStage, number>>): number {
  return Object.values(weights).reduce((sum, value) => sum + value, 0);
}

describe("normalizeStageWeights", () => {
  it("turns the constant table into weights that sum to one", () => {
    expect(sumOf(normalizeStageWeights())).toBeCloseTo(1, 12);
  });

  it("covers every analysis stage with a positive share", () => {
    const normalized = normalizeStageWeights();
    for (const stage of ANALYSIS_STAGES) {
      expect(normalized[stage]).toBeGreaterThan(0);
    }
  });

  // 가중치를 손으로 고칠 때 합을 맞추는 것은 사람의 일이 아니다. 표를 바꿔도
  // 정규화가 합을 1 로 유지해야 "다 끝났는데 97%" 가 나오지 않는다.
  it("still sums to one after the table is rewritten with different totals", () => {
    const doubled = Object.fromEntries(
      ANALYSIS_STAGES.map((stage) => [stage, STAGE_WEIGHTS[stage] * 7 + 1] as const),
    ) as typeof STAGE_WEIGHTS;
    expect(sumOf(normalizeStageWeights(doubled))).toBeCloseTo(1, 12);
  });

  // 합이 0 이면 나눗셈이 NaN 을 만든다. 막대가 사라지는 것보다 균등 분배가 낫다.
  it("falls back to an even split instead of NaN when every weight is zero", () => {
    const empty = Object.fromEntries(
      ANALYSIS_STAGES.map((stage) => [stage, 0] as const),
    ) as typeof STAGE_WEIGHTS;
    const normalized = normalizeStageWeights(empty);
    expect(sumOf(normalized)).toBeCloseTo(1, 12);
    expect(normalized.fastPass).toBeCloseTo(1 / ANALYSIS_STAGES.length, 12);
  });

  // 개수 비율(1/8 = 0.125)이면 짧은 스테이지에서 확 뛰고 긴 스테이지에서 멈춘 것처럼
  // 보인다. 방송 전체를 훑는 fastPass 는 그보다 훨씬 무거워야 한다.
  it("weighs the whole-broadcast scan far above an equal per-stage share", () => {
    const normalized = normalizeStageWeights();
    expect(normalized.fastPass).toBeGreaterThan(2 / ANALYSIS_STAGES.length);
    expect(normalized.preflight).toBeLessThan(1 / ANALYSIS_STAGES.length);
  });
});

describe("computeProgressAxis", () => {
  it("reports zero before any stage is committed", () => {
    const axis = computeProgressAxis({
      lastCommittedStage: null,
      currentStageRatio: 0,
      previousRatio: null,
    });
    expect(axis.ratio).toBe(0);
    expect(axis.indeterminate).toBe(false);
  });

  it("reports one once the final stage is committed", () => {
    const axis = computeProgressAxis({
      lastCommittedStage: "publication",
      currentStageRatio: null,
      previousRatio: 0.9,
    });
    expect(axis.ratio).toBe(1);
  });

  // 남은 스테이지가 없으면 모를 것도 없다. 끝난 막대에 줄무늬를 흘리면 끝난 일이
  // 아직 도는 것처럼 보인다.
  it("is never indeterminate after the last stage, even without a stage ratio", () => {
    const axis = computeProgressAxis({
      lastCommittedStage: "publication",
      currentStageRatio: null,
      previousRatio: null,
    });
    expect(axis.indeterminate).toBe(false);
  });

  it("adds the current stage's own share on top of the committed stages", () => {
    const committed = computeProgressAxis({
      lastCommittedStage: "seedClustering",
      currentStageRatio: 0,
      previousRatio: null,
    });
    const halfway = computeProgressAxis({
      lastCommittedStage: "seedClustering",
      currentStageRatio: 0.5,
      previousRatio: null,
    });
    const normalized = normalizeStageWeights();
    // preflight 2 + fastPass 45 + seedClustering 3 = 50 (합 100 기준)
    expect(committed.ratio).toBeCloseTo(0.5, 12);
    expect(halfway.ratio).toBeCloseTo(0.5 + normalized.commitFastResult / 2, 12);
  });

  // 워커가 보내는 비율은 1 을 넘길 수 있다. 그대로 더하면 막대가 다음 스테이지의
  // 몫까지 먹고 들어가, 그 스테이지 내내 멈춰 있어야 한다.
  it("never lets one stage spill past its own share", () => {
    const axis = computeProgressAxis({
      lastCommittedStage: "seedClustering",
      currentStageRatio: 5,
      previousRatio: null,
    });
    // 0.50 에 commitFastResult 몫 0.02 까지만. 다음 스테이지 몫은 못 먹는다.
    expect(axis.ratio).toBeCloseTo(0.52, 12);
  });

  it("stays within zero and one for out-of-range input", () => {
    const negative = computeProgressAxis({
      lastCommittedStage: "fastPass",
      currentStageRatio: -3,
      previousRatio: null,
    });
    expect(negative.ratio).toBeGreaterThanOrEqual(0);
    expect(negative.ratio).toBeLessThanOrEqual(1);
  });

  // 막대가 뒤로 가면 사용자는 진행이 취소됐다고 읽는다. 늦게 도착한 이벤트나
  // 재개 직후의 낮은 값이 그것을 만든다.
  it("holds the previous value when a fresh reading would move the bar backwards", () => {
    const axis = computeProgressAxis({
      lastCommittedStage: "seedClustering",
      currentStageRatio: 0,
      previousRatio: 0.6,
    });
    expect(axis.ratio).toBe(0.6);
  });

  it("never decreases across a run of noisy readings", () => {
    const readings: {
      lastCommittedStage: AnalysisStage | null;
      currentStageRatio: number | null;
    }[] = [
      { lastCommittedStage: null, currentStageRatio: 0.2 },
      { lastCommittedStage: "preflight", currentStageRatio: 0.9 },
      { lastCommittedStage: "preflight", currentStageRatio: 0.1 },
      { lastCommittedStage: "seedClustering", currentStageRatio: null },
      { lastCommittedStage: "seedClustering", currentStageRatio: 0.5 },
      { lastCommittedStage: "seedClustering", currentStageRatio: 0.05 },
      { lastCommittedStage: "fastPass", currentStageRatio: 0 },
      { lastCommittedStage: "deepPass", currentStageRatio: 0.4 },
      { lastCommittedStage: "deepPass", currentStageRatio: null },
      { lastCommittedStage: "publication", currentStageRatio: null },
    ];

    const shown: number[] = [];
    let previousRatio: number | null = null;
    for (const reading of readings) {
      const axis = computeProgressAxis({ ...reading, previousRatio });
      previousRatio = axis.ratio;
      shown.push(axis.ratio);
    }

    const everFell = shown.some(
      (value, index) => index > 0 && value < (shown[index - 1] ?? value),
    );
    expect(everFell).toBe(false);
    expect(shown.at(-1)).toBe(1);
  });

  // 상수 진행률(0.76 등)은 정확히 "멈춘 막대"처럼 보인다. 모르는 구간은 숫자가
  // 아니라 indeterminate 로 말한다.
  it("marks an uncountable stage as indeterminate instead of inventing a number", () => {
    const unknown = computeProgressAxis({
      lastCommittedStage: "seedClustering",
      currentStageRatio: null,
      previousRatio: null,
    });
    const committedOnly = computeProgressAxis({
      lastCommittedStage: "seedClustering",
      currentStageRatio: 0,
      previousRatio: null,
    });
    expect(unknown.indeterminate).toBe(true);
    expect(unknown.ratio).toBe(committedOnly.ratio);
  });

  it("treats a NaN stage ratio as unknown rather than propagating NaN", () => {
    const axis = computeProgressAxis({
      lastCommittedStage: "fastPass",
      currentStageRatio: Number.NaN,
      previousRatio: null,
    });
    expect(axis.indeterminate).toBe(true);
    expect(Number.isFinite(axis.ratio)).toBe(true);
  });

  it("ignores a non-finite previous value instead of freezing the bar", () => {
    const axis = computeProgressAxis({
      lastCommittedStage: "fastPass",
      currentStageRatio: 0,
      previousRatio: Number.NaN,
    });
    // preflight 2 + fastPass 45 = 47
    expect(axis.ratio).toBeCloseTo(0.47, 12);
  });
});

describe("formatSingleRemaining", () => {
  // 범위(`9~14분`)는 읽는 순간 사용자에게 계산을 시킨다.
  it("shows a single number with no range notation", () => {
    const labels = [
      formatSingleRemaining({
        sourceDurationMs: SIX_HOURS_MS,
        elapsedMs: 0,
        ratio: null,
        previousRemainingMs: null,
      }).label,
      formatSingleRemaining({
        sourceDurationMs: SIX_HOURS_MS,
        elapsedMs: 300_000,
        ratio: 0.3,
        previousRemainingMs: null,
      }).label,
      formatSingleRemaining({
        sourceDurationMs: 20 * 60_000,
        elapsedMs: 900_000,
        ratio: 0.99,
        previousRemainingMs: null,
      }).label,
    ];

    for (const label of labels) {
      expect(label.startsWith("약 ")).toBe(true);
      expect(label).toContain("남음");
      for (const rangeMark of ["~", "-", "–", "—"]) {
        expect(label).not.toContain(rangeMark);
      }
    }
  });

  // 빨리 끝나면 기분이 좋지만 늦어지면 화면이 거짓말한 것이 된다.
  it("anchors the pre-progress estimate on the generous end of the planning range", () => {
    const range = estimateAnalysisDurationRangeMs(SIX_HOURS_MS);
    const single = formatSingleRemaining({
      sourceDurationMs: SIX_HOURS_MS,
      elapsedMs: 0,
      ratio: null,
      previousRemainingMs: null,
    });
    expect(single.remainingMs).toBe(range.highMs);
    expect(single.remainingMs).toBeGreaterThan(range.lowMs);
    expect(single.remainingMs).toBeGreaterThan((range.lowMs + range.highMs) / 2);
  });

  it("counts the generous anchor down as time passes without progress", () => {
    const range = estimateAnalysisDurationRangeMs(SIX_HOURS_MS);
    const single = formatSingleRemaining({
      sourceDurationMs: SIX_HOURS_MS,
      elapsedMs: 120_000,
      ratio: null,
      previousRemainingMs: null,
    });
    expect(single.remainingMs).toBe(range.highMs - 120_000);
  });

  it("falls as the run progresses", () => {
    const readings = [
      { elapsedMs: 0, ratio: null },
      { elapsedMs: 60_000, ratio: 0.05 },
      { elapsedMs: 300_000, ratio: 0.3 },
      { elapsedMs: 600_000, ratio: 0.7 },
      { elapsedMs: 900_000, ratio: 1 },
    ];

    const shown: number[] = [];
    let previousRemainingMs: number | null = null;
    for (const reading of readings) {
      const single = formatSingleRemaining({
        sourceDurationMs: SIX_HOURS_MS,
        ...reading,
        previousRemainingMs,
      });
      previousRemainingMs = single.remainingMs;
      shown.push(single.remainingMs);
    }

    const everRose = shown.some(
      (value, index) => index > 0 && value > (shown[index - 1] ?? value),
    );
    expect(everRose).toBe(false);
    expect(shown.at(-1)).toBe(0);
  });

  // 표시된 시간이 다시 늘어나면 넉넉하게 잡은 의미가 사라진다. 단조 감소는
  // clampToMonotonic 이 이미 하는 일이라 여기서 다시 만들지 않는다.
  it("never rises above what was already shown", () => {
    const single = formatSingleRemaining({
      sourceDurationMs: SIX_HOURS_MS,
      elapsedMs: 60_000,
      ratio: 0.02,
      previousRemainingMs: 300_000,
    });
    expect(single.remainingMs).toBe(300_000);
  });

  it("switches to a measured projection once real progress exists", () => {
    const single = formatSingleRemaining({
      sourceDurationMs: SIX_HOURS_MS,
      elapsedMs: 60_000,
      ratio: 0.2,
      previousRemainingMs: null,
    });
    expect(single.basis).toBe("measured");
    expect(single.remainingMs).toBeCloseTo(240_000 * 1.18, -3);
  });

  // 라벨은 분 단위로 반올림된다. 그 값을 되먹이면 단조 감소가 분 경계에서 어긋난다.
  it("returns the unrounded milliseconds so the next call can hold the sequence", () => {
    const single = formatSingleRemaining({
      sourceDurationMs: SIX_HOURS_MS,
      elapsedMs: 30_000,
      ratio: 0.5,
      previousRemainingMs: null,
    });
    expect(single.remainingMs % 60_000).not.toBe(0);
  });
});

