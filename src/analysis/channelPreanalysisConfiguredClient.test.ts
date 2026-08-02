import { describe, expect, it, vi } from "vitest";

import {
  normalizeChannelVideoTitle,
  type ChannelPreanalysisCatalogManifest,
} from "./channelPreanalysisCatalog";
import { requestConfiguredChannelPreanalysisMatch } from "./channelPreanalysisClient";
import {
  AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
  EUREKA_CHANNEL_PREANALYSIS_SOURCE,
  type ConfiguredChannelPreanalysisSource,
} from "./channelPreanalysisSources";

const VIDEO_ID = "KzAW3yow80Q";
const OTHER_VIDEO_ID = "EZfCGS5ms_Q";
const TITLE = "2026 07 17 - 음식 토크";
const DURATION_MS = 8_115_000;
const SOURCES = [
  AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
  EUREKA_CHANNEL_PREANALYSIS_SOURCE,
] as const;

function manifest(
  source: ConfiguredChannelPreanalysisSource,
  videoId: string | null,
): ChannelPreanalysisCatalogManifest {
  return {
    schemaVersion: 1,
    channelId: source.channelId,
    channelHandle: source.channelHandle,
    revision: 1,
    generatedAt: "2026-08-02T00:00:00.000Z",
    videos:
      videoId === null
        ? []
        : [
            {
              channelId: source.channelId,
              videoId,
              title: TITLE,
              normalizedTitle: normalizeChannelVideoTitle(TITLE),
              durationMs: DURATION_MS,
              publishedAt: "2026-07-17T00:00:00.000Z",
              updatedAt: "2026-07-17T00:00:00.000Z",
              watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
              state: "discovered",
              revision: 1,
              artifactIds: [],
              registeredLocalSampledFingerprints: [],
              retry: null,
            },
          ],
    artifacts: [],
  };
}

function sourceOptions(source: ConfiguredChannelPreanalysisSource) {
  return {
    rawBaseUrl: `https://catalog.test/${source.sourceId}/`,
    bundledBaseUrl: `https://fallback.test/${source.sourceId}/`,
  };
}

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) return input;
  return new URL(typeof input === "string" ? input : input.url);
}

