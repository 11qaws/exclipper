/// <reference lib="webworker" />

import {
  AutoModel,
  AutoProcessor,
  env,
  Tensor,
  type PreTrainedModel,
  type Processor,
} from "@huggingface/transformers";

import {
  l2NormalizeSpeakerEmbedding,
  SpeakerEmbeddingMathError,
} from "./speakerEmbeddingMath";
import {
  SPEAKER_EMBEDDING_DIMENSION,
  SPEAKER_EMBEDDING_MODEL_DESCRIPTOR,
  SPEAKER_EMBEDDING_MODEL_DTYPE,
  SPEAKER_EMBEDDING_MODEL_ID,
  SPEAKER_EMBEDDING_MODEL_REVISION,
  SPEAKER_EMBEDDING_PROTOCOL_VERSION,
  SPEAKER_EMBEDDING_RUNTIME_DEVICE,
  SpeakerEmbeddingProtocolError,
  assertSpeakerEmbeddingPcm,
  createSpeakerEmbeddingSourceReceipt,
  isSpeakerEmbeddingRunIdentity,
  speakerEmbeddingWorkerIdentityEquals,
  type SpeakerEmbeddingSourceInput,
  type SpeakerEmbeddingSourceReceipt,
  type SpeakerEmbeddingWorkerFailureReason,
  type SpeakerEmbeddingWorkerIdentity,
  type SpeakerEmbeddingWorkerProgress,
  type SpeakerEmbeddingWorkerRequest,
  type SpeakerEmbeddingWorkerResponse,
} from "./speakerEmbeddingWorkerProtocol";

declare const self: DedicatedWorkerGlobalScope;

type AnalyzeRequest = Extract<
  SpeakerEmbeddingWorkerRequest,
  { readonly type: "speaker-embedding-analyze" }
>;
type CancelRequest = Extract<
  SpeakerEmbeddingWorkerRequest,
  { readonly type: "speaker-embedding-cancel" }
>;
type SpeakerEmbeddingWorkerResponseWithoutEventId =
  SpeakerEmbeddingWorkerResponse extends infer Response
    ? Response extends { readonly eventId: string }
      ? Omit<Response, "eventId">
      : never
    : never;

const BUNDLED_ORT_WASM_URL = new URL(
  "../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm",
  import.meta.url,
);
const MAX_EVENT_ID_LENGTH = 512;
const IDENTITY_KEYS = [
  "protocolVersion",
  "sessionId",
  "writerEpoch",
  "analysisRunId",
  "embeddingRunId",
  "workerEpoch",
  "workerInstanceId",
  "taskId",
  "inputFingerprint",
] as const;
const SOURCE_KEYS = [
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
] as const;
const PREPARATION_KEYS = [
  "speechActivity",
  "speechActivityRevision",
  "overlapStatus",
  "musicStatus",
  "conditioningRevision",
] as const;

interface ModelResources {
  readonly processor: Processor;
  readonly model: PreTrainedModel;
}

interface ActiveTask {
  readonly identity: SpeakerEmbeddingWorkerIdentity;
  cancelled: boolean;
  cancellationPosted: boolean;
}

class SpeakerEmbeddingWorkerFailure extends Error {
  public constructor(
    public readonly reasonCode: SpeakerEmbeddingWorkerFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "SpeakerEmbeddingWorkerFailure";
  }
}

let modelResourcesPromise: Promise<ModelResources> | null = null;
let activeTask: ActiveTask | null = null;
let eventSequence = 0;

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

function isWorkerIdentity(
  value: unknown,
): value is SpeakerEmbeddingWorkerIdentity {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, IDENTITY_KEYS) ||
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

function isSourceReceipt(
  value: unknown,
): value is SpeakerEmbeddingSourceReceipt {
  return (
    isRecord(value) &&
    hasExactKeys(value, SOURCE_KEYS) &&
    isRecord(value.preparation) &&
    hasExactKeys(value.preparation, PREPARATION_KEYS)
  );
}

function isAnalyzeRequest(value: unknown): value is AnalyzeRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["type", "identity", "source", "samples"]) &&
    value.type === "speaker-embedding-analyze" &&
    isWorkerIdentity(value.identity) &&
    isSourceReceipt(value.source) &&
    value.samples instanceof Float32Array
  );
}

function isCancelRequest(value: unknown): value is CancelRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["type", "identity"]) &&
    value.type === "speaker-embedding-cancel" &&
    isWorkerIdentity(value.identity)
  );
}

