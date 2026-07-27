import {
  CANDIDATE_PASS_B_CONTEXT_SCHEMA_VERSION,
  MAX_CANDIDATE_PASS_B_CONTEXT_TEXT_LENGTH,
  type CandidatePassBContextPacket,
} from "./candidatePassBWorkerProtocol";

export const CANDIDATE_PASS_B_CANONICAL_CONTEXT_UTF8_BUDGET = 48 * 1024;
export const CANDIDATE_PASS_B_CONTEXT_OMISSION_MARKER =
  " ... [중간 생략 / middle omitted] ... ";

export type CandidatePassBContextPacketInput = Omit<
  CandidatePassBContextPacket,
  "schemaVersion"
>;

type CandidatePassBContextTextKey =
  | "transcriptKo"
  | "beforeContextKo"
  | "afterContextKo"
  | "broadcastSummaryKo"
  | "topicContextKo"
  | "fastEvidenceKo"
  | "contextVerdictKo"
  | "chatReactionKo";

interface WeightedContextField {
  readonly key: Exclude<CandidatePassBContextTextKey, "transcriptKo">;
  readonly weight: number;
}

const WEIGHTED_CONTEXT_FIELDS = Object.freeze([
  { key: "broadcastSummaryKo", weight: 8 },
  { key: "topicContextKo", weight: 7 },
  { key: "beforeContextKo", weight: 6 },
  { key: "afterContextKo", weight: 6 },
  { key: "fastEvidenceKo", weight: 5 },
  { key: "contextVerdictKo", weight: 5 },
  { key: "chatReactionKo", weight: 3 },
] satisfies readonly WeightedContextField[]);

const MINIMUM_COMPACTED_FIELD_UTF8_BYTES = 256;
const UTF8_ENCODER = new TextEncoder();

function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
}

function normalizedContextText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function compactCodePointsHeadAndTail(
  value: string,
  maximumCodePoints: number,
): string {
  const codePoints = Array.from(value);
  if (codePoints.length <= maximumCodePoints) return value;
  const marker = Array.from(CANDIDATE_PASS_B_CONTEXT_OMISSION_MARKER);
  const contentLength = maximumCodePoints - marker.length;
  const prefixLength = Math.ceil(contentLength * 2 / 3);
  const suffixLength = contentLength - prefixLength;
  return [
    ...codePoints.slice(0, prefixLength),
    ...marker,
    ...codePoints.slice(codePoints.length - suffixLength),
  ].join("");
}

function utf8Prefix(value: string, maximumBytes: number): string {
  const result: string[] = [];
  let usedBytes = 0;
  for (const character of value) {
    const characterBytes = utf8ByteLength(character);
    if (usedBytes + characterBytes > maximumBytes) break;
    result.push(character);
    usedBytes += characterBytes;
  }
  return result.join("");
}

function utf8Suffix(value: string, maximumBytes: number): string {
  const result: string[] = [];
  let usedBytes = 0;
  const characters = Array.from(value);
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const character = characters[index]!;
    const characterBytes = utf8ByteLength(character);
    if (usedBytes + characterBytes > maximumBytes) break;
    result.push(character);
    usedBytes += characterBytes;
  }
  return result.reverse().join("");
}

function compactUtf8HeadAndTail(value: string, maximumBytes: number): string {
  if (utf8ByteLength(value) <= maximumBytes) return value;
  const markerBytes = utf8ByteLength(CANDIDATE_PASS_B_CONTEXT_OMISSION_MARKER);
  const contentBudget = maximumBytes - markerBytes;
  const prefixBudget = Math.ceil(contentBudget * 2 / 3);
  const suffixBudget = contentBudget - prefixBudget;
  return `${utf8Prefix(value, prefixBudget)}${
    CANDIDATE_PASS_B_CONTEXT_OMISSION_MARKER
  }${utf8Suffix(value, suffixBudget)}`;
}

function allocateWeightedFieldBytes(
  values: Readonly<Record<CandidatePassBContextTextKey, string | null>>,
): Readonly<Record<Exclude<CandidatePassBContextTextKey, "transcriptKo">, number>> {
  const allocations = Object.fromEntries(
    WEIGHTED_CONTEXT_FIELDS.map(({ key }) => [key, 0]),
  ) as Record<
    Exclude<CandidatePassBContextTextKey, "transcriptKo">,
    number
  >;
  const lengths = Object.fromEntries(
    WEIGHTED_CONTEXT_FIELDS.map(({ key }) => [
      key,
      utf8ByteLength(values[key] ?? ""),
    ]),
  ) as Record<
    Exclude<CandidatePassBContextTextKey, "transcriptKo">,
    number
  >;
  let remainingBytes =
    CANDIDATE_PASS_B_CANONICAL_CONTEXT_UTF8_BUDGET -
    utf8ByteLength(values.transcriptKo ?? "");

  for (const { key } of WEIGHTED_CONTEXT_FIELDS) {
    const floorBytes = Math.min(
      lengths[key],
      MINIMUM_COMPACTED_FIELD_UTF8_BYTES,
    );
    allocations[key] = floorBytes;
    remainingBytes -= floorBytes;
  }

  while (remainingBytes > 0) {
    const active = WEIGHTED_CONTEXT_FIELDS.filter(
      ({ key }) => allocations[key] < lengths[key],
    );
    if (active.length === 0) break;
    const roundBudget = remainingBytes;
    const totalWeight = active.reduce((sum, { weight }) => sum + weight, 0);
    let distributedBytes = 0;
    for (const { key, weight } of active) {
      if (remainingBytes === 0) break;
      const requestedBytes = Math.max(
        1,
        Math.floor(roundBudget * weight / totalWeight),
      );
      const grantedBytes = Math.min(
        requestedBytes,
        lengths[key] - allocations[key],
        remainingBytes,
      );
      allocations[key] += grantedBytes;
      remainingBytes -= grantedBytes;
      distributedBytes += grantedBytes;
    }
    if (distributedBytes === 0) break;
  }
  return allocations;
}

