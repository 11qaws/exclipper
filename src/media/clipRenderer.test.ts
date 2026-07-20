import { describe, expect, it } from "vitest";

import {
  ClipRenderError,
  buildClipFileName,
  inferClipOutputKind,
  validateClipTimeRange,
} from "./clipRenderer";

describe("clip renderer helpers", () => {
  it("uses WebM output for WebM sources and MP4 otherwise", () => {
    expect(inferClipOutputKind({ name: "stream.webm", type: "" })).toBe("webm");
    expect(inferClipOutputKind({ name: "stream.bin", type: "video/webm" })).toBe("webm");
    expect(inferClipOutputKind({ name: "stream.mp4", type: "video/mp4" })).toBe("mp4");
  });

  it("formats deterministic candidate filenames", () => {
    expect(
      buildClipFileName(
        3,
        { startMs: 3_661_000, endMs: 3_721_000 },
        "mp4",
      ),
    ).toBe("exclipper-03-01-01-01-01-02-01.mp4");
  });

  it("rejects invalid ranges before opening media", () => {
    expect(() => validateClipTimeRange({ startMs: 10_000, endMs: 10_000 })).toThrowError(
      ClipRenderError,
    );
    expect(() => validateClipTimeRange({ startMs: -1, endMs: 10_000 })).toThrowError(
      ClipRenderError,
    );
    expect(() => validateClipTimeRange({ startMs: 10_000.5, endMs: 20_000 })).toThrowError(
      ClipRenderError,
    );
  });
});
