import {
  assertDurableBrowserCapabilities,
  assertDurableFailurePayload,
  assertDurableFinalResultPayload,
  assertDurableManifestPayload,
  assertDurableSourceDescriptor,
  DURABLE_ANALYSIS_PERSISTENCE_SCHEMA_VERSION,
  expectedBrowserCapabilitySignature,
  type DurableBrowserCapabilities,
  type DurableFailurePayload,
  type DurableFinalResultPayload,
  type DurableManifestPayload,
  type DurableSourceDescriptor,
} from "./durableAnalysisPayload";
import {
  assertCandidatePassBInsightsRecord,
  candidatePassBInsightSnapshotsExactlyMatch,
  cloneCandidatePassBInsightsRecord,
  type CandidatePassBInsightsRecord,
} from "./candidatePassBInsightStore";
import {
  assertBroadcastContextSessionRecord,
  checkpointBroadcastContextSessionTranscript,
  checkpointBroadcastContextSessionPhaseLedger,
  checkpointBroadcastContextSessionRefinementEvidenceLedger,
  checkpointBroadcastContextSessionRefinementTranscript,
  cloneBroadcastContextSessionRecord,
  commitBroadcastContextSessionContext,
  invalidateBroadcastContextSessionContext,
  parseBroadcastContextSessionRefinementEvidenceLedger,
  type BroadcastContextSessionContextCommit,
  type BroadcastContextSessionPhaseLedgerCheckpoint,
  type BroadcastContextSessionRecord,
  type BroadcastContextSessionRefinementEvidenceLedgerCheckpoint,
  type BroadcastContextSessionRefinementTranscriptCheckpoint,
  type BroadcastContextSessionTranscriptCheckpoint,
} from "./broadcastContextSessionStore";
import {
  parseAnalysisJob,
  type AnalysisJob,
} from "../domain/analysisJob";
import type { ContentDigestAdapter } from "../security/contentFingerprint";

export type JsonPrimitive = string | number | boolean | null;

export type JsonObject = Readonly<{ [key: string]: JsonValue }>;

export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

function cloneCurrentBroadcastContextSessionRecord(
  value: unknown,
): BroadcastContextSessionRecord {
  assertBroadcastContextSessionRecord(value);
  return cloneBroadcastContextSessionRecord(value);
}

export type AnalysisRecordKind =
  "manifest" | "provisionalResult" | "finalResult" | "failure";

interface AnalysisPayloadByKind {
  readonly manifest: DurableManifestPayload;
  readonly provisionalResult: DurableFinalResultPayload;
  readonly finalResult: DurableFinalResultPayload;
  readonly failure: DurableFailurePayload;
}

export interface AnalysisRecord<K extends AnalysisRecordKind> {
  readonly kind: K;
  readonly runId: string;
  readonly artifactId: string;
  readonly schemaVersion: string;
  readonly inputSignature: string;
  readonly modelManifestHash: string;
  readonly result: AnalysisPayloadByKind[K];
  readonly recordedAt: string;
}

export type AnalysisManifestRecord = AnalysisRecord<"manifest">;
export type ProvisionalAnalysisResultRecord =
  AnalysisRecord<"provisionalResult">;
export type FinalAnalysisResultRecord = AnalysisRecord<"finalResult">;
export type AnalysisFailureRecord = AnalysisRecord<"failure">;

export type AnalysisTerminalOutcome =
  "completed" | "completedWithGaps" | "cancelled" | "failed";

/**
 * The sole durable terminal pointer for a run. Final/failure artifacts are
 * staged evidence; recovery must trust a run only when this record exists.
 */
export interface AnalysisTerminalRecord {
  readonly kind: "terminalDisposition";
  readonly runId: string;
  readonly schemaVersion: string;
  readonly inputSignature: string;
  readonly modelManifestHash: string;
  readonly outcome: AnalysisTerminalOutcome;
  readonly resultRecordKind: "finalResult" | "failure";
  readonly resultArtifactId: string;
  readonly recordedAt: string;
}

/**
 * The immutable publication boundary for a usable fast-pass result.
 *
 * Storage implementations commit these three records without overwriting any
 * conflicting record already owned by the run.
 */
export interface FastPassResultArtifactBundle {
  readonly manifest: AnalysisManifestRecord;
  readonly finalResult: FinalAnalysisResultRecord;
  readonly terminal: AnalysisTerminalRecord;
}

/**
 * A durable SourceCheck result. The source itself remains outside this record:
 * only JSON metadata and capability claims may cross the storage boundary.
 */
export interface SourceCapabilitySnapshotRecord {
  readonly kind: "sourceCapabilitySnapshot";
  readonly sourceCheckId: string;
  readonly sourceDefinitionId: string;
  readonly bindingRevision: number;
  readonly schemaVersion: string;
  readonly browserCapabilitySignature: string;
  readonly preflightMetadata: DurableSourceDescriptor;
  readonly capabilities: DurableBrowserCapabilities;
  readonly recordedAt: string;
}

/**
 * 작업 하나의 저장 레코드.
 *
 * 실행 결과와 **같은 데이터베이스에 있다.** 작업을 지우려면 그 작업이 만든 모든
 * Run 의 레코드도 함께 지워야 하는데, 데이터베이스가 갈리면 그 삭제가 원자적이지
 * 않다. 절반만 지워지면 인사이트·대사가 주인 없이 남아 용량을 차지하고, 어느
 * 화면에서도 보이지 않으므로 사용자가 지울 방법조차 없다.
 */
export interface AnalysisJobRecord {
  readonly schemaVersion: typeof ANALYSIS_JOB_RECORD_SCHEMA_VERSION;
  readonly jobId: string;
  readonly job: AnalysisJob;
  /** 마지막으로 무언가 확정된 시각. 보존 기간과 "N일 방치됨" 의 기준. */
  readonly lastActivityAt: string;
  /** 이 작업이 차지하는 대략의 바이트. 상한 판단에 쓴다. */
  readonly bytes: number;
}

/**
 * The exact durable evidence that authorized one final job completion.
 *
 * Candidate detail is nullable because a fully certified empty result may have
 * no Candidate Pass B record. Every other record is required.
 */
export interface AnalysisCompletionDurableSnapshot {
  readonly manifest: AnalysisManifestRecord;
  readonly fastResult: FinalAnalysisResultRecord;
  readonly fastTerminal: AnalysisTerminalRecord;
  readonly session: BroadcastContextSessionRecord;
  readonly candidateRecord: CandidatePassBInsightsRecord | null;
}

/**
 * One transactionally consistent read of the job and all completion evidence.
 * `snapshot === null` means at least one required record was absent.
 */
export interface AnalysisCompletionDurableReadback {
  readonly job: AnalysisJobRecord | null;
  readonly snapshot: AnalysisCompletionDurableSnapshot | null;
}

export interface AnalysisResultStore {
  putJob(record: AnalysisJobRecord): Promise<void>;
  replaceJobIfUnchanged(
    expected: AnalysisJobRecord | null,
    replacement: AnalysisJobRecord,
  ): Promise<boolean>;
  replaceJobIfAnalysisSnapshotUnchanged(
    expected: AnalysisJobRecord,
    replacement: AnalysisJobRecord,
    expectedSnapshot: AnalysisCompletionDurableSnapshot,
  ): Promise<boolean>;
  getAnalysisCompletionReadback(
    jobId: string,
    runId: string,
  ): Promise<AnalysisCompletionDurableReadback>;
  getJob(jobId: string): Promise<AnalysisJobRecord | null>;
  listJobs(): Promise<readonly AnalysisJobRecord[]>;
  /** 작업과 그 작업이 만든 모든 실행 결과를 함께 지운다. */
  deleteJob(jobId: string): Promise<void>;
  putManifest(record: AnalysisManifestRecord): Promise<void>;
  insertManifestIfAbsent(record: AnalysisManifestRecord): Promise<boolean>;
  getManifest(runId: string): Promise<AnalysisManifestRecord | null>;
  putProvisionalResult(record: ProvisionalAnalysisResultRecord): Promise<void>;
  putFinalResult(record: FinalAnalysisResultRecord): Promise<void>;
  putFailureRecord(record: AnalysisFailureRecord): Promise<void>;
  getFinalResult(runId: string): Promise<FinalAnalysisResultRecord | null>;
  putTerminalRecord(record: AnalysisTerminalRecord): Promise<void>;
  getTerminalRecord(runId: string): Promise<AnalysisTerminalRecord | null>;
  commitFastPassResultBundleIfAbsent(
    bundle: FastPassResultArtifactBundle,
  ): Promise<boolean>;
  listTerminalRecords(): Promise<AnalysisTerminalRecordCatalog>;
  putSourceSnapshot(record: SourceCapabilitySnapshotRecord): Promise<void>;
  getSourceSnapshot(
    sourceCheckId: string,
  ): Promise<SourceCapabilitySnapshotRecord | null>;
  putCandidatePassBInsights(
    record: CandidatePassBInsightsRecord,
  ): Promise<void>;
  replaceCandidatePassBInsightsIfUnchanged(
    expected: CandidatePassBInsightsRecord | null,
    replacement: CandidatePassBInsightsRecord,
  ): Promise<boolean>;
  getCandidatePassBInsights(
    runId: string,
  ): Promise<CandidatePassBInsightsRecord | null>;
  putBroadcastContextSession(
    record: BroadcastContextSessionRecord,
  ): Promise<void>;
  insertBroadcastContextSessionIfAbsent(
    record: BroadcastContextSessionRecord,
  ): Promise<boolean>;
  replaceBroadcastContextSessionIfUnchanged(
    expected: BroadcastContextSessionRecord,
    replacement: BroadcastContextSessionRecord,
  ): Promise<boolean>;
  getBroadcastContextSession(
    runId: string,
  ): Promise<BroadcastContextSessionRecord | null>;
  close(): void;
}

type BroadcastContextSessionCompareAndSwapStore = Pick<
  AnalysisResultStore,
  "replaceBroadcastContextSessionIfUnchanged"
>;

type BroadcastContextSessionCheckpointReadbackStore = Pick<
  AnalysisResultStore,
  "replaceBroadcastContextSessionIfUnchanged" | "getBroadcastContextSession"
>;

/**
 * Atomically replaces one exact transcript-map snapshot together with its
 * source-fenced no-speech/no-audio evidence. A stale tab cannot split the two
 * records or overwrite a newer checkpoint.
 */
export function checkpointBroadcastContextSessionTranscriptIfUnchanged(
  store: BroadcastContextSessionCompareAndSwapStore,
  expected: BroadcastContextSessionRecord,
  checkpoint: BroadcastContextSessionTranscriptCheckpoint,
): Promise<boolean> {
  return store.replaceBroadcastContextSessionIfUnchanged(
    expected,
    checkpointBroadcastContextSessionTranscript(expected, checkpoint),
  );
}

/**
 * Invalidates a whole-context result only while the durable session still
 * equals the caller's exact snapshot. A stale tab or late callback receives
 * `false` and cannot erase a newer context or refinement.
 */
export function invalidateBroadcastContextSessionContextIfUnchanged(
  store: BroadcastContextSessionCompareAndSwapStore,
  expected: BroadcastContextSessionRecord,
  recordedAt: string,
): Promise<boolean> {
  return store.replaceBroadcastContextSessionIfUnchanged(
    expected,
    invalidateBroadcastContextSessionContext(expected, recordedAt),
  );
}

/**
 * Commits a new exact-input-bound whole-context result with CAS semantics.
 * Refinements from the previous parent context are cleared by the validated
 * replacement builder before the storage transaction starts.
 */
export function commitBroadcastContextSessionContextIfUnchanged(
  store: BroadcastContextSessionCompareAndSwapStore,
  expected: BroadcastContextSessionRecord,
  commit: BroadcastContextSessionContextCommit,
): Promise<boolean> {
  return store.replaceBroadcastContextSessionIfUnchanged(
    expected,
    commitBroadcastContextSessionContext(expected, commit),
  );
}

/**
 * Persists one exact-input-bound phase-ledger checkpoint with CAS semantics.
 * A stale tab cannot overwrite a newer ledger transition or context result.
 */
export function checkpointBroadcastContextSessionPhaseLedgerIfUnchanged(
  store: BroadcastContextSessionCompareAndSwapStore,
  expected: BroadcastContextSessionRecord,
  checkpoint: BroadcastContextSessionPhaseLedgerCheckpoint,
): Promise<boolean> {
  return store.replaceBroadcastContextSessionIfUnchanged(
    expected,
    checkpointBroadcastContextSessionPhaseLedger(expected, checkpoint),
  );
}

/**
 * Persists one exact-input-bound no-caption refinement transcript checkpoint
 * with CAS semantics. A stale tab cannot replace newer fragment settlements or
 * preserve semantic candidates derived from different transcript evidence.
 */
export function checkpointBroadcastContextSessionRefinementTranscriptIfUnchanged(
  store: BroadcastContextSessionCompareAndSwapStore,
  expected: BroadcastContextSessionRecord,
  checkpoint: BroadcastContextSessionRefinementTranscriptCheckpoint,
): Promise<boolean> {
  return store.replaceBroadcastContextSessionIfUnchanged(
    expected,
    checkpointBroadcastContextSessionRefinementTranscript(
      expected,
      checkpoint,
    ),
  );
}

/**
 * Persists one canonical refinement-evidence ledger with exact-session CAS,
 * then proves the exact replacement and its SHA-256 ledger fences can be read
 * back before the caller advances to another paid or semantic operation.
 */
