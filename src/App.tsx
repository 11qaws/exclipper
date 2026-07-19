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
  type HighlightSelectionResult,
} from "./analysis";
import {
  ChatAnalysisWorkerError,
  runChatAnalysisWorker,
} from "./analysis/chatAnalysisWorkerClient";
import {
  mergeCandidateAudioEventEvidence,
  type CandidateAudioEventEvidenceById,
} from "./analysis/candidateAudioEventEvidenceState";
import { buildCandidateAudioEventPresentation } from "./analysis/candidateAudioEventPresentation";
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
  type CandidatePassBEvidence,
  type CandidatePassBTarget as CandidatePassBCoreTarget,
} from "./analysis/candidatePassB";
import { buildCandidatePassBPresentation } from "./analysis/candidatePassBPresentation";
import {
  mergeCandidatePassBEvidence,
  type CandidatePassBEvidenceById,
} from "./analysis/candidatePassBEvidenceState";
import { selectCandidatePassBRuntimeDevice } from "./analysis/candidatePassBRuntime";
import {
  CANDIDATE_PASS_B_MODEL_ID,
  CANDIDATE_PASS_B_MODEL_REVISION,
  CandidatePassBWorkerError,
  runCandidatePassBWorker,
  type CandidatePassBCandidateGap,
  type CandidatePassBCandidateProgress,
  type CandidatePassBModelProgress,
  type CandidatePassBTranscriptResult,
  type CandidatePassBWorkerIdentity,
} from "./analysis/candidatePassBWorkerClient";
import {
  fuseReactionHighlightCandidates,
  highlightReasonForSignalKinds,
  type UnifiedHighlightCandidate,
} from "./analysis/highlightFusion";
import { buildHighlightNarrative } from "./analysis/highlightNarrative";
import {
  createAnalysisRun,
  reduceAnalysisRun,
  type AnalysisRunEvent,
  type AnalysisRunState,
} from "./domain/analysisRun";
import { deriveAnalysisControlState } from "./domain/analysisControlState";
import {
  createCandidateAudioEventRun,
  reduceCandidateAudioEventRun,
  summarizeCandidateAudioEventRun,
  type CandidateAudioEventRunEvent,
  type CandidateAudioEventRunFailureReasonCode,
  type CandidateAudioEventRunState,
  type CandidateAudioEventWorkerEventPayload,
} from "./domain/candidateAudioEventRun";
import {
  createCandidatePassBRun,
  reduceCandidatePassBRun,
  summarizeCandidatePassBRun,
  type CandidatePassBCandidateFailureReasonCode,
  type CandidatePassBNoClearSpeechReasonCode,
  type CandidatePassBRunEvent,
  type CandidatePassBRunFailureReasonCode,
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
  type CandidateBoundaryRejectionReason,
  type CandidateBoundaryRevision,
} from "./domain/candidateBoundaryRevision";
import {
  createSourceCheck,
  reduceSourceCheck,
  type SourceCheckEvent,
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
  type LocalAudioReactionAnalysisResult,
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
import {
  classifyDurableMediaContainer,
  durableCoverageDisposition,
  DURABLE_AUDIO_GAP_ID,
  DURABLE_CHAT_GAP_ID,
  DURABLE_SIGNAL_GAP_POLICY_ID,
  expectedBrowserCapabilitySignature,
  type DurableAnalysisCoverageSummary,
  type DurableAnalysisGapApprovalEvidence,
  type DurableAnalysisInputDescriptor,
  type DurableAnalysisSelectionSummary,
  type DurableAudioGapReasonCode,
  type DurableChatGapReasonCode,
  type DurableFinalResultPayload,
  type DurableGapApprovalRecord,
  type DurableHighlightCandidate,
  type DurableSourceDescriptor,
} from "./storage/durableAnalysisPayload";
import {
  auditRecoverableAnalysisResults,
  type RecoverableAnalysisAudit,
  type RecoverableAnalysisResult,
} from "./storage/recoverableAnalysisResults";

type Theme = "light" | "dark";
type CandidateReviewState = "unreviewed" | "approved" | "rejected";
type ReviewedCandidate = UnifiedHighlightCandidate & {
  readonly reviewState: CandidateReviewState;
  readonly approvedBoundaryRevision: number | null;
};

interface CandidateBoundaryFeedback {
  readonly candidateId: string;
  readonly tone: "success" | "warning";
  readonly message: string;
}

type AnalysisSelectionSummary = DurableAnalysisSelectionSummary;
type AnalysisCoverageSummary = DurableAnalysisCoverageSummary;
type AnalysisGapApprovalEvidence = DurableAnalysisGapApprovalEvidence;

interface ChatAnalysisOutcome {
  readonly result: HighlightSelectionResult | null;
  readonly gapReasonCode: DurableChatGapReasonCode | null;
}

interface AudioAnalysisOutcome {
  readonly result: LocalAudioReactionAnalysisResult | null;
  readonly gapReasonCode: DurableAudioGapReasonCode | null;
  readonly plannedWindowCount: number;
  readonly analyzedWindowCount: number;
  readonly coverageComplete: boolean;
}

const APP_VERSION = "0.3.4";
const PERSISTENCE_SCHEMA_VERSION = "0.3.0";
const SIGNAL_ENGINE_VERSION = "streamer-reaction-fast-pass-v1";
const MAX_CHAT_FILE_BYTES = 32 * 1024 * 1024;
const SIGNAL_GAP_POLICY_ID = DURABLE_SIGNAL_GAP_POLICY_ID;

type RecoveryCatalogState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly audit: RecoverableAnalysisAudit }
  | { readonly status: "failed" };

class SourceRebindMismatchError extends Error {
  public constructor() {
    super("The selected file does not match the recovered source fingerprint.");
    this.name = "SourceRebindMismatchError";
  }
}

