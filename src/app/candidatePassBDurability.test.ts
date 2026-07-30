import { describe, expect, it, vi } from "vitest";
import {
  candidatePassBPlanContextCohortMatches,
  candidatePassBArtifactIsDurable,
  candidatePassBInsightIsComplete,
  scheduleCandidatePassBAutomaticTargetReadback,
  selectEffectiveCandidatePassBContextById,
  selectCandidatePassBAnalysisOutstandingIds,
  selectCandidatePassBAutomaticTargets,
  selectCandidatePassBDurableIds,
  selectCandidatePassBDurableThumbnailById,
  selectCandidatePassBOutcomeUnknownIds,
  type CandidatePassBAutomaticTargetInput,
} from "./candidatePassBDurability";
import {
  CANDIDATE_PASS_B_MAX_CANDIDATES,
} from "../analysis/candidatePassB";
import {
  CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION,
  type CandidatePassBOutcomeUnknownSettlement,
} from "../analysis/candidatePassBWorkerProtocol";
import {
  currentCandidatePassBContext,
  currentCandidatePassBDispatch,
  currentCandidatePassBFrames,
  currentCandidatePassBInsight,
  currentCandidatePassBRecord,
  currentCandidatePassBSettlement,
  currentCandidatePassBSourceFence,
} from "../testSupport/candidatePassBCurrentFixture";
import {
  appendCandidatePassBArmedAttempt,
  CANDIDATE_PASS_B_RETRY_GRANT_SCHEMA_VERSION,
  createCandidatePassBInitialAttemptLedger,
  issueCandidatePassBRetryGrant,
} from "../analysis/candidatePassBAttemptLedger";

