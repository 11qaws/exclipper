import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
} from "../../src/analysis/candidatePassBWorkerProtocol.ts";
import {
  CHANNEL_PREANALYSIS_REVIEW_FRAME_MAX_BYTES,
} from "../../src/analysis/channelPreanalysisReviewBundle.ts";
import {
  CHANNEL_PREANALYSIS_REVIEW_FRAME_JPEG_QUALITY,
  ChannelPreanalysisReviewMediaAdapterError,
  createChannelPreanalysisReviewMediaExtractor,
} from "./channel-preanalysis-review-media-adapter.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function jpeg(byteLength, marker = 0) {
  const bytes = Buffer.alloc(byteLength, marker);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[byteLength - 2] = 0xff;
  bytes[byteLength - 1] = 0xd9;
  return bytes;
}

function wav() {
  const bytes = Buffer.alloc(52);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.byteLength - 8, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24);
  bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(bytes.byteLength - 44, 40);
  return bytes;
}

function receiptFor(plan, frameBytes, audioBytes) {
  return {
    candidateId: plan.candidateId,
    sourcePath: plan.sourcePath,
    startMs: plan.startMs,
    endMs: plan.endMs,
    outputDirectory: plan.outputDirectory,
    frames: plan.frames.map((frame, index) => ({
      index: frame.index,
      relativeTimestampMs: frame.relativeTimestampMs,
      sourceTimestampMs: frame.sourceTimestampMs,
      path: frame.outputPath,
      byteLength: frameBytes[index].byteLength,
      sha256: sha256(frameBytes[index]),
    })),
    audio: {
      path: plan.audio.outputPath,
      byteLength: audioBytes.byteLength,
      dataByteLength: audioBytes.byteLength - 44,
      sampleCount: (audioBytes.byteLength - 44) / 2,
      sampleRateHz: 16_000,
      sha256: sha256(audioBytes),
    },
  };
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "exclipper-review-media-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const sourcePath = join(directory, "source.mp4");
  await writeFile(sourcePath, Buffer.from([0]));
  return {
    directory,
    sourcePath,
    outputRoot: join(directory, "candidates"),
  };
}

async function materialize(plan) {
  const frameBytes = plan.frames.map((_, index) => jpeg(16, index + 1));
  const audioBytes = wav();
  await mkdir(plan.outputDirectory, { recursive: true });
  await Promise.all([
    ...plan.frames.map((frame, index) =>
      writeFile(frame.outputPath, frameBytes[index]),
    ),
    writeFile(plan.audio.outputPath, audioBytes),
  ]);
  return receiptFor(plan, frameBytes, audioBytes);
}

test("adapts an atomic candidate bundle into four bounded review frames and verified WAV bytes", async (t) => {
  const { sourcePath, outputRoot } = await fixture(t);
  let plan;
  const sharpCalls = [];
  const extractor = createChannelPreanalysisReviewMediaExtractor({
    sourcePath,
    sourceDurationMs: 120_000,
    outputRoot,
    mediaExecutor: async (receivedPlan) => {
      plan = receivedPlan;
      return materialize(receivedPlan);
    },
    sharpFactory: (input, options) => {
      let maximumDimension;
      const pipeline = {
        rotate() {
          return pipeline;
        },
        resize(resizeOptions) {
          maximumDimension = resizeOptions.width;
          assert.equal(resizeOptions.width, resizeOptions.height);
          assert.equal(resizeOptions.fit, "inside");
          assert.equal(resizeOptions.withoutEnlargement, true);
          return pipeline;
        },
        jpeg(jpegOptions) {
          assert.equal(jpegOptions.quality, CHANNEL_PREANALYSIS_REVIEW_FRAME_JPEG_QUALITY);
          return pipeline;
        },
        async toBuffer() {
          sharpCalls.push({ marker: input[4], maximumDimension, options });
          return jpeg(
            input[4] === 1 && maximumDimension === 640
              ? CHANNEL_PREANALYSIS_REVIEW_FRAME_MAX_BYTES + 1
              : 512,
            input[4],
          );
        },
      };
      return pipeline;
    },
  });

  const result = await extractor({
    candidateId: "candidate-01",
    startMs: 30_000,
    endMs: 75_000,
    focusMs: 53_000,
  });

  assert.equal(result.frames.length, 4);
  assert.equal(new Set(result.frames.map(({ timestampMs }) => timestampMs)).size, 4);
  assert.deepEqual(
    sharpCalls.filter(({ marker }) => marker === 1).map(({ maximumDimension }) => maximumDimension),
    [640, 576],
  );
  assert.ok(sharpCalls.every(({ options }) => options.failOn === "error"));
  for (const frame of result.frames) {
    const bytes = Buffer.from(frame.dataBase64, "base64");
    assert.equal(frame.byteLength, bytes.byteLength);
    assert.ok(frame.byteLength <= CHANNEL_PREANALYSIS_REVIEW_FRAME_MAX_BYTES);
    assert.equal(frame.contentDigest, `sha256:${sha256(bytes)}`);
    assert.equal(frame.extractionRevision, CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION);
  }
  assert.equal(result.audio.mimeType, "audio/wav");
  assert.equal(result.audio.sampleRateHz, 16_000);
  assert.equal(result.audio.contentDigest, `sha256:${sha256(result.audio.bytes)}`);
  assert.equal(await stat(plan.outputDirectory).catch(() => null), null);
  assert.equal(await stat(plan.workingDirectory).catch(() => null), null);
});

test("rejects an unbounded JPEG and removes all retry-blocking candidate artifacts", async (t) => {
  const { sourcePath, outputRoot } = await fixture(t);
  let plan;
  const extractor = createChannelPreanalysisReviewMediaExtractor({
    sourcePath,
    sourceDurationMs: 120_000,
    outputRoot,
    mediaExecutor: async (receivedPlan) => {
      plan = receivedPlan;
      return materialize(receivedPlan);
    },
    sharpFactory: () => {
      const pipeline = {
        rotate() {
          return pipeline;
        },
        resize() {
          return pipeline;
        },
        jpeg() {
          return pipeline;
        },
        async toBuffer() {
          return jpeg(CHANNEL_PREANALYSIS_REVIEW_FRAME_MAX_BYTES + 1);
        },
      };
      return pipeline;
    },
  });

  await assert.rejects(
    extractor({
      candidateId: "candidate-too-large",
      startMs: 10_000,
      endMs: 55_000,
      focusMs: 30_000,
    }),
    (error) =>
      error instanceof ChannelPreanalysisReviewMediaAdapterError &&
      error.code === "FRAME_SIZE_LIMIT",
  );
  assert.equal(await stat(plan.outputDirectory).catch(() => null), null);
  assert.equal(await stat(plan.workingDirectory).catch(() => null), null);
});
