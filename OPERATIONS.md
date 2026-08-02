# ExClipper 개인용 운영·배포·복구 계획

## 2026-08-02 YouTube 업로드 → 즉시 검토용 `review-ready`

예약 실행의 성공 목표는 더 이상 `transcript-ready`나 `context-ready`가 아니다.
편집자가 같은 YouTube URL을 넣었을 때 긴 분석 없이 검토 화면이 열리려면 catalog 영상이
`review-ready`이고 다음 closure가 모두 맞아야 한다.

1. 한국어 자막·연속 챕터·전체 방송 맥락의 immutable context artifact
2. 전체 오디오 1초 특징의 완전 coverage
3. 최대 12개 후보마다 30~60초 WAV와 서로 다른 JPEG 4장
4. 후보별 화면·오디오·대사·전체 맥락 AI 해석과 실제 model receipt
5. participant grounding, 대표 thumbnail, 최종 후보 집합 또는 `verified-empty`
6. 4MiB 이하 review artifact의 전체 SHA와 내부 content digest readback

workflow는 30분마다 `scripts/channel-preanalysis-upload-preflight.mjs`로 Atom RSS를
catalog에 먼저 병합한다. 신규·due retry·context/review 누락이 있을 때만 WARP와 yt-dlp를
준비한 뒤 기존 feed/context 준비와 `scripts/sync-channel-preanalysis-reviews.mjs`를 호출한다.
수동 dispatch는 preflight 결과와 관계없이 항상 이 heavy 경로를 검증한다. 영상 사본은 runner temp에만 두고
게시 여부와 무관하게 삭제한다. 후보별 checkpoint는
`<source>/.review-checkpoints/<video>.review.vN.checkpoint.json`에 남아 다음 run이 완료
후보를 재사용한다. `actions/upload-artifact`의 `include-hidden-files: true`를 제거하면 이
복구 파일이 publish job으로 전달되지 않으므로 유지해야 한다.

검토용 480p 사본의 yt-dlp 다운로드는 일반·fragment·extractor·file-access 오류를 각각
최대 3회 재시도한다. 봇 차단은 `YOUTUBE_BOTWALL`로 분류하며 URL·authorization·cookie·key·token을
제거한 500자 이하 진단만 일회성 run report에 기록한다. 영구 catalog retry에는 오류 코드와 마지막
성공 stage만 남겨 공개 저장소에 upstream 진단이나 credential이 들어가지 않게 한다.

후보 하나는 최대 60초 16kHz mono PCM16 WAV 약 1.92MB와 JPEG 4장을 bounded binary
bundle로 묶어 private R2에 streaming stage한다. Worker JavaScript는 이 본문을 Base64로
디코드하거나 전체 버퍼로 해시하지 않는다. 짧은 resolve JSON만 별도로 보내며, 전용
4회/분 limiter가 429를 내면 `Retry-After` 뒤 재개한다. 아직 유효한 media ticket은
재사용하고 만료되면 새 ticket과 resolve body를 발급하되, media SHA·후보 범위·화면
시각·canonical context로 만든 semantic operation ID는 바꾸지 않는다. Durable terminal
replay가 같은 후보의 중복 provider 호출과 호출 누락이 최종 후보 0개로 바뀌는 일을 막는다.

예약 전체 맥락도 같은 무료 4회/분 한도를 넘기지 않는다. 한 영상은 Qwen 3.7 Plus
`overview` 1회와 방송 전체 챕터를 정확히 한 번씩 덮는 Qwen 3.6 Flash `discovery`
3분할을 동시에 시작한다. `analysisMode`는 request body·SHA-256 digest·Durable Object
operation namespace·expected model receipt에 모두 포함한다. 다음 영상이나 upstream
backoff 때문에 429가 발생하면 runner는 `Retry-After`를 기다린 뒤 동일 body와 동일
operation ID를 재생하며, 성공한 terminal은 다시 결제하지 않는다.

기본 `free-tier-recovery` 정책은 무료 한도에서 복구를 우선해 중복 과금 가능성이 표시된
provider checkpoint도 같은 operation ID로 재개한다. 유료 전환 시에는
`--context-retry-policy strict-paid` 또는
`CHANNEL_PREANALYSIS_CONTEXT_PROVIDER_RETRY_POLICY=strict-paid`를 사용하면 해당 위험이
표시된 요청만 자동 재호출하지 않는다. 아직 provider에 도달하지 않은 안전한 in-progress와
backoff polling은 계속한다. 성공한 각 context component 영수증에는 실제 Worker attempt와
retry-risk가 함께 저장되며, 이 필드가 없던 기존 영수증도 계속 읽을 수 있다.

후보 상세 분석은 JPEG 4장과 WAV가 모두 준비된 뒤에만 시작한다. `attemptOrdinal`은
최초 0에서 최대 2까지 올라가며, 형식·영수증처럼 캐시된 잘못된 terminal을 반복할 수 있는
오류만 새 semantic operation으로 승격한다. 409·429·5xx 전송 복구는 같은 operation을
유지한다. 다음 attempt를 호출하기 전에 retry grant와 이전 완전한 근거를 체크포인트에
원자적으로 기록해야 한다. 최대 복구 뒤에도 판정이 모호하면 해당 후보를 버리지 말고
`editor-review`로 발행한다. 후보를 최종 제외하려면 화면·오디오·전체 맥락이 일치하는
명시적 부정 판정이 있어야 한다.

활성화에는 전용 Worker의 `PREANALYSIS_CONTEXT_TOKEN`·`PREANALYSIS_QWEN_API_KEY`·
`PREANALYSIS_GROQ_API_KEY`와
GitHub Actions의 `CHANNEL_PREANALYSIS_CONTEXT_PROXY_URL`·
`CHANNEL_PREANALYSIS_CONTEXT_TOKEN`이 필요하다. provider key는 Actions나 브라우저에
  두지 않는다. 두 Actions secret 중 하나라도 없으면 `review-ready` 자동화가 준비되지 않은
  것이므로 workflow를 명시적으로 실패시킨다. secret 없는 실행을 정상 완료로 표시하지 않는다.

## 2026-07-30 예약 카탈로그 ingress: WARP 경유로 실제 작동 확인

배포와 branch seed가 끝났고, 예약 카탈로그는 실제로 자막을 만든다. 다만 그 전에
YouTube가 GitHub 러너의 주소를 거부하는 문제를 통과해야 했다.

### 측정한 사실

- 러너 자신의 주소로는 고정 yt-dlp가 `Sign in to confirm you're not a bot`을
  받는다. 순수한 주소 거부이며 바이너리 노후가 아니다 — 같은 고정 버전과 같은
  인자가 편집자 네트워크에서 exit 0으로 성공한다.
- 같은 러너에서 Atom feed와 storyboard 이미지 host는 직접 정상 응답한다.
  거부되는 것은 yt-dlp가 쓰는 player/watch 경로뿐이다.
- **WARP egress는 YouTube가 받아 준다.** 러너에서 `warp=off` → `warp=on` 전환 후
  같은 명령이 612,342 bytes의 metadata와 한국어 자동 자막을 반환했다. Workers
  egress 측정에서 끌어낸 "데이터센터는 전부 막힌다"는 일반화는 틀렸다 — WARP
  소비자 대역과 Workers egress 대역은 다르다.
- 실제 예약 실행에서 `Xns8EY3gae0`이 `transcript-ready`로 진전했다. 자막
  1,595 event 중 1,364개가 한국어이고 챕터 52개가 전체 6,177초를 정확히 덮으며,
  manifest 선언 digest·byte length가 raw 경로의 실제 bytes와 일치한다. 시각 지문도
  같은 실행에서 만들어졌다.

### WARP 무료 사용 한도와 다른 프로젝트와의 공유 범위

결론부터: **공유되는 청구 한도나 좌석은 없다.** 공유되는 것은 YouTube가 보는
Cloudflare WARP 출구의 평판이며, 그것은 한도가 아니라 상관 장애 위험이다.

- **계정이 없다.** `warp-cli registration new`는 무계정·무료 소비자 등록이며 기기
  단위로 독립적이다. Cloudflare 계정이나 Zero Trust 조직에 연결하지 않으므로
  좌석(무료 50석) 소비도, 대시보드에 잡히는 사용량도 없다. 다른 프로젝트의
  등록과 우리 등록은 서로를 모른다. 따라서 **고갈될 공유 자원이 없다.**
- **연결 대상이 다르다.** `rekasong`의 Oracle VPS는 영속 등록 하나를 유지하고,
  이 저장소의 CI는 실행마다 ephemeral 러너에서 새로 등록한다. 같은 등록을 나눠
  쓰지 않는다.
- **실측 부하(이 프로젝트):** 30분 cron의 기본 동작은 다섯 Atom feed와 catalog만
  확인하며 WARP를 등록하지 않는다. 신규·retry·review 누락이 확인된 heavy run만 최대
  2개 영상을 처리한다. 영상당 WARP를 지나는 metadata와 JSON3 자막은 약 2MB이며,
  backlog가 소진되면 신규 업로드가 없는 30분 run의 WARP 트래픽은 0이다. storyboard와
  Atom feed도 tunnel을 지나지 않는다.
- **`rekasong`과의 관계:** 그쪽 WARP 트래픽은 곡 준비 요청이 있을 때만 발생하고
  (`JOB_INTERVAL` 8초), 폴링과 SSH는 원래 IP를 쓴다. 수요 기반이라 순간 부하는
  이쪽보다 클 수 있으나, 두 부하가 합산되는 계량기는 존재하지 않는다.
- **진짜 공유 위험은 상관 장애다.** YouTube가 WARP 대역을 조이면 두 프로젝트가
  동시에 막힌다. 한쪽의 실패가 다른 쪽 원인 파악을 흐릴 수 있으므로, 증상이
  보이면 두 프로젝트를 각각 확인한다. 이쪽 신호는 `retryable(metadata)` 증가와
  deferral 진단의 봇월 문구다.
