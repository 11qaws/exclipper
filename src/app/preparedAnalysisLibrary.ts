import {
  isChannelPreanalysisReviewReadyVideo,
  type LoadedChannelPreanalysisManifest,
} from "../analysis/channelPreanalysisClient";
import {
  CHANNEL_PREANALYSIS_SOURCES,
  type ChannelPreanalysisSourceId,
} from "../analysis/channelPreanalysisSources";

export interface PreparedAnalysisLibraryVideo {
  readonly videoId: string;
  readonly title: string;
  readonly watchUrl: string;
  readonly durationMs: number | null;
  readonly publishedAt: string;
}

export interface PreparedAnalysisLibraryGroup {
  readonly sourceId: ChannelPreanalysisSourceId;
  readonly displayName: string;
  readonly channelHandle: string;
  readonly videos: readonly PreparedAnalysisLibraryVideo[];
}

export function buildPreparedAnalysisLibraryGroups(
  loadedManifests: readonly LoadedChannelPreanalysisManifest[],
): readonly PreparedAnalysisLibraryGroup[] {
  const manifestByChannelId = new Map(
    loadedManifests.map((loaded) => [loaded.manifest.channelId, loaded.manifest]),
  );
  return CHANNEL_PREANALYSIS_SOURCES.flatMap((source) => {
    const manifest = manifestByChannelId.get(source.channelId);
    if (manifest === undefined) return [];
    const videos = manifest.videos
      .filter(isChannelPreanalysisReviewReadyVideo)
      .map(({ videoId, title, watchUrl, durationMs, publishedAt }) => ({
        videoId,
        title,
        watchUrl,
        durationMs,
        publishedAt,
      }))
      .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
    return videos.length === 0
      ? []
      : [{
          sourceId: source.sourceId,
          displayName: source.displayNameKo,
          channelHandle: source.channelHandle,
          videos,
        }];
  });
}
