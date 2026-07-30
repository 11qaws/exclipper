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

/**
 * Returns candidates that the whole-broadcast judgement marked as a negative
 * hypothesis.
 *
 * This is intentionally separate from a missing context packet. An approved
 * editor override stays in the verification queue, where it must still satisfy
 * every evidence gate; approval never turns missing evidence into a clip.
 */
export function selectContextExcludedCandidateIds(
  candidates: readonly CandidateAiQueueItem[],
  projectionById: CandidateAiProjectionById,
): readonly string[] {
  return candidates
    .filter(
      (candidate) =>
        candidate.reviewState !== "approved" &&
        projectionById[candidate.id] === "deprioritized",
    )
    .map((candidate) => candidate.id);
}

/**
 * Every non-editor-rejected candidate receives multimodal detail work.
 * Whole-context priority remains visible, but cannot eliminate a candidate
 * before its four frames and candidate audio have been checked.
 */
export function selectCandidateDetailCandidateIds(
  candidates: readonly CandidateAiQueueItem[],
  projectionById: CandidateAiProjectionById,
): readonly string[] {
  void projectionById;
  return candidates
    .filter((candidate) => candidate.reviewState !== "rejected")
    .map((candidate) => candidate.id);
}

export interface ContextQualifiedFinalSelection<
  TCandidate extends SelectableCandidate = SelectableCandidate,
> {
  readonly selectedCandidates: readonly TCandidate[];
  readonly reviewCandidates: readonly TCandidate[];
  readonly rejectedCandidateIds: readonly string[];
  /**
   * Context decisions that are normal exclusions, not missing-packet errors.
   *
   * This list deliberately excludes editor-approved overrides. Consumers may
   * pass it to the final verification gate without deleting reservoir items.
   */
  readonly contextExcludedCandidateIds: readonly string[];
  readonly missingContextCandidateIds: readonly string[];
  readonly projectionById: CandidateAiProjectionById;
  readonly eligibilityById: Readonly<
    Record<string, "eligible" | "exploration" | "ineligible">
  >;
}

export function isContextExcludedProgramMaterial(
  annotation: BroadcastContextCandidateAnnotation,
): boolean {
  return (
    annotation.category === "music-or-intermission" ||
    annotation.rejectionReasons.includes("music-or-song") ||
    annotation.rejectionReasons.includes("opening-ending-or-break")
  );
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
  const contextExcludedCandidateIds: string[] = [];
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
    if (isContextExcludedProgramMaterial(annotation)) {
      eligibilityById[candidate.id] = "ineligible";
      rejectedCandidateIds.push(candidate.id);
      if (
        !("reviewState" in candidate) ||
        candidate.reviewState !== "approved"
      ) {
        contextExcludedCandidateIds.push(candidate.id);
      }
      projectionById[candidate.id] = "deprioritized";
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
      if (
        !("reviewState" in candidate) ||
        candidate.reviewState !== "approved"
      ) {
        contextExcludedCandidateIds.push(candidate.id);
      }
      projectionById[candidate.id] = "deprioritized";
    }
  }

  const chronological = (left: TCandidate, right: TCandidate): number =>
    left.peakMs - right.peakMs || left.id.localeCompare(right.id);
  selectedCandidates.sort(chronological);
  reviewCandidates.sort(chronological);
  rejectedCandidateIds.sort((left, right) => left.localeCompare(right));
  contextExcludedCandidateIds.sort((left, right) => left.localeCompare(right));
  missingContextCandidateIds.sort((left, right) => left.localeCompare(right));

  return {
    selectedCandidates,
    reviewCandidates,
    rejectedCandidateIds,
    contextExcludedCandidateIds,
    missingContextCandidateIds,
    projectionById,
    eligibilityById,
  };
}
