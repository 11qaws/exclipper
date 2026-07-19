export const DEFAULT_LOCAL_MEDIA_PREFLIGHT_TIMEOUT_MS = 15_000;
export const MAX_LOCAL_MEDIA_DURATION_MS = 12 * 60 * 60 * 1_000;

export type LocalMediaKind = "video" | "audio" | "unknown";

/**
 * This is a preflight recommendation based only on API presence. A later
 * benchmark is responsible for promoting `wasm` to a concrete WASM tier.
 */
export type PreferredPreflightRuntimeTier = "webgpu" | "wasm" | "signals-only";

export interface LocalMediaMetadata {
  readonly name: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly durationMs: number;
  readonly kind: LocalMediaKind;
  readonly extension: string | null;
}

export interface BrowserCapabilitySupport {
  readonly webAssembly: boolean;
  readonly worker: boolean;
  readonly webCodecsVideoDecoder: boolean;
  readonly webGpu: boolean;
  readonly crossOriginIsolated: boolean;
}

export interface BrowserCapabilitySnapshot extends BrowserCapabilitySupport {
  readonly preferredRuntimeTier: PreferredPreflightRuntimeTier;
}

export interface LocalMediaPreflightResult {
  readonly metadata: LocalMediaMetadata;
  readonly capabilities: BrowserCapabilitySnapshot;
}

export type LocalMediaPreflightErrorCode =
  | "ABORTED"
  | "INVALID_FILE"
  | "INVALID_OPTIONS"
  | "CAPABILITY_DETECTION_FAILED"
  | "OBJECT_URL_UNAVAILABLE"
  | "OBJECT_URL_CREATION_FAILED"
  | "VIDEO_PROBE_UNAVAILABLE"
  | "VIDEO_PROBE_CREATION_FAILED"
  | "PROBE_SETUP_FAILED"
  | "METADATA_TIMEOUT"
  | "METADATA_LOAD_FAILED"
  | "INVALID_DURATION"
  | "DURATION_LIMIT_EXCEEDED"
  | "CLEANUP_FAILED"
  | "UNEXPECTED_ERROR";

export class LocalMediaPreflightError extends Error {
  public readonly code: LocalMediaPreflightErrorCode;
  public readonly originalCause: unknown;
  public readonly details: Readonly<Record<string, string | number | boolean | null>>;

  public constructor(
    code: LocalMediaPreflightErrorCode,
    message: string,
    options: {
      readonly cause?: unknown;
      readonly details?: Readonly<Record<string, string | number | boolean | null>>;
    } = {},
  ) {
    super(message);
    this.name = "LocalMediaPreflightError";
    this.code = code;
    this.originalCause = options.cause;
    this.details = options.details ?? {};
  }
}

type ProbeEventType = "loadedmetadata" | "error";
type ProbeEventListener = () => void;

/**
 * The deliberately small structural surface needed from HTMLVideoElement.
 * Tests can implement it without jsdom, while a real HTMLVideoElement satisfies
 * the contract in the browser.
 */
export interface LocalMediaVideoProbe {
  src: string;
  preload: string;
  readonly duration: number;
  readonly error?: {
    readonly code: number;
    readonly message?: string;
  } | null;
  addEventListener(type: ProbeEventType, listener: ProbeEventListener): void;
  removeEventListener(type: ProbeEventType, listener: ProbeEventListener): void;
  pause(): void;
  removeAttribute(name: "src"): void;
  load(): void;
}

export interface LocalMediaPreflightAdapters {
  createObjectURL(file: File): string;
  revokeObjectURL(objectUrl: string): void;
  createVideoProbe(): LocalMediaVideoProbe;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
  readBrowserCapabilities(): BrowserCapabilitySupport;
}

export interface InspectLocalMediaOptions {
  readonly timeoutMs?: number;
  readonly adapters?: Partial<LocalMediaPreflightAdapters>;
  readonly signal?: AbortSignal;
}

type CapabilityGlobal = {
  readonly WebAssembly?: unknown;
  readonly Worker?: unknown;
  readonly VideoDecoder?: unknown;
  readonly navigator?: {
    readonly gpu?: unknown;
  };
  readonly crossOriginIsolated?: unknown;
};

