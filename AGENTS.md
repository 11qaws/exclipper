# ExClipper 프로젝트 작업 지침

## 1. 공용 지침과 우선순위

- 모든 개발 작업을 시작하기 전에 `C:\Users\Qumin\.claude\CLAUDE.md`를 끝까지 다시 읽는다.
- 이 파일은 ExClipper에만 적용되는 더 구체적인 지침이다. 공용 지침과 충돌하면 이 파일을 우선하고, 충돌하지 않는 공용 지침은 계속 적용한다.
- 구현 전에 `PRODUCT_PLAN.md`, `STATE_LIFECYCLE.md`, `OPERATIONS.md`, `DEVELOPMENT_LOG.md`의 현재 버전을 확인한다.

## 2. 고정된 제품 정체성

- 이 제품은 **공유 서비스가 아닌 1인용 AI 편집 어시스턴트**다.
- 핵심 가치는 수시간 원본을 사람이 전부 보는 대신 AI가 먼저 하이라이트 후보를 찾고, 사람이 짧은 후보만 검토하게 하는 것이다.
- GitHub Pages 앱에서 원본 선택 → 빠른 분석 → 후보 검토 → 메타데이터 출력까지 완주해야 한다. Gemini 정밀 분석이 실패해도 이 핵심 경로와 이미 찾은 후보는 유지한다.
- 회원가입, 사용자 계정, 팀 공유, 동시 공동 편집, 원격 프로젝트 DB, 기기간 자동 동기화, 게시 대행은 범위 밖이다. Gemini 정밀 분석용 stateless 중계 Worker만 명시적 예외로 두며, 사용자는 API 키를 입력하지 않는다.
- 공용 지침의 소규모 공유 서비스 기본값은 사용자 결정에 따른 명시적 프로젝트 예외다. 단, 개인용 앱의 복구·배포·백업·롤백·진단 품질은 생략하지 않는다.
- CHZZK 공식 라이브 채팅 수집이 필요하면 선택형 동반 수집기로 설계한다. Pages 핵심 경로는 사용자가 가진 JSONL·JSON·CSV 채팅 기록 가져오기다.

## 3. 데이터·보안 경계

- Gemini 정밀 분석은 빠른 분석이 고른 최대 12개의 30~60초 후보만 고정 스키마로 처리한다. 원본 전체·영상 프레임·파일명·채팅·후보 점수·사람 검토 상태는 Gemini 요청에 포함하지 않는다.
- 비밀 API key, CHZZK Client Secret, access/refresh token을 Pages 번들, URL, localStorage, IndexedDB, 프로젝트 JSON, 로그, fixture, 문서에 넣지 않는다. Gemini 키는 Cloudflare Worker Secret으로만 주입하고 오류 원문에도 복사하지 않는다.
- 중계 Worker는 고정 Origin, 고정 요청 스키마, 요청 크기·시간·횟수 제한, upstream timeout, 응답 크기 제한을 적용한다. 브라우저에는 키·provider 오류 원문을 반환하지 않는다.
- 원본 영상 전체와 완성 클립 전체를 IndexedDB에 복사하지 않는다.
- 원문 채팅은 기본 미보존이며, 사용자 opt-in 없이는 닉네임·원문·직접 식별자를 프로젝트에 남기지 않는다.
- 진단은 로컬 ring buffer와 사용자가 직접 저장하는 redacted JSON만 사용한다. 원격 텔레메트리는 기본 금지다.

## 4. 상태·생애주기 우선 설계

