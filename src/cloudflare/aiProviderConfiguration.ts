import {
  CANDIDATE_PASS_B_GEMINI_MODEL_ID,
  CANDIDATE_PASS_B_GEMINI_MODEL_REVISION,
  CANDIDATE_PASS_B_QWEN_MODEL_ID,
  CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
} from "../analysis/candidatePassBWorkerProtocol";
import {
  BROADCAST_TRANSCRIPT_GEMINI_MODEL_ID,
  BROADCAST_TRANSCRIPT_GEMINI_MODEL_REVISION,
  BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
  BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
} from "../analysis/broadcastTranscriptQwen";
import {
  AI_MODEL_ROUTING_POLICY_VERSION,
  EXCLIPPER_MODEL_IDS,
} from "../analysis/aiModelRoutingPolicy";

export const AI_PROVIDER_CONFIGURATION_VERSION = "1.1.0" as const;

export const QWEN_CANDIDATE_MODEL_ID = CANDIDATE_PASS_B_QWEN_MODEL_ID;
export const QWEN_CANDIDATE_MODEL_REVISION = CANDIDATE_PASS_B_QWEN_MODEL_REVISION;
export const DEEPSEEK_CONTEXT_MODEL_ID = "deepseek-v4-pro" as const;
export const DEEPSEEK_CONTEXT_MODEL_REVISION =
  "deepseek-v4-pro-api-reviewed-2026-07-22" as const;
export const QWEN_CONTEXT_MODEL_ID = EXCLIPPER_MODEL_IDS.broadcastContextReasoning;
export const QWEN_CONTEXT_MODEL_REVISION =
  "qwen3.7-plus-context-editorial-jury-gameplay-calibrated-2026-07-22" as const;
export const QWEN_CONTEXT_DISCOVERY_MODEL_ID =
  EXCLIPPER_MODEL_IDS.broadcastContextReasoningFallback;
export const QWEN_CONTEXT_DISCOVERY_MODEL_REVISION =
  "qwen3.6-flash-topical-discovery-reviewed-2026-07-22" as const;

export type CandidateInsightProviderId = "gemini" | "qwen";
export type BroadcastContextProviderId = "disabled" | "deepseek" | "qwen";
export type BroadcastTranscriptProviderId = "disabled" | "gemini" | "qwen";
export type AiProviderImplementationStatus = "active" | "prepared";
export type QwenRegion = "singapore" | "beijing";
export type AiProviderFallbackMode = "disabled" | "bounded";

/** Runtime marker tying the Worker transport to the shared role policy. */
export const AI_PROVIDER_ROUTING_POLICY_VERSION =
  AI_MODEL_ROUTING_POLICY_VERSION;

export interface AiProviderDescriptor {
  readonly role: "candidate-insight" | "broadcast-context" | "broadcast-transcript";
  readonly provider: Exclude<
    CandidateInsightProviderId | BroadcastContextProviderId,
    "disabled"
  >;
  readonly modelId: string;
  readonly modelRevision: string;
  readonly implementationStatus: AiProviderImplementationStatus;
}

/**
 * Public, secret-free provider catalog. `prepared` means the model and
 * credential boundary are reserved, but the production transport is still
 * fail-closed until its request/response adapter has passed a live smoke test.
 */
export const AI_PROVIDER_CATALOG = {
  candidateInsight: {
    gemini: {
      role: "candidate-insight",
      provider: "gemini",
      modelId: CANDIDATE_PASS_B_GEMINI_MODEL_ID,
      modelRevision: CANDIDATE_PASS_B_GEMINI_MODEL_REVISION,
      implementationStatus: "active",
    },
    qwen: {
      role: "candidate-insight",
      provider: "qwen",
      modelId: QWEN_CANDIDATE_MODEL_ID,
      modelRevision: QWEN_CANDIDATE_MODEL_REVISION,
      implementationStatus: "active",
    },
  },
  broadcastContext: {
    deepseek: {
      role: "broadcast-context",
      provider: "deepseek",
      modelId: DEEPSEEK_CONTEXT_MODEL_ID,
      modelRevision: DEEPSEEK_CONTEXT_MODEL_REVISION,
      implementationStatus: "active",
    },
    qwen: {
      role: "broadcast-context",
      provider: "qwen",
      modelId: QWEN_CONTEXT_MODEL_ID,
      modelRevision: QWEN_CONTEXT_MODEL_REVISION,
      implementationStatus: "active",
    },
  },
  broadcastTranscript: {
    gemini: {
      role: "broadcast-transcript",
      provider: "gemini",
      modelId: BROADCAST_TRANSCRIPT_GEMINI_MODEL_ID,
      modelRevision: BROADCAST_TRANSCRIPT_GEMINI_MODEL_REVISION,
      implementationStatus: "active",
    },
    qwen: {
      role: "broadcast-transcript",
      provider: "qwen",
      modelId: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
      modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
      implementationStatus: "active",
    },
  },
} as const satisfies {
  readonly candidateInsight: Readonly<
    Record<CandidateInsightProviderId, AiProviderDescriptor>
  >;
  readonly broadcastContext: Readonly<
    Record<"deepseek" | "qwen", AiProviderDescriptor>
  >;
  readonly broadcastTranscript: Readonly<
    Record<"gemini" | "qwen", AiProviderDescriptor>
  >;
};

