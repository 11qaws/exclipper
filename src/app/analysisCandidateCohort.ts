export interface ReviewMutableCandidate {
  readonly id: string;
  readonly peakMs: number;
  readonly reviewState: "unreviewed" | "approved" | "rejected";
  readonly approvedBoundaryRevision: number | null;
}

interface CandidateRange {
  readonly id: string;
  readonly startMs: number;
  readonly peakMs: number;
  readonly endMs: number;
}

/**
 * Keeps only context-discovered proposals that add a genuinely new interval.
 * The same deterministic projection is used by the live UI and final durable
 * certification, so a volatile candidate array cannot invent or drop work.
 */
export function selectNonOverlappingDiscoveredCandidates<
  TBase extends CandidateRange,
  TProposal extends CandidateRange,
>(
  baseCandidates: readonly TBase[],
  proposals: readonly TProposal[],
): readonly TProposal[] {
  return proposals.filter((proposal) =>
    !baseCandidates.some((candidate) => {
      const overlapMs = Math.max(
        0,
        Math.min(candidate.endMs, proposal.endMs) -
          Math.max(candidate.startMs, proposal.startMs),
      );
      const shorterMs = Math.min(
        candidate.endMs - candidate.startMs,
        proposal.endMs - proposal.startMs,
      );
      return shorterMs > 0 && overlapMs / shorterMs >= 0.6;
    }),
  );
}

/**
 * Analysis inputs stay immutable while the editor reviews the published list.
 * Review decisions are projected back only after verification is complete.
 */
export function freezeAnalysisCandidateCohort<
  TCandidate extends ReviewMutableCandidate,
>(candidates: readonly TCandidate[]): readonly TCandidate[] {
  return candidates.map((candidate) => ({
    ...candidate,
    reviewState: "unreviewed",
    approvedBoundaryRevision: null,
  }));
}

export function projectVerifiedReviewCandidates<
  TCandidate extends Pick<ReviewMutableCandidate, "id" | "peakMs">,
>(
  candidates: readonly TCandidate[],
  verifiedCandidateIds: ReadonlySet<string>,
): readonly TCandidate[] {
  return candidates
    .filter(({ id }) => verifiedCandidateIds.has(id))
    .sort(
      (left, right) =>
        left.peakMs - right.peakMs || left.id.localeCompare(right.id),
    );
}
