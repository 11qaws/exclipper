import {
  CANDIDATE_PASS_B_DEVICE,
  CANDIDATE_PASS_B_DTYPE,
  CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
  CANDIDATE_PASS_B_GEMINI_MODEL_ID,
  CANDIDATE_PASS_B_GEMINI_MODEL_REVISION,
  CANDIDATE_PASS_B_LANGUAGE,
  CANDIDATE_PASS_B_QWEN_MODEL_ID,
  CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
  CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION,
  CANDIDATE_PASS_B_TASK,
  MAX_CANDIDATE_PASS_B_SOURCE_DURATION_MS,
  MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS,
  MAX_CANDIDATE_PASS_B_TARGETS,
  MAX_CANDIDATE_PASS_B_VIDEO_FRAME_BASE64_LENGTH,
  MAX_CANDIDATE_PASS_B_VIDEO_FRAMES,
  candidatePassBWorkerFailureMessage,
  createCandidatePassBOperationId,
  type CandidatePassBCandidateGap,
  type CandidatePassBCandidateGapReason,
  type CandidatePassBCandidateProgress,
  type CandidatePassBCompletionSummary,
  type CandidatePassBDispatchIntent,
  type CandidatePassBDevice,
  type CandidatePassBModelProgress,
  type CandidatePassBOutcomeUnknown,
  type CandidatePassBQuotaIdentity,
  type CandidatePassBTarget,
  type CandidatePassBTerminalSettlement,
  type CandidatePassBTranscriptResult,
  type CandidatePassBWorkerFailureReason,
  type CandidatePassBWorkerIdentity,
  type CandidatePassBWorkerRequest,
  type CandidatePassBWorkerResponse,
} from "./candidatePassBWorkerProtocol";
import {
  MAX_CANDIDATE_PASS_B_INSIGHT_TEXT_LENGTH,
  MAX_CANDIDATE_PASS_B_IDENTIFIED_PARTICIPANTS,
  MAX_CANDIDATE_PASS_B_PARTICIPANT_EVIDENCE_LENGTH,
  MAX_CANDIDATE_PASS_B_PARTICIPANT_NAME_LENGTH,
  MAX_CANDIDATE_PASS_B_SEGMENT_TEXT_LENGTH,
  MAX_CANDIDATE_PASS_B_TRANSCRIPT_SEGMENTS,
  MAX_CANDIDATE_PASS_B_TRANSCRIPT_TEXT_LENGTH,
  MAX_CANDIDATE_PASS_B_UNCERTAINTIES,
  MAX_CANDIDATE_PASS_B_UNCERTAINTY_LENGTH,
} from "./candidatePassBGemini";
import { isCandidatePassBCastRosterId } from "./participantRoster";
import {
  candidatePassBContextFingerprint,
  isCandidatePassBContextPacket,
  isCandidatePassBDispatchIntent,
  isCandidatePassBOutcomeUnknown,
  isCandidatePassBCompletedSettlement,
} from "./candidateFinalVerification";
import { isAnalysisLanguage } from "../domain/analysisLanguage";

export {
  CANDIDATE_PASS_B_DEVICE,
  CANDIDATE_PASS_B_DTYPE,
  CANDIDATE_PASS_B_GEMINI_MODEL_ID,
  CANDIDATE_PASS_B_GEMINI_MODEL_REVISION,
  CANDIDATE_PASS_B_LANGUAGE,
  CANDIDATE_PASS_B_MODEL_ID,
  CANDIDATE_PASS_B_MODEL_REVISION,
  CANDIDATE_PASS_B_ROUTING_MODEL_ID,
  CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
  CANDIDATE_PASS_B_QWEN_MODEL_ID,
  CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
  CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  CANDIDATE_PASS_B_TASK,
  MAX_CANDIDATE_PASS_B_SOURCE_DURATION_MS,
  MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS,
  MAX_CANDIDATE_PASS_B_TARGETS,
  type CandidatePassBCandidateGap,
  type CandidatePassBCandidateGapReason,
  type CandidatePassBCandidateProgress,
  type CandidatePassBCompletionSummary,
  type CandidatePassBDevice,
  type CandidatePassBModelProgress,
  type CandidatePassBTarget,
  type CandidatePassBInsight,
  type CandidatePassBTranscriptResult,
  type CandidatePassBTranscriptSegment,
  type CandidatePassBWorkerFailureReason,
  type CandidatePassBWorkerIdentity,
} from "./candidatePassBWorkerProtocol";

type WorkerEventType = "message" | "messageerror" | "error";
type WorkerListener = (event: MessageEvent<unknown> | ErrorEvent) => void;

const RESPONSE_ENVELOPE_KEYS = [
  "sessionId",
  "writerEpoch",
  "analysisRunId",
  "passBRunId",
  "workerEpoch",
  "workerInstanceId",
  "taskId",
  "eventId",
  "type",
] as const;
export interface CandidatePassBWorkerLike {
  addEventListener(type: WorkerEventType, listener: WorkerListener): void;
  removeEventListener(type: WorkerEventType, listener: WorkerListener): void;
  postMessage(message: CandidatePassBWorkerRequest): void;
  terminate(): void;
}

export type CandidatePassBWorkerFactory = () => CandidatePassBWorkerLike;

export interface RunCandidatePassBWorkerOptions {
  readonly identity: CandidatePassBWorkerIdentity;
  readonly quota: CandidatePassBQuotaIdentity;
  readonly sourceFingerprint: string;
  readonly sourceDurationMs: number;
  readonly device: CandidatePassBDevice;
  readonly targets: readonly CandidatePassBTarget[];
  readonly signal?: AbortSignal;
  readonly onModelProgress?: (progress: CandidatePassBModelProgress) => void;
  readonly onCandidateProgress?: (
    progress: CandidatePassBCandidateProgress,
  ) => void;
  /**
   * Must durably persist and exact-readback the completed settlement.
   * The Worker receives a terminal ACK only after this resolves `true`.
   */
  readonly onPartialResult: (
    result: CandidatePassBTranscriptResult,
  ) => Promise<boolean>;
  readonly onCandidateGap?: (gap: CandidatePassBCandidateGap) => void;
  /**
   * Must durably persist and exact-readback the intent. The Worker receives an
   * arm ACK only after this promise resolves `true`.
   */
  readonly onDispatchIntent: (
    intent: CandidatePassBDispatchIntent,
  ) => Promise<boolean>;
  /**
   * Must durably persist and exact-readback the outcome-unknown settlement.
   */
  readonly onOutcomeUnknown: (
    outcome: CandidatePassBOutcomeUnknown,
  ) => Promise<boolean>;
  /** Called only after a correctly fenced cancellation ACK is received. */
  readonly onCancellationAcknowledged?: () => void;
  readonly timeoutMs?: number;
  readonly cancelAcknowledgementTimeoutMs?: number;
  readonly workerFactory?: CandidatePassBWorkerFactory;
}

export interface CandidatePassBRunResult {
  readonly results: readonly CandidatePassBTranscriptResult[];
  readonly gaps: readonly CandidatePassBCandidateGap[];
  readonly outcomeUnknowns: readonly CandidatePassBOutcomeUnknown[];
  readonly summary: CandidatePassBCompletionSummary;
}

