# ExClipper 최대 5인 AI 처리 설계 — 2026-07-27

상태: **v0.8.3 통합·배포 검증 중**

## 1. 결론

ExClipper는 다섯 사람이 서로 다른 방송을 분석하는 개인 편집 어시스턴트로 유지한다.
영상, 대사, 대표 화면, AI 결과와 편집 판단은 각 브라우저의 독립 세션에 남는다.
서버가 공유하는 것은 배포 Secret에 연결된 AI 공급자 용량뿐이다.

다섯 명 기준의 최적 정책은 기능 이름이 아니라 **현재 운영 primary route가 공유하는
공급자 예산 단위**로 제어하는 것이다. 아래 gate는 ExClipper의 보수적인 앱 예산이다.
대체 공급자별 독립 quota 계측은 아직 없으므로 Gemini fallback도 원래
`qwen-omni` gate, DeepSeek 경로도 `context` gate 안에서 계산한다.

| 공급자 gate | 포함 작업 | 시작 간격 | 준비 pipeline | 실제 in-flight | rolling token budget |
|---|---|---:|---:|---:|---:|
| `qwen-omni` | 방송 전사 + 후보 화면·오디오 해석 | 1,000ms | 6 | 6 | 100,000 / 60초 |
| `context` | 방송 요약·탐색·최종 심사·정련 | 250ms | 6 | 6 | 5,000,000 / 60초 |

역할별 상한은 추가로 적용한다.

| 역할 pool | 준비 pipeline | 실제 in-flight | 비고 |
|---|---:|---:|---|
| `transcript` | 6 | 6 | 현재 실제 모델은 `qwen3.5-omni-flash` |
| `candidate` | 6 | 4 | 화면 4장·오디오·전체 맥락을 함께 검토 |
| `context` | 6 | 6 | `qwen3.7-plus` / `qwen3.6-flash` |

후보 실행은 네 개만 허용하지만 준비 pipeline은 여섯 개다. 따라서 다섯 명이 동시에
후보를 올려도 각자 적어도 한 요청을 준비 상태로 만들 수 있다. 큰 본문을 받는 단계와
실제 유료 호출 단계를 분리해 속도와 메모리 상한을 동시에 지킨다.

## 2. 확인된 외부 한도

2026-07-27 기준 공식 문서:

- Alibaba Singapore `qwen3.5-omni-flash`: 60 RPM, 100,000 TPM.
- Alibaba Singapore stable `qwen3.7-plus`, `qwen3.6-flash`: 각각
  15,000 RPM, 5,000,000 TPM.
- Alibaba 한도는 같은 계정·모델·리전의 API key와 workspace를 합산한다. 따라서
  ExClipper 밖의 호출이 같은 계정을 쓰면 이 coordinator가 보지 못한 429가 날 수 있다.
- Alibaba는 분 단위 한도 외에도 RPM/60, TPM/60에 해당하는 순간 RPS/TPS와 급격한
  burst 보호를 적용할 수 있다.
- Qwen Omni 오디오는 초당 7 input token이다. 후보 화면은 가장 긴 변을 640px로
  제한해 한 화면의 상한을 400 image token으로 고정한다.
- Cloudflare Worker Free: 요청당 CPU 10ms, 하루 100,000 요청.
- Cloudflare Worker Paid: 기본 CPU 30초, 설정 시 최대 5분, 월 최소 $5.
- Worker 메모리: isolate당 128MB.
- Cloudflare 요청 header: 128KB, Free/Pro request body: 100MB.
- Durable Object SQLite 단일 key+value: 2MB.

공식 자료:

- <https://www.alibabacloud.com/help/en/model-studio/rate-limit>
- <https://www.alibabacloud.com/help/en/model-studio/qwen-omni>
- <https://developers.cloudflare.com/workers/platform/limits/>
- <https://developers.cloudflare.com/workers/platform/pricing/>
- <https://developers.cloudflare.com/durable-objects/platform/limits/>

## 3. 왜 transcript와 candidate를 합쳤는가

두 경로는 이름이 다르지만 현재 같은 계정, 같은 Singapore endpoint, 같은
`qwen3.5-omni-flash`를 사용한다. 이전처럼 전사와 후보를 독립 제한하면 각 gate가
각자 60 RPM을 사용한다고 착각해 합산 60 RPM과 100,000 TPM을 넘는다.

