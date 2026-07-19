import { describe, expect, it } from "vitest";

import {
  formatBytes,
  formatDuration,
  inspectLocalMedia,
  MAX_LOCAL_MEDIA_DURATION_MS,
  type BrowserCapabilitySupport,
  type LocalMediaPreflightAdapters,
  type LocalMediaVideoProbe,
} from "./localMediaPreflight";

type ProbeEventType = "loadedmetadata" | "error";
type ProbeListener = () => void;

class FakeVideoProbe implements LocalMediaVideoProbe {
  public src = "";
  public preload = "";
  public duration = Number.NaN;
  public error: { code: number; message?: string } | null = null;
  public throwWhenPausing = false;

  private readonly listeners: Record<ProbeEventType, Set<ProbeListener>> = {
    loadedmetadata: new Set(),
    error: new Set(),
  };

  public constructor(private readonly calls: string[]) {}

  public addEventListener(type: ProbeEventType, listener: ProbeListener): void {
    this.listeners[type].add(listener);
  }

  public removeEventListener(type: ProbeEventType, listener: ProbeListener): void {
    this.listeners[type].delete(listener);
  }

  public pause(): void {
    this.calls.push("pause");
    if (this.throwWhenPausing) {
      throw new Error("pause failed");
    }
  }

  public removeAttribute(name: "src"): void {
    this.calls.push(`remove:${name}`);
    this.src = "";
  }

  public load(): void {
    this.calls.push(this.src.length > 0 ? "load:metadata" : "load:cleanup");
  }

  public emit(type: ProbeEventType): void {
    for (const listener of [...this.listeners[type]]) {
      listener();
    }
  }

  public listenerCount(): number {
    return this.listeners.loadedmetadata.size + this.listeners.error.size;
  }
}

type Harness = {
  readonly adapters: LocalMediaPreflightAdapters;
  readonly calls: string[];
  readonly probe: FakeVideoProbe;
  readonly fireTimeout: () => void;
};

function createHarness(
  capabilities: BrowserCapabilitySupport = {
    webAssembly: true,
    worker: true,
    webCodecsVideoDecoder: true,
    webGpu: true,
    crossOriginIsolated: false,
  },
): Harness {
  const calls: string[] = [];
  const probe = new FakeVideoProbe(calls);
  let timeoutCallback: (() => void) | null = null;
  const timeoutHandle = { id: "metadata-timeout" };

  return {
    calls,
    probe,
    fireTimeout: () => {
      if (timeoutCallback === null) {
        throw new Error("No timeout was scheduled");
      }
      timeoutCallback();
    },
    adapters: {
      createObjectURL: () => {
        calls.push("create:blob:local-media");
        return "blob:local-media";
      },
      revokeObjectURL: (objectUrl) => {
        calls.push(`revoke:${objectUrl}`);
      },
      createVideoProbe: () => probe,
      setTimeout: (callback, delayMs) => {
        calls.push(`set-timeout:${delayMs}`);
        timeoutCallback = callback;
        return timeoutHandle;
      },
      clearTimeout: (handle) => {
        expect(handle).toBe(timeoutHandle);
        calls.push("clear-timeout");
        timeoutCallback = null;
      },
      readBrowserCapabilities: () => capabilities,
    },
  };
}

function fakeFile(
  overrides: Partial<Pick<File, "name" | "size" | "type">> = {},
): File {
  return {
    name: " 방송 원본.MP4",
    size: 1_572_864,
    type: "video/mp4",
    ...overrides,
  } as File;
}

function expectCoreCleanup(harness: Harness): void {
  expect(harness.calls).toContain("clear-timeout");
  expect(harness.calls).toContain("pause");
  expect(harness.calls).toContain("remove:src");
  expect(harness.calls).toContain("load:cleanup");
  expect(harness.calls).toContain("revoke:blob:local-media");
  expect(harness.probe.src).toBe("");
  expect(harness.probe.listenerCount()).toBe(0);

  const pauseIndex = harness.calls.indexOf("pause");
  const clearSourceIndex = harness.calls.indexOf("remove:src");
  const resetIndex = harness.calls.indexOf("load:cleanup");
  const revokeIndex = harness.calls.indexOf("revoke:blob:local-media");
  expect(pauseIndex).toBeLessThan(clearSourceIndex);
  expect(clearSourceIndex).toBeLessThan(resetIndex);
  expect(resetIndex).toBeLessThan(revokeIndex);
}

