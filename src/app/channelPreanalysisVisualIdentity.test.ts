import { describe, expect, it, vi } from "vitest";

import type {
  ChannelPreanalysisLookupResult,
  LoadedChannelPreanalysisVisualFingerprint,
  LoadedChannelPreanalysisVisualFingerprintCohort,
} from "../analysis/channelPreanalysisClient";
import {
  createChannelPreanalysisVisualAnchorDescriptor,
  createChannelPreanalysisVisualFingerprint,
  matchChannelPreanalysisVisualFingerprint,
} from "../analysis/channelPreanalysisVisualFingerprint";
import type { LocalVideoLumaSamplingResult } from "../media/localVideoVisualAnalysis";
import { verifyChannelPreanalysisLocalVisualIdentity } from "./channelPreanalysisVisualIdentity";

const VIDEO_ID = "KzAW3yow80Q";
const SOURCE_DURATION_MS = 13 * 60_000;
const ANCHOR_TIMESTAMPS = Array.from(
  { length: 12 },
  (_, index) => 30_000 + index * 60_000,
);

describe("verifyChannelPreanalysisLocalVisualIdentity", () => {
  it("verifies the common 12-anchor path without sampling offset recovery", async () => {
    const loaded = createLoadedFingerprint();
    const sampledResults: LocalVideoLumaSamplingResult[] = [];
    const sampleFrames = vi.fn(
      (
        _file: File,
        timestampsMs: readonly number[],
      ): Promise<LocalVideoLumaSamplingResult> => {
        const sampling = {
          sourceDurationMs: SOURCE_DURATION_MS,
          samples: timestampsMs.map((timestampMs) => ({
            timestampMs,
            luma: lumaForAnchorTimestamp(timestampMs),
          })),
        };
        sampledResults.push(sampling);
        return Promise.resolve(sampling);
      },
    );

    const result = await verifyChannelPreanalysisLocalVisualIdentity(
      new File(["video"], "food-talk.mp4", { type: "video/mp4" }),
      SOURCE_DURATION_MS,
      createLookup(),
      {
        loadFingerprint: () => Promise.resolve(loaded),
        sampleFrames,
      },
    );

    expect(result.status).toBe("verified");
    expect(result.videoId).toBe(VIDEO_ID);
    expect(result.match?.globalOffsetMs).toBe(0);
    expect(sampleFrames).toHaveBeenCalledTimes(1);
    expect(sampleFrames.mock.calls[0]?.[1]).toEqual(ANCHOR_TIMESTAMPS);
    const firstResult = sampledResults[0]!;
    expect(
      firstResult.samples.every(({ luma }) =>
        luma.every((value) => value === 0),
      ),
    ).toBe(true);
  });

  it("samples the bounded recovery plan only after zero-offset consensus fails", async () => {
    const loaded = createLoadedFingerprint();
    let callCount = 0;
    const sampledResults: LocalVideoLumaSamplingResult[] = [];
    const sampleFrames = vi.fn(
      (
        _file: File,
        timestampsMs: readonly number[],
      ): Promise<LocalVideoLumaSamplingResult> => {
        callCount += 1;
        const sampling = {
          sourceDurationMs: SOURCE_DURATION_MS,
          samples: timestampsMs.map((timestampMs) => ({
            timestampMs,
            luma:
              callCount === 2 && ANCHOR_TIMESTAMPS.includes(timestampMs - 5_000)
                ? lumaForAnchorTimestamp(timestampMs - 5_000)
                : noisyLuma(timestampMs),
          })),
        };
        sampledResults.push(sampling);
        return Promise.resolve(sampling);
      },
    );

    const result = await verifyChannelPreanalysisLocalVisualIdentity(
      new File(["video"], "renamed.mp4", { type: "video/mp4" }),
      SOURCE_DURATION_MS,
      createLookup(),
      {
        loadFingerprint: () => Promise.resolve(loaded),
        sampleFrames,
      },
    );

    expect(result.status).toBe("verified");
    expect(result.videoId).toBe(VIDEO_ID);
    expect(result.match?.globalOffsetMs).toBe(5_000);
    expect(sampleFrames).toHaveBeenCalledTimes(2);
    expect(
      sampleFrames.mock.calls[1]?.[1].some((timestampMs) =>
        ANCHOR_TIMESTAMPS.includes(timestampMs - 5_000),
      ),
    ).toBe(true);
    for (const sampling of sampledResults) {
      expect(
        sampling.samples.every(({ luma }) =>
          luma.every((value) => value === 0),
        ),
      ).toBe(true);
    }
  });

  it("falls back without sampling when the lookup has no fingerprint", async () => {
    const sampleFrames = vi.fn();
    const result = await verifyChannelPreanalysisLocalVisualIdentity(
      new File(["video"], "unknown.mp4", { type: "video/mp4" }),
      SOURCE_DURATION_MS,
      createLookup(),
      {
        loadFingerprint: () => Promise.resolve(null),
        sampleFrames,
      },
    );

    expect(result).toEqual({
      status: "not-verifiable",
      videoId: null,
      match: null,
      verifiedLookup: null,
    });
    expect(sampleFrames).not.toHaveBeenCalled();
  });

  it("promotes a completely renamed file after one shared cohort sampling pass", async () => {
    const lookup = createLookupWithoutMetadataMatch();
    const loaded = createLoadedFingerprint();
    const cohort: LoadedChannelPreanalysisVisualFingerprintCohort = {
      status: "ready",
      lookup,
      videos: [lookup.manifest.videos[0]!],
      fingerprints: [loaded.fingerprint],
    };
    const sampleFrames = vi.fn(
      (
        _file: File,
        timestampsMs: readonly number[],
      ): Promise<LocalVideoLumaSamplingResult> =>
        Promise.resolve({
          sourceDurationMs: SOURCE_DURATION_MS,
          samples: timestampsMs.map((timestampMs) => ({
            timestampMs,
            luma: lumaForAnchorTimestamp(timestampMs),
          })),
        }),
    );
    const exactLookup: ChannelPreanalysisLookupResult = {
      ...lookup,
      match: {
        confidence: "exact",
        reason: "visual-fingerprint-consensus",
        ambiguous: false,
        match: lookup.manifest.videos[0]!,
        candidates: [lookup.manifest.videos[0]!],
      },
    };

    const result = await verifyChannelPreanalysisLocalVisualIdentity(
      new File(["video"], "completely-renamed.mp4", {
        type: "video/mp4",
      }),
      SOURCE_DURATION_MS,
      lookup,
      {
        loadFingerprintCohort: () => Promise.resolve(cohort),
        resolveFingerprintCohort: (
          _lookup,
          _cohort,
          input,
        ) => {
          const match = matchChannelPreanalysisVisualFingerprint(
            loaded.fingerprint,
            input,
          );
          return Promise.resolve({
            status: "verified",
            lookup: exactLookup,
            selection: {
              status: "verified",
              match: loaded.fingerprint,
              result: match,
              candidates: [match],
            },
          });
        },
        sampleFrames,
      },
    );

    expect(result).toMatchObject({
      status: "verified",
      videoId: VIDEO_ID,
      match: {
        matched: true,
        reason: "multi-anchor-consensus",
      },
      verifiedLookup: {
        match: {
          confidence: "exact",
          reason: "visual-fingerprint-consensus",
        },
      },
    });
    expect(sampleFrames).toHaveBeenCalledTimes(1);
    expect(sampleFrames.mock.calls[0]?.[1]).toEqual(ANCHOR_TIMESTAMPS);
  });

  it("does not sample or promote an incomplete renamed-file cohort", async () => {
    const lookup = createLookupWithoutMetadataMatch();
    const sampleFrames = vi.fn();
    const resolveFingerprintCohort = vi.fn();

    const result = await verifyChannelPreanalysisLocalVisualIdentity(
      new File(["video"], "completely-renamed.mp4", {
        type: "video/mp4",
      }),
      SOURCE_DURATION_MS,
      lookup,
      {
        loadFingerprintCohort: () =>
          Promise.resolve({
            status: "partial",
            lookup,
            videos: [...lookup.manifest.videos],
            fingerprints: [],
          }),
        resolveFingerprintCohort,
        sampleFrames,
      },
    );

    expect(result).toEqual({
      status: "not-verifiable",
      videoId: null,
      match: null,
      verifiedLookup: null,
    });
    expect(sampleFrames).not.toHaveBeenCalled();
    expect(resolveFingerprintCohort).not.toHaveBeenCalled();
  });
});

