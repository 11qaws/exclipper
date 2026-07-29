import { describe, expect, it } from "vitest";

import { createBroadcastParticipantGrounding } from "../analysis/broadcastParticipantGrounding";
import {
  BroadcastParticipantGroundingBridgeError,
  createBroadcastParticipantVisualTerminalReceiptFromSettlement,
} from "../analysis/broadcastParticipantGroundingBridge";
import {
  createBroadcastTranscriptVisualProviderSettlement,
} from "../analysis/broadcastTranscriptVisualInspectionQueue";
import {
  parseBroadcastTranscriptVisualInspectionRunnerCheckpointJson,
} from "../analysis/broadcastTranscriptVisualContextProjection";
import {
  InMemoryAnalysisResultStore,
} from "../storage/analysisResultStore";
import {
  assertBroadcastContextSessionRecord,
  createBroadcastParticipantGroundingInputSignature,
  parseBroadcastParticipantPreContextCheckpointJson,
  restoreBroadcastParticipantPreContextCheckpoint,
} from "../storage/broadcastContextSessionStore";
import {
  createCurrentVisualParticipantPipelineFixture,
  CURRENT_VISUAL_PARTICIPANT_MODEL_REVISION,
} from "../testSupport/currentVisualParticipantPipelineFixture";
import { certifyAnalysisPipelineSuccess } from "./analysisPipelineSuccess";
import { runDurableAnalysisPipelineCertification } from "./durableAnalysisPipelineCertification";

const CERTIFICATION_POLICY = {
  maximumAttempts: 2,
  // Full-suite workers contend while this integration fixture replays the
  // complete visual/participant/context chain. Keep the timeout deterministic
  // without weakening any readback or exact-match assertion.
  readbackTimeoutMs: 3_000,
  initialBackoffMs: 1,
  maximumBackoffMs: 2,
} as const;

async function persistCompleteSnapshot(
  store: InMemoryAnalysisResultStore,
  fixture: Awaited<
    ReturnType<typeof createCurrentVisualParticipantPipelineFixture>
  >,
): Promise<void> {
  const { input } = fixture;
  await store.putManifest(input.manifest);
  await store.putFinalResult(input.fastResult);
  await store.putTerminalRecord(input.fastTerminal);
  await store.putBroadcastContextSession(input.session);
  if (input.candidateRecord !== null) {
    await store.putCandidatePassBInsights(input.candidateRecord);
  }
}

function participantVisualCellId(
  fixture: Awaited<
    ReturnType<typeof createCurrentVisualParticipantPipelineFixture>
  >,
): string {
  const visualAdapter = fixture.preparedParticipant.plan.adapters.find(
    ({ adapter }) => adapter === "visual-identity",
  );
  const visualCell = visualAdapter?.cells.find(
    ({ sourceUnitId }) => sourceUnitId === fixture.settlement.cellId,
  );
  if (
    visualAdapter?.availability !== "enabled" ||
    visualCell === undefined
  ) {
    throw new TypeError(
      "The integration fixture must contain the matching participant visual cell.",
    );
  }
  return visualCell.cellId;
}