function createOperationId(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${randomId ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function candidatePassBNoClearReason(
  evidence: CandidatePassBEvidence,
): CandidatePassBNoClearSpeechReasonCode {
  if (evidence.status !== "fast-pass-fallback") {
    return "unintelligible_speech";
  }
  switch (evidence.fallbackReason) {
    case "silent":
    case "empty-transcript":
      return "no_speech";
    case "low-quality-transcript":
      return "low_transcript_confidence";
  }
}

function candidatePassBFailureReason(
  gap: CandidatePassBCandidateGap,
): CandidatePassBCandidateFailureReasonCode {
  switch (gap.reasonCode) {
    case "NO_AUDIO_TRACK":
      return "audio_extraction_failed";
    case "UNSUPPORTED_CONTAINER":
    case "UNSUPPORTED_AUDIO_CODEC":
    case "AUDIO_DECODE_FAILED":
      return "audio_decode_failed";
    case "EMPTY_AUDIO":
      return "audio_extraction_failed";
    case "TRANSCRIPTION_FAILED":
      return "transcription_failed";
  }
}

function candidatePassBRunFailureReason(
  error: unknown,
): CandidatePassBRunFailureReasonCode {
  if (!(error instanceof CandidatePassBWorkerError)) {
    return "runtime_unavailable";
  }
  if (error.workerReasonCode === "MODEL_LOAD_FAILED") {
    return "model_load_failed";
  }
  if (
    error.code === "EVENT_FENCE_REJECTED" ||
    error.code === "WORKER_MESSAGE_ERROR" ||
    error.code === "RESULT_CALLBACK_FAILED" ||
    error.code === "PROGRESS_CALLBACK_FAILED"
  ) {
    return "protocol_error";
  }
  if (error.code === "WORKER_FAILED") {
    return "worker_initialization_failed";
  }
  return "runtime_unavailable";
}

function explainCandidatePassBError(error: unknown): string {
  if (error instanceof CandidatePassBWorkerError) {
    if (error.code === "ABORTED") {
      return "대사 단서 찾기를 멈췄어요. 이미 찾은 단서는 이 탭에서 그대로 볼 수 있어요.";
    }
    if (error.workerReasonCode === "MODEL_LOAD_FAILED") {
      return "음성 AI 파일을 불러오지 못했어요. 인터넷 연결이나 브라우저 호환 상태를 확인한 뒤 다시 시도해 주세요. 기존 후보는 그대로 사용할 수 있어요.";
    }
  }
  return "대사 단서를 끝까지 찾지 못했어요. 기존 오디오·채팅 근거와 후보는 그대로 사용할 수 있어요.";
}

function candidateAudioEventRunFailureReason(
  error: unknown,
): CandidateAudioEventRunFailureReasonCode {
  if (!(error instanceof CandidateAudioEventWorkerError)) {
    return "runtime_unavailable";
  }
  if (error.workerReasonCode === "MODEL_LOAD_FAILED") {
    return "model_load_failed";
  }
  if (
    error.code === "EVENT_FENCE_REJECTED" ||
    error.code === "WORKER_MESSAGE_ERROR" ||
    error.code === "RESULT_CALLBACK_FAILED" ||
    error.code === "PROGRESS_CALLBACK_FAILED"
  ) {
    return "protocol_error";
  }
  if (error.code === "WORKER_FAILED") {
    return "worker_initialization_failed";
  }
  return "runtime_unavailable";
}

function explainCandidateAudioEventError(error: unknown): string {
  if (error instanceof CandidateAudioEventWorkerError) {
    if (error.code === "ABORTED") {
      return "반응 종류 찾기를 멈췄어요. 이미 찾은 단서는 이 탭에 그대로 남아 있어요.";
    }
    if (error.workerReasonCode === "MODEL_LOAD_FAILED") {
      return "반응 종류 AI 파일을 불러오지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요. 기존 후보와 대사 단서는 그대로 사용할 수 있어요.";
    }
  }
  return "반응 종류를 끝까지 나누지 못했어요. 빠른 분석 후보와 이미 찾은 대사 단서는 그대로 사용할 수 있어요.";
}

function candidateAudioEventGapStatusLabel(
  reasonCode: CandidateAudioEventCandidateGap["reasonCode"],
): string {
  switch (reasonCode) {
    case "NO_AUDIO_TRACK":
      return "오디오 트랙 없음 · 후보 유지";
    case "UNSUPPORTED_CONTAINER":
      return "영상 형식 지원 안 됨 · 후보 유지";
    case "UNSUPPORTED_AUDIO_CODEC":
      return "오디오 코덱 지원 안 됨 · 후보 유지";
    case "EMPTY_AUDIO":
      return "들을 반응 없음 · 후보 유지";
    case "AUDIO_DECODE_FAILED":
      return "이 후보 오디오 읽기 실패 · 후보 유지";
    case "CLASSIFICATION_FAILED":
      return "이 후보 반응 분류 실패 · 후보 유지";
  }
}

function toDurableCandidate(candidate: UnifiedHighlightCandidate): DurableHighlightCandidate {
  const { reason: _presentationReason, ...durableCandidate } = candidate;
  void _presentationReason;
  return durableCandidate;
}

function hydrateDurableCandidate(
  candidate: DurableHighlightCandidate,
): UnifiedHighlightCandidate {
  return {
    ...candidate,
    reason: highlightReasonForSignalKinds(candidate.signalKinds),
  };
}

function createDurableSourceDescriptor(
  preflight: LocalMediaPreflightResult,
  sourceDefinitionId: string,
  contentFingerprint: string,
): DurableSourceDescriptor {
  return {
    sourceDefinitionId,
    contentFingerprint,
    sizeBytes: preflight.metadata.sizeBytes,
    durationMs: preflight.metadata.durationMs,
    kind: preflight.metadata.kind,
    container: classifyDurableMediaContainer(
      preflight.metadata.extension,
      preflight.metadata.mimeType,
    ),
  };
}

function durableAudioGapReasonForError(
  error: LocalAudioReactionAnalysisError,
): DurableAudioGapReasonCode {
  if (error.code === "EVENT_FENCE_REJECTED") {
    return "EVENT_FENCE_REJECTED";
  }
  if (error.code === "WORKER_TIMEOUT") {
    return "WORKER_TIMEOUT";
  }
  return "WORKER_FAILED";
}

function explainAnalysisError(error: unknown): string {
  if (error instanceof LocalFileFingerprintError) {
    return error.code === "CRYPTO_UNAVAILABLE"
      ? "이 브라우저에서는 영상을 안전하게 다시 확인할 SHA-256 기능을 쓸 수 없어요. 최신 Chrome이나 Edge에서 다시 열어 주세요."
      : "영상 내용 확인 지문을 만드는 중 문제가 생겼어요. 원본 파일을 다시 골라 주세요.";
  }
  if (error instanceof LocalVideoVisualAnalysisError) {
    if (error.code === "ABORTED") {
      return "분석을 안전하게 취소했어요. 원본과 채팅은 그대로 두었으니 다시 시작할 수 있어요.";
    }
    if (error.code === "SEEK_TIMEOUT" || error.code === "SEEK_FAILED") {
      return "영상의 일부 위치로 이동하지 못했어요. MP4 또는 WebM으로 변환한 뒤 다시 시도해 주세요.";
    }
    return "영상 장면을 읽는 중 문제가 생겼어요. 다른 형식의 원본으로 다시 시도해 주세요.";
  }
  if (error instanceof LocalAudioReactionAnalysisError) {
    return error.code === "ABORTED"
      ? "분석을 안전하게 취소했어요."
      : "방송 오디오의 음성형·큰 반응 신호를 읽지 못했어요. 채팅·화면 신호로 남긴 제한 결과인지 안내를 확인해 주세요.";
  }
  if (error instanceof ChatAnalysisWorkerError) {
    return error.code === "ABORTED"
      ? "분석을 안전하게 취소했어요."
      : "채팅 반응 분석 Worker가 중단됐어요. 채팅 파일을 다시 선택해 주세요.";
  }
  if (error instanceof AnalysisResultStoreError) {
    return "브라우저의 로컬 저장소에 결과를 확정하지 못했어요. 시크릿 모드를 끄거나 사이트 저장 권한을 허용해 주세요.";
  }
  return "후보를 찾는 중 예상하지 못한 문제가 생겼어요. 원본과 채팅을 확인한 뒤 다시 시도해 주세요.";
}

function initialTheme(): Theme {
  try {
    const stored = globalThis.localStorage?.getItem("retto-theme");
    if (stored === "light" || stored === "dark") {
      return stored;
    }
  } catch {
    // Theme persistence is optional when storage is unavailable or blocked.
  }
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches === true
    ? "dark"
    : "light";
}

function sourceCheckLabel(state: SourceCheckState | null): string {
  if (state === null) {
    return "원본을 기다리는 중";
  }
  const labels: Record<SourceCheckState["status"], string> = {
    created: "검사 준비",
    checking: "원본 확인 중",
    committing: "검사 결과 정리 중",
    completed:
      state.status === "completed" && state.resultKind === "blocked"
        ? "분석할 수 없는 원본"
        : "원본 확인 완료",
    cancelling: "검사 취소 중",
    cancelled: "검사 취소됨",
    failed: "원본 검사 실패",
    interrupted: "원본 검사 중단됨",
  };
  return labels[state.status];
}

function analysisRunLabel(state: AnalysisRunState | null): string {
  if (state === null) {
    return "아직 시작 안 함";
  }
  const labels: Record<AnalysisRunState["status"], string> = {
    created: "분석 준비",
    starting: "분석 시작 중",
    running: "방송 오디오·채팅·화면 맥락 분석 중",
    pausing: "안전하게 멈추는 중",
    paused: "분석 일시정지",
    resuming: "분석 이어 하는 중",
    awaitingGapDecision: "누락 구간 확인 필요",
    finalizing: "후보 순위 저장 중",
    completing: "결과 다시 확인 중",
    completed: "1차 후보 찾기 완료",
    completedWithGaps: "일부 구간을 제외하고 완료",
    cancelling: "분석 취소 중",
    cancelled: "분석 취소됨",
    failing: "오류 결과 정리 중",
    failed: "분석 실패",
    interrupted: "분석 중단됨",
  };
  return labels[state.status];
}

function explainPreflightError(error: unknown): string {
  if (!(error instanceof LocalMediaPreflightError)) {
    return "파일을 확인하는 중 예상하지 못한 문제가 생겼어요. 다른 영상 파일로 다시 시도해 주세요.";
  }
  const messages: Partial<Record<LocalMediaPreflightError["code"], string>> = {
    INVALID_FILE: "브라우저가 이 파일을 읽을 수 없어요. 영상 파일을 다시 선택해 주세요.",
    METADATA_TIMEOUT: "영상 정보를 읽는 데 너무 오래 걸렸어요. 파일이 손상되지 않았는지 확인해 주세요.",
    METADATA_LOAD_FAILED: "이 브라우저가 영상 정보를 열지 못했어요. MP4 또는 WebM 파일을 먼저 권장해요.",
    INVALID_DURATION: "영상 길이를 확인하지 못했어요. 다른 형식으로 변환한 파일을 시도해 주세요.",
    DURATION_LIMIT_EXCEEDED: "한 원본은 최대 12시간까지 분석할 수 있어요. 12시간 이하의 파일로 나눠서 다시 골라 주세요.",
    CLEANUP_FAILED: "검사는 끝났지만 임시 자원을 완전히 정리하지 못했어요. 페이지를 새로 열고 다시 시도해 주세요.",
  };
  return (
    messages[error.code] ??
    "브라우저에서 이 파일의 기본 정보를 확인하지 못했어요. 다른 영상 파일을 시도해 주세요."
  );
}

function applySourceEvent(
  state: SourceCheckState,
  event: SourceCheckEvent,
): SourceCheckState {
  const outcome = reduceSourceCheck(state, event);
  if (!outcome.accepted) {
    throw new Error(`SourceCheck 전이가 거부되었습니다: ${outcome.reason}`);
  }
  return outcome.state;
}

function applyAnalysisEvent(
  state: AnalysisRunState,
  event: AnalysisRunEvent,
): AnalysisRunState {
  const outcome = reduceAnalysisRun(state, event);
  if (!outcome.accepted) {
    throw new Error(`AnalysisRun 전이가 거부되었습니다: ${outcome.reason}`);
  }
  return outcome.state;
}

function assessLink(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "먼저 YouTube 또는 CHZZK 주소를 붙여 넣어 주세요.";
  }
  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    if (host === "youtu.be" || host.endsWith("youtube.com")) {
      return "YouTube 링크 형식을 확인했어요. 현재는 주소를 분석 입력으로 쓰지 않으므로, 내려받을 권한이 있는 내 영상 파일을 선택해 주세요.";
    }
    if (host === "chzzk.naver.com" || host.endsWith("chzzk.naver.com")) {
      return "CHZZK 링크 형식을 확인했어요. 현재는 주소를 분석 입력으로 쓰지 않으므로, 내 영상 파일과 선택적 채팅 기록을 준비해 주세요.";
    }
    return "현재는 YouTube와 CHZZK 링크만 안내할 수 있어요. 분석하려면 내 영상 파일을 선택해 주세요.";
  } catch {
    return "주소 형식을 알아보지 못했어요. https:// 로 시작하는 전체 주소인지 확인해 주세요.";
  }
}

