import {
  broadcastContextFailureDisposition,
  parseBroadcastContextProxyResult,
  requestBroadcastContextDeepseek,
  type BroadcastContextAnalysisMode,
} from "../analysis/broadcastContextDeepseekClient";
import {
  broadcastContextPhaseLedgerCanComplete,
  broadcastContextPhaseLedgerMatchesFence,
  extendBroadcastContextPhaseLedgerPlan,
  normalizeBroadcastContextPhaseLedger,
  replaceBroadcastContextRefinementPhaseLedgerPlan,
  serializeBroadcastContextPhaseLedger,
  type BroadcastContextPhaseLedger,
  type BroadcastContextPhaseLedgerFence,
  type BroadcastContextPhaseLedgerJsonValue,
  type BroadcastContextPhaseLedgerPlannedUnit,
} from "../analysis/broadcastContextPhaseLedger";
import {
  runBroadcastContextPhaseLedger,
  type BroadcastContextPhasePersistedTransition,
  type BroadcastContextPhaseRunnerResult,
} from "../analysis/broadcastContextPhaseRunner";
import {
  BROADCAST_CONTEXT_SCHEMA_VERSION,
  MAX_BROADCAST_CONTEXT_SOURCE_DURATION_MS,
  createBroadcastContextRequest,
  type BroadcastContextDiscoveredLead,
  type BroadcastContextRequest,
  type BroadcastContextRequestInput,
  type BroadcastContextResult,
} from "../analysis/broadcastContextProtocol";
import { isCandidatePassBCastRosterId } from "../analysis/participantRoster";
import { MAX_TOPICAL_REFINEMENT_CONCURRENCY } from "../analysis/broadcastTopicalDiscovery";
import { isAnalysisLanguage } from "../domain/analysisLanguage";
import { createContentFingerprint } from "../security/contentFingerprint";

export const DURABLE_BROADCAST_REFINEMENT_ABSTENTION_SCHEMA_VERSION =
  "1.0.0" as const;

const REFINEMENT_UNIT_INPUT_DOMAIN =
  "exclipper.broadcast-refinement-unit-input.v2";
const MAXIMUM_REFINEMENT_ATTEMPTS = 8;
const MAXIMUM_REFINEMENT_EXECUTIONS_PER_INVOCATION = 3;
const MAX_LEAD_ID_LENGTH = 256;
const MAX_CANONICAL_JSON_DEPTH = 32;
const MAX_CANONICAL_JSON_NODES = 100_000;

export type DurableBroadcastRefinementMode = Extract<
  BroadcastContextAnalysisMode,
  "refinement" | "refinement-fast"
>;

export interface DurableBroadcastRefinementLeadInput {
  readonly leadId: string;
  readonly analysisMode: DurableBroadcastRefinementMode;
  /**
   * A request with no chapters is a deliberate local editorial abstention.
   * Every non-empty request is normalized through createBroadcastContextRequest
   * before its digest is planned or a provider is called.
   */
  readonly requestInput: BroadcastContextRequestInput;
}

export type DurableBroadcastRefinementPersistCause =
  | "refinement-plan-extended"
  | "refinement-plan-replaced"
  | "runner-transition";

export interface DurableBroadcastRefinementCheckpoint {
  readonly cause: DurableBroadcastRefinementPersistCause;
  readonly ledger: BroadcastContextPhaseLedger;
  readonly ledgerJson: string;
  readonly transition: BroadcastContextPhasePersistedTransition | null;
}

export type DurableBroadcastRefinementPersistAndReadBack = (
  checkpoint: DurableBroadcastRefinementCheckpoint,
) => Promise<void>;

type RefinementRequest = typeof requestBroadcastContextDeepseek;
type RefinementFingerprint = (
  parts: readonly string[],
) => Promise<string>;

export interface DurableBroadcastRefinementPipelineInput {
  readonly ledger: BroadcastContextPhaseLedger;
  readonly fence: BroadcastContextPhaseLedgerFence;
  readonly leads: readonly DurableBroadcastRefinementLeadInput[];
  readonly quotaParticipantId: string;
  readonly runId: string;
  /** Exact transcript/caption evidence manifest consumed by this child plan. */
  readonly evidenceManifestSignature: string;
  /** Exact provider/model routing policy used for every unit in this plan. */
  readonly routingManifestSignature: string;
  readonly operationGeneration: number;
  readonly signal: AbortSignal;
  /**
   * This callback must atomically persist ledgerJson and read the exact value
   * back before resolving. The pipeline serializes all runner transitions.
   */
  readonly persistAndReadBack: DurableBroadcastRefinementPersistAndReadBack;
  readonly request?: RefinementRequest;
  readonly fingerprint?: RefinementFingerprint;
  readonly maximumConcurrency?: number;
}

