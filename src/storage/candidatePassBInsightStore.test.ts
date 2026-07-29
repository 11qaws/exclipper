import { describe, expect, it } from "vitest";
import {
  CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION,
} from "../analysis/candidatePassBWorkerProtocol";
import {
  createCandidatePassBInitialAttemptLedger,
} from "../analysis/candidatePassBAttemptLedger";
import {
  currentCandidatePassBContext,
  currentCandidatePassBDispatch,
  currentCandidatePassBRecord,
} from "../testSupport/candidatePassBCurrentFixture";
import { InMemoryAnalysisResultStore } from "./analysisResultStore";
import {
  assertCandidatePassBInsightsRecord,
  candidatePassBInsightSnapshotsExactlyMatch,
  cloneCandidatePassBInsightsRecord,
  createCandidatePassBPlanReceipt,
  persistCandidatePassBInsightsWithReadback,
  recoverCandidatePassBArmedDispatchesAsOutcomeUnknown,
  type CandidatePassBInsightStorePort,
  type CandidatePassBInsightsRecord,
} from "./candidatePassBInsightStore";

describe("Candidate Pass B 4.0 insight persistence", () => {
  it("stores and restores a current exact artifact snapshot", async () => {
    const record = currentCandidatePassBRecord();
    const store = new InMemoryAnalysisResultStore();

    await store.putCandidatePassBInsights(record);
    const restored = await store.getCandidatePassBInsights(record.runId);

    expect(restored).toEqual(record);
    expect(restored).not.toBe(record);
    expect(restored?.dispatchIntentByCandidateId).toEqual(
      record.dispatchIntentByCandidateId,
    );
    expect(restored?.settlementByCandidateId).toEqual(
      record.settlementByCandidateId,
    );
  });

  it("rejects legacy schemas and boolean-only verification receipts", () => {
    const record = currentCandidatePassBRecord();

    expect(() =>
      assertCandidatePassBInsightsRecord({
        ...record,
        schemaVersion: "1.5.0",
      }),
    ).toThrow(TypeError);
    expect(() =>
      assertCandidatePassBInsightsRecord({
        ...record,
        verificationReceiptById: {
          "candidate-1": {
            schemaVersion: "1.3.0",
            audioReviewed: true,
            videoFrameCount: 4,
          },
        },
      }),
    ).toThrow(TypeError);
  });

  it("creates a deterministic plan proof that changes with cohort or context", async () => {
    const context = currentCandidatePassBContext();
    const base = {
      runId: "analysis-run-1",
      inputSignature: "input-signature-1",
      contextInputSignature: "context-input-signature-1",
      refinementEvidenceProjectionFingerprint: null,
      plannedCandidateIds: ["candidate-1"],
      contextByCandidateId: { "candidate-1": context },
    } as const;

    const first = await createCandidatePassBPlanReceipt(base);
    const repeated = await createCandidatePassBPlanReceipt(base);
    const empty = await createCandidatePassBPlanReceipt({
      ...base,
      plannedCandidateIds: [],
      contextByCandidateId: {},
    });
    const otherContext = await createCandidatePassBPlanReceipt({
      ...base,
      contextInputSignature: "context-input-signature-2",
    });
    const changedPacket = await createCandidatePassBPlanReceipt({
      ...base,
      contextByCandidateId: {
        "candidate-1": {
          ...context,
          transcriptKo: `${context.transcriptKo} 정확한 다른 대사`,
        },
      },
    });

    expect(repeated).toEqual(first);
    expect(empty.planFingerprint).not.toBe(first.planFingerprint);
    expect(otherContext.planFingerprint).not.toBe(first.planFingerprint);
    expect(changedPacket.planFingerprint).not.toBe(first.planFingerprint);
  });

  it("rejects artifacts outside the exact durable planned cohort", () => {
    const record = currentCandidatePassBRecord();

    expect(() =>
      assertCandidatePassBInsightsRecord({
        ...record,
        planReceipt: {
          ...record.planReceipt,
          plannedCandidateIds: [],
          plannedContextFingerprints: [],
        },
      }),
    ).toThrow(/durable cohort/u);
  });

  it("rejects a context packet that no longer matches the planned fingerprint", () => {
    const record = currentCandidatePassBRecord();
    const context = record.contextByCandidateId["candidate-1"]!;

    expect(() =>
      assertCandidatePassBInsightsRecord({
        ...record,
        contextByCandidateId: {
          "candidate-1": {
            ...context,
            transcriptKo: `${context.transcriptKo} 변조`,
          },
        },
      }),
    ).toThrow(/durable cohort/u);
  });

  it.each([
    "identifiedParticipants",
    "clipDecision",
    "contextConsistency",
    "programMaterial",
  ] as const)("rejects a stored insight missing current field %s", (field) => {
    const record = currentCandidatePassBRecord();
    const malformedInsight: Record<string, unknown> = {
      ...record.insightById["candidate-1"],
    };
    delete malformedInsight[field];
    expect(() =>
      assertCandidatePassBInsightsRecord({
        ...record,
        insightById: {
          "candidate-1": malformedInsight,
        },
      }),
    ).toThrow(/insight/u);
  });

  it("rejects settlement identity drift and text-roster appearance evidence", () => {
    const record = currentCandidatePassBRecord();
    expect(() =>
      assertCandidatePassBInsightsRecord({
        ...record,
        settlementByCandidateId: {
          "candidate-1": {
            ...record.settlementByCandidateId["candidate-1"]!,
            providerPayloadDigest: `sha256:${"9".repeat(64)}`,
          },
        },
      }),
    ).toThrow(/attempt projection|settlement/u);
    expect(() =>
      assertCandidatePassBInsightsRecord({
        ...record,
        insightById: {
          "candidate-1": {
            ...record.insightById["candidate-1"]!,
            participantPresence: "identified",
            identifiedParticipants: [
              {
                displayName: "가상 인물",
                role: "streamer",
                evidenceBasis: "provided-cast-reference",
                evidenceKo: "텍스트 명단",
                confidence: 0.99,
                relativeTimestampMs: 1_000,
                observedFrameIndices: [0],
              },
            ],
          },
        },
      }),
    ).toThrow(/insight/u);
  });

  it("materializes a recovered armed request as outcome-unknown once", () => {
    const completed = currentCandidatePassBRecord();
    const dispatch = currentCandidatePassBDispatch();
    const armed: CandidatePassBInsightsRecord = {
      ...completed,
      insightById: {},
      evidenceById: {},
      modelByCandidateId: {},
      thumbnailById: {},
      verificationReceiptById: {},
      attemptLedgerByCandidateId: {
        "candidate-1": createCandidatePassBInitialAttemptLedger(dispatch),
      },
      dispatchIntentByCandidateId: { "candidate-1": dispatch },
      settlementByCandidateId: {},
    };

    const recovered =
      recoverCandidatePassBArmedDispatchesAsOutcomeUnknown(armed);

    expect(recovered.settlementByCandidateId["candidate-1"]).toEqual({
      schemaVersion: CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION,
      status: "outcome-unknown",
      operationId: dispatch.operationId,
      providerPayloadDigest: dispatch.mediaReceipt.providerPayloadDigest,
      outputLanguage: dispatch.outputLanguage,
      castRosterId: dispatch.castRosterId,
      reason: "armed-dispatch-recovered",
    });
    expect(
      recoverCandidatePassBArmedDispatchesAsOutcomeUnknown(recovered),
    ).toBe(recovered);
  });
});

