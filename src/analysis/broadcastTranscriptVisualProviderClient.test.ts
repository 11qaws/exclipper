import { describe, expect, it, vi } from "vitest";
import {
  createBroadcastTranscriptResolvedEvidenceCheckpoint,
  recordBroadcastTranscriptResolvedEvidence,
} from "./broadcastTranscriptResolvedEvidence";
import {
  createBroadcastTranscriptVisualFramePreparationQueue,
  createBroadcastTranscriptVisualInspectionPlan,
  createBroadcastTranscriptVisualPreparedFrameReceipt,
  createBroadcastTranscriptVisualProviderBatchQueue,
} from "./broadcastTranscriptVisualInspectionQueue";
import {
  AMORETTO_CHANNEL_CAST_ROSTER_ID,
  candidatePassBKnownCastReferences,
} from "./participantRoster";
import {
  BROADCAST_TRANSCRIPT_VISUAL_TRANSPORT_MODE,
  type BroadcastTranscriptVisualProviderAttemptRequest,
} from "./broadcastTranscriptVisualInspectionRunner";
import {
  BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_MODEL_REVISION,
  createBroadcastTranscriptVisualProviderBatchAdapter,
  createBroadcastTranscriptVisualProviderOperationId,
  type BroadcastTranscriptVisualPreparedQuotaTransport,
} from "./broadcastTranscriptVisualProviderClient";

const SOURCE_FINGERPRINT = `sha256:${"a".repeat(64)}`;
const FRAME_FINGERPRINTS = [
  `sha256:${"1".repeat(64)}`,
  `sha256:${"2".repeat(64)}`,
  `sha256:${"3".repeat(64)}`,
  `sha256:${"4".repeat(64)}`,
] as const;
const MEDIA_TICKET = `v1.${"a".repeat(64)}.${"b".repeat(64)}`;

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) return input;
  if (typeof input === "string") return new URL(input);
  return new URL(input.url);
}

function serializedBody(init: RequestInit | undefined): string {
  if (typeof init?.body !== "string") {
    throw new TypeError("Expected a serialized request body.");
  }
  return init.body;
}

function request(): BroadcastTranscriptVisualProviderAttemptRequest {
  let evidence = createBroadcastTranscriptResolvedEvidenceCheckpoint({
    sourceFingerprint: SOURCE_FINGERPRINT,
    sourceDurationMs: 1_000,
    transcriptInputSignature: "visual-provider-test",
    modelRevision: "asr-test-v1",
    plannedCells: [
      { chunkId: "no-audio", sourceStartMs: 0, sourceEndMs: 1_000 },
    ],
  });
  evidence = recordBroadcastTranscriptResolvedEvidence(
    evidence,
    "no-audio",
    "no-audio",
    null,
  );
  const plan = createBroadcastTranscriptVisualInspectionPlan(evidence);
  const frameTask =
    createBroadcastTranscriptVisualFramePreparationQueue(plan).tasks[0]!;
  const receipt = createBroadcastTranscriptVisualPreparedFrameReceipt({
    plan,
    cellId: frameTask.cellId,
    frameContentFingerprints: FRAME_FINGERPRINTS,
    audioEvidence: null,
  });
  const task = createBroadcastTranscriptVisualProviderBatchQueue({
    plan,
    framePreparationQueue:
      createBroadcastTranscriptVisualFramePreparationQueue(plan),
    preparedFrameReceipts: [receipt],
    maximumBatchSize: 1,
  }).batches[0]!.tasks[0]!;
  return {
    transportMode: BROADCAST_TRANSCRIPT_VISUAL_TRANSPORT_MODE,
    planFingerprint: plan.planFingerprint,
    sourceFingerprint: plan.sourceFence.sourceFingerprint,
    task,
    providerModelRevision:
      BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_MODEL_REVISION,
    operationId: "visual-0-0123456789abcdef01234567",
    attemptOrdinal: 0,
    mediaEvidence: {
      verified: true,
      planFingerprint: plan.planFingerprint,
      sourceFingerprint: plan.sourceFence.sourceFingerprint,
      cellId: task.cellId,
      sourceStartMs: task.sourceStartMs,
      sourceEndMs: task.sourceEndMs,
      frames: task.frameTimestampsMs.map((timestampMs, index) => ({
        timestampMs,
        contentType: "image/jpeg",
        bytes: new Uint8Array([0xff, 0xd8, 0xff, index, 0xff, 0xd9]),
      })) as unknown as BroadcastTranscriptVisualProviderAttemptRequest["mediaEvidence"]["frames"],
      audio: null,
    },
  };
}

