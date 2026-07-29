import { describe, expect, it, vi } from "vitest";

import {
  BroadcastContextDeepseekClientError,
  type requestBroadcastContextDeepseek,
} from "../analysis/broadcastContextDeepseekClient";
import {
  createBroadcastContextPhaseLedger,
  reduceBroadcastContextPhaseLedger,
  type BroadcastContextPhaseLedger,
  type BroadcastContextPhaseLedgerFence,
  type BroadcastContextPhaseLedgerUnit,
} from "../analysis/broadcastContextPhaseLedger";
import { createBroadcastParticipantGrounding } from "../analysis/broadcastParticipantGrounding";
import {
  BROADCAST_CONTEXT_SCHEMA_VERSION,
  calculateCoverage,
  type BroadcastContextChapterInput,
  type BroadcastContextRequestInput,
  type BroadcastContextResult,
} from "../analysis/broadcastContextProtocol";
import {
  DurableBroadcastRefinementPipelineError,
  runDurableBroadcastRefinementPipeline,
  type DurableBroadcastRefinementCheckpoint,
  type DurableBroadcastRefinementLeadInput,
} from "./durableBroadcastRefinementPipeline";

const fence: BroadcastContextPhaseLedgerFence = {
  parentContextSignature: "context-input-v1",
  transcriptSignature: "transcript-seal-v1",
  groundingSignature: "grounding-seal-v1",
};

function identity(
  ledger: BroadcastContextPhaseLedger,
  phase: BroadcastContextPhaseLedgerUnit["phase"],
  unitId: string,
) {
  const unit = ledger.units.find(
    (candidate) =>
      candidate.phase === phase && candidate.unitId === unitId,
  )!;
  return {
    fence: ledger.fence,
    phase,
    unitId,
    inputDigest: unit.inputDigest,
    operationId: unit.operationId,
    attemptOrdinal: unit.attemptOrdinal,
  } as const;
}

function succeed(
  ledger: BroadcastContextPhaseLedger,
  phase: BroadcastContextPhaseLedgerUnit["phase"],
  unitId: string,
  result: unknown,
): BroadcastContextPhaseLedger {
  const started = reduceBroadcastContextPhaseLedger(ledger, {
    type: "UNIT_STARTED",
    ...identity(ledger, phase, unitId),
  });
  if (!started.accepted) throw new Error(started.reason);
  const completed = reduceBroadcastContextPhaseLedger(started.ledger, {
    type: "UNIT_SUCCEEDED",
    ...identity(started.ledger, phase, unitId),
    result,
  });
  if (!completed.accepted) throw new Error(completed.reason);
  return completed.ledger;
}

function completedParentLedger(
  ledgerFence: BroadcastContextPhaseLedgerFence = fence,
): BroadcastContextPhaseLedger {
  let ledger = createBroadcastContextPhaseLedger({
    fence: ledgerFence,
    units: [
      {
        phase: "discovery",
        unitId: "overview",
        inputDigest: "overview-input",
        operationId: "overview-operation",
        attemptOrdinal: 0,
        required: true,
      },
      {
        phase: "jury",
        unitId: "selection",
        inputDigest: "jury-input",
        operationId: "jury-operation",
        attemptOrdinal: 0,
        required: true,
      },
    ],
  });
  ledger = succeed(ledger, "discovery", "overview", { ok: true });
  return succeed(ledger, "jury", "selection", { ok: true });
}

function chapterFor(
  leadId: string,
  startMs: number,
): BroadcastContextChapterInput {
  return {
    chapterId: `chapter-${leadId}`,
    startMs,
    endMs: startMs + 30_000,
    evidenceMode: "complete-transcript",
    evidenceCoverageRatio: 1,
    summaryKo: `${leadId}의 사건과 반응이 확인된 대사다.`,
  };
}

function requestFor(
  leadId: string,
  startMs: number,
): BroadcastContextRequestInput {
  const chapter = chapterFor(leadId, startMs);
  return {
    sourceDurationMs: 120_000,
    chapters: [chapter],
    candidates: [],
    participantGrounding: createBroadcastParticipantGrounding({
      sourceDurationMs: 120_000,
      castRosterId: null,
      chapters: [chapter],
    }),
    outputLanguage: "ko",
  };
}

