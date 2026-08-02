import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  PINNED_YT_DLP_VERSION,
  artifactForBundle,
  createChannelPreanalysisRunReport,
  createSingleChannelPreanalysisRunReport,
  createEmptyCatalog,
  synchronizeChannelPreanalysisCatalog,
  synchronizeConfiguredChannelCatalogs,
  validateYtDlpMetadata,
} from "./sync-amoretto-preanalysis.mjs";
import {
  CHANNEL_PREANALYSIS_SOURCES,
  COCO_CHANNEL_PREANALYSIS_SOURCE,
} from "../src/analysis/channelPreanalysisSources.ts";

const NOW = "2026-08-02T03:00:00.000Z";
const VIDEO_ID = "KzAW3yow80Q";

test("every configured source owns an isolated catalog and artifact namespace", () => {
  for (const source of CHANNEL_PREANALYSIS_SOURCES) {
    const catalog = createEmptyCatalog(NOW, source);
    assert.equal(catalog.channelId, source.channelId);
    assert.equal(catalog.channelHandle, source.channelHandle);
    const artifact = artifactForBundle(
      VIDEO_ID,
      "{}\n",
      NOW,
      1,
      source,
    );
    assert.equal(
      artifact.storageKey,
      `${source.sourceId}/videos/${VIDEO_ID}.v1.json`,
    );
  }
});

test("completed live replays are accepted only for the live-stream source", () => {
  const metadata = {
    id: VIDEO_ID,
    channel_id: COCO_CHANNEL_PREANALYSIS_SOURCE.channelId,
    title: "완료된 다시보기",
    duration: 3_600,
    availability: "public",
    live_status: "was_live",
  };
  assert.equal(
    validateYtDlpMetadata(
      metadata,
      VIDEO_ID,
      COCO_CHANNEL_PREANALYSIS_SOURCE,
    ).liveStatus,
    "was_live",
  );
  const nonLiveSource = CHANNEL_PREANALYSIS_SOURCES.find(
    ({ playlistKind }) => playlistKind === "long-form-uploads",
  );
  assert.ok(nonLiveSource);
  assert.throws(
    () =>
      validateYtDlpMetadata(
        { ...metadata, channel_id: nonLiveSource.channelId },
        VIDEO_ID,
        nonLiveSource,
      ),
    /completed, non-live/u,
  );
});

test("the five-source coordinator shares one global two-video budget", async () => {
  const calls = [];
  const result = await synchronizeConfiguredChannelCatalogs(
    {
      catalogDir: "D:/catalog",
      ytDlpPath: "test-path-yt-dlp",
      maxVideos: 2,
      videoId: null,
      contextProxyUrl: null,
      contextAuthorizationToken: null,
    },
    {
      now: () => new Date(NOW),
      commandRunner: async (_command, arguments_) => {
        assert.deepEqual(arguments_, ["--version"]);
        return { stdout: `${PINNED_YT_DLP_VERSION}\n`, stderr: "" };
      },
      sourceSynchronizer: async (options) => {
        calls.push(options);
        const selectedVideoIds = options.discoveryOnly
          ? []
          : [`${options.configuredSource.sourceId}`.slice(0, 11).padEnd(11, "0")];
        return {
          manifest: { channelId: options.configuredSource.channelId },
          selectedVideoIds,
          selectedVideos: selectedVideoIds.map((videoId) => ({
            videoId,
            retry: null,
          })),
          outcomes: selectedVideoIds.map((videoId) => ({
            videoId,
            state: "transcript-ready",
          })),
        };
      },
      snapshotVerifier: async (_catalogDir, source) => ({
        channelId: source.channelId,
      }),
    },
  );

  assert.equal(result.processedVideoCount, 2);
  assert.equal(
    result.sources.flatMap(({ selectedVideoIds }) => selectedVideoIds).length,
    2,
  );
  assert.equal(calls.length, CHANNEL_PREANALYSIS_SOURCES.length);
  assert.equal(
    new Set(calls.map(({ configuredSource }) => configuredSource.sourceId)).size,
    CHANNEL_PREANALYSIS_SOURCES.length,
  );
  assert.equal(calls.filter(({ discoveryOnly }) => !discoveryOnly).length, 2);
});

