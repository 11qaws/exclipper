import { describe, expect, it } from "vitest";

import { QWEN_ASR_SAFE_CHUNK_DURATION_MS } from "./broadcastContextSamplingPlan";
import {
  MAX_BROADCAST_TRANSCRIPT_WORKER_CHUNKS,
} from "./broadcastTranscriptWorkerProtocol";

describe("broadcastTranscriptWorkerProtocol", () => {
  it("uses the current 90-second ceiling for a maximum 12-hour source", () => {
    expect(QWEN_ASR_SAFE_CHUNK_DURATION_MS).toBe(90_000);
    expect(MAX_BROADCAST_TRANSCRIPT_WORKER_CHUNKS).toBe(480);
    expect(
      MAX_BROADCAST_TRANSCRIPT_WORKER_CHUNKS *
        QWEN_ASR_SAFE_CHUNK_DURATION_MS,
    ).toBe(12 * 60 * 60_000);
  });
});
