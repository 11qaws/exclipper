import { canonicalChannelPreanalysisVisualFingerprintArtifactId } from "./channelPreanalysisVisualFingerprint";

export const CHANNEL_PREANALYSIS_VISUAL_COVERAGE_SCHEMA_VERSION =
  "1.0.0" as const;
export const CHANNEL_PREANALYSIS_VISUAL_COVERAGE_ALGORITHM =
  "ffmpeg-luma-32x18-5s-v1" as const;
export const CHANNEL_PREANALYSIS_VISUAL_COVERAGE_SAMPLE_INTERVAL_MS =
  5_000 as const;
export const CHANNEL_PREANALYSIS_VISUAL_COVERAGE_MAX_SEEDS = 4 as const;

const MAX_SOURCE_DURATION_MS = 12 * 60 * 60_000;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;

export interface ChannelPreanalysisVisualCoverageReceipt {
  readonly schemaVersion: typeof CHANNEL_PREANALYSIS_VISUAL_COVERAGE_SCHEMA_VERSION;
  readonly algorithm: typeof CHANNEL_PREANALYSIS_VISUAL_COVERAGE_ALGORITHM;
  readonly status: "complete";
  readonly sourceDurationMs: number;
  readonly sampleIntervalMs: typeof CHANNEL_PREANALYSIS_VISUAL_COVERAGE_SAMPLE_INTERVAL_MS;
  readonly plannedSampleCount: number;
  readonly analyzedSampleCount: number;
  readonly firstSampleTimestampMs: 0;
  readonly lastSampleTimestampMs: number;
  readonly coveredThroughMs: number;
  readonly gaps: readonly [];
  readonly sourceFingerprintArtifactId: string;
  readonly sourceFingerprintDigest: `sha256:${string}`;
  readonly visualSeedCount: number;
  readonly visualSeedTimestampsMs: readonly number[];
}

export class ChannelPreanalysisVisualCoverageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ChannelPreanalysisVisualCoverageError";
  }
}

