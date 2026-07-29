#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertAllowedChzzkMediaUrl,
  buildBoundedHlsMediaPlaylist,
  buildPendingVoiceEnrollmentManifest,
  candidateVoiceAudioFileName,
  parseHlsMasterPlaylist,
  parseHlsMediaPlaylist,
  parseVoiceEnrollmentCliArguments,
  parseVoiceEnrollmentRecipe,
  redactVoiceEnrollmentToolError,
  selectLowestBandwidthVariant,
  VOICE_ENROLLMENT_APPROVED_SOURCES,
} from "./lib/voice-enrollment-candidate.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const PUBLIC_DIRECTORY = path.join(REPOSITORY_ROOT, "public");
const CHZZK_REFERER = "https://chzzk.naver.com/";
const USER_AGENT =
  "Mozilla/5.0 (compatible; ExClipper-VoiceEnrollmentCandidateTool/1.0)";
const MAX_RECIPE_BYTES = 256 * 1024;
const MAX_METADATA_BYTES = 512 * 1024;
const MAX_PLAYBACK_JSON_BYTES = 1024 * 1024;
const MAX_MASTER_PLAYLIST_BYTES = 256 * 1024;
const MAX_MEDIA_PLAYLIST_BYTES = 2 * 1024 * 1024;
const MAX_PROCESS_STDERR_BYTES = 64 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
const FFMPEG_TIMEOUT_MS = 120_000;

function usage() {
  return [
    "Developer-only CHZZK voice enrollment candidate extractor",
    "",
    "Usage:",
    "  npm run enrollment:extract-candidates -- --recipe <recipe.json> [options]",
    "",
    "Options:",
    "  --output <directory>  New output directory. Defaults outside the repo public/ tree.",
    "  --ffmpeg <executable>  ffmpeg executable. Defaults to FFMPEG_PATH or ffmpeg.",
    "  --help                 Show this help.",
    "",
    "Every recipe is fenced to one explicitly approved CHZZK replay. All outputs remain",
    "consent=unknown, humanVerification=pending, overlap/music=true and are",
    "therefore never automatically eligible for speaker enrollment.",
  ].join("\n");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function signalWithTimeout(parentSignal, timeoutMs) {
  return AbortSignal.any([parentSignal, AbortSignal.timeout(timeoutMs)]);
}

async function readResponseBytes(response, maximumBytes, label) {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)
  ) {
    throw new Error(`${label} exceeds its ${maximumBytes}-byte limit.`);
  }
  if (response.body === null) {
    throw new Error(`${label} has no response body.`);
  }
  const chunks = [];
  let totalBytes = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new Error(`${label} exceeds its ${maximumBytes}-byte limit.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchText(
  url,
  maximumBytes,
  label,
  abortSignal,
  { accept, mediaOrigin = null } = {},
) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: accept ?? "text/plain,*/*",
      "Accept-Language": "ko-KR,ko;q=0.9",
      Referer: CHZZK_REFERER,
      "User-Agent": USER_AGENT,
    },
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal: signalWithTimeout(abortSignal, FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}.`);
  }
  if (mediaOrigin !== null) {
    assertAllowedChzzkMediaUrl(response.url, mediaOrigin);
  }
  const bytes = await readResponseBytes(response, maximumBytes, label);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function fetchPlaybackPlan(videoNo, expectedChannelId, abortSignal) {
  if (
    typeof videoNo !== "string" ||
    !/^[0-9]{1,20}$/u.test(videoNo) ||
    typeof expectedChannelId !== "string" ||
    !/^[a-f0-9]{32}$/u.test(expectedChannelId)
  ) {
    throw new Error("Approved CHZZK replay number is invalid.");
  }
  const metadataUrl =
    `https://api.chzzk.naver.com/service/v2/videos/${videoNo}`;
  const metadataText = await fetchText(
    metadataUrl,
    MAX_METADATA_BYTES,
    "CHZZK replay metadata",
    abortSignal,
    { accept: "application/json" },
  );
  let metadata;
  try {
    metadata = JSON.parse(metadataText);
  } catch {
    throw new Error("CHZZK replay metadata is not valid JSON.");
  }
  const content =
    isRecord(metadata) && isRecord(metadata.content) ? metadata.content : null;
  if (
    content === null ||
    String(content.videoNo) !== videoNo ||
    !isRecord(content.channel) ||
    content.channel.channelId !== expectedChannelId ||
    !Number.isFinite(content.duration) ||
    content.duration <= 0 ||
    typeof content.liveRewindPlaybackJson !== "string" ||
    Buffer.byteLength(content.liveRewindPlaybackJson, "utf8") >
      MAX_PLAYBACK_JSON_BYTES
  ) {
    throw new Error("CHZZK replay metadata is missing bounded playback data.");
  }
  let playback;
  try {
    playback = JSON.parse(content.liveRewindPlaybackJson);
  } catch {
    throw new Error("CHZZK playback metadata is not valid JSON.");
  }
  const media =
    isRecord(playback) && Array.isArray(playback.media)
      ? playback.media.find(
          (candidate) =>
            isRecord(candidate) &&
            candidate.protocol === "HLS" &&
            typeof candidate.path === "string",
        )
      : null;
  if (!isRecord(media) || typeof media.path !== "string") {
    throw new Error(
      "CHZZK replay does not expose a bounded HLS playback path.",
    );
  }
  return {
    sourceDurationMs: Math.round(content.duration * 1_000),
    masterUrl: assertAllowedChzzkMediaUrl(media.path),
  };
}

