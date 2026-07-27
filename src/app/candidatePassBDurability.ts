import {
  candidatePassBReceiptMatchesContext,
} from "../analysis/candidateFinalVerification";
import type {
  CandidatePassBContextPacket,
  CandidatePassBVerificationReceipt,
} from "../analysis/candidatePassBWorkerProtocol";
import type {
  CandidatePassBInsightsRecord,
  StoredCandidatePassBInsight,
} from "../storage/candidatePassBInsightStore";

const PARTICIPANT_PRESENCE_VALUES = new Set([
  "identified",
  "present-unidentified",
  "none-present",
  "insufficient-evidence",
] satisfies readonly NonNullable<
  StoredCandidatePassBInsight["participantPresence"]
>[]);
const CLIP_DECISION_VALUES = new Set([
  "recommend",
  "reject",
  "uncertain",
] satisfies readonly NonNullable<StoredCandidatePassBInsight["clipDecision"]>[]);
const CONTEXT_CONSISTENCY_VALUES = new Set([
  "consistent",
  "conflict",
  "insufficient",
] satisfies readonly NonNullable<
  StoredCandidatePassBInsight["contextConsistency"]
>[]);
const PROGRAM_MATERIAL_VALUES = new Set([
  "streamer-event",
  "music-or-intermission",
  "routine-or-unclear",
] satisfies readonly NonNullable<StoredCandidatePassBInsight["programMaterial"]>[]);

function nonEmpty(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

/**
 * Storage schemas remain backward-readable, but an old or partial insight is
 * not proof that the current multimodal review completed. Publication requires
 * every explanatory and verdict field emitted by the current provider schema.
 */
export function candidatePassBInsightIsComplete(
  insight: StoredCandidatePassBInsight | undefined,
): boolean {
  if (
    insight === undefined ||
    !nonEmpty(insight.eventSummaryKo) ||
    !nonEmpty(insight.reactionSummaryKo) ||
    !nonEmpty(insight.whyGoodClipKo) ||
    !PARTICIPANT_PRESENCE_VALUES.has(insight.participantPresence!) ||
    !nonEmpty(insight.participantSummaryKo) ||
    !Array.isArray(insight.identifiedParticipants) ||
    !CLIP_DECISION_VALUES.has(insight.clipDecision!) ||
    !CONTEXT_CONSISTENCY_VALUES.has(insight.contextConsistency!) ||
    !PROGRAM_MATERIAL_VALUES.has(insight.programMaterial!)
  ) {
    return false;
  }
  if (
    insight.participantPresence === "identified" &&
    insight.identifiedParticipants.length === 0
  ) {
    return false;
  }
  if (
    insight.participantPresence === "none-present" &&
    insight.identifiedParticipants.length > 0
  ) {
    return false;
  }
  return true;
}

/**
 * A candidate is durable only when every artifact needed to explain and
 * reproduce the final judgement survived a store readback.
 *
 * The receipt proves that the model saw audio, four frames and the exact
 * context packet. The thumbnail timestamp is checked separately so a receipt
 * cannot outlive the image it claims was prepared.
 */
export function candidatePassBArtifactIsDurable(
  record: CandidatePassBInsightsRecord | null,
  candidateId: string,
  context: CandidatePassBContextPacket | undefined,
): boolean {
  if (record === null || context === undefined) return false;
  const evidence = record.evidenceById[candidateId];
  const insight = record.insightById[candidateId];
  const model = record.modelByCandidateId?.[candidateId];
  const thumbnail = record.thumbnailById?.[candidateId];
  const receipt = record.verificationReceiptById?.[candidateId];
  return (
    evidence?.candidateId === candidateId &&
    candidatePassBInsightIsComplete(insight) &&
    model !== undefined &&
    thumbnail !== undefined &&
    receipt !== undefined &&
    candidatePassBReceiptMatchesContext(receipt, context) &&
    receipt.audioReviewed === true &&
    receipt.videoFrameCount === 4 &&
    receipt.thumbnailPrepared === true &&
    receipt.thumbnailTimestampMs === thumbnail.timestampMs &&
    receipt.referenceTranscriptReviewed === true &&
    receipt.broadcastContextReviewed === true
  );
}

/**
 * Selects candidates that must run the multimodal provider again.
 *
 * Merely having an insight object is not completion: older or schema-drifted
 * provider output may omit the verdict fields required for publication. Such
 * an object must remain an analysis retry, not be mistaken for a persistence
 * retry or a completed empty result.
 */
export function selectCandidatePassBAnalysisOutstandingIds(input: {
  readonly candidateIds: readonly string[];
  readonly insightByCandidateId: Readonly<
    Record<string, StoredCandidatePassBInsight>
  >;
  readonly receiptByCandidateId: Readonly<
    Record<string, CandidatePassBVerificationReceipt>
  >;
  readonly contextByCandidateId: Readonly<
    Record<string, CandidatePassBContextPacket>
  >;
}): readonly string[] {
  return input.candidateIds.filter((candidateId) => {
    const context = input.contextByCandidateId[candidateId];
    const receipt = input.receiptByCandidateId[candidateId];
    return (
      !candidatePassBInsightIsComplete(
        input.insightByCandidateId[candidateId],
      ) ||
      receipt === undefined ||
      context === undefined ||
      !candidatePassBReceiptMatchesContext(receipt, context)
    );
  });
}

export function selectCandidatePassBDurabilityOutstandingIds(input: {
  readonly candidateIds: readonly string[];
  readonly record: CandidatePassBInsightsRecord | null;
  readonly contextByCandidateId: Readonly<
    Record<string, CandidatePassBContextPacket>
  >;
}): readonly string[] {
  return input.candidateIds.filter(
    (candidateId) =>
      !candidatePassBArtifactIsDurable(
        input.record,
        candidateId,
        input.contextByCandidateId[candidateId],
      ),
  );
}

export function selectCandidatePassBDurableIds(input: {
  readonly candidateIds: readonly string[];
  readonly record: CandidatePassBInsightsRecord | null;
  readonly contextByCandidateId: Readonly<
    Record<string, CandidatePassBContextPacket>
  >;
}): ReadonlySet<string> {
  const outstanding = new Set(
    selectCandidatePassBDurabilityOutstandingIds(input),
  );
  return new Set(
    input.candidateIds.filter((candidateId) => !outstanding.has(candidateId)),
  );
}
