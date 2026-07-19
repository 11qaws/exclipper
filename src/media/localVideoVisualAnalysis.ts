import {
  MAX_VISUAL_CANDIDATE_COUNT,
  MAX_VISUAL_SAMPLE_COUNT,
  VISUAL_FINGERPRINT_HEIGHT,
  VISUAL_FINGERPRINT_SIZE,
  VISUAL_FINGERPRINT_WIDTH,
  buildVisualSampleTimestamps,
  selectVisualHighlightsFromSamples,
  type LocalVideoVisualAnalysisResult,
} from "./localVideoVisualAnalysisCore";

export {
  MAX_VISUAL_CANDIDATE_COUNT,
  MAX_VISUAL_SAMPLE_COUNT,
  VISUAL_CANDIDATE_WINDOW_MS,
  VISUAL_FINGERPRINT_HEIGHT,
  VISUAL_FINGERPRINT_SIZE,
  VISUAL_FINGERPRINT_WIDTH,
  VISUAL_SAMPLE_TARGET_INTERVAL_MS,
  buildVisualSampleTimestamps,
  selectVisualHighlightsFromSamples,
} from "./localVideoVisualAnalysisCore";
export type {
  LocalVideoVisualAnalysisDiagnostics,
  LocalVideoVisualAnalysisResult,
  LocalVideoVisualCandidate,
  LocalVideoVisualEvidence,
  SelectVisualHighlightsOptions,
  VisualFrameSample,
} from "./localVideoVisualAnalysisCore";

export const DEFAULT_VISUAL_METADATA_TIMEOUT_MS = 15_000 as const;
export const DEFAULT_VISUAL_SEEK_TIMEOUT_MS = 10_000 as const;
const SEEK_TARGET_TOLERANCE_SECONDS = 0.15;

export type LocalVideoVisualAnalysisStage =
  | "loading-metadata"
  | "sampling"
  | "scoring"
  | "complete";

export interface LocalVideoVisualAnalysisProgress {
  readonly stage: LocalVideoVisualAnalysisStage;
  readonly completedSampleCount: number;
  readonly totalSampleCount: number;
  readonly currentTimestampMs: number | null;
  readonly ratio: number;
}

export type LocalVideoVisualAnalysisErrorCode =
  | "INVALID_FILE"
  | "ABORTED"
  | "OBJECT_URL_CREATION_FAILED"
  | "VIDEO_CREATION_FAILED"
  | "CANVAS_CREATION_FAILED"
  | "METADATA_LOAD_FAILED"
  | "METADATA_TIMEOUT"
  | "INVALID_DURATION"
  | "SEEK_FAILED"
  | "SEEK_TIMEOUT"
  | "FRAME_CAPTURE_FAILED"
  | "PROGRESS_CALLBACK_FAILED"
  | "CLEANUP_FAILED"
  | "UNEXPECTED_ERROR";

type ErrorDetailValue = string | number | boolean | null;

export class LocalVideoVisualAnalysisError extends Error {
  public readonly code: LocalVideoVisualAnalysisErrorCode;
  public readonly details: Readonly<Record<string, ErrorDetailValue>>;

  public constructor(
    code: LocalVideoVisualAnalysisErrorCode,
    message: string,
    options: {
      readonly details?: Readonly<Record<string, ErrorDetailValue>>;
      readonly cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "LocalVideoVisualAnalysisError";
    this.code = code;
    this.details = options.details ?? {};
  }
}

type VideoEventType = "loadedmetadata" | "seeked" | "error";

export interface LocalVideoVisualProbe {
  src: string;
  preload: string;
  duration: number;
  currentTime: number;
  readonly seeking: boolean;
  readonly readyState: number;
  readonly videoWidth: number;
  readonly videoHeight: number;
  readonly error: { readonly code: number; readonly message?: string } | null;
  addEventListener(type: VideoEventType, listener: EventListener): void;
  removeEventListener(type: VideoEventType, listener: EventListener): void;
  pause(): void;
  removeAttribute(name: "src"): void;
  load(): void;
  remove(): void;
}

export interface LocalVideoVisualCanvas {
  width: number;
  height: number;
  remove(): void;
}

export interface LocalVideoVisualAnalysisAdapters {
  createObjectURL(file: File): string;
  revokeObjectURL(objectUrl: string): void;
  createVideoProbe(): LocalVideoVisualProbe;
  createCanvas(width: number, height: number): LocalVideoVisualCanvas;
  captureLumaFingerprint(
    video: LocalVideoVisualProbe,
    canvas: LocalVideoVisualCanvas,
    width: number,
    height: number,
  ): ArrayLike<number>;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
  yieldControl(): Promise<void>;
}

export interface AnalyzeLocalVideoVisualOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: LocalVideoVisualAnalysisProgress) => void;
  readonly metadataTimeoutMs?: number;
  readonly seekTimeoutMs?: number;
  readonly maxSampleCount?: number;
  readonly maxCandidates?: number;
  readonly adapters?: Partial<LocalVideoVisualAnalysisAdapters>;
}

