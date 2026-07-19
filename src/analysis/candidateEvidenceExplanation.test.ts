import { describe, expect, it } from "vitest";

import type {
  CandidatePassBCue,
  CandidatePassBEvidence,
} from "./candidatePassB";
import {
  buildCandidateEvidenceExplanation,
  buildCandidateEvidenceExplanationWithFallback,
  CANDIDATE_EVIDENCE_EXPLANATION_VERSION,
  CANDIDATE_EVIDENCE_MAX_QUOTE_CODE_POINTS,
  CandidateEvidenceExplanationError,
  normalizeCandidateEvidenceQuote,
  resolveCandidateEvidenceReplayTarget,
  type CandidateEvidenceExplanationInput,
} from "./candidateEvidenceExplanation";
import type { UnifiedHighlightCandidate } from "./highlightFusion";
import {
  CANDIDATE_AUDIO_EVENT_MODEL_DTYPE,
  CANDIDATE_AUDIO_EVENT_MODEL_ID,
  CANDIDATE_AUDIO_EVENT_MODEL_REVISION,
  CANDIDATE_AUDIO_EVENT_RUNTIME_DEVICE,
  CANDIDATE_AUDIO_EVENT_SAMPLE_RATE_HZ,
  type CandidateAudioEventCandidateResult,
  type CandidateAudioEventDetection,
} from "./candidateAudioEventWorkerProtocol";

const CANDIDATE_ID = "highlight-audio-chat-1234abcd";

const audioEvidence = {
  rankPercentile: 0.95,
  robustPercentile: 0.9,
  normalizedScore: 0.93,
  eventKind: "sustained-vocal-reaction",
  rmsLiftRatio: 3.2,
  sustainedWindowCount: 4,
} as const;

const chatEvidence = {
  rankPercentile: 0.9,
  robustPercentile: 0.85,
  normalizedScore: 0.88,
  bucketStartMs: 50_000,
  bucketEndMs: 55_000,
  messageCount: 40,
  uniqueAuthorCount: 25,
  reactionMessageCount: 18,
  baselineMessageCount: 8,
  baselineUniqueAuthorCount: 5,
  burstRatio: 4.8,
  robustBurstScore: 3,
  repetitionRatio: 0.1,
  singleAuthorRatio: 0.08,
  spamPenalty: 0,
} as const;

const visualEvidence = {
  rankPercentile: 0.98,
  robustPercentile: 0.9,
  normalizedScore: 0.94,
  previousFrameMs: 49_000,
  currentFrameMs: 51_000,
  sceneChangeStrength: 4.2,
} as const;

function candidate(
  evidence: UnifiedHighlightCandidate["evidence"] = {
    normalization: "within-signal-rank-and-mad",
    audio: audioEvidence,
    chat: chatEvidence,
    visual: visualEvidence,
  },
  signalKinds: UnifiedHighlightCandidate["signalKinds"] = [
    "audio",
    "chat",
    "visual",
  ],
): UnifiedHighlightCandidate {
  return {
    id: CANDIDATE_ID,
    peakMs: 50_000,
    startMs: 27_500,
    endMs: 72_500,
    score: 0.91,
    reason: "presentation-only",
    signalKinds,
    evidence,
  };
}

function cue(
  phase: CandidatePassBCue["phase"],
  startMs: number,
  text: string,
  confidence: number | null = null,
): CandidatePassBCue {
  return {
    phase,
    absoluteStartMs: startMs,
    absoluteEndMs: startMs + 1_500,
    text,
    confidence,
  };
}