export async function checkpointBroadcastContextSessionRefinementEvidenceLedgerWithReadback(
  store: BroadcastContextSessionCheckpointReadbackStore,
  expected: BroadcastContextSessionRecord,
  checkpoint: BroadcastContextSessionRefinementEvidenceLedgerCheckpoint,
  digestAdapter: ContentDigestAdapter | null = globalThis.crypto?.subtle ?? null,
): Promise<BroadcastContextSessionRecord> {
  const expectedSnapshot = cloneBroadcastContextSessionRecord(expected);
  const replacement =
    await checkpointBroadcastContextSessionRefinementEvidenceLedger(
      expectedSnapshot,
      checkpoint,
      digestAdapter,
    );
  const replaced = await store.replaceBroadcastContextSessionIfUnchanged(
    expectedSnapshot,
    replacement,
  );
  if (!replaced) {
    throw new Error(
      "Broadcast refinement evidence checkpoint was rejected because the durable session changed.",
    );
  }
  const readback = await store.getBroadcastContextSession(replacement.runId);
  if (readback === null) {
    throw new Error(
      "Broadcast refinement evidence checkpoint could not be verified: readback is missing.",
    );
  }
  let verifiedReadback: BroadcastContextSessionRecord;
  try {
    verifiedReadback = cloneBroadcastContextSessionRecord(readback);
    await parseBroadcastContextSessionRefinementEvidenceLedger(
      verifiedReadback,
      digestAdapter,
    );
  } catch (error) {
    throw new Error(
      "Broadcast refinement evidence checkpoint could not be verified: readback is invalid.",
      { cause: error },
    );
  }
  if (JSON.stringify(verifiedReadback) !== JSON.stringify(replacement)) {
    throw new Error(
      "Broadcast refinement evidence checkpoint could not be verified: readback does not exactly match the written session.",
    );
  }
  return verifiedReadback;
}

export interface AnalysisTerminalRecordCatalog {
  readonly records: readonly AnalysisTerminalRecord[];
  readonly rejectedRecordCount: number;
}

export type AnalysisResultStoreErrorCode =
  | "STORE_CLOSED"
  | "INDEXED_DB_UNAVAILABLE"
  | "INVALID_PAYLOAD"
  | "SCHEMA_MISMATCH"
  | "OPEN_BLOCKED"
  | "OPEN_FAILED"
  | "TRANSACTION_FAILED";

export class AnalysisResultStoreError extends Error {
  public readonly code: AnalysisResultStoreErrorCode;
  public readonly originalCause: unknown;

  public constructor(
    code: AnalysisResultStoreErrorCode,
    message: string,
    originalCause?: unknown,
  ) {
    super(message);
    this.name = "AnalysisResultStoreError";
    this.code = code;
    this.originalCause = originalCause;
  }
}

export const DEFAULT_ANALYSIS_RESULT_DB_NAME =
  "exclipper-analysis-results-v1";
export const ANALYSIS_RESULT_DB_VERSION = 1;
export const ANALYSIS_JOB_RECORD_SCHEMA_VERSION = "1.0.0" as const;

export const ANALYSIS_RESULT_OBJECT_STORES = {
  jobs: "analysisJobs",
  manifests: "analysisManifests",
  provisionalResults: "provisionalAnalysisResults",
  finalResults: "finalAnalysisResults",
  failures: "analysisFailures",
  terminals: "analysisTerminalDispositions",
  sourceSnapshots: "sourceCapabilitySnapshots",
  candidatePassBInsights: "candidatePassBInsights",
  broadcastContextSessions: "broadcastContextSessions",
} as const;

type AnalysisStoreName =
  (typeof ANALYSIS_RESULT_OBJECT_STORES)[keyof typeof ANALYSIS_RESULT_OBJECT_STORES];

type AnyAnalysisRecord =
  | AnalysisManifestRecord
  | ProvisionalAnalysisResultRecord
  | FinalAnalysisResultRecord
  | AnalysisFailureRecord;

const ALL_OBJECT_STORES = Object.values(ANALYSIS_RESULT_OBJECT_STORES);

const ANALYSIS_COMPLETION_OBJECT_STORES = [
  ANALYSIS_RESULT_OBJECT_STORES.jobs,
  ANALYSIS_RESULT_OBJECT_STORES.manifests,
  ANALYSIS_RESULT_OBJECT_STORES.finalResults,
  ANALYSIS_RESULT_OBJECT_STORES.terminals,
  ANALYSIS_RESULT_OBJECT_STORES.broadcastContextSessions,
  ANALYSIS_RESULT_OBJECT_STORES.candidatePassBInsights,
] as const;

const FAST_PASS_RESULT_OBJECT_STORES = [
  ANALYSIS_RESULT_OBJECT_STORES.manifests,
  ANALYSIS_RESULT_OBJECT_STORES.finalResults,
  ANALYSIS_RESULT_OBJECT_STORES.terminals,
] as const;

const FORBIDDEN_PROPERTY_NAMES = new Set([
  "authorid",
  "authorname",
  "bloburl",
  "channelid",
  "chatcontent",
  "chatline",
  "chatlines",
  "chatlog",
  "chatlogs",
  "chatmessage",
  "chatmessages",
  "chattext",
  "displayname",
  "file",
  "filehandle",
  "filesystemhandle",
  "handle",
  "message",
  "messages",
  "nickname",
  "nicknames",
  "objecturl",
  "rawfile",
  "rawmessage",
  "rawmessages",
  "senderid",
  "sendername",
  "sourcefile",
  "transcript",
  "transcripts",
  "utterance",
  "utterances",
  "userid",
  "username",
]);

function payloadError(
  message: string,
  cause?: unknown,
): AnalysisResultStoreError {
  return new AnalysisResultStoreError("INVALID_PAYLOAD", message, cause);
}

function normalizePropertyName(propertyName: string): string {
  return propertyName.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function assertSafePropertyName(propertyName: string, path: string): void {
  const normalized = normalizePropertyName(propertyName);
  if (
    FORBIDDEN_PROPERTY_NAMES.has(normalized) ||
    normalized.includes("rawchat") ||
    normalized.includes("nickname") ||
    normalized.includes("objecturl") ||
    normalized.includes("filesystemhandle") ||
    normalized.endsWith("filehandle")
  ) {
    throw payloadError(
      `${path}.${propertyName} is not permitted in durable analysis data.`,
    );
  }
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function assertSafeJsonValue(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): asserts value is JsonValue {
  if (value === null || typeof value === "boolean") {
    return;
  }

  if (typeof value === "string") {
    if (value.trimStart().toLowerCase().startsWith("blob:")) {
      throw payloadError(`${path} contains a temporary Object URL.`);
    }
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw payloadError(`${path} must contain a finite number.`);
    }
    return;
  }

  if (typeof value !== "object") {
    throw payloadError(`${path} is not JSON-serializable.`);
  }

  if (ancestors.has(value)) {
    throw payloadError(`${path} contains a circular reference.`);
  }

  if (!Array.isArray(value) && !isPlainObject(value)) {
    throw payloadError(
      `${path} contains a File, handle, Blob, or another non-JSON object.`,
    );
  }

  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw payloadError(`${path} contains symbol-keyed data.`);
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [propertyName, descriptor] of Object.entries(descriptors)) {
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      throw payloadError(
        `${path}.${propertyName} must be a plain data property.`,
      );
    }
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw payloadError(`${path}[${index}] is a sparse array entry.`);
        }
        assertSafeJsonValue(value[index], `${path}[${index}]`, ancestors);
      }
      return;
    }

    for (const [propertyName, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable) {
        continue;
      }
      assertSafePropertyName(propertyName, path);
      assertSafeJsonValue(
        descriptor.value,
        `${path}.${propertyName}`,
        ancestors,
      );
    }
  } finally {
    ancestors.delete(value);
  }
}

function assertIdentifier(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw payloadError(`${label} must be a non-empty string.`);
  }
}

function assertOperationIdentifier(
  value: unknown,
  label: string,
): asserts value is string {
  assertIdentifier(value, label);
  if (value.length > 180 || !/^[a-z][a-z0-9-]*$/u.test(value)) {
    throw payloadError(`${label} must be a bounded generated identifier.`);
  }
}

function assertCurrentAnalysisSchemaVersion(
  value: unknown,
): asserts value is typeof DURABLE_ANALYSIS_PERSISTENCE_SCHEMA_VERSION {
  if (value !== DURABLE_ANALYSIS_PERSISTENCE_SCHEMA_VERSION) {
    throw payloadError(
      `schemaVersion must be exactly ${DURABLE_ANALYSIS_PERSISTENCE_SCHEMA_VERSION}.`,
    );
  }
}

function assertInputSignature(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw payloadError("inputSignature must be a SHA-256 analysis signature.");
  }
}

function assertModelManifestHash(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length > 128 ||
    !/^[a-z0-9][a-z0-9._-]*$/u.test(value)
  ) {
    throw payloadError(
      "modelManifestHash must be a bounded engine identifier.",
    );
  }
}

function assertRecordedAt(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw payloadError("recordedAt must be a canonical UTC timestamp.");
  }
}

function assertExactRootKeys(
  record: Readonly<Record<string, JsonValue>>,
  required: readonly string[],
): void {
  const allowed = new Set(required);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw payloadError(`$.${key} is not an allowed durable record field.`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(record, key)) {
      throw payloadError(`$.${key} is required.`);
    }
  }
}

function asRecord(value: JsonValue): Readonly<Record<string, JsonValue>> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw payloadError("The durable record must be a JSON object.");
  }
  return value as JsonObject;
}

function assertAnalysisRecord(
  value: unknown,
  expectedKind: AnalysisRecordKind,
): asserts value is AnyAnalysisRecord {
  assertSafeJsonValue(value, "$", new Set<object>());
  const record = asRecord(value);

  assertExactRootKeys(record, [
    "kind",
    "runId",
    "artifactId",
    "schemaVersion",
    "inputSignature",
    "modelManifestHash",
    "result",
    "recordedAt",
  ]);

  if (record.kind !== expectedKind) {
    throw payloadError(`Record kind must be ${expectedKind}.`);
  }
  assertOperationIdentifier(record.runId, "runId");
  assertOperationIdentifier(record.artifactId, "artifactId");
  assertCurrentAnalysisSchemaVersion(record.schemaVersion);
  assertInputSignature(record.inputSignature);
  assertModelManifestHash(record.modelManifestHash);
  assertRecordedAt(record.recordedAt);
  try {
    if (expectedKind === "manifest") {
      assertDurableManifestPayload(record.result);
    } else if (expectedKind === "failure") {
      assertDurableFailurePayload(record.result);
    } else {
      assertDurableFinalResultPayload(record.result);
    }
  } catch (cause) {
    throw payloadError(
      cause instanceof Error
        ? cause.message
        : "The analysis payload is invalid.",
      cause,
    );
  }
}

function assertSourceSnapshotRecord(
  value: unknown,
): asserts value is SourceCapabilitySnapshotRecord {
  assertSafeJsonValue(value, "$", new Set<object>());
  const record = asRecord(value);

  assertExactRootKeys(record, [
    "kind",
    "sourceCheckId",
    "sourceDefinitionId",
    "bindingRevision",
    "schemaVersion",
    "browserCapabilitySignature",
    "preflightMetadata",
    "capabilities",
    "recordedAt",
  ]);

  if (record.kind !== "sourceCapabilitySnapshot") {
    throw payloadError("Record kind must be sourceCapabilitySnapshot.");
  }
  assertOperationIdentifier(record.sourceCheckId, "sourceCheckId");
  assertOperationIdentifier(record.sourceDefinitionId, "sourceDefinitionId");
  assertCurrentAnalysisSchemaVersion(record.schemaVersion);
  assertRecordedAt(record.recordedAt);
  if (
    typeof record.bindingRevision !== "number" ||
    !Number.isSafeInteger(record.bindingRevision) ||
    record.bindingRevision < 0
  ) {
    throw payloadError("bindingRevision must be a non-negative safe integer.");
  }
  const preflightMetadata = record.preflightMetadata;
  const capabilities = record.capabilities;
  try {
    assertDurableSourceDescriptor(preflightMetadata, "$.preflightMetadata");
    assertDurableBrowserCapabilities(capabilities, "$.capabilities");
  } catch (cause) {
    throw payloadError(
      cause instanceof Error
        ? cause.message
        : "The source capability payload is invalid.",
      cause,
    );
  }
  if (
    typeof record.browserCapabilitySignature !== "string" ||
    record.browserCapabilitySignature !==
      expectedBrowserCapabilitySignature(capabilities)
  ) {
    throw payloadError(
      "browserCapabilitySignature must be derived exactly from the stored capability flags.",
    );
  }
}

function assertTerminalRecord(
  value: unknown,
): asserts value is AnalysisTerminalRecord {
  assertSafeJsonValue(value, "$", new Set<object>());
  const record = asRecord(value);
  assertExactRootKeys(record, [
    "kind",
    "runId",
    "schemaVersion",
    "inputSignature",
    "modelManifestHash",
    "outcome",
    "resultRecordKind",
    "resultArtifactId",
    "recordedAt",
  ]);
  if (record.kind !== "terminalDisposition") {
    throw payloadError("Record kind must be terminalDisposition.");
  }
  assertOperationIdentifier(record.runId, "runId");
  assertCurrentAnalysisSchemaVersion(record.schemaVersion);
  assertInputSignature(record.inputSignature);
  assertModelManifestHash(record.modelManifestHash);
  assertOperationIdentifier(record.resultArtifactId, "resultArtifactId");
  assertRecordedAt(record.recordedAt);
  if (
    record.outcome !== "completed" &&
    record.outcome !== "completedWithGaps" &&
    record.outcome !== "cancelled" &&
    record.outcome !== "failed"
  ) {
    throw payloadError("outcome is not a supported terminal disposition.");
  }
  if (
    record.resultRecordKind !== "finalResult" &&
    record.resultRecordKind !== "failure"
  ) {
    throw payloadError(
      "resultRecordKind must reference finalResult or failure.",
    );
  }
  if (
    (record.outcome === "completed" ||
      record.outcome === "completedWithGaps") !==
    (record.resultRecordKind === "finalResult")
  ) {
    throw payloadError("Terminal outcome and resultRecordKind do not agree.");
  }
}

