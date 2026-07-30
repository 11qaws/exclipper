import { describe, expect, it } from "vitest";
import {
  candidatePassBContextFingerprint,
  candidatePassBReceiptMatchesContext,
  createCandidatePassBContextPacket,
  createCandidatePassBVerificationReceipt,
  finalizeFullyVerifiedCandidates,
  isCandidatePassBDispatchIntent,
  isCandidatePassBVerificationReceipt,
} from "./candidateFinalVerification";
import {
  currentCandidatePassBContext,
  currentCandidatePassBDispatch,
  currentCandidatePassBInsight,
  currentCandidatePassBReceipt,
  currentCandidatePassBSettlement,
  currentCandidatePassBSourceFence,
} from "../testSupport/candidatePassBCurrentFixture";

const candidate = {
  id: "candidate-1",
  startMs: 60_000,
  endMs: 105_000,
  peakMs: 85_000,
  score: 0.9,
};

function verifyInsight(
  overrides: Partial<ReturnType<typeof currentCandidatePassBInsight>> = {},
) {
  const context = currentCandidatePassBContext();
  return finalizeFullyVerifiedCandidates({
    candidates: [candidate],
    contextByCandidateId: { [candidate.id]: context },
    insightByCandidateId: {
      [candidate.id]: {
        ...currentCandidatePassBInsight(),
        ...overrides,
      },
    },
    receiptByCandidateId: {
      [candidate.id]: currentCandidatePassBReceipt(context),
    },
    completeEvidenceCandidateIds: new Set([candidate.id]),
    refinementEvidenceProjectionFingerprint: null,
    outputLanguage: "ko",
    castRosterId: null,
  });
}

