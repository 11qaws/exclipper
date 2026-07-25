import { describe, expect, it } from "vitest";

import {
  clampToMonotonic,
  estimateAnalysisDurationRangeMs,
  estimateRemainingMs,
  formatRemainingLabel,
} from "./progressEstimate";

describe("estimateAnalysisDurationRangeMs", () => {
  it("matches the product plan's 6-hour reference point of about 25-40 minutes", () => {
    const range = estimateAnalysisDurationRangeMs(6 * 3_600_000);
    expect(range.lowMs / 60_000).toBeCloseTo(25, 0);
    expect(range.highMs / 60_000).toBeCloseTo(40, 0);
  });

  it("scales down for a short broadcast but keeps a sane floor", () => {
    const range = estimateAnalysisDurationRangeMs(20 * 60_000);
    expect(range.lowMs).toBeGreaterThanOrEqual(3 * 60_000);
    expect(range.highMs).toBeGreaterThan(range.lowMs);
  });

  it("never produces a negative or inverted range for zero duration", () => {
    const range = estimateAnalysisDurationRangeMs(0);
    expect(range.lowMs).toBeGreaterThan(0);
    expect(range.highMs).toBeGreaterThan(range.lowMs);
  });
});

describe("estimateRemainingMs", () => {
  it("falls back to the static range before enough progress has accumulated", () => {
    const estimate = estimateRemainingMs({
      sourceDurationMs: 6 * 3_600_000,
      elapsedMs: 2_000,
      ratio: 0.01,
    });
    expect(estimate.basis).toBe("static");
  });

  it("falls back to the static range when no ratio exists yet", () => {
    const estimate = estimateRemainingMs({
      sourceDurationMs: 3_600_000,
      elapsedMs: 30_000,
      ratio: null,
    });
    expect(estimate.basis).toBe("static");
  });

  it("switches to a measured projection once elapsed time and ratio are both meaningful", () => {
    const estimate = estimateRemainingMs({
      sourceDurationMs: 6 * 3_600_000,
      elapsedMs: 60_000,
      ratio: 0.2,
    });
    expect(estimate.basis).toBe("measured");
    // elapsed=60s at ratio=0.2 implies a 300s total, so ~240s of real work
    // remain — shown padded by 18% so the run tends to beat its own promise.
    expect(estimate.remainingMs).toBeCloseTo(240_000 * 1.18, -3);
  });

  it("pads the static fallback by the same factor as a measured projection", () => {
    const range = estimateAnalysisDurationRangeMs(6 * 3_600_000);
    const estimate = estimateRemainingMs({
      sourceDurationMs: 6 * 3_600_000,
      elapsedMs: 0,
      ratio: null,
    });
    const rawMidpointMs = (range.lowMs + range.highMs) / 2;
    expect(estimate.remainingMs).toBeCloseTo(rawMidpointMs * 1.18, -3);
    expect(estimate.remainingMs).toBeGreaterThan(rawMidpointMs);
  });

  it("never returns a negative remainder for a ratio near completion", () => {
    const estimate = estimateRemainingMs({
      sourceDurationMs: 3_600_000,
      elapsedMs: 500_000,
      ratio: 0.999,
    });
    expect(estimate.remainingMs).toBeGreaterThanOrEqual(0);
  });

  it("still converges to zero at completion instead of leaving a padded tail", () => {
    const estimate = estimateRemainingMs({
      sourceDurationMs: 3_600_000,
      elapsedMs: 500_000,
      ratio: 1,
    });
    expect(estimate.remainingMs).toBe(0);
  });
});

describe("clampToMonotonic", () => {
  it("shows the fresh estimate when nothing has been shown yet", () => {
    expect(clampToMonotonic(null, 300_000)).toBe(300_000);
  });

  it("holds the previous value when the estimate grows", () => {
    expect(clampToMonotonic(4 * 60_000, 6 * 60_000)).toBe(4 * 60_000);
  });

  it("follows the estimate down once reality drops below what was shown", () => {
    const held = clampToMonotonic(4 * 60_000, 6 * 60_000);
    expect(clampToMonotonic(held, 2 * 60_000)).toBe(2 * 60_000);
  });

  it("never rises across a whole run, even when the projection swings wildly", () => {
    const projections = [600_000, 900_000, 480_000, 700_000, 120_000, 300_000, 0];
    const shown: number[] = [];
    let previousShownMs: number | null = null;
    for (const projection of projections) {
      previousShownMs = clampToMonotonic(previousShownMs, projection);
      shown.push(previousShownMs);
    }

    expect(shown).toEqual([600_000, 600_000, 480_000, 480_000, 120_000, 120_000, 0]);
    const everRose = shown.some(
      (value, index) => index > 0 && value > (shown[index - 1] ?? value),
    );
    expect(everRose).toBe(false);
  });

  it("reaches zero and stays there", () => {
    expect(clampToMonotonic(0, 90_000)).toBe(0);
  });

  it("is idempotent, so it is safe to re-apply on a repeated render", () => {
    const once = clampToMonotonic(5 * 60_000, 9 * 60_000);
    expect(clampToMonotonic(once, 9 * 60_000)).toBe(once);
  });

  it("treats a non-finite input as no estimate rather than propagating NaN", () => {
    expect(clampToMonotonic(null, Number.NaN)).toBe(0);
    expect(clampToMonotonic(Number.NaN, 120_000)).toBe(120_000);
    expect(clampToMonotonic(-5_000, 120_000)).toBe(0);
  });
});

describe("formatRemainingLabel", () => {
  it("marks a measured projection without an estimate caveat", () => {
    const label = formatRemainingLabel({ basis: "measured", remainingMs: 5 * 60_000 });
    expect(label).toBe("약 5분 남음");
  });

  it("marks a static fallback as an estimate", () => {
    const label = formatRemainingLabel({ basis: "static", remainingMs: 30 * 60_000 });
    expect(label).toContain("추정");
  });

  it("never claims zero minutes remain while work is still outstanding", () => {
    const label = formatRemainingLabel({ basis: "measured", remainingMs: 200 });
    expect(label).toBe("약 1분 남음");
  });
});