- UI 컴포넌트보다 먼저 상태 대상, 수명, 중심 lifecycle, 독립 status, 이벤트, guard, side effect, 확정 조건, 불변식을 정의한다.
- canonical 상태 규칙은 `STATE_LIFECYCLE.md`다. 구현이 문서와 다르면 코드에 맞춰 조용히 우회하지 말고 문서와 테스트를 함께 검토한다.
- 요청·진행·확정을 분리한다. 예: `pause requested → pausing → checkpoint committed → paused`.
- checkpoint, 후보 revision, 렌더 manifest, 저장 revision은 transaction commit 뒤에만 UI에 성공으로 공개한다.
- 정상 완료, gap을 가진 완료, 사용자 취소, 실패, 브라우저 중단을 서로 다른 terminal 의미로 보존한다.
- 모든 비동기 callback은 해당 operation ID와 expected revision을 검증한다. stale·중복·역순 이벤트는 상태를 바꾸지 않는다.
- 분석 실행의 source, chat sync, config, model manifest, score version은 run 동안 불변 snapshot이다. 바꾸려면 새 run을 만든다.
- 늦은 AI revision은 사람의 경계·제목·메모·승인·제외 판단을 절대 덮어쓰지 않는다. AI 제안과 사용자 revision을 별도 저장한다.
- 렌더는 `segmentId + userRevision + effectiveRange` snapshot을 고정한다.
- 정의되지 않은 전이는 reducer에서 거부하고 redacted 진단만 남긴다.
- 모든 허용·금지 전이, stale event, 중복 event, crash/reload, multi-tab, 저장 실패를 자동 테스트한다.

## 5. 초심자 UI/UX

- 첫 화면의 권장 행동은 하나로 유지한다: `내 원본 고르기` 다음 `AI로 하이라이트 찾기`.
- 모델명, 가중치, 코덱, WebGPU 같은 내부 용어는 기본 흐름에서 숨기고 필요할 때 쉬운 문장으로 번역한다.
- 상태 변화에는 현재 일, 남은 예상 범위, 이미 안전하게 저장된 결과, 다음 행동을 함께 표시한다.
- 자동 보정·후보 갱신·폴백은 이유와 Before/After를 보여 주고 되돌릴 수 있게 한다.
- 지원되지 않는 링크·코덱·브라우저는 막다른 오류 대신 원본 파일, 채팅 로그, 제한 분석, 메타데이터 출력 중 가능한 다음 행동을 제시한다.
- UI는 입력 → 분석 → 검토 → 결과의 단방향 시각·키보드 흐름을 유지한다.
- 키보드, 스크린리더, 200~400% 확대, forced colors, reduced motion, WCAG 2.2 AA를 구현과 release gate에 포함한다.

## 6. StreamSaver 디자인 기준

- `styles/streamsaver-reference.css`는 출처 보존용 불변 스냅샷이다. 직접 수정하지 않는다.
- ExClipper 전용 스타일은 호환 파일명인 `styles/retto-highlight.css` 또는 기능별 자체 파일에서 `.rh-` 접두사로 작성한다.
- 로드 순서는 StreamSaver reference CSS가 먼저, ExClipper override CSS가 다음이다.
- 원본 클래스 이름을 새 기능 의미로 억지 재사용하지 않는다.
- 구현 전 StreamSaver CSS·asset의 재사용 권리와 필요한 고지를 확인한다.

## 7. 작업공간과 변경 규칙

- 이 에이전트의 쓰기 범위는 `D:\Agents\rettohighlight\Codex\workspace`다.
- 다른 에이전트 작업공간과 원본 StreamSaver 프로젝트는 읽기만 하고 수정하지 않는다.
- 사용자 변경과 관련 없는 파일을 정리·되돌리거나 삭제하지 않는다.
- 파일 수정에는 `apply_patch`를 사용한다. 생성물·formatter의 기계적 출력은 해당 공용 규칙을 따른다.
- 기능 변경은 Before/After, 직접 위험, 2차 파급, 실패·복구 경로를 함께 검토한다.
- TypeScript strict, lint, unit, transition/property, migration, Worker protocol, Pages subpath E2E, 접근성 검사를 release gate로 유지한다.

## 8. 버전·로그·커밋

- 세 자리 SemVer를 사용하고 `appVersion`, `schemaVersion`, Worker protocol, model manifest 버전을 구분한다.
- 저장 형식·주소·공개 계약의 하위 호환 변경은 버전과 migration 범위를 명시한다.
- 조사, 결정, 폐기한 대안, 실패, 트러블슈팅, 검증 결과를 `DEVELOPMENT_LOG.md`에 누적한다.
- 구현·검증 결과를 먼저 사용자에게 보고한다.
- 사용자가 승인하기 전에는 commit·push·배포하지 않는다.
