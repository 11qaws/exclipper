import { describe, expect, it } from "vitest";

import {
  QWEN_ASR_SAFE_CHUNK_DURATION_MS,
  createBroadcastContextSamplingPlan,
  createBroadcastContextTranscriptionChunks,
} from "./broadcastContextSamplingPlan";
import { MAX_BROADCAST_TRANSCRIPT_WORKER_CHUNKS } from "./broadcastTranscriptWorkerProtocol";
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

  // 요청 수는 청크 길이에서 나온다. 숫자를 박아 두면 릴레이 사정으로 청크를
  // 바꿀 때마다 무엇이 왜 깨졌는지 모른 채 기대값만 고치게 된다.
  it("plans one transcript call per chunk of the source", () => {
    const sourceMs = 2 * 60 * 60_000 + 15 * 60_000;
    const plan = createAiAnalysisRoutingPlan(sourceMs, 3);
    const step = plan.steps.find((one) => one.stage === "broadcast-transcription");
    expect(step?.maximumCalls).toBeGreaterThanOrEqual(
      Math.floor(sourceMs / QWEN_ASR_SAFE_CHUNK_DURATION_MS),
    );
  });

  // 최악의 계획도 워커가 받아 주는 상한 안에 들어야 한다. 넘으면 긴 방송이
  // 계획 단계에서 거부된다.
  it("keeps the worst-case twelve-hour envelope inside what the worker accepts", () => {
    const sourceDurationMs = 12 * 60 * 60_000;
    const eventPeaks = Array.from(
      { length: 12 },
      (_, index) => Math.round(((index + 0.5) / 12) * sourceDurationMs),
    );
    const actualEventChunks = createBroadcastContextTranscriptionChunks(
      createBroadcastContextSamplingPlan(sourceDurationMs, eventPeaks)
        .samplingWindows,
    ).length;
    const plan = createAiAnalysisRoutingPlan(sourceDurationMs, 3);
    const step = plan.steps.find((one) => one.stage === "broadcast-transcription");
    expect(step?.maximumCalls).toBeGreaterThanOrEqual(actualEventChunks);
    expect(step?.maximumCalls).toBeLessThanOrEqual(MAX_BROADCAST_TRANSCRIPT_WORKER_CHUNKS);
  });

  it("rejects sources beyond the product's twelve-hour boundary", () => {
    expect(() => createAiAnalysisRoutingPlan(12 * 60 * 60_000 + 1, 1)).toThrow(
      RangeError,
    );
  });
});
