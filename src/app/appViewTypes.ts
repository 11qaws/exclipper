/**
 * View-layer types shared by the app shell and its extracted modules.
 *
 * These describe what the editor sees, not what is persisted. Durable shapes
 * stay in `src/storage`; analysis contracts stay in `src/analysis`.
 */
import type { HighlightSelectionResult } from "../analysis";
import type {
  CandidatePassBTranscriptResult,
  CandidatePassBVerificationReceipt,
  CandidatePassBVideoFrame,
} from "../analysis/candidatePassBWorkerProtocol";
import type { BroadcastContextTranscriptionChunk } from "../analysis/broadcastContextSamplingPlan";
import type { BroadcastTranscriptWorkerProgress } from "../analysis/broadcastTranscriptWorkerProtocol";
import type { UnifiedHighlightCandidate } from "../analysis/highlightFusion";
import type { LocalAudioReactionAnalysisResult } from "../media/localAudioReactionAnalysisCore";
import type { StoredCandidatePassBModelIdentity } from "../storage/candidatePassBInsightStore";
import type { RecoverableAnalysisAudit } from "../storage/recoverableAnalysisResults";
import type {
  DurableAudioGapReasonCode,
  DurableChatGapReasonCode,
} from "../storage/durableAnalysisPayload";

export type Theme = "light" | "dark";

export type CandidateReviewState = "unreviewed" | "approved" | "rejected";

export type ReviewedCandidate = UnifiedHighlightCandidate & {
  readonly reviewState: CandidateReviewState;
  readonly approvedBoundaryRevision: number | null;
};

export interface CandidateBoundaryFeedback {
  readonly candidateId: string;
  readonly tone: "success" | "warning";
  readonly message: string;
}

/**
 * One reversible review decision. The editor is told when focus moved on its
 * own so an implicit navigation never reads as silently overwritten state.
 */
export interface ReviewUndoState {
  readonly candidateId: string;
  readonly candidateNumber: number;
  readonly previousReviewState: CandidateReviewState;
  readonly appliedReviewState: Exclude<CandidateReviewState, "unreviewed">;
  readonly advancedToCandidateId: string | null;
}

export interface CandidateRankingFeedback {
  readonly tone: "success" | "warning";
  readonly message: string;
}

export interface ChatAnalysisOutcome {
  readonly result: HighlightSelectionResult | null;
  readonly gapReasonCode: DurableChatGapReasonCode | null;
}

export interface AudioAnalysisOutcome {
  readonly result: LocalAudioReactionAnalysisResult | null;
  readonly gapReasonCode: DurableAudioGapReasonCode | null;
  readonly plannedWindowCount: number;
  readonly analyzedWindowCount: number;
  readonly coverageComplete: boolean;
}

export type CandidateGeminiInsight = CandidatePassBTranscriptResult["insight"];
export type CandidateGeminiInsightById = Readonly<
  Record<string, CandidateGeminiInsight>
>;
export type CandidatePassBModelById = Readonly<
  Record<string, StoredCandidatePassBModelIdentity>
>;
export type CandidateTimelineFrame = CandidatePassBVideoFrame;
export type CandidateTimelineFramesById = Readonly<
  Record<string, readonly CandidateTimelineFrame[]>
>;
export type CandidateTimelineThumbnailById = Readonly<
  Record<string, CandidatePassBVideoFrame>
>;
export type CandidatePassBVerificationReceiptById = Readonly<
  Record<string, CandidatePassBVerificationReceipt>
>;

export type CandidateTimelineSignalKind = "audio" | "chat" | "visual" | "fused";

export interface CandidateTimelineScorePoint {
  readonly id: string;
  readonly peakMs: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly score: number;
  readonly strength: number;
  readonly signalKind: CandidateTimelineSignalKind;
}

export interface CandidateTimelineScoreSource {
  readonly signalKind: CandidateTimelineSignalKind;
  readonly candidates: readonly Pick<
    UnifiedHighlightCandidate,
    "id" | "peakMs" | "startMs" | "endMs" | "score"
  >[];
}

export type BroadcastTranscriptExplorationCellState =
  | "queued"
  | "active"
  | "complete"
  | "gap";

export interface BroadcastTranscriptExplorationCell {
  readonly chunkId: string;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly kind: BroadcastContextTranscriptionChunk["kind"];
  readonly state: BroadcastTranscriptExplorationCellState;
  readonly stage: BroadcastTranscriptWorkerProgress["stage"] | null;
}

export type RecoveryCatalogState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly audit: RecoverableAnalysisAudit }
  | { readonly status: "failed" };

export type ClipDownloadStatus = "idle" | "rendering" | "completed" | "failed";
export type ClipDownloadStatusById = Readonly<Record<string, ClipDownloadStatus>>;
export type ClipDownloadErrorById = Readonly<Record<string, string>>;
export type ClipDownloadProgressById = Readonly<Record<string, number>>;
export type ClipBatchStatus = "idle" | "rendering" | "completed" | "failed";

/** What the timeline inspector is currently explaining. */
export type TimelineInspectionTarget =
  | { readonly kind: "chapter"; readonly id: string }
  | { readonly kind: "lead"; readonly id: string }
  | { readonly kind: "exploration"; readonly id: string }
  | { readonly kind: "signal"; readonly id: string };

export class SourceRebindMismatchError extends Error {
  public constructor() {
    super("The selected file does not match the recovered source fingerprint.");
    this.name = "SourceRebindMismatchError";
  }
}
