import type { CandidatePassBEvidence } from "../analysis/candidatePassB";
import {
  CANDIDATE_PASS_B_GEMINI_MODEL_ID,
  CANDIDATE_PASS_B_GEMINI_MODEL_REVISION,
  CANDIDATE_PASS_B_QWEN_MODEL_ID,
  CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
  CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION,
  MAX_CANDIDATE_PASS_B_VIDEO_FRAME_BASE64_LENGTH,
  type CandidatePassBParticipantAttribution,
  type CandidatePassBParticipantPresence,
  type CandidatePassBDispatchIntent,
  type CandidatePassBTerminalSettlement,
  type CandidatePassBVerificationReceipt,
  type CandidatePassBContextPacket,
  type CandidatePassBVideoFrame,
} from "../analysis/candidatePassBWorkerProtocol";
import {
  candidatePassBContextFingerprint,
  isCandidatePassBContextPacket,
  isCandidatePassBDispatchIntent,
  isCandidatePassBTerminalSettlement,
  isCandidatePassBVerificationReceipt,
} from "../analysis/candidateFinalVerification";
import {
  assertCandidatePassBAttemptLedger,
  candidatePassBActiveAttempt,
  mergeCandidatePassBAttemptLedgers,
  settleCandidatePassBAttempt,
  type CandidatePassBAttemptLedger,
} from "../analysis/candidatePassBAttemptLedger";
import { createContentFingerprint } from "../security/contentFingerprint";

export const CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION = "4.0.0" as const;
export type CandidatePassBInsightSchemaVersion =
  typeof CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION;
export const CANDIDATE_PASS_B_PLAN_RECEIPT_SCHEMA_VERSION = "1.0.0" as const;
/**
 * The durable plan covers the whole fast-pass reservoir. Provider execution
 * remains bounded separately to 12 candidates per batch.
 */
export const CANDIDATE_PASS_B_PLAN_MAX_CANDIDATES = 96 as const;

export interface StoredCandidatePassBInsight {
  readonly eventSummaryKo: string;
  readonly reactionSummaryKo: string;
  readonly whyGoodClipKo: string;
  readonly uncertaintiesKo: readonly string[];
  readonly participantPresence: CandidatePassBParticipantPresence;
  readonly participantSummaryKo: string;
  readonly identifiedParticipants: readonly CandidatePassBParticipantAttribution[];
  readonly clipDecision: "recommend" | "reject" | "uncertain";
  readonly contextConsistency: "consistent" | "conflict" | "insufficient";
  readonly programMaterial:
    | "streamer-event"
    | "music-or-intermission"
    | "routine-or-unclear";
}

export interface StoredCandidatePassBModelIdentity {
  readonly id:
    | typeof CANDIDATE_PASS_B_QWEN_MODEL_ID
    | typeof CANDIDATE_PASS_B_GEMINI_MODEL_ID;
  readonly revision:
    | typeof CANDIDATE_PASS_B_QWEN_MODEL_REVISION
    | typeof CANDIDATE_PASS_B_GEMINI_MODEL_REVISION;
}

/**
 * Durable proof of the exact Candidate Pass B cohort selected from one
 * completed whole-broadcast context result. This receipt is required even
 * when the planned cohort is empty: an absent record can therefore never be
 * mistaken for an intentionally empty detail phase.
 */
export interface CandidatePassBPlanReceipt {
  readonly schemaVersion: typeof CANDIDATE_PASS_B_PLAN_RECEIPT_SCHEMA_VERSION;
  readonly runId: string;
  readonly inputSignature: string;
  readonly contextInputSignature: string;
  readonly refinementEvidenceProjectionFingerprint: string | null;
  readonly plannedCandidateIds: readonly string[];
  readonly plannedContextFingerprints: readonly string[];
  readonly planFingerprint: string;
}

export interface CandidatePassBInsightsRecord {
  readonly kind: "candidatePassBInsights";
  readonly runId: string;
  readonly schemaVersion: CandidatePassBInsightSchemaVersion;
  readonly inputSignature: string;
  readonly modelManifestHash: string;
  readonly planReceipt: CandidatePassBPlanReceipt;
  /** Exact context bytes that were presented to each candidate analysis. */
  readonly contextByCandidateId: Readonly<
    Record<string, CandidatePassBContextPacket>
  >;
  readonly evidenceById: Readonly<Record<string, CandidatePassBEvidence>>;
  readonly insightById: Readonly<Record<string, StoredCandidatePassBInsight>>;
  /** Actual provider model per candidate, including bounded fallback results. */
  readonly modelByCandidateId: Readonly<
    Record<string, StoredCandidatePassBModelIdentity>
  >;
  /** One impact thumbnail per candidate, kept with the analysis-session snapshot. */
  readonly thumbnailById: Readonly<Record<string, CandidatePassBVideoFrame>>;
  /** Exact provider dispatches durably armed before network I/O. */
  readonly attemptLedgerByCandidateId: Readonly<
    Record<string, CandidatePassBAttemptLedger>
  >;
  /** Projection of the active attempt in each immutable candidate ledger. */
  readonly dispatchIntentByCandidateId: Readonly<
    Record<string, CandidatePassBDispatchIntent>
  >;
  /** Terminal provider outcome for every armed dispatch that has settled. */
  readonly settlementByCandidateId: Readonly<
    Record<string, CandidatePassBTerminalSettlement>
  >;
  /** Proof that a completed result used the exact context and media dispatch. */
  readonly verificationReceiptById: Readonly<
    Record<string, CandidatePassBVerificationReceipt>
  >;
  readonly recordedAt: string;
}

