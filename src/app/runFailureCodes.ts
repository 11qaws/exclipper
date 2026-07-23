/**
 * Maps a thrown error or a worker gap onto the durable reason code recorded in
 * the run ledger. These codes are stored, so the mapping is deliberately
 * exhaustive and kept away from display copy in `statusMessages.ts`.
 */
import type { CandidatePassBEvidence } from "../analysis/candidatePassB";
import { CandidatePassBWorkerError } from "../analysis/candidatePassBWorkerClient";
import type { CandidateAudioEventCandidateGap } from "../analysis/candidateAudioEventWorkerClient";
import { CandidateAudioEventWorkerError } from "../analysis/candidateAudioEventWorkerClient";
import type {
  CandidateAudioEventRunFailureReasonCode,
} from "../domain/candidateAudioEventRun";
import type {
  CandidatePassBCandidateFailureReasonCode,
  CandidatePassBNoClearSpeechReasonCode,
  CandidatePassBRunFailureReasonCode,
} from "../domain/candidatePassBRun";
import type { CandidatePassBCandidateGap } from "../analysis/candidatePassBWorkerClient";
import type { LocalAudioReactionAnalysisError } from "../media/localAudioReactionAnalysis";
import type { DurableAudioGapReasonCode } from "../storage/durableAnalysisPayload";

export function candidatePassBNoClearReason(
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

export function candidatePassBFailureReason(
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

export function candidatePassBRunFailureReason(
  error: unknown,
): CandidatePassBRunFailureReasonCode {
  if (!(error instanceof CandidatePassBWorkerError)) {
    return "runtime_unavailable";
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

export function candidateAudioEventRunFailureReason(
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

export function durableAudioGapReasonForError(
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

export type { CandidateAudioEventCandidateGap };
