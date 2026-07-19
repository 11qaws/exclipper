/// <reference lib="webworker" />

import {
  env,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
} from "@huggingface/transformers";
import {
  ALL_FORMATS,
  AudioSampleSink,
  BlobSource,
  Input,
  InputDisposedError,
  UnsupportedInputFormatError,
  type AudioSample,
  type InputAudioTrack,
} from "mediabunny";

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
  type CandidatePassBDevice,
  type CandidatePassBModelProgress,
  type CandidatePassBTarget,
  type CandidatePassBTranscriptResult,
  type CandidatePassBTranscriptSegment,
  type CandidatePassBWorkerIdentity,
  type CandidatePassBWorkerRequest,
  type CandidatePassBWorkerResponse,
  type CandidatePassBWorkerResponsePayload,
} from "./candidatePassBWorkerProtocol";
import { summarizeCandidatePassBAudioGate } from "./candidatePassBAudioGate";
import { CandidatePassBModelDownloadTracker } from "./candidatePassBModelDownloadProgress";

declare const self: DedicatedWorkerGlobalScope;

type AnalyzeRequest = Extract<
  CandidatePassBWorkerRequest,
  { readonly type: "candidate-pass-b-analyze" }
>;

const SOURCE_CACHE_BYTES = 8 * 1024 * 1024;
const MODEL_PROGRESS_RATIO_CEILING = 0.95;
const CANDIDATE_DECODE_RATIO_CEILING = 0.45;
const CANDIDATE_TRANSCRIBE_RATIO = 0.5;
const PROGRESS_MIN_INTERVAL_MS = 150;
const PROGRESS_MIN_RATIO_STEP = 0.01;
const MAX_TRANSCRIPT_TEXT_LENGTH = 20_000;
const MAX_TRANSCRIPT_SEGMENTS = 2_048;
const MAX_SEGMENT_TEXT_LENGTH = 2_000;
const BUNDLED_ORT_WASM_URL = new URL(
  "../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm",
  import.meta.url,
);

interface ActiveTask {
  readonly identity: CandidatePassBWorkerIdentity;
  cancelled: boolean;
  input: Input<BlobSource> | null;
  inputWasDisposed: boolean;
}

interface DecodedCandidate {
  readonly pcm: Float32Array;
  readonly decodedOverlapFrameCount: number;
}

class ModelLoadFailure extends Error {
  public constructor() {
    super("The local speech model could not be loaded.");
    this.name = "ModelLoadFailure";
  }
}

class CandidateFailure extends Error {
  public readonly reasonCode: CandidatePassBCandidateGapReason;

  public constructor(
    reasonCode: CandidatePassBCandidateGapReason,
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
  identity: CandidatePassBWorkerIdentity,
  response: CandidatePassBWorkerResponsePayload,
): void {
  const message = {
    ...identity,
    eventId: createEventId(identity.taskId),
    ...response,
  } satisfies CandidatePassBWorkerResponse;
  self.postMessage(message);
}

function postModelProgress(
  identity: CandidatePassBWorkerIdentity,
  progress: CandidatePassBModelProgress,
): void {
  postResponse(identity, {
    type: "candidate-pass-b-model-progress",
    progress,
  });
}

function postCandidateProgress(
  identity: CandidatePassBWorkerIdentity,
  progress: CandidatePassBCandidateProgress,
): void {
  postResponse(identity, {
    type: "candidate-pass-b-candidate-progress",
    progress,
  });
}

function sameIdentity(
  left: CandidatePassBWorkerIdentity,
  right: CandidatePassBWorkerIdentity,
): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.writerEpoch === right.writerEpoch &&
    left.analysisRunId === right.analysisRunId &&
    left.passBRunId === right.passBRunId &&
    left.workerEpoch === right.workerEpoch &&
    left.workerInstanceId === right.workerInstanceId &&
    left.taskId === right.taskId
  );
}

