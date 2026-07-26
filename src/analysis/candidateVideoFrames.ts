import {
  MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS,
  MAX_CANDIDATE_PASS_B_VIDEO_FRAME_BASE64_LENGTH,
  MAX_CANDIDATE_PASS_B_VIDEO_FRAMES,
  type CandidatePassBVideoFrame,
} from "./candidatePassBWorkerProtocol";

export const CANDIDATE_VIDEO_FRAME_SAMPLE_RATIOS = [0.1, 0.37, 0.63, 0.9] as const;
const MAX_FRAME_DIMENSION = 640;
const JPEG_QUALITY = 0.58;
const SEEK_TIMEOUT_MS = 8_000;

export interface CandidateVideoFrameSamplingOptions {
  readonly signal?: AbortSignal;
  /** Absolute source timestamp to prioritize for the impact thumbnail. */
  readonly focusMs?: number;
  readonly document?: Document;
  readonly createObjectUrl?: (file: File) => string;
  readonly revokeObjectUrl?: (url: string) => void;
}

export interface CandidateVideoFrameBundleTarget {
  readonly candidateId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly focusMs?: number;
}

export type ReadyCandidateVideoFrameBundle = readonly [
  CandidatePassBVideoFrame,
  CandidatePassBVideoFrame,
  CandidatePassBVideoFrame,
  CandidatePassBVideoFrame,
];

export type CandidateVideoFrameBundleResult =
  | {
      readonly candidateId: string;
      readonly status: "ready";
      readonly frames: ReadyCandidateVideoFrameBundle;
    }
  | {
      readonly candidateId: string;
      readonly status: "failed";
      readonly frames: readonly CandidatePassBVideoFrame[];
      readonly reason: "invalid-range" | "decoder-unavailable" | "incomplete-bundle";
    };

export interface CandidateVideoFrameProducerOptions
  extends Omit<CandidateVideoFrameSamplingOptions, "focusMs"> {
  readonly onBundle?: (result: CandidateVideoFrameBundleResult) => void;
}

interface CandidateVideoFrameSamplerSession {
  readonly video: HTMLVideoElement;
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
  readonly url: string;
  readonly revokeUrl: (url: string) => void;
}

export function candidateVideoFrameDimensions(
  videoWidth: number,
  videoHeight: number,
): Readonly<{ width: number; height: number }> {
  const sourceWidth =
    Number.isFinite(videoWidth) && videoWidth > 0 ? videoWidth : 16;
  const sourceHeight =
    Number.isFinite(videoHeight) && videoHeight > 0 ? videoHeight : 9;
  const scale = Math.min(
    1,
    MAX_FRAME_DIMENSION / sourceWidth,
    MAX_FRAME_DIMENSION / sourceHeight,
  );
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

export function candidateVideoFrameTimestamps(
  startMs: number,
  endMs: number,
  focusMs?: number,
): readonly number[] {
  if (
    !Number.isSafeInteger(startMs) ||
    !Number.isSafeInteger(endMs) ||
    startMs < 0 ||
    endMs <= startMs ||
    endMs - startMs > MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS
  ) {
    return [];
  }
  const durationMs = endMs - startMs;
  if (Number.isFinite(focusMs)) {
    const relativeFocusMs = Math.min(
      durationMs - 1,
      Math.max(0, Math.round((focusMs ?? startMs) - startMs)),
    );
    const preferredOffsets = [
      relativeFocusMs - 6_000,
      relativeFocusMs - 1_500,
      relativeFocusMs + 1_500,
      relativeFocusMs + 6_000,
    ];
    const fallbackOffsets = CANDIDATE_VIDEO_FRAME_SAMPLE_RATIOS.map((ratio) =>
      Math.round((durationMs - 1) * ratio),
    );
    const distinct = [
      ...new Set(
        [...preferredOffsets, ...fallbackOffsets, 0, durationMs - 1].map(
          (offset) => Math.min(durationMs - 1, Math.max(0, offset)),
        ),
      ),
    ];
    return distinct.slice(0, MAX_CANDIDATE_PASS_B_VIDEO_FRAMES).sort((a, b) => a - b);
  }
  return [
    ...new Set(
      CANDIDATE_VIDEO_FRAME_SAMPLE_RATIOS.map((ratio) =>
        Math.min(durationMs - 1, Math.round(durationMs * ratio)),
      ),
    ),
  ];
}

function abortIfRequested(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("The frame sampling was cancelled.", "AbortError");
  }
}

