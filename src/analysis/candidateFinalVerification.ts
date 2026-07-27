import type { SelectableCandidate } from "./contextAwareCandidateSelection";
import {
  CANDIDATE_PASS_B_CONTEXT_SCHEMA_VERSION,
  MAX_CANDIDATE_PASS_B_CONTEXT_TEXT_LENGTH,
  MAX_CANDIDATE_PASS_B_VIDEO_FRAMES,
  type CandidatePassBContextPacket,
  type CandidatePassBInsight,
  type CandidatePassBVerificationReceipt,
} from "./candidatePassBWorkerProtocol";

export interface CandidateFinalVerificationInput<
  TCandidate extends SelectableCandidate = SelectableCandidate,
> {
  readonly candidates: readonly TCandidate[];
  readonly contextByCandidateId: Readonly<Record<string, CandidatePassBContextPacket>>;
  readonly insightByCandidateId: Readonly<Record<string, CandidatePassBInsight>>;
  readonly receiptByCandidateId: Readonly<
    Record<string, CandidatePassBVerificationReceipt>
  >;
}

export type CandidateFinalVerificationGap =
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
): CandidatePassBVerificationReceipt | null {
  if (
    context.schemaVersion !== CANDIDATE_PASS_B_CONTEXT_SCHEMA_VERSION ||
    frames.length !== MAX_CANDIDATE_PASS_B_VIDEO_FRAMES ||
    new Set(frames.map(({ timestampMs }) => timestampMs)).size !==
      MAX_CANDIDATE_PASS_B_VIDEO_FRAMES ||
    !Number.isSafeInteger(thumbnailTimestampMs) ||
    !frames.some(({ timestampMs }) => timestampMs === thumbnailTimestampMs)
  ) {
    return null;
  }
  return {
    schemaVersion: "1.1.0",
    contextSchemaVersion: context.schemaVersion,
    transcriptSource: context.transcriptSource,
    contextFingerprint: candidatePassBContextFingerprint(context),
    audioReviewed: true,
    videoFrameCount: MAX_CANDIDATE_PASS_B_VIDEO_FRAMES,
    thumbnailPrepared: true,
    thumbnailTimestampMs,
    referenceTranscriptReviewed: true,
    broadcastContextReviewed: true,
  };
}

export function isCandidatePassBVerificationReceipt(
  value: unknown,
): value is CandidatePassBVerificationReceipt {
  if (!isRecord(value)) return false;
  const isLegacy = value.schemaVersion === "1.0.0";
  const expectedKeys = [
    "schemaVersion",
    "contextSchemaVersion",
    "transcriptSource",
    ...(isLegacy ? [] : ["contextFingerprint"]),
    "audioReviewed",
    "videoFrameCount",
    "thumbnailPrepared",
    "thumbnailTimestampMs",
    "referenceTranscriptReviewed",
    "broadcastContextReviewed",
  ];
  return (
    Object.keys(value).sort().join() === expectedKeys.sort().join() &&
    (isLegacy || value.schemaVersion === "1.1.0") &&
    value.contextSchemaVersion === CANDIDATE_PASS_B_CONTEXT_SCHEMA_VERSION &&
    ["youtube-caption", "broadcast-transcript", "semantic-refinement"].includes(
      value.transcriptSource as string,
    ) &&
    value.audioReviewed === true &&
    (isLegacy ||
      (typeof value.contextFingerprint === "string" &&
        /^fnv1a64:[0-9a-f]{16}$/u.test(value.contextFingerprint))) &&
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
  const serialized = JSON.stringify([
    context.schemaVersion,
    context.transcriptSource,
    context.transcriptKo,
    context.beforeContextKo,
    context.afterContextKo,
    context.broadcastSummaryKo,
    context.topicContextKo,
    context.fastEvidenceKo,
    context.contextDecision,
    context.contextCategory,
    context.contextVerdictKo,
    context.chatReactionKo,
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
): boolean {
  return (
    receipt.schemaVersion === "1.1.0" &&
    receipt.contextSchemaVersion === context.schemaVersion &&
    receipt.transcriptSource === context.transcriptSource &&
    receipt.contextFingerprint === candidatePassBContextFingerprint(context)
  );
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
    if (
      !candidatePassBReceiptMatchesContext(receipt, context) ||
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
