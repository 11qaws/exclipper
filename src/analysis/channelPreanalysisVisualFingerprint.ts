import {
  AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
  channelPreanalysisSourceById,
  type ChannelPreanalysisSourceId,
} from "./channelPreanalysisSources";

export const CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_SCHEMA_VERSION =
  "1.0.0" as const;
export const CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_ALGORITHM =
  "luma-dhash-blockhash-64-v1" as const;
export const CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_WIDTH = 32 as const;
export const CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_HEIGHT = 18 as const;
export const CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_TARGET_ANCHORS =
  12 as const;
export const CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MIN_ANCHORS = 8 as const;
export const CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_ANCHORS = 16 as const;
export const CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_LOCAL_SAMPLES =
  512 as const;
export const CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_COHORT = 32 as const;
export const CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_BYTES =
  64 * 1024;
export const CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_OFFSET_MS =
  30_000 as const;
export const CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_OFFSET_STEP_MS =
  5_000 as const;
export const CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_SAMPLE_TOLERANCE_MS =
  2_750 as const;

const MAX_VIDEO_DURATION_MS = 12 * 60 * 60_000;
const MIN_DISTINCT_ANCHORS = 6;
const HASH_PATTERN = /^[0-9a-f]{16}$/u;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;
const ISO_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const MAX_ACCEPTED_DHASH_DISTANCE = 18;
const MAX_ACCEPTED_BLOCK_HASH_DISTANCE = 20;
const MAX_ACCEPTED_COMBINED_DISTANCE = 32;
const MAX_ACCEPTED_MEAN_LUMA_DISTANCE = 56;
const MAX_ACCEPTED_MEDIAN_DISTANCE = 21;
const MAX_ACCEPTED_P90_DISTANCE = 32;
const CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_ALL_OFFSETS_MS = Object.freeze(
  Array.from(
    {
      length:
        (CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_OFFSET_MS * 2) /
          CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_OFFSET_STEP_MS +
        1,
    },
    (_, index) =>
      -CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_OFFSET_MS +
      index * CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_OFFSET_STEP_MS,
  ),
);
const CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_ZERO_OFFSET_MS = Object.freeze([
  0,
]);

export interface ChannelPreanalysisVisualAnchorDescriptor {
  readonly timestampMs: number;
  readonly dHash64: string;
  readonly blockHash64: string;
  readonly meanLuma: number;
  readonly edgeEnergy: number;
}

export interface ChannelPreanalysisVisualFingerprint {
  readonly schemaVersion: typeof CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_SCHEMA_VERSION;
  readonly algorithm: typeof CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_ALGORITHM;
  readonly videoId: string;
  readonly sourceDurationMs: number;
  readonly createdAt: string;
  readonly anchors: readonly ChannelPreanalysisVisualAnchorDescriptor[];
}

export interface ChannelPreanalysisVisualFrame {
  readonly timestampMs: number;
  readonly luma: ArrayLike<number>;
  readonly width?: number;
  readonly height?: number;
}

export interface LocalChannelPreanalysisVisualSample {
  readonly timestampMs: number;
  readonly luma: ArrayLike<number>;
  readonly width?: number;
  readonly height?: number;
}

export type ChannelPreanalysisVisualMatchReason =
  | "multi-anchor-consensus"
  | "duration-conflict"
  | "insufficient-local-samples"
  | "insufficient-temporal-coverage"
  | "anchor-consensus-failed";

export interface ChannelPreanalysisVisualMatchResult {
  readonly matched: boolean;
  readonly reason: ChannelPreanalysisVisualMatchReason;
  readonly videoId: string;
  readonly globalOffsetMs: number | null;
  readonly matchedAnchorCount: number;
  readonly evaluatedAnchorCount: number;
  readonly temporalThirdsCovered: number;
  readonly medianDistance: number | null;
  readonly p90Distance: number | null;
}

export interface ChannelPreanalysisVisualSelectionResult {
  readonly status: "verified" | "ambiguous" | "none";
  readonly match: ChannelPreanalysisVisualFingerprint | null;
  readonly result: ChannelPreanalysisVisualMatchResult | null;
  readonly candidates: readonly ChannelPreanalysisVisualMatchResult[];
}

export type ChannelPreanalysisVisualSamplingPhase =
  | "zero-offset"
  | "offset-recovery"
  | "all";

export class ChannelPreanalysisVisualFingerprintError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ChannelPreanalysisVisualFingerprintError";
  }
}

