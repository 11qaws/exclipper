import {
  candidatePassBReceiptMatchesContext,
  isCandidatePassBCompletedSettlement,
  isCandidatePassBDispatchIntent,
  isCandidatePassBVerificationReceipt,
} from "../analysis/candidateFinalVerification";
import type {
  CandidatePassBContextPacket,
  CandidatePassBDispatchIntent,
  CandidatePassBTerminalSettlement,
  CandidatePassBVerificationSourceFence,
} from "../analysis/candidatePassBWorkerProtocol";
import type {
  CandidatePassBInsightsRecord,
  StoredCandidatePassBInsight,
} from "../storage/candidatePassBInsightStore";
import {
  candidatePassBActiveAttempt,
  candidatePassBAttemptLedgerState,
  type CandidatePassBAttemptLedger,
} from "../analysis/candidatePassBAttemptLedger";

const PARTICIPANT_PRESENCE_VALUES = new Set([
  "identified",
  "present-unidentified",
  "none-present",
  "insufficient-evidence",
] satisfies readonly NonNullable<
  StoredCandidatePassBInsight["participantPresence"]
>[]);
const CLIP_DECISION_VALUES = new Set([
  "recommend",
  "reject",
  "uncertain",
] satisfies readonly NonNullable<StoredCandidatePassBInsight["clipDecision"]>[]);
const CONTEXT_CONSISTENCY_VALUES = new Set([
  "consistent",
  "conflict",
  "insufficient",
] satisfies readonly NonNullable<
  StoredCandidatePassBInsight["contextConsistency"]
>[]);
const PROGRAM_MATERIAL_VALUES = new Set([
  "streamer-event",
  "music-or-intermission",
  "routine-or-unclear",
] satisfies readonly NonNullable<StoredCandidatePassBInsight["programMaterial"]>[]);

function nonEmpty(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

function exactJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => exactJson(item, right[index]))
    );
  }
  if (
    typeof left !== "object" ||
    left === null ||
    typeof right !== "object" ||
    right === null
  ) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        exactJson(leftRecord[key], rightRecord[key]),
    )
  );
}

/**
 * Reuse the exact context bytes that were durably bound to the active Pass B
 * plan. A YouTube caption track is intentionally not persisted separately, so
 * rebuilding packets after reload can otherwise downgrade a caption-backed
 * packet to a broadcast-transcript packet and make the paid result impossible
 * to verify. The current run/input/refinement fences prevent a stale plan from
 * crossing into a different analysis.
 */
export function selectEffectiveCandidatePassBContextById(input: {
  readonly computedContextByCandidateId: Readonly<
    Record<string, CandidatePassBContextPacket>
  >;
  readonly durableRecord: CandidatePassBInsightsRecord | null;
  readonly runId: string | null;
  readonly inputSignature: string | null;
  readonly refinementEvidenceProjectionFingerprint: string | null;
}): Readonly<Record<string, CandidatePassBContextPacket>> {
  const { durableRecord } = input;
  if (
    durableRecord === null ||
    input.runId === null ||
    input.inputSignature === null ||
    durableRecord.runId !== input.runId ||
    durableRecord.inputSignature !== input.inputSignature ||
    durableRecord.planReceipt.runId !== input.runId ||
    durableRecord.planReceipt.inputSignature !== input.inputSignature ||
    durableRecord.planReceipt.refinementEvidenceProjectionFingerprint !==
      input.refinementEvidenceProjectionFingerprint
  ) {
    return input.computedContextByCandidateId;
  }
  const plannedIds = durableRecord.planReceipt.plannedCandidateIds;
  if (
    plannedIds.some(
      (candidateId) =>
        input.computedContextByCandidateId[candidateId] === undefined ||
        durableRecord.contextByCandidateId[candidateId] === undefined,
    )
  ) {
    return input.computedContextByCandidateId;
  }
  return {
    ...input.computedContextByCandidateId,
    ...durableRecord.contextByCandidateId,
  };
}

export function candidatePassBPlanContextCohortMatches(
  record: CandidatePassBInsightsRecord | null,
  plannedCandidateIds: readonly string[],
): boolean {
  if (
    record === null ||
    new Set(plannedCandidateIds).size !== plannedCandidateIds.length
  ) {
    return false;
  }
  const plannedIds = new Set(plannedCandidateIds);
  const contextIds = Object.keys(record.contextByCandidateId);
  return (
    contextIds.length === plannedIds.size &&
    contextIds.every((candidateId) => plannedIds.has(candidateId))
  );
}

