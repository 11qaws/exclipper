import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
} from "../src/analysis/channelPreanalysisSources.ts";
import {
  CHANNEL_PREANALYSIS_RUN_REPORT_FILE,
  createEmptyCatalog,
} from "./sync-amoretto-preanalysis.mjs";
import { CHANNEL_PREANALYSIS_REVIEW_RUN_REPORT_FILENAME } from "./sync-channel-preanalysis-reviews.mjs";
import {
  CHANNEL_PREANALYSIS_UPLOAD_PREFLIGHT_REPORT_FILENAME,
  parseChannelPreanalysisUploadPreflightArguments,
  runChannelPreanalysisUploadPreflight,
  selectChannelPreanalysisUploadPreflightDueWork,
} from "./channel-preanalysis-upload-preflight.mjs";

const SOURCE = AMORETTO_CHANNEL_PREANALYSIS_SOURCE;
const NOW = "2026-08-02T12:00:00.000Z";
const PUBLISHED_AT = "2026-08-02T09:00:00.000Z";

function transcriptArtifact(videoId) {
  return {
    artifactId: `youtube-caption-bundle:${videoId}:v1`,
    videoId,
    kind: "transcript",
    revision: 1,
    storageKey: `${SOURCE.sourceId}/videos/${videoId}.v1.json`,
    contentDigest: `sha256:${"a".repeat(64)}`,
    byteLength: 512,
    createdAt: PUBLISHED_AT,
  };
}

function catalogVideo(videoId, state, retry = null) {
  const needsTranscript =
    state === "transcript-ready" ||
    state === "context-ready" ||
    (state === "retryable" && ["context", "review"].includes(retry?.stage));
  return {
    channelId: SOURCE.channelId,
    videoId,
    title: "방송",
    normalizedTitle: "방송",
    durationMs: 3_600_000,
    publishedAt: PUBLISHED_AT,
    updatedAt: PUBLISHED_AT,
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
    state,
    revision: 1,
    artifactIds: needsTranscript
      ? [transcriptArtifact(videoId).artifactId]
      : [],
    registeredLocalSampledFingerprints: [],
    retry,
  };
}

function manifestWith(video) {
  return {
    ...createEmptyCatalog(NOW, SOURCE),
    videos: [video],
    artifacts: video.artifactIds.length === 0
      ? []
      : [transcriptArtifact(video.videoId)],
  };
}

function retry(stage, lastSuccessfulState, nextAttemptAt = NOW) {
  return {
    stage,
    lastSuccessfulState,
    attemptCount: 1,
    nextAttemptAt,
    errorCode: `${stage.toUpperCase()}_FAILED`,
  };
}

function atomFeed(videoId) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"
      xmlns:media="http://search.yahoo.com/mrss/"
      xmlns="http://www.w3.org/2005/Atom">
  <link rel="self" href="${SOURCE.feedUrl}"/>
  <id>yt:channel:${SOURCE.channelId}</id>
  <yt:channelId>${SOURCE.channelId}</yt:channelId>
  <title>Amoretto VODs</title>
  <author><name>Amoretto VODs</name><uri>${SOURCE.channelUrl}</uri></author>
  <published>2024-01-01T00:00:00+00:00</published>
  <entry>
    <id>yt:video:${videoId}</id>
    <yt:videoId>${videoId}</yt:videoId>
    <yt:channelId>${SOURCE.channelId}</yt:channelId>
    <title>새 방송</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=${videoId}"/>
    <author><name>Amoretto VODs</name><uri>${SOURCE.channelUrl}</uri></author>
    <published>${PUBLISHED_AT}</published>
    <updated>${PUBLISHED_AT}</updated>
    <media:group>
      <media:content url="https://www.youtube.com/v/${videoId}?version=3" duration="3600"/>
    </media:group>
  </entry>
