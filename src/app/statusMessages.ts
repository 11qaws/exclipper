/**
 * Every Korean sentence the app shows for a status, label or failure.
 *
 * Keeping the copy in one module makes the product voice reviewable on its own
 * and keeps `App.tsx` about behaviour rather than wording. Each function is
 * pure so the tone can be regression-tested without rendering.
 */
import { candidateAudioEventKindLabel } from "../analysis/candidateAudioEventPresentation";
import type { CandidateAudioEventEvidenceById } from "../analysis/candidateAudioEventEvidenceState";
import type { CandidateAudioEventCandidateGap } from "../analysis/candidateAudioEventWorkerClient";
import { CandidateAudioEventWorkerError } from "../analysis/candidateAudioEventWorkerClient";
import { CandidatePassBWorkerError } from "../analysis/candidatePassBWorkerClient";
import type { CandidateEvidenceUnknown } from "../analysis/candidateEvidenceExplanation";
import type { CandidateRankingEntry } from "../analysis/candidateRanking";
import type { BroadcastContextDiscoveredLeadCategory } from "../analysis/broadcastContextProtocol";
import { ChatAnalysisWorkerError } from "../analysis/chatAnalysisWorkerClient";
import type { AnalysisRunState } from "../domain/analysisRun";
import type { CandidateBoundaryRejectionReason } from "../domain/candidateBoundaryRevision";
import type { SourceCheckState } from "../domain/sourceCheck";
import { LocalAudioReactionAnalysisError } from "../media/localAudioReactionAnalysis";
import { LocalMediaPreflightError } from "../media/localMediaPreflight";
import { LocalVideoVisualAnalysisError } from "../media/localVideoVisualAnalysis";
import { LocalFileFingerprintError } from "../security/localFileFingerprint";
import { AnalysisResultStoreError } from "../storage/analysisResultStore";

