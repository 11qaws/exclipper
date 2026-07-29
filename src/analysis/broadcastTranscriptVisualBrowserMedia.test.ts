import { describe, expect, it, vi } from "vitest";
import { encodeCandidatePassBPcm16Wav } from "./candidatePassBGemini";
import {
  CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
} from "./candidatePassBWorkerProtocol";
import {
  createBroadcastTranscriptResolvedEvidenceCheckpoint,
  recordBroadcastTranscriptResolvedEvidence,
} from "./broadcastTranscriptResolvedEvidence";
import { createVerifiedNoSpeechRunReceiptForTest } from "../testSupport/broadcastSpeechActivityTestReceipt";
import {
  createBroadcastTranscriptVisualFramePreparationQueue,
  createBroadcastTranscriptVisualInspectionPlan,
  type BroadcastTranscriptVisualFramePreparationTask,
} from "./broadcastTranscriptVisualInspectionQueue";
import {
  createBroadcastTranscriptVisualBrowserMediaAdapter,
  type BroadcastTranscriptVisualBrowserMediaBackend,
  type BroadcastTranscriptVisualBrowserMediaBackendRequest,
} from "./broadcastTranscriptVisualBrowserMedia";

const SOURCE_FINGERPRINT = `sha256:${"a".repeat(64)}`;

function plan() {
  let evidence = createBroadcastTranscriptResolvedEvidenceCheckpoint({
    sourceFingerprint: SOURCE_FINGERPRINT,
    sourceDurationMs: 2_000,
    transcriptInputSignature: "visual-browser-media-test",
    modelRevision: "asr-test-v1",
    plannedCells: [
      { chunkId: "no-audio", sourceStartMs: 0, sourceEndMs: 1_000 },
      { chunkId: "no-speech", sourceStartMs: 1_000, sourceEndMs: 2_000 },
    ],
  });
  evidence = recordBroadcastTranscriptResolvedEvidence(
    evidence,
    "no-audio",
    "no-audio",
    null,
  );
  evidence = recordBroadcastTranscriptResolvedEvidence(
    evidence,
    "no-speech",
    "no-speech",
    createVerifiedNoSpeechRunReceiptForTest(2_000, 1_000, 2_000),
  );
  return createBroadcastTranscriptVisualInspectionPlan(evidence);
}

function jpeg(seed: number): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, seed, 0xff, 0xd9]);
}

class FakeMediaBackend implements BroadcastTranscriptVisualBrowserMediaBackend {
  public readonly extractFrames = vi.fn(
    ({ task }: BroadcastTranscriptVisualBrowserMediaBackendRequest) =>
      Promise.resolve(
        task.frameTimestampsMs.map((timestampMs, index) => ({
          timestampMs,
          contentType: "image/jpeg" as const,
          bytes: jpeg(index + 1),
        })) as unknown as Awaited<
          ReturnType<BroadcastTranscriptVisualBrowserMediaBackend["extractFrames"]>
        >,
      ),
  );

  public readonly extractAudio = vi.fn(
    ({ task }: BroadcastTranscriptVisualBrowserMediaBackendRequest) =>
      Promise.resolve({
        sourceStartMs: task.sourceStartMs,
        sourceEndMs: task.sourceEndMs,
        codec: "audio/wav;codec=pcm_s16le;rate=16000;channels=1",
        extractionRevision: "broadcast-transcript-visual-audio-pcm16-v1",
        bytes: encodeCandidatePassBPcm16Wav(
          new Float32Array(CANDIDATE_PASS_B_SAMPLE_RATE_HZ),
          CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
        ),
      }),
  );

  public readonly dispose = vi.fn();
}

function adapterRequest(
  currentPlan: ReturnType<typeof plan>,
  task: BroadcastTranscriptVisualFramePreparationTask,
) {
  return {
    planFingerprint: currentPlan.planFingerprint,
    sourceFingerprint: currentPlan.sourceFence.sourceFingerprint,
    task,
  };
}

