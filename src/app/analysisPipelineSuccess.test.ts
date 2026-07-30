import { describe, expect, it } from "vitest";

import {
  parseBroadcastTranscriptProviderReceiptCheckpointJson,
} from "../analysis/broadcastTranscriptProviderReceiptCheckpoint";
import {
  parseBroadcastTranscriptResolvedEvidenceCheckpointJson,
} from "../analysis/broadcastTranscriptResolvedEvidence";
import {
  CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION,
  createCandidatePassBPlanReceipt,
} from "../storage/candidatePassBInsightStore";
import {
  CANDIDATE_PASS_B_VERIFICATION_RECEIPT_SCHEMA_VERSION,
} from "../analysis/candidatePassBWorkerProtocol";
import {
  certifyAnalysisPipelineSuccess,
  type AnalysisPipelineSuccessInput,
} from "./analysisPipelineSuccess";
import {
  createAnalysisPipelineHappyPathFixture,
  createAnalysisPipelineIntentionalEmptyFixture,
} from "../testSupport/analysisPipelineHappyPathFixture";

function expectFailure(
  result: Awaited<ReturnType<typeof certifyAnalysisPipelineSuccess>>,
  code: string,
): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.gaps.map((gap) => gap.code)).toContain(code);
}

describe("analysis pipeline success certificate", () => {
  it("certifies one fully reopened usable candidate", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture();

    const result = await certifyAnalysisPipelineSuccess(fixture);

    expect(result).toMatchObject({
      ok: true,
      certificate: {
        schemaVersion: "1.0.0",
        runId: fixture.manifest.runId,
        inputSignature: fixture.manifest.inputSignature,
        quality: "usable",
        finalCandidateIds: ["highlight-audio-1234abcd"],
      },
    });
    if (!result.ok) return;
    expect(result.certificate.refinementEvidenceProjectionFingerprint).toMatch(
      /^sha256:[a-f0-9]{64}$/u,
    );
    expect(result.certificate.refinementInputSignature).toMatch(
      /^sha256:[a-f0-9]{64}$/u,
    );
    expect(result.certificate.candidatePlanFingerprint).toBe(
      fixture.candidateRecord?.planReceipt.planFingerprint,
    );
    expect(result.certificate.contextResultFingerprint).toMatch(
      /^sha256:[a-f0-9]{64}$/u,
    );
  });

  it("never certifies a discovery or jury partial result as final context", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture();
    const contextResultJson = fixture.session.contextResultJson;
    if (contextResultJson === null) {
      throw new Error("Current context result is required.");
    }
    const envelope = JSON.parse(contextResultJson) as {
      result: {
        semanticChaptersSupported: boolean;
        semanticChapters: unknown[];
        discoveredLeadsSupported: boolean;
        discoveredLeads: unknown[];
      };
    };
    envelope.result.semanticChaptersSupported = false;
    envelope.result.semanticChapters = [];

    expectFailure(
      await certifyAnalysisPipelineSuccess({
        ...fixture,
        session: {
          ...fixture.session,
          contextResultJson: JSON.stringify(envelope),
        },
      }),
      "context-result-invalid",
    );
  });

  it("rejects a final-looking context result not linked to the successful jury parent", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture();
    const contextResultJson = fixture.session.contextResultJson;
    if (contextResultJson === null) {
      throw new Error("Current context result is required.");
    }
    const envelope = JSON.parse(contextResultJson) as {
      result: { broadcastSummaryKo: string };
    };
    envelope.result.broadcastSummaryKo += " tampered";

    expectFailure(
      await certifyAnalysisPipelineSuccess({
        ...fixture,
        session: {
          ...fixture.session,
          contextResultJson: JSON.stringify(envelope),
        },
      }),
      "context-result-invalid",
    );
  });

  it("certifies caption-bearing input only through complete exact-cell transcript ledgers", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture();
    const evidenceJson = fixture.session.transcriptEvidenceCheckpointJson;
    const providerJson =
      fixture.session.transcriptProviderReceiptCheckpointJson;
    expect(evidenceJson).not.toBeNull();
    expect(providerJson).not.toBeNull();
    const evidence =
      evidenceJson === null
        ? null
        : parseBroadcastTranscriptResolvedEvidenceCheckpointJson(evidenceJson);
    const provider =
      providerJson === null
        ? null
        : parseBroadcastTranscriptProviderReceiptCheckpointJson(providerJson);

    expect(evidence?.plannedCells).toHaveLength(2);
    expect(provider?.plannedCells).toEqual(evidence?.plannedCells);
    expect(provider?.captionReceipts).toHaveLength(2);
    expect(provider?.receipts).toHaveLength(0);
    await expect(certifyAnalysisPipelineSuccess(fixture)).resolves.toMatchObject({
      ok: true,
    });
  });

  it("never certifies the removed caption shortcut with null evidence and receipts", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture();
    const tampered: AnalysisPipelineSuccessInput = {
      ...fixture,
      session: {
        ...fixture.session,
        transcriptEvidenceInputSignature: null,
        transcriptEvidenceCheckpointJson: null,
        transcriptProviderReceiptInputSignature: null,
        transcriptProviderReceiptCheckpointJson: null,
      },
    };

    expectFailure(
      await certifyAnalysisPipelineSuccess(tampered),
      "transcript-unsettled",
    );
  });

  it("certifies completedEmpty only after a complete AI rejection", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture({
      clipDecision: "reject",
    });

    const result = await certifyAnalysisPipelineSuccess(fixture);

    expect(result).toMatchObject({
      ok: true,
      certificate: {
        quality: "empty",
        finalCandidateIds: [],
      },
    });
  });

  it("certifies an editor-rejected empty detail cohort only from its exact durable plan", async () => {
    const fixture = await createAnalysisPipelineIntentionalEmptyFixture();

    await expect(certifyAnalysisPipelineSuccess(fixture)).resolves.toMatchObject({
      ok: true,
      certificate: {
        quality: "empty",
        finalCandidateIds: [],
        candidatePlanFingerprint:
          fixture.candidateRecord?.planReceipt.planFingerprint,
      },
    });
  });

  it("rejects a missing candidate record even when the exact planned detail cohort is empty", async () => {
    const fixture = await createAnalysisPipelineIntentionalEmptyFixture();

    const result = await certifyAnalysisPipelineSuccess({
      ...fixture,
      candidateRecord: null,
    });

    expectFailure(result, "candidate-plan-invalid");
  });

  it("rejects a fabricated empty plan when the current context planned a candidate", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture({
      withRefinement: false,
    });
    const candidateRecord = fixture.candidateRecord;
    const contextInputSignature = fixture.session.contextInputSignature;
    if (candidateRecord === null || contextInputSignature === null) {
      throw new Error("Current durable fixture artifacts are required.");
    }
    const result = await certifyAnalysisPipelineSuccess({
      ...fixture,
      candidateRecord: {
        ...candidateRecord,
        planReceipt: await createCandidatePassBPlanReceipt({
          runId: fixture.manifest.runId,
          inputSignature: fixture.manifest.inputSignature,
          contextInputSignature,
          refinementEvidenceProjectionFingerprint: null,
          plannedCandidateIds: [],
          contextByCandidateId: {},
        }),
        contextByCandidateId: {},
        evidenceById: {},
        insightById: {},
        modelByCandidateId: {},
        thumbnailById: {},
        attemptLedgerByCandidateId: {},
        dispatchIntentByCandidateId: {},
        settlementByCandidateId: {},
        verificationReceiptById: {},
      },
    });

    expectFailure(result, "candidate-plan-invalid");
  });

  it.each([
    [
      "an uncertain clip decision",
      { clipDecision: "uncertain" as const },
    ],
    [
      "insufficient context",
      { contextConsistency: "insufficient" as const },
    ],
    [
      "an incoherent recommended music verdict",
      {
        clipDecision: "recommend" as const,
        programMaterial: "music-or-intermission" as const,
      },
    ],
  ] as const)(
    "does not certify an empty success from %s",
    async (_label, insightOverrides) => {
      const fixture = await createAnalysisPipelineHappyPathFixture();
      const candidateRecord = fixture.candidateRecord;
      const candidateId = fixture.candidates[0]?.id;
      if (candidateRecord === null || candidateId === undefined) {
        throw new Error("Current candidate fixture is required.");
      }
      const insight = candidateRecord.insightById[candidateId];
      if (insight === undefined) {
        throw new Error("Current candidate insight is required.");
      }
      const result = await certifyAnalysisPipelineSuccess({
        ...fixture,
        candidateRecord: {
          ...candidateRecord,
          insightById: {
            ...candidateRecord.insightById,
            [candidateId]: {
              ...insight,
              ...insightOverrides,
            },
          },
        },
      });

      expect(result).toMatchObject({
        ok: false,
        failedStage: "publication",
        gaps: [{
          code: "candidate-verification-incomplete",
          candidateIds: [candidateId],
        }],
      });
    },
  );

  it("rejects a run fence mismatch", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture();
    const tampered: AnalysisPipelineSuccessInput = {
      ...fixture,
      fastTerminal: {
        ...fixture.fastTerminal,
        runId: "another-run",
      },
    };

    expectFailure(
      await certifyAnalysisPipelineSuccess(tampered),
      "run-fence-mismatch",
    );
  });

  it("rejects a mutually consistent artifact bundle from an older engine", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture();
    const legacyModelManifestHash =
      "streamer-reaction-fast-pass-v5-chat-fallback-music-confirmation";
    const tampered: AnalysisPipelineSuccessInput = {
      ...fixture,
      manifest: {
        ...fixture.manifest,
        modelManifestHash: legacyModelManifestHash,
      },
      fastResult: {
        ...fixture.fastResult,
        modelManifestHash: legacyModelManifestHash,
      },
      fastTerminal: {
        ...fixture.fastTerminal,
        modelManifestHash: legacyModelManifestHash,
      },
    };

    expectFailure(
      await certifyAnalysisPipelineSuccess(tampered),
      "run-fence-mismatch",
    );
  });

  it("rejects an unsettled transcript checkpoint", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture();
    const tampered: AnalysisPipelineSuccessInput = {
      ...fixture,
      session: {
        ...fixture.session,
        gapChunkIds: ["missing-caption-cell"],
      },
    };

    expectFailure(
      await certifyAnalysisPipelineSuccess(tampered),
      "transcript-unsettled",
    );
  });

  it("rejects a self-consistent transcript made by the previous model contract", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture();
    const tampered: AnalysisPipelineSuccessInput = {
      ...fixture,
      session: {
        ...fixture.session,
        modelRevision:
          "qwen3.5-omni-flash-audio-transcript-reviewed-2026-07-22",
      },
    };

    expectFailure(
      await certifyAnalysisPipelineSuccess(tampered),
      "transcript-unsettled",
    );
  });

  it("rejects a transcript seal whose identity cannot be reproduced exactly", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture();
    const tampered: AnalysisPipelineSuccessInput = {
      ...fixture,
      session: {
        ...fixture.session,
        transcriptSealOperationKey:
          `${fixture.session.runId}:` +
          `${fixture.fastResult.result.input.source.contentFingerprint}:` +
          `event-boost:identity-sha256:${"c".repeat(64)}`,
      },
    };

    expectFailure(
      await certifyAnalysisPipelineSuccess(tampered),
      "transcript-unsettled",
    );
  });

  it("rejects a stale whole-context signature", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture();
    const tampered: AnalysisPipelineSuccessInput = {
      ...fixture,
      session: {
        ...fixture.session,
        contextInputSignature: `sha256:${"f".repeat(64)}`,
      },
    };

    expectFailure(
      await certifyAnalysisPipelineSuccess(tampered),
      "context-input-stale",
    );
  });

  it("rejects stale refinement artifacts under a zero-lead plan", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture({
      withRefinement: false,
    });
    const tampered: AnalysisPipelineSuccessInput = {
      ...fixture,
      session: {
        ...fixture.session,
        refinementInputSignature: `sha256:${"1".repeat(64)}`,
        refinementCandidatesJson: "[]",
      },
    };

    expectFailure(
      await certifyAnalysisPipelineSuccess(tampered),
      "refinement-evidence-incomplete",
    );
  });

  it("rejects a semantic refinement signature from another evidence projection", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture();
    const tampered: AnalysisPipelineSuccessInput = {
      ...fixture,
      session: {
        ...fixture.session,
        refinementInputSignature: `sha256:${"2".repeat(64)}`,
      },
    };

    expectFailure(
      await certifyAnalysisPipelineSuccess(tampered),
      "refinement-receipt-stale",
    );
  });

  it("rejects a legacy candidate insight schema", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture();
    const candidateRecord = fixture.candidateRecord;
    if (candidateRecord === null) throw new Error("Fixture record is required.");
    const tampered: AnalysisPipelineSuccessInput = {
      ...fixture,
      candidateRecord: {
        ...candidateRecord,
        schemaVersion: "1.4.0",
      } as unknown as typeof candidateRecord,
    };

    expect(CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION).toBe("4.0.0");
    expectFailure(
      await certifyAnalysisPipelineSuccess(tampered),
      "current-schema-required",
    );
  });

  it("rejects a volatile candidate cohort that is not reproducible from durable artifacts", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture();
    const tampered: AnalysisPipelineSuccessInput = {
      ...fixture,
      candidates: fixture.candidates.map((candidate) => ({
        ...candidate,
        peakMs: candidate.peakMs + 1_000,
      })),
    };

    expectFailure(
      await certifyAnalysisPipelineSuccess(tampered),
      "run-fence-mismatch",
    );
  });

  it("rejects a context receipt issued for another packet", async () => {
    const fixture = await createAnalysisPipelineHappyPathFixture();
    const candidateRecord = fixture.candidateRecord;
    if (
      candidateRecord === null ||
      candidateRecord.verificationReceiptById === undefined
    ) {
      throw new Error("Fixture receipt is required.");
    }
    const receipt =
      candidateRecord.verificationReceiptById["highlight-audio-1234abcd"];
    if (
      receipt === undefined ||
      receipt.schemaVersion !==
        CANDIDATE_PASS_B_VERIFICATION_RECEIPT_SCHEMA_VERSION
    ) {
      throw new Error("Current fixture receipt is required.");
    }
    const tampered: AnalysisPipelineSuccessInput = {
      ...fixture,
      candidateRecord: {
        ...candidateRecord,
        verificationReceiptById: {
          ...candidateRecord.verificationReceiptById,
          "highlight-audio-1234abcd": {
            ...receipt,
            contextFingerprint: "fnv1a64:0123456789abcdef",
          },
        },
      },
    };

    expectFailure(
      await certifyAnalysisPipelineSuccess(tampered),
      "current-schema-required",
    );
  });
});
