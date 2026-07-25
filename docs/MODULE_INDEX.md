# 보완 색인 — graphify 가 못 잡는 것

`graphify` 그래프(`graphify-out/graph.json`)가 함수·타입·클래스 노드를 담당한다.
설계 전 탐색은 그쪽이 먼저다(`AGENTS.md` §9.4).

이 문서는 **그래프에 안 잡히는 것만** 적는다. 전체 목록이 아니다. 목록을 두 벌
만들면 한쪽이 반드시 낡는다.

---

## 1. 저장 필드 — AST 가 노드로 만들지 않는다

그래프는 함수와 타입까지 간다. **레코드 안의 필드는 안 간다.** "이 값이 저장되나"
를 그래프로는 알 수 없으므로 여기 적는다.

| 저장되는 값 | 위치 | 비고 |
|---|---|---|
| `thumbnailById` | `storage/candidatePassBInsightStore.ts` | 후보당 대표 프레임 1장(base64). **복원하면 살아난다** |
| `insightById` | `storage/candidatePassBInsightStore.ts` | Pass B 인사이트 |
| `verificationReceiptById` | `storage/candidatePassBInsightStore.ts` | 검증 영수증 |
| `modelByCandidateId` | `storage/candidatePassBInsightStore.ts` | 후보별 사용 모델 |
| `contentFingerprint` | `storage/durableAnalysisPayload.ts` | 콘텐츠 지문. **캐시의 조회 키가 된다** |
| `rankPercentile` | `storage/durableAnalysisPayload.ts` | 내부 계산용. **사용자에게 보이면 안 된다** |

**저장되지 않는 것** (메모리에만 존재 — 새로고침하면 사라짐):

| 값 | 비고 |
|---|---|
| 통합 타임라인 4컷 프레임 | 저장 예정 (상태 모델 §7) |
| 원본 `File` 객체 | 핸들 저장으로 대체 예정 (상태 모델 §6) |

`storage/analysisResultStore.ts` 는 **JSON 만 받는다.** `Blob`·`File`·핸들은 거부한다
(`validateAndClone*`). base64 문자열은 JSON 이므로 통과한다.

---

## 2. 파일명이 개념과 다른 것

한국어로 떠올린 개념과 영어 파일명이 멀어 검색이 빗나가는 것들. 개념어가 아니라
**영어 식별자로 찾아야 한다**(`AGENTS.md` §9.1).

| 찾으려던 것 | 실제 위치 |
|---|---|
| 검토 화면 키보드 단축키 | `app/useReviewShortcuts.ts` — **키맵의 유일한 소유자** |
| 단축키 도움말 오버레이 | `app/components/ShortcutHelpOverlay.tsx` |
| 되돌리기 토스트 | `app/components/ReviewUndoToast.tsx` |
| 남은 시간 추정 | `app/progressEstimate.ts` — 패딩·단조 감소 포함 |
| 후보 이동 규칙 | `app/reviewNavigation.ts` |
| 후보 위치 스트립 좌표 | `app/positionStrip.ts` |
| 분석 실행 상태 기계 | `domain/analysisRun.ts` — **16 상태 전이표** |
| 진행 문구 | `app/statusMessages.ts` |
| 후보 분류 프롬프트 | `analysis/broadcastContextDeepseek.ts` |
| 파이프라인 글자수 상한 | `analysis/candidatePassBGemini.ts` |

---

## 3. 두 번 만들기 쉬운 것 — 이미 있다

같은 일을 하는 것이 이미 있는데 새로 만들려다 멈춘 사례들. 새로 만들기 전에
여기부터 본다.

| 하려던 일 | 이미 있는 것 |
|---|---|
| 키보드 핸들러 작성 | `useReviewShortcuts` — `event.code` 기반, IME·repeat 가드 포함 |
| 판단 후 다음 후보로 이동 | `App.tsx` 의 `reviewCandidateAndAdvance` |
| 되돌리기 | `App.tsx` 의 `undoLastReview` + `reviewUndo` 상태 |
| 남은 시간 계산 | `progressEstimate` |
| 대사 cue 를 절대 시각으로 | `analysis/candidatePassBPresentation.ts` 의 `buildCandidatePassBPresentation` |
| 상태 전이 거부 | `domain/analysisRun.ts` — 거부 사유가 열거형으로 이미 있다 |

---

## 4. 갱신 방법

이 문서는 손으로 쓴다. 자동 생성하지 않는다 — 여기 있는 것들은 기계가 못 뽑는
것들이라서 만든 문서다.

`graphify` 갱신(코드만, 비용 0):

```bash
# 변경 감지 → 코드만 AST 추출 → 그래프 재빌드
# 절차는 skills/graphify 의 references/update.md 참고
```