function waitForVideoSeek(
  video: HTMLVideoElement,
  timestampSeconds: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (
    Math.abs(video.currentTime - timestampSeconds) < 0.001 &&
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
  ) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => finish(new Error("Video seek timed out.")), SEEK_TIMEOUT_MS);
    const cleanup = (): void => {
      window.clearTimeout(timeout);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error === undefined) resolve();
      else reject(error);
    };
    const onSeeked = (): void => finish();
    const onError = (): void => finish(new Error("Video seek failed."));
    const onAbort = (): void => finish(new DOMException("The frame sampling was cancelled.", "AbortError"));
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      video.currentTime = timestampSeconds;
    } catch (error) {
      finish(error instanceof Error ? error : new Error("Video seek failed."));
    }
  });
}

function waitForCurrentVideoFrame(
  video: HTMLVideoElement,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(
      () => finish(new Error("Video frame decode timed out.")),
      SEEK_TIMEOUT_MS,
    );
    const cleanup = (): void => {
      window.clearTimeout(timeout);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error === undefined) resolve();
      else reject(error);
    };
    const onReady = (): void => finish();
    const onError = (): void => finish(new Error("Video frame decode failed."));
    const onAbort = (): void =>
      finish(new DOMException("The frame sampling was cancelled.", "AbortError"));
    video.addEventListener("loadeddata", onReady, { once: true });
    video.addEventListener("canplay", onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function dataUrlToBase64(dataUrl: string): string | null {
  const comma = dataUrl.indexOf(",");
  if (comma <= 0 || !dataUrl.startsWith("data:image/jpeg;base64:", 0)) return null;
  const base64 = dataUrl.slice(comma + 1);
  return base64.length > 0 && base64.length <= MAX_CANDIDATE_PASS_B_VIDEO_FRAME_BASE64_LENGTH
    ? base64
    : null;
}

async function createSamplerSession(
  file: File,
  options: CandidateVideoFrameSamplingOptions,
): Promise<CandidateVideoFrameSamplerSession> {
  abortIfRequested(options.signal);
  const documentImplementation = options.document ?? document;
  const createUrl = options.createObjectUrl ?? ((input: File) => URL.createObjectURL(input));
  const revokeUrl = options.revokeObjectUrl ?? ((input: string) => URL.revokeObjectURL(input));
  const url = createUrl(file);
  const video = documentImplementation.createElement("video");
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
    video.style.inset = "0 auto auto 0";
    video.src = url;
    documentImplementation.body?.append(video);
    video.load();
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => finish(new Error("Video metadata timed out.")),
        SEEK_TIMEOUT_MS,
      );
      const cleanup = (): void => {
        window.clearTimeout(timeout);
        video.removeEventListener("loadedmetadata", onLoaded);
        video.removeEventListener("error", onError);
        options.signal?.removeEventListener("abort", onAbort);
      };
      const finish = (error?: Error): void => {
        cleanup();
        if (error === undefined) resolve();
        else reject(error);
      };
      const onLoaded = (): void => finish();
      const onError = (): void => finish(new Error("Video metadata failed."));
      const onAbort = (): void =>
        finish(new DOMException("The frame sampling was cancelled.", "AbortError"));
      video.addEventListener("loadedmetadata", onLoaded, { once: true });
      video.addEventListener("error", onError, { once: true });
      options.signal?.addEventListener("abort", onAbort, { once: true });
    });
    const canvas = documentImplementation.createElement("canvas");
    const { width, height } = candidateVideoFrameDimensions(
      video.videoWidth,
      video.videoHeight,
    );
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Canvas 2D context unavailable.");
    return { video, canvas, context, width, height, url, revokeUrl };
  } catch (error) {
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    revokeUrl(url);
    throw error;
  }
}

function disposeSamplerSession(session: CandidateVideoFrameSamplerSession): void {
  session.video.pause();
  session.video.removeAttribute("src");
  session.video.load();
  session.video.remove();
  session.revokeUrl(session.url);
}

