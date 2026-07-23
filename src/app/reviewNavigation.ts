/**
 * Focus movement rules for the candidate review loop.
 *
 * Pure so the auto-advance behaviour can be pinned by tests: an editor working
 * through a long candidate list must never be dropped somewhere unexpected, and
 * must never be moved at all once nothing is left to decide.
 */
import type { CandidateReviewState } from "./appViewTypes";

interface ReviewableCandidate {
  readonly id: string;
  readonly reviewState: CandidateReviewState;
}

/**
 * The next candidate still waiting for a decision, searched forward from the
 * judged one and wrapping around to earlier candidates.
 *
 * Returns null when nothing else needs a decision, so a final judgement leaves
 * the editor on the candidate they just finished instead of jumping away.
 */
export function nextUnreviewedCandidateId<T extends ReviewableCandidate>(
  candidates: readonly T[],
  judgedCandidateId: string,
): string | null {
  const index = candidates.findIndex(({ id }) => id === judgedCandidateId);
  if (index < 0) {
    return null;
  }
  const searchOrder = [
    ...candidates.slice(index + 1),
    ...candidates.slice(0, index),
  ];
  return (
    searchOrder.find(
      ({ id, reviewState }) =>
        id !== judgedCandidateId && reviewState === "unreviewed",
    )?.id ?? null
  );
}

/**
 * Reverting a decision back to `unreviewed` is an undo, not progress, so it
 * never advances focus.
 */
export function reviewDecisionAdvances(
  reviewState: CandidateReviewState,
): reviewState is Exclude<CandidateReviewState, "unreviewed"> {
  return reviewState !== "unreviewed";
}