function createDefaultObjectURL(file: File): string {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("URL.createObjectURL is unavailable.");
  }
  return URL.createObjectURL(file);
}

function revokeDefaultObjectURL(objectUrl: string): void {
  if (typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") {
    throw new Error("URL.revokeObjectURL is unavailable.");
  }
  URL.revokeObjectURL(objectUrl);
}

function requireDocument(): Document {
  if (typeof document === "undefined") {
    throw new Error("The browser document is unavailable.");
  }
  return document;
}

function appendHiddenElement(element: HTMLElement): void {
  const ownerDocument = requireDocument();
  const parent = ownerDocument.body ?? ownerDocument.documentElement;
  if (parent === null) {
    throw new Error("The browser document has no element host.");
  }
  element.hidden = true;
  element.setAttribute("aria-hidden", "true");
  parent.append(element);
}

function createDefaultVideoProbe(): LocalVideoVisualProbe {
  const video = requireDocument().createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.tabIndex = -1;
  appendHiddenElement(video);
  return video;
}

function createDefaultCanvas(width: number, height: number): LocalVideoVisualCanvas {
  const canvas = requireDocument().createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  appendHiddenElement(canvas);
  return canvas;
}

function captureDefaultLumaFingerprint(
  videoResource: LocalVideoVisualProbe,
  canvasResource: LocalVideoVisualCanvas,
  width: number,
  height: number,
): Uint8Array {
  const video = videoResource as HTMLVideoElement;
  const canvas = canvasResource as HTMLCanvasElement;
  if (video.videoWidth <= 0 || video.videoHeight <= 0) {
    throw new Error("The decoded video frame has invalid dimensions.");
  }
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) {
    throw new Error("A 2D canvas context could not be created.");
  }

  context.imageSmoothingEnabled = true;
  context.clearRect(0, 0, width, height);
  context.drawImage(video, 0, 0, width, height);
  const rgba = context.getImageData(0, 0, width, height).data;
  const fingerprint = new Uint8Array(width * height);

  for (let pixelIndex = 0; pixelIndex < fingerprint.length; pixelIndex += 1) {
    const rgbaIndex = pixelIndex * 4;
    const red = rgba[rgbaIndex] ?? 0;
    const green = rgba[rgbaIndex + 1] ?? 0;
    const blue = rgba[rgbaIndex + 2] ?? 0;
    fingerprint[pixelIndex] = Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722);
  }
  return fingerprint;
}

