import { describe, expect, it } from "vitest";

import {
  CandidateReviewFeatureAvailabilityInputError,
  deriveCandidateReviewFeatureAvailability,
} from "./candidateReviewFeatureAvailability";

describe("candidate review feature availability", () => {
  it("hides every candidate feature when there are no candidates", () => {
    expect(deriveCandidateReviewFeatureAvailability(0)).toEqual({
      hasCandidates: false,
      showPassB: false,
      showAudioEvent: false,
      showRanking: false,
    });
  });

  it("shows candidate refinements but not ranking for one candidate", () => {
    expect(deriveCandidateReviewFeatureAvailability(1)).toEqual({
      hasCandidates: true,
      showPassB: true,
      showAudioEvent: true,
      showRanking: false,
    });
  });

  it.each(Array.from({ length: 11 }, (_, index) => index + 2))(
    "shows every candidate feature for %i candidates",
    (candidateCount) => {
      expect(deriveCandidateReviewFeatureAvailability(candidateCount)).toEqual({
        hasCandidates: true,
        showPassB: true,
        showAudioEvent: true,
        showRanking: true,
      });
    },
  );

  it.each([-1, 13, 0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects invalid candidate count %s with a typed error",
    (candidateCount) => {
      expect(() =>
        deriveCandidateReviewFeatureAvailability(candidateCount),
      ).toThrow(CandidateReviewFeatureAvailabilityInputError);

      try {
        deriveCandidateReviewFeatureAvailability(candidateCount);
      } catch (error: unknown) {
        expect(error).toMatchObject({
          name: "CandidateReviewFeatureAvailabilityInputError",
          code: "INVALID_CANDIDATE_COUNT",
        });
      }
    },
  );

  it("returns the same deterministic projection for repeated input", () => {
    expect(deriveCandidateReviewFeatureAvailability(2)).toBe(
      deriveCandidateReviewFeatureAvailability(2),
    );
  });
});
