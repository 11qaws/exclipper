import {
  ALL_FORMATS,
  AudioSampleSink,
  BlobSource,
  Input,
  InputDisposedError,
  type AudioSample,
  type InputAudioTrack,
} from "mediabunny";
import { encodeCandidatePassBPcm16Wav } from "./candidatePassBGemini";
import { CANDIDATE_PASS_B_SAMPLE_RATE_HZ } from "./candidatePassBWorkerProtocol";
import {
  BROADCAST_TRANSCRIPT_VISUAL_AUDIO_EXTRACTION_REVISION,
  BROADCAST_TRANSCRIPT_VISUAL_FRAME_COUNT,
  type BroadcastTranscriptVisualFramePreparationTask,
  type BroadcastTranscriptVisualInspectionPlan,
  type BroadcastTranscriptVisualProviderTask,
} from "./broadcastTranscriptVisualInspectionQueue";
import type {
  BroadcastTranscriptVisualFrameAdapterRequest,
  RunBroadcastTranscriptVisualInspectionOptions,
} from "./broadcastTranscriptVisualInspectionRunner";
import {
  BROADCAST_TRANSCRIPT_VISUAL_FRAME_CONTENT_TYPE,
  createBroadcastTranscriptVisualMediaContentFingerprint,
  type BroadcastTranscriptVisualHydratedAudio,
  type BroadcastTranscriptVisualHydratedFrame,
  type BroadcastTranscriptVisualHydratedFrames,
  type BroadcastTranscriptVisualHydratedMediaEvidence,
  type BroadcastTranscriptVisualMediaDigestAdapter,
  type BroadcastTranscriptVisualPreparedMediaEvidence,
} from "./broadcastTranscriptVisualMediaEvidence";

const SOURCE_CACHE_BYTES = 8 * 1024 * 1024;
const MAX_FRAME_DIMENSION = 640;
const FRAME_JPEG_QUALITIES = [0.58, 0.48, 0.38, 0.28] as const;
const MAX_FRAME_BYTES = 270_000;
const MEDIA_WAIT_TIMEOUT_MS = 10_000;
const DEFAULT_CACHE_BYTE_LIMIT = 160 * 1024 * 1024;
const AUDIO_CODEC = "audio/wav;codec=pcm_s16le;rate=16000;channels=1";

type BrowserMediaEvidenceAdapter =
  RunBroadcastTranscriptVisualInspectionOptions["mediaEvidence"];

export type BroadcastTranscriptVisualBrowserFrameBundle = readonly [
  BroadcastTranscriptVisualHydratedFrame,
  BroadcastTranscriptVisualHydratedFrame,
  BroadcastTranscriptVisualHydratedFrame,
  BroadcastTranscriptVisualHydratedFrame,
];

export interface BroadcastTranscriptVisualBrowserMediaBackendRequest {
  readonly sourceFile: File;
  readonly task: BroadcastTranscriptVisualFramePreparationTask;
  readonly signal?: AbortSignal;
}

/**
 * Injectable boundary used by tests and by future WebCodecs implementations.
 * The default implementation below is the production DOM + mediabunny path.
 */
export interface BroadcastTranscriptVisualBrowserMediaBackend {
  extractFrames(
    request: BroadcastTranscriptVisualBrowserMediaBackendRequest,
  ): Promise<BroadcastTranscriptVisualBrowserFrameBundle>;
  extractAudio(
    request: BroadcastTranscriptVisualBrowserMediaBackendRequest,
  ): Promise<BroadcastTranscriptVisualHydratedAudio>;
  dispose(): void;
}

export interface CreateBroadcastTranscriptVisualBrowserMediaAdapterOptions {
  readonly sourceFile: File;
  readonly plan: BroadcastTranscriptVisualInspectionPlan;
  readonly backend?: BroadcastTranscriptVisualBrowserMediaBackend;
  readonly digestAdapter?: BroadcastTranscriptVisualMediaDigestAdapter | null;
  readonly maximumCacheBytes?: number;
  readonly document?: Document;
  readonly createObjectUrl?: (file: File) => string;
  readonly revokeObjectUrl?: (url: string) => void;
}

export interface BroadcastTranscriptVisualBrowserMediaAdapter
  extends BrowserMediaEvidenceAdapter {
  readonly planFingerprint: string;
  readonly sourceFingerprint: string;
  clearCache(): void;
  dispose(): void;
}