function defaultYieldControl(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

const DEFAULT_ADAPTERS: LocalVideoVisualAnalysisAdapters = {
  createObjectURL: createDefaultObjectURL,
  revokeObjectURL: revokeDefaultObjectURL,
  createVideoProbe: createDefaultVideoProbe,
  createCanvas: createDefaultCanvas,
  captureLumaFingerprint: captureDefaultLumaFingerprint,
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (handle) => window.clearTimeout(handle),
  yieldControl: defaultYieldControl,
};

/**
 * Samples only a tiny luma representation of a local File. The File is bound
 * to a temporary object URL and is never uploaded, fetched, or returned.
 */
export async function analyzeLocalVideoVisuals(
  file: File,
  options: AnalyzeLocalVideoVisualOptions = {},
): Promise<LocalVideoVisualAnalysisResult> {
  assertValidFile(file);
  const adapters = resolveAdapters(options.adapters);
  const metadataTimeoutMs = normalizeTimeout(
    options.metadataTimeoutMs,
    DEFAULT_VISUAL_METADATA_TIMEOUT_MS,
    "metadataTimeoutMs",
  );
  const seekTimeoutMs = normalizeTimeout(
    options.seekTimeoutMs,
    DEFAULT_VISUAL_SEEK_TIMEOUT_MS,
    "seekTimeoutMs",
  );
  const maxSampleCount = clampInteger(
    options.maxSampleCount ?? MAX_VISUAL_SAMPLE_COUNT,
    1,
    MAX_VISUAL_SAMPLE_COUNT,
    MAX_VISUAL_SAMPLE_COUNT,
  );
  const maxCandidates = clampInteger(
    options.maxCandidates ?? MAX_VISUAL_CANDIDATE_COUNT,
    0,
    MAX_VISUAL_CANDIDATE_COUNT,
    MAX_VISUAL_CANDIDATE_COUNT,
  );
  const samples: Array<{ timestampMs: number; fingerprint: Uint8Array }> = [];
  let objectUrl = "";
  let objectUrlWasCreated = false;
  let video: LocalVideoVisualProbe | null = null;
  let canvas: LocalVideoVisualCanvas | null = null;
  let result: LocalVideoVisualAnalysisResult | null = null;
  let operationError: LocalVideoVisualAnalysisError | null = null;

  try {
    throwIfAborted(options.signal);
    emitProgress(options.onProgress, {
      stage: "loading-metadata",
      completedSampleCount: 0,
      totalSampleCount: 0,
      currentTimestampMs: null,
      ratio: 0,
    });
    throwIfAborted(options.signal);

    try {
      objectUrl = adapters.createObjectURL(file);
      objectUrlWasCreated = true;
      if (objectUrl.length === 0) {
        throw new Error("createObjectURL returned an empty string.");
      }
    } catch (cause) {
      throw wrapFailure(
        cause,
        "OBJECT_URL_CREATION_FAILED",
        "선택한 영상의 임시 로컬 주소를 만들지 못했어요.",
      );
    }

    try {
      video = adapters.createVideoProbe();
    } catch (cause) {
      throw wrapFailure(
        cause,
        "VIDEO_CREATION_FAILED",
        "영상을 읽기 위한 브라우저 도구를 만들지 못했어요.",
      );
    }

    try {
      canvas = adapters.createCanvas(
        VISUAL_FINGERPRINT_WIDTH,
        VISUAL_FINGERPRINT_HEIGHT,
      );
    } catch (cause) {
      throw wrapFailure(
        cause,
        "CANVAS_CREATION_FAILED",
        "화면 특징을 비교하기 위한 작은 캔버스를 만들지 못했어요.",
      );
    }

    const durationMs = await loadVideoMetadata(
      video,
      objectUrl,
      metadataTimeoutMs,
      options.signal,
      adapters,
    );
    throwIfAborted(options.signal);
    const sampleTimestamps = buildVisualSampleTimestamps(durationMs, maxSampleCount);
    emitProgress(options.onProgress, {
      stage: "sampling",
      completedSampleCount: 0,
      totalSampleCount: sampleTimestamps.length,
      currentTimestampMs: null,
      ratio: 0,
    });

    for (let index = 0; index < sampleTimestamps.length; index += 1) {
      const timestampMs = sampleTimestamps[index];
      if (timestampMs === undefined) {
        continue;
      }
      throwIfAborted(options.signal);
      await seekVideo(video, timestampMs, seekTimeoutMs, options.signal, adapters);
      throwIfAborted(options.signal);

      let fingerprint: Uint8Array;
      try {
        const captured = adapters.captureLumaFingerprint(
          video,
          canvas,
          VISUAL_FINGERPRINT_WIDTH,
          VISUAL_FINGERPRINT_HEIGHT,
        );
        fingerprint = copyFingerprint(captured);
      } catch (cause) {
        throw wrapFailure(
          cause,
          "FRAME_CAPTURE_FAILED",
          "영상 화면 특징을 읽는 중 문제가 생겼어요.",
          { timestampMs },
        );
      }
      samples.push({ timestampMs, fingerprint });

      emitProgress(options.onProgress, {
        stage: "sampling",
        completedSampleCount: index + 1,
        totalSampleCount: sampleTimestamps.length,
        currentTimestampMs: timestampMs,
        ratio: round(((index + 1) / sampleTimestamps.length) * 0.9, 6),
      });
      throwIfAborted(options.signal);
      await adapters.yieldControl();
      throwIfAborted(options.signal);
    }

    throwIfAborted(options.signal);
    emitProgress(options.onProgress, {
      stage: "scoring",
      completedSampleCount: samples.length,
      totalSampleCount: sampleTimestamps.length,
      currentTimestampMs: null,
      ratio: 0.95,
    });
    throwIfAborted(options.signal);
    result = selectVisualHighlightsFromSamples(samples, durationMs, {
      maxCandidates,
      plannedSampleCount: sampleTimestamps.length,
    });
  } catch (cause) {
    operationError = normalizeOperationError(cause, options.signal);
  }

  const cleanupFailures = cleanupResources(
    video,
    canvas,
    objectUrl,
    objectUrlWasCreated,
    adapters,
  );
  eraseFingerprints(samples);

  if (operationError !== null && cleanupFailures.length > 0) {
    throw new LocalVideoVisualAnalysisError(operationError.code, operationError.message, {
      cause: operationError,
      details: {
        ...operationError.details,
        failedCleanupSteps: cleanupFailures.join(","),
      },
    });
  }
  if (operationError !== null) {
    throw operationError;
  }
  if (cleanupFailures.length > 0) {
    throw new LocalVideoVisualAnalysisError(
      "CLEANUP_FAILED",
      "영상 분석용 임시 자원을 정리하지 못했어요.",
      { details: { failedCleanupSteps: cleanupFailures.join(",") } },
    );
  }
  if (result === null) {
    throw new LocalVideoVisualAnalysisError(
      "UNEXPECTED_ERROR",
      "영상 분석이 결과 없이 끝났어요.",
    );
  }
  throwIfAborted(options.signal);
  emitProgress(options.onProgress, {
    stage: "complete",
    completedSampleCount: result.sampledFrameCount,
    totalSampleCount: result.plannedSampleCount,
    currentTimestampMs: null,
    ratio: 1,
  });
  return result;
}

function resolveAdapters(
  overrides: Partial<LocalVideoVisualAnalysisAdapters> | undefined,
): LocalVideoVisualAnalysisAdapters {
  return { ...DEFAULT_ADAPTERS, ...overrides };
}

function assertValidFile(file: File): void {
  if (
    file === null ||
    typeof file !== "object" ||
    typeof file.name !== "string" ||
    typeof file.type !== "string" ||
    !Number.isFinite(file.size) ||
    file.size < 0
  ) {
    throw new LocalVideoVisualAnalysisError(
      "INVALID_FILE",
      "분석할 로컬 영상 파일이 올바르지 않아요.",
    );
  }
}

function normalizeTimeout(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isFinite(value) || value <= 0 || value > 120_000) {
    throw new RangeError(`${label} must be between 1 and 120000 milliseconds.`);
  }
  return Math.max(1, Math.round(value));
}

