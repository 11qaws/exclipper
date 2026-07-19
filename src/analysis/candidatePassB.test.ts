import { describe, expect, it } from "vitest";

import {
  buildCandidatePassBEvidence,
  CANDIDATE_PASS_B_MAX_CUE_TEXT_LENGTH,
  CandidatePassBInputError,
  normalizeCandidatePassBText,
  selectCandidatePassBTargets,
  type CandidatePassBSourceCandidate,
  type CandidatePassBTarget,
} from "./candidatePassB";

function candidate(
  id: string,
  score: number,
  startMs: number,
  peakMs = startMs + 20_000,
  endMs = startMs + 45_000,
): CandidatePassBSourceCandidate {
  return { id, score, startMs, peakMs, endMs };
}

const target: CandidatePassBTarget = {
  candidateId: "candidate-main",
  decodeStartMs: 100_000,
  decodeEndMs: 145_000,
  reactionPeakMs: 128_000,
};

describe("selectCandidatePassBTargets", () => {
  it("selects at most 12 candidates in score-desc, time, then ID order deterministically", () => {
    const candidates = [
      candidate("same-time-b", 0.95, 180_000),
      candidate("same-time-a", 0.95, 180_000),
      candidate("earlier", 0.95, 60_000),
      ...Array.from({ length: 12 }, (_, index) =>
        candidate(`lower-${String(index).padStart(2, "0")}`, 0.8 - index / 100, 300_000 + index * 50_000),
      ),
    ];
    const reversed = [...candidates].reverse();

    const first = selectCandidatePassBTargets(candidates, { sourceDurationMs: 1_000_000 });
    const second = selectCandidatePassBTargets(reversed, { sourceDurationMs: 1_000_000 });

    expect(first).toEqual(second);
    expect(first).toHaveLength(12);
    expect(first.slice(0, 3).map(({ candidateId }) => candidateId)).toEqual([
      "earlier",
      "same-time-a",
      "same-time-b",
    ]);
    expect(first[0]).toEqual({
      candidateId: "earlier",
      decodeStartMs: 60_000,
      decodeEndMs: 105_000,
      reactionPeakMs: 80_000,
    });
  });

  it("does not mutate or expose the candidate score in decode targets", () => {
    const source = Object.freeze(candidate("immutable", 0.9, 10_000));
    const before = { ...source };

    const [selected] = selectCandidatePassBTargets([source], { sourceDurationMs: 100_000 });

    expect(source).toEqual(before);
    expect(selected).toEqual({
      candidateId: "immutable",
      decodeStartMs: 10_000,
      decodeEndMs: 55_000,
      reactionPeakMs: 30_000,
    });
    expect(Object.keys(selected ?? {})).not.toContain("score");
  });

  it.each([
    ["too short", candidate("short", 0.8, 0, 10_000, 29_999), "INVALID_CANDIDATE_RANGE"],
    ["too long", candidate("long", 0.8, 0, 20_000, 60_001), "INVALID_CANDIDATE_RANGE"],
    ["before source", candidate("negative", 0.8, -1, 20_000, 45_000), "INVALID_CANDIDATE_RANGE"],
    ["after source", candidate("after", 0.8, 60_000, 80_000, 105_000), "INVALID_CANDIDATE_RANGE"],
    ["peak outside", candidate("peak", 0.8, 0, 50_000, 45_000), "INVALID_CANDIDATE_PEAK"],
    ["bad score", candidate("score", Number.NaN, 0), "INVALID_CANDIDATE_SCORE"],
  ] as const)("rejects a %s candidate before selection", (_label, invalid, expectedCode) => {
    expect(() =>
      selectCandidatePassBTargets([invalid], { sourceDurationMs: 100_000 }),
    ).toThrowError(expect.objectContaining({ code: expectedCode }));
  });

  it("rejects duplicate IDs, an invalid max count, and a source over 12 hours", () => {
    const duplicate = candidate("duplicate", 0.8, 0);
    expect(() =>
      selectCandidatePassBTargets([duplicate, { ...duplicate, startMs: 50_000, peakMs: 70_000, endMs: 95_000 }], {
        sourceDurationMs: 100_000,
      }),
    ).toThrowError(expect.objectContaining({ code: "DUPLICATE_CANDIDATE_ID" }));
    expect(() =>
      selectCandidatePassBTargets([duplicate], { sourceDurationMs: 100_000, maxCandidates: 13 }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_MAX_CANDIDATES" }));
    expect(() =>
      selectCandidatePassBTargets([], { sourceDurationMs: 43_200_001 }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_SOURCE_DURATION" }));
  });

  it("uses a typed input error with the offending candidate identity", () => {
    try {
      selectCandidatePassBTargets([candidate(" bad-id ", 0.9, 0)], {
        sourceDurationMs: 100_000,
      });
      throw new Error("expected selection to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(CandidatePassBInputError);
      expect(error).toMatchObject({
        code: "INVALID_CANDIDATE_ID",
        candidateId: " bad-id ",
      });
    }
  });
});

describe("normalizeCandidatePassBText", () => {
  it("normalizes Unicode, model tokens, controls, and whitespace", () => {
    expect(
      normalizeCandidatePassBText("  <|ko|>  ＡＩ\u0000가\n  찾은   장면 <|12.00|> "),
    ).toBe("AI 가 찾은 장면");
  });

  it("enforces the global code-point length ceiling without splitting Unicode", () => {
    const normalized = normalizeCandidatePassBText(
      "가".repeat(CANDIDATE_PASS_B_MAX_CUE_TEXT_LENGTH + 20),
      CANDIDATE_PASS_B_MAX_CUE_TEXT_LENGTH + 1_000,
    );

    expect(Array.from(normalized)).toHaveLength(CANDIDATE_PASS_B_MAX_CUE_TEXT_LENGTH);
    expect(normalized.endsWith("…")).toBe(true);
  });
});

describe("buildCandidatePassBEvidence", () => {
  it("maps relative timestamps to absolute source time and separates before, near, and after cues", () => {
    const result = buildCandidatePassBEvidence(target, [
      { relativeStartMs: 34_000, relativeEndMs: 36_000, text: "그게 진짜였네", confidence: 0.91, noSpeechProbability: 0.05 },
      { relativeStartMs: 8_000, relativeEndMs: 11_000, text: "다시 한번 해볼게", confidence: 0.88, noSpeechProbability: 0.08 },
      { relativeStartMs: 25_000, relativeEndMs: 29_000, text: "어 뭐야", confidence: 0.93, noSpeechProbability: 0.04 },
    ]);

    expect(result.status).toBe("grounded-transcript");
    expect(result.cues).toEqual([
      {
        phase: "before-peak",
        absoluteStartMs: 108_000,
        absoluteEndMs: 111_000,
        text: "다시 한번 해볼게",
        confidence: 0.88,
      },
      {
        phase: "near-peak",
        absoluteStartMs: 125_000,
        absoluteEndMs: 129_000,
        text: "어 뭐야",
        confidence: 0.93,
      },
      {
        phase: "after-peak",
        absoluteStartMs: 134_000,
        absoluteEndMs: 136_000,
        text: "그게 진짜였네",
        confidence: 0.91,
      },
    ]);
    expect(result.overlay.event).toContain("반응 전에는");
    expect(result.overlay.event).toContain("반응 시점 부근에는");
    expect(result.overlay.event).toContain("반응 뒤에는");
    expect(result.overlay.basisLabel).toBe("자동 전사 단서 · 재생 확인 필요");
  });

  it("keeps timestamped text without an independent quality signal as provisional cues", () => {
    const result = buildCandidatePassBEvidence(target, [
      {
        relativeStartMs: 24_000,
        relativeEndMs: 28_000,
        text: "효과음을 말로 잘못 들었을 수도 있어",
      },
    ]);

    expect(result).toMatchObject({
      status: "provisional-transcript",
      fallbackReason: "low-quality-transcript",
      cues: [
        {
          phase: "near-peak",
          absoluteStartMs: 124_000,
          absoluteEndMs: 128_000,
          text: "효과음을 말로 잘못 들었을 수도 있어",
          confidence: null,
        },
      ],
    });
    expect(result.overlay.event).toContain("독립적인 대사 품질 신호가 없어");
    expect(result.overlay.why).toContain("기존 빠른 분석의 사건·원인 설명을 바꾸지 않아요");
    expect(JSON.stringify(result.overlay)).not.toContain("실제 대사");
  });

  it("grounds cues only when every displayed cue has confidence plus a speech-presence signal", () => {
    const result = buildCandidatePassBEvidence(target, [
      {
        relativeStartMs: 8_000,
        relativeEndMs: 11_000,
        text: "다시 해볼게",
        confidence: 0.9,
        isSilence: false,
      },
      {
        relativeStartMs: 25_000,
        relativeEndMs: 28_000,
        text: "잠깐만",
        confidence: 0.88,
        noSpeechProbability: 0.1,
      },
    ]);

    expect(result.status).toBe("grounded-transcript");
    expect(result.cues).toHaveLength(2);
    expect(result.overlay.basisLabel).toBe("자동 전사 단서 · 재생 확인 필요");
    expect(result.overlay.event).toContain("자동 전사에서");
    expect(result.overlay.event).not.toContain("실제 대사");
  });

  it.each([
    { confidence: 0.95 },
    { isSilence: false },
    { noSpeechProbability: 0.05 },
  ])("keeps a cue provisional when only one quality signal is present: %o", (quality) => {
    const result = buildCandidatePassBEvidence(target, [
      {
        relativeStartMs: 24_000,
        relativeEndMs: 28_000,
        text: "한 가지 신호만 있는 추정",
        ...quality,
      },
    ]);

    expect(result.status).toBe("provisional-transcript");
    expect(result.cues).toHaveLength(1);
  });

  it("selects the closest deterministic cue per phase regardless of chunk input order", () => {
    const chunks = [
      { relativeStartMs: 2_000, relativeEndMs: 4_000, text: "먼 발화", confidence: 0.99, noSpeechProbability: 0.03 },
      { relativeStartMs: 20_000, relativeEndMs: 22_000, text: "가까운 발화", confidence: 0.7, noSpeechProbability: 0.1 },
      { relativeStartMs: 27_000, relativeEndMs: 28_000, text: "중심 발화", confidence: 0.9, noSpeechProbability: 0.05 },
    ] as const;

    const first = buildCandidatePassBEvidence(target, chunks);
    const second = buildCandidatePassBEvidence(target, [...chunks].reverse());

    expect(first).toEqual(second);
    expect(first.cues.map(({ text }) => text)).toEqual(["가까운 발화", "중심 발화"]);
  });

  it("clamps overlapping transcript timestamps to the candidate window", () => {
    const result = buildCandidatePassBEvidence(target, [
      {
        relativeStartMs: -2_000,
        relativeEndMs: 2_000,
        text: "후보 시작 발화",
        confidence: 0.8,
        noSpeechProbability: 0.1,
      },
      {
        relativeStartMs: 44_000,
        relativeEndMs: 48_000,
        text: "후보 끝 발화",
        confidence: 0.8,
        noSpeechProbability: 0.1,
      },
    ]);

    expect(result.cues[0]).toMatchObject({ absoluteStartMs: 100_000, absoluteEndMs: 102_000 });
    expect(result.cues[1]).toMatchObject({ absoluteStartMs: 144_000, absoluteEndMs: 145_000 });
    expect(result.cues.every((cue) => cue.absoluteStartMs >= 100_000)).toBe(true);
    expect(result.cues.every((cue) => cue.absoluteEndMs <= 145_000)).toBe(true);
  });

  it("quotes only observed transcript and explicitly avoids inventing an event or cause", () => {
    const result = buildCandidatePassBEvidence(target, [
      { relativeStartMs: 24_000, relativeEndMs: 29_000, text: "잠깐 이거 뭐야", confidence: 0.84, noSpeechProbability: 0.08 },
    ]);
    const presentation = [
      result.overlay.event,
      result.overlay.why,
      result.overlay.reviewHint,
    ].join(" ");

    expect(result.overlay.event).toContain("잠깐 이거 뭐야");
    expect(result.overlay.event).toContain("확정하지 않아요");
    expect(result.overlay.why).toContain("이 전사가 정확하거나 사건의 원인이라는 뜻은 아니에요");
    expect(presentation).not.toMatch(/승리|패배|킬|우승|득점|반전|게임 사건/u);
  });

  it("keeps an observed event-like utterance as a quote instead of converting it to a factual event", () => {
    const result = buildCandidatePassBEvidence(target, [
      { relativeStartMs: 26_000, relativeEndMs: 29_000, text: "우리 이겼다", confidence: 0.9, noSpeechProbability: 0.05 },
    ]);

    expect(result.overlay.event).toContain("자동 전사에서 “우리 이겼다”로 인식됐어요");
    expect(result.overlay.event).not.toMatch(/승리(?:한|했다|장면|사건)/u);
    expect(result.overlay.event).toContain("사건의 종류");
  });

  it("falls back cleanly for no chunks or an empty normalized transcript", () => {
    const noChunks = buildCandidatePassBEvidence(target, []);
    const empty = buildCandidatePassBEvidence(target, [
      { relativeStartMs: 1_000, relativeEndMs: 2_000, text: "<|ko|>   <|nospeech|>" },
    ]);

    expect(noChunks).toMatchObject({
      candidateId: "candidate-main",
      status: "fast-pass-fallback",
      fallbackReason: "empty-transcript",
      cues: [],
    });
    expect(empty.fallbackReason).toBe("empty-transcript");
    expect(empty.overlay.basisLabel).toContain("빠른 근거 유지");
    expect(empty.overlay.why).toContain("기존 빠른 분석 후보");
  });

  it("falls back for silence and non-verbal transcript markers", () => {
    const result = buildCandidatePassBEvidence(target, [
      {
        relativeStartMs: 10_000,
        relativeEndMs: 12_000,
        text: "환각일 수 있는 문장",
        confidence: 0.95,
        noSpeechProbability: 0.9,
      },
      { relativeStartMs: 20_000, relativeEndMs: 22_000, text: "[음악]" },
    ]);

    expect(result).toMatchObject({
      status: "fast-pass-fallback",
      fallbackReason: "silent",
      cues: [],
    });
    expect(result.overlay.event).toContain("말소리가 확인되지 않아");
  });

  it("never promotes an explicit non-speech marker even when its confidence is high", () => {
    const result = buildCandidatePassBEvidence(target, [
      {
        relativeStartMs: 20_000,
        relativeEndMs: 22_000,
        text: "[음악]",
        confidence: 0.99,
      },
    ]);

    expect(result).toMatchObject({
      status: "fast-pass-fallback",
      fallbackReason: "silent",
      cues: [],
    });
  });

  it("falls back when every lexical chunk has low or malformed quality", () => {
    const result = buildCandidatePassBEvidence(target, [
      { relativeStartMs: 10_000, relativeEndMs: 12_000, text: "낮은 신뢰", confidence: 0.2 },
      { relativeStartMs: Number.NaN, relativeEndMs: 20_000, text: "잘못된 시각", confidence: 0.9 },
      { relativeStartMs: 20_000, relativeEndMs: 22_000, text: "잘못된 점수", confidence: 1.2 },
    ]);

    expect(result).toMatchObject({
      status: "fast-pass-fallback",
      fallbackReason: "low-quality-transcript",
      cues: [],
      quality: {
        receivedChunkCount: 3,
        usableChunkCount: 0,
        discardedChunkCount: 3,
      },
    });
    expect(result.overlay.event).toContain("확인되지 않은 사건을 설명에 넣지 않았어요");
  });

  it("keeps usable speech when another chunk fails and reports bounded quality counts", () => {
    const result = buildCandidatePassBEvidence(target, [
      { relativeStartMs: 25_000, relativeEndMs: 28_000, text: "확인된 단서", confidence: 0.8, noSpeechProbability: 0.1 },
      { relativeStartMs: 30_000, relativeEndMs: 31_000, text: "낮은 단서", confidence: 0.1 },
      { relativeStartMs: 50_000, relativeEndMs: 51_000, text: "범위 밖", confidence: 0.9 },
    ]);

    expect(result.status).toBe("grounded-transcript");
    expect(result.cues).toHaveLength(1);
    expect(result.quality).toEqual({
      receivedChunkCount: 3,
      mappedChunkCount: 2,
      usableChunkCount: 1,
      discardedChunkCount: 2,
      meanConfidence: 0.8,
    });
  });

  it("returns candidate-ID evidence without proposal, range, score, rank, or review mutation fields", () => {
    const result = buildCandidatePassBEvidence(target, [
      { relativeStartMs: 25_000, relativeEndMs: 28_000, text: "전사 문장", confidence: 0.9, noSpeechProbability: 0.05 },
    ]);
    const forbiddenKeys = new Set([
      "proposal",
      "proposalRange",
      "effectiveRange",
      "startMs",
      "endMs",
      "peakMs",
      "score",
      "rank",
      "reviewState",
      "approvedRevision",
      "boundaryRevision",
      "userRevision",
    ]);
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (value === null || typeof value !== "object") {
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        expect(forbiddenKeys.has(key), `forbidden result key: ${key}`).toBe(false);
        visit(child);
      }
    };

    visit(result);
    expect(result.candidateId).toBe(target.candidateId);
  });

  it("rejects malformed transcript configuration instead of silently changing quality gates", () => {
    expect(() =>
      buildCandidatePassBEvidence(target, [], { minConfidence: 1.1 }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_TRANSCRIPT_OPTIONS" }));
    expect(() =>
      buildCandidatePassBEvidence(target, [], {
        maxCueTextLength: CANDIDATE_PASS_B_MAX_CUE_TEXT_LENGTH + 1,
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_TRANSCRIPT_OPTIONS" }));
  });
});
