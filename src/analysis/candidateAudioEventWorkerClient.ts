import {
  CANDIDATE_AUDIO_EVENT_MODEL_DTYPE,
  CANDIDATE_AUDIO_EVENT_MODEL_ID,
  CANDIDATE_AUDIO_EVENT_MODEL_REVISION,
  CANDIDATE_AUDIO_EVENT_PROTOCOL_VERSION,
  CANDIDATE_AUDIO_EVENT_RUNTIME_DEVICE,
  CANDIDATE_AUDIO_EVENT_SAMPLE_RATE_HZ,
  CANDIDATE_AUDIO_EVENT_WINDOW_DURATION_MS,
  MAX_CANDIDATE_AUDIO_EVENT_SOURCE_DURATION_MS,
  MAX_CANDIDATE_AUDIO_EVENT_TARGET_DURATION_MS,
  MAX_CANDIDATE_AUDIO_EVENT_TARGETS,
  MAX_CANDIDATE_AUDIO_EVENT_WINDOWS_PER_TARGET,
  type CandidateAudioEventCandidateGap,
  type CandidateAudioEventCandidateGapReason,
  type CandidateAudioEventCandidateProgress,
  type CandidateAudioEventCandidateResult,
  type CandidateAudioEventCompletionSummary,
  type CandidateAudioEventDetection,
  type CandidateAudioEventModelProgress,
  type CandidateAudioEventTarget,
  type CandidateAudioEventWorkerFailureReason,
  type CandidateAudioEventWorkerIdentity,
  type CandidateAudioEventWorkerRequest,
  type CandidateAudioEventWorkerResponse,
} from "./candidateAudioEventWorkerProtocol";

export {
  CANDIDATE_AUDIO_EVENT_MODEL_DTYPE,
  CANDIDATE_AUDIO_EVENT_MODEL_ID,
  CANDIDATE_AUDIO_EVENT_MODEL_REVISION,
  CANDIDATE_AUDIO_EVENT_PROTOCOL_VERSION,
  CANDIDATE_AUDIO_EVENT_RUNTIME_DEVICE,
  CANDIDATE_AUDIO_EVENT_SAMPLE_RATE_HZ,
  CANDIDATE_AUDIO_EVENT_WINDOW_DURATION_MS,
  MAX_CANDIDATE_AUDIO_EVENT_SOURCE_DURATION_MS,
  MAX_CANDIDATE_AUDIO_EVENT_TARGET_DURATION_MS,
  MAX_CANDIDATE_AUDIO_EVENT_TARGETS,
  MAX_CANDIDATE_AUDIO_EVENT_WINDOWS_PER_TARGET,
  type CandidateAudioEventCandidateGap,
  type CandidateAudioEventCandidateGapReason,
  type CandidateAudioEventCandidateProgress,
  type CandidateAudioEventCandidateResult,
  type CandidateAudioEventCompletionSummary,
  type CandidateAudioEventDetectedResult,
  type CandidateAudioEventDetection,
  type CandidateAudioEventKind,
  type CandidateAudioEventModelProgress,
  type CandidateAudioEventNoClearReason,
  type CandidateAudioEventNoClearResult,
  type CandidateAudioEventStrength,
  type CandidateAudioEventTarget,
  type CandidateAudioEventWorkerFailureReason,
  type CandidateAudioEventWorkerIdentity,
} from "./candidateAudioEventWorkerProtocol";

type WorkerEventType = "message" | "messageerror" | "error";
type WorkerListener = (event: MessageEvent<unknown> | ErrorEvent) => void;

const RESPONSE_ENVELOPE_KEYS = [
  "protocolVersion",
  "sessionId",
  "writerEpoch",
  "analysisRunId",
  "audioEventRunId",
  "workerEpoch",
  "workerInstanceId",
  "taskId",
  "eventId",
  "type",
] as const;
const IDENTITY_KEYS = [
  "protocolVersion",
  "sessionId",
  "writerEpoch",
  "analysisRunId",
  "audioEventRunId",
  "workerEpoch",
  "workerInstanceId",
  "taskId",
] as const;
const TARGET_KEYS = ["candidateId", "startMs", "endMs", "peakMs"] as const;
const RESULT_BASE_KEYS = [
  "mode",
  "candidateId",
  "sourceStartMs",
  "sourceEndMs",
  "reactionPeakMs",
  "analyzedWindowCount",
  "quality",
  "model",
  "sampleRateHz",
] as const;
const MAX_WORKER_MESSAGE_LENGTH = 1_000;
const MAX_DETECTIONS_PER_RESULT = 2;

