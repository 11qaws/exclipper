import { describe, expect, it, vi } from "vitest";
import { createBroadcastParticipantGrounding } from "../analysis/broadcastParticipantGrounding";
import {
  BROADCAST_TRANSCRIPT_MEDIA_RESOLVE_CONTENT_TYPE,
  createBroadcastTranscriptMediaResolveRequest,
} from "../analysis/broadcastTranscriptMediaProtocol";
import { AI_BROADCAST_CONTEXT_ROUTING_REVISION } from "../analysis/aiModelRoutingPolicy";
import { extractCandidatePassBGeminiResponse } from "../analysis/candidatePassBGemini";
import {
  QWEN_CONTEXT_OVERVIEW_FALLBACK_MODEL_ID,
  QWEN_CONTEXT_OVERVIEW_FALLBACK_MODEL_REVISION,
} from "./aiProviderConfiguration";
import {
  CANDIDATE_INSIGHT_MEDIA_BUNDLE_CONTENT_TYPE,
  CANDIDATE_INSIGHT_MEDIA_RESOLVE_CONTENT_TYPE,
  createCandidateInsightMediaResolveRequest,
  createCandidateInsightMediaSemanticPayloadDigest,
} from "../analysis/candidateInsightMediaProtocol";
import {
  CANDIDATE_PASS_B_QWEN_MODEL_ID,
  CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
  CANDIDATE_PASS_B_RESPONSE_FALLBACK_HEADER,
  CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
} from "../analysis/candidatePassBWorkerProtocol";
import {
  currentCandidatePassBContext,
  currentCandidatePassBFrames,
  currentCandidatePassBInsight,
} from "../testSupport/candidatePassBCurrentFixture";
import {
  CHANNEL_PREANALYSIS_SOURCES,
  channelPreanalysisSourceById,
  type ConfiguredChannelPreanalysisSource,
} from "../analysis/channelPreanalysisSources";
import {
  AMORETTO_CHANNEL_CAST_ROSTER_ID,
  EUREKA_CHANNEL_CAST_ROSTER_ID,
  MANGJING_CHANNEL_CAST_ROSTER_ID,
  SENA_ARBEL_CHANNEL_CAST_ROSTER_ID,
  TORORI_COCO_CHANNEL_CAST_ROSTER_ID,
  type CandidatePassBCastRosterId,
} from "../analysis/participantRoster";
import {
  PREANALYSIS_CANDIDATE_ENDPOINT_PATH,
  PREANALYSIS_CANDIDATE_EXPECTED_MODEL_ID,
  PREANALYSIS_CANDIDATE_EXPECTED_MODEL_REVISION,
  PREANALYSIS_CANDIDATE_MEDIA_DIGEST_HEADER,
  PREANALYSIS_CANDIDATE_MEDIA_ENDPOINT_PATH,
  PREANALYSIS_CONTEXT_CACHE_HEADER,
  PREANALYSIS_CONTEXT_ATTEMPT_HEADER,
  PREANALYSIS_CONTEXT_CONTRACT_HEADER,
  PREANALYSIS_CONTEXT_ENDPOINT_PATH,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID_HEADER,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION,
  PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION_HEADER,
  PREANALYSIS_CONTEXT_MODEL_ID_HEADER,
  PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER,
  PREANALYSIS_CONTEXT_OPERATION_HEADER,
  PREANALYSIS_CONTEXT_OPERATION_GENERATION,
  PREANALYSIS_CONTEXT_ORIGIN,
  PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER,
  PREANALYSIS_CONTEXT_PROXY_VERSION,
  PREANALYSIS_CONTEXT_RETRY_RISK_HEADER,
  PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER,
  PREANALYSIS_CONTEXT_TRANSPORT_DIGEST_HEADER,
  PREANALYSIS_TRANSCRIPT_DURATION_HEADER,
  PREANALYSIS_TRANSCRIPT_ENDPOINT_PATH,
  PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_ID,
  PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_REVISION,
  PREANALYSIS_TRANSCRIPT_SOURCE_ID_HEADER,
  PREANALYSIS_TRANSCRIPT_SOURCE_START_HEADER,
  PREANALYSIS_TRANSCRIPT_VIDEO_ID_HEADER,
  PreanalysisContextOperation,
  createPreanalysisCandidateOperationId,
  createPreanalysisContextOperationId,
  createPreanalysisTranscriptOperationId,
  handlePreanalysisContextProxyRequest,
  type PreanalysisContextProxyDependencies,
  type PreanalysisContextProxyEnvironment,
} from "./preanalysisContextProxy.worker";
import type {
  BroadcastTranscriptMediaBucket,
  BroadcastTranscriptMediaObject,
  BroadcastTranscriptMediaObjectBody,
  BroadcastTranscriptMediaPutOptions,
} from "./broadcastTranscriptMedia";

const ENDPOINT = `https://exclipper-preanalysis-context.example${PREANALYSIS_CONTEXT_ENDPOINT_PATH}`;
const CANDIDATE_ENDPOINT = `https://exclipper-preanalysis-context.example${PREANALYSIS_CANDIDATE_ENDPOINT_PATH}`;
const CANDIDATE_MEDIA_ENDPOINT = `https://exclipper-preanalysis-context.example${PREANALYSIS_CANDIDATE_MEDIA_ENDPOINT_PATH}`;
const TRANSCRIPT_ENDPOINT = `https://exclipper-preanalysis-context.example${PREANALYSIS_TRANSCRIPT_ENDPOINT_PATH}`;
const TOKEN = "scheduled-secret-token-with-at-least-24-chars";
const SCHEDULED_CANDIDATE_DURATION_MS = 30_000;

function createSilentCandidateWavBase64(durationMs: number): string {
  const dataBytes = Math.round((durationMs * 16_000) / 1_000) * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16_000, 24);
  wav.writeUInt32LE(32_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);
  return wav.toString("base64");
}

function createSilentTranscriptWav(durationMs: number): Uint8Array {
  return new Uint8Array(
    Buffer.from(createSilentCandidateWavBase64(durationMs), "base64"),
  );
}

class FakeTranscriptMediaBucket implements BroadcastTranscriptMediaBucket {
  private readonly objects = new Map<
    string,
    {
      readonly bytes: Uint8Array;
      readonly object: BroadcastTranscriptMediaObject;
    }
  >();
  public readonly deletedKeys: string[] = [];
  public onDelete: ((key: string) => void) | null = null;

  public async put(
    key: string,
    value: ReadableStream<Uint8Array>,
    options: BroadcastTranscriptMediaPutOptions = {},
  ): Promise<BroadcastTranscriptMediaObject> {
    const bytes = new Uint8Array(await new Response(value).arrayBuffer());
    const checksum = await crypto.subtle.digest("SHA-256", bytes);
    const object: BroadcastTranscriptMediaObject = {
      key,
      size: bytes.byteLength,
      ...(options.httpMetadata === undefined
        ? {}
        : { httpMetadata: options.httpMetadata }),
      ...(options.customMetadata === undefined
        ? {}
        : { customMetadata: options.customMetadata }),
      checksums: { sha256: checksum },
    };
    this.objects.set(key, { bytes, object });
    return object;
  }

  public get(
    key: string,
    options: { readonly range?: { readonly offset?: number; readonly length?: number } } = {},
  ): Promise<BroadcastTranscriptMediaObjectBody | null> {
    const stored = this.objects.get(key);
    if (stored === undefined) return Promise.resolve(null);
    const offset = options.range?.offset ?? 0;
    const length = options.range?.length ?? stored.bytes.byteLength - offset;
    const bytes = stored.bytes.slice(offset, offset + length);
    return Promise.resolve({
      ...stored.object,
      range: { offset, length: bytes.byteLength },
      body: new Response(bytes).body!,
      arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
    });
  }

  public head(key: string): Promise<BroadcastTranscriptMediaObject | null> {
    return Promise.resolve(this.objects.get(key)?.object ?? null);
  }

  public delete(key: string | readonly string[]): Promise<void> {
    const keys = typeof key === "string" ? [key] : key;
    for (const one of keys) {
      this.onDelete?.(one);
      this.deletedKeys.push(one);
      this.objects.delete(one);
    }
    return Promise.resolve();
  }
}

const SCHEDULED_CANDIDATE_AUDIO_BASE64 = createSilentCandidateWavBase64(
  SCHEDULED_CANDIDATE_DURATION_MS,
);

