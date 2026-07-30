import type { SelectableCandidate } from "./contextAwareCandidateSelection";
import {
  CANDIDATE_PASS_B_AUDIO_GATE_REVISION,
  CANDIDATE_PASS_B_CONTEXT_SCHEMA_VERSION,
  CANDIDATE_PASS_B_DISPATCH_INTENT_SCHEMA_VERSION,
  CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
  CANDIDATE_PASS_B_GEMINI_MODEL_ID,
  CANDIDATE_PASS_B_GEMINI_MODEL_REVISION,
  CANDIDATE_PASS_B_MEDIA_RECEIPT_SCHEMA_VERSION,
  CANDIDATE_PASS_B_QWEN_MODEL_ID,
  CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
  CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
  CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION,
  CANDIDATE_PASS_B_VERIFICATION_RECEIPT_SCHEMA_VERSION,
  MAX_CANDIDATE_PASS_B_CONTEXT_TEXT_LENGTH,
  MAX_CANDIDATE_PASS_B_SOURCE_DURATION_MS,
  MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS,
  MAX_CANDIDATE_PASS_B_VIDEO_FRAMES,
  type CandidatePassBCompletedSettlement,
  type CandidatePassBContextPacket,
  type CandidatePassBCurrentVerificationReceipt,
  type CandidatePassBDispatchIntent,
  type CandidatePassBInsight,
  type CandidatePassBOutcomeUnknown,
  type CandidatePassBOutcomeUnknownSettlement,
  type CandidatePassBTerminalSettlement,
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
   * Whole-context negative hypotheses retained for diagnostics. They do not
   * become terminal exclusions until the exact multimodal insight agrees.
   */
  readonly contextExcludedCandidateIds?: ReadonlySet<string>;
  readonly contextByCandidateId: Readonly<Record<string, CandidatePassBContextPacket>>;
  readonly insightByCandidateId: Readonly<Record<string, CandidatePassBInsight>>;
  readonly receiptByCandidateId: Readonly<
    Record<string, CandidatePassBVerificationReceipt>
  >;
  readonly completeEvidenceCandidateIds: ReadonlySet<string>;
  readonly refinementEvidenceProjectionFingerprint: string | null;
  readonly outputLanguage: AnalysisLanguage;
  readonly castRosterId: CandidatePassBCastRosterId | null;
}