export interface AiProviderEnvironment {
  readonly CANDIDATE_INSIGHT_PROVIDER?: string;
  readonly BROADCAST_CONTEXT_PROVIDER?: string;
  readonly BROADCAST_TRANSCRIPT_PROVIDER?: string;
  readonly GEMINI_API_KEY?: string;
  readonly QWEN_API_KEY?: string;
  readonly QWEN_WORKSPACE_ID?: string;
  readonly QWEN_REGION?: string;
  readonly DEEPSEEK_API_KEY?: string;
  readonly AI_PROVIDER_FALLBACK_MODE?: string;
}

export type AiProviderConfigurationErrorCode =
  | "INVALID_PROVIDER"
  | "MISSING_CREDENTIALS"
  | "INVALID_WORKSPACE_ID"
  | "INVALID_REGION";

export interface AiProviderConfigurationFailure {
  readonly ok: false;
  readonly code: AiProviderConfigurationErrorCode;
}

export type CandidateInsightConnection =
  | {
      readonly provider: "gemini";
      readonly descriptor: typeof AI_PROVIDER_CATALOG.candidateInsight.gemini;
      readonly endpoint: string;
      readonly apiKey: string;
    }
  | {
      readonly provider: "qwen";
      readonly descriptor: typeof AI_PROVIDER_CATALOG.candidateInsight.qwen;
      readonly endpoint: string;
      readonly apiKey: string;
      readonly region: QwenRegion;
    };

export type CandidateInsightConnectionResolution =
  | {
      readonly ok: true;
      readonly connection: CandidateInsightConnection;
    }
  | AiProviderConfigurationFailure;

export type BroadcastContextConnection =
  | {
      readonly provider: "disabled";
    }
  | {
      readonly provider: "deepseek";
      readonly descriptor: typeof AI_PROVIDER_CATALOG.broadcastContext.deepseek;
      readonly endpoint: string;
      readonly apiKey: string;
    }
  | {
      readonly provider: "qwen";
      readonly descriptor: typeof AI_PROVIDER_CATALOG.broadcastContext.qwen;
      readonly endpoint: string;
      readonly apiKey: string;
      readonly region: QwenRegion;
    };

export type BroadcastContextConnectionResolution =
  | {
      readonly ok: true;
      readonly connection: BroadcastContextConnection;
    }
  | AiProviderConfigurationFailure;

export type BroadcastTranscriptConnection =
  | { readonly provider: "disabled" }
  | {
      readonly provider: "gemini";
      readonly descriptor: typeof AI_PROVIDER_CATALOG.broadcastTranscript.gemini;
      readonly endpoint: string;
      readonly apiKey: string;
    }
  | {
      readonly provider: "qwen";
      readonly descriptor: typeof AI_PROVIDER_CATALOG.broadcastTranscript.qwen;
      readonly endpoint: string;
      readonly apiKey: string;
      readonly region: QwenRegion;
    };

export type BroadcastTranscriptConnectionResolution =
  | { readonly ok: true; readonly connection: BroadcastTranscriptConnection }
  | AiProviderConfigurationFailure;