function cloneJson<T>(value: T): T {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch (cause) {
    throw payloadError(
      "The durable record could not be serialized as JSON.",
      cause,
    );
  }
  if (serialized === undefined) {
    throw payloadError("The durable record could not be serialized as JSON.");
  }
  return JSON.parse(serialized) as T;
}

function validateAndCloneAnalysisRecord<T extends AnyAnalysisRecord>(
  record: T,
  expectedKind: T["kind"],
): T {
  assertAnalysisRecord(record, expectedKind);
  return cloneJson(record);
}

function validateAndCloneSourceSnapshot(
  record: SourceCapabilitySnapshotRecord,
): SourceCapabilitySnapshotRecord {
  assertSourceSnapshotRecord(record);
  return cloneJson(record);
}

function validateAndCloneTerminalRecord(
  record: AnalysisTerminalRecord,
): AnalysisTerminalRecord {
  assertTerminalRecord(record);
  return cloneJson(record);
}

function validateAndCloneFastPassResultArtifactBundle(
  bundle: FastPassResultArtifactBundle,
): FastPassResultArtifactBundle {
  const cloned: FastPassResultArtifactBundle = {
    manifest: validateAndCloneAnalysisRecord(bundle.manifest, "manifest"),
    finalResult: validateAndCloneAnalysisRecord(
      bundle.finalResult,
      "finalResult",
    ),
    terminal: validateAndCloneTerminalRecord(bundle.terminal),
  };
  const { manifest, finalResult, terminal } = cloned;
  if (
    manifest.runId !== finalResult.runId ||
    manifest.runId !== terminal.runId ||
    manifest.schemaVersion !== finalResult.schemaVersion ||
    manifest.schemaVersion !== terminal.schemaVersion ||
    manifest.inputSignature !== finalResult.inputSignature ||
    manifest.inputSignature !== terminal.inputSignature ||
    manifest.modelManifestHash !== finalResult.modelManifestHash ||
    manifest.modelManifestHash !== terminal.modelManifestHash ||
    terminal.resultRecordKind !== "finalResult" ||
    terminal.resultArtifactId !== finalResult.artifactId ||
    (terminal.outcome !== "completed" &&
      terminal.outcome !== "completedWithGaps")
  ) {
    throw payloadError(
      "Fast-pass manifest, final result, and terminal do not form one completed publication bundle.",
    );
  }
  return cloned;
}