interface CachedMedia {
  readonly evidence: BroadcastTranscriptVisualHydratedMediaEvidence;
  readonly byteLength: number;
}

interface VideoSession {
  readonly video: HTMLVideoElement;
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly url: string;
}

function abortIfRequested(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new DOMException("Visual media extraction was cancelled.", "AbortError");
  }
}

function copiedBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(value.byteLength));
  copy.set(value);
  return copy;
}

function copiedFrame(
  frame: BroadcastTranscriptVisualHydratedFrame,
): BroadcastTranscriptVisualHydratedFrame {
  return {
    timestampMs: frame.timestampMs,
    contentType: BROADCAST_TRANSCRIPT_VISUAL_FRAME_CONTENT_TYPE,
    bytes: copiedBytes(frame.bytes),
  };
}

function copiedEvidence(
  value: BroadcastTranscriptVisualHydratedMediaEvidence,
): BroadcastTranscriptVisualHydratedMediaEvidence {
  return {
    planFingerprint: value.planFingerprint,
    sourceFingerprint: value.sourceFingerprint,
    cellId: value.cellId,
    sourceStartMs: value.sourceStartMs,
    sourceEndMs: value.sourceEndMs,
    frames: value.frames.map(copiedFrame) as unknown as BroadcastTranscriptVisualHydratedFrames,
    audio:
      value.audio === null
        ? null
        : {
            sourceStartMs: value.audio.sourceStartMs,
            sourceEndMs: value.audio.sourceEndMs,
            codec: value.audio.codec,
            extractionRevision: value.audio.extractionRevision,
            bytes: copiedBytes(value.audio.bytes),
          },
  };
}

function evidenceByteLength(
  value: BroadcastTranscriptVisualHydratedMediaEvidence,
): number {
  return (
    value.frames.reduce((total, frame) => total + frame.bytes.byteLength, 0) +
    (value.audio?.bytes.byteLength ?? 0)
  );
}

class ExactMediaCache {
  private readonly values = new Map<string, CachedMedia>();
  private totalBytes = 0;

  public constructor(private readonly maximumBytes: number) {}

  public get(key: string): BroadcastTranscriptVisualHydratedMediaEvidence | null {
    const cached = this.values.get(key);
    if (cached === undefined) return null;
    this.values.delete(key);
    this.values.set(key, cached);
    return copiedEvidence(cached.evidence);
  }

  public set(
    key: string,
    evidence: BroadcastTranscriptVisualHydratedMediaEvidence,
  ): void {
    const exactCopy = copiedEvidence(evidence);
    const byteLength = evidenceByteLength(exactCopy);
    const previous = this.values.get(key);
    if (previous !== undefined) {
      this.totalBytes -= previous.byteLength;
      this.values.delete(key);
    }
    if (byteLength > this.maximumBytes) return;
    this.values.set(key, { evidence: exactCopy, byteLength });
    this.totalBytes += byteLength;
    while (this.totalBytes > this.maximumBytes) {
      const oldest = this.values.entries().next().value as
        | readonly [string, CachedMedia]
        | undefined;
      if (oldest === undefined) break;
      this.values.delete(oldest[0]);
      this.totalBytes -= oldest[1].byteLength;
    }
  }

  public clear(): void {
    for (const { evidence } of this.values.values()) {
      for (const frame of evidence.frames) frame.bytes.fill(0);
      evidence.audio?.bytes.fill(0);
    }
    this.values.clear();
    this.totalBytes = 0;
  }
}

class SerialExecutor {
  private tail: Promise<void> = Promise.resolve();

