import {
  MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS,
  MAX_CANDIDATE_PASS_B_VIDEO_FRAME_BASE64_LENGTH,
  type CandidatePassBVideoFrame,
} from "./candidatePassBWorkerProtocol";

export const CANDIDATE_VIDEO_FRAME_SAMPLE_RATIOS = [0.1, 0.37, 0.63, 0.9] as const;
const MAX_FRAME_WIDTH = 640;
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
    const relativeFocusMs = Math.min(durationMs, Math.max(0, Math.round((focusMs ?? startMs) - startMs)));
    const offsets = [
      relativeFocusMs - 6_000,
      relativeFocusMs - 1_500,
      relativeFocusMs + 1_500,
      relativeFocusMs + 6_000,
    ];
    return [...new Set(offsets.map((offset) => Math.min(durationMs - 1, Math.max(0, offset))))];
  }
  return CANDIDATE_VIDEO_FRAME_SAMPLE_RATIOS.map((ratio) => Math.round(durationMs * ratio));
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

function dataUrlToBase64(dataUrl: string): string | null {
  const comma = dataUrl.indexOf(",");
  if (comma <= 0 || !dataUrl.startsWith("data:image/jpeg;base64:", 0)) return null;
  const base64 = dataUrl.slice(comma + 1);
  return base64.length > 0 && base64.length <= MAX_CANDIDATE_PASS_B_VIDEO_FRAME_BASE64_LENGTH
    ? base64
    : null;
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
  const documentImplementation = options.document ?? document;
  const createUrl = options.createObjectUrl ?? ((input: File) => URL.createObjectURL(input));
  const revokeUrl = options.revokeObjectUrl ?? ((input: string) => URL.revokeObjectURL(input));
  let url: string | null = null;
  let video: HTMLVideoElement | null = null;
  try {
    abortIfRequested(options.signal);
    url = createUrl(file);
    video = documentImplementation.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Video metadata timed out.")), SEEK_TIMEOUT_MS);
      const cleanup = (): void => {
        window.clearTimeout(timeout);
        if (video !== null) {
          video.removeEventListener("loadedmetadata", onLoaded);
          video.removeEventListener("error", onError);
        }
      };
      const onLoaded = (): void => { cleanup(); resolve(); };
      const onError = (): void => { cleanup(); reject(new Error("Video metadata failed.")); };
      if (video !== null) {
        video.addEventListener("loadedmetadata", onLoaded, { once: true });
        video.addEventListener("error", onError, { once: true });
      }
    });
    const canvas = documentImplementation.createElement("canvas");
    const width = Math.max(1, Math.min(MAX_FRAME_WIDTH, video.videoWidth || MAX_FRAME_WIDTH));
    const height = Math.max(1, Math.round(width * ((video.videoHeight || 9) / (video.videoWidth || 16))));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) return [];
    const frames: CandidatePassBVideoFrame[] = [];
    for (const timestampMs of timestamps) {
      abortIfRequested(options.signal);
      try {
        await waitForVideoSeek(video, (startMs + timestampMs) / 1_000, options.signal);
        context.drawImage(video, 0, 0, width, height);
        const data = dataUrlToBase64(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
        if (data !== null) frames.push({ timestampMs, mimeType: "image/jpeg", dataBase64: data });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
      }
    }
    return frames;
  } catch {
    return [];
  } finally {
    if (video !== null) {
      video.removeAttribute("src");
      video.load();
    }
    if (url !== null) revokeUrl(url);
  }
}