function boundaryRejectionMessage(reason: CandidateBoundaryRejectionReason): string {
  const messages: Record<CandidateBoundaryRejectionReason, string> = {
    player_time_unavailable:
      "먼저 ‘이 장면 보기’를 누르고 영상에서 원하는 위치로 이동해 주세요.",
    player_time_out_of_source:
      "현재 재생 위치를 원본 안에서 확인하지 못했어요. 영상을 다시 재생해 주세요.",
    range_out_of_source:
      "시작은 끝보다 앞이어야 하고, 두 위치 모두 원본 영상 안에 있어야 해요.",
    would_exclude_peak:
      "AI가 찾은 반응 정점이 빠지지 않도록 이 변경은 적용하지 않았어요.",
    duration_below_minimum:
      "클립이 30초보다 짧아져 적용하지 않았어요. 반대쪽 경계를 먼저 늘려 주세요.",
    duration_above_maximum:
      "클립이 1분보다 길어져 적용하지 않았어요. 반대쪽 경계를 먼저 줄여 주세요.",
    already_at_proposal: "이미 AI가 처음 제안한 시작·끝을 사용하고 있어요.",
    no_effective_change: "현재 조건에서는 더 움직일 수 없어요.",
  };
  return messages[reason];
}

function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [isDragging, setIsDragging] = useState(false);
  const [pendingFileName, setPendingFileName] = useState<string | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState<string | null>(null);
  const [sourceCheck, setSourceCheck] = useState<SourceCheckState | null>(null);
  const [preflight, setPreflight] = useState<LocalMediaPreflightResult | null>(null);
  const [sourceContentFingerprint, setSourceContentFingerprint] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
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
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [candidatePassBRun, setCandidatePassBRun] =
    useState<CandidatePassBRunState | null>(null);
  const [candidatePassBEvidenceById, setCandidatePassBEvidenceById] =
    useState<CandidatePassBEvidenceById>({});
  const [candidatePassBModelProgress, setCandidatePassBModelProgress] =
    useState<CandidatePassBModelProgress | null>(null);
  const [candidatePassBCandidateProgress, setCandidatePassBCandidateProgress] =
    useState<CandidatePassBCandidateProgress | null>(null);
  const [candidatePassBError, setCandidatePassBError] = useState<string | null>(null);
  const [candidatePassBStartPending, setCandidatePassBStartPending] = useState(false);
  const [candidatePassBUseCompatibilityMode, setCandidatePassBUseCompatibilityMode] =
    useState(false);
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
  const [lastExportFormat, setLastExportFormat] =
    useState<HighlightExportFormat | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [exportError, setExportError] = useState<string | null>(null);
  const [previewCandidateId, setPreviewCandidateId] = useState<string | null>(null);
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
  const candidateAudioEventAbortController = useRef<AbortController | null>(null);
  const analysisStartOperation = useRef<number | null>(null);
  const analysisOperationEpoch = useRef(0);
  const candidatePassBOperationEpoch = useRef(0);
  const candidatePassBStartPendingRef = useRef(false);
  const candidatePassBMachine = useRef<CandidatePassBRunState | null>(null);
  const candidatePassBIdentity = useRef<CandidatePassBWorkerIdentity | null>(null);
  const candidateAudioEventOperationEpoch = useRef(0);
  const candidateAudioEventStartPendingRef = useRef(false);
  const candidateAudioEventMachine = useRef<CandidateAudioEventRunState | null>(null);
  const candidateAudioEventIdentity = useRef<CandidateAudioEventWorkerIdentity | null>(null);
  const recoveryOperationEpoch = useRef(0);
  const [appSessionId] = useState(() => createOperationId("session"));
  const [writerEpoch] = useState(() => Date.now());
  const resultStore = useRef<AnalysisResultStore | null>(null);
  const sourcePreviewUrlRef = useRef<string | null>(null);
  const previewVideo = useRef<HTMLVideoElement | null>(null);
  const lastCandidateCueTrigger = useRef<HTMLButtonElement | null>(null);
  const sourceHeading = useRef<HTMLHeadingElement | null>(null);
  const candidateHeading = useRef<HTMLHeadingElement | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      globalThis.localStorage?.setItem("retto-theme", theme);
    } catch {
      // Keep the selected theme for this tab even when persistence is blocked.
    }
  }, [theme]);

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
        candidatePassBMachine.current = null;
        candidatePassBIdentity.current = null;
        candidateAudioEventOperationEpoch.current += 1;
        candidateAudioEventAbortController.current?.abort();
        candidateAudioEventAbortController.current = null;
        candidateAudioEventMachine.current = null;
        candidateAudioEventIdentity.current = null;
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
    if (selectionResult !== null) {
      if (
        openedRecoveredResult !== null &&
        sourceFile === null &&
        candidates.length > 0
      ) {
        sourceHeading.current?.focus();
      } else {
        candidateHeading.current?.focus();
      }
    }
  }, [candidates.length, openedRecoveredResult, selectionResult, sourceFile]);

  const replaceSourceFile = useCallback((file: File | null): void => {
    if (!isMounted.current) {
      return;
    }
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
      ? "이 브라우저에서 가장 안정적인 음성 AI 실행 방법을 확인하고 있어요."
      : candidatePassBRun === null
      ? "빠르게 찾은 후보는 지금 바로 검토할 수 있어요. 원할 때 대사 단서를 더 붙여 보세요."
      : candidatePassBRun.status === "idle" || candidatePassBRun.status === "preparing"
        ? "음성 AI 작업을 준비하고 있어요."
        : candidatePassBRun.status === "loadingModel"
          ? "음성 AI 파일을 준비하고 있어요. 첫 실행이 가장 오래 걸릴 수 있어요."
          : candidatePassBRun.status === "transcribing"
            ? `후보 ${candidatePassBCurrentOrdinal}/${candidatePassBSummary?.totalCandidateCount ?? candidates.length}의 대사 단서를 확인하고 있어요.`
            : candidatePassBRun.status === "finalizing"
              ? "모든 후보 결과를 마지막으로 확인하고 있어요."
              : candidatePassBRun.status === "cancelling"
              ? "현재 작업을 안전하게 정리하고 있어요."
              : candidatePassBRun.status === "completed"
                ? `후보 ${candidatePassBSummary?.clueFoundCount ?? 0}개에서 재생해 확인할 자동 전사 위치를 찾았어요.`
                : candidatePassBRun.status === "completedWithGaps"
                  ? `자동 전사 확인 위치 ${candidatePassBSummary?.clueFoundCount ?? 0}개 후보 · 분명한 단서 없음 ${candidatePassBSummary?.noClearSpeechCount ?? 0}개 · 건너뜀 ${candidatePassBSummary?.failedCount ?? 0}개로 마쳤어요.`
                  : candidatePassBRun.status === "cancelled"
                    ? "대사 단서 찾기를 멈췄어요. 이미 찾은 단서는 그대로 남아 있어요."
                    : "대사 단서 찾기를 마치지 못했어요. 기존 후보는 그대로 검토할 수 있어요.";
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
    (preflight.capabilities.webGpu || preflight.capabilities.webAssembly);
  const candidateAudioEventRuntimeAvailable =
    preflight !== null &&
    preflight.capabilities.worker &&
    preflight.capabilities.webAssembly;
  const candidateRefinementBusy = candidatePassBBusy || candidateAudioEventBusy;
  const sourceCheckBusy =
    sourceCheck !== null && ["checking", "committing", "cancelling"].includes(sourceCheck.status);
  const showStatusBar =
    sourceCheck !== null ||
    sourceError !== null ||
    analysisRun !== null ||
    openedRecoveredResult !== null;
  const showRecoveryPanel =
    openedRecoveredResult !== null ||
    recoveryCatalog.status === "failed" ||
    (recoveryCatalog.status === "ready" && recoveryCatalog.audit.results.length > 0);
  const boundarySourceDurationMs = Math.round(
    preflight?.metadata.durationMs ??
      openedRecoveredResult?.finalResult.result.input.source.durationMs ??
      0,
  );
  const approvedCandidates = candidates.filter(
    ({ reviewState }) => reviewState === "approved",
  );
  const approvedExportCandidates: readonly ApprovedHighlightExportCandidate[] =
    approvedCandidates.map((proposal) => ({
      proposal,
      boundaryRevision: boundaryRevisions[proposal.id] ?? null,
    }));
  const approvedCount = approvedCandidates.length;
  const previewCandidateNumber =
    previewCandidateId === null
      ? 0
      : candidates.findIndex(({ id }) => id === previewCandidateId) + 1;
  const reviewStarted = candidates.some(({ reviewState }) => reviewState !== "unreviewed");
  const boundaryWorkStarted = Object.values(boundaryRevisions).some(
    ({ revision }) => revision > 0,
  );
  const reviewWorkStarted = reviewStarted || boundaryWorkStarted;
  const candidatePassBWorkStarted = Object.keys(candidatePassBEvidenceById).length > 0;
  const candidateAudioEventWorkStarted =
    Object.keys(candidateAudioEventEvidenceById).length > 0;
  const unsavedSessionWorkStarted =
    reviewWorkStarted || candidatePassBWorkStarted || candidateAudioEventWorkStarted;
  const reviewCompleted =
    candidates.length > 0 && candidates.every(({ reviewState }) => reviewState !== "unreviewed");
  const analysisFinishedWithoutCandidates =
    analysisComplete && selectionResult !== null && candidates.length === 0;
  const currentStep = analysisFinishedWithoutCandidates
    ? 4
    : !sourceReady
      ? 1
      : !analysisComplete
        ? 2
        : reviewCompleted
          ? 4
          : 3;
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
      "승인·제외 판단, 시작·끝 조정, 자세히 찾은 반응 종류와 대사 단서는 현재 탭에만 있어요. 지금 이동하면 방금 한 작업이 사라집니다. 그래도 계속할까요?",
    );
  }, [analysisBusy, candidateRefinementBusy, unsavedSessionWorkStarted]);

  const resetBoundarySession = useCallback((): void => {
    setBoundarySessionId(createOperationId("boundary-session"));
    setBoundaryRevisions({});
    setBoundaryFeedback(null);
  }, []);

  const resetCandidatePassB = useCallback((): void => {
    candidatePassBOperationEpoch.current += 1;
    candidatePassBAbortController.current?.abort();
    candidatePassBAbortController.current = null;
    candidatePassBMachine.current = null;
    candidatePassBIdentity.current = null;
    candidatePassBStartPendingRef.current = false;
    setCandidatePassBRun(null);
    setCandidatePassBEvidenceById({});
    setCandidatePassBStartPending(false);
    setCandidatePassBUseCompatibilityMode(false);
    setCandidatePassBModelProgress(null);
    setCandidatePassBCandidateProgress(null);
    setCandidatePassBError(null);
    lastCandidateCueTrigger.current = null;
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

  const resetDownstream = useCallback(() => {
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
    setOpenedRecoveredResult(null);
  }, [resetBoundarySession, resetCandidateAudioEvent, resetCandidatePassB]);

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
            ? "영상 기본 정보는 읽었지만 브라우저의 로컬 저장소에 검사 결과를 확정하지 못했어요. 사이트 저장 권한을 확인해 주세요."
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
                maxCandidates: 12,
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
                maxCandidates: 12,
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

      const fusedCandidates = fuseReactionHighlightCandidates(
        {
          audioCandidates: audioOutcome.result?.candidates ?? [],
          chatCandidates: chatResult?.candidates ?? [],
          visualCandidates: visualResult.candidates,
        },
        {
          sourceDurationMs: preflight.metadata.durationMs,
          candidateWindowMs: 45_000,
          maxCandidates: 12,
        },
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
      setSelectionResult(reopenedPayload.summary);
      setCandidates(
        reopenedPayload.candidates.map((candidate) => ({
          ...hydrateDurableCandidate(candidate),
          reviewState: "unreviewed" as const,
          approvedBoundaryRevision: null,
        })),
      );
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
              setSelectionResult(durableCompletion.finalResult.result.summary);
              setCandidates(
                durableCompletion.finalResult.result.candidates.map((candidate) => ({
                  ...hydrateDurableCandidate(candidate),
                  reviewState: "unreviewed" as const,
                  approvedBoundaryRevision: null,
                })),
              );
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

  const runCandidatePassB = async (): Promise<void> => {
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
    const runtimeDevice = await selectCandidatePassBRuntimeDevice(
      preflight.capabilities,
      { forceWasm: candidatePassBUseCompatibilityMode },
    );
    if (
      !isMounted.current ||
      operationEpoch !== candidatePassBOperationEpoch.current
    ) {
      candidatePassBStartPendingRef.current = false;
      if (isMounted.current) {
        setCandidatePassBStartPending(false);
      }
      return;
    }
    if (runtimeDevice === null) {
      candidatePassBStartPendingRef.current = false;
      setCandidatePassBStartPending(false);
      setCandidatePassBError(
        "이 브라우저에서 음성 AI 실행 장치를 준비하지 못했어요. 최신 Chrome이나 Edge에서 다시 열어 주세요.",
      );
      return;
    }

    const sourceDurationMs = Math.round(preflight.metadata.durationMs);
    let targets: readonly CandidatePassBCoreTarget[];
    try {
      targets = selectCandidatePassBTargets(candidates, {
        sourceDurationMs,
        maxCandidates: 12,
      });
    } catch {
      candidatePassBStartPendingRef.current = false;
      setCandidatePassBStartPending(false);
      setCandidatePassBError(
        "대사 단서를 확인할 후보 시간을 읽지 못했어요. 빠른 분석을 다시 실행해 주세요.",
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
        modelId: CANDIDATE_PASS_B_MODEL_ID,
        modelRevision: CANDIDATE_PASS_B_MODEL_REVISION,
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
    setCandidatePassBError(null);
    if (!applyCandidatePassBEvent({ type: "START_REQUESTED" })) {
      setCandidatePassBError("대사 단서 찾기를 시작하지 못했어요. 다시 시도해 주세요.");
      return;
    }
    if (
      !applyCandidatePassBEvent({
        ...identity,
        eventId: createOperationId("pass-b-event"),
        type: "WORKER_PREPARED",
      })
    ) {
      setCandidatePassBError("음성 AI 작업을 준비하지 못했어요. 다시 시도해 주세요.");
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

    try {
      const workerResult = await runCandidatePassBWorker(sourceFile, {
        identity,
        sourceDurationMs,
        device: runtimeDevice,
        targets: targets.map((target) => ({
          candidateId: target.candidateId,
          startMs: target.decodeStartMs,
          endMs: target.decodeEndMs,
        })),
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
            setCandidatePassBCandidateProgress(progress);
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
          setCandidatePassBEvidenceById((current) =>
            mergeCandidatePassBEvidence(current, evidence),
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
            setCandidatePassBEvidenceById((current) =>
              mergeCandidatePassBEvidence(current, evidence),
            );
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
      if (!isCurrentOperation()) {
        return;
      }
      if (
        !applyCurrentWorkerEvent({
          type: "RUN_COMPLETED",
          requestedCount: workerResult.summary.requestedCount,
          resultCount: workerResult.summary.completedCount,
          gapCount: workerResult.summary.gapCount,
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
            ? "대사 단서 찾기를 멈추고 작업 공간을 정리했어요. 이미 찾은 단서는 이 탭에 그대로 남아 있어요."
            : "대사 단서 작업을 정리하지 못했어요. 기존 후보는 그대로 사용할 수 있어요.",
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
      if (
        runtimeDevice === "webgpu" &&
        preflight.capabilities.webAssembly &&
        error instanceof CandidatePassBWorkerError &&
        error.workerReasonCode === "MODEL_LOAD_FAILED"
      ) {
        setCandidatePassBUseCompatibilityMode(true);
        setCandidatePassBError(
          "그래픽 가속으로 음성 AI를 준비하지 못했어요. 아래 ‘호환 모드로 다시 시도’를 누르면 더 널리 지원되는 방식으로 새 작업을 시작해요. 기존 후보와 단서는 그대로예요.",
        );
      } else {
        setCandidatePassBError(explainCandidatePassBError(error));
      }
    } finally {
      if (candidatePassBAbortController.current === controller) {
        candidatePassBAbortController.current = null;
      }
    }
  };

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
    const player = previewVideo.current;
    if (
      sourcePreviewUrl === null ||
      player === null ||
      previewCandidateId !== candidate.id
    ) {
      setBoundaryFeedback({
        candidateId: candidate.id,
        tone: "warning",
        message: "먼저 이 후보의 ‘이 장면 보기’를 누르고 원하는 위치로 이동해 주세요.",
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

  const playCandidate = (candidate: ReviewedCandidate): void => {
    setPreviewCandidateId(candidate.id);
    lastCandidateCueTrigger.current = null;
    const player = previewVideo.current;
    if (player === null) {
      return;
    }
    const range = effectiveCandidateRange(
      candidate,
      boundaryRevisions[candidate.id],
    );
    player.currentTime = range.startMs / 1_000;
    player.scrollIntoView({
      behavior: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "center",
    });
    player.focus({ preventScroll: true });
    void player.play().catch(() => {
      // Browser autoplay policy may require the user to press the native play control.
    });
  };

  const playCandidateCue = (
    candidate: ReviewedCandidate,
    timestampMs: number,
    trigger: HTMLButtonElement,
  ): void => {
    setPreviewCandidateId(candidate.id);
    lastCandidateCueTrigger.current = trigger;
    const player = previewVideo.current;
    if (player === null || !Number.isFinite(timestampMs)) {
      return;
    }
    const range = effectiveCandidateRange(
      candidate,
      boundaryRevisions[candidate.id],
    );
    player.currentTime = Math.max(range.startMs, Math.min(range.endMs, timestampMs)) / 1_000;
    player.scrollIntoView({
      behavior: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "center",
    });
    player.focus({ preventScroll: true });
    void player.play().catch(() => {
      // Browser autoplay policy may require the user to press the native play control.
    });
  };

  const focusPreviewCandidateEditor = (): void => {
    const cueTrigger = lastCandidateCueTrigger.current;
    if (cueTrigger?.isConnected === true && !cueTrigger.disabled) {
      cueTrigger.focus({ preventScroll: true });
      cueTrigger.scrollIntoView({
        behavior: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "center",
      });
      return;
    }
    if (previewCandidateNumber <= 0) {
      return;
    }
    const summary = document.getElementById(
      `candidate-boundary-summary-${previewCandidateNumber - 1}`,
    );
    summary?.focus({ preventScroll: true });
    summary?.scrollIntoView({
      behavior: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "center",
    });
  };

  const focusSourceSection = (): void => {
    sourceHeading.current?.focus();
    sourceHeading.current?.scrollIntoView({
      behavior: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
  };

  const openRecoveredAnalysis = (recovered: RecoverableAnalysisResult): void => {
    if (!confirmDiscardCurrentWork()) {
      return;
    }
    resetCandidatePassB();
    resetCandidateAudioEvent();
    resetBoundarySession();
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
    setSelectionResult(recovered.finalResult.result.summary);
    setCandidates(
      recovered.finalResult.result.candidates.map((candidate) => ({
        ...hydrateDurableCandidate(candidate),
        reviewState: "unreviewed" as const,
        approvedBoundaryRevision: null,
      })),
    );
    setLastExportFormat(null);
    setCopyStatus("idle");
    setExportError(null);
    setPreviewCandidateId(null);
    setOpenedRecoveredResult(recovered);
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

  return (
    <div className="rh-app">
      <header>
        <div className="header-inner rh-header-inner">
          <h1>
            <span className="rh-brand-mark" aria-hidden="true">R</span>
            Retto <span>Highlight</span>
          </h1>
          <div className="rh-header-actions">
            <span className="rh-privacy-pill">● 내 컴퓨터에서만 처리</span>
            <button
              className="theme-btn"
              type="button"
              aria-label={theme === "light" ? "어두운 화면으로 바꾸기" : "밝은 화면으로 바꾸기"}
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
            <span className="label">외부 전송</span>
            <span className="val">없음</span>
          </div>
          <span className="status-ts">v{APP_VERSION}</span>
          </div>
        </div>
      )}

      <main className="rh-shell">
        <ol className="rh-stepper" aria-label="작업 순서">
          {[
            openedRecoveredResult !== null && !sourceReady && candidates.length > 0
              ? "원본 다시 연결"
              : "원본 고르기",
            "AI가 먼저 찾기",
            "후보 검토",
            "결과 받기",
          ].map((label, index) => {
            const step = index + 1;
            return (
              <li
                className="rh-step"
                data-step={step}
                data-complete={step < currentStep}
                aria-current={step === currentStep ? "step" : undefined}
                key={label}
              >
                {label}
                {step < currentStep && <span className="rh-screen-reader-only"> 완료</span>}
              </li>
            );
          })}
        </ol>

        <section className="rh-page-heading" aria-labelledby="page-title">
          <p className="rh-eyebrow">개인 편집 어시스턴트</p>
          <h2 id="page-title">몇 시간짜리 방송에서, 먼저 볼 클립 후보들을 찾아드릴게요.</h2>
          <p>
            AI가 하루치 영상 전체를 먼저 훑어 서로 다른 30초~1분 클립 후보들을 찾아봅니다. 사람은 발견된 짧은 후보들만 보고 마지막 결정을 내리면 됩니다.
          </p>
          <details className="rh-inline-details">
            <summary>지금 AI가 보는 기준</summary>
            <p>
              방송 오디오에서 웃음·외침처럼 이어지는 음성형·큰 반응 신호를 먼저 찾고, 선택한 CHZZK 채팅 반응을 함께 봅니다.
              게임·영상 소리와 스트리머 마이크는 아직 분리하지 않으므로 실제 주체는 재생해 확인해 주세요.
              화면 변화는 사건 전후 맥락을 보조하며, 자동 전사 문구만으로 사건 이름이나 반응 원인을 확정하지 않아요.
            </p>
          </details>
        </section>

        {showRecoveryPanel && (
        <details
          className="rh-panel rh-recovery-panel"
        >
          <summary className="rh-recovery-summary">
            <span>
              {recoveryCatalog.status === "ready"
                ? `지난 분석 결과 ${recoveryCatalog.audit.results.length}개`
                : "지난 분석 결과"}
            </span>
            <span>이 브라우저에만 저장</span>
          </summary>
          <section aria-labelledby="recovery-title">
          <div className="rh-section-heading">
            <div>
              <p className="rh-eyebrow">이 브라우저에만 저장된 기록</p>
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

        <div className="rh-section-stack">
          <section aria-labelledby="source-title">
            <div className="rh-section-heading">
              <div>
                <p className="rh-eyebrow">1단계</p>
                <h3 id="source-title" ref={sourceHeading} tabIndex={-1}>
                  {openedRecoveredResult === null
                    ? "방송 원본을 골라 주세요"
                    : candidates.length === 0
                      ? "이번 결과는 원본 재연결이 필요하지 않아요"
                      : "미리볼 원래 방송 파일을 다시 골라 주세요"}
                </h3>
              </div>
              <p className="rh-help">원본 파일은 업로드되지 않아요.</p>
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
                    <p className="rh-eyebrow">추천 · 가장 정확함</p>
                    <strong>{pendingFileName ?? "영상 파일을 여기에 놓아도 돼요"}</strong>
                    <p className="rh-help">MP4·WebM 권장 · 최대 12시간 · 선택하면 길이와 분석 가능 여부를 바로 확인해요.</p>
                    <span className="btn btn-primary rh-drop-zone-button">
                      {sourceFileActionLabel}
                    </span>
                    <span className="rh-drop-zone-hint">또는 영상 파일을 여기로 끌어놓기</span>
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

              <details className="rh-link-details">
                <summary>영상 파일 없이 YouTube·CHZZK 링크만 있나요?</summary>
                <p className="rh-help">
                  현재 기본판은 링크의 방송 전체를 직접 읽을 수 없어요. 내려받을 권한이 있는 영상 파일을 먼저 준비해 주세요.
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
                  <button className="btn btn-secondary" type="submit">확인</button>
                </form>
                {linkNotice !== null && <p className="rh-notice" role="status">{linkNotice}</p>}
              </details>
            </div>
          </section>

          {(sourceCheck !== null || sourceError !== null) && (
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
                    <dd>AI 분석 준비 완료</dd>
                  </div>
                </dl>
              )}
              {sourceError !== null && <p className="rh-notice" data-tone="danger" role="alert">{sourceError}</p>}
              {sourceReady && preflight?.capabilities.preferredRuntimeTier === "signals-only" && (
                <p className="rh-notice" data-tone="warning">
                  이 브라우저에서는 오디오·채팅 분석 기능을 쓰지 못할 수 있어요.
                  그 경우 반응을 찾았다고 과장하지 않고, 제한된 화면 탐색 후보와 빠진 신호를 분명히 표시합니다.
                </p>
              )}
              {openedRecoveredResult !== null && sourceReady && (
                <p className="rh-notice" role="status">
                  영상 내용 샘플·크기·길이가 저장된 기록과 일치해요. 이제 후보 장면을 바로 재생할 수 있습니다.
                </p>
              )}
            </section>
          )}

          {sourceReady && !analysisComplete && (
          <>
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

          <section className="rh-analysis-cta" aria-labelledby="analysis-title">
            <div>
              <p className="rh-eyebrow">2단계</p>
              <h3 id="analysis-title">AI가 먼저 하이라이트를 찾습니다</h3>
              <p>
                영상 전체의 방송 오디오에서 음성형·큰 반응 신호를 먼저 훑고 서로 다른 30초~1분 클립 후보들을 정리해요. 채팅이 없어도 시작할 수 있습니다.
                분명한 반응이 여러 번 있으면 별도 카드로 나누며, 현재 기본판은 겹치지 않는 상위 후보를 최대 12개까지 보여 줍니다.
              </p>
              <details className="rh-inline-details">
                <summary>현재 분석 방식과 제한</summary>
                <p>
                  오디오 반응과 선택한 채팅 반응을 로컬에서 계산하고, 화면 변화는 사건 맥락에만 작게 반영합니다.
                  아직 대사를 받아쓰지 않으므로 사건의 구체적인 이름은 추정하지 않고 확인이 필요하다고 표시해요.
                </p>
              </details>
            </div>
            <div className="rh-analysis-actions">
              <button
                className="btn btn-primary rh-primary-action"
                type="button"
                disabled={!sourceReady || analysisBusy || analysisComplete || chatImportStatus === "reading"}
                onClick={() => void runSignalAnalysis()}
              >
                {analysisComplete
                  ? "후보 찾기 완료"
                  : chatImportStatus === "reading"
                    ? "채팅 읽는 중…"
                    : analysisCommitPending
                      ? "결과 저장 중…"
                      : analysisCancelPending
                        ? "안전하게 멈추는 중…"
                        : analysisBusy
                          ? "반응 찾는 중…"
                          : "AI로 하이라이트 찾기"}
              </button>
              {analysisCanBeCancelled && (
                <button className="btn btn-secondary" type="button" onClick={cancelAnalysis}>
                  안전하게 취소
                </button>
              )}
              {analysisCommitPending && (
                <p className="rh-help" role="status">
                  찾은 후보를 안전하게 저장하고 있어요. 잠시만 기다려 주세요.
                </p>
              )}
              {analysisCancelPending && (
                <p className="rh-help" role="status">
                  진행 중인 조각을 정리하고 있어요. 안전하게 멈출 때까지 잠시만 기다려 주세요.
                </p>
              )}
            </div>
          </section>
          </>
          )}

          {(analysisProgress !== null || audioAnalysisProgress !== null || analysisError !== null) && (
            <div className="rh-engine-note" aria-live="polite">
              <span aria-hidden="true">{analysisError === null ? "…" : "!"}</span>
              <div>
                {(analysisProgress !== null || audioAnalysisProgress !== null) && (
                  <>
                    <strong>
                      {analysisCommitPending
                        ? "찾은 후보와 확인 기록을 안전하게 저장하는 중"
                        : analysisCancelPending
                          ? "분석을 안전하게 멈추고 기록을 정리하는 중"
                          : audioAnalysisProgress?.stage === "decoding-audio"
                            ? `방송 오디오 반응 신호 ${audioAnalysisProgress.analyzedWindowCount.toLocaleString("ko-KR")}개 구간 확인 중`
                            : audioAnalysisProgress?.stage === "scoring"
                              ? "오디오 반응과 채팅·화면 맥락을 정리하는 중"
                              : analysisProgress?.stage === "sampling"
                                ? `영상 맥락 ${analysisProgress.completedSampleCount.toLocaleString("ko-KR")}/${analysisProgress.totalSampleCount.toLocaleString("ko-KR")} 확인 중`
                                : "영상과 방송 오디오 반응 분석 준비 중"}
                    </strong>
                    <p className="rh-help">
                      원본은 이 브라우저 안에서만 읽어요. 몇 시간짜리 파일도 짧은 조각씩 처리합니다.
                    </p>
                    <progress
                      className="rh-analysis-progress"
                      max={1}
                      value={
                        ((analysisProgress?.ratio ?? 0) +
                          (audioAnalysisProgress?.ratio ?? 0)) /
                        ((analysisProgress === null ? 0 : 1) +
                          (audioAnalysisProgress === null ? 0 : 1))
                      }
                      aria-label="영상과 오디오 반응 분석 진행률"
                    />
                  </>
                )}
                {analysisError !== null && <p role="alert">{analysisError}</p>}
              </div>
            </div>
          )}

          {selectionResult !== null && (
            <section className="rh-panel" aria-labelledby="candidate-title">
              <div className="rh-results-header">
                <div>
                  <p className="rh-eyebrow">3단계 · 사람이 마지막 결정</p>
                  <h3 id="candidate-title" ref={candidateHeading} tabIndex={-1}>먼저 볼 클립 후보 {candidates.length}개</h3>
                  <p className="rh-help">
                    AI가 영상 맥락 {selectionResult.sampledFrameCount.toLocaleString("ko-KR")}개 지점과
                    {selectionResult.analyzedAudioWindowCount === undefined
                      ? " 과거 버전의 화면·채팅 신호를 확인했고"
                      : ` 오디오 ${selectionResult.analyzedAudioWindowCount.toLocaleString("ko-KR")}개 구간을 먼저 살폈고`}
                    {selectionResult.analyzedChatMessageCount > 0
                      ? ` 채팅 ${selectionResult.analyzedChatMessageCount.toLocaleString("ko-KR")}개를 함께 집계했어요.`
                      : " 채팅 기록은 넣지 않았어요."}
                    {" "}
                    후보를 재생한 뒤 쓸 장면만 골라 주세요.
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
                </div>
              </div>

              {openedRecoveredResult !== null && sourcePreviewUrl === null && candidates.length > 0 && (
                <div className="rh-notice rh-notice-with-action" data-tone="warning">
                  <span>후보 시간표는 바로 검토할 수 있어요. 장면 재생은 원래 영상 파일을 다시 연결한 뒤 켜집니다.</span>
                  <button className="btn btn-secondary" type="button" onClick={focusSourceSection}>
                    원본 연결하러 가기
                  </button>
                </div>
              )}

              {candidates.length > 0 && (
                <section
                  className="rh-passb-panel rh-audio-event-panel"
                  aria-labelledby="audio-event-title"
                >
                  <div className="rh-passb-copy">
                    <p className="rh-eyebrow">권장 기능 · 후보 반응 종류 확인</p>
                    <h4 id="audio-event-title">웃음·고함·비명·박수/환호를 더 찾아볼까요?</h4>
                    <p>
                      몇 시간짜리 원본 전체를 다시 보지 않고, 먼저 찾은 후보 {Math.min(12, candidates.length)}개에서
                      반응 정점 주변의 짧은 구간만 AI가 들어요. 후보마다 재생할 위치를 붙이지만,
                      스트리머 마이크와 게임·영상 소리가 섞여 있으므로 직접 들어 보고 판단해 주세요.
                    </p>
                    <p className="rh-help">
                      첫 실행에는 모델 약 91MB를 받고, 이 브라우저에서 로컬 AI를 처음 쓴다면 실행 파일 약 23MB도
                      추가로 받을 수 있어요. 최대 12개 후보에서 후보당 최대 3개의 약 10초 구간만 처리하며,
                      영상·음성·채팅은 어디에도 보내지 않아요.
                    </p>
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
                      <p>이 브라우저에서는 기기 안에서 반응 종류 AI를 실행할 수 없어요. 최신 Chrome이나 Edge에서 다시 열어 주세요.</p>
                    )}
                    {candidateAudioEventError !== null && <p role="alert">{candidateAudioEventError}</p>}
                    {candidateAudioEventWorkStarted && (
                      <p>
                        이 결과는 현재 탭에서 재생 확인을 돕는 임시 단서예요. 후보 점수·순서·구간·검토 상태를
                        바꾸지 않으며, 새로고침하면 사라지고 현재 내보내기 결과에도 포함되지 않아요.
                      </p>
                    )}
                  </div>
                </section>
              )}

              {candidates.length > 0 && (
                <section className="rh-passb-panel" aria-labelledby="pass-b-title">
                  <div className="rh-passb-copy">
                    <p className="rh-eyebrow">선택 기능 · 후보 대사만 자세히</p>
                    <h4 id="pass-b-title">대사 단서를 더 찾아볼까요?</h4>
                    <p>
                      몇 시간짜리 원본 전체가 아니라 위에서 찾은 후보 {Math.min(12, candidates.length)}개만
                      다시 들어 보고, 자동 전사가 추정한 짧은 문구를 반응 전후의 시간 링크로 붙여요.
                      문구는 틀릴 수 있으므로 눌러서 실제 장면을 확인해 주세요.
                    </p>
                    <p className="rh-help">
                      첫 실행에는 약 45~80MB의 음성 AI 파일을 받을 수 있어요. 영상·음성·채팅은
                      어디에도 보내지 않고 이 브라우저 안에서만 처리합니다.
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
                          selectionResult.audioGapReasonCode === "NO_AUDIO_TRACK" ||
                          candidateAudioEventBusy
                        }
                        onClick={() => void runCandidatePassB()}
                      >
                        {candidatePassBRun === null
                          ? "대사 단서 더 보기"
                          : candidatePassBUseCompatibilityMode
                            ? "호환 모드로 다시 시도"
                            : "대사 단서 다시 찾기"}
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
                          ? "실행 방법 확인 중…"
                          : candidatePassBRun?.status === "cancelling"
                            ? "멈추는 중…"
                            : "대사 찾기 멈추기"}
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
                        aria-label="후보 대사 단서 찾기 진행률"
                      />
                    )}
                    {selectionResult.audioGapReasonCode === "NO_AUDIO_TRACK" && (
                      <p>이 원본에는 읽을 소리가 없어 대사 단서 기능을 사용할 수 없어요.</p>
                    )}
                    {!candidatePassBRuntimeAvailable && (
                      <p>이 브라우저에서는 기기 안에서 음성 AI를 실행할 수 없어요. 최신 Chrome이나 Edge에서 다시 열어 주세요.</p>
                    )}
                    {candidatePassBError !== null && <p role="alert">{candidatePassBError}</p>}
                    {candidatePassBWorkStarted && (
                      <p>
                        자동 전사 추정은 현재 탭에서 재생 확인을 돕는 임시 단서예요. 새로고침하면 사라지며,
                        현재 CSV·Markdown·JSON·복사 결과에는 포함되지 않아요.
                      </p>
                    )}
                  </div>
                </section>
              )}

              {candidates.length === 0 ? (
                <div className="rh-empty-state">
                  <strong>뚜렷한 방송 오디오·시청자 반응을 찾지 못했어요.</strong>
                  가짜 후보를 만들지 않고 이번 분석을 마쳤습니다. 오디오가 있는 원본인지 확인하거나 채팅 시간을 맞춰 다시 시도해 주세요.
                </div>
              ) : (
                <>
                  {sourcePreviewUrl !== null && (
                    <div className="rh-preview-panel">
                      <div>
                        <p className="rh-eyebrow">후보 장면 직접 확인</p>
                        <strong>
                          {previewCandidateId === null
                            ? "후보의 ‘이 장면 보기’를 눌러 주세요"
                            : "선택한 후보 위치로 이동했어요"}
                        </strong>
                        {previewCandidateNumber > 0 && (
                          <button
                            className="btn btn-secondary rh-preview-return"
                            type="button"
                            onClick={focusPreviewCandidateEditor}
                          >
                            후보 {previewCandidateNumber}에서 보던 곳으로 돌아가기
                          </button>
                        )}
                      </div>
                      <video
                        ref={previewVideo}
                        className="rh-preview-video"
                        controls
                        playsInline
                        preload="metadata"
                        src={sourcePreviewUrl}
                        onTimeUpdate={(event) => {
                          const activeCandidate = candidates.find(({ id }) => id === previewCandidateId);
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
                    </div>
                  )}
                  <div
                    className="rh-candidate-list"
                    role="list"
                    aria-label="AI가 찾은 클립 후보들"
                  >
                  {candidates.map((candidate, index) => {
                    const narrative = buildCandidatePassBPresentation(
                      candidate.id,
                      buildHighlightNarrative(candidate),
                      candidatePassBEvidenceById[candidate.id],
                    );
                    const candidatePassBOutcome = candidatePassBRun?.candidateOutcomes.find(
                      ({ candidateId }) => candidateId === candidate.id,
                    );
                    const candidatePassBStatusLabel =
                      candidatePassBOutcome?.status === "failed"
                        ? "대사 분석 건너뜀"
                        : candidatePassBOutcome?.status === "pending" && candidatePassBBusy
                          ? candidatePassBRun?.status === "transcribing" &&
                            candidatePassBRun.activeCandidateId === candidate.id
                            ? "대사 확인 중"
                            : "대사 확인 대기"
                          : narrative.passBStatusLabel;
                    const candidateAudioEventEvidence =
                      candidateAudioEventEvidenceById[candidate.id];
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
                    const rangeAdjusted = candidateRangeWasAdjusted(boundaryRevision);
                    const boundaryTouched = (boundaryRevision?.revision ?? 0) > 0;
                    const approvedAfterEdit =
                      candidate.reviewState === "approved" &&
                      candidate.approvedBoundaryRevision !== null &&
                      (boundaryRevision?.revision ?? 0) > candidate.approvedBoundaryRevision;
                    return (
                    <article
                      className="rh-candidate-card rh-candidate-card--signal"
                      data-review-state={candidate.reviewState}
                      role="listitem"
                      aria-labelledby={`candidate-title-${index}`}
                      key={candidate.id}
                    >
                      <div className="rh-candidate-number" aria-hidden="true">#{index + 1}</div>
                      <div className="rh-candidate-main">
                        <div className="rh-candidate-meta">
                          <strong>{formatDuration(effectiveRange.startMs)}–{formatDuration(effectiveRange.endMs)}</strong>
                          <span>상대 신호 {Math.round(candidate.score * 100)}점</span>
                          <span className="rh-review-badge" data-state={candidate.reviewState}>
                            {candidate.reviewState === "approved" ? "사용하기로 함" : candidate.reviewState === "rejected" ? "제외함" : "검토 전"}
                          </span>
                          <span className="rh-interpretation-badge" data-basis={narrative.basis}>
                            {narrative.basisLabel}
                          </span>
                          <span
                            className="rh-passb-badge"
                            data-status={candidatePassBOutcome?.status ?? "idle"}
                          >
                            {candidatePassBStatusLabel}
                          </span>
                          <span
                            className="rh-audio-event-badge"
                            data-status={candidateAudioEventBadgeStatus}
                          >
                            {candidateAudioEventStatusLabel}
                          </span>
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
                        <p className="rh-candidate-title" id={`candidate-title-${index}`}>
                          후보 {index + 1} · {narrative.title}
                        </p>
                        <p className="rh-candidate-reason">{narrative.whyRecommended}</p>
                        <details className="rh-candidate-evidence">
                          <summary aria-label={`후보 ${index + 1}의 사건과 반응 설명 보기`}>
                            무슨 일이 있었고 왜 반응했는지 보기
                          </summary>
                          <dl className="rh-narrative-grid">
                            <div>
                              <dt>무슨 일이 있었나</dt>
                              <dd>{narrative.event}</dd>
                            </div>
                            <div>
                              <dt>방송 오디오 반응 · 주체 확인 필요</dt>
                              <dd>{narrative.streamerReaction}</dd>
                            </div>
                            <div>
                              <dt>시청자 반응</dt>
                              <dd>{narrative.audienceReaction}</dd>
                            </div>
                            <div>
                              <dt>왜 볼 만한가</dt>
                              <dd>{narrative.whyRecommended}</dd>
                            </div>
                            <div>
                              <dt>오디오 반응 종류 AI</dt>
                              <dd>
                                {audioEventPresentation.summary ??
                                  candidateAudioEventStatusLabel}
                              </dd>
                            </div>
                          </dl>
                          <p className="rh-review-hint">{narrative.reviewHint}</p>
                          {audioEventPresentation.caution !== null && (
                            <p className="rh-audio-event-caution">
                              {audioEventPresentation.caution}
                            </p>
                          )}
                          {audioEventPresentation.cues.length > 0 && (
                            <div
                              className="rh-audio-event-cues"
                              aria-label="시간 위치가 있는 오디오 반응 종류 AI 단서"
                            >
                              <strong>눌러서 실제 스트리머 반응인지 확인할 위치</strong>
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
                                        onClick={(event) =>
                                          playCandidateCue(
                                            candidate,
                                            cue.sourceStartMs,
                                            event.currentTarget,
                                          )
                                        }
                                      >
                                        <span>{cue.kindLabel} · {cue.strengthLabel}</span>
                                        <time>
                                          {formatDuration(cue.sourceStartMs)}–{formatDuration(cue.sourceEndMs)}
                                        </time>
                                        <small>혼합 오디오 단서 · 재생 확인 필요</small>
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
                            <div className="rh-transcript-cues" aria-label="시간 위치가 있는 자동 전사 추정">
                              <strong>눌러서 바로 확인할 자동 전사 위치</strong>
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
                                        aria-label={`${formatDuration(cue.absoluteStartMs)} ${cue.phaseLabel}, 자동 전사 추정 “${cue.text}”${cueInsideCurrentRange ? " 재생" : ", 현재 조정한 구간 밖"}`}
                                        onClick={(event) =>
                                          playCandidateCue(
                                            candidate,
                                            cue.absoluteStartMs,
                                            event.currentTarget,
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
                                {candidate.evidence.audio.eventKind === "sustained-vocal-reaction"
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
                              <span className="rh-evidence" data-signal="chat">참여자 {candidate.evidence.chat.uniqueAuthorCount}명</span>
                              <span className="rh-evidence" data-signal="chat">평소의 {candidate.evidence.chat.burstRatio.toFixed(1)}배</span>
                              {candidate.evidence.chat.reactionMessageCount > 0 && (
                                <span className="rh-evidence" data-signal="chat">반응 표현 {candidate.evidence.chat.reactionMessageCount}개</span>
                              )}
                            </>
                          )}
                          </div>
                        </details>
                        <details className="rh-boundary-editor">
                          <summary
                            id={`candidate-boundary-summary-${index}`}
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
                        <div className="rh-inline-actions">
                          <button
                            className="btn btn-secondary"
                            type="button"
                            aria-label={`후보 ${index + 1} 장면 보기`}
                            disabled={sourcePreviewUrl === null}
                            onClick={() => playCandidate(candidate)}
                          >
                            {sourcePreviewUrl === null ? "원본 연결 필요" : "이 장면 보기"}
                          </button>
                          <button
                            className="btn btn-primary"
                            type="button"
                            aria-label={
                              candidate.reviewState === "approved"
                                ? `후보 ${index + 1} 승인 취소`
                                : `후보 ${index + 1} 사용하기`
                            }
                            onClick={() => updateReview(candidate.id, candidate.reviewState === "approved" ? "unreviewed" : "approved")}
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
                            onClick={() => updateReview(candidate.id, candidate.reviewState === "rejected" ? "unreviewed" : "rejected")}
                          >
                            {candidate.reviewState === "rejected" ? "다시 검토" : "빼기"}
                          </button>
                        </div>
                      </div>
                      <div className="rh-confidence">
                        <span>{candidate.evidence.audio === undefined ? "가장 강한 순간" : "반응 정점"}</span>
                        <strong>{formatDuration(candidate.peakMs)}</strong>
                      </div>
                    </article>
                    );
                  })}
                  </div>
                </>
              )}

              <p className="rh-first-result" role="status">
                <span aria-hidden="true">✓</span>
                승인 {approvedCount}개 · 제외 {candidates.filter(({ reviewState }) => reviewState === "rejected").length}개
                {" · 언제든 판단을 바꿀 수 있어요."}
              </p>
              {unsavedSessionWorkStarted && (
                <p className="rh-notice" data-tone="warning" role="status">
                  이 승인·제외 판단, 시작·끝 조정, 자동 전사 추정과 오디오 반응 종류 단서는 아직 저장되지 않았어요.
                  다른 영상이나 결과로 이동하면 확인을 먼저 물어봅니다. 두 AI 단서는 현재 다운로드에도
                  포함되지 않으니, 필요한 후보를 직접 재생해 확인한 뒤 승인해 주세요.
                </p>
              )}

              {candidates.length > 0 && (
                <section className="rh-export-panel" aria-labelledby="export-title">
                  <div className="rh-export-heading">
                    <div>
                      <p className="rh-eyebrow">4단계 · 결과 받기</p>
                      <h3 id="export-title">
                        {approvedCount > 0
                          ? `선택한 장면 ${approvedCount}개가 준비됐어요`
                          : "사용할 장면을 먼저 골라 주세요"}
                      </h3>
                      <p>
                        시작·끝 시간이 담긴 편집용 시간표를 받습니다.
                        현재 기본판은 아직 MP4·WebM 클립 파일을 만들지 않아요.
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
                          const narrative = buildCandidatePassBPresentation(
                            candidate.id,
                            buildHighlightNarrative(candidate),
                            candidatePassBEvidenceById[candidate.id],
                          );
                          const range = effectiveCandidateRange(
                            candidate,
                            boundaryRevision,
                          );
                          return (
                            <li key={candidate.id}>
                              <strong>{formatDuration(range.startMs)}–{formatDuration(range.endMs)}</strong>
                              <span>{narrative.whyRecommended}</span>
                            </li>
                          );
                        })}
                    </ol>
                  )}

                  <div className="rh-export-actions">
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
          Retto Highlight는 공유 서비스가 아닌 개인 편집 어시스턴트입니다. 원본·채팅은 이 탭의 로컬 처리에만 사용됩니다.
        </footer>
      </main>
    </div>
  );
}

export default App;
