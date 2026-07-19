import { describe, expect, it, vi } from "vitest";

import { selectCandidatePassBRuntimeDevice } from "./candidatePassBRuntime";

describe("selectCandidatePassBRuntimeDevice", () => {
  it("uses WebGPU only after an adapter is available", async () => {
    const requestWebGpuAdapter = vi.fn().mockResolvedValue({ name: "adapter" });

    await expect(
      selectCandidatePassBRuntimeDevice(
        {
          preferredRuntimeTier: "webgpu",
          webGpu: true,
          webAssembly: true,
        },
        { requestWebGpuAdapter },
      ),
    ).resolves.toBe("webgpu");
    expect(requestWebGpuAdapter).toHaveBeenCalledOnce();
  });

  it.each([null, "throws"] as const)(
    "falls back to WASM when WebGPU adapter discovery returns %s",
    async (outcome) => {
      const requestWebGpuAdapter =
        outcome === null
          ? vi.fn().mockResolvedValue(null)
          : vi.fn().mockRejectedValue(new Error("adapter unavailable"));

      await expect(
        selectCandidatePassBRuntimeDevice(
          {
            preferredRuntimeTier: "webgpu",
            webGpu: true,
            webAssembly: true,
          },
          { requestWebGpuAdapter },
        ),
      ).resolves.toBe("wasm");
    },
  );

  it("honors an explicit compatibility-mode retry", async () => {
    const requestWebGpuAdapter = vi.fn().mockResolvedValue({ name: "adapter" });

    await expect(
      selectCandidatePassBRuntimeDevice(
        {
          preferredRuntimeTier: "webgpu",
          webGpu: true,
          webAssembly: true,
        },
        { forceWasm: true, requestWebGpuAdapter },
      ),
    ).resolves.toBe("wasm");
    expect(requestWebGpuAdapter).not.toHaveBeenCalled();
  });

  it("returns unavailable when neither adapter nor WASM can run", async () => {
    await expect(
      selectCandidatePassBRuntimeDevice(
        {
          preferredRuntimeTier: "signals-only",
          webGpu: false,
          webAssembly: false,
        },
        { requestWebGpuAdapter: vi.fn().mockResolvedValue(null) },
      ),
    ).resolves.toBeNull();
  });
});
