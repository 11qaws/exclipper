import {
  CHANNEL_PREANALYSIS_CATALOG_SCHEMA_VERSION,
  isChannelPreanalysisState,
  matchChannelPreanalysisVideo,
  normalizeChannelVideoTitle,
  type ChannelPreanalysisArtifact,
  type ChannelPreanalysisCatalogManifest,
  type ChannelPreanalysisCatalogVideo,
  type ChannelPreanalysisMatchQuery,
  type ChannelPreanalysisMatchResult,
  type ChannelPreanalysisRetryCheckpoint,
  channelPreanalysisSourceForManifest,
} from "./channelPreanalysisCatalog";
import {
  AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
  CHANNEL_PREANALYSIS_SOURCES,
  channelPreanalysisStoragePrefix,
  type ConfiguredChannelPreanalysisSource,
} from "./channelPreanalysisSources";
import {
  CHANNEL_PREANALYSIS_BUNDLE_MAX_BYTES,
  assertChannelPreanalysisBundleMatchesCatalogVideo,
  parseChannelPreanalysisBundle,
  verifyChannelPreanalysisTranscriptDigest,
  type ChannelPreanalysisBundle,
} from "./channelPreanalysisBundle";
import {
  CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_COHORT,
  CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_BYTES,
  canonicalChannelPreanalysisVisualFingerprintArtifactId,
  canonicalChannelPreanalysisVisualFingerprintStorageKey,
  isChannelPreanalysisVisualFingerprintDurationCompatible,
  parseChannelPreanalysisVisualFingerprint,
  selectUniqueChannelPreanalysisVisualFingerprint,
  type ChannelPreanalysisVisualSelectionResult,
  type ChannelPreanalysisVisualFingerprint,
  type LocalChannelPreanalysisVisualSample,
} from "./channelPreanalysisVisualFingerprint";
import {
  CHANNEL_PREANALYSIS_REVIEW_BUNDLE_MAX_BYTES,
  channelPreanalysisReviewBundleArtifactId,
  channelPreanalysisReviewBundleStorageKey,
  parseChannelPreanalysisReviewBundle,
  verifyChannelPreanalysisReviewBundleIntegrity,
  type ChannelPreanalysisReviewBundle,
} from "./channelPreanalysisReviewBundle";

export const CHANNEL_PREANALYSIS_RAW_BASE_URL =
  "https://raw.githubusercontent.com/11qaws/exclipper/preanalysis-catalog/amoretto-vods/" as const;
const channelPreanalysisApplicationBaseUrl =
  typeof import.meta.env?.BASE_URL === "string"
    ? import.meta.env.BASE_URL
    : "/";
export const CHANNEL_PREANALYSIS_BUNDLED_BASE_URL =
  `${channelPreanalysisApplicationBaseUrl}preanalysis/amoretto-vods/` as const;
export const CHANNEL_PREANALYSIS_CATALOG_FILE = "catalog.json" as const;
export const CHANNEL_PREANALYSIS_MANIFEST_MAX_BYTES = 4 * 1024 * 1024;
export const CHANNEL_PREANALYSIS_MANIFEST_REQUEST_TIMEOUT_MS = 3_000;
export const CHANNEL_PREANALYSIS_BUNDLE_REQUEST_MIN_TIMEOUT_MS = 8_000;
export const CHANNEL_PREANALYSIS_REQUEST_MAX_TIMEOUT_MS = 75_000;
const CHANNEL_PREANALYSIS_MINIMUM_DOWNLOAD_BYTES_PER_SECOND = 512 * 1024;

export type ChannelPreanalysisCatalogSource = "raw" | "bundled";

export type ChannelPreanalysisClientErrorCode =
  | "FETCH_FAILED"
  | "HTTP_ERROR"
  | "TOO_LARGE"
  | "INVALID_UTF8"
  | "INVALID_JSON"
  | "INVALID_MANIFEST"
  | "INVALID_BUNDLE"
  | "INVALID_REVIEW"
  | "INVALID_FINGERPRINT";

export class ChannelPreanalysisClientError extends Error {
  public readonly code: ChannelPreanalysisClientErrorCode;
  public readonly originalCause: unknown;

  public constructor(
    code: ChannelPreanalysisClientErrorCode,
    message: string,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message);
    this.name = "ChannelPreanalysisClientError";
    this.code = code;
    this.originalCause = options.cause;
  }
}

export type ChannelPreanalysisFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface ChannelPreanalysisClientOptions {
  readonly configuredSource?: ConfiguredChannelPreanalysisSource;
  readonly fetchImplementation?: ChannelPreanalysisFetch;
  readonly rawBaseUrl?: string;
  readonly bundledBaseUrl?: string;
  readonly signal?: AbortSignal;
  readonly manifestMaxBytes?: number;
  readonly bundleMaxBytes?: number;
  readonly manifestRequestTimeoutMs?: number;
  readonly bundleRequestTimeoutMs?: number;
}

export interface LoadedChannelPreanalysisManifest {
  readonly source: ChannelPreanalysisCatalogSource;
  readonly baseUrl: string;
  readonly manifest: ChannelPreanalysisCatalogManifest;
}

export interface LoadedChannelPreanalysisVisualFingerprint {
  readonly fingerprint: ChannelPreanalysisVisualFingerprint;
  readonly artifact: ChannelPreanalysisArtifact;
}

export interface LoadedChannelPreanalysisReview {
  readonly review: ChannelPreanalysisReviewBundle;
  readonly artifact: ChannelPreanalysisArtifact;
}

export type ChannelPreanalysisVisualCohortStatus =
  | "ready"
  | "none"
  | "partial"
  | "too-many";

export interface LoadedChannelPreanalysisVisualFingerprintCohort {
  readonly status: ChannelPreanalysisVisualCohortStatus;
  readonly lookup: ChannelPreanalysisLookupResult;
  readonly videos: readonly ChannelPreanalysisCatalogVideo[];
  readonly fingerprints: readonly ChannelPreanalysisVisualFingerprint[];
}

export interface ChannelPreanalysisVisualCohortResolution {
  readonly status: "verified" | "ambiguous" | "none";
  readonly lookup: ChannelPreanalysisLookupResult;
  readonly selection: ChannelPreanalysisVisualSelectionResult | null;
}

export type ChannelPreanalysisBundleLoadStatus =
  | "loaded"
  | "not-exact"
  | "not-ready"
  | "unavailable";

export interface ChannelPreanalysisLookupResult {
  readonly manifest: ChannelPreanalysisCatalogManifest;
  readonly manifestSource: ChannelPreanalysisCatalogSource;
  /**
   * The exact base URL paired with `manifest`. Consumers must never recreate
   * this from `manifestSource`, because fallback policy can change between
   * catalog lookup and artifact fetch.
   */
  readonly manifestBaseUrl: string;
  readonly match: ChannelPreanalysisMatchResult;
  readonly bundleStatus: ChannelPreanalysisBundleLoadStatus;
  readonly bundle: ChannelPreanalysisBundle | null;
  /**
   * The exact manifest artifact whose bytes were length- and digest-verified
   * before `bundle` was parsed. It is always present together with `bundle`.
   */
  readonly bundleArtifact: ChannelPreanalysisArtifact | null;
}

export type ConfiguredChannelPreanalysisSearchSelection =
  | "exact"
  | "probable"
  | "visual-cohort"
  | "ambiguous"
  | "partial"
  | "none";

export interface ConfiguredChannelPreanalysisSearchResult {
  readonly selection: ConfiguredChannelPreanalysisSearchSelection;
  readonly coverage: "complete" | "partial";
  readonly primaryLookup: ChannelPreanalysisLookupResult;
  readonly lookups: readonly ChannelPreanalysisLookupResult[];
  readonly unavailableSourceIds: readonly string[];
}