/**
 * Builds a transport-independent descriptor from a tiny luma plane. The two
 * hashes intentionally discard exact bytes, colour and codec artefacts:
 * dHash preserves edge direction while blockHash preserves broad composition.
 */
export function createChannelPreanalysisVisualAnchorDescriptor(
  frame: ChannelPreanalysisVisualFrame,
): ChannelPreanalysisVisualAnchorDescriptor {
  const width =
    frame.width ?? CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_WIDTH;
  const height =
    frame.height ?? CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_HEIGHT;
  assertTimestamp(frame.timestampMs, "frame timestamp");
  const source = normalizeLumaPlane(frame.luma, width, height);
  const dHashLuma = resizeLuma(source, width, height, 9, 8);
  const blockLuma = resizeLuma(source, width, height, 8, 8);
  const meanLuma = Math.round(
    source.reduce((total, value) => total + value, 0) / source.length,
  );
  let edgeTotal = 0;
  let edgeCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const value = source[index] ?? 0;
      if (x + 1 < width) {
        edgeTotal += Math.abs(value - (source[index + 1] ?? 0));
        edgeCount += 1;
      }
      if (y + 1 < height) {
        edgeTotal += Math.abs(value - (source[index + width] ?? 0));
        edgeCount += 1;
      }
    }
  }

  return {
    timestampMs: frame.timestampMs,
    dHash64: bitsToHex(
      Array.from({ length: 64 }, (_, index) => {
        const row = Math.floor(index / 8);
        const column = index % 8;
        const left = dHashLuma[row * 9 + column] ?? 0;
        const right = dHashLuma[row * 9 + column + 1] ?? 0;
        return left > right;
      }),
    ),
    blockHash64: bitsToHex(
      blockLuma.map((value) => value >= median(blockLuma)),
    ),
    meanLuma,
    edgeEnergy: Math.min(
      255,
      Math.round(edgeCount === 0 ? 0 : edgeTotal / edgeCount),
    ),
  };
}

export function createChannelPreanalysisVisualFingerprint(
  input: Omit<
    ChannelPreanalysisVisualFingerprint,
    "schemaVersion" | "algorithm"
  >,
): ChannelPreanalysisVisualFingerprint {
  return validateFingerprint({
    schemaVersion: CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_SCHEMA_VERSION,
    algorithm: CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_ALGORITHM,
    ...input,
  });
}

export function parseChannelPreanalysisVisualFingerprint(
  input: unknown,
): ChannelPreanalysisVisualFingerprint {
  let value: unknown = input;
  if (typeof input === "string") {
    if (
      new TextEncoder().encode(input).byteLength >
      CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_BYTES
    ) {
      throw fingerprintError("Visual fingerprint artifact is too large.");
    }
    try {
      value = JSON.parse(input);
    } catch (cause) {
      throw new ChannelPreanalysisVisualFingerprintError(
        `Visual fingerprint artifact is not valid JSON: ${errorMessage(cause)}`,
      );
    }
  }
  return validateFingerprint(value);
}

export function serializeChannelPreanalysisVisualFingerprint(
  fingerprint: ChannelPreanalysisVisualFingerprint,
): string {
  const validated = validateFingerprint(fingerprint);
  const serialized = `${JSON.stringify(validated, null, 2)}\n`;
  if (
    new TextEncoder().encode(serialized).byteLength >
    CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_BYTES
  ) {
    throw fingerprintError("Visual fingerprint artifact is too large.");
  }
  return serialized;
}

export function canonicalChannelPreanalysisVisualFingerprintStorageKey(
  videoId: string,
  sourceId: ChannelPreanalysisSourceId =
    AMORETTO_CHANNEL_PREANALYSIS_SOURCE.sourceId,
): string {
  if (!VIDEO_ID_PATTERN.test(videoId)) {
    throw fingerprintError("Visual fingerprint video ID is invalid.");
  }
  const source = channelPreanalysisSourceById(sourceId);
  if (source === null) {
    throw fingerprintError("Visual fingerprint source is invalid.");
  }
  return `${source.sourceId}/videos/${videoId}.visual-fingerprint.v1.json`;
}

export function canonicalChannelPreanalysisVisualFingerprintArtifactId(
  videoId: string,
): string {
  if (!VIDEO_ID_PATTERN.test(videoId)) {
    throw fingerprintError("Visual fingerprint video ID is invalid.");
  }
  return `youtube-storyboard-visual-fingerprint:${videoId}:v1`;
}

