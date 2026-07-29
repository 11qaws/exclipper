import type { SelectableCandidate } from "./contextAwareCandidateSelection";
import {
  CANDIDATE_PASS_B_CONTEXT_SCHEMA_VERSION,
  CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
  CANDIDATE_PASS_B_VERIFICATION_RECEIPT_SCHEMA_VERSION,
  MAX_CANDIDATE_PASS_B_CONTEXT_TEXT_LENGTH,
  MAX_CANDIDATE_PASS_B_SOURCE_DURATION_MS,
  MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS,
  MAX_CANDIDATE_PASS_B_VIDEO_FRAMES,
  isCompatibleCandidatePassBRoutingModelRevision,
  type CandidatePassBContextPacket,
  type CandidatePassBCurrentVerificationReceipt,
  type CandidatePassBInsight,
  type CandidatePassBVerificationReceipt,
  type CandidatePassBVerificationSourceFence,
} from "./candidatePassBWorkerProtocol";
import { canonicalizeCandidatePassBContextPacket } from "./candidatePassBContextBudget";
import {
  isCandidatePassBCastRosterId,
  type CandidatePassBCastRosterId,
} from "./participantRoster";
import {
  isAnalysisLanguage,
  type AnalysisLanguage,
} from "../domain/analysisLanguage";

export interface CandidateFinalVerificationInput<
  TCandidate extends SelectableCandidate = SelectableCandidate,
> {
  readonly candidates: readonly TCandidate[];
  /**
   * Candidate IDs deliberately rejected by the whole-broadcast judgement.
   *
   * They remain in the canonical reservoir, but are not missing-context
   * failures. Editor-approved overrides must not be included in this set.
   */
  readonly contextExcludedCandidateIds?: ReadonlySet<string>;
  readonly contextByCandidateId: Readonly<Record<string, CandidatePassBContextPacket>>;
  readonly insightByCandidateId: Readonly<Record<string, CandidatePassBInsight>>;
  readonly receiptByCandidateId: Readonly<
    Record<string, CandidatePassBVerificationReceipt>
  >;
  /**
   * IDs whose persisted evidence, model identity, representative thumbnail and
   * receipt all survived a store readback. This fence is mandatory: in-memory
   * AI results can never be published ahead of durable artifacts.
   */
  readonly completeEvidenceCandidateIds: ReadonlySet<string>;
  /**
   * Active refinement-evidence projection for the sealed broadcast plan.
   * `null` is the exact fence for a plan that selected no refinement leads.
   */
  readonly refinementEvidenceProjectionFingerprint: string | null;
  /** Exact whole-context narration language consumed by this Pass B run. */
  readonly outputLanguage: AnalysisLanguage;
  /** Exact participant-grounding roster consumed by this Pass B run. */
  readonly castRosterId: CandidatePassBCastRosterId | null;
}

export type CandidateFinalVerificationGap =
  | "context-excluded"
  | "context-missing"
  | "detail-result-missing"
  | "verification-receipt-missing"
  | "context-conflict"
  | "detail-not-recommended"
  | "program-material-excluded"
  | "evidence-incomplete";

export interface CandidateFinalVerificationResult<
  TCandidate extends SelectableCandidate = SelectableCandidate,
> {
  readonly candidates: readonly TCandidate[];
  readonly gapByCandidateId: Readonly<Record<string, CandidateFinalVerificationGap>>;
}