export interface ConfiguredChannelPreanalysisClientOptions
  extends Omit<
    ChannelPreanalysisClientOptions,
    "configuredSource" | "rawBaseUrl" | "bundledBaseUrl"
  > {
  readonly configuredSources?: readonly ConfiguredChannelPreanalysisSource[];
  readonly sourceOptions?: (
    source: ConfiguredChannelPreanalysisSource,
  ) => Pick<ChannelPreanalysisClientOptions, "rawBaseUrl" | "bundledBaseUrl">;
}

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;
const LOCAL_FINGERPRINT_PATTERN =
  /^local-file-sampled-sha256-v1:[0-9a-f]{64}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const READY_BUNDLE_STATES = new Set([
  "transcript-ready",
  "context-ready",
  "published",
]);

interface ChannelPreanalysisSourceBase {
  readonly source: ChannelPreanalysisCatalogSource;
  readonly baseUrl: string;
  readonly configuredSource: ConfiguredChannelPreanalysisSource;
}

export async function fetchChannelPreanalysisManifest(
  options: ChannelPreanalysisClientOptions = {},
): Promise<LoadedChannelPreanalysisManifest> {
  const sources = sourceBases(options);
  let lastError: unknown = null;
  for (const source of sources) {
    try {
      return await fetchChannelPreanalysisManifestFromSource(source, options);
    } catch (cause) {
      lastError = cause;
    }
  }
  throw new ChannelPreanalysisClientError(
    "FETCH_FAILED",
    "Both channel preanalysis catalog sources failed.",
    { cause: lastError },
  );
}

export async function requestChannelPreanalysisMatch(
  query: ChannelPreanalysisMatchQuery,
  options: ChannelPreanalysisClientOptions = {},
): Promise<ChannelPreanalysisLookupResult> {
  let bestFallback:
    | {
        readonly rank: number;
        readonly result: ChannelPreanalysisLookupResult;
      }
    | null = null;
  let exactVideoId: string | null = null;
  let lastError: unknown = null;

  for (const source of sourceBases(options)) {
    let loaded: LoadedChannelPreanalysisManifest;
    try {
      loaded = await fetchChannelPreanalysisManifestFromSource(source, options);
    } catch (cause) {
      lastError = cause;
      continue;
    }

    const match = matchChannelPreanalysisVideo(loaded.manifest, query);
    if (match.confidence !== "exact" || match.match === null) {
      const rank = match.confidence === "probable" ? 2 : 1;
      if (bestFallback === null || rank > bestFallback.rank) {
        bestFallback = {
          rank,
          result: lookupResult(loaded, match, "not-exact", null, null),
        };
      }
      continue;
    }

    if (exactVideoId === null) {
      exactVideoId = match.match.videoId;
    } else if (match.match.videoId !== exactVideoId) {
      /*
       * Never let two independently valid source snapshots disagree about
       * which replay owns the same local identity. The first exact source is
       * retained for diagnosis, but a conflicting fallback cannot be mixed in.
       */
      continue;
    }

    if (loadableTranscriptBundleState(match.match) === null) {
      const rank = 3;
      if (bestFallback === null || rank > bestFallback.rank) {
        bestFallback = {
          rank,
          result: lookupResult(loaded, match, "not-ready", null, null),
        };
      }
      continue;
    }

    try {
      const loadedBundle = await fetchChannelPreanalysisBundleFromSource(
        loaded,
        match.match,
        options,
      );
      return lookupResult(
        loaded,
        match,
        "loaded",
        loadedBundle.bundle,
        loadedBundle.artifact,
      );
    } catch (cause) {
      lastError = cause;
      const rank = 4;
      if (bestFallback === null || rank > bestFallback.rank) {
        bestFallback = {
          rank,
          result: lookupResult(loaded, match, "unavailable", null, null),
        };
      }
    }
  }

  if (bestFallback !== null) return bestFallback.result;
  throw new ChannelPreanalysisClientError(
    "FETCH_FAILED",
    "Both channel preanalysis catalog sources failed.",
    { cause: lastError },
  );
}

/**
 * Searches every configured catalog before allowing fuzzy or perceptual
 * inference. Explicit IDs and registered exact-file fingerprints can survive
 * an unrelated catalog outage; probable and visual lanes require complete
 * coverage so a missing source cannot manufacture a false unique match.
 */
export async function requestConfiguredChannelPreanalysisMatch(
  query: ChannelPreanalysisMatchQuery,
  options: ConfiguredChannelPreanalysisClientOptions = {},
): Promise<ConfiguredChannelPreanalysisSearchResult> {
  const {
    configuredSources = CHANNEL_PREANALYSIS_SOURCES,
    sourceOptions,
    ...sharedOptions
  } = options;
  if (
    configuredSources.length === 0 ||
    new Set(configuredSources.map(({ sourceId }) => sourceId)).size !==
      configuredSources.length
  ) {
    throw new ChannelPreanalysisClientError(
      "FETCH_FAILED",
      "Configured channel preanalysis sources are invalid.",
    );
  }

  const settled = await Promise.allSettled(
    configuredSources.map((configuredSource) =>
      requestChannelPreanalysisMatch(query, {
        ...sharedOptions,
        ...sourceOptions?.(configuredSource),
        configuredSource,
      }),
    ),
  );
  const lookups: ChannelPreanalysisLookupResult[] = [];
  // A bundled catalog keeps exact-ID recovery available, but it is not proof
  // that the current raw branch was observed. Treat that source as uncovered
  // for fuzzy uniqueness and visual-cohort selection; otherwise an empty or
  // stale bundled fallback can manufacture a false cross-channel singleton.
  const unavailableSourceIds: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      lookups.push(result.value);
      if (result.value.manifestSource === "bundled") {
        const source = configuredSources[index];
        if (source !== undefined) unavailableSourceIds.push(source.sourceId);
      }
      return;
    }
    const source = configuredSources[index];
    if (source !== undefined) unavailableSourceIds.push(source.sourceId);
  });
  if (lookups.length === 0) {
    throw new ChannelPreanalysisClientError(
      "FETCH_FAILED",
      "Every configured channel preanalysis catalog failed.",
    );
  }

  const coverage =
    lookups.length === configuredSources.length &&
    unavailableSourceIds.length === 0
      ? "complete"
      : "partial";
  const exact = lookups.filter(
    ({ match }) => match.confidence === "exact" && match.match !== null,
  );
  if (exact.length === 1) {
    return configuredSearchResult(
      "exact",
      coverage,
      exact[0]!,
      lookups,
      unavailableSourceIds,
    );
  }
  if (exact.length > 1) {
    return configuredSearchResult(
      "ambiguous",
      coverage,
      exact[0]!,
      lookups,
      unavailableSourceIds,
    );
  }
  if (coverage === "partial") {
    return configuredSearchResult(
      "partial",
      coverage,
      lookups[0]!,
      lookups,
      unavailableSourceIds,
    );
  }

  const probable = lookups.filter(
    ({ match }) => match.confidence === "probable" && match.match !== null,
  );
  if (probable.length === 1) {
    return configuredSearchResult(
      "probable",
      coverage,
      probable[0]!,
      lookups,
      unavailableSourceIds,
    );
  }
  if (probable.length > 1) {
    return configuredSearchResult(
      "ambiguous",
      coverage,
      probable[0]!,
      lookups,
      unavailableSourceIds,
    );
  }

  const durationMs = query.durationMs;
  if (durationMs !== null && durationMs !== undefined) {
    const compatibleCount = lookups.reduce(
      (count, { manifest }) =>
        count +
        manifest.videos.filter(
          ({ durationMs: candidateDurationMs }) =>
            candidateDurationMs !== null &&
            isChannelPreanalysisVisualFingerprintDurationCompatible(
              durationMs,
              candidateDurationMs,
            ),
        ).length,
      0,
    );
    if (
      compatibleCount > 0 &&
      compatibleCount <= CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_COHORT
    ) {
      return configuredSearchResult(
        "visual-cohort",
        coverage,
        lookups[0]!,
        lookups,
        unavailableSourceIds,
      );
    }
    if (compatibleCount > CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_COHORT) {
      return configuredSearchResult(
        "ambiguous",
        coverage,
        lookups[0]!,
        lookups,
        unavailableSourceIds,
      );
    }
  }
  return configuredSearchResult(
    "none",
    coverage,
    lookups[0]!,
    lookups,
    unavailableSourceIds,
  );
}

