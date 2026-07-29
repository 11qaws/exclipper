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
  serializeBroadcastContextPhaseLedger,
  type BroadcastContextPhaseLedger,
  type BroadcastContextPhaseLedgerFence,
  type BroadcastContextPhaseLedgerJsonValue,
  type BroadcastContextPhaseLedgerPlannedUnit,
  type BroadcastContextPhaseLedgerUnit,
} from "../analysis/broadcastContextPhaseLedger";
import {
  runBroadcastContextPhaseLedger,
  type BroadcastContextPhaseRunnerResult,
} from "../analysis/broadcastContextPhaseRunner";
import { rebaseBroadcastParticipantGrounding } from "../analysis/broadcastParticipantGrounding";
import {
  createBroadcastContextRequest,
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
import {
  checkpointBroadcastContextSessionPhaseLedgerIfUnchanged,
  type AnalysisResultStore,
} from "../storage/analysisResultStore";
import type { BroadcastContextSessionRecord } from "../storage/broadcastContextSessionStore";

const CONTEXT_UNIT_INPUT_DOMAIN =
  "exclipper.broadcast-context-unit-input.v1";
const JURY_ABSTENTION_SCHEMA_VERSION = "1.0.0";
const MAXIMUM_CONTEXT_ATTEMPTS = 8;
const MAXIMUM_CONTEXT_EXECUTIONS_PER_INVOCATION = 3;
const MAXIMUM_DISCOVERY_CONCURRENCY = 4;

type ContextPipelineStore = Pick<
  AnalysisResultStore,
  "getBroadcastContextSession" | "replaceBroadcastContextSessionIfUnchanged"
>;

type ContextRequest = typeof requestBroadcastContextDeepseek;
type ContextFingerprint = typeof createContentFingerprint;

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
  readonly signal: AbortSignal;
  readonly request?: ContextRequest;
  readonly fingerprint?: ContextFingerprint;
}

export interface DurableBroadcastContextPipelineResult {
  readonly result: BroadcastContextResult;
  readonly refinementLeadIds: readonly string[];
  readonly fastRefinementLeadIds: readonly string[];
  readonly ledger: BroadcastContextPhaseLedger;
  readonly session: BroadcastContextSessionRecord;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Broadcast context analysis was aborted.", "AbortError");
  }
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
  throw new Error(
    ambiguousCount > 0
      ? `방송 맥락 요청 ${ambiguousCount}개의 처리 결과를 확인할 수 없어 자동 재결제를 멈췄어요. 다시 시도를 누르면 완료된 조각은 보존하고 해당 조각만 복구합니다.`
      : `방송 맥락 요청 ${outcome.blockingUnits.length}개가 제한 횟수 안에 끝나지 않았어요. 완료된 조각은 저장되어 있습니다.`,
  );
}

