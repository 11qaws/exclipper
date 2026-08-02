import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";

import sharp from "sharp";

import {
  CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
} from "../../src/analysis/candidatePassBWorkerProtocol.ts";
import {
  CHANNEL_PREANALYSIS_REVIEW_FRAME_MAX_BYTES,
} from "../../src/analysis/channelPreanalysisReviewBundle.ts";
import {
  createChannelPreanalysisCandidateMediaPlan,
  executeChannelPreanalysisCandidateMediaPlan,
} from "./channel-preanalysis-media.mjs";

export const CHANNEL_PREANALYSIS_REVIEW_FRAME_MAX_DIMENSION = 640;
export const CHANNEL_PREANALYSIS_REVIEW_FRAME_JPEG_QUALITY = 58;

const FRAME_DIMENSION_ATTEMPTS = Object.freeze([
  640,
  576,
  512,
  448,
  384,
  320,
  256,
  224,
  192,
  160,
  128,
  96,
  64,
]);

export class ChannelPreanalysisReviewMediaAdapterError extends Error {
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ChannelPreanalysisReviewMediaAdapterError";
    this.code = code;
  }
}

function adapterError(code, message, cause) {
  return new ChannelPreanalysisReviewMediaAdapterError(code, message, cause);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isJpeg(bytes) {
  return bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes.at(-2) === 0xff &&
    bytes.at(-1) === 0xd9;
}

function receiptMatchesBytes(receipt, bytes) {
  return Number.isSafeInteger(receipt?.byteLength) &&
    receipt.byteLength === bytes.byteLength &&
    typeof receipt.sha256 === "string" &&
    receipt.sha256 === sha256(bytes);
}

async function encodeBoundedJpeg(input, sharpFactory) {
  for (const maximumDimension of FRAME_DIMENSION_ATTEMPTS) {
    let encoded;
    try {
      encoded = await sharpFactory(input, { failOn: "error" })
        .rotate()
        .resize({
          width: maximumDimension,
          height: maximumDimension,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({
          quality: CHANNEL_PREANALYSIS_REVIEW_FRAME_JPEG_QUALITY,
          chromaSubsampling: "4:2:0",
        })
        .toBuffer();
    } catch (cause) {
      throw adapterError(
        "FRAME_REENCODE_FAILED",
        "A candidate frame could not be re-encoded as JPEG.",
        cause,
      );
    }
    const bytes = Buffer.from(encoded);
    if (
      bytes.byteLength <= CHANNEL_PREANALYSIS_REVIEW_FRAME_MAX_BYTES &&
      isJpeg(bytes)
    ) {
      return bytes;
    }
  }
  throw adapterError(
    "FRAME_SIZE_LIMIT",
    "A candidate frame could not fit the review bundle byte limit.",
  );
}

function validateMediaReceipt(receipt, plan) {
  if (
    receipt?.candidateId !== plan.candidateId ||
    receipt.sourcePath !== plan.sourcePath ||
    receipt.startMs !== plan.startMs ||
    receipt.endMs !== plan.endMs ||
    receipt.outputDirectory !== plan.outputDirectory ||
    !Array.isArray(receipt.frames) ||
    receipt.frames.length !== plan.frames.length ||
    receipt.audio?.path !== plan.audio.outputPath
  ) {
    throw adapterError(
      "INVALID_MEDIA_RECEIPT",
      "The candidate media receipt does not match its extraction plan.",
    );
  }
}

async function loadFrames(plan, receipt, sharpFactory) {
  const frames = [];
  for (const plannedFrame of plan.frames) {
    const frameReceipt = receipt.frames.find(
      ({ index }) => index === plannedFrame.index,
    );
    if (
      frameReceipt?.path !== plannedFrame.outputPath ||
      frameReceipt.relativeTimestampMs !== plannedFrame.relativeTimestampMs ||
      frameReceipt.sourceTimestampMs !== plannedFrame.sourceTimestampMs
    ) {
      throw adapterError(
        "INVALID_MEDIA_RECEIPT",
        "A candidate frame receipt does not match its extraction plan.",
      );
    }
    const sourceBytes = await readFile(plannedFrame.outputPath);
    if (!isJpeg(sourceBytes) || !receiptMatchesBytes(frameReceipt, sourceBytes)) {
      throw adapterError(
        "INVALID_MEDIA_RECEIPT",
        "A candidate JPEG does not match its extraction receipt.",
      );
    }
    const bytes = await encodeBoundedJpeg(sourceBytes, sharpFactory);
    frames.push(Object.freeze({
      timestampMs: plannedFrame.relativeTimestampMs,
      mimeType: "image/jpeg",
      byteLength: bytes.byteLength,
      contentDigest: `sha256:${sha256(bytes)}`,
      extractionRevision: CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
      dataBase64: bytes.toString("base64"),
    }));
  }
  return Object.freeze(frames);
}

async function loadAudio(plan, receipt) {
  const bytes = await readFile(plan.audio.outputPath);
  if (
    bytes.byteLength < 44 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE" ||
    !receiptMatchesBytes(receipt.audio, bytes) ||
    receipt.audio.sampleRateHz !== plan.audio.sampleRateHz ||
    !Number.isSafeInteger(receipt.audio.sampleCount) ||
    receipt.audio.sampleCount <= 0 ||
    !Number.isSafeInteger(receipt.audio.dataByteLength) ||
    receipt.audio.dataByteLength !== bytes.byteLength - 44
  ) {
    throw adapterError(
      "INVALID_MEDIA_RECEIPT",
      "The candidate WAV does not match its extraction receipt.",
    );
  }
  return Object.freeze({
    mimeType: "audio/wav",
    bytes,
    byteLength: bytes.byteLength,
    dataByteLength: receipt.audio.dataByteLength,
    sampleCount: receipt.audio.sampleCount,
    sampleRateHz: receipt.audio.sampleRateHz,
    contentDigest: `sha256:${receipt.audio.sha256}`,
  });
}

/**
 * Creates the extractCandidateMedia callback expected by
 * runChannelPreanalysisReview. Extracted files are staging artifacts: the
 * returned frames and audio are fully resident in memory before cleanup.
 */
export function createChannelPreanalysisReviewMediaExtractor(options) {
  if (
    options === null ||
    typeof options !== "object" ||
    typeof options.mediaExecutor !== "undefined" &&
      typeof options.mediaExecutor !== "function" ||
    typeof options.sharpFactory !== "undefined" &&
      typeof options.sharpFactory !== "function"
  ) {
    throw adapterError("INVALID_ADAPTER", "Review media adapter options are invalid.");
  }
  const {
    sourcePath,
    sourceDurationMs,
    outputRoot,
    mediaExecutor = executeChannelPreanalysisCandidateMediaPlan,
    mediaExecutorOptions = {},
    sharpFactory = sharp,
  } = options;

  return async function extractCandidateMedia(candidate) {
    const plan = createChannelPreanalysisCandidateMediaPlan({
      candidateId: candidate?.candidateId,
      sourcePath,
      sourceDurationMs,
      startMs: candidate?.startMs,
      endMs: candidate?.endMs,
      focusMs: candidate?.focusMs,
      outputRoot,
    });
    try {
      const receipt = await mediaExecutor(plan, mediaExecutorOptions);
      validateMediaReceipt(receipt, plan);
      const frames = await loadFrames(plan, receipt, sharpFactory);
      const audio = await loadAudio(plan, receipt);
      return Object.freeze({ frames, audio });
    } finally {
      await Promise.all([
        rm(plan.workingDirectory, { recursive: true, force: true }),
        rm(plan.outputDirectory, { recursive: true, force: true }),
      ]);
    }
  };
}
