import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  QWEN_CONTEXT_DISCOVERY_MODEL_ID,
  QWEN_CONTEXT_DISCOVERY_MODEL_REVISION,
  QWEN_CONTEXT_OVERVIEW_FALLBACK_MODEL_ID,
  QWEN_CONTEXT_OVERVIEW_FALLBACK_MODEL_REVISION,
} from "../src/cloudflare/aiProviderConfiguration.ts";
import {
  CHANNEL_PREANALYSIS_CATALOG_SCHEMA_VERSION,
  YOUTUBE_CHANNEL_ATOM_FEED_MAX_BYTES,
  channelPreanalysisSourceForManifest,
  isChannelPreanalysisState,
  normalizeChannelVideoTitle,
  parseYouTubeChannelAtomFeed,
} from "../src/analysis/channelPreanalysisCatalog.ts";
import {
  AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
  CHANNEL_PREANALYSIS_SOURCES,
  channelPreanalysisSourceByChannelId,
  channelPreanalysisSourceById,
  channelPreanalysisStoragePrefix,
} from "../src/analysis/channelPreanalysisSources.ts";
import {
  CHANNEL_PREANALYSIS_BUNDLE_MAX_BYTES,
  assertChannelPreanalysisBundleMatchesCatalogVideo,
  createChannelPreanalysisBundle,
  createDefaultChannelPreanalysisProvenance,
  createScheduledAsrChannelPreanalysisProvenance,
  parseChannelPreanalysisBundle,
  verifyChannelPreanalysisTranscriptDigest,
} from "../src/analysis/channelPreanalysisBundle.ts";
import {
  MAX_BROADCAST_CONTEXT_CHAPTERS,
  BROADCAST_CONTEXT_SCHEMA_VERSION,
  createBroadcastContextRequest,
} from "../src/analysis/broadcastContextProtocol.ts";
import { compactBroadcastContextChapters } from "../src/analysis/broadcastContextChapterCompaction.ts";
import {
  createParallelBroadcastTopicalDiscoverySlices,
  mergeBroadcastTopicalDiscoveryLeads,
} from "../src/analysis/broadcastTopicalDiscovery.ts";
import {
  MAX_BROADCAST_CONTEXT_DEEPSEEK_RESPONSE_BYTES,
  parseCurrentBroadcastContextResult,
} from "../src/analysis/broadcastContextDeepseek.ts";
import { createBroadcastParticipantGrounding } from "../src/analysis/broadcastParticipantGrounding.ts";
import { AI_BROADCAST_CONTEXT_ROUTING_REVISION } from "../src/analysis/aiModelRoutingPolicy.ts";
import {
  candidatePassBCastRosterIdForYouTubeChannelId,
} from "../src/analysis/participantRoster.ts";
import {
  PREANALYSIS_CONTEXT_CONTRACT_HEADER,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID_HEADER,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION_HEADER,
  PREANALYSIS_CONTEXT_ATTEMPT_HEADER,
  PREANALYSIS_CONTEXT_POSSIBLE_DUPLICATE_PROVIDER_CHARGE,
  PREANALYSIS_CONTEXT_MODEL_ID_HEADER,
  PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER,
  PREANALYSIS_CONTEXT_OPERATION_HEADER,
  PREANALYSIS_CONTEXT_ORIGIN,
  PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER,
  PREANALYSIS_CONTEXT_PROXY_VERSION,
  PREANALYSIS_CONTEXT_RETRY_RISK_HEADER,
  PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER,
  createPreanalysisContextOperationId,
} from "../src/cloudflare/preanalysisContextProxy.worker.ts";
import {
  YOUTUBE_VIDEO_ID_PATTERN,
  boundYouTubeCaptionTrackToDuration,
  createYouTubeCaptionChapters,
  parseYouTubeCaptionJson3,
} from "../src/analysis/youtubeCaptionTrack.ts";
import {
  CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_BYTES,
  canonicalChannelPreanalysisVisualFingerprintArtifactId,
  canonicalChannelPreanalysisVisualFingerprintStorageKey,
  parseChannelPreanalysisVisualFingerprint,
  serializeChannelPreanalysisVisualFingerprint,
} from "../src/analysis/channelPreanalysisVisualFingerprint.ts";
import {
  CHANNEL_PREANALYSIS_REVIEW_BUNDLE_MAX_BYTES,
  channelPreanalysisReviewBundleArtifactId,
  channelPreanalysisReviewBundleStorageKey,
  parseChannelPreanalysisReviewBundle,
  verifyChannelPreanalysisReviewBundleIntegrity,
} from "../src/analysis/channelPreanalysisReviewBundle.ts";
import { createVisualFingerprintFromYtDlpMetadata } from "./channel-preanalysis-visual-fingerprint.mjs";
import {
  prepareScheduledAsrCaptionTrack,
  removeScheduledAsrCheckpoint,
} from "./lib/channel-preanalysis-scheduled-asr.mjs";

export const PINNED_YT_DLP_VERSION = "2026.07.04";
export const PINNED_YT_DLP_SHA256 =
  "495be29ff4d9d4e9be7eabdfef225221e5d5282e77f2f505abc6dca80349f3fd";
export const DEFAULT_MAX_VIDEOS_PER_RUN = 2;
export const MAX_VIDEOS_PER_RUN = 2;
export const MAX_CAPTION_JSON3_BYTES = 32 * 1024 * 1024;
export const CHANNEL_PREANALYSIS_MANIFEST_MAX_BYTES = 4 * 1024 * 1024;
export const DEFAULT_CONTEXT_PROXY_URL = null;
export const DEFAULT_CONTEXT_PROVIDER_RETRY_POLICY = "free-tier-recovery";
export {
  PREANALYSIS_CONTEXT_CONTRACT_HEADER,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID_HEADER,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION_HEADER,
  PREANALYSIS_CONTEXT_ATTEMPT_HEADER,
  PREANALYSIS_CONTEXT_POSSIBLE_DUPLICATE_PROVIDER_CHARGE,
  PREANALYSIS_CONTEXT_MODEL_ID_HEADER,
  PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER,
  PREANALYSIS_CONTEXT_OPERATION_HEADER,
  PREANALYSIS_CONTEXT_ORIGIN,
  PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER,
  PREANALYSIS_CONTEXT_PROXY_VERSION,
  PREANALYSIS_CONTEXT_RETRY_RISK_HEADER,
  PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER,
};
export const DEFAULT_CATALOG_DIRECTORY = join(
  "preanalysis-catalog",
  "amoretto-vods",
);
export const DEFAULT_CATALOG_ROOT_DIRECTORY = "preanalysis-catalog";
export const ALL_CHANNEL_PREANALYSIS_SOURCES = "all";
export const CHANNEL_PREANALYSIS_RUN_REPORT_FILE =
  "channel-preanalysis-run-report.json";

const MAX_COMMAND_STDOUT_BYTES = 8 * 1024 * 1024;
const MAX_COMMAND_STDERR_BYTES = 256 * 1024;
const YT_DLP_TIMEOUT_MS = 5 * 60_000;
const FEED_TIMEOUT_MS = 30_000;
const CONTEXT_REQUEST_TIMEOUT_MS = 210_000;
const MAX_VIDEO_DURATION_MS = 12 * 60 * 60_000;
const SHARED_FOREGROUND_WORKER_HOST =
  "rettohighlight-gemini.11qaws.workers.dev";
const PREANALYSIS_CONTEXT_TOKEN_PATTERN =
  /^[A-Za-z0-9._~-]{24,512}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const LOCAL_FINGERPRINT_PATTERN =
  /^local-file-sampled-sha256-v1:[0-9a-f]{64}$/u;
const ISO_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const MAX_CATALOG_VIDEOS = 10_000;
const MAX_CATALOG_ARTIFACTS = 40_000;
const MAX_VIDEO_ARTIFACT_IDS = 1_000;
const MAX_VIDEO_FINGERPRINTS = 64;
const MAX_YT_DLP_CHILD_ENV_VALUE_BYTES = 32 * 1024;
const YT_DLP_CHILD_ENV_PASSTHROUGH_KEYS = Object.freeze([
  // Executable discovery and OS process basics.
  "PATH",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "TMPDIR",
  "TMP",
  "TEMP",
  // Stable UTF-8 diagnostics and time formatting on POSIX runners.
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "LC_TIME",
  "TZ",
  "PYTHONUTF8",
  "PYTHONIOENCODING",
  // Explicit network compatibility. Credential-bearing proxy URLs are rejected.
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  // Public CA bundle locations used by Python, curl, or a delegated JS runtime.
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
  "NODE_EXTRA_CA_CERTS",
]);
const YT_DLP_PROXY_URL_ENV_KEYS = new Set([
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
]);
const YT_DLP_ALLOWED_PROXY_PROTOCOLS = new Set([
  "http:",
  "https:",
  "socks4:",
  "socks4a:",
  "socks5:",
  "socks5h:",
]);
const SUCCESSFUL_STATES = new Set([
  "transcript-ready",
  "context-ready",
  "review-ready",
  "published",
]);
const RETRY_DELAYS_MS = [3, 6, 12, 24].map(
  (hours) => hours * 60 * 60_000,
);
const PERMANENT_CAPTION_RETRY_DELAYS_MS = [24, 72, 168, 336].map(
  (hours) => hours * 60 * 60_000,
);
const PERMANENT_CAPTION_RETRY_CODES = new Set([
  "KOREAN_CAPTION_NOT_FOUND",
  "KOREAN_CAPTION_EMPTY",
  "KOREAN_CAPTION_CHAPTERS_EMPTY",
]);
const MAX_SCHEDULED_CONTEXT_RETRIES = 3;
const MAX_SCHEDULED_CONTEXT_RETRY_AFTER_MS = 120_000;
const SCHEDULED_CONTEXT_DISCOVERY_CALLS = 3;
const SCHEDULED_CONTEXT_PROVIDER_RETRY_POLICIES = new Set([
  DEFAULT_CONTEXT_PROVIDER_RETRY_POLICY,
  "strict-paid",
]);
const MAX_SCHEDULED_CONTEXT_WORKER_ATTEMPT = 999_999_999;

export class ChannelPreanalysisSyncError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "ChannelPreanalysisSyncError";
    this.code = code;
  }
}

export function parseSyncArguments(
  argv,
  {
    cwd = process.cwd(),
    defaultYtDlp = process.env.YT_DLP_PATH ?? "yt-dlp",
    defaultContextProxy =
      process.env.CHANNEL_PREANALYSIS_CONTEXT_PROXY_URL ??
      DEFAULT_CONTEXT_PROXY_URL,
    defaultContextToken =
      process.env.CHANNEL_PREANALYSIS_CONTEXT_TOKEN ?? null,
    defaultContextProviderRetryPolicy =
      process.env.CHANNEL_PREANALYSIS_CONTEXT_PROVIDER_RETRY_POLICY ??
      DEFAULT_CONTEXT_PROVIDER_RETRY_POLICY,
  } = {},
) {
  const values = new Map();
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    if (!argument.startsWith("--")) {
      throw syncError("INVALID_ARGUMENT", `Unexpected argument: ${argument}`);
    }
    const separatorIndex = argument.indexOf("=");
    const key =
      separatorIndex < 0 ? argument : argument.slice(0, separatorIndex);
    const inlineValue =
      separatorIndex < 0 ? null : argument.slice(separatorIndex + 1);
    if (
      ![
        "--video-id",
        "--max-videos",
        "--catalog-dir",
        "--yt-dlp",
        "--context-proxy",
        "--context-retry-policy",
        "--source",
      ].includes(key)
    ) {
      throw syncError("INVALID_ARGUMENT", `Unknown option: ${key}`);
    }
    if (values.has(key)) {
      throw syncError("INVALID_ARGUMENT", `Duplicate option: ${key}`);
    }
    const value =
      inlineValue ??
      (() => {
        const next = argv[index + 1];
        if (next === undefined || next.startsWith("--")) {
          throw syncError("INVALID_ARGUMENT", `Missing value for ${key}`);
        }
        index += 1;
        return next;
      })();
    if (value.length === 0) {
      throw syncError("INVALID_ARGUMENT", `Empty value for ${key}`);
    }
    values.set(key, value);
  }

  const videoId = values.get("--video-id") ?? null;
  if (videoId !== null && !YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
    throw syncError("INVALID_ARGUMENT", "YouTube video ID must be 11 characters.");
  }
  const maxVideosText =
    values.get("--max-videos") ?? String(DEFAULT_MAX_VIDEOS_PER_RUN);
  const maxVideos = Number(maxVideosText);
  if (
    !Number.isSafeInteger(maxVideos) ||
    maxVideos < 1 ||
    maxVideos > MAX_VIDEOS_PER_RUN
  ) {
    throw syncError(
      "INVALID_ARGUMENT",
      `--max-videos must be between 1 and ${MAX_VIDEOS_PER_RUN}.`,
    );
  }

  const contextProxyUrl = normalizeContextProxyUrl(
    values.get("--context-proxy") ?? defaultContextProxy,
  );
  const contextAuthorizationToken =
    normalizeContextAuthorizationToken(defaultContextToken);
  assertContextConfigurationPair(
    contextProxyUrl,
    contextAuthorizationToken,
  );
  const contextProviderRetryPolicy = normalizeContextProviderRetryPolicy(
    values.get("--context-retry-policy") ?? defaultContextProviderRetryPolicy,
  );

  const sourceValue = values.get("--source") ?? ALL_CHANNEL_PREANALYSIS_SOURCES;
  const configuredSource =
    sourceValue === ALL_CHANNEL_PREANALYSIS_SOURCES
      ? null
      : channelPreanalysisSourceById(sourceValue);
  if (sourceValue !== ALL_CHANNEL_PREANALYSIS_SOURCES && configuredSource === null) {
    throw syncError(
      "INVALID_ARGUMENT",
      `--source must be ${ALL_CHANNEL_PREANALYSIS_SOURCES} or one of ${CHANNEL_PREANALYSIS_SOURCES.map(({ sourceId }) => sourceId).join(", ")}.`,
    );
  }
  if (videoId !== null && configuredSource === null) {
    throw syncError(
      "INVALID_ARGUMENT",
      "--video-id requires an explicit --source so the retry cannot target the wrong catalog.",
    );
  }
  const defaultCatalogDirectory =
    configuredSource === null
      ? DEFAULT_CATALOG_ROOT_DIRECTORY
      : join(DEFAULT_CATALOG_ROOT_DIRECTORY, configuredSource.sourceId);

  return {
    help,
    videoId,
    maxVideos,
    configuredSource,
    catalogDir: resolve(cwd, values.get("--catalog-dir") ?? defaultCatalogDirectory),
    ytDlpPath: values.get("--yt-dlp") ?? defaultYtDlp,
    contextProxyUrl,
    contextAuthorizationToken,
    contextProviderRetryPolicy,
  };
}

/**
 * yt-dlp is a pinned but network-capable third-party executable. Give it only
 * the OS, locale, proxy, and CA variables needed to operate; never inherit the
 * GitHub step environment, provider credentials, or the scheduled Bearer token.
 */
export function createYtDlpChildEnvironment(
  sourceEnvironment = process.env,
) {
  if (
    typeof sourceEnvironment !== "object" ||
    sourceEnvironment === null ||
    Array.isArray(sourceEnvironment)
  ) {
    throw syncError(
      "YT_DLP_ENV_INVALID",
      "yt-dlp child environment must be a key-value object.",
    );
  }
  const childEnvironment = { NO_COLOR: "1" };
  for (const key of YT_DLP_CHILD_ENV_PASSTHROUGH_KEYS) {
    const value = sourceEnvironment[key];
    if (value === undefined || value === "") continue;
    if (
      typeof value !== "string" ||
      Buffer.byteLength(value) > MAX_YT_DLP_CHILD_ENV_VALUE_BYTES ||
      /[\0\r\n]/u.test(value)
    ) {
      throw syncError(
        "YT_DLP_ENV_INVALID",
        `yt-dlp environment variable ${key} is not a bounded single-line value.`,
      );
    }
    if (YT_DLP_PROXY_URL_ENV_KEYS.has(key)) {
      assertSafeYtDlpProxyEnvironmentValue(key, value);
    }
    childEnvironment[key] = value;
  }
  return childEnvironment;
}

function assertSafeYtDlpProxyEnvironmentValue(key, value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw syncError(
      "YT_DLP_ENV_INVALID",
      `yt-dlp proxy environment variable ${key} must be an absolute URL.`,
    );
  }
  if (
    !YT_DLP_ALLOWED_PROXY_PROTOCOLS.has(parsed.protocol) ||
    parsed.hostname === "" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw syncError(
      "YT_DLP_ENV_INVALID",
      `yt-dlp proxy environment variable ${key} must not contain credentials or an unsupported scheme.`,
    );
  }
}

export function createEmptyCatalog(
  nowIso,
  configuredSource = AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
) {
  assertIsoDate(nowIso, "generatedAt");
  assertConfiguredSource(configuredSource);
  return {
    schemaVersion: CHANNEL_PREANALYSIS_CATALOG_SCHEMA_VERSION,
    channelId: configuredSource.channelId,
    channelHandle: configuredSource.channelHandle,
    revision: 1,
    generatedAt: nowIso,
    videos: [],
    artifacts: [],
  };
}

export function mergeFeedIntoCatalog(existing, feed, nowIso) {
  const catalog = normalizeCatalogManifest(existing);
  const configuredSource = channelPreanalysisSourceForManifest(catalog);
  assertIsoDate(nowIso, "generatedAt");
  if (feed.channelId !== configuredSource.channelId) {
    throw syncError("WRONG_CHANNEL", "Feed channel does not match the catalog.");
  }
  const byId = new Map(catalog.videos.map((video) => [video.videoId, video]));
  let changed = false;

  for (const incoming of feed.videos) {
    const current = byId.get(incoming.videoId);
    if (current === undefined) {
      byId.set(incoming.videoId, {
        channelId: configuredSource.channelId,
        videoId: incoming.videoId,
        title: incoming.title,
        normalizedTitle: incoming.normalizedTitle,
        durationMs: incoming.durationMs,
        publishedAt: incoming.publishedAt,
        updatedAt: incoming.updatedAt,
        watchUrl: incoming.watchUrl,
        state: "discovered",
        revision: 1,
        artifactIds: [],
        registeredLocalSampledFingerprints: [],
        retry: null,
      });
      changed = true;
      continue;
    }

    const hasImmutableBundle =
      SUCCESSFUL_STATES.has(current.state) ||
      (current.state === "retryable" &&
        ["transcript-ready", "context-ready"].includes(
          current.retry?.lastSuccessfulState,
        ));
    const nextTitle = hasImmutableBundle ? current.title : incoming.title;
    const nextNormalizedTitle = hasImmutableBundle
      ? current.normalizedTitle
      : incoming.normalizedTitle;
    const nextPublishedAt = hasImmutableBundle
      ? current.publishedAt
      : incoming.publishedAt;
    const nextDurationMs = hasImmutableBundle
      ? current.durationMs
      : (current.durationMs ?? incoming.durationMs);
    const metadataChanged =
      current.title !== nextTitle ||
      current.normalizedTitle !== nextNormalizedTitle ||
      current.publishedAt !== nextPublishedAt ||
      current.updatedAt !== incoming.updatedAt ||
      current.watchUrl !== incoming.watchUrl ||
      current.durationMs !== nextDurationMs;
    if (!metadataChanged) continue;
    byId.set(incoming.videoId, {
      ...current,
      title: nextTitle,
      normalizedTitle: nextNormalizedTitle,
      durationMs: nextDurationMs,
      publishedAt: nextPublishedAt,
      updatedAt: incoming.updatedAt,
      watchUrl: incoming.watchUrl,
      revision: current.revision + 1,
    });
    changed = true;
  }

  if (!changed) return { manifest: catalog, changed: false };
  return {
    manifest: normalizeCatalogManifest({
      ...catalog,
      revision: catalog.revision + 1,
      generatedAt: nowIso,
      videos: sortCatalogVideos([...byId.values()]),
    }),
    changed: true,
  };
}