const SOURCE_CASES = [
  {
    source: CHANNEL_PREANALYSIS_SOURCES[0],
    rosterId: AMORETTO_CHANNEL_CAST_ROSTER_ID,
  },
  {
    source: CHANNEL_PREANALYSIS_SOURCES[1],
    rosterId: EUREKA_CHANNEL_CAST_ROSTER_ID,
  },
  {
    source: CHANNEL_PREANALYSIS_SOURCES[2],
    rosterId: SENA_ARBEL_CHANNEL_CAST_ROSTER_ID,
  },
  {
    source: CHANNEL_PREANALYSIS_SOURCES[3],
    rosterId: TORORI_COCO_CHANNEL_CAST_ROSTER_ID,
  },
  {
    source: CHANNEL_PREANALYSIS_SOURCES[4],
    rosterId: MANGJING_CHANNEL_CAST_ROSTER_ID,
  },
] as const satisfies readonly {
  readonly source: ConfiguredChannelPreanalysisSource;
  readonly rosterId: CandidatePassBCastRosterId;
}[];

class FakeDurableObjectStorage {
  private readonly values = new Map<string, unknown>();

  public get<T>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.values.get(key) as T | undefined);
  }

  public put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value));
    return Promise.resolve();
  }

  public delete(key: string): Promise<boolean> {
    return Promise.resolve(this.values.delete(key));
  }

  public seed(key: string, value: unknown): void {
    this.values.set(key, structuredClone(value));
  }

  public read<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }
}

class FakeDurableObjectState {
  public constructor(public readonly storage: FakeDurableObjectStorage) {}

  public blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
    return callback();
  }
}

class FakeDurableObjectNamespace {
  public readonly requestedNames: string[] = [];
  private readonly storageByName = new Map<string, FakeDurableObjectStorage>();
  private readonly instanceByName = new Map<
    string,
    PreanalysisContextOperation
  >();

  public constructor(
    private readonly environment: () => PreanalysisContextProxyEnvironment,
    private readonly dependencies: PreanalysisContextProxyDependencies,
  ) {}

  public idFromName(name: string): string {
    this.requestedNames.push(name);
    return name;
  }

  public get(id: unknown): {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  } {
    const name = String(id);
    let instance = this.instanceByName.get(name);
    if (instance === undefined) {
      const storage =
        this.storageByName.get(name) ?? new FakeDurableObjectStorage();
      this.storageByName.set(name, storage);
      instance = new PreanalysisContextOperation(
        new FakeDurableObjectState(storage),
        this.environment(),
        this.dependencies,
      );
      this.instanceByName.set(name, instance);
    }
    const operation = instance;
    return {
      fetch(input, init) {
        return operation.fetch(new Request(input, init));
      },
    };
  }

  public restart(name: string): void {
    this.instanceByName.delete(name);
  }

  public seed(name: string, value: unknown): void {
    const storage =
      this.storageByName.get(name) ?? new FakeDurableObjectStorage();
    storage.seed("operation-state", value);
    this.storageByName.set(name, storage);
    this.instanceByName.delete(name);
  }

  public read<T>(name: string, key: string): T | undefined {
    return this.storageByName.get(name)?.read<T>(key);
  }
}

function scheduledRequestBody(
  summaryKo = "진행자가 음식 취향을 설명하고 시청자와 이야기를 나눴다.",
  sourceCase: (typeof SOURCE_CASES)[number] = SOURCE_CASES[0],
): string {
  const chapters = [
    {
      chapterId: "chapter-1",
      startMs: 0,
      endMs: 60_000,
      evidenceMode: "complete-transcript" as const,
      evidenceCoverageRatio: 1,
      summaryKo,
    },
  ];
  const participantGrounding = createBroadcastParticipantGrounding({
    sourceDurationMs: 60_000,
    castRosterId: sourceCase.rosterId,
    chapters,
  });
  return JSON.stringify({
    sourceId: sourceCase.source.sourceId,
    sourceChannelId: sourceCase.source.channelId,
    sourceDurationMs: 60_000,
    chapters,
    candidates: [],
    castRosterId: sourceCase.rosterId,
    participantGrounding,
    outputLanguage: "ko",
  });
}

async function payloadDigest(body: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  );
  return `sha256:${Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("")}`;
}

async function bytePayloadDigest(bytes: Uint8Array): Promise<string> {
  const exactBytes = new Uint8Array(bytes.byteLength);
  exactBytes.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", exactBytes);
  return `sha256:${Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function configuredSourceForBody(
  body: string,
): ConfiguredChannelPreanalysisSource {
  const value = JSON.parse(body) as { readonly sourceId?: unknown };
  const source =
    typeof value.sourceId === "string"
      ? channelPreanalysisSourceById(value.sourceId)
      : null;
  if (source === null) throw new TypeError("Expected a configured source.");
  return source;
}

async function operationIdForBody(body: string): Promise<string> {
  const source = configuredSourceForBody(body);
  return createPreanalysisContextOperationId(
    await payloadDigest(body),
    source.sourceId,
  );
}

async function createScheduledRequest(
  body = scheduledRequestBody(),
  overrides: {
    readonly authorization?: string;
    readonly contractVersion?: string;
    readonly digest?: string;
    readonly expectedModelId?: string;
    readonly expectedModelRevision?: string;
    readonly method?: string;
    readonly operationId?: string;
    readonly origin?: string;
    readonly routingRevision?: string;
    readonly url?: string;
  } = {},
): Promise<Request> {
  const digest = overrides.digest ?? (await payloadDigest(body));
  return new Request(overrides.url ?? ENDPOINT, {
    method: overrides.method ?? "POST",
    headers: {
      Authorization: overrides.authorization ?? `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Origin: overrides.origin ?? PREANALYSIS_CONTEXT_ORIGIN,
      [PREANALYSIS_CONTEXT_CONTRACT_HEADER]:
        overrides.contractVersion ?? PREANALYSIS_CONTEXT_PROXY_VERSION,
      [PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER]:
        overrides.routingRevision ?? AI_BROADCAST_CONTEXT_ROUTING_REVISION,
      [PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID_HEADER]:
        overrides.expectedModelId ?? PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID,
      [PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION_HEADER]:
        overrides.expectedModelRevision ??
        PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION,
      [PREANALYSIS_CONTEXT_OPERATION_HEADER]:
        overrides.operationId ??
        (await createPreanalysisContextOperationId(
          digest,
          configuredSourceForBody(body).sourceId,
        )),
      [PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER]: digest,
    },
    ...(overrides.method === "OPTIONS" ? {} : { body }),
  });
}

function scheduledCandidateBody(): string {
  const frames = currentCandidatePassBFrames().map((frame, index) => ({
    ...frame,
    timestampMs: [3_000, 9_000, 18_000, 27_000][index]!,
  }));
  return JSON.stringify({
    audioBase64: SCHEDULED_CANDIDATE_AUDIO_BASE64,
    candidateDurationMs: SCHEDULED_CANDIDATE_DURATION_MS,
    videoFrames: frames,
    castRosterId: null,
    outputLanguage: "ko",
    context: currentCandidatePassBContext(),
  });
}

async function candidateOperationIdForBody(body: string): Promise<string> {
  return createPreanalysisCandidateOperationId(await payloadDigest(body));
}

async function createScheduledCandidateRequest(
  body = scheduledCandidateBody(),
  overrides: {
    readonly digest?: string;
    readonly operationId?: string;
    readonly routingRevision?: string;
    readonly expectedModelId?: string;
    readonly expectedModelRevision?: string;
  } = {},
): Promise<Request> {
  const digest = overrides.digest ?? (await payloadDigest(body));
  return new Request(CANDIDATE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Origin: PREANALYSIS_CONTEXT_ORIGIN,
      [PREANALYSIS_CONTEXT_CONTRACT_HEADER]: PREANALYSIS_CONTEXT_PROXY_VERSION,
      [PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER]:
        overrides.routingRevision ?? CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
      [PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID_HEADER]:
        overrides.expectedModelId ?? PREANALYSIS_CANDIDATE_EXPECTED_MODEL_ID,
      [PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION_HEADER]:
        overrides.expectedModelRevision ??
        PREANALYSIS_CANDIDATE_EXPECTED_MODEL_REVISION,
      [PREANALYSIS_CONTEXT_OPERATION_HEADER]:
        overrides.operationId ??
        (await createPreanalysisCandidateOperationId(digest)),
      [PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER]: digest,
    },
    body,
  });
}

