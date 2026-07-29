import { AI_MODEL_ROUTING_POLICY_VERSION } from "./aiModelRoutingPolicy";
import {
  BROADCAST_TRANSCRIPT_GEMINI_MODEL_ID,
  BROADCAST_TRANSCRIPT_GEMINI_MODEL_REVISION,
  BROADCAST_TRANSCRIPT_GROQ_MODEL_ID,
  BROADCAST_TRANSCRIPT_GROQ_MODEL_REVISION,
  BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
  BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
  MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS,
  broadcastTranscriptProviderForModelId,
  type BroadcastTranscriptLiveModelId,
  type BroadcastTranscriptProviderId,
  type BroadcastTranscriptQwenResult,
} from "./broadcastTranscriptQwen";
import { createContentFingerprint } from "../security/contentFingerprint";

export const BROADCAST_TRANSCRIPT_ROUTE_MANIFEST_SCHEMA_VERSION =
  "1.0.0" as const;
export const BROADCAST_TRANSCRIPT_HEALTH_SERVICE_VERSION = 5 as const;
export const BROADCAST_TRANSCRIPT_PROVIDER_CONFIGURATION_VERSION =
  "1.3.0" as const;
export const BROADCAST_TRANSCRIPT_TRANSPORT_VERSION = 2 as const;
export const BROADCAST_TRANSCRIPT_PRIMARY_MEDIA_TYPE = "audio/wav" as const;

export type BroadcastTranscriptTransportMode =
  | "free-r2"
  | "paid-direct";

export interface BroadcastTranscriptRouteManifest {
  readonly schemaVersion:
    typeof BROADCAST_TRANSCRIPT_ROUTE_MANIFEST_SCHEMA_VERSION;
  readonly serviceVersion:
    typeof BROADCAST_TRANSCRIPT_HEALTH_SERVICE_VERSION;
  readonly routingPolicyVersion: typeof AI_MODEL_ROUTING_POLICY_VERSION;
  readonly providerConfigurationVersion:
    typeof BROADCAST_TRANSCRIPT_PROVIDER_CONFIGURATION_VERSION;
  readonly transportVersion:
    typeof BROADCAST_TRANSCRIPT_TRANSPORT_VERSION;
  readonly transportMode: BroadcastTranscriptTransportMode;
  readonly maximumChunkDurationMs:
    typeof MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS;
  readonly primaryMediaType:
    typeof BROADCAST_TRANSCRIPT_PRIMARY_MEDIA_TYPE;
  readonly provider: BroadcastTranscriptProviderId;
  readonly modelId: BroadcastTranscriptLiveModelId;
  readonly modelRevision: string;
}

export interface BroadcastTranscriptRouteSelection {
  readonly manifest: BroadcastTranscriptRouteManifest;
  readonly fingerprint: string;
}

export const BROADCAST_TRANSCRIPT_PROVIDER_RECEIPT_SCHEMA_VERSION =
  "1.0.0" as const;

export interface BroadcastTranscriptProviderReceipt {
  readonly schemaVersion:
    typeof BROADCAST_TRANSCRIPT_PROVIDER_RECEIPT_SCHEMA_VERSION;
  readonly routeManifestFingerprint: string;
  readonly provider: BroadcastTranscriptProviderId;
  readonly modelId: BroadcastTranscriptLiveModelId;
  readonly modelRevision: string;
  readonly fallbackUsed: boolean;
}

export interface BroadcastTranscriptVerifiedResult
  extends BroadcastTranscriptQwenResult {
  readonly modelRevision: string;
  readonly providerReceipt: BroadcastTranscriptProviderReceipt;
}

export class BroadcastTranscriptRouteManifestError extends Error {
  public constructor(
    public readonly code:
      | "HEALTH_UNAVAILABLE"
      | "HEALTH_REJECTED"
      | "HEALTH_INVALID_RESPONSE"
      | "ROUTE_INACTIVE"
      | "ROUTE_FINGERPRINT_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "BroadcastTranscriptRouteManifestError";
  }
}

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const LIVE_MODEL_IDENTITIES = Object.freeze({
  qwen: {
    modelId: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
    modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
  },
  gemini: {
    modelId: BROADCAST_TRANSCRIPT_GEMINI_MODEL_ID,
    modelRevision: BROADCAST_TRANSCRIPT_GEMINI_MODEL_REVISION,
  },
  groq: {
    modelId: BROADCAST_TRANSCRIPT_GROQ_MODEL_ID,
    modelRevision: BROADCAST_TRANSCRIPT_GROQ_MODEL_REVISION,
  },
} as const);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRouteFingerprint(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^sha256:[a-f0-9]{64}$/u.test(value)
  );
}

