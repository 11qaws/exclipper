import { describe, expect, it } from "vitest";

import type { CandidatePassBEvidence } from "../analysis/candidatePassB";
import {
  CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
  CANDIDATE_PASS_B_VERIFICATION_RECEIPT_SCHEMA_VERSION,
  isCompatibleCandidatePassBRoutingModelRevision,
} from "../analysis/candidatePassBWorkerProtocol";
import {
  CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION,
  assertCandidatePassBInsightsRecord,
  candidatePassBInsightSnapshotsExactlyMatch,
  cloneCandidatePassBInsightsRecord,
  persistCandidatePassBInsightsWithReadback,
  type CandidatePassBInsightStorePort,
  type CandidatePassBInsightsRecord,
} from "./candidatePassBInsightStore";
import { InMemoryAnalysisResultStore } from "./analysisResultStore";

const evidence: CandidatePassBEvidence = {
  candidateId: "candidate-a",
  cues: [],
  overlay: {
    event: "스트리머가 갑자기 웃음을 터뜨렸어요.",
    why: "반응과 대사 단서가 같은 구간에 있어요.",
    reviewHint: "앞뒤 5초를 함께 확인하세요.",
    basisLabel: "AI 대사 추정 · 빠른 근거 유지",
  },
  quality: {
    receivedChunkCount: 1,
    mappedChunkCount: 1,
    usableChunkCount: 1,
    discardedChunkCount: 0,
    meanConfidence: null,
  },
  status: "fast-pass-fallback",
  fallbackReason: "silent",
};

const record: CandidatePassBInsightsRecord = {
  kind: "candidatePassBInsights",
  runId: "run-candidate-a",
  schemaVersion: CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION,
  inputSignature: "sha256:" + "a".repeat(64),
  modelManifestHash: "gemini-3.1-pro-preview",
  evidenceById: { "candidate-a": evidence },
  insightById: {
    "candidate-a": {
      eventSummaryKo: "게임에서 예상 밖의 장면이 나왔어요.",
      reactionSummaryKo: "스트리머가 웃으며 즉시 반응했어요.",
      whyGoodClipKo: "사건과 반응이 짧은 구간 안에서 완결돼요.",
      uncertaintiesKo: [],
      participantPresence: "identified",
      participantSummaryKo: "화면 이름표로 유레카가 진행 중임을 확인했어요.",
      identifiedParticipants: [
        {
          displayName: "유레카",
          role: "streamer",
          evidenceBasis: "on-screen-name",
          evidenceKo: "화면 소개 자막에 이름이 표시돼요.",
          confidence: 0.96,
          relativeTimestampMs: 1_500,
          observedFrameIndices: [0],
        },
      ],
    },
  },
  modelByCandidateId: {
    "candidate-a": {
      id: "gemini-3.6-flash",
      revision: "gemini-3.6-flash-grounded-frames-v3-2026-07-22",
    },
  },
  thumbnailById: {
    "candidate-a": {
      timestampMs: 1_500,
      mimeType: "image/jpeg",
      dataBase64: "aGVsbG8=",
    },
  },
  verificationReceiptById: {
    "candidate-a": {
      schemaVersion: "1.1.0",
      contextSchemaVersion: "1.0.0",
      transcriptSource: "broadcast-transcript",
      contextFingerprint: "fnv1a64:0123456789abcdef",
      audioReviewed: true,
      videoFrameCount: 4,
      thumbnailPrepared: true,
      thumbnailTimestampMs: 1_500,
      referenceTranscriptReviewed: true,
      broadcastContextReviewed: true,
    },
  },
  recordedAt: "2026-07-21T00:00:00.000Z",
};

