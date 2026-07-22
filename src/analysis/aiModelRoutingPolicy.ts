import {
  createBroadcastContextSamplingPlan,
  createBroadcastContextTranscriptionChunks,
} from "./broadcastContextSamplingPlan";
import { MAX_BROADCAST_TRANSCRIPT_WORKER_CHUNKS } from "./broadcastTranscriptWorkerProtocol";

export const AI_MODEL_ROUTING_POLICY_VERSION = "1.11.0" as const;
/** Context scheduling or model-role changes must fence incompatible cached results. */
export const AI_BROADCAST_CONTEXT_ROUTING_REVISION = "1.10.0" as const;

export const EXCLIPPER_MODEL_IDS = {
  candidatePerceptionPrimary: "qwen3.5-omni-flash",
  candidatePerceptionFallback: "gemini-3.6-flash",
  candidateAdjudicationPrimary: "qwen3.7-plus",
  candidateAdjudicationFallback: "gemini-3.6-flash",
  broadcastTranscription: "qwen3.5-omni-flash",
  broadcastVisualChaptering: "qwen3.5-omni-flash",
  broadcastContextReasoning: "qwen3.7-plus",
  broadcastContextReasoningFallback: "qwen3.6-flash",
  broadcastContextEmergencyFallback: "deepseek-v4-pro",
} as const;

export type AiAnalysisStage =
  | "candidate-perception"
  | "candidate-adjudication"
  | "broadcast-transcription"
  | "broadcast-visual-chaptering"
  | "broadcast-context-reasoning";

export interface AiAnalysisPlanStep {
  readonly stage: AiAnalysisStage;
  readonly primaryModelId: string;
  readonly fallbackModelId: string | null;
  readonly maximumCalls: number;
  readonly inputScope:
    | "candidate-av"
    | "sampled-audio"
    | "sampled-video"
    | "compressed-text-context"
    | "compressed-candidate-evidence";
  readonly purposeKo: string;
}

export interface AiAnalysisRoutingPlan {
  readonly policyVersion: typeof AI_MODEL_ROUTING_POLICY_VERSION;
  readonly sourceDurationMs: number;
  readonly fastPassCandidateCount: number;
  readonly steps: readonly AiAnalysisPlanStep[];
}

const MAX_SOURCE_DURATION_MS = 12 * 60 * 60_000;
const MAX_DETAIL_CANDIDATES = 12;
const MAX_PRO_ADJUDICATION_CANDIDATES = 3;
const QWEN_VISUAL_VIDEO_LIMIT_MS = 2 * 60 * 60_000;
const MAX_EVENT_TRANSCRIPT_REQUEST_HEADROOM = 24;
const MAX_BROADCAST_CONTEXT_REASONING_CALLS = 26;

/**
 * Creates a bounded role-based plan; it does not make paid calls. Qwen Omni
 * perceives and transcribes, Qwen 3.7 Plus builds the overview and final jury,
 * Qwen 3.6 Flash discovers events and localizes jury-approved events, while
 * topic-balanced reserves retain the Qwen 3.7 quality gate,
 * and the expensive/optional adjudicator is restricted to a few uncertain
 * final cases. DeepSeek V4 Pro remains a credential-gated emergency transport,
 * not an automatic paid retry.
 */
export function createAiAnalysisRoutingPlan(
  sourceDurationMs: number,
  fastPassCandidateCount: number,
): AiAnalysisRoutingPlan {
  if (
    !Number.isSafeInteger(sourceDurationMs) ||
    sourceDurationMs <= 0 ||
    sourceDurationMs > MAX_SOURCE_DURATION_MS
  ) {
    throw new RangeError(
      "AI analysis source duration must be between 1 ms and 12 hours.",
    );
  }
  if (!Number.isSafeInteger(fastPassCandidateCount) || fastPassCandidateCount < 0) {
    throw new RangeError("Fast-pass candidate count must be a non-negative integer.");
  }

  const candidateCalls = Math.min(fastPassCandidateCount, MAX_DETAIL_CANDIDATES);
  const adjudicationCalls = Math.min(
    candidateCalls,
    MAX_PRO_ADJUDICATION_CANDIDATES,
  );
  const visualChunks = Math.ceil(sourceDurationMs / QWEN_VISUAL_VIDEO_LIMIT_MS);
  const baselineTranscriptPlan = createBroadcastContextSamplingPlan(
    sourceDurationMs,
    [],
  );
  const baselineTranscriptChunks = createBroadcastContextTranscriptionChunks(
    baselineTranscriptPlan.samplingWindows,
  ).length;
  const transcriptionChunks =
    baselineTranscriptPlan.estimatedAudioCoverageRatio === 1
      ? baselineTranscriptChunks
      : Math.min(
          MAX_BROADCAST_TRANSCRIPT_WORKER_CHUNKS,
          baselineTranscriptChunks + MAX_EVENT_TRANSCRIPT_REQUEST_HEADROOM,
        );

  return {
    policyVersion: AI_MODEL_ROUTING_POLICY_VERSION,
    sourceDurationMs,
    fastPassCandidateCount,
    steps: [
      {
        stage: "candidate-perception",
        primaryModelId: EXCLIPPER_MODEL_IDS.candidatePerceptionPrimary,
        fallbackModelId: EXCLIPPER_MODEL_IDS.candidatePerceptionFallback,
        maximumCalls: candidateCalls,
        inputScope: "candidate-av",
        purposeKo: "빠른 후보의 한국어 대사·화면 사건·스트리머 반응 구조화",
      },
      {
        stage: "broadcast-transcription",
        primaryModelId: EXCLIPPER_MODEL_IDS.broadcastTranscription,
        fallbackModelId: null,
        maximumCalls: transcriptionChunks,
        inputScope: "sampled-audio",
        purposeKo: "방송 전 구간의 한국어 대사 지도를 만들어 조용한 의미 사건도 찾기",
      },
      {
        stage: "broadcast-visual-chaptering",
        primaryModelId: EXCLIPPER_MODEL_IDS.broadcastVisualChaptering,
        fallbackModelId: null,
        maximumCalls: visualChunks,
        inputScope: "sampled-video",
        purposeKo: "최대 2시간 단위 화면 표본으로 게임·장면·휴식 구간 파악",
      },
      {
        stage: "broadcast-context-reasoning",
        primaryModelId: EXCLIPPER_MODEL_IDS.broadcastContextReasoning,
        fallbackModelId: EXCLIPPER_MODEL_IDS.broadcastContextReasoningFallback,
        maximumCalls: MAX_BROADCAST_CONTEXT_REASONING_CALLS,
        inputScope: "compressed-text-context",
        purposeKo: "3.7 전체 개요·비교 배심·예비 단서 검증과 3.6 전 구간 탐색·승인 단서 위치 확인",
      },
      {
        stage: "candidate-adjudication",
        primaryModelId: EXCLIPPER_MODEL_IDS.candidateAdjudicationPrimary,
        fallbackModelId: EXCLIPPER_MODEL_IDS.candidateAdjudicationFallback,
        maximumCalls: adjudicationCalls,
        inputScope: "compressed-candidate-evidence",
        purposeKo: "사과·조용한 성취·맥락 의존 장면처럼 어려운 소수 후보만 재판정",
      },
    ],
  };
}
