/**
 * Adapter: current App facts -> the pre-publication FrontSurface view model.
 *
 * This module deliberately owns no pipeline state. It only projects facts that
 * have already been committed by SourceCheck, AnalysisRun, channel
 * preanalysis, and the broadcast-context pipeline. In particular:
 *
 * - `transcript-ready` never implies `context-ready`.
 * - topic ranges are broadcast structure, not clip candidates.
 * - candidate counts, markers, and cards do not exist in this model. They are
 *   published only by ReviewStage after the final publication gate.
 * - a recoverable failure renders the last durable checkpoint, never an
 *   uncommitted optimistic ratio.
 */
import type { AnalysisLanguage } from "../domain/analysisLanguage";
import { formatBytes, formatDuration } from "../media/localMediaPreflight";

export type FrontLanguage = AnalysisLanguage;

export const FRONT_ANALYSIS_PHASES = [
  "fast-pass",
  "broadcast-context",
  "candidate-detail",
] as const;

export type FrontAnalysisPhase = (typeof FRONT_ANALYSIS_PHASES)[number];

export type FrontSurfaceMode =
  | "empty"
  | "inspecting"
  | "ready"
  | "running"
  | "recoverable"
  | "zero";

export type FrontSourceStatus =
  | "selected"
  | "checking"
  | "committing"
  | "ready"
  | "degraded"
  | "blocked"
  | "failed"
  | "interrupted";

export interface FrontSourceInput {
  readonly title: string;
  readonly durationMs?: number | null;
  readonly sizeBytes?: number | null;
  readonly status: FrontSourceStatus;
}

export type FrontPipelineStatus =
  | "idle"
  | "starting"
  | "running"
  | "pausing"
  | "paused"
  | "resuming"
  | "finalizing"
  | "completing"
  | "completed"
  | "cancelled"
  | "failed"
  | "interrupted";

export type FrontCheckpointStatus = "none" | "saving" | "saved";

export interface FrontCheckpointInput {
  readonly status: FrontCheckpointStatus;
  /** The fraction proven durable by readback, not the current worker ratio. */
  readonly ratio: number | null;
}

export interface FrontProgressTrackInput {
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly ratio: number | null;
}

export interface FrontProgressInput {
  /** One overall progress axis. Null means the current unit cannot be counted. */
  readonly ratio: number | null;
  readonly indeterminate: boolean;
  readonly remainingMs?: number | null;
  /** Already-localized live detail from the owning pipeline, when available. */
  readonly activityLabel?: string | null;
  readonly checkpoint: FrontCheckpointInput;
  readonly tracks?: readonly FrontProgressTrackInput[];
}

export interface FrontPipelineInput {
  readonly status: FrontPipelineStatus;
  readonly phase: FrontAnalysisPhase | null;
  /** Completed is terminal only when the publication certificate proves an empty result. */
  readonly terminalOutcome: "verified-empty" | null;
  readonly progress: FrontProgressInput;
}

export type FrontPreanalysisInputStatus =
  | "idle"
  | "checking"
  | "ready"
  | "unavailable"
  | "incompatible"
  | "failed";

export interface FrontPreanalysisLaneInput {
  readonly status: FrontPreanalysisInputStatus;
  /** A UI-safe receipt summary. Provider errors and secrets must not enter it. */
  readonly detail?: string | null;
  readonly count?: number | null;
}

export interface FrontTranscriptPreanalysisInput
  extends FrontPreanalysisLaneInput {
  readonly transcriptCount?: number | null;
  readonly chapterCount?: number | null;
}

export interface FrontPreanalysisInput {
  readonly videoIdentity: FrontPreanalysisLaneInput;
  readonly transcriptChapters: FrontTranscriptPreanalysisInput;
  readonly wholeContext: FrontPreanalysisLaneInput;
}

export type FrontTopicFamily =
  | "event-reaction"
  | "achievement-payoff"
  | "flow-transition"
  | "general-context";

export interface FrontTopicRangeInput {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly family?: FrontTopicFamily;
}

export type FrontRecoveryActionId =
  | "choose-source"
  | "retry-source-check"
  | "resume-analysis"
  | "retry-transcript"
  | "retry-context"
  | "retry-candidate-detail"
  | "retry-save";

export interface FrontRecoveryInput {
  readonly actionId: FrontRecoveryActionId;
  /** A sanitized user-facing reason. Raw provider errors are not accepted here. */
  readonly safeDetail?: string | null;
}

/**
 * Terminal App facts used to choose the one recovery boundary shown up front.
 * Active work must not be projected as blocked before it reaches this input.
 */
