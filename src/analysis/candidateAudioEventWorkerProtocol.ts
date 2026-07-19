/**
 * Candidate-only audio-event Worker protocol.
 *
 * The protocol intentionally exposes only the small reaction allowlist below.
 * Raw PCM, model logits, the complete AudioSet label vector, source names, and
 * arbitrary model text must never cross the Worker boundary.
 */

export const CANDIDATE_AUDIO_EVENT_PROTOCOL_VERSION = "1.0.0" as const;

export const CANDIDATE_AUDIO_EVENT_MODEL_ID =
  "Xenova/ast-finetuned-audioset-10-10-0.4593" as const;
export const CANDIDATE_AUDIO_EVENT_MODEL_REVISION =
  "249a1fbf0286b40e7f1ed687a8ae396997bf7dc6" as const;
export const CANDIDATE_AUDIO_EVENT_MODEL_DTYPE = "q8" as const;
export const CANDIDATE_AUDIO_EVENT_RUNTIME_DEVICE = "wasm" as const;
export const CANDIDATE_AUDIO_EVENT_SAMPLE_RATE_HZ = 16_000 as const;

export const MAX_CANDIDATE_AUDIO_EVENT_TARGETS = 12 as const;
export const MAX_CANDIDATE_AUDIO_EVENT_SOURCE_DURATION_MS =
  12 * 60 * 60_000;
export const MAX_CANDIDATE_AUDIO_EVENT_TARGET_DURATION_MS = 60_000;
export const CANDIDATE_AUDIO_EVENT_WINDOW_DURATION_MS = 10_000 as const;
export const MAX_CANDIDATE_AUDIO_EVENT_WINDOWS_PER_TARGET = 3 as const;

export type CandidateAudioEventKind =
  | "laughter"
  | "shout"
  | "scream"
  | "applause-or-cheering";

/** A qualitative projection, not a calibrated probability. */
export type CandidateAudioEventStrength = "strong" | "possible";

export type CandidateAudioEventQuality = "provisional-audio-event";

/**
 * One audio-event run is independent from both the fast pass and transcript
 * Pass B. Every response repeats this complete identity and adds an eventId.
 */
export interface CandidateAudioEventWorkerIdentity {
  readonly protocolVersion: typeof CANDIDATE_AUDIO_EVENT_PROTOCOL_VERSION;
  readonly sessionId: string;
  readonly writerEpoch: number;
  readonly analysisRunId: string;
  readonly audioEventRunId: string;
  readonly workerEpoch: number;
  readonly workerInstanceId: string;
  readonly taskId: string;
}

/** Immutable proposal range and reaction peak selected before the run starts. */
export interface CandidateAudioEventTarget {
  readonly candidateId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly peakMs: number;
}

export type CandidateAudioEventWorkerRequest =
  | {
      readonly type: "candidate-audio-event-analyze";
      readonly identity: CandidateAudioEventWorkerIdentity;
      readonly file: File;
      readonly sourceDurationMs: number;
      readonly targets: readonly CandidateAudioEventTarget[];
    }
  | {
      readonly type: "candidate-audio-event-cancel";
      readonly identity: CandidateAudioEventWorkerIdentity;
    };

export interface CandidateAudioEventModelProgress {
  readonly stage: "loading" | "ready";
  readonly ratio: number;
  readonly loadedBytes: number | null;
  readonly totalBytes: number | null;
}

export interface CandidateAudioEventCandidateProgress {
  readonly candidateId: string;
  /** One-based position in the immutable, score-ordered target list. */
  readonly candidateOrdinal: number;
  readonly targetCount: number;
  readonly stage: "decoding" | "classifying" | "complete" | "gap";
  readonly ratio: number;
}

export interface CandidateAudioEventDetection {
  readonly kind: CandidateAudioEventKind;
  readonly strength: CandidateAudioEventStrength;
  /** Absolute timestamp in the original source. */
  readonly sourceStartMs: number;
  /** Absolute timestamp in the original source. */
  readonly sourceEndMs: number;
}

