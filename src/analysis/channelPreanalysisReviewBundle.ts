import {
  BROADCAST_CONTEXT_SCHEMA_VERSION,
  MAX_BROADCAST_CONTEXT_SOURCE_DURATION_MS,
  type BroadcastContextResult,
} from "./broadcastContextProtocol";
import {
  BROADCAST_PARTICIPANT_GROUNDING_SCHEMA_VERSION,
  type BroadcastParticipantGrounding,
} from "./broadcastParticipantGrounding";
import {
  CANDIDATE_PASS_B_MAX_CANDIDATES,
  CANDIDATE_PASS_B_MAX_DURATION_MS,
  CANDIDATE_PASS_B_MIN_DURATION_MS,
  type CandidatePassBEvidence,
} from "./candidatePassB";
import {
  isCandidatePassBContextPacket,
  isCandidatePassBVerificationReceipt,
  candidatePassBReceiptMatchesContext,
} from "./candidateFinalVerification";
import type {
  CandidatePassBContextPacket,
  CandidatePassBFrameReceipt,
  CandidatePassBInsight,
  CandidatePassBVerificationReceipt,
} from "./candidatePassBWorkerProtocol";
import {
  channelPreanalysisSourceById,
  type ChannelPreanalysisSourceId,
} from "./channelPreanalysisSources";
import {
  validateChannelPreanalysisVisualCoverageReceipt,
  type ChannelPreanalysisVisualCoverageReceipt,
} from "./channelPreanalysisVisualCoverage";
import { YOUTUBE_VIDEO_ID_PATTERN } from "./youtubeCaptionTrack";
import type { ContentDigestAdapter } from "../security/contentFingerprint";

export const CHANNEL_PREANALYSIS_REVIEW_BUNDLE_SCHEMA_VERSION = "2.0.0" as const;
export const CHANNEL_PREANALYSIS_REVIEW_CERTIFICATE_SCHEMA_VERSION = "2.0.0" as const;
export const CHANNEL_PREANALYSIS_PARTICIPANT_PROVENANCE_SCHEMA_VERSION = "1.0.0" as const;
export const CHANNEL_PREANALYSIS_REVIEW_BUNDLE_MAX_BYTES = 4 * 1024 * 1024;
export const CHANNEL_PREANALYSIS_REVIEW_FRAME_MAX_BYTES = 48 * 1024;

export type ChannelPreanalysisSha256Digest = `sha256:${string}`;

export interface ChannelPreanalysisReviewSourceIdentity {
  readonly sourceId: ChannelPreanalysisSourceId;
  readonly channelId: string;
  readonly videoId: string;
}

export interface ChannelPreanalysisParticipantGroundingProvenance {
  readonly schemaVersion: typeof CHANNEL_PREANALYSIS_PARTICIPANT_PROVENANCE_SCHEMA_VERSION;
  readonly checkpointDigest: ChannelPreanalysisSha256Digest;
  readonly generatedAt: string;
  readonly pipelineRevision: string;
}

export interface ChannelPreanalysisReviewFrameReference
  extends CandidatePassBFrameReceipt {
  /** Milliseconds relative to this candidate's sourceStartMs. */
  readonly timestampMs: number;
  /** Exact JPEG used by the AI request; never a separately regenerated preview. */
  readonly dataBase64: string;
}

export interface ChannelPreanalysisReviewModelReference {
  readonly id: string;
  readonly revision: string;
}

export interface ChannelPreanalysisReviewCandidate {
  readonly candidateId: string;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly context: CandidatePassBContextPacket;
  readonly evidence: CandidatePassBEvidence;
  readonly insight: CandidatePassBInsight;
  readonly model: ChannelPreanalysisReviewModelReference;
  readonly verificationReceipt: CandidatePassBVerificationReceipt;
  readonly frames: readonly [
    ChannelPreanalysisReviewFrameReference,
    ChannelPreanalysisReviewFrameReference,
    ChannelPreanalysisReviewFrameReference,
    ChannelPreanalysisReviewFrameReference,
  ];
  /** Selects the impact frame; its timestamp is candidate-relative. */
  readonly impactThumbnailFrameIndex: 0 | 1 | 2 | 3;
}

