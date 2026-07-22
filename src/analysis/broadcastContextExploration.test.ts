import { describe, expect, it } from "vitest";
import type { BroadcastContextTranscriptionChunk } from "./broadcastContextSamplingPlan";
import {
  createDistributedTimelineRevealOrder,
  createDistributedTranscriptExplorationOrder,
  prioritizeAdjacentTranscriptChunks,
  shouldExpandBroadcastContextChunk,
} from "./broadcastContextExploration";

function chunks(count: number): BroadcastContextTranscriptionChunk[] {
  return Array.from({ length: count }, (_, index) => ({
    chunkId: `asr-${String(index + 1).padStart(3, "0")}`,
    sourceStartMs: index * 1_000,
    sourceEndMs: (index + 1) * 1_000,
    kind: "uniform" as const,
  }));
}

describe("broadcastContextExploration", () => {
  it("creates a deterministic, globally scattered order without losing chunks", () => {
    const input = chunks(12);
    const first = createDistributedTranscriptExplorationOrder(input);
    const second = createDistributedTranscriptExplorationOrder([...input].reverse());

    expect(first.map(({ chunkId }) => chunkId)).toEqual(
      second.map(({ chunkId }) => chunkId),
    );
    expect(first[0]?.chunkId).not.toBe("asr-001");
    expect(first.slice(0, 4).map(({ sourceStartMs }) => sourceStartMs)).not.toEqual([
      0,
      1_000,
      2_000,
      3_000,
    ]);
    expect(new Set(first.map(({ chunkId }) => chunkId))).toEqual(
      new Set(input.map(({ chunkId }) => chunkId)),
    );
  });

  it("rejects overlapping chunks even when input order is scattered", () => {
    expect(() =>
      createDistributedTranscriptExplorationOrder([
        ...chunks(2),
        {
          chunkId: "overlap",
          sourceStartMs: 500,
          sourceEndMs: 1_500,
          kind: "event",
        },
      ]),
    ).toThrow(RangeError);
  });

  it("expands meaningful speech but not generic narration or music labels", () => {
    expect(
      shouldExpandBroadcastContextChunk({
        textKo: "근데 갑자기 문이 열렸고 왜 이런 일이 생겼는지 모르겠어!",
        emotion: "surprised",
      }),
    ).toBe(true);
    expect(
      shouldExpandBroadcastContextChunk({
        textKo: "오늘 준비한 자료를 순서대로 살펴보겠습니다.",
        emotion: "neutral",
      }),
    ).toBe(false);
    expect(
      shouldExpandBroadcastContextChunk({
        textKo: "배경 음악이 재생되고 있습니다 음악 음악",
        emotion: null,
      }),
    ).toBe(false);
  });

  it("promotes adjacent cells while preserving a global probe between them", () => {
    const all = chunks(8);
    const pending = [all[0], all[7], all[2], all[4], all[6]].filter(
      (chunk): chunk is BroadcastContextTranscriptionChunk => chunk !== undefined,
    );
    const prioritized = prioritizeAdjacentTranscriptChunks(
      pending,
      all,
      "asr-004",
      2,
    );
    expect(prioritized.map(({ chunkId }) => chunkId)).toEqual([
      "asr-003",
      "asr-001",
      "asr-005",
      "asr-008",
      "asr-007",
    ]);
  });

  it("reveals topic ranges from scattered positions", () => {
    const ranges = chunks(7).map((chunk) => ({
      id: chunk.chunkId,
      startMs: chunk.sourceStartMs,
      endMs: chunk.sourceEndMs,
    }));
    const result = createDistributedTimelineRevealOrder(ranges);
    expect(result[0]?.id).not.toBe("asr-001");
    expect(new Set(result.map(({ id }) => id))).toEqual(
      new Set(ranges.map(({ id }) => id)),
    );
  });
});
