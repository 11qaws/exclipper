import { describe, expect, it } from "vitest";
import {
  ANALYSIS_BUDGET_LIMIT_USD,
  createAnalysisBudgetEnvelope,
} from "./analysisBudgetPolicy";

const HOUR_MS = 60 * 60_000;

describe("analysisBudgetPolicy", () => {
  it("keeps the worst supported source and bounded model calls below one dollar", () => {
    const envelope = createAnalysisBudgetEnvelope(12 * HOUR_MS, 12, 3);
    expect(envelope.qwenAsrUsd).toBeLessThanOrEqual(0.42);
    expect(envelope.candidatePerceptionUsd).toBeLessThanOrEqual(0.08);
    expect(envelope.contextReasoningReserveUsd).toBeGreaterThanOrEqual(0.073543);
    expect(envelope.projectedMaximumUsd).toBeLessThanOrEqual(
      ANALYSIS_BUDGET_LIMIT_USD,
    );
    expect(envelope.withinLimit).toBe(true);
  });

  it("spends no ASR allocation when a complete external transcript exists", () => {
    const envelope = createAnalysisBudgetEnvelope(6 * HOUR_MS, 8, 0, true);
    expect(envelope.qwenAsrUsd).toBe(0);
    expect(envelope.proAdjudicationReserveUsd).toBe(0);
    expect(envelope.withinLimit).toBe(true);
  });

  it("still reserves whole-context reasoning for a negative fast pass", () => {
    const envelope = createAnalysisBudgetEnvelope(2 * HOUR_MS, 0, 0);
    expect(envelope.candidatePerceptionUsd).toBe(0);
    expect(envelope.contextReasoningReserveUsd).toBeGreaterThan(0);
  });
});
