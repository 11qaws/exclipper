import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  channelPreanalysisSourceById,
} from "../src/analysis/channelPreanalysisSources.ts";
import { PREANALYSIS_CANDIDATE_ENDPOINT_PATH } from "../src/cloudflare/preanalysisContextProxy.worker.ts";
import {
  createYtDlpChildEnvironment,
  rotateConfiguredSourcesForFairness,
  verifyPersistedChannelCatalogSnapshot,
} from "./sync-amoretto-preanalysis.mjs";
import { createChannelPreanalysisReviewCandidateAnalyzer } from "./lib/channel-preanalysis-review-candidate-client.mjs";
import {
  CHANNEL_PREANALYSIS_REVIEW_JOB_MAX_VIDEOS,
  CHANNEL_PREANALYSIS_REVIEW_PIPELINE_REVISION,
  runChannelPreanalysisReviewQueue,
} from "./lib/channel-preanalysis-review-job.mjs";
import { sanitizeChannelPreanalysisMediaDiagnostic } from "./lib/channel-preanalysis-media.mjs";

export const DEFAULT_CHANNEL_PREANALYSIS_REVIEW_CATALOG_ROOT =
  "preanalysis-catalog";
export const CHANNEL_PREANALYSIS_REVIEW_RUN_REPORT_FILENAME =
  "channel-preanalysis-review-run-report.json";

const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{24,512}$/u;

function cliError(message) {
  const error = new Error(message);
  error.name = "ChannelPreanalysisReviewCliError";
  return error;
}

function errorCodeOf(error) {
  return typeof error === "object" && error !== null &&
      typeof error.code === "string" &&
      /^[A-Z][A-Z0-9_]{1,63}$/u.test(error.code)
    ? error.code
    : "REVIEW_SOURCE_FAILED";
}

function reportedDiagnostic(value) {
  if (typeof value !== "string") return {};
  const diagnostic = sanitizeChannelPreanalysisMediaDiagnostic(value);
  return diagnostic === "" ? {} : { diagnostic };
}

export function deriveChannelPreanalysisCandidateEndpoint(contextEndpoint) {
  let url;
  try {
    url = new URL(contextEndpoint);
  } catch {
    throw cliError("The preanalysis context endpoint is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw cliError("The preanalysis endpoint must be a credential-free HTTPS URL.");
  }
  url.pathname = PREANALYSIS_CANDIDATE_ENDPOINT_PATH;
  return url.toString();
}

export function parseChannelPreanalysisReviewArguments(
  argv,
  {
    cwd = process.cwd(),
    environment = process.env,
  } = {},
) {
  const values = new Map();
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    if (!argument.startsWith("--")) {
      throw cliError(`Unexpected argument: ${argument}`);
    }
    const separator = argument.indexOf("=");
    const key = separator < 0 ? argument : argument.slice(0, separator);
    const inlineValue = separator < 0 ? null : argument.slice(separator + 1);
    if (
      ![
        "--catalog-dir",
        "--source",
        "--video-id",
        "--max-videos",
        "--yt-dlp",
        "--ffmpeg",
        "--ffprobe",
        "--candidate-proxy",
        "--work-dir",
      ].includes(key)
    ) {
      throw cliError(`Unknown option: ${key}`);
    }
    if (values.has(key)) throw cliError(`Duplicate option: ${key}`);
    const value = inlineValue ?? argv[++index];
    if (value === undefined || value.startsWith("--") || value.length === 0) {
      throw cliError(`Missing value for ${key}`);
    }
    values.set(key, value);
  }

  if (help) return { help: true };

  const sourceValue = values.get("--source") ?? "all";
  const source = sourceValue === "all" ? null : channelPreanalysisSourceById(sourceValue);
  if (sourceValue !== "all" && source === null) {
    throw cliError("--source must be all or one configured source ID.");
  }
  const videoId = values.get("--video-id") ?? null;
  if (videoId !== null && !/^[A-Za-z0-9_-]{11}$/u.test(videoId)) {
    throw cliError("--video-id must be one exact eleven-character YouTube ID.");
  }
  if (videoId !== null && source === null) {
    throw cliError("--video-id requires one explicit --source.");
  }
  const maxVideos = Number(
    values.get("--max-videos") ?? String(CHANNEL_PREANALYSIS_REVIEW_JOB_MAX_VIDEOS),
  );
  if (
    !Number.isSafeInteger(maxVideos) ||
    maxVideos < 1 ||
    maxVideos > CHANNEL_PREANALYSIS_REVIEW_JOB_MAX_VIDEOS
  ) {
    throw cliError(
      `--max-videos must be between 1 and ${String(CHANNEL_PREANALYSIS_REVIEW_JOB_MAX_VIDEOS)}.`,
    );
  }
  const contextEndpoint = environment.CHANNEL_PREANALYSIS_CONTEXT_PROXY_URL;
  const candidateEndpoint = values.get("--candidate-proxy") ??
    environment.CHANNEL_PREANALYSIS_CANDIDATE_PROXY_URL ??
    (contextEndpoint === undefined
      ? null
      : deriveChannelPreanalysisCandidateEndpoint(contextEndpoint));
  const authorizationToken = environment.CHANNEL_PREANALYSIS_CONTEXT_TOKEN ?? null;
  if (candidateEndpoint === null || !TOKEN_PATTERN.test(authorizationToken ?? "")) {
    throw cliError(
      "Scheduled review requires the dedicated candidate endpoint and bearer token.",
    );
  }
  return {
    help,
    source,
    videoId,
    maxVideos,
    catalogRoot: resolve(
      cwd,
      values.get("--catalog-dir") ?? DEFAULT_CHANNEL_PREANALYSIS_REVIEW_CATALOG_ROOT,
    ),
    workRoot: resolve(
      cwd,
      values.get("--work-dir") ??
        environment.RUNNER_TEMP ??
        join(tmpdir(), "exclipper-channel-reviews"),
    ),
    ytDlpPath: values.get("--yt-dlp") ?? environment.YT_DLP_PATH ?? "yt-dlp",
    ffmpegPath: values.get("--ffmpeg") ?? environment.FFMPEG_PATH ?? "ffmpeg",
    ffprobePath: values.get("--ffprobe") ?? environment.FFPROBE_PATH ?? "ffprobe",
    candidateEndpoint,
    authorizationToken,
  };
}

