/// <reference lib="webworker" />

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
  encodeCandidatePassBBase64,
  encodeCandidatePassBPcm16Wav,
} from "./candidatePassBGemini";
import { CANDIDATE_PASS_B_SAMPLE_RATE_HZ } from "./candidatePassBWorkerProtocol";
import {
  MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS,
} from "./broadcastTranscriptQwen";
import type { BroadcastContextTranscriptionChunk } from "./broadcastContextSamplingPlan";
import { requestBroadcastTranscriptQwenChunk } from "./broadcastTranscriptQwenClient";
import {
  prioritizeAdjacentTranscriptChunks,
  shouldExpandBroadcastContextChunk,
} from "./broadcastContextExploration";
import {
  MAX_BROADCAST_TRANSCRIPT_WORKER_CHUNKS,
  type BroadcastTranscriptWorkerIdentity,
  type BroadcastTranscriptWorkerRequest,
  type BroadcastTranscriptWorkerResponse,
} from "./broadcastTranscriptWorkerProtocol";

declare const self: DedicatedWorkerGlobalScope;

const MAX_SOURCE_DURATION_MS = 12 * 60 * 60_000;
const SOURCE_CACHE_BYTES = 8 * 1024 * 1024;

interface ActiveTask {
  readonly identity: BroadcastTranscriptWorkerIdentity;
  cancelled: boolean;
  input: Input<BlobSource> | null;
  fetchController: AbortController | null;
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
  const sourceDurationMs = value.sourceDurationMs as number;
  const chunkIds = new Set<string>();
  const validatedChunks: BroadcastContextTranscriptionChunk[] = [];
  for (const rawChunk of value.chunks as readonly unknown[]) {
    if (
      !isRecord(rawChunk) ||
      typeof rawChunk.chunkId !== "string" ||
      rawChunk.chunkId.length === 0 ||
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
  task.fetchController?.abort();
  task.fetchController = null;
  if (task.input !== null) {
    try {
      task.input.dispose();
    } catch {
      // Best-effort cleanup after cancellation or a decode failure.
    }
    task.input = null;
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
      this.nextOutputFrame += 1;
    }
  }

  public hasAudio(): boolean {
    return this.overlapFrames > 0;
  }

  private ensureScratch(frameCount: number): void {
    if (this.channelScratch.length >= frameCount) return;
    let capacity = 1;
    while (capacity < frameCount) capacity *= 2;
    this.channelScratch = new Float32Array(capacity);
    this.monoScratch = new Float32Array(capacity);
  }
}

async function decodeRange(
  audioTrack: InputAudioTrack,
  startMs: number,
  endMs: number,
  task: ActiveTask,
): Promise<Float32Array | null> {
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
    return new Float32Array();
  }
  return builder.pcm;
}

async function runAnalyze(
  request: Extract<
    BroadcastTranscriptWorkerRequest,
    { readonly type: "broadcast-transcript-analyze" }
  >,
  task: ActiveTask,
): Promise<void> {
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
    let processedCount = 0;
    let gapCount = 0;
    const chronologicalChunks = [...request.chunks].sort(
      (left, right) =>
        left.sourceStartMs - right.sourceStartMs ||
        left.sourceEndMs - right.sourceEndMs ||
        left.chunkId.localeCompare(right.chunkId),
    );
    let pendingChunks = [...request.chunks];
    while (pendingChunks.length > 0) {
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
        },
      });
      let pcm: Float32Array | null;
      try {
        pcm = await decodeRange(
          audioTrack,
          chunk.sourceStartMs,
          chunk.sourceEndMs,
          task,
        );
      } catch {
        pcm = new Float32Array();
      }
      if (task.cancelled || pcm === null) return;
      if (pcm.length === 0) {
        gapCount += 1;
        processedCount += 1;
        post({
          type: "broadcast-transcript-gap",
          identity: task.identity,
          chunkId: chunk.chunkId,
          reason: "no-audio",
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
        },
      });
      const durationMs = chunk.sourceEndMs - chunk.sourceStartMs;
      const wav = encodeCandidatePassBPcm16Wav(
        pcm,
        CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
      );
      pcm.fill(0);
      task.fetchController = new AbortController();
      let semanticSeed = false;
      try {
        const result = await requestBroadcastTranscriptQwenChunk(
          encodeCandidatePassBBase64(wav),
          chunk.sourceStartMs,
          durationMs,
          { signal: task.fetchController.signal },
        );
        if (task.cancelled) return;
        successfulCount += 1;
        semanticSeed = shouldExpandBroadcastContextChunk(result);
        post({
          type: "broadcast-transcript-partial",
          identity: task.identity,
          chunkId: chunk.chunkId,
          result,
        });
      } catch {
        if (task.cancelled) return;
        gapCount += 1;
        post({
          type: "broadcast-transcript-gap",
          identity: task.identity,
          chunkId: chunk.chunkId,
          reason: "transcription-failed",
        });
      } finally {
        task.fetchController = null;
        wav.fill(0);
      }
      processedCount += 1;
      if (semanticSeed && pendingChunks.length > 0) {
        pendingChunks = [
          ...prioritizeAdjacentTranscriptChunks(
            pendingChunks,
            chronologicalChunks,
            chunk.chunkId,
          ),
        ];
      }
    }
    post({
      type: "broadcast-transcript-complete",
      identity: task.identity,
      requestedCount: request.chunks.length,
      completedCount: successfulCount,
      gapCount,
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
    fetchController: null,
  };
  activeTask = task;
  void runAnalyze(value, task);
});
