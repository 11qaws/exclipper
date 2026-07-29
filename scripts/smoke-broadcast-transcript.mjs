import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import {
  currentSmokePlan,
  DEFAULT_PROXY_ORIGIN,
  runTranscriptSmoke,
} from "./current-ai-smoke-contract.mjs";

const SAMPLE_RATE_HZ = 16_000;
const BYTES_PER_SAMPLE = 2;
const MAX_DURATION_SECONDS = 90;

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

if (hasFlag("--dry-run")) {
  process.stdout.write(`${JSON.stringify(currentSmokePlan("transcript"), null, 2)}\n`);
  process.exit(0);
}

const file = option("--file");
const startSeconds = Number(option("--start", "0"));
const requestedDurationSeconds = Number(option("--duration", "90"));
const endpoint = option(
  "--endpoint",
  `${DEFAULT_PROXY_ORIGIN}/v1/broadcast-transcript`,
);

if (
  typeof file !== "string" ||
  file.length === 0 ||
  !Number.isFinite(startSeconds) ||
  startSeconds < 0 ||
  !Number.isFinite(requestedDurationSeconds) ||
  requestedDurationSeconds <= 0 ||
  requestedDurationSeconds > MAX_DURATION_SECONDS
) {
  throw new Error(
    "Usage: node scripts/smoke-broadcast-transcript.mjs --file <video> [--start 1260] [--duration 90] [--endpoint <url>] [--dry-run]",
  );
}

const extraction = spawnSync(
  process.env.FFMPEG_PATH ?? "ffmpeg",
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    String(startSeconds),
    "-t",
    String(requestedDurationSeconds),
    "-i",
    resolve(file),
    "-map",
    "0:a:0",
    "-ac",
    "1",
    "-ar",
    String(SAMPLE_RATE_HZ),
    "-f",
    "s16le",
    "pipe:1",
  ],
  {
    encoding: null,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  },
);

if (extraction.status !== 0 || !Buffer.isBuffer(extraction.stdout)) {
  throw new Error(
    extraction.stderr?.toString("utf8").trim() || "ffmpeg audio extraction failed.",
  );
}

const pcm = extraction.stdout;
const sampleCount = Math.floor(pcm.byteLength / BYTES_PER_SAMPLE);
const durationMs = Math.ceil((sampleCount / SAMPLE_RATE_HZ) * 1_000);
if (sampleCount <= 0 || durationMs > MAX_DURATION_SECONDS * 1_000) {
  pcm.fill(0);
  throw new Error("ffmpeg returned an invalid PCM payload.");
}

const dataLength = sampleCount * BYTES_PER_SAMPLE;
const wav = Buffer.allocUnsafe(44 + dataLength);
wav.write("RIFF", 0, "ascii");
wav.writeUInt32LE(36 + dataLength, 4);
wav.write("WAVE", 8, "ascii");
wav.write("fmt ", 12, "ascii");
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(SAMPLE_RATE_HZ, 24);
wav.writeUInt32LE(SAMPLE_RATE_HZ * BYTES_PER_SAMPLE, 28);
wav.writeUInt16LE(BYTES_PER_SAMPLE, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36, "ascii");
wav.writeUInt32LE(dataLength, 40);
pcm.copy(wav, 44, 0, dataLength);

try {
  const proxyOrigin = new URL(endpoint).origin;
  const { response, route } = await runTranscriptSmoke({
    wav,
    sourceStartMs: Math.round(startSeconds * 1_000),
    durationMs,
    proxyOrigin,
  });
  const payload = await response.json().catch(() => null);
  process.stdout.write(
    `${JSON.stringify(
      {
        status: response.status,
        transport: route.manifest.transportMode,
        provider: route.manifest.provider,
        durationMs,
        cleanupVerified: response.ok,
        payload,
      },
      null,
      2,
    )}\n`,
  );
  if (!response.ok) process.exitCode = 1;
} finally {
  pcm.fill(0);
  wav.fill(0);
}
