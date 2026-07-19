import { describe, expect, it } from "vitest";

import type { CandidateAudioEventEvidenceById } from "./candidateAudioEventEvidenceState";
import type { CandidateAudioEventDetectedResult } from "./candidateAudioEventWorkerProtocol";
import type { CandidatePassBEvidenceById } from "./candidatePassBEvidenceState";
import {
  buildCandidateRankingProposal,
  CandidateRankingInputError,
  createCandidateRankingFingerprints,
} from "./candidateRanking";
import type {
  HighlightSignalKind,
  UnifiedHighlightCandidate,
} from "./highlightFusion";

function candidate(
  id: string,
  peakMs: number,
  scores: { readonly audio?: number; readonly chat?: number; readonly visual?: number },
): UnifiedHighlightCandidate {
  const signalKinds: HighlightSignalKind[] = [];
  if (scores.audio !== undefined) signalKinds.push("audio");
  if (scores.chat !== undefined) signalKinds.push("chat");
  if (scores.visual !== undefined) signalKinds.push("visual");
  return {
    id,
    peakMs,
    startMs: Math.max(0, peakMs - 27_000),
    endMs: peakMs + 18_000,
    score: Math.max(...Object.values(scores)),
    reason: "test candidate",
    signalKinds,
    evidence: {
      normalization: "within-signal-rank-and-mad",
      ...(scores.audio === undefined
        ? {}
        : {
            audio: {
              rankPercentile: scores.audio,
              robustPercentile: scores.audio,
              normalizedScore: scores.audio,
            },
          }),
      ...(scores.chat === undefined
        ? {}
        : {
            chat: {
              rankPercentile: scores.chat,
              robustPercentile: scores.chat,
              normalizedScore: scores.chat,
              bucketStartMs: peakMs - 1_000,
              bucketEndMs: peakMs + 1_000,
              messageCount: 10,
              uniqueAuthorCount: 5,
              reactionMessageCount: 7,
              baselineMessageCount: 2,
              baselineUniqueAuthorCount: 2,
              burstRatio: 5,
              robustBurstScore: 4,
              repetitionRatio: 0.2,
              singleAuthorRatio: 0.2,
              spamPenalty: 0,
            },
          }),
      ...(scores.visual === undefined
        ? {}
        : {
            visual: {
              rankPercentile: scores.visual,
              robustPercentile: scores.visual,
              normalizedScore: scores.visual,
            },
          }),
    },
  };
}

function detectedAudioEvent(
  candidateId: string,
  strength: "strong" | "possible",
): CandidateAudioEventDetectedResult {
  return {
    mode: "candidate-audio-event",
    candidateId,
    sourceStartMs: 10_000,
    sourceEndMs: 55_000,
    reactionPeakMs: 37_000,
    analyzedWindowCount: 3,
    quality: "provisional-audio-event",
    model: {
      id: "Xenova/ast-finetuned-audioset-10-10-0.4593",
      revision: "249a1fbf0286b40e7f1ed687a8ae396997bf7dc6",
      dtype: "q8",
      device: "wasm",
    },
    sampleRateHz: 16_000,
    status: "detected",
    detections: [
      {
        kind: "laughter",
        strength,
        sourceStartMs: 32_000,
        sourceEndMs: 42_000,
      },
    ],
  };
}

function provisionalTranscript(
  candidateId: string,
  text: string,
): CandidatePassBEvidenceById[string] {
  return {
    candidateId,
    status: "provisional-transcript",
    fallbackReason: "low-quality-transcript",
    cues: [
      {
        phase: "near-peak",
        absoluteStartMs: 35_000,
        absoluteEndMs: 37_000,
        text,
        confidence: null,
      },
    ],
    overlay: {
      event: "자동 전사 추정",
      why: "재생 확인 필요",
      reviewHint: "직접 확인",
      basisLabel: "자동 전사 추정 · 빠른 근거 유지",
    },
    quality: {
      receivedChunkCount: 1,
      mappedChunkCount: 1,
      usableChunkCount: 1,
      discardedChunkCount: 0,
      meanConfidence: null,
    },
  };
}

function proposal(
  candidates: readonly UnifiedHighlightCandidate[],
  passBEvidenceById: CandidatePassBEvidenceById = {},
  audioEventEvidenceById: CandidateAudioEventEvidenceById = {},
  audioEventCoverage: "complete" | "incomplete" = "complete",
) {
  return buildCandidateRankingProposal({
    proposalId: "ranking-proposal-1",
    rankingSessionId: "ranking-session-1",
    rankingRevision: 1,
    analysisRunId: "analysis-run-1",
    expectedViewOrderRevision: 0,
    candidates,
    passBEvidenceById,
    audioEventEvidenceById,
    audioEventCoverage,
  });
}