function resultFor(
  input: BroadcastContextRequestInput,
): BroadcastContextResult {
  return {
    schemaVersion: BROADCAST_CONTEXT_SCHEMA_VERSION,
    broadcastSummaryKo: "해당 구간의 사건과 스트리머 반응을 확인했다.",
    hostStreamerProfile: null,
    recurringThemesKo: [],
    annotations: [],
    semanticChaptersSupported: false,
    semanticChapters: [],
    discoveredLeadsSupported: true,
    discoveredLeads: [],
    coverage: calculateCoverage(input.chapters, input.sourceDurationMs),
  };
}

function lead(
  leadId: string,
  startMs: number,
  analysisMode: "refinement" | "refinement-fast" = "refinement",
): DurableBroadcastRefinementLeadInput {
  return {
    leadId,
    analysisMode,
    requestInput: requestFor(leadId, startMs),
  };
}

function persistence(seed: BroadcastContextPhaseLedger) {
  let current = seed;
  const persistAndReadBack = vi.fn(
    (checkpoint: DurableBroadcastRefinementCheckpoint) => {
      expect(JSON.parse(checkpoint.ledgerJson)).toEqual(checkpoint.ledger);
      current = checkpoint.ledger;
      return Promise.resolve();
    },
  );
  return {
    get current() {
      return current;
    },
    persistAndReadBack,
  };
}

function pipelineOptions(
  ledger: BroadcastContextPhaseLedger,
  leads: readonly DurableBroadcastRefinementLeadInput[],
  persistAndReadBack: (
    checkpoint: DurableBroadcastRefinementCheckpoint,
  ) => Promise<void>,
) {
  return {
    ledger,
    fence,
    leads,
    quotaParticipantId: "participant-1",
    runId: "run-1",
    evidenceManifestSignature: "transcript-evidence-v1",
    routingManifestSignature: "routing-policy-v1",
    operationGeneration: 4,
    signal: new AbortController().signal,
    persistAndReadBack,
  } as const;
}