export interface CandidateAudioEventWorkerLike {
  addEventListener(type: WorkerEventType, listener: WorkerListener): void;
  removeEventListener(type: WorkerEventType, listener: WorkerListener): void;
  postMessage(message: CandidateAudioEventWorkerRequest): void;
  terminate(): void;
}

export type CandidateAudioEventWorkerFactory =
  () => CandidateAudioEventWorkerLike;

export interface RunCandidateAudioEventWorkerOptions {
  readonly identity: CandidateAudioEventWorkerIdentity;
  readonly sourceDurationMs: number;
  /** Immutable, score-ordered candidate list. */
  readonly targets: readonly CandidateAudioEventTarget[];
  readonly signal?: AbortSignal;
  readonly onModelProgress?: (progress: CandidateAudioEventModelProgress) => void;
  readonly onCandidateProgress?: (
    progress: CandidateAudioEventCandidateProgress,
  ) => void;
  readonly onPartialResult?: (
    result: CandidateAudioEventCandidateResult,
  ) => void;
  readonly onCandidateGap?: (gap: CandidateAudioEventCandidateGap) => void;
  /** Called only after a correctly fenced cancellation ACK is received. */
  readonly onCancellationAcknowledged?: () => void;
  readonly timeoutMs?: number;
  readonly cancelAcknowledgementTimeoutMs?: number;
  readonly workerFactory?: CandidateAudioEventWorkerFactory;
}

export interface CandidateAudioEventRunResult {
  readonly results: readonly CandidateAudioEventCandidateResult[];
  readonly gaps: readonly CandidateAudioEventCandidateGap[];
  readonly summary: CandidateAudioEventCompletionSummary;
}

export type CandidateAudioEventFenceRejectionReason =
  | "invalid_event_id"
  | "protocol_version_mismatch"
  | "session_id_mismatch"
  | "writer_epoch_mismatch"
  | "analysis_run_id_mismatch"
  | "audio_event_run_id_mismatch"
  | "worker_epoch_mismatch"
  | "worker_instance_id_mismatch"
  | "task_id_mismatch"
  | "duplicate_event_id";

export type CandidateAudioEventWorkerErrorCode =
  | "INVALID_INPUT"
  | "ABORTED"
  | "EVENT_FENCE_REJECTED"
  | "WORKER_FAILED"
  | "WORKER_MESSAGE_ERROR"
  | "WORKER_TIMEOUT"
  | "PROGRESS_CALLBACK_FAILED"
  | "RESULT_CALLBACK_FAILED"
  | "CANCEL_ACK_CALLBACK_FAILED";

export class CandidateAudioEventWorkerError extends Error {
  public readonly code: CandidateAudioEventWorkerErrorCode;
  public readonly fenceReason: CandidateAudioEventFenceRejectionReason | null;
  public readonly workerReasonCode: CandidateAudioEventWorkerFailureReason | null;

  public constructor(
    code: CandidateAudioEventWorkerErrorCode,
    message: string,
    options: {
      readonly fenceReason?: CandidateAudioEventFenceRejectionReason;
      readonly workerReasonCode?: CandidateAudioEventWorkerFailureReason;
    } = {},
  ) {
    super(message);
    this.name = "CandidateAudioEventWorkerError";
    this.code = code;
    this.fenceReason = options.fenceReason ?? null;
    this.workerReasonCode = options.workerReasonCode ?? null;
  }
}

export const DEFAULT_CANDIDATE_AUDIO_EVENT_WORKER_TIMEOUT_MS =
  2 * 60 * 60_000;
export const DEFAULT_CANDIDATE_AUDIO_EVENT_CANCEL_ACK_TIMEOUT_MS = 5_000;

interface NormalizedRunInput {
  readonly sourceDurationMs: number;
  readonly targets: readonly CandidateAudioEventTarget[];
}

interface FenceState {
  readonly identity: CandidateAudioEventWorkerIdentity;
  readonly processedEventIds: ReadonlySet<string>;
}

type FenceOutcome =
  | { readonly accepted: true; readonly state: FenceState }
  | {
      readonly accepted: false;
      readonly state: FenceState;
      readonly reason: CandidateAudioEventFenceRejectionReason;
    };

export function createBrowserCandidateAudioEventWorker(): CandidateAudioEventWorkerLike {
  return new Worker(
    new URL("./candidateAudioEvent.worker.ts", import.meta.url),
    {
      type: "module",
      name: "retto-candidate-audio-event",
    },
  );
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

function isNullableNonNegativeSafeInteger(value: unknown): boolean {
  return value === null || isNonNegativeSafeInteger(value);
}

function isDenseArray(value: readonly unknown[]): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === value.length &&
    keys.every((key, index) => key === String(index))
  );
}

