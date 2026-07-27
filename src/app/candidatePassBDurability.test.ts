import { describe, expect, it } from "vitest";
import {
  createCandidatePassBContextPacket,
  createCandidatePassBVerificationReceipt,
} from "../analysis/candidateFinalVerification";
import {
  CANDIDATE_PASS_B_QWEN_MODEL_ID,
  CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
  type CandidatePassBVideoFrame,
} from "../analysis/candidatePassBWorkerProtocol";
import {
  CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION,
  type CandidatePassBInsightsRecord,
  type StoredCandidatePassBInsight,
} from "../storage/candidatePassBInsightStore";
import {
  candidatePassBArtifactIsDurable,
  candidatePassBInsightIsComplete,
  selectCandidatePassBAnalysisOutstandingIds,
  selectCandidatePassBDurabilityOutstandingIds,
} from "./candidatePassBDurability";

const context = createCandidatePassBContextPacket({
  transcriptSource: "broadcast-transcript",
  transcriptKo: "후보 구간에서 스트리머가 실수를 알아차리고 사과했다.",
  beforeContextKo: "앞서 설정을 확인하던 중이었다.",
  afterContextKo: "사과 뒤 설정을 바로 수정했다.",
  broadcastSummaryKo: "방송에서 설정 실수와 수습 과정이 이어졌다.",
  topicContextKo: "설정 실수와 사과",
  fastEvidenceKo: "목소리가 커지고 즉시 사과했다.",
  contextDecision: "select",
  contextCategory: "apology-accountability",
  contextVerdictKo: "실수를 인정하고 바로 수습한 핵심 장면이다.",
  chatReactionKo: "채팅 반응이 순간적으로 증가했다.",
})!;

const frames: readonly CandidatePassBVideoFrame[] = [0, 1, 2, 3].map(
  (index) => ({
    timestampMs: index * 1_000,
    mimeType: "image/jpeg" as const,
    dataBase64: "AQID",
  }),
);
const receipt = createCandidatePassBVerificationReceipt(context, frames, 1_000)!;

function insight(
  overrides: Partial<StoredCandidatePassBInsight> = {},
): StoredCandidatePassBInsight {
  return {
    eventSummaryKo: "설정 실수를 알아차렸다.",
    reactionSummaryKo: "당황한 뒤 사과했다.",
    whyGoodClipKo: "사건과 수습이 완결된다.",
    uncertaintiesKo: [],
    participantPresence: "present-unidentified",
    participantSummaryKo: "진행자는 보이지만 이름 근거는 확인되지 않았다.",
    identifiedParticipants: [],
    clipDecision: "recommend",
    contextConsistency: "consistent",
    programMaterial: "streamer-event",
    ...overrides,
  };
}

function record(
  overrides: Partial<CandidatePassBInsightsRecord> = {},
): CandidatePassBInsightsRecord {
  return {
    kind: "candidatePassBInsights",
    runId: "run-durable",
    schemaVersion: CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION,
    inputSignature: "input-durable",
    modelManifestHash: "model-durable",
    evidenceById: {
      candidate: {
        candidateId: "candidate",
        cues: [],
        overlay: {
          event: "사과",
          why: "맥락과 반응이 이어짐",
          reviewHint: "직접 확인",
          basisLabel: "AI 대사 단서 · 재생 확인 필요",
        },
        quality: {
          receivedChunkCount: 1,
          mappedChunkCount: 1,
          usableChunkCount: 1,
          discardedChunkCount: 0,
          meanConfidence: 0.9,
        },
        status: "grounded-transcript",
        fallbackReason: null,
      },
    },
    insightById: {
      candidate: insight(),
    },
    modelByCandidateId: {
      candidate: {
        id: CANDIDATE_PASS_B_QWEN_MODEL_ID,
        revision: CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
      },
    },
    thumbnailById: { candidate: frames[1]! },
    verificationReceiptById: { candidate: receipt },
    recordedAt: "2026-07-27T00:00:00.000Z",
    ...overrides,
  };
}

