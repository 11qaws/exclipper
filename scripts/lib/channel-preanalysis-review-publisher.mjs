import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import {
  CHANNEL_PREANALYSIS_BUNDLE_MAX_BYTES,
  parseChannelPreanalysisBundle,
  validateChannelPreanalysisBundle,
  verifyChannelPreanalysisTranscriptDigest,
} from "../../src/analysis/channelPreanalysisBundle.ts";
import { parseChannelPreanalysisManifest } from "../../src/analysis/channelPreanalysisClient.ts";
import {
  CHANNEL_PREANALYSIS_REVIEW_BUNDLE_MAX_BYTES,
  ChannelPreanalysisReviewBundleError,
  channelPreanalysisReviewBundleArtifactId,
  channelPreanalysisReviewBundleStorageKey,
  parseChannelPreanalysisReviewBundle,
  validateChannelPreanalysisReviewBundle,
  verifyChannelPreanalysisReviewBundleIntegrity,
} from "../../src/analysis/channelPreanalysisReviewBundle.ts";
import {
  channelPreanalysisSourceById,
  channelPreanalysisStoragePrefix,
} from "../../src/analysis/channelPreanalysisSources.ts";

const CATALOG_FILE = "catalog.json";
const MANIFEST_MAX_BYTES = 4 * 1024 * 1024;
const RETRY_DELAYS_MS = [3, 6, 12, 24].map(
  (hours) => hours * 60 * 60_000,
);

export class ChannelPreanalysisReviewPublisherError extends Error {
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ChannelPreanalysisReviewPublisherError";
    this.code = code;
  }
}

function publisherError(code, message, cause) {
  return new ChannelPreanalysisReviewPublisherError(code, message, cause);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCodeOf(error, fallback = "REVIEW_PUBLICATION_FAILED") {
  const value = isRecord(error) && typeof error.code === "string"
    ? error.code
    : fallback;
  return String(value)
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 64) || fallback;
}

function assertIsoDate(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw publisherError("INVALID_INPUT", `${label} must be an ISO timestamp.`);
  }
  return value;
}