function isFenceEnvelope(value: Record<string, unknown>): boolean {
  return (
    typeof value.protocolVersion === "string" &&
    typeof value.eventId === "string" &&
    typeof value.sessionId === "string" &&
    Number.isSafeInteger(value.writerEpoch) &&
    typeof value.analysisRunId === "string" &&
    typeof value.audioEventRunId === "string" &&
    Number.isSafeInteger(value.workerEpoch) &&
    typeof value.workerInstanceId === "string" &&
    typeof value.taskId === "string"
  );
}

function isModelProgress(
  value: unknown,
): value is CandidateAudioEventModelProgress {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["stage", "ratio", "loadedBytes", "totalBytes"])
  ) {
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
): value is CandidateAudioEventCandidateProgress {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "candidateId",
      "candidateOrdinal",
      "targetCount",
      "stage",
      "ratio",
    ])
  ) {
    return false;
  }
  return (
    isNonEmptyString(value.candidateId) &&
    Number.isSafeInteger(value.candidateOrdinal) &&
    (value.candidateOrdinal as number) > 0 &&
    Number.isSafeInteger(value.targetCount) &&
    (value.targetCount as number) > 0 &&
    (value.stage === "decoding" ||
      value.stage === "classifying" ||
      value.stage === "complete" ||
      value.stage === "gap") &&
    isFiniteNumber(value.ratio) &&
    value.ratio >= 0 &&
    value.ratio <= 1
  );
}

function isDetectionKind(value: unknown): boolean {
  return (
    value === "laughter" ||
    value === "shout" ||
    value === "scream" ||
    value === "applause-or-cheering"
  );
}

function isDetection(value: unknown): value is CandidateAudioEventDetection {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "kind",
      "strength",
      "sourceStartMs",
      "sourceEndMs",
    ]) &&
    isDetectionKind(value.kind) &&
    (value.strength === "strong" || value.strength === "possible") &&
    isNonNegativeSafeInteger(value.sourceStartMs) &&
    isNonNegativeSafeInteger(value.sourceEndMs) &&
    value.sourceEndMs > value.sourceStartMs &&
    value.sourceEndMs - value.sourceStartMs <=
      CANDIDATE_AUDIO_EVENT_WINDOW_DURATION_MS
  );
}

function isNoClearReason(value: unknown): boolean {
  return (
    value === "NO_ALLOWLIST_EVENT" ||
    value === "LOW_EVENT_CONFIDENCE" ||
    value === "NOISY_AUDIO"
  );
}

function isModelDescriptor(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["id", "revision", "dtype", "device"]) &&
    value.id === CANDIDATE_AUDIO_EVENT_MODEL_ID &&
    value.revision === CANDIDATE_AUDIO_EVENT_MODEL_REVISION &&
    value.dtype === CANDIDATE_AUDIO_EVENT_MODEL_DTYPE &&
    value.device === CANDIDATE_AUDIO_EVENT_RUNTIME_DEVICE
  );
}

function hasValidResultBase(value: Record<string, unknown>): boolean {
  return (
    value.mode === "candidate-audio-event" &&
    isNonEmptyString(value.candidateId) &&
    isNonNegativeSafeInteger(value.sourceStartMs) &&
    isNonNegativeSafeInteger(value.sourceEndMs) &&
    value.sourceEndMs > value.sourceStartMs &&
    isNonNegativeSafeInteger(value.reactionPeakMs) &&
    value.reactionPeakMs >= value.sourceStartMs &&
    value.reactionPeakMs <= value.sourceEndMs &&
    Number.isSafeInteger(value.analyzedWindowCount) &&
    (value.analyzedWindowCount as number) > 0 &&
    (value.analyzedWindowCount as number) <=
      MAX_CANDIDATE_AUDIO_EVENT_WINDOWS_PER_TARGET &&
    value.quality === "provisional-audio-event" &&
    isModelDescriptor(value.model) &&
    value.sampleRateHz === CANDIDATE_AUDIO_EVENT_SAMPLE_RATE_HZ
  );
}

