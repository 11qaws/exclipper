import type { CandidatePassBEvidence } from "./candidatePassB";

export type CandidatePassBEvidenceById = Readonly<
  Record<string, CandidatePassBEvidence>
>;

function evidenceQualityRank(evidence: CandidatePassBEvidence): number {
  switch (evidence.status) {
    case "grounded-transcript":
      return 2;
    case "provisional-transcript":
      return 1;
    case "fast-pass-fallback":
      return 0;
  }
}

/**
 * A retry may replace a candidate only when it produced a new transcript clue.
 * A silent/failed retry must not erase a clue the user could already inspect.
 */
export function mergeCandidatePassBEvidence(
  current: CandidatePassBEvidenceById,
  incoming: CandidatePassBEvidence,
): CandidatePassBEvidenceById {
  const existing = current[incoming.candidateId];
  if (
    existing !== undefined &&
    (incoming.status === "fast-pass-fallback" ||
      evidenceQualityRank(incoming) < evidenceQualityRank(existing))
  ) {
    return current;
  }
  return {
    ...current,
    [incoming.candidateId]: incoming,
  };
}
