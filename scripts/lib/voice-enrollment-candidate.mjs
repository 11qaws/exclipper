const RECIPE_SCHEMA_VERSION = "1.0.0";
const RECIPE_TOOL_ID = "exclipper.voice-enrollment-candidate-extractor";
const RECIPE_SAFETY_ACKNOWLEDGEMENT =
  "candidate-ranges-are-unverified-and-require-human-voice-review";
const MANIFEST_SCHEMA_VERSION = "1.0.0";
const MAX_SOURCE_TIME_MS = 12 * 60 * 60 * 1_000;
const MIN_RANGE_DURATION_MS = 2_000;
const MAX_RANGE_DURATION_MS = 60_000;
const MAX_RECIPE_RANGES = 192;
const MAX_PLAYLIST_SEGMENTS = 50_000;
const IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/+-]*$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ALLOWED_MEDIA_HOST_SUFFIXES = Object.freeze([
  ".akamaized.net",
  ".navercdn.com",
  ".naver.com",
  ".naver.net",
  ".pstatic.net",
]);

export const VOICE_ENROLLMENT_RECIPE_SCHEMA_VERSION = RECIPE_SCHEMA_VERSION;
export const VOICE_ENROLLMENT_RECIPE_TOOL_ID = RECIPE_TOOL_ID;
export const VOICE_ENROLLMENT_RECIPE_SAFETY_ACKNOWLEDGEMENT =
  RECIPE_SAFETY_ACKNOWLEDGEMENT;
export const VOICE_ENROLLMENT_PARTICIPANT_IDS = Object.freeze([
  "sera-professor",
  "amoretto",
  "eureka",
  "sena-arbel",
  "torori-coco",
  "mangjing",
]);

const PARTICIPANT_IDS = new Set(VOICE_ENROLLMENT_PARTICIPANT_IDS);
export const VOICE_ENROLLMENT_APPROVED_SOURCES = Object.freeze({
  "13996057": Object.freeze({
    sourceLocator: "https://chzzk.naver.com/video/13996057",
    expectedChannelId: "0385e1a232e51078bad18aef8479ab22",
    participantIds: VOICE_ENROLLMENT_PARTICIPANT_IDS,
  }),
  "14415543": Object.freeze({
    sourceLocator: "https://chzzk.naver.com/video/14415543",
    expectedChannelId: "3d5546fc8d0dcb478c973a9bc1328980",
    participantIds: Object.freeze(["eureka"]),
  }),
  "14423365": Object.freeze({
    sourceLocator: "https://chzzk.naver.com/video/14423365",
    expectedChannelId: "8b7ccc2a6e05dd1468fb3eb6efd5b3d0",
    participantIds: Object.freeze(["sena-arbel"]),
  }),
  "14402822": Object.freeze({
    sourceLocator: "https://chzzk.naver.com/video/14402822",
    expectedChannelId: "bda7676a8ca63a4acc64167610b5bf53",
    participantIds: Object.freeze(["torori-coco"]),
  }),
  "14393572": Object.freeze({
    sourceLocator: "https://chzzk.naver.com/video/14393572",
    expectedChannelId: "5b1edd3b95c1513cb502ca2cdd391670",
    participantIds: Object.freeze(["mangjing"]),
  }),
});
export const VOICE_ENROLLMENT_TARGET_VIDEO_NO = "13996057";
export const VOICE_ENROLLMENT_TARGET_SOURCE_LOCATOR =
  VOICE_ENROLLMENT_APPROVED_SOURCES[
    VOICE_ENROLLMENT_TARGET_VIDEO_NO
  ].sourceLocator;

function approvedSourceForVideoNo(videoNo) {
  return Object.hasOwn(VOICE_ENROLLMENT_APPROVED_SOURCES, videoNo)
    ? VOICE_ENROLLMENT_APPROVED_SOURCES[videoNo]
    : null;
}

export class VoiceEnrollmentCandidateInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "VoiceEnrollmentCandidateInputError";
  }
}

function fail(message) {
  throw new VoiceEnrollmentCandidateInputError(message);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  return (
    actualKeys.length === sortedExpected.length &&
    actualKeys.every((key, index) => key === sortedExpected[index])
  );
}