export interface AiProviderReadinessManifest {
  readonly schemaVersion: typeof AI_PROVIDER_CONFIGURATION_VERSION;
  readonly candidateInsight: {
    readonly selectedProvider: CandidateInsightProviderId | null;
    readonly modelId: string | null;
    readonly modelRevision: string | null;
    readonly implementationStatus: AiProviderImplementationStatus | null;
    readonly configured: boolean;
    readonly active: boolean;
  };
  readonly broadcastContext: {
    readonly selectedProvider: BroadcastContextProviderId | null;
    readonly modelId: string | null;
    readonly modelRevision: string | null;
    readonly implementationStatus: AiProviderImplementationStatus | "disabled" | null;
    readonly configured: boolean;
    readonly active: boolean;
  };
  readonly broadcastTranscript: {
    readonly selectedProvider: BroadcastTranscriptProviderId | null;
    readonly modelId: string | null;
    readonly modelRevision: string | null;
    readonly implementationStatus: AiProviderImplementationStatus | "disabled" | null;
    readonly configured: boolean;
    readonly active: boolean;
  };
}

const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${CANDIDATE_PASS_B_GEMINI_MODEL_ID}:generateContent`;
const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
const DEFAULT_QWEN_REGION: QwenRegion = "singapore";
const MAX_API_KEY_LENGTH = 512;
const MAX_WORKSPACE_ID_LENGTH = 63;
const QWEN_REGION_HOSTS: Readonly<Record<QwenRegion, string>> = {
  singapore: "ap-southeast-1.maas.aliyuncs.com",
  beijing: "cn-beijing.maas.aliyuncs.com",
};
const QWEN_SHARED_COMPATIBLE_ENDPOINTS: Readonly<Record<QwenRegion, string>> = {
  singapore: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
  beijing: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
};

function normalizeSecret(value: unknown): string | null {
  if (typeof value !== "string" || /[\p{Cc}\p{Cf}]/u.test(value)) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= MAX_API_KEY_LENGTH
    ? normalized
    : null;
}

function readCandidateProvider(
  value: unknown,
): CandidateInsightProviderId | null {
  if (value === undefined) {
    return "gemini";
  }
  return value === "gemini" || value === "qwen" ? value : null;
}

function readBroadcastContextProvider(
  value: unknown,
): BroadcastContextProviderId | null {
  if (value === undefined) {
    return "disabled";
  }
  return value === "disabled" || value === "deepseek" || value === "qwen"
    ? value
    : null;
}

function readBroadcastTranscriptProvider(
  value: unknown,
): BroadcastTranscriptProviderId | null {
  if (value === undefined) return "disabled";
  return value === "disabled" || value === "gemini" || value === "qwen"
    ? value
    : null;
}

function normalizeWorkspaceId(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_WORKSPACE_ID_LENGTH) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(normalized)
    ? normalized
    : null;
}

function readQwenRegion(value: unknown): QwenRegion | null {
  if (value === undefined) {
    return DEFAULT_QWEN_REGION;
  }
  return value === "singapore" || value === "beijing" ? value : null;
}

function qwenEndpoint(workspaceId: string, region: QwenRegion): string {
  return `https://${workspaceId}.${QWEN_REGION_HOSTS[region]}/compatible-mode/v1/chat/completions`;
}

function isImplementationActive(
  descriptor: AiProviderDescriptor | null,
): boolean {
  return descriptor?.implementationStatus === "active";
}

export function resolveCandidateInsightConnection(
  environment: AiProviderEnvironment,
): CandidateInsightConnectionResolution {
  const provider = readCandidateProvider(environment.CANDIDATE_INSIGHT_PROVIDER);
  if (provider === null) {
    return { ok: false, code: "INVALID_PROVIDER" };
  }

  if (provider === "gemini") {
    const apiKey = normalizeSecret(environment.GEMINI_API_KEY);
    if (apiKey === null) {
      return { ok: false, code: "MISSING_CREDENTIALS" };
    }
    return {
      ok: true,
      connection: {
        provider,
        descriptor: AI_PROVIDER_CATALOG.candidateInsight.gemini,
        endpoint: GEMINI_ENDPOINT,
        apiKey,
      },
    };
  }

  const apiKey = normalizeSecret(environment.QWEN_API_KEY);
  if (apiKey === null) {
    return { ok: false, code: "MISSING_CREDENTIALS" };
  }
  const rawWorkspaceId = environment.QWEN_WORKSPACE_ID;
  const workspaceId = rawWorkspaceId === undefined
    ? null
    : normalizeWorkspaceId(rawWorkspaceId);
  if (rawWorkspaceId !== undefined && workspaceId === null) {
    return { ok: false, code: "INVALID_WORKSPACE_ID" };
  }
  const region = readQwenRegion(environment.QWEN_REGION);
  if (region === null) {
    return { ok: false, code: "INVALID_REGION" };
  }
  return {
    ok: true,
    connection: {
      provider,
      descriptor: AI_PROVIDER_CATALOG.candidateInsight.qwen,
      endpoint:
        workspaceId === null
          ? QWEN_SHARED_COMPATIBLE_ENDPOINTS[region]
          : qwenEndpoint(workspaceId, region),
      apiKey,
      region,
    },
  };
}

