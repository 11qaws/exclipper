import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import console from "node:console";
import { performance } from "node:perf_hooks";
import process from "node:process";

import { selectAudioReactionHighlights } from "../src/media/localAudioReactionAnalysisCore.ts";

const SAMPLE_RATE_HZ = 8_000;
const FEATURE_WINDOW_MS = 1_000;
const SAMPLES_PER_WINDOW = SAMPLE_RATE_HZ;
const SPEECH_BAND_LOW_HZ = 300;
const SPEECH_BAND_HIGH_HZ = 3_400;
const MAX_PROBE_OUTPUT_BYTES = 64 * 1_024;

class ProcessFailure extends Error {
  constructor(stage, code = null) {
    super(`${stage} process failed.`);
    this.name = "ProcessFailure";
    this.stage = stage;
    this.code = code;
  }
}

class StreamingFeatureAccumulator {
  constructor(sourceDurationMs) {
    this.sourceDurationMs = sourceDurationMs;
    this.windows = [];
    this.sampleIndex = 0;
    this.current = null;
    this.previousFilterInput = 0;
    this.previousHighPass = 0;
    this.previousLowPass = 0;
    this.highPassAlpha =
      SAMPLE_RATE_HZ / (SAMPLE_RATE_HZ + 2 * Math.PI * SPEECH_BAND_LOW_HZ);
    this.lowPassAlpha =
      1 -
      Math.exp(
        (-2 * Math.PI * Math.min(SPEECH_BAND_HIGH_HZ, SAMPLE_RATE_HZ * 0.45)) /
          SAMPLE_RATE_HZ,
      );
  }

  consume(valueFromDecoder) {
    const timestampMs = (this.sampleIndex * 1_000) / SAMPLE_RATE_HZ;
    const windowIndex = Math.floor(this.sampleIndex / SAMPLES_PER_WINDOW);
    this.sampleIndex += 1;

    if (timestampMs < 0 || timestampMs >= this.sourceDurationMs) {
      return;
    }
    if (this.current === null || this.current.windowIndex !== windowIndex) {
      this.flushCurrent();
      this.current = {
        windowIndex,
        startMs: windowIndex * FEATURE_WINDOW_MS,
        endMs: Math.min(
          this.sourceDurationMs,
          (windowIndex + 1) * FEATURE_WINDOW_MS,
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

    const value = clamp(Number.isFinite(valueFromDecoder) ? valueFromDecoder : 0, -1, 1);
    const energySquare = clamp(value * value, 0, 1);
    const absolutePeak = Math.abs(value);
    const window = this.current;
    window.sampleCount += 1;
    window.sumSquares += energySquare;
    window.peak = Math.max(window.peak, absolutePeak);
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
    this.flushCurrent();
    return this.windows;
  }

  flushCurrent() {
    const window = this.current;
    if (window === null || window.sampleCount === 0) {
      this.current = null;
      return;
    }
    this.windows.push({
      startMs: window.startMs,
      endMs: window.endMs,
      rms: round(
        clamp(Math.sqrt(window.sumSquares / window.sampleCount), 0, 1),
        6,
      ),
      peak: round(clamp(window.peak, 0, 1), 6),
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
    });
    this.current = null;
  }
}

async function probeDurationMs(ffprobePath, videoPath) {
  const output = await captureStdout(
    ffprobePath,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      "--",
      videoPath,
    ],
    "ffprobe",
  );
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new ProcessFailure("ffprobe-json");
  }
  const seconds = Number(parsed?.format?.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new ProcessFailure("ffprobe-duration");
  }
  return Math.round(seconds * 1_000);
}

async function decodeFeatures(ffmpegPath, videoPath, sourceDurationMs) {
  const child = spawn(
    ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-i",
      videoPath,
      "-map",
      "0:a:0",
      "-vn",
      "-sn",
      "-dn",
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE_HZ),
      "-c:a",
      "pcm_f32le",
      "-f",
      "f32le",
      "pipe:1",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const completion = waitForChild(child, "ffmpeg");
  child.stderr.resume();

  const accumulator = new StreamingFeatureAccumulator(sourceDurationMs);
  let carry = Buffer.alloc(0);
  let decodedByteCount = 0;

  try {
    for await (const streamChunk of child.stdout) {
      const chunk = Buffer.isBuffer(streamChunk)
        ? streamChunk
        : Buffer.from(streamChunk);
      decodedByteCount += chunk.byteLength;
      const bytes =
        carry.byteLength === 0 ? chunk : Buffer.concat([carry, chunk]);
      const completeByteCount = bytes.byteLength - (bytes.byteLength % 4);
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        completeByteCount,
      );
      for (let offset = 0; offset < completeByteCount; offset += 4) {
        accumulator.consume(view.getFloat32(offset, true));
      }
      // Only an incomplete float (at most three bytes) crosses stream chunks.
      // No decoded PCM chunk is retained or written to disk.
      carry = Buffer.from(bytes.subarray(completeByteCount));
    }
    await completion;
  } catch (error) {
    child.kill();
    await completion.catch(() => undefined);
    throw error;
  }

  if (carry.byteLength !== 0) {
    throw new ProcessFailure("ffmpeg-truncated-float");
  }
  return {
    windows: accumulator.finish(),
    decodedSampleCount: decodedByteCount / 4,
  };
}

