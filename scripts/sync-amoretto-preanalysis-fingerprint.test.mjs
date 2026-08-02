import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import sharp from "sharp";

import {
  AMORETTO_YOUTUBE_CHANNEL_FEED_URL,
  AMORETTO_YOUTUBE_CHANNEL_ID,
} from "../src/analysis/channelPreanalysisCatalog.ts";
import {
  BROADCAST_CONTEXT_SCHEMA_VERSION,
  calculateCoverage,
} from "../src/analysis/broadcastContextProtocol.ts";
import { AI_BROADCAST_CONTEXT_ROUTING_REVISION } from "../src/analysis/aiModelRoutingPolicy.ts";
import {
  fetchChannelPreanalysisVisualFingerprint,
  fetchChannelPreanalysisVisualFingerprintForLookup,
  parseChannelPreanalysisManifest,
  requestChannelPreanalysisMatch,
} from "../src/analysis/channelPreanalysisClient.ts";
import {
  buildChannelPreanalysisLocalVisualSamplingPlan,
  parseChannelPreanalysisVisualFingerprint,
} from "../src/analysis/channelPreanalysisVisualFingerprint.ts";
import {
  PINNED_YT_DLP_VERSION,
  PREANALYSIS_CONTEXT_ATTEMPT_HEADER,
  PREANALYSIS_CONTEXT_CONTRACT_HEADER,
  PREANALYSIS_CONTEXT_MODEL_ID_HEADER,
  PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER,
  PREANALYSIS_CONTEXT_PROXY_VERSION,
  PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER,
  createExpectedScheduledContextReceipt,
  synchronizeAmorettoCatalog,
} from "./sync-amoretto-preanalysis.mjs";

const VIDEO_ID = "KzAW3yow80Q";
const SOURCE = {
  videoId: VIDEO_ID,
  title: "2026 07 17 - 음식 토크",
  durationMs: 240_000,
  publishedAt: "2026-07-17T04:00:00.000Z",
  updatedAt: "2026-07-17T09:30:00.000Z",
  watchUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
};
const STORYBOARD_URL =
  `https://i.ytimg.com/sb/${VIDEO_ID}/storyboard3_L2/M0.jpg?sig=test`;
const CONTEXT_TOKEN = "fingerprint-context-token-0123456789";