function disposeInputOnce(task: ActiveTask): void {
  if (task.input === null || task.inputWasDisposed) {
    return;
  }
  task.inputWasDisposed = true;
  try {
    task.input.dispose();
  } catch {
    // Cancellation and final cleanup remain best-effort. No source details are logged.
  }
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isValidIdentity(value: unknown): value is CandidatePassBWorkerIdentity {
  if (!isRecord(value) || !hasExactKeys(value, [
    "sessionId",
    "writerEpoch",
    "analysisRunId",
    "passBRunId",
    "workerEpoch",
    "workerInstanceId",
    "taskId",
  ])) {
    return false;
  }
  return (
    isNonEmptyString(value.sessionId) &&
    isNonNegativeSafeInteger(value.writerEpoch) &&
    isNonEmptyString(value.analysisRunId) &&
    isNonEmptyString(value.passBRunId) &&
    isNonNegativeSafeInteger(value.workerEpoch) &&
    isNonEmptyString(value.workerInstanceId) &&
    isNonEmptyString(value.taskId)
  );
}

function isValidTarget(
  value: unknown,
  sourceDurationMs: number,
): value is CandidatePassBTarget {
  if (!isRecord(value) || !hasExactKeys(value, ["candidateId", "startMs", "endMs"])) {
    return false;
  }
  return (
    isNonEmptyString(value.candidateId) &&
    isNonNegativeSafeInteger(value.startMs) &&
    isNonNegativeSafeInteger(value.endMs) &&
    value.endMs > value.startMs &&
    value.endMs <= sourceDurationMs &&
    value.endMs - value.startMs <=
      MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS
  );
}

function isValidAnalyzeRequest(value: unknown): value is AnalyzeRequest {
  if (!isRecord(value) || !hasExactKeys(value, [
    "type",
    "identity",
    "file",
    "sourceDurationMs",
    "device",
    "targets",
  ])) {
    return false;
  }
  if (
    value.type !== "candidate-pass-b-analyze" ||
    !isValidIdentity(value.identity) ||
    !(value.file instanceof File) ||
    !Number.isFinite(value.file.size) ||
    value.file.size < 0 ||
    !isNonNegativeSafeInteger(value.sourceDurationMs) ||
    value.sourceDurationMs <= 0 ||
    value.sourceDurationMs > MAX_CANDIDATE_PASS_B_SOURCE_DURATION_MS ||
    (value.device !== "webgpu" && value.device !== "wasm") ||
    !Array.isArray(value.targets) ||
    value.targets.length === 0 ||
    value.targets.length > MAX_CANDIDATE_PASS_B_TARGETS
  ) {
    return false;
  }
  const sourceDurationMs = value.sourceDurationMs;
  if (!value.targets.every((target) => isValidTarget(target, sourceDurationMs))) {
    return false;
  }
  const candidateIds = new Set(
    value.targets.map((target) => target.candidateId),
  );
  return candidateIds.size === value.targets.length;
}

function isValidCancelRequest(
  value: unknown,
): value is Extract<
  CandidatePassBWorkerRequest,
  { readonly type: "candidate-pass-b-cancel" }
> {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["type", "identity"]) &&
    value.type === "candidate-pass-b-cancel" &&
    isValidIdentity(value.identity)
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeText(value: unknown, maximumLength: number): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/gu, " ").trim().slice(0, maximumLength);
}

function candidateGap(
  target: CandidatePassBTarget,
  reasonCode: CandidatePassBCandidateGapReason,
  message: string,
): CandidatePassBCandidateGap {
  return {
    candidateId: target.candidateId,
    sourceStartMs: target.startMs,
    sourceEndMs: target.endMs,
    reasonCode,
    message,
  };
}

function postGap(
  identity: CandidatePassBWorkerIdentity,
  target: CandidatePassBTarget,
  candidateOrdinal: number,
  targetCount: number,
  reasonCode: CandidatePassBCandidateGapReason,
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
    type: "candidate-pass-b-candidate-gap",
    gap: candidateGap(target, reasonCode, message),
  });
}

function postAllTargetsAsGaps(
  request: AnalyzeRequest,
  reasonCode: CandidatePassBCandidateGapReason,
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
    type: "candidate-pass-b-completed",
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
}