function normalizedText(value, maximumLength, fieldName, pattern) {
  if (typeof value !== "string") {
    fail(`${fieldName} must be a string.`);
  }
  const normalized = value.normalize("NFC").trim();
  if (
    normalized.length === 0 ||
    normalized.length > maximumLength ||
    /[\p{Cc}\p{Cf}]/u.test(normalized) ||
    (pattern !== undefined && !pattern.test(normalized))
  ) {
    fail(`${fieldName} is invalid.`);
  }
  return normalized;
}

export function parseEnrollmentTimecode(value, fieldName = "timecode") {
  const normalized = normalizedText(value, 12, fieldName);
  const match =
    /^(?<hours>\d{2}):(?<minutes>[0-5]\d):(?<seconds>[0-5]\d)(?:\.(?<milliseconds>\d{3}))?$/u.exec(
      normalized,
    );
  if (match?.groups === undefined) {
    fail(`${fieldName} must use HH:MM:SS or HH:MM:SS.mmm.`);
  }
  const hours = Number(match.groups.hours);
  const minutes = Number(match.groups.minutes);
  const seconds = Number(match.groups.seconds);
  const milliseconds = Number(match.groups.milliseconds ?? "0");
  const total = ((hours * 60 + minutes) * 60 + seconds) * 1_000 + milliseconds;
  if (!Number.isSafeInteger(total) || total > MAX_SOURCE_TIME_MS) {
    fail(`${fieldName} is outside the supported 12-hour source limit.`);
  }
  return total;
}

export function parseVoiceEnrollmentRecipe(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "tool",
      "safetyAcknowledgement",
      "videoNo",
      "sourceLocator",
      "manifestRevision",
      "ranges",
    ])
  ) {
    fail("Recipe must contain only the documented top-level fields.");
  }
  if (value.schemaVersion !== RECIPE_SCHEMA_VERSION) {
    fail(`Recipe schemaVersion must be ${RECIPE_SCHEMA_VERSION}.`);
  }
  if (value.tool !== RECIPE_TOOL_ID) {
    fail(`Recipe tool must be ${RECIPE_TOOL_ID}.`);
  }
  if (value.safetyAcknowledgement !== RECIPE_SAFETY_ACKNOWLEDGEMENT) {
    fail(
      "Recipe must acknowledge that every range remains an unverified voice candidate.",
    );
  }
  const approvedSource =
    typeof value.videoNo === "string"
      ? approvedSourceForVideoNo(value.videoNo)
      : null;
  if (approvedSource === null) {
    fail("This developer tool accepts only explicitly approved CHZZK videos.");
  }
  if (value.sourceLocator !== approvedSource.sourceLocator) {
    fail(`sourceLocator must be ${approvedSource.sourceLocator}.`);
  }
  const allowedParticipantIds = new Set(approvedSource.participantIds);
  const manifestRevision = normalizedText(
    value.manifestRevision,
    128,
    "manifestRevision",
    IDENTIFIER_PATTERN,
  );
  if (
    !Array.isArray(value.ranges) ||
    value.ranges.length === 0 ||
    value.ranges.length > MAX_RECIPE_RANGES
  ) {
    fail(`ranges must contain between 1 and ${MAX_RECIPE_RANGES} entries.`);
  }

  const seenRanges = new Set();
  const ranges = value.ranges.map((candidate, index) => {
    const label = `ranges[${index}]`;
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, ["participantId", "start", "end", "reviewNote"])
    ) {
      fail(
        `${label} must contain only participantId, start, end, and reviewNote.`,
      );
    }
    if (
      !PARTICIPANT_IDS.has(candidate.participantId) ||
      !allowedParticipantIds.has(candidate.participantId)
    ) {
      fail(
        `${label}.participantId is not approved for CHZZK video ${value.videoNo}.`,
      );
    }
    const startMs = parseEnrollmentTimecode(candidate.start, `${label}.start`);
    const endMs = parseEnrollmentTimecode(candidate.end, `${label}.end`);
    const durationMs = endMs - startMs;
    if (
      durationMs < MIN_RANGE_DURATION_MS ||
      durationMs > MAX_RANGE_DURATION_MS
    ) {
      fail(`${label} must span between 2 and 60 seconds.`);
    }
    const reviewNote = normalizedText(
      candidate.reviewNote,
      500,
      `${label}.reviewNote`,
    );
    const rangeKey = `${candidate.participantId}\u0000${startMs}\u0000${endMs}`;
    if (seenRanges.has(rangeKey)) {
      fail(`${label} duplicates an earlier participant range.`);
    }
    seenRanges.add(rangeKey);
    return Object.freeze({
      participantId: candidate.participantId,
      startMs,
      endMs,
      durationMs,
      reviewNote,
    });
  });

  ranges.sort(
    (left, right) =>
      left.startMs - right.startMs ||
      left.endMs - right.endMs ||
      left.participantId.localeCompare(right.participantId),
  );
  return Object.freeze({
    schemaVersion: RECIPE_SCHEMA_VERSION,
    tool: RECIPE_TOOL_ID,
    safetyAcknowledgement: RECIPE_SAFETY_ACKNOWLEDGEMENT,
    videoNo: value.videoNo,
    sourceLocator: approvedSource.sourceLocator,
    manifestRevision,
    ranges: Object.freeze(ranges),
  });
}