export function candidatePassBInsightIsComplete(
  insight: StoredCandidatePassBInsight | undefined,
): boolean {
  if (
    insight === undefined ||
    !nonEmpty(insight.eventSummaryKo) ||
    !nonEmpty(insight.reactionSummaryKo) ||
    !nonEmpty(insight.whyGoodClipKo) ||
    !PARTICIPANT_PRESENCE_VALUES.has(insight.participantPresence) ||
    !nonEmpty(insight.participantSummaryKo) ||
    !Array.isArray(insight.identifiedParticipants) ||
    !CLIP_DECISION_VALUES.has(insight.clipDecision) ||
    !CONTEXT_CONSISTENCY_VALUES.has(insight.contextConsistency) ||
    !PROGRAM_MATERIAL_VALUES.has(insight.programMaterial)
  ) {
    return false;
  }
  if (
    insight.identifiedParticipants.some(
      ({ evidenceBasis }) =>
        evidenceBasis !== "on-screen-name" &&
        evidenceBasis !== "spoken-name",
    )
  ) {
    return false;
  }
  return !(
    (insight.participantPresence === "identified" &&
      insight.identifiedParticipants.length === 0) ||
    (insight.participantPresence === "none-present" &&
      insight.identifiedParticipants.length > 0)
  );
}

export interface CandidatePassBDurableThumbnailProjectionInput {
  readonly thumbnailById: CandidatePassBInsightsRecord["thumbnailById"];
  readonly evidenceById: CandidatePassBInsightsRecord["evidenceById"];
  readonly insightById: CandidatePassBInsightsRecord["insightById"];
  readonly modelByCandidateId:
    CandidatePassBInsightsRecord["modelByCandidateId"];
  readonly verificationReceiptById:
    CandidatePassBInsightsRecord["verificationReceiptById"];
  readonly dispatchIntentByCandidateId:
    CandidatePassBInsightsRecord["dispatchIntentByCandidateId"];
  readonly settlementByCandidateId:
    CandidatePassBInsightsRecord["settlementByCandidateId"];
  readonly attemptLedgerByCandidateId:
    CandidatePassBInsightsRecord["attemptLedgerByCandidateId"];
}

function dispatchAndSettlementExactlyMatch(
  dispatch: CandidatePassBDispatchIntent,
  settlement: CandidatePassBTerminalSettlement,
): boolean {
  return (
    settlement.operationId === dispatch.operationId &&
    settlement.providerPayloadDigest ===
      dispatch.mediaReceipt.providerPayloadDigest
  );
}

/**
 * Projects view-layer frames into the durable Candidate Pass B snapshot.
 *
 * Frames are extracted before provider work and therefore exist for candidates
 * that are merely staged or armed. A durable thumbnail, however, is one member
 * of the completed artifact tuple: evidence, insight, model, exact dispatch,
 * completed settlement, receipt and active attempt ledger must all agree. This
 * central projection keeps arm, terminal and persistence-retry checkpoints
 * from accidentally treating an early UI frame as a paid completed result.
 */
export function selectCandidatePassBDurableThumbnailById(
  input: CandidatePassBDurableThumbnailProjectionInput,
): CandidatePassBInsightsRecord["thumbnailById"] {
  return Object.fromEntries(
    Object.entries(input.thumbnailById).filter(([candidateId, thumbnail]) => {
      const evidence = input.evidenceById[candidateId];
      const insight = input.insightById[candidateId];
      const model = input.modelByCandidateId[candidateId];
      const receipt = input.verificationReceiptById[candidateId];
      const dispatch = input.dispatchIntentByCandidateId[candidateId];
      const settlement = input.settlementByCandidateId[candidateId];
      const ledger = input.attemptLedgerByCandidateId[candidateId];
      if (
        evidence?.candidateId !== candidateId ||
        !candidatePassBInsightIsComplete(insight) ||
        model === undefined ||
        !isCandidatePassBVerificationReceipt(receipt) ||
        receipt.candidateId !== candidateId ||
        !isCandidatePassBDispatchIntent(dispatch) ||
        dispatch.candidateId !== candidateId ||
        !isCandidatePassBCompletedSettlement(settlement) ||
        ledger === undefined ||
        !dispatchAndSettlementExactlyMatch(dispatch, settlement) ||
        !exactJson(receipt.dispatchIntent, dispatch) ||
        !exactJson(receipt.settlement, settlement) ||
        receipt.thumbnailTimestampMs !== thumbnail.timestampMs ||
        !dispatch.mediaReceipt.frames.some(
          ({ timestampMs }) => timestampMs === thumbnail.timestampMs,
        ) ||
        model.id !== settlement.providerModelId ||
        model.revision !== settlement.providerModelRevision
      ) {
        return false;
      }
      try {
        const activeAttempt = candidatePassBActiveAttempt(ledger);
        return (
          activeAttempt !== null &&
          exactJson(activeAttempt.dispatchIntent, dispatch) &&
          exactJson(activeAttempt.settlement, settlement)
        );
      } catch {
        return false;
      }
    }),
  );
}