export async function createCandidatePassBPlanReceipt(input: {
  readonly runId: string;
  readonly inputSignature: string;
  readonly contextInputSignature: string;
  readonly refinementEvidenceProjectionFingerprint: string | null;
  readonly plannedCandidateIds: readonly string[];
  readonly contextByCandidateId: Readonly<
    Record<string, CandidatePassBContextPacket>
  >;
}): Promise<CandidatePassBPlanReceipt> {
  const plannedCandidateIds = [...input.plannedCandidateIds];
  const contextCandidateIds = Object.keys(input.contextByCandidateId);
  if (
    input.runId.trim().length === 0 ||
    input.inputSignature.trim().length === 0 ||
    input.contextInputSignature.trim().length === 0 ||
    plannedCandidateIds.length > CANDIDATE_PASS_B_PLAN_MAX_CANDIDATES ||
    plannedCandidateIds.some((candidateId) => candidateId.trim().length === 0) ||
    new Set(plannedCandidateIds).size !== plannedCandidateIds.length ||
    contextCandidateIds.length !== plannedCandidateIds.length ||
    contextCandidateIds.some(
      (candidateId) => !plannedCandidateIds.includes(candidateId),
    )
  ) {
    throw new TypeError("Invalid Candidate Pass B plan receipt input.");
  }
  const plannedContextFingerprints = plannedCandidateIds.map((candidateId) => {
    const context = input.contextByCandidateId[candidateId];
    if (context === undefined || !isCandidatePassBContextPacket(context)) {
      throw new TypeError(
        "Candidate Pass B plan requires one current context packet per candidate.",
      );
    }
    return candidatePassBContextFingerprint(context);
  });
  const planFingerprint = await createContentFingerprint([
    "exclipper.candidate-pass-b.plan-receipt.v1",
    input.runId,
    input.inputSignature,
    input.contextInputSignature,
    input.refinementEvidenceProjectionFingerprint ?? "",
    JSON.stringify(plannedCandidateIds),
    JSON.stringify(plannedContextFingerprints),
  ]);
  return {
    schemaVersion: CANDIDATE_PASS_B_PLAN_RECEIPT_SCHEMA_VERSION,
    runId: input.runId,
    inputSignature: input.inputSignature,
    contextInputSignature: input.contextInputSignature,
    refinementEvidenceProjectionFingerprint:
      input.refinementEvidenceProjectionFingerprint,
    plannedCandidateIds,
    plannedContextFingerprints,
    planFingerprint,
  };
}

/**
 * Minimal durable-store surface required to commit a Candidate Pass B snapshot.
 *
 * Keep this structural instead of importing AnalysisResultStore: the concrete
 * store already imports this record module, so importing it back here would
 * create a circular dependency.
 */
