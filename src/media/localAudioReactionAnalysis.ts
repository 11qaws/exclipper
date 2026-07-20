import {
  createEventFence,
  fenceEvent,
  type EventFenceRejectionReason,
} from "../domain/eventFence";
import type { LocalAudioReactionAnalysisResult } from "./localAudioReactionAnalysisCore";
import type {
  AudioReactionWorkerIdentity,
  AudioReactionWorkerRequest,
  AudioReactionWorkerResponse,
  LocalAudioReactionAnalysisOutcome,
  LocalAudioReactionAnalysisProgress,
  LocalAudioReactionUnavailableResult,
} from "./audioReactionWorkerProtocol";
import type { SelectAudioReactionHighlightsOptions } from "./localAudioReactionAnalysisCore";

export {
  AUDIO_REACTION_FEATURE_WINDOW_MS,
  type AudioReactionWorkerIdentity,
  type LocalAudioReactionAnalysisOutcome,
  type LocalAudioReactionAnalysisProgress,
  type LocalAudioReactionAnalysisStage,
  type LocalAudioReactionUnavailableReason,
  type LocalAudioReactionUnavailableResult,
} from "./audioReactionWorkerProtocol";
export type {
  AudioReactionFeatureWindow,
  LocalAudioReactionAnalysisDiagnostics,
  LocalAudioReactionAnalysisResult,
  LocalAudioReactionCandidate,
  LocalAudioReactionEvidence,
  SelectAudioReactionHighlightsOptions,
} from "./localAudioReactionAnalysisCore";

type WorkerEventType = "message" | "messageerror" | "error";
type WorkerListener = (event: MessageEvent<unknown> | ErrorEvent) => void;

export interface LocalAudioReactionWorkerLike {
  addEventListener(type: WorkerEventType, listener: WorkerListener): void;
  removeEventListener(type: WorkerEventType, listener: WorkerListener): void;
  postMessage(message: AudioReactionWorkerRequest): void;
  terminate(): void;
}

export type LocalAudioReactionWorkerFactory = () => LocalAudioReactionWorkerLike;

export interface AnalyzeLocalAudioReactionsOptions {
  readonly identity: AudioReactionWorkerIdentity;
  readonly sourceDurationMs: number;
  readonly selection?: SelectAudioReactionHighlightsOptions;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: LocalAudioReactionAnalysisProgress) => void;
  readonly timeoutMs?: number;
  readonly cancelAcknowledgementTimeoutMs?: number;
  readonly workerFactory?: LocalAudioReactionWorkerFactory;
}

export type LocalAudioReactionAnalysisErrorCode =
  | "INVALID_INPUT"
  | "ABORTED"
  | "EVENT_FENCE_REJECTED"
  | "WORKER_FAILED"
  | "WORKER_MESSAGE_ERROR"
  | "WORKER_TIMEOUT"
  | "PROGRESS_CALLBACK_FAILED";

export class LocalAudioReactionAnalysisError extends Error {
  public readonly code: LocalAudioReactionAnalysisErrorCode;
  public readonly fenceReason: EventFenceRejectionReason | null;

  public constructor(
    code: LocalAudioReactionAnalysisErrorCode,
    message: string,
    fenceReason: EventFenceRejectionReason | null = null,
  ) {
    super(message);
    this.name = "LocalAudioReactionAnalysisError";
    this.code = code;
    this.fenceReason = fenceReason;
  }
}

export const DEFAULT_AUDIO_REACTION_WORKER_TIMEOUT_MS = 2 * 60 * 60_000;
export const DEFAULT_AUDIO_REACTION_CANCEL_ACK_TIMEOUT_MS = 1_000;

export function createBrowserLocalAudioReactionWorker(): LocalAudioReactionWorkerLike {
  return new Worker(new URL("./audioReactionAnalysis.worker.ts", import.meta.url), {
    type: "module",
    name: "retto-audio-reactions",
  });
}

function normalizeWorkerTimeout(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_AUDIO_REACTION_WORKER_TIMEOUT_MS;
  }
  return Number.isFinite(value)
    ? Math.min(24 * 60 * 60_000, Math.max(1, Math.round(value)))
    : DEFAULT_AUDIO_REACTION_WORKER_TIMEOUT_MS;
}

