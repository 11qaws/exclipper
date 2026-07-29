import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertAllowedChzzkMediaUrl,
  assertPendingVoiceEnrollmentManifest,
  buildBoundedHlsMediaPlaylist,
  buildPendingVoiceEnrollmentManifest,
  candidateVoiceAudioFileName,
  parseEnrollmentTimecode,
  parseHlsMasterPlaylist,
  parseHlsMediaPlaylist,
  parseVoiceEnrollmentCliArguments,
  parseVoiceEnrollmentRecipe,
  redactVoiceEnrollmentToolError,
  selectLowestBandwidthVariant,
  VOICE_ENROLLMENT_APPROVED_SOURCES,
  VOICE_ENROLLMENT_RECIPE_SAFETY_ACKNOWLEDGEMENT,
} from "./lib/voice-enrollment-candidate.mjs";

const sampleRecipeUrl = new URL(
  "./voice-enrollment-recipes/chzzk-13996057.pending.json",
  import.meta.url,
);

async function sampleRecipe() {
  return parseVoiceEnrollmentRecipe(
    JSON.parse(await readFile(sampleRecipeUrl, "utf8")),
  );
}

test("parses the six explicitly pending source ranges", async () => {
  const recipe = await sampleRecipe();
  assert.equal(recipe.videoNo, "13996057");
  assert.deepEqual(
    recipe.ranges.map(({ participantId, startMs, endMs }) => [
      participantId,
      startMs,
      endMs,
    ]),
    [
      ["sera-professor", 150_000, 180_000],
      ["torori-coco", 560_000, 590_000],
      ["sena-arbel", 750_000, 780_000],
      ["mangjing", 950_000, 980_000],
      ["eureka", 1_620_000, 1_650_000],
      ["amoretto", 3_233_000, 3_265_000],
    ],
  );
  assert.equal(parseEnrollmentTimecode("12:00:00.000"), 43_200_000);
});

test("fails closed for a different source, missing acknowledgement, or unsafe range", async () => {
  const raw = JSON.parse(await readFile(sampleRecipeUrl, "utf8"));
  assert.throws(
    () => parseVoiceEnrollmentRecipe({ ...raw, videoNo: "13996058" }),
    /explicitly approved CHZZK videos/u,
  );
  assert.throws(
    () =>
      parseVoiceEnrollmentRecipe({
        ...raw,
        safetyAcknowledgement: "verified",
      }),
    /unverified voice candidate/u,
  );
  assert.throws(
    () =>
      parseVoiceEnrollmentRecipe({
        ...raw,
        ranges: [
          {
            ...raw.ranges[0],
            start: "00:02:30",
            end: "00:03:31",
          },
        ],
      }),
    /between 2 and 60 seconds/u,
  );
  assert.throws(
    () =>
      parseVoiceEnrollmentRecipe({
        ...raw,
        ranges: [{ ...raw.ranges[0], participantId: "outside-person" }],
      }),
    /not approved for CHZZK video/u,
  );
  assert.equal(
    raw.safetyAcknowledgement,
    VOICE_ENROLLMENT_RECIPE_SAFETY_ACKNOWLEDGEMENT,
  );
});

