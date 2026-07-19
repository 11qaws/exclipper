import type { CandidateAudioEventEvidenceById } from "./candidateAudioEventEvidenceState";
import type { CandidatePassBEvidenceById } from "./candidatePassBEvidenceState";
import type { UnifiedHighlightCandidate } from "./highlightFusion";

export const CANDIDATE_RANKING_ALGORITHM_VERSION =
  "reaction-support-basis-points-v1" as const;
export const CANDIDATE_RANKING_MAX_CANDIDATES = 12 as const;
export const CANDIDATE_RANKING_MAX_SUPPORT_POINTS = 10_000 as const;

const AUDIO_WEIGHT_POINTS = 6_000;
const CHAT_WEIGHT_POINTS = 3_000;
const VISUAL_WEIGHT_POINTS = 500;
const AUDIO_CHAT_CONSENSUS_POINTS = 500;
const MAX_CANDIDATE_ID_LENGTH = 256;

export type CandidateRankingAudioEventCoverage = "complete" | "incomplete";

export type CandidateRankingReasonCode =
  | "fast-audio-reaction"
  | "fast-chat-reaction"
  | "audio-chat-agreement"
  | "visual-context"
  | "strong-audio-event"
  | "possible-audio-event"
  | "grounded-transcript-cue"
  | "provisional-transcript-cue"
  | "visual-exploration-only";

export interface CandidateRankingBreakdown {
  /** Existing fast-pass audio support. */
  readonly audioBasePoints: number;
  /** Bounded AST semantic reinforcement inside the same audio family. */
  readonly audioSemanticPoints: number;
  readonly chatPoints: number;
  readonly visualContextPoints: number;
  readonly audioChatAgreementPoints: number;
  readonly totalPoints: number;
}

export interface CandidateRankingEntry {
  readonly candidateId: string;
  readonly previousOrdinal: number;
  readonly proposedOrdinal: number;
  /** Relative support within this candidate set, never a probability. */
  readonly relativeSupportPoints: number;
  readonly breakdown: CandidateRankingBreakdown;
  readonly reasonCodes: readonly CandidateRankingReasonCode[];
}

export interface CandidateRankingProposal {
  readonly proposalId: string;
  readonly rankingSessionId: string;
  readonly rankingRevision: number;
  readonly analysisRunId: string;
  readonly algorithmVersion: typeof CANDIDATE_RANKING_ALGORITHM_VERSION;
  readonly candidateSetFingerprint: string;
  readonly evidenceFingerprint: string;
  readonly expectedViewOrderRevision: number;
  readonly inputOrderCandidateIds: readonly string[];
  readonly orderedCandidateIds: readonly string[];
  readonly entries: readonly CandidateRankingEntry[];
  readonly changedPositionCount: number;
  readonly audioEventCoverage: CandidateRankingAudioEventCoverage;
}

export interface CandidateRankingFingerprints {
  readonly candidateSetFingerprint: string;
  readonly evidenceFingerprint: string;
}

export interface CandidateRankingInput {
  readonly proposalId: string;
  readonly rankingSessionId: string;
  readonly rankingRevision: number;
  readonly analysisRunId: string;
  readonly expectedViewOrderRevision: number;
  readonly candidates: readonly UnifiedHighlightCandidate[];
  readonly passBEvidenceById: CandidatePassBEvidenceById;
  readonly audioEventEvidenceById: CandidateAudioEventEvidenceById;
  readonly audioEventCoverage: CandidateRankingAudioEventCoverage;
}

export type CandidateRankingInputErrorCode =
  | "INVALID_IDENTIFIER"
  | "INVALID_RANKING_REVISION"
  | "INVALID_VIEW_ORDER_REVISION"
  | "INVALID_CANDIDATE_COUNT"
  | "INVALID_CANDIDATE_ID"
  | "DUPLICATE_CANDIDATE_ID"
  | "INVALID_CANDIDATE_SCORE"
  | "INVALID_NORMALIZED_EVIDENCE"
  | "UNKNOWN_EVIDENCE_CANDIDATE"
  | "EVIDENCE_CANDIDATE_MISMATCH";

export class CandidateRankingInputError extends Error {
  public readonly code: CandidateRankingInputErrorCode;
  public readonly candidateId: string | null;

  public constructor(
    code: CandidateRankingInputErrorCode,
    message: string,
    candidateId: string | null = null,
  ) {
    super(message);
    this.name = "CandidateRankingInputError";
    this.code = code;
    this.candidateId = candidateId;
  }
}

