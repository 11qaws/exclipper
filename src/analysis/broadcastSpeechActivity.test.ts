import { describe, expect, it } from "vitest";

import {
  BROADCAST_SPEECH_ACTIVITY_CELL_DURATION_MS,
  BROADCAST_SPEECH_ACTIVITY_CONFIDENCE_THRESHOLD,
  BROADCAST_SPEECH_ACTIVITY_INPUT_SAMPLE_COUNT,
  BROADCAST_SPEECH_ACTIVITY_MAX_SOURCE_DURATION_MS,
  BROADCAST_SPEECH_ACTIVITY_MODEL_DTYPE,
  BROADCAST_SPEECH_ACTIVITY_MODEL_ID,
  BROADCAST_SPEECH_ACTIVITY_MODEL_MANIFEST,
  BROADCAST_SPEECH_ACTIVITY_MODEL_REVISION,
  BROADCAST_SPEECH_ACTIVITY_NO_SPEAKER_CLASS_ID,
  BROADCAST_SPEECH_ACTIVITY_OUTPUT_CLASS_COUNT,
  BROADCAST_SPEECH_ACTIVITY_SAMPLE_RATE_HZ,
  BROADCAST_SPEECH_ACTIVITY_SPEECH_CLASS_IDS,
  BROADCAST_SPEECH_ACTIVITY_TRANSFORMERS_JS_VERSION,
  aggregateBroadcastSpeechActivityCoverage,
  broadcastSpeechActivityCanSkipAsr,
  createBroadcastSpeechActivityGapReceipt,
  createBroadcastSpeechActivityPlan,
  createBroadcastSpeechActivityRunReceipt,
  isBroadcastSpeechActivityRunReceipt,
  mapBroadcastSpeechActivityFrameToSourceRange,
  normalizeBroadcastSpeechActivityPlan,
  normalizeBroadcastSpeechActivityRunReceipt,
  postprocessBroadcastSpeechActivityLogits,
  type BroadcastSpeechActivityCellPlan,
  type BroadcastSpeechActivityCompletedCellReceipt,
} from "./broadcastSpeechActivity";

function plannedCell(
  sourceDurationMs = 10_000,
  ordinal = 0,
): BroadcastSpeechActivityCellPlan {
  const cell = createBroadcastSpeechActivityPlan(sourceDurationMs).cells[ordinal];
  if (cell === undefined) {
    throw new Error("Speech-activity fixture cell is missing.");
  }
  return cell;
}

function logitsForWinner(
  winnerClassId: number,
  winnerProbability = 0.95,
): readonly number[] {
  const otherProbability =
    (1 - winnerProbability) /
    (BROADCAST_SPEECH_ACTIVITY_OUTPUT_CLASS_COUNT - 1);
  return Array.from(
    { length: BROADCAST_SPEECH_ACTIVITY_OUTPUT_CLASS_COUNT },
    (_, classId) =>
      Math.log(
        classId === winnerClassId
          ? winnerProbability
          : otherProbability,
      ),
  );
}

function completed(
  cell: BroadcastSpeechActivityCellPlan,
  outcome: "speech" | "no-speech" | "inconclusive",
  operationId = `vad:${cell.ordinal}`,
): BroadcastSpeechActivityCompletedCellReceipt {
  const noSpeaker = logitsForWinner(
    BROADCAST_SPEECH_ACTIVITY_NO_SPEAKER_CLASS_ID,
  );
  const speech = logitsForWinner(1);
  const inconclusive = Array.from(
    { length: BROADCAST_SPEECH_ACTIVITY_OUTPUT_CLASS_COUNT },
    () => 0,
  );
  return postprocessBroadcastSpeechActivityLogits({
    operationId,
    attemptOrdinal: 0,
    runtime: "wasm",
    cell,
    logits:
      outcome === "no-speech"
        ? [noSpeaker, noSpeaker, noSpeaker, noSpeaker]
        : outcome === "speech"
          ? [speech, speech, speech, speech]
          : [inconclusive, inconclusive, inconclusive, inconclusive],
  });
}