/**
 * Returns the bounded timestamps the browser should seek before matching.
 * One common offset is tested for the entire broadcast; individual anchors
 * are never independently shifted because that would make unrelated videos
 * too easy to fit.
 */
export function buildChannelPreanalysisLocalVisualSamplingPlan(
  fingerprint: ChannelPreanalysisVisualFingerprint,
  options: {
    readonly phase?: ChannelPreanalysisVisualSamplingPhase;
  } = {},
): readonly number[] {
  const verified = validateFingerprint(fingerprint);
  const phase = options.phase ?? "zero-offset";
  if (!["zero-offset", "offset-recovery", "all"].includes(phase)) {
    throw fingerprintError("Visual fingerprint sampling phase is invalid.");
  }
  const timestamps = new Set<number>();
  for (const anchor of verified.anchors) {
    for (
      let offsetMs = -CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_OFFSET_MS;
      offsetMs <= CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_OFFSET_MS;
      offsetMs += CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_OFFSET_STEP_MS
    ) {
      if (
        (phase === "zero-offset" && offsetMs !== 0) ||
        (phase === "offset-recovery" && offsetMs === 0)
      ) {
        continue;
      }
      const timestampMs = anchor.timestampMs + offsetMs;
      if (
        timestampMs >= 0 &&
        timestampMs < verified.sourceDurationMs
      ) {
        timestamps.add(timestampMs);
      }
    }
  }
  const result = [...timestamps].sort((left, right) => left - right);
  if (
    result.length >
    CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_LOCAL_SAMPLES
  ) {
    throw fingerprintError("Visual fingerprint sampling plan is too large.");
  }
  return result;
}

/**
 * Builds one deduplicated zero-offset sampling pass for a bounded duration
 * cohort. This is the renamed-file fallback: recovery offsets remain a
 * single-video operation so an ambiguous catalog can never explode into
 * thousands of random seeks.
 */
export function buildChannelPreanalysisLocalVisualCohortSamplingPlan(
  fingerprints: readonly ChannelPreanalysisVisualFingerprint[],
): readonly number[] {
  if (
    fingerprints.length < 1 ||
    fingerprints.length >
      CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_COHORT
  ) {
    throw fingerprintError("Visual fingerprint cohort size is invalid.");
  }
  const videoIds = new Set<string>();
  const timestamps = new Set<number>();
  for (const fingerprint of fingerprints) {
    const verified = validateFingerprint(fingerprint);
    if (videoIds.has(verified.videoId)) {
      throw fingerprintError(
        "Visual fingerprint cohort video IDs are duplicated.",
      );
    }
    videoIds.add(verified.videoId);
    for (const timestampMs of buildChannelPreanalysisLocalVisualSamplingPlan(
      verified,
      { phase: "zero-offset" },
    )) {
      timestamps.add(timestampMs);
    }
  }
  const result = [...timestamps].sort((left, right) => left - right);
  if (
    result.length >
    CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_LOCAL_SAMPLES
  ) {
    throw fingerprintError("Visual fingerprint cohort plan is too large.");
  }
  return result;
}

export function channelPreanalysisVisualFingerprintDurationToleranceMs(
  durationMs: number,
): number {
  assertDuration(durationMs, "fingerprint duration");
  return Math.min(
    10_000,
    Math.max(2_000, Math.round(durationMs * 0.001)),
  );
}

export function isChannelPreanalysisVisualFingerprintDurationCompatible(
  localDurationMs: number,
  fingerprintDurationMs: number,
): boolean {
  assertDuration(localDurationMs, "local duration");
  assertDuration(fingerprintDurationMs, "fingerprint duration");
  return (
    Math.abs(localDurationMs - fingerprintDurationMs) <=
    channelPreanalysisVisualFingerprintDurationToleranceMs(
      fingerprintDurationMs,
    )
  );
}

export function matchChannelPreanalysisVisualFingerprint(
  fingerprintInput: ChannelPreanalysisVisualFingerprint,
  input: {
    readonly durationMs: number;
    readonly samples: readonly LocalChannelPreanalysisVisualSample[];
  },
): ChannelPreanalysisVisualMatchResult {
  return matchChannelPreanalysisVisualFingerprintAtOffsets(
    fingerprintInput,
    input,
    CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_ALL_OFFSETS_MS,
  );
}

