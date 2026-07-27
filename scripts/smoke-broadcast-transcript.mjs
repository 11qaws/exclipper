import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";

const SAMPLE_RATE_HZ = 16_000;
const BYTES_PER_SAMPLE = 2;
const MAX_DURATION_SECONDS = 90;
const MAX_DIRECT_DURATION_SECONDS = 30;
const PRODUCTION_ORIGIN = "https://11qaws.github.io";
const QUOTA_SCHEMA_VERSION = "1.0.0";
const DEFAULT_ENDPOINT =
  "https://rettohighlight-gemini.11qaws.workers.dev/v1/broadcast-transcript";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const file = option("--file");
const startSeconds = Number(option("--start", "0"));
const requestedDurationSeconds = Number(option("--duration", "30"));
const endpoint = option("--endpoint", DEFAULT_ENDPOINT);
const transport = option("--transport", "base64");

if (
  typeof file !== "string" ||
  file.length === 0 ||
  !Number.isFinite(startSeconds) ||
  startSeconds < 0 ||
  !Number.isFinite(requestedDurationSeconds) ||
  requestedDurationSeconds <= 0 ||
  requestedDurationSeconds > MAX_DURATION_SECONDS ||
  (transport === "base64" &&
    requestedDurationSeconds > MAX_DIRECT_DURATION_SECONDS) ||
  typeof endpoint !== "string" ||
  !["base64", "raw", "json"].includes(transport)
) {
  throw new Error(
    "Usage: node scripts/smoke-broadcast-transcript.mjs --file <video> [--start 1260] [--duration 30] [--transport base64|raw|json]",
  );
}

const extraction = spawnSync(
  "ffmpeg",
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
  { encoding: null, maxBuffer: 16 * 1024 * 1024 },
);

if (extraction.status !== 0 || !Buffer.isBuffer(extraction.stdout)) {
  throw new Error(`ffmpeg failed: ${String(extraction.stderr)}`);
}

const pcm = extraction.stdout;
const sampleCount = Math.floor(pcm.byteLength / BYTES_PER_SAMPLE);
const durationMs = Math.ceil((sampleCount / SAMPLE_RATE_HZ) * 1_000);
if (sampleCount <= 0 || durationMs > MAX_DURATION_SECONDS * 1_000) {
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

const participantId = `smoke_${randomBytes(24).toString("base64url")}`;
const runId = `smoke-run-${Date.now()}`;
const operationId = `transcript-smoke-${Date.now()}`;
const transcriptUrl = new URL(endpoint);
const sourceStartMs = Math.round(startSeconds * 1_000);
const requestBody =
  transport === "json"
    ? JSON.stringify({
        audioBase64: wav.toString("base64"),
        sourceStartMs,
        durationMs,
      })
    : transport === "base64"
      ? wav.toString("base64")
      : wav;
if (transport !== "json") {
  transcriptUrl.searchParams.set("startMs", String(sourceStartMs));
  transcriptUrl.searchParams.set("durationMs", String(durationMs));
}
const payloadDigest = `sha256:${createHash("sha256")
  .update(requestBody)
  .digest("hex")}`;
const quotaUrl = new URL("/v1/ai-quota", transcriptUrl.origin);
const quotaIdentity = {
  participantId,
  runId,
  operationId,
  pool: "transcript",
  payloadDigest,
};

let lease;
while (lease === undefined) {
  const quotaResponse = await fetch(quotaUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: PRODUCTION_ORIGIN,
    },
    body: JSON.stringify({
      schemaVersion: QUOTA_SCHEMA_VERSION,
      action: "lease",
      ...quotaIdentity,
    }),
  });
  const quotaPayload = await quotaResponse.json();
  if (!quotaResponse.ok) {
    throw new Error(
      `Quota smoke failed with HTTP ${quotaResponse.status}: ${quotaPayload?.error?.code ?? "UNKNOWN"}`,
    );
  }
  if (quotaPayload?.status === "granted") {
    lease = quotaPayload;
    break;
  }
  if (
    quotaPayload?.status !== "queued" &&
    quotaPayload?.status !== "capacity-full"
  ) {
    throw new Error(`Quota smoke was rejected: ${JSON.stringify(quotaPayload)}`);
  }
  const retryAfterMs = Math.min(
    15_000,
    Math.max(250, Number(quotaPayload.retryAfterMs) || 2_000),
  );
  await new Promise((resolveWait) => setTimeout(resolveWait, retryAfterMs));
}

const response = await fetch(transcriptUrl, {
  method: "POST",
  headers: {
    "Content-Type":
      transport === "json"
        ? "application/json"
        : transport === "base64"
          ? "application/vnd.exclipper.transcript-base64"
          : "audio/wav",
    Origin: PRODUCTION_ORIGIN,
    "X-ExClipper-Quota-Participant": participantId,
    "X-ExClipper-Quota-Run": runId,
    "X-ExClipper-Quota-Operation": operationId,
    "X-ExClipper-Quota-Payload-Digest": payloadDigest,
    "X-ExClipper-Quota-Lease": lease.leaseToken,
  },
  body: requestBody,
});

const payload = await response.json();
process.stdout.write(
  `${JSON.stringify(
    { status: response.status, transport, durationMs, payload },
    null,
    2,
  )}\n`,
);
if (!response.ok) process.exitCode = 1;

pcm.fill(0);
wav.fill(0);