interface RankedDraft {
  readonly candidate: UnifiedHighlightCandidate;
  readonly previousOrdinal: number;
  readonly relativeSupportPoints: number;
  readonly breakdown: CandidateRankingBreakdown;
  readonly reasonCodes: readonly CandidateRankingReasonCode[];
}

function requireIdentifier(value: string, fieldName: string): void {
  if (value.trim().length === 0 || value.length > MAX_CANDIDATE_ID_LENGTH) {
    throw new CandidateRankingInputError(
      "INVALID_IDENTIFIER",
      `${fieldName} must be a non-empty bounded identifier.`,
    );
  }
}

function normalizedEvidenceScore(
  candidateId: string,
  value: number | undefined,
): number {
  if (value === undefined) {
    return 0;
  }
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new CandidateRankingInputError(
      "INVALID_NORMALIZED_EVIDENCE",
      "Candidate normalized evidence must be finite and between zero and one.",
      candidateId,
    );
  }
  return value;
}

function validateCandidateInput(
  candidates: readonly UnifiedHighlightCandidate[],
  passBEvidenceById: CandidatePassBEvidenceById,
  audioEventEvidenceById: CandidateAudioEventEvidenceById,
): void {
  if (
    candidates.length < 1 ||
    candidates.length > CANDIDATE_RANKING_MAX_CANDIDATES
  ) {
    throw new CandidateRankingInputError(
      "INVALID_CANDIDATE_COUNT",
      "Candidate ranking requires between one and twelve candidates.",
    );
  }

  const candidateIds = new Set<string>();
  for (const candidate of candidates) {
    if (
      candidate.id.trim().length === 0 ||
      candidate.id.length > MAX_CANDIDATE_ID_LENGTH
    ) {
      throw new CandidateRankingInputError(
        "INVALID_CANDIDATE_ID",
        "Candidate ID must be a non-empty bounded identifier.",
        candidate.id,
      );
    }
    if (candidateIds.has(candidate.id)) {
      throw new CandidateRankingInputError(
        "DUPLICATE_CANDIDATE_ID",
        "Candidate IDs must be unique.",
        candidate.id,
      );
    }
    candidateIds.add(candidate.id);
    if (!Number.isFinite(candidate.score) || candidate.score < 0 || candidate.score > 1) {
      throw new CandidateRankingInputError(
        "INVALID_CANDIDATE_SCORE",
        "Candidate score must be finite and between zero and one.",
        candidate.id,
      );
    }
    normalizedEvidenceScore(candidate.id, candidate.evidence.audio?.normalizedScore);
    normalizedEvidenceScore(candidate.id, candidate.evidence.chat?.normalizedScore);
    normalizedEvidenceScore(candidate.id, candidate.evidence.visual?.normalizedScore);
  }

  for (const [recordCandidateId, evidence] of Object.entries(passBEvidenceById)) {
    if (!candidateIds.has(recordCandidateId)) {
      throw new CandidateRankingInputError(
        "UNKNOWN_EVIDENCE_CANDIDATE",
        "Transcript evidence refers to a candidate outside this ranking snapshot.",
        recordCandidateId,
      );
    }
    if (evidence.candidateId !== recordCandidateId) {
      throw new CandidateRankingInputError(
        "EVIDENCE_CANDIDATE_MISMATCH",
        "Transcript evidence key and candidate ID must match.",
        recordCandidateId,
      );
    }
  }

  for (const [recordCandidateId, evidence] of Object.entries(audioEventEvidenceById)) {
    if (!candidateIds.has(recordCandidateId)) {
      throw new CandidateRankingInputError(
        "UNKNOWN_EVIDENCE_CANDIDATE",
        "Audio-event evidence refers to a candidate outside this ranking snapshot.",
        recordCandidateId,
      );
    }
    if (evidence.candidateId !== recordCandidateId) {
      throw new CandidateRankingInputError(
        "EVIDENCE_CANDIDATE_MISMATCH",
        "Audio-event evidence key and candidate ID must match.",
        recordCandidateId,
      );
    }
  }
}

function strongestAudioEventFactor(
  candidateId: string,
  audioEventEvidenceById: CandidateAudioEventEvidenceById,
  coverage: CandidateRankingAudioEventCoverage,
): 0 | 0.5 | 1 {
  if (coverage !== "complete") {
    return 0;
  }
  const evidence = audioEventEvidenceById[candidateId];
  if (evidence?.status !== "detected") {
    return 0;
  }
  if (evidence.detections.some(({ strength }) => strength === "strong")) {
    return 1;
  }
  return evidence.detections.some(({ strength }) => strength === "possible")
    ? 0.5
    : 0;
}

