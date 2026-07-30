import {
  CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_HEIGHT,
  CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_TARGET_ANCHORS,
  CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_WIDTH,
  createChannelPreanalysisVisualAnchorDescriptor,
  createChannelPreanalysisVisualFingerprint,
  hammingDistance64,
} from "../src/analysis/channelPreanalysisVisualFingerprint.ts";

export const STORYBOARD_SHEET_MAX_BYTES = 2 * 1024 * 1024;
export const STORYBOARD_MAX_SHEETS_PER_FINGERPRINT = 16;
export const STORYBOARD_FETCH_TIMEOUT_MS = 30_000;

const STORYBOARD_CANDIDATE_RADIUS_FRAMES = 2;
const MAX_STORYBOARD_FORMATS = 1_000;
const MAX_STORYBOARD_FRAGMENTS = 512;
const MIN_STORYBOARD_FRAME_WIDTH = 120;
const MIN_STORYBOARD_FRAME_HEIGHT = 68;
const MAX_STORYBOARD_FRAME_WIDTH = 640;
const MAX_STORYBOARD_FRAME_HEIGHT = 360;
const MIN_STORYBOARD_FPS = 0.01;
const MAX_STORYBOARD_FPS = 2;
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;

export class ChannelPreanalysisStoryboardError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "ChannelPreanalysisStoryboardError";
    this.code = code;
  }
}

/**
 * Extracts a bounded, distributed fingerprint directly from YouTube's
 * storyboard sheets. `null` means the metadata contains no usable storyboard,
 * so callers may continue without changing a pre-existing transcript result.
 */
export async function createVisualFingerprintFromYtDlpMetadata(
  metadata,
  {
    videoId,
    durationMs,
    createdAt,
    fetchImplementation = globalThis.fetch,
    decodeTile = decodeStoryboardTileWithSharp,
  },
) {
  if (!YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
    throw storyboardError("FINGERPRINT_ID_INVALID", "Video ID is invalid.");
  }
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs <= 0 ||
    durationMs > 12 * 60 * 60_000
  ) {
    throw storyboardError(
      "FINGERPRINT_DURATION_INVALID",
      "Video duration is invalid.",
    );
  }
  const format = selectYouTubeStoryboardFormat(metadata, videoId);
  if (format === null) return null;
  const candidates = createDistributedStoryboardCandidates(
    format,
    durationMs,
  );
  const sheetIndexes = [
    ...new Set(candidates.flatMap(({ frames }) =>
      frames.map(({ sheetIndex }) => sheetIndex),
    )),
  ];
  if (
    sheetIndexes.length === 0 ||
    sheetIndexes.length > STORYBOARD_MAX_SHEETS_PER_FINGERPRINT
  ) {
    throw storyboardError(
      "FINGERPRINT_STORYBOARD_BOUNDS",
      "Storyboard fingerprint requires too many sheets.",
    );
  }

  const sheets = new Map();
  await Promise.all(
    sheetIndexes.map(async (sheetIndex) => {
      const fragment = format.fragments[sheetIndex];
      if (fragment === undefined) {
        throw storyboardError(
          "FINGERPRINT_STORYBOARD_BOUNDS",
          "Storyboard sheet index is unavailable.",
        );
      }
      sheets.set(
        sheetIndex,
        await fetchStoryboardSheet(
          fragment.url,
          fetchImplementation,
        ),
      );
    }),
  );

  const decodedByFrameIndex = new Map();
  for (const bucket of candidates) {
    for (const frame of bucket.frames) {
      const sheet = sheets.get(frame.sheetIndex);
      if (sheet === undefined) {
        throw storyboardError(
          "FINGERPRINT_STORYBOARD_MISSING",
          "Storyboard sheet was not downloaded.",
        );
      }
      const luma = await decodeTile(sheet, {
        frameWidth: format.frameWidth,
        frameHeight: format.frameHeight,
        rows: format.rows,
        columns: format.columns,
        tileIndex: frame.tileIndex,
      });
      decodedByFrameIndex.set(
        frame.frameIndex,
        createChannelPreanalysisVisualAnchorDescriptor({
          timestampMs: frame.timestampMs,
          luma,
          width: CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_WIDTH,
          height: CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_HEIGHT,
        }),
      );
    }
  }

  const selected = [];
  for (const bucket of candidates) {
    const descriptors = bucket.frames
      .map(({ frameIndex }) => decodedByFrameIndex.get(frameIndex))
      .filter(Boolean)
      .sort(
        (left, right) =>
          right.edgeEnergy - left.edgeEnergy ||
          Math.abs(left.timestampMs - bucket.targetTimestampMs) -
            Math.abs(right.timestampMs - bucket.targetTimestampMs) ||
          left.timestampMs - right.timestampMs,
      );
    const distinct = descriptors.find((descriptor) =>
      selected.every(
        (prior) =>
          descriptor.dHash64 !== prior.dHash64 ||
          descriptor.blockHash64 !== prior.blockHash64,
      ),
    );
    const chosen = distinct ?? descriptors[0];
    if (chosen !== undefined) selected.push(chosen);
  }
  const anchors = selected
    .sort((left, right) => left.timestampMs - right.timestampMs)
    .filter(
      (anchor, index, values) =>
        index === 0 || anchor.timestampMs !== values[index - 1]?.timestampMs,
    );

  try {
    return createChannelPreanalysisVisualFingerprint({
      videoId,
      sourceDurationMs: durationMs,
      createdAt,
      anchors,
    });
  } catch (cause) {
    throw storyboardError(
      "FINGERPRINT_ANCHORS_INVALID",
      "Storyboard did not provide enough distinct, distributed anchors.",
      cause,
    );
  }
}

