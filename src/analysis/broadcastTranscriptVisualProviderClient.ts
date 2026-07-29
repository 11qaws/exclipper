import {
  AiQuotaClientError,
  fetchWithPreparedAiQuota,
  type FetchWithAiQuotaOptions,
  type PreparedAiQuotaFetch,
} from "./aiQuotaClient";
import { aiQuotaLeaseHeaders } from "./aiQuotaProtocol";
import {
  BROADCAST_TRANSCRIPT_VISUAL_MEDIA_RESOLVE_CONTENT_TYPE,
  CANDIDATE_INSIGHT_MEDIA_BUNDLE_CONTENT_TYPE,
  CANDIDATE_INSIGHT_MEDIA_ENDPOINT_PATH,
  createBroadcastTranscriptVisualMediaResolveRequest,
  parseCandidateInsightMediaStagedResponse,
} from "./candidateInsightMediaProtocol";
import {
  CANDIDATE_PASS_B_PROXY_ENDPOINT,
  MAX_CANDIDATE_PASS_B_RESPONSE_BYTES,
  extractCandidatePassBGeminiResponse,
} from "./candidatePassBGemini";
import {
  CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
  type CandidatePassBContextPacket,
  type CandidatePassBInsight,
} from "./candidatePassBWorkerProtocol";
import {
  candidatePassBCastReferenceForName,
  type CandidatePassBCastRosterId,
} from "./participantRoster";
import type { AnalysisLanguage } from "../domain/analysisLanguage";
import type {
  BroadcastTranscriptVisualParticipantAttribution,
  BroadcastTranscriptVisualParticipantOutcome,
  BroadcastTranscriptVisualProviderFailureReason,
} from "./broadcastTranscriptVisualInspectionQueue";
import {
  BROADCAST_TRANSCRIPT_VISUAL_TRANSPORT_MODE,
  type BroadcastTranscriptVisualProviderAdapterResult,
  type BroadcastTranscriptVisualProviderAttemptRequest,
  type BroadcastTranscriptVisualProviderFailureClassification,
  type BroadcastTranscriptVisualProviderOperationIdRequest,
  type RunBroadcastTranscriptVisualInspectionOptions,
} from "./broadcastTranscriptVisualInspectionRunner";
import { createBroadcastTranscriptVisualMediaContentFingerprint } from "./broadcastTranscriptVisualMediaEvidence";

export const BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_MODEL_REVISION =
  `${CANDIDATE_PASS_B_QWEN_MODEL_REVISION}:transcript-visual-r2-v2` as const;

const DEFAULT_MAXIMUM_CONCURRENCY = 2;

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type BroadcastTranscriptVisualPreparedQuotaTransport = (
  payloadBody: BodyInit | null | undefined,
  options: FetchWithAiQuotaOptions,
  preparedFetch: PreparedAiQuotaFetch,
) => Promise<Response>;

export interface CreateBroadcastTranscriptVisualProviderBatchAdapterOptions {
  readonly participantId: string;
  readonly runId: string;
  readonly castRosterId: CandidatePassBCastRosterId | null;
  readonly outputLanguage?: AnalysisLanguage;
  readonly context?: CandidatePassBContextPacket | null;
  readonly proxyEndpoint?: string;
  readonly fetchImplementation?: FetchImplementation;
  readonly quotaTransport?: BroadcastTranscriptVisualPreparedQuotaTransport;
  readonly maximumConcurrency?: number;
}

export interface BroadcastTranscriptVisualProviderBatchAdapter {
  readonly transportMode: typeof BROADCAST_TRANSCRIPT_VISUAL_TRANSPORT_MODE;
  readonly providerModelRevision:
    typeof BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_MODEL_REVISION;
  readonly executeProviderBatch:
    RunBroadcastTranscriptVisualInspectionOptions["executeProviderBatch"];
}

export class BroadcastTranscriptVisualProviderError extends Error {
  public readonly name = "BroadcastTranscriptVisualProviderError";

  public constructor(
    public readonly classification: BroadcastTranscriptVisualProviderFailureClassification,
    message: string,
  ) {
    super(message);
  }
}

function abortIfRequested(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new DOMException("Visual provider request was cancelled.", "AbortError");
  }
}