  public run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work, work);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function waitForEvent(
  target: EventTarget,
  successEvents: readonly string[],
  failureEvent: string,
  signal: AbortSignal | undefined,
  message: string,
): Promise<void> {
  abortIfRequested(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = globalThis.setTimeout(
      () => finish(new Error(`${message} timed out.`)),
      MEDIA_WAIT_TIMEOUT_MS,
    );
    const cleanup = (): void => {
      globalThis.clearTimeout(timeout);
      for (const event of successEvents) {
        target.removeEventListener(event, onSuccess);
      }
      target.removeEventListener(failureEvent, onFailure);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error === undefined) resolve();
      else reject(error);
    };
    const onSuccess = (): void => finish();
    const onFailure = (): void => finish(new Error(`${message} failed.`));
    const onAbort = (): void =>
      finish(new DOMException(`${message} was cancelled.`, "AbortError"));
    for (const event of successEvents) {
      target.addEventListener(event, onSuccess, { once: true });
    }
    target.addEventListener(failureEvent, onFailure, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function frameDimensions(
  videoWidth: number,
  videoHeight: number,
): { readonly width: number; readonly height: number } {
  const width = Number.isFinite(videoWidth) && videoWidth > 0 ? videoWidth : 16;
  const height =
    Number.isFinite(videoHeight) && videoHeight > 0 ? videoHeight : 9;
  const scale = Math.min(
    1,
    MAX_FRAME_DIMENSION / width,
    MAX_FRAME_DIMENSION / height,
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function canvasJpeg(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) {
          reject(new Error("The exact visual frame could not be encoded."));
          return;
        }
        void blob
          .arrayBuffer()
          .then((buffer) => resolve(new Uint8Array(buffer)))
          .catch(() =>
            reject(new Error("The exact visual frame could not be read.")),
          );
      },
      BROADCAST_TRANSCRIPT_VISUAL_FRAME_CONTENT_TYPE,
      quality,
    );
  });
}

function validJpeg(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[bytes.byteLength - 2] === 0xff &&
    bytes[bytes.byteLength - 1] === 0xd9
  );
}

