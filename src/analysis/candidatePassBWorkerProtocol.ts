/** Google AI's official Gemini 3.1 Pro Preview model identifier. */
export const CANDIDATE_PASS_B_MODEL_ID = "gemini-3.1-pro-preview" as const;
export const CANDIDATE_PASS_B_MODEL_REVISION = "3.1-pro-preview-07-2026" as const;
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
    readonly id: typeof CANDIDATE_PASS_B_MODEL_ID;
    readonly revision: typeof CANDIDATE_PASS_B_MODEL_REVISION;
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
