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
  AMORETTO_YOUTUBE_CHANNEL_FEED_URL,
  AMORETTO_YOUTUBE_CHANNEL_HANDLE,
  AMORETTO_YOUTUBE_CHANNEL_ID,
  CHANNEL_PREANALYSIS_CATALOG_SCHEMA_VERSION,
  YOUTUBE_CHANNEL_ATOM_FEED_MAX_BYTES,
  isChannelPreanalysisState,
  normalizeChannelVideoTitle,
  parseAmorettoYouTubeAtomFeed,
} from "../src/analysis/channelPreanalysisCatalog.ts";
import {
  CHANNEL_PREANALYSIS_BUNDLE_MAX_BYTES,
  assertChannelPreanalysisBundleMatchesCatalogVideo,
  createChannelPreanalysisBundle,
  createDefaultChannelPreanalysisProvenance,
  parseChannelPreanalysisBundle,
  verifyChannelPreanalysisTranscriptDigest,
} from "../src/analysis/channelPreanalysisBundle.ts";
import {
  BROADCAST_CONTEXT_SCHEMA_VERSION,
  createBroadcastContextRequest,
} from "../src/analysis/broadcastContextProtocol.ts";
import { compactBroadcastContextChapters } from "../src/analysis/broadcastContextChapterCompaction.ts";
import {
  MAX_BROADCAST_CONTEXT_DEEPSEEK_RESPONSE_BYTES,
  parseCurrentBroadcastContextResult,
} from "../src/analysis/broadcastContextDeepseek.ts";
import { createBroadcastParticipantGrounding } from "../src/analysis/broadcastParticipantGrounding.ts";
import { AI_BROADCAST_CONTEXT_ROUTING_REVISION } from "../src/analysis/aiModelRoutingPolicy.ts";
import { AMORETTO_CHANNEL_CAST_ROSTER_ID } from "../src/analysis/participantRoster.ts";
import {
  PREANALYSIS_CONTEXT_CONTRACT_HEADER,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID_HEADER,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION_HEADER,
  PREANALYSIS_CONTEXT_MODEL_ID_HEADER,
  PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER,
  PREANALYSIS_CONTEXT_OPERATION_HEADER,
  PREANALYSIS_CONTEXT_ORIGIN,
  PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER,
  PREANALYSIS_CONTEXT_PROXY_VERSION,
  PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER,
  createPreanalysisContextOperationId,
} from "../src/cloudflare/preanalysisContextProxy.worker.ts";
import {
  YOUTUBE_VIDEO_ID_PATTERN,
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
import { createVisualFingerprintFromYtDlpMetadata } from "./channel-preanalysis-visual-fingerprint.mjs";

export const PINNED_YT_DLP_VERSION = "2026.07.04";
export const PINNED_YT_DLP_SHA256 =
  "495be29ff4d9d4e9be7eabdfef225221e5d5282e77f2f505abc6dca80349f3fd";
export const DEFAULT_MAX_VIDEOS_PER_RUN = 2;
export const MAX_VIDEOS_PER_RUN = 2;
export const MAX_CAPTION_JSON3_BYTES = 32 * 1024 * 1024;
export const CHANNEL_PREANALYSIS_MANIFEST_MAX_BYTES = 4 * 1024 * 1024;
export const DEFAULT_CONTEXT_PROXY_URL = null;
export {
  PREANALYSIS_CONTEXT_CONTRACT_HEADER,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID_HEADER,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION_HEADER,
  PREANALYSIS_CONTEXT_MODEL_ID_HEADER,
  PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER,
  PREANALYSIS_CONTEXT_OPERATION_HEADER,
  PREANALYSIS_CONTEXT_ORIGIN,
  PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER,
  PREANALYSIS_CONTEXT_PROXY_VERSION,
  PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER,
};
export const DEFAULT_CATALOG_DIRECTORY = join(
  "preanalysis-catalog",
  "amoretto-vods",
);

const MAX_COMMAND_STDOUT_BYTES = 8 * 1024 * 1024;
const MAX_COMMAND_STDERR_BYTES = 256 * 1024;
const YT_DLP_TIMEOUT_MS = 5 * 60_000;
const FEED_TIMEOUT_MS = 30_000;
const CONTEXT_REQUEST_TIMEOUT_MS = 3 * 60_000;
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
  "published",
]);
const RETRY_DELAYS_MS = [3, 6, 12, 24].map(
  (hours) => hours * 60 * 60_000,
);

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

  return {
    help,
    videoId,
    maxVideos,
    catalogDir: resolve(cwd, values.get("--catalog-dir") ?? DEFAULT_CATALOG_DIRECTORY),
    ytDlpPath: values.get("--yt-dlp") ?? defaultYtDlp,
    contextProxyUrl,
    contextAuthorizationToken,
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

export function createEmptyCatalog(nowIso) {
  assertIsoDate(nowIso, "generatedAt");
  return {
    schemaVersion: CHANNEL_PREANALYSIS_CATALOG_SCHEMA_VERSION,
    channelId: AMORETTO_YOUTUBE_CHANNEL_ID,
    channelHandle: AMORETTO_YOUTUBE_CHANNEL_HANDLE,
    revision: 1,
    generatedAt: nowIso,
    videos: [],
    artifacts: [],
  };
}

export function mergeFeedIntoCatalog(existing, feed, nowIso) {
  const catalog = normalizeCatalogManifest(existing);
  assertIsoDate(nowIso, "generatedAt");
  if (feed.channelId !== AMORETTO_YOUTUBE_CHANNEL_ID) {
    throw syncError("WRONG_CHANNEL", "Feed channel does not match the catalog.");
  }
  const byId = new Map(catalog.videos.map((video) => [video.videoId, video]));
  let changed = false;

  for (const incoming of feed.videos) {
    const current = byId.get(incoming.videoId);
    if (current === undefined) {
      byId.set(incoming.videoId, {
        channelId: AMORETTO_YOUTUBE_CHANNEL_ID,
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
    return catalogVideoReachedTarget(
      catalog,
      selected,
      includeTranscriptReady,
    )
      ? []
      : [selected];
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
      return (
        video.retry !== null &&
        Date.parse(video.retry.nextAttemptAt) <= nowMs
      );
    })
    .sort((left, right) => {
      const queueRank = (video) =>
        video.state !== "retryable"
          ? 1
          : video.retry?.stage === "fingerprint"
            ? 2
            : 0;
      return (
        queueRank(left) - queueRank(right) ||
        Date.parse(right.publishedAt) - Date.parse(left.publishedAt) ||
        left.videoId.localeCompare(right.videoId)
      );
    })
    .slice(0, maxVideos);
}

export function validateYtDlpMetadata(value, expectedVideoId) {
  if (!isRecord(value)) {
    throw syncError("INVALID_METADATA", "yt-dlp metadata must be an object.");
  }
  if (
    value.id !== expectedVideoId ||
    !YOUTUBE_VIDEO_ID_PATTERN.test(expectedVideoId)
  ) {
    throw syncError("WRONG_VIDEO", "yt-dlp returned a different video.");
  }
  if (value.channel_id !== AMORETTO_YOUTUBE_CHANNEL_ID) {
    throw syncError("WRONG_CHANNEL", "yt-dlp returned a different channel.");
  }
  if (value.availability !== "public") {
    throw syncError("VIDEO_NOT_PUBLIC", "The video is not publicly available.");
  }
  if (value.live_status !== "not_live") {
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
    channelId: AMORETTO_YOUTUBE_CHANNEL_ID,
    title: value.title,
    normalizedTitle: normalizeChannelVideoTitle(value.title),
    durationMs,
    availability: "public",
    liveStatus: "not_live",
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
  if (!["metadata", "transcript", "context", "fingerprint"].includes(stage)) {
    throw syncError("INVALID_RETRY", "Retry stage is invalid.");
  }
  const nowMs = Date.parse(assertIsoDate(nowIso, "retry time"));
  const priorAttempt =
    video.state === "retryable" && video.retry?.stage === stage
      ? video.retry.attemptCount
      : 0;
  const attemptCount = priorAttempt + 1;
  const delay =
    RETRY_DELAYS_MS[Math.min(attemptCount - 1, RETRY_DELAYS_MS.length - 1)];
  const lastSuccessfulState =
    stage === "metadata"
      ? "discovered"
      : stage === "transcript"
        ? "metadata-ready"
        : stage === "context"
          ? "transcript-ready"
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
  const track = parseYouTubeCaptionJson3(captionJson, {
    videoId: video.videoId,
    languageCode: captionLanguageCode,
    isAutoGenerated: captionIsAutoGenerated,
    baseUrl: video.watchUrl,
  });
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
  const verifiedReceipt = verifyScheduledContextReceipt(contextReceipt);
  assertIsoDate(generatedAt, "context generatedAt");
  return createChannelPreanalysisBundle({
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
      evidenceScope: "youtube-caption-transcript-only",
      localVisualVerificationRequired: true,
    },
    provenance: transcriptBundle.provenance,
  });
}

export function createExpectedScheduledContextReceipt() {
  return {
    contractVersion: PREANALYSIS_CONTEXT_PROXY_VERSION,
    routingRevision: AI_BROADCAST_CONTEXT_ROUTING_REVISION,
    modelId: PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID,
    modelRevision: PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION,
  };
}

function verifyScheduledContextReceipt(value) {
  const expected = createExpectedScheduledContextReceipt();
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
    value.modelId !== expected.modelId ||
    value.modelRevision !== expected.modelRevision
  ) {
    throw syncError(
      "CONTEXT_PROXY_RECEIPT_INVALID",
      "The context response does not prove the expected proxy contract, route, and model.",
    );
  }
  return expected;
}

export function serializeBundle(bundle) {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

export function artifactForBundle(
  videoId,
  bytes,
  createdAt,
  revision = 1,
) {
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
    storageKey: canonicalBundleStorageKey(videoId, revision),
    contentDigest,
    byteLength: Buffer.byteLength(bytes),
    createdAt,
  };
}

export function artifactForVisualFingerprint(
  videoId,
  serializedFingerprint,
  createdAt,
) {
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
      canonicalChannelPreanalysisVisualFingerprintStorageKey(videoId),
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
  const chapters = compactBroadcastContextChapters(transcriptBundle.chapters);
  const participantGrounding = createBroadcastParticipantGrounding({
    sourceDurationMs: transcriptBundle.durationMs,
    castRosterId: AMORETTO_CHANNEL_CAST_ROSTER_ID,
    chapters,
  });
  return createBroadcastContextRequest({
    sourceDurationMs: transcriptBundle.durationMs,
    chapters,
    candidates: [],
    castRosterId: AMORETTO_CHANNEL_CAST_ROSTER_ID,
    participantGrounding,
    outputLanguage: "ko",
  });
}

export async function requestScheduledBroadcastContext(
  transcriptBundle,
  {
    proxyUrl,
    authorizationToken,
    fetchImplementation = globalThis.fetch,
    requestTimeoutMs = CONTEXT_REQUEST_TIMEOUT_MS,
  },
) {
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
  const request = createScheduledContextRequest(transcriptBundle);
  const requestBody = JSON.stringify({
    sourceDurationMs: request.sourceDurationMs,
    chapters: request.chapters,
    candidates: request.candidates,
    castRosterId: request.castRosterId,
    participantGrounding: request.participantGrounding,
    outputLanguage: request.outputLanguage,
  });
  const payloadDigest =
    `sha256:${createHash("sha256").update(requestBody).digest("hex")}`;
  const operationId =
    await createPreanalysisContextOperationId(payloadDigest);
  const headers = {
    "Content-Type": "application/json",
    "Origin": PREANALYSIS_CONTEXT_ORIGIN,
    "Authorization": `Bearer ${normalizedAuthorizationToken}`,
    [PREANALYSIS_CONTEXT_CONTRACT_HEADER]:
      PREANALYSIS_CONTEXT_PROXY_VERSION,
    [PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER]:
      AI_BROADCAST_CONTEXT_ROUTING_REVISION,
    [PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID_HEADER]:
      PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID,
    [PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION_HEADER]:
      PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION,
    [PREANALYSIS_CONTEXT_OPERATION_HEADER]: operationId,
    [PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER]: payloadDigest,
  };
  try {
    return await fetchWithTimeout(
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
          const proxyErrorCode =
            await readBoundedProxyErrorCode(response, signal);
          throw syncError(
            proxyErrorCode ?? `CONTEXT_HTTP_${response.status}`,
            `Scheduled context request failed with HTTP ${response.status}.`,
          );
        }
        const contextReceipt = verifyScheduledContextReceipt({
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
        });
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
        return { broadcastContext: result, contextReceipt };
      },
    );
  } catch (cause) {
    if (cause instanceof ChannelPreanalysisSyncError) throw cause;
    // Do not retry an ambiguous transport result in the same run. The durable
    // transcript checkpoint is kept, and the next cron uses the same operation
    // ID so the dedicated proxy can return its cached result without rebilling.
    throw syncError(
      "CONTEXT_OUTCOME_UNKNOWN",
      "The scheduled context request may have reached the provider.",
      cause,
    );
  }
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
    if (!SUCCESSFUL_STATES.has(snapshotVideo.state)) continue;
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
            revision: currentVideo.revision + 1,
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
  if (transcriptArtifacts.length !== 1) {
    throw syncError(
      "TRANSCRIPT_ARTIFACT_COUNT_INVALID",
      "A ready video requires exactly one transcript artifact.",
    );
  }
  if (fingerprintArtifacts.length > 1) {
    throw syncError(
      "FINGERPRINT_ARTIFACT_COUNT_INVALID",
      "A ready video may reference at most one visual fingerprint artifact.",
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
  assertChannelPreanalysisBundleMatchesCatalogVideo(
    bundle,
    video,
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
}

function resolveCatalogArtifactPath(catalogDir, artifact) {
  const prefix = "amoretto-vods/";
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

function bundlePathForRevision(catalogDir, videoId, revision) {
  return resolveCatalogArtifactPath(catalogDir, {
    storageKey: canonicalBundleStorageKey(videoId, revision),
  });
}

export async function synchronizeAmorettoCatalog(
  options,
  dependencies = {},
) {
  const now = dependencies.now ?? (() => new Date());
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const commandRunner = dependencies.commandRunner ?? runBoundedCommand;
  const visualFingerprintProvider =
    dependencies.visualFingerprintProvider ?? null;
  if (
    visualFingerprintProvider !== null &&
    typeof visualFingerprintProvider !== "function"
  ) {
    throw syncError(
      "INVALID_ARGUMENT",
      "Visual fingerprint provider must be a function.",
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
  const contextEnabled =
    contextProxyUrl !== null && contextAuthorizationToken !== null;

  await verifyPinnedYtDlp(options.ytDlpPath, commandRunner);
  const feedText = await fetchOfficialFeed(fetchImpl);
  const feed = parseAmorettoYouTubeAtomFeed(feedText);
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
      ? createEmptyCatalog(nowIso())
      : normalizeCatalogManifest(parseJson(existingText, "catalog"));
  const merged = mergeFeedIntoCatalog(manifest, feed, nowIso());
  manifest = merged.manifest;
  if (existingText === null || merged.changed) {
    await writeJsonAtomic(catalogPath, manifest);
  }
  const closure = await reconcileReadyCatalogArtifacts(manifest, {
    catalogDir: options.catalogDir,
    nowIso: nowIso(),
    log,
  });
  manifest = closure.manifest;
  if (closure.changed) {
    await writeJsonAtomic(catalogPath, manifest);
  }

  const selected = selectDueCatalogVideos(manifest, {
    nowIso: nowIso(),
    maxVideos: options.maxVideos,
    videoId: options.videoId,
    includeTranscriptReady: contextEnabled,
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
        contextProxyUrl,
        contextAuthorizationToken,
        fetchImplementation: fetchImpl,
        nowIso,
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
          revision: current.revision + 1,
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
      log.warn(
        `Deferred ${selectedVideo.videoId} at ${stage}: ${retry.errorCode}; next attempt ${retry.nextAttemptAt}.`,
      );
    }
  }

  return { manifest, selectedVideoIds: selected.map(({ videoId }) => videoId), outcomes };
}

async function processCatalogVideo({
  manifest,
  selectedVideo,
  catalogPath,
  catalogDir,
  ytDlpPath,
  commandRunner,
  visualFingerprintProvider,
  contextProxyUrl,
  contextAuthorizationToken,
  fetchImplementation,
  nowIso,
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
      ? bundlePathForRevision(catalogDir, video.videoId, 1)
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
        video.state === "context-ready" &&
        hasVisualFingerprintArtifact(manifest, video.videoId)
      ) {
        return { manifest, state: "context-ready" };
      }
      if (
        (recoveredBundle.state === "transcript-ready" &&
          video.state === "transcript-ready") ||
        (recoveredBundle.state === "context-ready" &&
          video.state === "context-ready")
      ) {
        transcriptBundle = recoveredBundle;
        transcriptBundleText = existingBundleText;
      } else if (
        (recoveredBundle.state === "transcript-ready" &&
          isContextRetryCheckpoint(video)) ||
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
    const metadata = validateYtDlpMetadata(metadataValue, video.videoId);
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
    bundlePath = bundlePathForRevision(catalogDir, video.videoId, 1);
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "exclipper-amoretto-"),
    );
    try {
      await commandRunner(
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
      const captionSource = await locateCaptionJson3(
        temporaryDirectory,
        video.videoId,
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
      const extractedAt = nowIso();
      const prospectiveCatalogRevision = manifest.revision + 1;
      const bundle = await createTranscriptReadyBundle({
        video,
        captionJson,
        captionLanguageCode: captionSource.languageCode,
        captionIsAutoGenerated: captionSource.isAutoGenerated,
        catalogRevision: prospectiveCatalogRevision,
        extractedAt,
      });
      const serializedBundle = serializeBundle(bundle);
      await writeImmutableAtomic(bundlePath, serializedBundle);
      const artifact = artifactForBundle(
        video.videoId,
        serializedBundle,
        extractedAt,
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
    primaryResult = { manifest, state: "context-ready" };
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
}) {
  const fingerprintPath = resolveCatalogArtifactPath(catalogDir, {
    storageKey:
      canonicalChannelPreanalysisVisualFingerprintStorageKey(
        video.videoId,
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
    );
    const restoredState = isFingerprintRetryCheckpoint(video)
      ? video.retry.lastSuccessfulState
      : video.state;
    const attachedVideo = {
      ...video,
      state: restoredState,
      revision: video.revision + 1,
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
  fetchImplementation,
  nowIso,
}) {
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
  );
  const contextBundlePath = bundlePathForRevision(
    catalogDir,
    video.videoId,
    contextArtifactRevision,
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

function isFingerprintRetryCheckpoint(video, bundleState = null) {
  if (
    video.state !== "retryable" ||
    video.retry?.stage !== "fingerprint" ||
    !["transcript-ready", "context-ready"].includes(
      video.retry.lastSuccessfulState,
    )
  ) {
    return false;
  }
  return (
    bundleState === null ||
    video.retry.lastSuccessfulState === bundleState
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

async function fetchOfficialFeed(fetchImpl) {
  if (typeof fetchImpl !== "function") {
    throw syncError("FETCH_UNAVAILABLE", "Global fetch is unavailable.");
  }
  const response = await fetchImpl(AMORETTO_YOUTUBE_CHANNEL_FEED_URL, {
    method: "GET",
    headers: {
      accept: "application/atom+xml, application/xml;q=0.9",
      "user-agent": "ExClipper-channel-preanalysis/1",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw syncError("FEED_HTTP_ERROR", `YouTube feed returned HTTP ${response.status}.`);
  }
  const finalUrl = new URL(response.url || AMORETTO_YOUTUBE_CHANNEL_FEED_URL);
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

async function locateCaptionJson3(directory, videoId) {
  const preferred = [
    {
      name: `${videoId}.ko.json3`,
      languageCode: "ko",
      isAutoGenerated: false,
    },
    {
      name: `${videoId}.ko-orig.json3`,
      languageCode: "ko-orig",
      isAutoGenerated: true,
    },
  ];
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

async function readBoundedProxyErrorCode(response, signal = null) {
  try {
    const payload = await readBoundedJsonResponse(response, 2_048, signal);
    const error = isRecord(payload.error) ? payload.error : null;
    return (
      error !== null &&
      typeof error.code === "string" &&
      /^[A-Z][A-Z0-9_]{0,63}$/u.test(error.code)
        ? error.code
        : null
    );
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
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
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
    value.channelId !== AMORETTO_YOUTUBE_CHANNEL_ID ||
    value.channelHandle !== AMORETTO_YOUTUBE_CHANNEL_HANDLE ||
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
      raw.channelId !== AMORETTO_YOUTUBE_CHANNEL_ID ||
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
      channelId: AMORETTO_YOUTUBE_CHANNEL_ID,
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
      !["metadata", "transcript", "context", "fingerprint"].includes(
        raw.kind,
      ) ||
      !Number.isSafeInteger(raw.revision) ||
      raw.revision < 1 ||
      !isSafeCatalogStorageKey(raw.storageKey) ||
      (raw.kind === "transcript" &&
        !isCanonicalBundleStorageKey(
          raw.videoId,
          raw.revision,
          raw.storageKey,
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
            ) ||
          raw.byteLength >
            CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_BYTES)) ||
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
    if (
      (SUCCESSFUL_STATES.has(video.state) &&
        transcriptArtifacts.length !== 1) ||
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
    channelId: AMORETTO_YOUTUBE_CHANNEL_ID,
    channelHandle: AMORETTO_YOUTUBE_CHANNEL_HANDLE,
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
    !["metadata", "transcript", "context", "fingerprint"].includes(
      value.stage,
    ) ||
    ![
      "discovered",
      "metadata-ready",
      "transcript-ready",
      "context-ready",
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
    (value.stage === "fingerprint" &&
      ![
        "discovered",
        "metadata-ready",
        "transcript-ready",
        "context-ready",
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

function canonicalBundleStorageKey(videoId, revision) {
  return `amoretto-vods/videos/${videoId}.v${revision}.json`;
}

function isCanonicalBundleStorageKey(videoId, revision, storageKey) {
  return (
    storageKey === canonicalBundleStorageKey(videoId, revision) ||
    (revision === 1 &&
      storageKey === `amoretto-vods/videos/${videoId}.json`)
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

function isSafeCatalogStorageKey(value) {
  return (
    typeof value === "string" &&
    value.length <= 512 &&
    /^amoretto-vods\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)*$/u.test(
      value,
    ) &&
    value.split("/").every((segment) => segment !== "." && segment !== "..")
  );
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  --video-id ID       Force one catalog video to retry.
  --max-videos 1|2    Process at most this many due videos (default: 2).
  --catalog-dir PATH  Catalog branch output directory.
  --yt-dlp PATH       Pinned yt-dlp ${PINNED_YT_DLP_VERSION} executable.
  --context-proxy URL Opt in through a dedicated authenticated context endpoint.
  --help              Show this help.`);
}

async function main() {
  const options = parseSyncArguments(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  const result = await synchronizeAmorettoCatalog(options);
  console.log(
    `Catalog revision ${result.manifest.revision}; selected ${result.selectedVideoIds.length}; ` +
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
