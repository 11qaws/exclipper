import type { ContentDigestAdapter } from "../security/contentFingerprint";
import {
  SPEAKER_EMBEDDING_DIMENSION,
  SPEAKER_EMBEDDING_MODEL_DESCRIPTOR,
  SpeakerEmbeddingProtocolError,
  createSpeakerEmbeddingSourceReceipt,
  isSpeakerEmbeddingRunIdentity,
  speakerEmbeddingWorkerIdentityEquals,
  type SpeakerEmbeddingProgressStage,
  type SpeakerEmbeddingResult,
  type SpeakerEmbeddingRunIdentity,
  type SpeakerEmbeddingSourceInput,
  type SpeakerEmbeddingSourceReceipt,
  type SpeakerEmbeddingWorkerFailureReason,
  type SpeakerEmbeddingWorkerIdentity,
  type SpeakerEmbeddingWorkerProgress,
  type SpeakerEmbeddingWorkerRequest,
} from "./speakerEmbeddingWorkerProtocol";
import {
  assertL2NormalizedSpeakerEmbedding,
  SpeakerEmbeddingMathError,
} from "./speakerEmbeddingMath";

export {
  SPEAKER_EMBEDDING_CHANNEL_COUNT,
  SPEAKER_EMBEDDING_DIMENSION,
  SPEAKER_EMBEDDING_MAX_DURATION_MS,
  SPEAKER_EMBEDDING_MAX_SAMPLE_COUNT,
  SPEAKER_EMBEDDING_MAX_TRANSFER_BYTES,
  SPEAKER_EMBEDDING_MIN_DURATION_MS,
  SPEAKER_EMBEDDING_MIN_SAMPLE_COUNT,
  SPEAKER_EMBEDDING_MODEL_DESCRIPTOR,
  SPEAKER_EMBEDDING_MODEL_DTYPE,
  SPEAKER_EMBEDDING_MODEL_FENCE_REVISION,
  SPEAKER_EMBEDDING_MODEL_ID,
  SPEAKER_EMBEDDING_MODEL_REVISION,
  SPEAKER_EMBEDDING_PROTOCOL_VERSION,
  SPEAKER_EMBEDDING_RUNTIME_DEVICE,
  SPEAKER_EMBEDDING_SAMPLE_RATE_HZ,
  SPEAKER_EMBEDDING_TASK,
  SPEAKER_EMBEDDING_TRANSFORMERS_VERSION,
  type SpeakerEmbeddingConditionStatus,
  type SpeakerEmbeddingModelDescriptor,
  type SpeakerEmbeddingProgressStage,
  type SpeakerEmbeddingResult,
  type SpeakerEmbeddingResultReceipt,
  type SpeakerEmbeddingRunIdentity,
  type SpeakerEmbeddingSourceInput,
  type SpeakerEmbeddingSourceReceipt,
  type SpeakerEmbeddingSpeechTurnPreparationReceipt,
  type SpeakerEmbeddingWorkerFailureReason,
  type SpeakerEmbeddingWorkerIdentity,
  type SpeakerEmbeddingWorkerProgress,
} from "./speakerEmbeddingWorkerProtocol";

type WorkerEventType = "message" | "messageerror" | "error";
type WorkerListener = (event: MessageEvent<unknown> | ErrorEvent) => void;

export interface SpeakerEmbeddingWorkerLike {
  addEventListener(type: WorkerEventType, listener: WorkerListener): void;
  removeEventListener(type: WorkerEventType, listener: WorkerListener): void;
  postMessage(
    message: SpeakerEmbeddingWorkerRequest,
    transfer: readonly Transferable[],
  ): void;
  terminate(): void;
}

export type SpeakerEmbeddingWorkerFactory =
  () => SpeakerEmbeddingWorkerLike;

export interface SpeakerEmbeddingWorkerClientOptions {
  readonly workerFactory?: SpeakerEmbeddingWorkerFactory;
  readonly timeoutMs?: number;
  readonly digestAdapter?: ContentDigestAdapter | null;
}

export interface RunSpeakerEmbeddingOptions {
  readonly identity: SpeakerEmbeddingRunIdentity;
  readonly source: SpeakerEmbeddingSourceInput;
  readonly signal?: AbortSignal;
  readonly onProgress?: (
    progress: SpeakerEmbeddingWorkerProgress,
  ) => void;
}

