import { createHash } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import {
  CHANNEL_PREANALYSIS_BUNDLE_MAX_BYTES,
  parseChannelPreanalysisBundle,
  verifyChannelPreanalysisTranscriptDigest,
} from "../../src/analysis/channelPreanalysisBundle.ts";
import {
  CHANNEL_PREANALYSIS_TITLE_DURATION_TOLERANCE_MS,
} from "../../src/analysis/channelPreanalysisCatalog.ts";
import { parseChannelPreanalysisManifest } from "../../src/analysis/channelPreanalysisClient.ts";
import { createBroadcastParticipantGrounding } from "../../src/analysis/broadcastParticipantGrounding.ts";
import { createChannelPreanalysisReviewContentDigests } from "../../src/analysis/channelPreanalysisReviewBundle.ts";
import {
  CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_BYTES,
  canonicalChannelPreanalysisVisualFingerprintArtifactId,
  canonicalChannelPreanalysisVisualFingerprintStorageKey,
  parseChannelPreanalysisVisualFingerprint,
} from "../../src/analysis/channelPreanalysisVisualFingerprint.ts";
import { candidatePassBCastRosterIdForYouTubeChannelId } from "../../src/analysis/participantRoster.ts";
import { channelPreanalysisStoragePrefix } from "../../src/analysis/channelPreanalysisSources.ts";
import {
  downloadChannelPreanalysisYouTubeMedia,
  extractChannelPreanalysisAudioFeatureWindows,
  probeChannelPreanalysisMedia,
} from "./channel-preanalysis-media.mjs";
import { createChannelPreanalysisReviewCheckpointStore } from "./channel-preanalysis-review-checkpoint.mjs";
import { createChannelPreanalysisReviewMediaExtractor } from "./channel-preanalysis-review-media-adapter.mjs";
import { publishChannelPreanalysisReview } from "./channel-preanalysis-review-publisher.mjs";
import { extractChannelPreanalysisVisualCoverage } from "./channel-preanalysis-visual-coverage.mjs";
import {
  CHANNEL_PREANALYSIS_REVIEW_DEFAULT_CONCURRENCY,
  runChannelPreanalysisReview,
} from "./channel-preanalysis-review-runner.mjs";

export const CHANNEL_PREANALYSIS_REVIEW_PIPELINE_REVISION =
  "scheduled-review-ready-v3";
export const CHANNEL_PREANALYSIS_REVIEW_JOB_MAX_VIDEOS = 2;

const MANIFEST_MAX_BYTES = 4 * 1_024 * 1_024;

export class ChannelPreanalysisReviewJobError extends Error {
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ChannelPreanalysisReviewJobError";
    this.code = code;
  }
}

function jobError(code, message, cause) {
  return new ChannelPreanalysisReviewJobError(code, message, cause);
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function readBounded(path, maximumBytes, code) {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maximumBytes) {
    throw jobError(code, "A scheduled review input has an invalid byte length.");
  }
  const bytes = await readFile(path);
  if (bytes.byteLength !== metadata.size || bytes.byteLength > maximumBytes) {
    throw jobError(code, "A scheduled review input changed while it was read.");
  }
  return bytes;
}

function artifactPath(catalogDir, source, storageKey) {
  const prefix = channelPreanalysisStoragePrefix(source);
  if (typeof storageKey !== "string" || !storageKey.startsWith(prefix)) {
    throw jobError(
      "CONTEXT_ARTIFACT_INVALID",
      "The context artifact is outside its configured source namespace.",
    );
  }
  const root = resolve(catalogDir);
  const path = resolve(root, storageKey.slice(prefix.length));
  if (path === root || !path.startsWith(`${root}${sep}`)) {
    throw jobError(
      "CONTEXT_ARTIFACT_INVALID",
      "The context artifact path escapes its catalog namespace.",
    );
  }
  return path;
}

