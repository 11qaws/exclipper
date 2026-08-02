import { Buffer } from "node:buffer";

import {
  createChannelPreanalysisVisualAnchorDescriptor,
  hammingDistance64,
  parseChannelPreanalysisVisualFingerprint,
} from "../../src/analysis/channelPreanalysisVisualFingerprint.ts";
import {
  CHANNEL_PREANALYSIS_VISUAL_COVERAGE_ALGORITHM,
  CHANNEL_PREANALYSIS_VISUAL_COVERAGE_MAX_SEEDS,
  CHANNEL_PREANALYSIS_VISUAL_COVERAGE_SAMPLE_INTERVAL_MS,
  CHANNEL_PREANALYSIS_VISUAL_COVERAGE_SCHEMA_VERSION,
  channelPreanalysisVisualCoveragePlannedSampleCount,
  validateChannelPreanalysisVisualCoverageReceipt,
} from "../../src/analysis/channelPreanalysisVisualCoverage.ts";
import { runBoundedMediaCommand } from "./channel-preanalysis-media.mjs";

const FRAME_WIDTH = 32;
const FRAME_HEIGHT = 18;
const FRAME_BYTES = FRAME_WIDTH * FRAME_HEIGHT;
const DEFAULT_SCAN_TIMEOUT_MS = 30 * 60_000;
const MAX_PROCESS_STDERR_BYTES = 64 * 1_024;
const MIN_VISUAL_CHANGE_SCORE = 0.14;
const VISUAL_SEED_SEPARATION_MS = 60_000;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export class ChannelPreanalysisVisualCoverageScanError extends Error {
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ChannelPreanalysisVisualCoverageScanError";
    this.code = code;
  }
}

function scanError(code, message, cause) {
  return new ChannelPreanalysisVisualCoverageScanError(code, message, cause);
}

function secondsArgument(milliseconds) {
  return (milliseconds / 1_000).toFixed(3);
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
}

function descriptorChange(left, right) {
  const hashDistance =
    hammingDistance64(left.dHash64, right.dHash64) +
    hammingDistance64(left.blockHash64, right.blockHash64);
  return round(
    (hashDistance / 128) * 0.8 +
      (Math.abs(left.meanLuma - right.meanLuma) / 255) * 0.12 +
      (Math.abs(left.edgeEnergy - right.edgeEnergy) / 255) * 0.08,
  );
}

/**
 * Turns the strongest distributed frame changes into a small visual-only
 * reservoir. These are never final clips: each one still needs four complete
 * frames, audio, full broadcast context and Candidate Pass B verification.
 */
export function selectChannelPreanalysisVisualCandidateSeeds(
  descriptors,
  sourceDurationMs,
) {
  const changes = descriptors.slice(1).map((descriptor, index) => ({
    timestampMs: descriptor.timestampMs,
    score: descriptorChange(descriptors[index], descriptor),
  }));
  const threshold = Math.max(
    MIN_VISUAL_CHANGE_SCORE,
    percentile(changes.map(({ score }) => score), 0.9),
  );
  const selected = [];
  for (const change of changes
    .filter(({ score }) => score >= threshold)
    .sort((left, right) => right.score - left.score || left.timestampMs - right.timestampMs)) {
    if (
      selected.some(
        ({ timestampMs }) =>
          Math.abs(timestampMs - change.timestampMs) < VISUAL_SEED_SEPARATION_MS,
      )
    ) {
      continue;
    }
    selected.push(change);
    if (selected.length >= CHANNEL_PREANALYSIS_VISUAL_COVERAGE_MAX_SEEDS) break;
  }
  return Object.freeze(
    selected
      .sort((left, right) => left.timestampMs - right.timestampMs)
      .map((change, index) =>
        Object.freeze({
          seedId: `visual-change-${String(index + 1)}-${String(change.timestampMs)}`,
          startMs: Math.max(0, change.timestampMs - 22_500),
          endMs: Math.min(sourceDurationMs, change.timestampMs + 22_500),
          focusMs: change.timestampMs,
          score: round(Math.min(0.96, 0.5 + change.score), 4),
          eventKo: "화면 흐름에서 큰 장면 변화가 감지된 구간",
          whyKo: "소리 크기와 무관하게 화면의 사건이나 스트리머 반응이 바뀌었을 가능성을 확인합니다.",
          evidenceKo: `5초 간격 화면 변화 점수 ${change.score.toFixed(3)}`,
        }),
      ),
  );
}

class LumaFrameAccumulator {
  constructor(sourceDurationMs, plannedSampleCount) {
    this.sourceDurationMs = sourceDurationMs;
    this.plannedSampleCount = plannedSampleCount;
    this.pending = Buffer.alloc(0);
    this.descriptors = [];
  }

