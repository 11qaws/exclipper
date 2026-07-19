import type { UnifiedHighlightCandidate } from "../analysis/highlightFusion";
import { buildHighlightNarrative } from "../analysis/highlightNarrative";
import type {
  CandidateBoundaryProvenance,
  CandidateBoundaryRevision,
  CandidateTimeRange,
} from "../domain/candidateBoundaryRevision";
import type {
  DurableAnalysisInputDescriptor,
  DurableAnalysisSelectionSummary,
} from "../storage/durableAnalysisPayload";

export type HighlightExportFormat = "csv" | "markdown" | "json";

export interface ApprovedHighlightExportCandidate {
  readonly proposal: UnifiedHighlightCandidate;
  readonly boundaryRevision: CandidateBoundaryRevision | null;
}

export interface HighlightExportRequest {
  readonly appVersion: string;
  readonly engineVersion: string;
  readonly generatedAt: string;
  readonly input: DurableAnalysisInputDescriptor;
  readonly selection: DurableAnalysisSelectionSummary;
  readonly candidates: readonly ApprovedHighlightExportCandidate[];
}

export interface HighlightExportFile {
  readonly fileName: string;
  readonly mimeType: string;
  readonly content: string;
}

const EXPORT_SCHEMA_VERSION = "0.4.0";

function assertMilliseconds(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("A highlight timecode must be a finite non-negative number.");
  }
}