function matchChannelPreanalysisVisualFingerprintAtOffsets(
  fingerprintInput: ChannelPreanalysisVisualFingerprint,
  input: {
    readonly durationMs: number;
    readonly samples: readonly LocalChannelPreanalysisVisualSample[];
  },
  offsetsMs: readonly number[],
): ChannelPreanalysisVisualMatchResult {
  const fingerprint = validateFingerprint(fingerprintInput);
  assertDuration(input.durationMs, "local duration");
  if (
    offsetsMs.length === 0 ||
    offsetsMs.some(
      (offsetMs) =>
        !Number.isSafeInteger(offsetMs) ||
        offsetMs < -CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_OFFSET_MS ||
        offsetMs > CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_OFFSET_MS ||
        offsetMs %
          CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_OFFSET_STEP_MS !==
          0,
    )
  ) {
    throw fingerprintError("Visual fingerprint match offsets are invalid.");
  }
  if (
    !isChannelPreanalysisVisualFingerprintDurationCompatible(
      input.durationMs,
      fingerprint.sourceDurationMs,
    )
  ) {
    return emptyMatch(fingerprint.videoId, "duration-conflict");
  }
  const samples = normalizeLocalSamples(input.samples);
  if (samples.length < CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MIN_ANCHORS) {
    return emptyMatch(
      fingerprint.videoId,
      "insufficient-local-samples",
    );
  }

  const evaluated = [];
  for (const offsetMs of offsetsMs) {
    evaluated.push(evaluateOffset(fingerprint, samples, offsetMs));
  }
  evaluated.sort(compareOffsetEvaluations);
  const best = evaluated[0];
  if (best === undefined) {
    return emptyMatch(
      fingerprint.videoId,
      "insufficient-local-samples",
    );
  }
  const requiredMatches = Math.max(
    CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MIN_ANCHORS,
    Math.ceil(fingerprint.anchors.length * 0.67),
  );
  const enoughEvaluated = best.evaluatedAnchorCount >= requiredMatches;
  const enoughMatches = best.matchedAnchorCount >= requiredMatches;
  const completeTimeline = best.temporalThirdsCovered === 3;
  const acceptedDistances =
    best.medianDistance !== null &&
    best.medianDistance <= MAX_ACCEPTED_MEDIAN_DISTANCE &&
    best.p90Distance !== null &&
    best.p90Distance <= MAX_ACCEPTED_P90_DISTANCE;
  const matched =
    enoughEvaluated &&
    enoughMatches &&
    completeTimeline &&
    acceptedDistances;

  return {
    matched,
    reason: matched
      ? "multi-anchor-consensus"
      : !enoughEvaluated
        ? "insufficient-local-samples"
        : !enoughMatches
          ? "anchor-consensus-failed"
          : !completeTimeline
            ? "insufficient-temporal-coverage"
            : "anchor-consensus-failed",
    videoId: fingerprint.videoId,
    globalOffsetMs: best.offsetMs,
    matchedAnchorCount: best.matchedAnchorCount,
    evaluatedAnchorCount: best.evaluatedAnchorCount,
    temporalThirdsCovered: best.temporalThirdsCovered,
    medianDistance: best.medianDistance,
    p90Distance: best.p90Distance,
  };
}

/**
 * A perceptual match is accepted only when exactly one catalog document
 * reaches consensus at offset zero. Metadata is deliberately absent from this
 * decision. Bounded offset recovery belongs only to a single already-narrowed
 * fingerprint and must never borrow timestamps from another cohort member.
 */
export function selectUniqueChannelPreanalysisVisualFingerprint(
  fingerprints: readonly ChannelPreanalysisVisualFingerprint[],
  input: {
    readonly durationMs: number;
    readonly samples: readonly LocalChannelPreanalysisVisualSample[];
  },
): ChannelPreanalysisVisualSelectionResult {
  const validated = fingerprints.map((fingerprint) =>
    validateFingerprint(fingerprint),
  );
  if (
    new Set(validated.map(({ videoId }) => videoId)).size !==
    validated.length
  ) {
    throw fingerprintError("Visual fingerprint video IDs are duplicated.");
  }
  const candidates = validated.map((fingerprint) =>
    matchChannelPreanalysisVisualFingerprintAtOffsets(
      fingerprint,
      input,
      CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_ZERO_OFFSET_MS,
    ),
  );
  if (
    candidates.some(
      ({ globalOffsetMs }) =>
        globalOffsetMs !== null && globalOffsetMs !== 0,
    )
  ) {
    throw fingerprintError(
      "Visual fingerprint cohort comparison escaped zero offset.",
    );
  }
  const matches = candidates.filter(({ matched }) => matched);
  if (matches.length !== 1) {
    return {
      status: matches.length > 1 ? "ambiguous" : "none",
      match: null,
      result: null,
      candidates,
    };
  }
  const result = matches[0] ?? null;
  const match =
    result === null
      ? null
      : validated.find(({ videoId }) => videoId === result.videoId) ?? null;
  return {
    status: match === null ? "none" : "verified",
    match,
    result,
    candidates,
  };
}

