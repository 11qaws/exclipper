import {
  MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS,
  MAX_BROADCAST_TRANSCRIPT_QWEN_TEXT_LENGTH,
  BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION,
} from "./broadcastTranscriptQwen";
import {
  normalizeBroadcastTranscriptProviderReceipt,
  type BroadcastTranscriptVerifiedResult,
} from "./broadcastTranscriptRouteManifest";
import type { BroadcastContextTranscriptionChunk } from "./broadcastContextSamplingPlan";
import {
  isBroadcastTranscriptChunkId,
  MAX_BROADCAST_TRANSCRIPT_WORKER_CHUNKS,
  type BroadcastTranscriptChunkAbstention,
  type BroadcastTranscriptChunkAbstentionReason,
} from "./broadcastTranscriptWorkerProtocol";
import { MAX_BROADCAST_CONTEXT_SOURCE_DURATION_MS } from "./broadcastContextProtocol";
import {
  broadcastSpeechActivityCanSkipAsr,
  normalizeBroadcastSpeechActivityRunReceipt,
  type BroadcastSpeechActivityRunReceipt,
} from "./broadcastSpeechActivity";

export const BROADCAST_REFINEMENT_TRANSCRIPT_CHECKPOINT_SCHEMA_VERSION =
  "1.2.0" as const;
export const MAX_BROADCAST_REFINEMENT_TRANSCRIPT_CHECKPOINT_BYTES =
  2 * 1024 * 1024;

export type BroadcastRefinementTranscriptGapReason =
  | "in-flight"
  | "decode-failed"
  | "transcription-failed"
  | "rate-limited"
  | "route-changed"
  | "outcome-unknown";

export interface BroadcastRefinementTranscriptPlannedChunk {
  readonly chunkId: string;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly kind: BroadcastContextTranscriptionChunk["kind"];
}

export interface BroadcastRefinementTranscriptSuccessfulFragment {
  readonly chunkId: string;
  readonly result: BroadcastTranscriptVerifiedResult;
}

export type BroadcastRefinementTranscriptAbstention =
  BroadcastTranscriptChunkAbstention;

export interface BroadcastRefinementTranscriptGap {
  readonly chunkId: string;
  readonly reason: BroadcastRefinementTranscriptGapReason;
  /**
   * One plus the last quota attempt ordinal, matching the durable main
   * transcript convention. It can therefore seed a disjoint retry generation.
   */
  readonly attemptCount: number;
}

export interface BroadcastRefinementTranscriptCheckpoint {
  readonly schemaVersion: typeof BROADCAST_REFINEMENT_TRANSCRIPT_CHECKPOINT_SCHEMA_VERSION;
  readonly refinementInputSignature: string;
  readonly plannedChunks: readonly BroadcastRefinementTranscriptPlannedChunk[];
  readonly successfulFragments: readonly BroadcastRefinementTranscriptSuccessfulFragment[];
  readonly abstentions: readonly BroadcastRefinementTranscriptAbstention[];
  readonly gaps: readonly BroadcastRefinementTranscriptGap[];
}

