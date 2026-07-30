import { describe, expect, it } from "vitest";

import {
  MAX_VISUAL_SAMPLE_COUNT,
  VISUAL_CANDIDATE_WINDOW_MS,
  VISUAL_FINGERPRINT_SIZE,
  analyzeLocalVideoVisuals,
  buildVisualSampleTimestamps,
  eraseLocalVideoLumaSamples,
  sampleLocalVideoLumaFrames,
  selectVisualHighlightsFromSamples,
  type LocalVideoVisualAnalysisAdapters,
  type LocalVideoVisualCanvas,
  type LocalVideoVisualProbe,
  type VisualFrameSample,
} from "./localVideoVisualAnalysis";

function fingerprint(luma: number): Uint8Array {
  return new Uint8Array(VISUAL_FINGERPRINT_SIZE).fill(luma);
}

function samplesFromValues(
  values: readonly number[],
  intervalMs = 5_000,
): readonly VisualFrameSample[] {
  return values.map((value, index) => ({
    timestampMs: index * intervalMs,
    fingerprint: fingerprint(value),
  }));
}

describe("visual fast-pass scoring core", () => {
  it("builds a deterministic duration-aware plan capped at 720 frames", () => {
    const fourHoursMs = 4 * 60 * 60 * 1_000;
    const plan = buildVisualSampleTimestamps(fourHoursMs);

    expect(plan).toHaveLength(MAX_VISUAL_SAMPLE_COUNT);
    expect(plan[0]).toBe(250);
    expect(plan.at(-1)).toBe(fourHoursMs - 251);
    expect(new Set(plan).size).toBe(plan.length);
    expect(plan).toEqual(buildVisualSampleTimestamps(fourHoursMs));
    expect(buildVisualSampleTimestamps(fourHoursMs, 10)).toHaveLength(10);
    expect(buildVisualSampleTimestamps(60_000)).toHaveLength(13);
  });

  it("does not invent candidates for a static scene", () => {
    const result = selectVisualHighlightsFromSamples(
      samplesFromValues(Array.from({ length: 30 }, () => 80)),
      150_000,
    );

    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.eligibleTransitionCount).toBe(0);
    expect(result.diagnostics.baselineSceneChangeStrength).toBe(0);
  });

  it("uses an absolute cut threshold when only two or three samples exist", () => {
    const twoSamples = selectVisualHighlightsFromSamples(
      samplesFromValues([0, 255]),
      10_000,
    );
    const threeSamples = selectVisualHighlightsFromSamples(
      samplesFromValues([0, 0, 255]),
      15_000,
    );

    expect(twoSamples.candidates).toHaveLength(1);
    expect(threeSamples.candidates).toHaveLength(1);
    expect(twoSamples.candidates[0]?.evidence.changedPixelRatio).toBe(1);
    expect(threeSamples.candidates[0]?.evidence.changedPixelRatio).toBe(1);
  });

  it("finds an outlying scene change and returns only serializable aggregate evidence", () => {
    const sourceDurationMs = 120_000;
    const samples = [
      10_000, 20_000, 30_000, 40_000, 50_000, 60_000, 70_000, 80_000,
      90_000, 100_000, 110_000, 119_000,
    ].map((timestampMs, index) => ({
      timestampMs,
      fingerprint: fingerprint(index === 11 ? 245 : 12),
    }));

    const result = selectVisualHighlightsFromSamples(samples, sourceDurationMs);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      id: "visual-110000-119000-75000-120000",
      startMs: 75_000,
      endMs: 120_000,
      evidence: {
        previousFrameMs: 110_000,
        currentFrameMs: 119_000,
        changedPixelRatio: 1,
      },
    });
    expect(result.candidates[0]?.reason).toContain("장면 전환");
    expect(result.candidateWindowMs).toBe(VISUAL_CANDIDATE_WINDOW_MS);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(JSON.stringify(result)).not.toContain("blob:");
    expect(result.candidates[0]).not.toHaveProperty("fingerprint");
    expect(result).not.toHaveProperty("file");
  });

  it("keeps candidates non-overlapping, deterministic, and capped at twelve", () => {
    const values = Array.from({ length: 240 }, (_, index) =>
      Math.floor(index / 12) % 2 === 0 ? 20 : 235,
    );
    const samples = samplesFromValues(values);
    const durationMs = values.length * 5_000;

    const first = selectVisualHighlightsFromSamples(samples, durationMs);
    const second = selectVisualHighlightsFromSamples(samples, durationMs);

    expect(first.candidates).toHaveLength(12);
    expect(first.candidates.map((candidate) => candidate.id)).toEqual(
      second.candidates.map((candidate) => candidate.id),
    );
    for (let index = 1; index < first.candidates.length; index += 1) {
      const previous = first.candidates[index - 1];
      const current = first.candidates[index];
      if (previous !== undefined && current !== undefined) {
        expect(
          Math.max(previous.startMs, current.startMs) <
            Math.min(previous.endMs, current.endMs),
        ).toBe(false);
      }
    }
  });

  it("rejects malformed fingerprints instead of scoring corrupted input", () => {
    expect(() =>
      selectVisualHighlightsFromSamples(
        [{ timestampMs: 1_000, fingerprint: new Uint8Array(10) }],
        10_000,
      ),
    ).toThrow(RangeError);
  });
});

