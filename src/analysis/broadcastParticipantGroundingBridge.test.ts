import { describe, expect, it } from "vitest";

import {
  createBroadcastParticipantGrounding,
  isBroadcastParticipantGroundingForInput,
  type CreateBroadcastParticipantGroundingInput,
} from "./broadcastParticipantGrounding";
import {
  BroadcastParticipantGroundingBridgeError,
  projectBroadcastParticipantGroundingAdapterOutputs,
} from "./broadcastParticipantGroundingBridge";
import {
  BroadcastParticipantGroundingPlanContractError,
  createBroadcastParticipantGroundingGapReceipt,
  createBroadcastParticipantGroundingPlan,
  createBroadcastParticipantGroundingTerminalReceipt,
  projectBroadcastParticipantVoiceRecognition,
  type BroadcastParticipantGroundingCellReceipt,
  type BroadcastParticipantGroundingPlan,
  type CreateBroadcastParticipantGroundingPlanInput,
} from "./broadcastParticipantGroundingPlan";
import {
  DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
  candidatePassBCastReferences,
  type CandidatePassBParticipantId,
} from "./participantRoster";
import {
  PARTICIPANT_VOICE_ENROLLMENT_MANIFEST_SCHEMA_VERSION,
  type ParticipantVoiceEnrollmentAsset,
  type ParticipantVoiceEnrollmentManifest,
} from "./participantVoiceEnrollmentManifest";

const SOURCE_FINGERPRINT = `sha256:${"a".repeat(64)}`;
const VISUAL_REFERENCE_MANIFEST_HASH = `sha256:${"b".repeat(64)}`;
const SOURCE_DURATION_MS = 120_000;

const groundingInput: CreateBroadcastParticipantGroundingInput = {
  sourceDurationMs: SOURCE_DURATION_MS,
  castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
  chapters: [
    {
      chapterId: "chapter-1",
      startMs: 0,
      endMs: SOURCE_DURATION_MS,
      summaryKo: "두 사람이 대화하고 잠시 조용한 구간이 이어집니다.",
    },
  ],
};

function enrollmentAsset(
  participantId: CandidatePassBParticipantId,
  ordinal: number,
): ParticipantVoiceEnrollmentAsset {
  return {
    participantId,
    assetId: `voice:${participantId}:${ordinal}`,
    source: {
      sourceId: `source:${participantId}`,
      startMs: ordinal * 10_000,
      endMs: ordinal * 10_000 + 30_000,
    },
    contentSha256: `sha256:${ordinal.toString(16).padStart(64, "0")}`,
    provenance: {
      sourceType: "creator-published",
      sourceLocator: null,
      note: "테스트용 검증 구간",
    },
    consent: {
      status: "not-required",
      basis: "테스트 fixture",
    },
    language: "ko",
    speechActivity: "speech",
    containsOverlappingSpeech: false,
    containsMusic: false,
    humanVerification: {
      status: "verified",
      verifierId: "reviewer:test",
      verifiedAt: "2026-07-29T00:00:00.000Z",
      note: "단독 발화 확인",
    },
    embeddingModelRevision: "speaker-embedding:test-v1",
    assetRevision: "asset-v1",
  };
}

function enrollmentManifest(
  participantIds: readonly CandidatePassBParticipantId[],
): ParticipantVoiceEnrollmentManifest {
  return {
    schemaVersion: PARTICIPANT_VOICE_ENROLLMENT_MANIFEST_SCHEMA_VERSION,
    manifestRevision: "bridge-test-manifest-v1",
    assets: participantIds.map(enrollmentAsset),
  };
}