function reasonCodesForCandidate(
  candidate: UnifiedHighlightCandidate,
  passBEvidenceById: CandidatePassBEvidenceById,
  audioEventFactor: 0 | 0.5 | 1,
): readonly CandidateRankingReasonCode[] {
  const reasons: CandidateRankingReasonCode[] = [];
  const hasAudio = candidate.evidence.audio !== undefined;
  const hasChat = candidate.evidence.chat !== undefined;
  const hasVisual = candidate.evidence.visual !== undefined;

  if (hasAudio) {
    reasons.push("fast-audio-reaction");
  }
  if (hasChat) {
    reasons.push("fast-chat-reaction");
  }
  if (hasAudio && hasChat) {
    reasons.push("audio-chat-agreement");
  }
  if (hasVisual) {
    reasons.push("visual-context");
  }
  if (!hasAudio && !hasChat && hasVisual) {
    reasons.push("visual-exploration-only");
  }
  if (audioEventFactor === 1) {
    reasons.push("strong-audio-event");
  } else if (audioEventFactor === 0.5) {
    reasons.push("possible-audio-event");
  }

  const transcriptEvidence = passBEvidenceById[candidate.id];
  if (transcriptEvidence?.status === "grounded-transcript") {
    reasons.push("grounded-transcript-cue");
  } else if (transcriptEvidence?.status === "provisional-transcript") {
    reasons.push("provisional-transcript-cue");
  }
  return reasons;
}

function buildDraft(
  candidate: UnifiedHighlightCandidate,
  previousOrdinal: number,
  passBEvidenceById: CandidatePassBEvidenceById,
  audioEventEvidenceById: CandidateAudioEventEvidenceById,
  audioEventCoverage: CandidateRankingAudioEventCoverage,
): RankedDraft {
  const audioScore = normalizedEvidenceScore(
    candidate.id,
    candidate.evidence.audio?.normalizedScore,
  );
  const chatScore = normalizedEvidenceScore(
    candidate.id,
    candidate.evidence.chat?.normalizedScore,
  );
  const visualScore = normalizedEvidenceScore(
    candidate.id,
    candidate.evidence.visual?.normalizedScore,
  );
  const audioEventFactor = strongestAudioEventFactor(
    candidate.id,
    audioEventEvidenceById,
    audioEventCoverage,
  );
  const audioFamilyScore =
    audioEventFactor === 0
      ? audioScore
      : audioScore > 0
        ? audioScore + 0.1 * audioEventFactor * (1 - audioScore)
        : 0.35 * audioEventFactor;

  const audioBasePoints = Math.round(AUDIO_WEIGHT_POINTS * audioScore);
  const audioPoints = Math.round(AUDIO_WEIGHT_POINTS * audioFamilyScore);
  const audioSemanticPoints = Math.max(0, audioPoints - audioBasePoints);
  const chatPoints = Math.round(CHAT_WEIGHT_POINTS * chatScore);
  const visualContextPoints = Math.round(VISUAL_WEIGHT_POINTS * visualScore);
  const audioChatAgreementPoints =
    candidate.evidence.audio !== undefined && candidate.evidence.chat !== undefined
      ? AUDIO_CHAT_CONSENSUS_POINTS
      : 0;
  const totalPoints = Math.min(
    CANDIDATE_RANKING_MAX_SUPPORT_POINTS,
    audioBasePoints +
      audioSemanticPoints +
      chatPoints +
      visualContextPoints +
      audioChatAgreementPoints,
  );

  return {
    candidate,
    previousOrdinal,
    relativeSupportPoints: totalPoints,
    breakdown: {
      audioBasePoints,
      audioSemanticPoints,
      chatPoints,
      visualContextPoints,
      audioChatAgreementPoints,
      totalPoints,
    },
    reasonCodes: reasonCodesForCandidate(
      candidate,
      passBEvidenceById,
      audioEventFactor,
    ),
  };
}

function compareDrafts(left: RankedDraft, right: RankedDraft): number {
  return (
    right.relativeSupportPoints - left.relativeSupportPoints ||
    left.previousOrdinal - right.previousOrdinal ||
    left.candidate.peakMs - right.candidate.peakMs ||
    left.candidate.id.localeCompare(right.candidate.id)
  );
}