export type CandidatePassBEventFenceRejectionReason =
  | "invalid_event_id"
  | "session_id_mismatch"
  | "writer_epoch_mismatch"
  | "analysis_run_id_mismatch"
  | "pass_b_run_id_mismatch"
  | "worker_epoch_mismatch"
  | "worker_instance_id_mismatch"
  | "task_id_mismatch"
  | "duplicate_event_id";

export type CandidatePassBWorkerErrorCode =
  | "INVALID_INPUT"
  | "ABORTED"
  | "EVENT_FENCE_REJECTED"
  | "WORKER_FAILED"
  | "WORKER_MESSAGE_ERROR"
  | "WORKER_TIMEOUT"
  | "PROGRESS_CALLBACK_FAILED"
  | "RESULT_CALLBACK_FAILED"
  | "DISPATCH_ARM_CALLBACK_FAILED"
  | "CANCEL_ACK_CALLBACK_FAILED";

export class CandidatePassBWorkerError extends Error {
  public readonly code: CandidatePassBWorkerErrorCode;
  public readonly fenceReason: CandidatePassBEventFenceRejectionReason | null;
  public readonly workerReasonCode: CandidatePassBWorkerFailureReason | null;

  public constructor(
    code: CandidatePassBWorkerErrorCode,
    message: string,
    options: {
      readonly fenceReason?: CandidatePassBEventFenceRejectionReason;
      readonly workerReasonCode?: CandidatePassBWorkerFailureReason;
    } = {},
  ) {
    super(message);
    this.name = "CandidatePassBWorkerError";
    this.code = code;
    this.fenceReason = options.fenceReason ?? null;
    this.workerReasonCode = options.workerReasonCode ?? null;
  }
}

export const DEFAULT_CANDIDATE_PASS_B_WORKER_TIMEOUT_MS = 2 * 60 * 60_000;
export const DEFAULT_CANDIDATE_PASS_B_CANCEL_ACK_TIMEOUT_MS = 30_000;

interface NormalizedRunInput {
  readonly sourceDurationMs: number;
  readonly targets: readonly CandidatePassBTarget[];
}

interface FenceState {
  readonly identity: CandidatePassBWorkerIdentity;
  readonly processedEventIds: ReadonlySet<string>;
}

type FenceOutcome =
  | { readonly accepted: true; readonly state: FenceState }
  | {
      readonly accepted: false;
      readonly state: FenceState;
      readonly reason: CandidatePassBEventFenceRejectionReason;
    };

export function createBrowserCandidatePassBWorker(): CandidatePassBWorkerLike {
  return new Worker(new URL("./candidatePassB.worker.ts", import.meta.url), {
    type: "module",
    name: "retto-candidate-pass-b",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function hasResponseKeys(
  value: Record<string, unknown>,
  payloadKeys: readonly string[],
): boolean {
  return hasExactKeys(value, [...RESPONSE_ENVELOPE_KEYS, ...payloadKeys]);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasBoundedCodePointLength(
  value: unknown,
  maximumLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Array.from(value).length <= maximumLength
  );
}

function isBoundedKoreanText(value: unknown, maximumLength: number): boolean {
  return (
    hasBoundedCodePointLength(value, maximumLength) &&
    /\p{Script=Hangul}/u.test(value)
  );
}

function isNullableNonNegativeSafeInteger(value: unknown): boolean {
  return value === null || isNonNegativeSafeInteger(value);
}

function isFenceEnvelope(value: Record<string, unknown>): boolean {
  return (
    typeof value.eventId === "string" &&
    typeof value.sessionId === "string" &&
    Number.isSafeInteger(value.writerEpoch) &&
    typeof value.analysisRunId === "string" &&
    typeof value.passBRunId === "string" &&
    Number.isSafeInteger(value.workerEpoch) &&
    typeof value.workerInstanceId === "string" &&
    typeof value.taskId === "string"
  );
}

function isModelProgress(value: unknown): value is CandidatePassBModelProgress {
  if (!isRecord(value) || !hasExactKeys(value, [
    "stage",
    "ratio",
    "loadedBytes",
    "totalBytes",
  ])) {
    return false;
  }
  if (
    (value.stage !== "loading" && value.stage !== "ready") ||
    !isFiniteNumber(value.ratio) ||
    value.ratio < 0 ||
    value.ratio > 1 ||
    !isNullableNonNegativeSafeInteger(value.loadedBytes) ||
    !isNullableNonNegativeSafeInteger(value.totalBytes)
  ) {
    return false;
  }
  return !(
    value.loadedBytes !== null &&
    value.totalBytes !== null &&
    (value.loadedBytes as number) > (value.totalBytes as number)
  );
}

function isCandidateProgress(
  value: unknown,
): value is CandidatePassBCandidateProgress {
  if (!isRecord(value) || !hasExactKeys(value, [
    "candidateId",
    "candidateOrdinal",
    "targetCount",
    "stage",
    "ratio",
  ])) {
    return false;
  }
  return (
    isNonEmptyString(value.candidateId) &&
    Number.isSafeInteger(value.candidateOrdinal) &&
    (value.candidateOrdinal as number) > 0 &&
    Number.isSafeInteger(value.targetCount) &&
    (value.targetCount as number) > 0 &&
    (value.stage === "decoding" ||
      value.stage === "transcribing" ||
      value.stage === "complete" ||
      value.stage === "gap") &&
    isFiniteNumber(value.ratio) &&
    value.ratio >= 0 &&
    value.ratio <= 1
  );
}

function isTranscriptSegment(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["startMs", "endMs", "text"]) &&
    isNonNegativeSafeInteger(value.startMs) &&
    isNonNegativeSafeInteger(value.endMs) &&
    value.endMs > value.startMs &&
    hasBoundedCodePointLength(
      value.text,
      MAX_CANDIDATE_PASS_B_SEGMENT_TEXT_LENGTH,
    ) &&
    (value.text === "[불명]" || /\p{Script=Hangul}/u.test(value.text))
  );
}

function isInsight(value: unknown): boolean {
  const currentKeys = [
    "eventSummaryKo",
    "reactionSummaryKo",
    "whyGoodClipKo",
    "uncertaintiesKo",
    "participantPresence",
    "participantSummaryKo",
    "identifiedParticipants",
    "clipDecision",
    "contextConsistency",
    "programMaterial",
  ] as const;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, currentKeys) ||
    !Array.isArray(value.uncertaintiesKo) ||
    value.uncertaintiesKo.length > MAX_CANDIDATE_PASS_B_UNCERTAINTIES ||
    !Array.isArray(value.identifiedParticipants)
  ) {
    return false;
  }
  const uncertainties: readonly unknown[] = value.uncertaintiesKo;
  const participants: readonly unknown[] = value.identifiedParticipants;
  return (
    isBoundedKoreanText(
      value.eventSummaryKo,
      MAX_CANDIDATE_PASS_B_INSIGHT_TEXT_LENGTH,
    ) &&
    isBoundedKoreanText(
      value.reactionSummaryKo,
      MAX_CANDIDATE_PASS_B_INSIGHT_TEXT_LENGTH,
    ) &&
    isBoundedKoreanText(
      value.whyGoodClipKo,
      MAX_CANDIDATE_PASS_B_INSIGHT_TEXT_LENGTH,
    ) &&
    uncertainties.every((uncertainty) =>
      isBoundedKoreanText(
        uncertainty,
        MAX_CANDIDATE_PASS_B_UNCERTAINTY_LENGTH,
      ),
    ) &&
    new Set(uncertainties).size === uncertainties.length &&
    [
        "identified",
        "present-unidentified",
        "none-present",
        "insufficient-evidence",
      ].includes(value.participantPresence as string) &&
    isBoundedKoreanText(
        value.participantSummaryKo,
        MAX_CANDIDATE_PASS_B_INSIGHT_TEXT_LENGTH,
      ) &&
    ["recommend", "reject", "uncertain"].includes(value.clipDecision as string) &&
    ["consistent", "conflict", "insufficient"].includes(
        value.contextConsistency as string,
      ) &&
    ["streamer-event", "music-or-intermission", "routine-or-unclear"].includes(
        value.programMaterial as string,
      ) &&
    participants.length <= MAX_CANDIDATE_PASS_B_IDENTIFIED_PARTICIPANTS &&
    participants.every(isParticipantAttribution) &&
    ((value.participantPresence === "identified" && participants.length > 0) ||
      (value.participantPresence !== "identified" && participants.length === 0))
  );
}