export type DurableBroadcastRefinementLeadResult =
  | {
      readonly leadId: string;
      readonly analysisMode: DurableBroadcastRefinementMode;
      readonly abstained: true;
      readonly result: null;
      readonly discoveredLeads: readonly [];
    }
  | {
      readonly leadId: string;
      readonly analysisMode: DurableBroadcastRefinementMode;
      readonly abstained: false;
      readonly result: BroadcastContextResult;
      readonly discoveredLeads: readonly BroadcastContextDiscoveredLead[];
    };

export interface DurableBroadcastRefinementPipelineResult {
  readonly refinements: readonly DurableBroadcastRefinementLeadResult[];
  readonly ledger: BroadcastContextPhaseLedger;
  readonly runner: BroadcastContextPhaseRunnerResult;
}

export type DurableBroadcastRefinementPipelineErrorCode =
  | "INVALID_LEDGER"
  | "FENCE_MISMATCH"
  | "PARENT_PHASE_INCOMPLETE"
  | "INVALID_OPERATION_GENERATION"
  | "INVALID_CONCURRENCY"
  | "INVALID_LEAD_PLAN"
  | "REFINEMENT_PLAN_MISMATCH"
  | "PIPELINE_BLOCKED"
  | "STORED_RESULT_INVALID";

export class DurableBroadcastRefinementPipelineError extends Error {
  public readonly name = "DurableBroadcastRefinementPipelineError";

  public constructor(
    public readonly code: DurableBroadcastRefinementPipelineErrorCode,
    message: string,
    public readonly ledger: BroadcastContextPhaseLedger | null,
    public readonly causeValue: unknown = null,
  ) {
    super(message);
  }
}

interface RuntimeRefinementLead {
  readonly leadId: string;
  readonly unitId: string;
  readonly analysisMode: DurableBroadcastRefinementMode;
  readonly requestInput: BroadcastContextRequestInput | null;
  readonly outputLanguage: "ko" | "en";
  readonly inputDigest: string;
}

interface CanonicalJsonBudget {
  remainingNodes: number;
}

class InvalidProviderRefinementResultError extends Error {
  public readonly name = "InvalidProviderRefinementResultError";
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException(
      "Broadcast refinement analysis was aborted.",
      "AbortError",
    );
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalizeJsonValue(
  value: unknown,
  depth: number,
  budget: CanonicalJsonBudget,
  ancestors: ReadonlySet<object>,
): unknown {
  budget.remainingNodes -= 1;
  if (
    budget.remainingNodes < 0 ||
    depth > MAX_CANONICAL_JSON_DEPTH
  ) {
    throw new TypeError("Refinement input JSON exceeds its bounded shape.");
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Refinement input JSON contains a non-finite number.");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") {
    throw new TypeError("Refinement input must contain only JSON values.");
  }
  if (ancestors.has(value)) {
    throw new TypeError("Refinement input JSON must not contain cycles.");
  }
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) =>
      canonicalizeJsonValue(entry, depth + 1, budget, nextAncestors),
    );
  }
  if (!isPlainRecord(value)) {
    throw new TypeError("Refinement input JSON objects must be plain records.");
  }
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (
      key === "__proto__" ||
      key === "constructor" ||
      key === "prototype"
    ) {
      throw new TypeError("Refinement input JSON contains an unsafe key.");
    }
    normalized[key] = canonicalizeJsonValue(
      value[key],
      depth + 1,
      budget,
      nextAncestors,
    );
  }
  return normalized;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(
    canonicalizeJsonValue(
      value,
      0,
      { remainingNodes: MAX_CANONICAL_JSON_NODES },
      new Set<object>(),
    ),
  );
}