function configuredSearchResult(
  selection: ConfiguredChannelPreanalysisSearchSelection,
  coverage: ConfiguredChannelPreanalysisSearchResult["coverage"],
  primaryLookup: ChannelPreanalysisLookupResult,
  lookups: readonly ChannelPreanalysisLookupResult[],
  unavailableSourceIds: readonly string[],
): ConfiguredChannelPreanalysisSearchResult {
  return {
    selection,
    coverage,
    primaryLookup,
    lookups: [...lookups],
    unavailableSourceIds: [...unavailableSourceIds],
  };
}

/**
 * Loads one digest-verified perceptual fingerprint. Callers can request the
 * 12-timestamp zero-offset plan first and fetch the bounded recovery plan only
 * if the common path does not reach consensus.
 */
export async function fetchChannelPreanalysisVisualFingerprint(
  loaded: LoadedChannelPreanalysisManifest,
  video: ChannelPreanalysisCatalogVideo,
  options: ChannelPreanalysisClientOptions = {},
): Promise<LoadedChannelPreanalysisVisualFingerprint | null> {
  const configuredSource = requireConfiguredSource(loaded.manifest);
  const artifact = selectVisualFingerprintArtifact(
    loaded.manifest,
    video,
  );
  if (artifact === null) return null;
  const maximumBytes = resolveMaximumBytes(
    options.bundleMaxBytes,
    CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_BYTES,
  );
  const bytes = await fetchBoundedBytes(
    joinBaseUrl(
      loaded.baseUrl,
      relativeBundlePath(artifact.storageKey, configuredSource),
    ),
    maximumBytes,
    options,
    resolveRequestTimeoutMs(
      options.bundleRequestTimeoutMs,
      defaultBundleRequestTimeoutMs(artifact.byteLength),
    ),
  );
  await verifyArtifactBytes(bytes, artifact);
  let fingerprint: ChannelPreanalysisVisualFingerprint;
  try {
    fingerprint = parseChannelPreanalysisVisualFingerprint(decodeUtf8(bytes));
  } catch (cause) {
    throw new ChannelPreanalysisClientError(
      "INVALID_FINGERPRINT",
      "Visual fingerprint artifact failed strict validation.",
      { cause },
    );
  }
  if (
    fingerprint.videoId !== video.videoId ||
    fingerprint.sourceDurationMs !== video.durationMs ||
    fingerprint.createdAt !== artifact.createdAt
  ) {
    throw new ChannelPreanalysisClientError(
      "INVALID_FINGERPRINT",
      "Visual fingerprint artifact does not match its catalog video.",
    );
  }
  return { fingerprint, artifact };
}

export async function fetchChannelPreanalysisVisualFingerprintForLookup(
  lookup: ChannelPreanalysisLookupResult,
  options: ChannelPreanalysisClientOptions = {},
): Promise<LoadedChannelPreanalysisVisualFingerprint | null> {
  const matchedVideo = lookup.match.match;
  if (matchedVideo === null) return null;
  const canonicalVideo = lookup.manifest.videos.find(
    ({ videoId }) => videoId === matchedVideo.videoId,
  );
  if (
    canonicalVideo === undefined ||
    canonicalVideo !== matchedVideo
  ) {
    throw new ChannelPreanalysisClientError(
      "INVALID_FINGERPRINT",
      "Fingerprint lookup is not bound to its catalog snapshot.",
    );
  }
  return fetchChannelPreanalysisVisualFingerprint(
    {
      source: lookup.manifestSource,
      baseUrl: lookup.manifestBaseUrl,
      manifest: lookup.manifest,
    },
    canonicalVideo,
    options,
  );
}

/**
 * Loads the immutable review snapshot only for an exact match bound to this
 * manifest instance. The transcript/context bundle remains part of the fence:
 * a review artifact alone never proves that the editor may skip analysis.
 */
export async function fetchChannelPreanalysisReviewForLookup(
  lookup: ChannelPreanalysisLookupResult,
  options: ChannelPreanalysisClientOptions = {},
): Promise<LoadedChannelPreanalysisReview | null> {
  const matchedVideo = lookup.match.match;
  if (lookup.match.confidence !== "exact" || matchedVideo === null) return null;
  const video = lookup.manifest.videos.find(
    ({ videoId }) => videoId === matchedVideo.videoId,
  );
  if (video === undefined || video !== matchedVideo) {
    throw invalidReview("Review lookup is not bound to its catalog snapshot.");
  }
  if (!hasReviewReadySnapshot(video)) return null;
  if (
    lookup.bundleStatus !== "loaded" ||
    lookup.bundle === null ||
    lookup.bundleArtifact === null
  ) {
    throw invalidReview("Review lookup is missing its verified context bundle.");
  }

  const configuredSource = requireConfiguredSource(lookup.manifest);
  const transcriptArtifact = selectTranscriptBundleArtifact(
    lookup.manifest,
    video,
  );
  if (transcriptArtifact !== lookup.bundleArtifact) {
    throw invalidReview("Review lookup transcript receipt is stale.");
  }
  try {
    await verifyChannelPreanalysisTranscriptDigest(lookup.bundle);
    assertChannelPreanalysisBundleMatchesCatalogVideo(
      lookup.bundle,
      { ...video, state: "context-ready" },
      lookup.manifest.revision,
    );
  } catch (cause) {
    throw invalidReview("Review lookup context bundle failed verification.", cause);
  }

  const artifact = selectReviewBundleArtifact(lookup.manifest, video);
  const fingerprintArtifact = selectVisualFingerprintArtifact(
    lookup.manifest,
    video,
  );
  if (fingerprintArtifact === null) {
    throw invalidReview("Review lookup is missing its visual coverage fingerprint.");
  }
  const maximumBytes = resolveMaximumBytes(
    options.bundleMaxBytes,
    CHANNEL_PREANALYSIS_REVIEW_BUNDLE_MAX_BYTES,
  );
  const bytes = await fetchBoundedBytes(
    joinBaseUrl(
      lookup.manifestBaseUrl,
      relativeBundlePath(artifact.storageKey, configuredSource),
    ),
    maximumBytes,
    options,
    resolveRequestTimeoutMs(
      options.bundleRequestTimeoutMs,
      defaultBundleRequestTimeoutMs(artifact.byteLength),
    ),
  );

  let review: ChannelPreanalysisReviewBundle;
  try {
    await verifyArtifactBytes(bytes, artifact);
    review = parseChannelPreanalysisReviewBundle(decodeUtf8(bytes));
    await verifyChannelPreanalysisReviewBundleIntegrity(review);
  } catch (cause) {
    throw invalidReview("Review artifact failed digest or schema verification.", cause);
  }
  if (
    review.artifactId !== artifact.artifactId ||
    review.artifactRevision !== artifact.revision ||
    review.createdAt !== artifact.createdAt ||
    review.source.sourceId !== configuredSource.sourceId ||
    review.source.channelId !== configuredSource.channelId ||
    review.source.videoId !== video.videoId ||
    review.sourceDurationMs !== video.durationMs ||
    review.transcriptDigest !== lookup.bundle.transcriptDigest ||
    review.visualCoverage.sourceFingerprintArtifactId !==
      fingerprintArtifact.artifactId ||
    review.visualCoverage.sourceFingerprintDigest !==
      fingerprintArtifact.contentDigest ||
    lookup.bundle.broadcastContext === null ||
    JSON.stringify(review.broadcastContext) !==
      JSON.stringify(lookup.bundle.broadcastContext)
  ) {
    throw invalidReview("Review artifact does not match its catalog context.");
  }
  return { review, artifact };
}

