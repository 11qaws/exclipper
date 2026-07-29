import { describe, expect, it } from "vitest";
import {
  BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
  MAX_CONTEXT_PHASE_LEDGER_CHECKPOINT_BYTES,
  assertBroadcastContextSessionRecord,
  checkpointBroadcastContextSessionPhaseLedger,
  checkpointBroadcastContextSessionRefinementEvidenceLedger,
  checkpointBroadcastContextSessionRefinementTranscript,
  checkpointBroadcastContextSessionTranscript,
  checkpointBroadcastContextSessionVisualInspection,
  cloneBroadcastContextSessionRecord,
  commitBroadcastContextSessionContext,
  createBroadcastParticipantGroundingInputSignature,
  invalidateBroadcastContextSessionContext,
  partitionBroadcastContextSessionChapters,
  parseBroadcastParticipantPreContextCheckpointJson,
  parseBroadcastContextSessionRefinementEvidenceLedger,
  reconcileBroadcastContextSessionRefinementEvidenceLifecycle,
  restoreBroadcastParticipantPreContextCheckpoint,
  serializeBroadcastParticipantPreContextCheckpoint,
  type BroadcastContextSessionRecord,
} from "./broadcastContextSessionStore";
import {
  completeBroadcastParticipantPreContext,
  orchestrateBroadcastParticipantPreContext,
  prepareBroadcastParticipantPreContext,
} from "../analysis/broadcastParticipantPreContextOrchestration";
import {
  createBroadcastParticipantGrounding,
  rebaseBroadcastParticipantGrounding,
} from "../analysis/broadcastParticipantGrounding";
import { createBroadcastParticipantGroundingNoneObservedReceipt } from "../analysis/broadcastParticipantGroundingPlan";
import { compactBroadcastContextChapters } from "../analysis/broadcastContextChapterCompaction";
import { createBroadcastContextRequest } from "../analysis/broadcastContextProtocol";
import { DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID } from "../analysis/participantRoster";
import {
  createBroadcastContextPhaseLedger,
  reduceBroadcastContextPhaseLedger,
  serializeBroadcastContextPhaseLedger,
  type BroadcastContextPhaseLedger,
  type BroadcastContextPhaseLedgerFence,
} from "../analysis/broadcastContextPhaseLedger";
import {
  createBroadcastRefinementTranscriptCheckpoint,
  recordBroadcastRefinementTranscriptAbstention,
  recordBroadcastRefinementTranscriptSuccess,
  serializeBroadcastRefinementTranscriptCheckpoint,
} from "../analysis/broadcastRefinementTranscriptCheckpoint";
import { createVerifiedNoSpeechRunReceiptForTest } from "../testSupport/broadcastSpeechActivityTestReceipt";
import {
  createBroadcastTranscriptResolvedEvidenceCheckpoint,
  parseBroadcastTranscriptResolvedEvidenceCheckpointJson,
  rebaseBroadcastTranscriptResolvedEvidenceModelRevision,
  recordBroadcastTranscriptResolvedEvidence,
  serializeBroadcastTranscriptResolvedEvidenceCheckpoint,
} from "../analysis/broadcastTranscriptResolvedEvidence";
import {
  BROADCAST_TRANSCRIPT_VISUAL_AUDIO_EXTRACTION_REVISION,
  createBroadcastTranscriptVisualInspectionPlan,
  createBroadcastTranscriptVisualPreparedFrameReceipt,
  createBroadcastTranscriptVisualProviderSettlement,
  createBroadcastTranscriptVisualProviderSettlementLedger,
  recordBroadcastTranscriptVisualProviderSettlement,
} from "../analysis/broadcastTranscriptVisualInspectionQueue";
import { createBroadcastTranscriptVisualInspectionRunnerCheckpoint } from "../analysis/broadcastTranscriptVisualInspectionRunner";
import { serializeBroadcastTranscriptVisualInspectionRunnerCheckpoint } from "../analysis/broadcastTranscriptVisualContextProjection";
import {
  broadcastTranscriptProviderReceiptCheckpointModelRevision,
  createBroadcastTranscriptProviderReceiptCheckpoint,
  recordBroadcastTranscriptProviderReceipt,
  serializeBroadcastTranscriptProviderReceiptCheckpoint,
} from "../analysis/broadcastTranscriptProviderReceiptCheckpoint";
import {
  createBroadcastTranscriptProviderReceipt,
  createBroadcastTranscriptRouteSelection,
  type BroadcastTranscriptRouteManifest,
} from "../analysis/broadcastTranscriptRouteManifest";
import {
  BROADCAST_TRANSCRIPT_GEMINI_MODEL_ID,
  BROADCAST_TRANSCRIPT_GEMINI_MODEL_REVISION,
  BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
  BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
  BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION,
} from "../analysis/broadcastTranscriptQwen";
import {
  activateBroadcastRefinementEvidenceRoute,
  appendBroadcastRefinementEvidenceRouteEntry,
  createBroadcastRefinementEvidenceLedger,
  MAX_BROADCAST_REFINEMENT_EVIDENCE_LEDGER_BYTES,
  serializeBroadcastRefinementEvidenceLedger,
} from "../analysis/broadcastRefinementEvidenceLedger";
import { DISCOVERED_LEAD_REFINEMENT_VERSION } from "../analysis/discoveredLeadRefinement";
import { YOUTUBE_CAPTION_MODEL_REVISION } from "../analysis/youtubeCaptionTrack";
import { inspectCurrentTranscriptCheckpoint } from "../app/analysisPipelineSuccess";
import {
  createCurrentProviderTranscriptSourceIdentityFence,
  transcriptOperationKey,
} from "../app/transcriptPhase";

const record: BroadcastContextSessionRecord = {
  kind: "broadcastContextSession",
  runId: "run-1",
  schemaVersion: BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
  inputSignature: `sha256:${"a".repeat(64)}`,
  sourceDurationMs: 300_000,
  completeAudioCoverage: true,
  chapters: [
    {
      chapterId: "transcript-001",
      startMs: 0,
      endMs: 300_000,
      evidenceMode: "complete-transcript",
      evidenceCoverageRatio: 1,
      summaryKo: "방송에서 음식 이야기를 나눈다.",
    },
  ],
  gapChunkIds: [],
  fragmentGaps: [],
  transcriptEvidenceInputSignature: null,
  transcriptEvidenceCheckpointJson: null,
  transcriptVisualInspectionCheckpointJson: null,
  transcriptProviderReceiptInputSignature: null,
  transcriptProviderReceiptCheckpointJson: null,
  modelRevision:
    "qwen3.5-omni-flash-audio-transcript-90s-reviewed-2026-07-22",
  sourceCastRosterId: null,
  transcriptSealOperationKey: null,
  participantGroundingInputSignature: null,
  participantGroundingPlanFingerprint: null,
  participantGroundingCheckpointJson: null,
  contextInputSignature: null,
  contextInputCheckpointJson: null,
  contextPhaseLedgerJson: null,
  contextResultJson: null,
  refinementTranscriptInputSignature: null,
  refinementTranscriptCheckpointJson: null,
  refinementEvidenceLedgerJson: null,
  refinementInputSignature: null,
  refinementCandidatesJson: null,
  recordedAt: "2026-07-22T04:00:00.000Z",
};

const completedTranscriptSeal =
  "run-1:source:event-boost:attempt-0";
const completedParticipantPreContext =
  await orchestrateBroadcastParticipantPreContext({
    sourceFingerprint: record.inputSignature,
    sourceDurationMs: record.sourceDurationMs,
    transcriptSeal: completedTranscriptSeal,
    castRosterId: record.sourceCastRosterId,
    dialogueChapters: record.chapters,
    transcriptModelRevision: record.modelRevision,
  });
const completedParticipantCheckpointJson =
  await serializeBroadcastParticipantPreContextCheckpoint(
    completedParticipantPreContext,
    {
      sourceDurationMs: record.sourceDurationMs,
      sourceCastRosterId: record.sourceCastRosterId,
      transcriptSealOperationKey: completedTranscriptSeal,
      dialogueChapters: record.chapters,
      participantGroundingPlanFingerprint:
        completedParticipantPreContext.planFingerprint,
    },
  );

async function participantCheckpointForSession(
  value: Pick<
    BroadcastContextSessionRecord,
    | "inputSignature"
    | "sourceDurationMs"
    | "sourceCastRosterId"
    | "transcriptSealOperationKey"
    | "modelRevision"
  >,
  dialogueChapters: readonly BroadcastContextSessionRecord["chapters"][number][],
) {
  if (value.transcriptSealOperationKey === null) {
    throw new TypeError("The test participant checkpoint requires a transcript seal.");
  }
  const prepared = await prepareBroadcastParticipantPreContext({
    sourceFingerprint: value.inputSignature,
    sourceDurationMs: value.sourceDurationMs,
    transcriptSeal: value.transcriptSealOperationKey,
    castRosterId: value.sourceCastRosterId,
    dialogueChapters,
    transcriptModelRevision: value.modelRevision,
  });
  const unavailableReceipts = prepared.plan.adapters.flatMap((adapter) =>
    adapter.adapter === "transcript-names" ||
    adapter.availability !== "unavailable" ||
    prepared.plan.expectedParticipantIds.length === 0
      ? []
      : [
          createBroadcastParticipantGroundingNoneObservedReceipt({
            plan: prepared.plan,
            adapter: adapter.adapter,
            operationId: `test.${adapter.adapter}.none-observed`,
            attemptOrdinal: 0,
          }),
        ],
  );
  const result = completeBroadcastParticipantPreContext(prepared, {
    visualNoneObservedReceipt: unavailableReceipts.find(
      ({ adapter }) => adapter === "visual-identity",
    ),
    voiceNoneObservedReceipt: unavailableReceipts.find(
      ({ adapter }) => adapter === "voice-identity",
    ),
  });
  return {
    result,
    checkpointJson:
      await serializeBroadcastParticipantPreContextCheckpoint(result, {
        sourceDurationMs: value.sourceDurationMs,
        sourceCastRosterId: value.sourceCastRosterId,
        transcriptSealOperationKey: value.transcriptSealOperationKey,
        dialogueChapters,
        participantGroundingPlanFingerprint: result.planFingerprint,
      }),
  };
}

function completedContextRecord(): BroadcastContextSessionRecord {
  const participantGrounding = completedParticipantPreContext.grounding;
  return {
    ...record,
    transcriptSealOperationKey: completedTranscriptSeal,
    participantGroundingInputSignature: "participant-signature",
    participantGroundingPlanFingerprint:
      completedParticipantPreContext.planFingerprint,
    participantGroundingCheckpointJson:
      completedParticipantCheckpointJson,
    contextInputSignature: "context-signature-v1",
    contextInputCheckpointJson: JSON.stringify({
      sourceDurationMs: record.sourceDurationMs,
      chapters: record.chapters,
      candidates: [],
      participantGrounding,
      castRosterId: record.sourceCastRosterId,
      outputLanguage: "ko",
    }),
    contextResultJson: JSON.stringify({ schemaVersion: "1.7.0" }),
    refinementInputSignature: "refinement-signature-v1",
    refinementCandidatesJson: "[]",
  };
}

