import { parseBroadcastContextProxyResult } from "./broadcastContextDeepseekClient";
import type {
  BroadcastContextRequestInput,
  BroadcastContextResult,
} from "./broadcastContextProtocol";

export interface PersistedBroadcastContextEnvelope {
  readonly resultPayload: unknown;
  readonly refinementLeadIds: readonly string[] | null;
  readonly fastRefinementLeadIds: readonly string[] | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
      };
    }
    return {
      resultPayload: payload.result,
      refinementLeadIds: payload.refinementLeadIds,
      fastRefinementLeadIds,
    };
  }
  return {
    resultPayload: payload,
    refinementLeadIds: null,
    fastRefinementLeadIds: null,
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