function loadVideoMetadata(
  video: LocalVideoVisualProbe,
  objectUrl: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  adapters: LocalVideoVisualAnalysisAdapters,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutHandle: number | null = null;

    const cleanupWait = (): readonly string[] => {
      const failures: string[] = [];
      attemptCleanup(failures, "metadata-listener", () => {
        video.removeEventListener("loadedmetadata", onLoadedMetadata);
      });
      attemptCleanup(failures, "metadata-error-listener", () => {
        video.removeEventListener("error", onError);
      });
      if (signal !== undefined) {
        attemptCleanup(failures, "metadata-abort-listener", () => {
          signal.removeEventListener("abort", onAbort);
        });
      }
      if (timeoutHandle !== null) {
        attemptCleanup(failures, "metadata-timeout", () => {
          adapters.clearTimeout(timeoutHandle as number);
        });
        timeoutHandle = null;
      }
      return failures;
    };
    const finish = (error: LocalVideoVisualAnalysisError | null, durationMs = 0): void => {
      if (settled) {
        return;
      }
      settled = true;
      const cleanupFailures = cleanupWait();
      if (cleanupFailures.length > 0) {
        reject(
          new LocalVideoVisualAnalysisError(
            "CLEANUP_FAILED",
            "영상 메타데이터 대기 자원을 정리하지 못했어요.",
            { details: { failedCleanupSteps: cleanupFailures.join(",") } },
          ),
        );
        return;
      }
      if (error !== null) {
        reject(error);
      } else {
        resolve(durationMs);
      }
    };
    const onLoadedMetadata: EventListener = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        finish(
          new LocalVideoVisualAnalysisError(
            "INVALID_DURATION",
            "영상 길이를 확인하지 못했어요.",
          ),
        );
        return;
      }
      const durationMs = Math.round(video.duration * 1_000);
      if (durationMs <= 0 || durationMs > Number.MAX_SAFE_INTEGER) {
        finish(
          new LocalVideoVisualAnalysisError(
            "INVALID_DURATION",
            "영상 길이가 분석 가능한 범위를 벗어났어요.",
          ),
        );
        return;
      }
      finish(null, durationMs);
    };
    const onError: EventListener = () => {
      finish(mediaFailure("METADATA_LOAD_FAILED", "영상 정보를 불러오지 못했어요.", video));
    };
    const onAbort = (): void => {
      finish(abortedError());
    };

    try {
      video.addEventListener("loadedmetadata", onLoadedMetadata);
      video.addEventListener("error", onError);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted === true) {
        onAbort();
        return;
      }
      timeoutHandle = adapters.setTimeout(() => {
        finish(
          new LocalVideoVisualAnalysisError(
            "METADATA_TIMEOUT",
            "영상 정보를 기다리는 시간이 너무 길어요.",
            { details: { timeoutMs } },
          ),
        );
      }, timeoutMs);
      video.preload = "auto";
      video.src = objectUrl;
      video.load();
    } catch (cause) {
      finish(
        wrapFailure(
          cause,
          "METADATA_LOAD_FAILED",
          "영상 정보를 불러오기 시작하지 못했어요.",
        ),
      );
    }
  });
}