export type SpeakerEmbeddingWorkerClientErrorCode =
  | "INVALID_INPUT"
  | "ABORTED"
  | "BUSY"
  | "DISPOSED"
  | "STALE_IDENTITY"
  | "MALFORMED_RESPONSE"
  | "WORKER_FAILED"
  | "WORKER_ERROR"
  | "WORKER_TIMEOUT"
  | "PROGRESS_CALLBACK_FAILED";

export class SpeakerEmbeddingWorkerClientError extends Error {
  public readonly code: SpeakerEmbeddingWorkerClientErrorCode;
  public readonly workerReasonCode: SpeakerEmbeddingWorkerFailureReason | null;

  public constructor(
    code: SpeakerEmbeddingWorkerClientErrorCode,
    message: string,
    workerReasonCode: SpeakerEmbeddingWorkerFailureReason | null = null,
  ) {
    super(message);
    this.name = "SpeakerEmbeddingWorkerClientError";
    this.code = code;
    this.workerReasonCode = workerReasonCode;
  }
}

export const DEFAULT_SPEAKER_EMBEDDING_WORKER_TIMEOUT_MS =
  10 * 60_000;

const PROGRESS_STAGE_RANK: Readonly<
  Record<SpeakerEmbeddingProgressStage, number>
> = {
  "loading-processor": 0,
  "loading-model": 1,
  "preparing-input": 2,
  "running-inference": 3,
  normalizing: 4,
  complete: 5,
};
const WORKER_FAILURE_REASONS = new Set<SpeakerEmbeddingWorkerFailureReason>([
  "INVALID_REQUEST",
  "INPUT_IDENTITY_MISMATCH",
  "UNCLEAN_SPEECH_TURN",
  "WORKER_BUSY",
  "MODEL_LOAD_FAILED",
  "INFERENCE_FAILED",
  "INVALID_MODEL_OUTPUT",
]);
const MAX_EVENT_ID_LENGTH = 512;
const MAX_FAILURE_MESSAGE_LENGTH = 1_000;

function createBrowserSpeakerEmbeddingWorker(): SpeakerEmbeddingWorkerLike {
  return new Worker(
    new URL("./speakerEmbedding.worker.ts", import.meta.url),
    {
      type: "module",
      name: "exclipper-speaker-embedding",
    },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function signalIsAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function isWorkerIdentity(
  value: unknown,
): value is SpeakerEmbeddingWorkerIdentity {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "protocolVersion",
      "sessionId",
      "writerEpoch",
      "analysisRunId",
      "embeddingRunId",
      "workerEpoch",
      "workerInstanceId",
      "taskId",
      "inputFingerprint",
    ]) ||
    typeof value.inputFingerprint !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.inputFingerprint)
  ) {
    return false;
  }
  return isSpeakerEmbeddingRunIdentity({
    protocolVersion: value.protocolVersion,
    sessionId: value.sessionId,
    writerEpoch: value.writerEpoch,
    analysisRunId: value.analysisRunId,
    embeddingRunId: value.embeddingRunId,
    workerEpoch: value.workerEpoch,
    workerInstanceId: value.workerInstanceId,
    taskId: value.taskId,
  });
}

function sourceReceiptMatches(
  value: unknown,
  expected: SpeakerEmbeddingSourceReceipt,
): value is SpeakerEmbeddingSourceReceipt {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "sourceFingerprint",
      "sourceDurationMs",
      "sourceStartMs",
      "sourceEndMs",
      "sourceUnitId",
      "audioBundleReuseKey",
      "preparation",
      "sampleRateHz",
      "channelCount",
      "sampleCount",
      "pcmFormat",
      "audioContentSha256",
      "inputFingerprint",
    ]) ||
    !isRecord(value.preparation) ||
    !hasExactKeys(value.preparation, [
      "speechActivity",
      "speechActivityRevision",
      "overlapStatus",
      "musicStatus",
      "conditioningRevision",
    ])
  ) {
    return false;
  }
  return JSON.stringify(value) === JSON.stringify(expected);
}

function modelDescriptorMatches(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "id",
      "revision",
      "fenceRevision",
      "task",
      "dtype",
      "device",
      "transformersVersion",
    ]) &&
    JSON.stringify(value) ===
      JSON.stringify(SPEAKER_EMBEDDING_MODEL_DESCRIPTOR)
  );
}

