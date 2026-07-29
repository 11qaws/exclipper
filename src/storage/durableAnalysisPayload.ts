import type {
  HighlightSignalKind,
  UnifiedAudioEvidence,
  UnifiedChatEvidence,
  UnifiedHighlightCandidate,
  UnifiedHighlightEvidence,
  UnifiedVisualEvidence,
} from "../analysis/highlightFusion";

export const DURABLE_CHAT_GAP_ID = "chat-signal-analysis";
export const DURABLE_SIGNAL_GAP_POLICY_ID = "local-available-signal-degradation-v2";
export const DURABLE_AUDIO_GAP_ID = "audio-reaction-analysis";
export const DURABLE_ANALYSIS_PERSISTENCE_SCHEMA_VERSION = "0.3.0" as const;

export type DurableChatGapReasonCode =
  | "EVENT_FENCE_REJECTED"
  | "WORKER_FAILED"
  | "WORKER_MESSAGE_ERROR"
  | "WORKER_TIMEOUT"
  | "WORKER_UNAVAILABLE";

export type DurableAudioGapReasonCode =
  | "EVENT_FENCE_REJECTED"
  | "NO_AUDIO_TRACK"
  | "UNSUPPORTED_AUDIO_CODEC"
  | "UNSUPPORTED_CONTAINER"
  | "WORKER_FAILED"
  | "WORKER_TIMEOUT"
  | "WORKER_UNAVAILABLE";

export type DurableSignalGapReasonCode =
  | DurableChatGapReasonCode
  | DurableAudioGapReasonCode;

export type DurableChatTimestampBasis = "relative" | "rebasedAbsolute" | "unknown";
export type DurableMediaKind = "video" | "audio" | "unknown";
export type DurableMediaContainer = "mp4" | "webm" | "mov" | "mkv" | "other";
export type DurablePreferredRuntimeTier = "webgpu" | "wasm" | "signals-only";

export interface DurableSourceDescriptor {
  readonly sourceDefinitionId: string;
  readonly contentFingerprint: string;
  readonly captionVideoId: string | null;
  readonly sizeBytes: number;
  readonly durationMs: number;
  readonly kind: DurableMediaKind;
  readonly container: DurableMediaContainer;
}

export interface DurableChatInputDescriptor {
  readonly timestampBasis: DurableChatTimestampBasis;
  readonly importedRowCount: number;
  readonly offsetMs: number;
}

export interface DurableAnalysisInputDescriptor {
  readonly source: DurableSourceDescriptor;
  readonly chat: DurableChatInputDescriptor;
  readonly candidateWindowMs: number;
}

export interface DurableSignalGapPolicy {
  readonly policyId: typeof DURABLE_SIGNAL_GAP_POLICY_ID;
  readonly disclosedBeforeStart: true;
  readonly behavior: "complete-with-available-reaction-signals-and-documented-gaps";
}

export interface DurableManifestPayload {
  readonly input: DurableAnalysisInputDescriptor;
  readonly signalGapPolicy: DurableSignalGapPolicy;
}

export interface DurableAnalysisSelectionSummary {
  readonly plannedFrameCount: number;
  readonly sampledFrameCount: number;
  readonly analyzedTransitionCount: number;
  readonly analyzedChatMessageCount: number;
  readonly outOfRangeChatMessageCount: number;
  readonly skippedChatMessageCount: number;
  readonly chatGapReasonCode: DurableChatGapReasonCode | null;
  readonly plannedAudioWindowCount: number;
  readonly analyzedAudioWindowCount: number;
  readonly audioGapReasonCode: DurableAudioGapReasonCode | null;
  readonly candidateCount: number;
}

export interface DurableGapApprovalRecord {
  readonly gapId: typeof DURABLE_CHAT_GAP_ID | typeof DURABLE_AUDIO_GAP_ID;
  readonly reason: DurableSignalGapReasonCode;
  readonly approvedBy: typeof DURABLE_SIGNAL_GAP_POLICY_ID;
}

export interface DurableAnalysisGapApprovalEvidence {
  readonly policyId: typeof DURABLE_SIGNAL_GAP_POLICY_ID;
  readonly disclosedBeforeStart: true;
  readonly approvals: readonly DurableGapApprovalRecord[];
}

