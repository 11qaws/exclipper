/** Provider-specific IDs plus the currently deployed default. */
export const CANDIDATE_PASS_B_GEMINI_MODEL_ID = "gemini-3.6-flash" as const;
export const CANDIDATE_PASS_B_GEMINI_MODEL_REVISION =
  "gemini-3.6-flash-grounded-frames-v3-2026-07-22" as const;
export const CANDIDATE_PASS_B_LEGACY_GEMINI_MODEL_ID =
  "gemini-3.5-flash" as const;
export const CANDIDATE_PASS_B_LEGACY_GEMINI_MODEL_REVISION =
  "gemini-3.5-flash-grounded-frames-v2-2026-07-22" as const;
export const CANDIDATE_PASS_B_QWEN_MODEL_ID = "qwen3.5-omni-flash" as const;
export const CANDIDATE_PASS_B_QWEN_MODEL_REVISION =
  "qwen3.5-omni-flash-grounded-frames-v2-2026-07-22" as const;
export const CANDIDATE_PASS_B_MODEL_ID = CANDIDATE_PASS_B_QWEN_MODEL_ID;
export const CANDIDATE_PASS_B_MODEL_REVISION = CANDIDATE_PASS_B_QWEN_MODEL_REVISION;
export const CANDIDATE_PASS_B_ROUTING_MODEL_ID =
  "exclipper-candidate-perception-route" as const;
export const CANDIDATE_PASS_B_ROUTING_MODEL_REVISION =
  "qwen3.5-omni-flash_then_gemini-3.6-flash_bounded-v3" as const;
export const CANDIDATE_PASS_B_LEGACY_ROUTING_MODEL_REVISION =
  "qwen3.5-omni-flash_then_gemini-3.5-flash_bounded-v2" as const;

/** Keeps already-paid v2 candidate interpretations recoverable after the GA upgrade. */
export function isCompatibleCandidatePassBRoutingModelRevision(
  value: unknown,
): value is
  | typeof CANDIDATE_PASS_B_ROUTING_MODEL_REVISION
  | typeof CANDIDATE_PASS_B_LEGACY_ROUTING_MODEL_REVISION {
  return (
    value === CANDIDATE_PASS_B_ROUTING_MODEL_REVISION ||
    value === CANDIDATE_PASS_B_LEGACY_ROUTING_MODEL_REVISION
  );
}
export const CANDIDATE_PASS_B_RESPONSE_MODEL_ID_HEADER =
  "X-ExClipper-Model-Id" as const;
export const CANDIDATE_PASS_B_RESPONSE_MODEL_REVISION_HEADER =
  "X-ExClipper-Model-Revision" as const;
export const CANDIDATE_PASS_B_RESPONSE_FALLBACK_HEADER =
  "X-ExClipper-Fallback-Used" as const;
export const CANDIDATE_PASS_B_DTYPE = "remote" as const;
export const CANDIDATE_PASS_B_DEVICE = "remote" as const;
export const CANDIDATE_PASS_B_LANGUAGE = "korean" as const;
export const CANDIDATE_PASS_B_TASK = "transcribe-and-explain" as const;
export const CANDIDATE_PASS_B_SAMPLE_RATE_HZ = 16_000 as const;
export const MAX_CANDIDATE_PASS_B_TARGETS = 12 as const;
export const MAX_CANDIDATE_PASS_B_SOURCE_DURATION_MS = 12 * 60 * 60_000;
export const MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS = 60_000;
export const MAX_CANDIDATE_PASS_B_VIDEO_FRAMES = 4;
export const MAX_CANDIDATE_PASS_B_VIDEO_FRAME_BASE64_LENGTH = 360_000;

export interface CandidatePassBVideoFrame {
  /** Timestamp relative to the candidate range. */
  readonly timestampMs: number;
  readonly mimeType: "image/jpeg";
  readonly dataBase64: string;
}