interface ChannelPreanalysisReviewCertificateBase {
  readonly schemaVersion: typeof CHANNEL_PREANALYSIS_REVIEW_CERTIFICATE_SCHEMA_VERSION;
  readonly pipelineRevision: string;
  readonly sourceIdentityDigest: ChannelPreanalysisSha256Digest;
  readonly transcriptDigest: ChannelPreanalysisSha256Digest;
  readonly broadcastContextDigest: ChannelPreanalysisSha256Digest;
  readonly participantGroundingDigest: ChannelPreanalysisSha256Digest;
  readonly visualCoverageDigest: ChannelPreanalysisSha256Digest;
  readonly candidateSetDigest: ChannelPreanalysisSha256Digest;
}

export type ChannelPreanalysisReviewPipelineCertificate =
  | (ChannelPreanalysisReviewCertificateBase & {
      readonly outcome: "review-ready";
      readonly finalCandidateIds: readonly [string, ...string[]];
    })
  | (ChannelPreanalysisReviewCertificateBase & {
      readonly outcome: "verified-empty";
      readonly finalCandidateIds: readonly [];
    });

export interface ChannelPreanalysisReviewBundle {
  readonly schemaVersion: typeof CHANNEL_PREANALYSIS_REVIEW_BUNDLE_SCHEMA_VERSION;
  readonly artifactId: string;
  readonly artifactRevision: number;
  readonly createdAt: string;
  readonly source: ChannelPreanalysisReviewSourceIdentity;
  readonly sourceDurationMs: number;
  readonly transcriptDigest: ChannelPreanalysisSha256Digest;
  readonly broadcastContext: BroadcastContextResult;
  readonly broadcastContextDigest: ChannelPreanalysisSha256Digest;
  readonly visualCoverage: ChannelPreanalysisVisualCoverageReceipt;
  readonly participantGrounding: BroadcastParticipantGrounding;
  readonly participantGroundingProvenance: ChannelPreanalysisParticipantGroundingProvenance;
  readonly candidates: readonly ChannelPreanalysisReviewCandidate[];
  readonly certificate: ChannelPreanalysisReviewPipelineCertificate;
}

export type ChannelPreanalysisReviewBundleErrorCode =
  | "INVALID_JSON"
  | "TOO_LARGE"
  | "INVALID_SCHEMA"
  | "INVALID_IDENTITY"
  | "INVALID_DIGEST"
  | "INVALID_CONTEXT"
  | "INVALID_VISUAL_COVERAGE"
  | "INVALID_GROUNDING"
  | "INVALID_CANDIDATE"
  | "INVALID_CERTIFICATE"
  | "RAW_MEDIA_FORBIDDEN"
  | "CRYPTO_UNAVAILABLE"
  | "DIGEST_MISMATCH";

export class ChannelPreanalysisReviewBundleError extends Error {
  public constructor(
    public readonly code: ChannelPreanalysisReviewBundleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ChannelPreanalysisReviewBundleError";
  }
}

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const SAFE_REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const FORBIDDEN_RAW_MEDIA_KEYS = new Set([
  "audioBase64",
  "wavBase64",
  "pcmBase64",
  "rawAudio",
  "audioBytes",
  "wavBytes",
]);

export function channelPreanalysisReviewBundleArtifactId(
  videoId: string,
  revision: number,
): string {
  return `review-bundle:${videoId}:v${revision}`;
}

export function channelPreanalysisReviewBundleStorageKey(
  sourceId: ChannelPreanalysisSourceId,
  videoId: string,
  revision: number,
): string {
  return `${sourceId}/videos/${videoId}.review.v${revision}.json`;
}

function fail(
  code: ChannelPreanalysisReviewBundleErrorCode,
  message: string,
): never {
  throw new ChannelPreanalysisReviewBundleError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function isDigest(value: unknown): value is ChannelPreanalysisSha256Digest {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isBoundedText(value: unknown, maximum = 8_000): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

function hasRawMedia(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasRawMedia);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, child]) => FORBIDDEN_RAW_MEDIA_KEYS.has(key) || hasRawMedia(child),
  );
}

