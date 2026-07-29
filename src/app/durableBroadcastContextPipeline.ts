import {
  broadcastContextFailureDisposition,
  parseBroadcastContextProxyResult,
  requestBroadcastContextDeepseek,
  type BroadcastContextAnalysisMode,
} from "../analysis/broadcastContextDeepseekClient";
import {
  broadcastContextPhaseLedgerCanComplete,
  broadcastContextPhaseLedgerMatchesFence,
  createBroadcastContextPhaseLedger,
  extendBroadcastContextPhaseLedgerPlan,
  parseBroadcastContextPhaseLedgerJson,
  replanBroadcastContextPhaseLedgerAfterEditorRetry,
  serializeBroadcastContextPhaseLedger,
  serializeBroadcastContextLedgerJsonValue,
  type BroadcastContextPhaseLedger,
  type BroadcastContextPhaseLedgerFence,
  type BroadcastContextPhaseLedgerJsonValue,
  type BroadcastContextPhaseLedgerPlannedUnit,
  type BroadcastContextPhaseLedgerUnit,
  type BroadcastContextPhaseLedgerUnitIdentity,
} from "../analysis/broadcastContextPhaseLedger";
import {
  runBroadcastContextPhaseLedger,
  type BroadcastContextPhaseExecutionResult,
  type BroadcastContextPhasePersistedTransition,
  type BroadcastContextPhaseReconciliationResult,
  type BroadcastContextPhaseRecoveryAction,
  type BroadcastContextPhaseRunnerResult,
} from "../analysis/broadcastContextPhaseRunner";
import { rebaseBroadcastParticipantGrounding } from "../analysis/broadcastParticipantGrounding";
import {
  createBroadcastContextRequest,
  isFinalBroadcastContextResult,
  type BroadcastContextRequestInput,
  type BroadcastContextResult,
} from "../analysis/broadcastContextProtocol";
import {
  createBroadcastTopicalLeadJuryPlan,
  createParallelBroadcastTopicalDiscoverySlices,
  mergeBroadcastTopicalDiscoveryLeads,
  selectBroadcastTopicalJuryApprovedLeadIds,
  selectBroadcastTopicalRefinementLeadIds,
} from "../analysis/broadcastTopicalDiscovery";
import { createContentFingerprint } from "../security/contentFingerprint";
import type { AnalysisResultStore } from "../storage/analysisResultStore";
import {
  checkpointBroadcastContextSessionPhaseLedger,
  restoreBroadcastParticipantPreContextCheckpoint,
  type BroadcastContextSessionRecord,
} from "../storage/broadcastContextSessionStore";
import { transformDurableBroadcastContextSession } from "./durableBroadcastContextSession";

export const BROADCAST_CONTEXT_UNIT_INPUT_FINGERPRINT_DOMAIN =
  "exclipper.broadcast-context-unit-input.v1";
export const BROADCAST_CONTEXT_UNIT_RESULT_FINGERPRINT_DOMAIN =
  "exclipper.broadcast-context-unit-result.v1";
export const BROADCAST_CONTEXT_FINAL_RESULT_FINGERPRINT_DOMAIN =
  "exclipper.broadcast-context-final-result.v1";
const JURY_ABSTENTION_SCHEMA_VERSION = "1.0.0";
const MAXIMUM_CONTEXT_EXECUTIONS_PER_INVOCATION = 3;
const MAXIMUM_DISCOVERY_CONCURRENCY = 4;
const INITIAL_LEDGER_PERSISTENCE_WAVE_BACKOFF_MS = 250;
const MAXIMUM_LEDGER_PERSISTENCE_WAVE_BACKOFF_MS = 10_000;
const INITIAL_AUTOMATIC_CONTEXT_RETRY_BACKOFF_MS = 1_000;
const MAXIMUM_AUTOMATIC_CONTEXT_RETRY_BACKOFF_MS = 30_000;

type ContextPipelineStore = Pick<
  AnalysisResultStore,
  "getBroadcastContextSession" | "replaceBroadcastContextSessionIfUnchanged"
>;

type ContextRequest = typeof requestBroadcastContextDeepseek;
type ContextFingerprint = typeof createContentFingerprint;
export type DurableBroadcastContextReconcileOperation = (
  identity: BroadcastContextPhaseLedgerUnitIdentity,
  replaySameOperation: () => Promise<BroadcastContextPhaseExecutionResult>,
) => Promise<BroadcastContextPhaseReconciliationResult>;

export type DurableBroadcastContextRetryMode =
  | "automatic-free-tier"
  | "editor-approved-paid";

interface DiscoveryUnitRequest {
  readonly input: BroadcastContextRequestInput;
  readonly analysisMode: Extract<
    BroadcastContextAnalysisMode,
    "overview" | "discovery"
  >;
}