- **이쪽 고유의 취약점:** heavy run은 ephemeral 러너마다 새로 등록한다. 신규 영상이
  없는 lightweight run에는 등록이 없다. 영속 등록 하나를 쓰는 VPS보다 데이터센터 IP발 반복 등록이 제한될
  가능성이 높다. 그 경우 WARP step이 `warp=on`을 얻지 못하고 fail-closed하므로
  막힌 주소로 조용히 되돌아가지 않고 즉시 드러난다. 등록을 영속화하려면 등록
  키를 CI secret으로 보관해야 하는데, 그 비용이 현재 이득보다 크다고 보아 하지
  않는다.
- **한도 초과로 과금될 경로가 없다.** WARP 무료에는 유료 전환 트리거가 없다.
  유료가 되는 시나리오는 WARP가 막혀 레지덴셜 proxy로 옮기는 경우뿐이며, 그때는
  `ALL_PROXY` 하나만 바꾸면 되고 GB당 과금이므로 위 트래픽 수치가 그대로 비용
  추정치가 된다(하루 2MB 수준이면 월 몇 센트).

### 운영 경계

- yt-dlp만 tunnel을 통과한다. Atom feed는 직접 성공하고 Node는 proxy 환경변수를
  읽지 않으므로 tunnel의 영향 범위는 거부된 경로에 한정된다. `ALL_PROXY`는 기존
  child 환경 allowlist로 전달되며 credential이 포함된 proxy URL은 spawn 전에
  거부된다. 즉 이 경로는 코드 변경 없이 환경만으로 작동한다.
- WARP step은 무엇에도 의존시키기 전에 SOCKS5 포트로 `warp=on`을 먼저 증명하고,
  실패하면 막힌 주소로 조용히 되돌아가지 않고 fail-closed한다. 이후의 거부를
  "tunnel이 아예 뜨지 않은 것"과 혼동하지 않기 위한 경계다.
- **취약점:** YouTube가 나중에 WARP 대역을 조일 수 있다. 그때 증상은 다시
  `retryable(metadata)`의 증가로 나타난다. deferral 로그가 이제 redact된 진단
  메시지를 함께 출력하므로 봇월 거부와 네트워크 오류를 구분할 수 있다. 실패율이
  올라가면 다음 수단은 레지덴셜 proxy이며, `ALL_PROXY` 하나만 바꾸면 되도록
  구조는 이미 준비돼 있다.
- WARP 등록은 무료·무계정이고 실행마다 새로 등록된다. 소비자 VPN을 무인 CI에서
  쓰는 것이므로 정책 변경에 노출된다는 점은 감수하는 리스크로 명시한다.
- **전용 context Worker 배포는 계속 보류한다.** 이제 transcript는 쌓이지만
  `context-ready` 승격은 별도 provider 예산과 과금 판단이 필요하다.

## 2026-08-02 다섯 YouTube source 선분석 운영 경계

- configured source와 playlist는 다음으로 고정한다.
  - `amoretto-vods`: `@AmorettoVODs`, `UCHycoTBFDhXz4XNz8jBP-_A`, `UULFHycoTBFDhXz4XNz8jBP-_A`
  - `eureka-history`: `@eureka_history`, `UCiFzBB8xsUjEBq8_h6Yl6tA`, `UULFiFzBB8xsUjEBq8_h6Yl6tA`
  - `sena-replay`: `@SENAREPLAY`, `UCk0Mu5MpVzJ056e65XpAj0Q`, `UULFk0Mu5MpVzJ056e65XpAj0Q`
  - `coco-replay`: `@kokotorori`, `UCgq07mhOmrjVeZeJYXiAClw`, `UULVgq07mhOmrjVeZeJYXiAClw`
  - `mangjing-compilations`: `@망징-b1t`, `UC_hftLL-ydsJd1YpcBZ_09g`, `UULF_hftLL-ydsJd1YpcBZ_09g`
- 2026-08-02 실제 playlist Atom feed 검증에서 다섯 endpoint가 모두 HTTP 200,
  canonical channel ID, 최근 14~15개 entry로 strict parser를 통과했다. Atom은
  증분 발견 창이며 전체 과거 영상 backfill 목록으로 해석하지 않는다.
- 코코는 일반 uploads에 Shorts·커버가 섞이므로 live-stream playlist만 읽고 public
  완료 영상의 `not_live | was_live`를 허용한다. 다른 네 source는 `not_live`만
  허용한다. 망징이는 합본 업로드이므로 전체 파일 exact 일치만 연결하고 합본 내부
  구간 정렬은 구현 전까지 로컬 분석으로 fallback한다.
- Pages 브라우저에서 feed를 직접 polling하지 않는다. CORS가 없고 탭 종료 뒤
  실행도 보장되지 않는다. 예약 GitHub Actions는 매시 17·47분에 lightweight
  preflight를 실행하고, 실제 due 작업이 있을 때만 bounded heavy 경로를 연다. 처리 상한
  2개는 source마다가 아니라 다섯 source를 합친 heavy run 전체 상한이다. 수동 실행은
  preflight가 no-work여도 항상 heavy 경로를 점검한다.
- public repository의 표준 GitHub-hosted runner는 현재 무료지만 schedule은 지연
  또는 누락될 수 있고 60일 repository activity가 없으면 비활성화될 수 있다.
  따라서 실행 누락은 영상 terminal 실패가 아니며 다음 feed reconciliation에서
  다시 발견한다.
- `yt-dlp`는 workflow에서 고정 release와 SHA-256을 검증한 실행 파일만 사용한다.
  공개 한국어 수동 자막(`ko`)을 우선하고 없으면 자동 자막을 JSON3로 받는다. 출처는
  `.ko` 파일명으로 추측하지 않고 같은 호출의 `subtitles`/`automatic_captions`
  metadata로 확정한다. YouTube 자막 시계가 원본 끝을 넘으면 재생 가능한 마지막 cue만
  원본 끝으로 줄이고 원본 밖에서 시작한 cue만 제외한 뒤 digest를 만든다. 저장 bundle의
  strict validator는 그대로 유지한다. 둘 다 없거나 일시 차단되면 해당 영상만
  `retryable`로 남긴다.
  Atom body는 `Content-Length` 유무와 관계없이 512KiB에서 streaming 중단하고,
  JSON3 임시 파일은 regular file·32MiB 상한을 통과한 뒤 bounded stream으로 읽는다.
- workflow의 `prepare` job은 `contents: read`, 모든 checkout의
  `persist-credentials: false`, `npm ci --ignore-scripts`로 실행한다. 검증된 catalog
  snapshot만 1일 artifact로 넘기며, `publish` job만 `contents: write`를 받고
  Node·npm·`yt-dlp`를 전혀 실행하지 않는다. write token은 마지막 고정 `git push`
  step의 환경에만 존재한다.
- `prepare`의 application source는 움직이는 branch 이름이 아니라 workflow
  event의 immutable `github.sha`를 checkout한다. `schedule`과
  `workflow_dispatch`가 runner를 기다리는 사이 `main`이 갱신되어도 실행 source가
  바뀌지 않는다.
- pinned `yt-dlp` child에는 PATH·HOME·temp·locale, credential 없는 proxy,
  CA bundle처럼 실행에 필요한 값만 allowlist로 전달한다. 예약 context token,
  provider key, GitHub token과 그 밖의 step secret은 전달하지 않는다. proxy URL에
  credential이 들어 있거나 allowlist 값이 개행·크기 제한을 어기면 직접 연결로
  조용히 우회하지 않고 spawn 전에 실패한다.
- `publish`는 `prepare`가 읽은 `preanalysis-catalog` base SHA와 현재 branch HEAD가
  같을 때만 snapshot을 반영한다. 중간에 다른 writer가 branch를 바꾸면 덮어쓰지
  않고 실패하며 다음 run이 최신 base에서 다시 준비한다.
- 매 예약 실행은 selection 전에 ready video의 모든 referenced artifact를 실제
  regular file로 다시 열어 manifest byte length, 32MiB 상한, 전체 SHA-256을
  확인한다. canonical transcript는 UTF-8/schema/transcript digest/video identity와
  provenance까지 확인한다. 누락·손상·다른 영상 bundle이면 ready pointer와 관련
  artifact를 제거하고 `retryable(transcript)`의 즉시 due checkpoint로 내려 같은
  run에서 재생성을 시도한다.
- 자막과 선택적 context가 확정된 뒤 시각 지문은 독립된 후행 lane에서 만든다.
  YouTube storyboard의 host·sheet 수·총 bytes를 제한하고 방송 전반에 분산된
  12개 화면을 `32×18` luma 기반 dHash/blockHash·밝기·edge artifact로 만든다.
  지문 실패나 동일 길이 변조는 지문 파일/pointer만 격리하며 확정된 transcript와
  context는 그대로 둔다. 지문 없는 기존 영상은 fresh 영상보다 낮은 우선순위로
  backfill하므로 storyboard의 장기 장애가 채널 자막 준비를 막지 않는다.
- catalog branch에는 공개 metadata, 정규화 자막/챕터, 파생 지문·맥락과 digest만
  저장한다. AI key, quota lease, 로컬 파일명·원본 bytes, 채팅 원문, 사용자
  IndexedDB 자료는 넣지 않는다.
- 예약 분석은 대화형 최대 5인 quota의 여섯 번째 편집자로 경쟁하지 않는다.
  `review-ready` 자동화에는 foreground와 분리된 전용 인증 proxy와 provider secret이
  필수다. URL/token이 없으면 no-work cron도 성공으로 가장하지 않고 구성 오류로 실패한다.
- 배포 전에는 live feed parser, food-talk JSON3 준비, manifest/bundle hash
  readback, 시각 지문 artifact closure, raw catalog CORS, exact ID 매칭,
  이름이 완전히 바뀐 duration cohort의 유일 화면 합의, ambiguous 합의의 비자동
  연결, catalog 부재 시 기존 ASR fallback을 검증한다.
