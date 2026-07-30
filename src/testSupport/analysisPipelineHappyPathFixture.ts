import {
  AI_MODEL_ROUTING_POLICY_VERSION,
  AI_BROADCAST_CONTEXT_ROUTING_REVISION,
} from "../analysis/aiModelRoutingPolicy";
import type { CandidatePassBEvidence } from "../analysis/candidatePassB";
import { buildCandidatePassBEvidence } from "../analysis/candidatePassB";
import {
  candidatePassBContextFingerprint,
  createCandidatePassBContextPacket,
  createCandidatePassBVerificationReceipt,
} from "../analysis/candidateFinalVerification";
import {
  createCandidatePassBInitialAttemptLedger,
} from "../analysis/candidatePassBAttemptLedger";
import {
  CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION,
  createCandidatePassBPlanReceipt,
  type CandidatePassBInsightsRecord,
} from "../storage/candidatePassBInsightStore";
import {
  CANDIDATE_PASS_B_QWEN_MODEL_ID,
  CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
  CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
  CANDIDATE_PASS_B_AUDIO_GATE_REVISION,
  CANDIDATE_PASS_B_DISPATCH_INTENT_SCHEMA_VERSION,
  CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
  CANDIDATE_PASS_B_MEDIA_RECEIPT_SCHEMA_VERSION,
  CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION,
  type CandidatePassBContextPacket,
} from "../analysis/candidatePassBWorkerProtocol";
import {
  completeBroadcastParticipantPreContext,
  prepareBroadcastParticipantPreContext,
} from "../analysis/broadcastParticipantPreContextOrchestration";
import {
  createBroadcastParticipantVisualTerminalReceiptFromSettlement,
} from "../analysis/broadcastParticipantGroundingBridge";
import {
  BROADCAST_TOPICAL_DISCOVERY_VERSION,
} from "../analysis/broadcastTopicalDiscovery";
import {
  activateBroadcastRefinementEvidenceRoute,
  appendBroadcastRefinementEvidenceRouteEntry,
  createBroadcastRefinementEvidenceLedger,
  getBroadcastRefinementActiveEvidencePayload,
  projectBroadcastRefinementActiveEvidenceRoute,
  serializeBroadcastRefinementEvidenceLedger,
} from "../analysis/broadcastRefinementEvidenceLedger";
import {
  createDiscoveredLeadRefinementPlan,
} from "../analysis/discoveredLeadRefinement";
import {
  parseBroadcastContextPhaseLedgerJson,
  serializeBroadcastContextPhaseLedger,
  serializeBroadcastContextLedgerJsonValue,
  type BroadcastContextPhaseLedger,
  type BroadcastContextPhaseLedgerJsonValue,
  type BroadcastContextPhaseLedgerUnit,
} from "../analysis/broadcastContextPhaseLedger";
import {
  BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
  BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
  MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS,
} from "../analysis/broadcastTranscriptQwen";
import {
  BROADCAST_TRANSCRIPT_HEALTH_SERVICE_VERSION,
  BROADCAST_TRANSCRIPT_PRIMARY_MEDIA_TYPE,
  BROADCAST_TRANSCRIPT_PROVIDER_CONFIGURATION_VERSION,
  BROADCAST_TRANSCRIPT_ROUTE_MANIFEST_SCHEMA_VERSION,
  BROADCAST_TRANSCRIPT_TRANSPORT_VERSION,
  createBroadcastTranscriptRouteSelection,
  type BroadcastTranscriptRouteManifest,
} from "../analysis/broadcastTranscriptRouteManifest";
import {
  broadcastTranscriptProviderReceiptCheckpointModelRevision,
  createBroadcastTranscriptProviderReceiptCheckpoint,
  recordBroadcastTranscriptCaptionReceipt,
  serializeBroadcastTranscriptProviderReceiptCheckpoint,
} from "../analysis/broadcastTranscriptProviderReceiptCheckpoint";
import {
  createBroadcastTranscriptResolvedEvidenceCheckpoint,
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
import {
  createBroadcastTranscriptVisualInspectionRunnerCheckpoint,
} from "../analysis/broadcastTranscriptVisualInspectionRunner";
import {
  serializeBroadcastTranscriptVisualInspectionRunnerCheckpoint,
} from "../analysis/broadcastTranscriptVisualContextProjection";
import {
  YOUTUBE_CAPTION_MODEL_REVISION,
  createYouTubeCaptionTranscriptCellOutcomes,
} from "../analysis/youtubeCaptionTrack";
import { createContentFingerprint } from "../security/contentFingerprint";
import {
  BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
  createBroadcastParticipantGroundingInputSignature,
  serializeBroadcastParticipantPreContextCheckpoint,
  type BroadcastContextSessionRecord,
} from "../storage/broadcastContextSessionStore";
import type {
  AnalysisManifestRecord,
  AnalysisTerminalRecord,
  FinalAnalysisResultRecord,
} from "../storage/analysisResultStore";
import type { DurableFinalResultPayload } from "../storage/durableAnalysisPayload";
import {
  CURRENT_FAST_PASS_MODEL_MANIFEST_HASH,
  type AnalysisPipelineSuccessInput,
  type CertifiableCandidate,
} from "../app/analysisPipelineSuccess";
import {
  BROADCAST_CONTEXT_FINAL_RESULT_FINGERPRINT_DOMAIN,
  BROADCAST_CONTEXT_UNIT_RESULT_FINGERPRINT_DOMAIN,
} from "../app/durableBroadcastContextPipeline";
import {
  activeRefinementEvidenceTranscripts,
  createSemanticRefinementAiInputSignature,
  createSemanticRefinementLeadInputs,
} from "../app/semanticRefinementEvidence";
import {
  createCurrentProviderTranscriptSourceIdentityFence,
  transcriptOperationKey,
} from "../app/transcriptPhase";

const RUN_ID = "run-success-certificate-1";
const INPUT_SIGNATURE = `sha256:${"a".repeat(64)}`;
const SOURCE_CONTENT_FINGERPRINT =
  `local-file-sampled-sha256-v1:${"b".repeat(64)}`;
const SOURCE_DURATION_MS = 180_000;
const RECORDED_AT = "2026-07-29T00:00:00.000Z";
const FAST_MODEL_MANIFEST = CURRENT_FAST_PASS_MODEL_MANIFEST_HASH;
const CANDIDATE_ID = "highlight-audio-1234abcd";
const HAPPY_PATH_VISUAL_MODEL_REVISION =
  "qwen3.5-omni-flash-happy-path-visual-v1" as const;

function fixtureSha256(index: number): `sha256:${string}` {
  const nibble = (index % 16).toString(16);
  return `sha256:${nibble.repeat(64)}`;
}

const candidate: CertifiableCandidate = {
  id: CANDIDATE_ID,
  startMs: 60_000,
  peakMs: 82_000,
  endMs: 105_000,
  score: 0.94,
  reason: "차분한 성공 뒤 스트리머의 분명한 반응이 이어진 구간",
  signalKinds: ["audio"],
  evidence: {
    normalization: "within-signal-rank-and-mad",
    audio: {
      rankPercentile: 1,
      robustPercentile: 0.9,
      normalizedScore: 0.96,
      eventKind: "sustained-vocal-reaction",
      rmsLiftRatio: 3.2,
      sustainedWindowCount: 4,
      clickPenalty: 0,
      backgroundPenalty: 0.1,
    },
  },
  reviewState: "unreviewed",
};

function durableFastPayload(): DurableFinalResultPayload {
  return {
    input: {
      source: {
        sourceDefinitionId: "source-definition-success-1",
        contentFingerprint: SOURCE_CONTENT_FINGERPRINT,
        captionVideoId: "abcdefghijk",
        sizeBytes: 8_000_000,
        durationMs: SOURCE_DURATION_MS,
        kind: "video",
        container: "mp4",
      },
      chat: {
        timestampBasis: "unknown",
        importedRowCount: 0,
        offsetMs: 0,
      },
      candidateWindowMs: 45_000,
    },
    summary: {
      plannedFrameCount: 6,
      sampledFrameCount: 6,
      analyzedTransitionCount: 5,
      analyzedChatMessageCount: 0,
      outOfRangeChatMessageCount: 0,
      skippedChatMessageCount: 0,
      chatGapReasonCode: null,
      plannedAudioWindowCount: 6,
      analyzedAudioWindowCount: 6,
      audioGapReasonCode: null,
      candidateCount: 1,
    },
    coverage: {
      visualPlannedSampleCount: 6,
      visualCompletedSampleCount: 6,
      visualCoverageComplete: true,
      chatPlannedMessageCount: 0,
      chatProcessedMessageCount: 0,
      chatCoverageComplete: true,
      chatGapReasonCode: null,
      audioPlannedWindowCount: 6,
      audioProcessedWindowCount: 6,
      audioCoverageComplete: true,
      audioGapReasonCode: null,
      signalGapApproval: null,
      activeTaskCountAtCommit: 0,
    },
    candidates: [
      {
        id: candidate.id,
        startMs: candidate.startMs,
        peakMs: candidate.peakMs,
        endMs: candidate.endMs,
        score: candidate.score,
        signalKinds: candidate.signalKinds,
        evidence: candidate.evidence,
      },
    ],
  };
}

function fastRecords(): {
  readonly manifest: AnalysisManifestRecord;
  readonly fastResult: FinalAnalysisResultRecord;
  readonly fastTerminal: AnalysisTerminalRecord;
} {
  const result = durableFastPayload();
  const manifest: AnalysisManifestRecord = {
    kind: "manifest",
    runId: RUN_ID,
    artifactId: "manifest-success-1",
    schemaVersion: "0.3.0",
    inputSignature: INPUT_SIGNATURE,
    modelManifestHash: FAST_MODEL_MANIFEST,
    result: {
      input: result.input,
      signalGapPolicy: {
        policyId: "local-available-signal-degradation-v2",
        disclosedBeforeStart: true,
        behavior:
          "complete-with-available-reaction-signals-and-documented-gaps",
      },
    },
    recordedAt: RECORDED_AT,
  };
  const fastResult: FinalAnalysisResultRecord = {
    kind: "finalResult",
    runId: RUN_ID,
    artifactId: "final-success-1",
    schemaVersion: "0.3.0",
    inputSignature: INPUT_SIGNATURE,
    modelManifestHash: FAST_MODEL_MANIFEST,
    result,
    recordedAt: RECORDED_AT,
  };
  return {
    manifest,
    fastResult,
    fastTerminal: {
      kind: "terminalDisposition",
      runId: RUN_ID,
      schemaVersion: "0.3.0",
      inputSignature: INPUT_SIGNATURE,
      modelManifestHash: FAST_MODEL_MANIFEST,
      outcome: "completed",
      resultRecordKind: "finalResult",
      resultArtifactId: fastResult.artifactId,
      recordedAt: RECORDED_AT,
    },
  };
}

function candidateContext(): CandidatePassBContextPacket {
  const context = createCandidatePassBContextPacket({
    transcriptSource: "youtube-caption",
    transcriptKo: "조용히 목표를 달성한 뒤 스트리머가 결과를 확인하고 기뻐한다.",
    beforeContextKo: "여러 번 실패한 뒤 마지막 시도를 준비하고 있었다.",
    afterContextKo: "성공을 확인한 뒤 시청자에게 과정을 설명하며 다음 주제로 넘어갔다.",
    broadcastSummaryKo:
      "스트리머가 반복 도전 끝에 목표를 달성하고 결과를 차분하게 확인한 방송이다.",
    topicContextKo: "반복 도전의 결말과 성공 확인",
    fastEvidenceKo: "음성 반응과 대사 흐름이 함께 변했다.",
    contextDecision: "select",
    contextCategory: "quiet-achievement",
    contextVerdictKo:
      "방송 전체 흐름에서 준비와 결과가 연결되는 독립적인 성공 사건이다.",
    chatReactionKo: null,
  });
  if (context === null) throw new Error("Fixture context must be valid.");
  return context;
}

function passBEvidence(): CandidatePassBEvidence {
  return buildCandidatePassBEvidence(
    {
      candidateId: CANDIDATE_ID,
      decodeStartMs: candidate.startMs,
      decodeEndMs: candidate.endMs,
      reactionPeakMs: candidate.peakMs,
    },
    [
      {
        relativeStartMs: 18_000,
        relativeEndMs: 21_000,
        text: "드디어 성공했어",
        confidence: 0.98,
        noSpeechProbability: 0.01,
      },
    ],
  );
}

async function candidateRecord(
  context: CandidatePassBContextPacket,
  clipDecision: "recommend" | "reject",
  contextInputSignature: string,
  refinementEvidenceProjectionFingerprint: string | null,
): Promise<CandidatePassBInsightsRecord> {
  const frameTimestamps = [5_000, 12_000, 22_000, 35_000] as const;
  const digest = `sha256:${"1".repeat(64)}` as const;
  const payloadDigest = `sha256:${"2".repeat(64)}` as const;
  const dispatchIntent = {
    schemaVersion: CANDIDATE_PASS_B_DISPATCH_INTENT_SCHEMA_VERSION,
    operationId: "candidate-pass-b.fixture",
    analysisRunId: RUN_ID,
    candidateId: CANDIDATE_ID,
    sourceFingerprint: "fixture-source",
    sourceStartMs: candidate.startMs,
    sourceEndMs: candidate.endMs,
    contextFingerprint: candidatePassBContextFingerprint(context),
    outputLanguage: "ko" as const,
    castRosterId: null,
    routingModelRevision: CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
    attemptOrdinal: 0,
    retryGrantId: null,
    transportMode: "free-r2" as const,
    mediaReceipt: {
      schemaVersion: CANDIDATE_PASS_B_MEDIA_RECEIPT_SCHEMA_VERSION,
      frameExtractionRevision: CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
      frames: frameTimestamps.map((timestampMs) => ({
        timestampMs,
        mimeType: "image/jpeg" as const,
        byteLength: 5,
        contentDigest: digest,
        extractionRevision: CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
      })) as [
        {
          timestampMs: number;
          mimeType: "image/jpeg";
          byteLength: number;
          contentDigest: typeof digest;
          extractionRevision: typeof CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION;
        },
        {
          timestampMs: number;
          mimeType: "image/jpeg";
          byteLength: number;
          contentDigest: typeof digest;
          extractionRevision: typeof CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION;
        },
        {
          timestampMs: number;
          mimeType: "image/jpeg";
          byteLength: number;
          contentDigest: typeof digest;
          extractionRevision: typeof CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION;
        },
        {
          timestampMs: number;
          mimeType: "image/jpeg";
          byteLength: number;
          contentDigest: typeof digest;
          extractionRevision: typeof CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION;
        },
      ],
      audio: {
        kind: "verified-no-speech" as const,
        wavByteLength: 32_044,
        wavContentDigest: digest,
        sampleRateHz: CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
        sampleCount: 16_000,
        vadRevision: CANDIDATE_PASS_B_AUDIO_GATE_REVISION,
        frameCount: 50,
        activeFrameCount: 0,
        activeFrameRatio: 0,
        audible: false as const,
      },
      providerPayloadDigest: payloadDigest,
    },
  };
  const settlement = {
    schemaVersion: CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION,
    status: "completed" as const,
    operationId: dispatchIntent.operationId,
    providerPayloadDigest: payloadDigest,
    outputLanguage: dispatchIntent.outputLanguage,
    castRosterId: dispatchIntent.castRosterId,
    responseDigest: `sha256:${"3".repeat(64)}` as const,
    providerModelId: CANDIDATE_PASS_B_QWEN_MODEL_ID,
    providerModelRevision: CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
  };
  const receipt = createCandidatePassBVerificationReceipt(
    context,
    frameTimestamps[2],
    {
      candidateId: CANDIDATE_ID,
      sourceStartMs: candidate.startMs,
      sourceEndMs: candidate.endMs,
      routingModelRevision: CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
      refinementEvidenceProjectionFingerprint,
      outputLanguage: "ko",
      castRosterId: null,
    },
    dispatchIntent,
    settlement,
  );
  if (receipt === null) throw new Error("Fixture receipt must be valid.");
  return {
    kind: "candidatePassBInsights",
    runId: RUN_ID,
    schemaVersion: CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION,
    inputSignature: INPUT_SIGNATURE,
    modelManifestHash: CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
    planReceipt: await createCandidatePassBPlanReceipt({
      runId: RUN_ID,
      inputSignature: INPUT_SIGNATURE,
      contextInputSignature,
      refinementEvidenceProjectionFingerprint,
      plannedCandidateIds: [CANDIDATE_ID],
      contextByCandidateId: { [CANDIDATE_ID]: context },
    }),
    contextByCandidateId: { [CANDIDATE_ID]: context },
    evidenceById: { [CANDIDATE_ID]: passBEvidence() },
    insightById: {
      [CANDIDATE_ID]: {
        eventSummaryKo: "반복 도전 끝에 목표를 달성했다.",
        reactionSummaryKo: "스트리머가 결과를 확인하고 기뻐했다.",
        whyGoodClipKo: "준비, 성공, 반응이 짧은 구간 안에서 완결된다.",
        uncertaintiesKo: [],
        participantPresence: "present-unidentified",
        participantSummaryKo:
          "주 진행 스트리머가 화면과 음성에 있으나 이름 표시는 확인되지 않았다.",
        identifiedParticipants: [],
        clipDecision,
        contextConsistency: "consistent",
        programMaterial: "streamer-event",
      },
    },
    modelByCandidateId: {
      [CANDIDATE_ID]: {
        id: CANDIDATE_PASS_B_QWEN_MODEL_ID,
        revision: CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
      },
    },
    thumbnailById: {
      [CANDIDATE_ID]: {
        timestampMs: frameTimestamps[2],
        mimeType: "image/jpeg",
        dataBase64: "aGVsbG8=",
      },
    },
    attemptLedgerByCandidateId: {
      [CANDIDATE_ID]: createCandidatePassBInitialAttemptLedger(
        dispatchIntent,
        settlement,
      ),
    },
    dispatchIntentByCandidateId: { [CANDIDATE_ID]: dispatchIntent },
    settlementByCandidateId: { [CANDIDATE_ID]: settlement },
    verificationReceiptById: { [CANDIDATE_ID]: receipt },
    recordedAt: RECORDED_AT,
  };
}

interface ContextSessionFixture {
  readonly session: BroadcastContextSessionRecord;
  readonly refinementEvidenceProjectionFingerprint: string | null;
}

async function contextSession(
  context: CandidatePassBContextPacket,
  withRefinement: boolean,
): Promise<ContextSessionFixture> {
  const captionVideoId = "abcdefghijk";
  const transcriptPlanCells = [
    { chunkId: "asr-0-1xg0", sourceStartMs: 0, sourceEndMs: 90_000 },
    {
      chunkId: "asr-1xg0-3uw0",
      sourceStartMs: 90_000,
      sourceEndMs: SOURCE_DURATION_MS,
    },
  ] as const;
  const captionTrack = {
    videoId: captionVideoId,
    languageCode: "ko",
    isAutoGenerated: true,
    events: [
      {
        startMs: 10_000,
        durationMs: 2_000,
        text: "스트리머가 여러 차례 도전한 목표와 준비 과정을 설명한다.",
      },
      {
        startMs: 100_000,
        durationMs: 2_000,
        text: "마지막 도전에서 성공한 뒤 결과와 반응을 차분히 설명한다.",
      },
    ],
  } as const;
  const captionOutcomes = createYouTubeCaptionTranscriptCellOutcomes(
    captionTrack,
    transcriptPlanCells,
    SOURCE_DURATION_MS,
  );
  const chapters = captionOutcomes.map(({ chapter }, index) => ({
    ...chapter,
    chapterId: `chapter-${index + 1}`,
  }));
  const routeManifest: BroadcastTranscriptRouteManifest = {
    schemaVersion: BROADCAST_TRANSCRIPT_ROUTE_MANIFEST_SCHEMA_VERSION,
    serviceVersion: BROADCAST_TRANSCRIPT_HEALTH_SERVICE_VERSION,
    routingPolicyVersion: AI_MODEL_ROUTING_POLICY_VERSION,
    providerConfigurationVersion:
      BROADCAST_TRANSCRIPT_PROVIDER_CONFIGURATION_VERSION,
    transportVersion: BROADCAST_TRANSCRIPT_TRANSPORT_VERSION,
    transportMode: "free-r2",
    maximumChunkDurationMs: MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS,
    primaryMediaType: BROADCAST_TRANSCRIPT_PRIMARY_MEDIA_TYPE,
    provider: "qwen",
    modelId: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
    modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
    effectiveFallback: { mode: "disabled" },
  };
  const transcriptRoute =
    await createBroadcastTranscriptRouteSelection(routeManifest);
  let transcriptProviderReceiptCheckpoint =
    createBroadcastTranscriptProviderReceiptCheckpoint({
      sourceFingerprint: INPUT_SIGNATURE,
      sourceDurationMs: SOURCE_DURATION_MS,
      route: transcriptRoute,
      plannedCells: transcriptPlanCells,
    });
  for (const [index, outcome] of captionOutcomes.entries()) {
    transcriptProviderReceiptCheckpoint =
      recordBroadcastTranscriptCaptionReceipt(
        transcriptProviderReceiptCheckpoint,
        outcome.chunkId,
        captionTrack,
        chapters[index]!,
      );
  }
  const transcriptModelRevision =
    broadcastTranscriptProviderReceiptCheckpointModelRevision(
      transcriptProviderReceiptCheckpoint,
    );
  const transcriptSealOperationKey = transcriptOperationKey(
    RUN_ID,
    SOURCE_CONTENT_FINGERPRINT,
    "event-boost",
    0,
    await createCurrentProviderTranscriptSourceIdentityFence(null),
  );
  const transcriptEvidenceCheckpoint =
    createBroadcastTranscriptResolvedEvidenceCheckpoint({
      sourceFingerprint: INPUT_SIGNATURE,
      sourceDurationMs: SOURCE_DURATION_MS,
      transcriptInputSignature: transcriptSealOperationKey,
      modelRevision: transcriptModelRevision,
      plannedCells: transcriptPlanCells,
    });
  const visualPlan = createBroadcastTranscriptVisualInspectionPlan(
    transcriptEvidenceCheckpoint,
  );
  const preparedVisualReceipts = visualPlan.cells.map((cell, index) =>
    createBroadcastTranscriptVisualPreparedFrameReceipt({
      plan: visualPlan,
      cellId: cell.cellId,
      frameContentFingerprints: [
        fixtureSha256(index * 6 + 1),
        fixtureSha256(index * 6 + 2),
        fixtureSha256(index * 6 + 3),
        fixtureSha256(index * 6 + 4),
      ],
      audioEvidence: {
        sourceStartMs: cell.sourceStartMs,
        sourceEndMs: cell.sourceEndMs,
        codec: "audio/wav;codecs=pcm_s16le",
        extractionRevision:
          BROADCAST_TRANSCRIPT_VISUAL_AUDIO_EXTRACTION_REVISION,
        contentFingerprint: fixtureSha256(index * 6 + 5),
      },
    }),
  );
  const visualSettlements = preparedVisualReceipts.map((receipt, index) =>
    createBroadcastTranscriptVisualProviderSettlement({
      plan: visualPlan,
      cellId: receipt.cellId,
      preparedFrameReceipt: receipt,
      providerModelRevision: HAPPY_PATH_VISUAL_MODEL_REVISION,
      operationId: `happy-path-visual-${index + 1}`,
      attemptOrdinal: 0,
      outcome: "completed",
      editorialFinding: "quiet-success",
      summaryKo:
        "준비된 네 화면과 같은 구간의 오디오를 함께 검토해 사건 흐름을 확인했다.",
      providerResponseFingerprint: fixtureSha256(index * 6 + 6),
      participantOutcome: {
        presence: "none-present",
        summaryKo:
          "검토한 네 화면에는 식별 가능한 등장인물이 나타나지 않았다.",
        participants: [],
      },
    }),
  );
  const visualProviderLedger = visualSettlements.reduce(
    (ledger, settlement) =>
      recordBroadcastTranscriptVisualProviderSettlement(
        ledger,
        visualPlan,
        settlement,
      ),
    createBroadcastTranscriptVisualProviderSettlementLedger(visualPlan),
  );
  const transcriptVisualInspectionCheckpointJson =
    serializeBroadcastTranscriptVisualInspectionRunnerCheckpoint(
      createBroadcastTranscriptVisualInspectionRunnerCheckpoint({
        plan: visualPlan,
        revision: 1,
        preparedFrameReceipts: preparedVisualReceipts,
        providerLedger: visualProviderLedger,
      }),
      visualPlan,
    );
  const preparedParticipant = await prepareBroadcastParticipantPreContext({
    sourceFingerprint: INPUT_SIGNATURE,
    transcriptSeal: transcriptSealOperationKey,
    transcriptModelRevision,
    sourceDurationMs: SOURCE_DURATION_MS,
    castRosterId: null,
    dialogueChapters: chapters,
    visualReferenceManifest: null,
    visualRuntime: {
      adapterRevision: "happy-path-four-frame-visual-runtime-v1",
      modelRevision: HAPPY_PATH_VISUAL_MODEL_REVISION,
      cells: visualPlan.cells.map((cell) => ({
        sourceStartMs: cell.sourceStartMs,
        sourceEndMs: cell.sourceEndMs,
        sourceUnitId: cell.cellId,
        frameTimestampsMs: cell.frameTimestampsMs,
      })),
    },
  });
  const participantVisualAdapter = preparedParticipant.plan.adapters.find(
    ({ adapter }) => adapter === "visual-identity",
  );
  if (
    participantVisualAdapter?.availability !== "enabled" ||
    participantVisualAdapter.cells.length !== visualSettlements.length
  ) {
    throw new Error(
      "Happy-path participant fixture requires every visual cell.",
    );
  }
  const visualTerminalReceipts = participantVisualAdapter.cells.map(
    (participantCell) => {
      const settlement = visualSettlements.find(
        ({ cellId }) => cellId === participantCell.sourceUnitId,
      );
      if (settlement === undefined) {
        throw new Error("Happy-path visual settlement is missing.");
      }
      return createBroadcastParticipantVisualTerminalReceiptFromSettlement({
        participantPlan: preparedParticipant.plan,
        participantCellId: participantCell.cellId,
        visualInspectionPlan: visualPlan,
        settlement,
      });
    },
  );
  const participantPreContext = completeBroadcastParticipantPreContext(
    preparedParticipant,
    { visualTerminalReceipts },
  );
  const participantGrounding = participantPreContext.grounding;
  const participantGroundingPlanFingerprint =
    participantPreContext.planFingerprint;
  const participantGroundingCheckpointJson =
    await serializeBroadcastParticipantPreContextCheckpoint(
      participantPreContext,
      {
        sourceDurationMs: SOURCE_DURATION_MS,
        sourceCastRosterId: null,
        transcriptSealOperationKey,
        dialogueChapters: chapters,
        participantGroundingPlanFingerprint,
      },
    );
  const participantGroundingInputSignature =
    await createBroadcastParticipantGroundingInputSignature({
      inputSignature: INPUT_SIGNATURE,
      transcriptSealOperationKey,
      participantGroundingPlanFingerprint,
      participantGroundingCheckpointJson,
    });
  const contextInput = {
    sourceDurationMs: SOURCE_DURATION_MS,
    castRosterId: null,
    chapters,
    candidates: [
      {
        candidateId: CANDIDATE_ID,
        startMs: candidate.startMs,
        endMs: candidate.endMs,
        transcriptKo: context.transcriptKo,
        eventSummaryKo: "반복 도전 끝에 목표를 달성했다.",
        reactionSummaryKo: "스트리머가 결과를 확인하고 기뻐했다.",
        participantContextKo:
          "주 진행 스트리머가 화면과 음성에 있으나 이름은 확인되지 않았다.",
        chatReactionSummaryKo: null,
      },
    ],
    participantGrounding,
    outputLanguage: "ko" as const,
  };
  const contextInputCheckpointJson = JSON.stringify(contextInput);
  const contextInputSignature = await createContentFingerprint([
    INPUT_SIGNATURE,
    contextInputCheckpointJson,
    participantGroundingInputSignature,
    `broadcast-context-routing:${AI_BROADCAST_CONTEXT_ROUTING_REVISION}`,
    `topical-discovery:${BROADCAST_TOPICAL_DISCOVERY_VERSION}`,
  ]);
  const fence = {
    parentContextSignature: contextInputSignature,
    transcriptSignature: transcriptSealOperationKey,
    groundingSignature: participantGroundingInputSignature,
  };
  const discoveredLead = {
    leadId: "lead-success-1",
    startChapterId: "chapter-1",
    endChapterId: "chapter-2",
    startMs: 0,
    endMs: SOURCE_DURATION_MS,
    category: "quiet-achievement" as const,
    confidence: 0.93,
    eventSummaryKo: "반복 도전 끝에 목표를 달성했다.",
    whyThisMomentKo: "준비와 성공 확인이 연결되는 조용한 성취 장면이다.",
    evidenceCueKo: "드디어 성공했어.",
    uncertaintiesKo: [],
  };
  const contextResult = {
    schemaVersion: "1.7.0",
    broadcastSummaryKo:
      "스트리머가 반복 도전 끝에 목표를 달성하고 결과를 차분하게 확인한 방송이다.",
    hostStreamerProfile: null,
    recurringThemesKo: ["반복 도전과 성공 확인"],
    annotations: [
      {
        candidateId: CANDIDATE_ID,
        category: "quiet-achievement",
        clipDecision: "select",
        confidence: 0.94,
        rejectionReasons: [],
        contextSummaryKo: "반복 도전의 결말에 해당하는 성공 장면이다.",
        whyThisMomentKo: "준비와 결과, 스트리머 반응이 한 구간에서 완결된다.",
        relatedCandidateIds: [],
        uncertaintiesKo: [],
      },
    ],
    semanticChaptersSupported: true,
    semanticChapters: [
      {
        semanticChapterId:
          "sc-chapter-1-chapter-2-quiet-achievement",
        startChapterId: "chapter-1",
        endChapterId: "chapter-2",
        startMs: 0,
        endMs: SOURCE_DURATION_MS,
        titleKo: "반복 도전과 성공",
        summaryKo: "여러 차례 시도한 뒤 목표를 달성하고 결과를 확인했다.",
        kind: "quiet-achievement",
        salience: "primary",
        relatedCandidateIds: [CANDIDATE_ID],
        uncertaintiesKo: [],
      },
    ],
    discoveredLeadsSupported: true,
    discoveredLeads: withRefinement ? [discoveredLead] : [],
    coverage: {
      status: "complete",
      coveredMs: SOURCE_DURATION_MS,
      coverageRatio: 1,
      gaps: [],
      partialChapterIds: [],
    },
  };
  const refinementPlan = createDiscoveredLeadRefinementPlan(
    contextResult.discoveredLeads,
    { preserveInputOrder: true },
  );
  let refinementEvidenceProjectionFingerprint: string | null = null;
  let refinementEvidenceLedgerJson: string | null = null;
  let refinementInputSignature: string | null = null;
  let refinementCandidatesJson: string | null = null;
  const refinementUnits: BroadcastContextPhaseLedgerUnit[] = [];
  if (withRefinement) {
    const captionTrack = {
      videoId: captionVideoId,
      languageCode: "ko",
      isAutoGenerated: true,
      events: refinementPlan.segments.map((segment) => ({
        startMs: segment.sourceStartMs,
        durationMs: segment.sourceEndMs - segment.sourceStartMs,
        text: "반복 도전 끝에 성공했고 결과를 확인했다.",
      })),
    };
    const binding = {
      sourceFingerprint: INPUT_SIGNATURE,
      sourceDurationMs: SOURCE_DURATION_MS,
      selectedLeadPlan: refinementPlan,
    };
    let refinementLedger =
      await createBroadcastRefinementEvidenceLedger(binding);
    const appended = await appendBroadcastRefinementEvidenceRouteEntry(
      refinementLedger,
      refinementLedger.ledgerFingerprint,
      {
        ...binding,
        routeKind: "youtube-caption",
        captionRevision: YOUTUBE_CAPTION_MODEL_REVISION,
        captionTrack,
        verifiedNoSpeechEvidence: [],
      },
    );
    refinementLedger = await activateBroadcastRefinementEvidenceRoute(
      appended.ledger,
      appended.ledger.ledgerFingerprint,
      appended.routeEntryFingerprint,
    );
    const activeProjection =
      projectBroadcastRefinementActiveEvidenceRoute(refinementLedger);
    const activeEvidence =
      getBroadcastRefinementActiveEvidencePayload(refinementLedger);
    if (activeProjection === null || activeEvidence === null) {
      throw new Error("Fixture refinement projection must be active.");
    }
    const leadInputs = createSemanticRefinementLeadInputs({
      plan: refinementPlan,
      transcripts: activeRefinementEvidenceTranscripts(activeEvidence),
      discoveredLeads: contextResult.discoveredLeads,
      fastRefinementLeadIds: [],
      sourceDurationMs: SOURCE_DURATION_MS,
      castRosterId: null,
      wholeBroadcastChapters: chapters,
      participantGrounding,
      outputLanguage: "ko",
    });
    const routingManifestSignature =
      `broadcast-context-routing:${AI_BROADCAST_CONTEXT_ROUTING_REVISION}`;
    refinementEvidenceProjectionFingerprint =
      activeProjection.projectionFingerprint;
    refinementInputSignature =
      await createSemanticRefinementAiInputSignature({
        activeEvidenceProjectionFingerprint:
          activeProjection.projectionFingerprint,
        routingManifestSignature,
        leadInputs,
      });
    refinementEvidenceLedgerJson =
      await serializeBroadcastRefinementEvidenceLedger(refinementLedger);
    refinementCandidatesJson = "[]";
    refinementUnits.push({
      phase: "refinement",
      unitId: `lead:${discoveredLead.leadId}`,
      inputDigest: "refinement-digest",
      operationId: "refinement-operation",
      attemptOrdinal: 0,
      required: true,
      status: "succeeded",
      modelReceipt: {
        routingManifestSignature,
        evidenceManifestSignature:
          activeProjection.projectionFingerprint,
        outputLanguage: "ko",
        analysisMode: "refinement",
        providerDispatch: true,
      },
    });
  }
  const overviewInputDigest = "overview-digest";
  const selectionInputDigest = "selection-digest";
  const juryResult = {
    kind: withRefinement
      ? "fixture-selection-result"
      : "jury-abstained-no-candidates",
    schemaVersion: "1.0.0",
  } as const;
  const contextResultFingerprint = await createContentFingerprint([
    BROADCAST_CONTEXT_FINAL_RESULT_FINGERPRINT_DOMAIN,
    contextInputSignature,
    serializeBroadcastContextLedgerJsonValue(contextResult),
  ]);
  const contextLedger: BroadcastContextPhaseLedger = {
    schemaVersion: "3.0.0",
    fence,
    units: [
      {
        phase: "discovery",
        unitId: "overview",
        inputDigest: overviewInputDigest,
        operationId: "overview-operation",
        attemptOrdinal: 0,
        required: true,
        status: "succeeded",
        result: contextResult,
        modelReceipt: {
          analysisMode: "overview",
          resultFingerprint: await createContentFingerprint([
            BROADCAST_CONTEXT_UNIT_RESULT_FINGERPRINT_DOMAIN,
            overviewInputDigest,
            serializeBroadcastContextLedgerJsonValue(contextResult),
          ]),
        },
      },
      {
        phase: "jury",
        unitId: "selection",
        inputDigest: selectionInputDigest,
        operationId: "selection-operation",
        attemptOrdinal: 0,
        required: true,
        status: "succeeded",
        result: juryResult,
        modelReceipt: {
          analysisMode: "selection",
          resultFingerprint: await createContentFingerprint([
            BROADCAST_CONTEXT_UNIT_RESULT_FINGERPRINT_DOMAIN,
            selectionInputDigest,
            serializeBroadcastContextLedgerJsonValue(juryResult),
          ]),
          parentContextResultFingerprint: contextResultFingerprint,
        },
      },
      ...refinementUnits,
    ],
    usedOperationIds: [
      "overview-operation",
      "selection-operation",
      ...(withRefinement ? ["refinement-operation"] : []),
    ],
  };
  const session: BroadcastContextSessionRecord = {
    kind: "broadcastContextSession",
    runId: RUN_ID,
    schemaVersion: BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
    inputSignature: INPUT_SIGNATURE,
    sourceDurationMs: SOURCE_DURATION_MS,
    completeAudioCoverage: true,
    chapters,
    gapChunkIds: [],
    fragmentGaps: [],
    transcriptEvidenceInputSignature: transcriptSealOperationKey,
    transcriptEvidenceCheckpointJson:
      serializeBroadcastTranscriptResolvedEvidenceCheckpoint(
        transcriptEvidenceCheckpoint,
      ),
    transcriptVisualInspectionCheckpointJson,
    transcriptProviderReceiptInputSignature: transcriptRoute.fingerprint,
    transcriptProviderReceiptCheckpointJson:
      serializeBroadcastTranscriptProviderReceiptCheckpoint(
        transcriptProviderReceiptCheckpoint,
      ),
    modelRevision: transcriptModelRevision,
    sourceCastRosterId: null,
    transcriptSealOperationKey,
    participantGroundingInputSignature,
    participantGroundingPlanFingerprint,
    participantGroundingCheckpointJson,
    contextInputSignature,
    contextInputCheckpointJson,
    contextPhaseLedgerJson:
      serializeBroadcastContextPhaseLedger(contextLedger),
    contextResultJson: JSON.stringify({
      schemaVersion: "1.2.0",
      result: contextResult,
      refinementLeadIds: refinementPlan.selectedLeadIds,
      fastRefinementLeadIds: [],
      contextCandidateIds: [CANDIDATE_ID],
    }),
    refinementTranscriptInputSignature: null,
    refinementTranscriptCheckpointJson: null,
    refinementEvidenceLedgerJson,
    refinementInputSignature,
    refinementCandidatesJson,
    recordedAt: RECORDED_AT,
  };
  return { session, refinementEvidenceProjectionFingerprint };
}

export async function createAnalysisPipelineHappyPathFixture(
  options: {
    readonly clipDecision?: "recommend" | "reject";
    readonly withRefinement?: boolean;
  } = {},
): Promise<AnalysisPipelineSuccessInput> {
  const context = candidateContext();
  const contextFixture = await contextSession(
    context,
    options.withRefinement ?? true,
  );
  if (contextFixture.session.contextInputSignature === null) {
    throw new Error("Fixture context input signature must be durable.");
  }
  return {
    ...fastRecords(),
    session: contextFixture.session,
    candidateRecord: await candidateRecord(
      context,
      options.clipDecision ?? "recommend",
      contextFixture.session.contextInputSignature,
      contextFixture.refinementEvidenceProjectionFingerprint,
    ),
    candidates: [{ ...candidate }],
  };
}

/**
 * Current-only fixture for the legitimate zero-detail path. The editor has
 * explicitly rejected the reservoir candidate, while Candidate Pass B durably
 * records the exact empty plan instead of omitting its record. A context-only
 * rejection is not sufficient to skip multimodal verification.
 */
export async function createAnalysisPipelineIntentionalEmptyFixture(): Promise<AnalysisPipelineSuccessInput> {
  const fixture = await createAnalysisPipelineHappyPathFixture({
    withRefinement: false,
  });
  const candidateRecord = fixture.candidateRecord;
  const contextInputSignature = fixture.session.contextInputSignature;
  const contextResultJson = fixture.session.contextResultJson;
  if (
    candidateRecord === null ||
    contextInputSignature === null ||
    contextResultJson === null
  ) {
    throw new Error("Current durable fixture artifacts are required.");
  }
  const envelope = JSON.parse(contextResultJson) as {
    result: {
      annotations: Array<Record<string, unknown>>;
    };
  };
  envelope.result.annotations = envelope.result.annotations.map(
    (annotation) => ({
      ...annotation,
      category: "not-clip-worthy",
      clipDecision: "reject",
      rejectionReasons: ["no-distinct-event"],
    }),
  );
  const normalizedContextResult = JSON.parse(
    serializeBroadcastContextLedgerJsonValue(envelope.result),
  ) as BroadcastContextPhaseLedgerJsonValue;
  const contextLedger = parseBroadcastContextPhaseLedgerJson(
    fixture.session.contextPhaseLedgerJson ?? "",
  );
  if (contextLedger === null) {
    throw new Error("Current durable context ledger is required.");
  }
  const resealedContextResultFingerprint = await createContentFingerprint([
    BROADCAST_CONTEXT_FINAL_RESULT_FINGERPRINT_DOMAIN,
    contextInputSignature,
    serializeBroadcastContextLedgerJsonValue(normalizedContextResult),
  ]);
  const resealedContextLedger: BroadcastContextPhaseLedger = {
    ...contextLedger,
    units: await Promise.all(
      contextLedger.units.map(async (unit) => {
        if (
          unit.status !== "succeeded" ||
          unit.modelReceipt === undefined
        ) {
          return unit;
        }
        if (unit.phase === "discovery" && unit.unitId === "overview") {
          return {
            ...unit,
            result: normalizedContextResult,
            modelReceipt: {
              ...unit.modelReceipt,
              resultFingerprint: await createContentFingerprint([
                BROADCAST_CONTEXT_UNIT_RESULT_FINGERPRINT_DOMAIN,
                unit.inputDigest,
                serializeBroadcastContextLedgerJsonValue(
                  normalizedContextResult,
                ),
              ]),
            },
          };
        }
        if (unit.phase === "jury" && unit.unitId === "selection") {
          return {
            ...unit,
            modelReceipt: {
              ...unit.modelReceipt,
              parentContextResultFingerprint:
                resealedContextResultFingerprint,
            },
          };
        }
        return unit;
      }),
    ),
  };
  return {
    ...fixture,
    candidates: fixture.candidates.map((candidate) => ({
      ...candidate,
      reviewState: "rejected" as const,
    })),
    session: {
      ...fixture.session,
      contextPhaseLedgerJson:
        serializeBroadcastContextPhaseLedger(resealedContextLedger),
      contextResultJson: JSON.stringify(envelope),
    },
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
  };
}
