import { spawnSync } from "node:child_process";

import {
  currentSmokePlan,
  DEFAULT_PROXY_ORIGIN,
  runCandidateSmoke,
} from "./current-ai-smoke-contract.mjs";

const SAMPLE_RATE_HZ = 16_000;
const DURATION_SECONDS = 30;
const PCM_BYTE_LENGTH = SAMPLE_RATE_HZ * DURATION_SECONDS * 2;
const FRAME_SECONDS = [3, 10, 20, 27];

if (process.argv.includes("--dry-run")) {
  process.stdout.write(`${JSON.stringify(currentSmokePlan("candidate"), null, 2)}\n`);
  process.exit(0);
}

const sourcePath = process.argv[2];
const offsetSeconds = Number(process.argv[3] ?? 600);
const endpointIndex = process.argv.indexOf("--endpoint");
const endpoint =
  endpointIndex >= 0
    ? process.argv[endpointIndex + 1]
    : `${DEFAULT_PROXY_ORIGIN}/v1/candidate-insights`;
const ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg";

if (
  !sourcePath ||
  !Number.isFinite(offsetSeconds) ||
  offsetSeconds < 0 ||
  typeof endpoint !== "string" ||
  endpoint.length === 0
) {
  throw new Error(
    "Usage: node scripts/smoke-gemini-proxy.mjs <video-path> [offset-seconds] [--endpoint <url>] [--dry-run]",
  );
}

const extraction = spawnSync(
  ffmpegPath,
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    String(offsetSeconds),
    "-t",
    String(DURATION_SECONDS),
    "-i",
    sourcePath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    String(SAMPLE_RATE_HZ),
    "-c:a",
    "pcm_s16le",
    "-f",
    "s16le",
    "pipe:1",
  ],
  {
    encoding: null,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  },
);

if (extraction.status !== 0) {
  throw new Error(
    extraction.stderr?.toString("utf8").trim() ||
      "ffmpeg audio extraction failed.",
  );
}

const pcm = extraction.stdout;
if (!Buffer.isBuffer(pcm) || pcm.byteLength !== PCM_BYTE_LENGTH) {
  throw new Error(`Unexpected PCM byte length: ${pcm?.byteLength ?? 0}`);
}

const wav = Buffer.allocUnsafe(44 + pcm.byteLength);
wav.write("RIFF", 0, "ascii");
wav.writeUInt32LE(36 + pcm.byteLength, 4);
wav.write("WAVE", 8, "ascii");
wav.write("fmt ", 12, "ascii");
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(SAMPLE_RATE_HZ, 24);
wav.writeUInt32LE(SAMPLE_RATE_HZ * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36, "ascii");
wav.writeUInt32LE(pcm.byteLength, 40);
pcm.copy(wav, 44);

const frames = FRAME_SECONDS.map((relativeSeconds) => {
  const frame = spawnSync(
    ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(offsetSeconds + relativeSeconds),
      "-i",
      sourcePath,
      "-frames:v",
      "1",
      "-vf",
      "scale=640:-2",
      "-q:v",
      "5",
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "pipe:1",
    ],
    {
      encoding: null,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (
    frame.status !== 0 ||
    !Buffer.isBuffer(frame.stdout) ||
    frame.stdout.length === 0
  ) {
    throw new Error(`ffmpeg frame extraction failed at +${relativeSeconds}s`);
  }
  return {
    timestampMs: relativeSeconds * 1_000,
    bytes: frame.stdout,
  };
});

try {
  const { response, candidateHash, generationCount } = await runCandidateSmoke({
    wav,
    frames,
    candidateDurationMs: DURATION_SECONDS * 1_000,
    proxyOrigin: new URL(endpoint).origin,
  });
  const payload = await response.json().catch(() => null);
  const diagnosticHeaders = Object.fromEntries(
    [...response.headers.entries()].filter(([name]) =>
      name.toLowerCase().startsWith("x-qwen-"),
    ),
  );
  process.stdout.write(
    `${JSON.stringify(
      response.ok
        ? {
            status: response.status,
            generationCount,
            candidateHash,
            cleanupVerified: true,
            payload,
          }
        : {
            status: response.status,
            generationCount,
            candidateHash,
            errorCode: payload?.error?.code ?? "UNKNOWN_PROXY_ERROR",
            diagnosticHeaders,
          },
      null,
      2,
    )}\n`,
  );
  if (!response.ok) process.exitCode = 1;
} finally {
  pcm.fill(0);
  wav.fill(0);
  for (const frame of frames) frame.bytes.fill(0);
}