function providerPayload(
  evidenceBasis:
    | "on-screen-name"
    | "provided-cast-reference" = "on-screen-name",
) {
  const participant = candidatePassBKnownCastReferences().find(
    ({ participantId }) => participantId === "amoretto",
  )!;
  return {
    candidates: [
      {
        finishReason: "STOP",
        content: {
          parts: [
            {
              text: JSON.stringify({
                segments: [],
                eventSummaryKo:
                  "화면에서 스트리머가 조용히 목표를 달성한 장면이 확인됩니다.",
                reactionSummaryKo:
                  "큰 소리는 없지만 표정과 화면 변화로 성공을 알아차립니다.",
                whyGoodClipKo:
                  "오디오 반응 없이도 사건과 결과가 완결되는 유효한 장면입니다.",
                uncertaintiesKo: [],
                participantPresence: "identified",
                participantSummaryKo:
                  "화면 이름표로 진행 스트리머를 확인했습니다.",
                identifiedParticipants: [
                  {
                    displayName: participant.displayName,
                    role: "guest",
                    evidenceBasis,
                    evidenceKo: "첫 번째 대표 화면의 이름표에서 확인했습니다.",
                    confidence: 0.97,
                    relativeTimestampMs: 250,
                    observedFrameIndices:
                      evidenceBasis === "provided-cast-reference"
                        ? [0, 1]
                        : [0],
                  },
                ],
                clipDecision: "recommend",
                contextConsistency: "consistent",
                programMaterial: "streamer-event",
              }),
            },
          ],
        },
      },
    ],
  };
}

