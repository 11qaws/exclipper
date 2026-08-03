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
    </section>
  );
}
