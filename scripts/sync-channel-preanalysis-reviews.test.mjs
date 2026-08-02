import assert from "node:assert/strict";
import test from "node:test";

import {
  AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
} from "../src/analysis/channelPreanalysisSources.ts";
import {
  CHANNEL_PREANALYSIS_REVIEW_PIPELINE_REVISION,
} from "./lib/channel-preanalysis-review-job.mjs";
import {
  deriveChannelPreanalysisCandidateEndpoint,
  parseChannelPreanalysisReviewArguments,
  runScheduledChannelPreanalysisReviews,
} from "./sync-channel-preanalysis-reviews.mjs";

const TOKEN = "scheduled-review-token-1234567890";

test("CLI derives the candidate route from the dedicated context Worker", () => {
  assert.equal(
    deriveChannelPreanalysisCandidateEndpoint(
      "https://exclipper-preanalysis.example.workers.dev/v1/broadcast-context",
    ),
    "https://exclipper-preanalysis.example.workers.dev/v1/candidate-insights",
  );
  const options = parseChannelPreanalysisReviewArguments(
    [
      "--source",
      "amoretto-vods",
      "--video-id",
      "KzAW3yow80Q",
      "--max-videos",
      "1",
    ],
    {
      cwd: "D:/workspace",
      environment: {
        CHANNEL_PREANALYSIS_CONTEXT_PROXY_URL:
          "https://exclipper-preanalysis.example.workers.dev/v1/broadcast-context",
        CHANNEL_PREANALYSIS_CONTEXT_TOKEN: TOKEN,
        RUNNER_TEMP: "D:/runner-temp",
      },
    },
  );
  assert.equal(options.source.sourceId, "amoretto-vods");
  assert.equal(options.videoId, "KzAW3yow80Q");
  assert.equal(
    options.candidateEndpoint,
    "https://exclipper-preanalysis.example.workers.dev/v1/candidate-insights",
  );
  assert.equal(options.authorizationToken, TOKEN);
  assert.deepEqual(
    parseChannelPreanalysisReviewArguments(["--help"], { environment: {} }),
    { help: true },
  );
});

