import { describe, expect, it } from "vitest";

import type {
  CandidatePassBCue,
  CandidatePassBEvidence,
  CandidatePassBQualitySummary,
} from "./candidatePassB";
import {
  buildCandidatePassBPresentation,
  CANDIDATE_PASS_B_CUE_PHASE_LABELS,
  CANDIDATE_PASS_B_PRESENTATION_MAX_CUES,
  CandidatePassBPresentationError,
} from "./candidatePassBPresentation";
import type { HighlightNarrative } from "./highlightNarrative";

const baseNarrative: HighlightNarrative = {
  title: "스트리머 오디오 반응이 두드러진 장면",
  event: "반응 신호는 잡혔지만 화면 사건의 종류는 아직 확인 전이에요.",
  streamerReaction: "평소보다 두드러진 음성형 반응이 잠시 이어졌어요.",
  audienceReaction: "함께 넣은 채팅 근거는 없어요.",
  whyRecommended: "스트리머의 오디오 반응이 두드러져 먼저 확인할 후보예요.",
  basis: "signal-inference",
  basisLabel: "신호 기반 추정",
  reviewHint: "후보를 재생해 실제 사건과 반응을 최종 확인해 주세요.",
};

const quality: CandidatePassBQualitySummary = {
  receivedChunkCount: 3,
  mappedChunkCount: 3,
  usableChunkCount: 3,
  discardedChunkCount: 0,
  meanConfidence: 0.9,
};

function cue(
  phase: CandidatePassBCue["phase"],
  text: string,
  absoluteStartMs: number,
): CandidatePassBCue {
  return {
    phase,
    absoluteStartMs,
    absoluteEndMs: absoluteStartMs + 2_000,
    text,
    confidence: 0.9,
  };
}

function groundedEvidence(
  candidateId = "candidate-1",
  cues: readonly CandidatePassBCue[] = [
    cue("before-peak", "다시 해볼게", 100_000),
    cue("near-peak", "어 뭐야", 110_000),
    cue("after-peak", "진짜였네", 120_000),
  ],
): CandidatePassBEvidence {
  return {
    candidateId,
    status: "grounded-transcript",
    fallbackReason: null,
    cues,
    overlay: {
      event: "반응 전후의 자동 전사 단서가 시간 위치와 함께 잡혔어요.",
      why: "자동 전사 단서로 반응의 맥락을 확인하기 쉬워졌어요.",
      reviewHint: "전사와 실제 장면의 관계를 재생해 확인해 주세요.",
      basisLabel: "자동 전사 단서 · 재생 확인 필요",
    },
    quality,
  };
}

function provisionalEvidence(candidateId = "candidate-1"): CandidatePassBEvidence {
  return {
    candidateId,
    status: "provisional-transcript",
    fallbackReason: "low-quality-transcript",
    cues: [cue("near-peak", "이렇게 들린 것 같아", 110_000)],
    overlay: {
      event: "이 provisional 사건 문구는 화면 설명을 바꾸면 안 돼요.",
      why: "이 provisional 추천도 사용하면 안 돼요.",
      reviewHint: "품질 신호가 없는 자동 전사 추정이므로 재생해 확인해 주세요.",
      basisLabel: "자동 전사 추정 · 빠른 근거 유지",
    },
    quality: {
      ...quality,
      meanConfidence: null,
    },
  };
}

function fallbackEvidence(candidateId = "candidate-1"): CandidatePassBEvidence {
  return {
    candidateId,
    status: "fast-pass-fallback",
    fallbackReason: "silent",
    cues: [],
    overlay: {
      event: "이 fallback 문구는 화면 설명을 바꾸면 안 돼요.",
      why: "이 fallback 추천도 사용하면 안 돼요.",
      reviewHint: "이 fallback 안내도 사용하면 안 돼요.",
      basisLabel: "또렷한 대사 없음 · 빠른 근거 유지",
    },
    quality: {
      ...quality,
      usableChunkCount: 0,
      discardedChunkCount: 3,
    },
  };
}

function narrativeFields(presentation: ReturnType<typeof buildCandidatePassBPresentation>) {
  return {
    title: presentation.title,
    event: presentation.event,
    streamerReaction: presentation.streamerReaction,
    audienceReaction: presentation.audienceReaction,
    whyRecommended: presentation.whyRecommended,
    basis: presentation.basis,
    basisLabel: presentation.basisLabel,
    reviewHint: presentation.reviewHint,
  };
}

const expectedFastNarrativeFields = {
  title: baseNarrative.title,
  event: baseNarrative.event,
  streamerReaction: baseNarrative.streamerReaction,
  audienceReaction: baseNarrative.audienceReaction,
  whyRecommended: baseNarrative.whyRecommended,
  basis: baseNarrative.basis,
  basisLabel: baseNarrative.basisLabel,
  reviewHint: baseNarrative.reviewHint,
};

