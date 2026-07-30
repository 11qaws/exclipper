import { describe, expect, it } from "vitest";
import {
  AMORETTO_YOUTUBE_CHANNEL_FEED_URL,
  AMORETTO_YOUTUBE_CHANNEL_HANDLE,
  AMORETTO_YOUTUBE_CHANNEL_ID,
  AMORETTO_YOUTUBE_CHANNEL_URL,
  CHANNEL_PREANALYSIS_CATALOG_SCHEMA_VERSION,
  CHANNEL_PREANALYSIS_STATES,
  YOUTUBE_CHANNEL_ATOM_FEED_MAX_BYTES,
  createChannelVideoIdentityDescriptor,
  isChannelPreanalysisState,
  matchChannelPreanalysisVideo,
  normalizeChannelVideoTitle,
  parseAmorettoYouTubeAtomFeed,
  type ChannelPreanalysisCatalogManifest,
  type ChannelPreanalysisCatalogVideo,
  type YouTubeChannelAtomFeedError,
} from "./channelPreanalysisCatalog";

const FIRST_VIDEO_ID = "KzAW3yow80Q";
const SECOND_VIDEO_ID = "AbCdEfGhI_1";
const FIRST_FINGERPRINT =
  `local-file-sampled-sha256-v1:${"a".repeat(64)}` as const;
const REENCODED_FINGERPRINT =
  `local-file-sampled-sha256-v1:${"b".repeat(64)}` as const;

function feedEntry(
  options: {
    readonly videoId?: string;
    readonly channelId?: string;
    readonly title?: string;
    readonly durationSeconds?: number | null;
    readonly publishedAt?: string;
  } = {},
): string {
  const videoId = options.videoId ?? FIRST_VIDEO_ID;
  const channelId = options.channelId ?? AMORETTO_YOUTUBE_CHANNEL_ID;
  const duration =
    options.durationSeconds === undefined
      ? ' duration="8114"'
      : options.durationSeconds === null
        ? ""
        : ` duration="${options.durationSeconds}"`;
  return `
  <entry>
    <id>yt:video:${videoId}</id>
    <yt:videoId>${videoId}</yt:videoId>
    <yt:channelId>${channelId}</yt:channelId>
    <title>${options.title ?? "2026 07 17 - 음식 토크 &amp; 퀴즈"}</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=${videoId}"/>
    <author>
      <name>Amoretto VODs</name>
      <uri>https://www.youtube.com/channel/${channelId}</uri>
    </author>
    <published>${options.publishedAt ?? "2026-07-17T04:00:00+00:00"}</published>
    <updated>2026-07-17T09:30:00Z</updated>
    <media:group>
      <media:title>ignored duplicate presentation title</media:title>
      <media:content url="https://www.youtube.com/v/${videoId}?version=3"${duration}/>
      <media:description>방송 설명</media:description>
    </media:group>
  </entry>`;
}

function channelFeed(
  entries: string,
  options: {
    readonly channelId?: string;
    readonly rootId?: string;
    readonly title?: string;
  } = {},
): string {
  const channelId = options.channelId ?? AMORETTO_YOUTUBE_CHANNEL_ID;
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"
      xmlns:media="http://search.yahoo.com/mrss/"
      xmlns="http://www.w3.org/2005/Atom">
  <link rel="self" href="${AMORETTO_YOUTUBE_CHANNEL_FEED_URL}"/>
  <id>${options.rootId ?? `yt:channel:${channelId}`}</id>
  <yt:channelId>${channelId}</yt:channelId>
  <title>${options.title ?? "Amoretto VODs"}</title>
  <author>
    <name>Amoretto VODs</name>
    <uri>https://www.youtube.com/channel/${channelId}</uri>
  </author>
  <published>2024-01-01T00:00:00+00:00</published>
  ${entries}
</feed>`;
}

function catalogVideo(
  input: Partial<ChannelPreanalysisCatalogVideo> & {
    readonly videoId: string;
    readonly title: string;
  },
): ChannelPreanalysisCatalogVideo {
  return {
    channelId: AMORETTO_YOUTUBE_CHANNEL_ID,
    videoId: input.videoId,
    title: input.title,
    normalizedTitle: normalizeChannelVideoTitle(input.title),
    durationMs: input.durationMs ?? 8_114_000,
    publishedAt: input.publishedAt ?? "2026-07-17T04:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-07-17T09:30:00.000Z",
    watchUrl:
      input.watchUrl ??
      `https://www.youtube.com/watch?v=${input.videoId}`,
    state: input.state ?? "published",
    revision: input.revision ?? 1,
    artifactIds: input.artifactIds ?? [],
    registeredLocalSampledFingerprints:
      input.registeredLocalSampledFingerprints ?? [],
    retry: input.retry ?? null,
  };
}

