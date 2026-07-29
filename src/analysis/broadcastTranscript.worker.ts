/// <reference lib="webworker" />

import {
  AutoModelForAudioFrameClassification,
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
  InputDisposedError,
  UnsupportedInputFormatError,
  type AudioSample,
  type InputAudioTrack,
} from "mediabunny";
import {
  encodeCandidatePassBPcm16Wav,
} from "./candidatePassBGemini";
import { CANDIDATE_PASS_B_SAMPLE_RATE_HZ } from "./candidatePassBWorkerProtocol";
import {
  MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS,
} from "./broadcastTranscriptQwen";
import {
  BROADCAST_SPEECH_ACTIVITY_INPUT_SAMPLE_COUNT,
  BROADCAST_SPEECH_ACTIVITY_MODEL_DTYPE,
  BROADCAST_SPEECH_ACTIVITY_MODEL_ID,
  BROADCAST_SPEECH_ACTIVITY_MODEL_REVISION,
  BROADCAST_SPEECH_ACTIVITY_OUTPUT_CLASS_COUNT,
  BROADCAST_SPEECH_ACTIVITY_SAMPLE_RATE_HZ,
  broadcastSpeechActivityCanSkipAsr,
  createBroadcastSpeechActivityPlan,
  createBroadcastSpeechActivityRunReceipt,
  postprocessBroadcastSpeechActivityLogits,
  type BroadcastSpeechActivityCellReceipt,
  type BroadcastSpeechActivityRunReceipt,
} from "./broadcastSpeechActivity";
import type { BroadcastContextTranscriptionChunk } from "./broadcastContextSamplingPlan";
import {
  BroadcastTranscriptQwenClientError,
  requestBroadcastTranscriptChunkBinary,
} from "./broadcastTranscriptQwenClient";
import {
  isBroadcastTranscriptRouteSelection,
  verifyBroadcastTranscriptRouteSelection,
} from "./broadcastTranscriptRouteManifest";
import {
  AdaptiveConcurrency,
  requestSpacingMs,
  startAfterRequestSpacing,
  waitForAdaptiveConcurrencyCapacity,
} from "./adaptiveConcurrency";
import {
  isAiQuotaOpaqueId,
  isAiQuotaParticipantId,
} from "./aiQuotaProtocol";
import {
  prioritizeAdjacentTranscriptChunks,
  shouldExpandBroadcastContextChunk,
} from "./broadcastContextExploration";
import { transcriptFragmentQuotaOperationId } from "./broadcastTranscriptFragmentRecovery";
import {
  MAX_BROADCAST_TRANSCRIPT_WORKER_CHUNKS,
  isBroadcastTranscriptChunkId,
  isBroadcastTranscriptQuotaOperationScope,
  type BroadcastTranscriptChunkGapReason,
  type BroadcastTranscriptWorkerIdentity,
  type BroadcastTranscriptWorkerRequest,
  type BroadcastTranscriptWorkerResponse,
} from "./broadcastTranscriptWorkerProtocol";

declare const self: DedicatedWorkerGlobalScope;

const MAX_SOURCE_DURATION_MS = 12 * 60 * 60_000;
const SOURCE_CACHE_BYTES = 8 * 1024 * 1024;
const BUNDLED_ORT_WASM_URL = new URL(
  "../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm",
  import.meta.url,
);

interface ActiveTask {
  readonly identity: BroadcastTranscriptWorkerIdentity;
  cancelled: boolean;
  input: Input<BlobSource> | null;
  readonly fetchControllers: Set<AbortController>;
  speechActivityProcessor: Processor | null;
  speechActivityModel: PreTrainedModel | null;
  speechActivityUnavailable: boolean;
}


let activeTask: ActiveTask | null = null;

function post(response: BroadcastTranscriptWorkerResponse): void {
  self.postMessage(response);
}

