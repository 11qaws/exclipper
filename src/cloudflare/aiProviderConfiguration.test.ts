import { describe, expect, it } from "vitest";
import {
  AI_PROVIDER_CATALOG,
  createAiProviderReadinessManifest,
  resolveBroadcastContextConnection,
  resolveCandidateInsightConnection,
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
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-pro:generateContent",
        apiKey: "gemini-secret",
      },
    });
  });

  it("resolves a bounded Qwen connection without making it active", () => {
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
        workspaceId: "workspace-123",
        region: "singapore",
      },
    });
    expect(manifest.candidateInsight).toEqual({
      selectedProvider: "qwen",
      modelId: "qwen3.5-omni-plus",
      modelRevision: "qwen3.5-omni-plus-api-reviewed-2026-07-21",
      implementationStatus: "prepared",
      configured: true,
      active: false,
    });
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

  it("reserves DeepSeek for the disabled-by-default context role", () => {
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
      modelRevision: "deepseek-v4-pro-api-reviewed-2026-07-21",
      implementationStatus: "prepared",
      configured: true,
      active: false,
    });
  });

  it("never includes credentials or workspace IDs in the readiness manifest", () => {
    const serialized = JSON.stringify(
      createAiProviderReadinessManifest({
        CANDIDATE_INSIGHT_PROVIDER: "qwen",
        QWEN_API_KEY: "qwen-secret-never-return",
        QWEN_WORKSPACE_ID: "private-workspace",
        BROADCAST_CONTEXT_PROVIDER: "deepseek",
        DEEPSEEK_API_KEY: "deepseek-secret-never-return",
      }),
    );

    expect(serialized).not.toContain("qwen-secret-never-return");
    expect(serialized).not.toContain("deepseek-secret-never-return");
    expect(serialized).not.toContain("private-workspace");
    expect(serialized).not.toContain("endpoint");
  });
});