/**
 * Loads every duration-compatible visual identity from the exact catalog
 * snapshot already returned to the caller. The 32-item cohort is capped before any
 * artifact request. A missing, malformed or unavailable fingerprint makes the
 * whole cohort partial so a subset can never manufacture a false unique match.
 */
export async function fetchChannelPreanalysisVisualFingerprintCohortForLookup(
  lookup: ChannelPreanalysisLookupResult,
  localDurationMs: number,
  options: ChannelPreanalysisClientOptions = {},
): Promise<LoadedChannelPreanalysisVisualFingerprintCohort> {
  const videos = lookup.manifest.videos.filter((video) => {
    if (
      video.durationMs === null ||
      !isChannelPreanalysisVisualFingerprintDurationCompatible(
        localDurationMs,
        video.durationMs,
      )
    ) {
      return false;
    }
    return true;
  });
  if (videos.length === 0) {
    return {
      status: "none",
      lookup,
      videos: [],
      fingerprints: [],
    };
  }
  if (
    videos.length >
    CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_COHORT
  ) {
    return {
      status: "too-many",
      lookup,
      videos,
      fingerprints: [],
    };
  }

  try {
    if (
      videos.some(
        (video) =>
          selectVisualFingerprintArtifact(lookup.manifest, video) === null,
      )
    ) {
      return {
        status: "partial",
        lookup,
        videos,
        fingerprints: [],
      };
    }
  } catch {
    return {
      status: "partial",
      lookup,
      videos,
      fingerprints: [],
    };
  }

  let loaded: readonly (LoadedChannelPreanalysisVisualFingerprint | null)[];
  try {
    loaded = await Promise.all(
      videos.map((video) =>
        fetchChannelPreanalysisVisualFingerprint(
          {
            source: lookup.manifestSource,
            baseUrl: lookup.manifestBaseUrl,
            manifest: lookup.manifest,
          },
          video,
          options,
        ),
      ),
    );
  } catch {
    return {
      status: "partial",
      lookup,
      videos,
      fingerprints: [],
    };
  }
  if (loaded.some((value) => value === null)) {
    return {
      status: "partial",
      lookup,
      videos,
      fingerprints: [],
    };
  }
  const fingerprints = loaded.map((value) => {
    if (value === null) {
      throw new ChannelPreanalysisClientError(
        "INVALID_FINGERPRINT",
        "A duration cohort fingerprint disappeared from its catalog snapshot.",
      );
    }
    return value.fingerprint;
  });
  return { status: "ready", lookup, videos, fingerprints };
}

/**
 * Promotes a metadata-miss lookup only after exactly one cohort fingerprint
 * reaches multi-anchor consensus. Transcript/context bytes are then fetched
 * from that same immutable catalog snapshot.
 */
export async function resolveChannelPreanalysisLookupByVisualFingerprintCohort(
  lookup: ChannelPreanalysisLookupResult,
  cohort: LoadedChannelPreanalysisVisualFingerprintCohort,
  input: {
    readonly durationMs: number;
    readonly samples: readonly LocalChannelPreanalysisVisualSample[];
  },
  options: ChannelPreanalysisClientOptions = {},
): Promise<ChannelPreanalysisVisualCohortResolution> {
  if (cohort.lookup !== lookup) {
    throw new ChannelPreanalysisClientError(
      "INVALID_FINGERPRINT",
      "Visual fingerprint cohort is not bound to this catalog lookup.",
    );
  }
  if (cohort.status !== "ready") {
    return {
      status: cohort.status === "too-many" ? "ambiguous" : "none",
      lookup,
      selection: null,
    };
  }
  const selection = selectUniqueChannelPreanalysisVisualFingerprint(
    cohort.fingerprints,
    input,
  );
  if (selection.status !== "verified" || selection.match === null) {
    return {
      status: selection.status,
      lookup,
      selection,
    };
  }
  const video = cohort.videos.find(
    ({ videoId }) => videoId === selection.match?.videoId,
  );
  if (
    video === undefined ||
    lookup.manifest.videos.find(
      ({ videoId }) => videoId === video.videoId,
    ) !== video
  ) {
    throw new ChannelPreanalysisClientError(
      "INVALID_FINGERPRINT",
      "Visual fingerprint consensus does not belong to the bound catalog.",
    );
  }
  const match: ChannelPreanalysisMatchResult = {
    confidence: "exact",
    reason: "visual-fingerprint-consensus",
    ambiguous: false,
    match: video,
    candidates: [video],
  };
  if (loadableTranscriptBundleState(video) === null) {
    return {
      status: "verified",
      selection,
      lookup: lookupResult(
        {
          source: lookup.manifestSource,
          baseUrl: lookup.manifestBaseUrl,
          manifest: lookup.manifest,
        },
        match,
        "not-ready",
        null,
        null,
      ),
    };
  }
  try {
    const loadedBundle = await fetchChannelPreanalysisBundleFromSource(
      {
        source: lookup.manifestSource,
        baseUrl: lookup.manifestBaseUrl,
        manifest: lookup.manifest,
      },
      video,
      options,
    );
    return {
      status: "verified",
      selection,
      lookup: lookupResult(
        {
          source: lookup.manifestSource,
          baseUrl: lookup.manifestBaseUrl,
          manifest: lookup.manifest,
        },
        match,
        "loaded",
        loadedBundle.bundle,
        loadedBundle.artifact,
      ),
    };
  } catch {
    return {
      status: "verified",
      selection,
      lookup: lookupResult(
        {
          source: lookup.manifestSource,
          baseUrl: lookup.manifestBaseUrl,
          manifest: lookup.manifest,
        },
        match,
        "unavailable",
        null,
        null,
      ),
    };
  }
}

export async function fetchChannelPreanalysisBundle(
  videoId: string,
  options: ChannelPreanalysisClientOptions = {},
  preferredManifest?: LoadedChannelPreanalysisManifest,
): Promise<ChannelPreanalysisBundle> {
  if (!VIDEO_ID_PATTERN.test(videoId)) {
    throw new ChannelPreanalysisClientError(
      "INVALID_BUNDLE",
      "A canonical YouTube video ID is required.",
    );
  }

  if (preferredManifest !== undefined) {
    const video = preferredManifest.manifest.videos.find(
      (candidate) => candidate.videoId === videoId,
    );
    if (video === undefined) {
      throw new ChannelPreanalysisClientError(
        "INVALID_BUNDLE",
        "The preferred catalog does not contain the requested video.",
      );
    }
    return (
      await fetchChannelPreanalysisBundleFromSource(
        preferredManifest,
        video,
        options,
      )
    ).bundle;
  }

  let lastError: unknown = null;
  for (const source of sourceBases(options)) {
    try {
      const loaded = await fetchChannelPreanalysisManifestFromSource(
        source,
        options,
      );
      const video = loaded.manifest.videos.find(
        (candidate) => candidate.videoId === videoId,
      );
      if (video === undefined) {
        throw new ChannelPreanalysisClientError(
          "INVALID_BUNDLE",
          "Catalog source does not contain the requested video.",
        );
      }
      return (
        await fetchChannelPreanalysisBundleFromSource(
          loaded,
          video,
          options,
        )
      ).bundle;
    } catch (cause) {
      lastError = cause;
    }
  }
  throw new ChannelPreanalysisClientError(
    "INVALID_BUNDLE",
    "Both channel preanalysis bundle sources failed.",
    { cause: lastError },
  );
}