export function selectYouTubeStoryboardFormat(metadata, videoId) {
  if (
    !metadata ||
    typeof metadata !== "object" ||
    !Array.isArray(metadata.formats)
  ) {
    return null;
  }
  if (metadata.formats.length > MAX_STORYBOARD_FORMATS) {
    throw storyboardError(
      "FINGERPRINT_METADATA_TOO_LARGE",
      "yt-dlp returned too many formats.",
    );
  }
  const formats = metadata.formats
    .map((value) => normalizeStoryboardFormat(value, videoId))
    .filter(Boolean)
    .sort(
      (left, right) =>
        Math.abs(left.frameWidth - 160) -
          Math.abs(right.frameWidth - 160) ||
        Math.abs(left.frameHeight - 90) -
          Math.abs(right.frameHeight - 90) ||
        right.frameWidth - left.frameWidth ||
        left.formatId.localeCompare(right.formatId),
    );
  return formats[0] ?? null;
}

export function createDistributedStoryboardCandidates(
  format,
  durationMs,
) {
  const totalFrames = Math.max(
    1,
    Math.ceil((durationMs / 1_000) * format.fps),
  );
  const framesPerSheet = format.rows * format.columns;
  return Array.from(
    { length: CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_TARGET_ANCHORS },
    (_, bucketIndex) => {
      const fraction =
        (bucketIndex + 1) /
        (CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_TARGET_ANCHORS + 1);
      const targetFrameIndex = Math.min(
        totalFrames - 1,
        Math.max(0, Math.round((totalFrames - 1) * fraction)),
      );
      const targetSheetIndex = Math.floor(
        targetFrameIndex / framesPerSheet,
      );
      const frames = [];
      for (
        let delta = -STORYBOARD_CANDIDATE_RADIUS_FRAMES;
        delta <= STORYBOARD_CANDIDATE_RADIUS_FRAMES;
        delta += 1
      ) {
        const frameIndex = targetFrameIndex + delta;
        if (frameIndex < 0 || frameIndex >= totalFrames) continue;
        const sheetIndex = Math.floor(frameIndex / framesPerSheet);
        // A quality search must never turn one anchor into two network
        // downloads. The exact target sheet is the bounded unit of work.
        if (sheetIndex !== targetSheetIndex) continue;
        if (sheetIndex >= format.fragments.length) continue;
        frames.push({
          frameIndex,
          sheetIndex,
          tileIndex: frameIndex % framesPerSheet,
          timestampMs: Math.min(
            durationMs - 1,
            Math.round((frameIndex / format.fps) * 1_000),
          ),
        });
      }
      return {
        targetTimestampMs: Math.round(durationMs * fraction),
        frames,
      };
    },
  );
}

export function visualAnchorSeparation(left, right) {
  return (
    hammingDistance64(left.dHash64, right.dHash64) +
    hammingDistance64(left.blockHash64, right.blockHash64)
  );
}

