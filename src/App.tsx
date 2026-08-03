import {
  Fragment,
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
import {
  mapSettledWithConcurrency,
} from "./analysis/boundedAsyncMap";
import {
  estimateCandidatePassBCost,
  formatEstimatedUsd,
} from "./analysis/candidatePassBCost";
import { AI_BROADCAST_CONTEXT_ROUTING_REVISION } from "./analysis/aiModelRoutingPolicy";
import { getOrCreateAiQuotaParticipantId } from "./analysis/aiQuotaClient";
import {
  createDiscoveredLeadRefinementPlan,
  materializeRefinedDiscoveredLeadEvidence,
} from "./analysis/discoveredLeadRefinement";
import {
  activateBroadcastRefinementEvidenceRoute,
  appendBroadcastRefinementEvidenceRouteEntry,
  broadcastRefinementEvidenceLedgerCanPublish,
  createBroadcastRefinementEvidenceLedger,
  getBroadcastRefinementActiveEvidencePayload,
  projectBroadcastRefinementActiveEvidenceRoute,
  serializeBroadcastRefinementEvidenceLedger,
  type BroadcastRefinementActiveRouteProjection,
  type BroadcastRefinementEvidenceLedger,
} from "./analysis/broadcastRefinementEvidenceLedger";
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
import {
  inspectBroadcastTranscriptEvidenceSettlement,
  parseBroadcastTranscriptResolvedEvidenceCheckpointJson,
  rebaseBroadcastTranscriptResolvedEvidenceModelRevision,
  recordBroadcastTranscriptResolvedEvidence,
  serializeBroadcastTranscriptResolvedEvidenceCheckpoint,
  type BroadcastTranscriptResolvedEvidenceCheckpoint,
} from "./analysis/broadcastTranscriptResolvedEvidence";
import {
  prepareBroadcastTranscriptEvidenceProjection,
} from "./analysis/broadcastTranscriptEvidenceProjection";
import {
  createBroadcastTranscriptVisualInspectionPlan,
} from "./analysis/broadcastTranscriptVisualInspectionQueue";
import {
  parseAndProjectBroadcastTranscriptVisualContext,
  type BroadcastTranscriptVisualContextProjection,
} from "./analysis/broadcastTranscriptVisualContextProjection";
import {
  broadcastTranscriptProviderReceiptCheckpointModelRevision,
  createBroadcastTranscriptProviderReceiptCheckpoint,
  inspectBroadcastTranscriptProviderReceiptSettlement,
  parseBroadcastTranscriptProviderReceiptCheckpointJson,
  rebaseBroadcastTranscriptProviderReceiptCheckpointRoute,
  recordBroadcastTranscriptCaptionReceipt,
  recordBroadcastTranscriptProviderReceipt,
  serializeBroadcastTranscriptProviderReceiptCheckpoint,
  type BroadcastTranscriptProviderReceiptCheckpoint,
} from "./analysis/broadcastTranscriptProviderReceiptCheckpoint";
import {
  requestBroadcastTranscriptRouteSelection,
  type BroadcastTranscriptVerifiedResult,
} from "./analysis/broadcastTranscriptRouteManifest";
import {
  BROADCAST_TRANSCRIPT_PROXY_ENDPOINT,
} from "./analysis/broadcastTranscriptQwenClient";
import { compactBroadcastContextChapters } from "./analysis/broadcastContextChapterCompaction";
import {
  broadcastContextPhaseLedgerMatchesFence,
  parseBroadcastContextPhaseLedgerJson,
  replanBroadcastContextPhaseLedgerAfterEditorRetry,
  serializeBroadcastContextPhaseLedger,
  type BroadcastContextPhaseLedger,
  type BroadcastContextPhaseLedgerFence,
} from "./analysis/broadcastContextPhaseLedger";
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
import {
  nextTranscriptFragmentManualGeneration,
  recoverBroadcastTranscriptFragments,
  transcriptFragmentQuotaOperationId,
  type BroadcastTranscriptFragmentRecoveryProgress,
  type BroadcastTranscriptFragmentRecoveryResult,
} from "./analysis/broadcastTranscriptFragmentRecovery";
import { runDurableBroadcastContextPipeline } from "./app/durableBroadcastContextPipeline";
import {
  loadDurableBroadcastContextSession,
  transformDurableBroadcastContextSession,
  type DurableBroadcastContextSessionResult,
} from "./app/durableBroadcastContextSession";
import { runDurableBroadcastVisualInspectionPhase } from "./app/durableBroadcastVisualInspectionPhase";
import {
  runDurableBroadcastRefinementPipeline,
  type DurableBroadcastRefinementLeadInput,
} from "./app/durableBroadcastRefinementPipeline";
import { runDurableBroadcastRefinementTranscriptPipeline } from "./app/durableBroadcastRefinementTranscriptPipeline";
import {
  BROADCAST_TRANSCRIPT_WORKER_VERSION,
  type BroadcastTranscriptDispatchIntent,
  type BroadcastTranscriptWorkerProgress,
} from "./analysis/broadcastTranscriptWorkerProtocol";
import {
  BROADCAST_SPEECH_ACTIVITY_MODEL_REVISION,
  BROADCAST_SPEECH_ACTIVITY_POLICY_REVISION,
  type BroadcastSpeechActivityRunReceipt,
} from "./analysis/broadcastSpeechActivity";
import {
  type BroadcastTranscriptQwenResult,
} from "./analysis/broadcastTranscriptQwen";
import {
  YOUTUBE_CAPTION_MODEL_REVISION,
  createYouTubeCaptionTranscriptCellOutcomes,
  type YouTubeCaptionTrackResult,
  youtubeVideoIdFromSourceName,
  youtubeVideoIdFromUserInput,
} from "./analysis/youtubeCaptionTrack";
import { requestYouTubeCaptionTrack } from "./analysis/youtubeCaptionClient";
import {
  fetchChannelPreanalysisReviewForLookup,
  requestConfiguredChannelPreanalysisMatch,
  type ConfiguredChannelPreanalysisSearchResult,
  type ChannelPreanalysisLookupResult,
  type LoadedChannelPreanalysisReview,
} from "./analysis/channelPreanalysisClient";
import {
  CHANNEL_PREANALYSIS_TITLE_DURATION_TOLERANCE_MS,
  channelPreanalysisSourceForManifest,
} from "./analysis/channelPreanalysisCatalog";
import type { ChannelPreanalysisBundle } from "./analysis/channelPreanalysisBundle";
import {
  channelPreanalysisVerifiedBundleBindingMatchesLookup,
  createChannelPreanalysisVerifiedBundleBinding,
  type ChannelPreanalysisVerifiedBundleBinding,
} from "./analysis/channelPreanalysisBundleBinding";
import {
  createChannelPreanalysisContextSeed,
  createChannelPreanalysisTrustedSourceIdentity,
  type ChannelPreanalysisContextSeed,
} from "./analysis/channelPreanalysisContextSeed";
import {
  channelPreanalysisIdentityBasisAuthorizesPreparedData,
  classifyChannelPreanalysisTimeline,
  resolveChannelPreanalysisTrust,
  selectChannelPreanalysisLookupLane,
  type ChannelPreanalysisTimelineStatus,
  type ChannelPreanalysisTrustedIdentityBasis,
} from "./analysis/channelPreanalysisTrust";
import {
  getChannelPreanalysisLocalBinding,
  registerChannelPreanalysisLocalBinding,
} from "./analysis/channelPreanalysisLocalBinding";
import {
  verifyChannelPreanalysisLocalVisualIdentity,
  verifyConfiguredChannelPreanalysisLocalVisualIdentity,
} from "./app/channelPreanalysisVisualIdentity";
import {
  chzzkVideoNoFromSourceName,
  requestChzzkVideoChannel,
} from "./analysis/chzzkVideoChannel";
import type { AnalysisLanguage } from "./domain/analysisLanguage";
import {
  captionTextForRange,
  chapterTextForRange,
} from "./analysis/captionCandidateEvidence";
import {
  produceCandidateVideoFrameBundles,
  type CandidateVideoFrameBundleResult,
} from "./analysis/candidateVideoFrames";
import {
  candidatePassBCastRosterIdForYouTubeChannelId,
  candidatePassBCastRosterIdForSourceName,
  canonicalCandidatePassBCastDisplayName,
  type CandidatePassBCastRosterId,
} from "./analysis/participantRoster";
import {
  createBroadcastParticipantGrounding,
  participantContextForBroadcastRange,
} from "./analysis/broadcastParticipantGrounding";
import {
  completeBroadcastParticipantPreContext,
  prepareBroadcastParticipantPreContext,
  type BroadcastParticipantPreContextResult,
} from "./analysis/broadcastParticipantPreContextOrchestration";
import { createBroadcastParticipantVisualTerminalReceiptFromSettlement } from "./analysis/broadcastParticipantGroundingBridge";
import {
  createBroadcastParticipantGroundingNoneObservedReceipt,
} from "./analysis/broadcastParticipantGroundingPlan";
import { BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_MODEL_REVISION } from "./analysis/broadcastTranscriptVisualProviderClient";
import { activeAccentCssVars } from "./app/streamerPaletteForRoster";
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
import {
  CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
  type CandidatePassBDispatchIntent,
  type CandidatePassBTerminalSettlement,
  type CandidatePassBVerificationSourceFence,
} from "./analysis/candidatePassBWorkerProtocol";
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
  selectCandidateDetailCandidateIds,
  selectContextExcludedCandidateIds,
  type CandidateAiProjectionById,
} from "./analysis/contextQualifiedFinalSelection";
import { buildCandidatePassBContextPackets } from "./analysis/candidateContextPackets";
import {
  candidatePassBContextFingerprint,
  createCandidatePassBVerificationReceipt,
  finalizeFullyVerifiedCandidates,
} from "./analysis/candidateFinalVerification";
import { buildBroadcastSummaryCitationPresentation } from "./analysis/broadcastSummaryCitations";
import {
  createBroadcastContextRequest,
  type BroadcastContextCandidateInput,
  type BroadcastContextChapterInput,
  type BroadcastContextRequestInput,
  type BroadcastContextResult,
  type BroadcastContextSemanticChapter,
} from "./analysis/broadcastContextProtocol";
import { buildHighlightNarrative } from "./analysis/highlightNarrative";
import {
  BROADCAST_TOPICAL_DISCOVERY_VERSION,
  MAX_TOPICAL_REFINEMENT_CONCURRENCY,
  MAX_TOPICAL_REFINEMENT_LEADS,
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
  type AnalysisStage,
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
  assessClipSubtitleCoverage,
  buildClipSrt,
  type ClipSubtitleAvailability,
} from "./exports/clipSubtitles";
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
  checkpointBroadcastContextSessionPhaseLedgerIfUnchanged,
  invalidateBroadcastContextSessionContextIfUnchanged,
  type AnalysisManifestRecord,
  type AnalysisResultStore,
  type AnalysisTerminalRecord,
  type FinalAnalysisResultRecord,
  type SourceCapabilitySnapshotRecord,
} from "./storage/analysisResultStore";
import {
  BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
  checkpointBroadcastContextSessionTranscript,
  checkpointBroadcastContextSessionPhaseLedger,
  checkpointBroadcastContextSessionRefinementEvidenceLedger,
  createBroadcastParticipantGroundingInputSignature,
  invalidateBroadcastContextSessionContext,
  partitionBroadcastContextSessionChapters,
  restoreBroadcastParticipantPreContextCheckpoint,
  serializeBroadcastParticipantPreContextCheckpoint,
  parseBroadcastContextSessionRefinementEvidenceLedger,
  type BroadcastContextSessionRecord,
  type StoredBroadcastTranscriptGap,
} from "./storage/broadcastContextSessionStore";
import { commitDurableBroadcastTranscriptCheckpoint } from "./app/durableBroadcastTranscriptCheckpoint";
import {
  broadcastTranscriptGapCanAutomaticallyRetry,
  broadcastTranscriptGapRequiresExplicitPaidRetry,
  broadcastTranscriptSessionCheckpointIncludes,
  mergeBroadcastTranscriptSessionCheckpoints,
  selectRunnableBroadcastTranscriptChunks,
} from "./app/broadcastTranscriptCheckpointMerge";
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
  CANDIDATE_PASS_B_PLAN_MAX_CANDIDATES,
  createCandidatePassBPlanReceipt,
  mergeCandidatePassBInsightsForResume,
  persistCandidatePassBInsightsWithReadback,
  recoverCandidatePassBArmedDispatchesAsOutcomeUnknown,
  type CandidatePassBInsightsRecord,
  type CandidatePassBPlanReceipt,
} from "./storage/candidatePassBInsightStore";
import {
  appendCandidatePassBArmedAttempt,
  CANDIDATE_PASS_B_RETRY_GRANT_SCHEMA_VERSION,
  candidatePassBAttemptLedgerState,
  createCandidatePassBAttemptLedger,
  issueCandidatePassBRetryGrant,
  settleCandidatePassBAttempt,
  type CandidatePassBAttemptLedger,
  type CandidatePassBRetryGrantMode,
} from "./analysis/candidatePassBAttemptLedger";
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
  deriveCandidatePublicationGate,
  deriveCandidateStageCommitGate,
  selectCandidateDetailActionIds,
} from "./app/candidatePublicationGate";
import { selectCandidateVerificationCohort } from "./app/candidateVerificationCohort";
import { selectBroadcastContextCandidateCohort } from "./app/broadcastContextCandidateCohort";
import {
  candidatePassBPlanContextCohortMatches,
  scheduleCandidatePassBAutomaticTargetReadback,
  selectCandidatePassBAutomaticTargets,
  selectCandidatePassBDurableIds,
  selectCandidatePassBDurableThumbnailById,
  selectCandidatePassBDurabilityOutstandingIds,
  selectEffectiveCandidatePassBContextById,
} from "./app/candidatePassBDurability";
import {
  activeRefinementEvidenceTranscripts,
  createSemanticRefinementAiInputSignature,
  createSemanticRefinementLeadInputs,
  semanticRefinementPhaseReceiptsMatchActiveProjection,
} from "./app/semanticRefinementEvidence";
import {
  canStartTranscriptRun,
  createCurrentProviderTranscriptSourceIdentityFence,
  currentTranscriptSourceIdentityDescriptor,
  isCurrentTranscriptSealOperationKey,
  transcriptContextReadiness,
  transcriptNeedsExplicitRetry,
  transcriptOperationKey,
  transcriptPhaseFor,
  waitForTranscriptRouteRecoveryDelay,
} from "./app/transcriptPhase";
import { buildCandidateSignalTiles } from "./app/candidateSignals";
import {
  freezeAnalysisCandidateCohort,
  projectVerifiedReviewCandidates,
  selectNonOverlappingDiscoveredCandidates,
} from "./app/analysisCandidateCohort";
import { candidateStripPositionPercent } from "./app/positionStrip";
import {
  nextUnreviewedCandidateId,
  reviewDecisionAdvances,
} from "./app/reviewNavigation";
import {
  useReviewShortcuts,
  type ReviewPage,
} from "./app/useReviewShortcuts";
import { ReviewStage } from "./app/ReviewStage";
import { PreparedReviewExperience } from "./app/PreparedReviewExperience";
import {
  FrontSurface,
  type FrontEvidenceRange,
  type FrontParticipantSummary,
  type FrontScopeSummary,
} from "./app/FrontSurface";
import {
  deriveFrontSurfaceModel,
  selectFrontRecoveryAction,
  type FrontPipelineInput,
  type FrontPreanalysisInput,
  type FrontRecoveryActionId,
  type FrontRecoveryInput,
  type FrontSourceInput,
  type FrontTopicRangeInput,
} from "./app/frontSurfaceModel";
import {
  decisionForReviewState,
  reviewStateForDecision,
} from "./app/reviewDecisionVocabulary";
import { buildReviewCandidates } from "./app/reviewSurfaceModel";
import { computeProgressAxis, formatSingleRemaining } from "./app/analysisProgressAxis";
import { formatStageTimingReport, StageTimer } from "./app/stageTiming";
import {
  commitDurableAnalysisStage,
  completeDurableAnalysisJob,
  failDurableAnalysisJob,
  pauseDurableAnalysisJob,
  startDurableAnalysisJob,
  type DurableAnalysisJobOperationResult,
} from "./app/durableAnalysisJobBridge";
import {
  commitDurableFastPassManifest,
  commitDurableFastPassResult,
} from "./app/durableFastPassArtifacts";
import {
  CURRENT_FAST_PASS_MODEL_MANIFEST_HASH,
  inspectCurrentTranscriptCheckpoint,
  type AnalysisPipelineSuccessCertificate,
  type AnalysisPipelineSuccessGap,
} from "./app/analysisPipelineSuccess";
import {
  runDurableAnalysisPipelineCertification,
  type AnalysisPipelineCertificationEvidence,
} from "./app/durableAnalysisPipelineCertification";
import {
  planAnalysisPipelineRecovery,
  type AnalysisPipelineRecoveryPlan,
} from "./app/analysisPipelineRecoveryPlanner";
import { executeAnalysisPipelineRecoveryInApp } from "./app/analysisPipelineRecoveryAppIntegration";
import { AnalysisProgressPanel } from "./app/components/AnalysisProgressPanel";
import { STREAMER_PROFILE_IMAGE_BY_NAME } from "./app/streamerProfiles";
import { STREAMER_PALETTE_SEEDS } from "./app/streamerPalette";
import { paletteIdForCastRosterId } from "./app/streamerPaletteForRoster";

/**
 * 레거시 검토 섹션의 3탭. 새 화면은 요약/근거 두 페이지(`ReviewPage`)를 쓰므로
 * 이 타입은 그 섹션이 걷힐 때 함께 사라진다.
 */
type DossierTab = "summary" | "clues" | "context";

type BroadcastVisualInspectionUiStatus =
  | "idle"
  | "preparing"
  | "analyzing"
  | "completed"
  | "blocked"
  | "failed";

type ChannelPreanalysisConnectionState =
  | {
      readonly status: "idle" | "checking" | "unavailable" | "not-found";
    }
  | {
      readonly status: "probable";
      readonly lookup: ChannelPreanalysisLookupResult;
      readonly reason:
        | "metadata-probable"
        | "filename-confirmation-required";
      readonly timelineStatus: ChannelPreanalysisTimelineStatus;
    }
  | {
      readonly status: "incompatible";
      readonly lookup: ChannelPreanalysisLookupResult;
      readonly timelineStatus: "incompatible";
    }
  | {
      readonly status: "connected";
      readonly lookup: ChannelPreanalysisLookupResult;
      readonly basis:
        | ChannelPreanalysisTrustedIdentityBasis
        | "recovery-preserved";
      /**
       * A catalog identity may be remembered for a future fresh analysis
       * without changing the immutable input of an opened recovery result.
       */
      readonly attachment: "current-run" | "future-run-only";
      /**
       * Timed captions and bundles are usable only when the catalog duration
       * proves that their time axis matches this local source.
       */
      readonly timelineStatus: ChannelPreanalysisTimelineStatus;
    };

type PreparedChannelReviewState =
  | { readonly status: "idle" | "checking" | "dismissed" }
  | {
      readonly status: "preparing" | "unavailable";
      readonly videoId: string;
      readonly title: string | null;
    }
  | {
      readonly status: "ready";
      readonly videoId: string;
      readonly title: string;
      readonly lookup: ChannelPreanalysisLookupResult;
      readonly loaded: LoadedChannelPreanalysisReview;
    };

const PREPARED_CHANNEL_REVIEW_POLL_INTERVAL_MS = 30_000;

interface ChannelPreanalysisContextSeedSource {
  readonly sourceIdentity: ChannelPreanalysisContextSeed["sourceIdentity"];
  readonly bundle: ChannelPreanalysisBundle;
}

function channelPreanalysisContextSeedSource(
  connection: ChannelPreanalysisConnectionState,
  binding: ChannelPreanalysisVerifiedBundleBinding | null,
  sourceContentFingerprint: string,
  analysisCaptionVideoId: string | null,
  sourceDurationMs: number,
  sourceCastRosterId: CandidatePassBCastRosterId | null,
  outputLanguage: AnalysisLanguage,
): ChannelPreanalysisContextSeedSource | null {
  if (
    connection.status !== "connected" ||
    !channelPreanalysisIdentityBasisAuthorizesPreparedData(connection.basis) ||
    connection.attachment !== "current-run" ||
    connection.timelineStatus !== "compatible" ||
    binding === null ||
    binding.sourceContentFingerprint !== sourceContentFingerprint ||
    analysisCaptionVideoId === null ||
    binding.bundle.videoId !== analysisCaptionVideoId ||
    connection.lookup.match.match?.videoId !== analysisCaptionVideoId ||
    !channelPreanalysisVerifiedBundleBindingMatchesLookup(
      binding,
      connection.lookup,
    ) ||
    Math.abs(binding.bundle.durationMs - sourceDurationMs) >
      CHANNEL_PREANALYSIS_TITLE_DURATION_TOLERANCE_MS ||
    sourceCastRosterId !==
      candidatePassBCastRosterIdForYouTubeChannelId(
        binding.bundle.channelId,
      ) ||
    outputLanguage !== "ko" ||
    binding.bundle.broadcastContext === null ||
    binding.bundle.contextProvenance === null
  ) {
    return null;
  }
  const configuredSource = channelPreanalysisSourceForManifest(
    connection.lookup.manifest,
  );
  if (
    configuredSource === null ||
    configuredSource.channelId !== binding.bundle.channelId
  ) {
    return null;
  }
  return {
    sourceIdentity: createChannelPreanalysisTrustedSourceIdentity(
      configuredSource,
      {
      videoId: binding.bundle.videoId,
      transcriptDigest: binding.bundle.transcriptDigest,
      artifactDigest: binding.artifactDigest,
      },
    ),
    bundle: binding.bundle,
  };
}

type AnalysisPipelineCertificationState =
  | {
      readonly status: "idle";
    }
  | {
      readonly status: "checking";
      readonly inputToken: string;
    }
  | {
      readonly status: "succeeded";
      readonly inputToken: string;
      readonly durableToken: string;
      readonly certificate: AnalysisPipelineSuccessCertificate;
    }
  | {
      readonly status: "failed";
      readonly inputToken: string;
      readonly failedStage: AnalysisStage;
      readonly gaps: readonly AnalysisPipelineSuccessGap[];
    };

interface AnalysisPipelineRecoveryRequest {
  readonly inputToken: string;
  readonly plan: AnalysisPipelineRecoveryPlan;
}

const PIPELINE_CERTIFICATION_GAP_LABEL: Readonly<
  Record<AnalysisPipelineSuccessGap["code"], { readonly ko: string; readonly en: string }>
> = {
  "current-schema-required": {
    ko: "현재 분석 형식의 저장 결과를 모두 다시 열지 못했어요.",
    en: "The complete current-format analysis could not be reopened.",
  },
  "fast-result-invalid": {
    ko: "빠른 탐색 결과의 완료 기록을 다시 확인하지 못했어요.",
    en: "The fast-scan completion record could not be verified.",
  },
  "run-fence-mismatch": {
    ko: "서로 다른 분석 실행의 결과가 섞이지 않도록 완료를 멈췄어요.",
    en: "Completion stopped because artifacts from different runs were detected.",
  },
  "source-fence-mismatch": {
    ko: "분석 중 원본 식별 정보가 달라져 완료를 멈췄어요.",
    en: "Completion stopped because the source identity changed.",
  },
  "transcript-unsettled": {
    ko: "아직 복구되지 않은 대사 구간이 있어요.",
    en: "Some transcript cells still need recovery.",
  },
  "participant-grounding-stale": {
    ko: "등장인물 근거를 현재 대사와 다시 연결해야 해요.",
    en: "Participant evidence must be rebound to the current transcript.",
  },
  "context-input-stale": {
    ko: "방송 전체 맥락 입력을 현재 대사·등장인물 근거로 다시 확인해야 해요.",
    en: "Whole-broadcast context must be checked against current evidence.",
  },
  "context-ledger-incomplete": {
    ko: "끝나지 않은 방송 맥락 조각이 남아 있어요.",
    en: "Some whole-broadcast context units are unfinished.",
  },
  "context-result-invalid": {
    ko: "방송 맥락 결과와 현재 후보 구간이 정확히 맞지 않아요.",
    en: "The broadcast context no longer matches the candidate ranges.",
  },
  "refinement-evidence-incomplete": {
    ko: "의미 후보의 대사 근거가 아직 완전히 준비되지 않았어요.",
    en: "Semantic-candidate transcript evidence is incomplete.",
  },
  "refinement-receipt-stale": {
    ko: "의미 후보 AI 결과를 현재 대사 근거와 다시 연결해야 해요.",
    en: "Semantic AI results must be rebound to current transcript evidence.",
  },
  "candidate-plan-invalid": {
    ko: "최종 검토 대상 구성이 현재 맥락 결과와 맞지 않아요.",
    en: "The final-detail plan does not match the current context result.",
  },
  "candidate-detail-not-durable": {
    ko: "일부 후보의 화면·오디오 해석 결과를 저장소에서 다시 확인하지 못했어요.",
    en: "Some multimodal candidate results could not be reopened.",
  },
  "candidate-verification-incomplete": {
    ko: "완전한 판정을 받지 못한 후보가 남아 있어요.",
    en: "Some candidates have not reached a complete judgement.",
  },
};

type AnalysisSelectionSummary = DurableAnalysisSelectionSummary;
type AnalysisCoverageSummary = DurableAnalysisCoverageSummary;
type AnalysisGapApprovalEvidence = DurableAnalysisGapApprovalEvidence;

const APP_VERSION = "0.9.2";
const PERSISTENCE_SCHEMA_VERSION = "0.3.0";
const SIGNAL_ENGINE_VERSION = CURRENT_FAST_PASS_MODEL_MANIFEST_HASH;
const MAX_CHAT_FILE_BYTES = 32 * 1024 * 1024;
const SIGNAL_GAP_POLICY_ID = DURABLE_SIGNAL_GAP_POLICY_ID;
async function requestChannelPreanalysisMatchForSource(
  input: {
    readonly videoId: string | null;
    readonly title: string;
    readonly durationMs: number;
    readonly localSampledFingerprint: string;
  },
  parentSignal: AbortSignal,
): Promise<ConfiguredChannelPreanalysisSearchResult> {
  return requestConfiguredChannelPreanalysisMatch(input, {
    signal: parentSignal,
  });
}

class CandidatePassBInsightPersistenceError extends Error {
  public constructor(cause: unknown) {
    super("Candidate Pass B artifacts were not durably verified.", { cause });
    this.name = "CandidatePassBInsightPersistenceError";
  }
}

function initialAiAttemptOrdinal(): number {
  // Terminal quota operation IDs live for six hours. A timestamp-backed
  // generation prevents a restored tab from reusing generation zero.
  return Date.now();
}

function isContextDiscoveredCandidate(candidate: ReviewedCandidate): boolean {
  return (
    candidate.id.startsWith("semantic-") &&
    candidate.signalKinds.length === 1 &&
    candidate.signalKinds[0] === "semantic" &&
    candidate.evidence.semantic !== undefined
  );
}

function automaticContextRetryDelayMs(
  ledger: BroadcastContextPhaseLedger,
): number | null {
  const recoverableUnits = ledger.units.filter(
    ({ status }) =>
      status === "in-flight" ||
      status === "reconciling" ||
      status === "outcome-unknown" ||
      status === "retryable-gap",
  );
  if (recoverableUnits.length === 0) {
    return null;
  }
  const highestAttemptOrdinal = Math.max(
    ...recoverableUnits.map(({ attemptOrdinal }) => attemptOrdinal),
  );
  return Math.min(
    30_000,
    1_000 * 2 ** Math.min(highestAttemptOrdinal, 5),
  );
}

function withoutCandidateEntry<T>(
  record: Readonly<Record<string, T>>,
  candidateId: string,
): Record<string, T> {
  const next = { ...record };
  delete next[candidateId];
  return next;
}

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
  /**
   * A pasted replay URL is an explicit editor decision and must outrank every
   * inferred filename/catalog lane. The ref lets long-running effects read the
   * latest decision without restarting on each keystroke.
   */
  const [manualVodInput, setManualVodInput] = useState("");
  const manualVodInputRef = useRef("");
  const [sourceContentFingerprint, setSourceContentFingerprint] =
    useState<string | null>(null);
  const [
    channelPreanalysisLocalBindingRevision,
    setChannelPreanalysisLocalBindingRevision,
  ] = useState(0);
  const [channelPreanalysisConnection, setChannelPreanalysisConnection] =
    useState<ChannelPreanalysisConnectionState>({ status: "idle" });
  const [
    channelPreanalysisConfirmationPending,
    setChannelPreanalysisConfirmationPending,
  ] = useState(false);
  const channelPreanalysisConnectionRef =
    useRef<ChannelPreanalysisConnectionState>({ status: "idle" });
  const channelPreanalysisManualLookupKeyRef = useRef<string | null>(null);
  const channelPreanalysisBundleBindingRef =
    useRef<ChannelPreanalysisVerifiedBundleBinding | null>(null);
  const [preparedChannelReview, setPreparedChannelReview] =
    useState<PreparedChannelReviewState>({ status: "idle" });
  const [preparedChannelReviewRetryEpoch, setPreparedChannelReviewRetryEpoch] =
    useState(0);
  const preparedChannelReviewAbortController = useRef<AbortController | null>(null);
  const dismissedPreparedChannelReviewKeyRef = useRef<string | null>(null);
  const registeredChannelPreanalysisVideoId = useMemo(() => {
    /*
     * The binding lives in localStorage rather than React state. Reading this
     * revision is the explicit invalidation fence after a verified write.
     */
    void channelPreanalysisLocalBindingRevision;
    return sourceContentFingerprint === null
        ? null
        : getChannelPreanalysisLocalBinding(sourceContentFingerprint)?.videoId ??
          null;
  }, [channelPreanalysisLocalBindingRevision, sourceContentFingerprint]);
  const currentChannelPreanalysisLookup =
    channelPreanalysisConnection.status === "connected" ||
    channelPreanalysisConnection.status === "probable" ||
    channelPreanalysisConnection.status === "incompatible"
      ? channelPreanalysisConnection.lookup
      : null;
  const currentChannelPreanalysisSource =
    currentChannelPreanalysisLookup === null
      ? null
      : channelPreanalysisSourceForManifest(
          currentChannelPreanalysisLookup.manifest,
        );
  const currentChannelPreanalysisTimelineStatus =
    channelPreanalysisConnection.status === "connected" ||
    channelPreanalysisConnection.status === "probable" ||
    channelPreanalysisConnection.status === "incompatible"
      ? channelPreanalysisConnection.timelineStatus
      : "unknown";
  const catalogRegisteredFingerprintVideoId =
    currentChannelPreanalysisLookup?.match.reason ===
    "registered-local-sampled-fingerprint"
      ? currentChannelPreanalysisLookup.match.match?.videoId ?? null
      : null;
  const currentChannelPreanalysisTrust = resolveChannelPreanalysisTrust({
    manualVideoId: youtubeVideoIdFromUserInput(manualVodInput),
    registeredBindingVideoId:
      registeredChannelPreanalysisVideoId ??
      catalogRegisteredFingerprintVideoId,
    filenameVideoId: youtubeVideoIdFromSourceName(
      sourceFile?.name ?? pendingFileName ?? "",
    ),
    editorConfirmedVideoId:
      channelPreanalysisConnection.status === "connected" &&
      channelPreanalysisConnection.basis === "editor-confirmed-catalog"
        ? channelPreanalysisConnection.lookup.match.match?.videoId ?? null
        : null,
    catalogConfidence:
      currentChannelPreanalysisLookup?.match.confidence ?? "none",
    catalogVideoId:
      currentChannelPreanalysisLookup?.match.match?.videoId ?? null,
    timelineStatus: currentChannelPreanalysisTimelineStatus,
  });
  const resolvedChannelPreanalysisVideoId =
    !(
      channelPreanalysisConnection.status === "connected" &&
      channelPreanalysisConnection.attachment === "future-run-only"
    )
      ? currentChannelPreanalysisTrust.rosterVideoId
      : null;
  const sourceDescriptor = `${sourceFile?.name ?? pendingFileName ?? ""} ${sourceUrl}`;
  const sourceChzzkVideoNo = useMemo(
    () => chzzkVideoNoFromSourceName(sourceDescriptor),
    [sourceDescriptor],
  );
  const [sourceChannelResolution, setSourceChannelResolution] = useState<{
    readonly videoNo: string;
    readonly status: "resolving" | "resolved" | "failed";
    readonly channelId: string | null;
  } | null>(null);
  const sourceChannelResolutionIsCurrent =
    sourceChzzkVideoNo === null ||
    (sourceChannelResolution?.videoNo === sourceChzzkVideoNo &&
      sourceChannelResolution.status !== "resolving");
  const resolvedSourceChannelId =
    sourceChzzkVideoNo !== null &&
    sourceChannelResolution?.videoNo === sourceChzzkVideoNo &&
    sourceChannelResolution.status === "resolved"
      ? sourceChannelResolution.channelId
      : null;
  const sourceCastRosterId = useMemo(
    () => sourceFile === null && pendingFileName === null
      ? null
      : candidatePassBCastRosterIdForSourceName(
        `${sourceDescriptor} ${resolvedSourceChannelId ?? ""} ${
          resolvedChannelPreanalysisVideoId === null
            ? ""
            : `${currentChannelPreanalysisLookup?.manifest.channelId ?? ""} ${resolvedChannelPreanalysisVideoId}`
        }`,
      ),
    [
      pendingFileName,
      resolvedChannelPreanalysisVideoId,
      currentChannelPreanalysisLookup?.manifest.channelId,
      resolvedSourceChannelId,
      sourceDescriptor,
      sourceFile,
    ],
  );
  const transcriptSourceIdentityFence =
    currentTranscriptSourceIdentityDescriptor(sourceCastRosterId);
  const replaceChannelPreanalysisConnection = useCallback(
    (next: ChannelPreanalysisConnectionState): void => {
      channelPreanalysisConnectionRef.current = next;
      setChannelPreanalysisConnection(next);
    },
    [],
  );
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState<string | null>(null);
  const [sourceCheck, setSourceCheck] = useState<SourceCheckState | null>(null);
  const [preflight, setPreflight] = useState<LocalMediaPreflightResult | null>(null);
  const preparedChannelTranscriptIsCompatible =
    channelPreanalysisConnection.status === "connected" &&
    channelPreanalysisConnection.attachment === "current-run" &&
    channelPreanalysisConnection.timelineStatus === "compatible" &&
    channelPreanalysisConnection.lookup.bundle !== null &&
    preflight !== null &&
    Math.abs(
      channelPreanalysisConnection.lookup.bundle.durationMs -
        preflight.metadata.durationMs,
    ) <= CHANNEL_PREANALYSIS_TITLE_DURATION_TOLERANCE_MS;
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
  const candidatesRef = useRef<readonly ReviewedCandidate[]>([]);
  candidatesRef.current = candidates;
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
  /**
   * Last remaining time the editor was actually shown. State, not a ref: the
   * label is derived from it during render, and it is reset per run so a new
   * analysis never inherits the previous run's floor.
   */
  const [shownRemainingMs, setShownRemainingMs] = useState<number | null>(null);
  /** 진행축이 뒤로 가지 않게 붙잡을 기준. 보여 준 값이어야 한다. */
  const [shownProgressRatio, setShownProgressRatio] = useState<number | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [pipelineCertification, setPipelineCertification] =
    useState<AnalysisPipelineCertificationState>({ status: "idle" });
  const [pipelineCertificationRetryEpoch, setPipelineCertificationRetryEpoch] =
    useState(0);
  const [pipelineRecoveryRequest, setPipelineRecoveryRequest] =
    useState<AnalysisPipelineRecoveryRequest | null>(null);
  const [pipelineFastRebuildPending, setPipelineFastRebuildPending] =
    useState(false);
  const pipelineRepairAttemptByInputTokenRef = useRef<Map<string, number>>(
    new Map(),
  );
  const pipelineCertificationEvidenceRef =
    useRef<AnalysisPipelineCertificationEvidence | null>(null);
  const pipelineCertificationOperationRef = useRef(0);
  const durableStageOperationRef = useRef(0);
  const [durableStageRetryEpoch, setDurableStageRetryEpoch] = useState(0);
  const [candidatePassBRun, setCandidatePassBRun] =
    useState<CandidatePassBRunState | null>(null);
  const [candidatePassBEvidenceById, setCandidatePassBEvidenceById] =
    useState<CandidatePassBEvidenceById>({});
  const [candidateGeminiInsightById, setCandidateGeminiInsightById] =
    useState<CandidateGeminiInsightById>({});
  const [candidateTimelineFramesById, setCandidateTimelineFramesById] =
    useState<CandidateTimelineFramesById>({});
  const [, setCandidatePassBVerificationReceiptById] =
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
  const [broadcastTranscriptAttemptOrdinal, setBroadcastTranscriptAttemptOrdinal] =
    useState(0);
  const [broadcastTranscriptProgress, setBroadcastTranscriptProgress] =
    useState<BroadcastTranscriptWorkerProgress | null>(null);
  const [
    broadcastTranscriptRecoveryProgress,
    setBroadcastTranscriptRecoveryProgress,
  ] = useState<BroadcastTranscriptFragmentRecoveryProgress | null>(null);
  const [broadcastTranscriptExplorationCells, setBroadcastTranscriptExplorationCells] =
    useState<readonly BroadcastTranscriptExplorationCell[]>([]);
  const [broadcastTranscriptChapters, setBroadcastTranscriptChapters] =
    useState<readonly BroadcastContextChapterInput[]>([]);
  const [
    broadcastVisualInspectionProjection,
    setBroadcastVisualInspectionProjection,
  ] = useState<BroadcastTranscriptVisualContextProjection | null>(null);
  const [
    broadcastVisualInspectionStatus,
    setBroadcastVisualInspectionStatus,
  ] = useState<BroadcastVisualInspectionUiStatus>("idle");
  const [
    broadcastVisualInspectionPlannedCellCount,
    setBroadcastVisualInspectionPlannedCellCount,
  ] = useState(0);
  const [
    broadcastVisualInspectionPreparedCellCount,
    setBroadcastVisualInspectionPreparedCellCount,
  ] = useState(0);
  const [
    broadcastVisualInspectionSettledCellCount,
    setBroadcastVisualInspectionSettledCellCount,
  ] = useState(0);
  const [
    broadcastVisualInspectionAttemptOrdinal,
    setBroadcastVisualInspectionAttemptOrdinal,
  ] = useState(0);
  const [
    broadcastVisualInspectionError,
    setBroadcastVisualInspectionError,
  ] = useState<string | null>(null);
  const [analysisCaptionVideoId, setAnalysisCaptionVideoId] =
    useState<string | null>(null);
  /**
   * 이미 받아 둔 자막을 다시 받지 않기 위한 거울.
   *
   * 상태를 이펙트 deps 에 넣으면 그 이펙트가 상태를 바꾸므로 다시 돈다. ref 는
   * 렌더를 유발하지 않아 그 고리를 만들지 않는다.
   */
  const youtubeCaptionTrackRef = useRef<YouTubeCaptionTrackResult | null>(null);
  const [youtubeCaptionTrack, setYouTubeCaptionTrack] =
    useState<YouTubeCaptionTrackResult | null>(null);
  const youtubeCaptionTrackExactJson = useMemo(
    () =>
      youtubeCaptionTrack === null
        ? null
        : JSON.stringify(youtubeCaptionTrack),
    [youtubeCaptionTrack],
  );
  const [broadcastTranscriptError, setBroadcastTranscriptError] =
    useState<string | null>(null);
  const [broadcastContextStatus, setBroadcastContextStatus] =
    useState<BroadcastContextUiStatus>("idle");
  const [broadcastContextAttemptOrdinal, setBroadcastContextAttemptOrdinal] =
    useState(initialAiAttemptOrdinal);
  const [broadcastContextResult, setBroadcastContextResult] =
    useState<BroadcastContextResult | null>(null);
  const [
    broadcastParticipantPreContext,
    setBroadcastParticipantPreContext,
  ] = useState<BroadcastParticipantPreContextResult | null>(null);
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
  const [
    semanticLeadRefinementAttemptOrdinal,
    setSemanticLeadRefinementAttemptOrdinal,
  ] = useState(0);
  const [semanticLeadRefinementError, setSemanticLeadRefinementError] =
    useState<string | null>(null);
  const [
    activeRefinementEvidenceProjection,
    setActiveRefinementEvidenceProjection,
  ] = useState<BroadcastRefinementActiveRouteProjection | null>(null);
  const candidatePassBEvidenceRef = useRef<CandidatePassBEvidenceById>({});
  const candidateGeminiInsightRef = useRef<CandidateGeminiInsightById>({});
  const candidatePassBModelByIdRef = useRef<CandidatePassBModelById>({});
  const candidateTimelineFramesRef = useRef<CandidateTimelineFramesById>({});
  const candidatePassBVerificationReceiptRef =
    useRef<CandidatePassBVerificationReceiptById>({});
  const candidatePassBDispatchIntentRef = useRef<
    Readonly<Record<string, CandidatePassBDispatchIntent>>
  >({});
  const candidatePassBAttemptLedgerRef = useRef<
    Readonly<Record<string, CandidatePassBAttemptLedger>>
  >({});
  const candidatePassBSettlementRef = useRef<
    Readonly<Record<string, CandidatePassBTerminalSettlement>>
  >({});
  const candidatePassBInsightWriteChainRef = useRef<Promise<void>>(Promise.resolve());
  const candidatePassBInsightWriteEpochRef = useRef(0);
  const candidatePassBPendingInsightsRef =
    useRef<CandidatePassBInsightsRecord | null>(null);
  const candidatePassBInsightPersistenceFailureRef = useRef<unknown>(null);
  const candidatePassBPlanReceiptRef =
    useRef<CandidatePassBPlanReceipt | null>(null);
  const candidatePassBPlanPreparationRef = useRef<{
    operationKey: string | null;
    promise: Promise<CandidatePassBInsightsRecord> | null;
  }>({ operationKey: null, promise: null });
  const candidatePassBPlanRetryRef = useRef<{
    operationKey: string | null;
    attempts: number;
  }>({ operationKey: null, attempts: 0 });
  const candidatePassBPlanReplacementRequiredRef = useRef(false);
  const [candidatePassBPlanRetryEpoch, setCandidatePassBPlanRetryEpoch] =
    useState(0);
  const [candidatePassBDurableInsights, setCandidatePassBDurableInsights] =
    useState<CandidatePassBInsightsRecord | null>(null);
  /*
   * The visible state can be cleared while a same-run context retry replaces
   * its old Candidate Pass B snapshot with an empty one. Keep the last exact
   * durable readback separately so that replacement remains a CAS instead of
   * accidentally becoming an unconditional create/overwrite.
   */
  const candidatePassBDurableInsightsRef =
    useRef<CandidatePassBInsightsRecord | null>(null);
  const [
    candidatePassBInsightPersistenceStatus,
    setCandidatePassBInsightPersistenceStatus,
  ] = useState<"idle" | "pending" | "verified" | "failed">("idle");
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
  /**
   * 새 검토 화면의 페이지(요약 ⇄ 근거)와 확인 오버레이.
   * 위의 `dossierTab`(3탭)을 대체하며, 레거시 검토 섹션이 걷히면 그쪽이 사라진다.
   */
  const [reviewPage, setReviewPage] = useState<ReviewPage>("summary");
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  /** 근거 항목 이동은 화면이 자기 DOM 을 알아야 해서, 화면이 함수를 올려준다. */
  const reviewItemFocusMoverRef = useRef<((delta: 1 | -1) => void) | null>(null);
  /**
   * User-edited candidate titles. View-only — never persisted to IndexedDB or
   * exports beyond the current session's downloads; a refresh reverts to the
   * AI headline. Only exports read this map, so an empty entry always falls
   * back to the AI headline without changing any durable analysis artifact.
   */
  const [candidateTitleById, setCandidateTitleById] = useState<Record<string, string>>({});
  const [editingCandidateTitle, setEditingCandidateTitle] = useState(false);
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
  const channelPreanalysisConfirmationAbortController =
    useRef<AbortController | null>(null);
  const analysisAbortController = useRef<AbortController | null>(null);
  const candidatePassBAbortController = useRef<AbortController | null>(null);
  const broadcastTranscriptAbortController = useRef<AbortController | null>(null);
  const broadcastVisualInspectionAbortController =
    useRef<AbortController | null>(null);
  const broadcastContextAbortController = useRef<AbortController | null>(null);
  const semanticLeadRefinementAbortController = useRef<AbortController | null>(null);
  const candidateAudioEventAbortController = useRef<AbortController | null>(null);
  const analysisStartOperation = useRef<number | null>(null);
  const analysisOperationEpoch = useRef(0);
  const candidatePassBOperationEpoch = useRef(initialAiAttemptOrdinal());
  const candidatePassBStartPendingRef = useRef(false);
  const autoCandidatePassBSourceRef = useRef<string | null>(null);
  const candidatePassBAutoRetryRef = useRef<{
    operationKey: string | null;
    attempts: number;
    timeout: ReturnType<typeof globalThis.setTimeout> | null;
  }>({ operationKey: null, attempts: 0, timeout: null });
  const [candidatePassBAutoRetryEpoch, setCandidatePassBAutoRetryEpoch] =
    useState(0);
  const candidatePassBPersistenceAutoRetryRef = useRef<{
    runId: string | null;
    attempts: number;
  }>({ runId: null, attempts: 0 });
  const [
    candidatePassBPersistenceAutoRetryEpoch,
    setCandidatePassBPersistenceAutoRetryEpoch,
  ] = useState(0);
  const autoBroadcastTranscriptSourceRef = useRef<string | null>(null);
  const sealedBroadcastTranscriptSourceRef = useRef<string | null>(null);
  const autoBroadcastVisualInspectionSourceRef = useRef<string | null>(null);
  const allowAmbiguousTranscriptRetryRef = useRef(false);
  const broadcastTranscriptRouteChangeCountRef = useRef(0);
  const autoBroadcastContextSourceRef = useRef<string | null>(null);
  const autoSemanticLeadRefinementSourceRef = useRef<string | null>(null);
  const allowAmbiguousSemanticRefinementRetryRef = useRef(false);
  const semanticRefinementRouteChangeCountRef = useRef(0);
  const wholeContextRetryPendingRef = useRef(false);
  const recoveredContextRestoreEpoch = useRef(0);
  const runCandidatePassBRef = useRef<
    (targetCandidateIds?: readonly string[], autoStartKey?: string) => Promise<void>
  >(() => Promise.resolve());
  const retryWholeContextPhaseRef = useRef<
    (forceBoundary?: "transcript" | "context") => void
  >(() => undefined);
  const runSignalAnalysisRef = useRef<() => Promise<void>>(
    () => Promise.resolve(),
  );
  const retryCandidatePassBInsightPersistenceRef = useRef<
    () => Promise<boolean>
  >(() => Promise.resolve(false));
  const ensureCandidatePassBPlanPersistenceRef = useRef<
    (
      plannedCandidateIds?: readonly string[],
    ) => Promise<CandidatePassBInsightsRecord>
  >(() =>
    Promise.reject(
      new Error("Candidate Pass B plan persistence is not ready."),
    ),
  );
  const candidatePassBMachine = useRef<CandidatePassBRunState | null>(null);
  const candidatePassBIdentity = useRef<CandidatePassBWorkerIdentity | null>(null);
  const candidateAudioEventOperationEpoch = useRef(0);
  const candidateAudioEventStartPendingRef = useRef(false);
  const candidateAudioEventMachine = useRef<CandidateAudioEventRunState | null>(null);
  const candidateAudioEventIdentity = useRef<CandidateAudioEventWorkerIdentity | null>(null);
  const candidateRankingRevision = useRef(0);
  const recoveryOperationEpoch = useRef(0);
  const [appSessionId] = useState(() => createOperationId("session"));
  const [aiQuotaParticipantId] = useState(() =>
    getOrCreateAiQuotaParticipantId(),
  );
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

  // Follow the source's streamer: when the analysed source resolves to one
  // streamer, prefer their palette for the global accent; group/unknown sources
  // fall back to the base (soft rose). Accent tokens only — surfaces are left
  // on the app's own neutral scale.
  useEffect(() => {
    const root = document.documentElement;
    const vars = activeAccentCssVars(
      sourceCastRosterId,
      theme === "dark" ? "dark" : "light",
    );
    for (const [name, value] of Object.entries(vars)) {
      root.style.setProperty(name, value);
    }
  }, [sourceCastRosterId, theme]);

  useEffect(() => {
    document.documentElement.lang = analysisLanguage;
    try {
      globalThis.localStorage?.setItem("exclipper-language", analysisLanguage);
    } catch {
      // Keep the selected language for this tab when persistence is blocked.
    }
  }, [analysisLanguage]);

  useEffect(() => {
    if (sourceChzzkVideoNo === null) {
      setSourceChannelResolution(null);
      return undefined;
    }
    setSourceChannelResolution({
      videoNo: sourceChzzkVideoNo,
      status: "resolving",
      channelId: null,
    });
    const controller = new AbortController();
    void requestChzzkVideoChannel(sourceChzzkVideoNo, {
      signal: controller.signal,
    })
      .then((channelId) => {
        if (!controller.signal.aborted) {
          setSourceChannelResolution({
            videoNo: sourceChzzkVideoNo,
            status: "resolved",
            channelId,
          });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setSourceChannelResolution({
            videoNo: sourceChzzkVideoNo,
            status: "failed",
            channelId: null,
          });
        }
      });
    return () => controller.abort();
  }, [sourceChzzkVideoNo]);

  useEffect(
    () => {
      isMounted.current = true;
      const candidatePassBAutoRetry = candidatePassBAutoRetryRef.current;
      return () => {
        isMounted.current = false;
        sourceSelectionEpoch.current += 1;
        chatSelectionEpoch.current += 1;
        analysisOperationEpoch.current += 1;
        recoveryOperationEpoch.current += 1;
        sourceAbortController.current?.abort();
        sourceAbortController.current = null;
        channelPreanalysisConfirmationAbortController.current?.abort();
        channelPreanalysisConfirmationAbortController.current = null;
        preparedChannelReviewAbortController.current?.abort();
        preparedChannelReviewAbortController.current = null;
        analysisAbortController.current?.abort();
        analysisAbortController.current = null;
        candidatePassBOperationEpoch.current += 1;
        candidatePassBAbortController.current?.abort();
        candidatePassBAbortController.current = null;
        if (candidatePassBAutoRetry.timeout !== null) {
          globalThis.clearTimeout(candidatePassBAutoRetry.timeout);
          candidatePassBAutoRetry.timeout = null;
        }
        broadcastTranscriptAbortController.current?.abort();
        broadcastTranscriptAbortController.current = null;
        broadcastVisualInspectionAbortController.current?.abort();
        broadcastVisualInspectionAbortController.current = null;
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

  const replaceSourceFile = useCallback((
    file: File | null,
    options: { readonly preserveAnalysisArtifacts?: boolean } = {},
  ): void => {
    if (!isMounted.current) {
      return;
    }
    clipRenderAbortController.current?.abort();
    clipRenderAbortController.current = null;
    if (options.preserveAnalysisArtifacts !== true) {
      candidateTimelineFramesRef.current = {};
      setCandidateTimelineFramesById({});
      candidatePassBVerificationReceiptRef.current = {};
      candidatePassBDispatchIntentRef.current = {};
      candidatePassBAttemptLedgerRef.current = {};
      candidatePassBSettlementRef.current = {};
      setCandidatePassBVerificationReceiptById({});
      setCandidateTimelineScorePoints([]);
      setTimelineSemanticChapters([]);
      setTimelineSemanticChapterRevealCount(0);
      setTimelineInspectionTarget(null);
      setBroadcastTranscriptExplorationCells([]);
      setYouTubeCaptionTrack(null);
      youtubeCaptionTrackRef.current = null;
    }
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
  useEffect(() => {
    const requestedVideoId = youtubeVideoIdFromUserInput(manualVodInput);
    if (
      !sourceReady ||
      requestedVideoId === null ||
      sourceFile === null ||
      preflight === null ||
      sourceContentFingerprint === null ||
      analysisStartOperation.current !== null
    ) {
      return;
    }

    const lookupKey = `${sourceContentFingerprint}:${requestedVideoId}`;
    if (channelPreanalysisManualLookupKeyRef.current === lookupKey) {
      return;
    }
    channelPreanalysisManualLookupKeyRef.current = lookupKey;
    channelPreanalysisConfirmationAbortController.current?.abort();
    const controller = new AbortController();
    channelPreanalysisConfirmationAbortController.current = controller;
    const selectionEpoch = sourceSelectionEpoch.current;
    const analysisEpoch = analysisOperationEpoch.current;
    const sourceName = sourceFile.name;
    const sourceDurationMs = preflight.metadata.durationMs;
    const sourceFingerprint = sourceContentFingerprint;
    const recoveryCaptionVideoId =
      openedRecoveredResult?.finalResult.result.input.source.captionVideoId ??
      null;
    let settled = false;
    const operationIsCurrent = (): boolean =>
      isMounted.current &&
      !controller.signal.aborted &&
      sourceSelectionEpoch.current === selectionEpoch &&
      analysisOperationEpoch.current === analysisEpoch &&
      analysisStartOperation.current === null &&
      youtubeVideoIdFromUserInput(manualVodInputRef.current) ===
        requestedVideoId;

    setChannelPreanalysisConfirmationPending(true);
    channelPreanalysisBundleBindingRef.current = null;
    replaceChannelPreanalysisConnection({ status: "checking" });
    void requestChannelPreanalysisMatchForSource(
      {
        videoId: requestedVideoId,
        title: sourceName,
        durationMs: sourceDurationMs,
        localSampledFingerprint: sourceFingerprint,
      },
      controller.signal,
    )
      .then((search) => {
        if (!operationIsCurrent()) return;
        const lookup = search.primaryLookup;
        if (
          search.selection !== "exact" ||
          lookup.match.confidence !== "exact" ||
          lookup.match.match?.videoId !== requestedVideoId
        ) {
          replaceChannelPreanalysisConnection({ status: "not-found" });
          return;
        }
        const timelineStatus = classifyChannelPreanalysisTimeline(
          lookup.match.match.durationMs,
          sourceDurationMs,
        );
        if (timelineStatus === "incompatible") {
          replaceChannelPreanalysisConnection({
            status: "incompatible",
            lookup,
            timelineStatus,
          });
          return;
        }
        const attachment =
          openedRecoveredResult === null ||
          recoveryCaptionVideoId === requestedVideoId
            ? "current-run"
            : "future-run-only";
        if (timelineStatus === "compatible") {
          const bindingSource = channelPreanalysisSourceForManifest(
            lookup.manifest,
          );
          if (
            bindingSource !== null &&
            registerChannelPreanalysisLocalBinding({
              localSampledFingerprint: sourceFingerprint,
              sourceId: bindingSource.sourceId,
              channelId: bindingSource.channelId,
              videoId: requestedVideoId,
            }) !== null
          ) {
            setChannelPreanalysisLocalBindingRevision((revision) => revision + 1);
          }
        }
        channelPreanalysisBundleBindingRef.current =
          attachment !== "current-run" || timelineStatus !== "compatible"
            ? null
            : createChannelPreanalysisVerifiedBundleBinding(
                sourceFingerprint,
                lookup,
              );
        const verifiedBinding = channelPreanalysisBundleBindingRef.current;
        if (verifiedBinding !== null) {
          youtubeCaptionTrackRef.current = verifiedBinding.bundle.captionTrack;
          setYouTubeCaptionTrack(verifiedBinding.bundle.captionTrack);
        }
        replaceChannelPreanalysisConnection({
          status: "connected",
          lookup,
          basis: "manual-pasted",
          attachment,
          timelineStatus,
        });
      })
      .catch(() => {
        if (operationIsCurrent()) {
          replaceChannelPreanalysisConnection({ status: "unavailable" });
        }
      })
      .finally(() => {
        settled = true;
        if (channelPreanalysisConfirmationAbortController.current === controller) {
          channelPreanalysisConfirmationAbortController.current = null;
        }
        if (operationIsCurrent()) {
          setChannelPreanalysisConfirmationPending(false);
        }
      });

    return () => {
      if (channelPreanalysisConfirmationAbortController.current === controller) {
        controller.abort();
        channelPreanalysisConfirmationAbortController.current = null;
      }
      if (
        !settled &&
        channelPreanalysisManualLookupKeyRef.current === lookupKey
      ) {
        channelPreanalysisManualLookupKeyRef.current = null;
      }
    };
  }, [
    manualVodInput,
    openedRecoveredResult,
    preflight,
    replaceChannelPreanalysisConnection,
    sourceContentFingerprint,
    sourceFile,
    sourceReady,
  ]);
  const sourceReadyTimelineTicks = useMemo(
    () => buildSourceReadyTimelineTicks(preflight?.metadata.durationMs ?? 0),
    [preflight?.metadata.durationMs],
  );
  const analysisComplete =
    (openedRecoveredResult !== null &&
      pipelineCertification.status === "succeeded") ||
    analysisRun?.status === "completed" ||
    analysisRun?.status === "completedWithGaps";
  const { analysisBusy, analysisCanBeCancelled } = deriveAnalysisControlState({
    analysisStartPending,
    analysisCancelPending,
    analysisCommitPending,
    runStatus: analysisRun?.status ?? null,
  });
  const preparedReviewLookupFromLocal =
    sourceReady &&
    channelPreanalysisConnection.status === "connected" &&
    channelPreanalysisConnection.attachment === "current-run" &&
    channelPreanalysisConnection.timelineStatus === "compatible" &&
    channelPreanalysisIdentityBasisAuthorizesPreparedData(
      channelPreanalysisConnection.basis,
    )
      ? channelPreanalysisConnection.lookup
      : null;
  const preparedReviewRequestedVideoId =
    preparedReviewLookupFromLocal?.match.match?.videoId ??
    (sourceFile === null && pendingFileName === null
      ? youtubeVideoIdFromUserInput(manualVodInput)
      : null);
  const preparedReviewRequestKey =
    preparedReviewRequestedVideoId === null
      ? null
      : preparedReviewLookupFromLocal === null
        ? `youtube:${preparedReviewRequestedVideoId}`
        : [
            "local",
            sourceContentFingerprint ?? "unknown",
            preparedReviewLookupFromLocal.manifest.channelId,
            preparedReviewLookupFromLocal.manifest.revision,
            preparedReviewRequestedVideoId,
          ].join(":");

  useEffect(() => {
    const mayOpenPreparedReview =
      preparedReviewRequestKey !== null &&
      preparedReviewRequestedVideoId !== null &&
      openedRecoveredResult === null &&
      analysisRun === null &&
      !analysisBusy &&
      analysisStartOperation.current === null;
    if (!mayOpenPreparedReview) {
      preparedChannelReviewAbortController.current?.abort();
      preparedChannelReviewAbortController.current = null;
      setPreparedChannelReview({ status: "idle" });
      return;
    }
    if (
      dismissedPreparedChannelReviewKeyRef.current ===
      preparedReviewRequestKey
    ) {
      setPreparedChannelReview({ status: "dismissed" });
      return;
    }

    preparedChannelReviewAbortController.current?.abort();
    const controller = new AbortController();
    preparedChannelReviewAbortController.current = controller;
    setPreparedChannelReview({ status: "checking" });

    void (async () => {
      const lookup =
        preparedReviewLookupFromLocal ??
        (
          await requestConfiguredChannelPreanalysisMatch(
            { videoId: preparedReviewRequestedVideoId },
            { signal: controller.signal },
          )
        ).primaryLookup;
      if (
        lookup.match.confidence !== "exact" ||
        lookup.match.match?.videoId !== preparedReviewRequestedVideoId
      ) {
        if (!controller.signal.aborted) {
          setPreparedChannelReview({
            status: "preparing",
            videoId: preparedReviewRequestedVideoId,
            title: lookup.match.match?.title ?? null,
          });
        }
        return;
      }
      const loaded = await fetchChannelPreanalysisReviewForLookup(lookup, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (loaded === null) {
        setPreparedChannelReview({
          status: "preparing",
          videoId: preparedReviewRequestedVideoId,
          title: lookup.match.match.title,
        });
        return;
      }
      setPreparedChannelReview({
        status: "ready",
        videoId: preparedReviewRequestedVideoId,
        title: lookup.match.match.title,
        lookup,
        loaded,
      });
    })().catch(() => {
      if (!controller.signal.aborted) {
        setPreparedChannelReview({
          status: "unavailable",
          videoId: preparedReviewRequestedVideoId,
          title: preparedReviewLookupFromLocal?.match.match?.title ?? null,
        });
      }
    }).finally(() => {
      if (preparedChannelReviewAbortController.current === controller) {
        preparedChannelReviewAbortController.current = null;
      }
    });

    return () => controller.abort();
  }, [
    analysisBusy,
    analysisRun,
    openedRecoveredResult,
    preparedChannelReviewRetryEpoch,
    preparedReviewLookupFromLocal,
    preparedReviewRequestKey,
    preparedReviewRequestedVideoId,
  ]);
  useEffect(() => {
    if (
      preparedReviewRequestKey === null ||
      !["preparing", "unavailable"].includes(preparedChannelReview.status)
    ) {
      return;
    }
    const timer = globalThis.setTimeout(() => {
      setPreparedChannelReviewRetryEpoch((current) => current + 1);
    }, PREPARED_CHANNEL_REVIEW_POLL_INTERVAL_MS);
    return () => globalThis.clearTimeout(timer);
  }, [preparedChannelReview.status, preparedReviewRequestKey]);
  useEffect(() => {
    if (!analysisBusy) {
      analysisStartedAtMsRef.current = null;
      setProgressClockNowMs(null);
      setShownRemainingMs(null);
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
  const candidatePassBEnvelopeFailed =
    candidatePassBRun?.status === "failed" ||
    candidatePassBRun?.status === "cancelled";
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
  const currentAnalysisInputSignature =
    openedRecoveredResult?.terminal.inputSignature ??
    analysisRun?.inputSignature ??
    null;
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
  /*
   * Review decisions are editor work, not analysis input. Keep the discovered
   * cohort stable so approving or rejecting a card cannot change the paid
   * detail plan or make that card disappear from the review list.
   */
  const pipelineCandidates = useMemo(
    () => freezeAnalysisCandidateCohort(candidates),
    [candidates],
  );
  const broadcastContextCandidateCohort = useMemo(
    () =>
      selectBroadcastContextCandidateCohort(
        pipelineCandidates.filter(
          (candidate) => !isContextDiscoveredCandidate(candidate),
        ),
      ),
    [pipelineCandidates],
  );
  const broadcastContextCandidateIdSet = useMemo(
    () => new Set(broadcastContextCandidateCohort.map(({ id }) => id)),
    [broadcastContextCandidateCohort],
  );
  const semanticRefinementPlan = useMemo(() => {
    if (
      broadcastContextResult === null ||
      broadcastContextRefinementLeadIds === null
    ) {
      return null;
    }
    const leadById = new Map(
      broadcastContextResult.discoveredLeads.map((lead) => [
        lead.leadId,
        lead,
      ]),
    );
    const refinementLeads =
      broadcastContextRefinementLeadIds.flatMap((leadId) => {
        const lead = leadById.get(leadId);
        return lead === undefined ? [] : [lead];
      });
    return createDiscoveredLeadRefinementPlan(refinementLeads, {
      preserveInputOrder: true,
    });
  }, [broadcastContextRefinementLeadIds, broadcastContextResult]);
  const semanticRefinementEvidenceRequired =
    (semanticRefinementPlan?.selectedLeadIds.length ?? 0) > 0;
  const semanticRefinementEvidenceProjectionFingerprint =
    activeRefinementEvidenceProjection?.projectionFingerprint ?? null;
  const semanticRefinementEvidencePublicationEligible =
    activeRefinementEvidenceProjection?.publicationEligible === true;
  const contextExcludedCandidateIds = useMemo(
    () =>
      new Set(
        selectContextExcludedCandidateIds(
          pipelineCandidates,
          candidateAiProjectionById,
        ),
      ),
    [candidateAiProjectionById, pipelineCandidates],
  );
  const computedCandidatePassBContextById = useMemo(
    () =>
      broadcastContextStatus === "completed" &&
      semanticLeadRefinementStatus === "completed"
        ? buildCandidatePassBContextPackets({
            candidates: pipelineCandidates,
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
      pipelineCandidates,
      semanticLeadRefinementStatus,
      youtubeCaptionTrack,
    ],
  );
  const candidatePassBContextById = useMemo(
    () =>
      selectEffectiveCandidatePassBContextById({
        computedContextByCandidateId: computedCandidatePassBContextById,
        durableRecord: candidatePassBDurableInsights,
        runId: currentAnalysisRunId,
        inputSignature: currentAnalysisInputSignature,
        refinementEvidenceProjectionFingerprint:
          semanticRefinementEvidenceProjectionFingerprint,
      }),
    [
      candidatePassBDurableInsights,
      computedCandidatePassBContextById,
      currentAnalysisInputSignature,
      currentAnalysisRunId,
      semanticRefinementEvidenceProjectionFingerprint,
    ],
  );
  const candidateDetailCandidateIds = useMemo(
    () => {
      const queuedCandidateIds = new Set(
        selectCandidateDetailCandidateIds(
          pipelineCandidates,
          candidateAiProjectionById,
        ),
      );
      return pipelineCandidates
        .filter(
          (candidate) =>
            queuedCandidateIds.has(candidate.id) &&
            candidatePassBContextById[candidate.id] !== undefined,
        )
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.peakMs - right.peakMs ||
            left.id.localeCompare(right.id),
        )
        .map(({ id }) => id);
    },
    [
      candidateAiProjectionById,
      candidatePassBContextById,
      pipelineCandidates,
    ],
  );
  const candidateDetailCandidateIdSet = useMemo(
    () => new Set(candidateDetailCandidateIds),
    [candidateDetailCandidateIds],
  );
  const candidatePassBSourceFenceById: Readonly<
    Record<string, CandidatePassBVerificationSourceFence>
  > = useMemo(
    () =>
      Object.fromEntries(
        pipelineCandidates.map(({ id, startMs, endMs }) => [
          id,
          {
            candidateId: id,
            sourceStartMs: startMs,
            sourceEndMs: endMs,
            routingModelRevision: CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
            refinementEvidenceProjectionFingerprint:
              semanticRefinementEvidenceProjectionFingerprint,
            outputLanguage: analysisLanguage,
            castRosterId: sourceCastRosterId,
          },
        ]),
      ),
    [
      analysisLanguage,
      pipelineCandidates,
      semanticRefinementEvidenceProjectionFingerprint,
      sourceCastRosterId,
    ],
  );
  const candidatePassBAutomaticTargets = useMemo(() => {
    const durableRecord = candidatePassBDurableInsights;
    return selectCandidatePassBAutomaticTargets({
      candidateIds: candidateDetailCandidateIds,
      attemptLedgerByCandidateId:
        durableRecord?.attemptLedgerByCandidateId ?? {},
      dispatchIntentByCandidateId:
        durableRecord?.dispatchIntentByCandidateId ?? {},
      settlementByCandidateId:
        durableRecord?.settlementByCandidateId ?? {},
    });
  }, [
    candidateDetailCandidateIds,
    candidatePassBDurableInsights,
  ]);
  const automaticCandidateDetailIds = useMemo(
    () =>
      candidatePassBAutomaticTargets.map(({ candidateId }) => candidateId),
    [candidatePassBAutomaticTargets],
  );
  const candidatePassBDurabilityOutstandingIds = useMemo(
    () =>
      selectCandidatePassBDurabilityOutstandingIds({
        candidateIds: candidateDetailCandidateIds,
        record: candidatePassBDurableInsights,
        contextByCandidateId: candidatePassBContextById,
        sourceFenceByCandidateId: candidatePassBSourceFenceById,
      }),
    [
      candidateDetailCandidateIds,
      candidatePassBContextById,
      candidatePassBDurableInsights,
      candidatePassBSourceFenceById,
    ],
  );
  const candidatePassBDurableIds = useMemo(
    () =>
      selectCandidatePassBDurableIds({
        candidateIds: candidateDetailCandidateIds,
        record: candidatePassBDurableInsights,
        contextByCandidateId: candidatePassBContextById,
        sourceFenceByCandidateId: candidatePassBSourceFenceById,
      }),
    [
      candidateDetailCandidateIds,
      candidatePassBContextById,
      candidatePassBDurableInsights,
      candidatePassBSourceFenceById,
    ],
  );
  const candidateDetailPipelineOutstandingIds = useMemo(
    () =>
      [...new Set([
        ...automaticCandidateDetailIds,
        ...candidatePassBDurabilityOutstandingIds,
      ])],
    [automaticCandidateDetailIds, candidatePassBDurabilityOutstandingIds],
  );
  const candidatePassBPersistenceRetryNeeded =
    candidatePassBInsightPersistenceStatus === "failed" &&
    candidatePassBDurabilityOutstandingIds.length > 0;
  const candidatePassBRetryableIds = useMemo(
    () =>
      candidateDetailCandidateIds.filter((candidateId) => {
        const ledger =
          candidatePassBDurableInsights?.attemptLedgerByCandidateId[
            candidateId
          ];
        if (ledger === undefined) return false;
        const state = candidatePassBAttemptLedgerState(ledger);
        return state === "blocked" || state === "retry-granted";
      }),
    [candidateDetailCandidateIds, candidatePassBDurableInsights],
  );
  const candidatePassBActionIds = selectCandidateDetailActionIds({
    candidateIds: candidateDetailCandidateIds,
    outstandingIds: automaticCandidateDetailIds,
    retryableIds: candidatePassBRetryableIds,
    runStatus: candidatePassBRun?.status ?? null,
  });
  const candidatePassBNeedsRecovery =
    (candidatePassBEnvelopeFailed &&
      candidateDetailPipelineOutstandingIds.length > 0) ||
    candidatePassBPersistenceRetryNeeded;
  const finalVerificationCandidates = useMemo(
    () =>
      selectCandidateVerificationCohort({
        candidates: pipelineCandidates,
        contextScheduledCandidateIds: broadcastContextCandidateIdSet,
        contextExcludedCandidateIds,
        detailScheduledCandidateIds: candidateDetailCandidateIdSet,
        contextByCandidateId: candidatePassBContextById,
      }),
    [
      broadcastContextCandidateIdSet,
      candidateDetailCandidateIdSet,
      candidatePassBContextById,
      contextExcludedCandidateIds,
      pipelineCandidates,
    ],
  );
  const finalCandidateVerification = useMemo(
    () =>
      finalizeFullyVerifiedCandidates({
        candidates: finalVerificationCandidates,
        contextExcludedCandidateIds,
        contextByCandidateId: candidatePassBContextById,
        insightByCandidateId: candidatePassBDurableInsights?.insightById ?? {},
        receiptByCandidateId:
          candidatePassBDurableInsights?.verificationReceiptById ?? {},
        completeEvidenceCandidateIds: candidatePassBDurableIds,
        refinementEvidenceProjectionFingerprint:
          semanticRefinementEvidenceProjectionFingerprint,
        outputLanguage: analysisLanguage,
        castRosterId: sourceCastRosterId,
      }),
    [
      candidatePassBContextById,
      candidatePassBDurableIds,
      candidatePassBDurableInsights,
      contextExcludedCandidateIds,
      finalVerificationCandidates,
      analysisLanguage,
      semanticRefinementEvidenceProjectionFingerprint,
      sourceCastRosterId,
    ],
  );
  const orderedCandidates = useMemo(
    () =>
      projectVerifiedReviewCandidates(
        candidates,
        new Set(finalCandidateVerification.candidates.map(({ id }) => id)),
      ),
    [candidates, finalCandidateVerification.candidates],
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

  /**
   * 검토 화면 레일 최상단의 인물. 팔레트와 같은 신호(어느 스트리머의 방송인가)를
   * 쓰므로 색과 얼굴이 항상 같은 사람을 가리킨다.
   */
  const reviewStreamerName = useMemo(() => {
    const paletteId = paletteIdForCastRosterId(sourceCastRosterId);
    return (
      STREAMER_PALETTE_SEEDS.find(({ id }) => id === paletteId)?.name ?? "교환학생"
    );
  }, [sourceCastRosterId]);
  const reviewStreamerImageUrl = STREAMER_PROFILE_IMAGE_BY_NAME[reviewStreamerName];

  /**
   * 검토 화면이 받는 뷰모델. 분석 결과를 화면 어휘로 옮기는 일은 전부
   * `buildReviewCandidates` 한 곳에서만 일어나므로, 화면은 분석 타입을 모른다.
   */
  const reviewViewCandidates = useMemo(
    () =>
      buildReviewCandidates({
        candidates: orderedCandidates.map((candidate) => {
          const revision = boundaryRevisions[candidate.id] ?? null;
          const range = effectiveCandidateRange(candidate, revision);
          return {
            id: candidate.id,
            startMs: range.startMs,
            endMs: range.endMs,
            peakMs: candidate.peakMs,
          };
        }),
        insightById: candidateGeminiInsightById,
        contextById: candidatePassBContextById,
        cuesById: Object.fromEntries(
          orderedCandidates.map((candidate) => [
            candidate.id,
            buildCandidatePassBPresentation(
              candidate.id,
              buildHighlightNarrative(candidate),
              candidatePassBEvidenceById[candidate.id]?.candidateId === candidate.id
                ? candidatePassBEvidenceById[candidate.id]
                : undefined,
            ).cues,
          ]),
        ),
        framesById: candidateTimelineFramesById,
        decisionById: Object.fromEntries(
          orderedCandidates.map((candidate) => [
            candidate.id,
            decisionForReviewState(candidate.reviewState),
          ]),
        ),
        titleById: candidateTitleById,
        profileImageByName: STREAMER_PROFILE_IMAGE_BY_NAME,
      }),
    [
      boundaryRevisions,
      candidateGeminiInsightById,
      candidatePassBContextById,
      candidatePassBEvidenceById,
      candidateTimelineFramesById,
      candidateTitleById,
      orderedCandidates,
    ],
  );
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
  const boundedBroadcastContextChapters = useMemo(
    () => compactBroadcastContextChapters(broadcastTranscriptChapters),
    [broadcastTranscriptChapters],
  );
  const boundedBroadcastTranscriptDialogueChapters = useMemo(() => {
    const visualChapterIds = new Set(
      broadcastVisualInspectionProjection?.chapters.map(
        ({ chapterId }) => chapterId,
      ) ?? [],
    );
    return compactBroadcastContextChapters(
      broadcastTranscriptChapters.filter(
        ({ chapterId }) => !visualChapterIds.has(chapterId),
      ),
    );
  }, [
    broadcastTranscriptChapters,
    broadcastVisualInspectionProjection,
  ]);
  const baselineBroadcastParticipantGrounding = useMemo(
    () =>
      createBroadcastParticipantGrounding({
        sourceDurationMs: boundarySourceDurationMs,
        castRosterId: sourceCastRosterId,
        chapters: boundedBroadcastTranscriptDialogueChapters,
      }),
    [
      boundarySourceDurationMs,
      boundedBroadcastTranscriptDialogueChapters,
      sourceCastRosterId,
    ],
  );
  useEffect(() => {
    const runId = currentAnalysisRunId;
    const inputSignature = currentAnalysisInputSignature;
    const transcriptSeal =
      broadcastTranscriptStatus === "completed"
        ? sealedBroadcastTranscriptSourceRef.current
        : null;
    if (
      !analysisComplete ||
      runId === null ||
      inputSignature === null ||
      transcriptSeal === null ||
      sourceContentFingerprint === null ||
      boundarySourceDurationMs <= 0
    ) {
      return;
    }

    const sourceFileFence =
      sourceFile === null
        ? "source-detached"
        : `${sourceContentFingerprint}:${sourceFile.size}:${boundarySourceDurationMs}`;
    const operationKey =
      `${runId}:${inputSignature}:${transcriptSeal}` +
      `:visual-attempt-${broadcastVisualInspectionAttemptOrdinal}` +
      `:${sourceFileFence}`;
    if (autoBroadcastVisualInspectionSourceRef.current === operationKey) {
      return;
    }
    autoBroadcastVisualInspectionSourceRef.current = operationKey;
    broadcastVisualInspectionAbortController.current?.abort();
    const controller = new AbortController();
    let automaticRetryTimeout: ReturnType<typeof globalThis.setTimeout> | null =
      null;
    broadcastVisualInspectionAbortController.current = controller;
    const operationIsCurrent = (): boolean =>
      isMounted.current &&
      !controller.signal.aborted &&
      broadcastVisualInspectionAbortController.current === controller &&
      autoBroadcastVisualInspectionSourceRef.current === operationKey;

    setBroadcastVisualInspectionStatus("preparing");
    setBroadcastVisualInspectionError(null);
    void runDurableBroadcastVisualInspectionPhase({
      store: getResultStore(),
      runId,
      inputSignature,
      operationToken: operationKey,
      transcriptSeal,
      sourceDurationMs: boundarySourceDurationMs,
      sourceFile,
      participantId: aiQuotaParticipantId,
      castRosterId: sourceCastRosterId,
      outputLanguage: analysisLanguage,
      signal: controller.signal,
      isCurrent: operationIsCurrent,
      onProgress: (progress) => {
        if (!operationIsCurrent()) return;
        setBroadcastVisualInspectionStatus(progress.status);
        setBroadcastVisualInspectionPlannedCellCount(
          progress.plannedCellCount,
        );
        setBroadcastVisualInspectionPreparedCellCount(
          progress.preparedCellCount,
        );
        setBroadcastVisualInspectionSettledCellCount(
          progress.settledCellCount,
        );
        setBroadcastVisualInspectionProjection(progress.projection);
        setBroadcastTranscriptChapters(progress.chapters);
      },
    })
      .then((result) => {
        if (!operationIsCurrent()) return;
        setBroadcastVisualInspectionProjection(result.projection);
        setBroadcastVisualInspectionPlannedCellCount(
          result.plan.cells.length,
        );
        setBroadcastVisualInspectionPreparedCellCount(
          result.projection?.runnerCheckpoint.preparedFrameReceipts.length ??
            0,
        );
        setBroadcastVisualInspectionSettledCellCount(
          result.projection === null
            ? 0
            : result.projection.publication.completedCellIds.length +
                result.projection.publication.excludedMusicOnlyCellIds.length,
        );
        setBroadcastTranscriptChapters(result.session.chapters);
        if (result.status === "completed") {
          setBroadcastVisualInspectionStatus("completed");
          setBroadcastVisualInspectionError(null);
          return;
        }
        setBroadcastVisualInspectionStatus("blocked");
        if (result.reason === "source-file-required") {
          setBroadcastVisualInspectionError(
            analysisLanguage === "ko"
              ? "저장된 화면 분석을 이어가려면 같은 방송 원본을 다시 연결해 주세요."
              : "Reconnect the same broadcast source to resume the saved visual analysis.",
          );
          return;
        }
        const retryDelayMs = Math.min(
          30_000,
          1_000 *
            2 ** Math.min(broadcastVisualInspectionAttemptOrdinal, 5),
        );
        setBroadcastVisualInspectionError(
          analysisLanguage === "ko"
            ? `완료한 화면 근거는 보존했어요. 남은 조각은 ${Math.ceil(retryDelayMs / 1_000)}초 뒤 자동으로 이어서 분석합니다.`
            : `Completed visual evidence is preserved. Remaining pieces resume automatically in ${Math.ceil(retryDelayMs / 1_000)} seconds.`,
        );
        automaticRetryTimeout = globalThis.setTimeout(() => {
          automaticRetryTimeout = null;
          if (!operationIsCurrent()) return;
          setBroadcastVisualInspectionStatus("preparing");
          setBroadcastVisualInspectionError(null);
          setBroadcastVisualInspectionAttemptOrdinal(
            (current) => current + 1,
          );
        }, retryDelayMs);
      })
      .catch((error: unknown) => {
        if (
          !operationIsCurrent() ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        setBroadcastVisualInspectionStatus("failed");
        setBroadcastVisualInspectionError(
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : analysisLanguage === "ko"
              ? "화면 증거 단계를 검증하지 못했습니다."
              : "The visual-evidence phase could not be verified.",
        );
      });

    return () => {
      if (broadcastVisualInspectionAbortController.current === controller) {
        controller.abort();
        broadcastVisualInspectionAbortController.current = null;
      }
      if (automaticRetryTimeout !== null) {
        globalThis.clearTimeout(automaticRetryTimeout);
      }
    };
  }, [
    aiQuotaParticipantId,
    analysisComplete,
    analysisLanguage,
    boundarySourceDurationMs,
    broadcastTranscriptStatus,
    broadcastVisualInspectionAttemptOrdinal,
    currentAnalysisInputSignature,
    currentAnalysisRunId,
    getResultStore,
    sourceCastRosterId,
    sourceContentFingerprint,
    sourceFile,
  ]);
  useEffect(() => {
    const transcriptSeal = sealedBroadcastTranscriptSourceRef.current;
    const inputSignature = currentAnalysisInputSignature;
    if (
      broadcastTranscriptStatus !== "completed" ||
      broadcastVisualInspectionStatus !== "completed" ||
      transcriptSeal === null ||
      currentAnalysisRunId === null ||
      inputSignature === null ||
      boundarySourceDurationMs <= 0
    ) {
      setBroadcastParticipantPreContext(null);
      return;
    }

    let active = true;
    setBroadcastParticipantPreContext(null);
    void (async () => {
      const session = await getResultStore().getBroadcastContextSession(
        currentAnalysisRunId,
      );
      if (
        session === null ||
        session.transcriptSealOperationKey !== transcriptSeal ||
        session.sourceDurationMs !== boundarySourceDurationMs ||
        session.inputSignature !== inputSignature
      ) {
        throw new Error(
          analysisLanguage === "ko"
            ? "등장인물 맥락에 연결할 전사 결과를 다시 확인하지 못했어요."
          : "The transcript result for participant context could not be verified.",
        );
      }
      const { transcriptChapters } =
        partitionBroadcastContextSessionChapters(session);
      const restored =
        await restoreBroadcastParticipantPreContextCheckpoint(session);
      if (restored !== null) {
        return restored;
      }
      if (
        session.participantGroundingInputSignature !== null ||
        session.participantGroundingPlanFingerprint !== null ||
        session.participantGroundingCheckpointJson !== null
      ) {
        throw new Error(
          analysisLanguage === "ko"
            ? "저장된 등장인물 근거 묶음이 현재 화면·대사와 일치하지 않아요."
            : "The saved participant evidence packet does not match the current frames and dialogue.",
        );
      }

      const visualProjection = broadcastVisualInspectionProjection;
      if (
        visualProjection !== null &&
        (!visualProjection.publication.publicationReady ||
          visualProjection.plan.sourceFence.sourceFingerprint !==
            inputSignature ||
          visualProjection.plan.sourceFence.sourceDurationMs !==
            boundarySourceDurationMs)
      ) {
        throw new Error(
          analysisLanguage === "ko"
            ? "화면 증거가 모두 준비되고 저장되기 전에는 등장인물을 판정할 수 없어요."
            : "Participant grounding cannot start before every visual evidence cell is prepared and saved.",
        );
      }
      const prepared = await prepareBroadcastParticipantPreContext({
        sourceFingerprint: session.inputSignature,
        sourceDurationMs: boundarySourceDurationMs,
        transcriptSeal,
        castRosterId: sourceCastRosterId,
        dialogueChapters: compactBroadcastContextChapters(
          transcriptChapters,
        ),
        transcriptModelRevision: session.modelRevision,
        /*
         * The roster is text metadata, not a cast-image reference bundle.
         * Visual inspection may still use on-screen names, but appearance
         * matching remains disabled until real reference media is persisted.
         */
        visualReferenceManifest: null,
        visualRuntime:
          visualProjection === null
            ? null
            : {
                adapterRevision:
                  "broadcast-transcript-visual-identity-current",
                modelRevision:
                  BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_MODEL_REVISION,
                cells: visualProjection.plan.cells.map((cell) => ({
                  sourceStartMs: cell.sourceStartMs,
                  sourceEndMs: cell.sourceEndMs,
                  sourceUnitId: cell.cellId,
                  frameTimestampsMs: cell.frameTimestampsMs,
                })),
              },
      });
      const visualAdapter = prepared.plan.adapters.find(
        ({ adapter }) => adapter === "visual-identity",
      );
      const visualTerminalReceipts =
        visualProjection === null ||
        visualAdapter === undefined ||
        visualAdapter.availability !== "enabled"
          ? []
          : visualAdapter.cells.map((participantCell) => {
              const settlement =
                visualProjection.runnerCheckpoint.providerLedger.settlements.find(
                  (candidate) =>
                    candidate.cellId === participantCell.sourceUnitId &&
                    (candidate.outcome === "completed" ||
                      candidate.outcome === "excluded-music-only"),
                );
              if (settlement === undefined) {
                throw new Error(
                  `The terminal participant settlement is missing for ${participantCell.sourceUnitId ?? participantCell.cellId}.`,
                );
              }
              return createBroadcastParticipantVisualTerminalReceiptFromSettlement(
                {
                  participantPlan: prepared.plan,
                  participantCellId: participantCell.cellId,
                  visualInspectionPlan: visualProjection.plan,
                  settlement,
                },
              );
            });
      const unavailableMediaReceipts = prepared.plan.adapters.flatMap(
        (adapter) =>
          adapter.adapter === "transcript-names" ||
          adapter.availability !== "unavailable" ||
          prepared.plan.expectedParticipantIds.length === 0
            ? []
            : [
                createBroadcastParticipantGroundingNoneObservedReceipt({
                  plan: prepared.plan,
                  adapter: adapter.adapter,
                  operationId:
                    `pre-context.${adapter.adapter}.none-observed`,
                  attemptOrdinal: 0,
                }),
              ],
      );
      return completeBroadcastParticipantPreContext(prepared, {
        visualTerminalReceipts,
        visualNoneObservedReceipt: unavailableMediaReceipts.find(
          ({ adapter }) => adapter === "visual-identity",
        ),
        voiceNoneObservedReceipt: unavailableMediaReceipts.find(
          ({ adapter }) => adapter === "voice-identity",
        ),
      });
    })()
      .then((result) => {
        if (active) setBroadcastParticipantPreContext(result);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setBroadcastContextStatus("failed");
        setBroadcastContextError(
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : analysisLanguage === "ko"
              ? "방송 맥락 분석 전에 등장인물 근거를 준비하지 못했어요."
              : "Participant evidence could not be prepared before broadcast context analysis.",
        );
      });
    return () => {
      active = false;
    };
  }, [
    analysisLanguage,
    boundarySourceDurationMs,
    broadcastContextAttemptOrdinal,
    broadcastTranscriptStatus,
    broadcastVisualInspectionProjection,
    broadcastVisualInspectionStatus,
    currentAnalysisInputSignature,
    currentAnalysisRunId,
    getResultStore,
    sourceCastRosterId,
  ]);
  const broadcastParticipantGrounding =
    broadcastParticipantPreContext?.grounding ??
    baselineBroadcastParticipantGrounding;
  const broadcastContextCandidateInputs = useMemo<
    readonly BroadcastContextCandidateInput[]
  >(
    () =>
      broadcastContextCandidateCohort.map((candidate) => {
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
            participantContextForBroadcastRange(
              broadcastParticipantGrounding,
              Math.round(candidate.startMs),
              Math.round(candidate.endMs),
            ),
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
      broadcastContextCandidateCohort,
      broadcastParticipantGrounding,
      youtubeCaptionTrack,
    ],
  );
  const candidateDetailCostEstimate = useMemo(() => {
    const detailIds = new Set(candidateDetailCandidateIds);
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
  const broadcastTranscriptProgressRatio =
    broadcastTranscriptStatus === "completed"
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
  const approvedCandidates = orderedCandidates.filter(
    ({ reviewState }) => reviewState === "approved",
  );
  const approvedExportCandidates: readonly ApprovedHighlightExportCandidate[] =
    approvedCandidates.map((proposal) => ({
      proposal,
      boundaryRevision: boundaryRevisions[proposal.id] ?? null,
      ...(candidateTitleById[proposal.id] !== undefined
        ? { title: candidateTitleById[proposal.id] }
        : {}),
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
  const blockedByCandidateDetailGap = finalVerificationGapSummary.some(
    ({ gap }) =>
      gap === "detail-result-missing" ||
      gap === "verification-receipt-missing" ||
      gap === "evidence-incomplete",
  );
  const candidateDetailGapIds = useMemo(
    () =>
      Object.entries(finalCandidateVerification.gapByCandidateId).flatMap(
        ([candidateId, gap]) =>
          gap === "detail-result-missing" ||
          gap === "verification-receipt-missing" ||
          gap === "evidence-incomplete"
            ? [candidateId]
            : [],
      ),
    [finalCandidateVerification.gapByCandidateId],
  );
  const durableCandidatePlanReceipt =
    candidatePassBDurableInsights?.planReceipt ?? null;
  const activeCandidatePlanReceipt = candidatePassBPlanReceiptRef.current;
  const candidatePlanDurable =
    durableCandidatePlanReceipt !== null &&
    activeCandidatePlanReceipt !== null &&
    JSON.stringify(durableCandidatePlanReceipt) ===
      JSON.stringify(activeCandidatePlanReceipt) &&
    durableCandidatePlanReceipt.runId === currentAnalysisRunId &&
    durableCandidatePlanReceipt.inputSignature ===
      currentAnalysisInputSignature &&
    durableCandidatePlanReceipt.refinementEvidenceProjectionFingerprint ===
      semanticRefinementEvidenceProjectionFingerprint &&
    JSON.stringify(durableCandidatePlanReceipt.plannedCandidateIds) ===
      JSON.stringify(candidateDetailCandidateIds);
  const emptyResultReason: "analysis-incomplete" | "no-verified-candidates" =
    wholeContextPhaseFailed ||
    broadcastContextResult === null ||
    broadcastTranscriptChapters.length === 0 ||
    blockedByPipelineGap
      ? "analysis-incomplete"
      : "no-verified-candidates";
  /**
   * Candidate detail is the stage that produces the multimodal reading every
   * final candidate is gated on, so the phase is not complete until it has
   * actually settled. Treating whole-context completion as sufficient
   * published the final list while detail analysis had not yet started, and
   * every candidate was dropped for a result that was still seconds away.
   */
  const { finalSelectionReady: artifactSelectionReady } =
    deriveCandidatePublicationGate({
      candidateDetailOutstandingCount:
        candidateDetailPipelineOutstandingIds.length,
      candidatePlanDurable,
      candidatePassBStatus: candidatePassBRun?.status ?? null,
      candidatePassBBusy,
      semanticLeadRefinementStatus,
      refinementEvidenceRequired: semanticRefinementEvidenceRequired,
      refinementEvidenceProjectionFingerprint:
        semanticRefinementEvidenceProjectionFingerprint,
      refinementEvidencePublicationEligible:
        semanticRefinementEvidencePublicationEligible,
      wholeContextComplete: wholeContextPhaseComplete,
      wholeContextFailed: wholeContextPhaseFailed,
    });
  const jobInputSignature = currentAnalysisInputSignature;
  const jobRunId = currentAnalysisRunId;
  const pipelineCertificationInputToken = useMemo(() => {
    if (
      !artifactSelectionReady ||
      jobInputSignature === null ||
      jobRunId === null
    ) {
      return null;
    }
    const durableCandidateSnapshot =
      candidatePassBDurableInsights === null
        ? null
        : {
            schemaVersion: candidatePassBDurableInsights.schemaVersion,
            inputSignature: candidatePassBDurableInsights.inputSignature,
            modelManifestHash:
              candidatePassBDurableInsights.modelManifestHash,
            recordedAt: candidatePassBDurableInsights.recordedAt,
            evidenceCandidateIds: Object.keys(
              candidatePassBDurableInsights.evidenceById,
            ).sort(),
            insightCandidateIds: Object.keys(
              candidatePassBDurableInsights.insightById,
            ).sort(),
            modelByCandidateId:
              candidatePassBDurableInsights.modelByCandidateId ?? {},
            verificationReceiptById:
              candidatePassBDurableInsights.verificationReceiptById ?? {},
            contextByCandidateId:
              candidatePassBDurableInsights.contextByCandidateId,
          };
    return JSON.stringify({
      runId: jobRunId,
      inputSignature: jobInputSignature,
      candidates: pipelineCandidates,
      durableCandidateSnapshot,
      broadcastTranscriptStatus,
      broadcastTranscriptAttemptOrdinal,
      broadcastVisualInspectionStatus,
      broadcastVisualInspectionPlannedCellCount,
      broadcastVisualInspectionPreparedCellCount,
      broadcastVisualInspectionSettledCellCount,
      broadcastContextStatus,
      broadcastContextAttemptOrdinal,
      broadcastContextResult,
      semanticLeadRefinementStatus,
      semanticLeadRefinementAttemptOrdinal,
      refinementEvidenceProjectionFingerprint:
        semanticRefinementEvidenceProjectionFingerprint,
    });
  }, [
    artifactSelectionReady,
    broadcastContextAttemptOrdinal,
    broadcastContextResult,
    broadcastContextStatus,
    broadcastTranscriptAttemptOrdinal,
    broadcastTranscriptStatus,
    broadcastVisualInspectionPreparedCellCount,
    broadcastVisualInspectionPlannedCellCount,
    broadcastVisualInspectionSettledCellCount,
    broadcastVisualInspectionStatus,
    candidatePassBDurableInsights,
    jobInputSignature,
    jobRunId,
    pipelineCandidates,
    semanticLeadRefinementAttemptOrdinal,
    semanticLeadRefinementStatus,
    semanticRefinementEvidenceProjectionFingerprint,
  ]);
  pipelineCertificationEvidenceRef.current =
    pipelineCertificationInputToken === null
      ? null
      : {
          candidates: pipelineCandidates,
        };

  useEffect(() => {
    const operation = pipelineCertificationOperationRef.current + 1;
    pipelineCertificationOperationRef.current = operation;
    if (
      pipelineCertificationInputToken === null ||
      jobInputSignature === null ||
      jobRunId === null
    ) {
      setPipelineCertification({ status: "idle" });
      return;
    }
    const evidence = pipelineCertificationEvidenceRef.current;
    if (evidence === null) {
      setPipelineCertification({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    let retryTimeout: ReturnType<typeof globalThis.setTimeout> | null = null;
    let cancelled = false;
    setPipelineCertification({
      status: "checking",
      inputToken: pipelineCertificationInputToken,
    });

    void (async () => {
      const operationToken =
        `pipeline-certification:${jobRunId}:${pipelineCertificationInputToken}`;
      const isCurrent = (identity: {
        readonly runId: string;
        readonly operationToken: string;
      }): boolean =>
        !cancelled &&
        !controller.signal.aborted &&
        isMounted.current &&
        operation === pipelineCertificationOperationRef.current &&
        identity.runId === jobRunId &&
        identity.operationToken === operationToken;
      const result = await runDurableAnalysisPipelineCertification({
        identity: { runId: jobRunId, operationToken },
        store: getResultStore(),
        evidence,
        isCurrent,
        signal: controller.signal,
      });
      if (!isCurrent({ runId: jobRunId, operationToken })) {
        return;
      }
      switch (result.status) {
        case "succeeded":
          pipelineRepairAttemptByInputTokenRef.current.clear();
          setPipelineRecoveryRequest(null);
          setPipelineCertification({
            status: "succeeded",
            inputToken: pipelineCertificationInputToken,
            durableToken: result.durableToken,
            certificate: result.certificate,
          });
          return;
        case "certificate-rejected": {
          const priorAttemptCount =
            pipelineRepairAttemptByInputTokenRef.current.get(
              pipelineCertificationInputToken,
            ) ?? 0;
          const recoveryPlan = planAnalysisPipelineRecovery({
            failedStage: result.failedStage,
            gaps: result.gaps,
            priorAttemptCount,
          });
          if (recoveryPlan.kind !== "terminal") {
            pipelineRepairAttemptByInputTokenRef.current.set(
              pipelineCertificationInputToken,
              recoveryPlan.repairGeneration,
            );
            setPipelineRecoveryRequest({
              inputToken: pipelineCertificationInputToken,
              plan: recoveryPlan,
            });
            setPipelineCertification({
              status: "checking",
              inputToken: pipelineCertificationInputToken,
            });
            return;
          }
          setPipelineRecoveryRequest(null);
          setPipelineCertification({
            status: "failed",
            inputToken: pipelineCertificationInputToken,
            failedStage: result.failedStage,
            gaps: result.gaps,
          });
          return;
        }
        case "retry-exhausted":
          console.warn(
            "Pipeline certification will resume from the durable readback checkpoint.",
            result.reasonCode,
          );
          retryTimeout = globalThis.setTimeout(() => {
            retryTimeout = null;
            if (isCurrent({ runId: jobRunId, operationToken })) {
              setPipelineCertificationRetryEpoch((epoch) => epoch + 1);
            }
          }, 2_000);
          return;
        case "permanent":
          setPipelineCertification({
            status: "failed",
            inputToken: pipelineCertificationInputToken,
            failedStage: "publication",
            gaps: [
              {
                code: "current-schema-required",
                detail: result.reasonCode,
              },
            ],
          });
          return;
        case "stale":
        case "aborted":
          return;
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (retryTimeout !== null) {
        globalThis.clearTimeout(retryTimeout);
      }
    };
  }, [
    getResultStore,
    jobInputSignature,
    jobRunId,
    pipelineCertificationRetryEpoch,
    pipelineCertificationInputToken,
  ]);
  const currentPipelineCertificate =
    pipelineCertification.status === "succeeded" &&
    pipelineCertification.inputToken === pipelineCertificationInputToken
      ? pipelineCertification.certificate
      : null;
  const currentPipelineDurableToken =
    pipelineCertification.status === "succeeded" &&
    pipelineCertification.inputToken === pipelineCertificationInputToken
      ? pipelineCertification.durableToken
      : null;
  const currentPipelineCertificationChecking =
    pipelineCertification.status === "checking" &&
    pipelineCertification.inputToken === pipelineCertificationInputToken;
  const currentPipelineCertificationFailure =
    pipelineCertification.status === "failed" &&
    pipelineCertification.inputToken === pipelineCertificationInputToken
      ? pipelineCertification
      : null;
  const projectedFinalCandidateIds = orderedCandidates
    .map(({ id }) => id)
    .sort();
  const certifiedFinalCandidateIds =
    currentPipelineCertificate === null
      ? []
      : [...currentPipelineCertificate.finalCandidateIds].sort();
  const certificateMatchesFinalCandidates =
    currentPipelineCertificate !== null &&
    certifiedFinalCandidateIds.length === projectedFinalCandidateIds.length &&
    certifiedFinalCandidateIds.every(
      (candidateId, index) =>
        candidateId === projectedFinalCandidateIds[index],
    );
  const finalSelectionPhaseReady =
    artifactSelectionReady &&
    currentPipelineCertificate !== null &&
    certificateMatchesFinalCandidates;
  /*
   * Candidate readiness follows durable analysis artifacts only. Topic reveal
   * is a timeline animation and may continue visually after the final
   * judgement is already safe to review.
   */
  const contextualCandidatePublicationReady = finalSelectionPhaseReady;
  const candidateStageCommitGate = useMemo(
    () =>
      deriveCandidateStageCommitGate({
        wholeContextComplete: wholeContextPhaseComplete,
        finalSelectionReady: finalSelectionPhaseReady,
        hasPipelineGap: blockedByPipelineGap,
      }),
    [
      blockedByPipelineGap,
      finalSelectionPhaseReady,
      wholeContextPhaseComplete,
    ],
  );

  /*
   * The final three job stages advance only from one exact success
   * certificate. The context session remains the recovery checkpoint while
   * those stages are pending, so moving the job cursor early buys nothing and
   * can incorrectly turn a partial run into a completed one.
   */
  const committedStagesRef = useRef<Set<string>>(new Set());
  /**
   * 스테이지 실측. `STAGE_WEIGHTS` 는 추정이고, 추정으로 최적화하면 엉뚱한 데를
   * 판다. 확정 지점이 이미 경계이므로 그 사이 시간을 재는 것으로 충분하다.
   */
  const stageTimerRef = useRef<StageTimer | null>(null);
  /**
   * 진행축이 읽는 값 — 마지막으로 **확정된** 스테이지.
   *
   * 저장소에서 다시 읽지 않고 확정하는 그 자리에서 올린다. 저장은 비동기라
   * 되읽으면 막대가 한 박자 늦고, 그 지연이 스테이지 경계마다 눈에 띈다.
   */
  const [committedAnalysisStage, setCommittedAnalysisStage] =
    useState<AnalysisStage | null>(null);

  useEffect(() => {
    if (
      jobInputSignature === null ||
      jobRunId === null ||
      currentPipelineCertificate === null ||
      currentPipelineDurableToken === null ||
      !candidateStageCommitGate.completion
    ) {
      return;
    }
    const operation = durableStageOperationRef.current + 1;
    durableStageOperationRef.current = operation;
    const controller = new AbortController();
    const store = getResultStore();
    let retryTimeout: ReturnType<typeof globalThis.setTimeout> | null = null;
    let cancelled = false;

    const scheduleRetry = (): void => {
      if (retryTimeout === null && !cancelled) {
        retryTimeout = globalThis.setTimeout(() => {
          retryTimeout = null;
          if (
            isMounted.current &&
            !cancelled &&
            operation === durableStageOperationRef.current
          ) {
            setDurableStageRetryEpoch((epoch) => epoch + 1);
          }
        }, 2_000);
      }
    };
    const operationIsCurrent = (operationToken: string) =>
      (identity: { readonly runId: string; readonly operationToken: string }) =>
        isMounted.current &&
        !cancelled &&
        !controller.signal.aborted &&
        operation === durableStageOperationRef.current &&
        identity.runId === jobRunId &&
        identity.operationToken === operationToken;
    const reopenCertifiedSnapshot = async () => {
      const evidence = pipelineCertificationEvidenceRef.current;
      if (evidence === null) {
        return null;
      }
      const operationToken =
        `analysis-stage-snapshot:${jobRunId}:${currentPipelineDurableToken}`;
      const reopened = await runDurableAnalysisPipelineCertification({
        identity: { runId: jobRunId, operationToken },
        store,
        evidence,
        isCurrent: operationIsCurrent(operationToken),
        signal: controller.signal,
      });
      switch (reopened.status) {
        case "succeeded":
          return {
            durableToken: reopened.durableToken,
            durableSnapshot: reopened.durableSnapshot,
          };
        case "certificate-rejected":
        case "stale":
        case "aborted":
          return null;
        case "retry-exhausted":
        case "permanent":
          throw new Error(reopened.reasonCode);
      }
    };
    const handleFailure = (
      result: DurableAnalysisJobOperationResult,
      label: string,
    ): false => {
      if (result.status === "retry-exhausted") {
        console.warn(
          `Durable analysis ${label} checkpoint will continue from the same stage.`,
          result.reasonCode,
        );
        scheduleRetry();
      } else if (result.status === "permanent-failure") {
        setAnalysisError(
          "분석 체크포인트를 저장하지 못했어요. 현재 결과는 완료 처리하지 않았습니다.",
        );
        console.error(
          `Durable analysis ${label} checkpoint was rejected.`,
          result.reasonCode,
        );
      }
      return false;
    };
    const commitStage = async (
      stage: AnalysisStage,
      ready: boolean,
      recordTiming = true,
    ): Promise<boolean> => {
      if (!ready) {
        return false;
      }
      const key =
        `${jobInputSignature}:${jobRunId}:${currentPipelineDurableToken}:${stage}`;
      if (committedStagesRef.current.has(key)) {
        return true;
      }
      const operationToken =
        `analysis-stage:${jobRunId}:${currentPipelineDurableToken}:${stage}`;
      const result = await commitDurableAnalysisStage({
        store,
        inputSignature: jobInputSignature,
        runId: jobRunId,
        operationToken,
        isCurrent: operationIsCurrent(operationToken),
        signal: controller.signal,
        stage,
      });
      if (result.status !== "succeeded") {
        return handleFailure(result, stage);
      }
      committedStagesRef.current.add(key);
      if (recordTiming) {
        stageTimerRef.current?.mark(stage, Date.now());
      }
      if (isMounted.current && !cancelled) {
        setCommittedAnalysisStage(stage);
      }
      return true;
    };

    void (async () => {
      try {
        /*
         * Another tab may have replaced the context or candidate snapshot
         * after certification. Reopen the small durable fence before moving
         * the job cursor; a mismatch restarts certification, not the analysis.
         */
        const initialReopened = await reopenCertifiedSnapshot();
        if (
          initialReopened?.durableToken !== currentPipelineDurableToken
        ) {
          if (!cancelled) {
            setPipelineCertificationRetryEpoch((epoch) => epoch + 1);
          }
          return;
        }
        for (const prerequisite of [
          "preflight",
          "fastPass",
          "seedClustering",
          "commitFastResult",
        ] as const) {
          if (!(await commitStage(prerequisite, true, false))) {
            return;
          }
        }
        if (
          !(await commitStage(
            "broadcastContext",
            candidateStageCommitGate.broadcastContext,
          ))
        ) {
          return;
        }
        if (
          !(await commitStage(
            "deepPass",
            candidateStageCommitGate.deepPass,
          ))
        ) {
          return;
        }
        if (
          !(await commitStage(
            "publication",
            candidateStageCommitGate.publication,
          ))
        ) {
          return;
        }

        const completionSnapshot = await reopenCertifiedSnapshot();
        if (
          completionSnapshot?.durableToken !==
          currentPipelineDurableToken
        ) {
          if (!cancelled) {
            setPipelineCertificationRetryEpoch((epoch) => epoch + 1);
          }
          return;
        }

        const completionKey =
          `${jobInputSignature}:${jobRunId}:${currentPipelineDurableToken}:complete`;
        if (committedStagesRef.current.has(completionKey)) {
          return;
        }
        const completionToken =
          `analysis-complete:${jobRunId}:${currentPipelineDurableToken}`;
        const completion = await completeDurableAnalysisJob({
          store,
          inputSignature: jobInputSignature,
          runId: jobRunId,
          operationToken: completionToken,
          isCurrent: operationIsCurrent(completionToken),
          signal: controller.signal,
          quality: currentPipelineCertificate.quality,
          expectedDurableSnapshot: completionSnapshot.durableSnapshot,
        });
        if (completion.status !== "succeeded") {
          handleFailure(completion, "completion");
          return;
        }
        committedStagesRef.current.add(completionKey);
        const timer = stageTimerRef.current;
        if (timer !== null) {
          console.info(formatStageTimingReport(timer.report()));
        }
      } catch (cause) {
        if (cancelled || controller.signal.aborted) {
          return;
        }
        console.warn(
          "Durable analysis stage checkpoint readback will be retried.",
          cause,
        );
        scheduleRetry();
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (retryTimeout !== null) {
        globalThis.clearTimeout(retryTimeout);
      }
    };
  }, [
    candidateStageCommitGate,
    currentPipelineCertificate,
    currentPipelineDurableToken,
    durableStageRetryEpoch,
    getResultStore,
    jobInputSignature,
    jobRunId,
  ]);
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
  /**
   * A stalled-looking bar was a fabricated number, not a stall: 0.02, 0.76,
   * 0.84, 0.72 and 0.08 were constants standing in for stages with no
   * measured completion fraction. Those branches now return null, and the
   * `<progress>` elements below render indeterminate (no `value`) instead of
   * jumping to a number that never moves.
   */
  /**
   * The fast scan (local CPU) and the uniform transcript prefetch (network,
   * since 0.4.2) run concurrently, but the entry-workspace panel only ever
   * showed the scan — the parallel transcript work was invisible until the
   * scan finished and the stage counter advanced. These three tracks report
   * what is actually running right now instead of a single serial stage.
   *
   * 화면이 말하는 "동시 N" 은 워커가 **그 순간 실제로 쓰는** 값이다.
   *
   * 이제 고정값이 아니라 실행 중에 오르내린다(`AdaptiveConcurrency`). 그래서
   * 상수를 읽는 것으로는 안 되고 진행 메시지가 실어 오는 값을 쓴다. 아직 진행
   * 메시지가 없으면 표시하지 않는다 — 시작하기도 전에 숫자를 말할 이유가 없다.
   */
  const transcriptConcurrency = broadcastTranscriptProgress?.concurrency ?? null;
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
    broadcastTranscriptStatus === "completed";
  const transcriptTrackStatus = transcriptTrackDone
    ? ui("완료", "Complete")
    : broadcastTranscriptRecoveryProgress?.waitingBeforeRetryMs !== null &&
        broadcastTranscriptRecoveryProgress?.waitingBeforeRetryMs !== undefined
      ? ui(
          `실패 조각 ${broadcastTranscriptRecoveryProgress.remainingCount}개 재시도 대기`,
          `Waiting to retry ${broadcastTranscriptRecoveryProgress.remainingCount} failed fragments`,
        )
      : broadcastTranscriptRecoveryProgress !== null &&
          broadcastTranscriptRecoveryProgress.attemptNumber > 1
        ? ui(
            `실패 조각 복구 ${broadcastTranscriptRecoveryProgress.attemptNumber}/${broadcastTranscriptRecoveryProgress.maximumAttemptCount} · ${broadcastTranscriptRecoveryProgress.remainingCount}개`,
            `Fragment recovery ${broadcastTranscriptRecoveryProgress.attemptNumber}/${broadcastTranscriptRecoveryProgress.maximumAttemptCount} · ${broadcastTranscriptRecoveryProgress.remainingCount} remaining`,
          )
    : broadcastTranscriptProgress !== null
      ? ui(
          `표본 ${Math.min(broadcastTranscriptProgress.totalCount, broadcastTranscriptProgress.completedCount + 1)}/${broadcastTranscriptProgress.totalCount}${transcriptConcurrency === null ? "" : ` · 동시 ${transcriptConcurrency}`}`,
          `Sample ${Math.min(broadcastTranscriptProgress.totalCount, broadcastTranscriptProgress.completedCount + 1)}/${broadcastTranscriptProgress.totalCount}${transcriptConcurrency === null ? "" : ` · ${transcriptConcurrency} at once`}`,
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

  /**
   * 진행축은 **작업 층이 확정한 스테이지**를 그대로 읽는다.
   *
   * 한때 화면의 페이즈 넷을 스테이지 위에 얹어 근사했는데, 그것은 파이프라인이
   * 스테이지를 확정하지 않던 시절의 임시방편이었다. 이제 일곱 지점이 실제로
   * 확정을 기록하므로 근사할 이유가 없다 — 확정된 것은 추정이 아니라 사실이다.
   *
   * 현재 스테이지 안의 진행은 **셀 수 있을 때만** 넘긴다. `fastPass` 는 훑은
   * 비율을 알지만 맥락 탐색과 정밀 분석은 셀 수 있는 단위가 없어 `null` 이고,
   * 그때 막대는 확정된 만큼만 차고 나머지는 줄무늬가 된다. 여기에 그럴듯한
   * 상수를 넣으면 정확히 "멈춘 막대" 가 된다.
   */
  const currentStageCountableRatio =
    analysisRun?.stage === "fastPass" &&
    (analysisProgress !== null || audioAnalysisProgress !== null)
      ? fastScanTrackRatio
      : null;
  const progressAxis = computeProgressAxis({
    lastCommittedStage: committedAnalysisStage,
    currentStageRatio: currentStageCountableRatio,
    previousRatio: shownProgressRatio,
  });
  /*
   * 단조성은 이전에 **보여 준** 값을 되먹여야 성립한다. 렌더 중에 맞추면 오른
   * 값이 한 프레임 그려졌다가 정정되는 깜빡임이 없다 — `progressRemainingShownMs`
   * 와 같은 이유이며, 멱등이라 한 번 더 렌더되고 안정된다.
   */
  if (progressAxis.ratio !== shownProgressRatio) {
    setShownProgressRatio(progressAxis.ratio);
  }

  /**
   * 남은 시간은 **단일 진행축**을 기준으로 낸다.
   *
   * 한때 `fastScanTrackRatio` 를 썼는데, 그 값은 방송 전체를 훑는 구간만의
   * 진행률이라 **분석이 35% 지났을 때 이미 100%** 가 된다. 그래서 화면이
   * "약 1분 남음" 이라고 말하면서 실제로는 3분 넘게 남아 있었다. 축을 하나로
   * 합친 이유가 정확히 이것인데 남은 시간은 옛 값을 계속 보고 있었다.
   *
   * 셀 수 없는 구간에서는 비율을 넘기지 않는다 — `estimateRemainingMs` 가
   * 계획 범위로 떨어지고, 지어낸 비율로 외삽하지 않는다.
   */
  const progressRemaining = formatSingleRemaining({
    sourceDurationMs: boundarySourceDurationMs,
    elapsedMs: analysisElapsedMs,
    ratio: progressAxis.indeterminate ? null : progressAxis.ratio,
    previousRemainingMs: shownRemainingMs,
  });
  /*
   * 라벨은 줄어들기만 한다. 렌더 중에 맞추면 오른 값이 한 프레임 그려졌다가
   * 정정되는 깜빡임이 없다 — 위로 튀는 추정치가 신뢰를 깎는 지점이 바로 그것이다.
   */
  if (progressRemaining.remainingMs !== shownRemainingMs) {
    setShownRemainingMs(progressRemaining.remainingMs);
  }
  const progressRemainingLabel = progressRemaining.label;

  const sourceTitleForProgress =
    sourceFile?.name ?? pendingFileName ?? ui("선택한 방송", "Selected broadcast");

  /** 접어 둔 트랙 3행. 기존 트랙 값을 그대로 쓴다 — 새로 계산하지 않는다. */
  const progressDetailTracks = [
    {
      id: "signal",
      label: ui("반응 신호", "Reaction signals"),
      ratio:
        analysisProgress !== null || audioAnalysisProgress !== null
          ? fastScanTrackRatio
          : null,
      status: fastScanTrackStatus,
    },
    {
      id: "voice",
      label: ui("대사 인식", "Transcription"),
      ratio: transcriptTrackDone ? 1 : transcriptTrackRatio,
      status: transcriptTrackStatus,
    },
    {
      id: "chat",
      label: ui("채팅", "Chat"),
      ratio: chatTrackDone ? 1 : null,
      status: chatTrackStatus,
    },
  ];
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
    ? ui("AI 분석 중 변경 잠금", "Locked during AI analysis")
    : sourceCheck?.status === "checking"
      ? ui("확인 중…", "Checking…")
      : openedRecoveredResult !== null
        ? sourceReady
          ? ui("연결한 원본 바꾸기", "Change connected source")
          : candidates.length === 0
            ? ui(
                "원하면 원래 파일 고르기",
                "Choose the original file if needed",
              )
            : ui("원래 파일 다시 고르기", "Reconnect original file")
        : sourceReady
          ? ui("다른 영상 고르기", "Choose another video")
          : ui("영상 파일 고르기", "Choose video file");

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
    setEditingCandidateTitle(false);
  }, [focusedCandidateId]);

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
    const autoRetry = candidatePassBAutoRetryRef.current;
    if (autoRetry.timeout !== null) {
      globalThis.clearTimeout(autoRetry.timeout);
    }
    autoRetry.operationKey = null;
    autoRetry.attempts = 0;
    autoRetry.timeout = null;
    candidatePassBPersistenceAutoRetryRef.current = {
      runId: null,
      attempts: 0,
    };
    candidatePassBOperationEpoch.current += 1;
    candidatePassBInsightWriteEpochRef.current += 1;
    candidatePassBPendingInsightsRef.current = null;
    candidatePassBInsightPersistenceFailureRef.current = null;
    candidatePassBPlanReceiptRef.current = null;
    candidatePassBPlanPreparationRef.current = {
      operationKey: null,
      promise: null,
    };
    candidatePassBPlanRetryRef.current = {
      operationKey: null,
      attempts: 0,
    };
    candidatePassBPlanReplacementRequiredRef.current = true;
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
    candidatePassBDispatchIntentRef.current = {};
    candidatePassBAttemptLedgerRef.current = {};
    candidatePassBSettlementRef.current = {};
    candidateTimelineFramesRef.current = {};
    setCandidatePassBEvidenceById({});
    setCandidateGeminiInsightById({});
    setCandidatePassBVerificationReceiptById({});
    setCandidateTimelineFramesById({});
    // Keep the last committed ref: a same-run context reset must CAS the
    // durable snapshot to empty. A new run ignores it by runId.
    setCandidatePassBDurableInsights(null);
    setCandidatePassBInsightPersistenceStatus("idle");
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
    broadcastVisualInspectionAbortController.current?.abort();
    broadcastVisualInspectionAbortController.current = null;
    broadcastContextAbortController.current?.abort();
    broadcastContextAbortController.current = null;
    semanticLeadRefinementAbortController.current?.abort();
    semanticLeadRefinementAbortController.current = null;
    autoBroadcastTranscriptSourceRef.current = null;
    sealedBroadcastTranscriptSourceRef.current = null;
    autoBroadcastVisualInspectionSourceRef.current = null;
    allowAmbiguousTranscriptRetryRef.current = false;
    broadcastTranscriptRouteChangeCountRef.current = 0;
    autoBroadcastContextSourceRef.current = null;
    autoSemanticLeadRefinementSourceRef.current = null;
    allowAmbiguousSemanticRefinementRetryRef.current = false;
    semanticRefinementRouteChangeCountRef.current = 0;
    setBroadcastTranscriptStatus("idle");
    setBroadcastTranscriptProgress(null);
    setBroadcastTranscriptRecoveryProgress(null);
    setBroadcastTranscriptExplorationCells([]);
    setBroadcastTranscriptChapters([]);
    setBroadcastVisualInspectionProjection(null);
    setBroadcastVisualInspectionStatus("idle");
    setBroadcastVisualInspectionPlannedCellCount(0);
    setBroadcastVisualInspectionPreparedCellCount(0);
    setBroadcastVisualInspectionSettledCellCount(0);
    setBroadcastVisualInspectionAttemptOrdinal(0);
    setBroadcastVisualInspectionError(null);
    setAnalysisCaptionVideoId(null);
    setYouTubeCaptionTrack(null);
    youtubeCaptionTrackRef.current = null;
    setBroadcastTranscriptError(null);
    setBroadcastContextStatus("idle");
    setBroadcastContextResult(null);
    setCandidateAiProjectionById({});
    setBroadcastContextRefinementLeadIds(null);
    setBroadcastContextFastRefinementLeadIds(null);
    setBroadcastContextError(null);
    setSemanticLeadRefinementStatus("idle");
    setSemanticLeadRefinementError(null);
    setActiveRefinementEvidenceProjection(null);
    resetCandidateRanking();
    resetBoundarySession();
    resetCandidatePassB();
    resetCandidateAudioEvent();
    setAnalysisProgress(null);
    setAudioAnalysisProgress(null);
    setAnalysisError(null);
    setPipelineCertification({ status: "idle" });
    setPipelineRecoveryRequest(null);
    setPipelineFastRebuildPending(false);
    pipelineRepairAttemptByInputTokenRef.current.clear();
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
    async (
      file: File,
      options: { readonly preserveCurrentSession?: boolean } = {},
    ) => {
      const recoveryTarget = openedRecoveredResult;
      const recheckingRetainedSource =
        options.preserveCurrentSession === true &&
        recoveryTarget === null &&
        sourceFile === file;
      const replacingExistingSource =
        recoveryTarget === null &&
        sourceFile !== null &&
        !recheckingRetainedSource;
      const previousRecoveryBinding =
        (recoveryTarget !== null || recheckingRetainedSource) &&
        sourceFile !== null &&
        preflight !== null &&
        sourceContentFingerprint !== null &&
        sourceCheck?.status === "completed"
          ? {
              pendingFileName: pendingFileName ?? preflight.metadata.name,
              preflight,
              sourceCheck,
              sourceContentFingerprint,
              channelPreanalysisConnection,
              channelPreanalysisBundleBinding:
                channelPreanalysisBundleBindingRef.current,
              manualVodInput,
            }
          : null;
      const epoch = sourceSelectionEpoch.current + 1;
      sourceSelectionEpoch.current = epoch;
      sourceAbortController.current?.abort();
      channelPreanalysisConfirmationAbortController.current?.abort();
      channelPreanalysisConfirmationAbortController.current = null;
      channelPreanalysisManualLookupKeyRef.current = null;
      setChannelPreanalysisConfirmationPending(false);
      const controller = new AbortController();
      sourceAbortController.current = controller;
      const isCurrentSelection = (): boolean =>
        isMounted.current &&
        epoch === sourceSelectionEpoch.current &&
        !controller.signal.aborted;
      if (recoveryTarget === null && replacingExistingSource) {
        setManualVodInput("");
        manualVodInputRef.current = "";
      }
      channelPreanalysisBundleBindingRef.current = null;
      replaceChannelPreanalysisConnection({ status: "checking" });
      setPendingFileName(file.name);
      setSourceError(null);
      if (recoveryTarget === null && !recheckingRetainedSource) {
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
        replaceSourceFile(null, { preserveAnalysisArtifacts: true });
        setPreflight(null);
        setSourceContentFingerprint(null);
      }

      let machine = createSourceCheck({
        jobId: createOperationId("source-check"),
        sourceDefinitionId:
          recoveryTarget?.finalResult.result.input.source.sourceDefinitionId ??
          (recheckingRetainedSource
            ? sourceCheck?.sourceDefinitionId
            : null) ??
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

        const locallyRegisteredVideoId =
          getChannelPreanalysisLocalBinding(fingerprint.value)?.videoId ?? null;
        const manualCaptionVideoId =
          recoveryTarget === null
            ? youtubeVideoIdFromUserInput(manualVodInputRef.current)
            : null;
        const filenameCaptionVideoId = youtubeVideoIdFromSourceName(file.name);
        const trustedLookupVideoId =
          recoveryTarget !== null
            ? recoveryTarget.finalResult.result.input.source.captionVideoId
            : manualCaptionVideoId ??
              locallyRegisteredVideoId;
        let catalogConnection: ChannelPreanalysisConnectionState;
        let matchedCatalogBundle: ChannelPreanalysisBundle | null = null;
        let matchedCatalogBinding: ChannelPreanalysisVerifiedBundleBinding | null =
          null;
        let visuallyVerifiedVideoId: string | null = null;
        try {
          const requestLookup = (
            videoId: string | null,
          ): Promise<ConfiguredChannelPreanalysisSearchResult> =>
            requestChannelPreanalysisMatchForSource(
              {
                videoId,
                title: file.name,
                durationMs: result.metadata.durationMs,
                localSampledFingerprint: fingerprint.value,
              },
              controller.signal,
            );
          let catalogSearch: ConfiguredChannelPreanalysisSearchResult;
          if (
            trustedLookupVideoId !== null ||
            recoveryTarget !== null ||
            filenameCaptionVideoId === null
          ) {
            catalogSearch = await requestLookup(trustedLookupVideoId);
          } else {
            /*
             * A filename `[videoId]` is a hint, never the first identity lane.
             * Query without it first so a catalog-registered exact file
             * fingerprint cannot be hidden by a different but valid filename
             * ID. Only a catalog-exact, duration-compatible filename is
             * allowed to outrank a merely probable title+duration match.
             */
            let metadataSearch: ConfiguredChannelPreanalysisSearchResult | null =
              null;
            let metadataLookupError: unknown = null;
            try {
              metadataSearch = await requestLookup(null);
            } catch (error) {
              metadataLookupError = error;
            }
            if (!isCurrentSelection()) {
              return;
            }
            if (metadataSearch?.selection === "exact") {
              catalogSearch = metadataSearch;
            } else {
              let filenameSearch: ConfiguredChannelPreanalysisSearchResult | null =
                null;
              try {
                filenameSearch = await requestLookup(filenameCaptionVideoId);
              } catch (error) {
                if (metadataSearch === null) throw error;
              }
              if (filenameSearch === null) {
                if (metadataSearch === null) {
                  throw metadataLookupError instanceof Error
                    ? metadataLookupError
                    : new Error("Channel preanalysis catalog lookup failed.");
                }
                catalogSearch = metadataSearch;
              } else if (metadataSearch === null) {
                catalogSearch = filenameSearch;
              } else {
                const selectedLane = selectChannelPreanalysisLookupLane(
                  {
                    confidence:
                      metadataSearch.selection === "probable"
                        ? metadataSearch.primaryLookup.match.confidence
                        : "none",
                    timelineStatus: classifyChannelPreanalysisTimeline(
                      metadataSearch.primaryLookup.match.match?.durationMs,
                      result.metadata.durationMs,
                    ),
                  },
                  {
                    confidence:
                      filenameSearch.selection === "exact" ||
                      filenameSearch.selection === "probable"
                        ? filenameSearch.primaryLookup.match.confidence
                        : "none",
                    timelineStatus: classifyChannelPreanalysisTimeline(
                      filenameSearch.primaryLookup.match.match?.durationMs,
                      result.metadata.durationMs,
                    ),
                  },
                );
                catalogSearch =
                  selectedLane === "metadata"
                    ? metadataSearch
                    : filenameSearch;
              }
            }
          }
          let lookup = catalogSearch.primaryLookup;
          const lookupMatchBeforeVisualVerification = lookup.match.match;
          const shouldVerifyVisualIdentity =
            recoveryTarget === null &&
            manualCaptionVideoId === null &&
            locallyRegisteredVideoId === null &&
            (catalogSearch.selection === "visual-cohort" ||
              catalogSearch.selection === "probable" ||
              (catalogSearch.selection === "exact" &&
                lookupMatchBeforeVisualVerification !== null &&
                lookup.match.reason === "explicit-video-id" &&
                filenameCaptionVideoId ===
                  lookupMatchBeforeVisualVerification.videoId));
          if (shouldVerifyVisualIdentity) {
            const visualIdentity =
              catalogSearch.selection === "exact"
                ? await verifyChannelPreanalysisLocalVisualIdentity(
                    file,
                    result.metadata.durationMs,
                    lookup,
                    { signal: controller.signal },
                  )
                : await verifyConfiguredChannelPreanalysisLocalVisualIdentity(
                    file,
                    result.metadata.durationMs,
                    catalogSearch,
                    { signal: controller.signal },
                  );
            if (!isCurrentSelection()) {
              return;
            }
            if (
              visualIdentity.status === "verified" &&
              (lookupMatchBeforeVisualVerification === null ||
                visualIdentity.videoId ===
                  lookupMatchBeforeVisualVerification.videoId)
            ) {
              const exactLookup =
                visualIdentity.verifiedLookup ??
                (await requestLookup(visualIdentity.videoId)).primaryLookup;
              if (!isCurrentSelection()) {
                return;
              }
              if (
                exactLookup.match.confidence === "exact" &&
                exactLookup.match.match?.videoId === visualIdentity.videoId
              ) {
                lookup = exactLookup;
                catalogSearch = {
                  ...catalogSearch,
                  selection: "exact",
                  primaryLookup: exactLookup,
                };
                visuallyVerifiedVideoId = visualIdentity.videoId;
              }
            }
          }
          if (
            catalogSearch.selection === "exact" &&
            lookup.match.confidence === "exact" &&
            lookup.match.match !== null
          ) {
            const timelineStatus = classifyChannelPreanalysisTimeline(
              lookup.match.match.durationMs,
              result.metadata.durationMs,
            );
            const catalogFingerprintVideoId =
              lookup.match.reason === "registered-local-sampled-fingerprint"
                ? lookup.match.match.videoId
                : null;
            const trust = resolveChannelPreanalysisTrust({
              manualVideoId: manualCaptionVideoId,
              registeredBindingVideoId:
                locallyRegisteredVideoId ??
                catalogFingerprintVideoId,
              visualFingerprintVideoId: visuallyVerifiedVideoId,
              filenameVideoId: filenameCaptionVideoId,
              editorConfirmedVideoId: null,
              catalogConfidence: lookup.match.confidence,
              catalogVideoId: lookup.match.match.videoId,
              timelineStatus,
            });
            const attachment =
              recoveryTarget === null ||
              recoveryTarget.finalResult.result.input.source.captionVideoId ===
                lookup.match.match.videoId
                ? "current-run"
                : "future-run-only";
            if (timelineStatus === "incompatible") {
              catalogConnection = {
                status: "incompatible",
                lookup,
                timelineStatus,
              };
            } else if (
              recoveryTarget === null &&
              trust.basis === null &&
              (trust.filenameDisposition === "needs-confirmation" ||
                trust.filenameDisposition === "verified")
            ) {
              catalogConnection = {
                status: "probable",
                lookup,
                reason: "filename-confirmation-required",
                timelineStatus,
              };
            } else {
              const basis =
                recoveryTarget !== null
                  ? "recovery-preserved"
                  : trust.basis;
              if (basis === null) {
                catalogConnection = { status: "not-found" };
              } else {
                catalogConnection = {
                  status: "connected",
                  lookup,
                  basis,
                  attachment,
                  timelineStatus,
                };
                matchedCatalogBinding =
                  attachment === "current-run" &&
                  timelineStatus === "compatible"
                    ? createChannelPreanalysisVerifiedBundleBinding(
                        fingerprint.value,
                        lookup,
                      )
                    : null;
                matchedCatalogBundle = matchedCatalogBinding?.bundle ?? null;
              }
            }
          } else if (
            catalogSearch.selection === "probable" &&
            lookup.match.confidence === "probable" &&
            lookup.match.match !== null
          ) {
            catalogConnection = {
              status: "probable",
              lookup,
              reason: "metadata-probable",
              timelineStatus: classifyChannelPreanalysisTimeline(
                lookup.match.match.durationMs,
                result.metadata.durationMs,
              ),
            };
          } else {
            catalogConnection = { status: "not-found" };
          }
        } catch {
          catalogConnection = { status: "unavailable" };
        }
        if (!isCurrentSelection()) {
          return;
        }
        const latestManualCaptionVideoId =
          recoveryTarget === null
            ? youtubeVideoIdFromUserInput(manualVodInputRef.current)
            : null;
        const manualDecisionChanged =
          recoveryTarget === null &&
          latestManualCaptionVideoId !== manualCaptionVideoId;
        if (
          manualCaptionVideoId !== null &&
          !manualDecisionChanged
        ) {
          channelPreanalysisManualLookupKeyRef.current =
            `${fingerprint.value}:${manualCaptionVideoId}`;
        }
        if (manualDecisionChanged) {
          catalogConnection =
            latestManualCaptionVideoId === null
              ? { status: "not-found" }
              : { status: "checking" };
          matchedCatalogBundle = null;
          matchedCatalogBinding = null;
        }
        replaceChannelPreanalysisConnection(catalogConnection);
        const catalogLookup =
          catalogConnection.status === "connected" ||
          catalogConnection.status === "probable" ||
          catalogConnection.status === "incompatible"
            ? catalogConnection.lookup
            : null;
        const catalogTimelineStatus =
          catalogConnection.status === "connected" ||
          catalogConnection.status === "probable" ||
          catalogConnection.status === "incompatible"
            ? catalogConnection.timelineStatus
            : "unknown";
        const catalogFingerprintVideoId =
          catalogLookup?.match.reason ===
          "registered-local-sampled-fingerprint"
            ? catalogLookup.match.match?.videoId ?? null
            : null;
        const sourceTrust = resolveChannelPreanalysisTrust({
          manualVideoId:
            latestManualCaptionVideoId,
          registeredBindingVideoId:
            locallyRegisteredVideoId ??
            catalogFingerprintVideoId,
          visualFingerprintVideoId: visuallyVerifiedVideoId,
          filenameVideoId: filenameCaptionVideoId,
          editorConfirmedVideoId: null,
          catalogConfidence: catalogLookup?.match.confidence ?? "none",
          catalogVideoId: catalogLookup?.match.match?.videoId ?? null,
          timelineStatus: catalogTimelineStatus,
        });
        const durableCaptionVideoId =
          recoveryTarget !== null
            ? recoveryTarget.finalResult.result.input.source.captionVideoId
            : sourceTrust.durableCaptionVideoId;
        const sourceDescriptor = createDurableSourceDescriptor(
          result,
          machine.sourceDefinitionId,
          fingerprint.value,
          durableCaptionVideoId,
        );
        if (
          recoveryTarget !== null &&
          (sourceDescriptor.contentFingerprint !==
            recoveryTarget.finalResult.result.input.source.contentFingerprint ||
            sourceDescriptor.sizeBytes !==
              recoveryTarget.finalResult.result.input.source.sizeBytes ||
            sourceDescriptor.durationMs !==
              recoveryTarget.finalResult.result.input.source.durationMs ||
            sourceDescriptor.captionVideoId !==
              recoveryTarget.finalResult.result.input.source.captionVideoId ||
            sourceDescriptor.kind !== recoveryTarget.finalResult.result.input.source.kind)
        ) {
          throw new SourceRebindMismatchError();
        }
        if (
          recheckingRetainedSource &&
          previousRecoveryBinding !== null &&
          (sourceDescriptor.contentFingerprint !==
            previousRecoveryBinding.sourceContentFingerprint ||
            sourceDescriptor.sizeBytes !==
              previousRecoveryBinding.preflight.metadata.sizeBytes ||
            sourceDescriptor.durationMs !==
              previousRecoveryBinding.preflight.metadata.durationMs)
        ) {
          throw new SourceRebindMismatchError();
        }

        const isUsableVideo = result.metadata.kind === "video" && result.metadata.durationMs > 0;
        if (
          isUsableVideo &&
          catalogConnection.status === "connected" &&
          catalogConnection.timelineStatus === "compatible" &&
          channelPreanalysisIdentityBasisAuthorizesPreparedData(
            catalogConnection.basis,
          ) &&
          catalogConnection.lookup.match.match !== null
        ) {
          const bindingSource = channelPreanalysisSourceForManifest(
            catalogConnection.lookup.manifest,
          );
          if (
            bindingSource !== null &&
            registerChannelPreanalysisLocalBinding({
              localSampledFingerprint: fingerprint.value,
              sourceId: bindingSource.sourceId,
              channelId: bindingSource.channelId,
              videoId: catalogConnection.lookup.match.match.videoId,
            }) !== null
          ) {
            setChannelPreanalysisLocalBindingRevision((revision) => revision + 1);
          }
        }
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
        replaceSourceFile(isUsableVideo ? file : null, {
          preserveAnalysisArtifacts:
            recoveryTarget !== null || recheckingRetainedSource,
        });
        channelPreanalysisBundleBindingRef.current = matchedCatalogBinding;
        if (
          isUsableVideo &&
          matchedCatalogBundle !== null &&
          Math.abs(
            matchedCatalogBundle.durationMs - result.metadata.durationMs,
          ) <= CHANNEL_PREANALYSIS_TITLE_DURATION_TOLERANCE_MS
        ) {
          youtubeCaptionTrackRef.current = matchedCatalogBundle.captionTrack;
          setYouTubeCaptionTrack(matchedCatalogBundle.captionTrack);
        }
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
          channelPreanalysisBundleBindingRef.current =
            previousRecoveryBinding.channelPreanalysisBundleBinding;
          replaceChannelPreanalysisConnection(
            previousRecoveryBinding.channelPreanalysisConnection,
          );
          setManualVodInput(previousRecoveryBinding.manualVodInput);
          manualVodInputRef.current = previousRecoveryBinding.manualVodInput;
        } else if (outcome.accepted) {
          setSourceCheck(outcome.state);
          replaceChannelPreanalysisConnection({ status: "unavailable" });
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
      channelPreanalysisConnection,
      manualVodInput,
      openedRecoveredResult,
      pendingFileName,
      preflight,
      replaceSourceFile,
      replaceChannelPreanalysisConnection,
      resetDownstream,
      sourceCheck,
      sourceContentFingerprint,
      sourceFile,
    ],
  );

  const confirmProbableChannelPreanalysisMatch = async (): Promise<void> => {
    const current = channelPreanalysisConnectionRef.current;
    if (current.status !== "probable") {
      return;
    }
    const { lookup: probableLookup } = current;
    const match = probableLookup.match.match;
    if (
      match === null ||
      sourceFile === null ||
      preflight === null ||
      sourceContentFingerprint === null ||
      channelPreanalysisConfirmationPending ||
      analysisBusy ||
      analysisStartOperation.current !== null ||
      youtubeVideoIdFromUserInput(manualVodInputRef.current) !== null
    ) {
      return;
    }
    const timelineStatus = classifyChannelPreanalysisTimeline(
      match.durationMs,
      preflight.metadata.durationMs,
    );
    if (timelineStatus === "incompatible") {
      replaceChannelPreanalysisConnection({
        status: "incompatible",
        lookup: probableLookup,
        timelineStatus,
      });
      return;
    }
    const attachment =
      openedRecoveredResult === null ||
      openedRecoveredResult.finalResult.result.input.source.captionVideoId ===
        match.videoId
        ? "current-run"
        : "future-run-only";
    const selectionEpoch = sourceSelectionEpoch.current;
    const analysisEpoch = analysisOperationEpoch.current;
    channelPreanalysisBundleBindingRef.current =
      attachment !== "current-run" || timelineStatus !== "compatible"
        ? null
        : createChannelPreanalysisVerifiedBundleBinding(
            sourceContentFingerprint,
            probableLookup,
          );
    const confirmedBinding = channelPreanalysisBundleBindingRef.current;
    if (confirmedBinding !== null) {
      youtubeCaptionTrackRef.current = confirmedBinding.bundle.captionTrack;
      setYouTubeCaptionTrack(confirmedBinding.bundle.captionTrack);
    }
    replaceChannelPreanalysisConnection({
      status: "connected",
      lookup: probableLookup,
      basis: "editor-confirmed-catalog",
      attachment,
      timelineStatus,
    });
    const bindingSource = channelPreanalysisSourceForManifest(
      probableLookup.manifest,
    );
    if (
      bindingSource !== null &&
      registerChannelPreanalysisLocalBinding({
        localSampledFingerprint: sourceContentFingerprint,
        sourceId: bindingSource.sourceId,
        channelId: bindingSource.channelId,
        videoId: match.videoId,
      }) !== null
    ) {
      setChannelPreanalysisLocalBindingRevision((revision) => revision + 1);
    }
    channelPreanalysisConfirmationAbortController.current?.abort();
    const controller = new AbortController();
    channelPreanalysisConfirmationAbortController.current = controller;
    setChannelPreanalysisConfirmationPending(true);
    try {
      const search = await requestChannelPreanalysisMatchForSource(
        {
          videoId: match.videoId,
          title: sourceFile.name,
          durationMs: preflight.metadata.durationMs,
          localSampledFingerprint: sourceContentFingerprint,
        },
        controller.signal,
      );
      const lookup = search.primaryLookup;
      if (
        controller.signal.aborted ||
        sourceSelectionEpoch.current !== selectionEpoch ||
        analysisOperationEpoch.current !== analysisEpoch ||
        analysisStartOperation.current !== null ||
        search.selection !== "exact" ||
        lookup.match.confidence !== "exact" ||
        lookup.match.match?.videoId !== match.videoId
      ) {
        return;
      }
      const exactTimelineStatus = classifyChannelPreanalysisTimeline(
        lookup.match.match.durationMs,
        preflight.metadata.durationMs,
      );
      if (exactTimelineStatus === "incompatible") {
        channelPreanalysisBundleBindingRef.current = null;
        replaceChannelPreanalysisConnection({
          status: "incompatible",
          lookup,
          timelineStatus: exactTimelineStatus,
        });
        return;
      }
      channelPreanalysisBundleBindingRef.current =
        attachment !== "current-run" ||
        exactTimelineStatus !== "compatible"
          ? null
          : createChannelPreanalysisVerifiedBundleBinding(
              sourceContentFingerprint,
              lookup,
            );
      const refreshedBinding = channelPreanalysisBundleBindingRef.current;
      if (refreshedBinding !== null) {
        youtubeCaptionTrackRef.current = refreshedBinding.bundle.captionTrack;
        setYouTubeCaptionTrack(refreshedBinding.bundle.captionTrack);
      }
      replaceChannelPreanalysisConnection({
        status: "connected",
        lookup,
        basis: "editor-confirmed-catalog",
        attachment,
        timelineStatus: exactTimelineStatus,
      });
    } catch {
      // The editor's confirmation remains authoritative. A missing catalog
      // bundle only means the normal caption/ASR route will supply the data.
    } finally {
      if (channelPreanalysisConfirmationAbortController.current === controller) {
        channelPreanalysisConfirmationAbortController.current = null;
      }
      if (
        isMounted.current &&
        sourceSelectionEpoch.current === selectionEpoch
      ) {
        setChannelPreanalysisConfirmationPending(false);
      }
    }
  };

  const updateManualVodInput = (value: string): void => {
    dismissedPreparedChannelReviewKeyRef.current = null;
    preparedChannelReviewAbortController.current?.abort();
    preparedChannelReviewAbortController.current = null;
    setPreparedChannelReview({ status: "idle" });
    setManualVodInput(value);
    manualVodInputRef.current = value;
    const requestedVideoId = youtubeVideoIdFromUserInput(value);
    channelPreanalysisConfirmationAbortController.current?.abort();
    channelPreanalysisConfirmationAbortController.current = null;
    channelPreanalysisManualLookupKeyRef.current = null;
    setChannelPreanalysisConfirmationPending(false);
    channelPreanalysisBundleBindingRef.current = null;
    if (requestedVideoId === null) {
      if (
        channelPreanalysisConnectionRef.current.status === "checking" ||
        (channelPreanalysisConnectionRef.current.status === "connected" &&
          channelPreanalysisConnectionRef.current.basis === "manual-pasted")
      ) {
        replaceChannelPreanalysisConnection({ status: "not-found" });
      }
      return;
    }

    /*
     * A pasted URL is an explicit editor choice. Do not leave a different
     * probable/catalog identity attached in parallel, because that would feed
     * one video ID to captions while presenting another video's roster/bundle.
     */
    if (sourceReady && analysisStartOperation.current === null) {
      replaceChannelPreanalysisConnection({ status: "checking" });
    }
  };

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
      preparedChannelReview.status === "checking" ||
      channelPreanalysisConfirmationPending ||
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
    setPipelineCertification({ status: "idle" });
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
    const selectedCaptionVideoId =
      currentChannelPreanalysisTrust.durableCaptionVideoId;
    setAnalysisCaptionVideoId(selectedCaptionVideoId);
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
        selectedCaptionVideoId,
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
    const waitForDurableCheckpointRetry = (): Promise<void> =>
      new Promise((resolve, reject) => {
        let timer: ReturnType<typeof globalThis.setTimeout> | null =
          globalThis.setTimeout(() => {
            timer = null;
            controller.signal.removeEventListener("abort", onAbort);
            resolve();
          }, 2_000);
        const onAbort = (): void => {
          if (timer !== null) {
            globalThis.clearTimeout(timer);
            timer = null;
          }
          controller.signal.removeEventListener("abort", onAbort);
          reject(
            new LocalVideoVisualAnalysisError(
              "ABORTED",
              "사용자가 영상 분석을 취소했어요.",
            ),
          );
        };
        controller.signal.addEventListener("abort", onAbort, { once: true });
      });
    const runDurableCheckpoint = async (
      checkpoint: string,
      run: (
        operationToken: string,
        isCurrent: (identity: {
          readonly runId: string;
          readonly operationToken: string;
        }) => boolean,
      ) => Promise<DurableAnalysisJobOperationResult>,
    ): Promise<void> => {
      let retryCycle = 0;
      for (;;) {
        if (!assertActiveOperation()) {
          throw new AnalysisResultStoreError(
            "TRANSACTION_FAILED",
            `The ${checkpoint} checkpoint became stale.`,
          );
        }
        const operationToken =
          `analysis-job:${runId}:${checkpoint}:${retryCycle}`;
        const isCurrent = (identity: {
          readonly runId: string;
          readonly operationToken: string;
        }): boolean =>
          isMounted.current &&
          operationEpoch === analysisOperationEpoch.current &&
          !controller.signal.aborted &&
          identity.runId === runId &&
          identity.operationToken === operationToken;
        const result = await run(operationToken, isCurrent);
        if (result.status === "succeeded") {
          return;
        }
        if (result.status === "retry-exhausted") {
          retryCycle += 1;
          await waitForDurableCheckpointRetry();
          continue;
        }
        if (result.status === "aborted") {
          assertActiveOperation();
        }
        throw new AnalysisResultStoreError(
          "TRANSACTION_FAILED",
          `The ${checkpoint} checkpoint failed: ${
            "reasonCode" in result ? result.reasonCode : result.status
          }`,
        );
      }
    };
    const runDurableArtifactCheckpoint = async <Value,>(
      checkpoint: string,
      run: (
        operationToken: string,
        isCurrent: (identity: {
          readonly runId: string;
          readonly operationToken: string;
        }) => boolean,
      ) => Promise<
        | { readonly status: "succeeded"; readonly value: Value }
        | {
            readonly status: "retry-exhausted";
            readonly reasonCode: string;
          }
        | { readonly status: "aborted" }
        | { readonly status: "stale"; readonly reasonCode: string }
        | {
            readonly status: "permanent-failure";
            readonly reasonCode: string;
          }
      >,
    ): Promise<Value> => {
      let retryCycle = 0;
      for (;;) {
        if (!assertActiveOperation()) {
          throw new AnalysisResultStoreError(
            "TRANSACTION_FAILED",
            `The ${checkpoint} artifact checkpoint became stale.`,
          );
        }
        const operationToken =
          `fast-artifact:${runId}:${checkpoint}:${retryCycle}`;
        const isCurrent = (identity: {
          readonly runId: string;
          readonly operationToken: string;
        }): boolean =>
          isMounted.current &&
          operationEpoch === analysisOperationEpoch.current &&
          !controller.signal.aborted &&
          identity.runId === runId &&
          identity.operationToken === operationToken;
        const result = await run(operationToken, isCurrent);
        if (result.status === "succeeded") {
          return result.value;
        }
        if (result.status === "retry-exhausted") {
          retryCycle += 1;
          await waitForDurableCheckpointRetry();
          continue;
        }
        if (result.status === "aborted") {
          assertActiveOperation();
        }
        throw new AnalysisResultStoreError(
          "TRANSACTION_FAILED",
          `The ${checkpoint} artifact checkpoint failed: ${
            "reasonCode" in result ? result.reasonCode : result.status
          }`,
        );
      }
    };
    const commitDurableJobStage = async (
      stage: AnalysisStage,
      recordTiming = true,
    ): Promise<void> => {
      await runDurableCheckpoint(stage, (operationToken, isCurrent) =>
        commitDurableAnalysisStage({
          store,
          inputSignature,
          runId,
          operationToken,
          isCurrent,
          signal: controller.signal,
          stage,
        }),
      );
      if (recordTiming) {
        stageTimerRef.current?.mark(stage, Date.now());
      }
      setCommittedAnalysisStage(stage);
    };

    try {
      inputSignature = await createContentFingerprint([
        sourceContentFingerprint,
        sourceCheck.sourceDefinitionId,
        String(durableInput.source.durationMs),
        chatContentFingerprint ?? "no-chat",
        String(durableInput.chat.offsetMs),
        durableInput.chat.timestampBasis,
        SIGNAL_ENGINE_VERSION,
        durableInput.source.captionVideoId ?? "no-caption",
      ]);
      if (!assertActiveOperation()) {
        return;
      }

      /*
       * 작업 층에 이 실행을 등록한다.
       *
       * The durable job cursor is the resume point, so the next phase may not
       * start until this run-fenced transition has survived a store readback.
       * Transient storage failures recover at this boundary instead of
       * discarding the analysis that produced it.
       */
      committedStagesRef.current.clear();
      setCommittedAnalysisStage(null);
      stageTimerRef.current = new StageTimer(durableInput.source.durationMs);
      stageTimerRef.current.begin(Date.now());
      await runDurableCheckpoint("start", (operationToken, isCurrent) =>
        startDurableAnalysisJob({
          store,
          inputSignature,
          runId,
          operationToken,
          isCurrent,
          signal: controller.signal,
        }),
      );

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

      const manifestRecord: AnalysisManifestRecord = {
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
      };
      await runDurableArtifactCheckpoint(
        "manifest",
        (operationToken, isCurrent) =>
          commitDurableFastPassManifest({
            store,
            runId,
            operationToken,
            isCurrent,
            signal: controller.signal,
            manifest: manifestRecord,
          }),
      );
      if (!assertActiveOperation()) {
        return;
      }
      machine = applyAnalysisEvent(machine, {
        type: "RUN_MANIFEST_COMMITTED",
        workerEpoch: workerEpochValue,
      });
      setAnalysisRun(machine);
      await commitDurableJobStage("preflight");

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
      stageTimerRef.current?.mark("fastPass", Date.now());

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
      stageTimerRef.current?.mark("seedClustering", Date.now());

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
      const coverageDisposition = durableCoverageDisposition(coverage);
      setAnalysisCommitPending(true);
      const finalResultCommitId = createOperationId("result");
      const finalResultRecord: FinalAnalysisResultRecord = {
        kind: "finalResult",
        runId,
        artifactId: finalResultCommitId,
        schemaVersion: PERSISTENCE_SCHEMA_VERSION,
        inputSignature,
        modelManifestHash: SIGNAL_ENGINE_VERSION,
        result: finalPayload,
        recordedAt: new Date().toISOString(),
      };
      const terminalOutcome = coverageDisposition;
      const plannedCoverageComplete =
        terminalOutcome === "completed" &&
        coverage.visualCoverageComplete &&
        coverage.visualCompletedSampleCount ===
          coverage.visualPlannedSampleCount &&
        coverage.chatCoverageComplete &&
        coverage.chatProcessedMessageCount ===
          coverage.chatPlannedMessageCount &&
        coverage.audioCoverageComplete === true &&
        coverage.audioProcessedWindowCount ===
          coverage.audioPlannedWindowCount;
      const reopenedGapCount =
        (coverage.chatCoverageComplete ? 0 : 1) +
        (coverage.audioCoverageComplete === false ? 1 : 0);
      const gappedCoverageExplained =
        terminalOutcome === "completedWithGaps" &&
        reopenedGapCount > 0 &&
        coverage.signalGapApproval?.policyId === SIGNAL_GAP_POLICY_ID &&
        coverage.signalGapApproval.disclosedBeforeStart &&
        coverage.signalGapApproval.approvals.length === reopenedGapCount;
      const terminalRecord: AnalysisTerminalRecord = {
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
      const durableFastResult = await runDurableArtifactCheckpoint(
        "result-bundle",
        (operationToken, isCurrent) =>
          commitDurableFastPassResult({
            store,
            runId,
            operationToken,
            isCurrent,
            signal: controller.signal,
            manifest: manifestRecord,
            finalResult: finalResultRecord,
            terminal: terminalRecord,
          }),
      );
      if (!assertActiveOperation()) {
        return;
      }

      const reopenedPayload = durableFastResult.finalResult.result;
      const reopenedCoverage = reopenedPayload.coverage;
      machine = applyAnalysisEvent(machine, { type: "CHUNK_COMMIT_SUCCEEDED" });
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
      machine = applyAnalysisEvent(machine, {
        type: "FINAL_RESULT_COMMITTED",
        commitId: finalResultCommitId,
      });
      /*
       * The job cursor is only a resume promise. No stage may move beyond work
       * that cannot be reopened, so all three fast stages advance only after
       * manifest + final result + terminal disposition passed exact readback.
       */
      await commitDurableJobStage("fastPass", false);
      await commitDurableJobStage("seedClustering", false);
      await commitDurableJobStage("commitFastResult");
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
      if (analysisAbortController.current === controller) {
        analysisAbortController.current = null;
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
            const terminalRecord: AnalysisTerminalRecord = {
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
          /*
           * 실패와 취소를 다른 상태로 남긴다. 둘 다 "안 끝났다" 지만 다음에 할
           * 일이 다르다 — 실패는 다시 시도할 것이고, 취소는 사용자가 미룬 것이다.
           * 같은 상태로 묶으면 시트가 둘에게 같은 버튼을 준다.
           */
          const failureJobToken =
            `analysis-failure:${runId}:LOCAL_ANALYSIS_FAILED`;
          const durableFailureJob = await failDurableAnalysisJob({
            store,
            inputSignature,
            runId,
            operationToken: failureJobToken,
            isCurrent: (identity) =>
              isMounted.current &&
              operationEpoch === analysisOperationEpoch.current &&
              identity.runId === runId &&
              identity.operationToken === failureJobToken,
            reasonCode: "LOCAL_ANALYSIS_FAILED",
          });
          if (durableFailureJob.status !== "succeeded") {
            console.warn(
              "The failed analysis job checkpoint could not be confirmed.",
              durableFailureJob,
            );
          }
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
            const terminalRecord: AnalysisTerminalRecord = {
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
  runSignalAnalysisRef.current = runSignalAnalysis;

  const cancelAnalysis = (): void => {
    const controller = analysisAbortController.current;
    if (analysisCancelPending || analysisCommitPending || controller === null) {
      return;
    }
    setAnalysisCancelPending(true);
    controller.abort();
    // 멈춤은 폐기가 아니다. 확정된 스테이지를 남겨 두는 것이 그 차이이며,
    // 그래서 취소는 작업을 지우지 않고 `paused` 로 보낸다.
    if (analysisRun !== null) {
      const pausedRun = analysisRun;
      const pauseToken = `analysis-pause:${pausedRun.runId}`;
      void pauseDurableAnalysisJob({
        store: getResultStore(),
        inputSignature: pausedRun.inputSignature,
        runId: pausedRun.runId,
        operationToken: pauseToken,
        isCurrent: (identity) =>
          identity.runId === pausedRun.runId &&
          identity.operationToken === pauseToken,
      }).then((result) => {
        if (result.status !== "succeeded" && result.status !== "stale") {
          console.warn(
            "The paused analysis checkpoint could not be confirmed.",
            result,
          );
        }
      });
    }
    // The uniform transcript prefetch spends against the same consent as the
    // run, so cancelling the run stops it too. The fence stays cleared and the
    // gate blocks a restart because the run is no longer live.
    if (broadcastTranscriptAbortController.current !== null) {
      broadcastTranscriptAbortController.current.abort();
      broadcastTranscriptAbortController.current = null;
      autoBroadcastTranscriptSourceRef.current = null;
      sealedBroadcastTranscriptSourceRef.current = null;
      allowAmbiguousTranscriptRetryRef.current = false;
      broadcastTranscriptRouteChangeCountRef.current = 0;
      setBroadcastTranscriptStatus("idle");
      setBroadcastTranscriptProgress(null);
      setBroadcastTranscriptRecoveryProgress(null);
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

  const ensureCandidatePassBPlanPersistence = async (
    plannedCandidateIds: readonly string[] = candidateDetailCandidateIds,
  ): Promise<CandidatePassBInsightsRecord> => {
    const runId = currentAnalysisRunId;
    const inputSignature = currentAnalysisInputSignature;
    if (
      runId === null ||
      inputSignature === null ||
      broadcastContextStatus !== "completed" ||
      semanticLeadRefinementStatus !== "completed"
    ) {
      throw new Error(
        "Candidate detail planning requires the completed current broadcast context.",
      );
    }
    if (
      plannedCandidateIds.length > CANDIDATE_PASS_B_PLAN_MAX_CANDIDATES ||
      new Set(plannedCandidateIds).size !== plannedCandidateIds.length ||
      plannedCandidateIds.some(
        (candidateId) => candidatePassBContextById[candidateId] === undefined,
      )
    ) {
      throw new Error(
        "Candidate detail planning requires one complete context packet per planned candidate.",
      );
    }

    const store = getResultStore();
    const session = await store.getBroadcastContextSession(runId);
    if (
      session === null ||
      session.inputSignature !== inputSignature ||
      session.contextInputSignature === null ||
      session.contextPhaseLedgerJson === null ||
      session.transcriptSealOperationKey === null ||
      session.participantGroundingInputSignature === null ||
      session.contextResultJson === null
    ) {
      throw new Error(
        "The exact durable broadcast context is not ready for candidate detail planning.",
      );
    }
    const contextLedger = parseBroadcastContextPhaseLedgerJson(
      session.contextPhaseLedgerJson,
    );
    if (
      contextLedger === null ||
      !broadcastContextPhaseLedgerMatchesFence(contextLedger, {
        parentContextSignature: session.contextInputSignature,
        transcriptSignature: session.transcriptSealOperationKey,
        groundingSignature: session.participantGroundingInputSignature,
      }) ||
      contextLedger.units.some(
        (unit) => unit.required && unit.status !== "succeeded",
      )
    ) {
      throw new Error(
        "The current broadcast context ledger is not fully settled.",
      );
    }
    if (semanticRefinementEvidenceProjectionFingerprint === null) {
      if (
        session.refinementTranscriptInputSignature !== null ||
        session.refinementTranscriptCheckpointJson !== null ||
        session.refinementEvidenceLedgerJson !== null ||
        session.refinementInputSignature !== null ||
        session.refinementCandidatesJson !== null ||
        contextLedger.units.some(
          (unit) => unit.required && unit.phase === "refinement",
        )
      ) {
        throw new Error(
          "The zero-refinement plan retained stale refinement artifacts.",
        );
      }
    } else {
      const refinementLedger =
        await parseBroadcastContextSessionRefinementEvidenceLedger(session);
      const activeProjection =
        refinementLedger === null
          ? null
          : projectBroadcastRefinementActiveEvidenceRoute(refinementLedger);
      if (
        refinementLedger === null ||
        !broadcastRefinementEvidenceLedgerCanPublish(refinementLedger) ||
        activeProjection === null ||
        !activeProjection.publicationEligible ||
        activeProjection.projectionFingerprint !==
          semanticRefinementEvidenceProjectionFingerprint
      ) {
        throw new Error(
          "The active refinement evidence does not match the candidate detail plan.",
        );
      }
    }
    const plannedContextByCandidateId = Object.fromEntries(
      plannedCandidateIds.map((candidateId) => [
        candidateId,
        candidatePassBContextById[candidateId]!,
      ]),
    );
    const planReceipt = await createCandidatePassBPlanReceipt({
      runId,
      inputSignature,
      contextInputSignature: session.contextInputSignature,
      refinementEvidenceProjectionFingerprint:
        semanticRefinementEvidenceProjectionFingerprint,
      plannedCandidateIds,
      contextByCandidateId: plannedContextByCandidateId,
    });
    const operationKey = planReceipt.planFingerprint;
    const preparation = candidatePassBPlanPreparationRef.current;
    if (
      preparation.operationKey === operationKey &&
      preparation.promise !== null
    ) {
      return preparation.promise;
    }

    const durableSnapshot =
      candidatePassBDurableInsightsRef.current?.runId === runId
        ? candidatePassBDurableInsightsRef.current
        : null;
    if (
      !candidatePassBPlanReplacementRequiredRef.current &&
      durableSnapshot !== null &&
      JSON.stringify(durableSnapshot.planReceipt) ===
        JSON.stringify(planReceipt)
    ) {
      candidatePassBPlanReceiptRef.current = planReceipt;
      setCandidatePassBDurableInsights(durableSnapshot);
      setCandidatePassBInsightPersistenceStatus("verified");
      return durableSnapshot;
    }

    const writeEpoch = candidatePassBInsightWriteEpochRef.current;
    const planOnlyRecord: CandidatePassBInsightsRecord = {
      kind: "candidatePassBInsights",
      runId,
      schemaVersion: CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION,
      inputSignature,
      modelManifestHash: CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
      planReceipt,
      contextByCandidateId: plannedContextByCandidateId,
      evidenceById: {},
      insightById: {},
      modelByCandidateId: {},
      thumbnailById: {},
      attemptLedgerByCandidateId: {},
      dispatchIntentByCandidateId: {},
      settlementByCandidateId: {},
      verificationReceiptById: {},
      recordedAt: new Date().toISOString(),
    };
    if (isMounted.current) {
      setCandidatePassBInsightPersistenceStatus("pending");
    }
    const writePromise = candidatePassBInsightWriteChainRef.current
      .catch(() => undefined)
      .then(async () => {
        if (candidatePassBInsightWriteEpochRef.current !== writeEpoch) {
          throw new Error("The candidate detail plan was superseded.");
        }
        const latestSnapshot =
          await store.getCandidatePassBInsights(runId);
        if (
          latestSnapshot !== null &&
          latestSnapshot.inputSignature !== inputSignature
        ) {
          throw new Error(
            "A different source owns the durable candidate detail slot.",
          );
        }
        const restored = await persistCandidatePassBInsightsWithReadback(
          store,
          latestSnapshot,
          planOnlyRecord,
          undefined,
          (current, pending) =>
            current.runId === pending.runId &&
            current.inputSignature === pending.inputSignature
              ? pending
              : null,
        );
        if (
          candidatePassBInsightWriteEpochRef.current !== writeEpoch ||
          JSON.stringify(restored.planReceipt) !== JSON.stringify(planReceipt)
        ) {
          throw new Error(
            "The candidate detail plan could not be verified after persistence.",
          );
        }
        candidatePassBPlanReceiptRef.current = restored.planReceipt;
        candidatePassBPlanReplacementRequiredRef.current = false;
        candidatePassBDurableInsightsRef.current = restored;
        candidatePassBPendingInsightsRef.current = null;
        candidatePassBInsightPersistenceFailureRef.current = null;
        if (isMounted.current) {
          setCandidatePassBDurableInsights(restored);
          setCandidatePassBInsightPersistenceStatus("verified");
        }
        return restored;
      })
      .catch((error: unknown) => {
        if (
          isMounted.current &&
          candidatePassBInsightWriteEpochRef.current === writeEpoch
        ) {
          setCandidatePassBInsightPersistenceStatus("failed");
          setCandidatePassBError(
            "후보 상세 분석 계획을 저장하고 다시 확인하지 못했어요. 저장된 지점부터 자동으로 다시 시도합니다.",
          );
        }
        throw error;
      });
    candidatePassBInsightWriteChainRef.current = writePromise.then(
      () => undefined,
      () => undefined,
    );
    candidatePassBPlanPreparationRef.current = {
      operationKey,
      promise: writePromise,
    };
    void writePromise.then(
      () => {
        if (
          candidatePassBPlanPreparationRef.current.operationKey === operationKey
        ) {
          candidatePassBPlanPreparationRef.current = {
            operationKey,
            promise: null,
          };
        }
      },
      () => {
        if (
          candidatePassBPlanPreparationRef.current.operationKey === operationKey
        ) {
          candidatePassBPlanPreparationRef.current = {
            operationKey,
            promise: null,
          };
        }
      },
    );
    return writePromise;
  };
  ensureCandidatePassBPlanPersistenceRef.current =
    ensureCandidatePassBPlanPersistence;

  const queueCandidatePassBInsightPersistence = (
    planReceipt: CandidatePassBPlanReceipt,
    evidenceById: CandidatePassBEvidenceById,
    insightById: CandidateGeminiInsightById,
    thumbnailById: CandidateTimelineThumbnailById = firstTimelineFrameById(
      candidateTimelineFramesRef.current,
    ),
    modelByCandidateId: CandidatePassBModelById =
      candidatePassBModelByIdRef.current,
    verificationReceiptById: CandidatePassBVerificationReceiptById =
      candidatePassBVerificationReceiptRef.current,
    dispatchIntentByCandidateId: Readonly<
      Record<string, CandidatePassBDispatchIntent>
    > = candidatePassBDispatchIntentRef.current,
    settlementByCandidateId: Readonly<
      Record<string, CandidatePassBTerminalSettlement>
    > = candidatePassBSettlementRef.current,
    attemptLedgerByCandidateId: Readonly<
      Record<string, CandidatePassBAttemptLedger>
    > = candidatePassBAttemptLedgerRef.current,
  ): Promise<CandidatePassBInsightsRecord | null> => {
    const runId = currentAnalysisRunId;
    const inputSignature = currentAnalysisInputSignature;
    if (runId === null || inputSignature === null) {
      return Promise.resolve(null);
    }
    const activePlanReceipt = candidatePassBPlanReceiptRef.current;
    if (
      activePlanReceipt === null ||
      JSON.stringify(activePlanReceipt) !== JSON.stringify(planReceipt) ||
      planReceipt.runId !== runId ||
      planReceipt.inputSignature !== inputSignature
    ) {
      return Promise.reject(
        new CandidatePassBInsightPersistenceError(
          new Error(
            "The exact Candidate Pass B plan must be durable before candidate artifacts.",
          ),
        ),
      );
    }
    const plannedCandidateIdSet = new Set(planReceipt.plannedCandidateIds);
    const artifactMaps = [
      evidenceById,
      insightById,
      thumbnailById,
      modelByCandidateId,
      verificationReceiptById,
      dispatchIntentByCandidateId,
      settlementByCandidateId,
      attemptLedgerByCandidateId,
    ];
    if (
      artifactMaps.some((entries) =>
        Object.keys(entries).some(
          (candidateId) => !plannedCandidateIdSet.has(candidateId),
        ),
      )
    ) {
      return Promise.reject(
        new CandidatePassBInsightPersistenceError(
          new Error(
            "Candidate artifacts do not belong to the exact durable plan.",
          ),
        ),
      );
    }
    const missingContextCandidateId = planReceipt.plannedCandidateIds.find(
      (candidateId) => candidatePassBContextById[candidateId] === undefined,
    );
    if (missingContextCandidateId !== undefined) {
      return Promise.reject(
        new CandidatePassBInsightPersistenceError(
          new Error(
            "A planned candidate is missing its exact broadcast context packet.",
          ),
        ),
      );
    }
    const plannedContextByCandidateId = Object.fromEntries(
      planReceipt.plannedCandidateIds.map((candidateId) => [
        candidateId,
        candidatePassBContextById[candidateId]!,
      ]),
    );
    const writeEpoch = candidatePassBInsightWriteEpochRef.current;
    const durableThumbnailById =
      selectCandidatePassBDurableThumbnailById({
        thumbnailById,
        evidenceById,
        insightById,
        modelByCandidateId,
        verificationReceiptById,
        dispatchIntentByCandidateId,
        settlementByCandidateId,
        attemptLedgerByCandidateId,
      });
    const record: CandidatePassBInsightsRecord = {
      kind: "candidatePassBInsights",
      runId,
      schemaVersion: CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION,
      inputSignature,
      modelManifestHash: CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
      planReceipt,
      contextByCandidateId: plannedContextByCandidateId,
      evidenceById,
      insightById,
      modelByCandidateId,
      thumbnailById: durableThumbnailById,
      attemptLedgerByCandidateId,
      dispatchIntentByCandidateId,
      settlementByCandidateId,
      verificationReceiptById,
      recordedAt: new Date().toISOString(),
    };
    const pendingBase =
      candidatePassBPendingInsightsRef.current?.runId === runId
        ? candidatePassBPendingInsightsRef.current
        : candidatePassBDurableInsightsRef.current?.runId === runId &&
            JSON.stringify(
              candidatePassBDurableInsightsRef.current.planReceipt,
            ) === JSON.stringify(planReceipt)
          ? candidatePassBDurableInsightsRef.current
          : null;
    const cumulativeRecord =
      pendingBase === null
        ? record
        : mergeCandidatePassBInsightsForResume(pendingBase, record);
    if (cumulativeRecord === null) {
      return Promise.reject(
        new CandidatePassBInsightPersistenceError(
          new Error(
            "Concurrent candidate artifacts could not be reconciled without losing evidence.",
          ),
        ),
      );
    }
    /*
     * Keep the cumulative terminal payload before awaiting IndexedDB. A
     * provider result must survive a transient write/readback failure without
     * making the paid request run again.
     */
    candidatePassBPendingInsightsRef.current = cumulativeRecord;
    if (
      isMounted.current &&
      candidatePassBIdentity.current?.analysisRunId === runId
    ) {
      setCandidatePassBInsightPersistenceStatus("pending");
    }
    const writePromise = candidatePassBInsightWriteChainRef.current
      .catch(() => undefined)
      .then(async () => {
        if (candidatePassBInsightWriteEpochRef.current !== writeEpoch) {
          return null;
        }
        const pendingSnapshot =
          candidatePassBPendingInsightsRef.current?.runId === runId
            ? candidatePassBPendingInsightsRef.current
            : cumulativeRecord;
        const store = getResultStore();
        const expectedSnapshot = await store.getCandidatePassBInsights(runId);
        if (
          expectedSnapshot !== null &&
          expectedSnapshot.inputSignature !== inputSignature
        ) {
          throw new Error(
            "A different source owns the durable candidate detail slot.",
          );
        }
        const replacementSnapshot =
          expectedSnapshot === null
            ? pendingSnapshot
            : mergeCandidatePassBInsightsForResume(
                expectedSnapshot,
                pendingSnapshot,
              );
        if (replacementSnapshot === null) {
          throw new Error(
            "The newest durable candidate snapshot conflicts with pending evidence.",
          );
        }
        const restored = await persistCandidatePassBInsightsWithReadback(
          store,
          expectedSnapshot,
          replacementSnapshot,
        );
        if (candidatePassBInsightWriteEpochRef.current === writeEpoch) {
          const newestPending = candidatePassBPendingInsightsRef.current;
          if (newestPending === pendingSnapshot) {
            candidatePassBPendingInsightsRef.current = null;
          } else if (newestPending?.runId === runId) {
            const rebasedPending = mergeCandidatePassBInsightsForResume(
              restored,
              newestPending,
            );
            if (rebasedPending === null) {
              throw new Error(
                "New candidate evidence arrived with a conflicting durable identity.",
              );
            }
            candidatePassBPendingInsightsRef.current = rebasedPending;
          }
          candidatePassBInsightPersistenceFailureRef.current = null;
          candidatePassBDurableInsightsRef.current = restored;
          if (
            isMounted.current &&
            candidatePassBIdentity.current?.analysisRunId === runId
          ) {
            setCandidatePassBDurableInsights(restored);
            setCandidatePassBInsightPersistenceStatus(
              candidatePassBPendingInsightsRef.current === null
                ? "verified"
                : "pending",
            );
          }
        }
        return restored;
      })
      .catch((error: unknown) => {
        if (candidatePassBInsightWriteEpochRef.current === writeEpoch) {
          candidatePassBInsightPersistenceFailureRef.current = error;
        }
        if (isMounted.current && candidatePassBIdentity.current?.analysisRunId === runId) {
          setCandidatePassBInsightPersistenceStatus("failed");
          setCandidatePassBError(
            "AI 결과를 저장하고 다시 확인하지 못했어요. 현재 화면에서는 볼 수 있지만 저장 확인 전에는 최종 후보로 올리지 않습니다.",
          );
        }
        throw new CandidatePassBInsightPersistenceError(error);
      });
    candidatePassBInsightWriteChainRef.current = writePromise.then(
      () => undefined,
      () => undefined,
    );
    return writePromise;
  };

  const flushCandidatePassBInsightPersistence = async (): Promise<void> => {
    await candidatePassBInsightWriteChainRef.current;
    if (
      candidatePassBPendingInsightsRef.current !== null &&
      candidatePassBInsightPersistenceFailureRef.current !== null
    ) {
      throw new CandidatePassBInsightPersistenceError(
        candidatePassBInsightPersistenceFailureRef.current,
      );
    }
  };

  const retryCandidatePassBInsightPersistence = async (): Promise<boolean> => {
    try {
      const planReceipt =
        candidatePassBPlanReceiptRef.current ??
        (
          await ensureCandidatePassBPlanPersistence(
            candidateDetailCandidateIds,
          )
        ).planReceipt;
      const restored = await queueCandidatePassBInsightPersistence(
        planReceipt,
        candidatePassBEvidenceRef.current,
        candidateGeminiInsightRef.current,
        firstTimelineFrameById(candidateTimelineFramesRef.current),
        candidatePassBModelByIdRef.current,
        candidatePassBVerificationReceiptRef.current,
      );
      if (restored === null) return false;
      candidatePassBEvidenceRef.current = restored.evidenceById;
      candidateGeminiInsightRef.current = restored.insightById;
      candidatePassBModelByIdRef.current = restored.modelByCandidateId;
      const restoredTimelineFrames = Object.fromEntries(
        Object.entries(restored.thumbnailById).map(([candidateId, frame]) => [
          candidateId,
          [frame],
        ]),
      );
      candidateTimelineFramesRef.current = {
        ...candidateTimelineFramesRef.current,
        ...restoredTimelineFrames,
      };
      candidatePassBVerificationReceiptRef.current =
        restored.verificationReceiptById;
      candidatePassBDispatchIntentRef.current =
        restored.dispatchIntentByCandidateId;
      candidatePassBAttemptLedgerRef.current =
        restored.attemptLedgerByCandidateId;
      candidatePassBSettlementRef.current = restored.settlementByCandidateId;
      if (isMounted.current) {
        setCandidatePassBEvidenceById(restored.evidenceById);
        setCandidateGeminiInsightById(restored.insightById);
        setCandidateTimelineFramesById(candidateTimelineFramesRef.current);
        setCandidatePassBVerificationReceiptById(
          restored.verificationReceiptById,
        );
        setCandidatePassBDurableInsights(restored);
        setCandidatePassBInsightPersistenceStatus(
          candidatePassBPendingInsightsRef.current === null
            ? "verified"
            : "pending",
        );
        setCandidatePassBError(null);
      }
      return true;
    } catch {
      // The queued write already records a visible, retryable persistence error.
      return false;
    }
  };
  retryCandidatePassBInsightPersistenceRef.current =
    retryCandidatePassBInsightPersistence;

  const ensureCandidatePassBRetryGrant = async (
    candidateId: string,
    mode: CandidatePassBRetryGrantMode,
    planReceipt: CandidatePassBPlanReceipt,
  ): Promise<boolean> => {
    const durableRecord = candidatePassBDurableInsightsRef.current;
    if (durableRecord === null) return true;
    const currentLedger =
      durableRecord.attemptLedgerByCandidateId[candidateId];
    if (currentLedger === undefined) return true;
    const state = candidatePassBAttemptLedgerState(currentLedger);
    if (state === "auto-eligible") return true;
    const activeAttempt = currentLedger.attempts.at(-1);
    const durableDispatch =
      durableRecord.dispatchIntentByCandidateId[candidateId];
    const durableSettlement =
      durableRecord.settlementByCandidateId[candidateId];
    if (
      JSON.stringify(durableRecord.planReceipt) !==
        JSON.stringify(planReceipt) ||
      activeAttempt === undefined ||
      activeAttempt.settlement === null ||
      activeAttempt.settlement.status !== "outcome-unknown" ||
      JSON.stringify(activeAttempt.dispatchIntent) !==
        JSON.stringify(durableDispatch) ||
      JSON.stringify(activeAttempt.settlement) !==
        JSON.stringify(durableSettlement) ||
      (mode === "automatic-free-tier" &&
        activeAttempt.dispatchIntent.transportMode !== "free-r2") ||
      (mode === "editor-approved-paid" &&
        activeAttempt.dispatchIntent.transportMode !== "paid-direct")
    ) {
      return false;
    }
    const consumedGrantIds = new Set(
      currentLedger.attempts.flatMap(({ retryGrantId }) =>
        retryGrantId === null ? [] : [retryGrantId],
      ),
    );
    const pendingGrant = currentLedger.retryGrants.find(
      ({ grantId }) => !consumedGrantIds.has(grantId),
    );
    if (state === "retry-granted") {
      return pendingGrant?.mode === mode;
    }
    if (state !== "blocked") return false;
    let nextLedger: CandidatePassBAttemptLedger;
    try {
      nextLedger = issueCandidatePassBRetryGrant(currentLedger, {
        schemaVersion: CANDIDATE_PASS_B_RETRY_GRANT_SCHEMA_VERSION,
        grantId: createOperationId("candidate-pass-b-retry-grant"),
        candidateId,
        replacesOperationId:
          activeAttempt.dispatchIntent.operationId,
        nextAttemptOrdinal: currentLedger.attempts.length,
        mode,
      });
    } catch {
      return false;
    }
    const nextLedgers = {
      ...durableRecord.attemptLedgerByCandidateId,
      [candidateId]: nextLedger,
    };
    try {
      const restored = await queueCandidatePassBInsightPersistence(
        planReceipt,
        durableRecord.evidenceById,
        durableRecord.insightById,
        durableRecord.thumbnailById,
        durableRecord.modelByCandidateId,
        durableRecord.verificationReceiptById,
        durableRecord.dispatchIntentByCandidateId,
        durableRecord.settlementByCandidateId,
        nextLedgers,
      );
      if (
        restored === null ||
        JSON.stringify(restored.attemptLedgerByCandidateId[candidateId]) !==
          JSON.stringify(nextLedger)
      ) {
        return false;
      }
      candidatePassBAttemptLedgerRef.current =
        restored.attemptLedgerByCandidateId;
      return true;
    } catch {
      return false;
    }
  };

  const runCandidatePassB = async (
    targetCandidateIds?: readonly string[],
    /**
     * Set by the automatic trigger so the "already handled" guard can be
     * claimed only after the worker is prepared. The lease is retained after
     * exact durable readback, or released with backoff when evidence remains
     * outstanding.
     */
    autoStartKey?: string,
    paidRetryApproved = false,
  ): Promise<void> => {
    const requestedCandidateIds =
      targetCandidateIds === undefined ? null : new Set(targetCandidateIds);
    const requestedCandidatePool =
      requestedCandidateIds === null
        ? candidates
        : candidates.filter((candidate) => requestedCandidateIds.has(candidate.id));
    let candidatePool = requestedCandidatePool.filter(
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
    let planLease: CandidatePassBPlanReceipt;
    try {
      const plannedRecord = await ensureCandidatePassBPlanPersistence(
        candidateDetailCandidateIds,
      );
      planLease = plannedRecord.planReceipt;
    } catch {
      candidatePassBStartPendingRef.current = false;
      setCandidatePassBStartPending(false);
      return;
    }
    if (candidatePool.length === 0) {
      candidatePassBStartPendingRef.current = false;
      setCandidatePassBStartPending(false);
      return;
    }
    const retryEligibleCandidates = [];
    for (const candidate of candidatePool) {
      const ledger =
        candidatePassBDurableInsightsRef.current
          ?.attemptLedgerByCandidateId[candidate.id];
      if (
        ledger === undefined ||
        candidatePassBAttemptLedgerState(ledger) === "auto-eligible" ||
        candidatePassBAttemptLedgerState(ledger) === "retry-granted"
      ) {
        retryEligibleCandidates.push(candidate);
        continue;
      }
      const activeAttempt = ledger.attempts.at(-1);
      const retryMode: CandidatePassBRetryGrantMode | null =
        activeAttempt?.dispatchIntent.transportMode === "free-r2"
          ? "automatic-free-tier"
          : paidRetryApproved
            ? "editor-approved-paid"
            : null;
      if (
        retryMode !== null &&
        await ensureCandidatePassBRetryGrant(
          candidate.id,
          retryMode,
          planLease,
        )
      ) {
        retryEligibleCandidates.push(candidate);
      }
    }
    candidatePool = retryEligibleCandidates;
    if (candidatePool.length === 0) {
      candidatePassBStartPendingRef.current = false;
      setCandidatePassBStartPending(false);
      return;
    }
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
    const candidateFailureReasonById = new Map<
      string,
      "visual_evidence_incomplete"
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
      candidatePassBMachine.current = null;
      candidatePassBIdentity.current = null;
      setCandidatePassBRun(null);
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
      applyCandidatePassBEvent({
        ...identity,
        eventId: createOperationId("pass-b-event"),
        type: "RUN_FAILED",
        reasonCode: "protocol_error",
      });
      setCandidatePassBError("AI 후보 분석 작업을 준비하지 못했어요. 다시 시도해 주세요.");
      return;
    }

    const isCurrentOperation = (): boolean =>
      isMounted.current &&
      operationEpoch === candidatePassBOperationEpoch.current &&
      candidatePassBIdentity.current?.passBRunId === identity.passBRunId;
    const targetById = new Map(targets.map((target) => [target.candidateId, target]));
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
    if (autoStartKey !== undefined) {
      autoCandidatePassBSourceRef.current = autoStartKey;
      const autoRetry = candidatePassBAutoRetryRef.current;
      if (autoRetry.operationKey !== autoStartKey) {
        if (autoRetry.timeout !== null) {
          globalThis.clearTimeout(autoRetry.timeout);
        }
        autoRetry.operationKey = autoStartKey;
        autoRetry.attempts = 0;
        autoRetry.timeout = null;
      }
    }

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
      const workerSettlements = await mapSettledWithConcurrency(
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
            const sourceFence =
              candidatePassBSourceFenceById[target.candidateId];
             if (
               sourceFence === undefined ||
              sourceFence.sourceStartMs !== target.decodeStartMs ||
              sourceFence.sourceEndMs !== target.decodeEndMs
            ) {
              throw new Error(
                 "The candidate source fence no longer matches its decode target.",
               );
             }
             const currentAttemptLedger =
               candidatePassBAttemptLedgerRef.current[target.candidateId] ??
               createCandidatePassBAttemptLedger(target.candidateId);
             const candidateAttemptOrdinal =
               currentAttemptLedger.attempts.length;
             const consumedRetryGrantIds = new Set(
               currentAttemptLedger.attempts.flatMap(({ retryGrantId }) =>
                 retryGrantId === null ? [] : [retryGrantId],
               ),
             );
             const retryGrantId =
               currentAttemptLedger.retryGrants.find(
                 ({ grantId }) => !consumedRetryGrantIds.has(grantId),
               )?.grantId ?? null;
            /*
             * 후보 하나당 한 번. `addSpan` 이 같은 이름을 합산하므로 결과는
             * 후보 전체의 총합이 된다 — 한 번의 시간이 아니라 총합이 궁금하다.
             */
            return await runCandidatePassBWorker(sourceFile, {
        identity,
         quota: {
           participantId: aiQuotaParticipantId,
           runId: identity.analysisRunId,
           attemptOrdinal: candidateAttemptOrdinal,
           retryGrantId,
         },
        sourceFingerprint: sourceBindingId,
        sourceDurationMs,
        device: runtimeDevice,
        targets: [{
          candidateId: target.candidateId,
          startMs: target.decodeStartMs,
           endMs: target.decodeEndMs,
           videoFrames: videoFramesByCandidateId.get(target.candidateId) ?? [],
           frameExtractionRevision:
             CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
           context: candidatePassBContextById[target.candidateId]!,
          contextFingerprint: candidatePassBContextFingerprint(
             candidatePassBContextById[target.candidateId]!,
           ),
          outputLanguage: sourceFence.outputLanguage,
          castRosterId: sourceFence.castRosterId,
        }],
         signal: controller.signal,
          onDispatchIntent: async (intent) => {
            if (!isCurrentOperation()) return false;
            const currentLedger =
              candidatePassBAttemptLedgerRef.current[intent.candidateId] ??
              createCandidatePassBAttemptLedger(intent.candidateId);
            const existingAttempt = currentLedger.attempts.find(
              ({ dispatchIntent }) =>
                dispatchIntent.operationId === intent.operationId,
            );
            const consumedGrantIds = new Set(
              currentLedger.attempts.flatMap(({ retryGrantId }) =>
                retryGrantId === null ? [] : [retryGrantId],
              ),
            );
            const pendingGrant = currentLedger.retryGrants.find(
              ({ grantId }) => !consumedGrantIds.has(grantId),
            );
            let nextLedger: CandidatePassBAttemptLedger;
            try {
              nextLedger = appendCandidatePassBArmedAttempt(currentLedger, {
                dispatchIntent: intent,
                retryGrantId:
                  existingAttempt?.retryGrantId ??
                  pendingGrant?.grantId ??
                  null,
              });
            } catch {
              return false;
            }
            const nextDispatchIntents = {
              ...candidatePassBDispatchIntentRef.current,
              [intent.candidateId]: intent,
            };
            const nextAttemptLedgers = {
              ...candidatePassBAttemptLedgerRef.current,
              [intent.candidateId]: nextLedger,
            };
            const replacesPriorAttempt =
              currentLedger.attempts.at(-1)?.dispatchIntent.operationId !==
                undefined &&
              currentLedger.attempts.at(-1)?.dispatchIntent.operationId !==
                intent.operationId;
            const nextEvidence = replacesPriorAttempt
              ? withoutCandidateEntry(
                  candidatePassBEvidenceRef.current,
                  intent.candidateId,
                )
              : candidatePassBEvidenceRef.current;
            const nextInsights = replacesPriorAttempt
              ? withoutCandidateEntry(
                  candidateGeminiInsightRef.current,
                  intent.candidateId,
                )
              : candidateGeminiInsightRef.current;
            const nextThumbnails = replacesPriorAttempt
              ? withoutCandidateEntry(
                  firstTimelineFrameById(candidateTimelineFramesRef.current),
                  intent.candidateId,
                )
              : firstTimelineFrameById(candidateTimelineFramesRef.current);
            const nextModels = replacesPriorAttempt
              ? withoutCandidateEntry(
                  candidatePassBModelByIdRef.current,
                  intent.candidateId,
                )
              : candidatePassBModelByIdRef.current;
            const nextReceipts = replacesPriorAttempt
              ? withoutCandidateEntry(
                  candidatePassBVerificationReceiptRef.current,
                  intent.candidateId,
                )
              : candidatePassBVerificationReceiptRef.current;
            const nextSettlements = replacesPriorAttempt
              ? withoutCandidateEntry(
                  candidatePassBSettlementRef.current,
                  intent.candidateId,
                )
              : candidatePassBSettlementRef.current;
            const restored = await queueCandidatePassBInsightPersistence(
              planLease,
              nextEvidence,
              nextInsights,
              nextThumbnails,
              nextModels,
              nextReceipts,
              nextDispatchIntents,
              nextSettlements,
              nextAttemptLedgers,
            );
            const accepted =
              restored !== null &&
              JSON.stringify(
                restored.dispatchIntentByCandidateId[intent.candidateId],
              ) === JSON.stringify(intent) &&
              JSON.stringify(
                restored.attemptLedgerByCandidateId[intent.candidateId],
              ) === JSON.stringify(nextLedger);
            if (accepted) {
              candidatePassBDispatchIntentRef.current =
                restored.dispatchIntentByCandidateId;
              candidatePassBSettlementRef.current =
                restored.settlementByCandidateId;
              candidatePassBAttemptLedgerRef.current =
                restored.attemptLedgerByCandidateId;
              candidatePassBEvidenceRef.current = nextEvidence;
              candidateGeminiInsightRef.current = nextInsights;
              candidatePassBModelByIdRef.current = nextModels;
              candidatePassBVerificationReceiptRef.current = nextReceipts;
              setCandidatePassBEvidenceById(nextEvidence);
              setCandidateGeminiInsightById(nextInsights);
              setCandidatePassBVerificationReceiptById(nextReceipts);
            }
            return accepted;
          },
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
        onPartialResult: async (
          result: CandidatePassBTranscriptResult,
        ): Promise<boolean> => {
          const target = targetById.get(result.candidateId);
          if (!isCurrentOperation() || target === undefined) {
            return false;
          }
          const evidence = buildCandidatePassBEvidence(
            target,
            result.segments.map((segment) => ({
              relativeStartMs: segment.startMs - target.decodeStartMs,
              relativeEndMs: segment.endMs - target.decodeStartMs,
              text: segment.text,
            })),
           );
           const context = candidatePassBContextById[result.candidateId];
           const thumbnail =
            candidateTimelineFramesRef.current[result.candidateId]?.[0];
           const resultMatchesSourceFence =
             result.candidateId === sourceFence.candidateId &&
             result.sourceStartMs === sourceFence.sourceStartMs &&
             result.sourceEndMs === sourceFence.sourceEndMs;
           const dispatchIntent =
              candidatePassBDispatchIntentRef.current[result.candidateId];
           const currentAttemptLedger =
             candidatePassBAttemptLedgerRef.current[result.candidateId];
           let settledAttemptLedger: CandidatePassBAttemptLedger | null = null;
           if (currentAttemptLedger !== undefined) {
             try {
               settledAttemptLedger = settleCandidatePassBAttempt(
                 currentAttemptLedger,
                 result.settlement,
               );
             } catch {
               settledAttemptLedger = null;
             }
           }
           const receipt =
              context === undefined ||
              thumbnail === undefined ||
              !resultMatchesSourceFence ||
              dispatchIntent === undefined ||
              settledAttemptLedger === null
               ? null
               : createCandidatePassBVerificationReceipt(
                   context,
                   thumbnail.timestampMs,
                   sourceFence,
                   dispatchIntent,
                   result.settlement,
                 );
           if (receipt === null || settledAttemptLedger === null) {
            candidateFailureReasonById.set(
              result.candidateId,
              "visual_evidence_incomplete",
            );
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
           const nextSettlements = {
              ...candidatePassBSettlementRef.current,
              [result.candidateId]: result.settlement,
            };
           const nextAttemptLedgers = {
             ...candidatePassBAttemptLedgerRef.current,
             [result.candidateId]: settledAttemptLedger,
           };
          const nextThumbnails = firstTimelineFrameById(
            candidateTimelineFramesRef.current,
          );
          const restored = await queueCandidatePassBInsightPersistence(
            planLease,
            nextEvidence,
            nextInsights,
            nextThumbnails,
            nextModels,
            nextReceipts,
            candidatePassBDispatchIntentRef.current,
            nextSettlements,
            nextAttemptLedgers,
          );
          if (
            !isCurrentOperation() ||
            restored === null ||
            JSON.stringify(restored.evidenceById[result.candidateId]) !==
              JSON.stringify(evidence) ||
            JSON.stringify(restored.insightById[result.candidateId]) !==
              JSON.stringify(result.insight) ||
            JSON.stringify(restored.modelByCandidateId[result.candidateId]) !==
              JSON.stringify(nextModels[result.candidateId]) ||
            JSON.stringify(restored.thumbnailById[result.candidateId]) !==
              JSON.stringify(nextThumbnails[result.candidateId]) ||
            JSON.stringify(
              restored.verificationReceiptById[result.candidateId],
            ) !== JSON.stringify(receipt) ||
            JSON.stringify(
              restored.dispatchIntentByCandidateId[result.candidateId],
            ) !== JSON.stringify(dispatchIntent) ||
            JSON.stringify(restored.settlementByCandidateId[result.candidateId]) !==
              JSON.stringify(result.settlement) ||
            JSON.stringify(
              restored.attemptLedgerByCandidateId[result.candidateId],
            ) !== JSON.stringify(settledAttemptLedger)
          ) {
            return false;
          }
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
            candidatePassBEvidenceRef.current = restored.evidenceById;
            candidateGeminiInsightRef.current = restored.insightById;
            candidatePassBModelByIdRef.current = restored.modelByCandidateId;
            candidatePassBVerificationReceiptRef.current =
              restored.verificationReceiptById;
            candidatePassBDispatchIntentRef.current =
              restored.dispatchIntentByCandidateId;
            candidatePassBSettlementRef.current =
              restored.settlementByCandidateId;
            candidatePassBAttemptLedgerRef.current =
              restored.attemptLedgerByCandidateId;
            setCandidatePassBEvidenceById(restored.evidenceById);
            setCandidateGeminiInsightById(restored.insightById);
            setCandidatePassBVerificationReceiptById(
              restored.verificationReceiptById,
            );
          }
          return true;
        },
         onOutcomeUnknown: async (outcome): Promise<boolean> => {
           const target = targetById.get(outcome.candidateId);
           if (!isCurrentOperation() || target === undefined) return false;
           const currentAttemptLedger =
             candidatePassBAttemptLedgerRef.current[outcome.candidateId];
           if (currentAttemptLedger === undefined) {
             throw new Error(
               "The outcome-unknown settlement has no armed attempt ledger.",
             );
           }
           const settledAttemptLedger = settleCandidatePassBAttempt(
             currentAttemptLedger,
             outcome.settlement,
           );
           const nextSettlements = {
              ...candidatePassBSettlementRef.current,
              [outcome.candidateId]: outcome.settlement,
           };
           const nextAttemptLedgers = {
             ...candidatePassBAttemptLedgerRef.current,
             [outcome.candidateId]: settledAttemptLedger,
           };
           const restored = await queueCandidatePassBInsightPersistence(
             planLease,
             candidatePassBEvidenceRef.current,
             candidateGeminiInsightRef.current,
             firstTimelineFrameById(candidateTimelineFramesRef.current),
             candidatePassBModelByIdRef.current,
             candidatePassBVerificationReceiptRef.current,
             candidatePassBDispatchIntentRef.current,
             nextSettlements,
             nextAttemptLedgers,
           );
           if (
             !isCurrentOperation() ||
             restored === null ||
             JSON.stringify(
               restored.settlementByCandidateId[outcome.candidateId],
             ) !== JSON.stringify(outcome.settlement) ||
             JSON.stringify(
               restored.attemptLedgerByCandidateId[outcome.candidateId],
             ) !== JSON.stringify(settledAttemptLedger)
           ) {
             return false;
           }
           if (
             !applyCurrentWorkerEvent({
               type: "CANDIDATE_FAILED",
               candidateId: outcome.candidateId,
               expectedProposalRevision: 0,
               reasonCode: "worker_candidate_failed",
             })
           ) {
             throw new Error(
               "The outcome-unknown candidate disposition was rejected.",
             );
           }
           candidatePassBDispatchIntentRef.current =
             restored.dispatchIntentByCandidateId;
           candidatePassBSettlementRef.current =
             restored.settlementByCandidateId;
           candidatePassBAttemptLedgerRef.current =
             restored.attemptLedgerByCandidateId;
           return true;
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
      for (const [settlementIndex, settlement] of workerSettlements.entries()) {
        if (settlement.status === "fulfilled") continue;
        const error = settlement.reason as unknown;
        if (
          controller.signal.aborted ||
          (error instanceof CandidatePassBWorkerError && error.code === "ABORTED")
        ) {
          throw error instanceof Error
            ? error
            : new CandidatePassBWorkerError(
                "ABORTED",
                "The Pass B candidate operation was aborted.",
              );
        }
        const target = targets[settlementIndex]!;
        const outcome = candidatePassBMachine.current?.candidateOutcomes.find(
          ({ candidateId }) => candidateId === target.candidateId,
        );
        if (
          outcome?.status === "pending" &&
          !applyCurrentWorkerEvent({
            type: "CANDIDATE_FAILED",
            candidateId: target.candidateId,
            expectedProposalRevision: 0,
            reasonCode:
              candidateFailureReasonById.get(target.candidateId) ??
              "worker_candidate_failed",
          })
        ) {
          throw new CandidatePassBWorkerError(
            "WORKER_MESSAGE_ERROR",
            "A failed Pass B candidate could not be isolated from the remaining batch.",
          );
        }
      }
      const runBeforeCompletion = candidatePassBMachine.current;
      if (runBeforeCompletion?.status !== "finalizing") {
        throw new CandidatePassBWorkerError(
          "WORKER_MESSAGE_ERROR",
          "Pass B reached completion before every candidate had a terminal disposition.",
        );
      }
      const resultCount = runBeforeCompletion.candidateOutcomes.filter(
        (outcome) =>
          outcome.status !== "pending" &&
          outcome.workerDisposition === "result",
      ).length;
      const gapCount = runBeforeCompletion.candidateOutcomes.length - resultCount;
      if (
        !applyCurrentWorkerEvent({
          type: "RUN_COMPLETED",
          requestedCount: runBeforeCompletion.candidateOutcomes.length,
          resultCount,
          gapCount,
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
      if (!(error instanceof CandidatePassBInsightPersistenceError)) {
        setCandidatePassBError(explainCandidatePassBError(error));
      }
    } finally {
      let persistenceVerified = true;
      try {
        await flushCandidatePassBInsightPersistence();
      } catch {
        persistenceVerified = false;
      }
      if (
        autoStartKey !== undefined &&
        isCurrentOperation() &&
        autoCandidatePassBSourceRef.current === autoStartKey
      ) {
        const durableIds = selectCandidatePassBDurableIds({
          candidateIds: targets.map(({ candidateId }) => candidateId),
          record: candidatePassBDurableInsightsRef.current,
          contextByCandidateId: candidatePassBContextById,
          sourceFenceByCandidateId: candidatePassBSourceFenceById,
        });
        const allTargetsDurable =
          persistenceVerified &&
          targets.every(({ candidateId }) => durableIds.has(candidateId));
        const retryCandidateIds = targets.map(({ candidateId }) => candidateId);
        const durableRecord = candidatePassBDurableInsightsRef.current;
        const automaticRetryTargets = persistenceVerified
          ? selectCandidatePassBAutomaticTargets({
              candidateIds: retryCandidateIds,
              attemptLedgerByCandidateId:
                durableRecord?.attemptLedgerByCandidateId ?? {},
              dispatchIntentByCandidateId:
                durableRecord?.dispatchIntentByCandidateId ?? {},
              settlementByCandidateId:
                durableRecord?.settlementByCandidateId ?? {},
            })
          : [];
        const autoRetry = candidatePassBAutoRetryRef.current;
        if (allTargetsDurable) {
          if (autoRetry.timeout !== null) {
            globalThis.clearTimeout(autoRetry.timeout);
          }
          autoRetry.operationKey = autoStartKey;
          autoRetry.attempts = 0;
          autoRetry.timeout = null;
        } else if (
          automaticRetryTargets.length > 0 &&
          !controller.signal.aborted &&
          autoRetry.timeout === null
        ) {
          autoRetry.operationKey = autoStartKey;
          const delayMs = Math.min(
            30_000,
            1_000 * 2 ** Math.min(autoRetry.attempts, 5),
          );
          autoRetry.attempts += 1;
          autoRetry.timeout = scheduleCandidatePassBAutomaticTargetReadback({
            candidateIds: retryCandidateIds,
            delayMs,
            readDurableInput: () => {
              const currentRecord = candidatePassBDurableInsightsRef.current;
              return {
                attemptLedgerByCandidateId:
                  currentRecord?.attemptLedgerByCandidateId ?? {},
                dispatchIntentByCandidateId:
                  currentRecord?.dispatchIntentByCandidateId ?? {},
                settlementByCandidateId:
                  currentRecord?.settlementByCandidateId ?? {},
              };
            },
            onReady: (retryTargets) => {
              autoRetry.timeout = null;
              if (retryTargets.length === 0) {
                autoRetry.attempts = 0;
                return;
              }
              if (
                isMounted.current &&
                autoCandidatePassBSourceRef.current === autoStartKey
              ) {
                autoCandidatePassBSourceRef.current = null;
                setCandidatePassBAutoRetryEpoch((epoch) => epoch + 1);
              }
            },
          });
        } else {
          autoRetry.operationKey = autoStartKey;
          autoRetry.timeout = null;
          if (
            !persistenceVerified &&
            autoCandidatePassBSourceRef.current === autoStartKey
          ) {
            autoCandidatePassBSourceRef.current = null;
          }
        }
      }
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

  /**
   * 보고 있는 후보 하나를 처음 상태로 (명세 §11.1).
   *
   * 이 화면에서 후보 하나를 바꾸는 수단은 트림과 판단 둘뿐이므로 리셋은 **둘 다**
   * 되돌려야 일관된다 — 일부만 지우면 "나머지는 왜 남았지?"가 된다. 새 상태
   * 기계를 만들지 않고 기존 두 경로(`resetCandidateBoundary`, `updateReview`)를
   * 순서대로 부른다.
   *
   * **범위는 지금 보고 있는 후보 하나다.** 한때 전체 후보를 돌았는데, 그러면
   * 23개 중 20개를 검토한 사람이 방금 만지던 후보만 다시 하려고 키를 눌렀다가
   * 20개를 잃는다. `Z` 는 판단 1개만 되돌리므로 복구 수단도 없다. 키를 누르는
   * 사람이 생각하는 대상은 언제나 지금 화면에 있는 후보다.
   */
  const resetFocusedCandidateReview = (): void => {
    const candidate = orderedCandidates.find(({ id }) => id === focusedCandidateId);
    if (candidate === undefined) {
      return;
    }
    resetCandidateBoundary(candidate);
    if (candidate.reviewState !== "unreviewed") {
      updateReview(candidate.id, "unreviewed");
    }
    setReviewUndo(null);
  };

  const focusedCandidate =
    focusedCandidateId === null
      ? null
      : orderedCandidates.find(({ id }) => id === focusedCandidateId) ?? null;
  const reviewShortcutsActive =
    contextualCandidatePublicationReady && orderedCandidates.length > 0;

  /*
   * Derived state for the focused candidate, hoisted out of the card render.
   * The decision dock and the trim row live beside the video in the left
   * column while the card renders in the right one, so these can no longer be
   * computed inside the candidate `.map()` — they are needed on both sides.
   */
  const focusedBoundaryRevision =
    focusedCandidate === null ? null : boundaryRevisions[focusedCandidate.id] ?? null;
  const focusedRange =
    focusedCandidate === null
      ? null
      : effectiveCandidateRange(focusedCandidate, focusedBoundaryRevision);
  const focusedRangeAdjusted = candidateRangeWasAdjusted(focusedBoundaryRevision);
  const focusedBoundaryTouched = (focusedBoundaryRevision?.revision ?? 0) > 0;
  const focusedSubtitleAvailability: ClipSubtitleAvailability =
    focusedCandidate === null || focusedRange === null
      ? { available: false }
      : assessClipSubtitleCoverage(
          buildCandidatePassBPresentation(
            focusedCandidate.id,
            buildHighlightNarrative(focusedCandidate),
            candidatePassBEvidenceById[focusedCandidate.id]?.candidateId === focusedCandidate.id
              ? candidatePassBEvidenceById[focusedCandidate.id]
              : undefined,
          ).cues,
          { startMs: focusedRange.startMs, endMs: focusedRange.endMs },
        );

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
      moveItemFocus: (delta) => reviewItemFocusMoverRef.current?.(delta),
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
      page: reviewPage,
      setPage: setReviewPage,
      resetConfirmOpen,
      openResetConfirm: () => setResetConfirmOpen(true),
      confirmReset: () => {
        setResetConfirmOpen(false);
        resetFocusedCandidateReview();
      },
      cancelReset: () => setResetConfirmOpen(false),
  });

  useEffect(() => {
    if (reviewUndo === null) {
      return;
    }
    const timer = globalThis.setTimeout(() => setReviewUndo(null), 8_000);
    return () => globalThis.clearTimeout(timer);
  }, [reviewUndo]);

  /** Re-runs whichever whole-context stage stopped, keeping fast candidates. */
  const retryWholeContextPhase = (
    forceBoundary?: "transcript" | "context",
  ): void => {
    if (wholeContextRetryPendingRef.current) return;
    const transcriptNeedsRetry =
      forceBoundary === "transcript" ||
      transcriptNeedsExplicitRetry(
        broadcastTranscriptStatus,
        broadcastTranscriptChapters.length,
      );
    const contextNeedsRetry =
      forceBoundary === "context" ||
      forceBoundary === "transcript" ||
      broadcastContextStatus === "failed" ||
      broadcastContextResult === null ||
      transcriptNeedsRetry;

    if (!contextNeedsRetry && !transcriptNeedsRetry) return;
    wholeContextRetryPendingRef.current = true;

    void (async () => {
      let resumeCurrentContextOperation = false;
      if (contextNeedsRetry) {
        broadcastContextAbortController.current?.abort();
        broadcastContextAbortController.current = null;
        semanticLeadRefinementAbortController.current?.abort();
        semanticLeadRefinementAbortController.current = null;
        setBroadcastContextStatus("restoring");
        setBroadcastContextError(null);
        setSemanticLeadRefinementStatus("idle");
        setSemanticLeadRefinementError(null);

        const retainedCandidates = candidates.filter(
          (candidate) => !isContextDiscoveredCandidate(candidate),
        );
        if (retainedCandidates.length !== candidates.length) {
          const retainedIds = new Set(retainedCandidates.map(({ id }) => id));
          setCandidates(retainedCandidates);
          setSelectionResult((current) =>
            current === null
              ? current
              : { ...current, candidateCount: retainedCandidates.length },
          );
          setBoundaryRevisions((current) =>
            Object.fromEntries(
              Object.entries(current).filter(([candidateId]) =>
                retainedIds.has(candidateId),
              ),
            ),
          );
          resetCandidateRanking(retainedCandidates);
        }

        // Candidate Pass B consumes the whole-broadcast packet. Once that
        // packet is reopened, every old insight and verification receipt is
        // stale in memory and in the durable analysis session.
        resetCandidatePassB();
        setCandidateAiProjectionById({});
        setBroadcastContextResult(null);
        setBroadcastContextRefinementLeadIds(null);
        setBroadcastContextFastRefinementLeadIds(null);
        setTimelineSemanticChapters([]);
        setTimelineSemanticChapterRevealCount(0);
        setTimelineInspectionTarget(null);

        try {
          await flushCandidatePassBInsightPersistence();
          const runId = currentAnalysisRunId;
          if (runId !== null) {
            const store = getResultStore();
            const savedSession = await store.getBroadcastContextSession(runId);
            if (savedSession !== null) {
              const storedLedger =
                savedSession.contextPhaseLedgerJson === null
                  ? null
                  : parseBroadcastContextPhaseLedgerJson(
                      savedSession.contextPhaseLedgerJson,
                    );
              const canResumeExactContext =
                !transcriptNeedsRetry &&
                savedSession.contextInputSignature !== null &&
                savedSession.contextInputCheckpointJson !== null &&
                savedSession.contextResultJson === null &&
                storedLedger !== null;
              resumeCurrentContextOperation =
                canResumeExactContext &&
                storedLedger.units.some(
                  ({ status }) =>
                    status === "in-flight" ||
                    status === "outcome-unknown" ||
                    status === "reconciling",
                );

              if (resumeCurrentContextOperation) {
                /*
                 * A possibly billed request already owns this operation ID.
                 * The current pipeline re-enters with the unchanged ledger and
                 * reconciles that exact operation. Issuing a retry grant or a
                 * fresh operation here would create duplicate-billing risk.
                 */
                const reopened =
                  await store.getBroadcastContextSession(runId);
                if (
                  reopened === null ||
                  reopened.contextInputSignature !==
                    savedSession.contextInputSignature ||
                  reopened.contextInputCheckpointJson !==
                    savedSession.contextInputCheckpointJson ||
                  reopened.contextPhaseLedgerJson !==
                    savedSession.contextPhaseLedgerJson ||
                  reopened.contextResultJson !== null
                ) {
                  throw new Error(
                    "The interrupted context operation changed before reconciliation.",
                  );
                }
              } else if (canResumeExactContext) {
                const retryNonce =
                  globalThis.crypto?.randomUUID?.() ??
                  `${Date.now()}-${broadcastContextAttemptOrdinal + 1}`;
                const confirmationId = `editor-context-retry:${retryNonce}`;
                const replanned =
                  replanBroadcastContextPhaseLedgerAfterEditorRetry(
                    storedLedger,
                    {
                      confirmationId,
                      nextOperationId: (unit) =>
                        `context-${unit.phase}-${unit.unitId}` +
                        `-manual-${unit.attemptOrdinal + 1}-${retryNonce}`,
                    },
                  );
                const replannedJson =
                  serializeBroadcastContextPhaseLedger(replanned);
                const checkpointed =
                  await checkpointBroadcastContextSessionPhaseLedgerIfUnchanged(
                    store,
                    savedSession,
                    {
                      contextInputSignature:
                        savedSession.contextInputSignature,
                      contextInputCheckpointJson:
                        savedSession.contextInputCheckpointJson,
                      contextPhaseLedgerJson: replannedJson,
                      recordedAt: new Date().toISOString(),
                    },
                  );
                if (!checkpointed) {
                  throw new Error(
                    "다른 탭에서 방송 맥락이 갱신되어 오래된 재시도를 중단했습니다.",
                  );
                }
                const reopened =
                  await store.getBroadcastContextSession(runId);
                if (
                  reopened === null ||
                  reopened.contextInputSignature !==
                    savedSession.contextInputSignature ||
                  reopened.contextInputCheckpointJson !==
                    savedSession.contextInputCheckpointJson ||
                  reopened.contextPhaseLedgerJson !== replannedJson ||
                  reopened.contextResultJson !== null ||
                  reopened.refinementInputSignature !== null ||
                  reopened.refinementCandidatesJson !== null
                ) {
                  throw new Error(
                    "완료된 맥락 조각을 보존한 재시도 상태를 다시 확인하지 못했습니다.",
                  );
                }
              } else {
                const invalidated =
                  await invalidateBroadcastContextSessionContextIfUnchanged(
                    store,
                    savedSession,
                    new Date().toISOString(),
                  );
                if (!invalidated) {
                  throw new Error(
                    "다른 탭에서 방송 맥락이 갱신되어 오래된 재시도를 중단했습니다.",
                  );
                }
                const reopened =
                  await store.getBroadcastContextSession(runId);
                if (
                  reopened === null ||
                  reopened.contextInputSignature !== null ||
                  reopened.contextInputCheckpointJson !== null ||
                  reopened.contextPhaseLedgerJson !== null ||
                  reopened.contextResultJson !== null ||
                  reopened.refinementInputSignature !== null ||
                  reopened.refinementCandidatesJson !== null
                ) {
                  throw new Error(
                    "방송 맥락 재시도 상태를 저장한 뒤 다시 확인하지 못했습니다.",
                  );
                }
              }
            }
          }
        } catch {
          setBroadcastContextStatus("failed");
          setBroadcastContextError(
            "기존 맥락 판정을 안전하게 무효화하지 못했어요. 저장 공간을 확인한 뒤 다시 시도해 주세요.",
          );
          return;
        }

        autoSemanticLeadRefinementSourceRef.current = null;
        allowAmbiguousSemanticRefinementRetryRef.current = false;
        semanticRefinementRouteChangeCountRef.current = 0;
        if (!resumeCurrentContextOperation) {
          setSemanticLeadRefinementAttemptOrdinal((current) => current + 1);
        }
        autoBroadcastContextSourceRef.current = null;
        if (!resumeCurrentContextOperation) {
          setBroadcastContextAttemptOrdinal((current) => current + 1);
        }
        setBroadcastContextStatus("idle");
      }

      if (transcriptNeedsRetry) {
        broadcastTranscriptAbortController.current?.abort();
        broadcastTranscriptAbortController.current = null;
        autoBroadcastTranscriptSourceRef.current = null;
        sealedBroadcastTranscriptSourceRef.current = null;
        allowAmbiguousTranscriptRetryRef.current = true;
        broadcastTranscriptRouteChangeCountRef.current = 0;
        setBroadcastTranscriptAttemptOrdinal((current) => current + 1);
        setBroadcastTranscriptStatus("idle");
        setBroadcastTranscriptProgress(null);
        setBroadcastTranscriptRecoveryProgress(null);
        setBroadcastTranscriptError(null);
      }
    })().finally(() => {
      wholeContextRetryPendingRef.current = false;
    });
  };
  retryWholeContextPhaseRef.current = retryWholeContextPhase;

  useEffect(() => {
    const request = pipelineRecoveryRequest;
    if (request === null) return;
    if (request.inputToken !== pipelineCertificationInputToken) {
      setPipelineRecoveryRequest(null);
      return;
    }
    if (request.plan.kind === "terminal") {
      setPipelineRecoveryRequest(null);
      return;
    }
    if (
      (request.plan.kind === "candidate" ||
        request.plan.kind === "candidate-plan") &&
      (analysisBusy ||
        candidatePassBBusy ||
        candidateAudioEventBusy ||
        candidatePassBStartPending)
    ) {
      return;
    }
    if (
      (request.plan.kind === "transcript" ||
        request.plan.kind === "context") &&
      wholeContextRetryPendingRef.current
    ) {
      return;
    }

    setPipelineRecoveryRequest(null);
    const recoveryCompletion = executeAnalysisPipelineRecoveryInApp(
      request.plan,
      {
        rebuildDownstream: () => {
          resetDownstream();
          setPipelineFastRebuildPending(true);
        },
        retryWholeContext: (boundary) => {
          retryWholeContextPhaseRef.current(boundary);
        },
        restartRefinement: () => {
        semanticLeadRefinementAbortController.current?.abort();
        semanticLeadRefinementAbortController.current = null;
        resetCandidatePassB();
        autoSemanticLeadRefinementSourceRef.current = null;
        allowAmbiguousSemanticRefinementRetryRef.current = true;
        semanticRefinementRouteChangeCountRef.current = 0;
        setSemanticLeadRefinementError(null);
        setSemanticLeadRefinementAttemptOrdinal((current) => current + 1);
        setSemanticLeadRefinementStatus("idle");
        },
        resetCandidatePlanArtifacts: resetCandidatePassB,
        persistCurrentCandidatePlan: () =>
          ensureCandidatePassBPlanPersistenceRef.current(
            candidateDetailCandidateIds,
          ),
        repairCandidateDetails: (candidateIds) =>
          runCandidatePassBRef.current(candidateIds),
      },
    );
    if (recoveryCompletion === null) return;
    if (request.plan.kind === "candidate-plan") {
      void recoveryCompletion.then(
        () => {
          if (isMounted.current) {
            setPipelineCertificationRetryEpoch((epoch) => epoch + 1);
          }
        },
        () => {
          if (isMounted.current) {
            candidatePassBPlanRetryRef.current.attempts += 1;
            setCandidatePassBPlanRetryEpoch((epoch) => epoch + 1);
          }
        },
      );
      return;
    }
    void recoveryCompletion.finally(() => {
      if (isMounted.current) {
        setPipelineCertificationRetryEpoch((epoch) => epoch + 1);
      }
    });
  }, [
    analysisBusy,
    candidateAudioEventBusy,
    candidateDetailCandidateIds,
    candidatePassBBusy,
    candidatePassBStartPending,
    pipelineCertificationInputToken,
    pipelineRecoveryRequest,
    resetCandidatePassB,
    resetDownstream,
  ]);

  useEffect(() => {
    if (
      !pipelineFastRebuildPending ||
      !sourceReady ||
      preflight === null ||
      sourceFile === null ||
      sourceCheck === null ||
      sourceContentFingerprint === null ||
      analysisBusy ||
      analysisStartPending ||
      chatImportStatus === "reading"
    ) {
      return;
    }
    setPipelineFastRebuildPending(false);
    void runSignalAnalysisRef.current();
  }, [
    analysisBusy,
    analysisStartPending,
    chatImportStatus,
    pipelineFastRebuildPending,
    preflight,
    sourceCheck,
    sourceContentFingerprint,
    sourceFile,
    sourceReady,
  ]);

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
    setAnalysisCaptionVideoId(
      recovered.finalResult.result.input.source.captionVideoId,
    );
    resetCandidateAudioEvent();
    resetBoundarySession();
    broadcastTranscriptAbortController.current?.abort();
    broadcastTranscriptAbortController.current = null;
    broadcastVisualInspectionAbortController.current?.abort();
    broadcastVisualInspectionAbortController.current = null;
    broadcastContextAbortController.current?.abort();
    broadcastContextAbortController.current = null;
    semanticLeadRefinementAbortController.current?.abort();
    semanticLeadRefinementAbortController.current = null;
    autoBroadcastTranscriptSourceRef.current = null;
    sealedBroadcastTranscriptSourceRef.current = null;
    autoBroadcastVisualInspectionSourceRef.current = null;
    allowAmbiguousTranscriptRetryRef.current = false;
    broadcastTranscriptRouteChangeCountRef.current = 0;
    autoBroadcastContextSourceRef.current = null;
    autoSemanticLeadRefinementSourceRef.current = null;
    allowAmbiguousSemanticRefinementRetryRef.current = false;
    semanticRefinementRouteChangeCountRef.current = 0;
    setBroadcastTranscriptStatus("idle");
    setBroadcastTranscriptProgress(null);
    setBroadcastTranscriptRecoveryProgress(null);
    setBroadcastTranscriptChapters([]);
    setBroadcastVisualInspectionProjection(null);
    setBroadcastVisualInspectionStatus("idle");
    setBroadcastVisualInspectionPlannedCellCount(0);
    setBroadcastVisualInspectionPreparedCellCount(0);
    setBroadcastVisualInspectionSettledCellCount(0);
    setBroadcastVisualInspectionAttemptOrdinal(0);
    setBroadcastVisualInspectionError(null);
    setYouTubeCaptionTrack(null);
    youtubeCaptionTrackRef.current = null;
    setBroadcastTranscriptError(null);
    setBroadcastContextStatus("restoring");
    setBroadcastContextResult(null);
    setCandidateAiProjectionById({});
    setBroadcastContextRefinementLeadIds(null);
    setBroadcastContextFastRefinementLeadIds(null);
    setBroadcastContextError(null);
    setSemanticLeadRefinementStatus("idle");
    setSemanticLeadRefinementError(null);
    setActiveRefinementEvidenceProjection(null);
    sourceSelectionEpoch.current += 1;
    sourceAbortController.current?.abort();
    sourceAbortController.current = null;
    channelPreanalysisConfirmationAbortController.current?.abort();
    channelPreanalysisConfirmationAbortController.current = null;
    setChannelPreanalysisConfirmationPending(false);
    channelPreanalysisBundleBindingRef.current = null;
    replaceChannelPreanalysisConnection({ status: "idle" });
    setManualVodInput("");
    manualVodInputRef.current = "";
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
    setPipelineCertification({ status: "idle" });
    setChatImport(null);
    setChatContentFingerprint(null);
    setChatFileName(null);
    setChatError(null);
    setChatImportStatus("idle");
    setChatOffsetSeconds(recovered.finalResult.result.input.chat.offsetMs / 1_000);
    const recoveredPublishedCandidates: ReviewedCandidate[] =
      recovered.finalResult.result.candidates.map((candidate) => ({
        ...hydrateDurableCandidate(candidate),
        reviewState: "unreviewed" as const,
        approvedBoundaryRevision: null,
      }));
    /*
     * Semantic candidates are reconstructed only from the canonical active
     * refinement ledger below. Never expose an unproved terminal-result copy
     * during the asynchronous restore window.
     */
    const recoveredCandidates = recoveredPublishedCandidates.filter(
      (candidate) => !isContextDiscoveredCandidate(candidate),
    );
    setSelectionResult({
      ...recovered.finalResult.result.summary,
      candidateCount: recoveredCandidates.length,
    });
    setCandidates(recoveredCandidates);
    setCandidateTimelineScorePoints(
      buildCandidateTimelineScorePoints([
        { signalKind: "fused", candidates: recoveredCandidates },
      ]),
    );
    const storedRecoveredPassBInsights =
      recovered.candidatePassBInsights?.modelManifestHash ===
      CANDIDATE_PASS_B_ROUTING_MODEL_REVISION
      ? recovered.candidatePassBInsights
      : null;
    const recoveredPassBInsights =
      storedRecoveredPassBInsights === null
        ? null
        : recoverCandidatePassBArmedDispatchesAsOutcomeUnknown(
            storedRecoveredPassBInsights,
          );
    // Keep recovered paid artifacts local until every current-only context
    // checkpoint below has been reproduced. Nothing from Pass B is visible
    // during this validation window.
    candidatePassBDurableInsightsRef.current = null;
    candidatePassBPlanReceiptRef.current = null;
    resetCandidateRanking(recoveredCandidates);
    setLastExportFormat(null);
    setCopyStatus("idle");
    setExportError(null);
    setPreviewCandidateId(null);
    setOpenedRecoveredResult(recovered);

    void (async () => {
      const store = getResultStore();
      const restoreIsCurrent = (): boolean =>
        isMounted.current &&
        recoveredContextRestoreEpoch.current === restoreEpoch;
      const restoreOperationToken =
        `recovered-context:${recovered.terminal.runId}:${restoreEpoch}`;
      let restoreRetryCycle = 0;
      let savedSession;
      for (;;) {
        if (!restoreIsCurrent()) return;
        const reopened =
          await loadDurableBroadcastContextSession({
            store,
            identity: {
              runId: recovered.terminal.runId,
              operationToken: restoreOperationToken,
              inputSignature: recovered.terminal.inputSignature,
            },
            isCurrent: (identity) =>
              restoreIsCurrent() &&
              identity.runId === recovered.terminal.runId &&
              identity.operationToken === restoreOperationToken &&
              identity.inputSignature ===
                recovered.terminal.inputSignature,
          });
        if (reopened.status === "succeeded") {
          savedSession = reopened.value;
          break;
        }
        if (reopened.status === "retry-exhausted") {
          restoreRetryCycle += 1;
          await new Promise<void>((resolve) => {
            globalThis.setTimeout(
              resolve,
              Math.min(
                30_000,
                1_000 * 2 ** Math.min(restoreRetryCycle - 1, 5),
              ),
            );
          });
          continue;
        }
        if (reopened.status === "stale" || reopened.status === "aborted") {
          return;
        }
        throw new Error(
          `저장된 분석 세션을 다시 열지 못했어요. ${reopened.reasonCode}`,
        );
      }
      if (!restoreIsCurrent()) return;
      if (
        savedSession.inputSignature !== recovered.terminal.inputSignature ||
        savedSession.sourceDurationMs !==
          recovered.finalResult.result.input.source.durationMs
      ) {
        setBroadcastContextStatus("idle");
        return;
      }
      setBroadcastTranscriptChapters(savedSession.chapters);
      if (savedSession.gapChunkIds.length > 0) {
        setBroadcastTranscriptStatus("completedWithGaps");
        setBroadcastContextStatus("idle");
        return;
      }
      if (
        !(await inspectCurrentTranscriptCheckpoint({
          session: savedSession,
          sourceContentFingerprint:
            recovered.finalResult.result.input.source.contentFingerprint,
          expectedCaptionVideoId:
            recovered.finalResult.result.input.source.captionVideoId,
        }))
      ) {
        setBroadcastTranscriptStatus("idle");
        setBroadcastContextStatus("idle");
        return;
      }
      if (savedSession.contextResultJson === null) {
        autoBroadcastTranscriptSourceRef.current =
          savedSession.transcriptSealOperationKey;
        sealedBroadcastTranscriptSourceRef.current =
          savedSession.transcriptSealOperationKey;
        setBroadcastTranscriptStatus("completed");
        setBroadcastContextStatus("idle");
        return;
      }
      if (
        savedSession.participantGroundingInputSignature === null ||
        savedSession.participantGroundingPlanFingerprint === null ||
        savedSession.participantGroundingCheckpointJson === null ||
        savedSession.transcriptSealOperationKey === null ||
        savedSession.contextInputSignature === null ||
        savedSession.contextInputCheckpointJson === null ||
        savedSession.contextPhaseLedgerJson === null
      ) {
        throw new Error(
          "The current broadcast context is missing its participant evidence or phase ledger.",
        );
      }
      const restoredParticipantPreContext =
        await restoreBroadcastParticipantPreContextCheckpoint(savedSession);
      if (restoredParticipantPreContext === null) {
        throw new Error(
          "The saved participant plan, receipts, grounding, or signature is invalid.",
        );
      }
      if (savedSession.transcriptEvidenceCheckpointJson === null) {
        throw new Error(
          "The current broadcast context is missing its transcript evidence checkpoint.",
        );
      }
      const restoredTranscriptEvidence =
        parseBroadcastTranscriptResolvedEvidenceCheckpointJson(
          savedSession.transcriptEvidenceCheckpointJson,
        );
      if (restoredTranscriptEvidence === null) {
        throw new Error(
          "The saved transcript evidence checkpoint is invalid.",
        );
      }
      const restoredVisualPlan =
        createBroadcastTranscriptVisualInspectionPlan(
          restoredTranscriptEvidence,
        );
      const restoredVisualProjection =
        savedSession.transcriptVisualInspectionCheckpointJson === null
          ? null
          : parseAndProjectBroadcastTranscriptVisualContext({
              transcriptEvidenceCheckpointJson:
                savedSession.transcriptEvidenceCheckpointJson,
              visualInspectionCheckpointJson:
                savedSession.transcriptVisualInspectionCheckpointJson,
            });
      if (
        restoredVisualPlan.cells.length > 0 &&
        (restoredVisualProjection === null ||
          !restoredVisualProjection.publication.publicationReady)
      ) {
        throw new Error(
          "The saved broadcast context does not have a complete visual-evidence checkpoint.",
        );
      }

      let storedPayload: unknown;
      let storedContextInputPayload: unknown;
      try {
        storedPayload = JSON.parse(savedSession.contextResultJson);
        storedContextInputPayload = JSON.parse(
          savedSession.contextInputCheckpointJson,
        );
      } catch {
        throw new Error("저장된 전체 맥락 결과 형식을 확인하지 못했어요.");
      }
      const storedContextInput = createBroadcastContextRequest(
        storedContextInputPayload as BroadcastContextRequestInput,
      );
      const expectedParticipantGroundingInputSignature =
        await createBroadcastParticipantGroundingInputSignature({
          inputSignature: savedSession.inputSignature,
          transcriptSealOperationKey:
            savedSession.transcriptSealOperationKey,
          participantGroundingPlanFingerprint:
            savedSession.participantGroundingPlanFingerprint,
          participantGroundingCheckpointJson:
            savedSession.participantGroundingCheckpointJson,
        });
      const expectedContextInputSignature = await createContentFingerprint([
        savedSession.inputSignature,
        savedSession.contextInputCheckpointJson,
        savedSession.participantGroundingInputSignature,
        `broadcast-context-routing:${AI_BROADCAST_CONTEXT_ROUTING_REVISION}`,
        `topical-discovery:${BROADCAST_TOPICAL_DISCOVERY_VERSION}`,
      ]);
      if (
        savedSession.participantGroundingInputSignature !==
          expectedParticipantGroundingInputSignature ||
        savedSession.contextInputSignature !== expectedContextInputSignature ||
        storedContextInput.sourceDurationMs !== savedSession.sourceDurationMs ||
        storedContextInput.castRosterId !== savedSession.sourceCastRosterId ||
        JSON.stringify(storedContextInput.participantGrounding) !==
          JSON.stringify(restoredParticipantPreContext.grounding) ||
        JSON.stringify(storedContextInput.chapters) !==
          JSON.stringify(compactBroadcastContextChapters(savedSession.chapters))
      ) {
        setBroadcastTranscriptStatus("completed");
        setBroadcastContextStatus("idle");
        return;
      }
      const restoredContextLedger =
        parseBroadcastContextPhaseLedgerJson(
          savedSession.contextPhaseLedgerJson,
        );
      if (
        restoredContextLedger === null ||
        !broadcastContextPhaseLedgerMatchesFence(restoredContextLedger, {
          parentContextSignature: savedSession.contextInputSignature,
          transcriptSignature: savedSession.transcriptSealOperationKey,
          groundingSignature:
            savedSession.participantGroundingInputSignature,
        }) ||
        restoredContextLedger.units
          .filter(
            (unit) =>
              unit.required &&
              (unit.phase === "discovery" || unit.phase === "jury"),
          )
          .some((unit) => unit.status !== "succeeded")
      ) {
        setBroadcastTranscriptStatus("completed");
        setBroadcastContextStatus("idle");
        return;
      }
      const storedEnvelope = unpackPersistedBroadcastContext(storedPayload);
      if (storedEnvelope === null) {
        throw new Error(
          "The saved broadcast context envelope is not the current exact schema.",
        );
      }
      const recoveredCandidateById = new Map(
        recoveredCandidates.map((candidate) => [candidate.id, candidate]),
      );
      const restoreCandidateIds = storedEnvelope.contextCandidateIds;
      const restoreCandidates = restoreCandidateIds.flatMap((candidateId) => {
        const candidate = recoveredCandidateById.get(candidateId);
        return candidate === undefined ? [] : [candidate];
      });
      if (restoreCandidates.length !== restoreCandidateIds.length) {
        setBroadcastContextStatus("idle");
        return;
      }
      if (
        restoreCandidateIds.length !== storedContextInput.candidates.length ||
        restoreCandidateIds.some(
          (candidateId, index) =>
            candidateId !==
            storedContextInput.candidates[index]?.candidateId,
        )
      ) {
        setBroadcastContextStatus("idle");
        return;
      }
      const restoredContext = parsePersistedBroadcastContextResult(
        storedEnvelope.resultPayload,
        {
          sourceDurationMs: storedContextInput.sourceDurationMs,
          chapters: storedContextInput.chapters,
          candidates: storedContextInput.candidates,
          participantGrounding: storedContextInput.participantGrounding,
          outputLanguage: storedContextInput.outputLanguage,
          castRosterId: storedContextInput.castRosterId,
        },
      );
      if (restoredContext === null) {
        throw new Error("저장된 전체 맥락 결과를 현재 영상 기록과 연결하지 못했어요.");
      }
      const restoredOutputLanguage = storedContextInput.outputLanguage;
      if (analysisLanguage !== restoredOutputLanguage) {
        setAnalysisLanguage(restoredOutputLanguage);
      }

      const availableLeadIds = new Set(
        restoredContext.discoveredLeads.map((lead) => lead.leadId),
      );
      const restoredRefinementLeadIds = [
        ...new Set(
          storedEnvelope.refinementLeadIds.filter((leadId) =>
            availableLeadIds.has(leadId),
          ),
        ),
      ].slice(0, MAX_TOPICAL_REFINEMENT_LEADS);
      const restoredRefinementLeadIdSet = new Set(restoredRefinementLeadIds);
      const restoredFastRefinementLeadIds = [
        ...new Set(
          storedEnvelope.fastRefinementLeadIds.filter((leadId) =>
            restoredRefinementLeadIdSet.has(leadId),
          ),
        ),
      ];
      const restoredRefinementPlanIsAuthoritative =
        storedEnvelope.refinementLeadIds.length ===
          restoredRefinementLeadIds.length &&
        storedEnvelope.refinementLeadIds.every(
          (leadId, index) =>
            leadId === restoredRefinementLeadIds[index],
        ) &&
        storedEnvelope.fastRefinementLeadIds.length ===
          restoredFastRefinementLeadIds.length &&
        storedEnvelope.fastRefinementLeadIds.every(
          (leadId, index) =>
            leadId === restoredFastRefinementLeadIds[index],
        );
      let nextCandidates = recoveredCandidates;
      let restoredRefinementProjectionFingerprint: string | null = null;
      const restoredLeadById = new Map(
        restoredContext.discoveredLeads.map((lead) => [lead.leadId, lead]),
      );
      const restoredRefinementPlan = createDiscoveredLeadRefinementPlan(
        restoredRefinementLeadIds.flatMap((leadId) => {
          const lead = restoredLeadById.get(leadId);
          return lead === undefined ? [] : [lead];
        }),
        { preserveInputOrder: true },
      );
      const durableRefinementUnits = restoredContextLedger.units.filter(
        (unit) => unit.phase === "refinement" && unit.required,
      );
      const currentRefinementRoutingSignature =
        `broadcast-context-routing:${AI_BROADCAST_CONTEXT_ROUTING_REVISION}`;
      if (!restoreIsCurrent()) return;
      if (!restoredRefinementPlanIsAuthoritative) {
        setActiveRefinementEvidenceProjection(null);
        setSemanticLeadRefinementStatus("failed");
        setSemanticLeadRefinementError(
          "저장된 전체 맥락에는 현재 후보 정제 계획이 없어요. 전체 맥락과 기존 후보는 유지했으며, 원본을 다시 연결하면 이 단계만 재실행할 수 있어요.",
        );
      } else if (restoredRefinementPlan.selectedLeadIds.length === 0) {
        setActiveRefinementEvidenceProjection(null);
        setSemanticLeadRefinementStatus("completed");
      } else {
        let restoredSemanticCandidates:
          | readonly UnifiedHighlightCandidate[]
          | null = null;
        let restoredActiveProjection:
          BroadcastRefinementActiveRouteProjection | null = null;
        try {
          const restoredEvidenceLedger =
            await parseBroadcastContextSessionRefinementEvidenceLedger(
              savedSession,
            );
          if (
            restoredEvidenceLedger === null ||
            JSON.stringify(restoredEvidenceLedger.selectedLeadPlan) !==
              JSON.stringify(restoredRefinementPlan) ||
            !broadcastRefinementEvidenceLedgerCanPublish(
              restoredEvidenceLedger,
            )
          ) {
            throw new Error(
              "저장된 활성 후보 근거가 현재 후보 구간 계획을 완전히 증명하지 못해요.",
            );
          }
          const activeProjection =
            projectBroadcastRefinementActiveEvidenceRoute(
              restoredEvidenceLedger,
            );
          const activeEvidence =
            getBroadcastRefinementActiveEvidencePayload(
              restoredEvidenceLedger,
            );
          if (
            activeProjection === null ||
            !activeProjection.publicationEligible ||
            activeEvidence === null
          ) {
            throw new Error(
              "저장된 후보 근거 원장에 게시 가능한 활성 경로가 없어요.",
            );
          }
          const restoredRefinementLeadInputs =
            createSemanticRefinementLeadInputs({
              plan: restoredRefinementPlan,
              transcripts:
                activeRefinementEvidenceTranscripts(activeEvidence),
              discoveredLeads: restoredContext.discoveredLeads,
              fastRefinementLeadIds: restoredFastRefinementLeadIds,
              sourceDurationMs: storedContextInput.sourceDurationMs,
              castRosterId: storedContextInput.castRosterId,
              wholeBroadcastChapters: storedContextInput.chapters,
              participantGrounding:
                storedContextInput.participantGrounding,
              outputLanguage: restoredOutputLanguage,
            });
          const expectedRefinementInputSignature =
            await createSemanticRefinementAiInputSignature({
              activeEvidenceProjectionFingerprint:
                activeProjection.projectionFingerprint,
              routingManifestSignature:
                currentRefinementRoutingSignature,
              leadInputs: restoredRefinementLeadInputs,
            });
          const durableRefinementReceiptsAreCurrent =
            semanticRefinementPhaseReceiptsMatchActiveProjection({
              units: durableRefinementUnits,
              leadInputs: restoredRefinementLeadInputs,
              activeEvidenceProjectionFingerprint:
                activeProjection.projectionFingerprint,
              routingManifestSignature:
                currentRefinementRoutingSignature,
              outputLanguage: restoredOutputLanguage,
            });
          if (
            savedSession.refinementInputSignature !==
              expectedRefinementInputSignature ||
            savedSession.refinementCandidatesJson === null ||
            !durableRefinementReceiptsAreCurrent
          ) {
            throw new Error(
              "저장된 의미 후보가 현재 활성 근거·언어·AI 요청과 정확히 일치하지 않아요.",
            );
          }
          const parsedPayload: unknown = JSON.parse(
            savedSession.refinementCandidatesJson,
          );
          restoredSemanticCandidates =
            parseSemanticLeadCandidates(parsedPayload);
          if (restoredSemanticCandidates === null) {
            throw new Error(
              "저장된 의미 후보 위치의 형식을 확인하지 못했어요.",
            );
          }
          restoredActiveProjection = activeProjection;
        } catch (error) {
          setActiveRefinementEvidenceProjection(null);
          setSemanticLeadRefinementStatus("failed");
          setSemanticLeadRefinementError(
            error instanceof Error && error.message.trim().length > 0
              ? `${error.message} 전체 맥락과 기존 후보는 유지했으며, 원본을 다시 연결하면 이 단계만 재실행할 수 있어요.`
              : "저장된 의미 후보 근거를 정확히 복원하지 못했어요.",
          );
        }
        if (
          restoredSemanticCandidates !== null &&
          restoredActiveProjection !== null
        ) {
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
          setActiveRefinementEvidenceProjection(
            restoredActiveProjection,
          );
          restoredRefinementProjectionFingerprint =
            restoredActiveProjection.projectionFingerprint;
          setSemanticLeadRefinementStatus("completed");
        }
      }
      if (!restoreIsCurrent()) return;

      autoBroadcastTranscriptSourceRef.current =
        savedSession.transcriptSealOperationKey;
      sealedBroadcastTranscriptSourceRef.current =
        savedSession.transcriptSealOperationKey;
      setBroadcastTranscriptStatus("completed");
      setBroadcastVisualInspectionProjection(restoredVisualProjection);
      setBroadcastVisualInspectionPlannedCellCount(
        restoredVisualPlan.cells.length,
      );
      setBroadcastVisualInspectionPreparedCellCount(
        restoredVisualProjection?.runnerCheckpoint.preparedFrameReceipts
          .length ?? 0,
      );
      setBroadcastVisualInspectionSettledCellCount(
        restoredVisualProjection === null
          ? 0
          : restoredVisualProjection.publication.completedCellIds.length +
              restoredVisualProjection.publication
                .excludedMusicOnlyCellIds.length,
      );
      setBroadcastVisualInspectionStatus("completed");
      setBroadcastVisualInspectionError(null);
      setBroadcastParticipantPreContext(restoredParticipantPreContext);
      setBroadcastContextResult(restoredContext);
      setBroadcastContextRefinementLeadIds(restoredRefinementLeadIds);
      setBroadcastContextFastRefinementLeadIds(restoredFastRefinementLeadIds);
      setTimelineSemanticChapterRevealCount(0);
      setTimelineSemanticChapters(restoredContext.semanticChapters);
      setTimelineInspectionTarget(null);
      const restoredCandidateProjectionById =
        finalizeContextQualifiedCandidates(
          recoveredCandidates,
          restoredContext.annotations,
        ).projectionById;
      setCandidateAiProjectionById(restoredCandidateProjectionById);
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

      const queuedRecoveredCandidateIds = new Set(
        selectCandidateDetailCandidateIds(
          nextCandidates,
          restoredCandidateProjectionById,
        ),
      );
      const recoveredPlannedCandidateIds = nextCandidates
        .filter((candidate) => queuedRecoveredCandidateIds.has(candidate.id))
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.peakMs - right.peakMs ||
            left.id.localeCompare(right.id),
        )
        .map(({ id }) => id);
      const recoveredStoredContextCohortMatches =
        candidatePassBPlanContextCohortMatches(
          storedRecoveredPassBInsights,
          recoveredPlannedCandidateIds,
        );
      const expectedRecoveredPlanReceipt =
        !recoveredStoredContextCohortMatches ||
        storedRecoveredPassBInsights === null
          ? null
          : await createCandidatePassBPlanReceipt({
              runId: recovered.terminal.runId,
              inputSignature: recovered.terminal.inputSignature,
              contextInputSignature: savedSession.contextInputSignature,
              refinementEvidenceProjectionFingerprint:
                restoredRefinementProjectionFingerprint,
              plannedCandidateIds: recoveredPlannedCandidateIds,
              contextByCandidateId:
                storedRecoveredPassBInsights.contextByCandidateId,
            });
      const recoveredPlanMatches =
        storedRecoveredPassBInsights !== null &&
        recoveredPassBInsights !== null &&
        expectedRecoveredPlanReceipt !== null &&
        JSON.stringify(storedRecoveredPassBInsights.planReceipt) ===
          JSON.stringify(expectedRecoveredPlanReceipt);
      if (recoveredPlanMatches) {
        const verifiedRecoveredRecord =
          recoveredPassBInsights === storedRecoveredPassBInsights
            ? storedRecoveredPassBInsights
            : await persistCandidatePassBInsightsWithReadback(
                store,
                storedRecoveredPassBInsights,
                recoveredPassBInsights,
              );
        if (!restoreIsCurrent()) return;
        candidatePassBEvidenceRef.current =
          verifiedRecoveredRecord.evidenceById;
        candidateGeminiInsightRef.current =
          verifiedRecoveredRecord.insightById;
        candidatePassBModelByIdRef.current =
          verifiedRecoveredRecord.modelByCandidateId;
        candidateTimelineFramesRef.current = Object.fromEntries(
          Object.entries(verifiedRecoveredRecord.thumbnailById).map(
            ([candidateId, frame]) => [candidateId, [frame]],
          ),
        );
        candidatePassBVerificationReceiptRef.current =
          verifiedRecoveredRecord.verificationReceiptById;
        candidatePassBDispatchIntentRef.current =
          verifiedRecoveredRecord.dispatchIntentByCandidateId;
        candidatePassBAttemptLedgerRef.current =
          verifiedRecoveredRecord.attemptLedgerByCandidateId;
        candidatePassBSettlementRef.current =
          verifiedRecoveredRecord.settlementByCandidateId;
        candidatePassBDurableInsightsRef.current = verifiedRecoveredRecord;
        candidatePassBPlanReceiptRef.current =
          verifiedRecoveredRecord.planReceipt;
        candidatePassBPlanReplacementRequiredRef.current = false;
        setCandidatePassBEvidenceById(verifiedRecoveredRecord.evidenceById);
        setCandidateGeminiInsightById(verifiedRecoveredRecord.insightById);
        setCandidateTimelineFramesById(
          candidateTimelineFramesRef.current,
        );
        setCandidatePassBVerificationReceiptById(
          verifiedRecoveredRecord.verificationReceiptById,
        );
        setCandidatePassBDurableInsights(verifiedRecoveredRecord);
        setCandidatePassBInsightPersistenceStatus("verified");
      } else {
        candidatePassBPlanReplacementRequiredRef.current = true;
        setCandidatePassBInsightPersistenceStatus("idle");
      }
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
    channelPreanalysisConfirmationAbortController.current?.abort();
    channelPreanalysisConfirmationAbortController.current = null;
    setChannelPreanalysisConfirmationPending(false);
    channelPreanalysisBundleBindingRef.current = null;
    replaceChannelPreanalysisConnection({ status: "idle" });
    setManualVodInput("");
    manualVodInputRef.current = "";
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
              analysisCaptionVideoId,
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
        title: candidateTitleById[candidate.id],
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
    void downloadCandidateThumbnail(candidate);
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

  const downloadCandidateSubtitles = async (candidate: ReviewedCandidate): Promise<void> => {
    const range = effectiveCandidateRange(candidate, boundaryRevisions[candidate.id]);
    const presentation = buildCandidatePassBPresentation(
      candidate.id,
      buildHighlightNarrative(candidate),
      candidatePassBEvidenceById[candidate.id]?.candidateId === candidate.id
        ? candidatePassBEvidenceById[candidate.id]
        : undefined,
    );
    const availability = assessClipSubtitleCoverage(presentation.cues, {
      startMs: range.startMs,
      endMs: range.endMs,
    });
    if (!availability.available) {
      return;
    }
    const srt = buildClipSrt(presentation.cues, { startMs: range.startMs, endMs: range.endMs });
    const { buildClipBaseName } = await import("./media/clipRenderer");
    const baseName = buildClipBaseName(
      candidateNumberFor(candidate.id),
      range,
      candidateTitleById[candidate.id],
    );
    const blob = new Blob([srt], { type: "text/srt;charset=utf-8" });
    let objectUrl: string | null = null;
    try {
      objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${baseName}.srt`;
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      const urlToRelease = objectUrl;
      globalThis.setTimeout(() => URL.revokeObjectURL(urlToRelease), 10_000);
      objectUrl = null;
    } catch {
      if (objectUrl !== null) {
        URL.revokeObjectURL(objectUrl);
      }
    }
  };

  const downloadCandidateThumbnail = async (candidate: ReviewedCandidate): Promise<void> => {
    const frame = candidateTimelineFramesById[candidate.id]?.[0];
    if (frame === undefined) {
      return;
    }
    const range = effectiveCandidateRange(candidate, boundaryRevisions[candidate.id]);
    const { buildClipBaseName } = await import("./media/clipRenderer");
    const baseName = buildClipBaseName(
      candidateNumberFor(candidate.id),
      range,
      candidateTitleById[candidate.id],
    );
    const anchor = document.createElement("a");
    anchor.href = `data:${frame.mimeType};base64,${frame.dataBase64}`;
    anchor.download = `${baseName}.jpg`;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
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
        void downloadCandidateThumbnail(candidate);
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
    const runId = currentAnalysisRunId;
    const inputSignature = currentAnalysisInputSignature;
    if (
      runId === null ||
      inputSignature === null ||
      broadcastContextStatus !== "completed" ||
      semanticLeadRefinementStatus !== "completed"
    ) {
      return;
    }
    const operationKey = JSON.stringify([
      "exclipper.candidate-pass-b-plan.v1",
      runId,
      inputSignature,
      broadcastContextAttemptOrdinal,
      semanticLeadRefinementAttemptOrdinal,
      semanticRefinementEvidenceProjectionFingerprint,
      candidateDetailCandidateIds,
    ]);
    const retry = candidatePassBPlanRetryRef.current;
    if (retry.operationKey !== operationKey) {
      retry.operationKey = operationKey;
      retry.attempts = 0;
    }
    let cancelled = false;
    const delayMs =
      retry.attempts === 0
        ? 0
        : Math.min(30_000, 1_000 * 2 ** Math.min(retry.attempts - 1, 5));
    const timer = globalThis.setTimeout(() => {
      void ensureCandidatePassBPlanPersistenceRef.current(
        candidateDetailCandidateIds,
      ).then(
        () => {
          if (!cancelled) {
            retry.attempts = 0;
          }
        },
        () => {
          if (!cancelled && isMounted.current) {
            retry.attempts += 1;
            setCandidatePassBPlanRetryEpoch((epoch) => epoch + 1);
          }
        },
      );
    }, delayMs);
    return () => {
      cancelled = true;
      globalThis.clearTimeout(timer);
    };
  }, [
    broadcastContextStatus,
    broadcastContextAttemptOrdinal,
    candidateDetailCandidateIds,
    candidatePassBPlanRetryEpoch,
    currentAnalysisInputSignature,
    currentAnalysisRunId,
    semanticLeadRefinementStatus,
    semanticLeadRefinementAttemptOrdinal,
    semanticRefinementEvidenceProjectionFingerprint,
  ]);

  useEffect(() => {
    const wholeContextGateSettled =
      broadcastContextStatus === "completed" &&
      semanticLeadRefinementStatus === "completed";
    const operationKey =
      sourceContentFingerprint === null
        ? null
        : JSON.stringify([
            "exclipper.candidate-pass-b-auto.v4",
            sourceContentFingerprint,
            automaticCandidateDetailIds.map((candidateId) => [
              candidateId,
              candidatePassBSourceFenceById[candidateId] ?? null,
              candidatePassBContextById[candidateId] ?? null,
            ]),
          ]);
    if (
      !analysisComplete ||
      automaticCandidateDetailIds.length === 0 ||
      sourceFile === null ||
      operationKey === null ||
      !wholeContextGateSettled ||
      candidatePassBBusy ||
      candidatePassBInsightPersistenceStatus !== "verified" ||
      candidatePassBAutoRetryRef.current.timeout !== null ||
      autoCandidatePassBSourceRef.current === operationKey
    ) {
      return;
    }
    /*
     * The guard records what has *started*, never what was merely scheduled.
     *
     * It used to be set here, beside the timer. But this effect's deps settle
     * over several renders — semantic refinement appends candidates, which
     * rebuilds the context map, which rebuilds the id list — so a dep almost
     * always changes inside the 450ms wait. Cleanup then cancelled the timer
     * while the guard still held the key, and because the key is built from
     * the ids rather than from object identity, the re-run produced the *same*
     * key and short-circuited. Pass B never ran, every candidate stopped at
     * `detail-result-missing`, and the editor got an empty review screen for a
     * broadcast whose moments had been found correctly.
     *
     * The key now travels with the call, is claimed only after worker setup,
     * and becomes permanent only after exact durable readback. A transient
     * failure releases it after bounded backoff, so only outstanding candidates
     * are retried.
     */
    const timer = scheduleCandidatePassBAutomaticTargetReadback({
      candidateIds: candidateDetailCandidateIds,
      delayMs: 450,
      readDurableInput: () => {
        const durableRecord = candidatePassBDurableInsightsRef.current;
        return {
          attemptLedgerByCandidateId:
            durableRecord?.attemptLedgerByCandidateId ?? {},
          dispatchIntentByCandidateId:
            durableRecord?.dispatchIntentByCandidateId ?? {},
          settlementByCandidateId:
            durableRecord?.settlementByCandidateId ?? {},
        };
      },
      onReady: (currentTargets) => {
        if (
          JSON.stringify(currentTargets) !==
          JSON.stringify(candidatePassBAutomaticTargets)
        ) {
          if (isMounted.current) {
            setCandidatePassBAutoRetryEpoch((epoch) => epoch + 1);
          }
          return;
        }
        void runCandidatePassBRef.current(
          currentTargets.map(({ candidateId }) => candidateId),
          operationKey,
        );
      },
    });
    return () => globalThis.clearTimeout(timer);
  }, [
    analysisComplete,
    automaticCandidateDetailIds,
    candidatePassBAutomaticTargets,
    candidatePassBAutoRetryEpoch,
    broadcastContextStatus,
    broadcastTranscriptStatus,
    candidatePassBContextById,
    candidatePassBSourceFenceById,
    candidateDetailCandidateIds,
    candidatePassBBusy,
    candidatePassBInsightPersistenceStatus,
    semanticLeadRefinementStatus,
    sourceContentFingerprint,
    sourceFile,
  ]);

  useEffect(() => {
    const runId = currentAnalysisRunId;
    const retry = candidatePassBPersistenceAutoRetryRef.current;
    if (
      !candidatePassBPersistenceRetryNeeded ||
      candidatePassBBusy ||
      runId === null
    ) {
      if (
        candidatePassBInsightPersistenceStatus === "idle" ||
        candidatePassBInsightPersistenceStatus === "verified"
      ) {
        retry.runId = runId;
        retry.attempts = 0;
      }
      return;
    }
    if (retry.runId !== runId) {
      retry.runId = runId;
      retry.attempts = 0;
    }
    let cancelled = false;
    const delayMs = Math.min(
      30_000,
      1_000 * 2 ** Math.min(retry.attempts, 5),
    );
    const timer = globalThis.setTimeout(() => {
      void retryCandidatePassBInsightPersistenceRef.current().then((succeeded) => {
        if (cancelled || !isMounted.current) {
          return;
        }
        if (succeeded) {
          retry.attempts = 0;
        } else {
          retry.attempts += 1;
          setCandidatePassBPersistenceAutoRetryEpoch((epoch) => epoch + 1);
        }
      });
    }, delayMs);
    return () => {
      cancelled = true;
      globalThis.clearTimeout(timer);
    };
  }, [
    candidatePassBBusy,
    candidatePassBInsightPersistenceStatus,
    candidatePassBPersistenceAutoRetryEpoch,
    candidatePassBPersistenceRetryNeeded,
    currentAnalysisRunId,
  ]);

  useEffect(() => {
    const runId = currentAnalysisRunId;
    const inputSignature = currentAnalysisInputSignature;
    const activeTranscriptSeal =
      broadcastTranscriptStatus === "completed"
        ? sealedBroadcastTranscriptSourceRef.current
        : null;
    const requiredTranscriptSealPrefix =
      runId === null || sourceContentFingerprint === null
        ? null
        : `${transcriptOperationKey(
            runId,
            sourceContentFingerprint,
            "event-boost",
          )}:identity-`;
    const requiredTranscriptSeal =
      activeTranscriptSeal !== null &&
      requiredTranscriptSealPrefix !== null &&
      activeTranscriptSeal.startsWith(requiredTranscriptSealPrefix)
        ? activeTranscriptSeal
        : null;
    const contextTranscriptReadiness = transcriptContextReadiness({
      analysisComplete,
      broadcastTranscriptStatus,
      completedChapterCount: boundedBroadcastContextChapters.length,
      requiredEventBoostOperationKey: requiredTranscriptSeal,
      sealedOperationKey: sealedBroadcastTranscriptSourceRef.current,
      visualInspectionPlannedCellCount:
        broadcastVisualInspectionPlannedCellCount,
      visualInspectionSettledCellCount:
        broadcastVisualInspectionSettledCellCount,
    });
    if (
      // Whole-context reasoning is billed once per map. During the parallel
      // prelude the transcript map is uniform-only and candidates are absent,
      // so reasoning here would spend on an incomplete picture and then spend
      // again. The scan completing is what seals the map.
      !analysisComplete ||
      runId === null ||
      inputSignature === null ||
      requiredTranscriptSeal === null ||
      boundarySourceDurationMs <= 0 ||
      broadcastParticipantPreContext === null ||
      broadcastParticipantPreContext.sourceFence.transcriptSeal !==
        requiredTranscriptSeal ||
      broadcastParticipantGrounding.status !== "sealed" ||
      contextTranscriptReadiness === "not-ready"
    ) {
      return;
    }
    if (contextTranscriptReadiness === "visual-evidence-required") {
      /*
       * Visual inspection owns its own durable retry state. Whole-context
       * reasoning waits here instead of converting an in-progress visual lane
       * into a terminal context failure.
       */
      return;
    }

    const contextInput = {
      sourceDurationMs: boundarySourceDurationMs,
      chapters: boundedBroadcastContextChapters,
      candidates: broadcastContextCandidateInputs,
      participantGrounding: broadcastParticipantGrounding,
      outputLanguage: analysisLanguage,
      castRosterId: sourceCastRosterId,
    };
    const preanalysisContextSeedSource =
      sourceContentFingerprint === null
        ? null
        : channelPreanalysisContextSeedSource(
            channelPreanalysisConnection,
            channelPreanalysisBundleBindingRef.current,
            sourceContentFingerprint,
            analysisCaptionVideoId,
            boundarySourceDurationMs,
            sourceCastRosterId,
            analysisLanguage,
          );
    const preanalysisContextSeedOperationFence =
      preanalysisContextSeedSource === null
        ? "no-channel-preanalysis-context-seed"
        : JSON.stringify([
            preanalysisContextSeedSource.bundle.videoId,
            preanalysisContextSeedSource.bundle.transcriptDigest,
            preanalysisContextSeedSource.sourceIdentity,
            preanalysisContextSeedSource.bundle.contextProvenance,
            preanalysisContextSeedSource.bundle.broadcastContext,
          ]);
    const contextInputBaseSnapshotJson = JSON.stringify(contextInput);
    const participantEvidenceOperationFence = JSON.stringify({
      planFingerprint: broadcastParticipantPreContext.planFingerprint,
      sealedPlan: broadcastParticipantPreContext.sealedPlan,
    });
    const operationKey =
      `${runId}:${inputSignature}:${requiredTranscriptSeal}` +
      `:context-attempt-${broadcastContextAttemptOrdinal}` +
      `:${contextInputBaseSnapshotJson}:${participantEvidenceOperationFence}` +
      `:${preanalysisContextSeedOperationFence}`;
    if (autoBroadcastContextSourceRef.current === operationKey) {
      return;
    }
    autoBroadcastContextSourceRef.current = operationKey;
    broadcastContextAbortController.current?.abort();
    const controller = new AbortController();
    broadcastContextAbortController.current = controller;
    const store = getResultStore();
    setBroadcastContextStatus("running");
    setBroadcastContextError(null);

    const operationIsCurrent = (): boolean =>
      !controller.signal.aborted &&
      isMounted.current &&
      broadcastContextAbortController.current === controller &&
      autoBroadcastContextSourceRef.current === operationKey;
    const waitForSessionRetry = (delayMs: number): Promise<void> =>
      new Promise((resolve, reject) => {
        let timer: ReturnType<typeof globalThis.setTimeout> | null =
          globalThis.setTimeout(() => {
            timer = null;
            controller.signal.removeEventListener("abort", onAbort);
            resolve();
          }, delayMs);
        const onAbort = (): void => {
          if (timer !== null) {
            globalThis.clearTimeout(timer);
            timer = null;
          }
          controller.signal.removeEventListener("abort", onAbort);
          reject(new DOMException("Broadcast context cancelled.", "AbortError"));
        };
        controller.signal.addEventListener("abort", onAbort, { once: true });
      });
    const runSessionCheckpoint = async (
      label: string,
      operationToken: string,
      run: (
        isCurrent: (
          identity: {
            readonly runId: string;
            readonly operationToken: string;
            readonly inputSignature: string;
          },
        ) => boolean,
      ) => Promise<DurableBroadcastContextSessionResult>,
    ) => {
      let retryCycle = 0;
      while (operationIsCurrent()) {
        const isCurrent = (identity: {
          readonly runId: string;
          readonly operationToken: string;
          readonly inputSignature: string;
        }): boolean =>
          operationIsCurrent() &&
          identity.runId === runId &&
          identity.operationToken === operationToken &&
          identity.inputSignature === inputSignature;
        const result = await run(isCurrent);
        switch (result.status) {
          case "succeeded":
            return result.value;
          case "retry-exhausted":
            retryCycle += 1;
            console.warn(
              `Broadcast context ${label} checkpoint will resume.`,
              result.reasonCode,
            );
            await waitForSessionRetry(
              Math.min(30_000, 1_000 * 2 ** Math.min(retryCycle - 1, 5)),
            );
            break;
          case "aborted":
            throw new DOMException(
              "Broadcast context cancelled.",
              "AbortError",
            );
          case "stale":
          case "permanent-failure":
            throw new Error(
              `Broadcast context ${label} checkpoint rejected: ${result.reasonCode}`,
            );
        }
      }
      throw new DOMException("Broadcast context cancelled.", "AbortError");
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
      const qualified = finalizeContextQualifiedCandidates(
        pipelineCandidates,
        result.annotations,
      );
      setCandidateAiProjectionById(qualified.projectionById);
      setSelectionResult((current) =>
        current === null
          ? current
          : { ...current, candidateCount: pipelineCandidates.length },
      );
      setBroadcastContextStatus("completed");
    };

    void (async () => {
      const trustedPrecomputedSourceIdentity =
        preanalysisContextSeedSource === null
          ? null
          : preanalysisContextSeedSource.sourceIdentity;
      let precomputedGlobalContextSeed: ChannelPreanalysisContextSeed | null =
        null;
      if (preanalysisContextSeedSource !== null) {
        const { bundle } = preanalysisContextSeedSource;
        const { broadcastContext, contextProvenance } = bundle;
        if (
          broadcastContext !== null &&
          contextProvenance !== null
        ) {
          try {
            precomputedGlobalContextSeed =
              await createChannelPreanalysisContextSeed({
                sourceDurationMs: bundle.durationMs,
                chapters: compactBroadcastContextChapters(bundle.chapters),
                castRosterId: sourceCastRosterId,
                outputLanguage: "ko",
                sourceIdentity:
                  trustedPrecomputedSourceIdentity!,
                provenance: contextProvenance,
                result: broadcastContext,
              });
          } catch (error) {
            console.warn(
              "Verified channel preanalysis context could not be fingerprinted; using the local context route.",
              error,
            );
          }
        }
      }
      const contextInputSnapshotJson = JSON.stringify({
        ...contextInput,
        ...(precomputedGlobalContextSeed === null
          ? {}
          : {
              channelPreanalysisContextSeed: {
                schemaVersion:
                  precomputedGlobalContextSeed.schemaVersion,
                seedFingerprint:
                  precomputedGlobalContextSeed.seedFingerprint,
                sourceIdentity:
                  precomputedGlobalContextSeed.sourceIdentity,
                provenance: precomputedGlobalContextSeed.provenance,
              },
            }),
      });
      const participantGroundingPlanFingerprint =
        broadcastParticipantPreContext.planFingerprint;
      const participantGroundingCheckpointJson =
        await serializeBroadcastParticipantPreContextCheckpoint(
          broadcastParticipantPreContext,
          {
            sourceDurationMs: boundarySourceDurationMs,
            sourceCastRosterId,
            transcriptSealOperationKey: requiredTranscriptSeal,
            dialogueChapters: boundedBroadcastTranscriptDialogueChapters,
            participantGroundingPlanFingerprint,
          },
        );
      const participantGroundingInputSignature =
        await createBroadcastParticipantGroundingInputSignature({
          inputSignature,
          transcriptSealOperationKey: requiredTranscriptSeal,
          participantGroundingPlanFingerprint,
          participantGroundingCheckpointJson,
        });
      const contextInputSignature = await createContentFingerprint([
        inputSignature,
        contextInputSnapshotJson,
        participantGroundingInputSignature,
        `broadcast-context-routing:${AI_BROADCAST_CONTEXT_ROUTING_REVISION}`,
        `topical-discovery:${BROADCAST_TOPICAL_DISCOVERY_VERSION}`,
      ]);
      const contextLedgerFence: BroadcastContextPhaseLedgerFence = {
        parentContextSignature: contextInputSignature,
        transcriptSignature: requiredTranscriptSeal,
        groundingSignature: participantGroundingInputSignature,
      };
      if (!operationIsCurrent()) return;
      let saved = await runSessionCheckpoint(
        "session-load",
        `${runId}:${contextInputSignature}:session-load`,
        (isCurrent) =>
          loadDurableBroadcastContextSession({
            store,
            identity: {
              runId,
              operationToken:
                `${runId}:${contextInputSignature}:session-load`,
              inputSignature,
            },
            isCurrent,
            signal: controller.signal,
          }),
      );
      const serializedContextChapters = JSON.stringify(contextInput.chapters);
      if (
        saved.inputSignature !== inputSignature ||
        saved.sourceCastRosterId !== sourceCastRosterId ||
        saved.transcriptSealOperationKey !== requiredTranscriptSeal ||
        sealedBroadcastTranscriptSourceRef.current !== requiredTranscriptSeal ||
        JSON.stringify(compactBroadcastContextChapters(saved.chapters)) !==
          serializedContextChapters
      ) {
        throw new Error(
          "저장된 방송 대사 지도와 현재 인물 근거 지도가 일치하지 않아요. 최신 대사 지도를 먼저 복구해 주세요.",
        );
      }
      if (
        saved.participantGroundingInputSignature !==
          participantGroundingInputSignature ||
        saved.participantGroundingPlanFingerprint !==
          participantGroundingPlanFingerprint ||
        saved.participantGroundingCheckpointJson !==
          participantGroundingCheckpointJson
      ) {
        const groundingOperationToken =
          `${runId}:${contextInputSignature}:participant-grounding`;
        const groundingRecordedAt = new Date().toISOString();
        const previousGroundingInputSignature =
          saved.participantGroundingInputSignature;
        const previousGroundingPlanFingerprint =
          saved.participantGroundingPlanFingerprint;
        const previousGroundingCheckpointJson =
          saved.participantGroundingCheckpointJson;
        saved = await runSessionCheckpoint(
          "participant-grounding",
          groundingOperationToken,
          (isCurrent) =>
            transformDurableBroadcastContextSession({
              store,
              identity: {
                runId,
                operationToken: groundingOperationToken,
                inputSignature,
              },
              expected: saved,
              isCurrent,
              signal: controller.signal,
              transform: (current) => {
                if (
                  current.sourceCastRosterId !== sourceCastRosterId ||
                  current.transcriptSealOperationKey !==
                    requiredTranscriptSeal ||
                  JSON.stringify(
                    compactBroadcastContextChapters(current.chapters),
                  ) !== serializedContextChapters
                ) {
                  throw new Error(
                    "The transcript or participant source changed.",
                  );
                }
                if (
                  current.participantGroundingInputSignature ===
                    participantGroundingInputSignature &&
                  current.participantGroundingPlanFingerprint ===
                    participantGroundingPlanFingerprint &&
                  current.participantGroundingCheckpointJson ===
                    participantGroundingCheckpointJson
                ) {
                  return current;
                }
                if (
                  current.participantGroundingInputSignature !==
                    previousGroundingInputSignature ||
                  current.participantGroundingPlanFingerprint !==
                    previousGroundingPlanFingerprint ||
                  current.participantGroundingCheckpointJson !==
                    previousGroundingCheckpointJson
                ) {
                  throw new Error(
                    "A newer participant grounding checkpoint is already stored.",
                  );
                }
                return {
                  ...current,
                  participantGroundingInputSignature,
                  participantGroundingPlanFingerprint,
                  participantGroundingCheckpointJson,
                  contextInputSignature: null,
                  contextInputCheckpointJson: null,
                  contextPhaseLedgerJson: null,
                  contextResultJson: null,
                  refinementTranscriptInputSignature: null,
                  refinementTranscriptCheckpointJson: null,
                  refinementEvidenceLedgerJson: null,
                  refinementInputSignature: null,
                  refinementCandidatesJson: null,
                  recordedAt: groundingRecordedAt,
                };
              },
            }),
        );
        if (
          saved.participantGroundingInputSignature !==
            participantGroundingInputSignature ||
          saved.participantGroundingPlanFingerprint !==
            participantGroundingPlanFingerprint ||
          saved.participantGroundingCheckpointJson !==
            participantGroundingCheckpointJson
        ) {
          throw new Error(
            "저장한 인물 근거 지도를 다시 확인하지 못했어요. 전체 맥락 분석은 시작하지 않았습니다.",
          );
        }
      }
      if (
        saved.contextInputSignature !== null &&
        (saved.contextInputSignature !== contextInputSignature ||
          saved.contextInputCheckpointJson !== contextInputSnapshotJson)
      ) {
        const staleContextSession = saved;
        const invalidationOperationToken =
          `${runId}:${contextInputSignature}:context-input-invalidation`;
        const invalidatedAt = new Date().toISOString();
        saved = await runSessionCheckpoint(
          "context-input-invalidation",
          invalidationOperationToken,
          (isCurrent) =>
            transformDurableBroadcastContextSession({
              store,
              identity: {
                runId,
                operationToken: invalidationOperationToken,
                inputSignature,
              },
              expected: staleContextSession,
              isCurrent,
              signal: controller.signal,
              transform: (current) =>
                invalidateBroadcastContextSessionContext(
                  current,
                  invalidatedAt,
                ),
            }),
        );
        if (
          saved.contextInputSignature !== null ||
          saved.contextInputCheckpointJson !== null ||
          saved.contextPhaseLedgerJson !== null ||
          saved.contextResultJson !== null ||
          saved.refinementTranscriptInputSignature !== null ||
          saved.refinementTranscriptCheckpointJson !== null ||
          saved.refinementEvidenceLedgerJson !== null ||
          saved.refinementInputSignature !== null ||
          saved.refinementCandidatesJson !== null
        ) {
          throw new Error(
            "The stale whole-context checkpoint could not be invalidated before applying the current preanalysis seed.",
          );
        }
      }
      if (
        saved.inputSignature === inputSignature &&
        saved.contextInputSignature === contextInputSignature &&
        saved.contextInputCheckpointJson === contextInputSnapshotJson &&
        saved.contextResultJson !== null
      ) {
        const savedLedger =
          saved.contextPhaseLedgerJson === null
            ? null
            : parseBroadcastContextPhaseLedgerJson(
                saved.contextPhaseLedgerJson,
              );
        let savedPayload: unknown;
        try {
          savedPayload = JSON.parse(saved.contextResultJson);
        } catch {
          savedPayload = null;
        }
        const savedEnvelope = unpackPersistedBroadcastContext(savedPayload);
        const savedResult =
          savedEnvelope === null
            ? null
            : parsePersistedBroadcastContextResult(
                savedEnvelope.resultPayload,
                contextInput,
              );
        if (
          savedResult !== null &&
          savedEnvelope !== null &&
          savedLedger !== null &&
          broadcastContextPhaseLedgerMatchesFence(
            savedLedger,
            contextLedgerFence,
          ) &&
          savedLedger.units
            .filter(
              (unit) =>
                unit.required &&
                (unit.phase === "discovery" || unit.phase === "jury"),
            )
            .every((unit) => unit.status === "succeeded") &&
          savedLedger.units.some(
            (unit) =>
              unit.phase === "discovery" && unit.unitId === "overview",
          ) &&
          savedLedger.units.some(
            (unit) => unit.phase === "jury" && unit.unitId === "selection",
          )
        ) {
          if (operationIsCurrent()) {
            applyContextResult(
              savedResult,
              savedEnvelope.refinementLeadIds,
              savedEnvelope.fastRefinementLeadIds,
            );
          }
          return;
        }
      }

      // Every paid sub-request is fenced by the exact transcript, participant
      // grounding and request bytes. Provider calls may run in parallel, while
      // each transition is committed and read back serially before publication.
      const endContextSpan = stageTimerRef.current?.startSpan(
        "broadcast-context-ai",
        Date.now(),
      );
      const contextPipeline = await (async () => {
        try {
          return await runDurableBroadcastContextPipeline({
            store,
            initialSession: saved,
            runId,
            contextInput,
            contextInputSignature,
            contextInputCheckpointJson: contextInputSnapshotJson,
            fence: contextLedgerFence,
            quotaParticipantId: aiQuotaParticipantId,
            operationGeneration: broadcastContextAttemptOrdinal,
            retryMode: "automatic-free-tier",
            signal: controller.signal,
            precomputedGlobalContextSeed,
            trustedPrecomputedSourceIdentity,
          });
        } finally {
          endContextSpan?.(Date.now());
        }
      })();
      const {
        result,
        refinementLeadIds,
        fastRefinementLeadIds,
      } = contextPipeline;
      if (!operationIsCurrent()) return;
      const transcriptSession = await runSessionCheckpoint(
        "post-ai-readback",
        `${runId}:${contextInputSignature}:post-ai-readback`,
        (isCurrent) =>
          loadDurableBroadcastContextSession({
            store,
            identity: {
              runId,
              operationToken:
                `${runId}:${contextInputSignature}:post-ai-readback`,
              inputSignature,
            },
            isCurrent,
            signal: controller.signal,
          }),
      );
      if (!operationIsCurrent()) return;
      const serializedContextLedger =
        serializeBroadcastContextPhaseLedger(contextPipeline.ledger);
      if (
        transcriptSession.inputSignature !== inputSignature ||
        transcriptSession.sourceCastRosterId !== sourceCastRosterId ||
        transcriptSession.transcriptSealOperationKey !==
          requiredTranscriptSeal ||
        sealedBroadcastTranscriptSourceRef.current !== requiredTranscriptSeal ||
        transcriptSession.participantGroundingInputSignature !==
          participantGroundingInputSignature ||
        transcriptSession.participantGroundingPlanFingerprint !==
          participantGroundingPlanFingerprint ||
        transcriptSession.participantGroundingCheckpointJson !==
          participantGroundingCheckpointJson ||
        transcriptSession.contextPhaseLedgerJson !==
          serializedContextLedger ||
        JSON.stringify(
          compactBroadcastContextChapters(transcriptSession.chapters),
        ) !== serializedContextChapters
      ) {
        throw new Error(
          "전사 지도가 갱신되어 이전 맥락 결과를 저장하지 않았어요. 최신 전사로 다시 분석합니다.",
        );
      }
      const contextCandidateIds = broadcastContextCandidateInputs.map(
        ({ candidateId }) => candidateId,
      );
      if (!operationIsCurrent()) return;
      const contextResultJson = JSON.stringify({
        schemaVersion: "1.2.0",
        result,
        refinementLeadIds,
        fastRefinementLeadIds,
        contextCandidateIds,
      });
      const contextCommitOperationToken =
        `${runId}:${contextInputSignature}:context-result`;
      const contextRecordedAt = new Date().toISOString();
      const reopened = await runSessionCheckpoint(
        "context-result",
        contextCommitOperationToken,
        (isCurrent) =>
          transformDurableBroadcastContextSession({
            store,
            identity: {
              runId,
              operationToken: contextCommitOperationToken,
              inputSignature,
            },
            expected: transcriptSession,
            isCurrent,
            signal: controller.signal,
            transform: (current) => {
              if (
                current.sourceCastRosterId !== sourceCastRosterId ||
                current.transcriptSealOperationKey !==
                  requiredTranscriptSeal ||
                current.participantGroundingInputSignature !==
                  participantGroundingInputSignature ||
                current.participantGroundingPlanFingerprint !==
                  participantGroundingPlanFingerprint ||
                current.participantGroundingCheckpointJson !==
                  participantGroundingCheckpointJson ||
                current.contextPhaseLedgerJson !== serializedContextLedger ||
                JSON.stringify(
                  compactBroadcastContextChapters(current.chapters),
                ) !== serializedContextChapters
              ) {
                throw new Error(
                  "The transcript, participant grounding, or context ledger changed.",
                );
              }
              if (
                current.contextInputSignature === contextInputSignature &&
                current.contextInputCheckpointJson ===
                  contextInputSnapshotJson &&
                current.contextResultJson === contextResultJson
              ) {
                return current;
              }
              return {
                ...current,
                contextInputSignature,
                contextInputCheckpointJson: contextInputSnapshotJson,
                contextPhaseLedgerJson: serializedContextLedger,
                contextResultJson,
                refinementTranscriptInputSignature: null,
                refinementTranscriptCheckpointJson: null,
                refinementEvidenceLedgerJson: null,
                refinementInputSignature: null,
                refinementCandidatesJson: null,
                recordedAt: contextRecordedAt,
              };
            },
          }),
      );
      if (!operationIsCurrent()) return;
      if (
        reopened.inputSignature !== inputSignature ||
        reopened.participantGroundingInputSignature !==
          participantGroundingInputSignature ||
        reopened.participantGroundingPlanFingerprint !==
          participantGroundingPlanFingerprint ||
        reopened.participantGroundingCheckpointJson !==
          participantGroundingCheckpointJson ||
        reopened.contextInputCheckpointJson !== contextInputSnapshotJson ||
        reopened.contextPhaseLedgerJson !== serializedContextLedger ||
        JSON.stringify(compactBroadcastContextChapters(reopened.chapters)) !==
          serializedContextChapters ||
        reopened.contextInputSignature !== contextInputSignature ||
        reopened.contextResultJson === null
      ) {
        throw new Error("저장한 방송 전체 맥락 결과를 다시 확인하지 못했어요.");
      }
      const reopenedPayload: unknown = JSON.parse(reopened.contextResultJson);
      const reopenedEnvelope = unpackPersistedBroadcastContext(reopenedPayload);
      const reopenedResult =
        reopenedEnvelope === null
          ? null
          : parsePersistedBroadcastContextResult(
              reopenedEnvelope.resultPayload,
              contextInput,
            );
      if (
        reopenedEnvelope === null ||
        reopenedResult === null ||
        reopenedEnvelope.contextCandidateIds.length !== contextCandidateIds.length ||
        reopenedEnvelope.contextCandidateIds.some(
          (candidateId, index) => candidateId !== contextCandidateIds[index],
        )
      ) {
        throw new Error("저장한 방송 전체 맥락 결과 형식을 다시 확인하지 못했어요.");
      }
      if (!controller.signal.aborted && isMounted.current) {
        applyContextResult(
          reopenedResult,
          reopenedEnvelope.refinementLeadIds,
          reopenedEnvelope.fastRefinementLeadIds,
        );
      }
    })()
      .catch(async (error: unknown) => {
        if (controller.signal.aborted || !isMounted.current) return;
        try {
          const checkpoint = await store.getBroadcastContextSession(runId);
          const checkpointLedger =
            checkpoint?.inputSignature === inputSignature &&
            checkpoint.contextPhaseLedgerJson !== null
              ? parseBroadcastContextPhaseLedgerJson(
                  checkpoint.contextPhaseLedgerJson,
                )
              : null;
          const retryDelayMs =
            checkpointLedger === null
              ? null
              : automaticContextRetryDelayMs(checkpointLedger);
          if (retryDelayMs !== null && operationIsCurrent()) {
            setBroadcastContextStatus("running");
            setBroadcastContextError(
              analysisLanguage === "ko"
                ? "일시적인 AI 응답 오류가 있어 저장된 조각부터 자동으로 이어갑니다."
                : "A transient AI response failed. Resuming automatically from the durable fragments.",
            );
            try {
              await waitForSessionRetry(retryDelayMs);
            } catch {
              return;
            }
            if (operationIsCurrent()) {
              autoBroadcastContextSourceRef.current = null;
              setBroadcastContextAttemptOrdinal((current) => current + 1);
            }
            return;
          }
        } catch (recoveryError) {
          console.warn(
            "Broadcast context automatic recovery inspection failed.",
            recoveryError,
          );
        }
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
    aiQuotaParticipantId,
    analysisCaptionVideoId,
    analysisComplete,
    boundarySourceDurationMs,
    boundedBroadcastContextChapters,
    boundedBroadcastTranscriptDialogueChapters,
    broadcastParticipantGrounding,
    broadcastParticipantPreContext,
    broadcastContextAttemptOrdinal,
    broadcastContextCandidateInputs,
    broadcastTranscriptAttemptOrdinal,
    broadcastTranscriptStatus,
    broadcastVisualInspectionPlannedCellCount,
    broadcastVisualInspectionSettledCellCount,
    channelPreanalysisConnection,
    currentAnalysisInputSignature,
    currentAnalysisRunId,
    getResultStore,
    pipelineCandidates,
    resetCandidateRanking,
    sourceContentFingerprint,
    sourceCastRosterId,
    transcriptSourceIdentityFence,
    analysisLanguage,
  ]);

  useEffect(() => {
    const semanticInputSignature = currentAnalysisInputSignature;
    if (
      broadcastContextStatus !== "completed" ||
      broadcastContextResult === null ||
      broadcastContextRefinementLeadIds === null ||
      broadcastContextFastRefinementLeadIds === null ||
      broadcastParticipantPreContext === null ||
      semanticRefinementPlan === null ||
      sourceFile === null ||
      currentAnalysisRunId === null ||
      semanticInputSignature === null ||
      sourceContentFingerprint === null ||
      boundarySourceDurationMs <= 0
    ) {
      semanticLeadRefinementAbortController.current?.abort();
      semanticLeadRefinementAbortController.current = null;
      autoSemanticLeadRefinementSourceRef.current = null;
      setActiveRefinementEvidenceProjection(null);
      const retainedCandidates = candidatesRef.current.filter(
        (candidate) => !isContextDiscoveredCandidate(candidate),
      );
      if (retainedCandidates.length !== candidatesRef.current.length) {
        candidatesRef.current = retainedCandidates;
        setCandidates(retainedCandidates);
        setSelectionResult((current) =>
          current === null
            ? current
            : { ...current, candidateCount: retainedCandidates.length },
        );
        resetCandidateRanking(retainedCandidates);
      }
      return;
    }
    const plan = semanticRefinementPlan;
    const semanticOperationInput = JSON.stringify([
      "exclipper.semantic-refinement-effect.v2",
      currentAnalysisRunId,
      semanticInputSignature,
      sourceContentFingerprint,
      plan,
      boundedBroadcastContextChapters,
      broadcastParticipantGrounding,
      broadcastContextResult,
      broadcastContextFastRefinementLeadIds,
      youtubeCaptionTrackExactJson,
      analysisLanguage,
      AI_BROADCAST_CONTEXT_ROUTING_REVISION,
      BROADCAST_TOPICAL_DISCOVERY_VERSION,
      semanticLeadRefinementAttemptOrdinal,
    ]);
    const operationKey =
      `${currentAnalysisRunId}:semantic:${semanticOperationInput}`;
    if (autoSemanticLeadRefinementSourceRef.current === operationKey) {
      return;
    }
    autoSemanticLeadRefinementSourceRef.current = operationKey;
    semanticLeadRefinementAbortController.current?.abort();
    const controller = new AbortController();
    semanticLeadRefinementAbortController.current = controller;
    const store = getResultStore();
    const operationIsCurrent = (): boolean =>
      !controller.signal.aborted &&
      isMounted.current &&
      semanticLeadRefinementAbortController.current === controller &&
      autoSemanticLeadRefinementSourceRef.current === operationKey;
    const waitForSessionRetry = (delayMs: number): Promise<void> =>
      new Promise((resolve, reject) => {
        let timer: ReturnType<typeof globalThis.setTimeout> | null =
          globalThis.setTimeout(() => {
            timer = null;
            controller.signal.removeEventListener("abort", onAbort);
            resolve();
          }, delayMs);
        const onAbort = (): void => {
          if (timer !== null) {
            globalThis.clearTimeout(timer);
            timer = null;
          }
          controller.signal.removeEventListener("abort", onAbort);
          reject(
            new DOMException("Semantic refinement cancelled.", "AbortError"),
          );
        };
        controller.signal.addEventListener("abort", onAbort, { once: true });
      });
    const runSessionCheckpoint = async (
      label: string,
      operationToken: string,
      run: (
        isCurrent: (
          identity: {
            readonly runId: string;
            readonly operationToken: string;
            readonly inputSignature: string;
          },
        ) => boolean,
      ) => Promise<DurableBroadcastContextSessionResult>,
      settleAfterDispatch = false,
    ) => {
      let retryCycle = 0;
      let settlementWaveStarted = false;
      while (
        operationIsCurrent() ||
        (settleAfterDispatch && !settlementWaveStarted)
      ) {
        settlementWaveStarted = true;
        const isCurrent = (identity: {
          readonly runId: string;
          readonly operationToken: string;
          readonly inputSignature: string;
        }): boolean =>
          (settleAfterDispatch || operationIsCurrent()) &&
          identity.runId === currentAnalysisRunId &&
          identity.operationToken === operationToken &&
          identity.inputSignature === semanticInputSignature;
        const result = await run(isCurrent);
        switch (result.status) {
          case "succeeded":
            return result.value;
          case "retry-exhausted":
            if (settleAfterDispatch && !operationIsCurrent()) {
              throw new DOMException(
                "Semantic refinement terminal settlement was interrupted.",
                "AbortError",
              );
            }
            retryCycle += 1;
            console.warn(
              `Semantic refinement ${label} checkpoint will resume.`,
              result.reasonCode,
            );
            await waitForSessionRetry(
              Math.min(30_000, 1_000 * 2 ** Math.min(retryCycle - 1, 5)),
            );
            break;
          case "aborted":
            throw new DOMException(
              "Semantic refinement cancelled.",
              "AbortError",
            );
          case "stale":
          case "permanent-failure":
            throw new Error(
              `Semantic refinement ${label} checkpoint rejected: ${result.reasonCode}`,
            );
        }
      }
      throw new DOMException("Semantic refinement cancelled.", "AbortError");
    };
    setSemanticLeadRefinementStatus("running");
    setSemanticLeadRefinementError(null);
    const retainedCandidates = candidatesRef.current.filter(
      (candidate) => !isContextDiscoveredCandidate(candidate),
    );
    if (retainedCandidates.length !== candidatesRef.current.length) {
      candidatesRef.current = retainedCandidates;
      setCandidates(retainedCandidates);
      setSelectionResult((current) =>
        current === null
          ? current
          : { ...current, candidateCount: retainedCandidates.length },
      );
      resetCandidateRanking(retainedCandidates);
    }
    const allowOutcomeUnknownRetry =
      allowAmbiguousSemanticRefinementRetryRef.current;
    allowAmbiguousSemanticRefinementRetryRef.current = false;

    const chunks = plan.segments.map((segment) => ({
      chunkId: segment.segmentId,
      sourceStartMs: segment.sourceStartMs,
      sourceEndMs: segment.sourceEndMs,
      kind: "event" as const,
    }));
    const applySemanticCandidates = (
      proposals: readonly UnifiedHighlightCandidate[],
    ): void => {
      const latestCandidates = candidatesRef.current;
      const existingSemanticById = new Map(
        latestCandidates
          .filter(isContextDiscoveredCandidate)
          .map((candidate) => [candidate.id, candidate]),
      );
      const baseCandidates = latestCandidates.filter(
        (candidate) => !isContextDiscoveredCandidate(candidate),
      );
      const semanticCandidates: ReviewedCandidate[] =
        selectNonOverlappingDiscoveredCandidates(
          baseCandidates,
          proposals,
        ).map((proposal) => {
          const previous = existingSemanticById.get(proposal.id);
          return {
            ...proposal,
            reviewState: previous?.reviewState ?? "unreviewed",
            approvedBoundaryRevision:
              previous?.approvedBoundaryRevision ?? null,
          };
        });
      const nextCandidates = [...baseCandidates, ...semanticCandidates].sort(
        (left, right) => left.peakMs - right.peakMs || left.id.localeCompare(right.id),
      );
      candidatesRef.current = nextCandidates;
      setCandidates(nextCandidates);
      setSelectionResult((current) =>
        current === null
          ? current
          : { ...current, candidateCount: nextCandidates.length },
      );
      resetCandidateRanking(nextCandidates);
      semanticRefinementRouteChangeCountRef.current = 0;
      setSemanticLeadRefinementStatus("completed");
    };

    if (plan.selectedLeadIds.length === 0) {
      setActiveRefinementEvidenceProjection(null);
      applySemanticCandidates([]);
      semanticLeadRefinementAbortController.current = null;
      return;
    }

    void (async () => {
      if (controller.signal.aborted || !isMounted.current) return;
      const sessionLoadOperationToken =
        `${currentAnalysisRunId}:semantic:${semanticInputSignature}:session-load`;
      const initialSavedSession = await runSessionCheckpoint(
        "session-load",
        sessionLoadOperationToken,
        (isCurrent) =>
          loadDurableBroadcastContextSession({
            store,
            identity: {
              runId: currentAnalysisRunId,
              operationToken: sessionLoadOperationToken,
              inputSignature: semanticInputSignature,
            },
            isCurrent,
            signal: controller.signal,
          }),
      );
      let savedSession = initialSavedSession;
      const savedParticipantPreContext =
        await restoreBroadcastParticipantPreContextCheckpoint(savedSession);
      if (
        savedParticipantPreContext === null ||
        JSON.stringify(savedParticipantPreContext) !==
          JSON.stringify(broadcastParticipantPreContext) ||
        savedSession.sourceDurationMs !== boundarySourceDurationMs ||
        savedSession.sourceCastRosterId !== sourceCastRosterId ||
        savedSession.participantGroundingPlanFingerprint !==
          broadcastParticipantPreContext.planFingerprint ||
        JSON.stringify(compactBroadcastContextChapters(savedSession.chapters)) !==
          JSON.stringify(boundedBroadcastContextChapters) ||
        savedSession.contextInputCheckpointJson === null ||
        savedSession.contextResultJson === null
      ) {
        throw new Error(
          "저장된 대사·등장인물·방송 맥락이 현재 정제 대상과 일치하지 않아 AI 정제를 시작하지 않았어요.",
        );
      }
      let savedContextInputPayload: unknown;
      let savedContextResultPayload: unknown;
      try {
        savedContextInputPayload = JSON.parse(
          savedSession.contextInputCheckpointJson,
        );
        savedContextResultPayload = JSON.parse(savedSession.contextResultJson);
      } catch {
        throw new Error(
          "저장된 방송 맥락 입력과 결과 형식을 확인하지 못해 AI 정제를 시작하지 않았어요.",
        );
      }
      const savedContextInput = createBroadcastContextRequest(
        savedContextInputPayload as BroadcastContextRequestInput,
      );
      if (analysisLanguage !== savedContextInput.outputLanguage) {
        setAnalysisLanguage(savedContextInput.outputLanguage);
      }
      const savedContextEnvelope = unpackPersistedBroadcastContext(
        savedContextResultPayload,
      );
      if (savedContextEnvelope === null) {
        throw new Error(
          "The saved broadcast context envelope is not the current exact schema.",
        );
      }
      const savedContextResult = parsePersistedBroadcastContextResult(
        savedContextEnvelope.resultPayload,
        {
          sourceDurationMs: savedContextInput.sourceDurationMs,
          chapters: savedContextInput.chapters,
          candidates: savedContextInput.candidates,
          participantGrounding: savedContextInput.participantGrounding,
          outputLanguage: savedContextInput.outputLanguage,
          castRosterId: savedContextInput.castRosterId,
        },
      );
      if (
        savedContextResult === null ||
        JSON.stringify(savedContextResult) !== JSON.stringify(broadcastContextResult) ||
        JSON.stringify(savedContextEnvelope.refinementLeadIds) !==
          JSON.stringify(broadcastContextRefinementLeadIds) ||
        JSON.stringify(savedContextEnvelope.fastRefinementLeadIds) !==
          JSON.stringify(broadcastContextFastRefinementLeadIds)
      ) {
        throw new Error(
          "저장된 방송 흐름과 현재 후보 정제 계획이 일치하지 않아 AI 정제를 시작하지 않았어요.",
        );
      }
      /*
       * 자막이 없을 때만 도는 원격 전사. **이것이 실제 병목이다** — 음식 토크도
       * 현재 최대 90초 R2 transport의 표본 수만큼 요청이 되고, 배포 전체 1초 gate와
       * 공급자 응답 시간이 실제 하한을 결정한다.
       *
       * 그런데 지금까지의 실측은 이 경로를 한 번도 타지 않았다. 시험한 파일이
       * 전부 파일명에 `[videoId]` 를 달고 있어 자막으로 끝났기 때문이다. 재지
       * 않은 구간이 가장 무거웠다.
       */
      const transcriptionStartedAtMs = Date.now();
      const evidenceBinding = {
        sourceFingerprint: savedSession.inputSignature,
        sourceDurationMs: boundarySourceDurationMs,
        selectedLeadPlan: plan,
      } as const;
      let refinementEvidenceLedger: BroadcastRefinementEvidenceLedger =
        (await parseBroadcastContextSessionRefinementEvidenceLedger(
          savedSession,
        )) ??
        (await createBroadcastRefinementEvidenceLedger(evidenceBinding));
      if (
        refinementEvidenceLedger.sourceFingerprint !==
          evidenceBinding.sourceFingerprint ||
        refinementEvidenceLedger.sourceDurationMs !==
          evidenceBinding.sourceDurationMs ||
        JSON.stringify(refinementEvidenceLedger.selectedLeadPlan) !==
          JSON.stringify(plan)
      ) {
        throw new Error(
          "저장된 후보 근거 원장이 현재 방송과 후보 구간 계획에 맞지 않아요.",
        );
      }
      const persistRefinementEvidenceLedger = async (
        nextLedger: BroadcastRefinementEvidenceLedger,
      ): Promise<BroadcastRefinementEvidenceLedger> => {
        const ledgerJson =
          await serializeBroadcastRefinementEvidenceLedger(nextLedger);
        if (savedSession.refinementEvidenceLedgerJson !== ledgerJson) {
          const expectedSession = savedSession;
          const previousLedgerJson =
            expectedSession.refinementEvidenceLedgerJson;
          const recordedAt = new Date().toISOString();
          const operationToken =
            `${currentAnalysisRunId}:semantic-evidence:${nextLedger.ledgerFingerprint}`;
          savedSession = await runSessionCheckpoint(
            "evidence-ledger",
            operationToken,
            (isCurrent) =>
              transformDurableBroadcastContextSession({
                store,
                identity: {
                  runId: currentAnalysisRunId,
                  operationToken,
                  inputSignature: semanticInputSignature,
                },
                expected: expectedSession,
                isCurrent,
                signal: controller.signal,
                transform: async (current) => {
                  if (
                    current.contextInputSignature !==
                      expectedSession.contextInputSignature ||
                    current.contextInputCheckpointJson !==
                      expectedSession.contextInputCheckpointJson ||
                    current.contextResultJson !==
                      expectedSession.contextResultJson ||
                    current.transcriptSealOperationKey !==
                      expectedSession.transcriptSealOperationKey ||
                    current.participantGroundingInputSignature !==
                      expectedSession.participantGroundingInputSignature
                  ) {
                    throw new Error(
                      "The refinement evidence parent changed.",
                    );
                  }
                  if (current.refinementEvidenceLedgerJson === ledgerJson) {
                    return current;
                  }
                  if (
                    current.refinementEvidenceLedgerJson !==
                    previousLedgerJson
                  ) {
                    throw new Error(
                      "A newer refinement evidence ledger is already stored.",
                    );
                  }
                  return checkpointBroadcastContextSessionRefinementEvidenceLedger(
                    current,
                    {
                      refinementEvidenceLedgerJson: ledgerJson,
                      recordedAt,
                    },
                  );
                },
              }),
          );
        }
        const readback =
          await parseBroadcastContextSessionRefinementEvidenceLedger(
            savedSession,
          );
        if (
          readback === null ||
          readback.ledgerFingerprint !== nextLedger.ledgerFingerprint
        ) {
          throw new Error(
            "후보 근거 원장을 저장한 뒤 같은 내용을 다시 확인하지 못했어요.",
          );
        }
        refinementEvidenceLedger = readback;
        return readback;
      };

      let captionRouteActivated = false;
      if (youtubeCaptionTrack !== null) {
        const captionEntry =
          await appendBroadcastRefinementEvidenceRouteEntry(
            refinementEvidenceLedger,
            refinementEvidenceLedger.ledgerFingerprint,
            {
              ...evidenceBinding,
              routeKind: "youtube-caption",
              captionRevision: YOUTUBE_CAPTION_MODEL_REVISION,
              captionTrack: youtubeCaptionTrack,
              verifiedNoSpeechEvidence: [],
            },
          );
        refinementEvidenceLedger =
          await persistRefinementEvidenceLedger(captionEntry.ledger);
        const appendedCaption = refinementEvidenceLedger.routeEntries.find(
          ({ entryFingerprint }) =>
            entryFingerprint === captionEntry.routeEntryFingerprint,
        );
        if (appendedCaption?.settlement.publicationEligible === true) {
          refinementEvidenceLedger =
            await activateBroadcastRefinementEvidenceRoute(
              refinementEvidenceLedger,
              refinementEvidenceLedger.ledgerFingerprint,
              captionEntry.routeEntryFingerprint,
            );
          refinementEvidenceLedger =
            await persistRefinementEvidenceLedger(
              refinementEvidenceLedger,
            );
          captionRouteActivated = true;
        }
      }

      const canReuseActiveEvidence =
        youtubeCaptionTrack === null &&
        broadcastRefinementEvidenceLedgerCanPublish(
          refinementEvidenceLedger,
        );
      if (!captionRouteActivated && !canReuseActiveEvidence) {
        const refinementTranscriptRoute =
          await requestBroadcastTranscriptRouteSelection(
            BROADCAST_TRANSCRIPT_PROXY_ENDPOINT,
            { signal: controller.signal },
          );
        const refinementTranscriptInputSignature =
          await createContentFingerprint([
            "exclipper.semantic-refinement-transcript-evidence.v4",
            currentAnalysisRunId,
            evidenceBinding.sourceFingerprint,
            JSON.stringify(plan),
            JSON.stringify(chunks),
            BROADCAST_TRANSCRIPT_WORKER_VERSION,
            BROADCAST_SPEECH_ACTIVITY_MODEL_REVISION,
            BROADCAST_SPEECH_ACTIVITY_POLICY_REVISION,
          ]);
        const refinementTranscriptOperationScope = (
          await createContentFingerprint([
            "exclipper.semantic-refinement-transcript-quota-scope.v1",
            refinementTranscriptInputSignature,
            refinementTranscriptRoute.fingerprint,
          ])
        )
          .replace(/[^A-Za-z0-9_-]/gu, "_")
          .slice(-24);
        const refinementRecovery =
          await runDurableBroadcastRefinementTranscriptPipeline({
            store,
            initialSession: savedSession,
            runId: currentAnalysisRunId,
            refinementTranscriptInputSignature,
            chunks,
            editorRetryGeneration: semanticLeadRefinementAttemptOrdinal,
            allowOutcomeUnknownRetry,
            signal: controller.signal,
            runAttempt: (
              attemptChunks,
              quotaAttemptOrdinal,
              _attemptIndex,
              persistence,
            ) =>
              runBroadcastTranscriptWorker(sourceFile, {
                sourceDurationMs: boundarySourceDurationMs,
                chunks: attemptChunks,
                route: refinementTranscriptRoute,
                quota: {
                  participantId: aiQuotaParticipantId,
                  runId: currentAnalysisRunId,
                  operationNamespace: "refinement",
                  operationScope: refinementTranscriptOperationScope,
                  attemptOrdinal: quotaAttemptOrdinal,
                },
                signal: controller.signal,
                onDispatchIntent: persistence.onDispatchIntent,
                onPartialResult: persistence.onPartialResult,
                onChunkAbstention: persistence.onChunkAbstention,
                onChunkGap: persistence.onChunkGap,
              }),
          });
        savedSession = refinementRecovery.session;
        if (!refinementRecovery.complete) {
          const routeChangedCount =
            refinementRecovery.blockingGaps.filter(
              ({ reason }) => reason === "route-changed",
            ).length;
          if (
            routeChangedCount > 0 &&
            routeChangedCount === refinementRecovery.blockingGaps.length
          ) {
            const consecutiveRouteChanges =
              semanticRefinementRouteChangeCountRef.current + 1;
            semanticRefinementRouteChangeCountRef.current =
              consecutiveRouteChanges;
            await waitForTranscriptRouteRecoveryDelay(
              consecutiveRouteChanges,
              controller.signal,
            );
            if (controller.signal.aborted || !isMounted.current) return;
            autoSemanticLeadRefinementSourceRef.current = null;
            setSemanticLeadRefinementAttemptOrdinal(
              (current) => current + 1,
            );
            setSemanticLeadRefinementStatus("idle");
            setSemanticLeadRefinementError(null);
            return;
          }
          semanticRefinementRouteChangeCountRef.current = 0;
          const retryableCount = refinementRecovery.blockingGaps.filter(
            ({ reason }) =>
              reason !== "in-flight" && reason !== "outcome-unknown",
          ).length;
          const outcomeUnknownCount =
            refinementRecovery.blockingGaps.length - retryableCount;
          throw new Error(
            "후보 구간의 대사 조각을 모두 복구한 뒤에만 AI 세부 해석을 시작해요. " +
            `재시도 필요 ${retryableCount}개, 요청 결과 확인 필요 ${outcomeUnknownCount}개가 남았습니다.`,
          );
        }
        semanticRefinementRouteChangeCountRef.current = 0;
        let providerReceiptCheckpoint =
          createBroadcastTranscriptProviderReceiptCheckpoint({
            sourceFingerprint: evidenceBinding.sourceFingerprint,
            sourceDurationMs: evidenceBinding.sourceDurationMs,
            route: refinementTranscriptRoute,
            plannedCells: chunks,
          });
        for (const fragment of refinementRecovery.fragments) {
          providerReceiptCheckpoint =
            recordBroadcastTranscriptProviderReceipt(
              providerReceiptCheckpoint,
              fragment.chunkId,
              fragment.result,
            );
        }
        const asrEntry = await appendBroadcastRefinementEvidenceRouteEntry(
          refinementEvidenceLedger,
          refinementEvidenceLedger.ledgerFingerprint,
          {
            ...evidenceBinding,
            routeKind: "asr",
            billingClass:
              refinementTranscriptRoute.manifest.transportMode ===
              "paid-direct"
                ? "paid"
                : "free",
            refinementCheckpoint: refinementRecovery.checkpoint,
            providerReceiptCheckpoint,
          },
        );
        refinementEvidenceLedger =
          await persistRefinementEvidenceLedger(asrEntry.ledger);
        const appendedAsr = refinementEvidenceLedger.routeEntries.find(
          ({ entryFingerprint }) =>
            entryFingerprint === asrEntry.routeEntryFingerprint,
        );
        if (appendedAsr?.settlement.publicationEligible !== true) {
          throw new Error(
            "복구된 후보 대사 근거가 모든 계획 구간을 충족하지 못했어요.",
          );
        }
        refinementEvidenceLedger =
          await activateBroadcastRefinementEvidenceRoute(
            refinementEvidenceLedger,
            refinementEvidenceLedger.ledgerFingerprint,
            asrEntry.routeEntryFingerprint,
          );
        refinementEvidenceLedger =
          await persistRefinementEvidenceLedger(
            refinementEvidenceLedger,
          );
      }
      const activeRefinementProjection =
        projectBroadcastRefinementActiveEvidenceRoute(
          refinementEvidenceLedger,
        );
      const activeRefinementEvidence =
        getBroadcastRefinementActiveEvidencePayload(
          refinementEvidenceLedger,
        );
      if (
        activeRefinementProjection === null ||
        !activeRefinementProjection.publicationEligible ||
        activeRefinementEvidence === null ||
        !broadcastRefinementEvidenceLedgerCanPublish(
          refinementEvidenceLedger,
        )
      ) {
        throw new Error(
          "후보별 AI 해석에 사용할 완전한 활성 대사 근거를 준비하지 못했어요.",
        );
      }
      const refinementTranscripts =
        activeRefinementEvidenceTranscripts(activeRefinementEvidence);
      // 자막 경로면 몇 밀리초, 원격 전사면 수십 분이다. 같은 이름으로 재서
      // 표에 나란히 놓으면 그 격차가 그대로 보인다.
      stageTimerRef.current?.addSpan(
        activeRefinementProjection.routeKind === "youtube-caption"
          ? "refinement-from-caption"
          : "refinement-transcription(no-caption)",
        Date.now() - transcriptionStartedAtMs,
      );
      if (controller.signal.aborted || !isMounted.current) return;
      const refinementLeadInputs: readonly DurableBroadcastRefinementLeadInput[] =
        createSemanticRefinementLeadInputs({
          plan,
          transcripts: refinementTranscripts,
          discoveredLeads: savedContextResult.discoveredLeads,
          fastRefinementLeadIds:
            savedContextEnvelope.fastRefinementLeadIds,
          sourceDurationMs: savedContextInput.sourceDurationMs,
          castRosterId: savedContextInput.castRosterId,
          wholeBroadcastChapters: savedContextInput.chapters,
          participantGrounding:
            savedContextInput.participantGrounding,
          outputLanguage: savedContextInput.outputLanguage,
        });
      const refinementRoutingManifestSignature =
        `broadcast-context-routing:${AI_BROADCAST_CONTEXT_ROUTING_REVISION}`;
      const refinementAiInputSignature =
        await createSemanticRefinementAiInputSignature({
          activeEvidenceProjectionFingerprint:
            activeRefinementProjection.projectionFingerprint,
          routingManifestSignature:
            refinementRoutingManifestSignature,
          leadInputs: refinementLeadInputs,
        });
      setActiveRefinementEvidenceProjection(
        activeRefinementProjection,
      );
      if (controller.signal.aborted || !isMounted.current) return;
      if (
        savedSession.contextInputSignature === null ||
        savedSession.contextInputCheckpointJson === null ||
        savedSession.contextPhaseLedgerJson === null ||
        savedSession.contextResultJson === null ||
        savedSession.transcriptSealOperationKey === null ||
        savedSession.participantGroundingInputSignature === null ||
        savedSession.participantGroundingPlanFingerprint === null
      ) {
        throw new Error(
          "후보별 AI 해석에 필요한 방송 맥락 원장과 입력 서명이 준비되지 않았어요.",
        );
      }
      const refinementFence: BroadcastContextPhaseLedgerFence = {
        parentContextSignature: savedSession.contextInputSignature,
        transcriptSignature: savedSession.transcriptSealOperationKey,
        groundingSignature: savedSession.participantGroundingInputSignature,
      };
      let activeRefinementLedger =
        parseBroadcastContextPhaseLedgerJson(
          savedSession.contextPhaseLedgerJson,
        );
      if (
        activeRefinementLedger === null ||
        !broadcastContextPhaseLedgerMatchesFence(
          activeRefinementLedger,
          refinementFence,
        )
      ) {
        throw new Error(
          "저장된 후보별 AI 해석 원장이 현재 방송 맥락과 일치하지 않아요.",
        );
      }
      let activeRefinementSession = savedSession;
      const persistRefinementLedgerAndReadBack = async (
        ledgerJson: string,
        settleAfterDispatch = false,
      ): Promise<void> => {
        const expectedSession = activeRefinementSession;
        const previousLedgerJson = expectedSession.contextPhaseLedgerJson;
        const recordedAt = new Date().toISOString();
        const ledgerFingerprint = await createContentFingerprint([
          "exclipper.semantic-refinement-phase-ledger.v1",
          ledgerJson,
        ]);
        const operationToken =
          `${currentAnalysisRunId}:semantic-phase:${ledgerFingerprint}`;
        activeRefinementSession = await runSessionCheckpoint(
          "phase-ledger",
          operationToken,
          (isCurrent) =>
            transformDurableBroadcastContextSession({
              store,
              identity: {
                runId: currentAnalysisRunId,
                operationToken,
                inputSignature: semanticInputSignature,
              },
              expected: expectedSession,
              isCurrent,
              ...(settleAfterDispatch
                ? {}
                : { signal: controller.signal }),
              transform: (current) => {
                if (
                  current.contextInputSignature !==
                    expectedSession.contextInputSignature ||
                  current.contextInputCheckpointJson !==
                    expectedSession.contextInputCheckpointJson ||
                  current.contextResultJson !==
                    expectedSession.contextResultJson ||
                  current.refinementTranscriptInputSignature !==
                    expectedSession.refinementTranscriptInputSignature ||
                  current.refinementTranscriptCheckpointJson !==
                    expectedSession.refinementTranscriptCheckpointJson ||
                  current.refinementEvidenceLedgerJson !==
                    expectedSession.refinementEvidenceLedgerJson
                ) {
                  throw new Error(
                    "The semantic refinement parent changed.",
                  );
                }
                if (current.contextPhaseLedgerJson === ledgerJson) {
                  return current;
                }
                if (current.contextPhaseLedgerJson !== previousLedgerJson) {
                  throw new Error(
                    "A newer semantic refinement ledger is already stored.",
                  );
                }
                return checkpointBroadcastContextSessionPhaseLedger(
                  current,
                  {
                    contextInputSignature:
                      expectedSession.contextInputSignature as string,
                    contextInputCheckpointJson:
                      expectedSession.contextInputCheckpointJson as string,
                    contextPhaseLedgerJson: ledgerJson,
                    recordedAt,
                  },
                );
              },
            }),
          settleAfterDispatch,
        );
      };
      if (
        allowOutcomeUnknownRetry &&
        activeRefinementLedger.units.some(
          (unit) =>
            unit.phase === "refinement" && unit.status !== "succeeded",
        )
      ) {
        const replanned = replanBroadcastContextPhaseLedgerAfterEditorRetry(
          activeRefinementLedger,
          {
            confirmationId:
              `editor-refinement-retry-${semanticLeadRefinementAttemptOrdinal}`,
            nextOperationId: (unit) =>
              `${unit.operationId}-editor-${semanticLeadRefinementAttemptOrdinal}`,
          },
        );
        const replannedJson =
          serializeBroadcastContextPhaseLedger(replanned);
        if (
          replannedJson !==
          serializeBroadcastContextPhaseLedger(activeRefinementLedger)
        ) {
          await persistRefinementLedgerAndReadBack(replannedJson);
          activeRefinementLedger = replanned;
        }
      }
      const durableRefinement =
        await runDurableBroadcastRefinementPipeline({
          ledger: activeRefinementLedger,
          fence: refinementFence,
          leads: refinementLeadInputs,
          quotaParticipantId: aiQuotaParticipantId,
          runId: currentAnalysisRunId,
          evidenceManifestSignature:
            activeRefinementProjection.projectionFingerprint,
          routingManifestSignature:
            refinementRoutingManifestSignature,
          operationGeneration: semanticLeadRefinementAttemptOrdinal,
          retryMode: "automatic-free-tier",
          signal: controller.signal,
          maximumConcurrency: MAX_TOPICAL_REFINEMENT_CONCURRENCY,
          persistAndReadBack: async ({
            ledger,
            ledgerJson,
            transition,
          }) => {
            const settleAfterDispatch =
              transition !== null &&
              (transition.resultingStatus === "succeeded" ||
                transition.resultingStatus === "retryable-gap" ||
                transition.resultingStatus === "outcome-unknown" ||
                transition.resultingStatus === "failed");
            await persistRefinementLedgerAndReadBack(
              ledgerJson,
              settleAfterDispatch,
            );
            activeRefinementLedger = ledger;
          },
        });
      savedSession = activeRefinementSession;
      if (controller.signal.aborted || !isMounted.current) return;
      const refinementResults = durableRefinement.refinements.map(
        ({ leadId, discoveredLeads }) => ({
          leadId,
          leads: discoveredLeads,
        }),
      );

      const proposals: UnifiedHighlightCandidate[] = [];
      for (const refinement of refinementResults) {
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
              refinement.leadId,
            ),
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
      const refinementCandidatesJson = serializeSemanticLeadCandidates(
        semanticCandidates,
      );
      if (controller.signal.aborted || !isMounted.current) return;
      const refinementCommitOperationToken =
        `${currentAnalysisRunId}:semantic-candidates:${refinementAiInputSignature}`;
      const refinementRecordedAt = new Date().toISOString();
      const reopened = await runSessionCheckpoint(
        "semantic-candidates",
        refinementCommitOperationToken,
        (isCurrent) =>
          transformDurableBroadcastContextSession({
            store,
            identity: {
              runId: currentAnalysisRunId,
              operationToken: refinementCommitOperationToken,
              inputSignature: semanticInputSignature,
            },
            expected: savedSession,
            isCurrent,
            signal: controller.signal,
            transform: (current) => {
              if (
                current.contextInputSignature !==
                  savedSession.contextInputSignature ||
                current.contextInputCheckpointJson !==
                  savedSession.contextInputCheckpointJson ||
                current.contextPhaseLedgerJson !==
                  savedSession.contextPhaseLedgerJson ||
                current.contextResultJson !==
                  savedSession.contextResultJson ||
                current.refinementTranscriptInputSignature !==
                  savedSession.refinementTranscriptInputSignature ||
                current.refinementTranscriptCheckpointJson !==
                  savedSession.refinementTranscriptCheckpointJson ||
                current.refinementEvidenceLedgerJson !==
                  savedSession.refinementEvidenceLedgerJson
              ) {
                throw new Error(
                  "The semantic candidate parent changed.",
                );
              }
              if (
                current.refinementInputSignature ===
                  refinementAiInputSignature &&
                current.refinementCandidatesJson ===
                  refinementCandidatesJson
              ) {
                return current;
              }
              if (
                current.refinementInputSignature !==
                  savedSession.refinementInputSignature ||
                current.refinementCandidatesJson !==
                  savedSession.refinementCandidatesJson
              ) {
                throw new Error(
                  "A newer semantic candidate projection is already stored.",
                );
              }
              return {
                ...current,
                refinementInputSignature: refinementAiInputSignature,
                refinementCandidatesJson,
                recordedAt: refinementRecordedAt,
              };
            },
          }),
      );
      if (
        reopened.refinementInputSignature !== refinementAiInputSignature ||
        reopened.refinementCandidatesJson !== refinementCandidatesJson ||
        reopened.contextPhaseLedgerJson !==
          savedSession.contextPhaseLedgerJson ||
        reopened.refinementTranscriptInputSignature !==
          savedSession.refinementTranscriptInputSignature ||
        reopened.refinementTranscriptCheckpointJson !==
          savedSession.refinementTranscriptCheckpointJson ||
        reopened.refinementEvidenceLedgerJson !==
          savedSession.refinementEvidenceLedgerJson
      ) {
        throw new Error("저장한 새 의미 후보 위치를 다시 확인하지 못했어요.");
      }
      if (
        controller.signal.aborted ||
        !isMounted.current ||
        semanticLeadRefinementAbortController.current !== controller ||
        autoSemanticLeadRefinementSourceRef.current !== operationKey
      ) {
        return;
      }
      applySemanticCandidates(semanticCandidates);
    })()
      .catch(async (error: unknown) => {
        if (controller.signal.aborted || !isMounted.current) return;
        try {
          const checkpoint =
            await store.getBroadcastContextSession(currentAnalysisRunId);
          const checkpointLedger =
            checkpoint?.inputSignature === semanticInputSignature &&
            checkpoint.contextPhaseLedgerJson !== null
              ? parseBroadcastContextPhaseLedgerJson(
                  checkpoint.contextPhaseLedgerJson,
                )
              : null;
          const retryDelayMs =
            checkpointLedger === null
              ? null
              : automaticContextRetryDelayMs(checkpointLedger);
          if (retryDelayMs !== null && operationIsCurrent()) {
            setSemanticLeadRefinementStatus("running");
            setSemanticLeadRefinementError(
              analysisLanguage === "ko"
                ? "일시적인 AI 응답 오류가 있어 저장된 의미 분석 조각부터 자동으로 이어갑니다."
                : "A transient AI response failed. Resuming semantic analysis from its durable fragments.",
            );
            try {
              await waitForSessionRetry(retryDelayMs);
            } catch {
              return;
            }
            if (operationIsCurrent()) {
              autoSemanticLeadRefinementSourceRef.current = null;
              setSemanticLeadRefinementAttemptOrdinal(
                (current) => current + 1,
              );
            }
            return;
          }
        } catch (recoveryError) {
          console.warn(
            "Semantic refinement automatic recovery inspection failed.",
            recoveryError,
          );
        }
        semanticRefinementRouteChangeCountRef.current = 0;
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
    return () => {
      if (semanticLeadRefinementAbortController.current === controller) {
        controller.abort();
        semanticLeadRefinementAbortController.current = null;
        if (autoSemanticLeadRefinementSourceRef.current === operationKey) {
          autoSemanticLeadRefinementSourceRef.current = null;
        }
      }
    };
  }, [
    aiQuotaParticipantId,
    boundarySourceDurationMs,
    boundedBroadcastContextChapters,
    broadcastContextAttemptOrdinal,
    broadcastContextRefinementLeadIds,
    broadcastContextFastRefinementLeadIds,
    broadcastParticipantGrounding,
    broadcastContextResult,
    broadcastContextStatus,
    broadcastParticipantPreContext,
    currentAnalysisInputSignature,
    currentAnalysisRunId,
    getResultStore,
    resetCandidateRanking,
    semanticRefinementPlan,
    semanticLeadRefinementAttemptOrdinal,
    sourceCastRosterId,
    sourceContentFingerprint,
    sourceFile,
    youtubeCaptionTrack,
    youtubeCaptionTrackExactJson,
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
      !sourceChannelResolutionIsCurrent ||
      broadcastContextSamplingPlan === null ||
      broadcastContextSamplingPlan.transcriptMode !== "adaptive-qwen-asr"
    ) {
      return;
    }

    const transcriptPhase = transcriptPhaseFor(analysisComplete);
    /*
     * This is a local React re-entry fence, not a provider/quota identifier.
     * The descriptive source identity can legitimately exceed the bounded
     * operation-ID contract (roster + ASR + worker + VAD revisions already sit
     * near 160 characters), so do not pass it through transcriptOperationKey.
     * Provider-facing identities below use a SHA-256 fence instead.
     */
    const transcriptEffectKey =
      `${transcriptOperationKey(
        runId,
        sourceContentFingerprint,
        transcriptPhase,
        broadcastTranscriptAttemptOrdinal,
      )}:effect-${transcriptSourceIdentityFence}`;
    if (autoBroadcastTranscriptSourceRef.current === transcriptEffectKey) {
      return;
    }
    autoBroadcastTranscriptSourceRef.current = transcriptEffectKey;
    broadcastVisualInspectionAbortController.current?.abort();
    broadcastVisualInspectionAbortController.current = null;
    autoBroadcastVisualInspectionSourceRef.current = null;
    setBroadcastVisualInspectionProjection(null);
    setBroadcastVisualInspectionStatus("idle");
    setBroadcastVisualInspectionPlannedCellCount(0);
    setBroadcastVisualInspectionPreparedCellCount(0);
    setBroadcastVisualInspectionSettledCellCount(0);
    setBroadcastVisualInspectionError(null);
    const sourceDurationMs = broadcastContextSamplingPlan.sourceDurationMs;
    const chunks = createBroadcastContextTranscriptionChunks(
      broadcastContextSamplingPlan.samplingWindows,
    );
    if (chunks.length === 0) {
      sealedBroadcastTranscriptSourceRef.current = null;
      setBroadcastTranscriptStatus("failed");
      setBroadcastTranscriptError(
        "방송 대사 계획을 만들지 못해 분석을 완료하지 않았어요.",
      );
      setBroadcastTranscriptExplorationCells([]);
      return;
    }

    broadcastTranscriptAbortController.current?.abort();
    const controller = new AbortController();
    broadcastTranscriptAbortController.current = controller;
    sealedBroadcastTranscriptSourceRef.current = null;
    setBroadcastTranscriptStatus("running");
    setBroadcastTranscriptProgress(null);
    setBroadcastTranscriptRecoveryProgress(null);
    setBroadcastTranscriptError(null);

    void (async () => {
      const store = getResultStore();
      const youtubeVideoId = analysisCaptionVideoId;
      const saved = await store.getBroadcastContextSession(runId);
      const matchedSaved =
        saved !== null &&
        saved.inputSignature === inputSignature &&
        saved.sourceDurationMs === sourceDurationMs &&
        saved.sourceCastRosterId === sourceCastRosterId
          ? saved
          : null;
      const matchedSavedTranscriptSealIsCurrent =
        matchedSaved?.transcriptSealOperationKey !== null &&
        matchedSaved?.transcriptSealOperationKey !== undefined
          ? await isCurrentTranscriptSealOperationKey({
              operationKey: matchedSaved.transcriptSealOperationKey,
              runId,
              contentFingerprint: sourceContentFingerprint,
              modelRevision: matchedSaved.modelRevision,
              sourceCastRosterId,
              phase: transcriptPhase,
            })
          : false;
      let transcriptSessionSnapshot = matchedSaved;
      const matchedSavedTranscriptChapters =
        matchedSaved === null
          ? []
          : partitionBroadcastContextSessionChapters(matchedSaved)
              .transcriptChapters;

      const persistTranscriptMap = async (
        chapters: readonly BroadcastContextChapterInput[],
        completeAudioCoverage: boolean,
        gapChunkIds: readonly string[],
        modelRevision: string,
        fragmentGaps: readonly StoredBroadcastTranscriptGap[] = [],
        transcriptSealOperationKey: string | null = null,
        transcriptEvidenceCheckpoint:
          BroadcastTranscriptResolvedEvidenceCheckpoint | null = null,
        transcriptProviderReceiptCheckpoint:
          BroadcastTranscriptProviderReceiptCheckpoint | null = null,
      ) => {
        if (
          transcriptEvidenceCheckpoint !== null &&
          transcriptEvidenceCheckpoint.modelRevision !== modelRevision
        ) {
          throw new Error(
            "대사 증거 원장의 모델 경계가 현재 전사 체크포인트와 일치하지 않아요.",
          );
        }
        const transcriptEvidenceInputSignature =
          transcriptEvidenceCheckpoint?.transcriptInputSignature ?? null;
        const transcriptEvidenceCheckpointJson =
          transcriptEvidenceCheckpoint === null
            ? null
            : serializeBroadcastTranscriptResolvedEvidenceCheckpoint(
                transcriptEvidenceCheckpoint,
              );
        const transcriptProviderReceiptInputSignature =
          transcriptProviderReceiptCheckpoint?.routeManifestFingerprint ?? null;
        const transcriptProviderReceiptCheckpointJson =
          transcriptProviderReceiptCheckpoint === null
            ? null
            : serializeBroadcastTranscriptProviderReceiptCheckpoint(
                transcriptProviderReceiptCheckpoint,
              );
        const record = {
          kind: "broadcastContextSession" as const,
          runId,
          schemaVersion: BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
          inputSignature,
          sourceDurationMs,
          completeAudioCoverage,
          chapters,
          gapChunkIds,
          fragmentGaps,
          transcriptEvidenceInputSignature,
          transcriptEvidenceCheckpointJson,
          transcriptProviderReceiptInputSignature,
          transcriptProviderReceiptCheckpointJson,
          transcriptVisualInspectionCheckpointJson: null,
          modelRevision,
          sourceCastRosterId,
          transcriptSealOperationKey,
          participantGroundingInputSignature: null,
          participantGroundingPlanFingerprint: null,
          participantGroundingCheckpointJson: null,
          contextInputSignature: null,
           contextInputCheckpointJson: null,
           contextPhaseLedgerJson: null,
           contextResultJson: null,
           refinementTranscriptInputSignature: null,
           refinementTranscriptCheckpointJson: null,
           refinementEvidenceLedgerJson: null,
           refinementInputSignature: null,
           refinementCandidatesJson: null,
          recordedAt: new Date().toISOString(),
        };
        const rebaseTranscriptReplacement = (
          current: BroadcastContextSessionRecord,
          pending: BroadcastContextSessionRecord,
        ): BroadcastContextSessionRecord | null =>
          mergeBroadcastTranscriptSessionCheckpoints(current, pending);
        let reopened;
        if (transcriptSessionSnapshot === null) {
          if (saved !== null) {
            throw new Error(
              "같은 분석 세션에 다른 원본의 대사 체크포인트가 있어 덮어쓰지 않았어요.",
            );
          }
          reopened = await commitDurableBroadcastTranscriptCheckpoint({
            store,
            expected: null,
            replacement: record,
            rebaseReplacement: rebaseTranscriptReplacement,
            signal: controller.signal,
          });
        } else {
          const pendingReplacement =
            checkpointBroadcastContextSessionTranscript(
            transcriptSessionSnapshot,
            {
                 completeAudioCoverage,
                 chapters,
                 gapChunkIds,
                fragmentGaps,
                transcriptEvidenceInputSignature,
                transcriptEvidenceCheckpointJson,
                transcriptProviderReceiptInputSignature,
                transcriptProviderReceiptCheckpointJson,
                modelRevision,
                 transcriptSealOperationKey,
                 recordedAt: record.recordedAt,
            },
          );
          const replacement = mergeBroadcastTranscriptSessionCheckpoints(
            transcriptSessionSnapshot,
            pendingReplacement,
          );
          if (replacement === null) {
            throw new Error(
              "The main transcript checkpoint no longer matches its frozen plan.",
            );
          }
          reopened = await commitDurableBroadcastTranscriptCheckpoint({
            store,
            expected: transcriptSessionSnapshot,
            replacement,
            rebaseReplacement: rebaseTranscriptReplacement,
            signal: controller.signal,
          });
          if (reopened === null) {
            throw new Error(
              "대사 지도를 저장하는 동안 다른 실행이 같은 세션을 갱신했어요.",
            );
          }
        }
        // The durable commit helper already completed exact readback.
        if (
          reopened === null ||
          reopened.inputSignature !== inputSignature ||
          reopened.sourceDurationMs !== sourceDurationMs ||
          reopened.sourceCastRosterId !== sourceCastRosterId ||
          !broadcastTranscriptSessionCheckpointIncludes(reopened, record)
        ) {
          throw new Error("저장한 방송 대사 지도를 다시 확인하지 못했어요.");
        }
        transcriptSessionSnapshot = reopened;
        return reopened;
      };

      const transcriptProviderPlanCells = chunks.map(
        ({ chunkId, sourceStartMs, sourceEndMs }) => ({
          chunkId,
          sourceStartMs,
          sourceEndMs,
        }),
      );
      const storedTranscriptProviderReceiptCheckpoint =
        matchedSaved?.transcriptProviderReceiptCheckpointJson === null ||
        matchedSaved?.transcriptProviderReceiptCheckpointJson === undefined
          ? null
          : parseBroadcastTranscriptProviderReceiptCheckpointJson(
              matchedSaved.transcriptProviderReceiptCheckpointJson,
            );
      const storedTranscriptEvidenceCheckpoint =
        matchedSaved?.transcriptEvidenceCheckpointJson === null ||
        matchedSaved?.transcriptEvidenceCheckpointJson === undefined
          ? null
          : parseBroadcastTranscriptResolvedEvidenceCheckpointJson(
              matchedSaved.transcriptEvidenceCheckpointJson,
            );
      const storedTranscriptEvidenceIdentityIsCurrent =
        storedTranscriptEvidenceCheckpoint !== null &&
        matchedSaved !== null
          ? await isCurrentTranscriptSealOperationKey({
              operationKey:
                storedTranscriptEvidenceCheckpoint.transcriptInputSignature,
              runId,
              contentFingerprint: sourceContentFingerprint,
              modelRevision: matchedSaved.modelRevision,
              sourceCastRosterId,
              phase: transcriptPhase,
            })
          : false;
      const storedTranscriptEvidenceMatchesSession =
        storedTranscriptEvidenceCheckpoint !== null &&
        matchedSaved !== null &&
        storedTranscriptEvidenceIdentityIsCurrent &&
        matchedSaved.transcriptEvidenceInputSignature ===
          storedTranscriptEvidenceCheckpoint.transcriptInputSignature &&
        storedTranscriptEvidenceCheckpoint.sourceFingerprint === inputSignature &&
        storedTranscriptEvidenceCheckpoint.sourceDurationMs === sourceDurationMs &&
        storedTranscriptEvidenceCheckpoint.modelRevision ===
          matchedSaved.modelRevision &&
        JSON.stringify(storedTranscriptEvidenceCheckpoint.plannedCells) ===
          JSON.stringify(transcriptProviderPlanCells);
      const storedTranscriptProviderReceiptMatchesSession =
        storedTranscriptProviderReceiptCheckpoint !== null &&
        matchedSaved !== null &&
        storedTranscriptEvidenceIdentityIsCurrent &&
        matchedSaved.transcriptProviderReceiptInputSignature ===
          storedTranscriptProviderReceiptCheckpoint.routeManifestFingerprint &&
        storedTranscriptProviderReceiptCheckpoint.sourceFingerprint ===
          inputSignature &&
        storedTranscriptProviderReceiptCheckpoint.sourceDurationMs ===
          sourceDurationMs &&
        broadcastTranscriptProviderReceiptCheckpointModelRevision(
          storedTranscriptProviderReceiptCheckpoint,
        ) === matchedSaved.modelRevision &&
        storedTranscriptProviderReceiptCheckpoint.captionReceipts.every(
          ({ receipt }) =>
            youtubeVideoId !== null && receipt.videoId === youtubeVideoId,
        ) &&
        JSON.stringify(storedTranscriptProviderReceiptCheckpoint.plannedCells) ===
          JSON.stringify(transcriptProviderPlanCells);
      let storedAsrPlanIsSettled = false;
      if (
        matchedSaved !== null &&
        storedTranscriptProviderReceiptMatchesSession &&
        (matchedSaved.transcriptEvidenceCheckpointJson === null ||
          storedTranscriptEvidenceMatchesSession)
      ) {
        try {
          const resolvedChunkIds = storedTranscriptEvidenceMatchesSession
            ? storedTranscriptEvidenceCheckpoint.resolvedEvidence.map(
                ({ chunkId }) => chunkId,
              )
            : [];
          const providerSettlement =
            inspectBroadcastTranscriptProviderReceiptSettlement({
              checkpoint: storedTranscriptProviderReceiptCheckpoint,
              chapterRanges: matchedSavedTranscriptChapters,
              resolvedChunkIds,
              gapChunkIds: matchedSaved.gapChunkIds,
            });
          const evidenceSettlement =
            storedTranscriptEvidenceMatchesSession
              ? inspectBroadcastTranscriptEvidenceSettlement({
                  checkpoint: storedTranscriptEvidenceCheckpoint,
                  chapterRanges: matchedSavedTranscriptChapters.map(
                    ({ startMs, endMs }) => ({
                      startMs,
                      endMs,
                    }),
                  ),
                  gapRanges: matchedSaved.fragmentGaps.map(
                    ({ chunkId, sourceStartMs, sourceEndMs }) => ({
                      chunkId,
                      sourceStartMs,
                      sourceEndMs,
                    }),
                  ),
                })
              : null;
          storedAsrPlanIsSettled =
            providerSettlement.isPlanSettled &&
            (evidenceSettlement === null || evidenceSettlement.isPlanSettled);
        } catch {
          // A malformed or cross-route checkpoint is retained for diagnosis,
          // but it can never reopen as a completed transcript.
          storedAsrPlanIsSettled = false;
        }
      }
      if (
        matchedSaved !== null &&
        matchedSaved.transcriptSealOperationKey !== null &&
        matchedSavedTranscriptSealIsCurrent &&
        matchedSaved.transcriptSealOperationKey ===
          storedTranscriptEvidenceCheckpoint?.transcriptInputSignature &&
        matchedSaved.gapChunkIds.length === 0 &&
        storedAsrPlanIsSettled
      ) {
        if (!controller.signal.aborted && isMounted.current) {
          setBroadcastTranscriptExplorationCells(
            createChapterExplorationCells(matchedSavedTranscriptChapters),
          );
          setBroadcastTranscriptChapters(matchedSaved.chapters);
          sealedBroadcastTranscriptSourceRef.current =
            matchedSaved.transcriptSealOperationKey;
          broadcastTranscriptRouteChangeCountRef.current = 0;
          setBroadcastTranscriptStatus("completed");
        }
        return;
      }

      /*
       * Captions are a free source for exact planned cells, not an alternate
       * completion route. They seed real chapter receipts below; every cell
       * without caption text continues through the same VAD/ASR recovery plan.
      */
      let captionTrackForTranscript: YouTubeCaptionTrackResult | null = null;
      const currentChannelPreanalysisConnection =
        channelPreanalysisConnectionRef.current;
      const timedCaptionsRejectedByCatalog =
        youtubeVideoId !== null &&
        currentChannelPreanalysisConnection.status === "connected" &&
        currentChannelPreanalysisConnection.lookup.match.match?.videoId ===
          youtubeVideoId &&
        currentChannelPreanalysisConnection.timelineStatus === "incompatible";
      if (youtubeVideoId !== null && !timedCaptionsRejectedByCatalog) {
        const currentCaptionTrack = youtubeCaptionTrackRef.current;
        if (currentCaptionTrack?.videoId === youtubeVideoId) {
          captionTrackForTranscript = currentCaptionTrack;
        } else {
          const catalogBinding = channelPreanalysisBundleBindingRef.current;
          if (
            catalogBinding !== null &&
            catalogBinding.sourceContentFingerprint === sourceContentFingerprint &&
            catalogBinding.bundle.videoId === youtubeVideoId &&
            Math.abs(catalogBinding.bundle.durationMs - sourceDurationMs) <=
              CHANNEL_PREANALYSIS_TITLE_DURATION_TOLERANCE_MS
          ) {
            captionTrackForTranscript = catalogBinding.bundle.captionTrack;
            youtubeCaptionTrackRef.current = catalogBinding.bundle.captionTrack;
            setYouTubeCaptionTrack(catalogBinding.bundle.captionTrack);
          }
        }
        if (captionTrackForTranscript === null) {
          try {
            const endCaptionSpan = stageTimerRef.current?.startSpan(
              "youtube-caption-fetch",
              Date.now(),
            );
            const captionTrack = await requestYouTubeCaptionTrack(youtubeVideoId, {
              signal: controller.signal,
            });
            endCaptionSpan?.(Date.now());
            if (controller.signal.aborted || !isMounted.current) return;
            youtubeCaptionTrackRef.current = captionTrack;
            setYouTubeCaptionTrack(captionTrack);
            captionTrackForTranscript = captionTrack;
          } catch {
            // YouTube may throttle or withhold captions. The bounded ASR route
            // below is the automatic fallback and needs no user action.
          }
        }
      }

      const transcriptRoute = await requestBroadcastTranscriptRouteSelection(
        BROADCAST_TRANSCRIPT_PROXY_ENDPOINT,
        { signal: controller.signal },
      );
      const routeSourceIdentityFence =
        await createCurrentProviderTranscriptSourceIdentityFence(
          sourceCastRosterId,
        );
      const matchingStoredTranscriptProviderReceiptCheckpoint =
        storedTranscriptProviderReceiptMatchesSession
          ? rebaseBroadcastTranscriptProviderReceiptCheckpointRoute(
              storedTranscriptProviderReceiptCheckpoint,
              transcriptRoute,
            )
          : null;
      const operationKey =
        matchingStoredTranscriptProviderReceiptCheckpoint !== null &&
        storedTranscriptEvidenceCheckpoint !== null &&
        storedTranscriptEvidenceMatchesSession
          ? storedTranscriptEvidenceCheckpoint.transcriptInputSignature
          : transcriptOperationKey(
              runId,
              sourceContentFingerprint,
              transcriptPhase,
              broadcastTranscriptAttemptOrdinal,
              routeSourceIdentityFence,
            );
      const transcriptQuotaOperationScope = (
        await createContentFingerprint([
          "exclipper.transcript-quota-operation-scope.v1",
          operationKey,
          transcriptRoute.fingerprint,
        ])
      )
        .replace(/[^A-Za-z0-9_-]/gu, "_")
        .slice(-24);
      if (controller.signal.aborted || !isMounted.current) return;

      const savedQwenCheckpoint =
        matchedSaved !== null &&
        matchingStoredTranscriptProviderReceiptCheckpoint !== null
          ? matchedSaved
          : null;
      /*
       * Only a paid direct request has a duplicate-billing ambiguity. The
       * free R2 route can safely reconcile the same cell under a fresh
       * generation without stopping the pipeline.
       */
      const allowPaidAmbiguousTranscriptRetry =
        allowAmbiguousTranscriptRetryRef.current;
      allowAmbiguousTranscriptRetryRef.current = false;
      const transcriptFragmentManualGeneration = Math.max(
        broadcastTranscriptAttemptOrdinal,
        nextTranscriptFragmentManualGeneration(
          savedQwenCheckpoint?.fragmentGaps.map(
            ({ attemptCount }) => attemptCount,
          ) ??
            matchedSaved?.fragmentGaps.map(
              ({ attemptCount }) => attemptCount,
            ) ??
            [],
        ),
      );
      let transcriptProviderReceiptCheckpoint =
        matchingStoredTranscriptProviderReceiptCheckpoint ??
        createBroadcastTranscriptProviderReceiptCheckpoint({
          sourceFingerprint: inputSignature,
          sourceDurationMs,
          route: transcriptRoute,
          plannedCells: transcriptProviderPlanCells,
        });
      const captionCellOutcomes =
        matchingStoredTranscriptProviderReceiptCheckpoint === null &&
        captionTrackForTranscript !== null
          ? createYouTubeCaptionTranscriptCellOutcomes(
              captionTrackForTranscript,
              transcriptProviderPlanCells,
              sourceDurationMs,
            )
          : [];
      if (captionTrackForTranscript !== null) {
        for (const outcome of captionCellOutcomes) {
          transcriptProviderReceiptCheckpoint =
            recordBroadcastTranscriptCaptionReceipt(
              transcriptProviderReceiptCheckpoint,
              outcome.chunkId,
              captionTrackForTranscript,
              outcome.chapter,
            );
        }
      }
      let recoveredCheckpointModelRevision =
        broadcastTranscriptProviderReceiptCheckpointModelRevision(
          transcriptProviderReceiptCheckpoint,
        );
      const preparedTranscriptEvidence =
        prepareBroadcastTranscriptEvidenceProjection({
          sourceFingerprint: inputSignature,
          sourceDurationMs,
          transcriptInputSignature: operationKey,
          modelRevision: recoveredCheckpointModelRevision,
          plannedChunks: chunks,
          storedCheckpointJson:
            savedQwenCheckpoint?.transcriptEvidenceCheckpointJson ?? null,
          storedChapters:
            savedQwenCheckpoint === null
              ? captionCellOutcomes.map(({ chapter }) => chapter)
              : matchedSavedTranscriptChapters,
        });
      let transcriptEvidenceCheckpoint =
        preparedTranscriptEvidence.checkpoint;
      const checkpointChapters =
        preparedTranscriptEvidence.dialogueChapters;
      const uncoveredSamplingWindows = subtractBroadcastContextCoveredRanges(
        broadcastContextSamplingPlan.samplingWindows,
        preparedTranscriptEvidence.coveredRanges,
      );
      const transcriptChunks = createBroadcastContextTranscriptionChunks(
        uncoveredSamplingWindows,
      );
      const runnableTranscriptChunks =
        selectRunnableBroadcastTranscriptChunks(
          transcriptChunks,
          matchedSaved?.fragmentGaps ?? [],
          {
            transportMode: transcriptRoute.manifest.transportMode,
            allowPaidAmbiguousRetry:
              allowPaidAmbiguousTranscriptRetry,
          },
        );
      if (checkpointChapters.length > 0 && !controller.signal.aborted) {
        setBroadcastTranscriptChapters(checkpointChapters);
      }
      if (transcriptChunks.length === 0) {
        const completeAudioCoverage =
          broadcastContextSamplingPlan.estimatedAudioCoverageRatio === 1;
        const completedChapters = mergeBroadcastTranscriptChapters(
          checkpointChapters,
          [],
          sourceDurationMs,
          completeAudioCoverage,
        );
        const reopened = await persistTranscriptMap(
          completedChapters,
          completeAudioCoverage,
          [],
          recoveredCheckpointModelRevision,
          [],
          operationKey,
          transcriptEvidenceCheckpoint,
          transcriptProviderReceiptCheckpoint,
        );
        setBroadcastTranscriptChapters(reopened.chapters);
        setBroadcastTranscriptExplorationCells(
          createTranscriptExplorationCells(
            createDistributedTranscriptExplorationOrder(chunks),
            "complete",
          ),
        );
        sealedBroadcastTranscriptSourceRef.current = operationKey;
        broadcastTranscriptRouteChangeCountRef.current = 0;
        setBroadcastTranscriptStatus("completed");
        setBroadcastTranscriptRecoveryProgress(null);
        return;
      }

      const explorationChunks = createDistributedTranscriptExplorationOrder(
        runnableTranscriptChunks,
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
      const checkpointGapState = new Map<
        string,
        {
          readonly reason: StoredBroadcastTranscriptGap["reason"];
          readonly attemptCount: number;
        }
      >();
      const uncoveredChunkIds = new Set(
        transcriptChunks.map(({ chunkId }) => chunkId),
      );
      for (const gap of matchedSaved?.fragmentGaps ?? []) {
        if (uncoveredChunkIds.has(gap.chunkId)) {
          checkpointGapState.set(gap.chunkId, {
            reason: gap.reason,
            attemptCount: gap.attemptCount,
          });
        }
      }
      let checkpointPersistence: Promise<void> = Promise.resolve();
      let checkpointPersistenceFailure: unknown = null;
      /*
       * **본 전사.** 화면의 `표본 n/N` 이 이것이고, 자막이 없을 때 방송 전체를
       * 현재 sampling plan의 최대 90초 청크로 잘라 원격 ASR 에 보내는 구간이다.
       * Free 모드는 raw WAV를 R2에 stream하고 Worker에는 작은 ticket만 남긴다.
       *
       * 앞서 계측을 붙였던 `runBroadcastTranscriptWorker` 호출은 이것이 아니라
       * **정련용 재전사**(선별된 리드만 다시 읽는 작은 호출)였다. 이름이 같아
       * 같은 일로 착각했고, 그래서 "전사 21.7초" 라는 값이 나왔다 — 실제로 몇십 분
       * 걸리는 쪽은 재지 않은 채였다. 같은 함수를 두 곳에서 부를 때는 어느 쪽을
       * 재는지 이름이 아니라 **무엇이 그 진행률을 그리는지**로 확인해야 한다.
      */
      const mainTranscriptionStartedAtMs = Date.now();
      const queueTranscriptCheckpoint = (): void => {
        const resultSnapshot = [...checkpointResults.values()];
        const providerReceiptCheckpointSnapshot =
          transcriptProviderReceiptCheckpoint;
        const checkpointModelRevision =
          broadcastTranscriptProviderReceiptCheckpointModelRevision(
            providerReceiptCheckpointSnapshot,
          );
        const evidenceCheckpointSnapshot =
          rebaseBroadcastTranscriptResolvedEvidenceModelRevision(
            transcriptEvidenceCheckpoint,
            checkpointModelRevision,
          );
        const resolvedChunkIds = new Set(
          evidenceCheckpointSnapshot.resolvedEvidence.map(
            ({ chunkId }) => chunkId,
          ),
        );
        const pendingFragmentGaps: readonly StoredBroadcastTranscriptGap[] =
          transcriptChunks
            .filter(
              (chunk) =>
                !checkpointResults.has(chunk.chunkId) &&
                !resolvedChunkIds.has(chunk.chunkId),
            )
            .map((chunk) => {
              const gapState = checkpointGapState.get(chunk.chunkId);
              return {
                chunkId: chunk.chunkId,
                sourceStartMs: chunk.sourceStartMs,
                sourceEndMs: chunk.sourceEndMs,
                reason: gapState?.reason ?? "pending",
                attemptCount: gapState?.attemptCount ?? 0,
              };
            });
        const pendingGapIds = pendingFragmentGaps.map(({ chunkId }) => chunkId);
        checkpointPersistence = checkpointPersistence.then(async () => {
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
            checkpointModelRevision,
            pendingFragmentGaps,
            null,
            evidenceCheckpointSnapshot,
            providerReceiptCheckpointSnapshot,
          );
          if (!controller.signal.aborted && isMounted.current) {
            setBroadcastTranscriptChapters(reopened.chapters);
          }
          checkpointPersistenceFailure = null;
        }).catch((error: unknown) => {
          checkpointPersistenceFailure = error;
        });
      };
      const awaitTranscriptCheckpointPersistence = async (): Promise<void> => {
        await checkpointPersistence;
        if (checkpointPersistenceFailure !== null) {
          throw checkpointPersistenceFailure instanceof Error
            ? checkpointPersistenceFailure
            : new Error("Transcript checkpoint persistence failed.", {
                cause: checkpointPersistenceFailure,
              });
        }
      };
      const persistPartialResult = async (
        chunkId: string,
        partialResult: BroadcastTranscriptVerifiedResult,
      ): Promise<void> => {
        updateExplorationCell(chunkId, "complete");
        checkpointResults.set(chunkId, partialResult);
        transcriptProviderReceiptCheckpoint =
          recordBroadcastTranscriptProviderReceipt(
            transcriptProviderReceiptCheckpoint,
            chunkId,
            partialResult,
          );
        recoveredCheckpointModelRevision =
          broadcastTranscriptProviderReceiptCheckpointModelRevision(
            transcriptProviderReceiptCheckpoint,
          );
        transcriptEvidenceCheckpoint =
          rebaseBroadcastTranscriptResolvedEvidenceModelRevision(
            transcriptEvidenceCheckpoint,
            recoveredCheckpointModelRevision,
          );
        checkpointGapState.delete(chunkId);
        queueTranscriptCheckpoint();
        await awaitTranscriptCheckpointPersistence();
      };
      const persistAbstentionOrGap = async (
        chunkId: string,
        reason:
          | StoredBroadcastTranscriptGap["reason"]
          | "no-audio"
          | "no-speech",
        quotaAttemptOrdinal: number,
        speechActivityReceipt: BroadcastSpeechActivityRunReceipt | null = null,
      ): Promise<void> => {
        updateExplorationCell(
          chunkId,
          reason === "no-audio" || reason === "no-speech"
            ? "complete"
            : "gap",
        );
        if (reason === "no-audio" || reason === "no-speech") {
          checkpointGapState.delete(chunkId);
          if (reason === "no-audio") {
            transcriptEvidenceCheckpoint =
              recordBroadcastTranscriptResolvedEvidence(
                transcriptEvidenceCheckpoint,
                chunkId,
                "no-audio",
                null,
              );
          } else {
            if (speechActivityReceipt === null) {
              throw new Error(
                "Confirmed no-speech evidence lost its VAD receipt.",
              );
            }
            transcriptEvidenceCheckpoint =
              recordBroadcastTranscriptResolvedEvidence(
                transcriptEvidenceCheckpoint,
                chunkId,
                "no-speech",
                speechActivityReceipt,
              );
          }
        } else {
          checkpointGapState.set(chunkId, {
            reason,
            attemptCount: quotaAttemptOrdinal + 1,
          });
        }
        queueTranscriptCheckpoint();
        await awaitTranscriptCheckpointPersistence();
      };
      const persistAttemptStart = async (
        intent: BroadcastTranscriptDispatchIntent,
        quotaAttemptOrdinal: number,
      ): Promise<void> => {
        const plannedChunk = explorationChunks.find(
          ({ chunkId }) => chunkId === intent.chunkId,
        );
        const expectedOperationId = transcriptFragmentQuotaOperationId(
          transcriptPhase,
          quotaAttemptOrdinal,
          intent.chunkId,
          transcriptQuotaOperationScope,
        );
        if (
          plannedChunk === undefined ||
          intent.sourceStartMs !== plannedChunk.sourceStartMs ||
          intent.sourceEndMs !== plannedChunk.sourceEndMs ||
          intent.attemptOrdinal !== quotaAttemptOrdinal ||
          intent.operationNamespace !== transcriptPhase ||
          intent.operationScope !== transcriptQuotaOperationScope ||
          intent.routeManifestFingerprint !== transcriptRoute.fingerprint ||
          intent.operationId !== expectedOperationId
        ) {
          throw new Error("Transcript dispatch attempt identity changed.");
        }
        checkpointGapState.set(intent.chunkId, {
          reason: "in-flight",
          attemptCount: quotaAttemptOrdinal + 1,
        });
        queueTranscriptCheckpoint();
        await awaitTranscriptCheckpointPersistence();
      };
      let recoveryResult: BroadcastTranscriptFragmentRecoveryResult;
      try {
        recoveryResult = await recoverBroadcastTranscriptFragments({
          chunks: explorationChunks,
          manualAttemptGeneration: transcriptFragmentManualGeneration,
          signal: controller.signal,
          onProgress: (progress) => {
            if (!controller.signal.aborted && isMounted.current) {
              setBroadcastTranscriptRecoveryProgress(progress);
            }
          },
          runAttempt: async (
            attemptChunks,
            quotaAttemptOrdinal,
          ) => {
            return runBroadcastTranscriptWorker(sourceFile, {
              sourceDurationMs,
              chunks: attemptChunks,
              route: transcriptRoute,
              quota: {
                participantId: aiQuotaParticipantId,
                runId,
                operationNamespace: transcriptPhase,
                operationScope: transcriptQuotaOperationScope,
                attemptOrdinal: quotaAttemptOrdinal,
              },
              signal: controller.signal,
              onDispatchIntent: (intent) =>
                persistAttemptStart(intent, quotaAttemptOrdinal),
              onProgress: (progress) => {
                if (!controller.signal.aborted && isMounted.current) {
                  setBroadcastTranscriptProgress(progress);
                  updateExplorationCell(
                    progress.chunkId,
                    "active",
                    progress.stage,
                  );
                }
              },
              onPartialResult: persistPartialResult,
              onChunkAbstention: (abstention) =>
                persistAbstentionOrGap(
                  abstention.chunkId,
                  abstention.reason,
                  quotaAttemptOrdinal,
                  abstention.speechActivityReceipt,
                ),
              onChunkGap: (chunkId, reason) =>
                persistAbstentionOrGap(
                  chunkId,
                  reason,
                  quotaAttemptOrdinal,
                ),
            });
          },
        });
      } finally {
        // A paid result is not considered recovered until its checkpoint write
        // and exact readback have both settled. Storage failure blocks the
        // phase instead of silently issuing the same provider request again.
        await awaitTranscriptCheckpointPersistence();
      }
      stageTimerRef.current?.addSpan(
        "main-transcription",
        Date.now() - mainTranscriptionStartedAtMs,
      );
      /*
       * 동시성이 어디서 멈췄는지를 실측 표에 남긴다. 진행 중의 "동시 N" 은 스쳐
       * 지나가므로 결론을 알 수 없고, 그것을 모르면 다음 값도 또 추측이 된다.
       */
      stageTimerRef.current?.note(
        `전사 ${recoveryResult.concurrencyOutcomes.join(" → ")}`,
      );
      if (controller.signal.aborted || !isMounted.current) {
        return;
      }
      const unresolvedFragmentGaps: readonly StoredBroadcastTranscriptGap[] =
        transcriptChunks
          .flatMap((chunk) => {
            const gap = checkpointGapState.get(chunk.chunkId);
            return gap === undefined
              ? []
              : [
                  {
                    chunkId: chunk.chunkId,
                    sourceStartMs: chunk.sourceStartMs,
                    sourceEndMs: chunk.sourceEndMs,
                    reason: gap.reason,
                    attemptCount: gap.attemptCount,
                  },
                ];
          })
          .sort(
            (left, right) =>
              left.sourceStartMs - right.sourceStartMs ||
              left.sourceEndMs - right.sourceEndMs,
          );
      const finalGapChunkIds = unresolvedFragmentGaps.map(
        ({ chunkId }) => chunkId,
      );
      const completeAudioCoverage =
        broadcastContextSamplingPlan.estimatedAudioCoverageRatio === 1 &&
        finalGapChunkIds.length === 0;
      const recoveredChapters = createBroadcastTranscriptChapters(
        recoveryResult.fragments.map(({ result }) => result),
        sourceDurationMs,
        completeAudioCoverage,
      );
      for (const { chunkId } of recoveryResult.resolvedAbstentions.filter(
        ({ reason }) => reason === "no-audio",
      )) {
        transcriptEvidenceCheckpoint =
          recordBroadcastTranscriptResolvedEvidence(
            transcriptEvidenceCheckpoint,
            chunkId,
            "no-audio",
            null,
          );
      }
      for (const {
        chunkId,
        speechActivityReceipt,
      } of recoveryResult.noSpeechAbstentions) {
        transcriptEvidenceCheckpoint =
          recordBroadcastTranscriptResolvedEvidence(
            transcriptEvidenceCheckpoint,
            chunkId,
            "no-speech",
            speechActivityReceipt,
          );
      }
      const chapters = mergeBroadcastTranscriptChapters(
        checkpointChapters,
        recoveredChapters,
        sourceDurationMs,
        completeAudioCoverage,
      );
      let reopened = await persistTranscriptMap(
        chapters,
        completeAudioCoverage,
        finalGapChunkIds,
        recoveredCheckpointModelRevision,
        unresolvedFragmentGaps,
        finalGapChunkIds.length === 0 ? operationKey : null,
        transcriptEvidenceCheckpoint,
        transcriptProviderReceiptCheckpoint,
      );
      if (
        reopened.fragmentGaps.length === 0 &&
        broadcastContextSamplingPlan.estimatedAudioCoverageRatio === 1 &&
        !reopened.completeAudioCoverage
      ) {
        const canonicalEvidence =
          reopened.transcriptEvidenceCheckpointJson === null
            ? null
            : parseBroadcastTranscriptResolvedEvidenceCheckpointJson(
                reopened.transcriptEvidenceCheckpointJson,
              );
        const canonicalProvider =
          reopened.transcriptProviderReceiptCheckpointJson === null
            ? null
            : parseBroadcastTranscriptProviderReceiptCheckpointJson(
                reopened.transcriptProviderReceiptCheckpointJson,
              );
        if (canonicalEvidence === null || canonicalProvider === null) {
          throw new Error(
            "The completed main transcript lost its durable evidence ledgers.",
          );
        }
        reopened = await persistTranscriptMap(
          partitionBroadcastContextSessionChapters(reopened)
            .transcriptChapters,
          true,
          [],
          reopened.modelRevision,
          [],
          canonicalEvidence.transcriptInputSignature,
          canonicalEvidence,
          canonicalProvider,
        );
      }
      if (!controller.signal.aborted && isMounted.current) {
        setBroadcastTranscriptChapters(reopened.chapters);
        setBroadcastTranscriptRecoveryProgress(null);
        const durableRouteChangedGaps = reopened.fragmentGaps.filter(
          ({ reason }) => reason === "route-changed",
        );
        const durableRetryableGaps = reopened.fragmentGaps.filter(
          (gap) =>
            broadcastTranscriptGapCanAutomaticallyRetry(
              gap,
              transcriptRoute.manifest.transportMode,
            ),
        );
        const durableAmbiguousGaps = reopened.fragmentGaps.filter(
          (gap) =>
            broadcastTranscriptGapRequiresExplicitPaidRetry(
              gap,
              transcriptRoute.manifest.transportMode,
            ),
        );
        if (durableRouteChangedGaps.length > 0) {
          /*
           * Route drift is known to occur before provider billing. Keep every
           * completed cell and its immutable receipt, reacquire `/healthz`,
           * and dispatch only the route-changed cells under a fresh quota
           * namespace on the next effect turn.
           */
          const consecutiveRouteChanges =
            broadcastTranscriptRouteChangeCountRef.current + 1;
          broadcastTranscriptRouteChangeCountRef.current =
            consecutiveRouteChanges;
          await waitForTranscriptRouteRecoveryDelay(
            consecutiveRouteChanges,
            controller.signal,
          );
          if (controller.signal.aborted || !isMounted.current) return;
          autoBroadcastTranscriptSourceRef.current = null;
          setBroadcastTranscriptAttemptOrdinal((current) => current + 1);
          setBroadcastTranscriptStatus("idle");
          setBroadcastTranscriptError(null);
          return;
        }
        broadcastTranscriptRouteChangeCountRef.current = 0;
        if (durableRetryableGaps.length > 0) {
          /*
           * Three waves are one bounded batch, not a terminal failure. The
           * durable gap attempt counts allocate a disjoint next generation on
           * the next effect turn, so a transient provider failure can recover
           * without reusing an operation or asking the editor to restart.
           */
          autoBroadcastTranscriptSourceRef.current = null;
          setBroadcastTranscriptAttemptOrdinal((current) => current + 1);
          setBroadcastTranscriptStatus("idle");
          setBroadcastTranscriptError(null);
          return;
        }
        if (durableAmbiguousGaps.length > 0) {
          setBroadcastTranscriptStatus("failed");
          setBroadcastTranscriptError(
            `처리 결과를 확인할 수 없는 대사 조각 ${durableAmbiguousGaps.length}개가 있어 중복 결제를 막고 멈췄어요. 나머지 안전한 조각은 모두 처리·보존했습니다.`,
          );
          return;
        }
        if (reopened.fragmentGaps.length > 0) {
          throw new Error(
            "The durable main transcript contains an unsupported gap state.",
          );
        }
        sealedBroadcastTranscriptSourceRef.current =
          reopened.transcriptSealOperationKey ?? operationKey;
        broadcastTranscriptRouteChangeCountRef.current = 0;
        setBroadcastTranscriptStatus("completed");
      }
    })()
      .catch((error: unknown) => {
        if (controller.signal.aborted || !isMounted.current) {
          return;
        }
        broadcastTranscriptRouteChangeCountRef.current = 0;
        sealedBroadcastTranscriptSourceRef.current = null;
        setBroadcastTranscriptStatus("failed");
        setBroadcastTranscriptError(
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "방송 전체 대사를 분석하지 못했어요.",
        );
      })
      .finally(() => {
        if (isMounted.current) {
          setBroadcastTranscriptRecoveryProgress(null);
        }
        if (broadcastTranscriptAbortController.current === controller) {
          broadcastTranscriptAbortController.current = null;
        }
      });
  }, [
    aiQuotaParticipantId,
    analysisComplete,
    analysisRun?.inputSignature,
    analysisRun?.status,
    broadcastContextSamplingPlan,
    broadcastTranscriptAttemptOrdinal,
    broadcastTranscriptStatus,
    currentAnalysisRunId,
    getResultStore,
    openedRecoveredResult?.terminal.inputSignature,
    sourceContentFingerprint,
    sourceCastRosterId,
    sourceChannelResolutionIsCurrent,
    sourceFile,
    transcriptSourceIdentityFence,
    analysisCaptionVideoId,
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

  /*
   * Input/analysis presentation adapter.
   *
   * This is intentionally downstream of every durable pipeline projection.
   * FrontSurface never receives candidates, candidate scores, or discovered
   * leads: those remain private until the publication certificate opens
   * ReviewStage. A connected replay is also kept separate from transcript and
   * whole-context readiness so a transcript-ready bundle cannot be presented
   * as if the broadcast context had already been analysed.
   */
  const frontSourceTitle = sourceFile?.name ?? pendingFileName;
  const frontSourceStatus: FrontSourceInput["status"] = (() => {
    if (sourceCheck === null) return "selected";
    if (sourceCheck.status === "created") return "selected";
    if (sourceCheck.status === "checking") return "checking";
    if (sourceCheck.status === "committing") return "committing";
    if (sourceCheck.status === "completed") return sourceCheck.resultKind;
    if (sourceCheck.status === "failed") return "failed";
    return "interrupted";
  })();
  const frontSourceInput: FrontSourceInput | null =
    frontSourceTitle === null
      ? null
      : {
          title: frontSourceTitle,
          durationMs: preflight?.metadata.durationMs ?? null,
          sizeBytes: preflight?.metadata.sizeBytes ?? sourceFile?.size ?? null,
          status: frontSourceStatus,
        };

  const currentPreparedBundle =
    channelPreanalysisConnection.status === "connected" &&
    channelPreanalysisConnection.attachment === "current-run"
      ? channelPreanalysisConnection.lookup.bundle
      : null;
  const localTranscriptReady =
    broadcastTranscriptStatus === "completed" &&
    broadcastTranscriptChapters.length > 0;
  const preparedTranscriptReady =
    preparedChannelTranscriptIsCompatible && currentPreparedBundle !== null;
  const transcriptEventCount = preparedTranscriptReady
    ? currentPreparedBundle.captionTrack.events.length
    : youtubeCaptionTrack?.events.length ?? null;
  const transcriptChapterCount = localTranscriptReady
    ? broadcastTranscriptChapters.length
    : preparedTranscriptReady
      ? currentPreparedBundle.chapters.length
      : null;

  const frontIdentityDetail = sourceError !== null
    ? sourceReady
      ? ui(
          "새 확인은 끝내지 못했지만 기존에 확인된 원본은 그대로 사용할 수 있어요",
          "The new check did not finish, but the previously verified source remains usable",
        )
      : ui(
          "원본 확인을 끝내지 못했어요. 같은 파일을 다시 확인할 수 있어요",
          "Source inspection did not finish. The same file can be checked again",
        )
    : !sourceReady
      ? ui("선택한 원본을 확인하고 있어요", "Inspecting the selected source")
    : channelPreanalysisConnection.status === "connected" &&
        channelPreanalysisConnection.attachment === "current-run"
      ? ui(
          `영상 식별 완료${channelPreanalysisConnection.lookup.match.match?.title === undefined ? "" : ` · ${channelPreanalysisConnection.lookup.match.match.title}`}`,
          `Video identity verified${channelPreanalysisConnection.lookup.match.match?.title === undefined ? "" : ` · ${channelPreanalysisConnection.lookup.match.match.title}`}`,
        )
      : channelPreanalysisConnection.status === "probable"
        ? ui(
            "원본 검사 완료 · 저장된 다시보기는 확인이 필요해요",
            "Source inspected · the prepared replay needs confirmation",
          )
        : ui(
            "로컬 원본 검사와 지문 저장을 완료했어요",
            "Local source inspection and fingerprint storage complete",
          );

  const frontTranscriptLane: FrontPreanalysisInput["transcriptChapters"] =
    localTranscriptReady || preparedTranscriptReady
      ? {
          status: "ready",
          ...(transcriptEventCount === null
            ? {}
            : { transcriptCount: transcriptEventCount }),
          ...(transcriptChapterCount === null
            ? {}
            : { chapterCount: transcriptChapterCount }),
          detail: localTranscriptReady
            ? ui(
                `대사·챕터 확인 완료 · 챕터 ${broadcastTranscriptChapters.length.toLocaleString("ko-KR")}개`,
                `Transcript and chapters complete · ${broadcastTranscriptChapters.length.toLocaleString("en-US")} chapters`,
              )
            : null,
        }
      : broadcastTranscriptStatus === "running" ||
          broadcastTranscriptStatus === "completedWithGaps" ||
          channelPreanalysisConnection.status === "checking" ||
          channelPreanalysisConnection.status === "probable"
        ? {
            status: "checking",
            detail:
              channelPreanalysisConnection.status === "probable"
                ? ui(
                    "저장된 다시보기를 확인하면 시간 대사를 연결할 수 있어요",
                    "Confirm the prepared replay to attach its timed transcript",
                  )
                : ui(
                    "저장 대사를 찾고 비어 있는 구간을 확인하고 있어요",
                    "Checking prepared transcript data and uncovered ranges",
                  ),
          }
        : broadcastTranscriptStatus === "failed"
          ? {
              status: "failed",
              detail: ui(
                "대사 조각을 모두 확정하지 못했어요",
                "Not every transcript fragment was verified",
              ),
            }
          : channelPreanalysisConnection.status === "incompatible"
            ? {
                status: "incompatible",
                detail: ui(
                  "저장 영상의 시간축이 달라 대사를 연결하지 않았어요",
                  "The prepared transcript was not attached because its timeline differs",
                ),
              }
            : {
                status: sourceReady ? "unavailable" : "idle",
                detail: sourceReady
                  ? ui(
                      "저장 대사가 없으면 분석 중 영상 음성에서 새로 확인해요",
                      "If no prepared transcript exists, dialogue is read from the video during analysis",
                    )
                  : null,
              };

  const preparedWholeContextReady =
    preparedTranscriptReady &&
    currentPreparedBundle.broadcastContext !== null &&
    currentPreparedBundle.contextProvenance !== null;
  const frontWholeContextLane: FrontPreanalysisInput["wholeContext"] =
    broadcastContextStatus === "completed" && broadcastContextResult !== null
      ? {
          status: "ready",
          count: broadcastContextResult.semanticChapters.length,
          detail: ui(
            `전체 맥락 확인 완료 · 주제 ${broadcastContextResult.semanticChapters.length.toLocaleString("ko-KR")}개`,
            `Whole context complete · ${broadcastContextResult.semanticChapters.length.toLocaleString("en-US")} topics`,
          ),
        }
      : broadcastContextStatus === "running" ||
          broadcastContextStatus === "restoring"
        ? {
            status: "checking",
            detail: ui(
              "대사·화면과 등장인물 근거를 방송 흐름에 연결하고 있어요",
              "Connecting dialogue, visuals, and participant evidence to the broadcast flow",
            ),
          }
        : broadcastContextStatus === "failed"
          ? {
              status: "failed",
              detail: ui(
                "전체 흐름을 끝까지 확정하지 못했어요",
                "The whole-broadcast flow was not fully verified",
              ),
            }
          : preparedWholeContextReady
            ? {
                status: "ready",
                count: currentPreparedBundle.broadcastContext.semanticChapters.length,
                detail: ui(
                  "저장된 전체 맥락 결과를 현재 원본에 연결할 수 있어요",
                  "Prepared whole-context results can be attached to this source",
                ),
              }
            : {
                status: "idle",
                detail: sourceReady
                  ? ui(
                      "빠른 탐색 뒤 이 영상의 전체 흐름을 분석해요",
                      "Whole-broadcast context starts after the fast scan",
                    )
                  : null,
              };

  const frontPreanalysisInput: FrontPreanalysisInput | null =
    frontSourceInput === null
      ? null
      : {
          videoIdentity: {
            status: sourceReady
              ? "ready"
              : sourceCheckBusy
                ? "checking"
                : sourceError === null
                  ? "idle"
                  : "failed",
            detail: frontIdentityDetail,
          },
          transcriptChapters: frontTranscriptLane,
          wholeContext: frontWholeContextLane,
        };

  const frontAnalysisPhase: FrontPipelineInput["phase"] = !analysisComplete
    ? "fast-pass"
    : !wholeContextPhaseComplete
      ? "broadcast-context"
      : "candidate-detail";
  const frontCandidateAudioNeedsRetry =
    candidateAudioEventRun?.status === "failed" ||
    candidateAudioEventRun?.status === "cancelled" ||
    candidateAudioEventError !== null;
  const frontVisualSourceRequired =
    broadcastVisualInspectionStatus === "blocked" && sourceFile === null;
  const frontCandidateDetailBlocked =
    !candidateRefinementBusy &&
    (candidatePassBNeedsRecovery ||
      frontCandidateAudioNeedsRetry ||
      candidatePassBRun?.status === "completedWithGaps" ||
      blockedByCandidateDetailGap ||
      semanticLeadRefinementStatus === "failed" ||
      broadcastVisualInspectionStatus === "failed" ||
      broadcastVisualInspectionStatus === "blocked");
  const frontRecoveryAction = selectFrontRecoveryAction({
    sourceReady,
    retainedSourceAvailable: sourceFile !== null,
    sourceBlocked: sourceError !== null || frontVisualSourceRequired,
    transcriptBlocked:
      broadcastTranscriptStatus === "failed" ||
      broadcastTranscriptStatus === "completedWithGaps",
    contextBlocked: broadcastContextStatus === "failed",
    candidateDetailBlocked: frontCandidateDetailBlocked,
    saveBlocked: currentPipelineCertificationFailure !== null,
    pipelineContextBlocked:
      !candidateRefinementBusy &&
      wholeContextPhaseComplete &&
      blockedByPipelineGap &&
      !blockedByCandidateDetailGap,
    runCompletedWithGaps: analysisRun?.status === "completedWithGaps",
    contextComplete: wholeContextPhaseComplete,
    runNeedsResume:
      analysisRun?.status === "paused" ||
      analysisRun?.status === "cancelled" ||
      analysisRun?.status === "failed" ||
      analysisRun?.status === "interrupted" ||
      (analysisError !== null && !analysisBusy),
  });
  const frontRecoveryInput: FrontRecoveryInput | null =
    frontRecoveryAction === null
      ? null
      : { actionId: frontRecoveryAction };

  const frontAnalysisStarted =
    analysisStartPending ||
    analysisRun !== null ||
    selectionResult !== null ||
    openedRecoveredResult !== null;
  const frontVerifiedZero =
    contextualCandidatePublicationReady &&
    orderedCandidates.length === 0 &&
    emptyResultReason === "no-verified-candidates";
  const frontCheckpointAxis = computeProgressAxis({
    lastCommittedStage: committedAnalysisStage,
    currentStageRatio: null,
    previousRatio: null,
  });
  const frontPipelineStatus: FrontPipelineInput["status"] = frontVerifiedZero
    ? "completed"
    : frontRecoveryInput !== null
      ? "failed"
      : analysisStartPending || analysisRun?.status === "starting"
        ? "starting"
        : analysisRun?.status === "pausing" ||
            analysisRun?.status === "cancelling" ||
            analysisCancelPending
          ? "pausing"
          : analysisRun?.status === "resuming"
            ? "resuming"
            : analysisRun?.status === "finalizing"
              ? "finalizing"
              : analysisRun?.status === "completing"
                ? "completing"
                : "running";
  const frontPipelineInput: FrontPipelineInput | null =
    !frontAnalysisStarted && !frontVerifiedZero
      ? null
      : {
          status: frontPipelineStatus,
          phase: frontAnalysisPhase,
          terminalOutcome: frontVerifiedZero ? "verified-empty" : null,
          progress: {
            ratio: frontVerifiedZero ? 1 : progressAxis.ratio,
            indeterminate: frontVerifiedZero ? false : progressAxis.indeterminate,
            remainingMs: frontVerifiedZero ? 0 : progressRemaining.remainingMs,
            activityLabel: liveAnalysisStageTitle,
            checkpoint: {
              status:
                analysisCommitPending || currentPipelineCertificationChecking
                  ? "saving"
                  : committedAnalysisStage !== null ||
                      openedRecoveredResult !== null ||
                      frontVerifiedZero
                    ? "saved"
                    : "none",
              ratio: frontVerifiedZero ? 1 : frontCheckpointAxis.ratio,
            },
            tracks: progressDetailTracks.map((track) => ({
              id: track.id,
              label: track.label,
              status: track.status,
              ratio: track.ratio,
            })),
          },
        };

  const frontTopics: readonly FrontTopicRangeInput[] =
    visibleTimelineSemanticChapters.map((chapter) => ({
      id: chapter.semanticChapterId,
      title: chapter.titleKo,
      summary: chapter.summaryKo,
      startMs: chapter.startMs,
      endMs: chapter.endMs,
      family: semanticChapterFamily(chapter.kind),
    }));
  const frontEvidenceRanges: readonly FrontEvidenceRange[] =
    broadcastVisualInspectionStatus !== "completed"
      ? []
      : broadcastTranscriptExplorationCells
          .filter(({ state }) => state === "complete")
          .map((cell) => ({
            id: cell.chunkId,
            startMs: cell.sourceStartMs,
            endMs: cell.sourceEndMs,
            label: ui("대사·화면 확인 완료", "Dialogue and visuals verified"),
          }));
  const frontActiveExploration =
    broadcastTranscriptExplorationCells.find(({ state }) => state === "active") ??
    null;
  const frontScope: FrontScopeSummary | null =
    frontActiveExploration === null
      ? null
      : {
          startMs: frontActiveExploration.sourceStartMs,
          endMs: frontActiveExploration.sourceEndMs,
          summary:
            broadcastTranscriptChapters
              .filter(
                (chapter) =>
                  chapter.startMs < frontActiveExploration.sourceEndMs &&
                  chapter.endMs > frontActiveExploration.sourceStartMs,
              )
              .map(({ summaryKo }) => summaryKo)
              .join(" ") ||
            ui(
              "이 범위의 대사와 화면 자료를 확인하고 있어요.",
              "Dialogue and visual evidence for this range is being checked.",
            ),
        };
  const frontParticipants: readonly FrontParticipantSummary[] =
    broadcastParticipantPreContext !== null
      ? broadcastParticipantPreContext.grounding.participants.map((participant) => {
          const observedEvidence =
            broadcastParticipantPreContext.grounding.evidence.filter(
              (evidence) =>
                "participantId" in evidence &&
                evidence.participantId === participant.participantId &&
                (evidence.kind === "visual-reference-match" ||
                  evidence.kind === "voice-reference-match" ||
                  evidence.kind === "on-screen-name" ||
                  evidence.kind === "spoken-self-identification"),
            );
          const profile =
            broadcastContextResult?.hostStreamerProfile?.displayNameKo ===
            participant.displayNameKo
              ? broadcastContextResult.hostStreamerProfile
              : null;
          const participantImageUrl =
            STREAMER_PROFILE_IMAGE_BY_NAME[participant.displayNameKo];
          return {
            id: participant.participantId,
            name: participant.displayNameKo,
            role:
              participant.sourceRolePrior === "likely-host"
                ? ui("주 진행 후보", "Likely host")
                : ui("출연 후보", "Possible participant"),
            detail:
              profile?.profileSummaryKo ??
              (observedEvidence.length > 0
                ? ui(
                    `화면·음성 근거 ${observedEvidence.length}개`,
                    `${observedEvidence.length} visual or voice identity cues`,
                  )
                : ui(
                    `대사 이름 언급 ${participant.mentionedChapterCount}개 · 화면·음성 확인 전`,
                    `${participant.mentionedChapterCount} transcript name mentions · visual/voice not yet confirmed`,
                  )),
            ...(participantImageUrl === undefined
              ? {}
              : { imageUrl: participantImageUrl }),
          };
        })
      : broadcastContextResult?.hostStreamerProfile === null ||
          broadcastContextResult?.hostStreamerProfile === undefined
        ? []
        : [
            {
              id: "context-host",
              ...(broadcastContextResult.hostStreamerProfile.displayNameKo === null
                ? {}
                : {
                    name:
                      broadcastContextResult.hostStreamerProfile.displayNameKo,
                  }),
              role: ui("주 진행 추정", "Inferred host"),
              detail:
                broadcastContextResult.hostStreamerProfile.profileSummaryKo,
            },
          ];
  const frontSurfaceModel = deriveFrontSurfaceModel({
    language: analysisLanguage,
    source: frontSourceInput,
    pipeline: frontPipelineInput,
    preanalysis: frontPreanalysisInput,
    topics: frontTopics,
    recovery: frontRecoveryInput,
  });
  const frontStartBlocker = preparedChannelReview.status === "checking"
    ? ui(
        "검토까지 끝난 저장 결과를 먼저 찾고 있어요.",
        "Checking for a saved review-ready result first.",
      )
    : channelPreanalysisConfirmationPending
    ? ui(
        "저장된 다시보기가 같은 영상인지 확인한 뒤 시작할 수 있어요.",
        "Analysis can start after the prepared replay match is verified.",
      )
    : chatImportStatus === "reading"
      ? ui(
          "채팅 파일을 다 읽은 뒤 반응 신호와 함께 시작해요.",
          "Analysis starts after the chat file is ready so its reaction signals are included.",
        )
      : undefined;

  const handleFrontSourceFile = (file: File): void => {
    if (!sourceInputLocked && frontVisualSourceRequired) {
      dismissedPreparedChannelReviewKeyRef.current = null;
      setPreparedChannelReview({ status: "idle" });
      void inspectSelectedFile(file, { preserveCurrentSession: true });
      return;
    }
    if (
      !sourceInputLocked &&
      (openedRecoveredResult !== null || confirmDiscardCurrentWork())
    ) {
      dismissedPreparedChannelReviewKeyRef.current = null;
      setPreparedChannelReview({ status: "idle" });
      void inspectSelectedFile(file);
    }
  };
  const handleFrontRecoveryAction = (actionId: FrontRecoveryActionId): void => {
    if (actionId === "choose-source") {
      focusSourceSection();
      return;
    }
    if (actionId === "retry-source-check") {
      if (sourceFile !== null) {
        void inspectSelectedFile(sourceFile, { preserveCurrentSession: true });
      }
      return;
    }
    if (actionId === "retry-transcript") {
      retryWholeContextPhase("transcript");
      return;
    }
    if (actionId === "retry-context") {
      retryWholeContextPhase("context");
      return;
    }
    if (actionId === "retry-save") {
      setPipelineCertificationRetryEpoch((epoch) => epoch + 1);
      return;
    }
    if (actionId === "retry-candidate-detail") {
      if (semanticLeadRefinementStatus === "failed") {
        autoSemanticLeadRefinementSourceRef.current = null;
        allowAmbiguousSemanticRefinementRetryRef.current = true;
        semanticRefinementRouteChangeCountRef.current = 0;
        setSemanticLeadRefinementAttemptOrdinal((current) => current + 1);
        setSemanticLeadRefinementStatus("idle");
        setSemanticLeadRefinementError(null);
        return;
      }
      if (
        broadcastVisualInspectionStatus === "failed" ||
        broadcastVisualInspectionStatus === "blocked"
      ) {
        if (sourceFile === null) {
          focusSourceSection();
          return;
        }
        setBroadcastVisualInspectionStatus("preparing");
        setBroadcastVisualInspectionError(null);
        setBroadcastVisualInspectionAttemptOrdinal((current) => current + 1);
        return;
      }
      if (frontCandidateAudioNeedsRetry && !candidateAudioEventBusy) {
        void runCandidateAudioEvent();
        return;
      }
      if (candidatePassBPersistenceRetryNeeded) {
        void retryCandidatePassBInsightPersistence();
        return;
      }
      const retryCandidateIds =
        candidateDetailGapIds.length > 0
          ? candidateDetailGapIds
          : candidatePassBActionIds.length > 0
            ? candidatePassBActionIds
            : automaticCandidateDetailIds;
      if (!candidatePassBBusy && retryCandidateIds.length > 0) {
        void runCandidatePassB(retryCandidateIds, undefined, true);
        return;
      }
      retryWholeContextPhase();
      return;
    }
    if (!analysisComplete) {
      void runSignalAnalysis();
    } else {
      retryWholeContextPhase();
    }
  };

  const frontConnectionsPanel = (
    <div className="frt-panel-stack">
      <section className="frt-panel-section" aria-labelledby="frt-youtube-title">
        <div className="frt-panel-heading">
          <div>
            <h3 id="frt-youtube-title">{ui("YouTube 다시보기", "YouTube replay")}</h3>
            <p>
              {ui(
                "같은 방송 주소를 알 때만 붙여 넣으세요. 저장된 대사와 챕터를 먼저 찾습니다.",
                "Paste the matching replay URL only when known. Prepared transcript and chapters are checked first.",
              )}
            </p>
          </div>
        </div>
        <label className="frt-field">
          <span>{ui("다시보기 주소", "Replay URL")}</span>
          <input
            type="text"
            inputMode="url"
            placeholder="https://youtu.be/…"
            value={manualVodInput}
            disabled={analysisBusy}
            onChange={(event) => updateManualVodInput(event.currentTarget.value)}
          />
        </label>
        <p className="frt-field-note" aria-live="polite">
          {manualVodInput.trim().length === 0
            ? ui(
                "주소 없이도 분석할 수 있습니다.",
                "Analysis can continue without a replay URL.",
              )
            : youtubeVideoIdFromUserInput(manualVodInput) === null
              ? ui(
                  "영상 주소를 확인하지 못했어요. 전체 YouTube 주소를 붙여 넣어 주세요.",
                  "No video ID was found. Paste the full YouTube URL.",
                )
              : channelPreanalysisConfirmationPending ||
                  channelPreanalysisConnection.status === "checking" ||
                  preparedChannelReview.status === "checking"
                ? ui(
                    "검토까지 끝난 저장 결과를 찾고 있어요.",
                    "Looking for a saved review-ready result.",
                  )
                : preparedChannelReview.status === "preparing"
                  ? ui(
                      "이 영상은 백그라운드 분석 중이에요. 완료 여부를 자동으로 확인하고 바로 검토 화면을 열게요.",
                      "This replay is being analyzed in the background. It will be checked automatically and open directly in review when ready.",
                    )
                  : preparedChannelReview.status === "unavailable"
                    ? ui(
                        "저장된 검토 결과에 잠시 연결하지 못했어요. 다시 확인할 수 있어요.",
                        "The saved review result is temporarily unavailable. You can check again.",
                      )
                : preparedTranscriptReady
                  ? ui(
                      "이 원본과 맞는 대사·챕터를 연결했어요.",
                      "Matching transcript and chapters are connected.",
                    )
                  : ui(
                      "주소를 기억했습니다. 저장 자료가 없으면 일반 자막과 음성 인식을 사용해요.",
                      "The URL is saved. Normal captions and speech recognition are used when prepared data is absent.",
                    )}
        </p>
        {youtubeVideoIdFromUserInput(manualVodInput) !== null &&
          (preparedChannelReview.status === "preparing" ||
            preparedChannelReview.status === "unavailable") && (
            <button
              className="frt-secondary-button"
              type="button"
              onClick={() => {
                dismissedPreparedChannelReviewKeyRef.current = null;
                setPreparedChannelReviewRetryEpoch((epoch) => epoch + 1);
              }}
            >
              {ui("완료 여부 다시 확인", "Check again")}
            </button>
          )}
        {channelPreanalysisConnection.status === "probable" && (
          <button
            className="frt-secondary-button"
            type="button"
            disabled={channelPreanalysisConfirmationPending || analysisBusy}
            onClick={() => void confirmProbableChannelPreanalysisMatch()}
          >
            {channelPreanalysisConfirmationPending
              ? ui("같은 영상인지 확인 중…", "Verifying replay…")
              : ui("이 다시보기가 맞아요", "This is the matching replay")}
          </button>
        )}
      </section>

      <section className="frt-panel-section" aria-labelledby="frt-chat-title">
        <div className="frt-panel-heading">
          <div>
            <h3 id="frt-chat-title">{ui("CHZZK 라이브 채팅", "CHZZK live chat")}</h3>
            <p>
              {ui(
                "선택 사항입니다. 있으면 시청자 반응이 몰린 시점을 함께 확인합니다.",
                "Optional. When available, it helps locate concentrated viewer reactions.",
              )}
            </p>
          </div>
          <label className="frt-secondary-button" aria-disabled={chatInputLocked}>
            {chatFileName === null
              ? ui("채팅 파일 고르기", "Choose chat file")
              : ui("다른 채팅 고르기", "Choose another chat file")}
            <input
              className="frt-visually-hidden"
              type="file"
              accept=".json,.jsonl,.csv,application/json,text/csv,text/plain"
              disabled={chatInputLocked}
              onChange={handleChatInput}
            />
          </label>
        </div>
        {chatImportStatus === "reading" && (
          <p className="frt-field-note" role="status">
            {ui("채팅 파일을 읽고 있어요.", "Reading the chat file.")}
          </p>
        )}
        {chatImport !== null && (
          <div className="frt-chat-summary">
            <strong>{chatFileName}</strong>
            <span>
              {ui(
                `메시지 ${chatImport.messages.length.toLocaleString("ko-KR")}개`,
                `${chatImport.messages.length.toLocaleString("en-US")} messages`,
              )}
            </span>
            <label className="frt-field frt-offset-field">
              <span>{ui("채팅 시간 보정", "Chat time offset")}</span>
              <span>
                <input
                  type="number"
                  step="0.5"
                  value={chatOffsetSeconds}
                  disabled={chatOffsetLocked}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    setChatOffsetSeconds(Number.isFinite(value) ? value : 0);
                  }}
                />
                {ui("초", "sec")}
              </span>
            </label>
            {firstChatWarning !== null && <small>{firstChatWarning}</small>}
          </div>
        )}
        {chatError !== null && (
          <p className="frt-panel-error" role="alert">{chatError}</p>
        )}
      </section>
    </div>
  );

  const frontHistoryPanel = (
    <div className="frt-panel-stack">
      {recoveryCatalog.status === "loading" && (
        <p className="frt-field-note" role="status">
          {ui("저장된 분석을 확인하고 있어요.", "Loading saved analyses.")}
        </p>
      )}
      {recoveryCatalog.status === "failed" && (
        <div className="frt-panel-error" role="alert">
          <p>{ui("저장된 분석 목록을 열지 못했어요.", "Saved analyses could not be opened.")}</p>
          <button className="frt-secondary-button" type="button" onClick={() => void refreshRecoveryCatalog()}>
            {ui("다시 확인", "Try again")}
          </button>
        </div>
      )}
      {recoveryCatalog.status === "ready" &&
        recoveryCatalog.audit.results.length === 0 && (
          <p className="frt-field-note">
            {ui("이 브라우저에 저장된 분석이 없습니다.", "No saved analyses are available in this browser.")}
          </p>
        )}
      {recoveryCatalog.status === "ready" &&
        recoveryCatalog.audit.results.map((recovered) => (
          <article className="frt-history-item" key={recovered.terminal.runId}>
            <div>
              <strong>{ui("저장된 분석 결과", "Saved analysis result")}</strong>
              <span>
                {formatDuration(recovered.finalResult.result.input.source.durationMs)} · {new Date(recovered.terminal.recordedAt).toLocaleString(analysisLanguage === "ko" ? "ko-KR" : "en-US")}
              </span>
            </div>
            <button
              className="frt-secondary-button"
              type="button"
              disabled={analysisBusy || candidateRefinementBusy}
              onClick={() => openRecoveredAnalysis(recovered)}
            >
              {ui("이 결과 열기", "Open result")}
            </button>
          </article>
        ))}
    </div>
  );

  if (preparedChannelReview.status === "ready") {
    return (
      <div className="rh-app">
        <PreparedReviewExperience
          key={preparedChannelReview.loaded.artifact.contentDigest}
          bundle={preparedChannelReview.loaded.review}
          artifactDigest={preparedChannelReview.loaded.artifact.contentDigest}
          sourceTitle={preparedChannelReview.title}
          analysisLanguage={analysisLanguage}
          {...(sourcePreviewUrl === null
            ? {}
            : { videoSrc: sourcePreviewUrl })}
          youtubeVideoId={preparedChannelReview.videoId}
          onLanguageChange={setAnalysisLanguage}
          onToggleTheme={() =>
            setTheme((current) => (current === "light" ? "dark" : "light"))}
          themeLabel={
            theme === "light"
              ? ui("어두운 화면으로 바꾸기", "Use dark theme")
              : ui("밝은 화면으로 바꾸기", "Use light theme")
          }
          onExit={() => {
            dismissedPreparedChannelReviewKeyRef.current =
              preparedReviewRequestKey;
            preparedChannelReviewAbortController.current?.abort();
            preparedChannelReviewAbortController.current = null;
            setPreparedChannelReview({ status: "dismissed" });
            startFreshAnalysis();
          }}
        />
      </div>
    );
  }

  if (!contextualCandidatePublicationReady || orderedCandidates.length === 0) {
    return (
      <div className="rh-app">
        <FrontSurface
          model={frontSurfaceModel}
          evidenceRanges={frontEvidenceRanges}
          selectedTopicId={
            timelineInspectionTarget?.kind === "chapter"
              ? timelineInspectionTarget.id
              : null
          }
          scope={frontScope}
          participants={frontParticipants}
          panels={{
            connections: frontConnectionsPanel,
            history: frontHistoryPanel,
          }}
          languageLocked={
            sourceFile !== null ||
            pendingFileName !== null ||
            analysisRun !== null
          }
          themeLabel={
            theme === "light"
              ? ui("어두운 화면으로 바꾸기", "Use dark theme")
              : ui("밝은 화면으로 바꾸기", "Use light theme")
          }
          accept="video/*,.mp4,.webm,.mkv,.mov,.m4v"
          onSelectSourceFile={handleFrontSourceFile}
          onChangeSource={startFreshAnalysis}
          {...(frontStartBlocker === undefined
            ? {}
            : { startBlocker: frontStartBlocker })}
          {...(!sourceInputLocked &&
          sourceReady &&
          !analysisBusy &&
          !analysisComplete &&
          preparedChannelReview.status !== "checking" &&
          !channelPreanalysisConfirmationPending &&
          chatImportStatus !== "reading"
            ? { onStartAnalysis: () => void runSignalAnalysis() }
            : {})}
          {...(analysisCanBeCancelled ? { onStopAnalysis: cancelAnalysis } : {})}
          onRecoveryAction={handleFrontRecoveryAction}
          onSelectTopic={(topicId) =>
            setTimelineInspectionTarget({ kind: "chapter", id: topicId })}
          onLanguageChange={setAnalysisLanguage}
          onToggleTheme={() =>
            setTheme((current) => (current === "light" ? "dark" : "light"))}
          onHistoryRequest={() => void refreshRecoveryCatalog()}
        />
      </div>
    );
  }

  return (
    <div className="rh-app">
      {/* The body. Below the device breakpoint these two wrappers collapse to
          `display: contents`, so the markup is identical either way. */}
      <div className="ex-device">
        <div className="ex-device-screen">
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
              icon: <path d="M4 15V9M8.5 18V6M13 20.5V3.5M17.5 15.5V8.5M21 12.5v-1" />,
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
              icon: <path d="M12 3.5v11.3M7.3 10.3 12 15l4.7-4.7M4.5 18.5h15" />,
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
        {/* Session tools. The steps above report where the run is; these act
            on the review itself, and each was previously either buried in a
            text link or had nowhere to live at all. */}
        <span className="ex-rail-sep" aria-hidden="true" />
        <div className="ex-rail-tools">
          <button
            type="button"
            title={ui("방송 지도", "Broadcast map")}
            aria-keyshortcuts="M"
            aria-expanded={mapSheetOpen}
            disabled={!reviewShortcutsActive}
            onClick={() => setMapSheetOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 4.5 3.5 6.8v12.7L9 17.2l6 2.3 5.5-2.3V4.5L15 6.8Z" />
              <path d="M9 4.5v12.7M15 6.8v12.7" />
            </svg>
            <span className="rh-screen-reader-only">{ui("방송 지도 열고 닫기", "Toggle broadcast map")}</span>
          </button>
          <button
            type="button"
            title={ui("되돌리기", "Undo")}
            aria-keyshortcuts="Z"
            disabled={reviewUndo === null}
            onClick={undoLastReview}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 9h11a4.5 4.5 0 0 1 0 9h-6" />
              <path d="m7.5 5.5-3.5 3.5 3.5 3.5" />
            </svg>
            <span className="rh-screen-reader-only">{ui("방금 한 판단 되돌리기", "Undo last judgement")}</span>
          </button>
          <button
            type="button"
            title={ui("단축키", "Shortcuts")}
            aria-keyshortcuts="?"
            aria-expanded={shortcutHelpOpen}
            onClick={() => setShortcutHelpOpen(true)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
              <path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8" />
            </svg>
            <span className="rh-screen-reader-only">{ui("단축키 안내 열기", "Open shortcuts")}</span>
          </button>
        </div>
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
      <div className="ex-screen">
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
              <AnalysisProgressPanel
                sourceTitle={sourceTitleForProgress}
                sourceDurationLabel={formatDuration(boundarySourceDurationMs)}
                axis={progressAxis}
                remainingLabel={progressRemainingLabel}
                currentActivity={liveAnalysisStageTitle}
                tracks={progressDetailTracks}
                onStop={analysisCanBeCancelled ? cancelAnalysis : () => undefined}
              />
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

              <div className="rh-vod-hint">
                <label htmlFor="vod-url">
                  {ui("YouTube 다시보기 주소", "YouTube replay URL")}{" "}
                  <span>
                    {ui(
                      "(선택 · 파일보다 먼저 붙여넣어도 돼요)",
                      "(optional · you can paste it before choosing the file)",
                    )}
                  </span>
                </label>
                <input
                  id="vod-url"
                  type="text"
                  inputMode="url"
                  placeholder={ui(
                    "https://youtu.be/… 붙여넣기",
                    "Paste https://youtu.be/…",
                  )}
                  value={manualVodInput}
                  disabled={analysisBusy}
                  onChange={(event) =>
                    updateManualVodInput(event.target.value)
                  }
                />
                <p aria-live="polite">
                  {manualVodInput.trim().length === 0
                    ? ui(
                        "같은 방송의 다시보기가 있으면 자막과 준비된 분석 자료를 먼저 찾습니다.",
                        "If a replay exists, captions and prepared analysis data are checked first.",
                      )
                    : youtubeVideoIdFromUserInput(manualVodInput) === null
                      ? ui(
                          "주소에서 영상을 찾지 못했습니다. 유튜브 주소를 그대로 붙여넣어 주세요.",
                          "No video ID was found. Paste the full YouTube URL.",
                        )
                      : !sourceReady
                        ? ui(
                            "주소를 기억했습니다. 영상 파일을 고르면 같은 원본인지 확인합니다.",
                            "URL saved. Choose the video file to verify the source.",
                          )
                        : channelPreanalysisConfirmationPending
                          ? ui(
                              "주소 형식을 확인했습니다. 저장된 분석 자료를 찾고 있어요.",
                              "The URL format is valid. Looking for prepared analysis data.",
                            )
                          : channelPreanalysisConnection.status ===
                              "incompatible"
                            ? ui(
                                "주소의 영상과 원본 길이가 다릅니다. 이 시간 자막은 분석에 쓰지 않아요.",
                                "The replay and source durations differ. These timed captions will not be used.",
                              )
                            : ui(
                                "주소 형식을 확인했습니다. 저장 자료가 없더라도 이 영상의 일반 자막을 먼저 시도합니다.",
                                "The URL format is valid. Even without prepared data, normal captions for this video are tried first.",
                              )}
                </p>
              </div>

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
                  disabled={
                    !sourceReady ||
                    analysisBusy ||
                    analysisComplete ||
                    preparedChannelReview.status === "checking" ||
                    channelPreanalysisConfirmationPending ||
                    chatImportStatus === "reading"
                  }
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

            {sourceFile !== null &&
              channelPreanalysisConnection.status === "checking" && (
                <div className="rh-vod-hint rh-preanalysis-status" aria-live="polite">
                  <strong>{ui("저장된 방송 분석을 찾는 중", "Looking for prepared broadcast data")}</strong>
                  <p>{ui("채널 카탈로그와 이 원본의 ID·지문을 맞추고 있어요.", "Matching this source against the channel catalog by ID and fingerprint.")}</p>
                </div>
              )}

            {sourceFile !== null &&
              channelPreanalysisConnection.status === "connected" && (
                <div
                  className="rh-vod-hint rh-preanalysis-status"
                  data-tone="ready"
                  aria-live="polite"
                >
                  <strong>
                    {channelPreanalysisConnection.attachment ===
                    "future-run-only"
                      ? ui(
                          "다음 새 분석을 위한 다시보기 연결을 저장했어요",
                          "Replay connection saved for the next new analysis",
                        )
                      : preparedChannelTranscriptIsCompatible
                        ? ui(
                            "저장된 한국어 대사를 연결했어요",
                            "Prepared Korean captions connected",
                          )
                        : channelPreanalysisConnection.timelineStatus ===
                            "unknown"
                          ? ui(
                              "다시보기 연결을 확인했어요",
                              "Replay identity confirmed",
                            )
                           : ui(
                               `${currentChannelPreanalysisSource?.displayNameKo ?? "채널"} 다시보기를 연결했어요`,
                               `${currentChannelPreanalysisSource?.channelHandle.slice(1) ?? "Channel"} replay connected`,
                             )}
                  </strong>
                  <p>
                    {channelPreanalysisConnection.lookup.match.match?.title}
                    {" · "}
                    {channelPreanalysisConnection.lookup.match.match?.durationMs === null ||
                    channelPreanalysisConnection.lookup.match.match?.durationMs === undefined
                      ? ui("길이 확인 전", "duration pending")
                      : formatDuration(
                          channelPreanalysisConnection.lookup.match.match.durationMs,
                        )}
                  </p>
                  <small>
                    {channelPreanalysisConnection.attachment ===
                    "future-run-only"
                      ? ui(
                          "열어 둔 복구 결과의 원본 입력은 바꾸지 않습니다. 이 연결은 다음 새 분석부터 사용합니다.",
                          "The opened recovery input remains unchanged. This connection is available to the next new analysis.",
                        )
                      : preparedChannelTranscriptIsCompatible
                        ? ui(
                            "저장된 대사를 먼저 쓰고, 비어 있는 구간만 음성 인식으로 보완합니다.",
                            "Prepared captions are used first; only uncovered ranges go through speech recognition.",
                          )
                        : channelPreanalysisConnection.timelineStatus ===
                            "unknown"
                          ? ui(
                              "카탈로그 길이 정보는 아직 준비 전입니다. 확인된 영상 ID의 일반 자막을 먼저 시도하고 비어 있는 구간만 음성 인식합니다.",
                              "Catalog duration is still pending. Normal captions for the confirmed video ID are tried first, then uncovered ranges use speech recognition.",
                            )
                          : ui(
                              "저장 자료가 아직 없으면 기존 자막·음성 인식 경로가 자동으로 이어집니다.",
                              "If prepared data is not ready, the normal caption and speech-recognition route continues automatically.",
                            )}
                  </small>
                </div>
              )}

            {sourceFile !== null &&
              channelPreanalysisConnection.status === "incompatible" && (
                <div
                  className="rh-vod-hint rh-preanalysis-status"
                  data-tone="confirm"
                  aria-live="polite"
                >
                  <strong>
                    {ui(
                      "다시보기 길이가 달라 시간 자막을 연결하지 않았어요",
                      "Timed captions were not connected because the durations differ",
                    )}
                  </strong>
                  <p>
                    {channelPreanalysisConnection.lookup.match.match?.title}
                    {" · "}
                    {channelPreanalysisConnection.lookup.match.match
                      ?.durationMs === null ||
                    channelPreanalysisConnection.lookup.match.match
                      ?.durationMs === undefined
                      ? ui("길이 확인 전", "duration pending")
                      : formatDuration(
                          channelPreanalysisConnection.lookup.match.match
                            .durationMs,
                        )}
                  </p>
                  <small>
                    {ui(
                      "잘못된 시간축을 분석에 섞지 않았습니다. 올바른 다시보기 주소를 붙여넣거나 영상 자체의 음성을 분석할 수 있어요.",
                      "The conflicting timeline was excluded. Paste the correct replay URL or continue with the source audio.",
                    )}
                  </small>
                </div>
              )}

            {sourceFile !== null &&
              channelPreanalysisConnection.status === "probable" && (
                <div
                  className="rh-vod-hint rh-preanalysis-status"
                  data-tone="confirm"
                  aria-live="polite"
                >
                  <strong>
                    {channelPreanalysisConnection.reason ===
                    "filename-confirmation-required"
                      ? ui(
                          "파일명 속 다시보기가 맞는지 확인해 주세요",
                          "Confirm the replay found in the filename",
                        )
                      : ui(
                          "같은 방송으로 보이는 다시보기가 있어요",
                          "A likely matching replay was found",
                        )}
                  </strong>
                  <p>
                    {channelPreanalysisConnection.lookup.match.match?.title}
                    {" · "}
                    {channelPreanalysisConnection.lookup.match.match?.durationMs === null ||
                    channelPreanalysisConnection.lookup.match.match?.durationMs === undefined
                      ? ui("길이 확인 전", "duration pending")
                      : formatDuration(
                          channelPreanalysisConnection.lookup.match.match.durationMs,
                        )}
                  </p>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={
                      analysisBusy ||
                      analysisStartPending ||
                      channelPreanalysisConfirmationPending
                    }
                    onClick={() => void confirmProbableChannelPreanalysisMatch()}
                  >
                    {channelPreanalysisConfirmationPending
                      ? ui("연결 자료 확인 중…", "Checking prepared data…")
                      : channelPreanalysisConnection.reason ===
                          "filename-confirmation-required"
                        ? ui("이 영상이 맞아요", "This is the right video")
                        : ui("이 다시보기 연결", "Connect this replay")}
                  </button>
                  <small>
                    {channelPreanalysisConnection.reason ===
                    "filename-confirmation-required"
                      ? ui(
                          "카탈로그에 길이 정보가 아직 없어 파일명만으로 시간 자막을 붙이지 않았어요.",
                          "Catalog duration is still pending, so the filename alone did not attach timed captions.",
                        )
                      : ui(
                          "제목과 길이만 일치해 자동으로 붙이지 않았어요.",
                          "It was not connected automatically because only title and duration match.",
                        )}
                  </small>
                </div>
              )}

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
                      : artifactSelectionReady
                        ? currentPipelineCertificationFailure === null
                          ? "최종 증거를 확인하고 있어요"
                          : "완료 조건을 복구해야 해요"
                        : "방송 전체 맥락을 만들고 있어요"}
                  </h3>
                  <p className="rh-help">
                    {contextualCandidatePublicationReady
                      ? "AI가 전체 방송 맥락과 화면·대사를 종합한 장면만 모았습니다. 이제 짧은 후보만 재생해 결정하면 됩니다."
                      : artifactSelectionReady
                        ? "저장된 분석 조각이 같은 원본·실행·대사·맥락·대표 화면에 속하는지 마지막으로 확인합니다."
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

              {artifactSelectionReady &&
                currentPipelineCertificationChecking && (
                  <div
                    className="rh-notice"
                    data-tone="info"
                    role="status"
                    aria-live="polite"
                  >
                    {ui(
                      "저장된 대사·맥락·대표 화면을 다시 열어 최종 후보를 확인하고 있어요.",
                      "Reopening the saved transcript, context, and frames before publishing candidates.",
                    )}
                  </div>
                )}

              {currentPipelineCertificationFailure !== null && (
                <div
                  className="rh-notice rh-notice-with-action"
                  data-tone="warning"
                  role="alert"
                >
                  <div>
                    <strong>
                      {ui(
                        "완료 조건을 아직 모두 확인하지 못했어요.",
                        "The analysis has not yet passed every completion check.",
                      )}
                    </strong>
                    <ul>
                      {[
                        ...new Set(
                          currentPipelineCertificationFailure.gaps.map(
                            ({ code }) => code,
                          ),
                        ),
                      ].map((code) => (
                        <li key={code}>
                          {PIPELINE_CERTIFICATION_GAP_LABEL[code][
                            analysisLanguage
                          ]}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() =>
                      setPipelineCertificationRetryEpoch(
                        (epoch) => epoch + 1,
                      )
                    }
                  >
                    {ui("저장 결과 다시 확인", "Check saved results again")}
                  </button>
                </div>
              )}

              {currentPipelineCertificate !== null &&
                !certificateMatchesFinalCandidates && (
                  <div
                    className="rh-notice rh-notice-with-action"
                    data-tone="warning"
                    role="alert"
                  >
                    <span>
                      {ui(
                        "인증된 후보 목록과 화면의 후보 목록이 달라 공개를 멈췄어요.",
                        "Publication stopped because the certified and visible candidate sets differ.",
                      )}
                    </span>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      onClick={() =>
                        setPipelineCertificationRetryEpoch(
                          (epoch) => epoch + 1,
                        )
                      }
                    >
                      {ui("후보 다시 확인", "Check candidates again")}
                    </button>
                  </div>
                )}

              {!contextualCandidatePublicationReady && !analysisComplete && candidates.length > 0 && (
                <details className="rh-early-candidates">
                  <summary>
                    <strong>빠른 후보 {candidates.length}개 — 검증 전</strong>
                    <span>지금 훑어볼 수 있어요. 최종 확정 전이라 순서·경계·설명이 바뀔 수 있어요.</span>
                  </summary>
                  <ol className="rh-early-candidates-list" aria-label="검증 전 빠른 후보 목록">
                    {[...candidates]
                      .sort((left, right) => left.peakMs - right.peakMs || left.id.localeCompare(right.id))
                      .map((candidate) => (
                        <li key={candidate.id}>
                          <span className="rh-early-candidate-time">
                            {formatDuration(candidate.startMs)}–{formatDuration(candidate.endMs)}
                          </span>
                          <span className="rh-early-candidate-score">
                            상대 점수 {Math.round(candidate.score * 100)}
                          </span>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={sourcePreviewUrl === null}
                            onClick={() => playCandidate(candidate)}
                          >
                            재생
                          </button>
                        </li>
                      ))}
                  </ol>
                </details>
              )}

              {(broadcastVisualInspectionStatus === "preparing" ||
                broadcastVisualInspectionStatus === "analyzing" ||
                broadcastVisualInspectionStatus === "blocked" ||
                broadcastVisualInspectionStatus === "failed") && (
                <div
                  className="rh-notice rh-notice-with-action"
                  data-tone={
                    broadcastVisualInspectionStatus === "blocked" ||
                    broadcastVisualInspectionStatus === "failed"
                      ? "warning"
                      : undefined
                  }
                  role="status"
                >
                  <span>
                    <strong>
                      {broadcastVisualInspectionStatus === "preparing"
                        ? ui("화면 증거를 준비하고 있어요", "Preparing visual evidence")
                        : broadcastVisualInspectionStatus === "analyzing"
                          ? ui("준비된 화면을 AI가 해석하고 있어요", "AI is reading the prepared frames")
                          : broadcastVisualInspectionStatus === "blocked"
                            ? ui("남은 화면 분석을 자동으로 이어갈게요", "Remaining visual analysis will resume automatically")
                            : ui("저장된 지점부터 화면 분석을 다시 시작할 수 있어요", "Visual analysis can restart from its saved checkpoint")}
                    </strong>
                    <br />
                    {ui(
                      `화면 묶음 ${broadcastVisualInspectionPreparedCellCount}/${broadcastVisualInspectionPlannedCellCount} · AI 해석 ${broadcastVisualInspectionSettledCellCount}/${broadcastVisualInspectionPlannedCellCount}`,
                      `Frame bundles ${broadcastVisualInspectionPreparedCellCount}/${broadcastVisualInspectionPlannedCellCount} · AI readings ${broadcastVisualInspectionSettledCellCount}/${broadcastVisualInspectionPlannedCellCount}`,
                    )}
                    {broadcastVisualInspectionError !== null && (
                      <>
                        <br />
                        {broadcastVisualInspectionError}
                      </>
                    )}
                    <progress
                      className="rh-analysis-progress"
                      max={Math.max(
                        1,
                        broadcastVisualInspectionPlannedCellCount * 2,
                      )}
                      value={
                        broadcastVisualInspectionPreparedCellCount +
                        broadcastVisualInspectionSettledCellCount
                      }
                      aria-label={ui(
                        "화면 증거 분석 진행률",
                        "Visual evidence analysis progress",
                      )}
                    />
                  </span>
                  {broadcastVisualInspectionStatus === "failed" && (
                    <button
                      className="btn btn-secondary"
                      type="button"
                      onClick={() => {
                        setBroadcastVisualInspectionStatus("preparing");
                        setBroadcastVisualInspectionError(null);
                        setBroadcastVisualInspectionAttemptOrdinal(
                          (current) => current + 1,
                        );
                      }}
                    >
                      {ui("화면 분석 다시 시작", "Restart visual analysis")}
                    </button>
                  )}
                </div>
              )}

              {(broadcastTranscriptStatus === "failed" ||
                broadcastTranscriptStatus === "completedWithGaps" ||
                broadcastContextStatus === "failed" ||
                semanticLeadRefinementStatus === "failed") && (
                <div className="rh-notice rh-notice-with-action" data-tone="warning" role="status">
                  <span>
                    {broadcastTranscriptStatus === "completedWithGaps"
                      ? ui(
                          "일부 방송 대사 구간에 근거 공백이 남아 있어요. 성공한 구간은 유지하고 누락 구간만 다시 분석할 수 있습니다.",
                          "Some transcript evidence is still missing. Completed ranges will be kept and only missing ranges will be retried.",
                        )
                      : semanticLeadRefinementError ??
                        broadcastContextError ??
                        broadcastTranscriptError ??
                        ui(
                          "방송 전체 맥락 분석을 마치지 못했어요.",
                          "The whole-broadcast context analysis did not finish.",
                        )}
                  </span>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() => {
                      if (broadcastTranscriptStatus === "completedWithGaps") {
                        retryWholeContextPhase();
                      } else if (semanticLeadRefinementStatus === "failed") {
                        autoSemanticLeadRefinementSourceRef.current = null;
                        allowAmbiguousSemanticRefinementRetryRef.current = true;
                        semanticRefinementRouteChangeCountRef.current = 0;
                        setSemanticLeadRefinementAttemptOrdinal(
                          (current) => current + 1,
                        );
                        setSemanticLeadRefinementStatus("idle");
                        setSemanticLeadRefinementError(null);
                      } else {
                        retryWholeContextPhase();
                      }
                    }}
                  >
                    {broadcastTranscriptStatus === "completedWithGaps"
                      ? "누락 구간부터 다시 시도"
                      : "다시 시도"}
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

              {(contextualCandidatePublicationReady || candidatePassBNeedsRecovery) &&
                candidateReviewFeatureAvailability.hasCandidates && (
              <details
                className="rh-review-tools"
                open={candidatePassBNeedsRecovery || undefined}
              >
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
                           (candidatePassBActionIds.length === 0 &&
                             !candidatePassBPersistenceRetryNeeded) ||
                           candidateAudioEventBusy
                         }
                        onClick={() => {
                          if (candidatePassBPersistenceRetryNeeded) {
                            void retryCandidatePassBInsightPersistence();
                            return;
                          }
                          void runCandidatePassB(
                            candidatePassBActionIds,
                            undefined,
                            true,
                          );
                        }}
                      >
                        {candidatePassBPersistenceRetryNeeded
                          ? "검증 결과 저장 다시 시도"
                          : candidatePassBRun === null
                          ? `후보 ${candidateDetailCandidateIds.length}개 자세히 분석`
                          : automaticCandidateDetailIds.length > 0
                            ? `미완료 후보 ${automaticCandidateDetailIds.length}개 다시 분석`
                            : `후보 ${candidateDetailCandidateIds.length}개 다시 분석`}
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

              {contextualCandidatePublicationReady &&
                orderedCandidates.length > 0 &&
                blockedByPipelineGap && (
                  <div
                    className="rh-notice rh-notice-with-action"
                    data-tone="warning"
                    role="status"
                  >
                    <div>
                      <strong>
                        검증이 끝난 후보 {orderedCandidates.length}개를 먼저 보여드려요.
                      </strong>
                      <span>
                        미완료 후보는 최종 목록에 섞지 않았습니다. 성공한 AI 결과는
                        보존하고 빠진 후보만 다시 분석할 수 있어요.
                      </span>
                      <dl className="rh-verification-gap-list">
                        {finalVerificationGapSummary
                          .filter(({ gap }) => isPipelineGap(gap))
                          .map((entry) => (
                            <div key={entry.gap} data-pipeline="true">
                              <dt>
                                {entry.label}
                                <span>{entry.count}개</span>
                              </dt>
                              <dd>{entry.detail}</dd>
                            </div>
                          ))}
                      </dl>
                    </div>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      disabled={
                        candidatePassBBusy ||
                        analysisBusy ||
                        (blockedByCandidateDetailGap &&
                          automaticCandidateDetailIds.length === 0)
                      }
                      onClick={() => {
                        if (blockedByCandidateDetailGap) {
                          void runCandidatePassB(automaticCandidateDetailIds);
                          return;
                        }
                        retryWholeContextPhase();
                      }}
                    >
                      {blockedByCandidateDetailGap
                        ? `미완료 후보 ${automaticCandidateDetailIds.length}개 다시 분석`
                        : "맥락 누락 다시 분석"}
                    </button>
                  </div>
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
                          disabled={
                            analysisBusy ||
                            candidatePassBBusy ||
                            (blockedByCandidateDetailGap &&
                              automaticCandidateDetailIds.length === 0)
                          }
                          onClick={() => {
                            if (blockedByCandidateDetailGap) {
                              void runCandidatePassB(automaticCandidateDetailIds);
                              return;
                            }
                            retryWholeContextPhase();
                          }}
                        >
                          {blockedByCandidateDetailGap
                            ? `미완료 후보 ${automaticCandidateDetailIds.length}개 다시 분석`
                            : broadcastTranscriptStatus === "completedWithGaps"
                            ? "누락 구간부터 다시 시도"
                            : "맥락 분석 다시 시도"}
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
                          onClick={() => retryWholeContextPhase()}
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
              ) : contextualCandidatePublicationReady && orderedCandidates.length > 0 ? (
                /*
                 * 검토가 준비되면 새 검토 화면이 이 자리를 대신한다. 아래 레거시
                 * 분기는 분석이 아직 진행 중일 때의 탐색 타임라인이라 남아 있으며,
                 * 분석 화면을 재설계할 때 함께 걷힌다.
                 */
                <ReviewStage
                  sourceTitle={preflight?.metadata.name ?? "저장된 AI 분석 결과"}
                  sourceDurationMs={boundarySourceDurationMs}
                  candidates={reviewViewCandidates}
                  focusedCandidateId={focusedCandidateId}
                  onFocusCandidateId={(candidateId) => {
                    const target = orderedCandidates.find(({ id }) => id === candidateId);
                    if (target !== undefined) focusCandidateForReview(target);
                  }}
                  streamerName={reviewStreamerName}
                  {...(reviewStreamerImageUrl === undefined
                    ? {}
                    : { streamerImageUrl: reviewStreamerImageUrl })}
                  {...(sourcePreviewUrl === null ? {} : { videoSrc: sourcePreviewUrl })}
                  onDecide={(candidateId, decision) => {
                    const target = orderedCandidates.find(({ id }) => id === candidateId);
                    if (target !== undefined) {
                      reviewCandidateAndAdvance(target, reviewStateForDecision(decision));
                    }
                  }}
                  onTrim={(candidateId, edge, deltaMs) => {
                    const target = orderedCandidates.find(({ id }) => id === candidateId);
                    if (target !== undefined) {
                      nudgeCandidateBoundary(
                        target,
                        edge === "start" ? "SHIFT_START" : "SHIFT_END",
                        deltaMs < 0 ? -5_000 : 5_000,
                      );
                    }
                  }}
                  onUndo={undoLastReview}
                  canUndo={reviewUndo !== null}
                  onHelp={() => setShortcutHelpOpen(true)}
                  onToggleTheme={() =>
                    setTheme((current) => (current === "light" ? "dark" : "light"))}
                  themeLabel={theme === "light" ? "어두운 테마로" : "밝은 테마로"}
                  page={reviewPage}
                  onPageChange={setReviewPage}
                  resetConfirmOpen={resetConfirmOpen}
                  onResetConfirmOpen={() => setResetConfirmOpen(true)}
                  onResetConfirm={() => {
                    setResetConfirmOpen(false);
                    resetFocusedCandidateReview();
                  }}
                  onResetCancel={() => setResetConfirmOpen(false)}
                  onItemFocusMover={(move) => {
                    reviewItemFocusMoverRef.current = move;
                  }}
                />
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
                        후보 <b>{previewCandidateNumber > 0 ? previewCandidateNumber : orderedCandidates.length > 0 ? 1 : 0}/{orderedCandidates.length}</b>
                        {" · 남음 "}<b>{remainingReviewCount}</b>
                        {" · 사용 "}<b>{approvedCount}</b>
                      </span>
                    </div>
                  )}
                  {contextualCandidatePublicationReady && orderedCandidates.length > 0 && (
                    <>
                      <div className="ex-pos" aria-label="방송 전체에서 후보 위치">
                        <span className="ex-pos-rail" aria-hidden="true" />
                        {orderedCandidates.map((candidate, stripIndex) => (
                          <button
                            key={candidate.id}
                            type="button"
                            className="ex-pos-marker"
                            data-state={candidate.reviewState}
                            data-current={candidate.id === focusedCandidateId}
                            style={{
                              left: `${candidateStripPositionPercent(candidate.peakMs, boundarySourceDurationMs)}%`,
                            }}
                            title={`후보 ${stripIndex + 1} · ${formatDuration(candidate.peakMs)}`}
                            aria-label={`후보 ${stripIndex + 1}로 이동`}
                            onClick={() => focusCandidateForReview(candidate)}
                          />
                        ))}
                      </div>
                      <div className="ex-pos-meta">
                        <button
                          type="button"
                          className="ex-map-toggle"
                          aria-keyshortcuts="M"
                          aria-expanded={mapSheetOpen}
                          onClick={() => setMapSheetOpen((open) => !open)}
                        >
                          방송 지도 <kbd>M</kbd>
                        </button>
                        <span className="ex-pos-tc">
                          {formatDuration(focusedCandidate?.peakMs ?? 0)} / {formatDuration(boundarySourceDurationMs)}
                        </span>
                      </div>
                    </>
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
                                : broadcastTranscriptStatus === "completed"
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
                    className="ex-ws"
                    aria-label="선택한 후보 영상과 편집 판단"
                  >
                  <div className="ex-stagewrap">
                    <div className="ex-stage">
                      {sourcePreviewUrl !== null ? (
                        <>
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
                              <div className="ex-stage-preparing" role="status">
                                <strong>검토 화면 준비 중</strong>
                                <span>소리 없이 시작점에 맞추는 중이에요.</span>
                              </div>
                            )}
                        </>
                      ) : (
                        <div className="ex-stage-empty">
                          <strong>원본을 연결하면 여기서 바로 재생할 수 있어요.</strong>
                          <p>AI 설명과 시간표 검토는 지금도 가능합니다.</p>
                          <button className="btn btn-primary" type="button" onClick={focusSourceSection}>
                            원본 다시 연결
                          </button>
                        </div>
                      )}
                    </div>

                    {focusedCandidate !== null && (
                      <div className="ex-dock" aria-label="후보 판단">
                        <button
                          type="button"
                          aria-label={
                            focusedCandidate.reviewState === "rejected"
                              ? `후보 ${previewCandidateNumber} 다시 검토`
                              : `후보 ${previewCandidateNumber} 제외`
                          }
                          aria-keyshortcuts="R"
                          onClick={() =>
                            reviewCandidateAndAdvance(
                              focusedCandidate,
                              focusedCandidate.reviewState === "rejected" ? "unreviewed" : "rejected",
                            )
                          }
                        >
                          {focusedCandidate.reviewState === "rejected" ? "다시 검토" : "빼기"} <kbd>R</kbd>
                        </button>
                        <button
                          type="button"
                          className="ex-dock-play"
                          aria-label={`후보 ${previewCandidateNumber} 구간 재생`}
                          aria-keyshortcuts="Space"
                          disabled={sourcePreviewUrl === null}
                          onClick={() => playCandidate(focusedCandidate)}
                        >
                          ▶
                        </button>
                        <button
                          type="button"
                          className="ex-dock-approve"
                          aria-label={
                            focusedCandidate.reviewState === "approved"
                              ? `후보 ${previewCandidateNumber} 승인 취소`
                              : `후보 ${previewCandidateNumber} 사용하기`
                          }
                          aria-keyshortcuts="A"
                          onClick={() =>
                            reviewCandidateAndAdvance(
                              focusedCandidate,
                              focusedCandidate.reviewState === "approved" ? "unreviewed" : "approved",
                            )
                          }
                        >
                          {focusedCandidate.reviewState === "approved" ? "승인 취소" : "사용할게요"} <kbd>A</kbd>
                        </button>
                      </div>
                    )}

                    {focusedCandidate !== null && (
                      <div className="ex-trim" aria-label="시작·끝 다듬기">
                        {([
                          { edge: "시작", shift: "SHIFT_START", fromPlayer: "SET_START_FROM_PLAYER" },
                          { edge: "끝", shift: "SHIFT_END", fromPlayer: "SET_END_FROM_PLAYER" },
                        ] as const).map(({ edge, shift, fromPlayer }) => (
                          <Fragment key={edge}>
                            <span className="ex-trim-label">{edge}</span>
                            {([-5_000, 5_000] as const).map((deltaMs) => (
                              <button
                                key={deltaMs}
                                type="button"
                                aria-label={`후보 ${previewCandidateNumber} ${edge}을 ${deltaMs < 0 ? "앞" : "뒤"}으로`}
                                onClick={() => nudgeCandidateBoundary(focusedCandidate, shift, deltaMs)}
                              >
                                {deltaMs < 0 ? "−" : "+"}{Math.abs(deltaMs) / 1_000}초
                              </button>
                            ))}
                            <button
                              type="button"
                              disabled={sourcePreviewUrl === null}
                              onClick={() => setBoundaryFromPlayerPosition(focusedCandidate, fromPlayer)}
                            >
                              재생 위치로
                            </button>
                            <span className="ex-trim-sep" aria-hidden="true" />
                          </Fragment>
                        ))}
                        <button
                          type="button"
                          disabled={!focusedBoundaryTouched || !focusedRangeAdjusted}
                          onClick={() => resetCandidateBoundary(focusedCandidate)}
                        >
                          AI 제안으로
                        </button>
                        {boundaryFeedback?.candidateId === focusedCandidate.id && (
                          <p
                            className="ex-trim-feedback"
                            data-tone={boundaryFeedback.tone}
                            role="status"
                            aria-live="polite"
                          >
                            {boundaryFeedback.message}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Per-candidate outputs sit with the player, not in the
                        dossier: they act on this clip, the way trim does. */}
                    {focusedCandidate !== null && (
                      <div className="ex-outrow">
                        <button
                          type="button"
                          aria-label={`후보 ${previewCandidateNumber} 클립 파일 다운로드`}
                          disabled={
                            sourceFile === null ||
                            clipBatchStatus === "rendering" ||
                            clipDownloadStatusById[focusedCandidate.id] === "rendering"
                          }
                          onClick={() => downloadCandidateClip(focusedCandidate)}
                        >
                          {clipDownloadStatusById[focusedCandidate.id] === "rendering"
                            ? `클립 ${Math.round((clipDownloadProgressById[focusedCandidate.id] ?? 0) * 100)}%`
                            : clipDownloadStatusById[focusedCandidate.id] === "completed"
                              ? "클립 다시 받기"
                              : "클립 받기"}
                        </button>
                        <button
                          type="button"
                          aria-label={`후보 ${previewCandidateNumber} 자막 파일 다운로드`}
                          title={
                            focusedSubtitleAvailability.available
                              ? undefined
                              : focusedSubtitleAvailability.reason
                          }
                          disabled={!focusedSubtitleAvailability.available}
                          onClick={() => void downloadCandidateSubtitles(focusedCandidate)}
                        >
                          자막 .srt
                        </button>
                        {clipDownloadErrorById[focusedCandidate.id] !== undefined && (
                          <p className="ex-trim-feedback" data-tone="danger" role="alert">
                            {clipDownloadErrorById[focusedCandidate.id]}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="ex-dossier">
                  <div
                    className="ex-dossier-main"
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
                    const boundaryTouched = (boundaryRevision?.revision ?? 0) > 0;
                    const approvedAfterEdit =
                      candidate.reviewState === "approved" &&
                      candidate.approvedBoundaryRevision !== null &&
                      (boundaryRevision?.revision ?? 0) > candidate.approvedBoundaryRevision;
                    const aiProjection = candidateAiProjectionById[candidate.id];
                    const candidateSignalTiles = buildCandidateSignalTiles(candidate);
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
                        <div
                          className="ex-ttl"
                          id={candidateElementId("candidate-title", candidate.id)}
                        >
                          {editingCandidateTitle ? (
                            <input
                              className="ex-ttl-input"
                              autoFocus
                              maxLength={80}
                              value={candidateTitleById[candidate.id] ?? evidenceExplanation.headline}
                              aria-label={ui("후보 제목 편집", "Edit candidate title")}
                              onChange={(event) => {
                                const nextValue = event.target.value;
                                setCandidateTitleById((current) => ({
                                  ...current,
                                  [candidate.id]: nextValue,
                                }));
                              }}
                              onBlur={() => setEditingCandidateTitle(false)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === "Escape") {
                                  event.currentTarget.blur();
                                }
                              }}
                            />
                          ) : (
                            <h4>{candidateTitleById[candidate.id] ?? evidenceExplanation.headline}</h4>
                          )}
                          <button
                            type="button"
                            className="ex-ttl-edit"
                            aria-label={ui("후보 제목 편집", "Edit candidate title")}
                            onClick={() => setEditingCandidateTitle((current) => !current)}
                          >
                            {editingCandidateTitle ? ui("완료", "Done") : "✎"}
                          </button>
                        </div>
                        <div className="ex-meta">
                          <span className="ex-tc">
                            {formatDuration(effectiveRange.startMs)} – {formatDuration(effectiveRange.endMs)}
                            {" · "}
                            {Math.round((effectiveRange.endMs - effectiveRange.startMs) / 1_000)}초
                          </span>
                          <span
                            className="ex-badge"
                            data-kind={candidate.reviewState === "approved" ? "ok" : "st"}
                          >
                            {candidate.reviewState === "approved"
                              ? "사용하기로 함"
                              : candidate.reviewState === "rejected"
                                ? "제외함"
                                : "검토 전"}
                          </span>
                          {aiProjection !== undefined && (
                            <span className="ex-badge" data-kind="ai">
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
                        {candidateSignalTiles.length > 0 && (
                          <div className="ex-signals" aria-label="AI가 이 후보를 고른 신호">
                            {candidateSignalTiles.map((tile) => (
                              <div className="ex-signal" data-signal={tile.kind} key={tile.kind}>
                                <span className="ex-signal-k">{tile.label}</span>
                                <strong>
                                  {tile.value}
                                  <small>{tile.unit}</small>
                                </strong>
                                <span className="ex-signal-n">{tile.note}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div
                          className="ex-bmk"
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
                          <span className="ex-bmk-keys">
                            <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> · <kbd>D</kbd> 순환
                          </span>
                        </div>
                        {dossierTab === "summary" && (
                          <div
                            className="ex-pane"
                            data-pane="summary"
                            role="tabpanel"
                            aria-labelledby={candidateElementId("dossier-tab-summary", candidate.id)}
                          >
                            <div className="ex-lede">
                              <p className="ex-pane-label">왜 이 장면인가</p>
                              <p>{evidenceExplanation.whyWorthReviewing.text}</p>
                            </div>
                            <div className="ex-quote">
                              <p className="ex-pane-label">확인한 대사</p>
                              <blockquote>{candidateContext.transcriptKo}</blockquote>
                            </div>
                            <p className="ex-caveat">
                              AI 단서는 참고용이에요. 재생해서 직접 확인한 뒤 판단해 주세요.
                            </p>
                          </div>
                        )}
                        {dossierTab === "context" && (
                          <div
                            className="ex-pane"
                            data-pane="context"
                            role="tabpanel"
                            aria-labelledby={candidateElementId("dossier-tab-context", candidate.id)}
                          >
                            <p className="ex-pane-label">구간 흐름</p>
                            <div className="ex-step">
                              <span className="ex-step-dot" aria-hidden="true" />
                              <div>
                                <div className="ex-step-label">직전</div>
                                <p>{candidateContext.beforeContextKo}</p>
                              </div>
                            </div>
                            <div className="ex-step" data-now="true">
                              <span className="ex-step-dot" aria-hidden="true" />
                              <div>
                                <div className="ex-step-label">지금 이 장면</div>
                                <p>
                                  {candidateGeminiInsight?.eventSummaryKo ??
                                    candidateContext.contextVerdictKo}
                                </p>
                              </div>
                            </div>
                            <div className="ex-step">
                              <span className="ex-step-dot" aria-hidden="true" />
                              <div>
                                <div className="ex-step-label">직후</div>
                                <p>{candidateContext.afterContextKo}</p>
                              </div>
                            </div>
                            <p className="ex-caveat">
                              주제 구간: {candidateContext.topicContextKo}
                            </p>
                          </div>
                        )}
                        {dossierTab === "clues" && (
                        <div
                          className="ex-pane"
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
                            <div className="ex-pane-badges">
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
                          {/*
                            근거 칩은 "무엇이 관찰됐는가"만 말한다. 원시 신호 수치는 칩에
                            넣지 않는다.

                            - rankPercentile(오디오·영상)은 내부 우선순위 계산 전용이다. 이
                              순위는 false signal이 많고 자막판·장면 전환·컷 같은 특정 상황에
                              몰려 발생하는데, "상위 N%"로 찍히면 편집자가 근거 품질 등급으로
                              읽는다.
                            - sceneChangeStrength도 같은 이유의 연장선이다. 기준 축이 없는
                              무단위 실수라 "화면 맥락 변화 0.72"를 보고 편집자가 할 수 있는
                              판단이 없고, 값이 없을 때는 "화면 맥락 변화 0.00"이라는 최악의
                              문구가 됐다. 강도 없이 관찰 사실만 남기면 두 문제가 함께 없어진다.

                            남긴 수치는 rmsLiftRatio(평소 음량의 N배)와 채팅 집계뿐이다. 둘 다
                            분모가 문구 안에 적혀 있어 그 자체로 읽힌다. 정보량이나 진행감을
                            이유로 나머지를 되살리지 말 것.
                          */}
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
                            </>
                          )}
                          {candidate.evidence.visual !== undefined && (
                            <span className="rh-evidence" data-signal="visual">
                              화면 변화 감지
                            </span>
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

                  {/* Paging used to be two text buttons, which made every jump
                      blind. The run already stores a frame per candidate, so
                      the strip shows the moments themselves and their state. */}
                  {contextualCandidatePublicationReady && orderedCandidates.length > 1 && (
                    <div className="ex-film" aria-label="후보 건너뛰기">
                      {orderedCandidates.map((filmCandidate, filmIndex) => {
                        const frame = candidateTimelineFramesById[filmCandidate.id]?.[0];
                        return (
                          <button
                            type="button"
                            className="ex-film-item"
                            key={filmCandidate.id}
                            data-state={filmCandidate.reviewState}
                            data-current={filmCandidate.id === focusedCandidateId}
                            aria-current={filmCandidate.id === focusedCandidateId}
                            aria-label={`후보 ${filmIndex + 1} · ${formatDuration(filmCandidate.peakMs)}`}
                            onClick={() => focusCandidateForReview(filmCandidate)}
                          >
                            <span
                              className="ex-film-thumb"
                              style={
                                frame === undefined
                                  ? undefined
                                  : { backgroundImage: `url(data:${frame.mimeType};base64,${frame.dataBase64})` }
                              }
                            />
                            <span className="ex-film-tc">{formatDuration(filmCandidate.peakMs)}</span>
                          </button>
                        );
                      })}
                    </div>
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
                      className="btn btn-primary rh-primary-action rh-export-main-action"
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
                    <div className="rh-export-secondary-row">
                      <button
                        className="btn btn-secondary"
                        type="button"
                        disabled={approvedCount === 0}
                        onClick={() => exportCandidates("csv")}
                      >
                        Excel용 시간표 (.csv)
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
      </div>
        </div>
      </div>

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
