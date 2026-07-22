# ExClipper 개인용 운영·배포·복구 계획

## 2026-07-22 release notes

- `0.3.39`: whole-broadcast overview and four deterministic full-coverage discovery slices start together. Qwen 3.7 Plus remains the overview/final jury and validates topic-balanced reserve leads; Qwen 3.6 Flash handles discovery and localization for leads already approved by the jury. Both refinement tiers share a six-request bounded pool. The 26-client-call ceiling and canonical Candidate Ledger are unchanged.
- The accepted multi-purpose clipping direction is `Editorial Intent Profiles`: `balanced`, `main-story`, `shorts`, and `recap` are projections over one paid evidence run, not four analysis modes. Event categories such as apology, quiet achievement, talk conflict, and strong reaction remain independent evidence labels. Profile UI/ranking is a later slice and must not trigger repeat API analysis.
- `0.3.36`: whole-context comparison accepts up to 32 grounded meaning leads. The Qwen 3.7 jury may approve up to eight independent events; topic-balanced reserves expand caption-only text localization to at most 20 internal leads, while no-caption ASR remains capped at four, new semantic proposals remain capped at 12, and each multimodal detail run keeps its 12-target bound. Canonical ledger entries are not deleted to enforce those execution budgets.
- Context routing/cache revision is `1.9.0`, topical discovery is `1.3.0`, whole-context envelope is `1.1.0`, and the jury model revision is `qwen3.7-plus-context-editorial-jury-topic-balanced-2026-07-22`. Jury-approved localization records `qwen3.6-flash-caption-refinement-speed-v1-2026-07-22`; reserve adjudication records `qwen3.7-plus-caption-refinement-quality-v1-2026-07-22`. Do not relabel an older paid result as either revision.
- Shared role policy is `1.11.0` and budget policy is `1.2.0`. The context stage advertises at most 26 client calls and reserves `$0.08` for compressed context/refinement text. The previous Qwen 3.7-only food run cost `$0.073543` and took about 215 seconds; the rejected all-fast experiment cost `$0.069836` and took about 104 seconds but lost expected reserve events. The final hybrid food smoke cost `$0.069703` and took 114.8 seconds while preserving all three expected events.
- The context endpoint's per-client and global limits are both 30 requests per 60 seconds. Caption refinement must use the six-request bounded pool. One normal maximum run uses at most 26 context requests (overview + four topical slices + jury + twenty refinements), leaving a small guard band; provider retries and a second analysis must not be launched speculatively in the same window.
- Gameplay abstention is post-model and deterministic. It requires repeated whole-broadcast gameplay evidence plus candidate-local routine gameplay or generic banter, so a closing next-stream game announcement does not contaminate a food broadcast. Exact accountability, rare achievement, serious bug, consequential responsibility dispute, and long payoff exceptions remain reviewable.
- Live release smoke contracts: food must reject all three opening fast candidates and retain 칼국수·껍데기·두바이 초콜릿 through caption refinement; subscription must retain the mistake/apology/responsibility/compensation chain; Minecraft relay must return zero refinement IDs. The `0.3.39` food run completed 19/19 refinement calls with no transport failure: six jury-approved localizations used Qwen 3.6, thirteen topic-balanced reserves used Qwen 3.7, and 32 grounded refined moments were returned before canonical deduplication.
- `0.3.35`: production transcript transport is limited to the live-proven 90-second Qwen Omni envelope. The 12-hour fragmented plan admits at most 240 requests while keeping the same `$0.42` duration budget. Each successful cell is checkpointed immediately; reload and transient failure recovery subtract already-covered source ranges and request only missing ranges, including compatible 210-second cells saved by `0.3.34`.
- Candidate frame capture opens at most two browser decoders at once, while the existing two-request AI pool remains parallel. A missing frame still downgrades to the audio-only projection rather than inventing screen context.
- Candidate perception may send only the fixed `chzzk-video-13996057-v1` roster ID, and only for a filename carrying replay `13996057` or the reviewed `교환학생/합격생/장학생` title. The Worker expands six reviewed public VTuber-avatar descriptions server-side. `provided-cast-reference` requires two distinct same-frame traits and confidence `>= 0.88`; arbitrary roster text, unrelated sources, unknown names, low-confidence matches, and voice resemblance fail closed. Identity remains display-only evidence.
- Routing policy is `1.8.0`; candidate route is `qwen3.5-omni-flash_then_gemini-3.6-flash_bounded-cast-v4`. Rollback readers retain the preceding Qwen/Gemini revisions and v2/v3 route manifests without relabeling paid results.
- `0.3.34`: candidate audio+frame fallback and opt-in Gemini transcript routing use GA `gemini-3.6-flash`; production remains Qwen-primary. Routing policy is `1.7.0`, while the broadcast-context cache fence intentionally remains `1.6.0`.
- Before enabling Gemini as primary, refresh the `GEMINI_API_KEY` Worker Secret and require a real candidate request to return model ID `gemini-3.6-flash`, revision `gemini-3.6-flash-grounded-frames-cast-v4-2026-07-22`, and a grounded food-talk description. A binding name in `wrangler secret list` is not sufficient readiness evidence.
- Rollback and recovery must continue accepting the exact Gemini 3.5 model/revision pair and v2 route manifest. Never rewrite a recovered paid result to the 3.6 identity or invalidate Qwen whole-context results for this candidate-only change.
- Candidate fallback matrix: `timeout | unavailable | rate-limited | auth | model-unavailable | response-format | invalid-response` may switch provider once; `invalid-argument | rejected` must fail without a second paid request. Long-audio transcription remains single-provider because timeout billing is ambiguous at broadcast scale.
- Compressed-context tier matrix: `timeout | unavailable | rate-limited | model-unavailable | response-format | invalid-response` may switch once between Qwen 3.7 and 3.6; `auth | invalid-argument | rejected` must stop because the credential or shared contract will fail on the alternate tier too.
- A successful switch exposes `X-ExClipper-Fallback-Reason`. If both providers fail, expose only the bounded primary/fallback failure classes. Never expose upstream body text, keys, endpoint credentials, audio, frames, or transcript in diagnostics.
- Context `reject` is an AI priority projection, not deletion. Release smoke must confirm the canonical candidate count and editor review/boundary state remain stable while the paid detail queue excludes unapproved `deprioritized` and explicit-music candidates.

- `0.3.33`: transcript/context routing precedes candidate multimodal perception. Qwen3.6 Flash discovers up to 24 topical leads; Qwen3.7 Plus performs the final comparative jury; only three selected leads plus three context reserves enter caption-native refinement.
- Routing policy `1.6.0` invalidates older overview/discovery/jury caches. Caption-native refinement uses complete 30-second timestamp cells with zero ASR billing; the bounded one-minute audio refinement remains the only fallback when no matching caption track is available.
- Whole-context success responses expose public prompt/completion/total token counts in addition to model identity and fallback state. These headers contain no source text and are used by the live harness for list-price accounting.
- Food regression is identity-based: require leads near 19:38–20:16, 22:29–23:29, and 28:19–29:19; reject the explicit-music peaks at 01:11, 02:38, and 03:56. Matching the number `3` is not sufficient.
- Timeline smoke at maximized width verifies four labeled layers, 30-minute grid lines, chronological marker/card numbers, distinguishable topic bands, category-colored meaning-lead bars, and the collapsed/expanded numbered explanation list.
- Regression smoke has three different terminal contracts: food must keep the three named food events in the six-item refinement set, accidental subscription must include the formal apology/accountability chain, and routine relay gameplay must return zero jury selections.