- 로컬 업로드는 명시 ID/등록 파일 지문이 없으면 먼저 duration-compatible 후보를
  최대 12개로 제한한다. 단일 probable 후보는 12-anchor와 ±30초 offset을 bounded
  탐색하고, 이름 없는 cohort는 모든 후보가 요구하는 source 시각의 합집합을 한
  decode pass로 준비한다. 최소 8개·67%·앞/중간/뒤 coverage·거리 상한을 통과한
  후보가 정확히 하나일 때만 `visual-fingerprint-consensus` exact binding을
  등록한다. 일부 원격 artifact fetch 실패나 둘 이상의 합격은 기존 로컬 분석으로
  안전하게 내려간다.
- 실제 음식 토크 로컬 원본과 YouTube storyboard 대조는 12/12 anchor, 세 구간
  coverage, offset 0, median distance 4.5, p90 10으로 합격했다. 같은 길이로
  강제한 다른 방송 `EZfCGS5ms_Q`는 0/12로 거부됐다. 이 실측은 현재 기준의
  회귀 fixture이며 특정 음식 장면의 의미를 학습한 규칙은 아니다.
- 공개 한국어 수동/자동 자막이 둘 다 없는 VOD는 예약 runner가 64kbps 이하 오디오를
  우선 다운로드하고 90초 단위 16kHz mono PCM16 WAV로 추출해 선분석한다. yt-dlp의
  일반·fragment·extractor·file-access 재시도는 각각 3회로 제한한다. 모두 실패하면
  redaction된 하위 원인 코드와 기존 checkpoint를 보존해 다음 실행이 같은 stage부터
  이어 간다. raw WAV는 전용 Worker JavaScript가 읽거나
  해시하지 않고 private R2에 stream upload되며, R2 native SHA-256과 44-byte header
  range만 검증한 뒤 signed capability URL을 Groq Whisper Large V3 Turbo에 전달한다.
  성공한 각 구간은 `<catalog>/.transcript-checkpoints/<videoId>.asr.v2.json`에 즉시
  atomic write/readback하고 다음 cron은 누락 구간만 이어서 처리한다. 오디오 원문과
  provider credential은 checkpoint·Actions artifact·브라우저에 저장하지 않는다.
  checkpoint v2는 Groq의 검증된 segment 상대 시작·끝 시각과 제한된
  `no_speech_prob`·`avg_logprob`도 보존한다. 최종 자막 event는 이 실제 시각에
  source range 시작을 더해 만든다. `[대사 없음]`과 두 지표가 함께 확실한
  no-speech segment는 coverage에는 남기되 대화 event에는 넣지 않고, 지표가
  애매하면 발화를 버리지 않는다. 전 구간이 무발화여도 `events=[]`와 완전한
  no-speech chapter coverage로 정상적인 transcript-ready 결과를 만든다.
- `preanalysis-catalog` branch와 예약 workflow의 최초 활성화는 repository에
  지속적인 외부 쓰기를 만든다. 코드 검증 보고와 명시적 배포 승인 뒤 branch를
  seed하고 workflow를 활성화한다. branch는 자동 생성하지 않으며 최초 commit은
  branch root의 다섯 source `catalog.json`과 각 manifest가 참조하는
  `<source-id>/videos/*.json`만 가진 orphan snapshot으로 만든다. branch가
  없으면 workflow는 쓰기 전에 명시적으로 실패한다.

### 예약 context Worker의 무료 한도 (2026-07-30 확인)

Cloudflare 공식 문서로 확인한 값이며 기억에 의존하지 않았다.

- Durable Object는 Workers 무료 플랜에서 **SQLite 스토리지 백엔드만** 사용할 수
  있다. `wrangler.preanalysis-context.jsonc`는 이미
  `"storage": "sqlite"`로 선언돼 있어 요건을 만족한다. key-value 백엔드는 유료
  전용이므로 이 설정을 바꾸면 무료 범위를 벗어난다.
- 무료 한도: 요청 100,000/일, 실행 13,000 GB-s/일, SQLite 행 읽기 500만/일,
  행 쓰기 100,000/일, 저장 5GB.
- 30분 preflight는 Worker를 호출하지 않는다. Worker 요청은 실제 due heavy run에서만
  발생하며, run당 영상은 최대 2개다. 따라서 cron 횟수를 Worker 요청 수로 환산하지 말고
  실제 선택 영상·ASR 범위·후보 수를 run report에서 확인한다.
- 한도를 넘기면 **과금이 아니라 해당 유형의 작업이 오류로 실패한다.** 즉
  Cloudflare 쪽에서 예기치 않은 청구가 발생하는 경로는 없다. 일 한도는 UTC
  00:00에 초기화된다.
- **실제 비용은 Cloudflare가 아니라 provider(Qwen)에서 발생한다.** 이것이 이
  단계를 여는 유일한 유료 결정이며, 전용 key와 예산은 작업자가 직접 준비해야
  한다.
- dry-run은 통과 상태다(154.81 KiB / gzip 33.88 KiB, Durable Object·rate
  limiter·환경변수 바인딩 정상).

### 예약 context opt-in 차단점

background 전용 context proxy의 source와 독립 Worker 설정은
`src/cloudflare/preanalysisContextProxy.worker.ts`와
`wrangler.preanalysis-context.jsonc`에 준비되어 있지만 아직 배포·secret 설정은
하지 않았다. 기존
`https://rettohighlight-gemini.11qaws.workers.dev/v1/broadcast-context`는 대화형
5인 quota lease를 요구하며 아래 Bearer·멱등 계약을 구현하지 않으므로 예약 작업에
사용할 수 없다. runner도 이 host를 설정값으로 받으면 provider 호출 전에
`INVALID_ARGUMENT`로 거부한다.

전용 Worker는 operation마다 Durable Object를 하나 사용한다. 정확히 같은
operation ID와 payload digest의 **검증된 200 성공만** terminal cache로 보존하며,
설정·rate-limit·provider·schema·transport 실패는 마지막 transcript checkpoint를
유지한 `retryable(context)`다. provider 응답이 사라진 극히 좁은 구간에는 외부
provider와 Durable Object를 하나의 원자적 transaction으로 묶을 수 없으므로 다음
예약 실행이 같은 operation을 다시 시도할 수 있다. 이 경우 응답 receipt에
`possible-duplicate-provider-charge`를 남기며, 불완전한 결과를 성공으로 가장하는
대신 최종 성공을 우선한다.

전용 Worker를 배포할 때 다음 Worker secret을 대화형 Worker와 별도로 등록한다.

- `PREANALYSIS_CONTEXT_TOKEN`: 예약 runner 전용 opaque Bearer token
- `PREANALYSIS_QWEN_API_KEY`: 예약 맥락 분석 전용 provider key
- `PREANALYSIS_GROQ_API_KEY`: 자막 없는 VOD의 예약 ASR 전용 provider key
- 선택 `PREANALYSIS_QWEN_WORKSPACE_ID`: 전경 편집 요청과 upstream quota까지
  분리하려면 별도 Qwen project/workspace를 지정한다.

그 뒤 repository secret 두 개를 **함께** 설정해야 한다.

- `CHANNEL_PREANALYSIS_CONTEXT_PROXY_URL`: HTTPS
  `/v1/broadcast-context` 전용 endpoint
- `CHANNEL_PREANALYSIS_CONTEXT_TOKEN`: 로그 출력과 쉘 히스토리에 직접
  적지 않는 opaque Bearer token

예약 workflow에서는 하나라도 없으면 prepare 시작 전에 실패한다. 이 workflow의 완료
목표는 전사 저장이 아니라 `review-ready`이므로 둘 다 없는 자막 전용 성공 모드는 두지
않는다. 전용 proxy는 다음 계약을 구현한다.

- `Authorization: Bearer ...`를 timing-safe 방식으로 검증하고 허용되지 않은
  caller를 provider 실행 전에 거부한다.
- `X-ExClipper-Preanalysis-Operation`과
  `X-ExClipper-Preanalysis-Payload-Digest`를 함께 검증한다. 같은 operation과
  digest의 terminal 성공은 저장·readback해 다음 cron에 같은 결과를 돌려주며,
  operation 재사용과 다른 digest 조합은 거부한다.
- 현행 `/v1/broadcast-context`의 bounded request와 normalized response schema를
  그대로 지키되 대화형 participant 수·lease·분당 60회 lane과 독립된 예산 및
  rate limit을 사용한다.
- 요청 결과가 transport에서 불명확하면 runner는 같은 run에서 재호출하지 않는다.
  v1 transcript pointer와 `retryable(context)`를 보존하고 다음 cron이 같은 stable
  operation ID로 proxy의 terminal 결과를 조회한다.

`context-ready`가 되더라도 이 예약 결과는 YouTube 자막 또는 예약 ASR 전사만 본
선분석이다.
`contextProvenance.evidenceScope`는
자막이면 `youtube-caption-transcript-only`, 예약 ASR이면
`scheduled-asr-transcript-only`이고 `localVisualVerificationRequired`는 `true`여야
한다. 같은 provenance의 bounded `contextReceipt`는 성공 응답에서 exact 검증한
proxy `contractVersion`, `routingRevision`, 실제 `modelId`, `modelRevision`을
빠짐없이 보존하고 routing 불일치는 artifact closure에서 거부한다. 이 receipt도
로컬 화면·오디오·등장인물·후보 상세 검증을 대신하지 않는다. 로컬 파일이
trusted video identity와 호환 시간축을 모두 통과하면 이 결과는 전체 방송
overview·주제·의미 lead의 seed로만 들어간다. 현재 로컬 후보와 현재 인물 grounding을
사용한 selection jury는 반드시 다시 실행되고, 후보 화면 4장·오디오·대표 썸네일
receipt는 이후 Candidate Pass B에서 별도로 완성한다.

최초 활성화는 다음 순서로 사용한다. 실제 secret 값은 shell history·문서·Git에
남기지 않는다. `-CheckOnly`는 인증과 로컬 선행 조건만 검사한다. 실제 실행은
Groq·Qwen key를 보안 입력으로 받은 뒤 접근 권한을 현재 Windows 사용자로 제한한
임시 파일을 사용해 Worker 코드와 네 필수 secret을 한 번에 배포한다. 이어서 같은
bearer token과 전용 endpoint를 GitHub Actions secret으로 등록하고, AI 비용이 들지
않는 HTTP 412 인증 probe까지 확인한다. 임시 파일은 성공·실패와 관계없이 삭제한다.