type DocumentGlobal = {
  readonly document?: {
    createElement(tagName: "video"): HTMLVideoElement;
  };
};

function readDefaultBrowserCapabilities(): BrowserCapabilitySupport {
  const browserGlobal = globalThis as unknown as CapabilityGlobal;

  return {
    webAssembly: typeof browserGlobal.WebAssembly !== "undefined",
    worker: typeof browserGlobal.Worker === "function",
    webCodecsVideoDecoder: typeof browserGlobal.VideoDecoder === "function",
    webGpu: typeof browserGlobal.navigator?.gpu !== "undefined",
    crossOriginIsolated: browserGlobal.crossOriginIsolated === true,
  };
}

function createDefaultObjectURL(file: File): string {
  const urlApi = globalThis.URL;
  if (typeof urlApi?.createObjectURL !== "function") {
    throw new LocalMediaPreflightError(
      "OBJECT_URL_UNAVAILABLE",
      "This browser cannot create a temporary URL for the selected file.",
    );
  }

  return urlApi.createObjectURL(file);
}

function revokeDefaultObjectURL(objectUrl: string): void {
  const urlApi = globalThis.URL;
  if (typeof urlApi?.revokeObjectURL === "function") {
    urlApi.revokeObjectURL(objectUrl);
  }
}

function createDefaultVideoProbe(): LocalMediaVideoProbe {
  const browserGlobal = globalThis as unknown as DocumentGlobal;
  if (typeof browserGlobal.document?.createElement !== "function") {
    throw new LocalMediaPreflightError(
      "VIDEO_PROBE_UNAVAILABLE",
      "A browser video element is required to inspect local media metadata.",
    );
  }

  return browserGlobal.document.createElement("video");
}

const DEFAULT_ADAPTERS: LocalMediaPreflightAdapters = {
  createObjectURL: createDefaultObjectURL,
  revokeObjectURL: revokeDefaultObjectURL,
  createVideoProbe: createDefaultVideoProbe,
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => {
    const clear = globalThis.clearTimeout as unknown as (timeoutHandle: unknown) => void;
    clear(handle);
  },
  readBrowserCapabilities: readDefaultBrowserCapabilities,
};

function resolveAdapters(
  overrides: Partial<LocalMediaPreflightAdapters> | undefined,
): LocalMediaPreflightAdapters {
  return {
    ...DEFAULT_ADAPTERS,
    ...overrides,
  };
}

function normalizeCapabilities(support: BrowserCapabilitySupport): BrowserCapabilitySnapshot {
  // Treat malformed injected/runtime values conservatively instead of turning an
  // uncertain capability into a support claim.
  const normalized: BrowserCapabilitySupport = {
    webAssembly: support.webAssembly === true,
    worker: support.worker === true,
    webCodecsVideoDecoder: support.webCodecsVideoDecoder === true,
    webGpu: support.webGpu === true,
    crossOriginIsolated: support.crossOriginIsolated === true,
  };

  let preferredRuntimeTier: PreferredPreflightRuntimeTier = "signals-only";
  if (normalized.worker && normalized.webGpu) {
    preferredRuntimeTier = "webgpu";
  } else if (normalized.worker && normalized.webAssembly) {
    preferredRuntimeTier = "wasm";
  }

  return {
    ...normalized,
    preferredRuntimeTier,
  };
}

function assertValidFile(file: File): void {
  const candidate = file as Partial<Pick<File, "name" | "size" | "type">> | null | undefined;
  if (
    candidate == null ||
    typeof candidate.name !== "string" ||
    typeof candidate.type !== "string" ||
    typeof candidate.size !== "number" ||
    !Number.isSafeInteger(candidate.size) ||
    candidate.size < 0
  ) {
    throw new LocalMediaPreflightError(
      "INVALID_FILE",
      "The selected value is not a readable browser File.",
    );
  }
}

function resolveTimeoutMs(timeoutMs: number | undefined): number {
  const resolved = timeoutMs ?? DEFAULT_LOCAL_MEDIA_PREFLIGHT_TIMEOUT_MS;
  if (!Number.isFinite(resolved) || resolved <= 0 || !Number.isSafeInteger(resolved)) {
    throw new LocalMediaPreflightError(
      "INVALID_OPTIONS",
      "The metadata timeout must be a positive whole number of milliseconds.",
      { details: { timeoutMs: Number.isFinite(resolved) ? resolved : String(resolved) } },
    );
  }

  return resolved;
}

