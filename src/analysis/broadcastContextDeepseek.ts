import {
  BROADCAST_CONTEXT_SCHEMA_VERSION,
  type BroadcastContextCandidateAnnotation,
  type BroadcastContextCandidateCategory,
  type BroadcastContextClipDecision,
  type BroadcastContextRejectionReason,
  type BroadcastContextRequest,
  type BroadcastContextResult,
  type BroadcastContextHostStreamerProfile,
  calculateCoverage,
  normalizeDiscoveredLeads,
  normalizeSemanticChapters,
  type BroadcastContextDiscoveredLead,
  type BroadcastContextDiscoveredLeadCategory,
  type BroadcastContextDiscoveredLeadReference,
  type BroadcastContextSemanticChapterReference,
  type BroadcastContextSemanticChapter,
  type BroadcastContextSemanticChapterKind,
  type BroadcastContextSemanticChapterSalience,
} from "./broadcastContextProtocol";
import {
  candidatePassBKnownCastReferences,
  candidatePassBKnownCastReferenceForName,
} from "./participantRoster";

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
  readonly thinking: { readonly type: "enabled" };
  readonly reasoning_effort: "high";
}

export interface BroadcastContextQwenRequestBody {
  readonly model: string;
  readonly messages: BroadcastContextDeepseekRequestBody["messages"];
  readonly response_format: { readonly type: "json_object" };
  readonly temperature: number;
  readonly enable_thinking: boolean;
  readonly thinking_budget?: number;
}

export type BroadcastContextQwenMode =
  | "overview"
  | "discovery"
  | "refinement"
  | "refinement-fast"
  | "selection";

export type BroadcastContextDeepseekParseOutcome =
  | { readonly ok: true; readonly result: BroadcastContextResult }
  | { readonly ok: false; readonly reason?: string };

const UNEXPECTED_HAN_REPLACEMENT_KO = "한글 표기 미확인";
const UNEXPECTED_HAN_REPLACEMENT_EN = "wording not verified";

function replaceUnexpectedHan(
  value: unknown,
  outputLanguage: BroadcastContextRequest["outputLanguage"],
): unknown {
  const replacement =
    outputLanguage === "en"
      ? UNEXPECTED_HAN_REPLACEMENT_EN
      : UNEXPECTED_HAN_REPLACEMENT_KO;
  if (typeof value === "string") {
    return value.replace(/\p{Script=Han}+/gu, replacement);
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceUnexpectedHan(item, outputLanguage));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        replaceUnexpectedHan(item, outputLanguage),
      ]),
    );
  }
  return value;
}

const SYSTEM_PROMPT = `당신은 긴 인터넷 방송(라이브 스트리밍)의 전체 흐름과 맥락을 파악하여, 특정 하이라이트 구간(후보)들이 전체 방송에서 어떤 역할을 하는지 분류하고 방송을 의미 단위로 묶는(Semantic Chapters) 전문 편집 어시스턴트입니다.

## 입력 데이터 형식
사용자는 방송을 시간순으로 요약한 여러 개의 '챕터(Chapters)' 정보와, 집중 분석 대상인 '후보(Candidates)' 정보들을 제공합니다. 

## 출력 데이터 형식
당신은 반드시 아래의 JSON 스키마를 따르는 응답만 생성해야 합니다.
{
  "broadcastSummaryKo": "방송 전체의 시간 순서·주제 변화·반복 소재·주요 사건을 600~1000자로 충분히 서술",
  "hostStreamerProfile": {
    "displayNameKo": "화면 이름표·시각 참조 일치·발화자의 자기소개·음성 참조 일치 중 하나로 관찰 확인된 주 진행 스트리머 이름, 확인되지 않으면 null",
    "profileSummaryKo": "방송에서 관찰된 진행 역할·말투와 상호작용·반복 관심사·반응 방식·채팅 또는 게스트와의 관계를 300~500자로 서술",
    "evidenceKo": ["프로필 추정에 사용한 방송 속 구체적 단서 2~5개"],
    "uncertaintiesKo": ["방송 근거만으로 확정할 수 없는 점"]
  },
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
  "discoveredLeads": [
    {
      "leadId": "새로 발견한 의미 후보의 고유 ID",
      "startChapterId": "근거가 시작되는 실제 chapter ID",
      "endChapterId": "근거가 끝나는 실제 chapter ID",
      "category": "reaction" | "quiet-achievement" | "setup-and-payoff" | "running-gag" | "context-dependent" | "apology-accountability",
      "confidence": 0.0부터 1.0 사이 숫자,
      "eventSummaryKo": "실제로 어떤 사건이 있었는지",
      "whyThisMomentKo": "왜 짧은 클립 후보로 다시 확인할 가치가 있는지",
      "evidenceCueKo": "제공된 대사 요약에서 확인되는 짧은 근거",
      "uncertaintiesKo": ["화면·정확한 초 단위 위치 등 아직 확인할 점"]
    }
  ],
  "annotations": [
    {
      "candidateId": "후보의 ID",
      "category": "reaction" | "quiet-achievement" | "setup-and-payoff" | "running-gag" | "context-dependent" | "apology-accountability" | "music-or-intermission" | "not-clip-worthy" | "uncertain",
      "clipDecision": "select" | "review" | "reject",
      "confidence": 0.0부터 1.0 사이 숫자,
      "rejectionReasons": ["music-or-song" | "opening-ending-or-break" | "no-distinct-event" | "reaction-without-context" | "insufficient-context" | "duplicate-episode" | "uncertain-evidence"],
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
- apology-accountability (사과·해명): 실수나 논란의 정확한 인정·사과·해명 장면
- music-or-intermission (음악·대기): 노래, MV, 오프닝, 엔딩, 중간 휴식처럼 반복 가능한 구간. 녹음된 스트리머 목소리나 노랫소리가 들려도 화면이 독립 뮤직비디오이고 현재 방송의 실시간 대화·채팅 상호작용·고유 사건이 없으면 반드시 이 범주로 reject하세요.
- not-clip-worthy (클립 가치 없음): 사건이나 반응의 완결성이 없는 평범하고 단편적인 진행
- uncertain (불확실): 텍스트 정보만으로는 분류하기 애매한 장면

## 최종 선택 원칙
- 전체 서술을 몇 줄로 과도하게 줄이지 마세요. 입력에서 확인되는 방송의 시작·중간 변화·마무리, 반복 주제와 사건의 인과관계를 600~1000자로 보존하세요.
- 주 진행 스트리머 프로필은 이 방송 안에서 직접 관찰할 수 있는 편집 관련 특성만 합리적으로 추정하세요. 닫힌 출연진 명단은 이름 표기 교정용일 뿐 실제 등장 증거가 아닙니다. 정확한 이름은 화면 이름표·시각 참조 일치·발화자의 자기소개·음성 참조 일치 중 하나가 근거 지도에 있을 때만 쓰고, 그렇지 않으면 null로 두세요. 나이·성별·국적·건강·사생활 같은 민감하거나 근거 없는 신상은 추정하지 마세요.
- 후보 수를 채우지 마세요. 의미 있는 후보가 없으면 모든 후보를 reject로 판정하는 것이 정답입니다.
- 큰 소리나 화면 전환만으로 select하지 마세요. 구체적인 사건과 스트리머의 반응 또는 의미 있는 행동이 있어야 합니다.
- 노래·MV·음악만 있는 구간, 고정 오프닝·엔딩·대기·휴식은 그 안에 고유한 발화 사건이 없다면 반드시 reject입니다.
- 전체 맥락 없이 단편적인 상황만 보이고 독립적인 클립 가치가 없다면 reject입니다.
- 실수·논란 방송에서는 실제로 잘못을 인정하고 사과하거나 해명하는 정확한 장면을 찾고, 그 전후의 무관한 반응은 reject합니다.
- select는 맥락과 근거가 충분한 경우, review는 잠재 가치는 있으나 증거가 부족한 경우에만 사용하세요.
- 챕터의 근거 모드가 표본이고 커버리지가 낮다면 방송 전체를 안다고 가장하지 마세요. 후보 자체의 오디오·화면 근거로도 사건을 확정하지 못하면 review 또는 insufficient-context reject를 사용하세요.
- reject일 때는 rejectionReasons를 하나 이상, select일 때는 빈 배열로 반환하세요.
- 빠른 소리 탐색 후보와 별개로, 대사 챕터에서 조용한 성공·정확한 사과·중요한 결정·설정 회수처럼 다시 볼 가치가 있는 순간을 discoveredLeads에 최대 12개까지 제안하세요.
- discoveredLeads는 제공된 chapter ID 범위만 참조해야 하며 초 단위 위치를 지어내지 마세요. 후속 영상 재검증이 정확한 30초~1분 경계를 정합니다.
- 발견 근거가 한 챕터에 있으면 startChapterId와 endChapterId를 같은 ID로 두고, 반드시 가장 작은 근거 범위를 선택하세요.
- 노래·MV·오프닝·엔딩·대기·휴식, 맥락 없는 단편, 이미 주어진 후보와 같은 사건은 discoveredLeads에 넣지 마세요.
- 의미 있는 새 사건이 없다면 discoveredLeads는 빈 배열이어야 합니다.`;