```powershell
powershell -NoProfile -File scripts/activate-channel-preanalysis.ps1 -CheckOnly
powershell -NoProfile -File scripts/activate-channel-preanalysis.ps1
powershell -NoProfile -File scripts/activate-channel-preanalysis.ps1 -UseSavedCredentials
```

`-UseSavedCredentials`는 `%LOCALAPPDATA%\ExClipper\activation`에 현재 Windows
사용자의 DPAPI로 암호화해 둔 `groq.dpapi`·`qwen.dpapi`를 사용한다. Worker 배포,
GitHub secret 등록, 인증 probe가 모두 성공한 경우에만 두 암호문을 삭제한다.

활성화 뒤에는 `main`을 배포하고 `channel-preanalysis.yml`을 영상 한 건으로 수동
실행해 Qwen·Groq·R2·Durable Object·`review-ready` 게시를 실제로 검증한다. secret
이름이 존재한다는 사실만으로 provider key의 유효성까지 검증됐다고 보지 않는다.

### 최초 branch seed 배포 차단점

원격 branch가 이미 아모레또 namespace만 가진 상태라면 orphan branch를 다시 만들거나
기존 artifact를 지우지 않는다. 같은 commit의 workflow는 실행 시작 시 누락된 네
namespace를 `public/preanalysis/<source-id>`의 검증된 빈 fallback snapshot으로 먼저
채운다. 따라서 첫 수동 실행은 `source=all`로 수행하고, feed 하나가 실패하더라도 빈
checkpoint와 건강한 source 결과가 branch에 보존되는지 확인한다. 이 경우 workflow는
보존·게시 뒤 `partial`로 red 상태를 내므로 실패 source만 다시 실행할 수 있다. 단일
source 수동 실행도 root-level run report를 생성하므로 마지막 quality gate가 보고서
누락으로 실패하지 않는다.

원격 `preanalysis-catalog` branch가 없다면 workflow 파일을
main에 넣는 것만으로 예약 갱신이 켜진 것으로 간주하면 안 된다. 승인 뒤 **빈 임시
clone 안에서만** 다음과 같이 현재 검증된 Pages fallback snapshot을 seed한다.

```bash
git clone --no-checkout https://github.com/11qaws/exclipper.git exclipper-catalog-seed
cd exclipper-catalog-seed
git switch --orphan preanalysis-catalog
git rm -rf --ignore-unmatch .
for namespace in \
  amoretto-vods \
  eureka-history \
  sena-replay \
  coco-replay \
  mangjing-compilations; do
  mkdir -p "${namespace}"
  cp -R "../exclipper/public/preanalysis/${namespace}/." "${namespace}/"
done
git add -- \
  amoretto-vods \
  eureka-history \
  sena-replay \
  coco-replay \
  mangjing-compilations
git commit -m "chore(catalog): seed channel preanalysis"
git push origin HEAD:refs/heads/preanalysis-catalog
```

`../exclipper`는 같은 commit을 검증한 source checkout이어야 한다. push 전
`catalog.json`의 모든 artifact byte length·전체 SHA·bundle identity를 runner의
closure test로 다시 확인한다. seed 뒤 workflow를 수동으로 한 번 실행해
`prepare`와 `publish`가 모두 성공하고 raw branch의 CORS/내용이 정상인지 확인한
뒤 schedule을 운영 상태로 본다.

## 2026-07-29 `0.9.0` current-only 배포 계약

- 정식 배포 전에는 rolling 호환 경로를 운영하지 않는다. 새 분석 유입을 멈춘 뒤 **Worker 배포 → plain `/healthz`의 service 6·transport 3과 OPTIONS 확인 → 같은 commit의 Pages 배포 → 새 분석 재개** 순서로 교체한다.
- plain `/healthz` 하나만 현재 provider·model·transport·fallback manifest를 반환한다. 모든 전사 stage·resolve·direct 요청은 이 manifest의 route fingerprint header를 필수로 보내며, 누락·형식 오류·현재 경로 불일치는 quota·R2·provider 실행 전에 각각 400 또는 409로 거부한다.
- `/healthz.providers.schemaVersion`은 모든 AI 역할을 포괄하는 provider catalog 계약이고, 전사 route fingerprint의 `providerConfigurationVersion`은 전사 라우팅 전용 계약이다. 현재 값은 각각 `1.4.0`, `1.3.0`이며 하나의 상수로 취급하지 않는다. 배포 smoke는 두 값을 별도로 검증해야 한다.
- Free R2 media는 schema 2·ticket v2만 읽고 쓴다. refinement checkpoint는 현재 v4 signature와 frozen plan이 정확히 같을 때만 열며, signature가 달라지면 과거 settlement를 이관하지 않고 새 checkpoint를 만든다. 같은 signature에서는 성공·무발화 결과를 보존하고 gap만 다시 보낸다.
- route 변경이 연속되면 자동 재개 간격은 250ms부터 지수적으로 늘어나 최대 10초에서 고정된다. 재시도 횟수 상한은 없으며 정상 또는 다른 종류의 결과가 나오면 즉시 0으로 초기화한다. 대기 중 source 변경·취소는 `AbortSignal`로 타이머까지 정리한다.
- 롤백도 새 분석 유입을 멈추고 Worker와 Pages를 같은 이전 artifact 쌍으로 교체한다. 현재 계약 밖 ticket·checkpoint를 bridge하지 않으므로 교체 전에 진행 중 분석을 명시적으로 종료하고, 롤백 뒤 새 route와 새 checkpoint로 다시 시작한다.

## 2026-07-29 Groq Whisper 준비 경로 — 기본 Qwen 유지

- production 기본 전사 provider는 계속 `qwen`이다. `GROQ_API_KEY`가 존재한다는 이유만으로 Groq를 선택하거나 Qwen 실패를 Groq 과금으로 넘기지 않는다. Groq를 쓰려면 운영자가 Worker secret을 별도로 등록하고 `BROADCAST_TRANSCRIPT_PROVIDER=groq`를 명시해 Worker를 배포해야 한다.
- 현재 production Worker에는 `GROQ_API_KEY` secret 이름이 등록되어 있다. 값은 조회·복사하지 않으며 `wrangler secret list`의 이름과 `secret_text` 유형만 운영 확인 근거로 사용한다. 현재 `wrangler.jsonc`의 선택값은 계속 `qwen`이므로 secret 등록만으로 Groq 요청은 발생하지 않는다.
- 키는 Pages, 브라우저 저장소, Git, `wrangler.jsonc`의 평문 변수, 오류 본문에 넣지 않는다. 등록 명령은 `npx wrangler secret put GROQ_API_KEY`이며 값은 대화·운영 기록에 다시 복사하지 않는다. `/healthz.providers.groqRoutes.broadcastTranscriptConfigured`와 선택 provider의 `configured/active`만 공개한다.
- Groq 경로는 공식 `POST https://api.groq.com/openai/v1/audio/transcriptions`, 모델 `whisper-large-v3-turbo`, `language=ko`, `response_format=verbose_json`, segment timestamp, temperature 0으로 고정한다. 브라우저가 모델·언어·endpoint·credential을 정하지 않는다.
- `free-r2`에서는 Worker가 WAV를 다시 읽거나 Base64로 만들지 않는다. 짧은 private R2 capability URL만 multipart `url` 필드로 Groq에 넘긴다. 별도 `paid-direct` 전환 경로만 검증된 WAV를 multipart `file`로 전송한다. 현재 canonical 90초·16kHz·mono·PCM16 WAV 상한은 2,880,044 bytes로 Groq 무료 계정의 공식 25MB file 제한보다 작다.
- 응답은 최대 128KiB, transcript 20,000자, segment 512개로 제한한다. 한국어 언어 표식, source chunk 길이 안의 유한·정방향 segment timestamp, 한국어 본문을 모두 검증하고 빈 segment 응답은 `[대사 없음]`으로 정규화한다. 검증된 상대 timestamp와 bounded no-speech/log-probability 신호는 terminal에 보존한다. provider의 request ID, 원문 오류 메시지, credential은 브라우저에 전달하지 않는다.
- Qwen 기본 route의 bounded fallback은 계속 Gemini이며 Groq secret 때문에 달라지지 않는다. 명시적 Groq `paid-direct` route는 기존 정책상 안전하게 분류된 실패에만 Qwen으로 한 번 fallback할 수 있다. `free-r2` resolve는 staged media 계약을 보존하기 위해 provider 간 자동 fallback을 하지 않는다.
- 무료 운영에서는 기존 전사 quota gate와 최대 동시 참여자 5명 정책을 공유한다. 공식 무료 계정의 실제 rate limit은 계정별 콘솔 값과 응답 header를 smoke에서 확인해야 하며, 코드가 임의로 더 높은 처리량을 가정하지 않는다. 활성화 전 2초·30초·90초 한국어 WAV, 무발화, 401/429/5xx, R2 object cleanup, 모델 ID/revision header를 검증한다.
- 현재 Pages의 전사 캐시 revision도 선택된 서버 모델 revision과 함께 fence되어야 한다. 해당 client release가 반영되기 전에는 준비된 Groq route를 production 기본값으로 바꾸지 않는다. 키 등록과 실제 provider smoke·비용 발생은 별도 운영 승인 뒤 수행한다.

## 다음 배포 후보 · 후보 파이프라인 전환·복구 계획