function isCandidateResult(
  value: unknown,
): value is CandidateAudioEventCandidateResult {
  if (!isRecord(value) || !hasValidResultBase(value)) {
    return false;
  }
  if (value.status === "detected") {
    return (
      hasExactKeys(value, [...RESULT_BASE_KEYS, "status", "detections"]) &&
      Array.isArray(value.detections) &&
      isDenseArray(value.detections) &&
      value.detections.length > 0 &&
      value.detections.length <= MAX_DETECTIONS_PER_RESULT &&
      value.detections.every(isDetection)
    );
  }
  if (value.status === "no-clear-event") {
    return (
      hasExactKeys(value, [
        ...RESULT_BASE_KEYS,
        "status",
        "reasonCode",
        "detections",
      ]) &&
      isNoClearReason(value.reasonCode) &&
      Array.isArray(value.detections) &&
      isDenseArray(value.detections) &&
      value.detections.length === 0
    );
  }
  return false;
}

function isGapReason(
  value: unknown,
): value is CandidateAudioEventCandidateGapReason {
  return (
    value === "NO_AUDIO_TRACK" ||
    value === "UNSUPPORTED_CONTAINER" ||
    value === "UNSUPPORTED_AUDIO_CODEC" ||
    value === "EMPTY_AUDIO" ||
    value === "AUDIO_DECODE_FAILED" ||
    value === "CLASSIFICATION_FAILED"
  );
}

function isCandidateGap(
  value: unknown,
): value is CandidateAudioEventCandidateGap {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "candidateId",
      "sourceStartMs",
      "sourceEndMs",
      "reactionPeakMs",
      "reasonCode",
      "message",
    ]) &&
    isNonEmptyString(value.candidateId) &&
    isNonNegativeSafeInteger(value.sourceStartMs) &&
    isNonNegativeSafeInteger(value.sourceEndMs) &&
    value.sourceEndMs > value.sourceStartMs &&
    isNonNegativeSafeInteger(value.reactionPeakMs) &&
    value.reactionPeakMs >= value.sourceStartMs &&
    value.reactionPeakMs <= value.sourceEndMs &&
    isGapReason(value.reasonCode) &&
    isNonEmptyString(value.message) &&
    value.message.length <= MAX_WORKER_MESSAGE_LENGTH
  );
}

function isCompletionSummary(
  value: unknown,
): value is CandidateAudioEventCompletionSummary {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["requestedCount", "completedCount", "gapCount"]) &&
    isNonNegativeSafeInteger(value.requestedCount) &&
    isNonNegativeSafeInteger(value.completedCount) &&
    isNonNegativeSafeInteger(value.gapCount) &&
    value.requestedCount <= MAX_CANDIDATE_AUDIO_EVENT_TARGETS &&
    value.completedCount + value.gapCount === value.requestedCount
  );
}

function isWorkerFailureReason(
  value: unknown,
): value is CandidateAudioEventWorkerFailureReason {
  return (
    value === "INVALID_REQUEST" ||
    value === "WORKER_BUSY" ||
    value === "MODEL_LOAD_FAILED" ||
    value === "UNEXPECTED_WORKER_FAILURE"
  );
}

function isWorkerResponse(
  value: unknown,
): value is CandidateAudioEventWorkerResponse {
  if (!isRecord(value) || !isFenceEnvelope(value)) {
    return false;
  }
  switch (value.type) {
    case "candidate-audio-event-model-progress":
      return hasResponseKeys(value, ["progress"]) && isModelProgress(value.progress);
    case "candidate-audio-event-candidate-progress":
      return (
        hasResponseKeys(value, ["progress"]) &&
        isCandidateProgress(value.progress)
      );
    case "candidate-audio-event-partial-result":
      return (
        hasResponseKeys(value, ["result"]) && isCandidateResult(value.result)
      );
    case "candidate-audio-event-candidate-gap":
      return hasResponseKeys(value, ["gap"]) && isCandidateGap(value.gap);
    case "candidate-audio-event-completed":
      return (
        hasResponseKeys(value, ["summary"]) &&
        isCompletionSummary(value.summary)
      );
    case "candidate-audio-event-cancel-acknowledged":
      return hasResponseKeys(value, []);
    case "candidate-audio-event-failed":
      return (
        hasResponseKeys(value, ["reasonCode", "message"]) &&
        isWorkerFailureReason(value.reasonCode) &&
        isNonEmptyString(value.message) &&
        value.message.length <= MAX_WORKER_MESSAGE_LENGTH
      );
    default:
      return false;
  }
}

function rejectFence(
  state: FenceState,
  reason: CandidateAudioEventFenceRejectionReason,
): FenceOutcome {
  return { accepted: false, state, reason };
}