function refinementTranscriptCheckpointJson(
  refinementInputSignature = "refinement-transcript-signature-v1",
): string {
  const plannedChunks = [
    {
      chunkId: "refine-001",
      sourceStartMs: 60_000,
      sourceEndMs: 120_000,
      kind: "event" as const,
    },
    {
      chunkId: "refine-002",
      sourceStartMs: 180_000,
      sourceEndMs: 240_000,
      kind: "event" as const,
    },
  ];
  let checkpoint = createBroadcastRefinementTranscriptCheckpoint({
    refinementInputSignature,
    plannedChunks,
  });
  checkpoint = recordBroadcastRefinementTranscriptSuccess(
    checkpoint,
    "refine-001",
    {
      schemaVersion: BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION,
      modelId: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
      modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
      providerReceipt: {
        schemaVersion: "1.0.0",
        routeManifestFingerprint: `sha256:${"1".repeat(64)}`,
        provider: "qwen",
        modelId: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
        modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
        fallbackUsed: false,
      },
      sourceStartMs: 60_000,
      sourceEndMs: 120_000,
      textKo: "스트리머가 음식 이야기를 이어간다.",
      detectedLanguage: "ko",
      emotion: null,
      billedSeconds: 60,
    },
  );
  checkpoint = recordBroadcastRefinementTranscriptAbstention(
    checkpoint,
    "refine-002",
    "no-speech",
    createVerifiedNoSpeechRunReceiptForTest(
      record.sourceDurationMs,
      180_000,
      240_000,
    ),
  );
  return serializeBroadcastRefinementTranscriptCheckpoint(checkpoint);
}

function transcriptEvidenceCheckpointJson(
  transcriptInputSignature = "transcript-plan-signature-v1",
  reason: "no-audio" | "no-speech" = "no-speech",
): string {
  let checkpoint =
    createBroadcastTranscriptResolvedEvidenceCheckpoint({
      sourceFingerprint: record.inputSignature,
      sourceDurationMs: record.sourceDurationMs,
      transcriptInputSignature,
      modelRevision: record.modelRevision,
      plannedCells: [
        {
          chunkId: "asr-001",
          sourceStartMs: 0,
          sourceEndMs: record.sourceDurationMs,
        },
      ],
    });
  checkpoint =
    reason === "no-audio"
      ? recordBroadcastTranscriptResolvedEvidence(
          checkpoint,
          "asr-001",
          "no-audio",
          null,
        )
      : recordBroadcastTranscriptResolvedEvidence(
          checkpoint,
          "asr-001",
          "no-speech",
          createVerifiedNoSpeechRunReceiptForTest(
            record.sourceDurationMs,
            0,
            record.sourceDurationMs,
          ),
        );
  return serializeBroadcastTranscriptResolvedEvidenceCheckpoint(checkpoint);
}

function visualInspectionSession(): BroadcastContextSessionRecord {
  const transcriptInputSignature = "transcript-visual-plan-v1";
  return cloneBroadcastContextSessionRecord({
    ...record,
    chapters: [],
    transcriptEvidenceInputSignature: transcriptInputSignature,
    transcriptEvidenceCheckpointJson: transcriptEvidenceCheckpointJson(
      transcriptInputSignature,
    ),
    transcriptSealOperationKey: transcriptInputSignature,
  });
}

function visualInspectionRunnerCheckpointJson(
  terminal: boolean,
  session = visualInspectionSession(),
): string {
  const evidence = parseBroadcastTranscriptResolvedEvidenceCheckpointJson(
    session.transcriptEvidenceCheckpointJson!,
  );
  if (evidence === null) throw new TypeError("Test evidence must be current.");
  const plan = createBroadcastTranscriptVisualInspectionPlan(evidence);
  if (!terminal) {
    return serializeBroadcastTranscriptVisualInspectionRunnerCheckpoint(
      createBroadcastTranscriptVisualInspectionRunnerCheckpoint({ plan }),
      plan,
    );
  }
  const receipt = createBroadcastTranscriptVisualPreparedFrameReceipt({
    plan,
    cellId: "visual:asr-001",
    frameContentFingerprints: [
      `sha256:${"1".repeat(64)}`,
      `sha256:${"2".repeat(64)}`,
      `sha256:${"3".repeat(64)}`,
      `sha256:${"4".repeat(64)}`,
    ],
    audioEvidence: {
      sourceStartMs: 0,
      sourceEndMs: session.sourceDurationMs,
      codec: "audio/wav;codecs=pcm_s16le",
      extractionRevision:
        BROADCAST_TRANSCRIPT_VISUAL_AUDIO_EXTRACTION_REVISION,
      contentFingerprint: `sha256:${"5".repeat(64)}`,
    },
  });
  const providerLedger = recordBroadcastTranscriptVisualProviderSettlement(
    createBroadcastTranscriptVisualProviderSettlementLedger(plan),
    plan,
    createBroadcastTranscriptVisualProviderSettlement({
      plan,
      cellId: "visual:asr-001",
      preparedFrameReceipt: receipt,
      providerModelRevision: "qwen-omni-visual-v1",
      operationId: "visual-operation-1",
      attemptOrdinal: 0,
      outcome: "completed",
      editorialFinding: "quiet-success",
      summaryKo: "네 화면에서 조용한 성공 장면을 확인했다.",
      providerResponseFingerprint: `sha256:${"a".repeat(64)}`,
      participantOutcome: {
        presence: "none-present",
        summaryKo: "등장인물이 확인되지 않았습니다.",
        participants: [],
      },
    }),
  );
  return serializeBroadcastTranscriptVisualInspectionRunnerCheckpoint(
    createBroadcastTranscriptVisualInspectionRunnerCheckpoint({
      plan,
      preparedFrameReceipts: [receipt],
      providerLedger,
    }),
    plan,
  );
}

function contextPhaseLedgerJson(
  value: BroadcastContextSessionRecord,
  fenceOverrides: Partial<BroadcastContextPhaseLedgerFence> = {},
): string {
  if (
    value.contextInputSignature === null ||
    value.transcriptSealOperationKey === null ||
    value.participantGroundingInputSignature === null
  ) {
    throw new TypeError("The test session must have complete ledger fences.");
  }
  return serializeBroadcastContextPhaseLedger(
    createBroadcastContextPhaseLedger({
      fence: {
        parentContextSignature: value.contextInputSignature,
        transcriptSignature: value.transcriptSealOperationKey,
        groundingSignature: value.participantGroundingInputSignature,
        ...fenceOverrides,
      },
      units: [
        {
          phase: "discovery",
          unitId: "chapter-1",
          inputDigest: "digest-1",
          operationId: "operation-1",
          attemptOrdinal: 0,
          required: true,
        },
      ],
    }),
  );
}

async function refinementEvidenceLedgerJson(
  captionText = "칼국수 이야기를 시작했다.",
): Promise<string> {
  const selectedLeadPlan = {
    version: DISCOVERED_LEAD_REFINEMENT_VERSION,
    selectedLeadIds: ["lead-food"],
    segments: [
      {
        segmentId: "refine-001",
        leadId: "lead-food",
        sourceStartMs: 60_000,
        sourceEndMs: 120_000,
      },
    ],
    estimatedAsrCostUsd: 0,
  } as const;
  let ledger = await createBroadcastRefinementEvidenceLedger({
    sourceFingerprint: record.inputSignature,
    sourceDurationMs: record.sourceDurationMs,
    selectedLeadPlan,
  });
  const appended = await appendBroadcastRefinementEvidenceRouteEntry(
    ledger,
    ledger.ledgerFingerprint,
    {
      sourceFingerprint: record.inputSignature,
      sourceDurationMs: record.sourceDurationMs,
      selectedLeadPlan,
      routeKind: "youtube-caption",
      captionRevision: YOUTUBE_CAPTION_MODEL_REVISION,
      captionTrack: {
        videoId: "KzAW3yow80Q",
        languageCode: "ko",
        isAutoGenerated: true,
        events: [
          {
            startMs: 70_000,
            durationMs: 5_000,
            text: captionText,
          },
        ],
      },
      verifiedNoSpeechEvidence: [],
    },
  );
  ledger = await activateBroadcastRefinementEvidenceRoute(
    appended.ledger,
    appended.ledger.ledgerFingerprint,
    appended.routeEntryFingerprint,
  );
  return serializeBroadcastRefinementEvidenceLedger(ledger);
}

function refinementPhaseLedgerJson(
  value: BroadcastContextSessionRecord,
  status: "pending" | "in-flight" | "succeeded",
): string {
  if (
    value.contextInputSignature === null ||
    value.transcriptSealOperationKey === null ||
    value.participantGroundingInputSignature === null
  ) {
    throw new TypeError("The test session must have exact context parents.");
  }
  const fence = {
    parentContextSignature: value.contextInputSignature,
    transcriptSignature: value.transcriptSealOperationKey,
    groundingSignature: value.participantGroundingInputSignature,
  };
  const unit = {
    phase: "refinement" as const,
    unitId: "lead-food",
    inputDigest: "refinement-input-v1",
    operationId: "refinement-operation-v1",
    attemptOrdinal: 0,
  };
  const identity = { fence, ...unit };
  let ledger = createBroadcastContextPhaseLedger({
    fence,
    units: [{ ...unit, required: true }],
  });
  if (status === "in-flight" || status === "succeeded") {
    const started = reduceBroadcastContextPhaseLedger(ledger, {
      ...identity,
      type: "UNIT_STARTED",
    });
    if (!started.accepted) throw new TypeError("Refinement start was rejected.");
    ledger = started.ledger;
  }
  if (status === "succeeded") {
    const succeeded = reduceBroadcastContextPhaseLedger(ledger, {
      ...identity,
      type: "UNIT_SUCCEEDED",
      result: { candidateIds: [] },
      modelReceipt: { modelRevision: "refinement-model-v1" },
    });
    if (!succeeded.accepted) {
      throw new TypeError("Refinement success was rejected.");
    }
    ledger = succeeded.ledger;
  }
  return serializeBroadcastContextPhaseLedger(ledger);
}