function boundedText(value: string): string {
  return Array.from(
    value
      .normalize("NFKC")
      .replace(/[\p{Cc}\p{Cf}]/gu, " ")
      .replace(/\s+/gu, " ")
      .trim(),
  )
    .slice(0, MAX_CANDIDATE_PASS_B_CONTEXT_TEXT_LENGTH)
    .join("")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const CONTEXT_PACKET_KEYS = [
  "schemaVersion",
  "transcriptSource",
  "transcriptKo",
  "beforeContextKo",
  "afterContextKo",
  "broadcastSummaryKo",
  "topicContextKo",
  "fastEvidenceKo",
  "contextDecision",
  "contextCategory",
  "contextVerdictKo",
  "chatReactionKo",
] as const;

export function isCandidatePassBContextPacket(
  value: unknown,
): value is CandidatePassBContextPacket {
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join() !== [...CONTEXT_PACKET_KEYS].sort().join() ||
    value.schemaVersion !== CANDIDATE_PASS_B_CONTEXT_SCHEMA_VERSION ||
    !["youtube-caption", "broadcast-transcript", "semantic-refinement"].includes(
      value.transcriptSource as string,
    ) ||
    !["select", "review"].includes(value.contextDecision as string) ||
    ![
      "reaction",
      "quiet-achievement",
      "setup-and-payoff",
      "running-gag",
      "context-dependent",
      "apology-accountability",
    ].includes(value.contextCategory as string) ||
    !(
      value.chatReactionKo === null ||
      (typeof value.chatReactionKo === "string" &&
        boundedText(value.chatReactionKo).length > 0 &&
        boundedText(value.chatReactionKo) === value.chatReactionKo)
    )
  ) {
    return false;
  }
  return [
    value.transcriptKo,
    value.beforeContextKo,
    value.afterContextKo,
    value.broadcastSummaryKo,
    value.topicContextKo,
    value.fastEvidenceKo,
    value.contextVerdictKo,
  ].every(
    (text) =>
      typeof text === "string" &&
      boundedText(text).length > 0 &&
      boundedText(text) === text,
  );
}

export function createCandidatePassBContextPacket(
  input: Omit<CandidatePassBContextPacket, "schemaVersion">,
): CandidatePassBContextPacket | null {
  const requiredText = {
    transcriptKo: boundedText(input.transcriptKo),
    beforeContextKo: boundedText(input.beforeContextKo),
    afterContextKo: boundedText(input.afterContextKo),
    broadcastSummaryKo: boundedText(input.broadcastSummaryKo),
    topicContextKo: boundedText(input.topicContextKo),
    fastEvidenceKo: boundedText(input.fastEvidenceKo),
    contextVerdictKo: boundedText(input.contextVerdictKo),
  };
  if (Object.values(requiredText).some((value) => value.length === 0)) {
    return null;
  }
  const chatReactionKo =
    input.chatReactionKo === null ? null : boundedText(input.chatReactionKo);
  if (input.chatReactionKo !== null && chatReactionKo?.length === 0) {
    return null;
  }
  return {
    schemaVersion: CANDIDATE_PASS_B_CONTEXT_SCHEMA_VERSION,
    transcriptSource: input.transcriptSource,
    ...requiredText,
    contextDecision: input.contextDecision,
    contextCategory: input.contextCategory,
    chatReactionKo,
  };
}

export function createCandidatePassBVerificationReceipt(
  context: CandidatePassBContextPacket,
  frames: readonly { readonly timestampMs: number }[],
  thumbnailTimestampMs: number,
  sourceFence: CandidatePassBVerificationSourceFence,
): CandidatePassBCurrentVerificationReceipt | null {
  let canonicalContext: CandidatePassBContextPacket;
  try {
    canonicalContext = canonicalizeCandidatePassBContextPacket(context);
  } catch {
    return null;
  }
  if (
    canonicalContext.schemaVersion !== CANDIDATE_PASS_B_CONTEXT_SCHEMA_VERSION ||
    !isCandidatePassBVerificationSourceFence(sourceFence) ||
    sourceFence.routingModelRevision !== CANDIDATE_PASS_B_ROUTING_MODEL_REVISION
  ) {
    return null;
  }
  const sourceDurationMs = sourceFence.sourceEndMs - sourceFence.sourceStartMs;
  if (
    frames.length !== MAX_CANDIDATE_PASS_B_VIDEO_FRAMES ||
    new Set(frames.map(({ timestampMs }) => timestampMs)).size !==
      MAX_CANDIDATE_PASS_B_VIDEO_FRAMES ||
    frames.some(
      ({ timestampMs }) =>
        !Number.isSafeInteger(timestampMs) ||
        timestampMs < 0 ||
        timestampMs >= sourceDurationMs,
    ) ||
    !Number.isSafeInteger(thumbnailTimestampMs) ||
    !frames.some(({ timestampMs }) => timestampMs === thumbnailTimestampMs)
  ) {
    return null;
  }
  return {
    schemaVersion: CANDIDATE_PASS_B_VERIFICATION_RECEIPT_SCHEMA_VERSION,
    contextSchemaVersion: canonicalContext.schemaVersion,
    transcriptSource: canonicalContext.transcriptSource,
    contextFingerprint: candidatePassBContextFingerprint(canonicalContext),
    ...sourceFence,
    audioReviewed: true,
    videoFrameCount: MAX_CANDIDATE_PASS_B_VIDEO_FRAMES,
    thumbnailPrepared: true,
    thumbnailTimestampMs,
    referenceTranscriptReviewed: true,
    broadcastContextReviewed: true,
  };
}