function fenceEvent(
  state: FenceState,
  event: CandidateAudioEventWorkerResponse,
): FenceOutcome {
  if (event.eventId.trim().length === 0) {
    return rejectFence(state, "invalid_event_id");
  }
  const identity = state.identity;
  if (event.protocolVersion !== identity.protocolVersion) {
    return rejectFence(state, "protocol_version_mismatch");
  }
  if (event.sessionId !== identity.sessionId) {
    return rejectFence(state, "session_id_mismatch");
  }
  if (event.writerEpoch !== identity.writerEpoch) {
    return rejectFence(state, "writer_epoch_mismatch");
  }
  if (event.analysisRunId !== identity.analysisRunId) {
    return rejectFence(state, "analysis_run_id_mismatch");
  }
  if (event.audioEventRunId !== identity.audioEventRunId) {
    return rejectFence(state, "audio_event_run_id_mismatch");
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
    return DEFAULT_CANDIDATE_AUDIO_EVENT_WORKER_TIMEOUT_MS;
  }
  return Number.isFinite(value)
    ? Math.min(24 * 60 * 60_000, Math.max(1, Math.round(value)))
    : DEFAULT_CANDIDATE_AUDIO_EVENT_WORKER_TIMEOUT_MS;
}

function normalizeCancelAcknowledgementTimeout(
  value: number | undefined,
): number {
  if (value === undefined) {
    return DEFAULT_CANDIDATE_AUDIO_EVENT_CANCEL_ACK_TIMEOUT_MS;
  }
  return Number.isFinite(value)
    ? Math.min(30_000, Math.max(50, Math.round(value)))
    : DEFAULT_CANDIDATE_AUDIO_EVENT_CANCEL_ACK_TIMEOUT_MS;
}

function validateIdentity(
  identity: unknown,
): identity is CandidateAudioEventWorkerIdentity {
  return (
    isRecord(identity) &&
    hasExactKeys(identity, IDENTITY_KEYS) &&
    identity.protocolVersion === CANDIDATE_AUDIO_EVENT_PROTOCOL_VERSION &&
    isNonEmptyString(identity.sessionId) &&
    isNonNegativeSafeInteger(identity.writerEpoch) &&
    isNonEmptyString(identity.analysisRunId) &&
    isNonEmptyString(identity.audioEventRunId) &&
    isNonNegativeSafeInteger(identity.workerEpoch) &&
    isNonEmptyString(identity.workerInstanceId) &&
    isNonEmptyString(identity.taskId)
  );
}

function normalizeInput(
  file: File,
  options: RunCandidateAudioEventWorkerOptions,
): NormalizedRunInput | CandidateAudioEventWorkerError {
  if (
    typeof file !== "object" ||
    file === null ||
    !Number.isFinite(file.size) ||
    file.size < 0 ||
    !validateIdentity(options.identity) ||
    !Number.isFinite(options.sourceDurationMs)
  ) {
    return new CandidateAudioEventWorkerError(
      "INVALID_INPUT",
      "후보 오디오 반응 분석 입력이 올바르지 않아요.",
    );
  }

  const sourceDurationMs = Math.round(options.sourceDurationMs);
  if (
    sourceDurationMs <= 0 ||
    sourceDurationMs > MAX_CANDIDATE_AUDIO_EVENT_SOURCE_DURATION_MS ||
    !Array.isArray(options.targets) ||
    options.targets.length === 0 ||
    options.targets.length > MAX_CANDIDATE_AUDIO_EVENT_TARGETS
  ) {
    return new CandidateAudioEventWorkerError(
      "INVALID_INPUT",
      "후보 오디오 반응 분석 범위가 허용된 한도를 벗어났어요.",
    );
  }

  const targets: CandidateAudioEventTarget[] = [];
  const candidateIds = new Set<string>();
  const targetValues: readonly unknown[] = options.targets;
  for (const target of targetValues) {
    if (
      !isRecord(target) ||
      !hasExactKeys(target, TARGET_KEYS) ||
      !isNonEmptyString(target.candidateId) ||
      !isFiniteNumber(target.startMs) ||
      !isFiniteNumber(target.endMs) ||
      !isFiniteNumber(target.peakMs)
    ) {
      return new CandidateAudioEventWorkerError(
        "INVALID_INPUT",
        "후보 오디오 반응 구간이 올바르지 않아요.",
      );
    }
    const normalizedTarget: CandidateAudioEventTarget = {
      candidateId: target.candidateId,
      startMs: Math.round(target.startMs),
      endMs: Math.round(target.endMs),
      peakMs: Math.round(target.peakMs),
    };
    if (
      normalizedTarget.startMs < 0 ||
      normalizedTarget.endMs <= normalizedTarget.startMs ||
      normalizedTarget.endMs > sourceDurationMs ||
      normalizedTarget.endMs - normalizedTarget.startMs >
        MAX_CANDIDATE_AUDIO_EVENT_TARGET_DURATION_MS ||
      normalizedTarget.peakMs < normalizedTarget.startMs ||
      normalizedTarget.peakMs > normalizedTarget.endMs ||
      candidateIds.has(normalizedTarget.candidateId)
    ) {
      return new CandidateAudioEventWorkerError(
        "INVALID_INPUT",
        "후보 오디오 반응 구간이 중복되었거나 허용 범위를 벗어났어요.",
      );
    }
    candidateIds.add(normalizedTarget.candidateId);
    targets.push(normalizedTarget);
  }

  return { sourceDurationMs, targets };
}

