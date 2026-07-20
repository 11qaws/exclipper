import { describe, expect, it } from "vitest";

import {
  estimateCandidatePassBCost,
  formatEstimatedUsd,
} from "./candidatePassBCost";

describe("candidate Pass B cost estimate", () => {
  it("estimates the default twelve 45-second candidates below the large-input tier", () => {
    const estimate = estimateCandidatePassBCost(12, 45_000);

    expect(estimate.inputTokens).toBe(81_840);
    expect(estimate.outputTokens).toBe(8_400);
    expect(estimate.usesOver200kTier).toBe(false);
    expect(estimate.totalCostUsd).toBeCloseTo(0.26448, 6);
  });

  it("switches to the over-200k price tier for a large payload", () => {
    const estimate = estimateCandidatePassBCost(12, 400_000);

    expect(estimate.usesOver200kTier).toBe(true);
    expect(estimate.inputPricePerMillionUsd).toBe(4);
    expect(estimate.outputPricePerMillionUsd).toBe(18);
  });

  it("formats tiny estimates without pretending to know a precise cent value", () => {
    expect(formatEstimatedUsd(0)).toBe("$0.00");
    expect(formatEstimatedUsd(0.004)).toBe("<$0.01");
    expect(formatEstimatedUsd(0.253)).toBe("$0.25");
  });
});