- detail cohort가 0개인 정상 empty도 run·input·context·refinement와 빈 후보 순서를 고정한 plan-only checkpoint를 먼저 exact readback해야 한다. 새 계획 callback은 시작 시 잡은 immutable plan lease로만 저장하고, 늦은 이전 계획 CAS가 도착해도 최신 plan-only checkpoint로 명시적으로 rebase한다. 복구 시에는 현재 context를 끝까지 검증한 뒤에만 저장된 evidence·insight·thumbnail·receipt를 hydrate한다. 배포 smoke는 빈 계획, 늦은 구계획 쓰기, context 검증 전 artifact 비노출을 모두 포함한다.
- 전사 Worker가 일부 조각을 실패로 반환해도 성공 조각을 버리거나 전체 계획을 처음부터 다시 보내지 않는다. `decode-failed | transcription-failed | rate-limited` 조각만 한 bounded wave 안에서 1초·2초 backoff로 최대 3회 시도하고, 각 성공은 IndexedDB write/readback 뒤 다음 조각 상태에 반영한다. 안전한 gap이 남으면 새 generation의 bounded wave를 자동으로 이어가며, 다음 wave를 시작하기 전 실패 event 자체도 정확한 범위·reason·quota ordinal로 readback되어야 한다.
- provider 요청 전에는 해당 wave의 모든 대상 범위를 `in-flight`로 먼저 durable commit한다. 탭 종료 뒤 `in-flight` 또는 `outcome-unknown`이 보이면 먼저 동일 operation의 exact reconciliation만 수행한다. 미확정 operation을 terminal로 readback한 뒤 무료 route는 다음 durable generation을 자동으로 열고, 유료 route만 명시적 복구 동의를 기다린다. operation namespace는 uniform/event-boost/refinement를 분리한다.
- 자동 복구가 끝나기 전에는 진행 패널을 전체 맥락으로 넘기지 않는다. bounded wave 뒤 안전한 실패 조각이 남으면 성공 chapter와 정확한 source range·reason·attempt count를 보존하고 다음 generation에서 이어 간다. 결과 불명처럼 자동 재청구할 수 없는 조각만 명시적 복구 대기 상태로 남기며, 그동안 whole-context API, 의미 후보 탐색, 후보 상세 API는 시작하지 않는다.
- `outcome-unknown`은 네트워크 단절 뒤 provider 실행 여부를 모르는 상태다. 클라이언트는 exact lease 요청을 한 번 transport replay한다. 무료 route는 확인되지 않은 이전 operation을 durable terminal로 고정한 다음 새 generation을 자동으로 열고, 유료 route는 UI의 명시적 재시도만 새 generation을 연다. 어느 경우에도 R2 media와 확보된 chapter는 버리지 않는다.
- whole-context/refinement 원장 `3.0.0`은 새로고침 시 해당 unit을 먼저 `reconciling`으로 exact readback하고 같은 `operationId + inputDigest`만 1회 조회/replay한다. terminal result가 없고 비전송도 증명되지 않으면 먼저 기존 unit을 `outcome-unknown` terminal로 exact readback한다. 무료 route는 그 뒤 자동 replacement generation을 열고, 유료 route는 `reconcile-current-operation`과 편집자 승인을 기다린다. 새 generation은 `in-flight | reconciling`에서 열 수 없다.
- 운영 smoke는 조각 A·B·C 중 B만 첫 시도에 실패시키고 두 번째 Worker가 B만 받는지, A·C의 quota operation과 저장 chapter가 재생성되지 않는지, 최종 exact readback 전에는 context 호출이 0건인지 확인한다. uniform 실패 ID와 event-boost ID가 달라야 하고, 3회를 넘겨 회복하는 안전 gap, 결과 불명과 안전 pending이 섞인 190/200 복구, 역순 CAS에서도 성공 셀이 퇴행하지 않는 경우를 함께 검증한다.
- 배포 전 regression은 최소 세 계약을 고정한다. 17개 ledger 입력은 context 17개를 모두 보존하고 detail 12개가 완성되면 pipeline gap 없이 끝나야 한다. detail 후보 하나가 실패해도 나머지는 저장·공개돼야 한다. 완전 검증 뒤 0개인 입력은 `completedEmpty`로 끝나야 한다.
- Worker `/healthz`는 `candidateTransport.version`, `mode`, `configured`, required frame count 4와 staged schema를 보고한다. 일시적인 503은 Pages에 영구 cache하지 않고, 성공한 transport 판단도 60초 뒤 갱신한다.
- 후보 media stage는 private `TRANSCRIPT_MEDIA` bucket의 `transcript/candidate/` prefix를 사용한다. public R2 access는 열지 않는다. 정상 실행 후 object 0개를 확인하고, 실패 smoke에서는 capability 만료 뒤 GET 404와 1일 lifecycle 범위를 확인한다.
- 배포 순서는 새 분석 유입 중지 → Worker → plain health/OPTIONS/R2 candidate smoke → 같은 commit의 Pages → 새 분석 재개다. current-only 계약이므로 서로 다른 릴리스의 Worker와 Pages를 섞어 운영하지 않는다.
- Free R2 candidate smoke는 실제 후보 WAV와 서로 다른 JPEG 4장을 사용해 stage 202, resolve 200, Qwen model identity, 한국어 event/reaction/context 결과와 object cleanup을 확인한다. byte-counting transform 뒤에는 반드시 `FixedLengthStream(expectedByteLength)`을 두어 R2에 known length를 보존한다. 같은 media payload의 재시도는 object를 재사용하고 재전송 body pump를 abort/cancel해 제한 시간 안에 202를 반환해야 한다. ticket이 만료돼 새 capability가 발급되어도 semantic operation ID가 유지되고 terminal replay가 provider를 다시 호출하지 않는지 확인한다. candidate manifest가 달라지면 기존 object를 보존한 채 provider 호출 전에 거부돼야 한다.
- 합법적인 최대 candidate context도 provider 호출 전에 48KiB canonical packet으로 정리되어 Qwen shared prompt 80KiB와 최대 예약 94,180 token 안에 들어가야 한다. 필드가 줄면 `[중간 생략 / middle omitted]`과 앞·뒤가 남고, 원본 session artifact는 불변이어야 한다. Qwen·Gemini direct/proxy·quota fingerprint·verification receipt의 packet과 fingerprint가 byte-for-byte 같아야 하며, receipt의 candidate ID·source start/end·routing revision도 실제 provider 요청과 정확히 같아야 한다. 정상 입력이 크기 때문에 중단되거나 413 `TOKEN_BUDGET_TOO_LARGE`로 끝나면 배포하지 않는다. Free R2에서 Gemini fallback이 없다는 사실은 장애가 아니라 명시적 transport 제한으로 health에 유지한다.
- candidate bundle smoke는 `Content-Length`가 있는 정상·초과·미달 입력뿐 아니라 헤더 없는 정상·초과 입력도 포함한다. 헤더 없는 초과 stream은 signed exact byte length 직후 413 `PAYLOAD_TOO_LARGE`로 끊기고 R2 object가 남지 않아야 한다.
- conditional R2 put의 loser는 R2가 본문을 소비한다고 가정하지 않는다. `put() == null` 뒤 강한 일관성의 `head`로 winner metadata·checksum·signature를 재검증하고, 성공하면 `reused`, 실패하면 bounded 오류로 닫되 두 경우 모두 loser pump를 terminal abort한다. Qwen 200 응답이 candidate schema를 어기면 fresh internal quota operation으로 최대 두 번만 복구하고, 모두 실패하면 staged object를 ticket 만료까지 보존해 missing-only 재시도가 재업로드 없이 이어지게 한다.
- 복구 버튼은 pipeline gap 종류에 따라 작동한다. context 누락은 whole-context checkpoint에서, detail/receipt/frame 누락은 해당 candidate ID만 다시 실행한다. 이미 저장된 insight·receipt·thumbnail이 현재 context fingerprint와 맞으면 failed/cancelled run envelope만으로 다시 결제하지 않는다.
- candidate detail 완료 직전에는 `putCandidatePassBInsights` 뒤 같은 run ID의 `getCandidatePassBInsights`가 성공하고, 메타데이터와 evidence·insight·model·thumbnail·계획 때 고정한 canonical context packet·receipt map이 exact match해야 한다. 사건·반응·클립 가치 설명, 등장인물 상태·근거, 최종 판정, 맥락 일치 또는 프로그램성 판정이 빠진 레코드는 publication을 통과하지 않아야 한다. write/readback 실패를 주입했을 때 `deepPass`, `publication`, `completed/completedEmpty`가 커밋되면 배포하지 않는다. “검증 결과 저장 다시 시도”는 provider API가 아니라 현재 메모리 snapshot의 write/readback만 반복해야 한다.

## 2026-07-27 `0.8.6` Free R2 전사 운영 계획

- production 기본값은 `BROADCAST_TRANSCRIPT_TRANSPORT_MODE=free-r2`다. `TRANSCRIPT_MEDIA`는 private Standard R2 bucket `exclipper-transcript-media`에 연결하고 public bucket access는 열지 않는다.
- ingress는 raw `audio/wav`만 사용한다. Worker는 quota lease를 inspect한 뒤 request body를 R2에 stream put하며 `X-ExClipper-Quota-Payload-Digest`의 SHA-256을 native checksum으로 넘긴다. 전체 body를 `arrayBuffer`, `text`, Base64 또는 사용자 정의 reader로 읽는 회귀는 금지한다.
- Free 경로는 한 청크를 두 invocation으로 처리한다. 첫 POST는 R2 저장·검증 후 HTTP 202와 10분 media ticket만 반환하고, 두 번째 작은 resolve POST가 같은 quota lease를 consume해 Qwen을 시작한다. 429에서는 새 operation lease를 받되 ticket과 R2 object를 재사용하므로 WAV를 다시 올리지 않는다.
- upload는 사용자별 `broadcast-transcript-upload` 60회/분 키만 사용하고 provider resolve만 기존 사용자별·전역 `qwen-omni-media` 60회/분을 사용한다. 두 요청을 같은 전역 키에 세어 실제 Qwen 처리량을 30회/분으로 줄이지 않는다.
- object put 뒤 returned size와 source duration의 canonical WAV byte count를 대조하고 R2 range read로 처음 44바이트만 검증한다. 하나라도 다르면 provider gate를 consume하지 않고 object 삭제와 upload lease release를 수행한다.
- Qwen provider가 media URL을 읽는 capability는 임의 object ID와 짧은 metadata expiry를 함께 요구한다. `GET | HEAD` 이외 method, 잘못된 ID, 만료 object, non-WAV metadata는 공개하지 않는다. response는 `no-store`, 정확한 `Content-Length`, `Accept-Ranges`를 사용한다.
- 정상·명시 실패 terminal에는 object를 즉시 삭제한다. 마지막 안전망은 `transcript/` prefix 1일 lifecycle이며 lifecycle 삭제가 최대 24시간 늦을 수 있으므로 capability expiry가 실제 접근 만료를 담당한다.
- 배포 전 확인 순서는 ① private bucket·1일 lifecycle ② Worker R2 binding과 `free-r2` 변수 ③ `/healthz`의 transport ready/mode/90초 ④ 2초 raw WAV ⑤ 90초 raw WAV ⑥ 음식 토크 전체 2회다. tail에서 upload, provider control, media GET을 구분하고 어느 invocation도 지속적으로 Free 10ms를 넘지 않는지 확인한다.
- 유료 전환은 Cloudflare 요금제 변경 뒤 Worker 변수만 `paid-direct`로 바꾸고 재배포한다. R2 binding과 cleanup 코드는 그대로 두어 롤백할 수 있게 하며, client/Pages를 먼저 바꾸지 않는다.
- R2 무료 경계는 월 10GB-month, Class A 100만, Class B 1,000만이고 delete는 무료다. Worker 무료 경계는 일 100,000 요청이다. 12시간을 90초 단위로 전부 훑는 보수적 상한 480청크를 5명이 동시에 실행해도 약 2,400 put, 수만 회 미만의 R2 read/head, 약 1만 회 안팎의 Worker 요청으로 무료 한도보다 충분히 작다. 실제 기본 표본 계획은 이보다 작다. 운영 지표가 80%에 도달하면 새 분석 시작 전에 경고하며 자동으로 비용이 나는 storage class나 Workers Paid로 전환하지 않는다.