async function readJsonFile(filePath, maximumBytes) {
  const file = await stat(filePath);
  if (!file.isFile() || file.size <= 0 || file.size > maximumBytes) {
    throw new Error(`Recipe must be a 1-${maximumBytes} byte JSON file.`);
  }
  const text = await readFile(filePath, "utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Recipe is not valid JSON.");
  }
}

function pathIsWithin(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

async function outputTargetForRecipe(recipe, requestedPath) {
  const targetPath = path.resolve(
    requestedPath ??
      path.join(
        REPOSITORY_ROOT,
        "..",
        "artifacts",
        "voice-enrollment-candidates",
        recipe.manifestRevision,
      ),
  );
  const parentPath = path.dirname(targetPath);
  await mkdir(parentPath, { recursive: true });
  const [realParent, realPublic] = await Promise.all([
    realpath(parentPath),
    realpath(PUBLIC_DIRECTORY),
  ]);
  const canonicalTarget = path.join(realParent, path.basename(targetPath));
  if (
    canonicalTarget === realParent ||
    pathIsWithin(realPublic, canonicalTarget)
  ) {
    throw new Error("Output directory must remain outside public/.");
  }
  try {
    await access(canonicalTarget);
  } catch (cause) {
    if (cause?.code === "ENOENT") return canonicalTarget;
    throw cause;
  }
  throw new Error(
    "Output directory already exists. Choose a new directory; existing evidence is never overwritten.",
  );
}

async function runFfmpeg(
  ffmpegPath,
  playlistPath,
  outputPath,
  seekOffsetMs,
  durationMs,
  abortSignal,
) {
  const arguments_ = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-protocol_whitelist",
    "file,http,https,tcp,tls,crypto",
    "-allowed_extensions",
    "ALL",
    "-i",
    playlistPath,
    "-ss",
    (seekOffsetMs / 1_000).toFixed(3),
    "-t",
    (durationMs / 1_000).toFixed(3),
    "-map",
    "0:a:0",
    "-vn",
    "-sn",
    "-dn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "flac",
    "-compression_level",
    "8",
    "-y",
    outputPath,
  ];
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, arguments_, {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
      signal: signalWithTimeout(abortSignal, FFMPEG_TIMEOUT_MS),
    });
    const stderrChunks = [];
    let stderrBytes = 0;
    child.stderr.on("data", (chunk) => {
      if (stderrBytes >= MAX_PROCESS_STDERR_BYTES) return;
      const remaining = MAX_PROCESS_STDERR_BYTES - stderrBytes;
      const bounded = chunk.subarray(0, remaining);
      stderrChunks.push(bounded);
      stderrBytes += bounded.byteLength;
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      reject(
        new Error(
          redactVoiceEnrollmentToolError(stderr) ||
            `ffmpeg failed with code ${String(code)} and signal ${String(signal)}.`,
        ),
      );
    });
  });
}

async function assertFlacFile(filePath) {
  const file = await stat(filePath);
  if (!file.isFile() || file.size < 42) {
    throw new Error("ffmpeg produced an empty or truncated FLAC candidate.");
  }
  const handle = await open(filePath, "r");
  try {
    const signature = Buffer.alloc(4);
    const { bytesRead } = await handle.read(signature, 0, 4, 0);
    if (bytesRead !== 4 || signature.toString("ascii") !== "fLaC") {
      throw new Error("ffmpeg output is not a FLAC file.");
    }
  } finally {
    await handle.close();
  }
}

async function sha256File(filePath) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    digest.update(chunk);
  }
  return `sha256:${digest.digest("hex")}`;
}