/**
 * A Pass B run has its own identity in addition to the fast-pass analysis run.
 * Every response adds a unique eventId before it crosses the Worker boundary.
 */
export interface CandidatePassBWorkerIdentity {
  readonly sessionId: string;
  readonly writerEpoch: number;
  readonly analysisRunId: string;
  readonly passBRunId: string;
  readonly workerEpoch: number;
  readonly workerInstanceId: string;
  readonly taskId: string;
}

export interface CandidatePassBTarget {
  readonly candidateId: string;
  readonly startMs: number;
  readonly endMs: number;
  /** Optional representative screenshots sampled from this candidate. */
  readonly videoFrames?: readonly CandidatePassBVideoFrame[];
}

/**
 * The legacy values remain in the public type until the old runtime selector is
 * removed. Analyze requests and result manifests accept only `remote`.
 */
export type CandidatePassBDevice = "webgpu" | "wasm" | "remote";

export type CandidatePassBWorkerRequest =
  | {
      readonly type: "candidate-pass-b-analyze";
      readonly identity: CandidatePassBWorkerIdentity;
      readonly file: File;
      readonly sourceDurationMs: number;
      readonly device: typeof CANDIDATE_PASS_B_DEVICE;
      readonly targets: readonly CandidatePassBTarget[];
    }
  | {
      readonly type: "candidate-pass-b-cancel";
      readonly identity: CandidatePassBWorkerIdentity;
    };

export interface CandidatePassBModelProgress {
  readonly stage: "loading" | "ready";
  readonly ratio: number;
  readonly loadedBytes: number | null;
  readonly totalBytes: number | null;
}

export interface CandidatePassBCandidateProgress {
  readonly candidateId: string;
  /** One-based position in the score-ordered target list. */
  readonly candidateOrdinal: number;
  readonly targetCount: number;
  readonly stage: "decoding" | "transcribing" | "complete" | "gap";
  readonly ratio: number;
}

export interface CandidatePassBTranscriptSegment {
  /** Absolute timestamp in the original source. */
  readonly startMs: number;
  /** Absolute timestamp in the original source. */
  readonly endMs: number;
  readonly text: string;
}

/** Safe, API-key-free interpretation grounded in candidate audio and sampled video. */
export interface CandidatePassBInsight {
  readonly eventSummaryKo: string;
  readonly reactionSummaryKo: string;
  readonly whyGoodClipKo: string;
  readonly uncertaintiesKo: readonly string[];
  /** Absent only on sessions saved before insight schema 1.2.0. */
  readonly identifiedParticipants?: readonly CandidatePassBParticipantAttribution[];
}

export type CandidatePassBParticipantRole = "streamer" | "guest" | "unknown";
export type CandidatePassBParticipantEvidenceBasis =
  | "on-screen-name"
  | "spoken-name"
  | "provided-cast-reference";

export interface CandidatePassBParticipantAttribution {
  readonly displayName: string;
  readonly role: CandidatePassBParticipantRole;
  readonly evidenceBasis: CandidatePassBParticipantEvidenceBasis;
  readonly evidenceKo: string;
  readonly confidence: number;
  readonly relativeTimestampMs: number;
}

export interface CandidatePassBTranscriptResult {
  readonly mode: "candidate-pass-b-transcript";
  readonly candidateId: string;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly text: string;
  readonly segments: readonly CandidatePassBTranscriptSegment[];
  readonly insight: CandidatePassBInsight;
  readonly model: {
    readonly id:
      | typeof CANDIDATE_PASS_B_QWEN_MODEL_ID
      | typeof CANDIDATE_PASS_B_GEMINI_MODEL_ID;
    readonly revision:
      | typeof CANDIDATE_PASS_B_QWEN_MODEL_REVISION
      | typeof CANDIDATE_PASS_B_GEMINI_MODEL_REVISION;
    readonly dtype: typeof CANDIDATE_PASS_B_DTYPE;
    readonly device: typeof CANDIDATE_PASS_B_DEVICE;
  };
  readonly language: typeof CANDIDATE_PASS_B_LANGUAGE;
  readonly task: typeof CANDIDATE_PASS_B_TASK;
  readonly sampleRateHz: typeof CANDIDATE_PASS_B_SAMPLE_RATE_HZ;
}