function normalizeCancelAcknowledgementTimeout(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_AUDIO_REACTION_CANCEL_ACK_TIMEOUT_MS;
  }
  return Number.isFinite(value)
    ? Math.min(5_000, Math.max(50, Math.round(value)))
    : DEFAULT_AUDIO_REACTION_CANCEL_ACK_TIMEOUT_MS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isFenceEnvelope(value: Record<string, unknown>): boolean {
  return (
    typeof value.eventId === "string" &&
    typeof value.sessionId === "string" &&
    Number.isSafeInteger(value.writerEpoch) &&
    typeof value.runId === "string" &&
    Number.isSafeInteger(value.workerEpoch) &&
    typeof value.workerInstanceId === "string" &&
    typeof value.taskId === "string"
  );
}

function isProgress(value: unknown): value is LocalAudioReactionAnalysisProgress {
  if (!isRecord(value)) {
    return false;
  }
  return (
    (value.stage === "opening-source" ||
      value.stage === "decoding-audio" ||
      value.stage === "scoring" ||
      value.stage === "complete" ||
      value.stage === "unavailable") &&
    isFiniteNumber(value.decodedThroughMs) &&
    value.decodedThroughMs >= 0 &&
    isFiniteNumber(value.sourceDurationMs) &&
    value.sourceDurationMs > 0 &&
    isNonNegativeInteger(value.analyzedWindowCount) &&
    isFiniteNumber(value.ratio) &&
    value.ratio >= 0 &&
    value.ratio <= 1
  );
}

function isCandidate(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.evidence)) {
    return false;
  }
  const evidence = value.evidence;
  return (
    hasExactKeys(value, [
      "id",
      "peakMs",
      "startMs",
      "endMs",
      "score",
      "reason",
      "evidence",
    ]) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.reason === "string" &&
    isFiniteNumber(value.peakMs) &&
    isFiniteNumber(value.startMs) &&
    isFiniteNumber(value.endMs) &&
    value.startMs >= 0 &&
    value.endMs >= value.startMs &&
    isFiniteNumber(value.score) &&
    hasExactKeys(evidence, [
      "eventKind",
      "baselineRms",
      "medianAbsoluteDeviation",
      "robustLoudnessScore",
      "rmsLiftRatio",
      "peakLiftRatio",
      "sustainedWindowCount",
      "activeWindowCount",
      "clickPenalty",
      "backgroundPenalty",
      "zeroCrossingRate",
      "speechBandEnergyRatio",
    ]) &&
    (evidence.eventKind === "short-loudness-burst" ||
      evidence.eventKind === "sustained-vocal-reaction" ||
      evidence.eventKind === "dialogue-issue-signal") &&
    isFiniteNumber(evidence.baselineRms) &&
    isFiniteNumber(evidence.medianAbsoluteDeviation) &&
    isFiniteNumber(evidence.robustLoudnessScore) &&
    isFiniteNumber(evidence.rmsLiftRatio) &&
    isFiniteNumber(evidence.peakLiftRatio) &&
    isNonNegativeInteger(evidence.sustainedWindowCount) &&
    isNonNegativeInteger(evidence.activeWindowCount) &&
    isFiniteNumber(evidence.clickPenalty) &&
    isFiniteNumber(evidence.backgroundPenalty) &&
    isFiniteNumber(evidence.zeroCrossingRate) &&
    isFiniteNumber(evidence.speechBandEnergyRatio)
  );
}

function isCompletedResult(value: unknown): value is LocalAudioReactionAnalysisResult {
  if (!isRecord(value) || !Array.isArray(value.candidates) || !isRecord(value.diagnostics)) {
    return false;
  }
  const diagnostics = value.diagnostics;
  return (
    hasExactKeys(value, [
      "mode",
      "sourceDurationMs",
      "plannedWindowCount",
      "analyzedWindowCount",
      "coverageComplete",
      "candidateWindowMs",
      "candidates",
      "diagnostics",
    ]) &&
    value.mode === "local-audio-reaction-fast-pass" &&
    isFiniteNumber(value.sourceDurationMs) &&
    value.sourceDurationMs > 0 &&
    isNonNegativeInteger(value.plannedWindowCount) &&
    isNonNegativeInteger(value.analyzedWindowCount) &&
    typeof value.coverageComplete === "boolean" &&
    isFiniteNumber(value.candidateWindowMs) &&
    value.candidateWindowMs > 0 &&
    value.candidates.every(isCandidate) &&
    hasExactKeys(diagnostics, [
      "medianWindowDurationMs",
      "sourceMedianRms",
      "sourceMedianPeak",
      "silenceWindowCount",
      "impulseLikeWindowCount",
      "suppressedSustainedBackgroundCount",
      "eligibleEventCount",
    ]) &&
    isFiniteNumber(diagnostics.medianWindowDurationMs) &&
    isFiniteNumber(diagnostics.sourceMedianRms) &&
    isFiniteNumber(diagnostics.sourceMedianPeak) &&
    isNonNegativeInteger(diagnostics.silenceWindowCount) &&
    isNonNegativeInteger(diagnostics.impulseLikeWindowCount) &&
    isNonNegativeInteger(diagnostics.suppressedSustainedBackgroundCount) &&
    isNonNegativeInteger(diagnostics.eligibleEventCount)
  );
}