type VideoEventType = "loadedmetadata" | "seeked" | "error";

class FakeVideoProbe implements LocalVideoVisualProbe {
  public src = "";
  public preload = "";
  public duration = 120;
  public readyState = 0;
  public seeking = false;
  public videoWidth = 1_920;
  public videoHeight = 1_080;
  public error: { code: number; message?: string } | null = null;
  public autoMetadata = true;
  public autoSeek = true;
  public throwWhenPausing = false;

  private currentTimeValue = 0;
  private readonly listeners: Record<VideoEventType, Set<EventListener>> = {
    loadedmetadata: new Set(),
    seeked: new Set(),
    error: new Set(),
  };

  public constructor(private readonly calls: string[]) {}

  public get currentTime(): number {
    return this.currentTimeValue;
  }

  public set currentTime(value: number) {
    this.currentTimeValue = value;
    this.seeking = true;
    this.calls.push(`seek:${value.toFixed(3)}`);
    if (this.autoSeek) {
      queueMicrotask(() => {
        this.readyState = 2;
        this.seeking = false;
        this.emit("seeked");
      });
    }
  }

  public addEventListener(type: VideoEventType, listener: EventListener): void {
    this.listeners[type].add(listener);
  }

  public removeEventListener(type: VideoEventType, listener: EventListener): void {
    this.listeners[type].delete(listener);
  }

  public pause(): void {
    this.calls.push("video:pause");
    if (this.throwWhenPausing) {
      throw new Error("pause failed");
    }
  }

  public removeAttribute(name: "src"): void {
    this.calls.push(`video:remove-attribute:${name}`);
    this.src = "";
  }

  public load(): void {
    if (this.src.length === 0) {
      this.calls.push("video:load-cleanup");
      return;
    }
    this.calls.push("video:load-source");
    if (this.autoMetadata) {
      queueMicrotask(() => {
        this.readyState = 1;
        this.emit("loadedmetadata");
      });
    }
  }

  public remove(): void {
    this.calls.push("video:remove");
  }

  public emit(type: VideoEventType): void {
    const event = { type } as Event;
    for (const listener of [...this.listeners[type]]) {
      listener(event);
    }
  }

  public listenerCount(): number {
    return Object.values(this.listeners).reduce((sum, listeners) => sum + listeners.size, 0);
  }
}

class FakeCanvas implements LocalVideoVisualCanvas {
  public width = 32;
  public height = 18;

  public constructor(private readonly calls: string[]) {}