export interface CreateBroadcastRefinementTranscriptCheckpointInput {
  readonly refinementInputSignature: string;
  readonly plannedChunks: readonly BroadcastContextTranscriptionChunk[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function boundedString(value: unknown, maximumLength = 512): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= maximumLength &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function comparePlannedChunks(
  left: BroadcastRefinementTranscriptPlannedChunk,
  right: BroadcastRefinementTranscriptPlannedChunk,
): number {
  return (
    left.sourceStartMs - right.sourceStartMs ||
    left.sourceEndMs - right.sourceEndMs ||
    left.chunkId.localeCompare(right.chunkId) ||
    left.kind.localeCompare(right.kind)
  );
}

function normalizePlannedChunks(
  value: unknown,
): BroadcastRefinementTranscriptPlannedChunk[] | null {
  if (
    !Array.isArray(value) ||
    value.length > MAX_BROADCAST_TRANSCRIPT_WORKER_CHUNKS
  ) {
    return null;
  }
  const chunks: BroadcastRefinementTranscriptPlannedChunk[] = [];
  const chunkIds = new Set<string>();
  for (const item of value) {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, [
        "chunkId",
        "sourceStartMs",
        "sourceEndMs",
        "kind",
      ]) ||
      !isBroadcastTranscriptChunkId(item.chunkId) ||
      chunkIds.has(item.chunkId) ||
      !Number.isSafeInteger(item.sourceStartMs) ||
      !Number.isSafeInteger(item.sourceEndMs) ||
      (item.sourceStartMs as number) < 0 ||
      (item.sourceEndMs as number) <= (item.sourceStartMs as number) ||
      (item.sourceEndMs as number) >
        MAX_BROADCAST_CONTEXT_SOURCE_DURATION_MS ||
      (item.sourceEndMs as number) - (item.sourceStartMs as number) >
        MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS ||
      !["uniform", "event", "uniform-and-event"].includes(
        typeof item.kind === "string" ? item.kind : "",
      )
    ) {
      return null;
    }
    chunkIds.add(item.chunkId);
    chunks.push({
      chunkId: item.chunkId,
      sourceStartMs: item.sourceStartMs as number,
      sourceEndMs: item.sourceEndMs as number,
      kind: item.kind as BroadcastRefinementTranscriptPlannedChunk["kind"],
    });
  }
  return chunks.sort(comparePlannedChunks);
}

function normalizeOptionalLabel(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (!boundedString(value, 40)) return undefined;
  return value;
}

function normalizeTranscriptResult(
  value: unknown,
  plannedChunk: BroadcastRefinementTranscriptPlannedChunk,
): BroadcastTranscriptVerifiedResult | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "modelId",
      "modelRevision",
      "providerReceipt",
      "sourceStartMs",
      "sourceEndMs",
      "textKo",
      "detectedLanguage",
      "emotion",
      "billedSeconds",
    ]) ||
    value.schemaVersion !== BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION ||
    typeof value.modelRevision !== "string" ||
    value.sourceStartMs !== plannedChunk.sourceStartMs ||
    value.sourceEndMs !== plannedChunk.sourceEndMs ||
    !boundedString(value.textKo, MAX_BROADCAST_TRANSCRIPT_QWEN_TEXT_LENGTH) ||
    !/\p{Script=Hangul}/u.test(value.textKo)
  ) {
    return null;
  }
  const detectedLanguage = normalizeOptionalLabel(value.detectedLanguage);
  const emotion = normalizeOptionalLabel(value.emotion);
  let providerReceipt;
  try {
    providerReceipt = normalizeBroadcastTranscriptProviderReceipt(
      value.providerReceipt,
    );
  } catch {
    return null;
  }
  if (
    detectedLanguage === undefined ||
    emotion === undefined ||
    !(
      value.billedSeconds === null ||
      (typeof value.billedSeconds === "number" &&
        Number.isFinite(value.billedSeconds) &&
        value.billedSeconds >= 0)
    ) ||
    value.modelId !== providerReceipt.modelId ||
    value.modelRevision !== providerReceipt.modelRevision
  ) {
    return null;
  }
  return {
    schemaVersion: BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION,
    modelId: providerReceipt.modelId,
    modelRevision: providerReceipt.modelRevision,
    providerReceipt,
    sourceStartMs: plannedChunk.sourceStartMs,
    sourceEndMs: plannedChunk.sourceEndMs,
    textKo: value.textKo,
    detectedLanguage,
    emotion,
    billedSeconds: value.billedSeconds,
  };
}

function chunkOrder(
  plannedChunks: readonly BroadcastRefinementTranscriptPlannedChunk[],
): ReadonlyMap<string, number> {
  return new Map(plannedChunks.map(({ chunkId }, index) => [chunkId, index]));
}