function assertIdentifier(value: string, label: string): void {
  let containsControlCharacter = false;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint <= 31 || codePoint === 127) {
      containsControlCharacter = true;
      break;
    }
  }
  if (
    value.length === 0 ||
    value.length > MAX_LEAD_ID_LENGTH ||
    value.trim() !== value ||
    containsControlCharacter
  ) {
    throw new DurableBroadcastRefinementPipelineError(
      "INVALID_LEAD_PLAN",
      `${label} is not a bounded identifier.`,
      null,
    );
  }
}

function canonicalRequestInput(
  request: BroadcastContextRequest,
): BroadcastContextRequestInput {
  return Object.freeze({
    sourceDurationMs: request.sourceDurationMs,
    chapters: request.chapters,
    candidates: request.candidates,
    participantGrounding: request.participantGrounding,
    outputLanguage: request.outputLanguage,
    ...(request.castRosterId === null
      ? {}
      : { castRosterId: request.castRosterId }),
  });
}

function canonicalEmptyRequestDescriptor(
  input: BroadcastContextRequestInput,
): Readonly<Record<string, unknown>> {
  if (
    !Number.isSafeInteger(input.sourceDurationMs) ||
    input.sourceDurationMs <= 0 ||
    input.sourceDurationMs > MAX_BROADCAST_CONTEXT_SOURCE_DURATION_MS ||
    !Array.isArray(input.chapters) ||
    input.chapters.length !== 0 ||
    !Array.isArray(input.candidates) ||
    input.candidates.length !== 0 ||
    (input.castRosterId !== undefined &&
      !isCandidatePassBCastRosterId(input.castRosterId)) ||
    (input.outputLanguage !== undefined &&
      !isAnalysisLanguage(input.outputLanguage))
  ) {
    throw new TypeError("Empty refinement request is not canonical.");
  }
  return Object.freeze({
    schemaVersion: BROADCAST_CONTEXT_SCHEMA_VERSION,
    sourceDurationMs: input.sourceDurationMs,
    chapters: Object.freeze([]),
    candidates: Object.freeze([]),
    castRosterId: input.castRosterId ?? null,
    participantGrounding: input.participantGrounding ?? null,
    outputLanguage: input.outputLanguage ?? "ko",
    localDisposition: "no-usable-chapters",
  });
}

function asLedgerJsonValue(
  value: unknown,
): BroadcastContextPhaseLedgerJsonValue {
  return JSON.parse(JSON.stringify(value)) as BroadcastContextPhaseLedgerJsonValue;
}

function localAbstentionResult(leadId: string) {
  return Object.freeze({
    kind: "refinement-abstained-no-chapters",
    schemaVersion: DURABLE_BROADCAST_REFINEMENT_ABSTENTION_SCHEMA_VERSION,
    leadId,
  });
}

function parseLocalAbstention(
  value: unknown,
  leadId: string,
): boolean {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value).sort();
  return (
    keys.length === 3 &&
    keys[0] === "kind" &&
    keys[1] === "leadId" &&
    keys[2] === "schemaVersion" &&
    value.kind === "refinement-abstained-no-chapters" &&
    value.schemaVersion ===
      DURABLE_BROADCAST_REFINEMENT_ABSTENTION_SCHEMA_VERSION &&
    value.leadId === leadId
  );
}

function classifyRefinementFailure(error: unknown) {
  const disposition = broadcastContextFailureDisposition(error);
  return disposition === "retryable"
    ? {
        disposition: "retryable-gap" as const,
        reasonCode: "provider_explicitly_retryable",
      }
    : {
        disposition: "outcome-unknown" as const,
        reasonCode:
          error instanceof InvalidProviderRefinementResultError
            ? "provider_refinement_result_invalid"
            : disposition === "aborted"
              ? "client_aborted_after_possible_dispatch"
              : disposition === "fatal"
                ? "provider_rejected_requires_editor_retry"
                : "provider_outcome_unknown",
      };
}

function assertParentPhasesSucceeded(
  ledger: BroadcastContextPhaseLedger,
): void {
  const discoveryUnits = ledger.units.filter(
    ({ phase }) => phase === "discovery",
  );
  const juryUnits = ledger.units.filter(({ phase }) => phase === "jury");
  if (
    discoveryUnits.length === 0 ||
    juryUnits.length === 0 ||
    [...discoveryUnits, ...juryUnits].some(
      ({ status }) => status !== "succeeded",
    )
  ) {
    throw new DurableBroadcastRefinementPipelineError(
      "PARENT_PHASE_INCOMPLETE",
      "Discovery and jury must be durably complete before refinement starts.",
      ledger,
    );
  }
}