  public remove(): void {
    this.calls.push("canvas:remove");
  }
}

interface VisualHarness {
  readonly adapters: LocalVideoVisualAnalysisAdapters;
  readonly calls: string[];
  readonly video: FakeVideoProbe;
  readonly canvas: FakeCanvas;
  readonly fireNextTimeout: () => void;
  captureThrows: boolean;
}

function createVisualHarness(): VisualHarness {
  const calls: string[] = [];
  const video = new FakeVideoProbe(calls);
  const canvas = new FakeCanvas(calls);
  const timeouts = new Map<number, () => void>();
  let nextTimeoutId = 1;
  const harness: VisualHarness = {
    calls,
    video,
    canvas,
    captureThrows: false,
    fireNextTimeout: () => {
      const entry = timeouts.entries().next().value as [number, () => void] | undefined;
      if (entry === undefined) {
        throw new Error("No timeout is pending.");
      }
      const [handle, callback] = entry;
      timeouts.delete(handle);
      callback();
    },
    adapters: {
      createObjectURL: () => {
        calls.push("url:create");
        return "blob:visual-analysis";
      },
      revokeObjectURL: (objectUrl) => {
        calls.push(`url:revoke:${objectUrl}`);
      },
      createVideoProbe: () => {
        calls.push("video:create");
        return video;
      },
      createCanvas: (width, height) => {
        calls.push(`canvas:create:${width}x${height}`);
        canvas.width = width;
        canvas.height = height;
        return canvas;
      },
      captureLumaFingerprint: (probe, surface, width, height) => {
        calls.push(`capture:${probe.currentTime.toFixed(3)}:${width}x${height}`);
        expect(surface).toBe(canvas);
        if (harness.captureThrows) {
          throw new Error("capture failed");
        }
        return fingerprint(probe.currentTime < 60 ? 20 : 235);
      },
      setTimeout: (callback, delayMs) => {
        const handle = nextTimeoutId;
        nextTimeoutId += 1;
        calls.push(`timeout:set:${delayMs}`);
        timeouts.set(handle, callback);
        return handle;
      },
      clearTimeout: (handle) => {
        calls.push("timeout:clear");
        timeouts.delete(handle);
      },
      yieldControl: async () => {
        await Promise.resolve();
      },
    },
  };
  return harness;
}

function fakeVideoFile(): File {
  return {
    name: "private-stream.mp4",
    size: 10_000_000,
    type: "video/mp4",
  } as File;
}

function expectFullResourceCleanup(harness: VisualHarness): void {
  expect(harness.calls).toContain("video:pause");
  expect(harness.calls).toContain("video:remove-attribute:src");
  expect(harness.calls).toContain("video:load-cleanup");
  expect(harness.calls).toContain("video:remove");
  expect(harness.calls).toContain("canvas:remove");
  expect(harness.calls).toContain("url:revoke:blob:visual-analysis");
  expect(harness.video.listenerCount()).toBe(0);
  expect(harness.video.src).toBe("");
  expect(harness.canvas.width).toBe(0);
  expect(harness.canvas.height).toBe(0);
}

