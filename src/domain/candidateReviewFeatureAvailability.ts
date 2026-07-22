import { MAX_RANKING_CANDIDATE_COUNT } from "./candidateRankingView";

export type CandidateReviewFeatureAvailability = {
  readonly hasCandidates: boolean;
  readonly showPassB: boolean;
  readonly showAudioEvent: boolean;
  readonly showRanking: boolean;
  readonly rankingCandidateLimitExceeded: boolean;
};

export type CandidateReviewFeatureAvailabilityErrorCode =
  "INVALID_CANDIDATE_COUNT";

export class CandidateReviewFeatureAvailabilityInputError extends Error {
  public readonly code: CandidateReviewFeatureAvailabilityErrorCode;

  public constructor() {
    super("Candidate count must be a non-negative safe integer.");
    this.name = "CandidateReviewFeatureAvailabilityInputError";
    this.code = "INVALID_CANDIDATE_COUNT";
  }
}

const NO_CANDIDATE_FEATURES: CandidateReviewFeatureAvailability = Object.freeze({
  hasCandidates: false,
  showPassB: false,
  showAudioEvent: false,
  showRanking: false,
  rankingCandidateLimitExceeded: false,
});

const SINGLE_CANDIDATE_FEATURES: CandidateReviewFeatureAvailability =
  Object.freeze({
    hasCandidates: true,
    showPassB: true,
    showAudioEvent: true,
    showRanking: false,
    rankingCandidateLimitExceeded: false,
  });

const MULTIPLE_CANDIDATE_FEATURES: CandidateReviewFeatureAvailability =
  Object.freeze({
    hasCandidates: true,
    showPassB: true,
    showAudioEvent: true,
    showRanking: true,
    rankingCandidateLimitExceeded: false,
  });

const MULTIPLE_CANDIDATE_FEATURES_WITHOUT_RANKING: CandidateReviewFeatureAvailability =
  Object.freeze({
    hasCandidates: true,
    showPassB: true,
    showAudioEvent: true,
    showRanking: false,
    rankingCandidateLimitExceeded: true,
  });

export function deriveCandidateReviewFeatureAvailability(
  candidateCount: number,
): CandidateReviewFeatureAvailability {
  if (!Number.isSafeInteger(candidateCount) || candidateCount < 0) {
    throw new CandidateReviewFeatureAvailabilityInputError();
  }

  if (candidateCount === 0) {
    return NO_CANDIDATE_FEATURES;
  }

  if (candidateCount === 1) {
    return SINGLE_CANDIDATE_FEATURES;
  }

  if (candidateCount > MAX_RANKING_CANDIDATE_COUNT) {
    return MULTIPLE_CANDIDATE_FEATURES_WITHOUT_RANKING;
  }

  return MULTIPLE_CANDIDATE_FEATURES;
}