describe("Candidate Pass B insight persistence", () => {
  it("stores and restores the latest per-run snapshot", async () => {
    const store = new InMemoryAnalysisResultStore();
    await store.putCandidatePassBInsights(record);

    const restored = await store.getCandidatePassBInsights(record.runId);
    expect(restored).toEqual(record);
    expect(restored).not.toBe(record);
  });

  it("clones only validated JSON-safe records", () => {
    assertCandidatePassBInsightsRecord(record);
    const cloned = cloneCandidatePassBInsightsRecord(record);
    expect(cloned).toEqual(record);
    expect(cloned).not.toBe(record);
    expect(() => assertCandidatePassBInsightsRecord({ ...record, runId: "" })).toThrow(
      TypeError,
    );
  });

  it("keeps the previous insight schema readable during the session-material migration", () => {
    expect(() =>
      assertCandidatePassBInsightsRecord({
        ...record,
        schemaVersion: "1.0.0",
        thumbnailById: undefined,
      }),
    ).not.toThrow();
  });

  it("accepts a current exact-range receipt only under its matching candidate map key", () => {
    const currentReceipt = {
      schemaVersion: CANDIDATE_PASS_B_VERIFICATION_RECEIPT_SCHEMA_VERSION,
      contextSchemaVersion: "1.0.0" as const,
      transcriptSource: "broadcast-transcript" as const,
      contextFingerprint: "fnv1a64:0123456789abcdef",
      candidateId: "candidate-a",
      sourceStartMs: 10_000,
      sourceEndMs: 50_000,
      routingModelRevision: CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
      refinementEvidenceProjectionFingerprint: null,
      outputLanguage: "ko" as const,
      castRosterId: null,
      audioReviewed: true as const,
      videoFrameCount: 4 as const,
      thumbnailPrepared: true as const,
      thumbnailTimestampMs: 1_500,
      referenceTranscriptReviewed: true as const,
      broadcastContextReviewed: true as const,
    };
    expect(() =>
      assertCandidatePassBInsightsRecord({
        ...record,
        verificationReceiptById: { "candidate-a": currentReceipt },
      }),
    ).not.toThrow();
    expect(() =>
      assertCandidatePassBInsightsRecord({
        ...record,
        verificationReceiptById: {
          "candidate-a": {
            ...currentReceipt,
            candidateId: "candidate-b",
          },
        },
      }),
    ).toThrow(/verification receipt/u);
  });

  it("keeps already-paid Gemini 3.5 candidate results readable after the 3.6 upgrade", () => {
    expect(() =>
      assertCandidatePassBInsightsRecord({
        ...record,
        modelManifestHash:
          "qwen3.5-omni-flash_then_gemini-3.5-flash_bounded-v2",
        modelByCandidateId: {
          "candidate-a": {
            id: "gemini-3.5-flash",
            revision: "gemini-3.5-flash-grounded-frames-v2-2026-07-22",
          },
        },
      }),
    ).not.toThrow();
    expect(
      isCompatibleCandidatePassBRoutingModelRevision(
        "qwen3.5-omni-flash_then_gemini-3.5-flash_bounded-v2",
      ),
    ).toBe(true);
    expect(
      isCompatibleCandidatePassBRoutingModelRevision(
        "qwen3.5-omni-flash_then_gemini-3.6-flash_bounded-v3",
      ),
    ).toBe(true);
  });

  it("rejects a provider model paired with another provider revision", () => {
    expect(() =>
      assertCandidatePassBInsightsRecord({
        ...record,
        modelByCandidateId: {
          "candidate-a": {
            id: "gemini-3.6-flash",
            revision: "qwen3.5-omni-flash-grounded-frames-v2-2026-07-22",
          },
        },
      }),
    ).toThrow(TypeError);
  });
});

