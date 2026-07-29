/// <reference lib="webworker" />

import {
  ALL_FORMATS,
  AudioSampleSink,
  BlobSource,
  Input,
  InputDisposedError,
  UnsupportedInputFormatError,
  type AudioSample,
  type InputAudioTrack,
} from "mediabunny";

import {
  summarizeCandidatePassBAudioGate,
  type CandidatePassBAudioGateSummary,
} from "./candidatePassBAudioGate";
import {
  CANDIDATE_PASS_B_PROXY_ENDPOINT,
  MAX_CANDIDATE_PASS_B_RESPONSE_BYTES,
  buildCandidatePassBProxyRequestBody,
  classifyCandidatePassBProxyHttpFailure,
  encodeCandidatePassBBase64,
  encodeCandidatePassBPcm16Wav,
  extractCandidatePassBGeminiResponse,
} from "./candidatePassBGemini";
import {
  CANDIDATE_INSIGHT_MEDIA_BUNDLE_CONTENT_TYPE,
  CANDIDATE_INSIGHT_MEDIA_ENDPOINT_PATH,
  CANDIDATE_INSIGHT_MEDIA_RESOLVE_CONTENT_TYPE,
  createCandidateInsightMediaResolveRequest,
  parseCandidateInsightMediaStagedResponse,
} from "./candidateInsightMediaProtocol";
import {
  CANDIDATE_PASS_B_DEVICE,
  CANDIDATE_PASS_B_AUDIO_GATE_REVISION,
  CANDIDATE_PASS_B_DISPATCH_INTENT_SCHEMA_VERSION,
  CANDIDATE_PASS_B_DTYPE,
  CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
  CANDIDATE_PASS_B_GEMINI_MODEL_ID,
  CANDIDATE_PASS_B_GEMINI_MODEL_REVISION,
  CANDIDATE_PASS_B_LANGUAGE,
  CANDIDATE_PASS_B_QWEN_MODEL_ID,
  CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
  CANDIDATE_PASS_B_RESPONSE_MODEL_ID_HEADER,
  CANDIDATE_PASS_B_RESPONSE_MODEL_REVISION_HEADER,
  CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  CANDIDATE_PASS_B_MEDIA_RECEIPT_SCHEMA_VERSION,
  CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
  CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION,
  CANDIDATE_PASS_B_TASK,
  MAX_CANDIDATE_PASS_B_SOURCE_DURATION_MS,
  MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS,
  MAX_CANDIDATE_PASS_B_VIDEO_FRAME_BASE64_LENGTH,
  MAX_CANDIDATE_PASS_B_VIDEO_FRAMES,
  MAX_CANDIDATE_PASS_B_TARGETS,
  candidatePassBWorkerFailureMessage,
  createCandidatePassBOperationId,
  type CandidatePassBCandidateGap,
  type CandidatePassBCandidateGapReason,
  type CandidatePassBCandidateProgress,
  type CandidatePassBCompletedSettlement,
  type CandidatePassBDispatchIntent,
  type CandidatePassBModelProgress,
  type CandidatePassBOutcomeUnknownSettlement,
  type CandidatePassBQuotaIdentity,
  type CandidatePassBTarget,
  type CandidatePassBTerminalSettlement,
  type CandidatePassBTranscriptResult,
  type CandidatePassBTransportMode,
  type CandidatePassBWorkerFailureReason,
  type CandidatePassBWorkerIdentity,
  type CandidatePassBWorkerRequest,
  type CandidatePassBWorkerResponse,
  type CandidatePassBWorkerResponsePayload,
} from "./candidatePassBWorkerProtocol";
import { isAnalysisLanguage } from "../domain/analysisLanguage";
import { isCandidatePassBCastRosterId } from "./participantRoster";
import {
  candidatePassBContextFingerprint,
  isCandidatePassBContextPacket,
  isCandidatePassBTerminalSettlement,
} from "./candidateFinalVerification";
import {
  AiQuotaClientError,
  fetchWithAiQuota,
  fetchWithPreparedAiQuota,
} from "./aiQuotaClient";
import {
  aiQuotaLeaseHeaders,
  isAiQuotaOpaqueId,
  isAiQuotaParticipantId,
} from "./aiQuotaProtocol";

declare const self: DedicatedWorkerGlobalScope;

type AnalyzeRequest = Extract<
  CandidatePassBWorkerRequest,
  { readonly type: "candidate-pass-b-analyze" }
>;

const SOURCE_CACHE_BYTES = 8 * 1024 * 1024;
const CANDIDATE_DECODE_RATIO_CEILING = 0.45;
const CANDIDATE_TRANSCRIBE_RATIO = 0.5;
// Keep candidate interpretation parallel, but bounded so a full day's worth of
// candidates does not trigger an unbounded burst of remote AI requests.
const MAX_PARALLEL_GEMINI_REQUESTS = 2;
const PROGRESS_MIN_INTERVAL_MS = 150;
const PROGRESS_MIN_RATIO_STEP = 0.01;

interface ActiveTask {
  readonly identity: CandidatePassBWorkerIdentity;
  readonly quota: CandidatePassBQuotaIdentity;
  cancelled: boolean;
  cancelAcknowledgementRequested: boolean;
  input: Input<BlobSource> | null;
  inputWasDisposed: boolean;
  /** Candidate requests are kept in a small bounded pool during Pass B. */
  readonly fetchAbortControllers: Set<AbortController>;
  readonly dispatchArmWaiters: Map<
    string,
    {
      readonly resolve: (accepted: boolean) => void;
    }
  >;
  readonly terminalResultAckWaiters: Map<
    string,
    {
      readonly candidateId: string;
      readonly settlement: CandidatePassBTerminalSettlement;
      readonly resolve: (accepted: boolean) => void;
    }
  >;
}

interface DecodedCandidate {
  readonly pcm: Float32Array;
  readonly decodedOverlapFrameCount: number;
}

interface CandidateMediaBundle {
  readonly bytes: Uint8Array;
  readonly frameByteLengths: readonly [number, number, number, number];
}

class CandidateFailure extends Error {
  public readonly reasonCode: CandidatePassBCandidateGapReason;

  public constructor(
    reasonCode: CandidatePassBCandidateGapReason,
    message: string,
  ) {
    super(message);
    this.name = "CandidateFailure";
    this.reasonCode = reasonCode;
  }
}

class ProxyWorkerFailure extends Error {
  public readonly reasonCode: CandidatePassBWorkerFailureReason;

  public constructor(reasonCode: CandidatePassBWorkerFailureReason) {
    super("Candidate proxy analysis failed.");
    this.name = "ProxyWorkerFailure";
    this.reasonCode = reasonCode;
  }
}

let activeTask: ActiveTask | null = null;
let eventSequence = 0;