export function selectDueCatalogVideos(
  manifest,
  {
    nowIso,
    maxVideos = DEFAULT_MAX_VIDEOS_PER_RUN,
    videoId = null,
    includeTranscriptReady = false,
    includePermanentCaptionRetries = true,
    recoverCaptionRetriesWithAsr = false,
  },
) {
  const catalog = normalizeCatalogManifest(manifest);
  const nowMs = Date.parse(assertIsoDate(nowIso, "nowIso"));
  if (
    !Number.isSafeInteger(maxVideos) ||
    maxVideos < 1 ||
    maxVideos > MAX_VIDEOS_PER_RUN
  ) {
    throw syncError("INVALID_SELECTION", "Video selection limit is invalid.");
  }
  if (videoId !== null && !YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
    throw syncError("INVALID_SELECTION", "Selected YouTube video ID is invalid.");
  }

  if (videoId !== null) {
    const selected = catalog.videos.find((video) => video.videoId === videoId);
    if (selected === undefined) {
      throw syncError(
        "VIDEO_NOT_IN_CATALOG",
        "The requested video is not present in the reconciled catalog.",
      );
    }
    // An explicit retry is also a readback verification. Current artifacts
    // return immediately in prepareVideo, while stale routing/schema bytes are
    // rebuilt from their last authoritative source in this same invocation.
    return [selected];
  }

  return catalog.videos
    .filter((video) => {
      if (
        catalogVideoReachedTarget(
          catalog,
          video,
          includeTranscriptReady,
        )
      ) {
        return false;
      }
      if (video.state !== "retryable") return true;
      if (
        !includePermanentCaptionRetries &&
        PERMANENT_CAPTION_RETRY_CODES.has(video.retry?.errorCode)
      ) {
        return false;
      }
      if (
        recoverCaptionRetriesWithAsr &&
        PERMANENT_CAPTION_RETRY_CODES.has(video.retry?.errorCode)
      ) {
        return true;
      }
      return (
        video.retry !== null &&
        Date.parse(video.retry.nextAttemptAt) <= nowMs
      );
    })
    .sort((left, right) => {
      const queueRank = (video) =>
        video.state !== "retryable"
          ? 0
          : PERMANENT_CAPTION_RETRY_CODES.has(video.retry?.errorCode) &&
              !recoverCaptionRetriesWithAsr
            ? 3
            : video.retry?.stage === "fingerprint"
              ? 2
              : 1;
      return (
        queueRank(left) - queueRank(right) ||
        Date.parse(right.publishedAt) - Date.parse(left.publishedAt) ||
        left.videoId.localeCompare(right.videoId)
      );
    })
    .slice(0, maxVideos);
}

export function validateYtDlpMetadata(
  value,
  expectedVideoId,
  configuredSource = AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
) {
  assertConfiguredSource(configuredSource);
  if (!isRecord(value)) {
    throw syncError("INVALID_METADATA", "yt-dlp metadata must be an object.");
  }
  if (
    value.id !== expectedVideoId ||
    !YOUTUBE_VIDEO_ID_PATTERN.test(expectedVideoId)
  ) {
    throw syncError("WRONG_VIDEO", "yt-dlp returned a different video.");
  }
  if (value.channel_id !== configuredSource.channelId) {
    throw syncError("WRONG_CHANNEL", "yt-dlp returned a different channel.");
  }
  if (value.availability !== "public") {
    throw syncError("VIDEO_NOT_PUBLIC", "The video is not publicly available.");
  }
  const acceptedLiveStatuses =
    configuredSource.playlistKind === "live-streams"
      ? new Set(["not_live", "was_live"])
      : new Set(["not_live"]);
  if (!acceptedLiveStatuses.has(value.live_status)) {
    throw syncError("VIDEO_IS_LIVE", "Only completed, non-live videos are allowed.");
  }
  if (
    typeof value.title !== "string" ||
    value.title.trim() !== value.title ||
    value.title.length === 0 ||
    Array.from(value.title).length > 1_000 ||
    /[\p{Cc}\p{Cf}]/u.test(value.title)
  ) {
    throw syncError("INVALID_METADATA", "Video title is invalid.");
  }
  if (
    typeof value.duration !== "number" ||
    !Number.isFinite(value.duration) ||
    value.duration <= 0
  ) {
    throw syncError("INVALID_METADATA", "Video duration is missing.");
  }
  const durationMs = Math.round(value.duration * 1_000);
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs <= 0 ||
    durationMs > MAX_VIDEO_DURATION_MS
  ) {
    throw syncError("INVALID_METADATA", "Video duration exceeds 12 hours.");
  }

  return {
    videoId: expectedVideoId,
    channelId: configuredSource.channelId,
    title: value.title,
    normalizedTitle: normalizeChannelVideoTitle(value.title),
    durationMs,
    availability: "public",
    liveStatus: value.live_status,
    watchUrl: `https://www.youtube.com/watch?v=${expectedVideoId}`,
  };
}

function catalogVideoReachedTarget(
  manifest,
  video,
  includeTranscriptReady,
) {
  if (
    SUCCESSFUL_STATES.has(video.state) &&
    !hasVisualFingerprintArtifact(manifest, video.videoId)
  ) {
    return false;
  }
  if (includeTranscriptReady && video.state === "transcript-ready") {
    return false;
  }
  return SUCCESSFUL_STATES.has(video.state);
}

export function createRetryCheckpoint(
  video,
  stage,
  errorCode,
  nowIso,
) {
  if (!["metadata", "transcript", "context", "review", "fingerprint"].includes(stage)) {
    throw syncError("INVALID_RETRY", "Retry stage is invalid.");
  }
  const nowMs = Date.parse(assertIsoDate(nowIso, "retry time"));
  const priorAttempt =
    video.state === "retryable" && video.retry?.stage === stage
      ? video.retry.attemptCount
      : 0;
  const attemptCount = priorAttempt + 1;
  const retryDelays = PERMANENT_CAPTION_RETRY_CODES.has(errorCode)
    ? PERMANENT_CAPTION_RETRY_DELAYS_MS
    : RETRY_DELAYS_MS;
  const delay =
    retryDelays[Math.min(attemptCount - 1, retryDelays.length - 1)];
  const lastSuccessfulState =
    stage === "metadata"
      ? "discovered"
      : stage === "transcript"
        ? "metadata-ready"
        : stage === "context"
          ? "transcript-ready"
          : stage === "review"
            ? "context-ready"
          : fingerprintRetryBaseState(video);
  return {
    stage,
    lastSuccessfulState,
    attemptCount,
    nextAttemptAt: new Date(nowMs + delay).toISOString(),
    errorCode: normalizeErrorCode(errorCode),
  };
}

export async function createTranscriptReadyBundle({
  video,
  captionJson,
  captionLanguageCode = "ko-orig",
  captionIsAutoGenerated = true,
  catalogRevision,
  extractedAt,
}) {
  if (video.durationMs === null) {
    throw syncError("INVALID_METADATA", "Duration is required before captions.");
  }
  if (
    !(
      (captionLanguageCode === "ko" && captionIsAutoGenerated === false) ||
      (captionLanguageCode === "ko-orig" && captionIsAutoGenerated === true)
    )
  ) {
    throw syncError(
      "INVALID_CAPTION_SOURCE",
      "Korean caption language and generation metadata are inconsistent.",
    );
  }
  const parsedTrack = parseYouTubeCaptionJson3(captionJson, {
    videoId: video.videoId,
    languageCode: captionLanguageCode,
    isAutoGenerated: captionIsAutoGenerated,
    baseUrl: video.watchUrl,
  });
  const track = parsedTrack === null
    ? null
    : boundYouTubeCaptionTrackToDuration(parsedTrack, video.durationMs);
  if (track === null) {
    throw syncError(
      "KOREAN_CAPTION_EMPTY",
      "The selected Korean JSON3 track has no usable caption events.",
    );
  }
  const chapters = createYouTubeCaptionChapters(track, video.durationMs);
  if (chapters.length === 0) {
    throw syncError(
      "KOREAN_CAPTION_CHAPTERS_EMPTY",
      "The selected Korean track could not form complete chapters.",
    );
  }
  return createChannelPreanalysisBundle({
    channelId: video.channelId,
    videoId: video.videoId,
    title: video.title,
    durationMs: video.durationMs,
    publishedAt: video.publishedAt,
    catalogRevision,
    state: "transcript-ready",
    captionTrack: track,
    chapters,
    broadcastContext: null,
    provenance: createDefaultChannelPreanalysisProvenance(
      video.videoId,
      extractedAt,
    ),
  });
}

export async function createScheduledAsrTranscriptReadyBundle({
  video,
  captionTrack,
  catalogRevision,
  extractedAt,
}) {
  const chapters =
    captionTrack.events.length === 0
      ? createScheduledNoSpeechCoverageChapters(video.durationMs)
      : createYouTubeCaptionChapters(captionTrack, video.durationMs);
  if (chapters.length === 0) {
    throw syncError(
      "SCHEDULED_ASR_CHAPTERS_EMPTY",
      "The completed scheduled ASR track could not form broadcast chapters.",
    );
  }
  return createChannelPreanalysisBundle({
    channelId: video.channelId,
    videoId: video.videoId,
    title: video.title,
    durationMs: video.durationMs,
    publishedAt: video.publishedAt,
    catalogRevision,
    state: "transcript-ready",
    captionTrack,
    chapters,
    broadcastContext: null,
    provenance: createScheduledAsrChannelPreanalysisProvenance(
      video.videoId,
      extractedAt,
    ),
  });
}

function createScheduledNoSpeechCoverageChapters(durationMs) {
  const chapterDurationMs = Math.max(
    120_000,
    Math.ceil(durationMs / MAX_BROADCAST_CONTEXT_CHAPTERS / 1_000) * 1_000,
  );
  const chapters = [];
  for (let startMs = 0; startMs < durationMs; startMs += chapterDurationMs) {
    chapters.push({
      chapterId: `scheduled-asr-${String(chapters.length + 1).padStart(3, "0")}`,
      startMs,
      endMs: Math.min(durationMs, startMs + chapterDurationMs),
      evidenceMode: "complete-transcript",
      evidenceCoverageRatio: 1,
      summaryKo: "[대사 없음]",
    });
  }
  return chapters;
}

export async function createContextReadyBundle({
  transcriptBundle,
  broadcastContext,
  contextReceipt,
  catalogRevision,
  generatedAt,
}) {
  if (transcriptBundle.state !== "transcript-ready") {
    throw syncError(
      "CONTEXT_INPUT_NOT_TRANSCRIPT_READY",
      "Only a verified transcript-ready bundle can be promoted to context-ready.",
    );
  }
  const verifiedReceipt = await verifyScheduledContextCompositeReceipt(
    contextReceipt,
    transcriptBundle,
  );
  assertIsoDate(generatedAt, "context generatedAt");
  return createChannelPreanalysisBundle({
    channelId: transcriptBundle.channelId,
    videoId: transcriptBundle.videoId,
    title: transcriptBundle.title,
    durationMs: transcriptBundle.durationMs,
    publishedAt: transcriptBundle.publishedAt,
    catalogRevision,
    state: "context-ready",
    captionTrack: transcriptBundle.captionTrack,
    chapters: transcriptBundle.chapters,
    broadcastContext,
    contextProvenance: {
      generatedAt,
      modelRoutingRevision: verifiedReceipt.routingRevision,
      contextReceipt: verifiedReceipt,
      evidenceScope:
        transcriptBundle.provenance.sourceKind === "scheduled-korean-asr"
          ? "scheduled-asr-transcript-only"
          : "youtube-caption-transcript-only",
      localVisualVerificationRequired: true,
    },
    provenance: transcriptBundle.provenance,
  });
}

export function createExpectedScheduledContextReceipt(
  analysisMode = "overview",
) {
  if (analysisMode !== "overview" && analysisMode !== "discovery") {
    throw new TypeError("Scheduled context analysis mode is invalid.");
  }
  return {
    contractVersion: PREANALYSIS_CONTEXT_PROXY_VERSION,
    routingRevision: AI_BROADCAST_CONTEXT_ROUTING_REVISION,
    modelId:
      analysisMode === "discovery"
        ? QWEN_CONTEXT_DISCOVERY_MODEL_ID
        : PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID,
    modelRevision:
      analysisMode === "discovery"
        ? QWEN_CONTEXT_DISCOVERY_MODEL_REVISION
        : PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION,
  };
}

function verifyScheduledContextReceipt(value, analysisMode = "overview") {
  const expected = createExpectedScheduledContextReceipt(analysisMode);
  const expectedModel =
    value?.modelId === expected.modelId &&
    value?.modelRevision === expected.modelRevision;
  const boundedFallbackModel =
    analysisMode === "overview" &&
    value?.modelId === QWEN_CONTEXT_OVERVIEW_FALLBACK_MODEL_ID &&
    value?.modelRevision === QWEN_CONTEXT_OVERVIEW_FALLBACK_MODEL_REVISION;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "contractVersion",
      "routingRevision",
      "modelId",
      "modelRevision",
    ]) ||
    value.contractVersion !== expected.contractVersion ||
    value.routingRevision !== expected.routingRevision ||
    (!expectedModel && !boundedFallbackModel)
  ) {
    throw syncError(
      "CONTEXT_PROXY_RECEIPT_INVALID",
      "The context response does not prove the expected proxy contract, route, and model.",
    );
  }
  return {
    contractVersion: expected.contractVersion,
    routingRevision: expected.routingRevision,
    modelId: value.modelId,
    modelRevision: value.modelRevision,
  };
}

async function verifyScheduledContextCompositeReceipt(
  value,
  transcriptBundle,
) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "contractVersion",
      "routingRevision",
      "modelId",
      "modelRevision",
      "componentReceipts",
    ]) ||
    !Array.isArray(value.componentReceipts)
  ) {
    throw syncError(
      "CONTEXT_PROXY_RECEIPT_INVALID",
      "The context result does not retain its bounded component receipts.",
    );
  }
  const configuredSource = channelPreanalysisSourceByChannelId(
    transcriptBundle.channelId,
  );
  if (configuredSource === null) {
    throw syncError(
      "CONTEXT_PROXY_RECEIPT_INVALID",
      "The context result has an incomplete component receipt set.",
    );
  }
  const overviewRequest = createScheduledContextRequest(transcriptBundle);
  const discoveryRequests = createParallelBroadcastTopicalDiscoverySlices(
    overviewRequest.chapters,
    SCHEDULED_CONTEXT_DISCOVERY_CALLS,
  ).map((slice) =>
    createScheduledContextRequestForChapters(
      transcriptBundle,
      configuredSource,
      slice.chapters,
    ));
  const expectedIdentities = await Promise.all([
    createScheduledContextComponentIdentity(
      configuredSource,
      overviewRequest,
      "overview",
      0,
    ),
    ...discoveryRequests.map((request, index) =>
      createScheduledContextComponentIdentity(
        configuredSource,
        request,
        "discovery",
        index + 1,
      )),
  ]);
  if (value.componentReceipts.length !== expectedIdentities.length) {
    throw syncError(
      "CONTEXT_PROXY_RECEIPT_INVALID",
      "The context result has an incomplete component receipt set.",
    );
  }
  const overviewReceipt = verifyScheduledContextReceipt({
    contractVersion: value.contractVersion,
    routingRevision: value.routingRevision,
    modelId: value.modelId,
    modelRevision: value.modelRevision,
  });
  const operationIds = new Set();
  const payloadDigests = new Set();
  const componentReceipts = [];
  for (const [componentIndex, raw] of value.componentReceipts.entries()) {
    const expectedIdentity = expectedIdentities[componentIndex];
    const analysisMode = expectedIdentity.analysisMode;
    if (
      !isRecord(raw) ||
      !hasExactKeys(raw, [
        "componentIndex",
        "analysisMode",
        "contractVersion",
        "routingRevision",
        "modelId",
        "modelRevision",
        "operationId",
        "payloadDigest",
        "workerAttempt",
        "retryRisk",
      ]) ||
      raw.componentIndex !== componentIndex ||
      raw.analysisMode !== analysisMode ||
      typeof raw.payloadDigest !== "string" ||
      !SHA256_PATTERN.test(raw.payloadDigest) ||
      typeof raw.operationId !== "string" ||
      !Number.isSafeInteger(raw.workerAttempt) ||
      raw.workerAttempt < 1 ||
      raw.workerAttempt > MAX_SCHEDULED_CONTEXT_WORKER_ATTEMPT ||
      (raw.retryRisk !== null &&
        raw.retryRisk !==
          PREANALYSIS_CONTEXT_POSSIBLE_DUPLICATE_PROVIDER_CHARGE)
    ) {
      throw syncError(
        "CONTEXT_PROXY_RECEIPT_INVALID",
        "A context component receipt is malformed or out of order.",
      );
    }
    const verified = verifyScheduledContextReceipt(
      {
        contractVersion: raw.contractVersion,
        routingRevision: raw.routingRevision,
        modelId: raw.modelId,
        modelRevision: raw.modelRevision,
      },
      analysisMode,
    );
    if (
      raw.operationId !== expectedIdentity.operationId ||
      raw.payloadDigest !== expectedIdentity.payloadDigest ||
      raw.contractVersion !== overviewReceipt.contractVersion ||
      raw.routingRevision !== overviewReceipt.routingRevision ||
      (componentIndex === 0 &&
        (raw.modelId !== overviewReceipt.modelId ||
          raw.modelRevision !== overviewReceipt.modelRevision)) ||
      operationIds.has(raw.operationId) ||
      payloadDigests.has(raw.payloadDigest)
    ) {
      throw syncError(
        "CONTEXT_PROXY_RECEIPT_INVALID",
        "A context component receipt is forged, duplicated, or inconsistent.",
      );
    }
    operationIds.add(raw.operationId);
    payloadDigests.add(raw.payloadDigest);
    componentReceipts.push({
      componentIndex,
      analysisMode,
      ...verified,
      operationId: raw.operationId,
      payloadDigest: raw.payloadDigest,
      workerAttempt: raw.workerAttempt,
      retryRisk: raw.retryRisk,
    });
  }
  return { ...overviewReceipt, componentReceipts };
}

