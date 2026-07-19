import type { PreferredPreflightRuntimeTier } from "../media/localMediaPreflight";
import type { CandidatePassBDevice } from "./candidatePassBWorkerProtocol";

export interface CandidatePassBRuntimeCapabilitySnapshot {
  readonly preferredRuntimeTier: PreferredPreflightRuntimeTier;
  readonly webGpu: boolean;
  readonly webAssembly: boolean;
}

export interface CandidatePassBRuntimeSelectionOptions {
  readonly forceWasm?: boolean;
  readonly requestWebGpuAdapter?: () => Promise<object | null>;
}

type NavigatorWithOptionalGpu = Navigator & {
  readonly gpu?: {
    requestAdapter(): Promise<object | null>;
  };
};

async function requestDefaultWebGpuAdapter(): Promise<object | null> {
  const gpu = (globalThis.navigator as NavigatorWithOptionalGpu | undefined)?.gpu;
  return gpu === undefined ? null : gpu.requestAdapter();
}

/**
 * Converts the preflight hint into a runtime that is usable now. WebGPU is not
 * selected until an adapter has actually been granted; WASM remains the safe
 * compatibility fallback.
 */
export async function selectCandidatePassBRuntimeDevice(
  capabilities: CandidatePassBRuntimeCapabilitySnapshot,
  options: CandidatePassBRuntimeSelectionOptions = {},
): Promise<CandidatePassBDevice | null> {
  if (options.forceWasm === true) {
    return capabilities.webAssembly ? "wasm" : null;
  }

  if (
    capabilities.preferredRuntimeTier === "webgpu" &&
    capabilities.webGpu
  ) {
    try {
      const adapter = await (
        options.requestWebGpuAdapter ?? requestDefaultWebGpuAdapter
      )();
      if (adapter !== null) {
        return "webgpu";
      }
    } catch {
      // Adapter discovery is allowed to fail; WASM is checked below.
    }
  }

  return capabilities.webAssembly ? "wasm" : null;
}
