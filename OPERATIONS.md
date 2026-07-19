# Retto Highlight 개인용 운영·배포·복구 계획

- 문서 버전: `0.3.0`
- 기준일: 2026-07-19 (Asia/Seoul)
- 대상: GitHub Pages에서 실행되는 1인용 로컬 우선 AI 편집 어시스턴트
- 함께 읽을 문서: `PRODUCT_PLAN.md`, `STATE_LIFECYCLE.md`, `DEVELOPMENT_LOG.md`

## 1. 운영 범위와 명시적 프로젝트 예외

Retto Highlight는 공유 서비스가 아니다. 한 사람이 자신의 브라우저와 로컬 원본으로 몇 시간짜리 방송을 분석하고, AI 추천 후보를 검토해 클립·하이라이트 목록과 조건부 영상 파일을 만드는 **개인 편집 어시스턴트**다.

이번 프로젝트의 구체적인 제품 지시는 공용 지침의 일반적인 소규모 공유 서비스 기본값보다 우선한다. 따라서 다음 기능은 설계·출시 범위에서 제외한다.

- 회원가입, 로그인, 사용자 계정, 팀, 역할, 초대
- 여러 사람이 동시에 같은 프로젝트를 편집하는 기능
- 원격 프로젝트 데이터베이스와 기기간 자동 동기화
- 원본 영상·음성·채팅·후보 데이터를 받는 공용 API 또는 백엔드
- Cloudflare·Oracle 등 별도 애플리케이션 서버
- 클라우드 AI, 서버 FFmpeg, 게시 대행, 공개 갤러리
- 원격 텔레메트리와 사용자 행동 추적

단, 개인용이라는 이유로 데이터 안전·복구·배포 품질을 생략하지 않는다. 다음 항목은 반드시 제품 수준으로 설계한다.

- 두 탭 충돌 방지
- 새로고침·브라우저 종료·Worker 중단 뒤 복구
- 저장 확정 전 성공 표시 금지
- 로컬 백업·가져오기·스키마 migration
- 재현 가능한 배포·검증·롤백
- 개인정보가 제거된 로컬 진단
- 저장 공간·모델 캐시·임시 파일 상한

CHZZK 공식 실시간 채팅 수집은 필요할 때만 설치하는 **사용자 컴퓨터의 로컬 동반 수집기**로 한정한다. 공용 수집 서버는 만들지 않는다.

## 2. 배포 구조와 데이터 경계

| 구성 요소 | 위치 | 책임 | 포함하지 않는 것 |
|---|---|---|---|
| GitHub Pages 앱 | 공개 정적 사이트 | UI, Source Adapter, 분석 조정, 검토, 내보내기 | 비밀값, 사용자 DB, 영상 프록시 |
| Web Worker | 사용자의 브라우저 | 오디오·영상 feature, AI 추론, 렌더 | 장기 원격 작업 |
| IndexedDB | 현재 브라우저 프로필 | 프로젝트, 후보, 검토 판단, checkpoint, manifest | 원본 영상 전체, 완성 영상 전체 |
| Cache API | 현재 브라우저 프로필 | 검증된 앱 셸과 AI 모델 캐시 | 사용자 데이터의 유일한 백업 |
| OPFS | 현재 브라우저 프로필 | 필요한 경우에만 렌더 임시 조각 | 장기 보관 원본 |
| 사용자가 고른 폴더 | 로컬 디스크 | 프로젝트 백업, 결과표, 클립 파일 | 앱이 임의로 접근하는 다른 폴더 |
| 고정 모델 원본 | 허용된 공개 HTTPS origin | hash가 고정된 모델 파일 제공 | 영상·음성·채팅 수신 |
| 선택형 로컬 수집기 | 사용자 컴퓨터 | 권한 있는 CHZZK 라이브 채팅을 JSONL로 기록 | 공용 계정, 원격 저장, 임의 채널 수집 |

네트워크 경계를 UI에 그대로 설명한다.

- 앱·모델·플랫폼 플레이어를 받는 네트워크 요청은 있을 수 있다.
- 선택한 로컬 영상·오디오·채팅 내용은 분석을 위해 외부로 전송하지 않는다.
- YouTube·CHZZK 플레이어를 열면 해당 플랫폼과 통신한다.
- 진단 파일과 프로젝트 백업은 사용자가 직접 저장·전달할 때만 브라우저 밖으로 나간다.

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
5. `buildId`, commit SHA, artifact SHA-256, model manifest hash, migration 범위를 release record에 남긴다.

### 7.2 배포

- GitHub Actions가 검증된 artifact만 Pages에 배포한다.
- 배포 중 별도 서버나 DB migration은 없다. 브라우저별 migration은 사용자가 안전한 업데이트를 승인한 뒤 로컬에서 실행된다.
- 앱은 작업 중인 탭을 자동 새로고침하지 않는다.
- service worker는 새 버전을 `waiting`에 두고 `작업 저장 후 업데이트`를 제안한다.
- model manifest는 immutable version URL과 hash를 사용한다. 이미 시작한 run의 모델을 중간에 바꾸지 않는다.

### 7.3 배포 후 smoke test

- Pages 루트와 직접 진입 URL이 404 없이 열린다.
- CSS·font·Worker·WASM 경로가 저장소 하위 base에서 정상이다.
- 로컬 source 선택과 짧은 파일 preflight가 된다.
- Worker가 시작되고 작은 signals-only 분석 fixture가 완료된다.
- IndexedDB 새 프로젝트 저장과 새로고침 복원이 된다.
- 모델 manifest 실패 시 앱 전체가 멈추지 않고 명시적 폴백이 나온다.
- 기본 export JSON을 생성하고 다시 가져올 수 있다.
- 브라우저 개발자 도구의 네트워크 기록에 선택한 로컬 media 업로드가 없다.

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

내보내기 전 redaction을 한 번 더 실행하고 포함 항목 미리보기를 보여 준다. 사용자가 저장하지 않으면 진단은 기기 밖으로 나가지 않는다.

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

- GitHub Pages만으로 source 선택 → AI 분석 → 후보 검토 → JSON/CSV/Markdown 출력 완주
- 네트워크 기록에서 로컬 영상·음성·채팅 업로드 0건
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
- 선택형 로컬 수집기가 없어도 가져온 채팅 로그 분석이라는 핵심 기능 완주

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
