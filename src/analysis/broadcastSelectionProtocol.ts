export const BROADCAST_SELECTION_SCHEMA_VERSION = "1.0.0" as const;

export interface BroadcastSelectionChapterInput {
  readonly chapterId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly summaryKo: string;
}

export interface BroadcastSelectionCandidateInput {
  readonly candidateId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly eventKind: string;
  readonly summaryKo: string;
}

export interface BroadcastSelectionCoverageGap {
  readonly startMs: number;
  readonly endMs: number;
}

export interface BroadcastSelectionRequest {
  readonly schemaVersion: typeof BROADCAST_SELECTION_SCHEMA_VERSION;
  readonly sourceDurationMs: number;
  readonly chapters: readonly BroadcastSelectionChapterInput[];
  readonly candidates: readonly BroadcastSelectionCandidateInput[];
  readonly coverageGaps: readonly BroadcastSelectionCoverageGap[];
}

export type BroadcastSelectionRelationType =
  | "setup-and-payoff"
  | "running-gag"
  | "same-episode"
  | "contrast"
  | "context-dependent"
  | "other";

export interface BroadcastSelectionCandidateRelation {
  readonly candidateIds: readonly string[];
  readonly relation: BroadcastSelectionRelationType;
  readonly explanationKo: string;
}

export interface BroadcastSelectionResult {
  readonly schemaVersion: typeof BROADCAST_SELECTION_SCHEMA_VERSION;
  readonly recommendedCandidateIds: readonly string[];
  readonly candidateRelations: readonly BroadcastSelectionCandidateRelation[];
  readonly coverageWarningsKo: readonly string[];
}