describe("Candidate Pass B current durability", () => {
  it("restores the exact caption-backed context bound to the durable plan", () => {
    const computedFallback = currentCandidatePassBContext();
    const durableCaptionContext = {
      ...computedFallback,
      transcriptSource: "youtube-caption" as const,
      transcriptKo: "유튜브 자막에서 보존한 정확한 후보 대사",
    };
    const record = currentCandidatePassBRecord({
      context: durableCaptionContext,
    });

    const selected = selectEffectiveCandidatePassBContextById({
      computedContextByCandidateId: {
        "candidate-1": computedFallback,
      },
      durableRecord: record,
      runId: record.runId,
      inputSignature: record.inputSignature,
      refinementEvidenceProjectionFingerprint:
        record.planReceipt.refinementEvidenceProjectionFingerprint,
    });

    expect(selected["candidate-1"]).toEqual(durableCaptionContext);
    expect(selected["candidate-1"]?.transcriptSource).toBe("youtube-caption");
  });

  it("never restores durable context across a different source identity", () => {
    const computed = currentCandidatePassBContext();
    const durableCaptionContext = {
      ...computed,
      transcriptSource: "youtube-caption" as const,
    };
    const record = currentCandidatePassBRecord({
      context: durableCaptionContext,
    });

    expect(
      selectEffectiveCandidatePassBContextById({
        computedContextByCandidateId: { "candidate-1": computed },
        durableRecord: record,
        runId: record.runId,
        inputSignature: "different-input",
        refinementEvidenceProjectionFingerprint:
          record.planReceipt.refinementEvidenceProjectionFingerprint,
      }),
    ).toEqual({ "candidate-1": computed });
  });

  it("requires the restored context map to match the newly planned cohort", () => {
    const record = currentCandidatePassBRecord();

    expect(
      candidatePassBPlanContextCohortMatches(record, ["candidate-1"]),
    ).toBe(true);
    expect(candidatePassBPlanContextCohortMatches(record, [])).toBe(false);
    expect(
      candidatePassBPlanContextCohortMatches(record, ["candidate-2"]),
    ).toBe(false);
  });

  it("requires the exact media dispatch, settlement, context, model and receipt", () => {
    const context = currentCandidatePassBContext();
    const record = currentCandidatePassBRecord({ context });

    expect(
      candidatePassBArtifactIsDurable(
        record,
        currentCandidatePassBSourceFence(),
        context,
      ),
    ).toBe(true);
    expect(
      selectCandidatePassBDurableIds({
        candidateIds: ["candidate-1"],
        record,
        contextByCandidateId: { "candidate-1": context },
        sourceFenceByCandidateId: {
          "candidate-1": currentCandidatePassBSourceFence(),
        },
      }),
    ).toEqual(new Set(["candidate-1"]));
  });

  it("does not persist a staged UI thumbnail in an arm-only checkpoint", () => {
    const context = currentCandidatePassBContext();
    const dispatch = currentCandidatePassBDispatch(context);

    expect(
      selectCandidatePassBDurableThumbnailById({
        thumbnailById: {
          "candidate-1": currentCandidatePassBFrames()[2],
        },
        evidenceById: {},
        insightById: {},
        modelByCandidateId: {},
        verificationReceiptById: {},
        dispatchIntentByCandidateId: {
          "candidate-1": dispatch,
        },
        settlementByCandidateId: {},
        attemptLedgerByCandidateId: {
          "candidate-1": createCandidatePassBInitialAttemptLedger(dispatch),
        },
      }),
    ).toEqual({});
  });

  it("keeps the completed candidate and drops a staged sibling thumbnail", () => {
    const completed = currentCandidatePassBRecord();
    const stagedFrame = {
      ...currentCandidatePassBFrames()[0],
      timestampMs: 45_000,
    };

    expect(
      selectCandidatePassBDurableThumbnailById({
        thumbnailById: {
          ...completed.thumbnailById,
          "candidate-2": stagedFrame,
        },
        evidenceById: completed.evidenceById,
        insightById: completed.insightById,
        modelByCandidateId: completed.modelByCandidateId,
        verificationReceiptById: completed.verificationReceiptById,
        dispatchIntentByCandidateId:
          completed.dispatchIntentByCandidateId,
        settlementByCandidateId: completed.settlementByCandidateId,
        attemptLedgerByCandidateId:
          completed.attemptLedgerByCandidateId,
      }),
    ).toEqual(completed.thumbnailById);
  });

  it("retains the current candidate thumbnail once its verified tuple is complete", () => {
    const completed = currentCandidatePassBRecord();

    expect(
      selectCandidatePassBDurableThumbnailById({
        thumbnailById: completed.thumbnailById,
        evidenceById: completed.evidenceById,
        insightById: completed.insightById,
        modelByCandidateId: completed.modelByCandidateId,
        verificationReceiptById: completed.verificationReceiptById,
        dispatchIntentByCandidateId:
          completed.dispatchIntentByCandidateId,
        settlementByCandidateId: completed.settlementByCandidateId,
        attemptLedgerByCandidateId:
          completed.attemptLedgerByCandidateId,
      }),
    ).toEqual(completed.thumbnailById);
  });

  it("fails durability when a completed settlement no longer matches the dispatch", () => {
    const context = currentCandidatePassBContext();
    const record = currentCandidatePassBRecord({ context });
    const drifted = {
      ...record,
      settlementByCandidateId: {
        "candidate-1": {
          ...record.settlementByCandidateId["candidate-1"]!,
          providerPayloadDigest: `sha256:${"9".repeat(64)}` as const,
        },
      },
    };

    expect(
      candidatePassBArtifactIsDurable(
        drifted,
        currentCandidatePassBSourceFence(),
        context,
      ),
    ).toBe(false);
  });

  it("rejects text-roster appearance claims from a final insight", () => {
    expect(
      candidatePassBInsightIsComplete({
        ...currentCandidatePassBInsight(),
        participantPresence: "identified",
        identifiedParticipants: [
          {
            displayName: "가상 인물",
            role: "streamer",
            evidenceBasis: "provided-cast-reference",
            evidenceKo: "텍스트 명단에 이름이 있었다.",
            confidence: 0.99,
            relativeTimestampMs: 10_000,
            observedFrameIndices: [0, 1],
          },
        ],
      }),
    ).toBe(false);
  });

  it("never automatically retries a durably armed paid operation", () => {
    const context = currentCandidatePassBContext();
    const dispatch = currentCandidatePassBDispatch(context);
    const common = {
      candidateIds: ["candidate-1"],
      attemptLedgerByCandidateId: {
        "candidate-1": createCandidatePassBInitialAttemptLedger(dispatch),
      },
      dispatchIntentByCandidateId: { "candidate-1": dispatch },
      settlementByCandidateId: {},
    };

    expect(selectCandidatePassBAnalysisOutstandingIds(common)).toEqual([]);
    expect(
      selectCandidatePassBAnalysisOutstandingIds({
        ...common,
        attemptLedgerByCandidateId: {},
        dispatchIntentByCandidateId: {},
      }),
    ).toEqual(["candidate-1"]);
  });

  it("continues a 17-candidate plan as a bounded 12 then 5 execution sequence", () => {
    const context = currentCandidatePassBContext();
    const candidateIds = Array.from(
      { length: 17 },
      (_, index) => `candidate-${index + 1}`,
    );
    const initialTargets = selectCandidatePassBAutomaticTargets({
      candidateIds,
      attemptLedgerByCandidateId: {},
      dispatchIntentByCandidateId: {},
      settlementByCandidateId: {},
    });
    const firstBatch = initialTargets.slice(
      0,
      CANDIDATE_PASS_B_MAX_CANDIDATES,
    );
    const completed = firstBatch.map(({ candidateId }) => {
      const dispatch = currentCandidatePassBDispatch(context, candidateId);
      const settlement = currentCandidatePassBSettlement(dispatch);
      return {
        candidateId,
        dispatch,
        settlement,
        ledger: createCandidatePassBInitialAttemptLedger(
          dispatch,
          settlement,
        ),
      };
    });
    const remainingTargets = selectCandidatePassBAutomaticTargets({
      candidateIds,
      attemptLedgerByCandidateId: Object.fromEntries(
        completed.map(({ candidateId, ledger }) => [candidateId, ledger]),
      ),
      dispatchIntentByCandidateId: Object.fromEntries(
        completed.map(({ candidateId, dispatch }) => [candidateId, dispatch]),
      ),
      settlementByCandidateId: Object.fromEntries(
        completed.map(({ candidateId, settlement }) => [
          candidateId,
          settlement,
        ]),
      ),
    });

    expect(firstBatch).toHaveLength(12);
    expect(remainingTargets.map(({ candidateId }) => candidateId)).toEqual(
      candidateIds.slice(12),
    );
    expect(remainingTargets).toHaveLength(5);
  });

  it("automatically selects only an exactly settled free-R2 outcome-unknown", () => {
    const context = currentCandidatePassBContext();
    const dispatch = {
      ...currentCandidatePassBDispatch(context),
      transportMode: "free-r2" as const,
    };
    const settlement: CandidatePassBOutcomeUnknownSettlement = {
      schemaVersion: CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION,
      status: "outcome-unknown",
      operationId: dispatch.operationId,
      providerPayloadDigest: dispatch.mediaReceipt.providerPayloadDigest,
      outputLanguage: dispatch.outputLanguage,
      castRosterId: dispatch.castRosterId,
      reason: "quota-outcome-unknown",
    };
    const input = {
      candidateIds: ["candidate-1"],
      attemptLedgerByCandidateId: {
        "candidate-1": createCandidatePassBInitialAttemptLedger(
          dispatch,
          settlement,
        ),
      },
      dispatchIntentByCandidateId: { "candidate-1": dispatch },
      settlementByCandidateId: { "candidate-1": settlement },
    };

    expect(selectCandidatePassBOutcomeUnknownIds(input)).toEqual([
      "candidate-1",
    ]);
    expect(
      selectCandidatePassBAnalysisOutstandingIds({
        ...input,
      }),
    ).toEqual(["candidate-1"]);
    expect(selectCandidatePassBAutomaticTargets(input)).toEqual([
      {
        candidateId: "candidate-1",
        reason: "free-outcome-unknown",
        attemptOrdinal: 1,
        replacesOperationId: dispatch.operationId,
      },
    ]);
    expect(
      selectCandidatePassBAnalysisOutstandingIds({
        ...input,
        dispatchIntentByCandidateId: {
          "candidate-1": {
            ...dispatch,
            operationId: `${dispatch.operationId}.drift`,
          },
        },
      }),
    ).toEqual([]);
    expect(
      selectCandidatePassBAnalysisOutstandingIds({
        ...input,
        attemptLedgerByCandidateId: {
          "candidate-1": createCandidatePassBInitialAttemptLedger({
            ...dispatch,
            transportMode: "paid-direct",
          }, settlement),
        },
        dispatchIntentByCandidateId: {
          "candidate-1": {
            ...dispatch,
            transportMode: "paid-direct",
          },
        },
      }),
    ).toEqual([]);
  });

  it("reselects a free ambiguity after the timer and preserves its completed sibling", async () => {
    vi.useFakeTimers();
    try {
      const context = currentCandidatePassBContext();
      const retryDispatch = {
        ...currentCandidatePassBDispatch(context, "candidate-retry"),
        transportMode: "free-r2" as const,
      };
      const retrySettlement: CandidatePassBOutcomeUnknownSettlement = {
        schemaVersion: CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION,
        status: "outcome-unknown",
        operationId: retryDispatch.operationId,
        providerPayloadDigest:
          retryDispatch.mediaReceipt.providerPayloadDigest,
        outputLanguage: retryDispatch.outputLanguage,
        castRosterId: retryDispatch.castRosterId,
        reason: "armed-dispatch-interrupted",
      };
      const siblingDispatch = currentCandidatePassBDispatch(
        context,
        "candidate-success",
      );
      const siblingSettlement =
        currentCandidatePassBSettlement(siblingDispatch);
      const siblingLedger = createCandidatePassBInitialAttemptLedger(
        siblingDispatch,
        siblingSettlement,
      );
      let durableInput: CandidatePassBAutomaticTargetInput = {
        candidateIds: ["candidate-retry", "candidate-success"],
        attemptLedgerByCandidateId: {
          "candidate-retry": createCandidatePassBInitialAttemptLedger(
            retryDispatch,
            retrySettlement,
          ),
          "candidate-success": siblingLedger,
        },
        dispatchIntentByCandidateId: {
          "candidate-retry": retryDispatch,
          "candidate-success": siblingDispatch,
        },
        settlementByCandidateId: {
          "candidate-retry": retrySettlement,
          "candidate-success": siblingSettlement,
        },
      };
      const onReady = vi.fn();

      scheduleCandidatePassBAutomaticTargetReadback({
        candidateIds: durableInput.candidateIds,
        delayMs: 1_000,
        readDurableInput: () => durableInput,
        onReady,
      });
      await vi.advanceTimersByTimeAsync(999);
      expect(onReady).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(onReady).toHaveBeenCalledWith([
        {
          candidateId: "candidate-retry",
          reason: "free-outcome-unknown",
          attemptOrdinal: 1,
          replacesOperationId: retryDispatch.operationId,
        },
      ]);

      const grant = {
        schemaVersion: CANDIDATE_PASS_B_RETRY_GRANT_SCHEMA_VERSION,
        grantId: "free-retry-grant-1",
        candidateId: "candidate-retry",
        replacesOperationId: retryDispatch.operationId,
        nextAttemptOrdinal: 1,
        mode: "automatic-free-tier" as const,
      };
      const grantedLedger = issueCandidatePassBRetryGrant(
        durableInput.attemptLedgerByCandidateId["candidate-retry"]!,
        grant,
      );
      const replacementDispatch = {
        ...retryDispatch,
        operationId: "candidate-pass-b.candidate-retry.attempt-1",
        attemptOrdinal: 1,
        retryGrantId: grant.grantId,
        mediaReceipt: {
          ...retryDispatch.mediaReceipt,
          providerPayloadDigest: `sha256:${"8".repeat(64)}` as const,
        },
      };
      const replacementLedger = appendCandidatePassBArmedAttempt(
        grantedLedger,
        {
          dispatchIntent: replacementDispatch,
          retryGrantId: grant.grantId,
        },
      );
      durableInput = {
        ...durableInput,
        attemptLedgerByCandidateId: {
          "candidate-retry": replacementLedger,
          "candidate-success": siblingLedger,
        },
        dispatchIntentByCandidateId: {
          "candidate-retry": replacementDispatch,
          "candidate-success": siblingDispatch,
        },
        settlementByCandidateId: {
          "candidate-success": siblingSettlement,
        },
      };

      expect(selectCandidatePassBAutomaticTargets(durableInput)).toEqual([]);
      expect(
        durableInput.attemptLedgerByCandidateId["candidate-success"],
      ).toBe(siblingLedger);
      expect(replacementLedger.attempts).toHaveLength(2);
      expect(replacementLedger.attempts[1]?.retryGrantId).toBe(grant.grantId);
      expect(replacementDispatch.operationId).not.toBe(
        retryDispatch.operationId,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