async function scheduledCandidateMediaFixture() {
  const timestamps = [3_000, 9_000, 18_000, 27_000] as const;
  const audio = new Uint8Array(
    Buffer.from(SCHEDULED_CANDIDATE_AUDIO_BASE64, "base64"),
  );
  const frames = timestamps.map((timestampMs, index) => ({
    timestampMs,
    bytes: new Uint8Array([0xff, 0xd8, 0xff, index + 1, 0xff, 0xd9]),
  }));
  const bundle = new Uint8Array(
    audio.byteLength +
      frames.reduce((total, frame) => total + frame.bytes.byteLength, 0),
  );
  bundle.set(audio);
  let offset = audio.byteLength;
  for (const frame of frames) {
    bundle.set(frame.bytes, offset);
    offset += frame.bytes.byteLength;
  }
  const mediaPayloadDigest = await bytePayloadDigest(bundle);
  const candidateHash = "0123456789abcdef01234567";
  const context = currentCandidatePassBContext();
  const semanticPayloadDigest =
    await createCandidateInsightMediaSemanticPayloadDigest({
      mediaPayloadDigest,
      candidateHash,
      candidateDurationMs: SCHEDULED_CANDIDATE_DURATION_MS,
      audioByteLength: audio.byteLength,
      frames: frames.map((frame) => ({
        timestampMs: frame.timestampMs,
        byteLength: frame.bytes.byteLength,
      })),
      castRosterId: null,
      outputLanguage: "ko",
      context,
    });
  const operationId =
    await createPreanalysisCandidateOperationId(semanticPayloadDigest);
  return {
    audio,
    frames,
    bundle,
    mediaPayloadDigest,
    candidateHash,
    context,
    semanticPayloadDigest,
    operationId,
  };
}

type ScheduledCandidateMediaFixture = Awaited<
  ReturnType<typeof scheduledCandidateMediaFixture>
>;

function createScheduledCandidateMediaStageRequest(
  fixture: ScheduledCandidateMediaFixture,
): Request {
  const url = new URL(CANDIDATE_MEDIA_ENDPOINT);
  url.searchParams.set("candidateHash", fixture.candidateHash);
  url.searchParams.set(
    "durationMs",
    String(SCHEDULED_CANDIDATE_DURATION_MS),
  );
  url.searchParams.set("audioBytes", String(fixture.audio.byteLength));
  fixture.frames.forEach((frame, index) => {
    url.searchParams.set(`f${index}t`, String(frame.timestampMs));
    url.searchParams.set(`f${index}b`, String(frame.bytes.byteLength));
  });
  return new Request(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": CANDIDATE_INSIGHT_MEDIA_BUNDLE_CONTENT_TYPE,
      "Content-Length": String(fixture.bundle.byteLength),
      Origin: PREANALYSIS_CONTEXT_ORIGIN,
      [PREANALYSIS_CONTEXT_CONTRACT_HEADER]: PREANALYSIS_CONTEXT_PROXY_VERSION,
      [PREANALYSIS_CONTEXT_OPERATION_HEADER]: fixture.operationId,
      [PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER]:
        fixture.mediaPayloadDigest,
    },
    body: Uint8Array.from(fixture.bundle).buffer,
  });
}

async function createScheduledCandidateMediaResolveRequest(
  fixture: ScheduledCandidateMediaFixture,
  mediaTicket: string,
  context = fixture.context,
): Promise<Request> {
  const body = JSON.stringify(
    createCandidateInsightMediaResolveRequest(
      mediaTicket,
      SCHEDULED_CANDIDATE_DURATION_MS,
      null,
      "ko",
      context,
    ),
  );
  return new Request(CANDIDATE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": CANDIDATE_INSIGHT_MEDIA_RESOLVE_CONTENT_TYPE,
      Origin: PREANALYSIS_CONTEXT_ORIGIN,
      [PREANALYSIS_CONTEXT_CONTRACT_HEADER]: PREANALYSIS_CONTEXT_PROXY_VERSION,
      [PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER]:
        CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
      [PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID_HEADER]:
        PREANALYSIS_CANDIDATE_EXPECTED_MODEL_ID,
      [PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION_HEADER]:
        PREANALYSIS_CANDIDATE_EXPECTED_MODEL_REVISION,
      [PREANALYSIS_CONTEXT_OPERATION_HEADER]: fixture.operationId,
      [PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER]:
        fixture.semanticPayloadDigest,
      [PREANALYSIS_CONTEXT_TRANSPORT_DIGEST_HEADER]:
        await payloadDigest(body),
      [PREANALYSIS_CANDIDATE_MEDIA_DIGEST_HEADER]:
        fixture.mediaPayloadDigest,
    },
    body,
  });
}

async function transcriptIdentity(
  wav: Uint8Array,
  sourceStartMs: number,
  durationMs: number,
) {
  const source = SOURCE_CASES[0].source;
  const digest = await bytePayloadDigest(wav);
  const operationId = await createPreanalysisTranscriptOperationId(
    digest,
    source.sourceId,
    "abcdefghijk",
    sourceStartMs,
    durationMs,
  );
  return { source, digest, operationId };
}

function transcriptHeaders(
  identity: Awaited<ReturnType<typeof transcriptIdentity>>,
  sourceStartMs: number,
  durationMs: number,
  contentType: string,
): Headers {
  return new Headers({
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": contentType,
    Origin: PREANALYSIS_CONTEXT_ORIGIN,
    [PREANALYSIS_CONTEXT_CONTRACT_HEADER]: PREANALYSIS_CONTEXT_PROXY_VERSION,
    [PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER]:
      PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_REVISION,
    [PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID_HEADER]:
      PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_ID,
    [PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION_HEADER]:
      PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_REVISION,
    [PREANALYSIS_CONTEXT_OPERATION_HEADER]: identity.operationId,
    [PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER]: identity.digest,
    [PREANALYSIS_TRANSCRIPT_SOURCE_ID_HEADER]: identity.source.sourceId,
    [PREANALYSIS_TRANSCRIPT_VIDEO_ID_HEADER]: "abcdefghijk",
    [PREANALYSIS_TRANSCRIPT_SOURCE_START_HEADER]: String(sourceStartMs),
    [PREANALYSIS_TRANSCRIPT_DURATION_HEADER]: String(durationMs),
  });
}

async function createScheduledTranscriptStageRequest(
  wav: Uint8Array,
  sourceStartMs: number,
  durationMs: number,
): Promise<{
  readonly identity: Awaited<ReturnType<typeof transcriptIdentity>>;
  readonly request: Request;
}> {
  const identity = await transcriptIdentity(wav, sourceStartMs, durationMs);
  const headers = transcriptHeaders(
    identity,
    sourceStartMs,
    durationMs,
    "audio/wav",
  );
  headers.set("Content-Length", String(wav.byteLength));
  return {
    identity,
    request: new Request(TRANSCRIPT_ENDPOINT, {
      method: "POST",
      headers,
      body: Uint8Array.from(wav).buffer,
    }),
  };
}

function createScheduledTranscriptResolveRequest(
  identity: Awaited<ReturnType<typeof transcriptIdentity>>,
  mediaTicket: string,
  sourceStartMs: number,
  durationMs: number,
): Request {
  const body = JSON.stringify(
    createBroadcastTranscriptMediaResolveRequest(mediaTicket),
  );
  return new Request(TRANSCRIPT_ENDPOINT, {
    method: "POST",
    headers: transcriptHeaders(
      identity,
      sourceStartMs,
      durationMs,
      BROADCAST_TRANSCRIPT_MEDIA_RESOLVE_CONTENT_TYPE,
    ),
    body,
  });
}

function qwenSuccessResponse(
  candidates: readonly {
    readonly id: string;
    readonly d: "select" | "review" | "reject";
    readonly c: "reaction" | "music-or-intermission";
    readonly p: number;
    readonly reason: string;
  }[] = [],
): Response {
  const generated = {
    summary:
      "진행자는 음식 취향을 설명하고 시청자 반응에 답하며 한 가지 주제를 이어 갔다.",
    host: {
      name: null,
      profile:
        "대화의 중심에서 자신의 취향을 차분히 설명하고 시청자의 질문에 답하는 진행을 보였다.",
      evidence: ["음식 취향을 직접 설명했다."],
      uncertainty: ["자막만으로 화면 속 인물은 확인할 수 없다."],
    },
    themes: ["음식 취향 이야기"],
    chapters: [
      {
        s: "chapter-1",
        e: "chapter-1",
        title: "음식 취향 이야기",
        desc: "한 가지 음식 주제를 놓고 취향과 이유를 설명했다.",
        kind: "main-event",
        sal: "primary",
      },
    ],
    leads: [],
    candidates,
  };
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify(generated) },
        },
      ],
    }),
    { status: 200 },
  );
}