function expectedLiveIdentity(
  provider: BroadcastTranscriptProviderId,
): {
  readonly modelId: BroadcastTranscriptLiveModelId;
  readonly modelRevision: string;
} {
  return LIVE_MODEL_IDENTITIES[provider];
}

function parseHealthManifest(
  value: unknown,
): BroadcastTranscriptRouteManifest {
  if (
    !isRecord(value) ||
    value.ok !== true ||
    value.service !== "rettohighlight-gemini" ||
    value.version !== BROADCAST_TRANSCRIPT_HEALTH_SERVICE_VERSION ||
    value.routingPolicyVersion !== AI_MODEL_ROUTING_POLICY_VERSION ||
    !isRecord(value.transcriptTransport) ||
    value.transcriptTransport.version !==
      BROADCAST_TRANSCRIPT_TRANSPORT_VERSION ||
    (value.transcriptTransport.mode !== "free-r2" &&
      value.transcriptTransport.mode !== "paid-direct") ||
    value.transcriptTransport.configured !== true ||
    value.transcriptTransport.primaryMediaType !==
      BROADCAST_TRANSCRIPT_PRIMARY_MEDIA_TYPE ||
    value.transcriptTransport.maximumChunkDurationMs !==
      MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS ||
    !isRecord(value.providers) ||
    value.providers.schemaVersion !==
      BROADCAST_TRANSCRIPT_PROVIDER_CONFIGURATION_VERSION ||
    !isRecord(value.providers.broadcastTranscript)
  ) {
    throw new BroadcastTranscriptRouteManifestError(
      "HEALTH_INVALID_RESPONSE",
      "방송 대사 분석 서버의 라우트 정보를 확인하지 못했어요.",
    );
  }

  const provider = value.providers.broadcastTranscript.selectedProvider;
  if (
    (provider !== "qwen" &&
      provider !== "gemini" &&
      provider !== "groq") ||
    value.providers.broadcastTranscript.implementationStatus !== "active" ||
    value.providers.broadcastTranscript.configured !== true ||
    value.providers.broadcastTranscript.active !== true
  ) {
    throw new BroadcastTranscriptRouteManifestError(
      "ROUTE_INACTIVE",
      "방송 대사 분석 모델이 현재 사용 가능한 상태가 아니에요.",
    );
  }
  const identity = expectedLiveIdentity(provider);
  if (
    value.providers.broadcastTranscript.modelId !== identity.modelId ||
    value.providers.broadcastTranscript.modelRevision !==
      identity.modelRevision ||
    (value.transcriptTransport.mode === "free-r2" &&
      provider === "gemini")
  ) {
    throw new BroadcastTranscriptRouteManifestError(
      "HEALTH_INVALID_RESPONSE",
      "방송 대사 분석 서버가 알 수 없는 모델 경로를 안내했어요.",
    );
  }

  return {
    schemaVersion: BROADCAST_TRANSCRIPT_ROUTE_MANIFEST_SCHEMA_VERSION,
    serviceVersion: BROADCAST_TRANSCRIPT_HEALTH_SERVICE_VERSION,
    routingPolicyVersion: AI_MODEL_ROUTING_POLICY_VERSION,
    providerConfigurationVersion:
      BROADCAST_TRANSCRIPT_PROVIDER_CONFIGURATION_VERSION,
    transportVersion: BROADCAST_TRANSCRIPT_TRANSPORT_VERSION,
    transportMode: value.transcriptTransport.mode,
    maximumChunkDurationMs: MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS,
    primaryMediaType: BROADCAST_TRANSCRIPT_PRIMARY_MEDIA_TYPE,
    provider,
    modelId: identity.modelId,
    modelRevision: identity.modelRevision,
  };
}