## 역사 기록 · 2026-07-27 `0.8.5` 전사 CPU 초과 완화와 미해결 운영 gate

- 2026-07-27 18:13:55~18:17:29 KST 운영 tail에서 `/v1/broadcast-transcript` 15건 중 6건이 HTTP 503, `outcome=exceededCpu`, `Worker exceeded CPU time limit`로 종료됐다. 요청은 모두 약 1,280,121 bytes였고 quota는 모두 200이었다. 브라우저의 CORS 오류는 Cloudflare가 대신 만든 503에 CORS 헤더가 없어서 생긴 2차 증상이다.
- 당시 기본 ingress는 Base64-only 전용 media type이었다. Worker는 약 1.28MB envelope의 UTF-8 decode·`JSON.parse`, Base64 중복 grouped regex, provider용 대형 `JSON.stringify`를 제거하고 검증된 원본 Base64 bytes를 서버 고정 JSON prefix/suffix 사이에 넣었다.
- 당시 직접 Base64 ingress는 30초를 초과하면 본문을 읽거나 quota를 consume하기 전에 400으로 거부했다. 이 Base64·JSON 경로는 현재 제거됐으며 운영 smoke나 롤백 대상으로 사용하지 않는다.
- 당시 배포는 protocol 4 Worker와 Pages `0.8.5`를 순서대로 교체하고 직접 Base64 30초를 smoke했다. 현재 배포는 문서 맨 위의 `0.8.9` raw WAV 단일 계약을 따른다.
- 당시 롤백은 JSON/raw 호환 경로를 유지해야 했지만 현재는 해당 bridge를 운영하지 않는다. 현재 롤백은 새 분석 유입을 중지한 뒤 Worker와 Pages를 같은 artifact 쌍으로 교체한다.
- 완료 기준은 CORS 메시지가 잠시 사라지는 것이 아니라 전체 계획에서 `exceededCpu=0`, gap 0, quota 409/429 비정상 연쇄 0, provider body byte identity 유지다. 실제 tail p95/p99가 Free CPU를 계속 넘으면 동시성 숫자를 더 낮추는 것으로 숨기지 않고 Workers Paid 또는 URL 기반 ASR 전환을 승인받는다.
- 후속 전체 실행 444건은 성공 438건·`exceededCpu` 6건이었고 성공 요청도 CPU p50 29ms·p95 38ms였다. 따라서 이 gate는 통과하지 못했다. provider body stream, single ingress timer, 15~20초 축소는 보조 최적화일 뿐 Free 10ms의 완료 조건으로 인정하지 않는다.
- 운영 전환 선택지는 ① 명시적 승인 뒤 Workers Paid 월 최소 $5와 90초 청크를 사용해 현재 보안·quota 계약을 유지하는 단기 경로, ② private R2 stream upload·native checksum·짧은 media capability URL·URL/Filetrans ASR로 큰 본문을 Worker JavaScript에서 제거하는 Free 장기 경로다. 새 비용이나 bucket을 승인 없이 만들지 않는다.
- 어느 경로든 최종 release gate는 연속 전체 계획 2회 또는 600건 이상, `exceededCpu=0`, CORS 없는 정상 오류 envelope, transcript gap 0, terminal quota 연쇄 오류 0이다.

## 2026-07-27 `0.8.4` 최대 5개 독립 편집 세션

- 프로젝트·원본·후보·편집 판단은 계속 각 브라우저에만 남는다. 한 배포의 AI 공급자 용량만 신뢰된 편집자 세션 최대 5개가 공유하며, `AiQuotaCoordinator`가 participant별 FIFO와 participant 간 round-robin을 적용한다.
- `transcript`와 `candidate`는 Singapore `qwen3.5-omni-flash`의 1초 start clock, shared in-flight 6, 100k TPM과 429 backoff를 공유한다. `context`는 독립 250ms·5M TPM 앱 gate다.
- `0.8.4` 브라우저 계획기는 30초 청크와 실행별 `AdaptiveConcurrency`를 사용했다. 전용 브라우저 Web Worker가 약 0.96MB WAV를 약 1.28MB Base64 JSON으로 준비했고 Worker는 구버전 탭을 위해 최대 90초 raw WAV도 수용했다. 운영 처리량과 Worker 상한 760개는 30초 기준이다.
- `0.8.4` 배포 검증 순서는 Worker → Pages → health·Origin preflight·quota lease·30초 Base64 JSON smoke였다. `0.8.5`의 현재 순서는 위 직접 Base64 transport 절을 따른다.
- Free Worker 10ms CPU 안전성은 live smoke로 확인한다. 주 경로는 byte-to-Base64 변환을 브라우저 Web Worker로 옮겼지만, 중계에는 여전히 약 1.28MB JSON 수신·digest·파싱·검증·공급자 본문 직렬화가 남는다. 1102/CPU 초과가 재현되면 Workers Paid 또는 R2+ASR transport로 전환한다.
- 전사 브라우저 Worker는 1초 요청 슬롯을 먼저 기다린 뒤 quota lease와 POST를 시작하며 로컬 in-flight 상한은 6이다. 슬롯 대기 전에 fetch/IIFE를 만들면 실제 전송은 이미 시작되므로 배포 검토에서 호출 시점을 확인한다.
- `/v1/broadcast-context`의 502는 응답 JSON의 allowlist 오류 코드와 제한된 진단 헤더로 구분한다. non-2xx paid 응답 뒤에는 cancel하지 않으며, 이미 끝난 작업의 cancel은 200 멱등 정리, 같은 ID의 새 lease만 409다.
- `completedWithGaps` 또는 실패 조각 재시도는 성공 chapter를 유지하고 현재 sampling plan의 uncovered source range만 새 attempt ID로 보낸다. 현재 `0.8.7`의 한 조각 상한은 90초다. 맥락을 다시 만들 때는 이전 semantic candidate와 Pass B 결과를 먼저 무효화하고, 새 context 콘텐츠 지문이 일치하는 receipt만 최종 후보에 사용할 수 있다.
- 세부 request/header/body/TTL/rollback 계약은 `docs/FIVE_USER_QUOTA_COORDINATOR_2026-07-27.md`가 소유한다.

## 2026-07-23 release notes

