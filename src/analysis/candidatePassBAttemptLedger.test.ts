import { describe, expect, it } from "vitest";

import {
  appendCandidatePassBArmedAttempt,
  assertCandidatePassBAttemptLedger,
  candidatePassBAttemptLedgerState,
  createCandidatePassBAttemptLedger,
  issueCandidatePassBRetryGrant,
  mergeCandidatePassBAttemptLedgers,
  settleCandidatePassBAttempt,
  type CandidatePassBRetryGrant,
} from "./candidatePassBAttemptLedger";
import {
  CANDIDATE_PASS_B_DISPATCH_INTENT_SCHEMA_VERSION,
  CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
  CANDIDATE_PASS_B_QWEN_MODEL_ID,
  CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
  CANDIDATE_PASS_B_MEDIA_RECEIPT_SCHEMA_VERSION,
  CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
  CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION,
  type CandidatePassBDispatchIntent,
  type CandidatePassBTerminalSettlement,
} from "./candidatePassBWorkerProtocol";

const CANDIDATE_ID = "candidate-1";

function digest(digit: string): `sha256:${string}` {
  return `sha256:${digit.repeat(64)}`;
}

function dispatch(
  attemptOrdinal: number,
  transportMode: "free-r2" | "paid-direct" = "free-r2",
  retryGrantId: string | null =
    attemptOrdinal === 0 ? null : `retry-grant-${attemptOrdinal}`,
): CandidatePassBDispatchIntent {
  return {
    schemaVersion: CANDIDATE_PASS_B_DISPATCH_INTENT_SCHEMA_VERSION,
    operationId: `pass-b-operation-${transportMode}-${attemptOrdinal}`,
    analysisRunId: "analysis-run-1",
    candidateId: CANDIDATE_ID,
    sourceFingerprint: digest("1"),
    sourceStartMs: 10_000,
    sourceEndMs: 55_000,
    contextFingerprint: "fnv1a64:0123456789abcdef",
    outputLanguage: "ko",
    castRosterId: null,
    routingModelRevision: CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
    attemptOrdinal,
    retryGrantId,
    transportMode,
    mediaReceipt: {
      schemaVersion: CANDIDATE_PASS_B_MEDIA_RECEIPT_SCHEMA_VERSION,
      frameExtractionRevision: CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
      frames: [0, 1, 2, 3].map((index) => ({
        timestampMs: 5_000 + index * 10_000,
        mimeType: "image/jpeg" as const,
        byteLength: 100 + index,
        contentDigest: digest(String(index + 2)),
        extractionRevision: CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
      })) as [
        {
          timestampMs: number;
          mimeType: "image/jpeg";
          byteLength: number;
          contentDigest: `sha256:${string}`;
          extractionRevision: typeof CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION;
        },
        {
          timestampMs: number;
          mimeType: "image/jpeg";
          byteLength: number;
          contentDigest: `sha256:${string}`;
          extractionRevision: typeof CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION;
        },
        {
          timestampMs: number;
          mimeType: "image/jpeg";
          byteLength: number;
          contentDigest: `sha256:${string}`;
          extractionRevision: typeof CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION;
        },
        {
          timestampMs: number;
          mimeType: "image/jpeg";
          byteLength: number;
          contentDigest: `sha256:${string}`;
          extractionRevision: typeof CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION;
        },
      ],
      audio: {
        kind: "audible-audio",
        wavByteLength: 1_440_044,
        wavContentDigest: digest("6"),
        sampleRateHz: 16_000,
        sampleCount: 720_000,
      },
      providerPayloadDigest: digest(String(7 + attemptOrdinal)),
    },
  };
}

function settlement(
  intent: CandidatePassBDispatchIntent,
  status: "completed" | "outcome-unknown",
): CandidatePassBTerminalSettlement {
  return status === "completed"
    ? {
        schemaVersion: CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION,
        status,
        operationId: intent.operationId,
        providerPayloadDigest: intent.mediaReceipt.providerPayloadDigest,
        outputLanguage: intent.outputLanguage,
        castRosterId: intent.castRosterId,
        responseDigest: digest("9"),
        providerModelId: CANDIDATE_PASS_B_QWEN_MODEL_ID,
        providerModelRevision: CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
      }
    : {
        schemaVersion: CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION,
        status,
        operationId: intent.operationId,
        providerPayloadDigest: intent.mediaReceipt.providerPayloadDigest,
        outputLanguage: intent.outputLanguage,
        castRosterId: intent.castRosterId,
        reason: "armed-dispatch-recovered",
      };
}

function grant(
  intent: CandidatePassBDispatchIntent,
  nextAttemptOrdinal: number,
  mode: CandidatePassBRetryGrant["mode"] = "automatic-free-tier",
): CandidatePassBRetryGrant {
  return {
    schemaVersion: "1.0.0",
    grantId: `retry-grant-${nextAttemptOrdinal}`,
    candidateId: CANDIDATE_ID,
    replacesOperationId: intent.operationId,
    nextAttemptOrdinal,
    mode,
  };
}

