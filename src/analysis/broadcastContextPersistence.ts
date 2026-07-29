import { parseBroadcastContextProxyResult } from "./broadcastContextDeepseekClient";
import type {
  BroadcastContextRequestInput,
  BroadcastContextResult,
} from "./broadcastContextProtocol";
import {
  MAX_BROADCAST_CONTEXT_CANDIDATES,
  MAX_BROADCAST_CONTEXT_DISCOVERED_LEADS,
} from "./broadcastContextProtocol";

export const BROADCAST_CONTEXT_PERSISTENCE_SCHEMA_VERSION = "1.2.0" as const;

export interface CurrentPersistedBroadcastContextEnvelope {
  readonly resultPayload: unknown;
  readonly refinementLeadIds: readonly string[];
  readonly fastRefinementLeadIds: readonly string[];
  readonly contextCandidateIds: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function boundedUniqueIds(
  value: unknown,
  maximumCount: number,
): readonly string[] | null {
  const ids = Array.isArray(value)
    ? value as unknown[]
    : null;
  if (
    ids === null ||
    ids.length > maximumCount ||
    !ids.every(
      (id) =>
        typeof id === "string" &&
        id.length > 0 &&
        id.length <= 256 &&
        id.trim() === id &&
        !/[\p{Cc}\p{Cf}]/u.test(id),
    ) ||
    new Set(ids).size !== ids.length
  ) {
    return null;
  }
  return ids.map((id) => id as string);
}

export function unpackPersistedBroadcastContext(
  payload: unknown,
): CurrentPersistedBroadcastContextEnvelope | null {
  if (
    !isRecord(payload) ||
    !hasExactKeys(payload, [
      "schemaVersion",
      "result",
      "refinementLeadIds",
      "fastRefinementLeadIds",
      "contextCandidateIds",
    ]) ||
    payload.schemaVersion !== BROADCAST_CONTEXT_PERSISTENCE_SCHEMA_VERSION ||
    !isRecord(payload.result)
  ) {
    return null;
  }
  const refinementLeadIds = boundedUniqueIds(
    payload.refinementLeadIds,
    MAX_BROADCAST_CONTEXT_DISCOVERED_LEADS,
  );
  const fastRefinementLeadIds = boundedUniqueIds(
    payload.fastRefinementLeadIds,
    MAX_BROADCAST_CONTEXT_DISCOVERED_LEADS,
  );
  const contextCandidateIds = boundedUniqueIds(
    payload.contextCandidateIds,
    MAX_BROADCAST_CONTEXT_CANDIDATES,
  );
  if (
    refinementLeadIds === null ||
    fastRefinementLeadIds === null ||
    contextCandidateIds === null ||
    fastRefinementLeadIds.some(
      (leadId) => !refinementLeadIds.includes(leadId),
    )
  ) {
    return null;
  }
  return Object.freeze({
    resultPayload: payload.result,
    refinementLeadIds,
    fastRefinementLeadIds,
    contextCandidateIds,
  });
}

/**
 * Revalidates the current stored provider result against the exact source map.
 * Compatibility flags are intentionally not inferred or restored.
 */
export function parsePersistedBroadcastContextResult(
  payload: unknown,
  input: BroadcastContextRequestInput,
): BroadcastContextResult | null {
  return parseBroadcastContextProxyResult(payload, input);
}