export interface DurableAnalysisCoverageSummary {
  readonly visualPlannedSampleCount: number;
  readonly visualCompletedSampleCount: number;
  readonly visualCoverageComplete: boolean;
  readonly chatPlannedMessageCount: number;
  readonly chatProcessedMessageCount: number;
  readonly chatCoverageComplete: boolean;
  readonly chatGapReasonCode: DurableChatGapReasonCode | null;
  readonly audioPlannedWindowCount: number;
  readonly audioProcessedWindowCount: number;
  readonly audioCoverageComplete: boolean;
  readonly audioGapReasonCode: DurableAudioGapReasonCode | null;
  readonly signalGapApproval: DurableAnalysisGapApprovalEvidence | null;
  readonly activeTaskCountAtCommit: number;
}

/** Human-readable reason text is regenerated from signalKinds and never persisted. */
export type DurableHighlightCandidate = Omit<UnifiedHighlightCandidate, "reason">;

export interface DurableFinalResultPayload {
  readonly input: DurableAnalysisInputDescriptor;
  readonly summary: DurableAnalysisSelectionSummary;
  readonly coverage: DurableAnalysisCoverageSummary;
  readonly candidates: readonly DurableHighlightCandidate[];
}

/** One completion rule shared by commit, reload recovery, and UI projection. */
export function durableCoverageDisposition(
  coverage: DurableAnalysisCoverageSummary,
): "completed" | "completedWithGaps" {
  return coverage.visualCoverageComplete &&
    coverage.chatCoverageComplete &&
    coverage.audioCoverageComplete
    ? "completed"
    : "completedWithGaps";
}

export type DurableFailurePayload =
  | {
      readonly outcome: "cancelled";
      readonly fenceEpoch: number;
    }
  | {
      readonly outcome: "failed";
      readonly reasonCode: "LOCAL_ANALYSIS_FAILED";
    };

export interface DurableBrowserCapabilities {
  readonly webAssembly: boolean;
  readonly worker: boolean;
  readonly webCodecsVideoDecoder: boolean;
  readonly webGpu: boolean;
  readonly crossOriginIsolated: boolean;
  readonly preferredRuntimeTier: DurablePreferredRuntimeTier;
}

const LOCAL_FILE_FINGERPRINT_PATTERN =
  /^local-file-sampled-sha256-v1:[0-9a-f]{64}$/u;

const GAP_REASON_CODES = new Set<DurableChatGapReasonCode>([
  "EVENT_FENCE_REJECTED",
  "WORKER_FAILED",
  "WORKER_MESSAGE_ERROR",
  "WORKER_TIMEOUT",
  "WORKER_UNAVAILABLE",
]);
const AUDIO_GAP_REASON_CODES = new Set<DurableAudioGapReasonCode>([
  "EVENT_FENCE_REJECTED",
  "NO_AUDIO_TRACK",
  "UNSUPPORTED_AUDIO_CODEC",
  "UNSUPPORTED_CONTAINER",
  "WORKER_FAILED",
  "WORKER_TIMEOUT",
  "WORKER_UNAVAILABLE",
]);

