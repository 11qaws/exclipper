import {
  AI_BROADCAST_CONTEXT_ROUTING_REVISION,
} from "../analysis/aiModelRoutingPolicy";
import {
  broadcastContextPhaseLedgerCanComplete,
  broadcastContextPhaseLedgerMatchesFence,
  parseBroadcastContextPhaseLedgerJson,
  serializeBroadcastContextLedgerJsonValue,
  type BroadcastContextPhaseLedger,
} from "../analysis/broadcastContextPhaseLedger";
import {
  BROADCAST_CONTEXT_SCHEMA_VERSION,
  createBroadcastContextRequest,
  isFinalBroadcastContextResult,
  type BroadcastContextChapterInput,
  type BroadcastContextRequest,
  type BroadcastContextRequestInput,
  type BroadcastContextResult,
} from "../analysis/broadcastContextProtocol";
import {
  parseBroadcastContextProxyResult,
} from "../analysis/broadcastContextDeepseekClient";
import {
  BROADCAST_REFINEMENT_EVIDENCE_LEDGER_SCHEMA_VERSION,
  broadcastRefinementEvidenceLedgerCanPublish,
  getBroadcastRefinementActiveEvidencePayload,
  projectBroadcastRefinementActiveEvidenceRoute,
} from "../analysis/broadcastRefinementEvidenceLedger";
import {
  BROADCAST_TOPICAL_DISCOVERY_VERSION,
} from "../analysis/broadcastTopicalDiscovery";
import {
  BROADCAST_TRANSCRIPT_PROVIDER_RECEIPT_CHECKPOINT_SCHEMA_VERSION,
  broadcastTranscriptProviderReceiptCheckpointModelRevision,
  inspectBroadcastTranscriptProviderReceiptSettlement,
  parseBroadcastTranscriptProviderReceiptCheckpointJson,
} from "../analysis/broadcastTranscriptProviderReceiptCheckpoint";
import {
  BROADCAST_TRANSCRIPT_RESOLVED_EVIDENCE_SCHEMA_VERSION,
  inspectBroadcastTranscriptEvidenceSettlement,
  parseBroadcastTranscriptResolvedEvidenceCheckpointJson,
} from "../analysis/broadcastTranscriptResolvedEvidence";
import {
  CANDIDATE_PASS_B_GEMINI_MODEL_ID,
  CANDIDATE_PASS_B_GEMINI_MODEL_REVISION,
  CANDIDATE_PASS_B_QWEN_MODEL_ID,
  CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
  CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
  CANDIDATE_PASS_B_VERIFICATION_RECEIPT_SCHEMA_VERSION,
  type CandidatePassBVerificationSourceFence,
} from "../analysis/candidatePassBWorkerProtocol";
import {
  finalizeFullyVerifiedCandidates,
  isCandidatePassBContextPacket,
} from "../analysis/candidateFinalVerification";
import {
  finalizeContextQualifiedCandidates,
  selectCandidateDetailCandidateIds,
  selectContextExcludedCandidateIds,
  type CandidateAiQueueItem,
} from "../analysis/contextQualifiedFinalSelection";
import {
  createDiscoveredLeadRefinementPlan,
} from "../analysis/discoveredLeadRefinement";
import type { UnifiedHighlightCandidate } from "../analysis/highlightFusion";
import {
  parseSemanticLeadCandidates,
} from "../analysis/semanticLeadCandidate";
import type { AnalysisStage } from "../domain/analysisRun";
import { createContentFingerprint } from "../security/contentFingerprint";
import {
  assertBroadcastContextSessionRecord,
  BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
  createBroadcastParticipantGroundingInputSignature,
  partitionBroadcastContextSessionChapters,
  parseBroadcastContextSessionRefinementEvidenceLedger,
  restoreBroadcastParticipantPreContextCheckpoint,
  type BroadcastContextSessionRecord,
} from "../storage/broadcastContextSessionStore";
import {
  assertCandidatePassBInsightsRecord,
  CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION,
  createCandidatePassBPlanReceipt,
  type CandidatePassBInsightsRecord,
  type StoredCandidatePassBModelIdentity,
} from "../storage/candidatePassBInsightStore";
import {
  type AnalysisManifestRecord,
  type AnalysisTerminalRecord,
  type FinalAnalysisResultRecord,
} from "../storage/analysisResultStore";
import {
  assertDurableFinalResultPayload,
  assertDurableManifestPayload,
  durableCoverageDisposition,
} from "../storage/durableAnalysisPayload";
import {
  compactBroadcastContextChapters,
} from "../analysis/broadcastContextChapterCompaction";
import {
  BROADCAST_CONTEXT_FINAL_RESULT_FINGERPRINT_DOMAIN,
  BROADCAST_CONTEXT_UNIT_RESULT_FINGERPRINT_DOMAIN,
} from "./durableBroadcastContextPipeline";
import {
  selectNonOverlappingDiscoveredCandidates,
} from "./analysisCandidateCohort";
import {
  selectBroadcastContextCandidateCohort,
} from "./broadcastContextCandidateCohort";
import {
  selectCandidatePassBDurableIds,
} from "./candidatePassBDurability";
import {
  selectCandidateVerificationCohort,
} from "./candidateVerificationCohort";

export const CURRENT_FAST_PASS_MODEL_MANIFEST_HASH =
  "streamer-reaction-fast-pass-v6-durable-current-only";