test("one source discovery failure does not discard healthy sibling work", async () => {
  const failedSourceId = CHANNEL_PREANALYSIS_SOURCES[1].sourceId;
  const result = await synchronizeConfiguredChannelCatalogs(
    {
      catalogDir: "D:/catalog",
      ytDlpPath: "test-path-yt-dlp",
      maxVideos: 1,
      videoId: null,
      contextProxyUrl: null,
      contextAuthorizationToken: null,
    },
    {
      now: () => new Date(NOW),
      commandRunner: async () => ({
        stdout: `${PINNED_YT_DLP_VERSION}\n`,
        stderr: "",
      }),
      sourceSynchronizer: async (options) => {
        if (options.configuredSource.sourceId === failedSourceId) {
          const error = new Error("temporary feed failure");
          error.code = "FEED_HTTP_ERROR";
          throw error;
        }
        return {
          manifest: { channelId: options.configuredSource.channelId },
          selectedVideoIds: options.discoveryOnly ? [] : [VIDEO_ID],
          selectedVideos: options.discoveryOnly
            ? []
            : [{ videoId: VIDEO_ID, retry: null }],
          outcomes: options.discoveryOnly
            ? []
            : [{ videoId: VIDEO_ID, state: "transcript-ready" }],
        };
      },
      snapshotVerifier: async (_catalogDir, source) => ({
        channelId: source.channelId,
      }),
    },
  );

  assert.equal(result.processedVideoCount, 1);
  assert.deepEqual(result.sourceErrors.map(({ sourceId }) => sourceId), [
    failedSourceId,
  ]);
  assert.equal(
    result.sources.filter(({ manifest }) => manifest !== null).length,
    CHANNEL_PREANALYSIS_SOURCES.length,
  );
  const report = createChannelPreanalysisRunReport(
    result,
    "2026-08-02T03:05:00.000Z",
  );
  assert.equal(report.status, "partial");
  assert.deepEqual(report.sourceErrors, result.sourceErrors);
});

test("a first-run feed outage leaves a valid empty source checkpoint", async () => {
  const source = CHANNEL_PREANALYSIS_SOURCES.find(
    ({ sourceId }) => sourceId === "eureka-history",
  );
  assert.ok(source);
  const catalogDir = await mkdtemp(
    join(tmpdir(), "exclipper-channel-checkpoint-"),
  );

  try {
    await assert.rejects(
      synchronizeChannelPreanalysisCatalog(
        {
          configuredSource: source,
          catalogDir,
          ytDlpPath: "unused-in-test",
          maxVideos: 1,
          videoId: null,
          contextProxyUrl: null,
          contextAuthorizationToken: null,
        },
        {
          now: () => new Date(NOW),
          skipYtDlpVerification: true,
          fetch: async () => {
            throw new Error("feed offline");
          },
        },
      ),
      (error) => error?.code === "FEED_FETCH_FAILED",
    );

    const checkpoint = JSON.parse(
      await readFile(join(catalogDir, "catalog.json"), "utf8"),
    );
    assert.equal(checkpoint.channelId, source.channelId);
    assert.equal(checkpoint.channelHandle, source.channelHandle);
    assert.deepEqual(checkpoint.videos, []);
    assert.deepEqual(checkpoint.artifacts, []);
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});

test("an all-source run remains partial while any video has retryable work", () => {
  const report = createChannelPreanalysisRunReport(
    {
      runStartedAt: NOW,
      globalLimit: 1,
      processedVideoCount: 1,
      sourceErrors: [],
      sources: [{
        sourceId: "amoretto-vods",
        manifest: { revision: 4 },
        selectedVideoIds: [VIDEO_ID],
        outcomes: [{
          videoId: VIDEO_ID,
          state: "retryable",
          errorCode: "UPSTREAM_INVALID_RESPONSE",
        }],
      }],
    },
    "2026-08-02T03:05:00.000Z",
  );

  assert.equal(report.status, "partial");
});

test("a single-source dispatch emits the same root-level report contract", () => {
  const source = CHANNEL_PREANALYSIS_SOURCES.find(
    ({ sourceId }) => sourceId === "mangjing-compilations",
  );
  assert.ok(source);
  const result = {
    manifest: { revision: 3 },
    selectedVideoIds: [VIDEO_ID],
    outcomes: [{ videoId: VIDEO_ID, state: "transcript-ready" }],
  };
  const report = createSingleChannelPreanalysisRunReport(
    result,
    source,
    1,
    NOW,
    "2026-08-02T03:05:00.000Z",
  );

  assert.equal(report.mode, "single");
  assert.equal(report.status, "complete");
  assert.equal(report.globalLimit, 1);
  assert.equal(report.processedVideoCount, 1);
  assert.deepEqual(report.sources, [
    {
      sourceId: source.sourceId,
      catalogRevision: 3,
      selectedVideoIds: [VIDEO_ID],
      outcomes: result.outcomes,
    },
  ]);
  assert.deepEqual(report.sourceErrors, []);
});

test("a single-source run remains partial while its exact video is retryable", () => {
  const source = CHANNEL_PREANALYSIS_SOURCES.find(
    ({ sourceId }) => sourceId === "amoretto-vods",
  );
  assert.ok(source);
  const report = createSingleChannelPreanalysisRunReport(
    {
      manifest: { revision: 4 },
      selectedVideoIds: [VIDEO_ID],
      outcomes: [{
        videoId: VIDEO_ID,
        state: "retryable",
        errorCode: "UPSTREAM_INVALID_RESPONSE",
      }],
    },
    source,
    1,
    NOW,
    "2026-08-02T03:05:00.000Z",
  );

  assert.equal(report.status, "partial");
});