export function selectChannelPreanalysisReviewQueue(
  manifest,
  {
    nowMs = Date.now(),
    maxVideos = CHANNEL_PREANALYSIS_REVIEW_JOB_MAX_VIDEOS,
    videoId = null,
  } = {},
) {
  if (
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0 ||
    !Number.isSafeInteger(maxVideos) ||
    maxVideos < 1 ||
    maxVideos > CHANNEL_PREANALYSIS_REVIEW_JOB_MAX_VIDEOS
  ) {
    throw jobError("INVALID_QUEUE_OPTIONS", "The review queue bounds are invalid.");
  }
  const pending = manifest.videos
    .filter((video) => video.state === "context-ready")
    .sort((left, right) =>
      Date.parse(right.publishedAt) - Date.parse(left.publishedAt) ||
      left.videoId.localeCompare(right.videoId),
    );
  const retries = manifest.videos
    .filter((video) =>
      video.state === "retryable" &&
      video.retry?.stage === "review" &&
      video.retry.lastSuccessfulState === "context-ready" &&
      Date.parse(video.retry.nextAttemptAt) <= nowMs,
    )
    .sort((left, right) =>
      Date.parse(left.retry.nextAttemptAt) - Date.parse(right.retry.nextAttemptAt) ||
      left.videoId.localeCompare(right.videoId),
    );
  if (videoId !== null) {
    const exact = [...pending, ...retries].find((video) => video.videoId === videoId);
    return exact === undefined ? [] : [exact];
  }

  const selected = [];
  if (pending[0] !== undefined) selected.push(pending.shift());
  if (selected.length < maxVideos && retries[0] !== undefined) {
    selected.push(retries.shift());
  }
  for (const video of [...pending, ...retries]) {
    if (selected.length >= maxVideos) break;
    selected.push(video);
  }
  return selected;
}

export async function loadChannelPreanalysisReviewInput({ catalogDir, source, video }) {
  const manifestBytes = await readBounded(
    join(catalogDir, "catalog.json"),
    MANIFEST_MAX_BYTES,
    "CATALOG_INVALID",
  );
  const manifest = parseChannelPreanalysisManifest(
    new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes),
    source,
  );
  const currentVideo = manifest.videos.find(({ videoId }) => videoId === video.videoId);
  if (
    currentVideo === undefined ||
    currentVideo.revision !== video.revision ||
    currentVideo.state !== video.state
  ) {
    throw jobError("CATALOG_SNAPSHOT_STALE", "The selected review video is stale.");
  }
  const artifactById = new Map(
    manifest.artifacts.map((artifact) => [artifact.artifactId, artifact]),
  );
  const transcriptArtifacts = currentVideo.artifactIds
    .map((artifactId) => artifactById.get(artifactId))
    .filter((artifact) => artifact?.kind === "transcript");
  if (transcriptArtifacts.length !== 1) {
    throw jobError(
      "CONTEXT_ARTIFACT_INVALID",
      "A review candidate requires exactly one durable context transcript artifact.",
    );
  }
  const artifact = transcriptArtifacts[0];
  const bytes = await readBounded(
    artifactPath(catalogDir, source, artifact.storageKey),
    CHANNEL_PREANALYSIS_BUNDLE_MAX_BYTES,
    "CONTEXT_ARTIFACT_INVALID",
  );
  if (bytes.byteLength !== artifact.byteLength || sha256(bytes) !== artifact.contentDigest) {
    throw jobError(
      "CONTEXT_ARTIFACT_DIGEST_MISMATCH",
      "The context transcript bytes do not match their catalog receipt.",
    );
  }
  const contextBundle = parseChannelPreanalysisBundle(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  await verifyChannelPreanalysisTranscriptDigest(contextBundle);
  if (
    contextBundle.state !== "context-ready" ||
    contextBundle.broadcastContext === null ||
    contextBundle.channelId !== source.channelId ||
    contextBundle.videoId !== currentVideo.videoId ||
    contextBundle.durationMs !== currentVideo.durationMs
  ) {
    throw jobError(
      "CONTEXT_CHECKPOINT_INVALID",
      "The persisted context checkpoint is not closed over this exact video.",
    );
  }
  const fingerprintArtifacts = currentVideo.artifactIds
    .map((artifactId) => artifactById.get(artifactId))
    .filter((candidate) => candidate?.kind === "fingerprint");
  const fingerprintArtifact = fingerprintArtifacts[0];
  if (
    fingerprintArtifacts.length !== 1 ||
    fingerprintArtifact === undefined ||
    fingerprintArtifact.artifactId !==
      canonicalChannelPreanalysisVisualFingerprintArtifactId(currentVideo.videoId) ||
    fingerprintArtifact.revision !== 1 ||
    fingerprintArtifact.storageKey !==
      canonicalChannelPreanalysisVisualFingerprintStorageKey(
        currentVideo.videoId,
        source.sourceId,
      )
  ) {
    throw jobError(
      "VISUAL_FINGERPRINT_INVALID",
      "A scheduled review requires one exact distributed visual fingerprint.",
    );
  }
  const fingerprintBytes = await readBounded(
    artifactPath(catalogDir, source, fingerprintArtifact.storageKey),
    CHANNEL_PREANALYSIS_VISUAL_FINGERPRINT_MAX_BYTES,
    "VISUAL_FINGERPRINT_INVALID",
  );
  if (
    fingerprintBytes.byteLength !== fingerprintArtifact.byteLength ||
    sha256(fingerprintBytes) !== fingerprintArtifact.contentDigest
  ) {
    throw jobError(
      "VISUAL_FINGERPRINT_DIGEST_MISMATCH",
      "The visual fingerprint bytes do not match their catalog receipt.",
    );
  }
  const visualFingerprint = parseChannelPreanalysisVisualFingerprint(
    new TextDecoder("utf-8", { fatal: true }).decode(fingerprintBytes),
  );
  if (
    visualFingerprint.videoId !== currentVideo.videoId ||
    visualFingerprint.sourceDurationMs !== currentVideo.durationMs
  ) {
    throw jobError(
      "VISUAL_FINGERPRINT_INVALID",
      "The visual fingerprint is not closed over the selected video.",
    );
  }
  return {
    manifest,
    video: currentVideo,
    artifact,
    contextBundle,
    fingerprintArtifact,
    visualFingerprint,
  };
}

