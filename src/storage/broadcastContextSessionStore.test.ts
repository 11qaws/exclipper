import { describe, expect, it } from "vitest";
import {
  BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
  MAX_CONTEXT_PHASE_LEDGER_CHECKPOINT_BYTES,
  assertBroadcastContextSessionRecord,
  checkpointBroadcastContextSessionPhaseLedger,
  checkpointBroadcastContextSessionRefinementEvidenceLedger,
  checkpointBroadcastContextSessionRefinementTranscript,
  checkpointBroadcastContextSessionTranscript,
  cloneBroadcastContextSessionRecord,
  commitBroadcastContextSessionContext,
  createBroadcastParticipantGroundingInputSignature,
  invalidateBroadcastContextSessionContext,
  parseBroadcastContextSessionRefinementEvidenceLedger,
  reconcileBroadcastContextSessionRefinementEvidenceLifecycle,
  type BroadcastContextSessionRecord,
} from "./broadcastContextSessionStore";
import { createBroadcastParticipantGrounding } from "../analysis/broadcastParticipantGrounding";
import { compactBroadcastContextChapters } from "../analysis/broadcastContextChapterCompaction";
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
  rebaseBroadcastTranscriptResolvedEvidenceModelRevision,
  recordBroadcastTranscriptResolvedEvidence,
  serializeBroadcastTranscriptResolvedEvidenceCheckpoint,
} from "../analysis/broadcastTranscriptResolvedEvidence";
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

