import { describe, expect, it, vi } from "vitest";

import {
  BROADCAST_CONTEXT_RECONCILIATION_UNRESOLVED_REASON,
  BroadcastContextPhaseRunnerError,
  runBroadcastContextPhaseLedger,
} from "./broadcastContextPhaseRunner";
import type {
  BroadcastContextPhasePersistedTransition,
  RunBroadcastContextPhaseLedgerOptions,
} from "./broadcastContextPhaseRunner";
import {
  createBroadcastContextPhaseLedger,
  reduceBroadcastContextPhaseLedger,
} from "./broadcastContextPhaseLedger";
import type {
  BroadcastContextPhaseLedger,
  BroadcastContextPhaseLedgerEvent,
  BroadcastContextPhaseLedgerFence,
  BroadcastContextPhaseLedgerPhase,
  BroadcastContextPhaseLedgerTransitionOutcome,
  BroadcastContextPhaseLedgerUnitIdentity,
} from "./broadcastContextPhaseLedger";

const fence: BroadcastContextPhaseLedgerFence = {
  parentContextSignature: "context-runner-v1",
  transcriptSignature: "transcript-runner-v1",
  groundingSignature: "grounding-runner-v1",
};

function createLedger(
  attemptOrdinal = 0,
  required = true,
): BroadcastContextPhaseLedger {
  return createBroadcastContextPhaseLedger({
    fence,
    units: [
      {
        phase: "discovery",
        unitId: "chapter-a",
        inputDigest: "digest-a",
        operationId: `operation-a-${attemptOrdinal}`,
        attemptOrdinal,
        required,
      },
    ],
  });
}

function createMultiPhaseLedger(): BroadcastContextPhaseLedger {
  return createBroadcastContextPhaseLedger({
    fence,
    units: [
      {
        phase: "discovery",
        unitId: "discovery-a",
        inputDigest: "digest-discovery-a",
        operationId: "operation-discovery-a",
        attemptOrdinal: 0,
        required: true,
      },
      {
        phase: "discovery",
        unitId: "discovery-b",
        inputDigest: "digest-discovery-b",
        operationId: "operation-discovery-b",
        attemptOrdinal: 0,
        required: true,
      },
      {
        phase: "discovery",
        unitId: "discovery-c",
        inputDigest: "digest-discovery-c",
        operationId: "operation-discovery-c",
        attemptOrdinal: 0,
        required: true,
      },
      {
        phase: "jury",
        unitId: "jury-a",
        inputDigest: "digest-jury-a",
        operationId: "operation-jury-a",
        attemptOrdinal: 0,
        required: true,
      },
      {
        phase: "refinement",
        unitId: "refinement-a",
        inputDigest: "digest-refinement-a",
        operationId: "operation-refinement-a",
        attemptOrdinal: 0,
        required: true,
      },
    ],
  });
}

function identity(
  ledger: BroadcastContextPhaseLedger,
  phase: BroadcastContextPhaseLedgerPhase = "discovery",
  unitId = "chapter-a",
): BroadcastContextPhaseLedgerUnitIdentity {
  const unit = ledger.units.find(
    (candidate) =>
      candidate.phase === phase && candidate.unitId === unitId,
  );
  if (unit === undefined) throw new Error(`Missing ${phase}/${unitId}.`);
  return {
    fence: ledger.fence,
    phase: unit.phase,
    unitId: unit.unitId,
    inputDigest: unit.inputDigest,
    operationId: unit.operationId,
    attemptOrdinal: unit.attemptOrdinal,
  };
}

function accepted(
  outcome: BroadcastContextPhaseLedgerTransitionOutcome,
): BroadcastContextPhaseLedger {
  if (!outcome.accepted) {
    throw new Error(`Fixture transition rejected: ${outcome.reason}.`);
  }
  return outcome.ledger;
}

function transition(
  ledger: BroadcastContextPhaseLedger,
  event: BroadcastContextPhaseLedgerEvent,
): BroadcastContextPhaseLedger {
  return accepted(reduceBroadcastContextPhaseLedger(ledger, event));
}

function inFlightLedger(): BroadcastContextPhaseLedger {
  const ledger = createLedger();
  return transition(ledger, {
    type: "UNIT_STARTED",
    ...identity(ledger),
  });
}