function isParticipantAttribution(value: unknown): boolean {
  const currentKeys = [
    "displayName",
    "role",
    "evidenceBasis",
    "evidenceKo",
    "confidence",
    "relativeTimestampMs",
    "observedFrameIndices",
  ] as const;
  return (
    isRecord(value) &&
    hasExactKeys(value, currentKeys) &&
    hasBoundedCodePointLength(
      value.displayName,
      MAX_CANDIDATE_PASS_B_PARTICIPANT_NAME_LENGTH,
    ) &&
    ["streamer", "guest", "unknown"].includes(value.role as string) &&
    ["on-screen-name", "spoken-name"].includes(
      value.evidenceBasis as string,
    ) &&
    isBoundedKoreanText(
      value.evidenceKo,
      MAX_CANDIDATE_PASS_B_PARTICIPANT_EVIDENCE_LENGTH,
    ) &&
    isFiniteNumber(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 1 &&
    isNonNegativeSafeInteger(value.relativeTimestampMs) &&
    value.relativeTimestampMs <= MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS &&
    Array.isArray(value.observedFrameIndices) &&
        value.observedFrameIndices.length <= MAX_CANDIDATE_PASS_B_VIDEO_FRAMES &&
        new Set(value.observedFrameIndices).size ===
          value.observedFrameIndices.length &&
        value.observedFrameIndices.every(
          (frameIndex) =>
            Number.isSafeInteger(frameIndex) &&
            frameIndex >= 0 &&
            frameIndex < MAX_CANDIDATE_PASS_B_VIDEO_FRAMES,
        ) &&
    (value.evidenceBasis !== "on-screen-name" ||
      value.observedFrameIndices.length > 0)
  );
}

function isTranscriptResult(
  value: unknown,
): value is CandidatePassBTranscriptResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "mode",
      "candidateId",
      "sourceStartMs",
      "sourceEndMs",
      "text",
      "segments",
      "insight",
      "model",
      "language",
      "task",
      "sampleRateHz",
      "settlement",
    ]) ||
    !isRecord(value.model) ||
    !isInsight(value.insight) ||
    !Array.isArray(value.segments)
  ) {
    return false;
  }
  return (
    value.mode === "candidate-pass-b-transcript" &&
    isNonEmptyString(value.candidateId) &&
    isNonNegativeSafeInteger(value.sourceStartMs) &&
    isNonNegativeSafeInteger(value.sourceEndMs) &&
    value.sourceEndMs > value.sourceStartMs &&
    typeof value.text === "string" &&
    Array.from(value.text).length <=
      MAX_CANDIDATE_PASS_B_TRANSCRIPT_TEXT_LENGTH &&
    value.segments.length <= MAX_CANDIDATE_PASS_B_TRANSCRIPT_SEGMENTS &&
    value.segments.every(isTranscriptSegment) &&
    hasExactKeys(value.model, ["id", "revision", "dtype", "device"]) &&
    ((value.model.id === CANDIDATE_PASS_B_QWEN_MODEL_ID &&
      value.model.revision === CANDIDATE_PASS_B_QWEN_MODEL_REVISION) ||
      (value.model.id === CANDIDATE_PASS_B_GEMINI_MODEL_ID &&
        value.model.revision === CANDIDATE_PASS_B_GEMINI_MODEL_REVISION)) &&
    value.model.dtype === CANDIDATE_PASS_B_DTYPE &&
    value.model.device === CANDIDATE_PASS_B_DEVICE &&
    value.language === CANDIDATE_PASS_B_LANGUAGE &&
    value.task === CANDIDATE_PASS_B_TASK &&
    value.sampleRateHz === CANDIDATE_PASS_B_SAMPLE_RATE_HZ &&
    isCandidatePassBCompletedSettlement(value.settlement)
  );
}

function isGapReason(value: unknown): value is CandidatePassBCandidateGapReason {
  return (
    value === "NO_AUDIO_TRACK" ||
    value === "UNSUPPORTED_CONTAINER" ||
    value === "UNSUPPORTED_AUDIO_CODEC" ||
    value === "AUDIO_DECODE_FAILED" ||
    value === "TRANSCRIPTION_FAILED" ||
    value === "OUTCOME_UNKNOWN"
  );
}

function isCandidateGap(value: unknown): value is CandidatePassBCandidateGap {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "candidateId",
      "sourceStartMs",
      "sourceEndMs",
      "reasonCode",
      "message",
    ]) &&
    isNonEmptyString(value.candidateId) &&
    isNonNegativeSafeInteger(value.sourceStartMs) &&
    isNonNegativeSafeInteger(value.sourceEndMs) &&
    value.sourceEndMs > value.sourceStartMs &&
    isGapReason(value.reasonCode) &&
    isNonEmptyString(value.message) &&
    value.message.length <= 1_000
  );
}

function safeCandidateGapMessage(
  reasonCode: CandidatePassBCandidateGapReason,
): string {
  switch (reasonCode) {
    case "NO_AUDIO_TRACK":
      return "이 영상에는 분석할 오디오 트랙이 없어요.";
    case "UNSUPPORTED_CONTAINER":
      return "이 영상 형식은 현재 브라우저에서 읽을 수 없어요.";
    case "UNSUPPORTED_AUDIO_CODEC":
      return "이 브라우저에서 이 영상의 오디오 코덱을 읽을 수 없어요.";
    case "OUTCOME_UNKNOWN":
      return "이 후보 구간에서 이어지는 말소리 단서를 찾지 못했어요.";
    case "AUDIO_DECODE_FAILED":
      return "이 후보 구간의 오디오를 읽는 중 문제가 생겼어요.";
    case "TRANSCRIPTION_FAILED":
      return "이 후보 구간을 정밀 분석하는 중 문제가 생겼어요.";
  }
}

function isCompletionSummary(
  value: unknown,
): value is CandidatePassBCompletionSummary {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["requestedCount", "completedCount", "gapCount"]) &&
    isNonNegativeSafeInteger(value.requestedCount) &&
    isNonNegativeSafeInteger(value.completedCount) &&
    isNonNegativeSafeInteger(value.gapCount) &&
    value.requestedCount <= MAX_CANDIDATE_PASS_B_TARGETS &&
    value.completedCount + value.gapCount === value.requestedCount
  );
}