export function normalizeBroadcastTranscriptRouteManifest(
  value: unknown,
): BroadcastTranscriptRouteManifest {
  if (!isRecord(value)) {
    throw new TypeError("Broadcast transcript route manifest is invalid.");
  }
  const provider = value.provider;
  if (
    value.schemaVersion !==
      BROADCAST_TRANSCRIPT_ROUTE_MANIFEST_SCHEMA_VERSION ||
    value.serviceVersion !== BROADCAST_TRANSCRIPT_HEALTH_SERVICE_VERSION ||
    value.routingPolicyVersion !== AI_MODEL_ROUTING_POLICY_VERSION ||
    value.providerConfigurationVersion !==
      BROADCAST_TRANSCRIPT_PROVIDER_CONFIGURATION_VERSION ||
    value.transportVersion !== BROADCAST_TRANSCRIPT_TRANSPORT_VERSION ||
    (value.transportMode !== "free-r2" &&
      value.transportMode !== "paid-direct") ||
    value.maximumChunkDurationMs !==
      MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS ||
    value.primaryMediaType !== BROADCAST_TRANSCRIPT_PRIMARY_MEDIA_TYPE ||
    (provider !== "qwen" &&
      provider !== "gemini" &&
      provider !== "groq")
  ) {
    throw new TypeError("Broadcast transcript route manifest is invalid.");
  }
  const identity = expectedLiveIdentity(provider);
  if (
    value.modelId !== identity.modelId ||
    value.modelRevision !== identity.modelRevision ||
    (value.transportMode === "free-r2" && provider === "gemini")
  ) {
    throw new TypeError("Broadcast transcript route identity is invalid.");
  }
  return {
    schemaVersion: BROADCAST_TRANSCRIPT_ROUTE_MANIFEST_SCHEMA_VERSION,
    serviceVersion: BROADCAST_TRANSCRIPT_HEALTH_SERVICE_VERSION,
    routingPolicyVersion: AI_MODEL_ROUTING_POLICY_VERSION,
    providerConfigurationVersion:
      BROADCAST_TRANSCRIPT_PROVIDER_CONFIGURATION_VERSION,
    transportVersion: BROADCAST_TRANSCRIPT_TRANSPORT_VERSION,
    transportMode: value.transportMode,
    maximumChunkDurationMs: MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS,
    primaryMediaType: BROADCAST_TRANSCRIPT_PRIMARY_MEDIA_TYPE,
    provider,
    modelId: identity.modelId,
    modelRevision: identity.modelRevision,
  };
}

export function serializeBroadcastTranscriptRouteManifest(
  manifest: BroadcastTranscriptRouteManifest,
): string {
  return JSON.stringify(normalizeBroadcastTranscriptRouteManifest(manifest));
}

export async function createBroadcastTranscriptRouteSelection(
  manifest: BroadcastTranscriptRouteManifest,
): Promise<BroadcastTranscriptRouteSelection> {
  const normalized = normalizeBroadcastTranscriptRouteManifest(manifest);
  const fingerprint = await createContentFingerprint([
    "exclipper.broadcast-transcript-route.v1",
    serializeBroadcastTranscriptRouteManifest(normalized),
  ]);
  if (!isRouteFingerprint(fingerprint)) {
    throw new BroadcastTranscriptRouteManifestError(
      "ROUTE_FINGERPRINT_UNAVAILABLE",
      "방송 대사 분석 경로를 안전하게 고정하지 못했어요.",
    );
  }
  return {
    manifest: normalized,
    fingerprint,
  };
}

export function isBroadcastTranscriptRouteSelection(
  value: unknown,
): value is BroadcastTranscriptRouteSelection {
  if (
    !isRecord(value) ||
    !isRouteFingerprint(value.fingerprint)
  ) {
    return false;
  }
  try {
    normalizeBroadcastTranscriptRouteManifest(value.manifest);
    return true;
  } catch {
    return false;
  }
}

export async function verifyBroadcastTranscriptRouteSelection(
  value: unknown,
): Promise<BroadcastTranscriptRouteSelection> {
  if (!isBroadcastTranscriptRouteSelection(value)) {
    throw new TypeError("Broadcast transcript route selection is invalid.");
  }
  const expected = await createBroadcastTranscriptRouteSelection(
    value.manifest,
  );
  if (expected.fingerprint !== value.fingerprint) {
    throw new TypeError("Broadcast transcript route fingerprint is invalid.");
  }
  return expected;
}

export function expectedBroadcastTranscriptFallbackIdentity(
  manifest: BroadcastTranscriptRouteManifest,
): {
  readonly provider: BroadcastTranscriptProviderId;
  readonly modelId: BroadcastTranscriptLiveModelId;
  readonly modelRevision: string;
} | null {
  const normalized = normalizeBroadcastTranscriptRouteManifest(manifest);
  if (normalized.transportMode !== "paid-direct") return null;
  const provider: BroadcastTranscriptProviderId =
    normalized.provider === "qwen" ? "gemini" : "qwen";
  return {
    provider,
    ...expectedLiveIdentity(provider),
  };
}

export function broadcastTranscriptProviderMatchesModel(
  provider: BroadcastTranscriptProviderId,
  modelId: BroadcastTranscriptLiveModelId,
): boolean {
  return broadcastTranscriptProviderForModelId(modelId) === provider;
}