const SOURCE_KEYS = [
  "sourceDefinitionId",
  "contentFingerprint",
  "captionVideoId",
  "sizeBytes",
  "durationMs",
  "kind",
  "container",
] as const;
const CHAT_INPUT_KEYS = ["timestampBasis", "importedRowCount", "offsetMs"] as const;
const ANALYSIS_INPUT_KEYS = ["source", "chat", "candidateWindowMs"] as const;
const SUMMARY_KEYS = [
  "plannedFrameCount",
  "sampledFrameCount",
  "analyzedTransitionCount",
  "analyzedChatMessageCount",
  "outOfRangeChatMessageCount",
  "skippedChatMessageCount",
  "chatGapReasonCode",
  "candidateCount",
  "plannedAudioWindowCount",
  "analyzedAudioWindowCount",
  "audioGapReasonCode",
] as const;
const COVERAGE_KEYS = [
  "visualPlannedSampleCount",
  "visualCompletedSampleCount",
  "visualCoverageComplete",
  "chatPlannedMessageCount",
  "chatProcessedMessageCount",
  "chatCoverageComplete",
  "chatGapReasonCode",
  "audioPlannedWindowCount",
  "audioProcessedWindowCount",
  "audioCoverageComplete",
  "audioGapReasonCode",
  "signalGapApproval",
  "activeTaskCountAtCommit",
] as const;
const NORMALIZED_EVIDENCE_KEYS = [
  "rankPercentile",
  "robustPercentile",
  "normalizedScore",
] as const;
const VISUAL_EVIDENCE_OPTIONAL_KEYS = [
  "changeScore",
  "robustScore",
  "previousFrameMs",
  "currentFrameMs",
  "meanLumaDifference",
  "changedPixelRatio",
  "sceneChangeStrength",
  "baselineSceneChangeStrength",
  "medianAbsoluteDeviation",
  "robustSceneScore",
] as const;
const CHAT_EVIDENCE_KEYS = [
  ...NORMALIZED_EVIDENCE_KEYS,
  "bucketStartMs",
  "bucketEndMs",
  "messageCount",
  "uniqueAuthorCount",
  "reactionMessageCount",
  "baselineMessageCount",
  "baselineUniqueAuthorCount",
  "burstRatio",
  "robustBurstScore",
  "repetitionRatio",
  "singleAuthorRatio",
  "spamPenalty",
] as const;
const AUDIO_EVIDENCE_OPTIONAL_NUMERIC_KEYS = [
  "baselineRms",
  "medianAbsoluteDeviation",
  "robustLoudnessScore",
  "rmsLiftRatio",
  "peakLiftRatio",
  "sustainedWindowCount",
  "activeWindowCount",
  "clickPenalty",
  "backgroundPenalty",
  "zeroCrossingRate",
  "speechBandEnergyRatio",
] as const;
const AUDIO_EVIDENCE_OPTIONAL_KEYS = [
  "eventKind",
  ...AUDIO_EVIDENCE_OPTIONAL_NUMERIC_KEYS,
] as const;

function invalid(path: string, message: string): TypeError {
  return new TypeError(`${path} ${message}`);
}

function asPlainRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalid(path, "must be an object.");
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalid(path, "must be a plain JSON object.");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw invalid(path, "must not contain symbol-keyed data.");
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  record: Record<string, unknown>,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw invalid(`${path}.${key}`, "is not an allowed durable field.");
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(record, key)) {
      throw invalid(`${path}.${key}`, "is required.");
    }
  }
}

function assertFiniteNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalid(path, "must be a finite number.");
  }
}

function assertSafeInteger(value: unknown, path: string, minimum = 0): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw invalid(path, `must be a safe integer of at least ${minimum}.`);
  }
}

function assertBoolean(value: unknown, path: string): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw invalid(path, "must be a boolean.");
  }
}

function assertOneOf<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): asserts value is T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw invalid(path, "contains an unsupported value.");
  }
}

function assertGapReason(
  value: unknown,
  path: string,
): asserts value is DurableChatGapReasonCode | null {
  if (value !== null && (typeof value !== "string" || !GAP_REASON_CODES.has(value as DurableChatGapReasonCode))) {
    throw invalid(path, "contains an unsupported chat gap reason.");
  }
}

function assertAudioGapReason(
  value: unknown,
  path: string,
): asserts value is DurableAudioGapReasonCode | null {
  if (
    value !== null &&
    (typeof value !== "string" ||
      !AUDIO_GAP_REASON_CODES.has(value as DurableAudioGapReasonCode))
  ) {
    throw invalid(path, "contains an unsupported audio gap reason.");
  }
}

export function classifyDurableMediaContainer(
  extension: string | null,
  mimeType: string,
): DurableMediaContainer {
  const normalizedExtension = extension?.toLowerCase() ?? "";
  const normalizedMime = mimeType.trim().toLowerCase();
  if (normalizedExtension === "mp4" || normalizedMime === "video/mp4") {
    return "mp4";
  }
  if (normalizedExtension === "webm" || normalizedMime === "video/webm") {
    return "webm";
  }
  if (normalizedExtension === "mov" || normalizedMime === "video/quicktime") {
    return "mov";
  }
  if (normalizedExtension === "mkv" || normalizedMime === "video/x-matroska") {
    return "mkv";
  }
  return "other";
}