</feed>`;
}

test("parses the bounded lightweight preflight CLI", () => {
  const parsed = parseChannelPreanalysisUploadPreflightArguments(
    ["--catalog-dir", "catalog", "--source", SOURCE.sourceId, "--max-videos", "1"],
    { cwd: "C:/work" },
  );
  assert.equal(parsed.source, SOURCE);
  assert.equal(parsed.maxVideos, 1);
  assert.throws(
    () => parseChannelPreanalysisUploadPreflightArguments(["--max-videos", "3"]),
    /between 1 and 2/u,
  );
});

test("treats due context and review retries as heavy work", () => {
  const contextRetry = catalogVideo(
    "CtxRetry001",
    "retryable",
    retry("context", "transcript-ready"),
  );
  assert.deepEqual(
    selectChannelPreanalysisUploadPreflightDueWork(
      manifestWith(contextRetry),
      { nowIso: NOW, maxVideos: 2 },
    ),
    [{ videoId: contextRetry.videoId, reasons: ["context-retry"] }],
  );

  const reviewRetry = catalogVideo(
    "RevRetry001",
    "retryable",
    retry("review", "context-ready"),
  );
  assert.deepEqual(
    selectChannelPreanalysisUploadPreflightDueWork(
      manifestWith(reviewRetry),
      { nowIso: NOW, maxVideos: 2 },
    ),
    [{ videoId: reviewRetry.videoId, reasons: ["review-retry"] }],
  );
});

test("treats a context-ready video without a review bundle as heavy work", () => {
  const video = catalogVideo("ReviewMiss1", "context-ready");
  const due = selectChannelPreanalysisUploadPreflightDueWork(
    manifestWith(video),
    { nowIso: NOW, maxVideos: 2 },
  );
  assert.equal(due[0]?.videoId, video.videoId);
  assert.ok(due[0]?.reasons.includes("review-missing"));
});

test("does not queue automatic work for a video older than seven days", () => {
  const expired = {
    ...catalogVideo("Expired0001", "context-ready"),
    publishedAt: "2026-07-26T11:59:59.999Z",
  };
  assert.deepEqual(
    selectChannelPreanalysisUploadPreflightDueWork(manifestWith(expired), {
      nowIso: NOW,
      maxVideos: 2,
    }),
    [],
  );
});

test("discovers a new upload in the catalog before requesting heavy work", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "exclipper-upload-preflight-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const videoId = "NewVideo001";
  const report = await runChannelPreanalysisUploadPreflight(
    { catalogRoot: root, source: SOURCE, maxVideos: 2 },
    {
      now: () => new Date(NOW),
      fetch: async () => new Response(atomFeed(videoId), { status: 200 }),
      log: { info() {}, warn() {} },
    },
  );

  assert.equal(report.heavyRequired, true);
  assert.equal(report.dueVideoCount, 1);
  const catalog = JSON.parse(
    await readFile(join(root, SOURCE.sourceId, "catalog.json"), "utf8"),
  );
  assert.equal(catalog.videos[0]?.videoId, videoId);
  assert.equal(catalog.videos[0]?.state, "discovered");
  const persistedReport = JSON.parse(
    await readFile(
      join(root, CHANNEL_PREANALYSIS_UPLOAD_PREFLIGHT_REPORT_FILENAME),
      "utf8",
    ),
  );
  assert.equal(persistedReport.heavyRequired, true);
});

test("writes complete no-work reports when every catalog is already current", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "exclipper-upload-no-work-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const report = await runChannelPreanalysisUploadPreflight(
    { catalogRoot: root, source: SOURCE, maxVideos: 2 },
    {
      now: () => new Date(NOW),
      synchronizeSource: async () => ({
        manifest: createEmptyCatalog(NOW, SOURCE),
      }),
      log: { info() {}, warn() {} },
    },
  );
  assert.equal(report.heavyRequired, false);
  for (const filename of [
    CHANNEL_PREANALYSIS_RUN_REPORT_FILE,
    CHANNEL_PREANALYSIS_REVIEW_RUN_REPORT_FILENAME,
  ]) {
    const persisted = JSON.parse(await readFile(join(root, filename), "utf8"));
    assert.equal(persisted.status, "complete");
    assert.equal(persisted.processedVideoCount ?? persisted.selectedVideoCount, 0);
  }
});

test("a 30-minute scan queues serial heavy work while manual runs can force it", async () => {
  const heavyWorkflow = await readFile(
    new URL("../.github/workflows/channel-preanalysis.yml", import.meta.url),
    "utf8",
  );
  const scanWorkflow = await readFile(
    new URL("../.github/workflows/channel-preanalysis-scan.yml", import.meta.url),
    "utf8",
  );
  assert.match(scanWorkflow, /cron:\s*"17,47 \* \* \* \*"/u);
  assert.doesNotMatch(heavyWorkflow, /^\s{2}schedule:/mu);
  assert.match(heavyWorkflow, /group:\s*channel-preanalysis-heavy-queue/u);
  assert.match(heavyWorkflow, /queue:\s*max/u);
  assert.match(
    heavyWorkflow,
    /if \[\[ "\$\{FORCE_HEAVY\}" == "true" \]\]; then\s+heavy_required="true"/u,
  );
  assert.match(scanWorkflow, /actions:\s*write/u);
  assert.match(scanWorkflow, /gh workflow run channel-preanalysis\.yml/u);
  assert.match(scanWorkflow, /-f force_heavy=false/u);
  assert.match(heavyWorkflow, /actions:\s*write/u);
  assert.match(heavyWorkflow, /Continue draining any due queue/u);
  assert.match(heavyWorkflow, /gh workflow run channel-preanalysis-scan\.yml/u);
  assert.match(
    heavyWorkflow,
    /run-name:\s*"Prepare channel queue .*inputs\.queue_video_ids/u,
  );
  assert.match(
    heavyWorkflow,
    /\^\[A-Za-z0-9_-\]\{11\}\(,\[A-Za-z0-9_-\]\{11\}\)\{0,1\}\$/u,
  );
  assert.match(scanWorkflow, /\]\.slice\(0, 2\);/u);
  assert.match(scanWorkflow, /queue_video_ids=\$\{queueVideoIds\.join\(","\)\}/u);
  assert.match(scanWorkflow, /-f queue_video_ids="\$\{QUEUE_VIDEO_IDS\}"/u);
  for (const stepName of [
    "Verify channel sync and visual fingerprint contracts",
    "Download and verify pinned yt-dlp",
    "Route YouTube requests through Cloudflare WARP",
    "Reconcile feed and prepare due transcripts",
    "Prepare complete review-ready bundles",
  ]) {
    assert.match(
      heavyWorkflow,
      new RegExp(
        `- name: ${stepName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s+if: steps\\.upload-preflight\\.outputs\\.heavy_required == 'true'`,
        "u",
      ),
    );
  }
  assert.match(heavyWorkflow, /Require review-ready Worker credentials/u);
  assert.match(
    heavyWorkflow,
    /apt-get install -y --no-install-recommends cloudflare-warp ffmpeg/u,
  );
  assert.doesNotMatch(heavyWorkflow, /"status": "disabled"/u);
  assert.match(heavyWorkflow, /EXPECTED_BASE_SHA: \$\{\{ needs\.prepare\.outputs\.catalog_base_sha \}\}/u);
  assert.match(heavyWorkflow, /include-hidden-files:\s*true/u);
});