test("accepts each approved personal replay only for its roster participant", () => {
  const approved = [
    ["14415543", "eureka"],
    ["14423365", "sena-arbel"],
    ["14402822", "torori-coco"],
    ["14393572", "mangjing"],
  ];
  for (const [videoNo, participantId] of approved) {
    const raw = {
      schemaVersion: "1.0.0",
      tool: "exclipper.voice-enrollment-candidate-extractor",
      safetyAcknowledgement:
        VOICE_ENROLLMENT_RECIPE_SAFETY_ACKNOWLEDGEMENT,
      videoNo,
      sourceLocator: `https://chzzk.naver.com/video/${videoNo}`,
      manifestRevision: `personal-${videoNo}-pending-v1`,
      ranges: [
        {
          participantId,
          start: "00:01:00",
          end: "00:01:20",
          reviewNote: "개인 채널 발화 후보이며 사람의 검증 전에는 등록하지 않습니다.",
        },
      ],
    };
    assert.equal(parseVoiceEnrollmentRecipe(raw).videoNo, videoNo);
    assert.match(
      VOICE_ENROLLMENT_APPROVED_SOURCES[videoNo].expectedChannelId,
      /^[a-f0-9]{32}$/u,
    );
    assert.throws(
      () =>
        parseVoiceEnrollmentRecipe({
          ...raw,
          ranges: [{ ...raw.ranges[0], participantId: "amoretto" }],
        }),
      new RegExp(`not approved for CHZZK video ${videoNo}`, "u"),
    );
    assert.throws(
      () =>
        parseVoiceEnrollmentRecipe({
          ...raw,
          sourceLocator: "https://chzzk.naver.com/video/13996057",
        }),
      /sourceLocator must be/u,
    );
  }
});

test("selects the lowest-bandwidth HLS variant without exposing another origin", () => {
  const masterUrl =
    "https://media.example.akamaized.net/vod/master.m3u8?token=redacted";
  const variants = parseHlsMasterPlaylist(
    [
      "#EXTM3U",
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,CODECS="avc1,mp4a",RESOLUTION=1280x720',
      "720p/chunks.m3u8",
      '#EXT-X-STREAM-INF:BANDWIDTH=192000,CODECS="avc1,mp4a",RESOLUTION=256x144',
      "144p/chunks.m3u8",
      "",
    ].join("\n"),
    masterUrl,
  );
  const lowest = selectLowestBandwidthVariant(variants);
  assert.equal(lowest.bandwidth, 192_000);
  assert.equal(lowest.resolution, "256x144");
  assert.equal(
    lowest.url.href,
    "https://media.example.akamaized.net/vod/144p/chunks.m3u8",
  );
  assert.throws(
    () => assertAllowedChzzkMediaUrl("https://attacker.example/playlist.m3u8"),
    /allowed HTTPS CDN boundary/u,
  );
  assert.equal(
    assertAllowedChzzkMediaUrl(
      "https://ex-nlive-slitvod-streaming.navercdn.com/vod/master.m3u8",
    ).hostname,
    "ex-nlive-slitvod-streaming.navercdn.com",
  );
});

test("builds a mini-playlist containing only segments that cover the requested range", () => {
  const mediaUrl = "https://media.example.akamaized.net/vod/144p/chunks.m3u8";
  const media = parseHlsMediaPlaylist(
    [
      "#EXTM3U",
      "#EXT-X-VERSION:7",
      "#EXT-X-INDEPENDENT-SEGMENTS",
      "#EXT-X-TARGETDURATION:2",
      "#EXT-X-MEDIA-SEQUENCE:0",
      '#EXT-X-MAP:URI="init.m4s"',
      "#EXTINF:2.000,",
      "segment-0.m4v",
      "#EXTINF:2.000,",
      "segment-1.m4v",
      "#EXTINF:2.000,",
      "segment-2.m4v",
      "#EXTINF:2.000,",
      "segment-3.m4v",
      "#EXTINF:2.000,",
      "segment-4.m4v",
      "#EXT-X-ENDLIST",
      "",
    ].join("\n"),
    mediaUrl,
  );
  const bounded = buildBoundedHlsMediaPlaylist(media, 4_500, 7_500);

  assert.equal(bounded.playlistStartMs, 4_000);
  assert.equal(bounded.playlistEndMs, 8_000);
  assert.equal(bounded.seekOffsetMs, 500);
  assert.equal(bounded.selectedSegmentCount, 2);
  assert.match(bounded.playlistText, /segment-2\.m4v/u);
  assert.match(bounded.playlistText, /segment-3\.m4v/u);
  assert.doesNotMatch(bounded.playlistText, /segment-0\.m4v/u);
  assert.doesNotMatch(bounded.playlistText, /segment-1\.m4v/u);
  assert.doesNotMatch(bounded.playlistText, /segment-4\.m4v/u);
  assert.match(
    bounded.playlistText,
    /https:\/\/media\.example\.akamaized\.net\/vod\/144p\/init\.m4s/u,
  );
  assert.throws(
    () =>
      parseHlsMediaPlaylist(
        [
          "#EXTM3U",
          "#EXT-X-TARGETDURATION:2",
          '#EXT-X-MAP:BYTERANGE="100@0"',
          "#EXTINF:2.000,",
          "segment-0.m4v",
          "#EXT-X-ENDLIST",
        ].join("\n"),
        mediaUrl,
      ),
    /invalid URI attribute/u,
  );
});