export function parseChannelPreanalysisManifest(
  input: string,
  configuredSource: ConfiguredChannelPreanalysisSource =
    AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
): ChannelPreanalysisCatalogManifest {
  if (
    typeof input !== "string" ||
    new TextEncoder().encode(input).byteLength >
      CHANNEL_PREANALYSIS_MANIFEST_MAX_BYTES
  ) {
    throw new ChannelPreanalysisClientError(
      "TOO_LARGE",
      "Channel preanalysis catalog exceeds its byte limit.",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch (cause) {
    throw new ChannelPreanalysisClientError(
      "INVALID_JSON",
      "Channel preanalysis catalog JSON is invalid.",
      { cause },
    );
  }
  return validateManifest(value, configuredSource);
}

function validateManifest(
  value: unknown,
  configuredSource: ConfiguredChannelPreanalysisSource,
): ChannelPreanalysisCatalogManifest {
  const manifest = exactRecord(value, [
    "schemaVersion",
    "channelId",
    "channelHandle",
    "revision",
    "generatedAt",
    "videos",
    "artifacts",
  ]);
  if (
    manifest.schemaVersion !== CHANNEL_PREANALYSIS_CATALOG_SCHEMA_VERSION ||
    manifest.channelId !== configuredSource.channelId ||
    manifest.channelHandle !== configuredSource.channelHandle ||
    !isPositiveInteger(manifest.revision) ||
    !isIsoDate(manifest.generatedAt) ||
    !Array.isArray(manifest.videos) ||
    !Array.isArray(manifest.artifacts) ||
    manifest.videos.length > 10_000 ||
    manifest.artifacts.length > 40_000
  ) {
    throw invalidManifest();
  }

  const videoIds = new Set<string>();
  const videos = manifest.videos.map((video) =>
    validateVideo(video, videoIds, configuredSource),
  );
  const registeredFingerprints = new Set<string>();
  for (const video of videos) {
    for (const fingerprint of video.registeredLocalSampledFingerprints) {
      if (registeredFingerprints.has(fingerprint.value)) {
        throw invalidManifest();
      }
      registeredFingerprints.add(fingerprint.value);
    }
  }
  const artifactIds = new Set<string>();
  const artifacts = manifest.artifacts.map((artifact) =>
    validateArtifact(artifact, videoIds, artifactIds, configuredSource),
  );
  const artifactById = new Map(artifacts.map((artifact) => [artifact.artifactId, artifact]));
  const referencedArtifactIds = new Set<string>();
  for (const video of videos) {
    const referencedArtifacts: ChannelPreanalysisArtifact[] = [];
    for (const artifactId of video.artifactIds) {
      const artifact = artifactById.get(artifactId);
      if (artifact === undefined || artifact.videoId !== video.videoId) {
        throw invalidManifest();
      }
      referencedArtifactIds.add(artifactId);
      referencedArtifacts.push(artifact);
    }
    const transcriptArtifacts = referencedArtifacts.filter(
      ({ kind }) => kind === "transcript",
    );
    const fingerprintArtifacts = referencedArtifacts.filter(
      ({ kind }) => kind === "fingerprint",
    );
    const reviewArtifacts = referencedArtifacts.filter(
      ({ kind }) => kind === "review",
    );
    const reviewArtifactRequired = hasReviewReadySnapshot(video);
    if (
      (loadableTranscriptBundleState(video) !== null &&
        transcriptArtifacts.length !== 1) ||
      fingerprintArtifacts.length > 1 ||
      reviewArtifacts.length !== (reviewArtifactRequired ? 1 : 0) ||
      (reviewArtifactRequired && video.durationMs === null) ||
      reviewArtifacts.some(
        (artifact) => artifact.revision !== video.revision,
      ) ||
      transcriptArtifacts.some(
        (artifact) =>
          !isCanonicalBundleStorageKey(
            video.videoId,
            artifact.revision,
            artifact.storageKey,
            configuredSource,
          ) ||
          artifact.revision > video.revision,
      )
    ) {
      throw invalidManifest();
    }
  }
  if (
    artifacts.some(
      ({ artifactId }) => !referencedArtifactIds.has(artifactId),
    )
  ) {
    throw invalidManifest();
  }
  return {
    schemaVersion: CHANNEL_PREANALYSIS_CATALOG_SCHEMA_VERSION,
    channelId: configuredSource.channelId,
    channelHandle: configuredSource.channelHandle,
    revision: manifest.revision,
    generatedAt: manifest.generatedAt,
    videos,
    artifacts,
  };
}

function validateVideo(
  value: unknown,
  seenVideoIds: Set<string>,
  configuredSource: ConfiguredChannelPreanalysisSource,
): ChannelPreanalysisCatalogVideo {
  const video = exactRecord(value, [
    "channelId",
    "videoId",
    "title",
    "normalizedTitle",
    "durationMs",
    "publishedAt",
    "updatedAt",
    "watchUrl",
    "state",
    "revision",
    "artifactIds",
    "registeredLocalSampledFingerprints",
    "retry",
  ]);
  if (
    video.channelId !== configuredSource.channelId ||
    typeof video.videoId !== "string" ||
    !VIDEO_ID_PATTERN.test(video.videoId) ||
    seenVideoIds.has(video.videoId) ||
    !isText(video.title, 1_000) ||
    video.normalizedTitle !== normalizeChannelVideoTitle(video.title) ||
    !(
      video.durationMs === null ||
      (isPositiveInteger(video.durationMs) &&
        video.durationMs <= 12 * 60 * 60_000)
    ) ||
    !isIsoDate(video.publishedAt) ||
    !isIsoDate(video.updatedAt) ||
    video.watchUrl !== `https://www.youtube.com/watch?v=${video.videoId}` ||
    !isChannelPreanalysisState(video.state) ||
    !isPositiveInteger(video.revision) ||
    !isUniqueStringArray(video.artifactIds, 1_000, 256) ||
    !Array.isArray(video.registeredLocalSampledFingerprints) ||
    video.registeredLocalSampledFingerprints.length > 64
  ) {
    throw invalidManifest();
  }
  seenVideoIds.add(video.videoId);
  const fingerprints = video.registeredLocalSampledFingerprints.map((value) => {
    const fingerprint = exactRecord(value, ["value", "registeredAt"]);
    if (
      typeof fingerprint.value !== "string" ||
      !LOCAL_FINGERPRINT_PATTERN.test(fingerprint.value) ||
      !isIsoDate(fingerprint.registeredAt)
    ) {
      throw invalidManifest();
    }
    return {
      value: fingerprint.value,
      registeredAt: fingerprint.registeredAt,
    };
  });
  if (new Set(fingerprints.map(({ value }) => value)).size !== fingerprints.length) {
    throw invalidManifest();
  }
  const retry = validateRetry(video.retry, video.state);
  return {
    channelId: configuredSource.channelId,
    videoId: video.videoId,
    title: video.title,
    normalizedTitle: video.normalizedTitle,
    durationMs: video.durationMs,
    publishedAt: video.publishedAt,
    updatedAt: video.updatedAt,
    watchUrl: video.watchUrl,
    state: video.state,
    revision: video.revision,
    artifactIds: video.artifactIds,
    registeredLocalSampledFingerprints: fingerprints,
    retry,
  };
}

function validateRetry(
  value: unknown,
  state: ChannelPreanalysisCatalogVideo["state"],
): ChannelPreanalysisRetryCheckpoint | null {
  if (value === null) {
    if (state === "retryable") throw invalidManifest();
    return null;
  }
  if (state !== "retryable") throw invalidManifest();
  const retry = exactRecord(value, [
    "stage",
    "lastSuccessfulState",
    "attemptCount",
    "nextAttemptAt",
    "errorCode",
  ]);
  if (
    !["metadata", "transcript", "context", "review", "fingerprint"].includes(retry.stage as string) ||
    ![
      "discovered",
      "metadata-ready",
      "transcript-ready",
      "context-ready",
      "review-ready",
    ].includes(retry.lastSuccessfulState as string) ||
    !isPositiveInteger(retry.attemptCount) ||
    retry.attemptCount > 1_000 ||
    !isIsoDate(retry.nextAttemptAt) ||
    typeof retry.errorCode !== "string" ||
    !/^[A-Z0-9][A-Z0-9_:-]{0,95}$/u.test(retry.errorCode)
  ) {
    throw invalidManifest();
  }
  if (
    (retry.stage === "metadata" &&
      retry.lastSuccessfulState !== "discovered") ||
    (retry.stage === "transcript" &&
      retry.lastSuccessfulState !== "metadata-ready") ||
    (retry.stage === "context" &&
      retry.lastSuccessfulState !== "transcript-ready") ||
    (retry.stage === "review" &&
      retry.lastSuccessfulState !== "context-ready") ||
    (retry.stage === "fingerprint" &&
      ![
        "discovered",
        "metadata-ready",
        "transcript-ready",
        "context-ready",
        "review-ready",
      ].includes(retry.lastSuccessfulState as string))
  ) {
    throw invalidManifest();
  }
  return retry as unknown as ChannelPreanalysisRetryCheckpoint;
}

function validateArtifact(
  value: unknown,
  videoIds: ReadonlySet<string>,
  artifactIds: Set<string>,
  configuredSource: ConfiguredChannelPreanalysisSource,
): ChannelPreanalysisArtifact {
  const artifact = exactRecord(value, [
    "artifactId",
    "videoId",
    "kind",
    "revision",
    "storageKey",
    "contentDigest",
    "byteLength",
    "createdAt",
  ]);
  if (
    !isText(artifact.artifactId, 256) ||
    artifactIds.has(artifact.artifactId) ||
    typeof artifact.videoId !== "string" ||
    !videoIds.has(artifact.videoId) ||
    !["metadata", "transcript", "context", "review", "fingerprint"].includes(artifact.kind as string) ||
    !isPositiveInteger(artifact.revision) ||
    !isSafeStorageKey(artifact.storageKey, configuredSource) ||
    (artifact.kind === "transcript" &&
      !isCanonicalBundleStorageKey(
        artifact.videoId,
        artifact.revision,
        artifact.storageKey,
        configuredSource,
      )) ||
    (artifact.kind === "fingerprint" &&
      (artifact.revision !== 1 ||
        artifact.artifactId !==
          canonicalChannelPreanalysisVisualFingerprintArtifactId(
            artifact.videoId,
          ) ||
        artifact.storageKey !==
          canonicalChannelPreanalysisVisualFingerprintStorageKey(
            artifact.videoId,
            configuredSource.sourceId,
          ))) ||
    (artifact.kind === "review" &&
      (artifact.artifactId !==
        channelPreanalysisReviewBundleArtifactId(
          artifact.videoId,
          artifact.revision,
        ) ||
        artifact.storageKey !==
          channelPreanalysisReviewBundleStorageKey(
            configuredSource.sourceId,
            artifact.videoId,
            artifact.revision,
          ))) ||
    typeof artifact.contentDigest !== "string" ||
    !SHA256_PATTERN.test(artifact.contentDigest) ||
    !isPositiveInteger(artifact.byteLength) ||
    artifact.byteLength >
      (artifact.kind === "fingerprint"
        ? CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_BYTES
        : artifact.kind === "review"
          ? CHANNEL_PREANALYSIS_REVIEW_BUNDLE_MAX_BYTES
        : CHANNEL_PREANALYSIS_BUNDLE_MAX_BYTES) ||
    !isIsoDate(artifact.createdAt)
  ) {
    throw invalidManifest();
  }
  artifactIds.add(artifact.artifactId);
  return artifact as unknown as ChannelPreanalysisArtifact;
}

async function fetchChannelPreanalysisManifestFromSource(
  source: ChannelPreanalysisSourceBase,
  options: ChannelPreanalysisClientOptions,
): Promise<LoadedChannelPreanalysisManifest> {
  const maximumBytes = resolveMaximumBytes(
    options.manifestMaxBytes,
    CHANNEL_PREANALYSIS_MANIFEST_MAX_BYTES,
  );
  const text = await fetchBoundedText(
    joinBaseUrl(source.baseUrl, CHANNEL_PREANALYSIS_CATALOG_FILE),
    maximumBytes,
    options,
    resolveRequestTimeoutMs(
      options.manifestRequestTimeoutMs,
      CHANNEL_PREANALYSIS_MANIFEST_REQUEST_TIMEOUT_MS,
    ),
  );
  return {
    ...source,
    manifest: parseChannelPreanalysisManifest(text, source.configuredSource),
  };
}

async function fetchChannelPreanalysisBundleFromSource(
  loaded: LoadedChannelPreanalysisManifest,
  video: ChannelPreanalysisCatalogVideo,
  options: ChannelPreanalysisClientOptions,
): Promise<{
  readonly bundle: ChannelPreanalysisBundle;
  readonly artifact: ChannelPreanalysisArtifact;
}> {
  const configuredSource = requireConfiguredSource(loaded.manifest);
  const expectedBundleState = loadableTranscriptBundleState(video);
  if (expectedBundleState === null) {
    throw new ChannelPreanalysisClientError(
      "INVALID_BUNDLE",
      "The selected catalog video does not have a ready bundle.",
    );
  }
  const artifact = selectTranscriptBundleArtifact(loaded.manifest, video);
  const maximumBytes = resolveMaximumBytes(
    options.bundleMaxBytes,
    CHANNEL_PREANALYSIS_BUNDLE_MAX_BYTES,
  );
  const bytes = await fetchBoundedBytes(
    joinBaseUrl(
      loaded.baseUrl,
      relativeBundlePath(artifact.storageKey, configuredSource),
    ),
    maximumBytes,
    options,
    resolveRequestTimeoutMs(
      options.bundleRequestTimeoutMs,
      defaultBundleRequestTimeoutMs(artifact.byteLength),
    ),
  );
  await verifyArtifactBytes(bytes, artifact);
  const bundle = parseChannelPreanalysisBundle(decodeUtf8(bytes));
  await verifyChannelPreanalysisTranscriptDigest(bundle);
  assertChannelPreanalysisBundleMatchesCatalogVideo(
    bundle,
    expectedBundleState === video.state
      ? video
      : { ...video, state: expectedBundleState },
    loaded.manifest.revision,
  );
  return { bundle, artifact };
}

function selectTranscriptBundleArtifact(
  manifest: ChannelPreanalysisCatalogManifest,
  video: ChannelPreanalysisCatalogVideo,
): ChannelPreanalysisArtifact {
  const configuredSource = requireConfiguredSource(manifest);
  const artifactById = new Map(
    manifest.artifacts.map((artifact) => [artifact.artifactId, artifact]),
  );
  const artifacts = video.artifactIds
    .map((artifactId) => artifactById.get(artifactId))
    .filter(
      (artifact): artifact is ChannelPreanalysisArtifact =>
        artifact !== undefined &&
        artifact.videoId === video.videoId &&
        artifact.kind === "transcript",
    );
  const artifact = artifacts[0];
  if (
    artifacts.length !== 1 ||
    artifact === undefined ||
    !isCanonicalBundleStorageKey(
      video.videoId,
      artifact.revision,
      artifact.storageKey,
      configuredSource,
    )
  ) {
    throw new ChannelPreanalysisClientError(
      "INVALID_BUNDLE",
      "Catalog does not identify one canonical transcript bundle.",
    );
  }
  return artifact;
}

function selectVisualFingerprintArtifact(
  manifest: ChannelPreanalysisCatalogManifest,
  video: ChannelPreanalysisCatalogVideo,
): ChannelPreanalysisArtifact | null {
  const configuredSource = requireConfiguredSource(manifest);
  const artifactById = new Map(
    manifest.artifacts.map((artifact) => [artifact.artifactId, artifact]),
  );
  const artifacts = video.artifactIds
    .map((artifactId) => artifactById.get(artifactId))
    .filter(
      (artifact): artifact is ChannelPreanalysisArtifact =>
        artifact !== undefined &&
        artifact.videoId === video.videoId &&
        artifact.kind === "fingerprint",
    );
  if (artifacts.length === 0) return null;
  const artifact = artifacts[0];
  if (
    artifacts.length !== 1 ||
    artifact === undefined ||
    artifact.artifactId !==
      canonicalChannelPreanalysisVisualFingerprintArtifactId(video.videoId) ||
    artifact.revision !== 1 ||
    artifact.storageKey !==
      canonicalChannelPreanalysisVisualFingerprintStorageKey(
        video.videoId,
        configuredSource.sourceId,
      ) ||
    artifact.byteLength > CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_BYTES
  ) {
    throw new ChannelPreanalysisClientError(
      "INVALID_FINGERPRINT",
      "Catalog does not identify one canonical visual fingerprint.",
    );
  }
  return artifact;
}

function selectReviewBundleArtifact(
  manifest: ChannelPreanalysisCatalogManifest,
  video: ChannelPreanalysisCatalogVideo,
): ChannelPreanalysisArtifact {
  const configuredSource = requireConfiguredSource(manifest);
  const artifactById = new Map(
    manifest.artifacts.map((artifact) => [artifact.artifactId, artifact]),
  );
  const artifacts = video.artifactIds
    .map((artifactId) => artifactById.get(artifactId))
    .filter(
      (artifact): artifact is ChannelPreanalysisArtifact =>
        artifact !== undefined &&
        artifact.videoId === video.videoId &&
        artifact.kind === "review",
    );
  const artifact = artifacts[0];
  if (
    artifacts.length !== 1 ||
    artifact === undefined ||
    artifact.revision !== video.revision ||
    artifact.artifactId !==
      channelPreanalysisReviewBundleArtifactId(
        video.videoId,
        video.revision,
      ) ||
    artifact.storageKey !==
      channelPreanalysisReviewBundleStorageKey(
        configuredSource.sourceId,
        video.videoId,
        video.revision,
      ) ||
    artifact.byteLength > CHANNEL_PREANALYSIS_REVIEW_BUNDLE_MAX_BYTES
  ) {
    throw invalidReview("Catalog does not identify one canonical review bundle.");
  }
  return artifact;
}

async function verifyArtifactBytes(
  bytes: Uint8Array<ArrayBuffer>,
  artifact: ChannelPreanalysisArtifact,
): Promise<void> {
  if (bytes.byteLength !== artifact.byteLength) {
    throw new ChannelPreanalysisClientError(
      "INVALID_BUNDLE",
      "Preanalysis bundle byte length does not match its catalog artifact.",
    );
  }
  const digestAdapter = globalThis.crypto?.subtle ?? null;
  if (digestAdapter === null) {
    throw new ChannelPreanalysisClientError(
      "INVALID_BUNDLE",
      "SHA-256 is unavailable for preanalysis artifact verification.",
    );
  }
  let digest: ArrayBuffer;
  try {
    digest = await digestAdapter.digest("SHA-256", bytes);
  } catch (cause) {
    throw new ChannelPreanalysisClientError(
      "INVALID_BUNDLE",
      "Preanalysis artifact SHA-256 calculation failed.",
      { cause },
    );
  }
  const actual = `sha256:${bytesToHex(new Uint8Array(digest))}`;
  if (actual !== artifact.contentDigest) {
    throw new ChannelPreanalysisClientError(
      "INVALID_BUNDLE",
      "Preanalysis bundle digest does not match its catalog artifact.",
    );
  }
}

function lookupResult(
  loaded: LoadedChannelPreanalysisManifest,
  match: ChannelPreanalysisMatchResult,
  bundleStatus: ChannelPreanalysisBundleLoadStatus,
  bundle: ChannelPreanalysisBundle | null,
  bundleArtifact: ChannelPreanalysisArtifact | null,
): ChannelPreanalysisLookupResult {
  if ((bundle === null) !== (bundleArtifact === null)) {
    throw new ChannelPreanalysisClientError(
      "INVALID_BUNDLE",
      "A verified bundle and its artifact receipt must be returned together.",
    );
  }
  return {
    manifest: loaded.manifest,
    manifestSource: loaded.source,
    manifestBaseUrl: loaded.baseUrl,
    match,
    bundleStatus,
    bundle,
    bundleArtifact,
  };
}

function loadableTranscriptBundleState(
  video: ChannelPreanalysisCatalogVideo,
): ChannelPreanalysisBundle["state"] | null {
  if (video.state === "review-ready") return "context-ready";
  if (READY_BUNDLE_STATES.has(video.state)) {
    return video.state as ChannelPreanalysisBundle["state"];
  }
  if (
    video.state !== "retryable" ||
    !["context", "review", "fingerprint"].includes(video.retry?.stage ?? "")
  ) {
    return null;
  }
  if (video.retry?.lastSuccessfulState === "review-ready") {
    return "context-ready";
  }
  return ["transcript-ready", "context-ready"].includes(
    video.retry?.lastSuccessfulState ?? "",
  )
    ? (video.retry
        ?.lastSuccessfulState as ChannelPreanalysisBundle["state"])
    : null;
}

function hasReviewReadySnapshot(
  video: ChannelPreanalysisCatalogVideo,
): boolean {
  return (
    video.state === "review-ready" ||
    (video.state === "retryable" &&
      video.retry?.stage === "fingerprint" &&
      video.retry.lastSuccessfulState === "review-ready")
  );
}

async function fetchBoundedText(
  url: string,
  maximumBytes: number,
  options: ChannelPreanalysisClientOptions,
  timeoutMs: number,
): Promise<string> {
  return decodeUtf8(
    await fetchBoundedBytes(url, maximumBytes, options, timeoutMs),
  );
}

async function fetchBoundedBytes(
  url: string,
  maximumBytes: number,
  options: ChannelPreanalysisClientOptions,
  timeoutMs: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  const requestAbort = createIndependentRequestAbort(options.signal, timeoutMs);
  try {
    const response = await raceWithAbort(
      fetchImplementation(url, {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: requestAbort.signal,
      }),
      requestAbort.signal,
    );
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ChannelPreanalysisClientError(
        "HTTP_ERROR",
        `Channel preanalysis request failed with HTTP ${response.status}.`,
      );
    }
    const contentLength = response.headers.get("content-length");
    if (
      contentLength !== null &&
      (!/^\d+$/u.test(contentLength) || Number(contentLength) > maximumBytes)
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new ChannelPreanalysisClientError("TOO_LARGE", "Response is too large.");
    }
    return await readBoundedBody(
      response,
      maximumBytes,
      requestAbort.signal,
    );
  } catch (cause) {
    if (cause instanceof ChannelPreanalysisClientError) throw cause;
    throw new ChannelPreanalysisClientError(
      "FETCH_FAILED",
      "Channel preanalysis request failed.",
      { cause },
    );
  } finally {
    requestAbort.dispose();
  }
}

function decodeUtf8(bytes: Uint8Array<ArrayBuffer>): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new ChannelPreanalysisClientError(
      "INVALID_UTF8",
      "Response is not valid UTF-8.",
      { cause },
    );
  }
}

