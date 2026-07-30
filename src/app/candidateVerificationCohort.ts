export interface CandidateVerificationIdentity {
  readonly id: string;
  readonly reviewState?: "unreviewed" | "approved" | "rejected";
}

export interface CandidateVerificationCohortInput<
  TCandidate extends CandidateVerificationIdentity,
> {
  readonly candidates: readonly TCandidate[];
  readonly contextScheduledCandidateIds: ReadonlySet<string>;
  readonly contextExcludedCandidateIds: ReadonlySet<string>;
  readonly detailScheduledCandidateIds: ReadonlySet<string>;
  readonly contextByCandidateId: Readonly<Record<string, unknown>>;
}

/**
 * Selects only candidates whose absence would mean a real verification gap.
 *
 * Every whole-context candidate remains in the final verification cohort.
 * A future batching or quota policy may split detail work into several runs,
 * but it may never turn an unverified overflow candidate into a valid empty
 * result.
 */
export function selectCandidateVerificationCohort<
  TCandidate extends CandidateVerificationIdentity,
>(
  input: CandidateVerificationCohortInput<TCandidate>,
): readonly TCandidate[] {
  return input.candidates.filter((candidate) => {
    if (candidate.reviewState === "rejected") {
      return false;
    }
    if (
      input.contextExcludedCandidateIds.has(candidate.id) ||
      input.detailScheduledCandidateIds.has(candidate.id)
    ) {
      return true;
    }
    return input.contextScheduledCandidateIds.has(candidate.id);
  });
}