describe("broadcastTranscriptVisualProviderClient", () => {
  it("stages four verified JPEGs and canonicalizes a personal-channel owner role", async () => {
    const attempt = request();
    const stageQueries: URL[] = [];
    const resolveBodies: unknown[] = [];
    const fetchImplementation = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url.pathname === "/v1/candidate-insight-media") {
          stageQueries.push(url);
          expect(init?.body).toBeInstanceOf(Uint8Array);
          expect((init?.body as Uint8Array).byteLength).toBe(24);
          return Promise.resolve(
            Response.json(
              {
                schemaVersion: "1.0.0",
                status: "staged",
                mediaTicket: MEDIA_TICKET,
                expiresAtMs: Date.now() + 60_000,
                candidateHash: url.searchParams.get("candidateHash"),
                candidateDurationMs: 1_000,
                frameCount: 4,
              },
              { status: 202 },
            ),
          );
        }
        resolveBodies.push(
          JSON.parse(serializedBody(init)) as unknown,
        );
        return Promise.resolve(Response.json(providerPayload()));
      },
    );
    const quotaTransport: BroadcastTranscriptVisualPreparedQuotaTransport =
      (body, _options, preparedFetch) => {
        expect(body).toBeInstanceOf(Uint8Array);
        return preparedFetch(
          {
            participantId:
              "participant_00000000000000000000000000000000",
            runId: "run-visual-provider-test",
            operationId: attempt.operationId,
            pool: "candidate",
            payloadDigest: `sha256:${"9".repeat(64)}`,
            leaseToken: "lease_test",
          },
          0,
        );
      };
    const adapter = createBroadcastTranscriptVisualProviderBatchAdapter({
      participantId: "participant_00000000000000000000000000000000",
      runId: "run-visual-provider-test",
      castRosterId: AMORETTO_CHANNEL_CAST_ROSTER_ID,
      fetchImplementation,
      quotaTransport,
    });

    const results = await adapter.executeProviderBatch([attempt]);

    expect(stageQueries).toHaveLength(1);
    expect(stageQueries[0]!.searchParams.get("audioBytes")).toBe("0");
    expect(
      [0, 1, 2, 3].map((index) =>
        stageQueries[0]!.searchParams.get(`f${index}t`),
      ),
    ).toEqual(
      attempt.task.frameTimestampsMs.map((timestampMs) =>
        String(timestampMs - attempt.task.sourceStartMs),
      ),
    );
    expect(resolveBodies).toEqual([
      expect.objectContaining({
        transcriptAbstentionReason: "no-audio",
        mediaTicket: MEDIA_TICKET,
      }),
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      outcome: "completed",
      editorialFinding: "visual-event",
      participantOutcome: {
        presence: "identified",
        participants: [
          {
            participantId:
              "amoretto",
            role: "streamer",
            confidence: 0.97,
            observedFrameIndices: [0],
          },
        ],
      },
    });
    const terminal = results[0];
    expect(
      terminal !== undefined &&
        (terminal.outcome === "completed" ||
          terminal.outcome === "excluded-music-only")
        ? terminal.providerResponseFingerprint
        : null,
    ).toMatch(
      /^sha256:[a-f0-9]{64}$/u,
    );
  });

  it("returns one source-addressed failure instead of dropping the batch", async () => {
    const attempt = request();
    const adapter = createBroadcastTranscriptVisualProviderBatchAdapter({
      participantId: "participant_00000000000000000000000000000000",
      runId: "run-visual-provider-test",
      castRosterId: null,
      quotaTransport: () =>
        Promise.reject(new TypeError("network unavailable")),
    });

    await expect(adapter.executeProviderBatch([attempt])).resolves.toEqual([
      {
        cellId: attempt.task.cellId,
        operationId: attempt.operationId,
        outcome: "retryable",
        failureReason: "provider-unavailable",
      },
    ]);
  });

  it("does not convert a text roster into a visual reference-image match", async () => {
    const attempt = request();
    const adapter = createBroadcastTranscriptVisualProviderBatchAdapter({
      participantId: "participant_00000000000000000000000000000000",
      runId: "run-visual-provider-reference-guard",
      castRosterId: AMORETTO_CHANNEL_CAST_ROSTER_ID,
      fetchImplementation: (input, init) => {
        const url = requestUrl(input);
        if (url.pathname === "/v1/candidate-insight-media") {
          return Promise.resolve(
            Response.json(
              {
                schemaVersion: "1.0.0",
                status: "staged",
                mediaTicket: MEDIA_TICKET,
                expiresAtMs: Date.now() + 60_000,
                candidateHash: url.searchParams.get("candidateHash"),
                candidateDurationMs: 1_000,
                frameCount: 4,
              },
              { status: 202 },
            ),
          );
        }
        expect(
          JSON.parse(serializedBody(init)) as unknown,
        ).toMatchObject({
          mediaTicket: MEDIA_TICKET,
        });
        return Promise.resolve(
          Response.json(providerPayload("provided-cast-reference")),
        );
      },
      quotaTransport: (_body, _options, preparedFetch) =>
        preparedFetch(
          {
            participantId:
              "participant_00000000000000000000000000000000",
            runId: "run-visual-provider-reference-guard",
            operationId: attempt.operationId,
            pool: "candidate",
            payloadDigest: `sha256:${"8".repeat(64)}`,
            leaseToken: "lease_reference_guard",
          },
          0,
        ),
    });

    const results = await adapter.executeProviderBatch([attempt]);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      cellId: attempt.task.cellId,
      operationId: attempt.operationId,
      outcome: "retryable",
      failureReason: "invalid-response",
    });
  });

  it("creates stable, collision-safe quota operation IDs", async () => {
    const input = {
      planFingerprint: "plan:test",
      sourceFingerprint: SOURCE_FINGERPRINT,
      cellId: "visual:no-audio",
      attemptOrdinal: 2,
      usedOperationIds: [],
    };
    const first = await createBroadcastTranscriptVisualProviderOperationId(
      input,
    );
    const second = await createBroadcastTranscriptVisualProviderOperationId({
      ...input,
      usedOperationIds: [first],
    });
    expect(first).toMatch(/^visual-2-[a-f0-9]{24}$/u);
    expect(second).toBe(`${first}-1`);
  });
});