function requireSource(value) {
  const source = isRecord(value) && typeof value.sourceId === "string"
    ? channelPreanalysisSourceById(value.sourceId)
    : null;
  if (
    source === null ||
    value.channelId !== source.channelId ||
    value.channelHandle !== source.channelHandle
  ) {
    throw publisherError(
      "SOURCE_INVALID",
      "The review publisher source is not in the configured channel registry.",
    );
  }
  return source;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readTextIfPresent(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

async function readBoundedText(path, maximumBytes, code) {
  const file = await stat(path);
  if (!file.isFile() || file.size <= 0 || file.size > maximumBytes) {
    throw publisherError(code, "The persisted artifact has an invalid byte length.");
  }
  const bytes = await readFile(path);
  if (bytes.byteLength !== file.size || bytes.byteLength > maximumBytes) {
    throw publisherError(code, "The persisted artifact changed while being read.");
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw publisherError(code, "The persisted artifact is not valid UTF-8.", cause);
  }
  return { bytes, text };
}

async function writeTextAtomic(path, text) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = join(
    dirname(path),
    `.${path.split(/[\\/]/u).at(-1)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function writeImmutableAtomic(path, text) {
  const existing = await readTextIfPresent(path);
  if (existing !== null) {
    if (existing === text) return;
    throw publisherError(
      "IMMUTABLE_REVIEW_CONFLICT",
      "A different immutable review bundle already occupies this revision.",
    );
  }
  await writeTextAtomic(path, text);
}

function artifactPath(catalogDir, source, storageKey) {
  const prefix = channelPreanalysisStoragePrefix(source);
  if (!storageKey.startsWith(prefix)) {
    throw publisherError(
      "ARTIFACT_STORAGE_KEY_INVALID",
      "The artifact is outside its configured source namespace.",
    );
  }
  const root = resolve(catalogDir);
  const path = resolve(root, storageKey.slice(prefix.length));
  if (path === root || !path.startsWith(`${root}${sep}`)) {
    throw publisherError(
      "ARTIFACT_STORAGE_KEY_INVALID",
      "The artifact storage key escapes the catalog directory.",
    );
  }
  return path;
}

async function readCatalog(catalogDir, source) {
  const path = join(catalogDir, CATALOG_FILE);
  const { text } = await readBoundedText(
    path,
    MANIFEST_MAX_BYTES,
    "CATALOG_INVALID",
  );
  return {
    path,
    manifest: parseChannelPreanalysisManifest(text, source),
  };
}

function findCurrentVideo(manifest, selectedVideo) {
  if (!isRecord(selectedVideo) || typeof selectedVideo.videoId !== "string") {
    throw publisherError("VIDEO_INVALID", "A catalog video snapshot is required.");
  }
  const current = manifest.videos.find(
    ({ videoId }) => videoId === selectedVideo.videoId,
  );
  if (
    current === undefined ||
    current.channelId !== selectedVideo.channelId ||
    current.revision !== selectedVideo.revision ||
    current.state !== selectedVideo.state
  ) {
    throw publisherError(
      "CATALOG_SNAPSHOT_STALE",
      "The selected video no longer matches the persisted catalog snapshot.",
    );
  }
  return current;
}

function assertReviewEligible(video) {
  if (video.state === "context-ready") return;
  if (
    video.state === "retryable" &&
    video.retry?.stage === "review" &&
    video.retry.lastSuccessfulState === "context-ready"
  ) {
    return;
  }
  throw publisherError(
    "REVIEW_STAGE_INVALID",
    "Review preparation requires a durable context-ready checkpoint.",
  );
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function verifyContextCheckpoint(
  manifest,
  video,
  contextBundleInput,
  catalogDir,
  source,
) {
  const contextBundle = validateChannelPreanalysisBundle(contextBundleInput);
  await verifyChannelPreanalysisTranscriptDigest(contextBundle);
  if (
    contextBundle.state !== "context-ready" ||
    contextBundle.broadcastContext === null ||
    contextBundle.contextProvenance === null ||
    contextBundle.channelId !== source.channelId ||
    contextBundle.videoId !== video.videoId ||
    contextBundle.title !== video.title ||
    contextBundle.durationMs !== video.durationMs ||
    contextBundle.publishedAt !== video.publishedAt ||
    contextBundle.catalogRevision > manifest.revision
  ) {
    throw publisherError(
      "CONTEXT_CHECKPOINT_INVALID",
      "The supplied context bundle does not close over the selected catalog video.",
    );
  }

  const artifactById = new Map(
    manifest.artifacts.map((artifact) => [artifact.artifactId, artifact]),
  );
  const transcriptArtifacts = video.artifactIds
    .map((artifactId) => artifactById.get(artifactId))
    .filter((artifact) => artifact?.kind === "transcript");
  if (transcriptArtifacts.length !== 1) {
    throw publisherError(
      "CONTEXT_ARTIFACT_INVALID",
      "The selected video does not reference exactly one context transcript artifact.",
    );
  }
  const artifact = transcriptArtifacts[0];
  const persisted = await readBoundedText(
    artifactPath(catalogDir, source, artifact.storageKey),
    CHANNEL_PREANALYSIS_BUNDLE_MAX_BYTES,
    "CONTEXT_ARTIFACT_INVALID",
  );
  if (
    persisted.bytes.byteLength !== artifact.byteLength ||
    sha256(persisted.bytes) !== artifact.contentDigest
  ) {
    throw publisherError(
      "CONTEXT_ARTIFACT_DIGEST_MISMATCH",
      "The context transcript artifact differs from its catalog receipt.",
    );
  }
  const persistedBundle = parseChannelPreanalysisBundle(persisted.text);
  await verifyChannelPreanalysisTranscriptDigest(persistedBundle);
  if (!sameJson(persistedBundle, contextBundle)) {
    throw publisherError(
      "CONTEXT_ARTIFACT_MISMATCH",
      "The supplied context bundle is not the catalog's persisted checkpoint.",
    );
  }
  return contextBundle;
}

function reviewVisualFingerprintArtifact(manifest, video) {
  const artifactById = new Map(
    manifest.artifacts.map((artifact) => [artifact.artifactId, artifact]),
  );
  const artifacts = video.artifactIds
    .map((artifactId) => artifactById.get(artifactId))
    .filter((artifact) => artifact?.kind === "fingerprint");
  if (artifacts.length !== 1) {
    throw publisherError(
      "VISUAL_FINGERPRINT_INVALID",
      "Review publication requires one exact visual fingerprint artifact.",
    );
  }
  return artifacts[0];
}

async function verifyReviewClosure(
  reviewInput,
  contextBundle,
  source,
  revision,
  fingerprintArtifact,
) {
  const review = validateChannelPreanalysisReviewBundle(reviewInput);
  await verifyChannelPreanalysisReviewBundleIntegrity(review);
  if (
    review.artifactRevision !== revision ||
    review.artifactId !==
      channelPreanalysisReviewBundleArtifactId(contextBundle.videoId, revision) ||
    review.source.sourceId !== source.sourceId ||
    review.source.channelId !== source.channelId ||
    review.source.videoId !== contextBundle.videoId ||
    review.sourceDurationMs !== contextBundle.durationMs ||
    review.transcriptDigest !== contextBundle.transcriptDigest ||
    review.visualCoverage.sourceFingerprintArtifactId !==
      fingerprintArtifact.artifactId ||
    review.visualCoverage.sourceFingerprintDigest !==
      fingerprintArtifact.contentDigest ||
    !sameJson(review.broadcastContext, contextBundle.broadcastContext)
  ) {
    throw publisherError(
      "REVIEW_CLOSURE_INVALID",
      "The review bundle is not sealed to this source, transcript, and broadcast context.",
    );
  }
  return review;
}

function reviewArtifact(source, review, bytes) {
  return {
    artifactId: review.artifactId,
    videoId: review.source.videoId,
    kind: "review",
    revision: review.artifactRevision,
    storageKey: channelPreanalysisReviewBundleStorageKey(
      source.sourceId,
      review.source.videoId,
      review.artifactRevision,
    ),
    contentDigest: sha256(bytes),
    byteLength: bytes.byteLength,
    createdAt: review.createdAt,
  };
}

async function verifyReviewFile(
  path,
  contextBundle,
  source,
  revision,
  fingerprintArtifact,
) {
  const persisted = await readBoundedText(
    path,
    CHANNEL_PREANALYSIS_REVIEW_BUNDLE_MAX_BYTES,
    "REVIEW_ARTIFACT_INVALID",
  );
  const review = await verifyReviewClosure(
    parseChannelPreanalysisReviewBundle(persisted.text),
    contextBundle,
    source,
    revision,
    fingerprintArtifact,
  );
  return {
    review,
    artifact: reviewArtifact(source, review, persisted.bytes),
    text: persisted.text,
  };
}

async function orphanRevisions(catalogDir, videoId, minimumRevision) {
  const videosDir = join(catalogDir, "videos");
  let names;
  try {
    names = await readdir(videosDir);
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return [];
    throw error;
  }
  const escapedVideoId = videoId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(`^${escapedVideoId}\\.review\\.v([1-9]\\d*)\\.json$`, "u");
  return names
    .map((name) => ({ name, match: pattern.exec(name) }))
    .filter(({ match }) => match !== null)
    .map(({ match }) => Number(match[1]))
    .filter((revision) => Number.isSafeInteger(revision) && revision >= minimumRevision)
    .sort((left, right) => left - right);
}

async function findRecoverableOrphan(
  catalogDir,
  video,
  contextBundle,
  source,
  fingerprintArtifact,
) {
  const minimumRevision = video.state === "retryable"
    ? video.revision
    : video.revision + 1;
  const occupied = new Set(
    await orphanRevisions(catalogDir, video.videoId, minimumRevision),
  );
  for (const revision of [...occupied].sort((left, right) => left - right)) {
    const storageKey = channelPreanalysisReviewBundleStorageKey(
      source.sourceId,
      video.videoId,
      revision,
    );
    try {
      return {
        ...(await verifyReviewFile(
          artifactPath(catalogDir, source, storageKey),
          contextBundle,
          source,
          revision,
          fingerprintArtifact,
        )),
        recovered: true,
      };
    } catch (error) {
      if (
        error instanceof ChannelPreanalysisReviewBundleError ||
        error instanceof ChannelPreanalysisReviewPublisherError
      ) {
        continue;
      }
      throw error;
    }
  }
  // A failed preparation already moved a retryable video to the attempted
  // revision. Reuse that exact empty slot so its per-candidate checkpoint can
  // be resumed; advance only when an orphan file actually occupies it.
  let revision = video.state === "retryable"
    ? video.revision
    : video.revision + 1;
  while (occupied.has(revision)) revision += 1;
  return { revision, recovered: false };
}

async function prepareAndPersistReview(
  catalogDir,
  video,
  contextBundle,
  source,
  fingerprintArtifact,
  prepareReview,
) {
  const orphan = await findRecoverableOrphan(
    catalogDir,
    video,
    contextBundle,
    source,
    fingerprintArtifact,
  );
  if (orphan.recovered) return orphan;

  let prepared;
  try {
    prepared = await prepareReview({
      source,
      video,
      contextBundle,
      artifactRevision: orphan.revision,
    });
  } catch (cause) {
    throw publisherError(
      errorCodeOf(cause, "REVIEW_PREPARATION_FAILED"),
      "The scheduled review orchestrator did not return a complete review bundle.",
      cause,
    );
  }
  const review = await verifyReviewClosure(
    prepared,
    contextBundle,
    source,
    orphan.revision,
    fingerprintArtifact,
  );
  const text = serialize(review);
  const bytes = Buffer.from(text, "utf8");
  if (bytes.byteLength > CHANNEL_PREANALYSIS_REVIEW_BUNDLE_MAX_BYTES) {
    throw publisherError(
      "REVIEW_ARTIFACT_TOO_LARGE",
      "The review bundle exceeds its browser-readable byte limit.",
    );
  }
  const storageKey = channelPreanalysisReviewBundleStorageKey(
    source.sourceId,
    video.videoId,
    orphan.revision,
  );
  const path = artifactPath(catalogDir, source, storageKey);
  await writeImmutableAtomic(path, text);
  const readback = await verifyReviewFile(
    path,
    contextBundle,
    source,
    orphan.revision,
    fingerprintArtifact,
  );
  if (readback.text !== text) {
    throw publisherError(
      "REVIEW_ARTIFACT_READBACK_MISMATCH",
      "The immutable review readback differs from the committed bytes.",
    );
  }
  return { ...readback, recovered: false };
}

function manifestWithReview(manifest, video, artifact, nowIso, source) {
  const nextVideo = {
    ...video,
    state: "review-ready",
    revision: artifact.revision,
    artifactIds: [...video.artifactIds, artifact.artifactId],
    retry: null,
  };
  const nextManifest = {
    ...manifest,
    revision: manifest.revision + 1,
    generatedAt: nowIso,
    videos: manifest.videos.map((entry) =>
      entry.videoId === video.videoId ? nextVideo : entry
    ),
    artifacts: [...manifest.artifacts, artifact],
  };
  return {
    manifest: parseChannelPreanalysisManifest(serialize(nextManifest), source),
    video: nextVideo,
  };
}

function manifestWithReviewRetry(
  manifest,
  video,
  attemptedRevision,
  errorCode,
  nowIso,
  source,
) {
  const priorAttempt = video.state === "retryable" && video.retry?.stage === "review"
    ? video.retry.attemptCount
    : 0;
  const attemptCount = priorAttempt + 1;
  const delay = RETRY_DELAYS_MS[
    Math.min(attemptCount - 1, RETRY_DELAYS_MS.length - 1)
  ];
  const nextVideo = {
    ...video,
    state: "retryable",
    revision: Math.max(video.revision, attemptedRevision ?? video.revision + 1),
    retry: {
      stage: "review",
      lastSuccessfulState: "context-ready",
      attemptCount,
      nextAttemptAt: new Date(Date.parse(nowIso) + delay).toISOString(),
      errorCode,
    },
  };
  const nextManifest = {
    ...manifest,
    revision: manifest.revision + 1,
    generatedAt: nowIso,
    videos: manifest.videos.map((entry) =>
      entry.videoId === video.videoId ? nextVideo : entry
    ),
  };
  return {
    manifest: parseChannelPreanalysisManifest(serialize(nextManifest), source),
    video: nextVideo,
  };
}

async function verifyPublishedReview(
  manifest,
  video,
  contextBundle,
  catalogDir,
  source,
  fingerprintArtifact,
) {
  const artifactById = new Map(
    manifest.artifacts.map((artifact) => [artifact.artifactId, artifact]),
  );
  const artifacts = video.artifactIds
    .map((artifactId) => artifactById.get(artifactId))
    .filter((artifact) => artifact?.kind === "review");
  if (artifacts.length !== 1) {
    throw publisherError(
      "REVIEW_ARTIFACT_INVALID",
      "The review-ready video has no unique review artifact.",
    );
  }
  const artifact = artifacts[0];
  const persisted = await verifyReviewFile(
    artifactPath(catalogDir, source, artifact.storageKey),
    contextBundle,
    source,
    artifact.revision,
    fingerprintArtifact,
  );
  if (
    persisted.artifact.contentDigest !== artifact.contentDigest ||
    persisted.artifact.byteLength !== artifact.byteLength ||
    persisted.artifact.createdAt !== artifact.createdAt
  ) {
    throw publisherError(
      "REVIEW_ARTIFACT_DIGEST_MISMATCH",
      "The published review differs from its catalog receipt.",
    );
  }
  return { ...persisted, recovered: true };
}

/**
 * Commits exactly one fully verified review result after its immutable bytes
 * survive readback. Failures keep the context checkpoint and become retryable.
 */
export async function publishChannelPreanalysisReview(
  { catalogDir, source: sourceInput, video: selectedVideo, contextBundle: input },
  { prepareReview, nowIso = () => new Date().toISOString() } = {},
) {
  if (typeof catalogDir !== "string" || catalogDir.trim().length === 0) {
    throw publisherError("INVALID_INPUT", "catalogDir is required.");
  }
  if (typeof prepareReview !== "function") {
    throw publisherError("INVALID_INPUT", "prepareReview must be injected.");
  }
  const source = requireSource(sourceInput);
  const loaded = await readCatalog(catalogDir, source);
  const video = findCurrentVideo(loaded.manifest, selectedVideo);
  const contextBundle = await verifyContextCheckpoint(
    loaded.manifest,
    video,
    input,
    catalogDir,
    source,
  );
  const fingerprintArtifact = reviewVisualFingerprintArtifact(
    loaded.manifest,
    video,
  );

  if (video.state === "review-ready") {
    const persisted = await verifyPublishedReview(
      loaded.manifest,
      video,
      contextBundle,
      catalogDir,
      source,
      fingerprintArtifact,
    );
    return {
      state: "review-ready",
      manifest: loaded.manifest,
      video,
      artifact: persisted.artifact,
      reviewBundle: persisted.review,
      recovered: true,
    };
  }
  assertReviewEligible(video);

  let attemptedRevision = null;
  try {
    const prepared = await prepareAndPersistReview(
      catalogDir,
      video,
      contextBundle,
      source,
      fingerprintArtifact,
      async (request) => {
        attemptedRevision = request.artifactRevision;
        return prepareReview(request);
      },
    );
    attemptedRevision = prepared.artifact.revision;
    const committedAt = assertIsoDate(nowIso(), "review commit time");
    const next = manifestWithReview(
      loaded.manifest,
      video,
      prepared.artifact,
      committedAt,
      source,
    );
    await writeTextAtomic(loaded.path, serialize(next.manifest));
    const readback = await readCatalog(catalogDir, source);
    const readbackVideo = readback.manifest.videos.find(
      ({ videoId }) => videoId === video.videoId,
    );
    if (
      readbackVideo?.state !== "review-ready" ||
      readbackVideo.revision !== prepared.artifact.revision ||
      !readbackVideo.artifactIds.includes(prepared.artifact.artifactId)
    ) {
      throw publisherError(
        "CATALOG_READBACK_MISMATCH",
        "The catalog did not retain the verified review closure.",
      );
    }
    return {
      state: "review-ready",
      manifest: readback.manifest,
      video: readbackVideo,
      artifact: prepared.artifact,
      reviewBundle: prepared.review,
      recovered: prepared.recovered,
    };
  } catch (cause) {
    const checkpointAt = assertIsoDate(nowIso(), "review retry time");
    const errorCode = errorCodeOf(cause);
    const retry = manifestWithReviewRetry(
      loaded.manifest,
      video,
      attemptedRevision,
      errorCode,
      checkpointAt,
      source,
    );
    try {
      await writeTextAtomic(loaded.path, serialize(retry.manifest));
      const readback = await readCatalog(catalogDir, source);
      const readbackVideo = readback.manifest.videos.find(
        ({ videoId }) => videoId === video.videoId,
      );
      if (
        readbackVideo?.state !== "retryable" ||
        readbackVideo.retry?.stage !== "review" ||
        readbackVideo.retry.lastSuccessfulState !== "context-ready"
      ) {
        throw publisherError(
          "REVIEW_CHECKPOINT_READBACK_MISMATCH",
          "The review retry checkpoint was not retained.",
        );
      }
      return {
        state: "retryable",
        errorCode,
        manifest: readback.manifest,
        video: readbackVideo,
        artifact: null,
        reviewBundle: null,
        recovered: false,
      };
    } catch (checkpointCause) {
      throw publisherError(
        "REVIEW_CHECKPOINT_FAILED",
        "The review failed and its retry checkpoint could not be committed.",
        checkpointCause,
      );
    }
  }
}
