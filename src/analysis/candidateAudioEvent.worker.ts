/// <reference lib="webworker" />

import {
  AutoModelForAudioClassification,
  AutoProcessor,
  env,
  Tensor,
  type PreTrainedModel,
  type Processor,
} from "@huggingface/transformers";
import {
  ALL_FORMATS,
  AudioSampleSink,
  BlobSource,
  Input,
  UnsupportedInputFormatError,
  type AudioSample,
  type InputAudioTrack,
} from "mediabunny";

import {
  CANDIDATE_AUDIO_EVENT_AUDIOSET_ALLOWLIST,
  CANDIDATE_AUDIO_EVENT_AUDIOSET_LABEL_COUNT,
  CANDIDATE_AUDIO_EVENT_MIN_TARGET_DURATION_MS,
  aggregateCandidateAudioEventScores,
  buildCandidateAudioEventWindows,
  type CandidateAudioEventWindow,
  type CandidateAudioEventWindowScores,
} from "./candidateAudioEvent";
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
  type CandidateAudioEventCandidateGap,
  type CandidateAudioEventCandidateGapReason,
  type CandidateAudioEventCandidateProgress,
  type CandidateAudioEventModelProgress,
  type CandidateAudioEventTarget,
  type CandidateAudioEventWorkerIdentity,
  type CandidateAudioEventWorkerRequest,
  type CandidateAudioEventWorkerResponse,
  type CandidateAudioEventWorkerResponsePayload,
} from "./candidateAudioEventWorkerProtocol";
import { summarizeCandidatePassBAudioGate } from "./candidatePassBAudioGate";
import { CandidatePassBModelDownloadTracker } from "./candidatePassBModelDownloadProgress";

declare const self: DedicatedWorkerGlobalScope;

type AnalyzeRequest = Extract<
  CandidateAudioEventWorkerRequest,
  { readonly type: "candidate-audio-event-analyze" }
>;
type CancelRequest = Extract<
  CandidateAudioEventWorkerRequest,
  { readonly type: "candidate-audio-event-cancel" }
>;

const SOURCE_CACHE_BYTES = 8 * 1024 * 1024;
const MAX_ID_LENGTH = 2_048;
const MAX_CANDIDATE_ID_LENGTH = 256;
const MODEL_PROCESSOR_PROGRESS_SPAN = 0.1;
const MODEL_WEIGHTS_PROGRESS_SPAN = 0.85;
const MODEL_LOADING_RATIO_CEILING = 0.95;
const CANDIDATE_DECODE_RATIO_CEILING = 0.45;
const CANDIDATE_CLASSIFY_RATIO_CEILING = 0.95;
const PROGRESS_MIN_INTERVAL_MS = 150;
const PROGRESS_MIN_RATIO_STEP = 0.01;
const BUNDLED_ORT_WASM_URL = new URL(
  "../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm",
  import.meta.url,
);

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
const ANALYZE_REQUEST_KEYS = [
  "type",
  "identity",
  "file",
  "sourceDurationMs",
  "targets",
] as const;
const TARGET_KEYS = ["candidateId", "startMs", "endMs", "peakMs"] as const;

interface ActiveTask {
  readonly identity: CandidateAudioEventWorkerIdentity;
  cancelled: boolean;
  input: Input<BlobSource> | null;
  inputWasDisposed: boolean;
  processor: Processor | null;
  model: PreTrainedModel | null;
  modelWasLoaded: boolean;
  currentPcm: Float32Array | null;
  completion: Promise<void> | null;
}

interface DecodedWindow {
  readonly pcm: Float32Array;
  readonly decodedOverlapFrameCount: number;
}

class ModelLoadFailure extends Error {
  public constructor() {
    super("The pinned local audio-event model could not be loaded.");
    this.name = "ModelLoadFailure";
  }
}

class CandidateFailure extends Error {
  public readonly reasonCode: CandidateAudioEventCandidateGapReason;

  public constructor(
    reasonCode: CandidateAudioEventCandidateGapReason,
    message: string,
  ) {
    super(message);
    this.name = "CandidateFailure";
    this.reasonCode = reasonCode;
  }
}

let activeTask: ActiveTask | null = null;
let eventSequence = 0;