function extensionFromName(name: string): string | null {
  const finalPathPart = name.split(/[\\/]/u).at(-1) ?? name;
  const finalDotIndex = finalPathPart.lastIndexOf(".");

  if (finalDotIndex <= 0 || finalDotIndex === finalPathPart.length - 1) {
    return null;
  }

  return finalPathPart.slice(finalDotIndex + 1).toLowerCase();
}

const VIDEO_EXTENSIONS = new Set([
  "avi",
  "flv",
  "m2ts",
  "m4v",
  "mkv",
  "mov",
  "mp4",
  "mpeg",
  "mpg",
  "ts",
  "webm",
  "wmv",
]);

const AUDIO_EXTENSIONS = new Set([
  "aac",
  "flac",
  "m4a",
  "mp3",
  "ogg",
  "opus",
  "wav",
]);

function kindFromFile(mimeType: string, extension: string | null): LocalMediaKind {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized.startsWith("video/")) {
    return "video";
  }
  if (normalized.startsWith("audio/")) {
    return "audio";
  }
  if (extension !== null && VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }
  if (extension !== null && AUDIO_EXTENSIONS.has(extension)) {
    return "audio";
  }
  return "unknown";
}

function durationSecondsToMilliseconds(durationSeconds: number): number {
  const durationMs = Math.round(durationSeconds * 1_000);
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds < 0 ||
    !Number.isSafeInteger(durationMs)
  ) {
    throw new LocalMediaPreflightError(
      "INVALID_DURATION",
      "The browser loaded metadata but did not report a finite media duration.",
      {
        details: {
          durationSeconds: Number.isFinite(durationSeconds)
            ? durationSeconds
            : String(durationSeconds),
        },
      },
    );
  }

  return durationMs;
}

function wrapAdapterFailure(
  cause: unknown,
  code: LocalMediaPreflightErrorCode,
  message: string,
): LocalMediaPreflightError {
  if (cause instanceof LocalMediaPreflightError) {
    return cause;
  }
  return new LocalMediaPreflightError(code, message, { cause });
}

type ProbeWaitState = {
  timeoutWasScheduled: boolean;
  timeoutHandle: unknown;
  loadedMetadataListenerWasAdded: boolean;
  errorListenerWasAdded: boolean;
  onLoadedMetadata: ProbeEventListener | null;
  onError: ProbeEventListener | null;
  abortListenerWasAdded: boolean;
  onAbort: (() => void) | null;
};

function createProbeWaitState(): ProbeWaitState {
  return {
    timeoutWasScheduled: false,
    timeoutHandle: undefined,
    loadedMetadataListenerWasAdded: false,
    errorListenerWasAdded: false,
    onLoadedMetadata: null,
    onError: null,
    abortListenerWasAdded: false,
    onAbort: null,
  };
}

