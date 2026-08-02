import assert from "node:assert/strict";
import test from "node:test";

import {
  createChannelPreanalysisVisualFingerprint,
} from "../../src/analysis/channelPreanalysisVisualFingerprint.ts";
import {
  CHANNEL_PREANALYSIS_VISUAL_COVERAGE_SAMPLE_INTERVAL_MS,
  channelPreanalysisVisualCoveragePlannedSampleCount,
} from "../../src/analysis/channelPreanalysisVisualCoverage.ts";
import {
  extractChannelPreanalysisVisualCoverage,
} from "./channel-preanalysis-visual-coverage.mjs";

const VIDEO_ID = "KzAW3yow80Q";
const DURATION_MS = 120_000;
const FINGERPRINT_DIGEST = `sha256:${"a".repeat(64)}`;

function fingerprint() {
  return createChannelPreanalysisVisualFingerprint({
    videoId: VIDEO_ID,
    sourceDurationMs: DURATION_MS,
    createdAt: "2026-08-02T00:00:00.000Z",
    anchors: Array.from({ length: 8 }, (_, index) => ({
      timestampMs: 10_000 + index * 14_000,
      dHash64: (index + 1).toString(16).padStart(16, "0"),
      blockHash64: (index + 17).toString(16).padStart(16, "0"),
      meanLuma: 30 + index,
      edgeEnergy: 20 + index,
    })),
  });
}

function artifact() {
  return {
    artifactId: `youtube-storyboard-visual-fingerprint:${VIDEO_ID}:v1`,
    videoId: VIDEO_ID,
    kind: "fingerprint",
    revision: 1,
    contentDigest: FINGERPRINT_DIGEST,
  };
}

function visualBytes({ changed = true, omitLastFrame = false } = {}) {
  const count =
    channelPreanalysisVisualCoveragePlannedSampleCount(DURATION_MS) -
    (omitLastFrame ? 1 : 0);
  return Buffer.concat(
    Array.from({ length: count }, (_, sampleIndex) => {
      const frame = Buffer.alloc(32 * 18, 40);
      if (changed && sampleIndex >= 12) {
        for (let index = 0; index < frame.length; index += 1) {
          frame[index] = index % 2 === 0 ? 0 : 255;
        }
      }
      return frame;
    }),
  );
}

function commandRunner(bytes) {
  return async (_command, arguments_, options) => {
    assert.ok(
      arguments_.includes(
        `fps=fps=1/${String(CHANNEL_PREANALYSIS_VISUAL_COVERAGE_SAMPLE_INTERVAL_MS / 1_000)}:start_time=0:round=near:eof_action=pass,scale=32:18:flags=area,format=gray`,
      ),
    );
    await options.onStdoutChunk(bytes.subarray(0, 731));
    await options.onStdoutChunk(bytes.subarray(731));
    return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  };
}

test("a complete distributed scan emits a receipt and a quiet visual seed", async () => {
  const result = await extractChannelPreanalysisVisualCoverage(
    "source.mkv",
    DURATION_MS,
    {
      videoId: VIDEO_ID,
      sourceFingerprint: fingerprint(),
      sourceFingerprintArtifact: artifact(),
      commandRunner: commandRunner(visualBytes()),
    },
  );
  assert.equal(result.receipt.status, "complete");
  assert.equal(
    result.receipt.analyzedSampleCount,
    result.receipt.plannedSampleCount,
  );
  assert.equal(result.receipt.coveredThroughMs, DURATION_MS);
  assert.equal(result.seeds.length, 1);
  assert.equal(result.seeds[0].focusMs, 60_000);
});

test("a complete static source can close with no visual seed", async () => {
  const result = await extractChannelPreanalysisVisualCoverage(
    "source.mkv",
    DURATION_MS,
    {
      videoId: VIDEO_ID,
      sourceFingerprint: fingerprint(),
      sourceFingerprintArtifact: artifact(),
      commandRunner: commandRunner(visualBytes({ changed: false })),
    },
  );
  assert.equal(result.receipt.visualSeedCount, 0);
  assert.deepEqual(result.seeds, []);
});

test("one missing distributed frame fails closed", async () => {
  await assert.rejects(
    extractChannelPreanalysisVisualCoverage("source.mkv", DURATION_MS, {
      videoId: VIDEO_ID,
      sourceFingerprint: fingerprint(),
      sourceFingerprintArtifact: artifact(),
      commandRunner: commandRunner(visualBytes({ omitLastFrame: true })),
    }),
    (error) => error.code === "VISUAL_COVERAGE_INCOMPLETE",
  );
});