async function encodedBoundedJpeg(
  canvas: HTMLCanvasElement,
): Promise<Uint8Array<ArrayBuffer>> {
  for (const quality of FRAME_JPEG_QUALITIES) {
    const bytes = await canvasJpeg(canvas, quality);
    if (validJpeg(bytes) && bytes.byteLength <= MAX_FRAME_BYTES) return bytes;
    bytes.fill(0);
  }
  throw new Error("The exact visual frame exceeds the bounded JPEG transport.");
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

class ExactPcmRangeBuilder {
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
      Math.ceil(
        ((endMs - startMs) / 1_000) * CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
      ),
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
    for (
      let channelIndex = 0;
      channelIndex < sample.numberOfChannels;
      channelIndex += 1
    ) {
      sample.copyTo(channel, {
        planeIndex: channelIndex,
        format: "f32-planar",
      });
      for (
        let frameIndex = 0;
        frameIndex < sample.numberOfFrames;
        frameIndex += 1
      ) {
        mono[frameIndex] =
          (mono[frameIndex] ?? 0) +
          (Number.isFinite(channel[frameIndex])
            ? (channel[frameIndex] ?? 0) / sample.numberOfChannels
            : 0);
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
      const sourcePosition =
        (timestamp - sample.timestamp) * sample.sampleRate;
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
      this.writtenOutputFrameCount += 1;
    }
  }

  public complete(): boolean {
    return (
      this.pcm.length > 0 &&
      this.overlapFrames > 0 &&
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

class DefaultBrowserMediaBackend
  implements BroadcastTranscriptVisualBrowserMediaBackend
{
  private readonly serial = new SerialExecutor();
  private readonly documentImplementation: Document;
  private readonly createUrl: (file: File) => string;
  private readonly revokeUrl: (url: string) => void;
  private videoSession: VideoSession | null = null;
  private audioInput: Input<BlobSource> | null = null;
  private audioTrack: InputAudioTrack | null | undefined;
  private disposed = false;

  public constructor(
    private readonly sourceFile: File,
    options: Pick<
      CreateBroadcastTranscriptVisualBrowserMediaAdapterOptions,
      "document" | "createObjectUrl" | "revokeObjectUrl"
    >,
  ) {
    if (typeof document === "undefined" && options.document === undefined) {
      throw new Error("Browser visual media decoding requires a DOM.");
    }
    this.documentImplementation = options.document ?? document;
    this.createUrl =
      options.createObjectUrl ??
      ((file) => URL.createObjectURL(file));
    this.revokeUrl =
      options.revokeObjectUrl ??
      ((url) => URL.revokeObjectURL(url));
  }

  public extractFrames(
    request: BroadcastTranscriptVisualBrowserMediaBackendRequest,
  ): Promise<BroadcastTranscriptVisualBrowserFrameBundle> {
    return this.serial.run(async () => {
      this.assertCurrent(request);
      const session = await this.getVideoSession(request.signal);
      const frames: BroadcastTranscriptVisualHydratedFrame[] = [];
      for (const timestampMs of request.task.frameTimestampsMs) {
        abortIfRequested(request.signal);
        const seconds = timestampMs / 1_000;
        if (
          Math.abs(session.video.currentTime - seconds) >= 0.0005 ||
          session.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
          const seek = waitForEvent(
            session.video,
            ["seeked"],
            "error",
            request.signal,
            "Visual frame seek",
          );
          session.video.currentTime = seconds;
          await seek;
        }
        if (session.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          await waitForEvent(
            session.video,
            ["loadeddata", "canplay"],
            "error",
            request.signal,
            "Visual frame decode",
          );
        }
        session.context.drawImage(
          session.video,
          0,
          0,
          session.canvas.width,
          session.canvas.height,
        );
        frames.push({
          timestampMs,
          contentType: BROADCAST_TRANSCRIPT_VISUAL_FRAME_CONTENT_TYPE,
          bytes: await encodedBoundedJpeg(session.canvas),
        });
      }
      if (
        frames.length !== BROADCAST_TRANSCRIPT_VISUAL_FRAME_COUNT ||
        frames.some(
          (frame, index) =>
            frame.timestampMs !== request.task.frameTimestampsMs[index],
        )
      ) {
        throw new Error("All four exact planned visual frames are required.");
      }
      return frames as unknown as BroadcastTranscriptVisualBrowserFrameBundle;
    });
  }

  public extractAudio(
    request: BroadcastTranscriptVisualBrowserMediaBackendRequest,
  ): Promise<BroadcastTranscriptVisualHydratedAudio> {
    return this.serial.run(async () => {
      this.assertCurrent(request);
      if (request.task.transcriptAbstentionReason === "no-audio") {
        throw new Error("A no-audio cell cannot extract audio evidence.");
      }
      const audioTrack = await this.getAudioTrack(request.signal);
      if (audioTrack === null || !(await audioTrack.canDecode())) {
        throw new Error("The exact visual-inspection audio range cannot be decoded.");
      }
      const builder = new ExactPcmRangeBuilder(
        request.task.sourceStartMs,
        request.task.sourceEndMs,
      );
      const sink = new AudioSampleSink(audioTrack);
      try {
        for await (const sample of sink.samples(
          request.task.sourceStartMs / 1_000,
          request.task.sourceEndMs / 1_000,
        )) {
          try {
            abortIfRequested(request.signal);
            builder.consume(sample);
          } finally {
            sample.close();
          }
        }
      } catch (error) {
        builder.pcm.fill(0);
        if (error instanceof InputDisposedError && this.disposed) {
          throw new DOMException(
            "Visual media extraction was cancelled.",
            "AbortError",
          );
        }
        throw error;
      }
      if (!builder.complete()) {
        builder.pcm.fill(0);
        throw new Error(
          "The decoder did not cover every sample in the exact visual-inspection range.",
        );
      }
      const bytes = encodeCandidatePassBPcm16Wav(
        builder.pcm,
        CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
      );
      builder.pcm.fill(0);
      return {
        sourceStartMs: request.task.sourceStartMs,
        sourceEndMs: request.task.sourceEndMs,
        codec: AUDIO_CODEC,
        extractionRevision:
          BROADCAST_TRANSCRIPT_VISUAL_AUDIO_EXTRACTION_REVISION,
        bytes,
      };
    });
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.videoSession !== null) {
      const { video, url } = this.videoSession;
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
      this.revokeUrl(url);
      this.videoSession = null;
    }
    this.audioInput?.dispose();
    this.audioInput = null;
    this.audioTrack = undefined;
  }

  private assertCurrent(
    request: BroadcastTranscriptVisualBrowserMediaBackendRequest,
  ): void {
    abortIfRequested(request.signal);
    if (this.disposed || request.sourceFile !== this.sourceFile) {
      throw new Error("The visual media decoder source fence is stale.");
    }
  }

  private async getVideoSession(
    signal: AbortSignal | undefined,
  ): Promise<VideoSession> {
    if (this.videoSession !== null) return this.videoSession;
    const url = this.createUrl(this.sourceFile);
    const video = this.documentImplementation.createElement("video");
    try {
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("aria-hidden", "true");
      video.style.position = "fixed";
      video.style.width = "1px";
      video.style.height = "1px";
      video.style.opacity = "0";
      video.style.pointerEvents = "none";
      video.src = url;
      this.documentImplementation.body?.append(video);
      const metadata = waitForEvent(
        video,
        ["loadedmetadata"],
        "error",
        signal,
        "Visual source metadata",
      );
      video.load();
      await metadata;
      const canvas = this.documentImplementation.createElement("canvas");
      const dimensions = frameDimensions(video.videoWidth, video.videoHeight);
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      const context = canvas.getContext("2d");
      if (context === null) {
        throw new Error("Canvas 2D is unavailable for visual evidence.");
      }
      this.videoSession = { video, canvas, context, url };
      return this.videoSession;
    } catch (error) {
      video.removeAttribute("src");
      video.load();
      video.remove();
      this.revokeUrl(url);
      throw error;
    }
  }

  private async getAudioTrack(
    signal: AbortSignal | undefined,
  ): Promise<InputAudioTrack | null> {
    abortIfRequested(signal);
    if (this.audioTrack !== undefined) return this.audioTrack;
    this.audioInput = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(this.sourceFile, {
        maxCacheSize: SOURCE_CACHE_BYTES,
      }),
    });
    this.audioTrack = await this.audioInput.getPrimaryAudioTrack();
    abortIfRequested(signal);
    return this.audioTrack;
  }
}

function cacheKey(
  plan: BroadcastTranscriptVisualInspectionPlan,
  task: BroadcastTranscriptVisualFramePreparationTask,
): string {
  return [
    plan.planFingerprint,
    plan.sourceFence.sourceFingerprint,
    task.cellId,
    task.frameBundleKey,
  ].join(":");
}

function taskMatchesPlan(
  plan: BroadcastTranscriptVisualInspectionPlan,
  task:
    | BroadcastTranscriptVisualFramePreparationTask
    | BroadcastTranscriptVisualProviderTask,
): boolean {
  const cell = plan.cells.find(({ cellId }) => cellId === task.cellId);
  return (
    cell !== undefined &&
    cell.transcriptChunkId === task.transcriptChunkId &&
    cell.sourceStartMs === task.sourceStartMs &&
    cell.sourceEndMs === task.sourceEndMs &&
    cell.inspectionPurpose === task.inspectionPurpose &&
    cell.transcriptAbstentionReason === task.transcriptAbstentionReason &&
    cell.frameBundleKey === task.frameBundleKey &&
    JSON.stringify(cell.frameTimestampsMs) ===
      JSON.stringify(task.frameTimestampsMs)
  );
}

function preparationTaskFromProviderTask(
  task: BroadcastTranscriptVisualProviderTask,
): BroadcastTranscriptVisualFramePreparationTask {
  return {
    cellId: task.cellId,
    transcriptChunkId: task.transcriptChunkId,
    sourceStartMs: task.sourceStartMs,
    sourceEndMs: task.sourceEndMs,
    inspectionPurpose: task.inspectionPurpose,
    transcriptAbstentionReason: task.transcriptAbstentionReason,
    frameTimestampsMs: task.frameTimestampsMs,
    frameBundleKey: task.frameBundleKey,
    priorityOrdinal: task.priorityOrdinal,
    priorityBasis: "source-order",
    normalizedVisualSalience: 0,
    candidateOverlapRatio: 0,
    overlappingCandidateIds: [],
  };
}

/**
 * Creates the runner-facing browser evidence adapter. Durable checkpoints keep
 * only SHA-256 fingerprints; raw media stays in a bounded volatile LRU cache.
 * A cache miss re-decodes the exact source range and the runner verifies the
 * resulting bytes against the durable receipt before allocating an operation.
 */
export function createBroadcastTranscriptVisualBrowserMediaAdapter(
  options: CreateBroadcastTranscriptVisualBrowserMediaAdapterOptions,
): BroadcastTranscriptVisualBrowserMediaAdapter {
  const maximumCacheBytes =
    options.maximumCacheBytes ?? DEFAULT_CACHE_BYTE_LIMIT;
  if (
    !Number.isSafeInteger(maximumCacheBytes) ||
    maximumCacheBytes < 4 * 1024 * 1024 ||
    maximumCacheBytes > 512 * 1024 * 1024
  ) {
    throw new RangeError("Visual media cache size is invalid.");
  }
  const backend =
    options.backend ??
    new DefaultBrowserMediaBackend(options.sourceFile, options);
  const cache = new ExactMediaCache(maximumCacheBytes);
  const digestAdapter =
    options.digestAdapter === undefined
      ? (globalThis.crypto?.subtle ?? null)
      : options.digestAdapter;
  let disposed = false;

  const fingerprint: BrowserMediaEvidenceAdapter["fingerprint"] = (request) =>
    createBroadcastTranscriptVisualMediaContentFingerprint(
      request.bytes,
      digestAdapter,
    );

  const materialize = async (
    task: BroadcastTranscriptVisualFramePreparationTask,
    signal: AbortSignal | undefined,
  ): Promise<BroadcastTranscriptVisualHydratedMediaEvidence> => {
    abortIfRequested(signal);
    if (disposed || !taskMatchesPlan(options.plan, task)) {
      throw new Error("Visual media preparation does not match the active plan.");
    }
    const key = cacheKey(options.plan, task);
    const cached = cache.get(key);
    if (cached !== null) return cached;
    const frames = await backend.extractFrames({
      sourceFile: options.sourceFile,
      task,
      ...(signal === undefined ? {} : { signal }),
    });
    let audio: BroadcastTranscriptVisualHydratedAudio | null = null;
    try {
      if (task.transcriptAbstentionReason !== "no-audio") {
        audio = await backend.extractAudio({
          sourceFile: options.sourceFile,
          task,
          ...(signal === undefined ? {} : { signal }),
        });
      }
      const evidence: BroadcastTranscriptVisualHydratedMediaEvidence = {
        planFingerprint: options.plan.planFingerprint,
        sourceFingerprint: options.plan.sourceFence.sourceFingerprint,
        cellId: task.cellId,
        sourceStartMs: task.sourceStartMs,
        sourceEndMs: task.sourceEndMs,
        frames,
        audio,
      };
      cache.set(key, evidence);
      return copiedEvidence(evidence);
    } catch (error) {
      for (const frame of frames) frame.bytes.fill(0);
      audio?.bytes.fill(0);
      throw error;
    }
  };

  const prepare = async (
    request: BroadcastTranscriptVisualFrameAdapterRequest,
  ): Promise<BroadcastTranscriptVisualPreparedMediaEvidence> => {
    if (
      request.planFingerprint !== options.plan.planFingerprint ||
      request.sourceFingerprint !==
        options.plan.sourceFence.sourceFingerprint
    ) {
      throw new Error("Visual frame preparation source fence is stale.");
    }
    const evidence = await materialize(request.task, request.signal);
    const frameContentFingerprints = await Promise.all(
      evidence.frames.map((frame) =>
        Promise.resolve(
          fingerprint({
            cellId: request.task.cellId,
            kind: "frame",
            timestampMs: frame.timestampMs,
            bytes: frame.bytes,
          }),
        ),
      ),
    );
    const audioEvidence =
      evidence.audio === null
        ? null
        : {
            sourceStartMs: evidence.audio.sourceStartMs,
            sourceEndMs: evidence.audio.sourceEndMs,
            codec: evidence.audio.codec,
            extractionRevision:
              BROADCAST_TRANSCRIPT_VISUAL_AUDIO_EXTRACTION_REVISION,
            contentFingerprint: await fingerprint({
              cellId: request.task.cellId,
              kind: "audio",
              timestampMs: null,
              bytes: evidence.audio.bytes,
            }),
          };
    return {
      frameContentFingerprints:
        frameContentFingerprints as unknown as BroadcastTranscriptVisualPreparedMediaEvidence["frameContentFingerprints"],
      audioEvidence,
    };
  };

  const hydrate: BrowserMediaEvidenceAdapter["hydrate"] = async (request) => {
    if (
      request.planFingerprint !== options.plan.planFingerprint ||
      request.sourceFingerprint !==
        options.plan.sourceFence.sourceFingerprint ||
      !taskMatchesPlan(options.plan, request.task) ||
      request.preparedReceipt.cellId !== request.task.cellId
    ) {
      throw new Error("Visual media hydration source fence is stale.");
    }
    return materialize(
      preparationTaskFromProviderTask(request.task),
      request.signal,
    );
  };

  return {
    planFingerprint: options.plan.planFingerprint,
    sourceFingerprint: options.plan.sourceFence.sourceFingerprint,
    prepare,
    hydrate,
    fingerprint,
    clearCache: () => cache.clear(),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cache.clear();
      backend.dispose();
    },
  };
}