export interface CandidateAudioEventModelDescriptor {
  readonly id: typeof CANDIDATE_AUDIO_EVENT_MODEL_ID;
  readonly revision: typeof CANDIDATE_AUDIO_EVENT_MODEL_REVISION;
  readonly dtype: typeof CANDIDATE_AUDIO_EVENT_MODEL_DTYPE;
  readonly device: typeof CANDIDATE_AUDIO_EVENT_RUNTIME_DEVICE;
}

interface CandidateAudioEventResultBase {
  readonly mode: "candidate-audio-event";
  readonly candidateId: string;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly reactionPeakMs: number;
  readonly analyzedWindowCount: number;
  readonly quality: CandidateAudioEventQuality;
  readonly model: CandidateAudioEventModelDescriptor;
  readonly sampleRateHz: typeof CANDIDATE_AUDIO_EVENT_SAMPLE_RATE_HZ;
}

export interface CandidateAudioEventDetectedResult
  extends CandidateAudioEventResultBase {
  readonly status: "detected";
  readonly detections: readonly [
    CandidateAudioEventDetection,
    ...CandidateAudioEventDetection[],
  ];
}

export type CandidateAudioEventNoClearReason =
  | "NO_ALLOWLIST_EVENT"
  | "LOW_EVENT_CONFIDENCE"
  | "NOISY_AUDIO";

export interface CandidateAudioEventNoClearResult
  extends CandidateAudioEventResultBase {
  readonly status: "no-clear-event";
  readonly reasonCode: CandidateAudioEventNoClearReason;
  readonly detections: readonly [];
}

export type CandidateAudioEventCandidateResult =
  | CandidateAudioEventDetectedResult
  | CandidateAudioEventNoClearResult;

export type CandidateAudioEventCandidateGapReason =
  | "NO_AUDIO_TRACK"
  | "UNSUPPORTED_CONTAINER"
  | "UNSUPPORTED_AUDIO_CODEC"
  | "EMPTY_AUDIO"
  | "AUDIO_DECODE_FAILED"
  | "CLASSIFICATION_FAILED";

export interface CandidateAudioEventCandidateGap {
  readonly candidateId: string;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly reactionPeakMs: number;
  readonly reasonCode: CandidateAudioEventCandidateGapReason;
  readonly message: string;
}

export interface CandidateAudioEventCompletionSummary {
  readonly requestedCount: number;
  /** Detected and no-clear results both count as completed candidate results. */
  readonly completedCount: number;
  readonly gapCount: number;
}

export type CandidateAudioEventWorkerFailureReason =
  | "INVALID_REQUEST"
  | "WORKER_BUSY"
  | "MODEL_LOAD_FAILED"
  | "UNEXPECTED_WORKER_FAILURE";

export type CandidateAudioEventWorkerResponsePayload =
  | {
      readonly type: "candidate-audio-event-model-progress";
      readonly progress: CandidateAudioEventModelProgress;
    }
  | {
      readonly type: "candidate-audio-event-candidate-progress";
      readonly progress: CandidateAudioEventCandidateProgress;
    }
  | {
      readonly type: "candidate-audio-event-partial-result";
      readonly result: CandidateAudioEventCandidateResult;
    }
  | {
      readonly type: "candidate-audio-event-candidate-gap";
      readonly gap: CandidateAudioEventCandidateGap;
    }
  | {
      readonly type: "candidate-audio-event-completed";
      readonly summary: CandidateAudioEventCompletionSummary;
    }
  | {
      readonly type: "candidate-audio-event-cancel-acknowledged";
    }
  | {
      readonly type: "candidate-audio-event-failed";
      readonly reasonCode: CandidateAudioEventWorkerFailureReason;
      readonly message: string;
    };

export type CandidateAudioEventWorkerResponse =
  CandidateAudioEventWorkerIdentity &
    CandidateAudioEventWorkerResponsePayload & {
      readonly eventId: string;
    };