function hasValidCandidatePassBVerificationSourceRange(
  value: Record<string, unknown>,
): boolean {
  return (
    typeof value.candidateId === "string" &&
    value.candidateId.length > 0 &&
    value.candidateId.length <= 256 &&
    value.candidateId === value.candidateId.trim() &&
    !/[\p{Cc}\p{Cf}]/u.test(value.candidateId) &&
    Number.isSafeInteger(value.sourceStartMs) &&
    (value.sourceStartMs as number) >= 0 &&
    Number.isSafeInteger(value.sourceEndMs) &&
    (value.sourceEndMs as number) > (value.sourceStartMs as number) &&
    (value.sourceEndMs as number) <= MAX_CANDIDATE_PASS_B_SOURCE_DURATION_MS &&
    (value.sourceEndMs as number) - (value.sourceStartMs as number) <=
      MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS &&
    isCompatibleCandidatePassBRoutingModelRevision(value.routingModelRevision)
  );
}

function hasValidRefinementEvidenceProjectionFingerprint(
  value: unknown,
): boolean {
  return (
    value === null ||
    (typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value))
  );
}

export function isCandidatePassBVerificationSourceFence(
  value: unknown,
): value is CandidatePassBVerificationSourceFence {
  if (!isRecord(value)) return false;
  return (
    Object.keys(value).sort().join() ===
      [
        "candidateId",
        "sourceStartMs",
        "sourceEndMs",
        "routingModelRevision",
        "refinementEvidenceProjectionFingerprint",
        "outputLanguage",
        "castRosterId",
      ]
        .sort()
        .join() &&
    hasValidCandidatePassBVerificationSourceRange(value) &&
    hasValidRefinementEvidenceProjectionFingerprint(
      value.refinementEvidenceProjectionFingerprint,
    ) &&
    isAnalysisLanguage(value.outputLanguage) &&
    (value.castRosterId === null ||
      isCandidatePassBCastRosterId(value.castRosterId))
  );
}

function isCandidatePassBV12VerificationSourceFence(
  value: unknown,
): value is Omit<
  CandidatePassBVerificationSourceFence,
  | "refinementEvidenceProjectionFingerprint"
  | "outputLanguage"
  | "castRosterId"
> {
  if (!isRecord(value)) return false;
  return (
    Object.keys(value).sort().join() ===
      [
        "candidateId",
        "sourceStartMs",
        "sourceEndMs",
        "routingModelRevision",
      ]
        .sort()
        .join() &&
    hasValidCandidatePassBVerificationSourceRange(value)
  );
}

function isCandidatePassBV13VerificationSourceFence(
  value: unknown,
): value is Omit<
  CandidatePassBVerificationSourceFence,
  "outputLanguage" | "castRosterId"
> {
  if (!isRecord(value)) return false;
  return (
    Object.keys(value).sort().join() ===
      [
        "candidateId",
        "sourceStartMs",
        "sourceEndMs",
        "routingModelRevision",
        "refinementEvidenceProjectionFingerprint",
      ]
        .sort()
        .join() &&
    hasValidCandidatePassBVerificationSourceRange(value) &&
    hasValidRefinementEvidenceProjectionFingerprint(
      value.refinementEvidenceProjectionFingerprint,
    )
  );
}

