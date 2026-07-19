import type { NormalizedChatMessage } from "./chatImport";

export interface HighlightSelectionOptions {
  readonly sourceDurationMs: number;
  readonly chatOffsetMs?: number;
  readonly maxCandidates?: number;
  readonly candidateWindowMs?: number;
  readonly outOfRangeMode?: "exclude" | "clamp";
}

export interface ChatHighlightEvidence {
  readonly bucketStartMs: number;
  readonly bucketEndMs: number;
  readonly messageCount: number;
  readonly uniqueAuthorCount: number;
  readonly reactionMessageCount: number;
  readonly baselineMessageCount: number;
  readonly baselineUniqueAuthorCount: number;
  readonly burstRatio: number;
  readonly robustBurstScore: number;
  readonly repetitionRatio: number;
  readonly singleAuthorRatio: number;
  readonly spamPenalty: number;
}

export interface ChatHighlightCandidate {
  readonly id: string;
  readonly peakMs: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly score: number;
  readonly reason: string;
  readonly evidence: ChatHighlightEvidence;
}

export interface HighlightSelectionResult {
  readonly mode: "chat-signals-only";
  readonly candidates: readonly ChatHighlightCandidate[];
  readonly analyzedMessageCount: number;
  readonly invalidMessageCount: number;
  readonly clampedMessageCount: number;
  readonly outOfRangeMessageCount: number;
  readonly bucketCount: number;
  readonly bucketSizeMs: 5000;
}

interface MutableBucket {
  messageCount: number;
  reactionMessageCount: number;
  readonly authors: Set<string>;
  readonly authorCounts: Map<string, number>;
  readonly normalizedTextCounts: Map<string, number>;
}

interface ScoredBucket {
  readonly bucketIndex: number;
  readonly score: number;
  readonly evidence: ChatHighlightEvidence;
  readonly eligible: boolean;
}

const BUCKET_SIZE_MS = 5000 as const;
const DEFAULT_CANDIDATE_WINDOW_MS = 45_000;
const DEFAULT_MAX_CANDIDATES = 12;
const BASELINE_BUCKET_LIMIT = 60;
const MIN_BASELINE_BUCKETS = 4;

const REACTION_PATTERN =
  /(?:ㅋ{2,}|ㅎ{2,}|ㄷㄷ|와{1,}|우와|대박|레전드|미쳤|미친|헐|뭐야|실화|나이스|개웃|웃겨|!{2,}|\?{2,})/iu;

export function selectChatHighlights(
  messages: readonly NormalizedChatMessage[],
  options: HighlightSelectionOptions,
): HighlightSelectionResult {
  const durationMs = finiteNonNegativeInteger(options.sourceDurationMs);
  if (durationMs <= 0) {
    return emptyResult(0);
  }

  const bucketCount = Math.max(1, Math.ceil(durationMs / BUCKET_SIZE_MS));
  const buckets = Array.from({ length: bucketCount }, createBucket);
  const offsetMs = Number.isFinite(options.chatOffsetMs) ? Math.round(options.chatOffsetMs ?? 0) : 0;
  const lastTimelineMs = Math.max(0, durationMs - 1);
  let analyzedMessageCount = 0;
  let invalidMessageCount = 0;
  let clampedMessageCount = 0;
  let outOfRangeMessageCount = 0;

  for (const message of messages) {
    if (!Number.isFinite(message.timestampMs) || typeof message.text !== "string") {
      invalidMessageCount += 1;
      continue;
    }
    const adjustedTimestamp = Math.round(message.timestampMs) + offsetMs;
    if (adjustedTimestamp < 0 || adjustedTimestamp > lastTimelineMs) {
      outOfRangeMessageCount += 1;
      if ((options.outOfRangeMode ?? "exclude") === "exclude") {
        continue;
      }
    }
    const timestampMs = clamp(adjustedTimestamp, 0, lastTimelineMs);
    if (timestampMs !== adjustedTimestamp) {
      clampedMessageCount += 1;
    }

    const bucketIndex = Math.min(bucketCount - 1, Math.floor(timestampMs / BUCKET_SIZE_MS));
    const bucket = buckets[bucketIndex];
    if (bucket === undefined) {
      invalidMessageCount += 1;
      continue;
    }

    bucket.messageCount += 1;
    analyzedMessageCount += 1;
    if (REACTION_PATTERN.test(message.text)) {
      bucket.reactionMessageCount += 1;
    }

    if (message.authorId !== null && message.authorId.length > 0) {
      bucket.authors.add(message.authorId);
      bucket.authorCounts.set(message.authorId, (bucket.authorCounts.get(message.authorId) ?? 0) + 1);
    }

    const normalizedText = normalizeTextForRepetition(message.text);
    if (normalizedText.length > 0) {
      bucket.normalizedTextCounts.set(
        normalizedText,
        (bucket.normalizedTextCounts.get(normalizedText) ?? 0) + 1,
      );
    }
  }

  if (analyzedMessageCount === 0) {
    return {
      ...emptyResult(bucketCount),
      invalidMessageCount,
      clampedMessageCount,
      outOfRangeMessageCount,
    };
  }

  const scoredBuckets = buckets.map((bucket, bucketIndex) =>
    scoreBucket(bucket, bucketIndex, buckets, durationMs),
  );
  const localPeaks = scoredBuckets.filter((bucket, index) => {
    if (!bucket.eligible) {
      return false;
    }
    const previousScore = scoredBuckets[index - 1]?.score ?? Number.NEGATIVE_INFINITY;
    const nextScore = scoredBuckets[index + 1]?.score ?? Number.NEGATIVE_INFINITY;
    return bucket.score > previousScore && bucket.score >= nextScore;
  });

  localPeaks.sort(compareScoredBuckets);

  const requestedWindow = finiteNonNegativeInteger(
    options.candidateWindowMs ?? DEFAULT_CANDIDATE_WINDOW_MS,
  );
  const candidateWindowMs = Math.max(BUCKET_SIZE_MS, requestedWindow);
  const maxCandidates = Math.max(
    0,
    Math.floor(
      Number.isFinite(options.maxCandidates)
        ? (options.maxCandidates ?? DEFAULT_MAX_CANDIDATES)
        : DEFAULT_MAX_CANDIDATES,
    ),
  );
  const accepted: ChatHighlightCandidate[] = [];
  const acceptedIds = new Set<string>();

  for (const peak of localPeaks) {
    if (accepted.length >= maxCandidates) {
      break;
    }
    const candidate = createCandidate(peak, durationMs, candidateWindowMs);
    if (acceptedIds.has(candidate.id) || accepted.some((item) => rangesOverlap(item, candidate))) {
      continue;
    }
    accepted.push(candidate);
    acceptedIds.add(candidate.id);
  }

  return {
    mode: "chat-signals-only",
    candidates: accepted,
    analyzedMessageCount,
    invalidMessageCount,
    clampedMessageCount,
    outOfRangeMessageCount,
    bucketCount,
    bucketSizeMs: BUCKET_SIZE_MS,
  };
}