describe("Candidate Pass B current final verification", () => {
  it("canonicalizes and fingerprints the exact bounded broadcast context", () => {
    const context = createCandidatePassBContextPacket({
      transcriptSource: "broadcast-transcript",
      transcriptKo: " 후보 대사 ",
      beforeContextKo: " 직전 흐름 ",
      afterContextKo: " 직후 흐름 ",
      broadcastSummaryKo: " 전체 흐름 ",
      topicContextKo: " 주제 ",
      fastEvidenceKo: " 빠른 근거 ",
      contextDecision: "select",
      contextCategory: "reaction",
      contextVerdictKo: " 선택 근거 ",
      chatReactionKo: null,
    });

    expect(context).not.toBeNull();
    expect(context?.transcriptKo).toBe("후보 대사");
    expect(candidatePassBContextFingerprint(context!)).toMatch(
      /^fnv1a64:[a-f0-9]{16}$/u,
    );
  });

  it("issues a receipt only for the exact dispatch and completed settlement", () => {
    const context = currentCandidatePassBContext();
    const dispatch = currentCandidatePassBDispatch(context);
    const settlement = currentCandidatePassBSettlement(dispatch);
    const sourceFence = currentCandidatePassBSourceFence();
    const receipt = createCandidatePassBVerificationReceipt(
      context,
      25_000,
      sourceFence,
      dispatch,
      settlement,
    );

    expect(receipt).not.toBeNull();
    expect(isCandidatePassBVerificationReceipt(receipt)).toBe(true);
    expect(candidatePassBReceiptMatchesContext(receipt!, context, sourceFence)).toBe(
      true,
    );
    expect(receipt?.dispatchIntent.mediaReceipt.frames).toHaveLength(4);
    expect(receipt?.settlement.operationId).toBe(dispatch.operationId);
  });

  it("accepts verified no-speech media when all four visual frames are present", () => {
    const context = currentCandidatePassBContext();
    const dispatch = currentCandidatePassBDispatch(
      context,
      "candidate-1",
      "verified-no-speech",
    );
    const settlement = currentCandidatePassBSettlement(dispatch);
    const receipt = createCandidatePassBVerificationReceipt(
      context,
      25_000,
      currentCandidatePassBSourceFence(),
      dispatch,
      settlement,
    );

    expect(receipt).not.toBeNull();
    expect(receipt?.dispatchIntent.mediaReceipt.audio.kind).toBe(
      "verified-no-speech",
    );
    expect(receipt?.dispatchIntent.mediaReceipt.frames).toHaveLength(4);
  });

  it("rejects media and settlement identity drift", () => {
    const context = currentCandidatePassBContext();
    const dispatch = currentCandidatePassBDispatch(context);
    const settlement = currentCandidatePassBSettlement(dispatch);

    expect(
      createCandidatePassBVerificationReceipt(
        context,
        25_000,
        currentCandidatePassBSourceFence(),
        dispatch,
        {
          ...settlement,
          providerPayloadDigest: `sha256:${"9".repeat(64)}`,
        },
      ),
    ).toBeNull();
    expect(
      isCandidatePassBDispatchIntent({
        ...dispatch,
        mediaReceipt: {
          ...dispatch.mediaReceipt,
          frames: dispatch.mediaReceipt.frames.slice(0, 3),
        },
      }),
    ).toBe(false);
  });

  it("rejects language and cast-roster drift at every final fence", () => {
    const context = currentCandidatePassBContext();
    const dispatch = currentCandidatePassBDispatch(context);
    const settlement = currentCandidatePassBSettlement(dispatch);
    const sourceFence = currentCandidatePassBSourceFence();

    expect(
      createCandidatePassBVerificationReceipt(
        context,
        25_000,
        { ...sourceFence, outputLanguage: "en" },
        dispatch,
        settlement,
      ),
    ).toBeNull();
    expect(
      createCandidatePassBVerificationReceipt(
        context,
        25_000,
        sourceFence,
        { ...dispatch, castRosterId: "chzzk-video-13996057-v2" },
        settlement,
      ),
    ).toBeNull();
    expect(
      createCandidatePassBVerificationReceipt(
        context,
        25_000,
        sourceFence,
        dispatch,
        { ...settlement, outputLanguage: "en" },
      ),
    ).toBeNull();
  });

  it("rejects old boolean/count receipts instead of treating them as proof", () => {
    const oldReceipt = {
      schemaVersion: "1.3.0",
      contextSchemaVersion: "1.0.0",
      transcriptSource: "broadcast-transcript",
      contextFingerprint: "fnv1a64:0000000000000000",
      audioReviewed: true,
      videoFrameCount: 4,
      thumbnailPrepared: true,
      thumbnailTimestampMs: 25_000,
      referenceTranscriptReviewed: true,
      broadcastContextReviewed: true,
    };

    expect(isCandidatePassBVerificationReceipt(oldReceipt)).toBe(false);
  });

  it("publishes only a fully verified recommended streamer event", () => {
    const result = verifyInsight();

    expect(result.candidates).toEqual([candidate]);
    expect(result.gapByCandidateId).toEqual({});
  });

  it("allows exact multimodal evidence to overturn a text-only context exclusion", () => {
    const context = createCandidatePassBContextPacket({
      transcriptSource: "broadcast-transcript",
      transcriptKo: "확정된 참고 대사가 없어 후보 오디오를 직접 확인한다.",
      beforeContextKo: "방송은 다음 장면을 준비하고 있었다.",
      afterContextKo: "후보 뒤에 스트리머가 방금 사건을 설명했다.",
      broadcastSummaryKo: "방송 전체 주제와 사건 흐름을 정리한 지도다.",
      topicContextKo: "자막만으로 음악 구간일 가능성이 있던 장면",
      fastEvidenceKo: "오디오 반응 신호가 있어 후보로 유지됐다.",
      contextDecision: "reject",
      contextCategory: "music-or-intermission",
      contextVerdictKo:
        "자막만으로는 음악 구간으로 보였으나 대표 화면은 아직 확인하지 않았다.",
      chatReactionKo: null,
    });
    if (context === null) {
      throw new Error("Expected a valid negative-hypothesis context packet.");
    }
    const result = finalizeFullyVerifiedCandidates({
      candidates: [candidate],
      contextExcludedCandidateIds: new Set([candidate.id]),
      contextByCandidateId: { [candidate.id]: context },
      insightByCandidateId: {
        [candidate.id]: currentCandidatePassBInsight(),
      },
      receiptByCandidateId: {
        [candidate.id]: currentCandidatePassBReceipt(context),
      },
      completeEvidenceCandidateIds: new Set([candidate.id]),
      refinementEvidenceProjectionFingerprint: null,
      outputLanguage: "ko",
      castRosterId: null,
    });

    expect(result.candidates).toEqual([candidate]);
    expect(result.gapByCandidateId).toEqual({});
  });

  it.each([
    [
      "insufficient context",
      { contextConsistency: "insufficient" as const },
      "context-insufficient",
    ],
    [
      "uncertain detail verdict",
      { clipDecision: "uncertain" as const },
      "detail-uncertain",
    ],
    [
      "unclear routine material",
      {
        clipDecision: "uncertain" as const,
        programMaterial: "routine-or-unclear" as const,
      },
      "program-material-unclear",
    ],
    [
      "recommended music",
      {
        clipDecision: "recommend" as const,
        programMaterial: "music-or-intermission" as const,
      },
      "detail-verdict-incoherent",
    ],
    [
      "recommendation that conflicts with context",
      {
        clipDecision: "recommend" as const,
        contextConsistency: "conflict" as const,
      },
      "detail-verdict-incoherent",
    ],
  ] as const)(
    "keeps %s as a recoverable verification gap",
    (_label, overrides, expectedGap) => {
      const result = verifyInsight(overrides);

      expect(result.candidates).toEqual([]);
      expect(result.gapByCandidateId[candidate.id]).toBe(expectedGap);
    },
  );

  it.each([
    [
      "explicit clip rejection",
      { clipDecision: "reject" as const },
      "detail-not-recommended",
    ],
    [
      "music or intermission",
      {
        clipDecision: "reject" as const,
        programMaterial: "music-or-intermission" as const,
      },
      "program-material-excluded",
    ],
    [
      "routine material",
      {
        clipDecision: "reject" as const,
        programMaterial: "routine-or-unclear" as const,
      },
      "program-material-excluded",
    ],
    [
      "explicit context conflict",
      {
        clipDecision: "reject" as const,
        contextConsistency: "conflict" as const,
      },
      "context-conflict",
    ],
  ] as const)(
    "keeps %s as a completed negative judgement",
    (_label, overrides, expectedGap) => {
      const result = verifyInsight(overrides);

      expect(result.candidates).toEqual([]);
      expect(result.gapByCandidateId[candidate.id]).toBe(expectedGap);
    },
  );
});