const QWEN_REFINEMENT_SYSTEM_PROMPT = `당신은 이미 선택된 VTuber 방송 사건을 1분 단위 대사 칸으로 좁히는 편집 라우터입니다. 화려한 화면이나 큰 소리가 아니라 구체적인 원인→스트리머의 특징적인 반응→결과가 짧게 완결되는 장면을 찾으세요. 조용한 인정·사과·성공도 이 구조가 분명하면 중요합니다. 노래·MV·음악·오프닝·엔딩·대기·휴식, 평범한 진행, 일반적인 설명과 의견, 반복되는 비슷한 오답은 제외합니다. 한 큰 범위에 서로 다른 사건이 있으면 절정이 다른 장면을 각각 분리하되, 같은 논쟁의 연속은 가장 선명한 회수 하나만 최대 3개 고르세요.

반드시 다음 JSON만 출력하세요. 다른 키, 설명, 마크다운을 추가하지 마세요.
{"summary":"입력 범위 요약 80자 이내","leads":[{"s":"실제 시작 chapterId","e":"실제 끝 chapterId","c":"reaction | quiet-achievement | setup-and-payoff | running-gag | context-dependent | apology-accountability","p":0.0,"event":"사건과 반응 60자 이내","cue":"근거 대사 30자 이내"}]}`;

const QWEN_TOPIC_DISCOVERY_SYSTEM_PROMPT = `당신은 VTuber 방송의 한 주제 구간을 빠짐없이 훑는 2차 사건 탐색기입니다. 입력된 모든 대사 챕터를 시간순으로 확인해, 원인→스트리머의 특징적인 반응·주장·당황→결과가 짧게 완결되는 서로 다른 사건을 찾으세요. 이것은 최종 선택이 아니라 화면·오디오 재검증으로 보낼 고회수 단계입니다.

같은 코너나 형식 안에서도 소재·주장·반응의 절정이 다르면 별도 사건입니다. 특히 퀴즈·토크에서 서로 다른 대상의 오답, 강한 비유, 채팅과의 논쟁은 한 덩어리로 합치지 마세요. 반대로 같은 대상에 대한 연속 발화는 가장 좁은 chapter 범위 하나로 합치세요. 조용한 성공과 정확한 사과·인정도 반드시 확인하세요. 노래·MV·음악·오프닝·엔딩·대기·휴식, 사건 없는 설명, 맥락 없는 감탄은 제외하고 의미 있는 사건이 없으면 빈 배열을 반환하세요.

반드시 다음 JSON만 출력하세요. 실제 chapterId만 사용하고 초 단위 시각을 만들지 마세요.
{"summary":"입력 주제 구간 요약 80자 이내","leads":[{"s":"실제 시작 chapterId","e":"실제 끝 chapterId","c":"reaction | quiet-achievement | setup-and-payoff | running-gag | context-dependent | apology-accountability","p":0.0,"event":"서로 구별되는 사건과 반응 60자 이내","cue":"근거 대사 40자 이내"}]}
근거가 분명한 0.60 이상 사건만 최대 8개를 시간순으로 반환하세요. 개수를 채우지는 말되, 다른 소재의 사건을 누락시키기 위해 임의로 합치지도 마세요.`;

const QWEN_COMPACT_OVERVIEW_SYSTEM_PROMPT = `당신은 VTuber 인터넷 방송의 전체 맥락을 읽는 1차 클립 편집 라우터입니다. 큰 소리나 화려한 연출이 아니라 구체적인 사건과 그에 대한 스트리머의 반응을 넓게 찾으세요. 특히 직접적인 반박·논쟁·억울함·당황·웃음, 실수의 정확한 인정과 사과, 조용한 성공, 앞선 설정의 회수를 놓치지 마세요. 각 시간순 챕터를 빠짐없이 훑고, 평범한 코너 안에서도 원인→반응의 고조→결과가 짧게 완결되는 개별 교환은 별도 lead로 남기세요. 퀴즈·토크·게임처럼 같은 형식이 반복되어도 서로 다른 소재와 반응의 절정은 서로 다른 사건입니다. 한 넓은 구간 안에 서로 다른 반응 사건이 여러 개 있으면 후속 30초 정밀 단계가 나눌 수 있도록 그 범위를 lead로 남기세요.

노래·MV·음악·오프닝·엔딩·대기·휴식, 사건 없는 평범한 진행, 맥락 없는 감탄은 제외합니다. 빠른 소리 후보는 소리가 크다는 이유만으로 선택하지 말고 대사 맥락에서 실제 사건이 확인된 경우만 남기세요. 의미 있는 장면이 없으면 leads는 빈 배열이어야 하며 개수를 채우지 마세요. 단, 이 단계의 lead는 최종 클립이 아니라 후속 영상·대사 검증으로 보낼 고회수 탐색 범위입니다. 구체적인 사건·반응 근거가 있다면 0.65 이상으로 남기고, 흔한 게임 진행·중복·실제 클립 가치의 최종 제외는 후속 안전 게이트가 담당합니다.

방송의 주제가 바뀌는 경계도 chapters로 묶으세요. 실제 chapter ID만 사용해 시간순·비중첩으로 2~16개를 만들고, 같은 주제가 이어지면 한 구간으로 합치세요. 짧은 사건 하나를 주제 구간으로 부풀리지 마세요. 각 구간에서 실제로 무엇을 했고 어떤 흐름으로 다음 주제로 넘어갔는지 desc에 남기세요.

summary는 몇 줄짜리 홍보 문구가 아닙니다. 방송 시작부터 마무리까지 시간 순서, 주제 변화, 반복 소재, 주요 사건과 반응의 인과관계를 600~1000자로 보존하세요. host는 이 방송을 주도한 스트리머에 관한 편집용 관찰입니다. 닫힌 출연진 명단과 채널 주인 prior, 대사 속 이름 언급은 이름 표기 교정과 탐색 단서일 뿐 실제 등장·발화 증거가 아닙니다. 화면 이름표·시각 참조 일치·발화자의 자기소개·음성 참조 일치 중 하나가 근거 지도에 있을 때만 name에 쓰고, 아니면 null로 두세요. profile에는 진행 역할, 말투와 채팅·게스트 상호작용, 반복 관심사, 특징적인 반응 방식을 300~500자로 서술하세요. evidence에는 방송 속 구체적 단서 2~5개, uncertainty에는 확정할 수 없는 점을 넣으세요. 나이·성별·국적·건강·사생활 등 민감하거나 근거 없는 신상은 추정하지 마세요.

반드시 다음 JSON만 출력하세요. 다른 키, 설명, 마크다운을 추가하지 마세요.
{"summary":"방송 전체 흐름 600~1000자","host":{"name":null,"profile":"주 진행 스트리머 관찰 300~500자","evidence":["근거 단서"],"uncertainty":[]},"themes":["핵심 주제 최대 4개"],"chapters":[{"s":"실제 시작 chapterId","e":"실제 끝 chapterId","title":"주제 제목 24자 이내","desc":"이 구간의 실제 내용과 흐름 160자 이내","kind":"main-event | story-progress | setup-and-payoff | running-gag | quiet-achievement | reaction | context-shift | other","sal":"primary | secondary"}],"candidates":[{"id":"실제 candidateId","d":"select | review | reject","c":"reaction | quiet-achievement | setup-and-payoff | running-gag | context-dependent | apology-accountability | music-or-intermission | not-clip-worthy | uncertain","p":0.0,"reason":"판정 이유 50자 이내"}],"leads":[{"s":"실제 시작 chapterId","e":"실제 끝 chapterId","c":"reaction | quiet-achievement | setup-and-payoff | running-gag | context-dependent | apology-accountability","p":0.0,"event":"사건과 반응 60자 이내","cue":"근거 대사 30자 이내"}]}
입력된 모든 candidateId를 candidates에 정확히 한 번 넣고, leads는 신뢰도 0.65 이상 최대 12개를 시간순으로 반환하세요. 후보 개수를 채우기 위한 추측은 금지하지만, 근거가 다른 사건을 임의로 하나로 합치지도 마세요.`;

