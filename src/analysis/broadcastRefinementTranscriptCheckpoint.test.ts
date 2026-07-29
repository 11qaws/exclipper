import { describe, expect, it } from "vitest";

import {
  MAX_BROADCAST_REFINEMENT_TRANSCRIPT_CHECKPOINT_BYTES,
  broadcastRefinementTranscriptCheckpointCanComplete,
  broadcastRefinementTranscriptCheckpointMatchesInput,
  createBroadcastRefinementTranscriptCheckpoint,
  mergeBroadcastRefinementTranscriptCheckpoints,
  parseBroadcastRefinementTranscriptCheckpointJson,
  recordBroadcastRefinementTranscriptAbstention,
  recordBroadcastRefinementTranscriptGap,
  recordBroadcastRefinementTranscriptSuccess,
  serializeBroadcastRefinementTranscriptCheckpoint,
  type BroadcastRefinementTranscriptCheckpoint,
} from "./broadcastRefinementTranscriptCheckpoint";
import {
  BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
  BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
  BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION,
  MAX_BROADCAST_TRANSCRIPT_QWEN_TEXT_LENGTH,
} from "./broadcastTranscriptQwen";
import type { BroadcastTranscriptVerifiedResult } from "./broadcastTranscriptRouteManifest";
import type { BroadcastContextTranscriptionChunk } from "./broadcastContextSamplingPlan";
import { createVerifiedNoSpeechRunReceiptForTest } from "../testSupport/broadcastSpeechActivityTestReceipt";

const plannedChunks: readonly BroadcastContextTranscriptionChunk[] = [
  {
    chunkId: "refine-002",
    sourceStartMs: 60_000,
    sourceEndMs: 120_000,
    kind: "event",
  },
  {
    chunkId: "refine-001",
    sourceStartMs: 0,
    sourceEndMs: 60_000,
    kind: "event",
  },
];

function resultFor(
  chunk: BroadcastContextTranscriptionChunk,
  textKo = "스트리머가 음식 맛을 설명한다.",
): BroadcastTranscriptVerifiedResult {
  return {
    schemaVersion: BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION,
    modelId: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
    modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
    providerReceipt: {
      schemaVersion: "1.0.0",
      routeManifestFingerprint: `sha256:${"1".repeat(64)}`,
      provider: "qwen",
      modelId: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
      modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
      fallbackUsed: false,
    },
    sourceStartMs: chunk.sourceStartMs,
    sourceEndMs: chunk.sourceEndMs,
    textKo,
    detectedLanguage: "ko",
    emotion: null,
    billedSeconds: 60,
  };
}