function parseAttributeList(value) {
  const attributes = new Map();
  const pattern = /(?<key>[A-Z0-9-]+)=(?<value>"[^"]*"|[^,]*)/gu;
  for (const match of value.matchAll(pattern)) {
    if (match.groups === undefined) continue;
    const rawValue = match.groups.value;
    attributes.set(
      match.groups.key,
      rawValue.startsWith('"') && rawValue.endsWith('"')
        ? rawValue.slice(1, -1)
        : rawValue,
    );
  }
  return attributes;
}

function isAllowedMediaHostname(hostname) {
  const normalized = hostname.toLowerCase();
  return ALLOWED_MEDIA_HOST_SUFFIXES.some(
    (suffix) => normalized === suffix.slice(1) || normalized.endsWith(suffix),
  );
}

export function assertAllowedChzzkMediaUrl(value, expectedOrigin = null) {
  let url;
  try {
    url = value instanceof URL ? new URL(value.href) : new URL(value);
  } catch {
    fail("CHZZK media URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.port !== "" && url.port !== "443") ||
    url.hash !== "" ||
    url.href.length > 8_192 ||
    !isAllowedMediaHostname(url.hostname)
  ) {
    fail("CHZZK media URL is outside the allowed HTTPS CDN boundary.");
  }
  if (expectedOrigin !== null && url.origin !== expectedOrigin) {
    fail("A media playlist attempted to cross its signed CDN origin.");
  }
  return url;
}

function resolvePlaylistUrl(value, baseUrl) {
  let resolved;
  try {
    resolved = new URL(value, baseUrl);
  } catch {
    fail("Playlist contains an invalid media URI.");
  }
  return assertAllowedChzzkMediaUrl(resolved, baseUrl.origin);
}

function absolutizeTagUri(line, baseUrl) {
  const uriMatch = /URI="(?<uri>[^"]+)"/u.exec(line);
  if (uriMatch?.groups?.uri === undefined) {
    fail("Playlist tag contains an invalid URI attribute.");
  }
  const resolved = resolvePlaylistUrl(uriMatch.groups.uri, baseUrl);
  return line.replace(uriMatch[0], `URI="${resolved.href}"`);
}

function playlistLines(text, label) {
  if (typeof text !== "string" || text.length === 0) {
    fail(`${label} is empty.`);
  }
  const lines = text.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  if (lines[0]?.trim() !== "#EXTM3U") {
    fail(`${label} is not an HLS playlist.`);
  }
  return lines;
}

export function parseHlsMasterPlaylist(text, masterUrl) {
  const baseUrl = assertAllowedChzzkMediaUrl(masterUrl);
  const lines = playlistLines(text, "HLS master playlist");
  const variants = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;
    const attributes = parseAttributeList(
      line.slice("#EXT-X-STREAM-INF:".length),
    );
    const bandwidth = Number(attributes.get("BANDWIDTH"));
    if (!Number.isSafeInteger(bandwidth) || bandwidth <= 0) {
      fail("HLS variant has an invalid BANDWIDTH.");
    }
    let uriIndex = index + 1;
    while (uriIndex < lines.length && (lines[uriIndex]?.trim() ?? "") === "") {
      uriIndex += 1;
    }
    const uri = lines[uriIndex]?.trim() ?? "";
    if (uri === "" || uri.startsWith("#")) {
      fail("HLS variant is missing its media playlist URI.");
    }
    variants.push(
      Object.freeze({
        bandwidth,
        resolution: attributes.get("RESOLUTION") ?? null,
        codecs: attributes.get("CODECS") ?? null,
        url: resolvePlaylistUrl(uri, baseUrl),
      }),
    );
    index = uriIndex;
  }
  if (variants.length === 0) {
    fail("HLS master playlist has no variants.");
  }
  return Object.freeze(variants);
}