export function assertDurableSourceDescriptor(
  value: unknown,
  path = "$.source",
): asserts value is DurableSourceDescriptor {
  const record = asPlainRecord(value, path);
  assertExactKeys(record, path, SOURCE_KEYS);
  if (
    typeof record.sourceDefinitionId !== "string" ||
    record.sourceDefinitionId.length > 180 ||
    !/^source-[a-z0-9-]+$/u.test(record.sourceDefinitionId)
  ) {
    throw invalid(`${path}.sourceDefinitionId`, "must be a generated source identifier.");
  }
  if (
    typeof record.contentFingerprint !== "string" ||
    !LOCAL_FILE_FINGERPRINT_PATTERN.test(record.contentFingerprint)
  ) {
    throw invalid(`${path}.contentFingerprint`, "must be a versioned sampled SHA-256 fingerprint.");
  }
  if (
    record.captionVideoId !== null &&
    (typeof record.captionVideoId !== "string" ||
      !/^[A-Za-z0-9_-]{11}$/u.test(record.captionVideoId))
  ) {
    throw invalid(
      `${path}.captionVideoId`,
      "must be null or one exact YouTube video identifier.",
    );
  }
  assertSafeInteger(record.sizeBytes, `${path}.sizeBytes`);
  assertSafeInteger(record.durationMs, `${path}.durationMs`);
  assertOneOf(record.kind, `${path}.kind`, ["video", "audio", "unknown"]);
  assertOneOf(record.container, `${path}.container`, ["mp4", "webm", "mov", "mkv", "other"]);
}

function assertChatInput(value: unknown, path: string): asserts value is DurableChatInputDescriptor {
  const record = asPlainRecord(value, path);
  assertExactKeys(record, path, CHAT_INPUT_KEYS);
  assertOneOf(record.timestampBasis, `${path}.timestampBasis`, [
    "relative",
    "rebasedAbsolute",
    "unknown",
  ]);
  assertSafeInteger(record.importedRowCount, `${path}.importedRowCount`);
  assertSafeInteger(record.offsetMs, `${path}.offsetMs`, Number.MIN_SAFE_INTEGER);
}

export function assertDurableAnalysisInputDescriptor(
  value: unknown,
  path = "$.input",
): asserts value is DurableAnalysisInputDescriptor {
  const record = asPlainRecord(value, path);
  assertExactKeys(record, path, ANALYSIS_INPUT_KEYS);
  assertDurableSourceDescriptor(record.source, `${path}.source`);
  assertChatInput(record.chat, `${path}.chat`);
  assertSafeInteger(record.candidateWindowMs, `${path}.candidateWindowMs`);
  if (record.candidateWindowMs < 30_000 || record.candidateWindowMs > 60_000) {
    throw invalid(`${path}.candidateWindowMs`, "must be between 30 and 60 seconds.");
  }
}

export function assertDurableManifestPayload(
  value: unknown,
  path = "$.result",
): asserts value is DurableManifestPayload {
  const record = asPlainRecord(value, path);
  assertExactKeys(record, path, ["input", "signalGapPolicy"]);
  assertDurableAnalysisInputDescriptor(record.input, `${path}.input`);
  const policy = asPlainRecord(record.signalGapPolicy, `${path}.signalGapPolicy`);
  assertExactKeys(policy, `${path}.signalGapPolicy`, [
    "policyId",
    "disclosedBeforeStart",
    "behavior",
  ]);
  const validSignalPolicy =
    policy.policyId === DURABLE_SIGNAL_GAP_POLICY_ID &&
    policy.disclosedBeforeStart === true &&
    policy.behavior === "complete-with-available-reaction-signals-and-documented-gaps";
  if (!validSignalPolicy) {
    throw invalid(
      `${path}.signalGapPolicy`,
      "does not match the disclosed local signal-gap policy.",
    );
  }
}

function assertSelectionSummary(
  value: unknown,
  path: string,
): asserts value is DurableAnalysisSelectionSummary {
  const record = asPlainRecord(value, path);
  assertExactKeys(record, path, SUMMARY_KEYS);
  for (const key of SUMMARY_KEYS) {
    if (key !== "chatGapReasonCode" && key !== "audioGapReasonCode") {
      assertSafeInteger(record[key], `${path}.${key}`);
    }
  }
  assertGapReason(record.chatGapReasonCode, `${path}.chatGapReasonCode`);
  assertAudioGapReason(record.audioGapReasonCode, `${path}.audioGapReasonCode`);
}

