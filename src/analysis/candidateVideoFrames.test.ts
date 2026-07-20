import { describe, expect, it } from "vitest";

import {
  CANDIDATE_VIDEO_FRAME_SAMPLE_RATIOS,
  candidateVideoFrameTimestamps,
} from "./candidateVideoFrames";

describe("candidateVideoFrames", () => {
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
});