export interface CandidatePassBInsightStorePort {
  replaceCandidatePassBInsightsIfUnchanged(
    expected: CandidatePassBInsightsRecord | null,
    replacement: CandidatePassBInsightsRecord,
  ): Promise<boolean>;
  getCandidatePassBInsights(
    runId: string,
  ): Promise<CandidatePassBInsightsRecord | null>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function isBoundedString(value: unknown, maximum = 20_000): value is string {
  return typeof value === "string" && value.length <= maximum;
}

function isNonEmptyBoundedString(value: unknown, maximum = 20_000): value is string {
  return isBoundedString(value, maximum) && value.trim().length > 0;
}

function isStoredInsight(value: unknown): value is StoredCandidatePassBInsight {
  if (!isRecord(value)) {
    return false;
  }
  const participants = value.identifiedParticipants;
  const participantPresence = value.participantPresence;
  const participantSummaryKo = value.participantSummaryKo;
  return (
    hasExactKeys(value, [
      "eventSummaryKo",
      "reactionSummaryKo",
      "whyGoodClipKo",
      "uncertaintiesKo",
      "participantPresence",
      "participantSummaryKo",
      "identifiedParticipants",
      "clipDecision",
      "contextConsistency",
      "programMaterial",
    ]) &&
    isNonEmptyBoundedString(value.eventSummaryKo, 1_000) &&
    isNonEmptyBoundedString(value.reactionSummaryKo, 1_000) &&
    isNonEmptyBoundedString(value.whyGoodClipKo, 1_000) &&
    Array.isArray(value.uncertaintiesKo) &&
    value.uncertaintiesKo.length <= 8 &&
    value.uncertaintiesKo.every((item) =>
      isNonEmptyBoundedString(item, 500),
    ) &&
    [
        "identified",
        "present-unidentified",
        "none-present",
        "insufficient-evidence",
      ].includes(participantPresence as string) &&
    isNonEmptyBoundedString(participantSummaryKo, 1_000) &&
    Array.isArray(participants) &&
    participants.length <= 6 &&
    participants.every(isStoredParticipantAttribution) &&
    ((participantPresence === "identified" && participants.length > 0) ||
      (participantPresence !== "identified" && participants.length === 0)) &&
    ["recommend", "reject", "uncertain"].includes(value.clipDecision as string) &&
    ["consistent", "conflict", "insufficient"].includes(
        value.contextConsistency as string,
      ) &&
    ["streamer-event", "music-or-intermission", "routine-or-unclear"].includes(
        value.programMaterial as string,
      )
  );
}

function isStoredParticipantAttribution(
  value: unknown,
): value is CandidatePassBParticipantAttribution {
  return (
    isRecord(value) &&
    isNonEmptyBoundedString(value.displayName, 80) &&
    ["streamer", "guest", "unknown"].includes(value.role as string) &&
    ["on-screen-name", "spoken-name"].includes(
      value.evidenceBasis as string,
    ) &&
    isNonEmptyBoundedString(value.evidenceKo, 300) &&
    typeof value.confidence === "number" &&
    Number.isFinite(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 1 &&
    Number.isSafeInteger(value.relativeTimestampMs) &&
    (value.relativeTimestampMs as number) >= 0 &&
    (value.relativeTimestampMs as number) <= 60_000 &&
    hasExactKeys(value, [
      "displayName",
      "role",
      "evidenceBasis",
      "evidenceKo",
      "confidence",
      "relativeTimestampMs",
      "observedFrameIndices",
    ]) &&
    Array.isArray(value.observedFrameIndices) &&
        value.observedFrameIndices.length <= 4 &&
        new Set(value.observedFrameIndices).size === value.observedFrameIndices.length &&
        value.observedFrameIndices.every(
          (frameIndex) =>
            Number.isSafeInteger(frameIndex) && frameIndex >= 0 && frameIndex < 4,
        ) &&
    (value.evidenceBasis !== "on-screen-name" ||
      value.observedFrameIndices.length > 0)
  );
}

function isEvidence(value: unknown): value is CandidatePassBEvidence {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isBoundedString(value.candidateId, 256) &&
    Array.isArray(value.cues) &&
    value.cues.length <= 32 &&
    isRecord(value.overlay) &&
    isBoundedString(value.overlay.event, 1_000) &&
    isBoundedString(value.overlay.why, 1_000) &&
    isBoundedString(value.overlay.reviewHint, 1_000) &&
    isBoundedString(value.overlay.basisLabel, 200) &&
    isRecord(value.quality) &&
    Object.entries(value.quality).every(([key, item]) =>
      key === "meanConfidence"
        ? item === null || (typeof item === "number" && Number.isFinite(item))
        : typeof item === "number" && Number.isFinite(item),
    ) &&
    ["grounded-transcript", "provisional-transcript", "fast-pass-fallback"].includes(
      value.status as string,
    )
  );
}

function isCandidateVideoFrame(value: unknown): value is CandidatePassBVideoFrame {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.timestampMs === "number" &&
    Number.isSafeInteger(value.timestampMs) &&
    value.timestampMs >= 0 &&
    value.timestampMs <= 60_000 &&
    value.mimeType === "image/jpeg" &&
    typeof value.dataBase64 === "string" &&
    value.dataBase64.length > 0 &&
    value.dataBase64.length <= MAX_CANDIDATE_PASS_B_VIDEO_FRAME_BASE64_LENGTH &&
    /^[A-Za-z0-9+/]+={0,2}$/u.test(value.dataBase64)
  );
}

function isStoredModelIdentity(
  value: unknown,
): value is StoredCandidatePassBModelIdentity {
  return (
    isRecord(value) &&
    Object.keys(value).sort().join(",") === "id,revision" &&
    ((value.id === CANDIDATE_PASS_B_QWEN_MODEL_ID &&
      value.revision === CANDIDATE_PASS_B_QWEN_MODEL_REVISION) ||
      (value.id === CANDIDATE_PASS_B_GEMINI_MODEL_ID &&
        value.revision === CANDIDATE_PASS_B_GEMINI_MODEL_REVISION))
  );
}