export function selectLowestBandwidthVariant(variants) {
  if (!Array.isArray(variants) || variants.length === 0) {
    fail("At least one HLS variant is required.");
  }
  return [...variants].sort(
    (left, right) =>
      left.bandwidth - right.bandwidth ||
      (left.resolution ?? "").localeCompare(right.resolution ?? ""),
  )[0];
}

function parsePositiveDecimal(value, fieldName) {
  if (!/^\d+(?:\.\d+)?$/u.test(value)) {
    fail(`${fieldName} must be a positive decimal.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    fail(`${fieldName} must be a positive decimal.`);
  }
  return parsed;
}

export function parseHlsMediaPlaylist(text, mediaPlaylistUrl) {
  const baseUrl = assertAllowedChzzkMediaUrl(mediaPlaylistUrl);
  const lines = playlistLines(text, "HLS media playlist");
  let version = 3;
  let targetDurationSeconds = 0;
  let mediaSequence = 0;
  let discontinuitySequence = 0;
  let discontinuitiesSeen = 0;
  let independentSegments = false;
  let activeMapLine = null;
  let activeKeyLine = null;
  let pendingDuration = null;
  let pendingDurationText = null;
  let pendingTags = [];
  let sourceCursorMs = 0;
  const segments = [];

  for (const rawLine of lines.slice(1)) {
    const line = rawLine.trim();
    if (line === "") continue;
    if (line === "#EXT-X-INDEPENDENT-SEGMENTS") {
      independentSegments = true;
      continue;
    }
    if (line.startsWith("#EXT-X-VERSION:")) {
      const candidate = Number(line.slice("#EXT-X-VERSION:".length));
      if (!Number.isSafeInteger(candidate) || candidate <= 0) {
        fail("HLS media playlist version is invalid.");
      }
      version = candidate;
      continue;
    }
    if (line.startsWith("#EXT-X-TARGETDURATION:")) {
      targetDurationSeconds = parsePositiveDecimal(
        line.slice("#EXT-X-TARGETDURATION:".length),
        "HLS target duration",
      );
      continue;
    }
    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
      const candidate = Number(line.slice("#EXT-X-MEDIA-SEQUENCE:".length));
      if (!Number.isSafeInteger(candidate) || candidate < 0) {
        fail("HLS media sequence is invalid.");
      }
      mediaSequence = candidate;
      continue;
    }
    if (line.startsWith("#EXT-X-DISCONTINUITY-SEQUENCE:")) {
      const candidate = Number(
        line.slice("#EXT-X-DISCONTINUITY-SEQUENCE:".length),
      );
      if (!Number.isSafeInteger(candidate) || candidate < 0) {
        fail("HLS discontinuity sequence is invalid.");
      }
      discontinuitySequence = candidate;
      continue;
    }
    if (line.startsWith("#EXT-X-MAP:")) {
      activeMapLine = absolutizeTagUri(line, baseUrl);
      continue;
    }
    if (line.startsWith("#EXT-X-KEY:")) {
      activeKeyLine = line.includes('URI="')
        ? absolutizeTagUri(line, baseUrl)
        : line;
      continue;
    }
    if (line.startsWith("#EXTINF:")) {
      const durationText = line.slice("#EXTINF:".length).split(",", 1)[0];
      pendingDuration = parsePositiveDecimal(
        durationText,
        "HLS segment duration",
      );
      pendingDurationText = durationText;
      continue;
    }
    if (
      line === "#EXT-X-DISCONTINUITY" ||
      line === "#EXT-X-GAP" ||
      line.startsWith("#EXT-X-BYTERANGE:") ||
      line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")
    ) {
      pendingTags.push(line);
      continue;
    }
    if (line.startsWith("#")) continue;
    if (pendingDuration === null || pendingDurationText === null) {
      fail("HLS media URI is not preceded by EXTINF.");
    }
    if (segments.length >= MAX_PLAYLIST_SEGMENTS) {
      fail(`HLS media playlist exceeds ${MAX_PLAYLIST_SEGMENTS} segments.`);
    }
    const durationMs = pendingDuration * 1_000;
    const startMs = sourceCursorMs;
    const endMs = startMs + durationMs;
    segments.push(
      Object.freeze({
        index: segments.length,
        startMs,
        endMs,
        durationMs,
        durationText: pendingDurationText,
        url: resolvePlaylistUrl(line, baseUrl),
        mapLine: activeMapLine,
        keyLine: activeKeyLine,
        tags: Object.freeze(pendingTags),
        discontinuitiesBefore: discontinuitiesSeen,
      }),
    );
    if (pendingTags.includes("#EXT-X-DISCONTINUITY")) {
      discontinuitiesSeen += 1;
    }
    sourceCursorMs = endMs;
    pendingDuration = null;
    pendingDurationText = null;
    pendingTags = [];
  }
  if (pendingDuration !== null || segments.length === 0) {
    fail("HLS media playlist has an incomplete or empty segment list.");
  }
  if (targetDurationSeconds === 0) {
    targetDurationSeconds = Math.ceil(
      Math.max(...segments.map(({ durationMs }) => durationMs)) / 1_000,
    );
  }
  return Object.freeze({
    version,
    targetDurationSeconds,
    mediaSequence,
    discontinuitySequence,
    independentSegments,
    durationMs: sourceCursorMs,
    segments: Object.freeze(segments),
  });
}

export function buildBoundedHlsMediaPlaylist(
  mediaPlaylist,
  sourceStartMs,
  sourceEndMs,
) {
  if (
    !Number.isSafeInteger(sourceStartMs) ||
    !Number.isSafeInteger(sourceEndMs) ||
    sourceStartMs < 0 ||
    sourceEndMs <= sourceStartMs
  ) {
    fail("Requested HLS source range is invalid.");
  }
  const selected = mediaPlaylist.segments.filter(
    (segment) => segment.startMs < sourceEndMs && segment.endMs > sourceStartMs,
  );
  const first = selected[0];
  const last = selected.at(-1);
  if (
    first === undefined ||
    last === undefined ||
    first.startMs > sourceStartMs + 1 ||
    last.endMs + 1 < sourceEndMs
  ) {
    fail("Requested range is not fully covered by the HLS media playlist.");
  }

  const lines = ["#EXTM3U", `#EXT-X-VERSION:${mediaPlaylist.version}`];
  if (mediaPlaylist.independentSegments) {
    lines.push("#EXT-X-INDEPENDENT-SEGMENTS");
  }
  lines.push(
    `#EXT-X-TARGETDURATION:${Math.ceil(mediaPlaylist.targetDurationSeconds)}`,
    `#EXT-X-MEDIA-SEQUENCE:${mediaPlaylist.mediaSequence + first.index}`,
    `#EXT-X-DISCONTINUITY-SEQUENCE:${
      mediaPlaylist.discontinuitySequence + first.discontinuitiesBefore
    }`,
    "#EXT-X-PLAYLIST-TYPE:VOD",
  );

  let emittedMapLine = null;
  let emittedKeyLine = null;
  for (const segment of selected) {
    if (segment.keyLine !== emittedKeyLine && segment.keyLine !== null) {
      lines.push(segment.keyLine);
      emittedKeyLine = segment.keyLine;
    }
    if (segment.mapLine !== emittedMapLine && segment.mapLine !== null) {
      lines.push(segment.mapLine);
      emittedMapLine = segment.mapLine;
    }
    lines.push(
      ...segment.tags,
      `#EXTINF:${segment.durationText},`,
      segment.url.href,
    );
  }
  lines.push("#EXT-X-ENDLIST", "");
  return Object.freeze({
    playlistText: lines.join("\n"),
    playlistStartMs: first.startMs,
    playlistEndMs: last.endMs,
    seekOffsetMs: sourceStartMs - first.startMs,
    selectedSegmentCount: selected.length,
  });
}

export function candidateVoiceAssetId(videoNo, range) {
  return `chzzk-video-${videoNo}-${range.participantId}-${range.startMs}-${range.endMs}`;
}

export function candidateVoiceAudioFileName(videoNo, range) {
  return `${candidateVoiceAssetId(videoNo, range)}.flac`;
}

export function buildPendingVoiceEnrollmentManifest(recipe, extractedAssets) {
  if (
    !Array.isArray(extractedAssets) ||
    extractedAssets.length !== recipe.ranges.length
  ) {
    fail("Every reviewed recipe range must have exactly one extracted asset.");
  }
  const extractedByRange = new Map();
  for (const extracted of extractedAssets) {
    if (
      !isRecord(extracted) ||
      !hasExactKeys(extracted, [
        "participantId",
        "startMs",
        "endMs",
        "contentSha256",
      ]) ||
      !PARTICIPANT_IDS.has(extracted.participantId) ||
      !Number.isSafeInteger(extracted.startMs) ||
      !Number.isSafeInteger(extracted.endMs) ||
      !SHA256_PATTERN.test(extracted.contentSha256)
    ) {
      fail("Extracted asset metadata is invalid.");
    }
    const key =
      `${extracted.participantId}\u0000${extracted.startMs}` +
      `\u0000${extracted.endMs}`;
    if (extractedByRange.has(key)) {
      fail("Extracted asset metadata contains a duplicate range.");
    }
    extractedByRange.set(key, extracted);
  }

  const assets = recipe.ranges.map((range) => {
    const key = `${range.participantId}\u0000${range.startMs}\u0000${range.endMs}`;
    const extracted = extractedByRange.get(key);
    if (extracted === undefined) {
      fail("An extracted asset does not match its reviewed recipe range.");
    }
    return {
      participantId: range.participantId,
      assetId: candidateVoiceAssetId(recipe.videoNo, range),
      source: {
        sourceId: `chzzk-video:${recipe.videoNo}`,
        startMs: range.startMs,
        endMs: range.endMs,
      },
      contentSha256: extracted.contentSha256,
      provenance: {
        sourceType: "creator-published",
        sourceLocator: recipe.sourceLocator,
        note:
          `개발자 도구로 추출한 미검증 음성 후보입니다. ` +
          `recipe note: ${range.reviewNote}`,
      },
      consent: {
        status: "unknown",
        basis:
          "후보 구간 추출만 완료되었으며 음성 등록 동의 여부는 확인되지 않았습니다.",
      },
      language: "ko",
      speechActivity: "speech",
      containsOverlappingSpeech: true,
      containsMusic: true,
      humanVerification: {
        status: "pending",
        verifierId: null,
        verifiedAt: null,
        note: "단독 화자, 발화 내용, 음악·겹침 여부를 사람이 직접 확인하기 전인 후보입니다.",
      },
      embeddingModelRevision: "speaker-embedding:unassigned",
      assetRevision: "candidate-v1",
    };
  });
  assets.sort(
    (left, right) =>
      left.participantId.localeCompare(right.participantId) ||
      left.assetId.localeCompare(right.assetId),
  );
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    manifestRevision: recipe.manifestRevision,
    assets,
  };
  assertPendingVoiceEnrollmentManifest(manifest);
  return manifest;
}

export function assertPendingVoiceEnrollmentManifest(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "manifestRevision", "assets"]) ||
    value.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
    typeof value.manifestRevision !== "string" ||
    !IDENTIFIER_PATTERN.test(value.manifestRevision) ||
    !Array.isArray(value.assets) ||
    value.assets.length === 0 ||
    value.assets.length > MAX_RECIPE_RANGES
  ) {
    fail("Pending participant voice enrollment manifest is invalid.");
  }
  const assetIds = new Set();
  let manifestVideoNo = null;
  let manifestApprovedSource = null;
  for (const asset of value.assets) {
    const sourceVideoMatch =
      isRecord(asset?.source) && typeof asset.source.sourceId === "string"
        ? /^chzzk-video:(?<videoNo>[0-9]{1,20})$/u.exec(
            asset.source.sourceId,
          )
        : null;
    const sourceVideoNo = sourceVideoMatch?.groups?.videoNo ?? null;
    const approvedSource =
      sourceVideoNo === null ? null : approvedSourceForVideoNo(sourceVideoNo);
    if (
      !isRecord(asset) ||
      !hasExactKeys(asset, [
        "participantId",
        "assetId",
        "source",
        "contentSha256",
        "provenance",
        "consent",
        "language",
        "speechActivity",
        "containsOverlappingSpeech",
        "containsMusic",
        "humanVerification",
        "embeddingModelRevision",
        "assetRevision",
      ]) ||
      !PARTICIPANT_IDS.has(asset.participantId) ||
      typeof asset.assetId !== "string" ||
      !IDENTIFIER_PATTERN.test(asset.assetId) ||
      assetIds.has(asset.assetId) ||
      !SHA256_PATTERN.test(asset.contentSha256) ||
      asset.language !== "ko" ||
      asset.speechActivity !== "speech" ||
      asset.containsOverlappingSpeech !== true ||
      asset.containsMusic !== true ||
      !isRecord(asset.source) ||
      !hasExactKeys(asset.source, ["sourceId", "startMs", "endMs"]) ||
      approvedSource === null ||
      !approvedSource.participantIds.includes(asset.participantId) ||
      !Number.isSafeInteger(asset.source.startMs) ||
      !Number.isSafeInteger(asset.source.endMs) ||
      asset.source.startMs < 0 ||
      asset.source.endMs <= asset.source.startMs ||
      asset.source.endMs - asset.source.startMs < MIN_RANGE_DURATION_MS ||
      asset.source.endMs - asset.source.startMs > MAX_RANGE_DURATION_MS ||
      asset.assetId !==
        `chzzk-video-${sourceVideoNo}-${asset.participantId}-${asset.source.startMs}-${asset.source.endMs}` ||
      !isRecord(asset.provenance) ||
      !hasExactKeys(asset.provenance, [
        "sourceType",
        "sourceLocator",
        "note",
      ]) ||
      asset.provenance.sourceType !== "creator-published" ||
      asset.provenance.sourceLocator !== approvedSource.sourceLocator ||
      typeof asset.provenance.note !== "string" ||
      !isRecord(asset.consent) ||
      !hasExactKeys(asset.consent, ["status", "basis"]) ||
      asset.consent.status !== "unknown" ||
      typeof asset.consent.basis !== "string" ||
      !isRecord(asset.humanVerification) ||
      !hasExactKeys(asset.humanVerification, [
        "status",
        "verifierId",
        "verifiedAt",
        "note",
      ]) ||
      asset.humanVerification.status !== "pending" ||
      asset.humanVerification.verifierId !== null ||
      asset.humanVerification.verifiedAt !== null ||
      typeof asset.humanVerification.note !== "string" ||
      asset.embeddingModelRevision !== "speaker-embedding:unassigned" ||
      asset.assetRevision !== "candidate-v1"
    ) {
      fail("Pending participant voice enrollment asset is invalid.");
    }
    if (manifestVideoNo === null) {
      manifestVideoNo = sourceVideoNo;
      manifestApprovedSource = approvedSource;
    } else if (
      sourceVideoNo !== manifestVideoNo ||
      approvedSource !== manifestApprovedSource
    ) {
      fail("A pending manifest must contain assets from one approved source.");
    }
    assetIds.add(asset.assetId);
  }
  return value;
}

export function redactVoiceEnrollmentToolError(value) {
  return String(value)
    .replace(/https?:\/\/[^\s"'<>]+/gu, "[redacted-media-url]")
    .replace(
      /(hdntl|hdnts|token|sig|signature|expires?)=[^&\s"'<>]+/giu,
      "$1=[redacted]",
    );
}

export function parseVoiceEnrollmentCliArguments(arguments_) {
  const options = {
    recipePath: null,
    outputPath: null,
    ffmpegPath: null,
    help: false,
  };
  const seen = new Set();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    const mapping = {
      "--recipe": "recipePath",
      "--output": "outputPath",
      "--ffmpeg": "ffmpegPath",
    };
    const field = mapping[argument];
    if (field === undefined) {
      fail(`Unknown command-line argument: ${argument}`);
    }
    if (seen.has(field)) {
      fail(`${argument} may be supplied only once.`);
    }
    const value = arguments_[index + 1];
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.startsWith("--")
    ) {
      fail(`${argument} requires a value.`);
    }
    options[field] = value;
    seen.add(field);
    index += 1;
  }
  if (!options.help && options.recipePath === null) {
    fail("--recipe is required.");
  }
  return Object.freeze(options);
}