function classifyContextFailure(error: unknown) {
  const disposition = broadcastContextFailureDisposition(error);
  return disposition === "retryable"
    ? {
        disposition: "retryable-gap" as const,
        reasonCode: "provider_explicitly_retryable",
      }
    : {
        disposition: "outcome-unknown" as const,
        reasonCode:
          disposition === "aborted"
            ? "client_aborted_after_possible_dispatch"
            : disposition === "fatal"
              ? "provider_rejected_requires_editor_retry"
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
  const overviewInput: BroadcastContextRequestInput = {
    sourceDurationMs: canonicalOverview.sourceDurationMs,
    chapters: canonicalOverview.chapters,
    candidates: canonicalOverview.candidates,
    participantGrounding: canonicalOverview.participantGrounding,
    outputLanguage: canonicalOverview.outputLanguage,
    ...(canonicalOverview.castRosterId === null
      ? {}
      : { castRosterId: canonicalOverview.castRosterId }),
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
        participantGrounding: projectedGrounding,
        outputLanguage: canonicalOverview.outputLanguage,
        ...(canonicalOverview.castRosterId === null
          ? {}
          : { castRosterId: canonicalOverview.castRosterId }),
      },
      analysisMode: "discovery",
    });
  });

  const requestInputDigest = async (
    analysisMode: BroadcastContextAnalysisMode,
    input: BroadcastContextRequestInput,
  ): Promise<string> =>
    fingerprint([
      CONTEXT_UNIT_INPUT_DOMAIN,
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
    const initialLedgerJson =
      serializeBroadcastContextPhaseLedger(activeLedger);
    const initialized =
      await checkpointBroadcastContextSessionPhaseLedgerIfUnchanged(
        options.store,
        activeSession,
        {
          contextInputSignature: options.contextInputSignature,
          contextInputCheckpointJson: options.contextInputCheckpointJson,
          contextPhaseLedgerJson: initialLedgerJson,
          recordedAt: new Date().toISOString(),
        },
      );
    if (!initialized) {
      throw new Error(
        "다른 탭에서 방송 맥락 상태가 먼저 갱신되어 이 실행을 중단했어요.",
      );
    }
    const reopened = await options.store.getBroadcastContextSession(
      options.runId,
    );
    if (
      reopened === null ||
      reopened.contextInputSignature !== options.contextInputSignature ||
      reopened.contextInputCheckpointJson !==
        options.contextInputCheckpointJson ||
      reopened.contextPhaseLedgerJson !== initialLedgerJson
    ) {
      throw new Error(
        "방송 맥락 작업 원장을 저장한 뒤 정확히 다시 읽지 못했어요.",
      );
    }
    activeSession = reopened;
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
  if (
    !broadcastContextPhaseLedgerMatchesFence(activeLedger, options.fence) ||
    !hasExactDiscoveryPlan(activeLedger, plannedDiscoveryUnits) ||
    activeLedger.units.some(({ phase }) => phase === "refinement")
  ) {
    throw new Error(
      "저장된 방송 맥락 작업이 현재 대사·등장인물·요청 입력과 일치하지 않아 자동으로 다시 결제하지 않았어요.",
    );
  }

  const persistLedger = async (
    nextLedger: BroadcastContextPhaseLedger,
  ): Promise<void> => {
    // Never let a late AbortSignal suppress the terminal checkpoint. The
    // provider may already have received the paid request; persisting its
    // success or ambiguous outcome is safer than making the next run guess.
    if (!broadcastContextPhaseLedgerMatchesFence(nextLedger, options.fence)) {
      throw new Error("현재 입력과 다른 방송 맥락 원장은 저장하지 않았어요.");
    }
    const nextLedgerJson = serializeBroadcastContextPhaseLedger(nextLedger);
    const checkpointed =
      await checkpointBroadcastContextSessionPhaseLedgerIfUnchanged(
        options.store,
        activeSession,
        {
          contextInputSignature: options.contextInputSignature,
          contextInputCheckpointJson: options.contextInputCheckpointJson,
          contextPhaseLedgerJson: nextLedgerJson,
          recordedAt: new Date().toISOString(),
        },
      );
    if (!checkpointed) {
      throw new Error(
        "다른 탭에서 방송 맥락 원장이 갱신되어 오래된 결과를 중단했어요.",
      );
    }
    const reopened = await options.store.getBroadcastContextSession(
      options.runId,
    );
    const reopenedLedger =
      reopened?.contextPhaseLedgerJson === null ||
      reopened?.contextPhaseLedgerJson === undefined
        ? null
        : parseBroadcastContextPhaseLedgerJson(
            reopened.contextPhaseLedgerJson,
          );
    if (
      reopened === null ||
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
  };

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
    );
    if (plan.candidates.length === 0) {
      return {
        input: null,
        inputDigest: await fingerprint([
          CONTEXT_UNIT_INPUT_DOMAIN,
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
      participantGrounding: projectedGrounding,
      outputLanguage: canonicalOverview.outputLanguage,
      ...(canonicalOverview.castRosterId === null
        ? {}
        : { castRosterId: canonicalOverview.castRosterId }),
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
        throw new Error("계획에 없는 방송 맥락 탐색 작업이에요.");
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
      return { result: asLedgerJsonValue(result) };
    }
    if (
      identity.phase !== "jury" ||
      identity.unitId !== "selection" ||
      juryRuntime === null
    ) {
      throw new Error("확정되지 않은 방송 맥락 판정 작업은 실행하지 않아요.");
    }
    if (identity.inputDigest !== juryRuntime.inputDigest) {
      throw new Error(
        "방송 맥락 판정 입력이 저장된 작업 원장과 일치하지 않아요.",
      );
    }
    if (juryRuntime.input === null) {
      return {
        result: {
          kind: "jury-abstained-no-candidates",
          schemaVersion: JURY_ABSTENTION_SCHEMA_VERSION,
        },
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
    return { result: asLedgerJsonValue(result) };
  };
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
    `-auto-${nextAttemptOrdinal}` +
    `-${options.contextInputSignature.slice(-16)}`;
  const runLedger = (): Promise<BroadcastContextPhaseRunnerResult> =>
    runBroadcastContextPhaseLedger({
      ledger: activeLedger,
      maximumAttemptCount: MAXIMUM_CONTEXT_ATTEMPTS,
      maximumExecutionsPerInvocation:
        MAXIMUM_CONTEXT_EXECUTIONS_PER_INVOCATION,
      maximumConcurrency: MAXIMUM_DISCOVERY_CONCURRENCY,
      execute: executeUnit,
      classifyFailure: classifyContextFailure,
      createRetryOperationId,
      persist: persistLedger,
    });

  const discoveryRun = await runLedger();
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

  const juryRun = await runLedger();
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