function isUnavailableResult(value: unknown): value is LocalAudioReactionUnavailableResult {
  if (!isRecord(value) || !Array.isArray(value.candidates)) {
    return false;
  }
  return (
    hasExactKeys(value, [
      "mode",
      "sourceDurationMs",
      "featureWindowMs",
      "plannedWindowCount",
      "analyzedWindowCount",
      "coverageComplete",
      "candidates",
      "reasonCode",
    ]) &&
    value.mode === "local-audio-reaction-unavailable" &&
    isFiniteNumber(value.sourceDurationMs) &&
    value.sourceDurationMs > 0 &&
    value.featureWindowMs === 1_000 &&
    isNonNegativeInteger(value.plannedWindowCount) &&
    value.analyzedWindowCount === 0 &&
    value.coverageComplete === false &&
    value.candidates.length === 0 &&
    (value.reasonCode === "NO_AUDIO_TRACK" ||
      value.reasonCode === "UNSUPPORTED_CONTAINER" ||
      value.reasonCode === "UNSUPPORTED_AUDIO_CODEC")
  );
}

function isWorkerResponse(value: unknown): value is AudioReactionWorkerResponse {
  if (!isRecord(value) || !isFenceEnvelope(value)) {
    return false;
  }
  switch (value.type) {
    case "audio-reaction-progress":
      return isProgress(value.progress);
    case "audio-reaction-completed":
      return isCompletedResult(value.result);
    case "audio-reaction-unavailable":
      return isUnavailableResult(value.result);
    case "audio-reaction-cancel-acknowledged":
      return true;
    case "audio-reaction-failed":
      return (
        (value.reasonCode === "AUDIO_DECODE_FAILED" ||
          value.reasonCode === "SIGNAL_ENGINE_FAILED") &&
        typeof value.message === "string" &&
        value.message.length > 0
      );
    default:
      return false;
  }
}

function validateInput(file: File, sourceDurationMs: number): LocalAudioReactionAnalysisError | null {
  if (
    typeof file !== "object" ||
    file === null ||
    !Number.isFinite(file.size) ||
    file.size < 0
  ) {
    return new LocalAudioReactionAnalysisError(
      "INVALID_INPUT",
      "오디오 반응 분석에 사용할 영상 파일이 올바르지 않아요.",
    );
  }
  if (
    !Number.isFinite(sourceDurationMs) ||
    sourceDurationMs <= 0 ||
    sourceDurationMs > Number.MAX_SAFE_INTEGER
  ) {
    return new LocalAudioReactionAnalysisError(
      "INVALID_INPUT",
      "오디오 반응 분석에 사용할 영상 길이가 올바르지 않아요.",
    );
  }
  return null;
}

/**
 * Runs the full-file audio fast pass in a dedicated Worker. Aborts use a
 * cooperative cancel message first, wait briefly for a fenced acknowledgement,
 * and always terminate the Worker before this promise settles.
 */
