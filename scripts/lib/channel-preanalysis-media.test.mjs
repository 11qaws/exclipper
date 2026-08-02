import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";

import { selectAudioReactionHighlights } from "../../src/media/localAudioReactionAnalysisCore.ts";
import {
  CHANNEL_PREANALYSIS_AUDIO_FEATURE_SAMPLE_RATE_HZ,
  CHANNEL_PREANALYSIS_CANDIDATE_FRAME_COUNT,
  CHANNEL_PREANALYSIS_CANDIDATE_SAMPLE_RATE_HZ,
  CHANNEL_PREANALYSIS_MAX_DURATION_MS,
  CHANNEL_PREANALYSIS_MAX_JPEG_BYTES,
  ChannelPreanalysisMediaError,
  channelPreanalysisMediaDiagnostic,
  createChannelPreanalysisCandidateMediaPlan,
  downloadChannelPreanalysisYouTubeMedia,
  executeChannelPreanalysisCandidateMediaPlan,
  extractChannelPreanalysisAudioFeatureWindows,
  probeChannelPreanalysisMedia,
  runBoundedMediaCommand,
} from "./channel-preanalysis-media.mjs";

const TINY_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0xff, 0xd9]);

async function createFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "exclipper-media-test-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const sourcePath = join(directory, "source.mp4");
  await writeFile(sourcePath, Buffer.from([0x00]));
  return { directory, sourcePath };
}

function int16Pcm(sampleCount, valueAt) {
  const output = Buffer.alloc(sampleCount * 2);
  for (let index = 0; index < sampleCount; index += 1) {
    output.writeInt16LE(valueAt(index), index * 2);
  }
  return output;
}

test("ffprobe validates a regular local file and accepts exactly twelve hours", async (t) => {
  const { sourcePath } = await createFixture(t);
  const calls = [];
  const result = await probeChannelPreanalysisMedia(sourcePath, {
    ffprobePath: "ffprobe-test",
    commandRunner: async (command, arguments_, options) => {
      calls.push({ command, arguments_, options });
      return {
        stdout: JSON.stringify({
          format: { duration: String(CHANNEL_PREANALYSIS_MAX_DURATION_MS / 1_000) },
        }),
        stderr: "",
      };
    },
  });

  assert.equal(result.durationMs, CHANNEL_PREANALYSIS_MAX_DURATION_MS);
  assert.equal(result.sizeBytes, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "ffprobe-test");
  assert.equal(calls[0].arguments_.at(-1), sourcePath);
  assert.equal(calls[0].options.shell, false);
  assert.ok(calls[0].options.maxStdoutBytes <= 64 * 1_024);
});

test("ffprobe rejects a source longer than twelve hours and a file over its byte budget", async (t) => {
  const { sourcePath } = await createFixture(t);
  await assert.rejects(
    probeChannelPreanalysisMedia(sourcePath, {
      commandRunner: async () => ({
        stdout: JSON.stringify({
          format: {
            duration: String(CHANNEL_PREANALYSIS_MAX_DURATION_MS / 1_000 + 0.001),
          },
        }),
        stderr: "",
      }),
    }),
    (error) =>
      error instanceof ChannelPreanalysisMediaError &&
      error.code === "DURATION_LIMIT",
  );
  await writeFile(sourcePath, Buffer.from([0x00, 0x01]));
  await assert.rejects(
    probeChannelPreanalysisMedia(sourcePath, {
      maxSourceBytes: 1,
      commandRunner: async () => assert.fail("ffprobe must not run"),
    }),
    (error) =>
      error instanceof ChannelPreanalysisMediaError &&
      error.code === "SOURCE_SIZE_LIMIT",
  );
});

