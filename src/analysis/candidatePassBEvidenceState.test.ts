import { describe, expect, it } from "vitest";

import type { CandidatePassBEvidence } from "./candidatePassB";
import { mergeCandidatePassBEvidence } from "./candidatePassBEvidenceState";

const provisional: CandidatePassBEvidence = {
  candidateId: "candidate-1",
  status: "provisional-transcript",
  fallbackReason: "low-quality-transcript",
  cues: [
    {
      phase: "near-peak",
      absoluteStartMs: 10_000,
      absoluteEndMs: 12_000,
      text: "자동 전사 추정",
      confidence: null,
    },
  ],
  overlay: {
    event: "추정",
    why: "확인 필요",
    reviewHint: "재생 확인",
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

const fallback: CandidatePassBEvidence = {
  candidateId: "candidate-1",
  status: "fast-pass-fallback",
  fallbackReason: "silent",
  cues: [],
  overlay: {
    event: "없음",
    why: "빠른 근거 유지",
    reviewHint: "재생 확인",
    basisLabel: "또렷한 대사 없음 · 빠른 근거 유지",
  },
  quality: {
    receivedChunkCount: 1,
    mappedChunkCount: 1,
    usableChunkCount: 0,
    discardedChunkCount: 1,
    meanConfidence: null,
  },
};

describe("mergeCandidatePassBEvidence", () => {
  it("preserves an existing clue when a retry returns only fallback", () => {
    const current = { "candidate-1": provisional };

    expect(mergeCandidatePassBEvidence(current, fallback)).toBe(current);
  });

  it("stores fallback for a candidate that has no previous evidence", () => {
    expect(mergeCandidatePassBEvidence({}, fallback)).toEqual({
      "candidate-1": fallback,
    });
  });

  it("replaces previous evidence when a retry produced a new transcript clue", () => {
    const replacement = {
      ...provisional,
      cues: [{ ...provisional.cues[0]!, text: "새 추정" }],
    } satisfies CandidatePassBEvidence;

    expect(
      mergeCandidatePassBEvidence({ "candidate-1": provisional }, replacement),
    ).toEqual({ "candidate-1": replacement });
  });

  it("does not downgrade verified evidence to a later provisional estimate", () => {
    const grounded = {
      ...provisional,
      status: "grounded-transcript",
      fallbackReason: null,
      overlay: {
        ...provisional.overlay,
        basisLabel: "자동 전사 단서 · 재생 확인 필요",
      },
    } satisfies CandidatePassBEvidence;
    const current = { "candidate-1": grounded };

    expect(mergeCandidatePassBEvidence(current, provisional)).toBe(current);
  });
});
