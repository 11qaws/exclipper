import { parseBroadcastContextProxyResult } from "./broadcastContextDeepseekClient";
import type {
  BroadcastContextRequestInput,
  BroadcastContextResult,
} from "./broadcastContextProtocol";
import { MAX_BROADCAST_CONTEXT_CANDIDATES } from "./broadcastContextProtocol";

export interface PersistedBroadcastContextEnvelope {
  readonly resultPayload: unknown;
  readonly refinementLeadIds: readonly string[] | null;
  readonly fastRefinementLeadIds: readonly string[] | null;
  readonly contextCandidateIds: readonly string[] | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedUniqueCandidateIds(value: unknown): readonly string[] | null {
  const candidateIds = Array.isArray(value)
    ? value as unknown[]
    : null;
  if (
    candidateIds === null ||
    candidateIds.length > MAX_BROADCAST_CONTEXT_CANDIDATES ||
    !candidateIds.every(
      (candidateId) =>
        typeof candidateId === "string" &&
        candidateId.length > 0 &&
        candidateId.length <= 256,
    ) ||
    new Set(candidateIds).size !== candidateIds.length
  ) {
    return null;
  }
  return candidateIds.map((candidateId) => candidateId as string);
}

function legacyCandidateIds(resultPayload: unknown): readonly string[] | null {
  if (!isRecord(resultPayload) || !Array.isArray(resultPayload.annotations)) {
    return null;
  }
  const candidateIds = resultPayload.annotations.map((annotation) =>
    isRecord(annotation) ? annotation.candidateId : null,
  );
  return boundedUniqueCandidateIds(candidateIds);
}

export function unpackPersistedBroadcastContext(
  payload: unknown,
): PersistedBroadcastContextEnvelope {
  if (
    isRecord(payload) &&
    "result" in payload &&
    "refinementLeadIds" in payload &&
    Array.isArray(payload.refinementLeadIds) &&
    payload.refinementLeadIds.every((value) => typeof value === "string")
  ) {
    const fastRefinementLeadIds = "fastRefinementLeadIds" in payload
      ? payload.fastRefinementLeadIds
      : [];
    if (
      !Array.isArray(fastRefinementLeadIds) ||
      !fastRefinementLeadIds.every((value) => typeof value === "string")
    ) {
      return {
        resultPayload: payload,
        refinementLeadIds: null,
        fastRefinementLeadIds: null,
        contextCandidateIds: null,
      };
    }
    const explicitContextCandidateIds =
      "contextCandidateIds" in payload
        ? boundedUniqueCandidateIds(payload.contextCandidateIds)
        : null;
    return {
      resultPayload: payload.result,
      refinementLeadIds: payload.refinementLeadIds,
      fastRefinementLeadIds,
      contextCandidateIds:
        explicitContextCandidateIds ?? legacyCandidateIds(payload.result),
    };
  }
  return {
    resultPayload: payload,
    refinementLeadIds: null,
    fastRefinementLeadIds: null,
    contextCandidateIds: legacyCandidateIds(payload),
  };
}

/**
 * Revalidates a stored provider-shaped result against the exact source map.
 * Explicit legacy capability flags survive the validation pass; an old empty
 * array is not silently upgraded into proof that the feature ran and found 0.
 */
export function parsePersistedBroadcastContextResult(
  payload: unknown,
  input: BroadcastContextRequestInput,
): BroadcastContextResult | null {
  const parsed = parseBroadcastContextProxyResult(payload, input);
  if (parsed === null || !isRecord(payload)) {
    return parsed;
  }
  return {
    ...parsed,
    semanticChaptersSupported:
      typeof payload.semanticChaptersSupported === "boolean"
        ? payload.semanticChaptersSupported
        : parsed.semanticChaptersSupported,
    discoveredLeadsSupported:
      typeof payload.discoveredLeadsSupported === "boolean"
        ? payload.discoveredLeadsSupported
        : parsed.discoveredLeadsSupported,
  };
}
