import {
  AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
  channelPreanalysisSourceByChannelId,
  type ChannelPreanalysisYouTubeChannelHandle,
  type ChannelPreanalysisYouTubeChannelId,
  type ConfiguredChannelPreanalysisSource,
} from "./channelPreanalysisSources";

export const AMORETTO_YOUTUBE_CHANNEL_ID =
  AMORETTO_CHANNEL_PREANALYSIS_SOURCE.channelId;
export const AMORETTO_YOUTUBE_CHANNEL_HANDLE =
  AMORETTO_CHANNEL_PREANALYSIS_SOURCE.channelHandle;
export const AMORETTO_YOUTUBE_CHANNEL_URL =
  AMORETTO_CHANNEL_PREANALYSIS_SOURCE.channelUrl;
export const AMORETTO_YOUTUBE_CHANNEL_FEED_URL =
  AMORETTO_CHANNEL_PREANALYSIS_SOURCE.feedUrl;

export const YOUTUBE_CHANNEL_ATOM_FEED_MAX_BYTES = 512 * 1024;
export const YOUTUBE_CHANNEL_ATOM_FEED_MAX_ENTRIES = 64;
export const CHANNEL_PREANALYSIS_CATALOG_SCHEMA_VERSION = 1 as const;
export const CHANNEL_PREANALYSIS_TITLE_DURATION_TOLERANCE_MS = 2_000;
export const CHANNEL_PREANALYSIS_AUTOMATIC_MAX_AGE_MS =
  7 * 24 * 60 * 60_000;

export function isWithinChannelPreanalysisAutomaticWindow(
  publishedAt: string,
  nowMs: number,
): boolean {
  const publishedAtMs = Date.parse(publishedAt);
  return (
    Number.isSafeInteger(nowMs) &&
    nowMs >= 0 &&
    Number.isFinite(publishedAtMs) &&
    publishedAtMs >= nowMs - CHANNEL_PREANALYSIS_AUTOMATIC_MAX_AGE_MS
  );
}

export const CHANNEL_PREANALYSIS_STATES = [
  "discovered",
  "metadata-ready",
  "transcript-ready",
  "context-ready",
  "review-ready",
  "published",
  "retryable",
] as const;

export type ChannelPreanalysisState =
  (typeof CHANNEL_PREANALYSIS_STATES)[number];

export type ChannelPreanalysisArtifactKind =
  | "metadata"
  | "transcript"
  | "context"
  | "review"
  | "fingerprint";

export type ChannelPreanalysisRetryStage =
  | "metadata"
  | "transcript"
  | "context"
  | "review"
  | "fingerprint";

export type ChannelPreanalysisSuccessfulState = Exclude<
  ChannelPreanalysisState,
  "published" | "retryable"
>;

export interface ChannelPreanalysisRetryCheckpoint {
  readonly stage: ChannelPreanalysisRetryStage;
  readonly lastSuccessfulState: ChannelPreanalysisSuccessfulState;
  readonly attemptCount: number;
  readonly nextAttemptAt: string;
  readonly errorCode: string;
}

export interface ChannelPreanalysisArtifact {
  readonly artifactId: string;
  readonly videoId: string;
  readonly kind: ChannelPreanalysisArtifactKind;
  readonly revision: number;
  readonly storageKey: string;
  readonly contentDigest: string;
  readonly byteLength: number;
  readonly createdAt: string;
}

/**
 * This is an exact sampled-byte identity, not a perceptual media fingerprint.
 * It is comparable only after the exact local file fingerprint was explicitly
 * registered on this catalog video.
 */
export interface RegisteredLocalSampledFingerprint {
  readonly value: string;
  readonly registeredAt: string;
}

export interface ChannelVideoIdentityDescriptor {
  readonly videoId: string | null;
  readonly normalizedTitle: string | null;
  readonly durationMs: number | null;
  readonly localSampledFingerprint: string | null;
}