export function serializeBundle(bundle) {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

export function artifactForBundle(
  videoId,
  bytes,
  createdAt,
  revision = 1,
  configuredSource = AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
) {
  assertConfiguredSource(configuredSource);
  if (
    !YOUTUBE_VIDEO_ID_PATTERN.test(videoId) ||
    !Number.isSafeInteger(revision) ||
    revision < 1
  ) {
    throw syncError(
      "INVALID_ARTIFACT_IDENTITY",
      "Bundle artifact identity is invalid.",
    );
  }
  const contentDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  return {
    artifactId: `youtube-caption-bundle:${videoId}:v${revision}`,
    videoId,
    kind: "transcript",
    revision,
    storageKey: canonicalBundleStorageKey(
      videoId,
      revision,
      configuredSource,
    ),
    contentDigest,
    byteLength: Buffer.byteLength(bytes),
    createdAt,
  };
}

export function artifactForVisualFingerprint(
  videoId,
  serializedFingerprint,
  createdAt,
  configuredSource = AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
) {
  assertConfiguredSource(configuredSource);
  const fingerprint = parseChannelPreanalysisVisualFingerprint(
    serializedFingerprint,
  );
  if (
    fingerprint.videoId !== videoId ||
    fingerprint.createdAt !== createdAt
  ) {
    throw syncError(
      "FINGERPRINT_ARTIFACT_IDENTITY_INVALID",
      "Visual fingerprint artifact identity is inconsistent.",
    );
  }
  const bytes = Buffer.from(serializedFingerprint, "utf8");
  if (
    bytes.byteLength <= 0 ||
    bytes.byteLength > CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_BYTES
  ) {
    throw syncError(
      "FINGERPRINT_ARTIFACT_TOO_LARGE",
      "Visual fingerprint artifact exceeds its byte limit.",
    );
  }
  return {
    artifactId:
      canonicalChannelPreanalysisVisualFingerprintArtifactId(videoId),
    videoId,
    kind: "fingerprint",
    revision: 1,
    storageKey:
      canonicalChannelPreanalysisVisualFingerprintStorageKey(
        videoId,
        configuredSource.sourceId,
      ),
    contentDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    byteLength: bytes.byteLength,
    createdAt,
  };
}

export function createScheduledContextRequest(transcriptBundle) {
  if (transcriptBundle.state !== "transcript-ready") {
    throw syncError(
      "CONTEXT_INPUT_NOT_TRANSCRIPT_READY",
      "Scheduled context requires a transcript-ready bundle.",
    );
  }
  const configuredSource = channelPreanalysisSourceByChannelId(
    transcriptBundle.channelId,
  );
  if (configuredSource === null) {
    throw syncError(
      "CONTEXT_SOURCE_INVALID",
      "Scheduled context bundle has an unsupported source channel.",
    );
  }
  const chapters = compactBroadcastContextChapters(transcriptBundle.chapters);
  return createScheduledContextRequestForChapters(
    transcriptBundle,
    configuredSource,
    chapters,
  );
}

function createScheduledContextRequestForChapters(
  transcriptBundle,
  configuredSource,
  chapters,
) {
  const castRosterId = candidatePassBCastRosterIdForYouTubeChannelId(
    configuredSource.channelId,
  );
  if (castRosterId === null) {
    throw syncError(
      "CONTEXT_ROSTER_INVALID",
      "Scheduled context source has no configured cast roster.",
    );
  }
  const participantGrounding = createBroadcastParticipantGrounding({
    sourceDurationMs: transcriptBundle.durationMs,
    castRosterId,
    chapters,
  });
  return createBroadcastContextRequest({
    sourceDurationMs: transcriptBundle.durationMs,
    chapters,
    candidates: [],
    castRosterId,
    participantGrounding,
    outputLanguage: "ko",
  });
}

function scheduledContextRetryAfterMs(response) {
  const value = response.headers.get("Retry-After");
  if (value !== null && /^\d{1,3}$/u.test(value)) {
    return Math.min(
      MAX_SCHEDULED_CONTEXT_RETRY_AFTER_MS,
      Math.max(1_000, Number(value) * 1_000),
    );
  }
  return 60_000;
}

function isRetryableScheduledContextCheckpoint(
  response,
  proxyError,
  providerRetryPolicy,
) {
  if (
    providerRetryPolicy === "strict-paid" &&
    response.headers.get(PREANALYSIS_CONTEXT_RETRY_RISK_HEADER) !== null
  ) {
    return false;
  }
  if (response.status === 429) return true;
  if (response.headers.get("Retry-After") === null) return false;
  if (response.status === 409) {
    return proxyError?.code === "OPERATION_IN_PROGRESS";
  }
  if (response.status !== 503) return false;
  if (proxyError?.code === "RETRY_BACKOFF") return true;
  return /^[1-9]\d{0,8}$/u.test(
    response.headers.get(PREANALYSIS_CONTEXT_ATTEMPT_HEADER) ?? "",
  );
}

function waitForScheduledContextRetry(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function scheduledContextRequestBody(configuredSource, request, analysisMode) {
  return JSON.stringify({
    sourceId: configuredSource.sourceId,
    sourceChannelId: configuredSource.channelId,
    sourceDurationMs: request.sourceDurationMs,
    chapters: request.chapters,
    candidates: request.candidates,
    castRosterId: request.castRosterId,
    participantGrounding: request.participantGrounding,
    outputLanguage: request.outputLanguage,
    analysisMode,
  });
}

async function createScheduledContextComponentIdentity(
  configuredSource,
  request,
  analysisMode,
  componentIndex,
) {
  const requestBody = scheduledContextRequestBody(
    configuredSource,
    request,
    analysisMode,
  );
  const payloadDigest =
    `sha256:${createHash("sha256").update(requestBody).digest("hex")}`;
  return {
    componentIndex,
    analysisMode,
    requestBody,
    payloadDigest,
    operationId: await createPreanalysisContextOperationId(
      payloadDigest,
      configuredSource.sourceId,
      analysisMode,
    ),
  };
}

async function requestScheduledBroadcastContextMode(
  configuredSource,
  request,
  analysisMode,
  componentIndex,
  {
    normalizedProxyUrl,
    normalizedAuthorizationToken,
    fetchImplementation,
    requestTimeoutMs,
    waitImplementation,
    providerRetryPolicy,
  },
) {
  const expectedReceipt = createExpectedScheduledContextReceipt(analysisMode);
  const { requestBody, payloadDigest, operationId } =
    await createScheduledContextComponentIdentity(
      configuredSource,
      request,
      analysisMode,
      componentIndex,
    );
  const headers = {
    "Content-Type": "application/json",
    "Origin": PREANALYSIS_CONTEXT_ORIGIN,
    "Authorization": `Bearer ${normalizedAuthorizationToken}`,
    [PREANALYSIS_CONTEXT_CONTRACT_HEADER]:
      PREANALYSIS_CONTEXT_PROXY_VERSION,
    [PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER]:
      AI_BROADCAST_CONTEXT_ROUTING_REVISION,
    [PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID_HEADER]: expectedReceipt.modelId,
    [PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION_HEADER]:
      expectedReceipt.modelRevision,
    [PREANALYSIS_CONTEXT_OPERATION_HEADER]: operationId,
    [PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER]: payloadDigest,
  };
  try {
    for (
      let retryAttempt = 0;
      retryAttempt <= MAX_SCHEDULED_CONTEXT_RETRIES;
      retryAttempt += 1
    ) {
      const outcome = await fetchWithTimeout(
        normalizedProxyUrl,
        {
          method: "POST",
          headers,
          body: requestBody,
        },
        requestTimeoutMs,
        fetchImplementation,
        async (response, signal) => {
        if (!response.ok) {
          const proxyError = await readBoundedProxyError(response, signal);
          if (
            isRetryableScheduledContextCheckpoint(
              response,
              proxyError,
              providerRetryPolicy,
            )
          ) {
            return {
              kind: "retryable",
              retryAfterMs: scheduledContextRetryAfterMs(response),
              errorCode: proxyError?.code ?? "CONTEXT_HTTP_429",
              diagnostic: proxyError?.diagnostic ?? null,
            };
          }
          throw syncError(
            proxyError?.code ?? `CONTEXT_HTTP_${response.status}`,
            `Scheduled ${analysisMode} context request failed with HTTP ${response.status}.` +
              (proxyError?.diagnostic === null || proxyError?.diagnostic === undefined
                ? ""
                : ` Provider diagnostic: ${proxyError.diagnostic}`),
          );
        }
        const contextReceipt = verifyScheduledContextReceipt(
          {
            contractVersion: response.headers.get(
              PREANALYSIS_CONTEXT_CONTRACT_HEADER,
            ),
            routingRevision: response.headers.get(
              PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER,
            ),
            modelId: response.headers.get(
              PREANALYSIS_CONTEXT_MODEL_ID_HEADER,
            ),
            modelRevision: response.headers.get(
              PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER,
            ),
          },
          analysisMode,
        );
        const workerAttemptText = response.headers.get(
          PREANALYSIS_CONTEXT_ATTEMPT_HEADER,
        );
        const workerAttempt = Number(workerAttemptText);
        const retryRisk = response.headers.get(
          PREANALYSIS_CONTEXT_RETRY_RISK_HEADER,
        );
        if (
          !/^[1-9]\d{0,8}$/u.test(workerAttemptText ?? "") ||
          !Number.isSafeInteger(workerAttempt) ||
          workerAttempt > MAX_SCHEDULED_CONTEXT_WORKER_ATTEMPT ||
          (retryRisk !== null &&
            retryRisk !==
              PREANALYSIS_CONTEXT_POSSIBLE_DUPLICATE_PROVIDER_CHARGE)
        ) {
          throw syncError(
            "CONTEXT_PROXY_RECEIPT_INVALID",
            "Scheduled context response has an invalid Worker execution receipt.",
          );
        }
        const responseBytes = await readBoundedResponseBytes(
          response,
          MAX_BROADCAST_CONTEXT_DEEPSEEK_RESPONSE_BYTES,
          "CONTEXT_RESPONSE_TOO_LARGE",
          "Scheduled context response exceeds its byte limit.",
          signal,
        );
        let payload;
        try {
          payload = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(responseBytes),
          );
        } catch (cause) {
          throw syncError(
            "CONTEXT_RESPONSE_INVALID",
            "Scheduled context response is not valid UTF-8 JSON.",
            cause,
          );
        }
        const result = parseCurrentBroadcastContextResult(payload, request);
        if (
          result === null ||
          result.schemaVersion !== BROADCAST_CONTEXT_SCHEMA_VERSION
        ) {
          throw syncError(
            "CONTEXT_RESPONSE_INVALID",
            "Scheduled context response does not satisfy the current result contract.",
          );
        }
          return {
            kind: "success",
            broadcastContext: result,
            contextReceipt,
            workerAttempt,
            retryRisk,
          };
        },
      );
      if (outcome.kind === "success") {
        return {
          broadcastContext: outcome.broadcastContext,
          contextReceipt: {
            componentIndex,
            analysisMode,
            ...outcome.contextReceipt,
            operationId,
            payloadDigest,
            workerAttempt: outcome.workerAttempt,
            retryRisk: outcome.retryRisk,
          },
        };
      }
      if (retryAttempt >= MAX_SCHEDULED_CONTEXT_RETRIES) {
        throw syncError(
          outcome.errorCode,
          `Scheduled ${analysisMode} context request did not complete after bounded checkpoint recovery.` +
            (outcome.diagnostic === null
              ? ""
              : ` Provider diagnostic: ${outcome.diagnostic}`),
        );
      }
      await waitImplementation(outcome.retryAfterMs);
    }
    throw syncError(
      "CONTEXT_HTTP_429",
      `Scheduled ${analysisMode} context request exhausted its retry budget.`,
    );
  } catch (cause) {
    if (cause instanceof ChannelPreanalysisSyncError) throw cause;
    throw syncError(
      "CONTEXT_OUTCOME_UNKNOWN",
      `The scheduled ${analysisMode} context request may have reached the provider.`,
      cause,
    );
  }
}

export async function requestScheduledBroadcastContext(
  transcriptBundle,
  {
    proxyUrl,
    authorizationToken,
    fetchImplementation = globalThis.fetch,
    requestTimeoutMs = CONTEXT_REQUEST_TIMEOUT_MS,
    waitImplementation = waitForScheduledContextRetry,
    providerRetryPolicy = DEFAULT_CONTEXT_PROVIDER_RETRY_POLICY,
  },
) {
  const normalizedProviderRetryPolicy = normalizeContextProviderRetryPolicy(
    providerRetryPolicy,
  );
  const normalizedProxyUrl = normalizeContextProxyUrl(proxyUrl);
  if (normalizedProxyUrl === null) {
    throw syncError(
      "CONTEXT_PROXY_DISABLED",
      "Scheduled context analysis is not enabled.",
    );
  }
  const normalizedAuthorizationToken =
    normalizeContextAuthorizationToken(authorizationToken);
  if (normalizedAuthorizationToken === null) {
    throw syncError(
      "CONTEXT_AUTH_REQUIRED",
      "Scheduled context analysis requires a dedicated bearer token.",
    );
  }
  const overviewRequest = createScheduledContextRequest(transcriptBundle);
  const configuredSource = channelPreanalysisSourceByChannelId(
    transcriptBundle.channelId,
  );
  if (configuredSource === null) {
    throw syncError(
      "CONTEXT_SOURCE_INVALID",
      "Scheduled context bundle has an unsupported source channel.",
    );
  }
  const requestOptions = {
    normalizedProxyUrl,
    normalizedAuthorizationToken,
    fetchImplementation,
    requestTimeoutMs,
    waitImplementation,
    providerRetryPolicy: normalizedProviderRetryPolicy,
  };
  const discoveryRequests = createParallelBroadcastTopicalDiscoverySlices(
    overviewRequest.chapters,
    SCHEDULED_CONTEXT_DISCOVERY_CALLS,
  ).map((slice) =>
    createScheduledContextRequestForChapters(
      transcriptBundle,
      configuredSource,
      slice.chapters,
    ));
  const [overview, ...discoveries] = await Promise.all([
    requestScheduledBroadcastContextMode(
      configuredSource,
      overviewRequest,
      "overview",
      0,
      requestOptions,
    ),
    ...discoveryRequests.map((request, index) =>
      requestScheduledBroadcastContextMode(
        configuredSource,
        request,
        "discovery",
        index + 1,
        requestOptions,
      )),
  ]);
  const mergedPayload = {
    ...overview.broadcastContext,
    discoveredLeadsSupported: true,
    discoveredLeads: mergeBroadcastTopicalDiscoveryLeads([
      overview.broadcastContext.discoveredLeads,
      ...discoveries.map(({ broadcastContext }) =>
        broadcastContext.discoveredLeads),
    ]),
  };
  const broadcastContext = parseCurrentBroadcastContextResult(
    mergedPayload,
    overviewRequest,
  );
  if (broadcastContext === null) {
    throw syncError(
      "CONTEXT_RESPONSE_INVALID",
      "Merged scheduled context results do not satisfy the current result contract.",
    );
  }
  return {
    broadcastContext,
    contextReceipt: {
      contractVersion: overview.contextReceipt.contractVersion,
      routingRevision: overview.contextReceipt.routingRevision,
      modelId: overview.contextReceipt.modelId,
      modelRevision: overview.contextReceipt.modelRevision,
      componentReceipts: [
        overview.contextReceipt,
        ...discoveries.map(({ contextReceipt }) => contextReceipt),
      ],
    },
  };
}

export async function reconcileReadyCatalogArtifacts(
  manifestInput,
  {
    catalogDir,
    nowIso,
    log = console,
  },
) {
  let manifest = normalizeCatalogManifest(manifestInput);
  assertIsoDate(nowIso, "artifact reconciliation time");
  const invalidatedVideoIds = [];

  for (const snapshotVideo of manifest.videos) {
    if (
      !SUCCESSFUL_STATES.has(snapshotVideo.state) &&
      !(snapshotVideo.state === "retryable" && snapshotVideo.artifactIds.length > 0)
    ) {
      continue;
    }
    const currentVideo =
      manifest.videos.find(({ videoId }) => videoId === snapshotVideo.videoId) ??
      snapshotVideo;
    try {
      await verifyReadyVideoArtifactClosure(
        manifest,
        currentVideo,
        catalogDir,
      );
    } catch (error) {
      const relatedArtifacts = manifest.artifacts.filter(
        ({ videoId }) => videoId === currentVideo.videoId,
      );
      const closureErrorCode = errorCodeOf(error);
      if (
        closureErrorCode.startsWith("FINGERPRINT_") &&
        currentVideo.state !== "published"
      ) {
        const fingerprintArtifacts = relatedArtifacts.filter(
          ({ kind }) => kind === "fingerprint",
        );
        for (const artifact of fingerprintArtifacts) {
          await rm(resolveCatalogArtifactPath(catalogDir, artifact), {
            force: true,
          });
        }
        const retry = {
          ...createRetryCheckpoint(
            currentVideo,
            "fingerprint",
            closureErrorCode,
            nowIso,
          ),
          nextAttemptAt: nowIso,
        };
        const fingerprintArtifactIds = new Set(
          fingerprintArtifacts.map(({ artifactId }) => artifactId),
        );
        fingerprintArtifactIds.add(
          canonicalChannelPreanalysisVisualFingerprintArtifactId(
            currentVideo.videoId,
          ),
        );
        manifest = mutateCatalog(
          manifest,
          {
            ...currentVideo,
            state: "retryable",
            revision:
              currentVideo.state === "review-ready"
                ? currentVideo.revision
                : currentVideo.revision + 1,
            artifactIds: currentVideo.artifactIds.filter(
              (artifactId) => !fingerprintArtifactIds.has(artifactId),
            ),
            retry,
          },
          manifest.artifacts.filter(
            (artifact) =>
              artifact.videoId !== currentVideo.videoId ||
              artifact.kind !== "fingerprint",
          ),
          nowIso,
        );
        invalidatedVideoIds.push(currentVideo.videoId);
        log.warn(
          `Isolated invalid visual fingerprint for ${currentVideo.videoId}: ${retry.errorCode}.`,
        );
        continue;
      }
      if (
        closureErrorCode.startsWith("REVIEW_") &&
        currentVideo.state === "review-ready"
      ) {
        const reviewArtifacts = relatedArtifacts.filter(
          ({ kind }) => kind === "review",
        );
        for (const artifact of reviewArtifacts) {
          await rm(resolveCatalogArtifactPath(catalogDir, artifact), {
            force: true,
          });
        }
        const retry = {
          ...createRetryCheckpoint(
            currentVideo,
            "review",
            closureErrorCode,
            nowIso,
          ),
          nextAttemptAt: nowIso,
        };
        const reviewArtifactIds = new Set(
          reviewArtifacts.map(({ artifactId }) => artifactId),
        );
        manifest = mutateCatalog(
          manifest,
          {
            ...currentVideo,
            state: "retryable",
            revision: currentVideo.revision + 1,
            artifactIds: currentVideo.artifactIds.filter(
              (artifactId) => !reviewArtifactIds.has(artifactId),
            ),
            retry,
          },
          manifest.artifacts.filter(
            (artifact) =>
              artifact.videoId !== currentVideo.videoId ||
              artifact.kind !== "review",
          ),
          nowIso,
        );
        invalidatedVideoIds.push(currentVideo.videoId);
        log.warn(
          `Isolated invalid review artifact for ${currentVideo.videoId}: ${retry.errorCode}.`,
        );
        continue;
      }
      for (const artifact of relatedArtifacts) {
        const artifactPath = resolveCatalogArtifactPath(catalogDir, artifact);
        await rm(artifactPath, { force: true });
      }
      const retry = {
        ...createRetryCheckpoint(
          currentVideo,
          "transcript",
          closureErrorCode.startsWith("ARTIFACT_") ||
            closureErrorCode.startsWith("TRANSCRIPT_")
            ? closureErrorCode
            : `ARTIFACT_${closureErrorCode}`,
          nowIso,
        ),
        // Closure repair is selected in this same run. A later processing
        // failure replaces this with the normal bounded backoff checkpoint.
        nextAttemptAt: nowIso,
      };
      manifest = mutateCatalog(
        manifest,
        {
          ...currentVideo,
          state: "retryable",
          revision: currentVideo.revision + 1,
          artifactIds: [],
          retry,
        },
        manifest.artifacts.filter(
          ({ videoId }) => videoId !== currentVideo.videoId,
        ),
        nowIso,
      );
      invalidatedVideoIds.push(currentVideo.videoId);
      log.warn(
        `Invalidated incomplete artifact closure for ${currentVideo.videoId}: ${retry.errorCode}.`,
      );
    }
  }

  return {
    manifest,
    changed: invalidatedVideoIds.length > 0,
    invalidatedVideoIds,
  };
}

async function verifyReadyVideoArtifactClosure(
  manifest,
  video,
  catalogDir,
) {
  const configuredSource = channelPreanalysisSourceForManifest(manifest);
  const artifactById = new Map(
    manifest.artifacts.map((artifact) => [artifact.artifactId, artifact]),
  );
  const referencedArtifacts = video.artifactIds.map((artifactId) => {
    const artifact = artifactById.get(artifactId);
    if (artifact === undefined || artifact.videoId !== video.videoId) {
      if (
        artifactId ===
        canonicalChannelPreanalysisVisualFingerprintArtifactId(video.videoId)
      ) {
        throw syncError(
          "FINGERPRINT_ARTIFACT_REFERENCE_INVALID",
          "The ready video references an absent visual fingerprint artifact.",
        );
      }
      throw syncError(
        "ARTIFACT_REFERENCE_INVALID",
        "A ready video references an absent or foreign artifact.",
      );
    }
    return artifact;
  });
  const transcriptArtifacts = referencedArtifacts.filter(
    ({ kind }) => kind === "transcript",
  );
  const fingerprintArtifacts = referencedArtifacts.filter(
    ({ kind }) => kind === "fingerprint",
  );
  const reviewArtifacts = referencedArtifacts.filter(
    ({ kind }) => kind === "review",
  );
  const reviewArtifactRequired =
    video.state === "review-ready" ||
    (video.state === "retryable" &&
      video.retry?.stage === "fingerprint" &&
      video.retry.lastSuccessfulState === "review-ready");
  if (transcriptArtifacts.length !== 1) {
    throw syncError(
      "TRANSCRIPT_ARTIFACT_COUNT_INVALID",
      "A ready video requires exactly one transcript artifact.",
    );
  }
  if (
    fingerprintArtifacts.length > 1 ||
    (reviewArtifactRequired && fingerprintArtifacts.length !== 1)
  ) {
    throw syncError(
      "FINGERPRINT_ARTIFACT_COUNT_INVALID",
      "A review-ready video requires exactly one visual fingerprint artifact.",
    );
  }
  if (reviewArtifacts.length !== (reviewArtifactRequired ? 1 : 0)) {
    throw syncError(
      "REVIEW_ARTIFACT_COUNT_INVALID",
      "A review-ready video requires exactly one review artifact.",
    );
  }

  const bytesByArtifactId = new Map();
  for (const artifact of referencedArtifacts) {
    const artifactPath = resolveCatalogArtifactPath(catalogDir, artifact);
    const artifactErrorPrefix =
      artifact.kind === "fingerprint"
        ? "FINGERPRINT_ARTIFACT"
        : "ARTIFACT";
    let file;
    try {
      file = await stat(artifactPath);
    } catch (cause) {
      throw syncError(
        `${artifactErrorPrefix}_MISSING`,
        "A ready artifact file is unavailable.",
        cause,
      );
    }
    if (!file.isFile()) {
      throw syncError(
        `${artifactErrorPrefix}_NOT_FILE`,
        "A ready artifact path is not a regular file.",
      );
    }
    if (
      file.size !== artifact.byteLength ||
      file.size <= 0 ||
      file.size >
        (artifact.kind === "fingerprint"
          ? CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_BYTES
          : artifact.kind === "review"
            ? CHANNEL_PREANALYSIS_REVIEW_BUNDLE_MAX_BYTES
          : CHANNEL_PREANALYSIS_BUNDLE_MAX_BYTES)
    ) {
      throw syncError(
        `${artifactErrorPrefix}_BYTE_LENGTH_MISMATCH`,
        "A ready artifact byte length does not match its manifest.",
      );
    }
    let bytes;
    try {
      bytes = await readFile(artifactPath);
    } catch (cause) {
      throw syncError(
        `${artifactErrorPrefix}_READ_FAILED`,
        "A ready artifact could not be read.",
        cause,
      );
    }
    if (bytes.byteLength !== artifact.byteLength) {
      throw syncError(
        `${artifactErrorPrefix}_BYTE_LENGTH_MISMATCH`,
        "A ready artifact changed while it was being verified.",
      );
    }
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (digest !== artifact.contentDigest) {
      throw syncError(
        `${artifactErrorPrefix}_DIGEST_MISMATCH`,
        "A ready artifact digest does not match its manifest.",
      );
    }
    bytesByArtifactId.set(artifact.artifactId, bytes);
  }

  const transcriptArtifact = transcriptArtifacts[0];
  const expectedArtifactId =
    `youtube-caption-bundle:${video.videoId}:v${transcriptArtifact.revision}`;
  if (
    transcriptArtifact.artifactId !== expectedArtifactId ||
    !isCanonicalBundleStorageKey(
      video.videoId,
      transcriptArtifact.revision,
      transcriptArtifact.storageKey,
      configuredSource,
    )
  ) {
    throw syncError(
      "TRANSCRIPT_ARTIFACT_IDENTITY_INVALID",
      "The transcript artifact identity is not canonical.",
    );
  }
  const transcriptBytes = bytesByArtifactId.get(transcriptArtifact.artifactId);
  if (transcriptBytes === undefined) {
    throw syncError(
      "TRANSCRIPT_ARTIFACT_MISSING",
      "The transcript artifact bytes are unavailable.",
    );
  }
  let transcriptText;
  try {
    transcriptText = new TextDecoder("utf-8", { fatal: true }).decode(
      transcriptBytes,
    );
  } catch (cause) {
    throw syncError(
      "TRANSCRIPT_ARTIFACT_ENCODING_INVALID",
      "The transcript artifact is not UTF-8.",
      cause,
    );
  }
  const bundle = parseChannelPreanalysisBundle(transcriptText);
  await verifyChannelPreanalysisTranscriptDigest(bundle);
  const durableRetryState = video.state === "retryable"
    ? video.retry?.lastSuccessfulState ?? null
    : null;
  const expectedBundleState =
    video.state === "review-ready" || durableRetryState === "review-ready"
      ? "context-ready"
      : durableRetryState === "transcript-ready" ||
          durableRetryState === "context-ready"
        ? durableRetryState
        : video.state;
  assertChannelPreanalysisBundleMatchesCatalogVideo(
    bundle,
    expectedBundleState === video.state
      ? video
      : { ...video, state: expectedBundleState },
    manifest.revision,
  );
  if (transcriptArtifact.createdAt !== bundleArtifactCreatedAt(bundle)) {
    throw syncError(
      "TRANSCRIPT_ARTIFACT_PROVENANCE_INVALID",
      "Transcript artifact provenance does not match its manifest.",
    );
  }
  const fingerprintArtifact = fingerprintArtifacts[0];
  if (fingerprintArtifact !== undefined) {
    if (
      fingerprintArtifact.artifactId !==
        canonicalChannelPreanalysisVisualFingerprintArtifactId(
          video.videoId,
        ) ||
      fingerprintArtifact.revision !== 1 ||
      fingerprintArtifact.storageKey !==
        canonicalChannelPreanalysisVisualFingerprintStorageKey(
          video.videoId,
          configuredSource.sourceId,
        )
    ) {
      throw syncError(
        "FINGERPRINT_ARTIFACT_IDENTITY_INVALID",
        "Visual fingerprint artifact identity is not canonical.",
      );
    }
    const fingerprintBytes = bytesByArtifactId.get(
      fingerprintArtifact.artifactId,
    );
    if (fingerprintBytes === undefined) {
      throw syncError(
        "FINGERPRINT_ARTIFACT_MISSING",
        "Visual fingerprint artifact bytes are unavailable.",
      );
    }
    let fingerprintText;
    try {
      fingerprintText = new TextDecoder("utf-8", { fatal: true }).decode(
        fingerprintBytes,
      );
    } catch (cause) {
      throw syncError(
        "FINGERPRINT_ARTIFACT_ENCODING_INVALID",
        "Visual fingerprint artifact is not UTF-8.",
        cause,
      );
    }
    let fingerprint;
    try {
      fingerprint =
        parseChannelPreanalysisVisualFingerprint(fingerprintText);
    } catch (cause) {
      throw syncError(
        "FINGERPRINT_ARTIFACT_SCHEMA_INVALID",
        "Visual fingerprint artifact failed strict validation.",
        cause,
      );
    }
    if (
      fingerprint.videoId !== video.videoId ||
      fingerprint.sourceDurationMs !== video.durationMs ||
      fingerprint.createdAt !== fingerprintArtifact.createdAt
    ) {
      throw syncError(
        "FINGERPRINT_ARTIFACT_PROVENANCE_INVALID",
        "Visual fingerprint artifact does not match its catalog video.",
      );
    }
  }
  const reviewArtifact = reviewArtifacts[0];
  if (reviewArtifact !== undefined) {
    const reviewBytes = bytesByArtifactId.get(reviewArtifact.artifactId);
    if (reviewBytes === undefined) {
      throw syncError(
        "REVIEW_ARTIFACT_MISSING",
        "The review artifact bytes are unavailable.",
      );
    }
    let review;
    try {
      review = parseChannelPreanalysisReviewBundle(
        new TextDecoder("utf-8", { fatal: true }).decode(reviewBytes),
      );
      await verifyChannelPreanalysisReviewBundleIntegrity(review);
    } catch (cause) {
      throw syncError(
        "REVIEW_ARTIFACT_SCHEMA_INVALID",
        "The review artifact failed strict validation.",
        cause,
      );
    }
    if (
      review.artifactId !== reviewArtifact.artifactId ||
      review.artifactRevision !== reviewArtifact.revision ||
      review.createdAt !== reviewArtifact.createdAt ||
      review.source.sourceId !== configuredSource.sourceId ||
      review.source.channelId !== video.channelId ||
      review.source.videoId !== video.videoId ||
      review.sourceDurationMs !== video.durationMs ||
      review.transcriptDigest !== bundle.transcriptDigest ||
      fingerprintArtifact === undefined ||
      review.visualCoverage.sourceFingerprintArtifactId !==
        fingerprintArtifact.artifactId ||
      review.visualCoverage.sourceFingerprintDigest !==
        fingerprintArtifact.contentDigest ||
      bundle.broadcastContext === null ||
      JSON.stringify(review.broadcastContext) !==
        JSON.stringify(bundle.broadcastContext)
    ) {
      throw syncError(
        "REVIEW_ARTIFACT_PROVENANCE_INVALID",
        "The review artifact does not match its catalog context.",
      );
    }
  }
}

function resolveCatalogArtifactPath(catalogDir, artifact) {
  const configuredSource = configuredSourceForStorageKey(artifact.storageKey);
  const prefix = channelPreanalysisStoragePrefix(configuredSource);
  if (!artifact.storageKey.startsWith(prefix)) {
    throw syncError(
      "ARTIFACT_STORAGE_KEY_INVALID",
      "Artifact storage key is outside the catalog namespace.",
    );
  }
  const root = resolve(catalogDir);
  const target = resolve(root, artifact.storageKey.slice(prefix.length));
  if (target === root || !target.startsWith(`${root}${sep}`)) {
    throw syncError(
      "ARTIFACT_STORAGE_KEY_INVALID",
      "Artifact storage key escapes the catalog directory.",
    );
  }
  return target;
}

function bundlePathForRevision(
  catalogDir,
  videoId,
  revision,
  configuredSource = AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
) {
  return resolveCatalogArtifactPath(catalogDir, {
    storageKey: canonicalBundleStorageKey(
      videoId,
      revision,
      configuredSource,
    ),
  });
}

export async function synchronizeChannelPreanalysisCatalog(
  options,
  dependencies = {},
) {
  const configuredSource = assertConfiguredSource(
    options.configuredSource ?? AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
  );
  const now = dependencies.now ?? (() => new Date());
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const commandRunner = dependencies.commandRunner ?? runBoundedCommand;
  const visualFingerprintProvider =
    dependencies.visualFingerprintProvider ?? null;
  const scheduledAsrProvider =
    dependencies.scheduledAsrProvider ?? prepareScheduledAsrCaptionTrack;
  if (
    visualFingerprintProvider !== null &&
    typeof visualFingerprintProvider !== "function"
  ) {
    throw syncError(
      "INVALID_ARGUMENT",
      "Visual fingerprint provider must be a function.",
    );
  }
  if (typeof scheduledAsrProvider !== "function") {
    throw syncError(
      "INVALID_ARGUMENT",
      "Scheduled ASR provider must be a function.",
    );
  }
  const log = dependencies.log ?? console;
  const nowIso = () => now().toISOString();
  const contextProxyUrl = normalizeContextProxyUrl(
    options.contextProxyUrl ?? null,
  );
  const contextAuthorizationToken =
    normalizeContextAuthorizationToken(
      options.contextAuthorizationToken ?? null,
    );
  assertContextConfigurationPair(
    contextProxyUrl,
    contextAuthorizationToken,
  );
  const contextProviderRetryPolicy = normalizeContextProviderRetryPolicy(
    options.contextProviderRetryPolicy ??
      DEFAULT_CONTEXT_PROVIDER_RETRY_POLICY,
  );
  const contextEnabled =
    contextProxyUrl !== null && contextAuthorizationToken !== null;

  if (dependencies.skipYtDlpVerification !== true) {
    await verifyPinnedYtDlp(options.ytDlpPath, commandRunner);
  }
  await mkdir(join(options.catalogDir, "videos"), { recursive: true });

  const catalogPath = join(options.catalogDir, "catalog.json");
  const existingText = await readTextIfPresent(catalogPath);
  if (
    existingText !== null &&
    Buffer.byteLength(existingText) >
      CHANNEL_PREANALYSIS_MANIFEST_MAX_BYTES
  ) {
    throw syncError(
      "CATALOG_TOO_LARGE",
      "Existing catalog manifest exceeds the browser-readable byte limit.",
    );
  }
  let manifest =
    existingText === null
      ? createEmptyCatalog(nowIso(), configuredSource)
      : normalizeCatalogManifest(parseJson(existingText, "catalog"));
  if (manifest.channelId !== configuredSource.channelId) {
    throw syncError(
      "WRONG_CHANNEL",
      "Existing catalog does not belong to the configured source.",
    );
  }
  if (existingText === null) {
    // Establish a valid empty checkpoint before network discovery. A first-run
    // feed outage can then be reported as partial without making the five-
    // namespace publication artifact structurally incomplete.
    await writeJsonAtomic(catalogPath, manifest);
  }
  if (existingText !== null) {
    const closure = await reconcileReadyCatalogArtifacts(manifest, {
      catalogDir: options.catalogDir,
      nowIso: nowIso(),
      log,
    });
    manifest = closure.manifest;
    if (closure.changed) {
      await writeJsonAtomic(catalogPath, manifest);
    }
  }
  let merged = { manifest, changed: false };
  if (options.skipDiscovery !== true) {
    const feedText = await fetchOfficialFeed(fetchImpl, configuredSource);
    const feed = parseYouTubeChannelAtomFeed(feedText, configuredSource);
    merged = mergeFeedIntoCatalog(manifest, feed, nowIso());
    manifest = merged.manifest;
  } else if (existingText === null) {
    throw syncError(
      "CATALOG_MISSING",
      "A discovery-free pass requires an existing source catalog.",
    );
  }
  if (merged.changed) {
    await writeJsonAtomic(catalogPath, manifest);
  }

  const selected =
    options.discoveryOnly === true
      ? []
      : selectDueCatalogVideos(manifest, {
          nowIso: nowIso(),
          maxVideos: options.maxVideos,
          videoId: options.videoId,
          includeTranscriptReady: contextEnabled,
          includePermanentCaptionRetries:
            options.includePermanentCaptionRetries !== false,
          recoverCaptionRetriesWithAsr: contextEnabled,
        });
  const outcomes = [];

  for (const selectedVideo of selected) {
    try {
      const result = await processCatalogVideo({
        manifest,
        selectedVideo,
        catalogPath,
        catalogDir: options.catalogDir,
        ytDlpPath: options.ytDlpPath,
        commandRunner,
        visualFingerprintProvider,
        scheduledAsrProvider,
        contextProxyUrl,
        contextAuthorizationToken,
        contextProviderRetryPolicy,
        fetchImplementation: fetchImpl,
        nowIso,
        configuredSource,
      });
      manifest = result.manifest;
      outcomes.push({ videoId: selectedVideo.videoId, state: result.state });
      log.info(`Prepared ${result.state} bundle for ${selectedVideo.videoId}.`);
    } catch (error) {
      const latestCatalogText = await readTextIfPresent(catalogPath);
      if (latestCatalogText !== null) {
        manifest = normalizeCatalogManifest(
          parseJson(latestCatalogText, "catalog checkpoint"),
        );
      }
      const current =
        manifest.videos.find(({ videoId }) => videoId === selectedVideo.videoId) ??
        selectedVideo;
      const stage = retryStageForVideo(
        current,
        contextEnabled,
        errorCodeOf(error),
      );
      const retry = createRetryCheckpoint(
        current,
        stage,
        errorCodeOf(error),
        nowIso(),
      );
      manifest = mutateCatalog(
        manifest,
        {
          ...current,
          state: "retryable",
          revision:
            current.state === "review-ready" ||
            (current.state === "retryable" &&
              current.retry?.stage === "fingerprint" &&
              current.retry.lastSuccessfulState === "review-ready")
              ? current.revision
              : current.revision + 1,
          retry,
        },
        manifest.artifacts,
        nowIso(),
      );
      await writeJsonAtomic(catalogPath, manifest);
      outcomes.push({
        videoId: selectedVideo.videoId,
        state: "retryable",
        errorCode: retry.errorCode,
      });
      // Without the message an operator sees only the code, which cannot
      // distinguish a refused request from a broken one. The captured
      // diagnostic is already bounded; redact it before it reaches a log.
      const rawMessage = error instanceof Error ? error.message : String(error);
      const diagnostic = redactDiagnostic(rawMessage);
      // Classify the raw message: redaction is a lossy transform meant for
      // display, so matching against it would couple the classifier to it.
      const failureKind =
        stage === "transcript" ? ` (${classifyYtDlpFailure(rawMessage)})` : "";
      log.warn(
        `Deferred ${selectedVideo.videoId} at ${stage}: ${retry.errorCode}${failureKind}; next attempt ${retry.nextAttemptAt}.` +
          (diagnostic === "" ? "" : ` Diagnostic: ${diagnostic}`),
      );
    }
  }

  return {
    manifest,
    selectedVideoIds: selected.map(({ videoId }) => videoId),
    selectedVideos: selected,
    outcomes,
  };
}

export async function synchronizeAmorettoCatalog(options, dependencies = {}) {
  return synchronizeChannelPreanalysisCatalog(
    {
      ...options,
      configuredSource: AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
    },
    dependencies,
  );
}

/**
 * Reconciles every configured source while sharing one global two-video
 * budget. The rotating source order prevents a busy channel from permanently
 * starving quieter channels, and a second round uses any capacity left by
 * sources that had no due work.
 */
export async function synchronizeConfiguredChannelCatalogs(
  options,
  dependencies = {},
) {
  const now = dependencies.now ?? (() => new Date());
  const commandRunner = dependencies.commandRunner ?? runBoundedCommand;
  const sourceSynchronizer =
    dependencies.sourceSynchronizer ?? synchronizeChannelPreanalysisCatalog;
  const snapshotVerifier =
    dependencies.snapshotVerifier ?? verifyPersistedChannelCatalogSnapshot;
  if (typeof sourceSynchronizer !== "function") {
    throw syncError(
      "INVALID_ARGUMENT",
      "Source synchronizer must be a function.",
    );
  }
  if (typeof snapshotVerifier !== "function") {
    throw syncError(
      "INVALID_ARGUMENT",
      "Catalog snapshot verifier must be a function.",
    );
  }
  await verifyPinnedYtDlp(options.ytDlpPath, commandRunner);

  const runStartedAt = now().toISOString();
  const orderedSources = rotateConfiguredSourcesForFairness(runStartedAt);
  const perSourceResults = new Map();
  const sourceErrors = [];
  const healthySourceIds = new Set();
  let remaining = Math.min(options.maxVideos, MAX_VIDEOS_PER_RUN);
  let usedPermanentCaptionRetry = false;

  const runSource = async (
    configuredSource,
    pass,
    includePermanentCaptionRetries,
  ) => {
    const result = await sourceSynchronizer(
      {
        ...options,
        configuredSource,
        catalogDir: join(options.catalogDir, configuredSource.sourceId),
        maxVideos: 1,
        videoId: null,
        discoveryOnly: remaining === 0,
        skipDiscovery: pass !== 1,
        includePermanentCaptionRetries,
      },
      {
        ...dependencies,
        now,
        commandRunner,
        skipYtDlpVerification: true,
      },
    );
    healthySourceIds.add(configuredSource.sourceId);
    if (result.selectedVideoIds.length > 0) {
      remaining -= result.selectedVideoIds.length;
      if (
        result.selectedVideos.some((video) =>
          PERMANENT_CAPTION_RETRY_CODES.has(video.retry?.errorCode),
        )
      ) {
        usedPermanentCaptionRetry = true;
      }
    }
    const prior = perSourceResults.get(configuredSource.sourceId);
    perSourceResults.set(configuredSource.sourceId, {
      sourceId: configuredSource.sourceId,
      manifest: result.manifest,
      selectedVideoIds: [
        ...(prior?.selectedVideoIds ?? []),
        ...result.selectedVideoIds,
      ],
      outcomes: [...(prior?.outcomes ?? []), ...result.outcomes],
    });
  };

  for (const configuredSource of orderedSources) {
    try {
      await runSource(configuredSource, 1, false);
    } catch (error) {
      sourceErrors.push({
        sourceId: configuredSource.sourceId,
        errorCode: errorCodeOf(error),
        message: redactDiagnostic(
          error instanceof Error ? error.message : String(error),
        ),
      });
    }
  }

  if (remaining > 0) {
    for (const configuredSource of orderedSources) {
      if (remaining === 0) break;
      if (!healthySourceIds.has(configuredSource.sourceId)) continue;
      try {
        await runSource(configuredSource, 2, false);
      } catch (error) {
        sourceErrors.push({
          sourceId: configuredSource.sourceId,
          errorCode: errorCodeOf(error),
          message: redactDiagnostic(
            error instanceof Error ? error.message : String(error),
          ),
        });
      }
    }
  }

  if (remaining > 0 && !usedPermanentCaptionRetry) {
    for (const configuredSource of orderedSources) {
      if (remaining === 0 || usedPermanentCaptionRetry) break;
      if (!healthySourceIds.has(configuredSource.sourceId)) continue;
      try {
        await runSource(configuredSource, 3, true);
      } catch (error) {
        sourceErrors.push({
          sourceId: configuredSource.sourceId,
          errorCode: errorCodeOf(error),
          message: redactDiagnostic(
            error instanceof Error ? error.message : String(error),
          ),
        });
      }
    }
  }

  for (const configuredSource of CHANNEL_PREANALYSIS_SOURCES) {
    const catalogDir = join(options.catalogDir, configuredSource.sourceId);
    try {
      const manifest = await snapshotVerifier(
        catalogDir,
        configuredSource,
      );
      const prior = perSourceResults.get(configuredSource.sourceId);
      perSourceResults.set(configuredSource.sourceId, {
        sourceId: configuredSource.sourceId,
        manifest,
        selectedVideoIds: prior?.selectedVideoIds ?? [],
        outcomes: prior?.outcomes ?? [],
      });
    } catch (error) {
      sourceErrors.push({
        sourceId: configuredSource.sourceId,
        errorCode: "CATALOG_SNAPSHOT_INVALID",
        message: redactDiagnostic(
          error instanceof Error ? error.message : String(error),
        ),
      });
    }
  }

  if (healthySourceIds.size === 0) {
    throw syncError(
      "ALL_SOURCE_RECONCILIATION_FAILED",
      "Every configured YouTube source failed reconciliation.",
    );
  }
  return {
    runStartedAt,
    globalLimit: Math.min(options.maxVideos, MAX_VIDEOS_PER_RUN),
    processedVideoCount:
      Math.min(options.maxVideos, MAX_VIDEOS_PER_RUN) - remaining,
    sources: CHANNEL_PREANALYSIS_SOURCES.map(
      ({ sourceId }) =>
        perSourceResults.get(sourceId) ?? {
          sourceId,
          manifest: null,
          selectedVideoIds: [],
          outcomes: [],
        },
    ),
    sourceErrors: deduplicateSourceErrors(sourceErrors),
  };
}

export async function verifyPersistedChannelCatalogSnapshot(
  catalogDir,
  configuredSource,
) {
  assertConfiguredSource(configuredSource);
  const catalogPath = join(catalogDir, "catalog.json");
  const text = await readTextIfPresent(catalogPath);
  if (text === null) {
    throw syncError(
      "CATALOG_MISSING",
      `Catalog snapshot is missing for ${configuredSource.sourceId}.`,
    );
  }
  if (Buffer.byteLength(text) > CHANNEL_PREANALYSIS_MANIFEST_MAX_BYTES) {
    throw syncError(
      "CATALOG_TOO_LARGE",
      `Catalog snapshot is too large for ${configuredSource.sourceId}.`,
    );
  }
  const manifest = normalizeCatalogManifest(
    parseJson(text, `${configuredSource.sourceId} catalog`),
  );
  if (manifest.channelId !== configuredSource.channelId) {
    throw syncError(
      "WRONG_CHANNEL",
      `Catalog snapshot belongs to the wrong source for ${configuredSource.sourceId}.`,
    );
  }
  for (const video of manifest.videos) {
    if (video.artifactIds.length === 0) continue;
    await verifyReadyVideoArtifactClosure(manifest, video, catalogDir);
  }
  return manifest;
}

function deduplicateSourceErrors(sourceErrors) {
  const seen = new Set();
  return sourceErrors.filter(({ sourceId, errorCode }) => {
    const key = `${sourceId}:${errorCode}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function rotateConfiguredSourcesForFairness(nowIso) {
  const nowMs = Date.parse(assertIsoDate(nowIso, "scheduler time"));
  const rotation =
    Math.floor(nowMs / (3 * 60 * 60_000)) % CHANNEL_PREANALYSIS_SOURCES.length;
  return [
    ...CHANNEL_PREANALYSIS_SOURCES.slice(rotation),
    ...CHANNEL_PREANALYSIS_SOURCES.slice(0, rotation),
  ];
}

function hasRetryableOutcome(outcomes) {
  return outcomes.some((outcome) => outcome?.state === "retryable");
}

export function createChannelPreanalysisRunReport(result, completedAt) {
  assertIsoDate(completedAt, "run report completedAt");
  const hasRetryableWork = result.sources.some(({ outcomes }) =>
    hasRetryableOutcome(outcomes)
  );
  return {
    schemaVersion: 1,
    mode: "all",
    status:
      result.sourceErrors.length === 0 && !hasRetryableWork
        ? "complete"
        : "partial",
    runStartedAt: result.runStartedAt,
    completedAt,
    globalLimit: result.globalLimit,
    processedVideoCount: result.processedVideoCount,
    sources: result.sources.map(
      ({ sourceId, manifest, selectedVideoIds, outcomes }) => ({
        sourceId,
        catalogRevision: manifest?.revision ?? null,
        selectedVideoIds,
        outcomes,
      }),
    ),
    sourceErrors: result.sourceErrors,
  };
}

export function createSingleChannelPreanalysisRunReport(
  result,
  configuredSource,
  globalLimit,
  runStartedAt,
  completedAt,
) {
  assertConfiguredSource(configuredSource);
  if (
    !Number.isSafeInteger(globalLimit) ||
    globalLimit < 1 ||
    globalLimit > MAX_VIDEOS_PER_RUN
  ) {
    throw syncError("INVALID_ARGUMENT", "Single-source report limit is invalid.");
  }
  assertIsoDate(runStartedAt, "single-source runStartedAt");
  assertIsoDate(completedAt, "single-source completedAt");
  return {
    schemaVersion: 1,
    mode: "single",
    status: hasRetryableOutcome(result.outcomes) ? "partial" : "complete",
    runStartedAt,
    completedAt,
    globalLimit,
    processedVideoCount: result.selectedVideoIds.length,
    sources: [
      {
        sourceId: configuredSource.sourceId,
        catalogRevision: result.manifest.revision,
        selectedVideoIds: result.selectedVideoIds,
        outcomes: result.outcomes,
      },
    ],
    sourceErrors: [],
  };
}

async function processCatalogVideo({
  manifest,
  selectedVideo,
  catalogPath,
  catalogDir,
  ytDlpPath,
  commandRunner,
  visualFingerprintProvider,
  scheduledAsrProvider,
  contextProxyUrl,
  contextAuthorizationToken,
  contextProviderRetryPolicy,
  fetchImplementation,
  nowIso,
  configuredSource,
}) {
  let video =
    manifest.videos.find(({ videoId }) => videoId === selectedVideo.videoId) ??
    selectedVideo;
  const activeTranscriptArtifact = manifest.artifacts.find(
    (artifact) =>
      artifact.videoId === video.videoId &&
      artifact.kind === "transcript" &&
      video.artifactIds.includes(artifact.artifactId),
  );
  let bundlePath =
    activeTranscriptArtifact === undefined
      ? bundlePathForRevision(
          catalogDir,
          video.videoId,
          1,
          configuredSource,
        )
      : resolveCatalogArtifactPath(catalogDir, activeTranscriptArtifact);
  let transcriptBundle = null;
  let transcriptBundleText = null;
  let fingerprintMetadataValue = null;
  const existingBundleText = await readTextIfPresent(bundlePath);
  if (existingBundleText !== null) {
    try {
      const recoveredBundle = parseChannelPreanalysisBundle(existingBundleText);
      await verifyChannelPreanalysisTranscriptDigest(recoveredBundle);
      if (
        recoveredBundle.videoId !== video.videoId ||
        recoveredBundle.title !== video.title ||
        recoveredBundle.durationMs !== video.durationMs ||
        recoveredBundle.publishedAt !== video.publishedAt
      ) {
        throw syncError(
          "TRANSCRIPT_ARTIFACT_IDENTITY_INVALID",
          "The recovered bundle does not match its catalog video.",
        );
      }

      if (
        recoveredBundle.state === "context-ready" &&
        ["context-ready", "review-ready"].includes(video.state) &&
        hasVisualFingerprintArtifact(manifest, video.videoId)
      ) {
        return { manifest, state: video.state };
      }
      if (
        (recoveredBundle.state === "transcript-ready" &&
          video.state === "transcript-ready") ||
        (recoveredBundle.state === "context-ready" &&
          ["context-ready", "review-ready"].includes(video.state))
      ) {
        transcriptBundle = recoveredBundle;
        transcriptBundleText = existingBundleText;
      } else if (
        (recoveredBundle.state === "transcript-ready" &&
          isContextRetryCheckpoint(video)) ||
        (recoveredBundle.state === "context-ready" &&
          isReviewRetryCheckpoint(video)) ||
        isFingerprintRetryCheckpoint(video, recoveredBundle.state)
      ) {
        verifyRetryableTranscriptCheckpoint(
          manifest,
          video,
          existingBundleText,
          recoveredBundle,
        );
        transcriptBundle = recoveredBundle;
        transcriptBundleText = existingBundleText;
      } else {
        const artifactRevision = recoveredBundle.state === "transcript-ready"
          ? 1
          : nextRecoveredArtifactRevision(manifest, video, recoveredBundle);
        const artifact = artifactForBundle(
          video.videoId,
          existingBundleText,
          bundleArtifactCreatedAt(recoveredBundle),
          artifactRevision,
          configuredSource,
        );
        const attachedVideo = {
          ...video,
          title: recoveredBundle.title,
          normalizedTitle: normalizeChannelVideoTitle(recoveredBundle.title),
          durationMs: recoveredBundle.durationMs,
          publishedAt: recoveredBundle.publishedAt,
          state: recoveredBundle.state,
          revision: video.revision + 1,
          artifactIds: artifactIdsForTranscript(
            manifest,
            video.videoId,
            artifact.artifactId,
          ),
          retry: null,
        };
        const recoveredManifest = mutateCatalog(
          manifest,
          attachedVideo,
          replaceVideoArtifactKind(
            manifest.artifacts,
            video.videoId,
            "transcript",
            artifact,
          ),
          nowIso(),
        );
        assertChannelPreanalysisBundleMatchesCatalogVideo(
          recoveredBundle,
          attachedVideo,
          recoveredManifest.revision,
        );
        await verifyReadyVideoArtifactClosure(
          recoveredManifest,
          attachedVideo,
          catalogDir,
        );
        await writeJsonAtomic(catalogPath, recoveredManifest);
        manifest = recoveredManifest;
        video = attachedVideo;
        if (
          recoveredBundle.state === "context-ready" &&
          hasVisualFingerprintArtifact(
            recoveredManifest,
            attachedVideo.videoId,
          )
        ) {
          return { manifest, state: "context-ready" };
        }
        transcriptBundle = recoveredBundle;
        transcriptBundleText = existingBundleText;
      }
    } catch {
      // A crash can leave the immutable file before its catalog pointer. Never
      // keep retrying that orphan forever: discard it, checkpoint the last
      // durable stage, and rebuild it in this same invocation.
      await rm(bundlePath, { force: true });
      const remainingArtifacts = manifest.artifacts.filter(
        (artifact) =>
          artifact.videoId !== video.videoId ||
          artifact.kind === "fingerprint",
      );
      const hasDurableMetadata =
        metadataIsDurable(video) ||
        ((SUCCESSFUL_STATES.has(video.state) ||
          isContextRetryCheckpoint(video)) &&
          video.durationMs !== null);
      video = {
        ...video,
        state: hasDurableMetadata ? "metadata-ready" : "discovered",
        revision: video.revision + 1,
        artifactIds: remainingArtifacts
          .filter(({ videoId }) => videoId === video.videoId)
          .map(({ artifactId }) => artifactId),
        retry: null,
      };
      manifest = mutateCatalog(
        manifest,
        video,
        remainingArtifacts,
        nowIso(),
      );
      await writeJsonAtomic(catalogPath, manifest);
      transcriptBundle = null;
      transcriptBundleText = null;
    }
  }

  if (transcriptBundle === null && !metadataIsDurable(video)) {
    const metadataOutput = await commandRunner(
      ytDlpPath,
      [
        "--no-config",
        "--no-playlist",
        "--skip-download",
        "--dump-single-json",
        "--no-warnings",
        "--no-progress",
        "--",
        video.watchUrl,
      ],
      { timeoutMs: YT_DLP_TIMEOUT_MS },
    );
    const metadataValue = parseJson(metadataOutput.stdout, "yt-dlp metadata");
    fingerprintMetadataValue = metadataValue;
    const metadata = validateYtDlpMetadata(
      metadataValue,
      video.videoId,
      configuredSource,
    );
    video = {
      ...video,
      title: metadata.title,
      normalizedTitle: metadata.normalizedTitle,
      durationMs: metadata.durationMs,
      watchUrl: metadata.watchUrl,
      state: "metadata-ready",
      revision: video.revision + 1,
      retry: null,
    };
    manifest = mutateCatalog(manifest, video, manifest.artifacts, nowIso());
    await writeJsonAtomic(catalogPath, manifest);
  }

  if (transcriptBundle === null) {
    bundlePath = bundlePathForRevision(
      catalogDir,
      video.videoId,
      1,
      configuredSource,
    );
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), `exclipper-${configuredSource.sourceId}-`),
    );
    try {
      const extractedAt = nowIso();
      const prospectiveCatalogRevision = manifest.revision + 1;
      let bundle;
      let scheduledAsrCheckpoint = null;
      try {
        const captionExtraction = await commandRunner(
          ytDlpPath,
          [
            "--no-config",
            "--no-playlist",
            "--skip-download",
            "--write-subs",
            "--write-auto-subs",
            "--sub-langs",
            "ko,ko-orig",
            "--sub-format",
            "json3",
            "--dump-single-json",
            "--no-simulate",
            "--no-warnings",
            "--no-progress",
            "--no-mtime",
            "--paths",
            temporaryDirectory,
            "--output",
            "%(id)s.%(ext)s",
            "--",
            video.watchUrl,
          ],
          { timeoutMs: YT_DLP_TIMEOUT_MS },
        );
        const captionMetadataValue = parseJson(
          captionExtraction.stdout,
          "yt-dlp caption metadata",
        );
        validateYtDlpMetadata(
          captionMetadataValue,
          video.videoId,
          configuredSource,
        );
        fingerprintMetadataValue ??= captionMetadataValue;
        const captionSource = await locateCaptionJson3(
          temporaryDirectory,
          video.videoId,
          captionMetadataValue,
        );
        const captionJson = parseJson(
          await readBoundedUtf8File(
            captionSource.path,
            MAX_CAPTION_JSON3_BYTES,
            "CAPTION_FILE_TOO_LARGE",
            "CAPTION_ENCODING_INVALID",
          ),
          "ko-orig JSON3",
        );
        bundle = await createTranscriptReadyBundle({
          video,
          captionJson,
          captionLanguageCode: captionSource.languageCode,
          captionIsAutoGenerated: captionSource.isAutoGenerated,
          catalogRevision: prospectiveCatalogRevision,
          extractedAt,
        });
      } catch (cause) {
        if (
          !PERMANENT_CAPTION_RETRY_CODES.has(errorCodeOf(cause)) ||
          contextProxyUrl === null ||
          contextAuthorizationToken === null
        ) {
          throw cause;
        }
        const prepared = await scheduledAsrProvider(
          {
            sourceId: configuredSource.sourceId,
            channelId: configuredSource.channelId,
            videoId: video.videoId,
            durationMs: video.durationMs,
            watchUrl: video.watchUrl,
            catalogDir,
            proxyUrl: contextProxyUrl,
            authorizationToken: contextAuthorizationToken,
          },
          {
            ytDlpPath,
            environment: createYtDlpChildEnvironment(process.env),
          },
        );
        scheduledAsrCheckpoint = prepared.checkpointPath;
        bundle = await createScheduledAsrTranscriptReadyBundle({
          video,
          captionTrack: prepared.track,
          catalogRevision: prospectiveCatalogRevision,
          extractedAt,
        });
      }
      const serializedBundle = serializeBundle(bundle);
      await writeImmutableAtomic(bundlePath, serializedBundle);
      const artifact = artifactForBundle(
        video.videoId,
        serializedBundle,
        extractedAt,
        1,
        configuredSource,
      );
      const transcriptReadyVideo = {
        ...video,
        state: "transcript-ready",
        revision: video.revision + 1,
        artifactIds: artifactIdsForTranscript(
          manifest,
          video.videoId,
          artifact.artifactId,
        ),
        retry: null,
      };
      const nextManifest = mutateCatalog(
        manifest,
        transcriptReadyVideo,
        replaceVideoArtifactKind(
          manifest.artifacts,
          video.videoId,
          "transcript",
          artifact,
        ),
        nowIso(),
      );
      assertChannelPreanalysisBundleMatchesCatalogVideo(
        bundle,
        transcriptReadyVideo,
        nextManifest.revision,
      );
      try {
        await verifyReadyVideoArtifactClosure(
          nextManifest,
          transcriptReadyVideo,
          catalogDir,
        );
      } catch (error) {
        // Do not publish a pointer until the exact bytes written to disk pass
        // closure verification. The outer retry checkpoint then resumes from
        // metadata-ready without being trapped by a corrupt immutable file.
        await rm(bundlePath, { force: true });
        throw error;
      }
      await writeJsonAtomic(catalogPath, nextManifest);
      if (scheduledAsrCheckpoint !== null) {
        await removeScheduledAsrCheckpoint(scheduledAsrCheckpoint).catch(
          () => undefined,
        );
      }
      manifest = nextManifest;
      video = transcriptReadyVideo;
      transcriptBundle = bundle;
      transcriptBundleText = serializedBundle;
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  let primaryResult;
  if (transcriptBundle.state === "context-ready") {
    primaryResult = {
      manifest,
      state:
        video.state === "review-ready" ? "review-ready" : "context-ready",
    };
  } else if (
    contextProxyUrl === null ||
    contextAuthorizationToken === null
  ) {
    if (isContextRetryCheckpoint(video)) {
      const transcriptReadyVideo = {
        ...video,
        state: "transcript-ready",
        revision: video.revision + 1,
        retry: null,
      };
      const nextManifest = mutateCatalog(
        manifest,
        transcriptReadyVideo,
        manifest.artifacts,
        nowIso(),
      );
      assertChannelPreanalysisBundleMatchesCatalogVideo(
        transcriptBundle,
        transcriptReadyVideo,
        nextManifest.revision,
      );
      await verifyReadyVideoArtifactClosure(
        nextManifest,
        transcriptReadyVideo,
        catalogDir,
      );
      await writeJsonAtomic(catalogPath, nextManifest);
      primaryResult = {
        manifest: nextManifest,
        state: "transcript-ready",
      };
    } else {
      primaryResult = { manifest, state: "transcript-ready" };
    }
  } else {
    const recoveredContext = await recoverOrphanContextBundle({
      manifest,
      video,
      transcriptBundle,
      catalogPath,
      catalogDir,
      nowIso,
    });
    primaryResult =
      recoveredContext ??
      (await promoteTranscriptBundleToContext({
        manifest,
        video,
        transcriptBundle,
        transcriptBundleText,
        transcriptBundlePath: bundlePath,
        catalogPath,
        catalogDir,
        contextProxyUrl,
        contextAuthorizationToken,
        contextProviderRetryPolicy,
        fetchImplementation,
        nowIso,
      }));
  }

  manifest = primaryResult.manifest;
  video =
    manifest.videos.find(
      ({ videoId }) => videoId === selectedVideo.videoId,
    ) ?? video;
  if (!hasVisualFingerprintArtifact(manifest, video.videoId)) {
    const attached = await attachVisualFingerprint({
      manifest,
      video,
      fingerprintMetadataValue,
      catalogPath,
      catalogDir,
      ytDlpPath,
      commandRunner,
      visualFingerprintProvider,
      fetchImplementation,
      nowIso,
      configuredSource,
    });
    manifest = attached.manifest;
  }
  return { manifest, state: primaryResult.state };
}

async function attachVisualFingerprint({
  manifest,
  video,
  fingerprintMetadataValue,
  catalogPath,
  catalogDir,
  ytDlpPath,
  commandRunner,
  visualFingerprintProvider,
  fetchImplementation,
  nowIso,
  configuredSource,
}) {
  const fingerprintPath = resolveCatalogArtifactPath(catalogDir, {
    storageKey:
      canonicalChannelPreanalysisVisualFingerprintStorageKey(
        video.videoId,
        configuredSource.sourceId,
      ),
  });
  let serializedFingerprint = await readTextIfPresent(fingerprintPath);
  let fingerprint = null;

  if (serializedFingerprint !== null) {
    try {
      const recovered =
        parseChannelPreanalysisVisualFingerprint(serializedFingerprint);
      if (
        recovered.videoId !== video.videoId ||
        recovered.sourceDurationMs !== video.durationMs ||
        recovered.createdAt !== video.updatedAt
      ) {
        throw syncError(
          "FINGERPRINT_ORPHAN_IDENTITY_INVALID",
          "Orphan visual fingerprint does not match its catalog video.",
        );
      }
      fingerprint = recovered;
    } catch {
      await rm(fingerprintPath, { force: true });
      serializedFingerprint = null;
    }
  }

  try {
    if (fingerprint === null || serializedFingerprint === null) {
      if (visualFingerprintProvider !== null) {
        fingerprint = await visualFingerprintProvider({ video });
      } else {
        const metadataValue =
          fingerprintMetadataValue ??
          parseJson(
            (
              await commandRunner(
                ytDlpPath,
                [
                  "--no-config",
                  "--no-playlist",
                  "--skip-download",
                  "--dump-single-json",
                  "--no-warnings",
                  "--no-progress",
                  "--",
                  video.watchUrl,
                ],
                { timeoutMs: YT_DLP_TIMEOUT_MS },
              )
            ).stdout,
            "yt-dlp fingerprint metadata",
          );
        const metadata = validateYtDlpMetadata(
          metadataValue,
          video.videoId,
          configuredSource,
        );
        if (metadata.durationMs !== video.durationMs) {
          throw syncError(
            "FINGERPRINT_DURATION_CONFLICT",
            "Storyboard metadata duration changed after the durable transcript checkpoint.",
          );
        }
        fingerprint = await createVisualFingerprintFromYtDlpMetadata(
          metadataValue,
          {
            videoId: video.videoId,
            durationMs: metadata.durationMs,
            // The source update time remains stable across immutable write and
            // catalog pointer crashes, so an orphan is exactly recoverable.
            createdAt: video.updatedAt,
            fetchImplementation,
          },
        );
      }
      if (fingerprint === null) {
        throw syncError(
          "FINGERPRINT_STORYBOARD_UNAVAILABLE",
          "YouTube metadata did not expose a usable storyboard.",
        );
      }
      serializedFingerprint =
        serializeChannelPreanalysisVisualFingerprint(fingerprint);
      await writeImmutableAtomic(
        fingerprintPath,
        serializedFingerprint,
      );
    }

    const fingerprintArtifact = artifactForVisualFingerprint(
      video.videoId,
      serializedFingerprint,
      fingerprint.createdAt,
      configuredSource,
    );
    const restoredState = isFingerprintRetryCheckpoint(video)
      ? video.retry.lastSuccessfulState
      : video.state;
    const attachedVideo = {
      ...video,
      state: restoredState,
      revision:
        restoredState === "review-ready"
          ? video.revision
          : video.revision + 1,
      artifactIds: [
        ...video.artifactIds.filter(
          (artifactId) =>
            manifest.artifacts.find(
              (artifact) =>
                artifact.artifactId === artifactId &&
                artifact.kind === "fingerprint",
            ) === undefined,
        ),
        fingerprintArtifact.artifactId,
      ],
      retry: null,
    };
    const attachedManifest = mutateCatalog(
      manifest,
      attachedVideo,
      replaceVideoArtifactKind(
        manifest.artifacts,
        video.videoId,
        "fingerprint",
        fingerprintArtifact,
      ),
      nowIso(),
    );
    await verifyReadyVideoArtifactClosure(
      attachedManifest,
      attachedVideo,
      catalogDir,
    );
    await writeJsonAtomic(catalogPath, attachedManifest);
    return { manifest: attachedManifest, video: attachedVideo };
  } catch (cause) {
    if (errorCodeOf(cause).startsWith("FINGERPRINT_")) throw cause;
    throw syncError(
      "FINGERPRINT_PREPARATION_FAILED",
      "Visual fingerprint preparation failed after the transcript checkpoint.",
      cause,
    );
  }
}

async function recoverOrphanContextBundle({
  manifest,
  video,
  transcriptBundle,
  catalogPath,
  catalogDir,
  nowIso,
}) {
  const configuredSource = channelPreanalysisSourceForManifest(manifest);
  const currentArtifactRevision = manifest.artifacts
    .filter(
      (artifact) =>
        artifact.videoId === video.videoId &&
        artifact.kind === "transcript",
    )
    .reduce((maximum, artifact) => Math.max(maximum, artifact.revision), 0);
  const contextArtifactRevision = Math.max(
    2,
    currentArtifactRevision + 1,
  );
  const contextBundlePath = bundlePathForRevision(
    catalogDir,
    video.videoId,
    contextArtifactRevision,
    configuredSource,
  );
  const contextBundleText = await readTextIfPresent(contextBundlePath);
  if (contextBundleText === null) return null;

  try {
    const contextBundle = parseChannelPreanalysisBundle(contextBundleText);
    await verifyChannelPreanalysisTranscriptDigest(contextBundle);
    if (
      contextBundle.state !== "context-ready" ||
      contextBundle.videoId !== transcriptBundle.videoId ||
      contextBundle.title !== transcriptBundle.title ||
      contextBundle.durationMs !== transcriptBundle.durationMs ||
      contextBundle.publishedAt !== transcriptBundle.publishedAt ||
      contextBundle.transcriptDigest !== transcriptBundle.transcriptDigest
    ) {
      throw syncError(
        "CONTEXT_ORPHAN_INVALID",
        "The orphan context bundle does not match its transcript checkpoint.",
      );
    }
    const artifact = artifactForBundle(
      video.videoId,
      contextBundleText,
      bundleArtifactCreatedAt(contextBundle),
      contextArtifactRevision,
      configuredSource,
    );
    const contextReadyVideo = {
      ...video,
      state: "context-ready",
      revision: video.revision + 1,
      artifactIds: artifactIdsForTranscript(
        manifest,
        video.videoId,
        artifact.artifactId,
      ),
      retry: null,
    };
    const nextManifest = mutateCatalog(
      manifest,
      contextReadyVideo,
      replaceVideoArtifactKind(
        manifest.artifacts,
        video.videoId,
        "transcript",
        artifact,
      ),
      nowIso(),
    );
    assertChannelPreanalysisBundleMatchesCatalogVideo(
      contextBundle,
      contextReadyVideo,
      nextManifest.revision,
    );
    await verifyReadyVideoArtifactClosure(
      nextManifest,
      contextReadyVideo,
      catalogDir,
    );
    await writeJsonAtomic(catalogPath, nextManifest);
    return { manifest: nextManifest, state: "context-ready" };
  } catch {
    await rm(contextBundlePath, { force: true });
    return null;
  }
}

async function promoteTranscriptBundleToContext({
  manifest,
  video,
  transcriptBundle,
  transcriptBundleText,
  transcriptBundlePath,
  catalogPath,
  catalogDir,
  contextProxyUrl,
  contextAuthorizationToken,
  contextProviderRetryPolicy,
  fetchImplementation,
  nowIso,
}) {
  const configuredSource = channelPreanalysisSourceForManifest(manifest);
  if (
    transcriptBundleText === null ||
    (await readTextIfPresent(transcriptBundlePath)) !== transcriptBundleText
  ) {
    throw syncError(
      "TRANSCRIPT_RETRY_CHECKPOINT_INVALID",
      "The exact transcript checkpoint bytes are unavailable.",
    );
  }
  const { broadcastContext, contextReceipt } =
    await requestScheduledBroadcastContext(
    transcriptBundle,
    {
      proxyUrl: contextProxyUrl,
      authorizationToken: contextAuthorizationToken,
      fetchImplementation,
      providerRetryPolicy: contextProviderRetryPolicy,
    },
  );
  const prospectiveCatalogRevision = manifest.revision + 1;
  const contextBundle = await createContextReadyBundle({
    transcriptBundle,
    broadcastContext,
    contextReceipt,
    catalogRevision: prospectiveCatalogRevision,
    generatedAt: nowIso(),
  });
  const serializedContextBundle = serializeBundle(contextBundle);
  const currentArtifactRevision = manifest.artifacts
    .filter(
      (artifact) =>
        artifact.videoId === video.videoId &&
        artifact.kind === "transcript",
    )
    .reduce((maximum, artifact) => Math.max(maximum, artifact.revision), 0);
  const contextArtifactRevision = Math.max(
    2,
    currentArtifactRevision + 1,
  );
  const artifact = artifactForBundle(
    video.videoId,
    serializedContextBundle,
    bundleArtifactCreatedAt(contextBundle),
    contextArtifactRevision,
    configuredSource,
  );
  const contextBundlePath = bundlePathForRevision(
    catalogDir,
    video.videoId,
    contextArtifactRevision,
    configuredSource,
  );
  const contextReadyVideo = {
    ...video,
    state: "context-ready",
    revision: video.revision + 1,
    artifactIds: artifactIdsForTranscript(
      manifest,
      video.videoId,
      artifact.artifactId,
    ),
    retry: null,
  };
  const nextManifest = mutateCatalog(
    manifest,
    contextReadyVideo,
    replaceVideoArtifactKind(
      manifest.artifacts,
      video.videoId,
      "transcript",
      artifact,
    ),
    nowIso(),
  );
  assertChannelPreanalysisBundleMatchesCatalogVideo(
    contextBundle,
    contextReadyVideo,
    nextManifest.revision,
  );

  const preexistingContextText = await readTextIfPresent(contextBundlePath);
  try {
    await writeImmutableAtomic(contextBundlePath, serializedContextBundle);
    await verifyReadyVideoArtifactClosure(
      nextManifest,
      contextReadyVideo,
      catalogDir,
    );
    await writeJsonAtomic(catalogPath, nextManifest);
  } catch (error) {
    // The catalog still points at immutable v1. Remove only bytes created by
    // this attempt; a prior identical orphan remains available for recovery.
    if (preexistingContextText === null) {
      await rm(contextBundlePath, { force: true });
    }
    throw error;
  }
  return { manifest: nextManifest, state: "context-ready" };
}

function verifyRetryableTranscriptCheckpoint(
  manifest,
  video,
  bundleText,
  bundle,
) {
  const artifacts = manifest.artifacts.filter(
    (artifact) =>
      artifact.videoId === video.videoId &&
      video.artifactIds.includes(artifact.artifactId) &&
      artifact.kind === "transcript",
  );
  if (
    artifacts.length !== 1 ||
    artifacts[0].byteLength !== Buffer.byteLength(bundleText) ||
    artifacts[0].contentDigest !==
      `sha256:${createHash("sha256").update(bundleText).digest("hex")}` ||
    artifacts[0].createdAt !== bundleArtifactCreatedAt(bundle)
  ) {
    throw syncError(
      "TRANSCRIPT_RETRY_CHECKPOINT_INVALID",
      "The context retry no longer has its exact transcript artifact.",
    );
  }
}

function isContextRetryCheckpoint(video) {
  return (
    video.state === "retryable" &&
    video.retry?.stage === "context" &&
    video.retry.lastSuccessfulState === "transcript-ready"
  );
}

function isReviewRetryCheckpoint(video) {
  return (
    video.state === "retryable" &&
    video.retry?.stage === "review" &&
    video.retry.lastSuccessfulState === "context-ready"
  );
}

function isFingerprintRetryCheckpoint(video, bundleState = null) {
  if (
    video.state !== "retryable" ||
    video.retry?.stage !== "fingerprint" ||
    !["transcript-ready", "context-ready", "review-ready"].includes(
      video.retry.lastSuccessfulState,
    )
  ) {
    return false;
  }
  return (
    bundleState === null ||
    video.retry.lastSuccessfulState === bundleState ||
    (video.retry.lastSuccessfulState === "review-ready" &&
      bundleState === "context-ready")
  );
}

function nextRecoveredArtifactRevision(manifest, video, bundle) {
  const matching = manifest.artifacts.find(
    (artifact) =>
      artifact.videoId === video.videoId &&
      artifact.contentDigest ===
        `sha256:${createHash("sha256")
          .update(serializeBundle(bundle))
          .digest("hex")}`,
  );
  if (matching !== undefined) return matching.revision;
  return bundle.state === "transcript-ready" ? 1 : 2;
}

function bundleArtifactCreatedAt(bundle) {
  return bundle.contextProvenance?.generatedAt ?? bundle.provenance.extractedAt;
}

async function verifyPinnedYtDlp(ytDlpPath, commandRunner) {
  const version = await commandRunner(ytDlpPath, ["--version"], {
    timeoutMs: 30_000,
  });
  if (version.stdout.trim() !== PINNED_YT_DLP_VERSION) {
    throw syncError(
      "YT_DLP_VERSION_MISMATCH",
      `yt-dlp ${PINNED_YT_DLP_VERSION} is required.`,
    );
  }

  try {
    const file = await stat(ytDlpPath);
    if (!file.isFile()) {
      throw syncError("YT_DLP_INVALID", "yt-dlp path is not a file.");
    }
  } catch (error) {
    if (error instanceof ChannelPreanalysisSyncError) throw error;
    // A PATH-resolved executable is allowed for local use. The production
    // workflow always passes a concrete file and verifies the same digest.
    return;
  }
  const digest = await sha256File(ytDlpPath);
  if (digest !== PINNED_YT_DLP_SHA256) {
    throw syncError(
      "YT_DLP_DIGEST_MISMATCH",
      "yt-dlp binary does not match the pinned SHA-256.",
    );
  }
}

async function fetchOfficialFeed(
  fetchImpl,
  configuredSource = AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
) {
  assertConfiguredSource(configuredSource);
  if (typeof fetchImpl !== "function") {
    throw syncError("FETCH_UNAVAILABLE", "Global fetch is unavailable.");
  }
  let response;
  try {
    response = await fetchImpl(configuredSource.feedUrl, {
      method: "GET",
      headers: {
        accept: "application/atom+xml, application/xml;q=0.9",
        "user-agent": "ExClipper-channel-preanalysis/1",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    });
  } catch (cause) {
    throw syncError(
      "FEED_FETCH_FAILED",
      `YouTube feed request failed for ${configuredSource.sourceId}.`,
      cause,
    );
  }
  if (!response.ok) {
    throw syncError("FEED_HTTP_ERROR", `YouTube feed returned HTTP ${response.status}.`);
  }
  const finalUrl = new URL(response.url || configuredSource.feedUrl);
  if (
    finalUrl.protocol !== "https:" ||
    !["www.youtube.com", "youtube.com"].includes(finalUrl.hostname)
  ) {
    throw syncError("FEED_REDIRECT_INVALID", "YouTube feed redirected off-site.");
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength)) {
      throw syncError(
        "FEED_LENGTH_INVALID",
        "YouTube feed returned an invalid content length.",
      );
    }
    if (Number(contentLength) > YOUTUBE_CHANNEL_ATOM_FEED_MAX_BYTES) {
      throw syncError("FEED_TOO_LARGE", "YouTube feed exceeds its byte limit.");
    }
  }
  const bytes = await readBoundedResponseBytes(
    response,
    YOUTUBE_CHANNEL_ATOM_FEED_MAX_BYTES,
  );
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw syncError("FEED_ENCODING_INVALID", "YouTube feed is not UTF-8.", cause);
  }
}

function hasCaptionJson3(metadataValue, family, languageCode) {
  if (!isRecord(metadataValue) || !isRecord(metadataValue[family])) {
    return false;
  }
  const formats = metadataValue[family][languageCode];
  return (
    Array.isArray(formats) &&
    formats.some((format) => isRecord(format) && format.ext === "json3")
  );
}

async function locateCaptionJson3(directory, videoId, metadataValue) {
  const manualKorean = hasCaptionJson3(metadataValue, "subtitles", "ko");
  const automaticOriginalKorean = hasCaptionJson3(
    metadataValue,
    "automatic_captions",
    "ko-orig",
  );
  const automaticKorean = hasCaptionJson3(
    metadataValue,
    "automatic_captions",
    "ko",
  );
  const preferred = manualKorean
    ? [{ name: `${videoId}.ko.json3`, languageCode: "ko", isAutoGenerated: false }]
    : automaticOriginalKorean
      ? [{ name: `${videoId}.ko-orig.json3`, languageCode: "ko-orig", isAutoGenerated: true }]
      : automaticKorean
        ? [{ name: `${videoId}.ko.json3`, languageCode: "ko-orig", isAutoGenerated: true }]
        : [];
  const names = await readdir(directory);
  for (const candidate of preferred) {
    if (names.filter((name) => name === candidate.name).length === 1) {
      return {
        path: join(directory, candidate.name),
        languageCode: candidate.languageCode,
        isAutoGenerated: candidate.isAutoGenerated,
      };
    }
  }
  throw syncError(
    "KOREAN_CAPTION_NOT_FOUND",
    "yt-dlp did not produce a manual or automatic Korean JSON3 track.",
  );
}

async function readBoundedResponseBytes(
  response,
  maximumBytes,
  tooLargeCode = "FEED_TOO_LARGE",
  tooLargeMessage = "YouTube feed exceeds its byte limit.",
  signal = null,
) {
  if (response.body === null) {
    const bytes = new Uint8Array(
      await waitForAbortable(response.arrayBuffer(), signal),
    );
    if (bytes.byteLength > maximumBytes) {
      throw syncError(tooLargeCode, tooLargeMessage);
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await waitForAbortable(reader.read(), signal);
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw syncError(tooLargeCode, tooLargeMessage);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (signal?.aborted) {
      // Await the cancel before the lock is released. Cancelling settles the
      // read request that lost the deadline race; releasing the lock first
      // leaves that read's fate to the runtime's stream implementation, and a
      // body that never settles keeps the process observably pending.
      await reader.cancel("response deadline exceeded").catch(() => undefined);
    }
    throw error;
  } finally {
    // A lock release must never replace the deadline error being propagated.
    try {
      reader.releaseLock();
    } catch {
      // The reader was already released along with the cancelled stream.
    }
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readBoundedJsonResponse(response, maximumBytes, signal = null) {
  const bytes = await readBoundedResponseBytes(
    response,
    maximumBytes,
    "CONTEXT_ERROR_RESPONSE_TOO_LARGE",
    "Context proxy error response exceeds its byte limit.",
    signal,
  );
  try {
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (!isRecord(value)) {
      throw new TypeError("response is not an object");
    }
    return value;
  } catch (cause) {
    throw syncError(
      "CONTEXT_ERROR_RESPONSE_INVALID",
      "Context proxy error response is not valid JSON.",
      cause,
    );
  }
}

async function readBoundedProxyError(response, signal = null) {
  try {
    const payload = await readBoundedJsonResponse(response, 2_048, signal);
    const error = isRecord(payload.error) ? payload.error : null;
    if (
      error === null ||
      typeof error.code !== "string" ||
      !/^[A-Z][A-Z0-9_]{0,63}$/u.test(error.code)
    ) {
      return null;
    }
    const diagnostic =
      typeof error.diagnostic === "string" &&
      /^[A-Za-z0-9_.;=+|:-]{1,1024}$/u.test(error.diagnostic)
        ? error.diagnostic
        : null;
    return { code: error.code, diagnostic };
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

async function waitForAbortable(promise, signal) {
  if (signal === null) return promise;
  if (signal.aborted) {
    throw new Error("The response deadline was exceeded.");
  }
  let rejectForAbort;
  const aborted = new Promise((_resolve, reject) => {
    rejectForAbort = () =>
      reject(new Error("The response deadline was exceeded."));
    signal.addEventListener("abort", rejectForAbort, { once: true });
  });
  // When the deadline wins the race the original promise is abandoned. Observe
  // its eventual settlement so a late rejection cannot surface as an unhandled
  // rejection after the caller has already been given the deadline error.
  void promise.catch(() => undefined);
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", rejectForAbort);
  }
}

async function fetchWithTimeout(
  url,
  init,
  timeoutMs,
  fetchImplementation,
  consume,
) {
  const controller = new AbortController();
  // This timer stays referenced on purpose. Unlike the yt-dlp timeout, which is
  // held open by a live child process, nothing else here guarantees a handle: a
  // body that stalls in JS has none, so an unreferenced timer lets the loop
  // drain and the deadline never fires at all. clearTimeout below already keeps
  // a satisfied request from delaying exit.
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImplementation(url, {
      ...init,
      signal: controller.signal,
    });
    if (controller.signal.aborted) {
      throw new Error("The response deadline was exceeded.");
    }
    return await consume(response, controller.signal);
  } catch (cause) {
    if (controller.signal.aborted) {
      throw syncError(
        "CONTEXT_REQUEST_TIMEOUT",
        "Scheduled context transport timed out.",
        cause,
      );
    }
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedUtf8File(
  path,
  maximumBytes,
  tooLargeCode,
  invalidEncodingCode,
) {
  const file = await stat(path);
  if (!file.isFile()) {
    throw syncError("CAPTION_FILE_INVALID", "Caption output is not a file.");
  }
  if (file.size <= 0 || file.size > maximumBytes) {
    throw syncError(tooLargeCode, "Caption output exceeds its byte limit.");
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of createReadStream(path)) {
    totalBytes += chunk.byteLength;
    if (totalBytes > maximumBytes) {
      throw syncError(tooLargeCode, "Caption output exceeds its byte limit.");
    }
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks, totalBytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw syncError(
      invalidEncodingCode,
      "Caption output is not valid UTF-8.",
      cause,
    );
  }
}

function hasVisualFingerprintArtifact(manifest, videoId) {
  return manifest.artifacts.some(
    (artifact) =>
      artifact.videoId === videoId &&
      artifact.kind === "fingerprint" &&
      artifact.artifactId ===
        canonicalChannelPreanalysisVisualFingerprintArtifactId(videoId),
  );
}

function artifactIdsForTranscript(
  manifest,
  videoId,
  transcriptArtifactId,
) {
  return [
    ...manifest.artifacts
      .filter(
        (artifact) =>
          artifact.videoId === videoId &&
          artifact.kind === "fingerprint",
      )
      .map(({ artifactId }) => artifactId),
    transcriptArtifactId,
  ];
}

function replaceVideoArtifactKind(
  artifacts,
  videoId,
  kind,
  replacement,
) {
  return [
    ...artifacts.filter(
      (artifact) =>
        artifact.videoId !== videoId || artifact.kind !== kind,
    ),
    replacement,
  ];
}

function fingerprintRetryBaseState(video) {
  if (
    video.state === "retryable" &&
    video.retry !== null &&
    SUCCESSFUL_STATES.has(video.retry.lastSuccessfulState)
  ) {
    return video.retry.lastSuccessfulState;
  }
  if (SUCCESSFUL_STATES.has(video.state)) return video.state;
  return metadataIsDurable(video) ? "metadata-ready" : "discovered";
}

function metadataIsDurable(video) {
  if (video.state === "metadata-ready") return true;
  return (
    video.state === "retryable" &&
    ["metadata-ready", "transcript-ready"].includes(
      video.retry?.lastSuccessfulState,
    ) &&
    video.durationMs !== null
  );
}

function retryStageForVideo(video, contextEnabled, errorCode = "") {
  if (String(errorCode).startsWith("FINGERPRINT_")) {
    return "fingerprint";
  }
  if (
    contextEnabled &&
    (video.state === "transcript-ready" || isContextRetryCheckpoint(video))
  ) {
    return "context";
  }
  return metadataIsDurable(video) ? "transcript" : "metadata";
}

function mutateCatalog(manifest, updatedVideo, artifacts, nowIso) {
  return normalizeCatalogManifest({
    ...manifest,
    revision: manifest.revision + 1,
    generatedAt: nowIso,
    videos: sortCatalogVideos(
      manifest.videos.map((video) =>
        video.videoId === updatedVideo.videoId ? updatedVideo : video,
      ),
    ),
    artifacts,
  });
}

function sortCatalogVideos(videos) {
  return [...videos].sort(
    (left, right) =>
      Date.parse(right.publishedAt) - Date.parse(left.publishedAt) ||
      left.videoId.localeCompare(right.videoId),
  );
}

function normalizeCatalogManifest(value) {
  const configuredSource =
    isRecord(value) && typeof value.channelId === "string"
      ? channelPreanalysisSourceByChannelId(value.channelId)
      : null;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "channelId",
      "channelHandle",
      "revision",
      "generatedAt",
      "videos",
      "artifacts",
    ]) ||
    value.schemaVersion !== CHANNEL_PREANALYSIS_CATALOG_SCHEMA_VERSION ||
    configuredSource === null ||
    value.channelHandle !== configuredSource.channelHandle ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !Array.isArray(value.videos) ||
    !Array.isArray(value.artifacts) ||
    value.videos.length > MAX_CATALOG_VIDEOS ||
    value.artifacts.length > MAX_CATALOG_ARTIFACTS
  ) {
    throw syncError("CATALOG_INVALID", "Catalog manifest header is invalid.");
  }
  const generatedAt = assertIsoDate(value.generatedAt, "catalog generatedAt");
  const videoIds = new Set();
  const registeredFingerprints = new Set();
  const videos = value.videos.map((raw) => {
    if (
      !isRecord(raw) ||
      !hasExactKeys(raw, [
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
      ]) ||
      raw.channelId !== configuredSource.channelId ||
      typeof raw.videoId !== "string" ||
      !YOUTUBE_VIDEO_ID_PATTERN.test(raw.videoId) ||
      videoIds.has(raw.videoId) ||
      !isBoundedText(raw.title, 1_000) ||
      typeof raw.normalizedTitle !== "string" ||
      raw.normalizedTitle !== normalizeChannelVideoTitle(raw.title) ||
      (raw.durationMs !== null &&
        (!Number.isSafeInteger(raw.durationMs) ||
          raw.durationMs <= 0 ||
          raw.durationMs > MAX_VIDEO_DURATION_MS)) ||
      typeof raw.watchUrl !== "string" ||
      raw.watchUrl !== `https://www.youtube.com/watch?v=${raw.videoId}` ||
      !isChannelPreanalysisState(raw.state) ||
      !Number.isSafeInteger(raw.revision) ||
      raw.revision < 1 ||
      !Array.isArray(raw.artifactIds) ||
      raw.artifactIds.length > MAX_VIDEO_ARTIFACT_IDS ||
      !Array.isArray(raw.registeredLocalSampledFingerprints) ||
      raw.registeredLocalSampledFingerprints.length > MAX_VIDEO_FINGERPRINTS
    ) {
      throw syncError("CATALOG_INVALID", "Catalog video entry is invalid.");
    }
    videoIds.add(raw.videoId);
    const artifactIds = uniqueStrings(
      raw.artifactIds.map((id) => {
        if (!isBoundedText(id, 256)) {
          throw syncError("CATALOG_INVALID", "Catalog artifact ID is invalid.");
        }
        return id;
      }),
    );
    if (artifactIds.length !== raw.artifactIds.length) {
      throw syncError("CATALOG_INVALID", "Catalog artifact IDs are duplicated.");
    }
    const fingerprints = raw.registeredLocalSampledFingerprints.map(
      (fingerprint) => {
        if (
          !isRecord(fingerprint) ||
          !hasExactKeys(fingerprint, ["value", "registeredAt"]) ||
          typeof fingerprint.value !== "string" ||
          !LOCAL_FINGERPRINT_PATTERN.test(fingerprint.value) ||
          registeredFingerprints.has(fingerprint.value)
        ) {
          throw syncError("CATALOG_INVALID", "Catalog fingerprint is invalid.");
        }
        registeredFingerprints.add(fingerprint.value);
        return {
          value: fingerprint.value,
          registeredAt: assertIsoDate(
            fingerprint.registeredAt,
            "fingerprint registeredAt",
          ),
        };
      },
    );
    const retry = normalizeRetry(raw.retry);
    if ((raw.state === "retryable") !== (retry !== null)) {
      throw syncError(
        "CATALOG_INVALID",
        "Catalog retry state and checkpoint are inconsistent.",
      );
    }
    return {
      channelId: configuredSource.channelId,
      videoId: raw.videoId,
      title: raw.title,
      normalizedTitle: raw.normalizedTitle,
      durationMs: raw.durationMs,
      publishedAt: assertIsoDate(raw.publishedAt, "video publishedAt"),
      updatedAt: assertIsoDate(raw.updatedAt, "video updatedAt"),
      watchUrl: raw.watchUrl,
      state: raw.state,
      revision: raw.revision,
      artifactIds,
      registeredLocalSampledFingerprints: fingerprints,
      retry,
    };
  });

  const artifactIds = new Set();
  const artifactStorageKeys = new Set();
  const artifacts = value.artifacts.map((raw) => {
    if (
      !isRecord(raw) ||
      !hasExactKeys(raw, [
        "artifactId",
        "videoId",
        "kind",
        "revision",
        "storageKey",
        "contentDigest",
        "byteLength",
        "createdAt",
      ]) ||
      !isBoundedText(raw.artifactId, 256) ||
      artifactIds.has(raw.artifactId) ||
      typeof raw.videoId !== "string" ||
      !YOUTUBE_VIDEO_ID_PATTERN.test(raw.videoId) ||
      !videoIds.has(raw.videoId) ||
      !["metadata", "transcript", "context", "review", "fingerprint"].includes(
        raw.kind,
      ) ||
      !Number.isSafeInteger(raw.revision) ||
      raw.revision < 1 ||
      !isSafeCatalogStorageKey(raw.storageKey, configuredSource) ||
      (raw.kind === "transcript" &&
        !isCanonicalBundleStorageKey(
          raw.videoId,
          raw.revision,
          raw.storageKey,
          configuredSource,
        )) ||
      (raw.kind === "fingerprint" &&
        (raw.revision !== 1 ||
          raw.artifactId !==
            canonicalChannelPreanalysisVisualFingerprintArtifactId(
              raw.videoId,
            ) ||
          raw.storageKey !==
            canonicalChannelPreanalysisVisualFingerprintStorageKey(
              raw.videoId,
              configuredSource.sourceId,
            ) ||
          raw.byteLength >
            CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_BYTES)) ||
      (raw.kind === "review" &&
        (raw.artifactId !==
          channelPreanalysisReviewBundleArtifactId(
            raw.videoId,
            raw.revision,
          ) ||
          raw.storageKey !==
            channelPreanalysisReviewBundleStorageKey(
              configuredSource.sourceId,
              raw.videoId,
              raw.revision,
            ) ||
          raw.byteLength > CHANNEL_PREANALYSIS_REVIEW_BUNDLE_MAX_BYTES)) ||
      typeof raw.contentDigest !== "string" ||
      !SHA256_PATTERN.test(raw.contentDigest) ||
      !Number.isSafeInteger(raw.byteLength) ||
      raw.byteLength <= 0 ||
      raw.byteLength > CHANNEL_PREANALYSIS_BUNDLE_MAX_BYTES ||
      artifactStorageKeys.has(raw.storageKey)
    ) {
      throw syncError("CATALOG_INVALID", "Catalog artifact is invalid.");
    }
    artifactIds.add(raw.artifactId);
    artifactStorageKeys.add(raw.storageKey);
    return {
      artifactId: raw.artifactId,
      videoId: raw.videoId,
      kind: raw.kind,
      revision: raw.revision,
      storageKey: raw.storageKey,
      contentDigest: raw.contentDigest,
      byteLength: raw.byteLength,
      createdAt: assertIsoDate(raw.createdAt, "artifact createdAt"),
    };
  });

  const artifactById = new Map(
    artifacts.map((artifact) => [artifact.artifactId, artifact]),
  );
  const referencedArtifactIds = new Set();
  for (const video of videos) {
    const referencedArtifacts = video.artifactIds.map((id) => {
      const artifact = artifactById.get(id);
      if (artifact === undefined || artifact.videoId !== video.videoId) {
        throw syncError(
          "CATALOG_INVALID",
          "Catalog video references a missing or foreign artifact.",
        );
      }
      referencedArtifactIds.add(id);
      return artifact;
    });
    const transcriptArtifacts = referencedArtifacts.filter(
      ({ kind }) => kind === "transcript",
    );
    const fingerprintArtifacts = referencedArtifacts.filter(
      ({ kind }) => kind === "fingerprint",
    );
    const reviewArtifacts = referencedArtifacts.filter(
      ({ kind }) => kind === "review",
    );
    const reviewArtifactRequired =
      video.state === "review-ready" ||
      (video.state === "retryable" &&
        video.retry?.stage === "fingerprint" &&
        video.retry.lastSuccessfulState === "review-ready");
    const transcriptArtifactRequired =
      SUCCESSFUL_STATES.has(video.state) ||
      (video.state === "retryable" &&
        ["context", "review", "fingerprint"].includes(
          video.retry?.stage ?? "",
        ) &&
        ["transcript-ready", "context-ready", "review-ready"].includes(
          video.retry?.lastSuccessfulState ?? "",
        ));
    if (
      (transcriptArtifactRequired &&
        transcriptArtifacts.length !== 1) ||
      fingerprintArtifacts.length > 1 ||
      reviewArtifacts.length !== (reviewArtifactRequired ? 1 : 0) ||
      (reviewArtifactRequired && video.durationMs === null) ||
      reviewArtifacts.some(
        (artifact) => artifact.revision !== video.revision,
      ) ||
      transcriptArtifacts.some((artifact) => artifact.revision > video.revision)
    ) {
      throw syncError(
        "CATALOG_INVALID",
        "Catalog transcript artifact closure is invalid.",
      );
    }
  }
  if (
    artifacts.some(
      ({ artifactId }) => !referencedArtifactIds.has(artifactId),
    )
  ) {
    throw syncError("CATALOG_INVALID", "Catalog contains an unreferenced artifact.");
  }

  const normalized = {
    schemaVersion: CHANNEL_PREANALYSIS_CATALOG_SCHEMA_VERSION,
    channelId: configuredSource.channelId,
    channelHandle: configuredSource.channelHandle,
    revision: value.revision,
    generatedAt,
    videos: sortCatalogVideos(videos),
    artifacts,
  };
  assertCatalogSerializedByteLimit(normalized);
  return normalized;
}

