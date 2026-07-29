import type { CandidatePassBCastRosterId } from "./participantRoster";
import type { AnalysisLanguage } from "../domain/analysisLanguage";

/** Provider-specific IDs plus the currently deployed default. */
export const CANDIDATE_PASS_B_GEMINI_MODEL_ID = "gemini-3.6-flash" as const;
export const CANDIDATE_PASS_B_GEMINI_MODEL_REVISION =
  "gemini-3.6-flash-context-verified-frames-v8-2026-07-23" as const;
export const CANDIDATE_PASS_B_QWEN_MODEL_ID = "qwen3.5-omni-flash" as const;
export const CANDIDATE_PASS_B_QWEN_MODEL_REVISION =
  "qwen3.5-omni-flash-context-verified-frames-v7-2026-07-23" as const;
export const CANDIDATE_PASS_B_MODEL_ID = CANDIDATE_PASS_B_QWEN_MODEL_ID;
export const CANDIDATE_PASS_B_MODEL_REVISION = CANDIDATE_PASS_B_QWEN_MODEL_REVISION;
export const CANDIDATE_PASS_B_ROUTING_MODEL_ID =
  "exclipper-candidate-perception-route" as const;
export const CANDIDATE_PASS_B_ROUTING_MODEL_REVISION =
  "qwen3.5-omni-flash_then_gemini-3.6-flash_durable-multimodal-v9" as const;

export type CandidatePassBRoutingModelRevision =
  typeof CANDIDATE_PASS_B_ROUTING_MODEL_REVISION;
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
export const MAX_CANDIDATE_PASS_B_TARGETS = 32 as const;
export const MAX_CANDIDATE_PASS_B_SOURCE_DURATION_MS = 12 * 60 * 60_000;
export const MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS = 60_000;
export const MAX_CANDIDATE_PASS_B_VIDEO_FRAMES = 4;
export const MAX_CANDIDATE_PASS_B_VIDEO_FRAME_BASE64_LENGTH = 360_000;
export const CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION =
  "candidate-jpeg-640-q58-four-frame-v1" as const;
export const CANDIDATE_PASS_B_AUDIO_GATE_REVISION =
  "candidate-vad-20ms-rms-peak-v1" as const;
export const CANDIDATE_PASS_B_MEDIA_RECEIPT_SCHEMA_VERSION = "1.0.0" as const;
export const CANDIDATE_PASS_B_DISPATCH_INTENT_SCHEMA_VERSION = "2.0.0" as const;
export const CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION = "1.0.0" as const;
export const CANDIDATE_PASS_B_CONTEXT_SCHEMA_VERSION = "1.0.0" as const;
export const MAX_CANDIDATE_PASS_B_CONTEXT_TEXT_LENGTH = 4_000;

export interface CandidatePassBVideoFrame {
  /** Timestamp relative to the candidate range. */
  readonly timestampMs: number;
  readonly mimeType: "image/jpeg";
  readonly dataBase64: string;
}

export type CandidatePassBReferenceTranscriptSource =
  | "youtube-caption"
  | "broadcast-transcript"
  | "semantic-refinement";

export type CandidatePassBContextDecision = "select" | "review";

export type CandidatePassBContextCategory =
  | "reaction"
  | "quiet-achievement"
  | "setup-and-payoff"
  | "running-gag"
  | "context-dependent"
  | "apology-accountability";

/**
 * Bounded, source-fenced evidence handed from the whole-broadcast pass to the
 * candidate multimodal pass. A candidate without this packet is never eligible
 * for final publication.
 */
export interface CandidatePassBContextPacket {
  readonly schemaVersion: typeof CANDIDATE_PASS_B_CONTEXT_SCHEMA_VERSION;
  readonly transcriptSource: CandidatePassBReferenceTranscriptSource;
  readonly transcriptKo: string;
  readonly beforeContextKo: string;
  readonly afterContextKo: string;
  readonly broadcastSummaryKo: string;
  readonly topicContextKo: string;
  readonly fastEvidenceKo: string;
  readonly contextDecision: CandidatePassBContextDecision;
  readonly contextCategory: CandidatePassBContextCategory;
  readonly contextVerdictKo: string;
  readonly chatReactionKo: string | null;
}

export type CandidatePassBClipDecision = "recommend" | "reject" | "uncertain";
export type CandidatePassBContextConsistency =
  | "consistent"
  | "conflict"
  | "insufficient";