export interface ChannelPreanalysisCatalogVideo {
  readonly channelId: ChannelPreanalysisYouTubeChannelId;
  readonly videoId: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly durationMs: number | null;
  readonly publishedAt: string;
  readonly updatedAt: string;
  readonly watchUrl: string;
  readonly state: ChannelPreanalysisState;
  readonly revision: number;
  readonly artifactIds: readonly string[];
  readonly registeredLocalSampledFingerprints: readonly RegisteredLocalSampledFingerprint[];
  readonly retry: ChannelPreanalysisRetryCheckpoint | null;
}

export interface ChannelPreanalysisCatalogManifest {
  readonly schemaVersion: typeof CHANNEL_PREANALYSIS_CATALOG_SCHEMA_VERSION;
  readonly channelId: ChannelPreanalysisYouTubeChannelId;
  readonly channelHandle: ChannelPreanalysisYouTubeChannelHandle;
  readonly revision: number;
  readonly generatedAt: string;
  readonly videos: readonly ChannelPreanalysisCatalogVideo[];
  readonly artifacts: readonly ChannelPreanalysisArtifact[];
}

export interface YouTubeChannelAtomVideo {
  readonly channelId: ChannelPreanalysisYouTubeChannelId;
  readonly videoId: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly publishedAt: string;
  readonly updatedAt: string;
  readonly watchUrl: string;
  readonly durationMs: number | null;
}

export interface YouTubeChannelAtomFeed {
  readonly channelId: ChannelPreanalysisYouTubeChannelId;
  readonly channelTitle: string;
  readonly feedUrl: string;
  readonly videos: readonly YouTubeChannelAtomVideo[];
}

export type YouTubeChannelAtomFeedErrorCode =
  | "INVALID_INPUT"
  | "TOO_LARGE"
  | "UNSAFE_XML"
  | "INVALID_FEED"
  | "WRONG_CHANNEL"
  | "TOO_MANY_ENTRIES"
  | "DUPLICATE_VIDEO";

export class YouTubeChannelAtomFeedError extends Error {
  public readonly code: YouTubeChannelAtomFeedErrorCode;

  public constructor(
    code: YouTubeChannelAtomFeedErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "YouTubeChannelAtomFeedError";
    this.code = code;
  }
}

export interface ChannelPreanalysisMatchQuery {
  readonly videoId?: string | null;
  readonly title?: string | null;
  readonly durationMs?: number | null;
  readonly localSampledFingerprint?: string | null;
}

export type ChannelPreanalysisMatchConfidence =
  | "exact"
  | "probable"
  | "none";

export type ChannelPreanalysisMatchReason =
  | "explicit-video-id"
  | "explicit-video-id-not-found"
  | "registered-local-sampled-fingerprint"
  | "ambiguous-local-sampled-fingerprint"
  | "visual-fingerprint-consensus"
  | "unique-normalized-title-and-duration"
  | "ambiguous-normalized-title-and-duration"
  | "insufficient-identity"
  | "no-match";

export interface ChannelPreanalysisMatchResult {
  readonly confidence: ChannelPreanalysisMatchConfidence;
  readonly reason: ChannelPreanalysisMatchReason;
  readonly ambiguous: boolean;
  readonly match: ChannelPreanalysisCatalogVideo | null;
  readonly candidates: readonly ChannelPreanalysisCatalogVideo[];
}

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;
const LOCAL_SAMPLED_FINGERPRINT_PATTERN =
  /^local-file-sampled-sha256-v1:[0-9a-f]{64}$/u;
const XML_NAME_PATTERN = /^[A-Za-z_:][A-Za-z0-9_.:-]*$/u;
const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

/**
 * Parses only one configured official replay playlist feed. The parser is
 * deliberately bounded and rejects DTD/entity declarations before examining
 * any entry. Every entry must repeat the complete pinned channel ID.
 */
