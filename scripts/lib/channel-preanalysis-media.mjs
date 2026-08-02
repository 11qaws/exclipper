import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import process from "node:process";

export const CHANNEL_PREANALYSIS_MAX_DURATION_MS = 12 * 60 * 60 * 1_000;
export const CHANNEL_PREANALYSIS_MAX_SOURCE_BYTES = 16 * 1_024 * 1_024 * 1_024;
export const CHANNEL_PREANALYSIS_DOWNLOAD_HEIGHT = 480;
export const CHANNEL_PREANALYSIS_AUDIO_FEATURE_SAMPLE_RATE_HZ = 8_000;
export const CHANNEL_PREANALYSIS_AUDIO_FEATURE_WINDOW_MS = 1_000;
export const CHANNEL_PREANALYSIS_CANDIDATE_SAMPLE_RATE_HZ = 16_000;
export const CHANNEL_PREANALYSIS_CANDIDATE_FRAME_COUNT = 4;
export const CHANNEL_PREANALYSIS_MIN_CANDIDATE_DURATION_MS = 30_000;
export const CHANNEL_PREANALYSIS_MAX_CANDIDATE_DURATION_MS = 60_000;
export const CHANNEL_PREANALYSIS_MAX_JPEG_BYTES = 270_000;
export const CHANNEL_PREANALYSIS_CANDIDATE_MEDIA_PLAN_SCHEMA_VERSION =
  "1.0.0";

const FEATURE_SAMPLES_PER_WINDOW =
  (CHANNEL_PREANALYSIS_AUDIO_FEATURE_SAMPLE_RATE_HZ *
    CHANNEL_PREANALYSIS_AUDIO_FEATURE_WINDOW_MS) /
  1_000;
const SPEECH_BAND_LOW_HZ = 300;
const SPEECH_BAND_HIGH_HZ = 3_400;
const FRAME_SAMPLE_RATIOS = Object.freeze([0.1, 0.37, 0.63, 0.9]);
const MAX_FFPROBE_STDOUT_BYTES = 64 * 1_024;
const MAX_PROCESS_STDERR_BYTES = 64 * 1_024;
const MAX_FFMPEG_STDOUT_DIAGNOSTIC_BYTES = 16 * 1_024;
const DEFAULT_FFPROBE_TIMEOUT_MS = 30_000;
const DEFAULT_FEATURE_EXTRACTION_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_FRAME_EXTRACTION_TIMEOUT_MS = 90_000;
const DEFAULT_CANDIDATE_AUDIO_TIMEOUT_MS = 120_000;
const DEFAULT_MEDIA_DOWNLOAD_TIMEOUT_MS = 45 * 60_000;
const YT_DLP_RETRY_COUNT = "3";
const MAX_PATH_TEXT_LENGTH = 4_096;
const MAX_CANDIDATE_ID_LENGTH = 128;

export class ChannelPreanalysisMediaError extends Error {
  constructor(code, message, cause, diagnostic) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ChannelPreanalysisMediaError";
    this.code = code;
    if (diagnostic !== undefined) this.diagnostic = diagnostic;
  }
}

function mediaError(code, message, cause, diagnostic) {
  return new ChannelPreanalysisMediaError(code, message, cause, diagnostic);
}

function boundedPositiveInteger(value, fallback, fieldName) {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw mediaError("INVALID_LIMIT", `${fieldName} must be a positive integer.`);
  }
  return normalized;
}

function normalizedPath(value, fieldName) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_TEXT_LENGTH ||
    value.includes("\0")
  ) {
    throw mediaError("INVALID_PATH", `${fieldName} is invalid.`);
  }
  return resolve(value);
}

function normalizedCandidateId(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_CANDIDATE_ID_LENGTH ||
    /[\p{Cc}\p{Cf}]/u.test(value)
  ) {
    throw mediaError("INVALID_CANDIDATE", "candidateId is invalid.");
  }
  return value.normalize("NFC");
}

function positiveDurationMs(value, fieldName = "sourceDurationMs") {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw mediaError("INVALID_DURATION", `${fieldName} must be a positive integer.`);
  }
  if (value > CHANNEL_PREANALYSIS_MAX_DURATION_MS) {
    throw mediaError(
      "DURATION_LIMIT",
      `${fieldName} exceeds the 12-hour analysis limit.`,
    );
  }
  return value;
}

async function inspectSourceFile(sourcePath, maximumBytes) {
  const absolutePath = normalizedPath(sourcePath, "sourcePath");
  let metadata;
  try {
    metadata = await lstat(absolutePath);
  } catch (cause) {
    throw mediaError("SOURCE_UNAVAILABLE", "The source media file is unavailable.", cause);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw mediaError("SOURCE_NOT_REGULAR_FILE", "The source media must be a regular file.");
  }
  if (metadata.size <= 0 || metadata.size > maximumBytes) {
    throw mediaError(
      "SOURCE_SIZE_LIMIT",
      `The source media must be between 1 and ${String(maximumBytes)} bytes.`,
    );
  }
  return Object.freeze({ sourcePath: absolutePath, sizeBytes: metadata.size });
}

