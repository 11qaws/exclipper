#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import {
  AutoModel,
  AutoProcessor,
  Tensor,
  env,
} from "@huggingface/transformers";

const MODEL_ID = "Xenova/wavlm-base-plus-sv";
const MODEL_REVISION = "e61029603001bd11295c36d878698708bf59190f";
const MODEL_DTYPE = "q8";
const SAMPLE_RATE_HZ = 16_000;
const EMBEDDING_DIMENSION = 512;
const MAX_AUDIO_BYTES = 30 * SAMPLE_RATE_HZ * Float32Array.BYTES_PER_ELEMENT;
const MAX_DECODED_AUDIO_BYTES =
  31 * SAMPLE_RATE_HZ * Float32Array.BYTES_PER_ELEMENT;
const GROUP_SOURCE_ID = "chzzk-video:13996057";
const DEFAULT_ARTIFACT_ROOT = path.resolve(
  process.cwd(),
  "..",
  "artifacts",
  "voice-enrollment-candidates",
);

env.allowLocalModels = false;
env.useBrowserCache = false;
env.cacheDir =
  process.env.EXCLIPPER_MODEL_CACHE_DIR ??
  path.join(homedir(), ".cache", "exclipper", "huggingface");

function usage() {
  return [
    "Cross-check pending ExClipper speaker-enrollment candidates.",
    "",
    "Usage:",
    "  npm run enrollment:evaluate-speakers -- [--root <artifact-directory>]",
    "",
    "The command decodes FLAC candidates to ephemeral Float32 PCM, computes",
    "pinned WavLM x-vectors, prints cosine diagnostics, and persists neither",
    "PCM nor embeddings. Pending manifests remain pending.",
  ].join("\n");
}

function parseArguments(argv) {
  let root = DEFAULT_ARTIFACT_ROOT;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      console.log(usage());
      process.exit(0);
    }
    if (argument === "--root") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--root requires a directory path.");
      }
      root = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return { root };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeEmbedding(values) {
  if (!(values instanceof Float32Array) || values.length !== EMBEDDING_DIMENSION) {
    throw new Error("WavLM returned an invalid speaker embedding.");
  }
  let squaredNorm = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw new Error("WavLM returned a non-finite speaker embedding.");
    }
    squaredNorm += value * value;
  }
  if (!Number.isFinite(squaredNorm) || squaredNorm <= 1e-12) {
    throw new Error("WavLM returned a zero speaker embedding.");
  }
  const norm = Math.sqrt(squaredNorm);
  return Float32Array.from(values, (value) => value / norm);
}

function averagePrototype(embeddings) {
  if (embeddings.length === 0) {
    throw new Error("A speaker prototype requires at least one embedding.");
  }
  const average = new Float32Array(EMBEDDING_DIMENSION);
  for (const embedding of embeddings) {
    for (let index = 0; index < EMBEDDING_DIMENSION; index += 1) {
      average[index] += embedding[index];
    }
  }
  return normalizeEmbedding(average);
}

function cosine(left, right) {
  let dot = 0;
  for (let index = 0; index < EMBEDDING_DIMENSION; index += 1) {
    dot += left[index] * right[index];
  }
  return Math.max(-1, Math.min(1, dot));
}

function disposeTensorGraph(value, disposed = new Set()) {
  if (value === null || value === undefined || disposed.has(value)) return;
  if (value instanceof Tensor) {
    disposed.add(value);
    try {
      value.dispose();
    } catch {
      // Diagnostics are already complete; cleanup must not hide the result.
    }
    return;
  }
  if (typeof value !== "object") return;
  disposed.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry) => disposeTensorGraph(entry, disposed));
    return;
  }
  Object.values(value).forEach((entry) =>
    disposeTensorGraph(entry, disposed),
  );
}