function base64DecodedByteLength(value: unknown): number | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  ) {
    return null;
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function validateContext(value: unknown, sourceDurationMs: number): BroadcastContextResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "broadcastSummaryKo",
      "hostStreamerProfile",
      "recurringThemesKo",
      "annotations",
      "semanticChaptersSupported",
      "semanticChapters",
      "discoveredLeadsSupported",
      "discoveredLeads",
      "coverage",
    ]) ||
    value.schemaVersion !== BROADCAST_CONTEXT_SCHEMA_VERSION ||
    !isBoundedText(value.broadcastSummaryKo, 24_000) ||
    value.semanticChaptersSupported !== true ||
    value.discoveredLeadsSupported !== true ||
    !Array.isArray(value.recurringThemesKo) ||
    !Array.isArray(value.annotations) ||
    !Array.isArray(value.semanticChapters) ||
    !Array.isArray(value.discoveredLeads) ||
    !isRecord(value.coverage) ||
    !hasExactKeys(value.coverage, [
      "status",
      "coveredMs",
      "coverageRatio",
      "gaps",
      "partialChapterIds",
    ]) ||
    value.coverage.status !== "complete" ||
    value.coverage.coveredMs !== sourceDurationMs ||
    value.coverage.coverageRatio !== 1 ||
    !Array.isArray(value.coverage.gaps) ||
    value.coverage.gaps.length !== 0 ||
    !Array.isArray(value.coverage.partialChapterIds) ||
    value.coverage.partialChapterIds.length !== 0
  ) {
    fail("INVALID_CONTEXT", "Review bundle requires one complete final broadcast context.");
  }
  return value as unknown as BroadcastContextResult;
}

function validateGrounding(
  value: unknown,
  sourceDurationMs: number,
): BroadcastParticipantGrounding {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "status",
      "resolutionStatus",
      "sourceDurationMs",
      "castRosterId",
      "catalogVersion",
      "transcriptSourceChapterIds",
      "adapterReceipts",
      "participants",
      "evidence",
    ]) ||
    value.schemaVersion !== BROADCAST_PARTICIPANT_GROUNDING_SCHEMA_VERSION ||
    value.status !== "sealed" ||
    !["media-reviewed", "observed-identities"].includes(
      typeof value.resolutionStatus === "string"
        ? value.resolutionStatus
        : "",
    ) ||
    value.sourceDurationMs !== sourceDurationMs ||
    !Array.isArray(value.transcriptSourceChapterIds) ||
    !Array.isArray(value.adapterReceipts) ||
    value.adapterReceipts.length !== 3 ||
    !Array.isArray(value.participants) ||
    !Array.isArray(value.evidence)
  ) {
    fail("INVALID_GROUNDING", "Participant grounding checkpoint is not sealed for this source.");
  }
  const mediaReceipts = value.adapterReceipts.slice(1) as readonly unknown[];
  for (const [index, adapter] of [
    "visual-identity",
    "voice-identity",
  ].entries()) {
    const receipt = mediaReceipts[index];
    if (
      !isRecord(receipt) ||
      !hasExactKeys(receipt, [
        "adapter",
        "revision",
        "status",
        "inputCount",
        "processedCount",
        "unavailableReason",
      ]) ||
      receipt.adapter !== adapter ||
      receipt.status !== "completed" ||
      !isBoundedText(receipt.revision, 128) ||
      !Number.isSafeInteger(receipt.inputCount) ||
      (receipt.inputCount as number) < 0 ||
      receipt.processedCount !== receipt.inputCount ||
      receipt.unavailableReason !== null
    ) {
      fail(
        "INVALID_GROUNDING",
        `Review-ready publication requires a completed ${adapter} check.`,
      );
    }
  }
  return value as unknown as BroadcastParticipantGrounding;
}