export type CandidateFinalVerificationGap =
  | "context-excluded"
  | "context-missing"
  | "detail-result-missing"
  | "verification-receipt-missing"
  | "context-insufficient"
  | "context-conflict"
  | "detail-uncertain"
  | "program-material-unclear"
  | "detail-verdict-incoherent"
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

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isNonEmptyBoundedString(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

function isSha256Digest(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
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
    !exactKeys(value, CONTEXT_PACKET_KEYS) ||
    value.schemaVersion !== CANDIDATE_PASS_B_CONTEXT_SCHEMA_VERSION ||
    !["youtube-caption", "broadcast-transcript", "semantic-refinement"].includes(
      value.transcriptSource as string,
    ) ||
    !["select", "review", "reject"].includes(
      value.contextDecision as string,
    ) ||
    ![
      "reaction",
      "quiet-achievement",
      "setup-and-payoff",
      "running-gag",
      "context-dependent",
      "apology-accountability",
      "music-or-intermission",
      "not-clip-worthy",
      "uncertain",
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
  if (Object.values(requiredText).some((value) => value.length === 0)) return null;
  const chatReactionKo =
    input.chatReactionKo === null ? null : boundedText(input.chatReactionKo);
  if (
    input.chatReactionKo !== null &&
    (chatReactionKo === null || chatReactionKo.length === 0)
  ) {
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

function validSourceRange(value: Record<string, unknown>): boolean {
  return (
    isNonEmptyBoundedString(value.candidateId, 256) &&
    Number.isSafeInteger(value.sourceStartMs) &&
    (value.sourceStartMs as number) >= 0 &&
    Number.isSafeInteger(value.sourceEndMs) &&
    (value.sourceEndMs as number) > (value.sourceStartMs as number) &&
    (value.sourceEndMs as number) <= MAX_CANDIDATE_PASS_B_SOURCE_DURATION_MS &&
    (value.sourceEndMs as number) - (value.sourceStartMs as number) <=
      MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS
  );
}

export function isCandidatePassBVerificationSourceFence(
  value: unknown,
): value is CandidatePassBVerificationSourceFence {
  return (
    isRecord(value) &&
    exactKeys(value, [
      "candidateId",
      "sourceStartMs",
      "sourceEndMs",
      "routingModelRevision",
      "refinementEvidenceProjectionFingerprint",
      "outputLanguage",
      "castRosterId",
    ]) &&
    validSourceRange(value) &&
    value.routingModelRevision === CANDIDATE_PASS_B_ROUTING_MODEL_REVISION &&
    (value.refinementEvidenceProjectionFingerprint === null ||
      isSha256Digest(value.refinementEvidenceProjectionFingerprint)) &&
    isAnalysisLanguage(value.outputLanguage) &&
    (value.castRosterId === null ||
      isCandidatePassBCastRosterId(value.castRosterId))
  );
}

function isFrameReceipt(value: unknown, durationMs: number): boolean {
  return (
    isRecord(value) &&
    exactKeys(value, [
      "timestampMs",
      "mimeType",
      "byteLength",
      "contentDigest",
      "extractionRevision",
    ]) &&
    Number.isSafeInteger(value.timestampMs) &&
    (value.timestampMs as number) >= 0 &&
    (value.timestampMs as number) < durationMs &&
    value.mimeType === "image/jpeg" &&
    Number.isSafeInteger(value.byteLength) &&
    (value.byteLength as number) > 0 &&
    isSha256Digest(value.contentDigest) &&
    value.extractionRevision === CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION
  );
}

function isAudioReceipt(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const common =
    Number.isSafeInteger(value.wavByteLength) &&
    (value.wavByteLength as number) >= 44 &&
    isSha256Digest(value.wavContentDigest) &&
    value.sampleRateHz === CANDIDATE_PASS_B_SAMPLE_RATE_HZ &&
    Number.isSafeInteger(value.sampleCount) &&
    (value.sampleCount as number) > 0 &&
    value.wavByteLength === 44 + (value.sampleCount as number) * 2;
  if (value.kind === "audible-audio") {
    return (
      exactKeys(value, [
        "kind",
        "wavByteLength",
        "wavContentDigest",
        "sampleRateHz",
        "sampleCount",
      ]) && common
    );
  }
  return (
    value.kind === "verified-no-speech" &&
    exactKeys(value, [
      "kind",
      "wavByteLength",
      "wavContentDigest",
      "sampleRateHz",
      "sampleCount",
      "vadRevision",
      "frameCount",
      "activeFrameCount",
      "activeFrameRatio",
      "audible",
    ]) &&
    common &&
    value.vadRevision === CANDIDATE_PASS_B_AUDIO_GATE_REVISION &&
    Number.isSafeInteger(value.frameCount) &&
    (value.frameCount as number) > 0 &&
    Number.isSafeInteger(value.activeFrameCount) &&
    (value.activeFrameCount as number) >= 0 &&
    (value.activeFrameCount as number) <= (value.frameCount as number) &&
    typeof value.activeFrameRatio === "number" &&
    Number.isFinite(value.activeFrameRatio) &&
    value.activeFrameRatio >= 0 &&
    value.activeFrameRatio <= 1 &&
    value.audible === false
  );
}

export function isCandidatePassBDispatchIntent(
  value: unknown,
): value is CandidatePassBDispatchIntent {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "operationId",
      "analysisRunId",
      "candidateId",
      "sourceFingerprint",
      "sourceStartMs",
      "sourceEndMs",
      "contextFingerprint",
      "outputLanguage",
      "castRosterId",
      "routingModelRevision",
      "attemptOrdinal",
      "retryGrantId",
      "transportMode",
      "mediaReceipt",
    ]) ||
    value.schemaVersion !== CANDIDATE_PASS_B_DISPATCH_INTENT_SCHEMA_VERSION ||
    !isNonEmptyBoundedString(value.operationId, 180) ||
    !/^[A-Za-z0-9._:-]+$/u.test(value.operationId) ||
    !isNonEmptyBoundedString(value.analysisRunId, 180) ||
    !isNonEmptyBoundedString(value.sourceFingerprint, 512) ||
    !validSourceRange(value) ||
    value.routingModelRevision !== CANDIDATE_PASS_B_ROUTING_MODEL_REVISION ||
    !/^fnv1a64:[0-9a-f]{16}$/u.test(String(value.contextFingerprint)) ||
    !isAnalysisLanguage(value.outputLanguage) ||
    (value.castRosterId !== null &&
      !isCandidatePassBCastRosterId(value.castRosterId)) ||
    !Number.isSafeInteger(value.attemptOrdinal) ||
    (value.attemptOrdinal as number) < 0 ||
    ((value.attemptOrdinal === 0 && value.retryGrantId !== null) ||
      (value.attemptOrdinal !== 0 &&
        !isNonEmptyBoundedString(value.retryGrantId, 240))) ||
    (value.transportMode !== "free-r2" &&
      value.transportMode !== "paid-direct") ||
    !isRecord(value.mediaReceipt) ||
    !exactKeys(value.mediaReceipt, [
      "schemaVersion",
      "frameExtractionRevision",
      "frames",
      "audio",
      "providerPayloadDigest",
    ]) ||
    value.mediaReceipt.schemaVersion !==
      CANDIDATE_PASS_B_MEDIA_RECEIPT_SCHEMA_VERSION ||
    value.mediaReceipt.frameExtractionRevision !==
      CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION ||
    !Array.isArray(value.mediaReceipt.frames) ||
    value.mediaReceipt.frames.length !== MAX_CANDIDATE_PASS_B_VIDEO_FRAMES ||
    !isAudioReceipt(value.mediaReceipt.audio) ||
    !isSha256Digest(value.mediaReceipt.providerPayloadDigest)
  ) {
    return false;
  }
  const durationMs =
    (value.sourceEndMs as number) - (value.sourceStartMs as number);
  return (
    value.mediaReceipt.frames.every((frame) =>
      isFrameReceipt(frame, durationMs),
    ) &&
    new Set(
      value.mediaReceipt.frames.map(
        (frame) => (frame as Record<string, unknown>).timestampMs,
      ),
    ).size === MAX_CANDIDATE_PASS_B_VIDEO_FRAMES
  );
}

export function isCandidatePassBCompletedSettlement(
  value: unknown,
): value is CandidatePassBCompletedSettlement {
  return (
    isRecord(value) &&
    exactKeys(value, [
      "schemaVersion",
      "status",
      "operationId",
      "providerPayloadDigest",
      "outputLanguage",
      "castRosterId",
      "responseDigest",
      "providerModelId",
      "providerModelRevision",
    ]) &&
    value.schemaVersion === CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION &&
    value.status === "completed" &&
    isNonEmptyBoundedString(value.operationId, 180) &&
    isSha256Digest(value.providerPayloadDigest) &&
    isAnalysisLanguage(value.outputLanguage) &&
    (value.castRosterId === null ||
      isCandidatePassBCastRosterId(value.castRosterId)) &&
    isSha256Digest(value.responseDigest) &&
    ((value.providerModelId === CANDIDATE_PASS_B_QWEN_MODEL_ID &&
      value.providerModelRevision === CANDIDATE_PASS_B_QWEN_MODEL_REVISION) ||
      (value.providerModelId === CANDIDATE_PASS_B_GEMINI_MODEL_ID &&
        value.providerModelRevision === CANDIDATE_PASS_B_GEMINI_MODEL_REVISION))
  );
}

export function isCandidatePassBOutcomeUnknownSettlement(
  value: unknown,
): value is CandidatePassBOutcomeUnknownSettlement {
  return (
    isRecord(value) &&
    exactKeys(value, [
      "schemaVersion",
      "status",
      "operationId",
      "providerPayloadDigest",
      "outputLanguage",
      "castRosterId",
      "reason",
    ]) &&
    value.schemaVersion === CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION &&
    value.status === "outcome-unknown" &&
    isNonEmptyBoundedString(value.operationId, 180) &&
    isSha256Digest(value.providerPayloadDigest) &&
    isAnalysisLanguage(value.outputLanguage) &&
    (value.castRosterId === null ||
      isCandidatePassBCastRosterId(value.castRosterId)) &&
    [
      "quota-outcome-unknown",
      "armed-dispatch-interrupted",
      "armed-dispatch-recovered",
    ].includes(value.reason as string)
  );
}

export function isCandidatePassBTerminalSettlement(
  value: unknown,
): value is CandidatePassBTerminalSettlement {
  return (
    isCandidatePassBCompletedSettlement(value) ||
    isCandidatePassBOutcomeUnknownSettlement(value)
  );
}

export function isCandidatePassBOutcomeUnknown(
  value: unknown,
): value is CandidatePassBOutcomeUnknown {
  return (
    isRecord(value) &&
    exactKeys(value, [
      "candidateId",
      "sourceStartMs",
      "sourceEndMs",
      "settlement",
    ]) &&
    validSourceRange(value) &&
    isCandidatePassBOutcomeUnknownSettlement(value.settlement)
  );
}

function dispatchMatchesFence(
  dispatch: CandidatePassBDispatchIntent,
  sourceFence: CandidatePassBVerificationSourceFence,
  contextFingerprint: string,
): boolean {
  return (
    dispatch.candidateId === sourceFence.candidateId &&
    dispatch.sourceStartMs === sourceFence.sourceStartMs &&
    dispatch.sourceEndMs === sourceFence.sourceEndMs &&
    dispatch.contextFingerprint === contextFingerprint &&
    dispatch.outputLanguage === sourceFence.outputLanguage &&
    dispatch.castRosterId === sourceFence.castRosterId &&
    dispatch.routingModelRevision === sourceFence.routingModelRevision
  );
}

function settlementMatchesDispatch(
  settlement: CandidatePassBTerminalSettlement,
  dispatch: CandidatePassBDispatchIntent,
): boolean {
  return (
    settlement.operationId === dispatch.operationId &&
    settlement.providerPayloadDigest ===
      dispatch.mediaReceipt.providerPayloadDigest &&
    settlement.outputLanguage === dispatch.outputLanguage &&
    settlement.castRosterId === dispatch.castRosterId
  );
}

export function createCandidatePassBVerificationReceipt(
  context: CandidatePassBContextPacket,
  thumbnailTimestampMs: number,
  sourceFence: CandidatePassBVerificationSourceFence,
  dispatchIntent: CandidatePassBDispatchIntent,
  settlement: CandidatePassBCompletedSettlement,
): CandidatePassBCurrentVerificationReceipt | null {
  let canonicalContext: CandidatePassBContextPacket;
  try {
    canonicalContext = canonicalizeCandidatePassBContextPacket(context);
  } catch {
    return null;
  }
  const contextFingerprint = candidatePassBContextFingerprint(canonicalContext);
  if (
    !isCandidatePassBVerificationSourceFence(sourceFence) ||
    !isCandidatePassBDispatchIntent(dispatchIntent) ||
    !isCandidatePassBCompletedSettlement(settlement) ||
    !dispatchMatchesFence(dispatchIntent, sourceFence, contextFingerprint) ||
    !settlementMatchesDispatch(settlement, dispatchIntent) ||
    !Number.isSafeInteger(thumbnailTimestampMs) ||
    !dispatchIntent.mediaReceipt.frames.some(
      ({ timestampMs }) => timestampMs === thumbnailTimestampMs,
    )
  ) {
    return null;
  }
  return {
    schemaVersion: CANDIDATE_PASS_B_VERIFICATION_RECEIPT_SCHEMA_VERSION,
    contextSchemaVersion: canonicalContext.schemaVersion,
    transcriptSource: canonicalContext.transcriptSource,
    contextFingerprint,
    ...sourceFence,
    dispatchIntent,
    settlement,
    thumbnailTimestampMs,
  };
}

export function isCandidatePassBVerificationReceipt(
  value: unknown,
): value is CandidatePassBVerificationReceipt {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "contextSchemaVersion",
      "transcriptSource",
      "contextFingerprint",
      "candidateId",
      "sourceStartMs",
      "sourceEndMs",
      "routingModelRevision",
      "refinementEvidenceProjectionFingerprint",
      "outputLanguage",
      "castRosterId",
      "dispatchIntent",
      "settlement",
      "thumbnailTimestampMs",
    ]) ||
    value.schemaVersion !== CANDIDATE_PASS_B_VERIFICATION_RECEIPT_SCHEMA_VERSION ||
    value.contextSchemaVersion !== CANDIDATE_PASS_B_CONTEXT_SCHEMA_VERSION ||
    !["youtube-caption", "broadcast-transcript", "semantic-refinement"].includes(
      value.transcriptSource as string,
    ) ||
    !/^fnv1a64:[0-9a-f]{16}$/u.test(String(value.contextFingerprint)) ||
    !isCandidatePassBVerificationSourceFence({
      candidateId: value.candidateId,
      sourceStartMs: value.sourceStartMs,
      sourceEndMs: value.sourceEndMs,
      routingModelRevision: value.routingModelRevision,
      refinementEvidenceProjectionFingerprint:
        value.refinementEvidenceProjectionFingerprint,
      outputLanguage: value.outputLanguage,
      castRosterId: value.castRosterId,
    }) ||
    !isCandidatePassBDispatchIntent(value.dispatchIntent) ||
    !isCandidatePassBCompletedSettlement(value.settlement) ||
    !Number.isSafeInteger(value.thumbnailTimestampMs)
  ) {
    return false;
  }
  const sourceFence = {
    candidateId: value.candidateId,
    sourceStartMs: value.sourceStartMs,
    sourceEndMs: value.sourceEndMs,
    routingModelRevision: value.routingModelRevision,
    refinementEvidenceProjectionFingerprint:
      value.refinementEvidenceProjectionFingerprint,
    outputLanguage: value.outputLanguage,
    castRosterId: value.castRosterId,
  } as CandidatePassBVerificationSourceFence;
  return (
    dispatchMatchesFence(
      value.dispatchIntent,
      sourceFence,
      value.contextFingerprint as string,
    ) &&
    settlementMatchesDispatch(value.settlement, value.dispatchIntent) &&
    value.dispatchIntent.mediaReceipt.frames.some(
      ({ timestampMs }) => timestampMs === value.thumbnailTimestampMs,
    )
  );
}

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
    const contextFingerprint = candidatePassBContextFingerprint(context);
    return (
      isCandidatePassBVerificationReceipt(receipt) &&
      isCandidatePassBVerificationSourceFence(sourceFence) &&
      receipt.contextSchemaVersion === context.schemaVersion &&
      receipt.transcriptSource === context.transcriptSource &&
      receipt.contextFingerprint === contextFingerprint &&
      receipt.candidateId === sourceFence.candidateId &&
      receipt.sourceStartMs === sourceFence.sourceStartMs &&
      receipt.sourceEndMs === sourceFence.sourceEndMs &&
      receipt.routingModelRevision === sourceFence.routingModelRevision &&
      receipt.refinementEvidenceProjectionFingerprint ===
        sourceFence.refinementEvidenceProjectionFingerprint &&
      receipt.outputLanguage === sourceFence.outputLanguage &&
      receipt.castRosterId === sourceFence.castRosterId &&
      dispatchMatchesFence(receipt.dispatchIntent, sourceFence, contextFingerprint) &&
      settlementMatchesDispatch(receipt.settlement, receipt.dispatchIntent)
    );
  } catch {
    return false;
  }
}