test("YouTube download is one exact bounded 480p analysis copy in an isolated directory", async (t) => {
  const { directory } = await createFixture(t);
  const calls = [];
  const media = await downloadChannelPreanalysisYouTubeMedia(
    {
      videoId: "KzAW3yow80Q",
      watchUrl: "https://www.youtube.com/watch?v=KzAW3yow80Q",
      outputRoot: join(directory, "downloads"),
    },
    {
      ytDlpPath: "yt-dlp-test",
      environment: { PATH: "test-path" },
      commandRunner: async (command, arguments_, options) => {
        calls.push({ command, arguments_, options });
        const template = arguments_[arguments_.indexOf("--output") + 1];
        const path = template.replace("%(ext)s", "mkv");
        await writeFile(path, Buffer.from([0x01, 0x02, 0x03]));
        return { stdout: Buffer.from(`${path}\n`, "utf8"), stderr: Buffer.alloc(0) };
      },
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "yt-dlp-test");
  assert.deepEqual(calls[0].options.environment, { PATH: "test-path" });
  assert.equal(calls[0].arguments_.at(-1), "https://www.youtube.com/watch?v=KzAW3yow80Q");
  assert.ok(calls[0].arguments_.includes("bestvideo*[height<=480]+bestaudio/best[height<=480]"));
  for (const flag of [
    "--retries",
    "--fragment-retries",
    "--extractor-retries",
    "--file-access-retries",
  ]) {
    assert.equal(calls[0].arguments_[calls[0].arguments_.indexOf(flag) + 1], "3");
  }
  assert.equal(media.sizeBytes, 3);
  assert.ok(media.sourcePath.startsWith(media.workingDirectory));
});

test("YouTube download rejects noncanonical identity before network work", async (t) => {
  const { directory } = await createFixture(t);
  await assert.rejects(
    downloadChannelPreanalysisYouTubeMedia(
      {
        videoId: "KzAW3yow80Q",
        watchUrl: "https://youtu.be/KzAW3yow80Q",
        outputRoot: join(directory, "downloads"),
      },
      { commandRunner: async () => assert.fail("network must not run") },
    ),
    (error) =>
      error instanceof ChannelPreanalysisMediaError &&
      error.code === "INVALID_YOUTUBE_IDENTITY",
  );
});

test("YouTube botwall failures keep only a bounded redacted operational diagnostic", async (t) => {
  const { directory } = await createFixture(t);
  const rawDiagnostic =
    "ERROR: Sign in to confirm you're not a bot. " +
    "https://www.youtube.com/watch?v=KzAW3yow80Q&token=private-value " +
    "Authorization=secret-value";

  await assert.rejects(
    downloadChannelPreanalysisYouTubeMedia(
      {
        videoId: "KzAW3yow80Q",
        watchUrl: "https://www.youtube.com/watch?v=KzAW3yow80Q",
        outputRoot: join(directory, "downloads"),
      },
      {
        commandRunner: async () => {
          throw new ChannelPreanalysisMediaError(
            "PROCESS_FAILED",
            `The process failed (1): ${rawDiagnostic}`,
            undefined,
            rawDiagnostic,
          );
        },
      },
    ),
    (error) => {
      assert.ok(error instanceof ChannelPreanalysisMediaError);
      assert.equal(error.code, "YOUTUBE_BOTWALL");
      const diagnostic = channelPreanalysisMediaDiagnostic(error);
      assert.match(diagnostic, /Sign in to confirm you're not a bot/u);
      assert.match(diagnostic, /\[redacted-url\]/u);
      assert.match(diagnostic, /Authorization=\[redacted\]/u);
      assert.doesNotMatch(diagnostic, /private-value|secret-value/u);
      assert.ok(diagnostic.length <= 500);
      return true;
    },
  );
});

test("8 kHz mono PCM is consumed across odd chunk boundaries as bounded one-second features", async (t) => {
  const { sourcePath } = await createFixture(t);
  const sampleCount = CHANNEL_PREANALYSIS_AUDIO_FEATURE_SAMPLE_RATE_HZ * 2;
  const pcm = int16Pcm(sampleCount, (index) =>
    index < CHANNEL_PREANALYSIS_AUDIO_FEATURE_SAMPLE_RATE_HZ
      ? index % 2 === 0
        ? 8_192
        : -8_192
      : 16_384,
  );
  const calls = [];
  const result = await extractChannelPreanalysisAudioFeatureWindows(
    sourcePath,
    2_000,
    {
      ffmpegPath: "ffmpeg-test",
      commandRunner: async (command, arguments_, options) => {
        calls.push({ command, arguments_, options });
        for (const [start, end] of [
          [0, 3],
          [3, 4_098],
          [4_098, 15_001],
          [15_001, pcm.byteLength],
        ]) {
          await options.onStdoutChunk(pcm.subarray(start, end));
        }
        return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
      },
    },
  );

  assert.equal(result.sampleRateHz, 8_000);
  assert.equal(result.decodedSampleCount, sampleCount);
  assert.equal(result.windows.length, 2);
  assert.equal(result.coverageComplete, true);
  assert.deepEqual(
    result.windows.map(({ startMs, endMs }) => ({ startMs, endMs })),
    [
      { startMs: 0, endMs: 1_000 },
      { startMs: 1_000, endMs: 2_000 },
    ],
  );
  assert.ok(result.windows[0].zeroCrossingRate > 0.99);
  assert.equal(result.windows[1].zeroCrossingRate, 0);
  assert.equal(calls[0].command, "ffmpeg-test");
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.maxStdoutBytes, pcm.byteLength + 16_000);
  assert.ok(
    calls[0].arguments_.includes(
      `aresample=${String(CHANNEL_PREANALYSIS_AUDIO_FEATURE_SAMPLE_RATE_HZ)}:async=1:first_pts=0`,
    ),
  );

  const selection = selectAudioReactionHighlights(result.windows, 2_000, {
    plannedWindowCount: result.plannedWindowCount,
  });
  assert.equal(selection.analyzedWindowCount, 2);
  assert.equal(selection.coverageComplete, true);
});

test("candidate media plans contain four distinct in-range frame points", async (t) => {
  const { directory, sourcePath } = await createFixture(t);
  const plan = createChannelPreanalysisCandidateMediaPlan({
    candidateId: "candidate-01",
    sourcePath,
    sourceDurationMs: 120_000,
    startMs: 30_000,
    endMs: 75_000,
    focusMs: 53_000,
    outputRoot: join(directory, "output"),
  });

  assert.equal(plan.frames.length, CHANNEL_PREANALYSIS_CANDIDATE_FRAME_COUNT);
  assert.equal(
    new Set(plan.frames.map(({ relativeTimestampMs }) => relativeTimestampMs)).size,
    CHANNEL_PREANALYSIS_CANDIDATE_FRAME_COUNT,
  );
  for (const frame of plan.frames) {
    assert.ok(frame.relativeTimestampMs >= 0);
    assert.ok(frame.relativeTimestampMs < plan.durationMs);
    assert.equal(frame.sourceTimestampMs, plan.startMs + frame.relativeTimestampMs);
  }
  assert.match(plan.outputDirectory, /candidate-[a-f0-9]{24}$/u);
});

test("execution atomically publishes four bounded JPEGs and one canonical 16 kHz mono WAV", async (t) => {
  const { directory, sourcePath } = await createFixture(t);
  const plan = createChannelPreanalysisCandidateMediaPlan({
    candidateId: "candidate-ready",
    sourcePath,
    sourceDurationMs: 90_000,
    startMs: 15_000,
    endMs: 45_000,
    focusMs: 30_000,
    outputRoot: join(directory, "output"),
  });
  const calls = [];
  const exactCandidatePcm = int16Pcm(
    30 * CHANNEL_PREANALYSIS_CANDIDATE_SAMPLE_RATE_HZ,
    () => 4_096,
  );
  const commandRunner = async (command, arguments_, options) => {
    calls.push({ command, arguments_, options });
    if (arguments_.includes("image2")) {
      await writeFile(arguments_.at(-1), TINY_JPEG);
    } else {
      await options.onStdoutChunk(exactCandidatePcm.subarray(0, 7_777));
      await options.onStdoutChunk(exactCandidatePcm.subarray(7_777));
    }
    return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  };

  const receipt = await executeChannelPreanalysisCandidateMediaPlan(plan, {
    ffmpegPath: "ffmpeg-test",
    commandRunner,
  });

  assert.equal(receipt.frames.length, 4);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(({ command }) => command === "ffmpeg-test"));
  assert.ok(calls.every(({ options }) => options.shell === false));
  assert.equal(await stat(plan.workingDirectory).catch(() => null), null);
  assert.equal((await stat(plan.outputDirectory)).isDirectory(), true);
  for (const frame of receipt.frames) {
    assert.equal((await stat(frame.path)).size, TINY_JPEG.byteLength);
    assert.equal(frame.byteLength, TINY_JPEG.byteLength);
    assert.match(frame.sha256, /^[a-f0-9]{64}$/u);
  }

  const wav = await readFile(receipt.audio.path);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), CHANNEL_PREANALYSIS_CANDIDATE_SAMPLE_RATE_HZ);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), exactCandidatePcm.byteLength);
  assert.equal(wav.byteLength, 44 + exactCandidatePcm.byteLength);
  assert.equal(receipt.audio.sampleCount, exactCandidatePcm.byteLength / 2);
  assert.ok(
    calls.some(({ arguments_ }) =>
      arguments_.some((argument) =>
        argument.includes("apad=pad_len=480000,atrim=end_sample=480000"),
      ),
    ),
  );
});

