import { describe, expect, it } from "vitest";

import {
  AUDIO_REACTION_CANDIDATE_WINDOW_MS,
  MAX_AUDIO_REACTION_CANDIDATE_COUNT,
  selectAudioReactionHighlights,
  type AudioReactionFeatureWindow,
} from "./localAudioReactionAnalysisCore";

function speechWindow(
  index: number,
  overrides: Partial<AudioReactionFeatureWindow> = {},
): AudioReactionFeatureWindow {
  const rms = overrides.rms ?? 0.055 + (index % 4) * 0.002;
  return {
    startMs: index * 1_000,
    endMs: (index + 1) * 1_000,
    rms,
    peak: overrides.peak ?? Math.min(1, rms * 3),
    zeroCrossingRate: overrides.zeroCrossingRate ?? 0.09 + (index % 3) * 0.005,
    speechBandEnergyRatio: overrides.speechBandEnergyRatio ?? 0.52,
  };
}

function baseline(length: number): AudioReactionFeatureWindow[] {
  return Array.from({ length }, (_, index) => speechWindow(index));
}

function setReaction(
  windows: AudioReactionFeatureWindow[],
  startIndex: number,
  values: readonly number[],
): void {
  values.forEach((rms, offset) => {
    const index = startIndex + offset;
    windows[index] = speechWindow(index, {
      rms,
      peak: Math.min(0.92, rms * 3.1),
      zeroCrossingRate: 0.14 + (offset % 3) * 0.035,
      speechBandEnergyRatio: 0.72 + (offset % 2) * 0.08,
    });
  });
}