function assertSignalGapApproval(
  value: unknown,
  path: string,
  expected: readonly DurableGapApprovalRecord[],
): asserts value is DurableAnalysisGapApprovalEvidence {
  const record = asPlainRecord(value, path);
  assertExactKeys(record, path, ["policyId", "disclosedBeforeStart", "approvals"]);
  if (
    record.policyId !== DURABLE_SIGNAL_GAP_POLICY_ID ||
    record.disclosedBeforeStart !== true
  ) {
    throw invalid(path, "does not match the disclosed local signal-gap policy.");
  }
  if (!Array.isArray(record.approvals) || record.approvals.length !== expected.length) {
    throw invalid(`${path}.approvals`, "does not cover every documented signal gap.");
  }
  const expectedByGapId = new Map(expected.map((approval) => [approval.gapId, approval]));
  const seenGapIds = new Set<string>();
  record.approvals.forEach((value, index) => {
    const approvalPath = `${path}.approvals[${index}]`;
    const approval = asPlainRecord(value, approvalPath);
    assertExactKeys(approval, approvalPath, ["gapId", "reason", "approvedBy"]);
    if (typeof approval.gapId !== "string" || seenGapIds.has(approval.gapId)) {
      throw invalid(`${approvalPath}.gapId`, "must identify one unique documented gap.");
    }
    seenGapIds.add(approval.gapId);
    const expectedApproval = expectedByGapId.get(
      approval.gapId as DurableGapApprovalRecord["gapId"],
    );
    if (
      expectedApproval === undefined ||
      approval.reason !== expectedApproval.reason ||
      approval.approvedBy !== DURABLE_SIGNAL_GAP_POLICY_ID
    ) {
      throw invalid(approvalPath, "does not match the documented signal gap.");
    }
  });
}

function assertCoverageSummary(
  value: unknown,
  path: string,
): asserts value is DurableAnalysisCoverageSummary {
  const record = asPlainRecord(value, path);
  assertExactKeys(record, path, COVERAGE_KEYS);
  for (const key of [
    "visualPlannedSampleCount",
    "visualCompletedSampleCount",
    "chatPlannedMessageCount",
    "chatProcessedMessageCount",
    "activeTaskCountAtCommit",
  ] as const) {
    assertSafeInteger(record[key], `${path}.${key}`);
  }
  assertBoolean(record.visualCoverageComplete, `${path}.visualCoverageComplete`);
  assertBoolean(record.chatCoverageComplete, `${path}.chatCoverageComplete`);
  assertGapReason(record.chatGapReasonCode, `${path}.chatGapReasonCode`);
  const visualPlannedSampleCount = record.visualPlannedSampleCount as number;
  const visualCompletedSampleCount = record.visualCompletedSampleCount as number;
  const chatPlannedMessageCount = record.chatPlannedMessageCount as number;
  const chatProcessedMessageCount = record.chatProcessedMessageCount as number;

  if (visualCompletedSampleCount > visualPlannedSampleCount) {
    throw invalid(path, "contains visual coverage beyond its plan.");
  }
  if (record.visualCoverageComplete !== true) {
    throw invalid(`${path}.visualCoverageComplete`, "must be complete for a final result.");
  }
  if (chatProcessedMessageCount > chatPlannedMessageCount) {
    throw invalid(path, "contains chat coverage beyond its plan.");
  }
  if (
    record.visualCoverageComplete !==
    (visualCompletedSampleCount === visualPlannedSampleCount)
  ) {
    throw invalid(`${path}.visualCoverageComplete`, "does not agree with visual counts.");
  }
  if (
    record.chatCoverageComplete !==
    (chatProcessedMessageCount === chatPlannedMessageCount)
  ) {
    throw invalid(`${path}.chatCoverageComplete`, "does not agree with chat counts.");
  }
  if (record.activeTaskCountAtCommit !== 0) {
    throw invalid(`${path}.activeTaskCountAtCommit`, "must be zero at final commit.");
  }

  for (const key of ["audioPlannedWindowCount", "audioProcessedWindowCount"] as const) {
    assertSafeInteger(record[key], `${path}.${key}`);
  }
  assertBoolean(record.audioCoverageComplete, `${path}.audioCoverageComplete`);
  assertAudioGapReason(record.audioGapReasonCode, `${path}.audioGapReasonCode`);
  const audioPlannedWindowCount = record.audioPlannedWindowCount as number;
  const audioProcessedWindowCount = record.audioProcessedWindowCount as number;
  if (audioProcessedWindowCount > audioPlannedWindowCount) {
    throw invalid(path, "contains audio coverage beyond its plan.");
  }
  if (
    record.audioCoverageComplete !==
    (audioProcessedWindowCount === audioPlannedWindowCount)
  ) {
    throw invalid(`${path}.audioCoverageComplete`, "does not agree with audio counts.");
  }

  const expectedApprovals: DurableGapApprovalRecord[] = [];
  if (record.chatCoverageComplete) {
    if (record.chatGapReasonCode !== null) {
      throw invalid(`${path}.chatGapReasonCode`, "must be null when chat coverage is complete.");
    }
  } else {
    if (record.chatGapReasonCode === null) {
      throw invalid(`${path}.chatGapReasonCode`, "must document incomplete chat coverage.");
    }
    expectedApprovals.push({
      gapId: DURABLE_CHAT_GAP_ID,
      reason: record.chatGapReasonCode,
      approvedBy: DURABLE_SIGNAL_GAP_POLICY_ID,
    });
  }
  if (record.audioCoverageComplete) {
    if (record.audioGapReasonCode !== null) {
      throw invalid(`${path}.audioGapReasonCode`, "must be null when audio coverage is complete.");
    }
  } else {
    if (record.audioGapReasonCode === null) {
      throw invalid(`${path}.audioGapReasonCode`, "must document incomplete audio coverage.");
    }
    expectedApprovals.push({
      gapId: DURABLE_AUDIO_GAP_ID,
      reason: record.audioGapReasonCode,
      approvedBy: DURABLE_SIGNAL_GAP_POLICY_ID,
    });
  }

  if (expectedApprovals.length === 0) {
    if (record.signalGapApproval !== null) {
      throw invalid(`${path}.signalGapApproval`, "must be null when signal coverage is complete.");
    }
    return;
  }
  if (record.signalGapApproval === null) {
    throw invalid(`${path}.signalGapApproval`, "must approve every documented signal gap.");
  }
  assertSignalGapApproval(
    record.signalGapApproval,
    `${path}.signalGapApproval`,
    expectedApprovals,
  );
}