/**
 * Separates a completed negative editorial judgement from an AI abstention.
 *
 * The provider schema deliberately permits `uncertain`, `insufficient`, and
 * `routine-or-unclear`. Those values cannot prove that a candidate is bad, so
 * they remain pipeline gaps. Cross-field combinations that contradict the
 * prompt contract also remain gaps instead of being laundered into an empty
 * successful result.
 */
function candidateVerdictGap(
  insight: CandidatePassBInsight,
): CandidateFinalVerificationGap | null {
  if (insight.contextConsistency === "insufficient") {
    return "context-insufficient";
  }

  if (insight.clipDecision === "uncertain") {
    if (insight.programMaterial === "routine-or-unclear") {
      return "program-material-unclear";
    }
    return insight.programMaterial === "streamer-event" &&
      insight.contextConsistency === "consistent"
      ? "detail-uncertain"
      : "detail-verdict-incoherent";
  }

  if (insight.clipDecision === "recommend") {
    return insight.programMaterial === "streamer-event" &&
      insight.contextConsistency === "consistent"
      ? null
      : "detail-verdict-incoherent";
  }

  if (
    insight.programMaterial === "music-or-intermission" ||
    insight.programMaterial === "routine-or-unclear"
  ) {
    return "program-material-excluded";
  }
  if (insight.contextConsistency === "conflict") {
    return "context-conflict";
  }
  return insight.programMaterial === "streamer-event" &&
    insight.contextConsistency === "consistent"
    ? "detail-not-recommended"
    : "detail-verdict-incoherent";
}

