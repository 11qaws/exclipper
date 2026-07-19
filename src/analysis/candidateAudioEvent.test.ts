import { describe, expect, it } from "vitest";

import {
  aggregateCandidateAudioEventScores,
  buildCandidateAudioEventWindows,
  CANDIDATE_AUDIO_EVENT_AUDIOSET_ALLOWLIST,
  CANDIDATE_AUDIO_EVENT_AUDIOSET_LABEL_COUNT,
  CANDIDATE_AUDIO_EVENT_MAX_DETECTIONS,
  CANDIDATE_AUDIO_EVENT_PROVISIONAL_INTERPRETATION,
  CandidateAudioEventInputError,
  compareCandidateAudioEventAggregationQuality,
  MAX_CANDIDATE_AUDIO_EVENT_TARGETS,
  type CandidateAudioEventTarget,
  type CandidateAudioEventWindow,
  type CandidateAudioEventWindowScores,
} from "./candidateAudioEvent";

const target: CandidateAudioEventTarget = {
  candidateId: "candidate-main",
  startMs: 100_000,
  endMs: 145_000,
  peakMs: 128_000,
};

function scoreVector(
  entries: Readonly<Record<number, number>> = {},
): Float32Array {
  const scores = new Float32Array(CANDIDATE_AUDIO_EVENT_AUDIOSET_LABEL_COUNT);
  for (const [rawIndex, score] of Object.entries(entries)) {
    scores[Number(rawIndex)] = score;
  }
  return scores;
}

function scoredWindows(
  selectedTarget: CandidateAudioEventTarget,
  entriesByPhase: Partial<
    Record<CandidateAudioEventWindow["phase"], Readonly<Record<number, number>>>
  >,
): CandidateAudioEventWindowScores[] {
  return buildCandidateAudioEventWindows([selectedTarget]).map((window) => ({
    window,
    sigmoidScores: scoreVector(entriesByPhase[window.phase]),
  }));
}

function aggregationWithScore(
  score: number,
  labelId = 16,
) {
  return aggregateCandidateAudioEventScores(
    target,
    scoredWindows(target, { "near-peak": { [labelId]: score } }),
  );
}

describe("CANDIDATE_AUDIO_EVENT_AUDIOSET_ALLOWLIST", () => {
  it("pins only the exact product labels and includes Snicker and Chuckle", () => {
    expect(CANDIDATE_AUDIO_EVENT_AUDIOSET_ALLOWLIST).toEqual([
      { labelId: 16, label: "Laughter", kind: "laughter" },
      { labelId: 18, label: "Giggle", kind: "laughter" },
      { labelId: 19, label: "Snicker", kind: "laughter" },
      { labelId: 20, label: "Belly laugh", kind: "laughter" },
      { labelId: 21, label: "Chuckle, chortle", kind: "laughter" },
      { labelId: 8, label: "Shout", kind: "shout" },
      { labelId: 9, label: "Bellow", kind: "shout" },
      { labelId: 10, label: "Whoop", kind: "shout" },
      { labelId: 11, label: "Yell", kind: "shout" },
      { labelId: 14, label: "Screaming", kind: "scream" },
      {
        labelId: 63,
        label: "Clapping",
        kind: "applause-or-cheering",
      },
      {
        labelId: 66,
        label: "Cheering",
        kind: "applause-or-cheering",
      },
      {
        labelId: 67,
        label: "Applause",
        kind: "applause-or-cheering",
      },
    ]);
    expect(CANDIDATE_AUDIO_EVENT_AUDIOSET_ALLOWLIST.map(({ labelId }) => labelId)).not.toContain(
      17,
    );
    expect(CANDIDATE_AUDIO_EVENT_AUDIOSET_ALLOWLIST.map(({ labelId }) => labelId)).not.toContain(
      68,
    );
    expect(CANDIDATE_AUDIO_EVENT_AUDIOSET_ALLOWLIST.map(({ labelId }) => labelId)).not.toContain(
      69,
    );
  });
});