import { isPipelineGap } from "./finalVerificationGapSummary";
import {
  activeRefinementEvidenceTranscripts,
  createSemanticRefinementAiInputSignature,
  createSemanticRefinementLeadInputs,
  semanticRefinementPhaseReceiptsMatchActiveProjection,
} from "./semanticRefinementEvidence";
import { isCurrentTranscriptSealOperationKey } from "./transcriptPhase";

const CURRENT_FAST_RESULT_SCHEMA_VERSION = "0.3.0" as const;
const CURRENT_CONTEXT_ENVELOPE_SCHEMA_VERSION = "1.2.0" as const;
const CERTIFICATE_SCHEMA_VERSION = "1.0.0" as const;

export type CertifiableCandidate =
  UnifiedHighlightCandidate & CandidateAiQueueItem;

export interface AnalysisPipelineSuccessInput {
  readonly manifest: AnalysisManifestRecord;
  readonly fastResult: FinalAnalysisResultRecord;
  readonly fastTerminal: AnalysisTerminalRecord;
  readonly session: BroadcastContextSessionRecord;
  readonly candidateRecord: CandidatePassBInsightsRecord | null;
  readonly candidates: readonly CertifiableCandidate[];
}

export type AnalysisPipelineSuccessGapCode =
  | "current-schema-required"
  | "fast-result-invalid"
  | "run-fence-mismatch"
  | "source-fence-mismatch"
  | "transcript-unsettled"
  | "participant-grounding-stale"
  | "context-input-stale"
  | "context-ledger-incomplete"
  | "context-result-invalid"
  | "refinement-evidence-incomplete"
  | "refinement-receipt-stale"
  | "candidate-plan-invalid"
  | "candidate-detail-not-durable"
  | "candidate-verification-incomplete";

export interface AnalysisPipelineSuccessGap {
  readonly code: AnalysisPipelineSuccessGapCode;
  readonly detail: string;
  readonly candidateIds?: readonly string[];
}

export interface AnalysisPipelineSuccessCertificate {
  readonly schemaVersion: typeof CERTIFICATE_SCHEMA_VERSION;
  readonly runId: string;
  readonly inputSignature: string;
  readonly sourceContentFingerprint: string;
  readonly sourceDurationMs: number;
  readonly transcriptSealOperationKey: string;
  readonly participantGroundingInputSignature: string;
  readonly contextInputSignature: string;
  readonly contextResultFingerprint: string;
  readonly refinementEvidenceProjectionFingerprint: string | null;
  readonly refinementInputSignature: string | null;
  readonly candidatePlanFingerprint: string;
  readonly finalCandidateIds: readonly string[];
  readonly quality: "usable" | "empty";
}

export type AnalysisPipelineSuccess =
  | {
      readonly ok: true;
      readonly certificate: AnalysisPipelineSuccessCertificate;
    }
  | {
      readonly ok: false;
      readonly failedStage: AnalysisStage;
      readonly gaps: readonly AnalysisPipelineSuccessGap[];
    };

export interface AnalysisPipelineDurableSnapshot {
  readonly manifest: AnalysisManifestRecord;
  readonly fastResult: FinalAnalysisResultRecord;
  readonly fastTerminal: AnalysisTerminalRecord;
  readonly session: BroadcastContextSessionRecord;
  readonly candidateRecord: CandidatePassBInsightsRecord | null;
}

/**
 * Collision-resistant exact fence for every durable object reopened before a
 * success certificate is issued. Mutable context and candidate records are
 * fingerprinted in full; timestamps are presentation metadata, not identity.
 */
export function createAnalysisPipelineDurableSnapshotToken(
  snapshot: AnalysisPipelineDurableSnapshot,
): Promise<string> {
  return createContentFingerprint([
    "exclipper.analysis-pipeline-durable-snapshot.v2",
    JSON.stringify(snapshot.manifest),
    JSON.stringify(snapshot.fastResult),
    JSON.stringify(snapshot.fastTerminal),
    JSON.stringify(snapshot.session),
    JSON.stringify(snapshot.candidateRecord),
  ]);
}

interface CurrentContextEnvelope {
  readonly schemaVersion: typeof CURRENT_CONTEXT_ENVELOPE_SCHEMA_VERSION;
  readonly result: unknown;
  readonly refinementLeadIds: readonly string[];
  readonly fastRefinementLeadIds: readonly string[];
  readonly contextCandidateIds: readonly string[];
}

function fail(
  failedStage: AnalysisStage,
  code: AnalysisPipelineSuccessGapCode,
  detail: string,
  candidateIds?: readonly string[],
): AnalysisPipelineSuccess {
  return {
    ok: false,
    failedStage,
    gaps: [
      {
        code,
        detail,
        ...(candidateIds === undefined ? {} : { candidateIds }),
      },
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).sort().join("\u0000") ===
    [...keys].sort().join("\u0000")
  );
}

function stringArraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function parseCurrentContextCheckpoint(
  json: string,
): BroadcastContextRequest | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!isRecord(parsed)) return null;
    const expectedKeys = [
      "sourceDurationMs",
      "chapters",
      "candidates",
      "castRosterId",
      "participantGrounding",
      "outputLanguage",
    ];
    if (!hasExactKeys(parsed, expectedKeys)) return null;
    return createBroadcastContextRequest(
      parsed as unknown as BroadcastContextRequestInput,
    );
  } catch {
    return null;
  }
}

