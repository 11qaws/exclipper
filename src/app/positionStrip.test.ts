import { describe, expect, it } from "vitest";

import {
  candidateStripPositionPercent,
  stripTickPercentages,
} from "./positionStrip";

describe("candidateStripPositionPercent", () => {
  it("places the midpoint of the broadcast at 50%", () => {
    expect(candidateStripPositionPercent(3_600_000, 7_200_000)).toBeCloseTo(50);
  });

  it("places the start at 0% and the end at 100%", () => {
    expect(candidateStripPositionPercent(0, 7_200_000)).toBe(0);
    expect(candidateStripPositionPercent(7_200_000, 7_200_000)).toBe(100);
  });

  it("clamps a peak slightly past the known duration to 100%", () => {
    expect(candidateStripPositionPercent(7_300_000, 7_200_000)).toBe(100);
  });

  it("clamps a negative peak to 0%", () => {
    expect(candidateStripPositionPercent(-1_000, 7_200_000)).toBe(0);
  });

  it("returns 0 rather than NaN or Infinity for an unknown duration", () => {
    expect(candidateStripPositionPercent(1_000, 0)).toBe(0);
    expect(candidateStripPositionPercent(1_000, -1)).toBe(0);
    expect(candidateStripPositionPercent(NaN, 7_200_000)).toBe(0);
  });
});

describe("stripTickPercentages", () => {
  it("projects tick timestamps onto the strip in the same order", () => {
    const ticks = stripTickPercentages([1_800_000, 3_600_000], 7_200_000);
    expect(ticks).toEqual([25, 50]);
  });

  it("returns an empty list for an unknown duration instead of throwing", () => {
    expect(stripTickPercentages([1_000], 0)).toEqual([]);
  });
});
