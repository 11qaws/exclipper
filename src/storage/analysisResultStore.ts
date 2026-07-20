import {
  assertDurableBrowserCapabilities,
  assertDurableFailurePayload,
  assertDurableFinalResultPayload,
  assertDurableManifestPayload,
  assertDurableSourceDescriptor,
  durableAnalysisSchemaFamily,
  expectedBrowserCapabilitySignature,
  type DurableAnalysisSchemaFamily,
  type DurableBrowserCapabilities,
  type DurableFailurePayload,
  type DurableFinalResultPayload,
  type DurableManifestPayload,
  type DurableSourceDescriptor,
} from "./durableAnalysisPayload";
import {
  assertCandidatePassBInsightsRecord,
  cloneCandidatePassBInsightsRecord,
  type CandidatePassBInsightsRecord,
} from "./candidatePassBInsightStore";

export type JsonPrimitive = string | number | boolean | null;

export type JsonObject = Readonly<{ [key: string]: JsonValue }>;

export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

export type AnalysisRecordKind =
  | "manifest"
  | "provisionalResult"
  | "finalResult"
  | "failure";

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
export type ProvisionalAnalysisResultRecord = AnalysisRecord<"provisionalResult">;
export type FinalAnalysisResultRecord = AnalysisRecord<"finalResult">;
export type AnalysisFailureRecord = AnalysisRecord<"failure">;

export type AnalysisTerminalOutcome =
  | "completed"
  | "completedWithGaps"
  | "cancelled"
  | "failed";

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