function bundleForRequest(
  request: BroadcastTranscriptVisualProviderAttemptRequest,
): {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly frameByteLengths: readonly [number, number, number, number];
} {
  if (
    request.transportMode !== BROADCAST_TRANSCRIPT_VISUAL_TRANSPORT_MODE ||
    request.mediaEvidence.verified !== true ||
    request.mediaEvidence.frames.length !== 4 ||
    request.mediaEvidence.planFingerprint !== request.planFingerprint ||
    request.mediaEvidence.sourceFingerprint !== request.sourceFingerprint ||
    request.mediaEvidence.cellId !== request.task.cellId
  ) {
    throw new BroadcastTranscriptVisualProviderError(
      { outcome: "retryable", failureReason: "invalid-response" },
      "Provider dispatch requires the same verified four-frame evidence.",
    );
  }
  const audio = request.mediaEvidence.audio?.bytes ?? null;
  if (
    (request.task.transcriptAbstentionReason !== "no-audio" &&
      audio === null) ||
    (request.task.transcriptAbstentionReason === "no-audio" &&
      audio !== null)
  ) {
    throw new BroadcastTranscriptVisualProviderError(
      { outcome: "retryable", failureReason: "invalid-response" },
      "Verified audio evidence does not match the transcript abstention.",
    );
  }
  const frameByteLengths = request.mediaEvidence.frames.map(
    ({ bytes }) => bytes.byteLength,
  ) as unknown as readonly [number, number, number, number];
  const totalByteLength =
    (audio?.byteLength ?? 0) +
    frameByteLengths.reduce((total, length) => total + length, 0);
  const bytes = new Uint8Array(new ArrayBuffer(totalByteLength));
  let offset = 0;
  if (audio !== null) {
    bytes.set(audio, offset);
    offset += audio.byteLength;
  }
  for (const frame of request.mediaEvidence.frames) {
    bytes.set(frame.bytes, offset);
    offset += frame.bytes.byteLength;
  }
  return { bytes, frameByteLengths };
}

