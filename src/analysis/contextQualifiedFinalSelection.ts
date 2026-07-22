import {
  buildBroadcastContextEligibilityById,
  type BroadcastContextCandidateAnnotation,
} from "./broadcastContextProtocol";
import type { SelectableCandidate } from "./contextAwareCandidateSelection";

export type CandidateAiProjectionDisposition =
  | "recommended"
  | "needs-review"
  | "deprioritized"
  | "insufficient-evidence";

export type CandidateAiProjectionById = Readonly<
  Record<string, CandidateAiProjectionDisposition>
>;

export interface CandidateAiQueueItem {
  readonly id: string;
  readonly reviewState: "unreviewed" | "approved" | "rejected";
}

/** Editor decisions outrank AI priority when choosing paid detail work. */
export function selectCandidateDetailCandidateIds(
  candidates: readonly CandidateAiQueueItem[],
  projectionById: CandidateAiProjectionById,
  explicitMusicOnlyCandidateIds: ReadonlySet<string>,
): readonly string[] {
  return candidates
    .filter((candidate) => {
      if (candidate.reviewState === "rejected") return false;
      if (candidate.reviewState === "approved") return true;
      return (
        projectionById[candidate.id] !== "deprioritized" &&
        !explicitMusicOnlyCandidateIds.has(candidate.id)
      );
    })
    .map((candidate) => candidate.id);
}

export interface ContextQualifiedFinalSelection<
  TCandidate extends SelectableCandidate = SelectableCandidate,
> {
  readonly selectedCandidates: readonly TCandidate[];
  readonly reviewCandidates: readonly TCandidate[];
  readonly rejectedCandidateIds: readonly string[];
  readonly missingContextCandidateIds: readonly string[];
  readonly projectionById: CandidateAiProjectionById;
  readonly eligibilityById: Readonly<
    Record<string, "eligible" | "exploration" | "ineligible">
  >;
}

/**
 * Applies the whole-broadcast semantic verdict after candidate perception.
 * Missing context is review-only; it can never silently become an approved clip.
 */
export function finalizeContextQualifiedCandidates<
  TCandidate extends SelectableCandidate,
>(
  candidates: readonly TCandidate[],
  annotations: readonly BroadcastContextCandidateAnnotation[],
): ContextQualifiedFinalSelection<TCandidate> {
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const annotationById = new Map<string, BroadcastContextCandidateAnnotation>();
  for (const annotation of annotations) {
    if (!candidateIds.has(annotation.candidateId)) continue;
    if (annotationById.has(annotation.candidateId)) {
      throw new RangeError("Broadcast context contains a duplicate candidate annotation.");
    }
    annotationById.set(annotation.candidateId, annotation);
  }

  const eligibilityById = {
    ...buildBroadcastContextEligibilityById([...annotationById.values()]),
  };
  const selectedCandidates: TCandidate[] = [];
  const reviewCandidates: TCandidate[] = [];
  const rejectedCandidateIds: string[] = [];
  const missingContextCandidateIds: string[] = [];
  const projectionById: Record<string, CandidateAiProjectionDisposition> = {};

  for (const candidate of candidates) {
    const annotation = annotationById.get(candidate.id);
    if (annotation === undefined) {
      eligibilityById[candidate.id] = "exploration";
      reviewCandidates.push(candidate);
      missingContextCandidateIds.push(candidate.id);
      projectionById[candidate.id] = "insufficient-evidence";
      continue;
    }
    if (annotation.clipDecision === "select") {
      selectedCandidates.push(candidate);
      projectionById[candidate.id] = "recommended";
    } else if (annotation.clipDecision === "review") {
      reviewCandidates.push(candidate);
      projectionById[candidate.id] = "needs-review";
    } else {
      rejectedCandidateIds.push(candidate.id);
      projectionById[candidate.id] = "deprioritized";
    }
  }

  const chronological = (left: TCandidate, right: TCandidate): number =>
    left.peakMs - right.peakMs || left.id.localeCompare(right.id);
  selectedCandidates.sort(chronological);
  reviewCandidates.sort(chronological);
  rejectedCandidateIds.sort((left, right) => left.localeCompare(right));
  missingContextCandidateIds.sort((left, right) => left.localeCompare(right));

  return {
    selectedCandidates,
    reviewCandidates,
    rejectedCandidateIds,
    missingContextCandidateIds,
    projectionById,
    eligibilityById,
  };
}