export function createBroadcastTranscriptProviderReceipt(
  selection: BroadcastTranscriptRouteSelection,
  actualModelId: unknown,
  actualModelRevision: unknown,
  fallbackUsed: unknown,
): BroadcastTranscriptProviderReceipt {
  if (!isBroadcastTranscriptRouteSelection(selection)) {
    throw new TypeError("Broadcast transcript route selection is invalid.");
  }
  if (
    (actualModelId !== BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID &&
      actualModelId !== BROADCAST_TRANSCRIPT_GEMINI_MODEL_ID &&
      actualModelId !== BROADCAST_TRANSCRIPT_GROQ_MODEL_ID) ||
    typeof actualModelRevision !== "string" ||
    (fallbackUsed !== true && fallbackUsed !== false)
  ) {
    throw new TypeError("Broadcast transcript provider receipt is invalid.");
  }
  const actualProvider = broadcastTranscriptProviderForModelId(actualModelId);
  const expectedIdentity = fallbackUsed
    ? expectedBroadcastTranscriptFallbackIdentity(selection.manifest)
    : {
        provider: selection.manifest.provider,
        modelId: selection.manifest.modelId,
        modelRevision: selection.manifest.modelRevision,
      };
  if (
    expectedIdentity === null ||
    actualProvider !== expectedIdentity.provider ||
    actualModelId !== expectedIdentity.modelId ||
    actualModelRevision !== expectedIdentity.modelRevision
  ) {
    throw new TypeError(
      "Broadcast transcript response does not match its selected route.",
    );
  }
  return {
    schemaVersion: BROADCAST_TRANSCRIPT_PROVIDER_RECEIPT_SCHEMA_VERSION,
    routeManifestFingerprint: selection.fingerprint,
    provider: actualProvider,
    modelId: actualModelId,
    modelRevision: actualModelRevision,
    fallbackUsed,
  };
}

export function normalizeBroadcastTranscriptProviderReceipt(
  value: unknown,
): BroadcastTranscriptProviderReceipt {
  if (
    !isRecord(value) ||
    value.schemaVersion !==
      BROADCAST_TRANSCRIPT_PROVIDER_RECEIPT_SCHEMA_VERSION ||
    !isRouteFingerprint(value.routeManifestFingerprint) ||
    (value.provider !== "qwen" &&
      value.provider !== "gemini" &&
      value.provider !== "groq") ||
    (value.modelId !== BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID &&
      value.modelId !== BROADCAST_TRANSCRIPT_GEMINI_MODEL_ID &&
      value.modelId !== BROADCAST_TRANSCRIPT_GROQ_MODEL_ID) ||
    typeof value.modelRevision !== "string" ||
    value.modelRevision.length === 0 ||
    value.modelRevision.length > 256 ||
    (value.fallbackUsed !== true && value.fallbackUsed !== false) ||
    !broadcastTranscriptProviderMatchesModel(value.provider, value.modelId)
  ) {
    throw new TypeError("Broadcast transcript provider receipt is invalid.");
  }
  const expected = expectedLiveIdentity(value.provider);
  if (
    value.modelId !== expected.modelId ||
    value.modelRevision !== expected.modelRevision
  ) {
    throw new TypeError("Broadcast transcript provider receipt is unknown.");
  }
  return {
    schemaVersion: BROADCAST_TRANSCRIPT_PROVIDER_RECEIPT_SCHEMA_VERSION,
    routeManifestFingerprint: value.routeManifestFingerprint,
    provider: value.provider,
    modelId: value.modelId,
    modelRevision: value.modelRevision,
    fallbackUsed: value.fallbackUsed,
  };
}

export async function requestBroadcastTranscriptRouteSelection(
  transcriptEndpoint: string,
  options: {
    readonly signal?: AbortSignal;
    readonly fetchImplementation?: FetchImplementation;
  } = {},
): Promise<BroadcastTranscriptRouteSelection> {
  let healthUrl: URL;
  try {
    healthUrl = new URL("/healthz", transcriptEndpoint);
  } catch {
    throw new BroadcastTranscriptRouteManifestError(
      "HEALTH_INVALID_RESPONSE",
      "방송 대사 분석 서버 주소를 확인하지 못했어요.",
    );
  }
  let response: Response;
  try {
    response = await (options.fetchImplementation ?? fetch)(healthUrl, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json" },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch {
    throw new BroadcastTranscriptRouteManifestError(
      "HEALTH_UNAVAILABLE",
      "방송 대사 분석 서버의 모델 경로를 확인하지 못했어요.",
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new BroadcastTranscriptRouteManifestError(
      "HEALTH_REJECTED",
      "방송 대사 분석 서버가 아직 준비되지 않았어요.",
    );
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new BroadcastTranscriptRouteManifestError(
      "HEALTH_INVALID_RESPONSE",
      "방송 대사 분석 서버의 라우트 응답을 읽지 못했어요.",
    );
  }
  return createBroadcastTranscriptRouteSelection(parseHealthManifest(value));
}
