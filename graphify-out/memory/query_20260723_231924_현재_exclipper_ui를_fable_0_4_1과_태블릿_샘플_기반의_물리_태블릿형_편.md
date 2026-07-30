---
type: "architecture"
date: "2026-07-23T23:19:24.096431+00:00"
question: "현재 ExClipper UI를 Fable 0.4.1과 태블릿 샘플 기반의 물리 태블릿형 편집 콘솔로 재구성하려면 어떤 App·CSS·타임라인 구조를 함께 수정해야 하는가?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["App()", "Theme", "preview", "timeline UX plan"]
---

# Q: 현재 ExClipper UI를 Fable 0.4.1과 태블릿 샘플 기반의 물리 태블릿형 편집 콘솔로 재구성하려면 어떤 App·CSS·타임라인 구조를 함께 수정해야 하는가?

## Answer

App()의 단일 작업면, preview/review 후보 흐름, timeline UX 계획을 함께 따라 outer chassis와 inner screen을 분리했다. StreamSaver 참고 CSS는 선행 로드하고 ExClipper foundation/app CSS가 최종 geometry를 소유하게 했으며, 검토 화면은 921px 이상 2열·920px 이하 1열로 명시해 레거시 grid-column 누출을 차단했다.

## Outcome

- Signal: useful

## Source Nodes

- App()
- Theme
- preview
- timeline UX plan