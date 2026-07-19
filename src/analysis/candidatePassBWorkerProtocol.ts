export const CANDIDATE_PASS_B_MODEL_ID =
  "onnx-community/whisper-tiny" as const;
export const CANDIDATE_PASS_B_MODEL_REVISION =
  "ff4177021cc41f7db950912b73ea4fdf7d01d8e7" as const;
export const CANDIDATE_PASS_B_DTYPE = "q8" as const;
export const CANDIDATE_PASS_B_LANGUAGE = "korean" as const;
export const CANDIDATE_PASS_B_TASK = "transcribe" as const;
export const CANDIDATE_PASS_B_SAMPLE_RATE_HZ = 16_000 as const;
export const MAX_CANDIDATE_PASS_B_TARGETS = 12 as const;
export const MAX_CANDIDATE_PASS_B_SOURCE_DURATION_MS = 12 * 60 * 60_000;
export const MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS = 2 * 60_000;

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
}

export type CandidatePassBDevice = "webgpu" | "wasm";

export type CandidatePassBWorkerRequest =
  | {
      readonly type: "candidate-pass-b-analyze";
      readonly identity: CandidatePassBWorkerIdentity;
      readonly file: File;
      readonly sourceDurationMs: number;
      readonly device: CandidatePassBDevice;
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

export interface CandidatePassBTranscriptResult {
  readonly mode: "candidate-pass-b-transcript";
  readonly candidateId: string;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly text: string;
  readonly segments: readonly CandidatePassBTranscriptSegment[];
  readonly model: {
    readonly id: typeof CANDIDATE_PASS_B_MODEL_ID;
    readonly revision: typeof CANDIDATE_PASS_B_MODEL_REVISION;
    readonly dtype: typeof CANDIDATE_PASS_B_DTYPE;
    readonly device: CandidatePassBDevice;
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
  | "MODEL_LOAD_FAILED"
  | "UNEXPECTED_WORKER_FAILURE";

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

