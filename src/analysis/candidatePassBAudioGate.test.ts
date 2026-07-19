import { describe, expect, it } from "vitest";

import {
  CANDIDATE_PASS_B_AUDIO_GATE_MIN_ACTIVE_RATIO,
  summarizeCandidatePassBAudioGate,
} from "./candidatePassBAudioGate";

const SAMPLE_RATE_HZ = 16_000;

describe("summarizeCandidatePassBAudioGate", () => {
  it("rejects digital silence and non-finite samples", () => {
    const pcm = new Float32Array(SAMPLE_RATE_HZ * 30);
    pcm[100] = Number.NaN;
    pcm[200] = Number.POSITIVE_INFINITY;

    expect(summarizeCandidatePassBAudioGate(pcm, SAMPLE_RATE_HZ)).toMatchObject({
      activeFrameCount: 0,
      activeFrameRatio: 0,
      audible: false,
    });
  });

  it("rejects one short click instead of sending it to speech recognition", () => {
    const pcm = new Float32Array(SAMPLE_RATE_HZ * 30);
    pcm[10_000] = 1;

    const result = summarizeCandidatePassBAudioGate(pcm, SAMPLE_RATE_HZ);

    expect(result.activeFrameRatio).toBeLessThan(
      CANDIDATE_PASS_B_AUDIO_GATE_MIN_ACTIVE_RATIO,
    );
    expect(result.audible).toBe(false);
  });

  it("accepts a sustained voice-like waveform without retaining the PCM", () => {
    const pcm = new Float32Array(SAMPLE_RATE_HZ * 30);
    const start = SAMPLE_RATE_HZ * 10;
    const end = start + SAMPLE_RATE_HZ;
    for (let index = start; index < end; index += 1) {
      pcm[index] = Math.sin((2 * Math.PI * 440 * index) / SAMPLE_RATE_HZ) * 0.08;
    }

    const result = summarizeCandidatePassBAudioGate(pcm, SAMPLE_RATE_HZ);

    expect(result.activeFrameRatio).toBeGreaterThanOrEqual(
      CANDIDATE_PASS_B_AUDIO_GATE_MIN_ACTIVE_RATIO,
    );
    expect(result.audible).toBe(true);
    expect(Object.keys(result)).not.toContain("pcm");
  });

  it("rejects an invalid sample rate", () => {
    expect(() =>
      summarizeCandidatePassBAudioGate(new Float32Array(1), 0),
    ).toThrow(RangeError);
  });
});
