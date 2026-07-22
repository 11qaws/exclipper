import type { BroadcastContextTranscriptionChunk } from "./broadcastContextSamplingPlan";

const GOLDEN_RATIO_CONJUGATE = 0.6180339887498949;

interface TimelineRange {
  readonly startMs: number;
  readonly endMs: number;
}

function rangeCenter(range: TimelineRange): number {
  return range.startMs + (range.endMs - range.startMs) / 2;
}

function createDistributedOrder<T>(
  values: readonly T[],
  rangeOf: (value: T) => TimelineRange,
): T[] {
  if (values.length <= 1) return [...values];
  const chronological = [...values].sort((left, right) => {
    const leftRange = rangeOf(left);
    const rightRange = rangeOf(right);
    return (
      leftRange.startMs - rightRange.startMs ||
      leftRange.endMs - rightRange.endMs
    );
  });
  const firstStartMs = rangeOf(chronological[0] as T).startMs;
  const lastEndMs = rangeOf(chronological.at(-1) as T).endMs;
  const spanMs = Math.max(1, lastEndMs - firstStartMs);
  const normalizedCenter = (value: T): number =>
    (rangeCenter(rangeOf(value)) - firstStartMs) / spanMs;
  const firstIndex = chronological.reduce(
    (bestIndex, value, index) =>
      Math.abs(normalizedCenter(value) - GOLDEN_RATIO_CONJUGATE) <
      Math.abs(
        normalizedCenter(chronological[bestIndex] as T) -
          GOLDEN_RATIO_CONJUGATE,
      )
        ? index
        : bestIndex,
    0,
  );
  const selectedIndexes = new Set<number>([firstIndex]);
  const result: T[] = [chronological[firstIndex] as T];

  while (result.length < chronological.length) {
    let nextIndex = -1;
    let nextDistance = -1;
    for (let index = 0; index < chronological.length; index += 1) {
      if (selectedIndexes.has(index)) continue;
      const center = normalizedCenter(chronological[index] as T);
      let nearestSelectedDistance = Number.POSITIVE_INFINITY;
      for (const selectedIndex of selectedIndexes) {
        nearestSelectedDistance = Math.min(
          nearestSelectedDistance,
          Math.abs(
            center - normalizedCenter(chronological[selectedIndex] as T),
          ),
        );
      }
      if (
        nearestSelectedDistance > nextDistance + Number.EPSILON ||
        (Math.abs(nearestSelectedDistance - nextDistance) <= Number.EPSILON &&
          (nextIndex < 0 || index < nextIndex))
      ) {
        nextIndex = index;
        nextDistance = nearestSelectedDistance;
      }
    }
    if (nextIndex < 0) break;
    selectedIndexes.add(nextIndex);
    result.push(chronological[nextIndex] as T);
  }
  return result;
}

function validateTranscriptChunks(
  chunks: readonly BroadcastContextTranscriptionChunk[],
): readonly BroadcastContextTranscriptionChunk[] {
  const ids = new Set<string>();
  const chronological = [...chunks].sort(
    (left, right) =>
      left.sourceStartMs - right.sourceStartMs ||
      left.sourceEndMs - right.sourceEndMs ||
      left.chunkId.localeCompare(right.chunkId),
  );
  let previousEndMs = -1;
  for (const chunk of chronological) {
    if (
      chunk.chunkId.length === 0 ||
      ids.has(chunk.chunkId) ||
      !Number.isSafeInteger(chunk.sourceStartMs) ||
      !Number.isSafeInteger(chunk.sourceEndMs) ||
      chunk.sourceStartMs < 0 ||
      chunk.sourceEndMs <= chunk.sourceStartMs ||
      chunk.sourceStartMs < previousEndMs
    ) {
      throw new RangeError("Broadcast transcript exploration chunks are invalid.");
    }
    ids.add(chunk.chunkId);
    previousEndMs = chunk.sourceEndMs;
  }
  return chronological;
}

/**
 * Produces a reproducible, globally scattered probe order. It feels random to
 * an editor watching the timeline, but identical input always produces the
 * same paid ASR schedule and can therefore be checkpointed safely.
 */
export function createDistributedTranscriptExplorationOrder(
  chunks: readonly BroadcastContextTranscriptionChunk[],
): readonly BroadcastContextTranscriptionChunk[] {
  const chronological = validateTranscriptChunks(chunks);
  return createDistributedOrder(chronological, (chunk) => ({
    startMs: chunk.sourceStartMs,
    endMs: chunk.sourceEndMs,
  }));
}

