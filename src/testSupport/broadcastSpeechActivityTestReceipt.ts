import {
  BROADCAST_SPEECH_ACTIVITY_NO_SPEAKER_CLASS_ID,
  BROADCAST_SPEECH_ACTIVITY_OUTPUT_CLASS_COUNT,
  createBroadcastSpeechActivityPlan,
  createBroadcastSpeechActivityRunReceipt,
  postprocessBroadcastSpeechActivityLogits,
  type BroadcastSpeechActivityRunReceipt,
} from "../analysis/broadcastSpeechActivity";

export function createVerifiedNoSpeechRunReceiptForTest(
  sourceDurationMs: number,
  sourceStartMs: number,
  sourceEndMs: number,
): BroadcastSpeechActivityRunReceipt {
  const plan = createBroadcastSpeechActivityPlan(sourceDurationMs, {
    sourceStartMs,
    sourceEndMs,
  });
  const noSpeakerLogits = Array.from(
    { length: BROADCAST_SPEECH_ACTIVITY_OUTPUT_CLASS_COUNT },
    (_, classId) =>
      classId === BROADCAST_SPEECH_ACTIVITY_NO_SPEAKER_CLASS_ID ? 8 : -8,
  );
  const cellReceipts = plan.cells.map((cell) =>
    postprocessBroadcastSpeechActivityLogits({
      operationId: `test-vad-${cell.ordinal}`,
      attemptOrdinal: 0,
      runtime: "wasm",
      cell,
      logits: [noSpeakerLogits],
    }),
  );
  return createBroadcastSpeechActivityRunReceipt(plan, cellReceipts);
}