describe("persistCandidatePassBInsightsWithReadback", () => {
  it("returns only after an exact durable readback", async () => {
    const record = currentCandidatePassBRecord();
    let stored: CandidatePassBInsightsRecord | null = null;
    const store: CandidatePassBInsightStorePort = {
      replaceCandidatePassBInsightsIfUnchanged(expected, replacement) {
        if (!candidatePassBInsightSnapshotsExactlyMatch(expected, stored)) {
          return Promise.resolve(false);
        }
        stored = cloneCandidatePassBInsightsRecord(replacement);
        return Promise.resolve(true);
      },
      getCandidatePassBInsights() {
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
  });

  it("does not repeat a committed mutation while readback is unavailable", async () => {
    const record = currentCandidatePassBRecord();
    let writeCount = 0;
    const store: CandidatePassBInsightStorePort = {
      replaceCandidatePassBInsightsIfUnchanged() {
        writeCount += 1;
        return Promise.resolve(true);
      },
      getCandidatePassBInsights() {
        return Promise.resolve(null);
      },
    };

    await expect(
      persistCandidatePassBInsightsWithReadback(store, null, record, {
        maximumAttempts: 3,
        initialBackoffMs: 0,
        maximumBackoffMs: 0,
      }),
    ).rejects.toThrow(/could not be verified/u);
    expect(writeCount).toBe(1);
  });

  it("rejects a mismatched readback instead of accepting partial proof", async () => {
    const record = currentCandidatePassBRecord();
    const mismatched = {
      ...record,
      recordedAt: "2026-07-29T00:00:01.000Z",
    };
    const store: CandidatePassBInsightStorePort = {
      replaceCandidatePassBInsightsIfUnchanged() {
        return Promise.resolve(true);
      },
      getCandidatePassBInsights() {
        return Promise.resolve(mismatched);
      },
    };

    await expect(
      persistCandidatePassBInsightsWithReadback(store, null, record, {
        maximumAttempts: 1,
      }),
    ).rejects.toThrow(/does not exactly match/u);
  });

  it("replaces a late old-plan commit with the exact new plan-only checkpoint", async () => {
    const oldRecord = currentCandidatePassBRecord();
    const newPlanReceipt = await createCandidatePassBPlanReceipt({
      runId: oldRecord.runId,
      inputSignature: oldRecord.inputSignature,
      contextInputSignature: "context-input-signature-2",
      refinementEvidenceProjectionFingerprint: null,
      plannedCandidateIds: [],
      contextByCandidateId: {},
    });
    const planOnlyRecord: CandidatePassBInsightsRecord = {
      ...oldRecord,
      planReceipt: newPlanReceipt,
      contextByCandidateId: {},
      evidenceById: {},
      insightById: {},
      modelByCandidateId: {},
      thumbnailById: {},
      attemptLedgerByCandidateId: {},
      dispatchIntentByCandidateId: {},
      settlementByCandidateId: {},
      verificationReceiptById: {},
      recordedAt: "2026-07-29T00:00:02.000Z",
    };
    let stored: CandidatePassBInsightsRecord = oldRecord;
    let injectLateCommit = true;
    const store: CandidatePassBInsightStorePort = {
      replaceCandidatePassBInsightsIfUnchanged(expected, replacement) {
        if (injectLateCommit) {
          injectLateCommit = false;
          stored = {
            ...oldRecord,
            recordedAt: "2026-07-29T00:00:01.000Z",
          };
        }
        if (!candidatePassBInsightSnapshotsExactlyMatch(expected, stored)) {
          return Promise.resolve(false);
        }
        stored = cloneCandidatePassBInsightsRecord(replacement);
        return Promise.resolve(true);
      },
      getCandidatePassBInsights() {
        return Promise.resolve(cloneCandidatePassBInsightsRecord(stored));
      },
    };

    const restored = await persistCandidatePassBInsightsWithReadback(
      store,
      oldRecord,
      planOnlyRecord,
      {
        maximumAttempts: 3,
        initialBackoffMs: 0,
        maximumBackoffMs: 0,
      },
      (current, pending) =>
        current.runId === pending.runId &&
        current.inputSignature === pending.inputSignature
          ? pending
          : null,
    );

    expect(restored).toEqual(planOnlyRecord);
    expect(stored).toEqual(planOnlyRecord);
  });
});