function groundingPlanInput(): CreateBroadcastParticipantGroundingPlanInput {
  const participantIds = candidatePassBCastReferences(
    DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
  )
    .slice(1, 3)
    .map(({ participantId }) => participantId);
  return {
    sourceFingerprint: SOURCE_FINGERPRINT,
    sourceDurationMs: SOURCE_DURATION_MS,
    transcriptSeal: "transcript:event-boost:bridge-test:sealed",
    castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
    samplingPlanRevision: "participant-bridge-sampling-v1",
    transcript: {
      adapterRevision: "transcript-name-grounding-v1",
      modelRevision: "qwen3-asr-test-v1",
      cells: [
        {
          sourceStartMs: 0,
          sourceEndMs: SOURCE_DURATION_MS,
          sourceUnitId: "chapter-1",
        },
      ],
    },
    visual: {
      adapterRevision: "visual-grounding-test-v1",
      modelRevision: "visual-reference-test-v1",
      referenceManifestHash: VISUAL_REFERENCE_MANIFEST_HASH,
      referenceParticipantIds: candidatePassBCastReferences(
        DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      ).map(({ participantId }) => participantId),
      cells: [
        {
          sourceStartMs: 10_000,
          sourceEndMs: 20_000,
          sourceUnitId: "visual-1",
          frameTimestampsMs: [11_000, 13_000, 16_000, 19_000],
        },
        {
          sourceStartMs: 30_000,
          sourceEndMs: 40_000,
          sourceUnitId: "visual-2",
          frameTimestampsMs: [31_000, 33_000, 36_000, 39_000],
        },
        {
          sourceStartMs: 50_000,
          sourceEndMs: 60_000,
          sourceUnitId: "visual-3",
          frameTimestampsMs: [51_000, 53_000, 56_000, 59_000],
        },
      ],
    },
    voice: {
      adapterRevision: "voice-grounding-test-v1",
      segmentationModelRevision: "pyannote-test-v1",
      enrollmentManifest: enrollmentManifest(participantIds),
      recognitionPolicy: {
        policyRevision: "voice-open-set-bridge-test-v1",
        absoluteMatchThresholds: participantIds.map((participantId) => ({
          participantId,
          minimumNormalizedSimilarity: 0.8,
        })),
        minimumTop1Top2Margin: 0.08,
      },
      cells: [
        {
          sourceStartMs: 10_000,
          sourceEndMs: 20_000,
          sourceUnitId: "voice-1",
        },
        {
          sourceStartMs: 30_000,
          sourceEndMs: 40_000,
          sourceUnitId: "voice-2",
        },
        {
          sourceStartMs: 50_000,
          sourceEndMs: 60_000,
          sourceUnitId: "voice-3",
        },
      ],
    },
  };
}

function adapter(
  plan: BroadcastParticipantGroundingPlan,
  name: "transcript-names" | "visual-identity" | "voice-identity",
) {
  const result = plan.adapters.find((item) => item.adapter === name);
  if (result === undefined || result.availability !== "enabled") {
    throw new Error(`Expected enabled ${name} adapter.`);
  }
  return result;
}

function voiceTerminalReceipt(
  plan: BroadcastParticipantGroundingPlan,
  ordinal: number,
  speechActivity: "speech" | "no-speech",
  scores: readonly {
    readonly participantId: CandidatePassBParticipantId;
    readonly normalizedSimilarity: number;
  }[],
) {
  const voice = adapter(plan, "voice-identity");
  const cell = voice.cells[ordinal]!;
  const projection = projectBroadcastParticipantVoiceRecognition({
    plan,
    cellId: cell.cellId,
    adapterFenceKey: voice.adapterFenceKey,
    modelRevision: voice.modelRevision,
    speechActivity,
    scores,
  });
  return createBroadcastParticipantGroundingTerminalReceipt({
    plan,
    adapter: "voice-identity",
    cellId: cell.cellId,
    operationId: `voice:bridge:${ordinal}`,
    attemptOrdinal: 0,
    outcome: projection.outcome,
    participantIds:
      projection.outcome === "identified" ? [projection.participantId] : [],
    confidence: projection.confidence,
    voiceRecognition: projection,
  });
}