function parseCurrentContextEnvelope(json: string): CurrentContextEnvelope | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (
      !isRecord(parsed) ||
      !hasExactKeys(parsed, [
        "schemaVersion",
        "result",
        "refinementLeadIds",
        "fastRefinementLeadIds",
        "contextCandidateIds",
      ]) ||
      parsed.schemaVersion !== CURRENT_CONTEXT_ENVELOPE_SCHEMA_VERSION ||
      !Array.isArray(parsed.refinementLeadIds) ||
      !Array.isArray(parsed.fastRefinementLeadIds) ||
      !Array.isArray(parsed.contextCandidateIds) ||
      !parsed.refinementLeadIds.every((value) => typeof value === "string") ||
      !parsed.fastRefinementLeadIds.every((value) => typeof value === "string") ||
      !parsed.contextCandidateIds.every((value) => typeof value === "string") ||
      new Set(parsed.refinementLeadIds).size !== parsed.refinementLeadIds.length ||
      new Set(parsed.fastRefinementLeadIds).size !==
        parsed.fastRefinementLeadIds.length ||
      new Set(parsed.contextCandidateIds).size !== parsed.contextCandidateIds.length
    ) {
      return null;
    }
    return {
      schemaVersion: CURRENT_CONTEXT_ENVELOPE_SCHEMA_VERSION,
      result: parsed.result,
      refinementLeadIds: parsed.refinementLeadIds,
      fastRefinementLeadIds: parsed.fastRefinementLeadIds,
      contextCandidateIds: parsed.contextCandidateIds,
    };
  } catch {
    return null;
  }
}

function currentCandidateModel(
  value: StoredCandidatePassBModelIdentity | undefined,
): boolean {
  return (
    (value?.id === CANDIDATE_PASS_B_QWEN_MODEL_ID &&
      value.revision === CANDIDATE_PASS_B_QWEN_MODEL_REVISION) ||
    (value?.id === CANDIDATE_PASS_B_GEMINI_MODEL_ID &&
      value.revision === CANDIDATE_PASS_B_GEMINI_MODEL_REVISION)
  );
}

function contextCandidateRangesMatch(
  request: BroadcastContextRequest,
  envelope: CurrentContextEnvelope,
  candidates: readonly CertifiableCandidate[],
): boolean {
  const requestIds = request.candidates.map(({ candidateId }) => candidateId);
  if (!stringArraysEqual(requestIds, envelope.contextCandidateIds)) return false;
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return request.candidates.every((stored) => {
    const current = candidateById.get(stored.candidateId);
    return (
      current !== undefined &&
      stored.startMs === Math.round(current.startMs) &&
      stored.endMs === Math.round(current.endMs)
    );
  });
}

function currentContextResult(
  envelope: CurrentContextEnvelope,
  request: BroadcastContextRequest,
): BroadcastContextResult | null {
  if (
    !isRecord(envelope.result) ||
    envelope.result.schemaVersion !== BROADCAST_CONTEXT_SCHEMA_VERSION
  ) {
    return null;
  }
  return parseBroadcastContextProxyResult(envelope.result, {
    sourceDurationMs: request.sourceDurationMs,
    chapters: request.chapters,
    candidates: request.candidates,
    participantGrounding: request.participantGrounding,
    outputLanguage: request.outputLanguage,
    castRosterId: request.castRosterId,
  });
}

async function contextLedgerResultReceiptsMatch(
  ledger: BroadcastContextPhaseLedger,
  contextResultFingerprint: string,
): Promise<boolean> {
  const requiredUnits = ledger.units.filter(
    (unit) =>
      unit.required &&
      (unit.phase === "discovery" || unit.phase === "jury"),
  );
  for (const unit of requiredUnits) {
    if (
      unit.status !== "succeeded" ||
      unit.result === undefined ||
      unit.modelReceipt === undefined
    ) {
      return false;
    }
    const expectedAnalysisMode =
      unit.phase === "jury"
        ? "selection"
        : unit.unitId === "overview"
          ? "overview"
          : "discovery";
    if (unit.modelReceipt.analysisMode !== expectedAnalysisMode) {
      return false;
    }
    const expectedResultFingerprint = await createContentFingerprint([
      BROADCAST_CONTEXT_UNIT_RESULT_FINGERPRINT_DOMAIN,
      unit.inputDigest,
      serializeBroadcastContextLedgerJsonValue(unit.result),
    ]);
    if (unit.modelReceipt.resultFingerprint !== expectedResultFingerprint) {
      return false;
    }
    if (
      unit.phase === "jury" &&
      unit.modelReceipt.parentContextResultFingerprint !==
        contextResultFingerprint
    ) {
      return false;
    }
  }
  return requiredUnits.length > 0;
}