describe("buildCandidateAudioEventWindows", () => {
  it("builds deterministic before, near, and after 10-second windows", () => {
    expect(buildCandidateAudioEventWindows([target])).toEqual([
      {
        candidateId: "candidate-main",
        phase: "before-peak",
        sourceStartMs: 118_000,
        sourceEndMs: 128_000,
      },
      {
        candidateId: "candidate-main",
        phase: "near-peak",
        sourceStartMs: 123_000,
        sourceEndMs: 133_000,
      },
      {
        candidateId: "candidate-main",
        phase: "after-peak",
        sourceStartMs: 128_000,
        sourceEndMs: 138_000,
      },
    ]);
  });

  it("clamps boundary peaks, de-duplicates ranges, and keeps the near window", () => {
    const atStart: CandidateAudioEventTarget = {
      candidateId: "at-start",
      startMs: 0,
      endMs: 30_000,
      peakMs: 0,
    };
    expect(buildCandidateAudioEventWindows([atStart])).toEqual([
      {
        candidateId: "at-start",
        phase: "near-peak",
        sourceStartMs: 0,
        sourceEndMs: 10_000,
      },
    ]);

    const nearStart = { ...atStart, candidateId: "near-start", peakMs: 5_000 };
    expect(buildCandidateAudioEventWindows([nearStart])).toEqual([
      {
        candidateId: "near-start",
        phase: "near-peak",
        sourceStartMs: 0,
        sourceEndMs: 10_000,
      },
      {
        candidateId: "near-start",
        phase: "after-peak",
        sourceStartMs: 5_000,
        sourceEndMs: 15_000,
      },
    ]);
  });

  it("supports at most 12 targets and never plans more than 36 windows", () => {
    const targets = Array.from(
      { length: MAX_CANDIDATE_AUDIO_EVENT_TARGETS },
      (_, index): CandidateAudioEventTarget => {
        const startMs = index * 70_000;
        return {
          candidateId: `candidate-${index}`,
          startMs,
          endMs: startMs + 30_000,
          peakMs: startMs + 15_000,
        };
      },
    );
    const windows = buildCandidateAudioEventWindows(targets);
    expect(windows).toHaveLength(36);
    expect(
      windows.every(
        ({ sourceStartMs, sourceEndMs }) => sourceEndMs - sourceStartMs === 10_000,
      ),
    ).toBe(true);
    expect(buildCandidateAudioEventWindows([])).toEqual([]);
  });

  it("does not mutate target snapshots", () => {
    const immutable = Object.freeze({ ...target });
    const before = { ...immutable };
    buildCandidateAudioEventWindows([immutable]);
    expect(immutable).toEqual(before);
  });

  it("rejects too many targets and duplicate or unsafe identities", () => {
    const tooMany = Array.from(
      { length: MAX_CANDIDATE_AUDIO_EVENT_TARGETS + 1 },
      (_, index): CandidateAudioEventTarget => ({
        candidateId: `candidate-${index}`,
        startMs: index * 70_000,
        endMs: index * 70_000 + 30_000,
        peakMs: index * 70_000 + 15_000,
      }),
    );
    expect(() => buildCandidateAudioEventWindows(tooMany)).toThrowError(
      expect.objectContaining({ code: "TOO_MANY_TARGETS" }),
    );
    expect(() =>
      buildCandidateAudioEventWindows([target, { ...target }]),
    ).toThrowError(expect.objectContaining({ code: "DUPLICATE_CANDIDATE_ID" }));
    expect(() =>
      buildCandidateAudioEventWindows([{ ...target, candidateId: " bad " }]),
    ).toThrowError(expect.objectContaining({ code: "INVALID_CANDIDATE_ID" }));
  });

  it.each([
    [{ ...target, startMs: Number.NaN }, "INVALID_TARGET_RANGE"],
    [{ ...target, endMs: target.startMs + 29_999 }, "INVALID_TARGET_RANGE"],
    [{ ...target, endMs: target.startMs + 60_001 }, "INVALID_TARGET_RANGE"],
    [
      {
        ...target,
        startMs: 43_200_000 - 30_000,
        endMs: 43_200_001,
        peakMs: 43_200_000 - 15_000,
      },
      "INVALID_TARGET_RANGE",
    ],
    [{ ...target, peakMs: Number.NaN }, "INVALID_REACTION_PEAK"],
    [{ ...target, peakMs: target.endMs + 1 }, "INVALID_REACTION_PEAK"],
  ] as const)("rejects invalid target time input %#", (invalid, code) => {
    expect(() => buildCandidateAudioEventWindows([invalid])).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it("uses a typed input error with candidate identity", () => {
    try {
      buildCandidateAudioEventWindows([{ ...target, endMs: target.startMs }]);
      throw new Error("expected invalid range");
    } catch (error) {
      expect(error).toBeInstanceOf(CandidateAudioEventInputError);
      expect(error).toMatchObject({
        code: "INVALID_TARGET_RANGE",
        candidateId: "candidate-main",
      });
    }
  });
});

describe("aggregateCandidateAudioEventScores", () => {
  it("sums related laughter scores and projects a strong fixed detection", () => {
    const aggregation = aggregateCandidateAudioEventScores(
      target,
      scoredWindows(target, {
        "near-peak": { 16: 0.106, 19: 0.418, 21: 0.32 },
      }),
    );
    expect(aggregation.result).toMatchObject({
      candidateId: "candidate-main",
      status: "detected",
      quality: "provisional-audio-event",
      analyzedWindowCount: 3,
      detections: [
        {
          kind: "laughter",
          strength: "strong",
          sourceStartMs: 123_000,
          sourceEndMs: 133_000,
        },
      ],
    });
    expect(aggregation.quality).toMatchObject({
      level: "strong",
      detectionCount: 1,
      strongDetectionCount: 1,
    });
    expect(aggregation.quality.topGroupScore).toBeCloseTo(0.844, 5);
  });

  it("keeps a one-window 0.20+ event possible and promotes repeated windows", () => {
    const possible = aggregateCandidateAudioEventScores(
      target,
      scoredWindows(target, {
        "near-peak": { 16: 0.043, 19: 0.08, 21: 0.201 },
      }),
    );
    expect(possible.result).toMatchObject({
      status: "detected",
      detections: [{ kind: "laughter", strength: "possible" }],
    });

    const repeated = aggregateCandidateAudioEventScores(
      target,
      scoredWindows(target, {
        "before-peak": { 16: 0.11, 21: 0.1 },
        "after-peak": { 16: 0.12, 21: 0.1 },
      }),
    );
    expect(repeated.result).toMatchObject({
      status: "detected",
      detections: [{ kind: "laughter", strength: "strong" }],
    });
    expect(repeated.quality.supportingWindowCount).toBe(2);
  });

  it("returns no-clear when only non-allowlisted or weak values are high", () => {
    const aggregation = aggregateCandidateAudioEventScores(
      target,
      scoredWindows(target, {
        "near-peak": { 0: 0.99, 16: 0.19 },
      }),
    );
    expect(aggregation.result).toMatchObject({
      status: "no-clear-event",
      reasonCode: "LOW_EVENT_CONFIDENCE",
      detections: [],
    });
    const serialized = JSON.stringify(aggregation.result);
    expect(serialized).not.toContain("sigmoidScores");
    expect(serialized).not.toContain("0.99");
    expect(serialized).not.toContain("Speech");
  });

  it("returns NO_ALLOWLIST_EVENT for a near-zero allowlist vector", () => {
    expect(aggregationWithScore(0.00006).result).toMatchObject({
      status: "no-clear-event",
      reasonCode: "NO_ALLOWLIST_EVENT",
    });
  });

  it("keeps only the best two hits with deterministic ordering", () => {
    const input = scoredWindows(target, {
      "near-peak": {
        16: 0.9,
        8: 0.7,
        14: 0.6,
        63: 0.8,
      },
    });
    const first = aggregateCandidateAudioEventScores(target, input);
    const second = aggregateCandidateAudioEventScores(target, [...input].reverse());
    expect(first).toEqual(second);
    expect(first.result.status).toBe("detected");
    if (first.result.status !== "detected") {
      throw new Error("expected detections");
    }
    expect(first.result.detections).toHaveLength(CANDIDATE_AUDIO_EVENT_MAX_DETECTIONS);
    expect(first.result.detections.map(({ kind }) => kind)).toEqual([
      "laughter",
      "applause-or-cheering",
    ]);
  });

  it("uses the near-peak range as the deterministic tie breaker", () => {
    const aggregation = aggregateCandidateAudioEventScores(
      target,
      scoredWindows(target, {
        "before-peak": { 14: 0.6 },
        "near-peak": { 14: 0.6 },
        "after-peak": { 14: 0.6 },
      }),
    );
    expect(aggregation.result).toMatchObject({
      status: "detected",
      detections: [
        {
          kind: "scream",
          sourceStartMs: 123_000,
          sourceEndMs: 133_000,
        },
      ],
    });
  });

  it("projects multiple detections in source-time order for the Worker contract", () => {
    const aggregation = aggregateCandidateAudioEventScores(
      target,
      scoredWindows(target, {
        "before-peak": { 63: 0.3 },
        "after-peak": { 16: 0.9 },
      }),
    );
    expect(aggregation.result).toMatchObject({
      status: "detected",
      detections: [
        {
          kind: "applause-or-cheering",
          sourceStartMs: 118_000,
          sourceEndMs: 128_000,
        },
        {
          kind: "laughter",
          sourceStartMs: 128_000,
          sourceEndMs: 138_000,
        },
      ],
    });
    expect(aggregation.quality.level).toBe("strong");
    expect(aggregation.quality.topGroupScore).toBeCloseTo(0.9);
  });

  it("attaches only the pinned model descriptor and provisional mixed-audio contract", () => {
    const { result } = aggregationWithScore(0.7);
    expect(result).toMatchObject({
      mode: "candidate-audio-event",
      sourceStartMs: 100_000,
      sourceEndMs: 145_000,
      reactionPeakMs: 128_000,
      quality: "provisional-audio-event",
      model: {
        id: "Xenova/ast-finetuned-audioset-10-10-0.4593",
        revision: "249a1fbf0286b40e7f1ed687a8ae396997bf7dc6",
        dtype: "q8",
        device: "wasm",
      },
      sampleRateHz: 16_000,
    });
    expect(CANDIDATE_AUDIO_EVENT_PROVISIONAL_INTERPRETATION).toEqual({
      quality: "provisional-audio-event",
      audioScope: "mixed-program-audio",
      sourceAttribution: "unresolved",
      causalInterpretation: "not-inferred",
    });
  });

  it.each([
    [new Float32Array(CANDIDATE_AUDIO_EVENT_AUDIOSET_LABEL_COUNT - 1), "wrong length"],
    [scoreVector({ 16: Number.NaN }), "NaN"],
    [scoreVector({ 16: Number.POSITIVE_INFINITY }), "infinity"],
    [scoreVector({ 16: -0.01 }), "negative"],
    [scoreVector({ 16: 1.01 }), "over one"],
  ])("rejects an invalid sigmoid vector: %s", (invalidScores) => {
    const input = scoredWindows(target, {});
    input[0] = { ...input[0]!, sigmoidScores: invalidScores };
    expect(() => aggregateCandidateAudioEventScores(target, input)).toThrowError(
      expect.objectContaining({ code: "INVALID_SCORE_VECTOR" }),
    );
  });

  it("rejects missing, duplicate, foreign, and time-shifted windows", () => {
    const valid = scoredWindows(target, {});
    expect(() => aggregateCandidateAudioEventScores(target, valid.slice(1))).toThrowError(
      expect.objectContaining({ code: "INVALID_WINDOW_SET" }),
    );
    expect(() =>
      aggregateCandidateAudioEventScores(target, [valid[0]!, valid[0]!, valid[2]!]),
    ).toThrowError(expect.objectContaining({ code: "INVALID_WINDOW_SET" }));
    expect(() =>
      aggregateCandidateAudioEventScores(target, [
        { ...valid[0]!, window: { ...valid[0]!.window, candidateId: "other" } },
        valid[1]!,
        valid[2]!,
      ]),
    ).toThrowError(expect.objectContaining({ code: "INVALID_WINDOW_SET" }));
    expect(() =>
      aggregateCandidateAudioEventScores(target, [
        {
          ...valid[0]!,
          window: {
            ...valid[0]!.window,
            sourceStartMs: valid[0]!.window.sourceStartMs + 1,
          },
        },
        valid[1]!,
        valid[2]!,
      ]),
    ).toThrowError(expect.objectContaining({ code: "INVALID_WINDOW_SET" }));
  });
});

describe("compareCandidateAudioEventAggregationQuality", () => {
  it("orders no-clear, possible, and strong monotonically", () => {
    const none = aggregationWithScore(0.1).quality;
    const possible = aggregationWithScore(0.3).quality;
    const strong = aggregationWithScore(0.6).quality;
    expect(compareCandidateAudioEventAggregationQuality(possible, none)).toBe(1);
    expect(compareCandidateAudioEventAggregationQuality(strong, possible)).toBe(1);
    expect(compareCandidateAudioEventAggregationQuality(none, strong)).toBe(-1);
    expect(compareCandidateAudioEventAggregationQuality(strong, strong)).toBe(0);
  });

  it("never lowers quality when an allowlisted score only increases", () => {
    const scores = [0, 0.05, 0.19, 0.2, 0.35, 0.5, 0.9];
    const qualities = scores.map((score) => aggregationWithScore(score).quality);
    for (let index = 1; index < qualities.length; index += 1) {
      expect(
        compareCandidateAudioEventAggregationQuality(
          qualities[index]!,
          qualities[index - 1]!,
        ),
      ).toBeGreaterThanOrEqual(0);
    }
  });
});
