import { describe, expect, it } from "vitest";

import {
  CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_COHORT,
  CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_LOCAL_SAMPLES,
  CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_SCHEMA_VERSION,
  buildChannelPreanalysisLocalVisualCohortSamplingPlan,
  buildChannelPreanalysisLocalVisualSamplingPlan,
  canonicalChannelPreanalysisVisualFingerprintArtifactId,
  canonicalChannelPreanalysisVisualFingerprintStorageKey,
  createChannelPreanalysisVisualAnchorDescriptor,
  createChannelPreanalysisVisualFingerprint,
  hammingDistance64,
  matchChannelPreanalysisVisualFingerprint,
  parseChannelPreanalysisVisualFingerprint,
  selectUniqueChannelPreanalysisVisualFingerprint,
  serializeChannelPreanalysisVisualFingerprint,
  type ChannelPreanalysisVisualFingerprint,
} from "./channelPreanalysisVisualFingerprint";

const VIDEO_ID = "KzAW3yow80Q";
const OTHER_VIDEO_ID = "AbCdEfGhI_1";
const DURATION_MS = 600_000;
const WIDTH = 32;
const HEIGHT = 18;

function luma(seed: number): Uint8Array {
  let state = (seed + 1) * 0x9e3779b1;
  return Uint8Array.from(
    { length: WIDTH * HEIGHT },
    (_, index) => {
      state = (Math.imul(state ^ index, 1_664_525) + 1_013_904_223) >>> 0;
      const x = index % WIDTH;
      const y = Math.floor(index / WIDTH);
      return (
        ((state >>> 24) +
          x * (seed + 3) +
          y * (seed * 2 + 5) +
          ((x + seed) % 7) * 13) %
        256
      );
    },
  );
}

function reencoded(source: Uint8Array): Uint8Array {
  return Uint8Array.from(source, (value, index) =>
    Math.max(
      0,
      Math.min(255, Math.round(value * 0.96 + 5 + ((index % 3) - 1))),
    ),
  );
}

function fingerprint(
  videoId = VIDEO_ID,
  seedOffset = 0,
): ChannelPreanalysisVisualFingerprint {
  return createChannelPreanalysisVisualFingerprint({
    videoId,
    sourceDurationMs: DURATION_MS,
    createdAt: "2026-07-30T00:00:00.000Z",
    anchors: Array.from({ length: 12 }, (_, index) =>
      createChannelPreanalysisVisualAnchorDescriptor({
        timestampMs: (index + 1) * 45_000,
        luma: luma(seedOffset + index),
        width: WIDTH,
        height: HEIGHT,
      }),
    ),
  });
}

