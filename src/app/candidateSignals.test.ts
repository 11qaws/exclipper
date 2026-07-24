import { describe, expect, it } from "vitest";

import type { UnifiedHighlightCandidate } from "../analysis/highlightFusion";
import { buildCandidateSignalTiles, topPercent } from "./candidateSignals";

function candidate(
  evidence: UnifiedHighlightCandidate["evidence"],
): UnifiedHighlightCandidate {
  return {
    id: "c1",
    startMs: 0,
    endMs: 45_000,
    peakMs: 20_000,
    score: 0.8,
    reason: "테스트",
    signalKinds: ["audio"],
    evidence,
  };
}

describe("topPercent", () => {
  it("reads the strongest percentile as the top 1%, never 0", () => {
    expect(topPercent(1)).toBe(1);
    expect(topPercent(0.999)).toBe(1);
  });

  it("converts a percentile into the complementary top share", () => {
    expect(topPercent(0.97)).toBe(3);
    expect(topPercent(0.5)).toBe(50);
    expect(topPercent(0)).toBe(100);
  });

  it("clamps values outside [0, 1] and non-finite input", () => {
    expect(topPercent(1.5)).toBe(1);
    expect(topPercent(-2)).toBe(100);
    expect(topPercent(Number.NaN)).toBe(100);
  });
});

describe("buildCandidateSignalTiles", () => {
  it("returns nothing when the candidate carries no comparable evidence", () => {
    expect(
      buildCandidateSignalTiles(
        candidate({ normalization: "within-signal-rank-and-mad" }),
      ),
    ).toEqual([]);
  });

  it("projects each present signal once, in chat / audio / visual order", () => {
    const tiles = buildCandidateSignalTiles(
      candidate({
        normalization: "within-signal-rank-and-mad",
        visual: {
          rankPercentile: 0.88,
          robustPercentile: 0.8,
          normalizedScore: 0.9,
          sceneChangeStrength: 0.7,
        },
        audio: {
          rankPercentile: 0.97,
          robustPercentile: 0.9,
          normalizedScore: 0.92,
          eventKind: "short-loudness-burst",
        },
        chat: {
          rankPercentile: 0.9,
          robustPercentile: 0.85,
          normalizedScore: 0.88,
          bucketStartMs: 0,
          bucketEndMs: 5_000,
          messageCount: 30,
          uniqueAuthorCount: 18,
          reactionMessageCount: 12,
          baselineMessageCount: 6,
          baselineUniqueAuthorCount: 4,
          burstRatio: 4.24,
          robustBurstScore: 3,
          repetitionRatio: 0.1,
          singleAuthorRatio: 0.08,
          spamPenalty: 0,
        },
      }),
    );

    expect(tiles.map((tile) => tile.kind)).toEqual(["chat", "audio", "visual"]);
    expect(tiles[0]).toMatchObject({ value: "4.2", unit: "배" });
    expect(tiles[1]).toMatchObject({ value: "3", unit: "%" });
    expect(tiles[2]).toMatchObject({ value: "12", unit: "%" });
  });
});