async function stableCandidateHash(
  request: BroadcastTranscriptVisualProviderAttemptRequest,
): Promise<string> {
  const material = new TextEncoder().encode(
    [
      request.planFingerprint,
      request.sourceFingerprint,
      request.task.cellId,
      request.task.frameBundleKey,
      ...request.task.frameContentFingerprints,
      request.task.audioEvidence?.contentFingerprint ?? "no-audio",
    ].join("\u001f"),
  );
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", material),
  );
  return Array.from(digest.subarray(0, 12), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function stageUrl(
  proxyEndpoint: string,
  request: BroadcastTranscriptVisualProviderAttemptRequest,
  candidateHash: string,
  audioByteLength: number,
  frameByteLengths: readonly [number, number, number, number],
): string {
  const endpoint = new URL(proxyEndpoint);
  const url = new URL(
    CANDIDATE_INSIGHT_MEDIA_ENDPOINT_PATH,
    endpoint.origin,
  );
  const durationMs = request.task.sourceEndMs - request.task.sourceStartMs;
  url.searchParams.set("candidateHash", candidateHash);
  url.searchParams.set("durationMs", String(durationMs));
  url.searchParams.set("audioBytes", String(audioByteLength));
  for (let index = 0; index < 4; index += 1) {
    url.searchParams.set(
      `f${index}t`,
      String(
        (request.task.frameTimestampsMs[index] ?? request.task.sourceStartMs) -
          request.task.sourceStartMs,
      ),
    );
    url.searchParams.set(
      `f${index}b`,
      String(frameByteLengths[index] ?? -1),
    );
  }
  return url.toString();
}

function responseFailure(
  request: BroadcastTranscriptVisualProviderAttemptRequest,
  status: number,
): BroadcastTranscriptVisualProviderAdapterResult {
  let outcome: "retryable" | "outcome-unknown" = "retryable";
  let failureReason: BroadcastTranscriptVisualProviderFailureReason;
  if (status === 429) {
    failureReason = "rate-limited";
  } else if (status === 408 || status === 504) {
    outcome = "outcome-unknown";
    failureReason = "timeout-after-dispatch";
  } else if (status === 502 || (status >= 400 && status < 500)) {
    failureReason = "invalid-response";
  } else {
    failureReason = "provider-unavailable";
  }
  return {
    cellId: request.task.cellId,
    operationId: request.operationId,
    outcome,
    failureReason,
  };
}

function canonicalParticipantOutcome(
  insight: CandidatePassBInsight,
  castRosterId: CandidatePassBCastRosterId | null,
): BroadcastTranscriptVisualParticipantOutcome {
  if (
    insight.participantPresence === undefined ||
    insight.participantSummaryKo === undefined ||
    insight.identifiedParticipants === undefined
  ) {
    throw new BroadcastTranscriptVisualProviderError(
      { outcome: "retryable", failureReason: "invalid-response" },
      "The provider omitted the current participant outcome.",
    );
  }
  const canonical = new Map<
    string,
    BroadcastTranscriptVisualParticipantAttribution
  >();
  for (const attribution of insight.identifiedParticipants) {
    /*
     * This transport currently sends only the four broadcast frames and
     * optional cell audio. It does not send cast reference images, therefore
     * a model-authored `provided-cast-reference` claim is not evidence. Spoken
     * names belong to the transcript/voice adapters, not visual identity.
     */
    if (attribution.evidenceBasis !== "on-screen-name") continue;
    const reference = candidatePassBCastReferenceForName(
      castRosterId,
      attribution.displayName,
    );
    if (reference === null) continue;
    const next: BroadcastTranscriptVisualParticipantAttribution = {
      participantId: reference.participantId,
      displayName: reference.displayName,
      role: reference.role,
      evidenceBasis: attribution.evidenceBasis,
      evidenceKo: attribution.evidenceKo,
      confidence: attribution.confidence,
      relativeTimestampMs: attribution.relativeTimestampMs,
      observedFrameIndices: [...(attribution.observedFrameIndices ?? [])],
    };
    const previous = canonical.get(reference.participantId);
    if (previous === undefined || next.confidence > previous.confidence) {
      canonical.set(reference.participantId, next);
    }
  }
  const participants = [...canonical.values()];
  const rosterIdentificationUnavailable =
    participants.length === 0 &&
    insight.participantPresence === "identified";
  return {
    presence:
      participants.length > 0
        ? "identified"
        : rosterIdentificationUnavailable
          ? "present-unidentified"
          : insight.participantPresence,
    summaryKo: rosterIdentificationUnavailable
      ? "등록된 출연진 명단 안에서 근거화할 수 있는 인물을 확인하지 못했습니다."
      : insight.participantSummaryKo,
    participants,
  };
}

function terminalResult(
  request: BroadcastTranscriptVisualProviderAttemptRequest,
  insight: CandidatePassBInsight,
  providerResponseFingerprint: string,
  castRosterId: CandidatePassBCastRosterId | null,
): BroadcastTranscriptVisualProviderAdapterResult {
  const summaryKo = [
    insight.eventSummaryKo,
    insight.reactionSummaryKo,
    insight.whyGoodClipKo,
  ].join("\n");
  const participantOutcome = canonicalParticipantOutcome(
    insight,
    castRosterId,
  );
  if (insight.programMaterial === "music-or-intermission") {
    return {
      cellId: request.task.cellId,
      operationId: request.operationId,
      outcome: "excluded-music-only",
      editorialFinding: "music-or-mv-only",
      summaryKo,
      providerResponseFingerprint,
      participantOutcome,
    };
  }
  const recommendedStreamerEvent =
    insight.programMaterial === "streamer-event" &&
    insight.clipDecision === "recommend";
  return {
    cellId: request.task.cellId,
    operationId: request.operationId,
    outcome: "completed",
    editorialFinding: recommendedStreamerEvent
      ? request.task.transcriptAbstentionReason === "no-speech"
        ? "quiet-success"
        : "visual-event"
      : "no-usable-event",
    summaryKo,
    providerResponseFingerprint,
    participantOutcome,
  };
}

async function parsedTerminalResult(
  request: BroadcastTranscriptVisualProviderAttemptRequest,
  response: Response,
  castRosterId: CandidatePassBCastRosterId | null,
  outputLanguage: AnalysisLanguage,
): Promise<BroadcastTranscriptVisualProviderAdapterResult> {
  const declaredLength = Number(response.headers.get("Content-Length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_CANDIDATE_PASS_B_RESPONSE_BYTES
  ) {
    await response.body?.cancel().catch(() => undefined);
    return responseFailure(request, 502);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  try {
    if (
      bytes.byteLength === 0 ||
      bytes.byteLength > MAX_CANDIDATE_PASS_B_RESPONSE_BYTES
    ) {
      return responseFailure(request, 502);
    }
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return responseFailure(request, 502);
    }
    const parsed = extractCandidatePassBGeminiResponse(
      value,
      request.task.sourceEndMs - request.task.sourceStartMs,
      castRosterId,
      outputLanguage,
    );
    if (!parsed.ok) return responseFailure(request, 502);
    const fingerprint =
      await createBroadcastTranscriptVisualMediaContentFingerprint(bytes);
    return terminalResult(
      request,
      parsed.analysis.insight,
      fingerprint,
      castRosterId,
    );
  } finally {
    bytes.fill(0);
  }
}

async function executeOne(
  request: BroadcastTranscriptVisualProviderAttemptRequest,
  options: Required<
    Pick<
      CreateBroadcastTranscriptVisualProviderBatchAdapterOptions,
      "participantId" | "runId" | "castRosterId" | "outputLanguage" | "context"
    >
  > & {
    readonly proxyEndpoint: string;
    readonly fetchImplementation: FetchImplementation;
    readonly quotaTransport: BroadcastTranscriptVisualPreparedQuotaTransport;
  },
  signal: AbortSignal | undefined,
): Promise<BroadcastTranscriptVisualProviderAdapterResult> {
  abortIfRequested(signal);
  const bundle = bundleForRequest(request);
  try {
    const candidateHash = await stableCandidateHash(request);
    let mediaTicket: string | null = null;
    const response = await options.quotaTransport(
      bundle.bytes,
      {
        participantId: options.participantId,
        runId: options.runId,
        operationId: request.operationId,
        pool: "candidate",
        ...(signal === undefined ? {} : { signal }),
        fetchImplementation: options.fetchImplementation,
      },
      async (lease) => {
        const leaseHeaders = aiQuotaLeaseHeaders(lease);
        if (mediaTicket === null) {
          const stagedResponse = await options.fetchImplementation(
            stageUrl(
              options.proxyEndpoint,
              request,
              candidateHash,
              request.mediaEvidence.audio?.bytes.byteLength ?? 0,
              bundle.frameByteLengths,
            ),
            {
              method: "POST",
              headers: {
                ...leaseHeaders,
                "Content-Type": CANDIDATE_INSIGHT_MEDIA_BUNDLE_CONTENT_TYPE,
              },
              body: bundle.bytes,
              credentials: "omit",
              cache: "no-store",
              referrerPolicy: "no-referrer",
              ...(signal === undefined ? {} : { signal }),
            },
          );
          if (stagedResponse.status !== 202) return stagedResponse;
          const replayable = stagedResponse.clone();
          let value: unknown;
          try {
            value = await stagedResponse.json();
          } catch {
            return replayable;
          }
          const staged = parseCandidateInsightMediaStagedResponse(
            value,
            candidateHash,
            request.task.sourceEndMs - request.task.sourceStartMs,
          );
          if (staged === null) return replayable;
          mediaTicket = staged.mediaTicket;
        }
        return options.fetchImplementation(options.proxyEndpoint, {
          method: "POST",
          headers: {
            ...leaseHeaders,
            "Content-Type":
              BROADCAST_TRANSCRIPT_VISUAL_MEDIA_RESOLVE_CONTENT_TYPE,
          },
          body: JSON.stringify(
            createBroadcastTranscriptVisualMediaResolveRequest(
              mediaTicket,
              request.task.sourceEndMs - request.task.sourceStartMs,
              request.task.transcriptAbstentionReason,
              options.castRosterId,
              options.outputLanguage,
              options.context,
            ),
          ),
          credentials: "omit",
          cache: "no-store",
          referrerPolicy: "no-referrer",
          ...(signal === undefined ? {} : { signal }),
        });
      },
    );
    if (!response.ok) {
      const failure = responseFailure(request, response.status);
      await response.body?.cancel().catch(() => undefined);
      return failure;
    }
    return parsedTerminalResult(
      request,
      response,
      options.castRosterId,
      options.outputLanguage,
    );
  } finally {
    bundle.bytes.fill(0);
  }
}

export function classifyBroadcastTranscriptVisualProviderFailure(
  error: unknown,
): BroadcastTranscriptVisualProviderFailureClassification {
  if (error instanceof BroadcastTranscriptVisualProviderError) {
    return error.classification;
  }
  if (error instanceof AiQuotaClientError) {
    if (error.code === "OUTCOME_UNKNOWN" || error.code === "ABORTED") {
      return {
        outcome: "outcome-unknown",
        failureReason:
          error.code === "ABORTED"
            ? "operation-interrupted"
            : "timeout-after-dispatch",
      };
    }
    return { outcome: "retryable", failureReason: "provider-unavailable" };
  }
  if (
    error instanceof DOMException &&
    error.name === "AbortError"
  ) {
    return {
      outcome: "outcome-unknown",
      failureReason: "operation-interrupted",
    };
  }
  return { outcome: "retryable", failureReason: "provider-unavailable" };
}

export async function createBroadcastTranscriptVisualProviderOperationId(
  request: BroadcastTranscriptVisualProviderOperationIdRequest,
): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        [
          request.planFingerprint,
          request.sourceFingerprint,
          request.cellId,
          request.attemptOrdinal,
        ].join("\u001f"),
      ),
    ),
  );
  const hash = Array.from(digest.subarray(0, 12), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const base = `visual-${request.attemptOrdinal}-${hash}`;
  if (!request.usedOperationIds.includes(base)) return base;
  let collision = 1;
  while (request.usedOperationIds.includes(`${base}-${collision}`)) {
    collision += 1;
  }
  return `${base}-${collision}`;
}