async function captureFramesWithSession(
  session: CandidateVideoFrameSamplerSession,
  startMs: number,
  timestamps: readonly number[],
  signal: AbortSignal | undefined,
): Promise<readonly CandidatePassBVideoFrame[]> {
  const frames: CandidatePassBVideoFrame[] = [];
  for (const timestampMs of timestamps) {
    abortIfRequested(signal);
    try {
      await waitForVideoSeek(session.video, (startMs + timestampMs) / 1_000, signal);
      await waitForCurrentVideoFrame(session.video, signal);
      session.context.drawImage(session.video, 0, 0, session.width, session.height);
      const data = dataUrlToBase64(
        session.canvas.toDataURL("image/jpeg", JPEG_QUALITY),
      );
      if (data !== null) {
        frames.push({ timestampMs, mimeType: "image/jpeg", dataBase64: data });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
    }
  }
  return frames;
}

function asReadyBundle(
  frames: readonly CandidatePassBVideoFrame[],
): ReadyCandidateVideoFrameBundle | null {
  if (
    frames.length !== MAX_CANDIDATE_PASS_B_VIDEO_FRAMES ||
    new Set(frames.map(({ timestampMs }) => timestampMs)).size !==
      MAX_CANDIDATE_PASS_B_VIDEO_FRAMES
  ) {
    return null;
  }
  return frames as ReadyCandidateVideoFrameBundle;
}

/**
 * Opens one decoder for the source and settles each candidate bundle in source
 * order. Consumers may start as soon as their own four-frame bundle is ready.
 */
export async function produceCandidateVideoFrameBundles(
  file: File,
  targets: readonly CandidateVideoFrameBundleTarget[],
  options: CandidateVideoFrameProducerOptions = {},
): Promise<readonly CandidateVideoFrameBundleResult[]> {
  if (targets.length === 0) return [];
  const results: CandidateVideoFrameBundleResult[] = [];
  const settle = (result: CandidateVideoFrameBundleResult): void => {
    results.push(result);
    options.onBundle?.(result);
  };
  if (typeof window === "undefined") {
    for (const target of targets) {
      settle({
        candidateId: target.candidateId,
        status: "failed",
        frames: [],
        reason: "decoder-unavailable",
      });
    }
    return results;
  }

  let session: CandidateVideoFrameSamplerSession;
  try {
    session = await createSamplerSession(file, options);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    for (const target of targets) {
      settle({
        candidateId: target.candidateId,
        status: "failed",
        frames: [],
        reason: "decoder-unavailable",
      });
    }
    return results;
  }

  try {
    for (const target of targets) {
      abortIfRequested(options.signal);
      const timestamps = candidateVideoFrameTimestamps(
        target.startMs,
        target.endMs,
        target.focusMs,
      );
      if (timestamps.length !== MAX_CANDIDATE_PASS_B_VIDEO_FRAMES) {
        settle({
          candidateId: target.candidateId,
          status: "failed",
          frames: [],
          reason: "invalid-range",
        });
        continue;
      }
      const frames = await captureFramesWithSession(
        session,
        target.startMs,
        timestamps,
        options.signal,
      );
      const readyFrames = asReadyBundle(frames);
      settle(
        readyFrames === null
          ? {
              candidateId: target.candidateId,
              status: "failed",
              frames,
              reason: "incomplete-bundle",
            }
          : {
              candidateId: target.candidateId,
              status: "ready",
              frames: readyFrames,
            },
      );
    }
  } finally {
    disposeSamplerSession(session);
  }
  return results;
}

/**
 * Samples four small screenshots around the reaction peak when available;
 * otherwise it falls back to evenly distributed representative screenshots.
 * Any browser codec/seek failure returns an empty list so audio-only analysis
 * can continue without making the whole candidate run fail.
 */
export async function sampleCandidateVideoFrames(
  file: File,
  startMs: number,
  endMs: number,
  options: CandidateVideoFrameSamplingOptions = {},
): Promise<readonly CandidatePassBVideoFrame[]> {
  const timestamps = candidateVideoFrameTimestamps(startMs, endMs, options.focusMs);
  if (timestamps.length === 0 || typeof window === "undefined") return [];
  let session: CandidateVideoFrameSamplerSession | null = null;
  try {
    session = await createSamplerSession(file, options);
    return await captureFramesWithSession(
      session,
      startMs,
      timestamps,
      options.signal,
    );
  } catch {
    return [];
  } finally {
    if (session !== null) disposeSamplerSession(session);
  }
}