export type CandidatePassBProgramMaterial =
  | "streamer-event"
  | "music-or-intermission"
  | "routine-or-unclear";

export const CANDIDATE_PASS_B_VERIFICATION_RECEIPT_SCHEMA_VERSION =
  "2.0.0" as const;

/**
 * Exact source identity used both when issuing a receipt and when deciding
 * whether a persisted receipt can still satisfy the current final gate.
 */
export interface CandidatePassBVerificationSourceFence {
  readonly candidateId: string;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly routingModelRevision: CandidatePassBRoutingModelRevision;
  /** Exact editorial language used by the whole-context and candidate passes. */
  readonly outputLanguage: AnalysisLanguage;
  /** Exact closed cast roster used for participant grounding, or no roster. */
  readonly castRosterId: CandidatePassBCastRosterId | null;
  /**
   * Exact active refinement-evidence projection used for this candidate.
   *
   * `null` is valid only when the sealed semantic-refinement plan selected no
   * leads. Publication independently proves that relationship before issuing
   * or accepting a final candidate.
   */
  readonly refinementEvidenceProjectionFingerprint: string | null;
}

export type CandidatePassBSha256Digest = `sha256:${string}`;
export type CandidatePassBTransportMode = "free-r2" | "paid-direct";

export interface CandidatePassBFrameReceipt {
  readonly timestampMs: number;
  readonly mimeType: "image/jpeg";
  readonly byteLength: number;
  readonly contentDigest: CandidatePassBSha256Digest;
  readonly extractionRevision: typeof CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION;
}

export interface CandidatePassBAudibleAudioReceipt {
  readonly kind: "audible-audio";
  readonly wavByteLength: number;
  readonly wavContentDigest: CandidatePassBSha256Digest;
  readonly sampleRateHz: typeof CANDIDATE_PASS_B_SAMPLE_RATE_HZ;
  readonly sampleCount: number;
}

export interface CandidatePassBVerifiedNoSpeechReceipt {
  readonly kind: "verified-no-speech";
  readonly wavByteLength: number;
  readonly wavContentDigest: CandidatePassBSha256Digest;
  readonly sampleRateHz: typeof CANDIDATE_PASS_B_SAMPLE_RATE_HZ;
  readonly sampleCount: number;
  readonly vadRevision: typeof CANDIDATE_PASS_B_AUDIO_GATE_REVISION;
  readonly frameCount: number;
  readonly activeFrameCount: number;
  readonly activeFrameRatio: number;
  readonly audible: false;
}

export type CandidatePassBAudioReceipt =
  | CandidatePassBAudibleAudioReceipt
  | CandidatePassBVerifiedNoSpeechReceipt;

export interface CandidatePassBMediaReceipt {
  readonly schemaVersion: typeof CANDIDATE_PASS_B_MEDIA_RECEIPT_SCHEMA_VERSION;
  readonly frameExtractionRevision:
    typeof CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION;
  readonly frames: readonly [
    CandidatePassBFrameReceipt,
    CandidatePassBFrameReceipt,
    CandidatePassBFrameReceipt,
    CandidatePassBFrameReceipt,
  ];
  readonly audio: CandidatePassBAudioReceipt;
  readonly providerPayloadDigest: CandidatePassBSha256Digest;
}

export interface CandidatePassBOperationIdInput {
  readonly analysisRunId: string;
  readonly sourceFingerprint: string;
  readonly candidateId: string;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly contextFingerprint: string;
  readonly outputLanguage: AnalysisLanguage;
  readonly castRosterId: CandidatePassBCastRosterId | null;
  readonly routingModelRevision: typeof CANDIDATE_PASS_B_ROUTING_MODEL_REVISION;
  readonly attemptOrdinal: number;
  readonly retryGrantId: string | null;
  readonly transportMode: CandidatePassBTransportMode;
  readonly providerPayloadDigest: CandidatePassBSha256Digest;
}

/**
 * Derives the paid-operation identity from every immutable dispatch fence.
 * A retry grant or transport change necessarily creates a different operation.
 */