function hasExactRefinementPlan(
  ledger: BroadcastContextPhaseLedger,
  plan: readonly BroadcastContextPhaseLedgerPlannedUnit[],
): boolean {
  const storedUnits = ledger.units.filter(
    ({ phase }) => phase === "refinement",
  );
  return (
    storedUnits.length === plan.length &&
    plan.every((planned) => {
      const stored = storedUnits.find(
        ({ unitId }) => unitId === planned.unitId,
      );
      return (
        stored !== undefined &&
        stored.inputDigest === planned.inputDigest &&
        stored.required === planned.required
      );
    })
  );
}

function uniqueOperationId(
  base: string,
  usedOperationIds: ReadonlySet<string>,
): string {
  if (!usedOperationIds.has(base)) return base;
  for (let suffix = 1; suffix <= 16_384; suffix += 1) {
    const candidate = `${base}-u${suffix}`;
    if (!usedOperationIds.has(candidate)) return candidate;
  }
  throw new DurableBroadcastRefinementPipelineError(
    "INVALID_LEAD_PLAN",
    "A fresh refinement operation identity could not be allocated.",
    null,
  );
}

function isRefinementModelReceipt(
  receipt: unknown,
): receipt is Readonly<{
  routingManifestSignature: string;
  evidenceManifestSignature: string;
  outputLanguage: "ko" | "en";
  analysisMode: DurableBroadcastRefinementMode;
  providerDispatch: boolean;
}> {
  if (
    !isPlainRecord(receipt) ||
    Object.keys(receipt).sort().join("|") !==
      [
        "analysisMode",
        "evidenceManifestSignature",
        "outputLanguage",
        "providerDispatch",
        "routingManifestSignature",
      ]
        .sort()
        .join("|")
  ) {
    return false;
  }
  return (
    typeof receipt.routingManifestSignature === "string" &&
    receipt.routingManifestSignature.length > 0 &&
    typeof receipt.evidenceManifestSignature === "string" &&
    receipt.evidenceManifestSignature.length > 0 &&
    (receipt.outputLanguage === "ko" || receipt.outputLanguage === "en") &&
    (receipt.analysisMode === "refinement" ||
      receipt.analysisMode === "refinement-fast") &&
    typeof receipt.providerDispatch === "boolean"
  );
}

function refinementReceiptMatchesRuntime(
  receipt: unknown,
  runtime: RuntimeRefinementLead,
  options: Pick<
    DurableBroadcastRefinementPipelineInput,
    "evidenceManifestSignature" | "routingManifestSignature"
  >,
): boolean {
  if (!isRefinementModelReceipt(receipt)) return false;
  return (
    receipt.routingManifestSignature === options.routingManifestSignature &&
    receipt.evidenceManifestSignature === options.evidenceManifestSignature &&
    receipt.outputLanguage === runtime.outputLanguage &&
    receipt.analysisMode === runtime.analysisMode &&
    receipt.providerDispatch === (runtime.requestInput !== null)
  );
}

function assertSucceededUnitReceipt(
  ledger: BroadcastContextPhaseLedger,
  runtime: RuntimeRefinementLead,
  options: Pick<
    DurableBroadcastRefinementPipelineInput,
    "evidenceManifestSignature" | "routingManifestSignature"
  >,
): void {
  const unit = ledger.units.find(
    (candidate) =>
      candidate.phase === "refinement" &&
      candidate.unitId === runtime.unitId,
  );
  if (
    unit?.status === "succeeded" &&
    (!isRefinementModelReceipt(unit.modelReceipt) ||
      (unit.inputDigest === runtime.inputDigest &&
        !refinementReceiptMatchesRuntime(unit.modelReceipt, runtime, options)))
  ) {
    throw new DurableBroadcastRefinementPipelineError(
      "STORED_RESULT_INVALID",
      `Refinement unit ${runtime.unitId} has no exact model and evidence receipt. Explicit editor retry is required before another provider request.`,
      ledger,
    );
  }
}

