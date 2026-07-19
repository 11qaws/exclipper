import { describe, expect, it } from "vitest";

import {
  CANDIDATE_PASS_B_MODEL_DOWNLOAD_MINIMUM_BYTES,
  CandidatePassBModelDownloadTracker,
} from "./candidatePassBModelDownloadProgress";

const MODEL_ID = "onnx-community/whisper-tiny";

function event(
  status: "initiate" | "download" | "progress" | "done",
  file: string,
  bytes: { readonly loaded?: number; readonly total?: number } = {},
): Record<string, unknown> {
  return { status, name: MODEL_ID, file, ...bytes };
}

describe("CandidatePassBModelDownloadTracker", () => {
  it("does not turn one completed small config file into near-complete model progress", () => {
    const tracker = new CandidatePassBModelDownloadTracker();
    const configBytes = 2 * 1024 * 1024;

    tracker.update(event("initiate", "tokenizer.json"));
    const progress = tracker.update(
      event("progress", "tokenizer.json", {
        loaded: configBytes,
        total: configBytes,
      }),
    );
    const done = tracker.update(event("done", "tokenizer.json"));

    expect(progress?.ratio).toBeCloseTo(
      configBytes / CANDIDATE_PASS_B_MODEL_DOWNLOAD_MINIMUM_BYTES,
    );
    expect(done?.ratio).toBeLessThan(0.1);
    expect(done?.loadedBytes).toBe(configBytes);
    expect(done?.totalBytes).toBeNull();
  });

  it("sums interleaved files by identity instead of double-counting callbacks", () => {
    const tracker = new CandidatePassBModelDownloadTracker();
    const mebibyte = 1024 * 1024;

    tracker.update(event("progress", "onnx/encoder_model_quantized.onnx", {
      loaded: 5 * mebibyte,
      total: 10 * mebibyte,
    }));
    tracker.update(event("progress", "onnx/decoder_model_merged_quantized.onnx", {
      loaded: 8 * mebibyte,
      total: 30 * mebibyte,
    }));
    const progress = tracker.update(
      event("progress", "onnx/decoder_model_merged_quantized.onnx", {
        loaded: 12 * mebibyte,
        total: 30 * mebibyte,
      }),
    );

    expect(progress?.loadedBytes).toBe(17 * mebibyte);
    expect(progress?.totalBytes).toBeNull();
    expect(progress?.ratio).toBeCloseTo(
      (17 * mebibyte) / CANDIDATE_PASS_B_MODEL_DOWNLOAD_MINIMUM_BYTES,
    );
  });

  it("keeps an expanding unknown stream conservative until ready", () => {
    const tracker = new CandidatePassBModelDownloadTracker();
    const mebibyte = 1024 * 1024;

    const firstChunk = tracker.update(
      event("progress", "onnx/decoder_model_merged_quantized.onnx", {
        loaded: mebibyte,
        total: mebibyte,
      }),
    );
    const secondChunk = tracker.update(
      event("progress", "onnx/decoder_model_merged_quantized.onnx", {
        loaded: 2 * mebibyte,
        total: 2 * mebibyte,
      }),
    );

    expect(firstChunk?.totalBytes).toBeNull();
    expect(secondChunk?.totalBytes).toBeNull();
    expect(secondChunk?.ratio).toBeGreaterThan(firstChunk?.ratio ?? 0);
    expect(secondChunk?.ratio).toBeLessThan(0.1);
  });

  it("publishes an exact aggregate only after every observed file is done and ready", () => {
    const tracker = new CandidatePassBModelDownloadTracker();
    const mebibyte = 1024 * 1024;

    tracker.update(event("progress", "encoder.onnx", {
      loaded: 10 * mebibyte,
      total: 10 * mebibyte,
    }));
    tracker.update(event("done", "encoder.onnx"));
    tracker.update(event("progress", "decoder.onnx", {
      loaded: 30 * mebibyte,
      total: 30 * mebibyte,
    }));
    tracker.update(event("done", "decoder.onnx"));
    const ready = tracker.update({ status: "ready" });

    expect(ready).toEqual({
      ratio: 1,
      loadedBytes: 40 * mebibyte,
      totalBytes: 40 * mebibyte,
    });
  });

  it("ignores malformed and unrelated callbacks", () => {
    const tracker = new CandidatePassBModelDownloadTracker();

    expect(tracker.update(null)).toBeNull();
    expect(tracker.update({ status: "progress", file: "model.onnx" })).toBeNull();
    expect(tracker.update({ status: "compile", name: MODEL_ID, file: "model.onnx" })).toBeNull();
  });
});