async function loadTranscriber(
  task: ActiveTask,
  device: CandidatePassBDevice,
): Promise<AutomaticSpeechRecognitionPipeline | null> {
  const downloadTracker = new CandidatePassBModelDownloadTracker();
  let highestRatio = 0;
  let lastPostedAt = 0;
  postModelProgress(task.identity, {
    stage: "loading",
    ratio: 0,
    loadedBytes: null,
    totalBytes: null,
  });

  try {
    configureBundledOrtWasm();
    const transcriber = await pipeline(
      "automatic-speech-recognition",
      CANDIDATE_PASS_B_MODEL_ID,
      {
        revision: CANDIDATE_PASS_B_MODEL_REVISION,
        dtype: CANDIDATE_PASS_B_DTYPE,
        device,
        progress_callback: (rawProgress) => {
          if (task.cancelled) {
            return;
          }
          const progress = downloadTracker.update(rawProgress);
          if (progress === null) {
            return;
          }
          const nextRatio = Math.max(
            highestRatio,
            progress.ratio * MODEL_PROGRESS_RATIO_CEILING,
          );
          const now = Date.now();
          if (
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
            loadedBytes: progress.loadedBytes,
            totalBytes: progress.totalBytes,
          });
        },
      },
    );

    if (task.cancelled) {
      await transcriber.dispose();
      return null;
    }
    postModelProgress(task.identity, {
      stage: "ready",
      ratio: 1,
      loadedBytes: null,
      totalBytes: null,
    });
    return transcriber;
  } catch {
    if (task.cancelled) {
      return null;
    }
    throw new ModelLoadFailure();
  }
}

class CandidatePcmBuilder {
  private channelScratch = new Float32Array(0);
  private monoScratch = new Float32Array(0);
  private nextOutputFrame = 0;
  private decodedOverlapFrameCount = 0;

  public readonly pcm: Float32Array;

  public constructor(private readonly target: CandidatePassBTarget) {
    const durationSeconds = (target.endMs - target.startMs) / 1_000;
    this.pcm = new Float32Array(
      Math.max(1, Math.ceil(durationSeconds * CANDIDATE_PASS_B_SAMPLE_RATE_HZ)),
    );
  }