function isCandidatePassBPlanReceipt(
  value: unknown,
): value is CandidatePassBPlanReceipt {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "schemaVersion",
      "runId",
      "inputSignature",
      "contextInputSignature",
      "refinementEvidenceProjectionFingerprint",
      "plannedCandidateIds",
      "plannedContextFingerprints",
      "planFingerprint",
    ]) &&
    value.schemaVersion === CANDIDATE_PASS_B_PLAN_RECEIPT_SCHEMA_VERSION &&
    isNonEmptyBoundedString(value.runId, 180) &&
    isNonEmptyBoundedString(value.inputSignature, 512) &&
    isNonEmptyBoundedString(value.contextInputSignature, 512) &&
    (value.refinementEvidenceProjectionFingerprint === null ||
      isNonEmptyBoundedString(
        value.refinementEvidenceProjectionFingerprint,
        512,
      )) &&
    Array.isArray(value.plannedCandidateIds) &&
    value.plannedCandidateIds.length <= CANDIDATE_PASS_B_PLAN_MAX_CANDIDATES &&
    value.plannedCandidateIds.every((candidateId) =>
      isNonEmptyBoundedString(candidateId, 256),
    ) &&
    new Set(value.plannedCandidateIds).size ===
      value.plannedCandidateIds.length &&
    Array.isArray(value.plannedContextFingerprints) &&
    value.plannedContextFingerprints.length ===
      value.plannedCandidateIds.length &&
    value.plannedContextFingerprints.every(
      (fingerprint) =>
        typeof fingerprint === "string" &&
        /^fnv1a64:[a-f0-9]{16}$/u.test(fingerprint),
    ) &&
    /^sha256:[a-f0-9]{64}$/u.test(value.planFingerprint as string)
  );
}

export function assertCandidatePassBInsightsRecord(
  value: unknown,
): asserts value is CandidatePassBInsightsRecord {
  if (
    !isRecord(value) ||
    value.kind !== "candidatePassBInsights" ||
    value.schemaVersion !== CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION ||
    !isNonEmptyBoundedString(value.runId, 180) ||
    !isNonEmptyBoundedString(value.inputSignature, 512) ||
    !isNonEmptyBoundedString(value.modelManifestHash, 256) ||
    !isCandidatePassBPlanReceipt(value.planReceipt) ||
    value.planReceipt.runId !== value.runId ||
    value.planReceipt.inputSignature !== value.inputSignature ||
    !isRecord(value.contextByCandidateId) ||
    !isRecord(value.evidenceById) ||
    !isRecord(value.insightById) ||
    !isRecord(value.modelByCandidateId) ||
    !isRecord(value.thumbnailById) ||
    !isRecord(value.attemptLedgerByCandidateId) ||
    !isRecord(value.dispatchIntentByCandidateId) ||
    !isRecord(value.settlementByCandidateId) ||
    !isRecord(value.verificationReceiptById) ||
    !isNonEmptyBoundedString(value.recordedAt, 40) ||
    Number.isNaN(Date.parse(value.recordedAt))
  ) {
    throw new TypeError("Invalid Candidate Pass B insight record.");
  }
  const contextByCandidateId = value.contextByCandidateId as Readonly<
    Record<string, CandidatePassBContextPacket>
  >;
  const planReceipt = value.planReceipt;
  for (const [candidateId, context] of Object.entries(
    contextByCandidateId,
  )) {
    if (
      !isNonEmptyBoundedString(candidateId, 256) ||
      !isCandidatePassBContextPacket(context)
    ) {
      throw new TypeError("Invalid Candidate Pass B context entry.");
    }
  }
  if (
    Object.keys(contextByCandidateId).length !==
      planReceipt.plannedCandidateIds.length ||
    planReceipt.plannedCandidateIds.some((candidateId, index) => {
      const context = contextByCandidateId[candidateId];
      return (
        context === undefined ||
        candidatePassBContextFingerprint(context) !==
          planReceipt.plannedContextFingerprints[index]
      );
    })
  ) {
    throw new TypeError(
      "Candidate Pass B plan contexts must exactly match the durable cohort.",
    );
  }
  for (const [candidateId, evidence] of Object.entries(value.evidenceById)) {
    if (!isEvidence(evidence) || candidateId !== evidence.candidateId) {
      throw new TypeError("Invalid Candidate Pass B evidence entry.");
    }
  }
  for (const insight of Object.values(value.insightById)) {
    if (!isStoredInsight(insight)) {
      throw new TypeError("Invalid Candidate Pass B insight entry.");
    }
  }
  for (const [candidateId, model] of Object.entries(value.modelByCandidateId)) {
    if (!isNonEmptyBoundedString(candidateId, 256) || !isStoredModelIdentity(model)) {
      throw new TypeError("Invalid Candidate Pass B model entry.");
    }
  }
  for (const frame of Object.values(value.thumbnailById)) {
    if (!isCandidateVideoFrame(frame)) {
      throw new TypeError("Invalid Candidate Pass B thumbnail entry.");
    }
  }
  for (const [candidateId, ledger] of Object.entries(
    value.attemptLedgerByCandidateId,
  )) {
    try {
      assertCandidatePassBAttemptLedger(ledger);
    } catch {
      throw new TypeError("Invalid Candidate Pass B attempt ledger entry.");
    }
    const activeAttempt = candidatePassBActiveAttempt(ledger);
    if (
      candidateId !== ledger.candidateId ||
      activeAttempt === null ||
      !jsonStructuresExactlyMatch(
        value.dispatchIntentByCandidateId[candidateId],
        activeAttempt.dispatchIntent,
      ) ||
      !jsonStructuresExactlyMatch(
        value.settlementByCandidateId[candidateId] ?? null,
        activeAttempt.settlement,
      )
    ) {
      throw new TypeError(
        "Candidate Pass B active attempt projection is invalid.",
      );
    }
  }
  for (const [candidateId, intent] of Object.entries(
    value.dispatchIntentByCandidateId,
  )) {
    if (
      !isNonEmptyBoundedString(candidateId, 256) ||
      !isCandidatePassBDispatchIntent(intent) ||
      intent.candidateId !== candidateId ||
      value.attemptLedgerByCandidateId[candidateId] === undefined
    ) {
      throw new TypeError("Invalid Candidate Pass B dispatch intent entry.");
    }
  }
  for (const [candidateId, settlement] of Object.entries(
    value.settlementByCandidateId,
  )) {
    const intent = value.dispatchIntentByCandidateId[candidateId];
    if (
      !isNonEmptyBoundedString(candidateId, 256) ||
      !isCandidatePassBTerminalSettlement(settlement) ||
      !isCandidatePassBDispatchIntent(intent) ||
      settlement.operationId !== intent.operationId ||
      settlement.providerPayloadDigest !==
        intent.mediaReceipt.providerPayloadDigest ||
      settlement.outputLanguage !== intent.outputLanguage ||
      settlement.castRosterId !== intent.castRosterId
    ) {
      throw new TypeError("Invalid Candidate Pass B terminal settlement entry.");
    }
  }
  for (const [candidateId, receipt] of Object.entries(
    value.verificationReceiptById,
  )) {
    const intent = value.dispatchIntentByCandidateId[candidateId];
    const settlement = value.settlementByCandidateId[candidateId];
    if (
      !isNonEmptyBoundedString(candidateId, 256) ||
      !isCandidatePassBVerificationReceipt(receipt) ||
      receipt.candidateId !== candidateId ||
      !isCandidatePassBDispatchIntent(intent) ||
      !isCandidatePassBTerminalSettlement(settlement) ||
      settlement.status !== "completed" ||
      !jsonStructuresExactlyMatch(
        receipt.dispatchIntent,
        intent,
      ) ||
      !jsonStructuresExactlyMatch(
        receipt.settlement,
        settlement,
      )
    ) {
      throw new TypeError("Invalid Candidate Pass B verification receipt entry.");
    }
  }
  const completedArtifactCandidateIds = new Set([
    ...Object.keys(value.evidenceById),
    ...Object.keys(value.insightById),
    ...Object.keys(value.modelByCandidateId),
    ...Object.keys(value.thumbnailById),
    ...Object.keys(value.verificationReceiptById),
  ]);
  for (const candidateId of completedArtifactCandidateIds) {
    const receipt = value.verificationReceiptById[candidateId];
    const settlement = value.settlementByCandidateId[candidateId];
    if (
      receipt === undefined ||
      !isCandidatePassBTerminalSettlement(settlement) ||
      settlement.status !== "completed" ||
      value.evidenceById[candidateId] === undefined ||
      value.insightById[candidateId] === undefined ||
      value.modelByCandidateId[candidateId] === undefined ||
      value.thumbnailById[candidateId] === undefined
    ) {
      throw new TypeError(
        "Candidate Pass B completed artifacts must share one verified attempt.",
      );
    }
  }
  const plannedCandidateIds = new Set(value.planReceipt.plannedCandidateIds);
  const recordedCandidateIds = new Set([
    ...Object.keys(value.contextByCandidateId),
    ...Object.keys(value.evidenceById),
    ...Object.keys(value.insightById),
    ...Object.keys(value.modelByCandidateId),
    ...Object.keys(value.thumbnailById),
    ...Object.keys(value.attemptLedgerByCandidateId),
    ...Object.keys(value.dispatchIntentByCandidateId),
    ...Object.keys(value.settlementByCandidateId),
    ...Object.keys(value.verificationReceiptById),
  ]);
  if (
    [...recordedCandidateIds].some(
      (candidateId) => !plannedCandidateIds.has(candidateId),
    )
  ) {
    throw new TypeError(
      "Candidate Pass B artifacts must belong to the durable planned cohort.",
    );
  }
}