function succeededLedger(): BroadcastContextPhaseLedger {
  let ledger = inFlightLedger();
  ledger = transition(ledger, {
    type: "UNIT_SUCCEEDED",
    ...identity(ledger),
    result: { summary: "already durable" },
    modelReceipt: { requestId: "receipt-existing" },
  });
  return ledger;
}

function retryableLedger(): BroadcastContextPhaseLedger {
  let ledger = inFlightLedger();
  ledger = transition(ledger, {
    type: "UNIT_RETRYABLE_GAP",
    ...identity(ledger),
    reasonCode: "safe_pre_dispatch_failure",
  });
  return ledger;
}

function outcomeUnknownLedger(): BroadcastContextPhaseLedger {
  let ledger = inFlightLedger();
  ledger = transition(ledger, {
    type: "UNIT_OUTCOME_UNKNOWN",
    ...identity(ledger),
    reasonCode: "transport_lost_after_dispatch",
  });
  return ledger;
}

function defaultOptions(
  ledger: BroadcastContextPhaseLedger,
): RunBroadcastContextPhaseLedgerOptions {
  return {
    ledger,
    reconcile: (current) =>
      Promise.resolve({
        disposition: "unresolved",
        operationId: current.operationId,
        inputDigest: current.inputDigest,
        reasonCode: BROADCAST_CONTEXT_RECONCILIATION_UNRESOLVED_REASON,
      }),
    execute: () =>
      Promise.resolve({
        result: { summary: "new result" },
        modelReceipt: { requestId: "new-receipt" },
      }),
    classifyFailure: () => ({
      disposition: "outcome-unknown",
      reasonCode: "unclassified_provider_failure",
    }),
    createRetryOperationId: ({ identity: current, nextAttemptOrdinal }) =>
      `${current.phase}-${current.unitId}-retry-${nextAttemptOrdinal}`,
    persist: () => Promise.resolve(),
  };
}

async function captureRunnerError(
  promise: Promise<unknown>,
): Promise<BroadcastContextPhaseRunnerError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BroadcastContextPhaseRunnerError);
    if (error instanceof BroadcastContextPhaseRunnerError) return error;
    throw error;
  }
  throw new Error("Expected the context phase runner to reject.");
}