function isWorkerFailureReason(
  value: unknown,
): value is CandidatePassBWorkerFailureReason {
  return (
    value === "INVALID_REQUEST" ||
    value === "WORKER_BUSY" ||
    value === "PROXY_AUTH_REJECTED" ||
    value === "PROXY_BAD_REQUEST" ||
    value === "PROXY_RATE_LIMITED" ||
    value === "PROXY_UNAVAILABLE" ||
    value === "PROXY_INVALID_RESPONSE" ||
    value === "PROXY_REQUEST_REJECTED" ||
    value === "DISPATCH_NOT_ARMED" ||
    value === "TERMINAL_NOT_ACKNOWLEDGED" ||
    value === "OUTCOME_UNKNOWN" ||
    value === "UNEXPECTED_WORKER_FAILURE"
  );
}

function isWorkerResponse(value: unknown): value is CandidatePassBWorkerResponse {
  if (!isRecord(value) || !isFenceEnvelope(value)) {
    return false;
  }
  switch (value.type) {
    case "candidate-pass-b-model-progress":
      return hasResponseKeys(value, ["progress"]) && isModelProgress(value.progress);
    case "candidate-pass-b-candidate-progress":
      return (
        hasResponseKeys(value, ["progress"]) &&
        isCandidateProgress(value.progress)
      );
    case "candidate-pass-b-partial-result":
      return (
        hasResponseKeys(value, ["result"]) && isTranscriptResult(value.result)
      );
    case "candidate-pass-b-dispatch-intent":
      return (
        hasResponseKeys(value, ["intent"]) &&
        isCandidatePassBDispatchIntent(value.intent)
      );
    case "candidate-pass-b-outcome-unknown":
      return (
        hasResponseKeys(value, ["outcome"]) &&
        isCandidatePassBOutcomeUnknown(value.outcome)
      );
    case "candidate-pass-b-candidate-gap":
      return hasResponseKeys(value, ["gap"]) && isCandidateGap(value.gap);
    case "candidate-pass-b-completed":
      return (
        hasResponseKeys(value, ["summary"]) &&
        isCompletionSummary(value.summary)
      );
    case "candidate-pass-b-cancel-acknowledged":
      return hasResponseKeys(value, []);
    case "candidate-pass-b-failed":
      return (
        hasResponseKeys(value, ["reasonCode", "message"]) &&
        isWorkerFailureReason(value.reasonCode) &&
        value.message === candidatePassBWorkerFailureMessage(value.reasonCode)
      );
    default:
      return false;
  }
}

function rejectFence(
  state: FenceState,
  reason: CandidatePassBEventFenceRejectionReason,
): FenceOutcome {
  return { accepted: false, state, reason };
}

function fenceEvent(
  state: FenceState,
  event: CandidatePassBWorkerResponse,
): FenceOutcome {
  if (event.eventId.trim().length === 0) {
    return rejectFence(state, "invalid_event_id");
  }
  const identity = state.identity;
  if (event.sessionId !== identity.sessionId) {
    return rejectFence(state, "session_id_mismatch");
  }
  if (event.writerEpoch !== identity.writerEpoch) {
    return rejectFence(state, "writer_epoch_mismatch");
  }
  if (event.analysisRunId !== identity.analysisRunId) {
    return rejectFence(state, "analysis_run_id_mismatch");
  }
  if (event.passBRunId !== identity.passBRunId) {
    return rejectFence(state, "pass_b_run_id_mismatch");
  }
  if (event.workerEpoch !== identity.workerEpoch) {
    return rejectFence(state, "worker_epoch_mismatch");
  }
  if (event.workerInstanceId !== identity.workerInstanceId) {
    return rejectFence(state, "worker_instance_id_mismatch");
  }
  if (event.taskId !== identity.taskId) {
    return rejectFence(state, "task_id_mismatch");
  }
  if (state.processedEventIds.has(event.eventId)) {
    return rejectFence(state, "duplicate_event_id");
  }
  const processedEventIds = new Set(state.processedEventIds);
  processedEventIds.add(event.eventId);
  return {
    accepted: true,
    state: { identity, processedEventIds },
  };
}

function normalizeWorkerTimeout(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_CANDIDATE_PASS_B_WORKER_TIMEOUT_MS;
  }
  return Number.isFinite(value)
    ? Math.min(24 * 60 * 60_000, Math.max(1, Math.round(value)))
    : DEFAULT_CANDIDATE_PASS_B_WORKER_TIMEOUT_MS;
}

function normalizeCancelAcknowledgementTimeout(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_CANDIDATE_PASS_B_CANCEL_ACK_TIMEOUT_MS;
  }
  return Number.isFinite(value)
    ? Math.min(30_000, Math.max(50, Math.round(value)))
    : DEFAULT_CANDIDATE_PASS_B_CANCEL_ACK_TIMEOUT_MS;
}

function validateIdentity(identity: CandidatePassBWorkerIdentity): boolean {
  return (
    isNonEmptyString(identity.sessionId) &&
    isNonNegativeSafeInteger(identity.writerEpoch) &&
    isNonEmptyString(identity.analysisRunId) &&
    isNonEmptyString(identity.passBRunId) &&
    isNonNegativeSafeInteger(identity.workerEpoch) &&
    isNonEmptyString(identity.workerInstanceId) &&
    isNonEmptyString(identity.taskId)
  );
}