function fail(message: string): never {
  throw new ChannelPreanalysisVisualCoverageError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

export function channelPreanalysisVisualCoveragePlannedSampleCount(
  sourceDurationMs: number,
): number {
  if (
    !Number.isSafeInteger(sourceDurationMs) ||
    sourceDurationMs <= 0 ||
    sourceDurationMs > MAX_SOURCE_DURATION_MS
  ) {
    fail("Visual coverage source duration is invalid.");
  }
  // Mirrors ffmpeg's `fps=...:round=near` output count. The final partial
  // interval is represented only when at least half of it exists.
  return Math.max(
    1,
    Math.round(
      sourceDurationMs / CHANNEL_PREANALYSIS_VISUAL_COVERAGE_SAMPLE_INTERVAL_MS,
    ),
  );
}

export function createChannelPreanalysisVisualCoverageReceipt(input: {
  readonly sourceDurationMs: number;
  readonly videoId: string;
  readonly sourceFingerprintDigest: `sha256:${string}`;
  readonly visualSeedTimestampsMs: readonly number[];
}): ChannelPreanalysisVisualCoverageReceipt {
  const plannedSampleCount = channelPreanalysisVisualCoveragePlannedSampleCount(
    input.sourceDurationMs,
  );
  return validateChannelPreanalysisVisualCoverageReceipt(
    {
      schemaVersion: CHANNEL_PREANALYSIS_VISUAL_COVERAGE_SCHEMA_VERSION,
      algorithm: CHANNEL_PREANALYSIS_VISUAL_COVERAGE_ALGORITHM,
      status: "complete",
      sourceDurationMs: input.sourceDurationMs,
      sampleIntervalMs: CHANNEL_PREANALYSIS_VISUAL_COVERAGE_SAMPLE_INTERVAL_MS,
      plannedSampleCount,
      analyzedSampleCount: plannedSampleCount,
      firstSampleTimestampMs: 0,
      lastSampleTimestampMs:
        (plannedSampleCount - 1) *
        CHANNEL_PREANALYSIS_VISUAL_COVERAGE_SAMPLE_INTERVAL_MS,
      coveredThroughMs: input.sourceDurationMs,
      gaps: [],
      sourceFingerprintArtifactId:
        canonicalChannelPreanalysisVisualFingerprintArtifactId(input.videoId),
      sourceFingerprintDigest: input.sourceFingerprintDigest,
      visualSeedCount: input.visualSeedTimestampsMs.length,
      visualSeedTimestampsMs: input.visualSeedTimestampsMs,
    },
    { sourceDurationMs: input.sourceDurationMs, videoId: input.videoId },
  );
}

export function validateChannelPreanalysisVisualCoverageReceipt(
  value: unknown,
  expected: { readonly sourceDurationMs: number; readonly videoId: string },
): ChannelPreanalysisVisualCoverageReceipt {
  const plannedSampleCount = channelPreanalysisVisualCoveragePlannedSampleCount(
    expected.sourceDurationMs,
  );
  if (!VIDEO_ID_PATTERN.test(expected.videoId)) {
    fail("Visual coverage video identity is invalid.");
  }
  const expectedLastTimestampMs =
    (plannedSampleCount - 1) *
    CHANNEL_PREANALYSIS_VISUAL_COVERAGE_SAMPLE_INTERVAL_MS;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "algorithm",
      "status",
      "sourceDurationMs",
      "sampleIntervalMs",
      "plannedSampleCount",
      "analyzedSampleCount",
      "firstSampleTimestampMs",
      "lastSampleTimestampMs",
      "coveredThroughMs",
      "gaps",
      "sourceFingerprintArtifactId",
      "sourceFingerprintDigest",
      "visualSeedCount",
      "visualSeedTimestampsMs",
    ]) ||
    value.schemaVersion !== CHANNEL_PREANALYSIS_VISUAL_COVERAGE_SCHEMA_VERSION ||
    value.algorithm !== CHANNEL_PREANALYSIS_VISUAL_COVERAGE_ALGORITHM ||
    value.status !== "complete" ||
    value.sourceDurationMs !== expected.sourceDurationMs ||
    value.sampleIntervalMs !==
      CHANNEL_PREANALYSIS_VISUAL_COVERAGE_SAMPLE_INTERVAL_MS ||
    value.plannedSampleCount !== plannedSampleCount ||
    value.analyzedSampleCount !== plannedSampleCount ||
    value.firstSampleTimestampMs !== 0 ||
    value.lastSampleTimestampMs !== expectedLastTimestampMs ||
    value.coveredThroughMs !== expected.sourceDurationMs ||
    !Array.isArray(value.gaps) ||
    value.gaps.length !== 0 ||
    value.sourceFingerprintArtifactId !==
      canonicalChannelPreanalysisVisualFingerprintArtifactId(expected.videoId) ||
    typeof value.sourceFingerprintDigest !== "string" ||
    !SHA256_PATTERN.test(value.sourceFingerprintDigest) ||
    !Number.isSafeInteger(value.visualSeedCount) ||
    (value.visualSeedCount as number) < 0 ||
    (value.visualSeedCount as number) >
      CHANNEL_PREANALYSIS_VISUAL_COVERAGE_MAX_SEEDS ||
    !Array.isArray(value.visualSeedTimestampsMs) ||
    value.visualSeedTimestampsMs.length !== value.visualSeedCount ||
    value.visualSeedTimestampsMs.some(
      (timestampMs, index, timestamps) =>
        !Number.isSafeInteger(timestampMs) ||
        (timestampMs as number) < 0 ||
        (timestampMs as number) >= expected.sourceDurationMs ||
        (index > 0 &&
          (timestampMs as number) <= (timestamps[index - 1] as number)),
    )
  ) {
    fail("Visual coverage receipt is not closed over the complete sampling plan.");
  }
  return value as unknown as ChannelPreanalysisVisualCoverageReceipt;
}