function seekVideo(
  video: LocalVideoVisualProbe,
  timestampMs: number,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  adapters: LocalVideoVisualAnalysisAdapters,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutHandle: number | null = null;
    const targetSeconds = timestampMs / 1_000;

    const cleanupWait = (): readonly string[] => {
      const failures: string[] = [];
      attemptCleanup(failures, "seek-listener", () => {
        video.removeEventListener("seeked", onSeeked);
      });
      attemptCleanup(failures, "seek-error-listener", () => {
        video.removeEventListener("error", onError);
      });
      if (signal !== undefined) {
        attemptCleanup(failures, "seek-abort-listener", () => {
          signal.removeEventListener("abort", onAbort);
        });
      }
      if (timeoutHandle !== null) {
        attemptCleanup(failures, "seek-timeout", () => {
          adapters.clearTimeout(timeoutHandle as number);
        });
        timeoutHandle = null;
      }
      return failures;
    };
    const finish = (error: LocalVideoVisualAnalysisError | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      const cleanupFailures = cleanupWait();
      if (cleanupFailures.length > 0) {
        reject(
          new LocalVideoVisualAnalysisError(
            "CLEANUP_FAILED",
            "영상 탐색 대기 자원을 정리하지 못했어요.",
            { details: { failedCleanupSteps: cleanupFailures.join(",") } },
          ),
        );
        return;
      }
      if (error === null) {
        resolve();
      } else {
        reject(error);
      }
    };
    const onSeeked: EventListener = () => {
      if (
        !video.seeking &&
        video.readyState >= 2 &&
        Math.abs(video.currentTime - targetSeconds) <= SEEK_TARGET_TOLERANCE_SECONDS
      ) {
        finish(null);
      }
    };
    const onError: EventListener = () => {
      finish(mediaFailure("SEEK_FAILED", "영상의 분석 위치로 이동하지 못했어요.", video, {
        timestampMs,
      }));
    };
    const onAbort = (): void => {
      finish(abortedError());
    };

    try {
      video.addEventListener("seeked", onSeeked);
      video.addEventListener("error", onError);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted === true) {
        onAbort();
        return;
      }
      timeoutHandle = adapters.setTimeout(() => {
        finish(
          new LocalVideoVisualAnalysisError(
            "SEEK_TIMEOUT",
            "영상의 분석 위치로 이동하는 시간이 너무 길어요.",
            { details: { timeoutMs, timestampMs } },
          ),
        );
      }, timeoutMs);
      const alreadyAtDecodedTarget =
        !video.seeking &&
        video.readyState >= 2 &&
        Math.abs(video.currentTime - targetSeconds) <= SEEK_TARGET_TOLERANCE_SECONDS;
      if (alreadyAtDecodedTarget) {
        void Promise.resolve().then(() => {
          if (signal?.aborted === true) {
            onAbort();
          } else if (
            !video.seeking &&
            video.readyState >= 2 &&
            Math.abs(video.currentTime - targetSeconds) <= SEEK_TARGET_TOLERANCE_SECONDS
          ) {
            finish(null);
          }
        });
        return;
      }
      video.currentTime = targetSeconds;
    } catch (cause) {
      finish(
        wrapFailure(
          cause,
          "SEEK_FAILED",
          "영상의 분석 위치로 이동하지 못했어요.",
          { timestampMs },
        ),
      );
    }
  });
}