export function createBroadcastTranscriptVisualProviderBatchAdapter(
  options: CreateBroadcastTranscriptVisualProviderBatchAdapterOptions,
): BroadcastTranscriptVisualProviderBatchAdapter {
  const maximumConcurrency = options.maximumConcurrency ?? DEFAULT_MAXIMUM_CONCURRENCY;
  if (
    !Number.isSafeInteger(maximumConcurrency) ||
    maximumConcurrency < 1 ||
    maximumConcurrency > 4
  ) {
    throw new RangeError("Visual provider concurrency must be between 1 and 4.");
  }
  const runtimeOptions = {
    participantId: options.participantId,
    runId: options.runId,
    castRosterId: options.castRosterId,
    outputLanguage: options.outputLanguage ?? "ko",
    context: options.context ?? null,
    proxyEndpoint: options.proxyEndpoint ?? CANDIDATE_PASS_B_PROXY_ENDPOINT,
    fetchImplementation: options.fetchImplementation ?? fetch,
    quotaTransport: options.quotaTransport ?? fetchWithPreparedAiQuota,
  };
  const executeProviderBatch: BroadcastTranscriptVisualProviderBatchAdapter["executeProviderBatch"] =
    async (requests, signal) => {
      const results = new Array<BroadcastTranscriptVisualProviderAdapterResult>(
        requests.length,
      );
      let cursor = 0;
      const workers = Array.from(
        { length: Math.min(maximumConcurrency, requests.length) },
        async () => {
          while (cursor < requests.length) {
            const index = cursor;
            cursor += 1;
            const request = requests[index];
            if (request === undefined) continue;
            try {
              results[index] = await executeOne(
                request,
                runtimeOptions,
                signal,
              );
            } catch (error) {
              const classification =
                classifyBroadcastTranscriptVisualProviderFailure(
                  error,
                );
              results[index] = {
                cellId: request.task.cellId,
                operationId: request.operationId,
                ...classification,
              };
            }
          }
        },
      );
      await Promise.all(workers);
      return results;
    };
  return {
    transportMode: BROADCAST_TRANSCRIPT_VISUAL_TRANSPORT_MODE,
    providerModelRevision:
      BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_MODEL_REVISION,
    executeProviderBatch,
  };
}