describe("runDurableBroadcastRefinementPipeline", () => {
  it("resumes a stored partial plan without spending again on the successful lead", async () => {
    const parent = completedParentLedger();
    const firstPersistence = persistence(parent);
    let rejectSecondStart = true;
    const interruptedPersist = vi.fn(
      async (checkpoint: DurableBroadcastRefinementCheckpoint) => {
        if (
          rejectSecondStart &&
          checkpoint.transition?.unitId === "lead:lead-b" &&
          checkpoint.transition.eventType === "UNIT_STARTED"
        ) {
          rejectSecondStart = false;
          throw new Error("simulated durable store interruption");
        }
        await firstPersistence.persistAndReadBack(checkpoint);
      },
    );
    const firstRequest = vi.fn((input: BroadcastContextRequestInput) =>
      Promise.resolve(resultFor(input)),
    );

    await expect(
      runDurableBroadcastRefinementPipeline({
        ...pipelineOptions(
          parent,
          [lead("lead-a", 0), lead("lead-b", 30_000)],
          interruptedPersist,
        ),
        maximumConcurrency: 1,
        request: firstRequest,
      }),
    ).rejects.toThrow("persist");
    expect(firstPersistence.current.units).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "refinement",
          unitId: "lead:lead-a",
          status: "succeeded",
        }),
        expect.objectContaining({
          phase: "refinement",
          unitId: "lead:lead-b",
          status: "pending",
        }),
      ]),
    );

    const resumedPersistence = persistence(firstPersistence.current);
    const resumedRequest = vi.fn((input: BroadcastContextRequestInput) =>
      Promise.resolve(resultFor(input)),
    );
    const resumed = await runDurableBroadcastRefinementPipeline({
      ...pipelineOptions(
        firstPersistence.current,
        [lead("lead-a", 0), lead("lead-b", 30_000)],
        resumedPersistence.persistAndReadBack,
      ),
      maximumConcurrency: 1,
      request: resumedRequest,
    });

    expect(resumedRequest).toHaveBeenCalledTimes(1);
    expect(resumedRequest.mock.calls[0]?.[0].chapters[0]?.chapterId).toBe(
      "chapter-lead-b",
    );
    expect(resumed.refinements.map(({ leadId }) => leadId)).toEqual([
      "lead-a",
      "lead-b",
    ]);
  });

  it("blocks a legacy succeeded unit without an exact receipt before another provider call", async () => {
    const parent = completedParentLedger();
    const firstPersistence = persistence(parent);
    const firstRequest = vi.fn((input: BroadcastContextRequestInput) =>
      Promise.resolve(resultFor(input)),
    );
    const first = await runDurableBroadcastRefinementPipeline({
      ...pipelineOptions(
        parent,
        [lead("lead-a", 0)],
        firstPersistence.persistAndReadBack,
      ),
      request: firstRequest,
    });
    const legacy = JSON.parse(
      JSON.stringify(first.ledger),
    ) as BroadcastContextPhaseLedger;
    const legacyUnit = (
      legacy.units as unknown as Array<Record<string, unknown>>
    ).find(({ phase }) => phase === "refinement");
    if (legacyUnit === undefined) throw new Error("missing refinement fixture");
    legacyUnit.inputDigest = "legacy-refinement-input-v1";
    delete legacyUnit.modelReceipt;

    const resumedPersistence = persistence(legacy);
    const resumedRequest = vi.fn((input: BroadcastContextRequestInput) =>
      Promise.resolve(resultFor(input)),
    );
    await expect(
      runDurableBroadcastRefinementPipeline({
        ...pipelineOptions(
          legacy,
          [lead("lead-a", 0)],
          resumedPersistence.persistAndReadBack,
        ),
        request: resumedRequest,
      }),
    ).rejects.toMatchObject({
      code: "STORED_RESULT_INVALID",
    });
    expect(resumedRequest).not.toHaveBeenCalled();
    expect(resumedPersistence.persistAndReadBack).not.toHaveBeenCalled();
  });

  it("rejects a succeeded unit whose provider-dispatch receipt contradicts its request", async () => {
    const parent = completedParentLedger();
    const firstPersistence = persistence(parent);
    const first = await runDurableBroadcastRefinementPipeline({
      ...pipelineOptions(
        parent,
        [lead("lead-a", 0)],
        firstPersistence.persistAndReadBack,
      ),
      request: vi.fn((input: BroadcastContextRequestInput) =>
        Promise.resolve(resultFor(input)),
      ),
    });
    const corrupted = JSON.parse(
      JSON.stringify(first.ledger),
    ) as BroadcastContextPhaseLedger;
    const corruptedUnit = (
      corrupted.units as unknown as Array<Record<string, unknown>>
    ).find(({ phase }) => phase === "refinement");
    if (corruptedUnit === undefined) {
      throw new Error("missing refinement fixture");
    }
    const receipt = corruptedUnit.modelReceipt as Record<string, unknown>;
    receipt.providerDispatch = false;

    const resumedRequest = vi.fn((input: BroadcastContextRequestInput) =>
      Promise.resolve(resultFor(input)),
    );
    await expect(
      runDurableBroadcastRefinementPipeline({
        ...pipelineOptions(
          corrupted,
          [lead("lead-a", 0)],
          persistence(corrupted).persistAndReadBack,
        ),
        request: resumedRequest,
      }),
    ).rejects.toMatchObject({
      code: "STORED_RESULT_INVALID",
    });
    expect(resumedRequest).not.toHaveBeenCalled();
  });

  it("retries an explicitly retryable provider failure with a fresh lifetime operation ID", async () => {
    const parent = completedParentLedger();
    const saved = persistence(parent);
    const operationIds: string[] = [];
    let rejected = false;
    type RequestOptions = NonNullable<
      Parameters<typeof requestBroadcastContextDeepseek>[1]
    >;
    const request = vi.fn(
      (
        input: BroadcastContextRequestInput,
        options?: RequestOptions,
      ) => {
        operationIds.push(options!.quota!.operationId);
        if (!rejected) {
          rejected = true;
          return Promise.reject(
            new BroadcastContextDeepseekClientError(
              "PROXY_REJECTED",
              "rate limited",
              {
                status: 429,
                proxyErrorCode: "UPSTREAM_RATE_LIMITED",
              },
            ),
          );
        }
        return Promise.resolve(resultFor(input));
      },
    );

    const completed = await runDurableBroadcastRefinementPipeline({
      ...pipelineOptions(
        parent,
        [lead("lead-a", 0, "refinement-fast")],
        saved.persistAndReadBack,
      ),
      request,
    });

    expect(operationIds).toHaveLength(2);
    expect(new Set(operationIds).size).toBe(2);
    expect(completed.ledger.usedOperationIds).toEqual(
      expect.arrayContaining(operationIds),
    );
    expect(completed.refinements[0]).toEqual(
      expect.objectContaining({
        leadId: "lead-a",
        analysisMode: "refinement-fast",
        abstained: false,
      }),
    );
  });

  it("seals an ambiguous result and never automatically spends again on resume", async () => {
    const parent = completedParentLedger();
    const saved = persistence(parent);
    const ambiguousRequest = vi.fn(() =>
      Promise.reject(new Error("connection disappeared after dispatch")),
    );

    await expect(
      runDurableBroadcastRefinementPipeline({
        ...pipelineOptions(
          parent,
          [lead("lead-a", 0)],
          saved.persistAndReadBack,
        ),
        request: ambiguousRequest,
      }),
    ).rejects.toMatchObject({
      code: "PIPELINE_BLOCKED",
    });
    expect(ambiguousRequest).toHaveBeenCalledTimes(1);
    expect(saved.current.units).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "refinement",
          unitId: "lead:lead-a",
          status: "outcome-unknown",
        }),
      ]),
    );

    const resumedPersistence = persistence(saved.current);
    const resumedRequest = vi.fn((input: BroadcastContextRequestInput) =>
      Promise.resolve(resultFor(input)),
    );
    await expect(
      runDurableBroadcastRefinementPipeline({
        ...pipelineOptions(
          saved.current,
          [lead("lead-a", 0)],
          resumedPersistence.persistAndReadBack,
        ),
        request: resumedRequest,
      }),
    ).rejects.toMatchObject({
      code: "PIPELINE_BLOCKED",
    });
    expect(resumedRequest).not.toHaveBeenCalled();
  });

  it("persists a local success abstention for an empty chapter set without calling the provider", async () => {
    const parent = completedParentLedger();
    const saved = persistence(parent);
    const request = vi.fn();
    const completed = await runDurableBroadcastRefinementPipeline({
      ...pipelineOptions(
        parent,
        [
          {
            leadId: "silent-lead",
            analysisMode: "refinement",
            requestInput: {
              sourceDurationMs: 120_000,
              chapters: [],
              candidates: [],
              outputLanguage: "ko",
            },
          },
        ],
        saved.persistAndReadBack,
      ),
      request,
    });

    expect(request).not.toHaveBeenCalled();
    expect(completed.refinements).toEqual([
      {
        leadId: "silent-lead",
        analysisMode: "refinement",
        abstained: true,
        result: null,
        discoveredLeads: [],
      },
    ]);
    expect(completed.ledger.units).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "refinement",
          unitId: "lead:silent-lead",
          status: "succeeded",
          result: {
            kind: "refinement-abstained-no-chapters",
            schemaVersion: "1.0.0",
            leadId: "silent-lead",
          },
        }),
      ]),
    );
  });

  it("rejects a fence mismatch before persisting or calling the provider", async () => {
    const parent = completedParentLedger();
    const saved = persistence(parent);
    const request = vi.fn();

    await expect(
      runDurableBroadcastRefinementPipeline({
        ...pipelineOptions(
          parent,
          [lead("lead-a", 0)],
          saved.persistAndReadBack,
        ),
        fence: {
          ...fence,
          groundingSignature: "different-grounding",
        },
        request,
      }),
    ).rejects.toMatchObject({
      code: "FENCE_MISMATCH",
    });
    expect(saved.persistAndReadBack).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("replaces stale refinement work when a lead request or mode changes", async () => {
    const parent = completedParentLedger();
    const saved = persistence(parent);
    const request = vi.fn((input: BroadcastContextRequestInput) =>
      Promise.resolve(resultFor(input)),
    );
    const first = await runDurableBroadcastRefinementPipeline({
      ...pipelineOptions(
        parent,
        [lead("lead-a", 0, "refinement")],
        saved.persistAndReadBack,
      ),
      request,
    });
    const resumedPersistence = persistence(first.ledger);
    request.mockClear();

    const replaced = await runDurableBroadcastRefinementPipeline({
        ...pipelineOptions(
          first.ledger,
          [lead("lead-a", 0, "refinement-fast")],
          resumedPersistence.persistAndReadBack,
        ),
        request,
      });
    expect(request).toHaveBeenCalledTimes(1);
    expect(
      resumedPersistence.persistAndReadBack.mock.calls.map(
        ([checkpoint]) => checkpoint.cause,
      ),
    ).toContain("refinement-plan-replaced");
    const replacedUnit = replaced.ledger.units.find(
      ({ phase, unitId }) =>
        phase === "refinement" && unitId === "lead:lead-a",
    );
    expect(replacedUnit?.status).toBe("succeeded");
    expect(
      replacedUnit?.status === "succeeded"
        ? replacedUnit.modelReceipt
        : undefined,
    ).toMatchObject({
      routingManifestSignature: "routing-policy-v1",
      analysisMode: "refinement-fast",
    });
    expect(replaced.ledger.usedOperationIds.length).toBeGreaterThan(
      first.ledger.usedOperationIds.length,
    );
  });

  it("does not reuse a succeeded unit after the routing manifest changes", async () => {
    const parent = completedParentLedger();
    const firstPersistence = persistence(parent);
    const request = vi.fn((input: BroadcastContextRequestInput) =>
      Promise.resolve(resultFor(input)),
    );
    const first = await runDurableBroadcastRefinementPipeline({
      ...pipelineOptions(
        parent,
        [lead("lead-a", 0)],
        firstPersistence.persistAndReadBack,
      ),
      request,
    });
    request.mockClear();
    const secondPersistence = persistence(first.ledger);

    const second = await runDurableBroadcastRefinementPipeline({
      ...pipelineOptions(
        first.ledger,
        [lead("lead-a", 0)],
        secondPersistence.persistAndReadBack,
      ),
      routingManifestSignature: "routing-policy-v2",
      request,
    });

    expect(request).toHaveBeenCalledTimes(1);
    const secondUnit = second.ledger.units.find(
      ({ phase }) => phase === "refinement",
    );
    expect(secondUnit?.status).toBe("succeeded");
    expect(
      secondUnit?.status === "succeeded"
        ? secondUnit.modelReceipt
        : undefined,
    ).toMatchObject({
      routingManifestSignature: "routing-policy-v2",
    });
  });

  it("does not mark a malformed provider payload as a successful refinement", async () => {
    const parent = completedParentLedger();
    const saved = persistence(parent);
    const request = vi.fn(() =>
      Promise.resolve({ discoveredLeadsSupported: true } as never),
    );

    await expect(
      runDurableBroadcastRefinementPipeline({
        ...pipelineOptions(
          parent,
          [lead("lead-a", 0)],
          saved.persistAndReadBack,
        ),
        request,
      }),
    ).rejects.toBeInstanceOf(DurableBroadcastRefinementPipelineError);
    expect(saved.current.units).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "refinement",
          unitId: "lead:lead-a",
          status: "outcome-unknown",
          reasonCode: "provider_refinement_result_invalid",
        }),
      ]),
    );
  });
});