describe("broadcastTranscriptVisualBrowserMedia", () => {
  it("extracts exact audio as well as four frames for a participant dialogue sample", async () => {
    const evidence = createBroadcastTranscriptResolvedEvidenceCheckpoint({
      sourceFingerprint: SOURCE_FINGERPRINT,
      sourceDurationMs: 1_000,
      transcriptInputSignature: "visual-browser-dialogue-sample",
      modelRevision: "asr-test-v1",
      plannedCells: [
        { chunkId: "dialogue", sourceStartMs: 0, sourceEndMs: 1_000 },
      ],
    });
    const currentPlan =
      createBroadcastTranscriptVisualInspectionPlan(evidence);
    const task = createBroadcastTranscriptVisualFramePreparationQueue(
      currentPlan,
    ).tasks[0]!;
    const backend = new FakeMediaBackend();
    const adapter = createBroadcastTranscriptVisualBrowserMediaAdapter({
      sourceFile: new File([new Uint8Array([3])], "source.mp4"),
      plan: currentPlan,
      backend,
    });

    const prepared = await adapter.prepare(
      adapterRequest(currentPlan, task),
    );

    expect(task.inspectionPurpose).toBe("participant-grounding");
    expect(task.transcriptAbstentionReason).toBe("dialogue-sample");
    expect(prepared.frameContentFingerprints).toHaveLength(4);
    expect(prepared.audioEvidence).toMatchObject({
      sourceStartMs: 0,
      sourceEndMs: 1_000,
    });
    expect(backend.extractAudio).toHaveBeenCalledTimes(1);
  });

  it("extracts exactly four planned JPEGs and never invents audio for no-audio", async () => {
    const currentPlan = plan();
    const tasks = createBroadcastTranscriptVisualFramePreparationQueue(
      currentPlan,
    ).tasks;
    const noAudioTask = tasks.find(
      ({ transcriptAbstentionReason }) =>
        transcriptAbstentionReason === "no-audio",
    )!;
    const backend = new FakeMediaBackend();
    const adapter = createBroadcastTranscriptVisualBrowserMediaAdapter({
      sourceFile: new File([new Uint8Array([1])], "source.mp4"),
      plan: currentPlan,
      backend,
    });

    const prepared = await adapter.prepare(
      adapterRequest(currentPlan, noAudioTask),
    );
    const hydrated = await adapter.hydrate({
      ...adapterRequest(currentPlan, noAudioTask),
      task: {
        ...noAudioTask,
        frameContentFingerprints: prepared.frameContentFingerprints,
        audioEvidence: prepared.audioEvidence,
      },
      preparedReceipt: {
        schemaVersion: "3.0.0",
        planFingerprint: currentPlan.planFingerprint,
        sourceFingerprint: currentPlan.sourceFence.sourceFingerprint,
        cellId: noAudioTask.cellId,
        sourceStartMs: noAudioTask.sourceStartMs,
        sourceEndMs: noAudioTask.sourceEndMs,
        frameBundleKey: noAudioTask.frameBundleKey,
        frameTimestampsMs: noAudioTask.frameTimestampsMs,
        frameContentFingerprints: prepared.frameContentFingerprints,
        audioEvidence: null,
      },
    });

    expect(prepared.audioEvidence).toBeNull();
    expect(prepared.frameContentFingerprints).toHaveLength(4);
    expect(
      prepared.frameContentFingerprints.every((value) =>
        /^sha256:[a-f0-9]{64}$/u.test(value),
      ),
    ).toBe(true);
    expect(hydrated.frames.map(({ timestampMs }) => timestampMs)).toEqual(
      noAudioTask.frameTimestampsMs,
    );
    expect(hydrated.audio).toBeNull();
    expect(backend.extractFrames).toHaveBeenCalledTimes(1);
    expect(backend.extractAudio).not.toHaveBeenCalled();

    adapter.clearCache();
    await adapter.prepare(adapterRequest(currentPlan, noAudioTask));
    expect(backend.extractFrames).toHaveBeenCalledTimes(2);
    adapter.dispose();
    expect(backend.dispose).toHaveBeenCalledTimes(1);
  });

  it("extracts and fingerprints the exact no-speech WAV range before hydration", async () => {
    const currentPlan = plan();
    const task = createBroadcastTranscriptVisualFramePreparationQueue(
      currentPlan,
    ).tasks.find(
      ({ transcriptAbstentionReason }) =>
        transcriptAbstentionReason === "no-speech",
    )!;
    const backend = new FakeMediaBackend();
    const adapter = createBroadcastTranscriptVisualBrowserMediaAdapter({
      sourceFile: new File([new Uint8Array([2])], "source.mp4"),
      plan: currentPlan,
      backend,
    });

    const prepared = await adapter.prepare(adapterRequest(currentPlan, task));

    expect(prepared.audioEvidence).toMatchObject({
      sourceStartMs: 1_000,
      sourceEndMs: 2_000,
      codec: "audio/wav;codec=pcm_s16le;rate=16000;channels=1",
      extractionRevision: "broadcast-transcript-visual-audio-pcm16-v1",
    });
    expect(prepared.audioEvidence?.contentFingerprint).toMatch(
      /^sha256:[a-f0-9]{64}$/u,
    );
    expect(backend.extractAudio).toHaveBeenCalledTimes(1);
    const request = backend.extractAudio.mock.calls[0]?.[0];
    expect(request?.task.sourceStartMs).toBe(1_000);
    expect(request?.task.sourceEndMs).toBe(2_000);
  });
});
