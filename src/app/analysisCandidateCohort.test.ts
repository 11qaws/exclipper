import { describe, expect, it } from "vitest";

import {
  freezeAnalysisCandidateCohort,
  projectVerifiedReviewCandidates,
  selectNonOverlappingDiscoveredCandidates,
} from "./analysisCandidateCohort";

const candidates = [
  {
    id: "later",
    peakMs: 20_000,
    reviewState: "approved" as const,
    approvedBoundaryRevision: 3,
    score: 0.9,
  },
  {
    id: "earlier",
    peakMs: 10_000,
    reviewState: "rejected" as const,
    approvedBoundaryRevision: null,
    score: 0.8,
  },
];

describe("analysis candidate cohort", () => {
  it("removes editor decisions from the immutable analysis input", () => {
    const frozen = freezeAnalysisCandidateCohort(candidates);

    expect(frozen.map(({ id, reviewState, approvedBoundaryRevision }) => ({
      id,
      reviewState,
      approvedBoundaryRevision,
    }))).toEqual([
      {
        id: "later",
        reviewState: "unreviewed",
        approvedBoundaryRevision: null,
      },
      {
        id: "earlier",
        reviewState: "unreviewed",
        approvedBoundaryRevision: null,
      },
    ]);
    expect(candidates[0]?.reviewState).toBe("approved");
  });

  it("keeps current editor state while projecting certified ids", () => {
    const projected = projectVerifiedReviewCandidates(
      candidates,
      new Set(["later", "earlier"]),
    );

    expect(projected.map(({ id, reviewState }) => ({ id, reviewState }))).toEqual([
      { id: "earlier", reviewState: "rejected" },
      { id: "later", reviewState: "approved" },
    ]);
  });

  it("keeps only discovered intervals that add new durable coverage", () => {
    const proposals = [
      { id: "duplicate", startMs: 9_000, peakMs: 15_000, endMs: 21_000 },
      { id: "new", startMs: 30_000, peakMs: 35_000, endMs: 40_000 },
    ];

    expect(
      selectNonOverlappingDiscoveredCandidates(
        [{ id: "base", startMs: 10_000, peakMs: 15_000, endMs: 20_000 }],
        proposals,
      ).map(({ id }) => id),
    ).toEqual(["new"]);
  });
});
