import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";

import {
  parseChatImport,
  type ChatImportResult,
} from "./analysis";
import {
  ChatAnalysisWorkerError,
  runChatAnalysisWorker,
} from "./analysis/chatAnalysisWorkerClient";
import {
  mergeCandidateAudioEventEvidence,
  type CandidateAudioEventEvidenceById,
} from "./analysis/candidateAudioEventEvidenceState";
import {
  buildCandidateAudioEventPresentation,
} from "./analysis/candidateAudioEventPresentation";
import {
  buildCandidateEvidenceExplanationWithFallback,
  resolveCandidateEvidenceReplayTarget,
} from "./analysis/candidateEvidenceExplanation";
import {
  CANDIDATE_AUDIO_EVENT_MODEL_DTYPE,
  CANDIDATE_AUDIO_EVENT_MODEL_ID,
  CANDIDATE_AUDIO_EVENT_MODEL_REVISION,
  CANDIDATE_AUDIO_EVENT_PROTOCOL_VERSION,
  CANDIDATE_AUDIO_EVENT_RUNTIME_DEVICE,
  CandidateAudioEventWorkerError,
  runCandidateAudioEventWorker,
  type CandidateAudioEventCandidateGap,
  type CandidateAudioEventCandidateProgress,
  type CandidateAudioEventModelProgress,
  type CandidateAudioEventWorkerIdentity,
} from "./analysis/candidateAudioEventWorkerClient";
import {
  buildCandidatePassBEvidence,
  selectCandidatePassBTargets,
  type CandidatePassBTarget as CandidatePassBCoreTarget,
} from "./analysis/candidatePassB";
import { buildCandidatePassBPresentation } from "./analysis/candidatePassBPresentation";
import { mapWithConcurrency } from "./analysis/boundedAsyncMap";
import {
  estimateCandidatePassBCost,
  formatEstimatedUsd,
} from "./analysis/candidatePassBCost";
import { createAnalysisBudgetEnvelope } from "./analysis/analysisBudgetPolicy";
import { AI_BROADCAST_CONTEXT_ROUTING_REVISION } from "./analysis/aiModelRoutingPolicy";
import {
  createCaptionDiscoveredLeadRefinementPlan,
  createDiscoveredLeadRefinementChapters,
  createDiscoveredLeadRefinementPlan,
  materializeRefinedDiscoveredLeadEvidence,
  refineDiscoveredLeadRange,
} from "./analysis/discoveredLeadRefinement";
import {
  createBroadcastContextSamplingPlan,
  createBroadcastContextTranscriptionChunks,
  subtractBroadcastContextCoveredRanges,
} from "./analysis/broadcastContextSamplingPlan";
import {
  createDistributedTimelineRevealOrder,
  createDistributedTranscriptExplorationOrder,
} from "./analysis/broadcastContextExploration";
import {
  createBroadcastTranscriptChapters,
  mergeBroadcastTranscriptChapters,
} from "./analysis/broadcastTranscriptChapters";
import { compactBroadcastContextChapters } from "./analysis/broadcastContextChapterCompaction";
import { requestBroadcastContextDeepseek } from "./analysis/broadcastContextDeepseekClient";
import {
  parsePersistedBroadcastContextResult,
  unpackPersistedBroadcastContext,
} from "./analysis/broadcastContextPersistence";
import {
  buildBroadcastContextTimelinePresentation,
  semanticChapterFamily,
  semanticChapterFamilyLabel,
  type BroadcastContextUiStatus,
} from "./analysis/broadcastContextTimelinePresentation";
import { buildSourceReadyTimelineTicks } from "./analysis/sourceReadyTimelinePresentation";
import {
  runBroadcastTranscriptWorker,
} from "./analysis/broadcastTranscriptWorkerClient";
import type { BroadcastTranscriptWorkerProgress } from "./analysis/broadcastTranscriptWorkerProtocol";
import {
  BROADCAST_TRANSCRIPT_ACTIVE_MODEL_REVISION,
  BROADCAST_TRANSCRIPT_MIXED_CHECKPOINT_MODEL_REVISION,
  BROADCAST_TRANSCRIPT_PREVIOUS_ACTIVE_MODEL_REVISION,
  type BroadcastTranscriptQwenResult,
} from "./analysis/broadcastTranscriptQwen";
import {
  YOUTUBE_CAPTION_MODEL_REVISION,
  createYouTubeCaptionChapters,
  createYouTubeCaptionRefinementTranscripts,
  type YouTubeCaptionTrackResult,
  youtubeVideoIdFromSourceName,
} from "./analysis/youtubeCaptionTrack";
import { requestYouTubeCaptionTrack } from "./analysis/youtubeCaptionClient";
import {
  chzzkVideoNoFromSourceName,
  requestChzzkVideoChannel,
} from "./analysis/chzzkVideoChannel";
import type { AnalysisLanguage } from "./domain/analysisLanguage";
import {
  captionTextForRange,
  chapterTextForRange,
  isExplicitMusicOnlyCaption,
} from "./analysis/captionCandidateEvidence";
import {
  produceCandidateVideoFrameBundles,
  type CandidateVideoFrameBundleResult,
} from "./analysis/candidateVideoFrames";
import {
  candidatePassBCastRosterIdForSourceName,
  canonicalCandidatePassBCastDisplayName,
} from "./analysis/participantRoster";
import {
  mergeCandidatePassBEvidence,
  type CandidatePassBEvidenceById,
} from "./analysis/candidatePassBEvidenceState";
import {
  CANDIDATE_PASS_B_ROUTING_MODEL_ID,
  CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
  CandidatePassBWorkerError,
  runCandidatePassBWorker,
  type CandidatePassBCandidateGap,
  type CandidatePassBCandidateProgress,
  type CandidatePassBModelProgress,
  type CandidatePassBTranscriptResult,
  type CandidatePassBWorkerIdentity,
} from "./analysis/candidatePassBWorkerClient";
import { isCompatibleCandidatePassBRoutingModelRevision } from "./analysis/candidatePassBWorkerProtocol";
import {
  fuseReactionHighlightCandidates,
  type UnifiedHighlightCandidate,
} from "./analysis/highlightFusion";
import { calculateTemporalEventDensity } from "./analysis/temporalPointProcess";
import {
  buildEventEpisodes,
  selectContextAwareCandidates,
} from "./analysis/contextAwareCandidateSelection";
import {
  finalizeContextQualifiedCandidates,
  type CandidateAiProjectionById,
} from "./analysis/contextQualifiedFinalSelection";
import { buildCandidatePassBContextPackets } from "./analysis/candidateContextPackets";
import {
  createCandidatePassBVerificationReceipt,
  finalizeFullyVerifiedCandidates,
} from "./analysis/candidateFinalVerification";
import { buildBroadcastSummaryCitationPresentation } from "./analysis/broadcastSummaryCitations";
import type {
  BroadcastContextCandidateInput,
  BroadcastContextChapterInput,
  BroadcastContextResult,
  BroadcastContextSemanticChapter,
} from "./analysis/broadcastContextProtocol";
import { buildHighlightNarrative } from "./analysis/highlightNarrative";
import {
  BROADCAST_TOPICAL_DISCOVERY_VERSION,
  MAX_TOPICAL_REFINEMENT_CONCURRENCY,
  MAX_TOPICAL_REFINEMENT_LEADS,
  createBroadcastTopicalLeadJuryPlan,
  createParallelBroadcastTopicalDiscoverySlices,
  mergeBroadcastTopicalDiscoveryLeads,
  selectBroadcastTopicalJuryApprovedLeadIds,
  selectBroadcastTopicalRefinementLeadIds,
} from "./analysis/broadcastTopicalDiscovery";
import {
  createSemanticLeadCandidate,
  parseSemanticLeadCandidates,
  serializeSemanticLeadCandidates,
} from "./analysis/semanticLeadCandidate";
import {
  CANDIDATE_RANKING_MAX_CANDIDATES,
  buildCandidateRankingProposal,
  createCandidateRankingFingerprints,
  type CandidateRankingFingerprints,
} from "./analysis/candidateRanking";
import {
  createAnalysisRun,
  reduceAnalysisRun,
  type AnalysisRunState,
} from "./domain/analysisRun";
import { deriveAnalysisControlState } from "./domain/analysisControlState";
import { deriveCandidateReviewFeatureAvailability } from "./domain/candidateReviewFeatureAvailability";
import {
  createCandidateAudioEventRun,
  reduceCandidateAudioEventRun,
  summarizeCandidateAudioEventRun,
  type CandidateAudioEventRunEvent,
  type CandidateAudioEventRunState,
  type CandidateAudioEventWorkerEventPayload,
} from "./domain/candidateAudioEventRun";
import {
  createCandidatePassBRun,
  reduceCandidatePassBRun,
  summarizeCandidatePassBRun,
  type CandidatePassBRunEvent,
  type CandidatePassBRunState,
  type CandidatePassBWorkerEventPayload,
} from "./domain/candidatePassBRun";
import {
  applyCandidateBoundaryCommand,
  BOUNDARY_NUDGE_MS,
  candidateRangeWasAdjusted,
  createCandidateBoundaryRevision,
  effectiveCandidateRange,
  type CandidateBoundaryCommand,
  type CandidateBoundaryRevision,
} from "./domain/candidateBoundaryRevision";
import {
  candidateRankingViewHasSessionWork,
  createCandidateRankingViewState,
  transitionCandidateRankingView,
} from "./domain/candidateRankingView";
import {
  createSourceCheck,
  reduceSourceCheck,
  type SourceCheckResultKind,
  type SourceCheckState,
} from "./domain/sourceCheck";
import {
  createHighlightClipboardText,
  createHighlightExportFile,
  type ApprovedHighlightExportCandidate,
  type HighlightExportFormat,
  type HighlightExportRequest,
} from "./exports/highlightExport";
import {
  analyzeLocalAudioReactions,
  LocalAudioReactionAnalysisError,
  type LocalAudioReactionAnalysisProgress,
} from "./media/localAudioReactionAnalysis";
import {
  formatBytes,
  formatDuration,
  inspectLocalMedia,
  LocalMediaPreflightError,
  type LocalMediaPreflightResult,
} from "./media/localMediaPreflight";
import {
  analyzeLocalVideoVisuals,
  LocalVideoVisualAnalysisError,
  type LocalVideoVisualAnalysisProgress,
} from "./media/localVideoVisualAnalysis";
import type { ClipRenderProgress } from "./media/clipRenderer";
import { createContentFingerprint } from "./security/contentFingerprint";
import {
  createLocalFileFingerprint,
  LocalFileFingerprintError,
} from "./security/localFileFingerprint";
import {
  AnalysisResultStoreError,
  IndexedDbAnalysisResultStore,
  type AnalysisResultStore,
  type SourceCapabilitySnapshotRecord,
} from "./storage/analysisResultStore";
import { BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION } from "./storage/broadcastContextSessionStore";
import {
  durableCoverageDisposition,
  DURABLE_AUDIO_GAP_ID,
  DURABLE_CHAT_GAP_ID,
  DURABLE_SIGNAL_GAP_POLICY_ID,
  expectedBrowserCapabilitySignature,
  type DurableAnalysisCoverageSummary,
  type DurableAnalysisGapApprovalEvidence,
  type DurableAnalysisInputDescriptor,
  type DurableAnalysisSelectionSummary,
  type DurableFinalResultPayload,
  type DurableGapApprovalRecord,
} from "./storage/durableAnalysisPayload";
import {
  auditRecoverableAnalysisResults,
  type RecoverableAnalysisResult,
} from "./storage/recoverableAnalysisResults";
import {
  CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION,
  type CandidatePassBInsightsRecord,
} from "./storage/candidatePassBInsightStore";
import type {
  CandidatePassBVideoFrame,
} from "./analysis/candidatePassBWorkerProtocol";

import {
  SourceRebindMismatchError,
  type AudioAnalysisOutcome,
  type BroadcastTranscriptExplorationCell,
  type BroadcastTranscriptExplorationCellState,
  type CandidateBoundaryFeedback,
  type CandidateGeminiInsightById,
  type CandidatePassBModelById,
  type CandidatePassBVerificationReceiptById,
  type CandidateRankingFeedback,
  type CandidateReviewState,
  type CandidateTimelineFramesById,
  type CandidateTimelineScorePoint,
  type CandidateTimelineThumbnailById,
  type ChatAnalysisOutcome,
  type ClipBatchStatus,
  type ClipDownloadErrorById,
  type ClipDownloadProgressById,
  type ClipDownloadStatusById,
  type RecoveryCatalogState,
  type ReviewUndoState,
  type ReviewedCandidate,
  type Theme,
  type TimelineInspectionTarget,
} from "./app/appViewTypes";
import {
  buildCandidateTimelineScorePoints,
  createChapterExplorationCells,
  createTranscriptExplorationCells,
  firstTimelineFrameById,
  timelineSignalLabel,
} from "./app/timelineProjection";
import {
  analysisRunLabel,
  assessLink,
  boundaryRejectionMessage,
  candidateAudioEventGapStatusLabel,
  candidateEvidenceUnknownLabel,
  candidateRankingReasonText,
  candidateRankingTranscriptNote,
  explainAnalysisError,
  explainCandidateAudioEventError,
  explainCandidatePassBError,
  explainClipRenderError,
  explainPreflightError,
  semanticLeadCategoryLabel,
  sourceCheckLabel,
} from "./app/statusMessages";
import {
  candidateAudioEventRunFailureReason,
  candidatePassBFailureReason,
  candidatePassBNoClearReason,
  candidatePassBRunFailureReason,
  durableAudioGapReasonForError,
} from "./app/runFailureCodes";
import {
  createDurableSourceDescriptor,
  hydrateDurableCandidate,
  toDurableCandidate,
} from "./app/durableCandidateMapping";
import {
  applyAnalysisEvent,
  applySourceEvent,
  candidateElementId,
  createOperationId,
  initialAnalysisLanguage,
  initialTheme,
  triggerClipDownload,
} from "./app/browserEnvironment";
import { ReviewUndoToast } from "./app/components/ReviewUndoToast";
import { ShortcutHelpOverlay } from "./app/components/ShortcutHelpOverlay";
import {
  isPipelineGap,
  summarizeFinalVerificationGaps,
} from "./app/finalVerificationGapSummary";
import {
  canStartTranscriptRun,
  transcriptOperationKey,
  transcriptPhaseFor,
} from "./app/transcriptPhase";
import {
  estimateRemainingMs,
  formatRemainingLabel,
} from "./app/progressEstimate";
import { candidateStripPositionPercent } from "./app/positionStrip";
import {
  nextUnreviewedCandidateId,
  reviewDecisionAdvances,
} from "./app/reviewNavigation";
import {
  useReviewShortcuts,
  type DossierTab,
} from "./app/useReviewShortcuts";

type AnalysisSelectionSummary = DurableAnalysisSelectionSummary;
type AnalysisCoverageSummary = DurableAnalysisCoverageSummary;
type AnalysisGapApprovalEvidence = DurableAnalysisGapApprovalEvidence;

const APP_VERSION = "0.4.6";
const PERSISTENCE_SCHEMA_VERSION = "0.3.0";
const SIGNAL_ENGINE_VERSION =
  "streamer-reaction-fast-pass-v5-chat-fallback-music-confirmation";
const MAX_CHAT_FILE_BYTES = 32 * 1024 * 1024;
const SIGNAL_GAP_POLICY_ID = DURABLE_SIGNAL_GAP_POLICY_ID;

function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [analysisLanguage, setAnalysisLanguage] = useState<AnalysisLanguage>(
    initialAnalysisLanguage,
  );
  const ui = (ko: string, en: string): string =>
    analysisLanguage === "ko" ? ko : en;
  const [isDragging, setIsDragging] = useState(false);
  const [pendingFileName, setPendingFileName] = useState<string | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [resolvedSourceChannelId, setResolvedSourceChannelId] = useState<
    string | null
  >(null);
  const sourceDescriptor = `${sourceFile?.name ?? pendingFileName ?? ""} ${sourceUrl}`;
  const sourceChzzkVideoNo = useMemo(
    () => chzzkVideoNoFromSourceName(sourceDescriptor),
    [sourceDescriptor],
  );
  const sourceCastRosterId = useMemo(
    () => sourceFile === null && pendingFileName === null
      ? null
      : candidatePassBCastRosterIdForSourceName(
        `${sourceDescriptor} ${resolvedSourceChannelId ?? ""}`,
      ),
    [pendingFileName, resolvedSourceChannelId, sourceDescriptor, sourceFile],
  );
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState<string | null>(null);
  const [sourceCheck, setSourceCheck] = useState<SourceCheckState | null>(null);
  const [preflight, setPreflight] = useState<LocalMediaPreflightResult | null>(null);
  const [sourceContentFingerprint, setSourceContentFingerprint] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  const [chatImport, setChatImport] = useState<ChatImportResult | null>(null);
  const [chatContentFingerprint, setChatContentFingerprint] = useState<string | null>(null);
  const [chatFileName, setChatFileName] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatImportStatus, setChatImportStatus] = useState<
    "idle" | "reading" | "ready" | "failed"
  >("idle");
  const [chatOffsetSeconds, setChatOffsetSeconds] = useState(0);
  const [analysisStartPending, setAnalysisStartPending] = useState(false);
  const [analysisCancelPending, setAnalysisCancelPending] = useState(false);
  const [analysisCommitPending, setAnalysisCommitPending] = useState(false);
  const [analysisRun, setAnalysisRun] = useState<AnalysisRunState | null>(null);
  const [selectionResult, setSelectionResult] = useState<AnalysisSelectionSummary | null>(null);
  const [candidates, setCandidates] = useState<readonly ReviewedCandidate[]>([]);
  const [boundarySessionId, setBoundarySessionId] = useState(() =>
    createOperationId("boundary-session"),
  );
  const [boundaryRevisions, setBoundaryRevisions] = useState<
    Readonly<Record<string, CandidateBoundaryRevision>>
  >({});
  const [boundaryFeedback, setBoundaryFeedback] =
    useState<CandidateBoundaryFeedback | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<LocalVideoVisualAnalysisProgress | null>(null);
  const [audioAnalysisProgress, setAudioAnalysisProgress] =
    useState<LocalAudioReactionAnalysisProgress | null>(null);
  /**
   * Wall-clock anchor for the fast-scan ETA. A ref (not state) because it is
   * read once per tick rather than driving its own render; the tick below
   * is what causes the elapsed-time label to advance.
   */
  const analysisStartedAtMsRef = useRef<number | null>(null);
  const [progressClockNowMs, setProgressClockNowMs] = useState<number | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [candidatePassBRun, setCandidatePassBRun] =
    useState<CandidatePassBRunState | null>(null);
  const [candidatePassBEvidenceById, setCandidatePassBEvidenceById] =
    useState<CandidatePassBEvidenceById>({});
  const [candidateGeminiInsightById, setCandidateGeminiInsightById] =
    useState<CandidateGeminiInsightById>({});
  const [candidateTimelineFramesById, setCandidateTimelineFramesById] =
    useState<CandidateTimelineFramesById>({});
  const [candidatePassBVerificationReceiptById, setCandidatePassBVerificationReceiptById] =
    useState<CandidatePassBVerificationReceiptById>({});
  const [candidateTimelineScorePoints, setCandidateTimelineScorePoints] =
    useState<readonly CandidateTimelineScorePoint[]>([]);
  const [timelineSemanticChapters, setTimelineSemanticChapters] =
    useState<readonly BroadcastContextSemanticChapter[]>([]);
  const [timelineSemanticChapterRevealCount, setTimelineSemanticChapterRevealCount] =
    useState(0);
  const [timelineInspectionTarget, setTimelineInspectionTarget] =
    useState<TimelineInspectionTarget | null>(null);
  const [broadcastTranscriptStatus, setBroadcastTranscriptStatus] = useState<
    "idle" | "running" | "completed" | "completedWithGaps" | "failed"
  >("idle");
  const [broadcastTranscriptProgress, setBroadcastTranscriptProgress] =
    useState<BroadcastTranscriptWorkerProgress | null>(null);
  const [broadcastTranscriptExplorationCells, setBroadcastTranscriptExplorationCells] =
    useState<readonly BroadcastTranscriptExplorationCell[]>([]);
  const [broadcastTranscriptChapters, setBroadcastTranscriptChapters] =
    useState<readonly BroadcastContextChapterInput[]>([]);
  const [youtubeCaptionTrack, setYouTubeCaptionTrack] =
    useState<YouTubeCaptionTrackResult | null>(null);
  const [broadcastTranscriptError, setBroadcastTranscriptError] =
    useState<string | null>(null);
  const [broadcastContextStatus, setBroadcastContextStatus] =
    useState<BroadcastContextUiStatus>("idle");
  const [broadcastContextResult, setBroadcastContextResult] =
    useState<BroadcastContextResult | null>(null);
  const [candidateAiProjectionById, setCandidateAiProjectionById] =
    useState<CandidateAiProjectionById>({});
  const [broadcastContextRefinementLeadIds, setBroadcastContextRefinementLeadIds] =
    useState<readonly string[] | null>(null);
  const [broadcastContextFastRefinementLeadIds, setBroadcastContextFastRefinementLeadIds] =
    useState<readonly string[] | null>(null);
  const [broadcastContextError, setBroadcastContextError] = useState<string | null>(null);
  const [semanticLeadRefinementStatus, setSemanticLeadRefinementStatus] = useState<
    "idle" | "running" | "completed" | "failed"
  >("idle");
  const [semanticLeadRefinementError, setSemanticLeadRefinementError] =
    useState<string | null>(null);
  const candidatePassBEvidenceRef = useRef<CandidatePassBEvidenceById>({});
  const candidateGeminiInsightRef = useRef<CandidateGeminiInsightById>({});
  const candidatePassBModelByIdRef = useRef<CandidatePassBModelById>({});
  const candidateTimelineFramesRef = useRef<CandidateTimelineFramesById>({});
  const candidatePassBVerificationReceiptRef =
    useRef<CandidatePassBVerificationReceiptById>({});
  const candidatePassBInsightWriteChainRef = useRef<Promise<void>>(Promise.resolve());
  const candidatePassBInsightWriteEpochRef = useRef(0);
  const [candidatePassBModelProgress, setCandidatePassBModelProgress] =
    useState<CandidatePassBModelProgress | null>(null);
  const [candidatePassBCandidateProgress, setCandidatePassBCandidateProgress] =
    useState<CandidatePassBCandidateProgress | null>(null);
  const [candidatePassBActiveCandidateIds, setCandidatePassBActiveCandidateIds] =
    useState<readonly string[]>([]);
  const [candidatePassBError, setCandidatePassBError] = useState<string | null>(null);
  const [candidatePassBStartPending, setCandidatePassBStartPending] = useState(false);
  const [candidateAudioEventRun, setCandidateAudioEventRun] =
    useState<CandidateAudioEventRunState | null>(null);
  const [candidateAudioEventEvidenceById, setCandidateAudioEventEvidenceById] =
    useState<CandidateAudioEventEvidenceById>({});
  const [candidateAudioEventModelProgress, setCandidateAudioEventModelProgress] =
    useState<CandidateAudioEventModelProgress | null>(null);
  const [candidateAudioEventCandidateProgress, setCandidateAudioEventCandidateProgress] =
    useState<CandidateAudioEventCandidateProgress | null>(null);
  const [candidateAudioEventError, setCandidateAudioEventError] =
    useState<string | null>(null);
  const [candidateAudioEventStartPending, setCandidateAudioEventStartPending] =
    useState(false);
  const [candidateRankingView, setCandidateRankingView] = useState(() =>
    createCandidateRankingViewState({
      rankingSessionId: createOperationId("ranking-session"),
      candidateSetFingerprint: "candidate-set-empty",
      evidenceFingerprint: "ranking-evidence-empty",
      canonicalOrderIds: [],
    }),
  );
  const [candidateRankingFeedback, setCandidateRankingFeedback] =
    useState<CandidateRankingFeedback | null>(null);
  const [lastExportFormat, setLastExportFormat] =
    useState<HighlightExportFormat | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [exportError, setExportError] = useState<string | null>(null);
  const [previewCandidateId, setPreviewCandidateId] = useState<string | null>(null);
  const [previewPreparedCandidateId, setPreviewPreparedCandidateId] =
    useState<string | null>(null);
  const [reviewUndo, setReviewUndo] = useState<ReviewUndoState | null>(null);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  /** Bottom sheet holding the full broadcast map (former always-visible timeline). */
  const [mapSheetOpen, setMapSheetOpen] = useState(false);
  /**
   * Which dossier tab is showing. This is a view state that persists across
   * candidates on purpose: flipping through candidates with the same tab open
   * (e.g. comparing "단서" across several) is the whole reason tabs were
   * chosen over a one-off popover. It never affects candidate data, score,
   * boundaries or review state.
   */
  const [dossierTab, setDossierTab] = useState<DossierTab>("summary");
  const [clipDownloadStatusById, setClipDownloadStatusById] =
    useState<ClipDownloadStatusById>({});
  const [clipDownloadErrorById, setClipDownloadErrorById] =
    useState<ClipDownloadErrorById>({});
  const [clipDownloadProgressById, setClipDownloadProgressById] =
    useState<ClipDownloadProgressById>({});
  const [clipBatchStatus, setClipBatchStatus] = useState<ClipBatchStatus>("idle");
  const [clipBatchCompletedCount, setClipBatchCompletedCount] = useState(0);
  const [clipBatchError, setClipBatchError] = useState<string | null>(null);
  const [recoveryCatalog, setRecoveryCatalog] = useState<RecoveryCatalogState>({
    status: "loading",
  });
  const [openedRecoveredResult, setOpenedRecoveredResult] =
    useState<RecoverableAnalysisResult | null>(null);
  const sourceSelectionEpoch = useRef(0);
  const chatSelectionEpoch = useRef(0);
  const sourceAbortController = useRef<AbortController | null>(null);
  const analysisAbortController = useRef<AbortController | null>(null);
  const candidatePassBAbortController = useRef<AbortController | null>(null);
  const broadcastTranscriptAbortController = useRef<AbortController | null>(null);
  const broadcastContextAbortController = useRef<AbortController | null>(null);
  const semanticLeadRefinementAbortController = useRef<AbortController | null>(null);
  const candidateAudioEventAbortController = useRef<AbortController | null>(null);
  const analysisStartOperation = useRef<number | null>(null);
  const analysisOperationEpoch = useRef(0);
  const candidatePassBOperationEpoch = useRef(0);
  const candidatePassBStartPendingRef = useRef(false);
  const autoCandidatePassBSourceRef = useRef<string | null>(null);
  const autoBroadcastTranscriptSourceRef = useRef<string | null>(null);
  const autoBroadcastContextSourceRef = useRef<string | null>(null);
  const autoSemanticLeadRefinementSourceRef = useRef<string | null>(null);
  const recoveredContextRestoreEpoch = useRef(0);
  const runCandidatePassBRef = useRef<
    (targetCandidateIds?: readonly string[]) => Promise<void>
  >(() => Promise.resolve());
  const candidatePassBMachine = useRef<CandidatePassBRunState | null>(null);
  const candidatePassBIdentity = useRef<CandidatePassBWorkerIdentity | null>(null);
  const candidateAudioEventOperationEpoch = useRef(0);
  const candidateAudioEventStartPendingRef = useRef(false);
  const candidateAudioEventMachine = useRef<CandidateAudioEventRunState | null>(null);
  const candidateAudioEventIdentity = useRef<CandidateAudioEventWorkerIdentity | null>(null);
  const candidateRankingRevision = useRef(0);
  const recoveryOperationEpoch = useRef(0);
  const [appSessionId] = useState(() => createOperationId("session"));
  const [writerEpoch] = useState(() => Date.now());
  const resultStore = useRef<AnalysisResultStore | null>(null);
  const sourcePreviewUrlRef = useRef<string | null>(null);
  const previewVideo = useRef<HTMLVideoElement | null>(null);
  const previewRequestedCandidateIdRef = useRef<string | null>(null);
  const previewPreparedCandidateIdRef = useRef<string | null>(null);
  const previewPlayAfterPrepareRef = useRef<string | null>(null);
  const lastWorkspacePreviewCue = useRef<string | null>(null);
  const clipRenderAbortController = useRef<AbortController | null>(null);
  const sourceHeading = useRef<HTMLHeadingElement | null>(null);
  const reconnectSourceInput = useRef<HTMLInputElement | null>(null);
  const analysisHeading = useRef<HTMLHeadingElement | null>(null);
  const candidateHeading = useRef<HTMLHeadingElement | null>(null);
  const exportHeading = useRef<HTMLHeadingElement | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      globalThis.localStorage?.setItem("retto-theme", theme);
    } catch {
      // Keep the selected theme for this tab even when persistence is blocked.
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = analysisLanguage;
    try {
      globalThis.localStorage?.setItem("exclipper-language", analysisLanguage);
    } catch {
      // Keep the selected language for this tab when persistence is blocked.
    }
  }, [analysisLanguage]);

  useEffect(() => {
    setResolvedSourceChannelId(null);
    if (sourceChzzkVideoNo === null) return undefined;
    const controller = new AbortController();
    void requestChzzkVideoChannel(sourceChzzkVideoNo, {
      signal: controller.signal,
    })
      .then((channelId) => {
        if (!controller.signal.aborted) setResolvedSourceChannelId(channelId);
      })
      .catch(() => {
        // Channel grounding improves identity precision but must never block a
        // local analysis when CHZZK metadata is temporarily unavailable.
      });
    return () => controller.abort();
  }, [sourceChzzkVideoNo]);

  useEffect(
    () => {
      isMounted.current = true;
      return () => {
        isMounted.current = false;
        sourceSelectionEpoch.current += 1;
        chatSelectionEpoch.current += 1;
        analysisOperationEpoch.current += 1;
        recoveryOperationEpoch.current += 1;
        sourceAbortController.current?.abort();
        sourceAbortController.current = null;
        analysisAbortController.current?.abort();
        analysisAbortController.current = null;
        candidatePassBOperationEpoch.current += 1;
        candidatePassBAbortController.current?.abort();
        candidatePassBAbortController.current = null;
        broadcastTranscriptAbortController.current?.abort();
        broadcastTranscriptAbortController.current = null;
        broadcastContextAbortController.current?.abort();
        broadcastContextAbortController.current = null;
        semanticLeadRefinementAbortController.current?.abort();
        semanticLeadRefinementAbortController.current = null;
        candidatePassBMachine.current = null;
        candidatePassBIdentity.current = null;
        candidateAudioEventOperationEpoch.current += 1;
        candidateAudioEventAbortController.current?.abort();
        candidateAudioEventAbortController.current = null;
        candidateAudioEventMachine.current = null;
        candidateAudioEventIdentity.current = null;
        clipRenderAbortController.current?.abort();
        clipRenderAbortController.current = null;
        resultStore.current?.close();
        resultStore.current = null;
        if (sourcePreviewUrlRef.current !== null) {
          URL.revokeObjectURL(sourcePreviewUrlRef.current);
          sourcePreviewUrlRef.current = null;
        }
      };
    },
    [],
  );

  useEffect(() => {
    const heading = candidateHeading.current;
    if (selectionResult === null || heading === null) {
      return;
    }
    const focusTimer = globalThis.setTimeout(() => {
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ behavior: "auto", block: "start" });
    }, 0);
    return () => globalThis.clearTimeout(focusTimer);
  }, [candidates.length, selectionResult]);

  const replaceSourceFile = useCallback((file: File | null): void => {
    if (!isMounted.current) {
      return;
    }
    clipRenderAbortController.current?.abort();
    clipRenderAbortController.current = null;
    candidateTimelineFramesRef.current = {};
    setCandidateTimelineFramesById({});
    candidatePassBVerificationReceiptRef.current = {};
    setCandidatePassBVerificationReceiptById({});
    setCandidateTimelineScorePoints([]);
    setTimelineSemanticChapters([]);
    setTimelineSemanticChapterRevealCount(0);
    setTimelineInspectionTarget(null);
    setBroadcastTranscriptExplorationCells([]);
    setYouTubeCaptionTrack(null);
    setClipDownloadStatusById({});
    setClipDownloadErrorById({});
    setClipDownloadProgressById({});
    setClipBatchStatus("idle");
    setClipBatchCompletedCount(0);
    setClipBatchError(null);
    if (sourcePreviewUrlRef.current !== null) {
      URL.revokeObjectURL(sourcePreviewUrlRef.current);
      sourcePreviewUrlRef.current = null;
    }
    setSourceFile(file);
    if (file === null) {
      setSourcePreviewUrl(null);
      return;
    }
    try {
      const objectUrl = URL.createObjectURL(file);
      sourcePreviewUrlRef.current = objectUrl;
      setSourcePreviewUrl(objectUrl);
    } catch {
      setSourcePreviewUrl(null);
    }
  }, []);

  const getResultStore = useCallback((): AnalysisResultStore => {
    resultStore.current ??= new IndexedDbAnalysisResultStore();
    return resultStore.current;
  }, []);

  const refreshRecoveryCatalog = useCallback(async (): Promise<void> => {
    const epoch = recoveryOperationEpoch.current + 1;
    recoveryOperationEpoch.current = epoch;
    if (isMounted.current) {
      setRecoveryCatalog({ status: "loading" });
    }
    try {
      const audit = await auditRecoverableAnalysisResults(getResultStore(), 5);
      if (isMounted.current && recoveryOperationEpoch.current === epoch) {
        setRecoveryCatalog({ status: "ready", audit });
      }
    } catch {
      if (isMounted.current && recoveryOperationEpoch.current === epoch) {
        setRecoveryCatalog({ status: "failed" });
      }
    }
  }, [getResultStore]);

  useEffect(() => {
    void refreshRecoveryCatalog();
  }, [refreshRecoveryCatalog]);

  const sourceReady =
    sourceCheck?.status === "completed" &&
    sourceCheck.resultKind !== "blocked" &&
    preflight !== null &&
    sourceFile !== null;
  const sourceReadyTimelineTicks = useMemo(
    () => buildSourceReadyTimelineTicks(preflight?.metadata.durationMs ?? 0),
    [preflight?.metadata.durationMs],
  );
  const analysisComplete =
    openedRecoveredResult !== null ||
    analysisRun?.status === "completed" ||
    analysisRun?.status === "completedWithGaps";
  const { analysisBusy, analysisCanBeCancelled } = deriveAnalysisControlState({
    analysisStartPending,
    analysisCancelPending,
    analysisCommitPending,
    runStatus: analysisRun?.status ?? null,
  });
  useEffect(() => {
    if (!analysisBusy) {
      analysisStartedAtMsRef.current = null;
      setProgressClockNowMs(null);
      return;
    }
    if (analysisStartedAtMsRef.current === null) {
      analysisStartedAtMsRef.current = Date.now();
    }
    setProgressClockNowMs(Date.now());
    const timer = globalThis.setInterval(() => {
      setProgressClockNowMs(Date.now());
    }, 4_000);
    return () => globalThis.clearInterval(timer);
  }, [analysisBusy]);
  const candidatePassBBusy =
    candidatePassBStartPending ||
    (candidatePassBRun !== null &&
      ["preparing", "loadingModel", "transcribing", "finalizing", "cancelling"].includes(
        candidatePassBRun.status,
      ));
  const candidatePassBSummary =
    candidatePassBRun === null ? null : summarizeCandidatePassBRun(candidatePassBRun);
  const candidatePassBProgressRatio =
    candidatePassBRun !== null &&
    ["completed", "completedWithGaps"].includes(candidatePassBRun.status)
      ? 1
      : candidatePassBCandidateProgress !== null
        ? Math.min(
            1,
            Math.max(
              0,
              0.2 +
                ((candidatePassBCandidateProgress.candidateOrdinal - 1 +
                  candidatePassBCandidateProgress.ratio) /
                  candidatePassBCandidateProgress.targetCount) *
                  0.8,
            ),
          )
        : candidatePassBRun?.status === "transcribing"
          ? 0.2
          : (candidatePassBModelProgress?.ratio ?? 0) * 0.2;
  const candidatePassBCurrentOrdinal =
    candidatePassBCandidateProgress?.candidateOrdinal ??
    (candidatePassBSummary === null
      ? 1
      : Math.min(
          candidatePassBSummary.totalCandidateCount,
          candidatePassBSummary.totalCandidateCount - candidatePassBSummary.pendingCount + 1,
        ));
  const candidatePassBStatusText =
    candidatePassBStartPending
      ? "AI가 후보 오디오와 대표 화면을 함께 준비하고 있어요."
      : candidatePassBRun === null
      ? "빠르게 찾은 후보는 지금 바로 검토할 수 있어요. 원할 때 AI로 한국어 대사와 사건 단서를 더 붙여 보세요."
      : candidatePassBRun.status === "idle" || candidatePassBRun.status === "preparing"
        ? "AI 후보 분석 작업을 준비하고 있어요."
        : candidatePassBRun.status === "loadingModel"
          ? "AI 연결을 준비하고 있어요."
          : candidatePassBRun.status === "transcribing"
            ? candidatePassBActiveCandidateIds.length > 1
              ? `후보 ${candidatePassBActiveCandidateIds.length}개를 동시에 검토하고 있어요. 대표 화면이 준비되는 후보부터 바로 AI 해석을 이어갑니다.`
              : `후보 ${candidatePassBCurrentOrdinal}/${candidatePassBSummary?.totalCandidateCount ?? candidates.length}의 짧은 오디오와 대표 화면에서 한국어 대사·사건 단서를 확인하고 있어요.`
            : candidatePassBRun.status === "finalizing"
              ? "AI 답변과 후보 시간을 마지막으로 확인하고 있어요."
            : candidatePassBRun.status === "cancelling"
              ? "분석을 멈추고 현재 작업을 안전하게 정리하고 있어요."
              : candidatePassBRun.status === "completed"
                ? `후보 ${candidatePassBSummary?.clueFoundCount ?? 0}개에서 AI 한국어 대사·사건 단서를 찾았어요.`
                : candidatePassBRun.status === "completedWithGaps"
                  ? `AI 단서 ${candidatePassBSummary?.clueFoundCount ?? 0}개 후보 · 분명한 대사 없음 ${candidatePassBSummary?.noClearSpeechCount ?? 0}개 · 건너뜀 ${candidatePassBSummary?.failedCount ?? 0}개로 마쳤어요.`
                  : candidatePassBRun.status === "cancelled"
                    ? "AI 후보 분석을 멈췄어요. 이미 찾은 단서는 그대로 남아 있어요."
                     : "AI 후보 분석을 마치지 못했어요. 잠재 후보와 근거는 보존했지만 완전 검증 전에는 최종 목록에 올리지 않아요.";
  const candidatePassBDetailAnalysisLabel =
    candidatePassBStartPending
      ? "AI 준비 중"
      : candidatePassBRun === null || candidatePassBRun.status === "idle"
        ? "시작 전"
        : candidatePassBRun.status === "preparing" || candidatePassBRun.status === "loadingModel"
          ? "AI 준비 중"
          : candidatePassBRun.status === "transcribing" || candidatePassBRun.status === "finalizing"
            ? "AI 분석 중"
            : candidatePassBRun.status === "cancelling"
              ? "AI 중지 중"
              : candidatePassBRun.status === "completed"
                ? "AI 분석 완료"
                : candidatePassBRun.status === "completedWithGaps"
                  ? "AI 일부 완료"
                  : candidatePassBRun.status === "cancelled"
                    ? "AI 분석 중지"
                    : "AI 분석 실패";
  const candidateAudioEventBusy =
    candidateAudioEventStartPending ||
    (candidateAudioEventRun !== null &&
      ["preparing", "loadingModel", "classifying", "finalizing", "cancelling"].includes(
        candidateAudioEventRun.status,
      ));
  const candidateAudioEventSummary =
    candidateAudioEventRun === null
      ? null
      : summarizeCandidateAudioEventRun(candidateAudioEventRun);
  const candidateAudioEventProgressRatio =
    candidateAudioEventRun !== null &&
    ["completed", "completedWithGaps"].includes(candidateAudioEventRun.status)
      ? 1
      : candidateAudioEventCandidateProgress !== null
        ? Math.min(
            1,
            Math.max(
              0,
              0.2 +
                ((candidateAudioEventCandidateProgress.candidateOrdinal - 1 +
                  candidateAudioEventCandidateProgress.ratio) /
                  candidateAudioEventCandidateProgress.targetCount) *
                  0.8,
            ),
          )
        : candidateAudioEventRun?.status === "classifying"
          ? 0.2
          : (candidateAudioEventModelProgress?.ratio ?? 0) * 0.2;
  const candidateAudioEventCurrentOrdinal =
    candidateAudioEventCandidateProgress?.candidateOrdinal ??
    (candidateAudioEventSummary === null
      ? 1
      : Math.min(
          candidateAudioEventSummary.totalCandidateCount,
          candidateAudioEventSummary.totalCandidateCount -
            candidateAudioEventSummary.pendingCount +
            1,
        ));
  const candidateAudioEventStatusText =
    candidateAudioEventStartPending
      ? "후보 반응 종류 AI를 준비하고 있어요."
      : candidateAudioEventRun === null
        ? "먼저 찾은 후보에서 웃음·고함·비명·박수/환호처럼 들리는 구간을 더 살펴볼 수 있어요."
        : candidateAudioEventRun.status === "idle" ||
            candidateAudioEventRun.status === "preparing"
          ? "반응 종류 AI 작업 공간을 준비하고 있어요."
          : candidateAudioEventRun.status === "loadingModel"
            ? "반응 종류 AI 파일을 준비하고 있어요. 첫 실행이 가장 오래 걸릴 수 있어요."
            : candidateAudioEventRun.status === "classifying"
              ? `후보 ${candidateAudioEventCurrentOrdinal}/${candidateAudioEventSummary?.totalCandidateCount ?? candidates.length}의 반응 종류를 듣고 있어요.`
              : candidateAudioEventRun.status === "finalizing"
                ? "모든 후보의 반응 종류 결과를 마지막으로 확인하고 있어요."
                : candidateAudioEventRun.status === "cancelling"
                  ? "현재 반응 종류 작업을 안전하게 정리하고 있어요."
                  : candidateAudioEventRun.status === "completed"
                    ? `후보 ${candidateAudioEventSummary?.detectedCount ?? 0}개에서 재생해 확인할 반응 종류 단서를 찾았어요.`
                    : candidateAudioEventRun.status === "completedWithGaps"
                      ? `반응 종류 단서 ${candidateAudioEventSummary?.detectedCount ?? 0}개 후보 · 종류 불분명 ${candidateAudioEventSummary?.noClearCount ?? 0}개 · 건너뜀 ${candidateAudioEventSummary?.failedCount ?? 0}개로 마쳤어요.`
                      : candidateAudioEventRun.status === "cancelled"
                        ? "반응 종류 찾기를 멈췄어요. 이미 찾은 단서는 그대로 남아 있어요."
                        : "반응 종류 찾기를 마치지 못했어요. 기존 후보와 대사 단서는 그대로예요.";
  const currentAnalysisRunId =
    openedRecoveredResult?.terminal.runId ?? analysisRun?.runId ?? null;
  const candidatePassBRuntimeAvailable =
    preflight !== null &&
    preflight.capabilities.worker &&
    typeof globalThis.fetch === "function";
  const candidateAudioEventRuntimeAvailable =
    preflight !== null &&
    preflight.capabilities.worker &&
    preflight.capabilities.webAssembly;
  const candidateRefinementBusy = candidatePassBBusy || candidateAudioEventBusy;
  const candidateAudioEventRankingCoverage =
    candidateAudioEventRun?.status === "completed" &&
    candidateAudioEventRun.snapshot.candidates.length === candidates.length &&
    candidates.every((candidate) =>
      candidateAudioEventRun.snapshot.candidates.some(
        ({ candidateId }) => candidateId === candidate.id,
      ) && candidateAudioEventEvidenceById[candidate.id] !== undefined,
    )
      ? "complete"
      : "incomplete";
  const candidateRankingFingerprints = useMemo<CandidateRankingFingerprints | null>(() => {
    if (candidates.length === 0) {
      return null;
    }
    try {
      return createCandidateRankingFingerprints(
        candidates,
        candidatePassBEvidenceById,
        candidateAudioEventEvidenceById,
        candidateAudioEventRankingCoverage,
      );
    } catch {
      return null;
    }
  }, [
    candidateAudioEventEvidenceById,
    candidateAudioEventRankingCoverage,
    candidatePassBEvidenceById,
    candidates,
  ]);
  const canonicalCandidateIds = useMemo(
    () => candidates.map(({ id }) => id),
    [candidates],
  );
  const rankingCandidateSetMatches =
    candidateRankingFingerprints !== null &&
    candidateRankingView.candidateSetFingerprint ===
      candidateRankingFingerprints.candidateSetFingerprint &&
    candidateRankingView.canonicalOrderIds.length === canonicalCandidateIds.length &&
    candidateRankingView.canonicalOrderIds.every(
      (candidateId, index) => candidateId === canonicalCandidateIds[index],
    );
  const rankingEvidenceMatches =
    candidateRankingFingerprints !== null &&
    candidateRankingView.evidenceFingerprint ===
      candidateRankingFingerprints.evidenceFingerprint;

  const boundarySourceDurationMs = Math.round(
    preflight?.metadata.durationMs ??
      openedRecoveredResult?.finalResult.result.input.source.durationMs ??
      0,
  );
  const candidatePassBContextById = useMemo(
    () =>
      broadcastContextStatus === "completed" &&
      semanticLeadRefinementStatus === "completed"
        ? buildCandidatePassBContextPackets({
            candidates,
            sourceDurationMs: boundarySourceDurationMs,
            broadcastContext: broadcastContextResult,
            transcriptChapters: broadcastTranscriptChapters,
            youtubeCaptionTrack,
          })
        : {},
    [
      boundarySourceDurationMs,
      broadcastContextResult,
      broadcastContextStatus,
      broadcastTranscriptChapters,
      candidates,
      semanticLeadRefinementStatus,
      youtubeCaptionTrack,
    ],
  );
  const finalCandidateVerification = useMemo(
    () =>
      finalizeFullyVerifiedCandidates({
        candidates,
        contextByCandidateId: candidatePassBContextById,
        insightByCandidateId: candidateGeminiInsightById,
        receiptByCandidateId: candidatePassBVerificationReceiptById,
      }),
    [
      candidateGeminiInsightById,
      candidatePassBContextById,
      candidatePassBVerificationReceiptById,
      candidates,
    ],
  );
  const orderedCandidates = useMemo(
    () => [...finalCandidateVerification.candidates].sort(
      (left, right) => left.peakMs - right.peakMs,
    ),
    [finalCandidateVerification.candidates],
  );
  const broadcastSummaryCitationPresentation = useMemo(
    () =>
      broadcastContextResult === null
        ? null
        : buildBroadcastSummaryCitationPresentation(
            broadcastContextResult.broadcastSummaryKo,
            orderedCandidates.map((candidate, index) => {
              const context = candidatePassBContextById[candidate.id]!;
              return {
                candidateId: candidate.id,
                candidateNumber: index + 1,
                situationKo: context.contextVerdictKo,
                topicContextKo: context.topicContextKo,
              };
            }),
          ),
    [broadcastContextResult, candidatePassBContextById, orderedCandidates],
  );
  const focusedCandidateId =
    previewCandidateId !== null &&
    orderedCandidates.some(({ id }) => id === previewCandidateId)
      ? previewCandidateId
      : orderedCandidates[0]?.id ?? null;
  const sourceCheckBusy =
    sourceCheck !== null && ["checking", "committing", "cancelling"].includes(sourceCheck.status);
  const showStatusBar =
    sourceCheck !== null ||
    sourceError !== null ||
    analysisRun !== null ||
    openedRecoveredResult !== null;
  const showRecoveryPanel =
    selectionResult === null &&
    (openedRecoveredResult !== null ||
      recoveryCatalog.status === "failed" ||
      (recoveryCatalog.status === "ready" && recoveryCatalog.audit.results.length > 0));
  const timelineAxisTicks = useMemo(() => {
    const intervalMs = 30 * 60_000;
    if (boundarySourceDurationMs <= intervalMs) return [];
    return Array.from(
      { length: Math.floor((boundarySourceDurationMs - 1) / intervalMs) },
      (_, index) => (index + 1) * intervalMs,
    );
  }, [boundarySourceDurationMs]);
  const timelineMarkerLaneById = useMemo(() => {
    const lastPositionByLane = [-Infinity, -Infinity, -Infinity];
    const laneById: Record<string, number> = {};
    for (const candidate of orderedCandidates) {
      const position =
        boundarySourceDurationMs > 0
          ? (candidate.peakMs / boundarySourceDurationMs) * 100
          : 0;
      let lane = lastPositionByLane.findIndex(
        (lastPosition) => position - lastPosition >= 2.4,
      );
      if (lane < 0) {
        lane = lastPositionByLane.indexOf(Math.min(...lastPositionByLane));
      }
      laneById[candidate.id] = lane;
      lastPositionByLane[lane] = position;
    }
    return laneById;
  }, [boundarySourceDurationMs, orderedCandidates]);
  const timelineDiscoveredLeads = broadcastContextResult?.discoveredLeads ?? [];
  const timelineSemanticChapterRevealOrder = useMemo(
    () => createDistributedTimelineRevealOrder(timelineSemanticChapters),
    [timelineSemanticChapters],
  );
  useEffect(() => {
    if (timelineSemanticChapterRevealOrder.length === 0) return;
    const revealTimer = globalThis.setInterval(() => {
      setTimelineSemanticChapterRevealCount((current) => {
        const next = Math.min(
          timelineSemanticChapterRevealOrder.length,
          current + 1,
        );
        if (next >= timelineSemanticChapterRevealOrder.length) {
          globalThis.clearInterval(revealTimer);
        }
        return next;
      });
    }, 260);
    return () => globalThis.clearInterval(revealTimer);
  }, [timelineSemanticChapterRevealOrder]);
  const visibleTimelineSemanticChapterIds = useMemo(
    () =>
      new Set(
        timelineSemanticChapterRevealOrder
          .slice(0, timelineSemanticChapterRevealCount)
          .map((chapter) => chapter.semanticChapterId),
      ),
    [timelineSemanticChapterRevealCount, timelineSemanticChapterRevealOrder],
  );
  const visibleTimelineSemanticChapters = timelineSemanticChapters.filter((chapter) =>
    visibleTimelineSemanticChapterIds.has(chapter.semanticChapterId),
  );
  const timelineTopicRevealComplete =
    timelineSemanticChapters.length === 0 ||
    timelineSemanticChapterRevealCount >= timelineSemanticChapters.length;
  const visibleTimelineDiscoveredLeads = timelineTopicRevealComplete
    ? timelineDiscoveredLeads
    : [];
  const inspectedTimelineChapter =
    timelineInspectionTarget?.kind === "chapter"
      ? timelineSemanticChapters.find(
          ({ semanticChapterId }) =>
            semanticChapterId === timelineInspectionTarget.id,
        ) ?? null
      : null;
  const inspectedTimelineLead =
    timelineInspectionTarget?.kind === "lead"
      ? timelineDiscoveredLeads.find(
          ({ leadId }) => leadId === timelineInspectionTarget.id,
        ) ?? null
      : null;
  const inspectedTimelineExploration =
    timelineInspectionTarget?.kind === "exploration"
      ? broadcastTranscriptExplorationCells.find(
          ({ chunkId }) => chunkId === timelineInspectionTarget.id,
        ) ?? null
      : null;
  const inspectedTimelineExplorationChapters =
    inspectedTimelineExploration === null
      ? []
      : broadcastTranscriptChapters.filter(
          (chapter) =>
            chapter.startMs < inspectedTimelineExploration.sourceEndMs &&
            chapter.endMs > inspectedTimelineExploration.sourceStartMs,
        );
  const inspectedTimelineSignal =
    timelineInspectionTarget?.kind === "signal"
      ? candidateTimelineScorePoints.find(
          (point) =>
            `${point.signalKind}:${point.id}` === timelineInspectionTarget.id,
        ) ?? null
      : null;
  const timelinePlayheadMs =
    inspectedTimelineChapter !== null
      ? (inspectedTimelineChapter.startMs + inspectedTimelineChapter.endMs) / 2
      : inspectedTimelineLead !== null
        ? (inspectedTimelineLead.startMs + inspectedTimelineLead.endMs) / 2
        : inspectedTimelineExploration !== null
          ? (inspectedTimelineExploration.sourceStartMs +
              inspectedTimelineExploration.sourceEndMs) /
            2
          : inspectedTimelineSignal !== null
            ? inspectedTimelineSignal.peakMs
        : orderedCandidates.find(({ id }) => id === focusedCandidateId)?.peakMs ?? null;
  const broadcastTranscriptExploredCount = broadcastTranscriptExplorationCells.filter(
    ({ state }) => state === "complete" || state === "gap",
  ).length;
  const liveExplorationFindings = useMemo(
    () =>
      broadcastTranscriptExplorationCells
        .filter(({ state }) => state === "complete")
        .flatMap((cell) => {
          const chapters = broadcastTranscriptChapters.filter(
            (chapter) =>
              chapter.startMs < cell.sourceEndMs &&
              chapter.endMs > cell.sourceStartMs,
          );
          if (chapters.length === 0) return [];
          return [{ cell, summaryKo: chapters.map(({ summaryKo }) => summaryKo).join(" ") }];
        })
        .slice(-4),
    [broadcastTranscriptChapters, broadcastTranscriptExplorationCells],
  );
  const broadcastContextTimelinePresentation = useMemo(
    () =>
      buildBroadcastContextTimelinePresentation({
        status: broadcastContextStatus,
        result: broadcastContextResult,
        recoveredAnalysis: openedRecoveredResult !== null,
      }),
    [broadcastContextResult, broadcastContextStatus, openedRecoveredResult],
  );
  const timelineContextCoverageGaps =
    broadcastContextStatus === "completed"
      ? broadcastContextResult?.coverage.gaps ?? []
      : [];
  const broadcastContextSamplingPlan = useMemo(() => {
    if (boundarySourceDurationMs <= 0) {
      return null;
    }
    try {
      return createBroadcastContextSamplingPlan(
        boundarySourceDurationMs,
        candidates.map((candidate) => Math.round(candidate.peakMs)),
      );
    } catch {
      return null;
    }
  }, [boundarySourceDurationMs, candidates]);
  const broadcastContextCandidateInputs = useMemo<
    readonly BroadcastContextCandidateInput[]
  >(
    () =>
      candidates.slice(0, 12).map((candidate) => {
        const narrative = buildHighlightNarrative(candidate);
        const evidence = candidatePassBEvidenceById[candidate.id];
        const insight = candidateGeminiInsightById[candidate.id];
        const exactCaptionKo = youtubeCaptionTrack === null
          ? ""
          : captionTextForRange(
              youtubeCaptionTrack.events,
              Math.round(candidate.startMs),
              Math.round(candidate.endMs),
            );
        const persistedChapterKo = chapterTextForRange(
          broadcastTranscriptChapters,
          Math.round(candidate.startMs),
          Math.round(candidate.endMs),
        );
        const transcriptKo =
          exactCaptionKo ||
          evidence?.cues.map((cue) => cue.text).join(" ").trim() ||
          persistedChapterKo ||
          "후보 구간의 대사는 아직 확정하지 못함.";
        const chat = candidate.evidence.chat;
        return {
          candidateId: candidate.id,
          startMs: Math.round(candidate.startMs),
          endMs: Math.round(candidate.endMs),
          transcriptKo,
          eventSummaryKo: insight?.eventSummaryKo.trim() || narrative.event,
          reactionSummaryKo:
            insight?.reactionSummaryKo.trim() || narrative.streamerReaction,
          participantContextKo:
            insight?.participantSummaryKo?.trim() ||
            "이 후보의 대표 화면 등장인물은 아직 확인하지 못했습니다.",
          chatReactionSummaryKo:
            chat === undefined
              ? null
              : `채팅 ${chat.messageCount}개, 반응 표현 ${chat.reactionMessageCount}개, 평소 대비 ${chat.burstRatio.toFixed(1)}배`,
        };
      }),
    [
      broadcastTranscriptChapters,
      candidateGeminiInsightById,
      candidatePassBEvidenceById,
      candidates,
      youtubeCaptionTrack,
    ],
  );
  const boundedBroadcastContextChapters = useMemo(
    () => compactBroadcastContextChapters(broadcastTranscriptChapters),
    [broadcastTranscriptChapters],
  );
  const explicitMusicOnlyCandidateIds = useMemo(
    () =>
      new Set(
        youtubeCaptionTrack === null
          ? []
          : candidates
              .filter((candidate) =>
                isExplicitMusicOnlyCaption(
                  captionTextForRange(
                    youtubeCaptionTrack.events,
                    Math.round(candidate.startMs),
                    Math.round(candidate.endMs),
                  ),
                ),
              )
              .map((candidate) => candidate.id),
      ),
    [candidates, youtubeCaptionTrack],
  );
  const candidateDetailCandidateIds = useMemo(
    () =>
      candidates
        .filter(
          (candidate) =>
            candidatePassBContextById[candidate.id] !== undefined &&
            !explicitMusicOnlyCandidateIds.has(candidate.id),
        )
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.peakMs - right.peakMs ||
            left.id.localeCompare(right.id),
        )
        .slice(0, 12)
        .map(({ id }) => id),
    [candidatePassBContextById, candidates, explicitMusicOnlyCandidateIds],
  );
  const automaticCandidateDetailIds = useMemo(() => {
    const alreadyHandledIds = new Set(
      Object.keys(candidatePassBVerificationReceiptById),
    );
    return candidateDetailCandidateIds.filter(
      (candidateId) => !alreadyHandledIds.has(candidateId),
    );
  }, [
    candidateDetailCandidateIds,
    candidatePassBVerificationReceiptById,
  ]);
  const candidateDetailCostEstimate = useMemo(() => {
    const detailIds = new Set(candidateDetailCandidateIds.slice(0, 12));
    const detailCandidates = candidates.filter((candidate) => detailIds.has(candidate.id));
    const totalDurationMs = detailCandidates.reduce(
      (total, candidate) => total + candidate.endMs - candidate.startMs,
      0,
    );
    return estimateCandidatePassBCost(
      detailCandidates.length,
      detailCandidates.length === 0
        ? 0
        : Math.round(totalDurationMs / detailCandidates.length),
    );
  }, [candidateDetailCandidateIds, candidates]);
  const analysisBudgetEnvelope = useMemo(() => {
    if (boundarySourceDurationMs <= 0) {
      return null;
    }
    try {
      return createAnalysisBudgetEnvelope(
        boundarySourceDurationMs,
        candidates.length,
        0,
      );
    } catch {
      return null;
    }
  }, [boundarySourceDurationMs, candidates.length]);
  const broadcastTranscriptProgressRatio =
    broadcastTranscriptStatus === "completed" ||
    broadcastTranscriptStatus === "completedWithGaps"
      ? 1
      : broadcastTranscriptProgress === null || broadcastTranscriptProgress.totalCount === 0
        ? 0
        : Math.min(
            1,
            Math.max(
              0,
              (broadcastTranscriptProgress.completedCount +
                (broadcastTranscriptProgress.stage === "transcribing" ? 0.5 : 0.1)) /
                broadcastTranscriptProgress.totalCount,
            ),
          );
  const broadcastTranscriptStatusText = (() => {
    if (broadcastContextStatus === "restoring") {
      return "저장된 전체 맥락 결과 확인 중";
    }
    if (broadcastContextStatus === "running") {
      return "Qwen 3.7 Plus 전체 맥락 판단 중";
    }
    if (broadcastContextStatus === "completed") {
      if (broadcastContextResult?.coverage.status === "partial") {
        return `전체 맥락 완료 · AI 근거 ${Math.round(
          broadcastContextResult.coverage.coverageRatio * 100,
        )}%`;
      }
      if (broadcastContextResult?.semanticChaptersSupported === false) {
        return "저장된 전체 맥락 완료 · 구형 주제 자료 미지원";
      }
      return `전체 맥락 완료 · 주제 구간 ${broadcastContextResult?.semanticChapters.length ?? 0}개`;
    }
    if (broadcastContextStatus === "failed") {
      return "전체 맥락 판단 실패";
    }
    if (broadcastTranscriptStatus === "running") {
      if (broadcastTranscriptProgress === null) {
        return "대사 지도 준비 중";
      }
      return `대사 표본 ${Math.min(
        broadcastTranscriptProgress.totalCount,
        broadcastTranscriptProgress.completedCount + 1,
      )}/${broadcastTranscriptProgress.totalCount} ${
        broadcastTranscriptProgress.stage === "decoding" ? "변환 중" : "인식 중"
      }`;
    }
    if (broadcastTranscriptStatus === "completed") {
      return `대사 지도 ${broadcastTranscriptChapters.length}구간 저장 · 맥락 판단 대기`;
    }
    if (broadcastTranscriptStatus === "completedWithGaps") {
      return `대사 지도 ${broadcastTranscriptChapters.length}구간 저장 · 일부 공백 · 맥락 판단 대기`;
    }
    if (broadcastTranscriptStatus === "failed") {
      return "대사 지도 분석 실패";
    }
    if (openedRecoveredResult !== null) {
      return "이 저장 기록은 전체 맥락 미분석";
    }
    if (broadcastContextSamplingPlan === null) {
      return "계획 준비";
    }
    return `대사 표본 ${Math.round(
      broadcastContextSamplingPlan.estimatedAudioCoverageRatio * 100,
    )}% · 예상 상한 ${formatEstimatedUsd(
      analysisBudgetEnvelope?.projectedMaximumUsd ?? 1,
    )}`;
  })();
  const approvedCandidates = orderedCandidates.filter(
    ({ reviewState }) => reviewState === "approved",
  );
  const approvedExportCandidates: readonly ApprovedHighlightExportCandidate[] =
    approvedCandidates.map((proposal) => ({
      proposal,
      boundaryRevision: boundaryRevisions[proposal.id] ?? null,
    }));
  const approvedCount = approvedCandidates.length;
  const rejectedCount = orderedCandidates.filter(
    ({ reviewState }) => reviewState === "rejected",
  ).length;
  const reviewedCount = approvedCount + rejectedCount;
  const remainingReviewCount = Math.max(0, orderedCandidates.length - reviewedCount);
  const previewCandidateNumber =
    focusedCandidateId === null
      ? 0
      : orderedCandidates.findIndex(({ id }) => id === focusedCandidateId) + 1;
  const previousFocusedCandidate =
    previewCandidateNumber > 1
      ? orderedCandidates[previewCandidateNumber - 2] ?? null
      : null;
  const nextFocusedCandidate =
    previewCandidateNumber > 0 && previewCandidateNumber < orderedCandidates.length
      ? orderedCandidates[previewCandidateNumber] ?? null
      : null;
  const reviewStarted = orderedCandidates.some(({ reviewState }) => reviewState !== "unreviewed");
  const boundaryWorkStarted = Object.values(boundaryRevisions).some(
    ({ revision }) => revision > 0,
  );
  const reviewWorkStarted = reviewStarted || boundaryWorkStarted;
  const candidatePassBWorkStarted = Object.keys(candidatePassBEvidenceById).length > 0;
  const candidateAudioEventWorkStarted =
    Object.keys(candidateAudioEventEvidenceById).length > 0;
  const candidateRankingWorkStarted =
    candidateRankingViewHasSessionWork(candidateRankingView);
  const unsavedSessionWorkStarted =
    reviewWorkStarted ||
    candidatePassBWorkStarted ||
    candidateAudioEventWorkStarted ||
    candidateRankingWorkStarted;
  const reviewCompleted =
    orderedCandidates.length > 0 &&
    orderedCandidates.every(({ reviewState }) => reviewState !== "unreviewed");
  const wholeContextPhaseActive =
    broadcastTranscriptStatus === "running" ||
    broadcastContextStatus === "restoring" ||
    broadcastContextStatus === "running";
  const wholeContextPhaseFailed =
    broadcastTranscriptStatus === "failed" || broadcastContextStatus === "failed";
  const wholeContextPhaseComplete = broadcastContextStatus === "completed";
  /**
   * Why the final list is empty. A pipeline that stopped early never reached a
   * judgement, so saying "no clips passed verification" would blame the
   * broadcast for a failure that belongs to the analysis.
   */
  const finalVerificationGapSummary = useMemo(
    () => summarizeFinalVerificationGaps(finalCandidateVerification.gapByCandidateId),
    [finalCandidateVerification.gapByCandidateId],
  );
  /**
   * A candidate that never reached a judgement means the pipeline stopped, not
   * that the broadcast had nothing worth clipping.
   */
  const blockedByPipelineGap = finalVerificationGapSummary.some(({ gap }) =>
    isPipelineGap(gap),
  );
  const emptyResultReason: "analysis-incomplete" | "no-verified-candidates" =
    wholeContextPhaseFailed ||
    broadcastContextResult === null ||
    broadcastTranscriptChapters.length === 0 ||
    blockedByPipelineGap
      ? "analysis-incomplete"
      : "no-verified-candidates";
  const candidatePassBTerminal =
    candidatePassBRun !== null &&
    ["completed", "completedWithGaps", "cancelled", "failed"].includes(
      candidatePassBRun.status,
    );
  const detailedReviewPhaseActive =
    semanticLeadRefinementStatus === "running" || candidatePassBBusy;
  const detailedReviewPhaseFailed =
    semanticLeadRefinementStatus === "failed" || candidatePassBRun?.status === "failed";
  /**
   * Candidate detail is the stage that produces the multimodal reading every
   * final candidate is gated on, so the phase is not complete until it has
   * actually settled. Treating whole-context completion as sufficient
   * published the final list while detail analysis had not yet started, and
   * every candidate was dropped for a result that was still seconds away.
   */
  const candidateDetailSettled =
    candidateDetailCandidateIds.length === 0 || candidatePassBTerminal;
  const detailedReviewPhaseComplete =
    !detailedReviewPhaseActive &&
    !detailedReviewPhaseFailed &&
    candidateDetailSettled &&
    ((wholeContextPhaseComplete && semanticLeadRefinementStatus === "completed") ||
      wholeContextPhaseFailed);
  const detailedReviewPhaseState = detailedReviewPhaseFailed
    ? "error"
    : detailedReviewPhaseActive
      ? "active"
      : detailedReviewPhaseComplete
        ? "complete"
        : "pending";
  const detailedReviewPhaseLabel = !wholeContextPhaseComplete && !wholeContextPhaseFailed
    ? "전체 맥락 완료 후 자동 시작"
    : semanticLeadRefinementStatus === "running" && candidatePassBBusy
      ? "의미 후보 위치와 화면·대사 동시 확인 중"
      : semanticLeadRefinementStatus === "running"
        ? "새 의미 후보의 정확한 위치 확인 중"
        : candidatePassBBusy
          ? candidatePassBDetailAnalysisLabel
          : semanticLeadRefinementStatus === "failed"
            ? "의미 후보 위치 확인 실패 · 기존 후보 유지"
            : candidatePassBRun?.status === "failed"
              ? "화면·대사 확인 실패 · 기존 후보 유지"
              : detailedReviewPhaseComplete
                ? candidateDetailCandidateIds.length === 0
                  ? "추가 세부 분석 대상 없음 · 후보 유지"
                  : `세부 검토 완료 · AI 단서 ${Object.keys(candidateGeminiInsightById).length}개`
                : "세부 검토 준비 중";
  const finalSelectionPhaseReady =
    detailedReviewPhaseComplete || detailedReviewPhaseFailed;
  const finalSelectionPhaseState =
    reviewCompleted || (orderedCandidates.length === 0 && finalSelectionPhaseReady)
      ? "complete"
      : finalSelectionPhaseReady
        ? "active"
        : "pending";
  const finalSelectionPhaseLabel = reviewCompleted
    ? `검토 완료 · 사용 ${approvedCount}개`
    : orderedCandidates.length === 0 && finalSelectionPhaseReady
      ? "선택할 후보 없음 · 정상"
      : finalSelectionPhaseReady
        ? `편집자 확인 대기 ${remainingReviewCount}개 · 사용 ${approvedCount}개`
        : "세부 검토가 끝나면 편집자가 결정";
  const contextualCandidatePublicationReady =
    finalSelectionPhaseReady && timelineTopicRevealComplete;
  const liveAnalysisStageNumber =
    !analysisComplete
      ? 1
      : !wholeContextPhaseComplete && !wholeContextPhaseFailed
      ? 2
      : !contextualCandidatePublicationReady
        ? 3
        : 4;
  const liveAnalysisStageTitle =
    liveAnalysisStageNumber === 1
      ? ui("방송 전체에서 반응 신호를 빠르게 탐색하고 있어요", "Scanning the broadcast for reaction signals")
      : liveAnalysisStageNumber === 2
      ? ui("방송 전역에서 맥락을 탐색하고 있어요", "Exploring context across the broadcast")
      : liveAnalysisStageNumber === 3
        ? timelineTopicRevealComplete
          ? ui("발견한 맥락으로 후보를 다시 보고 있어요", "Rechecking candidates against discovered context")
          : ui("방송 주제 지도를 하나씩 조합하고 있어요", "Building the broadcast topic map")
        : reviewCompleted
          ? ui("편집자 검토가 끝났어요", "Editor review is complete")
          : ui("최종 후보를 확인할 차례예요", "Final candidates are ready for review");
  const liveAnalysisStageDetail =
    liveAnalysisStageNumber === 1
      ? analysisCommitPending
        ? ui("찾은 탐색 구간과 확인 기록을 저장하는 중", "Saving discovered ranges and evidence")
        : audioAnalysisProgress?.stage === "decoding-audio"
          ? ui(
              `방송 오디오 ${audioAnalysisProgress.analyzedWindowCount.toLocaleString("ko-KR")}개 구간 확인 중`,
              `Checked ${audioAnalysisProgress.analyzedWindowCount.toLocaleString("en-US")} audio windows`,
            )
          : analysisProgress?.stage === "sampling"
            ? ui(
                `영상 맥락 ${analysisProgress.completedSampleCount.toLocaleString("ko-KR")}/${analysisProgress.totalSampleCount.toLocaleString("ko-KR")} 확인 중`,
                `Checking visual context ${analysisProgress.completedSampleCount.toLocaleString("en-US")}/${analysisProgress.totalSampleCount.toLocaleString("en-US")}`,
              )
            : ui("영상과 방송 오디오를 짧은 조각으로 나눠 준비 중", "Preparing short visual and audio windows")
      : liveAnalysisStageNumber === 2
      ? analysisLanguage === "ko"
        ? broadcastTranscriptStatusText
        : broadcastTranscriptStatus === "running"
          ? `Mapping transcript context · ${Math.round(broadcastTranscriptProgressRatio * 100)}%`
          : broadcastContextStatus === "running"
            ? "Interpreting topics, events, and host behavior"
            : "Preparing full-context analysis"
      : liveAnalysisStageNumber === 3
        ? !timelineTopicRevealComplete
          ? ui(`주제 ${Math.min(
              timelineSemanticChapterRevealCount,
              timelineSemanticChapters.length,
            )}/${timelineSemanticChapters.length}개를 타임라인에 배치하는 중`, `Placing ${Math.min(
              timelineSemanticChapterRevealCount,
              timelineSemanticChapters.length,
            )}/${timelineSemanticChapters.length} topics on the timeline`)
          : analysisLanguage === "ko" ? detailedReviewPhaseLabel : "Reviewing candidate visuals, dialogue, and participants"
        : analysisLanguage === "ko" ? finalSelectionPhaseLabel : `${remainingReviewCount} candidates awaiting review · ${approvedCount} selected`;
  /**
   * A stalled-looking bar was a fabricated number, not a stall: 0.02, 0.76,
   * 0.84, 0.72 and 0.08 were constants standing in for stages with no
   * measured completion fraction. Those branches now return null, and the
   * `<progress>` elements below render indeterminate (no `value`) instead of
   * jumping to a number that never moves.
   */
  const liveAnalysisProgressValue: number | null =
    liveAnalysisStageNumber === 1
      ? (analysisProgress !== null || audioAnalysisProgress !== null)
        ? ((analysisProgress?.ratio ?? 0) + (audioAnalysisProgress?.ratio ?? 0)) /
          ((analysisProgress === null ? 0 : 1) + (audioAnalysisProgress === null ? 0 : 1))
        : null
      : liveAnalysisStageNumber === 2
      ? broadcastTranscriptStatus === "running"
        ? 0.05 + broadcastTranscriptProgressRatio * 0.65
        : null
      : liveAnalysisStageNumber === 3
        ? !timelineTopicRevealComplete && timelineSemanticChapters.length > 0
          ? Math.min(
              1,
              timelineSemanticChapterRevealCount /
                timelineSemanticChapters.length,
            )
          : candidatePassBBusy
            ? candidatePassBProgressRatio
            : null
        : orderedCandidates.length === 0
          ? 1
          : reviewedCount / orderedCandidates.length;
  const liveAnalysisProgressBarProps =
    liveAnalysisProgressValue === null ? {} : { value: liveAnalysisProgressValue };
  /**
   * The fast scan (local CPU) and the uniform transcript prefetch (network,
   * since 0.4.2) run concurrently, but the entry-workspace panel only ever
   * showed the scan — the parallel transcript work was invisible until the
   * scan finished and the stage counter advanced. These three tracks report
   * what is actually running right now instead of a single serial stage.
   *
   * Keep this in sync with MAX_IN_FLIGHT_TRANSCRIPTIONS in
   * broadcastTranscript.worker.ts; it is not imported because that module is
   * bundled as a worker entry, not a shared library.
   */
  const transcriptMaxConcurrencyLabel = 4;
  const analysisElapsedMs =
    analysisStartedAtMsRef.current === null || progressClockNowMs === null
      ? 0
      : Math.max(0, progressClockNowMs - analysisStartedAtMsRef.current);
  const fastScanTrackRatio =
    analysisProgress !== null || audioAnalysisProgress !== null
      ? ((analysisProgress?.ratio ?? 0) + (audioAnalysisProgress?.ratio ?? 0)) /
        ((analysisProgress === null ? 0 : 1) + (audioAnalysisProgress === null ? 0 : 1))
      : 0;
  const fastScanTrackStatus =
    audioAnalysisProgress !== null
      ? `${formatDuration(audioAnalysisProgress.decodedThroughMs)} / ${formatDuration(audioAnalysisProgress.sourceDurationMs)}`
      : analysisProgress !== null
        ? `${analysisProgress.completedSampleCount.toLocaleString("ko-KR")}/${analysisProgress.totalSampleCount.toLocaleString("ko-KR")}`
        : ui("준비 중", "Preparing");
  const transcriptTrackDone =
    broadcastTranscriptStatus === "completed" ||
    broadcastTranscriptStatus === "completedWithGaps";
  const transcriptTrackStatus = transcriptTrackDone
    ? ui("완료", "Complete")
    : broadcastTranscriptProgress !== null
      ? ui(
          `표본 ${Math.min(broadcastTranscriptProgress.totalCount, broadcastTranscriptProgress.completedCount + 1)}/${broadcastTranscriptProgress.totalCount} · 동시 ${transcriptMaxConcurrencyLabel}`,
          `Sample ${Math.min(broadcastTranscriptProgress.totalCount, broadcastTranscriptProgress.completedCount + 1)}/${broadcastTranscriptProgress.totalCount} · ${transcriptMaxConcurrencyLabel} at once`,
        )
      : broadcastTranscriptStatus === "running"
        ? ui("준비 중", "Preparing")
        : ui("대기 중", "Waiting");
  const transcriptTrackRatio = broadcastTranscriptProgressRatio;
  const chatTrackDone = chatImportStatus !== "reading";
  const chatTrackStatus =
    chatImportStatus === "reading"
      ? ui("읽는 중", "Reading")
      : chatImport !== null
        ? ui(
            `${chatImport.messages.length.toLocaleString("ko-KR")}줄`,
            `${chatImport.messages.length.toLocaleString("en-US")} lines`,
          )
        : chatImportStatus === "failed"
          ? ui("가져오기 실패 · 계속 진행", "Import failed · continuing")
          : ui("선택 사항", "Optional");
  const progressRemainingEstimate = estimateRemainingMs({
    sourceDurationMs: boundarySourceDurationMs,
    elapsedMs: analysisElapsedMs,
    ratio: analysisProgress !== null || audioAnalysisProgress !== null ? fastScanTrackRatio : null,
  });
  const progressRemainingLabel = formatRemainingLabel(progressRemainingEstimate);
  const liveAnalysisPhaseSteps = [
    {
      number: 1,
      label: ui("빠른 탐색", "Fast scan"),
      state: liveAnalysisStageNumber === 1 ? "active" : "complete",
    },
    {
      number: 2,
      label: ui("전체 맥락", "Full context"),
      state: wholeContextPhaseActive
        ? "active"
        : wholeContextPhaseComplete
          ? "complete"
          : wholeContextPhaseFailed
            ? "error"
            : "pending",
    },
    {
      number: 3,
      label: ui("후보 종합", "Candidate synthesis"),
      state:
        !timelineTopicRevealComplete && finalSelectionPhaseReady
          ? "active"
          : detailedReviewPhaseState,
    },
    {
      number: 4,
      label: ui("편집자 선택", "Editor selection"),
      state: contextualCandidatePublicationReady
        ? finalSelectionPhaseState
        : "pending",
    },
  ] as const;
  const analysisFinishedWithoutCandidates =
    analysisComplete && selectionResult !== null && candidates.length === 0;
  const reviewingRecoveredResult =
    openedRecoveredResult !== null && candidates.length > 0;
  const currentStep = analysisFinishedWithoutCandidates
    ? 4
    : reviewingRecoveredResult
      ? reviewCompleted
        ? 4
        : 3
      : !sourceReady
      ? 1
      : !analysisComplete
        ? 2
        : reviewCompleted
          ? 4
          : 3;
  const showSourceWorkspace =
    (!sourceReady && !reviewingRecoveredResult) ||
    (!analysisBusy && selectionResult === null);
  const sourceInputLocked =
    analysisBusy || sourceCheckBusy || candidateRefinementBusy;
  const chatInputLocked =
    openedRecoveredResult !== null || analysisBusy || chatImportStatus === "reading";
  const chatOffsetLocked =
    analysisStartPending || analysisRun !== null || openedRecoveredResult !== null;
  const sourceFileActionLabel = analysisBusy || candidateRefinementBusy
    ? "AI 분석 중 변경 잠금"
    : sourceCheck?.status === "checking"
      ? "확인 중…"
      : openedRecoveredResult !== null
        ? sourceReady
          ? "연결한 원본 바꾸기"
          : candidates.length === 0
            ? "원하면 원래 파일 고르기"
            : "원래 파일 다시 고르기"
        : sourceReady
          ? "다른 영상 고르기"
          : "영상 파일 고르기";

  useEffect(() => {
    if (
      previewCandidateId !== null &&
      orderedCandidates.some(({ id }) => id === previewCandidateId)
    ) {
      return;
    }
    setPreviewCandidateId(orderedCandidates[0]?.id ?? null);
  }, [orderedCandidates, previewCandidateId]);

  useEffect(() => {
    if (focusedCandidateId === null || sourcePreviewUrl === null) {
      lastWorkspacePreviewCue.current = null;
      previewRequestedCandidateIdRef.current = null;
      previewPreparedCandidateIdRef.current = null;
      previewPlayAfterPrepareRef.current = null;
      setPreviewPreparedCandidateId(null);
      return;
    }
    const candidate = orderedCandidates.find(({ id }) => id === focusedCandidateId);
    const video = previewVideo.current;
    if (candidate === undefined || video === null) {
      return;
    }
    const range = effectiveCandidateRange(candidate, boundaryRevisions[candidate.id]);
    const cueKey = `${sourcePreviewUrl}|${candidate.id}|${range.startMs}`;
    if (lastWorkspacePreviewCue.current === cueKey) {
      return;
    }
    previewRequestedCandidateIdRef.current = candidate.id;
    previewPreparedCandidateIdRef.current = null;
    previewPlayAfterPrepareRef.current = null;
    setPreviewPreparedCandidateId(null);
    const markPrepared = (): void => {
      if (previewRequestedCandidateIdRef.current !== candidate.id) return;
      previewPreparedCandidateIdRef.current = candidate.id;
      setPreviewPreparedCandidateId(candidate.id);
    };
    const cueWithoutPlaying = (): void => {
      try {
        video.pause();
        video.currentTime = range.startMs / 1_000;
        lastWorkspacePreviewCue.current = cueKey;
        if (
          Math.abs(video.currentTime - range.startMs / 1_000) < 0.25 &&
          video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
          markPrepared();
        } else {
          video.addEventListener("seeked", markPrepared, { once: true });
          video.addEventListener("canplay", markPrepared, { once: true });
        }
      } catch {
        lastWorkspacePreviewCue.current = null;
      }
    };
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      cueWithoutPlaying();
      return;
    }
    video.addEventListener("loadedmetadata", cueWithoutPlaying, { once: true });
    return () => video.removeEventListener("loadedmetadata", cueWithoutPlaying);
  }, [boundaryRevisions, focusedCandidateId, orderedCandidates, sourcePreviewUrl]);

  useEffect(() => {
    if (!analysisBusy && !candidateRefinementBusy && !unsavedSessionWorkStarted) {
      return;
    }
    const warnBeforeLeaving = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [analysisBusy, candidateRefinementBusy, unsavedSessionWorkStarted]);

  const confirmDiscardCurrentWork = useCallback((): boolean => {
    if (analysisBusy || candidateRefinementBusy) {
      return false;
    }
    if (!unsavedSessionWorkStarted) {
      return true;
    }
    return window.confirm(
      "승인·제외 판단, 시작·끝 조정, 자세히 찾은 반응 종류·대사 단서와 추천 검토 순서는 아직 저장되지 않았어요. 지금 이동하면 방금 한 작업이 사라집니다. 그래도 계속할까요?",
    );
  }, [analysisBusy, candidateRefinementBusy, unsavedSessionWorkStarted]);

  const resetBoundarySession = useCallback((): void => {
    setBoundarySessionId(createOperationId("boundary-session"));
    setBoundaryRevisions({});
    setBoundaryFeedback(null);
  }, []);

  const resetCandidatePassB = useCallback((): void => {
    autoCandidatePassBSourceRef.current = null;
    candidatePassBOperationEpoch.current += 1;
    candidatePassBInsightWriteEpochRef.current += 1;
    candidatePassBAbortController.current?.abort();
    candidatePassBAbortController.current = null;
    candidatePassBMachine.current = null;
    candidatePassBIdentity.current = null;
    candidatePassBStartPendingRef.current = false;
    setCandidatePassBRun(null);
    candidatePassBEvidenceRef.current = {};
    candidateGeminiInsightRef.current = {};
    candidatePassBModelByIdRef.current = {};
    candidatePassBVerificationReceiptRef.current = {};
    setCandidatePassBEvidenceById({});
    setCandidateGeminiInsightById({});
    setCandidatePassBVerificationReceiptById({});
    setCandidatePassBStartPending(false);
    setCandidatePassBModelProgress(null);
    setCandidatePassBCandidateProgress(null);
    setCandidatePassBActiveCandidateIds([]);
    setCandidatePassBError(null);
  }, []);

  const resetCandidateAudioEvent = useCallback((): void => {
    candidateAudioEventOperationEpoch.current += 1;
    candidateAudioEventAbortController.current?.abort();
    candidateAudioEventAbortController.current = null;
    candidateAudioEventMachine.current = null;
    candidateAudioEventIdentity.current = null;
    candidateAudioEventStartPendingRef.current = false;
    setCandidateAudioEventRun(null);
    setCandidateAudioEventEvidenceById({});
    setCandidateAudioEventModelProgress(null);
    setCandidateAudioEventCandidateProgress(null);
    setCandidateAudioEventError(null);
    setCandidateAudioEventStartPending(false);
  }, []);

  const resetCandidateRanking = useCallback(
    (nextCandidates: readonly ReviewedCandidate[] = []): void => {
      const rankingCandidateSetSupported =
        nextCandidates.length <= CANDIDATE_RANKING_MAX_CANDIDATES;
      const fingerprints =
        nextCandidates.length === 0
          ? {
              candidateSetFingerprint: "candidate-set-empty",
              evidenceFingerprint: "ranking-evidence-empty",
            }
          : rankingCandidateSetSupported
            ? createCandidateRankingFingerprints(
                nextCandidates,
                {},
                {},
                "incomplete",
              )
            : {
                candidateSetFingerprint: "candidate-set-over-ranking-limit",
                evidenceFingerprint: "ranking-evidence-over-ranking-limit",
              };
      candidateRankingRevision.current = 0;
      setCandidateRankingView(
        createCandidateRankingViewState({
          rankingSessionId: createOperationId("ranking-session"),
          candidateSetFingerprint: fingerprints.candidateSetFingerprint,
          evidenceFingerprint: fingerprints.evidenceFingerprint,
          canonicalOrderIds: rankingCandidateSetSupported
            ? nextCandidates.map(({ id }) => id)
            : [],
        }),
      );
      setCandidateRankingFeedback(null);
    },
    [],
  );

  const resetDownstream = useCallback(() => {
    recoveredContextRestoreEpoch.current += 1;
    clipRenderAbortController.current?.abort();
    clipRenderAbortController.current = null;
    analysisOperationEpoch.current += 1;
    analysisStartOperation.current = null;
    setAnalysisStartPending(false);
    setAnalysisCancelPending(false);
    setAnalysisCommitPending(false);
    analysisAbortController.current?.abort();
    analysisAbortController.current = null;
    setAnalysisRun(null);
    setSelectionResult(null);
    setCandidates([]);
    setCandidateTimelineScorePoints([]);
    setTimelineSemanticChapters([]);
    setTimelineSemanticChapterRevealCount(0);
    setTimelineInspectionTarget(null);
    setBroadcastTranscriptExplorationCells([]);
    broadcastTranscriptAbortController.current?.abort();
    broadcastTranscriptAbortController.current = null;
    broadcastContextAbortController.current?.abort();
    broadcastContextAbortController.current = null;
    semanticLeadRefinementAbortController.current?.abort();
    semanticLeadRefinementAbortController.current = null;
    autoBroadcastTranscriptSourceRef.current = null;
    autoBroadcastContextSourceRef.current = null;
    autoSemanticLeadRefinementSourceRef.current = null;
    setBroadcastTranscriptStatus("idle");
    setBroadcastTranscriptProgress(null);
    setBroadcastTranscriptExplorationCells([]);
    setBroadcastTranscriptChapters([]);
    setYouTubeCaptionTrack(null);
    setBroadcastTranscriptError(null);
    setBroadcastContextStatus("idle");
    setBroadcastContextResult(null);
    setCandidateAiProjectionById({});
    setBroadcastContextRefinementLeadIds(null);
    setBroadcastContextFastRefinementLeadIds(null);
    setBroadcastContextError(null);
    setSemanticLeadRefinementStatus("idle");
    setSemanticLeadRefinementError(null);
    resetCandidateRanking();
    resetBoundarySession();
    resetCandidatePassB();
    resetCandidateAudioEvent();
    setAnalysisProgress(null);
    setAudioAnalysisProgress(null);
    setAnalysisError(null);
    setLastExportFormat(null);
    setCopyStatus("idle");
    setExportError(null);
    setPreviewCandidateId(null);
    setClipDownloadStatusById({});
    setClipDownloadErrorById({});
    setClipDownloadProgressById({});
    setClipBatchStatus("idle");
    setClipBatchCompletedCount(0);
    setClipBatchError(null);
    setOpenedRecoveredResult(null);
  }, [
    resetBoundarySession,
    resetCandidateAudioEvent,
    resetCandidatePassB,
    resetCandidateRanking,
  ]);

  const inspectSelectedFile = useCallback(
    async (file: File) => {
      const recoveryTarget = openedRecoveredResult;
      const replacingExistingSource = recoveryTarget === null && sourceFile !== null;
      const previousRecoveryBinding =
        recoveryTarget !== null &&
        sourceFile !== null &&
        preflight !== null &&
        sourceContentFingerprint !== null &&
        sourceCheck?.status === "completed"
          ? {
              pendingFileName: pendingFileName ?? preflight.metadata.name,
              preflight,
              sourceCheck,
              sourceContentFingerprint,
            }
          : null;
      const epoch = sourceSelectionEpoch.current + 1;
      sourceSelectionEpoch.current = epoch;
      sourceAbortController.current?.abort();
      const controller = new AbortController();
      sourceAbortController.current = controller;
      const isCurrentSelection = (): boolean =>
        isMounted.current &&
        epoch === sourceSelectionEpoch.current &&
        !controller.signal.aborted;
      setPendingFileName(file.name);
      setSourceError(null);
      if (recoveryTarget === null) {
        replaceSourceFile(null);
        setPreflight(null);
        setSourceContentFingerprint(null);
        if (replacingExistingSource) {
          chatSelectionEpoch.current += 1;
          setChatImport(null);
          setChatContentFingerprint(null);
          setChatFileName(null);
          setChatError(null);
          setChatImportStatus("idle");
          setChatOffsetSeconds(0);
        }
        resetDownstream();
      } else if (previousRecoveryBinding === null) {
        replaceSourceFile(null);
        setPreflight(null);
        setSourceContentFingerprint(null);
      }

      let machine = createSourceCheck({
        jobId: createOperationId("source-check"),
        sourceDefinitionId:
          recoveryTarget?.finalResult.result.input.source.sourceDefinitionId ??
          createOperationId("source"),
        bindingRevision: epoch,
      });
      machine = applySourceEvent(machine, { type: "CHECK_START_REQUESTED" });
      setSourceCheck(machine);

      try {
        machine = applySourceEvent(machine, {
          type: "PROBE_PROGRESS",
          probeId: "media-metadata",
        });
        setSourceCheck(machine);
        const result = await inspectLocalMedia(file, { signal: controller.signal });
        if (!isCurrentSelection()) {
          return;
        }

        machine = applySourceEvent(machine, {
          type: "PROBE_PROGRESS",
          probeId: "sampled-content-fingerprint",
        });
        setSourceCheck(machine);
        const fingerprint = await createLocalFileFingerprint(file, {
          signal: controller.signal,
        });
        if (!isCurrentSelection()) {
          return;
        }

        const sourceDescriptor = createDurableSourceDescriptor(
          result,
          machine.sourceDefinitionId,
          fingerprint.value,
        );
        if (
          recoveryTarget !== null &&
          (sourceDescriptor.contentFingerprint !==
            recoveryTarget.finalResult.result.input.source.contentFingerprint ||
            sourceDescriptor.sizeBytes !==
              recoveryTarget.finalResult.result.input.source.sizeBytes ||
            sourceDescriptor.durationMs !==
              recoveryTarget.finalResult.result.input.source.durationMs ||
            sourceDescriptor.kind !== recoveryTarget.finalResult.result.input.source.kind)
        ) {
          throw new SourceRebindMismatchError();
        }

        const isUsableVideo = result.metadata.kind === "video" && result.metadata.durationMs > 0;
        const resultKind: SourceCheckResultKind = !isUsableVideo
          ? "blocked"
          : result.capabilities.preferredRuntimeTier === "signals-only"
            ? "degraded"
            : "ready";
        machine = applySourceEvent(machine, {
          type: "PROBES_FINISHED",
          resultKind,
          capabilityDraftId: createOperationId("capability-draft"),
        });
        setSourceCheck(machine);
        const capabilitySnapshotId = machine.jobId;
        const store = getResultStore();
        const sourceSnapshot: SourceCapabilitySnapshotRecord = {
          kind: "sourceCapabilitySnapshot",
          sourceCheckId: machine.jobId,
          sourceDefinitionId: machine.sourceDefinitionId,
          bindingRevision: machine.bindingRevision,
          schemaVersion: PERSISTENCE_SCHEMA_VERSION,
          browserCapabilitySignature: expectedBrowserCapabilitySignature(result.capabilities),
          preflightMetadata: sourceDescriptor,
          capabilities: { ...result.capabilities },
          recordedAt: new Date().toISOString(),
        };
        await store.putSourceSnapshot(sourceSnapshot);
        if (!isCurrentSelection()) {
          return;
        }
        const reopenedSnapshot = await store.getSourceSnapshot(machine.jobId);
        if (
          reopenedSnapshot === null ||
          JSON.stringify(reopenedSnapshot) !== JSON.stringify(sourceSnapshot)
        ) {
          throw new AnalysisResultStoreError(
            "TRANSACTION_FAILED",
            "The committed source capability snapshot could not be reopened.",
          );
        }
        if (!isCurrentSelection()) {
          return;
        }
        machine = applySourceEvent(machine, {
          type: "CAPABILITY_SNAPSHOT_COMMITTED",
          capabilitySnapshotId,
        });
        setPreflight(result);
        setSourceContentFingerprint(fingerprint.value);
        replaceSourceFile(isUsableVideo ? file : null);
        setSourceCheck(machine);
        if (!isUsableVideo) {
          setSourceError("영상 길이를 읽을 수 있는 비디오 파일이 필요해요. 오디오 파일만으로는 아직 시작할 수 없어요.");
        }
      } catch (error) {
        if (!isCurrentSelection()) {
          return;
        }
        const outcome = reduceSourceCheck(machine, {
          type: "CHECK_FATAL",
          reasonCode:
            error instanceof LocalMediaPreflightError ||
            error instanceof LocalFileFingerprintError ||
            error instanceof AnalysisResultStoreError
              ? error.code
              : error instanceof SourceRebindMismatchError
                ? "SOURCE_FINGERPRINT_MISMATCH"
              : "UNEXPECTED_ERROR",
        });
        if (previousRecoveryBinding !== null) {
          setPendingFileName(previousRecoveryBinding.pendingFileName);
          setPreflight(previousRecoveryBinding.preflight);
          setSourceContentFingerprint(previousRecoveryBinding.sourceContentFingerprint);
          setSourceCheck(previousRecoveryBinding.sourceCheck);
        } else if (outcome.accepted) {
          setSourceCheck(outcome.state);
        }
        const errorMessage =
          error instanceof SourceRebindMismatchError
            ? previousRecoveryBinding === null
              ? "다른 영상이에요. 복원한 후보는 그대로 두었어요. 원래 분석에 사용한 파일을 다시 골라 주세요."
              : "선택한 파일은 다른 영상이라 연결하지 않았어요. 기존에 확인된 원본과 미리보기는 그대로 유지했어요."
            : error instanceof AnalysisResultStoreError
            ? "영상 기본 정보는 읽었지만 사이트 저장 공간에 검사 결과를 확정하지 못했어요. 사이트 저장 권한을 확인해 주세요."
            : error instanceof LocalFileFingerprintError
              ? explainAnalysisError(error)
            : explainPreflightError(error);
        setSourceError(
          previousRecoveryBinding === null || error instanceof SourceRebindMismatchError
            ? errorMessage
            : `${errorMessage} 기존에 확인된 원본 연결은 그대로 유지했어요.`,
        );
        if (error instanceof SourceRebindMismatchError && previousRecoveryBinding === null) {
          setPendingFileName(null);
        }
      } finally {
        if (sourceAbortController.current === controller) {
          sourceAbortController.current = null;
        }
      }
    },
    [
      getResultStore,
      openedRecoveredResult,
      pendingFileName,
      preflight,
      replaceSourceFile,
      resetDownstream,
      sourceCheck,
      sourceContentFingerprint,
      sourceFile,
    ],
  );

  const handleSourceInput = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (
      file !== undefined &&
      !sourceInputLocked &&
      (openedRecoveredResult !== null || confirmDiscardCurrentWork())
    ) {
      void inspectSelectedFile(file);
    }
  };

  const handleSourceDrop = (event: DragEvent<HTMLLabelElement>): void => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (
      file !== undefined &&
      !sourceInputLocked &&
      (openedRecoveredResult !== null || confirmDiscardCurrentWork())
    ) {
      void inspectSelectedFile(file);
    }
  };

  const handleLinkSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setLinkNotice(assessLink(sourceUrl));
  };

  const handleChatInput = (event: ChangeEvent<HTMLInputElement>): void => {
    if (chatInputLocked || !confirmDiscardCurrentWork()) {
      event.currentTarget.value = "";
      return;
    }
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file === undefined) {
      return;
    }
    const epoch = chatSelectionEpoch.current + 1;
    chatSelectionEpoch.current = epoch;
    setChatFileName(file.name);
    setChatImport(null);
    setChatContentFingerprint(null);
    setChatError(null);
    setChatImportStatus("reading");
    resetDownstream();
    if (file.size > MAX_CHAT_FILE_BYTES) {
      setChatImportStatus("failed");
      setChatError("채팅 파일이 32MB보다 커서 이 초기 버전에서 안전하게 열 수 없어요. 필요한 시간대만 나눠서 다시 선택해 주세요.");
      return;
    }
    void file
      .text()
      .then(async (text) => {
        const fingerprint = await createContentFingerprint([
          file.name,
          String(file.size),
          String(file.lastModified),
          text,
        ]);
        if (!isMounted.current || epoch !== chatSelectionEpoch.current) {
          return;
        }
        const result = parseChatImport(text);
        setChatImport(result);
        if (result.messages.length === 0) {
          setChatContentFingerprint(null);
          setChatImportStatus("failed");
          setChatError("시간과 메시지가 들어 있는 채팅 행을 찾지 못했어요. JSON, JSONL 또는 CSV 형식을 확인해 주세요.");
        } else {
          setChatContentFingerprint(fingerprint);
          setChatImportStatus("ready");
        }
      })
      .catch(() => {
        if (!isMounted.current || epoch !== chatSelectionEpoch.current) {
          return;
        }
        setChatImport(null);
        setChatContentFingerprint(null);
        setChatImportStatus("failed");
        setChatError("채팅 파일을 읽지 못했어요. 파일이 다른 프로그램에서 잠겨 있지 않은지 확인해 주세요.");
      });
  };

  const prepareChatRetiming = (): void => {
    if (analysisBusy || !confirmDiscardCurrentWork()) {
      return;
    }
    resetDownstream();
  };

  const runSignalAnalysis = async (): Promise<void> => {
    if (
      !sourceReady ||
      preflight === null ||
      sourceFile === null ||
      sourceCheck === null ||
      sourceContentFingerprint === null ||
      analysisComplete ||
      analysisStartOperation.current !== null ||
      chatImportStatus === "reading"
    ) {
      return;
    }

    analysisAbortController.current?.abort();
    const controller = new AbortController();
    analysisAbortController.current = controller;
    const operationEpoch = analysisOperationEpoch.current + 1;
    analysisOperationEpoch.current = operationEpoch;
    const assertActiveOperation = (): boolean => {
      if (!isMounted.current || operationEpoch !== analysisOperationEpoch.current) {
        return false;
      }
      if (controller.signal.aborted) {
        throw new LocalVideoVisualAnalysisError(
          "ABORTED",
          "사용자가 영상 분석을 취소했어요.",
        );
      }
      return true;
    };

    setSelectionResult(null);
    setCandidates([]);
    setCandidateTimelineScorePoints([]);
    setTimelineSemanticChapters([]);
    setTimelineSemanticChapterRevealCount(0);
    setTimelineInspectionTarget(null);
    setBroadcastTranscriptExplorationCells([]);
    resetCandidateRanking();
    resetBoundarySession();
    setAnalysisError(null);
    setAnalysisCancelPending(false);
    setAnalysisCommitPending(false);
    setAnalysisProgress({
      stage: "loading-metadata",
      completedSampleCount: 0,
      totalSampleCount: 0,
      currentTimestampMs: null,
      ratio: 0,
    });
    setAudioAnalysisProgress({
      stage: "opening-source",
      decodedThroughMs: 0,
      sourceDurationMs: preflight.metadata.durationMs,
      analyzedWindowCount: 0,
      ratio: 0,
    });
    setLastExportFormat(null);
    setCopyStatus("idle");
    setExportError(null);

    const runId = createOperationId("analysis");
    const analysisSpecId = createOperationId("spec");
    const workerEpochValue = 1;
    const chatWorkerInstanceId = createOperationId("chat-worker");
    const chatTaskId = createOperationId("chat-task");
    const audioWorkerInstanceId = createOperationId("audio-worker");
    const audioTaskId = createOperationId("audio-task");
    let inputSignature = "pending";
    let machine: AnalysisRunState | null = null;
    let activeAnalysisTasks: readonly Promise<unknown>[] = [];
    let activeAnalysisTaskCount = 0;
    const trackAnalysisTask = <T,>(task: Promise<T>): Promise<T> => {
      activeAnalysisTaskCount += 1;
      return task.finally(() => {
        activeAnalysisTaskCount = Math.max(0, activeAnalysisTaskCount - 1);
      });
    };
    const store = getResultStore();
    const durableInput: DurableAnalysisInputDescriptor = {
      source: createDurableSourceDescriptor(
        preflight,
        sourceCheck.sourceDefinitionId,
        sourceContentFingerprint,
      ),
      chat: {
        timestampBasis: chatImport?.timestampBasis ?? "unknown",
        importedRowCount: chatImport?.totalRowCount ?? 0,
        offsetMs: Math.round(chatOffsetSeconds * 1_000),
      },
      candidateWindowMs: 45_000,
    };
    analysisStartOperation.current = operationEpoch;
    setAnalysisStartPending(true);

    try {
      inputSignature = await createContentFingerprint([
        sourceContentFingerprint,
        sourceCheck.sourceDefinitionId,
        String(durableInput.source.durationMs),
        chatContentFingerprint ?? "no-chat",
        String(durableInput.chat.offsetMs),
        durableInput.chat.timestampBasis,
        SIGNAL_ENGINE_VERSION,
      ]);
      if (!assertActiveOperation()) {
        return;
      }

      machine = createAnalysisRun({
        runId,
        analysisSpecId,
        sessionId: appSessionId,
        writerEpoch,
        inputSignature,
        modelManifestHash: SIGNAL_ENGINE_VERSION,
        stage: "fastPass",
      });
      machine = applyAnalysisEvent(machine, { type: "RUN_START_REQUESTED" });
      setAnalysisRun(machine);

      await store.putManifest({
        kind: "manifest",
        runId,
        artifactId: createOperationId("manifest"),
        schemaVersion: PERSISTENCE_SCHEMA_VERSION,
        inputSignature,
        modelManifestHash: SIGNAL_ENGINE_VERSION,
        result: {
          input: durableInput,
          signalGapPolicy: {
            policyId: SIGNAL_GAP_POLICY_ID,
            disclosedBeforeStart: true,
            behavior: "complete-with-available-reaction-signals-and-documented-gaps",
          },
        },
        recordedAt: new Date().toISOString(),
      });
      if (!assertActiveOperation()) {
        return;
      }
      machine = applyAnalysisEvent(machine, {
        type: "RUN_MANIFEST_COMMITTED",
        workerEpoch: workerEpochValue,
      });
      setAnalysisRun(machine);

      const visualPromise = trackAnalysisTask(
        analyzeLocalVideoVisuals(sourceFile, {
          signal: controller.signal,
          maxCandidates: 12,
          onProgress: (progress) => {
            if (
              isMounted.current &&
              operationEpoch === analysisOperationEpoch.current &&
              !controller.signal.aborted
            ) {
              setAnalysisProgress(progress);
            }
          },
        }),
      );
      activeAnalysisTasks = [visualPromise];
      const defaultAudioWindowCount = Math.max(
        1,
        Math.ceil(preflight.metadata.durationMs / 1_000),
      );
      const audioPromise = trackAnalysisTask(
        Promise.resolve().then(async (): Promise<AudioAnalysisOutcome> => {
          if (!preflight.capabilities.worker) {
            return {
              result: null,
              gapReasonCode: "WORKER_UNAVAILABLE",
              plannedWindowCount: defaultAudioWindowCount,
              analyzedWindowCount: 0,
              coverageComplete: false,
            };
          }
          try {
            const outcome = await analyzeLocalAudioReactions(sourceFile, {
              identity: {
                sessionId: appSessionId,
                writerEpoch,
                runId,
                workerEpoch: workerEpochValue,
                workerInstanceId: audioWorkerInstanceId,
                taskId: audioTaskId,
              },
              sourceDurationMs: preflight.metadata.durationMs,
              selection: {
                candidateWindowMs: 45_000,
                maxCandidates: 96,
                plannedWindowCount: defaultAudioWindowCount,
              },
              signal: controller.signal,
              onProgress: (progress) => {
                if (
                  isMounted.current &&
                  operationEpoch === analysisOperationEpoch.current &&
                  !controller.signal.aborted
                ) {
                  setAudioAnalysisProgress(progress);
                }
              },
            });
            if (outcome.mode === "local-audio-reaction-unavailable") {
              return {
                result: null,
                gapReasonCode: outcome.reasonCode,
                plannedWindowCount: outcome.plannedWindowCount,
                analyzedWindowCount: 0,
                coverageComplete: false,
              };
            }
            return {
              result: outcome,
              gapReasonCode: outcome.coverageComplete ? null : "WORKER_FAILED",
              plannedWindowCount: outcome.plannedWindowCount,
              analyzedWindowCount: outcome.analyzedWindowCount,
              coverageComplete: outcome.coverageComplete,
            };
          } catch (error) {
            if (error instanceof LocalAudioReactionAnalysisError) {
              if (error.code === "ABORTED") {
                throw error;
              }
              console.warn("Local audio reaction analysis degraded safely.", {
                code: error.code,
                message: error.message,
              });
              return {
                result: null,
                gapReasonCode: durableAudioGapReasonForError(error),
                plannedWindowCount: defaultAudioWindowCount,
                analyzedWindowCount: 0,
                coverageComplete: false,
              };
            }
            throw error;
          }
        }),
      );
      activeAnalysisTasks = [visualPromise, audioPromise];
      const chatPromise = trackAnalysisTask(
        Promise.resolve().then(async (): Promise<ChatAnalysisOutcome> => {
          if (chatImport === null || chatImport.messages.length === 0) {
            return { result: null, gapReasonCode: null };
          }
          if (!preflight.capabilities.worker) {
            return { result: null, gapReasonCode: "WORKER_UNAVAILABLE" };
          }
          try {
            const result = await runChatAnalysisWorker({
              identity: {
                sessionId: appSessionId,
                writerEpoch,
                runId,
                workerEpoch: workerEpochValue,
                workerInstanceId: chatWorkerInstanceId,
                taskId: chatTaskId,
              },
              messages: chatImport.messages,
              options: {
                sourceDurationMs: preflight.metadata.durationMs,
                chatOffsetMs: Math.round(chatOffsetSeconds * 1_000),
                candidateWindowMs: 45_000,
                maxCandidates: 96,
                outOfRangeMode: "exclude",
              },
              signal: controller.signal,
            });
            return { result, gapReasonCode: null };
          } catch (error) {
            if (error instanceof ChatAnalysisWorkerError) {
              if (error.code === "ABORTED") {
                throw error;
              }
              return { result: null, gapReasonCode: error.code };
            }
            throw error;
          }
        }),
      );
      activeAnalysisTasks = [visualPromise, audioPromise, chatPromise];
      const [visualResult, audioOutcome, chatOutcome] = await Promise.all([
        visualPromise,
        audioPromise,
        chatPromise,
      ]);
      if (!assertActiveOperation()) {
        return;
      }
      const chatResult = chatOutcome.result;
      machine = applyAnalysisEvent(machine, { type: "CHUNK_RESULT_READY" });

      const rawFusedCandidates = fuseReactionHighlightCandidates(
        {
          audioCandidates: audioOutcome.result?.candidates ?? [],
          chatCandidates: chatResult?.candidates ?? [],
          visualCandidates: visualResult.candidates,
        },
        {
          sourceDurationMs: preflight.metadata.durationMs,
          candidateWindowMs: 45_000,
          maxCandidates: 96,
          allowUnanchoredVisualExploration: false,
        },
      );

      const fastPassEventEpisodes = buildEventEpisodes(rawFusedCandidates);
      const densityResult = calculateTemporalEventDensity(
        fastPassEventEpisodes.map((episode) => episode.peakMs),
        preflight.metadata.durationMs,
        300_000,
      );

      const selectionResult = selectContextAwareCandidates(
        rawFusedCandidates,
        preflight.metadata.durationMs,
        densityResult.bins,
        [],
        { detailAnalysisBudget: 12, explorationShare: 0.15, qualityLambda: 0.75 },
      );

      const fusedCandidates = selectionResult.candidates;
      setCandidateTimelineScorePoints(
        buildCandidateTimelineScorePoints([
          {
            signalKind: "audio",
            candidates: audioOutcome.result?.candidates ?? [],
          },
          {
            signalKind: "chat",
            candidates: chatResult?.candidates ?? [],
          },
          { signalKind: "visual", candidates: visualResult.candidates },
          { signalKind: "fused", candidates: fusedCandidates },
        ]),
      );
      const summary: AnalysisSelectionSummary = {
        plannedFrameCount: visualResult.plannedSampleCount,
        sampledFrameCount: visualResult.sampledFrameCount,
        analyzedTransitionCount: visualResult.analyzedTransitionCount,
        analyzedChatMessageCount: chatResult?.analyzedMessageCount ?? 0,
        outOfRangeChatMessageCount: chatResult?.outOfRangeMessageCount ?? 0,
        skippedChatMessageCount:
          chatOutcome.gapReasonCode === null ? 0 : (chatImport?.messages.length ?? 0),
        chatGapReasonCode: chatOutcome.gapReasonCode,
        plannedAudioWindowCount: audioOutcome.plannedWindowCount,
        analyzedAudioWindowCount: audioOutcome.analyzedWindowCount,
        audioGapReasonCode: audioOutcome.gapReasonCode,
        candidateCount: fusedCandidates.length,
      };
      const chatPlannedMessageCount = chatImport?.messages.length ?? 0;
      const chatProcessedMessageCount =
        (chatResult?.analyzedMessageCount ?? 0) +
        (chatResult?.invalidMessageCount ?? 0) +
        (chatResult?.outOfRangeMessageCount ?? 0);
      const gapApprovals: DurableGapApprovalRecord[] = [];
      if (audioOutcome.gapReasonCode !== null) {
        gapApprovals.push({
          gapId: DURABLE_AUDIO_GAP_ID,
          reason: audioOutcome.gapReasonCode,
          approvedBy: SIGNAL_GAP_POLICY_ID,
        });
      }
      if (chatOutcome.gapReasonCode !== null) {
        gapApprovals.push({
          gapId: DURABLE_CHAT_GAP_ID,
          reason: chatOutcome.gapReasonCode,
          approvedBy: SIGNAL_GAP_POLICY_ID,
        });
      }
      const signalGapApproval: AnalysisGapApprovalEvidence | null =
        gapApprovals.length === 0
          ? null
          : {
              policyId: SIGNAL_GAP_POLICY_ID,
              disclosedBeforeStart: true,
              approvals: gapApprovals,
            };
      const coverage: AnalysisCoverageSummary = {
        visualPlannedSampleCount: visualResult.plannedSampleCount,
        visualCompletedSampleCount: visualResult.sampledFrameCount,
        visualCoverageComplete: visualResult.coverageComplete,
        chatPlannedMessageCount,
        chatProcessedMessageCount,
        chatCoverageComplete: chatProcessedMessageCount === chatPlannedMessageCount,
        chatGapReasonCode: chatOutcome.gapReasonCode,
        audioPlannedWindowCount: audioOutcome.plannedWindowCount,
        audioProcessedWindowCount: audioOutcome.analyzedWindowCount,
        audioCoverageComplete: audioOutcome.coverageComplete,
        audioGapReasonCode: audioOutcome.gapReasonCode,
        signalGapApproval,
        activeTaskCountAtCommit: activeAnalysisTaskCount,
      };
      if (
        !coverage.visualCoverageComplete ||
        coverage.visualCompletedSampleCount !== coverage.visualPlannedSampleCount ||
        (!coverage.chatCoverageComplete &&
          (coverage.chatGapReasonCode === null || coverage.signalGapApproval == null)) ||
        (!coverage.audioCoverageComplete &&
          (coverage.audioGapReasonCode == null || coverage.signalGapApproval == null)) ||
        coverage.chatProcessedMessageCount > coverage.chatPlannedMessageCount ||
        audioOutcome.analyzedWindowCount > audioOutcome.plannedWindowCount ||
        coverage.activeTaskCountAtCommit !== 0
      ) {
        throw new AnalysisResultStoreError(
          "TRANSACTION_FAILED",
          "The analysis tasks settled without complete persisted coverage evidence.",
        );
      }
      const finalPayload: DurableFinalResultPayload = {
        input: durableInput,
        summary,
        coverage,
        candidates: fusedCandidates.map(toDurableCandidate),
      };

      await store.putProvisionalResult({
        kind: "provisionalResult",
        runId,
        artifactId: createOperationId("provisional"),
        schemaVersion: PERSISTENCE_SCHEMA_VERSION,
        inputSignature,
        modelManifestHash: SIGNAL_ENGINE_VERSION,
        result: finalPayload,
        recordedAt: new Date().toISOString(),
      });
      if (!assertActiveOperation()) {
        return;
      }
      machine = applyAnalysisEvent(machine, { type: "CHUNK_COMMIT_SUCCEEDED" });
      const coverageDisposition = durableCoverageDisposition(coverage);
      if (coverageDisposition === "completed") {
        machine = applyAnalysisEvent(machine, {
          type: "ALL_PLANNED_INTERVALS_COVERED",
          activeChunkCount: coverage.activeTaskCountAtCommit,
        });
      } else {
        machine = applyAnalysisEvent(machine, {
          type: "UNRESOLVED_GAPS_FOUND",
          unresolvedGapCount: gapApprovals.length,
          allGapsDocumented:
            gapApprovals.length > 0 && signalGapApproval !== null,
        });
        machine = applyAnalysisEvent(machine, {
          type: "GAPS_ACCEPTED_BY_EXPLICIT_POLICY",
          policyId: signalGapApproval?.policyId ?? "",
          disclosedBeforeStart: signalGapApproval?.disclosedBeforeStart ?? false,
          approvals: signalGapApproval?.approvals ?? [],
        });
      }
      setAnalysisCommitPending(true);
      setAnalysisRun(machine);
      if (analysisAbortController.current === controller) {
        analysisAbortController.current = null;
      }

      const finalResultCommitId = createOperationId("result");
      await store.putFinalResult({
        kind: "finalResult",
        runId,
        artifactId: finalResultCommitId,
        schemaVersion: PERSISTENCE_SCHEMA_VERSION,
        inputSignature,
        modelManifestHash: SIGNAL_ENGINE_VERSION,
        result: finalPayload,
        recordedAt: new Date().toISOString(),
      });
      if (!isMounted.current || operationEpoch !== analysisOperationEpoch.current) {
        return;
      }
      machine = applyAnalysisEvent(machine, {
        type: "FINAL_RESULT_COMMITTED",
        commitId: finalResultCommitId,
      });
      setAnalysisRun(machine);

      const reopened = await store.getFinalResult(runId);
      if (
        reopened === null ||
        reopened.artifactId !== finalResultCommitId ||
        reopened.inputSignature !== inputSignature ||
        reopened.modelManifestHash !== SIGNAL_ENGINE_VERSION ||
        JSON.stringify(reopened.result) !== JSON.stringify(finalPayload)
      ) {
        throw new AnalysisResultStoreError(
          "TRANSACTION_FAILED",
          "The committed analysis result could not be reopened and verified.",
        );
      }
      if (!isMounted.current || operationEpoch !== analysisOperationEpoch.current) {
        return;
      }

      const reopenedPayload = reopened.result;
      const reopenedCoverage = reopenedPayload.coverage;
      const terminalOutcome = durableCoverageDisposition(reopenedCoverage);
      const plannedCoverageComplete =
        terminalOutcome === "completed" &&
        reopenedCoverage.visualCoverageComplete &&
        reopenedCoverage.visualCompletedSampleCount ===
          reopenedCoverage.visualPlannedSampleCount &&
        reopenedCoverage.chatCoverageComplete &&
        reopenedCoverage.chatProcessedMessageCount ===
          reopenedCoverage.chatPlannedMessageCount &&
        reopenedCoverage.audioCoverageComplete === true &&
        reopenedCoverage.audioProcessedWindowCount ===
          reopenedCoverage.audioPlannedWindowCount;
      const reopenedGapCount =
        (reopenedCoverage.chatCoverageComplete ? 0 : 1) +
        (reopenedCoverage.audioCoverageComplete === false ? 1 : 0);
      const gappedCoverageExplained =
        terminalOutcome === "completedWithGaps" &&
        reopenedGapCount > 0 &&
        reopenedCoverage.signalGapApproval?.policyId === SIGNAL_GAP_POLICY_ID &&
        reopenedCoverage.signalGapApproval.disclosedBeforeStart &&
        reopenedCoverage.signalGapApproval.approvals.length === reopenedGapCount;
      const terminalRecord = {
        kind: "terminalDisposition" as const,
        runId,
        schemaVersion: PERSISTENCE_SCHEMA_VERSION,
        inputSignature,
        modelManifestHash: SIGNAL_ENGINE_VERSION,
        outcome: terminalOutcome,
        resultRecordKind: "finalResult" as const,
        resultArtifactId: finalResultCommitId,
        recordedAt: new Date().toISOString(),
      };
      await store.putTerminalRecord(terminalRecord);
      const reopenedTerminal = await store.getTerminalRecord(runId);
      if (
        reopenedTerminal === null ||
        JSON.stringify(reopenedTerminal) !== JSON.stringify(terminalRecord)
      ) {
        throw new AnalysisResultStoreError(
          "TRANSACTION_FAILED",
          "The terminal analysis disposition could not be reopened and verified.",
        );
      }
      if (!isMounted.current || operationEpoch !== analysisOperationEpoch.current) {
        return;
      }

      machine = plannedCoverageComplete
        ? applyAnalysisEvent(machine, {
            type: "FULL_RESULT_REOPEN_VERIFIED",
            plannedCoverageComplete,
            activeChunkCount: reopenedCoverage.activeTaskCountAtCommit,
          })
        : applyAnalysisEvent(machine, {
            type: "GAPPED_RESULT_REOPEN_VERIFIED",
            plannedCoverageExplained: gappedCoverageExplained,
            acceptedGapsHaveApproval: gappedCoverageExplained,
            activeChunkCount: reopenedCoverage.activeTaskCountAtCommit,
          });
      if (machine.status !== "completed" && machine.status !== "completedWithGaps") {
        throw new AnalysisResultStoreError(
          "TRANSACTION_FAILED",
          "The reopened analysis result did not prove complete coverage.",
        );
      }
      const reopenedCandidates = reopenedPayload.candidates.map((candidate) => ({
          ...hydrateDurableCandidate(candidate),
          reviewState: "unreviewed" as const,
          approvedBoundaryRevision: null,
        }));
      setSelectionResult(reopenedPayload.summary);
      setCandidates(reopenedCandidates);
      setCandidateTimelineScorePoints(
        buildCandidateTimelineScorePoints([
          { signalKind: "fused", candidates: reopenedCandidates },
        ]),
      );
      resetCandidateRanking(reopenedCandidates);
      setAnalysisRun(machine);
      setAnalysisProgress(null);
      setAudioAnalysisProgress(null);
      void refreshRecoveryCatalog();
    } catch (error) {
      const wasCancelled =
        controller.signal.aborted ||
        (error instanceof LocalVideoVisualAnalysisError && error.code === "ABORTED") ||
        (error instanceof LocalAudioReactionAnalysisError && error.code === "ABORTED") ||
        (error instanceof ChatAnalysisWorkerError && error.code === "ABORTED");

      controller.abort();
      await Promise.allSettled(activeAnalysisTasks);

      if (!isMounted.current || operationEpoch !== analysisOperationEpoch.current) {
        return;
      }

      if (!wasCancelled && machine?.status === "completing") {
        try {
          const durableAudit = await auditRecoverableAnalysisResults(store, 5);
          const durableCompletion = durableAudit.results.find(
            ({ terminal }) => terminal.runId === runId,
          );
          if (durableCompletion !== undefined) {
            const durableCoverage = durableCompletion.finalResult.result.coverage;
            const completedMachine =
              durableCompletion.terminal.outcome === "completed"
                ? applyAnalysisEvent(machine, {
                    type: "FULL_RESULT_REOPEN_VERIFIED",
                    plannedCoverageComplete: true,
                    activeChunkCount: durableCoverage.activeTaskCountAtCommit,
                  })
                : applyAnalysisEvent(machine, {
                    type: "GAPPED_RESULT_REOPEN_VERIFIED",
                    plannedCoverageExplained: true,
                    acceptedGapsHaveApproval: true,
                    activeChunkCount: durableCoverage.activeTaskCountAtCommit,
                  });
            if (
              completedMachine.status === "completed" ||
              completedMachine.status === "completedWithGaps"
            ) {
              const completedCandidates =
                durableCompletion.finalResult.result.candidates.map((candidate) => ({
                  ...hydrateDurableCandidate(candidate),
                  reviewState: "unreviewed" as const,
                  approvedBoundaryRevision: null,
                }));
              setSelectionResult(durableCompletion.finalResult.result.summary);
              setCandidates(completedCandidates);
              setCandidateTimelineScorePoints(
                buildCandidateTimelineScorePoints([
                  { signalKind: "fused", candidates: completedCandidates },
                ]),
              );
              resetCandidateRanking(completedCandidates);
              setAnalysisRun(completedMachine);
              setAnalysisProgress(null);
              setAudioAnalysisProgress(null);
              setAnalysisError(null);
              setRecoveryCatalog({ status: "ready", audit: durableAudit });
              return;
            }
          }
        } catch {
          // Continue into the ordinary failure path when durable completion cannot be proven.
        }
      }

      const cancellation =
        machine !== null && wasCancelled
          ? reduceAnalysisRun(machine, { type: "CANCEL_REQUESTED" })
          : null;
      if (cancellation?.accepted === true) {
          let cancelled = applyAnalysisEvent(cancellation.state, {
            type: "WORKERS_TERMINATED",
          });
          try {
            const failureArtifactId = createOperationId("failure");
            await store.putFailureRecord({
              kind: "failure",
              runId,
              artifactId: failureArtifactId,
              schemaVersion: PERSISTENCE_SCHEMA_VERSION,
              inputSignature,
              modelManifestHash: SIGNAL_ENGINE_VERSION,
              result: {
                outcome: "cancelled",
                fenceEpoch: cancelled.fenceEpoch,
              },
              recordedAt: new Date().toISOString(),
            });
            const terminalRecord = {
              kind: "terminalDisposition" as const,
              runId,
              schemaVersion: PERSISTENCE_SCHEMA_VERSION,
              inputSignature,
              modelManifestHash: SIGNAL_ENGINE_VERSION,
              outcome: "cancelled" as const,
              resultRecordKind: "failure" as const,
              resultArtifactId: failureArtifactId,
              recordedAt: new Date().toISOString(),
            };
            await store.putTerminalRecord(terminalRecord);
            const reopenedTerminal = await store.getTerminalRecord(runId);
            if (
              reopenedTerminal === null ||
              JSON.stringify(reopenedTerminal) !== JSON.stringify(terminalRecord)
            ) {
              throw new AnalysisResultStoreError(
                "TRANSACTION_FAILED",
                "The cancellation disposition could not be reopened and verified.",
              );
            }
            if (!isMounted.current || operationEpoch !== analysisOperationEpoch.current) {
              return;
            }
            cancelled = applyAnalysisEvent(cancelled, {
              type: "CANCELLATION_COMMITTED",
              writeFenceCommitted: true,
              writerEpochInvalidated: false,
            });
            setAnalysisRun(cancelled);
          } catch (commitError) {
            if (!isMounted.current || operationEpoch !== analysisOperationEpoch.current) {
              return;
            }
            setAnalysisRun(null);
            setAnalysisProgress(null);
            setAudioAnalysisProgress(null);
            setAnalysisError(
              `분석은 멈췄지만 종료 기록을 다시 확인하지 못했어요. 입력은 잠금 해제했으며 기존 기록은 덮어쓰지 않았습니다. ${explainAnalysisError(commitError)}`,
            );
            return;
          }
      } else if (machine !== null) {
        const failure = reduceAnalysisRun(machine, {
          type: "FATAL_ERROR",
          reasonCode: "LOCAL_ANALYSIS_FAILED",
        });
        if (failure.accepted) {
          setAnalysisRun(failure.state);
          try {
            const failureArtifactId = createOperationId("failure");
            await store.putFailureRecord({
              kind: "failure",
              runId,
              artifactId: failureArtifactId,
              schemaVersion: PERSISTENCE_SCHEMA_VERSION,
              inputSignature,
              modelManifestHash: SIGNAL_ENGINE_VERSION,
              result: { outcome: "failed", reasonCode: "LOCAL_ANALYSIS_FAILED" },
              recordedAt: new Date().toISOString(),
            });
            const terminalRecord = {
              kind: "terminalDisposition" as const,
              runId,
              schemaVersion: PERSISTENCE_SCHEMA_VERSION,
              inputSignature,
              modelManifestHash: SIGNAL_ENGINE_VERSION,
              outcome: "failed" as const,
              resultRecordKind: "failure" as const,
              resultArtifactId: failureArtifactId,
              recordedAt: new Date().toISOString(),
            };
            await store.putTerminalRecord(terminalRecord);
            const reopenedTerminal = await store.getTerminalRecord(runId);
            if (
              reopenedTerminal === null ||
              JSON.stringify(reopenedTerminal) !== JSON.stringify(terminalRecord)
            ) {
              throw new AnalysisResultStoreError(
                "TRANSACTION_FAILED",
                "The failure disposition could not be reopened and verified.",
              );
            }
            if (!isMounted.current || operationEpoch !== analysisOperationEpoch.current) {
              return;
            }
            const committed = reduceAnalysisRun(failure.state, {
              type: "FAILURE_RECORD_COMMITTED",
            });
            setAnalysisRun(committed.accepted ? committed.state : failure.state);
          } catch (commitError) {
            if (!isMounted.current || operationEpoch !== analysisOperationEpoch.current) {
              return;
            }
            setAnalysisRun(null);
            setAnalysisProgress(null);
            setAudioAnalysisProgress(null);
            setAnalysisError(
              `종료 상태를 다시 확인하지 못해 입력 잠금을 풀었어요. 이미 기록된 완료 결과는 덮어쓰지 않았습니다. 위의 지난 결과 목록을 다시 확인해 주세요. ${explainAnalysisError(commitError)}`,
            );
            void refreshRecoveryCatalog();
            return;
          }
        }
      }
      setAnalysisProgress(null);
      setAudioAnalysisProgress(null);
      setAnalysisError(explainAnalysisError(error));
    } finally {
      if (analysisStartOperation.current === operationEpoch) {
        analysisStartOperation.current = null;
        if (isMounted.current) {
          setAnalysisStartPending(false);
          setAnalysisCancelPending(false);
          setAnalysisCommitPending(false);
        }
      }
      if (analysisAbortController.current === controller) {
        analysisAbortController.current = null;
      }
    }
  };

  const cancelAnalysis = (): void => {
    const controller = analysisAbortController.current;
    if (analysisCancelPending || analysisCommitPending || controller === null) {
      return;
    }
    setAnalysisCancelPending(true);
    controller.abort();
    // The uniform transcript prefetch spends against the same consent as the
    // run, so cancelling the run stops it too. The fence stays cleared and the
    // gate blocks a restart because the run is no longer live.
    if (broadcastTranscriptAbortController.current !== null) {
      broadcastTranscriptAbortController.current.abort();
      broadcastTranscriptAbortController.current = null;
      autoBroadcastTranscriptSourceRef.current = null;
      setBroadcastTranscriptStatus("idle");
      setBroadcastTranscriptProgress(null);
      setBroadcastTranscriptError(null);
    }
  };

  const applyCandidatePassBEvent = useCallback(
    (event: CandidatePassBRunEvent): boolean => {
      const current = candidatePassBMachine.current;
      if (current === null) {
        return false;
      }
      const transition = reduceCandidatePassBRun(current, event);
      if (!transition.accepted) {
        return false;
      }
      candidatePassBMachine.current = transition.state;
      setCandidatePassBRun(transition.state);
      return true;
    },
    [],
  );

  const queueCandidatePassBInsightPersistence = (
    evidenceById: CandidatePassBEvidenceById,
    insightById: CandidateGeminiInsightById,
    thumbnailById: CandidateTimelineThumbnailById = firstTimelineFrameById(
      candidateTimelineFramesRef.current,
    ),
    modelByCandidateId: CandidatePassBModelById =
      candidatePassBModelByIdRef.current,
    verificationReceiptById: CandidatePassBVerificationReceiptById =
      candidatePassBVerificationReceiptRef.current,
  ): void => {
    const runId = currentAnalysisRunId;
    const inputSignature =
      openedRecoveredResult?.terminal.inputSignature ??
      analysisRun?.inputSignature ??
      sourceContentFingerprint;
    if (runId === null || inputSignature === null) {
      return;
    }
    const writeEpoch = candidatePassBInsightWriteEpochRef.current;
    const record: CandidatePassBInsightsRecord = {
      kind: "candidatePassBInsights",
      runId,
      schemaVersion: CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION,
      inputSignature,
      modelManifestHash: CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
      evidenceById,
      insightById,
      ...(Object.keys(modelByCandidateId).length > 0 ? { modelByCandidateId } : {}),
      ...(Object.keys(thumbnailById).length > 0 ? { thumbnailById } : {}),
      ...(Object.keys(verificationReceiptById).length > 0
        ? { verificationReceiptById }
        : {}),
      recordedAt: new Date().toISOString(),
    };
    candidatePassBInsightWriteChainRef.current = candidatePassBInsightWriteChainRef.current
      .catch(() => undefined)
      .then(async () => {
        if (candidatePassBInsightWriteEpochRef.current !== writeEpoch) {
          return;
        }
        await getResultStore().putCandidatePassBInsights(record);
      })
      .catch(() => {
        if (isMounted.current && candidatePassBIdentity.current?.analysisRunId === runId) {
          setCandidatePassBError(
            "AI 결과를 브라우저 기록에 저장하지 못했어요. 현재 화면의 결과는 계속 확인할 수 있어요.",
          );
        }
      });
  };

  const flushCandidatePassBInsightPersistence = async (): Promise<void> => {
    await candidatePassBInsightWriteChainRef.current.catch(() => undefined);
  };

  const runCandidatePassB = async (
    targetCandidateIds?: readonly string[],
  ): Promise<void> => {
    const requestedCandidateIds =
      targetCandidateIds === undefined ? null : new Set(targetCandidateIds);
    const requestedCandidatePool =
      requestedCandidateIds === null
        ? candidates
        : candidates.filter((candidate) => requestedCandidateIds.has(candidate.id));
    const candidatePool = requestedCandidatePool.filter(
      (candidate) => candidatePassBContextById[candidate.id] !== undefined,
    );
    const sourceBindingId =
      sourceContentFingerprint ??
      openedRecoveredResult?.finalResult.result.input.source.contentFingerprint ??
      null;
    if (
      sourceFile === null ||
      preflight === null ||
      currentAnalysisRunId === null ||
      sourceBindingId === null ||
      candidatePool.length === 0 ||
      analysisBusy ||
      candidatePassBBusy ||
      candidateAudioEventBusy ||
      candidateAudioEventStartPendingRef.current ||
      candidatePassBStartPendingRef.current ||
      !candidatePassBRuntimeAvailable ||
      (candidatePassBMachine.current !== null &&
        !["completed", "completedWithGaps", "cancelled", "failed"].includes(
          candidatePassBMachine.current.status,
        ))
    ) {
      return;
    }

    candidatePassBStartPendingRef.current = true;
    setCandidatePassBStartPending(true);
    candidatePassBOperationEpoch.current += 1;
    const operationEpoch = candidatePassBOperationEpoch.current;
    const runtimeDevice = "remote" as const;

    const sourceDurationMs = Math.round(preflight.metadata.durationMs);
    let targets: readonly CandidatePassBCoreTarget[];
    try {
      targets = selectCandidatePassBTargets(candidatePool, {
        sourceDurationMs,
        maxCandidates: Math.min(12, candidatePool.length),
      });
    } catch {
      candidatePassBStartPendingRef.current = false;
      setCandidatePassBStartPending(false);
      setCandidatePassBError(
        "AI로 확인할 후보 시간을 읽지 못했어요. 빠른 분석을 다시 실행해 주세요.",
      );
      return;
    }
    if (targets.length === 0) {
      candidatePassBStartPendingRef.current = false;
      setCandidatePassBStartPending(false);
      return;
    }

    candidatePassBAbortController.current?.abort();
    const controller = new AbortController();
    candidatePassBAbortController.current = controller;
    setCandidatePassBError(null);
    const videoFramesByCandidateId = new Map<
      string,
      readonly CandidatePassBVideoFrame[]
    >();
    const identity: CandidatePassBWorkerIdentity = {
      sessionId: appSessionId,
      writerEpoch,
      analysisRunId: currentAnalysisRunId,
      passBRunId: createOperationId("pass-b"),
      workerEpoch: operationEpoch,
      workerInstanceId: createOperationId("pass-b-worker"),
      taskId: createOperationId("pass-b-task"),
    };
    const machine = createCandidatePassBRun({
      identity,
      sourceBinding: {
        sourceBindingId,
        sourceBindingRevision: 0,
        sourceDurationMs,
      },
      model: {
        modelId: CANDIDATE_PASS_B_ROUTING_MODEL_ID,
        modelRevision: CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
        runtimeDevice,
      },
      candidates: targets.map((target) => ({
        candidateId: target.candidateId,
        proposalRevision: 0,
        proposalRange: {
          startMs: target.decodeStartMs,
          endMs: target.decodeEndMs,
        },
        peakMs: target.reactionPeakMs,
      })),
    });
    candidatePassBMachine.current = machine;
    candidatePassBIdentity.current = identity;
    candidatePassBStartPendingRef.current = false;
    setCandidatePassBStartPending(false);
    setCandidatePassBRun(machine);
    setCandidatePassBModelProgress(null);
    setCandidatePassBCandidateProgress(null);
    setCandidatePassBActiveCandidateIds([]);
    setCandidatePassBError(null);
    if (!applyCandidatePassBEvent({ type: "START_REQUESTED" })) {
      setCandidatePassBError("AI 후보 분석을 시작하지 못했어요. 다시 시도해 주세요.");
      return;
    }
    if (
      !applyCandidatePassBEvent({
        ...identity,
        eventId: createOperationId("pass-b-event"),
        type: "WORKER_PREPARED",
      })
    ) {
      setCandidatePassBError("AI 후보 분석 작업을 준비하지 못했어요. 다시 시도해 주세요.");
      return;
    }

    const isCurrentOperation = (): boolean =>
      isMounted.current &&
      operationEpoch === candidatePassBOperationEpoch.current &&
      candidatePassBIdentity.current?.passBRunId === identity.passBRunId;
    const targetById = new Map(targets.map((target) => [target.candidateId, target]));
    const castRosterId = sourceCastRosterId;
    const applyCurrentWorkerEvent = (
      event: CandidatePassBWorkerEventPayload,
    ): boolean => {
      if (!isCurrentOperation()) {
        return false;
      }
      return applyCandidatePassBEvent({
        ...identity,
        eventId: createOperationId("pass-b-event"),
        ...event,
      });
    };

    try {
      const frameBundleResolvers = new Map<
        string,
        {
          readonly promise: Promise<CandidateVideoFrameBundleResult>;
          readonly resolve: (result: CandidateVideoFrameBundleResult) => void;
          readonly reject: (error: unknown) => void;
          settled: boolean;
        }
      >();
      for (const target of targets) {
        let resolveBundle!: (result: CandidateVideoFrameBundleResult) => void;
        let rejectBundle!: (error: unknown) => void;
        const promise = new Promise<CandidateVideoFrameBundleResult>((resolve, reject) => {
          resolveBundle = resolve;
          rejectBundle = reject;
        });
        frameBundleResolvers.set(target.candidateId, {
          promise,
          resolve: resolveBundle,
          reject: rejectBundle,
          settled: false,
        });
      }
      const frameProducer = produceCandidateVideoFrameBundles(
        sourceFile,
        targets.map((target) => ({
          candidateId: target.candidateId,
          startMs: target.decodeStartMs,
          endMs: target.decodeEndMs,
          focusMs: target.reactionPeakMs,
        })),
        {
          signal: controller.signal,
          onBundle: (result) => {
            const slot = frameBundleResolvers.get(result.candidateId);
            if (slot === undefined || slot.settled) return;
            slot.settled = true;
            slot.resolve(result);
          },
        },
      ).catch((error: unknown) => {
        const producerError = error instanceof Error
          ? error
          : new Error("대표 화면 준비 중 알 수 없는 오류가 발생했습니다.");
        for (const slot of frameBundleResolvers.values()) {
          if (slot.settled) continue;
          slot.settled = true;
          slot.reject(producerError);
        }
        return [];
      });
      const workerResults = await mapWithConcurrency(
        targets,
        2,
        async (target, targetIndex) => {
          setCandidatePassBActiveCandidateIds((current) =>
            current.includes(target.candidateId)
              ? current
              : [...current, target.candidateId],
          );
          try {
            const frameBundle = await frameBundleResolvers.get(target.candidateId)?.promise;
            if (frameBundle === undefined) {
              throw new Error("The candidate frame queue lost its target slot.");
            }
            const frames = frameBundle.frames;
            videoFramesByCandidateId.set(target.candidateId, frames);
            if (
              frameBundle.status === "ready" &&
              !controller.signal.aborted &&
              isMounted.current
            ) {
              const relativePeakMs = target.reactionPeakMs - target.decodeStartMs;
              const timelineFrame = [...frames].sort(
                (left, right) =>
                  Math.abs(left.timestampMs - relativePeakMs) -
                  Math.abs(right.timestampMs - relativePeakMs),
              )[0];
              candidateTimelineFramesRef.current = {
                ...candidateTimelineFramesRef.current,
                [target.candidateId]:
                  timelineFrame === undefined ? [] : [timelineFrame],
              };
              setCandidateTimelineFramesById(candidateTimelineFramesRef.current);
              queueCandidatePassBInsightPersistence(
                candidatePassBEvidenceRef.current,
                candidateGeminiInsightRef.current,
                firstTimelineFrameById(candidateTimelineFramesRef.current),
              );
            }
            if (frameBundle.status !== "ready") {
              if (
                !applyCurrentWorkerEvent({
                  type: "CANDIDATE_FAILED",
                  candidateId: target.candidateId,
                  expectedProposalRevision: 0,
                  reasonCode: "visual_evidence_incomplete",
                })
              ) {
                throw new Error("The incomplete frame bundle was rejected.");
              }
              return {
                summary: {
                  requestedCount: 1,
                  completedCount: 0,
                  gapCount: 1,
                },
              };
            }
            return await runCandidatePassBWorker(sourceFile, {
        identity,
        sourceDurationMs,
        device: runtimeDevice,
        targets: [{
          candidateId: target.candidateId,
          startMs: target.decodeStartMs,
          endMs: target.decodeEndMs,
          videoFrames: videoFramesByCandidateId.get(target.candidateId) ?? [],
          context: candidatePassBContextById[target.candidateId]!,
          outputLanguage: analysisLanguage,
          ...(castRosterId === null ? {} : { castRosterId }),
        }],
        signal: controller.signal,
        onModelProgress: (progress) => {
          if (!isCurrentOperation()) {
            return;
          }
          setCandidatePassBModelProgress(progress);
          if (
            progress.stage === "ready" &&
            candidatePassBMachine.current?.status === "loadingModel" &&
            !applyCurrentWorkerEvent({ type: "MODEL_READY" })
          ) {
            throw new Error("The Pass B model-ready event was rejected.");
          }
        },
        onCandidateProgress: (progress) => {
          if (isCurrentOperation()) {
            setCandidatePassBCandidateProgress({
              ...progress,
              candidateOrdinal: targetIndex + 1,
              targetCount: targets.length,
            });
          }
        },
        onPartialResult: (result: CandidatePassBTranscriptResult) => {
          const target = targetById.get(result.candidateId);
          if (!isCurrentOperation() || target === undefined) {
            return;
          }
          const evidence = buildCandidatePassBEvidence(
            target,
            result.segments.map((segment) => ({
              relativeStartMs: segment.startMs - target.decodeStartMs,
              relativeEndMs: segment.endMs - target.decodeStartMs,
              text: segment.text,
            })),
          );
          const accepted =
            evidence.status !== "fast-pass-fallback"
              ? applyCurrentWorkerEvent({
                  type: "CANDIDATE_CLUE_FOUND",
                  candidateId: evidence.candidateId,
                  expectedProposalRevision: 0,
                  clueCount: evidence.cues.length,
                })
              : applyCurrentWorkerEvent({
                  type: "CANDIDATE_NO_CLEAR_SPEECH",
                  candidateId: evidence.candidateId,
                  expectedProposalRevision: 0,
                  reasonCode: candidatePassBNoClearReason(evidence),
                  workerDisposition: "result",
                });
          if (!accepted) {
            throw new Error("The Pass B candidate result was rejected.");
          }
          if (isCurrentOperation()) {
            const context = candidatePassBContextById[result.candidateId];
            const frames = videoFramesByCandidateId.get(result.candidateId) ?? [];
            const thumbnail =
              candidateTimelineFramesRef.current[result.candidateId]?.[0];
            const receipt =
              context === undefined || thumbnail === undefined
                ? null
                : createCandidatePassBVerificationReceipt(
                    context,
                    frames,
                    thumbnail.timestampMs,
                  );
            if (receipt === null) {
              throw new Error(
                "The candidate result arrived without a complete context, frame and thumbnail receipt.",
              );
            }
            const nextEvidence = mergeCandidatePassBEvidence(
              candidatePassBEvidenceRef.current,
              evidence,
            );
            const nextInsights = {
              ...candidateGeminiInsightRef.current,
              [result.candidateId]: result.insight,
            };
            const nextModels: CandidatePassBModelById = {
              ...candidatePassBModelByIdRef.current,
              [result.candidateId]: {
                id: result.model.id,
                revision: result.model.revision,
              },
            };
            const nextReceipts = {
              ...candidatePassBVerificationReceiptRef.current,
              [result.candidateId]: receipt,
            };
            candidatePassBEvidenceRef.current = nextEvidence;
            candidateGeminiInsightRef.current = nextInsights;
            candidatePassBModelByIdRef.current = nextModels;
            candidatePassBVerificationReceiptRef.current = nextReceipts;
            setCandidatePassBEvidenceById(nextEvidence);
            setCandidateGeminiInsightById(nextInsights);
            setCandidatePassBVerificationReceiptById(nextReceipts);
            queueCandidatePassBInsightPersistence(
              nextEvidence,
              nextInsights,
              firstTimelineFrameById(candidateTimelineFramesRef.current),
              nextModels,
            );
          }
        },
        onCandidateGap: (gap: CandidatePassBCandidateGap) => {
          const target = targetById.get(gap.candidateId);
          if (!isCurrentOperation() || target === undefined) {
            return;
          }
          if (
            candidatePassBMachine.current?.status === "loadingModel" &&
            !applyCurrentWorkerEvent({
              type: "MODEL_BYPASSED",
              reasonCode:
                gap.reasonCode === "UNSUPPORTED_CONTAINER" ||
                gap.reasonCode === "UNSUPPORTED_AUDIO_CODEC"
                  ? "source_audio_unsupported"
                  : "source_audio_unavailable",
            })
          ) {
            throw new Error("The Pass B model-bypass event was rejected.");
          }
          if (gap.reasonCode === "EMPTY_AUDIO") {
            const evidence = buildCandidatePassBEvidence(target, [
              {
                relativeStartMs: 0,
                relativeEndMs: Math.min(1_000, target.decodeEndMs - target.decodeStartMs),
                text: "",
                isSilence: true,
              },
            ]);
            if (
              !applyCurrentWorkerEvent({
                type: "CANDIDATE_NO_CLEAR_SPEECH",
                candidateId: gap.candidateId,
                expectedProposalRevision: 0,
                reasonCode: "no_speech",
                workerDisposition: "gap",
              })
            ) {
              throw new Error("The Pass B no-speech result was rejected.");
            }
            if (isCurrentOperation()) {
              const nextEvidence = mergeCandidatePassBEvidence(
                candidatePassBEvidenceRef.current,
                evidence,
              );
              candidatePassBEvidenceRef.current = nextEvidence;
              setCandidatePassBEvidenceById(nextEvidence);
              queueCandidatePassBInsightPersistence(
                nextEvidence,
                candidateGeminiInsightRef.current,
              );
            }
            return;
          }
          if (
            !applyCurrentWorkerEvent({
              type: "CANDIDATE_FAILED",
              candidateId: gap.candidateId,
              expectedProposalRevision: 0,
              reasonCode: candidatePassBFailureReason(gap),
            })
          ) {
            throw new Error("The Pass B candidate gap was rejected.");
          }
        },
        onCancellationAcknowledged: () => {
          if (
            isCurrentOperation() &&
            candidatePassBMachine.current?.status === "cancelling" &&
            !applyCurrentWorkerEvent({ type: "CANCEL_ACKNOWLEDGED" })
          ) {
            throw new Error("The Pass B cancellation acknowledgement was rejected.");
          }
        },
      });
          } finally {
            setCandidatePassBActiveCandidateIds((current) =>
              current.filter((candidateId) => candidateId !== target.candidateId),
            );
          }
        },
      );
      await frameProducer;
      await flushCandidatePassBInsightPersistence();
      if (!isCurrentOperation()) {
        return;
      }
      const workerSummary = workerResults.reduce(
        (summary, result) => ({
          requestedCount: summary.requestedCount + result.summary.requestedCount,
          completedCount: summary.completedCount + result.summary.completedCount,
          gapCount: summary.gapCount + result.summary.gapCount,
        }),
        { requestedCount: 0, completedCount: 0, gapCount: 0 },
      );
      if (
        !applyCurrentWorkerEvent({
          type: "RUN_COMPLETED",
          requestedCount: workerSummary.requestedCount,
          resultCount: workerSummary.completedCount,
          gapCount: workerSummary.gapCount,
        })
      ) {
        throw new CandidatePassBWorkerError(
          "WORKER_MESSAGE_ERROR",
          "The validated Pass B completion envelope was rejected.",
        );
      }
      const summary =
        candidatePassBMachine.current === null
          ? null
          : summarizeCandidatePassBRun(candidatePassBMachine.current);
      if (summary === null || summary.pendingCount !== 0) {
        throw new Error("Pass B finished before every candidate reached a terminal state.");
      }
    } catch (error) {
      if (!isCurrentOperation()) {
        return;
      }
      if (candidatePassBMachine.current?.status === "cancelling") {
        const forcedTerminationAccepted = applyCandidatePassBEvent({
          type: "CLIENT_FORCE_TERMINATED",
        });
        setCandidatePassBError(
          forcedTerminationAccepted
            ? "AI 후보 분석을 멈추고 작업 공간을 정리했어요. 이미 찾은 단서는 이 탭에 그대로 남아 있어요."
            : "AI 후보 분석 작업을 정리하지 못했어요. 기존 후보는 그대로 사용할 수 있어요.",
        );
        return;
      }
      if (error instanceof CandidatePassBWorkerError && error.code === "ABORTED") {
        if (candidatePassBMachine.current?.status === "cancelled") {
          setCandidatePassBError(explainCandidatePassBError(error));
        }
        return;
      }
      if (
        candidatePassBMachine.current !== null &&
        !["completed", "completedWithGaps", "cancelled", "failed"].includes(
          candidatePassBMachine.current.status,
        )
      ) {
        applyCurrentWorkerEvent({
          type: "RUN_FAILED",
          reasonCode: candidatePassBRunFailureReason(error),
        });
      }
      setCandidatePassBError(explainCandidatePassBError(error));
    } finally {
      await flushCandidatePassBInsightPersistence();
      if (isMounted.current) {
        setCandidatePassBActiveCandidateIds([]);
      }
      if (candidatePassBAbortController.current === controller) {
        candidatePassBAbortController.current = null;
      }
    }
  };

  runCandidatePassBRef.current = runCandidatePassB;

  const cancelCandidatePassB = (): void => {
    const controller = candidatePassBAbortController.current;
    if (
      controller === null ||
      candidatePassBMachine.current === null ||
      candidatePassBMachine.current.status === "cancelling"
    ) {
      return;
    }
    if (applyCandidatePassBEvent({ type: "CANCEL_REQUESTED" })) {
      controller.abort();
    }
  };

  const applyCandidateAudioEventEvent = useCallback(
    (event: CandidateAudioEventRunEvent): boolean => {
      const current = candidateAudioEventMachine.current;
      if (current === null) {
        return false;
      }
      const transition = reduceCandidateAudioEventRun(current, event);
      if (!transition.accepted) {
        return false;
      }
      candidateAudioEventMachine.current = transition.state;
      setCandidateAudioEventRun(transition.state);
      return true;
    },
    [],
  );

  const runCandidateAudioEvent = async (): Promise<void> => {
    const sourceBindingId =
      sourceContentFingerprint ??
      openedRecoveredResult?.finalResult.result.input.source.contentFingerprint ??
      null;
    if (
      sourceFile === null ||
      preflight === null ||
      currentAnalysisRunId === null ||
      sourceBindingId === null ||
      candidates.length === 0 ||
      analysisBusy ||
      candidatePassBBusy ||
      candidatePassBStartPendingRef.current ||
      candidateAudioEventBusy ||
      candidateAudioEventStartPendingRef.current ||
      !candidateAudioEventRuntimeAvailable ||
      (candidateAudioEventMachine.current !== null &&
        !["completed", "completedWithGaps", "cancelled", "failed"].includes(
          candidateAudioEventMachine.current.status,
        ))
    ) {
      return;
    }

    candidateAudioEventStartPendingRef.current = true;
    setCandidateAudioEventStartPending(true);
    candidateAudioEventOperationEpoch.current += 1;
    const operationEpoch = candidateAudioEventOperationEpoch.current;
    const sourceDurationMs = Math.round(preflight.metadata.durationMs);
    let targets: readonly CandidatePassBCoreTarget[];
    try {
      targets = selectCandidatePassBTargets(candidates, {
        sourceDurationMs,
        maxCandidates: 12,
      });
    } catch {
      candidateAudioEventStartPendingRef.current = false;
      setCandidateAudioEventStartPending(false);
      setCandidateAudioEventError(
        "반응 종류를 확인할 후보 시간을 읽지 못했어요. 빠른 분석을 다시 실행해 주세요.",
      );
      return;
    }
    if (targets.length === 0) {
      candidateAudioEventStartPendingRef.current = false;
      setCandidateAudioEventStartPending(false);
      return;
    }

    candidateAudioEventAbortController.current?.abort();
    const controller = new AbortController();
    candidateAudioEventAbortController.current = controller;
    const identity: CandidateAudioEventWorkerIdentity = {
      protocolVersion: CANDIDATE_AUDIO_EVENT_PROTOCOL_VERSION,
      sessionId: appSessionId,
      writerEpoch,
      analysisRunId: currentAnalysisRunId,
      audioEventRunId: createOperationId("audio-event"),
      workerEpoch: operationEpoch,
      workerInstanceId: createOperationId("audio-event-worker"),
      taskId: createOperationId("audio-event-task"),
    };
    let machine: CandidateAudioEventRunState;
    try {
      machine = createCandidateAudioEventRun({
        identity,
        sourceBinding: {
          sourceBindingId,
          sourceBindingRevision: 0,
          sourceDurationMs,
        },
        model: {
          modelId: CANDIDATE_AUDIO_EVENT_MODEL_ID,
          modelRevision: CANDIDATE_AUDIO_EVENT_MODEL_REVISION,
          dtype: CANDIDATE_AUDIO_EVENT_MODEL_DTYPE,
          runtimeDevice: CANDIDATE_AUDIO_EVENT_RUNTIME_DEVICE,
        },
        candidates: targets.map((target) => ({
          candidateId: target.candidateId,
          proposalRevision: 0,
          proposalRange: {
            startMs: target.decodeStartMs,
            endMs: target.decodeEndMs,
          },
          peakMs: target.reactionPeakMs,
        })),
      });
    } catch {
      candidateAudioEventStartPendingRef.current = false;
      setCandidateAudioEventStartPending(false);
      setCandidateAudioEventError(
        "반응 종류 AI 입력을 준비하지 못했어요. 빠른 분석을 다시 실행해 주세요.",
      );
      return;
    }

    candidateAudioEventMachine.current = machine;
    candidateAudioEventIdentity.current = identity;
    candidateAudioEventStartPendingRef.current = false;
    setCandidateAudioEventStartPending(false);
    setCandidateAudioEventRun(machine);
    setCandidateAudioEventModelProgress(null);
    setCandidateAudioEventCandidateProgress(null);
    setCandidateAudioEventError(null);
    if (!applyCandidateAudioEventEvent({ type: "START_REQUESTED" })) {
      setCandidateAudioEventError(
        "반응 종류 찾기를 시작하지 못했어요. 다시 시도해 주세요.",
      );
      return;
    }
    if (
      !applyCandidateAudioEventEvent({
        ...identity,
        eventId: createOperationId("audio-event-event"),
        type: "WORKER_PREPARED",
      })
    ) {
      setCandidateAudioEventError(
        "반응 종류 AI 작업 공간을 준비하지 못했어요. 다시 시도해 주세요.",
      );
      return;
    }

    const isCurrentOperation = (): boolean =>
      isMounted.current &&
      operationEpoch === candidateAudioEventOperationEpoch.current &&
      candidateAudioEventIdentity.current?.audioEventRunId ===
        identity.audioEventRunId;
    const targetById = new Map(
      targets.map((target) => [target.candidateId, target]),
    );
    const applyCurrentWorkerEvent = (
      event: CandidateAudioEventWorkerEventPayload,
    ): boolean => {
      if (!isCurrentOperation()) {
        return false;
      }
      return applyCandidateAudioEventEvent({
        ...identity,
        eventId: createOperationId("audio-event-event"),
        ...event,
      });
    };

    try {
      const workerResult = await runCandidateAudioEventWorker(sourceFile, {
        identity,
        sourceDurationMs,
        targets: targets.map((target) => ({
          candidateId: target.candidateId,
          startMs: target.decodeStartMs,
          endMs: target.decodeEndMs,
          peakMs: target.reactionPeakMs,
        })),
        signal: controller.signal,
        onModelProgress: (progress) => {
          if (!isCurrentOperation()) {
            return;
          }
          setCandidateAudioEventModelProgress(progress);
          if (
            progress.stage === "ready" &&
            candidateAudioEventMachine.current?.status === "loadingModel" &&
            !applyCurrentWorkerEvent({ type: "MODEL_READY" })
          ) {
            throw new Error("The audio-event model-ready event was rejected.");
          }
        },
        onCandidateProgress: (progress) => {
          if (isCurrentOperation()) {
            setCandidateAudioEventCandidateProgress(progress);
          }
        },
        onPartialResult: (result) => {
          if (!isCurrentOperation() || !targetById.has(result.candidateId)) {
            return;
          }
          const accepted =
            result.status === "detected"
              ? applyCurrentWorkerEvent({
                  type: "CANDIDATE_DETECTED",
                  candidateId: result.candidateId,
                  expectedProposalRevision: 0,
                  detectionCount: result.detections.length,
                })
              : applyCurrentWorkerEvent({
                  type: "CANDIDATE_NO_CLEAR_EVENT",
                  candidateId: result.candidateId,
                  expectedProposalRevision: 0,
                  reasonCode: result.reasonCode,
                });
          if (!accepted) {
            throw new Error("The audio-event candidate result was rejected.");
          }
          setCandidateAudioEventEvidenceById((current) =>
            isCurrentOperation()
              ? mergeCandidateAudioEventEvidence(current, result)
              : current,
          );
        },
        onCandidateGap: (gap: CandidateAudioEventCandidateGap) => {
          if (!isCurrentOperation() || !targetById.has(gap.candidateId)) {
            return;
          }
          if (
            candidateAudioEventMachine.current?.status === "loadingModel"
          ) {
            if (
              gap.reasonCode !== "NO_AUDIO_TRACK" &&
              gap.reasonCode !== "UNSUPPORTED_CONTAINER" &&
              gap.reasonCode !== "UNSUPPORTED_AUDIO_CODEC" &&
              gap.reasonCode !== "AUDIO_DECODE_FAILED"
            ) {
              throw new Error(
                "A candidate-only audio-event gap arrived before the model was ready.",
              );
            }
            if (
              !applyCurrentWorkerEvent({
                type: "MODEL_BYPASSED",
                reasonCode:
                  gap.reasonCode === "UNSUPPORTED_CONTAINER" ||
                  gap.reasonCode === "UNSUPPORTED_AUDIO_CODEC"
                    ? "source_audio_unsupported"
                    : "source_audio_unavailable",
              })
            ) {
              throw new Error(
                "The audio-event model-bypass event was rejected.",
              );
            }
          }
          if (
            !applyCurrentWorkerEvent({
              type: "CANDIDATE_FAILED",
              candidateId: gap.candidateId,
              expectedProposalRevision: 0,
              reasonCode: gap.reasonCode,
            })
          ) {
            throw new Error("The audio-event candidate gap was rejected.");
          }
        },
        onCancellationAcknowledged: () => {
          if (
            isCurrentOperation() &&
            candidateAudioEventMachine.current?.status === "cancelling" &&
            !applyCurrentWorkerEvent({ type: "CANCEL_ACKNOWLEDGED" })
          ) {
            throw new Error(
              "The audio-event cancellation acknowledgement was rejected.",
            );
          }
        },
      });
      if (!isCurrentOperation()) {
        return;
      }
      if (
        !applyCurrentWorkerEvent({
          type: "RUN_COMPLETED",
          requestedCount: workerResult.summary.requestedCount,
          completedCount: workerResult.summary.completedCount,
          gapCount: workerResult.summary.gapCount,
        })
      ) {
        throw new CandidateAudioEventWorkerError(
          "WORKER_MESSAGE_ERROR",
          "The validated audio-event completion envelope was rejected.",
        );
      }
      const summary =
        candidateAudioEventMachine.current === null
          ? null
          : summarizeCandidateAudioEventRun(candidateAudioEventMachine.current);
      if (
        summary === null ||
        summary.pendingCount !== 0 ||
        summary.classifyingCount !== 0
      ) {
        throw new Error(
          "Audio-event analysis finished before every candidate reached a terminal state.",
        );
      }
    } catch (error) {
      if (!isCurrentOperation()) {
        return;
      }
      if (candidateAudioEventMachine.current?.status === "cancelling") {
        const forcedTerminationAccepted = applyCandidateAudioEventEvent({
          type: "CLIENT_FORCE_TERMINATED",
        });
        setCandidateAudioEventError(
          forcedTerminationAccepted
            ? "반응 종류 찾기를 멈추고 작업 공간을 정리했어요. 이미 찾은 단서는 이 탭에 그대로 남아 있어요."
            : "반응 종류 작업을 정리하지 못했어요. 기존 후보는 그대로 사용할 수 있어요.",
        );
        return;
      }
      if (
        error instanceof CandidateAudioEventWorkerError &&
        error.code === "ABORTED"
      ) {
        if (candidateAudioEventMachine.current?.status === "cancelled") {
          setCandidateAudioEventError(null);
        }
        return;
      }
      if (
        candidateAudioEventMachine.current !== null &&
        !["completed", "completedWithGaps", "cancelled", "failed"].includes(
          candidateAudioEventMachine.current.status,
        )
      ) {
        applyCurrentWorkerEvent({
          type: "RUN_FAILED",
          reasonCode: candidateAudioEventRunFailureReason(error),
        });
      }
      setCandidateAudioEventError(explainCandidateAudioEventError(error));
    } finally {
      if (candidateAudioEventAbortController.current === controller) {
        candidateAudioEventAbortController.current = null;
      }
    }
  };

  const cancelCandidateAudioEvent = (): void => {
    const controller = candidateAudioEventAbortController.current;
    if (
      controller === null ||
      candidateAudioEventMachine.current === null ||
      candidateAudioEventMachine.current.status === "cancelling"
    ) {
      return;
    }
    if (applyCandidateAudioEventEvent({ type: "CANCEL_REQUESTED" })) {
      controller.abort();
    }
  };

  const createCandidateRankingProposalForReview = (): void => {
    if (
      candidates.length === 0 ||
      currentAnalysisRunId === null ||
      candidateRankingFingerprints === null ||
      !rankingCandidateSetMatches ||
      candidateRefinementBusy ||
      candidateRankingView.appliedProposalId !== null
    ) {
      setCandidateRankingFeedback({
        tone: "warning",
        message:
          candidateRefinementBusy
            ? "자세한 AI 분석이 끝난 뒤 최신 단서로 추천 순서를 만들 수 있어요."
            : candidateRankingView.appliedProposalId !== null
              ? "먼저 이전 순서로 되돌린 뒤 최신 추천을 다시 만들어 주세요."
              : "현재 후보와 단서를 안전하게 확인한 뒤 다시 시도해 주세요.",
      });
      return;
    }

    try {
      let rankingViewForProposal = candidateRankingView;
      if (!rankingEvidenceMatches) {
        const evidenceTransition = transitionCandidateRankingView(
          rankingViewForProposal,
          {
            type: "EVIDENCE_CHANGED",
            rankingSessionId: rankingViewForProposal.rankingSessionId,
            candidateSetFingerprint: rankingViewForProposal.candidateSetFingerprint,
            evidenceFingerprint: candidateRankingFingerprints.evidenceFingerprint,
          },
        );
        if (!evidenceTransition.accepted) {
          throw new Error("The ranking evidence snapshot could not be synchronized.");
        }
        rankingViewForProposal = evidenceTransition.state;
      }
      const nextRevision = candidateRankingRevision.current + 1;
      const proposal = buildCandidateRankingProposal({
        proposalId: createOperationId("ranking-proposal"),
        rankingSessionId: rankingViewForProposal.rankingSessionId,
        rankingRevision: nextRevision,
        analysisRunId: currentAnalysisRunId,
        expectedViewOrderRevision: rankingViewForProposal.viewOrderRevision,
        candidates: orderedCandidates,
        passBEvidenceById: candidatePassBEvidenceById,
        audioEventEvidenceById: candidateAudioEventEvidenceById,
        audioEventCoverage: candidateAudioEventRankingCoverage,
      });
      const transition = transitionCandidateRankingView(rankingViewForProposal, {
        type: "PROPOSAL_READY",
        proposal,
      });
      if (!transition.accepted) {
        setCandidateRankingFeedback({
          tone: "warning",
          message:
            "후보 단서가 방금 바뀌어 이 제안을 열지 않았어요. 최신 상태에서 한 번 더 눌러 주세요.",
        });
        return;
      }
      candidateRankingRevision.current = nextRevision;
      setCandidateRankingView(transition.state);
      setCandidateRankingFeedback({
        tone: "success",
        message:
          proposal.changedPositionCount > 0
            ? `후보 ${proposal.changedPositionCount}개의 검토 위치가 달라지는 제안을 만들었어요. 아직 목록은 바뀌지 않았어요.`
            : "현재 목록이 이미 최신 추천 순서와 같아요. 후보별 근거를 펼쳐 확인할 수 있어요.",
      });
    } catch {
      setCandidateRankingFeedback({
        tone: "warning",
        message:
          "추천 순서를 안전하게 만들지 못했어요. 기존 후보와 검토 순서는 그대로예요.",
      });
    }
  };

  const applyCandidateRankingProposalForReview = (): void => {
    const proposalView = candidateRankingView.latestProposal;
    if (
      proposalView === null ||
      proposalView.disposition !== "fresh" ||
      candidateRankingFingerprints === null ||
      !rankingCandidateSetMatches ||
      !rankingEvidenceMatches ||
      proposalView.proposal.changedPositionCount === 0
    ) {
      return;
    }
    const transition = transitionCandidateRankingView(candidateRankingView, {
      type: "APPLY_PROPOSAL",
      rankingSessionId: candidateRankingView.rankingSessionId,
      proposalId: proposalView.proposal.proposalId,
      candidateSetFingerprint: candidateRankingFingerprints.candidateSetFingerprint,
      evidenceFingerprint: candidateRankingFingerprints.evidenceFingerprint,
      expectedViewOrderRevision: candidateRankingView.viewOrderRevision,
    });
    if (!transition.accepted) {
      setCandidateRankingFeedback({
        tone: "warning",
        message:
          "단서나 목록이 방금 바뀌어 이전 제안은 적용하지 않았어요. 최신 추천을 다시 만들어 주세요.",
      });
      return;
    }
    setCandidateRankingView(transition.state);
    setCandidateRankingFeedback({
      tone: "success",
      message:
        "추천 검토 순서를 적용했어요. 승인·제외 판단, 다듬은 시작·끝과 재생 위치는 그대로예요.",
    });
  };

  const undoCandidateRankingOrder = (): void => {
    if (candidateRankingView.appliedProposalId === null) {
      return;
    }
    const transition = transitionCandidateRankingView(candidateRankingView, {
      type: "UNDO_APPLIED_ORDER",
      rankingSessionId: candidateRankingView.rankingSessionId,
      appliedProposalId: candidateRankingView.appliedProposalId,
      expectedViewOrderRevision: candidateRankingView.viewOrderRevision,
    });
    if (!transition.accepted) {
      setCandidateRankingFeedback({
        tone: "warning",
        message: "이전 순서를 안전하게 복원하지 못했어요. 현재 목록은 바꾸지 않았어요.",
      });
      return;
    }
    setCandidateRankingView(transition.state);
    setCandidateRankingFeedback({
      tone: "success",
      message:
        "추천 적용 전 순서로 돌아왔어요. 승인·제외와 시작·끝은 그대로예요.",
    });
  };

  const dismissCandidateRankingProposal = (): void => {
    const proposalView = candidateRankingView.latestProposal;
    if (proposalView === null || candidateRankingView.appliedProposalId !== null) {
      return;
    }
    const transition = transitionCandidateRankingView(candidateRankingView, {
      type: "DISMISS_PROPOSAL",
      rankingSessionId: candidateRankingView.rankingSessionId,
      proposalId: proposalView.proposal.proposalId,
      expectedViewOrderRevision: candidateRankingView.viewOrderRevision,
    });
    if (transition.accepted) {
      setCandidateRankingView(transition.state);
      setCandidateRankingFeedback({
        tone: "success",
        message: "현재 검토 순서를 그대로 유지할게요.",
      });
    }
  };

  const updateReview = (candidateId: string, reviewState: CandidateReviewState): void => {
    const currentBoundaryRevision = boundaryRevisions[candidateId]?.revision ?? 0;
    setCandidates((current) =>
      current.map((candidate) =>
        candidate.id === candidateId
          ? {
              ...candidate,
              reviewState,
              approvedBoundaryRevision:
                reviewState === "approved" ? currentBoundaryRevision : null,
            }
          : candidate,
      ),
    );
    setLastExportFormat(null);
    setCopyStatus("idle");
    setExportError(null);
  };

  const updateCandidateBoundary = (
    candidate: ReviewedCandidate,
    createCommand: (state: CandidateBoundaryRevision) => CandidateBoundaryCommand,
  ): void => {
    if (boundarySourceDurationMs <= 0) {
      setBoundaryFeedback({
        candidateId: candidate.id,
        tone: "warning",
        message: "원본 길이를 확인한 뒤 시작·끝을 조정할 수 있어요.",
      });
      return;
    }

    let currentState = boundaryRevisions[candidate.id];
    try {
      currentState ??= createCandidateBoundaryRevision({
        boundarySessionId,
        candidateId: candidate.id,
        proposalRange: { startMs: candidate.startMs, endMs: candidate.endMs },
        peakMs: candidate.peakMs,
        sourceDurationMs: boundarySourceDurationMs,
      });
    } catch {
      setBoundaryFeedback({
        candidateId: candidate.id,
        tone: "warning",
        message: "이 후보의 시작·끝 정보를 확인하지 못했어요. 다른 후보를 먼저 검토해 주세요.",
      });
      return;
    }

    const command = createCommand(currentState);
    const transition = applyCandidateBoundaryCommand(currentState, command);
    if (transition.status === "ignored") {
      return;
    }
    if (transition.status === "rejected") {
      setBoundaryFeedback({
        candidateId: candidate.id,
        tone: "warning",
        message: boundaryRejectionMessage(transition.reason),
      });
      return;
    }

    setBoundaryRevisions((current) => ({
      ...current,
      [candidate.id]: transition.state,
    }));
    setLastExportFormat(null);
    setCopyStatus("idle");
    setExportError(null);
    const range = transition.state.effectiveRange;
    const limitedMessage =
      transition.adjustmentReasons.length > 0
        ? " 원본 범위와 30초~1분 기준에 맞춰 가능한 만큼만 움직였어요."
        : "";
    setBoundaryFeedback({
      candidateId: candidate.id,
      tone: "success",
      message:
        command.kind === "RESET_TO_AI"
          ? "AI가 처음 고른 시작·끝으로 되돌렸어요."
          : `현재 사용할 구간을 ${formatDuration(range.startMs)}–${formatDuration(range.endMs)}로 바꿨어요.${limitedMessage}`,
    });
  };

  const setBoundaryFromPlayerPosition = (
    candidate: ReviewedCandidate,
    kind: "SET_START_FROM_PLAYER" | "SET_END_FROM_PLAYER",
  ): void => {
    const player =
      focusedCandidateId === candidate.id ? previewVideo.current : null;
    if (
      sourcePreviewUrl === null ||
      player === null ||
      focusedCandidateId !== candidate.id
    ) {
      setBoundaryFeedback({
        candidateId: candidate.id,
        tone: "warning",
        message: "먼저 왼쪽 플레이어에서 이 후보를 재생하고 원하는 위치로 이동해 주세요.",
      });
      return;
    }
    updateCandidateBoundary(candidate, (state) => ({
      boundarySessionId: state.boundarySessionId,
      candidateId: state.candidateId,
      expectedRevision: state.revision,
      kind,
      playerMs: player.currentTime * 1_000,
    }));
  };

  const nudgeCandidateBoundary = (
    candidate: ReviewedCandidate,
    kind: "SHIFT_START" | "SHIFT_END",
    deltaMs: -5_000 | 5_000,
  ): void => {
    updateCandidateBoundary(candidate, (state) => ({
      boundarySessionId: state.boundarySessionId,
      candidateId: state.candidateId,
      expectedRevision: state.revision,
      kind,
      deltaMs,
    }));
  };

  const resetCandidateBoundary = (candidate: ReviewedCandidate): void => {
    updateCandidateBoundary(candidate, (state) => ({
      boundarySessionId: state.boundarySessionId,
      candidateId: state.candidateId,
      expectedRevision: state.revision,
      kind: "RESET_TO_AI",
    }));
  };

  const seekWorkspacePlayer = (
    candidate: ReviewedCandidate,
    timestampMs: number,
    shouldPlay: boolean,
  ): void => {
    const player = previewVideo.current;
    if (
      sourcePreviewUrl === null ||
      player === null ||
      !Number.isFinite(timestampMs)
    ) {
      return;
    }
    const range = effectiveCandidateRange(
      candidate,
      boundaryRevisions[candidate.id],
    );
    const targetMs = Math.max(
      range.startMs,
      Math.min(range.endMs, timestampMs),
    );
    previewRequestedCandidateIdRef.current = candidate.id;
    previewPreparedCandidateIdRef.current = null;
    previewPlayAfterPrepareRef.current = shouldPlay ? candidate.id : null;
    setPreviewPreparedCandidateId(null);
    lastWorkspacePreviewCue.current = `${sourcePreviewUrl}|${candidate.id}|${range.startMs}`;
    const markPrepared = (): void => {
      if (previewRequestedCandidateIdRef.current !== candidate.id) return;
      previewPreparedCandidateIdRef.current = candidate.id;
      setPreviewPreparedCandidateId(candidate.id);
      if (previewPlayAfterPrepareRef.current === candidate.id) {
        previewPlayAfterPrepareRef.current = null;
        player.focus({ preventScroll: true });
        void player.play().catch(() => {
          // A direct play control remains available if browser policy blocks it.
        });
      }
    };
    const seek = (): void => {
      player.pause();
      player.addEventListener("seeked", markPrepared, { once: true });
      player.addEventListener("canplay", markPrepared, { once: true });
      player.currentTime = targetMs / 1_000;
      if (
        Math.abs(player.currentTime - targetMs / 1_000) < 0.25 &&
        player.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        markPrepared();
      }
    };
    if (player.readyState >= 1) {
      seek();
      return;
    }
    player.addEventListener("loadedmetadata", seek, { once: true });
  };

  const focusCandidateForReview = (candidate: ReviewedCandidate): void => {
    previewRequestedCandidateIdRef.current = candidate.id;
    previewPreparedCandidateIdRef.current = null;
    previewPlayAfterPrepareRef.current = null;
    setPreviewPreparedCandidateId(null);
    setPreviewCandidateId(candidate.id);
    previewVideo.current?.pause();
    seekWorkspacePlayer(candidate, candidate.startMs, false);
  };

  const playCandidate = (candidate: ReviewedCandidate): void => {
    previewRequestedCandidateIdRef.current = candidate.id;
    previewPlayAfterPrepareRef.current = candidate.id;
    setPreviewCandidateId(candidate.id);
    if (sourcePreviewUrl === null) {
      return;
    }
    const range = effectiveCandidateRange(
      candidate,
      boundaryRevisions[candidate.id],
    );
    seekWorkspacePlayer(candidate, range.startMs, true);
  };

  const playCandidateCue = (
    candidate: ReviewedCandidate,
    timestampMs: number,
  ): void => {
    setPreviewCandidateId(candidate.id);
    if (sourcePreviewUrl === null || !Number.isFinite(timestampMs)) {
      return;
    }
    const range = effectiveCandidateRange(
      candidate,
      boundaryRevisions[candidate.id],
    );
    seekWorkspacePlayer(
      candidate,
      Math.max(range.startMs, Math.min(range.endMs, timestampMs)),
      true,
    );
  };

  /**
   * Records the decision and moves to the next undecided candidate. Reverting a
   * decision back to `unreviewed` never advances, so undo keeps the editor in
   * place.
   */
  const reviewCandidateAndAdvance = (
    candidate: ReviewedCandidate,
    reviewState: CandidateReviewState,
  ): void => {
    const candidateNumber =
      orderedCandidates.findIndex(({ id }) => id === candidate.id) + 1;
    updateReview(candidate.id, reviewState);
    if (!reviewDecisionAdvances(reviewState)) {
      setReviewUndo(null);
      return;
    }
    const nextCandidateId = nextUnreviewedCandidateId(
      orderedCandidates,
      candidate.id,
    );
    const nextCandidate =
      nextCandidateId === null
        ? null
        : orderedCandidates.find(({ id }) => id === nextCandidateId) ?? null;
    if (nextCandidate !== null) {
      focusCandidateForReview(nextCandidate);
    }
    setReviewUndo({
      candidateId: candidate.id,
      candidateNumber,
      previousReviewState: candidate.reviewState,
      appliedReviewState: reviewState,
      advancedToCandidateId: nextCandidateId,
    });
  };

  const undoLastReview = (): void => {
    if (reviewUndo === null) {
      return;
    }
    updateReview(reviewUndo.candidateId, reviewUndo.previousReviewState);
    const restoredCandidate = orderedCandidates.find(
      ({ id }) => id === reviewUndo.candidateId,
    );
    if (restoredCandidate !== undefined) {
      focusCandidateForReview(restoredCandidate);
    }
    setReviewUndo(null);
  };

  const focusedCandidate =
    focusedCandidateId === null
      ? null
      : orderedCandidates.find(({ id }) => id === focusedCandidateId) ?? null;
  const reviewShortcutsActive =
    contextualCandidatePublicationReady && orderedCandidates.length > 0;

  const togglePreviewPlayback = (candidate: ReviewedCandidate): void => {
    const player = previewVideo.current;
    if (sourcePreviewUrl === null || player === null) {
      return;
    }
    if (previewPreparedCandidateId !== candidate.id) {
      playCandidate(candidate);
      return;
    }
    if (player.paused) {
      void player.play().catch(() => {
        // The visible player control stays available if browser policy blocks it.
      });
      return;
    }
    player.pause();
  };

  /**
   * Review shortcuts are keyed off `event.code`, not `event.key`, so they keep
   * working while a Korean IME is active. Typing targets are always left alone.
   */
  useReviewShortcuts(
    {
      active: reviewShortcutsActive,
      helpOpen: shortcutHelpOpen,
      canUndo: reviewUndo !== null,
      toggleHelp: () => setShortcutHelpOpen((open) => !open),
      closeHelp: () => setShortcutHelpOpen(false),
      togglePlayback: () => {
        if (focusedCandidate !== null) togglePreviewPlayback(focusedCandidate);
      },
      focusPreviousCandidate: () => {
        if (previousFocusedCandidate !== null) {
          focusCandidateForReview(previousFocusedCandidate);
        }
      },
      focusNextCandidate: () => {
        if (nextFocusedCandidate !== null) {
          focusCandidateForReview(nextFocusedCandidate);
        }
      },
      nudgeStart: (direction) => {
        if (focusedCandidate !== null) {
          nudgeCandidateBoundary(
            focusedCandidate,
            "SHIFT_START",
            direction === -1 ? -5_000 : 5_000,
          );
        }
      },
      nudgeEnd: (direction) => {
        if (focusedCandidate !== null) {
          nudgeCandidateBoundary(
            focusedCandidate,
            "SHIFT_END",
            direction === -1 ? -5_000 : 5_000,
          );
        }
      },
      toggleApprove: () => {
        if (focusedCandidate === null) return;
        reviewCandidateAndAdvance(
          focusedCandidate,
          focusedCandidate.reviewState === "approved" ? "unreviewed" : "approved",
        );
      },
      toggleReject: () => {
        if (focusedCandidate === null) return;
        reviewCandidateAndAdvance(
          focusedCandidate,
          focusedCandidate.reviewState === "rejected" ? "unreviewed" : "rejected",
        );
      },
      undo: undoLastReview,
      mapSheetOpen,
      toggleMapSheet: () => setMapSheetOpen((open) => !open),
      closeMapSheet: () => setMapSheetOpen(false),
      dossierTab,
      setDossierTab,
  });

  useEffect(() => {
    if (reviewUndo === null) {
      return;
    }
    const timer = globalThis.setTimeout(() => setReviewUndo(null), 8_000);
    return () => globalThis.clearTimeout(timer);
  }, [reviewUndo]);

  /** Re-runs whichever whole-context stage stopped, keeping fast candidates. */
  const retryWholeContextPhase = (): void => {
    if (broadcastContextStatus === "failed" || broadcastContextResult === null) {
      autoBroadcastContextSourceRef.current = null;
      setBroadcastContextStatus("idle");
      setBroadcastContextError(null);
    }
    if (
      broadcastTranscriptStatus === "failed" ||
      broadcastTranscriptChapters.length === 0
    ) {
      autoBroadcastTranscriptSourceRef.current = null;
      setBroadcastTranscriptStatus("idle");
      setBroadcastTranscriptProgress(null);
      setBroadcastTranscriptError(null);
    }
  };

  const focusSourceSection = (): void => {
    if (sourceHeading.current === null && reconnectSourceInput.current !== null) {
      reconnectSourceInput.current.click();
      return;
    }
    sourceHeading.current?.focus();
    sourceHeading.current?.scrollIntoView({
      behavior: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
  };

  const scrollToHeading = (heading: HTMLHeadingElement | null): void => {
    heading?.focus();
    heading?.scrollIntoView({
      behavior: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
  };

  /** Rail click moves the scroll anchor only — it never forces a step transition. */
  const focusRailStep = (step: 1 | 2 | 3 | 4): void => {
    if (step === 1) {
      focusSourceSection();
      return;
    }
    if (step === 2) {
      scrollToHeading(analysisHeading.current);
      return;
    }
    if (step === 3) {
      scrollToHeading(candidateHeading.current);
      return;
    }
    scrollToHeading(exportHeading.current);
  };

  const openRecoveredAnalysis = (recovered: RecoverableAnalysisResult): void => {
    if (!confirmDiscardCurrentWork()) {
      return;
    }
    const restoreEpoch = recoveredContextRestoreEpoch.current + 1;
    recoveredContextRestoreEpoch.current = restoreEpoch;
    resetCandidatePassB();
    resetCandidateAudioEvent();
    resetBoundarySession();
    broadcastTranscriptAbortController.current?.abort();
    broadcastTranscriptAbortController.current = null;
    broadcastContextAbortController.current?.abort();
    broadcastContextAbortController.current = null;
    semanticLeadRefinementAbortController.current?.abort();
    semanticLeadRefinementAbortController.current = null;
    autoBroadcastTranscriptSourceRef.current = null;
    autoBroadcastContextSourceRef.current = null;
    autoSemanticLeadRefinementSourceRef.current = null;
    setBroadcastTranscriptStatus("idle");
    setBroadcastTranscriptProgress(null);
    setBroadcastTranscriptChapters([]);
    setYouTubeCaptionTrack(null);
    setBroadcastTranscriptError(null);
    setBroadcastContextStatus("restoring");
    setBroadcastContextResult(null);
    setCandidateAiProjectionById({});
    setBroadcastContextRefinementLeadIds(null);
    setBroadcastContextFastRefinementLeadIds(null);
    setBroadcastContextError(null);
    setSemanticLeadRefinementStatus("idle");
    setSemanticLeadRefinementError(null);
    sourceSelectionEpoch.current += 1;
    sourceAbortController.current?.abort();
    sourceAbortController.current = null;
    analysisOperationEpoch.current += 1;
    analysisAbortController.current?.abort();
    analysisAbortController.current = null;
    chatSelectionEpoch.current += 1;
    replaceSourceFile(null);
    setPendingFileName(null);
    setPreflight(null);
    setSourceContentFingerprint(null);
    setSourceCheck(null);
    setSourceError(null);
    setAnalysisRun(null);
    setAnalysisProgress(null);
    setAudioAnalysisProgress(null);
    setAnalysisError(null);
    setChatImport(null);
    setChatContentFingerprint(null);
    setChatFileName(null);
    setChatError(null);
    setChatImportStatus("idle");
    setChatOffsetSeconds(recovered.finalResult.result.input.chat.offsetMs / 1_000);
    const recoveredCandidates: ReviewedCandidate[] =
      recovered.finalResult.result.candidates.map((candidate) => ({
        ...hydrateDurableCandidate(candidate),
        reviewState: "unreviewed" as const,
        approvedBoundaryRevision: null,
      }));
    setSelectionResult(recovered.finalResult.result.summary);
    setCandidates(recoveredCandidates);
    setCandidateTimelineScorePoints(
      buildCandidateTimelineScorePoints([
        { signalKind: "fused", candidates: recoveredCandidates },
      ]),
    );
    const recoveredCandidateIds = new Set(recoveredCandidates.map((candidate) => candidate.id));
    // Context-discovered candidates are restored a little later from the paid
    // broadcast-context session. Keep their already-paid Pass B artifacts now so
    // reconnecting does not schedule the same Gemini verification again.
    const isRecoverablePassBCandidate = (candidateId: string) =>
      recoveredCandidateIds.has(candidateId) || candidateId.startsWith("semantic-");
    const recoveredPassBInsights = isCompatibleCandidatePassBRoutingModelRevision(
      recovered.candidatePassBInsights?.modelManifestHash,
    )
      ? recovered.candidatePassBInsights
      : null;
    const recoveredEvidence = Object.fromEntries(
      Object.entries(recoveredPassBInsights?.evidenceById ?? {}).filter(([candidateId]) =>
        isRecoverablePassBCandidate(candidateId),
      ),
    ) as CandidatePassBEvidenceById;
    const recoveredGeminiInsights = Object.fromEntries(
      Object.entries(recoveredPassBInsights?.insightById ?? {}).filter(([candidateId]) =>
        isRecoverablePassBCandidate(candidateId),
      ),
    ) as CandidateGeminiInsightById;
    const recoveredModels = Object.fromEntries(
      Object.entries(recoveredPassBInsights?.modelByCandidateId ?? {}).filter(
        ([candidateId]) => isRecoverablePassBCandidate(candidateId),
      ),
    ) as CandidatePassBModelById;
    const recoveredTimelineFrames = Object.fromEntries(
      Object.entries(recoveredPassBInsights?.thumbnailById ?? {})
        .filter(([candidateId]) => isRecoverablePassBCandidate(candidateId))
        .map(([candidateId, frame]) => [candidateId, [frame]]),
    ) as CandidateTimelineFramesById;
    const recoveredVerificationReceipts = Object.fromEntries(
      Object.entries(
        recoveredPassBInsights?.verificationReceiptById ?? {},
      ).filter(([candidateId]) => isRecoverablePassBCandidate(candidateId)),
    ) as CandidatePassBVerificationReceiptById;
    candidatePassBEvidenceRef.current = recoveredEvidence;
    candidateGeminiInsightRef.current = recoveredGeminiInsights;
    candidatePassBModelByIdRef.current = recoveredModels;
    candidateTimelineFramesRef.current = recoveredTimelineFrames;
    candidatePassBVerificationReceiptRef.current = recoveredVerificationReceipts;
    setCandidatePassBEvidenceById(recoveredEvidence);
    setCandidateGeminiInsightById(recoveredGeminiInsights);
    setCandidateTimelineFramesById(recoveredTimelineFrames);
    setCandidatePassBVerificationReceiptById(recoveredVerificationReceipts);
    resetCandidateRanking(recoveredCandidates);
    setLastExportFormat(null);
    setCopyStatus("idle");
    setExportError(null);
    setPreviewCandidateId(null);
    setOpenedRecoveredResult(recovered);

    void (async () => {
      const store = getResultStore();
      const savedSession = await store.getBroadcastContextSession(
        recovered.terminal.runId,
      );
      const restoreIsCurrent = (): boolean =>
        isMounted.current &&
        recoveredContextRestoreEpoch.current === restoreEpoch;
      if (!restoreIsCurrent()) return;
      if (
        savedSession === null ||
        savedSession.inputSignature !== recovered.terminal.inputSignature ||
        savedSession.sourceDurationMs !==
          recovered.finalResult.result.input.source.durationMs ||
        savedSession.contextResultJson === null
      ) {
        setBroadcastContextStatus("idle");
        return;
      }

      let storedPayload: unknown;
      try {
        storedPayload = JSON.parse(savedSession.contextResultJson);
      } catch {
        throw new Error("저장된 전체 맥락 결과 형식을 확인하지 못했어요.");
      }
      const storedEnvelope = unpackPersistedBroadcastContext(storedPayload);
      const restoreCandidateInputs: readonly BroadcastContextCandidateInput[] =
        recoveredCandidates.slice(0, 12).map((candidate) => ({
          candidateId: candidate.id,
          startMs: Math.round(candidate.startMs),
          endMs: Math.round(candidate.endMs),
          transcriptKo: "",
          eventSummaryKo: "저장된 후보 사건",
          reactionSummaryKo: "저장된 스트리머 반응",
          chatReactionSummaryKo: null,
        }));
      const restoredContext = parsePersistedBroadcastContextResult(
        storedEnvelope.resultPayload,
        {
          sourceDurationMs: savedSession.sourceDurationMs,
          chapters: savedSession.chapters,
          candidates: restoreCandidateInputs,
        },
      );
      if (restoredContext === null) {
        throw new Error("저장된 전체 맥락 결과를 현재 영상 기록과 연결하지 못했어요.");
      }

      const availableLeadIds = new Set(
        restoredContext.discoveredLeads.map((lead) => lead.leadId),
      );
      const restoredRefinementLeadIds = [
        ...new Set(
          (storedEnvelope.refinementLeadIds ?? []).filter((leadId) =>
            availableLeadIds.has(leadId),
          ),
        ),
      ].slice(0, MAX_TOPICAL_REFINEMENT_LEADS);
      const restoredRefinementLeadIdSet = new Set(restoredRefinementLeadIds);
      const restoredFastRefinementLeadIds = [
        ...new Set(
          (storedEnvelope.fastRefinementLeadIds ?? []).filter((leadId) =>
            restoredRefinementLeadIdSet.has(leadId),
          ),
        ),
      ];
      let nextCandidates = recoveredCandidates;
      if (savedSession.refinementCandidatesJson !== null) {
        let refinementPayload: unknown;
        try {
          refinementPayload = JSON.parse(savedSession.refinementCandidatesJson);
        } catch {
          refinementPayload = null;
        }
        const restoredSemanticCandidates = parseSemanticLeadCandidates(
          refinementPayload,
        );
        if (restoredSemanticCandidates === null) {
          setSemanticLeadRefinementStatus("failed");
          setSemanticLeadRefinementError(
            "저장된 의미 후보 위치는 형식을 확인하지 못해 제외했어요. 전체 맥락 결과와 기존 후보는 유지했습니다.",
          );
        } else {
          const appendedSemanticCandidates: ReviewedCandidate[] = [];
          for (const proposal of restoredSemanticCandidates) {
            const duplicate = recoveredCandidates.some((candidate) => {
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
            });
            if (!duplicate) {
              appendedSemanticCandidates.push({
                ...proposal,
                reviewState: "unreviewed",
                approvedBoundaryRevision: null,
              });
            }
          }
          nextCandidates = [
            ...recoveredCandidates,
            ...appendedSemanticCandidates,
          ].sort(
            (left, right) =>
              left.peakMs - right.peakMs || left.id.localeCompare(right.id),
          );
          setSemanticLeadRefinementStatus("completed");
        }
      } else if (restoredRefinementLeadIds.length === 0) {
        setSemanticLeadRefinementStatus("completed");
      }
      if (!restoreIsCurrent()) return;

      autoBroadcastContextSourceRef.current = `${recovered.terminal.runId}:${recovered.terminal.inputSignature}`;
      setBroadcastTranscriptChapters(savedSession.chapters);
      setBroadcastTranscriptStatus(
        savedSession.completeAudioCoverage ? "completed" : "completedWithGaps",
      );
      setBroadcastContextResult(restoredContext);
      setBroadcastContextRefinementLeadIds(restoredRefinementLeadIds);
      setBroadcastContextFastRefinementLeadIds(restoredFastRefinementLeadIds);
      setTimelineSemanticChapterRevealCount(0);
      setTimelineSemanticChapters(restoredContext.semanticChapters);
      setTimelineInspectionTarget(null);
      setCandidateAiProjectionById(
        finalizeContextQualifiedCandidates(
          recoveredCandidates,
          restoredContext.annotations,
        ).projectionById,
      );
      setCandidates(nextCandidates);
      setCandidateTimelineScorePoints(
        buildCandidateTimelineScorePoints([
          { signalKind: "fused", candidates: nextCandidates },
        ]),
      );
      setSelectionResult((current) =>
        current === null
          ? current
          : { ...current, candidateCount: nextCandidates.length },
      );
      resetCandidateRanking(nextCandidates);
      setBroadcastContextStatus("completed");
    })().catch((error: unknown) => {
      if (
        !isMounted.current ||
        recoveredContextRestoreEpoch.current !== restoreEpoch
      ) {
        return;
      }
      setBroadcastContextStatus("failed");
      setBroadcastContextError(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "저장된 전체 맥락 결과를 복원하지 못했어요.",
      );
    });
  };

  const startFreshAnalysis = (): void => {
    if (!confirmDiscardCurrentWork()) {
      return;
    }
    sourceSelectionEpoch.current += 1;
    sourceAbortController.current?.abort();
    sourceAbortController.current = null;
    replaceSourceFile(null);
    setPendingFileName(null);
    setPreflight(null);
    setSourceContentFingerprint(null);
    setSourceCheck(null);
    chatSelectionEpoch.current += 1;
    setChatImport(null);
    setChatContentFingerprint(null);
    setChatFileName(null);
    setChatError(null);
    setChatImportStatus("idle");
    setChatOffsetSeconds(0);
    resetDownstream();
    setSourceError(null);
    focusSourceSection();
  };

  const createExportRequest = (): HighlightExportRequest | null => {
    if (selectionResult === null || approvedCandidates.length === 0) {
      return null;
    }
    const input: DurableAnalysisInputDescriptor | null =
      openedRecoveredResult?.finalResult.result.input ??
      (preflight !== null && sourceCheck !== null && sourceContentFingerprint !== null
        ? {
            source: createDurableSourceDescriptor(
              preflight,
              sourceCheck.sourceDefinitionId,
              sourceContentFingerprint,
            ),
            chat: {
              timestampBasis: chatImport?.timestampBasis ?? "unknown",
              importedRowCount: chatImport?.totalRowCount ?? 0,
              offsetMs: Math.round(chatOffsetSeconds * 1_000),
            },
            candidateWindowMs: 45_000,
          }
        : null);
    if (input === null) {
      return null;
    }
    return {
      appVersion: APP_VERSION,
      engineVersion: SIGNAL_ENGINE_VERSION,
      generatedAt: new Date().toISOString(),
      input,
      selection: selectionResult,
      candidates: approvedExportCandidates,
    };
  };

  const exportCandidates = (format: HighlightExportFormat): void => {
    const request = createExportRequest();
    if (request === null) {
      return;
    }
    const file = createHighlightExportFile(format, request);
    const blob = new Blob([file.content], { type: file.mimeType });
    let objectUrl: string | null = null;
    try {
      objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = file.fileName;
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      const urlToRelease = objectUrl;
      globalThis.setTimeout(() => URL.revokeObjectURL(urlToRelease), 10_000);
      objectUrl = null;
      setLastExportFormat(format);
      setCopyStatus("idle");
      setExportError(null);
    } catch {
      if (objectUrl !== null) {
        URL.revokeObjectURL(objectUrl);
      }
      setLastExportFormat(null);
      setExportError("정리표 다운로드를 요청하지 못했어요. 브라우저의 다운로드 허용 설정을 확인해 주세요.");
    }
  };

  const candidateNumberFor = (candidateId: string): number => {
    const index = orderedCandidates.findIndex(({ id }) => id === candidateId);
    return index >= 0 ? index + 1 : 1;
  };

  const renderAndDownloadClip = async (
    candidate: ReviewedCandidate,
    candidateNumber: number,
    signal: AbortSignal,
  ): Promise<boolean> => {
    if (sourceFile === null) {
      return false;
    }
    const isCurrentJob = (): boolean =>
      isMounted.current && clipRenderAbortController.current?.signal === signal;
    const range = effectiveCandidateRange(
      candidate,
      boundaryRevisions[candidate.id],
    );
    setClipDownloadStatusById((current) => ({
      ...current,
      [candidate.id]: "rendering",
    }));
    setClipDownloadErrorById((current) => {
      const next = { ...current };
      delete next[candidate.id];
      return next;
    });
    setClipDownloadProgressById((current) => ({
      ...current,
      [candidate.id]: 0,
    }));
    try {
      const { renderHighlightClip } = await import("./media/clipRenderer");
      const result = await renderHighlightClip({
        sourceFile,
        range,
        candidateNumber,
        signal,
        onProgress: ({ ratio }: ClipRenderProgress) => {
          if (isCurrentJob()) {
            setClipDownloadProgressById((current) => ({
              ...current,
              [candidate.id]: ratio,
            }));
          }
        },
      });
      if (!isCurrentJob()) {
        return false;
      }
      triggerClipDownload(result.blob, result.fileName);
      setClipDownloadProgressById((current) => ({
        ...current,
        [candidate.id]: 1,
      }));
      setClipDownloadStatusById((current) => ({
        ...current,
        [candidate.id]: "completed",
      }));
      return true;
    } catch (error) {
      if (!isCurrentJob()) {
        return false;
      }
      setClipDownloadStatusById((current) => ({
        ...current,
        [candidate.id]: "failed",
      }));
      setClipDownloadErrorById((current) => ({
        ...current,
        [candidate.id]: explainClipRenderError(error),
      }));
      return false;
    }
  };

  const downloadCandidateClip = (candidate: ReviewedCandidate): void => {
    if (sourceFile === null) {
      setClipDownloadErrorById((current) => ({
        ...current,
        [candidate.id]: "원본 영상을 다시 연결해야 클립 파일을 만들 수 있어요.",
      }));
      return;
    }
    if (
      clipBatchStatus === "rendering" ||
      clipRenderAbortController.current !== null
    ) {
      return;
    }
    const controller = new AbortController();
    clipRenderAbortController.current = controller;
    setClipBatchError(null);
    void renderAndDownloadClip(
      candidate,
      candidateNumberFor(candidate.id),
      controller.signal,
    ).finally(() => {
      if (clipRenderAbortController.current?.signal === controller.signal) {
        clipRenderAbortController.current = null;
      }
    });
  };

  const downloadApprovedClips = (): void => {
    if (sourceFile === null) {
      setClipBatchError("원본 영상을 다시 연결해야 클립 파일을 만들 수 있어요.");
      return;
    }
    if (approvedCandidates.length === 0 || clipRenderAbortController.current !== null) {
      return;
    }
    const chronologicalCandidates = [...approvedCandidates].sort((left, right) => {
      const leftRange = effectiveCandidateRange(
        left,
        boundaryRevisions[left.id],
      );
      const rightRange = effectiveCandidateRange(
        right,
        boundaryRevisions[right.id],
      );
      return leftRange.startMs - rightRange.startMs || left.id.localeCompare(right.id);
    });
    const controller = new AbortController();
    clipRenderAbortController.current = controller;
    setClipBatchStatus("rendering");
    setClipBatchCompletedCount(0);
    setClipBatchError(null);
    void (async () => {
      let failedCount = 0;
      let completedCount = 0;
      for (const candidate of chronologicalCandidates) {
        if (controller.signal.aborted) {
          break;
        }
        const completed = await renderAndDownloadClip(
          candidate,
          candidateNumberFor(candidate.id),
          controller.signal,
        );
        if (completed) {
          completedCount += 1;
          setClipBatchCompletedCount(completedCount);
        } else {
          failedCount += 1;
        }
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 150));
      }
      if (controller.signal.aborted) {
        return;
      }
      if (failedCount > 0) {
        setClipBatchStatus("failed");
        setClipBatchError(`${failedCount}개 클립을 만들지 못했어요. 실패한 후보의 안내를 확인해 주세요.`);
      } else {
        setClipBatchStatus("completed");
      }
    })().finally(() => {
      if (clipRenderAbortController.current?.signal === controller.signal) {
        clipRenderAbortController.current = null;
      }
    });
  };

  useEffect(() => {
    const wholeContextGateSettled =
      broadcastContextStatus === "completed" &&
      semanticLeadRefinementStatus === "completed";
    const operationKey =
      sourceContentFingerprint === null
        ? null
        : `${sourceContentFingerprint}:${candidateDetailCandidateIds.join("|")}`;
    if (
      !analysisComplete ||
      automaticCandidateDetailIds.length === 0 ||
      sourceFile === null ||
      operationKey === null ||
      !wholeContextGateSettled ||
      candidatePassBBusy ||
      autoCandidatePassBSourceRef.current === operationKey
    ) {
      return;
    }
    autoCandidatePassBSourceRef.current = operationKey;
    const timer = window.setTimeout(() => {
      void runCandidatePassBRef.current(automaticCandidateDetailIds);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [
    analysisComplete,
    automaticCandidateDetailIds,
    broadcastContextStatus,
    broadcastTranscriptStatus,
    candidateDetailCandidateIds,
    candidatePassBBusy,
    semanticLeadRefinementStatus,
    sourceContentFingerprint,
    sourceFile,
  ]);

  useEffect(() => {
    const runId = currentAnalysisRunId;
    const inputSignature =
      openedRecoveredResult?.terminal.inputSignature ??
      analysisRun?.inputSignature ??
      sourceContentFingerprint;
    if (
      // Whole-context reasoning is billed once per map. During the parallel
      // prelude the transcript map is uniform-only and candidates are absent,
      // so reasoning here would spend on an incomplete picture and then spend
      // again. The scan completing is what seals the map.
      !analysisComplete ||
      runId === null ||
      inputSignature === null ||
      boundarySourceDurationMs <= 0 ||
      boundedBroadcastContextChapters.length === 0 ||
      !["completed", "completedWithGaps"].includes(broadcastTranscriptStatus)
    ) {
      return;
    }

    const operationKey = `${runId}:${inputSignature}`;
    if (autoBroadcastContextSourceRef.current === operationKey) {
      return;
    }
    autoBroadcastContextSourceRef.current = operationKey;
    broadcastContextAbortController.current?.abort();
    const controller = new AbortController();
    broadcastContextAbortController.current = controller;
    setBroadcastContextStatus("running");
    setBroadcastContextError(null);

    const contextInput = {
      sourceDurationMs: boundarySourceDurationMs,
      chapters: boundedBroadcastContextChapters,
      candidates: broadcastContextCandidateInputs,
      outputLanguage: analysisLanguage,
      ...(sourceCastRosterId === null ? {} : { castRosterId: sourceCastRosterId }),
    };
    const applyContextResult = (
      result: BroadcastContextResult,
      refinementLeadIds: readonly string[],
      fastRefinementLeadIds: readonly string[],
    ): void => {
      const availableLeadIds = new Set(result.discoveredLeads.map((lead) => lead.leadId));
      const safeRefinementLeadIds = [
        ...new Set(refinementLeadIds.filter((leadId) => availableLeadIds.has(leadId))),
      ].slice(0, MAX_TOPICAL_REFINEMENT_LEADS);
      const safeRefinementLeadIdSet = new Set(safeRefinementLeadIds);
      const safeFastRefinementLeadIds = [
        ...new Set(
          fastRefinementLeadIds.filter((leadId) =>
            safeRefinementLeadIdSet.has(leadId),
          ),
        ),
      ];
      setBroadcastContextResult(result);
      setBroadcastContextRefinementLeadIds(safeRefinementLeadIds);
      setBroadcastContextFastRefinementLeadIds(safeFastRefinementLeadIds);
      setTimelineSemanticChapterRevealCount(0);
      setTimelineSemanticChapters(result.semanticChapters);
      setTimelineInspectionTarget(null);
      const qualified = finalizeContextQualifiedCandidates(candidates, result.annotations);
      setCandidateAiProjectionById(qualified.projectionById);
      const survivingIds = new Set([
        ...qualified.selectedCandidates.map((candidate) => candidate.id),
        ...qualified.reviewCandidates.map((candidate) => candidate.id),
      ]);
      const survivingCandidates = candidates.filter(
        (candidate) =>
          candidate.reviewState === "approved" ||
          (candidate.reviewState !== "rejected" &&
            survivingIds.has(candidate.id) &&
            !explicitMusicOnlyCandidateIds.has(candidate.id)),
      );
      setSelectionResult((current) =>
        current === null
          ? current
          : { ...current, candidateCount: survivingCandidates.length },
      );
      setBroadcastContextStatus("completed");
    };

    void (async () => {
      const contextInputSignature = await createContentFingerprint([
        inputSignature,
        JSON.stringify(contextInput),
        `broadcast-context-routing:${AI_BROADCAST_CONTEXT_ROUTING_REVISION}`,
        `topical-discovery:${BROADCAST_TOPICAL_DISCOVERY_VERSION}`,
      ]);
      if (controller.signal.aborted || !isMounted.current) return;
      const store = getResultStore();
      const saved = await store.getBroadcastContextSession(runId);
      if (
        saved !== null &&
        saved.inputSignature === inputSignature &&
        saved.contextInputSignature === contextInputSignature &&
        saved.contextResultJson !== null
      ) {
        let savedPayload: unknown;
        try {
          savedPayload = JSON.parse(saved.contextResultJson);
        } catch {
          savedPayload = null;
        }
        const savedEnvelope = unpackPersistedBroadcastContext(savedPayload);
        const savedResult = parsePersistedBroadcastContextResult(
          savedEnvelope.resultPayload,
          contextInput,
        );
        if (savedResult !== null && savedEnvelope.refinementLeadIds !== null) {
          if (!controller.signal.aborted && isMounted.current) {
            applyContextResult(
              savedResult,
              savedEnvelope.refinementLeadIds,
              savedEnvelope.fastRefinementLeadIds ?? [],
            );
          }
          return;
        }
      }

      const discoverySlices = createParallelBroadcastTopicalDiscoverySlices(
        boundedBroadcastContextChapters,
      );
      const [overviewResult, discoveryResults] = await Promise.all([
        requestBroadcastContextDeepseek(contextInput, {
          signal: controller.signal,
        }),
        Promise.allSettled(
          discoverySlices.map((slice) =>
            requestBroadcastContextDeepseek(
              {
                sourceDurationMs: boundarySourceDurationMs,
                chapters: slice.chapters,
                candidates: [],
                outputLanguage: analysisLanguage,
                ...(sourceCastRosterId === null
                  ? {}
                  : { castRosterId: sourceCastRosterId }),
              },
              { signal: controller.signal, analysisMode: "discovery" },
            ),
          ),
        ),
      ]);
      if (controller.signal.aborted || !isMounted.current) return;
      const result: BroadcastContextResult = {
        ...overviewResult,
        discoveredLeads: mergeBroadcastTopicalDiscoveryLeads([
          overviewResult.discoveredLeads,
          ...discoveryResults.flatMap((discovery) =>
            discovery.status === "fulfilled"
              ? [discovery.value.discoveredLeads]
              : [],
          ),
        ]),
      };
      const juryPlan = createBroadcastTopicalLeadJuryPlan(
        boundarySourceDurationMs,
        result.broadcastSummaryKo,
        result.semanticChapters,
        result.discoveredLeads,
      );
      let refinementLeadIds: readonly string[];
      let fastRefinementLeadIds: readonly string[];
      if (juryPlan.candidates.length === 0) {
        refinementLeadIds = [];
        fastRefinementLeadIds = [];
      } else {
        try {
          const juryResult = await requestBroadcastContextDeepseek(
            {
              sourceDurationMs: boundarySourceDurationMs,
              chapters: juryPlan.chapters,
              candidates: juryPlan.candidates,
              outputLanguage: analysisLanguage,
              ...(sourceCastRosterId === null
                ? {}
                : { castRosterId: sourceCastRosterId }),
            },
            { signal: controller.signal, analysisMode: "selection" },
          );
          refinementLeadIds = selectBroadcastTopicalRefinementLeadIds(
            result.discoveredLeads,
            juryPlan,
            juryResult.annotations,
            result.semanticChapters,
          );
          const refinementLeadIdSet = new Set(refinementLeadIds);
          fastRefinementLeadIds = selectBroadcastTopicalJuryApprovedLeadIds(
            result.discoveredLeads,
            juryPlan,
            juryResult.annotations,
          ).filter((leadId) => refinementLeadIdSet.has(leadId));
        } catch {
          // The overview and discovery calls are already paid. Keep a bounded
          // high-recall fallback if only the inexpensive jury transport fails.
          refinementLeadIds = [...result.discoveredLeads]
            .sort(
              (left, right) =>
                right.confidence - left.confidence || left.startMs - right.startMs,
            )
            .slice(0, 4)
            .map((lead) => lead.leadId);
          // Jury transport failed, so none of these fallback leads has already
          // earned the cheaper localization-only contract.
          fastRefinementLeadIds = [];
        }
      }
      if (controller.signal.aborted || !isMounted.current) return;
      const transcriptSession = await store.getBroadcastContextSession(runId);
      if (
        transcriptSession === null ||
        transcriptSession.inputSignature !== inputSignature
      ) {
        throw new Error("저장된 방송 대사 지도와 전체 맥락 결과를 연결하지 못했어요.");
      }
      await store.putBroadcastContextSession({
        ...transcriptSession,
        contextInputSignature,
        contextResultJson: JSON.stringify({
          schemaVersion: "1.1.0",
          result,
          refinementLeadIds,
          fastRefinementLeadIds,
        }),
        recordedAt: new Date().toISOString(),
      });
      const reopened = await store.getBroadcastContextSession(runId);
      if (
        reopened?.contextInputSignature !== contextInputSignature ||
        reopened.contextResultJson === null
      ) {
        throw new Error("저장한 방송 전체 맥락 결과를 다시 확인하지 못했어요.");
      }
      const reopenedPayload: unknown = JSON.parse(reopened.contextResultJson);
      const reopenedEnvelope = unpackPersistedBroadcastContext(reopenedPayload);
      const reopenedResult = parsePersistedBroadcastContextResult(
        reopenedEnvelope.resultPayload,
        contextInput,
      );
      if (
        reopenedResult === null ||
        reopenedEnvelope.refinementLeadIds === null ||
        reopenedEnvelope.fastRefinementLeadIds === null
      ) {
        throw new Error("저장한 방송 전체 맥락 결과 형식을 다시 확인하지 못했어요.");
      }
      if (!controller.signal.aborted && isMounted.current) {
        applyContextResult(
          reopenedResult,
          reopenedEnvelope.refinementLeadIds,
          reopenedEnvelope.fastRefinementLeadIds ?? [],
        );
      }
    })()
      .catch((error: unknown) => {
        if (controller.signal.aborted || !isMounted.current) return;
        setBroadcastContextStatus("failed");
        setBroadcastContextError(
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "방송 전체 맥락을 판단하지 못했어요.",
        );
      })
      .finally(() => {
        if (broadcastContextAbortController.current === controller) {
          broadcastContextAbortController.current = null;
        }
      });
  }, [
    analysisComplete,
    analysisRun?.inputSignature,
    boundarySourceDurationMs,
    boundedBroadcastContextChapters,
    broadcastContextCandidateInputs,
    broadcastTranscriptStatus,
    candidates,
    currentAnalysisRunId,
    getResultStore,
    openedRecoveredResult,
    explicitMusicOnlyCandidateIds,
    resetCandidateRanking,
    sourceContentFingerprint,
    sourceCastRosterId,
    analysisLanguage,
  ]);

  useEffect(() => {
    if (
      broadcastContextStatus !== "completed" ||
      broadcastContextResult === null ||
      broadcastContextRefinementLeadIds === null ||
      broadcastContextFastRefinementLeadIds === null ||
      sourceFile === null ||
      currentAnalysisRunId === null ||
      boundarySourceDurationMs <= 0
    ) {
      return;
    }
    const leadById = new Map(
      broadcastContextResult.discoveredLeads.map((lead) => [lead.leadId, lead]),
    );
    const refinementLeads = broadcastContextRefinementLeadIds.flatMap((leadId) => {
      const lead = leadById.get(leadId);
      return lead === undefined ? [] : [lead];
    });
    const plan = youtubeCaptionTrack === null
      ? createDiscoveredLeadRefinementPlan(
          refinementLeads,
          { preserveInputOrder: true },
        )
      : createCaptionDiscoveredLeadRefinementPlan(
          refinementLeads,
          { preserveInputOrder: true },
        );
    if (plan.segments.length === 0) {
      setSemanticLeadRefinementStatus("completed");
      return;
    }
    const operationKey = `${currentAnalysisRunId}:${plan.selectedLeadIds.join("|")}`;
    if (autoSemanticLeadRefinementSourceRef.current === operationKey) {
      return;
    }
    autoSemanticLeadRefinementSourceRef.current = operationKey;
    semanticLeadRefinementAbortController.current?.abort();
    const controller = new AbortController();
    semanticLeadRefinementAbortController.current = controller;
    setSemanticLeadRefinementStatus("running");
    setSemanticLeadRefinementError(null);

    const chunks = plan.segments.map((segment) => ({
      chunkId: segment.segmentId,
      sourceStartMs: segment.sourceStartMs,
      sourceEndMs: segment.sourceEndMs,
      kind: "event" as const,
    }));
    const applySemanticCandidates = (
      proposals: readonly UnifiedHighlightCandidate[],
    ): void => {
      const semanticCandidates: ReviewedCandidate[] = [];
      for (const proposal of proposals) {
        const duplicatesExisting = candidates.some((candidate) => {
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
        });
        if (!duplicatesExisting) {
          semanticCandidates.push({
            ...proposal,
            reviewState: "unreviewed",
            approvedBoundaryRevision: null,
          });
        }
      }
      const nextCandidates = [...candidates, ...semanticCandidates].sort(
        (left, right) => left.peakMs - right.peakMs || left.id.localeCompare(right.id),
      );
      setCandidates(nextCandidates);
      setSelectionResult((current) =>
        current === null
          ? current
          : { ...current, candidateCount: nextCandidates.length },
      );
      resetCandidateRanking(nextCandidates);
      setSemanticLeadRefinementStatus("completed");
    };

    void (async () => {
      const refinementInputSignature = await createContentFingerprint([
        currentAnalysisRunId,
        JSON.stringify(plan),
        JSON.stringify(broadcastContextFastRefinementLeadIds),
        JSON.stringify(broadcastContextResult.discoveredLeads),
        youtubeCaptionTrack === null
          ? BROADCAST_TRANSCRIPT_ACTIVE_MODEL_REVISION
          : YOUTUBE_CAPTION_MODEL_REVISION,
      ]);
      if (controller.signal.aborted || !isMounted.current) return;
      const store = getResultStore();
      const savedSession = await store.getBroadcastContextSession(currentAnalysisRunId);
      if (
        savedSession?.refinementInputSignature === refinementInputSignature &&
        savedSession.refinementCandidatesJson !== null
      ) {
        let savedPayload: unknown;
        try {
          savedPayload = JSON.parse(savedSession.refinementCandidatesJson);
        } catch {
          savedPayload = null;
        }
        const savedCandidates = parseSemanticLeadCandidates(savedPayload);
        if (savedCandidates !== null) {
          applySemanticCandidates(savedCandidates);
          return;
        }
      }

      const refinementTranscripts = youtubeCaptionTrack === null
        ? (
            await runBroadcastTranscriptWorker(sourceFile, {
              sourceDurationMs: boundarySourceDurationMs,
              chunks,
              signal: controller.signal,
            })
          ).results
        : createYouTubeCaptionRefinementTranscripts(
            youtubeCaptionTrack,
            plan,
          );
      if (controller.signal.aborted || !isMounted.current) return;
      if (refinementTranscripts.length === 0) {
        throw new Error("새 의미 후보의 정확한 대사 위치를 다시 찾지 못했어요.");
      }
      const parentLeadById = new Map(
        broadcastContextResult.discoveredLeads.map((lead) => [lead.leadId, lead]),
      );
      const fastRefinementLeadIdSet = new Set(
        broadcastContextFastRefinementLeadIds,
      );
      const refinementResults = await mapWithConcurrency(
        plan.selectedLeadIds,
        MAX_TOPICAL_REFINEMENT_CONCURRENCY,
        async (leadId) => {
          const chapters = createDiscoveredLeadRefinementChapters(
            leadId,
            plan,
            refinementTranscripts,
            (() => {
              const parent = parentLeadById.get(leadId);
              return parent === undefined
                ? ""
                : `${parent.eventSummaryKo} / ${parent.evidenceCueKo}`;
            })(),
          );
          if (chapters.length === 0) {
            return { leadId, failed: true, leads: [] } as const;
          }
          try {
            const refined = await requestBroadcastContextDeepseek(
              {
                sourceDurationMs: boundarySourceDurationMs,
                chapters,
                candidates: [],
                outputLanguage: analysisLanguage,
                ...(sourceCastRosterId === null
                  ? {}
                  : { castRosterId: sourceCastRosterId }),
              },
              {
                signal: controller.signal,
                analysisMode: fastRefinementLeadIdSet.has(leadId)
                  ? "refinement-fast"
                  : "refinement",
              },
            );
            return {
              leadId,
              failed: false,
              leads: refined.discoveredLeads,
            } as const;
          } catch {
            return { leadId, failed: true, leads: [] } as const;
          }
        },
      );
      if (controller.signal.aborted || !isMounted.current) return;

      const proposals: UnifiedHighlightCandidate[] = [];
      for (const refinement of refinementResults) {
        if (!refinement.failed) {
          for (const lead of refinement.leads) {
            const evidence = materializeRefinedDiscoveredLeadEvidence(
              lead,
              refinementTranscripts,
              boundarySourceDurationMs,
            );
            if (evidence === null) continue;
            proposals.push(
              createSemanticLeadCandidate(
                lead,
                evidence.range,
                evidence.transcriptKo,
              ),
            );
          }
          continue;
        }

        // A transport failure must not erase a paid overview result. Keep the
        // previous cue matcher for that parent only; a successful empty result
        // is an intentional abstention and therefore stays empty.
        const parentLead = parentLeadById.get(refinement.leadId);
        if (parentLead === undefined) continue;
        const range = refineDiscoveredLeadRange(
          parentLead,
          plan,
          refinementTranscripts,
          boundarySourceDurationMs,
        );
        if (range === null || range.transcriptMatchScore < 0.2) continue;
        const matchedSegment = plan.segments.find(
          (segment) => segment.segmentId === range.matchedSegmentId,
        );
        const transcript = matchedSegment === undefined
          ? undefined
          : refinementTranscripts.find(
              (item) =>
                item.sourceStartMs === matchedSegment.sourceStartMs &&
                item.sourceEndMs === matchedSegment.sourceEndMs,
            );
        if (transcript !== undefined) {
          proposals.push(
            createSemanticLeadCandidate(parentLead, range, transcript.textKo),
          );
        }
      }

      const semanticCandidates: UnifiedHighlightCandidate[] = [];
      for (const proposal of [...proposals].sort(
        (left, right) => right.score - left.score || left.peakMs - right.peakMs,
      )) {
        const duplicate = semanticCandidates.some((existing) => {
          const overlapMs = Math.max(
            0,
            Math.min(existing.endMs, proposal.endMs) -
              Math.max(existing.startMs, proposal.startMs),
          );
          const shorterMs = Math.min(
            existing.endMs - existing.startMs,
            proposal.endMs - proposal.startMs,
          );
          return shorterMs > 0 && overlapMs / shorterMs >= 0.6;
        });
        if (!duplicate && semanticCandidates.length < 12) {
          semanticCandidates.push(proposal);
        }
      }
      const currentSession = await store.getBroadcastContextSession(currentAnalysisRunId);
      if (currentSession === null) {
        throw new Error("새 의미 후보를 저장할 분석 세션을 찾지 못했어요.");
      }
      const refinementCandidatesJson = serializeSemanticLeadCandidates(
        semanticCandidates,
      );
      await store.putBroadcastContextSession({
        ...currentSession,
        refinementInputSignature,
        refinementCandidatesJson,
        recordedAt: new Date().toISOString(),
      });
      const reopened = await store.getBroadcastContextSession(currentAnalysisRunId);
      if (
        reopened?.refinementInputSignature !== refinementInputSignature ||
        reopened.refinementCandidatesJson !== refinementCandidatesJson
      ) {
        throw new Error("저장한 새 의미 후보 위치를 다시 확인하지 못했어요.");
      }
      applySemanticCandidates(semanticCandidates);
    })()
      .catch((error: unknown) => {
        if (controller.signal.aborted || !isMounted.current) return;
        setSemanticLeadRefinementStatus("failed");
        setSemanticLeadRefinementError(
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "새 의미 후보의 정확한 위치를 찾지 못했어요.",
        );
      })
      .finally(() => {
        if (semanticLeadRefinementAbortController.current === controller) {
          semanticLeadRefinementAbortController.current = null;
        }
      });
  }, [
    boundarySourceDurationMs,
    broadcastContextRefinementLeadIds,
    broadcastContextFastRefinementLeadIds,
    broadcastContextResult,
    broadcastContextStatus,
    candidates,
    currentAnalysisRunId,
    getResultStore,
    resetCandidateRanking,
    sourceCastRosterId,
    sourceFile,
    youtubeCaptionTrack,
    analysisLanguage,
  ]);

  useEffect(() => {
    const runId = currentAnalysisRunId;
    const inputSignature =
      openedRecoveredResult?.terminal.inputSignature ??
      analysisRun?.inputSignature ??
      sourceContentFingerprint;
    if (
      !canStartTranscriptRun({
        analysisComplete,
        analysisRunStatus: analysisRun?.status ?? null,
        broadcastTranscriptStatus,
      }) ||
      runId === null ||
      inputSignature === null ||
      sourceFile === null ||
      sourceContentFingerprint === null ||
      broadcastContextSamplingPlan === null ||
      broadcastContextSamplingPlan.transcriptMode !== "adaptive-qwen-asr"
    ) {
      return;
    }

    const transcriptPhase = transcriptPhaseFor(analysisComplete);
    const operationKey = transcriptOperationKey(
      runId,
      sourceContentFingerprint,
      transcriptPhase,
    );
    if (autoBroadcastTranscriptSourceRef.current === operationKey) {
      return;
    }
    autoBroadcastTranscriptSourceRef.current = operationKey;
    const sourceDurationMs = broadcastContextSamplingPlan.sourceDurationMs;
    const chunks = createBroadcastContextTranscriptionChunks(
      broadcastContextSamplingPlan.samplingWindows,
    );
    if (chunks.length === 0) {
      setBroadcastTranscriptStatus("completed");
      setBroadcastTranscriptChapters([]);
      setBroadcastTranscriptExplorationCells([]);
      return;
    }

    broadcastTranscriptAbortController.current?.abort();
    const controller = new AbortController();
    broadcastTranscriptAbortController.current = controller;
    setBroadcastTranscriptStatus("running");
    setBroadcastTranscriptProgress(null);
    setBroadcastTranscriptError(null);

    void (async () => {
      const store = getResultStore();
      const youtubeVideoId = youtubeVideoIdFromSourceName(sourceFile.name);
      const saved = await store.getBroadcastContextSession(runId);
      const matchedSaved =
        saved !== null &&
        saved.inputSignature === inputSignature &&
        saved.sourceDurationMs === sourceDurationMs
          ? saved
          : null;

      const persistTranscriptMap = async (
        chapters: readonly BroadcastContextChapterInput[],
        completeAudioCoverage: boolean,
        gapChunkIds: readonly string[],
        modelRevision: string,
      ) => {
        const record = {
          kind: "broadcastContextSession" as const,
          runId,
          schemaVersion: BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
          inputSignature,
          sourceDurationMs,
          completeAudioCoverage,
          chapters,
          gapChunkIds,
          modelRevision,
          contextInputSignature: null,
          contextResultJson: null,
          refinementInputSignature: null,
          refinementCandidatesJson: null,
          recordedAt: new Date().toISOString(),
        };
        await store.putBroadcastContextSession(record);
        const reopened = await store.getBroadcastContextSession(runId);
        if (
          reopened === null ||
          reopened.inputSignature !== inputSignature ||
          reopened.sourceDurationMs !== sourceDurationMs ||
          JSON.stringify(reopened.chapters) !== JSON.stringify(chapters)
        ) {
          throw new Error("저장한 방송 대사 지도를 다시 확인하지 못했어요.");
        }
        return reopened;
      };

      if (
        matchedSaved !== null &&
        youtubeVideoId !== null &&
        matchedSaved.modelRevision === YOUTUBE_CAPTION_MODEL_REVISION
      ) {
          try {
            const captionTrack = await requestYouTubeCaptionTrack(youtubeVideoId, {
              signal: controller.signal,
            });
            if (!controller.signal.aborted && isMounted.current) {
              setYouTubeCaptionTrack(captionTrack);
            }
          } catch {
            // The persisted complete chapter map remains usable offline.
          }
        if (!controller.signal.aborted && isMounted.current) {
          setBroadcastTranscriptExplorationCells(
            createChapterExplorationCells(matchedSaved.chapters),
          );
          setBroadcastTranscriptChapters(matchedSaved.chapters);
          setBroadcastTranscriptStatus("completed");
        }
        return;
      }

      const savedQwenCheckpoint =
        matchedSaved !== null &&
        (matchedSaved.modelRevision === BROADCAST_TRANSCRIPT_ACTIVE_MODEL_REVISION ||
          matchedSaved.modelRevision ===
            BROADCAST_TRANSCRIPT_PREVIOUS_ACTIVE_MODEL_REVISION ||
          matchedSaved.modelRevision ===
            BROADCAST_TRANSCRIPT_MIXED_CHECKPOINT_MODEL_REVISION)
          ? matchedSaved
          : null;
      if (
        savedQwenCheckpoint !== null &&
        savedQwenCheckpoint.gapChunkIds.length === 0 &&
        (savedQwenCheckpoint.completeAudioCoverage ||
          broadcastContextSamplingPlan.estimatedAudioCoverageRatio < 1)
      ) {
        if (!controller.signal.aborted && isMounted.current) {
          setBroadcastTranscriptExplorationCells(
            createTranscriptExplorationCells(
              createDistributedTranscriptExplorationOrder(chunks),
              "complete",
            ),
          );
          setBroadcastTranscriptChapters(savedQwenCheckpoint.chapters);
          setBroadcastTranscriptStatus(
            savedQwenCheckpoint.completeAudioCoverage
              ? "completed"
              : "completedWithGaps",
          );
        }
        return;
      }

      if (youtubeVideoId !== null) {
        try {
          const captionTrack = await requestYouTubeCaptionTrack(youtubeVideoId, {
            signal: controller.signal,
          });
          if (controller.signal.aborted || !isMounted.current) return;
          setYouTubeCaptionTrack(captionTrack);
          const captionChapters = createYouTubeCaptionChapters(
            captionTrack,
            sourceDurationMs,
          );
          if (captionChapters.length > 0) {
            const reopened = await persistTranscriptMap(
              captionChapters,
              true,
              [],
              YOUTUBE_CAPTION_MODEL_REVISION,
            );
            if (!controller.signal.aborted && isMounted.current) {
              setBroadcastTranscriptExplorationCells(
                createChapterExplorationCells(reopened.chapters),
              );
              setBroadcastTranscriptChapters(reopened.chapters);
              setBroadcastTranscriptStatus("completed");
            }
            return;
          }
        } catch {
          // YouTube may throttle or withhold captions. The bounded Qwen audio
          // path below is the automatic fallback and needs no user action.
        }
      }

      const checkpointChapters = savedQwenCheckpoint?.chapters ?? [];
      const recoveredCheckpointModelRevision =
        savedQwenCheckpoint?.modelRevision ===
          BROADCAST_TRANSCRIPT_PREVIOUS_ACTIVE_MODEL_REVISION ||
        savedQwenCheckpoint?.modelRevision ===
          BROADCAST_TRANSCRIPT_MIXED_CHECKPOINT_MODEL_REVISION
          ? BROADCAST_TRANSCRIPT_MIXED_CHECKPOINT_MODEL_REVISION
          : BROADCAST_TRANSCRIPT_ACTIVE_MODEL_REVISION;
      const uncoveredSamplingWindows = subtractBroadcastContextCoveredRanges(
        broadcastContextSamplingPlan.samplingWindows,
        checkpointChapters,
      );
      const transcriptChunks = createBroadcastContextTranscriptionChunks(
        uncoveredSamplingWindows,
      );
      if (checkpointChapters.length > 0 && !controller.signal.aborted) {
        setBroadcastTranscriptChapters(checkpointChapters);
      }
      if (transcriptChunks.length === 0) {
        const completeAudioCoverage =
          broadcastContextSamplingPlan.estimatedAudioCoverageRatio === 1;
        const migratedChapters = mergeBroadcastTranscriptChapters(
          checkpointChapters,
          [],
          sourceDurationMs,
          completeAudioCoverage,
        );
        const reopened = await persistTranscriptMap(
          migratedChapters,
          completeAudioCoverage,
          [],
          savedQwenCheckpoint?.modelRevision ??
            BROADCAST_TRANSCRIPT_ACTIVE_MODEL_REVISION,
        );
        setBroadcastTranscriptChapters(reopened.chapters);
        setBroadcastTranscriptExplorationCells(
          createTranscriptExplorationCells(
            createDistributedTranscriptExplorationOrder(chunks),
            "complete",
          ),
        );
        setBroadcastTranscriptStatus(
          completeAudioCoverage ? "completed" : "completedWithGaps",
        );
        return;
      }

      const explorationChunks = createDistributedTranscriptExplorationOrder(
        transcriptChunks,
      );
      setBroadcastTranscriptExplorationCells(
        createTranscriptExplorationCells(explorationChunks),
      );
      const updateExplorationCell = (
        chunkId: string,
        state: BroadcastTranscriptExplorationCellState,
        stage: BroadcastTranscriptWorkerProgress["stage"] | null = null,
      ): void => {
        if (controller.signal.aborted || !isMounted.current) return;
        setBroadcastTranscriptExplorationCells((current) =>
          current.map((cell) =>
            cell.chunkId === chunkId ? { ...cell, state, stage } : cell,
          ),
        );
      };
      const checkpointResults = new Map<string, BroadcastTranscriptQwenResult>();
      let checkpointPersistence: Promise<void> = Promise.resolve();
      const result = await runBroadcastTranscriptWorker(sourceFile, {
        sourceDurationMs,
        chunks: explorationChunks,
        signal: controller.signal,
        onProgress: (progress) => {
          if (!controller.signal.aborted && isMounted.current) {
            setBroadcastTranscriptProgress(progress);
            updateExplorationCell(progress.chunkId, "active", progress.stage);
          }
        },
        onPartialResult: (chunkId, partialResult) => {
          updateExplorationCell(chunkId, "complete");
          checkpointResults.set(chunkId, partialResult);
          const resultSnapshot = [...checkpointResults.values()];
          const pendingGapIds = transcriptChunks
            .filter((chunk) => !checkpointResults.has(chunk.chunkId))
            .map((chunk) => chunk.chunkId);
          checkpointPersistence = checkpointPersistence
            .catch(() => undefined)
            .then(async () => {
              const recoveredChapters = createBroadcastTranscriptChapters(
                resultSnapshot,
                sourceDurationMs,
                false,
              );
              const checkpointMap = mergeBroadcastTranscriptChapters(
                checkpointChapters,
                recoveredChapters,
                sourceDurationMs,
                false,
              );
              const reopened = await persistTranscriptMap(
                checkpointMap,
                false,
                pendingGapIds,
                recoveredCheckpointModelRevision,
              );
              if (!controller.signal.aborted && isMounted.current) {
                setBroadcastTranscriptChapters(reopened.chapters);
              }
            });
        },
        onChunkGap: (chunkId) => {
          updateExplorationCell(chunkId, "gap");
        },
      });
      if (controller.signal.aborted || !isMounted.current) {
        return;
      }
      await checkpointPersistence.catch(() => undefined);
      setYouTubeCaptionTrack(null);
      const finalGapChunkIds = result.gapChunkIds;
      const completeAudioCoverage =
        broadcastContextSamplingPlan.estimatedAudioCoverageRatio === 1 &&
        finalGapChunkIds.length === 0;
      const recoveredChapters = createBroadcastTranscriptChapters(
        result.results,
        sourceDurationMs,
        completeAudioCoverage,
      );
      const chapters = mergeBroadcastTranscriptChapters(
        checkpointChapters,
        recoveredChapters,
        sourceDurationMs,
        completeAudioCoverage,
      );
      const reopened = await persistTranscriptMap(
        chapters,
        completeAudioCoverage,
        finalGapChunkIds,
        recoveredCheckpointModelRevision,
      );
      if (!controller.signal.aborted && isMounted.current) {
        setBroadcastTranscriptChapters(reopened.chapters);
        if (reopened.chapters.length === 0) {
          setBroadcastTranscriptStatus("failed");
          setBroadcastTranscriptError(
            "방송 대사 근거를 한 구간도 확보하지 못했어요. 음성 인식 연결이나 원본 음성을 확인한 뒤 다시 시도해 주세요.",
          );
          return;
        }
        setBroadcastTranscriptStatus(
          reopened.gapChunkIds.length > 0 || !reopened.completeAudioCoverage
            ? "completedWithGaps"
            : "completed",
        );
      }
    })()
      .catch((error: unknown) => {
        if (controller.signal.aborted || !isMounted.current) {
          return;
        }
        setBroadcastTranscriptStatus("failed");
        setBroadcastTranscriptError(
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "방송 전체 대사를 분석하지 못했어요.",
        );
      })
      .finally(() => {
        if (broadcastTranscriptAbortController.current === controller) {
          broadcastTranscriptAbortController.current = null;
        }
      });
  }, [
    analysisComplete,
    analysisRun?.inputSignature,
    analysisRun?.status,
    broadcastContextSamplingPlan,
    broadcastTranscriptStatus,
    currentAnalysisRunId,
    getResultStore,
    openedRecoveredResult?.terminal.inputSignature,
    sourceContentFingerprint,
    sourceFile,
  ]);

  const copyApprovedTimecodes = async (): Promise<void> => {
    if (approvedCandidates.length === 0) {
      return;
    }
    try {
      if (typeof navigator.clipboard?.writeText !== "function") {
        throw new Error("Clipboard API is unavailable.");
      }
      await navigator.clipboard.writeText(
        createHighlightClipboardText(approvedExportCandidates),
      );
      setCopyStatus("copied");
      setLastExportFormat(null);
      setExportError(null);
    } catch {
      setCopyStatus("failed");
      setExportError("타임코드를 복사하지 못했어요. CSV나 Markdown 정리표를 받아 주세요.");
    }
  };

  const firstChatWarning = useMemo(
    () => chatImport?.diagnostics.find(({ severity }) => severity === "warning")?.message ?? null,
    [chatImport],
  );
  const candidateRankingProposalView = candidateRankingView.latestProposal;
  const candidateRankingProposal = candidateRankingProposalView?.proposal ?? null;
  const candidateRankingProposalDisposition =
    candidateRankingProposalView === null
      ? null
      : candidateRankingProposalView.disposition === "stale" ||
          !rankingCandidateSetMatches ||
          !rankingEvidenceMatches
        ? "stale"
        : "fresh";
  const candidateRankingApplied = candidateRankingView.appliedProposalId !== null;
  const candidateReviewFeatureAvailability =
    deriveCandidateReviewFeatureAvailability(candidates.length);
  const candidateRankingPreviewEntries = useMemo(
    () =>
      candidateRankingProposal === null
        ? []
        : [...candidateRankingProposal.entries]
            .sort(
              (left, right) =>
                left.proposedOrdinal - right.proposedOrdinal ||
                left.candidateId.localeCompare(right.candidateId),
            )
            .slice(0, 5),
    [candidateRankingProposal],
  );

  return (
    <div className="rh-app">
      <header>
        <div className="header-inner rh-header-inner">
          <h1>
            <span className="rh-brand-mark" aria-hidden="true">E</span>
            Ex<span>Clipper</span>
          </h1>
          <h2 id="page-title" className="rh-header-title">
            {ui("클립 분석 AI", "Clip Analysis AI")}
          </h2>
          <div className="rh-header-actions">
            <span className="rh-privacy-pill">
              {ui("개인 편집 어시스턴트", "Personal editing assistant")}
            </span>
            <div className="rh-language-switch" role="group" aria-label={ui("언어 선택", "Language")}>
              {(["ko", "en"] as const).map((language) => (
                <button
                  key={language}
                  type="button"
                  data-active={analysisLanguage === language}
                  aria-pressed={analysisLanguage === language}
                  disabled={sourceFile !== null || pendingFileName !== null || analysisRun !== null}
                  onClick={() => setAnalysisLanguage(language)}
                >
                  {language === "ko" ? "한국어" : "English"}
                </button>
              ))}
            </div>
            <button
              className="theme-btn"
              type="button"
              aria-label={theme === "light"
                ? ui("어두운 화면으로 바꾸기", "Use dark theme")
                : ui("밝은 화면으로 바꾸기", "Use light theme")}
              onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
            >
              <span aria-hidden="true">{theme === "light" ? "☾" : "☀"}</span>
            </button>
          </div>
        </div>
      </header>

      {showStatusBar && (
        <div className="status-bar" aria-label="현재 작업 상태">
          <div className="status-bar-inner rh-status-inner">
          <div className="status-item">
            <span className={`dot ${sourceReady ? "dot-green" : sourceCheckBusy ? "dot-blue" : "dot-gray"}`} />
            <span className="label">원본</span>
            <span className="val">
              {openedRecoveredResult !== null && candidates.length === 0
                ? "재연결 필요 없음"
                : sourceCheckLabel(sourceCheck)}
            </span>
          </div>
          <span className="status-divider" aria-hidden="true" />
          <div className="status-item">
            <span className={`dot ${analysisComplete ? "dot-green" : analysisBusy ? "dot-blue" : "dot-gray"}`} />
            <span className="label">분석</span>
            <span className="val">{openedRecoveredResult !== null ? "저장 결과 열림" : analysisRunLabel(analysisRun)}</span>
          </div>
          <span className="status-divider" aria-hidden="true" />
          <div className="status-item">
            <span className="label">정밀 분석</span>
            <span className="val">{candidatePassBDetailAnalysisLabel}</span>
          </div>
          <span className="status-ts">v{APP_VERSION}</span>
          </div>
        </div>
      )}

      <main className="rh-shell">
        <nav className="ex-rail" aria-label={ui("작업 단계", "Workflow steps")}>
          <span className="ex-rail-brand" aria-hidden="true">E</span>
          <ol className="ex-rail-steps">
            {[
              {
                label:
                  openedRecoveredResult !== null && !sourceReady && candidates.length > 0
                    ? ui("원본 연결(선택)", "Connect source (optional)")
                    : ui("원본 고르기", "Choose source"),
                icon: (
                  <path d="M3 6.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2.4h8.5A1.5 1.5 0 0 1 20.5 9v9a1.5 1.5 0 0 1-1.5 1.5H4.5A1.5 1.5 0 0 1 3 18V6.5Z" />
                ),
              },
              {
                label: ui("AI가 먼저 찾기", "AI discovery"),
                icon: (
                  <path d="M4 15V9M8.5 18V6M13 20.5V3.5M17.5 15.5V8.5M21 12.5v-1" />
                ),
              },
              {
                label: ui("후보 검토", "Review candidates"),
                icon: (
                  <>
                    <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
                    <path d="M10.3 8.6v6.8l5.7-3.4-5.7-3.4Z" />
                  </>
                ),
              },
              {
                label: ui("결과 받기", "Export results"),
                icon: (
                  <path d="M12 3.5v11.3M7.3 10.3 12 15l4.7-4.7M4.5 18.5h15" />
                ),
              },
            ].map(({ label, icon }, index) => {
              const step = (index + 1) as 1 | 2 | 3 | 4;
              const complete = step < currentStep;
              const reachable = step <= currentStep;
              return (
                <li key={label} className="ex-rail-step">
                  <button
                    type="button"
                    data-step={step}
                    data-complete={complete}
                    aria-current={step === currentStep ? "step" : undefined}
                    disabled={!reachable}
                    title={label}
                    onClick={() => focusRailStep(step)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      {icon}
                    </svg>
                    <span className="rh-screen-reader-only">
                      {label}
                      {complete && ui(" 완료", " complete")}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <span className="ex-rail-fill" aria-hidden="true" />
          <button
            className="ex-rail-theme"
            type="button"
            aria-label={theme === "light"
              ? ui("어두운 화면으로 바꾸기", "Use dark theme")
              : ui("밝은 화면으로 바꾸기", "Use light theme")}
            onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
          >
            <span aria-hidden="true">{theme === "light" ? "☾" : "☀"}</span>
          </button>
        </nav>

        <div className="ex-shell-content">
        {showRecoveryPanel && (
        <details
          key={openedRecoveredResult?.terminal.runId ?? "recovery-catalog"}
          className="rh-panel rh-recovery-panel"
        >
          <summary className="rh-recovery-summary">
            <span>
              {openedRecoveredResult !== null
                ? "다른 저장 결과 보기"
                : recoveryCatalog.status === "ready"
                ? `지난 분석 결과 ${recoveryCatalog.audit.results.length}개`
                : "지난 분석 결과"}
            </span>
            <span>{openedRecoveredResult !== null ? "현재 결과 유지" : "저장된 기록"}</span>
          </summary>
          <section aria-labelledby="recovery-title">
          <div className="rh-section-heading">
            <div>
              <p className="rh-eyebrow">지난 분석 기록</p>
              <h3 id="recovery-title">지난 AI 분석 결과를 이어볼까요?</h3>
            </div>
            {openedRecoveredResult !== null && (
              <button
                className="btn btn-secondary"
                type="button"
                disabled={analysisBusy || candidateRefinementBusy}
                onClick={startFreshAnalysis}
              >
                새 영상으로 시작
              </button>
            )}
          </div>

          {recoveryCatalog.status === "failed" && (
            <div className="rh-notice rh-notice-with-action" data-tone="warning" role="status">
              <span>지난 결과 목록을 열 수 없어요. 새 영상 분석은 그대로 사용할 수 있습니다.</span>
              <button className="btn btn-secondary" type="button" onClick={() => void refreshRecoveryCatalog()}>
                목록 다시 확인
              </button>
            </div>
          )}
          {recoveryCatalog.status === "ready" && recoveryCatalog.audit.results.length > 0 && (
            <div className="rh-recovery-list">
              {recoveryCatalog.audit.results.map((recovered) => {
                const isOpen = openedRecoveredResult?.terminal.runId === recovered.terminal.runId;
                return (
                  <article className="rh-recovery-item" data-open={isOpen} key={recovered.terminal.runId}>
                    <div>
                      <strong>
                        {new Date(recovered.terminal.recordedAt).toLocaleString("ko-KR", {
                          month: "long",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })} · 후보 {recovered.finalResult.result.summary.candidateCount}개
                      </strong>
                      <p className="rh-help">
                        {formatDuration(recovered.finalResult.result.input.source.durationMs)} 영상 · {recovered.finalResult.result.input.source.container.toUpperCase()} · {recovered.finalResult.result.input.chat.importedRowCount > 0 ? `채팅 ${recovered.finalResult.result.input.chat.importedRowCount.toLocaleString("ko-KR")}줄 포함` : "채팅 없이 분석"} · {recovered.terminal.outcome === "completedWithGaps" ? "일부 신호 제외 완료" : "전체 계획 완료"}
                      </p>
                    </div>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      disabled={analysisBusy || candidateRefinementBusy || isOpen}
                      onClick={() => openRecoveredAnalysis(recovered)}
                    >
                      {isOpen ? "지금 열어둔 결과" : "이 결과 이어보기"}
                    </button>
                  </article>
                );
              })}
            </div>
          )}
          {candidateRefinementBusy && (
            <p className="rh-help" role="status">
              후보의 자세한 AI 단서를 찾는 중에는 결과를 바꾸지 않아요. 현재 작업을 먼저 멈추거나 끝날 때까지 기다려 주세요.
            </p>
          )}
          {recoveryCatalog.status === "ready" &&
            recoveryCatalog.audit.skippedCompletedResultCount +
              recoveryCatalog.audit.rejectedTerminalRecordCount >
              0 && (
              <p className="rh-notice" data-tone="warning" role="status">
                안전 검증을 통과하지 못한 이전 기록은 목록에서 숨겼어요. 새 분석 결과에는 영향을 주지 않습니다.
              </p>
            )}
          {openedRecoveredResult !== null && (
            <p className="rh-notice" role="status">
              AI 후보와 분석 수치는 복원했어요. 원본 영상은 저장하지 않았으므로 미리보려면 같은 파일을 다시 골라 주세요.
              승인·제외 판단은 아직 저장하지 않아 모두 ‘검토 전’으로 열었습니다.
            </p>
          )}
          </section>
        </details>
        )}

        {selectionResult === null && (analysisBusy || openedRecoveredResult !== null) && (
          <section className="rh-project-context rh-analysis-entry-workspace" aria-label="현재 편집 작업">
            <div className="rh-project-context-copy">
              <p className="rh-eyebrow">
                {ui(selectionResult !== null ? "현재 편집 작업" : "선택한 방송", selectionResult !== null ? "Current edit" : "Selected broadcast")}
              </p>
              <strong>
                {preflight?.metadata.name ?? "저장된 AI 분석 결과"}
              </strong>
              <span>
                {formatDuration(boundarySourceDurationMs)}
                {selectionResult !== null
                  ? ui(` · 후보 ${candidates.length}개 · ${reviewedCount}개 검토`, ` · ${candidates.length} candidates · ${reviewedCount} reviewed`)
                  : ui(" · 분석 준비 완료", " · Ready to analyze")}
              </span>
            </div>
            {selectionResult !== null && (
              <div className="rh-project-context-actions">
                {sourcePreviewUrl === null && candidates.length > 0 && (
                  <button className="btn btn-secondary" type="button" onClick={focusSourceSection}>
                    원본 다시 연결
                  </button>
                )}
                {sourcePreviewUrl === null && candidates.length > 0 && (
                  <input
                    ref={reconnectSourceInput}
                    hidden
                    className="rh-hidden-input"
                    type="file"
                    accept="video/*,.mp4,.webm,.mkv,.mov,.m4v"
                    disabled={sourceInputLocked}
                    aria-label="원래 영상 파일 다시 연결"
                    onChange={handleSourceInput}
                  />
                )}
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={analysisBusy || candidateRefinementBusy}
                  onClick={startFreshAnalysis}
                >
                  새 영상 분석
                </button>
              </div>
            )}
            {analysisBusy && (
              <section
                className="rh-live-analysis-panel rh-progress-tracks-panel"
                data-state="active"
                aria-label="현재 AI 분석 진행 상황"
                aria-live="polite"
              >
                <div className="rh-progress-head">
                  <p className="rh-eyebrow">{ui("오늘 방송 분석 중", "Analyzing today's broadcast")}</p>
                  <span className="rh-progress-eta">{progressRemainingLabel}</span>
                </div>
                <div className="rh-progress-tracks">
                  <div className="rh-progress-track" data-done={fastScanTrackRatio >= 1}>
                    <span className="rh-progress-track-label">{ui("반응 신호", "Reaction signals")}</span>
                    <div className="rh-progress-track-bar">
                      <i style={{ width: `${Math.round(Math.min(1, Math.max(0, fastScanTrackRatio)) * 100)}%` }} />
                    </div>
                    <span className="rh-progress-track-status">{fastScanTrackStatus}</span>
                  </div>
                  <div className="rh-progress-track" data-done={transcriptTrackDone}>
                    <span className="rh-progress-track-label">{ui("대사 인식", "Transcription")}</span>
                    <div className="rh-progress-track-bar">
                      <i style={{ width: `${Math.round(Math.min(1, Math.max(0, transcriptTrackRatio)) * 100)}%` }} />
                    </div>
                    <span className="rh-progress-track-status">{transcriptTrackStatus}</span>
                  </div>
                  <div className="rh-progress-track" data-done={chatTrackDone}>
                    <span className="rh-progress-track-label">{ui("채팅", "Chat")}</span>
                    <div className="rh-progress-track-bar">
                      <i style={{ width: chatTrackDone ? "100%" : "0%" }} />
                    </div>
                    <span className="rh-progress-track-status">{chatTrackStatus}</span>
                  </div>
                </div>
                <p className="rh-progress-keepopen">
                  {ui(
                    "이 탭을 열어 두면 계속 진행돼요. 닫으면 처음부터 다시 분석해야 해요.",
                    "Keep this tab open — closing it restarts the analysis from the beginning.",
                  )}
                </p>
                {analysisCanBeCancelled && (
                  <button className="btn btn-secondary rh-live-analysis-cancel" type="button" onClick={cancelAnalysis}>
                    {ui("안전하게 취소", "Cancel safely")}
                  </button>
                )}
              </section>
            )}
          </section>
        )}

        <div className="rh-section-stack">
          {showSourceWorkspace && (
          <div className="rh-workspace-top">
          <section
            className="rh-panel rh-source-section"
            data-reconnect={openedRecoveredResult !== null}
            data-ready={sourceReady}
            aria-labelledby="source-title"
          >
            <div className="rh-section-heading">
              <div>
                <p className="rh-eyebrow">
                  {sourceReady ? ui("1단계 · 원본 확인 완료", "Step 1 · Source verified") : ui("1단계", "Step 1")}
                </p>
                <h3 id="source-title" ref={sourceHeading} tabIndex={-1}>
                  {openedRecoveredResult === null
                    ? sourceReady
                      ? ui("선택한 방송 원본", "Selected broadcast source")
                      : ui("방송 원본을 골라 주세요", "Choose a broadcast source")
                    : candidates.length === 0
                      ? ui("이번 결과는 원본 재연결이 필요하지 않아요", "This result does not require the source file")
                      : ui("미리볼 원래 방송 파일을 다시 골라 주세요", "Reconnect the original broadcast for preview")}
                </h3>
              </div>
              <p className="rh-help">
                {sourceReady && preflight !== null
                  ? `${formatDuration(preflight.metadata.durationMs)} · ${formatBytes(preflight.metadata.sizeBytes)}`
                  : ui("MP4·WebM 권장 · 최대 12시간", "MP4 or WebM · up to 12 hours")}
              </p>
            </div>

            <div className="rh-source-stack">
              <div className="rh-source-card rh-source-card--recommended">
                <label
                  className="rh-drop-zone"
                  htmlFor="source-file"
                  aria-label={sourceFileActionLabel}
                  aria-busy={sourceCheckBusy}
                  aria-disabled={sourceInputLocked}
                  data-dragging={isDragging}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    if (!sourceInputLocked) {
                      setIsDragging(true);
                    }
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleSourceDrop}
                >
                  <div className="rh-drop-zone-copy">
                    <p className="rh-eyebrow">
                      {sourceReady ? ui("분석할 원본", "Analysis source") : ui("추천 · 가장 정확함", "Recommended · most accurate")}
                    </p>
                    <strong>{pendingFileName ?? ui("영상 파일을 여기에 놓아도 돼요", "Drop a video file here")}</strong>
                    <p className="rh-help">
                      {sourceReady
                        ? ui("이 파일의 전체 시간을 기준으로 분석 지도와 클립 후보를 만들어요.", "The complete file is used to build the timeline and clip candidates.")
                        : ui("MP4·WebM 권장 · 최대 12시간 · 선택하면 길이와 분석 가능 여부를 바로 확인해요.", "MP4 or WebM · up to 12 hours · compatibility is checked immediately.")}
                    </p>
                    <span className="btn btn-primary rh-drop-zone-button">
                      {analysisLanguage === "ko" ? sourceFileActionLabel : sourceReady ? "Choose another video" : "Choose video"}
                    </span>
                    <span className="rh-drop-zone-hint">
                      {sourceReady
                        ? ui("파일을 바꾸면 새 원본 기준으로 다시 확인합니다.", "Changing the file starts a new source check.")
                        : ui("또는 영상 파일을 여기로 끌어놓기", "or drag a video file here")}
                    </span>
                  </div>
                </label>
                <input
                  className="rh-hidden-input"
                  id="source-file"
                  type="file"
                  accept="video/*,.mp4,.webm,.mkv,.mov,.m4v"
                  disabled={sourceInputLocked}
                  onChange={handleSourceInput}
                />
              </div>

              {sourceReady && preflight !== null && (
                <dl className="rh-source-facts" aria-label={ui("선택한 원본 정보", "Selected source details")}>
                  <div>
                    <dt>{ui("전체 길이", "Duration")}</dt>
                    <dd>{formatDuration(preflight.metadata.durationMs)}</dd>
                  </div>
                  <div>
                    <dt>{ui("파일 형식", "Format")}</dt>
                    <dd>
                      {preflight.metadata.extension?.replace(/^\./u, "").toUpperCase() ??
                        preflight.metadata.kind.toUpperCase()}
                    </dd>
                  </div>
                  <div>
                    <dt>{ui("파일 크기", "File size")}</dt>
                    <dd>{formatBytes(preflight.metadata.sizeBytes)}</dd>
                  </div>
                </dl>
              )}

              {!sourceReady && (
              <details className="rh-link-details">
                <summary>{ui("영상 파일 없이 YouTube·CHZZK 링크만 있나요?", "Only have a YouTube or CHZZK link?")}</summary>
                <p className="rh-help">
                  {ui("현재 기본판은 링크의 방송 전체를 직접 읽을 수 없어요. 내려받을 권한이 있는 영상 파일을 먼저 준비해 주세요.", "This version cannot read an entire broadcast from a link. Prepare a video file you are authorized to download.")}
                </p>
                <form className="rh-input-row" onSubmit={handleLinkSubmit}>
                  <label className="rh-screen-reader-only" htmlFor="source-url">방송 링크</label>
                  <input
                    id="source-url"
                    type="url"
                    placeholder="https://…"
                    value={sourceUrl}
                    onChange={(event) => setSourceUrl(event.currentTarget.value)}
                  />
                  <button className="btn btn-secondary" type="submit">{ui("확인", "Check")}</button>
                </form>
                {linkNotice !== null && <p className="rh-notice" role="status">{linkNotice}</p>}
              </details>
              )}
            </div>
          </section>

          {!sourceReady && (sourceCheck !== null || sourceError !== null) && (
            <section className="rh-panel rh-source-summary" aria-live="polite" aria-labelledby="source-result-title">
              <div className="rh-section-heading">
                <div>
                  <p className="rh-eyebrow">실제 검사 결과</p>
                  <h3 id="source-result-title">{sourceCheckLabel(sourceCheck)}</h3>
                </div>
                {sourceCheck?.status === "checking" && <span className="rh-spinner" aria-label="확인 중" />}
              </div>
              {preflight !== null && (
                <dl className="rh-summary-grid">
                  <div className="rh-summary-item">
                    <dt>파일</dt>
                    <dd title={preflight.metadata.name}>{preflight.metadata.name}</dd>
                  </div>
                  <div className="rh-summary-item">
                    <dt>길이 · 크기</dt>
                    <dd>{formatDuration(preflight.metadata.durationMs)} · {formatBytes(preflight.metadata.sizeBytes)}</dd>
                  </div>
                  <div className="rh-summary-item">
                    <dt>상태</dt>
                    <dd>
                      {sourceCheck?.status === "completed"
                        ? sourceCheck.resultKind === "blocked"
                          ? "분석 시작 불가"
                          : "AI 분석 준비 완료"
                        : "검사 결과 저장 중"}
                    </dd>
                  </div>
                </dl>
              )}
              {sourceError !== null && <p className="rh-notice" data-tone="danger" role="alert">{sourceError}</p>}
            </section>
          )}

          {openedRecoveredResult === null && !sourceReady && sourceCheck === null && sourceError === null && (
            <section className="rh-panel rh-spec-panel" aria-labelledby="spec-title">
              <p className="rh-eyebrow">{ui("시작하기 전에", "Before you start")}</p>
              <h3 id="spec-title">{ui("이 도구가 하는 일", "What this tool does")}</h3>
              <dl className="rh-spec-list">
                <div>
                  <dt>{ui("넣는 것", "You provide")}</dt>
                  <dd>{ui("방송 원본 파일 하나(MP4·WebM 등). CHZZK 채팅 로그는 선택 사항입니다.", "One broadcast source file (MP4, WebM, etc). A CHZZK chat log is optional.")}</dd>
                </div>
                <div>
                  <dt>{ui("하는 일", "What happens")}</dt>
                  <dd>{ui("AI가 전체 방송을 훑어 반응이 몰린 구간을 먼저 찾고, 사람이 각 후보를 확인해 최종 사용 여부를 정합니다.", "The AI scans the whole broadcast for moments with concentrated reaction, then you review each candidate and decide.")}</dd>
                </div>
                <div>
                  <dt>{ui("받는 것", "You get")}</dt>
                  <dd>{ui("승인한 장면의 시작·끝 시간표(CSV·Markdown·JSON)와, 필요하면 잘라낸 클립 파일.", "A start/end timetable for approved scenes (CSV, Markdown, JSON), and cut clip files if you request them.")}</dd>
                </div>
              </dl>
              <p className="rh-spec-duration">
                {ui("6시간 분량 방송 기준 약 25~40분이 걸립니다.", "For a 6-hour broadcast, expect roughly 25–40 minutes.")}
              </p>
            </section>
          )}

          {sourceReady && preflight !== null && !analysisComplete && !analysisBusy && (
            <section className="rh-panel rh-analysis-launchpad" aria-labelledby="analysis-title">
              <div className="rh-launchpad-heading">
                <div>
                  <p className="rh-eyebrow">{ui("2단계 · 분석 설계", "Step 2 · Analysis setup")}</p>
                  <h3 id="analysis-title" ref={analysisHeading} tabIndex={-1}>{ui("전체 방송 타임라인을 만들 준비가 됐어요", "Ready to build the full broadcast timeline")}</h3>
                  <p className="rh-help">
                    {ui("처음부터 끝까지 여러 위치를 먼저 살피고, 맥락이 생기는 구간을 넓혀 클립 후보로 정리합니다.", "The AI samples across the full broadcast, expands meaningful regions, and organizes multiple clip candidates.")}
                  </p>
                </div>
                <span className="rh-ready-badge">{ui("시작 가능", "Ready")}</span>
              </div>

              <div
                className="rh-source-range-preview"
                role="img"
                aria-label={`분석할 원본 범위 00:00부터 ${formatDuration(preflight.metadata.durationMs)}까지, 30분 단위 눈금`}
              >
                <div className="rh-source-range-title">
                  <span>{ui("분석할 방송 범위", "Broadcast range")}</span>
                  <strong>00:00–{formatDuration(preflight.metadata.durationMs)}</strong>
                </div>
                <div className="rh-source-range-track" aria-hidden="true">
                  <span className="rh-source-range-fill" />
                  {sourceReadyTimelineTicks.map((tick) => (
                    <span
                      className="rh-source-range-tick"
                      data-edge={tick.edge}
                      data-major={tick.showLabel}
                      key={tick.timestampMs}
                      style={{ left: `${tick.positionPercent}%` }}
                    />
                  ))}
                </div>
                <div className="rh-source-range-labels" aria-hidden="true">
                  {sourceReadyTimelineTicks
                    .filter((tick) => tick.showLabel)
                    .map((tick) => (
                      <span
                        data-edge={tick.edge}
                        key={tick.timestampMs}
                        style={{ left: `${tick.positionPercent}%` }}
                      >
                        {formatDuration(tick.timestampMs)}
                      </span>
                    ))}
                </div>
              </div>

              <ol className="rh-analysis-route" aria-label="AI 분석 흐름">
                <li>
                  <span>1</span>
                  <div>
                    <strong>{ui("방송 전체 훑기", "Scan the full broadcast")}</strong>
                    <small>{ui("여러 시각을 고르게 확인", "Sample evenly across time")}</small>
                  </div>
                </li>
                <li>
                  <span>2</span>
                  <div>
                    <strong>{ui("맥락 구간 넓히기", "Expand context")}</strong>
                    <small>{ui("사건 전후의 대사·화면 연결", "Connect dialogue and visuals around events")}</small>
                  </div>
                </li>
                <li>
                  <span>3</span>
                  <div>
                    <strong>{ui("클립 후보 정리", "Organize clip candidates")}</strong>
                    <small>{ui("30초~1분 장면을 여러 개 제안", "Suggest multiple 30–60 second moments")}</small>
                  </div>
                </li>
              </ol>

              <div className="rh-readiness-strip" aria-label="분석에 사용할 신호">
                <div data-tone={preflight.capabilities.preferredRuntimeTier === "signals-only" ? "limited" : "ready"}>
                  <span className="rh-readiness-dot" aria-hidden="true" />
                  <span>화면·오디오</span>
                  <strong>
                    {preflight.capabilities.preferredRuntimeTier === "signals-only"
                      ? "제한 분석"
                      : "준비됨"}
                  </strong>
                </div>
                <div data-tone={chatImport === null ? "optional" : "ready"}>
                  <span className="rh-readiness-dot" aria-hidden="true" />
                  <span>CHZZK 채팅</span>
                  <strong>
                    {chatImport === null
                      ? "선택 사항"
                      : `${chatImport.messages.length.toLocaleString("ko-KR")}개 준비`}
                  </strong>
                </div>
              </div>

              {preflight.capabilities.preferredRuntimeTier === "signals-only" && (
                <p className="rh-notice" data-tone="warning">
                  이 브라우저에서는 일부 오디오 분석을 쓰지 못할 수 있어요. 가능한 화면 신호는 유지하고 빠진 근거를 결과에 표시합니다.
                </p>
              )}

              <div className="rh-launchpad-actions">
                <button
                  className="btn btn-primary rh-primary-action"
                  type="button"
                  disabled={!sourceReady || analysisBusy || analysisComplete || chatImportStatus === "reading"}
                  onClick={() => void runSignalAnalysis()}
                >
                  {chatImportStatus === "reading"
                    ? "채팅 읽는 중…"
                    : ui("AI로 하이라이트 찾기", "Find highlights with AI")}
                </button>
                <p>{ui("분석이 시작되면 위 시간축에 탐색 범위와 주제가 차례로 나타납니다.", "Once analysis starts, explored ranges and topics appear on the timeline.")}</p>
              </div>
            </section>
          )}
          </div>
          )}

          {sourceReady && !analysisComplete && !analysisBusy && (
          <section className="rh-panel rh-chat-panel" aria-labelledby="chat-title">
            <div className="rh-chat-row">
              <div className="rh-chat-copy">
                <p className="rh-eyebrow">선택 사항</p>
                <strong id="chat-title">CHZZK 라이브 채팅도 함께 볼까요?</strong>
                <span>없어도 바로 분석할 수 있어요. 있으면 반응이 몰린 순간을 함께 찾습니다.</span>
              </div>
              <div className="rh-chat-controls">
                <label
                  className="btn btn-secondary rh-file-button"
                  htmlFor="chat-file"
                  aria-disabled={chatInputLocked}
                >
                  {openedRecoveredResult !== null
                    ? "새 분석에서 추가 가능"
                    : analysisBusy
                      ? "AI 분석 중 변경 잠금"
                    : chatFileName === null
                      ? "채팅 파일 고르기"
                      : "다른 채팅 고르기"}
                </label>
                <input
                  className="rh-hidden-input"
                  id="chat-file"
                  type="file"
                  accept=".json,.jsonl,.csv,application/json,text/csv,text/plain"
                  disabled={chatInputLocked}
                  onChange={handleChatInput}
                />
              </div>
            </div>

            {chatImport !== null && (
              <div className="rh-source-summary" aria-live="polite">
                <dl className="rh-summary-grid">
                  <div className="rh-summary-item">
                    <dt>파일</dt>
                    <dd title={chatFileName ?? ""}>{chatFileName}</dd>
                  </div>
                  <div className="rh-summary-item">
                    <dt>읽은 메시지</dt>
                    <dd>{chatImport.messages.length.toLocaleString("ko-KR")}개</dd>
                  </div>
                  <div className="rh-summary-item">
                    <dt>시간 기준</dt>
                    <dd>{chatImport.timestampBasis === "relative" ? "영상 상대 시간" : chatImport.timestampBasis === "rebasedAbsolute" ? "첫 채팅부터 재계산" : "확인 필요"}</dd>
                  </div>
                </dl>
                {firstChatWarning !== null && <p className="rh-notice" data-tone="warning">{firstChatWarning}</p>}
                {chatImport.invalidRowCount > 0 && (
                  <p className="rh-help">형식을 알아보지 못한 {chatImport.invalidRowCount.toLocaleString("ko-KR")}개 행은 건너뛰었어요.</p>
                )}
                <details>
                  <summary>영상과 채팅 시간이 어긋날 때만 조정</summary>
                  <label className="rh-offset-control">
                    채팅 시간 보정
                    <input
                      type="number"
                      step="0.5"
                      value={chatOffsetSeconds}
                      disabled={chatOffsetLocked}
                      aria-describedby={chatOffsetLocked ? "chat-offset-lock-help" : undefined}
                      onChange={(event) => {
                        const nextOffset = Number(event.currentTarget.value);
                        setChatOffsetSeconds(Number.isFinite(nextOffset) ? nextOffset : 0);
                      }}
                    />
                    초
                  </label>
                  {chatOffsetLocked && (
                    <div className="rh-offset-lock" id="chat-offset-lock-help">
                      <p className="rh-help">
                        {analysisBusy
                          ? "AI 분석 중에는 입력이 섞이지 않도록 시간 보정을 잠가요. 먼저 ‘안전하게 취소’를 눌러 주세요."
                          : "완료된 후보를 보호하려고 시간 보정을 잠갔어요. 다시 분석할 때만 아래에서 잠금을 풀 수 있어요."}
                      </p>
                      {!analysisBusy && openedRecoveredResult === null && (
                        <button className="btn btn-secondary" type="button" onClick={prepareChatRetiming}>
                          같은 채팅 시간 다시 맞추기
                        </button>
                      )}
                    </div>
                  )}
                </details>
              </div>
            )}
            {chatImportStatus === "reading" && (
              <p className="rh-notice" role="status">
                채팅 파일을 안전하게 읽고 비식별화하는 중이에요. 끝나면 분석 버튼이 자동으로 열립니다.
              </p>
            )}
            {openedRecoveredResult !== null && (
              <p className="rh-help">
                복원한 결과의 입력은 바꾸지 않아요. 다른 채팅으로 다시 분석하려면 위의 ‘새 영상으로 시작’을 눌러 주세요.
              </p>
            )}
            {chatError !== null && <p className="rh-notice" data-tone="danger" role="alert">{chatError}</p>}
          </section>
          )}

          {analysisError !== null && (
            <div className="rh-engine-note" aria-live="polite">
              <span aria-hidden="true">!</span>
              <div>
                <p role="alert">{analysisError}</p>
              </div>
              {analysisCanBeCancelled && (
                <button className="btn btn-secondary" type="button" onClick={cancelAnalysis}>
                  안전하게 취소
                </button>
              )}
            </div>
          )}

          {selectionResult !== null && (
            <section className="rh-panel rh-review-workspace" aria-labelledby="candidate-title">
              <div className="rh-results-header">
                <div>
                  <p className="rh-eyebrow">
                    {contextualCandidatePublicationReady
                      ? "AI 분석 완료 · 편집자 검토"
                      : "AI 분석 진행 중"}
                  </p>
                  <h3 id="candidate-title" ref={candidateHeading} tabIndex={-1}>
                    {contextualCandidatePublicationReady
                      ? `최종 검토 후보 ${orderedCandidates.length}개`
                      : "방송 전체 맥락을 만들고 있어요"}
                  </h3>
                  <p className="rh-help">
                    {contextualCandidatePublicationReady
                      ? "AI가 전체 방송 맥락과 화면·대사를 종합한 장면만 모았습니다. 이제 짧은 후보만 재생해 결정하면 됩니다."
                      : "분산 탐색으로 방송 곳곳을 먼저 확인한 뒤, 의미가 이어지는 주변을 넓혀 봅니다. 최종 후보는 종합이 끝난 뒤 한 번에 표시합니다."}
                  </p>
                  {selectionResult.audioGapReasonCode !== undefined && selectionResult.audioGapReasonCode !== null && (
                    <p className="rh-notice" data-tone="warning" role="status">
                      {selectionResult.audioGapReasonCode === "NO_AUDIO_TRACK"
                        ? "이 원본에는 읽을 오디오 트랙이 없어 방송 오디오 반응은 분석하지 못했어요."
                        : selectionResult.audioGapReasonCode === "UNSUPPORTED_AUDIO_CODEC" ||
                            selectionResult.audioGapReasonCode === "UNSUPPORTED_CONTAINER"
                          ? "이 브라우저가 원본 오디오 형식을 읽지 못해 채팅과 제한된 화면 탐색 신호로 완료했어요. MP4(H.264/AAC) 또는 WebM으로 바꾸면 더 정확해져요."
                          : "오디오 반응 분석이 끝까지 처리되지 않아, 가능한 채팅과 제한된 화면 탐색 신호로 먼저 마쳤어요. 페이지를 새로고침한 뒤 다시 분석하면 나아질 수 있어요."}
                    </p>
                  )}
                  {selectionResult.outOfRangeChatMessageCount > 0 && (
                    <p className="rh-notice" data-tone="warning">
                      영상 범위 밖 채팅 {selectionResult.outOfRangeChatMessageCount.toLocaleString("ko-KR")}개는 경계에 몰지 않고 제외했어요.
                    </p>
                  )}
                  {selectionResult.skippedChatMessageCount > 0 && (
                    <p className="rh-notice" data-tone="warning" role="status">
                      채팅 분석 기능을 사용할 수 없어 채팅 {selectionResult.skippedChatMessageCount.toLocaleString("ko-KR")}개는 분석하지 못했어요.
                      오디오 반응과 화면 맥락으로 찾은 후보를 보존한 ‘채팅 제외 완료’ 결과입니다.
                    </p>
                  )}
                  {selectionResult.analyzedChatMessageCount === 0 &&
                    selectionResult.skippedChatMessageCount === 0 &&
                    selectionResult.outOfRangeChatMessageCount === 0 && (
                    <p className="rh-help" role="status">
                      이번 실행은 채팅 파일 없이 방송 오디오와 화면 신호만으로 분석했어요.
                    </p>
                  )}
                </div>
                {contextualCandidatePublicationReady && orderedCandidates.length > 0 && (
                  <dl className="rh-review-overview" aria-live="polite">
                    <div>
                      <dt>남은 후보</dt>
                      <dd>{remainingReviewCount}</dd>
                    </div>
                    <div>
                      <dt>사용</dt>
                      <dd>{approvedCount}</dd>
                    </div>
                    <div>
                      <dt>제외</dt>
                      <dd>{rejectedCount}</dd>
                    </div>
                  </dl>
                )}
              </div>

              <section
                className="rh-live-analysis-panel"
                data-state={
                  liveAnalysisStageNumber === 4 && reviewCompleted
                    ? "complete"
                    : "active"
                }
                aria-label="현재 AI 분석 진행 상황"
                aria-live="polite"
              >
                <div className="rh-live-analysis-current">
                  <span className="rh-live-analysis-number" aria-hidden="true">
                    {liveAnalysisStageNumber}
                  </span>
                  <div>
                    <p className="rh-eyebrow">
                      {ui("현재 진행", "Current progress")} · {liveAnalysisStageNumber}/4
                    </p>
                    <strong>{liveAnalysisStageTitle}</strong>
                    <small>{liveAnalysisStageDetail}</small>
                  </div>
                  <span className="rh-live-analysis-mode">
                    {liveAnalysisStageNumber < 4
                      ? ui("자동 진행", "Automatic")
                      : reviewCompleted
                        ? ui("완료", "Complete")
                        : ui(`${reviewedCount}/${orderedCandidates.length} 검토`, `${reviewedCount}/${orderedCandidates.length} reviewed`)}
                  </span>
                </div>
                <progress
                  className="rh-live-analysis-progress"
                  max={1}
                  {...liveAnalysisProgressBarProps}
                  aria-label={ui("현재 분석 단계 진행률", "Current analysis stage progress")}
                />
                <ol className="rh-live-analysis-rail" aria-label={ui("전체 분석 순서", "Analysis workflow")}>
                  {liveAnalysisPhaseSteps.map((step) => (
                    <li key={step.number} data-state={step.state}>
                      <span aria-hidden="true">{step.number}</span>
                      <strong>{step.label}</strong>
                      <small>
                        {step.state === "complete"
                          ? ui("완료", "Complete")
                          : step.state === "active"
                            ? ui("진행 중", "In progress")
                            : step.state === "error"
                              ? ui("확인 필요", "Needs attention")
                              : ui("다음 단계", "Next")}
                      </small>
                    </li>
                  ))}
                </ol>
              </section>

              {(broadcastTranscriptStatus === "failed" ||
                broadcastContextStatus === "failed" ||
                semanticLeadRefinementStatus === "failed") && (
                <div className="rh-notice rh-notice-with-action" data-tone="warning" role="status">
                  <span>
                    {semanticLeadRefinementError ??
                      broadcastContextError ??
                      broadcastTranscriptError ??
                      "방송 전체 맥락 분석을 마치지 못했어요."}
                  </span>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() => {
                      if (semanticLeadRefinementStatus === "failed") {
                        autoSemanticLeadRefinementSourceRef.current = null;
                        setSemanticLeadRefinementStatus("idle");
                        setSemanticLeadRefinementError(null);
                      } else if (broadcastContextStatus === "failed") {
                        autoBroadcastContextSourceRef.current = null;
                        setBroadcastContextStatus("idle");
                        setBroadcastContextError(null);
                      } else {
                        autoBroadcastTranscriptSourceRef.current = null;
                        setBroadcastTranscriptStatus("idle");
                        setBroadcastTranscriptProgress(null);
                        setBroadcastTranscriptError(null);
                      }
                    }}
                  >
                    다시 시도
                  </button>
                </div>
              )}

              {broadcastContextResult !== null && (
                <section className="rh-context-summary" aria-labelledby="broadcast-context-title">
                  <header className="rh-context-summary-heading">
                    <div>
                      <p className="rh-eyebrow">{ui("AI 방송 맥락", "AI broadcast context")}</p>
                      <h4 id="broadcast-context-title">{ui("방송과 진행자 프로필", "Broadcast and host profile")}</h4>
                    </div>
                    <span>{ui("방송 근거 기반", "Grounded in broadcast evidence")}</span>
                  </header>
                  <div className="rh-context-summary-grid">
                    <article className="rh-context-profile-card">
                      <section className="rh-context-narrative-card">
                        <div className="rh-context-card-heading">
                          <strong>{ui("방송 흐름", "Broadcast flow")}</strong>
                          <small>{Array.from(broadcastContextResult.broadcastSummaryKo).length}{ui("자", " chars")}</small>
                        </div>
                        <p className="rh-context-cited-summary">
                          {(broadcastSummaryCitationPresentation?.parts ?? [{
                            text: broadcastContextResult.broadcastSummaryKo,
                            candidateIds: [],
                            emphasized: false,
                          }]).map((part, partIndex) => (
                            <span
                              className="rh-context-cited-summary-part"
                              data-cited={part.emphasized ? "true" : "false"}
                              key={`${partIndex}:${part.text}`}
                            >
                              {part.emphasized ? <strong>{part.text}</strong> : part.text}
                              {part.candidateIds.map((candidateId) => {
                                const candidateIndex = orderedCandidates.findIndex(
                                  ({ id }) => id === candidateId,
                                );
                                const candidate = orderedCandidates[candidateIndex];
                                if (candidate === undefined) return null;
                                return (
                                  <sup key={candidateId}>
                                    <button
                                      type="button"
                                      aria-label={ui(
                                        `후보 ${candidateIndex + 1} 검토 위치로 이동`,
                                        `Open candidate ${candidateIndex + 1}`,
                                      )}
                                      onClick={() => focusCandidateForReview(candidate)}
                                    >
                                      {candidateIndex + 1}
                                    </button>
                                  </sup>
                                );
                              })}
                              {" "}
                            </span>
                          ))}
                        </p>
                      </section>
                      <section className="rh-context-host-card">
                        <div className="rh-context-card-heading">
                          <strong>{ui("주 진행자의 진행 방식", "How the host runs the broadcast")}</strong>
                          <small>{ui("방송 속 행동 근거", "Observed behavior")}</small>
                        </div>
                      {broadcastContextResult.hostStreamerProfile === null ? (
                        <div className="rh-context-host-unavailable">
                          <strong>{ui("이 저장 결과에는 진행 방식 분석이 없어요.", "This saved result has no host-style analysis.")}</strong>
                          <p>{ui("새 분석부터 방송 내용과 겹치지 않게 말투·상호작용·반응 방식만 근거와 함께 기록합니다.", "New analyses describe speaking style, interaction, and reaction patterns separately from the event timeline.")}</p>
                        </div>
                      ) : (
                        <>
                          <div className="rh-context-host-name">
                            {broadcastContextResult.hostStreamerProfile.displayNameKo ?? ui("주 진행 스트리머", "Primary host")}
                          </div>
                          <p>{broadcastContextResult.hostStreamerProfile.profileSummaryKo}</p>
                          <div className="rh-context-host-evidence" aria-label="진행자 이해 근거">
                            {broadcastContextResult.hostStreamerProfile.evidenceKo.map((evidence) => (
                              <span key={evidence}>{evidence}</span>
                            ))}
                          </div>
                          {broadcastContextResult.hostStreamerProfile.uncertaintiesKo.length > 0 && (
                            <p className="rh-context-host-uncertainty">
                              {ui("확인 한계", "Limits")} · {broadcastContextResult.hostStreamerProfile.uncertaintiesKo.join(" · ")}
                            </p>
                          )}
                        </>
                      )}
                      </section>
                    </article>
                  </div>
                  <div className="rh-context-summary-meta">
                    <span>
                      {contextualCandidatePublicationReady
                        ? `최종 검토 후보 ${orderedCandidates.length}개`
                        : "맥락 기반 후보 종합 중"}
                    </span>
                    <span>
                      {broadcastContextTimelinePresentation.topicMetric.label}{" "}
                      {broadcastContextTimelinePresentation.topicMetric.value}
                      {broadcastContextTimelinePresentation.topicMetric.value === "—" ? "" : "개"}
                    </span>
                    <span>
                      {broadcastContextTimelinePresentation.leadMetric.label}{" "}
                      {broadcastContextTimelinePresentation.leadMetric.value}
                      {broadcastContextTimelinePresentation.leadMetric.value === "—" ? "" : "개"}
                    </span>
                    {broadcastContextResult.recurringThemesKo.slice(0, 4).map((themeLabel) => (
                      <span key={themeLabel}>{themeLabel}</span>
                    ))}
                  </div>
                </section>
              )}

              {openedRecoveredResult !== null &&
                sourcePreviewUrl === null &&
                contextualCandidatePublicationReady &&
                candidateReviewFeatureAvailability.hasCandidates && (
                <div className="rh-notice rh-notice-with-action">
                  <span>원본을 연결하면 타임라인 카드에서 바로 재생하고 클립을 받을 수 있어요.</span>
                  <button className="btn btn-secondary" type="button" onClick={focusSourceSection}>
                    원본 연결하러 가기
                  </button>
                </div>
              )}

              {contextualCandidatePublicationReady &&
                candidateReviewFeatureAvailability.hasCandidates && (
              <details className="rh-review-tools">
                <summary>
                  <span>
                    <strong>AI 보강 분석과 후보 순서</strong>
                    <small>재시도·반응 종류·추천 순서는 필요할 때만 펼쳐 보세요.</small>
                  </span>
                  <span>{candidatePassBDetailAnalysisLabel}</span>
                </summary>
                <div className="rh-review-tools-body">
              <div className="rh-phase-panels">
              {candidateReviewFeatureAvailability.showAudioEvent && (
                <section
                  className="rh-passb-panel rh-audio-event-panel"
                  aria-labelledby="audio-event-title"
                >
                  <div className="rh-passb-copy">
                    <p className="rh-eyebrow">자동 페이즈 · 반응 종류</p>
                    <h4 id="audio-event-title">스트리머 반응 종류 확인</h4>
                    <p>웃음·고함·비명·박수·환호 같은 반응을 후보별로 분류합니다.</p>
                  </div>
                  <div className="rh-passb-actions">
                    {!candidateAudioEventBusy && (
                      <button
                        className="btn btn-primary"
                        type="button"
                        disabled={
                          sourceFile === null ||
                          !candidateAudioEventRuntimeAvailable ||
                          selectionResult.audioGapReasonCode === "NO_AUDIO_TRACK" ||
                          candidatePassBBusy
                        }
                        onClick={() => void runCandidateAudioEvent()}
                      >
                        {candidateAudioEventRun === null
                          ? "반응 종류 AI로 확인"
                          : "반응 종류 다시 찾기"}
                      </button>
                    )}
                    {candidateAudioEventBusy && (
                      <button
                        className="btn btn-secondary"
                        type="button"
                        disabled={
                          candidateAudioEventStartPending ||
                          candidateAudioEventRun?.status === "cancelling"
                        }
                        onClick={cancelCandidateAudioEvent}
                      >
                        {candidateAudioEventStartPending
                          ? "실행 준비 중…"
                          : candidateAudioEventRun?.status === "cancelling"
                            ? "멈추는 중…"
                            : "반응 종류 찾기 멈추기"}
                      </button>
                    )}
                    {sourceFile === null && (
                      <button className="btn btn-secondary" type="button" onClick={focusSourceSection}>
                        원본 연결하러 가기
                      </button>
                    )}
                  </div>
                  <div className="rh-passb-status" role="status" aria-live="polite">
                    <strong>{candidateAudioEventStatusText}</strong>
                    {candidateAudioEventRun !== null && (
                      <progress
                        className="rh-analysis-progress"
                        max={1}
                        value={candidateAudioEventProgressRatio}
                        aria-label="후보 반응 종류 찾기 진행률"
                      />
                    )}
                    {candidatePassBBusy && !candidateAudioEventBusy && (
                      <p>대사 단서를 찾는 중이에요. 끝난 뒤 반응 종류 AI를 시작할 수 있어요.</p>
                    )}
                    {selectionResult.audioGapReasonCode === "NO_AUDIO_TRACK" && (
                      <p>이 원본에는 읽을 소리가 없어 반응 종류 AI를 사용할 수 없어요.</p>
                    )}
                    {!candidateAudioEventRuntimeAvailable && (
                      <p>현재 환경에서는 반응 종류 AI를 실행할 수 없어요. 최신 Chrome이나 Edge에서 다시 열어 주세요.</p>
                    )}
                    {candidateAudioEventError !== null && <p role="alert">{candidateAudioEventError}</p>}
                    {candidateAudioEventWorkStarted && (
                      <p>
                        이 결과는 재생 확인을 돕는 임시 단서예요. 후보 점수·순서·구간·검토 상태를
                        바꾸지 않으며, 새로고침하면 사라지고 현재 내보내기 결과에도 포함되지 않아요.
                      </p>
                    )}
                  </div>
                </section>
              )}

              {candidateReviewFeatureAvailability.showPassB && (
                <section className="rh-passb-panel rh-gemini-panel" aria-labelledby="pass-b-title">
                  <div className="rh-passb-copy">
                    <p className="rh-eyebrow">자동 페이즈 · AI 해석</p>
                    <h4 id="pass-b-title">화면·오디오·대사 맥락 정리</h4>
                    <p>AI가 후보마다 사건과 스트리머 반응을 한국어로 설명합니다.</p>
                    <p className="rh-cost-note">
                      현재 전송량 기준 예상 비용 {formatEstimatedUsd(candidateDetailCostEstimate.totalCostUsd)} ·
                      입력 약 {candidateDetailCostEstimate.inputTokens.toLocaleString()}토큰 + 후보별 화면 4장 기준
                    </p>
                  </div>
                  <div className="rh-passb-actions">
                    {!candidatePassBBusy && (
                      <button
                        className="btn btn-primary"
                        type="button"
                        disabled={
                          sourceFile === null ||
                          !candidatePassBRuntimeAvailable ||
                          candidateDetailCandidateIds.length === 0 ||
                          selectionResult.audioGapReasonCode === "NO_AUDIO_TRACK" ||
                          candidateAudioEventBusy
                        }
                        onClick={() => void runCandidatePassB(candidateDetailCandidateIds)}
                      >
                        {candidatePassBRun === null
                          ? `후보 ${Math.min(12, candidateDetailCandidateIds.length)}개 자세히 분석`
                          : `후보 ${Math.min(12, candidateDetailCandidateIds.length)}개 다시 분석`}
                      </button>
                    )}
                    {candidatePassBBusy && (
                      <button
                        className="btn btn-secondary"
                        type="button"
                        disabled={
                          candidatePassBStartPending ||
                          candidatePassBRun?.status === "cancelling"
                        }
                        onClick={cancelCandidatePassB}
                      >
                        {candidatePassBStartPending
                          ? "오디오와 대표 화면 준비 중…"
                          : candidatePassBRun?.status === "cancelling"
                            ? "멈추는 중…"
                            : "AI 분석 멈추기"}
                      </button>
                    )}
                    {sourceFile === null && (
                      <button className="btn btn-secondary" type="button" onClick={focusSourceSection}>
                        원본 연결하러 가기
                      </button>
                    )}
                  </div>
                  <div className="rh-passb-status" role="status" aria-live="polite">
                    <strong>{candidatePassBStatusText}</strong>
                    {candidatePassBRun !== null && (
                      <progress
                        className="rh-analysis-progress"
                        max={1}
                        value={candidatePassBProgressRatio}
                        aria-label="AI 후보 대사와 사건 분석 진행률"
                      />
                    )}
                    {selectionResult.audioGapReasonCode === "NO_AUDIO_TRACK" && (
                      <p>이 원본에는 읽을 소리가 없어 AI 오디오 분석을 사용할 수 없어요.</p>
                    )}
                    {sourceFile !== null && !candidatePassBRuntimeAvailable && (
                      <p>이 브라우저에서는 후보 오디오를 안전하게 준비할 수 없어요. 최신 Chrome이나 Edge에서 다시 열어 주세요.</p>
                    )}
                    {sourceFile === null && (
                      <p>AI 분석을 시작하려면 먼저 같은 원본 영상 파일을 다시 연결해 주세요.</p>
                    )}
                    {!candidatePassBBusy && candidateAudioEventBusy && (
                      <p>반응 종류 확인이 끝나면 AI 분석을 시작할 수 있어요.</p>
                    )}
                    {candidateDetailCandidateIds.length === 0 && candidates.length > 0 && (
                      <p>
                        전체 맥락에서 모두 낮은 우선순위 또는 음악 구간으로 분류되어 추가 유료
                        분석을 생략했어요. 후보는 삭제하지 않았으므로 아래 목록에서 직접 확인할 수
                        있어요.
                      </p>
                    )}
                    {candidatePassBError !== null && <p role="alert">{candidatePassBError}</p>}
                    {candidatePassBWorkStarted && (
                      <p>
                        AI 대사·해석은 재생 확인을 돕는 임시 단서예요. 새로고침하면
                        사라지며, 현재 CSV·Markdown·JSON·복사 결과에는 포함되지 않아요.
                      </p>
                    )}
                  </div>
                </section>
              )}
              </div>

              {candidateReviewFeatureAvailability.rankingCandidateLimitExceeded && (
                <div className="rh-notice" role="status">
                  후보가 {CANDIDATE_RANKING_MAX_CANDIDATES}개보다 많아 전체 순서 자동 재정렬은
                  생략했어요. 후보는 모두 유지되며, 화면·오디오 세부 분석은 우선순위가 높은
                  최대 {CANDIDATE_RANKING_MAX_CANDIDATES}개부터 진행합니다.
                </div>
              )}

              {candidateReviewFeatureAvailability.showRanking && (
                <section
                  className="rh-ranking-panel"
                  aria-labelledby="candidate-ranking-title"
                >
                  <div className="rh-ranking-heading">
                    <div>
                      <p className="rh-eyebrow">AI 검토 도우미 · 여러 후보 우선순위</p>
                      <h4 id="candidate-ranking-title">
                        {candidateRankingProposalView === null
                          ? "어떤 후보부터 볼지 다시 정리할까요?"
                          : candidateRankingProposalDisposition === "stale"
                            ? candidateRankingApplied
                              ? "새 단서가 생겼지만 목록은 그대로 두었어요"
                              : "이 추천은 새 단서보다 오래됐어요"
                            : candidateRankingApplied
                              ? "추천 검토 순서를 적용했어요"
                              : "AI가 후보 순서를 다시 살펴봤어요"}
                      </h4>
                      <p>
                        방송 오디오와 채팅 반응을 중심으로 보고 화면 변화는 문맥으로만 낮게
                        반영해요. 모든 후보를 빠짐없이 끝낸 반응 종류 분석만 오디오 근거를 조금
                        보강하고, AI 대사 문구는 순위 점수에 넣지 않아요.
                      </p>
                    </div>
                    <span className="rh-ranking-count" aria-hidden="true">
                      {candidates.length}
                    </span>
                  </div>

                  <div className="rh-ranking-actions">
                    {candidateRankingApplied ? (
                      <button
                        className="btn btn-secondary"
                        type="button"
                        onClick={undoCandidateRankingOrder}
                      >
                        이전 순서로 되돌리기
                      </button>
                    ) : candidateRankingProposalDisposition === "fresh" ? (
                      <>
                        <button
                          className="btn btn-primary"
                          type="button"
                          disabled={
                            candidateRefinementBusy ||
                            candidateRankingProposal?.changedPositionCount === 0
                          }
                          onClick={applyCandidateRankingProposalForReview}
                        >
                          {candidateRankingProposal?.changedPositionCount === 0
                            ? "이미 추천 순서예요"
                            : "추천 순서 적용"}
                        </button>
                        <button
                          className="btn btn-secondary"
                          type="button"
                          onClick={dismissCandidateRankingProposal}
                        >
                          지금 순서 유지
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn btn-primary"
                        type="button"
                        disabled={
                          candidateRefinementBusy ||
                          candidateRankingFingerprints === null ||
                          !rankingCandidateSetMatches
                        }
                        onClick={createCandidateRankingProposalForReview}
                      >
                        {candidateRefinementBusy
                          ? "자세한 분석이 끝나면 가능"
                          : candidateRankingProposalDisposition === "stale"
                            ? "최신 단서로 다시 정리"
                            : "AI 추천 순서 만들기"}
                      </button>
                    )}
                    {!candidateRankingApplied &&
                      candidateRankingProposalDisposition === "stale" && (
                        <button
                          className="btn btn-secondary"
                          type="button"
                          onClick={dismissCandidateRankingProposal}
                        >
                          이 제안 닫기
                        </button>
                      )}
                  </div>

                  <div
                    className="rh-ranking-status"
                    data-tone={candidateRankingFeedback?.tone ?? "neutral"}
                    role="status"
                    aria-live="polite"
                  >
                    <strong>
                      {candidateRankingProposal === null
                        ? "추천을 만들어도 현재 카드 순서는 바로 바뀌지 않아요."
                        : candidateRankingProposalDisposition === "stale"
                          ? "오래된 제안은 새로 적용할 수 없어요."
                          : candidateRankingApplied
                            ? "현재 카드만 추천 검토 순서로 보이고 있어요."
                            : candidateRankingProposal.changedPositionCount > 0
                              ? `${candidateRankingProposal.changedPositionCount}개 후보의 위치가 달라질 수 있어요.`
                              : "현재 카드 순서가 이미 최신 추천과 같아요."}
                    </strong>
                    {candidateRankingFeedback !== null && (
                      <p>{candidateRankingFeedback.message}</p>
                    )}
                    <p>
                      추천은 검토 차례만 바꿉니다. 승인·제외, 시작·끝, 재생 위치는 후보 ID로
                      그대로 이어지고 다운로드 결과는 편집하기 쉬운 시간순을 유지해요.
                    </p>
                    {candidateRankingApplied &&
                      candidateRankingProposalDisposition === "stale" && (
                        <p>
                          최신 추천을 만들려면 먼저 적용 전 순서로 돌아가 주세요.
                        </p>
                      )}
                    {candidateAudioEventRankingCoverage !== "complete" && (
                      <p>
                        반응 종류 AI가 모든 후보를 빠짐없이 끝내지 않았다면 일부 후보만 유리해지지
                        않도록 그 결과는 이번 순위에 더하지 않아요.
                      </p>
                    )}
                  </div>

                  {candidateRankingProposal !== null &&
                    candidateRankingProposalDisposition === "fresh" && (
                    <details className="rh-ranking-preview">
                      <summary>추천 상위 장면과 순서가 바뀌는 이유 보기</summary>
                      <ol>
                        {candidateRankingPreviewEntries.map((entry) => {
                          const candidate = candidates.find(
                            ({ id }) => id === entry.candidateId,
                          );
                          if (candidate === undefined) {
                            return null;
                          }
                          const transcriptNote = candidateRankingTranscriptNote(entry);
                          const movement =
                            entry.previousOrdinal === entry.proposedOrdinal
                              ? `현재 ${entry.previousOrdinal}번째 유지`
                              : `현재 ${entry.previousOrdinal}번째 → 추천 ${entry.proposedOrdinal}번째`;
                          return (
                            <li key={entry.candidateId}>
                              <div>
                                <strong>{formatDuration(candidate.peakMs)} 부근</strong>
                                <span>{movement}</span>
                              </div>
                              <p>
                                {candidateRankingReasonText(
                                  entry,
                                  candidateAudioEventEvidenceById[entry.candidateId],
                                )}
                              </p>
                              {transcriptNote !== null && <small>{transcriptNote}</small>}
                            </li>
                          );
                        })}
                      </ol>
                      {candidateRankingProposal.entries.length > 5 && (
                        <p className="rh-help">
                          먼저 볼 5개를 보여드렸어요. 적용하면 나머지 후보도 빠짐없이 새 순서로
                          이어집니다.
                        </p>
                      )}
                      <p className="rh-ranking-caution">
                        이 값은 확률이나 정확도가 아니라 하루치 후보끼리 비교한 상대 순서예요.
                        오디오 종류는 스트리머 마이크와 게임·영상 소리를 분리하지 못하므로 직접
                        재생해 확인해 주세요.
                      </p>
                    </details>
                  )}
                  {candidateRankingProposal !== null &&
                    candidateRankingProposalDisposition === "stale" && (
                      <p className="rh-ranking-caution">
                        새 단서가 생겨 이전 추천 이유는 표시하지 않아요. 현재 카드 순서는 자동으로
                        바꾸지 않았습니다.
                      </p>
                    )}
                </section>
              )}
                </div>
              </details>
              )}

              {contextualCandidatePublicationReady && orderedCandidates.length === 0 ? (
                <div className="rh-empty-state" data-reason={emptyResultReason}>
                  {emptyResultReason === "analysis-incomplete" ? (
                    <>
                      <strong>분석이 끝까지 진행되지 못해서 후보를 만들지 못했어요.</strong>
                      방송에 쓸 장면이 없다는 뜻이 아니에요. 근거를 모으는 단계에서 멈췄기
                      때문에 판단 자체를 하지 못했습니다.
                      {finalVerificationGapSummary.length > 0 && (
                        <dl className="rh-verification-gap-list">
                          {finalVerificationGapSummary.map((entry) => (
                            <div key={entry.gap} data-pipeline={isPipelineGap(entry.gap)}>
                              <dt>
                                {entry.label}
                                <span>{entry.count}개</span>
                              </dt>
                              <dd>{entry.detail}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      <div className="rh-empty-state-actions">
                        <button
                          className="btn btn-primary"
                          type="button"
                          onClick={retryWholeContextPhase}
                        >
                          맥락 분석 다시 시도
                        </button>
                        <button
                          className="btn btn-secondary"
                          type="button"
                          disabled={analysisBusy || candidateRefinementBusy}
                          onClick={startFreshAnalysis}
                        >
                          처음부터 다시 분석
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <strong>AI가 확실하다고 볼 수 있는 장면을 찾지 못했어요.</strong>
                      전체 방송 흐름, 후보 대사, 대표 화면 네 장, 대표 썸네일과 멀티모달 판정이
                      모두 맞아떨어진 장면만 최종 목록에 올립니다. 아래에서 직접 확인해 보실 수 있어요.
                      {finalVerificationGapSummary.length > 0 && (
                        <dl className="rh-verification-gap-list">
                          {finalVerificationGapSummary.map((entry) => (
                            <div key={entry.gap} data-pipeline={isPipelineGap(entry.gap)}>
                              <dt>
                                {entry.label}
                                <span>{entry.count}개</span>
                              </dt>
                              <dd>{entry.detail}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      {candidates.length > 0 && (
                        <p className="rh-help">
                          빠른 탐색이 찾아 둔 구간 {candidates.length}개는 그대로 보관돼 있어요.
                        </p>
                      )}
                      <div className="rh-empty-state-actions">
                        <button
                          className="btn btn-secondary"
                          type="button"
                          disabled={analysisBusy || candidateRefinementBusy}
                          onClick={retryWholeContextPhase}
                        >
                          맥락 분석 다시 시도
                        </button>
                        <button
                          className="btn btn-secondary"
                          type="button"
                          disabled={analysisBusy || candidateRefinementBusy}
                          onClick={startFreshAnalysis}
                        >
                          다른 영상으로 분석
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <div
                    className="rh-timeline-review-layout"
                    data-review-ready={contextualCandidatePublicationReady}
                  >
                  {contextualCandidatePublicationReady && (
                    <div className="ex-sur-head">
                      <div className="ex-sur-head-title">
                        <strong>{preflight?.metadata.name ?? "저장된 AI 분석 결과"}</strong>
                        <span>{formatDuration(boundarySourceDurationMs)}</span>
                      </div>
                      <span className="ex-sur-head-chip">
                        후보 {previewCandidateNumber > 0 ? previewCandidateNumber : orderedCandidates.length > 0 ? 1 : 0}/{orderedCandidates.length}
                        {" · 남음 "}
                        {remainingReviewCount}
                      </span>
                    </div>
                  )}
                  {contextualCandidatePublicationReady && orderedCandidates.length > 0 && (
                    <div className="ex-strip" aria-label="방송 전체에서 후보 위치">
                      <div className="ex-strip-rail" aria-hidden="true">
                        <span className="ex-strip-rail-line" />
                        {orderedCandidates.map((candidate, stripIndex) => (
                          <button
                            key={candidate.id}
                            type="button"
                            className="ex-strip-marker"
                            data-state={candidate.reviewState}
                            data-current={candidate.id === focusedCandidateId}
                            style={{
                              left: `${candidateStripPositionPercent(candidate.peakMs, boundarySourceDurationMs)}%`,
                            }}
                            title={`후보 ${stripIndex + 1} · ${formatDuration(candidate.peakMs)}`}
                            onClick={() => focusCandidateForReview(candidate)}
                          />
                        ))}
                      </div>
                      <div className="ex-strip-meta">
                        <button
                          type="button"
                          className="ex-strip-map-toggle"
                          aria-keyshortcuts="M"
                          aria-expanded={mapSheetOpen}
                          onClick={() => setMapSheetOpen((open) => !open)}
                        >
                          ▸ 방송 지도 <kbd>M</kbd>
                        </button>
                        {focusedCandidateId !== null && (
                          <span className="ex-strip-timecode">
                            {formatDuration(
                              candidates.find(({ id }) => id === focusedCandidateId)?.peakMs ?? 0,
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  {contextualCandidatePublicationReady && (
                    <div
                      className="ex-sheet-scrim"
                      data-open={mapSheetOpen}
                      aria-hidden="true"
                      onClick={() => setMapSheetOpen(false)}
                    />
                  )}
                  <section
                    className="rh-candidate-timeline"
                    data-state={
                      contextualCandidatePublicationReady ? "ready" : "exploring"
                    }
                    data-open={mapSheetOpen}
                    aria-labelledby="candidate-timeline-heading"
                  >
                    <div className="rh-candidate-timeline-heading">
                      <div>
                        <p className="rh-eyebrow">
                          {contextualCandidatePublicationReady
                            ? "방송 전체 사건 지도"
                            : "실시간 맥락 탐색 지도"}
                        </p>
                        <h3 id="candidate-timeline-heading">
                          {contextualCandidatePublicationReady
                            ? "오늘 방송에서 먼저 볼 장면"
                            : "방송 곳곳에서 주제를 찾고 있어요"}
                        </h3>
                        {contextualCandidatePublicationReady && (
                          <button
                            type="button"
                            className="ex-map-close"
                            aria-keyshortcuts="Escape"
                            onClick={() => setMapSheetOpen(false)}
                          >
                            지도 닫기
                          </button>
                        )}
                        <p>
                          {contextualCandidatePublicationReady
                            ? "선의 위치는 방송 시각, 흐릿한 높이는 잠재 점수예요. 원과 요약 카드를 누르면 같은 장면을 바로 확인합니다."
                            : "앞에서부터 순서대로 읽지 않고 방송 전역을 분산 탐색합니다. 의미가 잡히면 이웃 구간을 넓혀 보고, 주제가 확인되는 순서대로 지도에 나타납니다."}
                        </p>
                      </div>
                      <div className="rh-timeline-stats" aria-label="사건 지도 요약">
                        <span>
                          <strong>
                            {contextualCandidatePublicationReady
                              ? orderedCandidates.length
                              : broadcastTranscriptExplorationCells.length > 0
                                ? `${broadcastTranscriptExploredCount}/${broadcastTranscriptExplorationCells.length}`
                                : broadcastTranscriptStatus === "completed" ||
                                    broadcastTranscriptStatus === "completedWithGaps"
                                  ? "완료"
                                  : "…"}
                          </strong>
                          {contextualCandidatePublicationReady ? "검토 후보" : "탐색 구간"}
                        </span>
                        <span>
                          <strong>{visibleTimelineSemanticChapters.length}</strong>
                          드러난 주제
                        </span>
                        <span>
                          <strong>
                            {contextualCandidatePublicationReady
                              ? visibleTimelineDiscoveredLeads.length
                              : "…"}
                          </strong>
                          {contextualCandidatePublicationReady ? "의미 단서" : "후보 종합"}
                        </span>
                      </div>
                    </div>
                    {broadcastContextTimelinePresentation.noticeText !== null && (
                      <p
                        className="rh-timeline-context-status"
                        data-state={broadcastContextTimelinePresentation.state}
                        data-tone={broadcastContextTimelinePresentation.noticeTone}
                        role="status"
                      >
                        {broadcastContextTimelinePresentation.noticeText}
                      </p>
                    )}
                    {!contextualCandidatePublicationReady &&
                      liveExplorationFindings.length > 0 && (
                        <section
                          className="rh-live-exploration-findings"
                          aria-label="실시간으로 확인된 방송 구간 단서"
                        >
                          <header>
                            <strong>지금까지 드러난 구간 단서</strong>
                            <span>최종 주제가 아니라 저장이 끝난 실제 대사·상황 근거예요.</span>
                          </header>
                          <div>
                            {liveExplorationFindings.map(({ cell, summaryKo }) => (
                              <button
                                type="button"
                                key={cell.chunkId}
                                data-selected={
                                  timelineInspectionTarget?.kind === "exploration" &&
                                  timelineInspectionTarget.id === cell.chunkId
                                }
                                onClick={() =>
                                  setTimelineInspectionTarget({
                                    kind: "exploration",
                                    id: cell.chunkId,
                                  })
                                }
                              >
                                <time>{formatDuration(cell.sourceStartMs)}</time>
                                <span>{summaryKo}</span>
                              </button>
                            ))}
                          </div>
                        </section>
                      )}
                    <div className="rh-timeline-track" aria-label="방송 안 후보 위치">
                      <div className="rh-timeline-row-labels" aria-hidden="true">
                        <span data-row="score">잠재 신호</span>
                        <span data-row="candidate">
                          {contextualCandidatePublicationReady ? "검토 후보" : "후보 대기"}
                        </span>
                        <span data-row="exploration">맥락 탐색</span>
                        <span data-row="topic">주제 흐름</span>
                        <span data-row="lead">의미 단서</span>
                      </div>
                      <div className="rh-timeline-ticks" aria-hidden="true">
                        {timelineAxisTicks.map((tickMs) => (
                          <span
                            className="rh-timeline-tick"
                            key={tickMs}
                            style={{ left: `${(tickMs / boundarySourceDurationMs) * 100}%` }}
                          >
                            <small>{formatDuration(tickMs)}</small>
                          </span>
                        ))}
                      </div>
                      {timelineContextCoverageGaps.length > 0 && (
                        <div className="rh-timeline-context-gaps" aria-hidden="true">
                          {timelineContextCoverageGaps.map((gap) => {
                            const left =
                              boundarySourceDurationMs > 0
                                ? Math.min(
                                    100,
                                    Math.max(
                                      0,
                                      (gap.startMs / boundarySourceDurationMs) * 100,
                                    ),
                                  )
                                : 0;
                            const width =
                              boundarySourceDurationMs > 0
                                ? Math.max(
                                    0.25,
                                    Math.min(
                                      100 - left,
                                      ((gap.endMs - gap.startMs) /
                                        boundarySourceDurationMs) *
                                        100,
                                    ),
                                  )
                                : 0;
                            return (
                              <span
                                key={`${gap.startMs}-${gap.endMs}`}
                                style={{ left: `${left}%`, width: `${width}%` }}
                              />
                            );
                          })}
                        </div>
                      )}
                      <div className="rh-timeline-score-rail" aria-label="후보 점수로 보는 신호 가능성">
                        {candidateTimelineScorePoints.map((point) => {
                          const position =
                            boundarySourceDurationMs > 0
                              ? Math.min(100, Math.max(0, (((point.startMs + point.endMs) / 2) / boundarySourceDurationMs) * 100))
                              : 0;
                          const width =
                            boundarySourceDurationMs > 0
                              ? Math.max(0.35, Math.min(18, ((point.endMs - point.startMs) / boundarySourceDurationMs) * 100))
                              : 0.35;
                          return (
                            <button
                              type="button"
                              className="rh-timeline-score-glow"
                              key={`${point.signalKind}-${point.id}`}
                              data-kind={point.signalKind}
                              data-selected={
                                timelineInspectionTarget?.kind === "signal" &&
                                timelineInspectionTarget.id ===
                                  `${point.signalKind}:${point.id}`
                              }
                              style={{
                                left: `${position}%`,
                                width: `${width}%`,
                                height: `${8 + point.strength * 30}px`,
                              }}
                              title={`${timelineSignalLabel(point.signalKind)} 상대값 ${Math.round(point.strength * 100)} · ${formatDuration(point.peakMs)}`}
                              aria-label={`${timelineSignalLabel(point.signalKind)} 잠재 신호, 상대값 ${Math.round(point.strength * 100)}, ${formatDuration(point.peakMs)} 부근. 자세히 보기`}
                              aria-pressed={
                                timelineInspectionTarget?.kind === "signal" &&
                                timelineInspectionTarget.id ===
                                  `${point.signalKind}:${point.id}`
                              }
                              onClick={() =>
                                setTimelineInspectionTarget({
                                  kind: "signal",
                                  id: `${point.signalKind}:${point.id}`,
                                })
                              }
                            >
                              <span aria-hidden="true">
                                {Math.round(point.strength * 100)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <div
                        className="rh-timeline-exploration-rail"
                        data-empty={broadcastTranscriptExplorationCells.length === 0}
                        aria-label="분산 맥락 탐색 위치"
                      >
                        {broadcastTranscriptExplorationCells.map((cell) => {
                          const left =
                            boundarySourceDurationMs > 0
                              ? Math.min(
                                  100,
                                  Math.max(
                                    0,
                                    (cell.sourceStartMs /
                                      boundarySourceDurationMs) *
                                      100,
                                  ),
                                )
                              : 0;
                          const width =
                            boundarySourceDurationMs > 0
                              ? Math.max(
                                  0.2,
                                  Math.min(
                                    100 - left,
                                    ((cell.sourceEndMs - cell.sourceStartMs) /
                                      boundarySourceDurationMs) *
                                      100,
                                  ),
                                )
                              : 0;
                          return (
                            <button
                              type="button"
                              className="rh-timeline-exploration-cell"
                              key={cell.chunkId}
                              data-state={cell.state}
                              data-kind={cell.kind}
                              data-selected={
                                timelineInspectionTarget?.kind === "exploration" &&
                                timelineInspectionTarget.id === cell.chunkId
                              }
                              style={{ left: `${left}%`, width: `${width}%` }}
                              title={`${formatDuration(cell.sourceStartMs)}–${formatDuration(cell.sourceEndMs)} · ${
                                cell.state === "active"
                                  ? cell.stage === "decoding"
                                    ? "오디오 변환 중"
                                    : "대사와 맥락 인식 중"
                                  : cell.state === "complete"
                                    ? "탐색 완료"
                                    : cell.state === "gap"
                                      ? "근거 공백"
                                      : "탐색 대기"
                              }`}
                              aria-label={`${formatDuration(cell.sourceStartMs)}부터 ${formatDuration(cell.sourceEndMs)}까지 맥락 탐색 ${cell.state === "complete" ? "완료" : cell.state === "active" ? "진행 중" : cell.state === "gap" ? "근거 공백" : "대기"}. 구간 분석 보기`}
                              aria-pressed={
                                timelineInspectionTarget?.kind === "exploration" &&
                                timelineInspectionTarget.id === cell.chunkId
                              }
                              onClick={() =>
                                setTimelineInspectionTarget({
                                  kind: "exploration",
                                  id: cell.chunkId,
                                })
                              }
                            />
                          );
                        })}
                        {broadcastTranscriptExplorationCells.length === 0 &&
                          !contextualCandidatePublicationReady && (
                            <span className="rh-timeline-empty-rail">
                              자막·저장 기록과 분석 계획을 확인하는 중
                            </span>
                          )}
                      </div>
                      <div className="rh-timeline-candidate-lane" aria-hidden="true" />
                      <div
                        className="rh-timeline-semantic-rail"
                        data-empty={visibleTimelineSemanticChapters.length === 0}
                        aria-label="타임라인 주요 구간"
                      >
                          {visibleTimelineSemanticChapters.map((chapter) => {
                            const family = semanticChapterFamily(chapter.kind);
                            const left =
                              boundarySourceDurationMs > 0
                                ? Math.min(100, Math.max(0, (chapter.startMs / boundarySourceDurationMs) * 100))
                                : 0;
                            const width =
                              boundarySourceDurationMs > 0
                                ? Math.max(0.35, Math.min(100 - left, ((chapter.endMs - chapter.startMs) / boundarySourceDurationMs) * 100))
                                : 0;
                            return (
                              <button
                                type="button"
                                key={chapter.semanticChapterId}
                                className="rh-timeline-semantic-chapter"
                                data-kind={chapter.kind}
                                data-family={family}
                                data-salience={chapter.salience}
                                data-selected={
                                  timelineInspectionTarget?.kind === "chapter" &&
                                  timelineInspectionTarget.id === chapter.semanticChapterId
                                }
                                style={{ left: `${left}%`, width: `${width}%` }}
                                title={`${formatDuration(chapter.startMs)}–${formatDuration(chapter.endMs)} · ${chapter.summaryKo}`}
                                aria-label={`${chapter.titleKo}, ${semanticChapterFamilyLabel(family)}, ${formatDuration(chapter.startMs)}부터 ${formatDuration(chapter.endMs)}까지 자세히 보기`}
                                aria-pressed={
                                  timelineInspectionTarget?.kind === "chapter" &&
                                  timelineInspectionTarget.id === chapter.semanticChapterId
                                }
                                onClick={() =>
                                  setTimelineInspectionTarget({
                                    kind: "chapter",
                                    id: chapter.semanticChapterId,
                                  })
                                }
                              >
                                <span className="rh-timeline-semantic-title">{chapter.titleKo}</span>
                              </button>
                            );
                          })}
                          {visibleTimelineSemanticChapters.length === 0 && (
                            <span className="rh-timeline-empty-rail">
                              {broadcastContextStatus === "completed"
                                ? "찾은 주제 지도를 펼치는 중"
                                : "분산 탐색에서 주제가 확인되면 여기에 나타납니다"}
                            </span>
                          )}
                        </div>
                      <div
                        className="rh-timeline-lead-rail"
                        data-empty={visibleTimelineDiscoveredLeads.length === 0}
                        aria-label="전체 맥락에서 발견한 의미 후보 범위"
                      >
                          {visibleTimelineDiscoveredLeads.map((lead, index) => {
                            const left =
                              boundarySourceDurationMs > 0
                                ? Math.min(100, Math.max(0, (lead.startMs / boundarySourceDurationMs) * 100))
                                : 0;
                            const width =
                              boundarySourceDurationMs > 0
                                ? Math.max(0.45, Math.min(100 - left, ((lead.endMs - lead.startMs) / boundarySourceDurationMs) * 100))
                                : 0;
                            return (
                              <button
                                type="button"
                                key={lead.leadId}
                                className="rh-timeline-semantic-lead"
                                data-category={lead.category}
                                data-selected={
                                  timelineInspectionTarget?.kind === "lead" &&
                                  timelineInspectionTarget.id === lead.leadId
                                }
                                style={{ left: `${left}%`, width: `${width}%` }}
                                title={`의미 후보 ${index + 1} · ${lead.eventSummaryKo}`}
                                aria-label={`의미 단서 ${index + 1}, ${semanticLeadCategoryLabel(lead.category)}, ${formatDuration(lead.startMs)}부터 ${formatDuration(lead.endMs)}까지 자세히 보기`}
                                aria-pressed={
                                  timelineInspectionTarget?.kind === "lead" &&
                                  timelineInspectionTarget.id === lead.leadId
                                }
                                onClick={() =>
                                  setTimelineInspectionTarget({
                                    kind: "lead",
                                    id: lead.leadId,
                                  })
                                }
                              >
                                <span>{index + 1}</span>
                              </button>
                            );
                          })}
                          {visibleTimelineDiscoveredLeads.length === 0 && (
                            <span className="rh-timeline-empty-rail">
                              {timelineTopicRevealComplete
                                ? broadcastContextTimelinePresentation.leadEmptyText
                                : "주제 지도가 완성된 뒤 의미 단서를 연결합니다"}
                            </span>
                          )}
                        </div>
                      {contextualCandidatePublicationReady &&
                        orderedCandidates.map((candidate, index) => {
                        const position =
                          boundarySourceDurationMs > 0
                            ? Math.min(100, Math.max(0, (candidate.peakMs / boundarySourceDurationMs) * 100))
                            : 0;
                        return (
                          <button
                            className="rh-timeline-marker"
                            key={candidate.id}
                            type="button"
                            style={{
                              left: `${position}%`,
                              top: `${27 + (timelineMarkerLaneById[candidate.id] ?? 0) * 30}px`,
                            }}
                            data-selected={candidate.id === focusedCandidateId}
                            data-review-state={candidate.reviewState}
                            data-origin={candidate.evidence.semantic === undefined ? "signal" : "semantic"}
                            data-ai-projection={candidateAiProjectionById[candidate.id] ?? "insufficient-evidence"}
                            aria-label={`후보 ${index + 1}, ${formatDuration(candidate.peakMs)} 위치를 검토창에 준비`}
                            onClick={() => focusCandidateForReview(candidate)}
                          >
                            <span aria-hidden="true">{index + 1}</span>
                          </button>
                        );
                      })}
                      {timelinePlayheadMs !== null && boundarySourceDurationMs > 0 && (
                        <span
                          className="rh-timeline-playhead"
                          style={{
                            left: `${Math.min(100, Math.max(0, (timelinePlayheadMs / boundarySourceDurationMs) * 100))}%`,
                          }}
                          aria-hidden="true"
                        />
                      )}
                    </div>
                    <div className="rh-timeline-axis" aria-hidden="true">
                      <span>00:00</span>
                      <span>{formatDuration(boundarySourceDurationMs)}</span>
                    </div>
                    <section className="rh-timeline-inspector" aria-live="polite">
                      {inspectedTimelineChapter !== null ? (
                        <>
                          <header>
                            <div>
                              <span
                                className="rh-timeline-inspector-kind"
                                data-family={semanticChapterFamily(inspectedTimelineChapter.kind)}
                              >
                                {semanticChapterFamilyLabel(
                                  semanticChapterFamily(inspectedTimelineChapter.kind),
                                )}
                              </span>
                              <strong>{inspectedTimelineChapter.titleKo}</strong>
                            </div>
                            <time>
                              {formatDuration(inspectedTimelineChapter.startMs)}–
                              {formatDuration(inspectedTimelineChapter.endMs)}
                            </time>
                          </header>
                          <p>{inspectedTimelineChapter.summaryKo}</p>
                          <dl>
                            <div>
                              <dt>중요도</dt>
                              <dd>{inspectedTimelineChapter.salience === "primary" ? "핵심 흐름" : "보조 흐름"}</dd>
                            </div>
                            <div>
                              <dt>연결 후보</dt>
                              <dd>
                                {inspectedTimelineChapter.relatedCandidateIds.length === 0
                                  ? "직접 연결 없음"
                                  : inspectedTimelineChapter.relatedCandidateIds
                                      .map((candidateId) => {
                                        const index = orderedCandidates.findIndex(({ id }) => id === candidateId);
                                        return index < 0 ? candidateId : `#${index + 1}`;
                                      })
                                      .join(" · ")}
                              </dd>
                            </div>
                            <div>
                              <dt>확인 한계</dt>
                              <dd>
                                {inspectedTimelineChapter.uncertaintiesKo.length === 0
                                  ? "별도 불확실성 없음"
                                  : inspectedTimelineChapter.uncertaintiesKo.join(" · ")}
                              </dd>
                            </div>
                          </dl>
                        </>
                      ) : inspectedTimelineLead !== null ? (
                        <>
                          <header>
                            <div>
                              <span
                                className="rh-timeline-inspector-kind"
                                data-category={inspectedTimelineLead.category}
                              >
                                {semanticLeadCategoryLabel(inspectedTimelineLead.category)}
                              </span>
                              <strong>{inspectedTimelineLead.eventSummaryKo}</strong>
                            </div>
                            <time>
                              {formatDuration(inspectedTimelineLead.startMs)}–
                              {formatDuration(inspectedTimelineLead.endMs)}
                            </time>
                          </header>
                          <p>{inspectedTimelineLead.whyThisMomentKo}</p>
                          <dl>
                            <div>
                              <dt>근거 단서</dt>
                              <dd>{inspectedTimelineLead.evidenceCueKo}</dd>
                            </div>
                            <div>
                              <dt>AI 확신</dt>
                              <dd>{Math.round(inspectedTimelineLead.confidence * 100)}%</dd>
                            </div>
                            <div>
                              <dt>확인 한계</dt>
                              <dd>
                                {inspectedTimelineLead.uncertaintiesKo.length === 0
                                  ? "별도 불확실성 없음"
                                  : inspectedTimelineLead.uncertaintiesKo.join(" · ")}
                              </dd>
                            </div>
                          </dl>
                        </>
                      ) : inspectedTimelineExploration !== null ? (
                        <>
                          <header>
                            <div>
                              <span className="rh-timeline-inspector-kind" data-family="exploration">
                                탐색 단서
                              </span>
                              <strong>
                                {inspectedTimelineExploration.state === "complete"
                                  ? "이 구간의 대사·상황 근거를 확보했어요"
                                  : inspectedTimelineExploration.state === "active"
                                    ? "이 구간을 지금 분석하고 있어요"
                                    : inspectedTimelineExploration.state === "gap"
                                      ? "이 구간의 근거를 확보하지 못했어요"
                                      : "이 구간은 탐색 대기 중이에요"}
                              </strong>
                            </div>
                            <time>
                              {formatDuration(inspectedTimelineExploration.sourceStartMs)}–
                              {formatDuration(inspectedTimelineExploration.sourceEndMs)}
                            </time>
                          </header>
                          {inspectedTimelineExplorationChapters.length > 0 ? (
                            <div className="rh-timeline-transcript-evidence">
                              {inspectedTimelineExplorationChapters.map((chapter) => (
                                <p key={chapter.chapterId}>{chapter.summaryKo}</p>
                              ))}
                            </div>
                          ) : (
                            <p>
                              {inspectedTimelineExploration.state === "gap"
                                ? "전사 또는 화면 근거가 없어 사건이 없다고 판단할 수는 없습니다."
                                : "분석 결과가 저장되면 실제 대사 요약이 이곳에 나타납니다."}
                            </p>
                          )}
                          <dl>
                            <div>
                              <dt>자료 상태</dt>
                              <dd>{inspectedTimelineExploration.state}</dd>
                            </div>
                            <div>
                              <dt>저장 근거</dt>
                              <dd>{inspectedTimelineExplorationChapters.length}개 chapter</dd>
                            </div>
                            <div>
                              <dt>판정 단계</dt>
                              <dd>최종 주제 확정 전 탐색 근거</dd>
                            </div>
                          </dl>
                        </>
                      ) : inspectedTimelineSignal !== null ? (
                        <>
                          <header>
                            <div>
                              <span
                                className="rh-timeline-inspector-kind"
                                data-signal={inspectedTimelineSignal.signalKind}
                              >
                                잠재 신호
                              </span>
                              <strong>{timelineSignalLabel(inspectedTimelineSignal.signalKind)}</strong>
                            </div>
                            <time>{formatDuration(inspectedTimelineSignal.peakMs)} 부근</time>
                          </header>
                          <p>
                            빠른 탐색에서 같은 종류의 신호 중 상대적으로
                            {` ${Math.round(inspectedTimelineSignal.strength * 100)}점`} 높이로 나타난
                            구간입니다. 클립 확률이나 AI 승인 점수가 아니며, 전체 맥락과 실제 사건을
                            확인하기 위한 탐색 힌트입니다.
                          </p>
                          <dl>
                            <div>
                              <dt>신호 종류</dt>
                              <dd>{timelineSignalLabel(inspectedTimelineSignal.signalKind)}</dd>
                            </div>
                            <div>
                              <dt>상대 높이</dt>
                              <dd>{Math.round(inspectedTimelineSignal.strength * 100)} / 100</dd>
                            </div>
                            <div>
                              <dt>관찰 범위</dt>
                              <dd>
                                {formatDuration(inspectedTimelineSignal.startMs)}–
                                {formatDuration(inspectedTimelineSignal.endMs)}
                              </dd>
                            </div>
                          </dl>
                        </>
                      ) : (
                        <div className="rh-timeline-inspector-empty">
                          <strong>잠재 신호·탐색 셀·주제 띠·의미 단서를 누르면 근거가 열립니다.</strong>
                          <span>탐색 중에는 저장이 끝난 구간의 실제 대사 단서를 먼저 확인할 수 있어요.</span>
                        </div>
                      )}
                    </section>
                    <p className="rh-timeline-score-hint">
                      {!contextualCandidatePublicationReady
                        ? "잠재 신호는 빠른 탐색의 방송 내부 상대값일 뿐 아직 클립 후보가 아닙니다. 막대나 탐색 셀을 눌러 근거를 확인하고, 전체 맥락 뒤 최종 후보를 공개합니다."
                        : selectionResult.analyzedChatMessageCount > 0
                        ? "흐릿한 막대는 오디오·채팅·화면 신호의 상대 점수예요. 번호가 없어도 막대가 있는 구간은 먼저 확인할 잠재 후보입니다."
                        : "흐릿한 막대는 오디오·화면 신호의 상대 점수예요. 번호가 없어도 막대가 있는 구간은 먼저 확인할 잠재 후보입니다."}
                    </p>
                    <div className="rh-timeline-legend" aria-label="타임라인 범례">
                      {contextualCandidatePublicationReady && (
                        <span data-legend="candidate">숫자 원 · 최종 검토 후보</span>
                      )}
                      <span data-legend="exploration">짧은 셀 · 분산 맥락 탐색</span>
                      <span data-legend="event-reaction">파랑 · 주요 사건·반응</span>
                      <span data-legend="achievement-payoff">초록 · 성취·회수</span>
                      <span data-legend="flow-transition">보라 · 흐름·전환</span>
                      <span data-legend="general-context">회색 · 일반 맥락</span>
                      <span data-legend="lead">마름모 · 전체 맥락 의미 후보</span>
                      <span data-legend="score">높이 막대 · 종류별 상대 신호(확률 아님)</span>
                      {timelineContextCoverageGaps.length > 0 && (
                        <span data-legend="gap">빗금 · AI 근거가 없는 구간</span>
                      )}
                    </div>
                    {contextualCandidatePublicationReady && (
                    <ol className="rh-timeline-cards" aria-label="시간순 클립 후보 요약">
                      {orderedCandidates.map((candidate, index) => {
                        const frames = candidateTimelineFramesById[candidate.id] ?? [];
                        const relativePeakMs = candidate.peakMs - candidate.startMs;
                        const frame = [...frames].sort(
                          (left, right) =>
                            Math.abs(left.timestampMs - relativePeakMs) -
                            Math.abs(right.timestampMs - relativePeakMs),
                        )[0];
                        const insight = candidateGeminiInsightById[candidate.id];
                        const narrative = buildHighlightNarrative(candidate);
                        const oneLineSummary =
                          insight?.eventSummaryKo?.trim() || narrative.title;
                        return (
                          <li className="rh-timeline-card" key={candidate.id}>
                            <button
                              type="button"
                              className="rh-timeline-card-button"
                              data-selected={candidate.id === focusedCandidateId}
                              data-review-state={candidate.reviewState}
                              onClick={() => focusCandidateForReview(candidate)}
                              aria-label={`후보 ${index + 1} ${formatDuration(candidate.peakMs)} 위치를 검토창에 준비`}
                            >
                              <span className="rh-timeline-card-media">
                                {frame === undefined ? (
                                  <span className="rh-timeline-card-placeholder">캡처 준비 중</span>
                                ) : (
                                  <img
                                    src={`data:${frame.mimeType};base64,${frame.dataBase64}`}
                                    alt={`후보 ${index + 1} 대표 화면`}
                                  />
                                )}
                                <span className="rh-timeline-card-time">
                                  {formatDuration(candidate.peakMs)}
                                </span>
                              </span>
                              <span className="rh-timeline-card-copy">
                                <strong>
                                  #{index + 1} · {candidate.reviewState === "approved" ? "사용" : candidate.reviewState === "rejected" ? "제외" : "검토 전"}
                                </strong>
                                <small>
                                  {candidate.evidence.semantic === undefined
                                    ? "빠른 탐색"
                                    : "맥락 의미 후보"}
                                </small>
                                <span>{oneLineSummary}</span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                    )}
                  </section>
                  {contextualCandidatePublicationReady && (
                  <section
                    className="rh-review-rail"
                    aria-label="선택한 후보 영상과 편집 판단"
                  >
                  <div className="rh-review-editor">
                    <nav className="rh-candidate-navigation" aria-label="후보 이동">
                      <button
                        className="btn btn-secondary"
                        type="button"
                        disabled={previousFocusedCandidate === null}
                        onClick={() => {
                          if (previousFocusedCandidate !== null) {
                            focusCandidateForReview(previousFocusedCandidate);
                          }
                        }}
                      >
                        이전 후보
                      </button>
                      <span>{previewCandidateNumber} / {orderedCandidates.length}</span>
                      <button
                        className="btn btn-secondary"
                        type="button"
                        disabled={nextFocusedCandidate === null}
                        onClick={() => {
                          if (nextFocusedCandidate !== null) {
                            focusCandidateForReview(nextFocusedCandidate);
                          }
                        }}
                      >
                        다음 후보
                      </button>
                    </nav>
                    <aside className="rh-preview-panel" aria-label="선택한 후보 미리보기">
                      <div className="rh-preview-heading">
                        <div>
                          <p className="rh-eyebrow">선택한 후보 재생</p>
                          <strong>
                            {previewCandidateNumber > 0
                              ? `후보 ${previewCandidateNumber} / ${orderedCandidates.length}`
                              : "타임라인에서 후보를 골라 주세요"}
                          </strong>
                        </div>
                        {focusedCandidateId !== null && (
                          <span className="rh-preview-state">
                            {candidates.find(({ id }) => id === focusedCandidateId)?.reviewState === "approved"
                              ? "사용"
                              : candidates.find(({ id }) => id === focusedCandidateId)?.reviewState === "rejected"
                                ? "제외"
                                : "검토 전"}
                          </span>
                        )}
                      </div>
                      {sourcePreviewUrl !== null ? (
                      <div
                        className="rh-preview-media"
                        data-ready={
                          focusedCandidateId !== null &&
                          previewPreparedCandidateId === focusedCandidateId
                        }
                      >
                        <video
                          ref={previewVideo}
                          className="rh-preview-video"
                          controls
                          playsInline
                          preload="metadata"
                          src={sourcePreviewUrl}
                          onPlay={(event) => {
                            if (
                              previewRequestedCandidateIdRef.current === null ||
                              previewPreparedCandidateIdRef.current !==
                                previewRequestedCandidateIdRef.current
                            ) {
                              event.currentTarget.pause();
                            }
                          }}
                          onTimeUpdate={(event) => {
                            const activeCandidate = candidates.find(({ id }) => id === focusedCandidateId);
                            const activeRange =
                              activeCandidate === undefined
                                ? null
                                : effectiveCandidateRange(
                                    activeCandidate,
                                    boundaryRevisions[activeCandidate.id],
                                  );
                            if (
                              activeRange !== null &&
                              event.currentTarget.currentTime * 1_000 >= activeRange.endMs
                            ) {
                              event.currentTarget.pause();
                            }
                          }}
                        >
                          이 브라우저는 영상 미리보기를 지원하지 않아요.
                        </video>
                        {focusedCandidateId !== null &&
                          previewPreparedCandidateId !== focusedCandidateId && (
                            <div className="rh-preview-preparing" role="status">
                              <span aria-hidden="true" />
                              <strong>검토 화면 준비 중</strong>
                              <small>소리를 재생하지 않고 후보 시작점에 맞추고 있어요.</small>
                            </div>
                          )}
                      </div>
                      ) : (
                        <div className="rh-preview-unavailable">
                          <strong>원본을 연결하면 여기서 바로 재생할 수 있어요.</strong>
                          <p>AI 설명과 시간표 검토는 지금도 가능합니다.</p>
                          <button className="btn btn-primary" type="button" onClick={focusSourceSection}>
                            원본 다시 연결
                          </button>
                        </div>
                      )}
                      <p className="rh-preview-help">
                        후보를 누르면 이 창에 일시정지 상태로 준비합니다. 준비 완료 뒤 재생을 눌러 확인하세요.
                      </p>
                    </aside>
                  </div>
                  <div className="rh-candidate-column">
                  <div
                    className="rh-candidate-list"
                    role="list"
                    aria-label="현재 검토 중인 클립 후보"
                  >
                  {orderedCandidates.map((candidate, index) => {
                    if (candidate.id !== focusedCandidateId) {
                      return null;
                    }
                    const candidatePassBEvidenceFromMap =
                      candidatePassBEvidenceById[candidate.id];
                    const candidatePassBEvidence =
                      candidatePassBEvidenceFromMap?.candidateId === candidate.id
                        ? candidatePassBEvidenceFromMap
                        : undefined;
                    const candidateGeminiInsight =
                      candidateGeminiInsightById[candidate.id];
                    const candidateContext =
                      candidatePassBContextById[candidate.id]!;
                    const narrative = buildCandidatePassBPresentation(
                      candidate.id,
                      buildHighlightNarrative(candidate),
                      candidatePassBEvidence,
                    );
                    const candidatePassBOutcome = candidatePassBRun?.candidateOutcomes.find(
                      ({ candidateId }) => candidateId === candidate.id,
                    );
                    const candidatePassBRunStoppedBeforeOutcome =
                      candidatePassBRun !== null &&
                      ["cancelled", "failed"].includes(candidatePassBRun.status) &&
                      candidatePassBOutcome?.status === "pending";
                    const candidatePassBStatusLabel =
                      candidatePassBRunStoppedBeforeOutcome
                        ? candidatePassBEvidence === undefined
                          ? candidatePassBRun?.status === "cancelled"
                            ? "완전 검증 멈춤 · 최종 후보 제외"
                            : "완전 검증 실패 · 최종 후보 제외"
                          : `${narrative.passBStatusLabel} · 기존 단서 유지`
                        : candidatePassBOutcome?.status === "failed"
                        ? candidatePassBOutcome.reasonCode ===
                          "visual_evidence_incomplete"
                          ? "대표 화면 4장 미완성 · AI 해석 안 함"
                          : candidatePassBEvidence === undefined
                            ? "완전 검증 건너뜀 · 최종 후보 제외"
                            : `${narrative.passBStatusLabel} · 재확인 실패, 기존 단서 유지`
                        : candidatePassBOutcome?.status === "pending" && candidatePassBBusy
                          ? candidatePassBEvidence === undefined
                            ? candidatePassBRun?.status === "transcribing" &&
                              candidatePassBRun.activeCandidateId === candidate.id
                              ? "대사 확인 중"
                              : "대사 확인 대기"
                            : candidatePassBRun?.status === "transcribing" &&
                                candidatePassBRun.activeCandidateId === candidate.id
                              ? `${narrative.passBStatusLabel} · 재확인 중, 기존 단서 유지`
                              : `${narrative.passBStatusLabel} · 재확인 대기, 기존 단서 유지`
                          : candidatePassBOutcome?.status === "noClearSpeech" &&
                              candidatePassBEvidence !== undefined &&
                              candidatePassBEvidence.status !== "fast-pass-fallback"
                            ? `${narrative.passBStatusLabel} · 이번 재확인 불분명, 기존 단서 유지`
                            : narrative.passBStatusLabel;
                    const candidateAudioEventEvidenceFromMap =
                      candidateAudioEventEvidenceById[candidate.id];
                    const candidateAudioEventEvidence =
                      candidateAudioEventEvidenceFromMap?.candidateId === candidate.id &&
                      candidateAudioEventEvidenceFromMap.sourceStartMs ===
                        candidate.startMs &&
                      candidateAudioEventEvidenceFromMap.sourceEndMs ===
                        candidate.endMs &&
                      candidateAudioEventEvidenceFromMap.reactionPeakMs ===
                        candidate.peakMs
                        ? candidateAudioEventEvidenceFromMap
                        : undefined;
                    const audioEventPresentation =
                      buildCandidateAudioEventPresentation(
                        candidate.id,
                        candidateAudioEventEvidence,
                      );
                    const candidateAudioEventOutcome =
                      candidateAudioEventRun?.candidateOutcomes.find(
                        ({ candidateId }) => candidateId === candidate.id,
                      );
                    const candidateAudioEventRunStoppedBeforeOutcome =
                      candidateAudioEventRun !== null &&
                      ["cancelled", "failed"].includes(
                        candidateAudioEventRun.status,
                      ) &&
                      (candidateAudioEventOutcome?.status === "pending" ||
                        candidateAudioEventOutcome?.status === "classifying");
                    const candidateAudioEventStatusLabel =
                      candidateAudioEventRunStoppedBeforeOutcome
                        ? candidateAudioEventEvidence === undefined
                          ? candidateAudioEventRun?.status === "cancelled"
                            ? "반응 종류 확인 멈춤 · 후보 유지"
                            : "반응 종류 확인 실패 · 후보 유지"
                          : `${audioEventPresentation.statusLabel} · 기존 단서 유지`
                        : candidateAudioEventOutcome?.status === "pending" &&
                      candidateAudioEventBusy
                        ? candidateAudioEventEvidence === undefined
                          ? "반응 종류 확인 대기"
                          : "반응 종류 재확인 대기 · 기존 단서 유지"
                        : candidateAudioEventOutcome?.status === "classifying"
                          ? candidateAudioEventEvidence === undefined
                            ? "반응 종류 확인 중"
                            : "반응 종류 재확인 중 · 기존 단서 유지"
                          : candidateAudioEventOutcome?.status === "failed"
                            ? candidateAudioEventEvidence === undefined
                              ? candidateAudioEventGapStatusLabel(
                                  candidateAudioEventOutcome.reasonCode,
                                )
                              : `${audioEventPresentation.statusLabel} · 기존 단서 유지`
                            : candidateAudioEventOutcome?.status === "noClear" &&
                                candidateAudioEventEvidence?.status === "detected"
                              ? `${audioEventPresentation.statusLabel} · 이번 재확인 불분명, 기존 단서 유지`
                            : audioEventPresentation.statusLabel;
                    const candidateAudioEventBadgeStatus =
                      candidateAudioEventEvidence?.status === "detected"
                        ? "detected"
                        : candidateAudioEventRunStoppedBeforeOutcome
                          ? "failed"
                        : candidateAudioEventOutcome?.status ?? "idle";
                    const boundaryRevision = boundaryRevisions[candidate.id] ?? null;
                    const effectiveRange = effectiveCandidateRange(
                      candidate,
                      boundaryRevision,
                    );
                    const evidenceExplanationProjection =
                      buildCandidateEvidenceExplanationWithFallback({
                        candidate,
                        effectiveRange,
                        passBEvidence: candidatePassBEvidenceFromMap,
                        audioEventEvidence: candidateAudioEventEvidenceFromMap,
                      });
                    const evidenceExplanation =
                      evidenceExplanationProjection.explanation;
                    const evidenceReplayTarget =
                      resolveCandidateEvidenceReplayTarget(
                        evidenceExplanation.primaryReplayFocus,
                        evidenceExplanationProjection.explanationRange,
                        candidate.peakMs,
                      );
                    const rangeAdjusted = candidateRangeWasAdjusted(boundaryRevision);
                    const boundaryTouched = (boundaryRevision?.revision ?? 0) > 0;
                    const approvedAfterEdit =
                      candidate.reviewState === "approved" &&
                      candidate.approvedBoundaryRevision !== null &&
                      (boundaryRevision?.revision ?? 0) > candidate.approvedBoundaryRevision;
                    const aiProjection = candidateAiProjectionById[candidate.id];
                    return (
                    <article
                      className="rh-candidate-card rh-candidate-card--signal"
                      data-selected="true"
                      data-review-state={candidate.reviewState}
                      data-ai-projection={aiProjection}
                      role="listitem"
                      aria-labelledby={candidateElementId("candidate-title", candidate.id)}
                      key={candidate.id}
                    >
                      <div className="rh-candidate-number" aria-hidden="true">#{index + 1}</div>
                      <div className="rh-candidate-main">
                        <div className="rh-candidate-meta">
                          <strong>{formatDuration(effectiveRange.startMs)}–{formatDuration(effectiveRange.endMs)}</strong>
                          <span className="rh-review-badge" data-state={candidate.reviewState}>
                            {candidate.reviewState === "approved" ? "사용하기로 함" : candidate.reviewState === "rejected" ? "제외함" : "검토 전"}
                          </span>
                          {aiProjection !== undefined && (
                            <span
                              className="rh-context-projection-badge"
                              data-disposition={aiProjection}
                            >
                              {aiProjection === "recommended"
                                ? "AI 추천"
                                : aiProjection === "needs-review"
                                  ? "AI 추가 확인"
                                  : aiProjection === "deprioritized"
                                    ? "AI 낮은 우선순위"
                                    : "AI 근거 부족"}
                            </span>
                          )}
                        </div>
                        <div className="rh-inline-actions rh-candidate-decision-bar">
                          <button
                            className="btn btn-secondary"
                            type="button"
                            aria-label={`후보 ${index + 1} 구간 바로 보기`}
                            aria-keyshortcuts="Space"
                            disabled={sourcePreviewUrl === null}
                            onClick={() => playCandidate(candidate)}
                          >
                            {sourcePreviewUrl === null ? "원본 연결 후 재생" : "이 구간 재생"}
                          </button>
                          <button
                            className="btn btn-secondary"
                            type="button"
                            aria-label={`후보 ${index + 1} 클립 파일 다운로드`}
                            disabled={
                              sourceFile === null ||
                              clipBatchStatus === "rendering" ||
                              clipDownloadStatusById[candidate.id] === "rendering"
                            }
                            onClick={() => downloadCandidateClip(candidate)}
                          >
                            {clipDownloadStatusById[candidate.id] === "rendering"
                              ? `클립 만드는 중 ${Math.round((clipDownloadProgressById[candidate.id] ?? 0) * 100)}%`
                              : clipDownloadStatusById[candidate.id] === "completed"
                                ? "클립 다시 다운로드"
                                : "이 구간 클립 다운로드"}
                          </button>
                          <button
                            className="btn btn-primary"
                            type="button"
                            aria-label={
                              candidate.reviewState === "approved"
                                ? `후보 ${index + 1} 승인 취소`
                                : `후보 ${index + 1} 사용하기`
                            }
                            aria-keyshortcuts="A"
                            onClick={() =>
                              reviewCandidateAndAdvance(
                                candidate,
                                candidate.reviewState === "approved" ? "unreviewed" : "approved",
                              )
                            }
                          >
                            {candidate.reviewState === "approved" ? "승인 취소" : "사용할게요"}
                          </button>
                          <button
                            className="btn btn-secondary"
                            type="button"
                            aria-label={
                              candidate.reviewState === "rejected"
                                ? `후보 ${index + 1} 다시 검토`
                                : `후보 ${index + 1} 제외`
                            }
                            aria-keyshortcuts="R"
                            onClick={() =>
                              reviewCandidateAndAdvance(
                                candidate,
                                candidate.reviewState === "rejected" ? "unreviewed" : "rejected",
                              )
                            }
                          >
                            {candidate.reviewState === "rejected" ? "다시 검토" : "빼기"}
                          </button>
                          <button
                            className="rh-shortcut-hint"
                            type="button"
                            aria-label="검토 단축키 안내 열기"
                            aria-keyshortcuts="?"
                            aria-expanded={shortcutHelpOpen}
                            onClick={() => setShortcutHelpOpen(true)}
                          >
                            단축키 <kbd>?</kbd>
                          </button>
                        </div>
                        <h4
                          className="rh-candidate-title"
                          id={candidateElementId("candidate-title", candidate.id)}
                        >
                          후보 {index + 1} · {evidenceExplanation.headline}
                        </h4>
                        <div
                          className="ex-seg"
                          role="tablist"
                          aria-label={`후보 ${index + 1} 상세 정보 탭`}
                        >
                          <button
                            type="button"
                            role="tab"
                            id={candidateElementId("dossier-tab-summary", candidate.id)}
                            aria-selected={dossierTab === "summary"}
                            aria-keyshortcuts="1"
                            className={dossierTab === "summary" ? "on" : undefined}
                            onClick={() => setDossierTab("summary")}
                          >
                            요약
                          </button>
                          <button
                            type="button"
                            role="tab"
                            id={candidateElementId("dossier-tab-clues", candidate.id)}
                            aria-selected={dossierTab === "clues"}
                            aria-keyshortcuts="2"
                            className={dossierTab === "clues" ? "on" : undefined}
                            onClick={() => setDossierTab("clues")}
                          >
                            단서
                          </button>
                          <button
                            type="button"
                            role="tab"
                            id={candidateElementId("dossier-tab-context", candidate.id)}
                            aria-selected={dossierTab === "context"}
                            aria-keyshortcuts="3"
                            className={dossierTab === "context" ? "on" : undefined}
                            onClick={() => setDossierTab("context")}
                          >
                            맥락
                          </button>
                          <span className="ex-seg-keys">
                            <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> · <kbd>D</kbd> 순환
                          </span>
                        </div>
                        {dossierTab === "summary" && (
                          <div
                            className="ex-tabpane"
                            data-pane="summary"
                            role="tabpanel"
                            aria-labelledby={candidateElementId("dossier-tab-summary", candidate.id)}
                          >
                            <p className="rh-candidate-reason">
                              <strong>먼저 볼 이유</strong>
                              {evidenceExplanation.whyWorthReviewing.text}
                            </p>
                            <p className="rh-candidate-reference-transcript">
                              <strong>확인한 대사</strong>
                              {candidateContext.transcriptKo}
                            </p>
                            <p className="rh-candidate-verify-note">
                              AI 단서는 참고용이에요. 재생해서 직접 확인한 뒤 판단해 주세요.
                            </p>
                          </div>
                        )}
                        {dossierTab === "context" && (
                          <section
                            className="ex-tabpane rh-candidate-context-chain"
                            data-pane="context"
                            role="tabpanel"
                            aria-labelledby={candidateElementId("dossier-tab-context", candidate.id)}
                          >
                            <header>
                              <div>
                                <strong>전체 방송 안에서 이 장면</strong>
                                <span>맥락·대사·화면 4장·대표 썸네일 검증 완료</span>
                              </div>
                              <span>{candidateContext.topicContextKo}</span>
                            </header>
                            <p className="rh-candidate-broadcast-flow">
                              <strong>전체 방송 흐름</strong>
                              {candidateContext.broadcastSummaryKo}
                            </p>
                            <div className="rh-candidate-context-sequence">
                              <article>
                                <span>직전 흐름</span>
                                <p>{candidateContext.beforeContextKo}</p>
                              </article>
                              <article data-current="true">
                                <span>검증된 후보 상황</span>
                                <p>
                                  {candidateGeminiInsight?.eventSummaryKo ??
                                    candidateContext.contextVerdictKo}
                                </p>
                              </article>
                              <article>
                                <span>직후 흐름</span>
                                <p>{candidateContext.afterContextKo}</p>
                              </article>
                            </div>
                          </section>
                        )}
                        {dossierTab === "clues" && (
                        <div
                          className="ex-tabpane"
                          data-pane="clues"
                          role="tabpanel"
                          aria-labelledby={candidateElementId("dossier-tab-clues", candidate.id)}
                        >
                          {(narrative.basis === "visual-exploration" ||
                            candidatePassBEvidence !== undefined ||
                            candidatePassBOutcome !== undefined ||
                            candidateAudioEventEvidence !== undefined ||
                            candidateAudioEventOutcome !== undefined ||
                            boundaryTouched ||
                            approvedAfterEdit) && (
                            <div className="ex-tabpane-badges">
                              {narrative.basis === "visual-exploration" && (
                                <span className="rh-interpretation-badge" data-basis={narrative.basis}>
                                  {narrative.basisLabel}
                                </span>
                              )}
                              {(candidatePassBEvidence !== undefined ||
                                candidatePassBOutcome !== undefined) && (
                                <span
                                  className="rh-passb-badge"
                                  data-status={candidatePassBOutcome?.status ?? "clueFound"}
                                >
                                  {candidatePassBStatusLabel}
                                </span>
                              )}
                              {(candidateAudioEventEvidence !== undefined ||
                                candidateAudioEventOutcome !== undefined) && (
                                <span
                                  className="rh-audio-event-badge"
                                  data-status={candidateAudioEventBadgeStatus}
                                >
                                  {candidateAudioEventStatusLabel}
                                </span>
                              )}
                              {boundaryTouched && (
                                <span className="rh-boundary-badge">
                                  {boundaryRevision?.provenance === "userResetToAi"
                                    ? "AI 제안 다시 적용"
                                    : "시작·끝 직접 조정"}
                                </span>
                              )}
                              {approvedAfterEdit && (
                                <span className="rh-boundary-badge" data-tone="warning">
                                  승인 유지 · 수정 구간 반영
                                </span>
                              )}
                            </div>
                          )}
                          {candidateGeminiInsight !== undefined && (
                            <div
                              className="rh-gemini-quick-summary"
                              aria-label={`후보 ${index + 1}의 AI 화면·오디오 요약`}
                            >
                              <div>
                              <strong>AI가 화면·오디오에서 해석한 사건 단서</strong>
                              </div>
                              <p>{candidateGeminiInsight.eventSummaryKo}</p>
                              <p className="rh-identified-participant-line">
                                <strong>등장인물</strong>
                                {candidateGeminiInsight.participantSummaryKo ??
                                  ((candidateGeminiInsight.identifiedParticipants?.length ?? 0) > 0
                                    ? candidateGeminiInsight.identifiedParticipants
                                        ?.map((participant) =>
                                          canonicalCandidatePassBCastDisplayName(
                                            sourceCastRosterId,
                                            participant.displayName,
                                          ),
                                        )
                                        .join(" · ")
                                    : "이 저장 결과에는 등장인물 상태가 기록되지 않았습니다.")}
                              </p>
                              <p>
                                <strong>클립으로 먼저 볼 이유</strong>
                                {candidateGeminiInsight.whyGoodClipKo}
                              </p>
                              <small>
                                대표 화면과 혼합 오디오를 본 AI 해석이에요. 출연자 이름은 화면 표시나 실제 호명이 확인된 경우에만 적어요.
                              </small>
                            </div>
                          )}
                          {boundaryTouched && (
                            <p className="rh-evidence-boundary-note">
                              아래 내용은 AI가 처음 후보를 찾을 때 본 단서예요. 다듬은 구간에 모두
                              들어 있는지는 재생해 확인해 주세요.
                            </p>
                          )}
                          {evidenceExplanationProjection.fallbackReason !== null && (
                            <p className="rh-evidence-boundary-note" role="status">
                              추가 단서의 연결을 확인할 수 없어 이 카드에는 안전한 빠른 분석
                              근거만 보여 드려요. 다른 후보와 편집 결과는 그대로 유지됩니다.
                            </p>
                          )}
                          <dl className="rh-narrative-grid">
                            <div>
                              <dt>사건 단서</dt>
                              <dd>{evidenceExplanation.eventClue.text}</dd>
                            </div>
                            <div>
                              <dt>반응 단서</dt>
                              <dd>{evidenceExplanation.reactionClue.text}</dd>
                            </div>
                            <div>
                              <dt>아직 확인되지 않은 점</dt>
                              <dd>
                                {evidenceExplanation.unknowns
                                  .map(candidateEvidenceUnknownLabel)
                                  .join(" · ")}
                              </dd>
                            </div>
                          </dl>
                          {candidateGeminiInsight !== undefined && (
                            <section
                              className="rh-gemini-insight"
                              aria-label={`후보 ${index + 1}의 AI 화면·오디오 해석`}
                            >
                              <div className="rh-gemini-insight-heading">
                                <strong>AI 화면·오디오 해석</strong>
                              </div>
                              <p>
                                후보의 대표 화면과 혼합 오디오를 함께 본 모델 해석이에요.
                              </p>
                              <dl>
                                <div>
                                  <dt>들린 사건 단서</dt>
                                  <dd>{candidateGeminiInsight.eventSummaryKo || "화면과 오디오만으로 사건을 구체적으로 나누기 어려워요."}</dd>
                                </div>
                                <div>
                                  <dt>들린 반응 단서</dt>
                                  <dd>{candidateGeminiInsight.reactionSummaryKo || "반응의 주체와 종류를 화면·오디오만으로 확인하기 어려워요."}</dd>
                                </div>
                                <div>
                                  <dt>클립으로 검토할 이유</dt>
                                  <dd>{candidateGeminiInsight.whyGoodClipKo || "아래 대사 위치와 반응 정점을 직접 재생해 판단해 주세요."}</dd>
                                </div>
                              </dl>
                              <div className="rh-identified-participants">
                                  <strong>
                                    {candidateGeminiInsight.participantPresence === "identified"
                                      ? "확인 가능한 출연자 이름"
                                      : candidateGeminiInsight.participantPresence === "present-unidentified"
                                        ? "화면에는 인물이 있지만 이름은 확인되지 않음"
                                        : candidateGeminiInsight.participantPresence === "none-present"
                                          ? "대표 화면에 등장인물 없음"
                                          : "등장인물 확인 상태"}
                                  </strong>
                                  <p>
                                    {candidateGeminiInsight.participantSummaryKo ??
                                      "이전 버전의 저장 결과라 등장인물 상태가 별도로 남아 있지 않습니다."}
                                  </p>
                                  {(candidateGeminiInsight.identifiedParticipants?.length ?? 0) > 0 && (
                                  <ul>
                                    {candidateGeminiInsight.identifiedParticipants?.map((participant) => {
                                      const participantDisplayName =
                                        canonicalCandidatePassBCastDisplayName(
                                          sourceCastRosterId,
                                          participant.displayName,
                                        );
                                      return (
                                      <li key={`${participantDisplayName}-${participant.evidenceBasis}`}>
                                        <span>{participantDisplayName}</span>
                                        <small>
                                          {participant.evidenceBasis === "on-screen-name"
                                            ? "화면 이름"
                                            : participant.evidenceBasis === "spoken-name"
                                              ? "실제 호명"
                                              : "방송 출연진 기준"}
                                          {` · ${Math.round(participant.confidence * 100)}% · 후보 +${formatDuration(participant.relativeTimestampMs)}`}
                                          {(participant.observedFrameIndices?.length ?? 0) > 0
                                            ? ` · 화면 ${participant.observedFrameIndices
                                                ?.map((frameIndex) => frameIndex + 1)
                                                .join("·")}`
                                            : ""}
                                        </small>
                                        <p>{participant.evidenceKo}</p>
                                      </li>
                                      );
                                    })}
                                  </ul>
                                  )}
                                </div>
                              {candidateGeminiInsight.uncertaintiesKo.length > 0 && (
                                <div className="rh-gemini-uncertainties">
                                  <strong>AI도 확실히 알 수 없었던 점</strong>
                                  <ul>
                                    {candidateGeminiInsight.uncertaintiesKo.map((uncertainty, uncertaintyIndex) => (
                                      <li key={`${uncertaintyIndex}-${uncertainty}`}>{uncertainty}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </section>
                          )}
                          <p className="rh-primary-replay-focus">
                            <strong>
                              {evidenceExplanation.primaryReplayFocus.insideEffectiveRange
                                ? "AI가 먼저 확인하라고 짚은 위치"
                                : "AI가 처음 찾은 위치 · 현재 구간 밖"}
                            </strong>
                            {evidenceExplanation.primaryReplayFocus.label} · {formatDuration(evidenceExplanation.primaryReplayFocus.startMs)}
                            {!evidenceExplanation.primaryReplayFocus.insideEffectiveRange && (
                              <> · 아래 버튼은 {evidenceReplayTarget.label}에서 시작해요.</>
                            )}
                          </p>
                          <button
                            className="btn btn-secondary rh-evidence-replay"
                            type="button"
                            aria-label={`후보 ${index + 1}, ${formatDuration(evidenceReplayTarget.startMs)}부터 ${evidenceReplayTarget.label}`}
                            disabled={sourcePreviewUrl === null}
                            onClick={() =>
                              playCandidateCue(
                                candidate,
                                evidenceReplayTarget.startMs,
                              )
                            }
                          >
                            {sourcePreviewUrl === null
                              ? "원본 연결 후 확인 위치 보기"
                              : evidenceReplayTarget.basis === "primary-evidence-focus"
                                ? "AI가 짚은 위치 보기"
                                : evidenceReplayTarget.basis === "effective-reaction-peak"
                                  ? "현재 구간의 반응 정점 보기"
                                  : "현재 구간 처음부터 보기"}
                          </button>
                          <details className="rh-observed-evidence">
                            <summary>AI가 실제로 본 신호 더 보기</summary>
                            <ul>
                              {evidenceExplanation.observedStatements.map((statement) => (
                                <li key={`${statement.kind}-${statement.text}`}>{statement.text}</li>
                              ))}
                            </ul>
                          </details>
                          {audioEventPresentation.cues.length > 0 && (
                            <div
                              className="rh-audio-event-cues"
                              aria-label="시간 위치가 있는 오디오 반응 종류 AI 단서"
                            >
                              <strong>눌러서 소리의 주체와 반응 맥락을 확인할 위치</strong>
                              <ul>
                                {audioEventPresentation.cues.map((cue) => {
                                  const cueInsideCurrentRange =
                                    cue.sourceStartMs >= effectiveRange.startMs &&
                                    cue.sourceStartMs < effectiveRange.endMs;
                                  const cueDisabled =
                                    sourcePreviewUrl === null || !cueInsideCurrentRange;
                                  return (
                                    <li key={`${cue.kind}-${cue.sourceStartMs}-${cue.sourceEndMs}`}>
                                      <button
                                        className="rh-audio-event-cue"
                                        type="button"
                                        disabled={cueDisabled}
                                        aria-label={`${formatDuration(cue.sourceStartMs)}부터 ${formatDuration(cue.sourceEndMs)}까지, 혼합 오디오에서 ${cue.kindLabel} ${cue.strengthLabel}${cueInsideCurrentRange ? " 재생해서 확인" : ", 현재 조정한 구간 밖"}`}
                                        onClick={() =>
                                          playCandidateCue(
                                            candidate,
                                            cue.sourceStartMs,
                                          )
                                        }
                                      >
                                        <span>{cue.kindLabel} · {cue.strengthLabel}</span>
                                        <time>
                                          {formatDuration(cue.sourceStartMs)}–{formatDuration(cue.sourceEndMs)}
                                        </time>
                                        <small>혼합 오디오 단서</small>
                                      </button>
                                      {!cueInsideCurrentRange && (
                                        <small className="rh-transcript-cue-note">
                                          현재 조정한 클립 구간 밖이라 재생하지 않아요.
                                        </small>
                                      )}
                                    </li>
                                  );
                                })}
                              </ul>
                              {sourcePreviewUrl === null && (
                                <p className="rh-help">
                                  원본을 다시 연결하면 이 반응 위치로 바로 이동할 수 있어요.
                                </p>
                              )}
                            </div>
                          )}
                          {narrative.cues.length > 0 && (
                            <div className="rh-transcript-cues" aria-label="시간 위치가 있는 AI 한국어 대사 추정">
                              <strong>눌러서 바로 확인할 AI 한국어 대사 위치</strong>
                              <ul>
                                {narrative.cues.map((cue) => {
                                  const cueInsideCurrentRange =
                                    cue.absoluteStartMs >= effectiveRange.startMs &&
                                    cue.absoluteStartMs < effectiveRange.endMs;
                                  const cueDisabled =
                                    sourcePreviewUrl === null || !cueInsideCurrentRange;
                                  return (
                                    <li key={`${cue.phase}-${cue.absoluteStartMs}`}>
                                      <button
                                        className="rh-transcript-cue"
                                        type="button"
                                        disabled={cueDisabled}
                                        aria-label={`${formatDuration(cue.absoluteStartMs)} ${cue.phaseLabel}, AI 한국어 대사 추정 “${cue.text}”${cueInsideCurrentRange ? " 재생" : ", 현재 조정한 구간 밖"}`}
                                        onClick={() =>
                                          playCandidateCue(
                                            candidate,
                                            cue.absoluteStartMs,
                                          )
                                        }
                                      >
                                        <span>{cue.phaseLabel}</span>
                                        <time>{formatDuration(cue.absoluteStartMs)}</time>
                                        <q>{cue.text}</q>
                                      </button>
                                      {!cueInsideCurrentRange && (
                                        <small className="rh-transcript-cue-note">
                                          현재 조정한 클립 구간 밖이라 재생하지 않아요.
                                        </small>
                                      )}
                                    </li>
                                  );
                                })}
                              </ul>
                              {sourcePreviewUrl === null && (
                                <p className="rh-help">원본을 다시 연결하면 이 대사 위치로 바로 이동할 수 있어요.</p>
                              )}
                            </div>
                          )}
                          <div className="rh-evidence-list" aria-label="선택 근거">
                          {candidate.evidence.audio !== undefined && (
                            <>
                              <span className="rh-evidence" data-signal="audio">
                                {candidate.evidence.audio.eventKind === "dialogue-issue-signal"
                                  ? "대사 변화 신호"
                                  : candidate.evidence.audio.eventKind === "sustained-vocal-reaction"
                                  ? "이어지는 음성형 반응"
                                  : "짧고 큰 오디오 반응"}
                              </span>
                              {candidate.evidence.audio.rmsLiftRatio !== undefined && (
                                <span className="rh-evidence" data-signal="audio">
                                  평소 음량의 {candidate.evidence.audio.rmsLiftRatio.toFixed(1)}배
                                </span>
                              )}
                              <span className="rh-evidence" data-signal="audio">
                                오디오 내 상위 {Math.max(1, Math.round((1 - candidate.evidence.audio.rankPercentile) * 100))}%
                              </span>
                            </>
                          )}
                          {candidate.evidence.visual !== undefined && (
                            <>
                              <span className="rh-evidence" data-signal="visual">
                                화면 맥락 변화 {(candidate.evidence.visual.sceneChangeStrength ?? 0).toFixed(2)}
                              </span>
                              <span className="rh-evidence" data-signal="visual">
                                영상 내 상위 {Math.max(1, Math.round((1 - candidate.evidence.visual.rankPercentile) * 100))}%
                              </span>
                            </>
                          )}
                          {candidate.evidence.chat !== undefined && (
                            <>
                              <span className="rh-evidence" data-signal="chat">채팅 {candidate.evidence.chat.messageCount}개</span>
                              <span className="rh-evidence" data-signal="chat">서로 다른 작성자 표기 {candidate.evidence.chat.uniqueAuthorCount}개</span>
                              <span className="rh-evidence" data-signal="chat">평소의 {candidate.evidence.chat.burstRatio.toFixed(1)}배</span>
                              {candidate.evidence.chat.reactionMessageCount > 0 && (
                                <span className="rh-evidence" data-signal="chat">반응 표현 {candidate.evidence.chat.reactionMessageCount}개</span>
                              )}
                            </>
                          )}
                          {candidate.evidence.semantic !== undefined && (
                            <>
                              <span className="rh-evidence" data-signal="semantic">
                                방송 전체 맥락
                              </span>
                              <span className="rh-evidence" data-signal="semantic">
                                의미 확신도 {Math.round(candidate.evidence.semantic.confidence * 100)}%
                              </span>
                              <span className="rh-evidence" data-signal="semantic">
                                {candidate.evidence.semantic.evidenceCueKo}
                              </span>
                            </>
                          )}
                          </div>
                        </div>
                        )}
                        <details className="rh-boundary-editor">
                          <summary
                            id={candidateElementId(
                              "candidate-boundary-summary",
                              candidate.id,
                            )}
                            aria-label={`후보 ${index + 1} 시작·끝 다듬기`}
                          >
                            시작·끝 다듬기
                          </summary>
                          <div className="rh-boundary-editor-body">
                            <div className="rh-boundary-range-summary">
                              <span>
                                현재 사용할 구간
                                <strong>
                                  {formatDuration(effectiveRange.startMs)}–{formatDuration(effectiveRange.endMs)}
                                </strong>
                              </span>
                              <span>
                                AI 제안
                                <strong>
                                  {formatDuration(candidate.startMs)}–{formatDuration(candidate.endMs)}
                                </strong>
                              </span>
                            </div>
                            <p className="rh-help">
                              이 후보만 바뀌며 AI가 처음 고른 구간은 그대로 보관돼요. 클립은 30초~1분 안에서 반응 정점을 포함합니다.
                            </p>
                            <div className="rh-boundary-control-grid">
                              <fieldset>
                                <legend>시작 위치</legend>
                                <div className="rh-boundary-buttons">
                                  <button
                                    className="btn btn-secondary"
                                    type="button"
                                    aria-label={`후보 ${index + 1} 시작을 5초 앞으로`}
                                    onClick={() => nudgeCandidateBoundary(candidate, "SHIFT_START", -5_000)}
                                  >
                                    {BOUNDARY_NUDGE_MS / 1_000}초 앞
                                  </button>
                                  <button
                                    className="btn btn-secondary"
                                    type="button"
                                    aria-label={`후보 ${index + 1} 시작을 5초 뒤로`}
                                    onClick={() => nudgeCandidateBoundary(candidate, "SHIFT_START", 5_000)}
                                  >
                                    {BOUNDARY_NUDGE_MS / 1_000}초 뒤
                                  </button>
                                  <button
                                    className="btn btn-secondary"
                                    type="button"
                                    aria-label={`후보 ${index + 1}의 현재 재생 위치를 시작으로`}
                                    disabled={sourcePreviewUrl === null}
                                    onClick={() => setBoundaryFromPlayerPosition(candidate, "SET_START_FROM_PLAYER")}
                                  >
                                    재생 위치를 시작으로
                                  </button>
                                </div>
                              </fieldset>
                              <fieldset>
                                <legend>끝 위치</legend>
                                <div className="rh-boundary-buttons">
                                  <button
                                    className="btn btn-secondary"
                                    type="button"
                                    aria-label={`후보 ${index + 1} 끝을 5초 앞으로`}
                                    onClick={() => nudgeCandidateBoundary(candidate, "SHIFT_END", -5_000)}
                                  >
                                    {BOUNDARY_NUDGE_MS / 1_000}초 앞
                                  </button>
                                  <button
                                    className="btn btn-secondary"
                                    type="button"
                                    aria-label={`후보 ${index + 1} 끝을 5초 뒤로`}
                                    onClick={() => nudgeCandidateBoundary(candidate, "SHIFT_END", 5_000)}
                                  >
                                    {BOUNDARY_NUDGE_MS / 1_000}초 뒤
                                  </button>
                                  <button
                                    className="btn btn-secondary"
                                    type="button"
                                    aria-label={`후보 ${index + 1}의 현재 재생 위치를 끝으로`}
                                    disabled={sourcePreviewUrl === null}
                                    onClick={() => setBoundaryFromPlayerPosition(candidate, "SET_END_FROM_PLAYER")}
                                  >
                                    재생 위치를 끝으로
                                  </button>
                                </div>
                              </fieldset>
                            </div>
                            <div className="rh-boundary-footer">
                              <button
                                className="btn btn-secondary"
                                type="button"
                                aria-label={`후보 ${index + 1}을 AI 제안 구간으로 되돌리기`}
                                disabled={!boundaryTouched || !rangeAdjusted}
                                onClick={() => resetCandidateBoundary(candidate)}
                              >
                                AI 제안으로 되돌리기
                              </button>
                              {sourcePreviewUrl === null && (
                                <span>재생 위치 지정은 원본을 다시 연결하면 사용할 수 있어요.</span>
                              )}
                            </div>
                            {boundaryFeedback?.candidateId === candidate.id && (
                              <p
                                className="rh-boundary-feedback"
                                data-tone={boundaryFeedback.tone}
                                role="status"
                                aria-live="polite"
                              >
                                {boundaryFeedback.message}
                              </p>
                            )}
                          </div>
                        </details>
                        {clipDownloadStatusById[candidate.id] === "completed" && (
                          <p className="rh-notice" data-tone="success" role="status">
                            이 후보의 영상 클립 다운로드를 시작했어요.
                          </p>
                        )}
                        {clipDownloadErrorById[candidate.id] !== undefined && (
                          <p className="rh-notice" data-tone="danger" role="alert">
                            {clipDownloadErrorById[candidate.id]}
                          </p>
                        )}
                      </div>
                      <div className="rh-confidence">
                        <span>{candidate.evidence.audio === undefined ? "가장 강한 순간" : "반응 정점"}</span>
                        <strong>{formatDuration(candidate.peakMs)}</strong>
                      </div>
                    </article>
                    );
                  })}
                  </div>
                  </div>
                  </section>
                  )}
                  </div>
                </>
              )}

              {contextualCandidatePublicationReady && (
                <p className="rh-screen-reader-only" role="status" aria-live="polite">
                  {orderedCandidates.length}개 중 {reviewedCount}개 검토 · 승인 {approvedCount}개 · 제외 {rejectedCount}개
                </p>
              )}
              {contextualCandidatePublicationReady && unsavedSessionWorkStarted && (
                <details className="rh-session-note">
                  <summary>현재 검토 변경 사항은 아직 저장되지 않았어요</summary>
                  <p>
                    승인·제외 판단과 시작·끝 조정은 다른 영상이나 결과로 이동하기 전에 확인합니다.
                    정밀 AI 단서와 추천 검토 순서는 현재 다운로드에 포함되지 않으므로 필요한 후보를
                    직접 재생해 확인해 주세요.
                  </p>
                </details>
              )}

              {contextualCandidatePublicationReady &&
                orderedCandidates.length > 0 &&
                (approvedCount > 0 || reviewCompleted) && (
                <section className="rh-export-panel" aria-labelledby="export-title">
                  <div className="rh-export-heading">
                    <div>
                      <p className="rh-eyebrow">4단계 · 결과 받기</p>
                      <h3 id="export-title" ref={exportHeading} tabIndex={-1}>
                        {approvedCount > 0
                          ? `선택한 장면 ${approvedCount}개가 준비됐어요`
                          : "사용할 장면을 먼저 골라 주세요"}
                      </h3>
                      <p>
                        시작·끝 시간이 담긴 편집용 시간표를 받습니다.
                        승인한 구간은 MP4·WebM 클립 파일로 만들어 바로 다운로드할 수 있어요.
                      </p>
                    </div>
                    <span className="rh-export-count" aria-hidden="true">{approvedCount}</span>
                  </div>

                  {approvedCount > 0 && (
                    <ol className="rh-approved-timeline" aria-label="승인한 장면 시간표">
                      {[...approvedExportCandidates]
                        .sort((left, right) => {
                          const leftRange = effectiveCandidateRange(
                            left.proposal,
                            left.boundaryRevision,
                          );
                          const rightRange = effectiveCandidateRange(
                            right.proposal,
                            right.boundaryRevision,
                          );
                          return (
                            leftRange.startMs - rightRange.startMs ||
                            left.proposal.id.localeCompare(right.proposal.id)
                          );
                        })
                        .map(({ proposal: candidate, boundaryRevision }) => {
                          const range = effectiveCandidateRange(
                            candidate,
                            boundaryRevision,
                          );
                          const explanation =
                            buildCandidateEvidenceExplanationWithFallback({
                              candidate,
                              effectiveRange: range,
                              passBEvidence: candidatePassBEvidenceById[candidate.id],
                              audioEventEvidence:
                                candidateAudioEventEvidenceById[candidate.id],
                            }).explanation;
                          return (
                            <li key={candidate.id}>
                              <strong>{formatDuration(range.startMs)}–{formatDuration(range.endMs)}</strong>
                              <span>{explanation.whyWorthReviewing.text}</span>
                            </li>
                          );
                        })}
                    </ol>
                  )}

                  <div className="rh-export-actions">
                    <button
                      className="btn btn-primary rh-primary-action"
                      type="button"
                      disabled={
                        sourceFile === null ||
                        approvedCount === 0 ||
                        clipBatchStatus === "rendering" ||
                        clipRenderAbortController.current !== null
                      }
                      onClick={downloadApprovedClips}
                    >
                      {clipBatchStatus === "rendering"
                        ? `승인 클립 ${clipBatchCompletedCount}/${approvedCount}개 만드는 중`
                        : clipBatchStatus === "completed"
                          ? "승인 클립 다시 전체 다운로드"
                          : sourceFile === null
                            ? "원본 연결 후 클립 전체 다운로드"
                            : "승인한 클립 전체 다운로드"}
                    </button>
                    <button
                      className="btn btn-primary rh-primary-action"
                      type="button"
                      disabled={approvedCount === 0}
                      onClick={() => exportCandidates("csv")}
                    >
                      Excel용 시간표 받기 (.csv)
                    </button>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      disabled={approvedCount === 0}
                      onClick={() => void copyApprovedTimecodes()}
                    >
                      타임코드 복사
                    </button>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      disabled={approvedCount === 0}
                      onClick={() => exportCandidates("markdown")}
                    >
                      읽기 좋은 목록 (.md)
                    </button>
                  </div>

                  {clipBatchStatus === "rendering" && (
                    <p className="rh-help" role="status">
                      승인한 클립을 시간순으로 하나씩 만들고 있어요. 브라우저의 여러 다운로드 안내가 나오면 허용해 주세요.
                    </p>
                  )}
                  {clipBatchStatus === "completed" && (
                    <p className="rh-notice" data-tone="success" role="status">
                      승인한 클립 {approvedCount}개를 모두 만들었어요. 다운로드 목록에서 확인해 주세요.
                    </p>
                  )}
                  {clipBatchError !== null && (
                    <p className="rh-notice" data-tone="danger" role="alert">
                      {clipBatchError}
                    </p>
                  )}

                  <details className="rh-advanced-export">
                    <summary>백업·고급 형식</summary>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      disabled={approvedCount === 0}
                      onClick={() => exportCandidates("json")}
                    >
                      개인정보를 뺀 JSON 받기
                    </button>
                  </details>

                  {approvedCount === 0 && (
                    <p className="rh-help">후보에서 ‘사용할게요’를 하나 이상 누르면 결과 버튼이 열려요.</p>
                  )}
                  {lastExportFormat !== null && (
                    <p className="rh-notice" data-tone="success" role="status">
                      {lastExportFormat === "csv"
                        ? "Excel용 CSV 다운로드를 요청했어요."
                        : lastExportFormat === "markdown"
                          ? "읽기 좋은 Markdown 다운로드를 요청했어요."
                          : "백업용 JSON 다운로드를 요청했어요."}
                    </p>
                  )}
                  {copyStatus === "copied" && (
                    <p className="rh-notice" data-tone="success" role="status">
                      승인한 장면의 시작·끝 시간을 복사했어요.
                    </p>
                  )}
                  {exportError !== null && <p className="rh-notice" data-tone="danger" role="alert">{exportError}</p>}

                  {candidateRefinementBusy && (
                    <p className="rh-help" role="status">
                      후보의 자세한 AI 단서를 찾는 중이에요. 현재 작업을 먼저 멈추거나 끝까지 기다려 주세요.
                    </p>
                  )}
                  <button
                    className="btn btn-secondary rh-new-analysis"
                    type="button"
                    disabled={analysisBusy || candidateRefinementBusy}
                    onClick={startFreshAnalysis}
                  >
                    새 영상 분석하기
                  </button>
                </section>
              )}
            </section>
          )}
        </div>

        <footer className="rh-footer">
          ExClipper · v{APP_VERSION}
        </footer>
        </div>
      </main>

      {reviewUndo !== null && (
        <ReviewUndoToast
          undo={reviewUndo}
          onUndo={undoLastReview}
          onDismiss={() => setReviewUndo(null)}
        />
      )}

      {shortcutHelpOpen && (
        <ShortcutHelpOverlay onClose={() => setShortcutHelpOpen(false)} />
      )}
    </div>
  );
}

export default App;