export function formatHighlightTimecode(milliseconds: number): string {
  assertMilliseconds(milliseconds);
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

interface ExportRangeProjection {
  readonly proposalRange: CandidateTimeRange;
  readonly effectiveRange: CandidateTimeRange;
  readonly provenance: CandidateBoundaryProvenance;
  readonly userRevision: number;
}

function exportRangeProjection(
  candidate: ApprovedHighlightExportCandidate,
): ExportRangeProjection {
  const proposalRange = {
    startMs: candidate.proposal.startMs,
    endMs: candidate.proposal.endMs,
  };
  const boundary = candidate.boundaryRevision;
  if (boundary === null) {
    return {
      proposalRange,
      effectiveRange: proposalRange,
      provenance: "aiProposal",
      userRevision: 0,
    };
  }
  if (
    boundary.candidateId !== candidate.proposal.id ||
    boundary.proposalRange.startMs !== proposalRange.startMs ||
    boundary.proposalRange.endMs !== proposalRange.endMs
  ) {
    throw new TypeError("Boundary revision does not belong to its AI proposal.");
  }
  return {
    proposalRange,
    effectiveRange: boundary.effectiveRange,
    provenance: boundary.provenance,
    userRevision: boundary.revision,
  };
}

function chronologicalCandidates(
  candidates: readonly ApprovedHighlightExportCandidate[],
): readonly ApprovedHighlightExportCandidate[] {
  return [...candidates].sort(
    (left, right) => {
      const leftRange = exportRangeProjection(left).effectiveRange;
      const rightRange = exportRangeProjection(right).effectiveRange;
      return (
        leftRange.startMs - rightRange.startMs ||
        leftRange.endMs - rightRange.endMs ||
        left.proposal.id.localeCompare(right.proposal.id)
      );
    },
  );
}

function normalizedText(value: string): string {
  return value.replace(/[\r\n]+/gu, " ").trim();
}

function signalLabel(candidate: UnifiedHighlightCandidate): string {
  const labels: string[] = [];
  if (candidate.signalKinds.includes("audio")) {
    labels.push("혼합 방송 오디오 신호");
  }
  if (candidate.signalKinds.includes("chat")) {
    labels.push("채팅 반응");
  }
  if (candidate.signalKinds.includes("visual")) {
    labels.push("화면 맥락");
  }
  return labels.join(" + ");
}

function evidenceLabel(candidate: UnifiedHighlightCandidate): string {
  const evidence: string[] = [];
  if (candidate.evidence.audio !== undefined) {
    const audio = candidate.evidence.audio;
    evidence.push(
      audio.eventKind === "sustained-vocal-reaction"
        ? "지속되는 음성형 반응"
        : "짧고 큰 오디오 반응",
      `오디오 반응 상위 ${topPercent(audio.rankPercentile)}%`,
    );
    if (audio.rmsLiftRatio !== undefined) {
      evidence.push(`평소 음량의 ${audio.rmsLiftRatio.toFixed(1)}배`);
    }
  }
  if (candidate.evidence.visual !== undefined) {
    evidence.push(`화면 변화 상위 ${topPercent(candidate.evidence.visual.rankPercentile)}%`);
  }
  if (candidate.evidence.chat !== undefined) {
    evidence.push(
      `채팅 ${candidate.evidence.chat.messageCount}개`,
      `서로 다른 작성자 표기 ${candidate.evidence.chat.uniqueAuthorCount}개`,
      `평소의 ${candidate.evidence.chat.burstRatio.toFixed(1)}배`,
    );
  }
  return evidence.join(" · ");
}

function topPercent(rankPercentile: number): number {
  return Math.max(1, Math.round((1 - rankPercentile) * 100));
}

function spreadsheetSafeText(value: string): string {
  const normalized = normalizedText(value);
  return /^[\t\r ]*[=+\-@]/u.test(normalized) ? `'${normalized}` : normalized;
}

function csvCell(value: string | number): string {
  const safeValue = spreadsheetSafeText(String(value));
  return `"${safeValue.replace(/"/gu, '""')}"`;
}

function createCsv(candidates: readonly ApprovedHighlightExportCandidate[]): string {
  const header = [
    "순서",
    "시작",
    "끝",
    "길이",
    "가장 강한 순간",
    "AI가 고른 이유",
    "신호",
    "근거 요약",
    "상대 점수",
    "사건 단서 (재생 확인 필요)",
    "혼합 방송 오디오 반응 단서",
    "채팅 반응 단서",
    "추천 이유",
    "해석 수준",
    "구간 기준",
    "AI 제안 시작",
    "AI 제안 끝",
  ];
  const rows = chronologicalCandidates(candidates).map((exportCandidate, index) => {
    const candidate = exportCandidate.proposal;
    const range = exportRangeProjection(exportCandidate);
    const narrative = buildHighlightNarrative(candidate);
    return [
      index + 1,
      formatHighlightTimecode(range.effectiveRange.startMs),
      formatHighlightTimecode(range.effectiveRange.endMs),
      formatHighlightTimecode(
        range.effectiveRange.endMs - range.effectiveRange.startMs,
      ),
      formatHighlightTimecode(candidate.peakMs),
      candidate.reason,
      signalLabel(candidate),
      evidenceLabel(candidate),
      Math.round(candidate.score * 100),
      narrative.event,
      narrative.streamerReaction,
      narrative.audienceReaction,
      narrative.whyRecommended,
      narrative.basisLabel,
      range.provenance === "aiProposal"
        ? "AI 제안"
        : range.provenance === "userResetToAi"
          ? "사용자가 AI 제안으로 되돌림"
          : "사용자 조정",
      formatHighlightTimecode(range.proposalRange.startMs),
      formatHighlightTimecode(range.proposalRange.endMs),
    ];
  });

  return `\uFEFF${[header, ...rows]
    .map((row) => row.map((value) => csvCell(value)).join(","))
    .join("\r\n")}\r\n`;
}

function markdownText(value: string): string {
  return normalizedText(value).replace(/\\/gu, "\\\\");
}

function createMarkdown(request: HighlightExportRequest): string {
  const candidates = chronologicalCandidates(request.candidates);
  const lines = [
    "# Retto Highlight 편집 시간표",
    "",
    `- 만든 시각: ${request.generatedAt}`,
    `- 원본 길이: ${formatHighlightTimecode(request.input.source.durationMs)}`,
    `- 승인한 장면: ${candidates.length}개`,
    "",
    "> 이 문서는 시작·끝 시간을 정리한 편집용 목록이며, 영상 클립 파일은 포함하지 않습니다.",
    "",
  ];

  for (const [index, exportCandidate] of candidates.entries()) {
    const candidate = exportCandidate.proposal;
    const range = exportRangeProjection(exportCandidate);
    const narrative = buildHighlightNarrative(candidate);
    lines.push(
      `## ${index + 1}. ${formatHighlightTimecode(range.effectiveRange.startMs)}–${formatHighlightTimecode(range.effectiveRange.endMs)}`,
      "",
      `- 길이: ${formatHighlightTimecode(range.effectiveRange.endMs - range.effectiveRange.startMs)}`,
      ...(range.provenance === "aiProposal"
        ? []
        : [
            `- AI 제안 구간: ${formatHighlightTimecode(range.proposalRange.startMs)}–${formatHighlightTimecode(range.proposalRange.endMs)}`,
            `- 구간 조정: ${range.provenance === "userResetToAi" ? "AI 제안으로 되돌림" : "사용자가 시작·끝을 다듬음"}`,
          ]),
      `- 가장 강한 순간: ${formatHighlightTimecode(candidate.peakMs)}`,
      `- 해석 수준: ${narrative.basisLabel}`,
      `- 사건 단서: ${markdownText(narrative.event)}`,
      `- 혼합 방송 오디오 반응 단서: ${markdownText(narrative.streamerReaction)}`,
      `- 채팅 반응 단서: ${markdownText(narrative.audienceReaction)}`,
      `- AI가 고른 이유: ${markdownText(narrative.whyRecommended)}`,
      `- 신호: ${signalLabel(candidate)}`,
      `- 근거: ${evidenceLabel(candidate) || "추가 근거 없음"}`,
      `- 확인할 점: ${markdownText(narrative.reviewHint)}`,
      "",
    );
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function exportedAudioSummary(selection: DurableAnalysisSelectionSummary):
  | {
      readonly plannedWindows: number;
      readonly analyzedWindows: number;
      readonly gapReasonCode: DurableAnalysisSelectionSummary["audioGapReasonCode"];
    }
  | {
      readonly analysisStatus: "not-recorded-in-source-result";
      readonly reason: "source-result-predates-audio-analysis";
      readonly message: "해당 결과 버전에는 오디오 분석 정보가 없습니다.";
    } {
  const plannedWindows = selection.plannedAudioWindowCount;
  const analyzedWindows = selection.analyzedAudioWindowCount;
  const gapReasonCode = selection.audioGapReasonCode;
  const hasPlanned = plannedWindows !== undefined;
  const hasAnalyzed = analyzedWindows !== undefined;
  const hasGapReason = gapReasonCode !== undefined;
  const presentCount = Number(hasPlanned) + Number(hasAnalyzed) + Number(hasGapReason);
  if (presentCount === 0) {
    return {
      analysisStatus: "not-recorded-in-source-result",
      reason: "source-result-predates-audio-analysis",
      message: "해당 결과 버전에는 오디오 분석 정보가 없습니다.",
    };
  }
  if (presentCount !== 3) {
    throw new TypeError("Audio selection fields must be all present or all absent.");
  }
  if (plannedWindows === undefined || analyzedWindows === undefined || gapReasonCode === undefined) {
    throw new TypeError("Audio selection fields must be all present or all absent.");
  }
  return {
    plannedWindows,
    analyzedWindows,
    gapReasonCode,
  };
}

function createJson(request: HighlightExportRequest): string {
  const payload = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    appVersion: request.appVersion,
    engine: request.engineVersion,
    generatedAt: request.generatedAt,
    source: {
      sizeBytes: request.input.source.sizeBytes,
      durationMs: request.input.source.durationMs,
      kind: request.input.source.kind,
      container: request.input.source.container,
      contentFingerprint: request.input.source.contentFingerprint,
    },
    chat: {
      timestampBasis: request.input.chat.timestampBasis,
      importedRows: request.input.chat.importedRowCount,
      analyzedRows: request.selection.analyzedChatMessageCount,
      skippedRows: request.selection.skippedChatMessageCount,
      gapReasonCode: request.selection.chatGapReasonCode,
      offsetMs: request.input.chat.offsetMs,
    },
    audio: exportedAudioSummary(request.selection),
    candidates: chronologicalCandidates(request.candidates).map(
      (exportCandidate) => {
        const candidate = exportCandidate.proposal;
        const { id, peakMs, score, signalKinds, evidence } = candidate;
        const range = exportRangeProjection(exportCandidate);
        return {
          id,
          proposalRange: range.proposalRange,
          effectiveRange: range.effectiveRange,
          rangeProvenance: range.provenance,
          userRevision: range.userRevision,
          peakMs,
          score,
          signalKinds,
          evidence,
          interpretation: buildHighlightNarrative(candidate),
          reviewState: "approved" as const,
        };
      },
    ),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function createHighlightExportFile(
  format: HighlightExportFormat,
  request: HighlightExportRequest,
): HighlightExportFile {
  if (format === "csv") {
    return {
      fileName: "retto-highlight-timeline.csv",
      mimeType: "text/csv;charset=utf-8",
      content: createCsv(request.candidates),
    };
  }
  if (format === "markdown") {
    return {
      fileName: "retto-highlight-timeline.md",
      mimeType: "text/markdown;charset=utf-8",
      content: createMarkdown(request),
    };
  }
  return {
    fileName: "retto-highlight-candidates.json",
    mimeType: "application/json;charset=utf-8",
    content: createJson(request),
  };
}

export function createHighlightClipboardText(
  candidates: readonly ApprovedHighlightExportCandidate[],
): string {
  const orderedCandidates = chronologicalCandidates(candidates);
  return [
    `Retto Highlight · 승인한 장면 ${orderedCandidates.length}개`,
    ...orderedCandidates.map(
      (exportCandidate, index) => {
        const candidate = exportCandidate.proposal;
        const range = exportRangeProjection(exportCandidate);
        const narrative = buildHighlightNarrative(candidate);
        const rangeNote =
          range.provenance === "aiProposal"
            ? ""
            : range.provenance === "userResetToAi"
              ? " (AI 제안으로 되돌림)"
              : ` (AI 제안 ${formatHighlightTimecode(range.proposalRange.startMs)}–${formatHighlightTimecode(range.proposalRange.endMs)}에서 조정)`;
        return `${index + 1}. ${formatHighlightTimecode(range.effectiveRange.startMs)}–${formatHighlightTimecode(range.effectiveRange.endMs)}${rangeNote} · ${normalizedText(narrative.whyRecommended)}`;
      },
    ),
  ].join("\n");
}
