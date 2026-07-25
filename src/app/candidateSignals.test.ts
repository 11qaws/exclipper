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

  it("projects only the baseline-relative signals, in chat / audio order", () => {
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

    // The visual signal is present with a strength of 0.7 and still gets no
    // tile. A tile is a bare number, and every figure here has to be readable
    // on its own: the rank would pose as a quality grade, and the scene-change
    // strength is unitless with nothing to compare it against.
    expect(tiles.map((tile) => tile.kind)).toEqual(["chat", "audio"]);
    expect(tiles[0]).toMatchObject({ value: "4.2", unit: "배", note: "평소 대비" });
    expect(tiles[1]).toMatchObject({ value: "3.2", unit: "배", note: "평소 음량 대비" });
    expect(JSON.stringify(tiles)).not.toMatch(/상위|강도|0\.70/u);
  });

  it("skips a signal that has no figure readable against a baseline", () => {
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
          sceneChangeStrength: 0.7,
        },
      }),
    );

    expect(tiles).toEqual([]);
  });
});
