import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  BROADCAST_TRANSCRIPT_GROQ_MODEL_ID,
  BROADCAST_TRANSCRIPT_GROQ_MODEL_REVISION,
  BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION,
} from "../../src/analysis/broadcastTranscriptQwen.ts";
import {
  ChannelPreanalysisScheduledAsrError,
  encodeScheduledAsrPcm16Wav,
  prepareScheduledAsrCaptionTrack,
  removeScheduledAsrCheckpoint,
} from "./channel-preanalysis-scheduled-asr.mjs";
import { ChannelPreanalysisMediaError } from "./channel-preanalysis-media.mjs";

const INPUT = {
  sourceId: "amoretto-vods",
  channelId: "UC1234567890examplechannel",
  videoId: "abcdefghijk",
  durationMs: 180_000,
  watchUrl: "https://www.youtube.com/watch?v=abcdefghijk",
  proxyUrl: "https://exclipper-preanalysis-context.example/v1/broadcast-context",
  authorizationToken: "scheduled-secret-token-with-at-least-24-chars",
};

function transcriptResult(sourceStartMs, durationMs, textKo, segments = null) {
  return {
    schemaVersion: BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION,
    modelId: BROADCAST_TRANSCRIPT_GROQ_MODEL_ID,
    modelRevision: BROADCAST_TRANSCRIPT_GROQ_MODEL_REVISION,
    sourceStartMs,
    sourceEndMs: sourceStartMs + durationMs,
    textKo,
    detectedLanguage: textKo === "[대사 없음]" ? null : "ko",
    emotion: null,
    billedSeconds: durationMs / 1_000,
    segments:
      segments ??
      (textKo === "[대사 없음]"
        ? []
        : [
            {
              relativeStartMs: 1_000,
              relativeEndMs: Math.min(durationMs, 10_000),
              textKo,
              noSpeechProbability: 0.01,
              averageLogProbability: -0.2,
            },
          ]),
  };
}

function dependencies(requestChunk, prepareCalls) {
  return {
    prepareAudio: async () => {
      prepareCalls.push("prepare");
      return { sourcePath: "fake-audio.webm", cleanup: async () => undefined };
    },
    extractWav: async (_sourcePath, _startMs, durationMs) =>
      encodeScheduledAsrPcm16Wav(Buffer.alloc(0), durationMs),
    requestChunk,
  };
}