export interface FrontRecoveryBoundaryInput {
  readonly sourceReady: boolean;
  readonly retainedSourceAvailable: boolean;
  readonly sourceBlocked: boolean;
  readonly transcriptBlocked: boolean;
  readonly contextBlocked: boolean;
  readonly candidateDetailBlocked: boolean;
  readonly saveBlocked: boolean;
  readonly pipelineContextBlocked: boolean;
  readonly runCompletedWithGaps: boolean;
  readonly contextComplete: boolean;
  readonly runNeedsResume: boolean;
}

export function selectFrontRecoveryAction(
  input: FrontRecoveryBoundaryInput,
): FrontRecoveryActionId | null {
  if (!input.sourceReady && input.sourceBlocked) {
    return input.retainedSourceAvailable
      ? "retry-source-check"
      : "choose-source";
  }
  if (input.transcriptBlocked) return "retry-transcript";
  if (input.contextBlocked) return "retry-context";
  if (input.candidateDetailBlocked) return "retry-candidate-detail";
  if (input.saveBlocked) return "retry-save";
  if (input.pipelineContextBlocked) return "retry-context";
  if (input.runCompletedWithGaps) {
    return input.contextComplete
      ? "retry-candidate-detail"
      : "retry-context";
  }
  return input.runNeedsResume ? "resume-analysis" : null;
}

export interface FrontSurfaceModelInput {
  readonly language: FrontLanguage;
  readonly source: FrontSourceInput | null;
  readonly pipeline: FrontPipelineInput | null;
  readonly preanalysis?: FrontPreanalysisInput | null;
  readonly topics?: readonly FrontTopicRangeInput[];
  readonly recovery?: FrontRecoveryInput | null;
}

export interface FrontStageViewModel {
  readonly phase: FrontAnalysisPhase | null;
  readonly index: 1 | 2 | 3 | 4;
  readonly total: 4;
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
}

export interface FrontSourceViewModel {
  readonly title: string;
  readonly durationMs: number | null;
  readonly durationLabel: string | null;
  readonly sizeBytes: number | null;
  readonly sizeLabel: string | null;
  readonly status: FrontSourceStatus;
}

export type FrontProgressDisplayBasis = "live" | "checkpoint";

export interface FrontProgressViewModel {
  readonly ratio: number | null;
  readonly percent: number | null;
  readonly indeterminate: boolean;
  readonly displayBasis: FrontProgressDisplayBasis;
  readonly remainingLabel: string | null;
  readonly currentTask: string;
  readonly checkpointLabel: string;
}

export type FrontPreanalysisViewStatus =
  | "idle"
  | "checking"
  | "ready"
  | "unavailable"
  | "incompatible"
  | "error";

export type FrontPreanalysisLaneId =
  | "video-identity"
  | "transcript-chapters"
  | "whole-context";

export interface FrontPreanalysisLaneViewModel {
  readonly id: FrontPreanalysisLaneId;
  readonly label: string;
  readonly state: FrontPreanalysisViewStatus;
  readonly detail: string;
  readonly count: number | null;
}

export interface FrontTopicRangeViewModel {
  readonly id: string;
  /** AI output is preserved verbatim. The adapter neither translates nor rewrites it. */
  readonly title: string;
  /** AI output is preserved verbatim. The adapter neither translates nor rewrites it. */
  readonly summary: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly startRatio: number;
  readonly endRatio: number;
  readonly family: FrontTopicFamily;
}

export interface FrontTopicStatusViewModel {
  readonly state: "hidden" | "waiting" | "available" | "empty";
  readonly label: string;
}

export interface FrontRecoveryViewModel {
  readonly title: string;
  readonly detail: string;
  /** Exactly one primary action is intentionally exposed. */
  readonly primaryAction: {
    readonly id: FrontRecoveryActionId;
    readonly label: string;
  };
}

export interface FrontProgressTrackViewModel {
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly ratio: number | null;
}

export interface FrontSurfaceViewModel {
  readonly mode: FrontSurfaceMode;
  readonly language: FrontLanguage;
  readonly stage: FrontStageViewModel;
  readonly source: FrontSourceViewModel | null;
  readonly progress: FrontProgressViewModel | null;
  readonly preanalysis: readonly FrontPreanalysisLaneViewModel[];
  readonly topics: readonly FrontTopicRangeViewModel[];
  readonly topicStatus: FrontTopicStatusViewModel;
  readonly tracks: readonly FrontProgressTrackViewModel[];
  readonly recovery: FrontRecoveryViewModel | null;
}

const SOURCE_STATUSES = new Set<FrontSourceStatus>([
  "selected",
  "checking",
  "committing",
  "ready",
  "degraded",
  "blocked",
  "failed",
  "interrupted",
]);