describe("broadcastRefinementTranscriptCheckpoint", () => {
  it("represents an exact empty refinement plan as durably complete", () => {
    const checkpoint = createBroadcastRefinementTranscriptCheckpoint({
      refinementInputSignature: "refinement-empty-v1",
      plannedChunks: [],
    });

    expect(broadcastRefinementTranscriptCheckpointCanComplete(checkpoint)).toBe(
      true,
    );
    expect(
      parseBroadcastRefinementTranscriptCheckpointJson(
        serializeBroadcastRefinementTranscriptCheckpoint(checkpoint),
      ),
    ).toEqual(checkpoint);
  });

  it("canonically freezes exact planned ranges and round-trips partial settlements", () => {
    let checkpoint = createBroadcastRefinementTranscriptCheckpoint({
      refinementInputSignature: "refinement-input-v1",
      plannedChunks,
    });
    expect(checkpoint.plannedChunks.map(({ chunkId }) => chunkId)).toEqual([
      "refine-001",
      "refine-002",
    ]);

    checkpoint = recordBroadcastRefinementTranscriptGap(checkpoint, {
      chunkId: "refine-002",
      reason: "transcription-failed",
      attemptCount: 2,
    });
    checkpoint = recordBroadcastRefinementTranscriptSuccess(
      checkpoint,
      "refine-001",
      resultFor(plannedChunks[1] as BroadcastContextTranscriptionChunk),
    );

    const serialized =
      serializeBroadcastRefinementTranscriptCheckpoint(checkpoint);
    expect(parseBroadcastRefinementTranscriptCheckpointJson(serialized)).toEqual(
      checkpoint,
    );
    expect(
      broadcastRefinementTranscriptCheckpointMatchesInput(checkpoint, {
        refinementInputSignature: "refinement-input-v1",
        plannedChunks: [...plannedChunks].reverse(),
      }),
    ).toBe(true);
    expect(broadcastRefinementTranscriptCheckpointCanComplete(checkpoint)).toBe(
      false,
    );
  });

  it("replaces only one planned chunk settlement and completes on success or abstention", () => {
    let checkpoint = createBroadcastRefinementTranscriptCheckpoint({
      refinementInputSignature: "refinement-input-v1",
      plannedChunks,
    });
    checkpoint = recordBroadcastRefinementTranscriptGap(checkpoint, {
      chunkId: "refine-001",
      reason: "in-flight",
      attemptCount: 1,
    });
    checkpoint = recordBroadcastRefinementTranscriptSuccess(
      checkpoint,
      "refine-001",
      resultFor(plannedChunks[1] as BroadcastContextTranscriptionChunk),
    );
    checkpoint = recordBroadcastRefinementTranscriptAbstention(
      checkpoint,
      "refine-002",
      "no-speech",
      createVerifiedNoSpeechRunReceiptForTest(120_000, 60_000, 120_000),
    );

    expect(checkpoint.gaps).toEqual([]);
    expect(checkpoint.successfulFragments).toHaveLength(1);
    expect(checkpoint.abstentions).toEqual([
      expect.objectContaining({
        chunkId: "refine-002",
        reason: "no-speech",
      }),
    ]);
    expect(broadcastRefinementTranscriptCheckpointCanComplete(checkpoint)).toBe(
      true,
    );
  });

  it("monotonically merges concurrent cells without regressing terminal evidence", () => {
    const empty = createBroadcastRefinementTranscriptCheckpoint({
      refinementInputSignature: "refinement-input-v1",
      plannedChunks,
    });
    const durable = recordBroadcastRefinementTranscriptSuccess(
      recordBroadcastRefinementTranscriptGap(empty, {
        chunkId: "refine-002",
        reason: "rate-limited",
        attemptCount: 9,
      }),
      "refine-001",
      resultFor(plannedChunks[1] as BroadcastContextTranscriptionChunk),
    );
    const stalePending = recordBroadcastRefinementTranscriptGap(
      recordBroadcastRefinementTranscriptGap(empty, {
        chunkId: "refine-001",
        reason: "in-flight",
        attemptCount: 8,
      }),
      {
        chunkId: "refine-002",
        reason: "transcription-failed",
        attemptCount: 4,
      },
    );

    const merged = mergeBroadcastRefinementTranscriptCheckpoints(
      durable,
      stalePending,
    );

    expect(merged.successfulFragments).toEqual(
      durable.successfulFragments,
    );
    expect(merged.gaps).toEqual([
      {
        chunkId: "refine-002",
        reason: "rate-limited",
        attemptCount: 9,
      },
    ]);
  });

  it("rejects a successful transcript whose range was moved or whose plan was tampered", () => {
    let checkpoint = createBroadcastRefinementTranscriptCheckpoint({
      refinementInputSignature: "refinement-input-v1",
      plannedChunks,
    });
    checkpoint = recordBroadcastRefinementTranscriptSuccess(
      checkpoint,
      "refine-001",
      resultFor(plannedChunks[1] as BroadcastContextTranscriptionChunk),
    );

    const movedResult: BroadcastRefinementTranscriptCheckpoint = {
      ...checkpoint,
      successfulFragments: checkpoint.successfulFragments.map((fragment) => ({
        ...fragment,
        result: {
          ...fragment.result,
          sourceStartMs: fragment.result.sourceStartMs + 1,
        },
      })),
    };
    expect(() =>
      serializeBroadcastRefinementTranscriptCheckpoint(movedResult),
    ).toThrow(TypeError);

    expect(
      broadcastRefinementTranscriptCheckpointMatchesInput(checkpoint, {
        refinementInputSignature: "refinement-input-v1",
        plannedChunks: plannedChunks.map((chunk, index) =>
          index === 0
            ? { ...chunk, sourceEndMs: chunk.sourceEndMs - 1 }
            : chunk,
        ),
      }),
    ).toBe(false);
  });

  it("rejects non-canonical, duplicate, foreign, and malformed outcome records", () => {
    const checkpoint = createBroadcastRefinementTranscriptCheckpoint({
      refinementInputSignature: "refinement-input-v1",
      plannedChunks,
    });
    const canonical =
      serializeBroadcastRefinementTranscriptCheckpoint(checkpoint);
    expect(
      parseBroadcastRefinementTranscriptCheckpointJson(` ${canonical}`),
    ).toBeNull();

    const duplicate = {
      ...checkpoint,
      abstentions: [
        {
          chunkId: "refine-001",
          reason: "no-audio",
          speechActivityReceipt: null,
        },
        {
          chunkId: "refine-001",
          reason: "no-speech",
          speechActivityReceipt: createVerifiedNoSpeechRunReceiptForTest(
            120_000,
            0,
            60_000,
          ),
        },
      ],
    } as BroadcastRefinementTranscriptCheckpoint;
    expect(() =>
      serializeBroadcastRefinementTranscriptCheckpoint(duplicate),
    ).toThrow(TypeError);

    expect(() =>
      recordBroadcastRefinementTranscriptGap(checkpoint, {
        chunkId: "foreign-chunk",
        reason: "rate-limited",
        attemptCount: 1,
      }),
    ).toThrow(TypeError);
    expect(() =>
      recordBroadcastRefinementTranscriptGap(checkpoint, {
        chunkId: "refine-001",
        reason: "rate-limited",
        attemptCount: 0,
      }),
    ).toThrow(TypeError);

    const recordWithoutReceipt =
      recordBroadcastRefinementTranscriptAbstention as unknown as (
        current: BroadcastRefinementTranscriptCheckpoint,
        chunkId: string,
        reason: "no-speech",
      ) => BroadcastRefinementTranscriptCheckpoint;
    expect(() =>
      recordWithoutReceipt(checkpoint, "refine-001", "no-speech"),
    ).toThrow(TypeError);
  });

  it("enforces the checkpoint ceiling using UTF-8 bytes", () => {
    const manyChunks = Array.from({ length: 40 }, (_, index) => ({
      chunkId: `refine-${String(index + 1).padStart(3, "0")}`,
      sourceStartMs: index * 60_000,
      sourceEndMs: (index + 1) * 60_000,
      kind: "event" as const,
    }));
    let oversized = createBroadcastRefinementTranscriptCheckpoint({
      refinementInputSignature: "refinement-input-v1",
      plannedChunks: manyChunks,
    });
    for (const chunk of manyChunks) {
      oversized = recordBroadcastRefinementTranscriptSuccess(
        oversized,
        chunk.chunkId,
        resultFor(
          chunk,
          "가".repeat(MAX_BROADCAST_TRANSCRIPT_QWEN_TEXT_LENGTH),
        ),
      );
    }
    const raw = JSON.stringify(oversized);
    expect(raw.length).toBeLessThan(
      MAX_BROADCAST_REFINEMENT_TRANSCRIPT_CHECKPOINT_BYTES,
    );
    expect(new TextEncoder().encode(raw).byteLength).toBeGreaterThan(
      MAX_BROADCAST_REFINEMENT_TRANSCRIPT_CHECKPOINT_BYTES,
    );
    expect(() =>
      serializeBroadcastRefinementTranscriptCheckpoint(oversized),
    ).toThrow(RangeError);
    expect(parseBroadcastRefinementTranscriptCheckpointJson(raw)).toBeNull();
  });
});