function isProgress(
  value: unknown,
): value is SpeakerEmbeddingWorkerProgress {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "stage",
      "ratio",
      "loadedBytes",
      "totalBytes",
    ]) ||
    typeof value.stage !== "string" ||
    !(value.stage in PROGRESS_STAGE_RANK) ||
    typeof value.ratio !== "number" ||
    !Number.isFinite(value.ratio) ||
    value.ratio < 0 ||
    value.ratio > 1 ||
    !(
      value.loadedBytes === null ||
      isNonNegativeSafeInteger(value.loadedBytes)
    ) ||
    !(
      value.totalBytes === null ||
      isNonNegativeSafeInteger(value.totalBytes)
    )
  ) {
    return false;
  }
  return (
    value.loadedBytes === null ||
    value.totalBytes === null ||
    value.loadedBytes <= value.totalBytes
  );
}

function isResponseEnvelope(
  value: unknown,
): value is {
  readonly type: string;
  readonly identity: SpeakerEmbeddingWorkerIdentity;
  readonly eventId: string;
} & Record<string, unknown> {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    isWorkerIdentity(value.identity) &&
    typeof value.eventId === "string" &&
    value.eventId.length > 0 &&
    value.eventId.length <= MAX_EVENT_ID_LENGTH
  );
}

function validateCompletedResult(
  value: unknown,
  expectedSource: SpeakerEmbeddingSourceReceipt,
): SpeakerEmbeddingResult | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["embedding", "receipt"]) ||
    !(value.embedding instanceof Float32Array) ||
    !(value.embedding.buffer instanceof ArrayBuffer) ||
    value.embedding.byteOffset !== 0 ||
    value.embedding.byteLength !== value.embedding.buffer.byteLength ||
    value.embedding.length !== SPEAKER_EMBEDDING_DIMENSION ||
    !isRecord(value.receipt) ||
    !hasExactKeys(value.receipt, [
      "source",
      "model",
      "embeddingDimension",
      "normalization",
    ]) ||
    !sourceReceiptMatches(value.receipt.source, expectedSource) ||
    !modelDescriptorMatches(value.receipt.model) ||
    value.receipt.embeddingDimension !== SPEAKER_EMBEDDING_DIMENSION ||
    value.receipt.normalization !== "l2"
  ) {
    return null;
  }
  try {
    assertL2NormalizedSpeakerEmbedding(value.embedding);
  } catch (cause) {
    if (cause instanceof SpeakerEmbeddingMathError) {
      return null;
    }
    throw cause;
  }
  return value as unknown as SpeakerEmbeddingResult;
}

function protocolErrorAsClientError(
  cause: unknown,
): SpeakerEmbeddingWorkerClientError {
  if (cause instanceof SpeakerEmbeddingProtocolError) {
    return new SpeakerEmbeddingWorkerClientError(
      "INVALID_INPUT",
      cause.message,
    );
  }
  return new SpeakerEmbeddingWorkerClientError(
    "INVALID_INPUT",
    "Speaker embedding input could not be prepared.",
  );
}

/**
 * Owns one long-lived WASM Worker and accepts only one in-flight turn. Reusing
 * the client keeps the pinned model warm; concurrent callers must queue outside
 * this class so audio buffers can never be cross-wired.
 */
export class SpeakerEmbeddingWorkerClient {
  private worker: SpeakerEmbeddingWorkerLike | null = null;
  private active = false;
  private disposed = false;
  private abortActive: (() => void) | null = null;

  public constructor(
    private readonly options: SpeakerEmbeddingWorkerClientOptions = {},
  ) {}