function completedCellReceipts(
  plan: BroadcastParticipantGroundingPlan,
): readonly BroadcastParticipantGroundingCellReceipt[] {
  const transcript = adapter(plan, "transcript-names");
  const visual = adapter(plan, "visual-identity");
  const voice = adapter(plan, "voice-identity");
  const firstVoiceParticipant = voice.coveredParticipantIds[0]!;
  const secondVoiceParticipant = voice.coveredParticipantIds[1]!;
  return [
    createBroadcastParticipantGroundingTerminalReceipt({
      plan,
      adapter: "transcript-names",
      cellId: transcript.cells[0]!.cellId,
      operationId: "transcript:bridge:0",
      attemptOrdinal: 0,
      outcome: "none",
    }),
    createBroadcastParticipantGroundingTerminalReceipt({
      plan,
      adapter: "visual-identity",
      cellId: visual.cells[0]!.cellId,
      operationId: "visual:bridge:0",
      attemptOrdinal: 0,
      outcome: "identified",
      participantIds: ["amoretto"],
      confidence: 0.94,
    }),
    createBroadcastParticipantGroundingTerminalReceipt({
      plan,
      adapter: "visual-identity",
      cellId: visual.cells[1]!.cellId,
      operationId: "visual:bridge:1",
      attemptOrdinal: 0,
      outcome: "unidentified",
    }),
    createBroadcastParticipantGroundingTerminalReceipt({
      plan,
      adapter: "visual-identity",
      cellId: visual.cells[2]!.cellId,
      operationId: "visual:bridge:2",
      attemptOrdinal: 0,
      outcome: "none",
    }),
    voiceTerminalReceipt(plan, 0, "speech", [
      { participantId: firstVoiceParticipant, normalizedSimilarity: 0.94 },
      { participantId: secondVoiceParticipant, normalizedSimilarity: 0.6 },
    ]),
    voiceTerminalReceipt(plan, 1, "speech", [
      { participantId: firstVoiceParticipant, normalizedSimilarity: 0.92 },
      { participantId: secondVoiceParticipant, normalizedSimilarity: 0.88 },
    ]),
    voiceTerminalReceipt(plan, 2, "no-speech", []),
  ];
}

