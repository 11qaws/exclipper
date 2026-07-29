import { describe, expect, it } from "vitest";

import {
  BROADCAST_CONTEXT_PHASE_LEDGER_SCHEMA_VERSION,
  broadcastContextPhaseLedgerCanComplete,
  broadcastContextPhaseLedgerMatchesFence,
  createBroadcastContextPhaseLedger,
  extendBroadcastContextPhaseLedgerPlan,
  replaceBroadcastContextRefinementPhaseLedgerPlan,
  normalizeBroadcastContextPhaseLedger,
  parseBroadcastContextPhaseLedgerJson,
  replanBroadcastContextPhaseLedgerAfterEditorRetry,
  reduceBroadcastContextPhaseLedger,
  selectBroadcastContextPhaseRetryableUnits,
  serializeBroadcastContextPhaseLedger,
  summarizeBroadcastContextPhaseLedger,
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
  parentContextSignature: "context-v7",
  transcriptSignature: "transcript-v4",
  groundingSignature: "grounding-v2",
};

function createLedger(): BroadcastContextPhaseLedger {
  return createBroadcastContextPhaseLedger({
    fence,
    units: [
      {
        phase: "refinement",
        unitId: "optional-detail",
        inputDigest: "digest-detail",
        operationId: "op-detail-0",
        attemptOrdinal: 0,
        required: false,
      },
      {
        phase: "jury",
        unitId: "candidate-1",
        inputDigest: "digest-jury",
        operationId: "op-jury-0",
        attemptOrdinal: 0,
        required: true,
      },
      {
        phase: "discovery",
        unitId: "chapter-1",
        inputDigest: "digest-discovery",
        operationId: "op-discovery-0",
        attemptOrdinal: 0,
        required: true,
      },
    ],
  });
}

function unitIdentity(
  ledger: BroadcastContextPhaseLedger,
  phase: BroadcastContextPhaseLedgerPhase,
  unitId: string,
): BroadcastContextPhaseLedgerUnitIdentity {
  const unit = ledger.units.find(
    (candidate) =>
      candidate.phase === phase && candidate.unitId === unitId,
  );
  if (unit === undefined) throw new Error(`Missing unit ${phase}/${unitId}.`);
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
  expect(outcome.accepted).toBe(true);
  if (!outcome.accepted) {
    throw new Error(`Transition was rejected: ${outcome.reason}`);
  }
  return outcome.ledger;
}

function rejectedReason(
  outcome: BroadcastContextPhaseLedgerTransitionOutcome,
): string {
  expect(outcome.accepted).toBe(false);
  if (outcome.accepted) throw new Error("Transition was unexpectedly accepted.");
  return outcome.reason;
}

function start(
  ledger: BroadcastContextPhaseLedger,
  phase: BroadcastContextPhaseLedgerPhase,
  unitId: string,
): BroadcastContextPhaseLedger {
  return accepted(
    reduceBroadcastContextPhaseLedger(ledger, {
      type: "UNIT_STARTED",
      ...unitIdentity(ledger, phase, unitId),
    }),
  );
}

function succeed(
  ledger: BroadcastContextPhaseLedger,
  phase: BroadcastContextPhaseLedgerPhase,
  unitId: string,
): BroadcastContextPhaseLedger {
  return accepted(
    reduceBroadcastContextPhaseLedger(ledger, {
      type: "UNIT_SUCCEEDED",
      ...unitIdentity(ledger, phase, unitId),
      result: {
        summary: `${phase}/${unitId}`,
        score: 0.91,
      },
      modelReceipt: {
        provider: "amoretto-gemini",
        requestId: `receipt-${unitId}`,
      },
    }),
  );
}