export function parseYouTubeChannelAtomFeed(
  input: string,
  source: ConfiguredChannelPreanalysisSource =
    AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
): YouTubeChannelAtomFeed {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw feedError("INVALID_INPUT", "YouTube channel feed must be text.");
  }
  if (
    input.length > YOUTUBE_CHANNEL_ATOM_FEED_MAX_BYTES ||
    new TextEncoder().encode(input).byteLength >
      YOUTUBE_CHANNEL_ATOM_FEED_MAX_BYTES
  ) {
    throw feedError("TOO_LARGE", "YouTube channel feed is too large.");
  }
  if (
    input.includes("\u0000") ||
    /<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(input)
  ) {
    throw feedError("UNSAFE_XML", "Unsafe XML declarations are not allowed.");
  }

  const documentText = input.replace(/^\uFEFF/u, "").trim();
  const documentMatch = documentText.match(
    /^(?:<\?xml\s[^?]*\?>\s*)?<feed\b([^>]*)>([\s\S]*)<\/feed>\s*$/u,
  );
  if (documentMatch === null) {
    throw feedError("INVALID_FEED", "YouTube channel feed root is invalid.");
  }

  const feedAttributes = parseXmlAttributes(documentMatch[1] ?? "");
  if (
    feedAttributes.get("xmlns") !== "http://www.w3.org/2005/Atom" ||
    feedAttributes.get("xmlns:yt") !==
      "http://www.youtube.com/xml/schemas/2015"
  ) {
    throw feedError(
      "INVALID_FEED",
      "YouTube channel feed namespaces are invalid.",
    );
  }

  const feedBody = documentMatch[2] ?? "";
  const entryBlocks = collectElementBlocks(feedBody, "entry");
  const entryOpenCount = (feedBody.match(/<entry(?:\s|>)/gu) ?? []).length;
  const entryCloseCount = (feedBody.match(/<\/entry\s*>/gu) ?? []).length;
  if (
    entryBlocks.length !== entryOpenCount ||
    entryBlocks.length !== entryCloseCount
  ) {
    throw feedError("INVALID_FEED", "YouTube channel entries are malformed.");
  }
  if (entryBlocks.length > YOUTUBE_CHANNEL_ATOM_FEED_MAX_ENTRIES) {
    throw feedError(
      "TOO_MANY_ENTRIES",
      "YouTube channel feed has too many entries.",
    );
  }

  const rootBody = feedBody.replace(
    /<entry(?:\s[^>]*)?>[\s\S]*?<\/entry\s*>/gu,
    "",
  );
  const rootChannelId = uniqueElementText(rootBody, "yt:channelId");
  const rootId = uniqueElementText(rootBody, "id");
  /*
   * The live YouTube Atom feed currently omits the leading `UC` in both root
   * identity fields while every entry repeats the complete channel ID. Accept
   * only that exact, pinned legacy representation; it is never used as the
   * authority for an entry.
   */
  const legacyRootChannelId = source.channelId.slice(2);
  const rootIdentityIsPinned =
    (rootChannelId === source.channelId &&
      (rootId === `yt:channel:${source.channelId}` ||
        rootId === `yt:playlist:${source.playlistId}`)) ||
    (rootChannelId === legacyRootChannelId &&
      rootId === `yt:channel:${legacyRootChannelId}`);
  if (
    !rootIdentityIsPinned
  ) {
    throw feedError(
      "WRONG_CHANNEL",
      "YouTube channel feed does not belong to the pinned channel.",
    );
  }
  const channelTitle = uniqueElementText(rootBody, "title");
  if (channelTitle.length === 0) {
    throw feedError("INVALID_FEED", "YouTube channel title is missing.");
  }

  const seenVideoIds = new Set<string>();
  const videos = entryBlocks.map((entry) => {
    const videoId = uniqueElementText(entry, "yt:videoId");
    if (!YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
      throw feedError("INVALID_FEED", "YouTube video ID is invalid.");
    }
    if (seenVideoIds.has(videoId)) {
      throw feedError(
        "DUPLICATE_VIDEO",
        "YouTube channel feed contains a duplicate video.",
      );
    }
    seenVideoIds.add(videoId);

    const entryChannelId = uniqueElementText(entry, "yt:channelId");
    if (entryChannelId !== source.channelId) {
      throw feedError(
        "WRONG_CHANNEL",
        "A YouTube channel entry belongs to a different channel.",
      );
    }
    if (uniqueElementText(entry, "id") !== `yt:video:${videoId}`) {
      throw feedError(
        "INVALID_FEED",
        "YouTube channel entry identity is inconsistent.",
      );
    }

    const title = uniqueElementText(entry, "title");
    const normalizedTitle = normalizeChannelVideoTitle(title);
    if (normalizedTitle.length === 0) {
      throw feedError("INVALID_FEED", "YouTube video title is missing.");
    }
    const publishedAt = parseIsoDate(
      uniqueElementText(entry, "published"),
      "published",
    );
    const updatedAt = parseIsoDate(
      uniqueElementText(entry, "updated"),
      "updated",
    );
    const watchUrl = readCanonicalWatchUrl(entry, videoId);

    return {
      channelId: source.channelId,
      videoId,
      title,
      normalizedTitle,
      publishedAt,
      updatedAt,
      watchUrl,
      durationMs: readOptionalDurationMs(entry),
    };
  });

  return {
    channelId: source.channelId,
    channelTitle,
    feedUrl: source.feedUrl,
    videos,
  };
}

