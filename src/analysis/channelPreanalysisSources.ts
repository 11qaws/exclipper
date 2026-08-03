export const CHANNEL_PREANALYSIS_SOURCE_IDS = [
  "amoretto-vods",
  "eureka-history",
  "sena-replay",
  "mangjing-compilations",
] as const;

export type ChannelPreanalysisSourceId =
  (typeof CHANNEL_PREANALYSIS_SOURCE_IDS)[number];

export type ChannelPreanalysisUploadLayout =
  | "single-replay"
  | "combined-replay";

export type ChannelPreanalysisPlaylistKind =
  | "long-form-uploads"
  | "live-streams";

export interface ChannelPreanalysisSourceDefinition<
  TSourceId extends ChannelPreanalysisSourceId = ChannelPreanalysisSourceId,
  TChannelId extends string = string,
  TChannelHandle extends string = string,
> {
  readonly sourceId: TSourceId;
  readonly channelId: TChannelId;
  readonly channelHandle: TChannelHandle;
  readonly channelUrl: string;
  readonly playlistId: string;
  readonly playlistKind: ChannelPreanalysisPlaylistKind;
  readonly feedUrl: string;
  readonly displayNameKo: string;
  readonly uploadLayout: ChannelPreanalysisUploadLayout;
}

function defineSource<
  const TSourceId extends ChannelPreanalysisSourceId,
  const TChannelId extends `UC${string}`,
  const TChannelHandle extends `@${string}`,
>(
  source: Omit<
    ChannelPreanalysisSourceDefinition<TSourceId, TChannelId, TChannelHandle>,
    "feedUrl"
  >,
): ChannelPreanalysisSourceDefinition<TSourceId, TChannelId, TChannelHandle> {
  return Object.freeze({
    ...source,
    feedUrl: `https://www.youtube.com/feeds/videos.xml?playlist_id=${source.playlistId}`,
  });
}

export const AMORETTO_CHANNEL_PREANALYSIS_SOURCE = defineSource({
  sourceId: "amoretto-vods",
  channelId: "UCHycoTBFDhXz4XNz8jBP-_A",
  channelHandle: "@AmorettoVODs",
  channelUrl: "https://www.youtube.com/@AmorettoVODs",
  playlistId: "UULFHycoTBFDhXz4XNz8jBP-_A",
  playlistKind: "long-form-uploads",
  displayNameKo: "아모레또",
  uploadLayout: "single-replay",
});

export const EUREKA_CHANNEL_PREANALYSIS_SOURCE = defineSource({
  sourceId: "eureka-history",
  channelId: "UCiFzBB8xsUjEBq8_h6Yl6tA",
  channelHandle: "@eureka_history",
  channelUrl: "https://www.youtube.com/@eureka_history",
  playlistId: "UULFiFzBB8xsUjEBq8_h6Yl6tA",
  playlistKind: "long-form-uploads",
  displayNameKo: "유레카",
  uploadLayout: "single-replay",
});

export const SENA_CHANNEL_PREANALYSIS_SOURCE = defineSource({
  sourceId: "sena-replay",
  channelId: "UCk0Mu5MpVzJ056e65XpAj0Q",
  channelHandle: "@SENAREPLAY",
  channelUrl: "https://www.youtube.com/@SENAREPLAY",
  playlistId: "UULFk0Mu5MpVzJ056e65XpAj0Q",
  playlistKind: "long-form-uploads",
  displayNameKo: "세나 아르벨",
  uploadLayout: "single-replay",
});

export const MANGJING_CHANNEL_PREANALYSIS_SOURCE = defineSource({
  sourceId: "mangjing-compilations",
  channelId: "UC_hftLL-ydsJd1YpcBZ_09g",
  channelHandle: "@망징-b1t",
  channelUrl: "https://www.youtube.com/@%EB%A7%9D%EC%A7%95-b1t",
  playlistId: "UULF_hftLL-ydsJd1YpcBZ_09g",
  playlistKind: "long-form-uploads",
  displayNameKo: "망징이",
  uploadLayout: "combined-replay",
});

export const CHANNEL_PREANALYSIS_SOURCES = Object.freeze([
  AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
  EUREKA_CHANNEL_PREANALYSIS_SOURCE,
  SENA_CHANNEL_PREANALYSIS_SOURCE,
  MANGJING_CHANNEL_PREANALYSIS_SOURCE,
] as const);

export type ConfiguredChannelPreanalysisSource =
  (typeof CHANNEL_PREANALYSIS_SOURCES)[number];
export type ChannelPreanalysisYouTubeChannelId =
  ConfiguredChannelPreanalysisSource["channelId"];
export type ChannelPreanalysisYouTubeChannelHandle =
  ConfiguredChannelPreanalysisSource["channelHandle"];

const SOURCE_BY_ID = new Map(
  CHANNEL_PREANALYSIS_SOURCES.map((source) => [source.sourceId, source]),
);
const SOURCE_BY_CHANNEL_ID = new Map(
  CHANNEL_PREANALYSIS_SOURCES.map((source) => [source.channelId, source]),
);

export function channelPreanalysisSourceById(
  sourceId: string,
): ConfiguredChannelPreanalysisSource | null {
  return SOURCE_BY_ID.get(sourceId as ChannelPreanalysisSourceId) ?? null;
}

export function channelPreanalysisSourceByChannelId(
  channelId: string,
): ConfiguredChannelPreanalysisSource | null {
  return (
    SOURCE_BY_CHANNEL_ID.get(
      channelId as ChannelPreanalysisYouTubeChannelId,
    ) ?? null
  );
}

export function isChannelPreanalysisYouTubeChannelId(
  value: unknown,
): value is ChannelPreanalysisYouTubeChannelId {
  return (
    typeof value === "string" &&
    channelPreanalysisSourceByChannelId(value) !== null
  );
}

export function channelPreanalysisStoragePrefix(
  source: ConfiguredChannelPreanalysisSource,
): `${ChannelPreanalysisSourceId}/` {
  return `${source.sourceId}/`;
}