- `0.3.31`: production sets `AI_PROVIDER_FALLBACK_MODE=bounded`. Candidate perception may switch once between Qwen3.5 Omni Flash and Gemini3.5 Flash; compressed Qwen context may switch once between Qwen3.7 Plus and Qwen3.6 Flash. Long-audio transcription is deliberately excluded from automatic provider switching to avoid ambiguous double billing.
- Successful candidate responses expose only public model ID, public revision, and whether fallback was used. CORS exposes those three headers; no credential, endpoint, workspace ID, provider body, transcript, or source metadata is included.
- Candidate result persistence schema is `1.3.0`. Rollback readers must continue accepting 1.0–1.2 records without `modelByCandidateId`; forward readers reject mismatched model/revision pairs.
- Routing policy `1.3.0` adds compact, grounded topic chapters to the Qwen whole-context response. A new run must not reuse an older context result that reports no topic support under the earlier policy.
- Candidate frame sampling waits for decoded data on temporarily attached, invisible media elements and limits the capture pool to two decoders. If the request still contains zero frames, both client and Worker reduce the result to audio-only evidence and discard provider-authored screen, game, participant, and causal claims.
- Broadcast transcript preflight reports the exact violated invariant. The 02:15:14.817 food-talk source is a valid 91-chunk plan under the verified 90-second transport; if it fails before fetch, investigate the newly reported invariant instead of rotating API keys.
- Timeline release smoke at a maximized width must verify 30-minute ticks, numbered/staggered candidates, topic bands, semantic-lead markers, the score landscape, and a wider independently scrolling evidence pane.

- Desktop-first workspace: verify the source summary and the primary analysis action are visible in the first viewport at a maximized browser width. At widths below 840px the columns collapse to one column.
- Phase contract: fast-pass completion may automatically start AI Pass B. A cancelled or failed Pass B must leave the fast candidates usable.
- Candidate event kinds now include `dialogue-issue-signal`. It is a conservative speech-change lead and must be described as a lead, never as a confirmed event.
- Cost display is advisory. Recalculate when candidate count or duration changes; do not use it as a billing guarantee.
- 파일명 끝의 `[YouTubeID]`가 일치하면 Worker가 공개 Android 플레이어 응답의 한국어 자막 트랙을 우선 시도한다. YouTube가 403/429 또는 자막 없음으로 응답하면 오류를 사용자 작업으로 넘기지 않고 예산 제한 Qwen 전사로 폴백한다.
- Pass B evidence and AI insight snapshots are stored by analysis run in a dedicated IndexedDB object store. Recovery filters them to the recovered candidate IDs, and a new run epoch prevents late writes from an older source contaminating the current result.
- Fixed non-vocal program-edge bursts (opening, ending, and break loops) are rejected by default. An edge segment can still survive when it has a distinctive vocal/dialogue anchor, while the central UI presents the automatic phase and candidate list without promotional copy.

- 문서 버전: `0.3.39`
- 기준일: 2026-07-22 (Asia/Seoul)
- 대상: GitHub Pages에서 실행되는 1인용 AI 편집 어시스턴트
- 함께 읽을 문서: `PRODUCT_PLAN.md`, `STATE_LIFECYCLE.md`, `DEVELOPMENT_LOG.md`

## 1. 운영 범위와 명시적 프로젝트 예외

ExClipper는 공유 서비스가 아니다. 한 사람이 선택한 몇 시간짜리 방송을 분석하고, AI 추천 후보를 검토해 클립·하이라이트 목록과 조건부 영상 파일을 만드는 **개인 편집 어시스턴트**다.

이번 프로젝트의 구체적인 제품 지시는 공용 지침의 일반적인 소규모 공유 서비스 기본값보다 우선한다. 따라서 다음 기능은 설계·출시 범위에서 제외한다.

- 회원가입, 로그인, 사용자 계정, 팀, 역할, 초대
- 여러 사람이 동시에 같은 프로젝트를 편집하는 기능
- 원격 프로젝트 데이터베이스와 기기간 자동 동기화
- 원본 프로젝트를 보관하는 공용 API 또는 백엔드
- 고정된 AI 분석 중계를 제외한 별도 애플리케이션 서버
- 서버 FFmpeg, 게시 대행, 공개 갤러리
- 원격 텔레메트리와 사용자 행동 추적

단, 개인용이라는 이유로 데이터 안전·복구·배포 품질을 생략하지 않는다. 다음 항목은 반드시 제품 수준으로 설계한다.

- 두 탭 충돌 방지
- 새로고침·브라우저 종료·Worker 중단 뒤 복구
- 저장 확정 전 성공 표시 금지
- 로컬 백업·가져오기·스키마 migration
- 재현 가능한 배포·검증·롤백
- 개인정보가 제거된 로컬 진단
- 저장 공간·모델 캐시·임시 파일 상한

CHZZK 공식 실시간 채팅 수집은 필요할 때만 설치하는 **선택형 동반 수집기**로 한정한다. 공용 수집 서버는 만들지 않는다.

## 2. 배포 구조와 데이터 경계

| 구성 요소 | 위치 | 책임 | 포함하지 않는 것 |
|---|---|---|---|
| GitHub Pages 앱 | 공개 정적 사이트 | UI, Source Adapter, 분석 조정, 검토, 내보내기, 고정 AI 분석 요청 | 비밀값, 사용자 DB, 범용 영상 프록시 |
| Cloudflare Worker | stateless 정밀 분석 중계 | 배포 Secret 주입, 역할별 고정 모델 요청, Origin·스키마·크기·횟수·시간 제한 | 사용자 계정, 프로젝트 DB, 원본 보관, 임의 프롬프트 |
| Web Worker | 사용자의 브라우저 | 오디오·영상 feature, AI 추론, 렌더 | 장기 원격 작업 |
| IndexedDB | 현재 브라우저 프로필 | 프로젝트, 후보, 검토 판단, checkpoint, manifest | 원본 영상 전체, 완성 영상 전체 |
| Cache API | 현재 브라우저 프로필 | 검증된 앱 셸과 AI 모델 캐시 | 사용자 데이터의 유일한 백업 |
| OPFS | 현재 브라우저 프로필 | 필요한 경우에만 렌더 임시 조각 | 장기 보관 원본 |
| 사용자가 고른 폴더 | 로컬 디스크 | 프로젝트 백업, 결과표, 클립 파일 | 앱이 임의로 접근하는 다른 폴더 |
| 고정 모델 원본 | 허용된 공개 HTTPS origin | hash가 고정된 모델 파일 제공 | 영상·음성·채팅 수신 |
| 선택형 로컬 수집기 | 사용자 컴퓨터 | 권한 있는 CHZZK 라이브 채팅을 JSONL로 기록 | 공용 계정, 원격 저장, 임의 채널 수집 |

UI에는 처리 위치 설명을 늘어놓지 않고 현재 작업, 진행 상태, 결과 한계, 다음 행동만 보여 준다. 빠른 분석과 반응 종류 분석, 후보 정밀 분석, 전체 문맥 분석은 서로 독립된 실행으로 관리하며 한 기능이 실패해도 이미 찾은 후보와 다른 검토 기능은 유지한다.

### 2.1 현재 `0.3.2` 오디오 fast pass·세션 구간 편집 운영 경계