export function isBoundedAiProviderFallbackEnabled(
  environment: AiProviderEnvironment,
): boolean {
  return environment.AI_PROVIDER_FALLBACK_MODE === "bounded";
}

/**
 * Resolves one alternate candidate provider without exposing credentials to the
 * browser. The caller remains responsible for allowing at most one paid switch.
 */
export function resolveCandidateInsightFallbackConnection(
  environment: AiProviderEnvironment,
  primaryProvider: CandidateInsightProviderId,
): CandidateInsightConnection | null {
  if (!isBoundedAiProviderFallbackEnabled(environment)) {
    return null;
  }
  const fallbackProvider: CandidateInsightProviderId =
    primaryProvider === "qwen" ? "gemini" : "qwen";
  const resolution = resolveCandidateInsightConnection({
    ...environment,
    CANDIDATE_INSIGHT_PROVIDER: fallbackProvider,
  });
  return resolution.ok ? resolution.connection : null;
}

export function resolveBroadcastContextConnection(
  environment: AiProviderEnvironment,
): BroadcastContextConnectionResolution {
  const provider = readBroadcastContextProvider(
    environment.BROADCAST_CONTEXT_PROVIDER,
  );
  if (provider === null) {
    return { ok: false, code: "INVALID_PROVIDER" };
  }
  if (provider === "disabled") {
    return { ok: true, connection: { provider } };
  }
  if (provider === "qwen") {
    const apiKey = normalizeSecret(environment.QWEN_API_KEY);
    if (apiKey === null) return { ok: false, code: "MISSING_CREDENTIALS" };
    const region = readQwenRegion(environment.QWEN_REGION);
    if (region === null) return { ok: false, code: "INVALID_REGION" };
    const rawWorkspaceId = environment.QWEN_WORKSPACE_ID;
    const workspaceId = rawWorkspaceId === undefined
      ? null
      : normalizeWorkspaceId(rawWorkspaceId);
    if (rawWorkspaceId !== undefined && workspaceId === null) {
      return { ok: false, code: "INVALID_WORKSPACE_ID" };
    }
    return {
      ok: true,
      connection: {
        provider,
        descriptor: AI_PROVIDER_CATALOG.broadcastContext.qwen,
        endpoint:
          workspaceId === null
            ? QWEN_SHARED_COMPATIBLE_ENDPOINTS[region]
            : qwenEndpoint(workspaceId, region),
        apiKey,
        region,
      },
    };
  }
  const apiKey = normalizeSecret(environment.DEEPSEEK_API_KEY);
  if (apiKey === null) {
    return { ok: false, code: "MISSING_CREDENTIALS" };
  }
  return {
    ok: true,
    connection: {
      provider,
      descriptor: AI_PROVIDER_CATALOG.broadcastContext.deepseek,
      endpoint: DEEPSEEK_ENDPOINT,
      apiKey,
    },
  };
}

