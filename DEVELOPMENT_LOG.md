# Development Log

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

- `C:\Users\Qumin\.claude\CLAUDE.md` 전체 확인
- 초심자 중심, 기본값만으로 완주, 단방향 시각 흐름
- Before/After, 리스크와 2차 파급 검토
- GitHub Pages의 CORS·라우팅·백엔드·비밀값 제약 선제 반영
- 에이전트별 작업공간 규칙에 따라 `Codex/workspace` 사용
- 사용자 승인 전 커밋하지 않음

### 저장소 상태

- `D:\Agents\rettohighlight`는 시작 시 비어 있었고 Git 저장소가 아니었음
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

- 확인한 실제 원본: `D:\Agents\StreamSaver\Opencode\workspace\index.html`
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

- `C:\Users\Qumin\.codex\AGENTS.md` 확인: 모든 작업 전 `~/.claude/CLAUDE.md`를 함께 적용하고 더 구체적인 프로젝트 지시를 우선
- `C:\Users\Qumin\.claude\CLAUDE.md` 전체 재확인
- 새 핵심 규칙은 9절 `상태와 생애주기 모델링`과 10절 `소규모 서비스 운영 완성도`
- 비교를 위해 `C:\Users\Qumin\.gemini\config\AGENTS.md`도 읽었으며 1~7절까지만 가진 이전 계열임을 확인
- 공용 지침에 따라 `C:\Users\Qumin\.claude\CLOUD_CONNECTIONS.md`의 기존 연결 패턴을 읽었으나, 이번 프로젝트는 공유·클라우드 구성을 쓰지 않기로 확정
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
