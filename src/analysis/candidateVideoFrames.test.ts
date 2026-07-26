import { describe, expect, it } from "vitest";

import {
  CANDIDATE_VIDEO_FRAME_SAMPLE_RATIOS,
  candidateVideoFrameDimensions,
  candidateVideoFrameTimestamps,
} from "./candidateVideoFrames";

describe("candidateVideoFrames", () => {
  it("caps either landscape or portrait frames to 640px on the longest edge", () => {
    expect(candidateVideoFrameDimensions(1_920, 1_080)).toEqual({
      width: 640,
      height: 360,
    });
    expect(candidateVideoFrameDimensions(1_080, 1_920)).toEqual({
      width: 360,
      height: 640,
    });
  });

  it("chooses four representative relative timestamps inside a candidate", () => {
    expect(candidateVideoFrameTimestamps(120_000, 180_000)).toEqual(
      CANDIDATE_VIDEO_FRAME_SAMPLE_RATIOS.map((ratio) => Math.round(60_000 * ratio)),
    );
  });

  it("rejects ranges outside the 60-second Pass B contract", () => {
    expect(candidateVideoFrameTimestamps(0, 0)).toEqual([]);
    expect(candidateVideoFrameTimestamps(0, 60_001)).toEqual([]);
    expect(candidateVideoFrameTimestamps(-1, 1_000)).toEqual([]);
  });

  it("prioritizes frames around the reaction peak when a focus timestamp is supplied", () => {
    expect(candidateVideoFrameTimestamps(120_000, 180_000, 150_000)).toEqual([
      24_000,
      28_500,
      31_500,
      36_000,
    ]);
  });

  it("still produces four distinct timestamps when the reaction peak touches an edge", () => {
    const nearStart = candidateVideoFrameTimestamps(120_000, 150_000, 120_000);
    const nearEnd = candidateVideoFrameTimestamps(120_000, 150_000, 150_000);

    expect(nearStart).toHaveLength(4);
    expect(new Set(nearStart).size).toBe(4);
    expect(nearStart.every((timestamp) => timestamp >= 0 && timestamp < 30_000)).toBe(true);
    expect(nearEnd).toHaveLength(4);
    expect(new Set(nearEnd).size).toBe(4);
    expect(nearEnd.every((timestamp) => timestamp >= 0 && timestamp < 30_000)).toBe(true);
  });
});