  consume(chunk) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const combined = this.pending.length === 0
      ? bytes
      : Buffer.concat([this.pending, bytes]);
    let offset = 0;
    while (combined.length - offset >= FRAME_BYTES) {
      const sampleIndex = this.descriptors.length;
      if (sampleIndex >= this.plannedSampleCount) {
        throw scanError(
          "VISUAL_SAMPLE_OVERFLOW",
          "ffmpeg returned more visual samples than the bounded plan.",
        );
      }
      const timestampMs =
        sampleIndex * CHANNEL_PREANALYSIS_VISUAL_COVERAGE_SAMPLE_INTERVAL_MS;
      this.descriptors.push(
        createChannelPreanalysisVisualAnchorDescriptor({
          timestampMs,
          luma: combined.subarray(offset, offset + FRAME_BYTES),
          width: FRAME_WIDTH,
          height: FRAME_HEIGHT,
        }),
      );
      offset += FRAME_BYTES;
    }
    this.pending = Buffer.from(combined.subarray(offset));
  }

  finish() {
    if (this.pending.length !== 0) {
      throw scanError(
        "VISUAL_SAMPLE_TRUNCATED",
        "ffmpeg returned a partial visual coverage frame.",
      );
    }
    if (this.descriptors.length !== this.plannedSampleCount) {
      throw scanError(
        "VISUAL_COVERAGE_INCOMPLETE",
        `Visual coverage produced ${String(this.descriptors.length)} of ${String(this.plannedSampleCount)} planned samples.`,
      );
    }
    return Object.freeze(this.descriptors);
  }
}

/**
 * Decodes the exact downloaded source once at 5-second cadence. The tiny luma
 * frames are consumed as a stream, so even a 12-hour source stays bounded.
 */
export async function extractChannelPreanalysisVisualCoverage(
  sourcePath,
  sourceDurationMs,
  {
    videoId,
    sourceFingerprint,
    sourceFingerprintArtifact,
    ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg",
    commandRunner = runBoundedMediaCommand,
    timeoutMs = DEFAULT_SCAN_TIMEOUT_MS,
  } = {},
) {
  const fingerprint = parseChannelPreanalysisVisualFingerprint(sourceFingerprint);
  if (
    typeof sourcePath !== "string" ||
    sourcePath.length === 0 ||
    fingerprint.videoId !== videoId ||
    fingerprint.sourceDurationMs !== sourceDurationMs ||
    sourceFingerprintArtifact?.artifactId !==
      `youtube-storyboard-visual-fingerprint:${videoId}:v1` ||
    sourceFingerprintArtifact?.videoId !== videoId ||
    sourceFingerprintArtifact?.kind !== "fingerprint" ||
    typeof sourceFingerprintArtifact?.contentDigest !== "string" ||
    !SHA256_PATTERN.test(sourceFingerprintArtifact.contentDigest)
  ) {
    throw scanError(
      "VISUAL_IDENTITY_INVALID",
      "Visual coverage is not bound to the exact storyboard fingerprint.",
    );
  }
  const plannedSampleCount =
    channelPreanalysisVisualCoveragePlannedSampleCount(sourceDurationMs);
  const accumulator = new LumaFrameAccumulator(
    sourceDurationMs,
    plannedSampleCount,
  );
  try {
    await commandRunner(
      ffmpegPath,
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        sourcePath,
        "-t",
        secondsArgument(sourceDurationMs),
        "-map",
        "0:v:0",
        "-an",
        "-sn",
        "-dn",
        "-vf",
        `fps=fps=1/${String(CHANNEL_PREANALYSIS_VISUAL_COVERAGE_SAMPLE_INTERVAL_MS / 1_000)}:start_time=0:round=near:eof_action=pass,scale=${String(FRAME_WIDTH)}:${String(FRAME_HEIGHT)}:flags=area,format=gray`,
        "-pix_fmt",
        "gray",
        "-f",
        "rawvideo",
        "pipe:1",
      ],
      {
        timeoutMs,
        maxStdoutBytes: (plannedSampleCount + 1) * FRAME_BYTES,
        maxStderrBytes: MAX_PROCESS_STDERR_BYTES,
        onStdoutChunk: async (chunk) => accumulator.consume(chunk),
      },
    );
  } catch (cause) {
    if (cause instanceof ChannelPreanalysisVisualCoverageScanError) throw cause;
    throw scanError(
      "VISUAL_COVERAGE_EXTRACTION_FAILED",
      "The distributed visual coverage scan did not complete.",
      cause,
    );
  }
  const descriptors = accumulator.finish();
  const seeds = selectChannelPreanalysisVisualCandidateSeeds(
    descriptors,
    sourceDurationMs,
  );
  const receipt = validateChannelPreanalysisVisualCoverageReceipt(
    {
      schemaVersion: CHANNEL_PREANALYSIS_VISUAL_COVERAGE_SCHEMA_VERSION,
      algorithm: CHANNEL_PREANALYSIS_VISUAL_COVERAGE_ALGORITHM,
      status: "complete",
      sourceDurationMs,
      sampleIntervalMs: CHANNEL_PREANALYSIS_VISUAL_COVERAGE_SAMPLE_INTERVAL_MS,
      plannedSampleCount,
      analyzedSampleCount: descriptors.length,
      firstSampleTimestampMs: 0,
      lastSampleTimestampMs:
        (plannedSampleCount - 1) *
        CHANNEL_PREANALYSIS_VISUAL_COVERAGE_SAMPLE_INTERVAL_MS,
      coveredThroughMs: sourceDurationMs,
      gaps: [],
      sourceFingerprintArtifactId: sourceFingerprintArtifact.artifactId,
      sourceFingerprintDigest: sourceFingerprintArtifact.contentDigest,
      visualSeedCount: seeds.length,
      visualSeedTimestampsMs: seeds.map(({ focusMs }) => focusMs),
    },
    { sourceDurationMs, videoId },
  );
  return Object.freeze({ receipt, seeds });
}