test("transcript-only cron publishes a digest-verified transcript plus visual fingerprint", async () => {
  const catalogDir = await mkdtemp(
    join(tmpdir(), "exclipper-fingerprint-cron-"),
  );
  try {
    const storyboard = await syntheticStoryboard();
    const fetchImplementation = async (input) => {
      const url = String(input);
      if (url === AMORETTO_YOUTUBE_CHANNEL_FEED_URL) {
        return new Response(atomFeed(), {
          status: 200,
          headers: { "content-type": "application/atom+xml" },
        });
      }
      if (url === STORYBOARD_URL) {
        return new Response(storyboard, {
          status: 200,
          headers: {
            "content-type": "image/jpeg",
            "content-length": String(storyboard.byteLength),
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };
    const result = await synchronizeAmorettoCatalog(
      {
        catalogDir,
        ytDlpPath: "test-yt-dlp",
        maxVideos: 1,
        videoId: null,
      },
      {
        now: () => new Date("2026-07-30T00:00:00.000Z"),
        fetch: fetchImplementation,
        commandRunner: createCommandRunner(),
        log: { info() {}, warn() {} },
      },
    );

    assert.equal(result.outcomes[0]?.state, "transcript-ready");
    const serializedCatalog = await readFile(
      join(catalogDir, "catalog.json"),
      "utf8",
    );
    const manifest = parseChannelPreanalysisManifest(serializedCatalog);
    const video = manifest.videos[0];
    assert.ok(video);
    assert.equal(video.artifactIds.length, 2);
    assert.deepEqual(
      manifest.artifacts.map(({ kind }) => kind).sort(),
      ["fingerprint", "transcript"],
    );
    const fingerprintArtifact = manifest.artifacts.find(
      ({ kind }) => kind === "fingerprint",
    );
    assert.ok(fingerprintArtifact);
    const fingerprintText = await readFile(
      join(
        catalogDir,
        fingerprintArtifact.storageKey.replace("amoretto-vods/", ""),
      ),
      "utf8",
    );
    const fingerprint =
      parseChannelPreanalysisVisualFingerprint(fingerprintText);
    assert.equal(fingerprint.anchors.length, 12);
    assert.equal(
      buildChannelPreanalysisLocalVisualSamplingPlan(fingerprint).length,
      12,
    );

    const loaded = await fetchChannelPreanalysisVisualFingerprint(
      {
        source: "raw",
        baseUrl: "https://catalog.test/amoretto-vods/",
        manifest,
      },
      video,
      {
        fetchImplementation: async (input) => {
          assert.equal(
            String(input),
            `https://catalog.test/amoretto-vods/videos/${VIDEO_ID}.visual-fingerprint.v1.json`,
          );
          return new Response(fingerprintText, {
            status: 200,
            headers: {
              "content-type": "application/json",
              "content-length": String(
                new TextEncoder().encode(fingerprintText).byteLength,
              ),
            },
          });
        },
      },
    );
    assert.equal(loaded?.fingerprint.videoId, VIDEO_ID);
    assert.equal(loaded?.artifact.artifactId, fingerprintArtifact.artifactId);

    const lookupFetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/catalog.json")) {
        return new Response(serializedCatalog, { status: 200 });
      }
      if (
        url ===
        `https://raw.test/amoretto/videos/${VIDEO_ID}.visual-fingerprint.v1.json`
      ) {
        return new Response(fingerprintText, { status: 200 });
      }
      return new Response("unavailable", { status: 503 });
    };
    const probableLookup = await requestChannelPreanalysisMatch(
      { title: SOURCE.title, durationMs: SOURCE.durationMs },
      {
        rawBaseUrl: "https://raw.test/amoretto/",
        bundledBaseUrl: "https://bundled.test/amoretto/",
        fetchImplementation: lookupFetch,
      },
    );
    assert.equal(probableLookup.match.confidence, "probable");
    assert.equal(
      probableLookup.manifestBaseUrl,
      "https://raw.test/amoretto/",
    );
    assert.equal(
      (
        await fetchChannelPreanalysisVisualFingerprintForLookup(
          probableLookup,
          { fetchImplementation: lookupFetch },
        )
      )?.fingerprint.videoId,
      VIDEO_ID,
    );
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});

test("a failed storyboard preserves a loadable transcript and resumes only fingerprint work", async () => {
  const catalogDir = await mkdtemp(
    join(tmpdir(), "exclipper-fingerprint-retry-"),
  );
  try {
    const storyboard = await syntheticStoryboard();
    let storyboardAvailable = false;
    const fetchImplementation = async (input) => {
      const url = String(input);
      if (url === AMORETTO_YOUTUBE_CHANNEL_FEED_URL) {
        return new Response(atomFeed(), { status: 200 });
      }
      if (url === STORYBOARD_URL) {
        return storyboardAvailable
          ? new Response(storyboard, {
              status: 200,
              headers: { "content-type": "image/jpeg" },
            })
          : new Response("temporary", { status: 503 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };
    const first = await synchronizeAmorettoCatalog(
      {
        catalogDir,
        ytDlpPath: "test-yt-dlp",
        maxVideos: 1,
        videoId: null,
      },
      {
        now: () => new Date("2026-07-30T00:00:00.000Z"),
        fetch: fetchImplementation,
        commandRunner: createCommandRunner(),
        log: { info() {}, warn() {} },
      },
    );
    assert.equal(first.outcomes[0]?.errorCode, "FINGERPRINT_STORYBOARD_HTTP");
    assert.equal(first.manifest.videos[0]?.retry?.stage, "fingerprint");
    assert.equal(
      first.manifest.videos[0]?.retry?.lastSuccessfulState,
      "transcript-ready",
    );
    assert.deepEqual(
      first.manifest.artifacts.map(({ kind }) => kind),
      ["transcript"],
    );
    const retryCatalogText = await readFile(
      join(catalogDir, "catalog.json"),
      "utf8",
    );
    const transcriptArtifact = first.manifest.artifacts[0];
    assert.ok(transcriptArtifact);
    const transcriptText = await readFile(
      join(
        catalogDir,
        transcriptArtifact.storageKey.replace("amoretto-vods/", ""),
      ),
      "utf8",
    );
    const retryLookup = await requestChannelPreanalysisMatch(
      { videoId: VIDEO_ID },
      {
        rawBaseUrl: "https://retry.test/amoretto/",
        bundledBaseUrl: "https://unused.test/amoretto/",
        fetchImplementation: async (input) => {
          const url = String(input);
          if (url.endsWith("/catalog.json")) {
            return new Response(retryCatalogText, { status: 200 });
          }
          if (
            url ===
            `https://retry.test/amoretto/videos/${VIDEO_ID}.v1.json`
          ) {
            return new Response(transcriptText, { status: 200 });
          }
          return new Response("unavailable", { status: 503 });
        },
      },
    );
    assert.equal(retryLookup.bundleStatus, "loaded");
    assert.equal(retryLookup.bundle?.state, "transcript-ready");

    storyboardAvailable = true;
    const resumed = await synchronizeAmorettoCatalog(
      {
        catalogDir,
        ytDlpPath: "test-yt-dlp",
        maxVideos: 1,
        videoId: null,
      },
      {
        now: () => new Date("2026-07-30T04:00:00.000Z"),
        fetch: fetchImplementation,
        commandRunner: createCommandRunner(),
        log: { info() {}, warn() {} },
      },
    );
    assert.equal(resumed.outcomes[0]?.state, "transcript-ready");
    assert.equal(resumed.manifest.videos[0]?.retry, null);
    assert.deepEqual(
      resumed.manifest.artifacts.map(({ kind }) => kind).sort(),
      ["fingerprint", "transcript"],
    );
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});

test("context is durable and loadable before a failed fingerprint resumes alone", async () => {
  const catalogDir = await mkdtemp(
    join(tmpdir(), "exclipper-fingerprint-context-retry-"),
  );
  try {
    const storyboard = await syntheticStoryboard();
    let storyboardAvailable = false;
    let contextCalls = 0;
    const fetchImplementation = async (input, init) => {
      const url = String(input);
      if (url === AMORETTO_YOUTUBE_CHANNEL_FEED_URL) {
        return new Response(atomFeed(), { status: 200 });
      }
      if (url === STORYBOARD_URL) {
        return storyboardAvailable
          ? new Response(storyboard, {
              status: 200,
              headers: { "content-type": "image/jpeg" },
            })
          : new Response("temporary", { status: 503 });
      }
      if (new URL(url).pathname === "/v1/broadcast-context") {
        contextCalls += 1;
        return contextSuccessResponse(init);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };
    const options = {
      catalogDir,
      ytDlpPath: "test-yt-dlp",
      maxVideos: 1,
      videoId: null,
      contextProxyUrl: "https://context.test/v1/broadcast-context",
      contextAuthorizationToken: CONTEXT_TOKEN,
    };
    const first = await synchronizeAmorettoCatalog(options, {
      now: () => new Date("2026-07-30T00:00:00.000Z"),
      fetch: fetchImplementation,
      commandRunner: createCommandRunner(),
      log: { info() {}, warn() {} },
    });

    const firstVideo = first.manifest.videos[0];
    assert.equal(first.outcomes[0]?.errorCode, "FINGERPRINT_STORYBOARD_HTTP");
    assert.equal(firstVideo?.retry?.stage, "fingerprint");
    assert.equal(firstVideo?.retry?.lastSuccessfulState, "context-ready");
    assert.ok(contextCalls > 1);
    const completedContextCalls = contextCalls;
    assert.deepEqual(
      first.manifest.artifacts.map(({ kind }) => kind),
      ["transcript"],
    );
    assert.equal(first.manifest.artifacts[0]?.revision, 2);

    const retryCatalogText = await readFile(
      join(catalogDir, "catalog.json"),
      "utf8",
    );
    const contextText = await readFile(
      join(catalogDir, "videos", `${VIDEO_ID}.v2.json`),
      "utf8",
    );
    const retryLookup = await requestChannelPreanalysisMatch(
      { videoId: VIDEO_ID },
      {
        rawBaseUrl: "https://context-catalog.test/amoretto/",
        bundledBaseUrl: "https://unused.test/amoretto/",
        fetchImplementation: async (input) => {
          const url = String(input);
          if (url.endsWith("/catalog.json")) {
            return new Response(retryCatalogText, { status: 200 });
          }
          if (
            url ===
            `https://context-catalog.test/amoretto/videos/${VIDEO_ID}.v2.json`
          ) {
            return new Response(contextText, { status: 200 });
          }
          return new Response("unavailable", { status: 503 });
        },
      },
    );
    assert.equal(retryLookup.bundleStatus, "loaded");
    assert.equal(retryLookup.bundle?.state, "context-ready");

    storyboardAvailable = true;
    const resumed = await synchronizeAmorettoCatalog(options, {
      now: () => new Date("2026-07-30T04:00:00.000Z"),
      fetch: fetchImplementation,
      commandRunner: createCommandRunner(),
      log: { info() {}, warn() {} },
    });
    assert.equal(resumed.outcomes[0]?.state, "context-ready");
    assert.equal(resumed.manifest.videos[0]?.state, "context-ready");
    assert.equal(resumed.manifest.videos[0]?.retry, null);
    assert.deepEqual(
      resumed.manifest.artifacts.map(({ kind }) => kind).sort(),
      ["fingerprint", "transcript"],
    );
    assert.equal(
      resumed.manifest.artifacts.find(({ kind }) => kind === "transcript")
        ?.revision,
      2,
    );
    assert.equal(contextCalls, completedContextCalls);
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});

async function syntheticStoryboard() {
  const width = 160 * 5;
  const height = 90 * 5;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tile = Math.floor(y / 90) * 5 + Math.floor(x / 160);
      const index = (y * width + x) * 3;
      pixels[index] = (x * (tile + 3) + y * 7) % 256;
      pixels[index + 1] = (x * 5 + y * (tile + 11)) % 256;
      pixels[index + 2] = (x * 13 + y * 3 + tile * 29) % 256;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 82 })
    .toBuffer();
}

function contextSuccessResponse(init) {
  const request = JSON.parse(String(init?.body));
  const expected = createExpectedScheduledContextReceipt(
    request.analysisMode,
  );
  return Response.json(
    {
      schemaVersion: BROADCAST_CONTEXT_SCHEMA_VERSION,
      broadcastSummaryKo:
        "스트리머가 음식 취향을 이야기하며 여러 메뉴에 반응하는 방송입니다.",
      hostStreamerProfile: null,
      recurringThemesKo: ["음식 취향", "메뉴 토크"],
      annotations: [],
      semanticChaptersSupported: request.analysisMode !== "discovery",
      semanticChapters: [],
      discoveredLeadsSupported: true,
      discoveredLeads: [],
      coverage: calculateCoverage(request.chapters, request.sourceDurationMs),
    },
    {
      headers: {
        [PREANALYSIS_CONTEXT_CONTRACT_HEADER]:
          PREANALYSIS_CONTEXT_PROXY_VERSION,
        [PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER]:
          AI_BROADCAST_CONTEXT_ROUTING_REVISION,
        [PREANALYSIS_CONTEXT_MODEL_ID_HEADER]:
          expected.modelId,
        [PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER]:
          expected.modelRevision,
        [PREANALYSIS_CONTEXT_ATTEMPT_HEADER]: "1",
      },
    },
  );
}

function atomFeed() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"
      xmlns:media="http://search.yahoo.com/mrss/"
      xmlns="http://www.w3.org/2005/Atom">
  <id>yt:channel:${AMORETTO_YOUTUBE_CHANNEL_ID}</id>
  <yt:channelId>${AMORETTO_YOUTUBE_CHANNEL_ID}</yt:channelId>
  <title>Amoretto VODs</title>
  <entry>
    <id>yt:video:${VIDEO_ID}</id>
    <yt:videoId>${VIDEO_ID}</yt:videoId>
    <yt:channelId>${AMORETTO_YOUTUBE_CHANNEL_ID}</yt:channelId>
    <title>${SOURCE.title}</title>
    <link rel="alternate" href="${SOURCE.watchUrl}"/>
    <published>${SOURCE.publishedAt}</published>
    <updated>${SOURCE.updatedAt}</updated>
    <media:group>
      <media:content url="https://www.youtube.com/v/${VIDEO_ID}?version=3"
                     duration="${SOURCE.durationMs / 1_000}"/>
    </media:group>
  </entry>
</feed>`;
}

function createCommandRunner() {
  return async (_command, arguments_) => {
    if (arguments_.length === 1 && arguments_[0] === "--version") {
      return { stdout: `${PINNED_YT_DLP_VERSION}\n`, stderr: "" };
    }
    if (arguments_.includes("--write-auto-subs")) {
      const pathsIndex = arguments_.indexOf("--paths");
      assert.notEqual(pathsIndex, -1);
      const outputDirectory = arguments_[pathsIndex + 1];
      await writeFile(
        join(outputDirectory, `${VIDEO_ID}.ko-orig.json3`),
        JSON.stringify({
          events: [
            {
              tStartMs: 1_000,
              dDurationMs: 2_000,
              segs: [{ utf8: "칼국수 이야기를 시작합니다." }],
            },
          ],
        }),
        "utf8",
      );
      return {
        stdout: JSON.stringify({
          id: VIDEO_ID,
          channel_id: AMORETTO_YOUTUBE_CHANNEL_ID,
          availability: "public",
          live_status: "not_live",
          title: SOURCE.title,
          duration: SOURCE.durationMs / 1_000,
          subtitles: {},
          automatic_captions: {
            "ko-orig": [{ ext: "json3" }],
          },
        }),
        stderr: "",
      };
    }
    if (arguments_.includes("--dump-single-json")) {
      return {
        stdout: JSON.stringify({
          id: VIDEO_ID,
          channel_id: AMORETTO_YOUTUBE_CHANNEL_ID,
          availability: "public",
          live_status: "not_live",
          title: SOURCE.title,
          duration: SOURCE.durationMs / 1_000,
          formats: [
            {
              format_id: "sb1",
              ext: "mhtml",
              width: 160,
              height: 90,
              rows: 5,
              columns: 5,
              fps: 0.1,
              fragments: [{ url: STORYBOARD_URL, duration: 240 }],
            },
          ],
        }),
        stderr: "",
      };
    }
    throw new Error(`Unexpected yt-dlp arguments: ${arguments_.join(" ")}`);
  };
}