  public consume(sample: AudioSample): void {
    if (
      sample.numberOfFrames <= 0 ||
      sample.numberOfChannels <= 0 ||
      sample.sampleRate <= 0
    ) {
      return;
    }

    const targetStartSeconds = this.target.startMs / 1_000;
    const targetEndSeconds = this.target.endMs / 1_000;
    const sampleStartSeconds = sample.timestamp;
    const sampleEndSeconds = sample.timestamp + sample.duration;
    const overlapStartSeconds = Math.max(targetStartSeconds, sampleStartSeconds);
    const overlapEndSeconds = Math.min(targetEndSeconds, sampleEndSeconds);
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
        const value = channel[frameIndex] ?? 0;
        mono[frameIndex] =
          (mono[frameIndex] ?? 0) +
          (Number.isFinite(value) ? value : 0) / sample.numberOfChannels;
      }
    }

    const firstOutputFrame = clampInteger(
      Math.ceil(
        (Math.max(sampleStartSeconds, targetStartSeconds) - targetStartSeconds) *
          CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
      ),
      0,
      this.pcm.length,
    );
    const lastOutputFrameExclusive = clampInteger(
      Math.ceil(
        (Math.min(sampleEndSeconds, targetEndSeconds) - targetStartSeconds) *
          CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
      ),
      0,
      this.pcm.length,
    );
    this.nextOutputFrame = Math.max(this.nextOutputFrame, firstOutputFrame);

    while (this.nextOutputFrame < lastOutputFrameExclusive) {
      const outputTimestampSeconds =
        targetStartSeconds +
        this.nextOutputFrame / CANDIDATE_PASS_B_SAMPLE_RATE_HZ;
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

  public finish(): DecodedCandidate {
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

async function decodeCandidate(
  audioTrack: InputAudioTrack,
  target: CandidatePassBTarget,
  candidateOrdinal: number,
  targetCount: number,
  task: ActiveTask,
): Promise<DecodedCandidate | null> {
  const builder = new CandidatePcmBuilder(target);
  const sink = new AudioSampleSink(audioTrack);
  const targetStartSeconds = target.startMs / 1_000;
  const targetEndSeconds = target.endMs / 1_000;
  let lastRatio = 0;
  let lastPostedAt = 0;

  postCandidateProgress(task.identity, {
    candidateId: target.candidateId,
    candidateOrdinal,
    targetCount,
    stage: "decoding",
    ratio: 0,
  });

  try {
    for await (const sample of sink.samples(targetStartSeconds, targetEndSeconds)) {
      try {
        if (task.cancelled) {
          builder.pcm.fill(0);
          return null;
        }
        builder.consume(sample);
        const decodedThroughSeconds = clamp(
          sample.timestamp + sample.duration,
          targetStartSeconds,
          targetEndSeconds,
        );
        const rangeRatio =
          (decodedThroughSeconds - targetStartSeconds) /
          (targetEndSeconds - targetStartSeconds);
        const nextRatio = clamp(
          rangeRatio * CANDIDATE_DECODE_RATIO_CEILING,
          0,
          CANDIDATE_DECODE_RATIO_CEILING,
        );
        const now = Date.now();
        if (
          nextRatio > lastRatio &&
          (nextRatio - lastRatio >= PROGRESS_MIN_RATIO_STEP ||
            now - lastPostedAt >= PROGRESS_MIN_INTERVAL_MS)
        ) {
          lastRatio = nextRatio;
          lastPostedAt = now;
          postCandidateProgress(task.identity, {
            candidateId: target.candidateId,
            candidateOrdinal,
            targetCount,
            stage: "decoding",
            ratio: round(nextRatio),
          });
        }
      } finally {
        sample.close();
      }
    }
  } catch (cause) {
    if (task.cancelled || cause instanceof InputDisposedError) {
      builder.pcm.fill(0);
      return null;
    }
    builder.pcm.fill(0);
    if (isUnsupportedAudioCodecError(cause)) {
      throw new CandidateFailure(
        "UNSUPPORTED_AUDIO_CODEC",
        "이 브라우저에서 이 영상의 오디오 코덱을 읽을 수 없어요.",
      );
    }
    throw new CandidateFailure(
      "AUDIO_DECODE_FAILED",
      "이 후보 구간의 오디오를 읽는 중 문제가 생겼어요.",
    );
  }

  if (task.cancelled) {
    builder.pcm.fill(0);
    return null;
  }
  const decoded = builder.finish();
  if (decoded.decodedOverlapFrameCount === 0) {
    decoded.pcm.fill(0);
    throw new CandidateFailure(
      "EMPTY_AUDIO",
      "이 후보 구간에서 읽을 수 있는 오디오를 찾지 못했어요.",
    );
  }
  return decoded;
}

function parseTranscript(
  rawResult: unknown,
  target: CandidatePassBTarget,
  device: CandidatePassBDevice,
): CandidatePassBTranscriptResult {
  if (!isRecord(rawResult) || typeof rawResult.text !== "string") {
    throw new CandidateFailure(
      "TRANSCRIPTION_FAILED",
      "이 후보 구간의 말을 글로 바꾸지 못했어요.",
    );
  }

  const segments: CandidatePassBTranscriptSegment[] = [];
  if (Array.isArray(rawResult.chunks)) {
    for (const chunk of rawResult.chunks.slice(0, MAX_TRANSCRIPT_SEGMENTS)) {
      if (!isRecord(chunk) || !Array.isArray(chunk.timestamp)) {
        continue;
      }
      const timestamps: readonly unknown[] = chunk.timestamp;
      const relativeStartSeconds = timestamps[0];
      const rawRelativeEndSeconds = timestamps[1];
      const relativeEndSeconds =
        rawRelativeEndSeconds === null
          ? (target.endMs - target.startMs) / 1_000
          : rawRelativeEndSeconds;
      if (
        typeof relativeStartSeconds !== "number" ||
        !Number.isFinite(relativeStartSeconds) ||
        typeof relativeEndSeconds !== "number" ||
        !Number.isFinite(relativeEndSeconds) ||
        relativeEndSeconds < relativeStartSeconds
      ) {
        continue;
      }
      const startMs = clampInteger(
        target.startMs + relativeStartSeconds * 1_000,
        target.startMs,
        target.endMs,
      );
      const endMs = clampInteger(
        target.startMs + relativeEndSeconds * 1_000,
        startMs,
        target.endMs,
      );
      segments.push({
        startMs,
        endMs,
        text: normalizeText(chunk.text, MAX_SEGMENT_TEXT_LENGTH),
      });
    }
  }
  segments.sort((left, right) =>
    left.startMs - right.startMs || left.endMs - right.endMs,
  );

  return {
    mode: "candidate-pass-b-transcript",
    candidateId: target.candidateId,
    sourceStartMs: target.startMs,
    sourceEndMs: target.endMs,
    text: normalizeText(rawResult.text, MAX_TRANSCRIPT_TEXT_LENGTH),
    segments,
    model: {
      id: CANDIDATE_PASS_B_MODEL_ID,
      revision: CANDIDATE_PASS_B_MODEL_REVISION,
      dtype: CANDIDATE_PASS_B_DTYPE,
      device,
    },
    language: CANDIDATE_PASS_B_LANGUAGE,
    task: CANDIDATE_PASS_B_TASK,
    sampleRateHz: CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  };
}

async function transcribeCandidate(
  transcriber: AutomaticSpeechRecognitionPipeline,
  pcm: Float32Array,
  target: CandidatePassBTarget,
  device: CandidatePassBDevice,
): Promise<CandidatePassBTranscriptResult> {
  try {
    const rawResult = await transcriber(pcm, {
      language: CANDIDATE_PASS_B_LANGUAGE,
      task: CANDIDATE_PASS_B_TASK,
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    return parseTranscript(rawResult, target, device);
  } catch (cause) {
    if (cause instanceof CandidateFailure) {
      throw cause;
    }
    throw new CandidateFailure(
      "TRANSCRIPTION_FAILED",
      "이 후보 구간의 말을 글로 바꾸지 못했어요.",
    );
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
    return null;
  }
  return task.input.getPrimaryAudioTrack();
}

async function runTask(request: AnalyzeRequest, task: ActiveTask): Promise<void> {
  let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
  try {
    let audioTrack: InputAudioTrack | null;
    try {
      audioTrack = await openAudioTrack(request, task);
    } catch (cause) {
      if (task.cancelled || cause instanceof InputDisposedError) {
        return;
      }
      if (cause instanceof UnsupportedInputFormatError) {
        postAllTargetsAsGaps(
          request,
          "UNSUPPORTED_CONTAINER",
          "이 영상 형식은 현재 브라우저에서 읽을 수 없어요.",
        );
        return;
      }
      postAllTargetsAsGaps(
        request,
        isUnsupportedAudioCodecError(cause)
          ? "UNSUPPORTED_AUDIO_CODEC"
          : "AUDIO_DECODE_FAILED",
        isUnsupportedAudioCodecError(cause)
          ? "이 브라우저에서 이 영상의 오디오 코덱을 읽을 수 없어요."
          : "영상의 오디오를 여는 중 문제가 생겼어요.",
      );
      return;
    }

    if (task.cancelled) {
      return;
    }
    if (audioTrack === null) {
      postAllTargetsAsGaps(
        request,
        "NO_AUDIO_TRACK",
        "이 영상에는 분석할 오디오 트랙이 없어요.",
      );
      return;
    }
    try {
      if (!(await audioTrack.canDecode())) {
        postAllTargetsAsGaps(
          request,
          "UNSUPPORTED_AUDIO_CODEC",
          "이 브라우저에서 이 영상의 오디오 코덱을 읽을 수 없어요.",
        );
        return;
      }
    } catch (cause) {
      if (task.cancelled || cause instanceof InputDisposedError) {
        return;
      }
      postAllTargetsAsGaps(
        request,
        "UNSUPPORTED_AUDIO_CODEC",
        "이 브라우저에서 이 영상의 오디오 코덱을 읽을 수 없어요.",
      );
      return;
    }

    transcriber = await loadTranscriber(task, request.device);
    if (task.cancelled || transcriber === null) {
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
      const candidateOrdinal = index + 1;
      let candidatePcm: Float32Array | null = null;
      try {
        const decoded = await decodeCandidate(
          audioTrack,
          target,
          candidateOrdinal,
          request.targets.length,
          task,
        );
        if (task.cancelled || decoded === null) {
          return;
        }
        candidatePcm = decoded.pcm;
        if (
          !summarizeCandidatePassBAudioGate(
            candidatePcm,
            CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
          ).audible
        ) {
          throw new CandidateFailure(
            "EMPTY_AUDIO",
            "이 후보 구간에서 이어지는 말소리 단서를 찾지 못했어요.",
          );
        }
        postCandidateProgress(task.identity, {
          candidateId: target.candidateId,
          candidateOrdinal,
          targetCount: request.targets.length,
          stage: "transcribing",
          ratio: CANDIDATE_TRANSCRIBE_RATIO,
        });
        const result = await transcribeCandidate(
          transcriber,
          candidatePcm,
          target,
          request.device,
        );
        if (task.cancelled) {
          return;
        }
        postCandidateProgress(task.identity, {
          candidateId: target.candidateId,
          candidateOrdinal,
          targetCount: request.targets.length,
          stage: "complete",
          ratio: 1,
        });
        postResponse(task.identity, {
          type: "candidate-pass-b-partial-result",
          result,
        });
        completedCount += 1;
      } catch (cause) {
        if (task.cancelled || cause instanceof InputDisposedError) {
          return;
        }
        const failure =
          cause instanceof CandidateFailure
            ? cause
            : new CandidateFailure(
                "TRANSCRIPTION_FAILED",
                "이 후보 구간을 정밀 분석하는 중 문제가 생겼어요.",
              );
        postGap(
          task.identity,
          target,
          candidateOrdinal,
          request.targets.length,
          failure.reasonCode,
          failure.message,
        );
        gapCount += 1;
      } finally {
        if (candidatePcm !== null) {
          candidatePcm.fill(0);
          candidatePcm = null;
        }
      }
    }

    if (!task.cancelled) {
      postResponse(task.identity, {
        type: "candidate-pass-b-completed",
        summary: {
          requestedCount: request.targets.length,
          completedCount,
          gapCount,
        },
      });
    }
  } catch (cause) {
    if (task.cancelled || cause instanceof InputDisposedError) {
      return;
    }
    postResponse(task.identity, {
      type: "candidate-pass-b-failed",
      reasonCode:
        cause instanceof ModelLoadFailure
          ? "MODEL_LOAD_FAILED"
          : "UNEXPECTED_WORKER_FAILURE",
      message:
        cause instanceof ModelLoadFailure
          ? "로컬 음성 인식 모델을 불러오지 못했어요."
          : "후보 정밀 분석 작업이 예기치 않게 멈췄어요.",
    });
  } finally {
    disposeInputOnce(task);
    if (transcriber !== null) {
      try {
        await transcriber.dispose();
      } catch {
        // The Worker is terminated by the client after its terminal event.
      }
    }
    if (activeTask === task) {
      activeTask = null;
    }
  }
}

function handleCancel(
  request: Extract<
    CandidatePassBWorkerRequest,
    { readonly type: "candidate-pass-b-cancel" }
  >,
): void {
  const task = activeTask;
  if (task !== null && sameIdentity(task.identity, request.identity)) {
    task.cancelled = true;
    disposeInputOnce(task);
  }
  postResponse(request.identity, {
    type: "candidate-pass-b-cancel-acknowledged",
  });
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

function nextPowerOfTwo(value: number): number {
  let capacity = 1;
  const target = Math.max(1, Math.ceil(value));
  while (capacity < target) {
    capacity *= 2;
  }
  return capacity;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (isValidCancelRequest(request)) {
    handleCancel(request);
    return;
  }
  if (!isRecord(request) || request.type !== "candidate-pass-b-analyze") {
    return;
  }
  if (!isValidAnalyzeRequest(request)) {
    if (isValidIdentity(request.identity)) {
      postResponse(request.identity, {
        type: "candidate-pass-b-failed",
        reasonCode: "INVALID_REQUEST",
        message: "후보 정밀 분석 요청이 올바르지 않아요.",
      });
    }
    return;
  }
  if (activeTask !== null) {
    postResponse(request.identity, {
      type: "candidate-pass-b-failed",
      reasonCode: "WORKER_BUSY",
      message: "후보 정밀 분석 작업 공간이 이미 사용 중이에요.",
    });
    return;
  }

  const task: ActiveTask = {
    identity: request.identity,
    cancelled: false,
    input: null,
    inputWasDisposed: false,
  };
  activeTask = task;
  void runTask(request, task);
});

export {};