const QWEN_SELECTION_SYSTEM_PROMPT = `당신은 VTuber 방송의 보수적인 최종 클립 편집 심사자입니다. 이미 정밀 탐색된 후보들을 서로 비교해, 독립된 사건과 스트리머의 특징적인 반응이 함께 완결되고 처음 보는 시청자가 실제로 다시 볼 가치가 있는 대표 후보들을 남기세요. 클립은 음식·게임 정보가 아니라 그 사건을 겪는 스트리머의 반응을 보는 콘텐츠입니다. 설명이 논리적이거나 정보가 많다는 이유만으로 고르지 말고, 전제가 즉시 이해되며 반박·당황·억울함·웃음·채팅과의 충돌처럼 반응의 원인→고조→결과가 선명한 장면을 우선하세요. 같은 퀴즈·토크·게임 코너에 속한다는 이유만으로 주제당 하나로 축약하지 마세요. 서로 다른 문항·대상·갈등 원인에서 반응의 절정과 결론이 각각 다르면 서로 다른 독립 사건입니다. 반대로 같은 대상과 논쟁을 넓은 범위로 반복 서술한 후보만 중복입니다.

큰 소리·화려한 화면·반복 오답 자체는 선정 근거가 아닙니다. 게임의 흔한 추락·사망·길 찾기·자원 부족·제작 실수·건축 완료·일반적인 생존은 패닉이나 극적인 자기 묘사가 있어도 제외하세요. 일반 몹을 실수로 처치하고 짧게 미안해하기, 짧은 파쿠르 실패 뒤 길치 인정, 흔한 아이템 손실 뒤 노래로 넘기기, 대충 만든 건축을 말장난으로 합리화하기도 모두 독립적인 클립이 아닌 일상적 게임 단편입니다. 큰 손실, 희귀 성취, 예상 밖 버그·사회적 상호작용, 장기 설정 회수처럼 방송 흐름을 실질적으로 바꾼 경우만 예외입니다. 반대로 퀴즈·토론에서 구체적인 비유나 인용할 만한 대사로 논쟁이 오래 고조되고 채팅·제작자와 충돌해 결론까지 난 경우는 단순 오답과 구분하세요. 스트리머가 스스로 '애니', '드라마', '레전드'라고 말한 것은 가치 증거가 아닙니다. 같은 농담이나 같은 논쟁은 가장 선명한 절정 하나만 남기고 중복을 버리세요. 조용한 성공, 정확한 사과·인정, 설정 회수는 소리가 작아도 중요하지만 방송 전체의 핵심 책임 사건이 아닌 평범한 퀴즈 인정은 강한 반응 장면보다 우선하지 않습니다. 노래·MV·음악·오프닝·엔딩·대기·휴식은 제외합니다. 가치 있는 후보가 없으면 빈 배열이 정답이며 개수를 채우지 마세요.

반드시 다음의 짧은 JSON만 출력하세요. 다른 키, 설명, 마크다운을 추가하지 마세요.
{"summary":"선정 결과 80자 이내","selected":[{"id":"실제 candidateId","p":0.0,"reason":"선정 이유 50자 이내"}]}
일반 방송은 신뢰도 0.88 이상, 게임 플레이 방송은 일상적 단편을 제외한 뒤 0.93 이상만 최대 8개를 점수순으로 반환하세요. 독립 사건이 여러 개라면 한 주제의 대표 하나만 남기는 요약을 하지 말고, 각 사건을 후보별로 판단하세요.`;

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function buildBroadcastContextCastRosterBlock(
  request: BroadcastContextRequest,
): string {
  const grounding = request.participantGrounding;
  const knownReferenceById = new Map(
    candidatePassBKnownCastReferences().map((reference) => [
      reference.participantId,
      reference,
    ]),
  );
  const rosterLines = grounding.participants.map((participant) => {
    const reference = knownReferenceById.get(participant.participantId);
    const aliases =
      reference === undefined || reference.aliasesKo.length === 0
        ? ""
        : ` / 고정 호칭·ASR 변형: ${reference.aliasesKo.join(", ")}`;
    const prior =
      participant.sourceRolePrior === "likely-host"
        ? "원본 채널상 주 진행자 후보"
        : participant.sourceRolePrior === "possible-guest"
          ? "출연 가능 멤버"
          : "출처 prior 없음";
    const mentions =
      participant.mentionedChapterCount === 0
        ? "대사 이름 언급 없음"
        : `대사 이름 언급 챕터 ${participant.mentionedChapterCount}개`;
    return `- ${participant.displayNameKo} (${prior} / ${mentions}${aliases})`;
  });
  const adapterLines = grounding.adapterReceipts.map((receipt) => {
    const state =
      receipt.status === "completed"
        ? `완료 ${receipt.processedCount}/${receipt.inputCount}`
        : "사용 불가(검증된 참조 자료 없음)";
    return `- ${receipt.adapter}: ${state}`;
  });
  const observedEvidenceLines = grounding.evidence.flatMap((evidence) => {
    if (
      evidence.kind === "source-channel-prior" ||
      evidence.kind === "transcript-name-mention"
    ) {
      return [];
    }
    const participant =
      evidence.participantId === null
        ? "인물 미확정"
        : grounding.participants.find(
            ({ participantId }) => participantId === evidence.participantId,
          )?.displayNameKo ?? "인물 미확정";
    const confidence =
      evidence.confidence === null
        ? "미산정"
        : evidence.confidence.toFixed(2);
    return [
      `- ${formatDuration(evidence.startMs)}~${formatDuration(evidence.endMs)} / ${participant} / ${evidence.kind} / 신뢰도 ${confidence} / ${evidence.evidenceKo}`,
    ];
  });
  const observedEvidenceBlock =
    observedEvidenceLines.length === 0
      ? "- 관찰 확인된 화면·목소리 인물 근거 없음"
      : observedEvidenceLines.join("\n");
  return `### 맥락 분석 전 인물 근거 지도 (${grounding.status})\n${rosterLines.join("\n")}\n\n인물 근거 어댑터:\n${adapterLines.join("\n")}\n\n관찰 근거:\n${observedEvidenceBlock}\n이 지도는 닫힌 6인 카탈로그와 원본 출처 prior, 대사 속 이름 언급, 실제 화면·목소리 관찰 근거를 분리해 기록합니다. 채널 주인 prior는 실제 출연 증거가 아니고, 이름 언급도 그 사람이 말했거나 화면에 있었다는 증거가 아닙니다. 현재 visual-identity 또는 voice-identity가 완료되지 않았다면 주 진행자 이름과 장면별 발화자를 확정하지 마세요. 호칭·ASR 변형은 위 canonical 전체 이름으로 쓰되, 목소리 느낌만으로 발화자를 정하거나 해당 장면에 있었다고 추측하지 말고 목록 밖 인물을 만들지 마세요.\n\n`;
}

export function buildBroadcastContextDeepseekRequestBody(
  request: BroadcastContextRequest,
  model: string = "deepseek-v4-pro",
): BroadcastContextDeepseekRequestBody {
  const languageRule = request.outputLanguage === "ko"
    ? "출력 서술은 현대 한국어 한글로만 작성하고 한자·중국어 문자를 섞지 마세요."
    : "Write every generated narrative, title, reason, theme, uncertainty, and host profile in English only. Keep proper VTuber names and verbatim source quotations unchanged.";
  let userContent = `총 방송 길이: ${formatDuration(request.sourceDurationMs)}\n${languageRule} 방송 흐름에는 사건의 시간 순서를, host profile에는 반복 관찰된 진행 방식만 적어 서로 중복하지 마세요.\n\n`;
  userContent += buildBroadcastContextCastRosterBlock(request);
  userContent += `### 방송 챕터 요약 (시간순)\n`;
  for (const chapter of request.chapters) {
    userContent += `- [${formatDuration(chapter.startMs)} ~ ${formatDuration(chapter.endMs)}] (ID: ${chapter.chapterId}, 근거: ${chapter.evidenceMode}, 커버리지: ${Math.round(chapter.evidenceCoverageRatio * 100)}%): ${chapter.summaryKo}\n`;
  }
  userContent += `\n### 분석 대상 후보 (Candidates)\n`;
  for (const candidate of request.candidates) {
    userContent += `\n==== 후보 ID: ${candidate.candidateId} ====\n`;
    userContent += `구간: ${formatDuration(candidate.startMs)} ~ ${formatDuration(candidate.endMs)}\n`;
    userContent += `대화 요약:\n${candidate.transcriptKo}\n`;
    userContent += `사건 요약: ${candidate.eventSummaryKo}\n`;
    userContent += `반응 요약: ${candidate.reactionSummaryKo}\n`;
    userContent += `등장인물: ${candidate.participantContextKo}\n`;
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
    thinking: { type: "enabled" },
    reasoning_effort: "high",
  };
}