function validateEvidence(value: unknown, candidateId: string): CandidatePassBEvidence {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "candidateId",
      "cues",
      "overlay",
      "quality",
      "status",
      "fallbackReason",
    ]) ||
    value.candidateId !== candidateId ||
    !["grounded-transcript", "provisional-transcript", "fast-pass-fallback"].includes(
      String(value.status),
    ) ||
    !Array.isArray(value.cues) ||
    !isRecord(value.overlay) ||
    !isRecord(value.quality)
  ) {
    fail("INVALID_CANDIDATE", `Candidate ${candidateId} evidence is invalid.`);
  }
  return value as unknown as CandidatePassBEvidence;
}

function validateInsight(value: unknown, candidateId: string): CandidatePassBInsight {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "eventSummaryKo",
      "reactionSummaryKo",
      "whyGoodClipKo",
      "uncertaintiesKo",
      "participantPresence",
      "participantSummaryKo",
      "identifiedParticipants",
      "clipDecision",
      "contextConsistency",
      "programMaterial",
    ]) ||
    !isBoundedText(value.eventSummaryKo, 8_000) ||
    !isBoundedText(value.reactionSummaryKo, 8_000) ||
    !isBoundedText(value.whyGoodClipKo, 8_000) ||
    !Array.isArray(value.uncertaintiesKo) ||
    !Array.isArray(value.identifiedParticipants) ||
    !["identified", "present-unidentified", "none-present", "insufficient-evidence"].includes(
      String(value.participantPresence),
    ) ||
    !isBoundedText(value.participantSummaryKo, 8_000) ||
    !["recommend", "reject", "uncertain"].includes(String(value.clipDecision)) ||
    !["consistent", "conflict", "insufficient"].includes(String(value.contextConsistency)) ||
    !["streamer-event", "music-or-intermission", "routine-or-unclear"].includes(
      String(value.programMaterial),
    )
  ) {
    fail("INVALID_CANDIDATE", `Candidate ${candidateId} insight is invalid.`);
  }
  return value as unknown as CandidatePassBInsight;
}