function normalizeRetry(value) {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "stage",
      "lastSuccessfulState",
      "attemptCount",
      "nextAttemptAt",
      "errorCode",
    ]) ||
    !["metadata", "transcript", "context", "review", "fingerprint"].includes(
      value.stage,
    ) ||
    ![
      "discovered",
      "metadata-ready",
      "transcript-ready",
      "context-ready",
      "review-ready",
    ].includes(value.lastSuccessfulState) ||
    !Number.isSafeInteger(value.attemptCount) ||
    value.attemptCount < 1 ||
    value.attemptCount > 1_000 ||
    typeof value.errorCode !== "string" ||
    !/^[A-Z0-9_]{1,64}$/u.test(value.errorCode)
  ) {
    throw syncError("CATALOG_INVALID", "Catalog retry checkpoint is invalid.");
  }
  if (
    (value.stage === "metadata" &&
      value.lastSuccessfulState !== "discovered") ||
    (value.stage === "transcript" &&
      value.lastSuccessfulState !== "metadata-ready") ||
    (value.stage === "context" &&
      value.lastSuccessfulState !== "transcript-ready") ||
    (value.stage === "review" &&
      value.lastSuccessfulState !== "context-ready") ||
    (value.stage === "fingerprint" &&
      ![
        "discovered",
        "metadata-ready",
        "transcript-ready",
        "context-ready",
        "review-ready",
      ].includes(value.lastSuccessfulState))
  ) {
    throw syncError("CATALOG_INVALID", "Catalog retry stage is inconsistent.");
  }
  return {
    stage: value.stage,
    lastSuccessfulState: value.lastSuccessfulState,
    attemptCount: value.attemptCount,
    nextAttemptAt: assertIsoDate(value.nextAttemptAt, "retry nextAttemptAt"),
    errorCode: value.errorCode,
  };
}