export function analyzeLocalAudioReactions(
  file: File,
  options: AnalyzeLocalAudioReactionsOptions,
): Promise<LocalAudioReactionAnalysisOutcome> {
  const inputError = validateInput(file, options.sourceDurationMs);
  if (inputError !== null) {
    return Promise.reject(inputError);
  }
  if (options.signal?.aborted === true) {
    return Promise.reject(
      new LocalAudioReactionAnalysisError(
        "ABORTED",
        "오디오 반응 분석이 시작되기 전에 취소되었어요.",
      ),
    );
  }

  let worker: LocalAudioReactionWorkerLike;
  try {
    worker = (options.workerFactory ?? createBrowserLocalAudioReactionWorker)();
  } catch {
    return Promise.reject(
      new LocalAudioReactionAnalysisError(
        "WORKER_FAILED",
        "오디오 분석 작업 공간을 만들지 못했어요.",
      ),
    );
  }

  const sourceDurationMs = Math.round(options.sourceDurationMs);
  const timeoutMs = normalizeWorkerTimeout(options.timeoutMs);
  const cancelAcknowledgementTimeoutMs = normalizeCancelAcknowledgementTimeout(
    options.cancelAcknowledgementTimeoutMs,
  );
  let fence = createEventFence(options.identity);

  return new Promise((resolve, reject) => {
    let settled = false;
    let operationTimeout: ReturnType<typeof setTimeout> | null = null;
    let cancelTimeout: ReturnType<typeof setTimeout> | null = null;
    let cancellationError: LocalAudioReactionAnalysisError | null = null;
    let lastProgressRatio = -1;

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
        | { readonly ok: true; readonly result: LocalAudioReactionAnalysisOutcome }
        | { readonly ok: false; readonly error: LocalAudioReactionAnalysisError },
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      const cleanupSucceeded = cleanup();
      if (!cleanupSucceeded && outcome.ok) {
        reject(
          new LocalAudioReactionAnalysisError(
            "WORKER_FAILED",
            "오디오 분석 결과는 도착했지만 작업 공간을 완전히 정리하지 못했어요.",
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

    const requestCancellation = (error: LocalAudioReactionAnalysisError): void => {
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
          type: "cancel-audio-reactions",
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
      finish({
        ok: false,
        error: new LocalAudioReactionAnalysisError(
          "WORKER_MESSAGE_ERROR",
          "오디오 분석 작업 공간이 이해할 수 없는 응답을 보냈어요.",
        ),
      });
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
            error: new LocalAudioReactionAnalysisError(
              "EVENT_FENCE_REJECTED",
              `오디오 분석 응답이 현재 작업과 일치하지 않아요: ${fenced.reason}`,
              fenced.reason,
            ),
          });
          return;
        }
        fence = fenced.state;

        if (cancellationError !== null) {
          if (
            event.data.type === "audio-reaction-cancel-acknowledged" ||
            event.data.type === "audio-reaction-completed" ||
            event.data.type === "audio-reaction-unavailable" ||
            event.data.type === "audio-reaction-failed"
          ) {
            finish({ ok: false, error: cancellationError });
          }
          return;
        }

        if (event.data.type === "audio-reaction-progress") {
          if (
            event.data.progress.sourceDurationMs !== sourceDurationMs ||
            event.data.progress.ratio < lastProgressRatio
          ) {
            rejectMalformedMessage();
            return;
          }
          lastProgressRatio = event.data.progress.ratio;
          try {
            options.onProgress?.(event.data.progress);
          } catch {
            requestCancellation(
              new LocalAudioReactionAnalysisError(
                "PROGRESS_CALLBACK_FAILED",
                "오디오 분석 진행 상황을 화면에 표시하지 못했어요.",
              ),
            );
          }
          return;
        }

        if (event.data.type === "audio-reaction-cancel-acknowledged") {
          rejectMalformedMessage();
          return;
        }

        if (event.data.type === "audio-reaction-failed") {
          finish({
            ok: false,
            error: new LocalAudioReactionAnalysisError(
              "WORKER_FAILED",
              event.data.message,
            ),
          });
          return;
        }

        if (event.data.result.sourceDurationMs !== sourceDurationMs) {
          rejectMalformedMessage();
          return;
        }
        finish({ ok: true, result: event.data.result });
      } catch {
        rejectMalformedMessage();
      }
    };

    const handleMessageError = (): void => {
      finish({
        ok: false,
        error: new LocalAudioReactionAnalysisError(
          "WORKER_MESSAGE_ERROR",
          "브라우저가 오디오 분석 응답을 읽지 못했어요.",
        ),
      });
    };

    const handleWorkerError = (event: MessageEvent<unknown> | ErrorEvent): void => {
      finish({
        ok: false,
        error: new LocalAudioReactionAnalysisError(
          "WORKER_FAILED",
          event instanceof ErrorEvent && event.message.length > 0
            ? event.message
            : "오디오 분석 작업 공간이 예기치 않게 멈췄어요.",
        ),
      });
    };

    const handleAbort = (): void => {
      requestCancellation(
        new LocalAudioReactionAnalysisError(
          "ABORTED",
          "사용자가 오디오 반응 분석을 취소했어요.",
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
          new LocalAudioReactionAnalysisError(
            "WORKER_TIMEOUT",
            "오디오 분석 작업이 제한 시간 안에 끝나지 않았어요.",
          ),
        );
      }, timeoutMs);

      worker.postMessage({
        type: "analyze-audio-reactions",
        identity: options.identity,
        file,
        sourceDurationMs,
        options: options.selection ?? {},
      });
    } catch {
      finish({
        ok: false,
        error: new LocalAudioReactionAnalysisError(
          "WORKER_FAILED",
          "오디오 분석 작업 공간에 파일을 전달하지 못했어요.",
        ),
      });
    }
  });
}