function transcriptEvidence(
  status: "grounded-transcript" | "provisional-transcript",
  cues: readonly CandidatePassBCue[],
  candidateId = CANDIDATE_ID,
): CandidatePassBEvidence {
  const base = {
    candidateId,
    cues,
    quality: {
      receivedChunkCount: cues.length,
      mappedChunkCount: cues.length,
      usableChunkCount: cues.length,
      discardedChunkCount: 0,
      meanConfidence: status === "grounded-transcript" ? 0.82 : null,
    },
  };
  if (status === "grounded-transcript") {
    return {
      ...base,
      status,
      fallbackReason: null,
      overlay: {
        event: "presentation-only",
        why: "presentation-only",
        reviewHint: "presentation-only",
        basisLabel: "자동 전사 단서 · 재생 확인 필요",
      },
    };
  }
  return {
    ...base,
    status,
    fallbackReason: "low-quality-transcript",
    overlay: {
      event: "presentation-only",
      why: "presentation-only",
      reviewHint: "presentation-only",
      basisLabel: "자동 전사 추정 · 빠른 근거 유지",
    },
  };
}

function fallbackTranscriptEvidence(
  fallbackReason: "silent" | "empty-transcript" | "low-quality-transcript",
  candidateId = CANDIDATE_ID,
): CandidatePassBEvidence {
  return {
    candidateId,
    status: "fast-pass-fallback",
    fallbackReason,
    cues: [],
    overlay: {
      event: "presentation-only",
      why: "presentation-only",
      reviewHint: "presentation-only",
      basisLabel: "또렷한 대사 없음 · 빠른 근거 유지",
    },
    quality: {
      receivedChunkCount: 0,
      mappedChunkCount: 0,
      usableChunkCount: 0,
      discardedChunkCount: 0,
      meanConfidence: null,
    },
  };
}

function audioEventBase(candidateId = CANDIDATE_ID) {
  return {
    mode: "candidate-audio-event",
    candidateId,
    sourceStartMs: 27_500,
    sourceEndMs: 72_500,
    reactionPeakMs: 50_000,
    analyzedWindowCount: 3,
    quality: "provisional-audio-event",
    model: {
      id: CANDIDATE_AUDIO_EVENT_MODEL_ID,
      revision: CANDIDATE_AUDIO_EVENT_MODEL_REVISION,
      dtype: CANDIDATE_AUDIO_EVENT_MODEL_DTYPE,
      device: CANDIDATE_AUDIO_EVENT_RUNTIME_DEVICE,
    },
    sampleRateHz: CANDIDATE_AUDIO_EVENT_SAMPLE_RATE_HZ,
  } as const;
}

function detectedAudioEvent(
  detections: readonly [
    CandidateAudioEventDetection,
    ...CandidateAudioEventDetection[],
  ],
  candidateId = CANDIDATE_ID,
): CandidateAudioEventCandidateResult {
  return {
    ...audioEventBase(candidateId),
    status: "detected",
    detections,
  };
}

function noClearAudioEvent(
  candidateId = CANDIDATE_ID,
): CandidateAudioEventCandidateResult {
  return {
    ...audioEventBase(candidateId),
    status: "no-clear-event",
    reasonCode: "NO_ALLOWLIST_EVENT",
    detections: [],
  };
}

function input(
  overrides: Partial<CandidateEvidenceExplanationInput> = {},
): CandidateEvidenceExplanationInput {
  return {
    candidate: candidate(),
    effectiveRange: { startMs: 27_500, endMs: 72_500 },
    ...overrides,
  };
}