function candidateAnalysisText(): string {
  return JSON.stringify({
    segments: [
      { relativeStartMs: 1_000, relativeEndMs: 3_000, text: "성공했어" },
    ],
    ...currentCandidatePassBInsight(),
  });
}

function qwenCandidateSuccessResponse(): Response {
  const content = candidateAnalysisText();
  return new Response(
    `data: ${JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          delta: { content },
        },
      ],
    })}\n\ndata: [DONE]\n\n`,
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

function geminiCandidateSuccessResponse(): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: candidateAnalysisText() }] },
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function createHarness(
  fetchImplementation = vi.fn(
    (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return Promise.resolve(qwenSuccessResponse());
    },
  ),
  options: {
    readonly now?: () => number;
    readonly upstreamTimeoutMs?: number;
  } = {},
): {
  readonly environment: PreanalysisContextProxyEnvironment;
  readonly namespace: FakeDurableObjectNamespace;
  readonly rateLimit: ReturnType<typeof vi.fn>;
  readonly upstreamFetch: typeof fetchImplementation;
} {
  const namespaceHolder: {
    value: FakeDurableObjectNamespace | null;
  } = { value: null };
  const rateLimit = vi.fn(() => Promise.resolve({ success: true }));
  const environment: PreanalysisContextProxyEnvironment = {
    PREANALYSIS_CONTEXT_TOKEN: TOKEN,
    PREANALYSIS_CONTEXT_PROVIDER: "qwen",
    PREANALYSIS_CANDIDATE_PROVIDER: "qwen",
    PREANALYSIS_CANDIDATE_TRANSPORT_MODE: "paid-direct",
    PREANALYSIS_QWEN_API_KEY: "dedicated-qwen-test-key",
    PREANALYSIS_QWEN_REGION: "singapore",
    PREANALYSIS_CONTEXT_RATE_LIMITER: { limit: rateLimit },
    get PREANALYSIS_CONTEXT_OPERATIONS() {
      if (namespaceHolder.value === null) {
        throw new Error("Fake Durable Object namespace is not ready.");
      }
      return namespaceHolder.value;
    },
  };
  const namespace = new FakeDurableObjectNamespace(() => environment, {
    fetchImplementation,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.upstreamTimeoutMs === undefined
      ? {}
      : { upstreamTimeoutMs: options.upstreamTimeoutMs }),
  });
  namespaceHolder.value = namespace;
  return {
    environment,
    namespace,
    rateLimit,
    upstreamFetch: fetchImplementation,
  };
}

async function errorCode(response: Response): Promise<string | null> {
  const value = (await response.json()) as {
    readonly error?: { readonly code?: unknown };
  };
  return typeof value.error?.code === "string" ? value.error.code : null;
}