const record: BroadcastContextSessionRecord = {
  kind: "broadcastContextSession",
  runId: "run-1",
  schemaVersion: BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
  inputSignature: "source-signature",
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
  transcriptProviderReceiptInputSignature: null,
  transcriptProviderReceiptCheckpointJson: null,
  modelRevision: "qwen3-asr-flash-api-reviewed-2026-07-22",
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

function completedContextRecord(): BroadcastContextSessionRecord {
  const participantGrounding = createBroadcastParticipantGrounding({
    sourceDurationMs: record.sourceDurationMs,
    castRosterId: record.sourceCastRosterId,
    chapters: record.chapters,
  });
  return {
    ...record,
    transcriptSealOperationKey: "run-1:source:event-boost:attempt-0",
    participantGroundingInputSignature: "participant-signature",
    participantGroundingPlanFingerprint: "participant-plan-fingerprint-v1",
    participantGroundingCheckpointJson: JSON.stringify(participantGrounding),
    contextInputSignature: "context-signature-v1",
    contextInputCheckpointJson: JSON.stringify({
      sourceDurationMs: record.sourceDurationMs,
      chapters: record.chapters,
      candidates: [],
      participantGrounding,
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
      schemaVersion: "1.0.0",
      serviceVersion: 5,
      routingPolicyVersion: "1.11.0",
      providerConfigurationVersion: "1.3.0",
      transportVersion: 2,
      transportMode: "free-r2",
      maximumChunkDurationMs: 90_000,
      primaryMediaType: "audio/wav",
      provider: "qwen",
      modelId: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
      modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
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
      schemaVersion: "1.0.0",
      serviceVersion: 5,
      routingPolicyVersion: "1.11.0",
      providerConfigurationVersion: "1.3.0",
      transportVersion: 2,
      transportMode: "paid-direct",
      maximumChunkDurationMs: 90_000,
      primaryMediaType: "audio/wav",
      provider: "qwen",
      modelId: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
      modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
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
      "broadcast-transcript-mixed-v1:",
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

  it("migrates a legacy 1.2 checkpoint without discarding paid chapters", () => {
    const legacy: Record<string, unknown> = {
      ...record,
      schemaVersion: "1.2.0",
    };
    Reflect.deleteProperty(legacy, "fragmentGaps");
    Reflect.deleteProperty(legacy, "participantGroundingInputSignature");
    Reflect.deleteProperty(legacy, "participantGroundingCheckpointJson");
    Reflect.deleteProperty(legacy, "sourceCastRosterId");
    Reflect.deleteProperty(legacy, "transcriptSealOperationKey");
    Reflect.deleteProperty(legacy, "contextInputCheckpointJson");
    Reflect.deleteProperty(legacy, "contextPhaseLedgerJson");
    Reflect.deleteProperty(legacy, "refinementTranscriptInputSignature");
    Reflect.deleteProperty(legacy, "refinementTranscriptCheckpointJson");
    Reflect.deleteProperty(legacy, "transcriptEvidenceInputSignature");
    Reflect.deleteProperty(legacy, "transcriptEvidenceCheckpointJson");
    expect(cloneBroadcastContextSessionRecord(legacy)).toMatchObject({
      schemaVersion: BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
      chapters: record.chapters,
      gapChunkIds: [],
      fragmentGaps: [],
      participantGroundingInputSignature: null,
      participantGroundingCheckpointJson: null,
      sourceCastRosterId: null,
      transcriptSealOperationKey: null,
      contextInputCheckpointJson: null,
      contextPhaseLedgerJson: null,
      refinementTranscriptInputSignature: null,
      refinementTranscriptCheckpointJson: null,
    });
  });

  it("migrates a legacy 1.3 checkpoint without discarding paid context", () => {
    const legacy: Record<string, unknown> = {
      ...record,
      schemaVersion: "1.3.0",
      contextInputSignature: "context-signature",
      contextResultJson: JSON.stringify({ schemaVersion: "1.6.0" }),
    };
    Reflect.deleteProperty(legacy, "participantGroundingInputSignature");
    Reflect.deleteProperty(legacy, "participantGroundingCheckpointJson");
    Reflect.deleteProperty(legacy, "sourceCastRosterId");
    Reflect.deleteProperty(legacy, "transcriptSealOperationKey");
    Reflect.deleteProperty(legacy, "contextInputCheckpointJson");
    Reflect.deleteProperty(legacy, "contextPhaseLedgerJson");
    Reflect.deleteProperty(legacy, "refinementTranscriptInputSignature");
    Reflect.deleteProperty(legacy, "refinementTranscriptCheckpointJson");
    Reflect.deleteProperty(legacy, "transcriptEvidenceInputSignature");
    Reflect.deleteProperty(legacy, "transcriptEvidenceCheckpointJson");
    expect(cloneBroadcastContextSessionRecord(legacy)).toMatchObject({
      schemaVersion: BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
      participantGroundingInputSignature: null,
      participantGroundingCheckpointJson: null,
      sourceCastRosterId: null,
      transcriptSealOperationKey: null,
      contextInputCheckpointJson: null,
      contextPhaseLedgerJson: null,
      refinementTranscriptInputSignature: null,
      refinementTranscriptCheckpointJson: null,
      contextInputSignature: "context-signature",
      contextResultJson: JSON.stringify({ schemaVersion: "1.6.0" }),
    });
  });

  it("migrates an unpublished 1.4 checkpoint without treating old context as exactly bound", () => {
    const legacy: Record<string, unknown> = {
      ...record,
      schemaVersion: "1.4.0",
      contextInputSignature: "context-signature",
      contextResultJson: JSON.stringify({ schemaVersion: "1.7.0" }),
    };
    Reflect.deleteProperty(legacy, "sourceCastRosterId");
    Reflect.deleteProperty(legacy, "transcriptSealOperationKey");
    Reflect.deleteProperty(legacy, "contextInputCheckpointJson");
    Reflect.deleteProperty(legacy, "contextPhaseLedgerJson");
    Reflect.deleteProperty(legacy, "refinementTranscriptInputSignature");
    Reflect.deleteProperty(legacy, "refinementTranscriptCheckpointJson");
    Reflect.deleteProperty(legacy, "transcriptEvidenceInputSignature");
    Reflect.deleteProperty(legacy, "transcriptEvidenceCheckpointJson");

    expect(cloneBroadcastContextSessionRecord(legacy)).toMatchObject({
      schemaVersion: BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
      sourceCastRosterId: null,
      transcriptSealOperationKey: null,
      contextInputSignature: "context-signature",
      contextInputCheckpointJson: null,
      contextPhaseLedgerJson: null,
      refinementTranscriptInputSignature: null,
      refinementTranscriptCheckpointJson: null,
      contextResultJson: JSON.stringify({ schemaVersion: "1.7.0" }),
    });
  });

  it("migrates a 1.5 checkpoint with an explicitly empty phase ledger", () => {
    const legacy: Record<string, unknown> = {
      ...completedContextRecord(),
      schemaVersion: "1.5.0",
    };
    Reflect.deleteProperty(legacy, "contextPhaseLedgerJson");
    Reflect.deleteProperty(legacy, "refinementTranscriptInputSignature");
    Reflect.deleteProperty(legacy, "refinementTranscriptCheckpointJson");
    Reflect.deleteProperty(legacy, "transcriptEvidenceInputSignature");
    Reflect.deleteProperty(legacy, "transcriptEvidenceCheckpointJson");

    expect(cloneBroadcastContextSessionRecord(legacy)).toMatchObject({
      schemaVersion: BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
      contextInputSignature: "context-signature-v1",
      contextPhaseLedgerJson: null,
      refinementTranscriptInputSignature: null,
      refinementTranscriptCheckpointJson: null,
      contextResultJson: JSON.stringify({ schemaVersion: "1.7.0" }),
    });
  });

  it("migrates a 1.6 checkpoint with no refinement transcript checkpoint", () => {
    const legacy: Record<string, unknown> = {
      ...completedContextRecord(),
      schemaVersion: "1.6.0",
    };
    Reflect.deleteProperty(legacy, "refinementTranscriptInputSignature");
    Reflect.deleteProperty(legacy, "refinementTranscriptCheckpointJson");
    Reflect.deleteProperty(legacy, "transcriptEvidenceInputSignature");
    Reflect.deleteProperty(legacy, "transcriptEvidenceCheckpointJson");

    expect(cloneBroadcastContextSessionRecord(legacy)).toMatchObject({
      schemaVersion: BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
      contextInputSignature: "context-signature-v1",
      contextResultJson: JSON.stringify({ schemaVersion: "1.7.0" }),
      refinementTranscriptInputSignature: null,
      refinementTranscriptCheckpointJson: null,
    });
  });

  it("migrates a legacy 1.7 checkpoint without inventing resolved abstention evidence", () => {
    const legacy: Record<string, unknown> = {
      ...record,
      schemaVersion: "1.7.0",
    };
    Reflect.deleteProperty(legacy, "transcriptEvidenceInputSignature");
    Reflect.deleteProperty(legacy, "transcriptEvidenceCheckpointJson");

    expect(cloneBroadcastContextSessionRecord(legacy)).toMatchObject({
      schemaVersion: BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
      chapters: record.chapters,
      transcriptEvidenceInputSignature: null,
      transcriptEvidenceCheckpointJson: null,
    });
  });

  it("migrates a legacy 1.8 checkpoint without inventing provider receipts", () => {
    const legacy: Record<string, unknown> = {
      ...record,
      schemaVersion: "1.8.0",
    };
    Reflect.deleteProperty(
      legacy,
      "transcriptProviderReceiptInputSignature",
    );
    Reflect.deleteProperty(
      legacy,
      "transcriptProviderReceiptCheckpointJson",
    );

    expect(cloneBroadcastContextSessionRecord(legacy)).toMatchObject({
      schemaVersion: BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
      chapters: record.chapters,
      transcriptEvidenceInputSignature: null,
      transcriptEvidenceCheckpointJson: null,
      transcriptProviderReceiptInputSignature: null,
      transcriptProviderReceiptCheckpointJson: null,
    });
  });

  it("migrates a legacy 1.9 checkpoint without inventing a participant plan fence", () => {
    const legacy: Record<string, unknown> = {
      ...completedContextRecord(),
      schemaVersion: "1.9.0",
    };
    Reflect.deleteProperty(legacy, "participantGroundingPlanFingerprint");

    expect(cloneBroadcastContextSessionRecord(legacy)).toMatchObject({
      schemaVersion: BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
      participantGroundingInputSignature: "participant-signature",
      participantGroundingPlanFingerprint: null,
      participantGroundingCheckpointJson:
        completedContextRecord().participantGroundingCheckpointJson,
      contextInputSignature: "context-signature-v1",
      contextResultJson: JSON.stringify({ schemaVersion: "1.7.0" }),
    });
  });

  it("does not derive a new paid context from a migrated session without its original plan fence", () => {
    const legacy: Record<string, unknown> = {
      ...completedContextRecord(),
      schemaVersion: "1.9.0",
    };
    Reflect.deleteProperty(legacy, "participantGroundingPlanFingerprint");
    const migrated = cloneBroadcastContextSessionRecord(legacy);

    expect(() =>
      commitBroadcastContextSessionContext(migrated, {
        contextInputSignature: "context-signature-v2",
        contextInputCheckpointJson:
          migrated.contextInputCheckpointJson as string,
        contextResultJson: JSON.stringify({ schemaVersion: "1.7.0" }),
        recordedAt: "2026-07-29T00:01:00.000Z",
      }),
    ).toThrow("grounding plan");
  });

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

  it("round-trips only an exact source-bound participant grounding pair", () => {
    const grounding = createBroadcastParticipantGrounding({
      sourceDurationMs: record.sourceDurationMs,
      castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      chapters: record.chapters,
    });
    const groundedRecord = {
      ...record,
      sourceCastRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      transcriptSealOperationKey: "run-1:source:event-boost:attempt-0",
      participantGroundingInputSignature: "participant-signature",
      participantGroundingPlanFingerprint: "participant-plan-fingerprint-v1",
      participantGroundingCheckpointJson: JSON.stringify(grounding),
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
          ...grounding,
          resolutionStatus: "no-source-roster",
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
    const grounding = createBroadcastParticipantGrounding({
      sourceDurationMs: record.sourceDurationMs,
      castRosterId: null,
      chapters: record.chapters,
    });
    const contextInputCheckpointJson = JSON.stringify({
      sourceDurationMs: record.sourceDurationMs,
      chapters: record.chapters,
      candidates: [],
      participantGrounding: grounding,
      outputLanguage: "ko",
    });
    const checkpointed = {
      ...record,
      transcriptSealOperationKey: "run-1:source:event-boost:attempt-0",
      participantGroundingInputSignature: "participant-signature",
      participantGroundingPlanFingerprint: "participant-plan-fingerprint-v1",
      participantGroundingCheckpointJson: JSON.stringify(grounding),
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
      schemaVersion: "1.0.0",
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

  it("round-trips a grounded transcript map larger than the 144-chapter request projection", () => {
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
    const grounding = createBroadcastParticipantGrounding({
      sourceDurationMs: longRecordBase.sourceDurationMs,
      castRosterId: null,
      chapters: compactBroadcastContextChapters(longChapters),
    });
    const longRecord = {
      ...longRecordBase,
      participantGroundingInputSignature: "participant-signature",
      participantGroundingPlanFingerprint: "participant-plan-fingerprint-v1",
      participantGroundingCheckpointJson: JSON.stringify(grounding),
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

  it("preserves an empty transcript map when every sampled chunk is an explicit gap", () => {
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
    ).not.toThrow();
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

  it("migrates schema 1.10 sessions with an explicit empty refinement evidence ledger", () => {
    const legacy = { ...record } as unknown as Record<string, unknown>;
    legacy.schemaVersion = "1.10.0";
    delete legacy.refinementEvidenceLedgerJson;

    expect(cloneBroadcastContextSessionRecord(legacy)).toMatchObject({
      schemaVersion: BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
      refinementEvidenceLedgerJson: null,
      participantGroundingPlanFingerprint: null,
    });
  });

  it("preserves paid chapters but reopens descendants of a legacy no-speech checkpoint without VAD receipts", () => {
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
    const migrated = cloneBroadcastContextSessionRecord({
      ...completedContextRecord(),
      transcriptEvidenceInputSignature: "legacy-transcript-operation",
      transcriptEvidenceCheckpointJson:
        JSON.stringify(currentCheckpoint),
      transcriptSealOperationKey: "legacy-transcript-operation",
    });

    expect(migrated.chapters).toEqual(
      completedContextRecord().chapters,
    );
    expect(migrated).toMatchObject({
      transcriptEvidenceInputSignature: null,
      transcriptEvidenceCheckpointJson: null,
      transcriptSealOperationKey: null,
      participantGroundingInputSignature: null,
      participantGroundingPlanFingerprint: null,
      participantGroundingCheckpointJson: null,
      contextInputSignature: null,
      contextInputCheckpointJson: null,
      contextPhaseLedgerJson: null,
      contextResultJson: null,
      refinementEvidenceLedgerJson: null,
      refinementInputSignature: null,
      refinementCandidatesJson: null,
    });
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
});