async function decodeFlacToFloat32(filePath) {
  const chunks = [];
  let totalBytes = 0;
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.env.FFMPEG_PATH ?? "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-i",
        filePath,
        "-map",
        "0:a:0",
        "-vn",
        "-sn",
        "-dn",
        "-t",
        "30",
        "-ac",
        "1",
        "-ar",
        String(SAMPLE_RATE_HZ),
        "-f",
        "f32le",
        "pipe:1",
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const stderrChunks = [];
    child.stdout.on("data", (chunk) => {
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_DECODED_AUDIO_BYTES) {
        child.kill();
        reject(
          new Error(
            `${path.basename(filePath)} exceeds the bounded decode allowance.`,
          ),
        );
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (Buffer.concat(stderrChunks).byteLength < 16_384) {
        stderrChunks.push(chunk);
      }
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          Buffer.concat(stderrChunks).toString("utf8").trim() ||
            `ffmpeg exited with code ${String(code)}.`,
        ),
      );
    });
  });
  const bytes = Buffer.concat(chunks);
  if (bytes.byteLength === 0 || bytes.byteLength % 4 !== 0) {
    throw new Error(`${path.basename(filePath)} did not decode to Float32 PCM.`);
  }
  // HLS extraction may retain a tiny codec-delay tail beyond the requested
  // 30 seconds. Evaluation uses the same strict 30-second input bound as the
  // browser Worker and discards only that trailing padding.
  const copied = Uint8Array.from(bytes.subarray(0, MAX_AUDIO_BYTES));
  return new Float32Array(copied.buffer);
}

async function readCandidateAssets(root) {
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error("Candidate artifact root is not a directory.");
  }
  const directories = await readdir(root, { withFileTypes: true });
  const assets = [];
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const manifestPath = path.join(
      root,
      directory.name,
      "participant-voice-enrollment.candidates.json",
    );
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch {
      continue;
    }
    if (
      !isRecord(manifest) ||
      manifest.schemaVersion !== "1.0.0" ||
      !Array.isArray(manifest.assets)
    ) {
      throw new Error(`${directory.name} has an invalid candidate manifest.`);
    }
    for (const asset of manifest.assets) {
      if (
        !isRecord(asset) ||
        typeof asset.participantId !== "string" ||
        typeof asset.assetId !== "string" ||
        !isRecord(asset.source) ||
        typeof asset.source.sourceId !== "string"
      ) {
        throw new Error(`${directory.name} contains an invalid candidate asset.`);
      }
      const audioPath = path.join(
        root,
        directory.name,
        "audio",
        `${asset.assetId}.flac`,
      );
      const audioStat = await stat(audioPath);
      if (!audioStat.isFile() || audioStat.size <= 42) {
        throw new Error(`${asset.assetId} has no valid FLAC candidate.`);
      }
      assets.push({
        participantId: asset.participantId,
        assetId: asset.assetId,
        sourceId: asset.source.sourceId,
        audioPath,
      });
    }
  }
  if (assets.length === 0) {
    throw new Error("No speaker-enrollment candidate assets were found.");
  }
  return assets.sort((left, right) =>
    left.participantId.localeCompare(right.participantId) ||
    left.sourceId.localeCompare(right.sourceId) ||
    left.assetId.localeCompare(right.assetId),
  );
}

async function embedCandidate(resources, asset, ordinal, total) {
  console.log(
    `[${ordinal}/${total}] ${asset.participantId} · ${asset.assetId}`,
  );
  const samples = await decodeFlacToFloat32(asset.audioPath);
  let inputs = null;
  let output = null;
  try {
    inputs = await resources.processor(samples);
    output = await resources.model(inputs);
    if (
      !isRecord(output) ||
      !(output.embeddings instanceof Tensor) ||
      !(output.embeddings.data instanceof Float32Array)
    ) {
      throw new Error("WavLM did not return an embedding tensor.");
    }
    return normalizeEmbedding(output.embeddings.data);
  } finally {
    samples.fill(0);
    disposeTensorGraph(output);
    disposeTensorGraph(inputs);
  }
}