describe("broadcast participant grounding bridge", () => {
  it("projects only sealed terminal cells into exact visual and voice outputs", async () => {
    const plan = await createBroadcastParticipantGroundingPlan(
      groundingPlanInput(),
    );
    const outputs = projectBroadcastParticipantGroundingAdapterOutputs({
      groundingInput,
      expectedSourceFence: plan.sourceFence,
      plan,
      cellReceipts: completedCellReceipts(plan),
    });
    const grounding = createBroadcastParticipantGrounding(
      groundingInput,
      outputs,
    );

    expect(outputs.visualIdentity?.receipt).toMatchObject({
      revision: plan.adapters[1].adapterFenceKey,
      status: "completed",
      inputCount: 3,
      processedCount: 3,
    });
    expect(outputs.voiceIdentity?.receipt).toMatchObject({
      revision: plan.adapters[2].adapterFenceKey,
      status: "completed",
      inputCount: 3,
      processedCount: 3,
    });
    expect(outputs.voiceIdentity?.evidence).toEqual([
      expect.objectContaining({
        kind: "voice-reference-match",
        participantId: plan.adapters[2].coveredParticipantIds[0],
        confidence: 0.94,
      }),
      expect.objectContaining({
        kind: "speaker-unidentified",
        participantId: null,
        confidence: null,
      }),
      expect.objectContaining({
        kind: "no-speech",
        participantId: null,
        confidence: null,
      }),
    ]);
    expect(outputs.visualIdentity?.evidence).toEqual([
      expect.objectContaining({
        kind: "visual-reference-match",
        participantId: "amoretto",
        confidence: 0.94,
      }),
      expect.objectContaining({
        kind: "visible-participant-unidentified",
        participantId: null,
        confidence: null,
      }),
      expect.objectContaining({
        kind: "no-visible-participant",
        participantId: null,
        confidence: null,
      }),
    ]);
    expect(isBroadcastParticipantGroundingForInput(grounding, groundingInput)).toBe(
      true,
    );
  });

  it.each([
    ["retryable", "inference-failed"],
    ["outcome-unknown", "operation-interrupted"],
  ] as const)(
    "rejects a %s gap before projecting adapter outputs",
    async (disposition, reason) => {
      const plan = await createBroadcastParticipantGroundingPlan(
        groundingPlanInput(),
      );
      const receipts = [...completedCellReceipts(plan)];
      const voice = adapter(plan, "voice-identity");
      const failedCell = voice.cells[1]!;
      const failedIndex = receipts.findIndex(
        ({ cellId }) => cellId === failedCell.cellId,
      );
      receipts[failedIndex] = createBroadcastParticipantGroundingGapReceipt({
        plan,
        adapter: "voice-identity",
        cellId: failedCell.cellId,
        operationId: `voice:bridge:gap:${disposition}`,
        attemptOrdinal: 1,
        disposition,
        reason,
      });

      expect(() =>
        projectBroadcastParticipantGroundingAdapterOutputs({
          groundingInput,
          expectedSourceFence: plan.sourceFence,
          plan,
          cellReceipts: receipts,
        }),
      ).toThrow(BroadcastParticipantGroundingPlanContractError);
    },
  );

  it("rejects an incomplete receipt set instead of treating it as sealed", async () => {
    const plan = await createBroadcastParticipantGroundingPlan(
      groundingPlanInput(),
    );
    expect(() =>
      projectBroadcastParticipantGroundingAdapterOutputs({
        groundingInput,
        expectedSourceFence: plan.sourceFence,
        plan,
        cellReceipts: completedCellReceipts(plan).slice(0, -1),
      }),
    ).toThrow(BroadcastParticipantGroundingPlanContractError);
  });

  it("rejects a stale source fence before projecting any evidence", async () => {
    const plan = await createBroadcastParticipantGroundingPlan(
      groundingPlanInput(),
    );
    expect(() =>
      projectBroadcastParticipantGroundingAdapterOutputs({
        groundingInput,
        expectedSourceFence: {
          ...plan.sourceFence,
          sourceFingerprint: `sha256:${"c".repeat(64)}`,
        },
        plan,
        cellReceipts: completedCellReceipts(plan),
      }),
    ).toThrowError(BroadcastParticipantGroundingBridgeError);
  });

  it("keeps unavailable adapters explicit without fabricating evidence", async () => {
    const base = groundingPlanInput();
    const plan = await createBroadcastParticipantGroundingPlan({
      ...base,
      visual: {
        ...base.visual,
        modelRevision: null,
        referenceManifestHash: null,
        referenceParticipantIds: [],
      },
      voice: {
        ...base.voice,
        enrollmentManifest: null,
        recognitionPolicy: null,
      },
    });
    const transcript = adapter(plan, "transcript-names");
    const outputs = projectBroadcastParticipantGroundingAdapterOutputs({
      groundingInput,
      expectedSourceFence: plan.sourceFence,
      plan,
      cellReceipts: [
        createBroadcastParticipantGroundingTerminalReceipt({
          plan,
          adapter: "transcript-names",
          cellId: transcript.cells[0]!.cellId,
          operationId: "transcript:bridge:unavailable",
          attemptOrdinal: 0,
          outcome: "none",
        }),
      ],
    });

    expect(outputs.visualIdentity).toMatchObject({
      receipt: {
        status: "unavailable",
        inputCount: 0,
        processedCount: 0,
      },
      evidence: [],
    });
    expect(outputs.voiceIdentity).toMatchObject({
      receipt: {
        status: "unavailable",
        inputCount: 0,
        processedCount: 0,
      },
      evidence: [],
    });
  });

  it("does not accept null confidence for an identified observation", async () => {
    const plan = await createBroadcastParticipantGroundingPlan(
      groundingPlanInput(),
    );
    const outputs = projectBroadcastParticipantGroundingAdapterOutputs({
      groundingInput,
      expectedSourceFence: plan.sourceFence,
      plan,
      cellReceipts: completedCellReceipts(plan),
    });
    const grounding = createBroadcastParticipantGrounding(
      groundingInput,
      outputs,
    );
    const identifiedIndex = grounding.evidence.findIndex(
      ({ kind }) => kind === "voice-reference-match",
    );
    const evidence = [...grounding.evidence];
    evidence[identifiedIndex] = {
      ...evidence[identifiedIndex]!,
      confidence: null,
    } as (typeof evidence)[number];

    expect(
      isBroadcastParticipantGroundingForInput(
        { ...grounding, evidence },
        groundingInput,
      ),
    ).toBe(false);
  });
});
