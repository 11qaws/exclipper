import { describe, expect, it } from "vitest";

import {
  AI_MODEL_ROUTING_POLICY_VERSION,
} from "../analysis/aiModelRoutingPolicy";
import {
  createBroadcastTranscriptChapters,
} from "../analysis/broadcastTranscriptChapters";
import type { BroadcastContextTranscriptionChunk } from "../analysis/broadcastContextSamplingPlan";
import {
  BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
  BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
  BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION,
  MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS,
} from "../analysis/broadcastTranscriptQwen";
import {
  broadcastTranscriptProviderReceiptCheckpointModelRevision,
  createBroadcastTranscriptProviderReceiptCheckpoint,
  recordBroadcastTranscriptProviderReceipt,
  serializeBroadcastTranscriptProviderReceiptCheckpoint,
} from "../analysis/broadcastTranscriptProviderReceiptCheckpoint";
import {
  createBroadcastTranscriptResolvedEvidenceCheckpoint,
  serializeBroadcastTranscriptResolvedEvidenceCheckpoint,
} from "../analysis/broadcastTranscriptResolvedEvidence";
import {
  BROADCAST_TRANSCRIPT_HEALTH_SERVICE_VERSION,
  BROADCAST_TRANSCRIPT_PRIMARY_MEDIA_TYPE,
  BROADCAST_TRANSCRIPT_PROVIDER_CONFIGURATION_VERSION,
  BROADCAST_TRANSCRIPT_ROUTE_MANIFEST_SCHEMA_VERSION,
  BROADCAST_TRANSCRIPT_TRANSPORT_VERSION,
  createBroadcastTranscriptProviderReceipt,
  createBroadcastTranscriptRouteSelection,
  type BroadcastTranscriptRouteManifest,
  type BroadcastTranscriptVerifiedResult,
} from "../analysis/broadcastTranscriptRouteManifest";
import {
  BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
  type BroadcastContextSessionRecord,
  type StoredBroadcastTranscriptGap,
} from "../storage/broadcastContextSessionStore";
import {
  broadcastTranscriptGapCanAutomaticallyRetry,
  broadcastTranscriptGapRequiresExplicitPaidRetry,
  broadcastTranscriptSessionCheckpointIncludes,
  mergeBroadcastTranscriptSessionCheckpoints,
  selectRunnableBroadcastTranscriptChunks,
} from "./broadcastTranscriptCheckpointMerge";

const sourceFingerprint = `sha256:${"a".repeat(64)}`;
const transcriptInputSignature = `sha256:${"b".repeat(64)}`;
const sourceDurationMs = 60_000;
const plan: readonly BroadcastContextTranscriptionChunk[] = [
  {
    chunkId: "asr-a",
    sourceStartMs: 0,
    sourceEndMs: 30_000,
    kind: "uniform",
  },
  {
    chunkId: "asr-b",
    sourceStartMs: 30_000,
    sourceEndMs: 60_000,
    kind: "uniform",
  },
];

async function route() {
  const manifest: BroadcastTranscriptRouteManifest = {
    schemaVersion: BROADCAST_TRANSCRIPT_ROUTE_MANIFEST_SCHEMA_VERSION,
    serviceVersion: BROADCAST_TRANSCRIPT_HEALTH_SERVICE_VERSION,
    routingPolicyVersion: AI_MODEL_ROUTING_POLICY_VERSION,
    providerConfigurationVersion:
      BROADCAST_TRANSCRIPT_PROVIDER_CONFIGURATION_VERSION,
    transportVersion: BROADCAST_TRANSCRIPT_TRANSPORT_VERSION,
    transportMode: "free-r2",
    maximumChunkDurationMs: MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS,
    primaryMediaType: BROADCAST_TRANSCRIPT_PRIMARY_MEDIA_TYPE,
    provider: "qwen",
    modelId: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
    modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
    effectiveFallback: { mode: "disabled" },
  };
  return createBroadcastTranscriptRouteSelection(manifest);
}