export function hammingDistance64(left: string, right: string): number {
  if (!HASH_PATTERN.test(left) || !HASH_PATTERN.test(right)) {
    throw fingerprintError("Perceptual hash must be 64 lowercase bits.");
  }
  let value = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let count = 0;
  while (value !== 0n) {
    value &= value - 1n;
    count += 1;
  }
  return count;
}

function validateFingerprint(
  value: unknown,
): ChannelPreanalysisVisualFingerprint {
  const record = exactRecord(value, [
    "schemaVersion",
    "algorithm",
    "videoId",
    "sourceDurationMs",
    "createdAt",
    "anchors",
  ]);
  if (
    record.schemaVersion !==
      CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_SCHEMA_VERSION ||
    record.algorithm !== CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_ALGORITHM ||
    typeof record.videoId !== "string" ||
    !VIDEO_ID_PATTERN.test(record.videoId) ||
    typeof record.sourceDurationMs !== "number" ||
    !Number.isSafeInteger(record.sourceDurationMs) ||
    record.sourceDurationMs <= 0 ||
    record.sourceDurationMs > MAX_VIDEO_DURATION_MS ||
    typeof record.createdAt !== "string" ||
    !ISO_DATE_PATTERN.test(record.createdAt) ||
    !Number.isFinite(Date.parse(record.createdAt)) ||
    !Array.isArray(record.anchors) ||
    record.anchors.length <
      CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MIN_ANCHORS ||
    record.anchors.length >
      CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_ANCHORS
  ) {
    throw fingerprintError("Visual fingerprint header is invalid.");
  }

  const sourceDurationMs = record.sourceDurationMs;
  let previousTimestampMs = -1;
  const anchors = record.anchors.map((value, index) => {
    const anchor = exactRecord(value, [
      "timestampMs",
      "dHash64",
      "blockHash64",
      "meanLuma",
      "edgeEnergy",
    ]);
    if (
      typeof anchor.timestampMs !== "number" ||
      !Number.isSafeInteger(anchor.timestampMs) ||
      anchor.timestampMs <= previousTimestampMs ||
      anchor.timestampMs < 0 ||
      anchor.timestampMs >= sourceDurationMs ||
      typeof anchor.dHash64 !== "string" ||
      !HASH_PATTERN.test(anchor.dHash64) ||
      typeof anchor.blockHash64 !== "string" ||
      !HASH_PATTERN.test(anchor.blockHash64) ||
      typeof anchor.meanLuma !== "number" ||
      !Number.isInteger(anchor.meanLuma) ||
      anchor.meanLuma < 0 ||
      anchor.meanLuma > 255 ||
      typeof anchor.edgeEnergy !== "number" ||
      !Number.isInteger(anchor.edgeEnergy) ||
      anchor.edgeEnergy < 0 ||
      anchor.edgeEnergy > 255
    ) {
      throw fingerprintError(`Visual fingerprint anchor ${index} is invalid.`);
    }
    previousTimestampMs = anchor.timestampMs;
    return {
      timestampMs: anchor.timestampMs,
      dHash64: anchor.dHash64,
      blockHash64: anchor.blockHash64,
      meanLuma: anchor.meanLuma,
      edgeEnergy: anchor.edgeEnergy,
    };
  });
  const distinctSignatures = new Set(
    anchors.map(({ dHash64, blockHash64 }) => `${dHash64}:${blockHash64}`),
  );
  if (distinctSignatures.size < MIN_DISTINCT_ANCHORS) {
    throw fingerprintError(
      "Visual fingerprint does not contain enough distinct scenes.",
    );
  }
  if (
    anchors[0] === undefined ||
    anchors.at(-1) === undefined ||
    anchors[0].timestampMs > sourceDurationMs * 0.4 ||
    (anchors.at(-1)?.timestampMs ?? 0) < sourceDurationMs * 0.6
  ) {
    throw fingerprintError(
      "Visual fingerprint does not cover the broadcast timeline.",
    );
  }
  return {
    schemaVersion: CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_SCHEMA_VERSION,
    algorithm: CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_ALGORITHM,
    videoId: record.videoId,
    sourceDurationMs,
    createdAt: record.createdAt,
    anchors,
  };
}