function waitForLoadedMetadata(
  probe: LocalMediaVideoProbe,
  objectUrl: string,
  timeoutMs: number,
  adapters: LocalMediaPreflightAdapters,
  waitState: ProbeWaitState,
  signal: AbortSignal | undefined,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let settled = false;

    const resolveOnce = (durationSeconds: number): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(durationSeconds);
    };

    const rejectOnce = (error: LocalMediaPreflightError): void => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    waitState.onLoadedMetadata = () => {
      try {
        // Reading duration is intentionally delayed until loadedmetadata.
        const durationSeconds = probe.duration;
        durationSecondsToMilliseconds(durationSeconds);
        resolveOnce(durationSeconds);
      } catch (cause) {
        rejectOnce(
          cause instanceof LocalMediaPreflightError
            ? cause
            : new LocalMediaPreflightError(
                "INVALID_DURATION",
                "The browser could not provide a valid media duration.",
                { cause },
              ),
        );
      }
    };

    waitState.onError = () => {
      const mediaError = probe.error;
      rejectOnce(
        new LocalMediaPreflightError(
          "METADATA_LOAD_FAILED",
          "The browser could not load metadata from the selected media file.",
          {
            details: {
              mediaErrorCode: mediaError?.code ?? null,
              mediaErrorMessage: mediaError?.message || null,
            },
          },
        ),
      );
    };

    waitState.onAbort = () => {
      rejectOnce(
        new LocalMediaPreflightError(
          "ABORTED",
          "Local media inspection was cancelled.",
        ),
      );
    };

    if (signal?.aborted === true) {
      waitState.onAbort();
      return;
    }

    try {
      probe.addEventListener("loadedmetadata", waitState.onLoadedMetadata);
      waitState.loadedMetadataListenerWasAdded = true;
      probe.addEventListener("error", waitState.onError);
      waitState.errorListenerWasAdded = true;
      if (signal !== undefined) {
        signal.addEventListener("abort", waitState.onAbort, { once: true });
        waitState.abortListenerWasAdded = true;
      }

      waitState.timeoutWasScheduled = true;
      waitState.timeoutHandle = adapters.setTimeout(() => {
        rejectOnce(
          new LocalMediaPreflightError(
            "METADATA_TIMEOUT",
            `Media metadata did not load within ${timeoutMs} milliseconds.`,
            { details: { timeoutMs } },
          ),
        );
      }, timeoutMs);

      if (settled) {
        return;
      }

      probe.preload = "metadata";
      probe.src = objectUrl;
      probe.load();
    } catch (cause) {
      rejectOnce(
        wrapAdapterFailure(
          cause,
          "PROBE_SETUP_FAILED",
          "The browser media probe could not be started.",
        ),
      );
    }
  });
}

function cleanupResources(
  probe: LocalMediaVideoProbe | null,
  objectUrl: string | null,
  objectUrlWasCreated: boolean,
  adapters: LocalMediaPreflightAdapters,
  waitState: ProbeWaitState,
  signal: AbortSignal | undefined,
): LocalMediaPreflightError | null {
  const failures: string[] = [];
  const attempt = (label: string, action: () => void): void => {
    try {
      action();
    } catch {
      failures.push(label);
    }
  };

  if (
    probe !== null &&
    waitState.loadedMetadataListenerWasAdded &&
    waitState.onLoadedMetadata !== null
  ) {
    attempt("remove-loadedmetadata-listener", () => {
      probe.removeEventListener("loadedmetadata", waitState.onLoadedMetadata as ProbeEventListener);
    });
  }

  if (probe !== null && waitState.errorListenerWasAdded && waitState.onError !== null) {
    attempt("remove-error-listener", () => {
      probe.removeEventListener("error", waitState.onError as ProbeEventListener);
    });
  }

  if (
    signal !== undefined &&
    waitState.abortListenerWasAdded &&
    waitState.onAbort !== null
  ) {
    attempt("remove-abort-listener", () => {
      signal.removeEventListener("abort", waitState.onAbort as () => void);
    });
  }

  if (waitState.timeoutWasScheduled) {
    attempt("clear-timeout", () => {
      adapters.clearTimeout(waitState.timeoutHandle);
    });
  }

  if (probe !== null) {
    attempt("pause-probe", () => {
      probe.pause();
    });
    attempt("clear-probe-src", () => {
      probe.removeAttribute("src");
    });
    attempt("reset-probe", () => {
      probe.load();
    });
  }

  if (objectUrlWasCreated && objectUrl !== null) {
    attempt("revoke-object-url", () => {
      adapters.revokeObjectURL(objectUrl);
    });
  }

  if (failures.length === 0) {
    return null;
  }

  return new LocalMediaPreflightError(
    "CLEANUP_FAILED",
    "Local media inspection finished, but one or more temporary resources could not be released.",
    { details: { failedCleanupSteps: failures.join(",") } },
  );
}

/**
 * Reads browser-local media metadata without retaining the File or its temporary
 * object URL. API-presence flags are not codec support claims; actual decoding
 * and performance are verified by later probes and benchmarks.
 */