- 원본 시간: 한 파일은 최대 12시간이다. 정확히 12시간은 허용하고 초과 파일은 메타데이터 검사 직후 Worker·지문 계산을 시작하기 전에 중단한다. 초과 파일의 성능과 복구는 운영 범위에 넣지 않는다.
- 런타임: MPL-2.0 라이선스의 Mediabunny `1.50.9`를 번들에 포함하고, `BlobSource` 최대 8MiB 캐시와 `AudioSampleSink` 순차 디코딩을 사용한다.
- 메모리: 전체 파일·전체 PCM을 복사하지 않는다. 디코딩 sample은 1초 집계에 반영한 직후 `close()`하고, `Input`은 성공·실패·취소 모두 한 번만 `dispose()`한다. 채널·downmix·에너지 scratch buffer는 재사용한다.
- 스테레오: 좌우가 역상인 영상에서도 반응이 상쇄되지 않도록 RMS와 peak는 채널별 에너지로 합치고, zero-crossing·음성 대역 계산에만 downmix를 쓴다.
- 작업 격리: 오디오 분석은 전용 module Worker 한 개에서 실행하며 event fence가 현재 session·run·worker·task와 모두 맞아야 결과를 받는다.
- 취소: 협력적 취소 요청과 ACK를 먼저 기다리고, 제한 시간 뒤에는 Worker를 강제 종료한다. 취소된 결과와 늦게 도착한 결과는 저장하지 않는다.
- 영속 경계: 원시 오디오·전사·파일명·MIME·채팅 원문은 저장하지 않는다. 1초 feature 자체도 현재 final result에 남기지 않고 후보별 허용 집계와 coverage 숫자만 저장한다.
- 폴백: 오디오 트랙 없음, 컨테이너·코덱 미지원, Worker 실패는 각각 reason code와 `completedWithGaps` coverage로 남긴다. 가능한 채팅과 낮은 우선순위의 화면 탐색 결과는 보존하지만 오디오 분석을 한 것처럼 표시하지 않는다.
- 배포 확인: 새 빌드 뒤에는 열린 이전 탭을 새로고침하고 HTML이 참조하는 audio Worker hash가 실제 Pages artifact에 있는지 smoke test한다. 앱 셸과 Worker가 서로 다른 빌드면 안전한 gap으로 끝나더라도 정상 배포로 승인하지 않는다.
- 번들 관찰값: 현재 production build에서 오디오 Worker는 약 334kB, 메인 JavaScript는 약 349kB다. 버전 갱신 때 gzip 크기와 Worker 분리 여부를 함께 기록한다.

### 2.2 `0.3.3~0.3.6` 후보 전용 로컬 전사 운영 기록 (`0.3.7`에서 비활성)

아래 항목은 이전 배포의 재현·롤백 기록이다. 현재 `0.3.13` 제품 경로에는 Whisper tiny가 번들되지 않으며, 실제 운영 경계는 2.6절의 기본 Gemini 후보 분석과 후보 클립 렌더링이다.

- 처리 범위: 최대 12시간 원본 전체를 Whisper로 전사하지 않는다. fast pass가 고른 최대 12개의 30~60초 후보만 점수 순서대로 범위 디코드한다.
- 전체 맥락용 전사는 별도 예산 단계다. 일치하는 YouTube 한국어 자막을 읽으면 이를 우선 저장하고, 없으면 `qwen3.5-omni-flash`의 보수적 계획 단가 `$0.000035/초`와 최대 `$0.42` 범위에서 모든 10분 블록을 고르게 표본화하고 최대 12개 사건 주변을 포함한다. 현재 Worker transport가 활성화되어 있으며 credential·요청 검증·예산 guard 중 하나라도 통과하지 못하면 upstream 호출 전에 fail-closed 한다.
- 런타임: `@huggingface/transformers`와 다국어 `onnx-community/whisper-tiny`를 별도 lazy Worker에서만 불러온다. 패키지 버전, 모델 commit revision, dtype을 manifest 상수로 고정한다. `navigator.gpu` 존재만 믿지 않고 실제 adapter를 요청한 뒤 WebGPU를 고르며, 거부·오류면 WASM으로 폴백한다. WebGPU 모델 준비 실패 뒤에는 새 identity의 WASM 호환 모드 재시도를 제공한다.
- 모델 네트워크: 첫 실행에는 모델·토크나이저·ONNX Runtime 파일 다운로드가 필요할 수 있고 이후 브라우저 캐시를 재사용한다. 이 요청에는 사용자 영상·PCM·채팅·전사가 포함되지 않는다.
- 메모리: 한 후보의 16kHz mono PCM만 보유하고 결과를 보낸 뒤 해제한다. 여러 후보 PCM과 원본 전체 PCM을 동시에 보관하지 않는다.
- 개인정보: 원문 전사와 timestamp는 현재 탭의 메모리 overlay다. IndexedDB, 진단 로그, 원격 telemetry, 현재 CSV·Markdown·JSON·clipboard에는 넣지 않는다. UI가 탭 전용·내보내기 제외를 명시한다.
- 실패 격리: 모델 다운로드, WebGPU, WASM, 후보별 디코드·전사 실패는 fast-pass 후보와 기존 시간표 출력을 무효화하지 않는다. 가능한 다음 후보를 계속 처리하고 gap을 쉬운 문장으로 표시한다. 재실행 전 overlay를 지우지 않으며 새 transcript result가 온 후보만 교체한다.
- 배포 확인: Pages에서 lazy Worker와 Transformers.js runtime 자산이 `/rettolight/` 하위 경로로 열리는지, 모델 원본 CORS가 허용되는지, 새 앱 셸이 현재 Worker hash를 가리키는지 확인한다.
- 자원 상한: 모델 다운로드 크기와 실제 캐시 사용량을 구현 검증에서 측정해 UI에 근사 범위로 안내한다. 파일별 다운로드 callback을 합산하고 전체 total을 모르는 동안 작은 파일 하나의 완료율을 전체 완료율로 표시하지 않는다. 전체 후보 분석 중 취소가 가능해야 하며 Worker ACK가 없으면 5초 뒤 강제 종료를 terminal cancellation으로 기록하고 입력·PCM 참조를 남기지 않는다.
- 런타임 자산: ONNX Runtime WASM은 npm 패키지에서 Vite asset으로 방출한 `/rettolight/assets/ort-wasm-*.wasm` URL을 `env.backends.onnx.wasm.wasmPaths`에 명시한다. 런타임 기본 CDN에 우연히 의존하지 않는다.
- 전사 진실성: 현재 Worker가 내보내는 timestamp·text에는 독립 confidence/VAD가 없으므로 `provisional-transcript`로만 표시한다. cue seek는 제공하지만 fast-pass 사건·원인 설명을 바꾸지 않는다. 실제 발화 근거 승격은 confidence와 speech-presence 품질 신호를 함께 연결한 뒤에만 허용한다.
- 출시 증거: 코드·단위 테스트·production bundle·정적 asset smoke와 실제 한국어 영상의 모델 다운로드→전사→cue seek 브라우저 smoke를 구분해 기록한다. 후자가 없으면 “브라우저 실동작 확인 완료”라고 표시하지 않는다.
- `0.3.3` production 관찰값: 후보 대사 Worker 약 1.22MB, lazy ONNX WASM 약 21.6MB, 메인 JavaScript 약 415kB다. 공개 모델·토크나이저까지 포함한 첫 실행 추가 수신량은 환경에 따라 약 45~80MB로 안내한다.

### 2.3 `0.3.4` 후보 전용 오디오 사건 AI 운영 경계

