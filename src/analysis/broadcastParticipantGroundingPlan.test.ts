import { describe, expect, it } from "vitest";

import {
  BroadcastParticipantGroundingPlanContractError,
  createBroadcastParticipantGroundingGapReceipt,
  createBroadcastParticipantGroundingNoneObservedReceipt,
  createBroadcastParticipantGroundingPlan,
  createBroadcastParticipantGroundingTerminalReceipt,
  createBroadcastParticipantMediaBundleReuseKeys,
  inspectBroadcastParticipantGroundingPlanCompletion,
  normalizeBroadcastParticipantGroundingPlan,
  normalizeBroadcastParticipantGroundingCellReceipt,
  normalizeBroadcastParticipantGroundingNoneObservedReceipt,
  projectBroadcastParticipantVoiceRecognition,
  sealBroadcastParticipantGroundingPlan,
  type BroadcastParticipantGroundingCellPlan,
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
  eligibleParticipantVoiceEnrollmentAssets,
  type ParticipantVoiceEnrollmentAsset,
  type ParticipantVoiceEnrollmentManifest,
} from "./participantVoiceEnrollmentManifest";

const SOURCE_FINGERPRINT = `sha256:${"a".repeat(64)}`;
const VISUAL_REFERENCE_MANIFEST_HASH = `sha256:${"b".repeat(64)}`;
const SOURCE_DURATION_MS = 120_000;

function enrollmentAsset(
  participantId: CandidatePassBParticipantId,
  ordinal: number,
  status: "eligible" | "pending" = "eligible",
): ParticipantVoiceEnrollmentAsset {
  const eligible = status === "eligible";
  return {
    participantId,
    assetId: `voice:${participantId}:${ordinal}`,
    source: {
      sourceId: `chzzk-video-13996057:${participantId}`,
      startMs: ordinal * 10_000,
      endMs: ordinal * 10_000 + 30_000,
    },
    contentSha256: `sha256:${ordinal.toString(16).padStart(64, "0")}`,
    provenance: {
      sourceType: "creator-published",
      sourceLocator: "https://chzzk.naver.com/video/13996057",
      note: eligible ? "사람이 검토한 단독 발화" : "검토 전 후보",
    },
    consent: {
      status: eligible ? "not-required" : "unknown",
      basis: eligible ? "검토 fixture" : "사용 근거 확인 전",
    },
    language: "ko",
    speechActivity: "speech",
    containsOverlappingSpeech: !eligible,
    containsMusic: !eligible,
    humanVerification: eligible
      ? {
          status: "verified",
          verifierId: "reviewer:test",
          verifiedAt: "2026-07-29T00:00:00.000Z",
          note: "화자와 단독 발화를 확인함",
        }
      : {
          status: "pending",
          verifierId: null,
          verifiedAt: null,
          note: "사람 검토 전",
        },
    embeddingModelRevision: eligible
      ? "wavlm-xvector-test-v1"
      : "speaker-embedding:unassigned",
    assetRevision: "asset-v1",
  };
}

function enrollmentManifest(
  status: "eligible" | "pending",
  participantIds: readonly CandidatePassBParticipantId[] = candidatePassBCastReferences(
    DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
  ).map(({ participantId }) => participantId),
): ParticipantVoiceEnrollmentManifest {
  return {
    schemaVersion: PARTICIPANT_VOICE_ENROLLMENT_MANIFEST_SCHEMA_VERSION,
    manifestRevision: `voice-manifest-${status}-v1`,
    assets: participantIds.map((participantId, index) =>
      enrollmentAsset(participantId, index + 1, status),
    ),
  };
}

function planInput(
  options: {
    readonly visualEnabled?: boolean;
    readonly visualReferenceManifest?: boolean;
    readonly voiceManifest?: ParticipantVoiceEnrollmentManifest | null;
  } = {},
): CreateBroadcastParticipantGroundingPlanInput {
  const visualEnabled = options.visualEnabled ?? false;
  const visualReferenceManifest =
    options.visualReferenceManifest ?? visualEnabled;
  const voiceManifest = options.voiceManifest ?? null;
  const coveredVoiceParticipantIds =
    voiceManifest === null
      ? []
      : eligibleParticipantVoiceEnrollmentAssets(voiceManifest).map(
          ({ participantId }) => participantId,
        );
  return {
    sourceFingerprint: SOURCE_FINGERPRINT,
    sourceDurationMs: SOURCE_DURATION_MS,
    transcriptSeal: "transcript:event-boost:g1:sealed",
    castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
    samplingPlanRevision: "participant-sampling-v1",
    transcript: {
      adapterRevision: "transcript-name-grounding-v1",
      modelRevision: "qwen3-asr-transcript-v1",
      cells: [
        {
          sourceStartMs: 0,
          sourceEndMs: 60_000,
          sourceUnitId: "chapter-1",
        },
        {
          sourceStartMs: 60_000,
          sourceEndMs: 120_000,
          sourceUnitId: "chapter-2",
        },
      ],
    },
    visual: {
      adapterRevision: "visual-grounding-v1",
      modelRevision: visualEnabled ? "visual-closed-set-v1" : null,
      referenceManifestHash: visualReferenceManifest
        ? VISUAL_REFERENCE_MANIFEST_HASH
        : null,
      referenceParticipantIds: visualReferenceManifest
        ? candidatePassBCastReferences(
            DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
          ).map(({ participantId }) => participantId)
        : [],
      cells: [
        {
          sourceStartMs: 20_000,
          sourceEndMs: 30_000,
          sourceUnitId: "visual-probe-1",
          frameTimestampsMs: [21_000, 23_000, 26_000, 29_000],
        },
      ],
    },
    voice: {
      adapterRevision: "voice-grounding-v1",
      segmentationModelRevision: "pyannote-segmentation-test-v1",
      enrollmentManifest: voiceManifest,
      recognitionPolicy:
        coveredVoiceParticipantIds.length === 0
          ? null
          : {
              policyRevision: "voice-open-set-policy-test-v1",
              absoluteMatchThresholds: coveredVoiceParticipantIds.map(
                (participantId) => ({
                  participantId,
                  minimumNormalizedSimilarity: 0.8,
                }),
              ),
              minimumTop1Top2Margin: 0.08,
            },
      cells: [
        {
          sourceStartMs: 20_000,
          sourceEndMs: 30_000,
          sourceUnitId: "voice-turn-1",
        },
      ],
    },
  };
}