/** Official OpenAI-compatible Qwen hybrid-thinking variant of the same task. */
export function buildBroadcastContextQwenRequestBody(
  request: BroadcastContextRequest,
  model = "qwen3.7-plus",
  mode: BroadcastContextQwenMode = "overview",
): BroadcastContextQwenRequestBody {
  const isRefinementMode = mode === "refinement" || mode === "refinement-fast";
  const enableThinking = model !== "qwen3.6-flash";
  const languageRule = request.outputLanguage === "ko"
    ? "출력 서술은 현대 한국어 한글로만 작성하고 한자·중국어 문자를 섞지 마세요."
    : "Write every generated narrative, title, reason, theme, uncertainty, and host profile in English only. Keep proper VTuber names and verbatim source quotations unchanged.";
  let userContent = `총 방송 길이: ${formatDuration(request.sourceDurationMs)}\n${languageRule} 방송 흐름에는 사건의 시간 순서를, host profile에는 반복 관찰된 진행 방식만 적어 서로 중복하지 마세요.\n\n`;
  userContent += buildBroadcastContextCastRosterBlock(request);
  userContent += "### 시간순 대사 챕터\n";
  for (const chapter of request.chapters) {
    userContent += `- ${chapter.chapterId} [${formatDuration(chapter.startMs)}~${formatDuration(chapter.endMs)} / ${chapter.evidenceMode} / 근거 ${Math.round(chapter.evidenceCoverageRatio * 100)}%]: ${chapter.summaryKo}\n`;
  }
  userContent += "\n### 빠른 탐색 후보\n";
  if (request.candidates.length === 0) {
    userContent += "- 없음. 챕터에서 의미 후보만 찾으세요.\n";
  }
  for (const candidate of request.candidates) {
    userContent += `- ${candidate.candidateId} [${formatDuration(candidate.startMs)}~${formatDuration(candidate.endMs)}]\n`;
    userContent += `  대사: ${candidate.transcriptKo}\n`;
    userContent += `  사건: ${candidate.eventSummaryKo}\n`;
    userContent += `  반응: ${candidate.reactionSummaryKo}\n`;
    userContent += `  등장인물: ${candidate.participantContextKo}\n`;
    if (candidate.chatReactionSummaryKo) {
      userContent += `  채팅: ${candidate.chatReactionSummaryKo}\n`;
    }
  }
  if (isRefinementMode) {
    userContent += "\n### 정밀 라우팅 제한\n신뢰도 0.75 이상만 최대 3개 반환하세요.\n";
  } else if (mode === "discovery") {
    userContent += "\n### 주제 내부 탐색 제한\n입력한 모든 챕터를 훑고 서로 다른 사건만 최대 8개 반환하세요.\n";
  } else if (mode === "selection") {
    userContent += "\n### 최종 심사 제한\n후보끼리 직접 비교하고 중복을 제거하세요. 개수를 채우지 마세요.\n";
  }

  return {
    model,
    messages: [
      {
        role: "system",
        content: isRefinementMode
          ? QWEN_REFINEMENT_SYSTEM_PROMPT
          : mode === "discovery"
            ? QWEN_TOPIC_DISCOVERY_SYSTEM_PROMPT
          : mode === "selection"
            ? QWEN_SELECTION_SYSTEM_PROMPT
            : QWEN_COMPACT_OVERVIEW_SYSTEM_PROMPT,
      },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
    enable_thinking: enableThinking,
    ...(enableThinking ? { thinking_budget: 768 } : {}),
  };
}

export function extractBroadcastContextQwenRefinementResponse(
  payload: unknown,
  request: BroadcastContextRequest,
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
  parsed = replaceUnexpectedHan(parsed, request.outputLanguage);
  if (
    !isRecord(parsed) ||
    !hasExactKeys(parsed, ["summary", "leads"]) ||
    typeof parsed.summary !== "string" ||
    !Array.isArray(parsed.leads) ||
    parsed.leads.length > 3
  ) {
    return { ok: false };
  }

  const rawLeads: BroadcastContextDiscoveredLeadReference[] = [];
  for (const [index, value] of parsed.leads.entries()) {
    if (
      !isRecord(value) ||
      !hasExactKeys(value, ["s", "e", "c", "p", "event", "cue"]) ||
      typeof value.s !== "string" ||
      typeof value.e !== "string" ||
      typeof value.c !== "string" ||
      !isValidDiscoveredLeadCategory(value.c) ||
      typeof value.p !== "number" ||
      !Number.isFinite(value.p) ||
      value.p < 0.75 ||
      value.p > 1 ||
      typeof value.event !== "string" ||
      typeof value.cue !== "string"
    ) {
      return { ok: false };
    }
    rawLeads.push({
      leadId: `refine-${value.s}-${value.e}-${index + 1}`,
      startChapterId: value.s,
      endChapterId: value.e,
      category: value.c,
      confidence: value.p,
      eventSummaryKo: value.event,
      whyThisMomentKo: "사건과 스트리머 반응이 함께 확인되는 정밀 후보입니다.",
      evidenceCueKo: value.cue,
      uncertaintiesKo: ["최종 영상·음성 재검증 필요"],
    });
  }
  const discoveredLeads: BroadcastContextDiscoveredLead[] = [];
  for (const lead of rawLeads) {
    try {
      discoveredLeads.push(...normalizeDiscoveredLeads([lead], request.chapters));
    } catch {
      return { ok: false };
    }
  }
  discoveredLeads.sort(
    (left, right) =>
      left.startMs - right.startMs ||
      left.endMs - right.endMs ||
      left.leadId.localeCompare(right.leadId),
  );
  return {
    ok: true,
    result: {
      schemaVersion: BROADCAST_CONTEXT_SCHEMA_VERSION,
      broadcastSummaryKo: parsed.summary,
      hostStreamerProfile: null,
      recurringThemesKo: [],
      annotations: request.candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        category: "uncertain" as const,
        clipDecision: "reject" as const,
        confidence: 0,
        rejectionReasons: ["uncertain-evidence" as const],
        contextSummaryKo: "정밀 라우팅에서는 기존 후보를 다시 판정하지 않습니다.",
        whyThisMomentKo: "개요 단계 판정을 유지합니다.",
        relatedCandidateIds: [],
        uncertaintiesKo: ["정밀 라우팅 대상 아님"],
      })),
      semanticChaptersSupported: false,
      semanticChapters: [],
      discoveredLeadsSupported: true,
      discoveredLeads,
      coverage: calculateCoverage(request.chapters, request.sourceDurationMs),
    },
  };
}

export function extractBroadcastContextQwenDiscoveryResponse(
  payload: unknown,
  request: BroadcastContextRequest,
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
  parsed = replaceUnexpectedHan(parsed, request.outputLanguage);
  if (
    !isRecord(parsed) ||
    !hasExactKeys(parsed, ["summary", "leads"]) ||
    typeof parsed.summary !== "string" ||
    !Array.isArray(parsed.leads) ||
    parsed.leads.length > 8
  ) {
    return { ok: false };
  }

  const rawLeads: BroadcastContextDiscoveredLeadReference[] = [];
  for (const [index, value] of parsed.leads.entries()) {
    if (
      !isRecord(value) ||
      !hasExactKeys(value, ["s", "e", "c", "p", "event", "cue"]) ||
      typeof value.s !== "string" ||
      typeof value.e !== "string" ||
      typeof value.c !== "string" ||
      !isValidDiscoveredLeadCategory(value.c) ||
      typeof value.p !== "number" ||
      !Number.isFinite(value.p) ||
      value.p < 0.6 ||
      value.p > 1 ||
      typeof value.event !== "string" ||
      typeof value.cue !== "string"
    ) {
      return { ok: false };
    }
    rawLeads.push({
      leadId: `discovery-${value.s}-${value.e}-${index + 1}`,
      startChapterId: value.s,
      endChapterId: value.e,
      category: value.c,
      confidence: value.p,
      eventSummaryKo: value.event,
      whyThisMomentKo: "주제 내부 대사에서 별도 사건과 반응이 확인됩니다.",
      evidenceCueKo: value.cue,
      uncertaintiesKo: ["최종 영상·음성 재검증 필요"],
    });
  }
  const discoveredLeads: BroadcastContextDiscoveredLead[] = [];
  for (const lead of rawLeads) {
    try {
      discoveredLeads.push(...normalizeDiscoveredLeads([lead], request.chapters));
    } catch {
      return { ok: false };
    }
  }
  discoveredLeads.sort(
    (left, right) =>
      left.startMs - right.startMs ||
      left.endMs - right.endMs ||
      left.leadId.localeCompare(right.leadId),
  );
  return {
    ok: true,
    result: {
      schemaVersion: BROADCAST_CONTEXT_SCHEMA_VERSION,
      broadcastSummaryKo: parsed.summary,
      hostStreamerProfile: null,
      recurringThemesKo: [],
      annotations: [],
      semanticChaptersSupported: false,
      semanticChapters: [],
      discoveredLeadsSupported: true,
      discoveredLeads,
      coverage: calculateCoverage(request.chapters, request.sourceDurationMs),
    },
  };
}