function printWithinPersonConsistency(individualEntries) {
  console.log("\n개인 채널 표본 내 일관성");
  const byParticipant = Map.groupBy(
    individualEntries,
    ({ asset }) => asset.participantId,
  );
  for (const [participantId, entries] of byParticipant) {
    const pairScores = [];
    for (let left = 0; left < entries.length; left += 1) {
      for (let right = left + 1; right < entries.length; right += 1) {
        pairScores.push(cosine(entries[left].embedding, entries[right].embedding));
      }
    }
    const minimum =
      pairScores.length === 0 ? null : Math.min(...pairScores);
    const average =
      pairScores.length === 0
        ? null
        : pairScores.reduce((sum, score) => sum + score, 0) /
          pairScores.length;
    console.log(
      `${participantId.padEnd(16)} 표본 ${entries.length}개 · ` +
        (average === null
          ? "쌍 비교 불가"
          : `평균 ${average.toFixed(3)} · 최저 ${minimum.toFixed(3)}`),
    );
  }
}

function printGroupCrossCheck(groupEntries, individualEntries) {
  const individualByParticipant = Map.groupBy(
    individualEntries,
    ({ asset }) => asset.participantId,
  );
  const prototypes = [...individualByParticipant].map(
    ([participantId, entries]) => ({
      participantId,
      embedding: averagePrototype(entries.map(({ embedding }) => embedding)),
    }),
  );
  console.log("\n전원 방송 표본 → 개인 채널 prototype 교차검증");
  console.log(
    `검증 가능 인원: ${prototypes.map(({ participantId }) => participantId).join(", ")}`,
  );
  for (const entry of groupEntries) {
    const scores = prototypes
      .map(({ participantId, embedding }) => ({
        participantId,
        score: cosine(entry.embedding, embedding),
      }))
      .sort((left, right) => right.score - left.score);
    const top1 = scores[0] ?? null;
    const top2 = scores[1] ?? null;
    const declared = scores.find(
      ({ participantId }) => participantId === entry.asset.participantId,
    );
    console.log(
      `${entry.asset.participantId.padEnd(16)} ` +
        `표기=${declared?.score.toFixed(3) ?? "미등록"} · ` +
        `top1=${top1?.participantId ?? "없음"} ${top1?.score.toFixed(3) ?? "-"} · ` +
        `margin=${top1 !== null && top2 !== null ? (top1.score - top2.score).toFixed(3) : "-"}`,
    );
  }
}

async function main() {
  const { root } = parseArguments(process.argv.slice(2));
  const assets = await readCandidateAssets(root);
  console.log(`후보 ${assets.length}개 · 모델 ${MODEL_ID}@${MODEL_REVISION}`);
  console.log(`모델 캐시: ${env.cacheDir}`);
  const processor = await AutoProcessor.from_pretrained(MODEL_ID, {
    revision: MODEL_REVISION,
  });
  const model = await AutoModel.from_pretrained(MODEL_ID, {
    revision: MODEL_REVISION,
    dtype: MODEL_DTYPE,
    // The production browser Worker uses WASM. Transformers.js exposes the
    // equivalent CPU backend in Node, so this offline diagnostic keeps the
    // exact model/revision/dtype while using Node's supported device name.
    device: "cpu",
  });
  const embedded = [];
  try {
    for (const [index, asset] of assets.entries()) {
      const embedding = await embedCandidate(
        { processor, model },
        asset,
        index + 1,
        assets.length,
      );
      embedded.push({ asset, embedding });
    }
    const groupEntries = embedded.filter(
      ({ asset }) => asset.sourceId === GROUP_SOURCE_ID,
    );
    const individualEntries = embedded.filter(
      ({ asset }) => asset.sourceId !== GROUP_SOURCE_ID,
    );
    printWithinPersonConsistency(individualEntries);
    printGroupCrossCheck(groupEntries, individualEntries);
    console.log(
      "\n주의: 이 수치는 후보 품질 진단일 뿐 사람 검증·동의·음악/겹침 검사를 대신하지 않습니다.",
    );
  } finally {
    for (const { embedding } of embedded) embedding.fill(0);
    disposeTensorGraph(model);
    disposeTensorGraph(processor);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