function assertNormalizedEvidence(value: Record<string, unknown>, path: string): void {
  for (const key of NORMALIZED_EVIDENCE_KEYS) {
    assertFiniteNumber(value[key], `${path}.${key}`);
    if (value[key] < 0 || value[key] > 1) {
      throw invalid(`${path}.${key}`, "must be between zero and one.");
    }
  }
}

function assertVisualEvidence(value: unknown, path: string): asserts value is UnifiedVisualEvidence {
  const record = asPlainRecord(value, path);
  assertExactKeys(record, path, NORMALIZED_EVIDENCE_KEYS, VISUAL_EVIDENCE_OPTIONAL_KEYS);
  assertNormalizedEvidence(record, path);
  for (const key of VISUAL_EVIDENCE_OPTIONAL_KEYS) {
    if (Object.hasOwn(record, key)) {
      assertFiniteNumber(record[key], `${path}.${key}`);
    }
  }
}

function assertChatEvidence(value: unknown, path: string): asserts value is UnifiedChatEvidence {
  const record = asPlainRecord(value, path);
  assertExactKeys(record, path, CHAT_EVIDENCE_KEYS);
  assertNormalizedEvidence(record, path);
  for (const key of CHAT_EVIDENCE_KEYS) {
    if (!(NORMALIZED_EVIDENCE_KEYS as readonly string[]).includes(key)) {
      assertFiniteNumber(record[key], `${path}.${key}`);
    }
  }
}

function assertAudioEvidence(value: unknown, path: string): asserts value is UnifiedAudioEvidence {
  const record = asPlainRecord(value, path);
  assertExactKeys(
    record,
    path,
    NORMALIZED_EVIDENCE_KEYS,
    AUDIO_EVIDENCE_OPTIONAL_KEYS,
  );
  assertNormalizedEvidence(record, path);
  if (Object.hasOwn(record, "eventKind")) {
    assertOneOf(record.eventKind, `${path}.eventKind`, [
      "short-loudness-burst",
      "sustained-vocal-reaction",
      "dialogue-issue-signal",
    ]);
  }
  for (const key of AUDIO_EVIDENCE_OPTIONAL_NUMERIC_KEYS) {
    if (Object.hasOwn(record, key)) {
      assertFiniteNumber(record[key], `${path}.${key}`);
    }
  }
}