function stageRank(
  stage: CandidateAudioEventCandidateProgress["stage"],
): number {
  switch (stage) {
    case "decoding":
      return 0;
    case "classifying":
      return 1;
    case "complete":
    case "gap":
      return 2;
  }
}

function isPreModelSourceGapReason(
  reasonCode: CandidateAudioEventCandidateGapReason,
): boolean {
  return (
    reasonCode === "NO_AUDIO_TRACK" ||
    reasonCode === "UNSUPPORTED_CONTAINER" ||
    reasonCode === "UNSUPPORTED_AUDIO_CODEC" ||
    reasonCode === "AUDIO_DECODE_FAILED"
  );
}

function matchesTarget(
  target: CandidateAudioEventTarget,
  value: {
    readonly candidateId: string;
    readonly sourceStartMs: number;
    readonly sourceEndMs: number;
    readonly reactionPeakMs: number;
  },
): boolean {
  return (
    value.candidateId === target.candidateId &&
    value.sourceStartMs === target.startMs &&
    value.sourceEndMs === target.endMs &&
    value.reactionPeakMs === target.peakMs
  );
}

function hasValidDetectionTimeline(
  target: CandidateAudioEventTarget,
  result: CandidateAudioEventCandidateResult,
): boolean {
  if (result.status === "no-clear-event") {
    return true;
  }
  let previousStartMs = target.startMs;
  for (const detection of result.detections) {
    if (
      detection.sourceStartMs < target.startMs ||
      detection.sourceEndMs > target.endMs ||
      detection.sourceStartMs < previousStartMs
    ) {
      return false;
    }
    previousStartMs = detection.sourceStartMs;
  }
  return true;
}

/**
 * Runs the fixed, allowlist-only audio-event model for immutable candidates.
 * Raw PCM, logits, complete AudioSet labels, and source separation data never
 * cross this client boundary. The Worker is terminated on every exit path.
 */