export async function inspectLocalMedia(
  file: File,
  options: InspectLocalMediaOptions = {},
): Promise<LocalMediaPreflightResult> {
  assertValidFile(file);
  const timeoutMs = resolveTimeoutMs(options.timeoutMs);
  const adapters = resolveAdapters(options.adapters);
  const waitState = createProbeWaitState();

  let objectUrl: string | null = null;
  let objectUrlWasCreated = false;
  let probe: LocalMediaVideoProbe | null = null;
  let operationError: LocalMediaPreflightError | null = null;
  let result: LocalMediaPreflightResult | null = null;

  try {
    let capabilities: BrowserCapabilitySnapshot;
    try {
      capabilities = normalizeCapabilities(adapters.readBrowserCapabilities());
    } catch (cause) {
      throw wrapAdapterFailure(
        cause,
        "CAPABILITY_DETECTION_FAILED",
        "Browser capabilities could not be inspected.",
      );
    }

    try {
      objectUrl = adapters.createObjectURL(file);
      objectUrlWasCreated = true;
      if (typeof objectUrl !== "string" || objectUrl.length === 0) {
        throw new Error("createObjectURL returned an empty value");
      }
    } catch (cause) {
      throw wrapAdapterFailure(
        cause,
        "OBJECT_URL_CREATION_FAILED",
        "A temporary URL could not be created for the selected file.",
      );
    }

    try {
      probe = adapters.createVideoProbe();
    } catch (cause) {
      throw wrapAdapterFailure(
        cause,
        "VIDEO_PROBE_CREATION_FAILED",
        "A browser video probe could not be created.",
      );
    }

    const durationSeconds = await waitForLoadedMetadata(
      probe,
      objectUrl,
      timeoutMs,
      adapters,
      waitState,
      options.signal,
    );
    const durationMs = durationSecondsToMilliseconds(durationSeconds);
    if (durationMs > MAX_LOCAL_MEDIA_DURATION_MS) {
      throw new LocalMediaPreflightError(
        "DURATION_LIMIT_EXCEEDED",
        "The selected recording is longer than the supported 12-hour maximum.",
        {
          details: {
            durationMs,
            maximumDurationMs: MAX_LOCAL_MEDIA_DURATION_MS,
          },
        },
      );
    }
    const mimeType = file.type.trim().toLowerCase();
    const extension = extensionFromName(file.name);

    result = {
      metadata: {
        name: file.name,
        sizeBytes: file.size,
        mimeType,
        durationMs,
        kind: kindFromFile(mimeType, extension),
        extension,
      },
      capabilities,
    };
  } catch (cause) {
    operationError =
      cause instanceof LocalMediaPreflightError
        ? cause
        : new LocalMediaPreflightError(
            "UNEXPECTED_ERROR",
            "Local media inspection failed unexpectedly.",
            { cause },
          );
  }

  // The try block never returns and the catch block never rethrows, so every
  // success and failure path reaches this single cleanup barrier.
  const cleanupError = cleanupResources(
    probe,
    objectUrl,
    objectUrlWasCreated,
    adapters,
    waitState,
    options.signal,
  );

  if (operationError !== null) {
    throw operationError;
  }
  if (cleanupError !== null) {
    throw cleanupError;
  }
  if (result === null) {
    throw new LocalMediaPreflightError(
      "UNEXPECTED_ERROR",
      "Local media inspection finished without a result.",
    );
  }

  return result;
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`${label} must be a finite non-negative number.`);
  }
}

function trimTrailingZeroes(value: number, fractionDigits: number): string {
  return value.toFixed(fractionDigits).replace(/\.0+$/u, "").replace(/(\.\d*?)0+$/u, "$1");
}

export function formatBytes(bytes: number): string {
  assertNonNegativeFinite(bytes, "bytes");
  if (bytes < 1_024) {
    return `${trimTrailingZeroes(bytes, Number.isInteger(bytes) ? 0 : 2)} B`;
  }

  const units = ["KB", "MB", "GB", "TB", "PB"] as const;
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1_024)) - 1, units.length - 1);
  const value = bytes / 1_024 ** (unitIndex + 1);
  const fractionDigits = value >= 100 ? 0 : value >= 10 ? 1 : 2;

  return `${trimTrailingZeroes(value, fractionDigits)} ${units[unitIndex]}`;
}

export function formatDuration(durationMs: number): string {
  assertNonNegativeFinite(durationMs, "durationMs");
  const totalSeconds = Math.floor(durationMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}