/**
 * Current publication durability is an exact artifact proof, not a collection
 * of optimistic booleans. The stored dispatch contains four content-digested
 * frames and an audible/verified-no-speech WAV receipt; the completed
 * settlement binds the exact provider response to that paid operation.
 */
export function candidatePassBArtifactIsDurable(
  record: CandidatePassBInsightsRecord | null,
  sourceFence: CandidatePassBVerificationSourceFence | undefined,
  context: CandidatePassBContextPacket | undefined,
): boolean {
  if (record === null || sourceFence === undefined || context === undefined) {
    return false;
  }
  const { candidateId } = sourceFence;
  const evidence = record.evidenceById[candidateId];
  const insight = record.insightById[candidateId];
  const model = record.modelByCandidateId[candidateId];
  const thumbnail = record.thumbnailById[candidateId];
  const dispatch = record.dispatchIntentByCandidateId[candidateId];
  const settlement = record.settlementByCandidateId[candidateId];
  const receipt = record.verificationReceiptById[candidateId];
  const persistedContext = record.contextByCandidateId[candidateId];
  if (
    evidence?.candidateId !== candidateId ||
    !candidatePassBInsightIsComplete(insight) ||
    model === undefined ||
    thumbnail === undefined ||
    dispatch === undefined ||
    settlement === undefined ||
    receipt === undefined ||
    persistedContext === undefined ||
    !isCandidatePassBDispatchIntent(dispatch) ||
    !isCandidatePassBCompletedSettlement(settlement) ||
    !isCandidatePassBVerificationReceipt(receipt) ||
    !exactJson(persistedContext, context) ||
    !dispatchAndSettlementExactlyMatch(dispatch, settlement) ||
    !exactJson(receipt.dispatchIntent, dispatch) ||
    !exactJson(receipt.settlement, settlement) ||
    !candidatePassBReceiptMatchesContext(receipt, context, sourceFence) ||
    receipt.thumbnailTimestampMs !== thumbnail.timestampMs ||
    !dispatch.mediaReceipt.frames.some(
      ({ timestampMs }) => timestampMs === thumbnail.timestampMs,
    )
  ) {
    return false;
  }
  return (
    model.id === settlement.providerModelId &&
    model.revision === settlement.providerModelRevision
  );
}

export interface CandidatePassBAutomaticTarget {
  readonly candidateId: string;
  readonly reason: "initial" | "free-outcome-unknown";
  readonly attemptOrdinal: number;
  readonly replacesOperationId: string | null;
}

export interface CandidatePassBAutomaticTargetInput {
  readonly candidateIds: readonly string[];
  readonly attemptLedgerByCandidateId: Readonly<
    Record<string, CandidatePassBAttemptLedger>
  >;
  readonly dispatchIntentByCandidateId: Readonly<
    Record<string, CandidatePassBDispatchIntent>
  >;
  readonly settlementByCandidateId: Readonly<
    Record<string, CandidatePassBTerminalSettlement>
  >;
}

/**
 * Selects current automatic work from exact durable projections.
 *
 * A never-armed candidate may start its initial attempt. A terminal
 * outcome-unknown may re-enter automatically only when the exact active
 * operation used the free R2 route. Paid-direct ambiguity stays behind editor
 * approval, and an armed or completed operation never re-enters here.
 */
export function selectCandidatePassBAutomaticTargets(
  input: CandidatePassBAutomaticTargetInput,
): readonly CandidatePassBAutomaticTarget[] {
  const targets: CandidatePassBAutomaticTarget[] = [];
  for (const candidateId of input.candidateIds) {
    const ledger = input.attemptLedgerByCandidateId[candidateId];
    const dispatch = input.dispatchIntentByCandidateId[candidateId];
    const settlement = input.settlementByCandidateId[candidateId];
    if (
      ledger === undefined &&
      dispatch === undefined &&
      settlement === undefined
    ) {
      targets.push({
        candidateId,
        reason: "initial",
        attemptOrdinal: 0,
        replacesOperationId: null,
      });
      continue;
    }
    if (ledger === undefined || dispatch === undefined || settlement === undefined) {
      continue;
    }
    try {
      const state = candidatePassBAttemptLedgerState(ledger);
      const activeAttempt = candidatePassBActiveAttempt(ledger);
      if (
        (state !== "blocked" && state !== "retry-granted") ||
        activeAttempt === null ||
        activeAttempt.dispatchIntent.transportMode !== "free-r2" ||
        settlement.status !== "outcome-unknown" ||
        !exactJson(activeAttempt.dispatchIntent, dispatch) ||
        !exactJson(activeAttempt.settlement, settlement)
      ) {
        continue;
      }
      targets.push({
        candidateId,
        reason: "free-outcome-unknown",
        attemptOrdinal: ledger.attempts.length,
        replacesOperationId: dispatch.operationId,
      });
    } catch {
      continue;
    }
  }
  return targets;
}