export function cloneCandidatePassBInsightsRecord(
  record: CandidatePassBInsightsRecord,
): CandidatePassBInsightsRecord {
  assertCandidatePassBInsightsRecord(record);
  return JSON.parse(JSON.stringify(record)) as CandidatePassBInsightsRecord;
}

function jsonStructuresExactlyMatch(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) =>
        jsonStructuresExactlyMatch(item, right[index]),
      )
    );
  }
  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        jsonStructuresExactlyMatch(left[key], right[key]),
    )
  );
}

export function candidatePassBInsightSnapshotsExactlyMatch(
  left: CandidatePassBInsightsRecord | null,
  right: CandidatePassBInsightsRecord | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  const leftSnapshot = cloneCandidatePassBInsightsRecord(left);
  const rightSnapshot = cloneCandidatePassBInsightsRecord(right);
  return jsonStructuresExactlyMatch(leftSnapshot, rightSnapshot);
}

function mergeExactCandidateMap<T>(
  current: Readonly<Record<string, T>> | undefined,
  pending: Readonly<Record<string, T>> | undefined,
): Readonly<Record<string, T>> | null {
  const merged: Record<string, T> = { ...(current ?? {}) };
  for (const [candidateId, value] of Object.entries(pending ?? {})) {
    const existing = merged[candidateId];
    if (
      existing !== undefined &&
      !jsonStructuresExactlyMatch(existing, value)
    ) {
      return null;
    }
    merged[candidateId] = value;
  }
  return merged;
}

