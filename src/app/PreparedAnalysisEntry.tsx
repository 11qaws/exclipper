import {
  useId,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";

import type { ChannelPreanalysisSourceId } from "../analysis/channelPreanalysisSources";
import { youtubeVideoIdFromUserInput } from "../analysis/youtubeCaptionTrack";
import type { FrontLanguage } from "./frontSurfaceModel";
import type { PreparedAnalysisLibraryGroup } from "./preparedAnalysisLibrary";
import type {
  PreparedAnalysisQueuePhase,
  PreparedAnalysisQueueVideo,
  PreparedAnalysisWorkerSnapshot,
} from "./preparedAnalysisQueue";
import { partitionPreparedAnalysisQueue } from "./preparedAnalysisQueue";

export interface PreparedAnalysisEntryProps {
  readonly language: FrontLanguage;
  readonly inputValue: string;
  readonly inputDisabled?: boolean;
  readonly lookupMessage: string;
  readonly lookupTone: "neutral" | "positive" | "warning" | "error";
  readonly lookupPending: boolean;
  readonly lookupRetryable: boolean;
  readonly activeVideoId: string | null;
  readonly catalogStatus: "loading" | "ready" | "failed";
  readonly catalogCoverage: "complete" | "partial";
  readonly groups: readonly PreparedAnalysisLibraryGroup[];
  readonly queue: readonly PreparedAnalysisQueueVideo[];
  readonly workerStatus: "loading" | "ready" | "unavailable";
  readonly workerSnapshot: PreparedAnalysisWorkerSnapshot | null;
  readonly onInputChange: (value: string) => void;
  readonly onSearch: () => void;
  readonly onSelectVideo: (watchUrl: string) => void;
  readonly onRefreshCatalogs: () => void;
}

const COPY = {
  ko: {
    eyebrow: "사전 분석",
    searchTitle: "다시보기 링크로 분석 찾기",
    searchDescription: "준비된 YouTube 다시보기라면 긴 분석을 기다리지 않고 바로 검토 화면을 엽니다.",
    inputLabel: "YouTube 다시보기 주소",
    placeholder: "https://www.youtube.com/watch?v=…",
    search: "분석 찾기",
    searching: "찾는 중…",
    retry: "다시 확인",
    libraryTitle: "준비된 분석",
    libraryDescription: "스트리머를 고른 뒤 검토할 방송을 선택하세요.",
    loading: "준비된 분석 목록을 불러오고 있어요.",
    failed: "준비된 분석 목록을 불러오지 못했어요.",
    partial: "일부 스트리머의 목록은 잠시 불러오지 못했어요.",
    refresh: "목록 다시 불러오기",
    empty: "아직 바로 열 수 있는 사전 분석이 없습니다.",
    count: (count: number) => `${count.toLocaleString("ko-KR")}개`,
    open: "검토 열기",
    queueEyebrow: "자동 준비",
    queueTitle: "분석 큐",
    queueDescription: "실제 실행기 상태와 영상의 재시도 시각을 구분해 보여 줍니다.",
    analyzing: "실행 중 작업",
    assigned: "실행 대기 작업",
    ready: "시작 대기 영상",
    deferred: "재시도 예약",
    loadingWorker: "확인 중",
    workerUnavailable: "상태 확인 지연",
    workerIdle: "현재 실행할 영상 없음",
    workerRunning: (count: number) =>
      count > 0 ? `작업 1개 실행 중 · 영상 ${count.toLocaleString("ko-KR")}개 배정` : "분석 작업 실행 중",
    workerQueued: (count: number) => `작업 ${count.toLocaleString("ko-KR")}개 실행기 대기`,
    workerReady: (count: number) => `영상 ${count.toLocaleString("ko-KR")}개 자동 시작 대기`,
    activeItem: "실행 중 작업에 배정",
    queuedItem: "실행기 배정 대기",
    readyItem: "재시도 시각 경과 · 다음 점검 대기",
    noWaiting: "현재 대기 중인 최근 영상이 없습니다.",
    moreWaiting: (count: number) => `외 ${count.toLocaleString("ko-KR")}개 대기 중`,
    retryAt: (value: string) => `${value} 재시도`,
    scheduleNote: "30분마다 작업을 배정합니다. 작업 하나가 영상을 최대 2개씩 순서대로 분석하며, 실패 지점은 보존한 뒤 예약 시각에 다시 시도합니다.",
    phase: {
      caption: "자막 확인",
      context: "전체 맥락",
      review: "화면·후보 검토",
    },
  },
  en: {
    eyebrow: "Pre-analysis",
    searchTitle: "Find analysis from a replay link",
    searchDescription: "A prepared YouTube replay opens directly in review without repeating the long analysis.",
    inputLabel: "YouTube replay URL",
    placeholder: "https://www.youtube.com/watch?v=…",
    search: "Find analysis",
    searching: "Searching…",
    retry: "Check again",
    libraryTitle: "Prepared analyses",
    libraryDescription: "Choose a streamer, then select a broadcast to review.",
    loading: "Loading prepared analyses.",
    failed: "Prepared analyses could not be loaded.",
    partial: "Some streamer catalogs are temporarily unavailable.",
    refresh: "Reload list",
    empty: "No prepared analysis is ready to open yet.",
    count: (count: number) => `${count.toLocaleString("en-US")} ready`,
    open: "Open review",
    queueEyebrow: "Automatic preparation",
    queueTitle: "Analysis queue",
    queueDescription: "Shows runner state separately from each video's scheduled retry time.",
    analyzing: "Jobs running",
    assigned: "Jobs queued",
    ready: "Videos awaiting start",
    deferred: "Retries scheduled",
    loadingWorker: "Checking",
    workerUnavailable: "Status delayed",
    workerIdle: "No video is ready to run",
    workerRunning: (count: number) =>
      count > 0 ? `1 job running · ${count.toLocaleString("en-US")} videos assigned` : "Analysis job running",
    workerQueued: (count: number) => `${count.toLocaleString("en-US")} jobs awaiting a runner`,
    workerReady: (count: number) => `${count.toLocaleString("en-US")} videos awaiting automatic start`,
    activeItem: "Assigned to the running job",
    queuedItem: "Waiting for a runner",
    readyItem: "Retry time reached · awaiting next check",
    noWaiting: "No recent video is waiting.",
    moreWaiting: (count: number) => `${count.toLocaleString("en-US")} more waiting`,
    retryAt: (value: string) => `Retry ${value}`,
    scheduleNote: "Work is assigned every 30 minutes. One job analyzes up to two videos in sequence and resumes failures from their saved retry point.",
    phase: {
      caption: "Captions",
      context: "Full context",
      review: "Visual review",
    },
  },
} as const;

function formatDuration(durationMs: number | null): string | null {
  if (durationMs === null) return null;
  const totalMinutes = Math.max(0, Math.round(durationMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours === 0 ? `${minutes}m` : `${hours}h ${minutes}m`;
}

function formatPublishedDate(value: string, language: FrontLanguage): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatRetryDate(value: string, language: FrontLanguage): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function PreparedAnalysisEntry({
  language,
  inputValue,
  inputDisabled = false,
  lookupMessage,
  lookupTone,
  lookupPending,
  lookupRetryable,
  activeVideoId,
  catalogStatus,
  catalogCoverage,
  groups,
  queue,
  workerStatus,
  workerSnapshot,
  onInputChange,
  onSearch,
  onSelectVideo,
  onRefreshCatalogs,
}: PreparedAnalysisEntryProps): ReactElement {
  const copy = COPY[language];
  const inputId = useId();
  const [selectedSourceId, setSelectedSourceId] =
    useState<ChannelPreanalysisSourceId | null>(null);
  const selectedGroup =
    groups.find(({ sourceId }) => sourceId === selectedSourceId) ??
    groups[0] ??
    null;
  const totalReady = groups.reduce(
    (count, group) => count + group.videos.length,
    0,
  );
  const inputIsValid = youtubeVideoIdFromUserInput(inputValue) !== null;
  const activeVideoIds = new Set(workerSnapshot?.activeVideoIds ?? []);
  const queuedVideoIds = new Set(workerSnapshot?.queuedVideoIds ?? []);
  const queueBuckets = partitionPreparedAnalysisQueue(queue, workerSnapshot);
  const activeVideoCount = queueBuckets.active.length;
  const readyVideoCount = queueBuckets.startPending.length;
  const deferredVideoCount = queueBuckets.retryScheduled.length;
  const orderedQueue = [
    ...queueBuckets.active,
    ...queueBuckets.assigned,
    ...queueBuckets.startPending,
    ...queueBuckets.retryScheduled,
  ];
  const visibleQueue = orderedQueue.slice(0, 3);
  const hiddenQueueCount = Math.max(0, orderedQueue.length - visibleQueue.length);
  const workerIndicator =
    workerStatus !== "ready"
      ? workerStatus
      : (workerSnapshot?.activeRunCount ?? 0) > 0
        ? "active"
        : (workerSnapshot?.queuedRunCount ?? 0) > 0
          ? "queued"
          : readyVideoCount > 0
            ? "ready"
          : "idle";
  const workerDetail =
    workerStatus === "loading"
      ? copy.loadingWorker
      : workerStatus === "unavailable" || workerSnapshot === null
        ? copy.workerUnavailable
        : workerSnapshot.activeRunCount > 0
          ? copy.workerRunning(activeVideoCount)
          : workerSnapshot.queuedRunCount > 0
            ? copy.workerQueued(workerSnapshot.queuedRunCount)
            : readyVideoCount > 0
              ? copy.workerReady(readyVideoCount)
            : copy.workerIdle;
  const phaseLabel = (phase: PreparedAnalysisQueuePhase): string =>
    copy.phase[phase];

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!inputDisabled && inputIsValid && !lookupPending) onSearch();
  };

  return (
    <section className="frt-prepared-entry" aria-labelledby="frt-prepared-search-title">
      <div className="frt-prepared-search">
        <header>
          <p>{copy.eyebrow}</p>
          <h2 id="frt-prepared-search-title">{copy.searchTitle}</h2>
          <span>{copy.searchDescription}</span>
        </header>
        <form onSubmit={submit}>
          <label htmlFor={inputId}>{copy.inputLabel}</label>
          <span>
            <input
              id={inputId}
              type="text"
              inputMode="url"
              autoComplete="url"
              placeholder={copy.placeholder}
              value={inputValue}
              disabled={inputDisabled}
              onChange={(event) => onInputChange(event.currentTarget.value)}
            />
            <button
              className="frt-primary-button"
              type="submit"
              disabled={inputDisabled || !inputIsValid || lookupPending}
            >
              {lookupPending
                ? copy.searching
                : lookupRetryable
                  ? copy.retry
                  : copy.search}
            </button>
          </span>
        </form>
        <p className="frt-prepared-lookup-status" data-tone={lookupTone} aria-live="polite">
          {lookupMessage}
        </p>
      </div>

      <div className="frt-prepared-library">
        <header>
          <div>
            <h2>{copy.libraryTitle}</h2>
            <p>{copy.libraryDescription}</p>
          </div>
          <strong>{copy.count(totalReady)}</strong>
        </header>

        {catalogStatus === "loading" ? (
          <p className="frt-prepared-catalog-status" role="status">{copy.loading}</p>
        ) : catalogStatus === "failed" ? (
          <div className="frt-prepared-catalog-status" role="alert">
            <p>{copy.failed}</p>
            <button type="button" onClick={onRefreshCatalogs}>{copy.refresh}</button>
          </div>
        ) : groups.length === 0 ? (
          <p className="frt-prepared-catalog-status">{copy.empty}</p>
        ) : (
          <>
            <div className="frt-prepared-streamers" aria-label={copy.libraryTitle}>
              {groups.map((group) => (
                <button
                  key={group.sourceId}
                  type="button"
                  aria-pressed={group.sourceId === selectedGroup?.sourceId}
                  onClick={() => setSelectedSourceId(group.sourceId)}
                >
                  <span>{group.displayName}</span>
                  <small>{group.videos.length}</small>
                </button>
              ))}
            </div>
            {catalogCoverage === "partial" && (
              <p className="frt-prepared-partial" role="status">{copy.partial}</p>
            )}
            {selectedGroup !== null && (
              <div className="frt-prepared-videos" aria-label={`${selectedGroup.displayName} · ${selectedGroup.channelHandle}`}>
                <p>
                  <strong>{selectedGroup.displayName}</strong>
                  <span>{selectedGroup.channelHandle}</span>
                </p>
                <ul>
                  {selectedGroup.videos.map((video) => {
                    const duration = formatDuration(video.durationMs);
                    return (
                      <li key={video.videoId}>
                        <button
                          type="button"
                          data-active={video.videoId === activeVideoId}
                          onClick={() => onSelectVideo(video.watchUrl)}
                          aria-label={`${video.title} · ${copy.open}`}
                        >
                          <span>
                            <strong>{video.title}</strong>
                            <small>
                              {[formatPublishedDate(video.publishedAt, language), duration]
                                .filter((value): value is string => value !== null)
                                .join(" · ")}
                            </small>
                          </span>
                          <em>{copy.open}</em>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      <aside className="frt-prepared-queue" aria-labelledby="frt-prepared-queue-title">
        <header>
          <div>
            <p>{copy.queueEyebrow}</p>
            <h2 id="frt-prepared-queue-title">{copy.queueTitle}</h2>
          </div>
          <span className="frt-queue-indicator" data-state={workerIndicator} aria-live="polite">
            <i aria-hidden="true" />
            {workerDetail}
          </span>
        </header>
        <p className="frt-prepared-queue-description">{copy.queueDescription}</p>

        <div className="frt-queue-metrics" aria-live="polite">
          <span>
            <small>{copy.analyzing}</small>
            <strong>
              {workerStatus === "ready" && workerSnapshot !== null
                ? activeVideoCount.toLocaleString(language === "ko" ? "ko-KR" : "en-US")
                : "—"}
            </strong>
          </span>
          <span>
            <small>{copy.assigned}</small>
            <strong>
              {workerStatus === "ready" && workerSnapshot !== null
                ? workerSnapshot.queuedRunCount.toLocaleString(language === "ko" ? "ko-KR" : "en-US")
                : "—"}
            </strong>
          </span>
          <span>
            <small>{copy.ready}</small>
            <strong>{readyVideoCount.toLocaleString(language === "ko" ? "ko-KR" : "en-US")}</strong>
          </span>
          <span>
            <small>{copy.deferred}</small>
            <strong>{deferredVideoCount.toLocaleString(language === "ko" ? "ko-KR" : "en-US")}</strong>
          </span>
        </div>

        {visibleQueue.length === 0 ? (
          <p className="frt-queue-empty">{copy.noWaiting}</p>
        ) : (
          <ul className="frt-queue-list">
            {visibleQueue.map((video) => (
              <li
                key={`${video.sourceId}:${video.videoId}`}
                data-state={
                  activeVideoIds.has(video.videoId)
                    ? "active"
                    : queuedVideoIds.has(video.videoId)
                      ? "queued"
                      : video.readyNow
                        ? "ready"
                        : "deferred"
                }
              >
                <span>
                  <strong>{video.title}</strong>
                  <small>
                    {language === "ko" ? video.sourceNameKo : video.channelHandle}
                    {" · "}
                    {activeVideoIds.has(video.videoId)
                      ? copy.activeItem
                      : queuedVideoIds.has(video.videoId)
                        ? copy.queuedItem
                        : video.readyNow
                          ? copy.readyItem
                        : video.retryAt !== null && !video.readyNow
                          ? copy.retryAt(formatRetryDate(video.retryAt, language))
                          : phaseLabel(video.phase)}
                  </small>
                </span>
                <time dateTime={video.publishedAt}>
                  {formatPublishedDate(video.publishedAt, language)}
                </time>
              </li>
            ))}
          </ul>
        )}
        {hiddenQueueCount > 0 && (
          <p className="frt-queue-more">{copy.moreWaiting(hiddenQueueCount)}</p>
        )}
        <footer>{copy.scheduleNote}</footer>
      </aside>
    </section>
  );
}
