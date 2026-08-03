import { describe, expect, it } from "vitest";

import type { LoadedChannelPreanalysisManifest } from "../analysis/channelPreanalysisClient";
import {
  AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
  EUREKA_CHANNEL_PREANALYSIS_SOURCE,
  type ConfiguredChannelPreanalysisSource,
} from "../analysis/channelPreanalysisSources";
import { buildPreparedAnalysisLibraryGroups } from "./preparedAnalysisLibrary";

function loadedManifest(
  source: ConfiguredChannelPreanalysisSource,
  videos: LoadedChannelPreanalysisManifest["manifest"]["videos"],
): LoadedChannelPreanalysisManifest {
  return {
    source: "raw",
    baseUrl: `https://catalog.test/${source.sourceId}/`,
    manifest: {
      schemaVersion: 1,
      channelId: source.channelId,
      channelHandle: source.channelHandle,
      revision: 1,
      generatedAt: "2026-08-04T00:00:00.000Z",
      videos,
      artifacts: [],
    },
  };
}

function video(
  source: ConfiguredChannelPreanalysisSource,
  videoId: string,
  title: string,
  publishedAt: string,
  state: "review-ready" | "context-ready",
) {
  return {
    channelId: source.channelId,
    videoId,
    title,
    normalizedTitle: title,
    durationMs: 7_200_000,
    publishedAt,
    updatedAt: publishedAt,
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
    state,
    revision: 1,
    artifactIds: [],
    registeredLocalSampledFingerprints: [],
    retry: null,
  } as const;
}

function retiredCocoManifest(): LoadedChannelPreanalysisManifest {
  return {
    source: "raw",
    baseUrl: "https://catalog.test/coco-replay/",
    manifest: {
      schemaVersion: 1,
      channelId: "UCgq07mhOmrjVeZeJYXiAClw",
      channelHandle: "@kokotorori",
      revision: 1,
      generatedAt: "2026-08-04T00:00:00.000Z",
      videos: [],
      artifacts: [],
    },
  } as unknown as LoadedChannelPreanalysisManifest;
}

describe("prepared analysis library", () => {
  it("groups only review-ready videos by configured streamer order", () => {
    const groups = buildPreparedAnalysisLibraryGroups([
      retiredCocoManifest(),
      loadedManifest(EUREKA_CHANNEL_PREANALYSIS_SOURCE, [
        video(
          EUREKA_CHANNEL_PREANALYSIS_SOURCE,
          "qpAyqsZllPg",
          "유레카 방송",
          "2026-08-02T18:57:53.000Z",
          "review-ready",
        ),
      ]),
      loadedManifest(AMORETTO_CHANNEL_PREANALYSIS_SOURCE, [
        video(
          AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
          "KzAW3yow80Q",
          "음식 토크",
          "2026-07-17T15:23:47.000Z",
          "review-ready",
        ),
        video(
          AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
          "VFCOVyDeWWk",
          "아직 맥락만 준비됨",
          "2026-07-18T15:35:05.000Z",
          "context-ready",
        ),
      ]),
    ]);

    expect(groups.map(({ sourceId }) => sourceId)).toEqual([
      "amoretto-vods",
      "eureka-history",
    ]);
    expect(groups.some(({ sourceId }) => String(sourceId) === "coco-replay")).toBe(
      false,
    );
    expect(groups[0]?.videos.map(({ videoId }) => videoId)).toEqual([
      "KzAW3yow80Q",
    ]);
  });
});