export async function createCandidatePassBOperationId(
  input: CandidatePassBOperationIdInput,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      "candidate-pass-b-operation-v3",
      input.analysisRunId,
      input.sourceFingerprint,
      input.candidateId,
      input.sourceStartMs,
      input.sourceEndMs,
      input.contextFingerprint,
      input.outputLanguage,
      input.castRosterId,
      input.routingModelRevision,
      input.attemptOrdinal,
      input.retryGrantId,
      input.transportMode,
      input.providerPayloadDigest,
    ]),
  );
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", bytes),
  );
  let hex = "";
  for (const byte of digest) {
    hex += byte.toString(16).padStart(2, "0");
  }
  bytes.fill(0);
  digest.fill(0);
  return `candidate-pass-b.${hex.slice(0, 48)}`;
}

export interface CandidatePassBDispatchIntent {
  readonly schemaVersion: typeof CANDIDATE_PASS_B_DISPATCH_INTENT_SCHEMA_VERSION;
  readonly operationId: string;
  readonly analysisRunId: string;
  readonly candidateId: string;
  readonly sourceFingerprint: string;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly contextFingerprint: string;
  readonly outputLanguage: AnalysisLanguage;
  readonly castRosterId: CandidatePassBCastRosterId | null;
  readonly routingModelRevision: typeof CANDIDATE_PASS_B_ROUTING_MODEL_REVISION;
  readonly attemptOrdinal: number;
  readonly retryGrantId: string | null;
  readonly transportMode: CandidatePassBTransportMode;
  readonly mediaReceipt: CandidatePassBMediaReceipt;
}

export interface CandidatePassBCompletedSettlement {
  readonly schemaVersion: typeof CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION;
  readonly status: "completed";
  readonly operationId: string;
  readonly providerPayloadDigest: CandidatePassBSha256Digest;
  readonly outputLanguage: AnalysisLanguage;
  readonly castRosterId: CandidatePassBCastRosterId | null;
  readonly responseDigest: CandidatePassBSha256Digest;
  readonly providerModelId:
    | typeof CANDIDATE_PASS_B_QWEN_MODEL_ID
    | typeof CANDIDATE_PASS_B_GEMINI_MODEL_ID;
  readonly providerModelRevision:
    | typeof CANDIDATE_PASS_B_QWEN_MODEL_REVISION
    | typeof CANDIDATE_PASS_B_GEMINI_MODEL_REVISION;
}

export interface CandidatePassBOutcomeUnknownSettlement {
  readonly schemaVersion: typeof CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION;
  readonly status: "outcome-unknown";
  readonly operationId: string;
  readonly providerPayloadDigest: CandidatePassBSha256Digest;
  readonly outputLanguage: AnalysisLanguage;
  readonly castRosterId: CandidatePassBCastRosterId | null;
  readonly reason:
    | "quota-outcome-unknown"
    | "armed-dispatch-interrupted"
    | "armed-dispatch-recovered";
}

export type CandidatePassBTerminalSettlement =
  | CandidatePassBCompletedSettlement
  | CandidatePassBOutcomeUnknownSettlement;

export interface CandidatePassBCurrentVerificationReceipt
  extends CandidatePassBVerificationSourceFence {
  readonly schemaVersion: typeof CANDIDATE_PASS_B_VERIFICATION_RECEIPT_SCHEMA_VERSION;
  readonly contextSchemaVersion: typeof CANDIDATE_PASS_B_CONTEXT_SCHEMA_VERSION;
  readonly transcriptSource: CandidatePassBReferenceTranscriptSource;
  readonly contextFingerprint: string;
  readonly dispatchIntent: CandidatePassBDispatchIntent;
  readonly settlement: CandidatePassBCompletedSettlement;
  readonly thumbnailTimestampMs: number;
}

export type CandidatePassBVerificationReceipt =
  CandidatePassBCurrentVerificationReceipt;

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

export interface CandidatePassBQuotaIdentity {
  readonly participantId: string;
  readonly runId: string;
  /** A stable number for one run, incremented only by an explicit rerun. */
  readonly attemptOrdinal: number;
  /** Null only for the first attempt; every retry names its durable grant. */
  readonly retryGrantId: string | null;
}

export interface CandidatePassBTarget {
  readonly candidateId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly videoFrames: readonly CandidatePassBVideoFrame[];
  readonly frameExtractionRevision:
    typeof CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION;
  readonly context: CandidatePassBContextPacket;
  readonly contextFingerprint: string;
  /**
   * Explicit server-known spelling roster. `null` proves that the caller
   * intentionally supplied no closed roster.
   */
  readonly castRosterId: CandidatePassBCastRosterId | null;
  /** Language for generated editorial narration; source speech stays verbatim. */
  readonly outputLanguage: AnalysisLanguage;
}

