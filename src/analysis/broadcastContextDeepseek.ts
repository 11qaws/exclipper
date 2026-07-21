import {
  BROADCAST_CONTEXT_SCHEMA_VERSION,
  type BroadcastContextCandidateCategory,
  type BroadcastContextRequest,
  type BroadcastContextResult,
  calculateCoverage,
  normalizeSemanticChapters,
  type BroadcastContextSemanticChapterReference,
  type BroadcastContextSemanticChapter,
  type BroadcastContextSemanticChapterKind,
  type BroadcastContextSemanticChapterSalience,
} from "./broadcastContextProtocol";

export const BROADCAST_CONTEXT_DEEPSEEK_ENDPOINT =
  "https://api.deepseek.com/chat/completions" as const;
export const MAX_BROADCAST_CONTEXT_DEEPSEEK_RESPONSE_BYTES = 256 * 1024;

export interface BroadcastContextDeepseekRequestBody {
  readonly model: string;
  readonly messages: readonly [
    { readonly role: "system"; readonly content: string },
    { readonly role: "user"; readonly content: string },
  ];
  readonly response_format: { readonly type: "json_object" };
  readonly temperature: number;
  readonly max_tokens: number;
}

export type BroadcastContextDeepseekParseOutcome =
  | { readonly ok: true; readonly result: BroadcastContextResult }
  | { readonly ok: false };