- 처리 범위: fast pass가 만든 최대 12개 후보마다 reaction peak 전·중·후 10초 창을 최대 3개만 읽는다. 최대 분류 PCM은 약 6분이며 한 창씩 처리·폐기한다.
- 런타임: `@huggingface/transformers` `3.8.1`의 `AutoProcessor`·`AutoModelForAudioClassification`과 `Xenova/ast-finetuned-audioset-10-10-0.4593` revision `249a1fbf0286b40e7f1ed687a8ae396997bf7dc6`, q8, 16kHz를 고정한다. AudioSet AST는 다중 라벨 raw logits 모델이므로 softmax 고정인 high-level pipeline을 쓰지 않고 sigmoid를 직접 적용한다. 디지털 무음·단발 click gate를 통과하지 못한 창은 모델 호출 없이 all-zero 부재 벡터로 마스킹하고, 모든 창이 탈락한 후보는 `EMPTY_AUDIO` gap이다. 첫 성공 경로는 GitHub Pages의 COOP/COEP 없이 동작하는 단일 thread WASM이다.
- 모델 크기·출처: q8 `onnx/model_quantized.onnx`는 약 90.8MB다. 변환 저장소는 별도 license tag가 없으므로 BSD-3-Clause인 원 모델 `MIT/ast-finetuned-audioset-10-10-0.4593`의 출처·라이선스를 앱 문서에 함께 고지하고 배포마다 고정 revision 파일 존재를 확인한다.
- 모델 네트워크: 모델·config 다운로드만 Hugging Face로 나간다. File·PCM·채팅·전사·후보 시각을 HTTP body, URL, telemetry에 넣지 않는다.
- 결과 진실성: AudioSet은 source separation이나 스트리머 식별 모델이 아니다. 웃음·외침·비명·박수/환호 allowlist를 `provisional-audio-event`로만 표시하고 sigmoid score를 교정된 정확도·스트리머 확률로 노출하지 않는다.
- 실패 격리: 오디오 사건 run은 전사 run·fast pass와 독립이다. 모델 로드·decode·분류 실패와 취소가 기존 후보·전사 cue·검토·출력을 무효화하지 않는다. 재시도 전에 이전 고품질 overlay를 지우지 않는다.
- 메모리·저장: 한 10초 16kHz mono PCM과 한 후보의 제한된 allowlist 집계만 유지한다. PCM과 전체 label 출력은 즉시 해제하고 overlay는 현재 탭 메모리 전용으로 두며 persistence/export schema를 올리지 않는다.
- 배포 확인: 앱 셸이 참조하는 새 audio-event Worker와 로컬 ORT WASM이 `/rettolight/assets/`에서 200인지 확인하고, 고정 모델 revision의 config·q8 파일 CORS와 Content-Length를 확인한다. 실제 반응 오디오 fixture의 모델 다운로드→창 분류→cue seek는 정적 asset smoke와 별도로 기록한다.

### 2.4 `0.3.5` 후보 검토 우선순위 제안 운영 경계

- 목적: fast pass의 최대 12개 정밀 분석 대상과 AI 문맥 판정 이후의 최종 클립 후보를 구분한다. 정밀 분석 대상 선정은 사람이 먼저 볼 범위를 정하는 단계이고, 전체 방송 문맥 판정은 `select | review | reject`를 반환해 의미 있는 후보가 없으면 0개를 허용한다. AI 판정을 UI에 실제 연결하기 전까지 기존 canonical 후보·승인·제외 상태는 불변이다.
- 중복 가산 금지: fast-pass 점수 위에 이미 반영된 오디오·채팅·화면 수치를 다시 합산하지 않는다. 후보에 보존된 normalized evidence를 정수 basis points `audioFamily 6,000 + chat 3,000 + visual 500 + audio·chat 합의 500`으로 한 번만 조합하고 기존 점수순은 동률 안정화에만 쓴다. 별도 오디오 사건의 `strong | possible`은 가장 강한 하나만 같은 audioFamily 안에서 제한적으로 보강하며 독립 모달리티처럼 더하지 않는다.
- 공정한 coverage: audio-event run이 현재 후보 전체를 gap 없이 `completed`했을 때만 정성 보강을 사용한다. `completedWithGaps`, 진행 중, 취소, 실패에서는 일부 성공 후보만 올라가는 편향을 막기 위해 모든 후보의 AST 보강을 0으로 통일한다. 카드에 이미 있는 재생 단서는 그대로 보존한다.
- 전사 경계: 현재 provisional transcript text를 사건 의미·감정·인과 점수로 사용하지 않는다. 품질 상태와 cue 유무는 제안 설명에만 쓰며 원문 text는 proposal 지문·로그·내보내기에 넣지 않는다.
- 적용 안전: proposal은 후보 ID 전체의 완전한 permutation이어야 하고 session·candidate set·evidence·view revision이 모두 현재 값과 맞아야 한다. 생성은 무변경, 적용과 한 단계 undo는 사용자의 별도 클릭이다. 새 근거가 생긴 stale proposal은 적용하지 않는다.
- 순서 경계: 추천 순서는 카드 검토 순서뿐이다. Pass B/audio-event 대상은 계속 fast-pass 점수순이고 승인 시간표·CSV·Markdown·JSON·clipboard는 effective start time 순이다.
- 개인정보·저장: proposal에는 제한된 이유 코드와 정성 근거, 고정 모델 revision·후보 범위 지문만 포함한다. overlay가 원본 run ID를 갖지 않으므로 현재 run의 근거라고 잘못 귀속하지 않는다. 파일명·채팅 원문·전사 원문·raw PCM·모델 raw score를 포함하지 않으며 현재 탭 메모리 전용이다. 새 분석·복구·새로고침에서 사라지는 작업으로 안내한다.
- 장애 격리: proposal 계산·검증 실패는 후보 카드, 재생, review, boundary, 정밀 AI, export를 막지 않는다. malformed/stale proposal은 적용하지 않고 canonical 또는 마지막으로 사용자가 적용한 유효 순서를 유지한다.
- 검증: 같은 입력의 결정성, 중복 가산 방지, transcript 무가점, 완전 permutation, stale 거부, 명시 적용·undo, candidate ID별 review/boundary/preview 보존, export 시간순 불변을 단위·통합 테스트한다.

### 2.5 `0.3.6` 근거 기반 사건·반응 단서 운영 경계

- 근거 설명 projection 자체는 새 모델·Worker·네트워크 요청을 만들지 않는다. 기존 fast candidate, 세션 전용 Gemini Pass B cue·해석, audio-event allowlist cue를 순수 projection으로 합치므로 설명 생성 자체는 즉시 끝나야 한다. Gemini 후보 요청은 아래 2.6절의 사용자 시작형 예외이며 projection이 몰래 재호출하지 않는다.
- 진실성: production transcript는 provisional replay cue이며 사건 사실이 아니다. audio-event도 혼합 방송 오디오 분류라서 스트리머 주체·감정·원인을 확정하지 않는다. 화면 변화와 채팅 증가는 시간·집계 근거일 뿐 인과가 아니다.
- 개인정보: 설명에는 후보 ID, 시간, 허용된 집계 숫자, 닫힌 반응 종류, 현재 탭의 제한된 전사 인용만 사용한다. 파일명·원시 채팅·author key·PCM·logit·전체 transcript는 로그·지문·저장·export에 추가하지 않는다.
- 경계 수정: explanation은 AI 최초 proposal 근거로 계산된다. effective range 밖 cue는 disabled/outside로 표시하고 현재 구간 안인 척 이동하지 않는다. 카드에는 구간을 다듬은 뒤 원래 근거가 일부 밖일 수 있음을 알린다.
- stale ranking: 최신 refinement가 생긴 오래된 proposal에서는 후보별 reason 상세를 표시하지 않는다. 과거 reason code와 최신 audio-event evidence를 섞는 잘못된 provenance를 막고, 카드 순서는 사용자가 undo하기 전까지 유지한다.
- 기능 노출: 후보 1개부터 전사·반응 종류·재생 검토를 제공하고 후보 2개 이상에서만 ranking comparison을 제공한다. 0·1·2·12개 fixture로 조건을 회귀 검사한다.
- 배포 확인: `/rettolight/`의 main JS·CSS·Worker·WASM이 200이고 정적 번들에 비밀키가 없는지 확인한다. Gemini 요청은 고정 후보 오디오 계약으로만 구성되는지 mock으로 검사한다. 키보드 summary/cue focus, 320~390px 폭, 밝은 테마의 chat/visual badge 대비와 console warning/error도 확인한다.

### 2.6 `0.3.9` Gemini 후보 정밀 분석 운영 경계