test("all-source coordinator spends at most two global slots and never forwards secrets to yt-dlp", async () => {
  const calls = [];
  const analyzerOptions = [];
  const options = {
    source: null,
    videoId: null,
    maxVideos: 2,
    catalogRoot: "D:/catalog",
    workRoot: "D:/work",
    ytDlpPath: "yt-dlp-test",
    ffmpegPath: "ffmpeg-test",
    ffprobePath: "ffprobe-test",
    candidateEndpoint:
      "https://exclipper-preanalysis.example.workers.dev/v1/candidate-insights",
    authorizationToken: TOKEN,
  };
  const result = await runScheduledChannelPreanalysisReviews(options, {
    nowMs: Date.parse("2026-08-02T05:00:00.000Z"),
    environment: {
      PATH: "bounded-path",
      CHANNEL_PREANALYSIS_CONTEXT_TOKEN: "must-not-reach-child",
      GEMINI_API_KEY: "must-not-reach-child",
    },
    createAnalyzer: (configuration) => {
      analyzerOptions.push(configuration);
      return async () => ({ ok: true });
    },
    verifySnapshot: async () => {},
    runQueue: async (input) => {
      calls.push(input);
      assert.equal(input.ytDlpEnvironment.PATH, "bounded-path");
      assert.equal(input.ytDlpEnvironment.CHANNEL_PREANALYSIS_CONTEXT_TOKEN, undefined);
      assert.equal(input.ytDlpEnvironment.GEMINI_API_KEY, undefined);
      const analyzer = input.createCandidateAnalyzer({
        artifactRevision: 4,
        contextBundle: {
          videoId: "KzAW3yow80Q",
          durationMs: 120_000,
        },
        participantGrounding: { castRosterId: "exchange-student-main" },
      });
      assert.equal(typeof analyzer, "function");
      return {
        selectedVideoIds: [`video-${calls.length}`],
        outcomes: [{ state: "review-ready" }],
      };
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(new Set(calls.map(({ source }) => source.sourceId)).size, 2);
  assert.ok(calls.every(({ maxVideos }) => maxVideos === 1));
  assert.equal(result.selectedVideoCount, 2);
  assert.equal(result.status, "complete");
  assert.deepEqual(result.sourceErrors, []);
  assert.deepEqual(result.reviewErrors, []);
  assert.equal(analyzerOptions.length, 2);
  assert.ok(
    analyzerOptions.every(
      ({ endpointUrl, authorizationToken, artifactRevision }) =>
        endpointUrl === options.candidateEndpoint &&
        authorizationToken === TOKEN &&
        artifactRevision === 4,
    ),
  );
});

test("one source failure is reported after its valid checkpoint and other sources continue", async () => {
  const calls = [];
  const verified = [];
  const result = await runScheduledChannelPreanalysisReviews(
    {
      source: null,
      videoId: null,
      maxVideos: 1,
      catalogRoot: "D:/catalog",
      workRoot: "D:/work",
      ytDlpPath: "yt-dlp-test",
      ffmpegPath: "ffmpeg-test",
      ffprobePath: "ffprobe-test",
      candidateEndpoint:
        "https://exclipper-preanalysis.example.workers.dev/v1/candidate-insights",
      authorizationToken: TOKEN,
    },
    {
      nowMs: Date.parse("2026-08-02T05:00:00.000Z"),
      environment: { PATH: "bounded-path" },
      verifySnapshot: async (_path, source) => verified.push(source.sourceId),
      runQueue: async ({ source }) => {
        calls.push(source.sourceId);
        if (calls.length === 1) {
          const error = new Error("redacted source failure");
          error.code = "MEDIA_DOWNLOAD_FAILED";
          throw error;
        }
        return {
          selectedVideoIds: ["KzAW3yow80Q"],
          outcomes: [{ state: "review-ready", video: { videoId: "KzAW3yow80Q" } }],
        };
      },
    },
  );

  assert.equal(calls.length, 2);
  assert.deepEqual(verified, calls);
  assert.equal(result.status, "partial");
  assert.equal(result.selectedVideoCount, 1);
  assert.deepEqual(result.sourceErrors, [{
    sourceId: calls[0],
    errorCode: "MEDIA_DOWNLOAD_FAILED",
  }]);
});

test("an exact source can use both slots for one channel backlog", async () => {
  const calls = [];
  const result = await runScheduledChannelPreanalysisReviews(
    {
      source: AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
      videoId: null,
      maxVideos: 2,
      catalogRoot: "D:/catalog",
      workRoot: "D:/work",
      ytDlpPath: "yt-dlp-test",
      ffmpegPath: "ffmpeg-test",
      ffprobePath: "ffprobe-test",
      candidateEndpoint:
        "https://exclipper-preanalysis.example.workers.dev/v1/candidate-insights",
      authorizationToken: TOKEN,
    },
    {
      nowMs: Date.parse("2026-08-02T05:00:00.000Z"),
      environment: { PATH: "bounded-path" },
      verifySnapshot: async () => {},
      runQueue: async (input) => {
        calls.push(input);
        return { selectedVideoIds: ["one", "two"], outcomes: [] };
      },
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].maxVideos, 2);
  assert.equal(result.selectedVideoCount, 2);
});

test("retryable review outcomes make the persisted run contract partial", async () => {
  const result = await runScheduledChannelPreanalysisReviews(
    {
      source: AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
      videoId: "KzAW3yow80Q",
      maxVideos: 1,
      catalogRoot: "D:/catalog",
      workRoot: "D:/work",
      ytDlpPath: "yt-dlp-test",
      ffmpegPath: "ffmpeg-test",
      ffprobePath: "ffprobe-test",
      candidateEndpoint:
        "https://exclipper-preanalysis.example.workers.dev/v1/candidate-insights",
      authorizationToken: TOKEN,
    },
    {
      nowMs: Date.parse("2026-08-02T05:00:00.000Z"),
      environment: { PATH: "bounded-path" },
      verifySnapshot: async () => {},
      runQueue: async () => ({
        selectedVideoIds: ["KzAW3yow80Q"],
        outcomes: [{
          state: "retryable",
          errorCode: "CANDIDATE_PROVIDER_UNAVAILABLE",
          video: { videoId: "KzAW3yow80Q" },
        }],
      }),
    },
  );

  assert.equal(result.status, "partial");
  assert.deepEqual(result.reviewErrors, [{
    sourceId: "amoretto-vods",
    videoId: "KzAW3yow80Q",
    state: "retryable",
    errorCode: "CANDIDATE_PROVIDER_UNAVAILABLE",
  }]);
});

test("an exact video cannot report success before its context enters the review queue", async () => {
  const result = await runScheduledChannelPreanalysisReviews(
    {
      source: AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
      videoId: "KzAW3yow80Q",
      maxVideos: 1,
      catalogRoot: "D:/catalog",
      workRoot: "D:/work",
      ytDlpPath: "yt-dlp-test",
      ffmpegPath: "ffmpeg-test",
      ffprobePath: "ffprobe-test",
      candidateEndpoint:
        "https://exclipper-preanalysis.example.workers.dev/v1/candidate-insights",
      authorizationToken: TOKEN,
    },
    {
      nowMs: Date.parse("2026-08-02T05:00:00.000Z"),
      environment: { PATH: "bounded-path" },
      verifySnapshot: async () => {},
      runQueue: async () => ({ selectedVideoIds: [], outcomes: [] }),
    },
  );

  assert.equal(result.status, "partial");
  assert.equal(result.selectedVideoCount, 0);
  assert.deepEqual(result.reviewErrors, [{
    sourceId: "amoretto-vods",
    videoId: "KzAW3yow80Q",
    state: "retryable",
    errorCode: "REQUESTED_VIDEO_NOT_REVIEW_READY",
  }]);
});

test("an exact video already closed in the verified catalog cannot bypass the current run", async () => {
  const result = await runScheduledChannelPreanalysisReviews(
    {
      source: AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
      videoId: "KzAW3yow80Q",
      maxVideos: 1,
      catalogRoot: "D:/catalog",
      workRoot: "D:/work",
      ytDlpPath: "yt-dlp-test",
      ffmpegPath: "ffmpeg-test",
      ffprobePath: "ffprobe-test",
      candidateEndpoint:
        "https://exclipper-preanalysis.example.workers.dev/v1/candidate-insights",
      authorizationToken: TOKEN,
    },
    {
      nowMs: Date.parse("2026-08-02T05:00:00.000Z"),
      environment: { PATH: "bounded-path" },
      verifySnapshot: async () => ({
        videos: [{
          videoId: "KzAW3yow80Q",
          state: "review-ready",
          artifactIds: ["review-KzAW3yow80Q-r1"],
        }],
        artifacts: [{
          artifactId: "review-KzAW3yow80Q-r1",
          kind: "review",
        }],
      }),
      runQueue: async () => ({ selectedVideoIds: [], outcomes: [] }),
    },
  );

  assert.equal(result.status, "partial");
  assert.equal(result.selectedVideoCount, 0);
  assert.deepEqual(result.reviewErrors, [{
    sourceId: "amoretto-vods",
    videoId: "KzAW3yow80Q",
    state: "retryable",
    errorCode: "REQUESTED_VIDEO_NOT_REVIEW_READY",
  }]);
});

test("an exact video succeeds only with a selected current-pipeline outcome and verified closure", async () => {
  const result = await runScheduledChannelPreanalysisReviews(
    {
      source: AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
      videoId: "KzAW3yow80Q",
      maxVideos: 1,
      catalogRoot: "D:/catalog",
      workRoot: "D:/work",
      ytDlpPath: "yt-dlp-test",
      ffmpegPath: "ffmpeg-test",
      ffprobePath: "ffprobe-test",
      candidateEndpoint:
        "https://exclipper-preanalysis.example.workers.dev/v1/candidate-insights",
      authorizationToken: TOKEN,
    },
    {
      nowMs: Date.parse("2026-08-02T05:00:00.000Z"),
      environment: { PATH: "bounded-path" },
      verifySnapshot: async () => ({
        videos: [{
          videoId: "KzAW3yow80Q",
          state: "review-ready",
          artifactIds: ["review-KzAW3yow80Q-current"],
        }],
        artifacts: [{
          artifactId: "review-KzAW3yow80Q-current",
          kind: "review",
        }],
      }),
      runQueue: async () => ({
        selectedVideoIds: ["KzAW3yow80Q"],
        outcomes: [{
          state: "review-ready",
          video: { videoId: "KzAW3yow80Q" },
          reviewBundle: {
            certificate: {
              pipelineRevision: CHANNEL_PREANALYSIS_REVIEW_PIPELINE_REVISION,
            },
          },
        }],
      }),
    },
  );

  assert.equal(result.status, "complete");
  assert.equal(result.selectedVideoCount, 1);
  assert.deepEqual(result.reviewErrors, []);
});

test("an optimistic queue result cannot bypass the verified exact review closure", async () => {
  const result = await runScheduledChannelPreanalysisReviews(
    {
      source: AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
      videoId: "KzAW3yow80Q",
      maxVideos: 1,
      catalogRoot: "D:/catalog",
      workRoot: "D:/work",
      ytDlpPath: "yt-dlp-test",
      ffmpegPath: "ffmpeg-test",
      ffprobePath: "ffprobe-test",
      candidateEndpoint:
        "https://exclipper-preanalysis.example.workers.dev/v1/candidate-insights",
      authorizationToken: TOKEN,
    },
    {
      nowMs: Date.parse("2026-08-02T05:00:00.000Z"),
      environment: { PATH: "bounded-path" },
      verifySnapshot: async () => ({
        videos: [{
          videoId: "KzAW3yow80Q",
          state: "context-ready",
          artifactIds: [],
        }],
        artifacts: [],
      }),
      runQueue: async () => ({
        selectedVideoIds: ["KzAW3yow80Q"],
        outcomes: [{
          state: "review-ready",
          video: { videoId: "KzAW3yow80Q" },
        }],
      }),
    },
  );

  assert.equal(result.status, "partial");
  assert.deepEqual(result.reviewErrors, [{
    sourceId: "amoretto-vods",
    videoId: "KzAW3yow80Q",
    state: "retryable",
    errorCode: "REQUESTED_VIDEO_NOT_REVIEW_READY",
  }]);
});
