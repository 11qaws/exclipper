export const CANDIDATE_PASS_B_AUDIO_GATE_FRAME_MS = 20;
export const CANDIDATE_PASS_B_AUDIO_GATE_MIN_ACTIVE_RATIO = 0.01;

const MIN_FRAME_RMS = 0.0025;
const MIN_FRAME_PEAK = 0.015;

export interface CandidatePassBAudioGateSummary {
  readonly frameCount: number;
  readonly activeFrameCount: number;
  readonly activeFrameRatio: number;
  readonly audible: boolean;
}

/**
 * Rejects digital silence and isolated clicks before Whisper can hallucinate
 * speech. It is intentionally only a conservative gate, not a speaker or
 * sound-event classifier.
 */
export function summarizeCandidatePassBAudioGate(
  pcm: Float32Array,
  sampleRateHz: number,
): CandidatePassBAudioGateSummary {
  if (!Number.isSafeInteger(sampleRateHz) || sampleRateHz <= 0) {
    throw new RangeError("sampleRateHz must be a positive safe integer");
  }
  const frameLength = Math.max(
    1,
    Math.round((sampleRateHz * CANDIDATE_PASS_B_AUDIO_GATE_FRAME_MS) / 1_000),
  );
  const frameCount = Math.ceil(pcm.length / frameLength);
  let activeFrameCount = 0;

  for (let frameStart = 0; frameStart < pcm.length; frameStart += frameLength) {
    const frameEnd = Math.min(pcm.length, frameStart + frameLength);
    let sumSquares = 0;
    let peak = 0;
    for (let index = frameStart; index < frameEnd; index += 1) {
      const rawValue = pcm[index] ?? 0;
      const value = Number.isFinite(rawValue)
        ? Math.min(1, Math.max(-1, rawValue))
        : 0;
      sumSquares += value * value;
      peak = Math.max(peak, Math.abs(value));
    }
    const sampleCount = frameEnd - frameStart;
    const rms = sampleCount === 0 ? 0 : Math.sqrt(sumSquares / sampleCount);
    if (rms >= MIN_FRAME_RMS && peak >= MIN_FRAME_PEAK) {
      activeFrameCount += 1;
    }
  }

  const activeFrameRatio =
    frameCount === 0 ? 0 : activeFrameCount / frameCount;
  return {
    frameCount,
    activeFrameCount,
    activeFrameRatio,
    audible:
      activeFrameCount > 0 &&
      activeFrameRatio >= CANDIDATE_PASS_B_AUDIO_GATE_MIN_ACTIVE_RATIO,
  };
}
