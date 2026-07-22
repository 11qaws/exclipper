import { describe, expect, it } from "vitest";
import {
  AI_PROVIDER_CATALOG,
  createAiProviderReadinessManifest,
  isBoundedAiProviderFallbackEnabled,
  resolveBroadcastContextConnection,
  resolveBroadcastTranscriptConnection,
  resolveBroadcastTranscriptFallbackConnection,
  resolveCandidateInsightConnection,
  resolveCandidateInsightFallbackConnection,
} from "./aiProviderConfiguration";

describe("aiProviderConfiguration", () => {
  it("keeps Gemini as the configured candidate default", () => {
    const resolution = resolveCandidateInsightConnection({
      GEMINI_API_KEY: "gemini-secret",
    });

    expect(resolution).toEqual({
      ok: true,
      connection: {
        provider: "gemini",
        descriptor: AI_PROVIDER_CATALOG.candidateInsight.gemini,
        endpoint:
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
        apiKey: "gemini-secret",
      },
    });
  });

  it("resolves an active bounded Qwen candidate connection", () => {
    const environment = {
      CANDIDATE_INSIGHT_PROVIDER: "qwen",
      QWEN_API_KEY: "qwen-secret",
      QWEN_WORKSPACE_ID: "Workspace-123",
      QWEN_REGION: "singapore",
    } as const;
    const resolution = resolveCandidateInsightConnection(environment);
    const manifest = createAiProviderReadinessManifest(environment);

    expect(resolution).toEqual({
      ok: true,
      connection: {
        provider: "qwen",
        descriptor: AI_PROVIDER_CATALOG.candidateInsight.qwen,
        endpoint:
          "https://workspace-123.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
        apiKey: "qwen-secret",
        region: "singapore",
      },
    });
    expect(manifest.candidateInsight).toEqual({
      selectedProvider: "qwen",
      modelId: "qwen3.5-omni-flash",
      modelRevision: "qwen3.5-omni-flash-grounded-frames-cast-v4-2026-07-22",
      implementationStatus: "active",
      configured: true,
      active: true,
    });
  });

  it("enables exactly one alternate candidate provider only in bounded mode", () => {
    const environment = {
      CANDIDATE_INSIGHT_PROVIDER: "qwen",
      AI_PROVIDER_FALLBACK_MODE: "bounded",
      QWEN_API_KEY: "qwen-secret",
      GEMINI_API_KEY: "gemini-secret",
    } as const;

    expect(isBoundedAiProviderFallbackEnabled(environment)).toBe(true);
    expect(resolveCandidateInsightFallbackConnection(environment, "qwen")).toEqual({
      provider: "gemini",
      descriptor: AI_PROVIDER_CATALOG.candidateInsight.gemini,
      endpoint:
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
      apiKey: "gemini-secret",
    });
    expect(
      resolveCandidateInsightFallbackConnection(
        { ...environment, AI_PROVIDER_FALLBACK_MODE: "disabled" },
        "qwen",
      ),
    ).toBeNull();
    expect(
      resolveCandidateInsightFallbackConnection(
        { ...environment, GEMINI_API_KEY: "" },
        "qwen",
      ),
    ).toBeNull();
  });

  it("fails closed for missing or malformed provider configuration", () => {
    expect(resolveCandidateInsightConnection({})).toEqual({
      ok: false,
      code: "MISSING_CREDENTIALS",
    });
    expect(
      resolveCandidateInsightConnection({
        CANDIDATE_INSIGHT_PROVIDER: "other",
        GEMINI_API_KEY: "gemini-secret",
      }),
    ).toEqual({ ok: false, code: "INVALID_PROVIDER" });
    expect(
      resolveCandidateInsightConnection({
        CANDIDATE_INSIGHT_PROVIDER: "qwen",
        QWEN_API_KEY: "qwen-secret",
        QWEN_WORKSPACE_ID: "workspace.example.com/path",
      }),
    ).toEqual({ ok: false, code: "INVALID_WORKSPACE_ID" });
    expect(
      resolveCandidateInsightConnection({
        CANDIDATE_INSIGHT_PROVIDER: "qwen",
        QWEN_API_KEY: "qwen-secret",
        QWEN_WORKSPACE_ID: "workspace-123",
        QWEN_REGION: "arbitrary-region",
      }),
    ).toEqual({ ok: false, code: "INVALID_REGION" });
  });

  it("keeps DeepSeek available for the disabled-by-default context role", () => {
    expect(resolveBroadcastContextConnection({})).toEqual({
      ok: true,
      connection: { provider: "disabled" },
    });

    const environment = {
      BROADCAST_CONTEXT_PROVIDER: "deepseek",
      DEEPSEEK_API_KEY: "deepseek-secret",
    } as const;
    expect(resolveBroadcastContextConnection(environment)).toEqual({
      ok: true,
      connection: {
        provider: "deepseek",
        descriptor: AI_PROVIDER_CATALOG.broadcastContext.deepseek,
        endpoint: "https://api.deepseek.com/chat/completions",
        apiKey: "deepseek-secret",
      },
    });
    expect(createAiProviderReadinessManifest(environment).broadcastContext).toEqual({
      selectedProvider: "deepseek",
      modelId: "deepseek-v4-pro",
      modelRevision: "deepseek-v4-pro-api-reviewed-2026-07-22",
      implementationStatus: "active",
      configured: true,
      active: true,
    });
  });

  it("activates Qwen 3.7 Plus context reasoning with the installed Singapore key", () => {
    const environment = {
      BROADCAST_CONTEXT_PROVIDER: "qwen",
      QWEN_API_KEY: "qwen-secret",
      QWEN_REGION: "singapore",
    } as const;
    expect(resolveBroadcastContextConnection(environment)).toEqual({
      ok: true,
      connection: {
        provider: "qwen",
        descriptor: AI_PROVIDER_CATALOG.broadcastContext.qwen,
        endpoint:
          "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
        apiKey: "qwen-secret",
        region: "singapore",
      },
    });
    expect(createAiProviderReadinessManifest(environment).broadcastContext).toEqual({
      selectedProvider: "qwen",
      modelId: "qwen3.7-plus",
      modelRevision: "qwen3.7-plus-context-editorial-jury-topic-balanced-2026-07-22",
      implementationStatus: "active",
      configured: true,
      active: true,
    });
  });

  it("activates the bounded Qwen transcript transport with a Singapore shared endpoint", () => {
    const environment = {
      BROADCAST_TRANSCRIPT_PROVIDER: "qwen",
      QWEN_API_KEY: "qwen-secret",
    } as const;
    expect(resolveBroadcastTranscriptConnection(environment)).toEqual({
      ok: true,
      connection: {
        provider: "qwen",
        descriptor: AI_PROVIDER_CATALOG.broadcastTranscript.qwen,
        endpoint:
          "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
        apiKey: "qwen-secret",
        region: "singapore",
      },
    });
    expect(createAiProviderReadinessManifest(environment).broadcastTranscript).toEqual({
      selectedProvider: "qwen",
      modelId: "qwen3.5-omni-flash",
      modelRevision: "qwen3.5-omni-flash-audio-transcript-90s-reviewed-2026-07-22",
      implementationStatus: "active",
      configured: true,
      active: true,
    });
  });

  it("resolves one alternate transcript provider only in bounded mode", () => {
    const environment = {
      BROADCAST_TRANSCRIPT_PROVIDER: "qwen",
      AI_PROVIDER_FALLBACK_MODE: "bounded",
      QWEN_API_KEY: "qwen-secret",
      GEMINI_API_KEY: "gemini-secret",
    } as const;
    expect(
      resolveBroadcastTranscriptFallbackConnection(environment, "qwen"),
    ).toMatchObject({
      provider: "gemini",
      descriptor: AI_PROVIDER_CATALOG.broadcastTranscript.gemini,
      apiKey: "gemini-secret",
    });
    expect(
      resolveBroadcastTranscriptFallbackConnection(
        { ...environment, AI_PROVIDER_FALLBACK_MODE: "disabled" },
        "qwen",
      ),
    ).toBeNull();
  });

  it("never includes credentials or workspace IDs in the readiness manifest", () => {
    const serialized = JSON.stringify(
      createAiProviderReadinessManifest({
        CANDIDATE_INSIGHT_PROVIDER: "qwen",
        QWEN_API_KEY: "qwen-secret-never-return",
        QWEN_WORKSPACE_ID: "private-workspace",
        BROADCAST_CONTEXT_PROVIDER: "deepseek",
        DEEPSEEK_API_KEY: "deepseek-secret-never-return",
        GEMINI_API_KEY: "gemini-secret-never-return",
      }),
    );

    expect(serialized).not.toContain("qwen-secret-never-return");
    expect(serialized).not.toContain("deepseek-secret-never-return");
    expect(serialized).not.toContain("gemini-secret-never-return");
    expect(serialized).not.toContain("private-workspace");
    expect(serialized).not.toContain("endpoint");
  });

  it("reports both Gemini roles from one secret even when Qwen is selected", () => {
    const manifest = createAiProviderReadinessManifest({
      CANDIDATE_INSIGHT_PROVIDER: "qwen",
      BROADCAST_TRANSCRIPT_PROVIDER: "qwen",
      QWEN_API_KEY: "qwen-secret",
      GEMINI_API_KEY: "shared-gemini-secret",
    });
    expect(manifest.schemaVersion).toBe("1.2.0");
    expect(manifest.geminiRoutes).toEqual({
      candidateInsightConfigured: true,
      broadcastTranscriptConfigured: true,
    });
  });
});
