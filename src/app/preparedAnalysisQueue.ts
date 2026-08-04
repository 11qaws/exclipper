import {
  isChannelPreanalysisReviewReadyVideo,
  type LoadedChannelPreanalysisManifest,
} from "../analysis/channelPreanalysisClient";
import {
  isWithinChannelPreanalysisAutomaticWindow,
  type ChannelPreanalysisCatalogVideo,
  type ChannelPreanalysisRetryStage,
} from "../analysis/channelPreanalysisCatalog";
import {
  channelPreanalysisSourceByChannelId,
  type ChannelPreanalysisSourceId,
} from "../analysis/channelPreanalysisSources";

export const PREPARED_ANALYSIS_QUEUE_POLL_INTERVAL_MS = 5 * 60_000;

const PREANALYSIS_WORKFLOW_RUNS_URL =
  "https://api.github.com/repos/11qaws/exclipper/actions/workflows/channel-preanalysis.yml/runs";
const PREANALYSIS_WORKFLOW_REQUEST_TIMEOUT_MS = 8_000;
const PREANALYSIS_RUN_TITLE_PREFIX = "Prepare channel queue · ";
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;

export type PreparedAnalysisQueuePhase = "caption" | "context" | "review";

export interface PreparedAnalysisQueueVideo {
  readonly videoId: string;
  readonly title: string;
  readonly watchUrl: string;
  readonly publishedAt: string;
  readonly sourceId: ChannelPreanalysisSourceId;
  readonly sourceNameKo: string;
  readonly channelHandle: string;
  readonly phase: PreparedAnalysisQueuePhase;
  readonly retryAt: string | null;
  readonly readyNow: boolean;
}

export interface PreparedAnalysisWorkerSnapshot {
  readonly activeRunCount: number;
  readonly queuedRunCount: number;
  readonly activeVideoIds: readonly string[];
  readonly queuedVideoIds: readonly string[];
  readonly checkedAt: string;
}

export interface PreparedAnalysisWorkerSnapshotOptions {
  readonly fetchImplementation?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
}

function phaseForRetryStage(
  stage: ChannelPreanalysisRetryStage,
): PreparedAnalysisQueuePhase {
  if (stage === "context") return "context";
  if (stage === "review" || stage === "fingerprint") return "review";
  return "caption";
}

function phaseForVideo(
  video: ChannelPreanalysisCatalogVideo,
): PreparedAnalysisQueuePhase {
  if (video.state === "retryable" && video.retry !== null) {
    return phaseForRetryStage(video.retry.stage);
  }
  if (video.state === "transcript-ready") return "context";
  if (video.state === "context-ready") return "review";
  return "caption";
}

export function buildPreparedAnalysisQueue(
  loadedManifests: readonly LoadedChannelPreanalysisManifest[],
  nowMs = Date.now(),
): readonly PreparedAnalysisQueueVideo[] {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new TypeError("Prepared analysis queue time is invalid.");
  }

  return loadedManifests
    .flatMap(({ manifest }) => {
      const source = channelPreanalysisSourceByChannelId(manifest.channelId);
      if (source === null) return [];
      return manifest.videos.flatMap((video) => {
        if (
          video.state === "published" ||
          isChannelPreanalysisReviewReadyVideo(video) ||
          !isWithinChannelPreanalysisAutomaticWindow(video.publishedAt, nowMs)
        ) {
          return [];
        }
        const retryAt = video.retry?.nextAttemptAt ?? null;
        const retryAtMs = retryAt === null ? null : Date.parse(retryAt);
        return [{
          videoId: video.videoId,
          title: video.title,
          watchUrl: video.watchUrl,
          publishedAt: video.publishedAt,
          sourceId: source.sourceId,
          sourceNameKo: source.displayNameKo,
          channelHandle: source.channelHandle,
          phase: phaseForVideo(video),
          retryAt,
          readyNow: retryAtMs === null || retryAtMs <= nowMs,
        }];
      });
    })
    .sort((left, right) =>
      Number(right.readyNow) - Number(left.readyNow) ||
      right.publishedAt.localeCompare(left.publishedAt) ||
      left.videoId.localeCompare(right.videoId),
    );
}

export function parseWorkflowRunCount(value: unknown): number {
  if (
    typeof value !== "object" ||
    value === null ||
    !("total_count" in value) ||
    typeof value.total_count !== "number" ||
    !Number.isSafeInteger(value.total_count) ||
    value.total_count < 0
  ) {
    throw new TypeError("Workflow run count response is invalid.");
  }
  return Number(value.total_count);
}

function parseWorkflowRunVideoIds(value: unknown): readonly string[] {
  if (
    typeof value !== "object" ||
    value === null ||
    !("workflow_runs" in value) ||
    !Array.isArray(value.workflow_runs)
  ) {
    throw new TypeError("Workflow runs response is invalid.");
  }
  return [...new Set(value.workflow_runs.flatMap((run: unknown) => {
    if (
      typeof run !== "object" ||
      run === null ||
      !("display_title" in run) ||
      typeof run.display_title !== "string" ||
      !run.display_title.startsWith(PREANALYSIS_RUN_TITLE_PREFIX)
    ) {
      return [];
    }
    const displayTitle: string = run.display_title;
    const suffix = displayTitle.slice(PREANALYSIS_RUN_TITLE_PREFIX.length);
    if (suffix === "manual") return [];
    const videoIds = suffix.split(",");
    return videoIds.length <= 8 && videoIds.every((id) => YOUTUBE_VIDEO_ID_PATTERN.test(id))
      ? videoIds
      : [];
  }))];
}

interface WorkflowRunState {
  readonly count: number;
  readonly videoIds: readonly string[];
}

async function fetchWorkflowRunState(
  status: "in_progress" | "queued",
  fetchImplementation: typeof fetch,
  signal: AbortSignal,
): Promise<WorkflowRunState> {
  const response = await fetchImplementation(
    `${PREANALYSIS_WORKFLOW_RUNS_URL}?status=${status}&per_page=1`,
    {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      headers: { Accept: "application/vnd.github+json" },
      signal,
    },
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Workflow status request failed with HTTP ${response.status}.`);
  }
  const body: unknown = await response.json();
  return {
    count: parseWorkflowRunCount(body),
    videoIds: parseWorkflowRunVideoIds(body),
  };
}

export async function fetchPreparedAnalysisWorkerSnapshot(
  options: PreparedAnalysisWorkerSnapshotOptions = {},
): Promise<PreparedAnalysisWorkerSnapshot> {
  const controller = new AbortController();
  const abortFromParent = (): void => controller.abort(options.signal?.reason);
  if (options.signal?.aborted === true) abortFromParent();
  options.signal?.addEventListener("abort", abortFromParent, { once: true });
  const timeout = globalThis.setTimeout(
    () => controller.abort(new DOMException("Workflow status request timed out.", "TimeoutError")),
    PREANALYSIS_WORKFLOW_REQUEST_TIMEOUT_MS,
  );
  try {
    const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
    const [active, queued] = await Promise.all([
      fetchWorkflowRunState("in_progress", fetchImplementation, controller.signal),
      fetchWorkflowRunState("queued", fetchImplementation, controller.signal),
    ]);
    return {
      activeRunCount: active.count,
      queuedRunCount: queued.count,
      activeVideoIds: active.videoIds,
      queuedVideoIds: queued.videoIds,
      checkedAt: new Date((options.now ?? Date.now)()).toISOString(),
    };
  } finally {
    globalThis.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromParent);
  }
}