const PIPELINE_STATUSES = new Set<FrontPipelineStatus>([
  "idle",
  "starting",
  "running",
  "pausing",
  "paused",
  "resuming",
  "finalizing",
  "completing",
  "completed",
  "cancelled",
  "failed",
  "interrupted",
]);

const PREANALYSIS_STATUSES = new Set<FrontPreanalysisInputStatus>([
  "idle",
  "checking",
  "ready",
  "unavailable",
  "incompatible",
  "failed",
]);

const TOPIC_FAMILIES = new Set<FrontTopicFamily>([
  "event-reaction",
  "achievement-payoff",
  "flow-transition",
  "general-context",
]);

const RECOVERY_ACTION_IDS = new Set<FrontRecoveryActionId>([
  "choose-source",
  "retry-source-check",
  "resume-analysis",
  "retry-transcript",
  "retry-context",
  "retry-candidate-detail",
  "retry-save",
]);

const ACTIVE_PIPELINE_STATUSES = new Set<FrontPipelineStatus>([
  "starting",
  "running",
  "pausing",
  "resuming",
  "finalizing",
  "completing",
]);

const RECOVERABLE_PIPELINE_STATUSES = new Set<FrontPipelineStatus>([
  "paused",
  "cancelled",
  "failed",
  "interrupted",
]);

function ui(language: FrontLanguage, ko: string, en: string): string {
  return language === "en" ? en : ko;
}

function normalizeLanguage(language: FrontLanguage): FrontLanguage {
  return language === "en" ? "en" : "ko";
}

function finiteNonNegative(value: number | null | undefined): number | null {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    return null;
  }
  return value;
}

function finitePositiveInteger(value: number | null | undefined): number | null {
  const normalized = finiteNonNegative(value);
  return normalized === null || normalized <= 0
    ? null
    : Math.floor(normalized);
}

