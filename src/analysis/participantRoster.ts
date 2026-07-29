import type {
  CandidatePassBParticipantRole,
} from "./candidatePassBWorkerProtocol";

export const CANDIDATE_PASS_B_CAST_ROSTER_VERSION = "1.3.0" as const;
export const DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID =
  "chzzk-video-13996057-v2" as const;
export const LEGACY_CANDIDATE_PASS_B_CAST_ROSTER_ID =
  "chzzk-video-13996057-v1" as const;
export const AMORETTO_CHANNEL_CAST_ROSTER_ID =
  "chzzk-channel-33bc7a29b771728cf9378604973b620b-v1" as const;
export const EUREKA_CHANNEL_CAST_ROSTER_ID =
  "chzzk-channel-3d5546fc8d0dcb478c973a9bc1328980-v1" as const;
export const SENA_ARBEL_CHANNEL_CAST_ROSTER_ID =
  "chzzk-channel-8b7ccc2a6e05dd1468fb3eb6efd5b3d0-v1" as const;
export const TORORI_COCO_CHANNEL_CAST_ROSTER_ID =
  "chzzk-channel-bda7676a8ca63a4acc64167610b5bf53-v1" as const;
export const MANGJING_CHANNEL_CAST_ROSTER_ID =
  "chzzk-channel-5b1edd3b95c1513cb502ca2cdd391670-v1" as const;

export const EXCHANGE_STUDENT_MAIN_CHANNEL_ID =
  "0385e1a232e51078bad18aef8479ab22" as const;

export type CandidatePassBCastRosterId =
  | typeof DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID
  | typeof LEGACY_CANDIDATE_PASS_B_CAST_ROSTER_ID
  | typeof AMORETTO_CHANNEL_CAST_ROSTER_ID
  | typeof EUREKA_CHANNEL_CAST_ROSTER_ID
  | typeof SENA_ARBEL_CHANNEL_CAST_ROSTER_ID
  | typeof TORORI_COCO_CHANNEL_CAST_ROSTER_ID
  | typeof MANGJING_CHANNEL_CAST_ROSTER_ID;

export type CandidatePassBParticipantId =
  | "sera-professor"
  | "amoretto"
  | "eureka"
  | "sena-arbel"
  | "torori-coco"
  | "mangjing";

export interface CandidatePassBCastReference {
  readonly participantId: CandidatePassBParticipantId;
  readonly displayName: string;
  readonly role: CandidatePassBParticipantRole;
  readonly aliasesKo: readonly string[];
  readonly visualDescriptionKo: string;
  readonly referenceScopeKo: string;
}

/**
 * Closed-set references grounded from CHZZK replay 13996057. These are public
 * virtual-avatar traits, not open-world face or voice recognition. A model may
 * use them only when the supplied candidate frames show multiple distinctive
 * traits; otherwise the participant must remain unknown.
 */
const EXCHANGE_STUDENT_CAST = Object.freeze([
  {
    participantId: "sera-professor",
    displayName: "세라 교수님",
    role: "streamer",
    aliasesKo: ["세라", "교수님"],
    visualDescriptionKo:
      "검은 짧은 머리와 안경, 어두운 의상에 초록색 포인트가 함께 보이는 진행자 아바타",
    referenceScopeKo: "교환학생 메인 채널 전용 진행자",
  },
  {
    participantId: "amoretto",
    displayName: "아모레또",
    role: "guest",
    aliasesKo: ["레또"],
    visualDescriptionKo:
      "긴 은분홍색 머리와 자홍색 눈, 고양이형 귀·꼬리와 흰 상의·분홍 소매가 함께 보이는 아바타",
    referenceScopeKo: "교환학생 합방 또는 아모레또 개인 채널",
  },
  {
    participantId: "eureka",
    displayName: "유레카",
    role: "guest",
    aliasesKo: ["레카"],
    visualDescriptionKo:
      "끝부분이 초록색인 금발 단발과 초록 눈, 검은 베레모와 초록색 학원풍 의상이 함께 보이는 아바타",
    referenceScopeKo: "교환학생 합방 또는 유레카 개인 채널",
  },
  {
    participantId: "sena-arbel",
    displayName: "세나 아르벨",
    role: "guest",
    aliasesKo: ["세나"],
    visualDescriptionKo:
      "긴 은백색 머리와 보라색 눈, 분홍·파랑 리본이 달린 검은 베레모가 함께 보이는 아바타",
    referenceScopeKo: "교환학생 합방 또는 세나 아르벨 개인 채널",
  },
  {
    participantId: "torori-coco",
    displayName: "토로리 코코",
    role: "guest",
    aliasesKo: ["토로리", "코코"],
    visualDescriptionKo:
      "하늘색 짧은 단발과 파란 눈, 흰색·파란색 머리 장식과 의상이 함께 보이는 아바타",
    referenceScopeKo: "교환학생 합방 또는 토로리 코코 개인 채널",
  },
  {
    participantId: "mangjing",
    displayName: "망징이",
    role: "guest",
    aliasesKo: ["망징"],
    visualDescriptionKo:
      "옅은 은청색의 굽은 단발과 파란 눈, 짙은 남색 계열 의상이 함께 보이는 아바타",
    referenceScopeKo: "교환학생 합방 또는 망징이 개인 채널",
  },
] satisfies readonly CandidatePassBCastReference[]);

