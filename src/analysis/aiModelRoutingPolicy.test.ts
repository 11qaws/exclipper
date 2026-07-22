import { describe, expect, it } from "vitest";
import {
  EXCLIPPER_MODEL_IDS,
  createAiAnalysisRoutingPlan,
} from "./aiModelRoutingPolicy";

describe("aiModelRoutingPolicy", () => {
  it("uses Flash/Omni for perception and bounds expensive adjudication", () => {
    const plan = createAiAnalysisRoutingPlan(6 * 60 * 60_000, 30);
    expect(
      plan.steps.find((step) => step.stage === "candidate-perception"),
    ).toMatchObject({
      primaryModelId: "qwen3.5-omni-flash",
      fallbackModelId: "gemini-3.6-flash",
      maximumCalls: 12,
    });
    expect(
      plan.steps.find((step) => step.stage === "candidate-adjudication"),
    ).toMatchObject({
      primaryModelId: "qwen3.7-plus",
      fallbackModelId: "gemini-3.6-flash",
      maximumCalls: 3,
    });
  });

  it("chunks the visual context at the official two-hour Qwen limit", () => {
    const plan = createAiAnalysisRoutingPlan(12 * 60 * 60_000, 8);
    expect(
      plan.steps.find((step) => step.stage === "broadcast-visual-chaptering"),
    ).toMatchObject({
      primaryModelId: EXCLIPPER_MODEL_IDS.broadcastVisualChaptering,
      maximumCalls: 6,
      inputScope: "sampled-video",
    });
  });

  it("keeps transcript context active when the sound pass found no candidates", () => {
    const plan = createAiAnalysisRoutingPlan(2 * 60 * 60_000, 0);
    expect(
      plan.steps.find((step) => step.stage === "candidate-perception")?.maximumCalls,
    ).toBe(0);
    expect(
      plan.steps.find((step) => step.stage === "broadcast-transcription")
        ?.maximumCalls,
    ).toBeGreaterThan(0);
    expect(
      plan.steps.find((step) => step.stage === "broadcast-context-reasoning")
        ?.maximumCalls,
    ).toBe(26);
    expect(
      plan.steps.find((step) => step.stage === "broadcast-context-reasoning"),
    ).toMatchObject({
      primaryModelId: "qwen3.7-plus",
      fallbackModelId: "qwen3.6-flash",
    });
    expect(
      plan.steps.find((step) => step.stage === "candidate-adjudication")
        ?.maximumCalls,
    ).toBe(0);
  });

  it("reports the production-proven 90-second transcript request count", () => {
    const plan = createAiAnalysisRoutingPlan(2 * 60 * 60_000 + 15 * 60_000, 3);
    expect(
      plan.steps.find((step) => step.stage === "broadcast-transcription"),
    ).toMatchObject({ maximumCalls: 90 });
  });

  it("reserves the complete fragmented twelve-hour transcript envelope", () => {
    const plan = createAiAnalysisRoutingPlan(12 * 60 * 60_000, 3);
    expect(
      plan.steps.find((step) => step.stage === "broadcast-transcription"),
    ).toMatchObject({ maximumCalls: 240 });
  });

  it("rejects sources beyond the product's twelve-hour boundary", () => {
    expect(() => createAiAnalysisRoutingPlan(12 * 60 * 60_000 + 1, 1)).toThrow(
      RangeError,
    );
  });
});