describe("broadcastContextPhaseLedger", () => {
  it("creates a canonical immutable pending plan", () => {
    const ledger = createLedger();

    expect(ledger.schemaVersion).toBe(
      BROADCAST_CONTEXT_PHASE_LEDGER_SCHEMA_VERSION,
    );
    expect(
      ledger.units.map(({ phase, unitId, status }) => ({
        phase,
        unitId,
        status,
      })),
    ).toEqual([
      { phase: "discovery", unitId: "chapter-1", status: "pending" },
      { phase: "jury", unitId: "candidate-1", status: "pending" },
      {
        phase: "refinement",
        unitId: "optional-detail",
        status: "pending",
      },
    ]);
    expect(ledger.usedOperationIds).toEqual([
      "op-detail-0",
      "op-discovery-0",
      "op-jury-0",
    ]);
    expect(Object.isFrozen(ledger)).toBe(true);
    expect(Object.isFrozen(ledger.units)).toBe(true);
    expect(Object.isFrozen(ledger.fence)).toBe(true);
  });

  it("cannot complete until every required unit succeeds", () => {
    let ledger = createLedger();
    expect(broadcastContextPhaseLedgerCanComplete(ledger)).toBe(false);

    ledger = start(ledger, "discovery", "chapter-1");
    ledger = succeed(ledger, "discovery", "chapter-1");
    expect(broadcastContextPhaseLedgerCanComplete(ledger)).toBe(false);

    ledger = start(ledger, "jury", "candidate-1");
    ledger = succeed(ledger, "jury", "candidate-1");
    expect(broadcastContextPhaseLedgerCanComplete(ledger)).toBe(true);
    expect(summarizeBroadcastContextPhaseLedger(ledger)).toMatchObject({
      totalCount: 3,
      requiredCount: 2,
      requiredSucceededCount: 2,
      pendingCount: 1,
      succeededCount: 2,
      complete: true,
    });
  });

  it("treats an empty or entirely optional plan as complete", () => {
    const empty = createBroadcastContextPhaseLedger({ fence, units: [] });
    const optional = createBroadcastContextPhaseLedger({
      fence,
      units: [
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

    expect(broadcastContextPhaseLedgerCanComplete(empty)).toBe(true);
    expect(broadcastContextPhaseLedgerCanComplete(optional)).toBe(true);
  });

  it("selects only known-safe retryable gaps and never outcome-unknown work", () => {
    let ledger = createLedger();
    ledger = start(ledger, "discovery", "chapter-1");
    ledger = accepted(
      reduceBroadcastContextPhaseLedger(ledger, {
        type: "UNIT_RETRYABLE_GAP",
        ...unitIdentity(ledger, "discovery", "chapter-1"),
        reasonCode: "rate_limited_before_provider_acceptance",
      }),
    );
    ledger = start(ledger, "jury", "candidate-1");
    ledger = accepted(
      reduceBroadcastContextPhaseLedger(ledger, {
        type: "UNIT_OUTCOME_UNKNOWN",
        ...unitIdentity(ledger, "jury", "candidate-1"),
        reasonCode: "connection_lost_after_dispatch",
        modelReceipt: { gatewayOperationId: "gateway-op-77" },
      }),
    );

    expect(
      selectBroadcastContextPhaseRetryableUnits(ledger).map(
        ({ phase, unitId }) => `${phase}/${unitId}`,
      ),
    ).toEqual(["discovery/chapter-1"]);
    expect(summarizeBroadcastContextPhaseLedger(ledger)).toMatchObject({
      retryableGapCount: 1,
      outcomeUnknownCount: 1,
      complete: false,
    });
  });

  it("stores a deterministic failure as terminal non-retryable work", () => {
    let ledger = start(createLedger(), "discovery", "chapter-1");
    ledger = accepted(
      reduceBroadcastContextPhaseLedger(ledger, {
        type: "UNIT_FAILED",
        ...unitIdentity(ledger, "discovery", "chapter-1"),
        reasonCode: "local_context_contract_invalid",
      }),
    );

    expect(
      ledger.units.find(
        ({ phase, unitId }) =>
          phase === "discovery" && unitId === "chapter-1",
      ),
    ).toMatchObject({
      status: "failed",
      reasonCode: "local_context_contract_invalid",
    });
    expect(summarizeBroadcastContextPhaseLedger(ledger)).toMatchObject({
      failedCount: 1,
      complete: false,
    });
    expect(selectBroadcastContextPhaseRetryableUnits(ledger)).toEqual([]);
    expect(
      rejectedReason(
        reduceBroadcastContextPhaseLedger(ledger, {
          type: "UNIT_RETRY_PLANNED",
          ...unitIdentity(ledger, "discovery", "chapter-1"),
          nextOperationId: "must-not-run",
        }),
      ),
    ).toBe("undefined_transition");
  });

  it("plans a retry with a fresh billing identity and rejects delayed old events", () => {
    let ledger = createLedger();
    ledger = start(ledger, "discovery", "chapter-1");
    const firstAttemptIdentity = unitIdentity(
      ledger,
      "discovery",
      "chapter-1",
    );
    ledger = accepted(
      reduceBroadcastContextPhaseLedger(ledger, {
        type: "UNIT_RETRYABLE_GAP",
        ...firstAttemptIdentity,
        reasonCode: "provider_unavailable_before_acceptance",
      }),
    );
    ledger = accepted(
      reduceBroadcastContextPhaseLedger(ledger, {
        type: "UNIT_RETRY_PLANNED",
        ...unitIdentity(ledger, "discovery", "chapter-1"),
        nextOperationId: "op-discovery-1",
      }),
    );

    const retriedUnit = ledger.units.find(
      ({ phase }) => phase === "discovery",
    );
    expect(retriedUnit).toMatchObject({
      status: "pending",
      operationId: "op-discovery-1",
      attemptOrdinal: 1,
      inputDigest: "digest-discovery",
    });
    expect(ledger.usedOperationIds).not.toContain("op-discovery-0");
    expect(ledger.usedOperationIds).toContain("op-discovery-1");

    expect(
      rejectedReason(
        reduceBroadcastContextPhaseLedger(ledger, {
          type: "UNIT_SUCCEEDED",
          ...firstAttemptIdentity,
          result: { stale: true },
        }),
      ),
    ).toBe("operation_id_mismatch");

    const currentIdentity = unitIdentity(
      ledger,
      "discovery",
      "chapter-1",
    );
    expect(
      rejectedReason(
        reduceBroadcastContextPhaseLedger(ledger, {
          type: "UNIT_STARTED",
          ...currentIdentity,
          attemptOrdinal: 0,
        }),
      ),
    ).toBe("attempt_ordinal_mismatch");

    ledger = start(ledger, "discovery", "chapter-1");
    ledger = succeed(ledger, "discovery", "chapter-1");
    expect(
      ledger.units.find(({ phase }) => phase === "discovery")?.status,
    ).toBe("succeeded");
  });

  it("never automatically replans an outcome-unknown operation", () => {
    let ledger = createLedger();
    ledger = start(ledger, "jury", "candidate-1");
    ledger = accepted(
      reduceBroadcastContextPhaseLedger(ledger, {
        type: "UNIT_OUTCOME_UNKNOWN",
        ...unitIdentity(ledger, "jury", "candidate-1"),
        reasonCode: "provider_response_lost",
      }),
    );

    expect(
      rejectedReason(
        reduceBroadcastContextPhaseLedger(ledger, {
          type: "UNIT_RETRY_PLANNED",
          ...unitIdentity(ledger, "jury", "candidate-1"),
          nextOperationId: "op-jury-1",
        }),
      ),
    ).toBe("undefined_transition");
    expect(ledger.usedOperationIds).not.toContain("op-jury-1");
  });

  it("persists exact-operation reconciliation and accepts only its terminal outcomes", () => {
    let ledger = createLedger();
    ledger = start(ledger, "jury", "candidate-1");
    ledger = accepted(
      reduceBroadcastContextPhaseLedger(ledger, {
        type: "UNIT_OUTCOME_UNKNOWN",
        ...unitIdentity(ledger, "jury", "candidate-1"),
        reasonCode: "provider_response_lost",
      }),
    );
    ledger = accepted(
      reduceBroadcastContextPhaseLedger(ledger, {
        type: "UNIT_RECONCILIATION_STARTED",
        ...unitIdentity(ledger, "jury", "candidate-1"),
      }),
    );
    expect(
      ledger.units.find(({ unitId }) => unitId === "candidate-1"),
    ).toMatchObject({
      status: "reconciling",
      operationId: "op-jury-0",
      inputDigest: "digest-jury",
    });
    expect(summarizeBroadcastContextPhaseLedger(ledger)).toMatchObject({
      reconcilingCount: 1,
      outcomeUnknownCount: 0,
    });

    expect(
      rejectedReason(
        reduceBroadcastContextPhaseLedger(ledger, {
          type: "UNIT_RECONCILIATION_SUCCEEDED",
          ...unitIdentity(ledger, "jury", "candidate-1"),
          operationId: "different-operation",
          result: { summary: "stale" },
        }),
      ),
    ).toBe("operation_id_mismatch");

    ledger = accepted(
      reduceBroadcastContextPhaseLedger(ledger, {
        type: "UNIT_RECONCILIATION_NOT_DISPATCHED",
        ...unitIdentity(ledger, "jury", "candidate-1"),
        reasonCode: "coordinator_proved_not_dispatched",
      }),
    );
    expect(
      ledger.units.find(({ unitId }) => unitId === "candidate-1"),
    ).toMatchObject({
      status: "retryable-gap",
      operationId: "op-jury-0",
      reasonCode: "coordinator_proved_not_dispatched",
    });
  });

  it("replans an outcome-unknown unit only after an explicit editor confirmation", () => {
    let ledger = createLedger();
    ledger = start(ledger, "jury", "candidate-1");
    ledger = accepted(
      reduceBroadcastContextPhaseLedger(ledger, {
        type: "UNIT_OUTCOME_UNKNOWN",
        ...unitIdentity(ledger, "jury", "candidate-1"),
        reasonCode: "provider_response_lost",
      }),
    );
    const uncertainIdentity = unitIdentity(
      ledger,
      "jury",
      "candidate-1",
    );

    expect(
      rejectedReason(
        reduceBroadcastContextPhaseLedger(ledger, {
          type: "UNIT_OUTCOME_UNKNOWN_RETRY_CONFIRMED",
          ...uncertainIdentity,
          nextOperationId: "op-jury-confirmed-1",
          confirmationId: "",
        }),
      ),
    ).toBe("invalid_confirmation_id");

    ledger = accepted(
      reduceBroadcastContextPhaseLedger(ledger, {
        type: "UNIT_OUTCOME_UNKNOWN_RETRY_CONFIRMED",
        ...uncertainIdentity,
        nextOperationId: "op-jury-confirmed-1",
        confirmationId: "editor-retry-2026-07-29T01:00:00Z",
      }),
    );

    expect(
      ledger.units.find(
        ({ phase, unitId }) =>
          phase === "jury" && unitId === "candidate-1",
      ),
    ).toMatchObject({
      status: "pending",
      operationId: "op-jury-confirmed-1",
      attemptOrdinal: 1,
    });
    expect(ledger.usedOperationIds).not.toContain("op-jury-0");
    expect(ledger.usedOperationIds).toContain("op-jury-confirmed-1");
  });

  it("preserves successes and replans only unfinished units after an editor retry", () => {
    let ledger = createLedger();
    ledger = start(ledger, "discovery", "chapter-1");
    ledger = succeed(ledger, "discovery", "chapter-1");
    ledger = start(ledger, "jury", "candidate-1");
    ledger = accepted(
      reduceBroadcastContextPhaseLedger(ledger, {
        type: "UNIT_OUTCOME_UNKNOWN",
        ...unitIdentity(ledger, "jury", "candidate-1"),
        reasonCode: "same_operation_reconciliation_unresolved",
      }),
    );

    const replanned = replanBroadcastContextPhaseLedgerAfterEditorRetry(
      ledger,
      {
        confirmationId: "editor-click-2026-07-29T01:10:00Z",
        nextOperationId: (unit) =>
          `confirmed-${unit.phase}-${unit.unitId}-${unit.attemptOrdinal + 1}`,
      },
    );

    expect(
      replanned.units.find(
        ({ phase }) => phase === "discovery",
      ),
    ).toMatchObject({
      status: "succeeded",
      operationId: "op-discovery-0",
      attemptOrdinal: 0,
    });
    expect(
      replanned.units.find(({ phase }) => phase === "jury"),
    ).toMatchObject({
      status: "pending",
      operationId: "confirmed-jury-candidate-1-1",
      attemptOrdinal: 1,
    });
    expect(
      replanned.units.find(({ phase }) => phase === "refinement"),
    ).toMatchObject({
      status: "pending",
      operationId: "op-detail-0",
      attemptOrdinal: 0,
    });
  });

  it("requires exact-operation reconciliation before an editor can replace an in-flight identity", () => {
    let ledger = createLedger();
    ledger = start(ledger, "jury", "candidate-1");

    expect(() =>
      replanBroadcastContextPhaseLedgerAfterEditorRetry(ledger, {
        confirmationId: "editor-click-before-reconciliation",
        nextOperationId: () => "must-not-be-allocated",
      }),
    ).toThrow("must reconcile its exact operation");
    expect(
      ledger.units.find(({ unitId }) => unitId === "candidate-1"),
    ).toMatchObject({
      status: "in-flight",
      operationId: "op-jury-0",
    });
    expect(ledger.usedOperationIds).not.toContain("must-not-be-allocated");
  });

  it("does not reuse any operation identity from a prior attempt", () => {
    let ledger = createLedger();
    ledger = start(ledger, "discovery", "chapter-1");
    ledger = accepted(
      reduceBroadcastContextPhaseLedger(ledger, {
        type: "UNIT_RETRYABLE_GAP",
        ...unitIdentity(ledger, "discovery", "chapter-1"),
        reasonCode: "rate_limited",
      }),
    );

    expect(
      rejectedReason(
        reduceBroadcastContextPhaseLedger(ledger, {
          type: "UNIT_RETRY_PLANNED",
          ...unitIdentity(ledger, "discovery", "chapter-1"),
          nextOperationId: "op-discovery-0",
        }),
      ),
    ).toBe("operation_id_reused");
    expect(
      rejectedReason(
        reduceBroadcastContextPhaseLedger(ledger, {
          type: "UNIT_RETRY_PLANNED",
          ...unitIdentity(ledger, "discovery", "chapter-1"),
          nextOperationId: "op-jury-0",
        }),
      ),
    ).toBe("operation_id_reused");
  });

  it("fences every event to context, transcript, and participant grounding", () => {
    const ledger = createLedger();
    const identity = unitIdentity(ledger, "discovery", "chapter-1");
    const mismatches = [
      {
        key: "parentContextSignature",
        expected: "parent_context_signature_mismatch",
      },
      {
        key: "transcriptSignature",
        expected: "transcript_signature_mismatch",
      },
      {
        key: "groundingSignature",
        expected: "grounding_signature_mismatch",
      },
    ] as const;

    for (const { key, expected } of mismatches) {
      const event: BroadcastContextPhaseLedgerEvent = {
        type: "UNIT_STARTED",
        ...identity,
        fence: { ...identity.fence, [key]: `wrong-${key}` },
      };
      expect(
        rejectedReason(reduceBroadcastContextPhaseLedger(ledger, event)),
      ).toBe(expected);
    }
    expect(broadcastContextPhaseLedgerMatchesFence(ledger, fence)).toBe(true);
    expect(
      broadcastContextPhaseLedgerMatchesFence(ledger, {
        ...fence,
        transcriptSignature: "new-transcript",
      }),
    ).toBe(false);
  });

  it("rejects invalid evidence without changing the in-flight unit", () => {
    const ledger = start(createLedger(), "discovery", "chapter-1");
    const identity = unitIdentity(ledger, "discovery", "chapter-1");

    const invalidResult = reduceBroadcastContextPhaseLedger(ledger, {
      type: "UNIT_SUCCEEDED",
      ...identity,
      result: new Date(),
    });
    expect(rejectedReason(invalidResult)).toBe("invalid_result");
    expect(invalidResult.ledger).toBe(ledger);

    const emptyReceipt = reduceBroadcastContextPhaseLedger(ledger, {
      type: "UNIT_SUCCEEDED",
      ...identity,
      result: null,
      modelReceipt: {},
    });
    expect(rejectedReason(emptyReceipt)).toBe("invalid_model_receipt");
    expect(emptyReceipt.ledger).toBe(ledger);

    expect(
      rejectedReason(
        reduceBroadcastContextPhaseLedger(ledger, {
          type: "UNIT_RETRYABLE_GAP",
          ...identity,
          reasonCode: "  ",
        }),
      ),
    ).toBe("invalid_reason_code");
  });

  it("supports succeeded units with or without optional result and receipt", () => {
    let ledger = start(createLedger(), "discovery", "chapter-1");
    ledger = accepted(
      reduceBroadcastContextPhaseLedger(ledger, {
        type: "UNIT_SUCCEEDED",
        ...unitIdentity(ledger, "discovery", "chapter-1"),
      }),
    );
    expect(
      ledger.units.find(({ phase }) => phase === "discovery"),
    ).toEqual({
      phase: "discovery",
      unitId: "chapter-1",
      inputDigest: "digest-discovery",
      operationId: "op-discovery-0",
      attemptOrdinal: 0,
      required: true,
      status: "succeeded",
    });

    ledger = start(ledger, "jury", "candidate-1");
    ledger = accepted(
      reduceBroadcastContextPhaseLedger(ledger, {
        type: "UNIT_SUCCEEDED",
        ...unitIdentity(ledger, "jury", "candidate-1"),
        result: null,
        modelReceipt: { billed: true },
      }),
    );
    expect(
      ledger.units.find(({ phase }) => phase === "jury"),
    ).toMatchObject({
      status: "succeeded",
      result: null,
      modelReceipt: { billed: true },
    });
  });

  it("round-trips canonical JSON and normalizes key and unit ordering", () => {
    let ledger = start(createLedger(), "discovery", "chapter-1");
    ledger = succeed(ledger, "discovery", "chapter-1");
    const serialized = serializeBroadcastContextPhaseLedger(ledger);
    const parsed = parseBroadcastContextPhaseLedgerJson(serialized);

    expect(parsed).toEqual(ledger);
    expect(
      parsed?.units.map(({ phase, unitId }) => `${phase}/${unitId}`),
    ).toEqual([
      "discovery/chapter-1",
      "jury/candidate-1",
      "refinement/optional-detail",
    ]);
    expect(
      parsed === null ? null : serializeBroadcastContextPhaseLedger(parsed),
    ).toBe(serialized);
  });

  it("rejects malformed durable JSON instead of partially accepting it", () => {
    const plain = JSON.parse(
      serializeBroadcastContextPhaseLedger(createLedger()),
    ) as {
      schemaVersion: string;
      fence: Record<string, unknown>;
      units: Array<Record<string, unknown>>;
      usedOperationIds: string[];
      unexpected?: boolean;
    };

    expect(
      normalizeBroadcastContextPhaseLedger({ ...plain, unexpected: true }),
    ).toBeNull();
    expect(
      normalizeBroadcastContextPhaseLedger({
        ...plain,
        schemaVersion: "0.9.0",
      }),
    ).toBeNull();
    expect(
      normalizeBroadcastContextPhaseLedger({
        ...plain,
        units: [...plain.units, { ...plain.units[0] }],
      }),
    ).toBeNull();
    expect(
      normalizeBroadcastContextPhaseLedger({
        ...plain,
        usedOperationIds: plain.usedOperationIds.slice(1),
      }),
    ).toBeNull();
    expect(
      normalizeBroadcastContextPhaseLedger({
        ...plain,
        usedOperationIds: [
          ...plain.usedOperationIds,
          plain.usedOperationIds[0],
        ],
      }),
    ).toBeNull();

    const firstUnit = plain.units[0];
    if (firstUnit === undefined) throw new Error("Malformed fixture.");
    expect(
      normalizeBroadcastContextPhaseLedger({
        ...plain,
        units: [
          {
            ...firstUnit,
            status: "pending",
            result: { shouldNotExist: true },
          },
          ...plain.units.slice(1),
        ],
      }),
    ).toBeNull();
    expect(parseBroadcastContextPhaseLedgerJson("{not-json")).toBeNull();
  });

  it("rejects duplicate logical units and operation IDs at plan creation", () => {
    expect(() =>
      createBroadcastContextPhaseLedger({
        fence,
        units: [
          {
            phase: "discovery",
            unitId: "same",
            inputDigest: "a",
            operationId: "op-a",
            attemptOrdinal: 0,
            required: true,
          },
          {
            phase: "discovery",
            unitId: "same",
            inputDigest: "b",
            operationId: "op-b",
            attemptOrdinal: 0,
            required: true,
          },
        ],
      }),
    ).toThrow(TypeError);
    expect(() =>
      createBroadcastContextPhaseLedger({
        fence,
        units: [
          {
            phase: "discovery",
            unitId: "a",
            inputDigest: "a",
            operationId: "same-op",
            attemptOrdinal: 0,
            required: true,
          },
          {
            phase: "jury",
            unitId: "b",
            inputDigest: "b",
            operationId: "same-op",
            attemptOrdinal: 0,
            required: true,
          },
        ],
      }),
    ).toThrow(TypeError);
  });

  it("extends a completed discovery plan with pending jury units", () => {
    let ledger = createBroadcastContextPhaseLedger({
      fence,
      units: [
        {
          phase: "discovery",
          unitId: "discovery-a",
          inputDigest: "discovery-digest",
          operationId: "discovery-op",
          attemptOrdinal: 0,
          required: true,
        },
      ],
    });
    ledger = start(ledger, "discovery", "discovery-a");
    ledger = accepted(
      reduceBroadcastContextPhaseLedger(ledger, {
        type: "UNIT_SUCCEEDED",
        ...unitIdentity(ledger, "discovery", "discovery-a"),
        result: { topics: ["food", "chat"] },
        modelReceipt: { requestId: "discovery-receipt" },
      }),
    );

    const extended = extendBroadcastContextPhaseLedgerPlan(ledger, [
      {
        phase: "jury",
        unitId: "jury-b",
        inputDigest: "jury-digest-b",
        operationId: "jury-op-b",
        attemptOrdinal: 0,
        required: true,
      },
      {
        phase: "jury",
        unitId: "jury-a",
        inputDigest: "jury-digest-a",
        operationId: "jury-op-a",
        attemptOrdinal: 0,
        required: true,
      },
    ]);

    expect(extended.units).toEqual([
      expect.objectContaining({
        phase: "discovery",
        unitId: "discovery-a",
        status: "succeeded",
        result: { topics: ["food", "chat"] },
        modelReceipt: { requestId: "discovery-receipt" },
      }),
      expect.objectContaining({
        phase: "jury",
        unitId: "jury-a",
        status: "pending",
      }),
      expect.objectContaining({
        phase: "jury",
        unitId: "jury-b",
        status: "pending",
      }),
    ]);
    expect(extended.usedOperationIds).toEqual([
      "discovery-op",
      "jury-op-a",
      "jury-op-b",
    ]);
    expect(normalizeBroadcastContextPhaseLedger(extended)).toEqual(extended);
    expect(
      parseBroadcastContextPhaseLedgerJson(
        serializeBroadcastContextPhaseLedger(extended),
      ),
    ).toEqual(extended);
  });

  it("rejects duplicate or backward plan extensions", () => {
    const ledger = createBroadcastContextPhaseLedger({
      fence,
      units: [
        {
          phase: "jury",
          unitId: "jury-a",
          inputDigest: "jury-digest",
          operationId: "old-refinement-op",
          attemptOrdinal: 0,
          required: true,
        },
      ],
    });

    expect(() =>
      extendBroadcastContextPhaseLedgerPlan(ledger, [
        {
          phase: "discovery",
          unitId: "late-discovery",
          inputDigest: "late-digest",
          operationId: "late-op",
          attemptOrdinal: 0,
          required: true,
        },
      ]),
    ).toThrow("must append a later phase");
    expect(() =>
      extendBroadcastContextPhaseLedgerPlan(ledger, [
        {
          phase: "jury",
          unitId: "same-phase",
          inputDigest: "same-digest",
          operationId: "same-op",
          attemptOrdinal: 0,
          required: true,
        },
      ]),
    ).toThrow("must append a later phase");
  });

  it("keeps only current operation fences and rejects current or duplicate extension identities", () => {
    let ledger = createBroadcastContextPhaseLedger({
      fence,
      units: [
        {
          phase: "discovery",
          unitId: "discovery-a",
          inputDigest: "discovery-digest",
          operationId: "discovery-op-0",
          attemptOrdinal: 0,
          required: true,
        },
      ],
    });
    ledger = start(ledger, "discovery", "discovery-a");
    ledger = accepted(
      reduceBroadcastContextPhaseLedger(ledger, {
        type: "UNIT_RETRYABLE_GAP",
        ...unitIdentity(ledger, "discovery", "discovery-a"),
        reasonCode: "safe_failure",
      }),
    );
    ledger = accepted(
      reduceBroadcastContextPhaseLedger(ledger, {
        type: "UNIT_RETRY_PLANNED",
        ...unitIdentity(ledger, "discovery", "discovery-a"),
        nextOperationId: "discovery-op-1",
      }),
    );

    expect(() =>
      extendBroadcastContextPhaseLedgerPlan(ledger, [
        {
          phase: "jury",
          unitId: "jury-a",
          inputDigest: "jury-digest",
          operationId: "discovery-op-1",
          attemptOrdinal: 0,
          required: true,
        },
      ]),
    ).toThrow("extension is invalid");
    expect(() =>
      extendBroadcastContextPhaseLedgerPlan(ledger, [
        {
          phase: "jury",
          unitId: "jury-a",
          inputDigest: "jury-digest-a",
          operationId: "jury-op-a",
          attemptOrdinal: 0,
          required: true,
        },
        {
          phase: "jury",
          unitId: "jury-a",
          inputDigest: "jury-digest-b",
          operationId: "jury-op-b",
          attemptOrdinal: 0,
          required: true,
        },
      ]),
    ).toThrow("extension is invalid");
    expect(ledger.usedOperationIds).toEqual(["discovery-op-1"]);
  });

  it("replaces only refinement work while retaining parent evidence and bounded current IDs", () => {
    const ledger = createBroadcastContextPhaseLedger({
      fence,
      units: [
        {
          phase: "discovery",
          unitId: "discovery-a",
          inputDigest: "discovery-digest",
          operationId: "discovery-op",
          attemptOrdinal: 0,
          required: true,
        },
        {
          phase: "jury",
          unitId: "jury-a",
          inputDigest: "jury-digest",
          operationId: "jury-op",
          attemptOrdinal: 0,
          required: true,
        },
        {
          phase: "refinement",
          unitId: "lead:old",
          inputDigest: "old-digest",
          operationId: "old-refinement-op",
          attemptOrdinal: 0,
          required: true,
        },
      ],
    });

    const replaced = replaceBroadcastContextRefinementPhaseLedgerPlan(
      ledger,
      [
        {
          phase: "refinement",
          unitId: "lead:new",
          inputDigest: "new-digest",
          operationId: "new-refinement-op",
          attemptOrdinal: 0,
          required: true,
        },
      ],
    );

    expect(
      replaced.units.filter(({ phase }) => phase !== "refinement"),
    ).toEqual(ledger.units.filter(({ phase }) => phase !== "refinement"));
    expect(
      replaced.units.filter(({ phase }) => phase === "refinement"),
    ).toEqual([
      expect.objectContaining({
        unitId: "lead:new",
        inputDigest: "new-digest",
        operationId: "new-refinement-op",
        status: "pending",
      }),
    ]);
    expect(replaced.usedOperationIds).toEqual([
      "discovery-op",
      "jury-op",
      "new-refinement-op",
    ]);
    expect(() =>
      replaceBroadcastContextRefinementPhaseLedgerPlan(ledger, [
        {
          phase: "refinement",
          unitId: "lead:reused",
          inputDigest: "reused-digest",
          operationId: "jury-op",
          attemptOrdinal: 0,
          required: true,
        },
      ]),
    ).toThrow("replacement is invalid");
  });
});