function scoreBucket(
  bucket: Readonly<MutableBucket>,
  bucketIndex: number,
  buckets: readonly Readonly<MutableBucket>[],
  durationMs: number,
): ScoredBucket {
  const messageBaseline = baselineValues(buckets, bucketIndex, (item) => item.messageCount);
  const uniqueBaseline = baselineValues(buckets, bucketIndex, (item) => item.authors.size);
  const messageSignal = robustSignal(bucket.messageCount, messageBaseline);
  const uniqueSignal = robustSignal(bucket.authors.size, uniqueBaseline);

  const duplicateMessageCount = sumDuplicateCount(bucket.normalizedTextCounts);
  const repetitionRatio = safeRatio(duplicateMessageCount, bucket.messageCount);
  const maxAuthorCount = maxMapValue(bucket.authorCounts);
  const singleAuthorRatio = safeRatio(maxAuthorCount, bucket.messageCount);
  const spamPenalty =
    repetitionRatio * 3 +
    Math.max(0, singleAuthorRatio - 0.5) * 4 +
    (repetitionRatio >= 0.8 && singleAuthorRatio >= 0.75 ? 2 : 0);
  const reactionRatio = safeRatio(bucket.reactionMessageCount, bucket.messageCount);
  const score =
    Math.max(0, messageSignal.robustScore) * 1.1 +
    Math.max(0, uniqueSignal.robustScore) * 0.8 +
    reactionRatio * 2.25 +
    Math.log1p(bucket.messageCount) * 0.15 -
    spamPenalty;

  const hasBurst =
    bucket.messageCount >= 4 &&
    (messageSignal.robustScore >= 2.5 || messageSignal.ratio >= 2.5);
  const hasCollectiveReaction =
    bucket.authors.size >= 3 &&
    bucket.reactionMessageCount >= 2 &&
    (uniqueSignal.robustScore >= 1.5 || uniqueSignal.ratio >= 2);
  const obviousSingleSourceSpam = repetitionRatio >= 0.8 && singleAuthorRatio >= 0.75;
  const eligible =
    (hasBurst || hasCollectiveReaction) && !obviousSingleSourceSpam && score >= 2.25;
  const bucketStartMs = bucketIndex * BUCKET_SIZE_MS;

  return {
    bucketIndex,
    score: round(score, 6),
    eligible,
    evidence: {
      bucketStartMs,
      bucketEndMs: Math.min(durationMs, bucketStartMs + BUCKET_SIZE_MS),
      messageCount: bucket.messageCount,
      uniqueAuthorCount: bucket.authors.size,
      reactionMessageCount: bucket.reactionMessageCount,
      baselineMessageCount: round(messageSignal.baseline, 2),
      baselineUniqueAuthorCount: round(uniqueSignal.baseline, 2),
      burstRatio: round(messageSignal.ratio, 2),
      robustBurstScore: round(messageSignal.robustScore, 2),
      repetitionRatio: round(repetitionRatio, 3),
      singleAuthorRatio: round(singleAuthorRatio, 3),
      spamPenalty: round(spamPenalty, 3),
    },
  };
}

