# Development Log

## 2026-08-02 30분 업로드 감지와 due-gated heavy 선분석

- 기존 3시간 cron 전체가 매번 yt-dlp 설치 검증·WARP 등록·AI 준비까지 수행하던 구조를
  30분 lightweight RSS+catalog preflight와 조건부 heavy 준비로 분리했다. preflight는 기존
  `synchronizeChannelPreanalysisCatalog(discoveryOnly)`·`selectDueCatalogVideos`·
  `selectChannelPreanalysisReviewQueue`를 재사용하며 새 업로드를 먼저 `discovered`로 저장한다.
- 신규 pipeline 작업, due context retry, due review retry, `context-ready` review 누락,
  fingerprint 복구가 있을 때만 tests·yt-dlp·WARP·전사·맥락·review 단계를 연다. 수동
  `workflow_dispatch`는 preflight 결과와 관계없이 항상 heavy로 실행한다.
- preflight와 heavy 결과는 같은 catalog snapshot 위에 쓰고, preflight 전에 기록한 remote
  base SHA를 publish job이 다시 확인한다. 따라서 빠른 발견을 추가해도 기존 non-force push와
  stale base race fence를 우회하지 않는다.
- `CHANNEL_PREANALYSIS_CONTEXT_PROXY_URL` 또는 token이 없을 때 `disabled` 보고서를 쓰고 green
  success로 끝내던 경로를 제거했다. `review-ready` 운영 자격 증명이 하나라도 없으면 명시적
  구성 오류로 실패한다. 숨김 ASR/review checkpoint 전달을 위한 `include-hidden-files: true`는
  유지했다.
- 새 preflight 단위·통합·workflow 계약 테스트 6개와 대상 ESLint를 통과했다. commit·push·
  배포는 하지 않았다.

## 2026-08-02 YouTube 사전 분석을 최종 검토 화면까지 완성

- 예약 카탈로그의 terminal을 `review-ready`로 확장했다. 전체 오디오 특징과 전체 맥락의
  의미 lead를 융합해 최대 12개 후보를 만들고, 후보마다 30~60초 WAV와 JPEG 4장이 모두
  준비된 뒤에만 전용 candidate Worker가 화면·오디오·대사·방송 흐름을 함께 해석한다.
- review artifact는 transcript/context digest, participant grounding, 후보별 context·근거·
  AI insight·실제 model receipt·JPEG 4장·대표 thumbnail, 최종 후보 집합과
  `review-ready | verified-empty` certificate를 4MiB 안에서 봉인한다. immutable write와
  readback 뒤에만 manifest 상태를 바꾸므로 일부 후보 실패가 후보 0개로 게시되지 않는다.
- 후보별 checkpoint를 source/video/context digest/review revision/pipeline revision에 묶어
  저장한다. 완료·맥락 제외 후보만 재사용하고 실패 후보만 다음 예약 실행에서 다시 처리한다.
  재시도 시 시도했던 빈 revision을 그대로 사용하도록 고쳐 checkpoint가 v2에서 v3으로
  끊어지던 문제도 막았다.
- 전용 Worker에 Bearer 인증 `/v1/candidate-insights`를 추가했다. 8MiB 이하의 pre-Base64
  media를 디코드하지 않고 exact payload SHA와 Durable Object operation으로 처리하며,
  Node client는 409·429·5xx/network 오류를 같은 body/operation으로 복구한다.
- workflow가 bounded YouTube 분석 사본 다운로드, ffprobe, 전체 audio feature, 후보 media,
  AI 검증, publisher를 실제로 호출하도록 연결했다. write credential은 publish job에만 있고
  yt-dlp child에는 provider/token/GitHub secret이 전달되지 않는다. 숨김 후보 checkpoint도
  artifact로 운반한다.
- 브라우저는 exact YouTube ID 또는 검증된 로컬 identity에 대응하는 review artifact의
  manifest SHA와 내부 closure를 다시 확인한 뒤 `PreparedReviewExperience`를 바로 연다.
  이 경로에서는 긴 로컬 분석을 시작하지 않으며, 편집자의 선택과 경계 조정만 별도로 저장한다.
- 신규·관련 runner/Worker/client/job/publisher/UI 테스트, TypeScript typecheck와 production
  build를 검증한다. 이 항목의 변경은 아직 commit·배포하지 않았다.

## 2026-08-02 다섯 YouTube 채널 자동 선분석 확장

- 자동 발견 source를 아모레또에서 유레카·세나·토로리 코코·망징이까지 확장했다.
  실제 공식 playlist Atom feed를 호출해 다섯 응답이 모두 HTTP 200이고 canonical
  channel ID 및 최근 14~15개 entry가 strict parser를 통과함을 확인했다. 코코는
  Shorts·커버가 섞인 uploads가 아니라 live-stream playlist만 사용하며 완료 replay의
  `was_live` metadata를 허용한다.
- catalog와 artifact는 다섯 namespace로 격리하고, scheduled runner는 모든 feed를
  reconcile하면서도 한 run 전체에서 최대 2개만 처리한다. 3시간 단위 source 회전과
  two-round 배분으로 backlog 독점을 막고, 영구 자막 부재 retry는 fresh/transient 뒤로
  보내며 run당 하나만 허용한다. 한 source feed 장애는 기존 snapshot을 보존하고 sibling
  source 진행을 유지한다.
- 브라우저 lookup은 다섯 catalog를 함께 검색한다. exact ID는 unrelated catalog 장애에도
  사용할 수 있지만 제목·길이·시각 지문의 유일성은 전체 catalog coverage가 있을 때만
  인정한다. 로컬 binding, context seed, background Worker operation에는 source ID와
  channel ID를 함께 봉인해 교차 채널 artifact 대체를 거부한다.
- raw catalog 대신 bundled fallback을 읽은 source도 전체 coverage로 세지 않는다. 빈
  또는 오래된 fallback이 다른 source의 제목·길이 후보를 거짓 단독 후보로 만들 수
  있으므로 exact ID만 허용하고 probable·visual cohort는 명시적으로 보류한다.
- 망징이는 여러 방송을 묶은 `combined-replay`로 기록했다. 전체 합본 exact 매칭은
  가능하지만 로컬 단일 방송과 합본 내부 구간의 subsequence 매칭은 아직 구현하지 않아
  자동 성공으로 표시하지 않고 기존 로컬 분석으로 fallback한다.
- 단일 source 수동 실행도 all-source 실행과 같은 root-level run report를 남긴다. 기존
  catalog branch에 새 namespace가 없으면 immutable application checkout의 검증된
  fallback snapshot으로 빈 namespace를 먼저 만든다. 최초 feed 요청 자체가 실패해도
  source-local 빈 checkpoint를 보존하고, 건강한 sibling 결과를 게시한 뒤 workflow를
  `partial`로 명확히 표시한다.
- 검증: 전체 Vitest 2,151개, runner 계약 43개, 음성 등록 도구 9개, TypeScript
  typecheck, ESLint warning 0, production build를 통과했다. 배포·commit은 하지 않았다.

## 2026-07-30 첫 실제 배포와 예약 러너의 YouTube ingress 차단 확인

### 배포한 것

- `main`에 0.9.0을 push해 Pages 배포를 발동했다. CI가 러너에서 `npm run check`를
  독립적으로 다시 통과했고, 배포본의 `/`, `/youtube-caption-sandbox.html`,
  `/preanalysis/amoretto-vods/catalog.json`, transcript, visual fingerprint가
  모두 HTTP 200으로 서빙됐다.
- `preanalysis-catalog` orphan branch를 seed했다(3파일). 커밋 전에 staged blob의
  sha256과 byte length를 manifest 선언값과 대조해 일치를 확인했다
  (`fa137b2c…`/442509, `9544dd21…`/2199). Windows CRLF 경고는 blob에 영향이
  없었다. raw 경로도 442509 bytes, digest 일치, `Access-Control-Allow-Origin: *`로
  확인했다.

### 첫 실제 CI 실행이 잡아낸 두 결함

로컬에서 44개 계약 테스트가 통과하는데 CI에서는 같은 파일이 실패했다. 러너는
Node **22.12.0**을 고정하고 로컬 개발은 Node 24라, 아래 두 결함이 로컬에서
보이지 않았다.

- **버린 body를 정착시키지 않았다:** deadline 경로에서 `reader.cancel()`을
  await하지 않고 곧바로 `releaseLock()`이 같은 tick에 실행돼, race에서 진 read
  request의 운명을 런타임 stream 구현에 맡겼다. 실제 fetch는 signal이 body를
  찢으므로 가려졌고, signal을 무시하는 fetch 구현(=deadline 테스트가 주입하는 것)
  에서만 드러난다. cancel을 await한 뒤 lock을 풀고, `releaseLock()`이 던지는
  버전별 TypeError가 호출자가 봐야 할 deadline 오류를 대체하지 못하게 감쌌다.
- **deadline 타이머가 unref돼 발화 자체를 못 했다(진짜 원인):** 이 경로에는
  핸들을 보장하는 것이 없다 — JS에서 멈춘 body는 소켓이 없다. unref된 타이머는
  루프를 살려두지 못하므로 루프가 비어 abort가 아예 발화하지 않고 프로세스가
  종료됐다. 그래서 러너는 35번 이후 6건을 "Promise resolution is still pending"
  으로 보고했다 — 36~40번은 실행조차 되지 않았고 35번이 프로세스를 데려갔다.
  실제 fetch에서 deadline이 작동한 것은 소켓이 우연히 루프를 잡고 있었기
  때문이며, 보장이 타이머가 아닌 무관한 핸들에 얹혀 있었다. 같은 함수의
  `clearTimeout`이 이미 만족된 요청의 종료 지연을 막으므로 unref가 살 것은
  없었다. yt-dlp 타임아웃의 `unref`는 살아 있는 자식 프로세스가 루프를 잡으므로
  그대로 둔다.
- 로컬 Node 24 test runner는 루프를 잡고 있어 두 경우를 구분하지 못한다. 그래서
  기전 자체를 양방향으로 검증했다 — unref된 타이머 + 정착하지 않는 read는 발화
  없이 exit 13, 참조된 타이머는 발화하고 exit 0.

### 자막 44ms 초과가 방송 전체를 영구히 막던 단위 오류

WARP로 ingress가 열린 직후 첫 완전 실행이 `VFCOVyDeWWk`를 `INVALID_TRANSCRIPT`로
지연시켰다. 바로 앞에서 추가한 redact 진단 로그가 `Caption event is invalid.`를
함께 출력한 덕분에 네트워크 문제가 아님을 즉시 구분할 수 있었다.

- **원인:** 검사식이 `startMs + durationMs > sourceDurationMs`면 자막 전체를
  거부했다. 그런데 `sourceDurationMs`는 yt-dlp의 정수 초 `duration`에
  `Math.round(× 1000)`을 한 값이라 항상 초 단위로 잘려 있고, 자막 타이밍은 ms다.
  실측하면 6,085개 event 중 **정확히 1개가 44ms 초과**한다(8,259,044 vs
  8,259,000). 손상이 아니라 산술적 필연이며, 3시간마다 영원히 재시도하는
  poison pill이었다.
- **고친 방향:** 이 bound의 진짜 목적은 *다른(더 긴) 영상의 자막이 붙는 것*을
  막는 identity 검사다. 그런 자막은 1초를 훨씬 넘게 초과하므로, 절삭이 만들 수
  있는 오차(1,000ms)만 정확히 흡수하고 그 밖은 그대로 fail-closed로 둔다.
- **한 번 틀렸다:** 처음에는 저장 `durationMs`를 duration에 맞춰 clamp했다.
  다음 실행이 `DIGEST_MISMATCH`로 답했다 — `transcriptDigest`는 생성 시
  **검증 전** caption track으로 계산되므로, 검증 단계에서 값을 정규화하면 저장된
  bytes가 자기 digest와 어긋나 모든 readback이 실패한다. clamp가 멱등이라는 내
  주장은 재검증에 대해서만 참이었고 digest에는 무관했다. digest가 더 강한
  불변식이고 1초 미만 초과는 downstream에 무해하므로(챕터 coverage는 별도로 정확히
  검사된다) clamp를 버리고 원본 그대로 저장한다.
- **테스트:** 실측 초과값으로 bundle을 만들어 생성 직후와 파서 왕복 후 양쪽에서
  digest를 검증한다. 이 단언이 있었다면 CI에 가기 전에 잡혔을 것이다. 기존 거부
  테스트는 1ms 초과를 쓰고 있어 새 허용치에 걸리므로, 절삭으로 설명할 수 없는
  크기로 옮겨 외부 자막 방어 역할을 유지시켰다.
- **결과:** `VFCOVyDeWWk`가 `transcript-ready`로 복구됐다. 카탈로그는 seed 1개에서
  `transcript-ready` 4개, artifact 8개가 됐다. 남은 `retryable` 2개는 WARP 이전
  실패의 backoff가 남은 것으로 다음 cron이 자동으로 이어 간다.

### 정정: ingress는 WARP로 열렸다

아래 "예약 러너의 YouTube ingress는 GitHub Actions에서 막혀 있다" 항목의 관찰은
맞지만, 거기서 끌어낸 결론과 권고는 틀렸다. 남겨 두고 여기서 정정한다.

- **틀린 일반화:** Workers egress가 거부된 측정으로부터 "데이터센터 egress는 다
  막히므로 Oracle을 포함한 어떤 proxy도 무의미하다"고 했다. WARP 소비자 대역과
  Workers egress 대역은 다르며, `D:\agents\Developer_notes\youtube-audio-extraction.md`
  는 이 문제의 ★1순위 해법으로 WARP를 지목하고 "YouTube는 Cloudflare IP를
  블랙리스트로 안 본다"고 이미 기록해 두고 있었다. 기존 프로젝트 노트를 먼저
  찾아보라는 규칙을 지켰다면 self-hosted runner를 권하기 전에 알 수 있었다.
- **측정으로 확정했다.** 버릴 수 있는 별도 진단 workflow로 러너에서 직접과 WARP
  경유를 한 job에서 비교했다. 직접은 `Sign in to confirm you're not a bot`,
  WARP 경유는 exit 0에 612,342 bytes와 한국어 자동 자막이었다. `warp=off` →
  `warp=on`을 YouTube 호출 전에 먼저 확인해 "tunnel이 뜨지 않은 것"과 "YouTube가
  거부한 것"을 분리했다.
- **적용은 환경만으로 끝났다.** child 환경 allowlist가 이미 `ALL_PROXY`와
  `socks5:`를 허용하고 credential이 포함된 proxy URL을 spawn 전에 거부하므로
  스크립트 코드 변경이 없었다. yt-dlp만 tunnel을 지나고 Atom feed·storyboard는
  직접 경로를 유지한다 — Node는 proxy 환경변수를 읽지 않는다.
- **실제로 집계가 시작됐다.** `Xns8EY3gae0`이 예약 경로에서 `transcript-ready`가
  됐다. caption 1,595 event 중 1,364개가 한국어, 챕터 52개가 전체 6,177초를 정확히
  덮고, manifest 선언 digest·byte length가 raw 경로의 실제 bytes와 일치했다. 같은
  실행에서 시각 지문도 만들어졌다. 그래서 cron을 다시 켰고, 계약 테스트는 이제
  cron 부재가 아니라 **WARP connect·`ALL_PROXY`·`warp=on` 증명이 사라지는 것**을
  막는 가드로 바꿨다.
- **진단 workflow는 삭제했다.** 답이 이 로그에 남았으므로 유지할 이유가 없다.
- **남은 취약점과 다음 개선:** YouTube가 WARP 대역을 조이면 증상은
  `retryable(metadata)` 증가로 나타난다. `rekasong`의 `prepare_worker.py`에는
  `classify_failure`가 botwall → unavailable → network → unknown 순서로 이미
  구현돼 있고, 이 프로젝트는 아직 전부 `YT_DLP_FAILED` 하나로 묶는다. 이 분류를
  가져오면 봇월 악화와 영구 불가 영상을 구분해 실패율을 계측할 수 있다. 그때
  같은 노트의 경고도 함께 지켜야 한다 — `unavailable`을 조기 중단으로 쓰지 말
  것. 클라이언트별로 접근성이 갈리므로 오분류 비용이 영구적이다.

### 예약 러너의 YouTube ingress는 GitHub Actions에서 막혀 있다

세 번째 실행에서 `prepare`·`publish`의 모든 step이 통과했고 catalog push까지
됐다. 그런데 실제로 자막이 준비되지는 않았다.

- 두 영상이 `metadata` 단계에서 `YT_DLP_FAILED`로 3~4초 만에 지연됐다. 하나는
  최신 영상 `bm4R6rZI4t4`, 다른 하나는 Codex가 로컬에서 정상 확인한
  `EZfCGS5ms_Q`다. 영상별 문제가 아니라 구조적이다.
- 결정적 비대칭: **같은 러너에서 Atom feed는 정상적으로 읽혔다**(그래서 영상을
  선택할 수 있었다). YouTube HTTPS 전반이 막힌 게 아니라 yt-dlp가 쓰는
  player/watch 경로만 거부된다. 이것은 이번 릴리스가 방금 고친 Cloudflare 증상
  (`android:http-403`, `watch-page:http-429`)과 같은 패턴이다 — 데이터센터
  egress에서 YouTube player 경로가 거부되는 것.
- 즉 예약 러너는 자막 egress 문제를 opaque sandbox로 해결한 바로 그 구조를
  데이터센터에서 다시 시도하고 있다. 현재 `transcript-ready`인 음식 토크
  `KzAW3yow80Q`는 편집자 PC에서 만들어 seed한 것이며 CI가 만든 것이 아니다.
- **아직 확증하지 못한 것:** 러너가 yt-dlp stderr를 출력하지 않으므로 오류
  코드만 있고 메시지가 없다. 봇 체크 거부와 고정 yt-dlp `2026.07.04`의 노후를
  이 로그만으로는 완전히 가리지 못한다. 다음 시도 전에 bounded·redacted stderr를
  노출하는 것이 진단 공백을 닫는 최소 작업이다.
- **부작용:** 실패 run도 revision과 retry 타임스탬프를 바꾸므로 catalog branch에
  커밋을 push한다. 살아 있는 cron은 3시간마다 실행되어 하루 8개의 무의미한
  커밋을 만들면서 어떤 영상도 `discovered` 밖으로 진전시키지 못한다.
- **C(전용 context Worker)는 지금 의미가 없다.** 분석할 transcript가 생기지
  않으므로 배포와 provider key 등록을 보류한다. 이 순서를 지킨 덕분에 불필요한
  과금이 발생하지 않았다.
- 실패 자체는 설계대로 동작했다. 상태 오염 없이 `retryable(metadata)`,
  `lastSuccessfulState: discovered`, bounded backoff로 남았고 확정된 자막·지문은
  손대지 않았다.

## 2026-07-30 아모레또 VOD 예약 자막 카탈로그와 원본 연결

- 예약 workflow를 `prepare(contents: read)`와 `publish(contents: write)`로 분리했다.
  모든 checkout은 credential을 저장하지 않고 dependency 설치는 lifecycle script를
  실행하지 않는다. Node·npm·`yt-dlp`가 끝난 뒤 검증된 catalog snapshot만 job
  artifact로 넘기며, publish는 준비 때 읽은 branch base SHA가 그대로일 때 마지막
  고정 push step에서만 일회성 token을 사용한다.
- ready state가 손상 bundle을 영구 skip하지 않도록 artifact closure reconciliation을
  추가했다. referenced artifact 전부의 regular file·32MiB 상한·exact byte
  length·full SHA-256을 확인하고 transcript는 UTF-8, strict bundle schema,
  transcript digest, video identity, provenance까지 검증한다. 누락·동일 길이 byte
  변조를 주입한 테스트에서는 관련 file/pointer를 제거하고 즉시 due인
  `retryable(transcript)`로 내린 뒤 기존 selection이 복구 대상으로 고르는 것을
  확인했다.
- `Content-Length`가 없는 Atom 응답도 body stream을 512KiB에서 중단하며, 내려받은
  JSON3는 임시 파일의 regular-file 여부와 32MiB 크기를 먼저 확인한 뒤 bounded
  stream으로만 읽는다. chunked 과대 feed와 32MiB를 넘는 sparse 자막 파일을 주입해
  각각 즉시 거부와 `retryable(transcript)` 복구를 확인했다.
- `@AmorettoVODs`의 canonical channel ID를 고정하고 공식 Atom feed를 엄격하게
  읽는 별도 카탈로그 계층을 추가했다. 예약 GitHub Actions는 세 시간마다 최대
  두 영상만 처리하며, metadata와 수동 `ko` 우선·자동 `ko-orig` fallback JSON3
  자막을 immutable bundle에 먼저 쓴 뒤 manifest를 갱신한다. 실패 영상은 마지막
  성공 단계와 재시도 시각을 가진 `retryable` checkpoint로 남아 다음 실행에서
  이어진다.
- 브라우저는 raw `preanalysis-catalog` branch를 먼저 읽고 Pages에 포함된 bundle을
  fallback으로 사용한다. manifest·bundle 크기, 채널/video identity, 연속 챕터,
  transcript SHA-256을 모두 재검증한다. bundle 다운로드가 실패해도 exact 영상
  identity는 잃지 않고 기존 자막·VAD·ASR 경로로 이어진다.
- canonical bundle artifact는 revision이 붙은 ID를 사용한다. 현재 자막 snapshot은
  v1 그대로지만 이후 `context-ready` 맥락을 포함한 v2+ bundle도 video state와
  정확히 일치하면 같은 closure 검증을 통과한다. 과거 검사처럼 bundle을
  `transcript-ready`로 강제해 미래 context state를 막는 모순은 회귀 테스트로 닫았다.
- 로컬 원본 연결 우선순위는 명시적 YouTube ID, 해당 영상에 등록된 동일 파일
  sampled SHA-256, 고유한 제목+길이(±2초)다. 앞의 두 경우만 자동 연결하며
  제목+길이 후보는 편집자 확인 전까지 roster·caption ID 어느 쪽에도 사용하지
  않는다. 새 파일 선택 때 이전 수동 VOD ref를 즉시 지워 다른 방송 자막이
  섞이던 stale binding도 함께 제거했다.
- 실제 음식 토크 `KzAW3yow80Q`로 runner를 실행해 2,619개 한국어 event와 전체
  8,115초를 덮는 68개 연속 챕터를 만들고 digest readback을 통과했다. 이 bundle을
  Pages 초기 fallback에 포함했다.
- 예약 context 경로는 기본 비활성으로 두고 전용
  `CHANNEL_PREANALYSIS_CONTEXT_PROXY_URL`과
  `CHANNEL_PREANALYSIS_CONTEXT_TOKEN`이 모두 있을 때만 opt-in하도록 만들었다.
  기존 대화형 5인 Worker host는 runner가 거부한다. 전용 proxy는 아직 별도
  배포되지 않았으므로 현재 cron은 계속 `transcript-ready`까지만 만든다.
- opt-in runner는 자막 챕터와 sealed transcript-name grounding을 현행 context
  request로 만들고 Bearer token, stable operation ID, payload digest를 전용
  endpoint에 보낸다. transport 결과가 불명확하면 같은 run에서 재호출하지 않고
  exact transcript artifact를 가진 `retryable(context)`로 남긴다. 다음 run은 같은
  operation ID를 사용하므로 전용 proxy가 terminal 결과를 readback해 중복 과금을
  막을 수 있다.
- transcript v1과 context v2가 같은 파일을 덮던 원자성 결함을 제거했다. 새
  artifact는 `<videoId>.v1.json`, `<videoId>.v2.json` revision별 immutable key를
  사용한다. v2 write 직후 manifest commit 전에 중단된 fixture에서 v1 closure가
  그대로 유효하고, 다음 run이 v2를 검증해 AI 재호출 없이 pointer를 승격하는 것을
  확인했다.
- 예약 context bundle에는 `youtube-caption-transcript-only` evidence scope,
  model routing revision, 생성 시각,
  `localVisualVerificationRequired=true`를 기록한다. 로컬 source
  fingerprint·화면·오디오·등장인물 grounding과 후보별 detail receipt는 기존
  완주형 파이프라인에서 다시 검증한다.
- background 전용 `exclipper-preanalysis-context` Worker와 operation별 Durable
  Object를 추가했다. Bearer, stable operation ID, exact payload SHA-256을 검증하고
  검증된 200 성공만 terminal cache에 저장한다. 실패는 bounded backoff checkpoint로
  남기며 stale running은 같은 operation으로 복구한다. 전경 5인 Worker의 quota
  lease와 rate limiter를 사용하지 않지만 upstream quota까지 격리하려면 별도 Qwen
  workspace/key가 필요하다. source와 dry-run은 준비됐고 실제 Worker 배포·secret
  설정은 아직 하지 않았다.
- 검증된 `context-ready` bundle을 App의 내구 맥락 pipeline에 연결했다. exact
  video/transcript/artifact identity와 호환 시간축·아모레또 roster·한국어·현재
  routing을 모두 통과한 경우에만 원격 주제·의미 lead를 현재 로컬 챕터로
  재매핑한다. 이후 현재 후보와 현재 participant grounding으로 selection jury를
  반드시 실행한다. 변조·불일치·coverage gap은 기존 로컬 overview/discovery로
  되돌아가며, 과거 로컬 ledger 중간에 seed를 끼워 넣지 않는다.
- 파일명에 포함된 video ID와 제목·길이는 자동 신뢰 근거에서 제외하고 편집자 확인
  단서로만 남겼다. 명시 URL, 이미 등록된 exact sampled-file 지문, 편집자 확인만
  로컬 binding을 만들 수 있다. 실제로 읽어 검증한 bundle bytes와 manifest의
  artifact ID·SHA-256을 하나의 원자적 binding으로 묶어, 병렬 lookup 중 stale
  manifest와 새 bundle을 조합하는 경로도 닫았다.
- 예약 context runner는 응답 본문이 멈춘 경우까지 포함한 end-to-end deadline,
  protocol·routing·실제 model ID/revision receipt의 exact 검증, 4MiB manifest
  producer 상한을 적용한다. 전용 secret이 없으면 context retry를 남기지 않고
  보존된 transcript-ready pointer로 정착한다. 전용 Durable Object의 구형·손상
  checkpoint는 격리한 뒤 같은 exact payload를 새 schema로 재개하되, 다른 payload가
  같은 operation을 탈취하는 것은 계속 conflict로 거부한다.
- exact 검증 뒤 `routingRevision`만 bundle에 남고 proxy `contractVersion`과 실제
  `modelId`·`modelRevision`이 소실되던 provenance 누락을 닫았다.
  `contextProvenance.contextReceipt`는 네 필드를 모두 exact-key·128자 안전 token
  상한으로 보존하고, receipt routing과 provenance routing이 다르거나 필드가
  추가·누락되면 context bundle parsing과 artifact closure를 fail-closed한다.
- 원격 영상의 선형 상태에서 도달 불가능했던 `fingerprint-ready`를 제거하고 시각
  지문을 transcript/context 이후의 독립 후행 lane으로 바꿨다. storyboard나 지문
  생성이 실패하면 `retryable(fingerprint)`가 마지막 성공 주 상태를 보존하고,
  지문 파일의 누락·동일 길이 변조도 transcript/context를 재생성하지 않고 지문만
  복구한다. 기존 ready 영상의 누락 지문은 fresh 영상보다 낮은 우선순위로
  backfill한다.
- YouTube storyboard와 로컬 재인코딩 원본을 연결하는 12-anchor 시각 지문을
  구현했다. 각 anchor는 32×18 luma의 dHash64·blockHash64·평균 밝기·edge
  energy를 사용하고, 최소 8개·67%·앞/중간/뒤 coverage·median/p90 상한을 모두
  통과한 유일한 후보만 exact로 승격한다. 단일 후보는 ±30초 bounded offset
  복구를 허용한다.
- 파일명이 완전히 바뀌어 video ID와 제목 단서가 없는 경우를 위해 최대 12개
  duration cohort를 같은 catalog snapshot에서 읽는 경로를 추가했다. 모든 원격
  fingerprint를 manifest byte length·SHA-256으로 검증한 뒤 필요한 source 시각
  합집합을 로컬 영상에서 한 번만 추출한다. 일부 fetch 실패·복수 합격·합의 부족은
  자동 연결하지 않으며, 유일한 합의만 `visual-fingerprint-consensus` 이유와 exact
  bundle binding을 반환한다.
- 실제 음식 토크 로컬 원본은 YouTube storyboard와 12/12 anchor, offset 0,
  앞/중간/뒤 coverage, median 4.5, p90 10으로 합격했다. 다른 방송
  `EZfCGS5ms_Q`를 같은 duration으로 강제한 negative control은 0/12로 거부되어
  길이만 같은 영상의 오연결을 막는 것을 확인했다.
- 예약 workflow의 source checkout은 움직이는 `main` 대신 event가 선택한 immutable
  `github.sha`로 고정했다. `schedule`과 `workflow_dispatch` 모두 같은 계약을
  사용하며, runner 대기 중 main이 바뀌어도 다른 source가 context secret을 받지
  못하도록 회귀 테스트로 묶었다.
- pinned `yt-dlp` child는 더 이상 `process.env` 전체를 상속하지 않는다. OS 실행,
  temp, locale, credential 없는 proxy URL, CA bundle 경로만 명시적으로 전달하고
  scheduled Bearer·provider key·GitHub token·임의 secret은 제외한다. credential이
  포함된 proxy, 개행 또는 과대 환경값은 spawn 전에 fail-closed하며 실제 child
  process에서 secret key가 보이지 않는 통합 회귀를 추가했다.
- 전체 맥락의 `deprioritized`·음악 판정은 조기 상세 제외가 아니라 진단 가설로
  바꿨다. 편집자가 명시적으로 제외하지 않은 모든 후보는 최대 12개씩 이어지는
  missing-only batch에서 서로 다른 화면 네 장, 후보 오디오, 현재 방송 맥락을
  검증한다. context-negative 가설도 exact 멀티모달 receipt가 프로그램성 장면 또는
  사건 없음에 동의해야만 정상 최종 제외가 된다.
- 최종 `npm run check`는 Vitest 172개 파일 2,097개와 voice-enrollment 도구
  9개를 모두 통과했다. 별도 workflow 런타임 명령에서는 예약 runner·지문
  generator 44개, 집중 브라우저 회귀에서는 11개 파일 122개를 통과했다.
  production build는 254 modules와 초기 fallback catalog/bundle을 생성했고,
  전경 Worker dry-run은 463.89KiB(87.57KiB gzip), 예약 Worker dry-run은
  154.81KiB(33.88KiB gzip)로 통과했다. live Atom feed도 HTTP 200,
  15,637 bytes, 14개 영상, pinned channel ID로 다시 읽었다.

## 2026-07-30 실제 샘플 ingress 검증과 YouTube 자막 egress 복구

### 어디에서 막혔는지

- `D:\opencode\StreamSaver\downloads`의 음식 토크·실수로 구독을 열었다·마크 릴레이
  MP4 세 종류를 전체 video/audio `ffmpeg -xerror` decode로 확인했다. 세 원본 모두
  손상 없이 끝까지 decode됐고, 음식 토크의 중복 파일 두 개는 SHA-256까지 같은
  동일 파일이었다. 음식 토크에서 뽑은 19장 JPEG도 모두 640×360으로 decode됐으며
  파일·pixel hash가 서로 달랐다.
- 실제 운영 전사는 음식 토크의 오프닝 0~90초를 `[대사 없음]`으로 정착했고,
  칼국수·껍데기·두바이초콜릿 구간은 한국어 대사를 정상 반환했다. 실제 WAV와 서로
  다른 JPEG 4장 후보 bundle도 stage/AI/cleanup을 완주했다. 따라서 local media
  decoder, frame extraction, transcript ingress, R2 candidate ingress는 병목이 아니었다.
- 반면 당시 production `/v1/youtube-captions?v=KzAW3yow80Q`는 실제로 존재하는
  한국어 자동 자막을 `404 CAPTIONS_NOT_FOUND`로 오판했다. 같은 Android player
  요청은 편집자 PC에서 한국어 track 1개와 최종 2,619개 event를 반환했지만,
  Cloudflare remote runtime에서는 `android:http-403`,
  `tv-embedded:error`, `watch-page:http-429`였다. 여러 player 종류를 추가해도
  같은 Cloudflare egress를 공유하므로 해결되지 않았다.
- 이 false 404 때문에 당시 배포판은 전체 2.25시간 방송을 271개 30초 audio cell로
  ASR 복구하기 시작했다. 현재 `free-r2` 계획은 같은 범위를 91개 90초 cell로
  묶지만, 자막이 정상 유입되면 91/91 cell이 모두 caption receipt로 정착해 ASR
  요청은 0개가 된다. “예전에는 잘 됐는데 갑자기 느리고 끝까지 못 감”의 직접
  원인은 원본 손상이나 파이프라인 checkpoint가 아니라 이 caption source
  전환이었다.

### 최소 복구 구조

- GitHub Pages 부모와 별개인 `sandbox="allow-scripts"` iframe을 추가하고
  `allow-same-origin`을 주지 않았다. 이 opaque frame은 source file, IndexedDB,
  AI credential과 분석 상태에 접근하지 못하며, public Android bootstrap과
  YouTube timedtext fixed host만 CSP로 허용한다.
- iframe은 preflight가 없는 `text/plain` player 요청을 편집자 네트워크에서 보내고,
  HTTPS `youtube.com/api/timedtext`, 동일 video ID, 한국어 track을 확인한다.
  player 2MiB·caption 8MiB·20초 deadline을 적용한 뒤 JSON3 원문만 부모로 돌려준다.
- 부모는 `event.source`, opaque `event.origin`, 128-bit nonce, request ID, exact message
  schema, video ID, 한국어 language code, event 수·시간·문자를 다시 검증한다.
  외부 사이트가 공개 frame을 자막 relay로 쓰지 못하도록 child도 parent origin을
  자신의 asset origin과 대조한다.
- 실행 순서는 `opaque sandbox → Worker proxy → bounded ASR`이다. sandbox transport
  실패뿐 아니라 한 Android surface의 한국어 track 부재도 전역 자막 없음으로
  확정하지 않고 Worker/ASR로 이어진다. caption model revision을 올려 과거
  false-404 session이 현재 자막 근거로 가장되지 않게 했다.
- 실제 Chrome에서 production client 모듈을 그대로 호출해 음식 토크가
  `videoId=KzAW3yow80Q`, `languageCode=ko`, 2,619 events,
  00:00:29.759~02:14:58.239로 복구되는 것을 확인했다. 이 경로에서는 Cloudflare
  CPU·요청 횟수·egress 제한을 소비하지 않는다.

### 함께 고친 운영 smoke

- 5인 quota coordinator의 정상 대기 응답은 HTTP 429와
  `status=capacity-full`을 함께 사용한다. smoke 도구가 HTTP status만 보고 실패하던
  불일치를 제거해, 브라우저와 같이 `retryAfterMs`만큼 기다린 뒤 lease를 다시 받는다.
- 최종 `npm run check`는 Vitest 162개 파일 1,974개와 voice-enrollment 9개를
  모두 통과했다. production build와 Wrangler dry-run도 통과했으며 Worker는
  463.40KiB(87.38KiB gzip)다. 실제 Chrome sandbox caption smoke와 91/91 exact
  caption-cell projection도 별도로 통과했다.

## 2026-07-30 v0.9.0 current-only 완주형 파이프라인 릴리스 후보

### 실패 지점과 복구 방식

- 이번 버전은 정식 배포 전의 단일 current schema만 지원한다. 과거 DB·작업 ID·체크포인트를
  변환하거나 추측해 복원하지 않는다. 분석 DB는 `exclipper-analysis-results-v1`,
  원본 파일 핸들 DB는 `exclipper-source-handles-v1`, 작업 identity는
  `exclipper-input-signature-v1`로 분리했다.
- 전사와 보강 전사는 조각별 terminal receipt를 즉시 저장하고 exact readback한 뒤 다음
  조각으로 이동한다. 한 invocation은 최대 3회까지만 provider를 시도하지만, 저장된
  checkpoint를 바탕으로 1·2·4·8·16·30초 backoff의 새 generation을 계속 열 수 있다.
  성공·무발화 조각은 다시 호출하지 않는다.
- 무료 `free-r2` 요청의 응답 여부가 불명확하면 동일 operation의 terminal readback을 먼저
  수행하고, 끝내 결과가 없을 때만 결과불명 영수증을 저장한 뒤 해당 조각만 새 operation으로
  자동 복구한다. 유료 직접 호출만 중복 과금 위험 때문에 편집자 승인을 요구한다.
- 후보 화면 해석도 같은 무료 복구 계약을 사용한다. 서로 다른 JPEG 4장과 준비 영수증이
  모두 저장된 셀만 AI에 들어가며, 완료 셀의 프레임·결과는 이웃 셀 재시도 중 다시 만들지
  않는다.
- Candidate Pass B는 저장 ledger·dispatch·settlement가 정확히 일치하는 미실행 후보 또는
  무료 결과불명 후보만 선택한다. 재시도 직전 durable record를 다시 확인하고 grant를
  저장·readback한 뒤 새 attempt가 이를 소비한다. 이미 성공한 형제 후보는 그대로 보존한다.
- Qwen 후보 입력의 화면 표기가 1~4인데 검증 스키마는 0~3이었던 불일치를 제거했다.
  `evidenceBasis`는 실제 화면 고유 이름의 `on-screen-name` 또는 실제 호명의
  `spoken-name`만 허용한다. `스트리머`·`진행자` 같은 역할명은 이름으로 인증하지 않고,
  고유 이름 근거가 없으면 `present-unidentified`로 남긴다.
- `candidate-plan-invalid`는 전사·출연자·전체 맥락을 지우지 않고 Candidate Pass B 계획과
  그 파생 상세 결과만 CAS로 재구성한다. 실제 source/run/context fence 불일치에만 상류
  재구축을 허용한다.

### 최종 인증 경계

- 최종 방송 맥락은 주제 구간과 의미 단서 지원이 모두 확인된 최종 result만 허용한다.
  discovery overview와 jury selection의 입력·결과 fingerprint, jury가 본 최종 맥락
  fingerprint를 ledger부터 certificate까지 연결한다. 중간 discovery/selection 결과와
  알 수 없는 `analysisMode`는 최종 결과로 표시하거나 인증하지 않는다.
- 분석 언어와 출연진 상태는 암묵 기본값이 없다. `outputLanguage`와
  `castRosterId: roster | null`을 요청·operation ID·dispatch·settlement·source fence·
  verification receipt·최종 인증 전체에서 동일하게 검증한다.
- `AnalysisJobRecord`는 current schema와 정확한 중첩 상태를 검사한다. 완료 표시는 현재
  manifest·fast terminal·전사·화면·출연자·전체 맥락·후보 계획·후보별 상세 영수증을
  다시 연 뒤 발급한 `usable` 또는 근거가 완결된 의도적 `empty` certificate에만 허용한다.

### 릴리스 게이트

- `npm run check`: TypeScript strict, ESLint warning 0, Vitest 161개 파일
  1,964개 테스트, 음성 등록 CLI 9개 테스트 전부 통과.
- 현재 AI smoke 계약 5개 통과: 전사 raw WAV stage/resolve/cleanup, 명시적 429 재시도,
  sealed grounding 전체 맥락, 전체 맥락 응답 형식 오류의 새 generation 복구,
  WAV+JPEG 4장 후보의 R2 재사용 복구.
- production Vite build 통과. main bundle 1,221.00 KiB(334.81 KiB gzip),
  Candidate Pass B worker 371.79 KiB.
- Wrangler dry-run 통과. Worker 463.40 KiB(87.38 KiB gzip), Qwen·`free-r2`·
  quota required·최대 동시 편집자 5명 계약을 확인했다.
- 실제 음식 토크 19:45 구간에서 Qwen 한국어 전사, 전체 맥락, 오디오+서로 다른 화면
  4장 후보 해석이 모두 HTTP 200으로 완료됐다. 후보 해석은 첫 업로드를 보존한 채
  3번째 generation에서 `streamer-event / recommend / present-unidentified`로
  끝났고 R2 cleanup까지 확인했다.
- Worker `1438ff5e-3edf-466b-a807-da4098dc1ef5`를 배포했다. 이 변경을 포함한
  GitHub Pages workflow와 production 브라우저 검증을 최종 배포 게이트로 사용한다.

## 2026-07-29 Context/refinement exact-operation reconciliation

> 중간 구현 기록이다. 결과불명 terminal 이후의 무료 자동 generation과 최종 검증 수치는
> 위 `2026-07-30` 릴리스 후보 계약이 이 항목을 대체한다.

- **Before:** 새로고침에서 context/refinement `in-flight`를 곧바로
  `outcome-unknown`으로 봉인했다. coordinator가 첫 요청을 받지 않았거나 terminal
  result를 보관한 경우에도 같은 operation을 확인할 계약이 없어, 이미 끝난 형제
  unit을 보존하더라도 막힌 unit을 복구할 수 없었다.
- **After:** phase ledger를 current-only `3.0.0`으로 교체하고
  `UNIT_RECONCILIATION_STARTED | SUCCEEDED | NOT_DISPATCHED | UNRESOLVED`를
  추가했다. runner는 `reconciling` exact readback 뒤 기존
  `operationId + inputDigest`만 1회 조회/replay한다. 일치하는 result만 성공으로
  소비하고 명시적 비전송 증명만 `retryable-gap`으로 바꾼다. 나머지는 같은
  operation의 `outcome-unknown`과 `reconcile-current-operation` action으로 남긴다.
- context/refinement wrapper는 현재 proxy에 별도 terminal-result query API가 없는
  동안 동일 operation transport replay를 기본으로 사용한다.
  `reconcileOperation(identity, replaySameOperation)` hook을 함께 노출해 이후
  coordinator cache/query 응답을 연결할 수 있게 했다. 성공을 추측하는 fallback은
  없다.
- `in-flight | reconciling`에서는 새 operation을 발급하지 않는다. exact-operation
  reconciliation이 결과불명으로 닫히면 무료 route는 durable terminal readback 뒤
  자동으로 새 generation을 열고, 유료 route만 명시적 편집자 승인을 요구한다.
- 당시 집중 검증에는 interruption/reload/mismatched receipt/non-dispatch/sibling
  preservation 회귀를 포함했다. 최종 전체 검증 수치는 위 릴리스 후보 항목을 따른다.

## 2026-07-29 Participant pre-context durable proof packet

- 현재 스키마만 지원한다. 과거 grounding-only JSON을 재해석하거나 마이그레이션하는 경로는 추가하지 않았다.
- durable checkpoint는 canonical participant plan, terminal/none-observed receipts, sealed plan, 최종 grounding을 한 패킷으로 저장한다. 복구 시 plan/adapter/cell fingerprint를 다시 계산하고 receipts를 다시 seal한 뒤 grounding을 재투영한다.
- participant source fence는 별도로 재해시하지 않고 transcript evidence와 session이 쓰는 동일한 canonical `sha256` source fingerprint를 그대로 사용한다.
- terminal visual settlement는 동일 source/range/4-frame plan일 때만 visual-identity receipt로 바뀐다. 화면에 연결되지 않은 spoken name이나 channel prior는 identified 근거로 인정하지 않는다.
- durable restore는 checkpoint signature까지 다시 계산해 session signature와 일치할 때만 성공하므로, 맥락 API 요청 전에 잘못된 packet을 차단한다.
- 집중 검증: participant/storage/context 관련 148개 테스트 통과, scoped ESLint 통과.

## 2026-07-29 v0.9.0 current-only 내구 파이프라인

### Before / After

- 이전에는 manifest, final result, terminal, 맥락 session, 의미 정제 결과, 최종
  성공 판정의 바깥 저장 shell 일부가 one-shot이었다. IndexedDB timeout이나 CAS
  충돌 한 번이 이미 계산한 AI 결과까지 실패 화면으로 보내고, 자동 operation key를
  잠근 채 수동 처음부터 다시 분석하도록 만들 수 있었다.
- 이제 빠른 탐색은 immutable manifest와 final/terminal bundle을 저장하고 exact
  readback한 뒤에만 job cursor를 전진시킨다. provisional write는 성공 계약에서
  제거했다. 탭 종료로 terminal과 cursor가 어긋나도 bundle을 다시 쓰거나 분석하지
  않고 누락 cursor만 순서대로 보정한다.
- 전체 맥락과 의미 정제의 session load, participant grounding, evidence ledger,
  phase ledger, semantic candidate commit은 공통 run/input/operation fence,
  watchdog, CAS rebase, exact readback을 사용한다. transient failure가 내부 retry
  한도를 넘으면 1~30초 backoff로 같은 checkpoint를 계속 열며 provider 결과는
  다시 구매하지 않는다.
- 최종 결과는 manifest·fast result·terminal·context session·candidate detail을
  모두 다시 연 뒤 certificate를 발급한다. 검증된 후보가 있는 `usable`과 근거를
  끝까지 확인한 정상 `empty`만 job terminal로 인정한다.
- 현재는 배포 전 개발 계약이므로 legacy schema migration을 추가하지 않았다.
  current schema 밖의 record는 완료로 승격하지 않고 새 분석 대상으로 남긴다.

### 편집 상태와 회귀 방지

- 분석 후보 cohort는 review state를 입력으로 사용하지 않는다. 승인·제외가 유료
  맥락/상세 분석을 다시 시작하거나 후보를 사라지게 하지 않는다.
- 늦게 도착한 semantic 후보는 같은 ID의 review state와 승인 경계 revision을
  보존한다. dependency 교체 시 이전 controller를 즉시 취소해 오래된 operation이
  새 입력에 provider 요청이나 저장을 이어가지 못하게 했다.
- participant grounding과 context/refinement CAS는 처음 읽은 parent snapshot과
  현재 snapshot이 같은 경우에만 rebase한다. 더 최신 grounding·ledger·candidate
  projection을 이전 operation이 덮어쓰지 않는다.

### 검증

- current-only usable, 정상 empty, transient CAS 복구, terminal 저장 뒤 cursor만
  뒤처진 탭 종료 복구를 통합 테스트로 고정했다.
- durable mutation, AnalysisJob, fast artifact bundle, context session, pipeline
  certificate의 timeout·abort·stale·conflict·exact readback 테스트를 추가했다.
- 독립 게이트에서 strict TypeScript, ESLint warning 0, Vitest 148개 파일
  1,784개 테스트, 음성 등록 도구 9개 테스트, production Vite build와 Wrangler
  dry-run이 통과했다. Pages main bundle은 1,025.66 KiB(286.32 KiB gzip),
  Worker dry-run은 479.10 KiB(90.72 KiB gzip)이며 Worker 설정은 계속
  Qwen·free-r2·quota required·최대 5명이다.

## 2026-07-29 v0.8.9 전사 경로 고정·체크포인트 복구

### Before / After

- 이전에는 `/healthz`에서 선택한 전사 provider·model·transport·fallback 정책이 실제
  각 요청과 R2 ticket에 묶이지 않았다. 배포 중 경로가 바뀌면 오래된 요청이 새
  Worker에 도착해 일반 실패로 기록되고, 완료한 셀까지 다시 처리할 위험이 있었다.
- 이제 canonical route manifest의 SHA-256 fingerprint 하나를 모든 전사 요청과
  서명된 R2 ticket에 넣는다. Worker는 quota·rate limit·R2 read·upstream 호출 전에
  현재 경로와 비교하고, 성공 응답도 같은 fingerprint와 실제 provider receipt를
  되돌려준다.
- `route-changed`는 결제 여부가 모호한 실패가 아니라 비용 발생 전의 복구 가능한
  gap이다. 이미 성공한 셀과 provider receipt는 그대로 두고, 새 `/healthz` 경로로
  checkpoint를 rebase한 뒤 해당 gap만 자동 재개한다.
- 같은 실행에서 첫 `route-changed`가 확인되면 아직 보내지 않은 셀은 네트워크
  요청과 audio decode를 생략하고 같은 gap으로 정리한다. 따라서 배포 경계의
  불필요한 409 묶음과 후속 재처리를 줄인다.
- plain `/healthz` 하나가 service 6·transport 3의 현재 계약만 반환한다. 모든
  전사 요청은 여기서 받은 route fingerprint를 반드시 보내며, 누락·malformed·stale
  header는 quota·R2·provider 실행 전에 거부한다.
- R2 media는 현재 schema 2·ticket v2만 읽고 쓴다. refinement checkpoint도 현재
  v4 입력 signature가 정확히 같을 때만 열며, signature가 바뀌면 구 결과를
  이관하지 않고 새 checkpoint에서 시작한다. 같은 signature 안의 성공·무발화
  셀은 보존하고 누락 셀만 재개한다.
- 브라우저에서 Worker로 들어오는 전사 형식은 `audio/wav` 하나로 줄였다.
  호출자가 없던 JSON·Base64 ingress와 그 분기·파서를 삭제하고, Free R2는
  WAV stage→v2 ticket resolve, paid-direct는 검증된 WAV 전달만 사용한다.

### 효율·실패 경계

- 정상 경로의 추가 비용은 작은 manifest에 대한 Web Crypto SHA-256 확인과 HTTP
  header 하나뿐이다. 원본 audio를 다시 hash·serialize하거나 전체 checkpoint를
  다시 계산하지 않는다.
- 무료 운영 경로는 계속 `Qwen + free-r2`, quota coordinator 필수, 동시 사용자
  최대 5명이다. Groq는 명시적으로 선택하기 전에는 호출하지 않는다.
- 실제 provider 요청 이후 응답 여부가 불명확한 `outcome-unknown`만 자동 재결제를
  막는다. route 변경·rate limit·확정 실패는 마지막 durable checkpoint에서 누락
  셀만 이어간다.
- 연속 route 변경은 250ms부터 최대 10초까지 예외 경로에서만 backoff한다. hard
  retry cap은 두지 않아 자동으로 수렴하며, 정상 경로에는 대기나 추가 media
  변환이 생기지 않는다.

### 검증

- route manifest, direct/stage/resolve header, signed R2 ticket, quota 선행 차단,
  응답 receipt, fragment recovery, refinement resume, session migration을 집중
  테스트했다.
- 독립 최종 게이트에서 TypeScript와 ESLint warning 0, Vitest 140개 파일
  1,689개 테스트, 음성 표본 CLI 9개 테스트가 통과했다.
- production build와 Worker dry-run도 통과했다. Worker bundle은
  479.10 KiB(90.72 KiB gzip)이며 production 기본값은 계속 Qwen·free-r2·quota
  required다. 운영 smoke와 실제 배포 식별자는 배포 후 작업 보고에 남긴다.

## 2026-07-29 v0.8.8 파이프라인 내구성 릴리스

### 릴리스 범위

- 전체 방송 전사와 맥락 분석을 조각 단위 체크포인트·provider 영수증·CAS 저장으로
  묶어, 일부 요청이 실패하거나 탭을 새로고침해도 이미 완료된 근거를 보존하고
  실패 조각만 다시 처리할 수 있게 했다.
- 후보별 맥락·대사·화면 4장·대표 썸네일·AI 영수증이 같은 source range와
  fingerprint를 가리킬 때만 최종 후보로 게시한다. 구형 또는 다른 구간의 결과를
  섞어 완성된 후보처럼 보이는 경로는 닫았다.
- 방송 맥락 전에 참여자 근거를 정리하는 durable grounding 계약과, 이후 화자
  인식을 위한 고정 WavLM Worker·검증 도구를 추가했다. 검증되지 않은 음성 표본은
  인명을 확정하지 않으며 production 화자 adapter는 계속 비활성 상태다.
- 참여자 grounding 저장 서명에 사용한 sampling plan fingerprint를 세션 schema
  `1.10.0`에 함께 보존하고, 저장과 새로고침 복원이 같은 서명 helper를 사용하게
  했다. 새 plan으로 만든 근거를 과거 맥락에 붙이지 않으며, plan fingerprint가
  없는 legacy 기록은 보존하되 유료 맥락 완료 상태로 자동 복원하지 않는다.
- 후보 정제 대사의 출처를 `BroadcastContextSession` schema `1.11.0`의
  `refinementEvidenceLedgerJson`으로 보존한다. YouTube 자막과 ASR은 같은
  non-overlapping plan을 사용하고, 자막의 빈 cell은 exact VAD 근거가 없으면
  자동 성공시키지 않고 같은 plan의 ASR 복구로 넘긴다. 활성 route의
  projection fingerprint가 semantic AI phase ledger·저장 후보·Pass B 영수증까지
  일치할 때만 다음 단계로 진행한다.
- main 및 refinement `no-speech`는 단순 사유 문자열이 아니라 원본 구간,
  고정 VAD 모델·정책 revision, 완전 coverage를 담은
  `BroadcastSpeechActivityRunReceipt`를 Worker에서 저장 원장까지 보존한다.
  영수증이 없거나 변조된 legacy 무발화 기록은 현재 완료 근거로 재사용하지 않는다.
  방송 전체가 무발화인 경우에는 조용한 화면 사건을 임의로 “없음” 처리하지 않고
  `visual-evidence-required` gap으로 종료해 전체 맥락과 최종 게시를 차단한다.
- Candidate Pass B 검증 영수증을 schema `1.4.0`으로 올리고 후보 구간·모델·활성
  정제 근거에 더해 `outputLanguage`와 nullable `castRosterId`를 exact source
  fence로 묶었다. 구형 영수증은 읽을 수 있지만 현재 결과로 재사용하지 않으며,
  언어 또는 등장인물 명부가 바뀌면 해당 후보만 다시 분석한다.
- 후보별 화면·대사·AI 결과 full-map 저장도 직전에 읽은 exact snapshot에 대한
  compare-and-swap과 저장 후 readback을 사용한다. 병렬 후보 완료나 다른 탭의
  늦은 callback이 더 최신 썸네일·영수증·설명을 과거 snapshot으로 덮어쓰지 못한다.
- Groq Whisper Large V3 Turbo를 선택형 전사 provider로 준비하고 credential은
  Cloudflare Worker secret에만 둔다. 이번 릴리스의 production 기본 경로는
  기존과 같은 `Qwen + free-r2`이며, Groq로 자동 전환하거나 추가 비용을 만들지
  않는다.

### 배포 게이트

- 전체 typecheck·lint·Vitest·음성 표본 도구 테스트, production build,
  `wrangler deploy --dry-run`, staged diff의 secret 및 whitespace 검사를 모두
  통과한 동일 소스 상태만 Worker와 GitHub Pages에 배포한다.
- 호환성을 위해 Cloudflare Worker를 먼저 배포하고 `/healthz`를 확인한 다음,
  같은 commit을 `main`에 push하여 GitHub Pages를 갱신한다.
- 배포 직전 독립 재검증에서 TypeScript, ESLint warning 0, Vitest 140개 파일
  1,684개 테스트, 음성 표본 CLI 9개 테스트와 production build가 모두 통과했다.
  Worker dry-run은 474.40 KiB(89.30 KiB gzip)였고 production 기본 provider
  `Qwen`, `free-r2`, quota coordinator 최대 5명 구성을 그대로 확인했다.

## 2026-07-29 화자 임베딩 실행부·18개 표본 교차검증

### 실행부

- 브라우저 전용 `SpeakerEmbeddingWorkerClient`와 WASM Worker를 추가했다. 모델은
  `Xenova/wavlm-base-plus-sv`의 고정 revision
  `e61029603001bd11295c36d878698708bf59190f`, q8, Transformers.js `3.8.1`이다.
  입력은 16 kHz mono Float32, 3~30초, 최대 1,920,000 bytes로 제한한다.
- source fingerprint·시간 범위·audio bundle reuse key·PCM SHA-256·speech/overlap/music
  준비 영수증을 하나의 input fingerprint로 묶는다. Worker는 한 번에 한 발화만
  처리하고 모델을 재사용하며, NaN·0벡터·형태 오류와 stale identity를 거부한다.
  PCM과 임베딩은 영속 결과에 넣지 않고 작업이 끝나면 메모리 버퍼를 비운다.
- 여러 등록 표본의 정규화 prototype 평균, cosine score, 부분 coverage, open-set
  `unknown` 투영을 분리했다. 등록 표본이 없는 참여자는 억지로 6인 closed set 중
  하나로 고르지 않고 `missingParticipantIds`에 남는다.

### 표본 추출·실측

- 전원 등장 방송 6개와 사용자가 준 개인 채널 4개에서 총 18개 FLAC 후보를
  repository 밖 `Codex/artifacts/voice-enrollment-candidates/`에 추출했다.
  개인 채널 표본은 유레카 3개, 망징이 4개, 세나 아르벨 2개, 토로리 코코 3개다.
- `npm run enrollment:evaluate-speakers`는 FLAC을 임시 16 kHz PCM으로 디코드하고
  production과 같은 고정 WavLM revision으로 임베딩한 뒤, 원음·PCM·임베딩을
  저장하지 않고 cosine 진단만 출력한다. 개인 채널 내부 평균 일관성은 유레카
  0.891, 망징이 0.879, 세나 아르벨 0.898, 토로리 코코 0.908이었다.
- 전원 방송의 30초 후보를 개인 채널 prototype과 교차검증하자 망징이만 명확히
  일치(0.940)했고, 세나는 같은 이름이 top-1이지만 점수가 0.603으로 약했다.
  유레카 후보는 세나, 코코 후보도 세나가 top-1이었다. 이는 30초 안에 여러
  발화자·음악이 섞였거나 수동 시점 라벨이 틀렸다는 실측 근거다. 아모레또와
  세라는 독립 prototype이 없어 아직 교차검증할 수 없다.
- 따라서 18개 파일은 모두 `humanVerification=pending`,
  `containsOverlappingSpeech=true`, `containsMusic=true` 상태를 유지한다. 현재
  App에는 runtime을 활성화하거나 인명을 확정하는 manifest를 연결하지 않았다.
  다음 단계는 VAD/overlap 제거 뒤 3~10초 단독 발화 turn을 다시 만들고,
  독립 source prototype과 개인별 threshold·top-1/top-2 margin을 검증하는 것이다.
- speaker runtime 집중 테스트 18개와 전체 `npm run check`를 통과했다.
  전체 결과는 Vitest 139개 파일·1,638개 테스트와 enrollment CLI 9개 테스트다.
  production build와 `wrangler deploy --dry-run`도 통과했으며, App에서 runtime을
  import하지 않으므로 이번 build에는 speaker Worker chunk나 97MB 모델이 포함되지
  않았다. 실제 voice adapter를 켤 때만 모델을 지연 다운로드해야 한다.

### Groq secret 상태

- 사용자가 제공한 Groq credential은 Cloudflare Worker secret
  `GROQ_API_KEY`로만 등록했고, 이름 존재를 `wrangler secret list`로 확인했다.
  값은 Git, Pages bundle, 문서, 로그, 브라우저 저장소에 기록하지 않았다.
- production 기본 전사는 계속 `BROADCAST_TRANSCRIPT_PROVIDER=qwen`이다. secret이
  있다는 이유만으로 Groq를 자동 선택하거나 Qwen 실패를 Groq 호출로 넘기지 않는다.

## 2026-07-29 Groq Whisper Large V3 Turbo 선택형 전사 경로 준비

### 구현

- 기존 Qwen/Gemini 전사 결과 계약을 유지한 채 provider catalog에 `groq`를 추가했다. 기본 `BROADCAST_TRANSCRIPT_PROVIDER=qwen`과 Qwen→Gemini fallback은 바꾸지 않았으며, Groq는 환경 변수를 명시적으로 `groq`로 선택한 경우에만 활성화된다.
- Worker secret `GROQ_API_KEY` readiness와 공식 endpoint `https://api.groq.com/openai/v1/audio/transcriptions`를 추가했다. 실제 키는 소스·테스트·설정 파일에 저장하지 않는다. 이후 운영 secret 등록은 위의 별도 기록처럼 값 비공개 상태로 완료했다.
- `free-r2` resolve는 서버가 발급한 짧은 HTTPS media capability를 Groq multipart `url`로 넘겨 Worker가 WAV/Base64 본문을 다루지 않는다. 별도 유료 `paid-direct` 호환 경로는 bounded WAV를 multipart `file`로 보낸다.
- 모델은 가격·속도 우선 비교 대상인 `whisper-large-v3-turbo`로 고정했다. 요청은 `language=ko`, `verbose_json`, segment timestamp, temperature 0이고, response는 128KiB·20,000자·512 segment 및 chunk 상대 timestamp 범위와 한국어를 검증한다. 정상 무발화만 `[대사 없음]`으로 투영한다.
- 응답 header에 실제 model ID와 `groq-whisper-large-v3-turbo-ko-segment-v1-2026-07-29` revision을 넣고 provider 오류 원문·request metadata·secret은 반환하지 않는다. `/healthz`는 transport 구성과 provider credential readiness를 서로 다른 필드로 보고한다.

### 검증과 남은 release gate

- 대상 Vitest 5개 파일 **132개 테스트 통과**. URL/file multipart, 고정 한국어·timestamp 설정, malformed/non-Korean/범위 밖 응답 거부, 무발화, free-R2 cleanup, paid-direct, 401 redaction, health readiness와 기존 Qwen fallback 불변을 포함한다.
- 대상 TypeScript 파일 ESLint warning 0. 전체 TypeScript는 같은 worktree의 병행 `App.tsx` 변경 오류 때문에 별도로 최종 재검증해야 하며, 이번 변경 파일에서는 오류가 보고되지 않았다.
- Groq 활성화 전 Pages cache fence가 서버가 반환한 model revision을 사용하도록 확인해야 한다. provider live smoke, 기본 route 전환, commit·push·배포는 수행하지 않았다.

## 2026-07-29 자막 없는 의미 refinement 전사 per-fragment checkpoint

### 저장 계약과 복구 경계

- `BroadcastRefinementTranscriptCheckpoint`는 refinement input signature와
  canonical 정렬된 `chunkId + sourceStartMs + sourceEndMs + kind` 계획 전체를
  함께 고정한다. 성공한 `BroadcastTranscriptQwenResult`는 같은 chunk의 정확한
  source range일 때만 저장되고, `no-audio | no-speech`는 해결된 abstention으로,
  미해결 사유는 attempt count와 함께 별도 gap으로 남는다.
- checkpoint JSON은 exact-key validator와 canonical serializer를 통과해야 하며
  2MiB UTF-8 상한을 갖는다. 추가 필드, 중복 settlement, 계획 밖 chunk, 범위가
  이동한 결과, 비정규 JSON, signature 불일치는 모두 복구 자료로 인정하지 않는다.
- `BroadcastContextSession` schema를 `1.7.0`으로 올리고
  `refinementTranscriptInputSignature + refinementTranscriptCheckpointJson`
  nullable pair를 추가했다. `1.6.0`은 두 필드를 `null`로 migration한다.
  parent context invalidate/commit은 pair를 지우고, 동일 context input의
  phase-ledger checkpoint만 보존한다.
- `checkpointBroadcastContextSessionRefinementTranscriptIfUnchanged`는 직전 session
  snapshot이 정확할 때만 per-fragment checkpoint를 교체한다. checkpoint evidence가
  달라지면 파생 semantic candidate pair도 같은 replacement에서 지우고, 완전히
  동일한 checkpoint의 timestamp 갱신만 기존 파생 결과를 보존한다.

### 검증

- checkpoint contract, session migration/lifecycle, in-memory CAS,
  durable context fixture를 포함한 **4개 파일 81개 테스트 통과**
- 대상 ESLint warning 0, 전체 TypeScript 통과
- commit·push·배포하지 않았다.

## 2026-07-29 맥락 전 6인 등장인물 grounding 계획·완료 gate

### 실제 순서와 순환 제거

- 현재 앱은 전체 대사 지도 뒤 `BroadcastParticipantGrounding`을 만들지만,
  visual/voice output을 전달하지 않는다. 따라서 맥락 전에는 채널 prior와 대사
  이름 언급만 있고, 실제 4-frame 인물 판정은 맥락 뒤 Candidate Pass B에서만
  발생한다. 새 순수 계약은 이를 `방송 단위 pre-context grounding`과 `후보 단위
post-context confirmation`으로 분리한다.
- `BroadcastParticipantGroundingPlan`은 source fingerprint·12시간 상한·transcript
  seal·roster/catalog·sampling revision을 하나의 source fence로 묶고,
  transcript/visual/voice adapter마다 model/reference manifest fence와 정확한
  source-time cell을 고정한다.
- enabled adapter의 모든 cell은 modality에 맞는 terminal이어야 한다.
  transcript-name은 `identified | none`, visual은
  `identified | none | unidentified`, voice는
  `identified | unidentified | no-speech`만 허용한다. `retryable`과
  `outcome-unknown`, receipt 누락은 서로 별도로 집계하고 하나라도 남으면
  seal을 거부한다. 인물 없음·무발화·미식별은 정상 결과이며 복구용 gap이 아니다.

### 참조 자료와 재사용 경계

- visual/voice 참조 manifest가 없거나 닫힌 source roster 전원을 덮지 못하면
  adapter는 `no-verified-reference-manifest` unavailable terminal이 되고 cell을
  실행하지 않는다. 이 상태는 전체 맥락을 막지 않지만 인물 이름을 만들지도
  않는다.
- voice plan은 `ParticipantVoiceEnrollmentManifest`를 직접 정규화하고 eligible
  asset만 계산한다. `consent=unknown`, human verification pending, overlap/music
  포함인 현재 6개 후보 FLAC은 hash fence에는 남지만 covered participant가 0인
  unavailable adapter가 되며 자동 speaker prototype으로 승격되지 않는다.
- 각 cell은 source fingerprint·범위·16k mono audio 또는 서로 다른 JPEG 4장의
  정확한 timestamp로 bundle reuse key를 만든다. Candidate Pass B가 같은 key를
  만들 때만 pre-context decode/frame bundle을 재사용할 수 있다.
- range 설명 helper도 실제 `no-visible-participant`,
  `visible-participant-unidentified`, `speaker-unidentified`, `no-speech`
  evidence를 숨기지 않고 “인물 없음/미식별/무발화”로 서술한다. 완료된 media
  검토를 더 이상 “식별을 수행하지 않음”으로 잘못 표시하지 않는다.

### 검증

- 새 순수 계획·gate 및 기존 grounding/enrollment 집중 테스트:
  **3개 파일, 30개 테스트 통과**
- 새 계획 모듈 독립 strict TypeScript, 전체 TypeScript, 대상 ESLint warning 0,
  `git diff --check` 통과
- commit·push·배포하지 않았다.

## 2026-07-29 개발자 전용 6인 음성 enrollment 후보 추출 도구

### 상태·안전 경계

- 이 도구는 Pages 앱이나 공개 `public/` 자산 경로에 들어가지 않는 Node CLI다.
  상태는 `recipe validated → current playback fetched → bounded playlists built →
FLAC staged → hashes verified → pending manifest staged → directory renamed` 순서로만
  진행한다. 중간 실패·SIGINT·SIGTERM이면 signed HLS URL이 든 OS 임시
  mini-playlist와 staging 디렉터리를 삭제하고, 완전한 package만 마지막 directory
  rename으로 공개한다.
- recipe schema는 CHZZK replay `13996057`, 공식 replay locator, 고정 6인 ID,
  2~60초 범위, 고정 safety acknowledgement를 exact-key로 검증한다. 다른 video
  number, 임의 media URL, 중복 범위, 추가 필드는 거부한다.
- 생성 manifest는 `ParticipantVoiceEnrollmentManifest`의 metadata-only 계약만
  사용한다. 모든 asset은 `consent=unknown`, `humanVerification=pending`,
  `containsOverlappingSpeech=true`, `containsMusic=true`,
  `embeddingModelRevision=speaker-embedding:unassigned`로 고정되어 자동 eligible이
  될 수 없다. sample의 여섯 구간은 현재 맥락에서 지정한 후보일 뿐 화자·단독
  발화·동의가 검증됐다고 표시하지 않는다.

### bounded HLS·ffmpeg 처리

- 매 실행마다 고정 CHZZK metadata endpoint에서 현재 `liveRewindPlaybackJson`을
  메모리에서만 읽고, HLS master의 `BANDWIDTH`가 가장 낮은 variant를 고른다.
  metadata/master/media playlist는 각자 byte 상한과 timeout을 적용하며 signed
  URL은 로그·manifest·repository에 기록하지 않는다.
- 전체 variant URL을 ffmpeg에 넘기지 않는다. source range와 겹치는 2초 segment,
  필요한 `EXT-X-MAP`·`EXT-X-KEY`·discontinuity tag만 절대 URL로 만든 임시
  mini-playlist에 넣는다. ffmpeg는 그 playlist의 시작점부터 최대 한 segment
  이내 offset만 decode해 16 kHz mono FLAC을 만든다.
- CDN은 실행 중 `*.akamaized.net`과 `*.navercdn.com` 사이에서 달라질 수 있음을
  실측했다. 고정 HTTPS suffix allowlist와 playlist별 same-origin 검증을 함께
  사용한다. 첫 스모크에서 local playlist input 앞의 ffmpeg `user_agent` option이
  file protocol에 적용되어 거부된 문제는 signed segment가 별도 header 없이
  접근 가능한 것을 확인한 뒤 제거했다.

### sample·실측·검증

- pending recipe: 세라 교수님 `02:30–03:00`, 토로리 코코 `09:20–09:50`,
  세나 아르벨 `12:30–13:00`, 망징이 `15:50–16:20`, 유레카 `27:00–27:30`,
  아모레또 `53:53–54:25`.
- 실제 current HLS 최저 variant는 `256x144 / 192000bps`였고, 앞의 다섯 후보는
  각각 15개 segment, 마지막 32초 후보는 17개 segment만 요청했다. 여섯 FLAC은
  모두 `flac / 16000Hz / mono`, 29.995~32.000초였으며 manifest SHA-256과 실제
  파일 hash가 모두 일치했다.
- 실제 산출물은 repository 밖
  `Codex/artifacts/voice-enrollment-candidates/chzzk-video-13996057-pending-candidates-v1`
  에 두었고, `ParticipantVoiceEnrollmentManifest` normalizer 통과,
  eligible asset `0`, 임시 playlist 잔존 `0`을 확인했다.
- Node pure-helper 테스트는 recipe fence·range·CLI, lowest-bandwidth 선택,
  cross-origin 거부, time-zero segment를 제외한 mini-playlist, pending manifest
  불변식, `public/` 출력 선거부, signed URL 오류 redaction 8건을 통과했다.
  graphify는 공유 작업공간의
  변경된 문서 93개를 처리할 semantic backend가 없어 첫 update가 중단됐고,
  `--code-only` incremental update로 새 CLI·helper AST를 반영했다.
  commit·push·배포하지 않았다.

## 2026-07-28 다음 배포 후보 · 6인 등장인물 근거와 맥락 commit 봉인

### 이전 구조에서 확인한 문제

- 개인 채널 roster가 채널 주인 한 명만 남겨 합방 게스트 네 명을 인식 후보에서 제외했다. 반대로 닫힌 명단과 채널 주인 정보는 실제 화면 등장·발화 증거처럼 프롬프트에 전달될 수 있었다.
- 전체 맥락 전에 있는 인물 정보는 “아직 확인하지 못함”뿐이었고, 실제 화면·목소리 근거를 나중에 추가하더라도 기존 evidence union과 exact factory validator가 이를 거부하는 구조였다.
- 이름 경계에서 `코코아`를 `코코` 호명으로 오인할 수 있었고, 출처를 모르는 방송의 일반 호칭 `교수님`도 세라 교수님 근거로 잘못 승격할 수 있었다.
- whole-context operation identity에 언어·후보·인물 패킷이 빠져 입력이 바뀐 뒤에도 이전 요청이 살아남을 수 있었다. 새 grounding 저장은 과거 context/refinement를 함께 지우지 않아 호출 실패 후 “새 근거 + 옛 결과”가 복원될 수 있었다.
- context commit은 마지막 read 뒤 일반 put을 사용해, 그 사이 transcript/session이 바뀌면 늦은 유료 응답이 새 checkpoint를 덮어쓸 수 있었다. 복구도 당시 exact context input과 transcript seal을 재검증하지 않았다.

### 반영한 계약

- 안정적인 6인 ID 카탈로그를 만들었다. 교환학생 메인 채널은 세라 교수님을 host prior로 6명을 허용하고, 개인 채널은 채널 주인을 host prior로 두되 세라를 제외한 다섯 멤버를 허용한다. 출처 불명은 6인 canonical 이름만 유지하고 일반 별칭을 근거로 쓰지 않는다.
- `BroadcastParticipantGrounding`은 source prior, 대사 이름 언급, 실제 화면·목소리 관측을 서로 다른 evidence kind로 보존한다. visual/voice adapter는 식별, 인물 있음-미확인, 인물 없음, 화자 미확인, 무발화를 terminal 결과로 기록할 수 있다. 현재 검증된 reference manifest가 없으므로 두 media adapter는 정직하게 `unavailable`이며 source prior만으로 인명을 확정하지 않는다.
- 긴 방송의 145개 이상 챕터를 144개로 줄일 때 transcript-name projection은 bounded map에서 다시 만들되 이미 확인된 media evidence와 adapter receipt는 그대로 재결합한다.
- whole-context operation key는 exact input snapshot 전체를 포함한다. effect가 바뀌면 이전 controller를 abort하고, 모든 await와 durable write 전후에 현재 controller/key를 다시 확인한다.
- session schema `1.5.0`은 source roster, transcript seal, grounding pair, whole-context exact input JSON을 저장한다. grounding이 바뀌면 이전 context/refinement를 같은 write에서 null로 지운다.
- context와 refinement 결과는 직전에 읽은 session과 byte-equivalent일 때만 한 IndexedDB readwrite transaction에서 교체하는 compare-and-swap으로 commit한다. 복구 시 transcript seal, catalog version, grounding JSON, exact context input의 fingerprint를 다시 계산하며 하나라도 다르면 과거 유료 자료는 보존하되 완료 결과로 표시하지 않는다.
- participant checkpoint는 UTF-16 글자 수가 아니라 UTF-8 byte로 64KiB를 제한하고, whole-context input checkpoint는 Worker의 8MiB ingress 상한과 맞춘다.

### 현재 경계

- 다섯 UI 초상은 인식용으로 검증된 reference asset이 아니며 세라 이미지와 6인 음성 enrollment가 아직 없다. 따라서 이번 변경은 실제 media adapter가 안전하게 들어갈 데이터·저장·프롬프트·복구 경로를 완성한 것이고, 화면/음성 식별 자체를 완료했다고 표시하지 않는다.
- 다음 구현 단위는 후보별 서로 다른 화면 4장을 전체 맥락 전에 준비해 visual adapter를 실행하고, VAD→diarization→검증된 speaker embedding 순서로 voice adapter를 연결하는 것이다.

### 검증 결과

- 인물 이름 경계·unknown-source alias·실제 visual evidence 보존·144챕터 rebase·프롬프트·session migration/UTF-8 상한·메모리/IndexedDB compare-and-swap 집중 회귀를 추가했다.
- `npm run check`: TypeScript strict, ESLint warning 0, **118개 테스트 파일·1,374개 테스트 통과**
- `npm run build`: Vite production build 통과, 205개 모듈 변환 완료
- `git diff --check`: 공백 오류 없음
- 이 변경은 아직 commit, push, 배포하지 않았다.

## 2026-07-28 `0.8.7` 배포 후보 · 실패 전사 조각 선복구와 맥락 봉인

### 확인한 원인

- 전사 Worker는 일부 조각이 CORS처럼 보이는 CPU/네트워크 오류, 429, 디코드·공급자 실패로 끝나도 성공 조각과 gap을 함께 반환했다. App은 이를 `completedWithGaps`로 닫고 whole-context가 불완전한 대사 지도를 사용할 수 있었다.
- 빠른 탐색 완료 렌더에서는 과거 uniform 전사 완료 상태가 남아 있는 동안 whole-context effect가 event-boost 전사보다 먼저 실행될 수 있었다. 맥락 입력에 최종 전사 operation seal이 없어, 이후 전사가 보강돼도 이전 맥락 요청을 현재 결과로 오인할 여지가 있었다.
- 저장 checkpoint는 gap ID만 가져 실패한 원본 범위·원인·시도 횟수를 복구하지 못했다. 디코더 예외도 실제 무음과 같은 `no-audio`로 기록했고, 네트워크 결과 불명은 안전한 재시도와 중복 과금 위험을 구분하지 못했다.

### 수정한 복구 계약

- `recoverBroadcastTranscriptFragments`가 한 transcript phase 안에서 성공 조각을 누적하고 `decode-failed | transcription-failed | rate-limited` 조각만 1초·2초 backoff로 최대 3회 시도한다. 조각 A·C가 성공하고 B만 실패하면 이후 Worker에는 B만 들어간다.
- 정상 디코딩 뒤 분석 가능한 발화가 없는 `no-audio`는 source-fenced 부정 근거 chapter로 저장한다. 디코드 예외는 `decode-failed`로 분리해 자동 복구 대상이 된다.
- 부분 성공은 매 조각마다 chapter와 아직 남은 정확한 범위를 IndexedDB에 직렬 checkpoint하고 즉시 readback한다. write/readback 실패는 유료 결과를 완료로 취급하지 않으며 다음 phase를 차단한다.
- 저장 schema `1.3.0`은 실패 조각의 `chunkId/start/end/reason/attemptCount`를 보존하고 `1.2.0` 기록을 migration한다. chunk ID는 배열 번호가 아니라 source start/end에서 결정되므로 missing-only 계획을 다시 만들어도 같은 범위를 식별한다.
- 자동 재시도와 편집자 재시도의 quota generation을 서로 겹치지 않게 분리했다. lease 뒤 연결이 끊기면 같은 lease·operation transport를 한 번 replay하고, 이미 consume됐을 수 있는 409 또는 반복 단절은 `outcome-unknown`으로 보존해 새 유료 operation을 몰래 만들지 않는다.
- quota fragment ID에는 uniform/event-boost/refinement namespace를 넣고, 저장된 마지막 attempt ordinal보다 뒤의 generation을 계산한다. 새로고침으로 React state ordinal이 0으로 돌아가도 과거 terminal operation ID를 재사용하지 않는다.
- provider 호출 전에 대상 조각을 `in-flight`로 write/readback하고, 각 gap event를 받는 즉시 정확한 사유와 ordinal로 같은 직렬 queue에 저장한다. `in-flight | outcome-unknown` checkpoint를 다시 연 실행은 자동 재결제하지 않는다.
- Free R2 media는 명시적 rate-limit, limiter 일시 장애, provider 결과 불명에서 삭제하지 않는다. 성공·확정 실패 뒤에만 삭제하며 orphan은 기존 1일 lifecycle이 정리한다.
- whole-context는 최종 event-boost operation key와 transcript seal이 같고, 상태가 `completed`, chapter가 1개 이상이며, 저장 readback이 정확히 일치할 때만 시작한다. 맥락 응답 저장 직전에도 현재 저장 chapter의 compact 결과가 실제 요청 입력과 같은지 확인해 늦은 결과를 거부한다.
- 재시도 가능한 조각을 3회 안에 복구하지 못하거나 outcome-unknown이 남으면 transcript는 `failed`, seal은 비어 있고 whole-context 요청은 시작하지 않는다. 확보한 성공 chapter와 실패 범위는 그대로 남아 명시적 missing-only 복구가 가능하다.

### Candidate Free R2 실서비스 결함과 수정

- 첫 운영 stage의 `503 CANDIDATE_MEDIA_UNAVAILABLE`는 후보 bundle의 byte-counting `TransformStream`이 HTTP의 known length를 잃어 R2 `put`이 generic chunked stream을 거부한 것이 원인이었다. counted stream을 Cloudflare `FixedLengthStream(expectedByteLength)`에 연결해 R2에는 exact-length readable만 넘기고, checksum·크기·WAV/JPEG signature 검증은 그대로 유지했다.
- 같은 payload를 다시 stage하면 기존 R2 object와 ticket을 재사용하면서 새 request body는 아무도 읽지 않았다. Worker는 이미 `request body -> counting transform -> FixedLengthStream` pump를 시작했으므로 backpressure가 풀리지 않아 두 번째 stage가 끝나지 않았다.
- stage 결과에 `stored | reused` disposition을 넣고 pump를 `AbortController`와 연결했다. 정상 저장은 전체 completion을 기다리며, 기존 object 재사용·manifest conflict·conditional PUT loser는 JS drain 없이 pump abort와 readable cancel로 unused body를 terminal 정리한다. completion rejection은 생성 즉시 관찰하고, 의도적 discard만 삼키며 초과·미달은 계속 413·400으로 실패한다.
- Qwen이 HTTP 200과 완전한 SSE를 보냈지만 strict candidate schema를 한 번 어기는 경우가 실서비스에서 두 차례 확인됐다. Free R2는 Gemini inline fallback을 만들지 않고, 같은 staged media에 대해 fresh internal quota operation으로 schema 검증을 최대 두 번 다시 시도한다. 세 번 모두 invalid이면 object와 정확한 ticket을 10분 동안 보존해 상위 missing-only 복구가 재업로드 없이 이어지며 1일 R2 lifecycle이 orphan을 정리한다.

### 검증 결과

- 실패 조각 복구·quota·Worker protocol·저장 migration·R2 보존·phase seal 집중 회귀: **10개 파일·132개 테스트 통과**
- Candidate ingress 집중 회귀는 정상 FixedLength handoff, 동일 stage 재사용, manifest conflict, body를 읽지 않는 conditional PUT race, invalid-schema fresh quota 복구와 exhausted-media 보존을 포함한다.
- `npm run check`: TypeScript strict, ESLint warning 0, **117개 테스트 파일·1,353개 테스트 통과**
- `npm run build`: Vite production build 통과, 204개 모듈 변환 완료
- `wrangler deploy --dry-run`: 통과, Durable Object·private R2·rate limiter·`free-r2`·quota required binding 확인
- Worker version `c2ac9e0c-8213-4580-95ef-eedb75d20ef5`에서 음식 토크 21:00의 실제 10초 후보가 `stage 202 -> identical stage 202 -> resolve 200 -> cleanup 404`를 통과했고 두 stage의 ticket이 같았다. 모델은 `qwen3.5-omni-flash`, 한국어 candidate insight가 반환됐다.
- 같은 Worker의 음식 토크 21:00~22:30 실제 90초 raw 전사는 HTTP 200, `qwen3.5-omni-flash`, 언어 `ko`와 source fence 1,260,000~1,350,000ms를 반환했다. quota-backed broadcast context는 HTTP 200, `qwen3.7-plus`, 한국어 요약 268자와 후보 주석 1개를 반환했다. 두 경로 모두 CORS·429·502가 없었다.
- `git diff --check`와 전체 공개 Pages 검증은 `main` push 전후의 마지막 release gate다. Worker-first 호환 배포는 완료했지만 이 기록 시점의 Pages는 아직 이전 버전이다.

## 2026-07-27 파이프라인 정상화 후보 · 최종 검증

### 검증 결과

- `npm run check`: TypeScript strict, ESLint warning 0, **116개 테스트 파일·1,327개 테스트 통과**
- `npm run build`: Vite production build 통과, 203개 모듈 변환 완료
- `wrangler deploy --dry-run`: 통과, Worker 435.29KiB(gzip 81.23KiB)와 Durable Object·R2·rate limiter·Free R2 transport binding 확인
- 최대 다국어 candidate context는 48KiB canonical packet과 80KiB shared prompt 경계 안에서 실제 provider 실행까지 진행하고, Qwen·Gemini·quota·receipt가 동일 packet과 fingerprint를 사용하는 회귀 테스트를 통과했다.
- 구형·부분 insight와 durable ID를 생략한 비정형 호출자가 completion으로 승격되지 않고 AI 재실행 대상으로 남는 검증, `Content-Length`가 없는 candidate bundle의 streaming exact-byte 차단 테스트를 통과했다.
- 후보 R2 미디어 경로 보안 감사: **SHIP**
- 최종 후보 정상화 독립 재감사: **SHIP**
- `git diff --check`: 통과, 삭제 파일 0개, staging 0개, 변경 diff의 credential pattern 0개

### 배포 상태

- 이 항목은 `0.8.7` 릴리스에 함께 포함하는 파이프라인 정상화 변경이다.
- 사용자 배포 승인 뒤 패키지와 공개 화면 버전을 `0.8.7`로 올렸다. Worker-first 호환 배포와 Pages smoke를 모두 통과해야 릴리스를 완료로 기록한다.
- 새 Candidate Free R2 경로의 실서비스 스모크는 Worker 배포 뒤에 실행한다.

## 2026-07-27 다음 배포 후보 · 최종 후보 파이프라인 정상화

### 확인한 원인

- 음식 토크 실행의 canonical ledger에는 후보 17개가 있었지만, 전체 맥락 입력도 후보 상세 분석과 같은 12개 상한으로 잘려 있었다. 그래서 나머지 5개는 AI가 거부한 후보가 아니라 애초에 맥락을 전달받지 못한 `context-missing` 상태였다.
- 후보 상세 분석은 여러 후보를 한 run으로 묶으면서 후보 하나의 화면 추출·중계·AI 오류가 run 전체의 `failed` envelope로 번졌다. 앞에서 완료해 저장한 insight와 receipt가 있어도 화면은 envelope 실패를 우선해 최종 후보 0개로 표시했고, 재시도는 이미 결제한 후보까지 다시 요청할 수 있었다.
- 최종 0개는 두 의미를 섞고 있었다. 모든 근거를 검토한 뒤 AI가 전부 제외한 정상 음성 결과와, 맥락·화면·오디오·receipt 중 일부가 빠져 판단 자체를 끝내지 못한 결과가 모두 “분석 미완료”로 보였다.

### 수정한 데이터 계약

- `selectBroadcastContextCandidateCohort`는 전체 맥락 protocol의 실제 상한 32개를 사용한다. 비용이 큰 candidate detail은 계속 최대 12개로 제한하되, 전체 맥락 판정 뒤 승인 우선·점수·시간순으로 별도 cohort를 만든다. 17개 원장을 12개 유료 실행 상한과 혼동하지 않는다.
- 저장된 whole-context envelope `1.2.0`은 실제로 보낸 `contextCandidateIds`를 함께 기록하고 readback 때 순서까지 검증한다. 구형 결과는 annotation에서 당시 cohort를 복구할 수 있지만, 새 결과는 추측으로 첫 12개를 붙이지 않는다.
- candidate detail은 공용 frame producer와 최대 두 개 consumer를 사용하되 후보별로 독립 정산한다. 네 JPEG와 대표 thumbnail이 준비된 후보만 AI에 들어가며, 한 후보의 실패는 `CANDIDATE_FAILED`가 되고 나머지 후보는 계속 실행된다.
- 저장된 context packet, insight, provider identity, 네 화면, thumbnail과 `CandidatePassBVerificationReceipt`가 현재 context fingerprint에 모두 맞는 항목만 final projection에 들어간다. 실패·취소 envelope보다 검증된 durable artifact를 우선하며, 재시도는 artifact가 빠진 candidate ID만 선택한다.
- candidate insight snapshot은 IndexedDB write 직후 같은 run ID로 readback하여 metadata·evidence·insight·model·thumbnail·receipt 전체가 exact match할 때만 durable로 승격한다. 실패한 write/readback은 `RUN_COMPLETED`와 `deepPass/publication/completed`를 막고 provider 재호출 없는 저장 재시도로 복구한다.
- whole-context 거부, 음악·오프닝·엔딩·평범한 진행, 상세 AI의 비추천은 “판단 완료 후 제외”다. `context-missing`, `detail-result-missing`, `verification-receipt-missing`, `evidence-incomplete`만 pipeline gap이며 이 경우에만 완료를 막고 구체적인 재시도 대상을 남긴다.
- 완전 검증 결과가 0개면 `AnalysisJob.completedEmpty`로 정상 종료한다. pipeline gap으로 판단하지 못한 0개는 running/failed 상태를 유지하므로 저장 이력과 복구 목록에서도 두 의미가 다시 섞이지 않는다.
- 오류 복구 화면이 보인다는 사실은 stage commit이 아니다. whole-context 실패는 `broadcastContext`를, detail gap은 `deepPass/publication`을 완료한 것으로 기록하지 않으며, reload resume cursor는 readback까지 끝난 gap-free artifact까지만 전진한다.

### Free Worker 후보 미디어 경로

- 후보의 PCM16 WAV와 JPEG 4장은 하나의 bounded binary bundle로 브라우저 Worker에서 만든 뒤 private R2에 한 번 staged한다. Cloudflare Worker는 Base64 후보 JSON을 다시 조립하지 않고, HMAC ticket으로 제한된 audio/frame URL을 Qwen 3.5 Omni에 전달한다.
- quota payload digest, participant, run, candidate hash, duration, audio length와 frame timestamp/length manifest를 ticket과 R2 metadata에 함께 묶는다. native SHA-256, exact byte length, content type과 canonical WAV header가 모두 맞아야 provider 실행으로 넘어간다.
- 전체 방송 자료는 바꾸지 않고 candidate-specific context만 48KiB canonical packet으로 구성한다. 후보 대사는 protocol 최대 길이를 우선 보존하고, 다른 필드는 중요도별 byte 예산과 `[중간 생략 / middle omitted]` marker로 앞·뒤를 보존한다. receipt와 provider는 이 동일 packet을 사용하며, 최대 한국어·영어 입력도 80KiB shared prompt 안에 들어가므로 정상 후보가 413으로 중단되지 않는다. 네 화면·60초 후보의 최대 예약은 94,180 token으로 100,000 TPM 단일 요청 경계보다 작다.
- 새 Pages는 `/healthz` 결과를 60초 single-flight cache로 확인해 `free-r2 | paid-direct | legacy`를 고른다. 신 Worker는 한 배포 주기 동안 구 Pages의 bounded JSON 후보 요청도 받으며, 신 Pages가 구 Worker를 만나면 `legacy`로 안전하게 동작한다.
- Free R2 후보 경로는 URL media를 직접 읽는 Qwen 전용이다. Worker가 R2 bytes를 다시 읽어 Gemini inline-data로 만드는 fallback은 Free CPU 경계를 되살리므로 사용하지 않는다. `paid-direct`의 기존 bounded Qwen→Gemini fallback은 유지한다.

## 2026-07-27 `0.8.6` Free R2 전사 transport 착수

- 사용자는 무료 Cloudflare 범위 안에서 먼저 안정화하되, 유료 전환 시 구조를 다시 만들지 않도록 내부 전환점을 준비하는 방향을 선택했다.
- 공식 문서 기준 Workers Free는 요청당 CPU 10ms·일 100,000 요청이고, R2 Standard 무료분은 10GB-month·Class A 100만·Class B 1,000만이다. R2 binding은 `ReadableStream` put과 native SHA-256 검증, range get을 지원하고 Qwen 3.5 Omni는 HTTPS audio URL 입력을 지원한다.
- 구현 계약은 browser raw WAV 90초 하나로 통일한다. `free-r2`는 JS body read 없이 R2 stream put→native checksum→44-byte range validation→Qwen media URL, `paid-direct`는 같은 request를 기존 in-memory provider body로 처리한다. transport mode는 Worker 환경변수 하나이며 quota/result/context 계약은 공유한다.
- Free 실행은 CPU가 큰 upload와 provider control을 서로 다른 Worker invocation으로 분리했다. 첫 요청은 native R2 put 뒤 202 ticket을 반환하고 두 번째 요청은 작은 resolve JSON만 읽는다. 429 재시도는 새 operation ID와 lease를 쓰되 같은 ticket을 재사용해 raw WAV 업로드는 한 번으로 고정했다.
- ticket HMAC binding에서 operation ID와 lease token은 제외하고 participant/run/raw digest/source fence/byte length를 포함했다. 그래서 재시도는 허용되지만 다른 사용자·분석·오디오·시간 범위로의 ticket 재사용은 거부된다.
- private R2 object는 provider terminal 뒤 즉시 삭제하고 수분 단위 capability expiry와 1일 lifecycle을 이중 정리 경계로 둔다. Durable Object에는 media bytes나 URL을 넣지 않는다.

### 구현·회귀 검증

- 브라우저는 transport를 묻지 않고 항상 최대 90초 raw WAV 하나만 보낸다. Free 응답이 HTTP 202이면 같은 quota lease의 작은 resolve 요청으로 이어지고, Paid 응답이 HTTP 200이면 즉시 완료한다. resolve가 local/provider 429를 받으면 새 operation과 lease를 발급하되 같은 media ticket을 사용하므로 WAV upload는 한 번뿐이다.
- `free-r2`에서는 legacy JSON/Base64를 body read 전에 HTTP 426으로 거부한다. Qwen에는 HTTPS media URL만 전달하며, Worker가 다시 media bytes를 읽어 Gemini inline-data로 만드는 fallback은 사용하지 않는다. `paid-direct` fixture는 기존 Qwen→Gemini bounded fallback을 계속 검증한다.
- media capability는 `GET`, `HEAD`, 단일 `Range`만 허용하며 CORS와 cache를 열지 않는다. 성공·영구 실패·결과 불명에서는 object를 즉시 지우고, local/provider 429에서만 재시도를 위해 유지한다.
- `npm run check`는 TypeScript strict, ESLint warning 0, **109개 테스트 파일·1,224개 테스트**를 통과했다. production Vite build와 Wrangler dry-run도 통과했고, dry-run에서 `TRANSCRIPT_MEDIA`, quota Durable Object, 두 rate limiter, `free-r2` 변수를 확인했다.

### 무료 자원과 실서비스 검증

- private Standard R2 bucket `exclipper-transcript-media`를 APAC에 만들고 public `r2.dev` access를 비활성화했다. `transcript/` prefix에는 1일 orphan lifecycle을 설정했으며, 정상 경로는 이 lifecycle을 기다리지 않고 즉시 삭제한다.
- `TRANSCRIPT_MEDIA_SIGNING_KEY`를 Worker secret으로 등록하고 `free-r2` Worker version `a16061ed-3a4c-4f38-8706-1089d6264aed`를 배포했다. `/healthz`는 protocol 5, transport 2, mode `free-r2`, configured true, primary `audio/wav`, 90,000ms, staged schema `1.0.0`, quota required, coordinator ready, 최대 참가자 5명을 보고했다.
- 음식 토크 원본 21:00 지점의 2초와 90초를 실제 Qwen 경로로 보냈다. 두 요청 모두 HTTP 200과 source fence가 맞는 한국어 전사를 반환했고, 각 완료 뒤 R2 bucket은 object 0개·0B로 돌아왔다.
- tail에서 90초 경로의 upload·media GET·resolve는 각각 CPU 약 5ms·2ms·6ms, outcome `ok`였다. 2초 경로는 약 7ms·3ms·14ms였고 모두 성공했다. 따라서 큰 media 처리 CPU가 분리된 효과는 확인했지만 모든 invocation이 항상 Free 10ms 이내라고 단정하지 않는다. 2초 resolve의 14ms 단발값과 장시간 연속 실행의 `exceededCpu`, gap, orphan 수를 후속 관찰한다.
- Cloudflare 인프라는 무료 경계 안에서만 구성했다. 다만 Qwen API 호출 비용은 기존과 동일하며 Cloudflare 무료 범위와 별개다. 유료 전환은 계정에서 Workers Paid를 명시적으로 활성화한 뒤 `BROADCAST_TRANSCRIPT_TRANSPORT_MODE=paid-direct`로 재배포하는 config-only 절차이고, 브라우저·저장 데이터·quota 계약은 바꾸지 않는다.

## 2026-07-27 `0.8.5` 전사 CORS의 실제 원인·직접 Base64 transport

### 운영 증거와 원인

- 실제 음식 토크 분석이 약 93/271에서 진행 중일 때 운영 Worker tail을 관찰했다. 15건 중 9건은 HTTP 200, 6건은 HTTP 503 `exceededCpu`였고 모두 약 1.28MB로 크기가 같았다. quota admission은 전부 200이었으며 429·1101·공급자 거부는 관찰되지 않았다.
- 실패 요청의 예외는 `Worker exceeded CPU time limit`였다. 플랫폼이 Worker 대신 만든 503에는 `Access-Control-Allow-Origin`이 없으므로 Edge가 CORS 위반으로 표시했다. 따라서 CORS 설정이나 5인 coordinator가 1차 원인이 아니었다.
- `0.8.4`는 Base64 생성을 브라우저로 옮겼지만 Worker에 대용량 본문 결합, SHA-256, UTF-8 decode, `JSON.parse`, Base64 전체 검사 두 번, provider JSON 재직렬화를 남겼다. 동일 payload의 로컬 상대 계측에서 grouped Base64 정규식만 p95 22ms를 넘었고 전체 중앙값도 Free CPU 10ms에 닿았다.

### 구현

- 브라우저 기본 요청을 `application/vnd.exclipper.transcript-base64`로 변경했다. 본문은 Base64 ASCII만, source fence는 `startMs`와 `durationMs` 쿼리로 전달한다.
- Worker protocol 4는 두 쿼리의 중복·미지 값을 거부하고 12시간 source fence, exact encoded length·padding·문자 집합, PCM16 mono 16kHz WAV header와 duration을 검증한다. quota digest가 실제 본문과 일치하기 전에는 rate limiter와 유료 fetch를 시작하지 않는다.
- provider 본문은 작은 서버 소유 sentinel template에서 만든 prefix/suffix와 검증된 Base64 bytes를 한 번 결합한다. 모델·prompt·endpoint·max token은 클라이언트가 바꿀 수 없다. Qwen→Gemini bounded fallback도 각 provider의 고정 template을 사용한다.
- 직접 Base64 경로는 실제 계획기와 같은 최대 30초로 제한했다. 90초 Base64는 SHA·검증·provider copy만으로도 로컬 p95가 Free 10ms를 넘으므로 주 경로에서 닫았다. raw 호환 경로는 실제 body가 선언된 WAV 길이와 정확히 같아야 하며, 잘린 본문을 유료 호출로 보내지 않는다. provider용 임시 byte buffer도 fetch 종료 뒤 즉시 지운다.
- JSON과 raw WAV ingress는 Worker-first 배포 및 구버전 탭 호환용으로 유지했다. 운영 smoke script의 기본 transport는 새 `base64`이며 `--transport json|raw`를 진단용으로 선택할 수 있다.
- 적응형 동시성의 maximum 6은 유지했다. 요청 시작 시 failure-wave ID와 실제 시작 상한을 함께 캡처해 같은 파동의 여러 실패가 6→3→1로 연속 반감하지 않고, 오래 걸린 요청의 실패 상한도 나중에 오른 값으로 왜곡되지 않게 했다. 오디오 decode나 1초 pacing 도중 상한이 내려갈 수 있으므로 요청을 만드는 직전에 capacity를 다시 확인하며, 이미 진행 중인 요청이 새 상한 아래로 drain된 뒤에만 보충한다.

### 로컬 검증

- 직접 Base64와 기존 builder의 provider 요청이 byte-for-byte 동일함을 확인했다.
- quote, backslash, newline, NUL, 비ASCII, 내부 padding·비정규 pad bit, 30초 직접 상한, 중복 쿼리, 12시간 초과, 잘린 raw WAV, quota digest mismatch를 유료 fetch 전에 거부하는 테스트를 추가했다.
- 직접 Base64 lease의 `inspect -> consume -> paid fetch -> complete` 순서와 mismatch의 `inspect -> release-upload` 순서를 확인했다.
- 전사·quota·media·scheduler 회귀를 포함해 106개 파일·1,194개 전체 테스트, TypeScript typecheck, ESLint warning 0, production Vite build, Wrangler dry-run을 통과했다. 운영 271구간 tail 검증은 Worker-first 배포 승인 뒤 실제 protocol 4 경로에서 수행한다.

### Worker-first 운영 검증

- Worker version `a3cbf5c5-f7aa-43e5-b552-1c3912fbb851`를 먼저 배포했다. `/healthz`는 protocol 4, quota `required`, coordinator ready, 최대 5명, 직접 전사 media type `application/vnd.exclipper.transcript-base64`를 보고했고 Pages origin의 transcript OPTIONS는 HTTP 204와 정확한 허용 헤더를 반환했다.
- 음식 토크 21:00부터 30초를 새 직접 경로로 전송했다. 본문은 1,280,060바이트였고 HTTP 200, 올바른 한국어 전사, Worker `outcome=ok`, 예외 0건이었다. 관찰된 stateless Worker CPU는 36ms였으나 강제 종료나 헤더 없는 503은 없었다. 단일 성공만으로 장시간 안정성을 단정하지 않고 Pages 배포 뒤 271구간 tail을 최종 gate로 사용한다.

### 장시간 후속 검증과 판정 수정

- 음식 토크 전체 계획을 연속 실행한 운영 tail에는 `/v1/broadcast-transcript` 444건이 남았다. 그중 438건은 `ok`, 6건은 `exceededCpu`였고 성공 요청까지 CPU p50 29ms, p95 38ms, 최대 51ms였다. Cloudflare Workers Free의 요청당 CPU 기준은 10ms이며 드문 초과에는 유연성이 있지만 지속 초과는 종료된다. 첫 실행이 거의 완주한 것은 안전 여유의 증거가 아니라 이 유연성의 결과였다.
- 첫 전체 실행의 마지막 14.817초 조각 400은 실제 앱과 달리 진단 harness가 source fence의 마지막 한 sample을 zero-padding하지 않은 문제였다. 앱과 같은 sample 수로 고친 단독 요청은 HTTP 200이었다. 반면 수정한 두 번째 전체 실행은 약 159번째 조각부터 6건의 헤더 없는 HTTP 503을 냈고, tail 예외가 모두 `Worker exceeded CPU time limit`였으므로 제품 장애는 별개로 재현됐다.
- 14.817초의 잘못된 WAV가 provider 합성·rate limiter·quota consume·upstream 호출 전에 거부된 두 요청도 CPU 9ms와 11ms를 사용했다. 따라서 30초를 15초로 줄이거나 provider JSON 복사 약 1ms를 없애는 것만으로 Free 안정성을 보장할 수 없다. 15초는 12시간 계획의 760개 protocol 상한도 넘기고 60 RPM 완료 시간도 두 배로 늘린다.
- 현재 확정된 병목은 요청 크기나 CORS가 아니라 대용량 ingress의 반복 reader/timer, 1.28MB SHA-256, strict Base64 전체 검사, provider body 합성, quota 경계와 응답 파싱이 한 Free invocation에 겹치는 구조다. CORS 메시지는 플랫폼이 만든 CPU 503에 앱의 CORS 헤더를 붙일 기회가 없어서 나타난 2차 증상이다.
- 가장 빠른 안정 경로는 Workers Paid의 월 최소 $5 CPU 여유에서 기존 보안·quota 계약을 유지하고 90초 청크를 복원하는 것이다. 5명 동시 음식 토크의 provider 시작 하한은 30초 1,355건 약 22분 35초에서 90초 455건 약 8~9분으로 줄어든다. 새 월 비용이므로 명시적 승인 전에는 전환하지 않는다.
- Free를 유지하는 구조적 경로는 브라우저 raw WAV를 private R2에 stream upload하고 R2의 native checksum과 44바이트 range 검증을 사용한 뒤, 작은 media ticket·URL만 Qwen URL/Filetrans에 전달하는 것이다. 큰 본문 검사·해시·Base64·provider 복사를 Worker JavaScript에서 제거할 수 있지만 새 private bucket·capability URL·수명주기·비동기 ASR 상태가 필요하므로 명시적 리소스 승인과 별도 구현이 필요하다.
- 결과적으로 `0.8.5`는 0.8.4보다 CPU 작업을 크게 줄인 완화 릴리스이지만 Free 장시간 안정화 완료 릴리스는 아니다. 같은 구조를 미세 조정해 다시 성공으로 표시하지 않으며, Paid 또는 private R2 경로 중 하나를 승인받은 뒤 연속 전체 실행 2회 또는 600건 이상에서 `exceededCpu=0`, 누락 0을 확인해야 완료로 판정한다.

## 2026-07-27 `0.8.4` 맥락 502 복구 · 누락 구간 이어하기

### 실제 장애 원인

- 음식 토크 2시간 15분 분석은 전사와 빠른 탐색까지 완료했지만, `/v1/broadcast-context`가 약 389초 뒤 HTTP 502를 반환하면서 최종 후보가 0개인 미완료 화면으로 끝났다. 현재 클라이언트는 오류 JSON을 읽지 않고 모든 비정상 응답을 같은 `PROXY_REJECTED`로 바꿨으므로, 남아 있는 화면만으로 502의 하위 유형(`UPSTREAM_INVALID_RESPONSE`, `UPSTREAM_UNAVAILABLE`, `UPSTREAM_OUTCOME_UNKNOWN`, `UPSTREAM_REJECTED`)까지 단정할 수는 없다.
- 바로 뒤의 `/v1/ai-quota` 409는 502의 원인이 아니었다. Worker가 이미 lease를 소비·종료했는데 브라우저가 모든 non-2xx 뒤에 다시 `cancel`을 보내 `OPERATION_ALREADY_FINISHED`가 발생한 2차 오류였다.
- 재시도 버튼도 실제로는 같은 operation ID를 다시 사용했다. coordinator가 terminal operation을 6시간 보존하므로, 맥락·전사·후보 상세 검토 모두 같은 입력의 재시도가 409로 차단될 수 있었다.
- 전사의 `completedWithGaps`는 재시도 대상으로 취급되지 않았다. 따라서 약 190번째 구간에서 발생한 8개 CORS/network gap은 성공한 챕터와 함께 저장되기는 했지만 같은 실행의 버튼으로 메워지지 않았다.

### 수정한 데이터 흐름

- paid endpoint가 HTTP 응답을 반환한 뒤에는 브라우저가 quota `cancel`을 보내지 않는다. 대기열에서 사용자가 중단한 경우의 `lease → cancel`만 유지한다. 구버전 브라우저가 이미 끝난 operation을 `cancel`하더라도 Worker는 이를 멱등 정리로 보고 HTTP 200을 반환한다. 같은 terminal operation으로 새 `lease`를 요청한 경우에는 계속 409를 반환해 중복 유료 실행을 막는다.
- 맥락 오류 본문은 최대 2KB까지만 읽고 안전한 `error.code`, HTTP status, allowlist 진단 헤더만 보존한다. 공급자 원문은 UI나 로그 객체에 넣지 않으며, 오류 유형별 한국어 안내에 저장된 대사·탐색 자료의 보존 여부를 명시한다.
- 편집자가 누른 명시적 재시도마다 맥락·전사·후보 상세 검토의 attempt ordinal을 올린다. 자동 재전송이나 매 렌더 nonce는 쓰지 않는다. 같은 attempt는 멱등성을 유지하고, 새 attempt만 새 quota operation ID를 사용한다.
- `completedWithGaps` 전사도 다시 연다. 이미 저장된 챕터 범위를 sampling window에서 빼고 남은 30초 구간만 화면 디코딩·전사 큐로 보낸다. 성공 구간은 재과금하지 않는다.
- 전사 WAV의 Base64 변환을 Cloudflare Worker에서 전용 브라우저 Web Worker로 옮겼다. 30초 PCM WAV 약 0.96MB가 wire에서는 약 1.28MB로 늘지만 UI thread를 막지 않으며, Cloudflare Free Worker가 요청마다 하던 byte-to-Base64 변환을 제거한다. 중계는 전체 오디오를 디코드하지 않고 Base64 길이·문자 집합·선행 44바이트 WAV 헤더만 검사한다. raw WAV endpoint는 구버전 탭과 진단용 호환 경로로 유지한다.
- 전사 요청은 1초 슬롯을 기다린 **뒤에** quota lease와 POST를 시작한다. 브라우저별 동시성 상한도 배포 전체 Qwen in-flight 상한과 같은 6으로 맞추고, Base64를 만든 직후 원본 WAV buffer를 비워 요청 종료까지 중복 보유하지 않는다.
- 전체 맥락 overview와 분산 discovery는 모두 정산될 때까지 관찰한다. overview가 실패해도 성공한 discovery slice를 메모리 checkpoint에 보존하고, 같은 화면에서 재시도하면 실패한 slice와 overview만 새로 요청한다.
- 최신 브라우저가 이미 144개 이하로 압축하지만, 오래 열린 탭도 안전하도록 Worker는 최대 760개 원본 chapter의 ID·시간·evidence mode·coverage를 먼저 엄격히 검증하고, 검증을 통과한 입력만 144개 이하로 압축한다.
- Qwen이 정상 JSON 안에 드문 한자 표기를 섞었을 때 유료 응답 전체를 폐기하지 않고 해당 문자열 조각만 선택 언어에 맞는 표기로 치환한다. 한국어 세션은 `한글 표기 미확인`, 영어 세션은 `wording not verified`를 쓰며 나머지 방송 흐름·후보 판정·주제 구간은 그대로 검증한다.
- 전체 맥락을 다시 열면 과거 의미 후보·후보 상세 판정·대표 화면 receipt를 먼저 무효화한다. 새 receipt `1.1.0`은 후보에게 실제 전달된 전체 맥락 packet의 64-bit 콘텐츠 지문을 포함하며, 현재 packet과 지문이 다른 과거 유료 판정은 최종 후보에도 자동 처리 완료 목록에도 들어가지 않고 해당 후보만 다시 검증한다.

### 회귀 기준

- context 502 뒤 quota 호출은 `lease → paid request`에서 끝나며 후속 cancel/409가 없다.
- 대기 중 abort는 기존대로 `lease → cancel`이다.
- `completedWithGaps`와 실패 상태는 새 generation으로 재개하고, 완료된 전사는 재개하지 않는다.
- 145개 이상을 보내는 구버전 context 요청도 Worker에서 144개로 압축되어 provider까지 도달한다.
- 502 4종·504·429·409를 구분하고, 2KB를 넘는 오류 스트림과 비허용 헤더는 폐기한다.
- 한자가 섞인 overview는 전체 실패하지 않으며 최종 결과에는 Han 문자가 남지 않는다.
- candidate/context의 HTTP 200 응답 본문이 끝나지 않으면 quota 정산은 `succeeded`가 아니라 `outcome-unknown`을 선점한다. 유료 요청을 자동으로 다시 보내거나 fallback으로 이중 결제하지 않는다.
- 릴리스 게이트는 strict TypeScript, ESLint warning 0, **106개 테스트 파일 / 1,174개 테스트**, production Vite build, Wrangler dry-run을 통과했다. 빌드는 main JS 739.96kB(gzip 215.62kB), CSS 185.95kB(gzip 32.52kB), Worker 323.08KiB(gzip 62.12KiB)다.

### 실서비스 배포 검증

- Worker `c9b27938-80e6-4dc6-b6cb-d2a05d4a495a`를 quota `required`, coordinator 준비 완료, 최대 활성 참가자 5명 상태로 배포했다. Pages origin에서 quota·전사·맥락·후보 해석 경로의 OPTIONS 204와 CORS 허용 헤더를 확인했다.
- 음식 토크 원본의 서로 다른 30초 구간 10개를 새 브라우저 경로와 같은 Base64 JSON·quota digest 계약으로 전송했다. **10/10 HTTP 200**, 응답 시간은 4.14~6.37초였고 error-only Worker tail에는 CPU 1102, 408, 409, 413, provider 429, 헤더 없는 CORS 종료가 한 건도 없었다.
- 진단 스크립트가 매번 새 참가자 ID를 만든 상태에서 여섯 번째 입장이 한 번 `capacity-full` 429가 된 것은 최대 5명 정책의 정상 동작이다. 2분 유휴 만료 뒤 같은 전사 구간은 HTTP 200으로 처리됐다.
- 음식 토크 길이와 같은 8,114,817ms를 144개 연속 chapter와 후보 6개로 구성한 대표 맥락 요청은 42.979초에 HTTP 200으로 완료됐다. 결과는 schema 1.6.0, 후보 주석 6개, 의미 구간 6개, 발견 단서 7개, coverage `complete`였으며 모델은 Qwen 3.7 Plus였다.
- 위 맥락 요청이 끝난 직후 동일 terminal operation에 구버전 방식의 `cancel`을 보내도 HTTP 200과 `OPERATION_ALREADY_FINISHED` 상태를 반환했다. 과거의 맥락 502 뒤 후속 quota 409 연쇄는 재현되지 않았다.

## 2026-07-27 `0.8.3` 5인 AI 용량 조정 · 30초 전사 경로 확정

### 기준선과 병합 범위

- Codex 작업본이 로컬 `0.4.8` 기준으로 남아 있었고 실제 `origin/main`은 `0.8.2`까지 66커밋 앞서 있었다. 오래된 UI와 전사 구현을 덮어쓰지 않도록 작업 브랜치를 `codex/pre-v083-max5`에 보존한 뒤, `origin/main`을 fast-forward하고 **5인 용량 조정 기능만** 이식했다.
- 충돌은 `broadcastTranscript.worker.ts`와 `aiProxy.worker.ts`에서 해결했다. `0.8.2`의 30초 청크·적응형 동시성·요청 간격과 바이트 기반 업스트림 본문 조립은 유지하고, 새 participant/run/operation/lease 계약만 결합했다. 구형 문자열 본문 생성과 구형 UI는 되살리지 않았다.

### 최대 5개 독립 편집 세션의 공정한 공유

- `AiQuotaCoordinator` Durable Object를 추가했다. 제품은 공동 프로젝트나 계정을 만들지 않으며, 각 브라우저 분석은 독립 세션으로 남는다. 다만 한 배포의 제한된 AI 중계 용량은 신뢰된 편집자 최대 5명이 공정하게 나눠 쓴다.
- Qwen Omni 전사·후보 해석은 같은 전역 게이트를 공유한다: 시작 간격 1초, 전체 pipeline/in-flight 각 6, 분당 100,000 예약 토큰. 후보 해석 역할은 별도로 in-flight 4를 넘지 않는다.
- 전체 맥락 게이트는 시작 간격 250ms, in-flight 6, 분당 5,000,000 예약 토큰이다.
- 참가자별 pipeline/in-flight 상한은 활성 인원 1/2/3~5명일 때 각각 6/3/2다. 참가자별 대기열은 12개, 참가자 간 round-robin·참가자 내부 FIFO이며, 큰 요청 하나가 전체를 막지 않도록 예약 토큰을 고려한 head-of-line skip을 적용한다.
- 여섯 번째 참가자는 Durable Object 상태에 넣지 않고 15초 뒤 재시도하도록 거부한다. `participantId`는 공정성 식별자이지 인증 수단이 아니므로 이 배포는 **신뢰된 소수 사용자 환경**을 전제로 한다.
- 공유 429 backoff와 lease 만료 회수를 둔다. 업로드 실패 시 `release-upload`는 정확한 lease token과 `lease-issued` 상태가 일치할 때만 허용해, 이미 실행 대기로 넘어간 요청이나 진행 중 요청을 취소하는 TOCTOU 구멍을 막았다.

### 실제 병목과 30초 계산

- 현재 브라우저 전사 청크는 90초가 아니라 **30초**다. 16kHz mono PCM WAV 한 건은 960,044바이트이며, 중계는 최대 90초·2,880,044바이트까지 방어적으로 수용한다.
- 30초 전사 예약량은 1,490 token이다. 전사만 연속 실행할 때 60RPM이면 89,400 token/min이므로 100,000 TPM보다 **시작 간격/RPM이 먼저 병목**이다. 청크를 더 잘게 쪼개도 빨라지지 않고 요청 오버헤드만 커진다.
- 현재 sampling 함수를 직접 실행하면 음식 토크 `02:15:14.817`은 271요청/인, 5명 합계 1,355요청이라 마지막 요청 시작 하한이 약 22분34초다. 기본 6시간과 12시간은 모두 432요청/인이라 5명 기준 약 35분59초다. 12시간에 서로 겹치지 않는 사건 피크 12개를 넣은 예시는 480요청/인, 5명 기준 약 39분59초다. 760은 정상 계획값이 아니라 protocol 방어 상한이며 그 상한을 모두 쓰는 경우에만 약 1시간03분19초다.
- 30초 전환 뒤에도 `createAiAnalysisRoutingPlan`의 사건 보강 여유가 90초 시절 값 `+24`로 남아 실제 480청크 계획을 456으로 과소 표시했다. 사건 12개 × 사건당 2분 ÷ 30초를 코드에서 계산해 `+48`로 고쳤고, 정책의 `maximumCalls`가 실제 12시간 사건 계획보다 작지 않다는 회귀를 추가했다.
- 30초 WAV 한 스트림의 최소 평균 업로드는 약 0.13Mbps다. 실제 완료 시간은 provider 지연, 후보 영상 해석, 맥락 요청, 재시도 때문에 이 하한보다 길 수 있다.

### 무중단 배포와 검증

- 구 클라이언트를 끊지 않기 위해 Worker를 먼저 `AI_QUOTA_MODE=optional`로 배포했다. 호환 Worker 버전은 `a3496cff-e5e5-41a6-bdf0-18d3c8820163`이며 protocol 3, coordinator ready, 최대 참가자 5를 health 응답으로 확인했다.
- 프로덕션 Pages origin에서 `/v1/ai-quota`, `/v1/broadcast-transcript`, `/v1/candidate-insights`, `/v1/broadcast-context`의 OPTIONS 204와 CORS를 확인했다.
- 실제 음식 토크 30초 한국어 WAV를 quota lease → raw `audio/wav` → Qwen3.5 Omni 경로로 보냈고 HTTP 200, 올바른 한국어 전사, 약 6.5초 완료를 확인했다. 이는 단일 실요청 검증이며, Free Worker에서 5명이 동시에 쓰는 p99 부하 시험은 아직 하지 않았다.
- 릴리스 게이트: strict TypeScript, ESLint warning 0, **106개 테스트 파일 / 1,147개 테스트**, production build, Wrangler dry-run을 통과했다. 빌드는 JS 732.36kB(gzip 213.35kB), CSS 185.95kB(gzip 32.52kB), Worker는 317.95KiB(gzip 60.81KiB)였다.
- 최종 순서는 `optional Worker → Pages 0.8.3 → required Worker`다. Pages가 quota header를 보내는 버전으로 바뀐 것을 확인한 뒤 Worker를 `required`로 전환한다.

## 2026-07-24 `0.5.4` PassB가 한 번도 시작되지 않던 버그

### 증상

후보 18개를 찾은 분석이 검토 화면에 **0개**를 내놓고 막다른 빈 상태만 보여 줬다. 진단 목록에는 맥락 미준비 6개, 화면·오디오 상세 분석 미완료 12개.

### 기각된 첫 가설 (기록용)

처음에는 "완전 검증된 후보만 목록에 담는 게 문제"라고 보고 미검증 후보도 노출하려 했다. **작업자가 기각했고 그 판단이 옳다.** 게이트가 완전 검증만 통과시키는 건 의도된 계약이고, 미검증 후보 노출은 증상만 가리면서 근거가 빈 카드를 편집자에게 떠넘긴다. 물어야 할 것은 "왜 검증이 안 되는가"였다. 같은 우회로를 다시 제안하지 않도록 남겨 둔다.

### 실제 원인

숫자가 단서였다. `12`는 `runCandidatePassB`의 `maxCandidates: Math.min(12, …)`와 정확히 일치한다 — PassB는 대상 12개를 **잡았고** 결과를 하나도 내지 못했다.

자동 트리거가 "이미 처리함" 가드를 **작업 시작 시점이 아니라 예약 시점**에 설정하고 있었다.

    autoCandidatePassBSourceRef.current = operationKey;   // 즉시 표시
    const timer = window.setTimeout(() => { runCandidatePassB(...); }, 450);
    return () => window.clearTimeout(timer);              // deps 변하면 취소

이 이펙트의 deps는 여러 렌더에 걸쳐 안정된다 — 의미 후보 정밀화가 `candidates`에 후보를 덧붙이고 → 맥락 맵이 다시 만들어지고 → id 목록이 다시 만들어진다. 450ms 대기 중 deps가 거의 항상 한 번은 바뀌므로 cleanup이 타이머를 취소한다. 그런데 가드는 이미 키를 쥐고 있고, `operationKey`가 객체 동일성이 아니라 **id 목록 문자열**이라 재실행 시 같은 키가 나와 조기 반환한다. 재예약이 일어나지 않는다.

나머지 세 자동 단계(맥락·전사·의미 정밀화)는 가드 설정과 작업 시작이 같은 동기 블록에 있어 이 함정이 없었다. 취소 가능한 `setTimeout`을 쓰는 건 PassB뿐이었다.

### 수정

키를 호출과 함께 넘기고 `runCandidatePassB`의 커밋 지점(`candidatePassBStartPendingRef.current = true` 직전)에서 취득한다. 타이머가 취소된 경우와 함수가 자체 검사에서 조기 반환한 경우 **둘 다** 키가 비어 있어 다음 시도가 재예약된다. 게이트 자체는 건드리지 않았다.

### 남는 것

PassB가 정상 동작해도 `context-missing` 6개는 남는다. 대사 텍스트나 주제 분류가 없는 후보를 맥락 빌더가 건너뛰기 때문이며, 근거 없이 지어내지 않는다는 뜻이라 의도된 동작이다.

### 명세서

`artifacts/REVIEW_BOARD_SPEC_2026-07-24.md`에 검토 화면 명세표를 작성했다(자리별 내용·글자 한도와 출구·폭별 대응·장식 생략 규칙). 저장소가 아닌 에이전트 `artifacts/`에 있다 — `0.5.4` 직전 커밋 메시지가 이 파일을 저장소에 추가했다고 적었는데 사실이 아니다.

### 검증

- `npm run check`: 89파일 902테스트.
- **미검증**: 실제 실행에서 PassB가 끝까지 도는지는 원본 파일이 필요해 확인하지 못했다. 재현 조건(빠른 탐색 후 의미 정밀화가 후보를 덧붙이는 흐름)에서 확인이 필요하다.

## 2026-07-24 `0.5.3` 내부 구성 재설계 — 신호 타일 · 필름스트립 · 레일의 쓸모

### 왜

`0.5.0`~`0.5.2`는 **프레임**을 바꿨다(기기·레일·도시에 카드·독). 작업자 판정은 "내부 내용 배치와 구성이 `0.3.x`와 별 차이가 없다"였고 맞는 말이었다. 안쪽은 여전히 **영상 왼쪽 / 텍스트 오른쪽** 2단 문서였다. 제공된 태블릿 샘플 5종은 전부 **색을 가진 모듈 타일이 격자로 놓인 대시보드**인데, 우리 화면엔 큰 상자 두 개뿐이었다.

### 무엇을 바꿨나

이미 저장돼 있으면서 묻혀 있던 데이터를 표면으로 올렸다. 장식을 더한 게 아니라 정보 구조를 바꾼 것이다.

1. **신호 타일** (`src/app/candidateSignals.ts`, 신규 순수 모듈)
   검토자가 가장 먼저 하는 질문 — "왜 이게 내 화면에 떠 있지?" — 의 답이 탭 안 접기 안 목록 안, 세 단계 깊이에 있었다. 채팅 급증 배수·오디오 상위 %·화면 변화 상위 %를 도시에 상단 타일 3개로 끌어올렸다. 색은 앱이 이미 쓰던 신호 팔레트(채팅 초록·오디오 보라·화면 주황)라 초록 타일은 여기서도 저기서도 채팅을 뜻한다.
   모든 값은 **같은 방송 안에서의 상대값**이며 절대적 품질 점수가 아니다 — 무엇도 "좋은 장면인지"를 재지 않는다.
2. **필름스트립** — 후보 이동이 `← 이전 / 다음 →` 텍스트 버튼 두 개라 매번 눈 감고 뛰는 셈이었다. 실행이 후보마다 대표 프레임을 이미 저장하므로, 그 장면들을 검토 상태(승인 초록 테두리·제외 흐림·현재 액센트 링)와 함께 캔버스 하단에 깔았다. 앞에 뭐가 오는지 보이고 바로 건너뛸 수 있으며, 지도를 열지 않아도 진행 상황이 읽힌다.
3. **레일에 실제 쓸모** — 좌측 기둥이 선형 파이프라인 4단계를 아이콘으로 늘어놓기만 했다(눌러도 스크롤뿐). 위쪽은 단계 **상태 표시**로 두고, 구분선 아래에 세션 내내 쓰는 도구를 넣었다: 방송 지도 `M` · 되돌리기 `Z` · 단축키 `?`. 특히 `?`는 이번에 제거한 navrow에 있던 것이라 갈 곳이 없던 참이었다.

### 글자 한도와 그 출구

작업자 지침대로 자리마다 글자 한도를 두되, 넘치는 것을 **버리지 않고 보낼 곳**을 정했다.

- `요약`은 발췌다. 두 필드에 한도를 두고, 같은 재료의 온전한 판본은 바로 위 `단서`·`맥락` 탭에 있다.
- `단서`·`맥락`은 길이를 분석이 정하는 목록·장문이라 한도 대신 스크롤.
- 후보보다 넓은 것(방송 지도·진단)은 탭이 아니라 시트.
- 어떤 경우에도 카드 모서리가 문장을 먹지 않도록 팬에 스크롤 안전망을 뒀다.

### 프레임이 좁아질 때

장식은 생략하고 내용은 유지한다는 규칙을 §11b 한 곳에 모았다. 지우는 건 이미 보이는 것을 반복하는 라벨(`상위`, 키 힌트), 스트립 눈금뿐이고, 문장·숫자·컨트롤은 어느 폭에서도 지우지 않는다.

### 검증

- 하네스 갱신 후 1600·1366·834·390 재확인. `npm run check`: 89파일 **902테스트**(신규 신호 모듈 5개 포함).
- **미검증**: 실제 프레임이 들어간 필름스트립의 시각적 밀도(하네스는 빈 썸네일), 레일 도구의 실제 동작.

## 2026-07-24 `0.5.2` 기기 치수 고정 — 16:10 · 여백 10%

### 문제

1. 좌우가 상하에 비해 지나치게 길었다. 기기가 가용 폭을 그대로 채우고 높이만 뷰포트에서 빼는 방식이라 종횡비가 뷰포트에 끌려다녔다.
2. **단계가 바뀔 때마다 기기 크기가 변했다.** `.ex-device`가 `flex: 1 1 auto`로 내용에 맞춰 자라고 줄었기 때문이다. 프레임이 화면마다 모양을 바꾸면 그건 기기가 아니라 콘텐츠에 두른 띠다.

### 해결

기기 치수를 뷰포트에서만 파생되는 두 변수로 확정하고, 콘텐츠 의존을 끊었다.

    --ex-device-w: min(80vw, calc(80dvh * 16 / 10));
    --ex-device-h: calc(var(--ex-device-w) * 10 / 16);

- 상하좌우 10% 여백(`padding: 10dvh 10vw`) 안에서 16:10을 유지하며, 폭·높이 중 먼저 걸리는 쪽이 크기를 정한다. 두 제약이 하나의 숫자에 합의하므로 어떤 뷰포트에서도 넘치지 않는다.
- 캔버스 높이도 `100dvh` 대신 `--ex-device-h`에서 파생시켰다. 기기가 기준이고 화면은 그 안에 맞춰지는 순서가 된다.
- 내용이 기기보다 길면 `.ex-screen`이 자체 스크롤한다 — 본체는 그대로 있고 화면만 움직인다는 원래 규칙 그대로다.
- 뷰포트 앵커인 오버레이(되돌리기 토스트·단축키 안내)도 기기 박스에 맞춰 다시 계산했다. 사용하지 않게 된 `--ex-desk-pad`는 제거했다.

### 검증

- `dev/phase-board.html` 신규 — 같은 뷰포트에서 검토 화면(내용 김)과 시작 화면(내용 짧음)을 나란히 렌더한다. 두 프레임의 기기 크기가 픽셀 단위로 동일함을 확인해 단계별 크기 변동이 사라졌음을 증명했다.
- 1600·1366·834·390 재확인, 가로 오버플로 0 유지.

## 2026-07-24 `0.5.1` 검토 화면 실측 교정 — 브라우저로 보고 고침

### 왜

`0.5.0`은 브라우저 없이 typecheck/build만으로 구조를 짰다. 작업자 판정은 "너무 엉성하다, 부드럽지도 않고 크기도 안 맞는다"였고 실제로 렌더해 보니 정확한 지적이었다. 이번엔 **헤드리스 Chrome으로 직접 보면서** 고쳤다.

### 도구 (신규, 저장소에 남김)

- `dev/surface-harness.html` — 검토 화면의 실제 DOM을 실제 스타일시트로 렌더하는 디자인 하네스. 분석을 돌리지 않고도 레이아웃을 눈으로 볼 수 있다. Vite는 `index.html`만 따라가므로 번들에 들어가지 않는다.
- `dev/device-board.html` — 브레이크포인트 보드. Chrome 데스크톱 창은 최소 폭이 약 500px이라 `--window-size`로는 390px를 잴 수 없다. iframe마다 진짜 뷰포트를 주어 모바일·태블릿 세로를 한 장에 측정한다.

### 실측으로 잡은 것

1. **위치 스트립 폭 0** — 레거시 `.rh-timeline-review-layout { align-items: start }`가 남아 있었다. flex column에서 이 값은 자식이 전부 absolute인 `.ex-pos`를 폭 0으로 접는다. `align-items: stretch`로 명시 해제해 측정값이 `w=0`에서 `w=783`으로 회복됐다.
2. **컴포넌트가 좁은 화면에서 전부 무스타일** — 도시에·독·트림·탭·배지 스타일을 통째로 `@media (min-width: 1101px)` 안에 넣어 둬서 1100px 아래에선 원시 HTML로 떨어졌다. **컴포넌트는 전역, 레이아웃만 분기**로 파일을 재편했다(§3~9 전역 / §10 데스크톱 / §11 좁은 화면).
3. **16:9 캔버스가 1.49로 뭉개짐** — 이미 16:10인 기기 안에 또 하나의 종횡비 상자를 박아 폭과 싸웠다. 기기가 프레임을 제공하므로 캔버스는 화면을 채우고, 스테이지가 남은 높이를 받아 영상이 그 안에서 레터박스된다.
4. **흰 카드 위에 흰 카드** — 검토 섹션의 패널 크롬을 벗겨 캔버스만 카드가 되게 했다.
5. **푸터가 오른쪽 여백으로 이탈** — 레일을 `.rh-shell` 밖으로 옮겼는데 `.rh-shell`이 아직 flex row였다. `display: block`으로 환원.
6. **제목 밴드 제거** — 기기가 이미 화면 중앙을 채우므로 그 위 페이지 제목은 기기를 아래로 밀 뿐이었다. 내용(후보 n/N·남음·사용)은 서피스 헤더 칩으로 옮겼다.
7. **도시에 아래 죽은 공간 약 200px** — 면책 문구를 `margin-top: auto`로 카드 하단에 고정해, 남는 공간이 본문과 각주 사이 여백으로 읽히게 했다.
8. **브랜드 마크가 빈 타일** — 글자가 판과 같은 보라였다. 레일과 같은 반전 처리로 통일.
9. **레일이 맨 아이콘** — 작업자 제공 태블릿 샘플 5종 중 4종의 공통 관습대로 "칠해진 둥근 기둥"으로 바꿨다. 좁은 화면에선 같은 기둥이 가로 바로 눕는다.

### 검증

- 브레이크포인트 4종(1600·1366·834·390) 스크린샷 확인. 가로 오버플로 측정 결과 전 구간 `scrollWidth == clientWidth`(390px 포함).
- 라이트·다크 양쪽 렌더 확인.
- `npm run check`: strict TypeScript, ESLint 경고 0, 88파일 897테스트.
- **미검증**: 실제 영상이 들어간 스테이지, 지도 시트 슬라이드 동작, 키보드 흐름 — 하네스가 정적이라 확인하지 못했다.

## 2026-07-24 `0.5.0` 검토 화면 원점 재설계 — 물리적 태블릿

### 왜 다시 만들었나

- `0.4.3`~`0.4.8`이 "태블릿화"라는 이름으로 진행됐지만, 작업자 판정은 **"여전히 시늉만 하고 있다"**였다. 재검토 결과 정확한 지적이었다. 팔레트(PART A)는 시안과 정확히 일치했지만 **구조와 컴포넌트가 시안을 따르지 않았다**. 기존 배치를 유지한 채 색만 갈아입힌 상태였다.
- 시안 원본(`claude.ai/code/artifact/3c5c485d…`, DESIGN_SPEC §3.1 짝 문서)을 다시 받아 대조한 결과:

| 시안 | `0.4.8` 실제 |
|---|---|
| 앱 전체가 하나의 기기, 레일이 화면 안에 내장 | 레일이 테두리 있는 별도 박스로 콘텐츠 옆에 부착 |
| 도시에 = 테두리·radius 16·그림자를 가진 카드 | 카드 없음. 그냥 컬럼 |
| 세그먼트 **필** (bg3 트랙 + 활성 흰 필 + 그림자) | 밑줄 탭바 |
| 판단바 = 영상 아래 떠 있는 분리형 독 | 우측 카드 안 인라인 버튼 6개 |
| 트림 = 영상 아래 전용 컴팩트 행 | 우측 카드 안 `<details>` 접기 |
| radius 7/10/14/20, 잉크 틴트 그림자 | radius 6/8/12/16, 슬레이트 그림자 (§2.1이 지시했으나 미반영) |

- 작업자가 제공한 태블릿 목업 5종을 다시 확인해 공통 관습을 추출했다. 가장 결정적인 것은 **좌측 레일이 "칠해진 둥근 기둥"**이라는 점이다(5종 중 4종). 맨 아이콘을 여백에 늘어놓은 형태는 한 건도 없었다. 이 하나가 "태블릿 앱"으로 읽히게 만드는 첫 신호인데 정확히 그것이 빠져 있었다.

### 무엇을 만들었나

신규 `styles/exclipper-surface.css` — 기존 검토 영역 스타일을 참조하지 않고 시안에서 직접 옮겨 적었다. 마지막에 로드되어 최종 결정권을 갖는다.

- **물리적 기기**: 앱이 책상(방사형 비네트를 준 bg2) 위에 놓인 본체가 된다. 베젤 13px, 외곽 radius 30, 상단 챔퍼 하이라이트 + 접촉/앰비언트 2단 그림자, 상단 베젤 중앙에 6px 카메라. 화면은 안쪽으로 눌린 유리(inset 그림자)이며 **본체는 절대 움직이지 않고 화면 내용만 스크롤한다**. `.rh-app`이 `100dvh`를 잡고 `.ex-screen`이 자체 스크롤을 갖는 구조.
- **레일**: 화면 안에 서는 액센트 그라데이션 기둥(radius 20, 그림자). 활성 단계는 흰 필로 뚫리고 브랜드 마크는 반전(흰 판 + 액센트 글자). 목업 2·3·4의 문법 그대로.
- **검토 캔버스**: `height`를 구동해 `aspect-ratio: 16/9`가 폭을 파생시킨다 — 뷰포트가 어떻든 기기 밖으로 넘칠 수 없다. 안에 서피스 헤더(방송 제목 = 목업의 "Hello NAME!" 자리) → 6px 위치 스트립 → 58/42 작업면.
- **좌열(영상)**: 스테이지(16:9, `#06090f`, 그림자) → **판단 독**(`1fr 52px 1.4fr` 그리드, 테두리+그림자로 분리된 기구) → 이전/다음 → **트림 행** → 산출물 행. 판단·트림이 드디어 영상 아래에 있다.
- **우열(도시에)**: 테두리·radius 16·그림자 카드. 제목(인라인 편집) → 타임코드·배지 2종 → **세그먼트 필** → 팬 3장. 요약은 `왜 이 장면인가`(3줄 클램프) + `확인한 대사`(좌측 액센트 인용, 2줄) + 면책, 맥락은 척추선으로 연결된 직전/지금/직후 스텝.
- **토큰 교정**: `--rh-radius-*`를 7/10/14/20으로, 그림자를 잉크 틴트로 올렸다. 토큰 레벨이라 스케일을 소비하는 기존 규칙 전체가 함께 부드러워진다 — 부드러움은 국소 장식이 아니라 계통이어야 한다는 §2.1의 의도.

### JSX 재구성 (이번엔 실제로 옮겼다)

`0.4.5`에서 "교차 부모 이전 위험"을 이유로 미뤘던 이동을 이번에 수행했다. 핵심은 `focusedCandidate`가 이미 4614행에 존재해 카드 `.map()` 바깥에서 좌열을 렌더링할 수 있었다는 점이다. 파생값(`focusedRange`·`focusedBoundaryTouched`·`focusedRangeAdjusted`·`focusedSubtitleAvailability`)을 map 밖으로 hoist해 좌우 양쪽에서 쓰게 했다.

- 판단바 6버튼 → 독 3버튼(빼기/▶/사용할게요)으로 축약, 클립·자막 다운로드는 좌열 하단 조용한 산출물 행으로 분리. 모든 핸들러·`aria-keyshortcuts`는 그대로.
- `<details className="rh-boundary-editor">` 126행 삭제 → 트림 행이 대체.
- 카드 내부 `rh-candidate-number`·`rh-confidence`는 CSS로 숨겼다. 서수는 헤더 칩이, 반응 정점은 스트립의 현재 마커가 이미 말한다 — 같은 걸 두 번 말하는 데 글자 예산을 쓰지 않는다.

### 의도적 예외 하나 (공개)

`단서` 탭만 내부 스크롤을 허용했다. 요약·맥락은 글자 예산에 맞춰 **집필된** 텍스트라 클리핑이 정직하지만, 단서는 분석이 찾아낸 만큼 길어지는 **목록**이고 아직 흘려보낼 진단 시트가 없다. 근거를 도달 불가능하게 잘라내는 것이 스크롤바보다 나쁘다고 판단했다. PART E 진단 시트가 생기면 재검토한다.

### 검증

- `npm run check`: strict TypeScript, ESLint 경고 0, 88개 파일 897개 테스트(구조 변경이라 순수 로직 테스트 수는 불변).
- `npm run build` 통과. CSS 139KB → 162KB(신규 서피스 시트).
- 재구성 중 발견해 고친 것: `nudgeCandidateBoundary`가 `5000 | -5000` 리터럴 타입을 요구해 `BOUNDARY_NUDGE_MS`(넓은 `number`)를 그대로 넘기면 거부됨 → 리터럴로 환원. `display:contents`가 박스는 지우지만 생성 콘텐츠는 남겨 모바일에서 카메라 점만 떠다니는 문제 → `::before` 명시 차단.
- **미검증**: 브라우저 실물. 이번 세션도 브라우저 도구가 없어 typecheck/lint/test/build와 DOM 중첩 정적 검사로만 확인했다. 기기 프레임·레일 기둥·독·세그먼트 필의 실제 시각 결과와 1100px 경계 전환은 작업자 확인이 필요하다.

## 2026-07-24 `0.4.8` 검증 전 빠른 후보 공개 (PART H-4' + PART F 배너)

### Before / 원인

- PART F(`0.4.4`)에서 "먼저 검토하기" 배너를 의도적으로 미뤘다 — 누를 곳(검증 전 후보를 안전하게 보여줄 화면)이 없었기 때문이다. 이번 항목이 그 짝이다.
- 조사해 보니 애초에 "탐색 중"(맥락 종합 전) 상태에서는 후보를 카드로 전혀 보여주지 않고 있었다. 타임라인은 "잠재 신호는… 아직 클립 후보가 아닙니다"라고 명시적으로 안내하며, 실제 후보 카드 목록(`rh-timeline-cards`)조차 `contextualCandidatePublicationReady`에 전부 가려져 있었다. 즉 검증 전에는 개별 후보를 재생하거나 훑어볼 방법이 전혀 없었다.

### After / 구현

- 리뷰 워크스페이스의 2단계 진행 패널 바로 아래, "탐색 중"이고 빠른 탐색 후보가 하나 이상 있을 때만(`!contextualCandidatePublicationReady && !analysisComplete && candidates.length > 0`) `<details className="rh-early-candidates">`를 새로 노출한다. 제목은 "빠른 후보 N개 — 검증 전"으로 상태를 명시하고, 펼치면 시간·상대 점수·재생 버튼만 있는 최소 카드 목록이 나온다.
- 명세의 "간이 카드(제목 없음, context packet 접근 금지)" 제약을 그대로 지켰다 — 이 목록은 `candidate.startMs/endMs/peakMs/score`만 읽고, `candidatePassBContextById`나 narrative/evidence 계열 함수는 아예 건드리지 않는다. PART I가 지목한 `candidatePassBContextById[id]!` 단정 함정을 원천적으로 피하는 방식이다.
- **PART F 배너와 통합**: 별도의 "먼저 검토하기 → 스크롤 이동" 배너를 새로 만들지 않았다. 이 `<details>` 자체가 진행 패널 바로 아래, 스크롤 없이 보이는 위치에 있어 배너가 가리킬 곳과 배너가 사실상 같은 자리다. 명세가 원했던 문구("빠른 후보 n개 — 검증 전")는 그대로 살렸다.
- `<details>` 네이티브 토글을 그대로 써서 새 React 상태를 만들지 않았다 — 이번 세션 내내 써 온 저위험 패턴을 재사용했다.

### 검증

- `npm run check`: strict TypeScript, ESLint 경고 0, 88개 파일 897개 테스트(순수 로직 변경이 없어 테스트 수 그대로).
- `npm run build` 통과.
- 이번 커밋을 포함해 세션 전체에서 수정한 모든 파일에 대해 제어문자(NUL 등) 바이트 스캔을 다시 돌려 깨끗함을 확인했다.
- **미검증**: 실제 브라우저에서 "탐색 중" 단계에 진입했을 때 이 패널이 실제로 나타나는지, 재생 버튼이 `sourcePreviewUrl` 준비 전/후 상태를 올바르게 반영하는지.

## 2026-07-24 `0.4.7` 결과·산출물 개선 (PART H-1~H-6)

### Before / 원인

- 결과 화면에 동급 primary 버튼(클립 전체 다운로드 / CSV)이 나란히 있어 "가장 먼저 눌러야 할 것"이 불분명했다.
- 후보 제목이 AI가 지은 headline 고정이라, 편집자가 직접 부르고 싶은 이름으로 바꿀 방법이 없었다.
- 클립·자막·썸네일 파일명이 전부 타임코드뿐이라(`exclipper-03-00-19-38-00-20-16.mp4`), 여러 개를 받으면 파일 탐색기에서 구분하기 어려웠다.
- 자막(.srt), 대표 프레임 썸네일(.jpg)을 받을 방법이 아예 없었다.
- CSV가 17열이라 스프레드시트에서 바로 읽기엔 정보가 과했다(전체 데이터는 JSON에 이미 있음).

### After / 구현

- **H-1**: `승인한 클립 전체 다운로드`를 단독 큰 primary 버튼으로 올리고, CSV·복사·MD를 `.rh-export-secondary-row`로 격하했다.
- **H-2**: `candidateTitleById`(뷰 전용 상태, 새로고침 시 초기화)와 후보 카드 제목 옆 "제목 편집" 토글을 추가했다. `useReviewShortcuts`의 입력창 예외 처리가 이미 새 `<input>`을 자동으로 감싸 준다. **주의**: `.rh-candidate-title`이 더는 `.rh-candidate-main`의 직계 자식이 아니라(`rh-candidate-title-row`로 감쌈) 기존 flex `order` 규칙이 그대로였다면 제목이 배지 위로 떠 버렸을 것 — `.rh-candidate-main > .rh-candidate-title-row { order: 2; }`로 선택자를 갱신해 배포 전에 잡았다.
- **H-3**: `buildClipFileName`을 `buildClipBaseName` + 확장자로 분리하고, 제목이 있으면 NFC 정규화·파일명 안전문자·40자 제한 슬러그를, 없으면 기존 타임코드 형식을 그대로 쓴다(하위 호환). 슬러그가 빈 문자열이 되는 경우(이모지만 있는 제목 등)도 타임코드로 폴백. 클립·자막·썸네일이 모두 이 함수로 같은 베이스네임을 공유한다.
- **H-4**: 신규 `src/exports/clipSubtitles.ts` — 후보의 PassB 대사 단서(`CandidatePassBPresentationCue`, 카드당 최대 3개)가 클립 구간의 60% 이상을 덮을 때만 `.srt`를 만든다. 이 코드베이스에는 임의 구간을 빈틈없이 잇는 "완전 자막 트랙"이 아직 없어(전사 자체가 방송 전체를 표본 추출하는 구조) 실제로는 대부분 "자막 받기" 버튼이 비활성 상태 + 사유 표시로 남는다 — 이는 결함이 아니라 명세가 지시한 폴백 분기이며, 게재 가능한 커버리지를 가진 짧은 클립에서는 정상적으로 활성화된다.
- **H-5**: 클립을 다운로드하는 순간(단일·전체 배치 모두) 저장된 대표 프레임(`candidateTimelineFramesById[id][0]`)을 같은 베이스네임의 `.jpg`로 동시에 내려받는다. 명세의 "동시 트리거" 표현을 그대로 따라 별도 버튼을 만들지 않고 클립 다운로드에 편승시켰다 — 검토 카드에 다섯 번째 버튼을 추가하는 대신, 결과물 다운로드 흐름을 한 번의 클릭으로 유지했다.
- **H-6**: CSV 헤더를 17열에서 `제목/시작/끝/길이/이유/메모` 6열로 줄였다. 제목은 사용자 편집값 우선, 없으면 AI narrative title. "메모" 열은 `narrative.reviewHint`("확인할 점")를 채워 빈 열이 되지 않게 했다 — 명세에 정확한 정의가 없어 내린 판단. 제거된 필드(신호·근거·상대점수·AI 제안 구간 등)는 JSON export에 그대로 남아 있다.

### 무결성 사고 하나 (기록해 둘 가치가 있어서)

- `clipRenderer.ts`에 filename-safe 정규식을 작성하며 제어문자 범위(0~31) 이스케이프를 도구 호출 파라미터에 그대로 적어 넣었는데, 파라미터가 JSON으로 전달되는 과정에서 실제 NUL 바이트로 디코딩되어 소스 파일에 심어졌다(`grep`이 파일을 "binary"로 오인). `npm run check`는 이 문제를 잡지 못했다 — TypeScript는 NUL 바이트를 포함한 정규식 리터럴도 유효한 문법으로 통과시킨다. Python으로 바이트 단위 스캔을 돌려 발견 후 해당 바이트를 제거하고, 애초에 제어문자 범위가 없어도 되도록(HTML `<input>`으로는 입력 불가능한 문자들이라) 정규식 자체를 단순화했다. **교훈**: 도구 호출 파라미터에 `\uXXXX` 형태의 이스케이프 시퀀스를 "리터럴 텍스트로 남기고 싶을 때"는 JSON 디코딩을 거친다는 점을 감안해야 한다.

### 검증

- 신규 `src/exports/clipSubtitles.ts` 7개 테스트, `buildClipBaseName`/슬러그 3개 테스트 추가. 기존 CSV 관련 테스트 4개는 17열 가정을 6열 형식에 맞춰 갱신(2건은 markdown으로 이동, formula-injection 테스트는 사용자 편집 제목 경로로 재작성).
- `npm run check`: strict TypeScript, ESLint 경고 0, **88개 파일 897개 테스트**(이전 87파일 886개).
- `npm run build` 통과. `clipRenderer` 청크가 여전히 별도로 분리됨을 확인 — `buildClipBaseName`을 동적 import로 유지해 mediabunny가 메인 번들에 섞이지 않게 했다.
- 소스 파일 전체를 대상으로 NUL/제어문자 바이트 스캔을 돌려 이번 세션에서 수정한 모든 파일이 깨끗함을 재확인했다.
- **미검증**: 실제 브라우저에서 제목 편집 입력창의 시각적 배치, 자막 커버리지 임계값(60%)이 실제 후보 데이터에서 얼마나 자주 통과하는지, 클립+썸네일 동시 다운로드 시 브라우저의 다중 다운로드 허용 안내 UX.

## 2026-07-24 `0.4.6` 좌측 아이콘 레일 · 시작 화면 명세 패널 (PART B+G)

### Before / 원인

- 상단 텍스트 스텝퍼(`rh-stepper`)가 4단계 라벨을 가로로 나열만 할 뿐 클릭 이동이 없었고, 세로 공간을 늘 차지했다. 태블릿 방향과 맞지 않는 웹 관례(가로 브레드크럼)였다.
- 시작 화면에서 파일을 고르기 전에는 우측 컬럼이 완전히 비어 있었다. 처음 쓰는 사용자가 "무엇을 넣고, 무엇을 받는지" 알 방법이 없었다.

### After / 구현

- **PART B**: `rh-stepper`를 좌측(≥900px) 세로/상단(<900px) 가로 아이콘 레일(`.ex-rail`)로 교체했다. 브랜드 마크(E) + 4단계 아이콘 버튼(폴더/파형/재생사각/다운 SVG, 24 viewBox stroke 1.9) + 테마 토글. 클릭은 `focusRailStep(step)`으로 기존 `focusSourceSection` 패턴을 그대로 재사용해 해당 구간으로 스크롤 이동만 한다(강제 단계 전환 아님). 2·4단계 앵커용으로 `analysisHeading`/`exportHeading` ref를 신설(기존 `sourceHeading`/`candidateHeading`과 동일 패턴). `disabled`는 `step > currentStep`(아직 도달하지 않은 단계)만 적용, `data-complete`/`aria-current`는 기존 로직 그대로 재사용해 위치·완료 표시가 동일하게 읽힌다.
  - `.rh-shell`을 명세대로 CSS Grid로 바꾸는 대신, `<nav className="ex-rail">` 바로 다음에 `<div className="ex-shell-content">` 래퍼 하나만 추가(태그 2줄 삽입)하고 ≥900px에서만 `.rh-shell{display:flex}` + 레일 `position:sticky`로 전환했다. 900px 미만에서는 `.ex-shell-content{display:contents}`로 기존 세로 흐름을 완전히 보존한다(대규모 JSX 재배치 없이 안전하게 좌측 레일을 구현하려는 의도적 선택).
  - 헤더의 기존 테마 버튼은 그대로 두고 레일에도 하나 더 두었다(같은 `theme`/`setTheme` 상태 공유). 기능 충돌은 없으나 시각적으로는 약간의 중복이다 — 다음 파트에서 헤더 쪽을 정리할지 판단 필요.
  - 옛 `.rh-stepper`/`.rh-step` CSS 규칙(3개 파일에 흩어짐)은 이제 대응하는 엘리먼트가 없어 죽은 코드이지만, 순수 정리 목적의 추가 위험을 피하려고 이번 범위에서는 그대로 남겨 뒀다.
- **PART G**: 시작 화면에서 원본을 아직 고르지 않은 순간(`!sourceReady && sourceCheck === null && sourceError === null`, 저장 결과 재연결 흐름 제외)에만 우측에 `.rh-spec-panel`을 노출한다 — 넣는 것/하는 일/받는 것 3줄 + "6시간 분량 방송 기준 약 25~40분" 참고문. 파일을 고르는 순간 `sourceCheck`가 즉시 non-null이 되어 자동으로 기존 `rh-source-summary`/`rh-analysis-launchpad`로 교체된다(추가 상태·이펙트 불필요). 형용사·느낌표 없는 사실 서술로만 작성.

### 검증

- `npm run check`: strict TypeScript, ESLint 경고 0, 87개 파일 886개 테스트 그대로(이 파트는 신규 순수 모듈이 없어 테스트 수 변화 없음).
- `npm run build` 통과. 청크 크기 경고는 기존과 동일.
- **미검증**: 실제 브라우저에서 레일의 sticky 동작·900px 경계 전환·아이콘 시인성, 시작 화면 명세 패널의 실제 레이아웃(2열 그리드 정렬), 레일 버튼 클릭 시 스크롤 이동의 체감.

## 2026-07-24 `0.4.5` 16:9 검토 서피스 · 위치 스트립 · 도시에 탭 (PART C+D+E)

### Before / 원인

- 검토 화면이 5-레인 타임라인 지도를 상시 노출한 채(스크롤로 정보를 욱여넣는 구조) 후보 카드의 모든 배지·근거·트림 편집기를 한 세로 목록에 쌓아 보여 줬다. "이건 태블릿이지만 본질적으로 모니터"라는 방향과 달리, 화면을 채운 정보량이 카드마다 달라 스크롤 길이가 들쭉날쭉했다.
- 후보 카드 안의 상세 정보(해석 배지, PassB, 오디오 이벤트, 경계 편집 근거, 대사, 맥락 전후 시퀀스, 사건·반응 단서)가 구분 없이 한 화면에 나열돼, "지금 왜 이 후보를 봐야 하는지"와 "판단에 필요 없는 세부"가 시각적으로 분리되지 않았다.

### After / 구현

- 후보가 공개된 상태(`data-review-ready="true"`)에서만 적용되는 새 1121px+ 레이아웃을 추가했다. `rh-timeline-review-layout`을 높이 고정 컨테이너(`clamp(760px, calc(100vh - 180px), 1080px)`)로 바꾸고, 상단에 방송 제목·길이·"후보 N/M · 남음 K" 칩(`.ex-sur-head`)을, 그 아래 6px 위치 스트립(`.ex-strip`)을 배치했다. 스트립은 각 후보를 원본 시각 비율로 점 하나씩 찍어(`src/app/positionStrip.ts`, 신규 순수 모듈) 기존 5-레인 지도를 대체하고, 지도 자체는 `M` 단축키로 여닫는 바텀시트(`rh-candidate-timeline`을 `transform: translateY()`로 슬라이드)로 접었다.
- 스트립 우측 "지도" 토글(`aria-expanded`)과 지도 헤더의 닫기 버튼, 스크림(`.ex-sheet-scrim`)까지 3가지 진입/이탈 경로를 모두 마련했다.
- 검토 레일(`rh-review-rail`)을 58/42 두 컬럼으로 분할했다: 왼쪽은 영상+이전/다음 네비(`rh-review-editor`, 기존 `display:contents`를 이 상태에서만 `flex column`으로 override), 오른쪽은 후보 도시에(`rh-candidate-column`).
- 도시에 카드 안에 세그먼트 탭 3개(요약/단서/맥락, `role="tablist"`)를 신설하고 기존에 한 목록에 섞여 있던 내용을 재배치했다: **요약**(먼저 볼 이유, 확인한 대사, 확인 필요 메모), **맥락**(전체 방송 속 위치, 직전/직후 후보 시퀀스), **단서**(해석·PassB·오디오이벤트·경계·재확인 배지 5종 + 사건·반응 단서 전체 — 기존 `<details>` 래퍼만 제거하고 자식은 그대로 보존). 탭은 `1`/`2`/`3` 직접 이동과 `D` 순환 단축키를 가진다(`src/app/useReviewShortcuts.ts`, `DossierTab` 타입 추가). `Escape`는 도움말 → 지도시트 → 비-기본 탭 → 없음 순 우선순위 체인으로 처리한다.
- 트림 편집기(`rh-boundary-editor`)와 사용/빼기 결정 바는 탭 시스템 밖(항상 노출)에 남겼다 — "트림은 탭이 아니다" 원칙은 지키되, 결정 바를 영상 옆(왼쪽 컬럼)으로 옮기는 것은 이번 범위에서 보류했다.
- 1120px 이하에서는 신규 서피스 요소(`.ex-sur-head`, `.ex-strip`, `.ex-map-close`, `.ex-sheet-scrim`)를 전부 숨겨 기존 모바일 인라인 지도 레이아웃을 그대로 유지한다. "탐색 중"(공개 전) 상태의 JSX·CSS는 이번 변경에서 전혀 건드리지 않았다.

### 명세 대비 의도적 축소(2건, 공개)

1. **결정 바 위치**: 명세(C-2)는 재생/클립/사용/빼기 버튼을 영상 옆 왼쪽 컬럼으로 옮기라고 했으나, 영상(`rh-review-editor`)과 후보 카드(`rh-candidate-column`)가 `rh-review-rail`의 서로 다른 자식이라 결정 바만 부모를 건너뛰어 옮기려면 `.map()` 클로저에서 분리해야 했다. 기존 위치의 sticky 동작이 이미 "행동이 화면에서 사라지지 않음"을 상당 부분 만족한다고 보고, 교차 부모 JSX 이전은 다음 배포로 미뤘다.
2. **진단 시트(PART E 후반)**: `rh-review-tools`(고급 진단 정보 `<details>`)를 우측 시트로 전환하는 건 보류했다. 이 요소가 서피스(`rh-timeline-review-layout`) 밖의 형제 섹션이라, 시트로 만들려면 DOM 위치 자체를 옮겨야 해 이번 세션에 이미 완료한 대규모 재구축(도시에 탭)에 이어 두 번째 고위험 JSX 이전이 된다. 기존 `<details>` 접기 동작이 "기본적으로 숨김"이라는 목적은 이미 달성하고 있어, 순수 시각적 이득 대비 위험이 크다고 판단했다.
3. (해석 조정, 공개) 명세의 "16:9 aspect-ratio"는 문자 그대로의 CSS `aspect-ratio` 대신 이 코드베이스에 이미 검증된 `clamp(760px, calc(100vh - 180px), 1080px)` 높이 고정 기법으로 구현했다. AI 생성 텍스트 길이가 가변적인 상태에서 엄격한 종횡비 + "스크롤 0" 요구가 서로 긴장 관계에 있다고 판단했기 때문이다.

### 검증

- 신규 순수 모듈 `src/app/positionStrip.ts` 7개 테스트(중점 50%, 시작/끝 0·100%, 범위 밖 클램프, duration 미상 시 0 반환).
- `npm run check`: strict TypeScript, ESLint 경고 0, **87개 파일 886개 테스트**(이전 86파일 879개).
- `npm run build` 통과. 청크 크기 경고는 기존과 동일.
- **미검증**: 실제 브라우저에서 58/42 분할·지도 바텀시트 슬라이드·탭 전환·스트립 마커 hover의 시각적 결과, 좁은 화면 경계(1120/1121px) 근처 레이아웃, 키보드 단축키(`1`/`2`/`3`/`D`/`M`)의 실제 동작. 이번 세션은 브라우저 도구 없이 typecheck/lint/test만으로 검증했다.

## 2026-07-24 `0.4.4` 동시 진행 트랙 (PART F)

### Before / 원인

- `0.4.2`부터 균등 표본 전사가 빠른 탐색과 동시에 시작되는데, 진행 화면은 여전히 "1/4 빠른 탐색 → 2/4 전체 맥락" 식 직렬 단계로만 표시했다. 실제로 병렬로 도는 네트워크 작업(전사)이 1단계 화면에서는 전혀 보이지 않아, 병렬화의 체감 효과가 없었다.
- 진행률 막대(`liveAnalysisProgressValue`)의 여러 분기가 실측값이 아닌 고정 상수(`0.02`, `0.76`, `0.84`, `0.72`, `0.08`)를 반환해, 막대가 특정 지점에서 멈춘 것처럼 보였다.
- 예상 소요 시간이 어디에도 없어 사용자가 6시간 방송이 5분짜리인지 90분짜리인지 알 수 없었다.

### After / 구현

- 진행 화면 진입 패널(`analysisBusy` 조건부 렌더, 파일 선택 후 분석 대기 화면)을 3개 동시 트랙으로 교체했다: **반응 신호**(로컬 화면·오디오 스캔), **대사 인식**(전사, `동시 4` 명시), **채팅**(즉시 완료 또는 "선택 사항"). 세 트랙은 서로 다른 자원(로컬 CPU, 네트워크, 즉시완료)에서 실제로 동시에 진행되는 작업을 그대로 반영한다.
- 예상 남은 시간을 신규 순수 모듈 `src/app/progressEstimate.ts`로 분리했다. 진행 신호가 충분히 쌓이기 전(경과 8초 미만 또는 비율 4% 미만)에는 원본 길이 기반 정적 범위(6시간 기준 약 25~40분 추정, 제품 계획과 동일 비율)의 중앙값을 쓰고, 이후에는 `경과시간/비율`로 총 소요를 역산해 "약 N분 남음"으로 표시한다. 두 근거를 구분해 정적 추정에는 "(추정)" 접미사를 붙인다.
- `liveAnalysisProgressValue`의 고정 상수 5개 분기를 `null`로 바꾸고, `<progress>` 두 곳 모두 `value`를 생략해 브라우저 기본 불확정(indeterminate) 표시로 전환했다. 실측 비율이 있는 분기(전사 진행률·의미 단서 배치·검토 완료율)는 그대로 유지했다.
- 탭을 닫으면 처음부터 다시 분석해야 한다는 안내를 패널에 상시 노출하고, 취소 버튼을 절대 위치에서 일반 흐름으로 옮겨 트랙 행과 겹치지 않게 했다.
- 검토 워크스페이스 내부(후보 공개 이후)의 2번째 진행 패널은 이번 범위에서 건드리지 않았다 — 그 패널은 `selectionResult !== null`(빠른 탐색 완료 후)에만 나타나므로 병렬 구간(1단계)에는 노출되지 않는다.
- **후속 배포로 미룬 것(명세 §F 원안 대비)**: "먼저 검토하기" 배너는 이번에 넣지 않았다. 명세가 스스로 지적한 대로, 최종 게이트 전 후보를 안전하게 보여줄 "검증 전 후보 뷰"(PART H-4')가 아직 없어, 배너가 가리킬 곳이 없다. PART H와 함께 배포한다.

### 검증

- 신규 모듈 `progressEstimate.ts` 10개 테스트 추가(정적 범위 산정, 측정 전환 임계치, 0분 표기 금지, 추정/측정 라벨 구분).
- `npm run check`: strict TypeScript, ESLint 경고 0, **86개 파일 879개 테스트**(이전 85파일 869개).
- `npm run build` 통과. 청크 크기 경고는 기존과 동일(신규 코드로 인한 변화 없음).
- **미검증**: 실제 브라우저에서 트랙 3개가 동시에 진행되는 모습, 좁은 화면(520px 이하)에서의 트랙 줄바꿈 레이아웃, 취소 버튼의 실제 위치.

## 2026-07-24 `0.4.3` 시그니처 v2 — 바이올렛 팔레트 프로덕션 반영

- `0.4.2` 스킨 1차는 구 블루 색상을 유지한 채 틴트만 바꿔 시각 변화가 사실상 없었다(작업자 확인). 재바인딩 구조 덕에 토큰 블록 교체만으로 v2를 반영했다.
- 시그니처 `#5b4df0`(다크 `#8f84ff`) + 라벤더 틴트 중성. 그라운드 `#f4f3fb` 위 흰 표면, radius 12–18 상향, 확산 그림자 — 작업자 제공 태블릿 목업 5종의 관습(DESIGN_SPEC §3.1.1) 기준.
- 마크업 무변경. 다음 구조 단계는 검토 서피스(레일·세그먼트 탭) JSX 재구축.

## 2026-07-24 `0.4.2` 병렬 전사 프리페치와 태블릿 스킨 1차

### 병렬 실행

- `!analysisComplete` 게이트를 위상 규칙으로 교체했다. 균등 표본 전사가 실행 시작 직후(스캔과 동시에) 시작되고, 스캔 완료 뒤 event-boost 위상이 저장된 체크포인트를 빼고 반응 정점 주변만 마저 전사한다. 스캔은 로컬 CPU, 전사는 네트워크라 자원이 겹치지 않는다 — 2단계 대기가 사실상 스캔 시간 뒤로 숨는다.
- 새 기계를 만들지 않았다. 새로고침 복구용으로 이미 있던 체크포인트-재개(§20)가 위상 인수인계를 그대로 수행한다. 순수 규칙은 `src/app/transcriptPhase.ts`로 추출해 9개 테스트로 고정했다: 지출 동의(실행 시작 전 전사 금지), 실행 중 pass 비선점, 위상별 fence, 복구 세션 호환.
- 조기 과금 구멍 두 개를 함께 막았다: 전체 맥락 추론에 `analysisComplete` 가드 추가(uniform 전용 지도에 추론 지출 방지), `cancelAnalysis`가 전사 프리페치를 함께 중단(같은 동의에 대한 지출).

### 태블릿 스킨 1차 (`styles/exclipper-app.css`)

- StreamSaver의 홈페이지 문법을 걷어냈다: 앱이 `bg2` 책상 그라운드에 앉고 표면은 평평한 보더 카드가 된다. 대시보드 상태 스트립(`.status-bar`)은 제거(스텝퍼가 같은 정보를 담당). 버튼·포커스 링·진행 막대·스텝퍼를 스펙 값으로 통일하고, 상속 변수(`--bg`, `--accent`, `--rh-*`)를 `--ex-*` 팔레트에 재바인딩해 기존 888개 룰이 일괄 재도장되게 했다.
- 이것은 스킨 패스다 — 마크업 무변경. 16:9 서피스·도시에 탭 구조 재구축은 화면 단위로 이어서 진행한다.

### 검증

- `npm run check`: strict TS, ESLint 0, 85파일 869 테스트(+9).
- **미검증**: 실브라우저 스킨 확인(대비·다크·간격), 병렬 실행의 실측(2단계 체감 단축), 취소 시 전사 중단 실동작. 배포 후 실행 1회가 기준선이 된다.

## 2026-07-24 `0.4.1` 저장소·주소 전면 교체 (rettolight → exclipper)

- 외부 공유 전 마지막 시점에 저장소 이름과 Pages 주소를 제품명 `exclipper`로 교체했다. 변경 파일은 `vite.config.ts`(base), `index.html`(favicon·og:url), `README.md`뿐이다.
- **Worker는 무변경** — CORS 허용은 `https://11qaws.github.io` origin 단위라 경로와 무관하다.
- **브라우저 저장 데이터 전부 생존** — IndexedDB·localStorage·Cache API(모델 91MB)는 origin 스코프이므로 주소 교체의 영향을 받지 않는다. 지난 분석 결과·테마·언어 설정이 그대로 열린다.
- 호환 경계(§5): 구주소 `/rettolight/`는 지원 종료(404). GitHub Pages는 경로 리다이렉트를 지원하지 않으며, 구이름으로 placeholder 레포를 만들면 git 이름 리다이렉트가 끊겨 병행 작업 중인 다른 에이전트 워크스페이스의 push가 오염되므로 만들지 않는다. 구이름을 비워 두면 기존 원격 URL은 GitHub가 자동 리다이렉트한다.
- Worker 이름(`rettohighlight-gemini`) 교체는 별도 작업으로 보류 — 새 이름에 Secret 2종 재주입이 필요해 작업자 입력 없이는 불가하며, 엔드포인트는 사용자 화면에 노출되지 않는다.

## 2026-07-23 `0.4.0` 전사 바이너리 전송과 중계 바이트 조립

### Before / 원인

- 전사 청크는 브라우저에서 base64(+33%)로 부풀려 JSON에 담아 보내고, 중계가 그것을 UTF-16 문자열로 디코드→파싱→재직렬화했다. 요청당 약 30MB의 일시 문자열이 128MB isolate를 압박해 동시 2요청부터 빈 503으로 죽었고(2026-07-23 실측), 그 결과 전사 동시성이 1로 고정되어 전체 맥락 단계가 수십 분 걸렸다.

### After / 구현

- `/v1/broadcast-transcript`가 `Content-Type: audio/wav` + `?startMs=&durationMs=` 쿼리로 **WAV 원본 바이트**를 받는다. 기존 JSON 경로는 그대로 수용한다(신·구 병행) — 배포 순서 위험 제거.
- 중계는 업스트림 본문을 **바이트로 조립**한다: 기존 빌더에 base64-유효 sentinel(`ExclipperAudioSentinel000000`)을 넣어 JSON 템플릿을 prefix/suffix로 쪼개고, WAV를 바이트→base64 바이트로 직접 인코딩해 이어 붙인다. 문자열을 한 번도 만들지 않아 요청당 메모리가 약 30MB → 약 7MB.
- 검증 규칙은 동일: 쿼리 정수·범위, 헤더 44바이트 canonical WAV, 길이·duration 일치, 413 상한. 실패 시 업스트림 호출 없음.
- 클라이언트 `requestBroadcastTranscriptChunkBinary` 신설(응답 처리 공유 리팩터), 전사 워커가 base64 인코딩 없이 WAV를 그대로 전송 — 업로드 25% 감소.
- `MAX_IN_FLIGHT_TRANSCRIPTIONS` 1 → **4**. 병목이 중계 메모리에서 rate limit으로 이동하므로 `wrangler.jsonc` 두 리미터를 30 → **60회/60초**로 상향.
- provider 폴백(Qwen→Gemini)은 보관한 WAV 바이트로 provider별 본문을 새로 조립 — 스트림 소진 문제 없음. 시도 종료 후 바이트 zero.

### 검증

- **등가성 증명**: 90초 풀사이즈 청크에서 바이너리 경로가 업스트림에 보내는 본문이 기존 JSON 경로와 **문자열 완전 일치**를 회귀로 고정. provider가 차이를 감지할 수 없다.
- 신규 11개 테스트: canonical 검증·쿼리 거부·413·Gemini 폴백 동일 오디오·레거시 JSON 수용. `npm run check`: strict TS, ESLint 0, **84파일 860 테스트**.
- `npm run build` 통과, `wrangler deploy --dry-run` 246.57KiB, 리미터 60/60s 확인.
- **미검증**: 실제 배포 후 바이너리 경로 동시성 실측(합성 부하), 실오디오 업스트림 성공. 배포 전 프로덕션은 기존 JSON 경로로 계속 동작한다.

## 2026-07-23 `0.3.47` 전사 중계 503 복구와 오류 경계

### Before / 원인

- 프로덕션에서 `/v1/broadcast-transcript` 요청이 전부 실패했다. 브라우저 콘솔에는 CORS 위반으로 보고됐지만 CORS 설정 자체는 정상이었다. `OPTIONS`는 204와 `Access-Control-Allow-Origin`을 정상 반환하고 작은 `POST`도 CORS 헤더가 붙은 400을 반환한다.
- 실제 원인은 Worker가 자원 한도를 넘겨 종료되고, 그 자리에 Cloudflare 자체 응답이 나가는 것이었다. 그 응답에는 CORS 헤더가 없으므로 브라우저가 CORS 위반으로 표시했다. **진짜 오류가 CORS 메시지에 가려졌다.**
- 크기별 실측으로 임계값을 확인했다. base64 1,024KB(약 25초)까지는 CORS 헤더가 붙은 400이 오고, 1,536KB(약 37초)부터 CORS 헤더 없는 빈 503이 온다. 앱은 청크당 최대 90초(3,840KB)를 보내므로 **모든 전사 청크가 예외 없이 Worker를 죽였다.**
- 원인 코드는 검증 방식이었다. `decodeStrictBase64`가 90초 청크에서 384만 자 정규식, 288만 자 `atob`, 288만 회 `charCodeAt` 루프를 수행한 뒤, 그 결과로 WAV 헤더 44바이트만 확인하고 `fill(0)`으로 버렸다. 업스트림에는 원본 base64 문자열이 그대로 전달되므로 전체 디코드는 처음부터 불필요했다.
- 같은 패턴이 후보 오디오(`handleCandidateInsightRequest`)와 JPEG 프레임 검증에도 있었다. 후보 오디오는 최대 60초(약 2,560KB)라 같은 임계값을 넘는다.
- `0.3.35` 기록의 "120초와 180초에서 edge가 빈 500으로 실패"는 같은 현상이었다. 당시 업스트림 provider 문제로 판단해 상한을 90초로 정했지만, 실제 원인은 Worker 자신의 자원 한도였고 90초도 안전선 밖이었다.

### 파급

전사 청크 전부 실패 → 저장된 chapter 0개 → context packet 생성 불가 → `0.3.45` verification receipt 발급 불가 → 최종 후보 0개. 사용자에게는 `완전 검증을 통과한 클립 후보가 없어요`가 표시됐다. 방송에 쓸 장면이 없다는 뜻으로 읽히지만 실제로는 판단 자체를 한 적이 없다.

### After / 구현

- 미디어 검증에서 전체 디코드를 제거했다. `decodeStrictBase64Prefix`가 선행 44바이트만 디코드하고, `base64DecodedByteLength`가 전체 길이를 인코딩에서 산술로 계산한다. `isCanonicalCandidateWav`와 `isCanonicalBroadcastTranscriptWav`는 `(header, totalByteLength, durationMs)`를 받는다. 검증 규칙 자체는 바뀌지 않았다.
- base64 형식 검사는 `isStrictBase64`로 분리했다. 기존 `(?:[A-Za-z0-9+/]{4})*` 패턴은 수량 지정 그룹이라 역추적 위험이 있어, 단일 문자 클래스와 패딩 위치 검사로 바꿔 한 번의 선형 스캔으로 끝낸다.
- JPEG 프레임 검증도 디코드 없이 형식 검사만 수행한다.
- Worker 최상위에 오류 경계를 추가했다. 기존 `export default { fetch }`에는 try/catch가 없어 어떤 실패든 CORS 헤더 없는 응답이 나갔다. 이제 모든 응답이 허용 origin을 달고 나가므로 앞으로 Worker 장애가 CORS로 위장되지 않는다. 다만 CPU·메모리 한도로 런타임이 강제 종료되면 이 catch에 도달하지 못하므로, 요청당 작업량을 작게 유지하는 것이 여전히 실제 방어선이다.
- 빈 결과 화면을 두 가지로 나눴다. 분석이 중단돼 판단을 못 한 경우는 `분석이 끝까지 진행되지 못해서 후보를 만들지 못했어요`와 `맥락 분석 다시 시도`·`처음부터 다시 분석`을 제공한다. 실제로 검증을 통과한 후보가 없는 경우만 기존 설명을 유지하되 보관된 빠른 후보 수를 함께 알린다.

### 위험과 경계

- 검증 규칙은 동일하다. 읽는 필드가 전부 앞 44바이트 안이고 총 길이만 산술로 대체했다.
- 전체 디코드가 사라졌으므로 `atob`의 암묵적 문자 검증에 의존하지 않는다. `isStrictBase64`가 길이·패딩 위치·문자 집합을 명시적으로 검사한다.
- 90초 청크가 실제로 통과하는지는 배포 후 실측이 필요하다. 통과하지 못하면 `MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS`를 내려야 하는데, 청크 수가 늘면 `30회/60초` rate limit과 충돌하므로 함께 조정해야 한다.
- 검증 전 후보 목록을 사용자에게 보여 주는 경로는 이번 범위에 넣지 않았다. 후보 카드가 `candidatePassBContextById[candidate.id]!`로 context packet 존재를 전제하므로, 검증되지 않은 후보를 그대로 렌더하면 안전하지 않다. 별도 슬라이스로 둔다.

### 검증

- `npm run check`: TypeScript strict, ESLint warning 0, **81개 파일 833개 테스트 통과**(이전 80파일 825개).
- `aiProxyMediaValidation.test.ts`를 새로 추가했다. 3.84MB 90초 청크가 400 없이 업스트림까지 도달하는 회귀, 길이 불일치·비정규 WAV·잘못된 base64를 여전히 거부하는 회귀, 그리고 최상위 오류 경계가 허용 origin에는 CORS 헤더가 붙은 500을, 비허용 origin에는 CORS 헤더 없는 응답을 반환하는 회귀를 고정했다.
- `npm run build`: production 빌드 통과.
- `wrangler deploy --dry-run`: 241.41 KiB(gzip 47.10 KiB), 두 rate limiter와 provider 설정 확인.
- **미검증**: Worker 실제 배포와 배포 후 90초 청크 실측. 배포 전에는 프로덕션이 계속 실패 상태다.

## 2026-07-23 `0.3.46` 키보드 검토 루프와 App 구조 분리

### Before / 원인

- 후보 판단은 전부 마우스 전용이었다. `App.tsx` 전체에 `keydown` 처리가 한 건도 없어, 후보 하나를 끝내려면 `이 구간 재생` → 경계 버튼 → `사용할게요` → `다음 후보`까지 매번 마우스 왕복이 필요했다. 후보 12~40개를 훑는 실제 사용에서는 이 왕복이 검토 시간의 대부분을 차지한다.
- `updateReview`는 `reviewState`만 바꾸고 포커스를 건드리지 않아, 판단 뒤에도 같은 후보에 머물렀다. 후보당 최소 2클릭이 구조적으로 강제됐다.
- `0.3.45`가 후보 카드에 `전체 흐름 → 직전 → 검증된 상황 → 직후 → 확인한 대사`를 항상 표시로 추가하면서, 카드 맨 아래에 있던 판단 버튼이 더 멀어졌다. 근거를 읽는 일과 결정하는 일이 순차적으로 강제됐다.
- 같은 카드 안에서 `재생 확인 필요`류 면책 문구가 4~5회 반복됐다. 개별로는 타당하지만 쌓이면 "아무것도 믿지 말라"는 메시지가 되어, 분석을 돌린 이유 자체를 약화시켰다.
- `App.tsx`는 10,043줄 단일 파일이었고, 그중 약 680줄이 컴포넌트 밖의 순수 타입·문구·매핑 함수였다. 이들은 React와 무관한데도 개별 테스트 대상이 아니었다.

### After / 구현

- 검토 단축키를 추가했다. `Space`(재생·정지), `←`/`→`(이전·다음 후보), `Shift`+화살표(시작 경계 ±5초), `Alt`+화살표(끝 경계 ±5초), `A`(사용), `R`(빼기), `Z`(되돌리기), `?`(안내). 기존 버튼은 모두 남기고 `aria-keyshortcuts`만 더해 발견성을 유지한다.
- 바인딩은 `event.key`가 아니라 **`event.code`** 를 읽는다. 한글 IME가 켜진 상태에서 `A`를 누르면 `event.key`는 `ㅁ`을 주므로 글자 단축키가 전부 죽는다. 한국어 UI에서는 `event.code`가 유일하게 안전한 기준이다. `input`·`textarea`·`select`·`contentEditable`과 IME 조합 중(`isComposing`)에는 항상 통과시킨다.
- 사용·빼기를 하면 아직 판단하지 않은 다음 후보로 자동 이동한다. 되돌리기(`unreviewed`)는 이동하지 않는다. 남은 후보가 없으면 이동하지 않고 지금 후보에 머문다.
- 자동 이동은 조용히 넘어가지 않는다. `후보 N 사용 · 다음 후보로 이동했어요` 알림과 `되돌리기`를 8초간 함께 보여 준다. 되돌리기는 판단 취소와 원래 후보 복귀를 한 번에 수행한다.
- 판단 바(`재생 / 클립 / 사용 / 빼기 / 단축키`)를 카드 맨 아래에서 **근거 위로 올리고 sticky 고정**했다. 긴 근거를 스크롤하는 동안에도 판단 수단이 항상 화면에 남는다.
- 면책 문구를 카드당 1회로 줄였다. 판단 바 바로 아래 `AI 단서는 참고용이에요. 재생해서 직접 확인한 뒤 판단해 주세요.` 한 줄만 남기고, 하위 블록·cue 버튼의 중복 `재생 확인 필요` 표기를 제거했다. `aria-label`의 안내는 유지한다(스크린리더에는 시각적 맥락이 없다).

### 구조 분리

`App.tsx` 10,043줄 → **9,329줄**. 컴포넌트 밖 순수 코드를 `src/app/`으로 옮겼다.

| 모듈 | 내용 |
|---|---|
| `app/appViewTypes.ts` | 화면 계층 타입. 저장 형식은 `storage`, 분석 계약은 `analysis`에 그대로 둔다 |
| `app/statusMessages.ts` | 상태·라벨·오류의 한국어 문구 전부. 제품 문체를 한 파일에서 검토할 수 있다 |
| `app/runFailureCodes.ts` | 오류·gap → 저장되는 reason code 매핑. 표시 문구와 분리 |
| `app/timelineProjection.ts` | 타임라인 셀·신호 강도 투영 |
| `app/durableCandidateMapping.ts` | 표시용 후보 ↔ 저장용 후보 변환 |
| `app/browserEnvironment.ts` | 저장소·클립보드·상태 머신 전이 래퍼 |
| `app/reviewNavigation.ts` | 자동 이동 규칙 |
| `app/useReviewShortcuts.ts` | 키보드 훅 |
| `app/components/` | `ReviewUndoToast`, `ShortcutHelpOverlay` |

- `styles/exclipper-foundation.css`를 신설했다. 타입 스케일 7단, 간격 스케일 7단, elevation 3단, motion, 그리고 한글 줄바꿈(`word-break: keep-all` + `overflow-wrap: break-word`)을 정의한다. **값 정의와 한글 줄바꿈 외에는 기존 렌더를 바꾸지 않는다.** 888개 기존 룰을 한 번에 갈아엎는 대신, 이번에 새로 만든 컴포넌트부터 `--ex-*` 토큰만 사용하고 이후 각 작업이 자기가 건드리는 컴포넌트를 옮긴다.
- `index.html`에 파비콘(`public/favicon.svg`)과 Open Graph 태그를 추가했다. 배포판은 `/rettolight/favicon.ico`가 404였고 링크 공유 시 미리보기가 비어 있었다. og:image는 실제 1200×630 이미지가 필요해 이번 범위에서 제외했고, 이미지 없는 `twitter:card=summary`로 텍스트 카드까지만 확보했다.

### 위험과 경계

- 단축키는 문서 레벨 리스너 하나로 등록하고, 후보 목록이 공개된 뒤(`contextualCandidatePublicationReady`)에만 판단 동작을 수행한다. `?`와 `Escape`만 그 밖에서도 동작한다.
- 경계 조정은 기존 `BOUNDARY_NUDGE_MS`(5초)를 그대로 쓴다. 계획했던 1초 단위 티어는 `CandidateBoundaryCommand`의 `deltaMs: -5_000 | 5_000` 리터럴 유니온을 넓혀야 해 도메인·테스트 변경이 따르므로 `0.3.49`로 미뤘다. 이번 변경은 도메인 계약을 건드리지 않는다.
- 자동 이동은 표현 계층의 포커스 이동일 뿐이다. 점수, 추천 순서, 경계, 승인 상태, 내보내기 순서를 바꾸지 않는다.
- 구조 분리는 코드를 옮기기만 했다. 함수 본문은 그대로이며 동작 변경은 위 UI 항목뿐이다.

### 검증

- `npm run check`: TypeScript strict, ESLint warning 0, **80개 파일 825개 테스트 통과**(이전 78파일 807개). `timelineProjection` 9개, `reviewNavigation` 9개를 새로 추가했다.
- 자동 이동 규칙은 전진·건너뛰기·앞쪽으로 순환·마지막 후보에서 이동 안 함·방금 판단한 후보로 돌아가지 않음·빈 목록을 각각 회귀로 고정했다.
- `npm run build`: 173 modules 통과. main JS 675.95 kB(gzip 195.34 kB), CSS 123.16 kB(gzip 21.00 kB).
- 빌드 산출물 확인: `dist/favicon.svg` 존재, `dist/index.html`에 `rel="icon"`·`og:title` 포함, 번들에 `0.3.46` 반영.
- 배포 산출물에서 `AIza`·`sk-`·`GEMINI_API_KEY`·`QWEN_API_KEY`·`x-goog-api-key` 패턴 **모두 0건**.
- **미검증**: 이번 작업 환경에서 브라우저를 띄울 수 없어 실제 렌더 확인(sticky 판단 바의 헤더 겹침, 단축키의 실제 키 입력, 알림 위치)은 하지 못했다. 배포 전 실제 브라우저 스모크가 필요하다.
- 이번 작업에서는 commit·push·배포를 실행하지 않았다.

## 2026-07-23 `0.3.45` 전체 맥락 기반 완전 검증과 후보 주석

- 최종 후보의 정의를 데이터 존재 여부에서 완전한 검증 묶음으로 바꿨다. 전체 방송 흐름, 주제, 직전·직후 흐름, 참고 대사, 빠른 근거와 선택형 채팅 반응 요약을 candidate별 bounded context packet으로 만들고, 이 패킷이 없는 reservoir 항목은 후보 멀티모달 큐에 넣지 않는다.
- Qwen/Gemini 후보 요청에 같은 context packet과 오디오·서로 다른 대표 화면 네 장을 전달한다. 응답 계약은 전체 흐름과 실제 화면·오디오의 일치 여부, 최종 추천 여부, 음악·MV·오프닝·엔딩·휴식/평범한 진행 여부를 별도 필드로 반환한다. 과거 응답은 복구할 수 있지만 새 판정 필드가 없으면 최종 후보를 통과하지 못한다.
- 같은 화면 묶음에서 결정한 대표 썸네일 timestamp, 네 화면, 오디오 결과와 context schema를 모두 확인한 뒤에만 verification receipt를 발급한다. final publication은 receipt와 `recommend + consistent + streamer-event`를 모두 요구하며 빠른 후보, 의미 후보, 과거 승인 상태가 이 guard를 우회하지 않는다.
- 후보 상세에 전체 방송 흐름과 `직전 → 검증된 상황 → 직후`, 확인 대사를 고정 정보 구조로 추가했다. 방송 흐름 요약에서는 최종 후보와 연결된 서술을 굵게 표시하고 실제 candidate ID에서 계산한 클릭 가능한 윗첨자 번호를 붙인다. 요약이 사건을 생략한 경우 검증된 후보 상황을 주석 문장으로 보충해 모든 최종 후보가 방송 서술과 양방향으로 연결된다.
- 후보 insight 저장 schema를 `1.5.0`으로 올려 verification receipt와 새 판정 필드를 보존했다. context-aware Qwen revision은 v7, Gemini revision은 v8, routing revision은 v8로 분리해 이전 유료 결과를 새 완전 검증 결과로 relabel하지 않는다.
- 최종 release gate는 strict TypeScript, ESLint warning 0, 78개 테스트 파일 807개 테스트, production Vite build와 Wrangler dry-run을 통과했다. main JS는 670.19 kB(193.51 kB gzip), CSS는 118.89 kB(20.08 kB gzip), Worker upload는 239.70 KiB(46.57 KiB gzip)다. 로컬 브라우저에서 v0.3.45, 가로 overflow 0, warning/error 로그 0을 확인했다. Worker `bdf53a89-2de3-4616-9efb-3ceb1925e0c1` 배포 뒤 `/healthz` 200, production Origin preflight 204, 1초 canonical WAV 실요청의 Qwen context-verified v7 구조화 응답 200을 확인했다. 기능 commit `c7f636b`의 GitHub Pages workflow `29999885869`는 build·deploy를 모두 통과했고 공개 루트·직접 진입·`index-Dv6LRMYS.js`·`index-CqKQah3A.css`가 HTTP 200을 반환했으며 공개 JavaScript가 `0.3.45`를 제공한다.

## 2026-07-23 `0.3.44` 화면 필수 AI 큐·통합 검토 작업면·전 단계 진행률

- 후보 화면 준비와 AI 호출의 경계를 다시 정의했다. 한 원본에 후보별 video/Blob URL을 반복 생성하지 않고 한 producer가 candidate source range별로 서로 다른 JPEG 4장을 준비한다. 최대 2개 AI consumer는 자기 후보의 완성 묶음을 기다린 뒤 즉시 실행하며, 네 장 중 하나라도 없으면 유료 멀티모달 호출을 보내지 않는다. 반응 정점에 가장 가까운 같은 묶음의 화면을 섬네일로 저장해 AI가 본 장면과 편집자가 보는 대표 장면을 일치시켰다.
- 후보의 멀티모달 계약에 등장인물 상태를 필수 의미로 추가했다. 결과는 식별됨, 화면에 있으나 미식별, 등장인물 없음, 화면은 있지만 판단 근거 부족을 구분한다. 외형 근거는 서로 다른 두 frame 이상의 반복 특징을 요구하고 화면 이름·호명은 해당 frame 위치를 남긴다. 교환학생 메인 및 아모레또·유레카·세나 아르벨·토로리 코코·망징이 개인 CHZZK 채널 ID를 버전형 catalog로 분리했으며 세라 교수님은 교환학생 메인 scope에만 포함한다.
- CHZZK 영상 링크 또는 명시적으로 표기된 replay 번호에서만 Worker의 고정 metadata endpoint로 channel ID를 확인한다. 임의 날짜·파일명의 숫자는 영상 번호로 보지 않고, 채널 확인 실패도 분석을 막지 않는다. 개인 채널 주인은 이름 후보를 좁히는 참고값일 뿐 실제 등장 증거가 아니다.
- 최대화 검토 UI를 하나의 외곽 작업면으로 합쳤다. 왼쪽 2/3은 전체 방송 지도·탐색 근거·후보 목록, 오른쪽 1/3은 후보 이동·일시정지 영상·사건/인물 설명·사용/제외·상세 근거가 끊기지 않고 이어진다. 두 열은 같은 높이를 사용하고 오른쪽 긴 근거만 내부 스크롤하며, 모바일에서는 타임라인→영상→판정 순으로 접는다.
- 방송 맥락 결과는 하나의 카드 안에서 `방송 흐름`과 `주 진행자의 진행 방식`으로 역할을 분리했다. 전자는 시간순 사건과 주제 전환만, 후자는 반복 관찰된 말투·상호작용·반응 패턴과 한계만 담는다. 한국어 결과에 의도하지 않은 한자 script가 섞이면 canonical 성공으로 저장하지 않게 후보·전체 맥락 parser를 강화했다.
- 우상단에 분석 시작 전 한국어/영어 선택을 추가했다. 선택값은 후보 및 전체 맥락 요청에 포함되고 분석 시작 뒤 잠겨 한 세션의 UI와 AI 서술이 섞이지 않는다. 대사 evidence는 편집 근거이므로 원문을 유지한다.
- 실시간 분석 패널을 1단계 `빠른 탐색`, 2단계 `전체 맥락`, 3단계 `후보 종합`에서 동일하게 사용한다. 1단계는 화면·오디오 worker 비율, 2단계는 전사 수집 5~70%와 맥락 복구/해석 상태, 3단계는 주제 공개와 Pass B 비율을 같은 7px 막대에 투영한다. 전사 완료 뒤 모델 응답을 기다리는 동안 막대가 사라지던 틈은 84% 해석 상태로 유지하되 모델 내부 토큰 진행을 가짜로 세분화하지 않는다.
- strict TypeScript, ESLint warning 0, 75개 테스트 파일 801개 테스트를 통과했다. production build는 main JS 657.23 kB(190.05 kB gzip), CSS 116.15 kB(19.67 kB gzip)이며 Wrangler dry-run은 231.96 KiB(45.01 KiB gzip)로 통과했다. Worker `ab78ec7a-4c04-487b-85bd-112b11f8e1f8`을 배포한 뒤 `/healthz`의 Qwen·Gemini 준비 상태와 CHZZK replay 13996057 → 교환학생 메인 채널 ID 응답을 운영 origin에서 확인했다. 기능 commit `50814ce`의 GitHub Pages workflow `29970192487`은 build·deploy를 모두 통과했고 공개 `index-JY_TUwFi.js`가 v0.3.44를 제공한다. 공개 브라우저에서 1,280px 가로 overflow 없음, 저장 결과의 2단계 막대 72%·8px 실측, warning/error 0개를 확인했다.

## 2026-07-23 `0.3.42` 원본 확인·분석 타임라인 준비 작업대

- 사용자 화면을 기준으로 원본 준비 구간을 다시 추적했다. 기존 화면은 같은 `sourceReady` 상태를 왼쪽의 큰 업로드 카드, 오른쪽의 작은 검사 결과 영수증, 아래의 전체 폭 CTA로 세 번 분리해 보여 줬다. 오른쪽은 정보가 부족하고 좌우 높이가 맞지 않았으며, 편집자가 다음에 보게 될 타임라인과도 시각적으로 이어지지 않았다.
- 준비 완료 상태를 같은 높이의 1:1 작업대로 합쳤다. 왼쪽 pane은 선택한 원본의 이름·길이·형식·크기와 교체 동작만 담당하고, 오른쪽 pane은 실제 원본 길이의 시간축, `전체 훑기 → 맥락 확장 → 여러 후보 정리` 경로, 화면·오디오/선택형 채팅 준비 상태, 분석 시작 동작을 한 흐름으로 제공한다. 중복 검사 결과 카드와 떨어져 있던 CTA는 준비 완료 상태에서 제거했다.
- `sourceReadyTimelinePresentation`을 별도 순수 projection으로 추가했다. 모든 30분 경계와 정확한 끝 시각을 보존하되 3시간·6시간·12시간 길이에 따라 글자 라벨만 단계적으로 줄인다. 이 projection은 알려진 원본 길이만 사용하고 후보·주제·잠재 점수를 미리 만들거나 저장하지 않는다.
- blocked source를 `AI 분석 준비 완료`로 잘못 표시할 수 있던 상태 문구를 `분석 시작 불가`로 교정했다. 준비 CTA가 분석 시작과 함께 사라져 취소 버튼도 접근할 수 없던 경로는 실제 progress panel로 옮겼다. source check, persistence schema, Worker API, Candidate Ledger와 유료 AI 실행 순서는 바꾸지 않았다.
- 실제 로컬 음식 토크 샘플을 앱에 연결했다. preflight가 02:15:14·476 MB·MP4로 완료됐고, 00:00:00부터 02:15:14까지 정확히 6개의 30분/끝 눈금, 화면·오디오 준비, 선택형 채팅, 분석 시작 버튼을 렌더링했다. 최대화 2,552×1,308 화면에서 두 pane은 각각 759×468px로 폭·높이가 일치했고 CTA는 첫 viewport 안에 있었으며 가로 overflow와 warning/error 로그는 0개였다.
- production CSS를 사용한 반응형 검증에서 760px은 두 pane을 단일 열로 전환하면서 세 단계·전체 시각 라벨을 유지했고, 620px은 분석 단계와 신호 카드를 한 열로 바꾸고 시간 라벨을 시작/끝 두 개로 줄였다. 두 폭 모두 가로 overflow가 없었다. 강제 색상 모드에는 pane·시간축·단계·신호의 명시적 경계와 Highlight 점·선 fallback을 유지한다.
- 최종 release gate는 strict TypeScript, ESLint warning 0, 73개 테스트 파일 784개 테스트, production Vite build, Wrangler dry-run을 통과했다. main JS는 634.23 kB(183.53 kB gzip), CSS는 102.62 kB(17.73 kB gzip), 변경하지 않은 Worker upload는 213.12 KiB(41.58 KiB gzip)다. 정적 Pages commit·push·deploy는 프로젝트 승인 규칙에 따라 사용자 승인 전에는 실행하지 않는다.

## 2026-07-22 `0.3.41` 분산 맥락 탐색과 최종 후보 공개 타임라인

- Adobe Premiere의 time ruler·marker detail, vis-timeline의 grouped range/point track, Chrome Performance의 overview→selection→detail, DaVinci Resolve의 overview/detail 분리를 비교한 뒤 `docs/TIMELINE_EDITOR_UX_PLAN_2026-07-22.md`를 먼저 작성·검토했다. 장식용 파랑 선을 제거하고 하나의 source-time 축 위에 시간 눈금, 잠재 신호, 탐색 셀, 의미별 주제 범위, 의미 단서, 최종 후보를 분리했다.
- 주제 색은 더 이상 `index % 4` 순번으로 정하지 않는다. 파랑 `주요 사건·반응`, 초록 `성취·회수`, 보라 `흐름·전환`, 회색 `일반 맥락`의 고정 의미 체계를 사용한다. 주제 띠와 의미 단서는 키보드로 선택할 수 있고, 선택 inspector가 시간 범위·요약·근거·확신·연결 후보·불확실성을 보여 줘 모델이 만든 정보를 버리지 않는다.
- 후보 요약 카드는 100px 고정 높이와 82px 대표 화면을 사용한다. 카드 제목과 출처는 한 줄, 사건 설명은 두 줄로 제한하되 전체 문장은 선택 후 상세 패널에 보존한다. 후보 이동 바는 두 pane 위의 공용 행으로 옮겼고, 최대화 화면에서는 좌우를 1:1·동일 고정 높이로 맞춘 뒤 오른쪽 근거만 내부 스크롤한다.
- 전체 맥락 요약 계약을 300~500자에서 600~1,000자로 늘리고, 주 진행 스트리머의 진행 역할·상호작용 방식·반복 관심사·반응 패턴을 300~500자로 정리하는 근거 기반 프로필을 추가했다. 이름은 닫힌 출연진 또는 방송의 명시적 근거가 있을 때만 쓰고 민감한 신상은 추정하지 않는다. 프로필 근거·불확실성은 결과와 함께 저장되며 schema `1.6.0`, context cache fence `1.10.0`이 이전의 짧은 결과를 새 계약과 구분한다.
- 배포 Worker에서 음식 토크의 2,619개 자막 이벤트·68개 챕터·41,581자 입력을 실제로 검증했다. overview는 Qwen 3.7 Plus primary로 61.2초에 끝났고 방송 서술 708자, 진행자 관찰 308자, 근거 5개를 반환했다. 모델이 지침을 어기고 국적·성별·성적 정체성·나이·본명·가족 같은 편집 비관련 신상을 섞은 것도 확인해, 응답 파서가 해당 문장·근거·불확실성을 제거하고 닫힌 명단에서 `streamer` 역할로 확인된 이름만 canonical 이름으로 저장하도록 fail-closed 후처리를 추가했다. 전체 텍스트 검증 비용은 약 `$0.033702`였다.
- 네 개의 큰 절차 카드를 하나의 실시간 분석 패널로 합쳤다. 패널은 현재 단계의 제목·상태·진행률만 크게 보여 주고, 전체 순서는 작은 4점 레일로 남긴다. 전체 맥락과 후보 세부 검토가 끝나기 전에는 초기 후보 개수·검토 통계·고급 후보 도구를 노출하지 않는다.
- 초기 오디오·채팅·화면 신호는 타임라인의 흐릿한 잠재 점수로만 유지한다. 큰 번호 원, 후보 요약 카드, 재생·승인 편집기는 전체 맥락, 의미 후보 정밀화, 후보 화면·대사 검토, 주제 지도 조합이 terminal에 도달한 뒤 한 번에 공개한다. 맥락에서 `deprioritized`된 보존 후보는 작은 저강도 원으로 구별한다.
- Qwen ASR 청크를 앞에서부터 보내던 실행 순서를 결정론적 분산 순서로 바꿨다. 황금비 위치에서 시작해 아직 확인하지 않은 전역에서 가장 먼 셀을 반복 선택하므로 같은 영상은 매번 같은 순서·비용·checkpoint identity를 유지하면서도 방송 곳곳을 먼저 훑는다.
- 대사에 사건·인과 연결·강한 반응 신호가 둘 이상 나타나면 이미 계획된 좌우 이웃 셀을 작업 큐 앞으로 당긴다. 두 로컬 이웃 사이에는 전역 probe 하나를 남겨 한 주제에 고립되지 않게 한다. 이 전이는 요청 수·총 오디오 초·예산을 늘리지 않고 기존 계획의 순서만 바꾼다.
- transcript Worker와 client는 비시간순 요청을 허용하되 정렬한 복사본으로 중복·시간 겹침을 계속 거부한다. partial·gap은 탐색 셀에 즉시 반영하고, 저장 및 최종 context 입력은 다시 원본 시간순으로 합친다. 전체 맥락 응답은 현재 batch JSON 계약을 유지하므로 모델이 주제를 스트리밍했다고 가장하지 않고, 완성된 주제 범위를 분산 순서로 260ms마다 하나씩 지도에 펼친다.
- 최종 release gate에서 strict TypeScript, ESLint warning 0, 72개 테스트 파일 777개 테스트, production build가 통과했다. main JS는 629.77 kB(182.33 kB gzip), CSS는 98.03 kB(17.07 kB gzip)이며 Worker dry-run은 211.42 KiB(41.02 KiB gzip)다.

## 2026-07-22 `0.3.40` 맥락 후 세부 검토 흰 화면 복구와 단계 순서 교정

- 실제 배포 탭의 브라우저 오류 로그에서 `CandidateReviewFeatureAvailabilityInputError: Candidate count must be an integer between 0 and 12 inclusive.`를 재현했다. 전체 맥락 정밀화가 빠른 탐색 후보 뒤에 새 의미 후보를 더해 canonical candidate ledger가 12개를 넘었는데, 상세 검토 화면 표시 여부가 후보 순위 계산의 12개 실행 상한을 전체 후보 수 상한으로 잘못 사용한 것이 직접 원인이었다. API·키 실패가 아니라 렌더 시점의 도메인 계약 충돌이었다.
- canonical 후보는 하나도 자르지 않는다. 13개 이상이어도 후보 목록, 화면·오디오 세부 분석, 승인·제외, 타임라인을 계속 사용할 수 있고, 최대 12개 전용인 전체 순위 재정렬만 숨긴다. 순위 view state는 상한 초과 시 빈 안전 projection으로 초기화하며, 세부 AI 실행은 기존처럼 우선순위가 높은 최대 12개만 처리한다.
- 전체 맥락 뒤 의미 후보가 추가될 때 첫 세부 분석과 실행 시간이 겹치면 새 후보 분석이 한 번 반환되고 사라질 수 있던 경로를 고쳤다. 자동 실행 키를 source와 전체 세부 대상 ID 집합으로 만들고, 진행 중이면 기다린 뒤 아직 근거가 없는 후보만 다음 bounded batch로 보낸다. 동일 후보 집합은 자동으로 반복 과금하지 않는다.
- 단계 UI를 실제 순서인 `빠른 탐색 → 방송 전체 맥락 → 맥락 기반 세부 검토 → 편집자 최종 선택`으로 교정했다. 1~3단계는 자동 분석, 4단계는 사람의 선택임을 표시하고, 전체 맥락 이전에는 세부 검토가 시작된 것처럼 보이지 않게 상태·진행률·오류 문구를 분리했다.
- 최상위 React error boundary를 추가했다. 이후 예상하지 못한 표시 오류가 생겨도 빈 흰 화면 대신 저장 기록을 지우지 않는 새로고침 복구 안내를 보여 준다. 이 경계는 분석 세션·후보·사용자 판단을 수정하거나 삭제하지 않는다.
- strict TypeScript, ESLint warning 0, 71개 테스트 파일 768개 테스트가 통과했다. production build는 main JS 619.33 kB(179.22 kB gzip), CSS 86.16 kB이며, 변경하지 않은 Cloudflare Worker도 Wrangler dry-run 205.93 KiB(39.74 KiB gzip)를 통과했다.

## 2026-07-22 `0.3.39` 맥락 분석 임계 경로 단축과 편집 목적 원안 복원

- 실측 저장 자료 `.qa/context-food-0336-full.json`을 단계별로 다시 계산했다. 기존 음식 토크 맥락 경로는 overview 44.327초 뒤 discovery 최대 15.755초, jury 26.097초를 순차로 기다려 약 86.179초였고, 20개 refinement는 Qwen 3.7 호출 누적 386.437초를 3개 pool로 처리해 이론상 약 128.813초를 더 소비했다. 입력은 2시간 15분/68개 자막 chapter에 불과했으므로 모델 품질보다 scheduling과 역할 배치가 주 병목이었다.
- overview와 최대 4개의 deterministic chronological discovery를 동시에 시작하도록 App과 실제 live evaluation harness를 같은 코드 경계로 바꿨다. 각 discovery slice는 overview를 기다리지 않고 모든 chapter를 정확히 한 번씩 덮으며, 완료 뒤 overview Semantic Chapters·요약과 합쳐 기존 Qwen 3.7 jury를 그대로 사용한다.
- `refinement`가 우연히 overview/jury와 같은 Qwen 3.7 route를 쓰던 문제를 분리했다. 첫 실험은 discovery와 모든 1분 자막 위치 보정을 Qwen 3.6 Flash로 보내 20/20 transport 성공, 약 104초 wall time, `$0.069836`을 기록했지만 두바이 초콜릿과 일부 껍데기 reserve가 성공한 빈 결과로 사라졌다. 비용 차이는 작고 recall 회귀는 커서 이 all-fast 경로를 최종안으로 채택하지 않았다.
- 최종 하이브리드는 비교 배심이 이미 승인한 lead만 Qwen 3.6 `refinement-fast`로 위치를 찾고, recall을 위해 더한 topic-balanced reserve는 Qwen 3.7 `refinement`로 사건 진위와 위치를 함께 판단한다. refinement pool은 3개에서 6개로 올리되 최대 20개/전체 26개 호출·lead별 실패 격리·입력 순서 보존·canonical 후보 보존은 유지했다.
- routing policy를 `1.11.0`, context cache fence를 `1.9.0`, topical discovery를 `1.3.0`, 앱을 `0.3.39`로 올렸다. fast identity는 `qwen3.6-flash-caption-refinement-speed-v1-2026-07-22`, quality identity는 `qwen3.7-plus-caption-refinement-quality-v1-2026-07-22`이며, whole-context envelope `1.1.0`이 fast 부분집합을 별도로 저장한다. 이전 유료 결과를 새 모델 결과로 relabel하지 않는다.
- GitHub 상세 검토 원문을 다시 확인해 여러 용도의 클리핑 제안은 `반응/토크/사과/조용한 성취` 같은 검출 모드가 아니라 `balanced | main-story | shorts | recap` **Editorial Intent Profiles**였음을 복원했다. 앞의 항목들은 사건 category이고 뒤의 Profile은 하나의 공통 Candidate Ledger를 목적별로 재정렬하는 projection이다. Profile 변경으로 API를 다시 호출하거나 후보·사용자 결정을 덮어쓰지 않는 원칙을 제품·상태 문서에 확정했으며, 선택 UI와 ranking 함수는 별도 검증 가능한 수직 슬라이스로 남겼다.
- 최종 음식 토크 hybrid smoke는 114.8초에 끝나 기존 약 215초보다 약 47% 빨라졌다. overview 38.666초, jury 20.913초였고 총 텍스트 비용은 `$0.069703`이다. 19개 refinement는 transport 실패 없이 모두 끝났으며, 배심 승인 6개는 Qwen 3.6 fast revision, topic-balanced reserve 13개는 Qwen 3.7 quality revision을 기록했다. 칼국수, 껍데기, 두바이 초콜릿은 각각 근거가 있는 source range로 복구됐고 오프닝 음악 fast-pass 3개는 모두 confidence 0.1 reject였다.
- 관련 routing/topical/Worker 단위 테스트 82개와 전체 strict TypeScript·ESLint·71개 파일 764개 테스트가 통과했다. production build는 main JS 616.32 kB(178.26 kB gzip), CSS 84.99 kB이며 Wrangler dry-run은 205.93 KiB(39.74 KiB gzip)다. Worker `3cccd355-836b-4087-8e22-5ae7c2f79279`가 정책 `1.11.0`과 두 refinement revision을 운영한다. 기능 commit `575edee`의 GitHub Pages workflow `29919316436`은 build·deploy를 모두 통과했고, 공개 page와 `index-CI0PmtrA.js`, `index-CQgw0N11.css`는 HTTP 200을 반환했다. 브라우저 smoke는 `Ex Clipper`, `클립 분석 AI`, `v0.3.39`를 확인했다.

## 2026-07-22 `0.3.38` 교환학생 출연진 전체 맥락·Gemini 경로 보강

- 사용자 확인에 따라 교환학생 방송의 출연진 정답을 `세라 교수님`, `아모레또`, `유레카`, `세나 아르벨`, `토로리 코코`, `망징이`로 고정하고 기존 `교수님` 표기를 `세라 교수님`으로 교정했다. 짧은 호칭은 canonical 이름으로 정규화하되 음성 유사도만으로 화자를 단정하지 않는다.
- 기존 구현은 후보별 대표 화면 분석에만 닫힌 출연진 자료를 사용했고 전체 방송 맥락 요청에는 roster가 없었다. roster v2를 해당 치지직 다시보기 번호 또는 고유 제목에만 연결하고, overview·주제 discovery·최종 jury·정밀 refinement 전 단계가 같은 서버 고정 roster ID를 사용하도록 확장했다. Worker prompt에는 이름·역할·안전한 호칭만 넣고 외형 자료는 전체 텍스트 맥락에 보내지 않는다.
- Cloudflare production에는 `GEMINI_API_KEY`와 `QWEN_API_KEY` Secret 이름이 모두 존재함을 값 노출 없이 확인했다. 후보 모델 ID에 묶인 단일 Gemini endpoint를 후보·대사 역할별 endpoint 구성으로 분리하고, `/healthz`가 키·workspace·endpoint 없이 두 Gemini 역할의 준비 boolean을 보고하도록 provider manifest를 `1.2.0`으로 올렸다.
- 오류별 대체는 한 번으로 제한한다. 후보 해석은 provider 간, 전체 맥락은 Qwen 3.7/3.6 간 기존 bounded 전환을 유지한다. 긴 대사 분석은 명시적인 429·인증·404·5xx 응답에서만 Qwen↔Gemini를 한 번 전환하고, 이미 과금됐을 수 있는 timeout·network 단절·성공 후 malformed 응답과 공통 입력 오류는 자동 재전송하지 않는다.
- GitHub review는 canonical 후보를 삭제하지 않는 projection 무결성, 사용자 판단 우선, 저장 결과 복구와 coverage 의미 구분을 계속 수용했다. 전면 state machine·진단 UI·단일 Runtime Manifest 재구성은 회귀 범위가 커 이번 패치에서는 보류했고, PR 강제 절차는 저장소 소유자가 이 세션에 main 배포를 명시적으로 허용한 운영 방식과 충돌해 적용하지 않았다.
- roster·protocol·prompt·client·provider·Worker 단위 회귀 105개가 먼저 통과했다. 최종 release gate는 strict TypeScript, ESLint warning 0, 71 test files / 759 tests, production Vite build, Wrangler dry-run을 모두 통과했다. 메인 번들은 615.51 kB (178.01 kB gzip), CSS는 84.99 kB, Worker upload은 204.87 KiB (39.58 KiB gzip)다.
- 기존 Cloudflare `GEMINI_API_KEY` 값은 준비 검사에서 유효하지 않았다. 첫 복구에서는 `Eurekasong` 프로젝트 키를 임시로 주입했지만, 사용자가 기존 Gemini 3.1 Pro 호출에 쓰던 `Amoretto` 키를 그대로 사용해야 한다고 정정했다. 이에 따라 Google Cloud `Amoretto Project`의 2026-07-20 생성·사용 가능·Gemini API 제한 키를 값 노출 없이 다시 확인했다. 해당 키는 `gemini-3.1-pro-preview`와 `gemini-3.6-flash` 최소 호출에서 모두 HTTP 200을 반환했으며, 성공을 확인한 뒤에만 Cloudflare Secret을 교체했다.
- Amoretto 키 교체 뒤 Gemini를 잠시 production primary로 올려 10초 canonical WAV와 대표 JPEG 4장으로 두 운영 경로를 다시 검증했다. 후보 화면·오디오 해석은 HTTP 200, `gemini-3.6-flash`, `fallback=false`, `finishReason=STOP`, 한국어 대사·설명으로 통과했고, 방송 대사 전사도 HTTP 200, 같은 모델, `fallback=false`, 한국어 `textKo`를 반환했다. 검증 뒤 최종 Worker `3705a25f-3989-49d7-9ecf-fa63a3593d98`는 평상시 기본값을 Qwen/Qwen/Qwen으로 복구했으며 두 Gemini 역할 readiness는 모두 `true`다.
- 기능 커밋 `abe660d`를 `main`에 push했고 GitHub Pages workflow `29910707853`의 check·build·deploy가 모두 성공했다. 공개 페이지와 `index-DBxHzkcF.js`, `index-CQgw0N11.css`는 HTTP 200을 반환했고, 브라우저에서 `Ex Clipper`, `클립 분석 AI`, `v0.3.38`, 저장된 분석 2개를 렌더링하며 warning/error log 0개를 확인했다.

## 2026-07-22 `0.3.37` truthful context recovery and coverage-aware timeline

- Accepted the narrow integrity portion of the GitHub context-pipeline review: a saved run that never produced whole-broadcast context must not be presented as an AI-confirmed `0 topics / 0 leads` result, and coverage gaps must not be interpreted as uneventful time.
- The implementation restores paid whole-context summaries, semantic chapters, leads, AI projections, and already-refined semantic candidates from the analysis session without requiring the source video to be reconnected. A restore epoch prevents an older asynchronous read from overwriting the run the editor most recently opened.
- Timeline work distinguishes restoring, running, failed, not analyzed, legacy-unsupported, partial-evidence, and completed-empty states. Unsupported or unperformed dimensions use an em dash instead of a false zero, while explicit evidence gaps receive their own striped source-time layer and legend.
- Release gate passed: strict TypeScript, ESLint warning 0, 71 test files / 751 tests, production Vite build, and Wrangler dry-run. The main bundle is 614.39 kB (177.68 kB gzip), CSS is 84.99 kB, and the unchanged Worker upload is 193.93 KiB (37.96 KiB gzip). Commit `4431424` was pushed to `main`, and GitHub Pages workflow `29906235113` completed successfully. The public app returned HTTP 200 with `index-BayRWjRR.js` and `index-CQgw0N11.css`; the script contains `0.3.37`, `ExClipper`, `클립 분석 AI`, and the new missing-context explanation. Opening the existing 02:15:14 saved result in the public browser showed five numbered candidates and 30-minute ticks unchanged, while the former false `0 topics / 0 leads` state now renders `—`, `주제 미분석`, `단서 미분석`, and the explicit fast-pass-only notice.

## 2026-07-22 `0.3.36` topic-balanced semantic recall and gameplay abstention

- Reproduced the regression against all three real caption-backed samples instead of comparing candidate counts. In food talk, the topical model had already found the expected 칼국수, 껍데기, and 두바이 초콜릿 events, but the downstream `top 3 + three reserves from the dominant selected topic` policy discarded them. In the Minecraft relay, the selection model assigned high confidence to ordinary coordinates, mining, caves, base building, and generic chat banter because the parser only enforced a numeric `0.93` threshold.
- Expanded the comparative meaning reservoir from 24 to 32 grounded leads and made the Qwen 3.7 jury topic-aware: different questions, targets, causes, and reaction payoffs inside the same recurring format are independent events rather than one topic representative. Context cache routing advanced to `1.8.0`, topical discovery to `1.2.0`, and the jury model revision now records the topic-balanced contract.
- Replaced the dominant-topic reserve rule with confidence-gated, topic-balanced farthest-midpoint sampling. One jury approval can fan out to at most six internal checks; multiple independent approvals progressively unlock up to twenty cheap caption-text refinements. This is an internal recall pass only: no-caption paid ASR remains capped at four, the resulting new semantic proposal set remains capped at twelve, and each multimodal detail run keeps its existing twelve-target bound.
- Raised the context request reservoir contract to 32 candidates/leads and the normal per-client Worker allowance from 12 to 30 requests per minute. Caption refinement uses a stable three-request pool, so the wider internal evidence pass cannot create an unbounded API burst. The live food run completed all 20 refinement calls with HTTP 200; overview, four discovery slices, jury, and all refinement text calls cost about `$0.073543` at list price, before the separately budgeted candidate AV pass and with no ASR charge because public captions were available.
- Advanced the shared role plan to `1.9.0`: broadcast context now reports its real maximum of 26 client calls instead of the obsolete single-call plan. Budget policy `1.2.0` raises compressed context/refinement text reserve from `$0.06` to `$0.08`, covering the measured full-caption run while the twelve-hour worst-case envelope remains below `$1`.
- Scoped gameplay calibration to the candidate's topic while classifying the broadcast type from repeated chapter evidence. A closing mention of the next Minecraft stream no longer raises every food candidate to the game threshold. Conversely, a real gameplay broadcast keeps the game classification even when an individual semantic title merely says `base building` or `time shortage`. Ordinary gameplay and generic low-stakes chat teasing are deterministically rejected after model output; exact accountability, rare achievements, material bugs, consequential rule/financial disputes, and long-running payoffs remain explicit exceptions.
- Live identity regressions passed. Food rejected the three opening fast-pass signals and refined 칼국수 to 18:00–21:00 source cells, 껍데기 to 22:00–26:00, and 두바이 초콜릿 to 26:00–29:00 before final 30–60 second AV placement. The accidental-subscription run preserved the initial mistake/apology, repeated responsibility statement, compensation proposal, and later apology/compensation closure. The Minecraft relay compared 26 grounded leads and returned zero refinement targets. Selection-stage text costs were about `$0.0318` for subscription and `$0.0256` for relay.
- Kept the accepted GitHub pipeline review boundary: context AI only updates the recommended/needs-review/deprioritized/insufficient-evidence projection. Canonical candidates, user approval/exclusion, and boundary revisions are not deleted or rewritten. The proposed full App orchestration state-machine rewrite and Runtime Manifest consolidation remain separate migrations rather than being mixed into this measured quality repair.
- Release gate passed: strict TypeScript, ESLint warning 0, 69 test files / 743 tests, production Vite build, and Wrangler dry-run. The main bundle is 607.84 kB (175.84 kB gzip), CSS is 83.17 kB, and the Worker upload is 193.93 KiB (37.96 KiB gzip). Worker `7ceeb8a0-02ea-4df9-9b8a-b51cb57b2537` exposes role policy `1.9.0` and the topic-balanced jury revision, passed production-Origin CORS, and reports the corrected 32-candidate validation boundary. Commit `c210c5f` was pushed to `main`, and GitHub Pages workflow `29903872467` completed successfully. The public app served the versioned JavaScript and CSS assets with HTTP 200; the JavaScript contains `0.3.36`, `ExClipper`, and `클립 분석 AI`.

## 2026-07-22 `0.3.35` proven transcript transport, resumable paid cells, and closed-set cast grounding

- Reproduced the active production Qwen Omni long-audio boundary with canonical Korean WAV samples. 60 and 90 seconds returned structured Korean transcripts; 120 and 180 seconds ended as empty edge 500 responses. Replaced the unsupported 210-second assumption with a 90-second browser/Worker/proxy contract and reduced the Base64 request envelope accordingly. An overlong request now fails as bounded JSON before any upstream call.
- Raised the transcript Worker envelope from 64 to the mathematically bounded 240 requests. Fragmented uniform sampling can require 216 requests and twelve two-minute event windows add at most 24; the 12-hour regression verifies the bound while preserving the same `$0.42` duration budget. The 02:15:14.817 food source now uses 91 verified-size requests instead of 39 oversized requests.
- Added source-range checkpoint recovery for paid ASR. Every successful partial result is merged into a chronological chapter map and write/readback verified while unfinished cells remain gaps. Reload/retry subtracts stored chapter ranges from the current sampling windows and sends only uncovered ranges. Compatible 210-second cells remain usable; mixed old/new sessions receive an explicit mixed revision instead of being relabeled.
- Added the fixed `chzzk-video-13996057-v1` cast roster grounded from public replay frames and introduction speech: 토로리 코코, 세나 아르벨, 망징이, 유레카, 아모레또, 교수님. It is attached only when the selected filename contains replay `13996057` or the reviewed `교환학생/합격생/장학생` title, so unrelated sources such as food talk cannot inherit those names. The browser sends only the roster ID; the Worker expands the reviewed descriptors. Roster attribution needs two distinct same-frame traits and confidence at least 0.88. Unknown names, arbitrary public roster values, low-confidence appearance guesses, and voice similarity are removed. Identity remains display-only evidence and cannot alter selection or boundaries.
- Limited representative-frame preparation to two browser decoders at once. Candidate explanations still run through the existing two-request parallel AI pool, so this fixes the observed `대표 화면이 제공되지 않음` failure mode without serializing paid interpretation.
- Advanced routing policy to `1.8.0`, candidate route to `bounded-cast-v4`, transcript sampling plan to `1.2.0`, and transcript Worker protocol to `1.1.0`. Previous Qwen/Gemini candidate revisions, v2/v3 route manifests, and the preceding transcript revision remain readable paid-result identities.
- Classified compressed-context failures before using its one alternate Qwen tier. Timeout, 5xx/network, 429, missing model, response-format, and invalid-response failures may switch once; authentication, invalid shared arguments, and explicit rejection stop without a duplicate paid request. Public headers preserve the primary reason and bounded fallback failure class without provider text.
- Reapplied the GitHub pipeline review selectively: canonical candidates and editor decisions remain authoritative; partial AI evidence is checkpointed and failure-preserving. The proposed broad orchestration rewrite and PR-only process remain deferred because they would expand this personal direct-deploy slice without fixing a measured runtime failure.
- Release gate passed: strict TypeScript, ESLint warning 0, 68 test files / 736 tests, production Vite build, and Wrangler dry-run. The main bundle is 607.25 kB (175.57 kB gzip), CSS is 83.17 kB, and the Worker upload is 190.73 KiB (37.22 KiB gzip). Worker `cb81ff49-3716-4f00-bebf-c3a96d99e0ef` passed health, production-Origin CORS, local rejection of a 90,001 ms request, and a live 10-second Korean transcript smoke. GitHub Pages workflow `29892305222` completed both build and deploy successfully. The public app served the versioned JavaScript and CSS assets, rendered `ExClipper`, `클립 분석 AI`, the source-file input, and `v0.3.35`, and produced no browser warning or error logs.

## 2026-07-22 `0.3.34` Gemini 3.6 Flash GA fallback upgrade

- Upgraded the candidate audio-plus-representative-frame fallback and the explicitly selected Gemini long-audio transcript adapter from `gemini-3.5-flash` to the GA `gemini-3.6-flash`. The difficult-candidate fallback role is aligned to the same model while Qwen3.5 Omni Flash remains the deployed candidate primary and Qwen3.7 Plus remains the editorial jury.
- Kept the existing GenerateContent contract: one user turn, timestamp-labelled JPEG frames, WAV audio, structured JSON response format, `thinkingLevel: MEDIUM`, no deprecated sampling parameters, and `store: false`.
- Advanced the provider policy to `1.7.0`, candidate route revision to `qwen3.5-omni-flash_then_gemini-3.6-flash_bounded-v3`, and provider configuration to `1.1.0`. The separate broadcast-context cache fence remains `1.6.0`, so this candidate-only fallback change does not discard already-paid Qwen overview/discovery/jury results.
- Preserved every paid `gemini-3.5-flash-grounded-frames-v2-2026-07-22` result and the previous v2 route manifest as readable legacy identities. Recovery never relabels a 3.5 result as 3.6 and does not pay to regenerate it merely because the fallback model advanced.
- Cloudflare version metadata exposes a `GEMINI_API_KEY` binding name, but a zero-traffic and temporary live readiness probe of the 3.6 version returned `PROXY_NOT_CONFIGURED` before request validation. No sample audio reached Google and no Gemini charge was incurred. Production was restored to the prior Qwen-primary Worker immediately; Gemini must not be enabled as primary until the secret value is refreshed and the real food-talk smoke passes.
- Replaced unconditional cross-provider switching with an explicit candidate failure matrix. Timeout, network/5xx, 429, authentication, missing-model, response-format, and malformed provider responses may use the one bounded alternate; invalid shared arguments and provider rejection do not trigger duplicate paid work. Public headers record the bounded reason, or both failure classes when the alternate also fails, without exposing provider bodies.
- Applied the accepted integrity portion of the GitHub context-pipeline review. Context AI no longer removes candidates from the canonical array: it stores `recommended`, `needs-review`, `deprioritized`, or `insufficient-evidence` projections. Unapproved low-priority/music candidates skip paid detail analysis, but stay visible and keep editor review/boundary state; approved candidates override the AI queue projection.
- Release gate: strict TypeScript, ESLint warning 0, 67 test files / 723 tests, production Vite build, and Wrangler dry-run passed. The generated main bundle is 603.09 kB (174.32 kB gzip), CSS is 83.17 kB, and the Worker upload is 182.15 KiB (35.65 KiB gzip).

## 2026-07-22 `0.3.33` comparative editorial jury and broadcast event map

- Rechecked the food-talk ground truth against the production YouTube caption track. The expected events occur around 19:38–20:16 (칼국수), 22:29–23:29 (껍데기), and 28:19–29:19 (두바이 초콜릿). The three previous fast-pass peaks at 01:11, 02:38, and 03:56 contain explicit music cues and are not the expected clips; candidate count alone is no longer treated as a passing regression.
- Reordered the automatic pipeline so the complete caption/transcript map and cheap Qwen whole-context gate run before candidate audio/video perception. Exact source-fenced caption text is attached to each fast candidate, explicit `[음악]`-only ranges fail closed, and only surviving candidates consume multimodal calls.
- Added a caption-native semantic refinement route. Context leads are split across their complete evidence range into timestamped 30-second caption cells at zero ASR cost, while sources without captions retain the bounded one-minute Qwen ASR route.
- Split semantic routing into a cheap high-recall discovery pass and a comparative editorial jury. Qwen3.6 Flash scans up to four chronological topic slices and merges at most 24 grounded leads; Qwen3.7 Plus then compares the complete reservoir and may abstain. Routing/cache revision advanced to `1.6.0`.
- Fixed broad-overview deduplication so a long umbrella topic no longer erases distinct short events inside it. Caption refinement now takes three jury selections plus three nearby context reserves, preserving exact events without sending all 24 leads to multimodal analysis.
- Calibrated the final jury against routine gameplay. General talk requires 0.88 confidence, gameplay requires 0.93, and ordinary falling, mob mistakes, resource loss, or ad-hoc building explanations are explicit negatives unless a rare achievement, accountability event, serious bug, social conflict, or long payoff is grounded.
- Rebuilt the event map as an editorial information view: chronological candidate numbers match their cards, 30-minute rulers cross four labeled layers, topic sections use distinguishable bands, and numbered whole-context leads share category colors with their source-time bars. The potentially long explanation list is collapsed by default while every lead remains visible on the time axis.
- Added bounded production token-usage response headers for whole-context calls and the live evaluation harness. This enables list-price cost accounting from actual prompt/completion tokens without exposing captions or model output.
- Live caption regressions: food talk preserves 칼국수·껍데기·두바이 초콜릿 in the bounded six-lead refinement set at about `$0.0308` text cost; accidental subscription selects the discovery, formal apology, compensation, and later self-correction sequence at about `$0.0306`; the Minecraft relay returns zero after the gameplay-calibrated jury at about `$0.0253`.
- Release gate: strict TypeScript, ESLint warning 0, 67 test files / 715 tests, production Vite build, Wrangler dry-run, current Worker deployment, and maximized 1600px light/dark browser QA pass. The matching Pages workflow and public smoke are required for the release handoff.

## 2026-07-22 `0.3.31` bounded Qwen/Gemini runtime failover

- 클립 검토 화면에서는 지난 분석 목록과 현재 편집 작업 요약을 숨겨, 타임라인과 후보 검토가 첫 화면에 더 빨리 보이도록 정리했다.
- 넓은 화면의 후보 검토 영역을 영상 39%·단서 61%에 가까운 비대칭 2열로 바꾸고, 오른쪽 단서 열만 화면 높이 안에서 스크롤되도록 했다. 1120px 이하에서는 다시 자연스러운 단일 열로 전환한다.
- 후보 타임라인에 30분 단위 눈금과 시각 라벨, 겹침을 피하는 3단 번호 마커, 방송 주제 구간 띠, 전체 맥락 AI가 새로 찾은 의미 단서 레일을 추가했다. 숫자·카드·의미 단서는 모두 동일한 원본 시각에 연결되며 후보가 없는 잠재 점수 지형도 계속 비교할 수 있다.
- Qwen 압축 전체 맥락 계약에 실제 챕터 ID로 근거가 확인되는 2~16개의 주제 구간을 추가했다. 같은 주제는 합치고 시간순·비중첩 범위만 허용하며, 잘못된 범위는 이미 결제된 다른 판단을 버리지 않고 해당 구간만 제외한다. 라우팅 정책을 `1.3.0`으로 올려 과거의 `주제 구간 0개` 캐시를 새 실행에 재사용하지 않는다.
- 대표 화면 채집용 video element를 문서에 1px로 연결한 뒤 디코딩 완료와 seek 완료를 모두 기다리도록 보강했다. 화면이 끝내 0장이면 브라우저와 Worker 양쪽에서 제공자에게서 받은 시각·게임·인과 추측을 제거하고, 대사 시각과 오디오 단서만 남기는 안전 응답으로 바꾼다.
- 방송 전체 전사 preflight는 더 이상 모든 입력 문제를 같은 문장으로 표시하지 않는다. 파일 구조, 청크 수, 중복 ID, 소수 시각, 겹침, 원본 초과, 210초 초과를 구분해 보고한다. 음식 토크 02:15:14.817 계획은 39개 청크로 정상 허용됨을 회귀 테스트로 고정했다.

- Connected `aiModelRoutingPolicy.ts` to the Cloudflare runtime rather than leaving it as a planning-only catalog. Production enables `AI_PROVIDER_FALLBACK_MODE=bounded`.
- Candidate audio+frame perception now performs the configured provider's bounded transient retries and, only if that provider still fails, one alternate-provider attempt. The deployed route is Qwen3.5 Omni Flash then Gemini3.5 Flash; selecting Gemini as primary reverses the single fallback order when Qwen credentials are valid.
- Compressed broadcast context now performs one model-tier fallback: overview/refinement use Qwen3.7 Plus then Qwen3.6 Flash, while the cheaper selection pass uses Qwen3.6 Flash then Qwen3.7 Plus. Provider outputs still pass the same strict local parser before success is returned.
- Kept long broadcast transcription single-provider per chunk. Timeout and malformed-response retries may duplicate duration billing, so Gemini is not called automatically after a Qwen ASR attempt. Failed chunks remain explicit coverage gaps.
- Added public response metadata headers for model ID, model revision, and fallback use. Candidate Worker validation accepts only the exact Qwen or Gemini model/revision pair and defaults to the legacy Qwen identity only when an older Worker returns no metadata.
- Changed the Candidate Pass B run manifest to a route revision and added per-candidate actual model persistence in insight schema `1.3.0`. Existing schemas 1.0–1.2 remain readable; impossible cross-provider model/revision pairs fail closed.
- Targeted routing, provider, Worker proxy, Worker lifecycle, client protocol, frame safety, context topic, and transcript preflight tests: 7 files / 74 tests passed before the full release gate. Full check, build, dry-run, sample regression, and deployment verification remain required below.
- Release gate before deployment: TypeScript strict, ESLint warning 0, 65 test files / 694 tests, Vite production build, and Wrangler dry-run passed. The three real sources completed full fast-pass coverage: food talk stayed at exactly 3 candidates with peaks 01:11.5, 02:38.5, and 03:56.5; subscription and relay retained 24-candidate broad reservoirs for the later semantic selector rather than being treated as positive ground truth.


## 2026-07-22 `0.3.30` grounded participant attribution and strict context recovery

- Added a bounded `identifiedParticipants` result to the existing candidate audio+frame request. Qwen3.5 Omni Flash or Gemini3.5 Flash may emit up to six names only when an on-screen label or audible name call grounds the attribution; avatar appearance and voice resemblance are explicitly forbidden as name evidence.
- Persisted participant name, role, evidence basis, Korean evidence, confidence, and candidate-relative verification time in Candidate Pass B insight schema `1.2.0`. Older 1.0/1.1 sessions reopen without migration loss, while legacy provider responses are promoted to an empty participant list.
- Presented grounded names directly on candidate cards and in the expanded evidence panel without changing candidate score, eligibility, approval, or clip bounds. The feature reuses the existing paid multimodal call and adds no API request.
- Fixed the full-context parser so malformed semantic chapter shapes or unobserved chapter references no longer become a successful empty chapter result. Strict parsing rejects the response; paid-response recovery keeps only independently valid, chronological chapters.
- Kept role-based model routing cost-aware: Qwen3.5 Omni Flash handles candidate audio/video and sampled transcription, Qwen3.7 Plus handles compressed broadcast context and the first difficult-candidate judgment, Qwen3.6 Flash remains the low-cost text selection path, Gemini3.5 Flash is the candidate fallback, Gemini3.1 Pro is the optional fallback for at most three difficult adjudications, and DeepSeek V4-Pro remains a text-only emergency context fallback.
- Re-ran the three local fast-pass samples. Food talk remains exactly three candidates at approximately 01:11, 02:38, and 03:56; the broader subscription and relay reservoirs remain available for the subsequent semantic gate. TypeScript, ESLint, all 65 test files / 686 tests, and the production build pass.

## 2026-07-22 `0.3.29` Qwen multimodal hierarchy and negative-stream precision

- Switched the deployed candidate audio+frame path to `qwen3.5-omni-flash` and kept `qwen3.7-plus` for compressed whole-broadcast routing. Candidate frames now carry relative timestamp labels, small unreadable text and avatar-frame motion are explicitly uncertain, and the UI uses provider-neutral AI wording.
- Replaced the stale Gemini cost display with Singapore Qwen3.5 Omni modality pricing. The conservative twelve-candidate 45-second estimate is about `$0.05`; whole-broadcast transcription, context, refinement, adjudication, and retry reserves remain under the `$1` planning envelope.
- Added hierarchical semantic refinement. A broad overview lead is re-transcribed in one-minute cells under a `$0.03` reserve, parent events are refined in parallel into up to three distinct moments, and the evidence cue selects the final 60-second source cell rather than a potentially wrong broad midpoint.
- Added a precision-first routine-gameplay gate after model output. Ordinary falling, dying, getting lost, resource collection, crafting, construction, and survival do not add editor cards solely because the streamer describes them dramatically; accountability, rare achievements, serious bugs, social conflict, and long-running payoffs remain exceptions.
- Added best-effort matching YouTube Korean captions through the public Android player/timedtext route. The selected file's bracketed video ID is validated, successful captions become the saved complete transcript map, and 403/429/missing captions fall through to bounded Qwen audio transcription.
- Three real-sample checks now satisfy separate contracts: food overview recovers the broad quiz range and the production refinement separates 칼국수·껍데기·두바이초콜릿; accidental subscription recovers the exact apology/accountability cells; Minecraft relay produces zero selected and zero discovered clips.
- Worker deployments advanced through prompt and transport smokes; the current verified Worker is `cd863679-9423-41fd-a512-95c8f606ad89` before the final static release. Targeted tests, TypeScript, ESLint, and the Vite production build pass.

## 2026-07-22 `0.3.27` context-qualified selection and negative ground truth

- Reframed the three long-form samples as distinct evaluation contracts: food talk preserves the known 칼국수·껍데기·두바이초콜릿 positives while rejecting opening music; the Minecraft relay is a valid all-negative/abstention sample; the accidental-subscription stream requires the exact apology/accountability moment and does not invent a timestamp before human annotation.
- Added Event Episode grouping before temporal density estimation so multiple detector fragments from one real-world moment do not inflate burst density or occupy several detail-analysis slots. Coverage quotas now use square-root density weights and remain soft, duplicate similarity reads the nested audio event kind, and selection is deterministic under shuffled input.
- Added an explicit semantic eligibility gate and aggregate rejection diagnostics. `ineligible` candidates and below-floor events never fill unused detail budget; a whole-broadcast judgment may return zero final candidates.
- Expanded the broadcast-context schema with `select | review | reject`, confidence, bounded rejection reasons, `apology-accountability`, `music-or-intermission`, and `not-clip-worthy`. The DeepSeek prompt now forbids forced clip counts and requires exact apology/context evidence rather than loudness alone.
- Registered a bounded role-based model plan: Gemini 3.5 Flash for operating candidate perception, Qwen3.5 Omni Flash as the short audio-video fallback, Qwen3.6 Flash for sampled visual chapters, DeepSeek V4 Pro for compressed whole-broadcast reasoning, and Gemini 3.1 Pro/Qwen3.7 Plus for at most three difficult adjudications.
- Added a cost-bounded whole-broadcast sampling plan. A complete supplied caption track gives full text coverage without paid ASR; otherwise every ten-minute cell receives distributed samples and up to twelve event neighborhoods are guaranteed coverage under a `$0.42` Qwen ASR allocation. Sources that fit the allocation receive complete audio coverage, while a twelve-hour source retains broad uniform coverage instead of following loud events only.
- Updated the active Gemini 3.5 Flash planning estimate to the official flat `$1.50/M` input and `$9/M` output rates: twelve 45-second audio+four-frame candidates are approximately `$0.20` before retries and thinking-token variation.
- Restored the Worker deployment default from the not-yet-active Qwen adapter to Gemini. This removes the configuration path that returned `PROVIDER_NOT_ACTIVE` for every candidate request; Qwen remains fail-closed until a live transport smoke test passes.
- Preserved the earlier audio recall/music fix: a sustained dynamic vocal reaction can survive a low speech-band ratio, while generic visual change alone no longer rescues a music-like dialogue lead.
- Verification: 53 test files / 634 tests pass, ESLint passes with zero warnings, TypeScript and the production Vite build pass. The remaining build output is the existing large-chunk advisory, not a failure.

## 2026-07-21 `0.3.23` parallel Gemini state transition fix

- Pass B's run state now accepts a valid terminal result or gap for any still-pending candidate. The previous single `activeCandidateId` guard could reject a normal Gemini response that arrived early from the bounded parallel pool.
- The active candidate remains a UI progress hint, while candidate ID, proposal revision, and pending/terminal state remain the safety fences.
- Verification: domain and Worker client regression tests cover out-of-order candidate results; full check and production build required before release.

## 2026-07-21 `0.3.22` parallel Gemini event ordering fix

- Pass B now validates progress, transcript results, and candidate gaps by candidate ID instead of assuming terminal events arrive in candidate-list order. This fixes the failure that occurred when the bounded parallel requests returned candidate 2 before candidate 1.
- Added a regression test that interleaves two candidates' progress and delivers a transcript before the earlier candidate's gap.
- Verification: full typecheck, ESLint, Vitest suite, and production build required before release.

## 2026-07-21 `0.3.21` Gemini failure reason visibility

- Gemini Pass B failures now retain the existing redacted provider reason code in the user-facing message (`PROXY_BAD_REQUEST`, `PROXY_RATE_LIMITED`, and similar), without exposing provider response text or secrets. This makes a failed analysis diagnosable instead of showing only a generic failure label.
- Verification: full typecheck, lint, test, and production build required before release.

## 2026-07-21 `0.3.20` analysis-session material persistence

- Treat each analysis `runId` as one durable analysis session bundle. Candidate Pass B snapshots now also retain one impact thumbnail per candidate, so a recovered session can show its visual material after refresh without re-running Gemini.
- Thumbnail persistence is written as soon as Pass B frame sampling completes and is flushed before the Pass B run reaches a terminal UI state. Existing `1.0.0` insight records remain readable.
- Recovery ignores a Pass B snapshot whose input signature does not match its analysis session, preventing stale AI overlays from attaching to a valid result.
- Verification: storage and recovery regression coverage added; full check and production build remain required before release.

## 2026-07-21 `0.3.19` audio-first candidate count and bounded Gemini analysis

- Audio reaction anchors are now authoritative when available. Nearby chat still strengthens the same candidate, while unrelated chat bursts no longer create extra standalone candidates and inflate the daily result count.
- Gemini Pass B keeps two candidate requests in flight at once. This preserves parallel analysis while avoiding a burst of simultaneous requests that can trigger quota/rate-limit failures.
- Verification: added regression coverage for audio-plus-unrelated-chat fusion; full check and production build remain required before release.

## 2026-07-21 `0.3.18` restore dialogue leads, score landscape, and impact thumbnails

- Restored the previous quiet-but-novel dialogue lead so the known `2026 07 17 - 음식 토크[KzAW3yow80Q].mp4` sample returns three audio candidates again. The added filters remain limited to steady song/MV plateaus and non-distinctive opening/ending edges.
- Added a faint score landscape behind the candidate timeline. It combines audio, chat, visual, and fused candidate signal ranges; an unmarked glow is now a review lead rather than an invisible discarded region.
- Candidate video sampling now centers four screenshots around the reaction peak instead of using fixed arbitrary positions. Timeline thumbnails choose the nearest impact frame, while Gemini receives the same focused frame set.
- Verification: the known sample produces three audio candidates, audio regression tests pass, and the full check/build remains required before release.

## 2026-07-21 `0.3.17` parallel candidate explanations

- Pass B now starts Gemini requests as soon as each candidate is decoded instead of waiting for the previous candidate's explanation to finish. Multiple audio+frame requests can be in flight together, while existing candidate-ID fencing, partial persistence, gaps, and completion counts remain unchanged.
- Cancellation now aborts every active candidate request, and each request clears its own PCM buffer after completion. A regression test verifies that the second candidate request starts before the first Gemini response arrives.
- Verification: typecheck, ESLint, and the full Vitest suite pass.

## 2026-07-21 `0.3.16` candidate timeline overview

- Added a full-source candidate timeline before the detailed cards. Each candidate is marked by an `O` at its peak position on the source-duration line, with start/end labels and a clickable marker.
- Added compact timeline cards with a representative JPEG capture when Pass B frame sampling is available, the candidate time, and a one-line Gemini or signal-based summary. Marker/card clicks reuse the existing inline preview flow.
- Kept the timeline usable without a source preview by showing a capture placeholder and disabling playback controls until the source is connected.
- Verification after the UI change: typecheck, ESLint, 581 Vitest tests, and production build all pass.

## 2026-07-21 `0.3.16` reaction-only fast pass and music plateau suppression

- Rolled the fast candidate detector back to the pre-dialogue-signal behavior. Quiet speech-band novelty no longer creates a candidate by itself; candidates again require the loudness/reaction anchor path.
- Added a conservative steady-music/MV gate for long, loud plateaus with nearly unchanged RMS, speech-band ratio, and zero-crossing rate. These windows are classified as sustained background and are not emitted as clip candidates.
- Bumped the signal-engine manifest so persisted results from the previous dialogue/music behavior are not silently reused after reload.
- Verification: the audio scoring suite passes (17 tests), ESLint passes with zero warnings, and the production build succeeds.

## 2026-07-21 — `0.3.15` header title and music false-positive guard

- The header now centers `클립 분석 AI` between the ExClipper brand and the personal-editor label at the same desktop scale as the brand. The duplicate page heading was removed so the title has one clear location.
- The `dialogue-issue-signal` path introduced in `0.3.13` allowed quiet, novel speech-band changes without a loudness rise. Harmonic/compressed music can satisfy that proxy, so the dialogue lead now also requires a modest within-window crest; loud streamer reactions continue through the normal vocal-reaction path.
- Added a regression fixture for a quiet harmonic music change and preserved the quiet dialogue fixture.

## 2026-07-21 — `0.3.14` automatic phase, recovery, and fixed-segment guard

- Candidate Pass B evidence and Gemini insights now use a dedicated IndexedDB record keyed by analysis run. Partial snapshots are serialized in order, recovered snapshots are filtered to the current candidate set, and a write epoch blocks late writes after a new source/run starts.
- The candidate result area now exposes one compact automatic-phase status, places optional reaction/Gemini panels side by side, and centers the candidate list so the user can stay in the result context without scrolling back to setup copy.
- Fixed non-vocal opening/ending bursts and recurring break segments are suppressed. A program-edge segment remains eligible only when it has a distinctive vocal/dialogue anchor; visual-only exploration is disabled for the fast-pass fusion used by the app.
- Added regression tests for Pass B snapshot storage, visual-only suppression, and fixed non-vocal edge bursts.

## 2026-07-21 — desktop workspace and multimodal highlight pass

- The first viewport is now a desktop-first editing workspace (`1440px` content width): source input and readiness summary share the top row, while the summary stays visible as the user reviews the file.
- Once the fast signal pass completes, Pass B starts automatically for the top candidates. The user can still cancel it safely; chat import remains optional.
- Gemini 3.1 Pro receives candidate audio plus representative video frames. The prompt now asks for a 200–300 Korean-character event summary covering the visible scene, event, streamer reaction, game/context, on-screen text, and reaction trigger.
- The fast detector now has a conservative `dialogue-issue-signal` path for novel speech-band changes that are not loudness bursts. It is a review lead, not a semantic verdict; Gemini and playback confirmation remain authoritative.
- The UI shows a planning-only Gemini cost estimate for the current candidate count and 45–60 second payloads.
- A public YouTube URL alone is not treated as a transcript source. YouTube's official captions API requires authorized caption-track access, so the next safe integration is an explicit VTT/SRT import or an authorized connector rather than browser scraping.

## 2026-07-20 — `0.3.11` 제품명 ExClipper 전환

### 결정

- 사용자에게 보이는 제품명과 새로 생성하는 클립·편집표·JSON 산출물의 브랜드를 `ExClipper`로 확정했다.
- GitHub 저장소 이름 `rettolight`, Pages 경로 `/rettolight/`, 기존 IndexedDB/localStorage 키, CSS 파일명과 Worker endpoint는 기존 작업의 하위 호환을 위해 유지한다.
- StreamSaver reference CSS는 불변 스냅샷이므로 수정하지 않고, ExClipper 전용 override 주석과 운영 문서만 갱신했다.

### 적용

- 앱 헤더·footer·문서 제목·HTML title·AI 오류 안내를 ExClipper로 변경했다.
- 클립 파일과 편집표 내보내기 파일 이름을 `exclipper-*`로 변경했다.
- package metadata와 `appVersion`을 `0.3.11`로 올렸다.

### 검증 결과

- `npm run check`: 41개 테스트 파일, 568개 테스트가 통과했다.
- `npm run build`와 `npm ci --dry-run`이 통과했다.
- GitHub Actions `29731754780`의 build/deploy가 모두 성공했고, 공개 Pages에서 ExClipper title·헤더·footer와 오류 없는 콘솔을 확인했다.

### 외부 평가 반영

- ExClipper는 상용 클리퍼처럼 모든 판단을 자동 확정하는 제품이 아니라, 무료·로컬·외부 구성요소의 불확실성을 분리해 사람이 짧게 검토하도록 만드는 제품으로 평가 기준을 고정한다.
- 외부 평가가 제안한 핵심 후속 과제는 개인화 모델을 먼저 추가하는 것이 아니라, 허용된 fixture와 사람 기준 구간으로 후보 recall·precision·승인율·경계 수정량을 측정하는 것이다.
- Gemini는 상위 후보의 구조화된 해석과 확인 위치만 보조하고, 빠른 로컬 신호·채팅 신호·사람 승인과 독립된 revision으로 유지한다. 채팅이나 Gemini 실패가 영상 후보를 지우지 않는 현재 경계를 유지한다.

## 2026-07-19 — 제품 계획 수립

### 요청

- 수시간짜리 치지직·YouTube 방송 또는 로컬 원본에서 스트리머 하이라이트·클립 포인트를 기록하고 정리하는 프로그램 계획
- 30초~1분 클립 및 긴 하이라이트 지원
- 컴퓨터 초심자에게 친절한 UI/UX
- GitHub Pages에서 동작

### 적용한 공용 규칙

- 공용 Claude 개발 지침 전체 확인
- 초심자 중심, 기본값만으로 완주, 단방향 시각 흐름
- Before/After, 리스크와 2차 파급 검토
- GitHub Pages의 CORS·라우팅·백엔드·비밀값 제약 선제 반영
- 에이전트별 작업공간 규칙에 따라 `Codex/workspace` 사용
- 사용자 승인 전 커밋하지 않음

### 저장소 상태

- 초기 프로젝트 작업공간은 비어 있었고 Git 저장소가 아니었음
- 다른 서비스 작업 폴더와 분리해 이 문서만 `Codex/workspace`에 생성

### 조사 결과

- YouTube IFrame API는 현재 시각·탐색·구간 재생을 지원하지만 영상 프레임·오디오·파일을 제공하지 않음
- 2026년 4월부터 새 시청자 Clips는 시작 시각 공유로 대체되어 종료 시각은 앱 내부 데이터로 보존해야 함
- CHZZK 공식 Open API에는 일반 VOD 재생·바이트·클립 생성·다운로드 기능이 없고 Client Secret/CORS 때문에 Pages 직접 호출도 핵심 설계로 부적합
- 실제 파일 출력은 사용자가 권리를 가진 로컬 원본에서만 설계
- 장시간 파일은 Mediabunny의 streaming I/O + WebCodecs를 1차 후보로, ffmpeg.wasm은 2GB 미만 지연 폴백 후보로 판단
- GitHub Pages에서 COOP/COEP 응답 헤더를 전제로 하지 않아 SharedArrayBuffer 필수 멀티스레드 WASM은 핵심 경로에서 제외

### 제품 결정 초안

- 흐름: 영상 고르기 → 보면서 장면 표시 → 한 장면씩 검토 → 결과 받기
- 기본 빠른 후보: 클릭 시점 앞 20초 + 뒤 25초 = 45초
- 기록 시 재생을 멈추거나 제목 입력을 요구하지 않음
- 겹친 후보는 자동 병합하지 않고 검토 때 제안
- IndexedDB에는 기록만 저장하고 원본 영상은 복사하지 않음
- JSON·CSV·Markdown을 항상 보장하고 실제 영상 파일은 사전 검사 통과 시 제공
- 자동 추천은 수동 흐름 뒤에 추가

### 생성·수정 파일

- `PRODUCT_PLAN.md`: 제품, UX, 플랫폼 제약, 데이터 모델, 아키텍처, 미디어 처리, 테스트, 로드맵
- `DEVELOPMENT_LOG.md`: 조사와 결정 이력

### 미해결·검증 필요

- 실제 대용량 샘플로 Mediabunny의 정확 trim, 빠른 trim, 디스크 스트리밍 검증
- MP4/WebM/MKV와 코덱별 브라우저 능력표 작성
- CHZZK 공식 임베드 범위가 바뀌는지 구현 직전 재확인
- 제품 이름과 첫 MVP의 실제 영상 출력 포함 범위 사용자 승인

### 커밋

- 수행하지 않음. 공용 규칙에 따라 검토 보고 후 사용자 승인 필요.

### 최종 문서 검증

- UTF-8로 다시 읽어 대체 문자(`U+FFFD`)와 인코딩 손상 없음 확인
- Markdown 코드 펜스 개수가 짝수인지 확인
- 플랫폼·기술 주장은 2026-07-19 기준 공식 YouTube, CHZZK, GitHub, MDN, 각 미디어 엔진 문서로 교차 확인
- 링크 소스와 로컬 원본의 결과 차이를 문서 처음·시나리오·결과 화면에서 반복 확인
- 대용량 처리에서 전체 파일 RAM/WASM/IndexedDB 복사 금지, 순차 렌더, OPFS/직접 디스크 폴백을 명시
- 서버 FFmpeg, ffmpeg.wasm 중심, 화면 녹화, 네이티브 앱, 타임코드 전용 대안의 장단점 추가
- 문서 작업뿐이어서 코드 빌드·런타임 테스트는 수행하지 않음. 단계 0의 실파일 검증이 구현 전 필수

## 2026-07-19 — 사용자 피드백에 따른 AI-first 전면 개정

### 방향 수정 요청

- 몇 시간짜리 원본을 사람이 처음부터 끝까지 보는 부담을 없애는 것이 제품의 가장 중요한 이유
- AI가 하이라이트 지점을 먼저 골라야 하며, 사람은 후보만 검토
- 가능하면 CHZZK 라이브 채팅 반응도 하이라이트 신호로 분석
- 전체 UI는 StreamSaver의 모양과 CSS를 기준으로 하되 Retto 전용 CSS를 별도로 유지

### 기존 결정 중 폐기·강등

- `영상 고르기 → 보면서 수동 표시 → 검토`를 핵심 흐름으로 삼은 결정 폐기
- 수동 마커 MVP를 AI보다 먼저 출시하는 로드맵 폐기
- 수동 표시는 `AI가 놓친 장면 추가`와 분석 실패 시 안전망으로 강등
- `AI는 후속 실험`이라는 설명 폐기

### 새 핵심 흐름

1. 로컬 원본과 선택적 자막·채팅 로그 선택
2. AI가 전체 방송을 저비용 신호로 먼저 스캔
3. 첫 후보가 생기는 즉시 부분 결과 공개
4. 전체 길이의 상위 5~12% 후보 구간만 Whisper·음향·희소 영상으로 정밀 분석
5. `맥락 → 사건 → 반응` 기준으로 30~60초 경계 제안
6. 중복 억제·다양성 정렬 뒤 사람이 후보만 승인·제외·수정
7. JSON·CSV·Markdown과 조건부 실제 클립 출력

### 로컬 AI 조사·결정

- 일반 YouTube·CHZZK iframe 링크는 재생 제어만 가능하고 미디어 PCM·프레임을 AI가 읽는 완전 분석 경로가 아님
- 완전 분석은 로컬 원본 또는 CORS+Range가 허용된 직접 미디어 URL에 한정
- Mediabunny+WebCodecs streaming decode, 전체 파일·PCM·프레임 RAM 복사 금지
- 기본 전체 pass: 16k mono DSP, streaming VAD, 음향 사건 feature, 4~5초당 희소 프레임, 채팅 집계
- 정밀 pass: 후보 구간만 다국어 Whisper 한국어 전사, 1~2fps 영상, 음향 사건 재분석
- 실행 tier: Dedicated Worker WebGPU → 단일 thread WASM SIMD → signals-only
- GitHub Pages에서 COOP/COEP를 핵심 전제로 하지 않아 WASM multi-thread 기본 제외
- 모델은 Pages에 포함하지 않고 immutable revision·hash로 지연 다운로드·캐시·삭제
- 3분 분산 표본으로 실제 RTF를 측정한 뒤 예상 시간을 범위로 표시

### CHZZK 채팅 조사·결정

- 공식 Session API는 연결 이후 CHAT/DONATION/SUBSCRIPTION 실시간 push를 제공
- CHAT에는 `messageTime`, `senderChannelId`, `content`, `emojis`가 있으나 공식 과거 VOD 전체 채팅 조회·다운로드 API는 확인되지 않음
- DONATION·SUBSCRIPTION 공식 이벤트 표에는 timestamp가 없어 수집기가 UTC `receivedAt`과 local `seq`를 붙여야 함
- 임의 공개 채널 URL 구독 방식이 아니며 스트리머 측 Access Token·OAuth 동의가 필요한 구조
- Client 인증과 OAuth code 교환·갱신에 Client Secret이 필요하므로 GitHub Pages 번들에 직접 구현 금지
- Pages 핵심 경로는 JSONL·JSON·CSV 가져오기와 시간 동기화
- 공식 실시간 수집은 별도 로컬 동반 도구 또는 비밀값을 보관하는 백엔드로 분리
- 프로젝트별 participant HMAC, 닉네임 기본 폐기, 원문 opt-in, 1~10초 aggregate, GAP 보존
- 채팅량 외에 고유 참여자·반응 다양성·반복성·후원·구독을 별도 feature로 사용

### StreamSaver UI 기준 반영

- 확인한 실제 원본: StreamSaver 작업공간의 `index.html`
- 원본에는 standalone CSS가 없고 `<style>` 블록이 567줄·24,514자였음
- 별도 LICENSE/NOTICE 파일은 발견되지 않아 reference 파일에 출처와 확인 필요 사항을 남김
- `styles/streamsaver-reference.css`: 원본 style block 스냅샷, 수정 금지
- `styles/retto-highlight.css`: `.rh-` 접두사의 AI 진행·후보·근거·반응 지도·접근성 전용 스타일
- load order는 reference 먼저, Retto stylesheet 다음
- StreamSaver 샘플 PNG는 UI 시안이 아니라 영상 프레임이어서 CSS 자체를 디자인 근거로 사용

### 문서 변경

- `PRODUCT_PLAN.md`를 `0.1.0`에서 `0.2.0`으로 올림
- 핵심 정의·첫 화면·분석 화면·플랫폼 시나리오·아키텍처·상태 머신·폴더 구조·데이터 모델을 AI-first로 개정
- 계층형 분석, robust local baseline, 채팅 지연·도배 보정, 멀티모달 점수, MMR, 경계 목적식, 모델 캐시, 복구, 개인화를 상세화
- AI 벤치마크 데이터셋·Recall@K·Precision@K·검토 시간·하위 그룹·ablation 출시 gate 추가
- 단계 1 종료 조건에 실제 AI 후보 생성과 검토 시간 절감을 명시

### 생성 파일

- `styles/streamsaver-reference.css`
- `styles/retto-highlight.css`

### 커밋

- 수행하지 않음. 사용자 검토 후 승인 전까지 커밋 금지 규칙 유지.

### 최종 검증·트러블슈팅

- StreamSaver 원본 style block과 reference 파일의 출처 주석 이후 내용을 LF 정규화·trim 기준으로 문자 단위 비교: 일치
- `PRODUCT_PLAN.md` Markdown 코드 펜스 28개로 짝수 확인
- 네 파일 모두 UTF-8 `U+FFFD` 0개, CSS/문서 중괄호 개수 일치
- 최초 SHA-256 출력에 사용한 `.NET SHA256.HashData`·`Convert.ToHexString`이 현재 Windows PowerShell 런타임에 없어 실패
- 파일 변경 문제는 아니었으며 호환되는 `Get-FileHash -Algorithm SHA256`으로 다시 검증 성공

## 2026-07-19 — 최신 공용 지침 재감사와 개인 편집 어시스턴트 확정

### 요청과 최종 제품 결정

- 다른 프로젝트를 통해 갱신된 전역 지침을 다시 읽고 현재 계획을 추가 검토
- 추가 검토 결과까지 제품·기술 계획에 반영
- 공유 서비스는 포함하지 않고 제품 정체성을 `개인 편집 어시스턴트`로 확정
- 계정·팀·공동 편집·공용 백엔드·원격 프로젝트 DB·기기간 자동 동기화·클라우드 AI는 범위 밖
- 같은 GitHub Pages 주소를 여러 사람이 각자 사용할 수는 있지만 데이터와 작업은 서로 독립
- CHZZK 공식 실시간 채팅은 공용 서비스가 아니라 선택형 로컬 동반 수집기로만 검토

### 다시 읽은 지침과 안전 조치

- 공용 `AGENTS.md` 확인: 모든 작업 전 `~/.claude/CLAUDE.md`를 함께 적용하고 더 구체적인 프로젝트 지시를 우선
- 공용 Claude 개발 지침 전체 재확인
- 새 핵심 규칙은 9절 `상태와 생애주기 모델링`과 10절 `소규모 서비스 운영 완성도`
- 비교를 위해 Gemini 계열 `AGENTS.md`도 읽었으며 1~7절까지만 가진 이전 계열임을 확인
- 공용 지침의 기존 연결 패턴을 읽었으나, 이번 프로젝트는 공유·클라우드 구성을 쓰지 않기로 확정
- 연결 문서의 비밀값·식별값을 계획서, 로그, 대화, 명령 출력에 복사하지 않았고 외부 resource를 생성·수정하지 않음
- 프로젝트 지시가 공유 서비스 기본값보다 구체적이므로 개인용 Pages-only 경계를 명시적 예외로 기록

### 상태·생애주기 감사 결과

기존 `PRODUCT_PLAN.md`의 단일 상태 목록은 source 검사, 분석 stage, 검토 화면, 렌더, 저장 오류처럼 동시에 참일 수 있는 값을 섞고 있었다. 특히 다음 위험이 확인되었다.

- `pause`·`cancel`의 요청, Worker 정지 진행, checkpoint/정리 확정을 구분하지 않음
- `partial`, `complete`, `failed`가 실행 상태와 결과 coverage 의미를 섞음
- 새로고침·재시도 뒤 이전 Worker callback을 막는 ID·stale event 규칙이 부족
- 정밀 AI 결과가 먼저 공개된 후보를 사용자가 편집·승인한 뒤 늦게 도착해 사람 값을 덮어쓸 수 있음
- 저장·렌더가 실제 transaction/file close 전에 성공처럼 보일 수 있음
- 두 탭이 같은 IndexedDB 프로젝트에 동시에 쓸 때 마지막 저장이 앞선 판단을 덮어쓸 수 있음

이를 다음처럼 개정했다.

- Project, SourceDefinition/Binding/Check, ChatSource/ChatImport/LocalLiveCaptureRun, AnalysisJob/Spec/Run/Chunk, CandidateProposal/Segment/ReviewDecision, RangeCapture, ModelArtifact/Download, SaveCommit, MigrationRun, ExportJob, RenderBatch/Item, AppSession을 수명별로 분리
- 중심 lifecycle과 stage·coverage·runtime tier·storage health·source availability를 분리
- `현재 상태 + event + guard + side effect + 확정 조건 → 다음 상태` 전이표 작성
- `requested → in progress → committed/confirmed`를 명시적으로 분리
- 정상 완료, gap 완료, 사용자 취소, 실패, 브라우저 중단을 별도 terminal로 보존
- `projectId → analysisJobId → analysisSpecId → runId → taskId/chunkId/eventId` 식별 계층과 writer/worker epoch, snapshot hash, expected revision 도입
- 새로고침·Worker crash·입력 변경은 새 run을 발급하고 호환 checkpoint만 `resumedFromRunId`로 참조
- AI proposal revision과 사람 user revision을 분리하고 승인·수정 필드에 늦은 AI가 쓰지 못하게 함
- 렌더는 `segmentId + userRevision` snapshot을 고정
- Web Locks + BroadcastChannel의 프로젝트당 single writer와 IndexedDB lease fallback 추가
- 허용·금지 전이, stale·중복·역순 event, crash, multi-tab, transaction 실패를 자동 테스트 gate로 추가

### 개인용 운영 완성도 재해석

공유 서버를 도입하는 대신 한 사람의 장시간 작업을 안전하게 지키는 운영 계약을 추가했다.

- GitHub Pages 정적 artifact와 브라우저 로컬 Worker·IndexedDB·Cache API·선택형 로컬 백업 폴더로 배포 경계 고정
- 원본 영상은 사용자 파일, 프로젝트 기록은 IndexedDB 확정 revision, 장기 복구는 `.retto-highlight.json`이라는 진실 공급원 구분
- local/test/preview/production 공개 설정과 프런트엔드 secret 금지
- typecheck → lint → unit → transition/property → migration → Worker → build → Pages subpath E2E → 접근성 → artifact hash CI gate
- 작업 중 자동 새로고침 금지, service worker waiting, smoke test, release record, 직전 artifact rollback
- quota 경고·고용량 작업 차단, model/thumbnail/OPFS/진단/원문 채팅 보존 상한
- 원격 telemetry 대신 redacted local ring buffer와 사용자 주도 진단 JSON
- 저장 공간, model hash, WebGPU/Worker, IndexedDB, service worker, source 권한, 브라우저 중단, 렌더, 로컬 채팅 수집기 장애 runbook
- 두 탭·8시간/10GB·중단 복구·백업/migration·네트워크 media 업로드 0건을 개인용 출시 gate에 포함

### 생성·수정 파일

- `PRODUCT_PLAN.md`: `0.2.0`에서 `0.3.0`으로 개정, 개인용 경계·상태 요약·데이터 revision·운영·테스트·로드맵 반영
- `STATE_LIFECYCLE.md`: 도메인별 canonical 상태·전이·불변식·안전 편집 경계·전이 테스트 계약
- `OPERATIONS.md`: 개인용 Pages 배포·백업·복구·quota·진단·장애 대응·rollback 계획
- `AGENTS.md`: 이 작업공간에 적용할 프로젝트 전용 지시와 공용 지침 예외
- `DEVELOPMENT_LOG.md`: 이번 감사, 폐기 결정, 변경, 검증 이력

### 폐기한 구조

- 공용 지침의 일반 기본값만 따라 Cloudflare/Oracle에 사용자·프로젝트·동기화 계층을 만드는 안 폐기
- Pages와 별도 공용 CHZZK 채팅 수집 백엔드를 두는 안 폐기
- 사용자 소유 백엔드, 팀 공유, 클라우드 AI, 게시 연동을 단계 7에 넣는 기존 문구 폐기
- 하나의 거대한 `app status`가 source·분석·검토·저장·렌더를 모두 표현하는 안 폐기

### 버전·커밋

- 이번 변경은 AI-first 핵심을 유지하면서 데이터·상태·운영 계약을 확장하므로 `0.3.0` minor 개정으로 판단
- Git 저장소와 commit은 만들지 않음. 공용 규칙에 따라 검토 결과를 먼저 보고하고 사용자 승인 전 commit 금지

### 최종 정합성 검증

- `PRODUCT_PLAN.md`, `STATE_LIFECYCLE.md`, `OPERATIONS.md`의 기준 버전을 모두 `0.3.0`으로 일치시킴
- AnalysisRun lifecycle과 stage 집합, 정상 pause 같은-session 재개, crash 뒤 새 run, `completedWithGaps`, AI/user revision 명칭을 계획서와 상태 명세에서 일치시킴
- 논리 `SourceDefinition`과 기기 로컬 `SourceBinding`을 분리하고 handle·permission의 프로젝트 export 금지를 두 문서에서 일치시킴
- terminal `RangeCapture`를 같은 ID로 되살리는 전이를 새 capture 생성으로 수정하고, migration의 미확정 새로고침 상태를 terminal `interrupted`가 아닌 `recoveryPending`으로 분리
- 모든 Markdown 파일에서 UTF-8 대체 문자 `U+FFFD`와 NUL 0개
- backtick·tilde 코드 fence 개수 모두 짝수, Markdown 표의 열 구분 개수 불일치 0개
- 폐기한 이전 상태·엔터티 naming의 현재 계획·명세 본문 잔존 0개
- 비밀값 형식의 엄격 패턴 검사 결과 0개
- 모든 상호 참조 문서·CSS 파일 존재 확인
- 두 CSS 파일의 중괄호 균형과 `U+FFFD` 0개 확인
- StreamSaver 원본 `<style>`과 `streamsaver-reference.css`의 출처 주석 이후 payload 재비교: 정확히 일치
- CSS SHA-256 기록: reference `8F6B2F35662CBBD18B830EA6D1F272593225213734E7C503B60D2E992997A1E1`, Retto `2266B415041005EBF9E4FC995B1A8C9952FD6B79EC4D8833242BFCAB3BE045E8`
- 현재 프로젝트는 Git worktree가 아니며 commit·push·배포 없음
- 이번 작업은 계획·명세 문서 개정이므로 코드 build·런타임 test는 수행하지 않음. 구현 단계 0에서 transition/property/migration/Pages E2E를 필수 gate로 실행

## 2026-07-19 — `rettolight` 저장소 생성과 첫 실행 가능한 수직 슬라이스

### 요청과 범위

- 공용·프로젝트 지침을 다시 적용한 뒤 계획에 머물지 않고 첫 구현을 진행
- 제품 정체성을 계정·공유·게시 기능이 없는 **개인 편집 어시스턴트**로 고정
- 몇 시간짜리 원본을 사람이 먼저 보지 않도록 앱이 하이라이트 후보를 먼저 고르는 흐름을 최우선으로 구현
- CHZZK 라이브 채팅 기록을 선택적 반응 신호로 포함
- StreamSaver에서 추출한 참조 CSS는 수정하지 않고 Retto 전용 CSS에서만 UI를 확장
- GitHub Pages의 `/rettolight/` 하위 경로에서 동작하는 정적 웹앱으로 구성

### 저장소

- GitHub 사용자 `11qaws` 아래 공개 빈 저장소 `rettolight` 생성: `https://github.com/11qaws/rettolight`
- 로컬 저장소의 기본 브랜치를 `main`으로 초기화하고 `origin`을 위 저장소로 연결
- 검토·승인 전 커밋 금지 규칙에 따라 commit, push, Pages 활성화는 수행하지 않음

### 구현 구조

- React 19, TypeScript, Vite 기반 정적 SPA 뼈대와 `/rettolight/` base 경로 구성
- GitHub Pages 공식 custom workflow 구조를 따라 검사, build, artifact upload, deploy job을 분리
- `src/media/localMediaPreflight.ts`
  - 로컬 영상의 메타데이터·길이·탐색 가능성 확인
  - WebGPU·WASM·signals-only 실행 등급을 보수적으로 추천
  - 성공·오류·timeout 모든 경로에서 media probe와 Object URL 정리
- `src/analysis/chatImport.ts`
  - JSON 배열, `messages` 객체, JSONL, 인용 CSV 읽기
  - 상대 초·밀리초·`HH:MM:SS`와 절대 ISO·epoch 시각 정규화
  - 잘못된 행만 격리하고 닉네임은 원문을 보존하지 않는 내부 식별자로 즉시 변환
- `src/analysis/highlightSelector.ts`
  - 5초 bucket과 median/MAD 기준선
  - 채팅 폭발, 고유 참여자, 반응 표현 가점
  - 반복 문구, 단일 작성자 도배 감점
  - local peak, 비중첩 선택, 방송 경계 보정으로 45초 후보 생성
  - 결정적 후보 ID와 원문이 없는 집계 근거만 반환
- `src/domain/`
  - SourceCheck와 AnalysisRun의 lifecycle·결과 상태 분리
  - terminal 상태 흡수, pause/resume/gap/cancel/failure 전이
  - session·writer·run·worker·task fence와 event 중복 차단
  - 사용자가 승인·제외·수정한 후보를 늦게 도착한 AI proposal이 덮지 못하는 merge 규칙
- `src/App.tsx`
  - 초심자용 4단계 흐름: 원본 고르기 → AI가 먼저 찾기 → 후보 검토 → 결과 받기
  - 파일 끌어놓기, 링크의 지원 범위 설명, 채팅 시간 보정, 실제 후보 승인·제외, 집계 JSON 내려받기
  - 채팅이 없을 때 가짜 후보를 만들지 않고 영상·음성 AI가 다음 단계임을 화면에서 명시
- `styles/streamsaver-reference.css`는 원본 payload를 변경하지 않고, 모든 추가 규칙은 `.rh-` 접두사의 `styles/retto-highlight.css`에 작성

### 이번 단계의 정직한 기능 경계

- 실제로 동작함: 로컬 영상 사전 검사, 채팅 파일 가져오기, 채팅 반응 기반 후보 선택, 사람 검토, 집계 결과 JSON 내보내기
- 아직 동작하지 않음: 영상 프레임·음성·대사 멀티모달 모델, 브라우저 Worker 분할 분석, 실제 영상 자르기·렌더, IndexedDB 프로젝트 복구, 선택형 로컬 라이브 채팅 수집기
- YouTube·CHZZK 링크는 주소 형식과 지원 범위만 설명하며 원격 영상을 읽었다고 표시하지 않음
- 이번 구현은 개인 편집 어시스턴트의 가져오기·분석·검토 흐름에 집중하고 사용자 데이터용 백엔드는 두지 않음

### 문제 해결 기록

- TypeScript 7 prerelease 계열과 `typescript-eslint` peer 범위가 맞지 않아 안정 범위의 TypeScript 6으로 고정
- ESLint flat config가 설정 파일 자체에 typed parser를 적용하던 문제를 TypeScript 소스 glob으로 한정해 해결
- 로컬 preview의 4173·4174 포트가 이미 사용 중이어서 이 작업의 서버만 4175에서 실행
- 브라우저 자동 검사의 지원 대기 조건에 `networkidle`이 없어 `load` 기준과 화면 상태 검증으로 변경

### 검증

- 단위 테스트 7개 파일, 총 67개 테스트 통과
- TypeScript typecheck, ESLint, Vite production build 통과
- build 결과의 CSS·JavaScript 경로가 `/rettolight/assets/`를 사용하는지 확인
- 실제 짧은 MP4와 합성 CHZZK 형식 JSONL로 파일 검사 → 채팅 가져오기 → 45초 후보 생성 → 승인 흐름을 브라우저에서 확인
- 데스크톱·390px 모바일, 밝은·어두운 테마, 키보드에 필요한 기본 control, 수평 overflow 부재 확인
- 브라우저 console error와 warning 0개
- 상세 구조는 `graphify-out/graph.json`, `graphify-out/graph.html`, `graphify-out/GRAPH_REPORT.md`에 기록

### 커밋·배포 상태

- 사용자 검토를 위해 작업 트리만 준비한 상태
- commit, push, GitHub Pages 활성화·배포 없음

### 후속 통합 감사와 보강 — 위 첫 슬라이스 기록을 대체하는 현재 상태

첫 구현을 브라우저에서 다시 따라가며 `채팅이 없으면 핵심 가치가 동작하지 않음`, `완료 문구가 실제 저장 확정을 뜻하지 않음`, `영상 File을 보존하지 않아 후보 재생이 불가능함`을 확인했다. 계획서의 AI-first·상태 생애주기 계약과 맞추기 위해 다음을 추가했다.

- `src/media/localVideoVisualAnalysis.ts`, `localVideoVisualAnalysisCore.ts`
  - 숨은 video element로 원본을 구간별 탐색하고 32×18 canvas의 희소 프레임 밝기 지문을 계산
  - 최대 720개 표본의 적응형 간격, median/MAD 장면 변화 기준선, 45초 후보, 방송 시작·끝 경계 보정
  - 정지 화면에서는 후보를 만들지 않고, 진행률·AbortSignal·timeout·Object URL 정리를 지원
  - File, 프레임, Object URL은 결과나 IndexedDB에 기록하지 않음
- `src/analysis/chatAnalysis.worker.ts`, protocol, client
  - 채팅 후보 계산을 Dedicated Worker로 분리
  - session/writer/run/worker/task/event 식별자를 결과까지 왕복해 stale 결과를 차단
  - 완료·오류·취소 뒤 Worker를 종료하고 AbortSignal을 전파
- `src/analysis/highlightFusion.ts`
  - 영상과 채팅의 원점수가 서로 다른 단위이므로 각 신호 안에서 rank+MAD 정규화
  - 가까운 구간만 결합하고 단일 신호 후보도 보존하며, 중복 억제·최대 12개·결정적 ID 적용
- `src/storage/analysisResultStore.ts`
  - IndexedDB에 source capability snapshot, 분석 manifest, provisional result, final result, failure를 분리 저장
  - transaction `complete` 전에는 성공으로 취급하지 않고, final을 다시 열어 signature·engine version·payload 동일성을 검증한 뒤에만 AnalysisRun을 완료
  - File·handle·blob URL·채팅 원문·닉네임·message payload가 저장 객체에 들어오면 거부
- `src/security/contentFingerprint.ts`
  - 원본 정체성·길이·채팅 내용·시간 보정·엔진 버전을 길이 구분 SHA-256 입력 signature로 묶어 서로 다른 분석 결과의 오인 재사용을 방지
- `src/App.tsx`
  - 채팅 없이도 영상 빠른 분석을 실행
  - 선택한 File은 현재 탭에서만 보존하고 후보의 시작~끝을 내장 플레이어로 재생
  - 실제 IndexedDB commit/reopen 검증 뒤에만 완료 표시
  - 승인한 후보만 JSON으로 내보내며 원본 파일명·채팅 원문·사용자 식별자는 제외
  - 학습된 의미 이해 AI가 아닌 장면 변화 기반 자동 선별 기준선임을 화면에 명시

채팅 가져오기는 32MB로 제한했고, 방송 범위 밖 메시지는 기본적으로 후보 계산에서 제외한다. 작성자 원문은 import마다 순번형 별칭으로 즉시 치환해 서로 다른 프로젝트 사이에서 같은 사람을 추적할 수 있는 안정 해시를 만들지 않는다.

### 현재의 정직한 기능 경계

- 실제 동작: 로컬 영상 프레임 장면 변화 분석, 선택적 CHZZK 채팅 분석, 두 신호 결합, 후보 미리보기·승인·제외, IndexedDB 확정·재개방 검증, 승인 후보 JSON 요청
- 아직 없음: 학습된 영상 의미·음향·대사 멀티모달 모델, 실제 30~60초 영상 파일 인코딩, 저장된 프로젝트·검토 UI 복원, 선택형 로컬 라이브 채팅 수집기, 다중 탭 writer lock 연결
- 분석 결과 레코드는 새로고침 뒤에도 남을 수 있지만 현재 UI에서 목록을 다시 여는 기능은 없으므로 `프로젝트 복구 완료`로 간주하지 않음
- candidate merge와 사용자 revision 보호 도메인 규칙은 테스트되어 있으나 현재 one-shot 분석 UI의 점진적 늦은 proposal 경로에는 아직 연결하지 않음

### 후속 통합·경쟁 상태 감사

- storage await 사이의 취소가 조용히 return되어 상태가 고착될 수 있던 경로를 같은 epoch의 cancel과 새 입력의 stale operation으로 분리
- 영상·채팅 병렬 작업 중 하나가 실패하면 전체 AbortSignal을 중단하고 `Promise.allSettled`로 양쪽 cleanup을 확인한 뒤에만 실패·취소를 확정
- Worker 응답의 전체 identity envelope와 결과 구조를 런타임 검증하고 malformed message, 동기 `postMessage` 실패, 생성 실패, 60초 무응답을 모두 cleanup·terminate 경로로 통합
- `currentTime` 설정 직후 이전 decoded frame을 캡처할 수 있던 fast path를 제거하고 실제 `seeked`, `seeking=false`, 목표 시각 근접을 확인
- 영상 표본 계획·완료 개수와 채팅 계획·처리 개수, active task 수, gap 정책·승인 근거를 final payload에 기록하고 readback 값으로 coverage terminal을 재계산
- IndexedDB schema v2에 실행당 하나의 `terminalDisposition` store를 추가. final/failure artifact가 함께 남더라도 이 pointer가 없는 실행은 복구 시 확정 결과로 간주하지 않음
- 채팅 파일의 `reading/ready/failed` 상태를 분리하고 읽기·비식별화 중에는 분석 시작을 차단
- Worker 미지원·CSP·timeout이면 영상 결과를 버리지 않고 사전 고지된 정책에 따라 `completedWithGaps`로 확정
- 0개 후보도 가짜 후보 없이 4단계 종착으로 처리하고, committing/finalizing/cancelling/failing 진행 상태를 활성 색으로 표시
- 독립 최종 감사 결과 현재 동작을 깨는 P1 race·terminal split은 없음

남은 구조적 P2는 저장된 terminal을 시작 화면에서 나열·복원하는 project index/UI, 원본 byte 표본 또는 streaming hash 기반 입력 서명, key blacklist가 아닌 record별 allowlist 개인정보 DTO다. 현재 App 경로에서 원본 채팅·닉네임 저장은 발견되지 않았지만 다음 저장·복구 단계 전에 이 세 항목을 gate로 다룬다.

### 후속 검증

- 단위 테스트 12개 파일, 총 122개 테스트 통과
- TypeScript typecheck, ESLint, Vite production build 통과
- production artifact가 `/rettolight/assets/` 하위 경로만 참조함을 확인
- 120초 합성 MP4를 사용한 브라우저 검사에서 채팅 없이 실제 영상 후보 1개 생성, 후보 구간 재생, 승인 뒤 JSON 다운로드 요청 상태까지 확인
- 같은 영상에 합성 CHZZK JSONL을 추가해 영상 후보와 채팅 후보가 각각 보존된 2개 결과 및 근거 표시 확인
- 390×844 모바일 viewport에서 단일 열 흐름과 수평 overflow 부재 확인
- 브라우저 자동화 도구가 blob 다운로드 이벤트를 포착하지 못했으므로 파일시스템 저장 완료로 과장하지 않고, 앱의 blob URL 생성·anchor 요청·상태 전이와 단위 검증까지만 확인한 것으로 기록
- 아래 기록의 `67개 테스트`, `채팅 반응만`, `Worker/IndexedDB 미구현` 설명은 이 후속 통합 상태로 대체됨
- commit, push, GitHub Pages 활성화·배포는 계속 수행하지 않음

## 2026-07-19 — 앱 0.2.0 완료 분석 복구·내용 샘플 지문·영속 개인정보 allowlist

직전 감사에서 P2로 남긴 세 경계를 한 수직 슬라이스로 닫았다. 이 단계의 제품 명칭은 `프로젝트 전체 복원`이 아니라 `완료한 AI 분석 결과 다시 열기`다. 원본 File과 승인·제외 판단은 아직 영속하지 않는다.

### 완료 결과 발견과 복구 권위

- 새 recent-project/index store를 만들지 않고 `analysisTerminalDispositions`를 복구 목록의 유일한 기준으로 사용
- `listTerminalRecords()`는 transaction complete 뒤 최신순으로 반환하며, 손상된 행은 원문을 반사하지 않고 격리 개수만 보고
- terminal만 없는 final artifact는 목록에 나타나지 않음
- 완료 terminal마다 manifest와 final을 다시 열어 `runId`, schema, input signature, model manifest를 교차 검증
- 모든 분석 artifact에 `artifactId`, terminal에 `resultArtifactId`를 추가해 같은 run envelope 안에서 final이 교체되는 경우도 차단
- final의 source input, 후보 수·중복 ID·시간 범위, visual/chat coverage, gap 정책·승인, active task 0 조건을 read-time에 재검증
- 손상된 최신 pointer가 있어도 더 오래된 정상 완료 결과를 계속 찾아 최대 5개 표시
- 복원 결과는 과거 `AnalysisRunState`를 현재 session 소유 run으로 위조하지 않고 별도 recovery UI state로 개방
- 이전 0.1.0 형식처럼 새 artifact pointer나 strict payload가 없는 기록은 자동 삭제·포괄 변환하지 않고 복구 목록에서 격리

### 로컬 영상 내용 샘플 지문

- `src/security/localFileFingerprint.ts` 추가
- 파일명, MIME, 마지막 수정 시각, 경로를 digest 입력에서 제외
- 큰 파일은 시작·균등 중간·끝의 기본 9개 64KiB 구간, 최대 576KiB를 읽고 작은 파일은 예산 안에서 전체를 읽음
- 설정 가능한 절대 읽기 상한 8MiB, `AbortSignal`, 읽기·digest 진행률, in-flight 취소 경합 지원
- Web Crypto SHA-256이 없으면 약한 fallback으로 원본 일치를 주장하지 않고 명시적으로 중단
- `local-file-sampled-sha256-v1:<64 hex>`를 input signature에 넣고, 복원 원본은 지문·크기·길이·media kind가 모두 맞아야 preview에 연결
- 이 지문은 전체 파일 바이트 동일성 증명이 아니라 강한 재연결 신호임을 UI·문서에 명시

### 영속 개인정보 경계

- blacklist 기반 임의 JSON `result` 계약을 manifest, provisional/final, failure, terminal, source snapshot별 exact-key DTO로 교체
- 실제 우회 예시 `{ entries: [{ speaker: "nick", body: "raw line" }] }`를 정상 payload의 root·candidate·evidence 위치에 넣어 모두 거부하는 회귀 테스트 추가
- 후보의 임의 `reason` 문장을 IndexedDB에서 제거하고 `signalKinds`와 집계 숫자만 저장; 한국어 설명은 화면 projection에서 재생성
- raw MIME·extension·파일명 대신 알려진 media container enum만 저장
- gap/failure reason, 정책·승인, candidate ID, fingerprint, timestamp, schema, run/artifact/source ID를 enum·literal·정규식·길이로 제한
- source capability signature는 임의 문자열이 아니라 저장된 boolean/tier에서 계산한 값과 정확히 일치해야 함
- accessor, symbol, sparse/circular/non-JSON 객체, File/handle/Object URL과 extra field를 저장 전·읽기 후 모두 차단

### 초심자 UI

- 첫 화면에 `지난 AI 분석 결과를 이어볼까요?` 카드를 추가하고 완료 시 목록을 즉시 다시 감사
- 결과를 열면 원본 영상이 저장되지 않았고 승인·제외 판단은 `검토 전`으로 시작한다고 지속 안내
- 원본 미연결 상태에서는 후보 시간표와 근거는 볼 수 있지만 재생 버튼은 `원본 연결 필요`로 비활성화
- 다른 영상을 고르면 복원 후보를 지우지 않고 명확한 mismatch 안내를 표시
- 같은 원본이 확인되면 내용 샘플·크기·길이 일치 문구와 함께 preview를 다시 활성화
- 복원 결과에서도 후보를 다시 승인하면 개인정보가 제거된 JSON 정리표 버튼이 활성화
- 복원 결과를 연 동안 채팅 입력을 잠가 과거 입력을 실수로 바꾸지 못하게 하고, `새 영상으로 시작`은 이전 원본·미리보기 상태까지 함께 초기화
- 완료 terminal을 run별 write-once로 바꿔 동일 payload의 멱등 재시도만 허용하고, 일시적 readback 오류 뒤 `completed → failed`로 덮어쓰는 경로를 IndexedDB 단일 transaction에서 차단
- 분석 중 원본·채팅 입력 잠금, 미저장 review 이동 확인, dirty 안내, 복구 source/chat epoch 폐기, 잘못된 재연결 때 기존 정상 preview 보존을 추가
- 첫 input-signature await 전 start-pending fence, 시간 보정 재분석 전이, beforeunload 경고를 추가하고 새 원본은 이전 방송 채팅을 자동으로 비움
- 완료 readback과 즉시 재감사가 모두 일시 실패해도 terminal은 보존하면서 현재 탭을 busy 상태에서 풀고 목록 재확인을 안내
- 복구 단계 표시·키보드 초점을 원본 재연결로 맞추고, 결과 목록 재시도·컨테이너/채팅 식별 정보·스크린리더 완료 문구·reduced-motion scroll을 보강

### 검증

- `npm run check`: TypeScript, ESLint, 14개 파일의 147개 Vitest 테스트 통과
- `npm run build`: GitHub Pages `/rettolight/assets/` 경로 확인, JS 317.97kB, CSS 39.59kB, Worker 5.34kB
- 75초 합성 MP4 브라우저 검사: 실제 영상 분석 → 후보 1개 → 완료 목록 즉시 표시 → 승인 → 새로고침 → 결과 다시 열기
- 복원 뒤 승인 상태가 영속된 것처럼 보이지 않고 `검토 전`으로 초기화되는지 확인
- 다른 75초 MP4 재연결은 거부하면서 후보 1개가 보존되고, 원래 MP4 재연결 뒤 preview 버튼이 다시 활성화되는지 확인
- 복원 후보 재승인 뒤 JSON 정리표 버튼 활성화 확인
- 390×844 viewport에서 document/body 수평 overflow 없음, 후보·복구 카드 폭이 viewport 안에 머무름
- 브라우저 console error·warning 0개
- commit, push, GitHub Pages 활성화·배포는 사용자 검토·승인 전 계속 수행하지 않음

### 여전히 남은 경계

- 승인·제외·수동 수정의 SaveCommit과 전체 Project 복원
- 비종료 AnalysisRun의 interrupted 확정·checkpoint 재개
- Web Locks/BroadcastChannel 기반 다중 탭 writer lease
- 전체 파일 바이트 해시가 필요한 고보증 모드
- 실제 30~60초 영상 인코딩, 학습된 영상·음성·대사 로컬 멀티모달 AI, 선택형 로컬 CHZZK 라이브 채팅 수집기

## 2026-07-19 — 앱 0.2.1 기본 완주 화면·편집 시간표 출력

이번 슬라이스는 상세 복구 엣지 케이스보다 초심자가 기본 흐름을 한 번 완주하는 데 집중했다. 완료 기준을 `영상 선택 → AI 자동 후보 → 사람 검토 → 실제 편집 시간표 받기`로 좁혔고, 실제 영상 인코딩은 별도 RenderJob 단계로 유지했다.

### 단방향 초심자 흐름

- 첫 화면의 빈 상태바와 빈 복구 카드를 숨겨 `영상 파일 고르기`를 유일한 주 행동으로 배치
- 로컬 파일 드롭 영역 전체를 file input label로 만들어 클릭·드롭 경로를 하나로 통합
- YouTube·CHZZK 링크 입력은 현재 원격 방송을 직접 읽지 못한다는 안내와 함께 접힌 도움말로 이동
- 완료 기록이 있을 때만 `지난 분석 결과 N개` disclosure를 표시
- 원본 검사가 끝난 뒤에만 선택형 CHZZK 채팅과 `AI로 하이라이트 찾기`를 공개
- WebGPU/WASM, fast pass, Worker timeout 같은 기술 용어를 기본 흐름에서 숨기고 제한 설명 안으로 이동
- 후보 근거 숫자는 `AI가 이 장면을 고른 이유` disclosure로 이동
- 모바일 4단계 표시를 세로 네 줄이 아닌 압축된 4열로 유지

### 편집에 쓸 수 있는 결과

- `src/exports/highlightExport.ts`를 추가해 UI와 분리된 순수 formatter로 CSV·Markdown·JSON·클립보드 문자열 생성
- 승인 후보만 시작 시각 순으로 정렬하고 모든 화면·텍스트 결과에 `HH:MM:SS` 사용
- Excel용 CSV에 UTF-8 BOM·CRLF·quote escaping·formula injection 방어 적용
- Markdown에는 원본 길이, 승인 장면, 이유·신호·근거와 함께 실제 영상 파일이 아님을 명시
- JSON은 원본 파일명·경로·File·Blob URL·채팅 원문·닉네임을 계속 제외
- 후보 목록 아래에 별도 `4단계 · 결과 받기` 패널을 추가하고 CSV를 주 행동, 복사·Markdown을 보조 행동, JSON을 고급 형식으로 배치
- 다운로드 완료를 과장하지 않고 브라우저에 `다운로드를 요청했어요`라고 표시

### 실제 클립 파일 방향

- 이번 기본판에는 대용량 인코딩을 섞지 않음
- 후속 구현은 GitHub Pages에서 COOP/COEP 없이 동작하고 File을 범위 읽기할 수 있는 Mediabunny + WebCodecs를 1차 경로로 유지
- ffmpeg.wasm은 2GB 입력 제한과 큰 runtime·메모리 비용 때문에 작은 파일 폴백으로만 검토
- 실제 클립보다 CSV·Markdown·JSON을 항상 실패 안전망으로 유지

### 검증

- `npm run check`: TypeScript, ESLint, 15개 파일의 153개 Vitest 테스트 통과
- `npm run build`: GitHub Pages `/rettolight/assets/` 경로 확인, JS 323.06kB, CSS 42.90kB, Worker 5.34kB
- 75초 합성 MP4로 파일 검사 → 로컬 영상 장면 분석 → AI 후보 1개 → 승인 → 타임코드 복사 → CSV·Markdown·JSON 요청까지 실제 브라우저 완주
- 내려받은 CSV의 `EF BB BF` BOM, 한글 열, `00:00:30–00:01:15` 값을 확인
- 내려받은 JSON의 schema/app `0.2.1`, 승인 후보 1개, 파일명·채팅 원문 필드 부재 확인
- 생성한 브라우저 QA 다운로드 파일은 확인 뒤 삭제했고 기존 사용자 파일은 건드리지 않음
- Graphify 갱신: 883 nodes, 1,769 edges, 43 communities; multigraph dangling/missing/collapsed edge 0; 평균 질의 token 8.0배 절감
- commit, push, GitHub Pages 활성화·배포는 사용자 검토·승인 전 수행하지 않음

### 다음 핵심 슬라이스

1. 후보 시작·끝을 ±5초 또는 현재 재생 위치로 다듬는 간단한 경계 조정
2. 승인 후보 한 개씩 Mediabunny + WebCodecs로 MP4/WebM 생성
3. 실제 음성·대사 의미를 보는 로컬 AI 정밀 분석

## 2026-07-19 — 앱 0.3.0 스트리머 반응 우선 오디오 fast pass

이번 슬라이스는 “화려한 장면 전환이 아니라 스트리머의 반응을 클립으로 본다”는 제품 기준을 실제 기본 검출기로 교체했다. 몇 시간짜리 영상을 사람이 먼저 보지 않아도 되게 하는 것이 목적이므로, 오디오·채팅을 후보 anchor로 쓰고 영상 변화는 문맥 보조로 강등했다. 결과 화면에는 단순 점수 대신 사건·스트리머 반응·시청자 반응·추천 이유를 분리해 표시한다.

### 알려진 방법 재검토와 채택 결정

- Twitch Auto Clips의 공개 설명은 채팅 활동, vocal inflection, on-screen event를 결합하고 스트리머의 audible reaction이 포함된 구간을 권장한다.
- Ringer·Nicolaou의 라이브 스트리밍 연구에서는 game-only 정확도 29%에 비해 face+audio 74%, face+game+audio 77%로 반응 모달리티 추가 효과가 컸다.
- Fu 등은 영상 단독 F1 72.2에서 chat+video 74.7로 개선됐고, 사건 뒤 약 7초 채팅이 유용하다고 보고했다. Lightor는 채팅 위치·반복·잡음 보정의 필요성을 보여 준다.
- Eklipse의 현재 공개 방식도 게임 UI 신호, 마이크의 고함·웃음, chat velocity를 함께 쓴다. 반대로 Medal의 event/replay capture는 지원 게임 사건에는 강하지만 토크·합방·스트리머 반응 일반화에는 부족한 비교 기준으로 남겼다.
- 스포츠 연구는 해설자의 pitch·에너지, 관중 함성의 크기·지속 시간, 선수 반응, 리플레이·그래픽을 함께 쓴다. Retto에서는 해설자→스트리머 오디오, 관중→채팅, 리플레이/UI→시각 문맥으로 역할을 번역했다.
- ICCV 2021의 joint audio/visual 접근처럼 신호를 결합하되, 품질이 나쁜 모달리티가 전체를 망치지 않도록 coverage·gap과 visual-only 저신뢰 탐색 경로를 분리했다.

### 오디오 순차 분석 Worker

- `mediabunny@1.50.9`를 추가하고 8MiB 제한 `BlobSource` + `AudioSampleSink`로 오디오를 순서대로 디코딩한다.
- 전체 파일이나 전체 PCM을 메모리에 올리지 않는다. sample은 집계 직후 닫고 `Input`은 모든 종료 경로에서 한 번만 dispose한다.
- 1초 window마다 RMS, peak, zero-crossing rate, 300~3400Hz 음성 대역 에너지 비율을 계산한다.
- 디코더에서 아예 도착하지 않은 1초 window는 무음으로 꾸며 채우지 않고 coverage gap으로 남긴다. 실제 인코딩된 무음은 zero-energy sample로 정상 집계한다.
- 약 2분 지역 median/MAD 기준선으로 방송마다 다른 마이크 음량과 BGM을 정규화한다.
- 무음, 단발 click형 spike, 12초 이상 평탄하게 큰 배경음을 억제하고 `short-loudness-burst`와 `sustained-vocal-reaction`을 구분한다.
- 스테레오 역상으로 실제 반응이 사라지지 않게 RMS·peak는 채널별 에너지로 합치고, downmix·채널·에너지 scratch buffer를 재사용한다.
- 최대 12개, 비중첩, 결정적 순서의 30~60초 후보를 만든다. 기본 후보는 45초이며 반응 정점 앞 문맥을 넉넉히 둔다.
- Worker 진행률, 2시간 기본 timeout, event fence, 취소 ACK 뒤 terminate, malformed response 차단을 구현했다.
- 오디오 없음·컨테이너 미지원·코덱 미지원은 복구 가능한 결과로, decode·signal engine·Worker 장애는 안전한 gap으로 구분한다.

### 반응 anchor fusion과 설명

- 새 `fuseReactionHighlightCandidates(...)`는 오디오·채팅만 anchor로 인정한다. 오디오 peak를 우선하고 canonical 근거 순서는 `audio → chat → visual`이다.
- 가까운 시각 신호는 문맥 증거와 최대 `0.04` 보너스만 제공한다. anchor가 없으면 시각 탐색 후보는 최대 2개, 점수 상한 `0.32`로 제한한다.
- 반응 정점이 전체 후보의 약 62.5% 지점에 오도록 앞 문맥을 확보한다. 30~60초 제한과 원본 경계, NMS, 결정성을 유지한다.
- `buildHighlightNarrative(...)`가 후보마다 제목, 무슨 일이 있었나, 스트리머 반응, 시청자 반응, 왜 볼 만한가, 근거 종류와 검토 안내를 만든다.
- 현재는 전사·의미 모델이 없으므로 “게임에서 승리했다” 같은 사건을 꾸며내지 않는다. `신호 기반 추정` 배지와 “사건 종류 확인 전” 문구를 쓰며, 실제 사건·원인을 설명하는 단계는 상위 후보 로컬 Whisper·음향 사건 분류 뒤로 둔다.
- 오디오 peak, 채팅 bucket, 화면 변화 frame의 실제 시각 범위를 비교해 선후가 증명될 때만 “먼저/뒤”라고 설명한다. 범위가 겹치거나 시각 정보가 없으면 인과와 순서를 단정하지 않는다.

### 저장·복구·내보내기

- 앱·schema를 `0.3.0`, 신호 엔진을 `streamer-reaction-fast-pass-v1`로 올렸다. 기존 `0.2.x` visual/chat 결과는 계속 읽는다.
- final summary와 coverage에 계획·처리 오디오 window 수, 오디오 gap reason을 추가하고 여러 signal gap을 한 정책 승인 레코드로 정확히 맞춘다.
- 오디오 evidence는 사건 종류와 집계 숫자만 허용한다. `transcript(s)`·`utterance(s)`와 원문·파일 정보는 저장 경계에서 거부한다.
- CSV·Markdown·JSON에 사건, 스트리머 반응, 시청자 반응, 추천 이유, 설명 근거를 추가했다. JSON에는 생성한 interpretation이 들어가지만 원본 파일명·오디오·전사·채팅 원문은 없다.
- 복구 목록은 오디오 gap도 `completedWithGaps`로 표시하며, old result는 과거 화면·채팅 신호 문구로 구분한다.
- schema version과 payload 모양을 함께 검증해 `0.2.x` 결과를 `0.3.0`으로 이름만 바꿔 통과시킬 수 없게 했다. 과거 결과의 미기록 오디오 정보는 내보낼 때 `0개 분석`으로 꾸미지 않고 `해당 버전에는 정보 없음`으로 보존한다.

### 초심자 UI와 CSS

- 분석 안내를 “영상 전체의 스트리머 오디오 반응을 먼저 훑는다”로 바꾸고 오디오·영상 진행률을 하나의 쉬운 진행 막대로 합쳤다.
- 후보 카드에 `신호 기반 추정`, 구조화 설명 4칸, 오디오 반응 종류·평소 대비 배수·방송 내 percentile, 반응 정점을 표시한다.
- 오디오 트랙 없음, 형식 미지원, Worker 장애를 서로 다른 다음 행동 문장으로 안내하고 가능한 결과는 버리지 않는다.
- 첫 취소 클릭 즉시 버튼을 숨기고 `안전하게 멈추는 중`을 표시한다. Worker가 끝난 뒤 최종 결과와 종료 기록을 검증·저장하는 짧은 구간에는 `결과 저장 중` 안내를 보여, 중복 취소나 이미 취소할 수 없는 버튼이 남아 있지 않게 했다. 파생 상태는 순수 함수와 상태표 테스트로 고정했다.
- StreamSaver reference CSS는 수정하지 않았다. Retto 전용 `styles/retto-highlight.css`에 narrative grid·basis badge·review hint만 추가했다.

### 검증

- `npm run check`: TypeScript, ESLint, 19개 파일의 213개 Vitest 테스트 통과.
- `npm run build`: GitHub Pages `/rettolight/` 산출 성공. main JS 353.12kB(gzip 107.18kB), CSS 43.79kB(gzip 8.79kB), audio Worker 333.57kB, chat Worker 5.34kB.
- 40초 합성 MP4 브라우저 검사: 15~19초의 큰 음성형 반응을 넣고, 오디오 40/40 window 처리, 반응 정점 00:00:18, 후보 1개, 평소 음량 24.6배·오디오 상위 1% 근거를 확인했다.
- 같은 검사에서 구체 사건을 꾸며내지 않고 `사건 종류 확인 전`, `지속되는 반응일 가능성`, `채팅 근거 없음`, 검토 필요를 분리해 표시했다.
- 후보 승인 뒤 CSV·타임코드·Markdown 결과 버튼 활성화와 CSV 요청 상태를 확인했다. 내장 브라우저의 blob download event 가로채기는 timeout이어서 실제 파일 내용은 formatter 단위 테스트로 검증했다.
- 390×844 override에서 document·body scroll width가 client width 375와 같고 candidate/export panel이 305px 안에 머물러 수평 overflow가 없음을 확인했다.
- 새 build로 `dist`를 교체한 뒤 이미 열려 있던 이전 탭은 사라진 Worker hash를 참조해 첫 분석이 gap으로 끝났다. 새로고침 후 현재 HTML·Worker 조합에서는 console error·warning 0개로 정상 완주했다. 따라서 배포 smoke test에 app shell/Worker hash 일치를 명시적으로 추가했다.
- Graphify code graph를 1,107 nodes, 2,265 edges, 65 communities로 갱신하고 오디오 Worker → 반응 fusion → 설명 → 저장·내보내기 경로를 useful memory로 남겼다.
- QA 합성 파일과 임시 preview 파일은 최종 확인 뒤 삭제한다.
- commit, push, GitHub Pages 활성화·배포는 사용자 검토·승인 전 수행하지 않았다.

### 다음 품질 슬라이스

1. 상위 fast-pass 후보만 로컬 한국어 Whisper로 전사해 구체 사건·반응 원인과 자연스러운 문장 경계를 설명한다.
2. 웃음·함성·박수·비명·군중 같은 소형 음향 사건 모델을 golden-vector와 실제 방송으로 검증해 DSP 근거에 더한다.
3. 권리 확보한 2시간·8시간 표본에서 1시간당 상위 6개 recall, 검토 시간 감소, 오디오/BGM/채팅 ablation과 peak RAM을 측정한다.
4. 후보 시작·끝 ±5초 조정과 승인 후보 MP4/WebM 생성은 별도 RenderJob으로 구현한다.

## 2026-07-19 — 앱 0.3.1 최초 GitHub Pages 배포 준비

- 사용자 승인 후 `11qaws/rettolight` 공개 저장소의 `main`에 최초 커밋을 push하고 Pages 배포 원본을 GitHub Actions로 활성화했다.
- 첫 Actions 실행은 Ubuntu의 npm 11.16 `npm ci`에서 optional peer인 `@emnapi/core`·`@emnapi/runtime` 항목이 기존 lockfile에 없어 중단됐다. 앱 코드나 테스트 실패가 아니라 Windows의 npm 11.6에서 만들어진 lockfile과 CI npm 해석 차이였다.
- CI와 같은 npm 11.16으로 lockfile을 다시 생성해 top-level 1.11.2와 Rolldown WASI 하위 1.11.1 항목을 모두 고정했다.
- `npx npm@11.16.0 ci`를 같은 조건으로 재현해 181개 패키지 설치와 취약점 0건을 확인했다.
- Graphify의 로컬 Python 절대 경로, 캐시, 날짜별 임시 스냅샷은 공개 저장소에서 제외하고 `graph.json`·`graph.html`·보고서·portable manifest·질의 메모만 handoff artifact로 유지했다.

## 2026-07-19 — 최초 Pages 배포 완료와 앱 0.3.2 여러 후보 구간 다듬기

이번 작업은 상세 오류 조합보다 `하루치 원본 한 개 → 서로 다른 여러 후보 → 후보별 검토·구간 조정 → 최종 시간표` 성공 경로를 먼저 고정했다.

### 최초 공개 배포

- `11qaws/rettolight`의 GitHub Pages workflow 실행 `29688747238`이 install, 213개 테스트, build, artifact upload, deploy를 모두 통과했다.
- 공개 주소 `https://11qaws.github.io/rettolight/`의 HTTP 200, `/rettolight/assets/` base path, HTTPS 강제, 데스크톱 폭 수평 overflow 없음, console error·warning 0개를 확인했다.
- 첫 workflow의 npm 11 lockfile 실패는 CI와 같은 npm 11.16으로 lockfile을 다시 만든 뒤 재현 가능한 `npm ci`로 해결했다.

### 여러 후보 성공 경로

- UI 첫 설명을 `하루치 영상 전체에서 서로 다른 여러 클립 후보`로 명확히 바꾸고 결과 제목도 항상 실제 후보 개수와 함께 표시한다.
- 4시간 원본 타임라인에 서로 떨어진 스트리머 반응 8개를 둔 회귀 테스트에서 후보 8개가 서로 다른 ID와 45초 범위로 반환되는지 확인했다.
- 현재 fast pass는 겹친 같은 사건만 NMS로 억제하고 정상 반응 후보는 최대 12개까지 유지한다. 장시간 표본의 시간당 recall과 후보량 자동 조정은 실제 방송 평가 단계에서 별도로 다룬다.

### AI 제안 보존형 시작·끝 다듬기

- AI `UnifiedHighlightCandidate.startMs/endMs`는 수정하지 않고 세션 전용 `CandidateBoundaryRevision`에 proposal/effective range, user revision, provenance를 분리했다.
- 후보마다 시작·끝 `5초 앞/뒤`, 활성 미리보기의 `재생 위치를 시작/끝으로`, `AI 제안으로 되돌리기`를 제공한다.
- 미리보기 시작·자동 정지, 후보 카드, 승인 시간표, clipboard, CSV·Markdown·JSON이 모두 같은 effective range를 사용한다.
- 여러 후보 revision은 candidate ID별로 독립적이며, 새 분석·복구 결과마다 boundary session ID를 교체한다.
- 승인 뒤 구간을 바꾸면 승인은 유지하고 `승인 유지 · 수정 구간 반영`을 표시한다. 최종 시간표는 최신 구간을 즉시 사용하며, 기존 `승인 취소` 행동의 의미를 바꾸지 않는다.
- 복수 후보 영역에 list/listitem 의미와 후보별 accessible name을 부여하고, 반복되는 조정·재생·승인 버튼의 스크린리더 이름에 후보 번호를 포함했다. 장면 재생 때 영상으로 키보드 초점을 옮기고 선택 후보 편집기로 돌아오는 버튼을 제공한다.
- 구간 편집도 미저장 작업으로 취급해 내부 이동과 페이지 이탈 전에 안내한다. 이번 단계에서는 새로고침 뒤 구간 revision을 복구하지 않는다.
- JSON export schema를 `0.4.0`으로 올려 `proposalRange`, `effectiveRange`, `rangeProvenance`, `userRevision`을 구분하고 모호한 최상위 start/end를 제거했다. persistence schema는 `0.3.0`을 유지한다.

### 검증

- `npm run check`: TypeScript, ESLint, 20개 파일의 221개 Vitest 테스트 통과.
- 새 테스트는 4시간 원본의 여러 후보, 후보별 독립 revision, 5초 네 방향 조정, 재생 위치 지정, AI 범위 복원, 모든 export의 effective range 일치를 먼저 검증한다.
- Chrome 확장 자동화에서 로컬 파일 chooser는 확장의 `Allow access to file URLs` 설정이 꺼져 있어 합성 MP4 주입이 차단됐다. 앱 오류로 취급하지 않았으며, 세부 브라우저 업로드 환경 검증은 기본 코드 성공 경로 뒤에 진행한다.

### 12시간 원본 상한 확정

- YouTube 업로드 조건을 제품 경계로 삼아 한 원본의 최대 길이를 정확히 12시간으로 고정했다. 12시간 초과 단일 파일은 상정하지 않는다.
- `LocalMediaPreflight`가 메타데이터를 읽은 직후 `43,200,000ms`까지 허용하고 1ms라도 초과하면 `DURATION_LIMIT_EXCEEDED`로 중단한다. 전체 fingerprint·Worker 분석보다 먼저 실패하므로 긴 작업을 뒤늦게 버리지 않는다.
- UI는 파일 선택 전 `최대 12시간`, 초과 뒤 `12시간 이하의 파일로 나눠 주세요`를 기술 용어 없이 안내한다.
- 정확히 12시간 성공과 12시간+1ms 거부·자원 정리를 각각 테스트한다.

## 2026-07-19 — AI 기능 우선순위 재조정과 앱 0.3.3 Pass B 착수

### 사용자 우선순위 수정

- 저장·복구·다중 탭 같은 구조적 구멍을 먼저 닫기보다, 하이라이트 품질을 직접 높이는 AI 기능들을 먼저 구현한다.
- 따라서 직전 감사의 `검토 revision 영속화 P0` 결론을 뒤로 미루고, 후보 전용 한국어 Whisper Pass B를 다음 구현으로 확정했다.

### 코드·계획 재감사

- 현재 fast pass는 최대 12개의 30~60초 후보를 이미 만들지만, `highlightNarrative`의 사건 설명은 대사 근거가 없어 `사건 종류 확인 전`에 머문다.
- 전체 12시간을 전사할 필요 없이 최악 약 12분 이내의 후보 오디오만 다시 읽으면 되며, 설치된 Mediabunny의 `AudioSampleSink.samples(start, end)`가 범위 디코드를 지원한다.
- 부분 후보 공개는 대기 체감을 줄이지만 설명·선별 품질을 직접 올리지는 않고, YAMNet 단독은 반응 종류만 알려 줄 뿐 원인 발화 단서를 주지 못하므로 Whisper를 먼저 둔다.

### 확정한 첫 AI 슬라이스

1. fast-pass 후보를 먼저 표시한다.
2. 별도 lazy Worker가 후보 범위만 16kHz mono로 읽는다.
3. 고정 revision의 다국어 Whisper tiny를 한국어·timestamp 모드로 로컬 실행한다.
4. 결과는 후보별 overlay 설명만 보강하고 AI 제안·점수·순위·사람의 검토와 구간을 덮어쓰지 않는다.
5. 무음·낮은 품질·모델 실패는 현재 fast-pass 설명으로 폴백한다.

다음 AI 순서는 후보 음향 사건 분류 → 전사·음향 사건·채팅 재랭킹과 경계 제안 → 분석 중 부분 후보 공개다. 검토 자동 저장·새로고침 복원은 이 AI 기능 묶음 뒤에 다시 진행한다.

### `0.3.3` 첫 AI 슬라이스 구현 결과

- `CandidatePassBRun` reducer를 추가해 준비·모델 로드·후보별 전사·부분 gap·실제 취소 ACK·terminal 상태를 event fence로 관리한다.
- 오디오 트랙 부재나 미지원 형식을 모델 로드 전에 발견하면, 검증된 첫 후보 gap에서 App가 `MODEL_BYPASSED`를 적용하고 모든 후보를 개별 gap으로 종결한다. 모델 준비를 허위로 표시하거나 불필요한 모델 다운로드를 시작하지 않는다.
- 별도 lazy Worker가 Mediabunny로 후보 하나만 범위 디코드하고 16kHz mono PCM을 만든 뒤 고정 revision의 Whisper tiny q8 한국어 timestamp 전사를 실행한다. 후보가 끝날 때 PCM을 0으로 덮고 참조를 해제한다.
- 디지털 무음과 한 번의 클릭은 보수적인 지속 오디오 gate에서 음성 인식 전에 제외해 무음 환각 위험을 낮춘다. 이는 화자·감정·사건 분류기가 아니며 기존 반응 후보를 삭제하지 않는다.
- timestamp가 있는 자동 전사 문구를 최대 3개까지 `반응 전 / 반응 시점 부근 / 반응 뒤` 확인 위치로 표시한다. 현재 Worker 출력에는 confidence/VAD가 없으므로 실제 발화로 확정하지 않고 provisional로 표시하며, 버튼은 원본 플레이어의 절대 시각으로 이동한다. 화면 사건·승패·인과는 임의 생성하지 않는다.
- UI는 `대사 단서 더 보기`, 첫 실행 약 45~80MB, `영상은 보내지 않음`, 후보별 진행·취소·완료/gap을 초심자 문장으로 안내한다. Pass B overlay는 기존 후보 ID·점수·순서·경계·review를 바꾸지 않고 세션 메모리에만 둔다.
- production build 관찰값은 대사 Worker 약 1.22MB, lazy ONNX WASM 약 21.6MB, 메인 JavaScript 약 407kB다.

### 독립 감사 뒤 긴급 품질·lifecycle 보강

- 음량 gate는 디지털 무음과 단발 click만 막을 뿐 BGM·효과음에서 Whisper가 문장을 환각할 위험까지 판별하지 못한다. 따라서 timestamp·text만 있는 현재 결과를 `provisional-transcript`로 분리하고 `자동 전사 추정 · 재생 확인 필요`로 표시한다. cue는 재생 위치로 제공하지만 fast-pass 사건·원인 설명은 덮어쓰지 않는다. `grounded-transcript`는 confidence와 VAD/no-speech 품질 신호가 함께 있는 경우로 좁혔다.
- 마지막 후보 event는 `finalizing`으로만 이동한다. Client가 Worker 완료 envelope의 terminal candidate ID와 requested/result/gap 수를 검증하고, reducer가 후보별 Worker disposition과 다시 맞춘 fenced `RUN_COMPLETED` 뒤에만 성공을 확정한다.
- 취소 ACK 대기 기본값을 1초에서 5초로 늘렸다. ACK가 없어 client가 Worker를 terminate한 경우 로컬 `CLIENT_FORCE_TERMINATED`와 `clientForceTerminated` 종료 종류를 기록해 `cancelling` 화면 잠금을 해제한다.
- 재시도 시작 때 기존 overlay를 지우지 않는다. 후보별 같거나 더 높은 품질의 새 transcript result만 기존 단서를 교체하고 무음·실패·품질 하락 결과는 이미 찾은 cue를 보존한다.
- 실제 WebGPU adapter를 요청해 사용 가능할 때만 WebGPU를 선택한다. adapter 실패는 WASM으로 자동 폴백하고 WebGPU 모델 준비 실패 뒤에는 새 run identity로 `호환 모드` 재시도를 제공한다.
- Transformers.js의 파일별 다운로드 callback을 파일 ID별로 집계해 작은 tokenizer 하나가 완료됐다고 전체가 95%로 보이지 않게 했다. Vite가 방출한 로컬 `ort-wasm-simd-threaded.jsep-*.wasm`을 `wasmPaths`에 명시해 기본 jsDelivr 경로에 우연히 의존하지 않는다.
- 자동 전사 추정은 현재 탭 전용이며 현재 CSV·Markdown·JSON·clipboard에 포함되지 않는다는 사실을 결과 패널과 dirty 안내에 표시한다. 재생 cue가 사용자가 줄인 effective range 밖이면 비활성화하고, 화면 판독기 이름에 timestamp·phase·전사 문구를 모두 포함하며 영상 확인 뒤 마지막 cue 버튼으로 초점을 돌린다.

### `0.3.3` 검증 결과

- clean dependency tree 기준 `npm audit --omit=dev`: 취약점 0개.
- `npm run check`: TypeScript, ESLint, 28개 파일의 316개 Vitest 테스트 통과.
- `npm run build`: 46 modules, 메인 JavaScript 414.96kB, candidate Pass B Worker 1,217.79kB, 로컬 ONNX WASM 21,596.01kB로 production build 성공.
- 로컬 Vite preview의 `/rettolight/`, hashed candidate Worker, hashed ONNX WASM에 각각 HTTP 200을 확인했다. production Worker 안의 고정 모델 revision `ff4177021cc41f7db950912b73ea4fdf7d01d8e7`, hashed WASM 경로, `wasmPaths` 설정도 확인했다.
- 실제 한국어 media fixture가 workspace에 없어 모델 다운로드→범위 디코드→전사→cue seek의 브라우저 실기기 smoke는 아직 실행하지 않았다. README는 이 기능을 `구현 및 정적 검증 완료, 브라우저 성공 경로 검증 전`으로 명시하며 이를 출시 완료로 과장하지 않는다.
- 이번 변경은 아직 commit·push·Pages 배포하지 않았다. 사용자 승인 전 로컬 working tree에만 둔다.

## 2026-07-20 — 앱 0.3.3 배포와 0.3.4 오디오 반응 종류 AI 착수

### `0.3.3` 배포 완료

- 커밋 `a252cbc`를 `main`에 push했다.
- GitHub Pages workflow `29694202268`이 `npm ci`, 316개 테스트를 포함한 `npm run check`, production build, artifact upload, deploy를 모두 통과했다.
- 공개 주소 `https://11qaws.github.io/rettolight/`, hashed candidate Pass B Worker, hashed local ORT WASM을 각각 HTTP 200으로 확인했다.
- 실제 한국어 media fixture 브라우저 종단 검증은 여전히 별도 비차단 증거로 남아 있으며 README의 제한 표현을 유지한다.

### 다음 AI 기능 결정

- 사용자 가치가 가장 큰 다음 기능을 후보 오디오의 `웃음 / 고함·외침 / 비명 / 박수·환호` 종류 단서로 정했다. 화려한 화면보다 스트리머 반응을 먼저 보려는 제품 원칙과 맞는다.
- Transformers.js가 지원하는 AudioSet AST 변환 모델을 채택한다. 모델 ID는 `Xenova/ast-finetuned-audioset-10-10-0.4593`, 고정 revision은 `249a1fbf0286b40e7f1ed687a8ae396997bf7dc6`, dtype은 q8, 첫 런타임은 WASM이다. q8 가중치는 약 90.8MB이며 원 MIT AST 모델은 BSD-3-Clause다. 모델은 다중 라벨 raw logits를 내지만 Transformers.js 3.8.1 high-level audio pipeline은 softmax를 고정 적용하므로, `AutoProcessor`·`AutoModelForAudioClassification`으로 직접 추론하고 sigmoid를 적용하기로 했다.
- 12시간 전체가 아니라 최대 12개 후보 각각의 reaction peak 전·중·후 10초 창 최대 3개, 합계 최대 약 6분만 분류한다.
- source separation이 없으므로 특정 소리가 스트리머에게서 났다고 확정하지 않는다. allowlist 라벨만 정성적으로 묶어 `오디오에서 그렇게 들림 · 재생 확인 필요` overlay와 확인 위치를 제공한다.
- AudioSet의 넓은 `Crowd` 문맥 라벨은 승인·환호를 뜻하지 않고 경기장·게임 배경음을 쉽게 포함하므로 positive allowlist에서 제외한다. `Clapping`, `Cheering`, `Applause`만 박수·환호 그룹에 남기고, ESC-50 박수 샘플에서 이 직접 라벨들만으로 강한 신호가 나온 것을 확인했다.
- `CandidateAudioEventRun`은 전사 `CandidatePassBRun`과 독립시켜 한 모델 실패가 다른 근거·후보·사람 편집을 훼손하지 않게 한다. 자동 재랭킹은 다음 `0.3.5`의 별도 ranking proposal로 미룬다.

### `0.3.4` 후보 오디오 반응 종류 AI 구현 결과

- 별도 lazy Worker가 fast pass의 최대 12개 후보마다 reaction peak 전·중·후 10초 창을 최대 3개만 Mediabunny로 범위 디코드한다. 한 번에 한 창의 16kHz mono PCM만 유지하고 처리 직후 0으로 덮어 참조를 해제하므로, 12시간 원본 전체를 메모리에 올리지 않는다.
- 고정 revision의 AudioSet AST q8 모델을 `AutoProcessor`·`AutoModelForAudioClassification`으로 직접 실행하고 multi-label logits에 sigmoid를 적용한다. high-level pipeline의 softmax는 사용하지 않는다. 디지털 무음·단발 click gate를 통과하지 못한 창은 모델을 호출하지 않고, 모든 창이 탈락한 후보는 명시적 `EMPTY_AUDIO` gap으로 끝낸다.
- 제품 allowlist는 `웃음`, `고함·외침`, `비명`, `박수·환호`뿐이다. 넓은 배경 문맥인 `Crowd`는 긍정 반응으로 오인하지 않도록 제외했고, 결과는 최대 2개의 `strong | possible` 정성 단서와 약 10초 재생 확인 창만 App으로 보낸다. raw score·전체 527개 라벨·PCM은 경계 밖으로 보내지 않는다.
- 독립 `CandidateAudioEventRun` reducer와 protocol/client fence가 source·analysis·run·Worker identity, 순서, 중복 event, 모델 준비 phase, 후보별 terminal outcome, 완료 envelope 집계를 검증한다. 마지막 후보 결과만으로 성공하지 않고 검증된 완료 envelope 뒤에만 `completed | completedWithGaps`가 된다.
- 재시도 merge는 종류별 기존 `strong` 근거를 no-clear·possible·실패로 지우지 않는다. 새 strong 단서를 먼저 받아들이고 최대 2개만 유지하며, 후보 점수·순서·경계·승인/제외·전사 overlay는 바꾸지 않는다.
- UI에는 `반응 종류 AI로 확인`, 최초 모델 약 91MB와 첫 로컬 AI 런타임 약 23MB 안내, 모델/후보 진행, 취소, 후보별 상태·쉬운 gap 문구와 cue seek를 추가했다. 혼합 방송 오디오라서 스트리머 반응 주체를 확정하지 않으며, 표시 범위가 사건의 정확한 시작·끝이 아닌 약 10초 확인 창임을 함께 알린다.
- 전사 run과 오디오 사건 run을 동시에 시작하지 못하게 원자적인 start-pending fence를 두고, 분석 중 `새 영상 시작`·`결과 이어보기` 같은 입력 교체 행동을 잠근다. 정상 취소는 오류 경고로 표시하지 않고, Worker ACK 정리와 강제 종료를 서로 다른 terminal reason으로 기록한다.

### `0.3.4` 배포 전 검증

- `npm run check`: TypeScript, ESLint, 33개 파일의 413개 Vitest 테스트 통과.
- `npm run build`: 51 modules, 메인 JavaScript 459.88kB, candidate audio-event Worker 1,226.70kB, candidate Pass B Worker 1,217.79kB, 로컬 ONNX WASM 21,596.01kB로 production build 성공.
- 로컬 production preview의 `/rettolight/`, hashed candidate audio-event Worker, hashed ORT WASM이 각각 올바른 `text/html`, `text/javascript`, `application/wasm` 형식과 HTTP 200으로 응답했다.
- 직접 모델 smoke에서 공식 ESC-50 웃음 샘플은 Snicker/Chuckle/Laughter, 박수 샘플은 Clapping/Applause로 검출됐고, 440Hz 단일 사인파는 제품 allowlist 점수가 모두 매우 낮았다. Worker 안의 고정 model revision, sigmoid 경로, hashed WASM 참조와 filename 미조회도 확인했다.
- 두 차례 독립 감사에서 배포 차단 P0/P1은 남지 않았다. Graphify 갱신 뒤 `App() → runCandidateAudioEventWorker()`와 `App() → mergeCandidateAudioEventEvidence()`가 각각 직접 EXTRACTED call edge이며, evidence merge가 전용 모듈·테스트에 연결된 구조를 재확인했다.
- 100초 합성 MP4에 30초 웃음과 70초 박수를 넣어 브라우저 종단 smoke를 시도했다. Chrome 확장의 `Allow access to file URLs`를 켜고 확장 연결·새 탭을 다시 만든 뒤에도 자동화 API가 native file chooser event를 내지 않아 fixture 주입 단계에서 멈췄다. 앱의 preflight나 Worker가 실패한 증거가 아니므로 정적·모델·단위 검증과 구분하며, `파일 선택 → fast pass → 모델 다운로드 → 분류 → cue seek` 브라우저 완주는 아직 확인하지 않았다고 기록한다.

## 2026-07-20 — 앱 0.3.5 설명 가능한 검토 우선순위 제안 착수

### 구현 전 계약

- 기존 후보 배열을 정렬해 덮어쓰지 않고, 후보 ID의 완전한 permutation을 가진 별도 `CandidateRankingProposal`과 화면 projection 상태를 둔다. 제안 생성, 적용, 되돌리기를 서로 다른 사용자 행동으로 만든다.
- fast-pass 점수 위에 이미 결합된 방송 오디오·채팅·화면 수치를 다시 가산하지 않는다. 후보가 보존한 normalized evidence를 0~10,000 정수 basis points의 `audioFamily 6,000 + chat 3,000 + visual 500 + audio·chat 합의 500`으로 한 번만 다시 조합하고 기존 점수순은 동률 안정화에만 쓴다. 후보 전용 오디오 사건의 가장 강한 `strong | possible` 하나는 별도 모달리티가 아니라 같은 audioFamily 안에서만 제한적으로 보강하며, 현재 run이 모든 후보를 gap 없이 완료했을 때만 전 후보에 적용한다.
- provisional transcript는 재생 위치와 설명 보조일 뿐 하이라이트 가치 점수로 쓰지 않는다. 전사 문구로 확인되지 않은 사건·승패·감정·원인을 만들지 않는다.
- 적용은 검토 카드 순서만 바꾼다. review·boundary·preview는 candidate ID로 보존하고, 승인 시간표와 모든 export는 계속 effective start time 순이다.
- proposal은 session·후보 집합·근거·화면 순서 revision에 묶는다. 새 정밀 근거가 생기면 stale 처리하되 이미 적용한 순서를 자동으로 되돌리지 않는다. 새 분석·복구 결과를 열면 ranking session을 초기화한다.
- 성공 경로 검증에는 사용자가 허용한 다운로드 폴더의 약 2시간짜리 H.264/AAC MP4를 읽기 전용으로 사용할 수 있다. 브라우저 선택→fast pass→여러 후보→추천 순서 제안까지 확인한다.

### `0.3.5` 구현 결과

- `candidateRanking`은 최대 12개 후보의 ID를 빠짐없이 한 번씩만 담은 결정적 제안을 만든다. 점수는 확률이나 절대 품질이 아니라 같은 하루 방송 안에서 먼저 검토할 상대적 근거량이며, UI에는 숫자 경쟁 대신 오디오 반응·채팅·화면 변화·교차 신호의 쉬운 이유를 보여 준다.
- 후보별 normalized evidence는 오디오 60%, 채팅 30%, 화면 5%, 오디오·채팅 동시 신호 5%로 한 번만 조합한다. 오디오 사건 AI는 동일 오디오 계열의 남은 여지만 작게 보강하고, 모든 후보를 gap 없이 완료한 run이 아닐 때는 성공한 일부 후보만 이득을 보지 않도록 전부 0으로 통일한다. provisional transcript의 랭킹 기여는 항상 0이다.
- 별도 `CandidateRankingViewState`가 canonical 후보 순서와 화면의 active 순서를 분리한다. 제안 도착만으로 목록을 바꾸지 않고 사용자의 `추천 순서 적용`과 `이전 순서로 되돌리기`만 화면 순서를 변경한다. session·후보 집합·근거 fingerprint·ranking/view revision·완전한 permutation을 모두 검사하며 늦거나 오래된 제안은 적용하지 않는다.
- 후보 카드·미리보기 번호만 active 순서를 따르고, 검토 상태·사용자 경계 수정·현재 미리보기 후보·정밀 AI 입력·저장 결과는 후보 ID 기반 canonical 상태를 유지한다. 승인 시간표와 CSV·Markdown·JSON·클립보드 출력은 계속 실제 시작 시각순이다.
- 후보 목록 위에 초심자용 제안 패널을 추가했다. `후보 순서 추천 만들기`로 먼저 결과를 살펴보고, 상위 5개 이동과 근거를 확인한 뒤 적용하거나 현재 순서를 유지할 수 있다. 적용 뒤에는 되돌리기를 제공하고, 정밀 근거가 바뀐 오래된 제안은 이유와 함께 다시 만들도록 안내한다.
- 랭킹 적용은 세션 작업으로 간주해 새 원본·복구 결과를 열 때 확인하며, 새 분석 결과가 후보 집합을 교체하면 proposal·undo·active order를 함께 초기화한다. StreamSaver 참고 CSS는 수정하지 않고 전용 `retto-highlight.css`에만 패널 스타일을 추가했다.

### `0.3.5` 배포 전 검증

- `npm run check`: TypeScript, ESLint, 35개 파일의 466개 Vitest 테스트 통과. 신규 랭킹 계산 9개와 화면 순서 상태 44개 테스트가 결정성, 정확한 permutation, transcript 0점, 부분 오디오 사건 결과 무시, stale/revision/session fence, 명시적 적용·되돌리기, malformed 순서 fallback을 포함한다.
- `npm run build`: 53 modules, 메인 JavaScript 482.22kB, CSS 52.96kB, audio Worker 333.57kB, candidate Pass B Worker 1,217.79kB, candidate audio-event Worker 1,226.70kB, 로컬 ONNX WASM 21,596.01kB로 production build 성공.
- 로컬 production preview의 `/rettolight/`에서 초심자용 4단계 시작 화면, 최대 12시간·로컬 처리·여러 후보 안내가 정상 렌더링되고 브라우저 warning/error 로그가 없음을 확인했다.
- 허용된 폴더의 가장 짧은 약 2시간 H.264/AAC MP4로 종단 smoke를 시도했지만, 앱 내 브라우저 자동화의 native file chooser event가 숨은 입력과 보이는 버튼 모두에서 열리지 않아 파일 주입 단계에서 중단했다. 앱 preflight나 분석 Worker 실패의 증거는 아니며, 실제 `파일 선택 → fast pass → 여러 후보 → 추천 순서 제안` 완주는 아직 별도 비차단 검증 항목으로 남긴다.
- 최종 독립 감사에서 채팅 신호가 한 작성자의 여러 메시지일 수도 있는데 `여러 시청자`라고 단정하던 설명을 중립적인 `채팅 반응`으로 고쳤다. 내부 가중치는 초심자 기본 화면에서 숨기고, 비교할 순서가 없는 후보 1개에는 랭킹 패널을 표시하지 않는다. 코드·UX 감사 모두 배포 차단 P0/P1이 남지 않았다고 확인했다.

## 2026-07-20 — 앱 0.3.6 근거 기반 사건·반응 단서 착수

### 구현 전 조사와 선택

- 현재 카드에는 fast narrative, 자동 전사 cue, 오디오 사건 cue가 서로 다른 블록으로 이미 존재하지만 사용자가 직접 합쳐 읽어야 한다. 다음 기능은 새 거대 생성 모델보다 이 근거들을 한 후보 설명과 가장 먼저 확인할 위치로 결정적으로 투영해 검토 부담을 더 줄이는 것으로 정했다.
- Qwen2.5 0.5B급 브라우저 생성 모델도 한국어를 지원하지만 ONNX 양자화 가중치와 tokenizer가 약 0.5~0.8GB이며 실용 성능은 WebGPU 의존도가 높다. 현재 Pages에는 COOP/COEP도 없어 WASM 다중 스레드 폴백을 기대하기 어렵고, 모델은 화면 사건을 새로 보지 못한 채 provisional 전사와 집계값을 자연어로 부풀릴 위험이 있다. 이번 3시간 수직 슬라이스에는 새 생성 모델을 넣지 않는다.
- production Pass B Worker는 start/end/text만 반환해 confidence와 speech-presence를 함께 요구하는 `grounded-transcript`에 도달하지 못한다. 따라서 모든 실제 전사는 `자동 전사 추정 · 위치 확인용`으로 유지하며 사건·행위자·원인·결과나 clip-worth를 만들지 않는다.
- 독립 UX 감사에서 이전 `0.3.5` 수정이 비슷한 JSX 조건을 잘못 바꿔 후보 1개에서 audio-event 패널을 숨기고 ranking 패널을 표시하는 회귀를 찾았다. 또한 stale ranking reason code를 최신 audio-event evidence와 섞는 provenance 오류, 재시도 실패 뒤 보존된 Pass B cue를 배지가 숨기는 문제, export의 `스트리머 오디오 반응`·`참여자 N명` 과장 표현을 함께 확인했다.
- `0.3.6`은 `candidate-evidence-explanation-v1` 순수 builder와 테스트, 기존 details의 `사건·반응 단서` projection, 가장 유용한 replay focus, 후보 수 조건·stale 이유·보존 cue 문구·export 주체 표현·키보드 focus와 작은 배지 대비 보강을 한 배포 단위로 묶는다. persistence/export schema와 새 AI run은 변경하지 않는다.

### `0.3.6` 구현 결과

- 새 `CandidateEvidenceExplanation` projection이 fast audio·chat·visual, 선택적 Pass B, 선택적 audio-event를 후보 ID별로 합친다. 사건·행위자·원인·결과는 항상 unknown으로 남기고, 전사는 80 Unicode code point 이내의 정규화된 인용과 위치로만 사용하며 clip-worth에는 가산하지 않는다. audio-event는 혼합 방송 오디오의 정성 단서이고 주체를 지정하지 않는다.
- 각 카드 기본 화면은 중립 제목과 `먼저 볼 이유`만 남겼다. `사건·반응 단서 보기` 안에서 사건 단서·반응 단서·아직 확인되지 않은 점·관측 신호를 세로로 읽고, AI가 하나로 고른 확인 위치를 별도 버튼으로 재생한다. 기본 `이 장면 처음부터 보기`는 사건 전 문맥을 건너뛰지 않는다.
- 사용자가 구간을 다듬어 strongest cue가 밖으로 나가면 원래 timestamp와 `현재 구간 밖`을 그대로 보이고, AI 확인 버튼은 현재 구간의 반응 정점, 그것도 밖이면 구간 시작으로 이동한다. 단서를 현재 구간 안으로 임의 clamp하지 않는다.
- 후보 수별 기능 노출을 순수 helper로 고정했다. 0개는 정밀 기능 없음, 1개는 전사·반응 종류 제공/랭킹 숨김, 2~12개는 모두 제공한다. stale ranking에서는 과거 reason과 최신 audio-event를 섞지 않고 상세 이유를 숨긴다.
- malformed Pass B ID, audio-event ID·proposal range·reaction peak, invalid effective range는 typed error로 검출한다. App은 precision presentation보다 먼저 binding을 검사하며, 한 카드의 잘못된 overlay를 모두 버리고 fast-pass 근거로 다시 만들어 후보 목록·편집·출력을 보존한다. 승인 목록도 같은 안전 wrapper를 사용한다.
- Pass B Worker 결과는 reducer가 현재 run phase와 event fence를 수락한 뒤에만 evidence map에 기록한다. 재시도의 불분명·실패·취소 결과가 기존 cue를 지우지 않으며 카드 배지는 `이번 재확인 불분명/실패 · 기존 단서 유지`를 구분한다.
- durable candidate reason과 CSV·Markdown 표시는 `스트리머 음성`·`참여자 N명`을 더 이상 단정하지 않는다. `혼합 방송 오디오 반응 신호`, `채팅 반응 신호`, `서로 다른 작성자 표기 N개`, `사건 단서`로 표현하며 JSON export schema `0.4.0`과 persistence schema `0.3.0`은 유지한다.
- 후보 제목을 실제 `h4`로 바꾸고 summary·일반 버튼·테마 버튼·경계 편집 버튼·cue를 최소 44px로 맞췄다. 밝은 테마 chat/visual 대비를 높이고 핵심 설명 본문은 13px로 올렸다.

### `0.3.6` 배포 전 검증

- `npm run check`: TypeScript, ESLint, 37개 파일의 523개 Vitest 테스트 통과. explanation 테스트는 provisional 전사의 무가점, 혼합 오디오 주체 미확정, 작성자 키 비인원화, 결정성·deep freeze, ID/range/peak mismatch fallback, 구간 밖 replay target을 포함한다.
- `npm run build`: 55 modules, main JavaScript 499.05kB(gzip 142.53kB), CSS 53.91kB, audio Worker 333.57kB, Pass B Worker 1,217.79kB, audio-event Worker 1,226.70kB, 로컬 ORT WASM 21,596.01kB로 production build 성공.
- 로컬 production preview에서 main JS·CSS·WASM의 HTTP 200과 올바른 MIME을 확인했다. 390×844 검증에서 수평 overflow가 없고 source/summary/theme control이 44px이며, 브라우저 console error가 없었다. production bundle에도 `스트리머의 음성 반응`, `평소보다 두드러진 스트리머 음성 반응`, `참여자 N명` 문구가 남지 않았다.
- 허용된 약 2시간 H.264/AAC MP4로 실제 파일 선택을 다시 시도했지만 Chrome 확장의 파일 URL 접근 권한이 없어 native chooser event 단계에서 중단했다. 앱 preflight·분석 Worker 실패와 구분한다. 시작 화면·순수 분석 계약·production asset은 검증됐지만 실제 샘플의 `파일 선택 → fast pass → 여러 후보` 브라우저 완주는 아직 별도 검증 항목이다.
- 세 차례 독립 재감사에서 reducer 수락 전 Pass B evidence 기록, malformed overlay 전체 render 중단, 승인 목록의 raw evidence 사용, 범위 밖 focus 표현, 혼합 오디오 export 과장을 찾아 수정했다. 최종 재감사 결과 P0·P1·P2는 남지 않았다.

### `0.3.6` 배포 완료

- 커밋 `c3dd700`을 `main`에 push했다.
- GitHub Pages workflow `29701206050`이 dependency 설치, 523개 테스트를 포함한 전체 검사, production build, artifact upload, Pages deploy를 모두 통과했다.
- 공개 주소 `https://11qaws.github.io/rettolight/`에서 새 main JS `index-YNyF5onq.js`, CSS `index-PO4iosxQ.css`, audio/chat/Pass B/audio-event Worker와 ORT WASM을 모두 HTTP 200으로 확인했다. main bundle에는 앱 `0.3.6`과 `사건·반응 단서 보기`가 포함되고 금지한 `스트리머의 음성 반응` 문구는 없다.
- 공개 화면을 390×844로 다시 확인해 4단계 시작 흐름, 최대 12시간·로컬 처리 안내, 44px source/summary/theme control, 가로 overflow 없음, console error 없음을 확인했다.

## 2026-07-20 — 앱 0.3.7 Gemini 한국어 후보 정밀 분석 착수

### 사용자 문제와 방향 전환

- 사용자가 실제 결과에서 로컬 Whisper tiny가 한국어를 거의 받아쓰지 못하고 영어·유럽 언어처럼 보이는 단어를 대사로 생성한다고 보고했다. 이는 단순 오탈자가 아니라 잘못된 언어 추정과 생성형 ASR 환각이 사람의 검토 시간을 오히려 늘리는 핵심 품질 실패다.
- 같은 날 허용된 2시간 샘플을 ffmpeg 8kHz mono fast-pass 평가기로 끝까지 측정해 7,232/7,232 feature window, 12개 후보, 약 36초 처리 시간을 확인했다. 동시에 기존 `crest >= 14dB` click gate가 5,041개(69.70%) 창을 impulse로 제거하는 별도 과억제 문제도 발견했다. 이 측정과 평가 script는 보존하되, 사용자가 직접 지적한 한국어 전사 실패를 먼저 해결하도록 우선순위를 바꿨다.
- 공식 Google 문서의 2026-07 현재 안정 Flash는 `gemini-3.5-flash`이며 audio input과 structured outputs를 지원한다. 일반 파일 입력 문서는 인라인 payload 100MB를 안내하지만 오디오 전용 문서는 총 요청 20MB를 명시하므로 더 좁은 오디오 계약을 기준으로 삼았다. 60초 16kHz mono PCM16 WAV는 Base64 포함 약 2.6MB이고 앱도 후보당 60초·Base64 8MB로 제한해 Files API가 필요하지 않다.
- production client에는 공용 키를 포함하지 않고 Cloudflare Worker 프록시를 사용한다. 운영 키는 Worker Secret으로만 관리하고 Pages에는 키 입력 UI나 키 필드를 두지 않는다.
- Pages origin `https://11qaws.github.io`에서 Gemini `generateContent` endpoint로 보낸 실제 CORS preflight는 `POST`, `content-type`, `x-goog-api-key`를 허용했다. 키 없는 OPTIONS 확인만 수행했으며 실제 API 호출·오디오 전송은 하지 않았다.

### `0.3.7` 구현 계약

- 로컬 fast pass가 먼저 만든 최대 12개의 30~60초 후보만 기존 Candidate Pass B Worker에서 16kHz mono WAV로 만들고, 한 후보씩 `gemini-3.5-flash`에 전송한다. 원본 전체·영상 프레임·파일명·채팅·후보 점수·사람 검토 상태는 요청에 넣지 않는다.
- 구조화 응답은 한국어 timestamp 대사, 오디오 기반 사건·반응 단서, 클립으로 검토할 이유, 불확실한 점만 허용한다. 모델이 후보 ID·원본 절대 시간을 만들지 못하게 하고 로컬 snapshot에서 주입한다. exact-key·타입·시간·길이·NFKC·제어문자 검증을 통과한 결과만 기존 event fence 뒤에 반영한다.
- Gemini는 교정된 confidence를 주지 않으므로 대사는 계속 provisional cue다. 사건·반응·클립 이유도 `Gemini 해석 · 직접 확인 필요`로 격리하며 fast score, ranking, boundary, review, export를 자동 변경하지 않는다.
- 키·PCM·WAV·Base64·Google 오류 원문은 persistence, export, 로그, fixture에 남기지 않는다. 취소는 in-flight fetch를 abort하고 기존 Worker ACK/강제 종료 계약을 유지한다. 인증/키, 할당량, 네트워크·5xx, 구조 오류는 서로 다른 redacted code로 안내하고 자동 재시도하지 않는다.

### `0.3.7` 구현 결과

- 기존 로컬 Whisper Pass B를 `gemini-3.5-flash` GenerateContent 후보 오디오 분석으로 교체했다. Worker가 후보 하나씩만 16kHz mono PCM16 WAV로 만들고 `x-goog-api-key` header, `store: false`, `responseFormat.text.schema`, `thinkingLevel: MEDIUM`으로 요청한다. Gemini 3.x 공식 권고에 따라 임의 sampling parameter는 보내지 않는다.
- 후보 전송 경계는 UI·client·Worker·request builder 모두 최대 12개, 후보당 최대 60초로 맞췄다. 60.001초 입력과 0ms transcript segment는 각 방어 경계에서 거부한다. 원본 전체·영상 프레임·채팅·파일명·후보 점수·검토 상태는 요청에 포함하지 않는다.
- 응답은 exact-key 구조, 한국어 또는 정확한 `[불명]` marker, 정방향 후보 상대 timestamp, 길이 제한을 모두 통과해야 한다. 한국어 대사와 오디오 기반 사건·반응·검토 이유·불확실성은 현재 실행 identity와 reducer fence를 통과한 뒤에만 후보별 임시 overlay가 된다. 점수·추천 순서·경계·승인·export는 바꾸지 않는다.
- 인증·권한, 잘못된 요청, 할당량, 네트워크·5xx, 안전 차단·잘못된 구조를 key-free code로 분리했다. 안전 차단·잘못된 구조는 해당 후보 gap으로 격리해 다음 후보로 진행하고, 같은 키로 계속 보내면 의미가 없는 run-level 오류는 즉시 중단한다. 취소는 진행 중 fetch부터 abort하고 기존 ACK fence를 지킨다.
- 초심자 UI에는 정확한 후보 개수·합계 시간과 실행 버튼을 한 패널에 모았다. 사용자는 별도 설정 없이 정밀 분석을 시작한다.
- 정밀 분석 상태 막대를 `준비 → 분석 중 → 완료/일부 완료/중지/실패`로 실제 run 상태에 맞추고, footer는 개인 편집 어시스턴트의 역할을 간단히 설명하도록 정리했다.
- 후보 카드에는 `Gemini가 오디오에서 추정한 사건 단서`와 `클립으로 먼저 볼 이유`를 기본 요약으로 붙이고, 상세 근거에는 들린 반응·불확실성을 함께 보여 준다. 모두 `모델 해석 · 직접 확인 필요`로 표시하며 검증되지 않은 정확도 향상을 약속하지 않는다.
- Gemini 설정과 결과 스타일은 Retto 전용 CSS에만 추가했다. 실행 control을 최소 44px로 유지하고, 390px 단일 열·200~400% 확대를 고려한 wrap, forced-colors의 실제 outline과 경계선을 보강했다. StreamSaver reference snapshot은 수정하지 않았다.

### `0.3.7` 배포 전 검증

- `npm run check`: TypeScript strict, ESLint warning 0, 39개 파일의 541개 Vitest 테스트 통과. 신규 테스트는 Gemini 요청 body·한국어 sanity gate·WAV/Base64·HTTP redaction, 후보별 invalid-response 격리, fetch abort, 60초 전송 상한, 0ms segment 거부를 포함한다.
- `npm run build`: 55 modules, main JavaScript 509.24kB(gzip 145.75kB), CSS 58.69kB, fast audio Worker 333.57kB, Gemini Pass B Worker 338.11kB, audio-event Worker 1,226.70kB, ORT WASM 21,596.01kB로 production build 성공. Pass B bundle은 로컬 Whisper 제거로 이전 1,217.79kB에서 338.11kB로 줄었다.
- production artifact에서 `gemini-3.5-flash`, Google endpoint, `x-goog-api-key`, structured `responseFormat`, `store:false`가 포함되고 `onnx-community/whisper-tiny`와 실제 `AIza...` key pattern이 없음을 확인했다.
- production preview의 저장된 후보 1개를 열어 Gemini 패널을 확인했다. 390×844에서 가로 overflow가 없고 주요 controls가 44px 이상이며 원본 재연결 안내와 동적 분석 상태가 노출됐다. 브라우저 console warning/error는 없었다.
- 해당 단계에서는 공식 요청 계약·Pages origin CORS preflight·mock fetch/Worker·production bundle까지 검증했고 실제 한국어 품질 smoke는 후속 검증 항목으로 남겼다.

### `0.3.7` 배포 완료

- 커밋 `a5200df`를 `main`에 push했다.
- GitHub Pages workflow `29703330647`이 541개 테스트를 포함한 전체 검사, production build, artifact upload, Pages deploy를 모두 통과했다.
- 공개 주소 `https://11qaws.github.io/rettolight/`에서 앱 `0.3.7`, main JS `index-g23dyy44.js`, CSS `index-Bwklaeef.css`, Gemini Pass B Worker와 나머지 Worker asset을 HTTP 200으로 확인했다. production bundle에는 실제 API key pattern과 제거한 Whisper 모델 참조가 없다.
- 공개 화면과 동일한 production asset을 390px 폭에서 확인해 실행 control이 최소 44px이고 가로 overflow와 console warning/error가 없음을 확인했다. 실제 한국어 인식 품질은 비차단 검증으로 남겼다.

## 2026-07-20 — 앱 0.3.8 로컬 빠른 분석 impulse 포화 교정

### 발견한 원인과 변경 계약

- 허용된 약 2시간 샘플의 7,232개 1초 feature window 중 5,041개(69.70%)가 기존 impulse gate에 걸렸다. 기존 조건은 비무음 창의 `crest >= 14dB`와 길이 2초 이하만 확인했는데, 분석 창 자체가 항상 약 1초여서 보통 말소리·혼합 방송 오디오의 높은 crest까지 클릭음으로 간주했다. 샘플의 crest 중앙값은 15.473dB, 90백분위는 20.783dB여서 기준 포화가 구조적으로 발생했다.
- Before: 후보 수준으로 크지 않은 평범한 고crest 창도 impulse 진단에 쌓였고, 실제 반응과 연속된 고crest 창도 바로 제거됐다. After: 로컬 baseline보다 충분히 상승한 후보 창에만 impulse 판정을 검토한다. 연속 고crest 창은 반응 범위를 넓히는 보조 신호로만 쓰며, 강한 음성대역 또는 crest가 낮은 반응 anchor가 없으면 후보를 시작하지 못한다.
- click penalty 자체는 점수에 남겨 화려한 단발 효과음이 상위로 오르는 것을 계속 억제한다. 새 예외는 점수·후보 수 상한·비중첩 선택·45초 기본 경계·12시간 처리 계약·Gemini 전송 범위를 바꾸지 않는다.
- 후보 선택 의미가 바뀌므로 앱 버전과 별도로 신호 엔진 identity를 `streamer-reaction-fast-pass-v2`로 올린다. 기존 v1 완료 결과는 그대로 저장되어도 새 엔진 결과로 가장하지 않으며, 같은 원본의 새 분석은 v2 input signature와 manifest를 사용한다.
- 직접 위험은 연속된 게임 효과음 두 개가 시간 지지를 얻을 수 있다는 점이고, 반대 위험은 너무 엄격한 gate가 짧은 웃음·외침을 다시 버리는 것이다. 따라서 지속성 하나만으로 “스트리머 반응”이라고 확정하지 않고 speech-band proxy, 후속 오디오 사건 AI, Gemini 설명과 사람 재생 확인을 서로 다른 근거로 유지한다.

### 구현과 실제 샘플 검증

- `candidateElevated`를 먼저 계산한 뒤에만 impulse 후보를 판정한다. `crest >= 14dB`인 짧은 창은 강한 speech-band 근거가 있을 때만 active anchor가 된다. 바로 이어진 상승 창은 실제 anchor 주변의 범위를 보조할 수 있지만 단독으로 후보를 만들 수 없고, feature gap을 사이에 둔 창은 시간 지지로 인정하지 않는다.
- 단일 창 이벤트도 강한 speech-band 근거가 있으면 검토 후보가 될 수 있게 했고, 기존 고립 저음성 click 제거와 장시간 일정한 배경음 억제는 유지했다. 단위 테스트는 평범한 고crest baseline, vocal anchor 주변 시간 지지, 강한 음성대역의 단일 burst, 고립 click, 연속 click 쌍, 누락 창 너머 click을 각각 분리한다. 독립 감사에서 재현한 click 쌍 반복의 12개 슬롯 소진은 이 anchor 규칙 뒤 후보 0개가 된다.
- 실제 약 2시간 샘플 전체를 다시 읽기 전용으로 분석한 결과 7,232/7,232 창을 26.776초에 처리했고 후보 12개를 만들었다. 5,041개는 여전히 존재하는 raw high-crest 창의 수이며, 이 중 새 gate가 실제 고립 impulse로 제거한 창은 1개다. eligible event는 기존 28개에서 102개로 회복됐다. 두 수치의 모집단을 혼동하지 않도록 평가 schema를 v2로 올리고 high-crest 수·비율과 rejected impulse 수·비율, crest 50·90·95백분위를 따로 출력한다.
- 이 결과는 gate 포화와 전체 처리 성공을 입증하지만 후보가 실제로 재미있는 장면인지에 대한 정답 라벨은 아니다. 후보의 의미 품질과 새로운 오탐 분포는 직접 청취 및 선택형 Gemini 후보 해석으로 A/B 확인해야 하며, 그 검증 없이 정확도 향상을 수치로 주장하지 않는다.

### `0.3.8` 배포 전 검증

- `npm run check`: TypeScript strict, ESLint warning 0, 39개 파일의 546개 Vitest 테스트를 통과했다.
- `npm run build`: 55 modules, main JavaScript 509.24kB(gzip 145.75kB), CSS 58.69kB, fast audio Worker 333.84kB, Gemini Pass B Worker 338.11kB, audio-event Worker 1,226.70kB, ORT WASM 21,596.01kB로 production build에 성공했다. main과 Gemini Worker의 크기는 `0.3.7`과 사실상 같고 fast audio Worker만 새 gate만큼 소폭 증가했다.
- Vite의 500kB 초과 chunk 경고는 기존 lazy audio-event Worker와 local ORT WASM에 대한 알려진 비차단 경고다. 이번 변경은 해당 asset을 main 초기 경로로 합치지 않았다.
- 독립 감사가 연속 저음성 click 쌍이 후보 12개를 모두 소진하는 첫 수정안의 P1 반례를 재현해 배포 전에 막았다. 최종 재감사에서는 click 쌍 21개가 후보 0개, 누락 창 사이 click이 후보 0개, vocal anchor 양옆의 고crest support가 후보 1개였으며 새 P0/P1이 없었다.
- Graphify는 문서 semantic 갱신이 외부 LLM key를 요구해 중단됐으므로 키를 주입하지 않았다. 로컬 AST `--code-only` 증분 갱신과 재클러스터링으로 최종 코드 4개 파일을 반영했고, query에서 `selectAudioReactionHighlights()`·`scoreWindow()`·`adjacentWindows()`와 후속 audio reaction/fusion 경로가 연결된 것을 재확인했다.

### `0.3.8` 배포 완료

- 커밋 `0d2dcd0`을 `main`에 push했다.
- GitHub Pages workflow `29704002290`의 build job이 dependency 설치, 546개 테스트를 포함한 전체 검사, production build와 artifact upload를 통과했고 deploy job도 성공했다.
- 공개 주소 `https://11qaws.github.io/rettolight/`에서 HTML, main JS `index-DCoyIotz.js`, CSS `index-Bwklaeef.css`, fast audio Worker `audioReactionAnalysis.worker-D3T6_2Rt.js`가 모두 HTTP 200과 올바른 MIME으로 응답했다. 공개 main bundle에는 앱 `0.3.8`과 `streamer-reaction-fast-pass-v2`가 포함된다.
- 앱 내 브라우저로 공개 첫 화면을 다시 열어 최대 12시간·여러 후보 안내와 원본 선택 흐름이 정상 렌더링되는 것을 확인했다. 실제 Gemini 한국어 결과는 후속 실사용 검증으로 계속 구분했다.

### 배포 후 후보 시간 분포 관측 보강

- 같은 장시간 샘플의 최종 12개 후보 peak가 원본 4등분 기준 `[0, 0, 3, 9]`로 후반부에 집중됐다. 첫 peak는 4,426.5초, 마지막은 6,742.5초이고 두 peak의 범위는 원본의 32.03%, 원본 시작부터 첫 peak까지의 가장 큰 공백은 4,426.5초다.
- 방송의 실제 재미있는 구간이 후반부였을 가능성과 상위 점수의 시간 편향 가능성을 정답 라벨 없이 구분할 수 없으므로, 후보를 억지로 시간대별 할당하는 production 변경은 하지 않았다. 대신 로컬 평가 script에 4등분 peak 수, 첫·마지막 peak, peak span, 경계 포함 최대 공백과 75% 단일 4분위 집중 flag를 추가했다.
- 이 telemetry는 후보 품질 판정이나 사용자 UI 경고가 아니다. 다음 직접 청취·Gemini A/B에서 앞부분의 좋은 반응이 누락됐다는 근거가 확인될 때 시간 다양성 재정렬 또는 구간별 reserve를 검토하기 위한 회귀 관측값이다. 원본 경로와 PCM은 출력·저장하지 않는다.

## 2026-07-20 — 앱 0.3.9 기본 배포 키와 Gemini 한국어 성공 경로

### 구현과 운영 경계

- 사용자별 키 입력과 동의 상태를 App, Worker protocol, CSS에서 제거했다. `후보 자세히 분석`은 배포 소유자가 Cloudflare Worker Secret으로 설정한 키를 사용하며 Pages source·bundle·브라우저 저장소에는 키 필드가 없다.
- Worker는 정확히 `{ audioBase64, candidateDurationMs }`만 받고 production Pages 또는 localhost Origin, JSON content type, Base64, canonical 16kHz mono PCM16 WAV, 선언·실제 크기, 후보 길이와 응답 크기를 다시 검사한다. 고정 prompt/schema와 `store:false`는 Worker가 조립하고 provider 오류 원문은 반환하지 않는다.
- Gemini REST의 실제 2026-07 계약에서 structured output MIME enum은 `APPLICATION_JSON`이어야 했다. `application/json`은 거절됐고, 복잡한 `additionalProperties`·배열/숫자 제약도 schema 검증에서 거절돼 지원되는 type/properties/required/items/description subset만 보낸다. 브라우저 parser의 exact-key·개수·시간·길이 검사는 그대로 유지한다.
- 한 실행의 정상 최대 12개 후보가 제한에 걸리지 않도록 IP별 예산을 12회/분으로 맞췄다. 유효한 WAV가 IP 제한을 통과한 뒤에만 전체 30회/분 예산을 차감하므로 잘못된 요청이나 이미 제한된 호출이 전체 예산을 소모하지 않는다.
- Google의 일시적인 `408/5xx` 권고에 맞춰 Worker에서 1초·2초 backoff 두 번만 재시도한다. 400·401·403·429와 앱 전체 run은 자동 반복하지 않으며, upstream 오류 code는 인증·요청·한도·연결·응답 구조로 나눠 초심자 문구에 매핑한다.
- 실제 샘플 대조에서 `gemini-3.1-flash-lite` revision `3.1-flash-lite-05-2026`이 3.5와 같은 핵심 한국어 발화를 훨씬 낮은 지연으로 반환했다. 당일 3.5의 반복 용량 오류와 무료 모델별 20회 한도를 함께 관측해 기본 모델과 실행 snapshot을 이 안정 revision으로 고정했다.
- Cloudflare의 기본 근접 실행에서는 Google 쪽 429가 반복됐지만 같은 키의 직접 요청은 성공했다. Worker placement를 `gcp:us-east4` 인접 위치로 고정한 뒤 같은 production 요청이 즉시 성공했다. 이 placement는 `wrangler.jsonc`에 선언해 재배포에서도 보존한다.

### 실제 한국어 성공 검증

- 허용된 샘플 `2026 07 17 - 음식 토크[KzAW3yow80Q].mp4`의 600초 지점부터 30초를 ffmpeg로 16kHz mono PCM16 WAV로 만들고 production Worker에 한 건 보냈다.
- Worker version `910508c5-4a66-4c71-8627-f0759b812101`은 HTTP 200, Pages CORS, `Cache-Control: no-store`, `finishReason: STOP`을 반환했다. smoke script가 exact insight keys, 모든 timestamp의 0~30,000ms 범위, 한글 대사 존재, 세 설명과 불확실성의 한글 여부를 단언하고 종료 코드 0으로 끝났다.
- 반환 대사는 `이거는 치즈 닭갈비`, `콘치즈 맞다`, `다섯 개 연속으로 틀린다고?`, `뭐지 처음으로 모르겠다` 등 6개 구간이었다. 사건·반응·클립 이유는 연속 오답 뒤 당황하는 흐름과 영상으로 확인할 맥락을 한국어로 설명했으며, 화면에서만 알 수 있는 문제 내용은 불확실성으로 분리했다.
- smoke helper는 실제 키를 인자로 받거나 출력하지 않는다. 배포 endpoint, 허용 Origin, 샘플 경로와 offset만 사용하고 응답 계약이 하나라도 어긋나면 실패한다.

### 배포 전 검사

- 관련 proxy·browser Worker 테스트는 transient retry, IP→전체 제한 순서, 각 limiter 거절·예외, upstream 오류 분류와 redaction, canonical WAV, 한국어 parser, 취소·후보 gap 계속 처리를 포함한다.
- `npm run check`: TypeScript strict, ESLint warning 0, 40개 파일의 565개 Vitest 테스트가 통과했다.
- `npm run build`: 55 modules, main JavaScript 504.85kB(gzip 144.02kB), CSS 56.62kB, candidate Pass B Worker 336.83kB, fast audio Worker 333.84kB, audio-event Worker 1,226.70kB, ORT WASM 21,596.01kB로 production build가 끝났다. 500kB 초과 경고는 기존 lazy Worker/WASM 경계의 알려진 비차단 경고다.
- Wrangler dry-run은 `RATE_LIMITER 30/60s`, `IP_RATE_LIMITER 12/60s`, `gcp:us-east4` placement가 포함된 32.99KiB Worker bundle을 검증했다.
- source와 production bundle을 따로 검색해 실제 `AQ.*`·`AIza*` 패턴 0건, bundle의 키 입력 UI·Google 직접 endpoint·`x-goog-api-key`·`GEMINI_API_KEY` 0건을 확인했다. bundle에는 앱 `0.3.9`와 공개 중계 endpoint만 포함된다.
- 390×844 production preview를 다시 열어 초심자 4단계, 개인 편집 어시스턴트 문구, 최대 12시간·여러 후보 시작 흐름, 영상 선택 control을 확인했다. 키·동의 UI가 없고 브라우저 로그도 0건이었다.

## 2026-07-20 — 0.3.10 후보별 미리보기·클립 파일 다운로드

### 구현 내용

- 후보 카드 안에 `이 구간 바로 보기` 플레이어를 추가했다. 카드 위치에서 AI가 고른 시작점부터 재생하고, 유효한 끝점에서 자동으로 멈추므로 상단 원본 플레이어로 되돌아갈 필요가 없다. 경계 조정 중에는 열려 있는 후보 플레이어의 현재 위치를 시작·끝점으로 사용할 수 있다.
- Mediabunny를 지연 로드하는 `clipRenderer`를 추가했다. 선택한 원본의 컨테이너에 맞춰 MP4 또는 WebM을 만들고, 승인 후보의 실제 유효 구간만 새 timestamp 기준으로 잘라 `retto-highlight-번호-시작-끝.ext` 형식으로 저장한다. 변환 진행률, 취소, 지원하지 않는 코덱·빈 출력·잘못된 구간을 구분해 UI에 안내한다.
- 각 후보 카드에 개별 다운로드 버튼을 추가하고, 결과 패널에 승인 후보 전체 다운로드 버튼을 추가했다. 전체 다운로드는 시간순으로 하나씩 렌더링해 브라우저 다운로드 보호에 맞춰 진행 상황과 실패 후보를 표시한다. 개별 실패가 있어도 나머지 후보는 계속 시도한다.
- 원본을 바꾸거나 분석을 초기화하면 진행 중인 렌더링과 미리보기를 취소하고 이전 파일의 다운로드 상태를 버린다. 복원 결과처럼 현재 원본 파일이 연결되지 않은 경우에는 버튼을 비활성화하고 재연결 안내를 표시한다.

### 검증

- `src/media/clipRenderer.test.ts`에서 MP4/WebM 선택, 결정적 파일명, 범위 검증을 확인했다.
- `npm run check`와 `npm run build`를 통과시켰으며, Mediabunny는 초기 화면 번들에서 분리된 지연 chunk로 유지했다. 실제 브라우저에서는 카드 내 미리보기·개별 다운로드·전체 다운로드의 성공 경로와 다운로드 허용 안내를 확인한다.
## 2026-07-20 — `0.3.12` Gemini 후보 오디오·화면 멀티모달 분석

- Gemini 후보 정밀 분석이 더 이상 오디오만 보내지 않는다. 각 30~60초 후보에서 10%, 37%, 63%, 90% 지점의 대표 JPEG 화면을 최대 4장 샘플링해 오디오와 함께 `generateContent` 이미지 파트로 전달한다.
- 프레임은 후보 상대 시각·JPEG MIME·Base64 길이를 검증하고, 프록시 요청 전체 크기를 제한한다. 화면 디코드·seek·캔버스 실패 또는 취소가 발생해도 해당 후보는 오디오만으로 계속한다.
- Gemini 고정 prompt는 화면에서 실제로 보이는 장면과 스트리머 반응을 우선 설명하되 보이지 않는 사건·주체·인과를 추측하지 않도록 갱신했다. 기존 provisional transcript와 점수·ranking·경계·승인 분리는 유지한다.
- `npm run check` 결과: 42개 test file, 571개 test 통과. 대표 프레임 timestamp 및 멀티모달 요청 builder 회귀 테스트를 추가했다.
- 배포: GitHub Pages Actions `29739942282` 성공, 공개 번들에서 `videoFrames`·대표 화면 코드와 키 비노출을 확인했다. Cloudflare Worker `rettohighlight-gemini`도 새 프록시 계약으로 배포했고 `/healthz`가 정상 응답했다.
## 2026-07-21 — `0.3.13` Gemini 3.1 Pro 해석 모델 전환

- 후보 정밀 해석 모델을 `gemini-3.1-pro-preview`로 교체했다. Google AI 공식 Gemini 3.1 문서에서 사용하는 API 식별자를 기준으로 endpoint와 실행 manifest를 함께 갱신했다.
- 기존 오디오+대표 화면 멀티모달 입력, 한국어 구조화 JSON, 화면 샘플링 실패 시 오디오 fallback, 점수·순위·구간·승인 분리는 유지한다.
- Pro 모델은 기존 Flash-Lite보다 비용과 지연이 커질 수 있으므로 후보당 60초·최대 12개·대표 화면 최대 4장의 경계를 그대로 적용한다.

## 2026-07-21 — `0.3.24` 후보 회귀 조사: 오프닝 음악 제거와 채팅 단독 후보 복원

### 재현한 원인

- 음식 토크 샘플(`2026 07 17 - 음식 토크[KzAW3yow80Q].mp4`, 2시간 15분)을 현재 로컬 오디오 fast pass로 다시 읽었다. 전체 8,115개 1초 창을 빠짐없이 분석했고, 현재 기준은 오프닝 대기 화면의 1:11·1:45·2:34·3:56 부근을 `dialogue-issue-signal`로 만들었다. 화면 캡처를 대조하면 네 구간 모두 같은 오프닝 대기 음악 화면이었다.
- 이 재현에는 채팅 파일을 입력하지 않았다. 따라서 채팅 후보 억제는 이번 실행의 직접 원인이 아니다. 과거 `7f427e0`(대사 lead 미허용)과 `c8ba9e6`(대사 lead 복원)을 같은 원본에 대조했을 때 오디오 후보가 0개에서 오프닝 음악성 후보 3개로 변했으며, 직접 원인은 `c8ba9e6`에서 대사 신호를 너무 넓게 다시 허용한 회귀로 확인했다.
- 별도로 `v4-audio-primary-chat-context`의 `createReactionAnchorDrafts()`가 오디오 후보가 하나라도 있으면 사용되지 않은 채팅 후보를 버리는 문제도 확인했다. 이는 채팅 파일을 넣은 실행에서만 나타나는 독립 회귀이며, 두바이초콜릿이 실제로 그 경로였다는 증거는 아직 없다.

### 변경 계약

- 오디오에서만 나온 `dialogue-issue-signal` 중 낮은 음량·높은 대역 비율·낮은 robust loudness가 함께 나타나고 채팅·화면 근거가 없는 신호는 O 후보에서 제외한다. 오디오 원점은 timeline 점수 rail에 그대로 남겨 사용자가 잠재 구간을 볼 수 있다. 같은 신호에 화면 변화나 채팅 반응이 붙으면 정상 후보로 유지한다.
- 사용되지 않은 강한 채팅 burst는 오디오 후보가 이미 있어도 독립 후보로 복원한다. 후보 상한 12개·45초 창·중복 억제·결정적 정렬은 유지하고, 오디오+채팅 합의 후보를 단독 채팅 후보보다 먼저 정렬한다. 이 경로는 채팅 파일을 실제로 추가한 다음 별도 검증해야 하며, 채팅이 없는 실행에는 영향을 주지 않는다.
- 후보 의미가 바뀌므로 signal engine identity를 `streamer-reaction-fast-pass-v5-chat-fallback-music-confirmation`으로 올렸다. 기존 v4 저장 결과는 새 엔진 결과로 가장하지 않고, 새 분석에서만 v5를 사용한다.

### 검증

- `highlightFusion.test.ts`에 오디오가 있어도 강한 채팅 단독 후보를 보존하는 회귀와, 오프닝 음악성 dialogue lead는 제거하되 화면으로 확인된 dialogue는 보존하는 회귀를 추가했다.
- `npm run check`: TypeScript strict, ESLint warning 0, 44개 파일의 588개 Vitest 테스트 통과.
- 과거 엔진과 현재 엔진을 같은 샘플에 대조해 `dialogue-issue-signal` 재도입이 후보 변화의 원인임을 확인했다. 재현된 오프닝 오디오 후보는 fusion 단계에서 O 후보 0개로 줄고, raw signal은 점수 rail용 입력으로 남는다. 이는 오프닝을 후보로 노출하지 않으면서 잠재 신호를 숨기지 않는 의도된 결과다.

## 2026-07-21 — `0.3.25` AI provider와 방송 전체 맥락 준비 구조

### 구현

- 기존 Gemini Candidate Pass B를 기본·활성 provider로 유지하면서 후보 해석 역할의 provider catalog를 추가했다. Qwen은 현재 오디오+대표 화면 계약에 맞는 `qwen3.5-omni-plus`, 방송 전체 맥락 역할은 `deepseek-v4-pro`로 등록했다.
- Worker 환경 경계를 `CANDIDATE_INSIGHT_PROVIDER`, `BROADCAST_CONTEXT_PROVIDER`, provider별 credential로 분리했다. Gemini는 기존 endpoint로 정상 연결하고, Qwen은 키·Workspace ID·region을 안전하게 검증해 연결 정보를 만들되 adapter live smoke 전에는 `PROVIDER_NOT_ACTIVE`로 fail-closed 한다. DeepSeek는 기본 `disabled`다.
- readiness manifest는 model ID/revision과 configured/active boolean만 반환하는 순수 구조로 만들었다. API key, Workspace ID, endpoint는 포함하지 않는 회귀 테스트를 추가했다.
- 최대 12시간 방송을 최대 144개의 시간순 chapter 요약과 최대 12개 기존 후보의 텍스트 근거로 축약하는 `broadcast-context 1.0.0` 계약을 추가했다. 출력에는 후보별 맥락 설명·분류만 있고 score·rank·boundary·review·approval 필드는 없다.
- `wrangler.jsonc`에는 공개 selector 기본값만 넣었다. 외부 Secret 변경, Worker 배포, GitHub Pages 배포는 수행하지 않았다.

### 검증

- provider 기본값·Qwen 허용 region/Workspace endpoint·잘못된 설정 fail-closed·DeepSeek disabled 기본값·secret redaction을 단위 테스트로 고정했다.
- 전체 맥락 계약의 12시간 상한, chapter 비중첩, candidate ID 중복, 텍스트 상한, 결정 필드 부재를 단위 테스트로 고정했다.
- `npm run check`: TypeScript strict, ESLint warning 0, 46개 파일의 598개 Vitest 테스트 통과.
- `npm run build`: 129 modules production build 통과. 기존 500kB 초과 lazy chunk 경고 외 신규 오류는 없다.
- `wrangler deploy --dry-run`: Gemini/disabled selector와 기존 두 rate limiter를 포함한 40.48KiB Worker bundle 확인. 실제 배포는 하지 않았다.
- production `dist`에서 provider Secret 이름과 `AIza`·`sk-` 형태의 키 패턴이 0건임을 확인했다.

## 2026-07-21 — `0.3.26` 편집자 중심 후보 검토 UI

### 문제와 우선순위 재정의

- Before: 복구 목록, 원본 입력, AI 세부 단계, 추천 순서, 타임라인, 모든 후보 상세 카드, 출력이 한 세로 흐름에서 비슷한 무게로 이어졌다. 후보를 확인하려면 페이지를 오르내려야 했고, 편집자가 지금 판단할 장면이 무엇인지 한눈에 알기 어려웠다.
- After: 결과의 주 경로를 `타임라인 → 선택 후보 하나 → 재생/판단 → 출력`으로 고정했다. 남은 후보·사용·제외 수를 결과 머리에 표시하고, 타임라인 카드를 가로 탐색하며 현재 후보를 선택한다. 최대화 화면에서는 왼쪽 미리보기와 오른쪽 후보 상세를 나란히 유지하고 이전·다음 후보 이동을 제공한다.
- 반응 종류 재분석, Gemini 재시도와 추천 순서 비교는 `AI 보강 분석과 후보 순서` 접힘 영역으로 옮겼다. 기능과 상태 계약은 유지하되 일상적인 검토 동선과 시각적으로 경쟁하지 않게 했다.
- 복원 결과를 열면 복원 목록은 접힌 상태로 다시 마운트하고 후보 검토 제목으로 바로 이동한다. 원본이 없는 결과에서도 타임라인과 설명을 선택할 수 있으며, 재생이 필요하면 바로 위의 압축된 원본 재연결 영역으로 돌아간다.
- 출력은 사용 후보가 하나 이상이거나 검토를 완료한 뒤에만 나타나며, 저장되지 않은 현재 판단 안내는 접힌 보조 문구로 낮췄다.

### 상태·호환성 경계

- 기존 `previewCandidateId`를 `CandidateReviewFocus` 화면 projection으로 사용한다. 선택은 자동 재생·자동 승인하지 않으며 후보 점수, 순위, 경계, review state와 export를 변경하지 않는다.
- 후보별 인라인 플레이어를 제거하고 하나의 작업공간 플레이어만 사용한다. 시작·끝 경계 설정은 현재 선택 후보와 이 플레이어의 시각을 기준으로 유지된다.
- 후보 결과가 처음 열리거나 이전·다음 후보로 이동하면 작업공간 플레이어를 해당 시작점에 정지 상태로 준비한다. 실제 재생과 승인·제외는 계속 사용자의 명시적 입력만으로 일어난다.
- IndexedDB schema, 분석 결과, Gemini 계약, 후보 검출 엔진과 저장 형식은 변경하지 않았다. 이번 변경은 표시 계층과 현재 탭 포커스에만 한정된다.

### 검증

- `npm run check`: TypeScript strict, ESLint warning 0, 46개 파일의 598개 Vitest 테스트 통과.
- `npm run build`: 129 modules production build 통과. 기존 lazy clip renderer·audio-event Worker·ORT WASM의 500kB 초과 경고 외 신규 빌드 오류는 없다.
- 허용된 60초 샘플과 2시간 15분 음식 토크 샘플로 `원본 연결 → 빠른 분석 → 결과 복원 → 후보 이동 → 사용 판단 → 출력 공개`를 확인했다. 최대화 1440×900에서 타임라인과 2열 편집 작업공간이 한 흐름으로 이어졌고 document 가로 overflow는 없었다.
- 390×844에서도 document 가로 overflow가 없고, 후보 판단 버튼은 화면을 덮는 긴 1열 sticky 영역 대신 카드 안 2×2 정적 영역으로 유지됐다. 복원 결과를 열면 후보 검토 제목이 포커스를 받고 고정 헤더 아래로 이동한다.
- Google Drive에서 다시 내려받은 `2026 07 17 - 음식 토크[KzAW3yow80Q] (1).mp4`는 499,164,414 bytes, SHA-256 `F8A094E8169EA7635D720EE9D47BAB87E6915E9980EC62E7F71D76B06287AA4E`로 기존 로컬 원본과 byte-for-byte 일치했다. 이후 브라우저 검증 입력은 이 Drive 다운로드 파일을 명시적으로 사용했다.
- 로컬 `0.3.26` 빠른 분석은 후보 5개(정점 00:21:02, 00:22:45, 00:02:34, 00:03:56, 00:01:45)를 만들었다. localhost preview에서는 production 전용 Gemini 중계에 연결되지 않아 `PROXY_UNAVAILABLE`로 끝났고 빠른 후보는 보존됐다. 새로고침 뒤 저장 기록 1개가 남았고 `이 결과 이어보기`로 후보 5개·시간표·검토 상태가 복원되며, 영상 blob만 의도대로 재연결을 요구했다.
- 공개 배포판은 아직 `0.3.23`이었다. 같은 Drive 파일에서 동일한 후보 5개를 만들었고 production Gemini는 정상 완료해 칼국수·껍데기 사건 2개와 음악/대기 구간 3개를 명확히 구분했다. 따라서 파일·Gemini 키·production Worker 성공 경로는 확인됐지만, 음악 3개가 O 후보에서 먼저 제거되지 않는 회귀와 `0.3.26` 미배포는 별도 해결이 필요하다.

## 2026-07-22 — `0.3.28` 전체 맥락 자동 분석과 모델 라우팅

- 빠른 소리 후보만으로 조용한 성공·사과·설정 회수를 찾을 수 없다는 평가를 기준으로, 후보 검증과 별개인 방송 transcript → 전체 문맥 → 의미 lead 재확인 파이프라인을 구현했다.
- Gemini 3.5 Flash는 짧은 후보의 오디오+대표 화면, Qwen3 ASR Flash는 장시간 한국어 음성 표본, Qwen3.7 Plus는 압축된 방송 전체 문맥에 배치했다. Qwen3.5 Omni Flash·Qwen3.6 Flash·Gemini 3.1 Pro·DeepSeek V4 Pro는 역할별 폴백·상위 판정 정책에 두되 검증되지 않은 transport를 가장해 활성화하지 않았다.
- 12시간 입력을 모든 10분 셀에서 고르게 표본화하고 사건 주변을 보강하면서 ASR `$0.42`, 의미 lead 재확인 `$0.03`, 전체 정책 약 `$0.997`의 상한을 적용했다.
- 전체 문맥 계약은 0개 후보를 정상으로 허용하고 음악·노래·MV·오프닝·엔딩·쉬는 화면을 선택하지 않으며, 기존 후보 밖의 사과·조용한 성취·설정 회수 lead를 chapter ID에 근거해 제안하도록 제한했다.
- transcript/context/refinement 유료 결과를 입력 서명·model revision과 함께 IndexedDB에 저장하고 readback 검증 뒤 재사용한다. 의미 후보의 저장된 Gemini 결과도 복구 초기에 보존해 새로고침 뒤 같은 후보를 재과금하지 않는다.
## 2026-07-22 — `0.3.38` 교환학생 출연진 전체 맥락·Gemini 경로 보강 착수

- 사용자 확인에 따라 교환학생 방송의 출연진 정답을 `세라 교수님`, `아모레또`, `유레카`, `세나 아르벨`, `토로리 코코`, `망징이`로 고정하고, 기존 `교수님` 표기를 `세라 교수님`으로 교정하기로 했다.
- 기존 구현은 후보별 대표 화면 분석에만 닫힌 출연진 자료를 사용했고 전체 방송 맥락 요청에는 roster가 없었다. 이번 변경은 같은 방송 경계 안에서만 roster ID를 전체 맥락 overview·topic discovery·jury·refinement 전 단계에 전달하고, Worker가 canonical 이름과 안전한 호칭만 prompt로 확장한다.
- Cloudflare production에는 `GEMINI_API_KEY`와 `QWEN_API_KEY` Secret 이름이 모두 존재함을 값 노출 없이 확인했다. 단일 `GEMINI_ENDPOINT`가 후보 모델 ID에 묶인 채 Gemini 대사 경로에도 재사용되는 결합을 발견해 역할별 model endpoint로 분리한다.
- GitHub review는 canonical 후보를 삭제하지 않는 projection 무결성, 사용자 판단 우선, 저장 결과 복구와 coverage 의미 구분을 계속 수용한다. 전면 state machine·진단 UI·단일 manifest 재구성은 회귀 범위가 커 이번 패치에서는 보류한다. 리뷰의 PR 강제 절차는 저장소 소유자가 이 세션에 main 배포를 명시적으로 허용한 운영 방식과 충돌하므로 적용하지 않는다.
- 구현 전 계약: roster v2는 해당 방송에만 새 캐시 서명을 만들고 다른 방송의 유료 결과는 그대로 재사용한다. 오류별 fallback은 최대 한 번이며 결정적 입력 오류와 시간 과금 ASR timeout에는 적용하지 않는다. 구현·테스트·실제 최소 Gemini smoke·Worker/Pages 공개 검증 결과는 이 항목에 이어 기록한다.

## 2026-07-23 — `0.3.43` 동적 사건 지도·안전한 검토창·모바일 후보 파이프라인

### Before / 원인

- 분석 절차는 현재 단계 설명과 네 단계 표시가 서로 다른 행을 차지하면서도 단계 표시는 19px 원과 작은 글자뿐이었다. 타임라인은 빠른 탐색 원이 먼저 시선을 차지했고, 맥락 탐색 셀·잠재 신호는 눌러도 무엇을 뜻하는지 충분히 설명하지 않았다.
- 후보를 누르면 작업공간 플레이어가 seek 준비를 마치기 전에 재생될 수 있었고, 타임라인 아래의 별도 검토창까지 다시 내려가야 했다. 최대화 편집 화면의 가로 공간을 사용하지 못했다.
- 모바일의 정밀 후보 분석은 별도 단일 후보 제한이 있던 것이 아니다. 모든 후보의 대표 프레임을 먼저 최대 2개씩 준비한 뒤에야 AI 요청 전체를 시작하는 두 단계 배치였다. 모바일 미디어 디코더가 프레임 준비를 직렬화하면 첫 AI 호출조차 늦어져 사실상 한곳에서만 오래 도는 것처럼 보였다.
- `Broadcast context requires between 1 and 144 bounded chapter summaries.`는 두 상태를 같은 전송 검증으로 처리한 결과였다. 저장용 세부 대사 지도가 144개를 넘는 경우뿐 아니라, 로컬 중계 실패로 91개 표본이 모두 gap이 되어 `chapters=[]`인 실패 체크포인트도 저장 계층에서 전송 요청처럼 거부했다.

### After / 구현

- 저장 대사 지도와 API 전송 projection을 분리했다. 세션은 최대 4,096개 세부 chapter와 `chapters=[] + gapChunkIds` 전체 공백 체크포인트를 보존한다. whole-context 클라이언트의 마지막 공통 경계는 어떤 호출 경로든 인접 구간을 결정적으로 최대 144개로 압축하고, 압축된 ID로 응답을 다시 검증한다. 전체 공백이면 무한 대기 대신 `대사 근거를 한 구간도 확보하지 못함`과 재시도를 보여 준다.
- 타임라인의 맥락 탐색 셀과 종류별 잠재 신호를 실제 button/inspection target으로 만들었다. 저장된 chapter가 있는 탐색 셀은 해당 구간의 실제 요약을 즉시 열고, gap은 근거 미확보를 숨기지 않는다. 잠재 신호는 클립 확률이 아니라 같은 신호 종류 안의 0~100 상대 높이임을 범위·종류와 함께 설명한다. 완료된 탐색 단서는 분석 중 최신 네 건까지 동적으로 공개한다.
- 데스크톱 검토 영역은 타임라인 2/3, 선택 후보 플레이어 1/3로 같은 상단 행에 배치하고 후보 상세 목록은 그 아래 전체 폭으로 둔다. 단계 진행 패널은 현재 상태와 64px 높이의 네 단계 카드를 같은 행에 배치한다. 1,121px 이하에서는 한 열로 자연스럽게 전환한다.
- 후보 원·요약 카드·이전/다음은 이제 자동 재생이 아니라 `pause → 후보 범위 seek → seeked/canplay 확인 → 준비 완료`만 수행한다. 실제 재생은 플레이어나 `이 구간 재생`의 명시 입력에만 허용한다. 준비 전에는 플레이어 위에 차단 안내를 표시한다.
- 후보 정밀 분석은 각 후보마다 `대표 프레임 준비 → 즉시 AI 검토`를 하나의 작업으로 묶고 최대 두 작업을 병렬 실행한다. 첫 후보 프레임이 준비되면 다른 후보 프레임을 기다리지 않고 요청을 시작하며, 활성 후보가 둘이면 진행 문구도 동시 검토임을 알린다. 결과·gap·저장 event는 기존 run identity와 후보별 revision guard를 유지하고 마지막에 한 번만 RUN_COMPLETED로 합산한다.
- whole-context annotation이 `music-or-intermission`, `music-or-song`, `opening-ending-or-break`로 판정한 후보는 모델이 실수로 select를 반환해도 최종 검토 후보에서 제외한다. 별도 MV의 녹음된 목소리·노래는 현재 스트리머의 실시간 대화·채팅 상호작용·고유 사건 근거가 없으면 같은 제외 대상으로 prompt와 결정 projection을 함께 고정했다. 편집자가 이미 승인한 후보는 기존 사용자 우선 규칙을 유지한다.

### 위험과 복구

- 장별 압축은 저장 원문을 변경하지 않고 요청 projection만 바꾼다. 144개 이하 입력은 동일 배열을 그대로 사용하며, 145개 이상일 때만 인접 범위를 묶는다. 공백을 포함한 묶음은 sampled evidence와 낮아진 coverage로 보존한다.
- 후보별 worker를 둘씩 실행하므로 모바일 디코더가 한 개뿐이면 프레임 준비 자체는 시간 분할될 수 있다. 그래도 먼저 준비된 후보의 원격 AI 요청이 즉시 시작되어 기존의 전체 선행 배치 지연은 제거된다. 동시성은 2로 고정해 메모리·요청 폭증을 막았다.
- 로컬 개발 Origin에서는 production 중계가 모든 Qwen ASR 표본을 gap으로 반환해 실제 주제 생성 성공을 검증할 수 없었다. 대신 전체 공백 저장·오류·재시도 UI를 검증했다. production Worker/Pages 실제 배포와 AI 성공 경로는 사용자 승인 뒤 별도 smoke가 필요하며, 이번 작업에서는 commit·push·배포하지 않았다.

### 검증

- `npm run check`: TypeScript strict, ESLint warning 0, 74개 파일의 791개 Vitest 테스트 통과. 145개 저장 chapter의 144개 전송 projection, 전체 gap의 빈 지도 보존, 음악 annotation 강제 제외를 회귀 테스트로 추가했다.
- `npm run build`: 157 modules production build 통과. main JS 643.57kB(gzip 185.77kB), CSS 112.68kB(gzip 19.15kB)이며 기존 500kB 초과 lazy chunk 경고 외 오류는 없다.
- `wrangler deploy --dry-run`: 213.54KiB(gzip 41.68KiB), Qwen 세 역할·bounded fallback·두 rate limiter·Singapore 설정을 확인했다. 실제 배포는 하지 않았다.
- production Pages bundle에서 실제 `AIza…`, `sk-…`, `GEMINI_API_KEY`, `QWEN_API_KEY`, `x-goog-api-key` 패턴은 모두 0건이었다.
- 허용된 02:15:14 음식 토크 원본으로 91개 분산 탐색 셀 진행과 전체 gap 저장을 확인했다. 이전의 1~144 경고는 재발하지 않았고, 근거 0구간 전용 안내로 바뀌었다.
- 같은 원본의 19:00부터 4분 QA 조각에서 최종 후보 2개와 2/3 타임라인·1/3 검토창을 확인했다. 후보 2를 누른 직후와 700ms 뒤 플레이어는 모두 `paused=true`, `currentTime=195.167`, `readyState=4`였으므로 선택만으로 소리가 재생되지 않았다.
- 390×844에서 현재 단계·네 단계 카드·실시간 탐색 지도가 가로 잘림 없이 한 열로 이어지고 네 단계 카드는 한 패널 안에서 읽을 수 있는 크기로 유지됐다. 데스크톱에서는 타임라인과 플레이어 상단이 같은 y축에서 시작했다.

## 2026-07-25 · 스트리머 팔레트 대비-보정 + 검토 카드 보존

- **문제(가독성):** 팔레트가 accent를 고정 명도(L62)로 찍어, 같은 L이라도 실제 상대휘도가 높은 hue(초록·하늘색·골드)에서 흰 라벨과 accent-as-text 대비가 무너졌다(하네스에서 사용자 확인).
- **해결:** `src/app/streamerPalette.ts`를 대비-보정 방식으로 재작성. HSL→RGB→WCAG 상대휘도로 흰색 대비를 계산해, accent는 흰 라벨 ≥4.5:1을 만족하는 가장 밝은 명도로, accentInk(유채색 텍스트)는 ≥6.5:1로 hue별로 명도를 푼다(`solveLightness`). "동일 톤무게"의 기준을 동일 L이 아니라 **동일 대비**로 교체.
- **색 재배치:** 기본(bg)=교환학생 공통 로즈(hue 350). 아모레또=벽돌 브라운-레드(hue 14, chroma 0.72). 유레카=브랜드 그린-틸(hue 152)로 확정(금발은 머리색일 뿐, 이름표·매직·눈동자가 그린). 세나 290·토로리 202·망징이 216 유지.
- **보존 테마:** 원래 기본 바이올렛(249)=`violet` "클래식 바이올렛", 유레카 초기 골드(40)=`amber` "앰버·골드"를 삭제하지 않고 별도 extra 테마로 유지. 시드에 `kind: base|streamer|extra` 추가.
- **하네스 드리프트 방지:** 손으로 토큰을 박던 `dev/streamer-palettes.html`을 폐기하고, `dev/gen-palettes.mjs`(tsx)가 팔레트 모듈에서 직접 생성하도록 전환. 시드만 고치면 하네스가 항상 일치한다.
- **카드 폼 보존:** 팔레트 카드가 단독 UI 카드로도 쓸 수 있어 `dev/review-card.html`로 분리 보존(`.rvw-card` + `--rvw-*` 토큰, 로즈 테마 인라인). `dev/index.html`에 ②/②-b 항목 갱신.
- **검증:** `streamerPalette.test.ts` 6/6 통과(대비 불변식·전 쌍 구분·두 블루 구분). `tsc --noEmit` 0 오류. 8종 전부 흰 라벨 4.5~5.0:1 헤드리스 렌더 확인. 생성기 로그 기준 accent 대비: 로즈4.53·아모레또4.60·유레카4.66·세나4.54·토로리4.61·망징이4.58·바이올렛5.02·앰버4.64.
- **미결:** 다크 테마 토큰은 아직 대비 미감사(deferred). ReviewSurface 컴포넌트/`review-surface.css` 코드 인제스션 대기.

### 정정 (실측 반영) · 2026-07-25
- 사용자가 실제 브랜드아트를 제공: 교환학생 1기 포스터(그룹)와 아모레또 BAR AMORE 오버레이. 이미지에서 색을 직접 추출.
  - 그룹(기본): hue 338 / S54·V76 → **쨍한 핫핑크** (앞서 소프트 로즈 350은 오독). chroma 1.15.
  - 아모레또: hue ~348 / S31 + 300~310 언더톤 → **뮤트 와인-모브** (벽돌 브라운-레드 14는 오독). hue 344 / chroma 0.48.
- 그룹과 아모레또는 **같은 핑크 계열을 채도로만 구분**(쨍한 핫핑크 vs 톤다운 모브)하는 실제 브랜드 관계. 이를 위해 구분 규칙에 `chromaGap>=0.45`(동일 hue라도 채도차 크면 구분) 분기를 추가.
- `dev/review-card.html` 인라인 기본 토큰도 hue 338로 갱신. 테스트 6/6·헤드리스 렌더로 재확인.
- 요청에 따라 이전 후보색 2종도 extra로 보존: `rose`(소프트 로즈 350) · `brick`(브라운 레드 14). extra는 수동 선택용 서랍이라 base/streamer 근처여도 허용 → 무충돌 보장 테스트를 `kind!=="extra"`로 한정. 총 10종.

### 팔레트 확정 (LOCK) · 2026-07-25
- 기본 교체: 핫핑크(338)는 과해서 extra `hotpink`로 보존, **기본=소프트 로즈(350)** 로 확정. extra 중복 rose 제거.
- 세나: 모자(베레모) 실측 hue~276/S21 반영. 실측 그대로는 accent가 회색처럼 힘 빠져(비교 렌더 확인), **276 / chroma 0.5(sat36) 뮤트 페리윙클**로 확정(사용자 권장안 선택). 기존 290/오키드 대비 확실히 차분·쿨.
- 최종 10종(전부 흰 라벨 ≥4.5:1):
  - base: 기본·교환학생 소프트로즈 350
  - streamer: 아모레또 344/0.48 · 유레카 152/0.95 · 세나 276/0.5 · 토로리 202/0.8 · 망징이 216/1.05
  - extra: 클래식 바이올렛 249 · 앰버 골드 40 · 핫핑크 338/1.15 · 브라운 레드 14/0.72
- 테스트 6/6·`tsc` 0오류. 임시 `dev/_sena-compare.*` 정리. 다음: ReviewSurface 컴포넌트 + review-surface.css 코드 인제스션.

### 팔레트 전역 연결 + 스트리머 자동 우선 · 2026-07-25
- 목표: 팔레트를 앱 전역 기본색에 연결하고, 소스가 특정 스트리머로 판별되면 그 색을 우선 적용.
- 발견: 전역 accent는 `styles/exclipper-app.css`의 `--ex-accent/-ink/-bg/-line`(라이트 :root, 다크 [data-theme=dark]). 활성 스트리머 신호는 이미 `App.tsx`의 `sourceCastRosterId`(소스명·채널ID→로스터 판별).
- 추가: `src/app/streamerPalette.ts`에 `accentCssVars(tokens)`(ThemeTokens→4개 --ex-accent* 맵). 새 모듈 `src/app/streamerPaletteForRoster.ts`: `paletteIdForCastRosterId`(그룹/null→default 소프트로즈, 개인채널→해당 스트리머), `activeAccentCssVars(rosterId, theme)`.
- 배선: `App.tsx` 테마 이펙트 뒤에 이펙트 추가 — `activeAccentCssVars(sourceCastRosterId, theme)`를 `documentElement`에 인라인 세팅해 전역 accent를 런타임 override. **범위 accent 전용**(neutrals 미변경, 리플 최소, 사용자 선택). CSS 정적 기본값도 바이올렛→소프트로즈로 교체(첫 페인트 플래시 방지, 바이올렛은 extra로 보존됨).
- 다크: light+dark 모두 팔레트에서 구동하되 다크 토큰은 대비 미감사(deferred) 표기.
- 검증: 신규 `streamerPaletteForRoster.test.ts` 4케이스(그룹/개인/테마별/폴백) + 팔레트 6케이스 = 10/10 통과. `npm run build`(tsc -b + vite) 통과, 기존 청크경고 외 오류 없음. `noUncheckedIndexedAccess` 대응 수정 포함.

### 검토 화면 재구축 · 코드 인제스션 1단계 · 2026-07-25
- 범위 A(검토 화면만) 확정. 기존 검토 화면은 `App.tsx` 7305–9982행(약 2,680줄 JSX).
- **교체 계획**: Delete=`rh-results-header`·`rh-passb-panel`×2·`rh-ranking-panel`(순위/퍼센트 서술은 무용 확정), Move=`rh-live-analysis-panel`(분석 단계로), Merge=`rh-timeline-*` 레일 7종+inspector → 통합 타임라인 1개, Keep=`ex-pane` 3종 내용·`rh-empty-state`·`rh-export-panel`.
- **신규 파일**:
  - `styles/review-surface.css` — 격리 `.rvw-*`. 핵심: `--rvw-*`를 앱 `--ex-*`의 **별칭**으로 정의 → App.tsx가 이미 스트리머별로 `--ex-accent*`를 덮으므로 팔레트가 추가 배선 없이 자동 적용. 레거시 위에 override를 쌓지 않는다(계약상 레거시 호환 예외 명시).
  - `src/app/ReviewSurface.tsx` — 표현 전용 컴포넌트(뷰모델 입력 + 인텐트 출력). 분석 타입을 import하지 않아 타입 변동에 영향받지 않고 픽스처로 렌더 가능.
  - `src/app/reviewSurfaceModel.ts` — 분석결과→뷰모델 어댑터(순수). Pass B 결과 누락 시 내용을 지어내지 않고 정직하게 빈 상태로 렌더.
  - `dev/live/` — 실제 컴포넌트를 픽스처로 마운트하는 라이브 하네스(vite).
- **키맵 배선**(확정본만): Q=요약/근거, Space=재생, ←/→=후보 이동, Enter=사용 토글, X=빼기 토글, [ ]=앞 구간, Shift+[ ]=끝 구간, Backspace=전체 초기화, Esc=카드 닫기→포커스 취소, ?=도움말. Alt+화살표는 브라우저 뒤로가기와 충돌하므로 쓰지 않음. 입력 요소 포커스 중에는 전역 키를 가로채지 않음.
- **상태 처리**: 후보 전환 시 재생 위치·재생 여부·카드·선택 큐를 모두 초기화(이전 클립의 낡은 상태가 현재 것처럼 보이지 않도록).
- **브라우저 검증**: 1120×760 헤드리스로 요약/근거 두 페이지 렌더 확인. 소프트 로즈 팔레트 적용, 한국어 긴 문장 줄바꿈, 인물 이니셜 폴백, 빈 데이터 후보 정상. 가장자리 프레임이 축 밖으로 나가지 않도록 `clamp()` 보정.
- **검증**: `src/app` 테스트 69/69 통과(어댑터 4케이스 신규), `npm run build` 통과.
- **남은 일**: App.tsx의 레거시 검토 섹션을 ReviewSurface 호출로 실제 교체 + 대체된 레거시 CSS 셀렉터 제거 + 4폭·10팔레트·영문 검증.

### 명세 §11 키맵 정합 + 폰트 경로 버그 · 2026-07-25
- **문제:** ReviewSurface 구현이 확정 명세(`artifacts/REVIEW_INTERACTION_SPEC_2026-07-24.md` §11)에서 7건 이탈해 있었다. 정적 하네스는 명세대로였는데 React 코드만 어긋난 상태.
- **정정 내역:**
  | 항목 | 명세 | 이전 구현 |
  |---|---|---|
  | 사용 | `A` | `Enter` |
  | 빼기 | `R` | `X` |
  | 되돌리기 | `Z`(방금 판단 1개) | 없음 |
  | 전체 리셋 | `Backspace` + **확인창 필수** | 즉시 실행(위험) |
  | 취소 | `Esc` 체인(카드→근거→도움말→포커스) | 2단계뿐 |
  | 문자키 판정 | `event.code`(IME 무관) | `event.key` + "ㅂ/ㅌ" 하드코딩 |
  | 최대 폭 | 1280 락 + 중앙 정렬 | 없음 |
- **되돌리기 구현:** 판단이 전부 `decide()` 한 경로를 지나므로 직전 값 스택 하나로 "방금 판단 1개"의 의미가 정확히 성립. 트림은 대상 아님(명세대로).
- **확인창:** 여는 키(Backspace)와 확정 키(Enter)를 분리해 연타 오작동 불가. 열려 있는 동안 다른 키는 전부 차단. 실제 키 경로로 헤드리스 검증 완료.
- **레일/도크 정리:** 레일 = 되돌리기(Z) + 도움말. 도크 = 빼기 R · 재생 Space · 사용 A(주 행동이라 가장 넓음). 리셋 ⌫ 은 되돌릴 트림 옆이 아니라 떨어뜨려 배치(§11.1).
- **세로 리듬 3단계 확정:** ① 연관 맥락 3칸 사이 고정(한 흐름) ② 확인한 대사↔연관 맥락 30px 고정(한 쌍) ③ 주장↔근거↔네비만 유동. 주장 묶음(`.rvw-claim`)으로 제목과 서술이 절대 벌어지지 않게 함. 세 배치안을 실제 렌더해 비교한 뒤 A안 채택(B는 중앙에 구멍, C는 칸이 내용보다 커짐).
- **크기 하네스:** 3벌 복제돼 있던 마크업을 `dev/gen-sizes.mjs` 생성기로 통합. MIN 1000×600 / **MAX 1280×720 확정** / 1440은 상한 근거로 보존.
- **폰트 경로 버그(배포 영향):** `styles/exclipper-foundation.css` 가 `url("/fonts/...")` 절대경로를 써서 base `/exclipper/` 환경에서 404 → **GitHub Pages 에선 Pretendard 가 아예 로드되지 않고 폴백 폰트로 렌더되던 상태**. 폰트를 `styles/fonts/` 로 옮기고 상대경로로 바꿔 Vite 가 base 를 붙여 처리하도록 수정. 빌드 CSS 가 `/exclipper/assets/Pretendard-*.woff2` 로 재작성되는 것 확인. `public/fonts/` 중복 제거.
- **검증:** `tsc --noEmit` 0오류, `src/app` 테스트 69/69, `npm run build` 통과, 헤드리스 렌더로 요약/근거/확인창 확인.

### 로컬↔배포 동기화 + 0.6.0 · 2026-07-25
- **꼬여 있던 것 4가지를 정리했다.**
  1. 로컬 `feat/review-loop-0.3.46` 이 `origin/main` 대비 1앞/1뒤로 갈라져 있었고, 이번 세션 작업 28건이 전부 미커밋 상태였다.
  2. **폰트가 한 번도 커밋된 적이 없었다**(`git ls-files | grep font` = 0). 즉 배포 사이트는 지금까지 계속 폴백 폰트로 렌더돼 왔다. 스트리머 프로필 이미지도 미커밋이었다.
  3. 폰트 경로를 상대경로로 고친 뒤라, 폰트를 커밋하지 않고 푸시했으면 CI 빌드가 하드 실패했을 상태였다(이전 절대경로는 빌드 통과 + 런타임 404라 드러나지 않았다).
  4. `npm run check` 가 로컬에서 6건 실패 상태 → 푸시했으면 배포가 중단됐다.
- **CI 실패 6건 처리:** `dev/**/*.mjs` 에 node 전역 추가(`scripts/**` 와 동일), `dev/live` 는 tsconfig 밖이라 lint 제외. `ReviewSurface` 의 후보 전환 시 상태 초기화를 effect → **렌더 중 조정 패턴**으로 변경 — 린트 회피가 아니라 실제 개선이다(effect 방식은 이전 클립의 위치로 한 프레임 그린 뒤 두 번째 렌더가 연쇄된다).
- **병합:** 사전에 파일 단위로 확인한 결과 원격의 유일한 추가 커밋은 `docs/Rule` 신규 파일 1개뿐이고 로컬 작업 파일과 겹치지 않아 충돌 위험이 없었다. 되돌림용 태그 `pre-sync-2026-07-25` 를 찍고 병합 → 충돌 0건.
- **커밋 5개로 분할 후 푸시**(폰트 / 팔레트 / 검토 표면 / 하네스 / 로그). Actions 성공(1m41s).
- **배포 검증:** 배포된 CSS 가 `/exclipper/assets/Pretendard-*.woff2` 로 재작성되고 실제 폰트가 **200 (748KB)** 로 응답하는 것을 확인. 사이트에 Pretendard 가 적용된 것은 이번이 처음이다.
- **버전 정책 확정:** 커밋 단위가 아니라 **배포 단위**로 올린다(공용 규칙 §5 반영). 이번 배포 묶음을 **0.6.0** 으로 올렸다 — 자산 참조 방식이 구조적으로 바뀌었고(절대→번들러 처리) 고정 accent 가 팔레트 시스템으로 대체됐다.

### 0.6.1 배포 · 2026-07-25
- 0.6.0 이후 12개 커밋이 미배포로 쌓여 있었다. 검토 화면이 실제 앱에 연결된 변경과 팔레트 전면 재정비가 모두 포함돼 있어, 더 쌓기 전에 배포 검증을 한다.
- 포함: 새 검토 화면 통합(ReviewStage + 어댑터), 명세 대조 감사 후 이탈 24건 수정, 최악 케이스(파이프라인 상한 데이터) 결함 6건 수정, 팔레트 정제 밴드(채도 폭 53→17·명도 통일), 다크 대비 해결(accentOn 도입), 토로리 pale 톤·망징이 페리윙클 실측 반영, 버튼 글자색 전 테마 통일, 카드 재사용·focus trap·근거 항목 이동.

### 사용자 문장에서 "상위 N%" 순위 지표 제거 · 2026-07-25
- **결정:** `rankPercentile`은 내부 우선순위 계산에만 남기고, 사용자에게 보이는 문장에서는 "상위 N%" 표기를 없앤다. 이 순위는 false signal이 많고 특정 상황(자막판·장면 전환·컷)에 몰려 발생하는데, 문장에 숫자로 박히면 편집자가 이를 "근거 품질 등급"으로 읽는다. 관찰 사실은 그대로 두고 순위만 뺀다.
- **변경 파일:** `src/analysis/highlightNarrative.ts`(`eventExplanation`), `src/analysis/candidateEvidenceExplanation.ts`(`visualObservation`). 두 파일의 지역 `topPercent` 헬퍼는 유일한 호출부가 사라져 삭제했다.
- **Before/After**
  | 위치 | Before | After |
  |---|---|---|
  | narrative(강도 없음) | `… 영상 내 상위 12%의 화면 변화가 있어요.` | `… 화면 변화가 있어요.` |
  | narrative(강도 있음) | `… 장면 변화 5.00(영상 내 상위 1%)가 있어요.` | `… 화면 변화가 있어요(장면 변화 강도 5.00).` |
  | evidence | `… 감지됐어요. 변화 강도는 4.20였고, 영상 안에서는 상위 2%의 변화 신호예요. …` | `… 감지됐어요. 변화 강도는 4.20였어요. …` |
- **문장 다듬기 이유:** 순위 절만 지우면 앞 절의 연결 어미가 붕 뜬다(`…였고,` 뒤가 사라짐, `장면 변화 5.00가` 처럼 수치 뒤 조사가 어색해짐). 강도 수치는 괄호 보조 정보로 내리고 문장의 주어를 관찰 사실(`화면 변화가 있어요`)로 되돌렸다.
- **남겨 둔 것:** `sceneChangeStrength` 원시 수치는 유지했다. 순위가 빠지면서 이 숫자는 기준 축 없는 무단위 실수가 됐지만, 이번 제품 결정의 대상은 순위 지표이고 강도까지 빼면 사용자에게 남는 관찰 정보가 사라진다. 별도 판단이 필요한 항목으로 남긴다.
- **범위 밖(미변경, 확인만):** 같은 "상위 N%" 표기가 `src/App.tsx`(9878·9888행 오디오/영상 신호 칩), `src/app/candidateSignals.ts`(`topPercent` + 신호 타일), `src/exports/highlightExport.ts`(내보내기 근거 문자열)에도 남아 있다. 제품 결정을 끝까지 적용하려면 이 3곳도 같이 정리해야 한다.
- **테스트:** 문구 단언을 새 문장으로 갱신하는 대신, 되돌림 방지를 위해 `/상위\s*\d/` 부재 단언을 추가했다(narrative 시각 타이밍·시각 단독 케이스, evidence 기본·조합별 케이스). `npm run check` 전체 통과(923 tests).

### "상위 N%" 제거 마무리: 칩·신호 타일·내보내기 · 2026-07-25
- **범위:** 위 항목에서 "범위 밖"으로 남겨 둔 3곳을 같은 원칙으로 정리했다. `rankPercentile` 필드와 내부 우선순위 계산은 그대로다.
- **Before/After**
  | 위치 | Before | After |
  |---|---|---|
  | `App.tsx` 근거 칩(오디오) | `짧고 큰 오디오 반응` · `평소 음량의 3.2배` · `오디오 내 상위 3%` | `짧고 큰 오디오 반응` · `평소 음량의 3.2배` |
  | `App.tsx` 근거 칩(영상) | `화면 맥락 변화 0.72` · `영상 내 상위 12%` | `화면 맥락 변화 0.72` |
  | 신호 타일(오디오) | `오디오 반응 / 3 % / 상위` | `오디오 반응 / 3.2 배 / 평소 음량 대비` |
  | 신호 타일(영상) | `화면 변화 / 12 % / 상위` | `화면 변화 / 0.70 / 장면 변화 강도` |
  | 내보내기 근거(오디오) | `짧고 큰 오디오 반응 · 오디오 반응 상위 5% · 평소 음량의 3.2배` | `짧고 큰 오디오 반응 · 평소 음량의 3.2배` |
  | 내보내기 근거(영상) | `화면 변화 상위 1%` | `화면 변화 감지(장면 변화 강도 0.72)` |
- **신호 타일 판단:** 타일은 문장이 아니라 숫자 하나여서, 순위를 빼면 표시할 값 자체가 없어진다. 그래서 각 신호의 *관찰 수치*로 갈아탔다 — 오디오는 `rmsLiftRatio`(방송 자체 기준선 대비 배수), 영상은 `sceneChangeStrength`. 두 값이 모두 optional이므로, 값이 없는 신호는 타일을 만들지 않는다(예전에는 순위가 항상 있어서 타일도 항상 나왔다). 없는 값을 0으로 채우거나 순위로 되돌리는 것보다 타일이 없는 편이 정직하다. 신호의 존재 자체는 아래 근거 칩이 계속 알려 준다.
- **내보내기 문구 판단:** 영상 근거는 순위가 유일한 항목이라 그냥 지우면 `signalKinds`에 `화면 맥락`이 있는데 근거 줄에는 아무것도 없는 상태가 된다. `화면 변화 감지(장면 변화 강도 0.72)`로 바꿔 관찰 사실을 남기고, 강도가 없으면 `화면 변화 감지`만 쓴다. 앞 커밋의 "강도는 괄호 보조 정보" 형태를 그대로 따랐다. 내보낸 파일은 캐비어트가 따라붙지 못한 채 오래 남으므로 순위를 넣지 않는 이유가 화면보다 강하다.
- **삭제:** `src/app/candidateSignals.ts`의 `topPercent`(export, 전용 테스트 있었음)와 `src/exports/highlightExport.ts`의 지역 `topPercent`. 호출부가 전부 사라졌다. `candidateSignals` 모듈 자체는 `App.tsx`에서 아직 쓰므로 남겼다.
- **테스트:** `candidateSignals.test.ts`의 `topPercent` describe(3케이스)를 삭제하고, 타일 값 기대치를 새 수치로 바꾸고 `/상위/` 부재 단언과 "값 없는 신호는 타일을 만들지 않는다" 케이스를 추가했다. `highlightExport.test.ts`에는 markdown 근거 줄 기대치와 `/상위\s*\d/` 부재 단언 2개를 추가했다. `npm run check` 통과(930 tests, 932에서 순감 -2).
- **남겨 둔 것:** `App.tsx`의 영상 칩은 여전히 `sceneChangeStrength ?? 0`이라 강도가 없으면 `화면 맥락 변화 0.00`으로 보인다. 순위 칩이 사라지면서 이 칩이 영상의 유일한 표시가 됐으므로 `0.00`이 더 눈에 띈다. 이번 작업 범위(순위 제거) 밖이라 건드리지 않았지만, 타일 쪽은 값이 없으면 아예 만들지 않도록 바꿨으므로 두 곳의 처리가 다르다는 점은 남는다.
- **범위 밖:** `dev/review-concepts.html`, `dev/surface-harness.html`의 `상위3%`·`상위` 라벨은 빌드에 포함되지 않는 정적 디자인 시안이라 그대로 뒀다. `App.tsx:8075`의 `추천 상위 장면`과 `discoveredLeadRefinement.ts`의 `[상위 사건]`은 순위 백분위와 무관한 표현이다.

### 원시 신호 수치를 사용자 문장에서 제외 · 2026-07-25
- **결정:** 순위("상위 N%")에 이어 `sceneChangeStrength`(장면 변화 강도)도 사용자에게 보이는 모든 문자열에서 뺀다. 순위가 사라진 뒤 이 값은 기준 축이 없는 무단위 실수라, `0.72`를 본 편집자가 내릴 수 있는 판단이 없다. 그런데 숫자가 주장 옆에 붙어 있으면 그 주장이 측정된 것처럼 보인다 — 해석 불가능한 수치는 정보가 아니라 근거의 겉모습만 늘린다. 데이터 필드(`sceneChangeStrength`, `rmsLiftRatio`, `rankPercentile`)는 내부 계산·저장에 그대로 쓴다. 바뀐 것은 문자열뿐이다.
- **Before/After**
  | 위치 | Before | After |
  |---|---|---|
  | narrative `event`(강도 있음) | `… 화면 변화가 있어요(장면 변화 강도 5.00). … 화면상 사건을 찾을 단서예요.` | `… 화면 변화가 있어요. … 화면상 사건을 찾을 단서예요.` |
  | narrative `event`(강도 없음) | `… 화면 변화가 있어요. … 사건 맥락을 찾을 단서예요.` | (위와 같은 문장으로 통합) |
  | evidence 시각 관찰 | `후보 구간에서 화면 변화가 감지됐어요. 변화 강도는 4.20였어요. 화면 변화가 반응의 원인인지는 알 수 없어요.` | `후보 구간에서 화면 변화가 감지됐어요. 화면 변화가 반응의 원인인지는 알 수 없어요.` |
  | 신호 타일(영상) | `화면 변화 / 0.70 / 장면 변화 강도` | (타일을 만들지 않음) |
  | `App.tsx` 근거 칩(영상) | `화면 맥락 변화 0.72`, 값 없으면 `화면 맥락 변화 0.00` | `화면 변화 감지` |
  | 내보내기 근거(영상) | `화면 변화 감지(장면 변화 강도 0.72)` | `화면 변화 감지` |
- **분기 통합:** `eventExplanation`의 두 분기는 강도 유무로만 갈렸고 꼬리 문구도 `사건 맥락` / `화면상 사건`으로 미세하게 달랐다. 수치가 빠지면 두 문장이 같은 말을 하므로 하나로 합쳤다. 더 구체적인 `화면상 사건을 찾을 단서예요`를 남겼다.
- **`rmsLiftRatio`는 남긴다(판단):** `평소 음량의 3.2배`는 분모가 문구 안에 적혀 있다. 이 방송 자체의 기준선 대비 배수라, 다른 화면이나 사전 지식 없이도 "이 순간은 평소보다 3배쯤 컸다"로 읽힌다. 강도와 달리 값이 커질 때 무슨 뜻인지가 문구 자체에서 나온다. 이미 노출 중인 채팅 `burstRatio`(`평소의 4.2배`)와 형식이 같아서, 둘 중 하나만 빼면 규칙이 자의적으로 보인다. 또 이걸 빼면 오디오 타일까지 사라져 타일 행에 채팅 하나만 남는다. 한계는 있다 — RMS 배수는 체감 음량(dB)이 아니라 "3.2배 크게 들린다"와 정확히 같지는 않다. 하지만 방향과 대략의 크기는 맞고, *정확도가 완벽하지 않은 것*과 *읽을 수 없는 것*은 다른 문제다. 그래서 남긴다. 이 판단의 경계선은 **분모가 문구에 적혀 있는 비율만 보여 준다**이다.
- **영상 타일 제거:** 타일은 문장이 아니라 숫자 하나여서 강도를 빼면 표시할 값이 없다. 앞 커밋이 세운 원칙("값 없는 신호는 타일을 만들지 않는다")을 그대로 적용해 영상 타일을 없앴다. `CandidateSignalKind`도 `"chat" | "audio"`로 좁혀 타입 수준에서 되살아나지 못하게 했다. 신호의 존재 자체는 근거 칩이 계속 알려 준다.
- **앞 커밋 후속 항목 해결:** `App.tsx` 영상 칩의 `화면 맥락 변화 0.00`(강도 없을 때) 문제는 칩에서 수치를 없애면서 사라졌다. `sceneChangeStrength ?? 0` 폴백 자체를 지웠으므로 값 유무와 무관하게 `화면 변화 감지` 하나로 표시된다. 문구는 내보내기와 같게 맞췄다. 칩은 타일과 달리 라벨만으로도 "영상 근거가 있다"를 전하므로, 요소를 없애지 않고 라벨만 남기는 쪽을 골랐다 — 영상 단독 후보에서 근거 목록이 통째로 비어 버리는 것을 막는다.
- **남은 수치(의도적):** 사용자 문자열에 남은 숫자는 전부 (a) 분모가 적힌 배수(`rmsLiftRatio`, `burstRatio`), (b) 셀 수 있는 개수(메시지 수, 작성자 표기 수, 분석 창 수), (c) 0~100 축이 정의된 백분율(`semantic.confidence`) 중 하나다. 기준 축 없는 실수는 남아 있지 않다.
- **범위 밖(확인만):** `App.tsx:7576`의 `상대 점수 {score*100}`은 융합 점수를 0~100으로 정규화한 별개 표기라 이번 결정(원시 신호 수치)의 대상이 아니다. `styles/exclipper-surface.css`의 `.ex-signal[data-signal="visual"]` 규칙은 이제 앱에서 도달하지 않지만 `dev/surface-harness.html` 시안이 아직 쓰므로 남겼다. `candidateEvidenceExplanation.ts`만 `분석 기준의 N배`, 나머지는 `평소의 N배`로 표현이 갈리는데 기존 차이라 손대지 않았다.
- **테스트:** 문구 기대치를 새 문장으로 고치고 되돌림 방지 단언을 추가했다 — narrative는 `event`에 숫자가 아예 없음(`not.toMatch(/\d/)`)과 `/강도\s*[\d.]/` 부재, evidence·export는 `/강도/` 부재, 타일은 `kind` 목록이 `["chat","audio"]`이고 `/상위|강도|0\.70/` 부재. 영상 타일 케이스는 "강도가 있어도 타일을 만들지 않는다"로 뒤집었다. `npm run check` 통과(930 tests, 증감 없음).

### 남은 시간 표시: 18% 여유분 + 단조 감소 · 2026-07-25
- **결정 1(여유분):** 대기 화면의 "약 N분 남음"을 실제 추정보다 18% 길게 보여 준다(`REMAINING_ESTIMATE_PADDING_FACTOR = 1.18`). 예상보다 빨리 끝나는 것은 비용이 없지만, 약속을 넘기면 편집자는 느린 기기와 멈춘 실행을 구분할 수 없어 "멈춤"으로 읽는다. measured/static 두 경로 모두에 같은 계수를 적용했다 — 사용자는 라벨 하나만 보고 어느 근거인지 구분하지 못한다.
- **패딩 대상 선택(중요):** *총 소요*가 아니라 *남은 양*에 곱한다. 총 소요에 곱하면 ratio→1 에서도 `총×0.18` 의 꼬리가 영원히 남아 0으로 수렴하지 않는다. 남은 양에 곱하면 완료 시 0으로 정확히 떨어진다(테스트로 고정).
- **결정 2(단조 감소):** 표시값은 절대 늘어나지 않는다. `clampToMonotonic(previousShownMs, nextEstimateMs)` 순수 함수로 구현했다. 추정이 오르면 이전 값을 유지(머묾)하고, 실제가 그 아래로 내려오면 따라 내려간다. "4분 → 6분" 반등은 값이 멈춰 있는 것보다 나쁘다 — 라벨이 추측이라는 사실을 드러내고, 여유분의 목적(약속을 이기는 실행) 자체를 무효로 만든다.
- **상태 소유권:** 모듈은 상태를 갖지 않고 호출자(App)가 이전 표시값을 보관한다. 새 실행은 `null`을 넘기는 것만으로 초기화된다. `analysisBusy` 가 꺼질 때 `shownRemainingMs` 를 null 로 되돌려, 다음 실행이 이전 실행의 바닥값을 물려받지 않게 했다.
- **App 연결(렌더 중 조정):** effect 로 보정하면 오른 값이 한 프레임 그려진 뒤 정정된다 — 여기서 신뢰를 깨는 것이 정확히 그 위쪽 깜빡임이다. 그래서 렌더 중 조정 패턴(ReviewSurface 와 동일)을 썼다. `clampToMonotonic` 은 멱등이라(두 번 적용해도 같은 값) 재렌더가 한 번 더 돌고 수렴한다.
- **공개 시그니처:** `estimateRemainingMs`, `formatRemainingLabel`, `estimateAnalysisDurationRangeMs` 의 시그니처는 그대로 두고 `clampToMonotonic` 만 추가했다. 계획 범위 함수(`estimateAnalysisDurationRangeMs`)는 캘리브레이션된 원본이라 패딩하지 않는다 — 패딩은 표시 단계에서만 붙는다.
- **테스트 9건 추가:** 패딩 적용(measured/static 양쪽), 완료 시 0 수렴, 첫 표시, 상승 시 유지, 하강 시 추종, 요동치는 추정 시퀀스 전체에서 비상승, 0 고정, 멱등성, 비유한 입력 방어. `npm run check` 전체 통과(932 tests).
- **알아 둘 것:** `roundToMinutes` 는 하한이 1분이라 남은 값이 0이어도 라벨은 "약 1분 남음"이다(기존 의도된 동작, 이번 변경과 무관).

### Candidate Pass B verification receipt exact source-range fence · 2026-07-29

- **문제:** 기존 verification receipt `1.1.0`은 canonical context fingerprint만 묶었다. candidate ID가 같아도 시작·끝 경계가 바뀐 경우, 저장된 유료 insight와 thumbnail이 새 구간의 결과인 것처럼 durability/final projection을 통과할 수 있었다.
- **결정:** current receipt를 `1.2.0`으로 올리고 `candidateId`, `sourceStartMs`, `sourceEndMs`, `routingModelRevision`, `contextFingerprint`를 하나의 exact fence로 저장한다. 발급 함수는 네 relative frame timestamp가 해당 source range 안에 있고 thumbnail이 그 네 장 중 하나이며 routing revision이 현재 revision일 때만 receipt를 만든다.
- **복구:** `1.0.0 | 1.1.0`과 과거 routing revision의 `1.2.0`은 이미 결제한 insight를 잃지 않도록 저장 계층에서 계속 읽는다. 다만 source range 전체를 증명하지 못하거나 현재 routing revision과 다르므로 `candidatePassBReceiptMatchesContext`와 final publication은 항상 거부하고 해당 candidate만 다시 분석 대상으로 남긴다.
- **저장 무결성:** current receipt 안의 `candidateId`가 `verificationReceiptById` map key와 다르면 record 자체를 거부한다. durability readback과 analysis outstanding 판정도 현재 `sourceFenceByCandidateId`가 없거나 한 필드라도 다르면 fail-closed한다.
- **검증:** exact context parity, candidate ID/start/end/routing mismatch, legacy receipt, 이전 routing receipt, range 밖 frame, source fence 누락, 저장 map-key mismatch, durability 재실행을 포함한 관련 6개 파일 81개 테스트, 전체 TypeScript typecheck와 대상 ESLint가 통과했다. `App.tsx`는 별도 통합 작업자에게 정확한 4th argument와 `sourceFenceByCandidateId` 연결 지점을 전달했으며 이 작업에서는 수정하지 않았다.

### 전사 체크포인트 단조 복구와 안전한 자동 재개 · 2026-07-29

- **현재 스키마 전용:** 출시 전 코드이므로 과거 체크포인트 변환이나 호환 분기를 추가하지 않았다. 현재 ASR 계획·영수증·근거 체크포인트가 정확히 일치하지 않으면 병합하지 않고 새 분석 경로가 다시 생성한다.
- **부분 복구:** 결과가 불명확한 **유료 직접 요청** 셀만 편집자의 명시적 재시도 전까지 다시 결제하지 않는다. 무료 R2 ASR의 동일 상태는 결제 위험이 없으므로 새 세대에서 자동 복구한다. 유료 셀이 보류되어도 같은 계획의 `pending`·디코드 실패·전사 실패·속도 제한 셀은 막지 않고 즉시 이어서 처리한다. 200셀 중 190셀이 불명확하고 10셀이 아직 미요청인 충돌 사례에서 유료는 10개만, 무료는 200개 모두 재개되는 계약을 순수 선택 테스트로 고정했다.
- **세대별 자동 재개:** 디코드 실패·전사 실패·속도 제한은 최대 3회짜리 한 묶음이 끝난 뒤 체크포인트를 먼저 저장하고, 재사용되지 않는 새 요청 세대로 자동 이어 간다. 경로 변경은 같은 호출에서 낡은 경로를 반복하지 않고 다음 호출에서 갱신된 경로로 해당 셀만 한 번 재개한다.
- **단조 병합:** 메인 전사와 보강 전사 모두 셀 단위로 CAS 재기반한다. 이미 성공하거나 무발화로 확정된 셀은 오래된 `in-flight`·실패 셀로 되돌아가지 않으며, 실패 셀끼리는 더 큰 시도 횟수와 더 안전한 결제 상태가 우선한다. 서로 다른 탭이 독립적으로 완료한 셀은 하나의 완결 체크포인트로 합쳐진다.
- **직렬화 계약 수정:** 런타임 전사 셀의 `kind`가 영속 계획에 섞여 저장기는 쓰지만 파서는 읽지 못하던 자기 불일치를 제거했다. 영속 셀은 현재 스키마의 `{chunkId, sourceStartMs, sourceEndMs}`만 기록한다.
- **검증:** 관련 7개 파일의 46개 테스트, 전체 TypeScript typecheck, production build가 통과했다. 빌드의 기존 대형 청크 경고 외 오류는 없다.
### 입력·분석 앞단 A안 구현 + B안 디자인 라이브러리 보존 · 2026-08-02

- **채택:** 태블릿 모양을 흉내 내는 장치 프레임이 아니라, 한 bounded surface가
  Empty → Inspecting → Ready → Running/Recoverable로 바뀌는 A안을 실제 App 앞단에
  연결했다. 입력·진행·복구가 아래로 누적되지 않고 같은 자리에서 교체된다.
- **데이터 진실성:** source identity, 대사·챕터, 전체 맥락을 독립 lane으로
  투영했다. transcript-ready를 context-ready로 표시하지 않으며, 최종 publication 전에는
  후보 수·후보 위치·내부 점수를 `FrontSurface`에 전달하지 않는다.
- **완료/복구:** publication 완료 증명이 `verified-empty`인 경우만 정상 후보 0개로
  표시한다. `completedWithGaps`, 대사 조각 누락, 후보 상세 누락, 맥락 누락은 진행 중으로
  위장하지 않고 마지막 durable checkpoint에서 해당 작업만 다시 시작한다. 원본 재검사는
  같은 `File`을 유지한 채 preflight만 다시 실행한다.
- **UI:** source ribbon, 단일 진행축, 전체 방송 주제 timeline, 현재 범위·등장인물
  inspector, 자료 연결/이력/detail sheet를 `.frt-*`로 격리했다. 1024px에서는 inspector를
  timeline 아래 3열로 내려 timeline 폭을 지키고, 680px 아래에서는 한 열과 bottom sheet로
  전환한다. timeline은 읽을 수 있는 시간 간격과 30분 보조 격자, 충돌 회피 lane을 쓴다.
- **접근성:** heading 직접 연결, progressbar 이름, 주제의 시작·끝 시각 포함 accessible
  name, sheet focus trap/Esc/trigger 복귀, reduced-motion/forced-colors를 유지했다.
- **B안 보존:** 고정 source dock 방식은 ExClipper의 12시간 timeline 폭과 Review handoff에
  맞지 않아 채택하지 않았지만, 실제 화면·상태표·responsive/accessibility/motion/token
  계약을 `docs/design-library/SOURCE_DOCK_ANALYSIS_DESK_PATTERN.md`에 일반화해 보존했다.
- **검증:** 전체 `npm run check` 통과(173 files, 2,119 tests + 음성 등록 도구 9 tests),
  production build 통과. 로컬 브라우저에서
  1440×900, 1024×768, 390×844, 긴 한국어 파일명, 영문 UI, 연결 sheet를 확인했고 console
  warning/error 및 수평 overflow가 없었다. 배포·커밋은 하지 않았다.

### 자막 없는 예약 VOD의 ASR 선분석·복구 경로 · 2026-08-02

- **실패 원인:** 예약 동기화가 한국어 YouTube JSON3 자막만 허용해 자막이 없는 VOD는
  `KOREAN_CAPTION_NOT_FOUND` 영구 재시도에 머물렀다. 따라서 업로드를 미리 발견해도
  `transcript-ready` 이후의 전체 맥락과 검토 후보를 만들 수 없었다.
- **무료 fallback:** 자막이 없거나 비어 있으면 GitHub Actions가 오디오를 90초 PCM16 WAV
  범위로 만들고 원문 SHA-256과 함께 전용 Worker의 R2 stage에 스트리밍한다. Worker는 큰
  본문을 읽거나 해시하지 않고 R2 native checksum과 44-byte WAV header만 확인한다. 이후
  작은 media ticket을 resolve해 Groq Whisper에 서명된 R2 URL을 전달하므로 무료 Worker의
  CPU 제한과 provider secret 노출을 동시에 피한다.
- **체크포인트·재개:** 성공한 범위는 catalog 내부 숨김 체크포인트에 원자적으로 저장한다.
  다음 cron은 완성된 범위를 재다운로드·재전사하지 않고 누락된 범위부터 이어 간다. 모든
  범위가 합쳐진 transcript bundle과 catalog pointer가 기록된 뒤에만 체크포인트를 지운다.
- **실제 대사 시각:** checkpoint v2와 terminal은 Groq segment의 상대 시작·끝 시각과
  bounded no-speech/log-probability를 보존한다. 90초 본문을 글자 길이로 균등 배치하지
  않고 실제 segment 시각에 source 시작을 더해 caption event를 만든다.
- **무발화:** `[대사 없음]`과 두 신뢰 지표가 모두 확실한 segment만 대화 event에서
  제외한다. 애매하면 발화를 보존한다. 전 구간이 무발화여도 range checkpoint는 완결되고
  `events=[]`와 `[대사 없음]` 완전 coverage chapter로 transcript-ready를 정상 게시한다.
- **정확한 종료 순서:** Worker terminal 결과는 Durable Object에 먼저 저장하고 그 다음 R2
  media를 지운다. 삭제 중 예외가 나도 성공 결과가 사라지지 않고, 재요청은 media 없이도
  terminal cache를 그대로 재생한다.
- **검증:** 자막 우선 경로, 자막 없는 영상의 ASR fallback, 중간 실패 후 범위 재개, 완성
  체크포인트 재사용, R2 stage에서 request body 미버퍼링, Groq URL multipart, terminal 저장
  후 media 삭제와 cache replay를 회귀 테스트로 고정했다.