describe("buildCandidatePassBPresentation", () => {
  it("keeps the exact fast-pass narrative when Pass B has not run", () => {
    const presentation = buildCandidatePassBPresentation(
      "candidate-1",
      baseNarrative,
    );

    expect(narrativeFields(presentation)).toEqual(expectedFastNarrativeFields);
    expect(presentation).toMatchObject({
      candidateId: "candidate-1",
      passBStatusLabel: "빠른 근거만",
      cues: [],
    });
  });

  it("keeps the exact fast-pass narrative for fallback evidence", () => {
    const presentation = buildCandidatePassBPresentation(
      "candidate-1",
      baseNarrative,
      fallbackEvidence(),
    );

    expect(narrativeFields(presentation)).toEqual(expectedFastNarrativeFields);
    expect(presentation.passBStatusLabel).toBe("또렷한 대사 없음");
    expect(presentation.cues).toEqual([]);
    expect(JSON.stringify(presentation)).not.toContain("이 fallback 문구");
  });

  it("uses grounded event, recommendation, review hint, and basis only", () => {
    const evidence = groundedEvidence();

    const presentation = buildCandidatePassBPresentation(
      "candidate-1",
      baseNarrative,
      evidence,
    );

    expect(presentation).toMatchObject({
      candidateId: "candidate-1",
      title: baseNarrative.title,
      streamerReaction: baseNarrative.streamerReaction,
      audienceReaction: baseNarrative.audienceReaction,
      event: evidence.overlay.event,
      whyRecommended: evidence.overlay.why,
      basis: baseNarrative.basis,
      reviewHint: evidence.overlay.reviewHint,
      basisLabel: evidence.overlay.basisLabel,
      passBStatusLabel: "자동 전사 단서 · 재생 확인 필요",
    });
    expect(presentation.event).not.toBe(baseNarrative.event);
    expect(presentation.whyRecommended).not.toBe(baseNarrative.whyRecommended);
  });

  it("keeps provisional cues seekable without replacing the fast event, cause, or recommendation", () => {
    const evidence = provisionalEvidence();
    const presentation = buildCandidatePassBPresentation(
      "candidate-1",
      baseNarrative,
      evidence,
    );

    expect(presentation).toMatchObject({
      candidateId: "candidate-1",
      title: baseNarrative.title,
      event: baseNarrative.event,
      streamerReaction: baseNarrative.streamerReaction,
      audienceReaction: baseNarrative.audienceReaction,
      whyRecommended: baseNarrative.whyRecommended,
      basis: baseNarrative.basis,
      basisLabel: baseNarrative.basisLabel,
      reviewHint: evidence.overlay.reviewHint,
      passBStatusLabel: "자동 전사 추정 · 재생 확인 필요",
    });
    expect(presentation.cues).toEqual([
      {
        phase: "near-peak",
        phaseLabel: "반응 시점 부근",
        absoluteStartMs: 110_000,
        absoluteEndMs: 112_000,
        text: "이렇게 들린 것 같아",
      },
    ]);
    expect(JSON.stringify(presentation)).not.toContain("provisional 사건");
    expect(JSON.stringify(presentation)).not.toContain("provisional 추천");
  });

  it("provides beginner-facing Korean labels for every cue phase", () => {
    const presentation = buildCandidatePassBPresentation(
      "candidate-1",
      baseNarrative,
      groundedEvidence(),
    );

    expect(CANDIDATE_PASS_B_CUE_PHASE_LABELS).toEqual({
      "before-peak": "반응 전",
      "near-peak": "반응 시점 부근",
      "after-peak": "반응 뒤",
    });
    expect(presentation.cues.map(({ phaseLabel }) => phaseLabel)).toEqual([
      "반응 전",
      "반응 시점 부근",
      "반응 뒤",
    ]);
  });

  it("passes at most three short cues and never exposes a full transcript field", () => {
    const sourceCues = [
      cue("before-peak", "첫 번째", 90_000),
      cue("before-peak", "두 번째", 95_000),
      cue("near-peak", "세 번째", 100_000),
      cue("after-peak", "네 번째", 105_000),
      cue("after-peak", "다섯 번째", 110_000),
    ];
    const snapshot = structuredClone(sourceCues);

    const presentation = buildCandidatePassBPresentation(
      "candidate-1",
      baseNarrative,
      groundedEvidence("candidate-1", sourceCues),
    );

    expect(presentation.cues).toHaveLength(CANDIDATE_PASS_B_PRESENTATION_MAX_CUES);
    expect(presentation.cues.map(({ text }) => text)).toEqual([
      "첫 번째",
      "두 번째",
      "세 번째",
    ]);
    expect(sourceCues).toEqual(snapshot);
    expect(Object.keys(presentation)).not.toContain("transcript");
  });

  it("rejects evidence from a different candidate with a typed error", () => {
    try {
      buildCandidatePassBPresentation(
        "candidate-expected",
        baseNarrative,
        groundedEvidence("candidate-actual"),
      );
      throw new Error("expected candidate mismatch to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(CandidatePassBPresentationError);
      expect(error).toMatchObject({
        code: "CANDIDATE_ID_MISMATCH",
        expectedCandidateId: "candidate-expected",
        actualCandidateId: "candidate-actual",
      });
    }
  });

  it("contains no candidate order, range, score, or review mutation fields", () => {
    const presentation = buildCandidatePassBPresentation(
      "candidate-1",
      baseNarrative,
      groundedEvidence(),
    );
    const forbiddenKeys = new Set([
      "index",
      "ordinal",
      "order",
      "rank",
      "score",
      "startMs",
      "endMs",
      "peakMs",
      "proposal",
      "proposalRange",
      "effectiveRange",
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
        expect(forbiddenKeys.has(key), `forbidden presentation key: ${key}`).toBe(false);
        visit(child);
      }
    };

    visit(presentation);
  });
});