function manifest(
  videos: readonly ChannelPreanalysisCatalogVideo[],
  contentDigest = `sha256:${"0".repeat(64)}`,
): ChannelPreanalysisCatalogManifest {
  return {
    schemaVersion: CHANNEL_PREANALYSIS_CATALOG_SCHEMA_VERSION,
    channelId: AMORETTO_YOUTUBE_CHANNEL_ID,
    channelHandle: AMORETTO_YOUTUBE_CHANNEL_HANDLE,
    revision: 1,
    generatedAt: "2026-07-30T00:00:00.000Z",
    videos,
    artifacts: [
      {
        artifactId: "context-1",
        videoId: FIRST_VIDEO_ID,
        kind: "context",
        revision: 1,
        storageKey: "catalog/context-1.json",
        contentDigest,
        byteLength: 512,
        createdAt: "2026-07-30T00:00:00.000Z",
      },
    ],
  };
}

describe("pinned Amoretto channel contract", () => {
  it("keeps the exact public channel identity and every lifecycle value", () => {
    expect(AMORETTO_YOUTUBE_CHANNEL_ID).toBe(
      "UCHycoTBFDhXz4XNz8jBP-_A",
    );
    expect(AMORETTO_YOUTUBE_CHANNEL_HANDLE).toBe("@AmorettoVODs");
    expect(AMORETTO_YOUTUBE_CHANNEL_URL).toBe(
      "https://www.youtube.com/@AmorettoVODs",
    );
    expect(AMORETTO_YOUTUBE_CHANNEL_FEED_URL).toBe(
      "https://www.youtube.com/feeds/videos.xml?channel_id=UCHycoTBFDhXz4XNz8jBP-_A",
    );
    expect(CHANNEL_PREANALYSIS_STATES).toEqual([
      "discovered",
      "metadata-ready",
      "transcript-ready",
      "context-ready",
      "published",
      "retryable",
    ]);
    expect(CHANNEL_PREANALYSIS_STATES.every(isChannelPreanalysisState)).toBe(
      true,
    );
    expect(isChannelPreanalysisState("failed")).toBe(false);
  });
});