const SYSTEM_PROMPT = `당신은 긴 인터넷 방송(라이브 스트리밍)의 전체 흐름과 맥락을 파악하여, 특정 하이라이트 구간(후보)들이 전체 방송에서 어떤 역할을 하는지 분류하고 방송을 의미 단위로 묶는(Semantic Chapters) 전문 편집 어시스턴트입니다.

## 입력 데이터 형식
사용자는 방송을 시간순으로 요약한 여러 개의 '챕터(Chapters)' 정보와, 집중 분석 대상인 '후보(Candidates)' 정보들을 제공합니다. 

## 출력 데이터 형식
당신은 반드시 아래의 JSON 스키마를 따르는 응답만 생성해야 합니다.
{
  "broadcastSummaryKo": "방송 전체의 흐름을 300~500자로 요약",
  "recurringThemesKo": ["방송 전체를 관통하는 주요 밈이나 반복되는 이야기"],
  "semanticChapters": [
    {
      "startChapterId": "이 의미 단락이 시작되는 챕터 ID",
      "endChapterId": "이 의미 단락이 끝나는 챕터 ID",
      "titleKo": "의미 단락의 제목 (64자 이내)",
      "summaryKo": "의미 단락의 요약 (1200자 이내)",
      "kind": "main-event" | "story-progress" | "setup-and-payoff" | "running-gag" | "quiet-achievement" | "reaction" | "context-shift" | "other",
      "salience": "primary" | "secondary",
      "relatedCandidateIds": ["이 단락에 포함되거나 연관된 후보 ID들"],
      "uncertaintiesKo": ["이 단락에 대해 확신하기 어려운 부분 (없으면 빈 배열)"]
    }
  ],
  "annotations": [
    {
      "candidateId": "후보의 ID",
      "category": "reaction" | "quiet-achievement" | "setup-and-payoff" | "running-gag" | "context-dependent" | "uncertain",
      "contextSummaryKo": "이 클립이 전체 맥락에서 가지는 의미 (100자 내외)",
      "whyThisMomentKo": "이 클립을 하이라이트로 뽑자 만한 구체적 이유 (100자 내외)",
      "relatedCandidateIds": ["이 클립과 스토리가 이어지거나 연관된 다른 candidateId 배열"],
      "uncertaintiesKo": ["이 클립만으로 확신하기 어려운 점"]
    }
  ]
}

## 카테고리(category) 분류 기준
각 후보는 다음 중 하나의 카테고리를 가져야 합니다.
- reaction (반응): 앞뒤 맥락과 무관하게 스트리머의 단발성 리액션이나 텐션으로 재미있는 장면
- quiet-achievement (조용한 성취): 큰 소리나 리액션은 없지만 게임 내에서 어려운 목표를 달성하거나 엄청난 플레이를 한 장면
- setup-and-payoff (설정과 회수): 앞선 챕터에서 빌드업된 사건(설정)이 해당 구간에서 회수(터짐)된 장면
- running-gag (반복 개그): 방송 내내 여러 번 반복되는 밈(Meme)이나 개그 패턴의 일부인 장면
- context-dependent (맥락 의존): 단독으로 보면 재미없지만, 전체 챕터 맥락을 알아야만 웃긴 장면
- uncertain (불확실): 텍스트 정보만으로는 분류하기 애매한 장면`;

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export function buildBroadcastContextDeepseekRequestBody(
  request: BroadcastContextRequest,
  model: string = "deepseek-chat",
): BroadcastContextDeepseekRequestBody {
  let userContent = `총 방송 길이: ${formatDuration(request.sourceDurationMs)}\n\n`;
  userContent += `### 방송 챕터 요약 (시간순)\n`;
  for (const chapter of request.chapters) {
    userContent += `- [${formatDuration(chapter.startMs)} ~ ${formatDuration(chapter.endMs)}] (ID: ${chapter.chapterId}): ${chapter.summaryKo}\n`;
  }
  userContent += `\n### 분석 대상 후보 (Candidates)\n`;
  for (const candidate of request.candidates) {
    userContent += `\n==== 후보 ID: ${candidate.candidateId} ====\n`;
    userContent += `구간: ${formatDuration(candidate.startMs)} ~ ${formatDuration(candidate.endMs)}\n`;
    userContent += `대화 요약:\n${candidate.transcriptKo}\n`;
    userContent += `사건 요약: ${candidate.eventSummaryKo}\n`;
    userContent += `반응 요약: ${candidate.reactionSummaryKo}\n`;
    if (candidate.chatReactionSummaryKo) {
      userContent += `채팅 요약: ${candidate.chatReactionSummaryKo}\n`;
    }
  }

  return {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
    max_tokens: 8192,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isValidCategory(value: string): value is BroadcastContextCandidateCategory {
  return [
    "reaction",
    "quiet-achievement",
    "setup-and-payoff",
    "running-gag",
    "context-dependent",
    "uncertain",
  ].includes(value);
}

function isValidSemanticKind(value: string): boolean {
  return [
    "main-event",
    "story-progress",
    "setup-and-payoff",
    "running-gag",
    "quiet-achievement",
    "reaction",
    "context-shift",
    "other",
  ].includes(value);
}

function isValidSemanticSalience(value: string): boolean {
  return ["primary", "secondary"].includes(value);
}

export function extractBroadcastContextDeepseekResponse(
  payload: unknown,
  request: BroadcastContextRequest
): BroadcastContextDeepseekParseOutcome {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    return { ok: false };
  }

  const choice: unknown = payload.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message) || typeof choice.message.content !== "string") {
    return { ok: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(choice.message.content);
  } catch {
    return { ok: false };
  }

  if (
    !isRecord(parsed) ||
    typeof parsed.broadcastSummaryKo !== "string" ||
    !isStringArray(parsed.recurringThemesKo) ||
    !Array.isArray(parsed.annotations)
  ) {
    return { ok: false };
  }

  const annotations = [];
  for (const ann of parsed.annotations) {
    if (
      !isRecord(ann) ||
      typeof ann.candidateId !== "string" ||
      typeof ann.category !== "string" ||
      !isValidCategory(ann.category) ||
      typeof ann.contextSummaryKo !== "string" ||
      typeof ann.whyThisMomentKo !== "string" ||
      !isStringArray(ann.relatedCandidateIds) ||
      !isStringArray(ann.uncertaintiesKo)
    ) {
      return { ok: false };
    }
    annotations.push({
      candidateId: ann.candidateId,
      category: ann.category,
      contextSummaryKo: ann.contextSummaryKo,
      whyThisMomentKo: ann.whyThisMomentKo,
      relatedCandidateIds: ann.relatedCandidateIds,
      uncertaintiesKo: ann.uncertaintiesKo,
    });
  }

  const rawSemanticChapters: BroadcastContextSemanticChapterReference[] = [];
  if (Array.isArray(parsed.semanticChapters)) {
    for (const sc of parsed.semanticChapters) {
      if (
        !isRecord(sc) ||
        typeof sc.startChapterId !== "string" ||
        typeof sc.endChapterId !== "string" ||
        typeof sc.titleKo !== "string" ||
        typeof sc.summaryKo !== "string" ||
        typeof sc.kind !== "string" ||
        !isValidSemanticKind(sc.kind) ||
        typeof sc.salience !== "string" ||
        !isValidSemanticSalience(sc.salience) ||
        !isStringArray(sc.relatedCandidateIds) ||
        !isStringArray(sc.uncertaintiesKo)
      ) {
        continue;
      }
      rawSemanticChapters.push({
        startChapterId: sc.startChapterId,
        endChapterId: sc.endChapterId,
        titleKo: sc.titleKo,
        summaryKo: sc.summaryKo,
        kind: sc.kind as BroadcastContextSemanticChapterKind,
        salience: sc.salience as BroadcastContextSemanticChapterSalience,
        relatedCandidateIds: sc.relatedCandidateIds,
        uncertaintiesKo: sc.uncertaintiesKo,
      });
    }
  }

  const coverage = calculateCoverage(request.chapters, request.sourceDurationMs);
  let semanticChapters: readonly BroadcastContextSemanticChapter[] = [];
  try {
    semanticChapters = normalizeSemanticChapters(rawSemanticChapters, request.chapters, coverage.gaps);
  } catch {
    // If normalization fails, just return empty semantic chapters
  }

  return {
    ok: true,
    result: {
      schemaVersion: BROADCAST_CONTEXT_SCHEMA_VERSION,
      broadcastSummaryKo: parsed.broadcastSummaryKo,
      recurringThemesKo: parsed.recurringThemesKo,
      annotations,
      semanticChaptersSupported: true,
      semanticChapters,
      coverage,
    },
  };
}