test("candidate media rejects short PCM instead of billing an impossible request forever", async (t) => {
  const { directory, sourcePath } = await createFixture(t);
  const plan = createChannelPreanalysisCandidateMediaPlan({
    candidateId: "candidate-short-pcm",
    sourcePath,
    sourceDurationMs: 90_000,
    startMs: 15_000,
    endMs: 45_000,
    outputRoot: join(directory, "output"),
  });
  await assert.rejects(
    executeChannelPreanalysisCandidateMediaPlan(plan, {
      commandRunner: async (_command, arguments_, options) => {
        if (arguments_.includes("image2")) {
          await writeFile(arguments_.at(-1), TINY_JPEG);
        } else {
          await options.onStdoutChunk(
            Buffer.alloc(CHANNEL_PREANALYSIS_CANDIDATE_SAMPLE_RATE_HZ * 2),
          );
        }
        return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
      },
    }),
    (error) =>
      error instanceof ChannelPreanalysisMediaError &&
      error.code === "INVALID_WAV",
  );
  assert.equal(await stat(plan.outputDirectory).catch(() => null), null);
  assert.equal(await stat(plan.workingDirectory).catch(() => null), null);
});

test("an oversized candidate JPEG aborts without exposing a partial final bundle", async (t) => {
  const { directory, sourcePath } = await createFixture(t);
  const plan = createChannelPreanalysisCandidateMediaPlan({
    candidateId: "candidate-oversized-frame",
    sourcePath,
    sourceDurationMs: 90_000,
    startMs: 0,
    endMs: 30_000,
    outputRoot: join(directory, "output"),
  });

  await assert.rejects(
    executeChannelPreanalysisCandidateMediaPlan(plan, {
      commandRunner: async (_command, arguments_) => {
        await writeFile(
          arguments_.at(-1),
          Buffer.alloc(CHANNEL_PREANALYSIS_MAX_JPEG_BYTES + 1, 0xff),
        );
        return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
      },
    }),
    (error) =>
      error instanceof ChannelPreanalysisMediaError &&
      error.code === "JPEG_SIZE_LIMIT",
  );
  assert.equal(await stat(plan.outputDirectory).catch(() => null), null);
  assert.equal(await stat(plan.workingDirectory).catch(() => null), null);
});