function finiteUnit(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

function normalizedSource(source: FrontSourceInput | null): FrontSourceViewModel | null {
  if (source === null) return null;
  const status = SOURCE_STATUSES.has(source.status) ? source.status : "failed";
  const durationMs = finiteNonNegative(source.durationMs);
  const sizeBytes = finiteNonNegative(source.sizeBytes);
  const title = source.title.trim();
  return {
    title: title.length > 0 ? title : "—",
    durationMs,
    durationLabel: durationMs === null ? null : formatDuration(durationMs),
    sizeBytes,
    sizeLabel: sizeBytes === null ? null : formatBytes(sizeBytes),
    status,
  };
}

function normalizedPipeline(
  pipeline: FrontPipelineInput | null,
): FrontPipelineInput | null {
  if (pipeline === null) return null;
  const status = PIPELINE_STATUSES.has(pipeline.status)
    ? pipeline.status
    : "failed";
  const phase =
    pipeline.phase !== null && FRONT_ANALYSIS_PHASES.includes(pipeline.phase)
      ? pipeline.phase
      : null;
  return {
    status,
    phase,
    terminalOutcome:
      pipeline.terminalOutcome === "verified-empty" ? "verified-empty" : null,
    progress: pipeline.progress,
  };
}

function sourceIsReady(source: FrontSourceViewModel | null): boolean {
  return source?.status === "ready" || source?.status === "degraded";
}

function sourceNeedsRecovery(source: FrontSourceViewModel | null): boolean {
  return (
    source?.status === "blocked" ||
    source?.status === "failed" ||
    source?.status === "interrupted"
  );
}

function deriveMode(
  source: FrontSourceViewModel | null,
  pipeline: FrontPipelineInput | null,
  explicitRecovery: FrontRecoveryInput | null,
): FrontSurfaceMode {
  if (explicitRecovery !== null) return "recoverable";

  if (pipeline !== null && pipeline.status !== "idle") {
    if (!sourceIsReady(source) || pipeline.phase === null) return "recoverable";
    if (pipeline.status === "completed") {
      return pipeline.terminalOutcome === "verified-empty" ? "zero" : "recoverable";
    }
    if (RECOVERABLE_PIPELINE_STATUSES.has(pipeline.status)) return "recoverable";
    if (ACTIVE_PIPELINE_STATUSES.has(pipeline.status)) return "running";
  }

  if (sourceNeedsRecovery(source)) return "recoverable";
  if (source === null) return "empty";
  if (
    source.status === "selected" ||
    source.status === "checking" ||
    source.status === "committing"
  ) {
    return "inspecting";
  }
  return sourceIsReady(source) ? "ready" : "empty";
}

function stageCopy(
  language: FrontLanguage,
  mode: FrontSurfaceMode,
  phase: FrontAnalysisPhase | null,
): FrontStageViewModel {
  if (mode === "empty") {
    return {
      phase: null,
      index: 1,
      total: 4,
      eyebrow: ui(language, "분석 준비", "Analysis setup"),
      title: ui(language, "분석할 방송을 골라 주세요", "Choose a broadcast to analyze"),
      description: ui(
        language,
        "원본을 고르면 재생 가능 여부와 길이를 먼저 확인해요.",
        "Choose the original video and its playback and duration will be checked first.",
      ),
    };
  }
  if (mode === "inspecting") {
    return {
      phase: null,
      index: 1,
      total: 4,
      eyebrow: ui(language, "원본 확인", "Source inspection"),
      title: ui(language, "이 영상으로 분석할 수 있는지 확인하고 있어요", "Checking whether this video can be analyzed"),
      description: ui(
        language,
        "확인이 끝나면 같은 자리에서 바로 분석을 시작할 수 있어요.",
        "When inspection finishes, analysis can start from this same workspace.",
      ),
    };
  }
  if (mode === "recoverable" && phase === null) {
    return {
      phase: null,
      index: 1,
      total: 4,
      eyebrow: ui(language, "작업 복구", "Recovery needed"),
      title: ui(language, "안전하게 이어갈 지점을 확인해 주세요", "Choose the safe point to continue"),
      description: ui(
        language,
        "완료된 기록은 그대로 두고 필요한 작업 하나만 다시 시작해요.",
        "Completed records are kept while only the required work is restarted.",
      ),
    };
  }
  if (mode === "ready") {
    return {
      phase: "fast-pass",
      index: 1,
      total: 4,
      eyebrow: ui(language, "분석 준비 완료", "Ready to analyze"),
      title: ui(language, "AI 분석을 시작할 수 있어요", "AI analysis is ready to start"),
      description: ui(
        language,
        "빠른 탐색부터 시작해 방송 전체 맥락과 후보별 근거까지 이어서 확인해요.",
        "Analysis proceeds from a fast scan to whole-broadcast context and candidate evidence.",
      ),
    };
  }

  if (mode === "zero") {
    return {
      phase: "candidate-detail",
      index: 2,
      total: 4,
      eyebrow: ui(language, "분석 완료", "Analysis complete"),
      title: ui(
        language,
        "최종 후보로 공개할 장면이 없어요",
        "No moments passed final publication",
      ),
      description: ui(
        language,
        "전체 분석과 완료 증명을 확인했지만 최종 공개 기준을 모두 통과한 장면은 없었습니다.",
        "The full analysis and completion receipt were verified, but no moment passed every publication requirement.",
      ),
    };
  }

  if (phase === "fast-pass") {
    return {
      phase,
      index: 2,
      total: 4,
      eyebrow: ui(language, "1단계 · 빠른 탐색", "Step 1 · Fast scan"),
      title: ui(language, "방송 전체의 반응 신호를 훑고 있어요", "Scanning reaction signals across the broadcast"),
      description: ui(
        language,
        "화면·오디오와 선택한 채팅 근거를 시간축 전체에서 확인해요.",
        "Visual, audio, and optional chat evidence are checked across the full timeline.",
      ),
    };
  }
  if (phase === "broadcast-context") {
    return {
      phase,
      index: 2,
      total: 4,
      eyebrow: ui(language, "2단계 · 전체 맥락", "Step 2 · Whole context"),
      title: ui(language, "방송 흐름과 주제 구간을 연결하고 있어요", "Connecting the broadcast flow and topic ranges"),
      description: ui(
        language,
        "대사·챕터와 등장인물 근거를 바탕으로 앞뒤 사건을 함께 해석해요.",
        "Dialogue, chapters, and participant evidence are used to interpret surrounding events.",
      ),
    };
  }
  return {
    phase,
    index: 2,
    total: 4,
    eyebrow: ui(language, "3단계 · 후보 종합", "Step 3 · Candidate synthesis"),
    title: ui(language, "화면·오디오·대사로 후보를 완성하고 있어요", "Completing candidates with visual, audio, and dialogue evidence"),
    description: ui(
      language,
      "각 구간의 네 화면과 전체 방송 맥락이 모두 맞는지 확인한 뒤 검토 화면을 열어요.",
      "The review workspace opens only after four frames and whole-broadcast context are verified for each segment.",
    ),
  };
}

function fallbackActivity(
  language: FrontLanguage,
  status: FrontPipelineStatus,
  phase: FrontAnalysisPhase | null,
): string {
  if (status === "starting") {
    return ui(language, "분석 실행과 저장 지점을 준비하고 있어요", "Preparing the analysis run and checkpoint");
  }
  if (status === "pausing") {
    return ui(language, "새 작업을 멈추고 현재 결과를 저장하고 있어요", "Stopping new work and saving current results");
  }
  if (status === "paused") {
    return ui(language, "저장된 지점에서 다시 이어갈 수 있어요", "Analysis can resume from the saved checkpoint");
  }
  if (status === "resuming") {
    return ui(language, "저장된 지점에서 분석을 다시 준비하고 있어요", "Preparing to resume from the saved checkpoint");
  }
  if (status === "finalizing" || status === "completing") {
    return ui(language, "결과를 안전하게 저장하고 다시 확인하고 있어요", "Saving and verifying the result");
  }
  if (status === "cancelled" || status === "failed" || status === "interrupted") {
    return ui(language, "저장된 작업은 남아 있으며 여기서 다시 이어갈 수 있어요", "Saved work remains available to resume");
  }
  if (phase === "broadcast-context") {
    return ui(language, "대사와 화면 단서를 방송 흐름에 연결하고 있어요", "Connecting dialogue and visual evidence to the broadcast flow");
  }
  if (phase === "candidate-detail") {
    return ui(language, "화면이 준비된 구간부터 후보별 근거를 확인하고 있어요", "Checking candidate evidence as each frame set becomes ready");
  }
  return ui(language, "방송 전체에서 반응 신호를 찾고 있어요", "Finding reaction signals across the broadcast");
}

function formatRemaining(language: FrontLanguage, value: number | null): string | null {
  if (value === null) return null;
  const minutes = Math.max(1, Math.ceil(value / 60_000));
  if (minutes < 60) {
    return ui(language, `약 ${minutes}분 남음`, `About ${minutes} min remaining`);
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0
    ? ui(language, `약 ${hours}시간 남음`, `About ${hours} hr remaining`)
    : ui(
        language,
        `약 ${hours}시간 ${remainder}분 남음`,
        `About ${hours} hr ${remainder} min remaining`,
      );
}

function checkpointLabel(
  language: FrontLanguage,
  checkpoint: FrontCheckpointInput,
): string {
  const ratio = finiteUnit(checkpoint.ratio);
  if (checkpoint.status === "saving") {
    return ui(language, "저장 지점을 확인하고 있어요", "Verifying the next checkpoint");
  }
  if (checkpoint.status === "saved") {
    return ratio === null
      ? ui(language, "완료된 작업은 안전하게 저장됐어요", "Completed work is safely saved")
      : ui(
          language,
          `${Math.round(ratio * 100)}%까지 안전하게 저장됐어요`,
          `Safely saved through ${Math.round(ratio * 100)}%`,
        );
  }
  return ui(language, "아직 저장된 분석 지점이 없어요", "No analysis checkpoint has been saved yet");
}

function buildProgress(
  language: FrontLanguage,
  mode: FrontSurfaceMode,
  pipeline: FrontPipelineInput | null,
): FrontProgressViewModel | null {
  if (pipeline === null || pipeline.status === "idle") return null;

  const liveRatio = finiteUnit(pipeline.progress.ratio);
  const checkpointRatio = finiteUnit(pipeline.progress.checkpoint.ratio);
  const displayBasis: FrontProgressDisplayBasis =
    mode === "recoverable" ? "checkpoint" : "live";
  const ratio = displayBasis === "checkpoint" ? checkpointRatio : liveRatio;
  const activity = pipeline.progress.activityLabel?.trim();
  const remainingMs = finiteNonNegative(pipeline.progress.remainingMs);
  return {
    ratio,
    percent: ratio === null ? null : Math.round(ratio * 100),
    indeterminate:
      mode === "running" &&
      (pipeline.progress.indeterminate || liveRatio === null),
    displayBasis,
    remainingLabel:
      mode === "running" ? formatRemaining(language, remainingMs) : null,
    currentTask:
      mode === "running" && activity !== undefined && activity.length > 0
        ? activity
        : fallbackActivity(language, pipeline.status, pipeline.phase),
    checkpointLabel: checkpointLabel(language, pipeline.progress.checkpoint),
  };
}

function normalizePreanalysisStatus(
  value: FrontPreanalysisInputStatus,
): FrontPreanalysisViewStatus {
  if (!PREANALYSIS_STATUSES.has(value)) return "error";
  return value === "failed" ? "error" : value;
}

function safeDetail(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? null : trimmed;
}

function preanalysisDetail(
  language: FrontLanguage,
  id: FrontPreanalysisLaneId,
  state: FrontPreanalysisViewStatus,
  input: FrontPreanalysisLaneInput,
): string {
  const supplied = safeDetail(input.detail);
  if (supplied !== null) return supplied;
  if (state === "checking") {
    return ui(language, "연결할 수 있는 저장 자료를 확인하고 있어요", "Checking for reusable prepared data");
  }
  if (state === "ready") {
    if (id === "video-identity") {
      return ui(language, "현재 원본과 일치하는 다시보기를 확인했어요", "A replay matching this source was verified");
    }
    if (id === "whole-context") {
      return ui(language, "저장된 방송 흐름 자료를 현재 분석에 연결할 수 있어요", "Saved broadcast-flow data can be attached to this analysis");
    }
    return ui(language, "대사와 챕터 자료가 준비됐어요", "Transcript and chapter data are ready");
  }
  if (state === "incompatible") {
    return ui(language, "영상 시간축이 달라 이 원본에는 연결하지 않아요", "The saved timeline does not match this source");
  }
  if (state === "unavailable") {
    return ui(language, "준비된 자료가 없어 현재 영상에서 직접 확인해요", "No prepared data is available, so this video will be analyzed directly");
  }
  if (state === "error") {
    return ui(language, "자료 상태를 확정하지 못해 준비 완료로 표시하지 않아요", "This data was not verified and is not shown as ready");
  }
  return ui(language, "아직 확인하지 않았어요", "Not checked yet");
}

function numberLabel(language: FrontLanguage, value: number): string {
  return value.toLocaleString(language === "en" ? "en-US" : "ko-KR");
}

function buildPreanalysis(
  language: FrontLanguage,
  input: FrontPreanalysisInput | null,
): readonly FrontPreanalysisLaneViewModel[] {
  const empty: FrontPreanalysisLaneInput = { status: "idle" };
  const identityInput = input?.videoIdentity ?? empty;
  const transcriptInput = input?.transcriptChapters ?? empty;
  const contextInput = input?.wholeContext ?? empty;
  const identityState = normalizePreanalysisStatus(identityInput.status);
  const requestedTranscriptState = normalizePreanalysisStatus(
    transcriptInput.status,
  );
  const transcriptState: FrontPreanalysisViewStatus =
    requestedTranscriptState === "ready" && identityState !== "ready"
      ? "error"
      : requestedTranscriptState;
  const requestedContextState = normalizePreanalysisStatus(contextInput.status);
  const contextState: FrontPreanalysisViewStatus =
    requestedContextState === "ready" &&
    (identityState !== "ready" || transcriptState !== "ready")
      ? "error"
      : requestedContextState;

  const transcriptCount = finitePositiveInteger(
    input?.transcriptChapters.transcriptCount,
  );
  const chapterCount = finitePositiveInteger(
    input?.transcriptChapters.chapterCount,
  );
  const explicitTranscriptDetail = safeDetail(transcriptInput.detail);
  let transcriptDetail = preanalysisDetail(
    language,
    "transcript-chapters",
    transcriptState,
    transcriptInput,
  );
  if (
    transcriptState === "ready" &&
    explicitTranscriptDetail === null &&
    (transcriptCount !== null || chapterCount !== null)
  ) {
    const parts: string[] = [];
    if (transcriptCount !== null) {
      parts.push(
        ui(
          language,
          `대사 ${numberLabel(language, transcriptCount)}개`,
          `${numberLabel(language, transcriptCount)} transcript lines`,
        ),
      );
    }
    if (chapterCount !== null) {
      parts.push(
        ui(
          language,
          `챕터 ${numberLabel(language, chapterCount)}개`,
          `${numberLabel(language, chapterCount)} chapters`,
        ),
      );
    }
    transcriptDetail = parts.join(" · ");
  }

  return [
    {
      id: "video-identity",
      label: ui(language, "영상 식별", "Video identity"),
      state: identityState,
      detail: preanalysisDetail(
        language,
        "video-identity",
        identityState,
        identityInput,
      ),
      count: finitePositiveInteger(identityInput.count),
    },
    {
      id: "transcript-chapters",
      label: ui(language, "대사·챕터", "Transcript & chapters"),
      state: transcriptState,
      detail:
        transcriptState === "error" && requestedTranscriptState === "ready"
          ? ui(
              language,
              "영상 식별이 확정되지 않아 이 대사·챕터를 연결하지 않았어요",
              "Transcript and chapters were not attached because video identity is unverified",
            )
          : transcriptDetail,
      count: chapterCount,
    },
    {
      id: "whole-context",
      label: ui(language, "전체 맥락", "Whole context"),
      state: contextState,
      detail:
        contextState === "error" && requestedContextState === "ready"
          ? ui(
              language,
              "영상 식별과 대사·챕터가 모두 준비되기 전에는 맥락 완료로 표시하지 않아요",
              "Whole context is not shown as ready until identity, transcript, and chapters are ready",
            )
          : preanalysisDetail(
              language,
              "whole-context",
              contextState,
              contextInput,
            ),
      count: finitePositiveInteger(contextInput.count),
    },
  ];
}

function topicRanges(
  input: readonly FrontTopicRangeInput[],
  durationMs: number | null,
  visible: boolean,
): readonly FrontTopicRangeViewModel[] {
  if (!visible || durationMs === null || durationMs <= 0) return [];
  const seen = new Set<string>();
  const topics: FrontTopicRangeViewModel[] = [];
  for (const topic of input) {
    const id = topic.id.trim();
    if (
      id.length === 0 ||
      seen.has(id) ||
      topic.title.trim().length === 0 ||
      !Number.isFinite(topic.startMs) ||
      !Number.isFinite(topic.endMs)
    ) {
      continue;
    }
    const startMs = Math.max(0, Math.min(durationMs, topic.startMs));
    const endMs = Math.max(0, Math.min(durationMs, topic.endMs));
    if (endMs <= startMs) continue;
    seen.add(id);
    topics.push({
      id,
      // Do not trim or translate provider text. Validation above only decides
      // whether the record is renderable.
      title: topic.title,
      summary: topic.summary,
      startMs,
      endMs,
      startRatio: startMs / durationMs,
      endRatio: endMs / durationMs,
      family:
        topic.family !== undefined && TOPIC_FAMILIES.has(topic.family)
          ? topic.family
          : "general-context",
    });
  }
  return topics.sort((left, right) =>
    left.startMs === right.startMs
      ? left.endMs - right.endMs
      : left.startMs - right.startMs,
  );
}

function buildTopicStatus(
  language: FrontLanguage,
  phase: FrontAnalysisPhase | null,
  count: number,
): FrontTopicStatusViewModel {
  if (phase === null || phase === "fast-pass") {
    return {
      state: "hidden",
      label: ui(
        language,
        "전체 맥락 단계에서 방송 주제가 나타나요",
        "Broadcast topics appear during whole-context analysis",
      ),
    };
  }
  if (count > 0) {
    return {
      state: "available",
      label: ui(
        language,
        `방송 주제 ${numberLabel(language, count)}개`,
        `${numberLabel(language, count)} broadcast topics`,
      ),
    };
  }
  if (phase === "broadcast-context") {
    return {
      state: "waiting",
      label: ui(
        language,
        "확정된 주제가 생기면 시간축에 이어서 표시해요",
        "Verified topics will appear on the timeline as they become available",
      ),
    };
  }
  return {
    state: "empty",
    label: ui(
      language,
      "전체 맥락에서 뚜렷하게 구분된 주제가 없어요",
      "No distinct topic ranges were found in the whole-broadcast context",
    ),
  };
}

function inferRecoveryAction(
  source: FrontSourceViewModel | null,
  pipeline: FrontPipelineInput | null,
): FrontRecoveryActionId {
  if (!sourceIsReady(source)) {
    return source?.status === "failed" || source?.status === "interrupted"
      ? "retry-source-check"
      : "choose-source";
  }
  if (pipeline?.phase === "broadcast-context") return "retry-context";
  if (pipeline?.phase === "candidate-detail") return "retry-candidate-detail";
  return "resume-analysis";
}

function recoveryCopy(
  language: FrontLanguage,
  actionId: FrontRecoveryActionId,
): { readonly title: string; readonly detail: string; readonly label: string } {
  const copy: Record<
    FrontRecoveryActionId,
    { readonly ko: readonly [string, string, string]; readonly en: readonly [string, string, string] }
  > = {
    "choose-source": {
      ko: [
        "분석할 원본이 필요해요",
        "저장된 기록은 그대로 두고 원본을 다시 연결할 수 있어요.",
        "원본 고르기",
      ],
      en: [
        "An original video is required",
        "Saved records will remain while you reconnect the source.",
        "Choose source",
      ],
    },
    "retry-source-check": {
      ko: [
        "원본 확인을 끝내지 못했어요",
        "선택한 원본과 저장된 작업을 유지하고 파일 확인 단계만 다시 실행해요.",
        "원본 다시 확인",
      ],
      en: [
        "Source inspection did not finish",
        "The selected source and saved work are kept while only file inspection is retried.",
        "Check source again",
      ],
    },
    "resume-analysis": {
      ko: [
        "분석이 저장 지점에서 멈췄어요",
        "완료된 작업은 유지하고 남은 구간만 이어서 처리해요.",
        "저장 지점부터 이어서 분석",
      ],
      en: [
        "Analysis stopped at a saved checkpoint",
        "Completed work is kept and only remaining ranges are processed.",
        "Resume from checkpoint",
      ],
    },
    "retry-transcript": {
      ko: [
        "대사 확인이 일부 멈췄어요",
        "완료된 대사 조각은 유지하고 실패한 조각만 다시 확인해요.",
        "실패한 대사 조각 다시 확인",
      ],
      en: [
        "Some transcript fragments stopped",
        "Completed transcript fragments are kept and only failed fragments are retried.",
        "Retry failed transcript fragments",
      ],
    },
    "retry-context": {
      ko: [
        "전체 맥락 분석이 멈췄어요",
        "저장된 대사와 빠른 탐색 결과는 유지하고 끝나지 않은 맥락 작업부터 이어가요.",
        "맥락 분석 이어서 하기",
      ],
      en: [
        "Whole-context analysis stopped",
        "Saved dialogue and fast-scan results are kept while unfinished context work resumes.",
        "Resume context analysis",
      ],
    },
    "retry-candidate-detail": {
      ko: [
        "후보별 근거 확인이 멈췄어요",
        "완료된 후보 근거는 유지하고 화면·오디오가 미완성인 후보만 다시 확인해요.",
        "미완성 후보 다시 확인",
      ],
      en: [
        "Candidate evidence review stopped",
        "Completed evidence is kept and only candidates missing visual or audio evidence are retried.",
        "Retry incomplete candidates",
      ],
    },
    "retry-save": {
      ko: [
        "결과 저장 확인이 필요해요",
        "AI를 다시 호출하지 않고 현재 결과의 저장과 읽기 확인만 다시 시도해요.",
        "결과 저장 다시 확인",
      ],
      en: [
        "Result storage needs verification",
        "Only storage and readback are retried; the AI is not called again.",
        "Verify result storage again",
      ],
    },
  };
  const selected = language === "en" ? copy[actionId].en : copy[actionId].ko;
  return { title: selected[0], detail: selected[1], label: selected[2] };
}

function buildRecovery(
  language: FrontLanguage,
  mode: FrontSurfaceMode,
  source: FrontSourceViewModel | null,
  pipeline: FrontPipelineInput | null,
  input: FrontRecoveryInput | null,
): FrontRecoveryViewModel | null {
  if (mode !== "recoverable") return null;
  const actionId =
    input !== null && RECOVERY_ACTION_IDS.has(input.actionId)
      ? input.actionId
      : inferRecoveryAction(source, pipeline);
  const copy = recoveryCopy(language, actionId);
  return {
    title: copy.title,
    detail: safeDetail(input?.safeDetail) ?? copy.detail,
    primaryAction: { id: actionId, label: copy.label },
  };
}

function buildTracks(
  input: readonly FrontProgressTrackInput[] | undefined,
): readonly FrontProgressTrackViewModel[] {
  if (input === undefined) return [];
  const seen = new Set<string>();
  const tracks: FrontProgressTrackViewModel[] = [];
  for (const track of input) {
    const id = track.id.trim();
    const label = track.label.trim();
    if (id.length === 0 || label.length === 0 || seen.has(id)) continue;
    seen.add(id);
    tracks.push({
      id,
      label,
      status: track.status.trim(),
      ratio: finiteUnit(track.ratio),
    });
  }
  return tracks;
}

/**
 * Derives the complete pre-publication surface in one pass.
 *
 * Invariants enforced at the adapter boundary:
 *
 * 1. a running pipeline requires a ready source and a known user phase;
 * 2. recoverable progress uses the durable checkpoint ratio;
 * 3. channel context cannot be ready unless identity and transcript are ready;
 * 4. topic ranges are time-bounded and appear only from the context phase;
 * 5. recovery exposes exactly one primary action;
 * 6. no candidate projection exists before ReviewStage publication.
 */
export function deriveFrontSurfaceModel(
  input: FrontSurfaceModelInput,
): FrontSurfaceViewModel {
  const language = normalizeLanguage(input.language);
  const source = normalizedSource(input.source);
  const pipeline = normalizedPipeline(input.pipeline);
  const explicitRecovery = input.recovery ?? null;
  const mode = deriveMode(source, pipeline, explicitRecovery);
  const phase = pipeline?.phase ?? null;
  const visibleTopics = phase === "broadcast-context" || phase === "candidate-detail";
  const topics = topicRanges(
    input.topics ?? [],
    source?.durationMs ?? null,
    visibleTopics,
  );

  return {
    mode,
    language,
    stage: stageCopy(language, mode, phase),
    source,
    progress: buildProgress(language, mode, pipeline),
    preanalysis: buildPreanalysis(language, input.preanalysis ?? null),
    topics,
    topicStatus: buildTopicStatus(language, phase, topics.length),
    tracks: buildTracks(pipeline?.progress.tracks),
    recovery: buildRecovery(
      language,
      mode,
      source,
      pipeline,
      explicitRecovery,
    ),
  };
}