describe("preanalysisContextProxy.worker", () => {
  it.each(SOURCE_CASES)(
    "accepts the configured $source.sourceId source and its exact roster",
    async (sourceCase) => {
      const harness = createHarness();
      const body = scheduledRequestBody(
        "진행자가 음식 취향을 설명하고 시청자와 이야기를 나눴다.",
        sourceCase,
      );

      const response = await handlePreanalysisContextProxyRequest(
        await createScheduledRequest(body),
        harness.environment,
      );

      expect(response.status).toBe(200);
      expect(harness.namespace.requestedNames).toEqual([
        expect.stringMatching(
          new RegExp(
            `^channel-context-${sourceCase.source.sourceId}-[0-9a-f]{64}$`,
            "u",
          ),
        ),
      ]);
      expect(harness.upstreamFetch).toHaveBeenCalledTimes(1);
      const providerBody = harness.upstreamFetch.mock.calls[0]?.[1]?.body;
      expect(typeof providerBody).toBe("string");
      expect(providerBody).not.toEqual(
        expect.stringContaining(sourceCase.source.channelId),
      );
      expect(providerBody).not.toEqual(
        expect.stringContaining(sourceCase.source.sourceId),
      );
      expect(providerBody).toEqual(
        expect.stringContaining("채널 주인 prior는 실제 출연 증거가 아니고"),
      );
    },
  );

  it("binds each operation namespace to its configured source", async () => {
    const digest = `sha256:${"1".repeat(64)}`;
    const operationIds = await Promise.all(
      SOURCE_CASES.map(({ source }) =>
        createPreanalysisContextOperationId(digest, source.sourceId),
      ),
    );

    expect(new Set(operationIds).size).toBe(SOURCE_CASES.length);
    for (const [index, operationId] of operationIds.entries()) {
      expect(operationId).toMatch(
        new RegExp(
          `^channel-context-${SOURCE_CASES[index]!.source.sourceId}-[0-9a-f]{64}$`,
          "u",
        ),
      );
    }
  });

  it("rejects source, channel, and roster mismatches before the durable operation", async () => {
    const harness = createHarness();
    const amoretto = SOURCE_CASES[0];
    const eureka = SOURCE_CASES[1];
    const wrongRoster = JSON.parse(
      scheduledRequestBody(undefined, amoretto),
    ) as Record<string, unknown>;
    wrongRoster.sourceId = eureka.source.sourceId;
    wrongRoster.sourceChannelId = eureka.source.channelId;
    const wrongRosterBody = JSON.stringify(wrongRoster);
    const wrongRosterResponse = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(wrongRosterBody),
      harness.environment,
    );
    expect(wrongRosterResponse.status).toBe(400);
    await expect(errorCode(wrongRosterResponse)).resolves.toBe(
      "INVALID_REQUEST",
    );

    const wrongChannel = JSON.parse(
      scheduledRequestBody(undefined, eureka),
    ) as Record<string, unknown>;
    wrongChannel.sourceChannelId = amoretto.source.channelId;
    const wrongChannelBody = JSON.stringify(wrongChannel);
    const wrongChannelResponse = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(wrongChannelBody),
      harness.environment,
    );
    expect(wrongChannelResponse.status).toBe(400);
    await expect(errorCode(wrongChannelResponse)).resolves.toBe(
      "INVALID_REQUEST",
    );

    const unknownSource = JSON.parse(
      scheduledRequestBody(undefined, amoretto),
    ) as Record<string, unknown>;
    unknownSource.sourceId = "unconfigured-channel";
    const unknownSourceBody = JSON.stringify(unknownSource);
    const unknownSourceDigest = await payloadDigest(unknownSourceBody);
    const unknownSourceResponse = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(unknownSourceBody, {
        operationId: await createPreanalysisContextOperationId(
          unknownSourceDigest,
          amoretto.source.sourceId,
        ),
      }),
      harness.environment,
    );
    expect(unknownSourceResponse.status).toBe(400);
    await expect(errorCode(unknownSourceResponse)).resolves.toBe(
      "INVALID_REQUEST",
    );

    expect(harness.namespace.requestedNames).toHaveLength(0);
    expect(harness.upstreamFetch).not.toHaveBeenCalled();
  });

  it("runs the bounded overview once and replays the durable terminal result", async () => {
    const harness = createHarness();
    const request = await createScheduledRequest();
    const first = await handlePreanalysisContextProxyRequest(
      request,
      harness.environment,
    );

    expect(first.status).toBe(200);
    expect(first.headers.get(PREANALYSIS_CONTEXT_CACHE_HEADER)).toBe("miss");
    expect(first.headers.get(PREANALYSIS_CONTEXT_CONTRACT_HEADER)).toBe(
      PREANALYSIS_CONTEXT_PROXY_VERSION,
    );
    expect(first.headers.get(PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER)).toBe(
      AI_BROADCAST_CONTEXT_ROUTING_REVISION,
    );
    expect(first.headers.get(PREANALYSIS_CONTEXT_MODEL_ID_HEADER)).toBe(
      PREANALYSIS_CONTEXT_EXPECTED_MODEL_ID,
    );
    expect(first.headers.get(PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER)).toBe(
      PREANALYSIS_CONTEXT_EXPECTED_MODEL_REVISION,
    );
    const firstPayload = JSON.parse(await first.text()) as unknown;
    expect(firstPayload).toMatchObject({
      annotations: [],
      semanticChaptersSupported: true,
      discoveredLeadsSupported: true,
    });
    expect(
      (firstPayload as { readonly broadcastSummaryKo?: unknown })
        .broadcastSummaryKo,
    ).toEqual(expect.stringContaining("음식 취향"));
    expect(harness.upstreamFetch).toHaveBeenCalledTimes(1);
    const providerInit = harness.upstreamFetch.mock.calls[0]?.[1];
    expect(new Headers(providerInit?.headers).get("Authorization")).toBe(
      "Bearer dedicated-qwen-test-key",
    );
    if (typeof providerInit?.body !== "string") {
      throw new TypeError("Expected a serialized provider body.");
    }
    const providerBody = JSON.parse(providerInit.body) as unknown;
    expect(providerBody).toMatchObject({
      model: "qwen3.7-plus",
      enable_thinking: true,
    });
    expect(providerBody).toHaveProperty("thinking_budget", 768);

    harness.namespace.restart(await operationIdForBody(scheduledRequestBody()));
    const replay = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );
    expect(replay.status).toBe(200);
    expect(replay.headers.get(PREANALYSIS_CONTEXT_CACHE_HEADER)).toBe("hit");
    expect(replay.headers.get(PREANALYSIS_CONTEXT_CONTRACT_HEADER)).toBe(
      PREANALYSIS_CONTEXT_PROXY_VERSION,
    );
    expect(harness.upstreamFetch).toHaveBeenCalledTimes(1);

    harness.rateLimit.mockResolvedValue({ success: false });
    const replayWhileLimited = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );
    expect(replayWhileLimited.status).toBe(200);
    expect(
      replayWhileLimited.headers.get(PREANALYSIS_CONTEXT_CACHE_HEADER),
    ).toBe("hit");
    expect(harness.rateLimit).toHaveBeenCalledTimes(1);
  });

  it("accepts bounded provisional candidates and returns their context annotations", async () => {
    const base = JSON.parse(scheduledRequestBody()) as Record<string, unknown>;
    base.candidates = [
      {
        candidateId: "candidate-1",
        startMs: 1_000,
        endMs: 30_000,
        transcriptKo: "음식 이름을 맞힌 뒤 웃었다.",
        eventSummaryKo: "음식 퀴즈의 답을 알아냈다.",
        reactionSummaryKo: "정답을 확인하고 웃었다.",
        participantContextKo: "주 진행자의 발화가 확인됐다.",
        chatReactionSummaryKo: null,
      },
    ];
    const body = JSON.stringify(base);
    const upstreamFetch = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) => {
        void _input;
        void _init;
        return Promise.resolve(
          qwenSuccessResponse([
            {
              id: "candidate-1",
              d: "select",
              c: "reaction",
              p: 0.92,
              reason: "퀴즈의 결과와 반응이 짧게 완결된다.",
            },
          ]),
        );
      },
    );
    const harness = createHarness(upstreamFetch);

    const response = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(body),
      harness.environment,
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      readonly annotations?: readonly {
        readonly candidateId?: unknown;
        readonly clipDecision?: unknown;
      }[];
    };
    expect(payload.annotations).toEqual([
      expect.objectContaining({
        candidateId: "candidate-1",
        clipDecision: "select",
      }),
    ]);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    const contextProviderBody = upstreamFetch.mock.calls[0]?.[1]?.body;
    if (typeof contextProviderBody !== "string") {
      throw new TypeError("Expected a serialized context provider body.");
    }
    expect(contextProviderBody).toContain("candidate-1");
  });

  it("runs one bounded candidate request and durably replays the exact validated result", async () => {
    const upstreamFetch = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) => {
        void _input;
        void _init;
        return Promise.resolve(qwenCandidateSuccessResponse());
      },
    );
    const harness = createHarness(upstreamFetch);
    const body = scheduledCandidateBody();

    const first = await handlePreanalysisContextProxyRequest(
      await createScheduledCandidateRequest(body),
      harness.environment,
    );

    expect(first.status).toBe(200);
    expect(first.headers.get(PREANALYSIS_CONTEXT_CACHE_HEADER)).toBe("miss");
    expect(first.headers.get(PREANALYSIS_CONTEXT_MODEL_ID_HEADER)).toBe(
      CANDIDATE_PASS_B_QWEN_MODEL_ID,
    );
    expect(first.headers.get(PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER)).toBe(
      CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
    );
    expect(first.headers.get(PREANALYSIS_CONTEXT_ROUTING_REVISION_HEADER)).toBe(
      CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
    );
    expect(first.headers.get(CANDIDATE_PASS_B_RESPONSE_FALLBACK_HEADER)).toBe(
      "false",
    );
    const firstPayload = (await first.json()) as unknown;
    expect(
      extractCandidatePassBGeminiResponse(
        firstPayload,
        SCHEDULED_CANDIDATE_DURATION_MS,
        null,
        "ko",
      ).ok,
    ).toBe(true);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    expect(
      new Headers(upstreamFetch.mock.calls[0]?.[1]?.headers).get(
        "Authorization",
      ),
    ).toBe("Bearer dedicated-qwen-test-key");
    const providerBody = upstreamFetch.mock.calls[0]?.[1]?.body;
    if (typeof providerBody !== "string") {
      throw new TypeError("Expected a serialized candidate provider body.");
    }
    expect(providerBody).toContain(
      SCHEDULED_CANDIDATE_AUDIO_BASE64.slice(0, 128),
    );
    for (const frame of currentCandidatePassBFrames()) {
      expect(providerBody).toContain(frame.dataBase64);
    }

    const operationId = await candidateOperationIdForBody(body);
    harness.namespace.restart(operationId);
    const replay = await handlePreanalysisContextProxyRequest(
      await createScheduledCandidateRequest(body),
      harness.environment,
    );
    expect(replay.status).toBe(200);
    expect(replay.headers.get(PREANALYSIS_CONTEXT_CACHE_HEADER)).toBe("hit");
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed candidate media and a candidate operation namespace mismatch", async () => {
    const harness = createHarness();
    const malformed = JSON.parse(scheduledCandidateBody()) as Record<
      string,
      unknown
    >;
    malformed.videoFrames = currentCandidatePassBFrames().slice(0, 3);
    const malformedBody = JSON.stringify(malformed);
    const malformedResponse = await handlePreanalysisContextProxyRequest(
      await createScheduledCandidateRequest(malformedBody),
      harness.environment,
    );
    expect(malformedResponse.status).toBe(400);

    const body = scheduledCandidateBody();
    const mismatch = await handlePreanalysisContextProxyRequest(
      await createScheduledCandidateRequest(body, {
        operationId: await createPreanalysisCandidateOperationId(
          `sha256:${"0".repeat(64)}`,
        ),
      }),
      harness.environment,
    );
    expect(mismatch.status).toBe(409);
    await expect(errorCode(mismatch)).resolves.toBe(
      "OPERATION_NAMESPACE_MISMATCH",
    );
    expect(harness.upstreamFetch).not.toHaveBeenCalled();
  });

  it("keeps one semantic candidate operation across ticket renewal, retry, and terminal replay", async () => {
    let nowMs = 1_900_000_000_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    try {
      const upstreamFetch = vi
        .fn<
          (
            input: RequestInfo | URL,
            init?: RequestInit,
          ) => Promise<Response>
        >()
        .mockResolvedValueOnce(
          new Response(null, {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(qwenCandidateSuccessResponse());
      const harness = createHarness(upstreamFetch, { now: () => nowMs });
      const bucket = new FakeTranscriptMediaBucket();
      Object.assign(harness.environment, {
        PREANALYSIS_CANDIDATE_TRANSPORT_MODE: "free-r2",
        PREANALYSIS_MEDIA: bucket,
        PREANALYSIS_MEDIA_SIGNING_KEY:
          "scheduled-candidate-media-signing-key-at-least-32-bytes",
        PREANALYSIS_MEDIA_PUBLIC_BASE_URL:
          "https://exclipper-preanalysis-context.example/",
      });
      const fixture = await scheduledCandidateMediaFixture();
      const firstStageRequest =
        createScheduledCandidateMediaStageRequest(fixture);
      const arrayBufferSpy = vi.spyOn(firstStageRequest, "arrayBuffer");

      const firstStageResponse = await handlePreanalysisContextProxyRequest(
        firstStageRequest,
        harness.environment,
      );

      expect(
        firstStageResponse.status,
        await firstStageResponse.clone().text(),
      ).toBe(202);
      expect(arrayBufferSpy).not.toHaveBeenCalled();
      expect(harness.namespace.requestedNames).toEqual([]);
      const firstStage = (await firstStageResponse.json()) as {
        readonly mediaTicket: string;
      };
      const conflictingContext = {
        ...fixture.context,
        topicContextKo: `${fixture.context.topicContextKo} 다른 맥락`,
      };
      const conflict = await handlePreanalysisContextProxyRequest(
        await createScheduledCandidateMediaResolveRequest(
          fixture,
          firstStage.mediaTicket,
          conflictingContext,
        ),
        harness.environment,
      );
      expect(conflict.status).toBe(409);
      await expect(errorCode(conflict)).resolves.toBe(
        "OPERATION_PAYLOAD_CONFLICT",
      );
      expect(upstreamFetch).not.toHaveBeenCalled();
      expect(bucket.deletedKeys).toEqual([]);

      const firstResolve = await createScheduledCandidateMediaResolveRequest(
        fixture,
        firstStage.mediaTicket,
      );
      const firstResolveBody = await firstResolve.clone().text();
      const retryable = await handlePreanalysisContextProxyRequest(
        firstResolve,
        harness.environment,
      );
      expect(retryable.status).toBeGreaterThanOrEqual(500);
      expect(bucket.deletedKeys).toEqual([]);
      expect(upstreamFetch).toHaveBeenCalledTimes(1);

      let phaseAtDelete: unknown = null;
      bucket.onDelete = () => {
        phaseAtDelete = harness.namespace.read<{ readonly phase?: unknown }>(
          fixture.operationId,
          "operation-state",
        )?.phase;
      };
      nowMs += 31_000;
      const completed = await handlePreanalysisContextProxyRequest(
        await createScheduledCandidateMediaResolveRequest(
          fixture,
          firstStage.mediaTicket,
        ),
        harness.environment,
      );
      expect(completed.status).toBe(200);
      expect(completed.headers.get(PREANALYSIS_CONTEXT_CACHE_HEADER)).toBe(
        "miss",
      );
      expect(phaseAtDelete).toBe("succeeded");
      expect(bucket.deletedKeys).toHaveLength(1);
      expect(upstreamFetch).toHaveBeenCalledTimes(2);
      const providerBody = upstreamFetch.mock.calls[1]?.[1]?.body;
      if (typeof providerBody !== "string") {
        throw new TypeError("Expected a serialized URL-backed Qwen body.");
      }
      expect(providerBody).toContain(
        "/v1/candidate-insight-media?mediaTicket=",
      );
      expect(providerBody).not.toContain(
        SCHEDULED_CANDIDATE_AUDIO_BASE64.slice(0, 128),
      );

      nowMs += 1_000;
      const secondStageResponse = await handlePreanalysisContextProxyRequest(
        createScheduledCandidateMediaStageRequest(fixture),
        harness.environment,
      );
      expect(secondStageResponse.status).toBe(202);
      const secondStage = (await secondStageResponse.json()) as {
        readonly mediaTicket: string;
      };
      expect(secondStage.mediaTicket).not.toBe(firstStage.mediaTicket);
      const replayRequest = await createScheduledCandidateMediaResolveRequest(
        fixture,
        secondStage.mediaTicket,
      );
      const replayBody = await replayRequest.clone().text();
      expect(replayBody).not.toBe(firstResolveBody);
      expect(
        replayRequest.headers.get(PREANALYSIS_CONTEXT_OPERATION_HEADER),
      ).toBe(fixture.operationId);
      expect(
        replayRequest.headers.get(
          PREANALYSIS_CONTEXT_PAYLOAD_DIGEST_HEADER,
        ),
      ).toBe(fixture.semanticPayloadDigest);

      const replay = await handlePreanalysisContextProxyRequest(
        replayRequest,
        harness.environment,
      );
      expect(replay.status).toBe(200);
      expect(replay.headers.get(PREANALYSIS_CONTEXT_CACHE_HEADER)).toBe("hit");
      expect(upstreamFetch).toHaveBeenCalledTimes(2);
      expect(bucket.deletedKeys).toHaveLength(2);
      expect(phaseAtDelete).toBe("succeeded");
    } finally {
      dateNow.mockRestore();
    }
  });

  it("streams scheduled WAV to private R2, resolves Groq by URL, commits terminal, then cleans media", async () => {
    const durationMs = 2_000;
    const sourceStartMs = 90_000;
    const wav = createSilentTranscriptWav(durationMs);
    const bucket = new FakeTranscriptMediaBucket();
    const upstreamFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        const form = init?.body;
        expect(form).toBeInstanceOf(FormData);
        expect((form as FormData).get("file")).toBeNull();
        const mediaUrl = (form as FormData).get("url");
        expect(typeof mediaUrl).toBe("string");
        expect(mediaUrl).toMatch(
          /^https:\/\/exclipper-preanalysis-context\.example\/v1\/broadcast-transcript-media\?mediaTicket=/u,
        );
        return Promise.resolve(
          new Response(
            JSON.stringify({
              language: "ko",
              duration: 2,
              text: "안녕하세요",
              segments: [{ start: 0, end: 1.8, text: "안녕하세요" }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      },
    );
    const harness = createHarness(upstreamFetch);
    Object.assign(harness.environment, {
      PREANALYSIS_TRANSCRIPT_TRANSPORT_MODE: "free-r2",
      PREANALYSIS_GROQ_API_KEY: "dedicated-groq-test-key",
      PREANALYSIS_MEDIA: bucket,
      PREANALYSIS_MEDIA_SIGNING_KEY:
        "scheduled-transcript-media-signing-key-at-least-32-bytes",
      PREANALYSIS_MEDIA_PUBLIC_BASE_URL:
        "https://exclipper-preanalysis-context.example/",
      PREANALYSIS_TRANSCRIPT_RATE_LIMITER: { limit: harness.rateLimit },
    });
    const stagedRequest = await createScheduledTranscriptStageRequest(
      wav,
      sourceStartMs,
      durationMs,
    );
    const arrayBufferSpy = vi.spyOn(stagedRequest.request, "arrayBuffer");

    const stagedResponse = await handlePreanalysisContextProxyRequest(
      stagedRequest.request,
      harness.environment,
    );

    expect(stagedResponse.status).toBe(202);
    expect(arrayBufferSpy).not.toHaveBeenCalled();
    expect(harness.namespace.requestedNames).toEqual([]);
    const staged = (await stagedResponse.json()) as {
      readonly mediaTicket: string;
    };
    let phaseAtDelete: unknown = null;
    bucket.onDelete = () => {
      phaseAtDelete = harness.namespace.read<{ readonly phase?: unknown }>(
        stagedRequest.identity.operationId,
        "operation-state",
      )?.phase;
    };

    const resolved = await handlePreanalysisContextProxyRequest(
      createScheduledTranscriptResolveRequest(
        stagedRequest.identity,
        staged.mediaTicket,
        sourceStartMs,
        durationMs,
      ),
      harness.environment,
    );

    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toMatchObject({
      modelId: PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_ID,
      modelRevision: PREANALYSIS_TRANSCRIPT_EXPECTED_MODEL_REVISION,
      sourceStartMs,
      sourceEndMs: sourceStartMs + durationMs,
      textKo: "안녕하세요",
      segments: [
        {
          relativeStartMs: 0,
          relativeEndMs: 1_800,
          textKo: "안녕하세요",
          noSpeechProbability: null,
          averageLogProbability: null,
        },
      ],
    });
    expect(phaseAtDelete).toBe("succeeded");
    expect(bucket.deletedKeys).toHaveLength(1);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);

    const replay = await handlePreanalysisContextProxyRequest(
      createScheduledTranscriptResolveRequest(
        stagedRequest.identity,
        staged.mediaTicket,
        sourceStartMs,
        durationMs,
      ),
      harness.environment,
    );
    expect(replay.status).toBe(200);
    expect(replay.headers.get(PREANALYSIS_CONTEXT_CACHE_HEADER)).toBe("hit");
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the shared Gemini credential inside the Worker boundary", async () => {
    const upstreamFetch = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) => {
        void _input;
        void _init;
        return Promise.resolve(geminiCandidateSuccessResponse());
      },
    );
    const harness = createHarness(upstreamFetch);
    Object.assign(harness.environment, {
      PREANALYSIS_CANDIDATE_PROVIDER: "gemini",
      GEMINI_API_KEY: "worker-only-gemini-key",
    });

    const response = await handlePreanalysisContextProxyRequest(
      await createScheduledCandidateRequest(),
      harness.environment,
    );

    expect(response.status).toBe(200);
    const [providerUrl, providerInit] = upstreamFetch.mock.calls[0] ?? [];
    const providerUrlText =
      typeof providerUrl === "string"
        ? providerUrl
        : providerUrl instanceof URL
          ? providerUrl.href
          : (providerUrl?.url ?? "");
    expect(providerUrlText).toContain("gemini-3.6-flash");
    const providerHeaders = new Headers(providerInit?.headers);
    expect(providerHeaders.get("x-goog-api-key")).toBe(
      "worker-only-gemini-key",
    );
    expect(providerHeaders.get("Authorization")).toBeNull();
    expect(await response.text()).not.toContain("worker-only-gemini-key");
  });

  it("quarantines a corrupt succeeded terminal and recomputes it with billing risk disclosed", async () => {
    const body = scheduledRequestBody();
    const operationId = await operationIdForBody(body);
    const source = createHarness();
    const sourceResponse = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(body),
      source.environment,
    );
    expect(sourceResponse.status).toBe(200);
    const stored = source.namespace.read<{
      readonly schemaVersion: string;
      readonly generation: number;
      readonly operationId: string;
      readonly payloadDigest: string;
      readonly phase: string;
      readonly attempt: number;
      readonly updatedAtMs: number;
      readonly terminal: {
        readonly status: number;
        readonly body: string;
        readonly headers: Readonly<Record<string, string>>;
      };
      readonly retry: null;
    }>(operationId, "operation-state");
    if (stored === undefined) {
      throw new TypeError("Expected a stored success terminal.");
    }

    const harness = createHarness();
    harness.namespace.seed(operationId, {
      ...stored,
      terminal: {
        ...stored.terminal,
        body: "{}",
        headers: {
          ...stored.terminal.headers,
          [PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER]: "stale-model-revision",
        },
      },
    });

    const recovered = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(body),
      harness.environment,
    );

    expect(recovered.status).toBe(200);
    expect(recovered.headers.get(PREANALYSIS_CONTEXT_CACHE_HEADER)).toBe(
      "miss",
    );
    expect(recovered.headers.get(PREANALYSIS_CONTEXT_ATTEMPT_HEADER)).toBe("2");
    expect(recovered.headers.get(PREANALYSIS_CONTEXT_RETRY_RISK_HEADER)).toBe(
      "possible-duplicate-provider-charge",
    );
    expect(harness.upstreamFetch).toHaveBeenCalledTimes(1);
    expect(
      harness.namespace.read<{
        readonly observedOperationId?: unknown;
        readonly observedPayloadDigest?: unknown;
      }>(
        operationId,
        `operation-state-quarantine-v${PREANALYSIS_CONTEXT_OPERATION_GENERATION}`,
      ),
    ).toMatchObject({
      observedOperationId: operationId,
      observedPayloadDigest: await payloadDigest(body),
    });
    expect(
      harness.namespace.read<{
        readonly phase?: unknown;
        readonly attempt?: unknown;
      }>(operationId, "operation-state"),
    ).toMatchObject({
      phase: "succeeded",
      attempt: 2,
    });
  });

  it("binds the operation namespace to the exact payload and current route", async () => {
    const harness = createHarness();
    const firstBody = scheduledRequestBody();
    const firstOperationId = await operationIdForBody(firstBody);
    const first = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(firstBody),
      harness.environment,
    );
    expect(first.status).toBe(200);

    const changedBody = scheduledRequestBody(
      "진행자가 다른 음식 취향을 설명하고 이야기를 이어 갔다.",
    );
    const conflict = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(changedBody, {
        operationId: firstOperationId,
      }),
      harness.environment,
    );
    expect(conflict.status).toBe(409);
    await expect(errorCode(conflict)).resolves.toBe(
      "OPERATION_NAMESPACE_MISMATCH",
    );
    expect(harness.upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent retries so only one provider request is made", async () => {
    let release: ((response: Response) => void) | undefined;
    const upstreamFetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const harness = createHarness(upstreamFetch);
    const firstPromise = handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );
    const secondPromise = handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );
    await vi.waitFor(() => {
      expect(upstreamFetch).toHaveBeenCalledTimes(1);
    });
    release?.(qwenSuccessResponse());
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    expect(
      [first, second]
        .map((response) =>
          response.headers.get(PREANALYSIS_CONTEXT_CACHE_HEADER),
        )
        .sort(),
    ).toEqual(["hit", "miss"]);
  });

  it("retries an explicit upstream rate limit with the same operation", async () => {
    let nowMs = 0;
    const upstreamFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(qwenSuccessResponse());
    const harness = createHarness(upstreamFetch, { now: () => nowMs });
    const limited = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );
    expect(limited.status).toBe(429);
    await expect(errorCode(limited)).resolves.toBe("UPSTREAM_RATE_LIMITED");

    nowMs = 30_000;
    const recovered = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );
    expect(recovered.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
  });

  it("checkpoints an ambiguous outcome and later resumes with an explicit billing-risk receipt", async () => {
    let nowMs = 0;
    const upstreamFetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("connection reset"))
      .mockResolvedValueOnce(qwenSuccessResponse());
    const harness = createHarness(upstreamFetch, { now: () => nowMs });
    const failed = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );
    expect(failed.status).toBe(502);
    await expect(errorCode(failed)).resolves.toBe("UPSTREAM_OUTCOME_UNKNOWN");

    const backoff = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );
    expect(backoff.status).toBe(503);
    await expect(errorCode(backoff)).resolves.toBe("RETRY_BACKOFF");
    expect(upstreamFetch).toHaveBeenCalledTimes(1);

    nowMs = 30_000;
    harness.namespace.restart(await operationIdForBody(scheduledRequestBody()));
    const recovered = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );
    expect(recovered.status).toBe(200);
    expect(recovered.headers.get(PREANALYSIS_CONTEXT_RETRY_RISK_HEADER)).toBe(
      "possible-duplicate-provider-charge",
    );
    expect(recovered.headers.get(PREANALYSIS_CONTEXT_ATTEMPT_HEADER)).toBe("2");
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
  });

  it("recovers a stale running checkpoint instead of making it a permanent gap", async () => {
    let nowMs = 239_999;
    const harness = createHarness(
      vi.fn(() => Promise.resolve(qwenSuccessResponse())),
      { now: () => nowMs },
    );
    const body = scheduledRequestBody();
    const digest = await payloadDigest(body);
    const operationId = await operationIdForBody(body);
    harness.namespace.seed(operationId, {
      schemaVersion: PREANALYSIS_CONTEXT_PROXY_VERSION,
      generation: PREANALYSIS_CONTEXT_OPERATION_GENERATION,
      operationId,
      payloadDigest: digest,
      phase: "running",
      attempt: 1,
      updatedAtMs: 0,
      terminal: null,
      retry: null,
    });

    const stillRunning = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(body),
      harness.environment,
    );
    expect(stillRunning.status).toBe(409);
    await expect(errorCode(stillRunning)).resolves.toBe(
      "OPERATION_IN_PROGRESS",
    );
    expect(harness.upstreamFetch).not.toHaveBeenCalled();

    nowMs = 240_000;
    const recovered = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(body),
      harness.environment,
    );
    expect(recovered.status).toBe(200);
    expect(recovered.headers.get(PREANALYSIS_CONTEXT_ATTEMPT_HEADER)).toBe("2");
    expect(recovered.headers.get(PREANALYSIS_CONTEXT_RETRY_RISK_HEADER)).toBe(
      "possible-duplicate-provider-charge",
    );
    expect(harness.upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it("quarantines an old same-payload checkpoint and resumes under the current generation", async () => {
    const harness = createHarness();
    const body = scheduledRequestBody();
    const digest = await payloadDigest(body);
    const operationId = await operationIdForBody(body);
    harness.namespace.seed(operationId, {
      schemaVersion: "1.0.0",
      operationId,
      payloadDigest: digest,
      phase: "running",
      attempt: 1,
      updatedAtMs: 0,
      terminal: null,
      retry: null,
    });

    const response = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(body),
      harness.environment,
    );

    expect(response.status).toBe(200);
    expect(harness.upstreamFetch).toHaveBeenCalledTimes(1);
    expect(
      harness.namespace.read<{
        readonly generation?: unknown;
        readonly replacementOperationId?: unknown;
        readonly replacementPayloadDigest?: unknown;
      }>(
        operationId,
        `operation-state-quarantine-v${PREANALYSIS_CONTEXT_OPERATION_GENERATION}`,
      ),
    ).toMatchObject({
      generation: PREANALYSIS_CONTEXT_OPERATION_GENERATION,
      replacementOperationId: operationId,
      replacementPayloadDigest: digest,
    });
    expect(
      harness.namespace.read<{
        readonly schemaVersion?: unknown;
        readonly generation?: unknown;
        readonly phase?: unknown;
      }>(operationId, "operation-state"),
    ).toMatchObject({
      schemaVersion: PREANALYSIS_CONTEXT_PROXY_VERSION,
      generation: PREANALYSIS_CONTEXT_OPERATION_GENERATION,
      phase: "succeeded",
    });
  });

  it("never resets an old checkpoint that identifies different payload bytes", async () => {
    const harness = createHarness();
    const body = scheduledRequestBody();
    const operationId = await operationIdForBody(body);
    const otherBody = scheduledRequestBody("완전히 다른 방송 문맥입니다.");
    harness.namespace.seed(operationId, {
      schemaVersion: "1.0.0",
      operationId: await operationIdForBody(otherBody),
      payloadDigest: await payloadDigest(otherBody),
      phase: "running",
      attempt: 1,
      updatedAtMs: 0,
      terminal: null,
      retry: null,
    });

    const response = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(body),
      harness.environment,
    );

    expect(response.status).toBe(409);
    await expect(errorCode(response)).resolves.toBe(
      "OPERATION_PAYLOAD_CONFLICT",
    );
    expect(harness.upstreamFetch).not.toHaveBeenCalled();
    expect(
      harness.namespace.read(
        operationId,
        `operation-state-quarantine-v${PREANALYSIS_CONTEXT_OPERATION_GENERATION}`,
      ),
    ).toBeUndefined();
  });

  it("keeps one upstream deadline across headers and a stalled response body", async () => {
    const stalled = new ReadableStream<Uint8Array>({
      start() {},
    });
    const harness = createHarness(
      vi.fn(() => Promise.resolve(new Response(stalled, { status: 200 }))),
      { upstreamTimeoutMs: 20 },
    );

    const response = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );

    expect(response.status).toBe(502);
    await expect(errorCode(response)).resolves.toBe("UPSTREAM_OUTCOME_UNKNOWN");
    expect(harness.upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps provider configuration failures retryable for a later repair", async () => {
    let nowMs = 0;
    const upstreamFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(qwenSuccessResponse());
    const harness = createHarness(upstreamFetch, { now: () => nowMs });
    const failed = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );
    expect(failed.status).toBe(502);
    await expect(errorCode(failed)).resolves.toBe("UPSTREAM_AUTH_FAILED");

    nowMs = 30_000;
    const recovered = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );
    expect(recovered.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
  });

  it("uses one bounded overview fallback before checkpointing a schema failure", async () => {
    const attemptedBodies: Record<string, unknown>[] = [];
    const responses = [
      new Response(
        JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
        { status: 200 },
      ),
      qwenSuccessResponse(),
    ];
    const upstreamFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (typeof init?.body !== "string") {
          throw new TypeError("Expected a serialized context request.");
        }
        attemptedBodies.push(JSON.parse(init.body) as Record<string, unknown>);
        const response = responses.shift();
        if (response === undefined) throw new Error("Unexpected provider call.");
        return Promise.resolve(response);
      },
    );
    const harness = createHarness(upstreamFetch);
    const recovered = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );
    expect(recovered.status).toBe(200);
    expect(recovered.headers.get(PREANALYSIS_CONTEXT_MODEL_ID_HEADER)).toBe(
      QWEN_CONTEXT_OVERVIEW_FALLBACK_MODEL_ID,
    );
    expect(recovered.headers.get(PREANALYSIS_CONTEXT_MODEL_REVISION_HEADER)).toBe(
      QWEN_CONTEXT_OVERVIEW_FALLBACK_MODEL_REVISION,
    );
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
    expect(attemptedBodies[1]).toMatchObject({
      model: QWEN_CONTEXT_OVERVIEW_FALLBACK_MODEL_ID,
      enable_thinking: false,
    });
    expect(attemptedBodies[1]).not.toHaveProperty("max_tokens");
    expect(attemptedBodies[1]).not.toHaveProperty("thinking_budget");
  });

  it("keeps both failed overview models retryable for a later repair", async () => {
    let nowMs = 0;
    const invalidResponse = () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
        { status: 200 },
      );
    const upstreamFetch = vi
      .fn()
      .mockResolvedValueOnce(invalidResponse())
      .mockResolvedValueOnce(invalidResponse())
      .mockResolvedValueOnce(qwenSuccessResponse());
    const harness = createHarness(upstreamFetch, { now: () => nowMs });
    const invalid = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );
    expect(invalid.status).toBe(502);
    const invalidPayload = await invalid.json() as {
      error?: { code?: string; diagnostic?: string };
    };
    expect(invalidPayload.error?.code).toBe("UPSTREAM_INVALID_RESPONSE");
    expect(invalidPayload.error?.diagnostic).toContain(
      "primary-code=UPSTREAM_INVALID_RESPONSE",
    );
    expect(invalidPayload.error?.diagnostic).toContain(
      "model=qwen3.7-plus;stage=top-level",
    );
    expect(invalidPayload.error?.diagnostic).toContain(
      "fallback-code=UPSTREAM_INVALID_RESPONSE",
    );
    expect(invalidPayload.error?.diagnostic).toContain(
      "model=qwen3.6-flash;stage=top-level",
    );

    nowMs = 30_000;
    const recovered = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      harness.environment,
    );
    expect(recovered.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledTimes(3);
  });

  it("rejects bad auth, wrong digests, browser preflight, and general routes before the DO", async () => {
    const harness = createHarness();
    const unauthorized = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(undefined, {
        authorization: `Bearer ${TOKEN}-wrong`,
      }),
      harness.environment,
    );
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const staleContract = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(undefined, {
        contractVersion: "1.0.0",
      }),
      harness.environment,
    );
    expect(staleContract.status).toBe(412);
    await expect(errorCode(staleContract)).resolves.toBe(
      "PROXY_CONTRACT_MISMATCH",
    );

    const staleRoute = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(undefined, {
        routingRevision: "stale-route",
      }),
      harness.environment,
    );
    expect(staleRoute.status).toBe(409);
    await expect(errorCode(staleRoute)).resolves.toBe("PROXY_ROUTE_MISMATCH");

    const digestMismatch = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(undefined, {
        digest: `sha256:${"0".repeat(64)}`,
      }),
      harness.environment,
    );
    expect(digestMismatch.status).toBe(409);
    await expect(errorCode(digestMismatch)).resolves.toBe(
      "PAYLOAD_DIGEST_MISMATCH",
    );

    const preflight = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(undefined, { method: "OPTIONS" }),
      harness.environment,
    );
    expect(preflight.status).toBe(405);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const otherRoute = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(undefined, {
        url: "https://exclipper-preanalysis-context.example/healthz",
      }),
      harness.environment,
    );
    expect(otherRoute.status).toBe(404);
    expect(harness.namespace.requestedNames).toHaveLength(0);
    expect(harness.upstreamFetch).not.toHaveBeenCalled();
  });

  it("rejects a missing dedicated provider key", async () => {
    const harness = createHarness();
    const noKeyNamespaceHolder: {
      value: FakeDurableObjectNamespace | null;
    } = { value: null };
    const noKeyEnvironment: PreanalysisContextProxyEnvironment = {
      PREANALYSIS_CONTEXT_TOKEN: TOKEN,
      PREANALYSIS_CONTEXT_PROVIDER: "qwen",
      PREANALYSIS_QWEN_REGION: "singapore",
      get PREANALYSIS_CONTEXT_OPERATIONS() {
        if (noKeyNamespaceHolder.value === null) {
          throw new Error("Fake Durable Object namespace is not ready.");
        }
        return noKeyNamespaceHolder.value;
      },
    };
    const noKeyNamespace = new FakeDurableObjectNamespace(
      () => noKeyEnvironment,
      { fetchImplementation: harness.upstreamFetch },
    );
    noKeyNamespaceHolder.value = noKeyNamespace;
    const noKey = await handlePreanalysisContextProxyRequest(
      await createScheduledRequest(),
      noKeyEnvironment,
    );
    expect(noKey.status).toBe(503);
    await expect(errorCode(noKey)).resolves.toBe("PROXY_NOT_CONFIGURED");
    expect(harness.upstreamFetch).not.toHaveBeenCalled();
  });
});