describe("runBroadcastContextPhaseLedger", () => {
  it("resumes a durable success without calling or persisting again", async () => {
    const ledger = succeededLedger();
    const execute = vi.fn(defaultOptions(ledger).execute);
    const persist = vi.fn(defaultOptions(ledger).persist);

    const result = await runBroadcastContextPhaseLedger({
      ...defaultOptions(ledger),
      execute,
      persist,
    });

    expect(result.status).toBe("completed");
    expect(result.complete).toBe(true);
    expect(result.ledger).toEqual(ledger);
    expect(result.statistics.resumedSucceededCount).toBe(1);
    expect(result.statistics.providerExecutionCount).toBe(0);
    expect(execute).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("reconciles every recovered in-flight operation before any new provider call", async () => {
    const ledger = inFlightLedger();
    const execute = vi.fn(defaultOptions(ledger).execute);
    const reconcile = vi.fn(defaultOptions(ledger).reconcile);
    const transitions: BroadcastContextPhasePersistedTransition[] = [];

    const result = await runBroadcastContextPhaseLedger({
      ...defaultOptions(ledger),
      reconcile,
      execute,
      persist: (_nextLedger, metadata) => {
        transitions.push(metadata);
        return Promise.resolve();
      },
    });

    expect(result.status).toBe("blocked-outcome-unknown");
    expect(result.complete).toBe(false);
    expect(result.ledger.units[0]).toMatchObject({
      status: "outcome-unknown",
      reasonCode: BROADCAST_CONTEXT_RECONCILIATION_UNRESOLVED_REASON,
    });
    expect(result.statistics.recoveredInFlightCount).toBe(1);
    expect(result.statistics.reconciliationExecutionCount).toBe(1);
    expect(reconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: "operation-a-0",
        inputDigest: "digest-a",
      }),
    );
    expect(execute).not.toHaveBeenCalled();
    expect(transitions).toEqual([
      expect.objectContaining({
        cause: "reconciliation-started",
        eventType: "UNIT_RECONCILIATION_STARTED",
        previousStatus: "in-flight",
        resultingStatus: "reconciling",
      }),
      expect.objectContaining({
        cause: "reconciliation-unresolved",
        eventType: "UNIT_RECONCILIATION_UNRESOLVED",
        previousStatus: "reconciling",
        resultingStatus: "outcome-unknown",
      }),
    ]);
    expect(result.recoveryActions).toEqual([
      expect.objectContaining({
        kind: "reconcile-current-operation",
        operationId: "operation-a-0",
        inputDigest: "digest-a",
      }),
    ]);
  });

  it("consumes a matching terminal reconciliation result without a new provider execution", async () => {
    const ledger = inFlightLedger();
    const execute = vi.fn(defaultOptions(ledger).execute);
    const reconcile = vi.fn(
      (current: BroadcastContextPhaseLedgerUnitIdentity) =>
        Promise.resolve({
          disposition: "succeeded" as const,
          operationId: current.operationId,
          inputDigest: current.inputDigest,
          result: { summary: "cached terminal result" },
          modelReceipt: { requestId: "cached-receipt" },
        }),
    );

    const result = await runBroadcastContextPhaseLedger({
      ...defaultOptions(ledger),
      reconcile,
      execute,
    });

    expect(result.status).toBe("completed");
    expect(result.ledger.units[0]).toMatchObject({
      status: "succeeded",
      operationId: "operation-a-0",
      result: { summary: "cached terminal result" },
      modelReceipt: { requestId: "cached-receipt" },
    });
    expect(result.statistics.reconciliationSucceededCount).toBe(1);
    expect(result.statistics.providerExecutionCount).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it("turns proven non-dispatch into a retryable gap and executes only its fresh operation", async () => {
    const ledger = outcomeUnknownLedger();
    const execute = vi.fn(defaultOptions(ledger).execute);
    const reconcile = vi.fn(
      (current: BroadcastContextPhaseLedgerUnitIdentity) =>
        Promise.resolve({
          disposition: "not-dispatched" as const,
          operationId: current.operationId,
          inputDigest: current.inputDigest,
          reasonCode: "coordinator_proved_not_dispatched",
        }),
    );

    const result = await runBroadcastContextPhaseLedger({
      ...defaultOptions(ledger),
      reconcile,
      execute,
      createRetryOperationId: ({ nextAttemptOrdinal }) =>
        `operation-a-${nextAttemptOrdinal}`,
    });

    expect(result.status).toBe("completed");
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: "operation-a-1",
        inputDigest: "digest-a",
        attemptOrdinal: 1,
      }),
    );
    expect(result.ledger.usedOperationIds).toEqual(["operation-a-1"]);
    expect(result.statistics.reconciliationNotDispatchedCount).toBe(1);
  });

  it("rejects a mismatched reconciliation receipt and exposes only the current-operation action", async () => {
    const ledger = outcomeUnknownLedger();
    const execute = vi.fn(defaultOptions(ledger).execute);

    const result = await runBroadcastContextPhaseLedger({
      ...defaultOptions(ledger),
      reconcile: (current) =>
        Promise.resolve({
          disposition: "succeeded",
          operationId: current.operationId,
          inputDigest: "different-input-digest",
          result: { summary: "must not be consumed" },
        }),
      execute,
    });

    expect(result.status).toBe("blocked-outcome-unknown");
    expect(result.ledger.units[0]).toMatchObject({
      status: "outcome-unknown",
      operationId: "operation-a-0",
      inputDigest: "digest-a",
      reasonCode: "runner_invalid_reconciliation_result",
    });
    expect(result.recoveryActions).toEqual([
      {
        kind: "reconcile-current-operation",
        phase: "discovery",
        unitId: "chapter-a",
        inputDigest: "digest-a",
        operationId: "operation-a-0",
        attemptOrdinal: 0,
        maximumReconciliationsPerInvocation: 1,
      },
    ]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("reloads a durably reconciling unit and resumes the same operation after an interrupted settlement", async () => {
    const ledger = inFlightLedger();
    let reconcilingLedger: BroadcastContextPhaseLedger | null = null;

    const interrupted = await captureRunnerError(
      runBroadcastContextPhaseLedger({
        ...defaultOptions(ledger),
        reconcile: () => Promise.reject(new Error("tab closed")),
        persist: (nextLedger, transition) => {
          if (transition.cause === "reconciliation-started") {
            reconcilingLedger = nextLedger;
            return Promise.resolve();
          }
          return Promise.reject(new Error("settlement write interrupted"));
        },
      }),
    );
    expect(interrupted.code).toBe("PERSISTENCE_FAILED");
    if (reconcilingLedger === null) {
      throw new Error("Missing durable reconciling checkpoint.");
    }
    expect(
      (reconcilingLedger as BroadcastContextPhaseLedger).units[0],
    ).toMatchObject({
      status: "reconciling",
      operationId: "operation-a-0",
    });
    const execute = vi.fn(defaultOptions(reconcilingLedger).execute);
    const resumed = await runBroadcastContextPhaseLedger({
      ...defaultOptions(reconcilingLedger),
      reconcile: (current) =>
        Promise.resolve({
          disposition: "succeeded",
          operationId: current.operationId,
          inputDigest: current.inputDigest,
          result: { summary: "recovered after reload" },
        }),
      execute,
    });

    expect(resumed.status).toBe("completed");
    expect(resumed.ledger.units[0]).toMatchObject({
      status: "succeeded",
      operationId: "operation-a-0",
      result: { summary: "recovered after reload" },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("persists start before execution and success before completion", async () => {
    const ledger = createLedger();
    const persistedStatuses: string[] = [];
    const execute = vi.fn(
      (executionIdentity: BroadcastContextPhaseLedgerUnitIdentity) => {
        expect(Object.isFrozen(executionIdentity)).toBe(true);
        expect(executionIdentity).toMatchObject({
          operationId: "operation-a-0",
          attemptOrdinal: 0,
        });
        expect(persistedStatuses).toEqual(["in-flight"]);
        return Promise.resolve({
          result: { scene: "quiet semantic event" },
          modelReceipt: { requestId: "request-a" },
        });
      },
    );

    const result = await runBroadcastContextPhaseLedger({
      ...defaultOptions(ledger),
      execute,
      persist: (nextLedger) => {
        const unit = nextLedger.units[0];
        if (unit === undefined) throw new Error("Missing persisted unit.");
        persistedStatuses.push(unit.status);
        return Promise.resolve();
      },
    });

    expect(result.status).toBe("completed");
    expect(result.ledger.units[0]).toMatchObject({
      status: "succeeded",
      result: { scene: "quiet semantic event" },
      modelReceipt: { requestId: "request-a" },
    });
    expect(persistedStatuses).toEqual(["in-flight", "succeeded"]);
    expect(result.statistics).toMatchObject({
      providerExecutionCount: 1,
      plannedRetryCount: 0,
      persistedTransitionCount: 2,
    });
  });

  it("retries only a classified retryable gap with a fresh operation ID", async () => {
    const ledger = createLedger();
    const providerError = new Error("known safe pre-dispatch failure");
    const execute = vi
      .fn<
        RunBroadcastContextPhaseLedgerOptions["execute"]
      >()
      .mockRejectedValueOnce(providerError)
      .mockResolvedValueOnce({
        result: { summary: "recovered" },
        modelReceipt: { requestId: "retry-receipt" },
      });
    const classifyFailure = vi.fn(() => ({
      disposition: "retryable-gap" as const,
      reasonCode: "rate_limited_before_dispatch",
    }));
    const createRetryOperationId = vi.fn(
      ({ nextAttemptOrdinal }: { readonly nextAttemptOrdinal: number }) =>
        `operation-a-${nextAttemptOrdinal}`,
    );
    const eventTypes: string[] = [];

    const result = await runBroadcastContextPhaseLedger({
      ...defaultOptions(ledger),
      execute,
      classifyFailure,
      createRetryOperationId,
      persist: (_nextLedger, metadata) => {
        eventTypes.push(metadata.eventType);
        return Promise.resolve();
      },
    });

    expect(result.status).toBe("completed");
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.map(([callIdentity]) => callIdentity)).toEqual([
      expect.objectContaining({
        operationId: "operation-a-0",
        attemptOrdinal: 0,
      }),
      expect.objectContaining({
        operationId: "operation-a-1",
        attemptOrdinal: 1,
      }),
    ]);
    expect(classifyFailure).toHaveBeenCalledWith(
      providerError,
      expect.objectContaining({ operationId: "operation-a-0" }),
    );
    expect(createRetryOperationId).toHaveBeenCalledTimes(1);
    expect(eventTypes).toEqual([
      "UNIT_STARTED",
      "UNIT_RETRYABLE_GAP",
      "UNIT_RETRY_PLANNED",
      "UNIT_STARTED",
      "UNIT_SUCCEEDED",
    ]);
    expect(result.ledger.usedOperationIds).not.toContain("operation-a-0");
    expect(result.ledger.usedOperationIds).toContain("operation-a-1");
    expect(result.statistics.plannedRetryCount).toBe(1);
  });

  it("stops at the bounded invocation budget and resumes in a later invocation", async () => {
    const ledger = createLedger();
    const execute = vi.fn(() => Promise.reject(new Error("rate limit")));
    const createRetryOperationId = vi.fn(
      ({ nextAttemptOrdinal }: { readonly nextAttemptOrdinal: number }) =>
        `operation-a-${nextAttemptOrdinal}`,
    );

    const result = await runBroadcastContextPhaseLedger({
      ...defaultOptions(ledger),
      maximumExecutionsPerInvocation: 2,
      execute,
      classifyFailure: () => ({
        disposition: "retryable-gap",
        reasonCode: "safe_rate_limit",
      }),
      createRetryOperationId,
    });

    expect(result.status).toBe("blocked-retryable-gap");
    expect(result.complete).toBe(false);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(createRetryOperationId).toHaveBeenCalledTimes(1);
    expect(result.ledger.units[0]).toMatchObject({
      status: "retryable-gap",
      operationId: "operation-a-1",
      attemptOrdinal: 1,
    });
    expect(result.summary.requiredSucceededCount).toBe(0);
  });

  it("gives an editor-confirmed later attempt a fresh bounded retry wave", async () => {
    const ledger = createLedger(3);
    const execute = vi
      .fn<RunBroadcastContextPhaseLedgerOptions["execute"]>()
      .mockRejectedValueOnce(new Error("retryable one"))
      .mockRejectedValueOnce(new Error("retryable two"))
      .mockResolvedValueOnce({ result: { summary: "recovered" } });

    const result = await runBroadcastContextPhaseLedger({
      ...defaultOptions(ledger),
      maximumExecutionsPerInvocation: 3,
      execute,
      classifyFailure: () => ({
        disposition: "retryable-gap",
        reasonCode: "safe_retry",
      }),
      createRetryOperationId: ({ nextAttemptOrdinal }) =>
        `operation-a-${nextAttemptOrdinal}`,
    });

    expect(result.status).toBe("completed");
    expect(execute.mock.calls.map(([callIdentity]) =>
      callIdentity.attemptOrdinal,
    )).toEqual([3, 4, 5]);
  });

  it("never auto-retries an outcome-unknown unit", async () => {
    const ledger = createLedger();
    const execute = vi.fn(() => Promise.reject(new Error("connection lost")));
    const createRetryOperationId = vi.fn(
      defaultOptions(ledger).createRetryOperationId,
    );

    const result = await runBroadcastContextPhaseLedger({
      ...defaultOptions(ledger),
      execute,
      classifyFailure: () => ({
        disposition: "outcome-unknown",
        reasonCode: "connection_lost_after_dispatch",
      }),
      createRetryOperationId,
    });

    expect(result.status).toBe("blocked-outcome-unknown");
    expect(result.complete).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(createRetryOperationId).not.toHaveBeenCalled();
    expect(result.ledger.units[0]).toMatchObject({
      status: "outcome-unknown",
      operationId: "operation-a-0",
      attemptOrdinal: 0,
    });
  });

  it("persists deterministic failure once and never retries it", async () => {
    const ledger = createLedger();
    const execute = vi.fn(() =>
      Promise.reject(new Error("credential configuration is invalid")),
    );
    const createRetryOperationId = vi.fn(
      defaultOptions(ledger).createRetryOperationId,
    );
    const statuses: string[] = [];

    const result = await runBroadcastContextPhaseLedger({
      ...defaultOptions(ledger),
      execute,
      classifyFailure: () => ({
        disposition: "failed",
        reasonCode: "provider_configuration_or_request_rejected",
      }),
      createRetryOperationId,
      persist: (nextLedger) => {
        statuses.push(nextLedger.units[0]!.status);
        return Promise.resolve();
      },
    });

    expect(result.status).toBe("blocked-failed");
    expect(result.blockingUnits).toEqual([
      expect.objectContaining({
        status: "failed",
        reasonCode: "provider_configuration_or_request_rejected",
      }),
    ]);
    expect(statuses).toEqual(["in-flight", "failed"]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(createRetryOperationId).not.toHaveBeenCalled();

    const resumedExecute = vi.fn(defaultOptions(result.ledger).execute);
    const resumed = await runBroadcastContextPhaseLedger({
      ...defaultOptions(result.ledger),
      execute: resumedExecute,
    });
    expect(resumed.status).toBe("blocked-failed");
    expect(resumedExecute).not.toHaveBeenCalled();
  });

  it("runs an outcome-unknown unit only after the explicit confirmation event", async () => {
    const unknown = outcomeUnknownLedger();
    const untouchedExecute = vi.fn(defaultOptions(unknown).execute);

    const untouched = await runBroadcastContextPhaseLedger({
      ...defaultOptions(unknown),
      execute: untouchedExecute,
    });
    expect(untouched.status).toBe("blocked-outcome-unknown");
    expect(untouchedExecute).not.toHaveBeenCalled();

    const confirmed = transition(unknown, {
      type: "UNIT_OUTCOME_UNKNOWN_RETRY_CONFIRMED",
      ...identity(unknown),
      nextOperationId: "operation-a-confirmed-1",
      confirmationId: "editor-confirmation-1",
    });
    const confirmedExecute = vi.fn(defaultOptions(confirmed).execute);
    const result = await runBroadcastContextPhaseLedger({
      ...defaultOptions(confirmed),
      execute: confirmedExecute,
    });

    expect(result.status).toBe("completed");
    expect(confirmedExecute).toHaveBeenCalledTimes(1);
    expect(confirmedExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: "operation-a-confirmed-1",
        attemptOrdinal: 1,
      }),
    );
  });

  it("resumes an existing retryable gap by persisting a new identity first", async () => {
    const ledger = retryableLedger();
    const order: string[] = [];
    const execute = vi.fn(() => {
      order.push("execute");
      return Promise.resolve({ result: { recovered: true } });
    });

    const result = await runBroadcastContextPhaseLedger({
      ...defaultOptions(ledger),
      execute,
      createRetryOperationId: ({ nextAttemptOrdinal }) =>
        `operation-a-${nextAttemptOrdinal}`,
      persist: (_nextLedger, metadata) => {
        order.push(metadata.eventType);
        return Promise.resolve();
      },
    });

    expect(result.status).toBe("completed");
    expect(order).toEqual([
      "UNIT_RETRY_PLANNED",
      "UNIT_STARTED",
      "execute",
      "UNIT_SUCCEEDED",
    ]);
  });

  it("parallelizes provider execution while serializing every ledger persist", async () => {
    const ledger = createMultiPhaseLedger();
    let activeExecutions = 0;
    let peakExecutions = 0;
    let activePersists = 0;
    let peakPersists = 0;

    const result = await runBroadcastContextPhaseLedger({
      ...defaultOptions(ledger),
      maximumConcurrency: 2,
      execute: async (executionIdentity) => {
        activeExecutions += 1;
        peakExecutions = Math.max(peakExecutions, activeExecutions);
        await new Promise<void>((resolve) => {
          globalThis.setTimeout(resolve, 5);
        });
        activeExecutions -= 1;
        return { result: { unitId: executionIdentity.unitId } };
      },
      persist: async () => {
        activePersists += 1;
        peakPersists = Math.max(peakPersists, activePersists);
        await new Promise<void>((resolve) => {
          globalThis.setTimeout(resolve, 1);
        });
        activePersists -= 1;
      },
    });

    expect(result.status).toBe("completed");
    expect(result.statistics.providerExecutionCount).toBe(5);
    expect(peakExecutions).toBe(2);
    expect(peakPersists).toBe(1);
  });

  it("does not start jury or refinement before the prior phase fully succeeds", async () => {
    const ledger = createMultiPhaseLedger();
    let completedDiscoveryCount = 0;
    let completedJuryCount = 0;

    const result = await runBroadcastContextPhaseLedger({
      ...defaultOptions(ledger),
      maximumConcurrency: 3,
      execute: async (executionIdentity) => {
        if (executionIdentity.phase === "discovery") {
          await Promise.resolve();
          completedDiscoveryCount += 1;
        } else if (executionIdentity.phase === "jury") {
          expect(completedDiscoveryCount).toBe(3);
          completedJuryCount += 1;
        } else {
          expect(completedDiscoveryCount).toBe(3);
          expect(completedJuryCount).toBe(1);
        }
        return { result: { phase: executionIdentity.phase } };
      },
    });

    expect(result.status).toBe("completed");
    expect(completedDiscoveryCount).toBe(3);
    expect(completedJuryCount).toBe(1);
  });

  it("stops the phase pipeline when any discovery unit is unresolved", async () => {
    const ledger = createMultiPhaseLedger();
    const executedUnits: string[] = [];

    const result = await runBroadcastContextPhaseLedger({
      ...defaultOptions(ledger),
      maximumConcurrency: 3,
      execute: (executionIdentity) => {
        executedUnits.push(executionIdentity.unitId);
        return executionIdentity.unitId === "discovery-b"
          ? Promise.reject(new Error("ambiguous discovery response"))
          : Promise.resolve({
              result: { unitId: executionIdentity.unitId },
            });
      },
      classifyFailure: () => ({
        disposition: "outcome-unknown",
        reasonCode: "discovery_response_ambiguous",
      }),
    });

    expect(result.status).toBe("blocked-mixed");
    expect(executedUnits.sort()).toEqual([
      "discovery-a",
      "discovery-b",
      "discovery-c",
    ]);
    expect(
      result.ledger.units.find(({ unitId }) => unitId === "jury-a"),
    ).toMatchObject({ status: "pending" });
    expect(
      result.ledger.units.find(({ unitId }) => unitId === "refinement-a"),
    ).toMatchObject({ status: "pending" });
  });

  it("does not call the provider when persisting the start transition fails", async () => {
    const ledger = createLedger();
    const execute = vi.fn(defaultOptions(ledger).execute);
    const persistenceError = new Error("indexed db unavailable");

    const error = await captureRunnerError(
      runBroadcastContextPhaseLedger({
        ...defaultOptions(ledger),
        execute,
        persist: () => Promise.reject(persistenceError),
      }),
    );

    expect(error.code).toBe("PERSISTENCE_FAILED");
    expect(error.causeValue).toBe(persistenceError);
    expect(error.lastPersistedLedger?.units[0]?.status).toBe("pending");
    expect(error.attemptedLedger?.units[0]?.status).toBe("in-flight");
    expect(execute).not.toHaveBeenCalled();
  });

  it("exposes a lost success persist and recovery seals it without rebilling", async () => {
    const ledger = createLedger();
    const execute = vi.fn(defaultOptions(ledger).execute);
    let persistCall = 0;

    const error = await captureRunnerError(
      runBroadcastContextPhaseLedger({
        ...defaultOptions(ledger),
        execute,
        persist: () => {
          persistCall += 1;
          return persistCall === 2
            ? Promise.reject(new Error("commit failed"))
            : Promise.resolve();
        },
      }),
    );

    expect(error.code).toBe("PERSISTENCE_FAILED");
    expect(error.lastPersistedLedger?.units[0]?.status).toBe("in-flight");
    expect(error.attemptedLedger?.units[0]?.status).toBe("succeeded");
    expect(execute).toHaveBeenCalledTimes(1);

    const recoveredExecute = vi.fn(defaultOptions(ledger).execute);
    const lastPersisted = error.lastPersistedLedger;
    if (lastPersisted === null) throw new Error("Missing recovery ledger.");
    const recovered = await runBroadcastContextPhaseLedger({
      ...defaultOptions(lastPersisted),
      execute: recoveredExecute,
    });

    expect(recovered.status).toBe("blocked-outcome-unknown");
    expect(recoveredExecute).not.toHaveBeenCalled();
  });

  it("seals the operation and throws a typed error when classification fails", async () => {
    const ledger = createLedger();
    const classifierError = new Error("classifier bug");
    const persistedStatuses: string[] = [];

    const error = await captureRunnerError(
      runBroadcastContextPhaseLedger({
        ...defaultOptions(ledger),
        execute: () => Promise.reject(new Error("provider failure")),
        classifyFailure: () => Promise.reject(classifierError),
        persist: (nextLedger) => {
          const unit = nextLedger.units[0];
          if (unit !== undefined) persistedStatuses.push(unit.status);
          return Promise.resolve();
        },
      }),
    );

    expect(error.code).toBe("CLASSIFICATION_FAILED");
    expect(error.causeValue).toBe(classifierError);
    expect(error.lastPersistedLedger?.units[0]).toMatchObject({
      status: "outcome-unknown",
      reasonCode: "runner_failure_classification_failed",
    });
    expect(persistedStatuses).toEqual(["in-flight", "outcome-unknown"]);
  });

  it("rejects a reused retry operation ID before another provider call", async () => {
    const ledger = retryableLedger();
    const execute = vi.fn(defaultOptions(ledger).execute);
    const persist = vi.fn(defaultOptions(ledger).persist);

    const error = await captureRunnerError(
      runBroadcastContextPhaseLedger({
        ...defaultOptions(ledger),
        execute,
        createRetryOperationId: () => "operation-a-0",
        persist,
      }),
    );

    expect(error.code).toBe("RETRY_OPERATION_ID_FAILED");
    expect(error.transitionRejection).toBe("operation_id_reused");
    expect(execute).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("executes a high durable attempt ordinal without a lifetime ceiling", async () => {
    const ledger = createLedger(3);
    const execute = vi.fn(defaultOptions(ledger).execute);
    const persist = vi.fn(defaultOptions(ledger).persist);

    const result = await runBroadcastContextPhaseLedger({
      ...defaultOptions(ledger),
      execute,
      persist,
    });

    expect(result.status).toBe("completed");
    expect(result.complete).toBe(true);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ attemptOrdinal: 3 }),
    );
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("requires only required units for completion", async () => {
    let ledger = createBroadcastContextPhaseLedger({
      fence,
      units: [
        {
          phase: "discovery",
          unitId: "required",
          inputDigest: "required-digest",
          operationId: "required-op",
          attemptOrdinal: 0,
          required: true,
        },
        {
          phase: "refinement",
          unitId: "optional",
          inputDigest: "optional-digest",
          operationId: "optional-op",
          attemptOrdinal: 0,
          required: false,
        },
      ],
    });
    ledger = transition(ledger, {
      type: "UNIT_STARTED",
      ...identity(ledger, "discovery", "required"),
    });
    ledger = transition(ledger, {
      type: "UNIT_SUCCEEDED",
      ...identity(ledger, "discovery", "required"),
      result: { complete: true },
    });
    ledger = transition(ledger, {
      type: "UNIT_STARTED",
      ...identity(ledger, "refinement", "optional"),
    });
    ledger = transition(ledger, {
      type: "UNIT_OUTCOME_UNKNOWN",
      ...identity(ledger, "refinement", "optional"),
      reasonCode: "optional_unknown",
    });
    const execute = vi.fn(defaultOptions(ledger).execute);

    const result = await runBroadcastContextPhaseLedger({
      ...defaultOptions(ledger),
      execute,
    });

    expect(result.status).toBe("completed");
    expect(result.complete).toBe(true);
    expect(result.blockingUnits).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects an unbounded or zero per-invocation budget before side effects", async () => {
    const ledger = createLedger();
    for (const maximumExecutionsPerInvocation of [
      0,
      9,
      Number.POSITIVE_INFINITY,
    ]) {
      const execute = vi.fn(defaultOptions(ledger).execute);
      const persist = vi.fn(defaultOptions(ledger).persist);
      const error = await captureRunnerError(
        runBroadcastContextPhaseLedger({
          ...defaultOptions(ledger),
          maximumExecutionsPerInvocation,
          execute,
          persist,
        }),
      );

      expect(error.code).toBe("INVALID_ATTEMPT_LIMIT");
      expect(execute).not.toHaveBeenCalled();
      expect(persist).not.toHaveBeenCalled();
    }
  });

  it("rejects invalid concurrency before any transition", async () => {
    const ledger = createLedger();
    for (const maximumConcurrency of [0, 9, Number.POSITIVE_INFINITY]) {
      const execute = vi.fn(defaultOptions(ledger).execute);
      const persist = vi.fn(defaultOptions(ledger).persist);
      const error = await captureRunnerError(
        runBroadcastContextPhaseLedger({
          ...defaultOptions(ledger),
          maximumConcurrency,
          execute,
          persist,
        }),
      );

      expect(error.code).toBe("INVALID_CONCURRENCY");
      expect(execute).not.toHaveBeenCalled();
      expect(persist).not.toHaveBeenCalled();
    }
  });
});