- 핵심 폴백: Gemini가 실패해도 GitHub Pages의 fast pass, 선택형 채팅 결합, 후보 재생·검토, 반응 종류 AI, 내보내기는 완주한다.
- 처리 범위: fast pass가 고른 최대 12개의 30~60초 후보를 한 후보씩 16kHz mono PCM16 WAV로 만들며 실행 전에 후보 수와 합계 시간을 표시한다.
- 요청 경계: Pages Worker는 `{ audioBase64, candidateDurationMs, videoFrames? }`를 정밀 분석 중계에 넘긴다. `videoFrames`는 후보당 최대 4장의 작은 JPEG 대표 화면이며 각 화면의 후보 상대 시각을 함께 보낸다. 운영 중계는 고정 prompt/schema를 조립해 `qwen3.5-omni-flash`를 호출한다. 원본 파일명·전체 영상·채팅·후보 점수·사람 검토 상태는 body, URL, header, 로그에 넣지 않는다.
- 키 경계: `GEMINI_API_KEY`는 Cloudflare Worker Secret으로 한 번 설정한다. repository, GitHub Actions 정적 bundle, URL, 브라우저 저장소, 프로젝트 backup, export, fixture, 로그에 넣지 않으며 Pages 앱에는 키 입력 UI나 키 필드가 없다.
- 중계 방어: production Origin을 `https://11qaws.github.io`로 고정하고 CORS preflight, POST/content-type, exact-key body, Base64와 WAV 길이, 요청·응답 크기, upstream timeout을 검사한다. 유효한 후보 요청에 IP별 12회/분을 먼저 적용하고 통과한 요청만 전체 30회/분 예산을 사용한다. provider 오류 원문과 키는 응답·로그에 넣지 않는다.
- 요청 크기: 60초 16kHz mono PCM16 WAV는 Base64 포함 약 2.6MB다. 대표 화면은 최대 4장·장당 약 360KB Base64로 제한한다. 앱과 중계 모두 후보당 60초의 자체 경계를 두고 한 건씩만 처리하며 Files API를 사용하지 않는다. 화면 샘플링에 실패하면 오디오만으로 계속한다.
- 결과 검증: model JSON은 후보 상대 시간과 닫힌 문자열 필드만 허용한다. App으로 넘기기 전에 exact keys, 타입, 배열 수, 시간 정방향·후보 범위, NFKC·제어문자·길이 제한을 검증한다. candidate ID·절대 원본 범위는 실행 snapshot에서 주입한다.
- 진실성: Gemini는 전용 STT confidence를 반환하지 않는다. 대사는 `provisional-transcript`, 사건·반응·좋은 클립 이유는 오디오와 대표 화면에 근거한 `Gemini 해석 · 직접 확인 필요`다. 화면 사건·스트리머 주체·승패·인과를 확정하지 않고 점수·ranking·경계·승인에 반영하지 않는다.
- 비용·오류: 중계의 `5xx/408`만 1초·2초 backoff로 최대 두 번 재시도한다. 400·401·403·429와 앱 run은 자동 반복하지 않는다. 중계 설정, 할당량 429, 네트워크·5xx, 구조 오류를 서로 다른 redacted code로 안내하고 provider 원문 오류·키를 UI나 진단에 복사하지 않는다. 실패한 후보나 run은 기존 후보와 이전의 더 좋은 세션 단서를 지우지 않는다.
- 취소·수명: 기존 session/run/worker/task/event fence와 proposal revision을 유지한다. 취소는 in-flight fetch를 abort하고 Worker ACK 뒤 정리하며, 늦은 응답은 reducer 수용 전에 차단한다. 한 후보 PCM은 요청 뒤 0으로 덮고 Base64/body 참조를 해제한다.
- 배포 확인: Worker `/healthz`, Pages origin CORS preflight, 잘못된 Origin·method·content-type·과대 body 거부를 확인한다. mock fetch로 요청·응답·오류·취소를 검사하고, 배포 Secret 설정 뒤 짧은 후보 한 건의 실제 smoke를 기록한다.

## 3. 진실 공급원과 백업 계층

### 3.1 무엇이 원본인가

| 데이터 | 진실 공급원 | 복구 수단 |
|---|---|---|
| 앱 코드·스키마·모델 manifest | 버전이 고정된 Git 저장소와 배포 artifact | 이전 release artifact로 롤백 |
| 영상 원본 | 사용자가 보관한 로컬 파일 | fingerprint 확인 뒤 다시 연결 |
| 가져온 채팅 원본 | 사용자가 가진 파일, 또는 명시적으로 보존한 로컬 사본 | 같은 파일 다시 가져오기 |
| 프로젝트·후보·사람 판단 | IndexedDB의 확정 revision | `.retto-highlight.json` 백업 가져오기 |
| 분석 중간 결과 | run별 committed checkpoint | 호환성 검사 뒤 새 run이 참조 |
| 렌더 결과 | 사용자가 고른 로컬 파일 | 다시 렌더하거나 결과 manifest 확인 |

IndexedDB는 활성 작업의 진실 공급원이지만 영구 보존을 보장하는 서버가 아니다. 그래서 앱은 “브라우저에 저장됨”과 “백업 파일도 있음”을 다른 상태로 표시한다.

### 3.2 백업 방식

기본 폴백은 사용자가 누르는 `프로젝트 백업 받기`다. File System Access API를 지원하고 사용자가 폴더를 고르면 다음 선택형 자동 백업을 제공한다.

1. 첫 분석 checkpoint 또는 첫 사람 판단이 확정된 뒤 백업을 한 번 권한다.
2. 사용자가 폴더 권한을 주면 프로젝트의 확정 revision만 JSON으로 쓴다.
3. 쓰기 도중에는 `.<name>.tmp` 또는 새 revision 파일을 만들고, 쓰기와 검증이 끝난 뒤 최신 포인터를 갱신한다.
4. 권한이 사라지면 조용히 실패하지 않고 `백업 폴더를 다시 골라 주세요`라고 표시한다.
5. 영상 원본·AI 모델·완성 클립은 프로젝트 JSON 안에 넣지 않는다.

백업 파일에는 최소 다음을 포함한다.

- `schemaVersion`, `appVersion`, `exportedAt`
- 프로젝트와 source fingerprint
- 분석 input/config/model snapshot 식별자
- 후보, AI 제안 revision, 사람 판단 revision
- coverage·gap·중단 이유
- 파일별 checksum 또는 canonical payload hash
- 원본 파일 미포함 경고

### 3.3 백업 권유 시점

- 승인·제외·경계 수정 등 사람 판단이 처음 생긴 때
- 후보가 20개 이상이 된 때
- 30분 이상 작업한 때
- 앱 업데이트 또는 DB migration 직전
- 저장 공간이 낮아진 때
- 브라우저 영구 저장 요청이 거절된 때

같은 세션에서 반복 경고하지 않는다. `나중에`를 선택하면 다음 안전 경계까지 숨기되, 저장 실패 중에는 경고를 숨길 수 없다.

## 4. 단일 사용자 안의 동시성: 여러 탭

개인용 앱도 같은 브라우저에서 두 탭이 열릴 수 있다. 프로젝트당 한 탭만 쓰기 권한을 가진다.

### 4.1 기본 정책

- `Web Locks API`로 `project:<projectId>:writer` lease를 얻은 탭만 분석·수정·렌더를 시작한다.
- 다른 탭은 `BroadcastChannel`로 확정 revision을 받아 읽기 전용 미러로 표시한다.
- 읽기 전용 탭에는 상단에 `다른 탭에서 이 프로젝트를 편집 중이에요`와 `[그 탭으로 돌아가기]`·`[편집 권한 가져오기]`를 보여 준다.
- 권한 가져오기는 기존 탭 heartbeat가 끊겼거나 사용자가 명시적으로 확인한 때만 수행한다.
- lease를 잃은 탭은 즉시 새 mutation을 막고 진행 중 Worker에 pause/cancel 요청을 보낸다. 확정되지 않은 결과를 저장하지 않는다.
- Web Locks를 지원하지 않는 환경은 IndexedDB lease record의 `sessionId`, `epoch`, `expiresAt`을 compare-and-swap으로 갱신한다.

### 4.2 충돌 방어