function validateCandidate(
  value: unknown,
  bundle: Pick<ChannelPreanalysisReviewBundle, "source" | "sourceDurationMs" | "artifactRevision">,
): ChannelPreanalysisReviewCandidate {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "candidateId",
      "sourceStartMs",
      "sourceEndMs",
      "context",
      "evidence",
      "insight",
      "model",
      "verificationReceipt",
      "frames",
      "impactThumbnailFrameIndex",
    ]) ||
    typeof value.candidateId !== "string" ||
    !SAFE_ID_PATTERN.test(value.candidateId) ||
    !Number.isSafeInteger(value.sourceStartMs) ||
    !Number.isSafeInteger(value.sourceEndMs) ||
    (value.sourceStartMs as number) < 0 ||
    (value.sourceEndMs as number) > bundle.sourceDurationMs ||
    (value.sourceEndMs as number) - (value.sourceStartMs as number) < CANDIDATE_PASS_B_MIN_DURATION_MS ||
    (value.sourceEndMs as number) - (value.sourceStartMs as number) > CANDIDATE_PASS_B_MAX_DURATION_MS ||
    !isCandidatePassBContextPacket(value.context) ||
    !isCandidatePassBVerificationReceipt(value.verificationReceipt) ||
    !isRecord(value.model) ||
    !hasExactKeys(value.model, ["id", "revision"]) ||
    !isBoundedText(value.model.id, 128) ||
    !isBoundedText(value.model.revision, 256) ||
    !Array.isArray(value.frames) ||
    value.frames.length !== 4 ||
    !Number.isSafeInteger(value.impactThumbnailFrameIndex) ||
    (value.impactThumbnailFrameIndex as number) < 0 ||
    (value.impactThumbnailFrameIndex as number) > 3
  ) {
    fail("INVALID_CANDIDATE", "Review candidate shape or source range is invalid.");
  }

  const candidateId = value.candidateId;
  const sourceStartMs = value.sourceStartMs as number;
  const sourceEndMs = value.sourceEndMs as number;
  const receipt = value.verificationReceipt;
  if (
    receipt.candidateId !== candidateId ||
    receipt.sourceStartMs !== sourceStartMs ||
    receipt.sourceEndMs !== sourceEndMs ||
    !candidatePassBReceiptMatchesContext(receipt, value.context, {
      candidateId: receipt.candidateId,
      sourceStartMs: receipt.sourceStartMs,
      sourceEndMs: receipt.sourceEndMs,
      routingModelRevision: receipt.routingModelRevision,
      refinementEvidenceProjectionFingerprint:
        receipt.refinementEvidenceProjectionFingerprint,
      outputLanguage: receipt.outputLanguage,
      castRosterId: receipt.castRosterId,
    }) ||
    value.model.id !== receipt.settlement.providerModelId ||
    value.model.revision !== receipt.settlement.providerModelRevision
  ) {
    fail("INVALID_CANDIDATE", `Candidate ${candidateId} receipt fence is stale.`);
  }

  const frames = value.frames.map((frameValue, index) => {
    if (
      !isRecord(frameValue) ||
      !hasExactKeys(frameValue, [
        "timestampMs",
        "mimeType",
        "byteLength",
        "contentDigest",
        "extractionRevision",
        "dataBase64",
      ]) ||
      base64DecodedByteLength(frameValue.dataBase64) !== frameValue.byteLength ||
      (frameValue.byteLength as number) > CHANNEL_PREANALYSIS_REVIEW_FRAME_MAX_BYTES
    ) {
      fail("INVALID_CANDIDATE", `Candidate ${candidateId} frame ${index + 1} is invalid.`);
    }
    const receiptFrame = receipt.dispatchIntent.mediaReceipt.frames[index];
    if (
      receiptFrame === undefined ||
      !Number.isSafeInteger(frameValue.timestampMs) ||
      (frameValue.timestampMs as number) < 0 ||
      (frameValue.timestampMs as number) >= sourceEndMs - sourceStartMs ||
      frameValue.timestampMs !== receiptFrame.timestampMs ||
      frameValue.mimeType !== receiptFrame.mimeType ||
      frameValue.byteLength !== receiptFrame.byteLength ||
      frameValue.contentDigest !== receiptFrame.contentDigest ||
      frameValue.extractionRevision !== receiptFrame.extractionRevision
    ) {
      fail("INVALID_CANDIDATE", `Candidate ${candidateId} frame receipt differs.`);
    }
    return frameValue as unknown as ChannelPreanalysisReviewFrameReference;
  });
  if (
    new Set(frames.map(({ timestampMs }) => timestampMs)).size !== 4
  ) {
    fail("INVALID_CANDIDATE", `Candidate ${candidateId} needs four distinct frames.`);
  }
  const thumbnail = frames[value.impactThumbnailFrameIndex as number];
  if (thumbnail === undefined || thumbnail.timestampMs !== receipt.thumbnailTimestampMs) {
    fail("INVALID_CANDIDATE", `Candidate ${candidateId} thumbnail must reference its impact frame.`);
  }

  return {
    candidateId,
    sourceStartMs,
    sourceEndMs,
    context: value.context,
    evidence: validateEvidence(value.evidence, candidateId),
    insight: validateInsight(value.insight, candidateId),
    model: value.model as unknown as ChannelPreanalysisReviewModelReference,
    verificationReceipt: receipt,
    frames: frames as unknown as ChannelPreanalysisReviewCandidate["frames"],
    impactThumbnailFrameIndex: value.impactThumbnailFrameIndex as 0 | 1 | 2 | 3,
  };
}