현재는 다음이 하나의 gate를 공유한다.

```text
qwen3.5-omni-flash@Singapore
  ├─ transcript
  └─ candidate
```

- 마지막 실제 시작 뒤 최소 1,000ms가 지나야 다음 요청을 시작한다.
- 어느 역할에서 429를 받아도 두 역할을 함께 `Retry-After`만큼 멈춘다.
- 60초 token 예약 합계가 100,000을 넘으면 가장 오래된 예약이 만료될 때까지
  기다린다.
- context는 다른 모델 한도이므로 이 backoff와 clock에 묶이지 않는다.

Cloudflare Rate Limiting binding은 위치별·eventually consistent 보조선이라 정확한
전역 회계로 쓰지 않는다. 정확한 시작 순서와 token window는 배포 전체가 공유하는
단일 SQLite Durable Object가 소유한다.

## 4. token 예약

공급자 응답의 실제 usage는 호출이 끝난 뒤에만 알 수 있다. 시작 전에 TPM 초과를
막아야 하므로 Worker가 검증된 본문에서 보수적인 input 상한과 최대 output을 계산해
60초 동안 예약한다. 실패한 호출도 공급자에서 일부 처리됐을 수 있으므로 예약을 즉시
돌려주지 않는다.

### 방송 전사

```text
reservation =
  ceil(durationSeconds × 7)
  + 256 prompt-token margin
  + 1,024 max output tokens
```

중계가 수용하는 90초 상한 요청은 1,910 token을 예약한다. 현재 계획기가 실제로
보내는 30초 청크는 1,490 token이며 60개를 시작해도 89,400 token이다. 따라서
현재 전사-only 경로는 100k TPM보다 1초 start clock과 60 RPM이 먼저 작동한다.
후보 화면 요청이 같은 gate의 token을 함께 사용하면 TPM 대기가 추가될 수 있다.

### 후보 화면·오디오

```text
reservation =
  ceil(durationSeconds × 7)
  + frameCount × 400
  + UTF-8 byte length of the complete shared prompt
  + 8,192 Qwen suffix margin
  + 2,048 max output tokens
```

UTF-8 byte 수는 실제 text token보다 큰 보수 상한으로 쓴다. 화면은 가로 영상
640×360, 세로 영상 360×640처럼 가장 긴 변을 640px로 제한하므로 화면당 400 token
상한과 일치한다. 한 후보 예약이 100,000을 넘으면 공급자 호출 전에 413으로 거절한다.

### 전체 맥락

```text
reservation =
  serialized input bytes
  + 64KiB system/prompt expansion margin
  + 8,192 max output tokens
```

context gate는 5,000,000 TPM을 사용한다. 실제 모델별 output은 1,024~4,096 token이지만
DeepSeek 호환 경로까지 포함한 안전 상한 8,192를 예약한다.

후보와 전사의 Gemini fallback도 각각 2,048·1,024 output token으로 Qwen primary와
같게 제한한다. 따라서 fallback이 더 긴 출력을 허용해 예약식보다 많이 쓰는 숨은
경로는 없다.

## 5. 요청 본문·header·응답 한도

| 경로 | 앱 wire 상한 | 근거 |
|---|---:|---|
| 후보 JSON | 4,257,596 bytes | 60초 WAV Base64 + JPEG 4장 + context 8필드 worst escape + 64KiB |
| 전사 raw WAV transport 상한 | 2,880,044 bytes | PCM16 mono 16kHz, 최대 90초 |
| 현재 계획기의 전사 raw WAV | 960,044 bytes | Worker CPU 완화용 30초 |
| 전사 legacy JSON | 4,008,192 bytes | Base64 WAV + JSON 여유 |
| 전체 맥락 JSON | 8MiB | 144 chapter + 32 candidate의 모든 유효 필드 수용 |
| quota 요청 | 2KiB | ID, digest, action만 허용 |
| 후보·맥락 응답 | 256KiB | bounded JSON |
| 전사 응답 | 128KiB | bounded transcript |

후보는 이전에 개별 필드가 모두 유효해도 합계가 4,008,252 bytes를 넘을 수 있었다.
현재 wire 상한은 모든 필드의 worst escaped JSON을 수용하도록 계산한다. 전체 맥락도
문자별 계약의 이론상 최대가 4MB를 넘을 수 있어 8MiB로 분리했다. 둘 다 Cloudflare
100MB 플랫폼 한도보다 충분히 작다.