interface JuryRuntime {
  readonly input: BroadcastContextRequestInput | null;
  readonly inputDigest: string;
  readonly result: BroadcastContextResult;
  readonly plan: ReturnType<typeof createBroadcastTopicalLeadJuryPlan>;
}

export interface DurableBroadcastContextPipelineInput {
  readonly store: ContextPipelineStore;
  readonly initialSession: BroadcastContextSessionRecord;
  readonly runId: string;
  readonly contextInput: BroadcastContextRequestInput;
  readonly contextInputSignature: string;
  readonly contextInputCheckpointJson: string;
  readonly fence: BroadcastContextPhaseLedgerFence;
  readonly quotaParticipantId: string;
  readonly operationGeneration: number;
  readonly retryMode: DurableBroadcastContextRetryMode;
  readonly signal: AbortSignal;
  readonly request?: ContextRequest;
  readonly fingerprint?: ContextFingerprint;
  /**
   * Called only after a complete bounded runner invocation has durably settled.
   * Production uses an abort-aware timer; tests may inject a deterministic
   * scheduler without changing retry semantics.
   */
  readonly waitForAutomaticRetry?: (
    delayMs: number,
    signal: AbortSignal,
  ) => Promise<void>;
  /**
   * Optional coordinator-cache/query adapter. Until the proxy exposes one,
   * the pipeline safely replays only the exact current operation.
   */
  readonly reconcileOperation?: DurableBroadcastContextReconcileOperation;
}

export interface DurableBroadcastContextPipelineResult {
  readonly result: BroadcastContextResult;
  readonly refinementLeadIds: readonly string[];
  readonly fastRefinementLeadIds: readonly string[];
  readonly ledger: BroadcastContextPhaseLedger;
  readonly session: BroadcastContextSessionRecord;
}

export class DurableBroadcastContextPipelineBlockedError extends Error {
  public readonly name = "DurableBroadcastContextPipelineBlockedError";
  public readonly code = "PIPELINE_BLOCKED" as const;

  public constructor(
    message: string,
    public readonly ledger: BroadcastContextPhaseLedger,
    public readonly recoveryActions: readonly BroadcastContextPhaseRecoveryAction[],
  ) {
    super(message);
  }
}

class BroadcastContextLocalContractError extends Error {
  public readonly name = "BroadcastContextLocalContractError";
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Broadcast context analysis was aborted.", "AbortError");
  }
}

function waitForLedgerPersistenceRetry(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  return new Promise<void>((resolve, reject) => {
    let timeout: ReturnType<typeof globalThis.setTimeout> | null = null;
    let settled = false;
    const cleanup = (): void => {
      if (timeout !== null) {
        globalThis.clearTimeout(timeout);
        timeout = null;
      }
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new DOMException(
          "Broadcast context ledger persistence was aborted.",
          "AbortError",
        ),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
    timeout = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }, delayMs);
  });
}

function ledgerPersistenceWaveBackoffMs(waveIndex: number): number {
  return Math.min(
    MAXIMUM_LEDGER_PERSISTENCE_WAVE_BACKOFF_MS,
    INITIAL_LEDGER_PERSISTENCE_WAVE_BACKOFF_MS *
      2 ** Math.min(waveIndex, 30),
  );
}

function automaticContextRetryBackoffMs(
  ledger: BroadcastContextPhaseLedger,
): number {
  const highestAttemptOrdinal = Math.max(
    0,
    ...ledger.units
      .filter(({ status }) =>
        status === "retryable-gap" ||
        status === "outcome-unknown" ||
        status === "in-flight" ||
        status === "reconciling",
      )
      .map(({ attemptOrdinal }) => attemptOrdinal),
  );
  return Math.min(
    MAXIMUM_AUTOMATIC_CONTEXT_RETRY_BACKOFF_MS,
    INITIAL_AUTOMATIC_CONTEXT_RETRY_BACKOFF_MS *
      2 ** Math.min(highestAttemptOrdinal, 5),
  );
}

function isTerminalLedgerTransition(
  transition: BroadcastContextPhasePersistedTransition | undefined,
): boolean {
  return (
    transition !== undefined &&
    (transition.resultingStatus === "succeeded" ||
      transition.resultingStatus === "retryable-gap" ||
      transition.resultingStatus === "outcome-unknown" ||
      transition.resultingStatus === "failed")
  );
}

function asLedgerJsonValue(value: unknown): BroadcastContextPhaseLedgerJsonValue {
  return JSON.parse(JSON.stringify(value)) as BroadcastContextPhaseLedgerJsonValue;
}