function createEventId(taskId: string): string {
  eventSequence += 1;
  const random = self.crypto?.randomUUID?.() ?? Date.now().toString(36);
  return `${taskId}:${eventSequence}:${random}`.slice(
    0,
    MAX_EVENT_ID_LENGTH,
  );
}

function postResponse(
  response: SpeakerEmbeddingWorkerResponseWithoutEventId,
  transfer: Transferable[] = [],
): void {
  self.postMessage(
    {
      ...response,
      eventId: createEventId(response.identity.taskId),
    } satisfies SpeakerEmbeddingWorkerResponse,
    transfer,
  );
}

function postProgress(
  identity: SpeakerEmbeddingWorkerIdentity,
  progress: SpeakerEmbeddingWorkerProgress,
): void {
  postResponse({
    type: "speaker-embedding-progress",
    identity,
    progress,
  });
}

function postFailure(
  identity: SpeakerEmbeddingWorkerIdentity,
  reasonCode: SpeakerEmbeddingWorkerFailureReason,
  message: string,
): void {
  postResponse({
    type: "speaker-embedding-failed",
    identity,
    reasonCode,
    message,
  });
}

function configureBundledOrtWasm(): void {
  const wasm = env.backends.onnx.wasm;
  if (wasm === undefined) {
    throw new SpeakerEmbeddingWorkerFailure(
      "MODEL_LOAD_FAILED",
      "The fixed WASM runtime is unavailable.",
    );
  }
  wasm.wasmPaths = { wasm: BUNDLED_ORT_WASM_URL };
  wasm.numThreads = 1;
  wasm.proxy = false;
}

function progressBytes(
  value: unknown,
): {
  readonly ratio: number | null;
  readonly loadedBytes: number | null;
  readonly totalBytes: number | null;
} {
  if (!isRecord(value)) {
    return { ratio: null, loadedBytes: null, totalBytes: null };
  }
  const loadedBytes =
    Number.isSafeInteger(value.loaded) && (value.loaded as number) >= 0
      ? (value.loaded as number)
      : null;
  const totalBytes =
    Number.isSafeInteger(value.total) && (value.total as number) >= 0
      ? (value.total as number)
      : null;
  const ratio =
    loadedBytes !== null && totalBytes !== null && totalBytes > 0
      ? Math.max(0, Math.min(1, loadedBytes / totalBytes))
      : typeof value.progress === "number" &&
          Number.isFinite(value.progress)
        ? Math.max(0, Math.min(1, value.progress / 100))
        : null;
  return {
    ratio,
    loadedBytes,
    totalBytes:
      loadedBytes !== null &&
      totalBytes !== null &&
      loadedBytes <= totalBytes
        ? totalBytes
        : null,
  };
}

function createLoadingReporter(
  task: ActiveTask,
  stage: "loading-processor" | "loading-model",
  baseRatio: number,
  span: number,
): (value: unknown) => void {
  let highestRatio = baseRatio;
  return (value: unknown): void => {
    if (task.cancelled) return;
    const parsed = progressBytes(value);
    const ratio =
      parsed.ratio === null
        ? highestRatio
        : Math.max(highestRatio, baseRatio + parsed.ratio * span);
    if (ratio === highestRatio && parsed.loadedBytes === null) return;
    highestRatio = ratio;
    postProgress(task.identity, {
      stage,
      ratio,
      loadedBytes: parsed.loadedBytes,
      totalBytes: parsed.totalBytes,
    });
  };
}