async function extractCandidates(options, abortSignal) {
  const recipePath = path.resolve(options.recipePath);
  const recipe = parseVoiceEnrollmentRecipe(
    await readJsonFile(recipePath, MAX_RECIPE_BYTES),
  );
  const outputPath = await outputTargetForRecipe(recipe, options.outputPath);
  const ffmpegPath = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg";
  const stagingPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.partial-${randomUUID()}`,
  );
  const playlistDirectory = await mkdtemp(
    path.join(tmpdir(), "exclipper-voice-enrollment-"),
  );
  let published = false;
  try {
    await mkdir(path.join(stagingPath, "audio"), { recursive: true });
    console.log("1/4 CHZZK replay metadata and current HLS master");
    const approvedSource = VOICE_ENROLLMENT_APPROVED_SOURCES[recipe.videoNo];
    if (approvedSource === undefined) {
      throw new Error("Recipe source approval disappeared after validation.");
    }
    const playback = await fetchPlaybackPlan(
      recipe.videoNo,
      approvedSource.expectedChannelId,
      abortSignal,
    );
    const maximumRecipeEndMs = Math.max(
      ...recipe.ranges.map(({ endMs }) => endMs),
    );
    if (maximumRecipeEndMs > playback.sourceDurationMs + 1_000) {
      throw new Error(
        "Recipe range exceeds the current CHZZK replay duration.",
      );
    }
    const masterText = await fetchText(
      playback.masterUrl,
      MAX_MASTER_PLAYLIST_BYTES,
      "CHZZK HLS master playlist",
      abortSignal,
      {
        accept:
          "application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*",
        mediaOrigin: playback.masterUrl.origin,
      },
    );
    const lowestVariant = selectLowestBandwidthVariant(
      parseHlsMasterPlaylist(masterText, playback.masterUrl),
    );
    console.log(
      `2/4 Lowest HLS variant selected (${lowestVariant.resolution ?? "unknown resolution"}, ${lowestVariant.bandwidth} bps)`,
    );
    const mediaText = await fetchText(
      lowestVariant.url,
      MAX_MEDIA_PLAYLIST_BYTES,
      "CHZZK HLS media playlist",
      abortSignal,
      {
        accept:
          "application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*",
        mediaOrigin: lowestVariant.url.origin,
      },
    );
    const mediaPlaylist = parseHlsMediaPlaylist(mediaText, lowestVariant.url);
    if (maximumRecipeEndMs > mediaPlaylist.durationMs + 1) {
      throw new Error("Recipe range exceeds the fetched HLS media playlist.");
    }

    console.log(
      `3/4 Extracting ${recipe.ranges.length} bounded 16 kHz mono FLAC candidates`,
    );
    const extractedAssets = [];
    for (const [index, range] of recipe.ranges.entries()) {
      if (abortSignal.aborted) {
        throw abortSignal.reason;
      }
      const bounded = buildBoundedHlsMediaPlaylist(
        mediaPlaylist,
        range.startMs,
        range.endMs,
      );
      const stem = candidateVoiceAudioFileName(recipe.videoNo, range).replace(
        /\.flac$/u,
        "",
      );
      const playlistPath = path.join(playlistDirectory, `${stem}.m3u8`);
      const partialPath = path.join(
        stagingPath,
        "audio",
        `${stem}.partial.flac`,
      );
      const finalPath = path.join(stagingPath, "audio", `${stem}.flac`);
      await writeFile(playlistPath, bounded.playlistText, {
        encoding: "utf8",
        flag: "wx",
      });
      await runFfmpeg(
        ffmpegPath,
        playlistPath,
        partialPath,
        bounded.seekOffsetMs,
        range.durationMs,
        abortSignal,
      );
      await assertFlacFile(partialPath);
      await rename(partialPath, finalPath);
      extractedAssets.push({
        participantId: range.participantId,
        startMs: range.startMs,
        endMs: range.endMs,
        contentSha256: await sha256File(finalPath),
      });
      console.log(
        `  ${index + 1}/${recipe.ranges.length} ${range.participantId}: ` +
          `${range.durationMs / 1_000}s from ${bounded.selectedSegmentCount} bounded HLS segments`,
      );
    }

    const manifest = buildPendingVoiceEnrollmentManifest(
      recipe,
      extractedAssets,
    );
    await writeFile(
      path.join(stagingPath, "participant-voice-enrollment.candidates.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    await writeFile(
      path.join(stagingPath, "README.txt"),
      [
        "ExClipper developer-only voice enrollment candidates",
        "",
        "These files are not verified speaker enrollment assets.",
        "The manifest intentionally keeps consent=unknown,",
        "humanVerification=pending, containsOverlappingSpeech=true and",
        "containsMusic=true. A human must review every file before any",
        "separate, explicit manifest revision can become eligible.",
        "",
      ].join("\n"),
      { encoding: "utf8", flag: "wx" },
    );
    await rename(stagingPath, outputPath);
    published = true;
    console.log(`4/4 Pending candidate package published: ${outputPath}`);
    return outputPath;
  } finally {
    await rm(playlistDirectory, { recursive: true, force: true });
    if (!published) {
      await rm(stagingPath, { recursive: true, force: true });
    }
  }
}

async function main() {
  let options;
  try {
    options = parseVoiceEnrollmentCliArguments(process.argv.slice(2));
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause));
    console.error("");
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }

  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort(new Error("Candidate extraction was interrupted."));
    }
  };
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    await extractCandidates(options, controller.signal);
  } catch (cause) {
    console.error(
      `Candidate extraction failed: ${redactVoiceEnrollmentToolError(
        cause instanceof Error ? cause.message : String(cause),
      )}`,
    );
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}

await main();