export function extractBroadcastContextQwenOverviewResponse(
  payload: unknown,
  request: BroadcastContextRequest,
): BroadcastContextDeepseekParseOutcome {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    return { ok: false, reason: "provider-envelope" };
  }
  const choice: unknown = payload.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message) || typeof choice.message.content !== "string") {
    return { ok: false, reason: "message-content" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(choice.message.content);
  } catch {
    return { ok: false, reason: "content-json" };
  }
  parsed = replaceUnexpectedHan(parsed, request.outputLanguage);
  if (
    !isRecord(parsed) ||
    !hasExactKeys(parsed, [
      "summary",
      "host",
      "themes",
      "chapters",
      "candidates",
      "leads",
    ]) ||
    typeof parsed.summary !== "string" ||
    !isStringArray(parsed.themes) ||
    !Array.isArray(parsed.chapters) ||
    parsed.chapters.length === 0 ||
    parsed.chapters.length > 16 ||
    !Array.isArray(parsed.candidates) ||
    !Array.isArray(parsed.leads) ||
    parsed.leads.length > 12
  ) {
    return { ok: false, reason: "top-level" };
  }
  const broadcastSummaryKo = parsed.summary;
  const parsedHostStreamerProfile = parseHostStreamerProfile(parsed.host, true);
  if (parsedHostStreamerProfile === null) {
    return { ok: false, reason: "host" };
  }
  const themes = parsed.themes.slice(0, 4);
  const hostStreamerProfile = groundHostStreamerProfile(
    parsedHostStreamerProfile,
    request,
  );
  const rawCandidates = parsed.candidates;
  const verdicts = new Map<string, BroadcastContextCandidateAnnotation>();
  const requestedIds = new Set(request.candidates.map((candidate) => candidate.candidateId));
  for (const value of rawCandidates) {
    if (
      !isRecord(value) ||
      !hasExactKeys(value, ["id", "d", "c", "p", "reason"]) ||
      typeof value.id !== "string" ||
      !requestedIds.has(value.id) ||
      verdicts.has(value.id) ||
      typeof value.d !== "string" ||
      !isValidClipDecision(value.d) ||
      typeof value.c !== "string" ||
      !isValidCategory(value.c) ||
      typeof value.p !== "number" ||
      !Number.isFinite(value.p) ||
      value.p < 0 ||
      value.p > 1 ||
      typeof value.reason !== "string"
    ) {
      return { ok: false, reason: "candidate-item" };
    }
    const rejectionReasons: readonly BroadcastContextRejectionReason[] =
      value.d !== "reject"
        ? []
        : value.c === "music-or-intermission"
          ? ["music-or-song"]
          : value.c === "uncertain"
            ? ["uncertain-evidence"]
            : ["no-distinct-event"];
    verdicts.set(value.id, {
      candidateId: value.id,
      category: value.c,
      clipDecision: value.d,
      confidence: value.p,
      rejectionReasons,
      contextSummaryKo: value.reason,
      whyThisMomentKo: value.reason,
      relatedCandidateIds: [],
      uncertaintiesKo: [],
    });
  }
  if (
    verdicts.size !== requestedIds.size ||
    rawCandidates.length !== requestedIds.size
  ) {
    return { ok: false, reason: "candidate-coverage" };
  }
  const annotations = request.candidates.map((candidate) => {
    const verdict = verdicts.get(candidate.candidateId)!;
    if (
      verdict.clipDecision !== "reject" &&
      isRoutineGameplayEvidence(broadcastSummaryKo, [
        candidate.transcriptKo,
        candidate.eventSummaryKo,
        candidate.reactionSummaryKo,
        verdict.contextSummaryKo,
      ])
    ) {
      return {
        ...verdict,
        category: "not-clip-worthy" as const,
        clipDecision: "reject" as const,
        confidence: Math.max(verdict.confidence, 0.9),
        rejectionReasons: ["no-distinct-event" as const],
        contextSummaryKo:
          "전체 맥락에서 흔한 게임 진행으로 확인되어 편집 후보에서 제외했습니다.",
        whyThisMomentKo:
          "큰 반응이나 극적인 자기 묘사만으로는 독립적인 클립 사건이 되지 않습니다.",
      };
    }
    return verdict;
  });

  const rawLeads: BroadcastContextDiscoveredLeadReference[] = [];
  for (const [index, value] of parsed.leads.entries()) {
    if (
      !isRecord(value) ||
      !hasExactKeys(value, ["s", "e", "c", "p", "event", "cue"]) ||
      typeof value.s !== "string" ||
      typeof value.e !== "string" ||
      typeof value.c !== "string" ||
      !isValidDiscoveredLeadCategory(value.c) ||
      typeof value.p !== "number" ||
      !Number.isFinite(value.p) ||
      value.p < 0.65 ||
      value.p > 1 ||
      typeof value.event !== "string" ||
      typeof value.cue !== "string"
    ) {
      return { ok: false, reason: "lead-item" };
    }
    if (
      isRoutineGameplayEvidence(broadcastSummaryKo, [value.event, value.cue])
    ) {
      continue;
    }
    rawLeads.push({
      leadId: `overview-${value.s}-${value.e}-${index + 1}`,
      startChapterId: value.s,
      endChapterId: value.e,
      category: value.c,
      confidence: value.p,
      eventSummaryKo: value.event,
      whyThisMomentKo: "방송 전체 맥락에서 다시 확인할 가치가 있는 사건입니다.",
      evidenceCueKo: value.cue,
      uncertaintiesKo: ["최종 영상·음성 재검증 필요"],
    });
  }
  const discoveredLeads: BroadcastContextDiscoveredLead[] = [];
  for (const lead of rawLeads) {
    try {
      discoveredLeads.push(...normalizeDiscoveredLeads([lead], request.chapters));
    } catch {
      return { ok: false, reason: "lead-range" };
    }
  }
  discoveredLeads.sort(
    (left, right) =>
      left.startMs - right.startMs ||
      left.endMs - right.endMs ||
      left.leadId.localeCompare(right.leadId),
  );
  const rawSemanticChapters: BroadcastContextSemanticChapterReference[] = [];
  for (const value of parsed.chapters) {
    if (
      !isRecord(value) ||
      !hasExactKeys(value, ["s", "e", "title", "desc", "kind", "sal"]) ||
      typeof value.s !== "string" ||
      typeof value.e !== "string" ||
      typeof value.title !== "string" ||
      value.title.trim().length === 0 ||
      typeof value.desc !== "string" ||
      value.desc.trim().length === 0 ||
      typeof value.kind !== "string" ||
      !isValidSemanticKind(value.kind) ||
      typeof value.sal !== "string" ||
      !isValidSemanticSalience(value.sal)
    ) {
      return { ok: false, reason: "chapter-item" };
    }
    rawSemanticChapters.push({
      startChapterId: value.s,
      endChapterId: value.e,
      titleKo: Array.from(value.title.trim()).slice(0, 64).join(""),
      summaryKo: Array.from(value.desc.trim()).slice(0, 1_200).join(""),
      kind: value.kind as BroadcastContextSemanticChapterKind,
      salience: value.sal as BroadcastContextSemanticChapterSalience,
      relatedCandidateIds: [],
      uncertaintiesKo: [],
    });
  }
  let semanticChapters: readonly BroadcastContextSemanticChapter[];
  try {
    semanticChapters = normalizeSemanticChapters(
      rawSemanticChapters,
      request.chapters,
      calculateCoverage(request.chapters, request.sourceDurationMs).gaps,
    );
  } catch {
    return { ok: false, reason: "chapter-normalization" };
  }
  return {
    ok: true,
    result: {
      schemaVersion: BROADCAST_CONTEXT_SCHEMA_VERSION,
      broadcastSummaryKo,
      hostStreamerProfile,
      recurringThemesKo: themes,
      annotations,
      semanticChaptersSupported: true,
      semanticChapters,
      discoveredLeadsSupported: true,
      discoveredLeads,
      coverage: calculateCoverage(request.chapters, request.sourceDurationMs),
    },
  };
}

