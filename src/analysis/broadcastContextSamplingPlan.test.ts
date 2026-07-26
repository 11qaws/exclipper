import { describe, expect, it } from "vitest";

import { MAX_BROADCAST_TRANSCRIPT_WORKER_CHUNKS } from "./broadcastTranscriptWorkerProtocol";
import {
  BROADCAST_CONTEXT_ASR_BUDGET_USD,
  QWEN_ASR_SAFE_CHUNK_DURATION_MS,
  createBroadcastContextSamplingPlan,
  createBroadcastContextTranscriptionChunks,
  subtractBroadcastContextCoveredRanges,
} from "./broadcastContextSamplingPlan";

const HOUR_MS = 60 * 60_000;

describe("broadcastContextSamplingPlan", () => {
  it("covers every ten-minute chapter cell under the twelve-hour ASR budget", () => {
    const plan = createBroadcastContextSamplingPlan(
      12 * HOUR_MS,
      [1 * HOUR_MS, 5 * HOUR_MS, 11 * HOUR_MS],
    );

    expect(plan.chapterCells).toHaveLength(72);
    expect(plan.estimatedAsrCostUsd).toBeLessThanOrEqual(
      BROADCAST_CONTEXT_ASR_BUDGET_USD + 1e-9,
    );
    expect(plan.estimatedAudioCoverageRatio).toBeGreaterThan(0.2);
    for (const cell of plan.chapterCells) {
      expect(
        plan.samplingWindows.some(
          (window) => window.startMs < cell.endMs && window.endMs > cell.startMs,
        ),
      ).toBe(true);
    }
  });

  it("always includes bounded context around a quiet semantic event lead", () => {
    const eventPeakMs = 97 * 60_000;
    const plan = createBroadcastContextSamplingPlan(6 * HOUR_MS, [eventPeakMs]);
    const eventWindow = plan.samplingWindows.find(
      (window) =>
        window.kind !== "uniform" &&
        window.startMs <= eventPeakMs &&
        window.endMs >= eventPeakMs,
    );

    expect(eventWindow).toBeDefined();
  });

  it("fully covers a short source when it fits inside the ASR allocation", () => {
    const durationMs = 2 * HOUR_MS + 15 * 60_000;
    const plan = createBroadcastContextSamplingPlan(durationMs, [21 * 60_000]);
    expect(plan.estimatedAudioCoverageRatio).toBe(1);
    expect(plan.sampledAudioMs).toBe(durationMs);
    expect(plan.estimatedAsrCostUsd).toBeLessThanOrEqual(
      BROADCAST_CONTEXT_ASR_BUDGET_USD,
    );
  });

  it("uses a complete external transcript without scheduling paid ASR", () => {
    const plan = createBroadcastContextSamplingPlan(12 * HOUR_MS, [], true);
    expect(plan.transcriptMode).toBe("external-complete");
    expect(plan.samplingWindows).toEqual([]);
    expect(plan.estimatedAudioCoverageRatio).toBe(1);
    expect(plan.estimatedAsrCostUsd).toBe(0);
  });

  it("splits every selected window into timestamp-preserving safe ASR requests", () => {
    const plan = createBroadcastContextSamplingPlan(2 * HOUR_MS, []);
    const chunks = createBroadcastContextTranscriptionChunks(plan.samplingWindows);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toMatchObject({ chunkId: "asr-001", sourceStartMs: 0 });
    expect(chunks.at(-1)?.sourceEndMs).toBe(2 * HOUR_MS);
    expect(
      chunks.every(
        (chunk) =>
          chunk.sourceEndMs - chunk.sourceStartMs <=
          QWEN_ASR_SAFE_CHUNK_DURATION_MS,
      ),
    ).toBe(true);
    expect(
      chunks.reduce((sum, chunk) => sum + chunk.sourceEndMs - chunk.sourceStartMs, 0),
    ).toBe(plan.sampledAudioMs);
  });

  it("keeps a worst-case twelve-hour plan inside the Worker envelope", () => {
    const durationMs = 12 * HOUR_MS;
    const eventPeaks = Array.from(
      { length: 12 },
      (_, index) => Math.round(((index + 0.5) / 12) * durationMs),
    );
    const plan = createBroadcastContextSamplingPlan(durationMs, eventPeaks);
    const chunks = createBroadcastContextTranscriptionChunks(plan.samplingWindows);

    // 상한은 프로토콜이 갖고 있다. 숫자를 박아 두면 청크 길이를 바꿀 때마다
    // 두 곳을 손으로 맞춰야 하고, 한쪽만 고치면 긴 방송이 조용히 거부된다.
    expect(chunks.length).toBeLessThanOrEqual(MAX_BROADCAST_TRANSCRIPT_WORKER_CHUNKS);
    expect(plan.estimatedAsrCostUsd).toBeLessThanOrEqual(
      BROADCAST_CONTEXT_ASR_BUDGET_USD + 1e-9,
    );
  });

  it("retries only source ranges missing from a paid transcript checkpoint", () => {
    expect(
      subtractBroadcastContextCoveredRanges(
        [{ startMs: 0, endMs: 210_000, kind: "uniform" }],
        [
          { startMs: 0, endMs: 90_000 },
          { startMs: 180_000, endMs: 210_000 },
        ],
      ),
    ).toEqual([{ startMs: 90_000, endMs: 180_000, kind: "uniform" }]);
  });
});