describe("broadcastContextSessionStore", () => {
  it("binds every successful transcript chapter to an exact provider route receipt", async () => {
    const routeManifest: BroadcastTranscriptRouteManifest = {
      schemaVersion: "1.1.0",
      serviceVersion: 6,
      routingPolicyVersion: "1.11.0",
      providerConfigurationVersion: "1.3.0",
      transportVersion: 3,
      transportMode: "free-r2",
      maximumChunkDurationMs: 90_000,
      primaryMediaType: "audio/wav",
      provider: "qwen",
      modelId: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
      modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
      effectiveFallback: { mode: "disabled" },
    };
    const route = await createBroadcastTranscriptRouteSelection(routeManifest);
    const plannedCells = [
      { chunkId: "asr-001", sourceStartMs: 0, sourceEndMs: 1_000 },
      { chunkId: "asr-002", sourceStartMs: 1_000, sourceEndMs: 2_000 },
    ] as const;
    let evidence = createBroadcastTranscriptResolvedEvidenceCheckpoint({
      sourceFingerprint: record.inputSignature,
      sourceDurationMs: 2_000,
      transcriptInputSignature: "transcript-operation-v1",
      modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
      plannedCells,
    });
    evidence = recordBroadcastTranscriptResolvedEvidence(
      evidence,
      "asr-002",
      "no-speech",
      createVerifiedNoSpeechRunReceiptForTest(2_000, 1_000, 2_000),
    );
    let receipts = createBroadcastTranscriptProviderReceiptCheckpoint({
      sourceFingerprint: record.inputSignature,
      sourceDurationMs: 2_000,
      route,
      plannedCells,
    });
    const providerReceipt = createBroadcastTranscriptProviderReceipt(
      route,
      BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
      BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
      false,
    );
    receipts = recordBroadcastTranscriptProviderReceipt(
      receipts,
      "asr-001",
      {
        schemaVersion: "1.0.0",
        modelId: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
        modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
        providerReceipt,
        sourceStartMs: 0,
        sourceEndMs: 1_000,
        textKo: "스트리머가 조용히 성공했다고 말한다.",
        detectedLanguage: "ko",
        emotion: null,
        billedSeconds: 1,
      },
    );
    const receiptJson =
      serializeBroadcastTranscriptProviderReceiptCheckpoint(receipts);
    const exact: BroadcastContextSessionRecord = {
      ...record,
      sourceDurationMs: 2_000,
      completeAudioCoverage: true,
      chapters: [
        {
          chapterId: "transcript-001",
          startMs: 0,
          endMs: 1_000,
          evidenceMode: "complete-transcript",
          evidenceCoverageRatio: 1,
          summaryKo: "스트리머가 조용히 성공했다고 말한다.",
        },
      ],
      transcriptEvidenceInputSignature: "transcript-operation-v1",
      transcriptEvidenceCheckpointJson:
        serializeBroadcastTranscriptResolvedEvidenceCheckpoint(evidence),
      transcriptProviderReceiptInputSignature: route.fingerprint,
      transcriptProviderReceiptCheckpointJson: receiptJson,
      modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
      transcriptSealOperationKey: "transcript-operation-v1",
      participantGroundingInputSignature: null,
      participantGroundingCheckpointJson: null,
      contextInputSignature: null,
      contextInputCheckpointJson: null,
      contextPhaseLedgerJson: null,
      contextResultJson: null,
      refinementTranscriptInputSignature: null,
      refinementTranscriptCheckpointJson: null,
      refinementInputSignature: null,
      refinementCandidatesJson: null,
    };

    expect(() => assertBroadcastContextSessionRecord(exact)).not.toThrow();
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...exact,
        transcriptProviderReceiptCheckpointJson: receiptJson.replace(
          '"provider":"qwen"',
          '"provider":"groq"',
        ),
      }),
    ).toThrow("provider receipts");
  });

  it("clones a settled mixed-provider transcript with primary, fallback, and no-speech cells", async () => {
    const route = await createBroadcastTranscriptRouteSelection({
      schemaVersion: "1.1.0",
      serviceVersion: 6,
      routingPolicyVersion: "1.11.0",
      providerConfigurationVersion: "1.3.0",
      transportVersion: 3,
      transportMode: "paid-direct",
      maximumChunkDurationMs: 90_000,
      primaryMediaType: "audio/wav",
      provider: "qwen",
      modelId: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
      modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
      effectiveFallback: {
        mode: "bounded",
        provider: "gemini",
        modelId: BROADCAST_TRANSCRIPT_GEMINI_MODEL_ID,
        modelRevision: BROADCAST_TRANSCRIPT_GEMINI_MODEL_REVISION,
      },
    });
    const plannedCells = [
      { chunkId: "asr-001", sourceStartMs: 0, sourceEndMs: 1_000 },
      { chunkId: "asr-002", sourceStartMs: 1_000, sourceEndMs: 2_000 },
      { chunkId: "asr-003", sourceStartMs: 2_000, sourceEndMs: 3_000 },
    ] as const;
    let receipts = createBroadcastTranscriptProviderReceiptCheckpoint({
      sourceFingerprint: record.inputSignature,
      sourceDurationMs: 3_000,
      route,
      plannedCells,
    });
    const primaryReceipt = createBroadcastTranscriptProviderReceipt(
      route,
      BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
      BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
      false,
    );
    const fallbackReceipt = createBroadcastTranscriptProviderReceipt(
      route,
      BROADCAST_TRANSCRIPT_GEMINI_MODEL_ID,
      BROADCAST_TRANSCRIPT_GEMINI_MODEL_REVISION,
      true,
    );
    receipts = recordBroadcastTranscriptProviderReceipt(
      receipts,
      "asr-001",
      {
        schemaVersion: BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION,
        modelId: primaryReceipt.modelId,
        modelRevision: primaryReceipt.modelRevision,
        providerReceipt: primaryReceipt,
        sourceStartMs: 0,
        sourceEndMs: 1_000,
        textKo: "첫 번째 발화",
        detectedLanguage: "ko",
        emotion: null,
        billedSeconds: 1,
      },
    );
    receipts = recordBroadcastTranscriptProviderReceipt(
      receipts,
      "asr-002",
      {
        schemaVersion: BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION,
        modelId: fallbackReceipt.modelId,
        modelRevision: fallbackReceipt.modelRevision,
        providerReceipt: fallbackReceipt,
        sourceStartMs: 1_000,
        sourceEndMs: 2_000,
        textKo: "두 번째 발화",
        detectedLanguage: "ko",
        emotion: null,
        billedSeconds: 1,
      },
    );
    const aggregateRevision =
      broadcastTranscriptProviderReceiptCheckpointModelRevision(receipts);
    let evidence = createBroadcastTranscriptResolvedEvidenceCheckpoint({
      sourceFingerprint: record.inputSignature,
      sourceDurationMs: 3_000,
      transcriptInputSignature: "transcript-operation-mixed-v1",
      modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
      plannedCells,
    });
    evidence = recordBroadcastTranscriptResolvedEvidence(
      evidence,
      "asr-003",
      "no-speech",
      createVerifiedNoSpeechRunReceiptForTest(3_000, 2_000, 3_000),
    );
    evidence = rebaseBroadcastTranscriptResolvedEvidenceModelRevision(
      evidence,
      aggregateRevision,
    );

    const mixed: BroadcastContextSessionRecord = {
      ...record,
      sourceDurationMs: 3_000,
      completeAudioCoverage: true,
      chapters: [
        {
          chapterId: "transcript-001",
          startMs: 0,
          endMs: 1_000,
          evidenceMode: "complete-transcript",
          evidenceCoverageRatio: 1,
          summaryKo: "첫 번째 발화",
        },
        {
          chapterId: "transcript-002",
          startMs: 1_000,
          endMs: 2_000,
          evidenceMode: "complete-transcript",
          evidenceCoverageRatio: 1,
          summaryKo: "두 번째 발화",
        },
      ],
      transcriptEvidenceInputSignature: "transcript-operation-mixed-v1",
      transcriptEvidenceCheckpointJson:
        serializeBroadcastTranscriptResolvedEvidenceCheckpoint(evidence),
      transcriptProviderReceiptInputSignature: route.fingerprint,
      transcriptProviderReceiptCheckpointJson:
        serializeBroadcastTranscriptProviderReceiptCheckpoint(receipts),
      modelRevision: aggregateRevision,
      transcriptSealOperationKey: "transcript-operation-mixed-v1",
      participantGroundingInputSignature: null,
      participantGroundingCheckpointJson: null,
      contextInputSignature: null,
      contextInputCheckpointJson: null,
      contextPhaseLedgerJson: null,
      contextResultJson: null,
      refinementTranscriptInputSignature: null,
      refinementTranscriptCheckpointJson: null,
      refinementInputSignature: null,
      refinementCandidatesJson: null,
    };

    expect(aggregateRevision).toContain(
      "broadcast-transcript-mixed-v2:",
    );
    expect(cloneBroadcastContextSessionRecord(mixed)).toEqual(mixed);
  });

  it("validates and clones replayable chapter evidence", () => {
    expect(() => assertBroadcastContextSessionRecord(record)).not.toThrow();
    const cloned = cloneBroadcastContextSessionRecord(record);
    expect(cloned).toEqual(record);
    expect(cloned).not.toBe(record);
    expect(cloned.chapters).not.toBe(record.chapters);
    expect(cloned.fragmentGaps).not.toBe(record.fragmentGaps);
  });

  it("rejects transitional dual-field records instead of normalizing them", () => {
    expect(() =>
      cloneBroadcastContextSessionRecord({
        ...record,
        transcriptEvidenceByChunkId: {},
      }),
    ).toThrow("invalid");
  });

  it.each([
    "1.2.0",
    "1.3.0",
    "1.4.0",
    "1.5.0",
    "1.6.0",
    "1.7.0",
    "1.8.0",
    "1.9.0",
    "1.10.0",
    "1.11.0",
  ])(
    "rejects pre-release schema %s instead of silently migrating it",
    (schemaVersion) => {
      expect(() =>
        cloneBroadcastContextSessionRecord({
          ...record,
          schemaVersion,
        }),
      ).toThrow("invalid");
    },
  );

  it("recomputes the exact participant fence after a save and reload", async () => {
    const completed = completedContextRecord();
    const checkpointJson = completed.participantGroundingCheckpointJson;
    const transcriptSealOperationKey = completed.transcriptSealOperationKey;
    const planFingerprint = completed.participantGroundingPlanFingerprint;
    if (
      checkpointJson === null ||
      transcriptSealOperationKey === null ||
      planFingerprint === null
    ) {
      throw new TypeError("The completed test session must be fully grounded.");
    }
    const participantGroundingInputSignature =
      await createBroadcastParticipantGroundingInputSignature(
        {
          inputSignature: completed.inputSignature,
          transcriptSealOperationKey,
          participantGroundingPlanFingerprint: planFingerprint,
          participantGroundingCheckpointJson: checkpointJson,
        },
        null,
      );
    const saved = cloneBroadcastContextSessionRecord({
      ...completed,
      participantGroundingInputSignature,
    });
    const reloaded = cloneBroadcastContextSessionRecord(
      JSON.parse(JSON.stringify(saved)) as unknown,
    );
    const reloadedSignature =
      await createBroadcastParticipantGroundingInputSignature(
        {
          inputSignature: reloaded.inputSignature,
          transcriptSealOperationKey:
            reloaded.transcriptSealOperationKey as string,
          participantGroundingPlanFingerprint:
            reloaded.participantGroundingPlanFingerprint as string,
          participantGroundingCheckpointJson:
            reloaded.participantGroundingCheckpointJson as string,
        },
        null,
      );
    const changedPlanSignature =
      await createBroadcastParticipantGroundingInputSignature(
        {
          inputSignature: reloaded.inputSignature,
          transcriptSealOperationKey:
            reloaded.transcriptSealOperationKey as string,
          participantGroundingPlanFingerprint: "different-plan-fingerprint",
          participantGroundingCheckpointJson:
            reloaded.participantGroundingCheckpointJson as string,
        },
        null,
      );

    expect(reloaded.participantGroundingInputSignature).toBe(reloadedSignature);
    expect(changedPlanSignature).not.toBe(reloadedSignature);
  });

  it("round-trips only an exact source-bound participant grounding pair", async () => {
    const source = {
      ...record,
      sourceCastRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      transcriptSealOperationKey: completedTranscriptSeal,
    };
    const participant = await participantCheckpointForSession(
      source,
      record.chapters,
    );
    const groundedRecord = {
      ...source,
      participantGroundingInputSignature: "participant-signature",
      participantGroundingPlanFingerprint:
        participant.result.planFingerprint,
      participantGroundingCheckpointJson: participant.checkpointJson,
    };
    expect(cloneBroadcastContextSessionRecord(groundedRecord)).toEqual(
      groundedRecord,
    );
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...groundedRecord,
        participantGroundingInputSignature: null,
      }),
    ).toThrow(TypeError);
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...groundedRecord,
        participantGroundingCheckpointJson: JSON.stringify({
          ...participant.result,
          grounding: {
            ...participant.result.grounding,
            resolutionStatus: "no-source-roster",
          },
        }),
      }),
    ).toThrow(TypeError);
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...groundedRecord,
        sourceCastRosterId: null,
      }),
    ).toThrow(TypeError);
  });

  it("parses and restores only the complete current participant pre-context packet", async () => {
    const source = {
      ...record,
      sourceCastRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      transcriptSealOperationKey: completedTranscriptSeal,
    };
    const participant = await participantCheckpointForSession(
      source,
      record.chapters,
    );
    const fence = {
      sourceDurationMs: source.sourceDurationMs,
      sourceCastRosterId: source.sourceCastRosterId,
      transcriptSealOperationKey: completedTranscriptSeal,
      dialogueChapters: record.chapters,
      participantGroundingPlanFingerprint:
        participant.result.planFingerprint,
    } as const;

    await expect(
      parseBroadcastParticipantPreContextCheckpointJson(
        participant.checkpointJson,
        fence,
      ),
    ).resolves.toEqual(participant.result);
    await expect(
      parseBroadcastParticipantPreContextCheckpointJson(
        JSON.stringify(participant.result.grounding),
        fence,
      ),
    ).resolves.toBeNull();

    const tamperedPlan = structuredClone(participant.result);
    (
      tamperedPlan.plan.adapters[0] as unknown as {
        adapterFenceKey: string;
      }
    ).adapterFenceKey = `sha256:${"f".repeat(64)}`;
    await expect(
      parseBroadcastParticipantPreContextCheckpointJson(
        JSON.stringify(tamperedPlan),
        fence,
      ),
    ).resolves.toBeNull();

    const tamperedReceipt = structuredClone(participant.result);
    (
      tamperedReceipt.sealedPlan.noneObservedReceipts[0] as unknown as {
        unavailableReason: "source-has-no-modality";
      }
    ).unavailableReason = "source-has-no-modality";
    await expect(
      parseBroadcastParticipantPreContextCheckpointJson(
        JSON.stringify(tamperedReceipt),
        fence,
      ),
    ).resolves.toBeNull();

    const tamperedGrounding = structuredClone(participant.result);
    (
      tamperedGrounding.grounding as unknown as {
        sourceDurationMs: number;
      }
    ).sourceDurationMs -= 1;
    await expect(
      parseBroadcastParticipantPreContextCheckpointJson(
        JSON.stringify(tamperedGrounding),
        fence,
      ),
    ).resolves.toBeNull();

    await expect(
      parseBroadcastParticipantPreContextCheckpointJson(
        participant.checkpointJson,
        {
          ...fence,
          transcriptSealOperationKey: "transcript:different:sealed",
        },
      ),
    ).resolves.toBeNull();
    await expect(
      parseBroadcastParticipantPreContextCheckpointJson(
        participant.checkpointJson,
        {
          ...fence,
          participantGroundingPlanFingerprint: "different-plan",
        },
      ),
    ).resolves.toBeNull();

    const participantGroundingInputSignature =
      await createBroadcastParticipantGroundingInputSignature({
        inputSignature: source.inputSignature,
        transcriptSealOperationKey: completedTranscriptSeal,
        participantGroundingPlanFingerprint:
          participant.result.planFingerprint,
        participantGroundingCheckpointJson: participant.checkpointJson,
      });
    const session = cloneBroadcastContextSessionRecord({
      ...source,
      participantGroundingInputSignature,
      participantGroundingPlanFingerprint:
        participant.result.planFingerprint,
      participantGroundingCheckpointJson: participant.checkpointJson,
    });
    await expect(
      restoreBroadcastParticipantPreContextCheckpoint(session),
    ).resolves.toEqual(participant.result);
    await expect(
      restoreBroadcastParticipantPreContextCheckpoint({
        ...session,
        participantGroundingInputSignature: `sha256:${"0".repeat(64)}`,
      }),
    ).resolves.toBeNull();
  });

  it("pairs refined semantic candidates with the exact refinement input", () => {
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...record,
        refinementInputSignature: "refinement-signature",
        refinementCandidatesJson: "[]",
      }),
    ).not.toThrow();
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...record,
        refinementInputSignature: null,
        refinementCandidatesJson: "[]",
      }),
    ).toThrow(TypeError);
  });

  it("binds a canonical refinement transcript checkpoint to its exact input signature and ranges", () => {
    const completed = completedContextRecord();
    const checkpointJson = refinementTranscriptCheckpointJson();
    const checkpointed = {
      ...completed,
      refinementTranscriptInputSignature:
        "refinement-transcript-signature-v1",
      refinementTranscriptCheckpointJson: checkpointJson,
    };

    expect(cloneBroadcastContextSessionRecord(checkpointed)).toEqual(
      checkpointed,
    );
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...checkpointed,
        refinementTranscriptInputSignature: "different-signature",
      }),
    ).toThrow(TypeError);

    const tampered = JSON.parse(checkpointJson) as {
      plannedChunks: Array<{ sourceStartMs: number }>;
    };
    const firstChunk = tampered.plannedChunks[0];
    if (firstChunk === undefined) throw new Error("Missing test chunk.");
    firstChunk.sourceStartMs += 1;
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...checkpointed,
        refinementTranscriptCheckpointJson: JSON.stringify(tampered),
      }),
    ).toThrow(TypeError);
  });

  it("binds a paid context result to its exact durable input checkpoint", () => {
    const completed = completedContextRecord();
    const grounding = completedParticipantPreContext.grounding;
    const contextInputCheckpointJson = JSON.stringify({
      sourceDurationMs: record.sourceDurationMs,
      chapters: record.chapters,
      candidates: [],
      participantGrounding: grounding,
      castRosterId: record.sourceCastRosterId,
      outputLanguage: "ko",
    });
    const checkpointed = {
      ...completed,
      contextInputSignature: "context-signature",
      contextInputCheckpointJson,
      contextResultJson: JSON.stringify({ schemaVersion: "1.7.0" }),
    };

    expect(() =>
      assertBroadcastContextSessionRecord(checkpointed),
    ).not.toThrow();
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...checkpointed,
        contextInputCheckpointJson: JSON.stringify({
          ...JSON.parse(contextInputCheckpointJson),
          sourceDurationMs: record.sourceDurationMs - 1,
        }),
      }),
    ).toThrow(TypeError);
  });

  it("round-trips an in-progress phase ledger only with all three exact fences", () => {
    const completed = completedContextRecord();
    const ledgerJson = contextPhaseLedgerJson(completed);
    const inProgress = {
      ...completed,
      contextPhaseLedgerJson: ledgerJson,
      contextResultJson: null,
      refinementInputSignature: null,
      refinementCandidatesJson: null,
    };

    expect(cloneBroadcastContextSessionRecord(inProgress)).toEqual(inProgress);
    for (const fenceOverrides of [
      { parentContextSignature: "different-context" },
      { transcriptSignature: "different-transcript" },
      { groundingSignature: "different-grounding" },
    ]) {
      expect(() =>
        assertBroadcastContextSessionRecord({
          ...inProgress,
          contextPhaseLedgerJson: contextPhaseLedgerJson(
            completed,
            fenceOverrides,
          ),
        }),
      ).toThrow(TypeError);
    }
  });

  it("rejects malformed and oversized phase-ledger JSON by UTF-8 bytes", () => {
    const completed = completedContextRecord();
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...completed,
        contextPhaseLedgerJson: "{not-json",
      }),
    ).toThrow(TypeError);

    const resultText = "가".repeat(800_000);
    const fence = {
      parentContextSignature: completed.contextInputSignature as string,
      transcriptSignature: completed.transcriptSealOperationKey as string,
      groundingSignature:
        completed.participantGroundingInputSignature as string,
    };
    const oversizedLedger: BroadcastContextPhaseLedger = {
      schemaVersion: "3.0.0",
      fence,
      units: [
        {
          phase: "discovery",
          unitId: "large-1",
          inputDigest: "digest-large-1",
          operationId: "operation-large-1",
          attemptOrdinal: 0,
          required: true,
          status: "succeeded",
          result: resultText,
        },
        {
          phase: "discovery",
          unitId: "large-2",
          inputDigest: "digest-large-2",
          operationId: "operation-large-2",
          attemptOrdinal: 0,
          required: true,
          status: "succeeded",
          result: resultText,
        },
      ],
      usedOperationIds: ["operation-large-1", "operation-large-2"],
    };
    const oversizedLedgerJson =
      serializeBroadcastContextPhaseLedger(oversizedLedger);

    expect(oversizedLedgerJson.length).toBeLessThan(
      MAX_CONTEXT_PHASE_LEDGER_CHECKPOINT_BYTES,
    );
    expect(
      new TextEncoder().encode(oversizedLedgerJson).byteLength,
    ).toBeGreaterThan(MAX_CONTEXT_PHASE_LEDGER_CHECKPOINT_BYTES);
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...completed,
        contextPhaseLedgerJson: oversizedLedgerJson,
      }),
    ).toThrow(TypeError);
  });

  it("checkpoints a ledger and clears only artifacts from a changed context input", () => {
    const completed = completedContextRecord();
    const completedWithTranscript = {
      ...completed,
      refinementTranscriptInputSignature:
        "refinement-transcript-signature-v1",
      refinementTranscriptCheckpointJson:
        refinementTranscriptCheckpointJson(),
    };
    const sameInput = checkpointBroadcastContextSessionPhaseLedger(
      completedWithTranscript,
      {
        contextInputSignature: completed.contextInputSignature as string,
        contextInputCheckpointJson:
          completed.contextInputCheckpointJson as string,
        contextPhaseLedgerJson: contextPhaseLedgerJson(completed),
        recordedAt: "2026-07-22T04:01:00.000Z",
      },
    );

    expect(sameInput.contextResultJson).toBe(completed.contextResultJson);
    expect(sameInput.refinementTranscriptCheckpointJson).toBe(
      completedWithTranscript.refinementTranscriptCheckpointJson,
    );
    expect(sameInput.refinementInputSignature).toBeNull();
    expect(sameInput.refinementCandidatesJson).toBeNull();

    const changedContext = {
      ...completed,
      contextInputSignature: "context-signature-v2",
    };
    const changedInput = checkpointBroadcastContextSessionPhaseLedger(
      completedWithTranscript,
      {
        contextInputSignature: "context-signature-v2",
        contextInputCheckpointJson:
          completed.contextInputCheckpointJson as string,
        contextPhaseLedgerJson: contextPhaseLedgerJson(changedContext),
        recordedAt: "2026-07-22T04:02:00.000Z",
      },
    );

    expect(changedInput.contextPhaseLedgerJson).not.toBeNull();
    expect(changedInput.contextResultJson).toBeNull();
    expect(changedInput.refinementTranscriptInputSignature).toBeNull();
    expect(changedInput.refinementTranscriptCheckpointJson).toBeNull();
    expect(changedInput.refinementInputSignature).toBeNull();
    expect(changedInput.refinementCandidatesJson).toBeNull();
  });

  it("preserves a derived projection only while the exact refinement ledger slice is unchanged", () => {
    const completed = completedContextRecord();
    const refinementLedgerJson = serializeBroadcastContextPhaseLedger(
      createBroadcastContextPhaseLedger({
        fence: {
          parentContextSignature: completed.contextInputSignature as string,
          transcriptSignature:
            completed.transcriptSealOperationKey as string,
          groundingSignature:
            completed.participantGroundingInputSignature as string,
        },
        units: [
          {
            phase: "discovery",
            unitId: "overview",
            inputDigest: "overview-digest",
            operationId: "overview-operation",
            attemptOrdinal: 0,
            required: true,
          },
          {
            phase: "refinement",
            unitId: "lead:one",
            inputDigest: "refinement-digest-v1",
            operationId: "refinement-operation-v1",
            attemptOrdinal: 0,
            required: true,
          },
        ],
      }),
    );
    const withExactLedger = {
      ...completed,
      contextPhaseLedgerJson: refinementLedgerJson,
    };
    const preserved = checkpointBroadcastContextSessionPhaseLedger(
      withExactLedger,
      {
        contextInputSignature: completed.contextInputSignature as string,
        contextInputCheckpointJson:
          completed.contextInputCheckpointJson as string,
        contextPhaseLedgerJson: refinementLedgerJson,
        recordedAt: "2026-07-22T04:01:00.000Z",
      },
    );
    expect(preserved.refinementInputSignature).toBe(
      completed.refinementInputSignature,
    );
    expect(preserved.refinementCandidatesJson).toBe(
      completed.refinementCandidatesJson,
    );

    const parsed = JSON.parse(refinementLedgerJson) as {
      units: Array<Record<string, unknown>>;
      usedOperationIds: string[];
    };
    const changedRefinementLedgerJson = JSON.stringify({
      ...parsed,
      units: parsed.units.map((unit) =>
        unit.phase === "refinement"
          ? { ...unit, status: "in-flight" }
          : unit,
      ),
    });
    const invalidated = checkpointBroadcastContextSessionPhaseLedger(
      preserved,
      {
        contextInputSignature: completed.contextInputSignature as string,
        contextInputCheckpointJson:
          completed.contextInputCheckpointJson as string,
        contextPhaseLedgerJson: changedRefinementLedgerJson,
        recordedAt: "2026-07-22T04:02:00.000Z",
      },
    );
    expect(invalidated.refinementInputSignature).toBeNull();
    expect(invalidated.refinementCandidatesJson).toBeNull();
    expect(invalidated.refinementTranscriptCheckpointJson).toBe(
      preserved.refinementTranscriptCheckpointJson,
    );
  });

  it("checkpoints refinement transcripts atomically and invalidates derived candidates only when evidence changes", () => {
    const completed = completedContextRecord();
    const checkpoint = {
      refinementTranscriptInputSignature:
        "refinement-transcript-signature-v1",
      refinementTranscriptCheckpointJson:
        refinementTranscriptCheckpointJson(),
      recordedAt: "2026-07-22T04:01:00.000Z",
    };
    const first = checkpointBroadcastContextSessionRefinementTranscript(
      completed,
      checkpoint,
    );
    expect(first.contextResultJson).toBe(completed.contextResultJson);
    expect(first.refinementInputSignature).toBeNull();
    expect(first.refinementCandidatesJson).toBeNull();

    const withDerivedCandidates = {
      ...first,
      refinementInputSignature: "semantic-refinement-signature-v2",
      refinementCandidatesJson: "[]",
    };
    const identical = checkpointBroadcastContextSessionRefinementTranscript(
      withDerivedCandidates,
      {
        ...checkpoint,
        recordedAt: "2026-07-22T04:02:00.000Z",
      },
    );
    expect(identical.refinementInputSignature).toBe(
      "semantic-refinement-signature-v2",
    );
    expect(identical.refinementCandidatesJson).toBe("[]");

    const changed = checkpointBroadcastContextSessionRefinementTranscript(
      identical,
      {
        refinementTranscriptInputSignature:
          "refinement-transcript-signature-v2",
        refinementTranscriptCheckpointJson:
          refinementTranscriptCheckpointJson(
            "refinement-transcript-signature-v2",
          ),
        recordedAt: "2026-07-22T04:03:00.000Z",
      },
    );
    expect(changed.contextResultJson).toBe(completed.contextResultJson);
    expect(changed.refinementInputSignature).toBeNull();
    expect(changed.refinementCandidatesJson).toBeNull();
  });

  it("preserves or accepts a valid ledger on context commit and clears stale input", () => {
    const completed = completedContextRecord();
    const inProgress = checkpointBroadcastContextSessionPhaseLedger(
      {
        ...completed,
        contextInputSignature: null,
        contextInputCheckpointJson: null,
        contextPhaseLedgerJson: null,
        contextResultJson: null,
        refinementInputSignature: null,
        refinementCandidatesJson: null,
      },
      {
        contextInputSignature: completed.contextInputSignature as string,
        contextInputCheckpointJson:
          completed.contextInputCheckpointJson as string,
        contextPhaseLedgerJson: contextPhaseLedgerJson(completed),
        recordedAt: "2026-07-22T04:01:00.000Z",
      },
    );
    const preserved = commitBroadcastContextSessionContext(inProgress, {
      contextInputSignature: inProgress.contextInputSignature as string,
      contextInputCheckpointJson:
        inProgress.contextInputCheckpointJson as string,
      contextResultJson: JSON.stringify({ schemaVersion: "1.7.0" }),
      recordedAt: "2026-07-22T04:02:00.000Z",
    });
    expect(preserved.contextPhaseLedgerJson).toBe(
      inProgress.contextPhaseLedgerJson,
    );

    const changedContext = {
      ...completed,
      contextInputSignature: "context-signature-v2",
    };
    const accepted = commitBroadcastContextSessionContext(preserved, {
      contextInputSignature: "context-signature-v2",
      contextInputCheckpointJson:
        completed.contextInputCheckpointJson as string,
      contextPhaseLedgerJson: contextPhaseLedgerJson(changedContext),
      contextResultJson: JSON.stringify({ schemaVersion: "1.7.0" }),
      recordedAt: "2026-07-22T04:03:00.000Z",
    });
    expect(accepted.contextPhaseLedgerJson).toBe(
      contextPhaseLedgerJson(changedContext),
    );

    const cleared = commitBroadcastContextSessionContext(accepted, {
      contextInputSignature: "context-signature-v3",
      contextInputCheckpointJson:
        completed.contextInputCheckpointJson as string,
      contextResultJson: JSON.stringify({ schemaVersion: "1.7.0" }),
      recordedAt: "2026-07-22T04:04:00.000Z",
    });
    expect(cleared.contextPhaseLedgerJson).toBeNull();
  });

  it("invalidates the exact context triple and refinement pair together for retry", () => {
    const completed = completedContextRecord();
    const withLedger = {
      ...completed,
      contextPhaseLedgerJson: contextPhaseLedgerJson(completed),
      refinementTranscriptInputSignature:
        "refinement-transcript-signature-v1",
      refinementTranscriptCheckpointJson:
        refinementTranscriptCheckpointJson(),
    };
    const invalidated = invalidateBroadcastContextSessionContext(
      withLedger,
      "2026-07-22T04:01:00.000Z",
    );

    expect(invalidated).toMatchObject({
      contextInputSignature: null,
      contextInputCheckpointJson: null,
      contextPhaseLedgerJson: null,
      contextResultJson: null,
      refinementTranscriptInputSignature: null,
      refinementTranscriptCheckpointJson: null,
      refinementInputSignature: null,
      refinementCandidatesJson: null,
      recordedAt: "2026-07-22T04:01:00.000Z",
    });
    expect(invalidated.transcriptSealOperationKey).toBe(
      completed.transcriptSealOperationKey,
    );
    expect(invalidated.participantGroundingCheckpointJson).toBe(
      completed.participantGroundingCheckpointJson,
    );
    expect(completed.contextInputSignature).toBe("context-signature-v1");
  });

  it("invalidates refinements whenever a new parent context is committed", () => {
    const completed = {
      ...completedContextRecord(),
      refinementTranscriptInputSignature:
        "refinement-transcript-signature-v1",
      refinementTranscriptCheckpointJson:
        refinementTranscriptCheckpointJson(),
    };
    const committed = commitBroadcastContextSessionContext(completed, {
      contextInputSignature: "context-signature-v2",
      contextInputCheckpointJson:
        completed.contextInputCheckpointJson as string,
      contextResultJson: JSON.stringify({
        schemaVersion: "1.7.0",
        broadcastSummaryKo: "new result",
      }),
      recordedAt: "2026-07-22T04:02:00.000Z",
    });

    expect(committed.contextInputSignature).toBe("context-signature-v2");
    expect(committed.contextResultJson).toContain("new result");
    expect(committed.refinementTranscriptInputSignature).toBeNull();
    expect(committed.refinementTranscriptCheckpointJson).toBeNull();
    expect(committed.refinementInputSignature).toBeNull();
    expect(committed.refinementCandidatesJson).toBeNull();
    expect(completed.refinementInputSignature).toBe("refinement-signature-v1");
  });

  it("enforces the participant checkpoint ceiling in UTF-8 bytes", () => {
    const grounding = createBroadcastParticipantGrounding({
      sourceDurationMs: record.sourceDurationMs,
      castRosterId: null,
      chapters: record.chapters,
    });
    const canonicalJson = JSON.stringify(grounding);
    const oversizedUtf8Json = canonicalJson.replace(
      '{"schemaVersion":',
      `{"schemaVersion":"${"가".repeat(30_000)}","schemaVersion":`,
    );
    expect(oversizedUtf8Json.length).toBeLessThan(64 * 1024);
    expect(
      new TextEncoder().encode(oversizedUtf8Json).byteLength,
    ).toBeGreaterThan(64 * 1024);
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...record,
        transcriptSealOperationKey: "run-1:source:event-boost:attempt-0",
        participantGroundingInputSignature: "participant-signature",
        participantGroundingPlanFingerprint:
          "participant-plan-fingerprint-v1",
        participantGroundingCheckpointJson: oversizedUtf8Json,
      }),
    ).toThrow(TypeError);
  });

  it("enforces context and refinement ceilings in UTF-8 bytes", () => {
    const boundedContextJson = JSON.stringify({
      summary: "가".repeat(80_000),
    });
    const oversizedContextJson = JSON.stringify({
      summary: "가".repeat(90_000),
    });
    const boundedRefinementJson = JSON.stringify(["가".repeat(80_000)]);
    const oversizedRefinementJson = JSON.stringify(["가".repeat(90_000)]);

    expect(oversizedContextJson.length).toBeLessThan(256 * 1024);
    expect(
      new TextEncoder().encode(boundedContextJson).byteLength,
    ).toBeLessThanOrEqual(256 * 1024);
    expect(
      new TextEncoder().encode(oversizedContextJson).byteLength,
    ).toBeGreaterThan(256 * 1024);
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...record,
        contextInputSignature: "context-signature",
        contextResultJson: boundedContextJson,
      }),
    ).not.toThrow();
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...record,
        contextInputSignature: "context-signature",
        contextResultJson: oversizedContextJson,
      }),
    ).toThrow(TypeError);

    expect(oversizedRefinementJson.length).toBeLessThan(256 * 1024);
    expect(
      new TextEncoder().encode(boundedRefinementJson).byteLength,
    ).toBeLessThanOrEqual(256 * 1024);
    expect(
      new TextEncoder().encode(oversizedRefinementJson).byteLength,
    ).toBeGreaterThan(256 * 1024);
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...record,
        refinementInputSignature: "refinement-signature",
        refinementCandidatesJson: boundedRefinementJson,
      }),
    ).not.toThrow();
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...record,
        refinementInputSignature: "refinement-signature",
        refinementCandidatesJson: oversizedRefinementJson,
      }),
    ).toThrow(TypeError);
  });

  it("round-trips a grounded transcript map larger than the 144-chapter request projection", async () => {
    const longChapters = Array.from({ length: 145 }, (_, index) => ({
      chapterId: `chapter-${index + 1}`,
      startMs: index * 1_000,
      endMs: (index + 1) * 1_000,
      evidenceMode: "complete-transcript" as const,
      evidenceCoverageRatio: 1,
      summaryKo: `${index + 1}번째 방송 구간`,
    }));
    const longRecordBase = {
      ...record,
      sourceDurationMs: 145_000,
      chapters: longChapters,
      transcriptSealOperationKey: "run-1:source:event-boost:attempt-0",
    };
    const participant = await participantCheckpointForSession(
      longRecordBase,
      compactBroadcastContextChapters(longChapters),
    );
    const compactedChapters = compactBroadcastContextChapters(longChapters);
    const contextParticipantGrounding =
      rebaseBroadcastParticipantGrounding(
        participant.result.grounding,
        {
          sourceDurationMs: longRecordBase.sourceDurationMs,
          castRosterId: longRecordBase.sourceCastRosterId,
          chapters: compactedChapters,
        },
        {
          sourceDurationMs: longRecordBase.sourceDurationMs,
          castRosterId: longRecordBase.sourceCastRosterId,
          chapters: compactedChapters,
        },
      );
    expect(contextParticipantGrounding).not.toBeNull();
    const contextInput = {
      sourceDurationMs: longRecordBase.sourceDurationMs,
      chapters: compactedChapters,
      candidates: [],
      participantGrounding: contextParticipantGrounding!,
      castRosterId: longRecordBase.sourceCastRosterId,
      outputLanguage: "ko" as const,
    };
    expect(() => createBroadcastContextRequest(contextInput)).not.toThrow();
    const longRecord = {
      ...longRecordBase,
      participantGroundingInputSignature: "participant-signature",
      participantGroundingPlanFingerprint:
        participant.result.planFingerprint,
      participantGroundingCheckpointJson: participant.checkpointJson,
      contextInputSignature: "context-signature",
      contextInputCheckpointJson: JSON.stringify(contextInput),
      contextResultJson: JSON.stringify({
        schemaVersion: "1.7.0",
        broadcastSummaryKo: "긴 방송 맥락",
      }),
    };

    expect(cloneBroadcastContextSessionRecord(longRecord)).toEqual(longRecord);
  });

  it("keeps a bounded, paired whole-context result for paid-result recovery", () => {
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...record,
        contextInputSignature: "context-signature",
        contextResultJson: JSON.stringify({ schemaVersion: "1.4.0" }),
      }),
    ).not.toThrow();
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...record,
        contextInputSignature: "context-signature",
        contextResultJson: null,
      }),
    ).toThrow(TypeError);
  });

  it("rejects an empty legacy transcript map even when every sampled chunk is an explicit gap", () => {
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...record,
        completeAudioCoverage: false,
        chapters: [],
        gapChunkIds: ["chunk-001", "chunk-002"],
        fragmentGaps: [
          {
            chunkId: "chunk-001",
            sourceStartMs: 0,
            sourceEndMs: 30_000,
            reason: "in-flight",
            attemptCount: 3,
          },
          {
            chunkId: "chunk-002",
            sourceStartMs: 30_000,
            sourceEndMs: 60_000,
            reason: "outcome-unknown",
            attemptCount: 1,
          },
        ],
      }),
    ).toThrow("requires current resolved evidence");
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...record,
        chapters: [],
      }),
    ).toThrow(TypeError);
  });

  it("stores a fully resolved empty dialogue map without pretending visual analysis is complete", () => {
    const transcriptInputSignature = "transcript-plan-signature-v1";
    const checkpointed = checkpointBroadcastContextSessionTranscript(record, {
      completeAudioCoverage: true,
      chapters: [],
      gapChunkIds: [],
      fragmentGaps: [],
      transcriptEvidenceInputSignature: transcriptInputSignature,
      transcriptEvidenceCheckpointJson:
        transcriptEvidenceCheckpointJson(transcriptInputSignature),
      transcriptProviderReceiptInputSignature: null,
      transcriptProviderReceiptCheckpointJson: null,
      modelRevision: record.modelRevision,
      transcriptSealOperationKey: transcriptInputSignature,
      recordedAt: "2026-07-22T04:01:00.000Z",
    });

    expect(cloneBroadcastContextSessionRecord(checkpointed)).toEqual(
      checkpointed,
    );
    expect(checkpointed).toMatchObject({
      completeAudioCoverage: true,
      chapters: [],
      gapChunkIds: [],
      transcriptEvidenceInputSignature: transcriptInputSignature,
      transcriptSealOperationKey: transcriptInputSignature,
      contextInputSignature: null,
      contextResultJson: null,
    });
  });

  it("requires the resolved evidence pair and exact source/model/range fences", () => {
    const transcriptInputSignature = "transcript-plan-signature-v1";
    const checkpointJson =
      transcriptEvidenceCheckpointJson(transcriptInputSignature);
    const exact = {
      ...record,
      completeAudioCoverage: true,
      chapters: [],
      transcriptEvidenceInputSignature: transcriptInputSignature,
      transcriptEvidenceCheckpointJson: checkpointJson,
      transcriptSealOperationKey: transcriptInputSignature,
    };
    expect(() => assertBroadcastContextSessionRecord(exact)).not.toThrow();
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...exact,
        transcriptEvidenceInputSignature: null,
      }),
    ).toThrow(TypeError);
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...exact,
        inputSignature: "another-source",
      }),
    ).toThrow(TypeError);
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...exact,
        modelRevision: "another-model",
      }),
    ).toThrow(TypeError);
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...exact,
        transcriptSealOperationKey: "another-plan",
      }),
    ).toThrow(TypeError);
  });

  it("requires every unresolved planned cell to remain an exact fragment gap", () => {
    const transcriptInputSignature = "partial-transcript-plan-v1";
    let evidence = createBroadcastTranscriptResolvedEvidenceCheckpoint({
      sourceFingerprint: record.inputSignature,
      sourceDurationMs: record.sourceDurationMs,
      transcriptInputSignature,
      modelRevision: record.modelRevision,
      plannedCells: [
        { chunkId: "asr-001", sourceStartMs: 0, sourceEndMs: 150_000 },
        {
          chunkId: "asr-002",
          sourceStartMs: 150_000,
          sourceEndMs: 300_000,
        },
      ],
    });
    evidence = recordBroadcastTranscriptResolvedEvidence(
      evidence,
      "asr-001",
      "no-speech",
      createVerifiedNoSpeechRunReceiptForTest(
        record.sourceDurationMs,
        0,
        150_000,
      ),
    );
    const partial = {
      ...record,
      completeAudioCoverage: false,
      chapters: [],
      gapChunkIds: ["asr-002"],
      fragmentGaps: [
        {
          chunkId: "asr-002",
          sourceStartMs: 150_000,
          sourceEndMs: 300_000,
          reason: "pending" as const,
          attemptCount: 0,
        },
      ],
      transcriptEvidenceInputSignature: transcriptInputSignature,
      transcriptEvidenceCheckpointJson:
        serializeBroadcastTranscriptResolvedEvidenceCheckpoint(evidence),
      transcriptSealOperationKey: null,
    };
    expect(() => assertBroadcastContextSessionRecord(partial)).not.toThrow();
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...partial,
        fragmentGaps: [
          {
            ...partial.fragmentGaps[0],
            sourceStartMs: 149_999,
          },
        ],
      }),
    ).toThrow(TypeError);
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...partial,
        gapChunkIds: [],
        fragmentGaps: [],
      }),
    ).toThrow(TypeError);
  });

  it("invalidates every downstream child when transcript evidence changes", () => {
    const completed = completedContextRecord();
    const transcriptInputSignature = "transcript-plan-signature-v2";
    const checkpointed = checkpointBroadcastContextSessionTranscript(
      completed,
      {
        completeAudioCoverage: true,
        chapters: [],
        gapChunkIds: [],
        fragmentGaps: [],
        transcriptEvidenceInputSignature: transcriptInputSignature,
        transcriptEvidenceCheckpointJson:
          transcriptEvidenceCheckpointJson(transcriptInputSignature),
        transcriptProviderReceiptInputSignature: null,
        transcriptProviderReceiptCheckpointJson: null,
        modelRevision: record.modelRevision,
        transcriptSealOperationKey: transcriptInputSignature,
        recordedAt: "2026-07-22T04:02:00.000Z",
      },
    );

    expect(checkpointed).toMatchObject({
      participantGroundingInputSignature: null,
      participantGroundingPlanFingerprint: null,
      participantGroundingCheckpointJson: null,
      contextInputSignature: null,
      contextInputCheckpointJson: null,
      contextPhaseLedgerJson: null,
      contextResultJson: null,
      refinementTranscriptInputSignature: null,
      refinementTranscriptCheckpointJson: null,
      refinementInputSignature: null,
      refinementCandidatesJson: null,
    });
  });

  it("preserves downstream children when only an identical transcript checkpoint timestamp changes", () => {
    const completed = completedContextRecord();
    const checkpointed = checkpointBroadcastContextSessionTranscript(
      completed,
      {
        completeAudioCoverage: completed.completeAudioCoverage,
        chapters: completed.chapters,
        gapChunkIds: completed.gapChunkIds,
        fragmentGaps: completed.fragmentGaps,
        transcriptEvidenceInputSignature:
          completed.transcriptEvidenceInputSignature,
        transcriptEvidenceCheckpointJson:
          completed.transcriptEvidenceCheckpointJson,
        transcriptProviderReceiptInputSignature:
          completed.transcriptProviderReceiptInputSignature,
        transcriptProviderReceiptCheckpointJson:
          completed.transcriptProviderReceiptCheckpointJson,
        modelRevision: completed.modelRevision,
        transcriptSealOperationKey: completed.transcriptSealOperationKey,
        recordedAt: "2026-07-22T04:03:00.000Z",
      },
    );

    expect(checkpointed).toMatchObject({
      participantGroundingInputSignature:
        completed.participantGroundingInputSignature,
      participantGroundingPlanFingerprint:
        completed.participantGroundingPlanFingerprint,
      participantGroundingCheckpointJson:
        completed.participantGroundingCheckpointJson,
      contextInputSignature: completed.contextInputSignature,
      contextInputCheckpointJson: completed.contextInputCheckpointJson,
      contextResultJson: completed.contextResultJson,
      refinementInputSignature: completed.refinementInputSignature,
      refinementCandidatesJson: completed.refinementCandidatesJson,
      recordedAt: "2026-07-22T04:03:00.000Z",
    });
  });

  it("stores a detailed chapter map larger than the 144-item transport projection", () => {
    const chapters = Array.from({ length: 145 }, (_, index) => ({
      chapterId: `transcript-${index + 1}`,
      startMs: index * 1_000,
      endMs: (index + 1) * 1_000,
      evidenceMode: "complete-transcript" as const,
      evidenceCoverageRatio: 1,
      summaryKo: `${index + 1}번째 방송 구간`,
    }));
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...record,
        sourceDurationMs: 145_000,
        chapters,
      }),
    ).not.toThrow();
  });

  it("rejects a current session carrying a legacy no-speech checkpoint without VAD receipts", () => {
    const currentCheckpoint = JSON.parse(
      transcriptEvidenceCheckpointJson(
        "legacy-transcript-operation",
        "no-speech",
      ),
    ) as {
      schemaVersion: string;
      resolvedEvidence: Array<Record<string, unknown>>;
    };
    currentCheckpoint.schemaVersion = "1.0.0";
    currentCheckpoint.resolvedEvidence =
      currentCheckpoint.resolvedEvidence.map((entry) => {
        const legacyEntry = { ...entry };
        delete legacyEntry.speechActivityReceipt;
        return legacyEntry;
      });
    expect(() =>
      cloneBroadcastContextSessionRecord({
        ...completedContextRecord(),
        transcriptEvidenceInputSignature: "legacy-transcript-operation",
        transcriptEvidenceCheckpointJson:
          JSON.stringify(currentCheckpoint),
        transcriptSealOperationKey: "legacy-transcript-operation",
      }),
    ).toThrow("resolved evidence");
  });

  it("rejects oversized or non-canonical refinement evidence checkpoints", async () => {
    const completed = completedContextRecord();
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...completed,
        refinementEvidenceLedgerJson: "x".repeat(
          MAX_BROADCAST_REFINEMENT_EVIDENCE_LEDGER_BYTES + 1,
        ),
      }),
    ).toThrow(TypeError);

    const canonical = await refinementEvidenceLedgerJson();
    await expect(
      checkpointBroadcastContextSessionRefinementEvidenceLedger(completed, {
        refinementEvidenceLedgerJson: ` ${canonical}`,
        recordedAt: "2026-07-22T04:05:00.000Z",
      }),
    ).rejects.toThrow(/non-canonical/u);
  });

  it("preserves an exact active evidence projection and clears semantic output when it changes", async () => {
    const firstLedgerJson = await refinementEvidenceLedgerJson();
    const firstCheckpoint =
      await checkpointBroadcastContextSessionRefinementEvidenceLedger(
        completedContextRecord(),
        {
          refinementEvidenceLedgerJson: firstLedgerJson,
          recordedAt: "2026-07-22T04:05:00.000Z",
        },
      );
    expect(firstCheckpoint).toMatchObject({
      refinementEvidenceLedgerJson: firstLedgerJson,
      refinementInputSignature: null,
      refinementCandidatesJson: null,
    });
    const withSemanticProjection = cloneBroadcastContextSessionRecord({
      ...firstCheckpoint,
      refinementInputSignature: "semantic-projection-v1",
      refinementCandidatesJson: "[]",
    });

    const preserved =
      await checkpointBroadcastContextSessionRefinementEvidenceLedger(
        withSemanticProjection,
        {
          refinementEvidenceLedgerJson: firstLedgerJson,
          recordedAt: "2026-07-22T04:06:00.000Z",
        },
      );
    expect(preserved).toMatchObject({
      refinementInputSignature: "semantic-projection-v1",
      refinementCandidatesJson: "[]",
    });
    await expect(
      parseBroadcastContextSessionRefinementEvidenceLedger(preserved),
    ).resolves.not.toBeNull();

    const changed =
      await checkpointBroadcastContextSessionRefinementEvidenceLedger(
        preserved,
        {
          refinementEvidenceLedgerJson:
            await refinementEvidenceLedgerJson("두바이 초콜릿 이야기를 했다."),
          recordedAt: "2026-07-22T04:07:00.000Z",
        },
      );
    expect(changed).toMatchObject({
      refinementInputSignature: null,
      refinementCandidatesJson: null,
    });
  });

  it("preserves active evidence across refinement phase transitions and retry transcript checkpoints", async () => {
    const ledgerJson = await refinementEvidenceLedgerJson();
    let session =
      await checkpointBroadcastContextSessionRefinementEvidenceLedger(
        completedContextRecord(),
        {
          refinementEvidenceLedgerJson: ledgerJson,
          recordedAt: "2026-07-22T04:05:00.000Z",
        },
      );
    for (const [index, status] of (
      ["pending", "in-flight", "succeeded"] as const
    ).entries()) {
      session = checkpointBroadcastContextSessionPhaseLedger(session, {
        contextInputSignature: session.contextInputSignature as string,
        contextInputCheckpointJson:
          session.contextInputCheckpointJson as string,
        contextPhaseLedgerJson: refinementPhaseLedgerJson(session, status),
        recordedAt: `2026-07-22T04:0${index + 6}:00.000Z`,
      });
      expect(session.refinementEvidenceLedgerJson).toBe(ledgerJson);
    }

    session = checkpointBroadcastContextSessionRefinementTranscript(session, {
      refinementTranscriptInputSignature: "refinement-retry-v1",
      refinementTranscriptCheckpointJson:
        refinementTranscriptCheckpointJson("refinement-retry-v1"),
      recordedAt: "2026-07-22T04:09:00.000Z",
    });
    expect(session.refinementEvidenceLedgerJson).toBe(ledgerJson);
    session = checkpointBroadcastContextSessionRefinementTranscript(session, {
      refinementTranscriptInputSignature: "refinement-retry-v2",
      refinementTranscriptCheckpointJson:
        refinementTranscriptCheckpointJson("refinement-retry-v2"),
      recordedAt: "2026-07-22T04:10:00.000Z",
    });
    expect(session.refinementEvidenceLedgerJson).toBe(ledgerJson);
    expect(session.refinementInputSignature).toBeNull();
    expect(session.refinementCandidatesJson).toBeNull();
  });

  it("preserves the ledger for identical parents and clears it for transcript, participant, or context changes", async () => {
    const ledgerJson = await refinementEvidenceLedgerJson();
    const checkpointed =
      await checkpointBroadcastContextSessionRefinementEvidenceLedger(
        completedContextRecord(),
        {
          refinementEvidenceLedgerJson: ledgerJson,
          recordedAt: "2026-07-22T04:05:00.000Z",
        },
      );
    const identicalTranscript = checkpointBroadcastContextSessionTranscript(
      checkpointed,
      {
        completeAudioCoverage: checkpointed.completeAudioCoverage,
        chapters: checkpointed.chapters,
        gapChunkIds: checkpointed.gapChunkIds,
        fragmentGaps: checkpointed.fragmentGaps,
        transcriptEvidenceInputSignature:
          checkpointed.transcriptEvidenceInputSignature,
        transcriptEvidenceCheckpointJson:
          checkpointed.transcriptEvidenceCheckpointJson,
        transcriptProviderReceiptInputSignature:
          checkpointed.transcriptProviderReceiptInputSignature,
        transcriptProviderReceiptCheckpointJson:
          checkpointed.transcriptProviderReceiptCheckpointJson,
        modelRevision: checkpointed.modelRevision,
        transcriptSealOperationKey: checkpointed.transcriptSealOperationKey,
        recordedAt: "2026-07-22T04:06:00.000Z",
      },
    );
    expect(identicalTranscript.refinementEvidenceLedgerJson).toBe(ledgerJson);

    const changedTranscript = checkpointBroadcastContextSessionTranscript(
      checkpointed,
      {
        completeAudioCoverage: checkpointed.completeAudioCoverage,
        chapters: checkpointed.chapters,
        gapChunkIds: checkpointed.gapChunkIds,
        fragmentGaps: checkpointed.fragmentGaps,
        transcriptEvidenceInputSignature:
          checkpointed.transcriptEvidenceInputSignature,
        transcriptEvidenceCheckpointJson:
          checkpointed.transcriptEvidenceCheckpointJson,
        transcriptProviderReceiptInputSignature:
          checkpointed.transcriptProviderReceiptInputSignature,
        transcriptProviderReceiptCheckpointJson:
          checkpointed.transcriptProviderReceiptCheckpointJson,
        modelRevision: `${checkpointed.modelRevision}-changed`,
        transcriptSealOperationKey: checkpointed.transcriptSealOperationKey,
        recordedAt: "2026-07-22T04:07:00.000Z",
      },
    );
    expect(changedTranscript.refinementEvidenceLedgerJson).toBeNull();

    const sameParent =
      reconcileBroadcastContextSessionRefinementEvidenceLifecycle(
        checkpointed,
        {
          ...checkpointed,
          recordedAt: "2026-07-22T04:08:00.000Z",
        },
      );
    expect(sameParent.refinementEvidenceLedgerJson).toBe(ledgerJson);

    const changedParticipant =
      reconcileBroadcastContextSessionRefinementEvidenceLifecycle(
        checkpointed,
        {
          ...checkpointed,
          participantGroundingInputSignature: "participant-signature-v2",
        },
      );
    expect(changedParticipant.refinementEvidenceLedgerJson).toBeNull();

    const invalidatedContextParent =
      reconcileBroadcastContextSessionRefinementEvidenceLifecycle(
        checkpointed,
        {
          ...checkpointed,
          contextInputSignature: null,
          contextInputCheckpointJson: null,
          contextPhaseLedgerJson: null,
          contextResultJson: null,
          refinementTranscriptInputSignature: null,
          refinementTranscriptCheckpointJson: null,
        },
      );
    expect(invalidatedContextParent).toMatchObject({
      contextInputSignature: null,
      refinementEvidenceLedgerJson: null,
      refinementInputSignature: null,
      refinementCandidatesJson: null,
    });

    const sameContext = commitBroadcastContextSessionContext(checkpointed, {
      contextInputSignature: checkpointed.contextInputSignature as string,
      contextInputCheckpointJson:
        checkpointed.contextInputCheckpointJson as string,
      contextResultJson: checkpointed.contextResultJson as string,
      recordedAt: "2026-07-22T04:09:00.000Z",
    });
    expect(sameContext.refinementEvidenceLedgerJson).toBe(ledgerJson);
    const changedContext = commitBroadcastContextSessionContext(
      checkpointed,
      {
        contextInputSignature: checkpointed.contextInputSignature as string,
        contextInputCheckpointJson:
          checkpointed.contextInputCheckpointJson as string,
        contextResultJson: JSON.stringify({
          schemaVersion: "1.7.0",
          broadcastSummaryKo: "changed",
        }),
        recordedAt: "2026-07-22T04:10:00.000Z",
      },
    );
    expect(changedContext.refinementEvidenceLedgerJson).toBeNull();
  });

  it("rejects raw provider-shaped fields and invalid chapter ranges", () => {
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...record,
        rawTranscript: "secret",
      }),
    ).toThrow(TypeError);
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...record,
        chapters: [{ ...record.chapters[0], endMs: 400_000 }],
      }),
    ).toThrow();
  });

  it("durably preserves a partial visual checkpoint without publishing grounding descendants", () => {
    const partial = checkpointBroadcastContextSessionVisualInspection(
      visualInspectionSession(),
      {
        transcriptVisualInspectionCheckpointJson:
          visualInspectionRunnerCheckpointJson(false),
        recordedAt: "2026-07-29T07:00:00.000Z",
      },
    );
    expect(partial.transcriptVisualInspectionCheckpointJson).not.toBeNull();
    expect(partial.chapters).toEqual([]);
    expect(cloneBroadcastContextSessionRecord(partial)).toEqual(partial);

    const participantGrounding = createBroadcastParticipantGrounding({
      sourceDurationMs: partial.sourceDurationMs,
      castRosterId: partial.sourceCastRosterId,
      chapters: partial.chapters,
    });
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...partial,
        participantGroundingInputSignature: "participant-signature",
        participantGroundingPlanFingerprint: "participant-plan",
        participantGroundingCheckpointJson: JSON.stringify(
          participantGrounding,
        ),
      }),
    ).toThrow(/publication-ready/u);
  });

  it("projects terminal visual evidence, permits grounding, and rejects a forged visual chapter", async () => {
    const completed = checkpointBroadcastContextSessionVisualInspection(
      visualInspectionSession(),
      {
        transcriptVisualInspectionCheckpointJson:
          visualInspectionRunnerCheckpointJson(true),
        recordedAt: "2026-07-29T07:01:00.000Z",
      },
    );
    expect(completed.chapters).toEqual([
      expect.objectContaining({
        chapterId: "visual:asr-001",
        evidenceMode: "sampled-audio-video",
      }),
    ]);
    const participant = await participantCheckpointForSession(completed, []);
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...completed,
        participantGroundingInputSignature: "participant-signature",
        participantGroundingPlanFingerprint:
          participant.result.planFingerprint,
        participantGroundingCheckpointJson: participant.checkpointJson,
      }),
    ).not.toThrow();
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...completed,
        chapters: [
          {
            ...completed.chapters[0]!,
            summaryKo: "저장 checkpoint에 없는 조작된 화면 설명",
          },
        ],
      }),
    ).toThrow(/terminal visual settlements/u);
  });

  it("partitions transcript and visual chapters only through the exact source-fenced visual projection", () => {
    expect(partitionBroadcastContextSessionChapters(record)).toEqual({
      transcriptChapters: record.chapters,
      visualInspectionChapters: [],
    });

    const completed = checkpointBroadcastContextSessionVisualInspection(
      visualInspectionSession(),
      {
        transcriptVisualInspectionCheckpointJson:
          visualInspectionRunnerCheckpointJson(true),
        recordedAt: "2026-07-29T07:01:30.000Z",
      },
    );
    expect(partitionBroadcastContextSessionChapters(completed)).toEqual({
      transcriptChapters: [],
      visualInspectionChapters: completed.chapters,
    });

    expect(() =>
      partitionBroadcastContextSessionChapters({
        ...completed,
        chapters: [
          {
            ...completed.chapters[0]!,
            evidenceMode: "complete-transcript",
          },
        ],
      }),
    ).toThrow(TypeError);
    expect(() =>
      partitionBroadcastContextSessionChapters({
        ...record,
        chapters: [
          {
            ...record.chapters[0]!,
            chapterId: "visual:unplanned-cell",
            evidenceMode: "sampled-audio-video",
          },
        ],
      }),
    ).toThrow(TypeError);
  });

  it("keeps a terminal visual chapter out of transcript settlement certification", async () => {
    const sourceContentFingerprint =
      `local-file-sampled-sha256-v1:${"c".repeat(64)}`;
    const transcriptSealOperationKey = transcriptOperationKey(
      record.runId,
      sourceContentFingerprint,
      "event-boost",
      0,
      await createCurrentProviderTranscriptSourceIdentityFence(null),
    );
    const plannedCells = [
      {
        chunkId: "asr-001",
        sourceStartMs: 0,
        sourceEndMs: record.sourceDurationMs,
      },
    ] as const;
    let evidence = createBroadcastTranscriptResolvedEvidenceCheckpoint({
      sourceFingerprint: record.inputSignature,
      sourceDurationMs: record.sourceDurationMs,
      transcriptInputSignature: transcriptSealOperationKey,
      modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
      plannedCells,
    });
    evidence = recordBroadcastTranscriptResolvedEvidence(
      evidence,
      "asr-001",
      "no-speech",
      createVerifiedNoSpeechRunReceiptForTest(
        record.sourceDurationMs,
        0,
        record.sourceDurationMs,
      ),
    );
    const route = await createBroadcastTranscriptRouteSelection({
      schemaVersion: "1.1.0",
      serviceVersion: 6,
      routingPolicyVersion: "1.11.0",
      providerConfigurationVersion: "1.3.0",
      transportVersion: 3,
      transportMode: "free-r2",
      maximumChunkDurationMs: 90_000,
      primaryMediaType: "audio/wav",
      provider: "qwen",
      modelId: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
      modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
      effectiveFallback: { mode: "disabled" },
    });
    const providerCheckpoint =
      createBroadcastTranscriptProviderReceiptCheckpoint({
        sourceFingerprint: record.inputSignature,
        sourceDurationMs: record.sourceDurationMs,
        route,
        plannedCells,
      });
    const visualInput = cloneBroadcastContextSessionRecord({
      ...record,
      chapters: [],
      modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
      transcriptEvidenceInputSignature: transcriptSealOperationKey,
      transcriptEvidenceCheckpointJson:
        serializeBroadcastTranscriptResolvedEvidenceCheckpoint(evidence),
      transcriptProviderReceiptInputSignature: route.fingerprint,
      transcriptProviderReceiptCheckpointJson:
        serializeBroadcastTranscriptProviderReceiptCheckpoint(
          providerCheckpoint,
        ),
      transcriptSealOperationKey,
    });
    const completed = checkpointBroadcastContextSessionVisualInspection(
      visualInput,
      {
        transcriptVisualInspectionCheckpointJson:
          visualInspectionRunnerCheckpointJson(true, visualInput),
        recordedAt: "2026-07-29T07:01:45.000Z",
      },
    );

    expect(completed.chapters).toHaveLength(1);
    await expect(
      inspectCurrentTranscriptCheckpoint({
        session: completed,
        sourceContentFingerprint,
        expectedCaptionVideoId: null,
      }),
    ).resolves.toBe(true);
  });

  it("preserves visual descendants only for an exact checkpoint and clears them on visual or transcript change", async () => {
    const completed = checkpointBroadcastContextSessionVisualInspection(
      visualInspectionSession(),
      {
        transcriptVisualInspectionCheckpointJson:
          visualInspectionRunnerCheckpointJson(true),
        recordedAt: "2026-07-29T07:02:00.000Z",
      },
    );
    const participant = await participantCheckpointForSession(completed, []);
    const grounded = cloneBroadcastContextSessionRecord({
      ...completed,
      participantGroundingInputSignature: "participant-signature",
      participantGroundingPlanFingerprint:
        participant.result.planFingerprint,
      participantGroundingCheckpointJson: participant.checkpointJson,
    });
    const exact = checkpointBroadcastContextSessionVisualInspection(
      grounded,
      {
        transcriptVisualInspectionCheckpointJson:
          grounded.transcriptVisualInspectionCheckpointJson!,
        recordedAt: "2026-07-29T07:03:00.000Z",
      },
    );
    expect(exact.participantGroundingInputSignature).toBe(
      "participant-signature",
    );

    const regressed = checkpointBroadcastContextSessionVisualInspection(
      grounded,
      {
        transcriptVisualInspectionCheckpointJson:
          visualInspectionRunnerCheckpointJson(false),
        recordedAt: "2026-07-29T07:04:00.000Z",
      },
    );
    expect(regressed.participantGroundingInputSignature).toBeNull();
    expect(regressed.chapters).toEqual([]);

    const changedTranscript = checkpointBroadcastContextSessionTranscript(
      grounded,
      {
        completeAudioCoverage: record.completeAudioCoverage,
        chapters: record.chapters,
        gapChunkIds: record.gapChunkIds,
        fragmentGaps: record.fragmentGaps,
        transcriptEvidenceInputSignature:
          record.transcriptEvidenceInputSignature,
        transcriptEvidenceCheckpointJson:
          record.transcriptEvidenceCheckpointJson,
        transcriptProviderReceiptInputSignature:
          record.transcriptProviderReceiptInputSignature,
        transcriptProviderReceiptCheckpointJson:
          record.transcriptProviderReceiptCheckpointJson,
        modelRevision: record.modelRevision,
        transcriptSealOperationKey: record.transcriptSealOperationKey,
        recordedAt: "2026-07-29T07:05:00.000Z",
      },
    );
    expect(changedTranscript.transcriptVisualInspectionCheckpointJson).toBeNull();
    expect(changedTranscript.participantGroundingInputSignature).toBeNull();
    expect(changedTranscript.chapters).toEqual(record.chapters);
  });
});