export function candidateAudioEventGapStatusLabel(
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

export function candidateEvidenceUnknownLabel(
  value: CandidateEvidenceUnknown,
): string {
  switch (value) {
    case "event":
      return "실제 사건의 종류";
    case "actor":
      return "반응이나 대사의 주체";
    case "cause":
      return "반응의 원인";
    case "outcome":
      return "사건의 결과";
  }
}

export function candidateRankingReasonText(
  entry: CandidateRankingEntry,
  audioEventEvidence: CandidateAudioEventEvidenceById[string] | undefined,
): string {
  const hasStrongAudioEvent = entry.reasonCodes.includes("strong-audio-event");
  const hasPossibleAudioEvent = entry.reasonCodes.includes("possible-audio-event");
  if (
    (hasStrongAudioEvent || hasPossibleAudioEvent) &&
    audioEventEvidence?.status === "detected"
  ) {
    const labels = [
      ...new Set(
        audioEventEvidence.detections
          .filter(({ strength }) =>
            hasStrongAudioEvent ? strength === "strong" : strength === "possible",
          )
          .map(({ kind }) => candidateAudioEventKindLabel(kind)),
      ),
    ];
    const reactionLabel = labels.length > 0 ? labels.join("·") : "반응 종류";
    return hasStrongAudioEvent
      ? `혼합 오디오에서 ${reactionLabel} 단서가 뚜렷해 먼저 확인하도록 제안했어요.`
      : `혼합 오디오에서 ${reactionLabel} 가능성이 있어 조금 먼저 확인하도록 제안했어요.`;
  }
  if (entry.reasonCodes.includes("audio-chat-agreement")) {
    return "방송 오디오 반응과 채팅 반응이 같은 구간에 모였어요.";
  }
  if (entry.reasonCodes.includes("fast-audio-reaction")) {
    return "방송 오디오의 반응 정점이 잡혀 먼저 재생해 볼 가치가 있어요.";
  }
  if (entry.reasonCodes.includes("fast-chat-reaction")) {
    return "채팅 반응이 평소보다 몰린 구간이에요.";
  }
  return "화면 변화만 남은 탐색 후보라 다른 반응 후보 뒤에서 확인하도록 제안했어요.";
}

export function candidateRankingTranscriptNote(
  entry: CandidateRankingEntry,
): string | null {
  if (entry.reasonCodes.includes("grounded-transcript-cue")) {
    return "재생해 볼 대사 위치도 있어요. 대사 유무 자체는 순위 점수에 더하지 않았어요.";
  }
  if (entry.reasonCodes.includes("provisional-transcript-cue")) {
    return "AI 대사 추정 위치도 있지만 틀릴 수 있어 순위 점수에는 더하지 않았어요.";
  }
  return null;
}

export function sourceCheckLabel(state: SourceCheckState | null): string {
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

export function analysisRunLabel(state: AnalysisRunState | null): string {
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

export function semanticLeadCategoryLabel(
  category: BroadcastContextDiscoveredLeadCategory,
): string {
  return {
    reaction: "특징적 반응",
    "quiet-achievement": "조용한 성취",
    "setup-and-payoff": "설정과 회수",
    "running-gag": "반복 개그",
    "context-dependent": "맥락형 사건",
    "apology-accountability": "사과·해명",
  }[category];
}

export function boundaryRejectionMessage(
  reason: CandidateBoundaryRejectionReason,
): string {
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

export function assessLink(value: string): string {
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

export function explainCandidatePassBError(error: unknown): string {
  if (error instanceof CandidatePassBWorkerError) {
    const diagnosticSuffix = error.workerReasonCode
      ? ` (오류 코드: ${error.workerReasonCode})`
      : "";
    if (error.code === "ABORTED") {
      return `AI 후보 분석을 멈췄어요. 이미 찾은 단서는 이 탭에서 그대로 볼 수 있어요.${diagnosticSuffix}`;
    }
    switch (error.workerReasonCode) {
      case "PROXY_AUTH_REJECTED":
        return `AI 연결 설정을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요. 기존 후보는 그대로 사용할 수 있어요.${diagnosticSuffix}`;
      case "PROXY_BAD_REQUEST":
        return `AI가 앱의 요청 형식을 받을 수 없었어요. 자동 재시도하지 않았습니다. 앱을 새로고침하거나 최신 버전을 확인해 주세요. 기존 후보는 그대로 사용할 수 있어요.${diagnosticSuffix}`;
      case "PROXY_RATE_LIMITED":
        return `AI 분석 요청이 잠시 많아요. 1분 정도 기다린 뒤 직접 다시 시도해 주세요. 자동으로 반복 요청하지 않았어요.${diagnosticSuffix}`;
      case "PROXY_UNAVAILABLE":
        return `AI에 연결하지 못했어요. 인터넷 연결을 확인한 뒤 원할 때 다시 시도해 주세요. 기존 후보는 그대로 사용할 수 있어요.${diagnosticSuffix}`;
      case "PROXY_INVALID_RESPONSE":
        return `AI 답변을 안전한 후보 단서로 확인하지 못했어요. 잘못된 문장은 표시하지 않았고 기존 후보는 그대로예요.${diagnosticSuffix}`;
      case "PROXY_REQUEST_REJECTED":
        return `AI가 후보 분석 요청을 완료하지 못했어요. 잠시 뒤 다시 시도해 주세요.${diagnosticSuffix}`;
    }
    return `AI 후보 분석을 끝까지 마치지 못했어요.${diagnosticSuffix}`;
  }
  return "AI 후보 분석을 끝까지 마치지 못했어요. 기존 오디오·채팅 근거와 후보는 그대로 사용할 수 있어요.";
}

export function explainCandidateAudioEventError(error: unknown): string {
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

export function explainAnalysisError(error: unknown): string {
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
    return "사이트 저장 공간에 결과를 확정하지 못했어요. 시크릿 모드를 끄거나 사이트 저장 권한을 허용해 주세요.";
  }
  return "후보를 찾는 중 예상하지 못한 문제가 생겼어요. 원본과 채팅을 확인한 뒤 다시 시도해 주세요.";
}

export function explainPreflightError(error: unknown): string {
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

export function explainClipRenderError(error: unknown): string {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : null;
  if (code !== null) {
    switch (code) {
      case "ABORTED":
        return "클립 만들기를 취소했어요.";
      case "UNSUPPORTED_SOURCE":
        return "이 영상 형식은 현재 브라우저에서 클립 파일로 만들 수 없어요. MP4 또는 WebM 원본으로 다시 시도해 주세요.";
      case "NO_OUTPUT":
        return "클립 파일이 비어 있어 저장하지 못했어요. 같은 구간을 다시 시도해 주세요.";
      case "INVALID_RANGE":
        return "클립 구간이 올바르지 않아요. 시작과 끝을 다시 확인해 주세요.";
    }
  }
  return "클립 파일을 만들지 못했어요. 원본을 다시 연결한 뒤 한 번 더 시도해 주세요.";
}