function normalizeCheckpoint(
  value: unknown,
): BroadcastRefinementTranscriptCheckpoint | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "refinementInputSignature",
      "plannedChunks",
      "successfulFragments",
      "abstentions",
      "gaps",
    ]) ||
    value.schemaVersion !==
      BROADCAST_REFINEMENT_TRANSCRIPT_CHECKPOINT_SCHEMA_VERSION ||
    !boundedString(value.refinementInputSignature) ||
    !Array.isArray(value.successfulFragments) ||
    !Array.isArray(value.abstentions) ||
    !Array.isArray(value.gaps)
  ) {
    return null;
  }
  const plannedChunks = normalizePlannedChunks(value.plannedChunks);
  if (plannedChunks === null) return null;
  const plannedById = new Map(
    plannedChunks.map((chunk) => [chunk.chunkId, chunk]),
  );
  const order = chunkOrder(plannedChunks);
  const settledIds = new Set<string>();
  const successfulFragments: BroadcastRefinementTranscriptSuccessfulFragment[] =
    [];
  for (const item of value.successfulFragments) {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, ["chunkId", "result"]) ||
      !isBroadcastTranscriptChunkId(item.chunkId) ||
      settledIds.has(item.chunkId)
    ) {
      return null;
    }
    const planned = plannedById.get(item.chunkId);
    if (planned === undefined) return null;
    const result = normalizeTranscriptResult(item.result, planned);
    if (result === null) return null;
    settledIds.add(item.chunkId);
    successfulFragments.push({ chunkId: item.chunkId, result });
  }
  const abstentions: BroadcastRefinementTranscriptAbstention[] = [];
  for (const item of value.abstentions) {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, [
        "chunkId",
        "reason",
        "speechActivityReceipt",
      ]) ||
      !isBroadcastTranscriptChunkId(item.chunkId) ||
      !["no-audio", "no-speech"].includes(
        typeof item.reason === "string" ? item.reason : "",
      ) ||
      !plannedById.has(item.chunkId) ||
      settledIds.has(item.chunkId)
    ) {
      return null;
    }
    const planned = plannedById.get(item.chunkId);
    if (planned === undefined) return null;
    const speechActivityReceipt =
      item.reason === "no-speech"
        ? normalizeBroadcastSpeechActivityRunReceipt(
            item.speechActivityReceipt,
          )
        : null;
    if (
      (item.reason === "no-audio" &&
        item.speechActivityReceipt !== null) ||
      (item.reason === "no-speech" &&
        (speechActivityReceipt === null ||
          speechActivityReceipt.sourceStartMs !==
            planned.sourceStartMs ||
          speechActivityReceipt.sourceEndMs !== planned.sourceEndMs ||
          !speechActivityReceipt.coverage.complete ||
          speechActivityReceipt.coverage.repairRequired ||
          speechActivityReceipt.coverage.asrRequiredDurationMs !== 0 ||
          speechActivityReceipt.cells.length !==
            speechActivityReceipt.coverage.plannedCellCount ||
          !speechActivityReceipt.cells.every(
            broadcastSpeechActivityCanSkipAsr,
          )))
    ) {
      return null;
    }
    settledIds.add(item.chunkId);
    abstentions.push(
      item.reason === "no-speech"
        ? {
            chunkId: item.chunkId,
            reason: "no-speech",
            speechActivityReceipt:
              speechActivityReceipt as BroadcastSpeechActivityRunReceipt,
          }
        : {
            chunkId: item.chunkId,
            reason: "no-audio",
            speechActivityReceipt: null,
          },
    );
  }
  const gaps: BroadcastRefinementTranscriptGap[] = [];
  for (const item of value.gaps) {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, ["chunkId", "reason", "attemptCount"]) ||
      !isBroadcastTranscriptChunkId(item.chunkId) ||
      ![
        "in-flight",
        "decode-failed",
        "transcription-failed",
        "rate-limited",
        "route-changed",
        "outcome-unknown",
      ].includes(typeof item.reason === "string" ? item.reason : "") ||
      !Number.isSafeInteger(item.attemptCount) ||
      (item.attemptCount as number) <= 0 ||
      (item.attemptCount as number) > 1_000_000 ||
      !plannedById.has(item.chunkId) ||
      settledIds.has(item.chunkId)
    ) {
      return null;
    }
    settledIds.add(item.chunkId);
    gaps.push({
      chunkId: item.chunkId,
      reason: item.reason as BroadcastRefinementTranscriptGapReason,
      attemptCount: item.attemptCount as number,
    });
  }
  const byPlanOrder = <T extends { readonly chunkId: string }>(
    left: T,
    right: T,
  ): number =>
    (order.get(left.chunkId) ?? Number.MAX_SAFE_INTEGER) -
    (order.get(right.chunkId) ?? Number.MAX_SAFE_INTEGER);
  return {
    schemaVersion: BROADCAST_REFINEMENT_TRANSCRIPT_CHECKPOINT_SCHEMA_VERSION,
    refinementInputSignature: value.refinementInputSignature,
    plannedChunks,
    successfulFragments: successfulFragments.sort(byPlanOrder),
    abstentions: abstentions.sort(byPlanOrder),
    gaps: gaps.sort(byPlanOrder),
  };
}