- `0.3.44`: 1단계 빠른 탐색, 2단계 전체 맥락, 3단계 후보 종합은 하나의 현재 진행 패널과 같은 7px 진행 막대를 사용한다. 빠른 탐색은 화면·오디오 worker의 실제 완료율을 합산하고, 전체 맥락은 전사 수집 5~70%·저장 복구 76%·맥락 모델 해석 84%로 단조 진행한 뒤 단계 완료 시 다음 단계로 전환한다. 모델 내부 토큰 진행률을 가짜 백분율로 세분화하지 않는다.
- 시작 전 한국어/영어 선택은 세션 입력으로 고정되고 후보·전체 맥락 AI 요청에도 전달된다. 분석 시작 뒤에는 선택기를 잠가 한 저장 세션에 두 언어가 섞이지 않게 하며, 원문 대사는 그대로 보존한다. 한국어 서술의 비의도 한자 출력은 strict 응답 경계에서 거부되어 fallback 또는 명시적 gap으로 남는다.
- 방송 전체 서술과 진행자 프로필은 하나의 맥락 카드로 통합하되 데이터 역할은 분리한다. 전자는 시간순 사건·주제 흐름, 후자는 방송에서 반복 관찰된 진행 방식만 표시하며 같은 내용을 두 번 요약하지 않는다.
- `0.3.44`: candidate detail uses one shared frame producer and a two-consumer AI queue. A candidate enters paid multimodal analysis only after all four distinct source-fenced JPEGs are ready; an incomplete frame bundle retains its fast proposal but does not receive audio-only screen interpretation. The exact same AI bundle provides the impact thumbnail and a required participant state (`identified`, visible but unknown, none present, or insufficient visual evidence). Channel-scoped references keep 세라 교수님 exclusive to the 교환학생 main channel and never treat a channel owner prior as proof that the avatar is visible in a candidate.
- The final editor view is one bordered workspace, not three vertically separated cards. At maximized width its left source-time map and right review rail share one grid row; the right rail keeps candidate navigation, paused video, decision summary, actions, and expandable evidence contiguous. Only the evidence body scrolls internally. At narrow widths the same workflow becomes timeline → video → decision with no duplicated detail card.
- `0.3.43`: 저장 전사 map은 그대로 보존하면서 전체 맥락 transport만 144개 이하로 압축한다. 탐색 완료 셀은 즉시 클릭 가능한 근거로 공개하고, 넓은 화면은 타임라인 2/3·일시정지 검토 도크 1/3으로 나눈다. 현재 계약에서는 음악·MV·오프닝·엔딩·휴식 context 판정을 조기 삭제가 아닌 우선순위 가설로 보존하고, 편집자가 제외하지 않은 후보는 모두 네 화면·오디오 상세 검증을 거친다. 후보 대표 화면 준비와 원격 AI 해석은 모바일에서도 화면 폭과 무관한 2개 bounded pipeline으로 겹쳐 실행한다.
- `0.3.42`: source-ready 첫 화면을 같은 높이의 1:1 준비 작업대로 바꾼다. 왼쪽은 확인된 원본과 길이·형식·크기, 오른쪽은 실제 원본 범위, 분석 경로, 사용 가능한 신호, 기본 분석 시작 동작을 담당한다. 별도 검사 영수증과 화면 아래에 떨어져 있던 CTA는 준비 완료 상태에서 제거한다.
- 분석 전 source ruler는 30분 경계를 모두 유지하고 긴 방송에서는 라벨만 줄인다. 이 ruler는 원본 길이의 presentation projection이며 후보·주제·점수를 미리 확정하지 않는다. 기존 source check, persistence schema, Candidate Ledger, Worker 계약과 유료 AI 경로는 변경하지 않는다.
- blocked source 결과는 더 이상 `AI 분석 준비 완료`라고 표시하지 않는다. 진행 중 취소 버튼은 사라지는 준비 CTA에서 실제 progress panel로 옮겨, 분석이 시작된 뒤에도 접근 가능하게 유지한다.
- 배포 전 maximized desktop에서 두 pane의 높이·폭, 첫 viewport 안의 시작 버튼, 음식 토크 02:15:14 원본의 30분 눈금과 끝 시각, 840px 이하 단일 열, 640px 이하 start/end 라벨, 강제 색상 모드 경계를 확인한다. strict TypeScript, ESLint warning 0, 전체 Vitest, production build와 Wrangler dry-run을 통과한 뒤에만 정적 Pages 배포를 승인한다.
- 로컬 release gate는 73개 파일 784개 테스트, production build, Wrangler dry-run을 통과했다. 실제 음식 토크 preflight와 2,552px·760px·620px UI 검증도 통과했으며 browser warning/error는 0개였다. 이 상태는 배포 가능한 후보지만 아직 commit·push·Pages deploy 승인을 뜻하지 않는다.

## 2026-07-22 release notes

- `0.3.41`: context transcript cells execute in a deterministic distributed/adaptive order while saved chapters remain source-ordered. Fast peaks stay as a faint score overview until context, semantic refinement, candidate detail, and topic publication settle. The final timeline uses one 30-minute ruler, meaning-stable chapter colors, selectable chapter/lead inspectors, fixed-height candidate cards, and a 1:1 equal-height review workspace.
- Broadcast-context output schema is `1.6.0` and cache fence is `1.11.0`. Overview output now budgets a 600–1,000-character broadcast narrative plus a grounded 300–500-character host-streamer editorial profile, evidence, and uncertainties. Stored `1.5.0` and older results remain readable with `hostStreamerProfile=null`; they must not be relabeled or filled with invented profile text.
- `0.3.40`: fixed the post-context blank screen reproduced in the deployed browser. Semantic refinement may legitimately push the canonical ledger above twelve; candidate review now accepts that ledger, preserves every candidate, and disables only the twelve-item ranking projection. Candidate detail execution remains bounded to twelve targets per run, and a top-level recovery view replaces a blank page for future render faults.
- The visible sequence is now fast discovery → whole-broadcast context → context-aware detail review → editor final selection. Newly appended semantic candidates wait for any active detail run and then enter a missing-only follow-up batch; an unchanged target set is not automatically billed twice.
- `0.3.39`: whole-broadcast overview and four deterministic full-coverage discovery slices start together. Qwen 3.7 Plus remains the overview/final jury and validates topic-balanced reserve leads; Qwen 3.6 Flash handles discovery and localization for leads already approved by the jury. Both refinement tiers share a six-request bounded pool. The 26-client-call ceiling and canonical Candidate Ledger are unchanged.
- The accepted multi-purpose clipping direction is `Editorial Intent Profiles`: `balanced`, `main-story`, `shorts`, and `recap` are projections over one paid evidence run, not four analysis modes. Event categories such as apology, quiet achievement, talk conflict, and strong reaction remain independent evidence labels. Profile UI/ranking is a later slice and must not trigger repeat API analysis.
- `0.3.36`: whole-context comparison accepts up to 32 grounded meaning leads. The Qwen 3.7 jury may approve up to eight independent events; topic-balanced reserves expand caption-only text localization to at most 20 internal leads, while no-caption ASR remains capped at four, new semantic proposals remain capped at 12, and each multimodal detail run keeps its 12-target bound. Canonical ledger entries are not deleted to enforce those execution budgets.
- Context routing/cache revision is `1.11.0`, topical discovery is `1.3.0`, whole-context envelope is `1.1.0`, and the scheduled jury model revision is `qwen3.7-plus-context-editorial-jury-json-complete-v2-2026-08-02`. The scheduled overview keeps Qwen 3.7 Plus thinking for whole-broadcast editorial quality, allows 135 seconds for the primary, and bounds a schema-invalid Qwen 3.6 non-thinking fallback to 30 seconds inside the 210-second client deadline. Candidate and transcript calls retain their separate 90-second ceiling. Jury-approved localization records `qwen3.6-flash-caption-refinement-json-complete-v2-2026-08-02`; reserve adjudication records `qwen3.7-plus-caption-refinement-json-complete-v2-2026-08-02`. Do not relabel an older paid result as any current revision.
- Shared role policy is `1.11.0` and budget policy is `1.2.0`. The context stage advertises at most 26 client calls and reserves `$0.08` for compressed context/refinement text. The previous Qwen 3.7-only food run cost `$0.073543` and took about 215 seconds; the rejected all-fast experiment cost `$0.069836` and took about 104 seconds but lost expected reserve events. The final hybrid food smoke cost `$0.069703` and took 114.8 seconds while preserving all three expected events.
- The context endpoint's per-client and global limits are both 30 requests per 60 seconds. Caption refinement must use the six-request bounded pool. One normal maximum run uses at most 26 context requests (overview + four topical slices + jury + twenty refinements), leaving a small guard band; provider retries and a second analysis must not be launched speculatively in the same window.
- Gameplay abstention is post-model and deterministic. It requires repeated whole-broadcast gameplay evidence plus candidate-local routine gameplay or generic banter, so a closing next-stream game announcement does not contaminate a food broadcast. Exact accountability, rare achievement, serious bug, consequential responsibility dispute, and long payoff exceptions remain reviewable.
- Live release smoke contracts: food must reject all three opening fast candidates and retain 칼국수·껍데기·두바이 초콜릿 through caption refinement; subscription must retain the mistake/apology/responsibility/compensation chain; Minecraft relay must return zero refinement IDs. The `0.3.39` food run completed 19/19 refinement calls with no transport failure: six jury-approved localizations used Qwen 3.6, thirteen topic-balanced reserves used Qwen 3.7, and 32 grounded refined moments were returned before canonical deduplication.
- `0.3.35`: production transcript transport is limited to the live-proven 90-second Qwen Omni envelope. The 12-hour fragmented plan admits at most 240 requests while keeping the same `$0.42` duration budget. Each successful cell is checkpointed immediately; reload and transient failure recovery subtract already-covered source ranges and request only missing ranges, including compatible 210-second cells saved by `0.3.34`.
- Candidate frame capture opens at most two browser decoders at once, while the existing two-request AI pool remains parallel. A missing frame is a recoverable preparation gap; the current contract never starts the provider or promotes an audio-only projection without four complete source-fenced frames.
- Candidate perception may send only the fixed `chzzk-video-13996057-v1` roster ID, and only for a filename carrying replay `13996057` or the reviewed `교환학생/합격생/장학생` title. The Worker expands six reviewed public VTuber-avatar descriptions server-side. `provided-cast-reference` requires two distinct same-frame traits and confidence `>= 0.88`; arbitrary roster text, unrelated sources, unknown names, low-confidence matches, and voice resemblance fail closed. Identity remains display-only evidence.
- Routing policy is `1.8.0`; candidate route is `qwen3.5-omni-flash_then_gemini-3.6-flash_bounded-cast-v4`. Rollback readers retain the preceding Qwen/Gemini revisions and v2/v3 route manifests without relabeling paid results.
- `0.3.34`: candidate audio+frame fallback and opt-in Gemini transcript routing use GA `gemini-3.6-flash`; production remains Qwen-primary. Routing policy is `1.7.0`, while the broadcast-context cache fence intentionally remains `1.6.0`.
- Before enabling Gemini as primary, refresh the `GEMINI_API_KEY` Worker Secret and require a real candidate request to return model ID `gemini-3.6-flash`, revision `gemini-3.6-flash-grounded-frames-cast-v4-2026-07-22`, and a grounded food-talk description. A binding name in `wrangler secret list` is not sufficient readiness evidence.
- Rollback and recovery must continue accepting the exact Gemini 3.5 model/revision pair and v2 route manifest. Never rewrite a recovered paid result to the 3.6 identity or invalidate Qwen whole-context results for this candidate-only change.
- Candidate fallback matrix: `timeout | unavailable | rate-limited | auth | model-unavailable | response-format | invalid-response` may switch provider once; `invalid-argument | rejected` must fail without a second paid request. Long-audio transcription remains single-provider because timeout billing is ambiguous at broadcast scale.
- Compressed-context tier matrix: `timeout | unavailable | rate-limited | model-unavailable | response-format | invalid-response` may switch once between Qwen 3.7 and 3.6; `auth | invalid-argument | rejected` must stop because the credential or shared contract will fail on the alternate tier too.
- A successful switch exposes `X-ExClipper-Fallback-Reason`. If both providers fail, expose only the bounded primary/fallback failure classes. Never expose upstream body text, keys, endpoint credentials, audio, frames, or transcript in diagnostics.
- Context `reject` is an AI priority hypothesis, not deletion or a detail-queue exclusion. Release smoke must confirm the canonical candidate count and editor review/boundary state remain stable, every non-editor-rejected candidate enters a missing-only detail batch, and only an exact multimodal receipt can confirm program material or no distinct event.

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
- Candidate frame sampling waits for decoded data on temporarily attached, invisible media elements and limits the capture pool to two decoders. If four distinct frames cannot be prepared, the request is not sent; the candidate remains at a recoverable frame-preparation gap and no provider-authored screen, game, participant, or causal claim is accepted.
- Historical `0.3.31` contract only: broadcast transcript preflight reported the exact violated invariant, and the 02:15:14.817 food-talk source used a 91-chunk plan under the then-current 90-second transport. This is not the `0.8.5` operating plan; new runs use the 30-second direct Base64 path and 271 chunks.
- Timeline release smoke at a maximized width must verify 30-minute ticks, numbered/staggered candidates, topic bands, semantic-lead markers, the score landscape, and a wider independently scrolling evidence pane.