describe("candidate Pass B durable artifacts", () => {
  it("accepts only a complete read-back artifact set bound to current context", () => {
    expect(candidatePassBArtifactIsDurable(record(), "candidate", context)).toBe(true);
    expect(
      selectCandidatePassBDurabilityOutstandingIds({
        candidateIds: ["candidate"],
        record: record(),
        contextByCandidateId: { candidate: context },
      }),
    ).toEqual([]);
  });

  it.each([
    ["evidence", { evidenceById: {} }],
    ["insight", { insightById: {} }],
    ["model", { modelByCandidateId: {} }],
    ["thumbnail", { thumbnailById: {} }],
    ["receipt", { verificationReceiptById: {} }],
  ] as const)("keeps the candidate outstanding when %s is absent", (_label, overrides) => {
    expect(
      selectCandidatePassBDurabilityOutstandingIds({
        candidateIds: ["candidate"],
        record: record(overrides),
        contextByCandidateId: { candidate: context },
      }),
    ).toEqual(["candidate"]);
  });

  it("rejects a receipt whose thumbnail is no longer the stored thumbnail", () => {
    expect(
      candidatePassBArtifactIsDurable(
        record({
          thumbnailById: {
            candidate: { ...frames[1]!, timestampMs: 2_000 },
          },
        }),
        "candidate",
        context,
      ),
    ).toBe(false);
  });

  it.each([
    ["event summary", { eventSummaryKo: " " }],
    ["reaction summary", { reactionSummaryKo: "" }],
    ["clip explanation", { whyGoodClipKo: "\n" }],
  ] as const)("rejects an insight without complete %s", (_label, overrides) => {
    const incomplete = insight(overrides);
    expect(candidatePassBInsightIsComplete(incomplete)).toBe(false);
    expect(
      candidatePassBArtifactIsDurable(
        record({ insightById: { candidate: incomplete } }),
        "candidate",
        context,
      ),
    ).toBe(false);
  });

  it.each([
    "participantPresence",
    "participantSummaryKo",
    "identifiedParticipants",
    "clipDecision",
    "contextConsistency",
    "programMaterial",
  ] as const)("rejects a backward-compatible insight missing %s", (field) => {
    const incomplete = Object.fromEntries(
      Object.entries(insight()).filter(([key]) => key !== field),
    ) as unknown as StoredCandidatePassBInsight;
    expect(candidatePassBInsightIsComplete(incomplete)).toBe(false);
    expect(
      candidatePassBArtifactIsDurable(
        record({ insightById: { candidate: incomplete } }),
        "candidate",
        context,
      ),
    ).toBe(false);
  });

  it("requires an identified participant and rejects people when none are present", () => {
    expect(
      candidatePassBInsightIsComplete(
        insight({
          participantPresence: "identified",
          identifiedParticipants: [],
        }),
      ),
    ).toBe(false);
    expect(
      candidatePassBInsightIsComplete(
        insight({
          participantPresence: "none-present",
          identifiedParticipants: [
            {
              displayName: "진행자",
              role: "streamer",
              evidenceBasis: "on-screen-name",
              evidenceKo: "화면과 대사에서 확인했다.",
              confidence: 0.95,
              relativeTimestampMs: 1_000,
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("reruns a legacy decision-less insight even after its run envelope completed", () => {
    const legacyInsight = Object.fromEntries(
      Object.entries(insight()).filter(
        ([key]) =>
          !["clipDecision", "contextConsistency", "programMaterial"].includes(
            key,
          ),
      ),
    ) as unknown as StoredCandidatePassBInsight;
    const outstandingIds = selectCandidatePassBAnalysisOutstandingIds({
      candidateIds: ["candidate"],
      insightByCandidateId: { candidate: legacyInsight },
      receiptByCandidateId: { candidate: receipt },
      contextByCandidateId: { candidate: context },
    });

    expect(outstandingIds).toEqual(["candidate"]);
  });
});