export async function inspectCurrentTranscriptCheckpoint(input: {
  readonly session: BroadcastContextSessionRecord;
  readonly sourceContentFingerprint: string;
  readonly expectedCaptionVideoId: string | null;
}): Promise<boolean> {
  const { session } = input;
  let transcriptChapters: readonly BroadcastContextChapterInput[];
  try {
    ({ transcriptChapters } =
      partitionBroadcastContextSessionChapters(session));
  } catch {
    return false;
  }
  if (
    session.gapChunkIds.length > 0 ||
    session.fragmentGaps.length > 0 ||
    session.transcriptSealOperationKey === null ||
    !(await isCurrentTranscriptSealOperationKey({
      operationKey: session.transcriptSealOperationKey,
      runId: session.runId,
      contentFingerprint: input.sourceContentFingerprint,
      modelRevision: session.modelRevision,
      sourceCastRosterId: session.sourceCastRosterId,
    }))
  ) {
    return false;
  }

  if (
    session.transcriptEvidenceInputSignature === null ||
    session.transcriptEvidenceCheckpointJson === null ||
    session.transcriptProviderReceiptInputSignature === null ||
    session.transcriptProviderReceiptCheckpointJson === null
  ) {
    return false;
  }

  const evidence = parseBroadcastTranscriptResolvedEvidenceCheckpointJson(
    session.transcriptEvidenceCheckpointJson,
  );
  const provider = parseBroadcastTranscriptProviderReceiptCheckpointJson(
    session.transcriptProviderReceiptCheckpointJson,
  );
  if (
    evidence === null ||
    provider === null ||
    evidence.schemaVersion !==
      BROADCAST_TRANSCRIPT_RESOLVED_EVIDENCE_SCHEMA_VERSION ||
    provider.schemaVersion !==
      BROADCAST_TRANSCRIPT_PROVIDER_RECEIPT_CHECKPOINT_SCHEMA_VERSION ||
    evidence.sourceFingerprint !== session.inputSignature ||
    provider.sourceFingerprint !== session.inputSignature ||
    evidence.sourceDurationMs !== session.sourceDurationMs ||
    provider.sourceDurationMs !== session.sourceDurationMs ||
    evidence.transcriptInputSignature !== session.transcriptSealOperationKey ||
    session.transcriptEvidenceInputSignature !==
      evidence.transcriptInputSignature ||
    session.transcriptProviderReceiptInputSignature !==
      provider.routeManifestFingerprint ||
    evidence.modelRevision !== session.modelRevision ||
    broadcastTranscriptProviderReceiptCheckpointModelRevision(provider) !==
      session.modelRevision ||
    provider.captionReceipts.some(
      ({ receipt }) =>
        input.expectedCaptionVideoId === null ||
        receipt.videoId !== input.expectedCaptionVideoId,
    )
  ) {
    return false;
  }

  try {
    const chapterRanges = transcriptChapters.map(({ startMs, endMs }) => ({
      startMs,
      endMs,
    }));
    const evidenceSettlement = inspectBroadcastTranscriptEvidenceSettlement({
      checkpoint: evidence,
      chapterRanges,
      gapRanges: session.fragmentGaps,
    });
    const providerSettlement =
      inspectBroadcastTranscriptProviderReceiptSettlement({
        checkpoint: provider,
        chapterRanges: transcriptChapters,
        resolvedChunkIds: evidence.resolvedEvidence.map(({ chunkId }) => chunkId),
        gapChunkIds: session.gapChunkIds,
      });
    return evidenceSettlement.isPlanSettled && providerSettlement.isPlanSettled;
  } catch {
    return false;
  }
}

function currentCandidateRecord(
  record: CandidatePassBInsightsRecord,
  runId: string,
  inputSignature: string,
): boolean {
  if (
    record.schemaVersion !== CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION ||
    record.runId !== runId ||
    record.inputSignature !== inputSignature ||
    record.modelManifestHash !== CANDIDATE_PASS_B_ROUTING_MODEL_REVISION
  ) {
    return false;
  }
  try {
    assertCandidatePassBInsightsRecord(record);
    return true;
  } catch {
    return false;
  }
}