function normalizeInput(
  file: File,
  options: RunCandidatePassBWorkerOptions,
): NormalizedRunInput | CandidatePassBWorkerError {
  if (
    typeof file !== "object" ||
    file === null ||
    !Number.isFinite(file.size) ||
    file.size < 0 ||
    !validateIdentity(options.identity) ||
    options.device !== CANDIDATE_PASS_B_DEVICE ||
    !isNonEmptyString(options.sourceFingerprint) ||
    options.sourceFingerprint.length > 512 ||
    !isNonEmptyString(options.quota.participantId) ||
    !isNonEmptyString(options.quota.runId) ||
    !isNonNegativeSafeInteger(options.quota.attemptOrdinal) ||
    ((options.quota.attemptOrdinal === 0 &&
      options.quota.retryGrantId !== null) ||
      (options.quota.attemptOrdinal !== 0 &&
        (!isNonEmptyString(options.quota.retryGrantId) ||
          options.quota.retryGrantId.length > 240))) ||
    !Number.isFinite(options.sourceDurationMs)
  ) {
    return new CandidatePassBWorkerError(
      "INVALID_INPUT",
      "후보 정밀 분석 입력이 올바르지 않아요.",
    );
  }

  const sourceDurationMs = Math.round(options.sourceDurationMs);
  if (
    sourceDurationMs <= 0 ||
    sourceDurationMs > MAX_CANDIDATE_PASS_B_SOURCE_DURATION_MS ||
    !Array.isArray(options.targets) ||
    options.targets.length === 0 ||
    options.targets.length > MAX_CANDIDATE_PASS_B_TARGETS
  ) {
    return new CandidatePassBWorkerError(
      "INVALID_INPUT",
      "후보 정밀 분석 범위가 허용된 한도를 벗어났어요.",
    );
  }

  const targets: CandidatePassBTarget[] = [];
  const candidateIds = new Set<string>();
  const targetValues: readonly unknown[] = options.targets;
  for (const target of targetValues) {
    if (
      !isRecord(target) ||
      !isNonEmptyString(target.candidateId) ||
      !isFiniteNumber(target.startMs) ||
      !isFiniteNumber(target.endMs)
    ) {
      return new CandidatePassBWorkerError(
        "INVALID_INPUT",
        "후보 정밀 분석 구간이 올바르지 않아요.",
      );
    }
    const rawFrames: readonly unknown[] =
      "videoFrames" in target && Array.isArray(target.videoFrames)
        ? target.videoFrames
        : [];
    const castRosterId =
      "castRosterId" in target ? target.castRosterId : undefined;
    const context = "context" in target ? target.context : undefined;
    const outputLanguage =
      "outputLanguage" in target ? target.outputLanguage : undefined;
    if (
      !isCandidatePassBContextPacket(context) ||
      typeof target.contextFingerprint !== "string" ||
      target.contextFingerprint !== candidatePassBContextFingerprint(context) ||
      target.frameExtractionRevision !==
        CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION
    ) {
      return new CandidatePassBWorkerError(
        "INVALID_INPUT",
        "후보의 방송 맥락 근거가 올바르지 않아요.",
      );
    }
    if (!isAnalysisLanguage(outputLanguage)) {
      return new CandidatePassBWorkerError(
        "INVALID_INPUT",
        "후보 결과 언어가 올바르지 않아요.",
      );
    }
    if (
      castRosterId !== null &&
      !isCandidatePassBCastRosterId(castRosterId)
    ) {
      return new CandidatePassBWorkerError(
        "INVALID_INPUT",
        "후보 출연진 기준을 확인하지 못했어요.",
      );
    }
    if (
      !Array.isArray(rawFrames) ||
      rawFrames.length !== MAX_CANDIDATE_PASS_B_VIDEO_FRAMES ||
      !rawFrames.every(
        (frame) =>
          isRecord(frame) &&
          Object.keys(frame).sort().join(",") === "dataBase64,mimeType,timestampMs" &&
          Number.isSafeInteger(frame.timestampMs) &&
          (frame.timestampMs as number) >= 0 &&
          (frame.timestampMs as number) <= MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS &&
          frame.mimeType === "image/jpeg" &&
          typeof frame.dataBase64 === "string" &&
          frame.dataBase64.length > 0 &&
          frame.dataBase64.length <= MAX_CANDIDATE_PASS_B_VIDEO_FRAME_BASE64_LENGTH,
      )
    ) {
      return new CandidatePassBWorkerError(
        "INVALID_INPUT",
        "후보 화면 샘플 형식이 올바르지 않아요.",
      );
    }
    const normalizedTarget = {
      candidateId: target.candidateId,
      startMs: Math.round(target.startMs),
      endMs: Math.round(target.endMs),
      videoFrames: rawFrames.map((frame) => ({
        timestampMs: (frame as Record<string, unknown>).timestampMs as number,
        mimeType: "image/jpeg" as const,
        dataBase64: (frame as Record<string, unknown>).dataBase64 as string,
      })),
      frameExtractionRevision: CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
      context,
      contextFingerprint: target.contextFingerprint,
      castRosterId,
      outputLanguage,
    };
    if (
      normalizedTarget.startMs < 0 ||
      normalizedTarget.endMs <= normalizedTarget.startMs ||
      normalizedTarget.endMs > sourceDurationMs ||
      normalizedTarget.endMs - normalizedTarget.startMs >
        MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS ||
      new Set(normalizedTarget.videoFrames.map(({ timestampMs }) => timestampMs))
        .size !== MAX_CANDIDATE_PASS_B_VIDEO_FRAMES ||
      normalizedTarget.videoFrames.some(
        ({ timestampMs }) =>
          timestampMs >= normalizedTarget.endMs - normalizedTarget.startMs,
      ) ||
      candidateIds.has(normalizedTarget.candidateId)
    ) {
      return new CandidatePassBWorkerError(
        "INVALID_INPUT",
        "후보 정밀 분석 구간이 겹치거나 허용된 범위를 벗어났어요.",
      );
    }
    candidateIds.add(normalizedTarget.candidateId);
    targets.push(normalizedTarget);
  }

  return { sourceDurationMs, targets };
}

function stageRank(stage: CandidatePassBCandidateProgress["stage"]): number {
  switch (stage) {
    case "decoding":
      return 0;
    case "transcribing":
      return 1;
    case "complete":
    case "gap":
      return 2;
  }
}

function matchesTargetRange(
  target: CandidatePassBTarget,
  value: {
    readonly candidateId: string;
    readonly sourceStartMs: number;
    readonly sourceEndMs: number;
  },
): boolean {
  return (
    value.candidateId === target.candidateId &&
    value.sourceStartMs === target.startMs &&
    value.sourceEndMs === target.endMs
  );
}

function hasValidSegmentTimeline(result: CandidatePassBTranscriptResult): boolean {
  let previousStartMs = result.sourceStartMs;
  for (const segment of result.segments) {
    if (
      segment.startMs < result.sourceStartMs ||
      segment.endMs > result.sourceEndMs ||
      segment.startMs < previousStartMs
    ) {
      return false;
    }
    previousStartMs = segment.startMs;
  }
  return true;
}

/**
 * Sends only the supplied score-ordered candidate ranges to the fixed owner
 * proxy. Partial results remain fenced candidate-by-candidate; no credential
 * exists in the browser request protocol or returned result.
 */