- 모든 저장은 `expectedProjectRevision`을 확인한다.
- 오래된 탭의 저장 성공 callback은 현재 `saveAttemptId`와 target revision이 다르면 성공 UI를 바꾸지 않는다.
- source A를 검사하는 동안 source B를 고르면 A의 늦은 결과는 폐기한다.
- 이전 analysis run·render batch·model download의 이벤트도 각각의 operation ID가 다르면 진단 카운터만 올리고 상태에 반영하지 않는다.

상세 전이는 `STATE_LIFECYCLE.md`를 단일 기준으로 삼는다.

## 5. 환경 설정과 비밀정보

### 5.1 환경

| 환경 | 목적 | 데이터 |
|---|---|---|
| local | 개발과 빠른 수동 확인 | 합성 fixture와 권리 확보 샘플 |
| test | 자동 테스트 | 결정론적 작은 샘플, 가짜 Worker·IndexedDB |
| preview | 실제 Pages 하위 경로와 artifact 검사 | 비식별·권리 확보 샘플만 |
| production | 사용자용 정적 앱 | 사용자 브라우저에서만 생성 |

환경 설정은 TypeScript 스키마로 검증한다. 필요한 공개 값은 Pages base path, app version, build ID, 허용된 model origin, model manifest URL뿐이다. 누락되거나 예상하지 않은 origin이면 모델 다운로드를 막고 signals-only 폴백을 안내한다.

### 5.2 비밀정보 금지

- `VITE_*`는 비밀 저장소가 아니므로 token·Client Secret·개인 API key를 넣지 않는다.
- GitHub Actions secret을 프런트엔드 번들·source map·artifact에 주입하지 않는다.
- CHZZK OAuth가 필요한 선택형 로컬 수집기의 secret·token은 로컬 OS 자격 증명 저장소 또는 접근 제한 설정에만 둔다.
- 로컬 수집기 log·JSONL META·진단 export에는 token·authorization code·cookie를 넣지 않는다.
- 저장소, 계획서, 개발 로그, 테스트 fixture에 실사용 자격 증명을 복사하지 않는다.

## 6. CI 품질 게이트

release 후보는 다음 순서를 전부 통과해야 한다.

1. lockfile 고정 설치와 의존성 무결성 확인
2. 라이선스 고지·SBOM 생성과 금지 라이선스 검사
3. TypeScript strict typecheck
4. lint와 formatting check
5. 순수 도메인 unit test
6. 상태 전이표·불변식·property test
7. IndexedDB schema·migration·실패 주입·백업 왕복 test
8. Worker protocol, stale event, 중복·역순 event test
9. AI golden vector와 작은 품질 회귀 fixture
10. production build와 artifact hash 생성
11. GitHub Pages 저장소 하위 경로에서 Playwright E2E
12. 키보드·스크린리더·axe·forced colors·확대 접근성 검사
13. service worker 구버전에서 새 버전으로 안전 업데이트 검사
14. 민감 문자열·source map·절대 로컬 경로·개발 endpoint 누출 검사

CI는 정상 경로만 확인하지 않는다. 다음 failure injection이 release gate다.

- IndexedDB transaction 중간 실패
- quota 초과
- Worker crash와 WebGPU device lost
- 모델 다운로드 중단·hash 불일치
- pause/cancel 도중 새로고침
- 두 탭에서 동시에 분석 시작
- 사용자가 후보를 수정한 뒤 늦은 AI revision 도착
- 렌더 cancel 뒤 이전 Worker의 완료 callback 도착

## 7. 배포 절차

### 7.1 배포 전

1. SemVer, `schemaVersion`, model manifest version을 결정한다.
2. 변경으로 영향을 받는 저장 형식·Worker protocol·service worker cache를 확인한다.
3. migration이 있으면 이전 production 백업 fixture로 왕복 테스트한다.
4. Pages의 실제 `/<repo>/` base에서 preview artifact를 검사한다.
5. Worker dry-run, unit test, Origin·schema·size·timeout·rate-limit 계약을 검사한다.
6. `buildId`, commit SHA, artifact SHA-256, model manifest hash, Worker deployment ID, migration 범위를 release record에 남긴다.

### 7.2 배포

- `wrangler deploy --config wrangler.jsonc`로 검증된 정밀 분석 Worker를 먼저 배포한다.
- `GEMINI_API_KEY`는 `wrangler secret put GEMINI_API_KEY --config wrangler.jsonc`로 설정하고 명령 출력·로그·파일에 값을 남기지 않는다.
- Worker `/healthz`와 production Origin preflight가 통과한 뒤 GitHub Actions가 검증된 Pages artifact를 배포한다.
- 배포 중 DB migration은 없다. 브라우저별 migration은 사용자가 안전한 업데이트를 승인한 뒤 실행된다.
- 앱은 작업 중인 탭을 자동 새로고침하지 않는다.
- service worker는 새 버전을 `waiting`에 두고 `작업 저장 후 업데이트`를 제안한다.
- model manifest는 immutable version URL과 hash를 사용한다. 이미 시작한 run의 모델을 중간에 바꾸지 않는다.

### 7.3 배포 후 smoke test

- Pages 루트와 직접 진입 URL이 404 없이 열린다.
- CSS·font·Worker·WASM 경로가 저장소 하위 base에서 정상이다.
- source 선택과 짧은 파일 preflight가 된다.
- Worker가 시작되고 작은 signals-only 분석 fixture가 완료된다.
- 정밀 분석 Worker `/healthz`가 200이고 production Origin의 OPTIONS가 204다.
- 1초 canonical WAV smoke가 provider raw 오류 없이 구조화 응답 또는 안전한 예상 오류로 끝난다.
- IndexedDB 새 프로젝트 저장과 새로고침 복원이 된다.
- 모델 manifest 실패 시 앱 전체가 멈추지 않고 명시적 폴백이 나온다.
- 기본 export JSON을 생성하고 다시 가져올 수 있다.
- 브라우저 개발자 도구에서 정밀 분석 요청이 고정 `{ audioBase64, candidateDurationMs, videoFrames?, castRosterId? }` 계약만 사용하고, roster 값이 닫힌 ID인지 확인한다.

## 8. 롤백과 호환성

### 8.1 코드 롤백

- 직전 정상 release의 검증된 artifact 또는 commit을 다시 배포한다.
- release record에 롤백 사유·영향 버전·복구 확인을 남긴다.
- service worker cache 이름은 app version이 아니라 build ID로 분리하고, active 작업 중 강제 cache 삭제를 하지 않는다.

### 8.2 데이터 롤백

코드 롤백이 DB downgrade를 의미하지는 않는다. 새 schema를 구버전 코드가 읽지 못하면 다음처럼 안전 실패한다.

- 구버전 앱이 더 높은 schema를 발견하면 쓰기를 금지하고 `이 프로젝트는 더 새 버전에서 만들어졌어요`라고 안내한다.
- import 가능한 과거 schema 범위와 읽기 전용 범위를 release note에 명시한다.
- migration은 먼저 백업을 만든 뒤 새 object store 또는 새 revision에 쓴다.
- 검증이 끝난 뒤에만 active schema pointer를 원자적으로 바꾼다.
- 실패하면 기존 pointer를 유지하고 새 store를 폐기 가능한 상태로 표시한다.
- destructive migration은 별도 사용자 확인과 복구 파일 없이는 실행하지 않는다.

초기 정책은 최근 두 minor schema의 가져오기와 migration을 지원하고, 그보다 오래된 형식은 읽기 전용 변환 도구 또는 중간 버전을 안내하는 것이다. 실제 지원 범위는 release마다 fixture로 입증한 값만 적는다.

## 9. 저장 공간·대역폭·보존 상한

정확한 브라우저 quota는 기기·브라우저 정책에 따라 달라지므로 고정 용량을 보장하지 않는다. `navigator.storage.estimate()`의 실측값과 각 저장소의 앱 내부 집계를 함께 사용한다.