function hasExactDiscoveryPlan(
  ledger: BroadcastContextPhaseLedger,
  plan: readonly BroadcastContextPhaseLedgerPlannedUnit[],
): boolean {
  const units = ledger.units.filter(({ phase }) => phase === "discovery");
  return (
    units.length === plan.length &&
    plan.every((planned) => {
      const stored = units.find(({ unitId }) => unitId === planned.unitId);
      return (
        stored !== undefined &&
        stored.inputDigest === planned.inputDigest &&
        stored.required === planned.required
      );
    })
  );
}

function successfulUnitResult(
  ledger: BroadcastContextPhaseLedger,
  phase: BroadcastContextPhaseLedgerUnit["phase"],
  unitId: string,
): unknown {
  const unit = ledger.units.find(
    (candidate) =>
      candidate.phase === phase && candidate.unitId === unitId,
  );
  if (
    unit === undefined ||
    unit.status !== "succeeded" ||
    !Object.hasOwn(unit, "result")
  ) {
    throw new Error(
      `방송 맥락 작업 ${phase}/${unitId}의 저장 결과가 완성되지 않았어요.`,
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
  const failedCount = outcome.blockingUnits.filter(
    ({ status }) => status === "failed",
  ).length;
  throw new DurableBroadcastContextPipelineBlockedError(
    failedCount > 0
      ? `방송 맥락 요청 ${failedCount}개가 현재 입력이나 AI 연결 설정으로는 완료될 수 없어요. 원본·입력·API 설정을 바로잡은 뒤 새 분석으로 시작해 주세요.`
      : ambiguousCount > 0
      ? `방송 맥락 요청 ${ambiguousCount}개의 처리 결과를 확인할 수 없어 자동 재결제를 멈췄어요. 다시 시도를 누르면 완료된 조각은 보존하고 해당 조각만 복구합니다.`
      : `방송 맥락 요청 ${outcome.blockingUnits.length}개가 제한 횟수 안에 끝나지 않았어요. 완료된 조각은 저장되어 있습니다.`,
    outcome.ledger,
    outcome.recoveryActions,
  );
}

function classifyContextFailure(error: unknown) {
  if (error instanceof BroadcastContextLocalContractError) {
    return {
      disposition: "failed" as const,
      reasonCode: "local_context_contract_invalid",
    };
  }
  const disposition = broadcastContextFailureDisposition(error);
  if (disposition === "retryable") {
    return {
      disposition: "retryable-gap" as const,
      reasonCode: "provider_explicitly_retryable",
    };
  }
  if (disposition === "fatal") {
    return {
      disposition: "failed" as const,
      reasonCode: "provider_configuration_or_request_rejected",
    };
  }
  return {
    disposition: "outcome-unknown" as const,
    reasonCode:
      disposition === "aborted"
        ? "client_aborted_after_possible_dispatch"
        : "provider_outcome_unknown",
  };
}

function juryAbstentionIsValid(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "jury-abstained-no-candidates" &&
    (value as { schemaVersion?: unknown }).schemaVersion ===
      JURY_ABSTENTION_SCHEMA_VERSION
  );
}

export async function runDurableBroadcastContextPipeline(
  options: DurableBroadcastContextPipelineInput,
): Promise<DurableBroadcastContextPipelineResult> {
  const request = options.request ?? requestBroadcastContextDeepseek;
  const fingerprint = options.fingerprint ?? createContentFingerprint;
  const canonicalOverview = createBroadcastContextRequest(options.contextInput);
  const participantPreContext =
    await restoreBroadcastParticipantPreContextCheckpoint(
      options.initialSession,
    );
  if (
    participantPreContext === null ||
    JSON.stringify(canonicalOverview.participantGrounding) !==
      JSON.stringify(participantPreContext.grounding)
  ) {
    throw new Error(
      "The durable participant pre-context plan, receipts, and grounding must be replayed before context analysis.",
    );
  }
  const overviewInput: BroadcastContextRequestInput = {
    sourceDurationMs: canonicalOverview.sourceDurationMs,
    chapters: canonicalOverview.chapters,
    candidates: canonicalOverview.candidates,
    castRosterId: canonicalOverview.castRosterId,
    participantGrounding: canonicalOverview.participantGrounding,
    outputLanguage: canonicalOverview.outputLanguage,
  };
  const discoverySlices = createParallelBroadcastTopicalDiscoverySlices(
    canonicalOverview.chapters,
  );
  const discoveryRequestByUnitId = new Map<string, DiscoveryUnitRequest>([
    [
      "overview",
      {
        input: overviewInput,
        analysisMode: "overview",
      },
    ],
  ]);
  discoverySlices.forEach((slice, index) => {
    const projectedGrounding = rebaseBroadcastParticipantGrounding(
      canonicalOverview.participantGrounding,
      {
        sourceDurationMs: canonicalOverview.sourceDurationMs,
        castRosterId: canonicalOverview.castRosterId,
        chapters: canonicalOverview.chapters,
      },
      {
        sourceDurationMs: canonicalOverview.sourceDurationMs,
        castRosterId: canonicalOverview.castRosterId,
        chapters: slice.chapters,
      },
    );
    if (projectedGrounding === null) {
      throw new Error(
        `전체 방송의 등장인물 근거를 주제 탐색 조각 ${index + 1}에 연결하지 못했어요.`,
      );
    }
    discoveryRequestByUnitId.set(`slice-${index}`, {
      input: {
        sourceDurationMs: canonicalOverview.sourceDurationMs,
        chapters: slice.chapters,
        candidates: [],
        castRosterId: canonicalOverview.castRosterId,
        participantGrounding: projectedGrounding,
        outputLanguage: canonicalOverview.outputLanguage,
      },
      analysisMode: "discovery",
    });
  });

  const requestInputDigest = async (
    analysisMode: BroadcastContextAnalysisMode,
    input: BroadcastContextRequestInput,
  ): Promise<string> =>
    fingerprint([
      BROADCAST_CONTEXT_UNIT_INPUT_FINGERPRINT_DOMAIN,
      analysisMode,
      JSON.stringify(createBroadcastContextRequest(input)),
    ]);

  const plannedDiscoveryUnits = await Promise.all(
    [...discoveryRequestByUnitId.entries()].map(
      async ([unitId, unitRequest], index) => ({
        phase: "discovery" as const,
        unitId,
        inputDigest: await requestInputDigest(
          unitRequest.analysisMode,
          unitRequest.input,
        ),
        operationId:
          `context-discovery-${index}-g${options.operationGeneration}`,
        attemptOrdinal: 0,
        required: true,
      }),
    ),
  );
  throwIfAborted(options.signal);

  let activeSession = options.initialSession;
  let activeLedger: BroadcastContextPhaseLedger;
  if (activeSession.contextPhaseLedgerJson === null) {
    activeLedger = createBroadcastContextPhaseLedger({
      fence: options.fence,
      units: plannedDiscoveryUnits,
    });
  } else {
    const restored = parseBroadcastContextPhaseLedgerJson(
      activeSession.contextPhaseLedgerJson,
    );
    if (restored === null) {
      throw new Error(
        "저장된 방송 맥락 작업 원장이 손상되어 자동으로 다시 결제하지 않았어요.",
      );
    }
    activeLedger = restored;
  }

  const persistLedger = async (
    nextLedger: BroadcastContextPhaseLedger,
    transition?: BroadcastContextPhasePersistedTransition,
  ): Promise<void> => {
    if (!broadcastContextPhaseLedgerMatchesFence(nextLedger, options.fence)) {
      throw new Error("현재 입력과 다른 방송 맥락 원장은 저장하지 않았어요.");
    }
    const nextLedgerJson = serializeBroadcastContextPhaseLedger(nextLedger);
    const expectedSessionJson = JSON.stringify(activeSession);
    const recordedAt = new Date().toISOString();
    const operationToken =
      `broadcast-context-ledger:${options.contextInputSignature}:` +
      `g${options.operationGeneration}`;
    const terminalSettlement = isTerminalLedgerTransition(transition);
    let persistenceWaveIndex = 0;

    while (true) {
      /*
       * A provider terminal may arrive just after the editor cancels. Give that
       * exact attempted ledger one bounded settlement wave without the outer
       * AbortSignal; otherwise a paid success becomes an unrecorded retry.
       * Every later wave, and every non-terminal checkpoint, respects abort.
       */
      if (!terminalSettlement || persistenceWaveIndex > 0) {
        throwIfAborted(options.signal);
      }
      const settlementSignal =
        terminalSettlement && persistenceWaveIndex === 0
          ? new AbortController().signal
          : options.signal;
      const persisted = await transformDurableBroadcastContextSession({
        store: options.store,
        identity: {
          runId: options.runId,
          operationToken,
          inputSignature: options.initialSession.inputSignature,
        },
        expected: activeSession,
        isCurrent: (identity) =>
          identity.runId === options.runId &&
          identity.operationToken === operationToken &&
          identity.inputSignature === options.initialSession.inputSignature,
        signal: settlementSignal,
        transform: (current) => {
          if (
            current.contextInputSignature === options.contextInputSignature &&
            current.contextInputCheckpointJson ===
              options.contextInputCheckpointJson &&
            current.contextPhaseLedgerJson === nextLedgerJson
          ) {
            return current;
          }
          /*
           * `transformDurableBroadcastContextSession` may re-open a newer
           * snapshot after CAS conflict. Only the exact session this transition
           * started from may receive `nextLedger`; a newer ledger is never
           * projected backwards.
           */
          if (JSON.stringify(current) !== expectedSessionJson) {
            throw new Error(
              "A newer broadcast context ledger already owns this session.",
            );
          }
          return checkpointBroadcastContextSessionPhaseLedger(current, {
            contextInputSignature: options.contextInputSignature,
            contextInputCheckpointJson: options.contextInputCheckpointJson,
            contextPhaseLedgerJson: nextLedgerJson,
            recordedAt,
          });
        },
      });

      if (persisted.status === "succeeded") {
        const reopened = persisted.value;
        const reopenedLedger =
          reopened.contextPhaseLedgerJson === null
            ? null
            : parseBroadcastContextPhaseLedgerJson(
                reopened.contextPhaseLedgerJson,
              );
        if (
          reopened.contextInputSignature !== options.contextInputSignature ||
          reopened.contextInputCheckpointJson !==
            options.contextInputCheckpointJson ||
          reopened.contextPhaseLedgerJson !== nextLedgerJson ||
          reopenedLedger === null ||
          !broadcastContextPhaseLedgerMatchesFence(
            reopenedLedger,
            options.fence,
          )
        ) {
          throw new Error(
            "방송 맥락 원장의 저장 결과를 정확히 다시 확인하지 못했어요.",
          );
        }
        activeSession = reopened;
        activeLedger = reopenedLedger;
        return;
      }
      if (terminalSettlement && options.signal.aborted) {
        throwIfAborted(options.signal);
      }
      if (persisted.status !== "retry-exhausted") {
        throw new Error(
          persisted.status === "stale"
            ? "다른 탭에서 방송 맥락 원장이 갱신되어 오래된 결과를 중단했어요."
            : persisted.status === "aborted"
              ? "방송 맥락 원장 저장이 취소되었어요."
              : "방송 맥락 원장을 현재 저장소에 확정할 수 없어요.",
        );
      }

      throwIfAborted(options.signal);
      await waitForLedgerPersistenceRetry(
        ledgerPersistenceWaveBackoffMs(persistenceWaveIndex),
        options.signal,
      );
      persistenceWaveIndex += 1;
    }
  };

  if (activeSession.contextPhaseLedgerJson === null) {
    await persistLedger(activeLedger);
  }
  if (
    !broadcastContextPhaseLedgerMatchesFence(activeLedger, options.fence) ||
    !hasExactDiscoveryPlan(activeLedger, plannedDiscoveryUnits) ||
    activeLedger.units.some(({ phase }) => phase === "refinement")
  ) {
    throw new Error(
      "저장된 방송 맥락 작업이 현재 대사·등장인물·요청 입력과 일치하지 않아 자동으로 다시 결제하지 않았어요.",
    );
  }

  const discoveryResultForLedger = (
    ledger: BroadcastContextPhaseLedger,
  ): BroadcastContextResult => {
    const overviewRequest = discoveryRequestByUnitId.get("overview")!;
    const overviewResult = parseBroadcastContextProxyResult(
      successfulUnitResult(ledger, "discovery", "overview"),
      overviewRequest.input,
    );
    if (overviewResult === null) {
      throw new Error(
        "저장된 방송 전체 개요가 현재 입력과 맞지 않아 다시 사용하지 않았어요.",
      );
    }
    const topicalResults = discoverySlices.map((_, index) => {
      const unitId = `slice-${index}`;
      const unitRequest = discoveryRequestByUnitId.get(unitId)!;
      const parsed = parseBroadcastContextProxyResult(
        successfulUnitResult(ledger, "discovery", unitId),
        unitRequest.input,
      );
      if (parsed === null) {
        throw new Error(
          `저장된 주제 탐색 조각 ${index + 1}이 현재 입력과 맞지 않아요.`,
        );
      }
      return parsed;
    });
    return {
      ...overviewResult,
      discoveredLeads: mergeBroadcastTopicalDiscoveryLeads([
        overviewResult.discoveredLeads,
        ...topicalResults.map(({ discoveredLeads }) => discoveredLeads),
      ]),
    };
  };

  const createJuryRuntime = async (
    ledger: BroadcastContextPhaseLedger,
  ): Promise<JuryRuntime> => {
    const result = discoveryResultForLedger(ledger);
    const plan = createBroadcastTopicalLeadJuryPlan(
      canonicalOverview.sourceDurationMs,
      result.broadcastSummaryKo,
      result.semanticChapters,
      result.discoveredLeads,
      canonicalOverview.participantGrounding,
    );
    if (plan.candidates.length === 0) {
      return {
        input: null,
        inputDigest: await fingerprint([
          BROADCAST_CONTEXT_UNIT_INPUT_FINGERPRINT_DOMAIN,
          "selection-abstention",
          options.contextInputSignature,
          JSON.stringify(result.discoveredLeads),
        ]),
        result,
        plan,
      };
    }
    if (plan.chapters.length === 0) {
      throw new Error(
        "판정할 의미 후보는 있지만 연결할 대사 구간이 없어 다음 단계로 넘어가지 않았어요.",
      );
    }
    const projectedGrounding = rebaseBroadcastParticipantGrounding(
      canonicalOverview.participantGrounding,
      {
        sourceDurationMs: canonicalOverview.sourceDurationMs,
        castRosterId: canonicalOverview.castRosterId,
        chapters: canonicalOverview.chapters,
      },
      {
        sourceDurationMs: canonicalOverview.sourceDurationMs,
        castRosterId: canonicalOverview.castRosterId,
        chapters: plan.chapters,
      },
    );
    if (projectedGrounding === null) {
      throw new Error(
        "전체 방송의 등장인물 근거를 후보 판정 구간에 연결하지 못했어요.",
      );
    }
    const input: BroadcastContextRequestInput = {
      sourceDurationMs: canonicalOverview.sourceDurationMs,
      chapters: plan.chapters,
      candidates: plan.candidates,
      castRosterId: canonicalOverview.castRosterId,
      participantGrounding: projectedGrounding,
      outputLanguage: canonicalOverview.outputLanguage,
    };
    return {
      input,
      inputDigest: await requestInputDigest("selection", input),
      result,
      plan,
    };
  };

  let juryRuntime: JuryRuntime | null = null;
  const existingJuryUnits = activeLedger.units.filter(
    ({ phase }) => phase === "jury",
  );
  if (
    existingJuryUnits.length > 1 ||
    (existingJuryUnits[0] !== undefined &&
      existingJuryUnits[0].unitId !== "selection")
  ) {
    throw new Error("저장된 방송 맥락 판정 계획의 형식이 올바르지 않아요.");
  }
  if (existingJuryUnits.length === 1) {
    juryRuntime = await createJuryRuntime(activeLedger);
    if (existingJuryUnits[0]!.inputDigest !== juryRuntime.inputDigest) {
      throw new Error(
        "저장된 방송 맥락 판정 작업이 현재 탐색 결과와 일치하지 않아요.",
      );
    }
  }

  const resultModelReceipt = async (
    analysisMode: BroadcastContextAnalysisMode,
    inputDigest: string,
    result: BroadcastContextPhaseLedgerJsonValue,
    parentContextResult?: BroadcastContextResult,
  ) => ({
    analysisMode,
    resultFingerprint: await fingerprint([
      BROADCAST_CONTEXT_UNIT_RESULT_FINGERPRINT_DOMAIN,
      inputDigest,
      serializeBroadcastContextLedgerJsonValue(result),
    ]),
    ...(parentContextResult === undefined
      ? {}
      : {
          parentContextResultFingerprint: await fingerprint([
            BROADCAST_CONTEXT_FINAL_RESULT_FINGERPRINT_DOMAIN,
            options.contextInputSignature,
            serializeBroadcastContextLedgerJsonValue(parentContextResult),
          ]),
        }),
  });

  const executeUnit = async (
    identity: {
      readonly phase: BroadcastContextPhaseLedgerUnit["phase"];
      readonly unitId: string;
      readonly inputDigest: string;
      readonly operationId: string;
    },
  ) => {
    throwIfAborted(options.signal);
    if (identity.phase === "discovery") {
      const unitRequest = discoveryRequestByUnitId.get(identity.unitId);
      if (unitRequest === undefined) {
        throw new BroadcastContextLocalContractError(
          "The discovery unit is not part of the current context plan.",
        );
      }
      const result = await request(unitRequest.input, {
        signal: options.signal,
        analysisMode: unitRequest.analysisMode,
        quota: {
          participantId: options.quotaParticipantId,
          runId: options.runId,
          operationId: identity.operationId,
        },
      });
      const ledgerResult = asLedgerJsonValue(result);
      return {
        result: ledgerResult,
        modelReceipt: await resultModelReceipt(
          unitRequest.analysisMode,
          identity.inputDigest,
          ledgerResult,
        ),
      };
    }
    if (
      identity.phase !== "jury" ||
      identity.unitId !== "selection" ||
      juryRuntime === null
    ) {
      throw new BroadcastContextLocalContractError(
        "The jury unit is not part of the current context plan.",
      );
    }
    if (identity.inputDigest !== juryRuntime.inputDigest) {
      throw new BroadcastContextLocalContractError(
        "The jury input does not match the durable context unit.",
      );
    }
    if (!isFinalBroadcastContextResult(juryRuntime.result)) {
      throw new BroadcastContextLocalContractError(
        "The jury parent is not a complete whole-broadcast result.",
      );
    }
    if (juryRuntime.input === null) {
      const ledgerResult = {
        kind: "jury-abstained-no-candidates",
        schemaVersion: JURY_ABSTENTION_SCHEMA_VERSION,
      } as const;
      return {
        result: ledgerResult,
        modelReceipt: await resultModelReceipt(
          "selection",
          identity.inputDigest,
          ledgerResult,
          juryRuntime.result,
        ),
      };
    }
    const result = await request(juryRuntime.input, {
      signal: options.signal,
      analysisMode: "selection",
      quota: {
        participantId: options.quotaParticipantId,
        runId: options.runId,
        operationId: identity.operationId,
      },
    });
    const ledgerResult = asLedgerJsonValue(result);
    return {
      result: ledgerResult,
      modelReceipt: await resultModelReceipt(
        "selection",
        identity.inputDigest,
        ledgerResult,
        juryRuntime.result,
      ),
    };
  };
  let activeOperationGeneration = options.operationGeneration;
  const createRetryOperationId = ({
    identity,
    nextAttemptOrdinal,
  }: {
    readonly identity: {
      readonly phase: BroadcastContextPhaseLedgerUnit["phase"];
      readonly unitId: string;
    };
    readonly nextAttemptOrdinal: number;
  }): string =>
    `context-${identity.phase}-${identity.unitId}` +
    `-auto-g${activeOperationGeneration}` +
    `-a${nextAttemptOrdinal}` +
    `-${options.contextInputSignature.slice(-16)}`;
  const reconcileUnit = async (
    identity: BroadcastContextPhaseLedgerUnitIdentity,
  ): Promise<BroadcastContextPhaseReconciliationResult> => {
    const replaySameOperation = async (): Promise<BroadcastContextPhaseExecutionResult> =>
      executeUnit(identity);
    if (options.reconcileOperation !== undefined) {
      return options.reconcileOperation(identity, replaySameOperation);
    }
    try {
      const replayed = await replaySameOperation();
      if (!Object.hasOwn(replayed, "result")) {
        return {
          disposition: "unresolved",
          operationId: identity.operationId,
          inputDigest: identity.inputDigest,
          reasonCode: "same_operation_replay_returned_no_terminal_result",
        };
      }
      return {
        disposition: "succeeded",
        operationId: identity.operationId,
        inputDigest: identity.inputDigest,
        result: replayed.result!,
        ...(replayed.modelReceipt === undefined
          ? {}
          : { modelReceipt: replayed.modelReceipt }),
      };
    } catch {
      return {
        disposition: "unresolved",
        operationId: identity.operationId,
        inputDigest: identity.inputDigest,
        reasonCode: "same_operation_replay_outcome_unresolved",
      };
    }
  };
  const runLedger = (): Promise<BroadcastContextPhaseRunnerResult> =>
    runBroadcastContextPhaseLedger({
      ledger: activeLedger,
      maximumExecutionsPerInvocation:
        MAXIMUM_CONTEXT_EXECUTIONS_PER_INVOCATION,
      maximumConcurrency: MAXIMUM_DISCOVERY_CONCURRENCY,
      reconcile: reconcileUnit,
      execute: executeUnit,
      classifyFailure: classifyContextFailure,
      createRetryOperationId,
      persist: persistLedger,
    });

  const runLedgerWithCurrentOperationRecovery =
    async (): Promise<BroadcastContextPhaseRunnerResult> => {
      const waitForAutomaticRetry =
        options.waitForAutomaticRetry ?? waitForLedgerPersistenceRetry;
      while (true) {
        const ambiguousOperationIdsBeforeRun = new Set(
          activeLedger.units
            .filter(
              ({ status }) =>
                status === "in-flight" ||
                status === "outcome-unknown" ||
                status === "reconciling",
            )
            .map(({ operationId }) => operationId),
        );
        const outcome = await runLedger();
        if (
          outcome.complete ||
          options.retryMode !== "automatic-free-tier" ||
          outcome.blockingUnits.some(({ status }) => status === "failed")
        ) {
          return outcome;
        }
        if (
          outcome.blockingUnits.some(
            ({ status }) =>
              status !== "retryable-gap" &&
              status !== "outcome-unknown" &&
              status !== "in-flight" &&
              status !== "reconciling" &&
              status !== "pending",
          )
        ) {
          return outcome;
        }

        /*
         * Every provider wave above is bounded. Its terminal gap/ambiguity is
         * already durably persisted and read back before this delay begins.
         * This prevents a tight retry loop and makes refresh recovery resume
         * from the exact same ledger.
         */
        await waitForAutomaticRetry(
          automaticContextRetryBackoffMs(activeLedger),
          options.signal,
        );
        throwIfAborted(options.signal);
        if (activeOperationGeneration === Number.MAX_SAFE_INTEGER) {
          throw new BroadcastContextLocalContractError(
            "The automatic context retry generation overflowed.",
          );
        }
        activeOperationGeneration += 1;

        /*
         * `runLedger` reconciles in-flight/outcome-unknown operations before
         * returning. If ambiguity remains here, the old operation is durably
         * terminal and a free-tier replacement may receive a fresh identity.
         * Retryable gaps are left for the runner, which persists
         * UNIT_RETRY_PLANNED before its next provider request.
         */
        if (
          activeLedger.units.some(
            ({ status }) =>
              status === "in-flight" || status === "reconciling",
          )
        ) {
          continue;
        }
        const ambiguousUnits = activeLedger.units.filter(
          ({ status }) => status === "outcome-unknown",
        );
        if (
          ambiguousUnits.length > 0 &&
          ambiguousUnits.every(({ operationId }) =>
            ambiguousOperationIdsBeforeRun.has(operationId),
          )
        ) {
          const nextAttemptOrdinal = Math.max(
            ...ambiguousUnits.map(({ attemptOrdinal }) => attemptOrdinal + 1),
          );
          const confirmationId =
            `automatic-free-tier-context-retry:` +
            `g${activeOperationGeneration}:a${nextAttemptOrdinal}:` +
            options.contextInputSignature.slice(-24);
          const replanned =
            replanBroadcastContextPhaseLedgerAfterEditorRetry(activeLedger, {
              confirmationId,
              nextOperationId: (unit) =>
                `context-${unit.phase}-${unit.unitId}` +
                `-free-g${activeOperationGeneration}` +
                `-a${unit.attemptOrdinal + 1}` +
                `-${options.contextInputSignature.slice(-16)}`,
            });
          await persistLedger(replanned);
        }
      }
    };

  const discoveryRun = await runLedgerWithCurrentOperationRecovery();
  assertRunnerComplete(discoveryRun);
  throwIfAborted(options.signal);
  juryRuntime = await createJuryRuntime(activeLedger);

  const storedJuryUnit = activeLedger.units.find(
    ({ phase, unitId }) => phase === "jury" && unitId === "selection",
  );
  if (storedJuryUnit === undefined) {
    const extended = extendBroadcastContextPhaseLedgerPlan(activeLedger, [
      {
        phase: "jury",
        unitId: "selection",
        inputDigest: juryRuntime.inputDigest,
        operationId: `context-selection-g${options.operationGeneration}`,
        attemptOrdinal: 0,
        required: true,
      },
    ]);
    await persistLedger(extended);
  } else if (storedJuryUnit.inputDigest !== juryRuntime.inputDigest) {
    throw new Error(
      "저장된 방송 맥락 판정 입력과 현재 탐색 결과가 일치하지 않아요.",
    );
  }

  const juryRun = await runLedgerWithCurrentOperationRecovery();
  assertRunnerComplete(juryRun);
  throwIfAborted(options.signal);
  if (
    !broadcastContextPhaseLedgerCanComplete(activeLedger) ||
    activeLedger.units.some(
      (unit) => unit.required && unit.status !== "succeeded",
    )
  ) {
    throw new Error(
      "방송 맥락의 필수 작업이 모두 저장되기 전에는 후보 단계로 넘어가지 않아요.",
    );
  }

  const juryPayload = successfulUnitResult(activeLedger, "jury", "selection");
  let refinementLeadIds: readonly string[];
  let fastRefinementLeadIds: readonly string[];
  if (juryRuntime.input === null) {
    if (!juryAbstentionIsValid(juryPayload)) {
      throw new Error("후보 없음 판정의 저장 영수증이 올바르지 않아요.");
    }
    refinementLeadIds = [];
    fastRefinementLeadIds = [];
  } else {
    const juryResult = parseBroadcastContextProxyResult(
      juryPayload,
      juryRuntime.input,
    );
    if (juryResult === null) {
      throw new Error(
        "저장된 방송 맥락 판정 결과가 현재 입력과 맞지 않아요.",
      );
    }
    refinementLeadIds = selectBroadcastTopicalRefinementLeadIds(
      juryRuntime.result.discoveredLeads,
      juryRuntime.plan,
      juryResult.annotations,
      juryRuntime.result.semanticChapters,
    );
    const refinementLeadIdSet = new Set(refinementLeadIds);
    fastRefinementLeadIds = selectBroadcastTopicalJuryApprovedLeadIds(
      juryRuntime.result.discoveredLeads,
      juryRuntime.plan,
      juryResult.annotations,
    ).filter((leadId) => refinementLeadIdSet.has(leadId));
  }

  return {
    result: juryRuntime.result,
    refinementLeadIds,
    fastRefinementLeadIds,
    ledger: activeLedger,
    session: activeSession,
  };
}
