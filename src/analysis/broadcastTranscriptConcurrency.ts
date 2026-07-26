/**
 * How many transcription requests may be in flight at once.
 *
 * This is the single number that decides how long a broadcast without captions
 * takes. A 2-hour source becomes about 91 chunks of 90 seconds, and each
 * request costs roughly 100 seconds — remote ASR runs near real time. At four
 * concurrent that is 23 waves, close to 40 minutes, which is what was observed.
 *
 * Four was never the ceiling; it was a cautious step. The caution was about the
 * relay: base64-in-JSON cost about 30 MB of transient strings per request
 * against a 128 MB isolate, and two concurrent chunks killed it (measured
 * 2026-07-23). The 0.4.0 raw-WAV transport dropped that to about 7 MB, and the
 * caution was never revisited.
 *
 * What actually binds now, in order:
 *
 * - **Relay memory.** ~7 MB per request against a 128 MB isolate. Twelve
 *   concurrent is ~84 MB, leaving room for the rest of the isolate. This is
 *   the reason for the number.
 * - **Proxy rate limit.** 60 requests per 60 seconds (`wrangler.jsonc`). At
 *   ~100 s per request, twelve concurrent issues about 7 a minute — an eighth
 *   of the allowance. Not binding.
 * - **Upstream ASR concurrency.** Unmeasured. If it throttles, the symptom is
 *   slower individual requests rather than errors, and the span measurement
 *   (`remote-transcription(no-caption)`) will show total time failing to fall
 *   in proportion.
 *
 * Twelve should take the same broadcast from ~40 minutes to ~13. Raise it
 * further against a measurement, not against this reasoning.
 *
 * 이 값이 별도 모듈에 있는 이유: 워커와 화면이 **같은 값을 봐야** 한다. 화면은
 * 이것을 "동시 N" 으로 그대로 보여 주므로, 손으로 맞추는 사본을 두면 워커를 올린
 * 뒤 화면만 옛 숫자를 말하게 되고 **그 거짓말은 아무 오류도 내지 않는다.**
 * 워커 엔트리는 별도 번들이라 그쪽에서 화면 모듈을 가져올 수 없지만, 상수만 담은
 * 이 모듈은 양쪽 모두 가져갈 수 있다.
 */
export const MAX_IN_FLIGHT_TRANSCRIPTIONS = 12;