export interface AnalysisResultStore {
  putManifest(record: AnalysisManifestRecord): Promise<void>;
  getManifest(runId: string): Promise<AnalysisManifestRecord | null>;
  putProvisionalResult(record: ProvisionalAnalysisResultRecord): Promise<void>;
  putFinalResult(record: FinalAnalysisResultRecord): Promise<void>;
  putFailureRecord(record: AnalysisFailureRecord): Promise<void>;
  getFinalResult(runId: string): Promise<FinalAnalysisResultRecord | null>;
  putTerminalRecord(record: AnalysisTerminalRecord): Promise<void>;
  getTerminalRecord(runId: string): Promise<AnalysisTerminalRecord | null>;
  listTerminalRecords(): Promise<AnalysisTerminalRecordCatalog>;
  putSourceSnapshot(record: SourceCapabilitySnapshotRecord): Promise<void>;
  getSourceSnapshot(sourceCheckId: string): Promise<SourceCapabilitySnapshotRecord | null>;
  putCandidatePassBInsights(record: CandidatePassBInsightsRecord): Promise<void>;
  getCandidatePassBInsights(runId: string): Promise<CandidatePassBInsightsRecord | null>;
  close(): void;
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

export const DEFAULT_ANALYSIS_RESULT_DB_NAME = "retto-highlight-analysis-results";
export const ANALYSIS_RESULT_DB_VERSION = 3;

export const ANALYSIS_RESULT_OBJECT_STORES = {
  manifests: "analysisManifests",
  provisionalResults: "provisionalAnalysisResults",
  finalResults: "finalAnalysisResults",
  failures: "analysisFailures",
  terminals: "analysisTerminalDispositions",
  sourceSnapshots: "sourceCapabilitySnapshots",
  candidatePassBInsights: "candidatePassBInsights",
} as const;

type AnalysisStoreName =
  (typeof ANALYSIS_RESULT_OBJECT_STORES)[keyof typeof ANALYSIS_RESULT_OBJECT_STORES];

type AnyAnalysisRecord =
  | AnalysisManifestRecord
  | ProvisionalAnalysisResultRecord
  | FinalAnalysisResultRecord
  | AnalysisFailureRecord;

const ALL_OBJECT_STORES = Object.values(ANALYSIS_RESULT_OBJECT_STORES);

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

function payloadError(message: string, cause?: unknown): AnalysisResultStoreError {
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
    throw payloadError(`${path}.${propertyName} is not permitted in durable analysis data.`);
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
      throw payloadError(`${path}.${propertyName} must be a plain data property.`);
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
      assertSafeJsonValue(descriptor.value, `${path}.${propertyName}`, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw payloadError(`${label} must be a non-empty string.`);
  }
}

function assertOperationIdentifier(value: unknown, label: string): asserts value is string {
  assertIdentifier(value, label);
  if (value.length > 180 || !/^[a-z][a-z0-9-]*$/u.test(value)) {
    throw payloadError(`${label} must be a bounded generated identifier.`);
  }
}

function analysisSchemaFamily(value: unknown): DurableAnalysisSchemaFamily {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+$/u.test(value)) {
    throw payloadError("schemaVersion must be a semantic version.");
  }
  try {
    return durableAnalysisSchemaFamily(value);
  } catch (cause) {
    throw payloadError(
      cause instanceof Error ? cause.message : "schemaVersion is not supported.",
      cause,
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
    throw payloadError("modelManifestHash must be a bounded engine identifier.");
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
  const schemaFamily = analysisSchemaFamily(record.schemaVersion);
  assertInputSignature(record.inputSignature);
  assertModelManifestHash(record.modelManifestHash);
  assertRecordedAt(record.recordedAt);
  try {
    if (expectedKind === "manifest") {
      assertDurableManifestPayload(record.result, schemaFamily);
    } else if (expectedKind === "failure") {
      assertDurableFailurePayload(record.result);
    } else {
      assertDurableFinalResultPayload(record.result, schemaFamily);
    }
  } catch (cause) {
    throw payloadError(
      cause instanceof Error ? cause.message : "The analysis payload is invalid.",
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
  analysisSchemaFamily(record.schemaVersion);
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
      cause instanceof Error ? cause.message : "The source capability payload is invalid.",
      cause,
    );
  }
  if (
    typeof record.browserCapabilitySignature !== "string" ||
    record.browserCapabilitySignature !== expectedBrowserCapabilitySignature(capabilities)
  ) {
    throw payloadError(
      "browserCapabilitySignature must be derived exactly from the stored capability flags.",
    );
  }
}

function assertTerminalRecord(value: unknown): asserts value is AnalysisTerminalRecord {
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
  analysisSchemaFamily(record.schemaVersion);
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
  if (record.resultRecordKind !== "finalResult" && record.resultRecordKind !== "failure") {
    throw payloadError("resultRecordKind must reference finalResult or failure.");
  }
  if (
    (record.outcome === "completed" || record.outcome === "completedWithGaps") !==
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
    throw payloadError("The durable record could not be serialized as JSON.", cause);
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
  return new AnalysisResultStoreError("STORE_CLOSED", "The analysis result store is closed.");
}

export class InMemoryAnalysisResultStore implements AnalysisResultStore {
  private readonly manifests = new Map<string, AnalysisManifestRecord>();
  private readonly provisionalResults = new Map<string, ProvisionalAnalysisResultRecord>();
  private readonly finalResults = new Map<string, FinalAnalysisResultRecord>();
  private readonly failures = new Map<string, AnalysisFailureRecord>();
  private readonly terminals = new Map<string, AnalysisTerminalRecord>();
  private readonly sourceSnapshots = new Map<string, SourceCapabilitySnapshotRecord>();
  private readonly candidatePassBInsights = new Map<string, CandidatePassBInsightsRecord>();
  private closed = false;

  public putManifest(record: AnalysisManifestRecord): Promise<void> {
    return this.putAnalysisRecord(this.manifests, record, "manifest");
  }

  public getManifest(runId: string): Promise<AnalysisManifestRecord | null> {
    return rejectedOperation(() => {
      this.assertOpen();
      assertIdentifier(runId, "runId");
      const record = this.manifests.get(runId);
      return record === undefined ? null : cloneJson(record);
    });
  }

  public putProvisionalResult(record: ProvisionalAnalysisResultRecord): Promise<void> {
    return this.putAnalysisRecord(this.provisionalResults, record, "provisionalResult");
  }

  public putFinalResult(record: FinalAnalysisResultRecord): Promise<void> {
    return this.putAnalysisRecord(this.finalResults, record, "finalResult");
  }

  public putFailureRecord(record: AnalysisFailureRecord): Promise<void> {
    return this.putAnalysisRecord(this.failures, record, "failure");
  }

  public getFinalResult(runId: string): Promise<FinalAnalysisResultRecord | null> {
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

  public getTerminalRecord(runId: string): Promise<AnalysisTerminalRecord | null> {
    return rejectedOperation(() => {
      this.assertOpen();
      assertIdentifier(runId, "runId");
      const record = this.terminals.get(runId);
      return record === undefined ? null : cloneJson(record);
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

  public putSourceSnapshot(record: SourceCapabilitySnapshotRecord): Promise<void> {
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

  public putCandidatePassBInsights(record: CandidatePassBInsightsRecord): Promise<void> {
    return rejectedOperation(() => {
      this.assertOpen();
      const snapshot = cloneCandidatePassBInsightsRecord(record);
      this.candidatePassBInsights.set(snapshot.runId, snapshot);
    });
  }

  public getCandidatePassBInsights(
    runId: string,
  ): Promise<CandidatePassBInsightsRecord | null> {
    return rejectedOperation(() => {
      this.assertOpen();
      assertIdentifier(runId, "runId");
      const record = this.candidatePassBInsights.get(runId);
      return record === undefined ? null : cloneCandidatePassBInsightsRecord(record);
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

function requestError(error: DOMException | null, action: string): AnalysisResultStoreError {
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
  private rejectPendingOpen: ((reason: AnalysisResultStoreError) => void) | null = null;
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

  public putManifest(record: AnalysisManifestRecord): Promise<void> {
    return this.putAnalysisRecord(
      ANALYSIS_RESULT_OBJECT_STORES.manifests,
      record,
      "manifest",
    );
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

  public putProvisionalResult(record: ProvisionalAnalysisResultRecord): Promise<void> {
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

  public getFinalResult(runId: string): Promise<FinalAnalysisResultRecord | null> {
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

  public getTerminalRecord(runId: string): Promise<AnalysisTerminalRecord | null> {
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

  public putSourceSnapshot(record: SourceCapabilitySnapshotRecord): Promise<void> {
    return rejectedOperation(() => {
      const snapshot = validateAndCloneSourceSnapshot(record);
      return this.writeRecord(ANALYSIS_RESULT_OBJECT_STORES.sourceSnapshots, snapshot);
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

  public putCandidatePassBInsights(record: CandidatePassBInsightsRecord): Promise<void> {
    return rejectedOperation(() => {
      const snapshot = cloneCandidatePassBInsightsRecord(record);
      return this.writeRecord(ANALYSIS_RESULT_OBJECT_STORES.candidatePassBInsights, snapshot);
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

  private writeRecord(storeName: AnalysisStoreName, record: unknown): Promise<void> {
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
            rejectOnce(requestError(transaction.error, `write transaction for ${storeName}`));
          };
          transaction.onabort = () => {
            rejectOnce(requestError(transaction.error, `aborted write transaction for ${storeName}`));
          };

          try {
            const request = transaction.objectStore(storeName).put(record);
            request.onerror = () => {
              rejectOnce(requestError(request.error, `write request for ${storeName}`));
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

  private writeTerminalRecordOnce(record: AnalysisTerminalRecord): Promise<void> {
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
              requestError(transaction.error, `write-once transaction for ${storeName}`),
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
                requestError(getRequest.error, `write-once read request for ${storeName}`),
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
            rejectOnce(requestError(transaction.error, `read transaction for ${storeName}`));
          };
          transaction.onabort = () => {
            rejectOnce(requestError(transaction.error, `aborted read transaction for ${storeName}`));
          };

          try {
            const request = transaction.objectStore(storeName).get(key);
            request.onsuccess = () => {
              try {
                loaded = request.result === undefined ? null : deserialize(request.result);
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
              rejectOnce(requestError(request.error, `read request for ${storeName}`));
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
            rejectOnce(requestError(transaction.error, `list transaction for ${storeName}`));
          };
          transaction.onabort = () => {
            rejectOnce(
              requestError(transaction.error, `aborted list transaction for ${storeName}`),
            );
          };

          try {
            const request = transaction.objectStore(storeName).getAll();
            request.onsuccess = () => {
              try {
                const values = Array.isArray(request.result) ? request.result : [];
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
              rejectOnce(requestError(request.error, `list request for ${storeName}`));
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
          normalizeStoreFailure(cause, "OPEN_FAILED", "IndexedDB could not be opened."),
        );
        return;
      }

      request.onupgradeneeded = () => {
        try {
          for (const storeName of ALL_OBJECT_STORES) {
            if (!request.result.objectStoreNames.contains(storeName)) {
              request.result.createObjectStore(storeName, { keyPath: keyPathFor(storeName) });
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
            normalizeStoreFailure(request.error, "OPEN_FAILED", "IndexedDB could not be opened."),
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

function keyPathFor(storeName: AnalysisStoreName): "runId" | "sourceCheckId" {
  return storeName === ANALYSIS_RESULT_OBJECT_STORES.sourceSnapshots
    ? "sourceCheckId"
    : "runId";
}

function sortTerminalRecordsNewestFirst(
  records: readonly AnalysisTerminalRecord[],
): readonly AnalysisTerminalRecord[] {
  return [...records].sort(
    (left, right) =>
      right.recordedAt.localeCompare(left.recordedAt) || left.runId.localeCompare(right.runId),
  );
}