export function finalizeFullyVerifiedCandidates<
  TCandidate extends SelectableCandidate,
>(
  input: CandidateFinalVerificationInput<TCandidate>,
): CandidateFinalVerificationResult<TCandidate> {
  const candidates: TCandidate[] = [];
  const gapByCandidateId: Record<string, CandidateFinalVerificationGap> = {};
  for (const candidate of input.candidates) {
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
    const sourceFence: CandidatePassBVerificationSourceFence = {
      candidateId: candidate.id,
      sourceStartMs: candidate.startMs,
      sourceEndMs: candidate.endMs,
      routingModelRevision: CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
      refinementEvidenceProjectionFingerprint:
        input.refinementEvidenceProjectionFingerprint,
      outputLanguage: input.outputLanguage,
      castRosterId: input.castRosterId,
    };
    if (
      !input.completeEvidenceCandidateIds.has(candidate.id) ||
      !candidatePassBReceiptMatchesContext(receipt, context, sourceFence)
    ) {
      gapByCandidateId[candidate.id] = "evidence-incomplete";
      continue;
    }
    const verdictGap = candidateVerdictGap(insight);
    if (verdictGap !== null) {
      gapByCandidateId[candidate.id] = verdictGap;
      continue;
    }
    /*
     * A whole-context rejection is a hypothesis carried inside `context`.
     * Reaching this point proves that the candidate's exact audio and four
     * frames were checked against it and produced a coherent,
     * context-consistent streamer-event recommendation. Text-only context may
     * prioritize work, but it cannot bypass or overrule that later receipt.
     */
    candidates.push(candidate);
  }
  candidates.sort(
    (left, right) =>
      left.peakMs - right.peakMs || left.id.localeCompare(right.id),
  );
  return { candidates, gapByCandidateId };
}