export function createBroadcastRefinementTranscriptCheckpoint(
  input: CreateBroadcastRefinementTranscriptCheckpointInput,
): BroadcastRefinementTranscriptCheckpoint {
  const checkpoint = normalizeCheckpoint({
    schemaVersion: BROADCAST_REFINEMENT_TRANSCRIPT_CHECKPOINT_SCHEMA_VERSION,
    refinementInputSignature: input.refinementInputSignature,
    plannedChunks: input.plannedChunks,
    successfulFragments: [],
    abstentions: [],
    gaps: [],
  });
  if (checkpoint === null) {
    throw new TypeError("Broadcast refinement transcript plan is invalid.");
  }
  return checkpoint;
}

export function serializeBroadcastRefinementTranscriptCheckpoint(
  value: BroadcastRefinementTranscriptCheckpoint,
): string {
  const checkpoint = normalizeCheckpoint(value);
  if (checkpoint === null) {
    throw new TypeError("Broadcast refinement transcript checkpoint is invalid.");
  }
  const serialized = JSON.stringify(checkpoint);
  if (
    utf8ByteLength(serialized) >
    MAX_BROADCAST_REFINEMENT_TRANSCRIPT_CHECKPOINT_BYTES
  ) {
    throw new RangeError(
      "Broadcast refinement transcript checkpoint exceeds its byte limit.",
    );
  }
  return serialized;
}

export function parseBroadcastRefinementTranscriptCheckpointJson(
  value: string,
): BroadcastRefinementTranscriptCheckpoint | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    utf8ByteLength(value) >
      MAX_BROADCAST_REFINEMENT_TRANSCRIPT_CHECKPOINT_BYTES
  ) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  const checkpoint = normalizeCheckpoint(parsed);
  if (checkpoint === null || JSON.stringify(checkpoint) !== value) {
    return null;
  }
  return checkpoint;
}

export function broadcastRefinementTranscriptCheckpointMatchesInput(
  checkpoint: BroadcastRefinementTranscriptCheckpoint,
  input: CreateBroadcastRefinementTranscriptCheckpointInput,
): boolean {
  let expected: BroadcastRefinementTranscriptCheckpoint;
  let actual: BroadcastRefinementTranscriptCheckpoint | null;
  try {
    expected = createBroadcastRefinementTranscriptCheckpoint(input);
    actual = normalizeCheckpoint(checkpoint);
  } catch {
    return false;
  }
  return (
    actual !== null &&
    actual.refinementInputSignature === expected.refinementInputSignature &&
    JSON.stringify(actual.plannedChunks) ===
      JSON.stringify(expected.plannedChunks)
  );
}

export function broadcastRefinementTranscriptCheckpointCanComplete(
  checkpoint: BroadcastRefinementTranscriptCheckpoint,
): boolean {
  const normalized = normalizeCheckpoint(checkpoint);
  return (
    normalized !== null &&
    normalized.gaps.length === 0 &&
    normalized.successfulFragments.length + normalized.abstentions.length ===
      normalized.plannedChunks.length
  );
}

