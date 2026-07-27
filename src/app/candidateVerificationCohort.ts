export interface CandidateVerificationIdentity {
  readonly id: string;
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
 * Context-qualified candidates outside the bounded paid-detail cohort remain
 * in the canonical reservoir, but are not mislabeled as failed API work.
 */
export function selectCandidateVerificationCohort<
  TCandidate extends CandidateVerificationIdentity,
>(
  input: CandidateVerificationCohortInput<TCandidate>,
): readonly TCandidate[] {
  return input.candidates.filter((candidate) => {
    if (
      input.contextExcludedCandidateIds.has(candidate.id) ||
      input.detailScheduledCandidateIds.has(candidate.id)
    ) {
      return true;
    }
    return (
      input.contextScheduledCandidateIds.has(candidate.id) &&
      input.contextByCandidateId[candidate.id] === undefined
    );
  });
}