function allExplanationText(
  explanation: ReturnType<typeof buildCandidateEvidenceExplanation>,
): string {
  return [
    explanation.headline,
    explanation.eventClue.text,
    explanation.reactionClue.text,
    explanation.whyWorthReviewing.text,
    ...explanation.observedStatements.map(({ text }) => text),
    explanation.primaryReplayFocus.label,
  ].join(" ");
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

describe("buildCandidateEvidenceExplanation", () => {
  it("creates the versioned, safe audio-chat-visual explanation in a fixed evidence order", () => {
    const explanation = buildCandidateEvidenceExplanation(input());

    expect(explanation.version).toBe(CANDIDATE_EVIDENCE_EXPLANATION_VERSION);
    expect(explanation.candidateId).toBe(CANDIDATE_ID);
    expect(explanation.headline).toBe(
      "혼합 방송 오디오와 채팅 반응 신호가 함께 잡힌 후보",
    );
    expect(explanation.unknowns).toEqual(["event", "actor", "cause", "outcome"]);
    expect(explanation.observedStatements.map(({ kind }) => kind)).toEqual([
      "fast-audio",
      "chat",
      "visual",
    ]);
    expect(explanation.eventClue.basisCodes).toEqual([
      "fast-visual-context",
      "semantic-event-unknown",
      "causality-unknown",
      "outcome-unknown",
    ]);
    expect(explanation.whyWorthReviewing.basisCodes).toContain(
      "audio-chat-cooccurrence",
    );
    expect(explanation.primaryReplayFocus).toMatchObject({
      basis: "reaction-peak",
      startMs: 50_000,
      endMs: 50_000,
      insideEffectiveRange: true,
    });

    const text = allExplanationText(explanation);
    expect(text).toContain("고유 작성자 키 25개");
    expect(text).toContain("소리의 주체는 구분되지 않았어요");
    expect(text).not.toMatch(/참여자\s*25명|25명이|합의|공감대/u);
    expect(text).not.toMatch(
      /화면 변화(?:가|로 인해) 반응(?:을|이).*(?:일으켰|유발했|만들었)/u,
    );
  });

  it.each([
    {
      label: "audio only",
      evidence: {
        normalization: "within-signal-rank-and-mad",
        audio: audioEvidence,
      } as const,
      kinds: ["audio"] as const,
      headline: "혼합 방송 오디오 반응 신호가 잡힌 후보",
      worthBasis: "fast-audio-reaction",
    },
    {
      label: "chat only",
      evidence: {
        normalization: "within-signal-rank-and-mad",
        chat: chatEvidence,
      } as const,
      kinds: ["chat"] as const,
      headline: "채팅 반응 신호가 모인 후보",
      worthBasis: "fast-chat-reaction",
    },
    {
      label: "visual only",
      evidence: {
        normalization: "within-signal-rank-and-mad",
        visual: visualEvidence,
      } as const,
      kinds: ["visual"] as const,
      headline: "화면 변화로 남긴 탐색 후보",
      worthBasis: "fast-visual-context",
    },
  ])("keeps the $label combination honest", ({ evidence, kinds, headline, worthBasis }) => {
    const explanation = buildCandidateEvidenceExplanation(
      input({ candidate: candidate(evidence, kinds) }),
    );

    expect(explanation.headline).toBe(headline);
    expect(explanation.whyWorthReviewing.basisCodes).toContain(worthBasis);
    expect(explanation.unknowns).toEqual(["event", "actor", "cause", "outcome"]);
    if (kinds.length === 1 && kinds[0] === "visual") {
      expect(explanation.reactionClue.basisCodes).toEqual([
        "fast-visual-context",
      ]);
      expect(explanation.reactionClue.basisCodes).not.toContain(
        "mixed-audio-source-unresolved",
      );
    }
  });

  it("keeps a malicious victory transcript as a normalized estimate and never changes worth", () => {
    const passBEvidence = transcriptEvidence("provisional-transcript", [
      cue(
        "near-peak",
        49_500,
        "\u0000  내가   우승했다\n상대를 이겼다  ",
      ),
    ]);
    const baseline = buildCandidateEvidenceExplanation(input());
    const explanation = buildCandidateEvidenceExplanation(input({ passBEvidence }));

    expect(explanation.eventClue.text).toContain(
      "자동 전사 추정에서 반응 시점 부근 “내가 우승했다 상대를 이겼다”로 인식됐어요",
    );
    expect(explanation.eventClue.text).toContain("확정하지 않아요");
    expect(explanation.eventClue.basisCodes).toContain(
      "transcript-provisional-cue",
    );
    expect(explanation.whyWorthReviewing).toEqual(baseline.whyWorthReviewing);
    expect(explanation.unknowns).toEqual(["event", "actor", "cause", "outcome"]);
  });

  it("uses a qualified transcript only as a quoted clue, not an event fact", () => {
    const passBEvidence = transcriptEvidence("grounded-transcript", [
      cue("near-peak", 50_000, "골 넣었어", 0.9),
    ]);
    const explanation = buildCandidateEvidenceExplanation(input({ passBEvidence }));

    expect(explanation.eventClue.text).toContain(
      "품질 신호를 통과한 자동 전사",
    );
    expect(explanation.eventClue.text).toContain("“골 넣었어”로 인식됐어요");
    expect(explanation.eventClue.text).toContain("확정하지 않아요");
    expect(explanation.eventClue.basisCodes).toContain(
      "transcript-qualified-cue",
    );
  });

  it("downgrades a malformed transcript status with no displayable cues to no-clear", () => {
    const explanation = buildCandidateEvidenceExplanation(
      input({
        passBEvidence: transcriptEvidence("provisional-transcript", []),
      }),
    );
    const transcript = explanation.observedStatements.find(
      ({ kind }) => kind === "transcript",
    );

    expect(transcript).toMatchObject({
      basisCodes: ["transcript-no-clear", "semantic-event-unknown"],
    });
    expect(transcript?.text).toContain("표시할 수 있는 대사 위치가 없어");
    expect(transcript?.text).not.toContain("에서 로 인식");
  });

  it("collapses whitespace, removes controls, and limits displayed quotes to 80 Unicode code points", () => {
    expect(normalizeCandidateEvidenceQuote("  안녕\n\t  하세요\u200B  ")).toBe(
      "안녕 하세요",
    );
    const normalized = normalizeCandidateEvidenceQuote("가".repeat(100));

    expect(Array.from(normalized)).toHaveLength(
      CANDIDATE_EVIDENCE_MAX_QUOTE_CODE_POINTS,
    );
    expect(normalized).toBe(`${"가".repeat(79)}…`);

    const explanation = buildCandidateEvidenceExplanation(
      input({
        passBEvidence: transcriptEvidence("provisional-transcript", [
          cue("near-peak", 50_000, "😀".repeat(100)),
        ]),
      }),
    );
    expect(explanation.eventClue.text).toContain(`“${"😀".repeat(79)}…”`);
  });

  it("keeps audio-event evidence scoped to mixed broadcast audio with no probability or source attribution", () => {
    const audioEventEvidence = detectedAudioEvent([
      {
        kind: "laughter",
        strength: "possible",
        sourceStartMs: 49_000,
        sourceEndMs: 59_000,
      },
    ]);
    const explanation = buildCandidateEvidenceExplanation(
      input({ audioEventEvidence }),
    );
    const text = allExplanationText(explanation);

    expect(explanation.reactionClue.basisCodes).toEqual([
      "audio-event-possible",
      "mixed-audio-source-unresolved",
    ]);
    expect(text).toContain("혼합 방송 오디오");
    expect(text).toContain("소리의 주체는 확인되지 않았어요");
    expect(text).not.toMatch(
      /스트리머(?:가|의)\s*(?:웃|외쳤|비명)|확률|정확도/u,
    );
  });

  it("does not turn a zero distinct-author-key count into a claim about audience size", () => {
    const zeroAuthorChat = { ...chatEvidence, uniqueAuthorCount: 0 };
    const explanation = buildCandidateEvidenceExplanation(
      input({
        candidate: candidate(
          {
            normalization: "within-signal-rank-and-mad",
            chat: zeroAuthorChat,
          },
          ["chat"],
        ),
      }),
    );
    const text = allExplanationText(explanation);

    expect(text).toContain("고유 작성자 키 0개");
    expect(text).not.toMatch(/0명|사람이 없|시청자가 없/u);
  });

  it("prioritizes strong audio-event evidence over a closer possible cue without mutating input order", () => {
    const possible: CandidateAudioEventDetection = {
      kind: "shout",
      strength: "possible",
      sourceStartMs: 49_000,
      sourceEndMs: 51_000,
    };
    const strong: CandidateAudioEventDetection = {
      kind: "laughter",
      strength: "strong",
      sourceStartMs: 30_000,
      sourceEndMs: 40_000,
    };
    const detections = [possible, strong] as const;
    const explanation = buildCandidateEvidenceExplanation(
      input({ audioEventEvidence: detectedAudioEvent(detections) }),
    );

    expect(explanation.primaryReplayFocus).toMatchObject({
      basis: "strong-audio-event",
      startMs: 30_000,
      endMs: 40_000,
    });
    expect(detections).toEqual([possible, strong]);
  });

  it("uses deterministic audio-event ties independent of detection input order", () => {
    const shout: CandidateAudioEventDetection = {
      kind: "shout",
      strength: "strong",
      sourceStartMs: 45_000,
      sourceEndMs: 55_000,
    };
    const laughter: CandidateAudioEventDetection = {
      kind: "laughter",
      strength: "strong",
      sourceStartMs: 45_000,
      sourceEndMs: 55_000,
    };
    const first = buildCandidateEvidenceExplanation(
      input({ audioEventEvidence: detectedAudioEvent([shout, laughter]) }),
    );
    const second = buildCandidateEvidenceExplanation(
      input({ audioEventEvidence: detectedAudioEvent([laughter, shout]) }),
    );

    expect(first.primaryReplayFocus).toEqual(second.primaryReplayFocus);
    expect(first.primaryReplayFocus.label).toContain("웃음");
  });

  it("uses a possible audio event when no strong event exists", () => {
    const explanation = buildCandidateEvidenceExplanation(
      input({
        audioEventEvidence: detectedAudioEvent([
          {
            kind: "scream",
            strength: "possible",
            sourceStartMs: 51_000,
            sourceEndMs: 61_000,
          },
        ]),
      }),
    );

    expect(explanation.primaryReplayFocus).toMatchObject({
      basis: "possible-audio-event",
      startMs: 51_000,
    });
  });

  it("treats no-clear audio-event evidence as a sentinel, not a negative clip judgment", () => {
    const baseline = buildCandidateEvidenceExplanation(input());
    const explanation = buildCandidateEvidenceExplanation(
      input({ audioEventEvidence: noClearAudioEvent() }),
    );

    expect(explanation.reactionClue.text).toContain("분명한 종류를 나누지 못했어요");
    expect(explanation.reactionClue.text).toContain("후보가 나쁘다는 뜻은 아니에요");
    expect(explanation.reactionClue.basisCodes).toContain("audio-event-no-clear");
    expect(explanation.whyWorthReviewing).toEqual(baseline.whyWorthReviewing);
    expect(explanation.primaryReplayFocus.basis).toBe("reaction-peak");
  });

  it("prioritizes transcript cues near the peak, then before, then after", () => {
    const after = cue("after-peak", 60_000, "뒤 단서");
    const before = cue("before-peak", 40_000, "앞 단서");
    const near = cue("near-peak", 49_500, "가까운 단서");
    const withNear = buildCandidateEvidenceExplanation(
      input({
        passBEvidence: transcriptEvidence("provisional-transcript", [
          after,
          before,
          near,
        ]),
      }),
    );
    const withoutNear = buildCandidateEvidenceExplanation(
      input({
        passBEvidence: transcriptEvidence("provisional-transcript", [
          after,
          before,
        ]),
      }),
    );

    expect(withNear.primaryReplayFocus).toMatchObject({
      basis: "near-peak-transcript",
      startMs: 49_500,
    });
    expect(withoutNear.primaryReplayFocus).toMatchObject({
      basis: "before-peak-transcript",
      startMs: 40_000,
    });
  });

  it("marks a transcript focus outside a user-adjusted range without clamping it", () => {
    const explanation = buildCandidateEvidenceExplanation(
      input({
        effectiveRange: { startMs: 52_000, endMs: 72_500 },
        passBEvidence: transcriptEvidence("provisional-transcript", [
          cue("near-peak", 49_000, "범위 밖 단서"),
        ]),
      }),
    );

    expect(explanation.primaryReplayFocus).toMatchObject({
      basis: "near-peak-transcript",
      startMs: 49_000,
      endMs: 50_500,
      insideEffectiveRange: false,
    });
  });

  it("separates the original outside clue from the safe seek target in the edited range", () => {
    const explanation = buildCandidateEvidenceExplanation(
      input({
        effectiveRange: { startMs: 52_000, endMs: 72_500 },
        passBEvidence: transcriptEvidence("provisional-transcript", [
          cue("near-peak", 49_000, "범위 밖 단서"),
        ]),
      }),
    );

    expect(
      resolveCandidateEvidenceReplayTarget(
        explanation.primaryReplayFocus,
        { startMs: 52_000, endMs: 72_500 },
        60_000,
      ),
    ).toEqual({
      basis: "effective-reaction-peak",
      startMs: 60_000,
      label: "현재 구간의 반응 정점 확인",
    });
    expect(explanation.primaryReplayFocus.startMs).toBe(49_000);
  });

  it("uses the current range start when neither the original clue nor reaction peak is inside", () => {
    expect(
      resolveCandidateEvidenceReplayTarget(
        {
          basis: "near-peak-transcript",
          startMs: 49_000,
          endMs: 50_000,
          insideEffectiveRange: false,
          label: "원래 단서",
        },
        { startMs: 60_000, endMs: 72_500 },
        50_000,
      ),
    ).toEqual({
      basis: "effective-range-start",
      startMs: 60_000,
      label: "현재 구간 처음부터 확인",
    });
  });

  it("does not trust an inside flag when the focus timestamp is outside the current range", () => {
    expect(
      resolveCandidateEvidenceReplayTarget(
        {
          basis: "strong-audio-event",
          startMs: 40_000,
          endMs: 45_000,
          insideEffectiveRange: true,
          label: "잘못 연결된 단서",
        },
        { startMs: 50_000, endMs: 70_000 },
        55_000,
      ),
    ).toMatchObject({
      basis: "effective-reaction-peak",
      startMs: 55_000,
    });
  });

  it.each([
    { startMs: -1, endMs: 10 },
    { startMs: 10, endMs: 10 },
    { startMs: 11, endMs: 10 },
    { startMs: 1.5, endMs: 10 },
    { startMs: 1, endMs: Number.POSITIVE_INFINITY },
  ])("rejects invalid effective range $startMs-$endMs", (effectiveRange) => {
    expect(() =>
      buildCandidateEvidenceExplanation(input({ effectiveRange })),
    ).toThrowError(CandidateEvidenceExplanationError);
    try {
      buildCandidateEvidenceExplanation(input({ effectiveRange }));
    } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_EFFECTIVE_RANGE" });
    }
  });

  it("rejects Pass B evidence for another candidate with a typed identity error", () => {
    expect(() =>
      buildCandidateEvidenceExplanation(
        input({
          passBEvidence: transcriptEvidence(
            "provisional-transcript",
            [cue("near-peak", 50_000, "다른 후보")],
            "other-candidate",
          ),
        }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "PASS_B_CANDIDATE_ID_MISMATCH",
        candidateId: CANDIDATE_ID,
        evidenceCandidateId: "other-candidate",
      }),
    );
  });

  it("rejects audio-event evidence for another candidate with a typed identity error", () => {
    expect(() =>
      buildCandidateEvidenceExplanation(
        input({ audioEventEvidence: noClearAudioEvent("other-candidate") }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "AUDIO_EVENT_CANDIDATE_ID_MISMATCH",
        candidateId: CANDIDATE_ID,
        evidenceCandidateId: "other-candidate",
      }),
    );
  });

  it("rejects audio-event evidence bound to another proposal range or peak", () => {
    const staleEvidence = {
      ...noClearAudioEvent(),
      sourceStartMs: 20_000,
      reactionPeakMs: 45_000,
    };

    expect(() =>
      buildCandidateEvidenceExplanation(
        input({ audioEventEvidence: staleEvidence }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "AUDIO_EVENT_PROPOSAL_BINDING_MISMATCH",
        candidateId: CANDIDATE_ID,
      }),
    );
  });

  it("falls back to frozen fast-pass evidence instead of throwing for a malformed optional overlay", () => {
    const projection = buildCandidateEvidenceExplanationWithFallback(
      input({
        passBEvidence: transcriptEvidence(
          "provisional-transcript",
          [cue("near-peak", 50_000, "다른 후보")],
          "other-candidate",
        ),
        audioEventEvidence: detectedAudioEvent(
          [
            {
              kind: "laughter",
              strength: "strong",
              sourceStartMs: 48_000,
              sourceEndMs: 58_000,
            },
          ],
          CANDIDATE_ID,
        ),
      }),
    );

    expect(projection.fallbackReason).toBe("PASS_B_CANDIDATE_ID_MISMATCH");
    expect(projection.explanation.candidateId).toBe(CANDIDATE_ID);
    expect(projection.explanation.observedStatements.map(({ kind }) => kind)).toEqual([
      "fast-audio",
      "chat",
      "visual",
    ]);
    expect(projection.explanation.primaryReplayFocus.basis).toBe("reaction-peak");
    expect(projection.explanationRange).toEqual({
      startMs: 27_500,
      endMs: 72_500,
    });
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.explanationRange)).toBe(true);
  });

  it("falls back to the original candidate range when the edited range is malformed", () => {
    const projection = buildCandidateEvidenceExplanationWithFallback(
      input({ effectiveRange: { startMs: 60_000, endMs: 60_000 } }),
    );

    expect(projection.fallbackReason).toBe("INVALID_EFFECTIVE_RANGE");
    expect(projection.explanation.primaryReplayFocus).toMatchObject({
      basis: "reaction-peak",
      startMs: 50_000,
      insideEffectiveRange: true,
    });
    expect(projection.explanationRange).toEqual({
      startMs: 27_500,
      endMs: 72_500,
    });
  });

  it.each([
    ["silent", "말소리 단서를 얻지 못했어요"],
    ["empty-transcript", "읽을 수 있는 대사 단서를 얻지 못했어요"],
    ["low-quality-transcript", "자동 전사 품질이 낮아"],
  ] as const)("keeps the %s transcript fallback non-destructive", (reason, text) => {
    const baseline = buildCandidateEvidenceExplanation(input());
    const explanation = buildCandidateEvidenceExplanation(
      input({ passBEvidence: fallbackTranscriptEvidence(reason) }),
    );

    expect(explanation.observedStatements.at(-1)).toMatchObject({
      kind: "transcript",
      basisCodes: ["transcript-no-clear", "semantic-event-unknown"],
    });
    expect(explanation.observedStatements.at(-1)?.text).toContain(text);
    expect(explanation.whyWorthReviewing).toEqual(baseline.whyWorthReviewing);
  });

  it("returns deterministic deeply frozen presentation data without mutating frozen inputs", () => {
    const frozenInput = deepFreeze(
      input({
        passBEvidence: transcriptEvidence("provisional-transcript", [
          cue("after-peak", 60_000, "뒤"),
          cue("near-peak", 50_000, "가까이"),
        ]),
        audioEventEvidence: detectedAudioEvent([
          {
            kind: "shout",
            strength: "possible",
            sourceStartMs: 48_000,
            sourceEndMs: 58_000,
          },
        ]),
      }),
    );

    const first = buildCandidateEvidenceExplanation(frozenInput);
    const second = buildCandidateEvidenceExplanation(frozenInput);

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.eventClue)).toBe(true);
    expect(Object.isFrozen(first.eventClue.basisCodes)).toBe(true);
    expect(Object.isFrozen(first.observedStatements)).toBe(true);
    expect(first.observedStatements.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(first.primaryReplayFocus)).toBe(true);
  });

  it("keeps the full observed-statement order stable when every evidence family exists", () => {
    const explanation = buildCandidateEvidenceExplanation(
      input({
        passBEvidence: transcriptEvidence("provisional-transcript", [
          cue("near-peak", 50_000, "대사"),
        ]),
        audioEventEvidence: detectedAudioEvent([
          {
            kind: "applause-or-cheering",
            strength: "strong",
            sourceStartMs: 48_000,
            sourceEndMs: 58_000,
          },
        ]),
      }),
    );

    expect(explanation.observedStatements.map(({ kind }) => kind)).toEqual([
      "fast-audio",
      "chat",
      "visual",
      "audio-event",
      "transcript",
    ]);
  });
});
