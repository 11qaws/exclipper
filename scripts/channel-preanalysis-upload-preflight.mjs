import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHANNEL_PREANALYSIS_SOURCES,
  channelPreanalysisSourceById,
} from "../src/analysis/channelPreanalysisSources.ts";
import {
  ALL_CHANNEL_PREANALYSIS_SOURCES,
  CHANNEL_PREANALYSIS_RUN_REPORT_FILE,
  DEFAULT_CATALOG_ROOT_DIRECTORY,
  DEFAULT_MAX_VIDEOS_PER_RUN,
  MAX_VIDEOS_PER_RUN,
  selectDueCatalogVideos,
  synchronizeChannelPreanalysisCatalog,
} from "./sync-amoretto-preanalysis.mjs";
import {
  CHANNEL_PREANALYSIS_REVIEW_PIPELINE_REVISION,
  selectChannelPreanalysisReviewQueue,
} from "./lib/channel-preanalysis-review-job.mjs";
import { CHANNEL_PREANALYSIS_REVIEW_RUN_REPORT_FILENAME } from "./sync-channel-preanalysis-reviews.mjs";

export const CHANNEL_PREANALYSIS_UPLOAD_PREFLIGHT_REPORT_FILENAME =
  "channel-preanalysis-upload-preflight-report.json";

function preflightError(message) {
  const error = new Error(message);
  error.name = "ChannelPreanalysisUploadPreflightError";
  return error;
}

function errorCodeOf(error) {
  return typeof error === "object" &&
    error !== null &&
    typeof error.code === "string" &&
    /^[A-Z][A-Z0-9_]{1,63}$/u.test(error.code)
    ? error.code
    : "PREFLIGHT_SOURCE_FAILED";
}

function parseMaximumVideos(value) {
  const parsed = Number(value ?? DEFAULT_MAX_VIDEOS_PER_RUN);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_VIDEOS_PER_RUN
  ) {
    throw preflightError(
      `--max-videos must be between 1 and ${String(MAX_VIDEOS_PER_RUN)}.`,
    );
  }
  return parsed;
}

export function parseChannelPreanalysisUploadPreflightArguments(
  argv,
  { cwd = process.cwd() } = {},
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
      throw preflightError(`Unexpected argument: ${argument}`);
    }
    const separator = argument.indexOf("=");
    const key = separator < 0 ? argument : argument.slice(0, separator);
    const inlineValue = separator < 0 ? null : argument.slice(separator + 1);
    if (!["--catalog-dir", "--source", "--max-videos"].includes(key)) {
      throw preflightError(`Unknown option: ${key}`);
    }
    if (values.has(key)) throw preflightError(`Duplicate option: ${key}`);
    const value = inlineValue ?? argv[++index];
    if (value === undefined || value.startsWith("--") || value.length === 0) {
      throw preflightError(`Missing value for ${key}`);
    }
    values.set(key, value);
  }
  if (help) return { help: true };

  const sourceValue = values.get("--source") ?? ALL_CHANNEL_PREANALYSIS_SOURCES;
  const source =
    sourceValue === ALL_CHANNEL_PREANALYSIS_SOURCES
      ? null
      : channelPreanalysisSourceById(sourceValue);
  if (sourceValue !== ALL_CHANNEL_PREANALYSIS_SOURCES && source === null) {
    throw preflightError("--source must be all or one configured source ID.");
  }
  return {
    help: false,
    catalogRoot: resolve(
      cwd,
      values.get("--catalog-dir") ?? DEFAULT_CATALOG_ROOT_DIRECTORY,
    ),
    source,
    maxVideos: parseMaximumVideos(values.get("--max-videos")),
  };
}

function dueReason(video, lane) {
  if (video.state === "retryable") {
    return `${video.retry?.stage ?? lane}-retry`;
  }
  if (lane === "review") return "review-missing";
  if (video.state === "transcript-ready") return "context-missing";
  if (["context-ready", "review-ready"].includes(video.state)) {
    return "fingerprint-missing";
  }
  return `${video.state}-pipeline`;
}