function successfulUnitResult(
  ledger: BroadcastContextPhaseLedger,
  runtime: RuntimeRefinementLead,
  options: Pick<
    DurableBroadcastRefinementPipelineInput,
    "evidenceManifestSignature" | "routingManifestSignature"
  >,
): unknown {
  const unit = ledger.units.find(
    (candidate) =>
      candidate.phase === "refinement" &&
      candidate.unitId === runtime.unitId,
  );
  if (
    unit === undefined ||
    unit.status !== "succeeded" ||
    !Object.hasOwn(unit, "result") ||
    !refinementReceiptMatchesRuntime(unit.modelReceipt, runtime, options)
  ) {
    throw new DurableBroadcastRefinementPipelineError(
      "STORED_RESULT_INVALID",
      `Refinement unit ${runtime.unitId} does not contain a durable result with its exact model and evidence receipt.`,
      ledger,
    );
  }
  return unit.result;
}

function assertRunnerComplete(
  outcome: BroadcastContextPhaseRunnerResult,
): void {
  if (outcome.complete) return;
  const ambiguousCount = outcome.blockingUnits.filter(
    ({ status }) => status === "outcome-unknown",
  ).length;
  throw new DurableBroadcastRefinementPipelineError(
    "PIPELINE_BLOCKED",
    ambiguousCount > 0
      ? `${ambiguousCount} refinement result(s) may already have been billed, so automatic retry stopped.`
      : `${outcome.blockingUnits.length} refinement unit(s) did not finish within the bounded retry wave.`,
    outcome.ledger,
  );
}