function mergeAttemptLedgerMap(
  current: Readonly<Record<string, CandidatePassBAttemptLedger>>,
  pending: Readonly<Record<string, CandidatePassBAttemptLedger>>,
): Readonly<Record<string, CandidatePassBAttemptLedger>> | null {
  const merged: Record<string, CandidatePassBAttemptLedger> = {};
  for (const candidateId of new Set([
    ...Object.keys(current),
    ...Object.keys(pending),
  ])) {
    const currentLedger = current[candidateId];
    const pendingLedger = pending[candidateId];
    const ledger =
      currentLedger === undefined
        ? pendingLedger
        : pendingLedger === undefined
          ? currentLedger
          : mergeCandidatePassBAttemptLedgers(currentLedger, pendingLedger);
    if (ledger === undefined || ledger === null) return null;
    merged[candidateId] = ledger;
  }
  return merged;
}

function activeAttemptProjection(
  ledgers: Readonly<Record<string, CandidatePassBAttemptLedger>>,
): {
  readonly dispatchIntentByCandidateId: Readonly<
    Record<string, CandidatePassBDispatchIntent>
  >;
  readonly settlementByCandidateId: Readonly<
    Record<string, CandidatePassBTerminalSettlement>
  >;
} {
  const dispatchIntentByCandidateId: Record<
    string,
    CandidatePassBDispatchIntent
  > = {};
  const settlementByCandidateId: Record<
    string,
    CandidatePassBTerminalSettlement
  > = {};
  for (const [candidateId, ledger] of Object.entries(ledgers)) {
    const active = candidatePassBActiveAttempt(ledger);
    if (active === null) continue;
    dispatchIntentByCandidateId[candidateId] = active.dispatchIntent;
    if (active.settlement !== null) {
      settlementByCandidateId[candidateId] = active.settlement;
    }
  }
  return { dispatchIntentByCandidateId, settlementByCandidateId };
}

function mergeActiveAttemptArtifactMap<T>(
  currentRecord: CandidatePassBInsightsRecord,
  pendingRecord: CandidatePassBInsightsRecord,
  current: Readonly<Record<string, T>>,
  pending: Readonly<Record<string, T>>,
  mergedLedgers: Readonly<Record<string, CandidatePassBAttemptLedger>>,
): Readonly<Record<string, T>> | null {
  const merged: Record<string, T> = {};
  for (const candidateId of new Set([
    ...Object.keys(current),
    ...Object.keys(pending),
  ])) {
    const currentOperationId =
      currentRecord.dispatchIntentByCandidateId[candidateId]?.operationId ??
      null;
    const pendingOperationId =
      pendingRecord.dispatchIntentByCandidateId[candidateId]?.operationId ??
      null;
    const mergedLedger = mergedLedgers[candidateId];
    if (mergedLedger === undefined) return null;
    const activeOperationId =
      candidatePassBActiveAttempt(mergedLedger)?.dispatchIntent.operationId ??
      null;
    if (
      currentOperationId !== pendingOperationId &&
      activeOperationId === pendingOperationId
    ) {
      const pendingValue = pending[candidateId];
      if (pendingValue !== undefined) merged[candidateId] = pendingValue;
      continue;
    }
    const currentValue = current[candidateId];
    const pendingValue = pending[candidateId];
    if (
      currentValue !== undefined &&
      pendingValue !== undefined &&
      !jsonStructuresExactlyMatch(currentValue, pendingValue)
    ) {
      return null;
    }
    const value = pendingValue ?? currentValue;
    if (value !== undefined) merged[candidateId] = value;
  }
  return merged;
}

/**
 * Reconciles two cumulative snapshots only when every overlapping candidate
 * is byte-for-byte identical. This is the safe same-run recovery path after a
 * prior CAS committed but all of its readback acknowledgements were lost.
 */