function sameIdentity(
  left: BroadcastTranscriptWorkerIdentity,
  right: BroadcastTranscriptWorkerIdentity,
): boolean {
  return left.taskId === right.taskId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidIdentity(value: unknown): value is BroadcastTranscriptWorkerIdentity {
  return (
    isRecord(value) &&
    Object.keys(value).length === 1 &&
    typeof value.taskId === "string" &&
    value.taskId.length > 0 &&
    value.taskId.length <= 256
  );
}

function isValidAnalyzeRequest(
  value: unknown,
): value is Extract<
  BroadcastTranscriptWorkerRequest,
  { readonly type: "broadcast-transcript-analyze" }
> {
  if (
    !isRecord(value) ||
    value.type !== "broadcast-transcript-analyze" ||
    !isValidIdentity(value.identity) ||
    !isBroadcastTranscriptRouteSelection(value.route) ||
    !(value.file instanceof File) ||
    !Number.isSafeInteger(value.sourceDurationMs) ||
    (value.sourceDurationMs as number) <= 0 ||
    (value.sourceDurationMs as number) > MAX_SOURCE_DURATION_MS ||
    !Array.isArray(value.chunks) ||
    value.chunks.length === 0 ||
    value.chunks.length > MAX_BROADCAST_TRANSCRIPT_WORKER_CHUNKS
  ) {
    return false;
  }
  if (
    value.quota !== undefined &&
    (!isRecord(value.quota) ||
      ![3, 4, 5].includes(Object.keys(value.quota).length) ||
      !Object.keys(value.quota).every((key) =>
        [
          "participantId",
          "runId",
          "operationNamespace",
          "operationScope",
          "attemptOrdinal",
        ].includes(key),
      ) ||
      !isAiQuotaParticipantId(value.quota.participantId) ||
      !isAiQuotaOpaqueId(value.quota.runId) ||
      !["uniform", "event-boost", "refinement"].includes(
        value.quota.operationNamespace as string,
      ) ||
      (value.quota.operationScope !== undefined &&
        !isBroadcastTranscriptQuotaOperationScope(
          value.quota.operationScope,
        )) ||
      (value.quota.attemptOrdinal !== undefined &&
        (!Number.isSafeInteger(value.quota.attemptOrdinal) ||
          (value.quota.attemptOrdinal as number) < 0)))
  ) {
    return false;
  }
  const sourceDurationMs = value.sourceDurationMs as number;
  const chunkIds = new Set<string>();
  const validatedChunks: BroadcastContextTranscriptionChunk[] = [];
  for (const rawChunk of value.chunks as readonly unknown[]) {
    if (
      !isRecord(rawChunk) ||
      !isBroadcastTranscriptChunkId(rawChunk.chunkId) ||
      chunkIds.has(rawChunk.chunkId) ||
      !Number.isSafeInteger(rawChunk.sourceStartMs) ||
      !Number.isSafeInteger(rawChunk.sourceEndMs) ||
      (rawChunk.sourceStartMs as number) < 0 ||
      (rawChunk.sourceEndMs as number) <= (rawChunk.sourceStartMs as number) ||
      (rawChunk.sourceEndMs as number) > sourceDurationMs ||
      (rawChunk.sourceEndMs as number) - (rawChunk.sourceStartMs as number) >
        MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS ||
      typeof rawChunk.kind !== "string" ||
      !["uniform", "event", "uniform-and-event"].includes(rawChunk.kind)
    ) {
      return false;
    }
    chunkIds.add(rawChunk.chunkId);
    validatedChunks.push({
      chunkId: rawChunk.chunkId,
      sourceStartMs: rawChunk.sourceStartMs as number,
      sourceEndMs: rawChunk.sourceEndMs as number,
      kind: rawChunk.kind as BroadcastContextTranscriptionChunk["kind"],
    });
  }
  const chronological = [...validatedChunks].sort(
    (left, right) =>
      left.sourceStartMs - right.sourceStartMs ||
      left.sourceEndMs - right.sourceEndMs ||
      left.chunkId.localeCompare(right.chunkId),
  );
  let previousEndMs = -1;
  for (const chunk of chronological) {
    if (chunk.sourceStartMs < previousEndMs) return false;
    previousEndMs = chunk.sourceEndMs;
  }
  return true;
}

function isValidCancelRequest(
  value: unknown,
): value is Extract<
  BroadcastTranscriptWorkerRequest,
  { readonly type: "broadcast-transcript-cancel" }
> {
  return (
    isRecord(value) &&
    value.type === "broadcast-transcript-cancel" &&
    isValidIdentity(value.identity)
  );
}

function disposeTask(task: ActiveTask): void {
  for (const controller of task.fetchControllers) {
    controller.abort();
  }
  task.fetchControllers.clear();
  if (task.input !== null) {
    try {
      task.input.dispose();
    } catch {
      // Best-effort cleanup after cancellation or a decode failure.
    }
    task.input = null;
  }
}

async function disposeSpeechActivityArtifacts(task: ActiveTask): Promise<void> {
  const model = task.speechActivityModel;
  task.speechActivityModel = null;
  task.speechActivityProcessor = null;
  if (model === null) return;
  try {
    await model.dispose();
  } catch {
    // Worker termination is the final resource boundary; cleanup is best-effort.
  }
}

function configureBundledOrtWasm(): void {
  const wasm = env.backends.onnx.wasm;
  if (wasm === undefined) {
    throw new Error("The bundled ONNX WASM runtime is unavailable.");
  }
  wasm.wasmPaths = { wasm: BUNDLED_ORT_WASM_URL };
  wasm.numThreads = 1;
  wasm.proxy = false;
}

function assertPinnedSpeechActivityLabels(model: PreTrainedModel): void {
  const config: unknown = model.config;
  if (!isRecord(config) || !isRecord(config.id2label)) {
    throw new Error("The pinned speech-activity label map is unavailable.");
  }
  const id2label = config.id2label;
  if (
    config.num_labels !== undefined &&
    config.num_labels !== BROADCAST_SPEECH_ACTIVITY_OUTPUT_CLASS_COUNT
  ) {
    throw new Error("The pinned speech-activity class count changed.");
  }
  const expected = [
    "NO_SPEAKER",
    "SPEAKER_1",
    "SPEAKER_2",
    "SPEAKER_3",
    "SPEAKERS_1_AND_2",
    "SPEAKERS_1_AND_3",
    "SPEAKERS_2_AND_3",
  ] as const;
  if (
    Object.keys(id2label).length !== expected.length ||
    expected.some(
      (label, classId) => id2label[String(classId)] !== label,
    )
  ) {
    throw new Error("The pinned speech-activity label order changed.");
  }
}

/**
 * Loads the immutable VAD model at the first decoded audio fragment. A failed
 * load is remembered for this task so every later fragment goes directly to
 * ASR instead of repeatedly stalling on the same unavailable model.
 */
async function loadSpeechActivityArtifacts(task: ActiveTask): Promise<boolean> {
  if (
    task.speechActivityProcessor !== null &&
    task.speechActivityModel !== null
  ) {
    return true;
  }
  if (task.speechActivityUnavailable || task.cancelled) {
    return false;
  }
  try {
    configureBundledOrtWasm();
    const processor = await AutoProcessor.from_pretrained(
      BROADCAST_SPEECH_ACTIVITY_MODEL_ID,
      {
        revision: BROADCAST_SPEECH_ACTIVITY_MODEL_REVISION,
      },
    );
    if (task.cancelled) return false;
    const model =
      await AutoModelForAudioFrameClassification.from_pretrained(
        BROADCAST_SPEECH_ACTIVITY_MODEL_ID,
        {
          revision: BROADCAST_SPEECH_ACTIVITY_MODEL_REVISION,
          dtype: BROADCAST_SPEECH_ACTIVITY_MODEL_DTYPE,
          device: "wasm",
        },
      );
    if (task.cancelled) {
      try {
        await model.dispose();
      } catch {
        // The worker may be terminated immediately after cancellation.
      }
      return false;
    }
    task.speechActivityProcessor = processor;
    task.speechActivityModel = model;
    assertPinnedSpeechActivityLabels(model);
    return true;
  } catch {
    task.speechActivityUnavailable = true;
    await disposeSpeechActivityArtifacts(task);
    return false;
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

class PcmRangeBuilder {
  private channelScratch = new Float32Array(0);
  private monoScratch = new Float32Array(0);
  private nextOutputFrame = 0;
  private overlapFrames = 0;
  private writtenOutputFrameCount = 0;
  public readonly pcm: Float32Array;

  public constructor(
    private readonly startMs: number,
    private readonly endMs: number,
  ) {
    this.pcm = new Float32Array(
      Math.ceil(((endMs - startMs) / 1_000) * CANDIDATE_PASS_B_SAMPLE_RATE_HZ),
    );
  }

  public consume(sample: AudioSample): void {
    if (sample.numberOfFrames <= 0 || sample.numberOfChannels <= 0) return;
    const targetStartSeconds = this.startMs / 1_000;
    const targetEndSeconds = this.endMs / 1_000;
    const overlapStart = Math.max(targetStartSeconds, sample.timestamp);
    const overlapEnd = Math.min(
      targetEndSeconds,
      sample.timestamp + sample.duration,
    );
    if (overlapEnd <= overlapStart) return;
    this.overlapFrames += Math.max(
      1,
      Math.floor((overlapEnd - overlapStart) * sample.sampleRate),
    );
    this.ensureScratch(sample.numberOfFrames);
    const channel = this.channelScratch.subarray(0, sample.numberOfFrames);
    const mono = this.monoScratch.subarray(0, sample.numberOfFrames);
    mono.fill(0);
    for (let channelIndex = 0; channelIndex < sample.numberOfChannels; channelIndex += 1) {
      sample.copyTo(channel, { planeIndex: channelIndex, format: "f32-planar" });
      for (let frameIndex = 0; frameIndex < sample.numberOfFrames; frameIndex += 1) {
        mono[frameIndex] =
          (mono[frameIndex] ?? 0) +
          (Number.isFinite(channel[frameIndex]) ? (channel[frameIndex] ?? 0) : 0) /
            sample.numberOfChannels;
      }
    }
    const firstOutput = Math.ceil(
      (overlapStart - targetStartSeconds) * CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
    );
    const lastOutput = Math.min(
      this.pcm.length,
      Math.ceil(
        (overlapEnd - targetStartSeconds) * CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
      ),
    );
    this.nextOutputFrame = Math.max(this.nextOutputFrame, firstOutput);
    while (this.nextOutputFrame < lastOutput) {
      const timestamp =
        targetStartSeconds +
        this.nextOutputFrame / CANDIDATE_PASS_B_SAMPLE_RATE_HZ;
      const sourcePosition = (timestamp - sample.timestamp) * sample.sampleRate;
      if (sourcePosition < 0) {
        this.nextOutputFrame += 1;
        continue;
      }
      if (sourcePosition >= sample.numberOfFrames) break;
      const lower = Math.floor(sourcePosition);
      const upper = Math.min(sample.numberOfFrames - 1, lower + 1);
      const fraction = sourcePosition - lower;
      const lowerValue = mono[lower] ?? 0;
      this.pcm[this.nextOutputFrame] = clamp(
        lowerValue + ((mono[upper] ?? lowerValue) - lowerValue) * fraction,
        -1,
        1,
      );
      this.writtenOutputFrameCount += 1;
      this.nextOutputFrame += 1;
    }
  }

  public hasAudio(): boolean {
    return this.overlapFrames > 0;
  }

  public hasCompleteOutputCoverage(): boolean {
    return (
      this.pcm.length > 0 &&
      this.writtenOutputFrameCount === this.pcm.length
    );
  }

  private ensureScratch(frameCount: number): void {
    if (this.channelScratch.length >= frameCount) return;
    let capacity = 1;
    while (capacity < frameCount) capacity *= 2;
    this.channelScratch = new Float32Array(capacity);
    this.monoScratch = new Float32Array(capacity);
  }
}

interface DecodedPcmRange {
  readonly pcm: Float32Array;
  /**
   * True only when decoder samples populated every output frame. Zero-filled
   * holes must never be mistaken for model-confirmed no-speech.
   */
  readonly completeForSpeechActivity: boolean;
}

async function decodeRange(
  audioTrack: InputAudioTrack,
  startMs: number,
  endMs: number,
  task: ActiveTask,
): Promise<DecodedPcmRange | null> {
  const builder = new PcmRangeBuilder(startMs, endMs);
  const sink = new AudioSampleSink(audioTrack);
  try {
    for await (const sample of sink.samples(startMs / 1_000, endMs / 1_000)) {
      try {
        if (task.cancelled) {
          builder.pcm.fill(0);
          return null;
        }
        builder.consume(sample);
      } finally {
        sample.close();
      }
    }
  } catch (error) {
    builder.pcm.fill(0);
    if (task.cancelled || error instanceof InputDisposedError) return null;
    throw error;
  }
  if (!builder.hasAudio()) {
    builder.pcm.fill(0);
    return {
      pcm: new Float32Array(),
      completeForSpeechActivity: false,
    };
  }
  return {
    pcm: builder.pcm,
    completeForSpeechActivity: builder.hasCompleteOutputCoverage(),
  };
}

function disposeTensorGraph(value: unknown, disposed: Set<unknown>): void {
  if (value === null || value === undefined || disposed.has(value)) return;
  if (value instanceof Tensor) {
    disposed.add(value);
    try {
      value.dispose();
    } catch {
      // Tensor cleanup cannot turn a conservative ASR fallback into failure.
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

function speechActivityLogitFrames(
  output: unknown,
): readonly (readonly number[])[] {
  if (!isRecord(output) || !(output.logits instanceof Tensor)) {
    throw new Error("Speech-activity output did not contain logits.");
  }
  const { logits } = output;
  const data = logits.data;
  if (
    logits.dims.length !== 3 ||
    logits.dims[0] !== 1 ||
    !Number.isSafeInteger(logits.dims[1]) ||
    (logits.dims[1] ?? 0) <= 0 ||
    logits.dims[2] !== BROADCAST_SPEECH_ACTIVITY_OUTPUT_CLASS_COUNT ||
    !(data instanceof Float32Array)
  ) {
    throw new Error("Speech-activity logits have an unexpected shape.");
  }
  const frameCount = logits.dims[1] ?? 0;
  if (
    data.length !==
    frameCount * BROADCAST_SPEECH_ACTIVITY_OUTPUT_CLASS_COUNT
  ) {
    throw new Error("Speech-activity logits are incomplete.");
  }
  return Array.from({ length: frameCount }, (_, frameIndex) => {
    const start =
      frameIndex * BROADCAST_SPEECH_ACTIVITY_OUTPUT_CLASS_COUNT;
    return Array.from(
      data.subarray(
        start,
        start + BROADCAST_SPEECH_ACTIVITY_OUTPUT_CLASS_COUNT,
      ),
    );
  });
}

/**
 * Returns a complete receipt only when every valid model frame in every
 * 10-second cell is a confident NO_SPEAKER decision. Any uncertainty, speech,
 * runtime error, model error, or malformed output returns null so the original
 * PCM proceeds to ASR.
 */
async function chunkHasConfirmedNoSpeech(
  pcm: Float32Array,
  chunk: BroadcastContextTranscriptionChunk,
  sourceDurationMs: number,
  task: ActiveTask,
  attemptOrdinal: number,
): Promise<BroadcastSpeechActivityRunReceipt | null> {
  if (
    CANDIDATE_PASS_B_SAMPLE_RATE_HZ !==
      BROADCAST_SPEECH_ACTIVITY_SAMPLE_RATE_HZ ||
    task.cancelled ||
    !(await loadSpeechActivityArtifacts(task))
  ) {
    return null;
  }
  const processor = task.speechActivityProcessor;
  const model = task.speechActivityModel;
  if (processor === null || model === null) return null;

  try {
    const plan = createBroadcastSpeechActivityPlan(sourceDurationMs, {
      sourceStartMs: chunk.sourceStartMs,
      sourceEndMs: chunk.sourceEndMs,
    });
    const receipts: BroadcastSpeechActivityCellReceipt[] = [];
    for (const cell of plan.cells) {
      if (task.cancelled) return null;
      if (
        !Number.isSafeInteger(cell.validSampleCount) ||
        cell.validSampleCount <= 0 ||
        cell.validSampleCount >
          BROADCAST_SPEECH_ACTIVITY_INPUT_SAMPLE_COUNT
      ) {
        return null;
      }
      const sourceOffset = Math.round(
        ((cell.sourceStartMs - chunk.sourceStartMs) *
          BROADCAST_SPEECH_ACTIVITY_SAMPLE_RATE_HZ) /
          1_000,
      );
      const sourceEnd = sourceOffset + cell.validSampleCount;
      if (
        sourceOffset < 0 ||
        sourceEnd > pcm.length ||
        sourceEnd <= sourceOffset
      ) {
        return null;
      }

      const cellPcm = new Float32Array(
        BROADCAST_SPEECH_ACTIVITY_INPUT_SAMPLE_COUNT,
      );
      cellPcm.set(pcm.subarray(sourceOffset, sourceEnd));
      let inputs: unknown = null;
      let output: unknown = null;
      try {
        inputs = await processor(cellPcm);
        if (task.cancelled) return null;
        output = await model(inputs);
        if (task.cancelled) return null;
        const receipt = postprocessBroadcastSpeechActivityLogits({
          operationId: `vad-${chunk.chunkId}-${cell.ordinal}`,
          attemptOrdinal,
          runtime: "wasm",
          cell,
          logits: speechActivityLogitFrames(output),
        });
        if (!broadcastSpeechActivityCanSkipAsr(receipt)) {
          return null;
        }
        receipts.push(receipt);
      } finally {
        cellPcm.fill(0);
        const disposed = new Set<unknown>();
        disposeTensorGraph(output, disposed);
        disposeTensorGraph(inputs, disposed);
      }
    }
    return plan.cells.length > 0
      ? createBroadcastSpeechActivityRunReceipt(plan, receipts)
      : null;
  } catch {
    /*
     * VAD is a cost/latency gate, never the source of transcript loss. Once a
     * runtime/model inference has failed, remember it for the remaining task
     * and let every fragment use ASR.
     */
    task.speechActivityUnavailable = true;
    await disposeSpeechActivityArtifacts(task);
    return null;
  }
}

async function runAnalyze(
  request: Extract<
    BroadcastTranscriptWorkerRequest,
    { readonly type: "broadcast-transcript-analyze" }
  >,
  task: ActiveTask,
): Promise<void> {
  try {
    await verifyBroadcastTranscriptRouteSelection(request.route);
  } catch {
    post({
      type: "broadcast-transcript-failed",
      identity: task.identity,
      reason: "invalid-input",
    });
    disposeTask(task);
    if (activeTask === task) activeTask = null;
    return;
  }
  try {
    task.input = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(request.file, { maxCacheSize: SOURCE_CACHE_BYTES }),
    });
    const audioTrack = await task.input.getPrimaryAudioTrack();
    if (task.cancelled) return;
    if (audioTrack === null || !(await audioTrack.canDecode())) {
      post({
        type: "broadcast-transcript-failed",
        identity: task.identity,
        reason: "unsupported-source",
      });
      return;
    }
    let successfulCount = 0;
    let abstentionCount = 0;
    let processedCount = 0;
    let gapCount = 0;
    /*
     * 동시 요청 수는 이 실행 안에서 **찾아간다.**
     *
     * 고정값은 세 번 틀렸다 — 4 는 지금 없는 전송 방식을 기준으로 정해졌고, 12 는
     * 페이로드를 7MB 로 본 계산에서 나왔는데 실제는 2.75MB 였으며, 그러고도
     * 릴레이가 죽었다. 즉 진짜 상한은 아직 아무도 모른다. 게다가 그것은 하나의
     * 숫자도 아니다 — 기기·회선·그 순간의 상류 상태에 달렸고, 그 중 어느 것도
     * 여기서 읽을 수 없다.
     */
    const concurrency = new AdaptiveConcurrency();
    /*
     * 프록시의 분당 상한(60)을 넘지 않도록 간격을 둔다.
     *
     * 넘기면 429 가 오고, 적응형 동시성이 그것을 실패로 읽어 물러난다. 해당
     * 조각은 상위 transcript recovery queue가 제한 재시도하고 이미 성공한 조각은
     * checkpoint에서 보존한다. 맞고 물러나는 것보다 처음부터 그 속도로 보내는
     * 편이 낫다.
     */
    const spacingMs = requestSpacingMs();
    let nextSendAtMs = 0;
    const inFlight = new Set<Promise<void>>();
    let routeChanged = false;
    const settleRouteChangedGap = (chunkId: string): void => {
      gapCount += 1;
      processedCount += 1;
      post({
        type: "broadcast-transcript-gap",
        identity: task.identity,
        chunkId,
        reason: "route-changed",
      });
    };
    const chronologicalChunks = [...request.chunks].sort(
      (left, right) =>
        left.sourceStartMs - right.sourceStartMs ||
        left.sourceEndMs - right.sourceEndMs ||
        left.chunkId.localeCompare(right.chunkId),
    );
    let pendingChunks = [...request.chunks];
    const settleUndispatchedRouteChangedGaps = (): void => {
      for (const pending of pendingChunks.splice(0)) {
        settleRouteChangedGap(pending.chunkId);
      }
    };
    while (pendingChunks.length > 0) {
      if (routeChanged) {
        settleUndispatchedRouteChangedGaps();
        break;
      }
      const chunk = pendingChunks.shift();
      if (chunk === undefined) break;
      if (task.cancelled) return;
      post({
        type: "broadcast-transcript-progress",
        identity: task.identity,
        progress: {
          chunkId: chunk.chunkId,
          completedCount: processedCount,
          totalCount: request.chunks.length,
          stage: "decoding",
          concurrency: concurrency.limit,
        },
      });
      let decoded: DecodedPcmRange | null;
      let decodeFailed = false;
      try {
        decoded = await decodeRange(
          audioTrack,
          chunk.sourceStartMs,
          chunk.sourceEndMs,
          task,
        );
      } catch {
        decodeFailed = true;
        decoded = {
          pcm: new Float32Array(),
          completeForSpeechActivity: false,
        };
      }
      if (task.cancelled || decoded === null) return;
      const { pcm } = decoded;
      if (pcm.length === 0) {
        processedCount += 1;
        if (decodeFailed) {
          gapCount += 1;
          post({
            type: "broadcast-transcript-gap",
            identity: task.identity,
            chunkId: chunk.chunkId,
            reason: "decode-failed",
          });
        } else {
          abstentionCount += 1;
          post({
            type: "broadcast-transcript-abstention",
            identity: task.identity,
            chunkId: chunk.chunkId,
            reason: "no-audio",
            speechActivityReceipt: null,
          });
        }
        continue;
      }
      const speechActivityReceipt = decoded.completeForSpeechActivity
        ? await chunkHasConfirmedNoSpeech(
            pcm,
            chunk,
            request.sourceDurationMs,
            task,
            request.quota?.attemptOrdinal ?? 0,
          )
        : null;
      if (task.cancelled) {
        pcm.fill(0);
        return;
      }
      if (speechActivityReceipt !== null) {
        pcm.fill(0);
        abstentionCount += 1;
        processedCount += 1;
        post({
          type: "broadcast-transcript-abstention",
          identity: task.identity,
          chunkId: chunk.chunkId,
          reason: "no-speech",
          speechActivityReceipt,
        });
        continue;
      }
      post({
        type: "broadcast-transcript-progress",
        identity: task.identity,
        progress: {
          chunkId: chunk.chunkId,
          completedCount: processedCount,
          totalCount: request.chunks.length,
          stage: "transcribing",
          concurrency: concurrency.limit,
        },
      });
      const durationMs = chunk.sourceEndMs - chunk.sourceStartMs;
      const wav = encodeCandidatePassBPcm16Wav(
        pcm,
        CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
      );
      pcm.fill(0);
      // Keep one raw WAV contract for both server transports. Free mode streams
      // these bytes into private R2 without reading them in Worker JavaScript;
      // paid mode may assemble the provider body directly. The browser never
      // needs to know which Cloudflare plan is active.

      const chunkId = chunk.chunkId;
      // Reserve the public request start time before creating the async
      // request. An async IIFE runs immediately until its first await, so
      // constructing it first would start the lease/POST before the delay.
      const pacedStart = await startAfterRequestSpacing(
        nextSendAtMs,
        spacingMs,
        () => {
          if (task.cancelled) {
            wav.fill(0);
            return Promise.resolve();
          }
          if (routeChanged) {
            wav.fill(0);
            settleRouteChangedGap(chunkId);
            return Promise.resolve();
          }
          const controller = new AbortController();
          task.fetchControllers.add(controller);
          const requestStamp = concurrency.captureRequestWave();
          return (async (): Promise<void> => {
            try {
              const result = await requestBroadcastTranscriptChunkBinary(
                wav,
                chunk.sourceStartMs,
                durationMs,
                {
                  route: request.route,
                  signal: controller.signal,
                  ...(request.quota === undefined
                    ? {}
                    : {
                        quota: {
                          participantId: request.quota.participantId,
                          runId: request.quota.runId,
                          operationId: transcriptFragmentQuotaOperationId(
                            request.quota.operationNamespace,
                            request.quota.attemptOrdinal ?? 0,
                            chunkId,
                            request.quota.operationScope,
                          ),
                        },
                      }),
                },
              );
              if (task.cancelled) return;
              successfulCount += 1;
              post({
                type: "broadcast-transcript-partial",
                identity: task.identity,
                chunkId,
                result,
              });
              // Pulling neighbours forward is a recall heuristic, never a
              // scoring input, so applying it when the response lands rather
              // than before the next decode only changes exploration order.
              if (
                shouldExpandBroadcastContextChunk(result) &&
                pendingChunks.length > 0
              ) {
                pendingChunks = [
                  ...prioritizeAdjacentTranscriptChunks(
                    pendingChunks,
                    chronologicalChunks,
                    chunkId,
                  ),
                ];
              }
              concurrency.onSuccess(requestStamp);
            } catch (error) {
              if (task.cancelled) return;
              concurrency.onFailure(requestStamp);
              const reason: BroadcastTranscriptChunkGapReason =
                error instanceof BroadcastTranscriptQwenClientError &&
                error.code === "RATE_LIMITED"
                  ? "rate-limited"
                  : error instanceof BroadcastTranscriptQwenClientError &&
                      error.code === "ROUTE_CHANGED"
                    ? "route-changed"
                  : error instanceof BroadcastTranscriptQwenClientError &&
                      error.code === "OUTCOME_UNKNOWN"
                    ? "outcome-unknown"
                    : "transcription-failed";
              if (reason === "route-changed") {
                routeChanged = true;
              }
              gapCount += 1;
              post({
                type: "broadcast-transcript-gap",
                identity: task.identity,
                chunkId,
                reason,
              });
            } finally {
              wav.fill(0);
              task.fetchControllers.delete(controller);
              processedCount += 1;
            }
          })();
        },
        undefined,
        async () => {
          await waitForAdaptiveConcurrencyCapacity(inFlight, concurrency);
        },
      );
      if (task.cancelled) {
        return;
      }
      nextSendAtMs = pacedStart.nextStartAtMs;
      const inFlightRequest = pacedStart.started;

      inFlight.add(inFlightRequest);
      // The body swallows its own failures, so settling always means done.
      void inFlightRequest.then(() => inFlight.delete(inFlightRequest));

      /*
       * 한도를 **매번 다시 읽는다.** 실패로 내려간 값이 다음 판단에 곧바로
       * 반영되지 않으면, 이미 벽에 부딪힌 뒤에도 같은 수를 계속 밀어 넣는다.
       */
      // A failure can lower the limit below the number already in flight. Drain
      // the old wave to the new limit before starting another request; a single
      // wait would keep replacing each settled request and never actually apply
      // the reduction.
      await waitForAdaptiveConcurrencyCapacity(inFlight, concurrency);
      if (task.cancelled) return;
      if (routeChanged && pendingChunks.length > 0) {
        settleUndispatchedRouteChangedGaps();
      }
    }

    await Promise.all(inFlight);
    if (task.cancelled) return;
    post({
      type: "broadcast-transcript-complete",
      identity: task.identity,
      requestedCount: request.chunks.length,
      completedCount: successfulCount,
      abstentionCount,
      gapCount,
      concurrencyOutcome: concurrency.describe(),
    });
  } catch (error) {
    if (task.cancelled || error instanceof InputDisposedError) return;
    post({
      type: "broadcast-transcript-failed",
      identity: task.identity,
      reason:
        error instanceof UnsupportedInputFormatError
          ? "unsupported-source"
          : "worker-failed",
    });
  } finally {
    disposeTask(task);
    await disposeSpeechActivityArtifacts(task);
    if (activeTask === task) activeTask = null;
  }
}

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const value = event.data;
  if (isValidCancelRequest(value)) {
    if (activeTask !== null && sameIdentity(activeTask.identity, value.identity)) {
      activeTask.cancelled = true;
      disposeTask(activeTask);
      post({ type: "broadcast-transcript-cancelled", identity: value.identity });
    }
    return;
  }
  if (!isValidAnalyzeRequest(value) || activeTask !== null) {
    const identity =
      isRecord(value) && isValidIdentity(value.identity)
        ? value.identity
        : { taskId: "invalid" };
    post({
      type: "broadcast-transcript-failed",
      identity,
      reason: "invalid-input",
    });
    return;
  }
  const task: ActiveTask = {
    identity: value.identity,
    cancelled: false,
    input: null,
    fetchControllers: new Set<AbortController>(),
    speechActivityProcessor: null,
    speechActivityModel: null,
    speechActivityUnavailable: false,
  };
  activeTask = task;
  void runAnalyze(value, task);
});
