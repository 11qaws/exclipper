import { describe, expect, it } from "vitest";

import type { UnifiedHighlightCandidate } from "../analysis/highlightFusion";
import { buildCandidateSignalTiles } from "./candidateSignals";

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
          rmsLiftRatio: 3.24,
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
    expect(tiles[1]).toMatchObject({ value: "3.2", unit: "배" });
    expect(tiles[2]).toMatchObject({ value: "0.70", unit: "" });
    // The rank percentile stays an internal priority input: as a tile it would
    // read as a quality grade the ranking cannot support.
    expect(JSON.stringify(tiles)).not.toMatch(/상위/u);
  });

  it("skips a signal whose only figure would have been its rank", () => {
    const tiles = buildCandidateSignalTiles(
      candidate({
        normalization: "within-signal-rank-and-mad",
        audio: {
          rankPercentile: 0.97,
          robustPercentile: 0.9,
          normalizedScore: 0.92,
          eventKind: "short-loudness-burst",
        },
        visual: {
          rankPercentile: 0.88,
          robustPercentile: 0.8,
          normalizedScore: 0.9,
        },
      }),
    );

    expect(tiles).toEqual([]);
  });
});
