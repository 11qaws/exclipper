import { describe, expect, it } from "vitest";

import {
  createCandidatePassBOperationId,
  type CandidatePassBOperationIdInput,
} from "./candidatePassBWorkerProtocol";
import { isCandidatePassBDispatchIntent } from "./candidateFinalVerification";
import {
  currentCandidatePassBContext,
  currentCandidatePassBDispatch,
} from "../testSupport/candidatePassBCurrentFixture";

const operationFence: CandidatePassBOperationIdInput = {
  analysisRunId: "analysis-run-1",
  sourceFingerprint: "source-fingerprint-1",
  candidateId: "candidate-1",
  sourceStartMs: 60_000,
  sourceEndMs: 105_000,
  contextFingerprint: "fnv1a64:0123456789abcdef",
  outputLanguage: "ko",
  castRosterId: null,
  routingModelRevision:
    "qwen3.5-omni-flash_then_gemini-3.6-flash_durable-multimodal-v9",
  attemptOrdinal: 0,
  retryGrantId: null,
  transportMode: "free-r2",
  providerPayloadDigest: `sha256:${"1".repeat(64)}`,
};

describe("Candidate Pass B current Worker protocol", () => {
  it("derives one deterministic operation ID from every dispatch fence", async () => {
    const first = await createCandidatePassBOperationId(operationFence);
    const second = await createCandidatePassBOperationId(operationFence);
    const retry = await createCandidatePassBOperationId({
      ...operationFence,
      attemptOrdinal: 1,
      retryGrantId: "retry-grant-1",
    });
    const paid = await createCandidatePassBOperationId({
      ...operationFence,
      transportMode: "paid-direct",
    });
    const english = await createCandidatePassBOperationId({
      ...operationFence,
      outputLanguage: "en",
    });
    const roster = await createCandidatePassBOperationId({
      ...operationFence,
      castRosterId: "chzzk-video-13996057-v2",
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^candidate-pass-b\.[0-9a-f]{48}$/u);
    expect(retry).not.toBe(first);
    expect(paid).not.toBe(first);
    expect(english).not.toBe(first);
    expect(roster).not.toBe(first);
  });

  it("requires retryGrantId and transportMode as exact current intent fields", () => {
    const dispatch = currentCandidatePassBDispatch(
      currentCandidatePassBContext(),
    );
    const withoutRetryGrant = { ...dispatch } as Record<string, unknown>;
    const withoutTransport = { ...dispatch } as Record<string, unknown>;
    const withoutLanguage = { ...dispatch } as Record<string, unknown>;
    const withoutRoster = { ...dispatch } as Record<string, unknown>;
    delete withoutRetryGrant.retryGrantId;
    delete withoutTransport.transportMode;
    delete withoutLanguage.outputLanguage;
    delete withoutRoster.castRosterId;

    expect(isCandidatePassBDispatchIntent(dispatch)).toBe(true);
    expect(isCandidatePassBDispatchIntent(withoutRetryGrant)).toBe(false);
    expect(isCandidatePassBDispatchIntent(withoutTransport)).toBe(false);
    expect(isCandidatePassBDispatchIntent(withoutLanguage)).toBe(false);
    expect(isCandidatePassBDispatchIntent(withoutRoster)).toBe(false);
    expect(
      isCandidatePassBDispatchIntent({
        ...dispatch,
        attemptOrdinal: 1,
        retryGrantId: null,
      }),
    ).toBe(false);
  });
});