async function loadModelResources(
  task: ActiveTask,
): Promise<ModelResources> {
  if (modelResourcesPromise !== null) {
    postProgress(task.identity, {
      stage: "loading-processor",
      ratio: 0.15,
      loadedBytes: null,
      totalBytes: null,
    });
    postProgress(task.identity, {
      stage: "loading-model",
      ratio: 0.85,
      loadedBytes: null,
      totalBytes: null,
    });
    return modelResourcesPromise;
  }

  modelResourcesPromise = (async () => {
    configureBundledOrtWasm();
    postProgress(task.identity, {
      stage: "loading-processor",
      ratio: 0,
      loadedBytes: null,
      totalBytes: null,
    });
    const processor = await AutoProcessor.from_pretrained(
      SPEAKER_EMBEDDING_MODEL_ID,
      {
        revision: SPEAKER_EMBEDDING_MODEL_REVISION,
        progress_callback: createLoadingReporter(
          task,
          "loading-processor",
          0,
          0.15,
        ),
      },
    );
    if (!task.cancelled) {
      postProgress(task.identity, {
        stage: "loading-processor",
        ratio: 0.15,
        loadedBytes: null,
        totalBytes: null,
      });
    }
    const model = await AutoModel.from_pretrained(
      SPEAKER_EMBEDDING_MODEL_ID,
      {
        revision: SPEAKER_EMBEDDING_MODEL_REVISION,
        dtype: SPEAKER_EMBEDDING_MODEL_DTYPE,
        device: SPEAKER_EMBEDDING_RUNTIME_DEVICE,
        progress_callback: createLoadingReporter(
          task,
          "loading-model",
          0.15,
          0.7,
        ),
      },
    );
    if (!task.cancelled) {
      postProgress(task.identity, {
        stage: "loading-model",
        ratio: 0.85,
        loadedBytes: null,
        totalBytes: null,
      });
    }
    return { processor, model };
  })();

  try {
    return await modelResourcesPromise;
  } catch {
    modelResourcesPromise = null;
    throw new SpeakerEmbeddingWorkerFailure(
      "MODEL_LOAD_FAILED",
      "The pinned WavLM speaker model could not be loaded.",
    );
  }
}

function sourceInputFromReceipt(
  source: SpeakerEmbeddingSourceReceipt,
): SpeakerEmbeddingSourceInput {
  return {
    sourceFingerprint: source.sourceFingerprint,
    sourceDurationMs: source.sourceDurationMs,
    sourceStartMs: source.sourceStartMs,
    sourceEndMs: source.sourceEndMs,
    sourceUnitId: source.sourceUnitId,
    audioBundleReuseKey: source.audioBundleReuseKey,
    preparation: source.preparation,
  };
}

async function assertExactInput(
  request: AnalyzeRequest,
): Promise<void> {
  const sourceInput = sourceInputFromReceipt(request.source);
  assertSpeakerEmbeddingPcm(request.samples, sourceInput);
  const expected = await createSpeakerEmbeddingSourceReceipt(
    sourceInput,
    request.samples,
  );
  if (
    JSON.stringify(expected) !== JSON.stringify(request.source) ||
    request.identity.inputFingerprint !== expected.inputFingerprint
  ) {
    throw new SpeakerEmbeddingWorkerFailure(
      "INPUT_IDENTITY_MISMATCH",
      "The transferred PCM does not match its source-fenced receipt.",
    );
  }
}

function disposeTensorGraph(
  value: unknown,
  disposed: Set<unknown>,
): void {
  if (value === null || value === undefined || disposed.has(value)) return;
  if (value instanceof Tensor) {
    disposed.add(value);
    try {
      value.dispose();
    } catch {
      // Cleanup must never replace an already-valid inference outcome.
    }
    return;
  }
  if (typeof value !== "object") return;
  disposed.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry) => disposeTensorGraph(entry, disposed));
    return;
  }
  Object.values(value).forEach((entry) =>
    disposeTensorGraph(entry, disposed),
  );
}

function embeddingFromOutput(
  output: unknown,
): Float32Array<ArrayBuffer> {
  if (!isRecord(output) || !(output.embeddings instanceof Tensor)) {
    throw new SpeakerEmbeddingWorkerFailure(
      "INVALID_MODEL_OUTPUT",
      "WavLM did not return an embedding tensor.",
    );
  }
  const tensor = output.embeddings;
  const data: unknown = tensor.data;
  if (
    tensor.size !== SPEAKER_EMBEDDING_DIMENSION ||
    tensor.dims.length !== 2 ||
    tensor.dims[0] !== 1 ||
    tensor.dims[1] !== SPEAKER_EMBEDDING_DIMENSION ||
    !(data instanceof Float32Array) ||
    data.length !== SPEAKER_EMBEDDING_DIMENSION
  ) {
    throw new SpeakerEmbeddingWorkerFailure(
      "INVALID_MODEL_OUTPUT",
      "WavLM returned an unexpected embedding shape.",
    );
  }
  try {
    return l2NormalizeSpeakerEmbedding(data);
  } catch (cause) {
    if (cause instanceof SpeakerEmbeddingMathError) {
      throw new SpeakerEmbeddingWorkerFailure(
        "INVALID_MODEL_OUTPUT",
        "WavLM returned a non-finite or zero speaker embedding.",
      );
    }
    throw cause;
  }
}