describe("configured channel preanalysis search", () => {
  it("finds one exact video across all healthy source catalogs", async () => {
    const bySource = new Map<string, ChannelPreanalysisCatalogManifest>([
      [AMORETTO_CHANNEL_PREANALYSIS_SOURCE.sourceId, manifest(AMORETTO_CHANNEL_PREANALYSIS_SOURCE, OTHER_VIDEO_ID)],
      [EUREKA_CHANNEL_PREANALYSIS_SOURCE.sourceId, manifest(EUREKA_CHANNEL_PREANALYSIS_SOURCE, VIDEO_ID)],
    ]);
    const fetchImplementation = vi.fn((input: RequestInfo | URL) => {
      const sourceId = requestUrl(input).pathname.split("/")[1] ?? "";
      return Promise.resolve(
        new Response(JSON.stringify(bySource.get(sourceId)), { status: 200 }),
      );
    });

    const result = await requestConfiguredChannelPreanalysisMatch(
      { videoId: VIDEO_ID },
      {
        configuredSources: SOURCES,
        sourceOptions,
        fetchImplementation,
      },
    );

    expect(result.coverage).toBe("complete");
    expect(result.selection).toBe("exact");
    expect(result.primaryLookup.manifest.channelId).toBe(
      EUREKA_CHANNEL_PREANALYSIS_SOURCE.channelId,
    );
  });

  it("does not call a title-duration collision unique across channels", async () => {
    const bySource = new Map<string, ChannelPreanalysisCatalogManifest>(
      SOURCES.map((source) => [source.sourceId, manifest(source, VIDEO_ID)]),
    );
    const fetchImplementation = vi.fn((input: RequestInfo | URL) => {
      const sourceId = requestUrl(input).pathname.split("/")[1] ?? "";
      return Promise.resolve(
        new Response(JSON.stringify(bySource.get(sourceId)), { status: 200 }),
      );
    });

    const result = await requestConfiguredChannelPreanalysisMatch(
      { title: TITLE, durationMs: DURATION_MS },
      {
        configuredSources: SOURCES,
        sourceOptions,
        fetchImplementation,
      },
    );

    expect(result.coverage).toBe("complete");
    expect(result.selection).toBe("ambiguous");
  });

  it("keeps a renamed local file visually matchable across more than twelve same-duration uploads", async () => {
    const populated = manifest(
      AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
      VIDEO_ID,
    );
    const seed = populated.videos[0]!;
    const videos = Array.from({ length: 13 }, (_, index) => {
      const videoId = `A${String(index).padStart(10, "0")}`;
      return {
        ...seed,
        videoId,
        title: `서로 다른 방송 ${String(index + 1)}`,
        normalizedTitle: normalizeChannelVideoTitle(
          `서로 다른 방송 ${String(index + 1)}`,
        ),
        watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      };
    });
    const bySource = new Map<string, ChannelPreanalysisCatalogManifest>([
      [
        AMORETTO_CHANNEL_PREANALYSIS_SOURCE.sourceId,
        { ...populated, videos },
      ],
      [
        EUREKA_CHANNEL_PREANALYSIS_SOURCE.sourceId,
        manifest(EUREKA_CHANNEL_PREANALYSIS_SOURCE, null),
      ],
    ]);
    const fetchImplementation = vi.fn((input: RequestInfo | URL) => {
      const sourceId = requestUrl(input).pathname.split("/")[1] ?? "";
      return Promise.resolve(
        new Response(JSON.stringify(bySource.get(sourceId)), { status: 200 }),
      );
    });

    const result = await requestConfiguredChannelPreanalysisMatch(
      { title: "completely-renamed-upload.mp4", durationMs: DURATION_MS },
      {
        configuredSources: SOURCES,
        sourceOptions,
        fetchImplementation,
      },
    );

    expect(result.coverage).toBe("complete");
    expect(result.selection).toBe("visual-cohort");
  });

  it("abstains from fuzzy selection when one source catalog is unavailable", async () => {
    const fetchImplementation = vi.fn((input: RequestInfo | URL) => {
      const sourceId = requestUrl(input).pathname.split("/")[1];
      if (sourceId === EUREKA_CHANNEL_PREANALYSIS_SOURCE.sourceId) {
        return Promise.resolve(new Response("unavailable", { status: 503 }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify(
            manifest(AMORETTO_CHANNEL_PREANALYSIS_SOURCE, VIDEO_ID),
          ),
          { status: 200 },
        ),
      );
    });

    const result = await requestConfiguredChannelPreanalysisMatch(
      { title: TITLE, durationMs: DURATION_MS },
      {
        configuredSources: SOURCES,
        sourceOptions,
        fetchImplementation,
      },
    );

    expect(result.coverage).toBe("partial");
    expect(result.selection).toBe("partial");
    expect(result.unavailableSourceIds).toEqual([
      EUREKA_CHANNEL_PREANALYSIS_SOURCE.sourceId,
    ]);
  });

  it("treats a bundled fallback as partial coverage for fuzzy uniqueness", async () => {
    const fetchImplementation = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      const sourceId = url.pathname.split("/")[1];
      const isRaw = url.hostname === "catalog.test";
      if (
        sourceId === EUREKA_CHANNEL_PREANALYSIS_SOURCE.sourceId &&
        isRaw
      ) {
        return Promise.resolve(new Response("unavailable", { status: 503 }));
      }
      const source = SOURCES.find((candidate) => candidate.sourceId === sourceId);
      if (source === undefined) throw new Error("unexpected test source");
      const videoId =
        sourceId === AMORETTO_CHANNEL_PREANALYSIS_SOURCE.sourceId
          ? VIDEO_ID
          : null;
      return Promise.resolve(
        new Response(JSON.stringify(manifest(source, videoId)), { status: 200 }),
      );
    });

    const result = await requestConfiguredChannelPreanalysisMatch(
      { title: TITLE, durationMs: DURATION_MS },
      {
        configuredSources: SOURCES,
        sourceOptions,
        fetchImplementation,
      },
    );

    expect(result.coverage).toBe("partial");
    expect(result.selection).toBe("partial");
    expect(result.unavailableSourceIds).toEqual([
      EUREKA_CHANNEL_PREANALYSIS_SOURCE.sourceId,
    ]);
    expect(result.lookups.find(
      ({ manifest }) =>
        manifest.channelId === EUREKA_CHANNEL_PREANALYSIS_SOURCE.channelId,
    )?.manifestSource).toBe("bundled");
  });

  it("still accepts an explicit exact ID from a verified bundled fallback", async () => {
    const fetchImplementation = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      const sourceId = url.pathname.split("/")[1];
      const isRaw = url.hostname === "catalog.test";
      if (
        sourceId === EUREKA_CHANNEL_PREANALYSIS_SOURCE.sourceId &&
        isRaw
      ) {
        return Promise.resolve(new Response("unavailable", { status: 503 }));
      }
      const source = SOURCES.find((candidate) => candidate.sourceId === sourceId);
      if (source === undefined) throw new Error("unexpected test source");
      const videoId =
        sourceId === EUREKA_CHANNEL_PREANALYSIS_SOURCE.sourceId
          ? VIDEO_ID
          : OTHER_VIDEO_ID;
      return Promise.resolve(
        new Response(JSON.stringify(manifest(source, videoId)), { status: 200 }),
      );
    });

    const result = await requestConfiguredChannelPreanalysisMatch(
      { videoId: VIDEO_ID },
      {
        configuredSources: SOURCES,
        sourceOptions,
        fetchImplementation,
      },
    );

    expect(result.coverage).toBe("partial");
    expect(result.selection).toBe("exact");
    expect(result.primaryLookup.manifestSource).toBe("bundled");
    expect(result.primaryLookup.manifest.channelId).toBe(
      EUREKA_CHANNEL_PREANALYSIS_SOURCE.channelId,
    );
  });
});