function roundFingerprintNumber(value: number | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  return Math.round(value * 1_000_000) / 1_000_000;
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function createCandidateRankingFingerprints(
  candidates: readonly UnifiedHighlightCandidate[],
  passBEvidenceById: CandidatePassBEvidenceById,
  audioEventEvidenceById: CandidateAudioEventEvidenceById,
  audioEventCoverage: CandidateRankingAudioEventCoverage,
): CandidateRankingFingerprints {
  validateCandidateInput(candidates, passBEvidenceById, audioEventEvidenceById);

  const candidateSnapshot = candidates.map((candidate) => ({
    id: candidate.id,
    peakMs: candidate.peakMs,
    score: roundFingerprintNumber(candidate.score),
    signalKinds: [...candidate.signalKinds],
    audio: roundFingerprintNumber(candidate.evidence.audio?.normalizedScore),
    chat: roundFingerprintNumber(candidate.evidence.chat?.normalizedScore),
    visual: roundFingerprintNumber(candidate.evidence.visual?.normalizedScore),
  }));

  const evidenceSnapshot = candidates.map((candidate) => {
    const transcript = passBEvidenceById[candidate.id];
    const audioEvent = audioEventEvidenceById[candidate.id];
    return {
      id: candidate.id,
      transcriptStatus: transcript?.status ?? "not-run",
      audioEvent:
        audioEventCoverage === "complete" && audioEvent !== undefined
          ? {
              status: audioEvent.status,
              modelRevision: audioEvent.model.revision,
              sourceStartMs: audioEvent.sourceStartMs,
              sourceEndMs: audioEvent.sourceEndMs,
              detections:
                audioEvent.status === "detected"
                  ? audioEvent.detections
                      .map(({ kind, strength }) => `${kind}:${strength}`)
                      .sort()
                  : [],
            }
          : null,
    };
  });

  return {
    candidateSetFingerprint: `candidate-set-v1-${fnv1a64(JSON.stringify(candidateSnapshot))}`,
    evidenceFingerprint: `ranking-evidence-v1-${fnv1a64(
      JSON.stringify({ audioEventCoverage, candidates: evidenceSnapshot }),
    )}`,
  };
}

export function buildCandidateRankingProposal(
  input: CandidateRankingInput,
): CandidateRankingProposal {
  requireIdentifier(input.proposalId, "proposalId");
  requireIdentifier(input.rankingSessionId, "rankingSessionId");
  requireIdentifier(input.analysisRunId, "analysisRunId");
  if (!Number.isSafeInteger(input.rankingRevision) || input.rankingRevision < 1) {
    throw new CandidateRankingInputError(
      "INVALID_RANKING_REVISION",
      "Ranking revision must be a positive safe integer.",
    );
  }
  if (
    !Number.isSafeInteger(input.expectedViewOrderRevision) ||
    input.expectedViewOrderRevision < 0
  ) {
    throw new CandidateRankingInputError(
      "INVALID_VIEW_ORDER_REVISION",
      "Expected view-order revision must be a non-negative safe integer.",
    );
  }

  const fingerprints = createCandidateRankingFingerprints(
    input.candidates,
    input.passBEvidenceById,
    input.audioEventEvidenceById,
    input.audioEventCoverage,
  );
  const drafts = input.candidates.map((candidate, index) =>
    buildDraft(
      candidate,
      index + 1,
      input.passBEvidenceById,
      input.audioEventEvidenceById,
      input.audioEventCoverage,
    ),
  );
  const orderedDrafts = [...drafts].sort(compareDrafts);
  const proposedOrdinalByCandidateId = new Map(
    orderedDrafts.map(({ candidate }, index) => [candidate.id, index + 1]),
  );
  const entries = drafts.map((draft): CandidateRankingEntry => ({
    candidateId: draft.candidate.id,
    previousOrdinal: draft.previousOrdinal,
    proposedOrdinal:
      proposedOrdinalByCandidateId.get(draft.candidate.id) ?? draft.previousOrdinal,
    relativeSupportPoints: draft.relativeSupportPoints,
    breakdown: draft.breakdown,
    reasonCodes: draft.reasonCodes,
  }));

  return {
    proposalId: input.proposalId,
    rankingSessionId: input.rankingSessionId,
    rankingRevision: input.rankingRevision,
    analysisRunId: input.analysisRunId,
    algorithmVersion: CANDIDATE_RANKING_ALGORITHM_VERSION,
    candidateSetFingerprint: fingerprints.candidateSetFingerprint,
    evidenceFingerprint: fingerprints.evidenceFingerprint,
    expectedViewOrderRevision: input.expectedViewOrderRevision,
    inputOrderCandidateIds: input.candidates.map(({ id }) => id),
    orderedCandidateIds: orderedDrafts.map(({ candidate }) => candidate.id),
    entries,
    changedPositionCount: entries.filter(
      ({ previousOrdinal, proposedOrdinal }) => previousOrdinal !== proposedOrdinal,
    ).length,
    audioEventCoverage: input.audioEventCoverage,
  };
}