function signalKindsFor(
  value: unknown,
  path: string,
): readonly HighlightSignalKind[] {
  if (!Array.isArray(value)) {
    throw invalid(path, "must be an array.");
  }
  const candidateKinds: readonly unknown[] = value;
  const order: readonly HighlightSignalKind[] = ["audio", "chat", "visual"];
  const validCanonical =
    candidateKinds.length >= 1 &&
    candidateKinds.length <= order.length &&
    candidateKinds.every((kind, index) => {
      if (kind !== "audio" && kind !== "chat" && kind !== "visual") {
        return false;
      }
      return (
        index === 0 ||
        order.indexOf(kind) >
          order.indexOf(candidateKinds[index - 1] as HighlightSignalKind)
      );
    });
  if (!validCanonical) {
    throw invalid(path, "must contain unique signal kinds in canonical order.");
  }
  return value as readonly HighlightSignalKind[];
}

function assertHighlightEvidence(
  value: unknown,
  path: string,
  signalKinds: readonly HighlightSignalKind[],
): asserts value is UnifiedHighlightEvidence {
  const record = asPlainRecord(value, path);
  assertExactKeys(record, path, ["normalization"], ["audio", "visual", "chat"]);
  if (record.normalization !== "within-signal-rank-and-mad") {
    throw invalid(`${path}.normalization`, "contains an unsupported normalization mode.");
  }
  const expectsVisual = signalKinds.includes("visual");
  const expectsChat = signalKinds.includes("chat");
  const expectsAudio = signalKinds.includes("audio");
  if (expectsAudio !== Object.hasOwn(record, "audio")) {
    throw invalid(`${path}.audio`, "does not agree with signalKinds.");
  }
  if (expectsVisual !== Object.hasOwn(record, "visual")) {
    throw invalid(`${path}.visual`, "does not agree with signalKinds.");
  }
  if (expectsChat !== Object.hasOwn(record, "chat")) {
    throw invalid(`${path}.chat`, "does not agree with signalKinds.");
  }
  if (expectsVisual) {
    assertVisualEvidence(record.visual, `${path}.visual`);
  }
  if (expectsChat) {
    assertChatEvidence(record.chat, `${path}.chat`);
  }
  if (expectsAudio) {
    assertAudioEvidence(record.audio, `${path}.audio`);
  }
}

function assertCandidate(
  value: unknown,
  path: string,
  sourceDurationMs: number,
): asserts value is DurableHighlightCandidate {
  const record = asPlainRecord(value, path);
  assertExactKeys(record, path, [
    "id",
    "peakMs",
    "startMs",
    "endMs",
    "score",
    "signalKinds",
    "evidence",
  ]);
  const signalKinds = signalKindsFor(record.signalKinds, `${path}.signalKinds`);
  const signalId = signalKinds.join("-");
  if (
    typeof record.id !== "string" ||
    !new RegExp(`^highlight-${signalId}-[0-9a-f]{8}$`, "u").test(record.id)
  ) {
    throw invalid(`${path}.id`, "does not match its deterministic signal identifier.");
  }
  for (const key of ["peakMs", "startMs", "endMs"] as const) {
    assertSafeInteger(record[key], `${path}.${key}`);
  }
  assertFiniteNumber(record.score, `${path}.score`);
  const startMs = record.startMs as number;
  const endMs = record.endMs as number;
  const peakMs = record.peakMs as number;
  if (record.score < 0 || record.score > 1) {
    throw invalid(`${path}.score`, "must be between zero and one.");
  }
  if (
    startMs >= endMs ||
    endMs > sourceDurationMs ||
    peakMs < startMs ||
    peakMs > endMs
  ) {
    throw invalid(path, "contains an invalid source timeline window.");
  }
  assertHighlightEvidence(record.evidence, `${path}.evidence`, signalKinds);
}