export function runCandidatePassBWorker(
  file: File,
  options: RunCandidatePassBWorkerOptions,
): Promise<CandidatePassBRunResult> {
  const normalized = normalizeInput(file, options);
  if (normalized instanceof CandidatePassBWorkerError) {
    return Promise.reject(normalized);
  }
  if (options.signal?.aborted === true) {
    return Promise.reject(
      new CandidatePassBWorkerError(
        "ABORTED",
        "후보 정밀 분석을 시작하기 전에 취소했어요.",
      ),
    );
  }

  let worker: CandidatePassBWorkerLike;
  try {
    worker = (options.workerFactory ?? createBrowserCandidatePassBWorker)();
  } catch {
    return Promise.reject(
      new CandidatePassBWorkerError(
        "WORKER_FAILED",
        "후보 정밀 분석 작업 공간을 만들지 못했어요.",
      ),
    );
  }

  const timeoutMs = normalizeWorkerTimeout(options.timeoutMs);
  const cancelAcknowledgementTimeoutMs = normalizeCancelAcknowledgementTimeout(
    options.cancelAcknowledgementTimeoutMs,
  );
  const targetsById = new Map(
    normalized.targets.map((target, index) => [
      target.candidateId,
      { target, candidateOrdinal: index + 1 },
    ]),
  );
  let fence: FenceState = {
    identity: options.identity,
    processedEventIds: new Set(),
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    let operationTimeout: ReturnType<typeof setTimeout> | null = null;
    let cancelTimeout: ReturnType<typeof setTimeout> | null = null;
    let cancellationError: CandidatePassBWorkerError | null = null;
    let lastModelRatio = -1;
    let lastModelStage: CandidatePassBModelProgress["stage"] | null = null;
    const lastCandidateRatios = new Map<string, number>();
    const lastCandidateStageRanks = new Map<string, number>();
    const results: CandidatePassBTranscriptResult[] = [];
    const gaps: CandidatePassBCandidateGap[] = [];
    const outcomeUnknowns: CandidatePassBOutcomeUnknown[] = [];
    const armedDispatchByCandidateId = new Map<
      string,
      CandidatePassBDispatchIntent
    >();
    const pendingDispatchCandidateIds = new Set<string>();
    const pendingTerminalCandidateIds = new Set<string>();
    const terminalCandidateIds = new Set<string>();
    const pendingDurabilityHandshakes = new Set<Promise<void>>();
    let workerUnavailable = false;
    let workerLossRecovery: Promise<void> | null = null;

    const cleanup = (): boolean => {
      let succeeded = true;
      const attempt = (operation: () => void): void => {
        try {
          operation();
        } catch {
          succeeded = false;
        }
      };
      attempt(() => worker.removeEventListener("message", handleMessage));
      attempt(() => worker.removeEventListener("messageerror", handleMessageError));
      attempt(() => worker.removeEventListener("error", handleWorkerError));
      attempt(() => options.signal?.removeEventListener("abort", handleAbort));
      if (operationTimeout !== null) {
        const handle = operationTimeout;
        operationTimeout = null;
        attempt(() => globalThis.clearTimeout(handle));
      }
      if (cancelTimeout !== null) {
        const handle = cancelTimeout;
        cancelTimeout = null;
        attempt(() => globalThis.clearTimeout(handle));
      }
      attempt(() => worker.terminate());
      return succeeded;
    };

    const finish = (
      outcome:
        | { readonly ok: true; readonly result: CandidatePassBRunResult }
        | { readonly ok: false; readonly error: CandidatePassBWorkerError },
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      const cleanupSucceeded = cleanup();
      if (!cleanupSucceeded && outcome.ok) {
        reject(
          new CandidatePassBWorkerError(
            "WORKER_FAILED",
            "결과는 도착했지만 후보 정밀 분석 작업 공간을 정리하지 못했어요.",
          ),
        );
        return;
      }
      if (outcome.ok) {
        resolve(outcome.result);
      } else {
        reject(outcome.error);
      }
    };

    const malformedMessage = (): CandidatePassBWorkerError =>
      new CandidatePassBWorkerError(
        "WORKER_MESSAGE_ERROR",
        "후보 정밀 분석 작업 공간이 이해할 수 없는 응답을 보냈어요.",
      );

    const trackDurabilityHandshake = (handshake: Promise<void>): void => {
      pendingDurabilityHandshakes.add(handshake);
      void handshake.then(
        () => pendingDurabilityHandshakes.delete(handshake),
        () => pendingDurabilityHandshakes.delete(handshake),
      );
    };

    const drainDurabilityHandshakes = async (): Promise<void> => {
      while (pendingDurabilityHandshakes.size > 0) {
        await Promise.allSettled([...pendingDurabilityHandshakes]);
      }
    };

    const requestCancellation = (error: CandidatePassBWorkerError): void => {
      if (settled || cancellationError !== null) {
        return;
      }
      cancellationError = error;
      if (operationTimeout !== null) {
        globalThis.clearTimeout(operationTimeout);
        operationTimeout = null;
      }
      try {
        worker.postMessage({
          type: "candidate-pass-b-cancel",
          identity: options.identity,
        });
      } catch {
        finish({ ok: false, error });
        return;
      }
      cancelTimeout = globalThis.setTimeout(() => {
        finish({ ok: false, error });
      }, cancelAcknowledgementTimeoutMs);
    };

    const rejectMalformedMessage = (): void => {
      finish({ ok: false, error: malformedMessage() });
    };

    const invokeProgressCallback = (
      callback: (() => void) | undefined,
    ): boolean => {
      try {
        callback?.();
        return true;
      } catch {
        requestCancellation(
          new CandidatePassBWorkerError(
            "PROGRESS_CALLBACK_FAILED",
            "후보 정밀 분석 진행 상황을 화면에 표시하지 못했어요.",
          ),
        );
        return false;
      }
    };

    const invokeResultCallback = (
      callback: (() => void) | undefined,
    ): boolean => {
      try {
        callback?.();
        return true;
      } catch {
        requestCancellation(
          new CandidatePassBWorkerError(
            "RESULT_CALLBACK_FAILED",
            "후보 정밀 분석 결과를 화면에 반영하지 못했어요.",
          ),
        );
        return false;
      }
    };

    const handleModelProgress = (progress: CandidatePassBModelProgress): void => {
      if (
        progress.ratio < lastModelRatio ||
        lastModelStage === "ready" ||
        (progress.stage === "ready" && progress.ratio !== 1)
      ) {
        rejectMalformedMessage();
        return;
      }
      lastModelRatio = progress.ratio;
      lastModelStage = progress.stage;
      invokeProgressCallback(() => options.onModelProgress?.(progress));
    };

    const handleCandidateProgress = (
      progress: CandidatePassBCandidateProgress,
    ): void => {
      const targetEntry = targetsById.get(progress.candidateId);
      if (
        targetEntry === undefined ||
        progress.candidateOrdinal !== targetEntry.candidateOrdinal ||
        progress.targetCount !== normalized.targets.length
      ) {
        rejectMalformedMessage();
        return;
      }
      const previousRatio = lastCandidateRatios.get(progress.candidateId) ?? -1;
      const previousStageRank =
        lastCandidateStageRanks.get(progress.candidateId) ?? -1;
      const nextStageRank = stageRank(progress.stage);
      if (
        (pendingTerminalCandidateIds.has(progress.candidateId) &&
          nextStageRank === 2) ||
        (progress.stage === "complete" &&
          !terminalCandidateIds.has(progress.candidateId)) ||
        (terminalCandidateIds.has(progress.candidateId) &&
          nextStageRank !== 2) ||
        progress.ratio < previousRatio ||
        nextStageRank < previousStageRank ||
        (previousStageRank === 2 && nextStageRank === 2) ||
        ((progress.stage === "complete" || progress.stage === "gap") &&
          progress.ratio !== 1)
      ) {
        rejectMalformedMessage();
        return;
      }
      lastCandidateRatios.set(progress.candidateId, progress.ratio);
      lastCandidateStageRanks.set(progress.candidateId, nextStageRank);
      invokeProgressCallback(() => options.onCandidateProgress?.(progress));
    };

    const postTerminalResultAck = (
      terminalEventId: string,
      candidateId: string,
      settlement: CandidatePassBTerminalSettlement,
      accepted: boolean,
    ): boolean => {
      if (workerUnavailable) {
        return true;
      }
      try {
        worker.postMessage({
          type: "candidate-pass-b-terminal-result-ack",
          identity: options.identity,
          terminalEventId,
          candidateId,
          settlement,
          accepted,
        });
        return true;
      } catch {
        finish({
          ok: false,
          error: new CandidatePassBWorkerError(
            "RESULT_CALLBACK_FAILED",
            "The durable terminal acknowledgement could not be returned to the Worker.",
          ),
        });
        return false;
      }
    };

    const terminalPersistenceFailure = (): CandidatePassBWorkerError =>
      new CandidatePassBWorkerError(
        "RESULT_CALLBACK_FAILED",
        "The candidate terminal result did not survive durable readback.",
      );

    const handlePartialResult = async (
      terminalEventId: string,
      result: CandidatePassBTranscriptResult,
    ): Promise<void> => {
      const targetEntry = targetsById.get(result.candidateId);
      const armedDispatch = armedDispatchByCandidateId.get(result.candidateId);
      if (
        targetEntry === undefined ||
        armedDispatch === undefined ||
        pendingTerminalCandidateIds.has(result.candidateId) ||
        !matchesTargetRange(targetEntry.target, result) ||
        result.settlement.operationId !== armedDispatch.operationId ||
        result.settlement.providerPayloadDigest !==
          armedDispatch.mediaReceipt.providerPayloadDigest ||
        result.settlement.outputLanguage !== armedDispatch.outputLanguage ||
        result.settlement.castRosterId !== armedDispatch.castRosterId ||
        result.model.device !== options.device ||
        terminalCandidateIds.has(result.candidateId) ||
        !hasValidSegmentTimeline(result)
      ) {
        rejectMalformedMessage();
        return;
      }
      pendingTerminalCandidateIds.add(result.candidateId);
      let accepted: boolean;
      try {
        accepted = await options.onPartialResult(result);
      } catch {
        accepted = false;
      } finally {
        pendingTerminalCandidateIds.delete(result.candidateId);
      }
      if (settled) return;
      if (!accepted) {
        if (
          !postTerminalResultAck(
            terminalEventId,
            result.candidateId,
            result.settlement,
            false,
          )
        ) {
          return;
        }
        requestCancellation(terminalPersistenceFailure());
        return;
      }
      terminalCandidateIds.add(result.candidateId);
      results.push(result);
      postTerminalResultAck(
        terminalEventId,
        result.candidateId,
        result.settlement,
        true,
      );
    };

    const handleDispatchIntent = async (
      intent: CandidatePassBDispatchIntent,
    ): Promise<void> => {
      const targetEntry = targetsById.get(intent.candidateId);
      const expectedAttempt = options.quota.attemptOrdinal;
      const frameTimestamps = intent.mediaReceipt.frames.map(
        ({ timestampMs }) => timestampMs,
      );
      if (
        targetEntry === undefined ||
        terminalCandidateIds.has(intent.candidateId) ||
        pendingDispatchCandidateIds.has(intent.candidateId) ||
        armedDispatchByCandidateId.has(intent.candidateId) ||
        intent.analysisRunId !== options.identity.analysisRunId ||
        intent.sourceFingerprint !== options.sourceFingerprint ||
        intent.sourceStartMs !== targetEntry.target.startMs ||
        intent.sourceEndMs !== targetEntry.target.endMs ||
        intent.contextFingerprint !== targetEntry.target.contextFingerprint ||
        intent.outputLanguage !== targetEntry.target.outputLanguage ||
        intent.castRosterId !== targetEntry.target.castRosterId ||
        intent.attemptOrdinal !== expectedAttempt ||
        intent.retryGrantId !== options.quota.retryGrantId ||
        intent.mediaReceipt.frameExtractionRevision !==
          targetEntry.target.frameExtractionRevision ||
        frameTimestamps.some(
          (timestampMs, index) =>
            timestampMs !==
            targetEntry.target.videoFrames[index]?.timestampMs,
        )
      ) {
        rejectMalformedMessage();
        return;
      }
      pendingDispatchCandidateIds.add(intent.candidateId);
      let expectedOperationId: string;
      try {
        expectedOperationId = await createCandidatePassBOperationId({
          analysisRunId: intent.analysisRunId,
          sourceFingerprint: intent.sourceFingerprint,
          candidateId: intent.candidateId,
          sourceStartMs: intent.sourceStartMs,
          sourceEndMs: intent.sourceEndMs,
          contextFingerprint: intent.contextFingerprint,
          outputLanguage: intent.outputLanguage,
          castRosterId: intent.castRosterId,
          routingModelRevision: intent.routingModelRevision,
          attemptOrdinal: intent.attemptOrdinal,
          retryGrantId: intent.retryGrantId,
          transportMode: intent.transportMode,
          providerPayloadDigest:
            intent.mediaReceipt.providerPayloadDigest,
        });
      } catch {
        pendingDispatchCandidateIds.delete(intent.candidateId);
        rejectMalformedMessage();
        return;
      }
      if (intent.operationId !== expectedOperationId) {
        pendingDispatchCandidateIds.delete(intent.candidateId);
        rejectMalformedMessage();
        return;
      }
      let accepted: boolean;
      try {
        accepted = await options.onDispatchIntent(intent);
      } catch {
        accepted = false;
      } finally {
        pendingDispatchCandidateIds.delete(intent.candidateId);
      }
      if (settled) return;
      if (accepted) {
        armedDispatchByCandidateId.set(intent.candidateId, intent);
      }
      if (workerUnavailable) {
        return;
      }
      try {
        worker.postMessage({
          type: "candidate-pass-b-dispatch-arm-ack",
          identity: options.identity,
          operationId: intent.operationId,
          accepted,
        });
      } catch {
        finish({
          ok: false,
          error: new CandidatePassBWorkerError(
            "DISPATCH_ARM_CALLBACK_FAILED",
            "The durable dispatch acknowledgement could not be returned to the Worker.",
          ),
        });
      }
    };

    const handleOutcomeUnknown = async (
      terminalEventId: string,
      outcome: CandidatePassBOutcomeUnknown,
    ): Promise<void> => {
      const targetEntry = targetsById.get(outcome.candidateId);
      const armedDispatch = armedDispatchByCandidateId.get(outcome.candidateId);
      if (
        targetEntry === undefined ||
        armedDispatch === undefined ||
        pendingTerminalCandidateIds.has(outcome.candidateId) ||
        terminalCandidateIds.has(outcome.candidateId) ||
        !matchesTargetRange(targetEntry.target, outcome) ||
        outcome.settlement.operationId !== armedDispatch.operationId ||
        outcome.settlement.providerPayloadDigest !==
          armedDispatch.mediaReceipt.providerPayloadDigest ||
        outcome.settlement.outputLanguage !== armedDispatch.outputLanguage ||
        outcome.settlement.castRosterId !== armedDispatch.castRosterId
      ) {
        rejectMalformedMessage();
        return;
      }
      pendingTerminalCandidateIds.add(outcome.candidateId);
      let accepted: boolean;
      try {
        accepted = await options.onOutcomeUnknown(outcome);
      } catch {
        accepted = false;
      } finally {
        pendingTerminalCandidateIds.delete(outcome.candidateId);
      }
      if (settled) return;
      if (!accepted) {
        if (
          !postTerminalResultAck(
            terminalEventId,
            outcome.candidateId,
            outcome.settlement,
            false,
          )
        ) {
          return;
        }
        requestCancellation(terminalPersistenceFailure());
        return;
      }
      terminalCandidateIds.add(outcome.candidateId);
      outcomeUnknowns.push(outcome);
      postTerminalResultAck(
        terminalEventId,
        outcome.candidateId,
        outcome.settlement,
        true,
      );
    };

    const handleCandidateGap = (gap: CandidatePassBCandidateGap): void => {
      const targetEntry = targetsById.get(gap.candidateId);
      if (
        targetEntry === undefined ||
        !matchesTargetRange(targetEntry.target, gap) ||
        terminalCandidateIds.has(gap.candidateId)
      ) {
        rejectMalformedMessage();
        return;
      }
      const safeGap: CandidatePassBCandidateGap = {
        ...gap,
        message: safeCandidateGapMessage(gap.reasonCode),
      };
      terminalCandidateIds.add(gap.candidateId);
      gaps.push(safeGap);
      invokeResultCallback(() => options.onCandidateGap?.(safeGap));
    };

    const failAfterWorkerLoss = (error: CandidatePassBWorkerError): void => {
      if (settled || workerLossRecovery !== null) {
        return;
      }
      workerUnavailable = true;
      if (operationTimeout !== null) {
        globalThis.clearTimeout(operationTimeout);
        operationTimeout = null;
      }
      if (cancelTimeout !== null) {
        globalThis.clearTimeout(cancelTimeout);
        cancelTimeout = null;
      }
      workerLossRecovery = (async () => {
        /*
         * A Worker can disappear while a durable arm/result callback is still
         * crossing the main-thread boundary. Drain those callbacks first. Any
         * accepted arm that still lacks a terminal settlement is then persisted
         * as outcome-unknown before the run promise is rejected.
         */
        await drainDurabilityHandshakes();
        let terminalPersistenceFailed = false;
        for (const [candidateId, intent] of armedDispatchByCandidateId) {
          if (terminalCandidateIds.has(candidateId)) {
            continue;
          }
          const outcome: CandidatePassBOutcomeUnknown = {
            candidateId,
            sourceStartMs: intent.sourceStartMs,
            sourceEndMs: intent.sourceEndMs,
            settlement: {
              schemaVersion: CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION,
              status: "outcome-unknown",
              operationId: intent.operationId,
              providerPayloadDigest:
                intent.mediaReceipt.providerPayloadDigest,
              outputLanguage: intent.outputLanguage,
              castRosterId: intent.castRosterId,
              reason: "armed-dispatch-interrupted",
            },
          };
          let accepted: boolean;
          try {
            accepted = await options.onOutcomeUnknown(outcome);
          } catch {
            accepted = false;
          }
          if (!accepted) {
            terminalPersistenceFailed = true;
            continue;
          }
          terminalCandidateIds.add(candidateId);
          outcomeUnknowns.push(outcome);
        }
        finish({
          ok: false,
          error: terminalPersistenceFailed
            ? terminalPersistenceFailure()
            : error,
        });
      })();
      void workerLossRecovery;
    };

    const handleMessage = (event: MessageEvent<unknown> | ErrorEvent): void => {
      if (workerUnavailable) {
        return;
      }
      try {
        if (!(event instanceof MessageEvent) || !isWorkerResponse(event.data)) {
          rejectMalformedMessage();
          return;
        }
        const fenced = fenceEvent(fence, event.data);
        if (!fenced.accepted) {
          finish({
            ok: false,
            error: new CandidatePassBWorkerError(
              "EVENT_FENCE_REJECTED",
              `후보 정밀 분석 응답이 현재 작업과 일치하지 않아요: ${fenced.reason}`,
              { fenceReason: fenced.reason },
            ),
          });
          return;
        }
        fence = fenced.state;

        if (cancellationError !== null) {
          /*
           * Cancellation stops new provider work, but a dispatch intent or a
           * terminal result may already be crossing the Worker boundary. Keep
           * processing those durability handshakes; the Worker sends its
           * cancellation ACK only after every durably armed operation has a
           * terminal settlement.
          */
          if (event.data.type === "candidate-pass-b-dispatch-intent") {
            trackDurabilityHandshake(handleDispatchIntent(event.data.intent));
            return;
          }
          if (event.data.type === "candidate-pass-b-partial-result") {
            trackDurabilityHandshake(
              handlePartialResult(event.data.eventId, event.data.result),
            );
            return;
          }
          if (event.data.type === "candidate-pass-b-outcome-unknown") {
            trackDurabilityHandshake(
              handleOutcomeUnknown(event.data.eventId, event.data.outcome),
            );
            return;
          }
          if (event.data.type === "candidate-pass-b-cancel-acknowledged") {
            try {
              options.onCancellationAcknowledged?.();
            } catch {
              finish({
                ok: false,
                error: new CandidatePassBWorkerError(
                  "CANCEL_ACK_CALLBACK_FAILED",
                  "취소 확인을 화면 상태에 반영하지 못했어요.",
                ),
              });
              return;
            }
            finish({ ok: false, error: cancellationError });
          }
          return;
        }

        switch (event.data.type) {
          case "candidate-pass-b-model-progress":
            handleModelProgress(event.data.progress);
            return;
          case "candidate-pass-b-candidate-progress":
            handleCandidateProgress(event.data.progress);
            return;
          case "candidate-pass-b-partial-result":
            trackDurabilityHandshake(
              handlePartialResult(event.data.eventId, event.data.result),
            );
            return;
          case "candidate-pass-b-dispatch-intent":
            trackDurabilityHandshake(handleDispatchIntent(event.data.intent));
            return;
          case "candidate-pass-b-outcome-unknown":
            trackDurabilityHandshake(
              handleOutcomeUnknown(event.data.eventId, event.data.outcome),
            );
            return;
          case "candidate-pass-b-candidate-gap":
            handleCandidateGap(event.data.gap);
            return;
          case "candidate-pass-b-cancel-acknowledged":
            rejectMalformedMessage();
            return;
          case "candidate-pass-b-failed":
            finish({
              ok: false,
              error: new CandidatePassBWorkerError(
                "WORKER_FAILED",
                candidatePassBWorkerFailureMessage(event.data.reasonCode),
                { workerReasonCode: event.data.reasonCode },
              ),
            });
            return;
          case "candidate-pass-b-completed": {
            const summary = event.data.summary;
            if (
              pendingTerminalCandidateIds.size !== 0 ||
              terminalCandidateIds.size !== normalized.targets.length ||
              summary.requestedCount !== normalized.targets.length ||
              summary.completedCount !== results.length ||
              summary.gapCount !== gaps.length + outcomeUnknowns.length
            ) {
              rejectMalformedMessage();
              return;
            }
            finish({
              ok: true,
              result: {
                results: [...results],
                gaps: [...gaps],
                outcomeUnknowns: [...outcomeUnknowns],
                summary,
              },
            });
            return;
          }
        }
      } catch {
        rejectMalformedMessage();
      }
    };

    const handleMessageError = (): void => {
      failAfterWorkerLoss(
        cancellationError ??
          new CandidatePassBWorkerError(
            "WORKER_MESSAGE_ERROR",
            "브라우저가 후보 정밀 분석 응답을 읽지 못했어요.",
          ),
      );
    };

    const handleWorkerError = (): void => {
      failAfterWorkerLoss(
        cancellationError ??
          new CandidatePassBWorkerError(
            "WORKER_FAILED",
            "후보 정밀 분석 작업 공간이 예기치 않게 멈췄어요.",
          ),
      );
    };

    const handleAbort = (): void => {
      requestCancellation(
        new CandidatePassBWorkerError(
          "ABORTED",
          "사용자가 후보 정밀 분석을 취소했어요.",
        ),
      );
    };

    try {
      worker.addEventListener("message", handleMessage);
      worker.addEventListener("messageerror", handleMessageError);
      worker.addEventListener("error", handleWorkerError);
      options.signal?.addEventListener("abort", handleAbort, { once: true });
      operationTimeout = globalThis.setTimeout(() => {
        requestCancellation(
          new CandidatePassBWorkerError(
            "WORKER_TIMEOUT",
            "후보 정밀 분석이 제한 시간 안에 끝나지 않았어요.",
          ),
        );
      }, timeoutMs);

      worker.postMessage({
        type: "candidate-pass-b-analyze",
        identity: options.identity,
        quota: options.quota,
        file,
        sourceFingerprint: options.sourceFingerprint,
        sourceDurationMs: normalized.sourceDurationMs,
        device: CANDIDATE_PASS_B_DEVICE,
        targets: normalized.targets,
      });
    } catch {
      finish({
        ok: false,
        error: new CandidatePassBWorkerError(
          "WORKER_FAILED",
          "후보 정밀 분석 작업 공간에 입력을 전달하지 못했어요.",
        ),
      });
    }
  });
}