function createLoadedFingerprint(): LoadedChannelPreanalysisVisualFingerprint {
  const fingerprint = createChannelPreanalysisVisualFingerprint({
    videoId: VIDEO_ID,
    sourceDurationMs: SOURCE_DURATION_MS,
    createdAt: "2026-07-19T06:46:05.000Z",
    anchors: ANCHOR_TIMESTAMPS.map((timestampMs) =>
      createChannelPreanalysisVisualAnchorDescriptor({
        timestampMs,
        luma: lumaForAnchorTimestamp(timestampMs),
      }),
    ),
  });
  return {
    fingerprint,
    artifact: {
      artifactId: `youtube-storyboard-visual-fingerprint:${VIDEO_ID}:v1`,
      videoId: VIDEO_ID,
      kind: "fingerprint",
      revision: 1,
      storageKey: `amoretto-vods/videos/${VIDEO_ID}.visual-fingerprint.v1.json`,
      contentDigest: `sha256:${"0".repeat(64)}`,
      byteLength: 1,
      createdAt: fingerprint.createdAt,
    },
  };
}

function createLookup(): ChannelPreanalysisLookupResult {
  const video = {
    channelId: "UCHycoTBFDhXz4XNz8jBP-_A" as const,
    videoId: VIDEO_ID,
    title: "2026 07 17 - 음식 토크",
    normalizedTitle: "2026 07 17 음식 토크",
    durationMs: SOURCE_DURATION_MS,
    publishedAt: "2026-07-19T06:46:05.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
    watchUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    state: "transcript-ready" as const,
    revision: 1,
    artifactIds: [
      `youtube-storyboard-visual-fingerprint:${VIDEO_ID}:v1`,
    ],
    registeredLocalSampledFingerprints: [],
    retry: null,
  };
  return {
    manifest: {
      schemaVersion: 1,
      channelId: "UCHycoTBFDhXz4XNz8jBP-_A",
      channelHandle: "@AmorettoVODs",
      revision: 1,
      generatedAt: "2026-07-30T00:00:00.000Z",
      videos: [video],
      artifacts: [],
    },
    manifestSource: "bundled",
    manifestBaseUrl: "/preanalysis/amoretto-vods/",
    match: {
      confidence: "probable",
      reason: "unique-normalized-title-and-duration",
      ambiguous: false,
      match: video,
      candidates: [video],
    },
    bundleStatus: "not-exact",
    bundle: null,
    bundleArtifact: null,
  };
}

function createLookupWithoutMetadataMatch(): ChannelPreanalysisLookupResult {
  const lookup = createLookup();
  return {
    ...lookup,
    match: {
      confidence: "none",
      reason: "no-match",
      ambiguous: false,
      match: null,
      candidates: [],
    },
  };
}

function lumaForAnchorTimestamp(timestampMs: number): Uint8Array {
  const anchorIndex = Math.max(
    0,
    ANCHOR_TIMESTAMPS.indexOf(timestampMs),
  );
  return frameLuma(anchorIndex);
}

function noisyLuma(timestampMs: number): Uint8Array {
  return Uint8Array.from(
    { length: 32 * 18 },
    (_, index) => (index * 97 + timestampMs / 1_000) % 256,
  );
}

function frameLuma(seed: number): Uint8Array {
  return Uint8Array.from(
    { length: 32 * 18 },
    (_, index) =>
      (index * (17 + seed * 2) +
        Math.floor(index / 32) * (29 + seed) +
        seed * 43) %
      256,
  );
}