describe("Candidate Pass B attempt ledger", () => {
  it("arms only the initial attempt automatically and settles idempotently", () => {
    const initial = createCandidatePassBAttemptLedger(CANDIDATE_ID);
    expect(candidatePassBAttemptLedgerState(initial)).toBe("auto-eligible");

    const intent = dispatch(0);
    const armed = appendCandidatePassBArmedAttempt(initial, {
      dispatchIntent: intent,
      retryGrantId: null,
    });
    expect(candidatePassBAttemptLedgerState(armed)).toBe("armed");
    expect(
      appendCandidatePassBArmedAttempt(armed, {
        dispatchIntent: intent,
        retryGrantId: null,
      }),
    ).toBe(armed);

    const terminal = settlement(intent, "completed");
    const completed = settleCandidatePassBAttempt(armed, terminal);
    expect(candidatePassBAttemptLedgerState(completed)).toBe("completed");
    expect(settleCandidatePassBAttempt(completed, terminal)).toBe(completed);
  });

  it("persists a one-shot grant before appending a replacement attempt", () => {
    const firstIntent = dispatch(0);
    const blocked = settleCandidatePassBAttempt(
      appendCandidatePassBArmedAttempt(
        createCandidatePassBAttemptLedger(CANDIDATE_ID),
        { dispatchIntent: firstIntent, retryGrantId: null },
      ),
      settlement(firstIntent, "outcome-unknown"),
    );
    expect(candidatePassBAttemptLedgerState(blocked)).toBe("blocked");

    const retryGrant = grant(firstIntent, 1);
    const granted = issueCandidatePassBRetryGrant(blocked, retryGrant);
    expect(candidatePassBAttemptLedgerState(granted)).toBe("retry-granted");

    const secondIntent = dispatch(1);
    const retried = appendCandidatePassBArmedAttempt(granted, {
      dispatchIntent: secondIntent,
      retryGrantId: retryGrant.grantId,
    });
    expect(candidatePassBAttemptLedgerState(retried)).toBe("armed");
    expect(retried.attempts.map(({ dispatchIntent }) =>
      dispatchIntent.operationId)).toEqual([
      firstIntent.operationId,
      secondIntent.operationId,
    ]);
  });

  it("never re-runs a completed free-R2 result", () => {
    const intent = dispatch(0, "free-r2");
    const completed = settleCandidatePassBAttempt(
      appendCandidatePassBArmedAttempt(
        createCandidatePassBAttemptLedger(CANDIDATE_ID),
        { dispatchIntent: intent, retryGrantId: null },
      ),
      settlement(intent, "completed"),
    );
    expect(() =>
      issueCandidatePassBRetryGrant(completed, grant(intent, 1)),
    ).toThrow(TypeError);
  });

  it("never re-bills a completed paid-direct result", () => {
    const intent = dispatch(0, "paid-direct");
    const completed = settleCandidatePassBAttempt(
      appendCandidatePassBArmedAttempt(
        createCandidatePassBAttemptLedger(CANDIDATE_ID),
        { dispatchIntent: intent, retryGrantId: null },
      ),
      settlement(intent, "completed"),
    );
    expect(() =>
      issueCandidatePassBRetryGrant(completed, grant(intent, 1)),
    ).toThrow(TypeError);

    expect(() =>
      issueCandidatePassBRetryGrant(
        completed,
        grant(intent, 1, "editor-approved-paid"),
      ),
    ).toThrow(TypeError);
  });

  it("does not turn a blocked paid-direct attempt into an unapproved paid retry", () => {
    const intent = dispatch(0, "paid-direct");
    const blocked = settleCandidatePassBAttempt(
      appendCandidatePassBArmedAttempt(
        createCandidatePassBAttemptLedger(CANDIDATE_ID),
        { dispatchIntent: intent, retryGrantId: null },
      ),
      settlement(intent, "outcome-unknown"),
    );
    expect(() =>
      issueCandidatePassBRetryGrant(blocked, grant(intent, 1)),
    ).toThrow(TypeError);

    const paidGrant = grant(intent, 1, "editor-approved-paid");
    const retried = appendCandidatePassBArmedAttempt(
      issueCandidatePassBRetryGrant(blocked, paidGrant),
      {
        dispatchIntent: dispatch(1, "paid-direct", paidGrant.grantId),
        retryGrantId: paidGrant.grantId,
      },
    );
    expect(candidatePassBAttemptLedgerState(retried)).toBe("armed");
  });

  it("keeps a crash-before-arm grant reusable but consumes it for exactly one attempt", () => {
    const firstIntent = dispatch(0);
    const blocked = settleCandidatePassBAttempt(
      appendCandidatePassBArmedAttempt(
        createCandidatePassBAttemptLedger(CANDIDATE_ID),
        { dispatchIntent: firstIntent, retryGrantId: null },
      ),
      settlement(firstIntent, "outcome-unknown"),
    );
    const retryGrant = grant(firstIntent, 1);
    const grantedBeforeCrash = issueCandidatePassBRetryGrant(
      blocked,
      retryGrant,
    );

    expect(
      issueCandidatePassBRetryGrant(grantedBeforeCrash, retryGrant),
    ).toBe(grantedBeforeCrash);
    expect(() =>
      issueCandidatePassBRetryGrant(grantedBeforeCrash, {
        ...retryGrant,
        mode: "editor-approved-paid",
      }),
    ).toThrow(TypeError);

    const secondIntent = dispatch(1, "free-r2", retryGrant.grantId);
    const consumed = appendCandidatePassBArmedAttempt(grantedBeforeCrash, {
      dispatchIntent: secondIntent,
      retryGrantId: retryGrant.grantId,
    });
    const secondBlocked = settleCandidatePassBAttempt(
      consumed,
      settlement(secondIntent, "outcome-unknown"),
    );
    expect(() =>
      issueCandidatePassBRetryGrant(secondBlocked, retryGrant),
    ).toThrow(TypeError);
    expect(() =>
      appendCandidatePassBArmedAttempt(secondBlocked, {
        dispatchIntent: dispatch(2, "free-r2", retryGrant.grantId),
        retryGrantId: retryGrant.grantId,
      }),
    ).toThrow(TypeError);
  });

  it("rejects persisted ledgers whose grant mode and retry transport disagree", () => {
    const firstIntent = dispatch(0);
    const blocked = settleCandidatePassBAttempt(
      appendCandidatePassBArmedAttempt(
        createCandidatePassBAttemptLedger(CANDIDATE_ID),
        { dispatchIntent: firstIntent, retryGrantId: null },
      ),
      settlement(firstIntent, "outcome-unknown"),
    );
    const retryGrant = grant(firstIntent, 1);
    const valid = appendCandidatePassBArmedAttempt(
      issueCandidatePassBRetryGrant(blocked, retryGrant),
      {
        dispatchIntent: dispatch(1, "free-r2", retryGrant.grantId),
        retryGrantId: retryGrant.grantId,
      },
    );
    const tampered = {
      ...valid,
      attempts: [
        valid.attempts[0]!,
        {
          ...valid.attempts[1]!,
          dispatchIntent: {
            ...valid.attempts[1]!.dispatchIntent,
            transportMode: "paid-direct" as const,
          },
        },
      ],
    };
    expect(() => assertCandidatePassBAttemptLedger(tampered)).toThrow(
      TypeError,
    );
  });

  it("rejects an ungranted replacement and a divergent operation reuse", () => {
    const firstIntent = dispatch(0);
    const blocked = settleCandidatePassBAttempt(
      appendCandidatePassBArmedAttempt(
        createCandidatePassBAttemptLedger(CANDIDATE_ID),
        { dispatchIntent: firstIntent, retryGrantId: null },
      ),
      settlement(firstIntent, "outcome-unknown"),
    );
    expect(() =>
      appendCandidatePassBArmedAttempt(blocked, {
        dispatchIntent: dispatch(1),
        retryGrantId: "missing-grant",
      }),
    ).toThrow(TypeError);

    const tampered = {
      ...firstIntent,
      sourceEndMs: firstIntent.sourceEndMs + 1,
    };
    expect(() =>
      appendCandidatePassBArmedAttempt(
        appendCandidatePassBArmedAttempt(
          createCandidatePassBAttemptLedger(CANDIDATE_ID),
          { dispatchIntent: firstIntent, retryGrantId: null },
        ),
        { dispatchIntent: tampered, retryGrantId: null },
      ),
    ).toThrow(TypeError);
  });

  it("merges only append-only durable prefixes", () => {
    const initial = createCandidatePassBAttemptLedger(CANDIDATE_ID);
    const intent = dispatch(0);
    const armed = appendCandidatePassBArmedAttempt(initial, {
      dispatchIntent: intent,
      retryGrantId: null,
    });
    const completed = settleCandidatePassBAttempt(
      armed,
      settlement(intent, "completed"),
    );
    expect(mergeCandidatePassBAttemptLedgers(armed, completed)).toEqual(
      completed,
    );
    expect(mergeCandidatePassBAttemptLedgers(completed, armed)).toEqual(
      completed,
    );

    const divergent = {
      ...completed,
      attempts: [{
        ...completed.attempts[0]!,
        settlement: settlement(intent, "outcome-unknown"),
      }],
    };
    expect(mergeCandidatePassBAttemptLedgers(completed, divergent)).toBeNull();
    expect(() => assertCandidatePassBAttemptLedger(divergent)).not.toThrow();
  });
});