/** Compatibility name for the original source-specific public API. */
export function parseAmorettoYouTubeAtomFeed(
  input: string,
): YouTubeChannelAtomFeed {
  return parseYouTubeChannelAtomFeed(
    input,
    AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
  );
}

export function channelPreanalysisSourceForManifest(
  manifest: Pick<ChannelPreanalysisCatalogManifest, "channelId" | "channelHandle">,
): ConfiguredChannelPreanalysisSource | null {
  const source = channelPreanalysisSourceByChannelId(manifest.channelId);
  return source?.channelHandle === manifest.channelHandle ? source : null;
}

/**
 * Produces the canonical title lane used only for a probable metadata match.
 * Dates and meaningful words are retained; only transport noise and
 * punctuation differences are removed.
 */
export function normalizeChannelVideoTitle(title: string): string {
  if (typeof title !== "string") return "";
  return title
    .normalize("NFKC")
    .replace(/\.(?:mp4|webm|mkv|mov|m4v)\s*$/iu, "")
    .replace(/\[\s*[A-Za-z0-9_-]{11}\s*\]\s*$/u, "")
    .toLocaleLowerCase("en-US")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function createChannelVideoIdentityDescriptor(
  input: ChannelPreanalysisMatchQuery,
): ChannelVideoIdentityDescriptor {
  const videoId = normalizeOptionalVideoId(input.videoId);
  const normalizedTitle =
    input.title === undefined || input.title === null
      ? null
      : normalizeChannelVideoTitle(input.title) || null;
  const durationMs = normalizeOptionalDurationMs(input.durationMs);
  const localSampledFingerprint = normalizeOptionalLocalFingerprint(
    input.localSampledFingerprint,
  );

  return {
    videoId,
    normalizedTitle,
    durationMs,
    localSampledFingerprint,
  };
}

/**
 * Resolves only identities that are safe to compare:
 * 1. an explicit YouTube ID;
 * 2. the exact sampled-byte fingerprint registered on a catalog video;
 * 3. one unique title+duration candidate, marked probable rather than exact.
 */
export function matchChannelPreanalysisVideo(
  manifest: ChannelPreanalysisCatalogManifest,
  query: ChannelPreanalysisMatchQuery,
): ChannelPreanalysisMatchResult {
  const identity = createChannelVideoIdentityDescriptor(query);

  if (identity.videoId !== null) {
    const matches = manifest.videos.filter(
      (video) => video.videoId === identity.videoId,
    );
    if (matches.length === 1) {
      return matchResult("exact", "explicit-video-id", false, matches);
    }
    if (matches.length > 1) {
      return matchResult("none", "explicit-video-id", true, matches);
    }
    // An explicit source ID is authoritative. Falling through to fuzzy
    // metadata could silently attach a different replay.
    return matchResult(
      "none",
      "explicit-video-id-not-found",
      false,
      [],
    );
  }

  if (identity.localSampledFingerprint !== null) {
    const matches = manifest.videos.filter((video) =>
      video.registeredLocalSampledFingerprints.some(
        (registered) =>
          registered.value === identity.localSampledFingerprint,
      ),
    );
    if (matches.length === 1) {
      return matchResult(
        "exact",
        "registered-local-sampled-fingerprint",
        false,
        matches,
      );
    }
    if (matches.length > 1) {
      return matchResult(
        "none",
        "ambiguous-local-sampled-fingerprint",
        true,
        matches,
      );
    }
  }

  if (identity.normalizedTitle !== null && identity.durationMs !== null) {
    const normalizedTitle = identity.normalizedTitle;
    const durationMs = identity.durationMs;
    const matches = manifest.videos.filter(
      (video) =>
        video.normalizedTitle === normalizedTitle &&
        video.durationMs !== null &&
        Math.abs(video.durationMs - durationMs) <=
          CHANNEL_PREANALYSIS_TITLE_DURATION_TOLERANCE_MS,
    );
    if (matches.length === 1) {
      return matchResult(
        "probable",
        "unique-normalized-title-and-duration",
        false,
        matches,
      );
    }
    if (matches.length > 1) {
      return matchResult(
        "none",
        "ambiguous-normalized-title-and-duration",
        true,
        matches,
      );
    }
    return matchResult("none", "no-match", false, []);
  }

  const reason =
    identity.videoId === null &&
    identity.normalizedTitle === null &&
    identity.durationMs === null &&
    identity.localSampledFingerprint === null
      ? "insufficient-identity"
      : "no-match";
  return matchResult("none", reason, false, []);
}

export function isChannelPreanalysisState(
  value: unknown,
): value is ChannelPreanalysisState {
  return (
    typeof value === "string" &&
    (CHANNEL_PREANALYSIS_STATES as readonly string[]).includes(value)
  );
}

function matchResult(
  confidence: ChannelPreanalysisMatchConfidence,
  reason: ChannelPreanalysisMatchReason,
  ambiguous: boolean,
  candidates: readonly ChannelPreanalysisCatalogVideo[],
): ChannelPreanalysisMatchResult {
  return {
    confidence,
    reason,
    ambiguous,
    match: candidates.length === 1 ? (candidates[0] ?? null) : null,
    candidates: [...candidates],
  };
}

function normalizeOptionalVideoId(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  if (!YOUTUBE_VIDEO_ID_PATTERN.test(normalized)) {
    throw new TypeError("Explicit YouTube video ID is invalid.");
  }
  return normalized;
}

function normalizeOptionalDurationMs(
  value: number | null | undefined,
): number | null {
  if (value === undefined || value === null) return null;
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > 12 * 60 * 60 * 1_000
  ) {
    throw new RangeError("Video duration must be 1 ms to 12 hours.");
  }
  return value;
}