function resultFor(
  chunk: BroadcastContextTranscriptionChunk,
  selectedRoute: Awaited<ReturnType<typeof route>>,
): BroadcastTranscriptVerifiedResult {
  const providerReceipt = createBroadcastTranscriptProviderReceipt(
    selectedRoute,
    BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
    BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
    false,
  );
  return {
    schemaVersion: BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION,
    modelId: providerReceipt.modelId,
    modelRevision: providerReceipt.modelRevision,
    providerReceipt,
    sourceStartMs: chunk.sourceStartMs,
    sourceEndMs: chunk.sourceEndMs,
    textKo: `${chunk.chunkId} 구간에서 스트리머가 상황을 설명했다.`,
    detectedLanguage: "ko",
    emotion: null,
    billedSeconds: 30,
  };
}

async function sessionFor(input: {
  readonly successfulChunkIds?: readonly string[];
  readonly gaps?: readonly StoredBroadcastTranscriptGap[];
  readonly recordedAt: string;
}): Promise<BroadcastContextSessionRecord> {
  const selectedRoute = await route();
  const successfulChunkIds = new Set(input.successfulChunkIds ?? []);
  const results = plan
    .filter(({ chunkId }) => successfulChunkIds.has(chunkId))
    .map((chunk) => resultFor(chunk, selectedRoute));
  let provider = createBroadcastTranscriptProviderReceiptCheckpoint({
    sourceFingerprint,
    sourceDurationMs,
    route: selectedRoute,
    plannedCells: plan,
  });
  for (const result of results) {
    const chunk = plan.find(
      ({ sourceStartMs }) => sourceStartMs === result.sourceStartMs,
    );
    if (chunk === undefined) throw new Error("Missing test chunk.");
    provider = recordBroadcastTranscriptProviderReceipt(
      provider,
      chunk.chunkId,
      result,
    );
  }
  const modelRevision =
    broadcastTranscriptProviderReceiptCheckpointModelRevision(provider);
  const evidence = createBroadcastTranscriptResolvedEvidenceCheckpoint({
    sourceFingerprint,
    sourceDurationMs,
    transcriptInputSignature,
    modelRevision,
    plannedCells: plan,
  });
  const gaps = input.gaps ?? [];
  return {
    kind: "broadcastContextSession",
    runId: "run-main-merge",
    schemaVersion: BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
    inputSignature: sourceFingerprint,
    sourceDurationMs,
    completeAudioCoverage: false,
    chapters: createBroadcastTranscriptChapters(
      results,
      sourceDurationMs,
      false,
    ),
    gapChunkIds: gaps.map(({ chunkId }) => chunkId),
    fragmentGaps: gaps,
    transcriptEvidenceInputSignature: transcriptInputSignature,
    transcriptEvidenceCheckpointJson:
      serializeBroadcastTranscriptResolvedEvidenceCheckpoint(evidence),
    transcriptVisualInspectionCheckpointJson: null,
    transcriptProviderReceiptInputSignature:
      provider.routeManifestFingerprint,
    transcriptProviderReceiptCheckpointJson:
      serializeBroadcastTranscriptProviderReceiptCheckpoint(provider),
    modelRevision,
    sourceCastRosterId: null,
    transcriptSealOperationKey: null,
    participantGroundingInputSignature: null,
    participantGroundingPlanFingerprint: null,
    participantGroundingCheckpointJson: null,
    contextInputSignature: null,
    contextInputCheckpointJson: null,
    contextPhaseLedgerJson: null,
    contextResultJson: null,
    refinementTranscriptInputSignature: null,
    refinementTranscriptCheckpointJson: null,
    refinementEvidenceLedgerJson: null,
    refinementInputSignature: null,
    refinementCandidatesJson: null,
    recordedAt: input.recordedAt,
  };
}

