import { describe, expect, it } from "vitest";
import { parseYouTubeChannelAtomFeed } from "./channelPreanalysisCatalog";

import {
  AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
  CHANNEL_PREANALYSIS_SOURCES,
  MANGJING_CHANNEL_PREANALYSIS_SOURCE,
  channelPreanalysisSourceByChannelId,
  channelPreanalysisSourceById,
  channelPreanalysisStoragePrefix,
  isChannelPreanalysisYouTubeChannelId,
} from "./channelPreanalysisSources";

describe("configured channel preanalysis sources", () => {
  it("pins the four editor-approved YouTube sources exactly once", () => {
    expect(CHANNEL_PREANALYSIS_SOURCES).toHaveLength(4);
    expect(
      new Set(CHANNEL_PREANALYSIS_SOURCES.map(({ sourceId }) => sourceId)).size,
    ).toBe(4);
    expect(
      new Set(CHANNEL_PREANALYSIS_SOURCES.map(({ channelId }) => channelId)).size,
    ).toBe(4);
    expect(
      CHANNEL_PREANALYSIS_SOURCES.map(
        ({ channelHandle, channelId, sourceId }) => ({
          channelHandle,
          channelId,
          sourceId,
        }),
      ),
    ).toEqual([
      {
        sourceId: "amoretto-vods",
        channelHandle: "@AmorettoVODs",
        channelId: "UCHycoTBFDhXz4XNz8jBP-_A",
      },
      {
        sourceId: "eureka-history",
        channelHandle: "@eureka_history",
        channelId: "UCiFzBB8xsUjEBq8_h6Yl6tA",
      },
      {
        sourceId: "sena-replay",
        channelHandle: "@SENAREPLAY",
        channelId: "UCk0Mu5MpVzJ056e65XpAj0Q",
      },
      {
        sourceId: "mangjing-compilations",
        channelHandle: "@망징-b1t",
        channelId: "UC_hftLL-ydsJd1YpcBZ_09g",
      },
    ]);
  });

  it("keeps the Mangjing combined-upload policy explicit", () => {
    expect(MANGJING_CHANNEL_PREANALYSIS_SOURCE.uploadLayout).toBe(
      "combined-replay",
    );
    expect(
      CHANNEL_PREANALYSIS_SOURCES.filter(
        ({ uploadLayout }) => uploadLayout === "combined-replay",
      ),
    ).toEqual([MANGJING_CHANNEL_PREANALYSIS_SOURCE]);
  });

  it("uses only the approved long-form archive playlists", () => {
    expect(
      CHANNEL_PREANALYSIS_SOURCES.map(
        ({ channelHandle, playlistId, playlistKind }) => ({
          channelHandle,
          playlistId,
          playlistKind,
        }),
      ),
    ).toEqual([
      {
        channelHandle: "@AmorettoVODs",
        playlistId: "UULFHycoTBFDhXz4XNz8jBP-_A",
        playlistKind: "long-form-uploads",
      },
      {
        channelHandle: "@eureka_history",
        playlistId: "UULFiFzBB8xsUjEBq8_h6Yl6tA",
        playlistKind: "long-form-uploads",
      },
      {
        channelHandle: "@SENAREPLAY",
        playlistId: "UULFk0Mu5MpVzJ056e65XpAj0Q",
        playlistKind: "long-form-uploads",
      },
      {
        channelHandle: "@망징-b1t",
        playlistId: "UULF_hftLL-ydsJd1YpcBZ_09g",
        playlistKind: "long-form-uploads",
      },
    ]);
  });

  it("resolves only configured identities and derives bounded storage roots", () => {
    expect(
      channelPreanalysisSourceById("amoretto-vods"),
    ).toBe(AMORETTO_CHANNEL_PREANALYSIS_SOURCE);
    expect(
      channelPreanalysisSourceByChannelId("UCHycoTBFDhXz4XNz8jBP-_A"),
    ).toBe(AMORETTO_CHANNEL_PREANALYSIS_SOURCE);
    expect(channelPreanalysisSourceById("unknown")).toBeNull();
    expect(channelPreanalysisSourceById("coco-replay")).toBeNull();
    expect(
      channelPreanalysisSourceByChannelId("UCgq07mhOmrjVeZeJYXiAClw"),
    ).toBeNull();
    expect(isChannelPreanalysisYouTubeChannelId("UC-invalid")).toBe(false);
    expect(
      channelPreanalysisStoragePrefix(MANGJING_CHANNEL_PREANALYSIS_SOURCE),
    ).toBe("mangjing-compilations/");
  });

  it.each(CHANNEL_PREANALYSIS_SOURCES)(
    "parses the official playlist identity for $sourceId",
    (source) => {
      const feed = parseYouTubeChannelAtomFeed(
        `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:yt="http://www.youtube.com/xml/schemas/2015">
  <id>yt:playlist:${source.playlistId}</id>
  <yt:channelId>${source.channelId}</yt:channelId>
  <title>${source.displayNameKo}</title>
</feed>`,
        source,
      );
      expect(feed.channelId).toBe(source.channelId);
      expect(feed.feedUrl).toBe(source.feedUrl);
      expect(feed.videos).toEqual([]);
    },
  );
});