function normalizedInputText(
  input: CandidatePassBContextPacketInput,
): Readonly<Record<CandidatePassBContextTextKey, string | null>> {
  return {
    transcriptKo: compactCodePointsHeadAndTail(
      normalizedContextText(input.transcriptKo),
      MAX_CANDIDATE_PASS_B_CONTEXT_TEXT_LENGTH,
    ),
    beforeContextKo: compactCodePointsHeadAndTail(
      normalizedContextText(input.beforeContextKo),
      MAX_CANDIDATE_PASS_B_CONTEXT_TEXT_LENGTH,
    ),
    afterContextKo: compactCodePointsHeadAndTail(
      normalizedContextText(input.afterContextKo),
      MAX_CANDIDATE_PASS_B_CONTEXT_TEXT_LENGTH,
    ),
    broadcastSummaryKo: compactCodePointsHeadAndTail(
      normalizedContextText(input.broadcastSummaryKo),
      MAX_CANDIDATE_PASS_B_CONTEXT_TEXT_LENGTH,
    ),
    topicContextKo: compactCodePointsHeadAndTail(
      normalizedContextText(input.topicContextKo),
      MAX_CANDIDATE_PASS_B_CONTEXT_TEXT_LENGTH,
    ),
    fastEvidenceKo: compactCodePointsHeadAndTail(
      normalizedContextText(input.fastEvidenceKo),
      MAX_CANDIDATE_PASS_B_CONTEXT_TEXT_LENGTH,
    ),
    contextVerdictKo: compactCodePointsHeadAndTail(
      normalizedContextText(input.contextVerdictKo),
      MAX_CANDIDATE_PASS_B_CONTEXT_TEXT_LENGTH,
    ),
    chatReactionKo: input.chatReactionKo === null
      ? null
      : compactCodePointsHeadAndTail(
          normalizedContextText(input.chatReactionKo),
          MAX_CANDIDATE_PASS_B_CONTEXT_TEXT_LENGTH,
        ),
  };
}

/**
 * Creates the candidate-specific canonical context consumed by fingerprinting
 * and AI analysis. The full broadcast/session inputs are never mutated.
 *
 * Candidate dialogue stays exact through the aggregate byte pass. Every other
 * field shares the remaining budget deterministically and carries an explicit
 * bilingual marker whenever middle content is omitted.
 */
export function createCanonicalCandidatePassBContextPacket(
  input: CandidatePassBContextPacketInput,
): CandidatePassBContextPacket | null {
  const normalized = normalizedInputText(input);
  const required = [
    normalized.transcriptKo,
    normalized.beforeContextKo,
    normalized.afterContextKo,
    normalized.broadcastSummaryKo,
    normalized.topicContextKo,
    normalized.fastEvidenceKo,
    normalized.contextVerdictKo,
  ];
  if (
    required.some((value) => value === null || value.length === 0) ||
    (input.chatReactionKo !== null &&
      (normalized.chatReactionKo === null ||
        normalized.chatReactionKo.length === 0))
  ) {
    return null;
  }

  const allocations = allocateWeightedFieldBytes(normalized);
  return {
    schemaVersion: CANDIDATE_PASS_B_CONTEXT_SCHEMA_VERSION,
    transcriptSource: input.transcriptSource,
    transcriptKo: normalized.transcriptKo!,
    beforeContextKo: compactUtf8HeadAndTail(
      normalized.beforeContextKo!,
      allocations.beforeContextKo,
    ),
    afterContextKo: compactUtf8HeadAndTail(
      normalized.afterContextKo!,
      allocations.afterContextKo,
    ),
    broadcastSummaryKo: compactUtf8HeadAndTail(
      normalized.broadcastSummaryKo!,
      allocations.broadcastSummaryKo,
    ),
    topicContextKo: compactUtf8HeadAndTail(
      normalized.topicContextKo!,
      allocations.topicContextKo,
    ),
    fastEvidenceKo: compactUtf8HeadAndTail(
      normalized.fastEvidenceKo!,
      allocations.fastEvidenceKo,
    ),
    contextDecision: input.contextDecision,
    contextCategory: input.contextCategory,
    contextVerdictKo: compactUtf8HeadAndTail(
      normalized.contextVerdictKo!,
      allocations.contextVerdictKo,
    ),
    chatReactionKo: normalized.chatReactionKo === null
      ? null
      : compactUtf8HeadAndTail(
          normalized.chatReactionKo,
          allocations.chatReactionKo,
        ),
  };
}

export function canonicalizeCandidatePassBContextPacket(
  context: CandidatePassBContextPacket,
): CandidatePassBContextPacket {
  const canonical = createCanonicalCandidatePassBContextPacket({
    transcriptSource: context.transcriptSource,
    transcriptKo: context.transcriptKo,
    beforeContextKo: context.beforeContextKo,
    afterContextKo: context.afterContextKo,
    broadcastSummaryKo: context.broadcastSummaryKo,
    topicContextKo: context.topicContextKo,
    fastEvidenceKo: context.fastEvidenceKo,
    contextDecision: context.contextDecision,
    contextCategory: context.contextCategory,
    contextVerdictKo: context.contextVerdictKo,
    chatReactionKo: context.chatReactionKo,
  });
  if (
    canonical === null ||
    canonical.schemaVersion !== CANDIDATE_PASS_B_CONTEXT_SCHEMA_VERSION
  ) {
    throw new RangeError("Invalid candidate context packet.");
  }
  return canonical;
}