interface NormalizedLocalSample {
  readonly timestampMs: number;
  readonly descriptor: ChannelPreanalysisVisualAnchorDescriptor;
}

interface OffsetEvaluation {
  readonly offsetMs: number;
  readonly matchedAnchorCount: number;
  readonly evaluatedAnchorCount: number;
  readonly temporalThirdsCovered: number;
  readonly medianDistance: number | null;
  readonly p90Distance: number | null;
}

function normalizeLocalSamples(
  input: readonly LocalChannelPreanalysisVisualSample[],
): readonly NormalizedLocalSample[] {
  if (
    input.length >
    CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_LOCAL_SAMPLES
  ) {
    throw fingerprintError("Too many local visual samples were supplied.");
  }
  const seen = new Set<number>();
  return input
    .map((sample) => {
      assertTimestamp(sample.timestampMs, "local sample timestamp");
      if (seen.has(sample.timestampMs)) {
        throw fingerprintError("Local visual sample timestamps are duplicated.");
      }
      const width =
        sample.width ?? CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_WIDTH;
      const height =
        sample.height ?? CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_HEIGHT;
      if (
        width !== CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_WIDTH ||
        height !== CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_HEIGHT
      ) {
        throw fingerprintError(
          "Local visual samples must use the canonical 32x18 luma plane.",
        );
      }
      seen.add(sample.timestampMs);
      return {
        timestampMs: sample.timestampMs,
        descriptor: createChannelPreanalysisVisualAnchorDescriptor({
          timestampMs: sample.timestampMs,
          luma: sample.luma,
          width,
          height,
        }),
      };
    })
    .sort((left, right) => left.timestampMs - right.timestampMs);
}

function evaluateOffset(
  fingerprint: ChannelPreanalysisVisualFingerprint,
  samples: readonly NormalizedLocalSample[],
  offsetMs: number,
): OffsetEvaluation {
  const acceptedDistances: number[] = [];
  let evaluatedAnchorCount = 0;
  const temporalThirds = new Set<number>();

  for (const anchor of fingerprint.anchors) {
    const expectedTimestampMs = anchor.timestampMs + offsetMs;
    let best:
      | {
          readonly distance: number;
          readonly accepted: boolean;
        }
      | null = null;
    for (const sample of samples) {
      if (
        Math.abs(sample.timestampMs - expectedTimestampMs) >
        CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_SAMPLE_TOLERANCE_MS
      ) {
        continue;
      }
      const dHashDistance = hammingDistance64(
        anchor.dHash64,
        sample.descriptor.dHash64,
      );
      const blockHashDistance = hammingDistance64(
        anchor.blockHash64,
        sample.descriptor.blockHash64,
      );
      const combinedDistance = dHashDistance + blockHashDistance;
      const accepted =
        dHashDistance <= MAX_ACCEPTED_DHASH_DISTANCE &&
        blockHashDistance <= MAX_ACCEPTED_BLOCK_HASH_DISTANCE &&
        combinedDistance <= MAX_ACCEPTED_COMBINED_DISTANCE &&
        Math.abs(anchor.meanLuma - sample.descriptor.meanLuma) <=
          MAX_ACCEPTED_MEAN_LUMA_DISTANCE;
      if (
        best === null ||
        Number(accepted) > Number(best.accepted) ||
        (accepted === best.accepted && combinedDistance < best.distance)
      ) {
        best = { distance: combinedDistance, accepted };
      }
    }
    if (best === null) continue;
    evaluatedAnchorCount += 1;
    if (!best.accepted) continue;
    acceptedDistances.push(best.distance);
    temporalThirds.add(
      Math.min(
        2,
        Math.floor((anchor.timestampMs / fingerprint.sourceDurationMs) * 3),
      ),
    );
  }
  acceptedDistances.sort((left, right) => left - right);
  return {
    offsetMs,
    matchedAnchorCount: acceptedDistances.length,
    evaluatedAnchorCount,
    temporalThirdsCovered: temporalThirds.size,
    medianDistance:
      acceptedDistances.length === 0 ? null : median(acceptedDistances),
    p90Distance:
      acceptedDistances.length === 0
        ? null
        : percentile(acceptedDistances, 0.9),
  };
}