export function runCandidateAudioEventWorker(
  file: File,
  options: RunCandidateAudioEventWorkerOptions,
): Promise<CandidateAudioEventRunResult> {
  const normalized = normalizeInput(file, options);
  if (normalized instanceof CandidateAudioEventWorkerError) {
    return Promise.reject(normalized);
  }
  if (options.signal?.aborted === true) {
    return Promise.reject(
      new CandidateAudioEventWorkerError(
        "ABORTED",
        "후보 오디오 반응 분석을 시작하기 전에 취소했어요.",
      ),
    );
  }

  let worker: CandidateAudioEventWorkerLike;
  try {
    worker = (options.workerFactory ?? createBrowserCandidateAudioEventWorker)();
  } catch {
    return Promise.reject(
      new CandidateAudioEventWorkerError(
        "WORKER_FAILED",
        "후보 오디오 반응 분석 작업 공간을 만들지 못했어요.",
      ),
    );
  }

  const timeoutMs = normalizeWorkerTimeout(options.timeoutMs);
  const cancelAcknowledgementTimeoutMs =
    normalizeCancelAcknowledgementTimeout(
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
    let cancellationError: CandidateAudioEventWorkerError | null = null;
    let lastModelRatio = -1;
    let lastModelStage: CandidateAudioEventModelProgress["stage"] | null = null;
    let modelReady = false;
    let candidatePhaseStarted = false;
    const lastCandidateRatios = new Map<string, number>();
    const lastCandidateStageRanks = new Map<string, number>();
    const lastCandidateTerminalStages = new Map<
      string,
      "complete" | "gap"
    >();
    const results: CandidateAudioEventCandidateResult[] = [];
    const gaps: CandidateAudioEventCandidateGap[] = [];
    const terminalCandidateIds = new Set<string>();

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
        | { readonly ok: true; readonly result: CandidateAudioEventRunResult }
        | { readonly ok: false; readonly error: CandidateAudioEventWorkerError },
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      const cleanupSucceeded = cleanup();
      if (!cleanupSucceeded && outcome.ok) {
        reject(
          new CandidateAudioEventWorkerError(
            "WORKER_FAILED",
            "결과는 도착했지만 오디오 반응 분석 작업 공간을 정리하지 못했어요.",
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

    const malformedMessage = (): CandidateAudioEventWorkerError =>
      new CandidateAudioEventWorkerError(
        "WORKER_MESSAGE_ERROR",
        "후보 오디오 반응 분석 작업 공간이 이해할 수 없는 응답을 보냈어요.",
      );

    const requestCancellation = (
      error: CandidateAudioEventWorkerError,
    ): void => {
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
          type: "candidate-audio-event-cancel",
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
          new CandidateAudioEventWorkerError(
            "PROGRESS_CALLBACK_FAILED",
            "오디오 반응 분석 진행 상황을 화면에 표시하지 못했어요.",
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
          new CandidateAudioEventWorkerError(
            "RESULT_CALLBACK_FAILED",
            "오디오 반응 분석 결과를 화면에 반영하지 못했어요.",
          ),
        );
        return false;
      }
    };

    const handleModelProgress = (
      progress: CandidateAudioEventModelProgress,
    ): void => {
      if (
        candidatePhaseStarted ||
        progress.ratio < lastModelRatio ||
        lastModelStage === "ready" ||
        (progress.stage === "ready" && progress.ratio !== 1)
      ) {
        rejectMalformedMessage();
        return;
      }
      lastModelRatio = progress.ratio;
      lastModelStage = progress.stage;
      modelReady = progress.stage === "ready";
      invokeProgressCallback(() => options.onModelProgress?.(progress));
    };

    const handleCandidateProgress = (
      progress: CandidateAudioEventCandidateProgress,
    ): void => {
      const targetEntry = targetsById.get(progress.candidateId);
      const nextTarget = normalized.targets[terminalCandidateIds.size];
      if (
        (!modelReady &&
          (lastModelStage !== null || progress.stage !== "gap")) ||
        targetEntry === undefined ||
        nextTarget === undefined ||
        nextTarget.candidateId !== progress.candidateId ||
        progress.candidateOrdinal !== targetEntry.candidateOrdinal ||
        progress.targetCount !== normalized.targets.length ||
        terminalCandidateIds.has(progress.candidateId)
      ) {
        rejectMalformedMessage();
        return;
      }
      candidatePhaseStarted = true;
      const previousRatio = lastCandidateRatios.get(progress.candidateId) ?? -1;
      const previousStageRank =
        lastCandidateStageRanks.get(progress.candidateId) ?? -1;
      const nextStageRank = stageRank(progress.stage);
      if (
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
      if (progress.stage === "complete" || progress.stage === "gap") {
        lastCandidateTerminalStages.set(progress.candidateId, progress.stage);
      }
      invokeProgressCallback(() => options.onCandidateProgress?.(progress));
    };

    const handlePartialResult = (
      result: CandidateAudioEventCandidateResult,
    ): void => {
      const expectedTarget = normalized.targets[terminalCandidateIds.size];
      if (
        !modelReady ||
        expectedTarget === undefined ||
        !matchesTarget(expectedTarget, result) ||
        terminalCandidateIds.has(result.candidateId) ||
        lastCandidateTerminalStages.get(result.candidateId) === "gap" ||
        !hasValidDetectionTimeline(expectedTarget, result)
      ) {
        rejectMalformedMessage();
        return;
      }
      candidatePhaseStarted = true;
      terminalCandidateIds.add(result.candidateId);
      results.push(result);
      invokeResultCallback(() => options.onPartialResult?.(result));
    };

    const handleCandidateGap = (gap: CandidateAudioEventCandidateGap): void => {
      const expectedTarget = normalized.targets[terminalCandidateIds.size];
      if (
        (!modelReady &&
          (lastModelStage !== null ||
            !isPreModelSourceGapReason(gap.reasonCode))) ||
        expectedTarget === undefined ||
        !matchesTarget(expectedTarget, gap) ||
        terminalCandidateIds.has(gap.candidateId) ||
        lastCandidateTerminalStages.get(gap.candidateId) === "complete"
      ) {
        rejectMalformedMessage();
        return;
      }
      candidatePhaseStarted = true;
      terminalCandidateIds.add(gap.candidateId);
      gaps.push(gap);
      invokeResultCallback(() => options.onCandidateGap?.(gap));
    };

    const handleMessage = (event: MessageEvent<unknown> | ErrorEvent): void => {
      try {
        if (!(event instanceof MessageEvent) || !isWorkerResponse(event.data)) {
          rejectMalformedMessage();
          return;
        }
        const fenced = fenceEvent(fence, event.data);
        if (!fenced.accepted) {
          finish({
            ok: false,
            error: new CandidateAudioEventWorkerError(
              "EVENT_FENCE_REJECTED",
              `오디오 반응 분석 응답이 현재 작업과 일치하지 않아요: ${fenced.reason}`,
              { fenceReason: fenced.reason },
            ),
          });
          return;
        }
        fence = fenced.state;

        if (cancellationError !== null) {
          if (event.data.type === "candidate-audio-event-cancel-acknowledged") {
            try {
              options.onCancellationAcknowledged?.();
            } catch {
              finish({
                ok: false,
                error: new CandidateAudioEventWorkerError(
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
          case "candidate-audio-event-model-progress":
            handleModelProgress(event.data.progress);
            return;
          case "candidate-audio-event-candidate-progress":
            handleCandidateProgress(event.data.progress);
            return;
          case "candidate-audio-event-partial-result":
            handlePartialResult(event.data.result);
            return;
          case "candidate-audio-event-candidate-gap":
            handleCandidateGap(event.data.gap);
            return;
          case "candidate-audio-event-cancel-acknowledged":
            rejectMalformedMessage();
            return;
          case "candidate-audio-event-failed":
            finish({
              ok: false,
              error: new CandidateAudioEventWorkerError(
                "WORKER_FAILED",
                event.data.message,
                { workerReasonCode: event.data.reasonCode },
              ),
            });
            return;
          case "candidate-audio-event-completed": {
            const summary = event.data.summary;
            const observedIds = new Set([
              ...results.map((result) => result.candidateId),
              ...gaps.map((gap) => gap.candidateId),
            ]);
            if (
              terminalCandidateIds.size !== normalized.targets.length ||
              observedIds.size !== normalized.targets.length ||
              normalized.targets.some(
                (target) =>
                  !terminalCandidateIds.has(target.candidateId) ||
                  !observedIds.has(target.candidateId),
              ) ||
              summary.requestedCount !== normalized.targets.length ||
              summary.completedCount !== results.length ||
              summary.gapCount !== gaps.length ||
              (!modelReady &&
                (lastModelStage !== null ||
                  results.length !== 0 ||
                  gaps.some(
                    (gap) => !isPreModelSourceGapReason(gap.reasonCode),
                  )))
            ) {
              rejectMalformedMessage();
              return;
            }
            finish({
              ok: true,
              result: {
                results: [...results],
                gaps: [...gaps],
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
      finish({
        ok: false,
        error:
          cancellationError ??
          new CandidateAudioEventWorkerError(
            "WORKER_MESSAGE_ERROR",
            "브라우저가 후보 오디오 반응 분석 응답을 읽지 못했어요.",
          ),
      });
    };

    const handleWorkerError = (
      event: MessageEvent<unknown> | ErrorEvent,
    ): void => {
      finish({
        ok: false,
        error:
          cancellationError ??
          new CandidateAudioEventWorkerError(
            "WORKER_FAILED",
            event instanceof ErrorEvent && event.message.length > 0
              ? event.message
              : "후보 오디오 반응 분석 작업 공간이 예기치 않게 멈췄어요.",
          ),
      });
    };

    const handleAbort = (): void => {
      requestCancellation(
        new CandidateAudioEventWorkerError(
          "ABORTED",
          "사용자가 후보 오디오 반응 분석을 취소했어요.",
        ),
      );
    };

    try {
      worker.addEventListener("message", handleMessage);
      worker.addEventListener("messageerror", handleMessageError);
      worker.addEventListener("error", handleWorkerError);
      options.signal?.addEventListener("abort", handleAbort, { once: true });
      operationTimeout = globalThis.setTimeout(() => {
        finish({
          ok: false,
          error: new CandidateAudioEventWorkerError(
            "WORKER_TIMEOUT",
            "후보 오디오 반응 분석이 제한 시간 안에 끝나지 않았어요.",
          ),
        });
      }, timeoutMs);

      if (options.signal?.aborted === true) {
        finish({
          ok: false,
          error: new CandidateAudioEventWorkerError(
            "ABORTED",
            "후보 오디오 반응 분석을 시작하기 전에 취소했어요.",
          ),
        });
        return;
      }

      worker.postMessage({
        type: "candidate-audio-event-analyze",
        identity: options.identity,
        file,
        sourceDurationMs: normalized.sourceDurationMs,
        targets: normalized.targets,
      });
    } catch {
      finish({
        ok: false,
        error: new CandidateAudioEventWorkerError(
          "WORKER_FAILED",
          "후보 오디오 반응 분석 작업 공간에 입력을 전달하지 못했어요.",
        ),
      });
    }
  });
}
