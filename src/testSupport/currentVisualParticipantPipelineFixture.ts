import {
  AI_BROADCAST_CONTEXT_ROUTING_REVISION,
} from "../analysis/aiModelRoutingPolicy";
import {
  serializeBroadcastContextPhaseLedger,
  serializeBroadcastContextLedgerJsonValue,
  type BroadcastContextPhaseLedger,
  type BroadcastContextPhaseLedgerJsonValue,
} from "../analysis/broadcastContextPhaseLedger";
import {
  completeBroadcastParticipantPreContext,
  prepareBroadcastParticipantPreContext,
  type BroadcastParticipantPreContextResult,
  type PreparedBroadcastParticipantPreContext,
} from "../analysis/broadcastParticipantPreContextOrchestration";
import {
  createBroadcastParticipantVisualTerminalReceiptFromSettlement,
} from "../analysis/broadcastParticipantGroundingBridge";
import {
  createBroadcastTranscriptProviderReceiptCheckpoint,
  recordBroadcastTranscriptProviderReceipt,
  serializeBroadcastTranscriptProviderReceiptCheckpoint,
} from "../analysis/broadcastTranscriptProviderReceiptCheckpoint";
import {
  BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
  BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
  BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION,
} from "../analysis/broadcastTranscriptQwen";
import {
  createBroadcastTranscriptProviderReceipt,
  createBroadcastTranscriptRouteSelection,
  type BroadcastTranscriptRouteManifest,
} from "../analysis/broadcastTranscriptRouteManifest";
import {
  createBroadcastTranscriptResolvedEvidenceCheckpoint,
  recordBroadcastTranscriptResolvedEvidence,
  serializeBroadcastTranscriptResolvedEvidenceCheckpoint,
  type BroadcastTranscriptResolvedEvidenceCheckpoint,
} from "../analysis/broadcastTranscriptResolvedEvidence";
import {
  BROADCAST_TRANSCRIPT_VISUAL_AUDIO_EXTRACTION_REVISION,
  createBroadcastTranscriptVisualInspectionPlan,
  createBroadcastTranscriptVisualPreparedFrameReceipt,
  createBroadcastTranscriptVisualProviderSettlement,
  createBroadcastTranscriptVisualProviderSettlementLedger,
  recordBroadcastTranscriptVisualProviderSettlement,
  type BroadcastTranscriptVisualInspectionPlan,
  type BroadcastTranscriptVisualPreparedFrameReceipt,
  type BroadcastTranscriptVisualProviderSettlement,
} from "../analysis/broadcastTranscriptVisualInspectionQueue";
import {
  createBroadcastTranscriptVisualInspectionRunnerCheckpoint,
} from "../analysis/broadcastTranscriptVisualInspectionRunner";
import {
  serializeBroadcastTranscriptVisualInspectionRunnerCheckpoint,
} from "../analysis/broadcastTranscriptVisualContextProjection";
import {
  BROADCAST_TOPICAL_DISCOVERY_VERSION,
} from "../analysis/broadcastTopicalDiscovery";
import type { AnalysisPipelineSuccessInput } from "../app/analysisPipelineSuccess";
import {
  createCurrentProviderTranscriptSourceIdentityFence,
  transcriptOperationKey,
} from "../app/transcriptPhase";
import {
  BROADCAST_CONTEXT_FINAL_RESULT_FINGERPRINT_DOMAIN,
  BROADCAST_CONTEXT_UNIT_RESULT_FINGERPRINT_DOMAIN,
} from "../app/durableBroadcastContextPipeline";
import { createContentFingerprint } from "../security/contentFingerprint";
import {
  assertBroadcastContextSessionRecord,
  checkpointBroadcastContextSessionVisualInspection,
  cloneBroadcastContextSessionRecord,
  createBroadcastParticipantGroundingInputSignature,
  parseBroadcastParticipantPreContextCheckpointJson,
  serializeBroadcastParticipantPreContextCheckpoint,
  type BroadcastContextSessionRecord,
  type BroadcastParticipantPreContextCheckpointFence,
} from "../storage/broadcastContextSessionStore";
import { createCandidatePassBPlanReceipt } from "../storage/candidatePassBInsightStore";
import { createVerifiedNoSpeechRunReceiptForTest } from "./broadcastSpeechActivityTestReceipt";
import { createAnalysisPipelineHappyPathFixture } from "./analysisPipelineHappyPathFixture";

export const CURRENT_VISUAL_PARTICIPANT_MODEL_REVISION =
  "qwen3.5-omni-flash-visual-participant-v1" as const;