function createEventId(taskId: string): string {
  eventSequence += 1;
  const randomId = self.crypto?.randomUUID?.();
  return `${taskId}-${eventSequence}-${randomId ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function postResponse(
  identity: CandidateAudioEventWorkerIdentity,
  payload: CandidateAudioEventWorkerResponsePayload,
): void {
  const response = {
    ...identity,
    eventId: createEventId(identity.taskId),
    ...payload,
  } satisfies CandidateAudioEventWorkerResponse;
  self.postMessage(response);
}

function postModelProgress(
  identity: CandidateAudioEventWorkerIdentity,
  progress: CandidateAudioEventModelProgress,
): void {
  postResponse(identity, {
    type: "candidate-audio-event-model-progress",
    progress,
  });
}

function postCandidateProgress(
  identity: CandidateAudioEventWorkerIdentity,
  progress: CandidateAudioEventCandidateProgress,
): void {
  postResponse(identity, {
    type: "candidate-audio-event-candidate-progress",
    progress,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return (
    actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index])
  );
}

function isDenseArray(value: readonly unknown[]): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === value.length &&
    keys.every((key, index) => key === String(index))
  );
}

function isBoundedNonEmptyString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_ID_LENGTH
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isValidIdentity(
  value: unknown,
): value is CandidateAudioEventWorkerIdentity {
  if (!isRecord(value) || !hasExactKeys(value, IDENTITY_KEYS)) {
    return false;
  }
  return (
    value.protocolVersion === CANDIDATE_AUDIO_EVENT_PROTOCOL_VERSION &&
    isBoundedNonEmptyString(value.sessionId) &&
    isNonNegativeSafeInteger(value.writerEpoch) &&
    isBoundedNonEmptyString(value.analysisRunId) &&
    isBoundedNonEmptyString(value.audioEventRunId) &&
    isNonNegativeSafeInteger(value.workerEpoch) &&
    isBoundedNonEmptyString(value.workerInstanceId) &&
    isBoundedNonEmptyString(value.taskId)
  );
}

function isValidTarget(
  value: unknown,
  sourceDurationMs: number,
): value is CandidateAudioEventTarget {
  if (!isRecord(value) || !hasExactKeys(value, TARGET_KEYS)) {
    return false;
  }
  if (
    typeof value.candidateId !== "string" ||
    value.candidateId.length === 0 ||
    value.candidateId.length > MAX_CANDIDATE_ID_LENGTH ||
    value.candidateId.trim() !== value.candidateId ||
    !isNonNegativeSafeInteger(value.startMs) ||
    !isNonNegativeSafeInteger(value.endMs) ||
    !isNonNegativeSafeInteger(value.peakMs)
  ) {
    return false;
  }
  const durationMs = value.endMs - value.startMs;
  return (
    value.endMs <= sourceDurationMs &&
    durationMs >= CANDIDATE_AUDIO_EVENT_MIN_TARGET_DURATION_MS &&
    durationMs <= MAX_CANDIDATE_AUDIO_EVENT_TARGET_DURATION_MS &&
    value.peakMs >= value.startMs &&
    value.peakMs <= value.endMs
  );
}

function isValidAnalyzeRequest(value: unknown): value is AnalyzeRequest {
  if (!isRecord(value) || !hasExactKeys(value, ANALYZE_REQUEST_KEYS)) {
    return false;
  }
  if (
    value.type !== "candidate-audio-event-analyze" ||
    !isValidIdentity(value.identity) ||
    !(value.file instanceof File) ||
    !Number.isFinite(value.file.size) ||
    value.file.size < 0 ||
    !isNonNegativeSafeInteger(value.sourceDurationMs) ||
    value.sourceDurationMs <= 0 ||
    value.sourceDurationMs > MAX_CANDIDATE_AUDIO_EVENT_SOURCE_DURATION_MS ||
    !Array.isArray(value.targets) ||
    !isDenseArray(value.targets) ||
    value.targets.length === 0 ||
    value.targets.length > MAX_CANDIDATE_AUDIO_EVENT_TARGETS
  ) {
    return false;
  }
  const candidateIds = new Set<string>();
  for (const target of value.targets) {
    if (
      !isValidTarget(target, value.sourceDurationMs) ||
      candidateIds.has(target.candidateId)
    ) {
      return false;
    }
    candidateIds.add(target.candidateId);
  }
  return true;
}

function isValidCancelRequest(value: unknown): value is CancelRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["type", "identity"]) &&
    value.type === "candidate-audio-event-cancel" &&
    isValidIdentity(value.identity)
  );
}

function sameIdentity(
  left: CandidateAudioEventWorkerIdentity,
  right: CandidateAudioEventWorkerIdentity,
): boolean {
  return (
    left.protocolVersion === right.protocolVersion &&
    left.sessionId === right.sessionId &&
    left.writerEpoch === right.writerEpoch &&
    left.analysisRunId === right.analysisRunId &&
    left.audioEventRunId === right.audioEventRunId &&
    left.workerEpoch === right.workerEpoch &&
    left.workerInstanceId === right.workerInstanceId &&
    left.taskId === right.taskId
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function nextPowerOfTwo(value: number): number {
  let capacity = 1;
  const target = Math.max(1, Math.ceil(value));
  while (capacity < target) {
    capacity *= 2;
  }
  return capacity;
}

function releaseCurrentPcm(task: ActiveTask, pcm: Float32Array): void {
  pcm.fill(0);
  if (task.currentPcm === pcm) {
    task.currentPcm = null;
  }
}

function disposeInputOnce(task: ActiveTask): void {
  if (task.inputWasDisposed) {
    task.input = null;
    return;
  }
  const input = task.input;
  task.inputWasDisposed = true;
  task.input = null;
  if (input === null) {
    return;
  }
  try {
    input.dispose();
  } catch {
    // Cleanup is intentionally best-effort and never exposes source details.
  }
}

async function disposeModelOnce(task: ActiveTask): Promise<void> {
  const model = task.model;
  task.model = null;
  if (model === null) {
    return;
  }
  try {
    await model.dispose();
  } catch {
    // The client may terminate this dedicated Worker after a terminal message.
  }
}

async function cleanupTaskResources(task: ActiveTask): Promise<void> {
  if (task.currentPcm !== null) {
    releaseCurrentPcm(task, task.currentPcm);
  }
  disposeInputOnce(task);
  await disposeModelOnce(task);
  task.processor = null;
}

function candidateGap(
  target: CandidateAudioEventTarget,
  reasonCode: CandidateAudioEventCandidateGapReason,
  message: string,
): CandidateAudioEventCandidateGap {
  return {
    candidateId: target.candidateId,
    sourceStartMs: target.startMs,
    sourceEndMs: target.endMs,
    reactionPeakMs: target.peakMs,
    reasonCode,
    message,
  };
}

function postGap(
  identity: CandidateAudioEventWorkerIdentity,
  target: CandidateAudioEventTarget,
  candidateOrdinal: number,
  targetCount: number,
  reasonCode: CandidateAudioEventCandidateGapReason,
  message: string,
): void {
  postCandidateProgress(identity, {
    candidateId: target.candidateId,
    candidateOrdinal,
    targetCount,
    stage: "gap",
    ratio: 1,
  });
  postResponse(identity, {
    type: "candidate-audio-event-candidate-gap",
    gap: candidateGap(target, reasonCode, message),
  });
}

function postAllTargetsAsGaps(
  request: AnalyzeRequest,
  reasonCode: CandidateAudioEventCandidateGapReason,
  message: string,
): void {
  request.targets.forEach((target, index) => {
    postGap(
      request.identity,
      target,
      index + 1,
      request.targets.length,
      reasonCode,
      message,
    );
  });
  postResponse(request.identity, {
    type: "candidate-audio-event-completed",
    summary: {
      requestedCount: request.targets.length,
      completedCount: 0,
      gapCount: request.targets.length,
    },
  });
}

function configureBundledOrtWasm(): void {
  const wasm = env.backends.onnx.wasm;
  if (wasm === undefined) {
    throw new ModelLoadFailure();
  }
  wasm.wasmPaths = { wasm: BUNDLED_ORT_WASM_URL };
  wasm.numThreads = 1;
  wasm.proxy = false;
}

function assertPinnedId2Label(model: PreTrainedModel): void {
  const config: unknown = model.config;
  if (!isRecord(config) || !isRecord(config.id2label)) {
    throw new ModelLoadFailure();
  }
  if (
    config.num_labels !== undefined &&
    config.num_labels !== CANDIDATE_AUDIO_EVENT_AUDIOSET_LABEL_COUNT
  ) {
    throw new ModelLoadFailure();
  }

  const id2label = config.id2label;
  const keys = Object.keys(id2label);
  if (keys.length !== CANDIDATE_AUDIO_EVENT_AUDIOSET_LABEL_COUNT) {
    throw new ModelLoadFailure();
  }
  for (let index = 0; index < CANDIDATE_AUDIO_EVENT_AUDIOSET_LABEL_COUNT; index += 1) {
    if (typeof id2label[String(index)] !== "string") {
      throw new ModelLoadFailure();
    }
  }
  for (const definition of CANDIDATE_AUDIO_EVENT_AUDIOSET_ALLOWLIST) {
    if (id2label[String(definition.labelId)] !== definition.label) {
      throw new ModelLoadFailure();
    }
  }
}

async function loadModelArtifacts(task: ActiveTask): Promise<boolean> {
  const processorTracker = new CandidatePassBModelDownloadTracker();
  const modelTracker = new CandidatePassBModelDownloadTracker();
  let highestRatio = 0;
  let lastPostedAt = 0;

  const reportLoading = (
    ratio: number,
    loadedBytes: number | null,
    totalBytes: number | null,
    force = false,
  ): void => {
    if (task.cancelled) {
      return;
    }
    const nextRatio = clamp(
      Math.max(highestRatio, ratio),
      0,
      MODEL_LOADING_RATIO_CEILING,
    );
    const now = Date.now();
    if (
      !force &&
      nextRatio - highestRatio < PROGRESS_MIN_RATIO_STEP &&
      now - lastPostedAt < PROGRESS_MIN_INTERVAL_MS
    ) {
      return;
    }
    highestRatio = nextRatio;
    lastPostedAt = now;
    postModelProgress(task.identity, {
      stage: "loading",
      ratio: round(nextRatio),
      loadedBytes,
      totalBytes,
    });
  };

  reportLoading(0, null, null, true);
  try {
    configureBundledOrtWasm();
    const processor = await AutoProcessor.from_pretrained(
      CANDIDATE_AUDIO_EVENT_MODEL_ID,
      {
        revision: CANDIDATE_AUDIO_EVENT_MODEL_REVISION,
        progress_callback: (rawProgress: unknown) => {
          if (task.cancelled) {
            return;
          }
          const progress = processorTracker.update(rawProgress);
          if (progress === null) {
            return;
          }
          reportLoading(
            progress.ratio * MODEL_PROCESSOR_PROGRESS_SPAN,
            progress.loadedBytes,
            progress.totalBytes,
          );
        },
      },
    );
    task.processor = processor;
    if (task.cancelled) {
      task.processor = null;
      return false;
    }
    reportLoading(MODEL_PROCESSOR_PROGRESS_SPAN, null, null, true);

    const model = await AutoModelForAudioClassification.from_pretrained(
      CANDIDATE_AUDIO_EVENT_MODEL_ID,
      {
        revision: CANDIDATE_AUDIO_EVENT_MODEL_REVISION,
        dtype: CANDIDATE_AUDIO_EVENT_MODEL_DTYPE,
        device: CANDIDATE_AUDIO_EVENT_RUNTIME_DEVICE,
        progress_callback: (rawProgress) => {
          if (task.cancelled) {
            return;
          }
          const progress = modelTracker.update(rawProgress);
          if (progress === null) {
            return;
          }
          reportLoading(
            MODEL_PROCESSOR_PROGRESS_SPAN +
              progress.ratio * MODEL_WEIGHTS_PROGRESS_SPAN,
            progress.loadedBytes,
            progress.totalBytes,
          );
        },
      },
    );
    task.model = model;
    task.modelWasLoaded = true;
    if (task.cancelled) {
      return false;
    }
    assertPinnedId2Label(model);
    postModelProgress(task.identity, {
      stage: "ready",
      ratio: 1,
      loadedBytes: null,
      totalBytes: null,
    });
    return true;
  } catch {
    if (task.cancelled) {
      return false;
    }
    throw new ModelLoadFailure();
  }
}

class WindowPcmBuilder {
  private channelScratch = new Float32Array(0);
  private monoScratch = new Float32Array(0);
  private nextOutputFrame = 0;
  private decodedOverlapFrameCount = 0;

  public readonly pcm = new Float32Array(
    (CANDIDATE_AUDIO_EVENT_WINDOW_DURATION_MS / 1_000) *
      CANDIDATE_AUDIO_EVENT_SAMPLE_RATE_HZ,
  );

  public constructor(private readonly window: CandidateAudioEventWindow) {}

  public consume(sample: AudioSample): void {
    if (
      sample.numberOfFrames <= 0 ||
      sample.numberOfChannels <= 0 ||
      sample.sampleRate <= 0
    ) {
      return;
    }

    const windowStartSeconds = this.window.sourceStartMs / 1_000;
    const windowEndSeconds = this.window.sourceEndMs / 1_000;
    const sampleStartSeconds = sample.timestamp;
    const sampleEndSeconds = sample.timestamp + sample.duration;
    const overlapStartSeconds = Math.max(windowStartSeconds, sampleStartSeconds);
    const overlapEndSeconds = Math.min(windowEndSeconds, sampleEndSeconds);
    if (overlapEndSeconds <= overlapStartSeconds) {
      return;
    }

    this.decodedOverlapFrameCount += Math.max(
      1,
      Math.floor((overlapEndSeconds - overlapStartSeconds) * sample.sampleRate),
    );
    this.ensureScratchCapacity(sample.numberOfFrames);
    const channel = this.channelScratch.subarray(0, sample.numberOfFrames);
    const mono = this.monoScratch.subarray(0, sample.numberOfFrames);
    mono.fill(0);

    for (let channelIndex = 0; channelIndex < sample.numberOfChannels; channelIndex += 1) {
      sample.copyTo(channel, {
        planeIndex: channelIndex,
        format: "f32-planar",
      });
      for (let frameIndex = 0; frameIndex < sample.numberOfFrames; frameIndex += 1) {
        const sampleValue = channel[frameIndex] ?? 0;
        mono[frameIndex] =
          (mono[frameIndex] ?? 0) +
          (Number.isFinite(sampleValue) ? sampleValue : 0) /
            sample.numberOfChannels;
      }
    }

    const firstOutputFrame = clampInteger(
      Math.ceil(
        (Math.max(sampleStartSeconds, windowStartSeconds) - windowStartSeconds) *
          CANDIDATE_AUDIO_EVENT_SAMPLE_RATE_HZ,
      ),
      0,
      this.pcm.length,
    );
    const lastOutputFrameExclusive = clampInteger(
      Math.ceil(
        (Math.min(sampleEndSeconds, windowEndSeconds) - windowStartSeconds) *
          CANDIDATE_AUDIO_EVENT_SAMPLE_RATE_HZ,
      ),
      0,
      this.pcm.length,
    );
    this.nextOutputFrame = Math.max(this.nextOutputFrame, firstOutputFrame);

    while (this.nextOutputFrame < lastOutputFrameExclusive) {
      const outputTimestampSeconds =
        windowStartSeconds +
        this.nextOutputFrame / CANDIDATE_AUDIO_EVENT_SAMPLE_RATE_HZ;
      const sourcePosition =
        (outputTimestampSeconds - sampleStartSeconds) * sample.sampleRate;
      if (sourcePosition < 0) {
        this.nextOutputFrame += 1;
        continue;
      }
      if (sourcePosition >= sample.numberOfFrames) {
        break;
      }

      const lowerIndex = Math.floor(sourcePosition);
      const upperIndex = Math.min(sample.numberOfFrames - 1, lowerIndex + 1);
      const interpolation = sourcePosition - lowerIndex;
      const lowerValue = mono[lowerIndex] ?? 0;
      const upperValue = mono[upperIndex] ?? lowerValue;
      this.pcm[this.nextOutputFrame] = clamp(
        lowerValue + (upperValue - lowerValue) * interpolation,
        -1,
        1,
      );
      this.nextOutputFrame += 1;
    }
  }

  public finish(): DecodedWindow {
    return {
      pcm: this.pcm,
      decodedOverlapFrameCount: this.decodedOverlapFrameCount,
    };
  }

  private ensureScratchCapacity(frameCount: number): void {
    if (this.channelScratch.length >= frameCount) {
      return;
    }
    const capacity = nextPowerOfTwo(frameCount);
    this.channelScratch = new Float32Array(capacity);
    this.monoScratch = new Float32Array(capacity);
  }
}

function isUnsupportedAudioCodecError(cause: unknown): boolean {
  if (
    typeof DOMException !== "undefined" &&
    cause instanceof DOMException &&
    cause.name === "NotSupportedError"
  ) {
    return true;
  }
  if (!(cause instanceof Error)) {
    return false;
  }
  const message = cause.message.toLowerCase();
  return (
    message.includes("cannot be decoded") ||
    message.includes("codec is not supported") ||
    message.includes("unsupported audio codec") ||
    (message.includes("audiodecoder") && message.includes("support"))
  );
}

async function decodeWindow(
  audioTrack: InputAudioTrack,
  window: CandidateAudioEventWindow,
  task: ActiveTask,
): Promise<DecodedWindow | null> {
  const builder = new WindowPcmBuilder(window);
  task.currentPcm = builder.pcm;
  const sink = new AudioSampleSink(audioTrack);
  const startSeconds = window.sourceStartMs / 1_000;
  const endSeconds = window.sourceEndMs / 1_000;

  try {
    for await (const sample of sink.samples(startSeconds, endSeconds)) {
      try {
        if (task.cancelled) {
          releaseCurrentPcm(task, builder.pcm);
          return null;
        }
        builder.consume(sample);
      } finally {
        sample.close();
      }
    }
  } catch (cause) {
    releaseCurrentPcm(task, builder.pcm);
    if (task.cancelled) {
      return null;
    }
    if (isUnsupportedAudioCodecError(cause)) {
      throw new CandidateFailure(
        "UNSUPPORTED_AUDIO_CODEC",
        "이 브라우저에서 영상의 오디오 코덱을 읽을 수 없어요.",
      );
    }
    throw new CandidateFailure(
      "AUDIO_DECODE_FAILED",
      "이 후보의 오디오 구간을 읽는 중 문제가 생겼어요.",
    );
  }

  if (task.cancelled) {
    releaseCurrentPcm(task, builder.pcm);
    return null;
  }
  const decoded = builder.finish();
  if (decoded.decodedOverlapFrameCount === 0) {
    releaseCurrentPcm(task, decoded.pcm);
    throw new CandidateFailure(
      "EMPTY_AUDIO",
      "이 후보 구간에서 읽을 수 있는 오디오를 찾지 못했어요.",
    );
  }
  return decoded;
}

function disposeTensorGraph(
  value: unknown,
  disposed: Set<unknown>,
): void {
  if (value === null || value === undefined || disposed.has(value)) {
    return;
  }
  if (value instanceof Tensor) {
    disposed.add(value);
    try {
      value.dispose();
    } catch {
      // Tensor cleanup must not turn a candidate result into a Worker failure.
    }
    return;
  }
  if (typeof value !== "object") {
    return;
  }
  disposed.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry) => disposeTensorGraph(entry, disposed));
    return;
  }
  Object.values(value).forEach((entry) => disposeTensorGraph(entry, disposed));
}

function sigmoidScoresFromModelOutput(output: unknown): Float32Array {
  if (!isRecord(output) || !(output.logits instanceof Tensor)) {
    throw new CandidateFailure(
      "CLASSIFICATION_FAILED",
      "오디오 반응 모델의 출력 형식을 확인하지 못했어요.",
    );
  }
  const logits = output.logits;
  if (
    logits.size !== CANDIDATE_AUDIO_EVENT_AUDIOSET_LABEL_COUNT ||
    logits.dims.length !== 2 ||
    logits.dims[0] !== 1 ||
    logits.dims[1] !== CANDIDATE_AUDIO_EVENT_AUDIOSET_LABEL_COUNT
  ) {
    throw new CandidateFailure(
      "CLASSIFICATION_FAILED",
      "오디오 반응 모델의 라벨 구성이 고정된 설정과 달라요.",
    );
  }

  const probabilities = logits.sigmoid();
  try {
    const probabilityData: unknown = probabilities.data;
    if (
      probabilities.size !== CANDIDATE_AUDIO_EVENT_AUDIOSET_LABEL_COUNT ||
      !(probabilityData instanceof Float32Array) ||
      probabilityData.length !== CANDIDATE_AUDIO_EVENT_AUDIOSET_LABEL_COUNT
    ) {
      throw new CandidateFailure(
        "CLASSIFICATION_FAILED",
        "오디오 반응 모델의 점수 개수가 올바르지 않아요.",
      );
    }
    const scores = new Float32Array(CANDIDATE_AUDIO_EVENT_AUDIOSET_LABEL_COUNT);
    for (let index = 0; index < scores.length; index += 1) {
      const value = probabilityData[index];
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 1
      ) {
        scores.fill(0);
        throw new CandidateFailure(
          "CLASSIFICATION_FAILED",
          "오디오 반응 모델이 올바른 sigmoid 점수를 만들지 못했어요.",
        );
      }
      scores[index] = value;
    }
    return scores;
  } finally {
    try {
      probabilities.dispose();
    } catch {
      // The raw sigmoid tensor never leaves the Worker and is best-effort freed.
    }
  }
}

async function classifyWindow(
  processor: Processor,
  model: PreTrainedModel,
  pcm: Float32Array,
  task: ActiveTask,
): Promise<Float32Array | null> {
  let inputs: unknown = null;
  let output: unknown = null;
  try {
    inputs = await processor(pcm);
    if (task.cancelled) {
      return null;
    }
    output = await model(inputs);
    if (task.cancelled) {
      return null;
    }
    return sigmoidScoresFromModelOutput(output);
  } catch (cause) {
    if (task.cancelled) {
      return null;
    }
    if (cause instanceof CandidateFailure) {
      throw cause;
    }
    throw new CandidateFailure(
      "CLASSIFICATION_FAILED",
      "이 후보의 오디오 반응을 분류하는 중 문제가 생겼어요.",
    );
  } finally {
    const disposed = new Set<unknown>();
    disposeTensorGraph(output, disposed);
    disposeTensorGraph(inputs, disposed);
  }
}

async function analyzeCandidate(
  audioTrack: InputAudioTrack,
  target: CandidateAudioEventTarget,
  candidateOrdinal: number,
  targetCount: number,
  task: ActiveTask,
): Promise<boolean> {
  const processor = task.processor;
  const model = task.model;
  if (processor === null || model === null) {
    throw new ModelLoadFailure();
  }

  const windows = buildCandidateAudioEventWindows([target]);
  const windowScores: CandidateAudioEventWindowScores[] = [];
  let audibleWindowCount = 0;
  let classifyingStarted = false;
  let lastProgressRatio = 0;

  postCandidateProgress(task.identity, {
    candidateId: target.candidateId,
    candidateOrdinal,
    targetCount,
    stage: "decoding",
    ratio: 0,
  });

  try {
    for (let index = 0; index < windows.length; index += 1) {
      if (task.cancelled) {
        return false;
      }
      const window = windows[index];
      if (window === undefined) {
        continue;
      }

      let pcm: Float32Array | null = null;
      let scores: Float32Array | null = null;
      try {
        const decoded = await decodeWindow(audioTrack, window, task);
        if (task.cancelled || decoded === null) {
          return false;
        }
        pcm = decoded.pcm;

        const gate = summarizeCandidatePassBAudioGate(
          pcm,
          CANDIDATE_AUDIO_EVENT_SAMPLE_RATE_HZ,
        );
        if (gate.audible) {
          audibleWindowCount += 1;
          if (!classifyingStarted) {
            classifyingStarted = true;
            lastProgressRatio = Math.max(
              lastProgressRatio,
              CANDIDATE_DECODE_RATIO_CEILING +
                (index / windows.length) *
                  (CANDIDATE_CLASSIFY_RATIO_CEILING -
                    CANDIDATE_DECODE_RATIO_CEILING),
            );
            postCandidateProgress(task.identity, {
              candidateId: target.candidateId,
              candidateOrdinal,
              targetCount,
              stage: "classifying",
              ratio: round(lastProgressRatio),
            });
          }
          scores = await classifyWindow(processor, model, pcm, task);
          if (task.cancelled || scores === null) {
            return false;
          }
        } else {
          // A conservative sustained-audio gate suppresses digital silence and
          // isolated clicks. A zero vector keeps the core's exact window set
          // without asking the model to invent labels for an inaudible window.
          scores = new Float32Array(CANDIDATE_AUDIO_EVENT_AUDIOSET_LABEL_COUNT);
        }

        windowScores.push({ window, sigmoidScores: scores });
        scores = null;
        const completedWindowRatio =
          classifyingStarted
            ? CANDIDATE_DECODE_RATIO_CEILING +
              ((index + 1) / windows.length) *
                (CANDIDATE_CLASSIFY_RATIO_CEILING -
                  CANDIDATE_DECODE_RATIO_CEILING)
            : ((index + 1) / windows.length) *
              CANDIDATE_DECODE_RATIO_CEILING;
        lastProgressRatio = Math.max(lastProgressRatio, completedWindowRatio);
        postCandidateProgress(task.identity, {
          candidateId: target.candidateId,
          candidateOrdinal,
          targetCount,
          stage: classifyingStarted ? "classifying" : "decoding",
          ratio: round(lastProgressRatio),
        });
      } finally {
        if (scores !== null) {
          scores.fill(0);
        }
        if (pcm !== null) {
          releaseCurrentPcm(task, pcm);
          pcm = null;
        }
      }
    }

    if (task.cancelled) {
      return false;
    }
    if (audibleWindowCount === 0) {
      throw new CandidateFailure(
        "EMPTY_AUDIO",
        "이 후보의 세 구간에서 이어지는 오디오 반응을 찾지 못했어요.",
      );
    }

    let aggregation;
    try {
      aggregation = aggregateCandidateAudioEventScores(target, windowScores);
    } catch {
      throw new CandidateFailure(
        "CLASSIFICATION_FAILED",
        "이 후보의 오디오 반응 결과를 정리하지 못했어요.",
      );
    }
    if (task.cancelled) {
      return false;
    }
    postCandidateProgress(task.identity, {
      candidateId: target.candidateId,
      candidateOrdinal,
      targetCount,
      stage: "complete",
      ratio: 1,
    });
    postResponse(task.identity, {
      type: "candidate-audio-event-partial-result",
      result: aggregation.result,
    });
    return true;
  } finally {
    for (const entry of windowScores) {
      if (entry.sigmoidScores instanceof Float32Array) {
        entry.sigmoidScores.fill(0);
      }
    }
    windowScores.length = 0;
  }
}

async function openAudioTrack(
  request: AnalyzeRequest,
  task: ActiveTask,
): Promise<InputAudioTrack | null> {
  task.input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(request.file, { maxCacheSize: SOURCE_CACHE_BYTES }),
  });
  if (task.cancelled) {
    disposeInputOnce(task);
    return null;
  }
  return task.input.getPrimaryAudioTrack();
}

async function runTask(request: AnalyzeRequest, task: ActiveTask): Promise<void> {
  try {
    let audioTrack: InputAudioTrack | null;
    try {
      audioTrack = await openAudioTrack(request, task);
    } catch (cause) {
      if (task.cancelled) {
        return;
      }
      await cleanupTaskResources(task);
      if (cause instanceof UnsupportedInputFormatError) {
        postAllTargetsAsGaps(
          request,
          "UNSUPPORTED_CONTAINER",
          "이 영상 형식은 현재 브라우저에서 읽을 수 없어요.",
        );
        return;
      }
      const unsupportedCodec = isUnsupportedAudioCodecError(cause);
      postAllTargetsAsGaps(
        request,
        unsupportedCodec ? "UNSUPPORTED_AUDIO_CODEC" : "AUDIO_DECODE_FAILED",
        unsupportedCodec
          ? "이 브라우저에서 영상의 오디오 코덱을 읽을 수 없어요."
          : "영상의 오디오 트랙을 여는 중 문제가 생겼어요.",
      );
      return;
    }

    if (task.cancelled) {
      return;
    }
    if (audioTrack === null) {
      await cleanupTaskResources(task);
      postAllTargetsAsGaps(
        request,
        "NO_AUDIO_TRACK",
        "영상에서 분석할 오디오 트랙을 찾지 못했어요.",
      );
      return;
    }
    try {
      if (!(await audioTrack.canDecode())) {
        await cleanupTaskResources(task);
        postAllTargetsAsGaps(
          request,
          "UNSUPPORTED_AUDIO_CODEC",
          "이 브라우저에서 영상의 오디오 코덱을 읽을 수 없어요.",
        );
        return;
      }
    } catch {
      if (task.cancelled) {
        return;
      }
      await cleanupTaskResources(task);
      postAllTargetsAsGaps(
        request,
        "UNSUPPORTED_AUDIO_CODEC",
        "이 브라우저에서 영상의 오디오 코덱을 읽을 수 없어요.",
      );
      return;
    }

    const loaded = await loadModelArtifacts(task);
    if (task.cancelled || !loaded) {
      return;
    }

    let completedCount = 0;
    let gapCount = 0;
    for (let index = 0; index < request.targets.length; index += 1) {
      if (task.cancelled) {
        return;
      }
      const target = request.targets[index];
      if (target === undefined) {
        continue;
      }
      try {
        const completed = await analyzeCandidate(
          audioTrack,
          target,
          index + 1,
          request.targets.length,
          task,
        );
        if (task.cancelled || !completed) {
          return;
        }
        completedCount += 1;
      } catch (cause) {
        if (task.cancelled) {
          return;
        }
        if (cause instanceof ModelLoadFailure) {
          throw cause;
        }
        const failure =
          cause instanceof CandidateFailure
            ? cause
            : new CandidateFailure(
                "CLASSIFICATION_FAILED",
                "이 후보의 오디오 반응을 분석하는 중 문제가 생겼어요.",
              );
        postGap(
          task.identity,
          target,
          index + 1,
          request.targets.length,
          failure.reasonCode,
          failure.message,
        );
        gapCount += 1;
      }
    }

    await cleanupTaskResources(task);
    if (!task.cancelled) {
      postResponse(task.identity, {
        type: "candidate-audio-event-completed",
        summary: {
          requestedCount: request.targets.length,
          completedCount,
          gapCount,
        },
      });
    }
  } catch (cause) {
    await cleanupTaskResources(task);
    if (task.cancelled) {
      return;
    }
    postResponse(task.identity, {
      type: "candidate-audio-event-failed",
      reasonCode:
        cause instanceof ModelLoadFailure
          ? "MODEL_LOAD_FAILED"
          : "UNEXPECTED_WORKER_FAILURE",
      message:
        cause instanceof ModelLoadFailure
          ? "고정된 로컬 오디오 반응 모델을 불러오지 못했어요."
          : "오디오 반응 분석 작업이 예기치 않게 멈췄어요.",
    });
  } finally {
    await cleanupTaskResources(task);
    if (activeTask === task) {
      activeTask = null;
    }
  }
}

function postCancelAcknowledgement(
  identity: CandidateAudioEventWorkerIdentity,
): void {
  postResponse(identity, {
    type: "candidate-audio-event-cancel-acknowledged",
  });
}

async function acknowledgeAfterLoadedModelCleanup(
  task: ActiveTask,
  identity: CandidateAudioEventWorkerIdentity,
): Promise<void> {
  try {
    await task.completion;
  } catch {
    // runTask owns the user-facing failure path; cancellation still needs ACK.
  }
  await cleanupTaskResources(task);
  postCancelAcknowledgement(identity);
}

function handleCancel(request: CancelRequest): void {
  const task = activeTask;
  if (task !== null && sameIdentity(task.identity, request.identity)) {
    task.cancelled = true;
    if (task.currentPcm !== null) {
      releaseCurrentPcm(task, task.currentPcm);
    }
    disposeInputOnce(task);
    if (task.modelWasLoaded) {
      void acknowledgeAfterLoadedModelCleanup(task, request.identity);
      return;
    }
    // A model that has not finished loading has no live ONNX session to
    // release. Clear the processor reference before ACK; client termination
    // then aborts the outstanding immutable model fetch.
    task.processor = null;
  }
  postCancelAcknowledgement(request.identity);
}

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (isValidCancelRequest(request)) {
    handleCancel(request);
    return;
  }
  if (!isRecord(request)) {
    return;
  }
  if (request.type === "candidate-audio-event-cancel") {
    if (isValidIdentity(request.identity)) {
      postResponse(request.identity, {
        type: "candidate-audio-event-failed",
        reasonCode: "INVALID_REQUEST",
        message: "오디오 반응 분석 취소 요청이 올바르지 않아요.",
      });
    }
    return;
  }
  if (request.type !== "candidate-audio-event-analyze") {
    if (isValidIdentity(request.identity)) {
      postResponse(request.identity, {
        type: "candidate-audio-event-failed",
        reasonCode: "INVALID_REQUEST",
        message: "알 수 없는 오디오 반응 분석 요청이에요.",
      });
    }
    return;
  }
  if (!isValidAnalyzeRequest(request)) {
    if (isValidIdentity(request.identity)) {
      postResponse(request.identity, {
        type: "candidate-audio-event-failed",
        reasonCode: "INVALID_REQUEST",
        message: "오디오 반응 분석 요청이 올바르지 않아요.",
      });
    }
    return;
  }
  if (activeTask !== null) {
    postResponse(request.identity, {
      type: "candidate-audio-event-failed",
      reasonCode: "WORKER_BUSY",
      message: "오디오 반응 분석 작업 공간이 이미 사용 중이에요.",
    });
    return;
  }

  const task: ActiveTask = {
    identity: request.identity,
    cancelled: false,
    input: null,
    inputWasDisposed: false,
    processor: null,
    model: null,
    modelWasLoaded: false,
    currentPcm: null,
    completion: null,
  };
  activeTask = task;
  const completion = runTask(request, task);
  task.completion = completion;
  void completion;
});

export {};