async function captureStdout(command, args, stage) {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const completion = waitForChild(child, stage);
  child.stderr.resume();
  const chunks = [];
  let byteCount = 0;

  try {
    for await (const chunk of child.stdout) {
      byteCount += chunk.byteLength;
      if (byteCount > MAX_PROBE_OUTPUT_BYTES) {
        child.kill();
        throw new ProcessFailure(`${stage}-output-limit`);
      }
      chunks.push(Buffer.from(chunk));
    }
    await completion;
  } catch (error) {
    child.kill();
    await completion.catch(() => undefined);
    throw error;
  }
  return Buffer.concat(chunks).toString("utf8");
}

function waitForChild(child, stage) {
  return new Promise((resolve, reject) => {
    child.once("error", () => reject(new ProcessFailure(`${stage}-spawn`)));
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new ProcessFailure(stage, code));
      }
    });
  });
}

function candidateSummary(candidate) {
  return {
    startMs: candidate.startMs,
    peakMs: candidate.peakMs,
    endMs: candidate.endMs,
    score: candidate.score,
    evidence: candidate.evidence,
  };
}

function failureSummary(error) {
  if (error instanceof ProcessFailure) {
    return {
      error: "local-audio-fast-pass-evaluation-failed",
      stage: error.stage,
      ...(Number.isInteger(error.code) ? { processExitCode: error.code } : {}),
    };
  }
  return {
    error: "local-audio-fast-pass-evaluation-failed",
    stage: "unexpected",
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function amplitudeToDb(value) {
  return Math.max(-100, 20 * Math.log10(Math.max(0.00001, value)));
}

function percentile(sortedValues, quantile) {
  if (sortedValues.length === 0) {
    return 0;
  }
  const position = (sortedValues.length - 1) * quantile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sortedValues[lowerIndex] ?? 0;
  const upper = sortedValues[upperIndex] ?? lower;
  return lower + (upper - lower) * (position - lowerIndex);
}

async function main() {
  const [videoPath, ffmpegPath = "ffmpeg", ffprobePath = "ffprobe"] =
    process.argv.slice(2);
  if (videoPath === undefined) {
    console.error(
      "Usage: node --experimental-strip-types scripts/evaluate-local-audio-fast-pass.mjs <video> [ffmpeg] [ffprobe]",
    );
    process.exitCode = 2;
    return;
  }

  const startedAt = performance.now();
  const sourceDurationMs = await probeDurationMs(ffprobePath, videoPath);

  // Evaluation limitation: ffmpeg downmixes to mono before this process sees
  // samples. The browser accumulator preserves per-channel energy and peak,
  // using its downmix only for zero-crossing and speech-band filtering. Thus
  // anti-phase or strongly asymmetric stereo will not be numerically identical.
  // ffmpeg also resamples to 8 kHz whereas the browser currently strides decoded
  // frames toward 8 kHz, so this is representative fast-pass telemetry rather
  // than a golden-vector parity test.
  const decoded = await decodeFeatures(ffmpegPath, videoPath, sourceDurationMs);
  const plannedWindowCount = Math.ceil(sourceDurationMs / FEATURE_WINDOW_MS);
  const result = selectAudioReactionHighlights(
    decoded.windows,
    sourceDurationMs,
    { plannedWindowCount },
  );
  const elapsedMs = Math.round(performance.now() - startedAt);
  const crestDbValues = decoded.windows
    .map((window) => amplitudeToDb(window.peak) - amplitudeToDb(window.rms))
    .sort((left, right) => left - right);
  const highCrestWindowCount = decoded.windows.filter(
    (window) =>
      !(window.rms <= 0.0025 && window.peak <= 0.015) &&
      amplitudeToDb(window.peak) - amplitudeToDb(window.rms) >= 14,
  ).length;
  const summary = {
    schemaVersion: "local-audio-fast-pass-evaluation-v2",
    mode: result.mode,
    featureWindowMs: FEATURE_WINDOW_MS,
    sampleRateHz: SAMPLE_RATE_HZ,
    sourceDurationMs,
    elapsedMs,
    realTimeFactor: round(elapsedMs / sourceDurationMs, 6),
    decodedSampleCount: decoded.decodedSampleCount,
    rawPcmPersisted: false,
    plannedWindowCount: result.plannedWindowCount,
    analyzedWindowCount: result.analyzedWindowCount,
    coverageComplete: result.coverageComplete,
    candidateWindowMs: result.candidateWindowMs,
    candidateCount: result.candidates.length,
    diagnostics: {
      ...result.diagnostics,
      impulseLikeWindowRatio: round(
        result.diagnostics.impulseLikeWindowCount /
          Math.max(1, result.analyzedWindowCount),
        6,
      ),
      highCrestWindowCount,
      highCrestWindowRatio: round(
        highCrestWindowCount / Math.max(1, result.analyzedWindowCount),
        6,
      ),
      crestDbP50: round(percentile(crestDbValues, 0.5), 3),
      crestDbP90: round(percentile(crestDbValues, 0.9), 3),
      crestDbP95: round(percentile(crestDbValues, 0.95), 3),
    },
    candidates: result.candidates.map(candidateSummary),
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  console.error(JSON.stringify(failureSummary(error)));
  process.exitCode = 1;
});