export function mergeCandidatePassBInsightsForResume(
  currentRecord: CandidatePassBInsightsRecord,
  pendingRecord: CandidatePassBInsightsRecord,
): CandidatePassBInsightsRecord | null {
  if (
    currentRecord.runId !== pendingRecord.runId ||
    currentRecord.schemaVersion !== pendingRecord.schemaVersion ||
    currentRecord.inputSignature !== pendingRecord.inputSignature ||
    currentRecord.modelManifestHash !== pendingRecord.modelManifestHash ||
    !jsonStructuresExactlyMatch(
      currentRecord.planReceipt,
      pendingRecord.planReceipt,
    )
  ) {
    return null;
  }
  const attemptLedgerByCandidateId = mergeAttemptLedgerMap(
    currentRecord.attemptLedgerByCandidateId,
    pendingRecord.attemptLedgerByCandidateId,
  );
  if (attemptLedgerByCandidateId === null) return null;
  const evidenceById = mergeActiveAttemptArtifactMap(
    currentRecord,
    pendingRecord,
    currentRecord.evidenceById,
    pendingRecord.evidenceById,
    attemptLedgerByCandidateId,
  );
  const insightById = mergeActiveAttemptArtifactMap(
    currentRecord,
    pendingRecord,
    currentRecord.insightById,
    pendingRecord.insightById,
    attemptLedgerByCandidateId,
  );
  const contextByCandidateId = mergeExactCandidateMap(
    currentRecord.contextByCandidateId,
    pendingRecord.contextByCandidateId,
  );
  const modelByCandidateId = mergeActiveAttemptArtifactMap(
    currentRecord,
    pendingRecord,
    currentRecord.modelByCandidateId,
    pendingRecord.modelByCandidateId,
    attemptLedgerByCandidateId,
  );
  const thumbnailById = mergeActiveAttemptArtifactMap(
    currentRecord,
    pendingRecord,
    currentRecord.thumbnailById,
    pendingRecord.thumbnailById,
    attemptLedgerByCandidateId,
  );
  const verificationReceiptById = mergeActiveAttemptArtifactMap(
    currentRecord,
    pendingRecord,
    currentRecord.verificationReceiptById,
    pendingRecord.verificationReceiptById,
    attemptLedgerByCandidateId,
  );
  const { dispatchIntentByCandidateId, settlementByCandidateId } =
    activeAttemptProjection(attemptLedgerByCandidateId);
  if (
    contextByCandidateId === null ||
    evidenceById === null ||
    insightById === null ||
    modelByCandidateId === null ||
    thumbnailById === null ||
    verificationReceiptById === null
  ) {
    return null;
  }
  return cloneCandidatePassBInsightsRecord({
    ...pendingRecord,
    contextByCandidateId,
    evidenceById,
    insightById,
    modelByCandidateId,
    thumbnailById,
    attemptLedgerByCandidateId,
    dispatchIntentByCandidateId,
    settlementByCandidateId,
    verificationReceiptById,
  });
}

/**
 * A reload after the durable arm but before a terminal settlement has an
 * unknowable provider outcome. Materialize that state once and never turn it
 * back into a fresh automatic paid request.
 */
export function recoverCandidatePassBArmedDispatchesAsOutcomeUnknown(
  record: CandidatePassBInsightsRecord,
): CandidatePassBInsightsRecord {
  const settlementByCandidateId: Record<string, CandidatePassBTerminalSettlement> = {
    ...record.settlementByCandidateId,
  };
  const attemptLedgerByCandidateId: Record<
    string,
    CandidatePassBAttemptLedger
  > = { ...record.attemptLedgerByCandidateId };
  let changed = false;
  for (const [candidateId, intent] of Object.entries(
    record.dispatchIntentByCandidateId,
  )) {
    if (settlementByCandidateId[candidateId] === undefined) {
      changed = true;
      settlementByCandidateId[candidateId] = {
        schemaVersion: CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION,
        status: "outcome-unknown",
        operationId: intent.operationId,
        providerPayloadDigest: intent.mediaReceipt.providerPayloadDigest,
        outputLanguage: intent.outputLanguage,
        castRosterId: intent.castRosterId,
        reason: "armed-dispatch-recovered",
      };
      const ledger = attemptLedgerByCandidateId[candidateId];
      if (ledger === undefined) {
        throw new TypeError(
          "Candidate Pass B armed dispatch is missing its attempt ledger.",
        );
      }
      attemptLedgerByCandidateId[candidateId] =
        settleCandidatePassBAttempt(
          ledger,
          settlementByCandidateId[candidateId],
        );
    }
  }
  if (!changed) return record;
  return cloneCandidatePassBInsightsRecord({
    ...record,
    attemptLedgerByCandidateId,
    settlementByCandidateId,
    recordedAt: new Date().toISOString(),
  });
}

export interface CandidatePassBInsightPersistencePolicy {
  readonly maximumAttempts: number;
  readonly initialBackoffMs: number;
  readonly maximumBackoffMs: number;
}

const DEFAULT_CANDIDATE_PASS_B_INSIGHT_PERSISTENCE_POLICY: CandidatePassBInsightPersistencePolicy =
  Object.freeze({
    maximumAttempts: 5,
    initialBackoffMs: 100,
    maximumBackoffMs: 1_600,
  });

function normalizedPersistencePolicy(
  policy: Partial<CandidatePassBInsightPersistencePolicy> | undefined,
): CandidatePassBInsightPersistencePolicy {
  const merged = {
    ...DEFAULT_CANDIDATE_PASS_B_INSIGHT_PERSISTENCE_POLICY,
    ...policy,
  };
  if (
    !Number.isSafeInteger(merged.maximumAttempts) ||
    merged.maximumAttempts < 1 ||
    merged.maximumAttempts > 20 ||
    !Number.isSafeInteger(merged.initialBackoffMs) ||
    merged.initialBackoffMs < 0 ||
    !Number.isSafeInteger(merged.maximumBackoffMs) ||
    merged.maximumBackoffMs < merged.initialBackoffMs ||
    merged.maximumBackoffMs > 60_000
  ) {
    throw new RangeError("Invalid Candidate Pass B persistence policy.");
  }
  return merged;
}

