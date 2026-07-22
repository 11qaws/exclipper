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