import { describe, expect, it } from "vitest";

import {
  nextUnreviewedCandidateId,
  reviewDecisionAdvances,
} from "./reviewNavigation";
import type { CandidateReviewState } from "./appViewTypes";

const candidate = (id: string, reviewState: CandidateReviewState) => ({
  id,
  reviewState,
});

describe("nextUnreviewedCandidateId", () => {
  it("moves forward to the next undecided candidate", () => {
    const candidates = [
      candidate("1", "approved"),
      candidate("2", "unreviewed"),
      candidate("3", "unreviewed"),
    ];
    expect(nextUnreviewedCandidateId(candidates, "2")).toBe("3");
  });

  it("skips candidates that already have a decision", () => {
    const candidates = [
      candidate("1", "unreviewed"),
      candidate("2", "unreviewed"),
      candidate("3", "approved"),
      candidate("4", "rejected"),
      candidate("5", "unreviewed"),
    ];
    expect(nextUnreviewedCandidateId(candidates, "2")).toBe("5");
  });

  it("wraps to earlier candidates that were skipped", () => {
    const candidates = [
      candidate("1", "unreviewed"),
      candidate("2", "approved"),
      candidate("3", "unreviewed"),
    ];
    expect(nextUnreviewedCandidateId(candidates, "3")).toBe("1");
  });

  it("returns null when the judged candidate is the last undecided one", () => {
    const candidates = [
      candidate("1", "approved"),
      candidate("2", "rejected"),
      candidate("3", "unreviewed"),
    ];
    // Candidate 3 is being judged right now; nothing else is waiting.
    expect(nextUnreviewedCandidateId(candidates, "3")).toBeNull();
  });

  it("never returns the candidate that was just judged", () => {
    const candidates = [candidate("only", "unreviewed")];
    expect(nextUnreviewedCandidateId(candidates, "only")).toBeNull();
  });

  it("returns null for an unknown candidate id", () => {
    const candidates = [candidate("1", "unreviewed")];
    expect(nextUnreviewedCandidateId(candidates, "missing")).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(nextUnreviewedCandidateId([], "1")).toBeNull();
  });
});

describe("reviewDecisionAdvances", () => {
  it("advances on a real decision", () => {
    expect(reviewDecisionAdvances("approved")).toBe(true);
    expect(reviewDecisionAdvances("rejected")).toBe(true);
  });

  it("does not advance when a decision is taken back", () => {
    expect(reviewDecisionAdvances("unreviewed")).toBe(false);
  });
});