function terminalReceipts(
  plan: BroadcastParticipantGroundingPlan,
): (
  | ReturnType<typeof createBroadcastParticipantGroundingTerminalReceipt>
  | ReturnType<typeof createBroadcastParticipantGroundingNoneObservedReceipt>
)[] {
  const cellReceipts = plan.adapters.flatMap((adapter) =>
    adapter.cells.map((cell) => {
      const voiceRecognition =
        adapter.adapter === "voice-identity"
          ? projectBroadcastParticipantVoiceRecognition({
              plan,
              cellId: cell.cellId,
              adapterFenceKey: adapter.adapterFenceKey,
              modelRevision: adapter.modelRevision!,
              speechActivity: "speech",
              scores: adapter.coveredParticipantIds.map(
                (participantId, ordinal) => ({
                  participantId,
                  normalizedSimilarity:
                    ordinal === 0 ? 0.96 : Math.max(0.1, 0.6 - ordinal * 0.02),
                }),
              ),
            })
          : null;
      return createBroadcastParticipantGroundingTerminalReceipt({
        plan,
        adapter: adapter.adapter,
        cellId: cell.cellId,
        operationId: `grounding:${adapter.adapter}:${cell.ordinal}`,
        attemptOrdinal: 0,
        ...(adapter.adapter === "visual-identity"
          ? {
              outcome: "identified" as const,
              participantIds: ["amoretto"] as const,
              confidence: 0.94,
            }
          : adapter.adapter === "voice-identity"
            ? {
                outcome: voiceRecognition!.outcome,
                participantIds:
                  voiceRecognition!.outcome === "identified"
                    ? [voiceRecognition!.participantId]
                    : [],
                confidence: voiceRecognition!.confidence,
                voiceRecognition,
              }
            : {
                outcome: "none" as const,
              }),
      });
    }),
  );
  const unavailableReceipts = plan.adapters.flatMap((adapter) =>
    adapter.adapter !== "transcript-names" &&
    adapter.availability === "unavailable"
      ? [
          createBroadcastParticipantGroundingNoneObservedReceipt({
            plan,
            adapter: adapter.adapter,
            operationId: `grounding:${adapter.adapter}:none-observed`,
            attemptOrdinal: 0,
          }),
        ]
      : [],
  );
  return [...cellReceipts, ...unavailableReceipts];
}

function cell(
  plan: BroadcastParticipantGroundingPlan,
  adapter: "transcript-names" | "visual-identity" | "voice-identity",
  ordinal = 0,
): BroadcastParticipantGroundingCellPlan {
  const result = plan.adapters.find((item) => item.adapter === adapter)?.cells[
    ordinal
  ];
  if (result === undefined) {
    throw new Error(`Missing ${adapter} test cell.`);
  }
  return result;
}