type BroadcastRefinementTranscriptSettlement =
  | {
      readonly kind: "success";
      readonly value: BroadcastRefinementTranscriptSuccessfulFragment;
    }
  | {
      readonly kind: "abstention";
      readonly value: BroadcastRefinementTranscriptAbstention;
    }
  | {
      readonly kind: "gap";
      readonly value: BroadcastRefinementTranscriptGap;
    };

function settlementByChunkId(
  checkpoint: BroadcastRefinementTranscriptCheckpoint,
): ReadonlyMap<string, BroadcastRefinementTranscriptSettlement> {
  const settlements = new Map<
    string,
    BroadcastRefinementTranscriptSettlement
  >();
  for (const value of checkpoint.successfulFragments) {
    settlements.set(value.chunkId, { kind: "success", value });
  }
  for (const value of checkpoint.abstentions) {
    settlements.set(value.chunkId, { kind: "abstention", value });
  }
  for (const value of checkpoint.gaps) {
    settlements.set(value.chunkId, { kind: "gap", value });
  }
  return settlements;
}

function gapSafetyRank(reason: BroadcastRefinementTranscriptGapReason): number {
  switch (reason) {
    case "outcome-unknown":
      return 3;
    case "decode-failed":
    case "transcription-failed":
    case "rate-limited":
    case "route-changed":
      return 2;
    case "in-flight":
      return 1;
  }
}

function mergeSettlement(
  current: BroadcastRefinementTranscriptSettlement | undefined,
  pending: BroadcastRefinementTranscriptSettlement | undefined,
): BroadcastRefinementTranscriptSettlement | undefined {
  if (current === undefined) return pending;
  if (pending === undefined) return current;

  /*
   * A terminal fragment or verified abstention is immutable paid/negative
   * evidence. A late in-flight or gap checkpoint must never replace it.
   */
  if (current.kind !== "gap") return current;
  if (pending.kind !== "gap") return pending;

  if (pending.value.attemptCount > current.value.attemptCount) return pending;
  if (pending.value.attemptCount < current.value.attemptCount) return current;
  return gapSafetyRank(pending.value.reason) >
    gapSafetyRank(current.value.reason)
    ? pending
    : current;
}

/**
 * Monotonically joins two checkpoints for the same immutable refinement plan.
 *
 * This is the child-level CAS merge used when another tab commits between a
 * local transition and its compare-and-swap. Terminal evidence never regresses
 * to a gap, and an older attempt can never replace a newer attempt.
 */
export function mergeBroadcastRefinementTranscriptCheckpoints(
  currentCheckpoint: BroadcastRefinementTranscriptCheckpoint,
  pendingCheckpoint: BroadcastRefinementTranscriptCheckpoint,
): BroadcastRefinementTranscriptCheckpoint {
  const current = normalizeCheckpoint(currentCheckpoint);
  const pending = normalizeCheckpoint(pendingCheckpoint);
  if (
    current === null ||
    pending === null ||
    current.refinementInputSignature !== pending.refinementInputSignature ||
    JSON.stringify(current.plannedChunks) !==
      JSON.stringify(pending.plannedChunks)
  ) {
    throw new TypeError(
      "Broadcast refinement transcript checkpoints do not share one exact plan.",
    );
  }

  const currentByChunkId = settlementByChunkId(current);
  const pendingByChunkId = settlementByChunkId(pending);
  const successfulFragments: BroadcastRefinementTranscriptSuccessfulFragment[] =
    [];
  const abstentions: BroadcastRefinementTranscriptAbstention[] = [];
  const gaps: BroadcastRefinementTranscriptGap[] = [];

  for (const { chunkId } of current.plannedChunks) {
    const settlement = mergeSettlement(
      currentByChunkId.get(chunkId),
      pendingByChunkId.get(chunkId),
    );
    if (settlement?.kind === "success") {
      successfulFragments.push(settlement.value);
    } else if (settlement?.kind === "abstention") {
      abstentions.push(settlement.value);
    } else if (settlement?.kind === "gap") {
      gaps.push(settlement.value);
    }
  }

  const merged = normalizeCheckpoint({
    ...current,
    successfulFragments,
    abstentions,
    gaps,
  });
  if (merged === null) {
    throw new TypeError(
      "Merged broadcast refinement transcript checkpoint is invalid.",
    );
  }
  return merged;
}