function compareOffsetEvaluations(
  left: OffsetEvaluation,
  right: OffsetEvaluation,
): number {
  return (
    right.matchedAnchorCount - left.matchedAnchorCount ||
    right.temporalThirdsCovered - left.temporalThirdsCovered ||
    (left.medianDistance ?? Number.POSITIVE_INFINITY) -
      (right.medianDistance ?? Number.POSITIVE_INFINITY) ||
    Math.abs(left.offsetMs) - Math.abs(right.offsetMs) ||
    left.offsetMs - right.offsetMs
  );
}

function normalizeLumaPlane(
  input: ArrayLike<number>,
  width: number,
  height: number,
): readonly number[] {
  if (
    !Number.isSafeInteger(width) ||
    width < 8 ||
    width > 4_096 ||
    !Number.isSafeInteger(height) ||
    height < 8 ||
    height > 4_096 ||
    input.length !== width * height
  ) {
    throw fingerprintError("Luma plane dimensions are invalid.");
  }
  return Array.from(input, (value, index) => {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 255
    ) {
      throw fingerprintError(`Luma value ${index} is invalid.`);
    }
    return Math.round(value);
  });
}

function resizeLuma(
  source: readonly number[],
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): number[] {
  const result = new Array<number>(targetWidth * targetHeight);
  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    const sourceYStart = Math.floor(
      (targetY * sourceHeight) / targetHeight,
    );
    const sourceYEnd = Math.max(
      sourceYStart + 1,
      Math.ceil(((targetY + 1) * sourceHeight) / targetHeight),
    );
    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const sourceXStart = Math.floor(
        (targetX * sourceWidth) / targetWidth,
      );
      const sourceXEnd = Math.max(
        sourceXStart + 1,
        Math.ceil(((targetX + 1) * sourceWidth) / targetWidth),
      );
      let total = 0;
      let count = 0;
      for (
        let sourceY = sourceYStart;
        sourceY < Math.min(sourceHeight, sourceYEnd);
        sourceY += 1
      ) {
        for (
          let sourceX = sourceXStart;
          sourceX < Math.min(sourceWidth, sourceXEnd);
          sourceX += 1
        ) {
          total += source[sourceY * sourceWidth + sourceX] ?? 0;
          count += 1;
        }
      }
      result[targetY * targetWidth + targetX] =
        count === 0 ? 0 : Math.round(total / count);
    }
  }
  return result;
}

function bitsToHex(bits: readonly boolean[]): string {
  if (bits.length !== 64) {
    throw fingerprintError("Perceptual hash requires exactly 64 bits.");
  }
  let value = 0n;
  for (const bit of bits) {
    value = (value << 1n) | (bit ? 1n : 0n);
  }
  return value.toString(16).padStart(16, "0");
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw fingerprintError("Median requires at least one value.");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function percentile(values: readonly number[], fraction: number): number {
  const index = Math.max(
    0,
    Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1),
  );
  return values[index] ?? 0;
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw fingerprintError("Visual fingerprint record is invalid.");
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record).sort();
  const keys = [...expectedKeys].sort();
  if (
    actualKeys.length !== keys.length ||
    actualKeys.some((key, index) => key !== keys[index])
  ) {
    throw fingerprintError("Visual fingerprint record shape is invalid.");
  }
  return record;
}

function assertTimestamp(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_VIDEO_DURATION_MS) {
    throw fingerprintError(`${label} is invalid.`);
  }
}

function assertDuration(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_VIDEO_DURATION_MS) {
    throw fingerprintError(`${label} is invalid.`);
  }
}

function emptyMatch(
  videoId: string,
  reason: ChannelPreanalysisVisualMatchReason,
): ChannelPreanalysisVisualMatchResult {
  return {
    matched: false,
    reason,
    videoId,
    globalOffsetMs: null,
    matchedAnchorCount: 0,
    evaluatedAnchorCount: 0,
    temporalThirdsCovered: 0,
    medianDistance: null,
    p90Distance: null,
  };
}

function fingerprintError(
  message: string,
): ChannelPreanalysisVisualFingerprintError {
  return new ChannelPreanalysisVisualFingerprintError(message);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