export async function runDurableBroadcastRefinementPipeline(
  options: DurableBroadcastRefinementPipelineInput,
): Promise<DurableBroadcastRefinementPipelineResult> {
  const normalizedLedger = normalizeBroadcastContextPhaseLedger(
    options.ledger,
  );
  if (normalizedLedger === null) {
    throw new DurableBroadcastRefinementPipelineError(
      "INVALID_LEDGER",
      "The broadcast context phase ledger is invalid.",
      null,
    );
  }
  if (
    !broadcastContextPhaseLedgerMatchesFence(
      normalizedLedger,
      options.fence,
    )
  ) {
    throw new DurableBroadcastRefinementPipelineError(
      "FENCE_MISMATCH",
      "The refinement ledger does not match the current context, transcript, and grounding fence.",
      normalizedLedger,
    );
  }
  assertParentPhasesSucceeded(normalizedLedger);
  assertIdentifier(
    options.routingManifestSignature,
    "Refinement routing manifest signature",
  );
  assertIdentifier(
    options.evidenceManifestSignature,
    "Refinement evidence manifest signature",
  );
  if (
    !Number.isSafeInteger(options.operationGeneration) ||
    options.operationGeneration < 0
  ) {
    throw new DurableBroadcastRefinementPipelineError(
      "INVALID_OPERATION_GENERATION",
      "The refinement operation generation must be a non-negative integer.",
      normalizedLedger,
    );
  }
  const maximumConcurrency =
    options.maximumConcurrency ?? MAX_TOPICAL_REFINEMENT_CONCURRENCY;
  if (
    !Number.isSafeInteger(maximumConcurrency) ||
    maximumConcurrency < 1 ||
    maximumConcurrency > MAX_TOPICAL_REFINEMENT_CONCURRENCY
  ) {
    throw new DurableBroadcastRefinementPipelineError(
      "INVALID_CONCURRENCY",
      `Refinement concurrency must be between 1 and ${MAX_TOPICAL_REFINEMENT_CONCURRENCY}.`,
      normalizedLedger,
    );
  }
  throwIfAborted(options.signal);

  const fingerprint = options.fingerprint ?? createContentFingerprint;
  const seenLeadIds = new Set<string>();
  const runtimeLeads: RuntimeRefinementLead[] = [];
  for (const lead of options.leads) {
    try {
      assertIdentifier(lead.leadId, "Refinement lead ID");
      if (seenLeadIds.has(lead.leadId)) {
        throw new TypeError("Refinement lead IDs must be unique.");
      }
      seenLeadIds.add(lead.leadId);
      if (
        lead.analysisMode !== "refinement" &&
        lead.analysisMode !== "refinement-fast"
      ) {
        throw new TypeError("Refinement mode is not supported.");
      }
      if (
        !Array.isArray(lead.requestInput.chapters) ||
        !Array.isArray(lead.requestInput.candidates) ||
        lead.requestInput.candidates.length !== 0
      ) {
        throw new TypeError(
          "Per-lead refinement requests must not contain existing candidates.",
        );
      }
      const request =
        lead.requestInput.chapters.length === 0
          ? null
          : createBroadcastContextRequest(lead.requestInput);
      const digestPayload =
        request === null
          ? canonicalEmptyRequestDescriptor(lead.requestInput)
          : request;
      const inputDigest = await fingerprint([
        REFINEMENT_UNIT_INPUT_DOMAIN,
        options.evidenceManifestSignature,
        options.routingManifestSignature,
        lead.leadId,
        lead.analysisMode,
        canonicalJson(digestPayload),
      ]);
      runtimeLeads.push(
        Object.freeze({
          leadId: lead.leadId,
          unitId: `lead:${lead.leadId}`,
          analysisMode: lead.analysisMode,
          requestInput:
            request === null ? null : canonicalRequestInput(request),
          outputLanguage: lead.requestInput.outputLanguage ?? "ko",
          inputDigest,
        }),
      );
    } catch (error) {
      if (error instanceof DurableBroadcastRefinementPipelineError) {
        throw error;
      }
      throw new DurableBroadcastRefinementPipelineError(
        "INVALID_LEAD_PLAN",
        `Refinement lead ${lead.leadId || "(empty)"} is not a valid exact request.`,
        normalizedLedger,
        error,
      );
    }
  }
  throwIfAborted(options.signal);

  const usedOperationIds = new Set(normalizedLedger.usedOperationIds);
  const plannedUnits = runtimeLeads.map(
    ({ unitId, inputDigest }, index): BroadcastContextPhaseLedgerPlannedUnit => {
      const operationId = uniqueOperationId(
        `context-refinement-${index}` +
          `-g${options.operationGeneration}` +
          `-${inputDigest.slice(-16)}`,
        usedOperationIds,
      );
      usedOperationIds.add(operationId);
      return {
        phase: "refinement",
        unitId,
        inputDigest,
        operationId,
        attemptOrdinal: 0,
        required: true,
      };
    },
  );

  let activeLedger = normalizedLedger;
  const existingRefinementUnits = activeLedger.units.filter(
    ({ phase }) => phase === "refinement",
  );
  const persist = async (
    ledger: BroadcastContextPhaseLedger,
    cause: DurableBroadcastRefinementPersistCause,
    transition: BroadcastContextPhasePersistedTransition | null,
  ): Promise<void> => {
    if (!broadcastContextPhaseLedgerMatchesFence(ledger, options.fence)) {
      throw new DurableBroadcastRefinementPipelineError(
        "FENCE_MISMATCH",
        "A refinement transition crossed the immutable input fence.",
        activeLedger,
      );
    }
    const ledgerJson = serializeBroadcastContextPhaseLedger(ledger);
    await options.persistAndReadBack(
      Object.freeze({
        cause,
        ledger,
        ledgerJson,
        transition,
      }),
    );
    activeLedger = ledger;
  };

  /*
   * A legacy or malformed "succeeded" unit may already represent a billed
   * provider call. Reject it before replacing the plan so a schema migration
   * cannot silently turn that ambiguous receipt into another automatic spend.
   */
  for (const runtime of runtimeLeads) {
    assertSucceededUnitReceipt(activeLedger, runtime, options);
  }

  if (existingRefinementUnits.length === 0 && plannedUnits.length > 0) {
    const extended = extendBroadcastContextPhaseLedgerPlan(
      activeLedger,
      plannedUnits,
    );
    await persist(extended, "refinement-plan-extended", null);
  } else if (!hasExactRefinementPlan(activeLedger, plannedUnits)) {
    const replaced = replaceBroadcastContextRefinementPhaseLedgerPlan(
      activeLedger,
      plannedUnits,
    );
    await persist(replaced, "refinement-plan-replaced", null);
  }

  const runtimeByUnitId = new Map(
    runtimeLeads.map((lead) => [lead.unitId, lead]),
  );
  const unitIndexById = new Map(
    runtimeLeads.map(({ unitId }, index) => [unitId, index]),
  );
  const request = options.request ?? requestBroadcastContextDeepseek;
  const runner = await runBroadcastContextPhaseLedger({
    ledger: activeLedger,
    maximumAttemptCount: MAXIMUM_REFINEMENT_ATTEMPTS,
    maximumExecutionsPerInvocation:
      MAXIMUM_REFINEMENT_EXECUTIONS_PER_INVOCATION,
    maximumConcurrency,
    execute: async (identity) => {
      if (identity.phase !== "refinement") {
        throw new Error("The refinement runner received a parent-phase unit.");
      }
      const runtime = runtimeByUnitId.get(identity.unitId);
      if (
        runtime === undefined ||
        runtime.inputDigest !== identity.inputDigest
      ) {
        throw new Error(
          "The refinement execution does not match its exact planned input.",
        );
      }
      if (runtime.requestInput === null) {
        return {
          result: asLedgerJsonValue(
            localAbstentionResult(runtime.leadId),
          ),
          modelReceipt: {
            routingManifestSignature: options.routingManifestSignature,
            evidenceManifestSignature: options.evidenceManifestSignature,
            outputLanguage: runtime.outputLanguage,
            analysisMode: runtime.analysisMode,
            providerDispatch: false,
          },
        };
      }
      throwIfAborted(options.signal);
      const providerResult = await request(runtime.requestInput, {
        signal: options.signal,
        analysisMode: runtime.analysisMode,
        quota: {
          participantId: options.quotaParticipantId,
          runId: options.runId,
          operationId: identity.operationId,
        },
      });
      const parsed = parseBroadcastContextProxyResult(
        providerResult,
        runtime.requestInput,
      );
      if (parsed === null || parsed.discoveredLeadsSupported !== true) {
        throw new InvalidProviderRefinementResultError(
          "The provider refinement result failed strict local validation.",
        );
      }
      return {
        result: asLedgerJsonValue(parsed),
        modelReceipt: {
          routingManifestSignature: options.routingManifestSignature,
          evidenceManifestSignature: options.evidenceManifestSignature,
          outputLanguage: runtime.outputLanguage,
          analysisMode: runtime.analysisMode,
          providerDispatch: true,
        },
      };
    },
    classifyFailure: classifyRefinementFailure,
    createRetryOperationId: ({
      identity,
      nextAttemptOrdinal,
      usedOperationIds: usedIds,
    }) => {
      const unitIndex = unitIndexById.get(identity.unitId);
      if (unitIndex === undefined) {
        throw new Error("The refinement retry unit is not in the exact plan.");
      }
      return uniqueOperationId(
        `context-refinement-${unitIndex}` +
          `-g${options.operationGeneration}` +
          `-a${nextAttemptOrdinal}` +
          `-${identity.inputDigest.slice(-16)}`,
        new Set(usedIds),
      );
    },
    persist: (ledger, transition) =>
      persist(ledger, "runner-transition", transition),
  });
  activeLedger = runner.ledger;
  assertRunnerComplete(runner);
  if (
    !broadcastContextPhaseLedgerCanComplete(activeLedger) ||
    activeLedger.units.some(
      (unit) => unit.required && unit.status !== "succeeded",
    )
  ) {
    throw new DurableBroadcastRefinementPipelineError(
      "PIPELINE_BLOCKED",
      "Every required context and refinement unit must be durably complete before publication.",
      activeLedger,
    );
  }

  const refinements = runtimeLeads.map(
    (runtime): DurableBroadcastRefinementLeadResult => {
      const payload = successfulUnitResult(
        activeLedger,
        runtime,
        options,
      );
      if (runtime.requestInput === null) {
        if (!parseLocalAbstention(payload, runtime.leadId)) {
          throw new DurableBroadcastRefinementPipelineError(
            "STORED_RESULT_INVALID",
            `The local abstention receipt for ${runtime.leadId} is invalid.`,
            activeLedger,
          );
        }
        return Object.freeze({
          leadId: runtime.leadId,
          analysisMode: runtime.analysisMode,
          abstained: true,
          result: null,
          discoveredLeads: Object.freeze([] as const),
        });
      }
      const parsed = parseBroadcastContextProxyResult(
        payload,
        runtime.requestInput,
      );
      if (parsed === null || parsed.discoveredLeadsSupported !== true) {
        throw new DurableBroadcastRefinementPipelineError(
          "STORED_RESULT_INVALID",
          `The stored provider result for ${runtime.leadId} is invalid.`,
          activeLedger,
        );
      }
      return Object.freeze({
        leadId: runtime.leadId,
        analysisMode: runtime.analysisMode,
        abstained: false,
        result: parsed,
        discoveredLeads: parsed.discoveredLeads,
      });
    },
  );

  return Object.freeze({
    refinements: Object.freeze(refinements),
    ledger: activeLedger,
    runner,
  });
}