export function sanitizeChannelPreanalysisMediaDiagnostic(value) {
  return value
    .toString("utf8")
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\b(?:https?|socks5h?):\/\/[^\s"'<>]+/giu, "[redacted-url]")
    .replace(
      /\b(authorization|proxy-authorization|cookie|set-cookie|api[-_ ]?key|token)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      "$1=[redacted]",
    )
    .replace(/\b(?:sk|gsk|AIza)[A-Za-z0-9._~-]{12,}\b/gu, "[redacted-secret]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 500);
}

export function channelPreanalysisMediaDiagnostic(error) {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (
      current instanceof ChannelPreanalysisMediaError &&
      typeof current.diagnostic === "string" &&
      current.diagnostic.length > 0
    ) {
      return sanitizeChannelPreanalysisMediaDiagnostic(current.diagnostic);
    }
    current = typeof current === "object" && current !== null
      ? current.cause
      : null;
  }
  return null;
}

function isYouTubeBotwallDiagnostic(value) {
  return typeof value === "string" &&
    /(sign in to confirm|not a bot|cookies-from-browser|confirm you(?:'|’)re not a bot)/iu.test(
      value,
    );
}

async function consumeBoundedStream(stream, maximumBytes, onChunk, streamName) {
  const chunks = [];
  let byteLength = 0;
  for await (const streamChunk of stream) {
    const chunk = Buffer.isBuffer(streamChunk)
      ? streamChunk
      : Buffer.from(streamChunk);
    byteLength += chunk.byteLength;
    if (byteLength > maximumBytes) {
      throw mediaError(
        "PROCESS_OUTPUT_LIMIT",
        `${streamName} exceeded its ${String(maximumBytes)} byte limit.`,
      );
    }
    if (onChunk === undefined) {
      chunks.push(Buffer.from(chunk));
    } else {
      await onChunk(chunk);
    }
  }
  return {
    bytes: byteLength,
    buffer: onChunk === undefined ? Buffer.concat(chunks, byteLength) : Buffer.alloc(0),
  };
}

function waitForProcessExit(child) {
  return new Promise((resolvePromise, reject) => {
    child.once("error", (cause) => reject(cause));
    child.once("close", (code, signal) => resolvePromise({ code, signal }));
  });
}

/**
 * Runs a process without a shell and places independent bounds on both pipes.
 * Supplying onStdoutChunk keeps stdout streaming: chunks are awaited one at a
 * time and are never accumulated by this runner.
 */
export async function runBoundedMediaCommand(
  command,
  arguments_,
  options = {},
) {
  if (
    typeof command !== "string" ||
    command.length === 0 ||
    !Array.isArray(arguments_) ||
    arguments_.some((argument) => typeof argument !== "string")
  ) {
    throw mediaError("INVALID_COMMAND", "The command and argument list are invalid.");
  }
  const timeoutMs = boundedPositiveInteger(
    options.timeoutMs,
    60_000,
    "timeoutMs",
  );
  const maxStdoutBytes = boundedPositiveInteger(
    options.maxStdoutBytes,
    MAX_FFPROBE_STDOUT_BYTES,
    "maxStdoutBytes",
  );
  const maxStderrBytes = boundedPositiveInteger(
    options.maxStderrBytes,
    MAX_PROCESS_STDERR_BYTES,
    "maxStderrBytes",
  );
  const child = spawn(command, arguments_, {
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: options.environment ?? process.env,
  });
  const stdoutPromise = consumeBoundedStream(
    child.stdout,
    maxStdoutBytes,
    options.onStdoutChunk,
    "stdout",
  );
  const stderrPromise = consumeBoundedStream(
    child.stderr,
    maxStderrBytes,
    undefined,
    "stderr",
  );
  const exitPromise = waitForProcessExit(child);
  let timeoutFailure = null;
  const timer = setTimeout(() => {
    timeoutFailure = mediaError(
      "PROCESS_TIMEOUT",
      `The process exceeded its ${String(timeoutMs)} ms time limit.`,
    );
    child.kill("SIGKILL");
  }, timeoutMs);
  timer.unref();

  try {
    const [stdout, stderr, exit] = await Promise.all([
      stdoutPromise,
      stderrPromise,
      exitPromise,
    ]);
    if (timeoutFailure !== null) throw timeoutFailure;
    if (exit.code !== 0) {
      const diagnostic = sanitizeChannelPreanalysisMediaDiagnostic(stderr.buffer);
      throw mediaError(
        "PROCESS_FAILED",
        `The process failed (${String(exit.code ?? exit.signal)}): ${diagnostic || "no diagnostic"}`,
        undefined,
        diagnostic || undefined,
      );
    }
    return Object.freeze({
      stdout: stdout.buffer,
      stderr: stderr.buffer,
      stdoutBytes: stdout.bytes,
      stderrBytes: stderr.bytes,
    });
  } catch (cause) {
    child.kill("SIGKILL");
    await Promise.allSettled([stdoutPromise, stderrPromise, exitPromise]);
    if (timeoutFailure !== null) throw timeoutFailure;
    if (cause instanceof ChannelPreanalysisMediaError) throw cause;
    throw mediaError("PROCESS_START_FAILED", "The process could not be completed.", cause);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Downloads one bounded analysis copy of an exact YouTube video. The scheduled
 * runner needs speech-quality audio and reviewable frames, not the archival
 * source resolution, so 480p is the highest representation requested. The
 * caller owns outputRoot and can remove it after the review bundle is sealed.
 */
export async function downloadChannelPreanalysisYouTubeMedia(
  {
    videoId,
    watchUrl,
    outputRoot,
  },
  options = {},
) {
  if (
    typeof videoId !== "string" ||
    !/^[A-Za-z0-9_-]{11}$/u.test(videoId) ||
    typeof watchUrl !== "string" ||
    watchUrl !== `https://www.youtube.com/watch?v=${videoId}`
  ) {
    throw mediaError(
      "INVALID_YOUTUBE_IDENTITY",
      "The scheduled media download requires one exact canonical YouTube video.",
    );
  }
  const root = normalizedPath(outputRoot, "outputRoot");
  await mkdir(root, { recursive: true });
  const workingDirectory = await mkdtemp(join(root, `.youtube-${videoId}-`));
  const commandRunner = options.commandRunner ?? runBoundedMediaCommand;
  const maximumBytes = boundedPositiveInteger(
    options.maxSourceBytes,
    CHANNEL_PREANALYSIS_MAX_SOURCE_BYTES,
    "maxSourceBytes",
  );
  try {
    const result = await commandRunner(
      options.ytDlpPath ?? process.env.YT_DLP_PATH ?? "yt-dlp",
      [
        "--no-config",
        "--no-playlist",
        "--no-progress",
        "--no-mtime",
        "--retries",
        YT_DLP_RETRY_COUNT,
        "--fragment-retries",
        YT_DLP_RETRY_COUNT,
        "--extractor-retries",
        YT_DLP_RETRY_COUNT,
        "--file-access-retries",
        YT_DLP_RETRY_COUNT,
        "--format",
        `bestvideo*[height<=${String(CHANNEL_PREANALYSIS_DOWNLOAD_HEIGHT)}]+bestaudio/best[height<=${String(CHANNEL_PREANALYSIS_DOWNLOAD_HEIGHT)}]`,
        "--merge-output-format",
        "mkv",
        "--max-filesize",
        String(maximumBytes),
        "--print",
        "after_move:filepath",
        "--output",
        join(workingDirectory, `${videoId}.%(ext)s`),
        "--",
        watchUrl,
      ],
      {
        timeoutMs: options.timeoutMs ?? DEFAULT_MEDIA_DOWNLOAD_TIMEOUT_MS,
        maxStdoutBytes: 16 * 1_024,
        maxStderrBytes: MAX_PROCESS_STDERR_BYTES,
        environment: options.environment,
      },
    );
    const printedPaths = runnerOutputBuffer(
      result,
      16 * 1_024,
      "yt-dlp",
    )
      .toString("utf8")
      .split(/\r?\n/gu)
      .map((line) => line.trim())
      .filter(Boolean);
    const directoryEntries = await readdir(workingDirectory);
    if (printedPaths.length !== 1 || directoryEntries.length !== 1) {
      throw mediaError(
        "DOWNLOAD_OUTPUT_INVALID",
        "yt-dlp must produce exactly one merged analysis media file.",
      );
    }
    const sourcePath = resolve(printedPaths[0]);
    if (
      sourcePath === workingDirectory ||
      relative(workingDirectory, sourcePath).startsWith("..") ||
      resolve(workingDirectory, directoryEntries[0]) !== sourcePath
    ) {
      throw mediaError(
        "DOWNLOAD_OUTPUT_INVALID",
        "yt-dlp returned a media path outside its isolated working directory.",
      );
    }
    const source = await inspectSourceFile(sourcePath, maximumBytes);
    return Object.freeze({
      ...source,
      workingDirectory,
      representationHeightLimit: CHANNEL_PREANALYSIS_DOWNLOAD_HEIGHT,
    });
  } catch (cause) {
    await rm(workingDirectory, { recursive: true, force: true });
    if (cause instanceof ChannelPreanalysisMediaError) {
      if (
        cause.code === "PROCESS_FAILED" &&
        isYouTubeBotwallDiagnostic(cause.diagnostic ?? cause.message)
      ) {
        throw mediaError(
          "YOUTUBE_BOTWALL",
          "YouTube required an authenticated anti-bot challenge.",
          cause,
          cause.diagnostic,
        );
      }
      throw cause;
    }
    throw mediaError(
      "DOWNLOAD_FAILED",
      "The exact YouTube analysis media could not be downloaded.",
      cause,
    );
  }
}

function runnerOutputBuffer(result, maximumBytes, stage) {
  const value = result?.stdout ?? Buffer.alloc(0);
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  if (buffer.byteLength > maximumBytes) {
    throw mediaError(
      "PROCESS_OUTPUT_LIMIT",
      `${stage} stdout exceeded its ${String(maximumBytes)} byte limit.`,
    );
  }
  return buffer;
}

export async function probeChannelPreanalysisMedia(sourcePath, options = {}) {
  const maximumBytes = boundedPositiveInteger(
    options.maxSourceBytes,
    CHANNEL_PREANALYSIS_MAX_SOURCE_BYTES,
    "maxSourceBytes",
  );
  const source = await inspectSourceFile(sourcePath, maximumBytes);
  const commandRunner = options.commandRunner ?? runBoundedMediaCommand;
  let result;
  try {
    result = await commandRunner(
      options.ffprobePath ?? process.env.FFPROBE_PATH ?? "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        source.sourcePath,
      ],
      {
        shell: false,
        timeoutMs: options.timeoutMs ?? DEFAULT_FFPROBE_TIMEOUT_MS,
        maxStdoutBytes: MAX_FFPROBE_STDOUT_BYTES,
        maxStderrBytes: MAX_PROCESS_STDERR_BYTES,
      },
    );
  } catch (cause) {
    if (cause instanceof ChannelPreanalysisMediaError) throw cause;
    throw mediaError("FFPROBE_FAILED", "ffprobe could not inspect the source media.", cause);
  }
  let parsed;
  try {
    parsed = JSON.parse(
      runnerOutputBuffer(result, MAX_FFPROBE_STDOUT_BYTES, "ffprobe").toString("utf8"),
    );
  } catch (cause) {
    throw mediaError("FFPROBE_INVALID_JSON", "ffprobe returned invalid JSON.", cause);
  }
  const durationSeconds = Number(parsed?.format?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw mediaError("INVALID_DURATION", "ffprobe returned an invalid duration.");
  }
  const durationMs = positiveDurationMs(Math.round(durationSeconds * 1_000));
  return Object.freeze({ ...source, durationMs });
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

class PcmFeatureAccumulator {
  constructor(sourceDurationMs) {
    this.sourceDurationMs = sourceDurationMs;
    this.windows = [];
    this.sampleIndex = 0;
    this.pendingLowByte = null;
    this.current = null;
    this.previousFilterInput = 0;
    this.previousHighPass = 0;
    this.previousLowPass = 0;
    this.highPassAlpha =
      CHANNEL_PREANALYSIS_AUDIO_FEATURE_SAMPLE_RATE_HZ /
      (CHANNEL_PREANALYSIS_AUDIO_FEATURE_SAMPLE_RATE_HZ +
        2 * Math.PI * SPEECH_BAND_LOW_HZ);
    this.lowPassAlpha =
      1 -
      Math.exp(
        (-2 *
          Math.PI *
          Math.min(
            SPEECH_BAND_HIGH_HZ,
            CHANNEL_PREANALYSIS_AUDIO_FEATURE_SAMPLE_RATE_HZ * 0.45,
          )) /
          CHANNEL_PREANALYSIS_AUDIO_FEATURE_SAMPLE_RATE_HZ,
      );
  }

  consumeChunk(chunk) {
    let offset = 0;
    if (this.pendingLowByte !== null && chunk.byteLength > 0) {
      this.consumeInt16(this.pendingLowByte | (chunk[0] << 8));
      this.pendingLowByte = null;
      offset = 1;
    }
    const completeByteCount = chunk.byteLength - ((chunk.byteLength - offset) % 2);
    for (; offset < completeByteCount; offset += 2) {
      this.consumeInt16(chunk[offset] | (chunk[offset + 1] << 8));
    }
    if (offset < chunk.byteLength) this.pendingLowByte = chunk[offset];
  }

  consumeInt16(unsignedValue) {
    const signedValue = unsignedValue >= 0x8000 ? unsignedValue - 0x1_0000 : unsignedValue;
    const value = clamp(signedValue / 32_768, -1, 1);
    const timestampMs =
      (this.sampleIndex * 1_000) /
      CHANNEL_PREANALYSIS_AUDIO_FEATURE_SAMPLE_RATE_HZ;
    const windowIndex = Math.floor(this.sampleIndex / FEATURE_SAMPLES_PER_WINDOW);
    this.sampleIndex += 1;
    if (timestampMs >= this.sourceDurationMs) return;
    if (this.current === null || this.current.windowIndex !== windowIndex) {
      this.flushCurrent();
      this.current = {
        windowIndex,
        startMs: windowIndex * CHANNEL_PREANALYSIS_AUDIO_FEATURE_WINDOW_MS,
        endMs: Math.min(
          this.sourceDurationMs,
          (windowIndex + 1) * CHANNEL_PREANALYSIS_AUDIO_FEATURE_WINDOW_MS,
        ),
        sampleCount: 0,
        sumSquares: 0,
        peak: 0,
        zeroCrossingCount: 0,
        previousValue: null,
        speechBandEnergy: 0,
        totalFilterEnergy: 0,
      };
    }

    const window = this.current;
    const energySquare = value * value;
    window.sampleCount += 1;
    window.sumSquares += energySquare;
    window.peak = Math.max(window.peak, Math.abs(value));
    if (
      window.previousValue !== null &&
      ((window.previousValue < 0 && value >= 0) ||
        (window.previousValue >= 0 && value < 0))
    ) {
      window.zeroCrossingCount += 1;
    }
    window.previousValue = value;

    const highPassed =
      this.highPassAlpha *
      (this.previousHighPass + value - this.previousFilterInput);
    const bandPassed =
      this.previousLowPass +
      this.lowPassAlpha * (highPassed - this.previousLowPass);
    this.previousFilterInput = value;
    this.previousHighPass = highPassed;
    this.previousLowPass = bandPassed;
    window.speechBandEnergy += bandPassed * bandPassed;
    window.totalFilterEnergy += energySquare;
  }

  finish() {
    if (this.pendingLowByte !== null) {
      throw mediaError("TRUNCATED_PCM", "ffmpeg returned a truncated PCM sample.");
    }
    this.flushCurrent();
    return this.windows;
  }

  flushCurrent() {
    const window = this.current;
    if (window === null || window.sampleCount === 0) {
      this.current = null;
      return;
    }
    this.windows.push(
      Object.freeze({
        startMs: window.startMs,
        endMs: window.endMs,
        rms: round(Math.sqrt(window.sumSquares / window.sampleCount), 6),
        peak: round(window.peak, 6),
        zeroCrossingRate: round(
          window.sampleCount > 1
            ? window.zeroCrossingCount / (window.sampleCount - 1)
            : 0,
          6,
        ),
        speechBandEnergyRatio: round(
          window.totalFilterEnergy > 0
            ? clamp(window.speechBandEnergy / window.totalFilterEnergy, 0, 1)
            : 0,
          6,
        ),
      }),
    );
    this.current = null;
  }
}

function secondsArgument(milliseconds) {
  return (milliseconds / 1_000).toFixed(3);
}

export async function extractChannelPreanalysisAudioFeatureWindows(
  sourcePath,
  sourceDurationMs,
  options = {},
) {
  const durationMs = positiveDurationMs(sourceDurationMs);
  const maximumBytes = boundedPositiveInteger(
    options.maxSourceBytes,
    CHANNEL_PREANALYSIS_MAX_SOURCE_BYTES,
    "maxSourceBytes",
  );
  const source = await inspectSourceFile(sourcePath, maximumBytes);
  const commandRunner = options.commandRunner ?? runBoundedMediaCommand;
  const accumulator = new PcmFeatureAccumulator(durationMs);
  const expectedPcmBytes =
    Math.ceil(
      (durationMs * CHANNEL_PREANALYSIS_AUDIO_FEATURE_SAMPLE_RATE_HZ) / 1_000,
    ) * 2;
  const maximumPcmBytes =
    expectedPcmBytes + CHANNEL_PREANALYSIS_AUDIO_FEATURE_SAMPLE_RATE_HZ * 2;
  let decodedByteLength = 0;

  try {
    await commandRunner(
      options.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg",
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        source.sourcePath,
        "-t",
        secondsArgument(durationMs),
        "-map",
        "0:a:0",
        "-vn",
        "-sn",
        "-dn",
        "-ac",
        "1",
        "-af",
        `aresample=${String(CHANNEL_PREANALYSIS_AUDIO_FEATURE_SAMPLE_RATE_HZ)}:async=1:first_pts=0`,
        "-c:a",
        "pcm_s16le",
        "-f",
        "s16le",
        "pipe:1",
      ],
      {
        shell: false,
        timeoutMs:
          options.timeoutMs ?? DEFAULT_FEATURE_EXTRACTION_TIMEOUT_MS,
        maxStdoutBytes: maximumPcmBytes,
        maxStderrBytes: MAX_PROCESS_STDERR_BYTES,
        onStdoutChunk: async (chunk) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          decodedByteLength += buffer.byteLength;
          if (decodedByteLength > maximumPcmBytes) {
            throw mediaError(
              "PROCESS_OUTPUT_LIMIT",
              "Decoded feature PCM exceeded its duration-derived byte limit.",
            );
          }
          accumulator.consumeChunk(buffer);
        },
      },
    );
  } catch (cause) {
    if (cause instanceof ChannelPreanalysisMediaError) throw cause;
    throw mediaError(
      "FEATURE_EXTRACTION_FAILED",
      "ffmpeg could not extract the audio feature stream.",
      cause,
    );
  }
  if (decodedByteLength === 0) {
    throw mediaError("AUDIO_STREAM_EMPTY", "The source media did not yield an audio stream.");
  }
  const windows = Object.freeze(accumulator.finish());
  const plannedWindowCount = Math.ceil(
    durationMs / CHANNEL_PREANALYSIS_AUDIO_FEATURE_WINDOW_MS,
  );
  return Object.freeze({
    sourcePath: source.sourcePath,
    sourceDurationMs: durationMs,
    sampleRateHz: CHANNEL_PREANALYSIS_AUDIO_FEATURE_SAMPLE_RATE_HZ,
    featureWindowMs: CHANNEL_PREANALYSIS_AUDIO_FEATURE_WINDOW_MS,
    decodedSampleCount: decodedByteLength / 2,
    plannedWindowCount,
    analyzedWindowCount: windows.length,
    coverageComplete: windows.length === plannedWindowCount,
    windows,
  });
}

function candidateFrameTimestamps(startMs, endMs, focusMs) {
  const durationMs = endMs - startMs;
  if (focusMs !== undefined) {
    if (!Number.isFinite(focusMs)) {
      throw mediaError("INVALID_CANDIDATE", "focusMs must be finite when provided.");
    }
    const relativeFocusMs = Math.min(
      durationMs - 1,
      Math.max(0, Math.round(focusMs - startMs)),
    );
    const preferredOffsets = [
      relativeFocusMs - 6_000,
      relativeFocusMs - 1_500,
      relativeFocusMs + 1_500,
      relativeFocusMs + 6_000,
    ];
    const fallbackOffsets = FRAME_SAMPLE_RATIOS.map((ratio) =>
      Math.round((durationMs - 1) * ratio),
    );
    return [
      ...new Set(
        [...preferredOffsets, ...fallbackOffsets, 0, durationMs - 1].map(
          (offset) => Math.min(durationMs - 1, Math.max(0, offset)),
        ),
      ),
    ]
      .slice(0, CHANNEL_PREANALYSIS_CANDIDATE_FRAME_COUNT)
      .sort((left, right) => left - right);
  }
  return [
    ...new Set(
      FRAME_SAMPLE_RATIOS.map((ratio) =>
        Math.min(durationMs - 1, Math.round(durationMs * ratio)),
      ),
    ),
  ];
}

function assertContainedPath(parentPath, childPath, fieldName) {
  const pathFromParent = relative(parentPath, childPath);
  if (
    pathFromParent.length === 0 ||
    pathFromParent === ".." ||
    pathFromParent.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(pathFromParent)
  ) {
    throw mediaError("INVALID_OUTPUT_PATH", `${fieldName} escapes its output root.`);
  }
}

export function createChannelPreanalysisCandidateMediaPlan({
  candidateId,
  sourcePath,
  sourceDurationMs,
  startMs,
  endMs,
  focusMs,
  outputRoot,
}) {
  const normalizedId = normalizedCandidateId(candidateId);
  const normalizedSourcePath = normalizedPath(sourcePath, "sourcePath");
  const normalizedOutputRoot = normalizedPath(outputRoot, "outputRoot");
  const normalizedSourceDurationMs = positiveDurationMs(sourceDurationMs);
  if (
    !Number.isSafeInteger(startMs) ||
    !Number.isSafeInteger(endMs) ||
    startMs < 0 ||
    endMs <= startMs ||
    endMs > normalizedSourceDurationMs
  ) {
    throw mediaError("INVALID_CANDIDATE", "The candidate range is outside the source media.");
  }
  const durationMs = endMs - startMs;
  if (
    durationMs < CHANNEL_PREANALYSIS_MIN_CANDIDATE_DURATION_MS ||
    durationMs > CHANNEL_PREANALYSIS_MAX_CANDIDATE_DURATION_MS
  ) {
    throw mediaError(
      "INVALID_CANDIDATE",
      "Candidate duration must be between 30 and 60 seconds.",
    );
  }
  const relativeTimestamps = candidateFrameTimestamps(startMs, endMs, focusMs);
  if (
    relativeTimestamps.length !== CHANNEL_PREANALYSIS_CANDIDATE_FRAME_COUNT ||
    new Set(relativeTimestamps).size !== CHANNEL_PREANALYSIS_CANDIDATE_FRAME_COUNT
  ) {
    throw mediaError("INVALID_CANDIDATE", "Four distinct frame timestamps are required.");
  }
  const directoryKey = createHash("sha256")
    .update(
      JSON.stringify({
        candidateId: normalizedId,
        sourcePath: normalizedSourcePath,
        startMs,
        endMs,
      }),
    )
    .digest("hex")
    .slice(0, 24);
  const outputDirectory = join(normalizedOutputRoot, `candidate-${directoryKey}`);
  const workingDirectory = join(
    normalizedOutputRoot,
    `.candidate-${directoryKey}.partial`,
  );
  assertContainedPath(normalizedOutputRoot, outputDirectory, "outputDirectory");
  assertContainedPath(normalizedOutputRoot, workingDirectory, "workingDirectory");
  const frames = Object.freeze(
    relativeTimestamps.map((relativeTimestampMs, index) =>
      Object.freeze({
        index,
        relativeTimestampMs,
        sourceTimestampMs: startMs + relativeTimestampMs,
        outputPath: join(outputDirectory, `frame-${String(index + 1).padStart(2, "0")}.jpg`),
        workingPath: join(workingDirectory, `frame-${String(index + 1).padStart(2, "0")}.jpg`),
      }),
    ),
  );
  return Object.freeze({
    schemaVersion: CHANNEL_PREANALYSIS_CANDIDATE_MEDIA_PLAN_SCHEMA_VERSION,
    candidateId: normalizedId,
    sourcePath: normalizedSourcePath,
    sourceDurationMs: normalizedSourceDurationMs,
    startMs,
    endMs,
    durationMs,
    outputRoot: normalizedOutputRoot,
    outputDirectory,
    workingDirectory,
    frames,
    audio: Object.freeze({
      sampleRateHz: CHANNEL_PREANALYSIS_CANDIDATE_SAMPLE_RATE_HZ,
      outputPath: join(outputDirectory, "candidate.wav"),
      workingPath: join(workingDirectory, "candidate.wav"),
    }),
  });
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function ensureSafeOutputRoot(outputRoot) {
  await mkdir(outputRoot, { recursive: true });
  const metadata = await lstat(outputRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw mediaError("INVALID_OUTPUT_PATH", "outputRoot must be a regular directory.");
  }
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function validateJpeg(path) {
  const metadata = await lstat(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 4 ||
    metadata.size > CHANNEL_PREANALYSIS_MAX_JPEG_BYTES
  ) {
    throw mediaError("JPEG_SIZE_LIMIT", "A candidate JPEG is missing or exceeds its byte limit.");
  }
  const bytes = await readFile(path);
  if (
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9
  ) {
    throw mediaError("INVALID_JPEG", "ffmpeg did not produce a bounded JPEG image.");
  }
  return Object.freeze({ byteLength: metadata.size, sha256: await sha256File(path) });
}

function canonicalPcmWavHeader(dataByteLength, sampleRateHz) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataByteLength, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRateHz, 24);
  header.writeUInt32LE(sampleRateHz * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataByteLength, 40);
  return header;
}

function validateCandidatePlan(plan) {
  if (
    plan?.schemaVersion !==
      CHANNEL_PREANALYSIS_CANDIDATE_MEDIA_PLAN_SCHEMA_VERSION ||
    !Object.isFrozen(plan) ||
    !Array.isArray(plan.frames) ||
    plan.frames.length !== CHANNEL_PREANALYSIS_CANDIDATE_FRAME_COUNT ||
    new Set(plan.frames.map(({ relativeTimestampMs }) => relativeTimestampMs)).size !==
      CHANNEL_PREANALYSIS_CANDIDATE_FRAME_COUNT
  ) {
    throw mediaError("INVALID_MEDIA_PLAN", "The candidate media plan is invalid.");
  }
  positiveDurationMs(plan.sourceDurationMs);
  assertContainedPath(plan.outputRoot, plan.outputDirectory, "outputDirectory");
  assertContainedPath(plan.outputRoot, plan.workingDirectory, "workingDirectory");
  for (const frame of plan.frames) {
    assertContainedPath(plan.outputDirectory, frame.outputPath, "frame.outputPath");
    assertContainedPath(plan.workingDirectory, frame.workingPath, "frame.workingPath");
  }
  assertContainedPath(plan.outputDirectory, plan.audio.outputPath, "audio.outputPath");
  assertContainedPath(plan.workingDirectory, plan.audio.workingPath, "audio.workingPath");
}

async function extractCandidateWav(plan, commandRunner, ffmpegPath, timeoutMs) {
  const expectedSampleCount = Math.round(
    (plan.durationMs * CHANNEL_PREANALYSIS_CANDIDATE_SAMPLE_RATE_HZ) / 1_000,
  );
  const maximumDataBytes = expectedSampleCount * 2;
  let dataByteLength = 0;
  const handle = await open(plan.audio.workingPath, "wx");
  try {
    await handle.write(Buffer.alloc(44));
    await commandRunner(
      ffmpegPath,
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        secondsArgument(plan.startMs),
        "-t",
        secondsArgument(plan.durationMs),
        "-i",
        plan.sourcePath,
        "-map",
        "0:a:0",
        "-vn",
        "-sn",
        "-dn",
        "-ac",
        "1",
        "-af",
        [
          `aresample=${String(CHANNEL_PREANALYSIS_CANDIDATE_SAMPLE_RATE_HZ)}:async=1:first_pts=0`,
          `apad=pad_len=${String(expectedSampleCount)}`,
          `atrim=end_sample=${String(expectedSampleCount)}`,
          "asetpts=N/SR/TB",
        ].join(","),
        "-c:a",
        "pcm_s16le",
        "-f",
        "s16le",
        "pipe:1",
      ],
      {
        shell: false,
        timeoutMs,
        maxStdoutBytes: maximumDataBytes,
        maxStderrBytes: MAX_PROCESS_STDERR_BYTES,
        onStdoutChunk: async (chunk) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          dataByteLength += buffer.byteLength;
          if (dataByteLength > maximumDataBytes) {
            throw mediaError(
              "WAV_SIZE_LIMIT",
              "Candidate PCM exceeded its duration-derived byte limit.",
            );
          }
          await handle.write(buffer);
        },
      },
    );
    if (dataByteLength !== maximumDataBytes) {
      throw mediaError(
        "INVALID_WAV",
        "ffmpeg did not return the exact duration-derived candidate PCM length.",
      );
    }
    await handle.write(
      canonicalPcmWavHeader(
        dataByteLength,
        CHANNEL_PREANALYSIS_CANDIDATE_SAMPLE_RATE_HZ,
      ),
      0,
      44,
      0,
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
  const metadata = await lstat(plan.audio.workingPath);
  if (!metadata.isFile() || metadata.size !== 44 + dataByteLength) {
    throw mediaError("INVALID_WAV", "The candidate WAV receipt did not match its PCM payload.");
  }
  return Object.freeze({
    path: plan.audio.outputPath,
    byteLength: metadata.size,
    dataByteLength,
    sampleCount: expectedSampleCount,
    sampleRateHz: CHANNEL_PREANALYSIS_CANDIDATE_SAMPLE_RATE_HZ,
    sha256: await sha256File(plan.audio.workingPath),
  });
}

/**
 * Executes a complete candidate bundle in a sibling staging directory. The
 * final directory appears only after all four JPEGs and the WAV are verified.
 */
export async function executeChannelPreanalysisCandidateMediaPlan(
  plan,
  options = {},
) {
  validateCandidatePlan(plan);
  const maximumBytes = boundedPositiveInteger(
    options.maxSourceBytes,
    CHANNEL_PREANALYSIS_MAX_SOURCE_BYTES,
    "maxSourceBytes",
  );
  await inspectSourceFile(plan.sourcePath, maximumBytes);
  await ensureSafeOutputRoot(plan.outputRoot);
  if (await pathExists(plan.outputDirectory)) {
    throw mediaError("OUTPUT_ALREADY_EXISTS", "The immutable candidate bundle already exists.");
  }
  await rm(plan.workingDirectory, { recursive: true, force: true });
  await mkdir(plan.workingDirectory);
  const commandRunner = options.commandRunner ?? runBoundedMediaCommand;
  const ffmpegPath = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg";
  const frameReceipts = [];

  try {
    for (const frame of plan.frames) {
      try {
        await commandRunner(
          ffmpegPath,
          [
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            secondsArgument(frame.sourceTimestampMs),
            "-i",
            plan.sourcePath,
            "-map",
            "0:v:0",
            "-frames:v",
            "1",
            "-vf",
            "scale=640:640:force_original_aspect_ratio=decrease:force_divisible_by=2",
            "-q:v",
            "5",
            "-an",
            "-sn",
            "-dn",
            "-f",
            "image2",
            "-n",
            frame.workingPath,
          ],
          {
            shell: false,
            timeoutMs:
              options.frameTimeoutMs ?? DEFAULT_FRAME_EXTRACTION_TIMEOUT_MS,
            maxStdoutBytes: MAX_FFMPEG_STDOUT_DIAGNOSTIC_BYTES,
            maxStderrBytes: MAX_PROCESS_STDERR_BYTES,
          },
        );
      } catch (cause) {
        throw mediaError(
          "FRAME_EXTRACTION_FAILED",
          `ffmpeg could not extract candidate frame ${String(frame.index + 1)}.`,
          cause,
        );
      }
      const receipt = await validateJpeg(frame.workingPath);
      frameReceipts.push(
        Object.freeze({
          index: frame.index,
          relativeTimestampMs: frame.relativeTimestampMs,
          sourceTimestampMs: frame.sourceTimestampMs,
          path: frame.outputPath,
          ...receipt,
        }),
      );
    }

    let audioReceipt;
    try {
      audioReceipt = await extractCandidateWav(
        plan,
        commandRunner,
        ffmpegPath,
        options.audioTimeoutMs ?? DEFAULT_CANDIDATE_AUDIO_TIMEOUT_MS,
      );
    } catch (cause) {
      if (
        cause instanceof ChannelPreanalysisMediaError &&
        ["INVALID_WAV", "WAV_SIZE_LIMIT"].includes(cause.code)
      ) {
        throw cause;
      }
      throw mediaError(
        "AUDIO_EXTRACTION_FAILED",
        "ffmpeg could not extract candidate audio.",
        cause,
      );
    }
    await rename(plan.workingDirectory, plan.outputDirectory);
    return Object.freeze({
      schemaVersion: CHANNEL_PREANALYSIS_CANDIDATE_MEDIA_PLAN_SCHEMA_VERSION,
      candidateId: plan.candidateId,
      sourcePath: plan.sourcePath,
      startMs: plan.startMs,
      endMs: plan.endMs,
      outputDirectory: plan.outputDirectory,
      frames: Object.freeze(frameReceipts),
      audio: audioReceipt,
    });
  } catch (cause) {
    await rm(plan.workingDirectory, { recursive: true, force: true }).catch(
      () => undefined,
    );
    if (cause instanceof ChannelPreanalysisMediaError) throw cause;
    throw mediaError(
      "CANDIDATE_MEDIA_EXTRACTION_FAILED",
      "The candidate media bundle could not be completed.",
      cause,
    );
  }
}
