const MAX_CANDIDATE_COUNT = 12;

export type CandidateReviewFeatureAvailability = {
  readonly hasCandidates: boolean;
  readonly showPassB: boolean;
  readonly showAudioEvent: boolean;
  readonly showRanking: boolean;
};

export type CandidateReviewFeatureAvailabilityErrorCode =
  "INVALID_CANDIDATE_COUNT";

export class CandidateReviewFeatureAvailabilityInputError extends Error {
  public readonly code: CandidateReviewFeatureAvailabilityErrorCode;

  public constructor() {
    super("Candidate count must be an integer between 0 and 12 inclusive.");
    this.name = "CandidateReviewFeatureAvailabilityInputError";
    this.code = "INVALID_CANDIDATE_COUNT";
  }
}

const NO_CANDIDATE_FEATURES: CandidateReviewFeatureAvailability = Object.freeze({
  hasCandidates: false,
  showPassB: false,
  showAudioEvent: false,
  showRanking: false,
});

const SINGLE_CANDIDATE_FEATURES: CandidateReviewFeatureAvailability =
  Object.freeze({
    hasCandidates: true,
    showPassB: true,
    showAudioEvent: true,
    showRanking: false,
  });

const MULTIPLE_CANDIDATE_FEATURES: CandidateReviewFeatureAvailability =
  Object.freeze({
    hasCandidates: true,
    showPassB: true,
    showAudioEvent: true,
    showRanking: true,
  });

export function deriveCandidateReviewFeatureAvailability(
  candidateCount: number,
): CandidateReviewFeatureAvailability {
  if (
    !Number.isInteger(candidateCount) ||
    candidateCount < 0 ||
    candidateCount > MAX_CANDIDATE_COUNT
  ) {
    throw new CandidateReviewFeatureAvailabilityInputError();
  }

  if (candidateCount === 0) {
    return NO_CANDIDATE_FEATURES;
  }

  if (candidateCount === 1) {
    return SINGLE_CANDIDATE_FEATURES;
  }

  return MULTIPLE_CANDIDATE_FEATURES;
}