export function assertDurableFinalResultPayload(
  value: unknown,
  path = "$.result",
): asserts value is DurableFinalResultPayload {
  const record = asPlainRecord(value, path);
  assertExactKeys(record, path, ["input", "summary", "coverage", "candidates"]);
  assertDurableAnalysisInputDescriptor(record.input, `${path}.input`);
  if (record.input.source.kind !== "video") {
    throw invalid(`${path}.input.source.kind`, "must be video for a completed analysis.");
  }
  assertSelectionSummary(record.summary, `${path}.summary`);
  assertCoverageSummary(record.coverage, `${path}.coverage`);
  if (!Array.isArray(record.candidates) || record.candidates.length > 12) {
    throw invalid(`${path}.candidates`, "must be an array of at most 12 candidates.");
  }
  const durationMs = record.input.source.durationMs;
  const candidateIds = new Set<string>();
  record.candidates.forEach((candidate, index) => {
    assertCandidate(candidate, `${path}.candidates[${index}]`, durationMs);
    candidateIds.add(candidate.id);
  });
  if (candidateIds.size !== record.candidates.length) {
    throw invalid(`${path}.candidates`, "must not contain duplicate candidate IDs.");
  }

  const summary = record.summary;
  const coverage = record.coverage;
  if (summary.candidateCount !== record.candidates.length) {
    throw invalid(`${path}.summary.candidateCount`, "does not match the candidate array.");
  }
  if (
    summary.plannedFrameCount !== coverage.visualPlannedSampleCount ||
    summary.sampledFrameCount !== coverage.visualCompletedSampleCount ||
    summary.chatGapReasonCode !== coverage.chatGapReasonCode
  ) {
    throw invalid(path, "contains summary and coverage records that do not agree.");
  }
  if (
    summary.plannedAudioWindowCount !== coverage.audioPlannedWindowCount ||
    summary.analyzedAudioWindowCount !== coverage.audioProcessedWindowCount ||
    summary.audioGapReasonCode !== coverage.audioGapReasonCode
  ) {
    throw invalid(path, "contains audio summary and coverage records that do not agree.");
  }
}

export function assertDurableFailurePayload(
  value: unknown,
  path = "$.result",
): asserts value is DurableFailurePayload {
  const record = asPlainRecord(value, path);
  if (record.outcome === "cancelled") {
    assertExactKeys(record, path, ["outcome", "fenceEpoch"]);
    assertSafeInteger(record.fenceEpoch, `${path}.fenceEpoch`);
    return;
  }
  if (record.outcome === "failed") {
    assertExactKeys(record, path, ["outcome", "reasonCode"]);
    if (record.reasonCode !== "LOCAL_ANALYSIS_FAILED") {
      throw invalid(`${path}.reasonCode`, "contains an unsupported failure reason.");
    }
    return;
  }
  throw invalid(`${path}.outcome`, "contains an unsupported failure outcome.");
}

export function assertDurableBrowserCapabilities(
  value: unknown,
  path = "$.capabilities",
): asserts value is DurableBrowserCapabilities {
  const record = asPlainRecord(value, path);
  assertExactKeys(record, path, [
    "webAssembly",
    "worker",
    "webCodecsVideoDecoder",
    "webGpu",
    "crossOriginIsolated",
    "preferredRuntimeTier",
  ]);
  for (const key of [
    "webAssembly",
    "worker",
    "webCodecsVideoDecoder",
    "webGpu",
    "crossOriginIsolated",
  ] as const) {
    assertBoolean(record[key], `${path}.${key}`);
  }
  assertOneOf(record.preferredRuntimeTier, `${path}.preferredRuntimeTier`, [
    "webgpu",
    "wasm",
    "signals-only",
  ]);
  const expectedTier =
    record.worker && record.webGpu
      ? "webgpu"
      : record.worker && record.webAssembly
        ? "wasm"
        : "signals-only";
  if (record.preferredRuntimeTier !== expectedTier) {
    throw invalid(`${path}.preferredRuntimeTier`, "does not agree with capability flags.");
  }
}

export function expectedBrowserCapabilitySignature(
  capabilities: DurableBrowserCapabilities,
): string {
  return [
    capabilities.preferredRuntimeTier,
    capabilities.worker ? "1" : "0",
    capabilities.webAssembly ? "1" : "0",
    capabilities.webCodecsVideoDecoder ? "1" : "0",
    capabilities.webGpu ? "1" : "0",
    capabilities.crossOriginIsolated ? "1" : "0",
  ].join(":");
}