function exactJsonSnapshot(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertJobRecord(value: unknown): asserts value is AnalysisJobRecord {
  assertSafeJsonValue(value, "$", new Set<object>());
  const record = asRecord(value);
  assertExactRootKeys(record, [
    "schemaVersion",
    "jobId",
    "job",
    "lastActivityAt",
    "bytes",
  ]);
  if (record.schemaVersion !== ANALYSIS_JOB_RECORD_SCHEMA_VERSION) {
    throw payloadError(
      `Analysis job schemaVersion must be exactly ${ANALYSIS_JOB_RECORD_SCHEMA_VERSION}.`,
    );
  }
  assertIdentifier(record.jobId, "jobId");
  assertRecordedAt(record.lastActivityAt);
  if (
    typeof record.bytes !== "number" ||
    !Number.isFinite(record.bytes) ||
    record.bytes < 0
  ) {
    throw payloadError(
      "Analysis job record must carry a non-negative byte count.",
    );
  }
  let job: AnalysisJob;
  try {
    job = parseAnalysisJob(record.job);
  } catch (cause) {
    throw payloadError(
      "Analysis job record must carry one exact current AnalysisJob.",
      cause,
    );
  }
  if (job.jobId !== record.jobId) {
    // 키와 내용이 어긋나면 조회는 되는데 잘못된 작업을 지우게 된다.
    throw payloadError(
      "Analysis job record key does not match the job it holds.",
    );
  }
  // 나머지는 JSON 안전성만 확인한다 — 상태 규칙은 도메인의 전이표가 지킨다.
}

function validateAndCloneJobRecord(
  record: AnalysisJobRecord,
): AnalysisJobRecord {
  assertJobRecord(record);
  return cloneJson(record);
}

function analysisJobSnapshotsExactlyMatch(
  left: AnalysisJobRecord | null,
  right: AnalysisJobRecord | null,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateAndCloneAnalysisCompletionSnapshot(
  snapshot: AnalysisCompletionDurableSnapshot,
): AnalysisCompletionDurableSnapshot {
  let cloned: AnalysisCompletionDurableSnapshot;
  try {
    cloned = {
      manifest: validateAndCloneAnalysisRecord(snapshot.manifest, "manifest"),
      fastResult: validateAndCloneAnalysisRecord(
        snapshot.fastResult,
        "finalResult",
      ),
      fastTerminal: validateAndCloneTerminalRecord(snapshot.fastTerminal),
      session: cloneCurrentBroadcastContextSessionRecord(snapshot.session),
      candidateRecord:
        snapshot.candidateRecord === null
          ? null
          : cloneCandidatePassBInsightsRecord(snapshot.candidateRecord),
    };
  } catch (cause) {
    if (cause instanceof AnalysisResultStoreError) {
      throw cause;
    }
    throw payloadError(
      "The analysis completion snapshot is not a canonical durable record set.",
      cause,
    );
  }

  const runId = cloned.manifest.runId;
  if (
    cloned.fastResult.runId !== runId ||
    cloned.fastTerminal.runId !== runId ||
    cloned.session.runId !== runId ||
    (cloned.candidateRecord !== null &&
      cloned.candidateRecord.runId !== runId)
  ) {
    throw payloadError(
      "Every analysis completion record must belong to one run.",
    );
  }
  return cloned;
}

function assertCompletionJobFence(
  expected: AnalysisJobRecord,
  replacement: AnalysisJobRecord,
  snapshot: AnalysisCompletionDurableSnapshot,
): void {
  if (expected.jobId !== replacement.jobId) {
    throw payloadError(
      "Analysis completion compare-and-swap records must share one job id.",
    );
  }
  const runId = snapshot.manifest.runId;
  if (
    expected.job.runIds.at(-1) !== runId ||
    replacement.job.runIds.at(-1) !== runId
  ) {
    throw payloadError(
      "The completion snapshot must belong to the latest run of the job.",
    );
  }
}

export function analysisCompletionSnapshotsExactlyMatch(
  left: AnalysisCompletionDurableSnapshot,
  right: AnalysisCompletionDurableSnapshot,
): boolean {
  return (
    JSON.stringify(left.manifest) === JSON.stringify(right.manifest) &&
    JSON.stringify(left.fastResult) === JSON.stringify(right.fastResult) &&
    JSON.stringify(left.fastTerminal) === JSON.stringify(right.fastTerminal) &&
    JSON.stringify(left.session) === JSON.stringify(right.session) &&
    candidatePassBInsightSnapshotsExactlyMatch(
      left.candidateRecord,
      right.candidateRecord,
    )
  );
}

function terminalRecordsAreEquivalent(
  left: AnalysisTerminalRecord,
  right: AnalysisTerminalRecord,
): boolean {
  return (
    left.kind === right.kind &&
    left.runId === right.runId &&
    left.schemaVersion === right.schemaVersion &&
    left.inputSignature === right.inputSignature &&
    left.modelManifestHash === right.modelManifestHash &&
    left.outcome === right.outcome &&
    left.resultRecordKind === right.resultRecordKind &&
    left.resultArtifactId === right.resultArtifactId &&
    left.recordedAt === right.recordedAt
  );
}

function terminalConflictError(runId: string): AnalysisResultStoreError {
  return new AnalysisResultStoreError(
    "TRANSACTION_FAILED",
    `The terminal disposition for ${runId} is already committed and cannot be replaced.`,
  );
}

function rejectedOperation<T>(operation: () => T): Promise<T> {
  return Promise.resolve().then(operation);
}

function storeClosedError(): AnalysisResultStoreError {
  return new AnalysisResultStoreError(
    "STORE_CLOSED",
    "The analysis result store is closed.",
  );
}

export class InMemoryAnalysisResultStore implements AnalysisResultStore {
  private readonly manifests = new Map<string, AnalysisManifestRecord>();
  private readonly provisionalResults = new Map<
    string,
    ProvisionalAnalysisResultRecord
  >();
  private readonly finalResults = new Map<string, FinalAnalysisResultRecord>();
  private readonly failures = new Map<string, AnalysisFailureRecord>();
  private readonly terminals = new Map<string, AnalysisTerminalRecord>();
  private readonly sourceSnapshots = new Map<
    string,
    SourceCapabilitySnapshotRecord
  >();
  private readonly candidatePassBInsights = new Map<
    string,
    CandidatePassBInsightsRecord
  >();
  private readonly broadcastContextSessions = new Map<
    string,
    BroadcastContextSessionRecord
  >();
  private readonly jobs = new Map<string, AnalysisJobRecord>();
  private closed = false;

  public putJob(record: AnalysisJobRecord): Promise<void> {
    return rejectedOperation(() => {
      this.assertOpen();
      const snapshot = validateAndCloneJobRecord(record);
      this.jobs.set(snapshot.jobId, snapshot);
    });
  }

  public replaceJobIfUnchanged(
    expected: AnalysisJobRecord | null,
    replacement: AnalysisJobRecord,
  ): Promise<boolean> {
    return rejectedOperation(() => {
      this.assertOpen();
      const expectedSnapshot =
        expected === null ? null : validateAndCloneJobRecord(expected);
      const replacementSnapshot = validateAndCloneJobRecord(replacement);
      if (
        expectedSnapshot !== null &&
        expectedSnapshot.jobId !== replacementSnapshot.jobId
      ) {
        throw new AnalysisResultStoreError(
          "INVALID_PAYLOAD",
          "Analysis job compare-and-swap records must share one job id.",
        );
      }
      const current = this.jobs.get(replacementSnapshot.jobId) ?? null;
      if (!analysisJobSnapshotsExactlyMatch(expectedSnapshot, current)) {
        return false;
      }
      this.jobs.set(replacementSnapshot.jobId, replacementSnapshot);
      return true;
    });
  }

  public replaceJobIfAnalysisSnapshotUnchanged(
    expected: AnalysisJobRecord,
    replacement: AnalysisJobRecord,
    expectedSnapshot: AnalysisCompletionDurableSnapshot,
  ): Promise<boolean> {
    return rejectedOperation(() => {
      this.assertOpen();
      const expectedJob = validateAndCloneJobRecord(expected);
      const replacementJob = validateAndCloneJobRecord(replacement);
      const snapshot =
        validateAndCloneAnalysisCompletionSnapshot(expectedSnapshot);
      assertCompletionJobFence(expectedJob, replacementJob, snapshot);

      const runId = snapshot.manifest.runId;
      const currentJob = this.jobs.get(replacementJob.jobId) ?? null;
      const currentManifest = this.manifests.get(runId);
      const currentFastResult = this.finalResults.get(runId);
      const currentFastTerminal = this.terminals.get(runId);
      const currentSession = this.broadcastContextSessions.get(runId);
      if (
        !analysisJobSnapshotsExactlyMatch(expectedJob, currentJob) ||
        currentManifest === undefined ||
        currentFastResult === undefined ||
        currentFastTerminal === undefined ||
        currentSession === undefined
      ) {
        return false;
      }
      const currentSnapshot =
        validateAndCloneAnalysisCompletionSnapshot({
          manifest: currentManifest,
          fastResult: currentFastResult,
          fastTerminal: currentFastTerminal,
          session: currentSession,
          candidateRecord: this.candidatePassBInsights.get(runId) ?? null,
        });
      if (
        !analysisCompletionSnapshotsExactlyMatch(snapshot, currentSnapshot)
      ) {
        return false;
      }
      this.jobs.set(replacementJob.jobId, replacementJob);
      return true;
    });
  }

  public getAnalysisCompletionReadback(
    jobId: string,
    runId: string,
  ): Promise<AnalysisCompletionDurableReadback> {
    return rejectedOperation(() => {
      this.assertOpen();
      assertIdentifier(jobId, "jobId");
      assertIdentifier(runId, "runId");
      const job = this.jobs.get(jobId);
      const manifest = this.manifests.get(runId);
      const fastResult = this.finalResults.get(runId);
      const fastTerminal = this.terminals.get(runId);
      const session = this.broadcastContextSessions.get(runId);
      return {
        job: job === undefined ? null : validateAndCloneJobRecord(job),
        snapshot:
          manifest === undefined ||
          fastResult === undefined ||
          fastTerminal === undefined ||
          session === undefined
            ? null
            : validateAndCloneAnalysisCompletionSnapshot({
                manifest,
                fastResult,
                fastTerminal,
                session,
                candidateRecord:
                  this.candidatePassBInsights.get(runId) ?? null,
              }),
      };
    });
  }

  public getJob(jobId: string): Promise<AnalysisJobRecord | null> {
    return rejectedOperation(() => {
      this.assertOpen();
      assertIdentifier(jobId, "jobId");
      const record = this.jobs.get(jobId);
      return record === undefined ? null : cloneJson(record);
    });
  }

  public listJobs(): Promise<readonly AnalysisJobRecord[]> {
    return rejectedOperation(() => {
      this.assertOpen();
      return [...this.jobs.values()].map((record) => cloneJson(record));
    });
  }

  public deleteJob(jobId: string): Promise<void> {
    return rejectedOperation(() => {
      this.assertOpen();
      assertIdentifier(jobId, "jobId");
      const record = this.jobs.get(jobId);
      if (record === undefined) {
        return;
      }
      // 실행 결과를 먼저 지운다. 작업 레코드가 먼저 사라지면 `runIds` 를 잃어
      // 남은 결과를 찾을 방법이 없어진다.
      for (const runId of record.job.runIds) {
        this.manifests.delete(runId);
        this.provisionalResults.delete(runId);
        this.finalResults.delete(runId);
        this.failures.delete(runId);
        this.terminals.delete(runId);
        this.candidatePassBInsights.delete(runId);
        this.broadcastContextSessions.delete(runId);
      }
      this.jobs.delete(jobId);
    });
  }

  public putManifest(record: AnalysisManifestRecord): Promise<void> {
    return this.putAnalysisRecord(this.manifests, record, "manifest");
  }

  public insertManifestIfAbsent(
    record: AnalysisManifestRecord,
  ): Promise<boolean> {
    return rejectedOperation(() => {
      this.assertOpen();
      const snapshot = validateAndCloneAnalysisRecord(record, "manifest");
      const existing = this.manifests.get(snapshot.runId);
      if (existing !== undefined) {
        return exactJsonSnapshot(existing, snapshot);
      }
      this.manifests.set(snapshot.runId, snapshot);
      return true;
    });
  }

  public getManifest(runId: string): Promise<AnalysisManifestRecord | null> {
    return rejectedOperation(() => {
      this.assertOpen();
      assertIdentifier(runId, "runId");
      const record = this.manifests.get(runId);
      return record === undefined ? null : cloneJson(record);
    });
  }

  public putProvisionalResult(
    record: ProvisionalAnalysisResultRecord,
  ): Promise<void> {
    return this.putAnalysisRecord(
      this.provisionalResults,
      record,
      "provisionalResult",
    );
  }

  public putFinalResult(record: FinalAnalysisResultRecord): Promise<void> {
    return this.putAnalysisRecord(this.finalResults, record, "finalResult");
  }

  public putFailureRecord(record: AnalysisFailureRecord): Promise<void> {
    return this.putAnalysisRecord(this.failures, record, "failure");
  }

  public getFinalResult(
    runId: string,
  ): Promise<FinalAnalysisResultRecord | null> {
    return rejectedOperation(() => {
      this.assertOpen();
      assertIdentifier(runId, "runId");
      const record = this.finalResults.get(runId);
      return record === undefined ? null : cloneJson(record);
    });
  }

  public putTerminalRecord(record: AnalysisTerminalRecord): Promise<void> {
    return rejectedOperation(() => {
      this.assertOpen();
      const snapshot = validateAndCloneTerminalRecord(record);
      const existing = this.terminals.get(snapshot.runId);
      if (existing !== undefined) {
        if (terminalRecordsAreEquivalent(existing, snapshot)) {
          return;
        }
        throw terminalConflictError(snapshot.runId);
      }
      this.terminals.set(snapshot.runId, snapshot);
    });
  }

  public getTerminalRecord(
    runId: string,
  ): Promise<AnalysisTerminalRecord | null> {
    return rejectedOperation(() => {
      this.assertOpen();
      assertIdentifier(runId, "runId");
      const record = this.terminals.get(runId);
      return record === undefined ? null : cloneJson(record);
    });
  }

  public commitFastPassResultBundleIfAbsent(
    bundle: FastPassResultArtifactBundle,
  ): Promise<boolean> {
    return rejectedOperation(() => {
      this.assertOpen();
      const snapshot = validateAndCloneFastPassResultArtifactBundle(bundle);
      const runId = snapshot.manifest.runId;
      const currentManifest = this.manifests.get(runId);
      const currentFinalResult = this.finalResults.get(runId);
      const currentTerminal = this.terminals.get(runId);
      if (
        (currentManifest !== undefined &&
          !exactJsonSnapshot(currentManifest, snapshot.manifest)) ||
        (currentFinalResult !== undefined &&
          !exactJsonSnapshot(currentFinalResult, snapshot.finalResult)) ||
        (currentTerminal !== undefined &&
          !exactJsonSnapshot(currentTerminal, snapshot.terminal))
      ) {
        return false;
      }
      if (currentManifest === undefined) {
        this.manifests.set(runId, snapshot.manifest);
      }
      if (currentFinalResult === undefined) {
        this.finalResults.set(runId, snapshot.finalResult);
      }
      if (currentTerminal === undefined) {
        this.terminals.set(runId, snapshot.terminal);
      }
      return true;
    });
  }

  public listTerminalRecords(): Promise<AnalysisTerminalRecordCatalog> {
    return rejectedOperation(() => {
      this.assertOpen();
      return {
        records: sortTerminalRecordsNewestFirst(
          [...this.terminals.values()].map((record) => cloneJson(record)),
        ),
        rejectedRecordCount: 0,
      };
    });
  }

  public putSourceSnapshot(
    record: SourceCapabilitySnapshotRecord,
  ): Promise<void> {
    return rejectedOperation(() => {
      this.assertOpen();
      const snapshot = validateAndCloneSourceSnapshot(record);
      this.sourceSnapshots.set(snapshot.sourceCheckId, snapshot);
    });
  }

  public getSourceSnapshot(
    sourceCheckId: string,
  ): Promise<SourceCapabilitySnapshotRecord | null> {
    return rejectedOperation(() => {
      this.assertOpen();
      assertIdentifier(sourceCheckId, "sourceCheckId");
      const record = this.sourceSnapshots.get(sourceCheckId);
      return record === undefined ? null : cloneJson(record);
    });
  }

  public putCandidatePassBInsights(
    record: CandidatePassBInsightsRecord,
  ): Promise<void> {
    return rejectedOperation(() => {
      this.assertOpen();
      const snapshot = cloneCandidatePassBInsightsRecord(record);
      this.candidatePassBInsights.set(snapshot.runId, snapshot);
    });
  }

  public replaceCandidatePassBInsightsIfUnchanged(
    expected: CandidatePassBInsightsRecord | null,
    replacement: CandidatePassBInsightsRecord,
  ): Promise<boolean> {
    return rejectedOperation(() => {
      this.assertOpen();
      const expectedSnapshot =
        expected === null ? null : cloneCandidatePassBInsightsRecord(expected);
      const replacementSnapshot =
        cloneCandidatePassBInsightsRecord(replacement);
      if (
        expectedSnapshot !== null &&
        expectedSnapshot.runId !== replacementSnapshot.runId
      ) {
        throw new AnalysisResultStoreError(
          "INVALID_PAYLOAD",
          "Candidate Pass B compare-and-swap records must share one run id.",
        );
      }
      const current =
        this.candidatePassBInsights.get(replacementSnapshot.runId) ?? null;
      if (
        !candidatePassBInsightSnapshotsExactlyMatch(
          expectedSnapshot,
          current,
        )
      ) {
        return false;
      }
      this.candidatePassBInsights.set(
        replacementSnapshot.runId,
        replacementSnapshot,
      );
      return true;
    });
  }

  public getCandidatePassBInsights(
    runId: string,
  ): Promise<CandidatePassBInsightsRecord | null> {
    return rejectedOperation(() => {
      this.assertOpen();
      assertIdentifier(runId, "runId");
      const record = this.candidatePassBInsights.get(runId);
      return record === undefined
        ? null
        : cloneCandidatePassBInsightsRecord(record);
    });
  }

  public putBroadcastContextSession(
    record: BroadcastContextSessionRecord,
  ): Promise<void> {
    return rejectedOperation(() => {
      this.assertOpen();
      const snapshot = cloneBroadcastContextSessionRecord(record);
      this.broadcastContextSessions.set(snapshot.runId, snapshot);
    });
  }

  public insertBroadcastContextSessionIfAbsent(
    record: BroadcastContextSessionRecord,
  ): Promise<boolean> {
    return rejectedOperation(() => {
      this.assertOpen();
      const snapshot = cloneBroadcastContextSessionRecord(record);
      const existing = this.broadcastContextSessions.get(snapshot.runId);
      if (existing !== undefined) {
        return exactJsonSnapshot(existing, snapshot);
      }
      this.broadcastContextSessions.set(snapshot.runId, snapshot);
      return true;
    });
  }

  public replaceBroadcastContextSessionIfUnchanged(
    expected: BroadcastContextSessionRecord,
    replacement: BroadcastContextSessionRecord,
  ): Promise<boolean> {
    return rejectedOperation(() => {
      this.assertOpen();
      const expectedSnapshot = cloneBroadcastContextSessionRecord(expected);
      const replacementSnapshot =
        cloneBroadcastContextSessionRecord(replacement);
      if (expectedSnapshot.runId !== replacementSnapshot.runId) {
        throw new AnalysisResultStoreError(
          "INVALID_PAYLOAD",
          "Broadcast context compare-and-swap records must share one run id.",
        );
      }
      const current = this.broadcastContextSessions.get(expectedSnapshot.runId);
      if (
        current === undefined ||
        JSON.stringify(current) !== JSON.stringify(expectedSnapshot)
      ) {
        return false;
      }
      this.broadcastContextSessions.set(
        replacementSnapshot.runId,
        replacementSnapshot,
      );
      return true;
    });
  }

  public getBroadcastContextSession(
    runId: string,
  ): Promise<BroadcastContextSessionRecord | null> {
    return rejectedOperation(() => {
      this.assertOpen();
      assertIdentifier(runId, "runId");
      const record = this.broadcastContextSessions.get(runId);
      return record === undefined
        ? null
        : cloneCurrentBroadcastContextSessionRecord(record);
    });
  }

  public close(): void {
    this.closed = true;
  }

  private putAnalysisRecord<T extends AnyAnalysisRecord>(
    target: Map<string, T>,
    record: T,
    kind: T["kind"],
  ): Promise<void> {
    return rejectedOperation(() => {
      this.assertOpen();
      const snapshot = validateAndCloneAnalysisRecord(record, kind);
      target.set(snapshot.runId, snapshot);
    });
  }

  private assertOpen(): void {
    if (this.closed) {
      throw storeClosedError();
    }
  }
}

export interface IndexedDbAnalysisResultStoreOptions {
  readonly dbName?: string;
  readonly version?: number;
  readonly factory?: IDBFactory;
}

function normalizeStoreFailure(
  cause: unknown,
  code: AnalysisResultStoreErrorCode,
  message: string,
): AnalysisResultStoreError {
  return cause instanceof AnalysisResultStoreError
    ? cause
    : new AnalysisResultStoreError(code, message, cause);
}

function requestError(
  error: DOMException | null,
  action: string,
): AnalysisResultStoreError {
  return normalizeStoreFailure(
    error,
    "TRANSACTION_FAILED",
    `IndexedDB ${action} failed.`,
  );
}

export class IndexedDbAnalysisResultStore implements AnalysisResultStore {
  private readonly dbName: string;
  private readonly version: number;
  private readonly factory: IDBFactory | null;
  private database: IDBDatabase | null = null;
  private openPromise: Promise<IDBDatabase> | null = null;
  private rejectPendingOpen:
    ((reason: AnalysisResultStoreError) => void) | null = null;
  private closed = false;

  public constructor(options: IndexedDbAnalysisResultStoreOptions = {}) {
    this.dbName = options.dbName ?? DEFAULT_ANALYSIS_RESULT_DB_NAME;
    this.version = options.version ?? ANALYSIS_RESULT_DB_VERSION;
    this.factory = options.factory ?? globalThis.indexedDB ?? null;

    assertIdentifier(this.dbName, "dbName");
    if (!Number.isSafeInteger(this.version) || this.version <= 0) {
      throw payloadError("IndexedDB version must be a positive safe integer.");
    }
  }

  public putJob(record: AnalysisJobRecord): Promise<void> {
    return rejectedOperation(() => {
      const snapshot = validateAndCloneJobRecord(record);
      return this.writeRecord(ANALYSIS_RESULT_OBJECT_STORES.jobs, snapshot);
    }).then((operation) => operation);
  }

  public replaceJobIfUnchanged(
    expected: AnalysisJobRecord | null,
    replacement: AnalysisJobRecord,
  ): Promise<boolean> {
    return rejectedOperation(() => {
      const expectedSnapshot =
        expected === null ? null : validateAndCloneJobRecord(expected);
      const replacementSnapshot = validateAndCloneJobRecord(replacement);
      if (
        expectedSnapshot !== null &&
        expectedSnapshot.jobId !== replacementSnapshot.jobId
      ) {
        throw new AnalysisResultStoreError(
          "INVALID_PAYLOAD",
          "Analysis job compare-and-swap records must share one job id.",
        );
      }
      return this.compareAndSwapAnalysisJob(
        expectedSnapshot,
        replacementSnapshot,
      );
    }).then((operation) => operation);
  }

  public replaceJobIfAnalysisSnapshotUnchanged(
    expected: AnalysisJobRecord,
    replacement: AnalysisJobRecord,
    expectedSnapshot: AnalysisCompletionDurableSnapshot,
  ): Promise<boolean> {
    return rejectedOperation(() => {
      const expectedJob = validateAndCloneJobRecord(expected);
      const replacementJob = validateAndCloneJobRecord(replacement);
      const snapshot =
        validateAndCloneAnalysisCompletionSnapshot(expectedSnapshot);
      assertCompletionJobFence(expectedJob, replacementJob, snapshot);
      return this.compareAndSwapAnalysisCompletion(
        expectedJob,
        replacementJob,
        snapshot,
      );
    }).then((operation) => operation);
  }

  public getAnalysisCompletionReadback(
    jobId: string,
    runId: string,
  ): Promise<AnalysisCompletionDurableReadback> {
    return rejectedOperation(() => {
      assertIdentifier(jobId, "jobId");
      assertIdentifier(runId, "runId");
      return this.readAnalysisCompletion(jobId, runId);
    }).then((operation) => operation);
  }

  public getJob(jobId: string): Promise<AnalysisJobRecord | null> {
    return rejectedOperation(() => {
      assertIdentifier(jobId, "jobId");
      return this.readRecord(
        ANALYSIS_RESULT_OBJECT_STORES.jobs,
        jobId,
        (value) => {
          assertJobRecord(value);
          return cloneJson(value);
        },
      );
    }).then((operation) => operation);
  }

  public listJobs(): Promise<readonly AnalysisJobRecord[]> {
    return this.readAllRecords(
      ANALYSIS_RESULT_OBJECT_STORES.jobs,
      (value) => value,
    ).then((values) => {
      const records: AnalysisJobRecord[] = [];
      for (const value of values) {
        // 레코드 하나가 깨졌다고 목록 전체를 못 보여 주면, 사용자는 멀쩡한
        // 작업까지 잃은 것으로 본다. 깨진 것만 건너뛴다.
        try {
          assertJobRecord(value);
          records.push(cloneJson(value));
        } catch {
          continue;
        }
      }
      return records;
    });
  }

  public deleteJob(jobId: string): Promise<void> {
    return rejectedOperation(() => {
      assertIdentifier(jobId, "jobId");
      return this.getJob(jobId).then((record) => {
        if (record === null) return;
        return this.deleteJobAndRuns(jobId, record.job.runIds);
      });
    }).then((operation) => operation);
  }

  public putManifest(record: AnalysisManifestRecord): Promise<void> {
    return this.putAnalysisRecord(
      ANALYSIS_RESULT_OBJECT_STORES.manifests,
      record,
      "manifest",
    );
  }

  public insertManifestIfAbsent(
    record: AnalysisManifestRecord,
  ): Promise<boolean> {
    return rejectedOperation(() => {
      const snapshot = validateAndCloneAnalysisRecord(record, "manifest");
      return this.insertExactRecordIfAbsent(
        ANALYSIS_RESULT_OBJECT_STORES.manifests,
        snapshot,
        (value) =>
          validateAndCloneAnalysisRecord(
            value as AnalysisManifestRecord,
            "manifest",
          ),
      );
    }).then((operation) => operation);
  }

  public getManifest(runId: string): Promise<AnalysisManifestRecord | null> {
    return rejectedOperation(() => {
      assertIdentifier(runId, "runId");
      return this.readRecord(
        ANALYSIS_RESULT_OBJECT_STORES.manifests,
        runId,
        (value) => {
          assertAnalysisRecord(value, "manifest");
          return cloneJson(value as AnalysisManifestRecord);
        },
      );
    }).then((operation) => operation);
  }

  public putProvisionalResult(
    record: ProvisionalAnalysisResultRecord,
  ): Promise<void> {
    return this.putAnalysisRecord(
      ANALYSIS_RESULT_OBJECT_STORES.provisionalResults,
      record,
      "provisionalResult",
    );
  }

  public putFinalResult(record: FinalAnalysisResultRecord): Promise<void> {
    return this.putAnalysisRecord(
      ANALYSIS_RESULT_OBJECT_STORES.finalResults,
      record,
      "finalResult",
    );
  }

  public putFailureRecord(record: AnalysisFailureRecord): Promise<void> {
    return this.putAnalysisRecord(
      ANALYSIS_RESULT_OBJECT_STORES.failures,
      record,
      "failure",
    );
  }

  public getFinalResult(
    runId: string,
  ): Promise<FinalAnalysisResultRecord | null> {
    return rejectedOperation(() => {
      assertIdentifier(runId, "runId");
      return this.readRecord(
        ANALYSIS_RESULT_OBJECT_STORES.finalResults,
        runId,
        (value) => {
          assertAnalysisRecord(value, "finalResult");
          return cloneJson(value as FinalAnalysisResultRecord);
        },
      );
    }).then((operation) => operation);
  }

  public putTerminalRecord(record: AnalysisTerminalRecord): Promise<void> {
    return rejectedOperation(() => {
      const snapshot = validateAndCloneTerminalRecord(record);
      return this.writeTerminalRecordOnce(snapshot);
    }).then((operation) => operation);
  }

  public getTerminalRecord(
    runId: string,
  ): Promise<AnalysisTerminalRecord | null> {
    return rejectedOperation(() => {
      assertIdentifier(runId, "runId");
      return this.readRecord(
        ANALYSIS_RESULT_OBJECT_STORES.terminals,
        runId,
        (value) => {
          assertTerminalRecord(value);
          return cloneJson(value);
        },
      );
    }).then((operation) => operation);
  }

  public commitFastPassResultBundleIfAbsent(
    bundle: FastPassResultArtifactBundle,
  ): Promise<boolean> {
    return rejectedOperation(() => {
      const snapshot = validateAndCloneFastPassResultArtifactBundle(bundle);
      return this.commitFastPassResultBundleAtomically(snapshot);
    }).then((operation) => operation);
  }

  public listTerminalRecords(): Promise<AnalysisTerminalRecordCatalog> {
    return this.readAllRecords(
      ANALYSIS_RESULT_OBJECT_STORES.terminals,
      (value) => value,
    ).then((values) => {
      const records: AnalysisTerminalRecord[] = [];
      let rejectedRecordCount = 0;
      for (const value of values) {
        try {
          assertTerminalRecord(value);
          records.push(cloneJson(value));
        } catch {
          rejectedRecordCount += 1;
        }
      }
      return {
        records: sortTerminalRecordsNewestFirst(records),
        rejectedRecordCount,
      };
    });
  }

  public putSourceSnapshot(
    record: SourceCapabilitySnapshotRecord,
  ): Promise<void> {
    return rejectedOperation(() => {
      const snapshot = validateAndCloneSourceSnapshot(record);
      return this.writeRecord(
        ANALYSIS_RESULT_OBJECT_STORES.sourceSnapshots,
        snapshot,
      );
    }).then((operation) => operation);
  }

  public getSourceSnapshot(
    sourceCheckId: string,
  ): Promise<SourceCapabilitySnapshotRecord | null> {
    return rejectedOperation(() => {
      assertIdentifier(sourceCheckId, "sourceCheckId");
      return this.readRecord(
        ANALYSIS_RESULT_OBJECT_STORES.sourceSnapshots,
        sourceCheckId,
        (value) => {
          assertSourceSnapshotRecord(value);
          return cloneJson(value);
        },
      );
    }).then((operation) => operation);
  }

  public putCandidatePassBInsights(
    record: CandidatePassBInsightsRecord,
  ): Promise<void> {
    return rejectedOperation(() => {
      const snapshot = cloneCandidatePassBInsightsRecord(record);
      return this.writeRecord(
        ANALYSIS_RESULT_OBJECT_STORES.candidatePassBInsights,
        snapshot,
      );
    }).then((operation) => operation);
  }

  public replaceCandidatePassBInsightsIfUnchanged(
    expected: CandidatePassBInsightsRecord | null,
    replacement: CandidatePassBInsightsRecord,
  ): Promise<boolean> {
    return rejectedOperation(() => {
      const expectedSnapshot =
        expected === null ? null : cloneCandidatePassBInsightsRecord(expected);
      const replacementSnapshot =
        cloneCandidatePassBInsightsRecord(replacement);
      if (
        expectedSnapshot !== null &&
        expectedSnapshot.runId !== replacementSnapshot.runId
      ) {
        throw new AnalysisResultStoreError(
          "INVALID_PAYLOAD",
          "Candidate Pass B compare-and-swap records must share one run id.",
        );
      }
      return this.compareAndSwapCandidatePassBInsights(
        expectedSnapshot,
        replacementSnapshot,
      );
    }).then((operation) => operation);
  }

  public getCandidatePassBInsights(
    runId: string,
  ): Promise<CandidatePassBInsightsRecord | null> {
    return rejectedOperation(() => {
      assertIdentifier(runId, "runId");
      return this.readRecord(
        ANALYSIS_RESULT_OBJECT_STORES.candidatePassBInsights,
        runId,
        (value) => {
          assertCandidatePassBInsightsRecord(value);
          return cloneCandidatePassBInsightsRecord(value);
        },
      );
    }).then((operation) => operation);
  }

  public putBroadcastContextSession(
    record: BroadcastContextSessionRecord,
  ): Promise<void> {
    return rejectedOperation(() => {
      const snapshot = cloneBroadcastContextSessionRecord(record);
      return this.writeRecord(
        ANALYSIS_RESULT_OBJECT_STORES.broadcastContextSessions,
        snapshot,
      );
    }).then((operation) => operation);
  }

  public insertBroadcastContextSessionIfAbsent(
    record: BroadcastContextSessionRecord,
  ): Promise<boolean> {
    return rejectedOperation(() => {
      const snapshot = cloneBroadcastContextSessionRecord(record);
      return this.insertExactRecordIfAbsent(
        ANALYSIS_RESULT_OBJECT_STORES.broadcastContextSessions,
        snapshot,
        cloneCurrentBroadcastContextSessionRecord,
      );
    }).then((operation) => operation);
  }

  public replaceBroadcastContextSessionIfUnchanged(
    expected: BroadcastContextSessionRecord,
    replacement: BroadcastContextSessionRecord,
  ): Promise<boolean> {
    return rejectedOperation(() => {
      const expectedSnapshot = cloneBroadcastContextSessionRecord(expected);
      const replacementSnapshot =
        cloneBroadcastContextSessionRecord(replacement);
      if (expectedSnapshot.runId !== replacementSnapshot.runId) {
        throw new AnalysisResultStoreError(
          "INVALID_PAYLOAD",
          "Broadcast context compare-and-swap records must share one run id.",
        );
      }
      return this.compareAndSwapBroadcastContextSession(
        expectedSnapshot,
        replacementSnapshot,
      );
    }).then((operation) => operation);
  }

  public getBroadcastContextSession(
    runId: string,
  ): Promise<BroadcastContextSessionRecord | null> {
    return rejectedOperation(() => {
      assertIdentifier(runId, "runId");
      return this.readRecord(
        ANALYSIS_RESULT_OBJECT_STORES.broadcastContextSessions,
        runId,
        (value) => cloneCurrentBroadcastContextSessionRecord(value),
      );
    }).then((operation) => operation);
  }

  public close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.rejectPendingOpen?.(storeClosedError());
    this.rejectPendingOpen = null;
    this.database?.close();
    this.database = null;
    this.openPromise = null;
  }

  private putAnalysisRecord<T extends AnyAnalysisRecord>(
    storeName: AnalysisStoreName,
    record: T,
    kind: T["kind"],
  ): Promise<void> {
    return rejectedOperation(() => {
      const snapshot = validateAndCloneAnalysisRecord(record, kind);
      return this.writeRecord(storeName, snapshot);
    }).then((operation) => operation);
  }

  /**
   * 작업과 그 작업이 만든 실행 결과를 **한 트랜잭션에서** 지운다.
   *
   * 나눠서 지우면 중간에 실패했을 때 결과만 주인 없이 남는다. 그 레코드는 어느
   * 화면에도 나타나지 않으므로 사용자가 지울 수도 없고, 용량만 계속 차지한다.
   */
  private deleteJobAndRuns(
    jobId: string,
    runIds: readonly string[],
  ): Promise<void> {
    const storeNames = [
      ANALYSIS_RESULT_OBJECT_STORES.jobs,
      ...RUN_KEYED_OBJECT_STORES,
    ];
    return this.openDatabase().then(
      (database) =>
        new Promise<void>((resolve, reject) => {
          let settled = false;
          let transaction: IDBTransaction;

          const rejectOnce = (error: AnalysisResultStoreError): void => {
            if (!settled) {
              settled = true;
              reject(error);
            }
          };

          try {
            transaction = database.transaction(storeNames, "readwrite");
          } catch (cause) {
            rejectOnce(
              normalizeStoreFailure(
                cause,
                "TRANSACTION_FAILED",
                `Could not start a delete transaction for job ${jobId}.`,
              ),
            );
            return;
          }

          transaction.oncomplete = () => {
            if (!settled) {
              settled = true;
              resolve();
            }
          };
          transaction.onerror = () => {
            rejectOnce(
              requestError(
                transaction.error,
                `delete transaction for job ${jobId}`,
              ),
            );
          };
          transaction.onabort = () => {
            rejectOnce(
              requestError(
                transaction.error,
                `aborted delete for job ${jobId}`,
              ),
            );
          };

          try {
            for (const storeName of RUN_KEYED_OBJECT_STORES) {
              const objectStore = transaction.objectStore(storeName);
              for (const runId of runIds) {
                objectStore.delete(runId);
              }
            }
            // 작업 레코드를 마지막에 지운다 — 앞이 실패해 트랜잭션이 되돌아가면
            // `runIds` 가 남아 있어 다시 시도할 수 있다.
            transaction
              .objectStore(ANALYSIS_RESULT_OBJECT_STORES.jobs)
              .delete(jobId);
          } catch (cause) {
            try {
              transaction.abort();
            } catch {
              // 이미 끝난 트랜잭션이면 무시한다.
            }
            rejectOnce(
              normalizeStoreFailure(
                cause,
                "TRANSACTION_FAILED",
                `Could not delete job ${jobId}.`,
              ),
            );
          }
        }),
    );
  }

  private writeRecord(
    storeName: AnalysisStoreName,
    record: unknown,
  ): Promise<void> {
    return this.openDatabase().then(
      (database) =>
        new Promise<void>((resolve, reject) => {
          let settled = false;
          let transaction: IDBTransaction;

          const rejectOnce = (error: AnalysisResultStoreError): void => {
            if (!settled) {
              settled = true;
              reject(error);
            }
          };

          try {
            transaction = database.transaction(storeName, "readwrite");
          } catch (cause) {
            rejectOnce(
              normalizeStoreFailure(
                cause,
                "TRANSACTION_FAILED",
                `Could not start a transaction for ${storeName}.`,
              ),
            );
            return;
          }

          transaction.oncomplete = () => {
            if (!settled) {
              settled = true;
              resolve();
            }
          };
          transaction.onerror = () => {
            rejectOnce(
              requestError(
                transaction.error,
                `write transaction for ${storeName}`,
              ),
            );
          };
          transaction.onabort = () => {
            rejectOnce(
              requestError(
                transaction.error,
                `aborted write transaction for ${storeName}`,
              ),
            );
          };

          try {
            const request = transaction.objectStore(storeName).put(record);
            request.onerror = () => {
              rejectOnce(
                requestError(request.error, `write request for ${storeName}`),
              );
            };
          } catch (cause) {
            try {
              transaction.abort();
            } catch {
              // The original operation error is more useful than an abort race.
            }
            rejectOnce(
              normalizeStoreFailure(
                cause,
                "TRANSACTION_FAILED",
                `Could not write a record to ${storeName}.`,
              ),
            );
          }
        }),
    );
  }

  private compareAndSwapAnalysisJob(
    expected: AnalysisJobRecord | null,
    replacement: AnalysisJobRecord,
  ): Promise<boolean> {
    const storeName = ANALYSIS_RESULT_OBJECT_STORES.jobs;
    return this.openDatabase().then(
      (database) =>
        new Promise<boolean>((resolve, reject) => {
          let settled = false;
          let decision: boolean | null = null;
          let transaction: IDBTransaction;

          const rejectOnce = (error: AnalysisResultStoreError): void => {
            if (!settled) {
              settled = true;
              reject(error);
            }
          };
          const abortAfter = (error: AnalysisResultStoreError): void => {
            rejectOnce(error);
            try {
              transaction.abort();
            } catch {
              // The comparison/request error remains authoritative.
            }
          };

          try {
            transaction = database.transaction(storeName, "readwrite");
          } catch (cause) {
            rejectOnce(
              normalizeStoreFailure(
                cause,
                "TRANSACTION_FAILED",
                `Could not start a compare-and-swap transaction for ${storeName}.`,
              ),
            );
            return;
          }

          transaction.oncomplete = () => {
            if (settled) return;
            if (decision === null) {
              rejectOnce(
                new AnalysisResultStoreError(
                  "TRANSACTION_FAILED",
                  `The ${storeName} transaction completed before its comparison.`,
                ),
              );
              return;
            }
            settled = true;
            resolve(decision);
          };
          transaction.onerror = () => {
            rejectOnce(
              requestError(
                transaction.error,
                `compare-and-swap transaction for ${storeName}`,
              ),
            );
          };
          transaction.onabort = () => {
            rejectOnce(
              requestError(
                transaction.error,
                `aborted compare-and-swap for ${storeName}`,
              ),
            );
          };

          try {
            const objectStore = transaction.objectStore(storeName);
            const getRequest = objectStore.get(replacement.jobId);
            getRequest.onsuccess = () => {
              if (settled) return;
              let current: AnalysisJobRecord | null;
              try {
                current =
                  getRequest.result === undefined
                    ? null
                    : validateAndCloneJobRecord(
                        getRequest.result as AnalysisJobRecord,
                      );
              } catch {
                decision = false;
                return;
              }
              if (!analysisJobSnapshotsExactlyMatch(expected, current)) {
                decision = false;
                return;
              }
              let putRequest: IDBRequest<IDBValidKey>;
              try {
                putRequest = objectStore.put(replacement);
              } catch (cause) {
                abortAfter(
                  normalizeStoreFailure(
                    cause,
                    "TRANSACTION_FAILED",
                    `Could not replace ${storeName} after comparison.`,
                  ),
                );
                return;
              }
              putRequest.onsuccess = () => {
                decision = true;
              };
              putRequest.onerror = () => {
                abortAfter(
                  requestError(
                    putRequest.error,
                    `compare-and-swap write for ${storeName}`,
                  ),
                );
              };
            };
            getRequest.onerror = () => {
              abortAfter(
                requestError(
                  getRequest.error,
                  `compare-and-swap read for ${storeName}`,
                ),
              );
            };
          } catch (cause) {
            try {
              transaction.abort();
            } catch {
              // The original operation error remains authoritative.
            }
            rejectOnce(
              normalizeStoreFailure(
                cause,
                "TRANSACTION_FAILED",
                `Could not compare and replace a record in ${storeName}.`,
              ),
            );
          }
        }),
    );
  }

  private compareAndSwapAnalysisCompletion(
    expectedJob: AnalysisJobRecord,
    replacementJob: AnalysisJobRecord,
    expectedSnapshot: AnalysisCompletionDurableSnapshot,
  ): Promise<boolean> {
    return this.openDatabase().then(
      (database) =>
        new Promise<boolean>((resolve, reject) => {
          let settled = false;
          let decision: boolean | null = null;
          let completedReads = 0;
          let transaction: IDBTransaction;
          const values: {
            job?: unknown;
            manifest?: unknown;
            fastResult?: unknown;
            fastTerminal?: unknown;
            session?: unknown;
            candidateRecord?: unknown;
          } = {};

          const rejectOnce = (error: AnalysisResultStoreError): void => {
            if (!settled) {
              settled = true;
              reject(error);
            }
          };
          const abortAfter = (error: AnalysisResultStoreError): void => {
            rejectOnce(error);
            try {
              transaction.abort();
            } catch {
              // The comparison/request error remains authoritative.
            }
          };

          try {
            transaction = database.transaction(
              ANALYSIS_COMPLETION_OBJECT_STORES,
              "readwrite",
            );
          } catch (cause) {
            rejectOnce(
              normalizeStoreFailure(
                cause,
                "TRANSACTION_FAILED",
                "Could not start the atomic analysis completion transaction.",
              ),
            );
            return;
          }

          transaction.oncomplete = () => {
            if (settled) return;
            if (decision === null) {
              rejectOnce(
                new AnalysisResultStoreError(
                  "TRANSACTION_FAILED",
                  "The analysis completion transaction ended before all snapshots were compared.",
                ),
              );
              return;
            }
            settled = true;
            resolve(decision);
          };
          transaction.onerror = () => {
            rejectOnce(
              requestError(
                transaction.error,
                "atomic analysis completion transaction",
              ),
            );
          };
          transaction.onabort = () => {
            rejectOnce(
              requestError(
                transaction.error,
                "aborted atomic analysis completion transaction",
              ),
            );
          };

          const compareAfterFinalRead = (): void => {
            completedReads += 1;
            if (completedReads !== ANALYSIS_COMPLETION_OBJECT_STORES.length) {
              return;
            }

            let currentJob: AnalysisJobRecord;
            let currentSnapshot: AnalysisCompletionDurableSnapshot;
            try {
              if (
                values.job === undefined ||
                values.manifest === undefined ||
                values.fastResult === undefined ||
                values.fastTerminal === undefined ||
                values.session === undefined
              ) {
                decision = false;
                return;
              }
              currentJob = validateAndCloneJobRecord(
                values.job as AnalysisJobRecord,
              );
              currentSnapshot =
                validateAndCloneAnalysisCompletionSnapshot({
                  manifest: values.manifest as AnalysisManifestRecord,
                  fastResult: values.fastResult as FinalAnalysisResultRecord,
                  fastTerminal:
                    values.fastTerminal as AnalysisTerminalRecord,
                  session: values.session as BroadcastContextSessionRecord,
                  candidateRecord:
                    values.candidateRecord === undefined
                      ? null
                      : (values.candidateRecord as CandidatePassBInsightsRecord),
                });
            } catch {
              decision = false;
              return;
            }
            if (
              !analysisJobSnapshotsExactlyMatch(expectedJob, currentJob) ||
              !analysisCompletionSnapshotsExactlyMatch(
                expectedSnapshot,
                currentSnapshot,
              )
            ) {
              decision = false;
              return;
            }

            let putRequest: IDBRequest<IDBValidKey>;
            try {
              putRequest = transaction
                .objectStore(ANALYSIS_RESULT_OBJECT_STORES.jobs)
                .put(replacementJob);
            } catch (cause) {
              abortAfter(
                normalizeStoreFailure(
                  cause,
                  "TRANSACTION_FAILED",
                  "Could not commit the completed job after snapshot comparison.",
                ),
              );
              return;
            }
            putRequest.onsuccess = () => {
              decision = true;
            };
            putRequest.onerror = () => {
              abortAfter(
                requestError(
                  putRequest.error,
                  "atomic analysis completion write",
                ),
              );
            };
          };

          const read = (
            storeName: AnalysisStoreName,
            key: string,
            assign: (value: unknown) => void,
          ): void => {
            let request: IDBRequest<unknown>;
            try {
              request = transaction.objectStore(storeName).get(key);
            } catch (cause) {
              abortAfter(
                normalizeStoreFailure(
                  cause,
                  "TRANSACTION_FAILED",
                  `Could not read ${storeName} for atomic completion.`,
                ),
              );
              return;
            }
            request.onsuccess = () => {
              if (settled) return;
              assign(request.result);
              compareAfterFinalRead();
            };
            request.onerror = () => {
              abortAfter(
                requestError(
                  request.error,
                  `atomic completion read for ${storeName}`,
                ),
              );
            };
          };

          const runId = expectedSnapshot.manifest.runId;
          read(
            ANALYSIS_RESULT_OBJECT_STORES.jobs,
            replacementJob.jobId,
            (value) => {
              values.job = value;
            },
          );
          read(ANALYSIS_RESULT_OBJECT_STORES.manifests, runId, (value) => {
            values.manifest = value;
          });
          read(ANALYSIS_RESULT_OBJECT_STORES.finalResults, runId, (value) => {
            values.fastResult = value;
          });
          read(ANALYSIS_RESULT_OBJECT_STORES.terminals, runId, (value) => {
            values.fastTerminal = value;
          });
          read(
            ANALYSIS_RESULT_OBJECT_STORES.broadcastContextSessions,
            runId,
            (value) => {
              values.session = value;
            },
          );
          read(
            ANALYSIS_RESULT_OBJECT_STORES.candidatePassBInsights,
            runId,
            (value) => {
              values.candidateRecord = value;
            },
          );
        }),
    );
  }

  private readAnalysisCompletion(
    jobId: string,
    runId: string,
  ): Promise<AnalysisCompletionDurableReadback> {
    return this.openDatabase().then(
      (database) =>
        new Promise<AnalysisCompletionDurableReadback>((resolve, reject) => {
          let settled = false;
          let completedReads = 0;
          let readback: AnalysisCompletionDurableReadback | null = null;
          let transaction: IDBTransaction;
          const values: {
            job?: unknown;
            manifest?: unknown;
            fastResult?: unknown;
            fastTerminal?: unknown;
            session?: unknown;
            candidateRecord?: unknown;
          } = {};

          const rejectOnce = (error: AnalysisResultStoreError): void => {
            if (!settled) {
              settled = true;
              reject(error);
            }
          };
          const abortAfter = (error: AnalysisResultStoreError): void => {
            rejectOnce(error);
            try {
              transaction.abort();
            } catch {
              // The read/validation error remains authoritative.
            }
          };

          try {
            transaction = database.transaction(
              ANALYSIS_COMPLETION_OBJECT_STORES,
              "readonly",
            );
          } catch (cause) {
            rejectOnce(
              normalizeStoreFailure(
                cause,
                "TRANSACTION_FAILED",
                "Could not start the analysis completion readback transaction.",
              ),
            );
            return;
          }

          transaction.oncomplete = () => {
            if (settled) return;
            if (readback === null) {
              rejectOnce(
                new AnalysisResultStoreError(
                  "TRANSACTION_FAILED",
                  "The analysis completion readback ended before all records were read.",
                ),
              );
              return;
            }
            settled = true;
            resolve(readback);
          };
          transaction.onerror = () => {
            rejectOnce(
              requestError(
                transaction.error,
                "analysis completion readback transaction",
              ),
            );
          };
          transaction.onabort = () => {
            rejectOnce(
              requestError(
                transaction.error,
                "aborted analysis completion readback",
              ),
            );
          };

          const finishRead = (): void => {
            completedReads += 1;
            if (completedReads !== ANALYSIS_COMPLETION_OBJECT_STORES.length) {
              return;
            }
            try {
              const job =
                values.job === undefined
                  ? null
                  : validateAndCloneJobRecord(
                      values.job as AnalysisJobRecord,
                    );
              const snapshot =
                values.manifest === undefined ||
                values.fastResult === undefined ||
                values.fastTerminal === undefined ||
                values.session === undefined
                  ? null
                  : validateAndCloneAnalysisCompletionSnapshot({
                      manifest: values.manifest as AnalysisManifestRecord,
                      fastResult:
                        values.fastResult as FinalAnalysisResultRecord,
                      fastTerminal:
                        values.fastTerminal as AnalysisTerminalRecord,
                      session:
                        values.session as BroadcastContextSessionRecord,
                      candidateRecord:
                        values.candidateRecord === undefined
                          ? null
                          : (values.candidateRecord as CandidatePassBInsightsRecord),
                    });
              readback = { job, snapshot };
            } catch (cause) {
              abortAfter(
                cause instanceof AnalysisResultStoreError
                  ? cause
                  : payloadError(
                      "The analysis completion readback is invalid.",
                      cause,
                    ),
              );
            }
          };

          const read = (
            storeName: AnalysisStoreName,
            key: string,
            assign: (value: unknown) => void,
          ): void => {
            let request: IDBRequest<unknown>;
            try {
              request = transaction.objectStore(storeName).get(key);
            } catch (cause) {
              abortAfter(
                normalizeStoreFailure(
                  cause,
                  "TRANSACTION_FAILED",
                  `Could not read ${storeName} for completion readback.`,
                ),
              );
              return;
            }
            request.onsuccess = () => {
              if (settled) return;
              assign(request.result);
              finishRead();
            };
            request.onerror = () => {
              abortAfter(
                requestError(
                  request.error,
                  `completion readback request for ${storeName}`,
                ),
              );
            };
          };

          read(ANALYSIS_RESULT_OBJECT_STORES.jobs, jobId, (value) => {
            values.job = value;
          });
          read(ANALYSIS_RESULT_OBJECT_STORES.manifests, runId, (value) => {
            values.manifest = value;
          });
          read(ANALYSIS_RESULT_OBJECT_STORES.finalResults, runId, (value) => {
            values.fastResult = value;
          });
          read(ANALYSIS_RESULT_OBJECT_STORES.terminals, runId, (value) => {
            values.fastTerminal = value;
          });
          read(
            ANALYSIS_RESULT_OBJECT_STORES.broadcastContextSessions,
            runId,
            (value) => {
              values.session = value;
            },
          );
          read(
            ANALYSIS_RESULT_OBJECT_STORES.candidatePassBInsights,
            runId,
            (value) => {
              values.candidateRecord = value;
            },
          );
        }),
    );
  }

  private compareAndSwapCandidatePassBInsights(
    expected: CandidatePassBInsightsRecord | null,
    replacement: CandidatePassBInsightsRecord,
  ): Promise<boolean> {
    const storeName = ANALYSIS_RESULT_OBJECT_STORES.candidatePassBInsights;
    return this.openDatabase().then(
      (database) =>
        new Promise<boolean>((resolve, reject) => {
          let settled = false;
          let decision: boolean | null = null;
          let transaction: IDBTransaction;

          const rejectOnce = (error: AnalysisResultStoreError): void => {
            if (!settled) {
              settled = true;
              reject(error);
            }
          };
          const abortAfter = (error: AnalysisResultStoreError): void => {
            rejectOnce(error);
            try {
              transaction.abort();
            } catch {
              // The comparison/request error remains authoritative.
            }
          };

          try {
            transaction = database.transaction(storeName, "readwrite");
          } catch (cause) {
            rejectOnce(
              normalizeStoreFailure(
                cause,
                "TRANSACTION_FAILED",
                `Could not start a compare-and-swap transaction for ${storeName}.`,
              ),
            );
            return;
          }

          transaction.oncomplete = () => {
            if (settled) return;
            if (decision === null) {
              rejectOnce(
                new AnalysisResultStoreError(
                  "TRANSACTION_FAILED",
                  `The ${storeName} transaction completed before its comparison.`,
                ),
              );
              return;
            }
            settled = true;
            resolve(decision);
          };
          transaction.onerror = () => {
            rejectOnce(
              requestError(
                transaction.error,
                `compare-and-swap transaction for ${storeName}`,
              ),
            );
          };
          transaction.onabort = () => {
            rejectOnce(
              requestError(
                transaction.error,
                `aborted compare-and-swap for ${storeName}`,
              ),
            );
          };

          try {
            const objectStore = transaction.objectStore(storeName);
            const getRequest = objectStore.get(replacement.runId);
            getRequest.onsuccess = () => {
              if (settled) return;
              let current: CandidatePassBInsightsRecord | null;
              try {
                current =
                  getRequest.result === undefined
                    ? null
                    : cloneCandidatePassBInsightsRecord(
                        getRequest.result as CandidatePassBInsightsRecord,
                      );
              } catch {
                decision = false;
                return;
              }
              if (
                !candidatePassBInsightSnapshotsExactlyMatch(expected, current)
              ) {
                decision = false;
                return;
              }
              let putRequest: IDBRequest<IDBValidKey>;
              try {
                putRequest = objectStore.put(replacement);
              } catch (cause) {
                abortAfter(
                  normalizeStoreFailure(
                    cause,
                    "TRANSACTION_FAILED",
                    `Could not replace ${storeName} after comparison.`,
                  ),
                );
                return;
              }
              putRequest.onsuccess = () => {
                decision = true;
              };
              putRequest.onerror = () => {
                abortAfter(
                  requestError(
                    putRequest.error,
                    `compare-and-swap write for ${storeName}`,
                  ),
                );
              };
            };
            getRequest.onerror = () => {
              abortAfter(
                requestError(
                  getRequest.error,
                  `compare-and-swap read for ${storeName}`,
                ),
              );
            };
          } catch (cause) {
            try {
              transaction.abort();
            } catch {
              // The original operation error remains authoritative.
            }
            rejectOnce(
              normalizeStoreFailure(
                cause,
                "TRANSACTION_FAILED",
                `Could not compare and replace a record in ${storeName}.`,
              ),
            );
          }
        }),
    );
  }

  private compareAndSwapBroadcastContextSession(
    expected: BroadcastContextSessionRecord,
    replacement: BroadcastContextSessionRecord,
  ): Promise<boolean> {
    const storeName = ANALYSIS_RESULT_OBJECT_STORES.broadcastContextSessions;
    return this.openDatabase().then(
      (database) =>
        new Promise<boolean>((resolve, reject) => {
          let settled = false;
          let decision: boolean | null = null;
          let transaction: IDBTransaction;

          const rejectOnce = (error: AnalysisResultStoreError): void => {
            if (!settled) {
              settled = true;
              reject(error);
            }
          };
          const abortAfter = (error: AnalysisResultStoreError): void => {
            rejectOnce(error);
            try {
              transaction.abort();
            } catch {
              // The comparison/request error remains authoritative.
            }
          };

          try {
            transaction = database.transaction(storeName, "readwrite");
          } catch (cause) {
            rejectOnce(
              normalizeStoreFailure(
                cause,
                "TRANSACTION_FAILED",
                `Could not start a compare-and-swap transaction for ${storeName}.`,
              ),
            );
            return;
          }

          transaction.oncomplete = () => {
            if (settled) return;
            if (decision === null) {
              rejectOnce(
                new AnalysisResultStoreError(
                  "TRANSACTION_FAILED",
                  `The ${storeName} transaction completed before its comparison.`,
                ),
              );
              return;
            }
            settled = true;
            resolve(decision);
          };
          transaction.onerror = () => {
            rejectOnce(
              requestError(
                transaction.error,
                `compare-and-swap transaction for ${storeName}`,
              ),
            );
          };
          transaction.onabort = () => {
            rejectOnce(
              requestError(
                transaction.error,
                `aborted compare-and-swap for ${storeName}`,
              ),
            );
          };

          try {
            const objectStore = transaction.objectStore(storeName);
            const getRequest = objectStore.get(expected.runId);
            getRequest.onsuccess = () => {
              if (settled) return;
              let current: BroadcastContextSessionRecord;
              try {
                current = cloneBroadcastContextSessionRecord(
                  getRequest.result as unknown,
                );
              } catch {
                decision = false;
                return;
              }
              if (JSON.stringify(current) !== JSON.stringify(expected)) {
                decision = false;
                return;
              }
              let putRequest: IDBRequest<IDBValidKey>;
              try {
                putRequest = objectStore.put(replacement);
              } catch (cause) {
                abortAfter(
                  normalizeStoreFailure(
                    cause,
                    "TRANSACTION_FAILED",
                    `Could not replace ${storeName} after comparison.`,
                  ),
                );
                return;
              }
              putRequest.onsuccess = () => {
                decision = true;
              };
              putRequest.onerror = () => {
                abortAfter(
                  requestError(
                    putRequest.error,
                    `compare-and-swap write for ${storeName}`,
                  ),
                );
              };
            };
            getRequest.onerror = () => {
              abortAfter(
                requestError(
                  getRequest.error,
                  `compare-and-swap read for ${storeName}`,
                ),
              );
            };
          } catch (cause) {
            try {
              transaction.abort();
            } catch {
              // The original operation error remains authoritative.
            }
            rejectOnce(
              normalizeStoreFailure(
                cause,
                "TRANSACTION_FAILED",
                `Could not compare and replace ${storeName}.`,
              ),
            );
          }
        }),
    );
  }

  private insertExactRecordIfAbsent<Record extends { readonly runId: string }>(
    storeName: AnalysisStoreName,
    record: Record,
    deserialize: (value: unknown) => Record,
  ): Promise<boolean> {
    return this.openDatabase().then(
      (database) =>
        new Promise<boolean>((resolve, reject) => {
          let settled = false;
          let decision: boolean | null = null;
          let transaction: IDBTransaction;

          const rejectOnce = (error: AnalysisResultStoreError): void => {
            if (!settled) {
              settled = true;
              reject(error);
            }
          };
          const abortAfter = (error: AnalysisResultStoreError): void => {
            rejectOnce(error);
            try {
              transaction.abort();
            } catch {
              // The request error remains authoritative.
            }
          };

          try {
            transaction = database.transaction(storeName, "readwrite");
          } catch (cause) {
            rejectOnce(
              normalizeStoreFailure(
                cause,
                "TRANSACTION_FAILED",
                `Could not start an insert-if-absent transaction for ${storeName}.`,
              ),
            );
            return;
          }

          transaction.oncomplete = () => {
            if (settled) return;
            if (decision === null) {
              rejectOnce(
                new AnalysisResultStoreError(
                  "TRANSACTION_FAILED",
                  `The ${storeName} transaction completed before its insert-if-absent decision.`,
                ),
              );
              return;
            }
            settled = true;
            resolve(decision);
          };
          transaction.onerror = () => {
            rejectOnce(
              requestError(
                transaction.error,
                `insert-if-absent transaction for ${storeName}`,
              ),
            );
          };
          transaction.onabort = () => {
            rejectOnce(
              requestError(
                transaction.error,
                `aborted insert-if-absent transaction for ${storeName}`,
              ),
            );
          };

          try {
            const objectStore = transaction.objectStore(storeName);
            const getRequest = objectStore.get(record.runId);
            getRequest.onsuccess = () => {
              if (settled) return;
              if (getRequest.result !== undefined) {
                try {
                  decision = exactJsonSnapshot(
                    deserialize(getRequest.result),
                    record,
                  );
                } catch {
                  decision = false;
                }
                return;
              }

              let addRequest: IDBRequest<IDBValidKey>;
              try {
                addRequest = objectStore.add(record);
              } catch (cause) {
                abortAfter(
                  normalizeStoreFailure(
                    cause,
                    "TRANSACTION_FAILED",
                    `Could not insert the first record in ${storeName}.`,
                  ),
                );
                return;
              }
              addRequest.onsuccess = () => {
                decision = true;
              };
              addRequest.onerror = () => {
                abortAfter(
                  requestError(
                    addRequest.error,
                    `insert-if-absent add request for ${storeName}`,
                  ),
                );
              };
            };
            getRequest.onerror = () => {
              abortAfter(
                requestError(
                  getRequest.error,
                  `insert-if-absent read request for ${storeName}`,
                ),
              );
            };
          } catch (cause) {
            abortAfter(
              normalizeStoreFailure(
                cause,
                "TRANSACTION_FAILED",
                `Could not insert an immutable record in ${storeName}.`,
              ),
            );
          }
        }),
    );
  }

  private commitFastPassResultBundleAtomically(
    bundle: FastPassResultArtifactBundle,
  ): Promise<boolean> {
    return this.openDatabase().then(
      (database) =>
        new Promise<boolean>((resolve, reject) => {
          let settled = false;
          let decision: boolean | null = null;
          let completedReads = 0;
          let transaction: IDBTransaction;
          const current: {
            manifest?: unknown;
            finalResult?: unknown;
            terminal?: unknown;
          } = {};

          const rejectOnce = (error: AnalysisResultStoreError): void => {
            if (!settled) {
              settled = true;
              reject(error);
            }
          };
          const abortAfter = (error: AnalysisResultStoreError): void => {
            rejectOnce(error);
            try {
              transaction.abort();
            } catch {
              // The request error remains authoritative.
            }
          };

          try {
            transaction = database.transaction(
              FAST_PASS_RESULT_OBJECT_STORES,
              "readwrite",
            );
          } catch (cause) {
            rejectOnce(
              normalizeStoreFailure(
                cause,
                "TRANSACTION_FAILED",
                "Could not start the atomic fast-pass publication transaction.",
              ),
            );
            return;
          }

          transaction.oncomplete = () => {
            if (settled) return;
            if (decision === null) {
              rejectOnce(
                new AnalysisResultStoreError(
                  "TRANSACTION_FAILED",
                  "The fast-pass publication transaction completed before its immutable-write decision.",
                ),
              );
              return;
            }
            settled = true;
            resolve(decision);
          };
          transaction.onerror = () => {
            rejectOnce(
              requestError(
                transaction.error,
                "atomic fast-pass publication transaction",
              ),
            );
          };
          transaction.onabort = () => {
            rejectOnce(
              requestError(
                transaction.error,
                "aborted atomic fast-pass publication transaction",
              ),
            );
          };

          const addMissingRecords = (): void => {
            let missingWriteCount = 0;
            const add = (
              storeName: AnalysisStoreName,
              value: unknown,
            ): void => {
              missingWriteCount += 1;
              let request: IDBRequest<IDBValidKey>;
              try {
                request = transaction.objectStore(storeName).add(value);
              } catch (cause) {
                abortAfter(
                  normalizeStoreFailure(
                    cause,
                    "TRANSACTION_FAILED",
                    `Could not add immutable fast-pass evidence to ${storeName}.`,
                  ),
                );
                return;
              }
              request.onsuccess = () => {
                missingWriteCount -= 1;
                if (missingWriteCount === 0) {
                  decision = true;
                }
              };
              request.onerror = () => {
                abortAfter(
                  requestError(
                    request.error,
                    `fast-pass publication add request for ${storeName}`,
                  ),
                );
              };
            };

            if (current.manifest === undefined) {
              add(
                ANALYSIS_RESULT_OBJECT_STORES.manifests,
                bundle.manifest,
              );
            }
            if (!settled && current.finalResult === undefined) {
              add(
                ANALYSIS_RESULT_OBJECT_STORES.finalResults,
                bundle.finalResult,
              );
            }
            if (!settled && current.terminal === undefined) {
              add(
                ANALYSIS_RESULT_OBJECT_STORES.terminals,
                bundle.terminal,
              );
            }
            if (missingWriteCount === 0) {
              decision = true;
            }
          };

          const decideAfterReads = (): void => {
            completedReads += 1;
            if (completedReads !== FAST_PASS_RESULT_OBJECT_STORES.length) {
              return;
            }
            try {
              if (
                (current.manifest !== undefined &&
                  !exactJsonSnapshot(
                    validateAndCloneAnalysisRecord(
                      current.manifest as AnalysisManifestRecord,
                      "manifest",
                    ),
                    bundle.manifest,
                  )) ||
                (current.finalResult !== undefined &&
                  !exactJsonSnapshot(
                    validateAndCloneAnalysisRecord(
                      current.finalResult as FinalAnalysisResultRecord,
                      "finalResult",
                    ),
                    bundle.finalResult,
                  )) ||
                (current.terminal !== undefined &&
                  !exactJsonSnapshot(
                    validateAndCloneTerminalRecord(
                      current.terminal as AnalysisTerminalRecord,
                    ),
                    bundle.terminal,
                  ))
              ) {
                decision = false;
                return;
              }
            } catch {
              decision = false;
              return;
            }
            addMissingRecords();
          };

          const read = (
            storeName: AnalysisStoreName,
            assign: (value: unknown) => void,
          ): void => {
            let request: IDBRequest<unknown>;
            try {
              request = transaction
                .objectStore(storeName)
                .get(bundle.manifest.runId);
            } catch (cause) {
              abortAfter(
                normalizeStoreFailure(
                  cause,
                  "TRANSACTION_FAILED",
                  `Could not inspect ${storeName} for fast-pass publication.`,
                ),
              );
              return;
            }
            request.onsuccess = () => {
              if (settled) return;
              assign(request.result);
              decideAfterReads();
            };
            request.onerror = () => {
              abortAfter(
                requestError(
                  request.error,
                  `fast-pass publication read request for ${storeName}`,
                ),
              );
            };
          };

          read(ANALYSIS_RESULT_OBJECT_STORES.manifests, (value) => {
            current.manifest = value;
          });
          read(ANALYSIS_RESULT_OBJECT_STORES.finalResults, (value) => {
            current.finalResult = value;
          });
          read(ANALYSIS_RESULT_OBJECT_STORES.terminals, (value) => {
            current.terminal = value;
          });
        }),
    );
  }

  private writeTerminalRecordOnce(
    record: AnalysisTerminalRecord,
  ): Promise<void> {
    const storeName = ANALYSIS_RESULT_OBJECT_STORES.terminals;
    return this.openDatabase().then(
      (database) =>
        new Promise<void>((resolve, reject) => {
          let settled = false;
          let comparisonFinished = false;
          let transaction: IDBTransaction;

          const rejectOnce = (error: AnalysisResultStoreError): void => {
            if (!settled) {
              settled = true;
              reject(error);
            }
          };
          const abortAfter = (error: AnalysisResultStoreError): void => {
            rejectOnce(error);
            try {
              transaction.abort();
            } catch {
              // The precise comparison/request error above remains authoritative.
            }
          };

          try {
            transaction = database.transaction(storeName, "readwrite");
          } catch (cause) {
            rejectOnce(
              normalizeStoreFailure(
                cause,
                "TRANSACTION_FAILED",
                `Could not start a write-once transaction for ${storeName}.`,
              ),
            );
            return;
          }

          transaction.oncomplete = () => {
            if (settled) {
              return;
            }
            if (!comparisonFinished) {
              rejectOnce(
                new AnalysisResultStoreError(
                  "TRANSACTION_FAILED",
                  `The ${storeName} transaction completed before its write-once decision.`,
                ),
              );
              return;
            }
            settled = true;
            resolve();
          };
          transaction.onerror = () => {
            rejectOnce(
              requestError(
                transaction.error,
                `write-once transaction for ${storeName}`,
              ),
            );
          };
          transaction.onabort = () => {
            rejectOnce(
              requestError(
                transaction.error,
                `aborted write-once transaction for ${storeName}`,
              ),
            );
          };

          try {
            const objectStore = transaction.objectStore(storeName);
            const getRequest = objectStore.get(record.runId);
            getRequest.onsuccess = () => {
              if (settled) {
                return;
              }
              if (getRequest.result !== undefined) {
                try {
                  assertTerminalRecord(getRequest.result);
                } catch (cause) {
                  abortAfter(
                    new AnalysisResultStoreError(
                      "TRANSACTION_FAILED",
                      `The stored terminal disposition for ${record.runId} failed validation.`,
                      cause,
                    ),
                  );
                  return;
                }

                if (!terminalRecordsAreEquivalent(getRequest.result, record)) {
                  abortAfter(terminalConflictError(record.runId));
                  return;
                }
                comparisonFinished = true;
                return;
              }

              let addRequest: IDBRequest<IDBValidKey>;
              try {
                addRequest = objectStore.add(record);
              } catch (cause) {
                abortAfter(
                  normalizeStoreFailure(
                    cause,
                    "TRANSACTION_FAILED",
                    `Could not add the first terminal disposition for ${record.runId}.`,
                  ),
                );
                return;
              }
              addRequest.onsuccess = () => {
                comparisonFinished = true;
              };
              addRequest.onerror = () => {
                abortAfter(
                  requestError(
                    addRequest.error,
                    `write-once add request for ${storeName}`,
                  ),
                );
              };
            };
            getRequest.onerror = () => {
              abortAfter(
                requestError(
                  getRequest.error,
                  `write-once read request for ${storeName}`,
                ),
              );
            };
          } catch (cause) {
            abortAfter(
              normalizeStoreFailure(
                cause,
                "TRANSACTION_FAILED",
                `Could not compare a terminal disposition in ${storeName}.`,
              ),
            );
          }
        }),
    );
  }

  private readRecord<T>(
    storeName: AnalysisStoreName,
    key: string,
    deserialize: (value: unknown) => T,
  ): Promise<T | null> {
    return this.openDatabase().then(
      (database) =>
        new Promise<T | null>((resolve, reject) => {
          let settled = false;
          let requestFinished = false;
          let loaded: T | null = null;
          let transaction: IDBTransaction;

          const rejectOnce = (error: AnalysisResultStoreError): void => {
            if (!settled) {
              settled = true;
              reject(error);
            }
          };

          try {
            transaction = database.transaction(storeName, "readonly");
          } catch (cause) {
            rejectOnce(
              normalizeStoreFailure(
                cause,
                "TRANSACTION_FAILED",
                `Could not start a read transaction for ${storeName}.`,
              ),
            );
            return;
          }

          transaction.oncomplete = () => {
            if (settled) {
              return;
            }
            if (!requestFinished) {
              rejectOnce(
                new AnalysisResultStoreError(
                  "TRANSACTION_FAILED",
                  `The ${storeName} read transaction completed without a request result.`,
                ),
              );
              return;
            }
            settled = true;
            resolve(loaded);
          };
          transaction.onerror = () => {
            rejectOnce(
              requestError(
                transaction.error,
                `read transaction for ${storeName}`,
              ),
            );
          };
          transaction.onabort = () => {
            rejectOnce(
              requestError(
                transaction.error,
                `aborted read transaction for ${storeName}`,
              ),
            );
          };

          try {
            const request = transaction.objectStore(storeName).get(key);
            request.onsuccess = () => {
              try {
                loaded =
                  request.result === undefined
                    ? null
                    : deserialize(request.result);
                requestFinished = true;
              } catch (cause) {
                rejectOnce(
                  normalizeStoreFailure(
                    cause,
                    "TRANSACTION_FAILED",
                    `The stored ${storeName} record failed validation.`,
                  ),
                );
                try {
                  transaction.abort();
                } catch {
                  // The validation failure above remains the reported cause.
                }
              }
            };
            request.onerror = () => {
              rejectOnce(
                requestError(request.error, `read request for ${storeName}`),
              );
            };
          } catch (cause) {
            try {
              transaction.abort();
            } catch {
              // The original operation error is more useful than an abort race.
            }
            rejectOnce(
              normalizeStoreFailure(
                cause,
                "TRANSACTION_FAILED",
                `Could not read a record from ${storeName}.`,
              ),
            );
          }
        }),
    );
  }

  private readAllRecords<T>(
    storeName: AnalysisStoreName,
    deserialize: (value: unknown) => T,
  ): Promise<readonly T[]> {
    return this.openDatabase().then(
      (database) =>
        new Promise<readonly T[]>((resolve, reject) => {
          let settled = false;
          let requestFinished = false;
          let loaded: readonly T[] = [];
          let transaction: IDBTransaction;

          const rejectOnce = (error: AnalysisResultStoreError): void => {
            if (!settled) {
              settled = true;
              reject(error);
            }
          };

          try {
            transaction = database.transaction(storeName, "readonly");
          } catch (cause) {
            rejectOnce(
              normalizeStoreFailure(
                cause,
                "TRANSACTION_FAILED",
                `Could not start a list transaction for ${storeName}.`,
              ),
            );
            return;
          }

          transaction.oncomplete = () => {
            if (settled) {
              return;
            }
            if (!requestFinished) {
              rejectOnce(
                new AnalysisResultStoreError(
                  "TRANSACTION_FAILED",
                  `The ${storeName} list transaction completed without a request result.`,
                ),
              );
              return;
            }
            settled = true;
            resolve(loaded);
          };
          transaction.onerror = () => {
            rejectOnce(
              requestError(
                transaction.error,
                `list transaction for ${storeName}`,
              ),
            );
          };
          transaction.onabort = () => {
            rejectOnce(
              requestError(
                transaction.error,
                `aborted list transaction for ${storeName}`,
              ),
            );
          };

          try {
            const request = transaction.objectStore(storeName).getAll();
            request.onsuccess = () => {
              try {
                const values = Array.isArray(request.result)
                  ? request.result
                  : [];
                loaded = values.map(deserialize);
                requestFinished = true;
              } catch (cause) {
                rejectOnce(
                  normalizeStoreFailure(
                    cause,
                    "TRANSACTION_FAILED",
                    `The stored ${storeName} records failed validation.`,
                  ),
                );
                try {
                  transaction.abort();
                } catch {
                  // The validation failure above remains the reported cause.
                }
              }
            };
            request.onerror = () => {
              rejectOnce(
                requestError(request.error, `list request for ${storeName}`),
              );
            };
          } catch (cause) {
            try {
              transaction.abort();
            } catch {
              // The original operation error is more useful than an abort race.
            }
            rejectOnce(
              normalizeStoreFailure(
                cause,
                "TRANSACTION_FAILED",
                `Could not list records from ${storeName}.`,
              ),
            );
          }
        }),
    );
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (this.closed) {
      return Promise.reject(storeClosedError());
    }
    if (this.database !== null) {
      return Promise.resolve(this.database);
    }
    if (this.openPromise !== null) {
      return this.openPromise;
    }
    const factory = this.factory;
    if (factory === null) {
      return Promise.reject(
        new AnalysisResultStoreError(
          "INDEXED_DB_UNAVAILABLE",
          "IndexedDB is unavailable in this browser context.",
        ),
      );
    }

    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false;
      let upgradeError: AnalysisResultStoreError | null = null;
      let request: IDBOpenDBRequest;

      const rejectOnce = (error: AnalysisResultStoreError): void => {
        if (!settled) {
          settled = true;
          this.rejectPendingOpen = null;
          reject(error);
        }
      };
      this.rejectPendingOpen = rejectOnce;

      try {
        request = factory.open(this.dbName, this.version);
      } catch (cause) {
        rejectOnce(
          normalizeStoreFailure(
            cause,
            "OPEN_FAILED",
            "IndexedDB could not be opened.",
          ),
        );
        return;
      }

      request.onupgradeneeded = () => {
        try {
          for (const storeName of ALL_OBJECT_STORES) {
            if (!request.result.objectStoreNames.contains(storeName)) {
              request.result.createObjectStore(storeName, {
                keyPath: keyPathFor(storeName),
              });
              continue;
            }

            const transaction = request.transaction;
            if (transaction === null) {
              throw new AnalysisResultStoreError(
                "SCHEMA_MISMATCH",
                `IndexedDB upgrade transaction is missing for ${storeName}.`,
              );
            }
            const actualKeyPath = transaction.objectStore(storeName).keyPath;
            if (actualKeyPath !== keyPathFor(storeName)) {
              throw new AnalysisResultStoreError(
                "SCHEMA_MISMATCH",
                `IndexedDB store ${storeName} has an incompatible key path.`,
              );
            }
          }
        } catch (cause) {
          upgradeError = normalizeStoreFailure(
            cause,
            "SCHEMA_MISMATCH",
            "IndexedDB schema upgrade failed safely.",
          );
          try {
            request.transaction?.abort();
          } catch {
            // request.onerror reports the upgrade failure after abort.
          }
        }
      };

      request.onblocked = () => {
        rejectOnce(
          new AnalysisResultStoreError(
            "OPEN_BLOCKED",
            "IndexedDB upgrade is blocked by another open ExClipper tab.",
          ),
        );
      };
      request.onerror = () => {
        rejectOnce(
          upgradeError ??
            normalizeStoreFailure(
              request.error,
              "OPEN_FAILED",
              "IndexedDB could not be opened.",
            ),
        );
      };
      request.onsuccess = () => {
        const database = request.result;
        if (settled || this.closed || upgradeError !== null) {
          database.close();
          if (!settled) {
            rejectOnce(upgradeError ?? storeClosedError());
          }
          return;
        }

        database.onversionchange = () => {
          database.close();
          if (this.database === database) {
            this.database = null;
            this.openPromise = null;
          }
        };
        settled = true;
        this.rejectPendingOpen = null;
        this.database = database;
        resolve(database);
      };
    });

    this.openPromise = opening;
    void opening.catch(() => {
      if (this.openPromise === opening) {
        this.openPromise = null;
      }
    });
    return opening;
  }
}

function keyPathFor(
  storeName: AnalysisStoreName,
): "runId" | "sourceCheckId" | "jobId" {
  if (storeName === ANALYSIS_RESULT_OBJECT_STORES.sourceSnapshots)
    return "sourceCheckId";
  if (storeName === ANALYSIS_RESULT_OBJECT_STORES.jobs) return "jobId";
  return "runId";
}

/** 실행 결과가 들어 있는 저장소들. 작업을 지울 때 함께 비워야 하는 곳이다. */
const RUN_KEYED_OBJECT_STORES: readonly AnalysisStoreName[] =
  ALL_OBJECT_STORES.filter((storeName) => keyPathFor(storeName) === "runId");

function sortTerminalRecordsNewestFirst(
  records: readonly AnalysisTerminalRecord[],
): readonly AnalysisTerminalRecord[] {
  return [...records].sort(
    (left, right) =>
      right.recordedAt.localeCompare(left.recordedAt) ||
      left.runId.localeCompare(right.runId),
  );
}