function replaceChunkSettlement(
  checkpoint: BroadcastRefinementTranscriptCheckpoint,
  settlement:
    | BroadcastRefinementTranscriptSuccessfulFragment
    | BroadcastRefinementTranscriptAbstention
    | BroadcastRefinementTranscriptGap,
  kind: "success" | "abstention" | "gap",
): BroadcastRefinementTranscriptCheckpoint {
  const current = normalizeCheckpoint(checkpoint);
  if (
    current === null ||
    !current.plannedChunks.some(
      ({ chunkId }) => chunkId === settlement.chunkId,
    )
  ) {
    throw new TypeError(
      "Broadcast refinement transcript settlement is not in the frozen plan.",
    );
  }
  const next = normalizeCheckpoint({
    ...current,
    successfulFragments: [
      ...current.successfulFragments.filter(
        ({ chunkId }) => chunkId !== settlement.chunkId,
      ),
      ...(kind === "success" ? [settlement] : []),
    ],
    abstentions: [
      ...current.abstentions.filter(
        ({ chunkId }) => chunkId !== settlement.chunkId,
      ),
      ...(kind === "abstention" ? [settlement] : []),
    ],
    gaps: [
      ...current.gaps.filter(({ chunkId }) => chunkId !== settlement.chunkId),
      ...(kind === "gap" ? [settlement] : []),
    ],
  });
  if (next === null) {
    throw new TypeError(
      "Broadcast refinement transcript settlement is invalid.",
    );
  }
  return next;
}

export function recordBroadcastRefinementTranscriptSuccess(
  checkpoint: BroadcastRefinementTranscriptCheckpoint,
  chunkId: string,
  result: BroadcastTranscriptVerifiedResult,
): BroadcastRefinementTranscriptCheckpoint {
  return replaceChunkSettlement(
    checkpoint,
    { chunkId, result },
    "success",
  );
}

export function recordBroadcastRefinementTranscriptAbstention(
  checkpoint: BroadcastRefinementTranscriptCheckpoint,
  chunkId: string,
  reason: "no-audio",
  speechActivityReceipt?: null,
): BroadcastRefinementTranscriptCheckpoint;
export function recordBroadcastRefinementTranscriptAbstention(
  checkpoint: BroadcastRefinementTranscriptCheckpoint,
  chunkId: string,
  reason: "no-speech",
  speechActivityReceipt: BroadcastSpeechActivityRunReceipt,
): BroadcastRefinementTranscriptCheckpoint;
export function recordBroadcastRefinementTranscriptAbstention(
  checkpoint: BroadcastRefinementTranscriptCheckpoint,
  chunkId: string,
  reason: BroadcastTranscriptChunkAbstentionReason,
  speechActivityReceipt: BroadcastSpeechActivityRunReceipt | null = null,
): BroadcastRefinementTranscriptCheckpoint {
  if (reason === "no-audio") {
    return replaceChunkSettlement(
      checkpoint,
      {
        chunkId,
        reason,
        speechActivityReceipt: null,
      },
      "abstention",
    );
  }
  if (speechActivityReceipt === null) {
    throw new TypeError(
      "Confirmed no-speech refinement evidence requires its VAD receipt.",
    );
  }
  const settlement: BroadcastRefinementTranscriptAbstention = {
    chunkId,
    reason,
    speechActivityReceipt,
  };
  return replaceChunkSettlement(
    checkpoint,
    settlement,
    "abstention",
  );
}

export function recordBroadcastRefinementTranscriptGap(
  checkpoint: BroadcastRefinementTranscriptCheckpoint,
  gap: BroadcastRefinementTranscriptGap,
): BroadcastRefinementTranscriptCheckpoint {
  return replaceChunkSettlement(checkpoint, gap, "gap");
}