describe("current visual participant evidence packet integration", () => {
  it("certifies negative transcript evidence only after four frames, participant replay, and exact context grounding are durable", async () => {
    const fixture =
      await createCurrentVisualParticipantPipelineFixture();
    const { input } = fixture;

    expect(
      fixture.transcriptEvidenceCheckpoint.resolvedEvidence,
    ).toEqual([
      expect.objectContaining({
        chunkId: "asr-no-speech-003",
        reason: "no-speech",
        sourceStartMs: 120_000,
        sourceEndMs: input.session.sourceDurationMs,
      }),
    ]);
    expect(
      fixture.visualPlan.cells.filter(
        ({ transcriptAbstentionReason }) =>
          transcriptAbstentionReason === "no-speech",
      ),
    ).toHaveLength(1);
    expect(
      fixture.preparedFrameReceipt.frameContentFingerprints,
    ).toHaveLength(4);
    expect(
      new Set(
        fixture.preparedFrameReceipt.frameContentFingerprints,
      ).size,
    ).toBe(4);
    expect(fixture.preparedFrameReceipt.audioEvidence).toMatchObject({
      sourceStartMs: 120_000,
      sourceEndMs: input.session.sourceDurationMs,
    });
    expect(fixture.settlement).toMatchObject({
      outcome: "completed",
      providerModelRevision:
        CURRENT_VISUAL_PARTICIPANT_MODEL_REVISION,
      reviewedFrameTimestampsMs:
        fixture.preparedFrameReceipt.frameTimestampsMs,
      participantOutcome: {
        presence: "none-present",
        participants: [],
      },
    });

    const parsedParticipant =
      await parseBroadcastParticipantPreContextCheckpointJson(
        fixture.participantCheckpointJson,
        fixture.participantFence,
      );
    expect(parsedParticipant).toEqual(fixture.participantResult);
    expect(parsedParticipant).toMatchObject({
      planFingerprint: fixture.participantResult.planFingerprint,
      plan: {
        planFingerprint: fixture.participantResult.planFingerprint,
      },
      sealedPlan: {
        status: "sealed",
        planFingerprint: fixture.participantResult.planFingerprint,
      },
      grounding: fixture.participantResult.grounding,
    });

    const store = new InMemoryAnalysisResultStore();
    await persistCompleteSnapshot(store, fixture);
    const reopenedSession = await store.getBroadcastContextSession(
      input.manifest.runId,
    );
    expect(reopenedSession).not.toBeNull();
    if (reopenedSession === null) {
      throw new TypeError("The durable context session disappeared.");
    }
    const reopenedParticipant =
      await restoreBroadcastParticipantPreContextCheckpoint(
        reopenedSession,
      );
    expect(reopenedParticipant).toEqual(fixture.participantResult);
    const reopenedContextInput = JSON.parse(
      reopenedSession.contextInputCheckpointJson!,
    ) as { participantGrounding: unknown };
    expect(reopenedContextInput.participantGrounding).toEqual(
      reopenedParticipant?.grounding,
    );

    const certification =
      await runDurableAnalysisPipelineCertification({
        identity: {
          runId: input.manifest.runId,
          operationToken: "visual-participant-certification",
        },
        store,
        evidence: { candidates: input.candidates },
        isCurrent: () => true,
        policy: CERTIFICATION_POLICY,
      });
    if (certification.status !== "succeeded") {
      throw new Error(JSON.stringify(certification, null, 2));
    }
    expect(certification).toMatchObject({
      status: "succeeded",
      certificate: {
        quality: "usable",
        finalCandidateIds: [input.candidates[0]!.id],
        participantGroundingInputSignature:
          input.session.participantGroundingInputSignature,
        contextInputSignature:
          input.session.contextInputSignature,
      },
    });
  });

  it("rejects a grounding-only participant checkpoint even when its signature is recomputed", async () => {
    const fixture =
      await createCurrentVisualParticipantPipelineFixture();
    const groundingOnlyJson = JSON.stringify(
      fixture.participantResult.grounding,
    );
    await expect(
      parseBroadcastParticipantPreContextCheckpointJson(
        groundingOnlyJson,
        fixture.participantFence,
      ),
    ).resolves.toBeNull();

    const groundingOnlySignature =
      await createBroadcastParticipantGroundingInputSignature({
        inputSignature: fixture.input.session.inputSignature,
        transcriptSealOperationKey:
          fixture.input.session.transcriptSealOperationKey!,
        participantGroundingPlanFingerprint:
          fixture.participantResult.planFingerprint,
        participantGroundingCheckpointJson: groundingOnlyJson,
      });
    const result = await certifyAnalysisPipelineSuccess({
      ...fixture.input,
      session: {
        ...fixture.input.session,
        participantGroundingInputSignature:
          groundingOnlySignature,
        participantGroundingCheckpointJson: groundingOnlyJson,
      },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a visual checkpoint when any one of the four frame receipts is missing", async () => {
    const fixture =
      await createCurrentVisualParticipantPipelineFixture();
    const malformed = JSON.parse(
      fixture.visualInspectionCheckpointJson,
    ) as {
      preparedFrameReceipts: Array<{
        frameContentFingerprints: string[];
      }>;
    };
    malformed.preparedFrameReceipts[0]!.frameContentFingerprints.pop();
    const malformedJson = JSON.stringify(malformed);

    expect(
      parseBroadcastTranscriptVisualInspectionRunnerCheckpointJson(
        malformedJson,
        fixture.visualPlan,
      ),
    ).toBeNull();
    const malformedSession = {
      ...fixture.input.session,
      transcriptVisualInspectionCheckpointJson: malformedJson,
    };
    expect(() =>
      assertBroadcastContextSessionRecord(malformedSession),
    ).toThrow();
    const result = await certifyAnalysisPipelineSuccess({
      ...fixture.input,
      session: malformedSession,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a terminal participant receipt produced by a stale visual model fence", async () => {
    const fixture =
      await createCurrentVisualParticipantPipelineFixture();
    const staleSettlement =
      createBroadcastTranscriptVisualProviderSettlement({
        plan: fixture.visualPlan,
        cellId: fixture.settlement.cellId,
        preparedFrameReceipt: fixture.preparedFrameReceipt,
        providerModelRevision:
          `${CURRENT_VISUAL_PARTICIPANT_MODEL_REVISION}-stale`,
        operationId: "visual-participant-operation-stale-model",
        attemptOrdinal: 0,
        outcome: "completed",
        editorialFinding: "quiet-success",
        summaryKo: fixture.settlement.summaryKo!,
        providerResponseFingerprint: `sha256:${"7".repeat(64)}`,
        participantOutcome: fixture.settlement.participantOutcome!,
      });

    expect(staleSettlement.providerModelRevision).not.toBe(
      fixture.preparedParticipant.plan.adapters.find(
        ({ adapter }) => adapter === "visual-identity",
      )?.modelRevision,
    );
    expect(() =>
      createBroadcastParticipantVisualTerminalReceiptFromSettlement({
        participantPlan: fixture.preparedParticipant.plan,
        participantCellId: participantVisualCellId(fixture),
        visualInspectionPlan: fixture.visualPlan,
        settlement: staleSettlement,
      }),
    ).toThrow(BroadcastParticipantGroundingBridgeError);
  });

  it("rejects a context checkpoint whose grounding differs from the sealed full packet", async () => {
    const fixture =
      await createCurrentVisualParticipantPipelineFixture();
    const alternateGrounding = createBroadcastParticipantGrounding({
      sourceDurationMs: fixture.input.session.sourceDurationMs,
      castRosterId: null,
      chapters: fixture.participantFence.dialogueChapters,
    });
    expect(alternateGrounding).not.toEqual(
      fixture.participantResult.grounding,
    );
    const contextInput = JSON.parse(
      fixture.input.session.contextInputCheckpointJson!,
    ) as Record<string, unknown>;
    const mismatchedSession = {
      ...fixture.input.session,
      contextInputCheckpointJson: JSON.stringify({
        ...contextInput,
        participantGrounding: alternateGrounding,
      }),
    };

    expect(() =>
      assertBroadcastContextSessionRecord(mismatchedSession),
    ).toThrow(/participant evidence|durable source map/u);
    const result = await certifyAnalysisPipelineSuccess({
      ...fixture.input,
      session: mismatchedSession,
    });
    expect(result.ok).toBe(false);
  });
});
