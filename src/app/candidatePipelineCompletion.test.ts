import { describe, expect, it } from "vitest";

import {
  createCandidatePassBContextPacket,
  createCandidatePassBVerificationReceipt,
  finalizeFullyVerifiedCandidates,
} from "../analysis/candidateFinalVerification";
import type {
  CandidatePassBContextPacket,
  CandidatePassBInsight,
  CandidatePassBVerificationReceipt,
} from "../analysis/candidatePassBWorkerProtocol";
import { CANDIDATE_PASS_B_ROUTING_MODEL_REVISION } from "../analysis/candidatePassBWorkerProtocol";
import { selectBroadcastContextCandidateCohort } from "./broadcastContextCandidateCohort";
import { selectCandidateVerificationCohort } from "./candidateVerificationCohort";

const candidates = Array.from({ length: 17 }, (_, index) => ({
  id: `candidate-${index + 1}`,
  startMs: index * 60_000,
  peakMs: index * 60_000 + 20_000,
  endMs: index * 60_000 + 50_000,
  score: 1 - index / 100,
}));

const insight: CandidatePassBInsight = {
  eventSummaryKo: "앞선 대화의 결론이 드러나는 사건을 화면과 대사로 확인했다.",
  reactionSummaryKo: "스트리머가 결과를 알아차리고 웃으며 반응했다.",
  whyGoodClipKo: "상황의 원인과 반응, 결론이 한 구간 안에서 이어진다.",
  uncertaintiesKo: [],
  participantPresence: "present-unidentified",
  participantSummaryKo: "화면에 주 진행 스트리머가 보이지만 이름은 단정하지 않았다.",
  identifiedParticipants: [],
  clipDecision: "recommend",
  contextConsistency: "consistent",
  programMaterial: "streamer-event",
};

function contextFor(candidateId: string): CandidatePassBContextPacket {
  const context = createCandidatePassBContextPacket({
    transcriptSource: "broadcast-transcript",
    transcriptKo: `${candidateId}에서 실제로 확인한 대사다.`,
    beforeContextKo: "앞 구간에서 사건의 원인이 되는 대화를 시작했다.",
    afterContextKo: "뒤 구간에서 반응을 정리하고 다음 주제로 넘어갔다.",
    broadcastSummaryKo: "방송 전체 흐름과 주제 전환을 끝까지 확인했다.",
    topicContextKo: "현재 주제 안에서 원인과 결과가 연결되는 구간이다.",
    fastEvidenceKo: "빠른 탐색에서 반응과 대사 변화가 함께 포착됐다.",
    contextDecision: "select",
    contextCategory: "reaction",
    contextVerdictKo: "전체 방송 흐름에서 독립적인 클립으로 완결된다.",
    chatReactionKo: null,
  });
  if (context === null) throw new Error("test context must be valid");
  return context;
}

describe("candidate pipeline completion regression", () => {
  it("finishes a 17-candidate broadcast when 12 paid-detail candidates are complete", () => {
    const contextScheduled = selectBroadcastContextCandidateCohort(candidates);
    const contextScheduledIds = new Set(contextScheduled.map(({ id }) => id));
    const detailScheduled = candidates.slice(0, 12);
    const detailScheduledIds = new Set(detailScheduled.map(({ id }) => id));
    const contextByCandidateId = Object.fromEntries(
      contextScheduled.map(({ id }) => [id, contextFor(id)]),
    ) as Record<string, CandidatePassBContextPacket>;
    const insightByCandidateId = Object.fromEntries(
      detailScheduled.map(({ id }) => [id, insight]),
    );
    const receiptByCandidateId = Object.fromEntries(
      detailScheduled.map((candidate) => {
        const { id } = candidate;
        const context = contextByCandidateId[id]!;
        const frames = [1, 2, 3, 4].map((ordinal) => ({
          timestampMs: ordinal * 1_000,
        }));
        return [
          id,
          createCandidatePassBVerificationReceipt(
            context,
            frames,
            frames[0]!.timestampMs,
            {
              candidateId: id,
              sourceStartMs: candidate.startMs,
              sourceEndMs: candidate.endMs,
              routingModelRevision: CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
              refinementEvidenceProjectionFingerprint: null,
              outputLanguage: "ko",
              castRosterId: null,
            },
          )!,
        ];
      }),
    ) as Record<string, CandidatePassBVerificationReceipt>;

    const verificationCohort = selectCandidateVerificationCohort({
      candidates,
      contextScheduledCandidateIds: contextScheduledIds,
      contextExcludedCandidateIds: new Set(),
      detailScheduledCandidateIds: detailScheduledIds,
      contextByCandidateId,
    });
    const verified = finalizeFullyVerifiedCandidates({
      candidates: verificationCohort,
      contextByCandidateId,
      insightByCandidateId,
      receiptByCandidateId,
      completeEvidenceCandidateIds: detailScheduledIds,
      refinementEvidenceProjectionFingerprint: null,
      outputLanguage: "ko",
      castRosterId: null,
    });

    expect(contextScheduled).toHaveLength(17);
    expect(verificationCohort).toHaveLength(12);
    expect(verified.candidates).toHaveLength(12);
    expect(verified.gapByCandidateId).toEqual({});
  });
});