describe("main transcript checkpoint recovery", () => {
  it("separates 190 paid ambiguities from 10 safe cells while free ASR resumes all 200", () => {
    const chunks = Array.from({ length: 200 }, (_, index) => ({
      chunkId: `asr-${String(index + 1).padStart(3, "0")}`,
      sourceStartMs: index * 30_000,
      sourceEndMs: (index + 1) * 30_000,
      kind: "uniform" as const,
    }));
    const gaps: StoredBroadcastTranscriptGap[] = chunks.map(
      (chunk, index) => ({
        chunkId: chunk.chunkId,
        sourceStartMs: chunk.sourceStartMs,
        sourceEndMs: chunk.sourceEndMs,
        reason: index < 190 ? "in-flight" : "pending",
        attemptCount: index < 190 ? 1 : 0,
      }),
    );

    expect(
      selectRunnableBroadcastTranscriptChunks(chunks, gaps, {
        transportMode: "paid-direct",
        allowPaidAmbiguousRetry: false,
      }).map(({ chunkId }) => chunkId),
    ).toEqual(chunks.slice(190).map(({ chunkId }) => chunkId));
    expect(
      selectRunnableBroadcastTranscriptChunks(chunks, gaps, {
        transportMode: "paid-direct",
        allowPaidAmbiguousRetry: true,
      }),
    ).toHaveLength(200);
    expect(
      selectRunnableBroadcastTranscriptChunks(chunks, gaps, {
        transportMode: "free-r2",
        allowPaidAmbiguousRetry: false,
      }),
    ).toHaveLength(200);
    expect(
      broadcastTranscriptGapRequiresExplicitPaidRetry(
        gaps[0] as StoredBroadcastTranscriptGap,
        "paid-direct",
      ),
    ).toBe(true);
    expect(
      broadcastTranscriptGapCanAutomaticallyRetry(
        gaps[0] as StoredBroadcastTranscriptGap,
        "paid-direct",
      ),
    ).toBe(false);
    expect(
      broadcastTranscriptGapCanAutomaticallyRetry(
        gaps[0] as StoredBroadcastTranscriptGap,
        "free-r2",
      ),
    ).toBe(true);
    expect(
      broadcastTranscriptGapRequiresExplicitPaidRetry(
        gaps[0] as StoredBroadcastTranscriptGap,
        "free-r2",
      ),
    ).toBe(false);
  });

  it("does not let a late stale checkpoint erase a terminal cell or newer gap", async () => {
    const durable = await sessionFor({
      successfulChunkIds: ["asr-a"],
      gaps: [
        {
          chunkId: "asr-b",
          sourceStartMs: 30_000,
          sourceEndMs: 60_000,
          reason: "rate-limited",
          attemptCount: 9,
        },
      ],
      recordedAt: "2026-07-29T00:00:02.000Z",
    });
    const stalePending = await sessionFor({
      gaps: [
        {
          chunkId: "asr-a",
          sourceStartMs: 0,
          sourceEndMs: 30_000,
          reason: "in-flight",
          attemptCount: 8,
        },
        {
          chunkId: "asr-b",
          sourceStartMs: 30_000,
          sourceEndMs: 60_000,
          reason: "transcription-failed",
          attemptCount: 4,
        },
      ],
      recordedAt: "2026-07-29T00:00:03.000Z",
    });

    const merged = mergeBroadcastTranscriptSessionCheckpoints(
      durable,
      stalePending,
    );

    expect(merged).not.toBeNull();
    expect(merged?.chapters).toHaveLength(1);
    expect(merged?.fragmentGaps).toEqual(durable.fragmentGaps);
    expect(
      broadcastTranscriptSessionCheckpointIncludes(
        merged as BroadcastContextSessionRecord,
        stalePending,
      ),
    ).toBe(true);
  });

  it("unions independently completed cells into one terminal checkpoint", async () => {
    const left = await sessionFor({
      successfulChunkIds: ["asr-a"],
      gaps: [
        {
          chunkId: "asr-b",
          sourceStartMs: 30_000,
          sourceEndMs: 60_000,
          reason: "rate-limited",
          attemptCount: 3,
        },
      ],
      recordedAt: "2026-07-29T00:00:02.000Z",
    });
    const right = await sessionFor({
      successfulChunkIds: ["asr-b"],
      gaps: [
        {
          chunkId: "asr-a",
          sourceStartMs: 0,
          sourceEndMs: 30_000,
          reason: "transcription-failed",
          attemptCount: 3,
        },
      ],
      recordedAt: "2026-07-29T00:00:03.000Z",
    });

    const merged = mergeBroadcastTranscriptSessionCheckpoints(left, right);

    expect(merged?.fragmentGaps).toEqual([]);
    expect(merged?.chapters).toHaveLength(2);
    expect(merged?.transcriptSealOperationKey).toBe(
      transcriptInputSignature,
    );
  });
});