function rotatedSources(nowMs) {
  return rotateConfiguredSourcesForFairness(new Date(nowMs).toISOString());
}

function manifestHasClosedReview(manifest, videoId) {
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !Array.isArray(manifest.videos) ||
    !Array.isArray(manifest.artifacts)
  ) {
    return false;
  }
  const video = manifest.videos.find(
    (value) => value?.videoId === videoId && value?.state === "review-ready",
  );
  if (video === undefined || !Array.isArray(video.artifactIds)) return false;
  const referenced = video.artifactIds.map((artifactId) =>
    manifest.artifacts.find((artifact) => artifact?.artifactId === artifactId)
  );
  return referenced.filter((artifact) => artifact?.kind === "review").length === 1;
}

export async function runScheduledChannelPreanalysisReviews(
  options,
  dependencies = {},
) {
  const nowMs = dependencies.nowMs ?? Date.now();
  const runQueue = dependencies.runQueue ?? runChannelPreanalysisReviewQueue;
  const createAnalyzer =
    dependencies.createAnalyzer ?? createChannelPreanalysisReviewCandidateAnalyzer;
  const verifySnapshot =
    dependencies.verifySnapshot ?? verifyPersistedChannelCatalogSnapshot;
  const sources = options.source === null ? rotatedSources(nowMs) : [options.source];
  const outcomes = [];
  const sourceErrors = [];
  const verifiedManifests = new Map();
  let remaining = options.maxVideos;
  for (const source of sources) {
    if (remaining <= 0) break;
    const perSourceLimit = options.source === null ? 1 : remaining;
    try {
      const result = await runQueue({
        catalogDir: join(options.catalogRoot, source.sourceId),
        source,
        maxVideos: perSourceLimit,
        videoId: options.videoId,
        nowMs,
        ytDlpPath: options.ytDlpPath,
        ytDlpEnvironment: createYtDlpChildEnvironment(
          dependencies.environment ?? process.env,
        ),
        workRoot: join(options.workRoot, source.sourceId),
        ffmpegPath: options.ffmpegPath,
        ffprobePath: options.ffprobePath,
        pipelineRevision: CHANNEL_PREANALYSIS_REVIEW_PIPELINE_REVISION,
        candidateConcurrency: 2,
        createCandidateAnalyzer: ({
          artifactRevision,
          contextBundle,
          participantGrounding,
        }) => createAnalyzer({
          endpointUrl: options.candidateEndpoint,
          authorizationToken: options.authorizationToken,
          sourceId: source.sourceId,
          channelId: source.channelId,
          videoId: contextBundle.videoId,
          sourceDurationMs: contextBundle.durationMs,
          artifactRevision,
          pipelineRevision: CHANNEL_PREANALYSIS_REVIEW_PIPELINE_REVISION,
          castRosterId: participantGrounding.castRosterId,
        }),
      });
      outcomes.push({ sourceId: source.sourceId, ...result });
      remaining -= result.selectedVideoIds.length;
    } catch (error) {
      sourceErrors.push({ sourceId: source.sourceId, errorCode: errorCodeOf(error) });
      outcomes.push({ sourceId: source.sourceId, selectedVideoIds: [], outcomes: [] });
    }
    // A source-level operation may fail after writing a valid retry checkpoint.
    // Preserve it only after the same full artifact-closure verifier succeeds.
    const verifiedManifest = await verifySnapshot(
      join(options.catalogRoot, source.sourceId),
      source,
    );
    verifiedManifests.set(source.sourceId, verifiedManifest);
  }
  const outcomeErrors = outcomes.flatMap(({ sourceId, outcomes: sourceOutcomes }) =>
    sourceOutcomes
      .filter(({ state }) => state !== "review-ready")
      .map((outcome) => ({
        sourceId,
        videoId: outcome.video?.videoId ?? null,
        state: outcome.state,
        errorCode: outcome.errorCode ?? "REVIEW_NOT_READY",
        ...reportedDiagnostic(outcome.diagnostic),
      })),
  );
  const requestedVideoSelected = options.videoId === null || outcomes.some(
    ({ sourceId, selectedVideoIds }) =>
      sourceId === options.source?.sourceId &&
      selectedVideoIds.includes(options.videoId),
  );
  const requestedVideoCurrentOutcome = options.videoId === null || outcomes.some(
    ({ sourceId, outcomes: sourceOutcomes }) =>
      sourceId === options.source?.sourceId &&
      sourceOutcomes.some((outcome) =>
        outcome.video?.videoId === options.videoId &&
        outcome.state === "review-ready" &&
        outcome.reviewBundle?.certificate?.pipelineRevision ===
          CHANNEL_PREANALYSIS_REVIEW_PIPELINE_REVISION
      ),
  );
  const requestedVideoReady =
    options.videoId === null || (
      requestedVideoSelected &&
      requestedVideoCurrentOutcome &&
      options.source !== null &&
      manifestHasClosedReview(
        verifiedManifests.get(options.source.sourceId),
        options.videoId,
      )
    );
  const requestedVideoAlreadyReported =
    options.videoId !== null && outcomeErrors.some(
      ({ videoId }) => videoId === options.videoId,
    );
  const requestedVideoErrors = requestedVideoReady || requestedVideoAlreadyReported
    ? []
    : [{
        sourceId: options.source?.sourceId ?? "unknown",
        videoId: options.videoId,
        state: "retryable",
        errorCode: "REQUESTED_VIDEO_NOT_REVIEW_READY",
      }];
  const reviewErrors = [...outcomeErrors, ...requestedVideoErrors];
  const sourceReports = outcomes.map(
    ({ sourceId, selectedVideoIds, outcomes: sourceOutcomes }) => ({
      sourceId,
      selectedVideoIds,
      outcomes: sourceOutcomes.map((outcome) => ({
        videoId: outcome.video?.videoId ?? null,
        state: outcome.state,
        ...(outcome.errorCode === undefined
          ? {}
          : { errorCode: outcome.errorCode }),
        ...reportedDiagnostic(outcome.diagnostic),
        recovered: outcome.recovered === true,
      })),
    }),
  );
  return {
    schemaVersion: 1,
    status:
      reviewErrors.length === 0 && sourceErrors.length === 0
        ? "complete"
        : "partial",
    pipelineRevision: CHANNEL_PREANALYSIS_REVIEW_PIPELINE_REVISION,
    completedAt: new Date(nowMs).toISOString(),
    selectedVideoCount: options.maxVideos - remaining,
    sourceErrors,
    reviewErrors,
    outcomes: sourceReports,
  };
}

function helpText() {
  return `Usage: tsx scripts/sync-channel-preanalysis-reviews.mjs [options]\n\n` +
    `  --catalog-dir PATH     Catalog branch root.\n` +
    `  --source ID|all        One configured source or all.\n` +
    `  --video-id ID          Exact manual retry; requires one source.\n` +
    `  --max-videos 1|2       Global media-analysis budget.\n` +
    `  --yt-dlp PATH          Verified pinned yt-dlp executable.\n` +
    `  --ffmpeg PATH          ffmpeg executable.\n` +
    `  --ffprobe PATH         ffprobe executable.\n` +
    `  --candidate-proxy URL  Dedicated /v1/candidate-insights endpoint.\n` +
    `  --work-dir PATH        Ephemeral media directory.\n`;
}

async function main() {
  const options = parseChannelPreanalysisReviewArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }
  const report = await runScheduledChannelPreanalysisReviews(options);
  await writeFile(
    join(options.catalogRoot, CHANNEL_PREANALYSIS_REVIEW_RUN_REPORT_FILENAME),
    `${JSON.stringify(report, null, 2)}\n`,
    { encoding: "utf8", flag: "w" },
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Channel review preparation failed: ${message}\n`);
    process.exitCode = 1;
  });
}