describe("broadcast speech-activity contract", () => {
  it("pins the exact Transformers.js model and class semantics", () => {
    expect(BROADCAST_SPEECH_ACTIVITY_MODEL_MANIFEST).toEqual({
      library: "@huggingface/transformers",
      libraryVersion: BROADCAST_SPEECH_ACTIVITY_TRANSFORMERS_JS_VERSION,
      modelId: BROADCAST_SPEECH_ACTIVITY_MODEL_ID,
      revision: BROADCAST_SPEECH_ACTIVITY_MODEL_REVISION,
      dtype: BROADCAST_SPEECH_ACTIVITY_MODEL_DTYPE,
      sampleRateHz: BROADCAST_SPEECH_ACTIVITY_SAMPLE_RATE_HZ,
      channelCount: 1,
      cellDurationMs: BROADCAST_SPEECH_ACTIVITY_CELL_DURATION_MS,
      inputSampleCount: BROADCAST_SPEECH_ACTIVITY_INPUT_SAMPLE_COUNT,
      outputClassCount: BROADCAST_SPEECH_ACTIVITY_OUTPUT_CLASS_COUNT,
      noSpeakerClassId: 0,
      speechClassIds: BROADCAST_SPEECH_ACTIVITY_SPEECH_CLASS_IDS,
    });
    expect(BROADCAST_SPEECH_ACTIVITY_MODEL_ID).toBe(
      "onnx-community/pyannote-segmentation-3.0",
    );
    expect(BROADCAST_SPEECH_ACTIVITY_MODEL_REVISION).toBe(
      "733a93b6473d019a773298e08cefa686894b1854",
    );
    expect(BROADCAST_SPEECH_ACTIVITY_MODEL_DTYPE).toBe("q8");
    expect(BROADCAST_SPEECH_ACTIVITY_SAMPLE_RATE_HZ).toBe(16_000);
    expect(BROADCAST_SPEECH_ACTIVITY_SPEECH_CLASS_IDS).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(BROADCAST_SPEECH_ACTIVITY_CONFIDENCE_THRESHOLD).toBe(0.8);
  });

  it("plans gapless ten-second cells for the full twelve-hour boundary", () => {
    const plan = createBroadcastSpeechActivityPlan(
      BROADCAST_SPEECH_ACTIVITY_MAX_SOURCE_DURATION_MS,
    );

    expect(plan.cells).toHaveLength(4_320);
    expect(plan.cells[0]).toEqual({
      cellId: "speech-0-7ps",
      ordinal: 0,
      sourceStartMs: 0,
      sourceEndMs: 10_000,
      validDurationMs: 10_000,
      validSampleCount: 160_000,
      paddedSampleCount: 0,
    });
    expect(plan.cells.at(-1)?.sourceEndMs).toBe(
      BROADCAST_SPEECH_ACTIVITY_MAX_SOURCE_DURATION_MS,
    );
    expect(
      plan.cells.every(
        (cell, index) =>
          cell.ordinal === index &&
          cell.sourceStartMs === index * 10_000 &&
          cell.sourceEndMs - cell.sourceStartMs === 10_000,
      ),
    ).toBe(true);
    expect(normalizeBroadcastSpeechActivityPlan(plan)).toEqual(plan);
  });

  it("records only metadata needed to pad a final partial PCM cell", () => {
    const plan = createBroadcastSpeechActivityPlan(25_001);
    const tail = plan.cells[2];

    expect(tail).toEqual({
      cellId: "speech-ffk-jah",
      ordinal: 2,
      sourceStartMs: 20_000,
      sourceEndMs: 25_001,
      validDurationMs: 5_001,
      validSampleCount: 80_016,
      paddedSampleCount: 79_984,
    });
    expect(
      plan.cells.reduce(
        (sum, cell) => sum + cell.validDurationMs,
        0,
      ),
    ).toBe(25_001);
  });

  it("plans an absolute ASR source fence without losing source-time identity", () => {
    const plan = createBroadcastSpeechActivityPlan(180_000, {
      sourceStartMs: 95_000,
      sourceEndMs: 116_500,
    });

    expect(plan).toMatchObject({
      sourceDurationMs: 180_000,
      sourceStartMs: 95_000,
      sourceEndMs: 116_500,
      plannedDurationMs: 21_500,
    });
    expect(
      plan.cells.map(({ sourceStartMs, sourceEndMs, validDurationMs }) => ({
        sourceStartMs,
        sourceEndMs,
        validDurationMs,
      })),
    ).toEqual([
      {
        sourceStartMs: 95_000,
        sourceEndMs: 105_000,
        validDurationMs: 10_000,
      },
      {
        sourceStartMs: 105_000,
        sourceEndMs: 115_000,
        validDurationMs: 10_000,
      },
      {
        sourceStartMs: 115_000,
        sourceEndMs: 116_500,
        validDurationMs: 1_500,
      },
    ]);
    expect(normalizeBroadcastSpeechActivityPlan(plan)).toEqual(plan);
  });

  it("maps output frames to source time and excludes padding-only frames", () => {
    const cell = plannedCell(25_000, 2);

    expect(mapBroadcastSpeechActivityFrameToSourceRange(cell, 0, 4)).toEqual({
      sourceStartMs: 20_000,
      sourceEndMs: 22_500,
    });
    expect(mapBroadcastSpeechActivityFrameToSourceRange(cell, 1, 4)).toEqual({
      sourceStartMs: 22_500,
      sourceEndMs: 25_000,
    });
    expect(mapBroadcastSpeechActivityFrameToSourceRange(cell, 2, 4)).toBeNull();
    expect(mapBroadcastSpeechActivityFrameToSourceRange(cell, 3, 4)).toBeNull();
  });

  it("does not let logits from padding-only frames change the source result", () => {
    const cell = plannedCell(25_000, 2);
    const noSpeaker = logitsForWinner(0);
    const paddingSpeech = logitsForWinner(1);
    const receipt = postprocessBroadcastSpeechActivityLogits({
      operationId: "vad:partial-padding",
      attemptOrdinal: 0,
      runtime: "wasm",
      cell,
      logits: [noSpeaker, noSpeaker, paddingSpeech, paddingSpeech],
    });

    expect(receipt).toMatchObject({
      outputFrameCount: 4,
      evaluatedFrameCount: 2,
      evaluatedDurationMs: 5_000,
      confidentNoSpeechDurationMs: 5_000,
      confidentSpeechDurationMs: 0,
      outcome: "no-speech",
      asrDisposition: "asr-skippable-confirmed-no-speech",
    });
  });

  it("marks ASR skippable only when every valid frame is confidently NO_SPEAKER", () => {
    const cell = plannedCell();
    const receipt = completed(cell, "no-speech");

    expect(receipt).toMatchObject({
      status: "completed",
      outcome: "no-speech",
      confidentSpeechDurationMs: 0,
      confidentNoSpeechDurationMs: 10_000,
      inconclusiveDurationMs: 0,
      asrDisposition: "asr-skippable-confirmed-no-speech",
    });
    expect(broadcastSpeechActivityCanSkipAsr(receipt)).toBe(true);
  });

  it("keeps one ambiguous frame fail-closed and sends the cell to ASR", () => {
    const cell = plannedCell();
    const noSpeaker = logitsForWinner(0);
    const ambiguous = Array.from(
      { length: BROADCAST_SPEECH_ACTIVITY_OUTPUT_CLASS_COUNT },
      () => 0,
    );
    const receipt = postprocessBroadcastSpeechActivityLogits({
      operationId: "vad:ambiguous",
      attemptOrdinal: 0,
      runtime: "webgpu",
      cell,
      logits: [noSpeaker, noSpeaker, noSpeaker, ambiguous],
    });

    expect(receipt).toMatchObject({
      outcome: "inconclusive",
      confidentNoSpeechDurationMs: 7_500,
      inconclusiveDurationMs: 2_500,
      asrDisposition: "asr-required",
    });
    expect(broadcastSpeechActivityCanSkipAsr(receipt)).toBe(false);
  });

  it("treats every nonzero winning class as speech presence, never as a person id", () => {
    const cell = plannedCell();
    for (const speechClassId of BROADCAST_SPEECH_ACTIVITY_SPEECH_CLASS_IDS) {
      const receipt = postprocessBroadcastSpeechActivityLogits({
        operationId: `vad:speech-class-${speechClassId}`,
        attemptOrdinal: 0,
        runtime: "wasm",
        cell,
        logits: [
          logitsForWinner(speechClassId),
          logitsForWinner(speechClassId),
          logitsForWinner(speechClassId),
          logitsForWinner(speechClassId),
        ],
      });
      expect(receipt.outcome).toBe("speech");
      expect(receipt.asrDisposition).toBe("asr-required");
    }
  });

  it("does not combine low-confidence class probabilities into false certainty", () => {
    const receipt = completed(plannedCell(), "inconclusive");

    expect(receipt).toMatchObject({
      outcome: "inconclusive",
      confidentSpeechDurationMs: 0,
      confidentNoSpeechDurationMs: 0,
      inconclusiveDurationMs: 10_000,
      asrDisposition: "asr-required",
    });
  });

  it("requires at least 250 ms of confident speech before labeling speech", () => {
    const cell = plannedCell();
    const noSpeaker = logitsForWinner(0);
    const speech = logitsForWinner(1);
    const oneHundredFrames = Array.from({ length: 100 }, () => noSpeaker);
    oneHundredFrames[10] = speech;
    const shortBlip = postprocessBroadcastSpeechActivityLogits({
      operationId: "vad:short-blip",
      attemptOrdinal: 0,
      runtime: "wasm",
      cell,
      logits: oneHundredFrames,
    });

    const fortyFrames = Array.from({ length: 40 }, () => noSpeaker);
    fortyFrames[10] = speech;
    const minimumSpeech = postprocessBroadcastSpeechActivityLogits({
      operationId: "vad:minimum-speech",
      attemptOrdinal: 0,
      runtime: "wasm",
      cell,
      logits: fortyFrames,
    });

    expect(shortBlip).toMatchObject({
      outcome: "inconclusive",
      confidentSpeechDurationMs: 100,
      asrDisposition: "asr-required",
    });
    expect(minimumSpeech).toMatchObject({
      outcome: "speech",
      confidentSpeechDurationMs: 250,
      asrDisposition: "asr-required",
    });
  });

  it("never uses a speech-like music/background result to skip ASR", () => {
    const receipt = completed(plannedCell(), "speech", "vad:music-like");

    expect(receipt.outcome).toBe("speech");
    expect(receipt.asrDisposition).toBe("asr-required");
    expect(broadcastSpeechActivityCanSkipAsr(receipt)).toBe(false);
  });

  it("rejects malformed, non-finite, and empty model outputs", () => {
    const cell = plannedCell();
    const base = {
      operationId: "vad:invalid",
      attemptOrdinal: 0,
      runtime: "wasm" as const,
      cell,
    };

    expect(() =>
      postprocessBroadcastSpeechActivityLogits({
        ...base,
        logits: [],
      }),
    ).toThrow(/bounded frame sequence/u);
    expect(() =>
      postprocessBroadcastSpeechActivityLogits({
        ...base,
        logits: [[0, 0]],
      }),
    ).toThrow(/exactly seven logits/u);
    expect(() =>
      postprocessBroadcastSpeechActivityLogits({
        ...base,
        logits: [[0, 0, 0, 0, 0, 0, Number.NaN]],
      }),
    ).toThrow(/must be finite/u);
  });

  it("maps gaps and missing cells to ASR-required coverage until repaired", () => {
    const plan = createBroadcastSpeechActivityPlan(25_000);
    const first = plan.cells[0];
    const second = plan.cells[1];
    if (first === undefined || second === undefined) {
      throw new Error("Coverage fixture is incomplete.");
    }
    const firstReceipt = completed(first, "no-speech");
    const secondReceipt = createBroadcastSpeechActivityGapReceipt({
      operationId: "vad:gap",
      attemptOrdinal: 2,
      runtime: "wasm",
      cell: second,
      reason: "inference-failed",
    });

    expect(
      aggregateBroadcastSpeechActivityCoverage(plan, [
        firstReceipt,
        secondReceipt,
      ]),
    ).toEqual({
      plannedCellCount: 3,
      receivedReceiptCount: 2,
      completedCellCount: 1,
      speechCellCount: 0,
      noSpeechCellCount: 1,
      inconclusiveCellCount: 0,
      gapCellCount: 1,
      missingCellCount: 1,
      sourceDurationMs: 25_000,
      plannedDurationMs: 25_000,
      analyzedDurationMs: 10_000,
      gapDurationMs: 10_000,
      missingDurationMs: 5_000,
      asrSkippableDurationMs: 10_000,
      asrRequiredDurationMs: 15_000,
      analysisCoverageRatio: 0.4,
      repairRequired: true,
      complete: false,
    });
    expect(broadcastSpeechActivityCanSkipAsr(secondReceipt)).toBe(false);
  });

  it("produces complete coverage even when a completed cell is inconclusive", () => {
    const plan = createBroadcastSpeechActivityPlan(25_000);
    const first = plan.cells[0];
    const second = plan.cells[1];
    const third = plan.cells[2];
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error("Complete coverage fixture is incomplete.");
    }
    const receipt = createBroadcastSpeechActivityRunReceipt(plan, [
      completed(third, "inconclusive", "vad:third"),
      completed(first, "no-speech", "vad:first"),
      completed(second, "speech", "vad:second"),
    ]);

    expect(receipt.cells.map(({ cellId }) => cellId)).toEqual(
      plan.cells.map(({ cellId }) => cellId),
    );
    expect(receipt.coverage).toMatchObject({
      completedCellCount: 3,
      speechCellCount: 1,
      noSpeechCellCount: 1,
      inconclusiveCellCount: 1,
      gapCellCount: 0,
      missingCellCount: 0,
      analyzedDurationMs: 25_000,
      asrSkippableDurationMs: 10_000,
      asrRequiredDurationMs: 15_000,
      analysisCoverageRatio: 1,
      repairRequired: false,
      complete: true,
    });
  });

  it("preserves cancelled versus retry-before-next-phase gap semantics", () => {
    const cell = plannedCell();
    const retryable = createBroadcastSpeechActivityGapReceipt({
      operationId: "vad:retryable",
      attemptOrdinal: 1,
      runtime: null,
      cell,
      reason: "model-load-failed",
    });
    const cancelled = createBroadcastSpeechActivityGapReceipt({
      operationId: "vad:cancelled",
      attemptOrdinal: 1,
      runtime: "wasm",
      cell,
      reason: "cancelled",
    });

    expect(retryable.recovery).toBe("retry-before-next-phase");
    expect(cancelled.recovery).toBe("user-cancelled");
    expect(retryable.asrDisposition).toBe("asr-required");
    expect(cancelled.asrDisposition).toBe("asr-required");
  });

  it("round-trips a metadata-only run receipt through the exact validator", () => {
    const plan = createBroadcastSpeechActivityPlan(15_000);
    const first = plan.cells[0];
    const second = plan.cells[1];
    if (first === undefined || second === undefined) {
      throw new Error("Validator fixture is incomplete.");
    }
    const receipt = createBroadcastSpeechActivityRunReceipt(plan, [
      completed(first, "no-speech", "vad:validate-first"),
      completed(second, "speech", "vad:validate-second"),
    ]);
    const serialized = JSON.parse(JSON.stringify(receipt)) as unknown;

    expect(normalizeBroadcastSpeechActivityRunReceipt(serialized)).toEqual(
      receipt,
    );
    expect(isBroadcastSpeechActivityRunReceipt(serialized)).toBe(true);
    expect(JSON.stringify(receipt)).not.toMatch(
      /pcm|base64|wav|logits|embedding/iu,
    );
  });

  it("rejects model drift, contradictory outcomes, and binary payload keys", () => {
    const plan = createBroadcastSpeechActivityPlan(10_000);
    const cell = plannedCell();
    const receipt = createBroadcastSpeechActivityRunReceipt(plan, [
      completed(cell, "no-speech", "vad:sealed"),
    ]);
    const result = receipt.cells[0];
    if (result === undefined || result.status !== "completed") {
      throw new Error("Completed receipt fixture is missing.");
    }

    expect(
      normalizeBroadcastSpeechActivityRunReceipt({
        ...receipt,
        model: {
          ...receipt.model,
          revision: "main",
        },
      }),
    ).toBeNull();
    expect(
      normalizeBroadcastSpeechActivityRunReceipt({
        ...receipt,
        cells: [
          {
            ...result,
            minimumWinningConfidence: 0.1,
          },
        ],
      }),
    ).toBeNull();
    expect(
      normalizeBroadcastSpeechActivityRunReceipt({
        ...receipt,
        cells: [
          {
            ...result,
            outcome: "speech",
            asrDisposition: "asr-required",
          },
        ],
      }),
    ).toBeNull();
    expect(
      normalizeBroadcastSpeechActivityRunReceipt({
        ...receipt,
        pcm: new Float32Array(1),
      }),
    ).toBeNull();
    expect(
      normalizeBroadcastSpeechActivityRunReceipt({
        ...receipt,
        cells: [
          {
            ...result,
            logits: [[1, 0, 0, 0, 0, 0, 0]],
          },
        ],
      }),
    ).toBeNull();
  });

  it("rejects duplicate cell receipts and reused operation identities", () => {
    const plan = createBroadcastSpeechActivityPlan(20_000);
    const first = plan.cells[0];
    const second = plan.cells[1];
    if (first === undefined || second === undefined) {
      throw new Error("Duplicate fixture is incomplete.");
    }
    const firstReceipt = completed(first, "speech", "vad:shared");

    expect(() =>
      createBroadcastSpeechActivityRunReceipt(plan, [
        firstReceipt,
        firstReceipt,
      ]),
    ).toThrow(/more than one receipt/u);
    expect(() =>
      createBroadcastSpeechActivityRunReceipt(plan, [
        firstReceipt,
        completed(second, "speech", "vad:shared"),
      ]),
    ).toThrow(/reused for multiple cells/u);
  });

  it("rejects source and frame ranges outside the bounded contract", () => {
    expect(() => createBroadcastSpeechActivityPlan(0)).toThrow(
      /between 1 ms and 12 hours/u,
    );
    expect(() =>
      createBroadcastSpeechActivityPlan(
        BROADCAST_SPEECH_ACTIVITY_MAX_SOURCE_DURATION_MS + 1,
      ),
    ).toThrow(/between 1 ms and 12 hours/u);
    expect(() =>
      mapBroadcastSpeechActivityFrameToSourceRange(plannedCell(), 4, 4),
    ).toThrow(/identify one bounded output frame/u);
    expect(
      normalizeBroadcastSpeechActivityPlan({
        ...createBroadcastSpeechActivityPlan(10_000),
        cells: [
          {
            ...plannedCell(),
            base64Pcm: "AAAA",
          },
        ],
      }),
    ).toBeNull();
  });
});