async function readBoundedBody(
  response: Response,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  if (response.body === null) {
    const buffer = await raceWithAbort(response.arrayBuffer(), signal);
    if (buffer.byteLength > maximumBytes) {
      throw new ChannelPreanalysisClientError("TOO_LARGE", "Response is too large.");
    }
    return new Uint8Array(buffer);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await raceWithAbort(reader.read(), signal);
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new ChannelPreanalysisClientError("TOO_LARGE", "Response is too large.");
      }
      chunks.push(value);
    }
  } catch (cause) {
    await reader.cancel().catch(() => undefined);
    throw cause;
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function defaultBundleRequestTimeoutMs(byteLength: number): number {
  const transferMs = Math.ceil(
    (byteLength / CHANNEL_PREANALYSIS_MINIMUM_DOWNLOAD_BYTES_PER_SECOND) *
      1_000,
  );
  return Math.min(
    CHANNEL_PREANALYSIS_REQUEST_MAX_TIMEOUT_MS,
    Math.max(
      CHANNEL_PREANALYSIS_BUNDLE_REQUEST_MIN_TIMEOUT_MS,
      CHANNEL_PREANALYSIS_MANIFEST_REQUEST_TIMEOUT_MS + transferMs,
    ),
  );
}

function resolveRequestTimeoutMs(
  requested: number | undefined,
  fallback: number,
): number {
  const resolved = requested ?? fallback;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved <= 0 ||
    resolved > CHANNEL_PREANALYSIS_REQUEST_MAX_TIMEOUT_MS
  ) {
    throw new ChannelPreanalysisClientError(
      "FETCH_FAILED",
      "Invalid channel preanalysis request timeout.",
    );
  }
  return resolved;
}