export type CandidatePassBCandidateGapReason =
  | "NO_AUDIO_TRACK"
  | "UNSUPPORTED_CONTAINER"
  | "UNSUPPORTED_AUDIO_CODEC"
  | "EMPTY_AUDIO"
  | "AUDIO_DECODE_FAILED"
  | "TRANSCRIPTION_FAILED";

export interface CandidatePassBCandidateGap {
  readonly candidateId: string;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly reasonCode: CandidatePassBCandidateGapReason;
  readonly message: string;
}

export interface CandidatePassBCompletionSummary {
  readonly requestedCount: number;
  readonly completedCount: number;
  readonly gapCount: number;
}

export type CandidatePassBWorkerFailureReason =
  | "INVALID_REQUEST"
  | "WORKER_BUSY"
  | "PROXY_AUTH_REJECTED"
  | "PROXY_BAD_REQUEST"
  | "PROXY_RATE_LIMITED"
  | "PROXY_UNAVAILABLE"
  | "PROXY_INVALID_RESPONSE"
  | "PROXY_REQUEST_REJECTED"
  | "UNEXPECTED_WORKER_FAILURE";

export function candidatePassBWorkerFailureMessage(
  reasonCode: CandidatePassBWorkerFailureReason,
): string {
  switch (reasonCode) {
    case "INVALID_REQUEST":
      return "후보 정밀 분석 요청이 올바르지 않아요.";
    case "WORKER_BUSY":
      return "후보 정밀 분석 작업 공간이 이미 사용 중이에요.";
    case "PROXY_AUTH_REJECTED":
      return "ExClipper AI 서비스 인증을 확인하지 못했어요.";
    case "PROXY_BAD_REQUEST":
      return "ExClipper AI 서비스가 후보 분석 요청을 받아들이지 않았어요.";
    case "PROXY_RATE_LIMITED":
      return "ExClipper AI 사용 한도에 도달했어요. 잠시 후 다시 시도해 주세요.";
    case "PROXY_UNAVAILABLE":
      return "ExClipper AI 서비스에 연결하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.";
    case "PROXY_INVALID_RESPONSE":
      return "ExClipper AI 응답을 안전하게 읽지 못했어요. 다시 시도해 주세요.";
    case "PROXY_REQUEST_REJECTED":
      return "ExClipper AI 서비스가 후보 분석 요청을 완료하지 못했어요.";
    case "UNEXPECTED_WORKER_FAILURE":
      return "후보 정밀 분석 작업이 예기치 않게 멈췄어요.";
  }
}

export type CandidatePassBWorkerResponsePayload =
  | {
      readonly type: "candidate-pass-b-model-progress";
      readonly progress: CandidatePassBModelProgress;
    }
  | {
      readonly type: "candidate-pass-b-candidate-progress";
      readonly progress: CandidatePassBCandidateProgress;
    }
  | {
      readonly type: "candidate-pass-b-partial-result";
      readonly result: CandidatePassBTranscriptResult;
    }
  | {
      readonly type: "candidate-pass-b-candidate-gap";
      readonly gap: CandidatePassBCandidateGap;
    }
  | {
      readonly type: "candidate-pass-b-completed";
      readonly summary: CandidatePassBCompletionSummary;
    }
  | {
      readonly type: "candidate-pass-b-cancel-acknowledged";
    }
  | {
      readonly type: "candidate-pass-b-failed";
      readonly reasonCode: CandidatePassBWorkerFailureReason;
      readonly message: string;
    };

export type CandidatePassBWorkerResponse = CandidatePassBWorkerIdentity &
  CandidatePassBWorkerResponsePayload & {
    readonly eventId: string;
  };