quota header는 participant 96자, run/operation 160자, digest 71자, lease 128자로
제한되어 전체 128KB header 한도에 비해 매우 작다.

모든 ingress body는 60초 안에 끝나야 한다. 최대 후보 본문 기준 약 0.57Mbps,
현재 30초 raw WAV 기준 약 0.13Mbps가 필요하다. 중계 transport 상한인 90초
raw WAV를 직접 보낼 때는 약 0.38Mbps가 필요하다. deadline은
2분 upload-ticket TTL보다 짧다. timeout은 413이 아니라 408
`REQUEST_BODY_TIMEOUT`으로 구분하고, 아직 consume되지 않은 같은 lease token의
upload ticket만 원자적으로 해제한다. 이미 execution-waiting/in-flight가 된
중복 요청은 해제할 수 없어 정상 요청을 취소하지 않는다.

## 6. 두 단계 허가와 다섯 명 분배

```text
브라우저
  1. 화면·오디오·대사·맥락 bundle 완성
  2. payload SHA-256 계산
  3. quota upload ticket 요청

Worker
  4. ticket inspect
  5. bounded body 수신
  6. digest·schema·WAV·화면·duration 검증
  7. 역할별 rate-limit backstop 확인
  8. token 예약량과 provider gate 차례로 JIT consume
  9. consume 성공 뒤에만 유료 fetch
 10. 응답 본문 종료까지 확인하고 complete
```

public `granted`는 유료 실행권이 아니라 2분짜리 upload ticket이다. 느린 업로드가
미래 시작 시각을 예약하지 못한다. retry와 provider fallback도 각각 별도 operation,
ticket, consume, token 예약이 필요하다.

다섯 명이 모두 대기하면 ready waiter 사이에서 participant FIFO round-robin을
사용한다. 참여자별 준비 상한은 활성 인원에 따라 다음처럼 줄어든다.

| 같은 provider gate의 활성 참여자 | 참여자당 준비 pipeline | 참여자당 in-flight |
|---:|---:|---:|
| 1명 | 최대 6 | 최대 6 |
| 2명 | 최대 3 | 최대 3 |
| 3~5명 | 최대 2 | 최대 2 |

참여자 하나가 동시에 보유할 수 있는 열린 operation은 최대 12개다. 여섯 번째
participant는 coordinator에 대기열 항목을 만들지 않고 15초 뒤 재시도를 안내한다.

이미 발급된 ticket을 새 사용자가 들어왔다고 회수하지는 않는다. 따라서 사용자가
늦게 합류한 첫 순간의 다섯 요청이 strict 1회씩이라고 보장하지는 않는다. 그러나 새
ticket은 축소된 상한을 따르고, 완료·취소·TTL 회수 뒤 ready waiter round-robin으로
넘어가므로 한 사용자가 계속 재발급해 다른 사용자를 굶길 수는 없다.

각 execution waiter는 Worker가 계산한 token 예약량을 함께 저장한다. 차례가 된 큰
후보가 현재 TPM 잔량에 들어가지 않으면 그 후보의 FIFO 위치는 보존하면서, 잔량에
들어가는 다음 참여자의 작은 전사 요청을 먼저 시작한다. 따라서 한 큰 후보가
60초 동안 전체 provider를 놀리는 head-of-line blocking은 만들지 않는다.

## 7. polling과 Cloudflare 요청 수

실행 대기 중 Worker 내부 consume polling은 즉시 풀릴 수 있는 slot·start-clock
대기에서 250ms다. token window나 provider backoff처럼 coordinator가 정확한
만료 시각을 계산할 수 있을 때는 그 `retryAfterMs`를 최대 60초까지 그대로 기다린다.
따라서 장기 TPM 대기에서 1초마다 Durable Object를 다시 호출하지 않는다. 이 확인은
새 public Worker 요청은 아니지만 각 회차가 DO subrequest라는 점은 운영 지표에
포함한다.

브라우저의 public queue polling은 2초다. 250ms public polling을 사용하면 5명과 여러
준비 요청에서 Free 플랜의 하루 100,000 Worker/DO 요청을 불필요하게 소모한다.
2초는 ticket 회수 지연을 작게 유지하면서 public polling 요청을 1/8로 줄인다.

Cloudflare binding:

| binding | limit |
|---|---:|
| Omni 전역 | 60 / 60초 |
| Omni IP | 60 / 60초 |
| context 전역 | 300 / 60초 |
| context IP | 300 / 60초 |

context의 ExClipper 앱 상한은 Durable Object의 250ms clock(240 starts/min)과
5M TPM이다. 이는 Qwen 3.7/3.6 각각의 공식 15,000 RPM을 합친 공급자 강제치가 아니라
비용·burst를 줄이는 보수적 상한이다. 300/min binding은 비정상 호출을 막는
보조선이다.

## 8. 처리 시간의 하한

현재 계획기의 30초 청크와 1초 start clock을 적용한 시작 하한이다. 같은 Alibaba
계정·모델·리전에 ExClipper 외 소비가 없고 후보 요청이 gate를 사용하지 않을 때의
best-case ceiling이다. 30초 한 요청의 예약은 1,490 token이므로 전사-only
경로에서는 60 RPM이 100k TPM보다 먼저 작동한다.

| 한 사람의 계획 | 요청 수 | 1명 마지막 시작 | 5명 합산 마지막 시작 |
|---|---:|---:|---:|
| 음식 토크 2:15:14.817 전체 전사 | 271 | 약 4분 30초 | 약 22분 34초 |
| 6시간 기본 표본 | 432 | 약 7분 11초 | 약 35분 59초 |
| 12시간 기본 표본 | 432 | 약 7분 11초 | 약 35분 59초 |
| 12시간 + 서로 겹치지 않는 사건 피크 12개 예시 | 480 | 약 7분 59초 | 약 39분 59초 |
| Worker 요청 상한 | 760 | 약 12분 39초 | 약 1시간 3분 19초 |

이는 마지막 요청의 **시작 시각**이다. 실제 완료는 브라우저 decode/WAV 생성,
업로드, 공급자 응답 지연, 6개 in-flight, 후보 요청이 같은 Omni token window를
사용하는 정도에 따라 늦어진다. 반대로 실제 output이 1,024보다 짧아도 현재는
안전 예약을 조기 환급하지 않으므로 이 계산보다 빨라지지 않는다.

위 숫자는 문서용 비례 추정이 아니라 현재
`createBroadcastContextSamplingPlan`과
`createBroadcastContextTranscriptionChunks`를 직접 실행한 결과다. 6시간과
12시간 기본값이 같은 것은 둘 다 200분 ASR 예산을 사용하기 때문이다. 10분 chapter
cell 안의 분산 표본 경계 때문에 단순히 `200분 ÷ 30초 = 400`으로 끝나지 않고
432개가 된다. 사건 피크의 위치·겹침에 따라 실제 개수는 달라지며 760은 계획값이
아니라 비정상 조각화도 거부하지 않기 위한 protocol 방어 상한이다.

## 9. 아직 남은 실제 병목: Worker Free CPU

현재 계획기의 raw 전사 경로는 Worker에서 약 0.96MB의 30초 WAV를 버퍼링하고
SHA-256을 확인한 뒤 Base64와 공급자 JSON byte body를 만든다. 호환 transport는
최대 2.88MB의 90초 WAV도 수용한다. JavaScript 수백만 회 loop는 제거했지만,
native Base64·byte assembly는 여전히 CPU 작업이다.

Cloudflare Free의 요청당 10ms에서는 안전하다고 확정할 수 없다. 실제 배포에서
`Worker exceeded CPU time limit`가 관측됐으므로 **현재 raw 경로를 Free-safe라고
표현하면 안 된다.**

### 즉시 운영 가능한 경로

- Workers Paid로 전환하면 월 최소 $5이며 기본 CPU 30초다.
- 현재 배포는 30초 raw WAV 완화 경로와 본 문서의 gate를 사용한다. Paid 전환과
  90초 복원은 각각 실제 CPU p99와 live transcript 결과를 확인한 뒤 별도 결정한다.
- 1명 → 2명 → 5명 smoke에서 `wrangler tail` CPU, wall time, 429, 1102를 측정한다.
- 측정 뒤 `limits.cpu_ms`를 실제 p99에 여유를 둔 값으로 고정한다.

### Free를 유지할 때의 근본 경로

Worker가 오디오를 변환하거나 전체 hash를 계산하지 않게 해야 한다.