describe("candidate ranking proposal", () => {
  it("returns an exact deterministic candidate permutation", () => {
    const candidates = [
      candidate("a", 10_000, { audio: 0.5 }),
      candidate("b", 20_000, { audio: 0.9, chat: 0.8 }),
      candidate("c", 30_000, { chat: 0.7, visual: 1 }),
    ];

    const first = proposal(candidates);
    const second = proposal(candidates);

    expect(first).toEqual(second);
    expect(first.orderedCandidateIds).toEqual(["b", "a", "c"]);
    expect(new Set(first.orderedCandidateIds)).toEqual(new Set(["a", "b", "c"]));
    expect(first.entries).toHaveLength(3);
  });

  it("uses integer basis-point components whose sum exactly equals the total", () => {
    const result = proposal([
      candidate("reaction", 37_000, { audio: 0.8, chat: 0.7, visual: 0.4 }),
    ]);
    const entry = result.entries[0];

    expect(entry?.breakdown).toEqual({
      audioBasePoints: 4_800,
      audioSemanticPoints: 0,
      chatPoints: 2_100,
      visualContextPoints: 200,
      audioChatAgreementPoints: 500,
      totalPoints: 7_600,
    });
    expect(entry?.relativeSupportPoints).toBe(7_600);
    expect(Number.isInteger(entry?.relativeSupportPoints)).toBe(true);
  });

  it("treats a fully covered qualitative AST result as bounded audio-family support", () => {
    const candidates = [
      candidate("base", 10_000, { audio: 0.8 }),
      candidate("semantic", 20_000, { audio: 0.78 }),
    ];
    const result = proposal(candidates, {}, {
      semantic: detectedAudioEvent("semantic", "strong"),
    });
    const semantic = result.entries.find(({ candidateId }) => candidateId === "semantic");

    expect(result.orderedCandidateIds[0]).toBe("semantic");
    expect(semantic?.breakdown.audioBasePoints).toBe(4_680);
    expect(semantic?.breakdown.audioSemanticPoints).toBe(132);
    expect(semantic?.reasonCodes).toContain("strong-audio-event");
  });

  it("does not use partial AST evidence for any candidate", () => {
    const candidates = [
      candidate("base", 10_000, { audio: 0.8 }),
      candidate("partial", 20_000, { audio: 0.78 }),
    ];
    const result = proposal(
      candidates,
      {},
      { partial: detectedAudioEvent("partial", "strong") },
      "incomplete",
    );
    const partial = result.entries.find(({ candidateId }) => candidateId === "partial");

    expect(result.orderedCandidateIds).toEqual(["base", "partial"]);
    expect(partial?.breakdown.audioSemanticPoints).toBe(0);
    expect(partial?.reasonCodes).not.toContain("strong-audio-event");
  });

  it("does not give different reaction kinds different value", () => {
    const laughter = detectedAudioEvent("a", "strong");
    const cheering = {
      ...detectedAudioEvent("b", "strong"),
      candidateId: "b",
      detections: [
        {
          kind: "applause-or-cheering" as const,
          strength: "strong" as const,
          sourceStartMs: 32_000,
          sourceEndMs: 42_000,
        },
      ] as const,
    };
    const result = proposal(
      [candidate("a", 10_000, { audio: 0.6 }), candidate("b", 20_000, { audio: 0.6 })],
      {},
      { a: laughter, b: cheering },
    );

    expect(result.entries[0]?.relativeSupportPoints).toBe(
      result.entries[1]?.relativeSupportPoints,
    );
    expect(result.orderedCandidateIds).toEqual(["a", "b"]);
  });

  it("keeps transcript text and confidence out of ranking and fingerprints", () => {
    const candidates = [
      candidate("a", 10_000, { audio: 0.7 }),
      candidate("b", 20_000, { audio: 0.7 }),
    ];
    const firstEvidence = { a: provisionalTranscript("a", "비밀 문장 하나") };
    const secondEvidence = { a: provisionalTranscript("a", "완전히 다른 문장") };

    const first = proposal(candidates, firstEvidence);
    const second = proposal(candidates, secondEvidence);
    const firstFingerprints = createCandidateRankingFingerprints(
      candidates,
      firstEvidence,
      {},
      "incomplete",
    );
    const secondFingerprints = createCandidateRankingFingerprints(
      candidates,
      secondEvidence,
      {},
      "incomplete",
    );

    expect(first.orderedCandidateIds).toEqual(second.orderedCandidateIds);
    expect(first.entries.map(({ relativeSupportPoints }) => relativeSupportPoints)).toEqual(
      second.entries.map(({ relativeSupportPoints }) => relativeSupportPoints),
    );
    expect(firstFingerprints).toEqual(secondFingerprints);
    expect(JSON.stringify(first)).not.toContain("비밀 문장 하나");
  });

  it("uses previous ordinal before peak and ID to break equal support", () => {
    const result = proposal([
      candidate("later-peak", 30_000, { audio: 0.5 }),
      candidate("earlier-peak", 10_000, { audio: 0.5 }),
    ]);

    expect(result.orderedCandidateIds).toEqual(["later-peak", "earlier-peak"]);
  });

  it("does not reread raw chat aggregates once normalized support is fixed", () => {
    const first = candidate("chat", 10_000, { chat: 0.8 });
    const changedRawChat = {
      ...first,
      evidence: {
        ...first.evidence,
        chat: {
          ...first.evidence.chat!,
          messageCount: 999,
          uniqueAuthorCount: 1,
          spamPenalty: 1,
        },
      },
    };

    expect(proposal([first]).entries[0]?.relativeSupportPoints).toBe(
      proposal([changedRawChat]).entries[0]?.relativeSupportPoints,
    );
  });

  it("rejects duplicate candidates and evidence bound to another candidate", () => {
    const duplicate = candidate("same", 10_000, { audio: 0.5 });
    expect(() => proposal([duplicate, duplicate])).toThrowError(CandidateRankingInputError);

    expect(() =>
      proposal([candidate("a", 10_000, { audio: 0.5 })], {}, {
        a: detectedAudioEvent("b", "strong"),
      }),
    ).toThrowError(CandidateRankingInputError);
  });
});