async function infer(
  resources: ModelResources,
  request: AnalyzeRequest,
  task: ActiveTask,
): Promise<Float32Array<ArrayBuffer> | null> {
  let inputs: unknown = null;
  let output: unknown = null;
  try {
    postProgress(task.identity, {
      stage: "preparing-input",
      ratio: 0.88,
      loadedBytes: null,
      totalBytes: null,
    });
    inputs = await resources.processor(request.samples);
    if (task.cancelled) return null;
    postProgress(task.identity, {
      stage: "running-inference",
      ratio: 0.92,
      loadedBytes: null,
      totalBytes: null,
    });
    output = await resources.model(inputs);
    if (task.cancelled) return null;
    postProgress(task.identity, {
      stage: "normalizing",
      ratio: 0.98,
      loadedBytes: null,
      totalBytes: null,
    });
    return embeddingFromOutput(output);
  } catch (cause) {
    if (
      cause instanceof SpeakerEmbeddingWorkerFailure ||
      task.cancelled
    ) {
      throw cause;
    }
    throw new SpeakerEmbeddingWorkerFailure(
      "INFERENCE_FAILED",
      "The pinned WavLM speaker inference failed.",
    );
  } finally {
    const disposed = new Set<unknown>();
    disposeTensorGraph(output, disposed);
    disposeTensorGraph(inputs, disposed);
  }
}

async function runTask(
  request: AnalyzeRequest,
  task: ActiveTask,
): Promise<void> {
  try {
    await assertExactInput(request);
    if (task.cancelled) return;
    const resources = await loadModelResources(task);
    if (task.cancelled) return;
    const embedding = await infer(resources, request, task);
    if (task.cancelled || embedding === null) return;
    postProgress(task.identity, {
      stage: "complete",
      ratio: 1,
      loadedBytes: null,
      totalBytes: null,
    });
    postResponse(
      {
        type: "speaker-embedding-completed",
        identity: task.identity,
        result: {
          embedding,
          receipt: {
            source: request.source,
            model: SPEAKER_EMBEDDING_MODEL_DESCRIPTOR,
            embeddingDimension: SPEAKER_EMBEDDING_DIMENSION,
            normalization: "l2",
          },
        },
      },
      [embedding.buffer],
    );
  } catch (cause) {
    if (task.cancelled) return;
    if (cause instanceof SpeakerEmbeddingWorkerFailure) {
      postFailure(task.identity, cause.reasonCode, cause.message);
      return;
    }
    if (cause instanceof SpeakerEmbeddingProtocolError) {
      postFailure(
        task.identity,
        cause.code === "UNCLEAN_SPEECH_TURN"
          ? "UNCLEAN_SPEECH_TURN"
          : "INVALID_REQUEST",
        cause.message,
      );
      return;
    }
    postFailure(
      task.identity,
      "INFERENCE_FAILED",
      "Speaker embedding failed unexpectedly.",
    );
  } finally {
    request.samples.fill(0);
    if (activeTask === task) {
      activeTask = null;
    }
  }
}

function cancelTask(request: CancelRequest): void {
  const task = activeTask;
  if (
    task === null ||
    !speakerEmbeddingWorkerIdentityEquals(
      request.identity,
      task.identity,
    ) ||
    task.cancellationPosted
  ) {
    return;
  }
  task.cancelled = true;
  task.cancellationPosted = true;
  postResponse({
    type: "speaker-embedding-cancelled",
    identity: task.identity,
  });
}

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (isCancelRequest(request)) {
    cancelTask(request);
    return;
  }
  if (!isAnalyzeRequest(request)) {
    const candidate = isRecord(request) ? request.identity : null;
    if (isWorkerIdentity(candidate)) {
      postFailure(
        candidate,
        "INVALID_REQUEST",
        "The speaker embedding request is malformed.",
      );
    }
    return;
  }
  if (activeTask !== null) {
    postFailure(
      request.identity,
      "WORKER_BUSY",
      "This speaker embedding Worker already owns another speech turn.",
    );
    return;
  }
  if (
    request.identity.protocolVersion !==
      SPEAKER_EMBEDDING_PROTOCOL_VERSION
  ) {
    postFailure(
      request.identity,
      "INVALID_REQUEST",
      "The speaker embedding protocol version is unsupported.",
    );
    return;
  }
  const task: ActiveTask = {
    identity: request.identity,
    cancelled: false,
    cancellationPosted: false,
  };
  activeTask = task;
  void runTask(request, task);
});

export {};