function normalizeOptionalLocalFingerprint(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null) return null;
  if (!LOCAL_SAMPLED_FINGERPRINT_PATTERN.test(value)) {
    throw new TypeError("Local sampled file fingerprint is invalid.");
  }
  return value;
}

function collectElementBlocks(container: string, name: string): string[] {
  const escapedName = escapeRegExp(name);
  const pattern = new RegExp(
    `<${escapedName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedName}\\s*>`,
    "gu",
  );
  return Array.from(container.matchAll(pattern), (match) => match[1] ?? "");
}

function uniqueElementText(container: string, name: string): string {
  const values = collectElementBlocks(container, name);
  if (values.length !== 1) {
    throw feedError(
      "INVALID_FEED",
      `YouTube channel feed requires one ${name} element.`,
    );
  }
  return decodeXmlText(values[0] ?? "");
}

function decodeXmlText(value: string): string {
  const trimmed = value.trim();
  const cdataMatch = trimmed.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/u);
  const text = cdataMatch?.[1] ?? trimmed;
  if (cdataMatch === null && /[<>]/u.test(text)) {
    throw feedError("INVALID_FEED", "Nested XML is not valid text.");
  }
  if (
    /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/u.test(text)
  ) {
    throw feedError("INVALID_FEED", "XML text contains an unknown entity.");
  }
  return text
    .replace(
      /&(?:(#x([0-9a-fA-F]+))|(#(\d+))|(amp|lt|gt|quot|apos));/gu,
      (
        entity,
        _hexadecimalToken: string | undefined,
        hexadecimal: string | undefined,
        _decimalToken: string | undefined,
        decimal: string | undefined,
        named: string | undefined,
      ) => {
        if (hexadecimal !== undefined || decimal !== undefined) {
          return decodeNumericEntity(hexadecimal, decimal);
        }
        switch (named) {
          case "amp":
            return "&";
          case "lt":
            return "<";
          case "gt":
            return ">";
          case "quot":
            return '"';
          case "apos":
            return "'";
          default:
            return entity;
        }
      },
    )
    .normalize("NFC");
}

function decodeNumericEntity(
  hexadecimal: string | undefined,
  decimal: string | undefined,
): string {
  const codePoint = Number.parseInt(
    hexadecimal ?? decimal ?? "",
    hexadecimal === undefined ? 10 : 16,
  );
  if (
    !Number.isSafeInteger(codePoint) ||
    codePoint <= 0 ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) {
    throw feedError("INVALID_FEED", "XML entity is outside Unicode.");
  }
  return String.fromCodePoint(codePoint);
}

function parseXmlAttributes(source: string): ReadonlyMap<string, string> {
  const attributes = new Map<string, string>();
  let remaining = source.trim().replace(/\/$/u, "").trim();
  const attributePattern =
    /^([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/u;

  while (remaining.length > 0) {
    const match = remaining.match(attributePattern);
    if (match === null) {
      throw feedError("INVALID_FEED", "XML attributes are invalid.");
    }
    const name = match[1] ?? "";
    if (!XML_NAME_PATTERN.test(name) || attributes.has(name)) {
      throw feedError("INVALID_FEED", "XML attributes are duplicated.");
    }
    attributes.set(name, decodeXmlText(match[2] ?? match[3] ?? ""));
    remaining = remaining.slice(match[0].length).trimStart();
  }
  return attributes;
}

function readCanonicalWatchUrl(entry: string, videoId: string): string {
  const linkMatches = entry.matchAll(/<link\b([^<>]*?)\/?>/gu);
  for (const linkMatch of linkMatches) {
    const attributes = parseXmlAttributes(linkMatch[1] ?? "");
    if (attributes.get("rel") !== "alternate") continue;
    const href = attributes.get("href");
    if (href === undefined) continue;
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      continue;
    }
    if (
      url.protocol === "https:" &&
      (url.hostname === "www.youtube.com" ||
        url.hostname === "youtube.com") &&
      url.pathname === "/watch" &&
      url.searchParams.get("v") === videoId
    ) {
      return `https://www.youtube.com/watch?v=${videoId}`;
    }
  }
  throw feedError("INVALID_FEED", "YouTube video link is invalid.");
}

function readOptionalDurationMs(entry: string): number | null {
  for (const match of entry.matchAll(/<media:content\b([^<>]*?)\/?>/gu)) {
    const attributes = parseXmlAttributes(match[1] ?? "");
    const seconds = attributes.get("duration");
    if (seconds === undefined) continue;
    if (!/^\d{1,6}$/u.test(seconds)) {
      throw feedError("INVALID_FEED", "YouTube video duration is invalid.");
    }
    const durationMs = Number(seconds) * 1_000;
    if (
      !Number.isSafeInteger(durationMs) ||
      durationMs <= 0 ||
      durationMs > 12 * 60 * 60 * 1_000
    ) {
      throw feedError("INVALID_FEED", "YouTube video duration is invalid.");
    }
    return durationMs;
  }
  return null;
}

function parseIsoDate(value: string, label: string): string {
  if (!ISO_DATE_TIME_PATTERN.test(value)) {
    throw feedError(
      "INVALID_FEED",
      `YouTube channel ${label} date is invalid.`,
    );
  }
  const epochMs = Date.parse(value);
  if (!Number.isFinite(epochMs)) {
    throw feedError(
      "INVALID_FEED",
      `YouTube channel ${label} date is invalid.`,
    );
  }
  return new Date(epochMs).toISOString();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function feedError(
  code: YouTubeChannelAtomFeedErrorCode,
  message: string,
): YouTubeChannelAtomFeedError {
  return new YouTubeChannelAtomFeedError(code, message);
}