export function validateChannelPreanalysisReviewBundle(
  value: unknown,
): ChannelPreanalysisReviewBundle {
  if (hasRawMedia(value)) {
    fail("RAW_MEDIA_FORBIDDEN", "Review bundles contain media references, never raw media bytes.");
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "artifactId",
      "artifactRevision",
      "createdAt",
      "source",
      "sourceDurationMs",
      "transcriptDigest",
      "broadcastContext",
      "broadcastContextDigest",
      "visualCoverage",
      "participantGrounding",
      "participantGroundingProvenance",
      "candidates",
      "certificate",
    ]) ||
    value.schemaVersion !== CHANNEL_PREANALYSIS_REVIEW_BUNDLE_SCHEMA_VERSION ||
    !Number.isSafeInteger(value.artifactRevision) ||
    (value.artifactRevision as number) < 1 ||
    typeof value.createdAt !== "string" ||
    !ISO_DATE_PATTERN.test(value.createdAt) ||
    !isRecord(value.source)
  ) {
    fail("INVALID_SCHEMA", "Review bundle schema is invalid.");
  }

  const source = value.source;
  if (
    !hasExactKeys(source, ["sourceId", "channelId", "videoId"]) ||
    typeof source.sourceId !== "string" ||
    typeof source.channelId !== "string" ||
    typeof source.videoId !== "string" ||
    !YOUTUBE_VIDEO_ID_PATTERN.test(source.videoId)
  ) {
    fail("INVALID_IDENTITY", "Review bundle source identity is invalid.");
  }
  const configuredSource = channelPreanalysisSourceById(source.sourceId);
  if (configuredSource === null || configuredSource.channelId !== source.channelId) {
    fail("INVALID_IDENTITY", "Review bundle source and channel do not match.");
  }
  const artifactRevision = value.artifactRevision as number;
  if (
    value.artifactId !==
    channelPreanalysisReviewBundleArtifactId(source.videoId, artifactRevision)
  ) {
    fail("INVALID_IDENTITY", "Review bundle artifact identity is not canonical.");
  }
  if (
    !Number.isSafeInteger(value.sourceDurationMs) ||
    (value.sourceDurationMs as number) <= 0 ||
    (value.sourceDurationMs as number) > MAX_BROADCAST_CONTEXT_SOURCE_DURATION_MS
  ) {
    fail("INVALID_IDENTITY", "Review bundle source duration is invalid.");
  }
  if (!isDigest(value.transcriptDigest) || !isDigest(value.broadcastContextDigest)) {
    fail("INVALID_DIGEST", "Review bundle transcript or context digest is invalid.");
  }

  const sourceDurationMs = value.sourceDurationMs as number;
  const broadcastContext = validateContext(value.broadcastContext, sourceDurationMs);
  let visualCoverage: ChannelPreanalysisVisualCoverageReceipt;
  try {
    visualCoverage = validateChannelPreanalysisVisualCoverageReceipt(
      value.visualCoverage,
      { sourceDurationMs, videoId: source.videoId },
    );
  } catch {
    fail(
      "INVALID_VISUAL_COVERAGE",
      "Review bundle visual coverage receipt is incomplete.",
    );
  }
  const participantGrounding = validateGrounding(
    value.participantGrounding,
    sourceDurationMs,
  );
  if (
    !isRecord(value.participantGroundingProvenance) ||
    !hasExactKeys(value.participantGroundingProvenance, [
      "schemaVersion",
      "checkpointDigest",
      "generatedAt",
      "pipelineRevision",
    ]) ||
    value.participantGroundingProvenance.schemaVersion !==
      CHANNEL_PREANALYSIS_PARTICIPANT_PROVENANCE_SCHEMA_VERSION ||
    !isDigest(value.participantGroundingProvenance.checkpointDigest) ||
    typeof value.participantGroundingProvenance.generatedAt !== "string" ||
    !ISO_DATE_PATTERN.test(value.participantGroundingProvenance.generatedAt) ||
    !isBoundedText(value.participantGroundingProvenance.pipelineRevision, 128) ||
    !SAFE_REVISION_PATTERN.test(value.participantGroundingProvenance.pipelineRevision)
  ) {
    fail("INVALID_GROUNDING", "Participant grounding provenance is invalid.");
  }
  if (!Array.isArray(value.candidates) || value.candidates.length > CANDIDATE_PASS_B_MAX_CANDIDATES) {
    fail("INVALID_CANDIDATE", "Review bundle candidate count is invalid.");
  }
  const candidateInput = {
    source: source as unknown as ChannelPreanalysisReviewSourceIdentity,
    sourceDurationMs,
    artifactRevision,
  };
  const candidates = value.candidates.map((candidate) =>
    validateCandidate(candidate, candidateInput),
  );
  const candidateIds = candidates.map(({ candidateId }) => candidateId);
  if (new Set(candidateIds).size !== candidateIds.length) {
    fail("INVALID_CANDIDATE", "Review bundle candidate IDs must be unique.");
  }

  if (
    !isRecord(value.certificate) ||
    !hasExactKeys(value.certificate, [
      "schemaVersion",
      "pipelineRevision",
      "outcome",
      "sourceIdentityDigest",
      "transcriptDigest",
      "broadcastContextDigest",
      "participantGroundingDigest",
      "visualCoverageDigest",
      "candidateSetDigest",
      "finalCandidateIds",
    ]) ||
    value.certificate.schemaVersion !== CHANNEL_PREANALYSIS_REVIEW_CERTIFICATE_SCHEMA_VERSION ||
    !isBoundedText(value.certificate.pipelineRevision, 128) ||
    !SAFE_REVISION_PATTERN.test(value.certificate.pipelineRevision) ||
    !isDigest(value.certificate.sourceIdentityDigest) ||
    !isDigest(value.certificate.transcriptDigest) ||
    !isDigest(value.certificate.broadcastContextDigest) ||
    !isDigest(value.certificate.participantGroundingDigest) ||
    !isDigest(value.certificate.visualCoverageDigest) ||
    !isDigest(value.certificate.candidateSetDigest) ||
    !Array.isArray(value.certificate.finalCandidateIds) ||
    value.certificate.finalCandidateIds.some((id) => typeof id !== "string") ||
    !["review-ready", "verified-empty"].includes(String(value.certificate.outcome)) ||
    value.certificate.transcriptDigest !== value.transcriptDigest ||
    value.certificate.broadcastContextDigest !== value.broadcastContextDigest ||
    value.certificate.participantGroundingDigest !==
      value.participantGroundingProvenance.checkpointDigest ||
    value.certificate.pipelineRevision !==
      value.participantGroundingProvenance.pipelineRevision ||
    JSON.stringify(value.certificate.finalCandidateIds) !== JSON.stringify(candidateIds) ||
    (value.certificate.outcome === "review-ready" && candidateIds.length === 0) ||
    (value.certificate.outcome === "verified-empty" && candidateIds.length !== 0)
  ) {
    fail("INVALID_CERTIFICATE", "Review certificate does not close over the exact candidate set.");
  }

  return {
    schemaVersion: CHANNEL_PREANALYSIS_REVIEW_BUNDLE_SCHEMA_VERSION,
    artifactId: value.artifactId,
    artifactRevision,
    createdAt: value.createdAt,
    source: candidateInput.source,
    sourceDurationMs,
    transcriptDigest: value.transcriptDigest,
    broadcastContext,
    broadcastContextDigest: value.broadcastContextDigest,
    visualCoverage,
    participantGrounding,
    participantGroundingProvenance:
      value.participantGroundingProvenance as unknown as ChannelPreanalysisParticipantGroundingProvenance,
    candidates,
    certificate:
      value.certificate as unknown as ChannelPreanalysisReviewPipelineCertificate,
  };
}