const TRANSCRIPT_CHAPTER_END_MS = 120_000;
const RECORDED_AT = "2026-07-29T08:00:00.000Z";

const ROUTE_MANIFEST: BroadcastTranscriptRouteManifest = {
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

interface MutableContextEnvelope {
  schemaVersion: string;
  result: {
    semanticChapters: Array<{
      semanticChapterId: string;
      startChapterId: string;
      endChapterId: string;
      startMs: number;
      endMs: number;
      titleKo: string;
      summaryKo: string;
      kind: string;
      salience: string;
      relatedCandidateIds: string[];
      uncertaintiesKo: string[];
    }>;
    coverage: {
      status: "complete" | "partial";
      coveredMs: number;
      coverageRatio: number;
      gaps: Array<{ startMs: number; endMs: number }>;
      partialChapterIds: string[];
    };
  };
  refinementLeadIds: string[];
  fastRefinementLeadIds: string[];
  contextCandidateIds: string[];
}

export interface CurrentVisualParticipantPipelineFixture {
  readonly input: AnalysisPipelineSuccessInput;
  readonly transcriptEvidenceCheckpoint:
    BroadcastTranscriptResolvedEvidenceCheckpoint;
  readonly visualPlan: BroadcastTranscriptVisualInspectionPlan;
  readonly preparedFrameReceipt:
    BroadcastTranscriptVisualPreparedFrameReceipt;
  readonly settlement: BroadcastTranscriptVisualProviderSettlement;
  readonly visualInspectionCheckpointJson: string;
  readonly preparedParticipant: PreparedBroadcastParticipantPreContext;
  readonly participantResult: BroadcastParticipantPreContextResult;
  readonly participantFence: BroadcastParticipantPreContextCheckpointFence;
  readonly participantCheckpointJson: string;
}

function transcriptCells(sourceDurationMs: number) {
  return [
    {
      chunkId: "asr-dialogue-001",
      sourceStartMs: 0,
      sourceEndMs: 60_000,
    },
    {
      chunkId: "asr-dialogue-002",
      sourceStartMs: 60_000,
      sourceEndMs: TRANSCRIPT_CHAPTER_END_MS,
    },
    {
      chunkId: "asr-no-speech-003",
      sourceStartMs: TRANSCRIPT_CHAPTER_END_MS,
      sourceEndMs: sourceDurationMs,
    },
  ] as const;
}

function transcriptChapters() {
  return [
    {
      chapterId: "chapter-1",
      startMs: 0,
      endMs: 60_000,
      evidenceMode: "complete-transcript" as const,
      evidenceCoverageRatio: 1,
      summaryKo:
        "스트리머가 여러 차례 실패한 뒤 차분하게 다음 시도를 준비했다.",
    },
    {
      chapterId: "chapter-2",
      startMs: 60_000,
      endMs: TRANSCRIPT_CHAPTER_END_MS,
      evidenceMode: "complete-transcript" as const,
      evidenceCoverageRatio: 1,
      summaryKo:
        "스트리머가 목표 달성을 확인하고 성공 과정과 결과를 설명했다.",
    },
  ];
}

function fixtureFingerprint(seed: number): string {
  const hexadecimalDigit = ((seed - 1) % 15) + 1;
  return `sha256:${hexadecimalDigit.toString(16).repeat(64)}`;
}

function contextResultJson(
  baseJson: string,
  visualChapterId: string,
  sourceDurationMs: number,
): string {
  const envelope = JSON.parse(baseJson) as MutableContextEnvelope;
  const firstSemanticChapter = envelope.result.semanticChapters[0];
  if (firstSemanticChapter === undefined) {
    throw new TypeError(
      "The current visual participant fixture requires one semantic chapter.",
    );
  }
  envelope.result.semanticChapters = [
    {
      ...firstSemanticChapter,
      semanticChapterId:
        `sc-chapter-1-${visualChapterId}-quiet-achievement`,
      startChapterId: "chapter-1",
      endChapterId: visualChapterId,
      startMs: 0,
      endMs: sourceDurationMs,
    },
  ];
  envelope.result.coverage = {
    status: "partial",
    coveredMs: sourceDurationMs,
    coverageRatio: 1,
    gaps: [],
    partialChapterIds: [visualChapterId],
  };
  return JSON.stringify(envelope);
}

async function contextLedgerJson(input: {
  readonly contextInputSignature: string;
  readonly transcriptSealOperationKey: string;
  readonly participantGroundingInputSignature: string;
  readonly contextResult: BroadcastContextPhaseLedgerJsonValue;
}): Promise<string> {
  const overviewInputDigest = "visual-participant-overview-digest";
  const selectionInputDigest = "visual-participant-jury-digest";
  const selectionResult = {
    kind: "jury-abstained-no-candidates",
    schemaVersion: "1.0.0",
  } as const;
  const contextResultFingerprint = await createContentFingerprint([
    BROADCAST_CONTEXT_FINAL_RESULT_FINGERPRINT_DOMAIN,
    input.contextInputSignature,
    serializeBroadcastContextLedgerJsonValue(input.contextResult),
  ]);
  const ledger: BroadcastContextPhaseLedger = {
    schemaVersion: "3.0.0",
    fence: {
      parentContextSignature: input.contextInputSignature,
      transcriptSignature: input.transcriptSealOperationKey,
      groundingSignature: input.participantGroundingInputSignature,
    },
    units: [
      {
        phase: "discovery",
        unitId: "overview",
        inputDigest: overviewInputDigest,
        operationId: "visual-participant-overview-operation",
        attemptOrdinal: 0,
        required: true,
        status: "succeeded",
        result: input.contextResult,
        modelReceipt: {
          analysisMode: "overview",
          resultFingerprint: await createContentFingerprint([
            BROADCAST_CONTEXT_UNIT_RESULT_FINGERPRINT_DOMAIN,
            overviewInputDigest,
            serializeBroadcastContextLedgerJsonValue(
              input.contextResult,
            ),
          ]),
        },
      },
      {
        phase: "jury",
        unitId: "selection",
        inputDigest: selectionInputDigest,
        operationId: "visual-participant-jury-operation",
        attemptOrdinal: 0,
        required: true,
        status: "succeeded",
        result: selectionResult,
        modelReceipt: {
          analysisMode: "selection",
          resultFingerprint: await createContentFingerprint([
            BROADCAST_CONTEXT_UNIT_RESULT_FINGERPRINT_DOMAIN,
            selectionInputDigest,
            serializeBroadcastContextLedgerJsonValue(selectionResult),
          ]),
          parentContextResultFingerprint: contextResultFingerprint,
        },
      },
    ],
    usedOperationIds: [
      "visual-participant-overview-operation",
      "visual-participant-jury-operation",
    ],
  };
  return serializeBroadcastContextPhaseLedger(ledger);
}

function emptyDescendants(
  session: BroadcastContextSessionRecord,
): BroadcastContextSessionRecord {
  return {
    ...session,
    transcriptVisualInspectionCheckpointJson: null,
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
  };
}

export async function createCurrentVisualParticipantPipelineFixture():
Promise<CurrentVisualParticipantPipelineFixture> {
  const base = await createAnalysisPipelineHappyPathFixture({
    withRefinement: false,
  });
  const sourceDurationMs = base.session.sourceDurationMs;
  const sourceContentFingerprint =
    base.fastResult.result.input.source.contentFingerprint;
  const transcriptSealOperationKey = transcriptOperationKey(
    base.manifest.runId,
    sourceContentFingerprint,
    "event-boost",
    0,
    await createCurrentProviderTranscriptSourceIdentityFence(null),
  );
  const plannedCells = transcriptCells(sourceDurationMs);
  let transcriptEvidenceCheckpoint =
    createBroadcastTranscriptResolvedEvidenceCheckpoint({
      sourceFingerprint: base.session.inputSignature,
      sourceDurationMs,
      transcriptInputSignature: transcriptSealOperationKey,
      modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
      plannedCells,
    });
  transcriptEvidenceCheckpoint =
    recordBroadcastTranscriptResolvedEvidence(
      transcriptEvidenceCheckpoint,
      "asr-no-speech-003",
      "no-speech",
      createVerifiedNoSpeechRunReceiptForTest(
        sourceDurationMs,
        TRANSCRIPT_CHAPTER_END_MS,
        sourceDurationMs,
      ),
    );

  const route = await createBroadcastTranscriptRouteSelection(
    ROUTE_MANIFEST,
  );
  let providerCheckpoint =
    createBroadcastTranscriptProviderReceiptCheckpoint({
      sourceFingerprint: base.session.inputSignature,
      sourceDurationMs,
      route,
      plannedCells,
    });
  const providerReceipt = createBroadcastTranscriptProviderReceipt(
    route,
    BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
    BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
    false,
  );
  for (const [index, cell] of plannedCells.slice(0, 2).entries()) {
    providerCheckpoint = recordBroadcastTranscriptProviderReceipt(
      providerCheckpoint,
      cell.chunkId,
      {
        schemaVersion: BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION,
        modelId: providerReceipt.modelId,
        modelRevision: providerReceipt.modelRevision,
        providerReceipt,
        sourceStartMs: cell.sourceStartMs,
        sourceEndMs: cell.sourceEndMs,
        textKo:
          index === 0
            ? "여러 번 실패했지만 이번에는 차분하게 다시 시도한다."
            : "드디어 성공했고 결과를 확인했다고 설명한다.",
        detectedLanguage: "ko",
        emotion: null,
        billedSeconds: 60,
      },
    );
  }

  const transcriptSession = cloneBroadcastContextSessionRecord({
    ...emptyDescendants(base.session),
    completeAudioCoverage: true,
    chapters: transcriptChapters(),
    gapChunkIds: [],
    fragmentGaps: [],
    transcriptEvidenceInputSignature: transcriptSealOperationKey,
    transcriptEvidenceCheckpointJson:
      serializeBroadcastTranscriptResolvedEvidenceCheckpoint(
        transcriptEvidenceCheckpoint,
      ),
    transcriptProviderReceiptInputSignature: route.fingerprint,
    transcriptProviderReceiptCheckpointJson:
      serializeBroadcastTranscriptProviderReceiptCheckpoint(
        providerCheckpoint,
      ),
    modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
    sourceCastRosterId: null,
    transcriptSealOperationKey,
    recordedAt: RECORDED_AT,
  });

  const visualPlan = createBroadcastTranscriptVisualInspectionPlan(
    transcriptEvidenceCheckpoint,
  );
  const visualCell = visualPlan.cells.find(
    ({ transcriptChunkId }) => transcriptChunkId === "asr-no-speech-003",
  );
  if (
    visualCell === undefined ||
    visualCell.inspectionPurpose !== "transcript-abstention" ||
    visualCell.transcriptAbstentionReason !== "no-speech"
  ) {
    throw new TypeError(
      "The current fixture must route the no-speech cell to visual inspection.",
    );
  }
  const preparedFrameReceipt =
    createBroadcastTranscriptVisualPreparedFrameReceipt({
      plan: visualPlan,
      cellId: visualCell.cellId,
      frameContentFingerprints: [
        `sha256:${"1".repeat(64)}`,
        `sha256:${"2".repeat(64)}`,
        `sha256:${"3".repeat(64)}`,
        `sha256:${"4".repeat(64)}`,
      ],
      audioEvidence: {
        sourceStartMs: visualCell.sourceStartMs,
        sourceEndMs: visualCell.sourceEndMs,
        codec: "audio/wav;codecs=pcm_s16le",
        extractionRevision:
          BROADCAST_TRANSCRIPT_VISUAL_AUDIO_EXTRACTION_REVISION,
        contentFingerprint: `sha256:${"5".repeat(64)}`,
      },
    });
  const settlement =
    createBroadcastTranscriptVisualProviderSettlement({
      plan: visualPlan,
      cellId: visualCell.cellId,
      preparedFrameReceipt,
      providerModelRevision:
        CURRENT_VISUAL_PARTICIPANT_MODEL_REVISION,
      operationId: "visual-participant-operation-1",
      attemptOrdinal: 0,
      outcome: "completed",
      editorialFinding: "quiet-success",
      summaryKo:
        "대사가 없는 뒤쪽 네 화면에서 성공 결과가 유지되고 다음 장면으로 전환된다.",
      providerResponseFingerprint: `sha256:${"6".repeat(64)}`,
      participantOutcome: {
        presence: "none-present",
        summaryKo:
          "검토한 네 화면에는 식별 가능한 등장인물이 보이지 않는다.",
        participants: [],
      },
    });
  const additionalPreparedFrameReceipts = visualPlan.cells
    .filter(({ cellId }) => cellId !== visualCell.cellId)
    .map((cell, cellIndex) =>
      createBroadcastTranscriptVisualPreparedFrameReceipt({
        plan: visualPlan,
        cellId: cell.cellId,
        frameContentFingerprints: [
          fixtureFingerprint(cellIndex * 5 + 6),
          fixtureFingerprint(cellIndex * 5 + 7),
          fixtureFingerprint(cellIndex * 5 + 8),
          fixtureFingerprint(cellIndex * 5 + 9),
        ],
        audioEvidence: {
          sourceStartMs: cell.sourceStartMs,
          sourceEndMs: cell.sourceEndMs,
          codec: "audio/wav;codecs=pcm_s16le",
          extractionRevision:
            BROADCAST_TRANSCRIPT_VISUAL_AUDIO_EXTRACTION_REVISION,
          contentFingerprint: fixtureFingerprint(cellIndex * 5 + 10),
        },
      }),
    );
  const additionalSettlements =
    additionalPreparedFrameReceipts.map((receipt, cellIndex) =>
      createBroadcastTranscriptVisualProviderSettlement({
        plan: visualPlan,
        cellId: receipt.cellId,
        preparedFrameReceipt: receipt,
        providerModelRevision:
          CURRENT_VISUAL_PARTICIPANT_MODEL_REVISION,
        operationId: `visual-participant-operation-${cellIndex + 2}`,
        attemptOrdinal: 0,
        outcome: "completed",
        editorialFinding: "quiet-success",
        summaryKo:
          "Four prepared frames and matching audio evidence were reviewed.",
        providerResponseFingerprint:
          fixtureFingerprint(cellIndex * 5 + 11),
        participantOutcome: {
          presence: "none-present",
          summaryKo:
            "No visually identifiable participant is present in the reviewed frames.",
          participants: [],
        },
      }),
    );
  const providerLedger =
    recordBroadcastTranscriptVisualProviderSettlement(
      createBroadcastTranscriptVisualProviderSettlementLedger(visualPlan),
      visualPlan,
      settlement,
    );
  const completeProviderLedger = additionalSettlements.reduce(
    (ledger, additionalSettlement) =>
      recordBroadcastTranscriptVisualProviderSettlement(
        ledger,
        visualPlan,
        additionalSettlement,
      ),
    providerLedger,
  );
  const visualInspectionCheckpointJson =
    serializeBroadcastTranscriptVisualInspectionRunnerCheckpoint(
      createBroadcastTranscriptVisualInspectionRunnerCheckpoint({
        plan: visualPlan,
        revision: 2,
        preparedFrameReceipts: [
          preparedFrameReceipt,
          ...additionalPreparedFrameReceipts,
        ],
        providerLedger: completeProviderLedger,
      }),
      visualPlan,
    );
  const visualSession =
    checkpointBroadcastContextSessionVisualInspection(
      transcriptSession,
      {
        transcriptVisualInspectionCheckpointJson:
          visualInspectionCheckpointJson,
        recordedAt: RECORDED_AT,
      },
    );

  const preparedParticipant =
    await prepareBroadcastParticipantPreContext({
      sourceFingerprint: visualSession.inputSignature,
      sourceDurationMs,
      transcriptSeal: transcriptSealOperationKey,
      castRosterId: null,
      dialogueChapters: transcriptChapters(),
      transcriptModelRevision:
        BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
      visualReferenceManifest: null,
      visualRuntime: {
        adapterRevision: "four-frame-participant-visual-runtime-v1",
        modelRevision: CURRENT_VISUAL_PARTICIPANT_MODEL_REVISION,
        cells: visualPlan.cells.map((cell) => ({
          sourceStartMs: cell.sourceStartMs,
          sourceEndMs: cell.sourceEndMs,
          sourceUnitId: cell.cellId,
          frameTimestampsMs: cell.frameTimestampsMs,
        })),
      },
    });
  const participantVisualAdapter =
    preparedParticipant.plan.adapters.find(
      ({ adapter }) => adapter === "visual-identity",
    );
  if (
    participantVisualAdapter?.availability !== "enabled" ||
    participantVisualAdapter.cells.length !== visualPlan.cells.length
  ) {
    throw new TypeError(
      "The current fixture requires one participant cell for every visual inspection cell.",
    );
  }
  const allSettlements = [settlement, ...additionalSettlements];
  const visualTerminalReceipts = participantVisualAdapter.cells.map(
    (participantCell) => {
      const matchingSettlement = allSettlements.find(
        ({ cellId }) => cellId === participantCell.sourceUnitId,
      );
      if (matchingSettlement === undefined) {
        throw new TypeError(
          "Every participant visual cell requires its matching terminal settlement.",
        );
      }
      return createBroadcastParticipantVisualTerminalReceiptFromSettlement({
        participantPlan: preparedParticipant.plan,
        participantCellId: participantCell.cellId,
        visualInspectionPlan: visualPlan,
        settlement: matchingSettlement,
      });
    },
  );
  const participantResult =
    completeBroadcastParticipantPreContext(preparedParticipant, {
      visualTerminalReceipts,
    });
  const participantFence: BroadcastParticipantPreContextCheckpointFence = {
    sourceDurationMs,
    sourceCastRosterId: null,
    transcriptSealOperationKey,
    dialogueChapters: transcriptChapters(),
    participantGroundingPlanFingerprint:
      participantResult.planFingerprint,
  };
  const participantCheckpointJson =
    await serializeBroadcastParticipantPreContextCheckpoint(
      participantResult,
      participantFence,
    );
  const participantReadback =
    await parseBroadcastParticipantPreContextCheckpointJson(
      participantCheckpointJson,
      participantFence,
    );
  if (
    participantReadback === null ||
    JSON.stringify(participantReadback) !==
      JSON.stringify(participantResult)
  ) {
    throw new TypeError(
      "The full participant checkpoint did not survive exact serialization and replay.",
    );
  }
  const participantGroundingInputSignature =
    await createBroadcastParticipantGroundingInputSignature({
      inputSignature: visualSession.inputSignature,
      transcriptSealOperationKey,
      participantGroundingPlanFingerprint:
        participantResult.planFingerprint,
      participantGroundingCheckpointJson:
        participantCheckpointJson,
    });
  const participantSession = cloneBroadcastContextSessionRecord({
    ...visualSession,
    participantGroundingInputSignature,
    participantGroundingPlanFingerprint:
      participantResult.planFingerprint,
    participantGroundingCheckpointJson:
      participantCheckpointJson,
  });

  if (
    base.session.contextInputCheckpointJson === null ||
    base.session.contextResultJson === null
  ) {
    throw new TypeError(
      "The base success fixture requires complete context artifacts.",
    );
  }
  const baseContextInput = JSON.parse(
    base.session.contextInputCheckpointJson,
  ) as Record<string, unknown>;
  const contextInputCheckpointJson = JSON.stringify({
    ...baseContextInput,
    chapters: participantSession.chapters,
    participantGrounding: participantResult.grounding,
  });
  const contextInputSignature = await createContentFingerprint([
    participantSession.inputSignature,
    contextInputCheckpointJson,
    participantGroundingInputSignature,
    `broadcast-context-routing:${AI_BROADCAST_CONTEXT_ROUTING_REVISION}`,
    `topical-discovery:${BROADCAST_TOPICAL_DISCOVERY_VERSION}`,
  ]);
  const finalContextResultJson = contextResultJson(
    base.session.contextResultJson,
    visualCell.cellId,
    sourceDurationMs,
  );
  const finalContextEnvelope = JSON.parse(finalContextResultJson) as {
    readonly result: unknown;
  };
  const finalContextResult = JSON.parse(
    serializeBroadcastContextLedgerJsonValue(
      finalContextEnvelope.result,
    ),
  ) as BroadcastContextPhaseLedgerJsonValue;
  const finalSession = cloneBroadcastContextSessionRecord({
    ...participantSession,
    contextInputSignature,
    contextInputCheckpointJson,
    contextPhaseLedgerJson: await contextLedgerJson({
      contextInputSignature,
      transcriptSealOperationKey,
      participantGroundingInputSignature,
      contextResult: finalContextResult,
    }),
    contextResultJson: finalContextResultJson,
    recordedAt: RECORDED_AT,
  });
  assertBroadcastContextSessionRecord(finalSession);
  if (base.candidateRecord === null) {
    throw new TypeError(
      "The base success fixture requires a durable candidate plan.",
    );
  }
  const currentCandidateRecord = {
    ...base.candidateRecord,
    planReceipt: await createCandidatePassBPlanReceipt({
      runId: base.manifest.runId,
      inputSignature: base.manifest.inputSignature,
      contextInputSignature,
      refinementEvidenceProjectionFingerprint:
        base.candidateRecord.planReceipt
          .refinementEvidenceProjectionFingerprint,
      plannedCandidateIds:
        base.candidateRecord.planReceipt.plannedCandidateIds,
      contextByCandidateId: base.candidateRecord.contextByCandidateId,
    }),
  };

  return {
    input: {
      ...base,
      session: finalSession,
      candidateRecord: currentCandidateRecord,
    },
    transcriptEvidenceCheckpoint,
    visualPlan,
    preparedFrameReceipt,
    settlement,
    visualInspectionCheckpointJson,
    preparedParticipant,
    participantResult,
    participantFence,
    participantCheckpointJson,
  };
}
