import { describe, expect, it } from "vitest";

import {
  createCandidatePassBContextPacket,
  finalizeFullyVerifiedCandidates,
} from "../analysis/candidateFinalVerification";
import {
  isPipelineGap,
  summarizeFinalVerificationGaps,
} from "./finalVerificationGapSummary";

describe("summarizeFinalVerificationGaps", () => {
  it("counts each gap and keeps pipeline order", () => {
    const summary = summarizeFinalVerificationGaps({
      a: "detail-not-recommended",
      b: "context-missing",
      c: "detail-not-recommended",
      d: "evidence-incomplete",
    });
    expect(summary.map(({ gap, count }) => [gap, count])).toEqual([
      ["context-missing", 1],
      ["evidence-incomplete", 1],
      ["detail-not-recommended", 2],
    ]);
  });

  it("omits gaps that did not occur", () => {
    const summary = summarizeFinalVerificationGaps({ a: "context-conflict" });
    expect(summary).toHaveLength(1);
    expect(summary[0]?.gap).toBe("context-conflict");
  });

  it("returns nothing when every candidate passed", () => {
    expect(summarizeFinalVerificationGaps({})).toEqual([]);
  });

  it("gives every gap a Korean label and detail", () => {
    const summary = summarizeFinalVerificationGaps({
      a: "context-missing",
      b: "detail-result-missing",
      c: "verification-receipt-missing",
      d: "evidence-incomplete",
      e: "context-insufficient",
      f: "detail-uncertain",
      g: "program-material-unclear",
      h: "detail-verdict-incoherent",
      i: "context-excluded",
      j: "program-material-excluded",
      k: "context-conflict",
      l: "detail-not-recommended",
    });
    expect(summary).toHaveLength(12);
    for (const entry of summary) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.detail.length).toBeGreaterThan(0);
    }
  });

  it("requires detail for context-negative hypotheses instead of treating them as completed judgements", () => {
    const context = createCandidatePassBContextPacket({
      transcriptSource: "broadcast-transcript",
      transcriptKo: "후보 구간에서 스트리머가 음식 이름을 말하며 반응합니다.",
      beforeContextKo: "앞 구간에서는 음식 이름을 맞히는 문제를 풀고 있었습니다.",
      afterContextKo: "뒤 구간에서는 정답을 확인하고 다음 문제로 넘어갑니다.",
      broadcastSummaryKo: "방송 전체에서 여러 음식의 이름과 취향을 이야기했습니다.",
      topicContextKo: "음식 이름을 맞히는 퀴즈를 진행하는 주제 구간입니다.",
      fastEvidenceKo: "대사의 내용이 바뀌고 스트리머의 반응이 나타난 구간입니다.",
      contextDecision: "review",
      contextCategory: "reaction",
      contextVerdictKo: "전체 흐름 안에서 추가 화면 검토가 필요한 반응 후보입니다.",
      chatReactionKo: null,
    });
    expect(context).not.toBeNull();

    const candidates = Array.from({ length: 13 }, (_, index) => ({
      id: `candidate-${index + 1}`,
      startMs: index * 60_000,
      peakMs: index * 60_000 + 20_000,
      endMs: index * 60_000 + 50_000,
      score: 0.8,
    }));
    const contextExcludedCandidateIds = new Set(
      candidates.slice(0, 5).map(({ id }) => id),
    );
    const contextByCandidateId = Object.fromEntries(
      candidates.map(({ id }) => [id, context!]),
    );

    const verification = finalizeFullyVerifiedCandidates({
      candidates,
      contextExcludedCandidateIds,
      contextByCandidateId,
      insightByCandidateId: {},
      receiptByCandidateId: {},
      completeEvidenceCandidateIds: new Set(),
      refinementEvidenceProjectionFingerprint: null,
      outputLanguage: "ko",
      castRosterId: null,
    });
    const summary = summarizeFinalVerificationGaps(
      verification.gapByCandidateId,
    );

    expect(summary.map(({ gap, count }) => [gap, count])).toEqual([
      ["detail-result-missing", 13],
    ]);
    expect(
      summary
        .filter(({ gap }) => isPipelineGap(gap))
        .reduce((total, { count }) => total + count, 0),
    ).toBe(13);
    expect(verification.gapByCandidateId["candidate-1"]).toBe(
      "detail-result-missing",
    );
  });
});

describe("isPipelineGap", () => {
  it("treats missing evidence as a pipeline problem", () => {
    expect(isPipelineGap("context-missing")).toBe(true);
    expect(isPipelineGap("detail-result-missing")).toBe(true);
    expect(isPipelineGap("verification-receipt-missing")).toBe(true);
    expect(isPipelineGap("evidence-incomplete")).toBe(true);
    expect(isPipelineGap("context-insufficient")).toBe(true);
    expect(isPipelineGap("detail-uncertain")).toBe(true);
    expect(isPipelineGap("program-material-unclear")).toBe(true);
    expect(isPipelineGap("detail-verdict-incoherent")).toBe(true);
  });

  it("treats a completed judgement as not a pipeline problem", () => {
    expect(isPipelineGap("context-excluded")).toBe(false);
    expect(isPipelineGap("program-material-excluded")).toBe(false);
    expect(isPipelineGap("context-conflict")).toBe(false);
    expect(isPipelineGap("detail-not-recommended")).toBe(false);
  });
});
