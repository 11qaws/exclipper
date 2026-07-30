import { describe, expect, it } from "vitest";

import type { ChannelPreanalysisBundle } from "./channelPreanalysisBundle";
import {
  AMORETTO_YOUTUBE_CHANNEL_HANDLE,
  AMORETTO_YOUTUBE_CHANNEL_ID,
  type ChannelPreanalysisArtifact,
  type ChannelPreanalysisCatalogManifest,
  type ChannelPreanalysisCatalogVideo,
} from "./channelPreanalysisCatalog";
import type { ChannelPreanalysisLookupResult } from "./channelPreanalysisClient";
import {
  channelPreanalysisVerifiedBundleBindingMatchesLookup,
  createChannelPreanalysisVerifiedBundleBinding,
} from "./channelPreanalysisBundleBinding";

const VIDEO_ID = "KzAW3yow80Q";
const LOCAL_FINGERPRINT =
  `local-file-sampled-sha256-v1:${"a".repeat(64)}` as const;
const ARTIFACT_DIGEST = `sha256:${"b".repeat(64)}` as const;
const TRANSCRIPT_DIGEST = `sha256:${"c".repeat(64)}` as const;

function lookup(
  overrides: {
    readonly artifactId?: string;
    readonly artifactDigest?: string;
    readonly bundle?: ChannelPreanalysisBundle | null;
  } = {},
): ChannelPreanalysisLookupResult {
  const artifactId =
    overrides.artifactId ?? `youtube-caption-bundle:${VIDEO_ID}:v1`;
  const artifact: ChannelPreanalysisArtifact = {
    artifactId,
    videoId: VIDEO_ID,
    kind: "transcript",
    revision: 1,
    storageKey: `amoretto-vods/videos/${VIDEO_ID}.v1.json`,
    contentDigest: overrides.artifactDigest ?? ARTIFACT_DIGEST,
    byteLength: 1_024,
    createdAt: "2026-07-30T00:00:00.000Z",
  };
  const video: ChannelPreanalysisCatalogVideo = {
    channelId: AMORETTO_YOUTUBE_CHANNEL_ID,
    videoId: VIDEO_ID,
    title: "test",
    normalizedTitle: "test",
    durationMs: 120_000,
    publishedAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
    watchUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    state: "context-ready",
    revision: 1,
    artifactIds: [artifactId],
    registeredLocalSampledFingerprints: [],
    retry: null,
  };
  const manifest: ChannelPreanalysisCatalogManifest = {
    schemaVersion: 1,
    channelId: AMORETTO_YOUTUBE_CHANNEL_ID,
    channelHandle: AMORETTO_YOUTUBE_CHANNEL_HANDLE,
    revision: 1,
    generatedAt: "2026-07-30T00:00:00.000Z",
    videos: [video],
    artifacts: [artifact],
  };
  return {
    manifest,
    manifestSource: "raw",
    manifestBaseUrl: "https://catalog.test/amoretto-vods/",
    match: {
      confidence: "exact",
      reason: "registered-local-sampled-fingerprint",
      ambiguous: false,
      match: video,
      candidates: [video],
    },
    bundleStatus: "loaded",
    bundle:
      overrides.bundle ??
      ({
        videoId: VIDEO_ID,
        transcriptDigest: TRANSCRIPT_DIGEST,
      } as ChannelPreanalysisBundle),
    bundleArtifact: artifact,
  };
}

describe("channel preanalysis verified bundle binding", () => {
  it("binds the exact verified artifact receipt together with the bundle", () => {
    expect(
      createChannelPreanalysisVerifiedBundleBinding(
        LOCAL_FINGERPRINT,
        lookup(),
      ),
    ).toMatchObject({
      sourceContentFingerprint: LOCAL_FINGERPRINT,
      artifactId: `youtube-caption-bundle:${VIDEO_ID}:v1`,
      artifactDigest: ARTIFACT_DIGEST,
      bundle: {
        videoId: VIDEO_ID,
        transcriptDigest: TRANSCRIPT_DIGEST,
      },
    });
  });

  it("rejects a current manifest revision crossing even with the same transcript digest", () => {
    const originalLookup = lookup();
    const binding = createChannelPreanalysisVerifiedBundleBinding(
      LOCAL_FINGERPRINT,
      originalLookup,
    );
    expect(binding).not.toBeNull();

    const newerLookup = lookup({
      artifactId: `youtube-caption-bundle:${VIDEO_ID}:v2`,
      artifactDigest: `sha256:${"d".repeat(64)}`,
      bundle: originalLookup.bundle,
    });
    expect(
      channelPreanalysisVerifiedBundleBindingMatchesLookup(
        binding!,
        newerLookup,
      ),
    ).toBe(false);
  });

  it("rejects a receipt that is not present exactly in the current manifest", () => {
    const substituted = lookup();
    const currentArtifact = substituted.bundleArtifact!;
    const brokenLookup: ChannelPreanalysisLookupResult = {
      ...substituted,
      bundleArtifact: {
        ...currentArtifact,
        contentDigest: `sha256:${"e".repeat(64)}`,
      },
    };
    expect(
      createChannelPreanalysisVerifiedBundleBinding(
        LOCAL_FINGERPRINT,
        brokenLookup,
      ),
    ).toBeNull();
  });
});