describe("analyzeLocalVideoVisuals browser sampler", () => {
  it("samples a local object URL, reports progress, and cleans every resource", async () => {
    const harness = createVisualHarness();
    const progress: Array<{ stage: string; ratio: number }> = [];
    let cleanupWasCompleteWhenProgressReachedOne = false;

    const result = await analyzeLocalVideoVisuals(fakeVideoFile(), {
      adapters: harness.adapters,
      maxSampleCount: 20,
      onProgress: (update) => {
        progress.push({ stage: update.stage, ratio: update.ratio });
        if (update.stage === "complete") {
          cleanupWasCompleteWhenProgressReachedOne =
            harness.calls.includes("video:remove") &&
            harness.calls.includes("canvas:remove") &&
            harness.calls.includes("url:revoke:blob:visual-analysis");
        }
      },
    });

    expect(result.mode).toBe("local-video-visual-fast-pass");
    expect(result.plannedSampleCount).toBe(20);
    expect(result.sampledFrameCount).toBe(20);
    expect(result.coverageComplete).toBe(true);
    expect(result.candidates).toHaveLength(1);
    expect(progress[0]).toEqual({ stage: "loading-metadata", ratio: 0 });
    expect(progress.at(-1)).toEqual({ stage: "complete", ratio: 1 });
    expect(cleanupWasCompleteWhenProgressReachedOne).toBe(true);
    expect(progress.map(({ ratio }) => ratio)).toEqual(
      [...progress.map(({ ratio }) => ratio)].sort((left, right) => left - right),
    );
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(JSON.stringify(result)).not.toContain("private-stream.mp4");
    expect(JSON.stringify(result)).not.toContain("blob:visual-analysis");
    expectFullResourceCleanup(harness);
  });

  it("does not emit scoring or complete progress when cancelled during yield", async () => {
    const harness = createVisualHarness();
    const controller = new AbortController();
    const stages: string[] = [];
    let releaseYield = (): void => undefined;
    let reportYieldStarted = (): void => undefined;
    const yieldStarted = new Promise<void>((resolve) => {
      reportYieldStarted = resolve;
    });
    const yieldGate = new Promise<void>((resolve) => {
      releaseYield = resolve;
    });

    const pending = analyzeLocalVideoVisuals(fakeVideoFile(), {
      adapters: {
        ...harness.adapters,
        yieldControl: () => {
          reportYieldStarted();
          return yieldGate;
        },
      },
      signal: controller.signal,
      maxSampleCount: 2,
      onProgress: ({ stage }) => stages.push(stage),
    });

    await yieldStarted;
    controller.abort();
    releaseYield();

    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
    expect(stages).not.toContain("scoring");
    expect(stages).not.toContain("complete");
    expectFullResourceCleanup(harness);
  });

  it("preserves the operation error and reports cleanup failures together", async () => {
    const harness = createVisualHarness();
    harness.captureThrows = true;

    const pending = analyzeLocalVideoVisuals(fakeVideoFile(), {
      adapters: {
        ...harness.adapters,
        revokeObjectURL: (objectUrl) => {
          harness.calls.push(`url:revoke:${objectUrl}`);
          throw new Error("revoke failed");
        },
      },
      maxSampleCount: 1,
    });

    await expect(pending).rejects.toMatchObject({
      code: "FRAME_CAPTURE_FAILED",
      details: { failedCleanupSteps: "revoke-object-url" },
    });
    expectFullResourceCleanup(harness);
  });

  it("waits for seeked instead of capturing a stale ready frame after currentTime assignment", async () => {
    const harness = createVisualHarness();
    harness.video.autoSeek = false;
    harness.video.readyState = 2;

    const pending = analyzeLocalVideoVisuals(fakeVideoFile(), {
      adapters: harness.adapters,
      maxSampleCount: 1,
      seekTimeoutMs: 321,
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(harness.calls.filter((call) => call.startsWith("capture:"))).toHaveLength(0);
    harness.fireNextTimeout();

    await expect(pending).rejects.toMatchObject({ code: "SEEK_TIMEOUT" });
    expectFullResourceCleanup(harness);
  });

  it("aborts during sampling and removes listeners, elements, and the object URL", async () => {
    const harness = createVisualHarness();
    const controller = new AbortController();

    const pending = analyzeLocalVideoVisuals(fakeVideoFile(), {
      adapters: harness.adapters,
      signal: controller.signal,
      maxSampleCount: 20,
      onProgress: (progress) => {
        if (progress.stage === "sampling" && progress.completedSampleCount === 1) {
          controller.abort();
        }
      },
    });

    await expect(pending).rejects.toMatchObject({
      name: "LocalVideoVisualAnalysisError",
      code: "ABORTED",
    });
    expect(harness.calls.filter((call) => call.startsWith("capture:"))).toHaveLength(1);
    expectFullResourceCleanup(harness);
  });

  it("times out while loading metadata and still performs full cleanup", async () => {
    const harness = createVisualHarness();
    harness.video.autoMetadata = false;
    const pending = analyzeLocalVideoVisuals(fakeVideoFile(), {
      adapters: harness.adapters,
      metadataTimeoutMs: 123,
    });

    harness.fireNextTimeout();

    await expect(pending).rejects.toMatchObject({
      code: "METADATA_TIMEOUT",
      details: { timeoutMs: 123 },
    });
    expectFullResourceCleanup(harness);
  });

  it("times out while seeking and still performs full cleanup", async () => {
    const harness = createVisualHarness();
    harness.video.autoSeek = false;
    const pending = analyzeLocalVideoVisuals(fakeVideoFile(), {
      adapters: harness.adapters,
      seekTimeoutMs: 321,
      maxSampleCount: 5,
    });
    await Promise.resolve();
    await Promise.resolve();

    harness.fireNextTimeout();

    await expect(pending).rejects.toMatchObject({
      code: "SEEK_TIMEOUT",
      details: { timeoutMs: 321 },
    });
    expectFullResourceCleanup(harness);
  });

  it("cleans resources after a frame capture failure", async () => {
    const harness = createVisualHarness();
    harness.captureThrows = true;

    await expect(
      analyzeLocalVideoVisuals(fakeVideoFile(), {
        adapters: harness.adapters,
        maxSampleCount: 5,
      }),
    ).rejects.toMatchObject({ code: "FRAME_CAPTURE_FAILED" });
    expectFullResourceCleanup(harness);
  });

  it("attempts later cleanup steps even if pausing the video fails", async () => {
    const harness = createVisualHarness();
    harness.video.throwWhenPausing = true;

    await expect(
      analyzeLocalVideoVisuals(fakeVideoFile(), {
        adapters: harness.adapters,
        maxSampleCount: 5,
      }),
    ).rejects.toMatchObject({
      code: "CLEANUP_FAILED",
      details: { failedCleanupSteps: "pause-video" },
    });
    expect(harness.calls).toContain("video:remove-attribute:src");
    expect(harness.calls).toContain("video:load-cleanup");
    expect(harness.calls).toContain("video:remove");
    expect(harness.calls).toContain("canvas:remove");
    expect(harness.calls).toContain("url:revoke:blob:visual-analysis");
  });
});

describe("explicit local luma sampling", () => {
  it("captures only the requested timestamps and lets the caller erase them", async () => {
    const harness = createVisualHarness();

    const result = await sampleLocalVideoLumaFrames(
      fakeVideoFile(),
      [10_000, 60_000, 110_000],
      { adapters: harness.adapters },
    );

    expect(result.sourceDurationMs).toBe(120_000);
    expect(result.samples.map(({ timestampMs }) => timestampMs)).toEqual([
      10_000,
      60_000,
      110_000,
    ]);
    expect(result.samples[0]?.luma[0]).toBe(20);
    expect(result.samples[1]?.luma[0]).toBe(235);
    expectFullResourceCleanup(harness);

    eraseLocalVideoLumaSamples(result.samples);
    expect(result.samples.every(({ luma }) => luma.every((value) => value === 0)))
      .toBe(true);
  });

  it("rejects an out-of-range sample and erases captured luma before failing", async () => {
    const harness = createVisualHarness();

    await expect(
      sampleLocalVideoLumaFrames(
        fakeVideoFile(),
        [10_000, 120_000],
        { adapters: harness.adapters },
      ),
    ).rejects.toMatchObject({ code: "INVALID_SAMPLE_PLAN" });
    expect(harness.calls.filter((call) => call.startsWith("capture:"))).toHaveLength(0);
    expectFullResourceCleanup(harness);
  });
});