test("scheduled ASR checkpoints every completed chunk and resumes only the missing range", async () => {
  const catalogDir = await mkdtemp(join(tmpdir(), "exclipper-asr-test-"));
  const firstRequests = [];
  const prepareCalls = [];
  try {
    await assert.rejects(
      prepareScheduledAsrCaptionTrack(
        { ...INPUT, catalogDir },
        dependencies(async (_wav, _identity, sourceStartMs, durationMs) => {
          firstRequests.push(sourceStartMs);
          if (sourceStartMs === 90_000) throw new Error("provider unavailable");
          return transcriptResult(sourceStartMs, durationMs, "첫 번째 구간");
        }, prepareCalls),
      ),
      /provider unavailable/u,
    );
    assert.deepEqual(firstRequests, [0, 90_000]);
    const checkpointPath = join(
      catalogDir,
      ".transcript-checkpoints",
      "abcdefghijk.asr.v2.json",
    );
    const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
    assert.deepEqual(
      checkpoint.chunks.map((chunk) => chunk.sourceStartMs),
      [0],
    );

    const resumedRequests = [];
    const prepared = await prepareScheduledAsrCaptionTrack(
      { ...INPUT, catalogDir },
      dependencies(async (_wav, _identity, sourceStartMs, durationMs) => {
        resumedRequests.push(sourceStartMs);
        return transcriptResult(sourceStartMs, durationMs, "두 번째 구간");
      }, prepareCalls),
    );

    assert.deepEqual(resumedRequests, [90_000]);
    assert.equal(prepared.track.languageCode, "ko-asr");
    assert.deepEqual(
      prepared.track.events.map((event) => event.text),
      ["첫 번째 구간", "두 번째 구간"],
    );
    assert.deepEqual(
      prepared.track.events.map(({ startMs, durationMs }) => ({ startMs, durationMs })),
      [
        { startMs: 1_000, durationMs: 9_000 },
        { startMs: 91_000, durationMs: 9_000 },
      ],
    );
    assert.equal(prepareCalls.length, 2);

    const reused = await prepareScheduledAsrCaptionTrack(
      { ...INPUT, catalogDir },
      {
        prepareAudio: async () => {
          throw new Error("completed checkpoint must not redownload audio");
        },
      },
    );
    assert.deepEqual(reused.track, prepared.track);

    await removeScheduledAsrCheckpoint(prepared.checkpointPath);
    await assert.rejects(readFile(prepared.checkpointPath), { code: "ENOENT" });
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});

test("definite no-speech stays covered in the checkpoint but never becomes dialogue evidence", async () => {
  const catalogDir = await mkdtemp(join(tmpdir(), "exclipper-asr-no-speech-"));
  try {
    const prepared = await prepareScheduledAsrCaptionTrack(
      { ...INPUT, durationMs: 90_000, catalogDir },
      dependencies(
        async (_wav, _identity, sourceStartMs, durationMs) =>
          transcriptResult(sourceStartMs, durationMs, "[대사 없음]"),
        [],
      ),
    );

    assert.deepEqual(prepared.track.events, []);
    const checkpoint = JSON.parse(await readFile(prepared.checkpointPath, "utf8"));
    assert.equal(checkpoint.chunks.length, 1);
    assert.equal(checkpoint.chunks[0].durationMs, 90_000);
    assert.equal(checkpoint.chunks[0].result.textKo, "[대사 없음]");
    assert.deepEqual(checkpoint.chunks[0].result.segments, []);
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});

test("only high-confidence Whisper no-speech segments are removed", async () => {
  const catalogDir = await mkdtemp(join(tmpdir(), "exclipper-asr-segment-filter-"));
  try {
    const segments = [
      {
        relativeStartMs: 2_000,
        relativeEndMs: 5_000,
        textKo: "음악 소리",
        noSpeechProbability: 0.99,
        averageLogProbability: -1.2,
      },
      {
        relativeStartMs: 10_000,
        relativeEndMs: 14_000,
        textKo: "애매하면 이 대사는 보존합니다",
        noSpeechProbability: 0.99,
        averageLogProbability: -0.4,
      },
    ];
    const prepared = await prepareScheduledAsrCaptionTrack(
      { ...INPUT, durationMs: 90_000, catalogDir },
      dependencies(
        async (_wav, _identity, sourceStartMs, durationMs) =>
          transcriptResult(
            sourceStartMs,
            durationMs,
            "음악 소리 애매하면 이 대사는 보존합니다",
            segments,
          ),
        [],
      ),
    );

    assert.deepEqual(prepared.track.events, [
      {
        startMs: 10_000,
        durationMs: 4_000,
        text: "애매하면 이 대사는 보존합니다",
      },
    ]);
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});

test("scheduled ASR downloads low-bandwidth audio with bounded retries and preserves safe diagnostics", async () => {
  const catalogDir = await mkdtemp(join(tmpdir(), "exclipper-asr-download-"));
  let commandArguments = null;
  const mediaFailure = new ChannelPreanalysisMediaError(
    "PROCESS_FAILED",
    "The process failed (1): Sign in to confirm you're not a bot. " +
      "https://www.youtube.com/watch?v=abcdefghijk&token=super-secret-query " +
      "opaque_123456789012345678901234567890",
  );
  try {
    await assert.rejects(
      prepareScheduledAsrCaptionTrack(
        { ...INPUT, durationMs: 90_000, catalogDir },
        {
          ytDlpPath: "pinned-yt-dlp",
          commandRunner: async (_command, arguments_) => {
            commandArguments = arguments_;
            throw mediaFailure;
          },
        },
      ),
      (error) => {
        assert.ok(error instanceof ChannelPreanalysisScheduledAsrError);
        assert.equal(error.code, "ASR_DOWNLOAD_PROCESS_FAILED");
        assert.equal(error.cause, mediaFailure);
        assert.match(error.message, /Sign in to confirm you're not a bot/u);
        assert.match(error.message, /\?\[redacted\]/u);
        assert.doesNotMatch(error.message, /super-secret-query|opaque_/u);
        return true;
      },
    );

    assert.notEqual(commandArguments, null);
    const valueAfter = (flag) => commandArguments[commandArguments.indexOf(flag) + 1];
    assert.equal(
      valueAfter("--format"),
      "bestaudio[abr<=64]/worstaudio[acodec!=none]/bestaudio/best",
    );
    assert.equal(valueAfter("--retries"), "3");
    assert.equal(valueAfter("--fragment-retries"), "3");
    assert.equal(valueAfter("--extractor-retries"), "3");
    assert.equal(valueAfter("--file-access-retries"), "3");
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});