```text
브라우저가 WAV + SHA-256 준비
  → Worker가 stream을 private R2에 put(sha256 checksum 검증)
  → 짧은 수명의 불투명 media URL 발급
  → qwen3-asr-flash가 URL에서 읽어 전사
  → 사용 후 object 삭제, lifecycle로 orphan 정리
```

이 구조는 0.96~2.88MB WAV를 AI proxy가 다시 Base64·JSON으로 만들지 않는다.
`qwen3-asr-flash`는 별도 100 RPM ASR 한도를 사용하므로 후보 Omni 60 RPM/100k TPM과도
분리된다. R2 bucket, media URL 권한, TTL 삭제, 한국어 품질과 timestamp 형식을 실제
샘플로 검증해야 하므로 이번 로컬 변경에는 억지로 활성화하지 않았다.

## 10. 상태·TTL·복구

| 상태 | 회수 기준 |
|---|---:|
| participant idle | 열린 operation이 없고 2분 |
| queued | 마지막 poll 뒤 2분 |
| upload ticket | 발급 뒤 2분 |
| execution waiter | 마지막 consume poll 뒤 3분 |
| in-flight | 3분 뒤 `outcome-unknown` |
| token reservation | 시작 뒤 60초 |
| terminal tombstone | 최대 6시간 |

operation은 최대 768개, 정리 목표는 512개다. 최악 ID 회귀 테스트에서 단일 저장
값은 1.5MB 미만으로 유지되어 SQLite 2MB 한도에 여유가 있다. 영상, WAV, frame,
대사, 채팅, 파일명과 API key는 coordinator에 저장하지 않는다.

본문·digest·schema·WAV 검증에 실패한 upload ticket은 token-bound 내부
`release-upload` 전이로 즉시 `cancelled` 처리한다. 사용자의 명시적 취소와 달리
이 전이는 `lease-issued`에서만 허용되며 execution-waiting/in-flight에는
`already-consumed`를 반환한다.

상태 schema는 `1.4.0`이다. 최초 v0.8.3 배포에서는 이전 coordinator state가 없어
migration이 필요 없다. 한 번 배포한 뒤에는 `providerGates.tokenReservations`가 없는 옛 코드로
즉시 롤백할 수 없으므로, 롤백은 먼저 Worker quota mode를 `optional`로 낮추고
호환 reader를 배포하는 순서로 해야 한다.

## 11. 보안 경계

`participantId`는 브라우저 localStorage의 무작위 설치 ID이지 로그인이나 승인 증명이
아니다. Origin header도 비브라우저에서 위조할 수 있다. 현재 구조는 신뢰된 소수
사용자 최대 다섯 명의 공정 분배에는 맞지만 공개 가입 서비스의 인증은 아니다.

불특정 사용자를 받게 되면 배포 전에 서명된 초대 token 또는 인증 세션을 quota와
모든 유료 endpoint 앞에 추가해야 한다.

## 12. 배포 전 release gate

- transcript와 candidate가 같은 1,000ms clock, 100k TPM, 429 backoff를 공유
- context가 독립 250ms clock, 5M TPM을 사용
- 5명 mixed 역할 round-robin, 참여자별 FIFO
- 후보 5명이 각각 한 upload ticket을 준비 가능
- candidate 4 + transcript 2가 shared in-flight 6을 채우면 7번째 대기
- 모든 individually valid 후보/context 본문이 wire 상한 안에 들어감
- invalid body·digest·WAV·schema는 consume과 upstream fetch 0회
- stalled candidate/transcript/context/quota ingress는 60초 뒤 408, 미사용 ticket 회수
- late duplicate의 upload release가 execution-waiting/in-flight를 취소하지 않음
- retry/fallback마다 별도 ticket·consume·token 예약
- 명시적 HTTP 408/5xx는 별도 operation으로 제한 재시도하고, 전송 결과가 모호한
  network/timeout/200-body-stall만 `outcome-unknown`으로 자동 재전송 금지
- 200-header/body-stall은 `outcome-unknown`, 자동 이중 결제 0회
- restart 뒤 clock·backoff·token window·ticket·terminal 상태 복원
- state < 1.5MB, request/header/response 상한 회귀
- full test, strict TypeScript, ESLint warning 0, build, Wrangler dry-run
- 30초 raw WAV live smoke에서 1102·CPU 초과가 없음을 확인. 실패하면 required
  전환을 중단하고 Workers Paid 또는 R2+ASR 경로를 선택
- 승인 전 commit·push·deploy 금지