export function selectChannelPreanalysisUploadPreflightDueWork(
  manifest,
  { nowIso, maxVideos = DEFAULT_MAX_VIDEOS_PER_RUN },
) {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) {
    throw preflightError("Preflight time must be an ISO timestamp.");
  }
  const dueByVideoId = new Map();
  const append = (video, lane) => {
    const current = dueByVideoId.get(video.videoId) ?? {
      videoId: video.videoId,
      reasons: [],
    };
    const reason = dueReason(video, lane);
    if (!current.reasons.includes(reason)) current.reasons.push(reason);
    dueByVideoId.set(video.videoId, current);
  };
  for (const video of selectDueCatalogVideos(manifest, {
    nowIso,
    maxVideos,
    includeTranscriptReady: true,
    includePermanentCaptionRetries: true,
    recoverCaptionRetriesWithAsr: false,
  })) {
    append(video, "pipeline");
  }
  for (const video of selectChannelPreanalysisReviewQueue(manifest, {
    nowMs,
    maxVideos,
  })) {
    append(video, "review");
  }
  return [...dueByVideoId.values()];
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function noWorkRunReports({
  runStartedAt,
  completedAt,
  maxVideos,
  sourceReports,
  sourceErrors,
}) {
  const status = sourceErrors.length === 0 ? "complete" : "partial";
  return {
    catalog: {
      schemaVersion: 1,
      mode: "preflight",
      status,
      runStartedAt,
      completedAt,
      globalLimit: maxVideos,
      processedVideoCount: 0,
      sources: sourceReports.map(({ sourceId, catalogRevision }) => ({
        sourceId,
        catalogRevision,
        selectedVideoIds: [],
        outcomes: [],
      })),
      sourceErrors,
    },
    review: {
      schemaVersion: 1,
      status,
      pipelineRevision: CHANNEL_PREANALYSIS_REVIEW_PIPELINE_REVISION,
      completedAt,
      selectedVideoCount: 0,
      sourceErrors: sourceErrors.map(({ sourceId, errorCode }) => ({
        sourceId,
        errorCode,
      })),
      reviewErrors: [],
      outcomes: sourceReports.map(({ sourceId }) => ({
        sourceId,
        selectedVideoIds: [],
        outcomes: [],
      })),
    },
  };
}

export async function runChannelPreanalysisUploadPreflight(
  options,
  dependencies = {},
) {
  const now = dependencies.now ?? (() => new Date());
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const synchronizeSource =
    dependencies.synchronizeSource ?? synchronizeChannelPreanalysisCatalog;
  const log = dependencies.log ?? console;
  const runStartedAt = now().toISOString();
  const sources = options.source === null ? CHANNEL_PREANALYSIS_SOURCES : [options.source];
  const sourceReports = [];
  const sourceErrors = [];

  await mkdir(options.catalogRoot, { recursive: true });
  for (const source of sources) {
    try {
      const result = await synchronizeSource(
        {
          catalogDir: join(options.catalogRoot, source.sourceId),
          configuredSource: source,
          maxVideos: options.maxVideos,
          videoId: null,
          discoveryOnly: true,
          ytDlpPath: "unused-by-lightweight-preflight",
          contextProxyUrl: null,
          contextAuthorizationToken: null,
        },
        {
          now,
          fetch: fetchImpl,
          log,
          skipYtDlpVerification: true,
        },
      );
      sourceReports.push({
        sourceId: source.sourceId,
        catalogRevision: result.manifest.revision,
        due: selectChannelPreanalysisUploadPreflightDueWork(result.manifest, {
          nowIso: now().toISOString(),
          maxVideos: options.maxVideos,
        }),
      });
    } catch (error) {
      sourceErrors.push({
        sourceId: source.sourceId,
        errorCode: errorCodeOf(error),
        message: "Lightweight YouTube feed reconciliation failed.",
      });
    }
  }

  const completedAt = now().toISOString();
  const dueVideoCount = sourceReports.reduce(
    (sum, source) => sum + source.due.length,
    0,
  );
  const report = {
    schemaVersion: 1,
    status: sourceErrors.length === 0 ? "complete" : "partial",
    runStartedAt,
    completedAt,
    heavyRequired: dueVideoCount > 0,
    dueVideoCount,
    sources: sourceReports,
    sourceErrors,
  };
  await writeJson(
    join(options.catalogRoot, CHANNEL_PREANALYSIS_UPLOAD_PREFLIGHT_REPORT_FILENAME),
    report,
  );
  if (!report.heavyRequired) {
    const reports = noWorkRunReports({
      runStartedAt,
      completedAt,
      maxVideos: options.maxVideos,
      sourceReports,
      sourceErrors,
    });
    await writeJson(
      join(options.catalogRoot, CHANNEL_PREANALYSIS_RUN_REPORT_FILE),
      reports.catalog,
    );
    await writeJson(
      join(options.catalogRoot, CHANNEL_PREANALYSIS_REVIEW_RUN_REPORT_FILENAME),
      reports.review,
    );
  }
  return report;
}

function helpText() {
  return `Usage: tsx scripts/channel-preanalysis-upload-preflight.mjs [options]\n\n` +
    "  --catalog-dir PATH  Catalog branch root.\n" +
    "  --source ID|all     One configured source or all.\n" +
    "  --max-videos 1|2    Existing heavy-run processing budget.\n";
}

async function main() {
  const options = parseChannelPreanalysisUploadPreflightArguments(
    process.argv.slice(2),
  );
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }
  const report = await runChannelPreanalysisUploadPreflight(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Channel upload preflight failed: ${message}\n`);
    process.exitCode = 1;
  });
}