function createEventId(taskId: string): string {
  eventSequence += 1;
  const randomId = self.crypto?.randomUUID?.();
  return `${taskId}-${eventSequence}-${randomId ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function postResponse(
  identity: CandidatePassBWorkerIdentity,
  response: CandidatePassBWorkerResponsePayload,
  eventId = createEventId(identity.taskId),
): string {
  const message = {
    ...identity,
    eventId,
    ...response,
  } satisfies CandidatePassBWorkerResponse;
  self.postMessage(message);
  return eventId;
}

function postModelProgress(
  identity: CandidatePassBWorkerIdentity,
  progress: CandidatePassBModelProgress,
): void {
  postResponse(identity, {
    type: "candidate-pass-b-model-progress",
    progress,
  });
}

function postCandidateProgress(
  identity: CandidatePassBWorkerIdentity,
  progress: CandidatePassBCandidateProgress,
): void {
  postResponse(identity, {
    type: "candidate-pass-b-candidate-progress",
    progress,
  });
}

function sameIdentity(
  left: CandidatePassBWorkerIdentity,
  right: CandidatePassBWorkerIdentity,
): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.writerEpoch === right.writerEpoch &&
    left.analysisRunId === right.analysisRunId &&
    left.passBRunId === right.passBRunId &&
    left.workerEpoch === right.workerEpoch &&
    left.workerInstanceId === right.workerInstanceId &&
    left.taskId === right.taskId
  );
}

function disposeInputOnce(task: ActiveTask): void {
  if (task.input === null || task.inputWasDisposed) {
    return;
  }
  task.inputWasDisposed = true;
  try {
    task.input.dispose();
  } catch {
    // Cancellation and final cleanup remain best-effort. No source details are logged.
  }
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isValidIdentity(value: unknown): value is CandidatePassBWorkerIdentity {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "sessionId",
      "writerEpoch",
      "analysisRunId",
      "passBRunId",
      "workerEpoch",
      "workerInstanceId",
      "taskId",
    ])
  ) {
    return false;
  }
  return (
    isNonEmptyString(value.sessionId) &&
    isNonNegativeSafeInteger(value.writerEpoch) &&
    isNonEmptyString(value.analysisRunId) &&
    isNonEmptyString(value.passBRunId) &&
    isNonNegativeSafeInteger(value.workerEpoch) &&
    isNonEmptyString(value.workerInstanceId) &&
    isNonEmptyString(value.taskId)
  );
}

function isValidTarget(
  value: unknown,
  sourceDurationMs: number,
): value is CandidatePassBTarget {
  if (
    !isRecord(value) ||
    ![
      "candidateId",
      "startMs",
      "endMs",
      "videoFrames",
      "frameExtractionRevision",
      "context",
      "contextFingerprint",
      "castRosterId",
      "outputLanguage",
    ].every((key) => key in value) ||
    Object.keys(value).some((key) => ![
      "candidateId",
      "startMs",
      "endMs",
      "videoFrames",
      "frameExtractionRevision",
      "context",
      "contextFingerprint",
      "castRosterId",
      "outputLanguage",
    ].includes(key))
  ) {
    return false;
  }
  const rawFrames = "videoFrames" in value ? value.videoFrames : [];
  if (
    !Array.isArray(rawFrames) ||
    rawFrames.length !== MAX_CANDIDATE_PASS_B_VIDEO_FRAMES
  ) {
    return false;
  }
  if (!rawFrames.every((frame) =>
    isRecord(frame) &&
    hasExactKeys(frame, ["timestampMs", "mimeType", "dataBase64"]) &&
    Number.isSafeInteger(frame.timestampMs) &&
    (frame.timestampMs as number) >= 0 &&
    (frame.timestampMs as number) <= MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS &&
    frame.mimeType === "image/jpeg" &&
    typeof frame.dataBase64 === "string" &&
    frame.dataBase64.length > 0 &&
    frame.dataBase64.length <= MAX_CANDIDATE_PASS_B_VIDEO_FRAME_BASE64_LENGTH
  )) {
    return false;
  }
  if (
    !isCandidatePassBContextPacket(value.context) ||
    value.frameExtractionRevision !==
      CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION ||
    typeof value.contextFingerprint !== "string" ||
    value.contextFingerprint !== candidatePassBContextFingerprint(value.context)
  ) {
    return false;
  }
  if (
    value.castRosterId !== null &&
    !isCandidatePassBCastRosterId(value.castRosterId)
  ) {
    return false;
  }
  if (!isAnalysisLanguage(value.outputLanguage)) {
    return false;
  }
  const frameTimestamps = rawFrames.map(
    (frame) => (frame as Record<string, unknown>).timestampMs as number,
  );
  return (
    isNonEmptyString(value.candidateId) &&
    isNonNegativeSafeInteger(value.startMs) &&
    isNonNegativeSafeInteger(value.endMs) &&
    value.endMs > value.startMs &&
    value.endMs <= sourceDurationMs &&
    value.endMs - value.startMs <= MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS &&
    new Set(frameTimestamps).size ===
      MAX_CANDIDATE_PASS_B_VIDEO_FRAMES &&
    frameTimestamps.every(
      (timestampMs) =>
        timestampMs < (value.endMs as number) - (value.startMs as number),
    )
  );
}

function isValidAnalyzeRequest(value: unknown): value is AnalyzeRequest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "type",
      "identity",
      "quota",
      "file",
      "sourceFingerprint",
      "sourceDurationMs",
      "device",
      "targets",
    ])
  ) {
    return false;
  }
  if (
    (!isRecord(value.quota) ||
      !hasExactKeys(value.quota, [
        "participantId",
        "runId",
        "attemptOrdinal",
        "retryGrantId",
      ]) ||
      !isAiQuotaParticipantId(value.quota.participantId) ||
      !isAiQuotaOpaqueId(value.quota.runId) ||
      !Number.isSafeInteger(value.quota.attemptOrdinal) ||
      (value.quota.attemptOrdinal as number) < 0 ||
      ((value.quota.attemptOrdinal === 0 &&
        value.quota.retryGrantId !== null) ||
        (value.quota.attemptOrdinal !== 0 &&
          (!isNonEmptyString(value.quota.retryGrantId) ||
            value.quota.retryGrantId.length > 240))))
  ) {
    return false;
  }
  if (
    value.type !== "candidate-pass-b-analyze" ||
    !isValidIdentity(value.identity) ||
    !isNonEmptyString(value.sourceFingerprint) ||
    value.sourceFingerprint.length > 512 ||
    !(value.file instanceof File) ||
    !Number.isFinite(value.file.size) ||
    value.file.size < 0 ||
    !isNonNegativeSafeInteger(value.sourceDurationMs) ||
    value.sourceDurationMs <= 0 ||
    value.sourceDurationMs > MAX_CANDIDATE_PASS_B_SOURCE_DURATION_MS ||
    value.device !== CANDIDATE_PASS_B_DEVICE ||
    !Array.isArray(value.targets) ||
    value.targets.length === 0 ||
    value.targets.length > MAX_CANDIDATE_PASS_B_TARGETS
  ) {
    return false;
  }
  const sourceDurationMs = value.sourceDurationMs;
  if (!value.targets.every((target) => isValidTarget(target, sourceDurationMs))) {
    return false;
  }
  const candidateIds = new Set(
    value.targets.map((target) => target.candidateId),
  );
  return candidateIds.size === value.targets.length;
}

function isValidCancelRequest(
  value: unknown,
): value is Extract<
  CandidatePassBWorkerRequest,
  { readonly type: "candidate-pass-b-cancel" }
> {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["type", "identity"]) &&
    value.type === "candidate-pass-b-cancel" &&
    isValidIdentity(value.identity)
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function candidateGap(
  target: CandidatePassBTarget,
  reasonCode: CandidatePassBCandidateGapReason,
  message: string,
): CandidatePassBCandidateGap {
  return {
    candidateId: target.candidateId,
    sourceStartMs: target.startMs,
    sourceEndMs: target.endMs,
    reasonCode,
    message,
  };
}

function postGap(
  identity: CandidatePassBWorkerIdentity,
  target: CandidatePassBTarget,
  candidateOrdinal: number,
  targetCount: number,
  reasonCode: CandidatePassBCandidateGapReason,
  message: string,
): void {
  postCandidateProgress(identity, {
    candidateId: target.candidateId,
    candidateOrdinal,
    targetCount,
    stage: "gap",
    ratio: 1,
  });
  postResponse(identity, {
    type: "candidate-pass-b-candidate-gap",
    gap: candidateGap(target, reasonCode, message),
  });
}

function postAllTargetsAsGaps(
  request: AnalyzeRequest,
  reasonCode: CandidatePassBCandidateGapReason,
  message: string,
): void {
  request.targets.forEach((target, index) => {
    postGap(
      request.identity,
      target,
      index + 1,
      request.targets.length,
      reasonCode,
      message,
    );
  });
  postResponse(request.identity, {
    type: "candidate-pass-b-completed",
    summary: {
      requestedCount: request.targets.length,
      completedCount: 0,
      gapCount: request.targets.length,
    },
  });
}

class CandidatePcmBuilder {
  private channelScratch = new Float32Array(0);
  private monoScratch = new Float32Array(0);
  private nextOutputFrame = 0;
  private decodedOverlapFrameCount = 0;

  public readonly pcm: Float32Array;

  public constructor(private readonly target: CandidatePassBTarget) {
    const durationSeconds = (target.endMs - target.startMs) / 1_000;
    this.pcm = new Float32Array(
      Math.max(1, Math.ceil(durationSeconds * CANDIDATE_PASS_B_SAMPLE_RATE_HZ)),
    );
  }

  public consume(sample: AudioSample): void {
    if (
      sample.numberOfFrames <= 0 ||
      sample.numberOfChannels <= 0 ||
      sample.sampleRate <= 0
    ) {
      return;
    }

    const targetStartSeconds = this.target.startMs / 1_000;
    const targetEndSeconds = this.target.endMs / 1_000;
    const sampleStartSeconds = sample.timestamp;
    const sampleEndSeconds = sample.timestamp + sample.duration;
    const overlapStartSeconds = Math.max(targetStartSeconds, sampleStartSeconds);
    const overlapEndSeconds = Math.min(targetEndSeconds, sampleEndSeconds);
    if (overlapEndSeconds <= overlapStartSeconds) {
      return;
    }

    this.decodedOverlapFrameCount += Math.max(
      1,
      Math.floor((overlapEndSeconds - overlapStartSeconds) * sample.sampleRate),
    );
    this.ensureScratchCapacity(sample.numberOfFrames);
    const channel = this.channelScratch.subarray(0, sample.numberOfFrames);
    const mono = this.monoScratch.subarray(0, sample.numberOfFrames);
    mono.fill(0);

    for (
      let channelIndex = 0;
      channelIndex < sample.numberOfChannels;
      channelIndex += 1
    ) {
      sample.copyTo(channel, {
        planeIndex: channelIndex,
        format: "f32-planar",
      });
      for (
        let frameIndex = 0;
        frameIndex < sample.numberOfFrames;
        frameIndex += 1
      ) {
        const value = channel[frameIndex] ?? 0;
        mono[frameIndex] =
          (mono[frameIndex] ?? 0) +
          (Number.isFinite(value) ? value : 0) / sample.numberOfChannels;
      }
    }

    const firstOutputFrame = clampInteger(
      Math.ceil(
        (Math.max(sampleStartSeconds, targetStartSeconds) - targetStartSeconds) *
          CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
      ),
      0,
      this.pcm.length,
    );
    const lastOutputFrameExclusive = clampInteger(
      Math.ceil(
        (Math.min(sampleEndSeconds, targetEndSeconds) - targetStartSeconds) *
          CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
      ),
      0,
      this.pcm.length,
    );
    this.nextOutputFrame = Math.max(this.nextOutputFrame, firstOutputFrame);

    while (this.nextOutputFrame < lastOutputFrameExclusive) {
      const outputTimestampSeconds =
        targetStartSeconds +
        this.nextOutputFrame / CANDIDATE_PASS_B_SAMPLE_RATE_HZ;
      const sourcePosition =
        (outputTimestampSeconds - sampleStartSeconds) * sample.sampleRate;
      if (sourcePosition < 0) {
        this.nextOutputFrame += 1;
        continue;
      }
      if (sourcePosition >= sample.numberOfFrames) {
        break;
      }

      const lowerIndex = Math.floor(sourcePosition);
      const upperIndex = Math.min(sample.numberOfFrames - 1, lowerIndex + 1);
      const interpolation = sourcePosition - lowerIndex;
      const lowerValue = mono[lowerIndex] ?? 0;
      const upperValue = mono[upperIndex] ?? lowerValue;
      this.pcm[this.nextOutputFrame] = clamp(
        lowerValue + (upperValue - lowerValue) * interpolation,
        -1,
        1,
      );
      this.nextOutputFrame += 1;
    }
  }

  public finish(): DecodedCandidate {
    return {
      pcm: this.pcm,
      decodedOverlapFrameCount: this.decodedOverlapFrameCount,
    };
  }

  private ensureScratchCapacity(frameCount: number): void {
    if (this.channelScratch.length >= frameCount) {
      return;
    }
    const capacity = nextPowerOfTwo(frameCount);
    this.channelScratch = new Float32Array(capacity);
    this.monoScratch = new Float32Array(capacity);
  }
}

async function decodeCandidate(
  audioTrack: InputAudioTrack,
  target: CandidatePassBTarget,
  candidateOrdinal: number,
  targetCount: number,
  task: ActiveTask,
): Promise<DecodedCandidate | null> {
  const builder = new CandidatePcmBuilder(target);
  const sink = new AudioSampleSink(audioTrack);
  const targetStartSeconds = target.startMs / 1_000;
  const targetEndSeconds = target.endMs / 1_000;
  let lastRatio = 0;
  let lastPostedAt = 0;

  postCandidateProgress(task.identity, {
    candidateId: target.candidateId,
    candidateOrdinal,
    targetCount,
    stage: "decoding",
    ratio: 0,
  });

  try {
    for await (const sample of sink.samples(targetStartSeconds, targetEndSeconds)) {
      try {
        if (task.cancelled) {
          builder.pcm.fill(0);
          return null;
        }
        builder.consume(sample);
        const decodedThroughSeconds = clamp(
          sample.timestamp + sample.duration,
          targetStartSeconds,
          targetEndSeconds,
        );
        const rangeRatio =
          (decodedThroughSeconds - targetStartSeconds) /
          (targetEndSeconds - targetStartSeconds);
        const nextRatio = clamp(
          rangeRatio * CANDIDATE_DECODE_RATIO_CEILING,
          0,
          CANDIDATE_DECODE_RATIO_CEILING,
        );
        const now = Date.now();
        if (
          nextRatio > lastRatio &&
          (nextRatio - lastRatio >= PROGRESS_MIN_RATIO_STEP ||
            now - lastPostedAt >= PROGRESS_MIN_INTERVAL_MS)
        ) {
          lastRatio = nextRatio;
          lastPostedAt = now;
          postCandidateProgress(task.identity, {
            candidateId: target.candidateId,
            candidateOrdinal,
            targetCount,
            stage: "decoding",
            ratio: round(nextRatio),
          });
        }
      } finally {
        sample.close();
      }
    }
  } catch (cause) {
    if (task.cancelled || cause instanceof InputDisposedError) {
      builder.pcm.fill(0);
      return null;
    }
    builder.pcm.fill(0);
    if (isUnsupportedAudioCodecError(cause)) {
      throw new CandidateFailure(
        "UNSUPPORTED_AUDIO_CODEC",
        "이 브라우저에서 이 영상의 오디오 코덱을 읽을 수 없어요.",
      );
    }
    throw new CandidateFailure(
      "AUDIO_DECODE_FAILED",
      "이 후보 구간의 오디오를 읽는 중 문제가 생겼어요.",
    );
  }

  if (task.cancelled) {
    builder.pcm.fill(0);
    return null;
  }
  const decoded = builder.finish();
  // A valid video range may contain silence or no overlapping audio samples.
  // Keep the zero-filled PCM so VAD can issue a verified-no-speech receipt and
  // the provider can still inspect all four prepared frames.
  return decoded;
}

class CandidateOutcomeUnknownFailure extends Error {
  public constructor(
    public readonly settlement: CandidatePassBOutcomeUnknownSettlement,
  ) {
    super("Candidate provider outcome is unknown.");
    this.name = "CandidateOutcomeUnknownFailure";
  }
}

function isValidDispatchArmAckRequest(
  value: unknown,
): value is Extract<
  CandidatePassBWorkerRequest,
  { readonly type: "candidate-pass-b-dispatch-arm-ack" }
> {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["type", "identity", "operationId", "accepted"]) &&
    value.type === "candidate-pass-b-dispatch-arm-ack" &&
    isValidIdentity(value.identity) &&
    isNonEmptyString(value.operationId) &&
    value.operationId.length <= 180 &&
    typeof value.accepted === "boolean"
  );
}

function isValidTerminalResultAckRequest(
  value: unknown,
): value is Extract<
  CandidatePassBWorkerRequest,
  { readonly type: "candidate-pass-b-terminal-result-ack" }
> {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "type",
      "identity",
      "terminalEventId",
      "candidateId",
      "settlement",
      "accepted",
    ]) &&
    value.type === "candidate-pass-b-terminal-result-ack" &&
    isValidIdentity(value.identity) &&
    isNonEmptyString(value.terminalEventId) &&
    value.terminalEventId.length <= 512 &&
    isNonEmptyString(value.candidateId) &&
    value.candidateId.length <= 180 &&
    isCandidatePassBTerminalSettlement(value.settlement) &&
    typeof value.accepted === "boolean"
  );
}

function sameTerminalSettlement(
  left: CandidatePassBTerminalSettlement,
  right: CandidatePassBTerminalSettlement,
): boolean {
  if (
    left.schemaVersion !== right.schemaVersion ||
    left.status !== right.status ||
    left.operationId !== right.operationId ||
    left.providerPayloadDigest !== right.providerPayloadDigest ||
    left.outputLanguage !== right.outputLanguage ||
    left.castRosterId !== right.castRosterId
  ) {
    return false;
  }
  if (left.status === "outcome-unknown") {
    return (
      right.status === "outcome-unknown" &&
      left.reason === right.reason
    );
  }
  return (
    right.status === "completed" &&
    left.responseDigest === right.responseDigest &&
    left.providerModelId === right.providerModelId &&
    left.providerModelRevision === right.providerModelRevision
  );
}

type CandidateRemoteTransport = CandidatePassBTransportMode | "unavailable";

const CANDIDATE_REMOTE_TRANSPORT_CACHE_TTL_MS = 60_000;

let candidateRemoteTransportCache: {
  readonly transport: Exclude<CandidateRemoteTransport, "unavailable">;
  readonly expiresAtMs: number;
} | null = null;
let candidateRemoteTransportPromise:
  | Promise<CandidateRemoteTransport>
  | null = null;

function candidateProxyOrigin(): string {
  return new URL(CANDIDATE_PASS_B_PROXY_ENDPOINT).origin;
}

async function resolveCandidateRemoteTransport(): Promise<CandidateRemoteTransport> {
  const nowMs = Date.now();
  if (
    candidateRemoteTransportCache !== null &&
    candidateRemoteTransportCache.expiresAtMs > nowMs
  ) {
    return candidateRemoteTransportCache.transport;
  }
  candidateRemoteTransportCache = null;
  if (candidateRemoteTransportPromise !== null) {
    return candidateRemoteTransportPromise;
  }
  const resolution = (async (): Promise<CandidateRemoteTransport> => {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(`${candidateProxyOrigin()}/healthz`, {
        method: "GET",
        signal: controller.signal,
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
      if (!response.ok) return "unavailable";
      const value: unknown = await response.json();
      if (!isRecord(value) || value.ok !== true) return "unavailable";
      if (!isRecord(value.candidateTransport)) {
        return "unavailable";
      }
      if (value.candidateTransport.configured !== true) {
        return "unavailable";
      }
      return value.candidateTransport.mode === "free-r2"
        ? "free-r2"
        : value.candidateTransport.mode === "paid-direct"
          ? "paid-direct"
          : "unavailable";
    } catch {
      return "unavailable";
    } finally {
      globalThis.clearTimeout(timeout);
    }
  })();
  candidateRemoteTransportPromise = resolution;
  try {
    const result = await resolution;
    if (result !== "unavailable") {
      candidateRemoteTransportCache = {
        transport: result,
        expiresAtMs: Date.now() + CANDIDATE_REMOTE_TRANSPORT_CACHE_TTL_MS,
      };
    }
    return result;
  } finally {
    if (candidateRemoteTransportPromise === resolution) {
      candidateRemoteTransportPromise = null;
    }
  }
}

async function stableCandidateHash(candidateId: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(candidateId),
    ),
  );
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  digest.fill(0);
  return hex.slice(0, 24);
}

async function sha256Bytes(value: Uint8Array): Promise<`sha256:${string}`> {
  const exact = new Uint8Array(value.byteLength);
  exact.set(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", exact));
  exact.fill(0);
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  digest.fill(0);
  return `sha256:${hex}`;
}

async function sha256Text(value: string): Promise<`sha256:${string}`> {
  return sha256Bytes(new TextEncoder().encode(value));
}

async function createDispatchIntent(
  request: AnalyzeRequest,
  target: CandidatePassBTarget,
  wav: Uint8Array,
  gate: CandidatePassBAudioGateSummary,
  transportMode: CandidatePassBTransportMode,
): Promise<CandidatePassBDispatchIntent> {
  const frames = await Promise.all(
    target.videoFrames.map(async (frame) => {
      const bytes = decodeCandidateFrameBase64(frame.dataBase64);
      try {
        return {
          timestampMs: frame.timestampMs,
          mimeType: "image/jpeg" as const,
          byteLength: bytes.byteLength,
          contentDigest: await sha256Bytes(bytes),
          extractionRevision: CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
        };
      } finally {
        bytes.fill(0);
      }
    }),
  );
  if (frames.length !== 4) {
    throw new ProxyWorkerFailure("PROXY_BAD_REQUEST");
  }
  const wavContentDigest = await sha256Bytes(wav);
  const audio = gate.audible
    ? {
        kind: "audible-audio" as const,
        wavByteLength: wav.byteLength,
        wavContentDigest,
        sampleRateHz: CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
        sampleCount: Math.max(0, (wav.byteLength - 44) / 2),
      }
    : {
        kind: "verified-no-speech" as const,
        wavByteLength: wav.byteLength,
        wavContentDigest,
        sampleRateHz: CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
        sampleCount: Math.max(0, (wav.byteLength - 44) / 2),
        vadRevision: CANDIDATE_PASS_B_AUDIO_GATE_REVISION,
        frameCount: gate.frameCount,
        activeFrameCount: gate.activeFrameCount,
        activeFrameRatio: gate.activeFrameRatio,
        audible: false as const,
      };
  const providerPayloadDigest = await sha256Text(
    JSON.stringify([
      "candidate-pass-b-provider-payload-v1",
      target.candidateId,
      target.startMs,
      target.endMs,
      target.contextFingerprint,
      target.castRosterId,
      target.outputLanguage,
      wavContentDigest,
      frames.map((frame) => [
        frame.timestampMs,
        frame.byteLength,
        frame.contentDigest,
        frame.extractionRevision,
      ]),
      CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
    ]),
  );
  const attemptOrdinal = request.quota.attemptOrdinal;
  const operationId = await createCandidatePassBOperationId({
    analysisRunId: request.identity.analysisRunId,
    sourceFingerprint: request.sourceFingerprint,
    candidateId: target.candidateId,
    sourceStartMs: target.startMs,
    sourceEndMs: target.endMs,
    contextFingerprint: target.contextFingerprint,
    outputLanguage: target.outputLanguage,
    castRosterId: target.castRosterId,
    routingModelRevision: CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
    attemptOrdinal,
    retryGrantId: request.quota.retryGrantId,
    transportMode,
    providerPayloadDigest,
  });
  return {
    schemaVersion: CANDIDATE_PASS_B_DISPATCH_INTENT_SCHEMA_VERSION,
    operationId,
    analysisRunId: request.identity.analysisRunId,
    candidateId: target.candidateId,
    sourceFingerprint: request.sourceFingerprint,
    sourceStartMs: target.startMs,
    sourceEndMs: target.endMs,
    contextFingerprint: target.contextFingerprint,
    outputLanguage: target.outputLanguage,
    castRosterId: target.castRosterId,
    routingModelRevision: CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
    attemptOrdinal,
    retryGrantId: request.quota.retryGrantId,
    transportMode,
    mediaReceipt: {
      schemaVersion: CANDIDATE_PASS_B_MEDIA_RECEIPT_SCHEMA_VERSION,
      frameExtractionRevision: CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
      frames: frames as [
        (typeof frames)[number],
        (typeof frames)[number],
        (typeof frames)[number],
        (typeof frames)[number],
      ],
      audio,
      providerPayloadDigest,
    },
  };
}

async function requireDurableDispatchArm(
  task: ActiveTask,
  intent: CandidatePassBDispatchIntent,
): Promise<void> {
  if (task.cancelled || task.dispatchArmWaiters.has(intent.operationId)) {
    throw new ProxyWorkerFailure("DISPATCH_NOT_ARMED");
  }
  const accepted = await new Promise<boolean>((resolve) => {
    task.dispatchArmWaiters.set(intent.operationId, { resolve });
    postResponse(task.identity, {
      type: "candidate-pass-b-dispatch-intent",
      intent,
    });
  });
  task.dispatchArmWaiters.delete(intent.operationId);
  /*
   * Once the main thread has durably accepted the intent, cancellation cannot
   * turn it back into an unarmed request. The caller must terminalize that
   * exact operation before the Worker acknowledges cancellation.
   */
  if (!accepted) {
    throw new ProxyWorkerFailure("DISPATCH_NOT_ARMED");
  }
}

async function requireDurableTerminalResultAck(
  task: ActiveTask,
  candidateId: string,
  settlement: CandidatePassBTerminalSettlement,
  response: Extract<
    CandidatePassBWorkerResponsePayload,
    {
      readonly type:
        | "candidate-pass-b-partial-result"
        | "candidate-pass-b-outcome-unknown";
    }
  >,
): Promise<void> {
  const terminalEventId = createEventId(task.identity.taskId);
  const accepted = new Promise<boolean>((resolve) => {
    task.terminalResultAckWaiters.set(terminalEventId, {
      candidateId,
      settlement,
      resolve,
    });
  });
  try {
    postResponse(task.identity, response, terminalEventId);
    if (!(await accepted)) {
      throw new ProxyWorkerFailure("TERMINAL_NOT_ACKNOWLEDGED");
    }
  } finally {
    task.terminalResultAckWaiters.delete(terminalEventId);
  }
}

function decodeCandidateFrameBase64(value: string): Uint8Array {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value,
    )
  ) {
    throw new ProxyWorkerFailure("PROXY_BAD_REQUEST");
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new ProxyWorkerFailure("PROXY_BAD_REQUEST");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function createCandidateMediaBundle(
  wav: Uint8Array,
  frames: NonNullable<CandidatePassBTarget["videoFrames"]>,
): CandidateMediaBundle {
  if (frames.length !== 4) {
    throw new ProxyWorkerFailure("PROXY_BAD_REQUEST");
  }
  const decodedFrames = frames.map((frame) =>
    decodeCandidateFrameBase64(frame.dataBase64),
  );
  try {
    const totalByteLength =
      wav.byteLength +
      decodedFrames.reduce((total, frame) => total + frame.byteLength, 0);
    const bytes = new Uint8Array(totalByteLength);
    bytes.set(wav, 0);
    let offset = wav.byteLength;
    for (const frame of decodedFrames) {
      bytes.set(frame, offset);
      offset += frame.byteLength;
    }
    return {
      bytes,
      frameByteLengths: decodedFrames.map(
        (frame) => frame.byteLength,
      ) as unknown as readonly [number, number, number, number],
    };
  } finally {
    for (const frame of decodedFrames) frame.fill(0);
  }
}

function candidateMediaStageUrl(
  target: CandidatePassBTarget,
  candidateHash: string,
  audioByteLength: number,
  frameByteLengths: readonly [number, number, number, number],
): string {
  const frames = target.videoFrames ?? [];
  const url = new URL(
    CANDIDATE_INSIGHT_MEDIA_ENDPOINT_PATH,
    candidateProxyOrigin(),
  );
  url.searchParams.set("candidateHash", candidateHash);
  url.searchParams.set(
    "durationMs",
    String(target.endMs - target.startMs),
  );
  url.searchParams.set("audioBytes", String(audioByteLength));
  for (let index = 0; index < 4; index += 1) {
    url.searchParams.set(`f${index}t`, String(frames[index]?.timestampMs ?? -1));
    url.searchParams.set(`f${index}b`, String(frameByteLengths[index] ?? -1));
  }
  return url.toString();
}

async function requestCandidateWithStagedMedia(
  wav: Uint8Array,
  target: CandidatePassBTarget,
  task: ActiveTask,
  candidateHash: string,
  bundle: CandidateMediaBundle,
  operationId: string,
  signal: AbortSignal,
): Promise<Response> {
  let mediaTicket: string | null = null;
  return fetchWithPreparedAiQuota(
        bundle.bytes as Uint8Array<ArrayBuffer>,
        {
          participantId: task.quota.participantId,
          runId: task.quota.runId,
          operationId,
          pool: "candidate",
          signal,
        },
        async (lease) => {
          const leaseHeaders = aiQuotaLeaseHeaders(lease);
          if (mediaTicket === null) {
            const stagedOrError = await fetch(
              candidateMediaStageUrl(
                target,
                candidateHash,
                wav.byteLength,
                bundle.frameByteLengths,
              ),
              {
                method: "POST",
                headers: {
                  ...leaseHeaders,
                  "Content-Type": CANDIDATE_INSIGHT_MEDIA_BUNDLE_CONTENT_TYPE,
                },
                body: bundle.bytes as Uint8Array<ArrayBuffer>,
                signal,
                credentials: "omit",
                cache: "no-store",
                referrerPolicy: "no-referrer",
              },
            );
            if (stagedOrError.status !== 202) return stagedOrError;
            const replayableResponse = stagedOrError.clone();
            let value: unknown;
            try {
              value = await stagedOrError.json();
            } catch {
              return replayableResponse;
            }
            const staged = parseCandidateInsightMediaStagedResponse(
              value,
              candidateHash,
              target.endMs - target.startMs,
            );
            if (staged === null) return replayableResponse;
            mediaTicket = staged.mediaTicket;
          }
          return fetch(CANDIDATE_PASS_B_PROXY_ENDPOINT, {
            method: "POST",
            headers: {
              ...leaseHeaders,
              "Content-Type": CANDIDATE_INSIGHT_MEDIA_RESOLVE_CONTENT_TYPE,
            },
            body: JSON.stringify(
              createCandidateInsightMediaResolveRequest(
                mediaTicket,
                target.endMs - target.startMs,
                target.castRosterId,
                target.outputLanguage,
                target.context ?? null,
              ),
            ),
            signal,
            credentials: "omit",
            cache: "no-store",
            referrerPolicy: "no-referrer",
          });
        },
      );
}

async function requestCandidateDirect(
  serializedRequest: string,
  task: ActiveTask,
  operationId: string,
  signal: AbortSignal,
): Promise<Response> {
  const requestInit: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: serializedRequest,
    signal,
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
  };
  return fetchWithAiQuota(CANDIDATE_PASS_B_PROXY_ENDPOINT, requestInit, {
        participantId: task.quota.participantId,
        runId: task.quota.runId,
        operationId,
        pool: "candidate",
        signal,
      });
}

async function analyzeCandidateWithRemoteAi(
  pcm: Float32Array,
  target: CandidatePassBTarget,
  request: AnalyzeRequest,
  task: ActiveTask,
): Promise<CandidatePassBTranscriptResult | null> {
  const wav = encodeCandidatePassBPcm16Wav(
    pcm,
    CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  );
  const fetchAbortController = new AbortController();
  task.fetchAbortControllers.add(fetchAbortController);
  let stagedMediaBundle: CandidateMediaBundle | null = null;

  try {
    const gate = summarizeCandidatePassBAudioGate(
      pcm,
      CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
    );
    let transport: CandidatePassBTransportMode;
    try {
      const resolvedTransport = await resolveCandidateRemoteTransport();
      if (resolvedTransport === "unavailable") {
        throw new ProxyWorkerFailure("PROXY_UNAVAILABLE");
      }
      transport = resolvedTransport;
    } catch (error) {
      if (error instanceof ProxyWorkerFailure) throw error;
      throw new ProxyWorkerFailure("PROXY_UNAVAILABLE");
    }
    const candidateHash = await stableCandidateHash(target.candidateId);
    let serializedDirectRequest: string | null = null;
    if (transport === "free-r2") {
      /*
       * Decode and validate all local media before the durable arm. A malformed
       * frame must never leave an append-only armed attempt behind.
       */
      stagedMediaBundle = createCandidateMediaBundle(
        wav,
        target.videoFrames,
      );
    } else {
      /*
       * Base64 conversion and JSON serialization are also deterministic local
       * work. Complete them before the durable arm for the same reason.
       */
      serializedDirectRequest = JSON.stringify(
        buildCandidatePassBProxyRequestBody(
          encodeCandidatePassBBase64(wav),
          target.endMs - target.startMs,
          target.videoFrames,
          target.castRosterId,
          target.outputLanguage,
          target.context,
        ),
      );
    }
    const dispatchIntent = await createDispatchIntent(
      request,
      target,
      wav,
      gate,
      transport,
    );
    await requireDurableDispatchArm(task, dispatchIntent);

    try {
      if (task.cancelled || fetchAbortController.signal.aborted) {
        throw new DOMException(
          "Candidate dispatch was cancelled after durable arm.",
          "AbortError",
        );
      }
      let response: Response;
      if (transport === "free-r2") {
        if (stagedMediaBundle === null) {
          throw new ProxyWorkerFailure("PROXY_BAD_REQUEST");
        }
        response = await requestCandidateWithStagedMedia(
          wav,
          target,
          task,
          candidateHash,
          stagedMediaBundle,
          dispatchIntent.operationId,
          fetchAbortController.signal,
        );
      } else {
        if (serializedDirectRequest === null) {
          throw new ProxyWorkerFailure("PROXY_BAD_REQUEST");
        }
        response = await requestCandidateDirect(
          serializedDirectRequest,
          task,
          dispatchIntent.operationId,
          fetchAbortController.signal,
        );
      }

      if (task.cancelled || fetchAbortController.signal.aborted) {
        throw new DOMException(
          "Candidate dispatch was cancelled after provider transport.",
          "AbortError",
        );
      }
      if (!response.ok) {
        let errorPayload: unknown;
        try {
          const rawError = await response.text();
          if (
            new TextEncoder().encode(rawError).byteLength >
            MAX_CANDIDATE_PASS_B_RESPONSE_BYTES
          ) {
            throw new ProxyWorkerFailure("PROXY_INVALID_RESPONSE");
          }
          errorPayload = JSON.parse(rawError);
        } catch (error) {
          if (error instanceof ProxyWorkerFailure) {
            throw error;
          }
          errorPayload = undefined;
        }
        throw new ProxyWorkerFailure(
          classifyCandidatePassBProxyHttpFailure(response.status, errorPayload)
            .reasonCode,
        );
      }

      let rawResponse: string;
      try {
        rawResponse = await response.text();
      } catch {
        if (task.cancelled || fetchAbortController.signal.aborted) {
          throw new DOMException(
            "Candidate response was interrupted after dispatch.",
            "AbortError",
          );
        }
        throw new ProxyWorkerFailure("PROXY_UNAVAILABLE");
      }
      if (task.cancelled || fetchAbortController.signal.aborted) {
        throw new DOMException(
          "Candidate response was cancelled before settlement.",
          "AbortError",
        );
      }
      if (
        new TextEncoder().encode(rawResponse).byteLength >
        MAX_CANDIDATE_PASS_B_RESPONSE_BYTES
      ) {
        throw new ProxyWorkerFailure("PROXY_INVALID_RESPONSE");
      }

      let responsePayload: unknown;
      try {
        responsePayload = JSON.parse(rawResponse);
      } catch {
        throw new ProxyWorkerFailure("PROXY_INVALID_RESPONSE");
      }
      const parsed = extractCandidatePassBGeminiResponse(
        responsePayload,
        target.endMs - target.startMs,
        target.castRosterId,
        target.outputLanguage,
      );
      if (!parsed.ok) {
        throw new ProxyWorkerFailure("PROXY_INVALID_RESPONSE");
      }

      const responseModelId = response.headers.get(
        CANDIDATE_PASS_B_RESPONSE_MODEL_ID_HEADER,
      );
      const responseModelRevision = response.headers.get(
        CANDIDATE_PASS_B_RESPONSE_MODEL_REVISION_HEADER,
      );
      const model =
        responseModelId === CANDIDATE_PASS_B_GEMINI_MODEL_ID &&
        responseModelRevision === CANDIDATE_PASS_B_GEMINI_MODEL_REVISION
          ? {
              id: CANDIDATE_PASS_B_GEMINI_MODEL_ID,
              revision: CANDIDATE_PASS_B_GEMINI_MODEL_REVISION,
            }
          : responseModelId === CANDIDATE_PASS_B_QWEN_MODEL_ID &&
              responseModelRevision === CANDIDATE_PASS_B_QWEN_MODEL_REVISION
            ? {
                id: CANDIDATE_PASS_B_QWEN_MODEL_ID,
                revision: CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
              }
            : null;
      if (model === null) {
        throw new ProxyWorkerFailure("PROXY_INVALID_RESPONSE");
      }
      const settlement: CandidatePassBCompletedSettlement = {
        schemaVersion: CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION,
        status: "completed",
        operationId: dispatchIntent.operationId,
        providerPayloadDigest:
          dispatchIntent.mediaReceipt.providerPayloadDigest,
        outputLanguage: dispatchIntent.outputLanguage,
        castRosterId: dispatchIntent.castRosterId,
        responseDigest: await sha256Text(rawResponse),
        providerModelId: model.id,
        providerModelRevision: model.revision,
      };

      const segments = parsed.analysis.segments.map((segment) => ({
        startMs: target.startMs + segment.relativeStartMs,
        endMs: target.startMs + segment.relativeEndMs,
        text: segment.text,
      }));
      return {
        mode: "candidate-pass-b-transcript",
        candidateId: target.candidateId,
        sourceStartMs: target.startMs,
        sourceEndMs: target.endMs,
        text: segments.map((segment) => segment.text).join(" "),
        segments,
        insight: parsed.analysis.insight,
        model: {
          ...model,
          dtype: CANDIDATE_PASS_B_DTYPE,
          device: CANDIDATE_PASS_B_DEVICE,
        },
        language: CANDIDATE_PASS_B_LANGUAGE,
        task: CANDIDATE_PASS_B_TASK,
        sampleRateHz: CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
        settlement,
      };
    } catch (error) {
      if (error instanceof CandidateOutcomeUnknownFailure) throw error;
      throw new CandidateOutcomeUnknownFailure({
        schemaVersion: CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION,
        status: "outcome-unknown",
        operationId: dispatchIntent.operationId,
        providerPayloadDigest:
          dispatchIntent.mediaReceipt.providerPayloadDigest,
        outputLanguage: dispatchIntent.outputLanguage,
        castRosterId: dispatchIntent.castRosterId,
        reason:
          error instanceof AiQuotaClientError &&
          error.code === "OUTCOME_UNKNOWN"
            ? "quota-outcome-unknown"
            : "armed-dispatch-interrupted",
      });
    }
  } finally {
    task.fetchAbortControllers.delete(fetchAbortController);
    stagedMediaBundle?.bytes.fill(0);
    wav.fill(0);
  }
}

async function openAudioTrack(
  request: AnalyzeRequest,
  task: ActiveTask,
): Promise<InputAudioTrack | null> {
  task.input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(request.file, { maxCacheSize: SOURCE_CACHE_BYTES }),
  });
  if (task.cancelled) {
    return null;
  }
  return task.input.getPrimaryAudioTrack();
}

async function runTask(request: AnalyzeRequest, task: ActiveTask): Promise<void> {
  try {
    let audioTrack: InputAudioTrack | null;
    try {
      audioTrack = await openAudioTrack(request, task);
    } catch (cause) {
      if (task.cancelled || cause instanceof InputDisposedError) {
        return;
      }
      if (cause instanceof UnsupportedInputFormatError) {
        postAllTargetsAsGaps(
          request,
          "UNSUPPORTED_CONTAINER",
          "이 영상 형식은 현재 브라우저에서 읽을 수 없어요.",
        );
        return;
      }
      postAllTargetsAsGaps(
        request,
        isUnsupportedAudioCodecError(cause)
          ? "UNSUPPORTED_AUDIO_CODEC"
          : "AUDIO_DECODE_FAILED",
        isUnsupportedAudioCodecError(cause)
          ? "이 브라우저에서 이 영상의 오디오 코덱을 읽을 수 없어요."
          : "영상의 오디오를 여는 중 문제가 생겼어요.",
      );
      return;
    }

    if (task.cancelled) {
      return;
    }
    if (audioTrack !== null) {
      try {
        if (!(await audioTrack.canDecode())) {
          postAllTargetsAsGaps(
            request,
            "UNSUPPORTED_AUDIO_CODEC",
            "이 브라우저에서 이 영상의 오디오 코덱을 읽을 수 없어요.",
          );
          return;
        }
      } catch (cause) {
        if (task.cancelled || cause instanceof InputDisposedError) {
          return;
        }
        postAllTargetsAsGaps(
          request,
          "UNSUPPORTED_AUDIO_CODEC",
          "이 브라우저에서 이 영상의 오디오 코덱을 읽을 수 없어요.",
        );
        return;
      }
    }

    postModelProgress(task.identity, {
      stage: "ready",
      ratio: 1,
      loadedBytes: null,
      totalBytes: null,
    });

    let completedCount = 0;
    let gapCount = 0;
    const fatalProxyFailures: ProxyWorkerFailure[] = [];
    const inFlight = new Set<Promise<void>>();
    candidateLoop: for (
      let index = 0;
      index < request.targets.length;
      index += 1
    ) {
      if (task.cancelled) {
        break;
      }
      const target = request.targets[index];
      if (target === undefined) {
        continue;
      }
      while (inFlight.size >= MAX_PARALLEL_GEMINI_REQUESTS) {
        if (task.cancelled) {
          break candidateLoop;
        }
        await Promise.race([...inFlight]);
      }
      const candidateOrdinal = index + 1;
      let candidatePcm: Float32Array | null = null;
      try {
        const decoded =
          audioTrack === null
            ? new CandidatePcmBuilder(target).finish()
            : await decodeCandidate(
                audioTrack,
                target,
                candidateOrdinal,
                request.targets.length,
                task,
              );
        if (task.cancelled || decoded === null) {
          break;
        }
        candidatePcm = decoded.pcm;
        if (
          summarizeCandidatePassBAudioGate(
            candidatePcm,
            CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
          ).frameCount < 0
        ) {
          throw new CandidateFailure(
            "TRANSCRIPTION_FAILED",
            "이 후보 구간에서 이어지는 말소리 단서를 찾지 못했어요.",
          );
        }
        postCandidateProgress(task.identity, {
          candidateId: target.candidateId,
          candidateOrdinal,
          targetCount: request.targets.length,
          stage: "transcribing",
          ratio: CANDIDATE_TRANSCRIBE_RATIO,
        });
        const pcmForRequest = candidatePcm;
        candidatePcm = null;
        const requestPromise = (async (): Promise<void> => {
          try {
            const result = await analyzeCandidateWithRemoteAi(
              pcmForRequest,
              target,
              request,
              task,
            );
            if (result === null) {
              return;
            }
            await requireDurableTerminalResultAck(
              task,
              result.candidateId,
              result.settlement,
              {
                type: "candidate-pass-b-partial-result",
                result,
              },
            );
            postCandidateProgress(task.identity, {
              candidateId: target.candidateId,
              candidateOrdinal,
              targetCount: request.targets.length,
              stage: "complete",
              ratio: 1,
            });
            completedCount += 1;
          } catch (cause) {
            if (cause instanceof CandidateOutcomeUnknownFailure) {
              const outcome = {
                candidateId: target.candidateId,
                sourceStartMs: target.startMs,
                sourceEndMs: target.endMs,
                settlement: cause.settlement,
              };
              await requireDurableTerminalResultAck(
                task,
                target.candidateId,
                cause.settlement,
                {
                  type: "candidate-pass-b-outcome-unknown",
                  outcome,
                },
              );
              postCandidateProgress(task.identity, {
                candidateId: target.candidateId,
                candidateOrdinal,
                targetCount: request.targets.length,
                stage: "gap",
                ratio: 1,
              });
              gapCount += 1;
              return;
            }
            if (task.cancelled || cause instanceof InputDisposedError) {
              return;
            }
            if (
              cause instanceof ProxyWorkerFailure &&
              cause.reasonCode !== "PROXY_INVALID_RESPONSE"
            ) {
              fatalProxyFailures.push(cause);
              return;
            }
            const failure =
              cause instanceof ProxyWorkerFailure
                ? new CandidateFailure(
                    "TRANSCRIPTION_FAILED",
                    "AI 응답에서 안전하게 후보 설명을 읽지 못했습니다.",
                  )
                : cause instanceof CandidateFailure
                  ? cause
                  : new CandidateFailure(
                      "TRANSCRIPTION_FAILED",
                      "후보 구간을 분석하는 중 문제가 발생했습니다.",
                    );
            postGap(
              task.identity,
              target,
              candidateOrdinal,
              request.targets.length,
              failure.reasonCode,
              failure.message,
            );
            gapCount += 1;
          } finally {
            pcmForRequest.fill(0);
          }
        })();
        inFlight.add(requestPromise);
        void requestPromise.then(
          () => {
            inFlight.delete(requestPromise);
          },
          () => {
            inFlight.delete(requestPromise);
          },
        );
      } catch (cause) {
        if (task.cancelled || cause instanceof InputDisposedError) {
          break;
        }
        const failure =
          cause instanceof ProxyWorkerFailure
            ? new CandidateFailure(
                "TRANSCRIPTION_FAILED",
                "AI 응답에서 안전하게 사용할 대사 단서를 얻지 못했어요.",
              )
            : cause instanceof CandidateFailure
            ? cause
            : new CandidateFailure(
                "TRANSCRIPTION_FAILED",
                "이 후보 구간을 정밀 분석하는 중 문제가 생겼어요.",
              );
        postGap(
          task.identity,
          target,
          candidateOrdinal,
          request.targets.length,
          failure.reasonCode,
          failure.message,
        );
        gapCount += 1;
      } finally {
        if (candidatePcm !== null) {
          candidatePcm.fill(0);
          candidatePcm = null;
        }
      }
    }

    await Promise.all(inFlight);
    const fatalReasonCode = fatalProxyFailures[0]?.reasonCode;
    if (fatalReasonCode !== undefined) {
      throw new ProxyWorkerFailure(fatalReasonCode);
    }

    if (!task.cancelled) {
      postResponse(task.identity, {
        type: "candidate-pass-b-completed",
        summary: {
          requestedCount: request.targets.length,
          completedCount,
          gapCount,
        },
      });
    }
  } catch (cause) {
    if (task.cancelled || cause instanceof InputDisposedError) {
      return;
    }
    const reasonCode =
      cause instanceof ProxyWorkerFailure
        ? cause.reasonCode
        : "UNEXPECTED_WORKER_FAILURE";
    postResponse(task.identity, {
      type: "candidate-pass-b-failed",
      reasonCode,
      message: candidatePassBWorkerFailureMessage(reasonCode),
    });
  } finally {
    for (const waiter of task.dispatchArmWaiters.values()) {
      waiter.resolve(false);
    }
    task.dispatchArmWaiters.clear();
    for (const waiter of task.terminalResultAckWaiters.values()) {
      waiter.resolve(false);
    }
    task.terminalResultAckWaiters.clear();
    for (const controller of task.fetchAbortControllers) {
      controller.abort();
    }
    task.fetchAbortControllers.clear();
    disposeInputOnce(task);
    if (activeTask === task) {
      activeTask = null;
    }
    if (task.cancelAcknowledgementRequested) {
      postResponse(task.identity, {
        type: "candidate-pass-b-cancel-acknowledged",
      });
    }
  }
}

function handleCancel(
  request: Extract<
    CandidatePassBWorkerRequest,
    { readonly type: "candidate-pass-b-cancel" }
  >,
): void {
  const task = activeTask;
  if (task !== null && sameIdentity(task.identity, request.identity)) {
    task.cancelAcknowledgementRequested = true;
    task.cancelled = true;
    for (const controller of task.fetchAbortControllers) {
      controller.abort();
    }
    disposeInputOnce(task);
    return;
  }
  postResponse(request.identity, {
    type: "candidate-pass-b-cancel-acknowledged",
  });
}

function handleDispatchArmAck(
  request: Extract<
    CandidatePassBWorkerRequest,
    { readonly type: "candidate-pass-b-dispatch-arm-ack" }
  >,
): void {
  const task = activeTask;
  if (task === null || !sameIdentity(task.identity, request.identity)) return;
  const waiter = task.dispatchArmWaiters.get(request.operationId);
  if (waiter === undefined) return;
  task.dispatchArmWaiters.delete(request.operationId);
  waiter.resolve(request.accepted);
}

function handleTerminalResultAck(
  request: Extract<
    CandidatePassBWorkerRequest,
    { readonly type: "candidate-pass-b-terminal-result-ack" }
  >,
): void {
  const task = activeTask;
  if (task === null || !sameIdentity(task.identity, request.identity)) return;
  const waiter = task.terminalResultAckWaiters.get(request.terminalEventId);
  if (
    waiter === undefined ||
    waiter.candidateId !== request.candidateId ||
    !sameTerminalSettlement(waiter.settlement, request.settlement)
  ) {
    return;
  }
  task.terminalResultAckWaiters.delete(request.terminalEventId);
  waiter.resolve(request.accepted);
}

function isUnsupportedAudioCodecError(cause: unknown): boolean {
  if (
    typeof DOMException !== "undefined" &&
    cause instanceof DOMException &&
    cause.name === "NotSupportedError"
  ) {
    return true;
  }
  if (!(cause instanceof Error)) {
    return false;
  }
  const message = cause.message.toLowerCase();
  return (
    message.includes("cannot be decoded") ||
    message.includes("codec is not supported") ||
    message.includes("unsupported audio codec") ||
    (message.includes("audiodecoder") && message.includes("support"))
  );
}

function nextPowerOfTwo(value: number): number {
  let capacity = 1;
  const target = Math.max(1, Math.ceil(value));
  while (capacity < target) {
    capacity *= 2;
  }
  return capacity;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (isValidTerminalResultAckRequest(request)) {
    handleTerminalResultAck(request);
    return;
  }
  if (isValidDispatchArmAckRequest(request)) {
    handleDispatchArmAck(request);
    return;
  }
  if (isValidCancelRequest(request)) {
    handleCancel(request);
    return;
  }
  if (!isRecord(request) || request.type !== "candidate-pass-b-analyze") {
    return;
  }
  if (!isValidAnalyzeRequest(request)) {
    if (isValidIdentity(request.identity)) {
      postResponse(request.identity, {
        type: "candidate-pass-b-failed",
        reasonCode: "INVALID_REQUEST",
        message: candidatePassBWorkerFailureMessage("INVALID_REQUEST"),
      });
    }
    return;
  }
  if (activeTask !== null) {
    postResponse(request.identity, {
      type: "candidate-pass-b-failed",
      reasonCode: "WORKER_BUSY",
      message: candidatePassBWorkerFailureMessage("WORKER_BUSY"),
    });
    return;
  }

  const task: ActiveTask = {
    identity: request.identity,
    quota: request.quota,
    cancelled: false,
    cancelAcknowledgementRequested: false,
    input: null,
    inputWasDisposed: false,
    fetchAbortControllers: new Set(),
    dispatchArmWaiters: new Map(),
    terminalResultAckWaiters: new Map(),
  };
  activeTask = task;
  void runTask(request, task);
});

export {};
