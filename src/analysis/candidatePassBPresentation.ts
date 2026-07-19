import type {
  CandidatePassBBasisLabel,
  CandidatePassBCue,
  CandidatePassBCuePhase,
  CandidatePassBEvidence,
} from "./candidatePassB";
import type { HighlightNarrative } from "./highlightNarrative";

export const CANDIDATE_PASS_B_PRESENTATION_MAX_CUES = 3;

export type CandidatePassBStatusLabel =
  | "빠른 근거만"
  | "또렷한 대사 없음"
  | "자동 전사 추정 · 재생 확인 필요"
  | "자동 전사 단서 · 재생 확인 필요";

export type CandidatePassBCuePhaseLabel = "반응 전" | "반응 시점 부근" | "반응 뒤";

export const CANDIDATE_PASS_B_CUE_PHASE_LABELS: Readonly<
  Record<CandidatePassBCuePhase, CandidatePassBCuePhaseLabel>
> = {
  "before-peak": "반응 전",
  "near-peak": "반응 시점 부근",
  "after-peak": "반응 뒤",
};

export interface CandidatePassBPresentationCue {
  readonly phase: CandidatePassBCuePhase;
  readonly phaseLabel: CandidatePassBCuePhaseLabel;
  readonly absoluteStartMs: number;
  readonly absoluteEndMs: number;
  readonly text: string;
}

/** Candidate-card projection. It intentionally contains no editable candidate fields. */
export interface CandidatePassBPresentation {
  readonly candidateId: string;
  readonly title: string;
  readonly event: string;
  readonly streamerReaction: string;
  readonly audienceReaction: string;
  readonly whyRecommended: string;
  readonly basis: HighlightNarrative["basis"];
  readonly basisLabel: HighlightNarrative["basisLabel"] | CandidatePassBBasisLabel;
  readonly reviewHint: string;
  readonly passBStatusLabel: CandidatePassBStatusLabel;
  readonly cues: readonly CandidatePassBPresentationCue[];
}

export type CandidatePassBPresentationErrorCode = "CANDIDATE_ID_MISMATCH";

export class CandidatePassBPresentationError extends Error {
  public readonly code: CandidatePassBPresentationErrorCode;
  public readonly expectedCandidateId: string;
  public readonly actualCandidateId: string;

  public constructor(expectedCandidateId: string, actualCandidateId: string) {
    super("Pass B evidence belongs to a different candidate.");
    this.name = "CandidatePassBPresentationError";
    this.code = "CANDIDATE_ID_MISMATCH";
    this.expectedCandidateId = expectedCandidateId;
    this.actualCandidateId = actualCandidateId;
  }
}

function presentationCue(cue: CandidatePassBCue): CandidatePassBPresentationCue {
  return {
    phase: cue.phase,
    phaseLabel: CANDIDATE_PASS_B_CUE_PHASE_LABELS[cue.phase],
    absoluteStartMs: cue.absoluteStartMs,
    absoluteEndMs: cue.absoluteEndMs,
    text: cue.text,
  };
}

function basePresentation(
  candidateId: string,
  baseNarrative: HighlightNarrative,
  passBStatusLabel: CandidatePassBStatusLabel,
): CandidatePassBPresentation {
  return {
    candidateId,
    title: baseNarrative.title,
    event: baseNarrative.event,
    streamerReaction: baseNarrative.streamerReaction,
    audienceReaction: baseNarrative.audienceReaction,
    whyRecommended: baseNarrative.whyRecommended,
    basis: baseNarrative.basis,
    basisLabel: baseNarrative.basisLabel,
    reviewHint: baseNarrative.reviewHint,
    passBStatusLabel,
    cues: [],
  };
}

/**
 * Combines a fast-pass narrative with candidate-only transcript evidence.
 *
 * Fallback evidence is deliberately ignored for narrative fields. Provisional
 * transcript cues remain seekable but cannot replace the fast event, cause, or
 * recommendation. Only evidence with an independent quality signal may add a
 * transcript-based narrative, and even that remains explicitly reviewable.
 */
export function buildCandidatePassBPresentation(
  candidateId: string,
  baseNarrative: HighlightNarrative,
  evidence?: CandidatePassBEvidence,
): CandidatePassBPresentation {
  if (evidence === undefined) {
    return basePresentation(candidateId, baseNarrative, "빠른 근거만");
  }
  if (evidence.candidateId !== candidateId) {
    throw new CandidatePassBPresentationError(candidateId, evidence.candidateId);
  }
  if (evidence.status === "fast-pass-fallback") {
    return basePresentation(candidateId, baseNarrative, "또렷한 대사 없음");
  }
  if (evidence.status === "provisional-transcript") {
    const presentation = basePresentation(
      candidateId,
      baseNarrative,
      "자동 전사 추정 · 재생 확인 필요",
    );
    return {
      ...presentation,
      reviewHint: evidence.overlay.reviewHint,
      cues: evidence.cues
        .slice(0, CANDIDATE_PASS_B_PRESENTATION_MAX_CUES)
        .map(presentationCue),
    };
  }

  return {
    candidateId,
    title: baseNarrative.title,
    event: evidence.overlay.event,
    streamerReaction: baseNarrative.streamerReaction,
    audienceReaction: baseNarrative.audienceReaction,
    whyRecommended: evidence.overlay.why,
    basis: baseNarrative.basis,
    basisLabel: evidence.overlay.basisLabel,
    reviewHint: evidence.overlay.reviewHint,
    passBStatusLabel: "자동 전사 단서 · 재생 확인 필요",
    cues: evidence.cues
      .slice(0, CANDIDATE_PASS_B_PRESENTATION_MAX_CUES)
      .map(presentationCue),
  };
}