export function resolveBroadcastTranscriptConnection(
  environment: AiProviderEnvironment,
): BroadcastTranscriptConnectionResolution {
  const provider = readBroadcastTranscriptProvider(
    environment.BROADCAST_TRANSCRIPT_PROVIDER,
  );
  if (provider === null) return { ok: false, code: "INVALID_PROVIDER" };
  if (provider === "disabled") {
    return { ok: true, connection: { provider } };
  }
  if (provider === "gemini") {
    const apiKey = normalizeSecret(environment.GEMINI_API_KEY);
    if (apiKey === null) return { ok: false, code: "MISSING_CREDENTIALS" };
    return {
      ok: true,
      connection: {
        provider,
        descriptor: AI_PROVIDER_CATALOG.broadcastTranscript.gemini,
        endpoint: GEMINI_ENDPOINT,
        apiKey,
      },
    };
  }
  const apiKey = normalizeSecret(environment.QWEN_API_KEY);
  if (apiKey === null) return { ok: false, code: "MISSING_CREDENTIALS" };
  const region = readQwenRegion(environment.QWEN_REGION);
  if (region === null) return { ok: false, code: "INVALID_REGION" };
  const rawWorkspaceId = environment.QWEN_WORKSPACE_ID;
  const workspaceId = rawWorkspaceId === undefined
    ? null
    : normalizeWorkspaceId(rawWorkspaceId);
  if (rawWorkspaceId !== undefined && workspaceId === null) {
    return { ok: false, code: "INVALID_WORKSPACE_ID" };
  }
  return {
    ok: true,
    connection: {
      provider,
      descriptor: AI_PROVIDER_CATALOG.broadcastTranscript.qwen,
      endpoint:
        workspaceId === null
          ? QWEN_SHARED_COMPATIBLE_ENDPOINTS[region]
          : qwenEndpoint(workspaceId, region),
      apiKey,
      region,
    },
  };
}

/**
 * Produces only booleans and public model metadata. It is safe to inspect in
 * tests and operations output; credentials, workspace IDs, and endpoints are
 * deliberately absent.
 */
export function createAiProviderReadinessManifest(
  environment: AiProviderEnvironment,
): AiProviderReadinessManifest {
  const candidateProvider = readCandidateProvider(
    environment.CANDIDATE_INSIGHT_PROVIDER,
  );
  const candidateResolution = resolveCandidateInsightConnection(environment);
  const candidateDescriptor = candidateProvider === null
    ? null
    : AI_PROVIDER_CATALOG.candidateInsight[candidateProvider];

  const contextProvider = readBroadcastContextProvider(
    environment.BROADCAST_CONTEXT_PROVIDER,
  );
  const contextResolution = resolveBroadcastContextConnection(environment);
  const contextDescriptor = contextProvider === "deepseek"
    ? AI_PROVIDER_CATALOG.broadcastContext.deepseek
    : contextProvider === "qwen"
      ? AI_PROVIDER_CATALOG.broadcastContext.qwen
      : null;
  const transcriptProvider = readBroadcastTranscriptProvider(
    environment.BROADCAST_TRANSCRIPT_PROVIDER,
  );
  const transcriptResolution = resolveBroadcastTranscriptConnection(environment);
  const transcriptDescriptor = transcriptProvider === "gemini"
    ? AI_PROVIDER_CATALOG.broadcastTranscript.gemini
    : transcriptProvider === "qwen"
      ? AI_PROVIDER_CATALOG.broadcastTranscript.qwen
      : null;

  return {
    schemaVersion: AI_PROVIDER_CONFIGURATION_VERSION,
    candidateInsight: {
      selectedProvider: candidateProvider,
      modelId: candidateDescriptor?.modelId ?? null,
      modelRevision: candidateDescriptor?.modelRevision ?? null,
      implementationStatus: candidateDescriptor?.implementationStatus ?? null,
      configured: candidateResolution.ok,
      active: candidateResolution.ok && isImplementationActive(candidateDescriptor),
    },
    broadcastContext: {
      selectedProvider: contextProvider,
      modelId: contextDescriptor?.modelId ?? null,
      modelRevision: contextDescriptor?.modelRevision ?? null,
      implementationStatus:
        contextProvider === "disabled"
          ? "disabled"
          : contextDescriptor?.implementationStatus ?? null,
      configured: contextResolution.ok,
      active: contextResolution.ok && isImplementationActive(contextDescriptor),
    },
    broadcastTranscript: {
      selectedProvider: transcriptProvider,
      modelId: transcriptDescriptor?.modelId ?? null,
      modelRevision: transcriptDescriptor?.modelRevision ?? null,
      implementationStatus:
        transcriptProvider === "disabled"
          ? "disabled"
          : transcriptDescriptor?.implementationStatus ?? null,
      configured: transcriptResolution.ok,
      active:
        transcriptResolution.ok && isImplementationActive(transcriptDescriptor),
    },
  };
}