function copyFingerprint(values: ArrayLike<number>): Uint8Array {
  if (values.length !== VISUAL_FINGERPRINT_SIZE) {
    throw new RangeError(
      `Captured fingerprint must contain ${VISUAL_FINGERPRINT_SIZE} values.`,
    );
  }
  const copy = new Uint8Array(VISUAL_FINGERPRINT_SIZE);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined || !Number.isFinite(value) || value < 0 || value > 255) {
      throw new RangeError(`Captured fingerprint value ${index} is invalid.`);
    }
    copy[index] = Math.round(value);
  }
  return copy;
}

function cleanupResources(
  video: LocalVideoVisualProbe | null,
  canvas: LocalVideoVisualCanvas | null,
  objectUrl: string,
  objectUrlWasCreated: boolean,
  adapters: LocalVideoVisualAnalysisAdapters,
): readonly string[] {
  const failures: string[] = [];
  if (video !== null) {
    attemptCleanup(failures, "pause-video", () => {
      video.pause();
    });
    attemptCleanup(failures, "clear-video-source", () => {
      video.removeAttribute("src");
    });
    attemptCleanup(failures, "reset-video", () => {
      video.load();
    });
    attemptCleanup(failures, "remove-video", () => {
      video.remove();
    });
  }
  if (canvas !== null) {
    attemptCleanup(failures, "release-canvas-bitmap", () => {
      canvas.width = 0;
      canvas.height = 0;
    });
    attemptCleanup(failures, "remove-canvas", () => {
      canvas.remove();
    });
  }
  if (objectUrlWasCreated) {
    attemptCleanup(failures, "revoke-object-url", () => {
      adapters.revokeObjectURL(objectUrl);
    });
  }
  return failures;
}

function attemptCleanup(
  failures: string[],
  label: string,
  cleanup: () => void,
): void {
  try {
    cleanup();
  } catch {
    failures.push(label);
  }
}

function eraseFingerprints(
  samples: Array<{ timestampMs: number; fingerprint: Uint8Array }>,
): void {
  for (const sample of samples) {
    sample.fingerprint.fill(0);
  }
  samples.length = 0;
}

function emitProgress(
  callback: ((progress: LocalVideoVisualAnalysisProgress) => void) | undefined,
  progress: LocalVideoVisualAnalysisProgress,
): void {
  if (callback === undefined) {
    return;
  }
  try {
    callback(progress);
  } catch (cause) {
    throw wrapFailure(
      cause,
      "PROGRESS_CALLBACK_FAILED",
      "진행 상황을 전달하는 중 문제가 생겼어요.",
    );
  }
}

function mediaFailure(
  code: "METADATA_LOAD_FAILED" | "SEEK_FAILED",
  message: string,
  video: LocalVideoVisualProbe,
  details: Readonly<Record<string, ErrorDetailValue>> = {},
): LocalVideoVisualAnalysisError {
  return new LocalVideoVisualAnalysisError(code, message, {
    details: {
      ...details,
      mediaErrorCode: video.error?.code ?? 0,
      mediaErrorMessage: video.error?.message ?? "",
    },
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw abortedError();
  }
}

function abortedError(): LocalVideoVisualAnalysisError {
  return new LocalVideoVisualAnalysisError(
    "ABORTED",
    "사용자가 영상 분석을 취소했어요.",
  );
}

function normalizeOperationError(
  cause: unknown,
  signal: AbortSignal | undefined,
): LocalVideoVisualAnalysisError {
  if (cause instanceof LocalVideoVisualAnalysisError) {
    return cause;
  }
  if (signal?.aborted === true || isAbortError(cause)) {
    return abortedError();
  }
  return new LocalVideoVisualAnalysisError(
    "UNEXPECTED_ERROR",
    "로컬 영상 화면 분석 중 예상하지 못한 문제가 생겼어요.",
    { cause },
  );
}

function isAbortError(cause: unknown): boolean {
  return (
    typeof DOMException !== "undefined" &&
    cause instanceof DOMException &&
    cause.name === "AbortError"
  );
}

function wrapFailure(
  cause: unknown,
  code: LocalVideoVisualAnalysisErrorCode,
  message: string,
  details: Readonly<Record<string, ErrorDetailValue>> = {},
): LocalVideoVisualAnalysisError {
  if (cause instanceof LocalVideoVisualAnalysisError) {
    return cause;
  }
  return new LocalVideoVisualAnalysisError(code, message, { cause, details });
}

function clampInteger(
  value: number,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