function createIndependentRequestAbort(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): {
  readonly signal: AbortSignal;
  readonly dispose: () => void;
} {
  const controller = new AbortController();
  const relayParentAbort = (): void => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted === true) {
    relayParentAbort();
  } else {
    parentSignal?.addEventListener("abort", relayParentAbort, { once: true });
  }
  const timeout = globalThis.setTimeout(
    () =>
      controller.abort(
        new DOMException(
          "Channel preanalysis request timed out.",
          "TimeoutError",
        ),
      ),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    dispose: () => {
      globalThis.clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", relayParentAbort);
    },
  };
}

function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(channelPreanalysisAbortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
      reject(channelPreanalysisAbortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (cause) => {
        signal.removeEventListener("abort", onAbort);
        reject(
          cause instanceof Error
            ? cause
            : new Error("Channel preanalysis request failed."),
        );
      },
    );
  });
}

function channelPreanalysisAbortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Channel preanalysis request aborted.", "AbortError");
}

function sourceBases(
  options: ChannelPreanalysisClientOptions,
): readonly ChannelPreanalysisSourceBase[] {
  const configuredSource =
    options.configuredSource ?? AMORETTO_CHANNEL_PREANALYSIS_SOURCE;
  const rawBaseUrl = `https://raw.githubusercontent.com/11qaws/exclipper/preanalysis-catalog/${configuredSource.sourceId}/`;
  const bundledBaseUrl = `${channelPreanalysisApplicationBaseUrl}preanalysis/${configuredSource.sourceId}/`;
  const values = [
    {
      source: "raw" as const,
      baseUrl: options.rawBaseUrl ?? rawBaseUrl,
      configuredSource,
    },
    {
      source: "bundled" as const,
      baseUrl: options.bundledBaseUrl ?? bundledBaseUrl,
      configuredSource,
    },
  ];
  return values.filter(
    (value, index) =>
      values.findIndex(({ baseUrl }) => baseUrl === value.baseUrl) === index,
  );
}