describe("broadcast participant grounding pre-context plan", () => {
  it("requires explicit bounded none-observed receipts before unavailable visual/voice adapters can seal", async () => {
    const plan = await createBroadcastParticipantGroundingPlan(
      planInput({
        voiceManifest: enrollmentManifest("pending"),
      }),
    );
    const visual = plan.adapters[1];
    const voice = plan.adapters[2];

    expect(visual).toMatchObject({
      adapter: "visual-identity",
      availability: "unavailable",
      unavailableReason: "unsupported-runtime",
      cells: [],
    });
    expect(voice).toMatchObject({
      adapter: "voice-identity",
      availability: "unavailable",
      unavailableReason: "no-verified-reference-manifest",
      coveredParticipantIds: [],
      cells: [],
    });
    expect(voice.referenceManifestHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(voice.missingParticipantIds).toEqual(plan.expectedParticipantIds);

    const cellOnly = terminalReceipts(plan).filter(
      (receipt) => receipt.outcome !== "none-observed",
    );
    expect(
      inspectBroadcastParticipantGroundingPlanCompletion(plan, cellOnly),
    ).toMatchObject({
      requiredNoneObservedAdapterCount: 2,
      terminalNoneObservedAdapterCount: 0,
      missingNoneObservedAdapters: ["visual-identity", "voice-identity"],
      readyToSeal: false,
    });
    expect(() => sealBroadcastParticipantGroundingPlan(plan, cellOnly)).toThrow(
      /none-observed/u,
    );
    const sealed = sealBroadcastParticipantGroundingPlan(
      plan,
      terminalReceipts(plan),
    );
    expect(sealed.status).toBe("sealed");
    expect(sealed.terminalCells).toHaveLength(2);
    expect(sealed.noneObservedReceipts).toEqual([
      expect.objectContaining({
        adapter: "visual-identity",
        outcome: "none-observed",
        sourceStartMs: 0,
        sourceEndMs: SOURCE_DURATION_MS,
      }),
      expect.objectContaining({
        adapter: "voice-identity",
        outcome: "none-observed",
        sourceStartMs: 0,
        sourceEndMs: SOURCE_DURATION_MS,
      }),
    ]);
    expect(sealed.adapterReceipts).toEqual([
      expect.objectContaining({
        adapter: "transcript-names",
        status: "completed",
        inputCount: 2,
        processedCount: 2,
      }),
      expect.objectContaining({
        adapter: "visual-identity",
        status: "unavailable",
        inputCount: 0,
      }),
      expect.objectContaining({
        adapter: "voice-identity",
        status: "unavailable",
        inputCount: 0,
      }),
    ]);
  });

  it("runs four-frame visual inspection without pretending the text roster is an image manifest", async () => {
    const plan = await createBroadcastParticipantGroundingPlan(
      planInput({
        visualEnabled: true,
        visualReferenceManifest: false,
      }),
    );
    const visual = plan.adapters[1];

    expect(visual).toMatchObject({
      adapter: "visual-identity",
      availability: "enabled",
      referenceManifestHash: null,
      coveredParticipantIds: [],
      missingParticipantIds: plan.expectedParticipantIds,
    });
    expect(visual.cells).toHaveLength(1);
    expect(visual.cells[0]?.frameTimestampsMs).toEqual([
      21_000,
      23_000,
      26_000,
      29_000,
    ]);
    await expect(
      normalizeBroadcastParticipantGroundingPlan(plan),
    ).resolves.toEqual(plan);
  });

  it("rejects spoofed none-observed source, transcript, model, and whole-source range fences", async () => {
    const plan = await createBroadcastParticipantGroundingPlan(planInput());
    const receipt = createBroadcastParticipantGroundingNoneObservedReceipt({
      plan,
      adapter: "visual-identity",
      operationId: "grounding:visual:none-observed:fence-test",
      attemptOrdinal: 0,
    });
    const corruptions = [
      {
        ...receipt,
        sourceFingerprint: `sha256:${"c".repeat(64)}`,
      },
      {
        ...receipt,
        sourceDurationMs: SOURCE_DURATION_MS - 1,
      },
      {
        ...receipt,
        transcriptSeal: "transcript:other:sealed",
      },
      {
        ...receipt,
        adapterRevision: "visual-grounding-spoofed-v1",
      },
      {
        ...receipt,
        modelRevision: "visual-model-spoofed-v1",
      },
      {
        ...receipt,
        sourceStartMs: 1,
      },
      {
        ...receipt,
        sourceEndMs: SOURCE_DURATION_MS - 1,
      },
    ];
    for (const corrupted of corruptions) {
      expect(
        normalizeBroadcastParticipantGroundingNoneObservedReceipt(
          corrupted,
          plan,
        ),
      ).toBeNull();
    }
    expect(() =>
      inspectBroadcastParticipantGroundingPlanCompletion(plan, [
        ...terminalReceipts(plan).filter(
          (candidate) =>
            candidate.outcome !== "none-observed" ||
            candidate.adapter !== "visual-identity",
        ),
        corruptions[0],
      ]),
    ).toThrow(/source\/model\/manifest\/range fence/u);
  });

  it("rejects enabled visual and voice terminals when their direct source or adapter fences drift", async () => {
    const plan = await createBroadcastParticipantGroundingPlan(
      planInput({
        visualEnabled: true,
        voiceManifest: enrollmentManifest("eligible"),
      }),
    );
    const receipts = terminalReceipts(plan);
    const visual = receipts.find(
      (receipt) =>
        receipt.outcome !== "none-observed" &&
        receipt.adapter === "visual-identity",
    );
    const voice = receipts.find(
      (receipt) =>
        receipt.outcome !== "none-observed" &&
        receipt.adapter === "voice-identity",
    );
    if (
      visual === undefined ||
      voice === undefined ||
      visual.outcome === "none-observed" ||
      voice.outcome === "none-observed"
    ) {
      throw new Error("Expected enabled visual and voice terminal fixtures.");
    }
    expect(
      normalizeBroadcastParticipantGroundingCellReceipt(
        { ...visual, sourceEndMs: visual.sourceEndMs - 1 },
        plan,
      ),
    ).toBeNull();
    expect(
      normalizeBroadcastParticipantGroundingCellReceipt(
        { ...visual, adapterRevision: "visual-extractor-spoofed-v1" },
        plan,
      ),
    ).toBeNull();
    expect(
      normalizeBroadcastParticipantGroundingCellReceipt(
        { ...voice, transcriptSeal: "transcript:other:sealed" },
        plan,
      ),
    ).toBeNull();
    expect(
      normalizeBroadcastParticipantGroundingCellReceipt(
        { ...voice, modelRevision: "voice-model-spoofed-v1" },
        plan,
      ),
    ).toBeNull();
  });

  it("enables explicitly bounded partial voice coverage without claiming missing roster members", async () => {
    const allParticipantIds = candidatePassBCastReferences(
      DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
    ).map(({ participantId }) => participantId);
    const partialManifest = enrollmentManifest(
      "eligible",
      allParticipantIds.slice(0, -1),
    );
    const partialPlan = await createBroadcastParticipantGroundingPlan(
      planInput({ voiceManifest: partialManifest }),
    );
    expect(partialPlan.adapters[2]).toMatchObject({
      availability: "enabled",
      unavailableReason: null,
      coveredParticipantIds: allParticipantIds.slice(0, -1),
      missingParticipantIds: [allParticipantIds.at(-1)],
      voiceRecognitionPolicy: {
        decisionMode: "open-set-with-abstention",
        unknownParticipantId: "unknown",
        belowAbsoluteThresholdOutcome: "unidentified",
        belowTop1Top2MarginOutcome: "unidentified",
        missingCoverageOutcome: "unidentified",
        minimumTop1Top2Margin: 0.08,
      },
    });
    expect(partialPlan.adapters[2].cells).toHaveLength(1);
    expect(
      sealBroadcastParticipantGroundingPlan(
        partialPlan,
        terminalReceipts(partialPlan),
      ).adapterReceipts[2],
    ).toMatchObject({
      adapter: "voice-identity",
      status: "completed",
      coveredParticipantIds: allParticipantIds.slice(0, -1),
      missingParticipantIds: [allParticipantIds.at(-1)],
      voiceRecognitionPolicy: {
        decisionMode: "open-set-with-abstention",
      },
    });

    const completePlan = await createBroadcastParticipantGroundingPlan(
      planInput({ voiceManifest: enrollmentManifest("eligible") }),
    );
    expect(completePlan.adapters[2]).toMatchObject({
      availability: "enabled",
      unavailableReason: null,
      coveredParticipantIds: allParticipantIds,
      missingParticipantIds: [],
      voiceRecognitionPolicy: {
        absoluteMatchThresholds: allParticipantIds.map((participantId) => ({
          participantId,
          minimumNormalizedSimilarity: 0.8,
        })),
      },
    });
    expect(completePlan.adapters[2].modelRevision).toContain(
      "wavlm-xvector-test-v1",
    );
    expect(completePlan.adapters[2].cells).toHaveLength(1);
  });

  it("identifies a covered speaker only after both the absolute and top-two margins pass", async () => {
    const participantIds = candidatePassBCastReferences(
      DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
    )
      .slice(0, 3)
      .map(({ participantId }) => participantId);
    const plan = await createBroadcastParticipantGroundingPlan(
      planInput({
        voiceManifest: enrollmentManifest("eligible", participantIds),
      }),
    );
    const voice = plan.adapters[2];
    const voiceCell = cell(plan, "voice-identity");
    if (voice.availability !== "enabled") {
      throw new Error("Expected enabled voice adapter.");
    }

    const projection = projectBroadcastParticipantVoiceRecognition({
      plan,
      cellId: voiceCell.cellId,
      adapterFenceKey: voice.adapterFenceKey,
      modelRevision: voice.modelRevision,
      speechActivity: "speech",
      scores: [
        { participantId: participantIds[2]!, normalizedSimilarity: 0.7 },
        { participantId: participantIds[0]!, normalizedSimilarity: 0.93 },
        { participantId: participantIds[1]!, normalizedSimilarity: 0.71 },
      ],
    });

    expect(projection).toMatchObject({
      outcome: "identified",
      participantId: participantIds[0],
      confidence: 0.93,
      applicableAbsoluteMatchThreshold: 0.8,
      abstentionReason: null,
      coveredParticipantIds: participantIds,
      missingParticipantIds: plan.expectedParticipantIds.slice(3),
    });
    expect(projection.observedTop1Top2Margin).toBeCloseTo(0.22);
    if (projection.outcome !== "identified") {
      throw new Error("Expected an identified voice projection.");
    }
    const receipt = createBroadcastParticipantGroundingTerminalReceipt({
      plan,
      adapter: "voice-identity",
      cellId: voiceCell.cellId,
      operationId: "grounding:voice:identified",
      attemptOrdinal: 0,
      outcome: projection.outcome,
      participantIds: [projection.participantId],
      confidence: projection.confidence,
      voiceRecognition: projection,
    });
    expect(
      normalizeBroadcastParticipantGroundingCellReceipt(receipt, plan),
    ).toEqual(receipt);
  });

  it("abstains as unknown below either voice threshold instead of forcing a covered identity", async () => {
    const participantIds = candidatePassBCastReferences(
      DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
    )
      .slice(0, 3)
      .map(({ participantId }) => participantId);
    const plan = await createBroadcastParticipantGroundingPlan(
      planInput({
        voiceManifest: enrollmentManifest("eligible", participantIds),
      }),
    );
    const voice = plan.adapters[2];
    const voiceCell = cell(plan, "voice-identity");
    if (voice.availability !== "enabled") {
      throw new Error("Expected enabled voice adapter.");
    }
    const project = (
      scores: readonly {
        readonly participantId: CandidatePassBParticipantId;
        readonly normalizedSimilarity: number;
      }[],
    ) =>
      projectBroadcastParticipantVoiceRecognition({
        plan,
        cellId: voiceCell.cellId,
        adapterFenceKey: voice.adapterFenceKey,
        modelRevision: voice.modelRevision,
        speechActivity: "speech",
        scores,
      });

    expect(
      project([
        { participantId: participantIds[0]!, normalizedSimilarity: 0.79 },
        { participantId: participantIds[1]!, normalizedSimilarity: 0.5 },
        { participantId: participantIds[2]!, normalizedSimilarity: 0.4 },
      ]),
    ).toMatchObject({
      outcome: "unidentified",
      participantId: "unknown",
      confidence: null,
      abstentionReason: "below-absolute-threshold",
    });
    const ambiguousProjection = project([
      { participantId: participantIds[0]!, normalizedSimilarity: 0.92 },
      { participantId: participantIds[1]!, normalizedSimilarity: 0.88 },
      { participantId: participantIds[2]!, normalizedSimilarity: 0.4 },
    ]);
    expect(ambiguousProjection).toMatchObject({
      outcome: "unidentified",
      participantId: "unknown",
      confidence: null,
      abstentionReason: "below-top1-top2-margin",
    });
    expect(ambiguousProjection.observedTop1Top2Margin).toBeCloseTo(0.04);
  });

  it("keeps one-person coverage open-set and records no-speech without scores", async () => {
    const participantId = candidatePassBCastReferences(
      DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
    )[0]!.participantId;
    const plan = await createBroadcastParticipantGroundingPlan(
      planInput({
        voiceManifest: enrollmentManifest("eligible", [participantId]),
      }),
    );
    const voice = plan.adapters[2];
    const voiceCell = cell(plan, "voice-identity");
    if (voice.availability !== "enabled") {
      throw new Error("Expected enabled voice adapter.");
    }

    expect(
      projectBroadcastParticipantVoiceRecognition({
        plan,
        cellId: voiceCell.cellId,
        adapterFenceKey: voice.adapterFenceKey,
        modelRevision: voice.modelRevision,
        speechActivity: "speech",
        scores: [{ participantId, normalizedSimilarity: 0.99 }],
      }),
    ).toMatchObject({
      outcome: "unidentified",
      participantId: "unknown",
      abstentionReason: "insufficient-covered-comparators",
    });
    expect(
      projectBroadcastParticipantVoiceRecognition({
        plan,
        cellId: voiceCell.cellId,
        adapterFenceKey: voice.adapterFenceKey,
        modelRevision: voice.modelRevision,
        speechActivity: "no-speech",
        scores: [],
      }),
    ).toMatchObject({
      outcome: "no-speech",
      participantId: null,
      confidence: null,
      rankedMatches: [],
      abstentionReason: null,
    });
    expect(() =>
      projectBroadcastParticipantVoiceRecognition({
        plan,
        cellId: voiceCell.cellId,
        adapterFenceKey: voice.adapterFenceKey,
        modelRevision: voice.modelRevision,
        speechActivity: "no-speech",
        scores: [{ participantId, normalizedSimilarity: 0.99 }],
      }),
    ).toThrow(/cannot carry speaker similarity/u);
  });

  it("rejects incomplete score vectors, uncovered identities, and unfenced voice decisions", async () => {
    const participantIds = candidatePassBCastReferences(
      DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
    )
      .slice(0, 2)
      .map(({ participantId }) => participantId);
    const plan = await createBroadcastParticipantGroundingPlan(
      planInput({
        voiceManifest: enrollmentManifest("eligible", participantIds),
      }),
    );
    const voice = plan.adapters[2];
    const voiceCell = cell(plan, "voice-identity");
    if (voice.availability !== "enabled") {
      throw new Error("Expected enabled voice adapter.");
    }
    const base = {
      plan,
      cellId: voiceCell.cellId,
      adapterFenceKey: voice.adapterFenceKey,
      modelRevision: voice.modelRevision,
      speechActivity: "speech" as const,
    };

    expect(() =>
      projectBroadcastParticipantVoiceRecognition({
        ...base,
        scores: [
          { participantId: participantIds[0]!, normalizedSimilarity: 0.95 },
        ],
      }),
    ).toThrow(/exactly once/u);
    expect(() =>
      projectBroadcastParticipantVoiceRecognition({
        ...base,
        scores: [
          { participantId: participantIds[0]!, normalizedSimilarity: 0.95 },
          {
            participantId: "outside" as CandidatePassBParticipantId,
            normalizedSimilarity: 0.2,
          },
        ],
      }),
    ).toThrow(/exactly once/u);
    expect(() =>
      createBroadcastParticipantGroundingTerminalReceipt({
        plan,
        adapter: "voice-identity",
        cellId: voiceCell.cellId,
        operationId: "grounding:voice:manual-bypass",
        attemptOrdinal: 0,
        outcome: "identified",
        participantIds: [participantIds[0]!],
        confidence: 0.99,
      }),
    ).toThrow(/policy-projected/u);
  });

  it("requires a threshold for every covered voice participant and fingerprints policy changes", async () => {
    const participantIds = candidatePassBCastReferences(
      DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
    )
      .slice(0, 2)
      .map(({ participantId }) => participantId);
    const valid = planInput({
      voiceManifest: enrollmentManifest("eligible", participantIds),
    });
    await expect(
      createBroadcastParticipantGroundingPlan({
        ...valid,
        voice: {
          ...valid.voice,
          recognitionPolicy: null,
        },
      }),
    ).rejects.toThrow(/explicit open-set recognition policy/u);
    await expect(
      createBroadcastParticipantGroundingPlan({
        ...valid,
        voice: {
          ...valid.voice,
          recognitionPolicy: {
            ...valid.voice.recognitionPolicy!,
            absoluteMatchThresholds:
              valid.voice.recognitionPolicy!.absoluteMatchThresholds.slice(
                0,
                1,
              ),
          },
        },
      }),
    ).rejects.toThrow(/exactly once/u);

    const stricter: CreateBroadcastParticipantGroundingPlanInput = {
      ...valid,
      voice: {
        ...valid.voice,
        recognitionPolicy: {
          ...valid.voice.recognitionPolicy!,
          absoluteMatchThresholds:
            valid.voice.recognitionPolicy!.absoluteMatchThresholds.map(
              (threshold, ordinal) =>
                ordinal === 0
                  ? { ...threshold, minimumNormalizedSimilarity: 0.9 }
                  : threshold,
            ),
        },
      },
    };
    const [baselinePlan, stricterPlan] = await Promise.all([
      createBroadcastParticipantGroundingPlan(valid),
      createBroadcastParticipantGroundingPlan(stricter),
    ]);
    expect(stricterPlan.adapters[2].adapterFenceKey).not.toBe(
      baselinePlan.adapters[2].adapterFenceKey,
    );
    expect(stricterPlan.planFingerprint).not.toBe(baselinePlan.planFingerprint);
  });

  it("shares exact source-fenced bundle keys with post-context candidate confirmation", async () => {
    const plan = await createBroadcastParticipantGroundingPlan(
      planInput({
        visualEnabled: true,
        voiceManifest: enrollmentManifest("eligible"),
      }),
    );
    const visualCell = cell(plan, "visual-identity");
    const candidateKeys = createBroadcastParticipantMediaBundleReuseKeys({
      sourceFingerprint: SOURCE_FINGERPRINT,
      sourceDurationMs: SOURCE_DURATION_MS,
      sourceStartMs: visualCell.sourceStartMs,
      sourceEndMs: visualCell.sourceEndMs,
      frameTimestampsMs: visualCell.frameTimestampsMs,
    });

    expect(candidateKeys).toEqual(visualCell.bundleReuse);
    expect(plan.bundleReuseIndex.frameBundleReuseKeys).toContain(
      candidateKeys.frameBundleReuseKey,
    );
    expect(
      createBroadcastParticipantMediaBundleReuseKeys({
        sourceFingerprint: SOURCE_FINGERPRINT,
        sourceDurationMs: SOURCE_DURATION_MS,
        sourceStartMs: visualCell.sourceStartMs,
        sourceEndMs: visualCell.sourceEndMs,
        frameTimestampsMs: [21_000, 23_000, 26_000, 28_999],
      }).frameBundleReuseKey,
    ).not.toBe(candidateKeys.frameBundleReuseKey);

    const sealed = sealBroadcastParticipantGroundingPlan(
      plan,
      terminalReceipts(plan),
    );
    expect(sealed.terminalCells).toHaveLength(4);
    expect(sealed.bundleReuseIndex).toEqual(plan.bundleReuseIndex);
  });

  it("separates retryable and outcome-unknown gaps and blocks both before context", async () => {
    const plan = await createBroadcastParticipantGroundingPlan(planInput());
    const first = cell(plan, "transcript-names", 0);
    const second = cell(plan, "transcript-names", 1);
    const retryable = createBroadcastParticipantGroundingGapReceipt({
      plan,
      adapter: "transcript-names",
      cellId: first.cellId,
      operationId: "grounding:retryable:1",
      attemptOrdinal: 1,
      disposition: "retryable",
      reason: "inference-failed",
    });
    const outcomeUnknown = createBroadcastParticipantGroundingGapReceipt({
      plan,
      adapter: "transcript-names",
      cellId: second.cellId,
      operationId: "grounding:unknown:1",
      attemptOrdinal: 1,
      disposition: "outcome-unknown",
      reason: "operation-interrupted",
    });

    expect(
      inspectBroadcastParticipantGroundingPlanCompletion(plan, [
        retryable,
        outcomeUnknown,
      ]),
    ).toEqual({
      planFingerprint: plan.planFingerprint,
      plannedCellCount: 2,
      terminalCellCount: 0,
      requiredNoneObservedAdapterCount: 2,
      terminalNoneObservedAdapterCount: 0,
      missingCellIds: [],
      missingNoneObservedAdapters: ["visual-identity", "voice-identity"],
      retryableCellIds: [first.cellId],
      outcomeUnknownCellIds: [second.cellId],
      readyToSeal: false,
    });
    expect(() =>
      sealBroadcastParticipantGroundingPlan(plan, [retryable, outcomeUnknown]),
    ).toThrow(/must be terminal/u);
  });

  it("does not confuse a missing receipt with a successful none result", async () => {
    const plan = await createBroadcastParticipantGroundingPlan(planInput());
    const firstOnly = terminalReceipts(plan).slice(0, 1);
    const inspection = inspectBroadcastParticipantGroundingPlanCompletion(
      plan,
      firstOnly,
    );

    expect(inspection.terminalCellCount).toBe(1);
    expect(inspection.missingCellIds).toEqual([
      cell(plan, "transcript-names", 1).cellId,
    ]);
    expect(inspection.readyToSeal).toBe(false);
    expect(() =>
      sealBroadcastParticipantGroundingPlan(plan, firstOnly),
    ).toThrow(BroadcastParticipantGroundingPlanContractError);
  });

  it("rejects receipts whose source, model/manifest, or plan fence changed", async () => {
    const plan = await createBroadcastParticipantGroundingPlan(planInput());
    const receipt = terminalReceipts(plan)[0];
    if (receipt === undefined) throw new Error("Missing receipt fixture.");

    expect(
      normalizeBroadcastParticipantGroundingCellReceipt(
        {
          ...receipt,
          sourceFingerprint: `sha256:${"c".repeat(64)}`,
        },
        plan,
      ),
    ).toBeNull();
    expect(
      normalizeBroadcastParticipantGroundingCellReceipt(
        {
          ...receipt,
          adapterFenceKey: `sha256:${"d".repeat(64)}`,
        },
        plan,
      ),
    ).toBeNull();
    expect(
      normalizeBroadcastParticipantGroundingCellReceipt(
        {
          ...receipt,
          planFingerprint: `sha256:${"e".repeat(64)}`,
        },
        plan,
      ),
    ).toBeNull();
    expect(() =>
      inspectBroadcastParticipantGroundingPlanCompletion(plan, [
        { ...receipt, sourceFingerprint: `sha256:${"c".repeat(64)}` },
      ]),
    ).toThrow(/source\/model\/manifest\/range fence/u);
  });

  it("requires identified cells to carry only source-roster participants and confidence", async () => {
    const plan = await createBroadcastParticipantGroundingPlan(
      planInput({ visualEnabled: true }),
    );
    const visual = cell(plan, "visual-identity");

    expect(() =>
      createBroadcastParticipantGroundingTerminalReceipt({
        plan,
        adapter: "visual-identity",
        cellId: visual.cellId,
        operationId: "grounding:visual:no-person",
        attemptOrdinal: 0,
        outcome: "identified",
      }),
    ).toThrow(/carry participants/u);
    expect(() =>
      createBroadcastParticipantGroundingTerminalReceipt({
        plan,
        adapter: "visual-identity",
        cellId: visual.cellId,
        operationId: "grounding:visual:unknown-person",
        attemptOrdinal: 0,
        outcome: "identified",
        participantIds: ["outside"] as unknown as CandidatePassBParticipantId[],
        confidence: 0.9,
      }),
    ).toThrow(/unknown or duplicate/u);
    expect(() =>
      createBroadcastParticipantGroundingTerminalReceipt({
        plan,
        adapter: "visual-identity",
        cellId: visual.cellId,
        operationId: "grounding:visual:none-with-person",
        attemptOrdinal: 0,
        outcome: "none",
        participantIds: ["amoretto"],
      }),
    ).toThrow(/carry participants/u);
  });

  it("rejects terminal outcomes that do not belong to the adapter modality", async () => {
    const plan = await createBroadcastParticipantGroundingPlan(
      planInput({
        visualEnabled: true,
        voiceManifest: enrollmentManifest("eligible"),
      }),
    );

    expect(() =>
      createBroadcastParticipantGroundingTerminalReceipt({
        plan,
        adapter: "transcript-names",
        cellId: cell(plan, "transcript-names").cellId,
        operationId: "grounding:transcript:nonsensical",
        attemptOrdinal: 0,
        outcome: "no-speech",
      }),
    ).toThrowError(BroadcastParticipantGroundingPlanContractError);
    expect(() =>
      createBroadcastParticipantGroundingTerminalReceipt({
        plan,
        adapter: "visual-identity",
        cellId: cell(plan, "visual-identity").cellId,
        operationId: "grounding:visual:nonsensical",
        attemptOrdinal: 0,
        outcome: "no-speech",
      }),
    ).toThrowError(BroadcastParticipantGroundingPlanContractError);
    expect(() =>
      createBroadcastParticipantGroundingTerminalReceipt({
        plan,
        adapter: "voice-identity",
        cellId: cell(plan, "voice-identity").cellId,
        operationId: "grounding:voice:nonsensical",
        attemptOrdinal: 0,
        outcome: "none",
      }),
    ).toThrowError(BroadcastParticipantGroundingPlanContractError);
  });

  it("rejects duplicate cell receipts and reused operation identities", async () => {
    const plan = await createBroadcastParticipantGroundingPlan(planInput());
    const receipts = terminalReceipts(plan);
    const first = receipts[0];
    const second = receipts[1];
    if (first === undefined || second === undefined) {
      throw new Error("Missing duplicate receipt fixture.");
    }

    expect(() =>
      inspectBroadcastParticipantGroundingPlanCompletion(plan, [first, first]),
    ).toThrow(/more than one current receipt/u);
    expect(() =>
      inspectBroadcastParticipantGroundingPlanCompletion(plan, [
        first,
        { ...second, operationId: first.operationId },
      ]),
    ).toThrow(/operation identity was reused/u);
  });

  it("canonicalizes cell order and produces the same plan fingerprint", async () => {
    const forward = planInput({
      visualEnabled: true,
      voiceManifest: enrollmentManifest("eligible"),
    });
    const reverse: CreateBroadcastParticipantGroundingPlanInput = {
      ...forward,
      transcript: {
        ...forward.transcript,
        cells: [...forward.transcript.cells].reverse(),
      },
      visual: {
        ...forward.visual,
        referenceParticipantIds: [
          ...forward.visual.referenceParticipantIds,
        ].reverse(),
      },
      voice: {
        ...forward.voice,
        enrollmentManifest: {
          ...forward.voice.enrollmentManifest!,
          assets: [...forward.voice.enrollmentManifest!.assets].reverse(),
        },
        recognitionPolicy: {
          ...forward.voice.recognitionPolicy!,
          absoluteMatchThresholds: [
            ...forward.voice.recognitionPolicy!.absoluteMatchThresholds,
          ].reverse(),
        },
      },
    };

    const [left, right] = await Promise.all([
      createBroadcastParticipantGroundingPlan(forward),
      createBroadcastParticipantGroundingPlan(reverse),
    ]);
    expect(right.planFingerprint).toBe(left.planFingerprint);
    expect(right).toEqual(left);
  });

  it("requires four distinct source-fenced visual frames", async () => {
    const input = planInput({ visualEnabled: true });
    await expect(
      createBroadcastParticipantGroundingPlan({
        ...input,
        visual: {
          ...input.visual,
          cells: [
            {
              ...input.visual.cells[0]!,
              frameTimestampsMs: [21_000, 23_000, 23_000, 29_000],
            },
          ],
        },
      }),
    ).rejects.toThrow(/four distinct/u);
  });

  it("does not admit a receipt for an explicitly unavailable adapter", async () => {
    const plan = await createBroadcastParticipantGroundingPlan(
      planInput({ voiceManifest: enrollmentManifest("pending") }),
    );

    expect(() =>
      createBroadcastParticipantGroundingGapReceipt({
        plan,
        adapter: "voice-identity",
        cellId: "voice-identity:cell-1:fk0-n5c",
        operationId: "grounding:voice:should-not-run",
        attemptOrdinal: 0,
        disposition: "retryable",
        reason: "runtime-unavailable",
      }),
    ).toThrow(/does not name an enabled cell/u);
  });

  it("replays only a byte-canonical current plan and rejects every stored hash or cell drift", async () => {
    const plan = await createBroadcastParticipantGroundingPlan(
      planInput({
        visualEnabled: true,
        voiceManifest: enrollmentManifest("eligible"),
      }),
    );

    await expect(
      normalizeBroadcastParticipantGroundingPlan(plan),
    ).resolves.toEqual(plan);

    const tamperedPlanFingerprint = structuredClone(plan);
    (
      tamperedPlanFingerprint as unknown as {
        planFingerprint: string;
      }
    ).planFingerprint = `sha256:${"f".repeat(64)}`;
    await expect(
      normalizeBroadcastParticipantGroundingPlan(tamperedPlanFingerprint),
    ).resolves.toBeNull();

    const tamperedAdapterFence = structuredClone(plan);
    (
      tamperedAdapterFence.adapters[1] as unknown as {
        adapterFenceKey: string;
      }
    ).adapterFenceKey = `sha256:${"e".repeat(64)}`;
    await expect(
      normalizeBroadcastParticipantGroundingPlan(tamperedAdapterFence),
    ).resolves.toBeNull();

    const tamperedFrame = structuredClone(plan);
    (
      tamperedFrame.adapters[1].cells[0] as unknown as {
        frameTimestampsMs: number[];
      }
    ).frameTimestampsMs[1] = 24_000;
    await expect(
      normalizeBroadcastParticipantGroundingPlan(tamperedFrame),
    ).resolves.toBeNull();

    const tamperedSourceUnit = structuredClone(plan);
    (
      tamperedSourceUnit.adapters[0].cells[0] as unknown as {
        sourceUnitId: string;
      }
    ).sourceUnitId = "chapter-spoofed";
    await expect(
      normalizeBroadcastParticipantGroundingPlan(tamperedSourceUnit),
    ).resolves.toBeNull();
  });
});
