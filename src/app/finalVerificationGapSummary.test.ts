import { describe, expect, it } from "vitest";

import {
  isPipelineGap,
  summarizeFinalVerificationGaps,
} from "./finalVerificationGapSummary";

describe("summarizeFinalVerificationGaps", () => {
  it("counts each gap and keeps pipeline order", () => {
    const summary = summarizeFinalVerificationGaps({
      a: "detail-not-recommended",
      b: "context-missing",
      c: "detail-not-recommended",
      d: "evidence-incomplete",
    });
    expect(summary.map(({ gap, count }) => [gap, count])).toEqual([
      ["context-missing", 1],
      ["evidence-incomplete", 1],
      ["detail-not-recommended", 2],
    ]);
  });

  it("omits gaps that did not occur", () => {
    const summary = summarizeFinalVerificationGaps({ a: "context-conflict" });
    expect(summary).toHaveLength(1);
    expect(summary[0]?.gap).toBe("context-conflict");
  });

  it("returns nothing when every candidate passed", () => {
    expect(summarizeFinalVerificationGaps({})).toEqual([]);
  });

  it("gives every gap a Korean label and detail", () => {
    const summary = summarizeFinalVerificationGaps({
      a: "context-missing",
      b: "detail-result-missing",
      c: "verification-receipt-missing",
      d: "evidence-incomplete",
      e: "program-material-excluded",
      f: "context-conflict",
      g: "detail-not-recommended",
    });
    expect(summary).toHaveLength(7);
    for (const entry of summary) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.detail.length).toBeGreaterThan(0);
    }
  });
});

describe("isPipelineGap", () => {
  it("treats missing evidence as a pipeline problem", () => {
    expect(isPipelineGap("context-missing")).toBe(true);
    expect(isPipelineGap("detail-result-missing")).toBe(true);
    expect(isPipelineGap("verification-receipt-missing")).toBe(true);
    expect(isPipelineGap("evidence-incomplete")).toBe(true);
  });

  it("treats a completed judgement as not a pipeline problem", () => {
    expect(isPipelineGap("program-material-excluded")).toBe(false);
    expect(isPipelineGap("context-conflict")).toBe(false);
    expect(isPipelineGap("detail-not-recommended")).toBe(false);
  });
});