- Desktop-first workspace: verify the source summary and the primary analysis action are visible in the first viewport at a maximized browser width. At widths below 840px the columns collapse to one column.
- Phase contract: fast-pass completion may automatically start AI Pass B. A cancelled or failed Pass B must leave the fast candidates usable.
- Candidate event kinds now include `dialogue-issue-signal`. It is a conservative speech-change lead and must be described as a lead, never as a confirmed event.
- Cost display is advisory. Recalculate when candidate count or duration changes; do not use it as a billing guarantee.
- 파일명 끝의 `[YouTubeID]`가 일치하면 저장소와 credential에 접근할 수 없는 opaque sandbox iframe이 편집자 네트워크에서 공개 Android 플레이어와 한국어 timedtext를 우선 확인한다. 부모는 video ID·한국어 track·8MiB JSON3·event schema를 다시 검증한다. 격리 경로의 일시 실패는 Worker를 한 번 더 거치고, Cloudflare egress가 403/429로 막히거나 자막이 없으면 오류를 사용자 작업으로 넘기지 않고 예산 제한 Qwen 전사로 폴백한다.
- Pass B evidence and AI insight snapshots are stored by analysis run in a dedicated IndexedDB object store. Recovery filters them to the recovered candidate IDs, and a new run epoch prevents late writes from an older source contaminating the current result.
- Fixed non-vocal program-edge bursts (opening, ending, and break loops) are rejected by default. An edge segment can still survive when it has a distinctive vocal/dialogue anchor, while the central UI presents the automatic phase and candidate list without promotional copy.

- 문서 버전: `0.3.44`
- 기준일: 2026-07-23 (Asia/Seoul)
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
- 현재 스키마의 로컬 백업·가져오기와 exact readback
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
7. IndexedDB current schema·실패 주입·exact readback test
8. Worker protocol, stale event, 중복·역순 event test
9. AI golden vector와 작은 품질 회귀 fixture
10. production build와 artifact hash 생성
11. GitHub Pages 저장소 하위 경로에서 Playwright E2E
12. 키보드·스크린리더·axe·forced colors·확대 접근성 검사
13. Pages artifact와 Worker route manifest가 같은 current release인지 검사
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
2. 변경으로 영향을 받는 저장 형식과 Worker protocol을 확인한다.
3. `0.9.0`에는 DB migration이 없다. 현재 schema 밖 기록은 복원하지 않고 새 분석 대상으로 남기는지 검사한다.
4. Pages의 실제 `/<repo>/` base에서 preview artifact를 검사한다.
5. Worker dry-run, unit test, Origin·schema·size·timeout·rate-limit 계약을 검사한다.
6. `buildId`, commit SHA, artifact SHA-256, model manifest hash, Worker deployment ID, migration 범위를 release record에 남긴다.

### 7.2 배포

- `wrangler deploy --config wrangler.jsonc`로 검증된 정밀 분석 Worker를 먼저 배포한다.
- 필수 secret `GEMINI_API_KEY`, `QWEN_API_KEY`, `TRANSCRIPT_MEDIA_SIGNING_KEY`는 `wrangler secret put <NAME> --config wrangler.jsonc`로 설정하고 명령 출력·로그·파일에 값을 남기지 않는다. 선택형 Groq 경로를 활성화할 때만 `GROQ_API_KEY`를 사용한다.
- Worker `/healthz`와 production Origin preflight가 통과한 뒤 GitHub Actions가 검증된 Pages artifact를 배포한다.
- 배포 중 DB migration은 없다. 현재 schema 밖 브라우저 기록은 새 분석 대상으로 남는다.
- 앱은 작업 중인 탭을 자동 새로고침하지 않는다.
- model manifest는 immutable version URL과 hash를 사용한다. 이미 시작한 run의 모델을 중간에 바꾸지 않는다.

### 7.3 배포 후 smoke test

- Pages 루트와 직접 진입 URL이 404 없이 열린다.
- CSS·font·Worker·WASM 경로가 저장소 하위 base에서 정상이다.
- source 선택과 짧은 파일 preflight가 된다.
- Worker가 시작되고 작은 signals-only 분석 fixture가 완료된다.
- 정밀 분석 Worker `/healthz`가 200이고 production Origin의 OPTIONS가 204다.
- 2초·90초 canonical raw WAV 전사 smoke가 provider raw 오류 없이 구조화 응답으로 끝난다.
- 후보 smoke는 bounded WAV와 서로 다른 JPEG 4장을 private R2에 stage한 뒤 resolve하고, terminal 뒤 object가 정리됐는지 확인한다.
- IndexedDB 새 프로젝트 저장과 새로고침 복원이 된다.
- 모델 manifest 실패 시 앱 전체가 멈추지 않고 명시적 폴백이 나온다.
- 기본 export JSON을 생성하고 다시 가져올 수 있다.
- 브라우저 개발자 도구에서 전사 raw WAV와 후보 media bundle stage → 작은 resolve 요청만 사용하고, 후보 bundle이 오디오·서로 다른 화면 4장·닫힌 roster ID·현재 route fingerprint를 정확히 포함하는지 확인한다.

## 8. 롤백과 호환성

### 8.1 코드 롤백

- 직전 정상 release의 검증된 artifact 또는 commit을 다시 배포한다.
- release record에 롤백 사유·영향 버전·복구 확인을 남긴다.
- service worker cache 이름은 app version이 아니라 build ID로 분리하고, active 작업 중 강제 cache 삭제를 하지 않는다.

### 8.2 데이터 롤백

`0.9.0`은 정식 배포 전 current-only 계약이므로 DB downgrade·구버전 import·schema
migration을 제공하지 않는다.

- 코드 롤백은 동일한 current schema를 읽는 검증된 commit 사이에서만 수행한다.
- 과거 Retto/ExClipper 개발 DB는 현재 namespace에서 열지 않는다.
- current schema와 정확히 일치하지 않는 record는 수정하거나 채워 넣지 않고 새 분석 대상으로 남긴다.
- 현재 DB 자체가 손상된 경우에는 완료된 export를 보존한 뒤 해당 current namespace를
  명시적으로 초기화하고 새 분석을 시작한다.
- 정식 배포 이후 호환 정책이 필요해질 때 별도 release에서 설계하며, 이번 파이프라인에
  미리 migration 분기를 넣지 않는다.

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
- `/v1/broadcast-context`는 원본 영상 대신 시간순 챕터와 최대 32개 후보의 제한된 근거만 받는다. Qwen overview 호출에는 `enable_thinking=true`, `thinking_budget=768`, `max_tokens=4096`, JSON 응답 형식을 고정하고 최대 90초 upstream 제한과 strict schema 검증을 적용한다.
- 유료 transcript, context, 의미 후보 재확인 결과는 각각 입력 서명과 model revision으로 저장하고 write/readback 뒤에만 재사용한다. 새로고침 때 같은 서명의 성공 결과가 있으면 호출하지 않으며, 실패·취소 결과는 성공 캐시로 승격하지 않는다.
- 12시간·후보 12개·어려운 후보 3개 기준 정책 상한은 약 `$0.997`다. 공급자 가격이 바뀌면 `analysisBudgetPolicy` 테스트와 화면 예상비를 함께 갱신하기 전에는 배포하지 않는다.
- rollback은 provider selector와 Pages/Worker model manifest를 함께 되돌린다. 과거 결과의 provider·model identity를 다른 모델로 다시 쓰거나 공급자 사이 캐시를 공유하지 않는다.

## 16. `0.3.30` 출연자 근거와 문맥 응답 복구

- 후보 지각 모델은 기존 오디오·대표 화면 요청 안에서만 출연자 이름을 추출한다. 화면 이름, 실제 호명, 또는 서버가 확장한 닫힌 출연진 기준 중 하나가 없으면 빈 목록이다. 일반적인 아바타·얼굴·목소리 유사성은 금지하며, 등록 기준도 같은 화면의 서로 다른 특징 두 가지 이상과 0.88 이상 확신이 없으면 버린다.
- 출연자 이름은 근거 종류·한국어 근거·확신도·후보 상대 시각과 함께 Candidate Pass B schema `1.2.0`에 저장한다. 이 정보는 카드 표시 전용이며 점수·선택·승인·클립 경계를 변경하지 않는다.
- 1.0/1.1 저장 결과와 구형 공급자 응답은 빈 출연자 목록으로 읽는다. 새 모델 revision 결과를 과거 결과로 가장하지 않고, 입력 서명과 revision이 달라지면 별도 실행으로 저장한다.
- 전체 문맥 응답의 의미 챕터가 잘못된 필드, 존재하지 않는 chapter ID, 겹치는 범위, coverage gap 횡단을 포함하면 엄격 호출은 실패한다. 이미 비용을 낸 복구 경로에서는 각 항목을 독립 검증해 정상이고 시간순인 항목만 남긴다.