describe("parseAmorettoYouTubeAtomFeed", () => {
  it("parses a real-shaped official Atom feed into bounded canonical entries", () => {
    const parsed = parseAmorettoYouTubeAtomFeed(
      channelFeed(
        feedEntry() +
          feedEntry({
            videoId: SECOND_VIDEO_ID,
            title: "여름 음식 선호도",
            durationSeconds: null,
            publishedAt: "2026-07-18T04:00:00Z",
          }),
      ),
    );

    expect(parsed).toEqual({
      channelId: AMORETTO_YOUTUBE_CHANNEL_ID,
      channelTitle: "Amoretto VODs",
      feedUrl: AMORETTO_YOUTUBE_CHANNEL_FEED_URL,
      videos: [
        {
          channelId: AMORETTO_YOUTUBE_CHANNEL_ID,
          videoId: FIRST_VIDEO_ID,
          title: "2026 07 17 - 음식 토크 & 퀴즈",
          normalizedTitle: "2026 07 17 음식 토크 퀴즈",
          publishedAt: "2026-07-17T04:00:00.000Z",
          updatedAt: "2026-07-17T09:30:00.000Z",
          watchUrl: `https://www.youtube.com/watch?v=${FIRST_VIDEO_ID}`,
          durationMs: 8_114_000,
        },
        {
          channelId: AMORETTO_YOUTUBE_CHANNEL_ID,
          videoId: SECOND_VIDEO_ID,
          title: "여름 음식 선호도",
          normalizedTitle: "여름 음식 선호도",
          publishedAt: "2026-07-18T04:00:00.000Z",
          updatedAt: "2026-07-17T09:30:00.000Z",
          watchUrl: `https://www.youtube.com/watch?v=${SECOND_VIDEO_ID}`,
          durationMs: null,
        },
      ],
    });
  });

  it("decodes predefined and numeric XML entities without accepting declarations", () => {
    const parsed = parseAmorettoYouTubeAtomFeed(
      channelFeed(
        feedEntry({
          title:
            "음식 &amp; 토크 &quot;특집&quot; &#x1F35C; &#44397; &amp;lt;",
        }),
        { title: "Amoretto &amp; Friends" },
      ),
    );
    expect(parsed.channelTitle).toBe("Amoretto & Friends");
    expect(parsed.videos[0]?.title).toBe(
      '음식 & 토크 "특집" 🍜 국 &lt;',
    );

    expect(() =>
      parseAmorettoYouTubeAtomFeed(
        `<!DOCTYPE feed [<!ENTITY x "boom">]>${channelFeed(feedEntry())}`,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<YouTubeChannelAtomFeedError>>({
        code: "UNSAFE_XML",
      }),
    );
  });

  it("rejects an oversized feed before parsing it", () => {
    expect(() =>
      parseAmorettoYouTubeAtomFeed(
        `${channelFeed("")}${" ".repeat(YOUTUBE_CHANNEL_ATOM_FEED_MAX_BYTES)}`,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<YouTubeChannelAtomFeedError>>({
        code: "TOO_LARGE",
      }),
    );
  });

  it("accepts YouTube's live root form without UC but trusts full entry IDs", () => {
    const legacyRootChannelId = AMORETTO_YOUTUBE_CHANNEL_ID.slice(2);
    const parsed = parseAmorettoYouTubeAtomFeed(
      channelFeed(feedEntry(), {
        channelId: legacyRootChannelId,
        rootId: `yt:channel:${legacyRootChannelId}`,
      }),
    );

    expect(parsed.channelId).toBe(AMORETTO_YOUTUBE_CHANNEL_ID);
    expect(parsed.videos[0]?.channelId).toBe(
      AMORETTO_YOUTUBE_CHANNEL_ID,
    );
  });

  it("rejects any entry that does not repeat the full pinned channel ID", () => {
    expect(() =>
      parseAmorettoYouTubeAtomFeed(
        channelFeed(
          feedEntry({
            channelId: AMORETTO_YOUTUBE_CHANNEL_ID.slice(2),
          }),
        ),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<YouTubeChannelAtomFeedError>>({
        code: "WRONG_CHANNEL",
      }),
    );
  });

  it("rejects duplicate video IDs instead of silently overwriting one", () => {
    expect(() =>
      parseAmorettoYouTubeAtomFeed(
        channelFeed(
          feedEntry() +
            feedEntry({
              title: "같은 ID의 다른 제목",
            }),
        ),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<YouTubeChannelAtomFeedError>>({
        code: "DUPLICATE_VIDEO",
      }),
    );
  });
});

describe("channel video identity and matching", () => {
  it("normalizes title transport noise deterministically", () => {
    expect(
      normalizeChannelVideoTitle(
        "  ２０２６ 07 17 — 음식・토크 [KzAW3yow80Q].MP4  ",
      ),
    ).toBe("2026 07 17 음식 토크");
    expect(
      createChannelVideoIdentityDescriptor({
        videoId: ` ${FIRST_VIDEO_ID} `,
        title: "음식—토크.mp4",
        durationMs: 8_114_000,
        localSampledFingerprint: FIRST_FINGERPRINT,
      }),
    ).toEqual({
      videoId: FIRST_VIDEO_ID,
      normalizedTitle: "음식 토크",
      durationMs: 8_114_000,
      localSampledFingerprint: FIRST_FINGERPRINT,
    });
  });

  it("uses an explicit video ID before every weaker identity lane", () => {
    const first = catalogVideo({
      videoId: FIRST_VIDEO_ID,
      title: "음식 토크",
    });
    const second = catalogVideo({
      videoId: SECOND_VIDEO_ID,
      title: "음식 토크",
      registeredLocalSampledFingerprints: [
        {
          value: FIRST_FINGERPRINT,
          registeredAt: "2026-07-30T00:00:00.000Z",
        },
      ],
    });
    const result = matchChannelPreanalysisVideo(manifest([first, second]), {
      videoId: FIRST_VIDEO_ID,
      title: second.title,
      durationMs: second.durationMs,
      localSampledFingerprint: FIRST_FINGERPRINT,
    });
    expect(result).toMatchObject({
      confidence: "exact",
      reason: "explicit-video-id",
      ambiguous: false,
      match: first,
    });
  });

  it("does not fuzzy-fallback when an authoritative explicit ID is absent", () => {
    const video = catalogVideo({
      videoId: FIRST_VIDEO_ID,
      title: "음식 토크",
    });
    expect(
      matchChannelPreanalysisVideo(manifest([video]), {
        videoId: SECOND_VIDEO_ID,
        title: video.title,
        durationMs: video.durationMs,
      }),
    ).toMatchObject({
      confidence: "none",
      reason: "explicit-video-id-not-found",
      ambiguous: false,
      match: null,
    });
  });

  it("accepts only a sampled fingerprint explicitly registered on one video", () => {
    const video = catalogVideo({
      videoId: FIRST_VIDEO_ID,
      title: "음식 토크",
      registeredLocalSampledFingerprints: [
        {
          value: FIRST_FINGERPRINT,
          registeredAt: "2026-07-30T00:00:00.000Z",
        },
      ],
    });
    expect(
      matchChannelPreanalysisVideo(manifest([video]), {
        localSampledFingerprint: FIRST_FINGERPRINT,
      }),
    ).toMatchObject({
      confidence: "exact",
      reason: "registered-local-sampled-fingerprint",
      ambiguous: false,
      match: video,
    });
  });

  it("never treats a remote digest or re-encoded local hash as comparable", () => {
    const video = catalogVideo({
      videoId: FIRST_VIDEO_ID,
      title: "음식 토크",
    });
    const result = matchChannelPreanalysisVideo(
      manifest([video], REENCODED_FINGERPRINT),
      {
        localSampledFingerprint: REENCODED_FINGERPRINT,
      },
    );
    expect(result).toEqual({
      confidence: "none",
      reason: "no-match",
      ambiguous: false,
      match: null,
      candidates: [],
    });
  });

  it("returns only one normalized title+duration match as probable", () => {
    const first = catalogVideo({
      videoId: FIRST_VIDEO_ID,
      title: "2026 07 17 — 음식 토크",
      durationMs: 8_114_000,
    });
    const result = matchChannelPreanalysisVideo(manifest([first]), {
      title: "2026 07 17 - 음식 토크.mp4",
      durationMs: 8_115_999,
    });
    expect(result).toMatchObject({
      confidence: "probable",
      reason: "unique-normalized-title-and-duration",
      ambiguous: false,
      match: first,
    });
  });

  it("refuses an ambiguous title+duration result", () => {
    const first = catalogVideo({
      videoId: FIRST_VIDEO_ID,
      title: "음식 토크",
      durationMs: 8_114_000,
    });
    const second = catalogVideo({
      videoId: SECOND_VIDEO_ID,
      title: "음식—토크",
      durationMs: 8_116_000,
    });
    const result = matchChannelPreanalysisVideo(manifest([first, second]), {
      title: "음식 토크",
      durationMs: 8_115_000,
    });
    expect(result).toMatchObject({
      confidence: "none",
      reason: "ambiguous-normalized-title-and-duration",
      ambiguous: true,
      match: null,
    });
    expect(result.candidates.map(({ videoId }) => videoId)).toEqual([
      FIRST_VIDEO_ID,
      SECOND_VIDEO_ID,
    ]);
  });

  it("does not match outside the inclusive two-second tolerance", () => {
    const video = catalogVideo({
      videoId: FIRST_VIDEO_ID,
      title: "음식 토크",
      durationMs: 8_114_000,
    });
    expect(
      matchChannelPreanalysisVideo(manifest([video]), {
        title: video.title,
        durationMs: 8_116_001,
      }),
    ).toMatchObject({
      confidence: "none",
      reason: "no-match",
      match: null,
    });
  });
});