  public async embed(
    samples: Float32Array,
    options: RunSpeakerEmbeddingOptions,
  ): Promise<SpeakerEmbeddingResult> {
    if (this.disposed) {
      throw new SpeakerEmbeddingWorkerClientError(
        "DISPOSED",
        "The speaker embedding Worker client has been disposed.",
      );
    }
    if (this.active) {
      throw new SpeakerEmbeddingWorkerClientError(
        "BUSY",
        "One speaker embedding turn is already in flight.",
      );
    }
    if (!isSpeakerEmbeddingRunIdentity(options.identity)) {
      throw new SpeakerEmbeddingWorkerClientError(
        "INVALID_INPUT",
        "The speaker embedding run identity is malformed.",
      );
    }
    if (signalIsAborted(options.signal)) {
      throw new SpeakerEmbeddingWorkerClientError(
        "ABORTED",
        "Speaker embedding was aborted before it started.",
      );
    }

    this.active = true;
    const transferableSamples = new Float32Array(samples);
    let source: SpeakerEmbeddingSourceReceipt;
    try {
      source = await createSpeakerEmbeddingSourceReceipt(
        options.source,
        transferableSamples,
        this.options.digestAdapter === undefined
          ? globalThis.crypto?.subtle ?? null
          : this.options.digestAdapter,
      );
    } catch (cause) {
      this.active = false;
      throw protocolErrorAsClientError(cause);
    }
    if (this.disposed) {
      this.active = false;
      throw new SpeakerEmbeddingWorkerClientError(
        "DISPOSED",
        "The speaker embedding Worker client was disposed while fencing input.",
      );
    }
    if (signalIsAborted(options.signal)) {
      this.active = false;
      throw new SpeakerEmbeddingWorkerClientError(
        "ABORTED",
        "Speaker embedding was aborted while its input was being fenced.",
      );
    }

    const identity: SpeakerEmbeddingWorkerIdentity = {
      ...options.identity,
      inputFingerprint: source.inputFingerprint,
    };
    const worker =
      this.worker ??
      (this.options.workerFactory ?? createBrowserSpeakerEmbeddingWorker)();
    this.worker = worker;

    return new Promise<SpeakerEmbeddingResult>((resolve, reject) => {
      let settled = false;
      let lastProgressRatio = -1;
      let lastProgressStageRank = -1;
      const seenEventIds = new Set<string>();
      const timeoutMs =
        this.options.timeoutMs ??
        DEFAULT_SPEAKER_EMBEDDING_WORKER_TIMEOUT_MS;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const removeListeners = (): void => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("messageerror", onWorkerError);
        worker.removeEventListener("error", onWorkerError);
        options.signal?.removeEventListener("abort", onAbort);
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        this.abortActive = null;
      };
      const terminateWorker = (): void => {
        try {
          worker.terminate();
        } finally {
          if (this.worker === worker) {
            this.worker = null;
          }
        }
      };
      const finish = (
        outcome:
          | { readonly ok: true; readonly result: SpeakerEmbeddingResult }
          | {
              readonly ok: false;
              readonly error: SpeakerEmbeddingWorkerClientError;
              readonly terminate: boolean;
            },
      ): void => {
        if (settled) return;
        settled = true;
        removeListeners();
        this.active = false;
        if (!outcome.ok && outcome.terminate) {
          terminateWorker();
        }
        if (outcome.ok) {
          resolve(outcome.result);
        } else {
          reject(outcome.error);
        }
      };
      const failMalformed = (message: string): void => {
        finish({
          ok: false,
          error: new SpeakerEmbeddingWorkerClientError(
            "MALFORMED_RESPONSE",
            message,
          ),
          terminate: true,
        });
      };
      const onAbort = (): void => {
        if (settled) return;
        try {
          worker.postMessage(
            {
              type: "speaker-embedding-cancel",
              identity,
            },
            [],
          );
        } catch {
          // Termination below remains the authoritative abort boundary.
        }
        finish({
          ok: false,
          error: new SpeakerEmbeddingWorkerClientError(
            "ABORTED",
            "Speaker embedding was aborted.",
          ),
          terminate: true,
        });
      };
      const onWorkerError = (): void => {
        finish({
          ok: false,
          error: new SpeakerEmbeddingWorkerClientError(
            "WORKER_ERROR",
            "The speaker embedding Worker stopped unexpectedly.",
          ),
          terminate: true,
        });
      };
      const onMessage = (event: MessageEvent<unknown> | ErrorEvent): void => {
        if (!(event instanceof MessageEvent)) {
          onWorkerError();
          return;
        }
        const response = event.data;
        if (!isResponseEnvelope(response)) {
          failMalformed("The speaker embedding Worker response is malformed.");
          return;
        }
        if (!speakerEmbeddingWorkerIdentityEquals(response.identity, identity)) {
          finish({
            ok: false,
            error: new SpeakerEmbeddingWorkerClientError(
              "STALE_IDENTITY",
              "The speaker embedding response belongs to a stale input fence.",
            ),
            terminate: true,
          });
          return;
        }
        if (seenEventIds.has(response.eventId)) {
          failMalformed("The speaker embedding Worker repeated an event id.");
          return;
        }
        seenEventIds.add(response.eventId);

        switch (response.type) {
          case "speaker-embedding-progress": {
            if (
              !hasExactKeys(response, [
                "type",
                "identity",
                "eventId",
                "progress",
              ]) ||
              !isProgress(response.progress)
            ) {
              failMalformed(
                "The speaker embedding progress payload is malformed.",
              );
              return;
            }
            const stageRank = PROGRESS_STAGE_RANK[response.progress.stage];
            if (
              response.progress.ratio < lastProgressRatio ||
              stageRank < lastProgressStageRank ||
              (response.progress.stage === "complete" &&
                response.progress.ratio !== 1)
            ) {
              failMalformed(
                "The speaker embedding progress moved backwards.",
              );
              return;
            }
            lastProgressRatio = response.progress.ratio;
            lastProgressStageRank = stageRank;
            try {
              options.onProgress?.(response.progress);
            } catch {
              finish({
                ok: false,
                error: new SpeakerEmbeddingWorkerClientError(
                  "PROGRESS_CALLBACK_FAILED",
                  "The speaker embedding progress callback failed.",
                ),
                terminate: true,
              });
            }
            return;
          }
          case "speaker-embedding-completed": {
            if (
              !hasExactKeys(response, [
                "type",
                "identity",
                "eventId",
                "result",
              ])
            ) {
              failMalformed(
                "The speaker embedding completion envelope is malformed.",
              );
              return;
            }
            const result = validateCompletedResult(response.result, source);
            if (result === null) {
              failMalformed(
                "The speaker embedding completion is partial or invalid.",
              );
              return;
            }
            finish({ ok: true, result });
            return;
          }
          case "speaker-embedding-cancelled":
            if (
              !hasExactKeys(response, ["type", "identity", "eventId"])
            ) {
              failMalformed(
                "The speaker embedding cancellation is malformed.",
              );
              return;
            }
            finish({
              ok: false,
              error: new SpeakerEmbeddingWorkerClientError(
                "ABORTED",
                "Speaker embedding was cancelled by the Worker.",
              ),
              terminate: true,
            });
            return;
          case "speaker-embedding-failed":
            if (
              !hasExactKeys(response, [
                "type",
                "identity",
                "eventId",
                "reasonCode",
                "message",
              ]) ||
              typeof response.reasonCode !== "string" ||
              !WORKER_FAILURE_REASONS.has(
                response.reasonCode as SpeakerEmbeddingWorkerFailureReason,
              ) ||
              typeof response.message !== "string" ||
              response.message.length === 0 ||
              response.message.length > MAX_FAILURE_MESSAGE_LENGTH
            ) {
              failMalformed(
                "The speaker embedding failure payload is malformed.",
              );
              return;
            }
            finish({
              ok: false,
              error: new SpeakerEmbeddingWorkerClientError(
                response.reasonCode === "WORKER_BUSY"
                  ? "BUSY"
                  : "WORKER_FAILED",
                response.message,
                response.reasonCode as SpeakerEmbeddingWorkerFailureReason,
              ),
              terminate: true,
            });
            return;
          default:
            failMalformed(
              "The speaker embedding Worker returned an unknown message.",
            );
        }
      };

      this.abortActive = onAbort;
      worker.addEventListener("message", onMessage);
      worker.addEventListener("messageerror", onWorkerError);
      worker.addEventListener("error", onWorkerError);
      options.signal?.addEventListener("abort", onAbort, { once: true });
      timeoutId = setTimeout(() => {
        finish({
          ok: false,
          error: new SpeakerEmbeddingWorkerClientError(
            "WORKER_TIMEOUT",
            "Speaker embedding exceeded its bounded execution time.",
          ),
          terminate: true,
        });
      }, timeoutMs);

      try {
        worker.postMessage(
          {
            type: "speaker-embedding-analyze",
            identity,
            source,
            samples: transferableSamples,
          },
          [transferableSamples.buffer],
        );
      } catch {
        finish({
          ok: false,
          error: new SpeakerEmbeddingWorkerClientError(
            "WORKER_ERROR",
            "Speaker embedding input could not be transferred to the Worker.",
          ),
          terminate: true,
        });
      }
    });
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.abortActive !== null) {
      this.abortActive();
      return;
    }
    if (this.worker !== null) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

/** Single-turn convenience API. Batch callers should reuse the client class. */
export async function runSpeakerEmbeddingWorker(
  samples: Float32Array,
  options: RunSpeakerEmbeddingOptions,
  clientOptions: SpeakerEmbeddingWorkerClientOptions = {},
): Promise<SpeakerEmbeddingResult> {
  const client = new SpeakerEmbeddingWorkerClient(clientOptions);
  try {
    return await client.embed(samples, options);
  } finally {
    client.dispose();
  }
}