export function isCandidatePassBVerificationReceipt(
  value: unknown,
): value is CandidatePassBVerificationReceipt {
  if (!isRecord(value)) return false;
  const isV1 = value.schemaVersion === "1.0.0";
  const isV11 = value.schemaVersion === "1.1.0";
  const isV12 = value.schemaVersion === "1.2.0";
  const isV13 = value.schemaVersion === "1.3.0";
  const isCurrent =
    value.schemaVersion === CANDIDATE_PASS_B_VERIFICATION_RECEIPT_SCHEMA_VERSION;
  const expectedKeys = [
    "schemaVersion",
    "contextSchemaVersion",
    "transcriptSource",
    ...(isV1 ? [] : ["contextFingerprint"]),
    ...(isV12 || isV13 || isCurrent
      ? [
          "candidateId",
          "sourceStartMs",
          "sourceEndMs",
          "routingModelRevision",
        ]
      : []),
    ...(isV13 || isCurrent
      ? ["refinementEvidenceProjectionFingerprint"]
      : []),
    ...(isCurrent ? ["outputLanguage", "castRosterId"] : []),
    "audioReviewed",
    "videoFrameCount",
    "thumbnailPrepared",
    "thumbnailTimestampMs",
    "referenceTranscriptReviewed",
    "broadcastContextReviewed",
  ];
  return (
    Object.keys(value).sort().join() === expectedKeys.sort().join() &&
    (isV1 || isV11 || isV12 || isV13 || isCurrent) &&
    value.contextSchemaVersion === CANDIDATE_PASS_B_CONTEXT_SCHEMA_VERSION &&
    ["youtube-caption", "broadcast-transcript", "semantic-refinement"].includes(
      value.transcriptSource as string,
    ) &&
    value.audioReviewed === true &&
    (isV1 ||
      (typeof value.contextFingerprint === "string" &&
        /^fnv1a64:[0-9a-f]{16}$/u.test(value.contextFingerprint))) &&
    (!isV12 ||
      isCandidatePassBV12VerificationSourceFence({
        candidateId: value.candidateId,
        sourceStartMs: value.sourceStartMs,
        sourceEndMs: value.sourceEndMs,
        routingModelRevision: value.routingModelRevision,
      })) &&
    (!isV13 ||
      isCandidatePassBV13VerificationSourceFence({
        candidateId: value.candidateId,
        sourceStartMs: value.sourceStartMs,
        sourceEndMs: value.sourceEndMs,
        routingModelRevision: value.routingModelRevision,
        refinementEvidenceProjectionFingerprint:
          value.refinementEvidenceProjectionFingerprint,
      })) &&
    (!isCurrent ||
      isCandidatePassBVerificationSourceFence({
        candidateId: value.candidateId,
        sourceStartMs: value.sourceStartMs,
        sourceEndMs: value.sourceEndMs,
        routingModelRevision: value.routingModelRevision,
        refinementEvidenceProjectionFingerprint:
          value.refinementEvidenceProjectionFingerprint,
        outputLanguage: value.outputLanguage,
        castRosterId: value.castRosterId,
      })) &&
    value.videoFrameCount === MAX_CANDIDATE_PASS_B_VIDEO_FRAMES &&
    value.thumbnailPrepared === true &&
    Number.isSafeInteger(value.thumbnailTimestampMs) &&
    (value.thumbnailTimestampMs as number) >= 0 &&
    value.referenceTranscriptReviewed === true &&
    value.broadcastContextReviewed === true
  );
}

/**
 * A compact deterministic fence for the exact whole-broadcast context handed
 * to Pass B. This is an integrity/version key, not a security primitive.
 */
