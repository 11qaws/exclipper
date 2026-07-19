import {
  CANDIDATE_PASS_B_DTYPE,
  CANDIDATE_PASS_B_LANGUAGE,
  CANDIDATE_PASS_B_MODEL_ID,
  CANDIDATE_PASS_B_MODEL_REVISION,
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
  type CandidatePassBTranscriptResult,
  type CandidatePassBWorkerFailureReason,
  type CandidatePassBWorkerIdentity,
  type CandidatePassBWorkerRequest,
  type CandidatePassBWorkerResponse,
} from "./candidatePassBWorkerProtocol";

export {
  CANDIDATE_PASS_B_DTYPE,
  CANDIDATE_PASS_B_LANGUAGE,
  CANDIDATE_PASS_B_MODEL_ID,
  CANDIDATE_PASS_B_MODEL_REVISION,
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
const MAX_TRANSCRIPT_TEXT_LENGTH = 20_000;
const MAX_TRANSCRIPT_SEGMENTS = 2_048;
const MAX_SEGMENT_TEXT_LENGTH = 2_000;

export interface CandidatePassBWorkerLike {
  addEventListener(type: WorkerEventType, listener: WorkerListener): void;
  removeEventListener(type: WorkerEventType, listener: WorkerListener): void;
  postMessage(message: CandidatePassBWorkerRequest): void;
  terminate(): void;
}

export type CandidatePassBWorkerFactory = () => CandidatePassBWorkerLike;

export interface RunCandidatePassBWorkerOptions {
  readonly identity: CandidatePassBWorkerIdentity;
  readonly sourceDurationMs: number;
  readonly device: CandidatePassBDevice;
  readonly targets: readonly CandidatePassBTarget[];
  readonly signal?: AbortSignal;
  readonly onModelProgress?: (progress: CandidatePassBModelProgress) => void;
  readonly onCandidateProgress?: (
    progress: CandidatePassBCandidateProgress,
  ) => void;
  readonly onPartialResult?: (result: CandidatePassBTranscriptResult) => void;
  readonly onCandidateGap?: (gap: CandidatePassBCandidateGap) => void;
  /** Called only after a correctly fenced cancellation ACK is received. */
  readonly onCancellationAcknowledged?: () => void;
  readonly timeoutMs?: number;
  readonly cancelAcknowledgementTimeoutMs?: number;
  readonly workerFactory?: CandidatePassBWorkerFactory;
}

export interface CandidatePassBRunResult {
  readonly results: readonly CandidatePassBTranscriptResult[];
  readonly gaps: readonly CandidatePassBCandidateGap[];
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
export const DEFAULT_CANDIDATE_PASS_B_CANCEL_ACK_TIMEOUT_MS = 5_000;

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
    value.endMs >= value.startMs &&
    typeof value.text === "string" &&
    value.text.length <= MAX_SEGMENT_TEXT_LENGTH
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
      "model",
      "language",
      "task",
      "sampleRateHz",
    ]) ||
    !isRecord(value.model) ||
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
    value.text.length <= MAX_TRANSCRIPT_TEXT_LENGTH &&
    value.segments.length <= MAX_TRANSCRIPT_SEGMENTS &&
    value.segments.every(isTranscriptSegment) &&
    hasExactKeys(value.model, ["id", "revision", "dtype", "device"]) &&
    value.model.id === CANDIDATE_PASS_B_MODEL_ID &&
    value.model.revision === CANDIDATE_PASS_B_MODEL_REVISION &&
    value.model.dtype === CANDIDATE_PASS_B_DTYPE &&
    (value.model.device === "webgpu" || value.model.device === "wasm") &&
    value.language === CANDIDATE_PASS_B_LANGUAGE &&
    value.task === CANDIDATE_PASS_B_TASK &&
    value.sampleRateHz === CANDIDATE_PASS_B_SAMPLE_RATE_HZ
  );
}

function isGapReason(value: unknown): value is CandidatePassBCandidateGapReason {
  return (
    value === "NO_AUDIO_TRACK" ||
    value === "UNSUPPORTED_CONTAINER" ||
    value === "UNSUPPORTED_AUDIO_CODEC" ||
    value === "EMPTY_AUDIO" ||
    value === "AUDIO_DECODE_FAILED" ||
    value === "TRANSCRIPTION_FAILED"
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
    value === "MODEL_LOAD_FAILED" ||
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
        isNonEmptyString(value.message) &&
        value.message.length <= 1_000
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
    (options.device !== "webgpu" && options.device !== "wasm") ||
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
    const normalizedTarget = {
      candidateId: target.candidateId,
      startMs: Math.round(target.startMs),
      endMs: Math.round(target.endMs),
    };
    if (
      normalizedTarget.startMs < 0 ||
      normalizedTarget.endMs <= normalizedTarget.startMs ||
      normalizedTarget.endMs > sourceDurationMs ||
      normalizedTarget.endMs - normalizedTarget.startMs >
        MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS ||
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
 * Runs Korean Whisper only for the supplied score-ordered candidate ranges.
 * Partial transcripts are emitted candidate-by-candidate; raw PCM never crosses
 * the Worker boundary and the client terminates the Worker on every exit path.
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
      const nextTarget = normalized.targets[terminalCandidateIds.size];
      if (
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
      invokeProgressCallback(() => options.onCandidateProgress?.(progress));
    };

    const handlePartialResult = (result: CandidatePassBTranscriptResult): void => {
      const expectedTarget = normalized.targets[terminalCandidateIds.size];
      if (
        expectedTarget === undefined ||
        !matchesTargetRange(expectedTarget, result) ||
        result.model.device !== options.device ||
        terminalCandidateIds.has(result.candidateId) ||
        !hasValidSegmentTimeline(result)
      ) {
        rejectMalformedMessage();
        return;
      }
      terminalCandidateIds.add(result.candidateId);
      results.push(result);
      invokeResultCallback(() => options.onPartialResult?.(result));
    };

    const handleCandidateGap = (gap: CandidatePassBCandidateGap): void => {
      const expectedTarget = normalized.targets[terminalCandidateIds.size];
      if (
        expectedTarget === undefined ||
        !matchesTargetRange(expectedTarget, gap) ||
        terminalCandidateIds.has(gap.candidateId)
      ) {
        rejectMalformedMessage();
        return;
      }
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
            handlePartialResult(event.data.result);
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
                event.data.message,
                { workerReasonCode: event.data.reasonCode },
              ),
            });
            return;
          case "candidate-pass-b-completed": {
            const summary = event.data.summary;
            if (
              terminalCandidateIds.size !== normalized.targets.length ||
              summary.requestedCount !== normalized.targets.length ||
              summary.completedCount !== results.length ||
              summary.gapCount !== gaps.length
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
          new CandidatePassBWorkerError(
            "WORKER_MESSAGE_ERROR",
            "브라우저가 후보 정밀 분석 응답을 읽지 못했어요.",
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
          new CandidatePassBWorkerError(
            "WORKER_FAILED",
            event instanceof ErrorEvent && event.message.length > 0
              ? event.message
              : "후보 정밀 분석 작업 공간이 예기치 않게 멈췄어요.",
          ),
      });
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
        finish({
          ok: false,
          error: new CandidatePassBWorkerError(
            "WORKER_TIMEOUT",
            "후보 정밀 분석이 제한 시간 안에 끝나지 않았어요.",
          ),
        });
      }, timeoutMs);

      worker.postMessage({
        type: "candidate-pass-b-analyze",
        identity: options.identity,
        file,
        sourceDurationMs: normalized.sourceDurationMs,
        device: options.device,
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