describe("channel preanalysis visual fingerprints", () => {
  it("round-trips one strict, versioned, bounded artifact", () => {
    const value = fingerprint();
    const serialized = serializeChannelPreanalysisVisualFingerprint(value);

    expect(parseChannelPreanalysisVisualFingerprint(serialized)).toEqual(value);
    expect(value.schemaVersion).toBe(
      CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_SCHEMA_VERSION,
    );
    expect(
      canonicalChannelPreanalysisVisualFingerprintArtifactId(VIDEO_ID),
    ).toBe(`youtube-storyboard-visual-fingerprint:${VIDEO_ID}:v1`);
    expect(
      canonicalChannelPreanalysisVisualFingerprintStorageKey(VIDEO_ID),
    ).toBe(
      `amoretto-vods/videos/${VIDEO_ID}.visual-fingerprint.v1.json`,
    );
    expect(() =>
      parseChannelPreanalysisVisualFingerprint({
        ...value,
        unexpected: true,
      }),
    ).toThrow(/shape/u);
  });

  it("rejects too few, repeated, unordered and timeline-narrow anchors", () => {
    const value = fingerprint();
    expect(() =>
      createChannelPreanalysisVisualFingerprint({
        ...value,
        anchors: value.anchors.slice(0, 7),
      }),
    ).toThrow(/header/u);
    expect(() =>
      createChannelPreanalysisVisualFingerprint({
        ...value,
        anchors: value.anchors.map((_anchor, index) => ({
          ...value.anchors[0]!,
          timestampMs: (index + 1) * 45_000,
        })),
      }),
    ).toThrow(/distinct scenes/u);
    expect(() =>
      createChannelPreanalysisVisualFingerprint({
        ...value,
        anchors: [value.anchors[1]!, value.anchors[0]!, ...value.anchors.slice(2)],
      }),
    ).toThrow(/anchor 1/u);
    expect(() =>
      createChannelPreanalysisVisualFingerprint({
        ...value,
        anchors: value.anchors.map((anchor, index) => ({
          ...anchor,
          timestampMs: 250_000 + index * 5_000,
        })),
      }),
    ).toThrow(/timeline/u);
  });

  it("matches re-encoded luma at one bounded global timeline offset", () => {
    const value = fingerprint();
    const samples = value.anchors.map((anchor, index) => ({
      timestampMs: anchor.timestampMs + 15_000,
      luma: reencoded(luma(index)),
      width: WIDTH,
      height: HEIGHT,
    }));

    expect(
      matchChannelPreanalysisVisualFingerprint(value, {
        durationMs: DURATION_MS + 350,
        samples,
      }),
    ).toMatchObject({
      matched: true,
      reason: "multi-anchor-consensus",
      videoId: VIDEO_ID,
      globalOffsetMs: 15_000,
      matchedAnchorCount: 12,
      temporalThirdsCovered: 3,
    });
  });

  it("rejects duration conflicts, unrelated frames and partial timeline fits", () => {
    const value = fingerprint();
    const unrelated = value.anchors.map((anchor, index) => ({
      timestampMs: anchor.timestampMs,
      luma: luma(index + 100),
      width: WIDTH,
      height: HEIGHT,
    }));
    expect(
      matchChannelPreanalysisVisualFingerprint(value, {
        durationMs: DURATION_MS + 20_000,
        samples: unrelated,
      }),
    ).toMatchObject({
      matched: false,
      reason: "duration-conflict",
    });
    expect(
      matchChannelPreanalysisVisualFingerprint(value, {
        durationMs: DURATION_MS,
        samples: unrelated,
      }),
    ).toMatchObject({
      matched: false,
      reason: "anchor-consensus-failed",
    });
    expect(
      matchChannelPreanalysisVisualFingerprint(value, {
        durationMs: DURATION_MS,
        samples: value.anchors.slice(0, 8).map((anchor, index) => ({
          timestampMs: anchor.timestampMs,
          luma: reencoded(luma(index)),
          width: WIDTH,
          height: HEIGHT,
        })),
      }),
    ).toMatchObject({
      matched: false,
      reason: "insufficient-local-samples",
    });
  });

  it("returns ambiguity instead of selecting two visually matching videos", () => {
    const first = fingerprint();
    const second = createChannelPreanalysisVisualFingerprint({
      ...first,
      videoId: OTHER_VIDEO_ID,
    });
    const samples = first.anchors.map((anchor, index) => ({
      timestampMs: anchor.timestampMs,
      luma: reencoded(luma(index)),
      width: WIDTH,
      height: HEIGHT,
    }));

    expect(
      selectUniqueChannelPreanalysisVisualFingerprint([first, second], {
        durationMs: DURATION_MS,
        samples,
      }),
    ).toMatchObject({
      status: "ambiguous",
      match: null,
      result: null,
    });
  });

  it("never lets another cohort member supply offset-recovery samples", () => {
    const first = fingerprint(VIDEO_ID, 0);
    const second = createChannelPreanalysisVisualFingerprint({
      videoId: OTHER_VIDEO_ID,
      sourceDurationMs: DURATION_MS,
      createdAt: first.createdAt,
      anchors: first.anchors.map((anchor, index) =>
        createChannelPreanalysisVisualAnchorDescriptor({
          timestampMs: anchor.timestampMs + 5_000,
          luma: luma(index + 100),
          width: WIDTH,
          height: HEIGHT,
        }),
      ),
    });
    const plan = buildChannelPreanalysisLocalVisualCohortSamplingPlan([
      first,
      second,
    ]);
    const samples = plan.map((timestampMs, index) => {
      const shiftedAnchorIndex = first.anchors.findIndex(
        (anchor) => anchor.timestampMs + 5_000 === timestampMs,
      );
      return {
        timestampMs,
        luma:
          shiftedAnchorIndex < 0
            ? luma(index + 200)
            : reencoded(luma(shiftedAnchorIndex)),
        width: WIDTH,
        height: HEIGHT,
      };
    });

    expect(
      matchChannelPreanalysisVisualFingerprint(first, {
        durationMs: DURATION_MS,
        samples,
      }),
    ).toMatchObject({
      matched: true,
      globalOffsetMs: 5_000,
      matchedAnchorCount: 12,
    });
    const selection = selectUniqueChannelPreanalysisVisualFingerprint(
      [first, second],
      {
        durationMs: DURATION_MS,
        samples,
      },
    );
    expect(selection).toMatchObject({
      status: "none",
      match: null,
      result: null,
    });
    expect(
      selection.candidates.every(
        ({ globalOffsetMs }) =>
          globalOffsetMs === null || globalOffsetMs === 0,
      ),
    ).toBe(true);
  });

  it("builds a bounded seek plan and exposes stable Hamming distance", () => {
    const value = fingerprint();
    const plan = buildChannelPreanalysisLocalVisualSamplingPlan(value);
    const recoveryPlan = buildChannelPreanalysisLocalVisualSamplingPlan(
      value,
      { phase: "offset-recovery" },
    );
    expect(plan).toEqual([...plan].sort((left, right) => left - right));
    expect(plan).toHaveLength(12);
    expect(recoveryPlan).not.toContain(45_000);
    expect(plan.length).toBeLessThanOrEqual(
      CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_LOCAL_SAMPLES,
    );
    expect(recoveryPlan).toContain(45_000 - 30_000);
    expect(recoveryPlan).toContain(540_000 + 30_000);
    expect(hammingDistance64("0000000000000000", "ffffffffffffffff")).toBe(
      64,
    );
    expect(() =>
      matchChannelPreanalysisVisualFingerprint(value, {
        durationMs: DURATION_MS,
        samples: value.anchors.slice(0, 8).map(({ timestampMs }) => ({
          timestampMs,
          luma: new Uint8Array(64 * 36),
          width: 64,
          height: 36,
        })),
      }),
    ).toThrow(/canonical 32x18/u);
  });

  it("builds one bounded union plan for a visual cohort", () => {
    const firstSeed = fingerprint(VIDEO_ID, 0);
    const secondSeed = fingerprint(OTHER_VIDEO_ID, 20);
    const values = [
      createChannelPreanalysisVisualFingerprint({
        videoId: VIDEO_ID,
        sourceDurationMs: DURATION_MS - 1_900,
        createdAt: firstSeed.createdAt,
        anchors: firstSeed.anchors,
      }),
      createChannelPreanalysisVisualFingerprint({
        videoId: OTHER_VIDEO_ID,
        sourceDurationMs: DURATION_MS + 1_900,
        createdAt: secondSeed.createdAt,
        anchors: secondSeed.anchors,
      }),
    ];
    const plan =
      buildChannelPreanalysisLocalVisualCohortSamplingPlan(values);
    const first = values[0]!;

    expect(plan).toHaveLength(12);
    expect(plan).toEqual(
      buildChannelPreanalysisLocalVisualSamplingPlan(first),
    );
    expect(() =>
      buildChannelPreanalysisLocalVisualCohortSamplingPlan(
        new Array(
          CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_COHORT + 1,
        ).fill(first),
      ),
    ).toThrow(/cohort size/u);
    expect(() =>
      buildChannelPreanalysisLocalVisualCohortSamplingPlan([
        first,
        first,
      ]),
    ).toThrow(/duplicated/u);
  });
});