describe("local audio reaction scoring core", () => {
  it("does not mistake ordinary speech variation for a highlight", () => {
    const result = selectAudioReactionHighlights(baseline(120), 120_000);

    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.eligibleEventCount).toBe(0);
    expect(result.plannedWindowCount).toBe(120);
    expect(result.coverageComplete).toBe(true);
  });

  it("does not report complete coverage when a decoded feature window is missing", () => {
    const windows = baseline(10).filter((_, index) => index !== 4);

    const result = selectAudioReactionHighlights(windows, 10_000, {
      plannedWindowCount: 10,
    });

    expect(result.analyzedWindowCount).toBe(9);
    expect(result.coverageComplete).toBe(false);
  });

  it("finds a multi-window laugh/shout-like reaction and leads with context", () => {
    const windows = baseline(100);
    setReaction(windows, 45, [0.16, 0.24, 0.18, 0.26, 0.17]);

    const result = selectAudioReactionHighlights(windows, 100_000);
    const candidate = result.candidates[0];

    expect(candidate?.evidence.eventKind).toBe("sustained-vocal-reaction");
    expect(candidate?.evidence.activeWindowCount).toBeGreaterThanOrEqual(3);
    expect(candidate?.reason).toContain("오디오만으로는 실제 사건 내용을 알 수 없어");
    expect(candidate).toBeDefined();
    if (candidate !== undefined) {
      expect(candidate.endMs - candidate.startMs).toBe(
        AUDIO_REACTION_CANDIDATE_WINDOW_MS,
      );
      expect(candidate.peakMs - candidate.startMs).toBeGreaterThan(
        candidate.endMs - candidate.peakMs,
      );
    }
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(JSON.stringify(result)).not.toMatch(/pcm|filename|transcript|speaker/iu);
  });

  it("distinguishes a short loudness burst from a sustained reaction", () => {
    const windows = baseline(90);
    setReaction(windows, 40, [0.22, 0.2]);

    const result = selectAudioReactionHighlights(windows, 90_000);

    expect(result.candidates[0]?.evidence.eventKind).toBe("short-loudness-burst");
  });

  it("rejects an isolated high-crest click", () => {
    const windows = baseline(80);
    windows[30] = speechWindow(30, {
      rms: 0.16,
      peak: 1,
      zeroCrossingRate: 0.48,
      speechBandEnergyRatio: 0.15,
    });

    const result = selectAudioReactionHighlights(windows, 80_000);

    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.impulseLikeWindowCount).toBe(1);
  });

  it("does not label an ordinary high-crest baseline as repeated impulses", () => {
    const windows = baseline(80).map((window) => ({
      ...window,
      peak: Math.min(1, window.rms * 6),
    }));

    const result = selectAudioReactionHighlights(windows, 80_000);

    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.impulseLikeWindowCount).toBe(0);
  });

  it("uses temporally supported high-crest windows only around a vocal anchor", () => {
    const windows = baseline(100);
    for (const [offset, rms] of [0.16, 0.22, 0.18].entries()) {
      const index = 45 + offset;
      windows[index] = speechWindow(index, {
        rms,
        peak: 1,
        zeroCrossingRate: 0.18,
        speechBandEnergyRatio: offset === 1 ? 0.72 : 0.2,
      });
    }

    const result = selectAudioReactionHighlights(windows, 100_000);

    expect(result.diagnostics.impulseLikeWindowCount).toBe(0);
    expect(result.candidates[0]?.evidence).toMatchObject({
      activeWindowCount: 1,
      sustainedWindowCount: 3,
    });
  });

  it("does not let consecutive low-vocal transients seed a candidate", () => {
    const windows = baseline(80);
    for (const index of [30, 31]) {
      windows[index] = speechWindow(index, {
        rms: 0.16,
        peak: 1,
        zeroCrossingRate: 0.48,
        speechBandEnergyRatio: 0.15,
      });
    }

    const result = selectAudioReactionHighlights(windows, 80_000);

    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.eligibleEventCount).toBe(0);
  });

  it("does not treat transients across a missing feature window as continuous", () => {
    const windows = baseline(80)
      .filter((_, index) => index !== 31)
      .map((window) =>
        window.startMs === 30_000 || window.startMs === 32_000
          ? {
              ...window,
              rms: 0.16,
              peak: 1,
              zeroCrossingRate: 0.48,
              speechBandEnergyRatio: 0.15,
            }
          : window,
      );

    const result = selectAudioReactionHighlights(windows, 80_000, {
      plannedWindowCount: 80,
    });

    expect(result.coverageComplete).toBe(false);
    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.impulseLikeWindowCount).toBe(2);
  });

  it("keeps an isolated high-crest burst with strong vocal-band support", () => {
    const windows = baseline(80);
    windows[30] = speechWindow(30, {
      rms: 0.16,
      peak: 1,
      zeroCrossingRate: 0.2,
      speechBandEnergyRatio: 0.82,
    });

    const result = selectAudioReactionHighlights(windows, 80_000);

    expect(result.diagnostics.impulseLikeWindowCount).toBe(0);
    expect(result.candidates[0]?.evidence).toMatchObject({
      eventKind: "short-loudness-burst",
      activeWindowCount: 1,
    });
  });

  it("rejects a long, steady loud game/background plateau", () => {
    const windows = baseline(140);
    for (let index = 40; index < 80; index += 1) {
      windows[index] = speechWindow(index, {
        rms: 0.24,
        peak: 0.68,
        zeroCrossingRate: 0.29,
        speechBandEnergyRatio: 0.18,
      });
    }

    const result = selectAudioReactionHighlights(windows, 140_000);

    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.suppressedSustainedBackgroundCount).toBeGreaterThan(0);
  });

  it("clamps a candidate to a source shorter than thirty seconds", () => {
    const windows = baseline(24);
    setReaction(windows, 9, [0.18, 0.25, 0.17, 0.23]);

    const result = selectAudioReactionHighlights(windows, 24_000);

    expect(result.candidates[0]).toMatchObject({ startMs: 0, endMs: 24_000 });
    expect(result.candidateWindowMs).toBe(24_000);
  });

  it("is deterministic, non-overlapping, and capped at twelve candidates", () => {
    const windows = baseline(1_300);
    for (let index = 45; index < 1_260; index += 60) {
      setReaction(windows, index, [0.18, 0.25, 0.17, 0.23]);
    }

    const first = selectAudioReactionHighlights(windows, 1_300_000);
    const second = selectAudioReactionHighlights(windows, 1_300_000);

    expect(first.candidates).toHaveLength(MAX_AUDIO_REACTION_CANDIDATE_COUNT);
    expect(first).toEqual(second);
    for (let index = 1; index < first.candidates.length; index += 1) {
      const current = first.candidates[index];
      if (current === undefined) {
        continue;
      }
      for (const previous of first.candidates.slice(0, index)) {
        expect(
          Math.max(previous.startMs, current.startMs) <
            Math.min(previous.endMs, current.endMs),
        ).toBe(false);
      }
    }
  });
});