export function selectCandidatePassBAnalysisOutstandingIds(input: {
  readonly candidateIds: CandidatePassBAutomaticTargetInput["candidateIds"];
  readonly attemptLedgerByCandidateId:
    CandidatePassBAutomaticTargetInput["attemptLedgerByCandidateId"];
  readonly dispatchIntentByCandidateId:
    CandidatePassBAutomaticTargetInput["dispatchIntentByCandidateId"];
  readonly settlementByCandidateId:
    CandidatePassBAutomaticTargetInput["settlementByCandidateId"];
}): readonly string[] {
  return selectCandidatePassBAutomaticTargets(input).map(
    ({ candidateId }) => candidateId,
  );
}

export function scheduleCandidatePassBAutomaticTargetReadback(input: {
  readonly candidateIds: readonly string[];
  readonly delayMs: number;
  readonly readDurableInput: () => Omit<
    CandidatePassBAutomaticTargetInput,
    "candidateIds"
  >;
  readonly onReady: (
    targets: readonly CandidatePassBAutomaticTarget[],
  ) => void;
  readonly schedule?: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof globalThis.setTimeout>;
}): ReturnType<typeof globalThis.setTimeout> {
  if (
    !Number.isSafeInteger(input.delayMs) ||
    input.delayMs < 0 ||
    new Set(input.candidateIds).size !== input.candidateIds.length
  ) {
    throw new TypeError("Invalid Candidate Pass B automatic retry timer.");
  }
  const schedule = input.schedule ?? globalThis.setTimeout;
  return schedule(() => {
    input.onReady(
      selectCandidatePassBAutomaticTargets({
        candidateIds: input.candidateIds,
        ...input.readDurableInput(),
      }),
    );
  }, input.delayMs) as ReturnType<typeof globalThis.setTimeout>;
}

export function selectCandidatePassBOutcomeUnknownIds(input: {
  readonly candidateIds: readonly string[];
  readonly dispatchIntentByCandidateId: Readonly<
    Record<string, CandidatePassBDispatchIntent>
  >;
  readonly settlementByCandidateId: Readonly<
    Record<string, CandidatePassBTerminalSettlement>
  >;
}): readonly string[] {
  return input.candidateIds.filter((candidateId) => {
    const dispatch = input.dispatchIntentByCandidateId[candidateId];
    const settlement = input.settlementByCandidateId[candidateId];
    return (
      dispatch !== undefined &&
      (settlement === undefined || settlement.status === "outcome-unknown")
    );
  });
}

export function selectCandidatePassBDurabilityOutstandingIds(input: {
  readonly candidateIds: readonly string[];
  readonly record: CandidatePassBInsightsRecord | null;
  readonly contextByCandidateId: Readonly<
    Record<string, CandidatePassBContextPacket>
  >;
  readonly sourceFenceByCandidateId: Readonly<
    Record<string, CandidatePassBVerificationSourceFence>
  >;
}): readonly string[] {
  return input.candidateIds.filter(
    (candidateId) =>
      !candidatePassBArtifactIsDurable(
        input.record,
        input.sourceFenceByCandidateId[candidateId],
        input.contextByCandidateId[candidateId],
      ),
  );
}

export function selectCandidatePassBDurableIds(input: {
  readonly candidateIds: readonly string[];
  readonly record: CandidatePassBInsightsRecord | null;
  readonly contextByCandidateId: Readonly<
    Record<string, CandidatePassBContextPacket>
  >;
  readonly sourceFenceByCandidateId: Readonly<
    Record<string, CandidatePassBVerificationSourceFence>
  >;
}): ReadonlySet<string> {
  const outstanding = new Set(
    selectCandidatePassBDurabilityOutstandingIds(input),
  );
  return new Set(
    input.candidateIds.filter((candidateId) => !outstanding.has(candidateId)),
  );
}