export async function certifyAnalysisPipelineSuccess(
  input: AnalysisPipelineSuccessInput,
): Promise<AnalysisPipelineSuccess> {
  const { manifest, fastResult, fastTerminal, session } = input;

  if (
    manifest.schemaVersion !== CURRENT_FAST_RESULT_SCHEMA_VERSION ||
    fastResult.schemaVersion !== CURRENT_FAST_RESULT_SCHEMA_VERSION ||
    fastTerminal.schemaVersion !== CURRENT_FAST_RESULT_SCHEMA_VERSION ||
    session.schemaVersion !== BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION
  ) {
    return fail(
      "fastPass",
      "current-schema-required",
      "Only the current analysis and context-session schemas may be certified.",
    );
  }
  try {
    assertDurableManifestPayload(manifest.result, "reaction");
    assertDurableFinalResultPayload(fastResult.result, "reaction");
  } catch {
    return fail(
      "fastPass",
      "fast-result-invalid",
      "The reopened fast-pass artifacts are not canonical current records.",
    );
  }

  if (
    manifest.runId !== fastResult.runId ||
    manifest.runId !== fastTerminal.runId ||
    manifest.runId !== session.runId ||
    manifest.inputSignature !== fastResult.inputSignature ||
    manifest.inputSignature !== fastTerminal.inputSignature ||
    manifest.inputSignature !== session.inputSignature ||
    manifest.modelManifestHash !== fastResult.modelManifestHash ||
    manifest.modelManifestHash !== fastTerminal.modelManifestHash ||
    manifest.modelManifestHash !== CURRENT_FAST_PASS_MODEL_MANIFEST_HASH
  ) {
    return fail(
      "commitFastResult",
      "run-fence-mismatch",
      "Fast-pass, terminal, and whole-context artifacts do not belong to one run.",
    );
  }
  if (
    JSON.stringify(manifest.result.input) !==
      JSON.stringify(fastResult.result.input) ||
    fastResult.result.input.source.durationMs !== session.sourceDurationMs
  ) {
    return fail(
      "commitFastResult",
      "source-fence-mismatch",
      "The stored source descriptor or duration changed between pipeline stages.",
    );
  }
  if (
    fastTerminal.resultRecordKind !== "finalResult" ||
    fastTerminal.resultArtifactId !== fastResult.artifactId ||
    fastTerminal.outcome !==
      durableCoverageDisposition(fastResult.result.coverage)
  ) {
    return fail(
      "commitFastResult",
      "fast-result-invalid",
      "The terminal pointer does not reopen the exact completed fast result.",
    );
  }

  const sourceContentFingerprint =
    fastResult.result.input.source.contentFingerprint;
  if (
    !(await inspectCurrentTranscriptCheckpoint({
      session,
      sourceContentFingerprint,
      expectedCaptionVideoId:
        fastResult.result.input.source.captionVideoId,
    }))
  ) {
    return fail(
      "broadcastContext",
      "transcript-unsettled",
      "Every planned transcript cell must be settled before context analysis is certified.",
    );
  }

  if (
    session.participantGroundingInputSignature === null ||
    session.participantGroundingPlanFingerprint === null ||
    session.participantGroundingCheckpointJson === null ||
    session.transcriptSealOperationKey === null
  ) {
    return fail(
      "broadcastContext",
      "participant-grounding-stale",
      "The participant grounding checkpoint is incomplete.",
    );
  }
  let expectedGroundingSignature: string;
  try {
    expectedGroundingSignature =
      await createBroadcastParticipantGroundingInputSignature({
        inputSignature: session.inputSignature,
        transcriptSealOperationKey: session.transcriptSealOperationKey,
        participantGroundingPlanFingerprint:
          session.participantGroundingPlanFingerprint,
        participantGroundingCheckpointJson:
          session.participantGroundingCheckpointJson,
      });
  } catch {
    return fail(
      "broadcastContext",
      "participant-grounding-stale",
      "The participant grounding signature cannot be reproduced.",
    );
  }
  if (
    expectedGroundingSignature !==
      session.participantGroundingInputSignature
  ) {
    return fail(
      "broadcastContext",
      "participant-grounding-stale",
      "The participant grounding checkpoint no longer matches its signature.",
    );
  }
  let participantPreContext;
  try {
    participantPreContext =
      await restoreBroadcastParticipantPreContextCheckpoint(session);
  } catch {
    participantPreContext = null;
  }
  if (participantPreContext === null) {
    return fail(
      "broadcastContext",
      "participant-grounding-stale",
      "The participant pre-context plan, receipts, or grounding cannot be replayed.",
    );
  }

  if (
    session.contextInputSignature === null ||
    session.contextInputCheckpointJson === null ||
    session.contextPhaseLedgerJson === null ||
    session.contextResultJson === null
  ) {
    return fail(
      "broadcastContext",
      "context-input-stale",
      "The durable whole-broadcast context checkpoint is incomplete.",
    );
  }
  const contextRequest = parseCurrentContextCheckpoint(
    session.contextInputCheckpointJson,
  );
  if (
    contextRequest === null ||
    contextRequest.sourceDurationMs !== session.sourceDurationMs ||
    contextRequest.castRosterId !== session.sourceCastRosterId ||
    JSON.stringify(contextRequest.participantGrounding) !==
      JSON.stringify(participantPreContext.grounding) ||
    JSON.stringify(contextRequest.chapters) !==
      JSON.stringify(compactBroadcastContextChapters(session.chapters))
  ) {
    return fail(
      "broadcastContext",
      "context-input-stale",
      "The current context request does not match transcript and participant evidence.",
    );
  }
  const expectedContextSignature = await createContentFingerprint([
    session.inputSignature,
    session.contextInputCheckpointJson,
    session.participantGroundingInputSignature,
    `broadcast-context-routing:${AI_BROADCAST_CONTEXT_ROUTING_REVISION}`,
    `topical-discovery:${BROADCAST_TOPICAL_DISCOVERY_VERSION}`,
  ]);
  if (expectedContextSignature !== session.contextInputSignature) {
    return fail(
      "broadcastContext",
      "context-input-stale",
      "The whole-context request does not match the current routing manifest.",
    );
  }

  const contextLedger = parseBroadcastContextPhaseLedgerJson(
    session.contextPhaseLedgerJson,
  );
  if (
    contextLedger === null ||
    !broadcastContextPhaseLedgerMatchesFence(contextLedger, {
      parentContextSignature: session.contextInputSignature,
      transcriptSignature: session.transcriptSealOperationKey,
      groundingSignature: session.participantGroundingInputSignature,
    }) ||
    !contextLedger.units.some(
      (unit) =>
        unit.required &&
        unit.phase === "discovery" &&
        unit.unitId === "overview" &&
        unit.status === "succeeded",
    ) ||
    !contextLedger.units.some(
      (unit) =>
        unit.required &&
        unit.phase === "jury" &&
        unit.unitId === "selection" &&
        unit.status === "succeeded",
    ) ||
    contextLedger.units
      .filter(
        (unit) =>
          unit.required &&
          (unit.phase === "discovery" || unit.phase === "jury"),
      )
      .some((unit) => unit.status !== "succeeded")
  ) {
    return fail(
      "broadcastContext",
      "context-ledger-incomplete",
      "Required discovery and jury units are not durably complete.",
    );
  }

  const envelope = parseCurrentContextEnvelope(session.contextResultJson);
  if (
    envelope === null ||
    !contextCandidateRangesMatch(contextRequest, envelope, input.candidates)
  ) {
    return fail(
      "broadcastContext",
      "context-result-invalid",
      "The current context result envelope does not match its candidate request.",
    );
  }
  const contextResult = currentContextResult(envelope, contextRequest);
  if (
    contextResult === null ||
    !isFinalBroadcastContextResult(contextResult)
  ) {
    return fail(
      "broadcastContext",
      "context-result-invalid",
      "The stored result is not a complete whole-broadcast overview for its exact input.",
    );
  }
  const contextResultFingerprint = await createContentFingerprint([
    BROADCAST_CONTEXT_FINAL_RESULT_FINGERPRINT_DOMAIN,
    session.contextInputSignature,
    serializeBroadcastContextLedgerJsonValue(contextResult),
  ]);
  if (
    !(await contextLedgerResultReceiptsMatch(
      contextLedger,
      contextResultFingerprint,
    ))
  ) {
    return fail(
      "broadcastContext",
      "context-result-invalid",
      "The whole-broadcast result is not linked to every required successful context payload.",
    );
  }

  const leadById = new Map(
    contextResult.discoveredLeads.map((lead) => [lead.leadId, lead]),
  );
  const selectedLeads = envelope.refinementLeadIds.flatMap((leadId) => {
    const lead = leadById.get(leadId);
    return lead === undefined ? [] : [lead];
  });
  if (
    selectedLeads.length !== envelope.refinementLeadIds.length ||
    envelope.fastRefinementLeadIds.some(
      (leadId) => !envelope.refinementLeadIds.includes(leadId),
    )
  ) {
    return fail(
      "deepPass",
      "refinement-evidence-incomplete",
      "The refinement plan references unavailable or unselected discovery leads.",
    );
  }
  const refinementPlan = createDiscoveredLeadRefinementPlan(selectedLeads, {
    preserveInputOrder: true,
  });
  if (
    !stringArraysEqual(
      refinementPlan.selectedLeadIds,
      envelope.refinementLeadIds,
    )
  ) {
    return fail(
      "deepPass",
      "refinement-evidence-incomplete",
      "The stored refinement selection is not the current deterministic plan.",
    );
  }

  let refinementEvidenceProjectionFingerprint: string | null = null;
  let durableSemanticCandidates: readonly UnifiedHighlightCandidate[] = [];
  if (refinementPlan.selectedLeadIds.length === 0) {
    if (
      session.refinementTranscriptInputSignature !== null ||
      session.refinementTranscriptCheckpointJson !== null ||
      session.refinementEvidenceLedgerJson !== null ||
      session.refinementInputSignature !== null ||
      session.refinementCandidatesJson !== null ||
      contextLedger.units.some(
        (unit) => unit.required && unit.phase === "refinement",
      )
    ) {
      return fail(
        "deepPass",
        "refinement-evidence-incomplete",
        "A zero-lead plan must not retain stale refinement artifacts.",
      );
    }
  } else {
    let refinementLedger;
    try {
      refinementLedger =
        await parseBroadcastContextSessionRefinementEvidenceLedger(session);
    } catch {
      refinementLedger = null;
    }
    if (
      refinementLedger === null ||
      refinementLedger.schemaVersion !==
        BROADCAST_REFINEMENT_EVIDENCE_LEDGER_SCHEMA_VERSION ||
      JSON.stringify(refinementLedger.selectedLeadPlan) !==
        JSON.stringify(refinementPlan) ||
      !broadcastRefinementEvidenceLedgerCanPublish(refinementLedger)
    ) {
      return fail(
        "deepPass",
        "refinement-evidence-incomplete",
        "The active refinement evidence route is missing, stale, or unsettled.",
      );
    }
    const activeProjection =
      projectBroadcastRefinementActiveEvidenceRoute(refinementLedger);
    const activeEvidence =
      getBroadcastRefinementActiveEvidencePayload(refinementLedger);
    if (
      activeProjection === null ||
      activeEvidence === null ||
      !activeProjection.publicationEligible
    ) {
      return fail(
        "deepPass",
        "refinement-evidence-incomplete",
        "The active refinement evidence projection is not publishable.",
      );
    }
    refinementEvidenceProjectionFingerprint =
      activeProjection.projectionFingerprint;
    let leadInputs;
    try {
      leadInputs = createSemanticRefinementLeadInputs({
        plan: refinementPlan,
        transcripts: activeRefinementEvidenceTranscripts(activeEvidence),
        discoveredLeads: contextResult.discoveredLeads,
        fastRefinementLeadIds: envelope.fastRefinementLeadIds,
        sourceDurationMs: contextRequest.sourceDurationMs,
        castRosterId: contextRequest.castRosterId,
        wholeBroadcastChapters: contextRequest.chapters,
        participantGrounding: contextRequest.participantGrounding,
        outputLanguage: contextRequest.outputLanguage,
      });
    } catch {
      return fail(
        "deepPass",
        "refinement-evidence-incomplete",
        "The active refinement evidence cannot reproduce lead inputs.",
      );
    }
    const routingManifestSignature =
      `broadcast-context-routing:${AI_BROADCAST_CONTEXT_ROUTING_REVISION}`;
    const expectedRefinementInputSignature =
      await createSemanticRefinementAiInputSignature({
        activeEvidenceProjectionFingerprint:
          activeProjection.projectionFingerprint,
        routingManifestSignature,
        leadInputs,
      });
    let parsedRefinementCandidates = null;
    if (session.refinementCandidatesJson !== null) {
      try {
        parsedRefinementCandidates = parseSemanticLeadCandidates(
          JSON.parse(session.refinementCandidatesJson) as unknown,
        );
      } catch {
        parsedRefinementCandidates = null;
      }
    }
    if (
      session.refinementInputSignature !==
        expectedRefinementInputSignature ||
      parsedRefinementCandidates === null ||
      !semanticRefinementPhaseReceiptsMatchActiveProjection({
        units: contextLedger.units,
        leadInputs,
        activeEvidenceProjectionFingerprint:
          activeProjection.projectionFingerprint,
        routingManifestSignature,
        outputLanguage: contextRequest.outputLanguage,
      })
    ) {
      return fail(
        "deepPass",
        "refinement-receipt-stale",
        "Refinement AI receipts do not match the active evidence projection.",
      );
    }
    durableSemanticCandidates = parsedRefinementCandidates;
  }
  if (!broadcastContextPhaseLedgerCanComplete(contextLedger)) {
    return fail(
      "deepPass",
      "context-ledger-incomplete",
      "At least one required context or refinement ledger unit is unfinished.",
    );
  }
  try {
    assertBroadcastContextSessionRecord(session);
  } catch {
    return fail(
      "deepPass",
      "context-result-invalid",
      "The completed context session is not a canonical current durable record.",
    );
  }

  const immutableCandidateProjection = (
    candidate: Pick<
      UnifiedHighlightCandidate,
      | "id"
      | "startMs"
      | "peakMs"
      | "endMs"
      | "score"
      | "signalKinds"
      | "evidence"
    >,
  ) => ({
    id: candidate.id,
    startMs: candidate.startMs,
    peakMs: candidate.peakMs,
    endMs: candidate.endMs,
    score: candidate.score,
    signalKinds: candidate.signalKinds,
    evidence: candidate.evidence,
  });
  const expectedCandidateCohort = [
    ...fastResult.result.candidates,
    ...selectNonOverlappingDiscoveredCandidates(
      fastResult.result.candidates,
      durableSemanticCandidates,
    ),
  ].sort(
    (left, right) =>
      left.peakMs - right.peakMs || left.id.localeCompare(right.id),
  );
  const actualCandidateCohort = [...input.candidates].sort(
    (left, right) =>
      left.peakMs - right.peakMs || left.id.localeCompare(right.id),
  );
  if (
    JSON.stringify(
      actualCandidateCohort.map(immutableCandidateProjection),
    ) !==
    JSON.stringify(
      expectedCandidateCohort.map(immutableCandidateProjection),
    )
  ) {
    return fail(
      "deepPass",
      "run-fence-mismatch",
      "The candidate cohort cannot be reproduced from the durable fast and semantic artifacts.",
    );
  }

  const candidateIds = new Set(input.candidates.map(({ id }) => id));
  if (candidateIds.size !== input.candidates.length) {
    return fail(
      "deepPass",
      "run-fence-mismatch",
      "The current candidate reservoir is invalid.",
    );
  }
  const qualified = finalizeContextQualifiedCandidates(
    input.candidates,
    contextResult.annotations,
  );
  const durableContextByCandidateId =
    input.candidateRecord?.contextByCandidateId ?? {};
  const contextExcludedCandidateIds = new Set(
    selectContextExcludedCandidateIds(
      input.candidates,
      qualified.projectionById,
    ),
  );
  const queuedDetailIds = new Set(
    selectCandidateDetailCandidateIds(
      input.candidates,
      qualified.projectionById,
    ),
  );
  const detailCandidateIds = input.candidates
    .filter(
      (candidate) => queuedDetailIds.has(candidate.id),
    )
    .sort(
      (left, right) =>
        Number(right.reviewState === "approved") -
          Number(left.reviewState === "approved") ||
        right.score - left.score ||
        left.peakMs - right.peakMs ||
        left.id.localeCompare(right.id),
    )
    .map(({ id }) => id);

  const sourceFenceByCandidateId: Record<
    string,
    CandidatePassBVerificationSourceFence
  > = Object.fromEntries(
    input.candidates.map(({ id, startMs, endMs }) => [
      id,
      {
        candidateId: id,
        sourceStartMs: startMs,
        sourceEndMs: endMs,
        routingModelRevision: CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
        refinementEvidenceProjectionFingerprint,
        outputLanguage: contextRequest.outputLanguage,
        castRosterId: contextRequest.castRosterId,
      },
    ]),
  );

  if (
    input.candidateRecord !== null &&
    !currentCandidateRecord(
      input.candidateRecord,
      manifest.runId,
      manifest.inputSignature,
    )
  ) {
    return fail(
      "deepPass",
      "current-schema-required",
      "Candidate detail evidence is not a current, source-fenced record.",
    );
  }
  if (input.candidateRecord === null) {
    return fail(
      "deepPass",
      "candidate-plan-invalid",
      "The exact Candidate Pass B plan was not durably committed.",
    );
  }
  const missingPlanContextIds = detailCandidateIds.filter(
    (candidateId) =>
      !isCandidatePassBContextPacket(
        durableContextByCandidateId[candidateId],
      ),
  );
  if (missingPlanContextIds.length > 0) {
    return fail(
      "deepPass",
      "candidate-plan-invalid",
      "The durable Candidate Pass B plan is missing exact candidate context packets.",
      missingPlanContextIds,
    );
  }
  const expectedCandidatePlanReceipt = await createCandidatePassBPlanReceipt({
    runId: manifest.runId,
    inputSignature: manifest.inputSignature,
    contextInputSignature: session.contextInputSignature,
    refinementEvidenceProjectionFingerprint,
    plannedCandidateIds: detailCandidateIds,
    contextByCandidateId: Object.fromEntries(
      detailCandidateIds.map((candidateId) => [
        candidateId,
        durableContextByCandidateId[candidateId]!,
      ]),
    ),
  });
  if (
    JSON.stringify(input.candidateRecord.planReceipt) !==
    JSON.stringify(expectedCandidatePlanReceipt)
  ) {
    return fail(
      "deepPass",
      "candidate-plan-invalid",
      "The durable Candidate Pass B plan does not match the exact current context and planned cohort.",
      detailCandidateIds,
    );
  }
  const invalidCurrentDetailIds = detailCandidateIds.filter((candidateId) => {
    const context = durableContextByCandidateId[candidateId];
    const receipt =
      input.candidateRecord?.verificationReceiptById?.[candidateId];
    return (
      context === undefined ||
      !isCandidatePassBContextPacket(context) ||
      receipt?.schemaVersion !==
        CANDIDATE_PASS_B_VERIFICATION_RECEIPT_SCHEMA_VERSION ||
      !currentCandidateModel(
        input.candidateRecord?.modelByCandidateId?.[candidateId],
      )
    );
  });
  if (invalidCurrentDetailIds.length > 0) {
    return fail(
      "deepPass",
      "candidate-detail-not-durable",
      "Some planned candidates lack current context, model identity, or verification receipts.",
      invalidCurrentDetailIds,
    );
  }

  const durableCandidateIds = selectCandidatePassBDurableIds({
    candidateIds: detailCandidateIds,
    record: input.candidateRecord,
    contextByCandidateId: durableContextByCandidateId,
    sourceFenceByCandidateId,
  });
  const missingDurableCandidateIds = detailCandidateIds.filter(
    (candidateId) => !durableCandidateIds.has(candidateId),
  );
  if (missingDurableCandidateIds.length > 0) {
    return fail(
      "deepPass",
      "candidate-detail-not-durable",
      "Some planned candidate artifacts did not survive durable readback.",
      missingDurableCandidateIds,
    );
  }

  const contextScheduledCandidateIds = new Set(
    selectBroadcastContextCandidateCohort(input.candidates).map(({ id }) => id),
  );
  const verificationCohort = selectCandidateVerificationCohort({
    candidates: input.candidates,
    contextScheduledCandidateIds,
    contextExcludedCandidateIds,
    detailScheduledCandidateIds: new Set(detailCandidateIds),
    contextByCandidateId: durableContextByCandidateId,
  });
  const finalVerification = finalizeFullyVerifiedCandidates({
    candidates: verificationCohort,
    contextExcludedCandidateIds,
    contextByCandidateId: durableContextByCandidateId,
    insightByCandidateId: input.candidateRecord?.insightById ?? {},
    receiptByCandidateId:
      input.candidateRecord?.verificationReceiptById ?? {},
    completeEvidenceCandidateIds: durableCandidateIds,
    refinementEvidenceProjectionFingerprint,
    outputLanguage: contextRequest.outputLanguage,
    castRosterId: contextRequest.castRosterId,
  });
  const pipelineGapCandidateIds = Object.entries(
    finalVerification.gapByCandidateId,
  ).flatMap(([candidateId, gap]) =>
    isPipelineGap(gap) ? [candidateId] : [],
  );
  if (pipelineGapCandidateIds.length > 0) {
    return fail(
      "publication",
      "candidate-verification-incomplete",
      "Final publication still contains candidates that never reached a complete judgement.",
      pipelineGapCandidateIds,
    );
  }

  const finalCandidateIds = finalVerification.candidates.map(({ id }) => id);
  return {
    ok: true,
    certificate: {
      schemaVersion: CERTIFICATE_SCHEMA_VERSION,
      runId: manifest.runId,
      inputSignature: manifest.inputSignature,
      sourceContentFingerprint,
      sourceDurationMs: session.sourceDurationMs,
      transcriptSealOperationKey: session.transcriptSealOperationKey,
      participantGroundingInputSignature:
        session.participantGroundingInputSignature,
      contextInputSignature: session.contextInputSignature,
      contextResultFingerprint,
      refinementEvidenceProjectionFingerprint,
      refinementInputSignature: session.refinementInputSignature,
      candidatePlanFingerprint:
        input.candidateRecord.planReceipt.planFingerprint,
      finalCandidateIds,
      quality: finalCandidateIds.length > 0 ? "usable" : "empty",
    },
  };
}