### 9.1 경고 단계

| 단계 | 조건 예시 | 동작 |
|---|---|---|
| 정상 | 여유 공간 충분 | 조용히 진행 |
| 주의 | 앱 사용량 또는 전체 quota가 정책상 주의 비율 도달 | 예상 증가량, 백업·정리 제안 |
| 차단 임박 | 다음 stage/checkpoint를 안전하게 확정할 여유 부족 | 새 고용량 작업 시작 금지, 기존 결과 export 허용 |
| 차단 | transaction 또는 파일 쓰기 quota 오류 | 분석 pause, 확정 데이터 보존, 정리·폴더 저장 안내 |

비율은 기기별 오차를 고려해 구현 실험으로 정하되, 기본 후보는 70% 주의·85% 새 고용량 작업 차단이다. 고정 숫자만 믿지 않고 다음 checkpoint·모델·렌더의 예상 추가량을 함께 본다.

### 9.2 기본 보존 정책

- 원본 media: 앱 저장소에 복사하지 않는다.
- 분석 feature: active/latest run과 사람이 승인한 후보의 근거를 우선 보존한다. 오래된 실패 run은 백업 뒤 정리 제안한다.
- thumbnail: 후보당 대표 이미지 기본 1장, 프로젝트당 상한을 두고 LRU 정리한다.
- 모델: 사용 중 lease가 없는 모델만 LRU 삭제한다. 다시 받을 크기와 선택 이유를 먼저 보여 준다.
- OPFS temp: 시작 시 고아 파일 sweep, 각 terminal 확정 후 즉시 정리한다.
- 진단 ring buffer: 기본 최대 5MB 또는 7일 중 먼저 도달한 쪽에서 오래된 항목부터 삭제한다.
- 원문 채팅: 기본 미보존. opt-in 시 보존 범위와 예상 크기를 보여 주며, 집계가 끝나면 `원문 지우기`를 제공한다.
- 집계 채팅: 후보 근거와 coverage 복구에 필요한 bucket만 프로젝트와 함께 보존한다.

모델은 큰 공개 다운로드이므로 같은 hash를 중복 받지 않고, 다운로드 전에 크기·남은 공간·취소 가능 여부를 보여 준다. 앱 update가 모델 전체 재다운로드를 유발하지 않게 cache key를 manifest hash로 분리한다.

## 10. 로컬 관측과 진단

공용 모니터링 서버는 두지 않는다. 사용자가 스스로 상태를 이해하고 필요할 때만 진단 파일을 내보낼 수 있게 한다.

### 10.1 앱 안 상태 카드

- 앱 버전·build ID·schema version
- 현재 source capability와 권한 상태
- 분석 lifecycle·stage·coverage·마지막 확정 checkpoint
- runtime tier와 모델 manifest hash 앞부분
- 저장 사용량·quota 추정·영구 저장 허용 여부
- service worker/app shell version 일치 여부
- stale event·Worker restart·DB retry 수
- 최근 실패 reason code와 복구 가능한 다음 행동

### 10.2 구조화 진단 이벤트

각 이벤트는 다음 공통 필드를 가진다.

```ts
type DiagnosticEvent = {
  schemaVersion: string;
  occurredAt: string;
  severity: "info" | "warning" | "error";
  component: "source" | "chat" | "analysis" | "storage" | "model" | "render" | "pwa";
  reasonCode: string;
  operationType?: string;
  operationIdHash?: string;
  lifecycle?: string;
  stage?: string;
  recoverability: "automatic" | "userAction" | "notRecoverable";
  appVersion: string;
  buildId: string;
};
```

진단에는 다음을 넣지 않는다.

- 원본 파일명·전체 경로·Object URL
- 영상·음성 샘플·프레임·자막 원문
- 채팅 원문·닉네임·channelId
- 프로젝트 제목·후보 제목·메모·태그
- 플랫폼 URL query·token·cookie·authorization header
- OAuth secret·access token·refresh token

내보내기 전 redaction을 한 번 더 실행하고 포함 항목 미리보기를 보여 준다. 사용자가 확인한 뒤에만 진단 파일을 만든다.

## 11. 장애 대응 runbook

### 11.1 저장 공간 부족

1. 새 고용량 stage를 시작하지 않고 active run을 `pausing`으로 보낸다.
2. 현재 checkpoint와 이미 확정된 후보를 가능한 마지막 작은 transaction으로 저장한다.
3. `프로젝트 백업`, `오래된 모델 정리`, `임시 파일 정리`, `원문 채팅 삭제`를 영향 크기와 함께 제시한다.
4. 사용자가 정리한 뒤 quota를 다시 측정한다.
5. input/config/model snapshot이 같을 때만 같은 run을 재개한다. 아니면 새 run을 만든다.

### 11.2 모델 다운로드 실패 또는 hash 불일치

1. 불완전 cache entry를 active로 승격하지 않는다.
2. hash 불일치는 보안 오류로 기록하고 같은 응답을 자동 무한 재시도하지 않는다.
3. `다시 받기`, `작은 모델`, `기본 신호만 분석`을 제공한다.
4. 이미 완료한 DSP·채팅 feature와 후보를 유지한다.

### 11.3 WebGPU device lost·Worker crash

1. 해당 task/run ID의 미확정 메모리 결과를 버린다.
2. 마지막 committed checkpoint와 coverage를 읽는다.
3. 자동 재시도는 제한 횟수와 backoff를 둔다.
4. 반복되면 WASM SIMD 또는 signals-only 새 run을 제안한다.
5. 사용자 경계·승인·제외 판단은 절대 되돌리지 않는다.

### 11.4 IndexedDB 손상·migration 실패

1. 더 이상의 쓰기를 막고 읽을 수 있는 확정 revision을 export한다.
2. migration 전 백업과 기존 active pointer를 유지한다.
3. 새 schema store를 활성화하지 않는다.
4. `백업 파일로 새 프로젝트 만들기`를 제공하고 원본 DB를 자동 삭제하지 않는다.

### 11.5 앱 셸·service worker 버전 불일치

1. 작업 중인 mutation을 멈추고 확정 저장 여부를 확인한다.
2. 프로젝트 백업을 권한다.
3. 모든 Worker를 종료한 뒤 사용자가 승인할 때만 새 앱을 활성화한다.
4. 반복 오류 시 service worker 등록 해제·새로고침 절차를 초심자 문장으로 안내한다.

### 11.6 source 권한 상실·파일 이동

1. 후보·분석 기록·결과표는 그대로 유지한다.
2. 파일 접근이 필요한 분석·미리보기·렌더만 중단한다.
3. fingerprint가 같은 파일을 다시 고르면 재연결한다.
4. 다르면 기존 프로젝트를 바꾸지 않고 `이 파일로 새 복사본 만들기`를 제안한다.

### 11.7 분석 중 브라우저 종료

1. 다음 앱 시작에서 이전 session heartbeat와 active run을 검사한다.
2. 이전 run을 사용자 취소나 실패가 아닌 `interrupted`로 확정한다.
3. snapshot 호환성을 확인하고 checkpoint를 참조하는 새 run을 만든다.
4. 이미 검토한 후보와 사람 revision을 먼저 복원한다.

### 11.8 렌더 실패·취소

1. mux close, writable close, 최소 재검증 전에는 파일을 `저장 완료`로 표시하지 않는다.
2. cancel 요청 뒤 Worker 정지와 임시 파일 정리가 확정되어야 `cancelled`가 된다.
3. 성공한 항목은 유지하고 실패한 항목만 다시 시도할 수 있게 manifest에 분리한다.
4. anchor download 폴백은 브라우저가 실제 디스크 저장을 확인할 수 없으므로 `다운로드 시작됨`까지만 표시한다.

### 11.9 CHZZK 로컬 수집기 중단