function persistenceBackoffMs(
  policy: CandidatePassBInsightPersistencePolicy,
  attemptIndex: number,
): number {
  return Math.min(
    policy.maximumBackoffMs,
    policy.initialBackoffMs * 2 ** Math.max(0, attemptIndex),
  );
}

function waitForPersistenceBackoff(delayMs: number): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  });
}

function verifiedCandidatePassBReadback(
  value: CandidatePassBInsightsRecord | null,
  replacement: CandidatePassBInsightsRecord,
): CandidatePassBInsightsRecord | null {
  if (value === null) return null;
  const verified = cloneCandidatePassBInsightsRecord(value);
  return candidatePassBInsightSnapshotsExactlyMatch(replacement, verified)
    ? verified
    : null;
}

/**
 * Replaces one complete snapshot only when the durable value is still the
 * exact snapshot the caller observed, then proves the committed replacement
 * can be read back before callers publish success.
 *
 * `expected === null` is a create-only compare. It never means "overwrite
 * whatever is there". This keeps a late callback or another tab from replacing
 * newer evidence, thumbnails or receipts with its older full-map snapshot.
 */
export async function persistCandidatePassBInsightsWithReadback(
  store: CandidatePassBInsightStorePort,
  expectedRecord: CandidatePassBInsightsRecord | null,
  replacementRecord: CandidatePassBInsightsRecord,
  policyInput?: Partial<CandidatePassBInsightPersistencePolicy>,
  rebaseReplacement: (
    current: CandidatePassBInsightsRecord,
    pending: CandidatePassBInsightsRecord,
  ) => CandidatePassBInsightsRecord | null = mergeCandidatePassBInsightsForResume,
): Promise<CandidatePassBInsightsRecord> {
  const policy = normalizedPersistencePolicy(policyInput);
  let expected =
    expectedRecord === null
      ? null
      : cloneCandidatePassBInsightsRecord(expectedRecord);
  let replacement = cloneCandidatePassBInsightsRecord(replacementRecord);
  if (expected !== null && expected.runId !== replacement.runId) {
    throw new Error(
      "Candidate Pass B insight compare-and-swap records must share one run id.",
    );
  }
  let mutationAccepted = false;
  let lastFailure: unknown = null;
  for (let attempt = 0; attempt < policy.maximumAttempts; attempt += 1) {
    if (!mutationAccepted) {
      try {
        mutationAccepted =
          await store.replaceCandidatePassBInsightsIfUnchanged(
            expected,
            cloneCandidatePassBInsightsRecord(replacement),
          );
      } catch (error) {
        lastFailure = error;
      }
    }

    let readback: CandidatePassBInsightsRecord | null = null;
    let readbackSucceeded = true;
    try {
      readback = await store.getCandidatePassBInsights(replacement.runId);
      const verified = verifiedCandidatePassBReadback(readback, replacement);
      if (verified !== null) {
        return verified;
      }
    } catch (error) {
      lastFailure = error;
      readbackSucceeded = false;
    }

    const durableStillMatchesExpected =
      readbackSucceeded &&
      candidatePassBInsightSnapshotsExactlyMatch(expected, readback);
    let rebasedThisAttempt = false;
    if (
      readbackSucceeded &&
      readback !== null &&
      !durableStillMatchesExpected &&
      !candidatePassBInsightSnapshotsExactlyMatch(replacement, readback)
    ) {
      const rebased = mutationAccepted
        ? null
        : rebaseReplacement(readback, replacement);
      if (rebased === null) {
        throw new Error(
          mutationAccepted
            ? "Candidate Pass B insight commit could not be verified: readback does not exactly match the written snapshot."
            : "Candidate Pass B insight commit was rejected because the durable snapshot changed.",
        );
      }
      expected = cloneCandidatePassBInsightsRecord(readback);
      replacement = cloneCandidatePassBInsightsRecord(rebased);
      mutationAccepted = false;
      rebasedThisAttempt = true;
    }
    if (mutationAccepted) {
      // The compare-and-swap committed. A missing/stale read is reconciled by
      // exact readback only; repeating the mutation could overwrite a newer
      // snapshot after a lost acknowledgement.
      lastFailure ??= new Error(
        "Candidate Pass B insight commit readback is not visible yet.",
      );
    } else if (
      readbackSucceeded &&
      !durableStillMatchesExpected &&
      !rebasedThisAttempt
    ) {
      throw new Error(
        "Candidate Pass B insight commit was rejected because the durable snapshot changed.",
      );
    }
    if (attempt + 1 < policy.maximumAttempts) {
      await waitForPersistenceBackoff(
        persistenceBackoffMs(policy, attempt),
      );
    }
  }
  throw new Error(
    mutationAccepted
      ? "Candidate Pass B insight commit could not be verified after durable readback retries."
      : "Candidate Pass B insight commit could not be completed after safe retries.",
    { cause: lastFailure },
  );
}