describe("inspectLocalMedia", () => {
  it("resolves only after loadedmetadata and returns serializable metadata", async () => {
    const harness = createHarness();
    const file = fakeFile();
    let settled = false;

    const pending = inspectLocalMedia(file, {
      timeoutMs: 2_000,
      adapters: harness.adapters,
    });
    void pending.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    harness.probe.duration = 65.432;
    harness.probe.emit("loadedmetadata");
    const result = await pending;

    expect(result).toEqual({
      metadata: {
        name: " 방송 원본.MP4",
        sizeBytes: 1_572_864,
        mimeType: "video/mp4",
        durationMs: 65_432,
        kind: "video",
        extension: "mp4",
      },
      capabilities: {
        webAssembly: true,
        worker: true,
        webCodecsVideoDecoder: true,
        webGpu: true,
        crossOriginIsolated: false,
        preferredRuntimeTier: "webgpu",
      },
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(JSON.stringify(result)).not.toContain("blob:local-media");
    expect(result).not.toHaveProperty("file");
    expectCoreCleanup(harness);
  });

  it("does not infer unsupported codec capability from an unknown extension", async () => {
    const harness = createHarness({
      webAssembly: true,
      worker: true,
      webCodecsVideoDecoder: false,
      webGpu: false,
      crossOriginIsolated: true,
    });
    const pending = inspectLocalMedia(
      fakeFile({ name: "looks-like-video.h265", type: "application/octet-stream" }),
      { adapters: harness.adapters },
    );

    harness.probe.duration = 1;
    harness.probe.emit("loadedmetadata");
    const result = await pending;

    expect(result.metadata).toMatchObject({ kind: "unknown", extension: "h265" });
    expect(result.capabilities).toMatchObject({
      webCodecsVideoDecoder: false,
      preferredRuntimeTier: "wasm",
    });
    expect(result.capabilities).not.toHaveProperty("codecSupported");
    expectCoreCleanup(harness);
  });

  it("recognizes a common video extension when Windows supplies no MIME type", async () => {
    const harness = createHarness();
    const pending = inspectLocalMedia(
      fakeFile({ name: "recording.MKV", type: "" }),
      { adapters: harness.adapters },
    );

    harness.probe.duration = 15;
    harness.probe.emit("loadedmetadata");
    const result = await pending;

    expect(result.metadata).toMatchObject({
      kind: "video",
      extension: "mkv",
      mimeType: "",
    });
    expectCoreCleanup(harness);
  });

  it("aborts an active metadata probe and still releases every temporary resource", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const pending = inspectLocalMedia(fakeFile(), {
      adapters: harness.adapters,
      signal: controller.signal,
    });

    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
    expectCoreCleanup(harness);
  });

  it("falls back to signals-only when a Worker is unavailable", async () => {
    const harness = createHarness({
      webAssembly: true,
      worker: false,
      webCodecsVideoDecoder: true,
      webGpu: true,
      crossOriginIsolated: false,
    });
    const pending = inspectLocalMedia(fakeFile(), { adapters: harness.adapters });

    harness.probe.duration = 2;
    harness.probe.emit("loadedmetadata");

    await expect(pending).resolves.toMatchObject({
      capabilities: { preferredRuntimeTier: "signals-only" },
    });
    expectCoreCleanup(harness);
  });

  it("returns a meaningful media error and cleans up after probe failure", async () => {
    const harness = createHarness();
    const pending = inspectLocalMedia(fakeFile(), { adapters: harness.adapters });

    harness.probe.error = { code: 4, message: "source not supported" };
    harness.probe.emit("error");

    await expect(pending).rejects.toMatchObject({
      name: "LocalMediaPreflightError",
      code: "METADATA_LOAD_FAILED",
      details: {
        mediaErrorCode: 4,
        mediaErrorMessage: "source not supported",
      },
    });
    expectCoreCleanup(harness);
  });

  it("times out with a stable code and cleans up the probe and object URL", async () => {
    const harness = createHarness();
    const pending = inspectLocalMedia(fakeFile(), {
      timeoutMs: 250,
      adapters: harness.adapters,
    });

    harness.fireTimeout();

    await expect(pending).rejects.toMatchObject({
      name: "LocalMediaPreflightError",
      code: "METADATA_TIMEOUT",
      details: { timeoutMs: 250 },
    });
    expectCoreCleanup(harness);
  });

  it("rejects an invalid duration and still performs full cleanup", async () => {
    const harness = createHarness();
    const pending = inspectLocalMedia(fakeFile(), { adapters: harness.adapters });

    harness.probe.duration = Number.POSITIVE_INFINITY;
    harness.probe.emit("loadedmetadata");

    await expect(pending).rejects.toMatchObject({ code: "INVALID_DURATION" });
    expectCoreCleanup(harness);
  });

  it("accepts a recording that is exactly 12 hours long", async () => {
    const harness = createHarness();
    const pending = inspectLocalMedia(fakeFile(), { adapters: harness.adapters });

    harness.probe.duration = MAX_LOCAL_MEDIA_DURATION_MS / 1_000;
    harness.probe.emit("loadedmetadata");

    await expect(pending).resolves.toMatchObject({
      metadata: { durationMs: MAX_LOCAL_MEDIA_DURATION_MS },
    });
    expectCoreCleanup(harness);
  });

  it("rejects a recording longer than 12 hours before analysis starts", async () => {
    const harness = createHarness();
    const pending = inspectLocalMedia(fakeFile(), { adapters: harness.adapters });

    harness.probe.duration = MAX_LOCAL_MEDIA_DURATION_MS / 1_000 + 0.001;
    harness.probe.emit("loadedmetadata");

    await expect(pending).rejects.toMatchObject({
      code: "DURATION_LIMIT_EXCEEDED",
      details: {
        durationMs: MAX_LOCAL_MEDIA_DURATION_MS + 1,
        maximumDurationMs: MAX_LOCAL_MEDIA_DURATION_MS,
      },
    });
    expectCoreCleanup(harness);
  });

  it("attempts every cleanup step even when an earlier cleanup action throws", async () => {
    const harness = createHarness();
    harness.probe.throwWhenPausing = true;
    const pending = inspectLocalMedia(fakeFile(), { adapters: harness.adapters });

    harness.probe.duration = 3;
    harness.probe.emit("loadedmetadata");

    await expect(pending).rejects.toMatchObject({
      code: "CLEANUP_FAILED",
      details: { failedCleanupSteps: "pause-probe" },
    });
    expect(harness.calls).toContain("remove:src");
    expect(harness.calls).toContain("load:cleanup");
    expect(harness.calls).toContain("revoke:blob:local-media");
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [1_023, "1023 B"],
    [1_024, "1 KB"],
    [1_536, "1.5 KB"],
    [1_572_864, "1.5 MB"],
    [5 * 1_024 ** 3, "5 GB"],
  ])("formats %d bytes as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  it("rejects invalid byte counts", () => {
    expect(() => formatBytes(-1)).toThrow(RangeError);
    expect(() => formatBytes(Number.NaN)).toThrow(RangeError);
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "00:00:00"],
    [999, "00:00:00"],
    [65_000, "00:01:05"],
    [3_661_999, "01:01:01"],
    [100 * 3_600_000, "100:00:00"],
  ])("formats %d milliseconds as %s", (durationMs, expected) => {
    expect(formatDuration(durationMs)).toBe(expected);
  });

  it("rejects invalid durations", () => {
    expect(() => formatDuration(-1)).toThrow(RangeError);
    expect(() => formatDuration(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
