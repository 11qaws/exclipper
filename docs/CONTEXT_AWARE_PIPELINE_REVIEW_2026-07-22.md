## Context-aware highlight pipeline 재검토 및 구현 요청

Rettolight의 현재 구현을 기준으로 다음 설계 검토를 반영해 주세요.

상세 검토 대화:
https://chatgpt.com/share/6a6022c3-5200-83ee-a00a-933383b6b346?ogimg=plain

핵심 요구사항:

1. AI가 `reject`한 후보를 canonical candidate 목록에서 삭제하지 않는다.
2. 모든 후보는 Candidate Ledger에 유지한다.
3. AI 판단은 다음과 같은 projection 또는 annotation으로만 저장한다.
   - recommended
   - needs-review
   - deprioritized
   - insufficient-evidence
4. 사용자 승인, 제외, 경계 수정은 AI 재분석보다 항상 우선한다.
5. App.tsx에 얽혀 있는 분석 orchestration을 명시적인 analysis run state machine으로 분리한다.
6. 로컬 후보 Reservoir, Event Episode, Poisson density, Soft-NMS/MMR 구조는 유지하되 평가 가능한 diagnostics를 추가한다.
7. Runtime Manifest를 만들어 앱 버전, 프로토콜 버전, 모델 역할, 비용 예산을 한곳에서 관리한다.
8. Semantic Chapter의 빈 공간을 자동 skip이나 지루한 구간으로 해석하지 않는다.
9. coverage gap과 분석됐지만 주요 이슈가 없는 구간을 UI에서 구분한다.
10. 기존 사용자 상태와 프로젝트 복구 데이터를 보존한다.

첫 번째 구현 범위는 Candidate Ledger & AI Projection Integrity Patch로 제한해 주세요.

완료 조건:

- AI가 모든 후보를 deprioritized로 반환해도 canonical 후보 수가 줄지 않는다.
- context 분석 실패 시 기존 후보가 유지된다.
- AI 재분석 후에도 사용자 승인, 제외, 경계 수정이 유지된다.
- 낮은 우선순위 후보도 전체 후보 보기에서 다시 확인할 수 있다.
- stale context 응답이 최신 분석 결과를 덮어쓰지 않는다.
- 기존 테스트를 보존하고 관련 단위 테스트를 추가한다.
- check, test, build 결과를 PR 본문에 기록한다.
- 직접 main에 커밋하지 말고 새 브랜치와 Pull Request를 사용한다.

구현 전 현재 main의 코드와 PRODUCT_PLAN.md, DEVELOPMENT_LOG.md, AGENTS.md를 먼저 확인하고, 기존 작업을 되돌리지 마세요.

## ExClipper `0.3.34` 적용 판단

### 이번 패치에 수용

- 1~4번과 10번의 무결성 원칙을 수용한다. `candidates`는 canonical ledger로 유지하고 context AI 결과는 `recommended`, `needs-review`, `deprioritized`, `insufficient-evidence` projection으로만 붙인다.
- AI가 모두 `deprioritized`로 판정해도 canonical 후보 배열은 줄이지 않는다. 다만 승인하지 않은 낮은 우선순위·명시적 음악 후보는 추가 유료 화면·오디오 분석 queue에서 제외한다.
- 사용자 승인 후보는 AI projection과 무관하게 상세 분석 가능 상태를 유지하고, 사용자 제외 후보는 자동 재과금 대상에서 뺀다. 기존 경계 revision과 review state는 context 적용 시 다시 쓰지 않는다.
- context 실패와 stale 응답 차단은 기존 run/input signature와 AbortController fence를 유지한다. 저장된 context annotation을 복구할 때도 같은 projection을 재구성한다.
- 8~9번의 의미 구분은 설계 원칙으로 수용한다. semantic chapter 공백은 지루함으로 간주하지 않으며, coverage gap과 명시적 `no issue`는 같은 상태로 합치지 않는다.

### 별도 구조 개선으로 보류

- 5번의 App orchestration 전체 state machine 분리, 6번의 Reservoir/Event Episode/Poisson/Soft-NMS 진단 UI 확대, 7번의 단일 Runtime Manifest 통합은 방향은 타당하지만 이번 Gemini 모델·fallback 패치와 함께 바꾸지 않는다. 상태 소유권과 저장 schema의 회귀 범위가 크므로 전용 설계·migration·UI 작업으로 분리한다.
- 새 브랜치와 PR을 강제하는 절차는 이번 개인 저장소 세션에는 적용하지 않는다. 저장소 소유자가 현재 세션에서 직접 배포를 명시적으로 허용했고 기존 릴리스도 main→Pages 방식이므로, 동일한 check/build/deploy/public smoke 게이트를 사용한다.
