import { describe, expect, it } from "vitest";
import {
  createCandidatePassBContextPacket,
  createCandidatePassBVerificationReceipt,
  candidatePassBReceiptMatchesContext,
  finalizeFullyVerifiedCandidates,
} from "./candidateFinalVerification";
import type { CandidatePassBInsight } from "./candidatePassBWorkerProtocol";

const candidate = {
  id: "candidate-1",
  startMs: 10_000,
  peakMs: 25_000,
  endMs: 50_000,
  score: 0.9,
};

const context = createCandidatePassBContextPacket({
  transcriptSource: "youtube-caption",
  transcriptKo: "실제로 확인한 후보 대사",
  beforeContextKo: "앞에서 음식 이름을 맞히는 퀴즈를 시작했다.",
  afterContextKo: "정답을 확인하고 자신의 실수를 인정했다.",
  broadcastSummaryKo: "방송 전체에서 음식 이름 맞히기와 잡담을 진행했다.",
  topicContextKo: "음식 이름 맞히기 퀴즈 구간",
  fastEvidenceKo: "말의 높낮이와 화면 변화가 함께 나타난 잠재 구간",
  contextDecision: "select",
  contextCategory: "reaction",
  contextVerdictKo: "오답을 알아차린 반응이 앞뒤 흐름과 연결된다.",
  chatReactionKo: null,
});

const insight: CandidatePassBInsight = {
  eventSummaryKo: "화면과 대사에서 오답을 확인하고 반응하는 과정이 확인됐다.",
  reactionSummaryKo: "스트리머가 잠시 멈춘 뒤 웃으며 자신의 실수를 인정했다.",
  whyGoodClipKo: "앞선 추측과 정답 확인이 한 구간 안에서 완결된다.",
  uncertaintiesKo: [],
  participantPresence: "present-unidentified",
  participantSummaryKo: "화면 오른쪽에 이름을 확인하지 못한 아바타가 있다.",
  identifiedParticipants: [],
  clipDecision: "recommend",
  contextConsistency: "consistent",
  programMaterial: "streamer-event",
};

describe("candidate final verification", () => {
  it("publishes only candidates with context, audio, four frames and a consistent recommendation", () => {
    expect(context).not.toBeNull();
    const frames = [1_000, 2_000, 3_000, 4_000].map((timestampMs) => ({
      timestampMs,
    }));
    const receipt = createCandidatePassBVerificationReceipt(context!, frames, 1_000);
    const result = finalizeFullyVerifiedCandidates({
      candidates: [candidate],
      contextByCandidateId: { [candidate.id]: context! },
      insightByCandidateId: { [candidate.id]: insight },
      receiptByCandidateId: { [candidate.id]: receipt! },
    });

    expect(result.candidates.map(({ id }) => id)).toEqual([candidate.id]);
    expect(result.gapByCandidateId).toEqual({});
  });

  it("does not publish fast discoveries when any required evidence is missing", () => {
    const result = finalizeFullyVerifiedCandidates({
      candidates: [candidate],
      contextByCandidateId: { [candidate.id]: context! },
      insightByCandidateId: { [candidate.id]: insight },
      receiptByCandidateId: {},
    });

    expect(result.candidates).toEqual([]);
    expect(result.gapByCandidateId[candidate.id]).toBe(
      "verification-receipt-missing",
    );
  });

  it("invalidates a paid detail receipt when the whole-broadcast context changes", () => {
    const frames = [1_000, 2_000, 3_000, 4_000].map((timestampMs) => ({
      timestampMs,
    }));
    const receipt = createCandidatePassBVerificationReceipt(
      context!,
      frames,
      1_000,
    )!;
    const changedContext = {
      ...context!,
      broadcastSummaryKo:
        "복구된 누락 대사를 포함해 음식 퀴즈의 앞뒤 사건 순서가 달라졌다.",
    };

    expect(candidatePassBReceiptMatchesContext(receipt, changedContext)).toBe(
      false,
    );
    const result = finalizeFullyVerifiedCandidates({
      candidates: [candidate],
      contextByCandidateId: { [candidate.id]: changedContext },
      insightByCandidateId: { [candidate.id]: insight },
      receiptByCandidateId: { [candidate.id]: receipt },
    });
    expect(result.candidates).toEqual([]);
    expect(result.gapByCandidateId[candidate.id]).toBe("evidence-incomplete");
  });

  it("excludes music and context conflicts even with complete local evidence", () => {
    const frames = [1_000, 2_000, 3_000, 4_000].map((timestampMs) => ({
      timestampMs,
    }));
    const receipt = createCandidatePassBVerificationReceipt(
      context!,
      frames,
      1_000,
    )!;
    const result = finalizeFullyVerifiedCandidates({
      candidates: [candidate],
      contextByCandidateId: { [candidate.id]: context! },
      insightByCandidateId: {
        [candidate.id]: {
          ...insight,
          programMaterial: "music-or-intermission",
          contextConsistency: "conflict",
        },
      },
      receiptByCandidateId: { [candidate.id]: receipt },
    });

    expect(result.candidates).toEqual([]);
    expect(result.gapByCandidateId[candidate.id]).toBe(
      "program-material-excluded",
    );
  });
});