describe("persistCandidatePassBInsightsWithReadback", () => {
  it("returns a detached snapshot only after an exact durable readback", async () => {
    let stored: CandidatePassBInsightsRecord | null = null;
    const store: CandidatePassBInsightStorePort = {
      replaceCandidatePassBInsightsIfUnchanged(expected, replacement) {
        if (
          !candidatePassBInsightSnapshotsExactlyMatch(expected, stored)
        ) {
          return Promise.resolve(false);
        }
        stored = cloneCandidatePassBInsightsRecord(replacement);
        return Promise.resolve(true);
      },
      getCandidatePassBInsights(runId) {
        expect(runId).toBe(record.runId);
        return Promise.resolve(
          stored === null ? null : cloneCandidatePassBInsightsRecord(stored),
        );
      },
    };

    const restored = await persistCandidatePassBInsightsWithReadback(
      store,
      null,
      record,
    );

    expect(restored).toEqual(record);
    expect(restored).not.toBe(record);
    expect(restored.evidenceById).not.toBe(record.evidenceById);
    expect(restored.insightById).not.toBe(record.insightById);
    expect(restored.modelByCandidateId).not.toBe(record.modelByCandidateId);
    expect(restored.thumbnailById).not.toBe(record.thumbnailById);
    expect(restored.verificationReceiptById).not.toBe(
      record.verificationReceiptById,
    );
  });

  it("propagates a rejected compare-and-swap and does not attempt readback", async () => {
    const writeFailure = new Error("indexeddb transaction aborted");
    let readCount = 0;
    const store: CandidatePassBInsightStorePort = {
      replaceCandidatePassBInsightsIfUnchanged() {
        return Promise.reject(writeFailure);
      },
      getCandidatePassBInsights() {
        readCount += 1;
        return Promise.resolve(record);
      },
    };

    await expect(
      persistCandidatePassBInsightsWithReadback(store, null, record),
    ).rejects.toBe(writeFailure);
    expect(readCount).toBe(0);
  });

  it("rejects a stale writer before readback and preserves the newer full snapshot", async () => {
    const store = new InMemoryAnalysisResultStore();
    const original = await persistCandidatePassBInsightsWithReadback(
      store,
      null,
      record,
    );
    const newer = {
      ...record,
      insightById: {
        "candidate-a": {
          ...record.insightById["candidate-a"]!,
          reactionSummaryKo: "최신 반응 설명",
        },
      },
      recordedAt: "2026-07-21T00:00:01.000Z",
    };
    const stale = {
      ...record,
      thumbnailById: {
        "candidate-a": {
          ...record.thumbnailById!["candidate-a"]!,
          dataBase64: "c3RhbGU=",
        },
      },
      recordedAt: "2026-07-21T00:00:02.000Z",
    };

    await expect(
      persistCandidatePassBInsightsWithReadback(store, original, newer),
    ).resolves.toEqual(newer);
    await expect(
      persistCandidatePassBInsightsWithReadback(store, original, stale),
    ).rejects.toThrow(/durable snapshot changed/u);
    await expect(
      store.getCandidatePassBInsights(record.runId),
    ).resolves.toEqual(newer);
  });

  it("rejects a committed write whose immediate readback is missing", async () => {
    const store: CandidatePassBInsightStorePort = {
      replaceCandidatePassBInsightsIfUnchanged() {
        return Promise.resolve(true);
      },
      getCandidatePassBInsights() {
        return Promise.resolve(null);
      },
    };

    await expect(
      persistCandidatePassBInsightsWithReadback(store, null, record),
    ).rejects.toThrow(/readback is missing/u);
  });

  it.each([
    [
      "metadata",
      {
        ...record,
        inputSignature: "sha256:" + "b".repeat(64),
      },
    ],
    [
      "evidence map",
      {
        ...record,
        evidenceById: {
          "candidate-a": {
            ...evidence,
            overlay: {
              ...evidence.overlay,
              event: "다른 사건이 저장됐어요.",
            },
          },
        },
      },
    ],
    [
      "insight map",
      {
        ...record,
        insightById: {
          ...record.insightById,
          "candidate-a": {
            ...record.insightById["candidate-a"]!,
            reactionSummaryKo: "다른 반응이 저장됐어요.",
          },
        },
      },
    ],
    [
      "model map",
      {
        ...record,
        modelByCandidateId: {},
      },
    ],
    [
      "thumbnail map",
      {
        ...record,
        thumbnailById: {
          "candidate-a": {
            ...record.thumbnailById!["candidate-a"]!,
            timestampMs: 2_000,
          },
        },
      },
    ],
    [
      "verification receipt map",
      {
        ...record,
        verificationReceiptById: {
          "candidate-a": {
            ...record.verificationReceiptById!["candidate-a"]!,
            thumbnailTimestampMs: 2_000,
          },
        },
      },
    ],
  ] satisfies readonly (readonly [string, CandidatePassBInsightsRecord])[])(
    "rejects a stale or mismatched %s readback",
    async (_label, staleRecord) => {
      const store: CandidatePassBInsightStorePort = {
        replaceCandidatePassBInsightsIfUnchanged() {
          return Promise.resolve(true);
        },
        getCandidatePassBInsights() {
          return Promise.resolve(staleRecord);
        },
      };

      await expect(
        persistCandidatePassBInsightsWithReadback(store, null, record),
      ).rejects.toThrow(/does not exactly match/u);
    },
  );
});
