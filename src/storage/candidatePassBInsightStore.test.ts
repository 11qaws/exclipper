import { describe, expect, it } from "vitest";

import type { CandidatePassBEvidence } from "../analysis/candidatePassB";
import {
  CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION,
  assertCandidatePassBInsightsRecord,
  cloneCandidatePassBInsightsRecord,
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
    basisLabel: "Gemini 대사 추정 · 빠른 근거 유지",
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
});