export function extractBroadcastContextQwenSelectionResponse(
  payload: unknown,
  request: BroadcastContextRequest,
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
  parsed = replaceUnexpectedHan(parsed, request.outputLanguage);
  if (
    !isRecord(parsed) ||
    !hasExactKeys(parsed, ["summary", "selected"]) ||
    typeof parsed.summary !== "string" ||
    !Array.isArray(parsed.selected) ||
    parsed.selected.length > 8
  ) {
    return { ok: false };
  }
  const candidateById = new Map(
    request.candidates.map((candidate) => [candidate.candidateId, candidate]),
  );
  const candidateIds = new Set(candidateById.keys());
  const contextText = request.chapters
    .map((chapter) => chapter.summaryKo)
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR");
  const gameplayChapterCount = request.chapters.filter((chapter) =>
    ROUTINE_GAMEPLAY_TERMS.test(chapter.summaryKo)
  ).length;
  const broadcastIsGameplay =
    GAME_BROADCAST_TERMS.test(contextText) &&
    gameplayChapterCount >= Math.max(2, Math.ceil(request.chapters.length * 0.35));
  const selected = new Map<string, { readonly confidence: number; readonly reason: string }>();
  const routineGameplayRejectedIds = new Set<string>();
  for (const value of parsed.selected) {
    if (
      !isRecord(value) ||
      !hasExactKeys(value, ["id", "p", "reason"]) ||
      typeof value.id !== "string" ||
      !candidateIds.has(value.id) ||
      selected.has(value.id) ||
      typeof value.p !== "number" ||
      !Number.isFinite(value.p) ||
      value.p < 0 ||
      value.p > 1 ||
      typeof value.reason !== "string"
    ) {
      return { ok: false };
    }
    const candidate = candidateById.get(value.id);
    const localContextText = candidate === undefined
      ? contextText
      : request.chapters
          .filter(
            (chapter) =>
              chapter.startMs < candidate.endMs &&
              chapter.endMs > candidate.startMs,
          )
          .map((chapter) => chapter.summaryKo)
          .join(" ")
          .normalize("NFKC")
          .toLocaleLowerCase("ko-KR") || contextText;
    const candidateIsGameplay =
      broadcastIsGameplay || GAME_BROADCAST_TERMS.test(localContextText);
    const selectionConfidenceThreshold = candidateIsGameplay
      ? 0.93
      : 0.88;
    if (value.p < selectionConfidenceThreshold) {
      continue;
    }
    if (
      candidate !== undefined &&
      isRoutineGameplayEvidence(
        candidateIsGameplay ? `게임 플레이 ${localContextText}` : localContextText,
        [
          candidate.transcriptKo,
          candidate.eventSummaryKo,
          candidate.reactionSummaryKo,
          value.reason,
        ],
      )
    ) {
      routineGameplayRejectedIds.add(value.id);
      continue;
    }
    selected.set(value.id, { confidence: value.p, reason: value.reason });
  }
  return {
    ok: true,
    result: {
      schemaVersion: BROADCAST_CONTEXT_SCHEMA_VERSION,
      broadcastSummaryKo: parsed.summary,
      hostStreamerProfile: null,
      recurringThemesKo: [],
      annotations: request.candidates.map((candidate) => {
        if (routineGameplayRejectedIds.has(candidate.candidateId)) {
          return {
            candidateId: candidate.candidateId,
            category: "not-clip-worthy" as const,
            clipDecision: "reject" as const,
            confidence: 0.96,
            rejectionReasons: ["no-distinct-event" as const],
            contextSummaryKo: "방송 전체 맥락에서 평범한 게임 진행으로 확인했습니다.",
            whyThisMomentKo: "희귀한 사건·장기 맥락 회수·사회적 반응 없이 일상적인 플레이만 이어집니다.",
            relatedCandidateIds: [],
            uncertaintiesKo: [],
          };
        }
        const verdict = selected.get(candidate.candidateId);
        return verdict === undefined
          ? {
              candidateId: candidate.candidateId,
              category: "not-clip-worthy" as const,
              clipDecision: "reject" as const,
              confidence: 0.82,
              rejectionReasons: ["duplicate-episode" as const],
              contextSummaryKo: "다른 후보와 비교해 대표 장면에서 제외했습니다.",
              whyThisMomentKo: "중복되거나 사건·반응의 완결성이 상대적으로 낮습니다.",
              relatedCandidateIds: [],
              uncertaintiesKo: [],
            }
          : {
              candidateId: candidate.candidateId,
              category: "reaction" as const,
              clipDecision: "select" as const,
              confidence: verdict.confidence,
              rejectionReasons: [],
              contextSummaryKo: verdict.reason,
              whyThisMomentKo: verdict.reason,
              relatedCandidateIds: [],
              uncertaintiesKo: ["최종 영상·음성 재검증 필요"],
            };
      }),
      semanticChaptersSupported: false,
      semanticChapters: [],
      discoveredLeadsSupported: false,
      discoveredLeads: [],
      coverage: calculateCoverage(request.chapters, request.sourceDurationMs),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseHostStreamerProfile(
  value: unknown,
  compact: boolean,
): BroadcastContextHostStreamerProfile | null {
  if (!isRecord(value)) return null;
  const rawName = compact ? value.name : value.displayNameKo;
  const rawProfile = compact ? value.profile : value.profileSummaryKo;
  const rawEvidence = compact ? value.evidence : value.evidenceKo;
  const rawUncertainties = compact ? value.uncertainty : value.uncertaintiesKo;
  if (
    (rawName !== null && typeof rawName !== "string") ||
    typeof rawProfile !== "string" ||
    rawProfile.trim().length === 0 ||
    !isStringArray(rawEvidence) ||
    !isStringArray(rawUncertainties)
  ) {
    return null;
  }
  const normalizedName = typeof rawName === "string" ? rawName.trim() : null;
  return {
    displayNameKo: normalizedName === "" ? null : normalizedName,
    profileSummaryKo: rawProfile.trim(),
    evidenceKo: rawEvidence
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .slice(0, 5),
    uncertaintiesKo: rawUncertainties
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .slice(0, 5),
  };
}

const SENSITIVE_HOST_PROFILE_SENTENCE =
  /(?:\d{1,3}\s*살|나이|성별|여성\s*스트리머|남성\s*스트리머|국적|출신|한국계|미국\s*(?:학교|거주|문화|사람)|데미섹슈얼|성적\s*지향|성별\s*정체성|본명|실명|가족\s*구성|질병|건강\s*상태|종교|정치\s*성향)/iu;

function safeHostProfileSentences(value: string): readonly string[] {
  return value
    .split(/(?<=[.!?。])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(
      (sentence) =>
        sentence.length > 0 && !SENSITIVE_HOST_PROFILE_SENTENCE.test(sentence),
    );
}

function groundHostStreamerProfile(
  profile: BroadcastContextHostStreamerProfile | null,
  request: BroadcastContextRequest,
): BroadcastContextHostStreamerProfile | null {
  if (profile === null) return null;
  const safeSummary = safeHostProfileSentences(profile.profileSummaryKo).join(" ");
  if (safeSummary.length === 0) return null;
  const groundedNameReference =
    profile.displayNameKo === null
      ? null
      : candidatePassBKnownCastReferenceForName(profile.displayNameKo);
  const hasObservedIdentityEvidence =
    groundedNameReference !== null &&
    request.participantGrounding.evidence.some(
      (evidence) =>
        evidence.participantId === groundedNameReference.participantId &&
        new Set<string>([
          "on-screen-name",
          "visual-reference-match",
          "spoken-self-identification",
          "voice-reference-match",
        ]).has(evidence.kind),
    );
  const groundedParticipant =
    groundedNameReference === null
      ? null
      : request.participantGrounding.participants.find(
          ({ participantId }) =>
            participantId === groundedNameReference.participantId,
        ) ?? null;
  const matchesHostPrior =
    request.castRosterId === null ||
    groundedParticipant?.sourceRolePrior === "likely-host";
  const evidenceKo = profile.evidenceKo.filter(
    (item) => !SENSITIVE_HOST_PROFILE_SENTENCE.test(item),
  );
  const uncertaintiesKo = profile.uncertaintiesKo.filter(
    (item) => !SENSITIVE_HOST_PROFILE_SENTENCE.test(item),
  );
  return {
    displayNameKo:
      groundedNameReference !== null &&
      hasObservedIdentityEvidence &&
      matchesHostPrior
        ? groundedNameReference.displayName
        : null,
    profileSummaryKo: safeSummary,
    evidenceKo,
    uncertaintiesKo:
      uncertaintiesKo.length > 0
        ? uncertaintiesKo
        : ["방송 밖의 인물 특성과 신상은 확인하지 않았습니다."],
  };
}

function isValidCategory(value: string): value is BroadcastContextCandidateCategory {
  return [
    "reaction",
    "quiet-achievement",
    "setup-and-payoff",
    "running-gag",
    "context-dependent",
    "apology-accountability",
    "music-or-intermission",
    "not-clip-worthy",
    "uncertain",
  ].includes(value);
}

function isValidClipDecision(value: string): value is BroadcastContextClipDecision {
  return ["select", "review", "reject"].includes(value);
}

function isValidRejectionReason(value: string): value is BroadcastContextRejectionReason {
  return [
    "music-or-song",
    "opening-ending-or-break",
    "no-distinct-event",
    "reaction-without-context",
    "insufficient-context",
    "duplicate-episode",
    "uncertain-evidence",
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

function isValidDiscoveredLeadCategory(
  value: string,
): value is BroadcastContextDiscoveredLeadCategory {
  return [
    "reaction",
    "quiet-achievement",
    "setup-and-payoff",
    "running-gag",
    "context-dependent",
    "apology-accountability",
  ].includes(value);
}

const GAME_BROADCAST_TERMS =
  /(?:게임\s*(?:방송|플레이|화면|내에서|내\b)|gameplay|video\s*game|마인크래프트|minecraft|마크\s|롤\s|리그\s*오브\s*레전드|발로란트|오버워치|로블록스)/iu;
const ROUTINE_GAMEPLAY_TERMS =
  /(?:추락|낙사|사망|죽었|죽음|길치|길을?\s*(?:잃|찾)|좌표|자원|채굴|파밍|제작|조합|건축|이동|전투|몬스터|동굴|물에\s*빠|떠내려|생존|인벤토리|기지|베이스|침대|재료|아이템\s*정리)/iu;
const ROUTINE_GAME_BANTER_TERMS =
  /(?:노래\s*요청|질문\s*폭탄|책임\s*전가|바톤|다음\s*사람|시간\s*(?:부족|임박)|못생|대충|초보|모르겠|미안|자폭|놀림|장난)/iu;
const DISTINCTIVE_GAMEPLAY_EXCEPTIONS =
  /(?:정확(?:히|한)?\s*사과|제가\s*잘못|실수로\s*구독|세계\s*(?:최초|기록)|신기록|우승|결승|희귀\s*업적|예상\s*밖\s*버그|치명적\s*버그|(?:운영|금전|규칙|윤리|책임|사과).{0,24}(?:충돌|논쟁)|(?:충돌|논쟁).{0,24}(?:운영|금전|규칙|윤리|책임|사과)|장기\s*설정\s*회수)/iu;

/**
 * Language models tend to promote ordinary gameplay when the streamer frames
 * it dramatically. This precision-first gate keeps such moments on the score
 * timeline but prevents them from adding editor-review cards without separate
 * evidence of a rare, consequential, or social event.
 */
function isRoutineGameplayEvidence(
  broadcastSummaryKo: string,
  evidenceParts: readonly string[],
): boolean {
  const evidence = evidenceParts.join(" ");
  const wholeText = `${broadcastSummaryKo} ${evidence}`;
  return (
    GAME_BROADCAST_TERMS.test(wholeText) &&
    (ROUTINE_GAMEPLAY_TERMS.test(evidence) ||
      ROUTINE_GAME_BANTER_TERMS.test(evidence)) &&
    !DISTINCTIVE_GAMEPLAY_EXCEPTIONS.test(evidence)
  );
}

function parseCurrentCandidateAnnotations(
  value: unknown,
  request: BroadcastContextRequest,
): readonly BroadcastContextCandidateAnnotation[] | null {
  if (!Array.isArray(value)) return null;
  const requestedIds = new Set(
    request.candidates.map(({ candidateId }) => candidateId),
  );
  const byCandidateId = new Map<string, BroadcastContextCandidateAnnotation>();
  for (const annotation of value) {
    if (
      !isRecord(annotation) ||
      !hasExactKeys(annotation, [
        "candidateId",
        "category",
        "clipDecision",
        "confidence",
        "rejectionReasons",
        "contextSummaryKo",
        "whyThisMomentKo",
        "relatedCandidateIds",
        "uncertaintiesKo",
      ]) ||
      typeof annotation.candidateId !== "string" ||
      !requestedIds.has(annotation.candidateId) ||
      byCandidateId.has(annotation.candidateId) ||
      typeof annotation.category !== "string" ||
      !isValidCategory(annotation.category) ||
      typeof annotation.clipDecision !== "string" ||
      !isValidClipDecision(annotation.clipDecision) ||
      typeof annotation.confidence !== "number" ||
      !Number.isFinite(annotation.confidence) ||
      annotation.confidence < 0 ||
      annotation.confidence > 1 ||
      !isStringArray(annotation.rejectionReasons) ||
      !annotation.rejectionReasons.every(isValidRejectionReason) ||
      (annotation.clipDecision === "reject" &&
        annotation.rejectionReasons.length === 0) ||
      (annotation.clipDecision === "select" &&
        annotation.rejectionReasons.length > 0) ||
      typeof annotation.contextSummaryKo !== "string" ||
      typeof annotation.whyThisMomentKo !== "string" ||
      !isStringArray(annotation.relatedCandidateIds) ||
      !isStringArray(annotation.uncertaintiesKo)
    ) {
      return null;
    }
    byCandidateId.set(annotation.candidateId, {
      candidateId: annotation.candidateId,
      category: annotation.category,
      clipDecision: annotation.clipDecision,
      confidence: annotation.confidence,
      rejectionReasons: annotation.rejectionReasons,
      contextSummaryKo: annotation.contextSummaryKo,
      whyThisMomentKo: annotation.whyThisMomentKo,
      relatedCandidateIds: annotation.relatedCandidateIds,
      uncertaintiesKo: annotation.uncertaintiesKo,
    });
  }
  if (byCandidateId.size !== requestedIds.size) return null;
  return request.candidates.map(
    ({ candidateId }) => byCandidateId.get(candidateId)!,
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!isRecord(value)) return value;
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  };
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

/**
 * Validates the normalized current result returned by the proxy. Raw model
 * output and normalized proxy output are deliberately separate contracts:
 * this path recomputes every range, coverage value, and grounded host field.
 */
export function parseCurrentBroadcastContextResult(
  value: unknown,
  request: BroadcastContextRequest,
): BroadcastContextResult | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "broadcastSummaryKo",
      "hostStreamerProfile",
      "recurringThemesKo",
      "annotations",
      "semanticChaptersSupported",
      "semanticChapters",
      "discoveredLeadsSupported",
      "discoveredLeads",
      "coverage",
    ]) ||
    value.schemaVersion !== BROADCAST_CONTEXT_SCHEMA_VERSION ||
    typeof value.broadcastSummaryKo !== "string" ||
    !isStringArray(value.recurringThemesKo) ||
    typeof value.semanticChaptersSupported !== "boolean" ||
    !Array.isArray(value.semanticChapters) ||
    typeof value.discoveredLeadsSupported !== "boolean" ||
    !Array.isArray(value.discoveredLeads)
  ) {
    return null;
  }

  let hostStreamerProfile: BroadcastContextHostStreamerProfile | null = null;
  if (value.hostStreamerProfile !== null) {
    const parsedHost = parseHostStreamerProfile(
      value.hostStreamerProfile,
      false,
    );
    if (parsedHost === null) return null;
    hostStreamerProfile = groundHostStreamerProfile(parsedHost, request);
    if (
      hostStreamerProfile === null ||
      !sameJson(hostStreamerProfile, parsedHost)
    ) {
      return null;
    }
  }

  const annotations = parseCurrentCandidateAnnotations(
    value.annotations,
    request,
  );
  if (annotations === null) return null;

  const coverage = calculateCoverage(
    request.chapters,
    request.sourceDurationMs,
  );
  if (
    !isRecord(value.coverage) ||
    !hasExactKeys(value.coverage, [
      "status",
      "coveredMs",
      "coverageRatio",
      "gaps",
      "partialChapterIds",
    ]) ||
    (value.coverage.status !== "complete" &&
      value.coverage.status !== "partial") ||
    typeof value.coverage.coveredMs !== "number" ||
    !Number.isFinite(value.coverage.coveredMs) ||
    typeof value.coverage.coverageRatio !== "number" ||
    !Number.isFinite(value.coverage.coverageRatio) ||
    !Array.isArray(value.coverage.gaps) ||
    !isStringArray(value.coverage.partialChapterIds)
  ) {
    return null;
  }
  const providedCoverage = {
    status: value.coverage.status,
    coveredMs: value.coverage.coveredMs,
    coverageRatio: value.coverage.coverageRatio,
    gaps: value.coverage.gaps.map((gap) =>
      isRecord(gap) &&
      hasExactKeys(gap, ["startMs", "endMs"]) &&
      typeof gap.startMs === "number" &&
      Number.isFinite(gap.startMs) &&
      typeof gap.endMs === "number"
      && Number.isFinite(gap.endMs)
        ? { startMs: gap.startMs, endMs: gap.endMs }
        : null,
    ),
    partialChapterIds: value.coverage.partialChapterIds,
  };
  if (
    providedCoverage.gaps.some((gap) => gap === null) ||
    !sameJson(coverage, providedCoverage)
  ) {
    return null;
  }

  let semanticChapters: readonly BroadcastContextSemanticChapter[] = [];
  if (value.semanticChaptersSupported) {
    const references: BroadcastContextSemanticChapterReference[] = [];
    const providedSemanticChapters: BroadcastContextSemanticChapter[] = [];
    for (const chapter of value.semanticChapters) {
      if (
        !isRecord(chapter) ||
        !hasExactKeys(chapter, [
          "semanticChapterId",
          "startMs",
          "endMs",
          "startChapterId",
          "endChapterId",
          "titleKo",
          "summaryKo",
          "kind",
          "salience",
          "relatedCandidateIds",
          "uncertaintiesKo",
        ]) ||
        typeof chapter.semanticChapterId !== "string" ||
        typeof chapter.startMs !== "number" ||
        !Number.isFinite(chapter.startMs) ||
        typeof chapter.endMs !== "number" ||
        !Number.isFinite(chapter.endMs) ||
        typeof chapter.startChapterId !== "string" ||
        typeof chapter.endChapterId !== "string" ||
        typeof chapter.titleKo !== "string" ||
        typeof chapter.summaryKo !== "string" ||
        typeof chapter.kind !== "string" ||
        !isValidSemanticKind(chapter.kind) ||
        typeof chapter.salience !== "string" ||
        !isValidSemanticSalience(chapter.salience) ||
        !isStringArray(chapter.relatedCandidateIds) ||
        !isStringArray(chapter.uncertaintiesKo)
      ) {
        return null;
      }
      references.push({
        startChapterId: chapter.startChapterId,
        endChapterId: chapter.endChapterId,
        titleKo: chapter.titleKo,
        summaryKo: chapter.summaryKo,
        kind: chapter.kind as BroadcastContextSemanticChapterKind,
        salience:
          chapter.salience as BroadcastContextSemanticChapterSalience,
        relatedCandidateIds: chapter.relatedCandidateIds,
        uncertaintiesKo: chapter.uncertaintiesKo,
      });
      providedSemanticChapters.push({
        semanticChapterId: chapter.semanticChapterId,
        startMs: chapter.startMs,
        endMs: chapter.endMs,
        startChapterId: chapter.startChapterId,
        endChapterId: chapter.endChapterId,
        titleKo: chapter.titleKo,
        summaryKo: chapter.summaryKo,
        kind: chapter.kind as BroadcastContextSemanticChapterKind,
        salience:
          chapter.salience as BroadcastContextSemanticChapterSalience,
        relatedCandidateIds: chapter.relatedCandidateIds,
        uncertaintiesKo: chapter.uncertaintiesKo,
      });
    }
    try {
      semanticChapters = normalizeSemanticChapters(
        references,
        request.chapters,
        coverage.gaps,
      );
    } catch {
      return null;
    }
    if (!sameJson(semanticChapters, providedSemanticChapters)) return null;
  } else if (value.semanticChapters.length > 0) {
    return null;
  }

  let discoveredLeads: readonly BroadcastContextDiscoveredLead[] = [];
  if (value.discoveredLeadsSupported) {
    const references: BroadcastContextDiscoveredLeadReference[] = [];
    const providedDiscoveredLeads: BroadcastContextDiscoveredLead[] = [];
    for (const lead of value.discoveredLeads) {
      if (
        !isRecord(lead) ||
        !hasExactKeys(lead, [
          "leadId",
          "startMs",
          "endMs",
          "startChapterId",
          "endChapterId",
          "category",
          "confidence",
          "eventSummaryKo",
          "whyThisMomentKo",
          "evidenceCueKo",
          "uncertaintiesKo",
        ]) ||
        typeof lead.leadId !== "string" ||
        typeof lead.startMs !== "number" ||
        !Number.isFinite(lead.startMs) ||
        typeof lead.endMs !== "number" ||
        !Number.isFinite(lead.endMs) ||
        typeof lead.startChapterId !== "string" ||
        typeof lead.endChapterId !== "string" ||
        typeof lead.category !== "string" ||
        !isValidDiscoveredLeadCategory(lead.category) ||
        typeof lead.confidence !== "number" ||
        !Number.isFinite(lead.confidence) ||
        lead.confidence < 0 ||
        lead.confidence > 1 ||
        typeof lead.eventSummaryKo !== "string" ||
        typeof lead.whyThisMomentKo !== "string" ||
        typeof lead.evidenceCueKo !== "string" ||
        !isStringArray(lead.uncertaintiesKo)
      ) {
        return null;
      }
      references.push({
        leadId: lead.leadId,
        startChapterId: lead.startChapterId,
        endChapterId: lead.endChapterId,
        category: lead.category,
        confidence: lead.confidence,
        eventSummaryKo: lead.eventSummaryKo,
        whyThisMomentKo: lead.whyThisMomentKo,
        evidenceCueKo: lead.evidenceCueKo,
        uncertaintiesKo: lead.uncertaintiesKo,
      });
      providedDiscoveredLeads.push({
        leadId: lead.leadId,
        startMs: lead.startMs,
        endMs: lead.endMs,
        startChapterId: lead.startChapterId,
        endChapterId: lead.endChapterId,
        category: lead.category,
        confidence: lead.confidence,
        eventSummaryKo: lead.eventSummaryKo,
        whyThisMomentKo: lead.whyThisMomentKo,
        evidenceCueKo: lead.evidenceCueKo,
        uncertaintiesKo: lead.uncertaintiesKo,
      });
    }
    try {
      discoveredLeads = normalizeDiscoveredLeads(
        references,
        request.chapters,
      );
    } catch {
      return null;
    }
    if (!sameJson(discoveredLeads, providedDiscoveredLeads)) return null;
  } else if (value.discoveredLeads.length > 0) {
    return null;
  }

  return {
    schemaVersion: BROADCAST_CONTEXT_SCHEMA_VERSION,
    broadcastSummaryKo: value.broadcastSummaryKo,
    hostStreamerProfile,
    recurringThemesKo: value.recurringThemesKo,
    annotations,
    semanticChaptersSupported: value.semanticChaptersSupported,
    semanticChapters,
    discoveredLeadsSupported: value.discoveredLeadsSupported,
    discoveredLeads,
    coverage,
  };
}

export function extractBroadcastContextDeepseekResponse(
  payload: unknown,
  request: BroadcastContextRequest,
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

  parsed = replaceUnexpectedHan(parsed, request.outputLanguage);

  if (
    !isRecord(parsed) ||
    !hasExactKeys(parsed, [
      "broadcastSummaryKo",
      "hostStreamerProfile",
      "recurringThemesKo",
      "annotations",
      "semanticChapters",
      "discoveredLeads",
    ]) ||
    typeof parsed.broadcastSummaryKo !== "string"
  ) {
    return { ok: false };
  }
  const parsedHostStreamerProfile = parseHostStreamerProfile(
    parsed.hostStreamerProfile,
    false,
  );
  if (
    parsedHostStreamerProfile === null ||
    !isStringArray(parsed.recurringThemesKo) ||
    !Array.isArray(parsed.annotations) ||
    !Array.isArray(parsed.semanticChapters) ||
    !Array.isArray(parsed.discoveredLeads)
  ) {
    return { ok: false };
  }
  const hostStreamerProfile = groundHostStreamerProfile(
    parsedHostStreamerProfile,
    request,
  );
  const recurringThemesKo = parsed.recurringThemesKo;
  const annotations = parseCurrentCandidateAnnotations(
    parsed.annotations,
    request,
  );
  if (annotations === null) return { ok: false };

  const rawSemanticChapters: BroadcastContextSemanticChapterReference[] = [];
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
      return { ok: false };
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

  const coverage = calculateCoverage(request.chapters, request.sourceDurationMs);
  let semanticChapters: readonly BroadcastContextSemanticChapter[];
  try {
    semanticChapters = normalizeSemanticChapters(rawSemanticChapters, request.chapters, coverage.gaps);
  } catch {
    return { ok: false };
  }

  const rawDiscoveredLeads: BroadcastContextDiscoveredLeadReference[] = [];
  for (const lead of parsed.discoveredLeads) {
    if (
      !isRecord(lead) ||
      typeof lead.leadId !== "string" ||
      typeof lead.startChapterId !== "string" ||
      typeof lead.endChapterId !== "string" ||
      typeof lead.category !== "string" ||
      !isValidDiscoveredLeadCategory(lead.category) ||
      typeof lead.confidence !== "number" ||
      !Number.isFinite(lead.confidence) ||
      lead.confidence < 0 ||
      lead.confidence > 1 ||
      typeof lead.eventSummaryKo !== "string" ||
      typeof lead.whyThisMomentKo !== "string" ||
      typeof lead.evidenceCueKo !== "string" ||
      !isStringArray(lead.uncertaintiesKo)
    ) {
      return { ok: false };
    }
    rawDiscoveredLeads.push({
      leadId: lead.leadId,
      startChapterId: lead.startChapterId,
      endChapterId: lead.endChapterId,
      category: lead.category,
      confidence: lead.confidence,
      eventSummaryKo: lead.eventSummaryKo,
      whyThisMomentKo: lead.whyThisMomentKo,
      evidenceCueKo: lead.evidenceCueKo,
      uncertaintiesKo: lead.uncertaintiesKo,
    });
  }
  let discoveredLeads: readonly BroadcastContextDiscoveredLead[];
  try {
    discoveredLeads = normalizeDiscoveredLeads(
      rawDiscoveredLeads,
      request.chapters,
    );
  } catch {
    return { ok: false };
  }

  return {
    ok: true,
    result: {
      schemaVersion: BROADCAST_CONTEXT_SCHEMA_VERSION,
      broadcastSummaryKo: parsed.broadcastSummaryKo,
      hostStreamerProfile,
      recurringThemesKo,
      annotations,
      semanticChaptersSupported: true,
      semanticChapters,
      discoveredLeadsSupported: true,
      discoveredLeads,
      coverage,
    },
  };
}
