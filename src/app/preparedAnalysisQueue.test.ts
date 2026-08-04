import { describe, expect, it, vi } from "vitest";

import type { LoadedChannelPreanalysisManifest } from "../analysis/channelPreanalysisClient";
import type { ChannelPreanalysisCatalogVideo } from "../analysis/channelPreanalysisCatalog";
import {
  AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
  EUREKA_CHANNEL_PREANALYSIS_SOURCE,
  MANGJING_CHANNEL_PREANALYSIS_SOURCE,
  SENA_CHANNEL_PREANALYSIS_SOURCE,
  type ConfiguredChannelPreanalysisSource,
} from "../analysis/channelPreanalysisSources";
import {
  buildPreparedAnalysisQueue,
  fetchPreparedAnalysisWorkerSnapshot,
  parseWorkflowRunCount,
} from "./preparedAnalysisQueue";

const NOW = Date.parse("2026-08-04T12:00:00.000Z");

function video(
  source: ConfiguredChannelPreanalysisSource,
  videoId: string,
  state: ChannelPreanalysisCatalogVideo["state"],
  publishedAt: string,
  retry: ChannelPreanalysisCatalogVideo["retry"] = null,
): ChannelPreanalysisCatalogVideo {
  return {
    channelId: source.channelId,
    videoId,
    title: `${source.displayNameKo} ${videoId}`,
    normalizedTitle: `${source.displayNameKo} ${videoId}`,
    durationMs: 7_200_000,
    publishedAt,
    updatedAt: publishedAt,
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
    state,
    revision: 1,
    artifactIds: [],
    registeredLocalSampledFingerprints: [],
    retry,
  };
}

function loadedManifest(
  source: ConfiguredChannelPreanalysisSource,
  videos: readonly ChannelPreanalysisCatalogVideo[],
): LoadedChannelPreanalysisManifest {
  return {
    source: "raw",
    baseUrl: `https://catalog.test/${source.sourceId}/`,
    manifest: {
      schemaVersion: 1,
      channelId: source.channelId,
      channelHandle: source.channelHandle,
      revision: 1,
      generatedAt: new Date(NOW).toISOString(),
      videos,
      artifacts: [],
    },
  };
}

describe("prepared analysis queue", () => {
  it("shows only unfinished videos from the seven-day automatic window", () => {
    const queue = buildPreparedAnalysisQueue([
      loadedManifest(AMORETTO_CHANNEL_PREANALYSIS_SOURCE, [
        video(
          AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
          "aaaaaaaaaaa",
          "discovered",
          "2026-08-04T10:00:00.000Z",
        ),
        video(
          AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
          "bbbbbbbbbbb",
          "review-ready",
          "2026-08-04T09:00:00.000Z",
        ),
      ]),
      loadedManifest(EUREKA_CHANNEL_PREANALYSIS_SOURCE, [
        video(
          EUREKA_CHANNEL_PREANALYSIS_SOURCE,
          "ccccccccccc",
          "transcript-ready",
          "2026-08-03T10:00:00.000Z",
        ),
      ]),
      loadedManifest(SENA_CHANNEL_PREANALYSIS_SOURCE, [
        video(
          SENA_CHANNEL_PREANALYSIS_SOURCE,
          "ddddddddddd",
          "context-ready",
          "2026-07-27T10:00:00.000Z",
        ),
      ]),
      loadedManifest(MANGJING_CHANNEL_PREANALYSIS_SOURCE, [
        video(
          MANGJING_CHANNEL_PREANALYSIS_SOURCE,
          "eeeeeeeeeee",
          "retryable",
          "2026-08-02T10:00:00.000Z",
          {
            stage: "context",
            lastSuccessfulState: "transcript-ready",
            attemptCount: 1,
            nextAttemptAt: "2026-08-04T15:00:00.000Z",
            errorCode: "PROVIDER_BUSY",
          },
        ),
      ]),
    ], NOW);

    expect(queue.map(({ videoId }) => videoId)).toEqual([
      "aaaaaaaaaaa",
      "ccccccccccc",
      "eeeeeeeeeee",
    ]);
    expect(queue.map(({ phase }) => phase)).toEqual([
      "caption",
      "context",
      "context",
    ]);
    expect(queue.at(-1)).toMatchObject({ readyNow: false });
  });

  it("treats a review bundle awaiting only its fingerprint as ready", () => {
    const queue = buildPreparedAnalysisQueue([
      loadedManifest(AMORETTO_CHANNEL_PREANALYSIS_SOURCE, [
        video(
          AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
          "ffffffffff0",
          "retryable",
          "2026-08-04T10:00:00.000Z",
          {
            stage: "fingerprint",
            lastSuccessfulState: "review-ready",
            attemptCount: 1,
            nextAttemptAt: "2026-08-04T15:00:00.000Z",
            errorCode: "FINGERPRINT_RETRY",
          },
        ),
      ]),
    ], NOW);

    expect(queue).toEqual([]);
  });
});

describe("prepared analysis worker status", () => {
  it("reads active and queued counts from the public workflow endpoints", async () => {
    const fetchImplementation = vi.fn((input: RequestInfo | URL) => {
      const url = input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : input;
      return Promise.resolve(new Response(JSON.stringify({
        total_count: url.includes("status=in_progress") ? 1 : 2,
        workflow_runs: [{
          display_title: url.includes("status=in_progress")
            ? "Prepare channel queue · aaaaaaaaaaa,bbbbbbbbbbb"
            : "Prepare channel queue · ccccccccccc",
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }) as unknown as typeof fetch;

    await expect(fetchPreparedAnalysisWorkerSnapshot({
      fetchImplementation,
      now: () => NOW,
    })).resolves.toEqual({
      activeRunCount: 1,
      queuedRunCount: 2,
      activeVideoIds: ["aaaaaaaaaaa", "bbbbbbbbbbb"],
      queuedVideoIds: ["ccccccccccc"],
      checkedAt: "2026-08-04T12:00:00.000Z",
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed run counts", () => {
    expect(() => parseWorkflowRunCount({ total_count: -1 })).toThrow(TypeError);
    expect(() => parseWorkflowRunCount({ total_count: "1" })).toThrow(TypeError);
  });
});