1. 마지막 flush까지의 JSONL을 유지한다.
2. 재연결 전후를 `GAP`으로 기록하고 0건 채팅으로 가장하지 않는다.
3. token 폐기·권한 회수 시 즉시 연결을 닫는다.
4. Pages 앱은 완전한 기록이라고 가정하지 않고 coverage를 신뢰도에 반영한다.

## 12. 개인용 출시 승인 기준

다음이 모두 확인되어야 production release로 본다.

- GitHub Pages에서 source 선택 → AI 분석 → 후보 검토 → JSON/CSV/Markdown 출력 완주
- 정밀 분석 요청이 최대 12개 후보·후보당 60초·고정 스키마 경계를 지킴
- 2시간·8시간, 4GB·10GB 권리 확보 파일에서 전체 RAM 복사 없음
- 첫 유용 후보가 부분 결과로 나오고 전체 분석 완료를 기다리지 않아도 검토 가능
- pause·cancel·새로고침·브라우저 강제 종료 뒤 확정 checkpoint와 사람 판단 복원
- 두 탭 동시 열기에서 단일 writer와 읽기 전용 안내 동작
- 늦은 AI 결과가 사용자 경계·제목·승인 상태를 덮어쓰지 않음
- quota 부족·모델 실패·GPU 손실·source 권한 상실에 막다른 화면이 없음
- migration 전 백업, 실패 rollback, 구버전 import fixture 통과
- 직전 release artifact 롤백과 service worker 안전 갱신 실연
- 키보드만으로 핵심 흐름 완주, WCAG 2.2 AA 주요 검사 통과
- 진단 export에 원본 경로·원문·닉네임·token이 없음
- CHZZK 채팅 파일이 없어도 영상·음성 분석은 정상 완주
- 선택형 동반 수집기가 없어도 가져온 채팅 로그 분석이라는 핵심 기능 완주

## 13. 구현 전 추가 검토 체크리스트

- 실제 GitHub Pages 하위 경로에서 model origin CORS·Range·cache 동작 재확인
- 브라우저별 IndexedDB·Cache API·OPFS quota와 eviction 실측
- Web Locks가 없는 환경의 lease fallback과 background tab throttling 검증
- 8시간 영상의 checkpoint 크기·쓰기 빈도가 SSD와 배터리에 주는 영향 측정
- File System Access API가 없는 Firefox·Safari 계열의 백업·출력 폴백 확인
- model license·재배포 조건·고정 revision 공급망 검토
- StreamSaver CSS 스냅샷의 재사용 권리 확인 후 출처·고지 확정
- CHZZK Session API·OAuth·quota·이용약관은 로컬 수집기 착수 직전에 공식 문서로 재검증
- 오류 문구를 실제 컴퓨터 초심자에게 보여 주고 다음 행동 이해 여부 검증
- 브라우저 기록 삭제·시크릿 모드·프로필 전환 때 로컬 데이터가 공유되지 않는다는 안내 검증

이 문서의 운영 목표는 서버 운영을 흉내 내는 것이 아니다. 한 사람의 몇 시간짜리 편집 작업을 브라우저가 잃거나 덮어쓰거나 거짓으로 완료 표시하지 않도록 만드는 것이다.

## 14. `0.3.28` provider 설정 운영 경계

- 배포 기본값은 후보 오디오·화면과 한국어 전사 `qwen / qwen3.5-omni-flash`, 압축 방송 문맥 `qwen / qwen3.7-plus`다. `qwen3.6-flash`는 저비용 보수 심사 경로로 준비되어 있고, `gemini-3.6-flash`·`deepseek-v4-pro`는 유효 credential과 별도 회귀 검증 전에는 자동 호출하지 않는다.
- production 필수 Secret은 현재 `QWEN_API_KEY`다. Google 키가 유효하지 않아도 운영 기본 경로에는 영향이 없다. 키 원문은 readiness, 오류, 브라우저 bundle, IndexedDB, export에 기록하지 않는다.

## 15. `0.3.29` 계층형 문맥·자막·네거티브 게이트

- 1차 전체 맥락 lead가 넓으면 예산 안에서 1분 전사 칸으로 다시 나누고, parent lead당 최대 3개의 서로 다른 사건을 병렬 Qwen 문맥 호출로 분리한다. 최종 60초는 생성된 근거 대사와 가장 잘 맞는 칸을 선택한다.
- 전체 방송이 게임이고 근거가 흔한 추락·사망·길 찾기·자원·제작·건축 진행뿐이면 모델의 극적인 점수와 무관하게 카드 승격을 막는다. 정확한 사과, 희귀 성취, 치명적 버그, 사회적 충돌, 장기 설정 회수는 예외다.
- YouTube Android 플레이어와 timedtext는 고정 host, ID allowlist, 응답 크기 제한, 한국어 트랙 검증을 통과해야 사용한다. 403/429/형식 오류는 한 번의 best-effort 실패로 끝내고 Qwen 전사로 이어간다.
- `/v1/broadcast-transcript`는 실운영 성공을 확인한 한 요청 90초 이하 WAV와 전체 실행 최대 240개 chunk를 제한한다. 계획기는 12시간 방송을 모든 10분 셀에서 고르게 표본화하고 사건 주변을 보강하되 ASR 예상비를 최대 `$0.42`로 제한한다. 60초·90초는 성공했고 120초·180초는 edge에서 구조화 응답 전 실패했으므로 다시 상향하려면 production probe와 회귀 근거가 필요하다.
- `/v1/broadcast-context`는 원본 영상 대신 시간순 챕터와 최대 12개 후보의 제한된 근거만 받는다. Qwen 호출에는 `enable_thinking=true`, `thinking_budget=4096`, JSON 응답 형식을 고정하고 최대 90초 upstream 제한과 strict schema 검증을 적용한다.
- 유료 transcript, context, 의미 후보 재확인 결과는 각각 입력 서명과 model revision으로 저장하고 write/readback 뒤에만 재사용한다. 새로고침 때 같은 서명의 성공 결과가 있으면 호출하지 않으며, 실패·취소 결과는 성공 캐시로 승격하지 않는다.
- 12시간·후보 12개·어려운 후보 3개 기준 정책 상한은 약 `$0.997`다. 공급자 가격이 바뀌면 `analysisBudgetPolicy` 테스트와 화면 예상비를 함께 갱신하기 전에는 배포하지 않는다.
- rollback은 provider selector와 Pages/Worker model manifest를 함께 되돌린다. 과거 결과의 provider·model identity를 다른 모델로 다시 쓰거나 공급자 사이 캐시를 공유하지 않는다.

## 16. `0.3.30` 출연자 근거와 문맥 응답 복구

- 후보 지각 모델은 기존 오디오·대표 화면 요청 안에서만 출연자 이름을 추출한다. 화면 이름, 실제 호명, 또는 서버가 확장한 닫힌 출연진 기준 중 하나가 없으면 빈 목록이다. 일반적인 아바타·얼굴·목소리 유사성은 금지하며, 등록 기준도 같은 화면의 서로 다른 특징 두 가지 이상과 0.88 이상 확신이 없으면 버린다.
- 출연자 이름은 근거 종류·한국어 근거·확신도·후보 상대 시각과 함께 Candidate Pass B schema `1.2.0`에 저장한다. 이 정보는 카드 표시 전용이며 점수·선택·승인·클립 경계를 변경하지 않는다.
- 1.0/1.1 저장 결과와 구형 공급자 응답은 빈 출연자 목록으로 읽는다. 새 모델 revision 결과를 과거 결과로 가장하지 않고, 입력 서명과 revision이 달라지면 별도 실행으로 저장한다.
- 전체 문맥 응답의 의미 챕터가 잘못된 필드, 존재하지 않는 chapter ID, 겹치는 범위, coverage gap 횡단을 포함하면 엄격 호출은 실패한다. 이미 비용을 낸 복구 경로에서는 각 항목을 독립 검증해 정상이고 시간순인 항목만 남긴다.