test("creates only pending, unknown-consent, conservatively flagged manifest assets", async () => {
  const recipe = await sampleRecipe();
  const extracted = recipe.ranges.map((range, index) => ({
    participantId: range.participantId,
    startMs: range.startMs,
    endMs: range.endMs,
    contentSha256: `sha256:${(index + 1).toString(16).padStart(64, "0")}`,
  }));
  const manifest = buildPendingVoiceEnrollmentManifest(recipe, extracted);

  assert.equal(assertPendingVoiceEnrollmentManifest(manifest), manifest);
  assert.equal(manifest.assets.length, 6);
  for (const asset of manifest.assets) {
    assert.equal(asset.consent.status, "unknown");
    assert.equal(asset.humanVerification.status, "pending");
    assert.equal(asset.containsOverlappingSpeech, true);
    assert.equal(asset.containsMusic, true);
    assert.equal(asset.embeddingModelRevision, "speaker-embedding:unassigned");
  }
  assert.equal(
    candidateVoiceAudioFileName("13996057", recipe.ranges[0]),
    "chzzk-video-13996057-sera-professor-150000-180000.flac",
  );

  const unsafe = structuredClone(manifest);
  unsafe.assets[0].containsMusic = false;
  assert.throws(
    () => assertPendingVoiceEnrollmentManifest(unsafe),
    /asset is invalid/u,
  );
});

test("parses only explicit, non-duplicated CLI options", () => {
  assert.deepEqual(
    parseVoiceEnrollmentCliArguments([
      "--recipe",
      "recipe.json",
      "--output",
      "output",
      "--ffmpeg",
      "ffmpeg-custom",
    ]),
    {
      recipePath: "recipe.json",
      outputPath: "output",
      ffmpegPath: "ffmpeg-custom",
      help: false,
    },
  );
  assert.throws(
    () => parseVoiceEnrollmentCliArguments(["--output", "output"]),
    /--recipe is required/u,
  );
  assert.throws(
    () =>
      parseVoiceEnrollmentCliArguments([
        "--recipe",
        "one.json",
        "--recipe",
        "two.json",
      ]),
    /only once/u,
  );
  assert.throws(
    () => parseVoiceEnrollmentCliArguments(["--recipe", "one.json", "--force"]),
    /Unknown command-line argument/u,
  );
});

test("the CLI rejects output inside public before any network request", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL(
          "./extract-chzzk-voice-enrollment-candidates.mjs",
          import.meta.url,
        ),
      ),
      "--recipe",
      fileURLToPath(sampleRecipeUrl),
      "--output",
      fileURLToPath(
        new URL("../public/forbidden-voice-candidates", import.meta.url),
      ),
    ],
    {
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /outside public\//u);
});

test("redacts signed media URLs and standalone token values from errors", () => {
  const redacted = redactVoiceEnrollmentToolError(
    "GET https://media.example.akamaized.net/vod/hdntl=secret/segment.m4v?token=other failed; signature=third",
  );
  assert.doesNotMatch(redacted, /secret|other|third/u);
  assert.match(redacted, /\[redacted-media-url\]/u);
  assert.match(redacted, /signature=\[redacted\]/u);
});
