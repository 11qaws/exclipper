import assert from "node:assert/strict";
import test from "node:test";

import {
  createDistributedStoryboardCandidates,
  createVisualFingerprintFromYtDlpMetadata,
  selectYouTubeStoryboardFormat,
} from "./channel-preanalysis-visual-fingerprint.mjs";

const VIDEO_ID = "KzAW3yow80Q";
const DURATION_MS = 600_000;

function storyboardFormat(overrides = {}) {
  return {
    format_id: "sb1",
    ext: "mhtml",
    width: 160,
    height: 90,
    rows: 5,
    columns: 5,
    fps: 0.1,
    fragments: Array.from({ length: 3 }, (_, index) => ({
      url: `https://i.ytimg.com/sb/${VIDEO_ID}/storyboard3_L2/M${index}.jpg?sig=test`,
      duration: 250,
    })),
    ...overrides,
  };
}

function metadata(formats = [storyboardFormat()]) {
  return { id: VIDEO_ID, formats };
}

function luma(seed) {
  let state = (seed + 1) * 0x9e3779b1;
  return Uint8Array.from({ length: 32 * 18 }, (_, index) => {
    state = (Math.imul(state ^ index, 1_664_525) + 1_013_904_223) >>> 0;
    return ((state >>> 24) + index * (seed + 3)) % 256;
  });
}

test("selects the smallest useful, pinned YouTube storyboard", () => {
  const selected = selectYouTubeStoryboardFormat(
    metadata([
      storyboardFormat({
        format_id: "sb0",
        width: 320,
        height: 180,
      }),
      storyboardFormat(),
      {
        format_id: "18",
        ext: "mp4",
        width: 640,
        height: 360,
      },
    ]),
    VIDEO_ID,
  );
  assert.equal(selected?.formatId, "sb1");
  assert.equal(
    selectYouTubeStoryboardFormat({ formats: [] }, VIDEO_ID),
    null,
  );
});

test("creates twelve distributed anchors while fetching each sheet once", async () => {
  const requested = [];
  const result = await createVisualFingerprintFromYtDlpMetadata(metadata(), {
    videoId: VIDEO_ID,
    durationMs: DURATION_MS,
    createdAt: "2026-07-30T00:00:00.000Z",
    fetchImplementation: async (input) => {
      const url = new URL(String(input));
      requested.push(url.href);
      const sheet = Number(url.pathname.match(/M(\d+)\.jpg$/u)?.[1] ?? -1);
      return new Response(Uint8Array.of(sheet), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    },
    decodeTile: async (bytes, geometry) =>
      luma((bytes[0] ?? 0) * 25 + geometry.tileIndex),
  });

  assert.ok(result);
  assert.equal(result.anchors.length, 12);
  assert.ok(result.anchors[0].timestampMs < DURATION_MS * 0.2);
  assert.ok(result.anchors.at(-1).timestampMs > DURATION_MS * 0.8);
  assert.equal(new Set(requested).size, requested.length);
  assert.ok(requested.length <= 3);
});

test("keeps candidate work bounded and rejects a foreign image host", async () => {
  const format = selectYouTubeStoryboardFormat(metadata(), VIDEO_ID);
  assert.ok(format);
  const candidates = createDistributedStoryboardCandidates(
    format,
    DURATION_MS,
  );
  assert.equal(candidates.length, 12);
  assert.ok(candidates.every(({ frames }) => frames.length <= 5));

  const foreign = storyboardFormat({
    fragments: [
      {
        url: `https://example.com/sb/${VIDEO_ID}/storyboard.jpg`,
      },
    ],
  });
  assert.throws(
    () => selectYouTubeStoryboardFormat(metadata([foreign]), VIDEO_ID),
    (error) => error?.code === "FINGERPRINT_STORYBOARD_URL_INVALID",
  );
});

test("classifies malformed storyboard URLs as a fingerprint retry", () => {
  const malformed = storyboardFormat({
    fragments: [{ url: "not a URL" }],
  });
  assert.throws(
    () => selectYouTubeStoryboardFormat(metadata([malformed]), VIDEO_ID),
    (error) => error?.code === "FINGERPRINT_STORYBOARD_URL_INVALID",
  );
});

test("rejects oversized sheets before decoding", async () => {
  await assert.rejects(
    createVisualFingerprintFromYtDlpMetadata(metadata(), {
      videoId: VIDEO_ID,
      durationMs: DURATION_MS,
      createdAt: "2026-07-30T00:00:00.000Z",
      fetchImplementation: async () =>
        new Response(null, {
          status: 200,
          headers: {
            "content-type": "image/jpeg",
            "content-length": String(2 * 1024 * 1024 + 1),
          },
        }),
      decodeTile: async () => luma(1),
    }),
    (error) => error?.code === "FINGERPRINT_STORYBOARD_TOO_LARGE",
  );
});