async function fetchStoryboardSheet(url, fetchImplementation) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STORYBOARD_FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImplementation(url, {
      method: "GET",
      headers: { Accept: "image/jpeg" },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw storyboardError(
        "FINGERPRINT_STORYBOARD_HTTP",
        `Storyboard request failed with HTTP ${response.status}.`,
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!/^image\/jpeg(?:;|$)/iu.test(contentType)) {
      await response.body?.cancel().catch(() => undefined);
      throw storyboardError(
        "FINGERPRINT_STORYBOARD_TYPE",
        "Storyboard response is not JPEG.",
      );
    }
    const contentLength = response.headers.get("content-length");
    if (
      contentLength !== null &&
      (!/^\d+$/u.test(contentLength) ||
        Number(contentLength) > STORYBOARD_SHEET_MAX_BYTES)
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw storyboardError(
        "FINGERPRINT_STORYBOARD_TOO_LARGE",
        "Storyboard response is too large.",
      );
    }
    return await readBoundedResponse(response, STORYBOARD_SHEET_MAX_BYTES);
  } catch (cause) {
    if (cause instanceof ChannelPreanalysisStoryboardError) throw cause;
    throw storyboardError(
      cause?.name === "AbortError"
        ? "FINGERPRINT_STORYBOARD_TIMEOUT"
        : "FINGERPRINT_STORYBOARD_FETCH",
      "Storyboard request failed.",
      cause,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedResponse(response, maximumBytes) {
  if (response.body === null) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) {
      throw storyboardError(
        "FINGERPRINT_STORYBOARD_TOO_LARGE",
        "Storyboard response is too large.",
      );
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw storyboardError(
          "FINGERPRINT_STORYBOARD_TOO_LARGE",
          "Storyboard response is too large.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function decodeStoryboardTileWithSharp(sheetBytes, geometry) {
  let sharp;
  try {
    ({ default: sharp } = await import("sharp"));
  } catch (cause) {
    throw storyboardError(
      "FINGERPRINT_DECODER_UNAVAILABLE",
      "The pinned JPEG decoder is unavailable.",
      cause,
    );
  }
  const column = geometry.tileIndex % geometry.columns;
  const row = Math.floor(geometry.tileIndex / geometry.columns);
  if (row >= geometry.rows) {
    throw storyboardError(
      "FINGERPRINT_TILE_INVALID",
      "Storyboard tile is outside its sheet.",
    );
  }
  try {
    const { data, info } = await sharp(sheetBytes, {
      failOn: "error",
      limitInputPixels:
        geometry.frameWidth *
        geometry.columns *
        geometry.frameHeight *
        geometry.rows,
    })
      .extract({
        left: column * geometry.frameWidth,
        top: row * geometry.frameHeight,
        width: geometry.frameWidth,
        height: geometry.frameHeight,
      })
      .resize(
        CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_WIDTH,
        CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_HEIGHT,
        { fit: "fill", kernel: "lanczos3" },
      )
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (
      info.width !== CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_WIDTH ||
      info.height !== CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_HEIGHT ||
      info.channels !== 1 ||
      data.byteLength !==
        CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_WIDTH *
          CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_HEIGHT
    ) {
      throw new Error("Decoded luma dimensions are invalid.");
    }
    return new Uint8Array(data);
  } catch (cause) {
    throw storyboardError(
      "FINGERPRINT_STORYBOARD_DECODE",
      "Storyboard JPEG could not be decoded.",
      cause,
    );
  }
}

function normalizeStoryboardFormat(value, videoId) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.format_id !== "string" ||
    !/^sb\d{1,3}$/u.test(value.format_id) ||
    value.ext !== "mhtml" ||
    !Number.isSafeInteger(value.width) ||
    value.width < MIN_STORYBOARD_FRAME_WIDTH ||
    value.width > MAX_STORYBOARD_FRAME_WIDTH ||
    !Number.isSafeInteger(value.height) ||
    value.height < MIN_STORYBOARD_FRAME_HEIGHT ||
    value.height > MAX_STORYBOARD_FRAME_HEIGHT ||
    !Number.isSafeInteger(value.rows) ||
    value.rows < 1 ||
    value.rows > 10 ||
    !Number.isSafeInteger(value.columns) ||
    value.columns < 1 ||
    value.columns > 10 ||
    typeof value.fps !== "number" ||
    !Number.isFinite(value.fps) ||
    value.fps < MIN_STORYBOARD_FPS ||
    value.fps > MAX_STORYBOARD_FPS ||
    !Array.isArray(value.fragments) ||
    value.fragments.length < 1 ||
    value.fragments.length > MAX_STORYBOARD_FRAGMENTS
  ) {
    return null;
  }
  const fragments = value.fragments.map((fragment) => {
    if (
      !fragment ||
      typeof fragment !== "object" ||
      typeof fragment.url !== "string"
    ) {
      throw storyboardError(
        "FINGERPRINT_STORYBOARD_METADATA_INVALID",
        "Storyboard fragment is invalid.",
      );
    }
    let url;
    try {
      url = new URL(fragment.url);
    } catch (cause) {
      throw storyboardError(
        "FINGERPRINT_STORYBOARD_URL_INVALID",
        "Storyboard URL is invalid.",
        cause,
      );
    }
    if (
      url.protocol !== "https:" ||
      url.hostname !== "i.ytimg.com" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== "" ||
      !url.pathname.startsWith(`/sb/${videoId}/`) ||
      !url.pathname.endsWith(".jpg")
    ) {
      throw storyboardError(
        "FINGERPRINT_STORYBOARD_URL_INVALID",
        "Storyboard URL is outside the pinned YouTube image origin.",
      );
    }
    return { url: url.href };
  });
  return {
    formatId: value.format_id,
    frameWidth: value.width,
    frameHeight: value.height,
    rows: value.rows,
    columns: value.columns,
    fps: value.fps,
    fragments,
  };
}

function storyboardError(code, message, cause) {
  return new ChannelPreanalysisStoryboardError(
    code,
    message,
    cause === undefined ? {} : { cause },
  );
}