const PERSONAL_CHANNEL_ROSTERS = Object.freeze([
  {
    rosterId: AMORETTO_CHANNEL_CAST_ROSTER_ID,
    channelId: "33bc7a29b771728cf9378604973b620b",
    ownerName: "아모레또",
  },
  {
    rosterId: EUREKA_CHANNEL_CAST_ROSTER_ID,
    channelId: "3d5546fc8d0dcb478c973a9bc1328980",
    ownerName: "유레카",
  },
  {
    rosterId: SENA_ARBEL_CHANNEL_CAST_ROSTER_ID,
    channelId: "8b7ccc2a6e05dd1468fb3eb6efd5b3d0",
    ownerName: "세나 아르벨",
  },
  {
    rosterId: TORORI_COCO_CHANNEL_CAST_ROSTER_ID,
    channelId: "bda7676a8ca63a4acc64167610b5bf53",
    ownerName: "토로리 코코",
  },
  {
    rosterId: MANGJING_CHANNEL_CAST_ROSTER_ID,
    channelId: "5b1edd3b95c1513cb502ca2cdd391670",
    ownerName: "망징이",
  },
] satisfies readonly {
  readonly rosterId: CandidatePassBCastRosterId;
  readonly channelId: string;
  readonly ownerName: string;
}[]);

const CAST_ROSTER_IDS = new Set<CandidatePassBCastRosterId>([
  DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
  LEGACY_CANDIDATE_PASS_B_CAST_ROSTER_ID,
  ...PERSONAL_CHANNEL_ROSTERS.map(({ rosterId }) => rosterId),
]);

function normalizeCastName(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase("ko-KR");
}

export function isCandidatePassBCastRosterId(
  value: unknown,
): value is CandidatePassBCastRosterId {
  return typeof value === "string" && CAST_ROSTER_IDS.has(
    value as CandidatePassBCastRosterId,
  );
}

export function candidatePassBCastReferences(
  rosterId: CandidatePassBCastRosterId | null,
): readonly CandidatePassBCastReference[] {
  if (rosterId === null || !isCandidatePassBCastRosterId(rosterId)) return [];
  if (
    rosterId === DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID ||
    rosterId === LEGACY_CANDIDATE_PASS_B_CAST_ROSTER_ID
  ) {
    return EXCHANGE_STUDENT_CAST;
  }
  const ownerName = PERSONAL_CHANNEL_ROSTERS.find(
    ({ rosterId: candidateRosterId }) => candidateRosterId === rosterId,
  )?.ownerName;
  const owner = EXCHANGE_STUDENT_CAST.find(
    ({ displayName }) => displayName === ownerName,
  );
  if (owner === undefined) return [];
  return EXCHANGE_STUDENT_CAST
    .filter(({ participantId }) => participantId !== "sera-professor")
    .map((reference) => ({
      ...reference,
      role:
        reference.participantId === owner.participantId
          ? "streamer" as const
          : "guest" as const,
    }));
}

/** The product-wide six-person catalog. This is not evidence of appearance. */
export function candidatePassBKnownCastReferences(): readonly CandidatePassBCastReference[] {
  return EXCHANGE_STUDENT_CAST;
}

/** Source ownership is a routing prior, never proof that the owner is present. */
export function candidatePassBSourceHostReference(
  rosterId: CandidatePassBCastRosterId | null,
): CandidatePassBCastReference | null {
  return (
    candidatePassBCastReferences(rosterId).find(
      ({ role }) => role === "streamer",
    ) ?? null
  );
}

/** Resolves only a server-known canonical name or one of its fixed aliases. */
export function candidatePassBCastReferenceForName(
  rosterId: CandidatePassBCastRosterId | null,
  value: string,
): CandidatePassBCastReference | null {
  const normalized = normalizeCastName(value);
  if (normalized.length === 0) return null;
  return candidatePassBCastReferences(rosterId).find((reference) =>
    [reference.displayName, ...reference.aliasesKo].some(
      (name) => normalizeCastName(name) === normalized,
    ),
  ) ?? null;
}

/** Resolves a canonical name against the product-wide six-person catalog. */
export function candidatePassBKnownCastReferenceForName(
  value: string,
): CandidatePassBCastReference | null {
  const normalized = normalizeCastName(value);
  if (normalized.length === 0) return null;
  return candidatePassBKnownCastReferences().find((reference) =>
    [reference.displayName, ...reference.aliasesKo].some(
      (name) => normalizeCastName(name) === normalized,
    ),
  ) ?? null;
}

export function canonicalCandidatePassBCastDisplayName(
  rosterId: CandidatePassBCastRosterId | null,
  value: string,
): string {
  return candidatePassBCastReferenceForName(rosterId, value)?.displayName ?? value;
}

/**
 * The reviewed roster belongs to one broadcast and must never leak into an
 * unrelated source. Downloaders do not use one stable filename convention, so
 * accept either the public replay number or the distinctive reviewed title.
 */
export function candidatePassBCastRosterIdForSourceName(
  sourceName: string,
): CandidatePassBCastRosterId | null {
  if (typeof sourceName !== "string") return null;
  const normalized = sourceName.normalize("NFC").toLocaleLowerCase("ko-KR");
  const hasReplayNumber = /(?:^|\D)13996057(?:\D|$)/u.test(normalized);
  const hasExchangeStudentChannel = normalized.includes(
    EXCHANGE_STUDENT_MAIN_CHANNEL_ID,
  );
  const hasReviewedTitle =
    normalized.includes("교환학생") &&
    normalized.includes("합격생") &&
    normalized.includes("장학생");
  if (hasReplayNumber || hasReviewedTitle || hasExchangeStudentChannel) {
    return DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID;
  }
  for (const personal of PERSONAL_CHANNEL_ROSTERS) {
    if (normalized.includes(personal.channelId)) return personal.rosterId;
    const normalizedOwnerName = normalizeCastName(personal.ownerName);
    const ownerTokenPattern = new RegExp(
      `(?:^|[\\s_\\-[({])${normalizedOwnerName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:$|[\\s_\\-\\])}])`,
      "u",
    );
    if (ownerTokenPattern.test(normalized)) return personal.rosterId;
  }
  return null;
}