export function parseChannelPreanalysisReviewBundle(
  input: string,
): ChannelPreanalysisReviewBundle {
  if (typeof input !== "string") fail("INVALID_JSON", "Review bundle must be JSON text.");
  if (new TextEncoder().encode(input).byteLength > CHANNEL_PREANALYSIS_REVIEW_BUNDLE_MAX_BYTES) {
    fail("TOO_LARGE", "Review bundle exceeds its byte limit.");
  }
  try {
    return validateChannelPreanalysisReviewBundle(JSON.parse(input) as unknown);
  } catch (error) {
    if (error instanceof ChannelPreanalysisReviewBundleError) throw error;
    fail("INVALID_JSON", "Review bundle JSON is invalid.");
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

async function sha256(
  value: string | Uint8Array<ArrayBuffer>,
  adapter: ContentDigestAdapter,
): Promise<ChannelPreanalysisSha256Digest> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = new Uint8Array(await adapter.digest("SHA-256", bytes));
  return `sha256:${Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export interface ChannelPreanalysisReviewContentDigests {
  readonly sourceIdentityDigest: ChannelPreanalysisSha256Digest;
  readonly broadcastContextDigest: ChannelPreanalysisSha256Digest;
  readonly participantGroundingDigest: ChannelPreanalysisSha256Digest;
  readonly visualCoverageDigest: ChannelPreanalysisSha256Digest;
  readonly candidateSetDigest: ChannelPreanalysisSha256Digest;
}

/** Shared producer/consumer digest algorithm for one source-neutral review snapshot. */
export async function createChannelPreanalysisReviewContentDigests(
  bundle: Pick<
    ChannelPreanalysisReviewBundle,
    "source" | "broadcastContext" | "participantGrounding" | "candidates"
  > & { readonly visualCoverage?: ChannelPreanalysisVisualCoverageReceipt },
  adapter: ContentDigestAdapter | null = globalThis.crypto?.subtle ?? null,
): Promise<ChannelPreanalysisReviewContentDigests> {
  if (adapter === null) fail("CRYPTO_UNAVAILABLE", "SHA-256 is unavailable.");
  const [
    sourceIdentityDigest,
    broadcastContextDigest,
    participantGroundingDigest,
    visualCoverageDigest,
    candidateSetDigest,
  ] = await Promise.all([
    sha256(stableJson(["exclipper.preanalysis-review.source.v1", bundle.source]), adapter),
    sha256(
      stableJson(["exclipper.preanalysis-review.context.v1", bundle.broadcastContext]),
      adapter,
    ),
    sha256(
      stableJson([
        "exclipper.preanalysis-review.participant-grounding.v1",
        bundle.participantGrounding,
      ]),
      adapter,
    ),
    sha256(
      stableJson([
        "exclipper.preanalysis-review.visual-coverage.v1",
        bundle.visualCoverage ?? null,
      ]),
      adapter,
    ),
    sha256(
      stableJson(["exclipper.preanalysis-review.candidates.v1", bundle.candidates]),
      adapter,
    ),
  ]);
  return {
    sourceIdentityDigest,
    broadcastContextDigest,
    participantGroundingDigest,
    visualCoverageDigest,
    candidateSetDigest,
  };
}

/**
 * Reopens every semantic certificate digest and every embedded JPEG digest.
 * Transcript bytes are intentionally absent, so their digest is only fenced
 * by the parser's top-level/certificate equality check.
 */
export async function verifyChannelPreanalysisReviewBundleIntegrity(
  bundle: ChannelPreanalysisReviewBundle,
  adapter: ContentDigestAdapter | null = globalThis.crypto?.subtle ?? null,
): Promise<void> {
  if (adapter === null) fail("CRYPTO_UNAVAILABLE", "SHA-256 is unavailable.");
  const digests = await createChannelPreanalysisReviewContentDigests(bundle, adapter);
  if (
    digests.sourceIdentityDigest !== bundle.certificate.sourceIdentityDigest ||
    digests.broadcastContextDigest !== bundle.broadcastContextDigest ||
    digests.broadcastContextDigest !== bundle.certificate.broadcastContextDigest ||
    digests.participantGroundingDigest !==
      bundle.participantGroundingProvenance.checkpointDigest ||
    digests.participantGroundingDigest !==
      bundle.certificate.participantGroundingDigest ||
    digests.visualCoverageDigest !== bundle.certificate.visualCoverageDigest ||
    digests.candidateSetDigest !== bundle.certificate.candidateSetDigest
  ) {
    fail("DIGEST_MISMATCH", "Review certificate content digest does not match its payload.");
  }
  for (const candidate of bundle.candidates) {
    for (const frame of candidate.frames) {
      if (await sha256(decodeBase64(frame.dataBase64), adapter) !== frame.contentDigest) {
        fail("DIGEST_MISMATCH", `Candidate ${candidate.candidateId} JPEG digest differs.`);
      }
    }
  }
}