function participantGrounding(contextBundle) {
  const castRosterId = candidatePassBCastRosterIdForYouTubeChannelId(
    contextBundle.channelId,
  );
  if (castRosterId === null) {
    throw jobError(
      "PARTICIPANT_ROSTER_MISSING",
      "The scheduled source has no participant roster.",
    );
  }
  return createBroadcastParticipantGrounding({
    sourceDurationMs: contextBundle.durationMs,
    castRosterId,
    chapters: contextBundle.chapters,
  });
}

/**
 * Produces and atomically publishes one exact review-ready artifact. A failed
 * candidate remains in the durable candidate checkpoint and the catalog stays
 * retryable; no partial candidate list is ever exposed to the editor.
 */
export async function prepareChannelPreanalysisReviewVideo(
  {
    catalogDir,
    source,
    video,
    createCandidateAnalyzer,
    ytDlpPath,
    ytDlpEnvironment,
    workRoot,
    ffmpegPath = "ffmpeg",
    ffprobePath = "ffprobe",
    candidateConcurrency = CHANNEL_PREANALYSIS_REVIEW_DEFAULT_CONCURRENCY,
    pipelineRevision = CHANNEL_PREANALYSIS_REVIEW_PIPELINE_REVISION,
  },
  dependencies = {},
) {
  if (typeof createCandidateAnalyzer !== "function") {
    throw jobError(
      "CANDIDATE_ANALYZER_REQUIRED",
      "A candidate AI analyzer factory is required.",
    );
  }
  const loaded = await loadChannelPreanalysisReviewInput({ catalogDir, source, video });
  const downloadMedia = dependencies.downloadMedia ?? downloadChannelPreanalysisYouTubeMedia;
  const probeMedia = dependencies.probeMedia ?? probeChannelPreanalysisMedia;
  const extractAudioFeatures =
    dependencies.extractAudioFeatures ?? extractChannelPreanalysisAudioFeatureWindows;
  const createMediaExtractor =
    dependencies.createMediaExtractor ?? createChannelPreanalysisReviewMediaExtractor;
  const extractVisualCoverage =
    dependencies.extractVisualCoverage ?? extractChannelPreanalysisVisualCoverage;
  const runReview = dependencies.runReview ?? runChannelPreanalysisReview;
  const publishReview = dependencies.publishReview ?? publishChannelPreanalysisReview;
  const createCheckpointStore =
    dependencies.createCheckpointStore ?? createChannelPreanalysisReviewCheckpointStore;
  const nowIso = dependencies.nowIso ?? (() => new Date().toISOString());
  let checkpointStore = null;
  let downloaded = null;
  const outputRoot = resolve(workRoot);

  try {
    const publication = await publishReview(
      {
        catalogDir,
        source,
        video: loaded.video,
        contextBundle: loaded.contextBundle,
      },
      {
        nowIso,
        prepareReview: async ({ artifactRevision }) => {
          downloaded = await downloadMedia(
            {
              videoId: loaded.video.videoId,
              watchUrl: loaded.video.watchUrl,
              outputRoot,
            },
            { ytDlpPath, environment: ytDlpEnvironment },
          );
          const media = await probeMedia(downloaded.sourcePath, { ffprobePath });
          if (
            Math.abs(media.durationMs - loaded.contextBundle.durationMs) >
            CHANNEL_PREANALYSIS_TITLE_DURATION_TOLERANCE_MS
          ) {
            throw jobError(
              "MEDIA_DURATION_MISMATCH",
              "The downloaded media duration does not match the catalog video.",
            );
          }
          const audioFeatures = await extractAudioFeatures(
            downloaded.sourcePath,
            loaded.contextBundle.durationMs,
            { ffmpegPath },
          );
          const visualAnalysis = await extractVisualCoverage(
            downloaded.sourcePath,
            loaded.contextBundle.durationMs,
            {
              videoId: loaded.video.videoId,
              sourceFingerprint: loaded.visualFingerprint,
              sourceFingerprintArtifact: loaded.fingerprintArtifact,
              ffmpegPath,
            },
          );
          const grounding = participantGrounding(loaded.contextBundle);
          const { broadcastContextDigest } =
            await createChannelPreanalysisReviewContentDigests({
              source: {
                sourceId: source.sourceId,
                channelId: source.channelId,
                videoId: loaded.video.videoId,
              },
              broadcastContext: loaded.contextBundle.broadcastContext,
              participantGrounding: grounding,
              candidates: [],
            });
          checkpointStore = createCheckpointStore({
            catalogDir,
            runIdentity: {
              sourceId: source.sourceId,
              channelId: source.channelId,
              videoId: loaded.video.videoId,
              contextArtifactDigest: loaded.artifact.contentDigest,
              broadcastContextDigest,
              artifactRevision,
              pipelineRevision,
            },
            nowIso,
          });
          const checkpoint = await checkpointStore.load();
          const extractCandidateMedia = createMediaExtractor({
            sourcePath: downloaded.sourcePath,
            sourceDurationMs: loaded.contextBundle.durationMs,
            outputRoot,
            mediaExecutorOptions: { ffmpegPath },
          });
          const analyzeCandidate = await createCandidateAnalyzer({
            artifactRevision,
            contextBundle: loaded.contextBundle,
            participantGrounding: grounding,
          });
          if (typeof analyzeCandidate !== "function") {
            throw jobError(
              "CANDIDATE_ANALYZER_INVALID",
              "The candidate AI analyzer factory did not return an analyzer.",
            );
          }
          const result = await runReview({
            sourceId: source.sourceId,
            bundle: loaded.contextBundle,
            audioFeatures,
            visualCoverage: visualAnalysis.receipt,
            visualCandidateSeeds: visualAnalysis.seeds,
            participantGrounding: grounding,
            artifactRevision,
            createdAt: nowIso(),
            pipelineRevision,
            outputLanguage: "ko",
            candidateConcurrency,
            previousCandidateResults: checkpoint.previousCandidateResults,
            onCandidateCheckpoint: checkpointStore.onCandidateCheckpoint,
            extractCandidateMedia,
            analyzeCandidate,
          });
          if (result.status !== "complete" || result.reviewBundle === null) {
            throw jobError(
              "REVIEW_CANDIDATES_INCOMPLETE",
              `The review has ${String(result.retryCandidateIds.length)} candidate(s) to recover.`,
            );
          }
          return result.reviewBundle;
        },
      },
    );
    if (publication.state === "review-ready" && checkpointStore !== null) {
      await checkpointStore.finalizeAfterPublisherSuccess(publication);
    }
    return publication;
  } finally {
    if (downloaded?.workingDirectory !== undefined) {
      await rm(downloaded.workingDirectory, { recursive: true, force: true });
    }
  }
}

export async function runChannelPreanalysisReviewQueue(
  {
    catalogDir,
    source,
    maxVideos = CHANNEL_PREANALYSIS_REVIEW_JOB_MAX_VIDEOS,
    videoId = null,
    nowMs = Date.now(),
    ...videoOptions
  },
  dependencies = {},
) {
  const bytes = await readBounded(
    join(catalogDir, "catalog.json"),
    MANIFEST_MAX_BYTES,
    "CATALOG_INVALID",
  );
  const manifest = parseChannelPreanalysisManifest(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    source,
  );
  const queue = selectChannelPreanalysisReviewQueue(manifest, {
    maxVideos,
    videoId,
    nowMs,
  });
  const outcomes = [];
  for (const selectedVideo of queue) {
    outcomes.push(
      await prepareChannelPreanalysisReviewVideo(
        {
          catalogDir,
          source,
          video: selectedVideo,
          ...videoOptions,
        },
        dependencies,
      ),
    );
  }
  return Object.freeze({ selectedVideoIds: queue.map(({ videoId: id }) => id), outcomes });
}