function baselineValues(
  buckets: readonly Readonly<MutableBucket>[],
  bucketIndex: number,
  select: (bucket: Readonly<MutableBucket>) => number,
): readonly number[] {
  const rollingStart = Math.max(0, bucketIndex - BASELINE_BUCKET_LIMIT);
  const rollingEnd = Math.max(rollingStart, bucketIndex - 1);
  const rolling = buckets.slice(rollingStart, rollingEnd).map(select);
  if (rolling.length >= MIN_BASELINE_BUCKETS) {
    return rolling;
  }

  const fallback = buckets
    .map((bucket, index) => ({ index, value: select(bucket) }))
    .filter(({ index }) => Math.abs(index - bucketIndex) > 1)
    .map(({ value }) => value);
  return fallback.length > 0 ? fallback : rolling;
}

function robustSignal(
  current: number,
  samples: readonly number[],
): { readonly baseline: number; readonly robustScore: number; readonly ratio: number } {
  if (samples.length === 0) {
    return { baseline: 0, robustScore: 0, ratio: 1 };
  }
  const baseline = median(samples);
  const absoluteDeviations = samples.map((value) => Math.abs(value - baseline));
  const mad = median(absoluteDeviations);
  const scale = Math.max(1, 1.4826 * mad);
  return {
    baseline,
    robustScore: clamp((current - baseline) / scale, -3, 8),
    ratio: (current + 1) / (baseline + 1),
  };
}

function createCandidate(
  peak: ScoredBucket,
  durationMs: number,
  windowMs: number,
): ChatHighlightCandidate {
  const bucketCenterMs = Math.min(
    durationMs,
    peak.evidence.bucketStartMs + Math.floor(BUCKET_SIZE_MS / 2),
  );
  const beforeMs = Math.round((windowMs * 4) / 9);
  const effectiveWindowMs = Math.min(windowMs, durationMs);
  const latestStartMs = Math.max(0, durationMs - effectiveWindowMs);
  const startMs = clamp(bucketCenterMs - beforeMs, 0, latestStartMs);
  const endMs = startMs + effectiveWindowMs;
  const id = `chat-${peak.evidence.bucketStartMs}-${startMs}-${endMs}`;
  const evidence = peak.evidence;
  const reasonParts = [
    `5초 동안 채팅 ${evidence.messageCount}개`,
    `평소보다 ${evidence.burstRatio.toFixed(1)}배`,
  ];
  if (evidence.uniqueAuthorCount > 0) {
    reasonParts.push(`서로 다른 작성자 표기 ${evidence.uniqueAuthorCount}개`);
  }
  if (evidence.reactionMessageCount > 0) {
    reasonParts.push(`반응 표현 ${evidence.reactionMessageCount}개`);
  }

  return {
    id,
    peakMs: bucketCenterMs,
    startMs,
    endMs,
    score: peak.score,
    reason: `${reasonParts.join(" · ")}가 모여 채팅 반응 신호로 검토 후보를 골랐어요.`,
    evidence,
  };
}

function createBucket(): MutableBucket {
  return {
    messageCount: 0,
    reactionMessageCount: 0,
    authors: new Set<string>(),
    authorCounts: new Map<string, number>(),
    normalizedTextCounts: new Map<string, number>(),
  };
}

function emptyResult(bucketCount: number): HighlightSelectionResult {
  return {
    mode: "chat-signals-only",
    candidates: [],
    analyzedMessageCount: 0,
    invalidMessageCount: 0,
    clampedMessageCount: 0,
    outOfRangeMessageCount: 0,
    bucketCount,
    bucketSizeMs: BUCKET_SIZE_MS,
  };
}

function compareScoredBuckets(left: ScoredBucket, right: ScoredBucket): number {
  return right.score - left.score || left.bucketIndex - right.bucketIndex;
}

function rangesOverlap(
  left: Pick<ChatHighlightCandidate, "startMs" | "endMs">,
  right: Pick<ChatHighlightCandidate, "startMs" | "endMs">,
): boolean {
  return Math.max(left.startMs, right.startMs) < Math.min(left.endMs, right.endMs);
}

function normalizeTextForRepetition(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, "")
    .replace(/(.)\1{2,}/gu, "$1$1")
    .slice(0, 160);
}

function sumDuplicateCount(counts: ReadonlyMap<string, number>): number {
  let duplicateCount = 0;
  for (const count of counts.values()) {
    duplicateCount += Math.max(0, count - 1);
  }
  return duplicateCount;
}

function maxMapValue(values: ReadonlyMap<string, number>): number {
  let maximum = 0;
  for (const value of values.values()) {
    maximum = Math.max(maximum, value);
  }
  return maximum;
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) {
    return upper;
  }
  return ((sorted[middle - 1] ?? upper) + upper) / 2;
}

function safeRatio(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : numerator / denominator;
}

function finiteNonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