/** Analyze requests and result manifests accept only `remote`. */
export type CandidatePassBDevice = "webgpu" | "wasm" | "remote";

export type CandidatePassBWorkerRequest =
  | {
      readonly type: "candidate-pass-b-analyze";
      readonly identity: CandidatePassBWorkerIdentity;
      readonly quota: CandidatePassBQuotaIdentity;
      readonly file: File;
      readonly sourceFingerprint: string;
      readonly sourceDurationMs: number;
      readonly device: typeof CANDIDATE_PASS_B_DEVICE;
      readonly targets: readonly CandidatePassBTarget[];
    }
  | {
      readonly type: "candidate-pass-b-dispatch-arm-ack";
      readonly identity: CandidatePassBWorkerIdentity;
      readonly operationId: string;
      readonly accepted: boolean;
    }
  | {
      readonly type: "candidate-pass-b-terminal-result-ack";
      readonly identity: CandidatePassBWorkerIdentity;
      readonly terminalEventId: string;
      readonly candidateId: string;
      readonly settlement: CandidatePassBTerminalSettlement;
      readonly accepted: boolean;
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
  readonly participantPresence: CandidatePassBParticipantPresence;
  /** Human-readable participant grounding that is reused by context and UI. */
  readonly participantSummaryKo: string;
  readonly identifiedParticipants: readonly CandidatePassBParticipantAttribution[];
  readonly clipDecision: CandidatePassBClipDecision;
  /** Whether the candidate audio/video agrees with the supplied broadcast context. */
  readonly contextConsistency: CandidatePassBContextConsistency;
  /** Explicit exclusion fence for songs, MVs, openings, endings and breaks. */
  readonly programMaterial: CandidatePassBProgramMaterial;
}

export type CandidatePassBParticipantPresence =
  | "identified"
  | "present-unidentified"
  | "none-present"
  | "insufficient-evidence";

export type CandidatePassBParticipantRole = "streamer" | "guest" | "unknown";
export type CandidatePassBParticipantEvidenceBasis =
  | "on-screen-name"
  | "spoken-name"
  /**
   * Reserved for the separate source-fenced visual identity bridge. Candidate
   * Pass B prompts, parsers, storage and publication deliberately reject it.
   */
  | "provided-cast-reference";

export interface CandidatePassBParticipantAttribution {
  readonly displayName: string;
  readonly role: CandidatePassBParticipantRole;
  readonly evidenceBasis: CandidatePassBParticipantEvidenceBasis;
  readonly evidenceKo: string;
  readonly confidence: number;
  readonly relativeTimestampMs: number;
  /** Zero-based indices into the exact four-frame AI bundle. */
  readonly observedFrameIndices: readonly number[];
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
  readonly settlement: CandidatePassBCompletedSettlement;
}

export type CandidatePassBCandidateGapReason =
  | "NO_AUDIO_TRACK"
  | "UNSUPPORTED_CONTAINER"
  | "UNSUPPORTED_AUDIO_CODEC"
  | "AUDIO_DECODE_FAILED"
  | "TRANSCRIPTION_FAILED"
  | "OUTCOME_UNKNOWN";

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

export interface CandidatePassBOutcomeUnknown {
  readonly candidateId: string;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly settlement: CandidatePassBOutcomeUnknownSettlement;
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
  | "DISPATCH_NOT_ARMED"
  | "TERMINAL_NOT_ACKNOWLEDGED"
  | "OUTCOME_UNKNOWN"
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
    case "DISPATCH_NOT_ARMED":
      return "AI 요청 기록을 저장소에서 확인하지 못해 결제 요청을 보내지 않았어요.";
    case "TERMINAL_NOT_ACKNOWLEDGED":
      return "AI 분석 결과를 내구 저장소에서 확인하지 못해 작업을 완료하지 않았어요.";
    case "OUTCOME_UNKNOWN":
      return "AI 요청 전송 뒤 응답을 확인하지 못했어요. 중복 결제를 막기 위해 자동 재시도하지 않아요.";
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
      readonly type: "candidate-pass-b-dispatch-intent";
      readonly intent: CandidatePassBDispatchIntent;
    }
  | {
      readonly type: "candidate-pass-b-outcome-unknown";
      readonly outcome: CandidatePassBOutcomeUnknown;
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