/** Creates the same scattered reveal order for already-computed topic ranges. */
export function createDistributedTimelineRevealOrder<
  T extends { readonly startMs: number; readonly endMs: number },
>(ranges: readonly T[]): readonly T[] {
  for (const range of ranges) {
    if (
      !Number.isSafeInteger(range.startMs) ||
      !Number.isSafeInteger(range.endMs) ||
      range.startMs < 0 ||
      range.endMs <= range.startMs
    ) {
      throw new RangeError("Timeline reveal range is invalid.");
    }
  }
  return createDistributedOrder(ranges, (range) => range);
}

const CONTEXT_EVENT_PATTERN =
  /(?:갑자기|결국|드디어|성공|실패|됐다|안\s*돼|왜|어떻게|뭐야|잠깐|헐|대박|미안|죄송|사과|실수|놀라|웃|울|화나|이겼|졌|잡았|죽었|살았|찾았|발견|반전|문제|사건|because|suddenly|finally|sorry|won|lost|found|what|why|how)/iu;
const CONTEXT_LINK_PATTERN =
  /(?:그래서|그런데|근데|하지만|왜냐하면|그러다가|그다음|이후|전에|때문에|사실은|알고\s*보니|즉|반면|결과|결국|then|but|however|therefore|after|before|because)/iu;
const NON_NEUTRAL_EMOTION_PATTERN =
  /(?:excited|happy|joy|surprise|surprised|sad|angry|fear|laugh|cry|흥분|기쁨|놀람|슬픔|화남|웃음|울음)/iu;

/**
 * Conservative semantic seed test used only to reprioritize already-planned
 * neighboring chunks. It never creates more requests or promotes a clip by
 * itself.
 */
export function shouldExpandBroadcastContextChunk(input: {
  readonly textKo: string;
  readonly emotion: string | null;
}): boolean {
  const text = input.textKo.replace(/\s+/gu, " ").trim();
  if (text.length < 18) return false;
  let signals = 0;
  if (/[?!？！]/u.test(text)) signals += 1;
  if (CONTEXT_EVENT_PATTERN.test(text)) signals += 1;
  if (CONTEXT_LINK_PATTERN.test(text)) signals += 1;
  if (
    input.emotion !== null &&
    NON_NEUTRAL_EMOTION_PATTERN.test(input.emotion)
  ) {
    signals += 1;
  }
  return signals >= 2;
}

/**
 * Pulls chronological neighbors toward the front after a semantic seed while
 * keeping one global probe between local expansions so breadth is preserved.
 */
export function prioritizeAdjacentTranscriptChunks(
  pending: readonly BroadcastContextTranscriptionChunk[],
  allChunks: readonly BroadcastContextTranscriptionChunk[],
  currentChunkId: string,
  maximumNeighbors = 2,
): readonly BroadcastContextTranscriptionChunk[] {
  if (!Number.isSafeInteger(maximumNeighbors) || maximumNeighbors < 0) {
    throw new RangeError("Maximum transcript neighbors must be a non-negative integer.");
  }
  if (pending.length === 0 || maximumNeighbors === 0) return [...pending];
  const chronological = validateTranscriptChunks(allChunks);
  const currentIndex = chronological.findIndex(
    (chunk) => chunk.chunkId === currentChunkId,
  );
  if (currentIndex < 0) return [...pending];
  const pendingIds = new Set(pending.map((chunk) => chunk.chunkId));
  const neighborCandidates = chronological
    .map((chunk, index) => ({ chunk, index, distance: Math.abs(index - currentIndex) }))
    .filter(
      ({ chunk, distance }) =>
        distance > 0 && pendingIds.has(chunk.chunkId),
    )
    .sort((left, right) => {
      if (left.distance !== right.distance) return left.distance - right.distance;
      const preferLater = currentIndex % 2 === 0;
      return preferLater
        ? right.index - left.index
        : left.index - right.index;
    })
    .slice(0, maximumNeighbors)
    .map(({ chunk }) => chunk);
  if (neighborCandidates.length === 0) return [...pending];
  const neighborIds = new Set(neighborCandidates.map((chunk) => chunk.chunkId));
  const globalPending = pending.filter((chunk) => !neighborIds.has(chunk.chunkId));
  if (neighborCandidates.length === 1 || globalPending.length === 0) {
    return [...neighborCandidates, ...globalPending];
  }
  return [
    neighborCandidates[0] as BroadcastContextTranscriptionChunk,
    globalPending[0] as BroadcastContextTranscriptionChunk,
    ...neighborCandidates.slice(1),
    ...globalPending.slice(1),
  ];
}