test("the default command runner enforces stdout limits without invoking a shell", async () => {
  await assert.rejects(
    runBoundedMediaCommand(
      process.execPath,
      ["-e", "process.stdout.write('0123456789')"],
      {
        timeoutMs: 10_000,
        maxStdoutBytes: 5,
        maxStderrBytes: 1_024,
      },
    ),
    (error) =>
      error instanceof ChannelPreanalysisMediaError &&
      error.code === "PROCESS_OUTPUT_LIMIT",
  );
});

test("the default command runner redacts URLs and credentials from failure diagnostics", async () => {
  await assert.rejects(
    runBoundedMediaCommand(
      process.execPath,
      [
        "-e",
        "process.stderr.write('failed https://example.test/media?token=private token=secret-value sk-test-secret-1234567890'); process.exit(7)",
      ],
      { timeoutMs: 10_000 },
    ),
    (error) => {
      assert.ok(error instanceof ChannelPreanalysisMediaError);
      assert.equal(error.code, "PROCESS_FAILED");
      assert.match(error.diagnostic, /\[redacted-url\]/u);
      assert.match(error.diagnostic, /token=\[redacted\]/u);
      assert.match(error.diagnostic, /\[redacted-secret\]/u);
      assert.doesNotMatch(error.message, /private|secret-value|sk-test-secret/u);
      return true;
    },
  );
});
