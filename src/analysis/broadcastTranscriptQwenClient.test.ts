import { describe, expect, it, vi } from "vitest";
import {
  BROADCAST_TRANSCRIPT_BASE64_CONTENT_TYPE,
  BROADCAST_TRANSCRIPT_PROXY_ENDPOINT,
  requestBroadcastTranscriptQwenChunk,
} from "./broadcastTranscriptQwenClient";
import type { BroadcastTranscriptQwenClientError } from "./broadcastTranscriptQwenClient";

describe("broadcastTranscriptQwenClient", () => {
  it("sends only audio and source offsets and accepts a matching result", async () => {
    const fetchImplementation = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(_input).toBe(
          `${BROADCAST_TRANSCRIPT_PROXY_ENDPOINT}?startMs=10000&durationMs=1000`,
        );
        if (typeof init?.body !== "string") throw new TypeError("body");
        expect(init.body).toBe("UklGRg==");
        expect(new Headers(init.headers).get("Content-Type")).toBe(
          BROADCAST_TRANSCRIPT_BASE64_CONTENT_TYPE,
        );
        return Promise.resolve(
          new Response(
            JSON.stringify({
              schemaVersion: "1.0.0",
              modelId: "qwen3-asr-flash",
              sourceStartMs: 10_000,
              sourceEndMs: 11_000,
              textKo: "조용히 성공했다고 말한다.",
              detectedLanguage: "ko",
              emotion: "happy",
              billedSeconds: 1,
            }),
            { status: 200 },
          ),
        );
      },
    );
    await expect(
      requestBroadcastTranscriptQwenChunk("UklGRg==", 10_000, 1_000, {
        fetchImplementation,
      }),
    ).resolves.toMatchObject({ textKo: "조용히 성공했다고 말한다." });
  });

  it("rejects a result whose source fence does not match the request", async () => {
    const fetchImplementation = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            schemaVersion: "1.0.0",
            modelId: "qwen3-asr-flash",
            sourceStartMs: 0,
            sourceEndMs: 1_000,
            textKo: "다른 구간",
            detectedLanguage: "ko",
            emotion: null,
            billedSeconds: 1,
          }),
          { status: 200 },
        ),
      );
    await expect(
      requestBroadcastTranscriptQwenChunk("UklGRg==", 10_000, 1_000, {
        fetchImplementation,
      }),
    ).rejects.toMatchObject({
      code: "PROXY_INVALID_RESPONSE",
    } satisfies Partial<BroadcastTranscriptQwenClientError>);
  });

  it("rejects a direct chunk above the 30-second production ceiling locally", async () => {
    const fetchImplementation = vi.fn();
    await expect(
      requestBroadcastTranscriptQwenChunk("UklGRg==", 0, 30_001, {
        fetchImplementation,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
    } satisfies Partial<BroadcastTranscriptQwenClientError>);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