function joinBaseUrl(baseUrl: string, relativePath: string): string {
  if (typeof baseUrl !== "string" || baseUrl.trim() !== baseUrl || baseUrl.length === 0) {
    throw new ChannelPreanalysisClientError("FETCH_FAILED", "Catalog base URL is invalid.");
  }
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  if (/^https?:\/\//u.test(normalizedBase)) {
    const url = new URL(relativePath, normalizedBase);
    if (url.protocol !== "https:" && url.hostname !== "localhost") {
      throw new ChannelPreanalysisClientError("FETCH_FAILED", "Catalog URL is unsafe.");
    }
    return url.toString();
  }
  if (!normalizedBase.startsWith("/") || relativePath.includes("..")) {
    throw new ChannelPreanalysisClientError("FETCH_FAILED", "Catalog URL is unsafe.");
  }
  return `${normalizedBase}${relativePath}`;
}

function resolveMaximumBytes(
  requested: number | undefined,
  hardMaximum: number,
): number {
  const resolved = requested ?? hardMaximum;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved <= 0 ||
    resolved > hardMaximum
  ) {
    throw new ChannelPreanalysisClientError(
      "TOO_LARGE",
      "Invalid response byte limit.",
    );
  }
  return resolved;
}

function canonicalBundleStorageKey(
  videoId: string,
  revision: number,
  configuredSource: ConfiguredChannelPreanalysisSource,
): string {
  return `${channelPreanalysisStoragePrefix(configuredSource)}videos/${videoId}.v${revision}.json`;
}

function isCanonicalBundleStorageKey(
  videoId: string,
  revision: number,
  storageKey: string,
  configuredSource: ConfiguredChannelPreanalysisSource =
    AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
): boolean {
  return (
    storageKey ===
      canonicalBundleStorageKey(videoId, revision, configuredSource) ||
    (revision === 1 &&
      storageKey ===
        `${channelPreanalysisStoragePrefix(configuredSource)}videos/${videoId}.json`)
  );
}

function relativeBundlePath(
  storageKey: string,
  configuredSource: ConfiguredChannelPreanalysisSource,
): string {
  return storageKey.slice(channelPreanalysisStoragePrefix(configuredSource).length);
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidManifest();
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw invalidManifest();
  }
  return record;
}

function isText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    Array.from(value).length <= maximum &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_DATE_TIME_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isUniqueStringArray(
  value: unknown,
  maximumItems: number,
  maximumLength: number,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximumItems &&
    value.every((item) => isText(item, maximumLength)) &&
    new Set(value).size === value.length
  );
}

function isSafeStorageKey(
  value: unknown,
  configuredSource: ConfiguredChannelPreanalysisSource,
): value is string {
  const prefix = channelPreanalysisStoragePrefix(configuredSource);
  return (
    typeof value === "string" &&
    value.length <= 512 &&
    value.startsWith(prefix) &&
    /^[a-z0-9-]+\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)*$/u.test(value) &&
    value.split("/").every((segment) => segment !== "." && segment !== "..")
  );
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

function invalidManifest(): ChannelPreanalysisClientError {
  return new ChannelPreanalysisClientError(
    "INVALID_MANIFEST",
    "Channel preanalysis catalog failed strict validation.",
  );
}

function invalidReview(
  message: string,
  cause?: unknown,
): ChannelPreanalysisClientError {
  return new ChannelPreanalysisClientError("INVALID_REVIEW", message, {
    cause,
  });
}

function requireConfiguredSource(
  manifest: Pick<ChannelPreanalysisCatalogManifest, "channelId" | "channelHandle">,
): ConfiguredChannelPreanalysisSource {
  const source = channelPreanalysisSourceForManifest(manifest);
  if (source === null) throw invalidManifest();
  return source;
}
