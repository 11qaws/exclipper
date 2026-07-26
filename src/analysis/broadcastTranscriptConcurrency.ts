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
 * **Twelve was tried and it killed the relay** (2026-07-26). The browser
 * reported CORS violations, which is what a dead Worker looks like from
 * outside: a runtime killed for exceeding CPU or memory never reaches the
 * handler that attaches `Access-Control-Allow-Origin`, so Cloudflare's own
 * error page is served and the browser blames CORS. The proxy says as much in
 * its own comment — "a runtime that is killed for exceeding CPU or memory
 * limits never reaches this catch, so keeping request work small remains the
 * actual defence".
 *
 * The arithmetic that justified twelve (~7 MB × 12 = 84 MB against 128 MB)
 * counted only the audio payloads and nothing else the isolate holds while
 * decoding them.
 *
 * The failed run lost everything downstream, not just speed: transcription
 * failed, deepPass measured 0%, and six candidates were published with no
 * broadcast context. **A concurrency that kills the relay is slower than one
 * that does not, because the work is discarded rather than delayed.**
 *
 * So this returns to four, which is measured to work. Raising it needs the
 * relay to survive first — smaller per-request work, or a higher ceiling — and
 * a measurement of where it actually dies rather than an estimate of where it
 * ought to.
 *
 * 이 값이 별도 모듈에 있는 이유: 워커와 화면이 **같은 값을 봐야** 한다. 화면은
 * 이것을 "동시 N" 으로 그대로 보여 주므로, 손으로 맞추는 사본을 두면 워커를 올린
 * 뒤 화면만 옛 숫자를 말하게 되고 **그 거짓말은 아무 오류도 내지 않는다.**
 * 워커 엔트리는 별도 번들이라 그쪽에서 화면 모듈을 가져올 수 없지만, 상수만 담은
 * 이 모듈은 양쪽 모두 가져갈 수 있다.
 */
export const MAX_IN_FLIGHT_TRANSCRIPTIONS = 4;