export function candidatePassBContextFingerprint(
  context: CandidatePassBContextPacket,
): string {
  const canonicalContext = canonicalizeCandidatePassBContextPacket(context);
  const serialized = JSON.stringify([
    canonicalContext.schemaVersion,
    canonicalContext.transcriptSource,
    canonicalContext.transcriptKo,
    canonicalContext.beforeContextKo,
    canonicalContext.afterContextKo,
    canonicalContext.broadcastSummaryKo,
    canonicalContext.topicContextKo,
    canonicalContext.fastEvidenceKo,
    canonicalContext.contextDecision,
    canonicalContext.contextCategory,
    canonicalContext.contextVerdictKo,
    canonicalContext.chatReactionKo,
  ]);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= BigInt(serialized.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

export function candidatePassBReceiptMatchesContext(
  receipt: CandidatePassBVerificationReceipt,
  context: CandidatePassBContextPacket,
  sourceFence: CandidatePassBVerificationSourceFence,
): boolean {
  try {
    const canonicalContext = canonicalizeCandidatePassBContextPacket(context);
    return (
      isCandidatePassBVerificationReceipt(receipt) &&
      isCandidatePassBVerificationSourceFence(sourceFence) &&
      receipt.schemaVersion ===
        CANDIDATE_PASS_B_VERIFICATION_RECEIPT_SCHEMA_VERSION &&
      receipt.contextSchemaVersion === canonicalContext.schemaVersion &&
      receipt.transcriptSource === canonicalContext.transcriptSource &&
      receipt.contextFingerprint ===
        candidatePassBContextFingerprint(canonicalContext) &&
      receipt.candidateId === sourceFence.candidateId &&
      receipt.sourceStartMs === sourceFence.sourceStartMs &&
      receipt.sourceEndMs === sourceFence.sourceEndMs &&
      receipt.routingModelRevision === sourceFence.routingModelRevision &&
      receipt.refinementEvidenceProjectionFingerprint ===
        sourceFence.refinementEvidenceProjectionFingerprint &&
      receipt.outputLanguage === sourceFence.outputLanguage &&
      receipt.castRosterId === sourceFence.castRosterId &&
      receipt.routingModelRevision === CANDIDATE_PASS_B_ROUTING_MODEL_REVISION
    );
  } catch {
    return false;
  }
}

/**
 * The only projection allowed to call a reservoir item a final candidate.
 * Discovery score, editor approval and old paid results cannot bypass this gate.
 */
export function finalizeFullyVerifiedCandidates<
  TCandidate extends SelectableCandidate,
>(
  input: CandidateFinalVerificationInput<TCandidate>,
): CandidateFinalVerificationResult<TCandidate> {
  const candidates: TCandidate[] = [];
  const gapByCandidateId: Record<string, CandidateFinalVerificationGap> = {};

  for (const candidate of input.candidates) {
    if (input.contextExcludedCandidateIds?.has(candidate.id) === true) {
      gapByCandidateId[candidate.id] = "context-excluded";
      continue;
    }
    const context = input.contextByCandidateId[candidate.id];
    if (context === undefined) {
      gapByCandidateId[candidate.id] = "context-missing";
      continue;
    }
    const insight = input.insightByCandidateId[candidate.id];
    if (insight === undefined) {
      gapByCandidateId[candidate.id] = "detail-result-missing";
      continue;
    }
    const receipt = input.receiptByCandidateId[candidate.id];
    if (receipt === undefined) {
      gapByCandidateId[candidate.id] = "verification-receipt-missing";
      continue;
    }
    if (input.completeEvidenceCandidateIds?.has(candidate.id) !== true) {
      gapByCandidateId[candidate.id] = "evidence-incomplete";
      continue;
    }
    if (
      !candidatePassBReceiptMatchesContext(receipt, context, {
        candidateId: candidate.id,
        sourceStartMs: candidate.startMs,
        sourceEndMs: candidate.endMs,
        routingModelRevision: CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
        refinementEvidenceProjectionFingerprint:
          input.refinementEvidenceProjectionFingerprint,
        outputLanguage: input.outputLanguage,
        castRosterId: input.castRosterId,
      }) ||
      receipt.audioReviewed !== true ||
      receipt.videoFrameCount !== MAX_CANDIDATE_PASS_B_VIDEO_FRAMES ||
      receipt.thumbnailPrepared !== true ||
      !Number.isSafeInteger(receipt.thumbnailTimestampMs) ||
      receipt.referenceTranscriptReviewed !== true ||
      receipt.broadcastContextReviewed !== true
    ) {
      gapByCandidateId[candidate.id] = "evidence-incomplete";
      continue;
    }
    if (insight.programMaterial !== "streamer-event") {
      gapByCandidateId[candidate.id] = "program-material-excluded";
      continue;
    }
    if (insight.contextConsistency !== "consistent") {
      gapByCandidateId[candidate.id] = "context-conflict";
      continue;
    }
    if (insight.clipDecision !== "recommend") {
      gapByCandidateId[candidate.id] = "detail-not-recommended";
      continue;
    }
    candidates.push(candidate);
  }

  candidates.sort(
    (left, right) =>
      left.peakMs - right.peakMs || left.id.localeCompare(right.id),
  );
  return { candidates, gapByCandidateId };
}