async function writeJsonAtomic(path, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (
    Buffer.byteLength(serialized) >
    CHANNEL_PREANALYSIS_MANIFEST_MAX_BYTES
  ) {
    throw syncError(
      "CATALOG_TOO_LARGE",
      "Catalog manifest exceeds the browser-readable byte limit.",
    );
  }
  await writeTextAtomic(path, serialized);
}

function assertCatalogSerializedByteLimit(value) {
  if (
    Buffer.byteLength(JSON.stringify(value)) >
    CHANNEL_PREANALYSIS_MANIFEST_MAX_BYTES
  ) {
    throw syncError(
      "CATALOG_TOO_LARGE",
      "Catalog manifest exceeds the browser-readable byte limit.",
    );
  }
}

async function writeTextAtomic(path, text) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = join(
    dirname(path),
    `.${fileURLSafeName(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function writeImmutableAtomic(path, text) {
  const existing = await readTextIfPresent(path);
  if (existing !== null) {
    if (existing === text) return;
    throw syncError(
      "IMMUTABLE_BUNDLE_CONFLICT",
      "A different immutable video bundle already exists.",
    );
  }
  // The workflow concurrency group serializes writers. A same-directory
  // temporary file plus rename keeps the immutable file atomic for readers.
  await writeTextAtomic(path, text);
}

async function readTextIfPresent(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

async function sha256File(path) {
  await access(path);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function runBoundedCommand(
  command,
  arguments_,
  {
    timeoutMs,
    sourceEnvironment = process.env,
  },
) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: createYtDlpChildEnvironment(sourceEnvironment),
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const rejectOutput = (stream) => {
      child.kill("SIGKILL");
      finish(() =>
        reject(
          syncError(
            "YT_DLP_OUTPUT_TOO_LARGE",
            `yt-dlp ${stream} exceeded its byte limit.`,
          ),
        ),
      );
    };
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_COMMAND_STDOUT_BYTES) {
        rejectOutput("stdout");
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_COMMAND_STDERR_BYTES) {
        rejectOutput("stderr");
        return;
      }
      stderr.push(chunk);
    });
    child.on("error", (cause) => {
      finish(() =>
        reject(syncError("YT_DLP_START_FAILED", "Could not start yt-dlp.", cause)),
      );
    });
    child.on("close", (code, signal) => {
      finish(() => {
        if (code !== 0) {
          const diagnostic = Buffer.concat(stderr)
            .toString("utf8")
            .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
            .replace(/\s+/gu, " ")
            .trim()
            .slice(0, 500);
          reject(
            syncError(
              "YT_DLP_FAILED",
              `yt-dlp failed (${String(code ?? signal)}): ${diagnostic || "no diagnostic"}`,
            ),
          );
          return;
        }
        resolvePromise({
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
      });
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() =>
        reject(syncError("YT_DLP_TIMEOUT", "yt-dlp exceeded its time limit.")),
      );
    }, timeoutMs);
    timer.unref();
  });
}

/**
 * Ported from rekasong's prepare_worker, which solved this first. Order
 * matters: botwall wins over unavailable, unavailable over network. The point
 * is measurement -- a rising botwall share is how a tightening WARP range
 * announces itself, and it must not be averaged in with a video that is simply
 * gone.
 *
 * Do not turn `unavailable` into an early abort. YouTube's availability varies
 * by client, so a video one surface calls unavailable can be fetched by
 * another, and a permanent skip makes a misclassification permanent too.
 */
const YT_DLP_FAILURE_PATTERNS = [
  ["botwall", [/sign in to confirm you['’]re not a bot/iu, /confirm you['’]re not a bot/iu]],
  [
    "unavailable",
    [
      /video unavailable/iu,
      /private video/iu,
      /this video is private/iu,
      /\bremoved\b/iu,
      /has been terminated/iu,
      /no longer available/iu,
      /content isn['’]t available/iu,
      /video is not available/iu,
    ],
  ],
  [
    "network",
    [
      /time[d]? ?out/iu,
      /connection (reset|refused|aborted)/iu,
      /network is unreachable/iu,
      /temporary failure in name resolution/iu,
      /name or service not known/iu,
      /getaddrinfo failed/iu,
      /nodename nor servname/iu,
      /incomplete read/iu,
      /eof occurred/iu,
      /http error 5\d\d/iu,
      /unable to connect/iu,
    ],
  ],
];

export function classifyYtDlpFailure(text) {
  if (typeof text !== "string" || text === "") return "unknown";
  for (const [kind, patterns] of YT_DLP_FAILURE_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(text)) return kind;
    }
  }
  return "unknown";
}

/**
 * Deferral diagnostics are printed into workflow logs, and a public
 * repository's logs are public. Drop every query string, which is where signed
 * URLs carry their tokens, and any long opaque run that could be a credential.
 */
function redactDiagnostic(text) {
  if (typeof text !== "string" || text === "") return "";
  return text
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/giu, "$1?[redacted]")
    .replace(/[A-Za-z0-9_-]{24,}/gu, "[redacted]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 300);
}

function parseJson(text, label) {
  try {
    return JSON.parse(text.replace(/^\uFEFF/u, ""));
  } catch (cause) {
    throw syncError("INVALID_JSON", `${label} is not valid JSON.`, cause);
  }
}

function assertIsoDate(value, label) {
  if (
    typeof value !== "string" ||
    !ISO_DATE_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw syncError("INVALID_DATE", `${label} must be an ISO date-time.`);
  }
  return value;
}

function normalizeErrorCode(value) {
  const normalized = String(value)
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 64);
  return normalized || "UNKNOWN_ERROR";
}

function errorCodeOf(error) {
  return normalizeErrorCode(
    isRecord(error) && typeof error.code === "string"
      ? error.code
      : "UNEXPECTED_ERROR",
  );
}

function uniqueStrings(values) {
  return [...new Set(values)];
}

function canonicalBundleStorageKey(
  videoId,
  revision,
  configuredSource = AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
) {
  assertConfiguredSource(configuredSource);
  return `${configuredSource.sourceId}/videos/${videoId}.v${revision}.json`;
}

function isCanonicalBundleStorageKey(
  videoId,
  revision,
  storageKey,
  configuredSource = AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
) {
  return (
    storageKey ===
      canonicalBundleStorageKey(videoId, revision, configuredSource) ||
    (revision === 1 &&
      storageKey === `${configuredSource.sourceId}/videos/${videoId}.json`)
  );
}

function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isBoundedText(value, maximum) {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    Array.from(value).length <= maximum &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

function isSafeCatalogStorageKey(
  value,
  configuredSource = AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
) {
  assertConfiguredSource(configuredSource);
  const prefix = channelPreanalysisStoragePrefix(configuredSource);
  return (
    typeof value === "string" &&
    value.length <= 512 &&
    value.startsWith(prefix) &&
    /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)*$/u.test(value) &&
    value.split("/").every((segment) => segment !== "." && segment !== "..")
  );
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertConfiguredSource(value) {
  if (!isRecord(value) || typeof value.sourceId !== "string") {
    throw syncError(
      "SOURCE_INVALID",
      "Channel preanalysis source is invalid.",
    );
  }
  const canonical = channelPreanalysisSourceById(value.sourceId);
  if (
    canonical === null ||
    value.channelId !== canonical.channelId ||
    value.channelHandle !== canonical.channelHandle ||
    value.playlistId !== canonical.playlistId
  ) {
    throw syncError(
      "SOURCE_INVALID",
      "Channel preanalysis source does not match the configured registry.",
    );
  }
  return canonical;
}

function configuredSourceForStorageKey(storageKey) {
  if (typeof storageKey !== "string") {
    throw syncError(
      "ARTIFACT_STORAGE_KEY_INVALID",
      "Artifact storage key must be text.",
    );
  }
  const sourceId = storageKey.split("/", 1)[0] ?? "";
  const configuredSource = channelPreanalysisSourceById(sourceId);
  if (configuredSource === null) {
    throw syncError(
      "ARTIFACT_STORAGE_KEY_INVALID",
      "Artifact storage key has an unsupported source namespace.",
    );
  }
  return configuredSource;
}

function fileURLSafeName(path) {
  return path.split(/[\\/]/u).at(-1)?.replace(/[^A-Za-z0-9_.-]/gu, "_") ??
    "catalog";
}

function normalizeContextProxyUrl(value) {
  if (value === null || value === undefined || value === "") return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch (cause) {
    throw syncError(
      "INVALID_ARGUMENT",
      "Context proxy URL must be an absolute HTTPS URL.",
      cause,
    );
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.pathname !== "/v1/broadcast-context"
  ) {
    throw syncError(
      "INVALID_ARGUMENT",
      "Context proxy URL must be an HTTPS /v1/broadcast-context endpoint.",
    );
  }
  if (parsed.hostname.toLowerCase() === SHARED_FOREGROUND_WORKER_HOST) {
    throw syncError(
      "INVALID_ARGUMENT",
      "The foreground five-editor Worker cannot be used for scheduled context analysis.",
    );
  }
  return parsed.toString();
}

function normalizeContextAuthorizationToken(value) {
  if (value === null || value === undefined || value === "") return null;
  if (
    typeof value !== "string" ||
    !PREANALYSIS_CONTEXT_TOKEN_PATTERN.test(value)
  ) {
    throw syncError(
      "INVALID_ARGUMENT",
      "Context token must be a 24-512 character opaque bearer token.",
    );
  }
  return value;
}

function normalizeContextProviderRetryPolicy(value) {
  if (!SCHEDULED_CONTEXT_PROVIDER_RETRY_POLICIES.has(value)) {
    throw syncError(
      "INVALID_ARGUMENT",
      "Context provider retry policy must be free-tier-recovery or strict-paid.",
    );
  }
  return value;
}

function assertContextConfigurationPair(proxyUrl, authorizationToken) {
  if ((proxyUrl === null) !== (authorizationToken === null)) {
    throw syncError(
      "INVALID_ARGUMENT",
      "Scheduled context analysis requires both a dedicated proxy URL and token.",
    );
  }
}

function syncError(code, message, cause) {
  return new ChannelPreanalysisSyncError(code, message, { cause });
}

function printUsage() {
  console.log(`Usage:
  npx tsx scripts/sync-amoretto-preanalysis.mjs [options]

Options:
  --source ID|all     Reconcile all four sources (default) or one source.
  --video-id ID       Force one catalog video to retry; requires --source.
  --max-videos 1|2    Process at most this many videos globally (default: 2).
  --catalog-dir PATH  Catalog root for all, or source directory for one source.
  --yt-dlp PATH       Pinned yt-dlp ${PINNED_YT_DLP_VERSION} executable.
  --context-proxy URL Opt in through a dedicated authenticated context endpoint.
  --context-retry-policy POLICY  free-tier-recovery (default) or strict-paid.
  --help              Show this help.`);
}

async function main() {
  const options = parseSyncArguments(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  if (options.configuredSource === null) {
    const result = await synchronizeConfiguredChannelCatalogs(options);
    const report = createChannelPreanalysisRunReport(
      result,
      new Date().toISOString(),
    );
    await writeJsonAtomic(
      join(options.catalogDir, CHANNEL_PREANALYSIS_RUN_REPORT_FILE),
      report,
    );
    const outcomes = result.sources.flatMap(({ outcomes }) => outcomes);
    console.log(
      `Sources ${result.sources.length}; selected ${result.processedVideoCount}/${result.globalLimit}; ` +
        `context-ready ${outcomes.filter(({ state }) => state === "context-ready").length}; ` +
        `retryable ${outcomes.filter(({ state }) => state === "retryable").length}; ` +
        `source-errors ${result.sourceErrors.length}.`,
    );
    return;
  }
  const runStartedAt = new Date().toISOString();
  const result = await synchronizeChannelPreanalysisCatalog(options);
  const completedAt = new Date().toISOString();
  const report = createSingleChannelPreanalysisRunReport(
    result,
    options.configuredSource,
    options.maxVideos,
    runStartedAt,
    completedAt,
  );
  await writeJsonAtomic(
    join(
      dirname(options.catalogDir),
      CHANNEL_PREANALYSIS_RUN_REPORT_FILE,
    ),
    report,
  );
  console.log(
    `${options.configuredSource.sourceId} revision ${result.manifest.revision}; ` +
      `selected ${result.selectedVideoIds.length}; ` +
      `transcript-ready ${result.outcomes.filter(({ state }) => state === "transcript-ready").length}; ` +
      `context-ready ${result.outcomes.filter(({ state }) => state === "context-ready").length}; ` +
      `retryable ${result.outcomes.filter(({ state }) => state === "retryable").length}.`,
  );
}

const invokedPath = process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code = errorCodeOf(error);
    const message =
      error instanceof Error ? error.message : "Unknown synchronization failure.";
    console.error(`[${code}] ${message}`);
    process.exitCode = 1;
  });
}
