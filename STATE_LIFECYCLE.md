# ExClipper 상태·생애주기 명세

- 문서 버전: 0.3.40
- 기준 제품 계획: PRODUCT_PLAN.md 0.3.40
- 기준일: 2026-07-20 (Asia/Seoul)
- 적용 범위: GitHub Pages에서 실행되는 개인 편집 어시스턴트와 선택형 CHZZK 동반 수집기
- 문서 지위: 구현 전 상태 모델의 기준 문서

## `0.3.40` 맥락 후 세부 검토와 후보 수 상한 분리

- 표시 순서는 `fast discovery → whole-broadcast context → context-aware detail review → editor final selection`이다. 앞 단계가 `active`인 동안 뒤 자동 단계는 `pending`이며, 전체 맥락이 terminal에 도달한 뒤에만 세부 검토가 `active`가 된다. 최종 선택 표시기는 자동 세부 검토가 `complete | error`가 된 뒤 편집자 작업을 `active`로 안내한다. 후보 카드는 분석 중에도 미리 볼 수 있고, 오류가 나도 이미 확정한 canonical 후보는 유지한다.
- 의미 후보 정밀화는 먼저 같은 run의 `refinementCandidatesJson`을 저장하고 재개방 검증한 뒤 canonical ledger에 합친다. 합친 결과가 12개를 넘어도 유효하다. `candidateCount <= 12`는 ranking projection과 한 번의 paid detail batch에만 적용하며 candidate review availability의 전역 불변식으로 사용하지 않는다.
- ranking view는 13개 이상에서 빈 canonical order를 가진 안전한 비활성 session으로 교체한다. 실제 후보 배열은 시간순 원장으로 그대로 유지되고, projection mismatch는 입력 후보 전체를 그대로 반환한다. 후보가 많다는 이유로 membership, review state, boundary revision, 저장된 AI 근거를 삭제하는 전이는 금지한다.
- 자동 세부 검토 operation identity는 source fingerprint와 현재 detail target ID 집합을 포함한다. 같은 집합은 한 번만 자동 시작한다. run이 busy이면 새 의미 후보 집합을 예약 상태로 두고 terminal 뒤 아직 Pass B evidence/insight가 없는 ID만 다음 최대 12개 batch로 처리한다.
- 최상위 display error boundary는 presentation failure만 격리한다. 복구 화면 진입은 IndexedDB 분석 세션, context checkpoint, candidate ledger, 사용자 판단을 변경하지 않으며, 사용자가 명시적으로 누른 reload만 앱을 다시 초기화한다.

## `0.3.39` 병렬 맥락 run과 편집 목적 projection 경계

- 같은 context run epoch 안에서 `overview`와 deterministic full-coverage `discovery[0..3]`를 동시에 시작한다. 각 작업은 같은 source fingerprint, input signature, abort signal을 사용한다. 어느 한쪽의 이전 run 응답도 현재 run을 확정하거나 덮어쓸 수 없다.
- discovery 일부가 일시 실패해도 성공한 slice와 overview를 합쳐 비교 배심으로 진행한다. overview 실패는 공통 맥락 결과를 확정할 수 없으므로 기존 canonical candidate ledger와 사람 판단을 그대로 보존한 `failed` 종료다.
- context cache identity는 routing `1.9.0`, topical discovery `1.3.0`, 실제 model revision을 포함한다. Qwen 3.7 overview·jury·quality refinement와 Qwen 3.6 discovery·fast refinement 결과를 서로 같은 모델 결과로 relabel하지 않는다.
- whole-context session envelope `1.1.0`은 전체 `refinementLeadIds`와 그 부분집합인 `fastRefinementLeadIds`를 함께 저장한다. 비교 배심이 승인한 lead만 3.6 fast localization으로 가고, topic-balanced reserve는 3.7 quality refinement로 간다. 복구 시 fast ID가 refinement ID와 현재 result lead 양쪽에 속하지 않으면 제거한다.
- 최대 20개 caption refinement는 6개 bounded pool에서 실행하되 결과 배열은 입력 lead 순서를 유지한다. 호출 하나의 transport 실패·성공한 빈 abstention·성공을 lead별로 구분하고, 전체 후보 원장이나 다른 lead 결과를 롤백하지 않는다.
- 후속 `activeEditorialIntent`는 `balanced | main-story | shorts | recap` 중 하나인 presentation state다. 변경 이벤트는 저장된 공통 evidence와 candidate ledger를 다시 분석하지 않고 ranking projection만 교체한다. 후보 membership, AI priority annotation, user review state, boundary revision, export 승인 여부를 변경하는 전이는 금지한다.
- 사건 category와 Editorial Intent는 독립 축이다. 예를 들어 `apology-accountability`나 `quiet-achievement`는 사건의 의미이고, `shorts`나 `main-story`는 그 사건을 어떤 편집 결과에 우선 배치할지 정하는 view다.

## `0.3.36` topic-balanced 내부 refinement와 canonical projection 경계

- whole-context 세션의 `refinementLeadIds`는 최종 후보 원장이 아니라 비용이 제한된 내부 위치 확인 계획이다. Qwen jury가 선택한 ID와 topic-balanced reserve를 순서대로 저장하며 최대 20개다. 자막이 없으면 실제 ASR plan이 다시 최대 4개로 줄이고, 자막 경로도 결과 후보를 중복 제거한 뒤 최대 12개만 canonical ledger에 제안한다.
- jury 선택이 0개면 refinement ID와 semantic proposal은 모두 빈 배열로 정상 완료한다. 선택이 1개뿐이면 해당 선택과 reserve를 합쳐 최대 6개까지만 허용한다. 이 상태는 `failed`가 아니며 후보 수를 채우기 위한 추가 호출을 만들지 않는다.
- context cache identity는 input signature, routing revision `1.8.0`, topical discovery `1.2.0`, jury model revision을 함께 요구한다. 이전 저장 결과는 삭제하지 않지만 새 run의 자동 결과로 가장하지 않는다. 저장된 refinement ID는 현재 result의 lead ID에 실제로 존재하고 현재 최대치 안에 있을 때만 복구한다.
- 최대 20개 caption refinement 요청은 3개 bounded pool에서 안정된 입력 순서로 정착한다. 호출 하나가 transport failure면 해당 parent lead만 기존 source-fenced cue matcher로 내려가고, 성공했지만 빈 결과인 호출은 모델의 의도적 abstention으로 유지한다.
- context annotation은 canonical candidate를 삭제하지 않는다. `recommended | needs-review | deprioritized | insufficient-evidence` projection과 유료 상세 queue eligibility만 갱신하며, 사용자의 `approved | rejected`, boundary revision, 원본 candidate ID와 source range는 계속 우선한다.

## `0.3.35` 검증된 전사 transport·청크 checkpoint·닫힌 출연진

- 방송 전사 transport 상한은 실운영 성공을 확인한 90초이며, 최대 12시간의 균등·사건 표본을 모두 표현하는 Worker 상한은 240개다. 청크 수 증가는 duration 과금 총량을 바꾸지 않으며 ASR budget은 `$0.42`로 유지한다.
- transcript partial result가 현재 source/run identity를 통과하면 해당 source range를 chapter checkpoint로 즉시 write/readback한다. 아직 오지 않았거나 실패한 청크는 gap ID로 함께 저장한다. 새로고침·재연결은 sampling window에서 저장 chapter 범위를 빼고 uncovered range만 새 90초 청크로 만든다.
- `0.3.34`의 호환 가능한 210초 Qwen chapter는 원래 model identity와 source fence를 보존해 재사용한다. 겹치지 않는 uncovered range만 새 revision으로 채우며, 과거 chapter를 새 모델 결과로 relabel하지 않는다.
- 후보의 `castRosterId`는 서버가 알고 있는 `chzzk-video-13996057-v1` 하나만 허용하며, source filename이 replay `13996057` 또는 검토된 `교환학생/합격생/장학생` 제목과 맞을 때만 target에 붙인다. 임의 텍스트 roster와 다른 방송의 자동 명단 상속은 Worker 경계를 넘지 못한다. `provided-cast-reference`는 등록 이름, 같은 프레임의 서로 다른 특징 2개 이상, confidence 0.88 이상을 모두 만족해야 한다.
- 출연자 projection은 카드 표시 증거만 소유한다. 점수, 후보 생성·삭제, 경계, 승인·제외, 전체 맥락 판정을 변경하는 전이는 없다. 화면이 없으면 등록 출연진 식별도 audio-only 안전 projection에서 제거한다.
- 대표 화면 채집은 최대 2개 디코더만 병렬로 열며 후보 AI 요청의 bounded parallel pool과 분리된다. 화면 채집 실패는 후보를 지우지 않고 audio-only gap projection으로 낮춘다.
- 전체 맥락 tier fallback은 `timeout | unavailable | rate-limited | model-unavailable | response-format | invalid-response`에서만 Qwen 3.7과 3.6 사이를 한 번 전환한다. `auth | invalid-argument | rejected`는 결정적 실패로 남기며 두 번째 유료 요청을 만들지 않는다. 성공 응답은 fallback reason을, 두 tier 모두 실패한 응답은 두 실패 class만 기록한다.

## `0.3.34` Gemini 후보 폴백 identity와 유료 결과 보존

- 새 후보 요청의 route manifest는 `qwen3.5-omni-flash_then_gemini-3.6-flash_bounded-v3`다. Qwen이 기본이며 Gemini는 bounded 대체 시도 또는 명시적으로 선택된 provider일 때만 호출한다.
- 저장된 `gemini-3.5-flash`/`gemini-3.5-flash-grounded-frames-v2-2026-07-22`와 v2 route manifest는 호환 가능한 유료 legacy 결과다. 복구는 원래 identity를 유지하고 재요청을 예약하지 않는다.
- Gemini Secret이 없거나 런타임에서 준비되지 않았으면 provider 연결은 후보 payload를 읽기 전에 `PROXY_NOT_CONFIGURED`로 끝난다. 이 실패는 Qwen 결과, 후보 경계, 점수, 승인 상태, 전체 맥락 cache를 변경하지 않는다.
- 후보 fallback 정책 버전 `1.7.0`과 방송 전체 맥락 cache fence `1.6.0`은 분리한다. 후보 모델 교체만으로 저장된 Qwen context 결과를 폐기하거나 다시 과금하는 전이는 금지한다.
- 후보 원장은 context 결과 전후에 같은 ID·개수·review state·boundary revision을 유지한다. context annotation은 `recommended | needs-review | deprioritized | insufficient-evidence` projection만 갱신할 수 있다.
- 사용자 `approved`는 낮은 AI 우선순위보다 상세 분석 queue에서 우선하고, 사용자 `rejected`는 자동 재분석 대상에서 제외한다. 어느 경우에도 AI가 사용자 결정을 되돌리거나 candidate 객체를 삭제하지 않는다.
- candidate cross-provider 전이는 `timeout | unavailable | rate-limited | auth | model-unavailable | response-format | invalid-response`에서만 한 번 허용한다. `invalid-argument | rejected`에서 대체 provider를 호출하는 전이는 금지한다.

## `0.3.33` context-first gate와 자막 refinement

- 로컬 fast pass 완료는 Candidate Pass B 시작 조건이 아니다. transcript가 `completed | completedWithGaps`이면 whole-context가 `completed | failed`로 정착한 뒤에만 정밀 후보 해석을 시작한다. transcript 자체가 `failed`면 후보 단계는 기존 fast result를 보존한 채 진행할 수 있다.
- 공개 YouTube caption track은 현재 source/run에 묶인 휘발 상태다. source 교체·새 분석·복구 전환 때 반드시 비우며, 저장된 chapter map을 다시 열 때는 같은 video ID의 track을 재요청할 수 있다.
- whole-context annotation과 source-fenced explicit-music gate가 모두 후보 생존 조건이다. 둘 중 하나가 ineligible이면 해당 후보는 정밀 분석 budget을 소비하지 않는다.
- caption refinement plan은 의미 lead 전체 범위를 30초 cell로 나누고 `estimatedAsrCostUsd = 0`을 유지한다. caption이 없을 때만 기존 ASR reserve plan을 사용하며, 두 plan의 결과는 동일한 source range 검증과 semantic candidate serialization을 거친다.
- 타임라인의 후보 번호는 항상 현재 candidates를 source peak 시각으로 정렬한 index+1이다. 원·요약 카드·접근성 label이 같은 index를 사용하며, 주제/의미 단서 레이어는 candidate lifecycle을 변경하지 않는 projection이다.
- topical discovery의 최대 24개 lead는 비교 전 reservoir다. editorial jury가 선택한 상위 3개와 시간상 인접한 context reserve 3개의 ID만 별도 세션 envelope에 저장하고 refinement 입력으로 사용한다. jury가 빈 배열이면 semantic refinement도 빈 결과로 정착한다.
- 의미 단서 목록의 접힘 여부와 종류별 색은 탭의 표현 상태다. source range, confidence, lead ID, 후보 승인 상태 또는 저장 dirty 여부를 변경하지 않는다.

## `0.3.31` 후보 모델 라우팅과 결과 귀속

- 후보 정밀 분석 run은 `exclipper-candidate-perception-route`를 불변 model manifest로 고정한다. 개별 후보 결과는 Qwen 또는 Gemini의 실제 model ID·revision을 별도 보조 상태로 기록한다.
- 기본 provider 실패 뒤 bounded fallback은 같은 후보 operation 안의 단 한 번의 대체 시도다. 새 run이나 새 canonical candidate를 만들지 않으며 기존 빠른 후보·사람 결정·경계를 변경하지 않는다.
- fallback 응답도 기존 operation identity, candidate ID, source range, event fence를 모두 통과한 뒤에만 확정된다. 늦은 응답과 알 수 없는 model ID/revision 조합은 거부한다.
- 후보별 실제 모델 귀속은 Candidate Pass B insight schema `1.3.0`의 `modelByCandidateId`에 저장한다. 1.0~1.2 기록은 이 필드가 없는 legacy 결과로 계속 복구한다.
- 장시간 방송 전사는 timeout 뒤 자동 provider 전환을 하지 않는다. 이미 과금됐을 가능성이 있는 동일 오디오를 다시 보내지 않고 해당 구간을 coverage gap으로 유지한다.
- 전체 맥락 결과의 주제 구간은 실제 transcript chapter ID와 시간 범위를 모두 만족하는 파생 projection이다. 잘못되거나 겹치는 주제 구간 하나를 제외해도 독립적으로 유효한 후보 판정과 의미 단서는 보존한다.
- 대표 화면 수가 0이면 Candidate Pass B 결과를 `audio-only` 안전 projection으로 낮춘다. 대사 시각은 유지하지만 화면 사건·게임 종류·출연자·인과 설명은 저장하거나 복원하지 않는다.
- 타임라인의 후보 번호, 세로 lane, 30분 눈금, 주제 띠, 의미 단서 표시는 화면 projection일 뿐 candidate ID·원본 범위·점수·review state의 소유권이나 lifecycle을 바꾸지 않는다.

## 0. 이 문서가 해결하는 문제

ExClipper는 최대 12시간의 방송 원본을 브라우저에서 여러 단계로 분석한다. 정확히 12시간은 유효하고 초과 원본은 SourceCheck에서 분석 전에 차단한다. 모델 다운로드, 미디어 디코딩, 채팅 가져오기, AI 분석, 자동 저장, 클립 렌더링은 모두 비동기이며 탭 종료나 브라우저 오류로 중간에 끊길 수 있다. 동시에 사용자는 AI 분석이 끝나기 전부터 후보를 검토하고 직접 수정할 수 있다.

이때 소스, 분석, 검토 화면, 저장 오류를 하나의 status 문자열에 섞으면 다음 문제가 생긴다.

- 분석 중이면서 후보 검토 중인 정상 상태를 표현할 수 없다.
- 일시정지 버튼을 누른 것과 Worker가 실제로 멈춘 것을 구분할 수 없다.
- 이전 분석 Worker가 늦게 보낸 결과가 새 분석을 덮어쓸 수 있다.
- 빠른 AI 후보를 사용자가 수정한 뒤 정밀 AI 결과가 도착하면 사람의 편집이 사라질 수 있다.
- 새로고침 뒤 완료되지 않은 작업을 완료로 오인할 수 있다.
- 파일을 만들었다는 화면과 실제 디스크 쓰기 완료가 어긋날 수 있다.

따라서 이 문서는 상태의 대상과 수명을 분리하고, 모든 변경을 현재 상태 + 이벤트 → 다음 상태로 정의한다. 정의되지 않은 전이는 오류로 거부한다.

## 1. 제품 정체성과 명시적 제외 범위

ExClipper의 정체성은 한 사람이 자신의 컴퓨터에서 사용하는 개인 편집 어시스턴트다.

포함한다.

- 한 브라우저 프로필 안의 로컬 프로젝트
- 로컬 영상, 사용자가 가져온 자막·채팅 로그
- AI 분석과 부분 결과
- 한 사람이 여러 탭을 실수로 열었을 때의 데이터 경합 방지
- IndexedDB, Cache Storage, 선택적 OPFS, 사용자가 선택한 출력 폴더
- 새로고침·탭 종료·브라우저 중단 뒤 복구
- 사용자가 자신의 CHZZK 방송에 명시적으로 연결하는 선택형 로컬 채팅 수집기

포함하지 않는다.

- 계정, 로그인, 팀, 조직, 역할, 권한
- 여러 사용자의 공동 편집
- 서버 데이터베이스와 기기 간 동기화
- 원격 프로젝트 공유 링크
- Cloudflare·Oracle·별도 API 서버
- 서버가 보관하는 영상·채팅·AI 결과
- 다른 사람에게 실시간으로 상태를 전파하는 협업 기능
- 공용 CHZZK 수집 서버와 임의 채널의 무단 수집

BroadcastChannel과 Web Locks는 같은 사용자가 같은 origin의 탭을 여러 개 열었을 때 로컬 손상을 막기 위한 장치다. 이것을 공유 서비스나 공동 편집으로 확장 해석하지 않는다.

## 2. 상태 모델 공통 원칙

### 2.1 한 상태는 한 대상의 한 생애주기만 표현한다

다음은 서로 다른 대상이므로 각각 status를 가진다.

| 대상 | 대표 식별자 | 수명 | 영속성 |
|---|---|---|---|
| Project | projectId | 사용자가 만들고 휴지통에서 비울 때까지 | IndexedDB |
| SourceDefinition | sourceDefinitionId | 휴대 가능한 프로젝트의 논리 원본 정의 | IndexedDB·프로젝트 JSON |
| SourceBinding | bindingId | 현재 브라우저·기기에서 논리 원본을 실제 파일에 연결 | 기기 로컬 IndexedDB, export 제외 |
| SourceCheck | jobId | 한 번의 소스 검사 시도 | 결과·진단만 영속 |
| ChatSource | chatSourceId | 가져오기를 확정한 채팅 자료 | IndexedDB |
| ChatImport | jobId | 한 번의 파싱·검증·정렬 시도 | 임시 자료와 결과 |
| ModelArtifact | artifactId | 고정 revision 모델의 캐시 정의 | Cache Storage + IndexedDB manifest |
| ModelDownload | jobId | 한 번의 모델 다운로드 시도 | 진행·결과 |
| AnalysisJob | analysisJobId | 사용자가 보는 한 분석 작업과 실행 이력 묶음 | IndexedDB |
| AnalysisSpec | analysisSpecId | 입력·설정을 고정한 immutable 분석 명세 | IndexedDB |
| AnalysisRun | runId | 한 번 실제로 실행한 분석 시도 | checkpoint·결과 |
| CandidateProposal | proposalId | AI가 만든 한 번의 후보 제안 revision | IndexedDB |
| Segment | segmentId | 사용자가 검토·편집하는 장면 | IndexedDB |
| RangeCapture | captureId | 한 번의 직접 장면 기록 시도 | 활성 capture와 결과 |
| SaveCommit | commitId | 한 번의 원자적 저장 시도 | 저장 journal |
| MigrationRun | migrationId | 한 번의 DB schema 이동 시도 | migration journal |
| RenderBatch | renderBatchId | 승인 장면 묶음의 한 번 출력 시도 | 큐·결과 |
| RenderItem | renderItemId | 장면 하나의 파일 출력 시도 | 큐·결과 |
| ExportJob | exportJobId | 한 번의 메타데이터 내보내기 | 결과 기록 |
| AppSession | sessionId | 탭을 연 뒤 닫거나 중단될 때까지 | 짧은 session journal |
| LocalLiveCaptureRun | captureRunId | 선택형 로컬 도구의 한 CHZZK 수집 시도 | 로컬 JSONL·run manifest |

화면 위치는 도메인 status가 아니다. 예를 들어 review 화면을 열었다는 이유로 AnalysisRun.status를 reviewing으로 바꾸지 않는다.

### 2.2 중심 상태와 보조 상태를 분리한다

각 대상의 status는 생애주기의 현재 위치 하나만 나타낸다. 다음 정보는 독립 필드다.

- 진행 단계: stage
- 진행률: progress
- 원본 가용성: availability
- 기능 능력: capabilities
- 분석 coverage: coveredIntervals, failedIntervals
- 요청 의도: pendingIntent
- 실패 사유: reasonCode, recoverability
- 저장 안전성: durability
- 출력 안전성: outputSafety
- 네트워크 상태: connectivity
- 탭 표시 상태: visibility
- 실행 장치: runtimeTier
- 앱 업데이트 가용성: updateAvailable

예를 들어 AnalysisRun.status는 running이고 stage는 deepPass일 수 있다. 동시에 SourceBinding.availability는 permissionLost일 수 있으며, 이 경우 분석은 새 청크를 시작하지 않고 pause 절차로 들어간다.

### 2.3 요청·진행·확정을 구분한다

버튼 클릭은 요청 이벤트일 뿐 완료가 아니다.

| 사용자 의도 | 요청 직후 | 실제 진행 | 확정 조건 |
|---|---|---|---|
| 분석 시작 | starting | Worker와 저장소 준비 | 첫 실행 manifest 저장 후 running |
| 분석 일시정지 | pausing | 새 청크 배정 중단, Worker 정지 | 모든 활성 Worker ACK + checkpoint commit |
| 분석 취소 | cancelling | Worker 종료와 쓰기 fence | 종료 확인 + cancellation record commit |
| 채팅 가져오기 적용 | committing | 임시 자료를 최종 store로 이동 | 검증된 ChatSource와 aggregate 원자 저장 |
| 파일 출력 | finalizing | 스트림 닫기와 결과 검증 | 파일 close + 안전성 검증 + 결과 record commit |
| 앱 닫기 | closing | 저장 flush와 작업 중단 요청 | 브라우저가 허용한 범위의 flush 후 ended |

UI는 확정 조건을 만족하기 전 성공 문구를 표시하지 않는다.

### 2.4 종료 의미를 섞지 않는다

공통 종료 의미는 다음 다섯 가지다.

- completed: 정상 결과가 확정되었다.
- completedWithGaps: 계획 범위의 누락이 모두 이유·영향·승인으로 설명된 상태에서 제한 결과가 정상 확정되었다.
- cancelled: 사용자가 중단을 요청했고 작업이 더 이상 결과를 쓰지 못하도록 fence가 확정되었다.
- failed: 처리 오류로 목표를 달성하지 못했다.
- interrupted: 탭 종료, 브라우저 강제 종료, Worker 소실처럼 정상 종료 절차 없이 실행이 사라졌다.

부분 결과가 있다는 사실은 종료 status가 아니다. hasPartialResult, coveredIntervals, succeededItemCount 같은 보조 필드로 표현한다.

### 2.5 재시도와 재개 식별자 규칙

실패 재시도와 실행 주체가 사라진 뒤의 재개는 이전 실행을 되살리지 않고 새 jobId 또는 runId를 발급한다.

- SourceCheck 재검사: 새 jobId
- ChatImport 재가져오기: 새 jobId
- ModelDownload 재다운로드: 새 jobId
- AnalysisRun 정상 일시정지 뒤 같은 AppSession에서 입력·설정·모델 snapshot이 동일한 재개: 같은 runId, status는 paused → resuming → running, workerEpoch 증가, 새 workerInstanceId와 taskId 발급
- AnalysisRun 새로고침·브라우저 종료·Worker crash·failed 재시도·입력/설정/모델 변경 뒤 재개: 새 runId, resumedFromRunId 기록
- Render 재시도: 새 renderItemId 또는 새 RenderBatch
- Export 재시도: 새 exportJobId

정상 pause는 담당 AppSession과 run manifest가 살아 있고 Worker 정지 ACK 및 checkpoint commit이 모두 확인된 안전 경계이므로 같은 runId를 이어갈 수 있다. 이 경우에도 이전 Worker callback을 막기 위해 workerEpoch와 taskId는 새로 만든다. 그 밖의 재시도에서는 검증된 checkpoint와 캐시만 새 실행이 읽으며 이전 실행의 status를 running으로 되돌리지 않는다.

## 3. 식별자, 실행 fence, 이벤트 봉투

### 3.1 식별자 규칙

- 모든 식별자는 생성 뒤 바꾸지 않는다.
- 새 시도에는 새 식별자를 발급한다.
- 화면 배열 index나 파일명은 식별자로 쓰지 않는다.
- chunkId는 분석 입력 서명과 시간 범위를 포함해 결정적으로 만들 수 있으나, 실행 시도는 runId로 별도 구분한다.
- eventId는 발신자마다 유일한 UUID를 사용한다.
- 한 Worker 재시작마다 workerInstanceId를 새로 발급한다.
- 같은 AnalysisRun 안에서도 시작·정상 재개 때 workerEpoch를 증가시킨다.
- 실제 청크 배정 하나마다 taskId를 새로 발급한다.

권장 이벤트 봉투:

    type DomainEventEnvelope = {
      schemaVersion: "1.0.0";
      eventId: string;
      eventType: string;
      projectId: string;
      sessionId: string;
      writerEpoch: number;
      emittedAt: string;
      jobId?: string;
      runId?: string;
      captureRunId?: string;
      chunkId?: string;
      chunkAttempt?: number;
      taskId?: string;
      workerEpoch?: number;
      workerInstanceId?: string;
      entityId?: string;
      baseRevision?: number;
      payload: unknown;
    };

### 3.2 이벤트 수락 순서

Worker, timer, player callback, BroadcastChannel에서 온 이벤트는 다음을 모두 통과해야 reducer와 저장소에 반영한다.

1. payload가 런타임 schema 검증을 통과한다.
2. projectId가 현재 프로젝트와 일치한다.
3. sessionId와 writerEpoch가 현재 쓰기 소유자와 일치한다.
4. jobId 또는 runId가 해당 대상의 활성 실행과 일치한다.
5. workerEpoch, workerInstanceId, taskId가 현재 배정과 일치한다.
6. chunkId가 이 실행에 등록된 범위이며 chunkAttempt가 최신이다.
7. eventId가 이미 처리된 이벤트가 아니다.
8. 현재 status에서 eventType 전이가 허용된다.
9. baseRevision이 필요한 쓰기는 현재 revision과 일치한다.
10. 입력 서명 sourceFingerprint + chatAlignmentRevision + analysisConfigHash가 실행 manifest와 일치한다.

하나라도 실패하면 이벤트를 상태에 반영하지 않는다. 예상 가능한 오래된 이벤트는 사용자 오류로 표시하지 않고 진단 로그에 stale_event_ignored로 남긴다. 스키마 오류나 현재 실행에서 온 금지 전이는 개발 오류로 기록한다.

### 3.3 원자적 checkpoint

한 분석 청크의 확정은 하나의 IndexedDB transaction에서 수행한다.

- feature row
- covered interval 또는 failed interval
- 후보 proposal revision
- 실행 progress
- 처리된 eventId
- checkpoint manifest

이 중 일부만 저장되면 transaction 전체를 rollback한다. progress 막대는 commit이 끝난 뒤에만 증가한다.

### 3.4 입력 서명

분석과 출력은 시작 시 입력을 고정한다.

    inputSignature = hash(
      sourceFingerprint
      + sourceTimelineRevision
      + chatSourceIds
      + chatAlignmentRevisions
      + captionRevision
      + analysisConfig
      + scoreVersion
      + modelManifest
    )

실행 중 입력이 바뀌면 기존 실행을 조용히 변형하지 않는다. 현재 실행은 고정된 서명으로 계속되며 변경 사항은 새 실행에만 적용한다.

## 4. 상태 소유 관계

~~~mermaid
flowchart TB
    P --> SD["SourceDefinition · 휴대 가능한 논리 원본"]
    SD --> SB["SourceBinding · 이 기기의 실제 파일 연결"]
    SD --> SC["SourceCheck · 검사 시도"]
    SB --> SC
    P --> CS["ChatSource · 확정 채팅"]
    CS --> CI["ChatImport · 가져오기 시도"]
    P --> AJ["AnalysisJob · 사용자 작업 묶음"]
    AJ --> AS["AnalysisSpec · 고정 입력"]
    AS --> AR["AnalysisRun · 실행 시도"]
    AR --> CP["CandidateProposal · AI 제안 revision"]
    P --> SG["Segment · 사람 편집 revision"]
    CP --> SG
    P --> RC["RangeCapture · 직접 기록 시도"]
    RC --> SG
    P --> RB["RenderBatch · 출력 snapshot"]
    RB --> RI["RenderItem · 파일 하나"]
    P --> EJ["ExportJob · 메타데이터 snapshot"]
    P --> SV["SaveCommit · 원자 저장"]
    P --> AP["AppSession · 한 탭"]
    AP --> MG["MigrationRun · DB 이동"]
    AP --> MD["ModelDownload · 캐시 시도"]
    LC["LocalLiveCaptureRun · 별도 로컬 도구"] --> CI
~~~

핵심 동시성은 허용한다.

- AnalysisRun이 running인 동안 Segment 검토·수정 가능
- AnalysisRun이 running인 동안 SaveCommit 가능
- 후보 검토 중 ModelDownload가 다음 정밀 모델을 받을 수 있음
- RenderBatch가 immutable snapshot을 사용한다면 새 Segment 편집 가능

핵심 경합은 금지한다.

- 같은 프로젝트에 쓰기 가능한 AnalysisRun 두 개
- 같은 프로젝트에 활성 RangeCapture 두 개
- 같은 ModelArtifact에 다운로드 두 개
- 같은 프로젝트에 writer AppSession 두 개
- MigrationRun 중 일반 프로젝트 쓰기
- 같은 RenderBatch에서 활성 RenderItem 두 개

## 5. Project, SourceDefinition, SourceBinding

### 5.1 Project 생애주기

Project는 사용자가 만든 영구 작업의 컨테이너다.

| 현재 status | 이벤트 | 다음 status | 확정 조건 |
|---|---|---|---|
| active | PROJECT_TRASH_REQUESTED | trashing | 활성 쓰기 작업에 취소 요청, 새 작업 생성 차단 |
| trashing | ALL_WRITES_FENCED | trashed | 모든 활성 run/job가 더 이상 쓸 수 없고 휴지통 revision 저장 |
| trashing | TRASH_ABORTED | active | 삭제 준비 전 상태와 writer 권한 복원 |
| trashed | PROJECT_RESTORE_REQUESTED | restoring | schema·연결 정보 검증 시작 |
| restoring | RESTORE_COMMITTED | active | 복원 revision 원자 저장 |
| restoring | RESTORE_FAILED | trashed | 원본 휴지통 자료 보존 |
| trashed | PURGE_REQUESTED | purging | 최종 확인 뒤 관련 레코드 삭제 transaction 시작 |
| purging | PURGE_COMMITTED | purged | 프로젝트 DB 레코드와 전용 임시 자료 삭제 확정 |
| purging | PURGE_FAILED | trashed | 삭제되지 않은 자료를 다시 접근 가능하게 유지 |

purged는 화면에 남는 프로젝트 상태가 아니라 삭제 완료 audit event의 의미다. 휴지통 이동 전에 AnalysisRun, ChatImport, RenderBatch 같은 활성 쓰기는 반드시 cancelling → cancelled 또는 interrupted로 fence되어야 한다.

### 5.2 SourceDefinition

SourceDefinition은 프로젝트 백업과 함께 이동할 수 있는 논리 원본 정의다. 실제 File 객체나 FileSystemHandle을 소유하지 않는다.

- sourceDefinitionId
- lifecycle: active, replaced, removed
- kind: local, youtube, chzzk, directMedia, external
- title, originalUrl, platformVideoId
- sourceTimelineRevision: 원본 기준 시각·duration·trim 기준이 바뀔 때 증가
- fingerprint: 파일명·크기·수정 시각·길이·선택적 edge hash
- timeBasis와 syncOffset revision
- lastCapabilitySnapshotId: 마지막으로 확정한 SourceCheck 결과

capability snapshot은 SourceDefinition에 연결되지만 sourceDefinitionId, 검사한 bindingId, bindingRevision, 브라우저 capability signature를 함께 가진다. 다른 기기·브라우저에서는 과거 snapshot을 지원 보장으로 재사용하지 않고 새 SourceCheck 전까지 참고 정보로만 취급한다.

SourceDefinition과 Segment의 타임코드·원본 URL·fingerprint는 프로젝트 JSON에 포함할 수 있다. 로컬 경로, File, Blob URL, FileSystemHandle, 권한 상태는 포함하지 않는다.

### 5.3 SourceBinding

SourceBinding은 현재 브라우저·기기에서 SourceDefinition을 실제 로컬 파일이나 일시적 player resource에 연결한 기기 로컬 자료다.

- bindingId, sourceDefinitionId
- lifecycle: active, replaced, removed
- availability: unknown, checking, available, degraded, permissionLost, missing, mismatch, unsupported
- bindingRevision: handle 재선택·권한 변화 때 증가
- sessionLocalRevision: Object URL·player instance 교체 때 증가
- fileSystemHandleRef 또는 이번 session의 File reference
- lastPermissionCheckAt와 permissionState
- 현재 기기에서만 유효한 capability·진단 참조

SourceBinding은 프로젝트 export에서 제외한다. 백업을 다른 기기에서 열면 SourceDefinition은 복원되지만 SourceBinding은 missing 상태로 새로 만들고 사용자에게 원본 재연결을 요청한다.

같은 fingerprint의 파일 권한만 다시 얻으면 새 bindingRevision으로 기존 SourceDefinition에 재연결할 수 있다. fingerprint가 다르면 기존 definition을 조용히 바꾸지 않는다.

사용자 선택지는 다음 둘이다.

- 원래 파일 찾기: 동일 fingerprint 검증 뒤 기존 SourceDefinition에 새 binding 연결
- 이 파일로 새 복사본 만들기: 새 sourceDefinitionId와 새 Project 또는 새 분석 계열 생성

분석 중 sourceTimelineRevision은 바꿀 수 없다. 재연결 파일이 동일하더라도 새로 확인된 duration이 달라지면 기존 run은 중단하고 새 AnalysisRun을 만든다. bindingRevision만 바뀌고 fingerprint·timeline이 같다면 정상 pause 안전 경계에서 같은 run의 reader를 다시 열 수 있다.

## 6. SourceCheck 생애주기

### 6.1 상태

| status | 의미 | 허용 사용자 행동 |
|---|---|---|
| created | SourceDefinition snapshot과 현재 SourceBinding을 검사할 요청 생성 | 취소 |
| checking | 메타데이터·탐색·샘플·코덱·저장 능력 검사 | 취소 |
| committing | capability 결과와 진단 저장 | 기다리기 |
| completed | 검사 결과 확정 | 분석 시작, 다시 검사 |
| cancelling | probe 중단과 임시 resource 해제 중 | 기다리기 |
| cancelled | 사용자 취소 확정 | 새 검사 |
| failed | 검사 자체가 예기치 않게 실패 | 다시 검사, 진단 받기 |
| interrupted | 탭·Worker 종료로 확인 없이 중단 | 새 검사 |

completed의 결과는 별도 resultKind로 표현한다.

- ready: 권장 AI 분석과 재생이 가능
- degraded: 일부 신호나 출력만 가능
- blocked: 이 소스로 핵심 분석을 시작할 수 없음

blocked는 SourceCheck 실패가 아니다. 링크만 있어 미디어 sample을 읽지 못하는 경우처럼 정상적으로 확인한 능력 결과다.

### 6.2 전이표

| 현재 status | 이벤트 | 다음 status | 저장·부작용 |
|---|---|---|---|
| created | CHECK_START_REQUESTED | checking | availability를 checking으로 표시 |
| checking | PROBE_PROGRESS | checking | 마지막으로 완료한 probe만 갱신 |
| checking | PROBES_FINISHED | committing | immutable capability snapshot 생성 |
| committing | CAPABILITY_SNAPSHOT_COMMITTED | completed | SourceDefinition 검사 결과에 snapshotId를 연결하고 SourceBinding availability 갱신 |
| created, checking | CANCEL_REQUESTED | cancelling | AbortController 취소, 새 probe 금지 |
| cancelling | PROBES_STOPPED | cancelled | 임시 decoder, Object URL, frame 해제 |
| checking, committing | CHECK_FATAL | failed | 이미 확정한 과거 snapshot은 유지 |
| created, checking, committing, cancelling | SESSION_LOST | interrupted | 다음 시작 때 임시 resource 정리 |
| completed, cancelled, failed, interrupted | RETRY_REQUESTED | 새 SourceCheck.created | 새 jobId, 이전 결과는 이력으로 보존 |

SourceCheck.completed는 다음 모두를 만족해야 한다.

1. 필수 probe 각각에 success, unsupported, timeout 중 하나가 기록되었다.
2. capability 값에 unknown이 남았다면 이유와 보수적 기본값이 있다.
3. SourceDefinition snapshot, SourceBinding bindingRevision, fingerprint와 duration 판독 결과가 저장되었다.
4. capability snapshot transaction이 commit되었다.
5. 현재 jobId가 SourceDefinition과 SourceBinding의 activeCheckJobId와 일치한다.
6. 로컬 handle·File·Blob URL이 capability snapshot이나 프로젝트 export에 들어가지 않았다.

## 7. ChatImport와 ChatSource 생애주기

### 7.1 ChatImport 상태

| status | 의미 |
|---|---|
| created | 파일·mapping 요청만 받은 상태 |
| parsing | JSONL·JSON·CSV를 streaming parse 중 |
| validating | 시각, 필드, 순서, 크기, 개인정보 설정 검증 중 |
| aligning | 영상 timeline에 맞출 초기 offset·anchor 계산 중 |
| previewReady | 적용 전 표본, gap, Before/After를 사용자가 확인하는 안전 경계 |
| committing | 임시 record와 aggregate를 최종 ChatSource로 원자 이동 중 |
| completed | ChatSource와 alignment revision이 확정됨 |
| cancelling | parser 중단과 임시 store 정리 중 |
| cancelled | 사용자 취소가 확정됨 |
| failed | 가져오기를 완료할 수 없음 |
| interrupted | 탭 종료 등으로 정상 종료하지 못함 |

### 7.2 전이표

| 현재 status | 이벤트 | 다음 status | 핵심 조건 |
|---|---|---|---|
| created | IMPORT_START_REQUESTED | parsing | 파일 handle과 privacy 선택 snapshot |
| parsing | PARSE_CHUNK_COMMITTED | parsing | seq, byte offset, 오류 개수 checkpoint |
| parsing | PARSE_FINISHED | validating | 원본 파일 전체를 메모리에 보관하지 않음 |
| validating | VALIDATION_PASSED | aligning | timestamp basis와 field mapping 확정 |
| validating | USER_MAPPING_REQUIRED | previewReady | 자동 추정값과 미해결 열을 표시 |
| aligning | ALIGNMENT_PREVIEW_BUILT | previewReady | raw time과 video time Before/After 생성 |
| previewReady | MAPPING_OR_ANCHOR_UPDATED | validating | 새 preview revision 생성, 기존 preview 보존 |
| previewReady | APPLY_REQUESTED | committing | previewRevision 고정, 버튼 중복 입력 차단 |
| committing | CHAT_SOURCE_COMMITTED | completed | ChatSource, aggregate, gap, privacy manifest 원자 저장 |
| created, parsing, validating, aligning, previewReady | CANCEL_REQUESTED | cancelling | 새 parse와 preview 쓰기 차단 |
| cancelling | TEMP_DATA_REMOVED | cancelled | job 전용 임시 store 정리 |
| parsing, validating, aligning, committing | IMPORT_FATAL | failed | 기존 ChatSource는 수정하지 않음 |
| 비종료 상태 | SESSION_LOST | interrupted | 다음 시작에서 job 임시 store 확인 |
| cancelled, failed, interrupted | RETRY_REQUESTED | 새 ChatImport.created | 새 jobId |

### 7.3 정렬 revision과 안전 경계

ChatSource가 completed된 뒤 시간 맞춤을 고치면 기존 aggregate를 제자리에서 덮어쓰지 않는다.

- ChatAlignmentRevision을 새로 만든다.
- Before/After 후보 시각과 영향을 받는 후보 수를 먼저 계산한다.
- 사용자가 적용하면 activeAlignmentRevisionId를 원자 전환한다.
- 기존 AnalysisRun은 시작 때 고정한 alignment revision을 계속 참조한다.
- 새 정렬을 AI 결과에 반영하려면 새 AnalysisRun을 시작한다.
- 이미 승인한 Segment의 사용자 경계는 이동하지 않는다.
- AI proposal에는 사용한 alignment revision을 기록한다.

completed 확정 조건:

- 파싱 오류율이 허용 범위 안이거나 사용자가 명시적으로 제한 자료 적용을 선택했다.
- 0건 정상 구간과 수집 gap이 구분되어 있다.
- timezone과 time basis가 확정되었다.
- 개인정보 manifest가 저장되었다.
- 원문 미보존이 기본값으로 적용되었다.
- 임시 store → 최종 store 이동과 ChatSource 생성이 한 transaction에서 끝났다.

### 7.4 선택형 LocalLiveCaptureRun의 위치

LocalLiveCaptureRun은 GitHub Pages 앱 안의 기능이 아니라 사용자가 자신의 컴퓨터에서 별도로 실행하는 선택형 CHZZK 로컬 수집기의 한 수집 시도다. 수집 결과인 append-only JSONL만 Pages 앱의 ChatImport로 가져온다.

허용 범위:

- 사용자가 소유하거나 공식 OAuth로 명시적으로 권한을 준 자신의 채널
- 사용자가 방송 전에 직접 시작한 실시간 CHAT, DONATION, SUBSCRIPTION 수집
- 로컬 디스크 JSONL과 로컬 run manifest

금지 범위:

- 여러 사용자를 위한 공용 수집 서비스
- 임의 공개 채널을 서버에서 상시 수집
- 과거 VOD 채팅을 복구한다고 주장
- Client Secret, access token, refresh token을 JSONL·프로젝트·진단 로그에 기록
- 수집기 credential을 GitHub Pages JavaScript에 전달

### 7.5 LocalLiveCaptureRun 중심 상태

| status | 의미 |
|---|---|
| starting | captureRunId, 대상 채널, 출력 파일, 권한 manifest 준비 |
| connecting | 공식 Session API socket 연결과 event 구독 확인 |
| running | event를 append-only JSONL로 기록 |
| stopping | event 수락 fence, socket 종료, flush, checksum, GAP, credential 정리 중 |
| completed | 방송의 자연 종료 또는 사용자가 정한 완료 조건으로 정상 종료 |
| stoppedByUser | 사용자가 중지했고 안전한 JSONL이 확정됨 |
| failed | 오류 종료지만 가능한 buffer·gap·진단을 안전하게 확정함 |
| interrupted | 프로세스 강제 종료 등으로 STOP_COMMITTED 없이 사라짐 |

연결 끊김은 실행 생애주기를 바로 끝내지 않는다. 다음을 보조 connectionState로 둔다.

- disconnected
- connecting
- connected
- reconnecting
- backoff
- authExpired

reconnecting 동안 LocalLiveCaptureRun.status는 running을 유지하고 열린 GAP을 기록한다.

### 7.6 시작·연결·재연결 전이표

| 현재 status | 이벤트 | 다음 status | 행동 |
|---|---|---|---|
| starting | RUN_MANIFEST_AND_FILE_OPENED | connecting | credential은 메모리에만 열고 JSONL META 기록 |
| connecting | SOCKET_CONNECTED | connecting | session id와 heartbeat 시작 |
| connecting | SUBSCRIPTIONS_CONFIRMED | running | CHAT·DONATION·SUBSCRIPTION별 실제 구독 결과 기록 |
| connecting | CONNECT_FATAL | stopping | terminalIntent failed, 출력 안전 종료 시도 |
| running | EVENT_RECEIVED | running | seq 부여, runtime schema 검증, buffer append |
| running | FLUSH_INTERVAL_ELAPSED | running | 기본 5~10초마다 durable flush |
| running | SOCKET_DISCONNECTED | running | connectionState reconnecting, GAP 시작 record |
| running | RECONNECT_SUCCEEDED | running | GAP 종료 record, connectionState connected |
| running | RECONNECT_BACKOFF | running | 다음 시도 시각과 누락 지속 시간을 UI·manifest에 표시 |
| running | AUTH_EXPIRED | running 또는 stopping | 갱신 가능하면 메모리 credential 갱신, 불가능하면 terminalIntent failed |

event에 공식 message id가 없으면 local seq와 content hash를 사용한 best-effort dedupe만 한다. 재연결 뒤 중복 가능성을 숨기지 않는다.

### 7.7 종료 요청·진행·확정

| 현재 status | 이벤트 | 다음 status | 행동 |
|---|---|---|---|
| running, connecting | STOP_REQUESTED | stopping | terminalIntent stoppedByUser, 즉시 새 event 수락 fence |
| running | BROADCAST_END_CONFIRMED | stopping | terminalIntent completed |
| starting, connecting, running | CAPTURE_FATAL | stopping | terminalIntent failed, 가능한 자료 보존 |
| stopping | EVENT_ACCEPTANCE_FENCED | stopping | socket callback이 새 record를 쓰지 못함 |
| stopping | SOCKET_CLOSED | stopping | heartbeat·reconnect timer 종료 |
| stopping | PENDING_BUFFER_FLUSHED | stopping | fsync 가능한 범위에서 file stream flush |
| stopping | OPEN_GAPS_FINALIZED | stopping | 미종료 disconnect를 마지막 GAP으로 닫음 |
| stopping | CHECKSUM_AND_META_WRITTEN | stopping | seq 범위, capture coverage, byte length, checksum 기록 |
| stopping | CREDENTIALS_CLEARED | stopping | token·secret 메모리 참조 제거, 로그 redaction 확인 |
| stopping | STOP_COMMITTED + terminalIntent completed | completed | run manifest와 file close 재검증 |
| stopping | STOP_COMMITTED + terminalIntent stoppedByUser | stoppedByUser | 사용자 중지 결과 확정 |
| stopping | STOP_COMMITTED + terminalIntent failed | failed | 부분 자료·failure reason 확정 |
| 비종료 상태 | PROCESS_LOST_WITHOUT_STOP_COMMIT | interrupted | 다음 실행에서 partial JSONL recovery audit |

STOP_REQUESTED는 성공이 아니다. STOP_COMMITTED는 다음 조건을 모두 만족할 때만 발생한다.

1. event acceptance fence가 증가해 늦은 socket callback이 쓰지 못한다.
2. socket과 reconnect timer가 닫혔다.
3. 마지막 in-memory buffer가 디스크에 flush되었다.
4. 열려 있던 GAP이 끝 시각과 이유를 갖는다.
5. JSONL 마지막 META에 seq 범위, coverage, gap 수, byte length, checksum이 있다.
6. 파일 stream close가 성공했다.
7. access token·refresh token·Client Secret의 메모리 참조와 임시 인증 파일 handle이 정리되었다.
8. terminal status와 stop reason을 가진 run manifest가 commit되었다.

### 7.8 수집기 interruption 복구

interrupted 파일을 completed로 바꾸지 않는다. 로컬 수집기의 별도 recovery audit가 다음을 수행한다.

- 마지막 완전한 JSONL 줄까지 streaming scan
- 잘린 마지막 줄 격리
- seq 누락·중복·마지막 flush 시각 확인
- 알려진 disconnect부터 파일 끝까지 GAP 추가 제안
- 새 recovery checksum과 salvagedFromCaptureRunId 기록

복구한 파일은 recoveredPartial 배지를 가진 새 artifact이며 원래 LocalLiveCaptureRun은 interrupted로 남는다. Pages ChatImport는 이 파일을 가져올 수 있지만 미확정 끝 구간을 gap으로 처리한다.

### 7.9 수집기 불변식

- captureRunId당 출력 stream은 최대 하나다.
- 같은 authorized channel·liveId에 이 수집기 instance의 active run은 최대 하나다.
- JSONL seq는 run 안에서 단조 증가한다.
- flush가 확인되지 않은 event를 durable coverage로 계산하지 않는다.
- STOP_COMMITTED 뒤 socket event는 0개가 저장된다.
- completed와 stoppedByUser는 checksum·file close·credential cleanup을 요구한다.
- credential과 닉네임 기본 원문은 진단 로그·프로젝트 export에 들어가지 않는다.
- interrupted를 completed 또는 stoppedByUser로 승격하지 않는다.
- Pages 앱은 수집기 process를 원격 제어하거나 credential을 보관하지 않는다.

## 8. ModelArtifact와 ModelDownload 생애주기

### 8.1 ModelArtifact 보조 상태

ModelArtifact는 id + immutable revision + dtype + 파일 hash로 식별한다.

- availability: missing, downloading, cached, evicted, corrupt
- verification: unverified, verifying, verified, mismatch
- retention: inUse, deletable, deleteDeferred

모델을 사용하는 AnalysisRun이 하나라도 active이면 삭제 요청은 deleteDeferred가 된다. 실행이 모델 handle을 해제한 뒤 삭제한다.

### 8.2 ModelDownload 상태와 전이

| 현재 status | 이벤트 | 다음 status | 확정 조건 또는 행동 |
|---|---|---|---|
| created | USER_CONFIRMED_DOWNLOAD | queued | manifest 크기·출처·revision snapshot |
| queued | SLOT_GRANTED | downloading | 같은 artifact 중복 다운로드 금지 |
| downloading | DOWNLOAD_PROGRESS | downloading | 받은 byte와 전체 byte, 재시작 가능 정보 저장 |
| downloading | ALL_FILES_RECEIVED | verifying | 임시 cache entry만 사용 |
| verifying | HASHES_MATCHED | committing | manifest 전체 hash 검증 |
| committing | CACHE_INDEX_COMMITTED | completed | verified cache entry와 manifest 원자 연결 |
| created, queued, downloading, verifying | CANCEL_REQUESTED | cancelling | fetch abort, 새 파일 요청 차단 |
| cancelling | TEMP_CACHE_REMOVED | cancelled | 불완전 entry 삭제 |
| queued, downloading, verifying, committing | DOWNLOAD_FATAL | failed | artifact availability를 missing 또는 corrupt로 설정 |
| 비종료 상태 | SESSION_LOST | interrupted | 다음 시작에 불완전 cache sweep |
| cancelled, failed, interrupted | RETRY_REQUESTED | 새 ModelDownload.created | 새 jobId |

ModelDownload.completed는 Cache API가 응답했다는 사실만으로 확정하지 않는다.

1. manifest의 모든 파일이 있다.
2. 각 파일의 byte length가 일치한다.
3. 요구한 hash가 모두 일치한다.
4. 실제 ONNX session을 만드는 smoke test가 통과하거나 별도 compatibility 결과가 기록된다.
5. cache index commit 뒤 다시 읽기 검증이 성공한다.

다운로드 실패 시 AnalysisRun은 자동으로 성공한 척하지 않는다. 사용자가 선택한 정책에 따라 작은 모델 재시도 또는 signals-only 새 run을 만든다.

## 9. AnalysisJob, AnalysisSpec, AnalysisRun 생애주기

### 9.1 AnalysisJob과 AnalysisSpec

AnalysisJob은 화면에서 사용자가 보는 한 분석 작업과 그 실행 이력을 묶는 영구 항목이고, AnalysisSpec은 그 작업의 특정 입력·설정 조합을 고정한 immutable 명세다. AnalysisRun은 정확히 하나의 AnalysisJob과 하나의 AnalysisSpec을 참조하는 실제 실행 시도다.

AnalysisSpec은 다음 입력을 고정한다.

- sourceDefinitionId, source fingerprint, timeline revision
- chatSourceId와 alignment revision
- caption revision
- 분석 mode와 candidate budget
- model manifest와 runtime 정책
- score version, feature schema version
- privacy와 원문 사용 범위

설정 하나라도 달라지면 같은 AnalysisJob 안에 새 AnalysisSpec을 만든다. 정상 pause 뒤 같은 AppSession에서 동일 spec을 이어갈 때는 같은 AnalysisRun을 resuming으로 전이한다. 새로고침·브라우저 종료·Worker crash·failed 재시도에서는 동일 spec이라도 새 AnalysisRun이 checkpoint를 이어받고 resumedFromRunId를 기록한다.

### 9.2 AnalysisRun 중심 상태

| status | 의미 | 허용 사용자 행동 |
|---|---|---|
| created | runId와 manifest가 생성됨 | 시작 취소 |
| starting | 저장소, Worker, 모델 handle, source reader 준비 | 취소 |
| running | stage에 따른 청크 처리 | 일시정지, 취소, 후보 검토 |
| pausing | 새 청크 배정 중단, 활성 청크 안전 중지 | 기다리기, 강제 중단 |
| paused | Worker가 멈추고 checkpoint가 확정됨 | 같은 실행 이어 하기, 취소 |
| resuming | 같은 runId에서 새 Worker 세대와 task를 준비 | 취소 |
| awaitingGapDecision | 계획 범위 중 분석하지 못한 구간의 처리 결정을 기다림 | 해당 구간 재시도, 제한 결과 승인, 취소 |
| finalizing | ranking, coverage, manifest를 최종 commit 중 | 기다리기 |
| completing | Worker 해제와 완료 record 재검증 중 | 기다리기 |
| completed | 계획 범위 전체가 정상 coverage로 원자 확정됨 | 후보 검토, 새 분석 |
| completedWithGaps | 모든 누락 구간이 명시적으로 설명·승인된 제한 결과 | 누락 구간 보기, 후보 검토, 새 분석 |
| cancelling | 실행 fence, Worker 종료, 종료 record 저장 중 | 기다리기 |
| cancelled | 사용자 취소 확정 | 부분 결과 보기, 새 분석 |
| failing | fatal 정보와 안전한 부분 결과 commit 중 | 기다리기 |
| failed | 오류 종료 확정 | 부분 결과 보기, 새 분석 |
| interrupted | 정상 ACK 없이 실행 주체가 사라짐 | checkpoint에서 새 run |

stage는 status와 별도다.

- preflight
- benchmark
- prepareModels
- fastPass
- seedClustering
- deepPass
- boundary
- ranking

runtimeTier, progress, plannedIntervals, coveredIntervals, failedIntervals, acceptedSkippedIntervals, acceptedFailedIntervals, hasPartialResult, activeChunkIds, workerEpoch, completionTarget도 보조 필드다.

### 9.3 정상 전이표

| 현재 status | 이벤트 | 다음 status | 확정 조건 |
|---|---|---|---|
| created | RUN_START_REQUESTED | starting | writer lock과 active run slot 확보 |
| starting | RUN_MANIFEST_COMMITTED | running | 입력 서명·모델·workerEpoch·Worker instance 저장 |
| running | STAGE_ADVANCED | running | 앞 stage의 필수 checkpoint commit |
| running | CHUNK_RESULT_READY | running | 결과는 아직 임시 |
| running | CHUNK_COMMIT_SUCCEEDED | running | coverage와 후보 proposal 공개 가능 |
| running | ALL_PLANNED_INTERVALS_COVERED | finalizing | 활성 청크 0개, completionTarget completed |
| running | UNRESOLVED_GAPS_FOUND | awaitingGapDecision | 실패·건너뜀 구간과 이유·영향 저장 |
| awaitingGapDecision | RETRY_GAPS_REQUESTED | running | 같은 runId, 새 taskId·chunkAttempt으로 선택 구간 재시도 |
| awaitingGapDecision | GAPS_ACCEPTED_BY_USER | finalizing | 모든 gap을 accepted 집합으로 옮기고 completionTarget completedWithGaps |
| awaitingGapDecision | GAPS_ACCEPTED_BY_EXPLICIT_POLICY | finalizing | 시작 전 명시된 정책과 UI 고지가 있는 경우만 허용 |
| finalizing | FINAL_RESULT_COMMITTED | completing | proposals, ranking, coverage, manifest 원자 저장 |
| completing | FULL_RESULT_REOPEN_VERIFIED | completed | plannedIntervals와 coveredIntervals가 동일 |
| completing | GAPPED_RESULT_REOPEN_VERIFIED | completedWithGaps | planned 범위가 covered + accepted gap으로 완전히 설명됨 |

분석 완료 UI는 FINAL_RESULT_COMMITTED 전에는 표시하지 않는다. completing 중에는 “결과를 안전하게 정리하는 중”으로 표시한다. 실패 interval이 남아 있다는 이유만으로 completedWithGaps가 되지 않으며, 사용자 또는 시작 전 명시 정책의 승인 record가 있어야 한다.

### 9.4 일시정지·재개 전이표

| 현재 status | 이벤트 | 다음 status | 행동 |
|---|---|---|---|
| running | PAUSE_REQUESTED | pausing | 새 청크 배정 중단, Worker에 pause/abort 전달 |
| pausing | ACTIVE_CHUNKS_CHECKPOINTED | pausing | 완료 가능 결과만 transaction commit |
| pausing | ALL_WORKERS_PAUSED_ACK | pausing | worker heartbeat 정지 확인 |
| pausing | PAUSE_RECORD_COMMITTED | paused | 재개 가능한 checkpoint manifest 저장 |
| pausing | PAUSE_TIMEOUT | interrupted | Worker terminate, workerEpoch fence, 마지막 확정 checkpoint만 신뢰 |
| paused | RESUME_REQUESTED_SAME_SESSION | resuming | input/config/model snapshot 일치 검증 |
| resuming | NEW_WORKER_EPOCH_COMMITTED | running | 같은 runId, workerEpoch 증가, 새 workerInstanceId·taskId 발급 |
| paused | SESSION_WILL_END | interrupted | checkpoint는 보존하고 다음 session 재개는 새 run으로 제한 |
| paused | RESUME_WITH_CHANGED_SNAPSHOT | cancelling | 기존 run을 fence·cancel 확정한 뒤 새 AnalysisSpec·새 run 생성 |

같은 runId 정상 재개는 PAUSE_RECORD_COMMITTED 뒤 같은 AppSession, 동일 writerEpoch 소유, 동일 AnalysisSpec, 동일 model manifest일 때만 허용한다. 입력·설정·모델이 달라지면 기존 paused run을 cancelled로 fence하고, session·Worker가 사라졌으면 interrupted, 처리 오류면 failed 이력으로 남긴 뒤 새 runId를 만든다.

### 9.5 취소·실패·중단 전이표

| 현재 status | 이벤트 | 다음 status | 행동 |
|---|---|---|---|
| created, starting, running, pausing, paused, resuming, awaitingGapDecision, finalizing | CANCEL_REQUESTED | cancelling | run 쓰기 fence 증가, 새 청크와 proposal 차단 |
| cancelling | WORKERS_TERMINATED | cancelling | 임시 frame, PCM, Object URL 해제 |
| cancelling | CANCELLATION_COMMITTED | cancelled | 부분 결과와 cancellation reason 보존 |
| starting, running, pausing, resuming, awaitingGapDecision, finalizing, completing | FATAL_ERROR | failing | 새 결과 차단, 진단과 부분 coverage 수집 |
| failing | FAILURE_RECORD_COMMITTED | failed | 복구 행동과 safe checkpoint 기록 |
| 비종료 상태 | SESSION_LOST | interrupted | 다음 AppSession이 journal을 보고 확정 |
| interrupted | RECOVERY_AUDIT_COMPLETED | interrupted | 호환 checkpoint와 orphan 임시 자료 표시 |
| cancelled, failed, interrupted | CONTINUE_FROM_CHECKPOINT | 새 AnalysisRun.created | 새 runId, resumedFromRunId, 새 workerEpoch, 이전 run 결과 읽기 전용 |

cancelled 확정에는 모든 임시 캐시 삭제까지 기다리지 않아도 된다. 다만 다음 두 조건은 필수다.

- 이전 run이 영구 결과 store에 더 쓸 수 없도록 run fence가 commit되었다.
- Worker가 종료되었거나 현재 session·writer epoch가 무효화되었다.

청소 상태는 cleanupState: pending, running, complete, failed로 별도 관리하고 재시도한다.

### 9.6 부분 결과 공개 규칙

- 후보는 CHUNK_COMMIT_SUCCEEDED 뒤에만 화면에 나타난다.
- 후보 카드에는 아직 완료되지 않은 분석 stage를 표시한다.
- final ranking 전 목록은 provisionalRankingRevision을 가진다.
- 사용자가 보고 있는 카드의 위치는 새 후보 도착으로 갑자기 바꾸지 않는다.
- 현재 카드 검토가 끝나거나 사용자가 “새 추천 순서 적용”을 누를 때 ranking revision을 전환한다.
- AnalysisRun이 cancelled, failed, interrupted여도 commit된 CandidateProposal과 coverage는 유지한다.
- failed interval을 0점 구간으로 취급하지 않는다. 미분석으로 표시한다.

### 9.7 분석 실행 불변식

- 프로젝트당 쓰기 가능한 AnalysisRun은 최대 하나다.
- runId당 completed 또는 completedWithGaps 확정 이벤트는 합쳐서 최대 한 번이다.
- activeChunkIds의 한 chunkId에는 같은 시점에 한 chunkAttempt만 쓸 수 있다.
- coveredIntervals와 failedIntervals는 동일 run·stage에서 겹치지 않는다.
- progress는 commit된 coverage만 반영하며 감소하지 않는다.
- completed에는 activeChunkIds가 없고 plannedIntervals 전체가 coveredIntervals로 설명된다.
- completedWithGaps에는 activeChunkIds가 없고 plannedIntervals 전체가 coveredIntervals, acceptedSkippedIntervals, acceptedFailedIntervals의 서로 겹치지 않는 합집합으로 설명되며 각 accepted gap에 승인 주체와 이유가 있다.
- 입력 서명 불일치 run은 checkpoint를 쓰지 못한다.
- 이전 run의 이벤트는 새 run의 Segment나 proposal을 직접 수정하지 못한다.
- AI 결과는 사용자 revision을 덮어쓰지 않는다.

## 10. CandidateProposal과 Segment revision 병합

### 10.1 두 데이터를 분리하는 이유

CandidateProposal은 AI가 한 제안이고 Segment는 사용자의 편집 결과다. AI fast pass의 제안과 나중 deep pass 제안을 같은 Segment.revision에 직접 쓰면 사용자가 먼저 수정한 경계가 사라질 수 있다.

권장 구조:

    type CandidateProposal = {
      proposalId: string;
      candidateGroupId: string;
      segmentId: string;
      analysisRunId: string;
      proposalRevision: number;
      supersedesProposalId?: string;
      basedOnUserRevision: number;
      suggestedRange: { startMs: number; endMs: number };
      suggestedTitle: string;
      evidence: CandidateEvidence[];
      score: number;
      rankingRevision: number;
      createdAt: string;
    };

    type Segment = {
      id: string;
      projectId: string;
      sourceDefinitionId: string;
      recordState: "active" | "trashed";
      reviewState: "unreviewed" | "inReview" | "approved" | "rejected" | "needsWork";
      userRevision: number;
      range: { startMs: number; endMs: number };
      title: string;
      note: string;
      tags: string[];
      fieldOwners: {
        range: "ai" | "user";
        title: "ai" | "user";
      };
      adoptedProposalId?: string;
      approvedRevision?: number;
      updatedAt: string;
    };

CandidateProposal은 append-only다. 잘못된 제안을 수정할 때도 기존 row를 덮어쓰지 않고 supersedesProposalId를 가진 새 proposal을 만든다.

### 10.2 AI 제안 자동 반영 조건

새 AI proposal이 Segment 표시값에 자동 반영될 수 있는 조건은 모두 만족해야 한다.

1. reviewState가 unreviewed다.
2. userRevision이 0이거나 해당 fieldOwner가 ai다.
3. 사용자가 그 후보 편집 폼을 현재 열고 있지 않다.
4. 사용자가 현재 재생 중인 proposal revision을 고정하지 않았다.
5. Segment가 rejected 또는 trashed가 아니다.
6. proposal.analysisRunId가 현재 허용된 분석 계열에 속한다.
7. proposal.basedOnUserRevision이 현재 userRevision과 일치한다.

조건이 하나라도 맞지 않으면 자동 반영하지 않고 “더 자세한 AI 제안이 도착했어요”로 비교 선택만 제공한다.

### 10.3 필드별 소유권

| 필드 | AI가 할 수 있는 일 | 사람이 한 번 수정한 뒤 | 승인 뒤 |
|---|---|---|---|
| 시작·끝 | 새 suggestedRange proposal | 자동 덮어쓰기 금지, Before/After 제안만 | 자동 변경 절대 금지 |
| 제목 | 새 suggestedTitle proposal | 대안 제목으로만 표시 | 자동 변경 절대 금지 |
| note | 기본적으로 쓰지 않음 | 사람 전용 | 사람 전용 |
| tags | 제안 tag를 별도 표시 | 사용자가 적용한 tag는 보존 | 사람 전용 |
| reviewState | 변경 금지 | 사람만 변경 | 사람만 변경 |
| evidence | 새 proposal에 append | 언제든 새 근거 표시 가능 | 승인값을 바꾸지 않고 근거만 보강 |
| score·rank | 새 ranking revision 생성 | 현재 검토 순서 몰래 변경 금지 | 승인 여부와 무관 |
| duplicate | 합치기 제안 | 자동 병합 금지 | 사용자 확인과 실행 취소 필요 |
| platformClipUrl | 변경 금지 | 사람 전용 | 사람 전용 |

사용자가 시작·끝 조절 버튼을 한 번 누르는 즉시 range owner는 user가 된다. 다시 AI 범위를 쓰고 싶다면 “AI 제안으로 되돌리기”를 명시적으로 눌러 새 userRevision으로 채택한다.

### 10.4 승인과 제외

- 사용할게요는 현재 표시 range와 title을 한 transaction에서 저장하고 approvedRevision을 고정한다.
- 빼기는 reviewState를 rejected로 바꾸며 AI가 새 proposal을 보내도 되살리지 않는다.
- 다시 검토는 사람이 직접 unreviewed로 되돌리는 새 userRevision이다.
- 삭제는 recordState를 trashed로 바꾸며 실행 취소 기간 전 영구 삭제하지 않는다.
- 승인 뒤 경계를 수정하면 reviewState를 approved로 유지할지 needsWork로 돌릴지 제품 규칙을 고정해야 한다. 초심자 기본값은 approved 유지 + “승인 후 수정됨” 배지이며, 실제 렌더 snapshot은 최신 저장 revision만 사용한다.

### 10.5 동시 도착 예시

정상 처리:

1. fast proposal P1이 start 100초, end 145초로 저장된다.
2. 사용자가 start를 97초로 바꾸고 userRevision 1, range owner user로 commit한다.
3. deep proposal P2가 start 94초, end 151초로 도착한다. P2.basedOnUserRevision은 0이다.
4. 현재 userRevision 1과 다르므로 P2는 자동 반영되지 않는다.
5. UI는 97–145초 유지, 비교 카드에는 AI 새 제안 94–151초 표시.
6. 사용자가 적용하면 userRevision 2로 저장하고 adoptedProposalId를 P2로 바꾼다.

금지 처리:

- P2가 Segment.range를 직접 UPDATE
- P2 도착 뒤 approved를 unreviewed로 변경
- P2 score가 높다는 이유로 rejected Segment 복원
- 현재 보고 있는 카드가 목록에서 자동 이동

## 11. RangeCapture 생애주기

RangeCapture는 AI 누락 보완용 직접 기록이다. instant는 현재 시각을 중심으로 기본 45초를 만드는 한 번 동작이고 long은 시작과 끝을 두 번 지정한다.

### 11.1 상태

| status | 의미 |
|---|---|
| created | captureId와 source timeline snapshot 생성 |
| capturing | long range의 시작 시각을 확정하고 끝을 기다림 |
| ending | 플레이어에서 끝 시각 확인 중 |
| awaitingResolution | 끝이 시작보다 앞이거나 source time을 읽지 못해 사용자 선택 필요 |
| committing | Segment와 capture 완료 record를 원자 저장 중 |
| completed | Segment 생성 확정 |
| cancelling | 활성 capture 취소와 저장 정리 중 |
| cancelled | 취소 확정 |
| failed | 유효한 Segment를 만들지 못함 |
| interrupted | 새로고침 등으로 활성 capture callback이 사라짐 |

### 11.2 전이표

| 현재 status | 이벤트 | 다음 status | 핵심 행동 |
|---|---|---|---|
| created | INSTANT_TIME_CONFIRMED | committing | anchor -20초, +25초를 원본 범위에 clamp |
| created | LONG_START_TIME_CONFIRMED | capturing | startMs와 sourceTimelineRevision 즉시 저장 |
| capturing | RANGE_END_REQUESTED | ending | 현재 player time 비동기 요청 |
| ending | VALID_END_RECEIVED | committing | endMs >= startMs 검증 |
| ending | END_BEFORE_START | awaitingResolution | 자동 뒤집기 금지 |
| ending | SOURCE_TIME_UNAVAILABLE | awaitingResolution | 직접 시각 입력 또는 취소 |
| awaitingResolution | USER_END_TIME_CONFIRMED | committing | Before/After와 최종 길이 표시 |
| committing | SEGMENT_AND_CAPTURE_COMMITTED | completed | Segment origin manual, userRevision 1 |
| created, capturing, ending, awaitingResolution | CANCEL_REQUESTED | cancelling | 이후 player callback fence |
| cancelling | CANCELLATION_COMMITTED | cancelled | 시작 시각은 이력 또는 undo 기간까지만 보존 |
| 비종료 상태 | SESSION_LOST | interrupted | startMs는 잃지 않음 |
| interrupted | CONTINUE_CAPTURE_REQUESTED | 새 RangeCapture.created | 새 captureId와 resumedFromCaptureId, 저장된 startMs·timeline snapshot을 명시적으로 이어받음 |
| interrupted | DISCARD_CAPTURE_REQUESTED | interrupted | 원래 terminal은 유지하고 별도 SaveCommit으로 recordDisposition discarded 저장 |

### 11.3 불변식

- 프로젝트당 nonterminal RangeCapture는 최대 하나다.
- media time 응답에는 sourceDefinitionId, sourceTimelineRevision, captureAttemptId가 일치해야 한다.
- long capture의 endMs를 탭 종료 시각으로 자동 생성하지 않는다.
- instant와 long 모두 startMs >= 0, endMs <= durationMs를 저장 경계에서 검증한다.
- clamp가 일어나면 silent mutation이 아니라 adjustmentReason을 저장하고 UI에 알린다.
- completed 토스트는 Segment transaction commit 뒤에만 표시한다.
- 버튼 연타 eventId는 dedupe하며 같은 의도로 Segment 여러 개를 만들지 않는다.
- 실행 취소는 Segment를 영구 삭제하지 않고 새 revision으로 trashed 처리한다.

## 12. 저장 생애주기

### 12.1 SaveCoordinator와 SaveCommit 분리

SaveCoordinator는 현재 화면 편집의 내구성 상태다.

- clean: 최신 편집 generation까지 commit됨
- dirty: 저장되지 않은 변경이 있음
- saving: 하나의 SaveCommit이 실행 중
- blocked: 반복 저장 실패 또는 DB 사용 불가

SaveCommit은 한 generation snapshot을 쓰는 한 번의 시도다.

- created
- writing
- verifying
- committed
- failed

### 12.2 전이표

| Coordinator | 이벤트 | Coordinator 다음 | SaveCommit 전이 |
|---|---|---|---|
| clean | EDIT_APPLIED | dirty | 없음 |
| dirty | SAVE_DEBOUNCE_ELAPSED | saving | 새 commitId.created |
| dirty | IMMEDIATE_SAVE_REQUIRED | saving | 새 commitId.created |
| saving | TRANSACTION_STARTED | saving | created → writing |
| saving | TRANSACTION_COMMITTED | saving | writing → verifying |
| saving | REOPEN_READ_MATCHED | clean 또는 dirty | verifying → committed |
| saving | SAVE_FAILED | dirty 또는 blocked | writing/verifying → failed |
| blocked | RETRY_SAVE_REQUESTED | saving | 새 commitId |

TRANSACTION_COMMITTED 뒤 새 편집 generation이 있다면 Coordinator는 clean이 아니라 dirty로 돌아가 즉시 다음 SaveCommit을 예약한다.

### 12.3 저장 generation과 CAS

각 프로젝트 쓰기는 다음 값을 가진다.

- editGeneration: 메모리에서 편집할 때마다 증가
- committedGeneration: IndexedDB 검증이 끝난 마지막 generation
- projectRevision: 원자 commit마다 증가
- baseProjectRevision: 쓰기가 시작할 때 기대한 revision
- writerEpoch: 현재 탭의 쓰기 fence

저장 transaction은 baseProjectRevision과 writerEpoch가 현재 값과 같을 때만 commit한다. 다르면 stale_write로 거부하고 최신 DB 값을 다시 읽는다.

### 12.4 낙관적 화면과 내구성 표시

편집 결과는 빠른 조작감을 위해 즉시 화면에 보일 수 있다. 다만 화면은 저장 사실을 구분한다.

- dirty: “변경됨 · 저장 대기”
- saving: “저장 중…”
- committed: “이 브라우저에 저장됨 · 방금”
- blocked: 닫히지 않는 “저장하지 못했어요” 배너

“저장됨”은 verifying → committed 뒤에만 표시한다. 저장 실패 때 편집 화면을 이전 값으로 몰래 되돌리지 않는다.

blocked 배너는 다음 행동을 제공한다.

- 다시 저장
- 저장 공간 정리 안내
- 현재 메모리 편집을 포함한 긴급 JSON 받기
- 마지막 확정본 JSON 받기

두 JSON은 파일명과 안내에서 구분한다. 긴급 JSON은 아직 DB에 확정되지 않은 값이 포함될 수 있다는 manifest를 가진다.

### 12.5 저장 불변식

- 프로젝트당 동시에 writing인 SaveCommit은 최대 하나다.
- committedGeneration은 감소하지 않는다.
- SaveCommit 하나는 committed 또는 failed 중 하나로 한 번만 끝난다.
- Segment userRevision과 projectRevision은 같은 transaction에서 증가한다.
- 완료 UI는 재읽기 검증 뒤에만 표시한다.
- 텍스트 debounce 중 다른 즉시 저장 이벤트가 오면 더 최신 generation을 합치되 사용자 행동을 잃지 않는다.
- beforeunload 경고는 dirty, saving, blocked 또는 비종료 작업이 있을 때만 표시한다.
- BroadcastChannel 메시지는 저장 완료의 진실 공급원이 아니다. IndexedDB commit만 진실 공급원이다.

## 13. MigrationRun 생애주기

MigrationRun은 IndexedDB schemaVersion 또는 프로젝트 schemaVersion을 바꾸는 한 번의 시도다. migration 중 앱은 일반 쓰기를 허용하지 않는다.

### 13.1 상태

| status | 의미 |
|---|---|
| created | fromVersion, toVersion, appVersion과 migration plan 고정 |
| backingUp | 복구용 snapshot을 별도 backup store에 생성 |
| migrating | versionchange transaction 또는 project 변환 실행 |
| validating | 새 schema의 불변식과 표본 왕복 검증 |
| committing | migration journal과 active schema pointer 확정 |
| completed | 새 schema 재열기 검증까지 성공 |
| rollingBack | 실패 뒤 이전 snapshot 복구 중 |
| rolledBack | 이전 schema로 안전 복귀 |
| failedLocked | 자동 복구도 실패해 읽기 전용 복구 화면만 허용 |
| recoveryPending | 탭 종료 뒤 journal audit가 끝나지 않아 commit 여부가 아직 불명 |

### 13.2 전이표

| 현재 status | 이벤트 | 다음 status | 행동 |
|---|---|---|---|
| created | MIGRATION_START_REQUESTED | backingUp | writer lock 독점, 모든 일반 쓰기 차단 |
| backingUp | BACKUP_VERIFIED | migrating | backup id와 checksum journal 저장 |
| migrating | TRANSFORM_COMMITTED | validating | 변환 완료 marker 기록 |
| validating | VALIDATION_PASSED | committing | count, FK, time range, unknown field 보존 검사 |
| committing | SCHEMA_POINTER_COMMITTED | completed | DB 닫고 새 version으로 재열기 검증 |
| backingUp, migrating, validating, committing | MIGRATION_FATAL | rollingBack | 일반 화면 진입 금지 |
| rollingBack | ROLLBACK_VERIFIED | rolledBack | 이전 앱과 호환 가능한 schema 복원 |
| rollingBack | ROLLBACK_FAILED | failedLocked | 복구 JSON 다운로드만 허용 |
| 비종료 상태 | SESSION_LOST | recoveryPending | 다음 시작에서 journal audit 전 일반 쓰기 차단 |
| recoveryPending | COMMIT_MARKER_AND_SCHEMA_VALID | completed | 실제 commit이 이미 끝난 경우 |
| recoveryPending | BACKUP_VALID_AND_TARGET_INVALID | rollingBack | 안전 복구 |

### 13.3 migration 규칙

- migration step은 fromVersion, toVersion, stepId로 멱등이어야 한다.
- major/minor schema 단계를 건너뛰지 않고 순서대로 적용한다.
- 미래 unknown field는 가능한 한 그대로 보존한다.
- 이전 앱이 더 최신 schema를 열면 쓰기 없이 “더 최신 버전에서 만든 프로젝트”로 안전 실패한다.
- service worker 새 앱 적용은 저장 완료와 active job 종료 뒤 사용자가 승인할 때만 한다.
- migration 완료 애니메이션은 active schema pointer commit 뒤 시작한다.
- backup은 migration 성공 직후 즉시 지우지 않고 최소 한 번의 정상 앱 시작과 사용자 백업 기회를 지난 뒤 정리한다.
- 용량 부족으로 backup을 만들 수 없으면 migration을 시작하지 않는다.

### 13.4 migration 검증 항목

- Project, SourceDefinition, ChatSource, Segment, AnalysisRun count
- 모든 Segment의 startMs <= endMs
- 모든 AI proposal의 analysisRunId 참조
- 모든 approved Segment의 approvedRevision 존재
- alignment revision 참조 유효성
- completed run의 activeChunkIds가 비어 있음
- migration 전후 export → import 의미 동등성
- 악성·손상 row가 다른 정상 프로젝트 migration을 막지 않는 격리

## 14. RenderBatch와 RenderItem 생애주기

### 14.1 출력 snapshot

RenderBatch를 시작할 때 다음을 immutable snapshot으로 고정한다.

- projectRevision
- sourceDefinitionId, fingerprint, timeline revision
- 각 Segment의 segmentId, userRevision, startMs, endMs, title
- render mode, 목표 container·codec·해상도·fps
- 출력 파일명
- 사전 검사 capability snapshot

렌더 중 Segment를 편집해도 실행 중 batch 입력은 바뀌지 않는다. 편집 자체를 막을 필요는 없지만 UI에 “지금 만드는 파일에는 출력 시작 당시의 구간이 사용돼요”라고 표시하고, 수정본은 새 batch에서 출력한다.

### 14.2 RenderBatch 상태

| status | 의미 |
|---|---|
| created | 출력 snapshot 생성 |
| preflighting | 원본 권한·코덱·공간·파일명·짧은 테스트 검사 |
| awaitingDestination | 저장 폴더 또는 다운로드 방식을 사용자가 선택하는 중 |
| queued | item 큐가 확정되고 Worker 시작을 기다림 |
| running | item을 한 번에 하나씩 처리 |
| finalizing | 큐 결과, 정리표, cleanup 상태를 commit |
| completed | 큐 처리가 정상 종료됨 |
| cancelling | 현재 item 중단과 이후 item fence 중 |
| cancelled | 사용자 취소 확정 |
| failing | batch 자체 오류 결과 commit 중 |
| failed | batch 기반 작업을 시작·계속할 수 없음 |
| interrupted | 탭 종료로 정상 종료되지 못함 |

completed의 resultKind:

- allSucceeded
- partialSuccess: 일부 item은 성공, 일부 item은 실패
- allSkipped: 사전 검사 결과 만들 수 있는 item이 없었지만 안전하게 종료

### 14.3 RenderBatch 전이표

| 현재 status | 이벤트 | 다음 status | 확정 조건 |
|---|---|---|---|
| created | RENDER_PREFLIGHT_REQUESTED | preflighting | source와 segment snapshot 저장 |
| preflighting | PREFLIGHT_PASSED | awaitingDestination | item별 output plan 확정 |
| awaitingDestination | DESTINATION_GRANTED | queued | directory handle 또는 delivery mode 저장 |
| queued | RENDER_WORKER_READY | running | 첫 item active 설정 |
| running | ITEM_TERMINATED | running | item 결과 commit 뒤 다음 item 배정 |
| running | QUEUE_DRAINED | finalizing | 모든 item terminal |
| finalizing | BATCH_RESULT_COMMITTED | completed | resultKind와 성공 파일 manifest 저장 |
| created, preflighting, awaitingDestination, queued, running | CANCEL_REQUESTED | cancelling | 새 item 배정 금지 |
| cancelling | ACTIVE_ITEM_FENCED | cancelling | Worker terminate·stream close 시도 |
| cancelling | CANCELLATION_COMMITTED | cancelled | 이미 성공한 파일은 유지 |
| preflighting, queued, running, finalizing | BATCH_FATAL | failing | 개별 item 실패와 구분 |
| failing | FAILURE_RECORD_COMMITTED | failed | 안전한 성공 파일 manifest 보존 |
| 비종료 상태 | SESSION_LOST | interrupted | 다음 시작에서 출력 파일 상태 확인 |

사용자가 저장 폴더 선택을 취소한 것은 failed가 아니라 cancelled다.

### 14.4 RenderItem 상태

| 현재 status | 이벤트 | 다음 status | 핵심 행동 |
|---|---|---|---|
| queued | ITEM_SLOT_GRANTED | preflighting | source 권한과 snapshot revision 재검증 |
| preflighting | ITEM_PLAN_VALID | rendering | transmux 또는 exact encode 시작 |
| rendering | ENCODE_PROGRESS | rendering | frame queue 상한 유지 |
| rendering | MEDIA_STREAM_FINISHED | finalizing | mux flush, writable close |
| finalizing | OUTPUT_CLOSED | validating | 실제 byte, duration, A/V 정보 읽기 |
| validating | OUTPUT_VALIDATED | completed | outputSafety verified와 결과 record commit |
| queued, preflighting, rendering, finalizing, validating | ITEM_CANCEL_REQUESTED | cancelling | 이후 sample·frame 쓰기 fence |
| cancelling | ITEM_OUTPUT_FENCED | cancelled | 불완전 파일 제거 또는 cleanupRequired |
| preflighting, rendering, finalizing, validating | ITEM_FATAL | failed | reasonCode와 incomplete output 여부 저장 |
| 비종료 상태 | SESSION_LOST | interrupted | 파일을 성공으로 간주하지 않음 |

outputSafety는 별도 필드다.

- unchecked
- writing
- closed
- verifying
- verified
- incomplete
- cleanupRequired
- removed

RenderItem.completed는 다음 조건을 모두 만족해야 한다.

1. encoder·muxer가 flush되었다.
2. WritableStream.close가 성공했다.
3. 출력 byte가 0보다 크다.
4. container를 다시 열어 duration과 track을 읽었다.
5. 허용 오차 안에서 요청 range와 A/V sync가 맞는다.
6. output manifest와 Segment snapshot이 commit되었다.

브라우저 다운로드 폴백은 OS 디스크 저장 완료를 알 수 없다. 이 경로의 deliveryConfirmation은 browserDownloadRequested이며 UI도 “다운로드를 시작했어요”라고 말한다. File System Access stream close를 확인한 경로에서만 “파일 만들기 완료”를 쓴다.

### 14.5 렌더 중 취소와 부분 실패

- 취소 전 completed item은 삭제하지 않는다.
- 현재 item의 불완전 출력은 제거를 우선 시도한다.
- 브라우저가 삭제를 허용하지 않으면 정확한 파일명을 알려 주고 cleanupRequired로 남긴다.
- 이후 queued item은 cancelled로 일괄 확정한다.
- item 하나의 codec 오류는 다음 item을 처리할 수 있으면 batch fatal로 올리지 않는다.
- 디스크 권한 상실처럼 이후 모든 item이 불가능한 오류만 batch failing으로 올린다.
- 재시도는 실패 item snapshot으로 새 RenderBatch를 만드는 것을 기본으로 한다.

### 14.6 렌더 불변식

- batch당 active RenderItem은 최대 하나다.
- source 전체를 메모리에 읽지 않는다.
- completed item은 정확히 하나의 verified output manifest를 가진다.
- cancelled 또는 failed item을 completed로 승격하지 않는다. 재시도는 새 renderItemId다.
- Segment 편집은 실행 중 snapshot을 바꾸지 않는다.
- project trash는 batch가 fenced되기 전 commit되지 않는다.
- 실제 파일과 메타데이터 ZIP의 성공 상태를 섞지 않는다.

## 15. ExportJob 생애주기

ExportJob은 JSON·CSV·Markdown·작은 ZIP 같은 메타데이터 결과를 한 번 만드는 작업이다.

### 15.1 상태와 전이

| 현재 status | 이벤트 | 다음 status | 행동 |
|---|---|---|---|
| created | EXPORT_REQUESTED | waitingForSave | 현재 editGeneration 확인 |
| waitingForSave | REQUIRED_SAVE_COMMITTED | snapshotting | projectRevision 고정 |
| waitingForSave | SAVE_BLOCKED_AND_EMERGENCY_CHOSEN | snapshotting | emergency manifest 표시 |
| snapshotting | EXPORT_SNAPSHOT_COMMITTED | generating | 정렬·필터 대상 고정 |
| generating | FILES_GENERATED | validating | JSON schema, CSV escaping, ZIP entry 검사 |
| validating | EXPORT_VALIDATED | awaitingDestination | byte length와 checksum 확정 |
| awaitingDestination | DESTINATION_GRANTED | writing | 파일 쓰기 또는 download handoff |
| writing | WRITE_CONFIRMED | completed | deliveryConfirmation 기록 |
| created, waitingForSave, snapshotting, generating, validating, awaitingDestination, writing | CANCEL_REQUESTED | cancelling | 생성 Worker·writable·임시 Blob fence와 해제 |
| cancelling | EXPORT_FENCED | cancelled | 임시 자료 제거 |
| snapshotting, generating, validating, writing | EXPORT_FATAL | failed | 기존 프로젝트 저장에는 영향 없음 |
| 비종료 상태 | SESSION_LOST | interrupted | 임시 Blob 성공 처리 금지 |

### 15.2 snapshot과 동시 편집

- 정상 export는 최신 SaveCommit을 먼저 기다린다.
- snapshot 뒤 생긴 편집은 현재 export에 들어가지 않는다.
- 결과 화면에 “프로젝트 revision 42 기준”을 진단 정보로 남긴다.
- 사용자가 편집을 계속하면 완료 뒤 “새 변경 2개는 이 파일에 포함되지 않았어요 · 다시 받기”를 보여 준다.
- emergency export는 DB 미확정 메모리 값을 포함할 수 있으며 파일 안 manifest와 화면에서 명확히 구분한다.

### 15.3 export 완료 의미

- File System Access: stream close와 재읽기 가능한 경우 savedConfirmed
- 일반 브라우저 다운로드: browserDownloadRequested
- clipboard: clipboardWriteConfirmed

download 버튼 클릭만으로 OS 파일 저장 위치를 확인했다고 주장하지 않는다.

### 15.4 export 불변식

- export snapshot의 모든 Segment는 같은 projectRevision에서 읽는다.
- CSV formula injection 문자는 안전하게 처리한다.
- JSON에는 File, FileSystemHandle, Blob URL, 토큰을 넣지 않는다.
- 알 수 없는 미래 field는 복원 JSON에서 가능한 한 보존한다.
- 실제 영상 파일을 메타데이터 ZIP에 자동 포함하지 않는다.
- completed ExportJob은 checksum, projectRevision, deliveryConfirmation을 가진다.

## 16. AppSession 생애주기

AppSession은 브라우저 탭 한 개의 수명이다. 사용자 계정 session이 아니다.

### 16.1 상태

| status | 의미 |
|---|---|
| starting | sessionId 생성, 기본 capability 확인 |
| acquiringAccess | Web Lock 또는 로컬 writer lease 요청 |
| openingStorage | IndexedDB·Cache Storage 열기 |
| recovering | 이전 session journal과 비종료 작업 audit |
| active | 일반 읽기 또는 쓰기 가능 |
| closing | 저장 flush, Worker fence, lock 반납 요청 |
| ended | 정상 종료 절차가 확인된 session |
| interrupted | 정상 종료 marker 없이 heartbeat가 끝난 과거 session |
| blocked | storage 또는 migration 문제로 복구 화면만 가능 |

### 16.2 전이표

| 현재 status | 이벤트 | 다음 status | 행동 |
|---|---|---|---|
| starting | SESSION_BOOTSTRAPPED | acquiringAccess | session journal created |
| acquiringAccess | WRITER_LOCK_ACQUIRED | openingStorage | writerEpoch 발급 |
| acquiringAccess | WRITER_LOCK_UNAVAILABLE | openingStorage | readOnly observer로 계속 |
| openingStorage | STORAGE_OPENED | recovering | schema version 확인 |
| openingStorage | MIGRATION_REQUIRED | recovering | MigrationRun 시작, 일반 쓰기 차단 |
| recovering | RECOVERY_AUDIT_FINISHED | active | orphan job를 interrupted로 확정 |
| active | CLOSE_REQUESTED | closing | 새 동작 차단, 저장 flush |
| closing | FLUSH_AND_FENCE_CONFIRMED | ended | session end marker, lock release |
| starting, acquiringAccess, openingStorage, recovering | BOOT_FATAL | blocked | 진단·백업·초기화 선택 |
| 비종료 상태 | HEARTBEAT_EXPIRED | interrupted | 다음 session이 journal에서 확정 |

브라우저는 unload handler 완료를 보장하지 않는다. 따라서 현재 탭이 스스로 interrupted로 바꿀 수 있다고 가정하지 않는다. 다음 AppSession이 이전 heartbeat와 end marker를 비교해 interrupted를 확정한다.

### 16.3 visibility와 네트워크

다음은 AppSession.status가 아니다.

- visibility: visible, hidden
- connectivity: online, offline, unknown
- workerHealth: healthy, delayed, lost
- storagePressure: normal, warning, critical
- updateState: none, available, applying

탭이 hidden이 되면 분석이 느려질 수 있지만 interrupted로 바꾸지 않는다. Worker heartbeat가 사라지고 실제 instance가 없을 때만 해당 job를 중단 처리한다.

## 17. 다중 탭 단일 writer

### 17.1 기본 구조

한 사용자가 같은 프로젝트를 두 탭에서 열 수는 있지만 쓰기 탭은 하나뿐이다.

1. 첫 탭이 Web Locks의 retto:project:{projectId}:writer exclusive lock을 얻는다.
2. lock을 얻은 탭만 writerEpoch를 발급받고 project mutation을 commit한다.
3. 두 번째 탭은 읽기 전용 observer로 열린다.
4. BroadcastChannel은 “DB에 새 revision이 있다”는 알림만 보낸다.
5. observer는 알림을 받으면 IndexedDB에서 해당 revision을 다시 읽는다.

BroadcastChannel payload를 그대로 state에 적용하지 않는다. 메시지 누락·중복·순서 뒤바뀜을 정상으로 간주한다.

### 17.2 쓰기 권한 넘기기

| 단계 | writer 탭 | observer 탭 |
|---|---|---|
| 요청 | “다른 탭이 편집 권한을 요청함” 표시 | TAKEOVER_REQUEST 전송 |
| 준비 | dirty 저장, 활성 job pause/cancel, lock release | 기다리기 |
| 확정 | writer end marker와 lock 반납 | lock 획득 |
| 재개 | 읽기 전용 전환 | DB 전체 재읽기, 새 writerEpoch 발급 |

writer 탭이 응답하지 않으면 observer는 lock이 실제로 해제될 때까지 쓰지 않는다. lock 획득 뒤에도 이전 Worker event를 폐기하기 위해 새 sessionId, writerEpoch, runId를 사용한다.

### 17.3 Web Locks 미지원 폴백

IndexedDB의 WriterLease store를 사용한다.

- ownerSessionId
- writerEpoch
- expiresAt
- heartbeatAt

lease 획득과 epoch 증가는 하나의 readwrite transaction에서 한다. 모든 프로젝트 write transaction은 같은 transaction 안에서 writerEpoch를 다시 검증한다. 단순 localStorage flag는 사용하지 않는다.

폴백에서도 안전한 fencing을 구현할 수 없는 브라우저는 두 번째 탭을 강제 읽기 전용으로 열고 “편집 중인 다른 탭을 닫아 주세요”라고 안내한다.

### 17.4 다중 탭 불변식

- 프로젝트당 commit 가능한 writerEpoch는 한 시점에 하나다.
- 더 작은 writerEpoch의 transaction은 항상 거부된다.
- observer는 Worker·Render·Migration을 시작할 수 없다.
- lock takeover는 기존 저장과 job fence가 끝나기 전 완료로 표시하지 않는다.
- BroadcastChannel만으로 완료·저장·lock 상태를 확정하지 않는다.

## 18. 안전 편집 경계

| 변경 대상 | 언제 허용 | 실행 중 바꾸려 할 때 | 이유 |
|---|---|---|---|
| source 파일·URL | 분석 전, 또는 기존 run 종료 후 | 동일 fingerprint 재권한만 허용; 다른 원본은 새 binding | timeline 오염 방지 |
| source sync offset | 분석 전 | 새 timeline revision과 새 AnalysisRun | 기존 후보 시각 보존 |
| 채팅 field mapping | ChatImport previewReady | 현재 import preview revision 재생성 | 임시 자료만 변경 |
| 채팅 alignment | 분석 전 또는 분석 후 | 새 alignment revision; 현재 run은 고정 | 분석 재현성 |
| 모델·runtime tier | run 시작 전 | 현재 run 종료 또는 실패 뒤 새 run | 점수·feature 일관성 |
| 신호 가중치·후보 수 | run 시작 전 | 새 AnalysisSpec | 결과 추적성 |
| 후보 경계·제목 | proposal commit 뒤 언제든 | Segment user revision으로 저장 | 분석과 사람 편집 분리 |
| 승인·제외 | proposal commit 뒤 언제든 | 사람만 변경 | AI 자동 확정 금지 |
| render 입력 구간 | batch created 전 | 새 편집은 다음 batch에만 반영 | 출력 snapshot 불변 |
| render codec·해상도 | batch created 전 | 현재 batch 취소 후 새 batch | 파일 결과 예측 가능 |
| export 포함 항목 | snapshot 전 | snapshot 뒤 변경은 다음 export | 동일 revision 보장 |
| 프로젝트 삭제 | active job 없음 | 먼저 모든 job fence | 늦은 쓰기 방지 |
| 모델 캐시 삭제 | 사용 중 아님 | deleteDeferred | 실행 중 model handle 보호 |
| 앱 업데이트 | clean이고 active job 없음 | 저장·중단 뒤 사용자 승인 | migration·Worker 혼합 방지 |

사용자가 실행 중 설정을 바꾸려 하면 값을 무시하거나 몰래 적용하지 않는다. “현재 분석에는 기존 설정이 유지돼요. 변경한 설정으로 새 분석을 시작할까요?”처럼 영향을 설명한다.

## 19. 상태별 UI 투영

### 19.1 공통 표시 원칙

각 비동기 카드에는 가능한 범위에서 네 가지를 보여 준다.

1. 지금 무엇을 하는가
2. 기록이 어디까지 안전한가
3. 다음에 일어날 일
4. 지금 가능한 회복 행동

내부 상태 이름이나 오류 stack을 전면에 노출하지 않는다. status가 같아도 reasonCode와 보조 상태에 따라 사용자 문구를 다르게 만든다.

성공처럼 보이는 색·체크 아이콘은 확정 status에서만 사용한다. 요청 직후에는 동사 진행형과 spinner를 쓴다.

### 19.2 SourceCheck UI

| 내부 상태 | 기본 문구 | 보조 문구 | 행동 |
|---|---|---|---|
| created | 원본을 확인할 준비를 하고 있어요 | 아직 분석을 시작하지 않았어요 | 취소 |
| checking | 이 영상으로 할 수 있는 일을 확인하고 있어요 | 재생·AI 분석·파일 만들기를 차례로 검사해요 | 취소 |
| committing | 확인 결과를 안전하게 저장하고 있어요 | 잠시만 기다려 주세요 | 없음 |
| completed + ready | AI 분석 준비 완료 | 여러 후보를 찾으면 바로 보여드려요 | AI로 찾기 |
| completed + degraded | 가능한 방식으로 분석할 수 있어요 | 사용하지 못하는 신호와 영향 설명 | 빠른 분석 시작 |
| completed + blocked | 이 입력만으로는 전체 영상을 볼 수 없어요 | 원본 파일 또는 채팅·자막 추가 | 원본 고르기 |
| failed | 원본 확인을 끝내지 못했어요 | 기존 프로젝트 기록은 안전해요 | 다시 확인 |
| interrupted | 확인이 중간에 멈췄어요 | 아직 분석 결과는 만들지 않았어요 | 다시 확인 |

### 19.3 ChatImport UI

| 내부 상태 | 기본 문구 | 행동 |
|---|---|---|
| parsing | 채팅 기록을 읽고 있어요 · 38% | 취소 |
| validating | 메시지 시각과 내용을 확인하고 있어요 | 취소 |
| aligning | 영상과 채팅 시간을 맞추고 있어요 | 취소 |
| previewReady | 적용 전에 맞는지 확인해 주세요 | Before/After 재생, 기준 시각 수정, 적용 |
| committing | 채팅 반응을 프로젝트에 저장하고 있어요 | 기다리기 |
| completed | 채팅 반응을 분석에 사용할 준비가 됐어요 | AI 분석 |
| failed | 채팅 기록을 가져오지 못했어요 | 열 mapping 수정, 다른 파일 |
| interrupted | 가져오기가 중간에 멈췄어요 | 새로 가져오기 |

previewReady에서 원문 표본을 보여 줄 때 개인정보를 기본 마스킹한다. 사용자가 적용하기 전에는 AI 분석에 섞지 않는다.

### 19.4 선택형 로컬 수집기 UI

이 UI는 Pages 앱이 아니라 로컬 수집기 창에만 표시한다.

| 내부 상태 | 기본 문구 | 행동 |
|---|---|---|
| starting | 채팅 기록 파일을 준비하고 있어요 | 취소 |
| connecting | 내 치지직 방송에 연결하고 있어요 | 중지 |
| running + connected | 채팅 기록 중 · 마지막 저장 방금 | 안전하게 중지 |
| running + reconnecting | 연결을 다시 시도 중 · 이 시간은 누락 구간으로 표시해요 | 계속 기다리기, 안전하게 중지 |
| stopping | 마지막 채팅을 저장하고 파일을 확인하는 중 | 기다리기 |
| completed | 방송 채팅 기록을 안전하게 마쳤어요 | 파일 위치 열기, Pages 앱에서 가져오기 |
| stoppedByUser | 채팅 기록을 안전하게 중지했어요 | 파일 위치 열기, 가져오기 |
| failed | 연결 문제로 기록을 끝냈어요 · 저장된 구간은 남아 있어요 | 부분 파일 확인, 새 수집 |
| interrupted | 수집기가 갑자기 종료됐어요 | 부분 파일 복구 검사 |

STOP_REQUESTED 직후 “중지됨”을 표시하지 않는다. STOP_COMMITTED가 도착하기 전에는 버튼을 spinner가 있는 “안전하게 중지하는 중”으로 바꾼다. credential 값, channel token, Client Secret은 화면·진단 다운로드에 표시하지 않는다.

### 19.5 ModelDownload UI

| 내부 상태 | 기본 문구 | 행동 |
|---|---|---|
| created | 정밀 AI에 필요한 모델이에요 · 약 N MB | 받기, 빠른 분석만 |
| downloading | AI 모델을 한 번 받아 두는 중 · 42% | 취소 |
| verifying | 받은 AI 모델이 안전하게 도착했는지 확인 중 | 기다리기 |
| committing | 다음에도 쓸 수 있게 보관 중 | 기다리기 |
| completed | 정밀 AI 준비 완료 | 분석 계속 |
| failed | AI 모델을 받지 못했어요 | 다시 받기, 빠른 분석만 |
| interrupted | 모델 받기가 중간에 멈췄어요 | 다시 받기 |

모델 준비와 후보 분석을 서로 다른 진행 상태로 표시해 현재 단계를 분명히 한다.

### 19.6 AnalysisRun UI

| 내부 상태 | 기본 문구 | 허용 행동 |
|---|---|---|
| starting | AI 분석을 준비하고 있어요 | 취소 |
| running + fastPass | 방송 전체를 빠르게 훑고 있어요 | 잠시 멈추기, 직접 장면 추가 |
| running + deepPass | 유력한 장면을 자세히 보고 있어요 | 후보 검토, 잠시 멈추기 |
| running + boundary/ranking | 장면의 시작·끝과 추천 순서를 정리해요 | 후보 검토, 잠시 멈추기 |
| pausing | 안전하게 멈추는 중이에요 | 기다리기, 오래 걸리면 강제 중단 |
| paused | 여기까지 저장하고 멈췄어요 | 이어 하기, 부분 후보 보기, 취소 |
| resuming | 저장 지점에서 분석을 다시 준비하고 있어요 | 취소 |
| awaitingGapDecision | 확인하지 못한 구간이 있어요 | 해당 구간 다시 시도, 제한 결과로 마치기 |
| finalizing/completing | 결과를 안전하게 정리하고 있어요 | 후보 검토 |
| completed | AI 분석 완료 · 계획한 전체 구간 확인 | 추천 장면 검토 |
| completedWithGaps | AI 분석 완료(제한 결과) · 확인하지 못한 구간 N개 | 누락 구간 보기, 추천 장면 검토 |
| cancelling | 분석을 안전하게 끝내는 중이에요 | 기다리기 |
| cancelled | 분석을 취소했어요 · 나온 후보는 남아 있어요 | 후보 보기, 다시 분석 |
| failing | 이미 찾은 장면을 보존하고 있어요 | 기다리기 |
| failed | 일부 분석을 끝내지 못했어요 | 부분 후보 보기, 실패 구간 다시 분석 |
| interrupted | 브라우저가 닫혀 분석이 멈췄어요 | 저장 지점부터 이어 하기 |

progress는 원본 재생 위치가 아니라 commit된 coverage임을 도움말로 설명한다. 미분석·실패 interval을 완료 색으로 채우지 않는다. completedWithGaps에는 “제한 결과” 표식과 누락 사유·영향·승인 취소 후 재시도 행동을 계속 노출한다.

### 19.7 Segment와 AI proposal UI

- AI proposal 도착: 카드 안 “AI 추천”과 근거 칩
- 사용자가 편집하지 않은 닫힌 카드의 개선 proposal: 안정된 위치에서 업데이트, 작은 “더 자세히 분석됨”
- 사용자가 편집 중인 카드의 개선 proposal: 현재 값 유지, “새 AI 제안 비교”
- 승인한 카드의 개선 proposal: 승인값 유지, 접힌 대안만 제공
- rejected 카드의 개선 proposal: 자동 복원하지 않음
- ranking revision 도착: 현재 목록 유지, “새 추천 순서 적용”

Before/After 비교에는 시작·끝 시각, 길이, 포함·제외되는 문맥을 함께 보여 준다. “AI가 더 정확함”이라고 단정하지 않는다.

### 19.8 Save·Migration UI

| 상태 | 표시 방식 | 행동 |
|---|---|---|
| save clean | 작은 “저장됨 · 방금” | 없음 |
| save dirty/saving | 작은 “저장 중…” | 없음 |
| save blocked | 닫히지 않는 오류 배너 | 다시 저장, 긴급 백업 |
| migration backingUp/migrating | 전체 화면 진행 “기록 형식을 안전하게 업데이트 중” | 탭 닫지 않기 안내 |
| migration rollingBack | 전체 화면 “이전 기록으로 되돌리는 중” | 기다리기 |
| migration rolledBack | 경고 카드 “업데이트를 적용하지 못해 이전 형식으로 열었어요” | 백업 받기, 다시 시도 |
| migration failedLocked | 복구 화면 | 백업 받기, 진단 받기, 명시적 초기화 |

MigrationRun 중 프로젝트 편집 화면을 낙관적으로 보여 주지 않는다.

### 19.9 Render·Export UI

렌더:

- preflighting: “영상 파일을 만들 수 있는지 마지막으로 확인해요”
- awaitingDestination: “저장할 폴더를 골라 주세요”
- running: “3/8 · 클립 03을 만드는 중”
- finalizing: “만든 파일을 확인하고 있어요”
- completed allSucceeded: “영상 파일 8개를 만들었어요”
- completed partialSuccess: “6개 완료 · 2개는 만들지 못했어요”
- cancelling: “현재 파일 쓰기를 안전하게 멈추는 중”
- cancelled: “출력을 취소했어요 · 이미 만든 3개는 그대로 있어요”
- interrupted: “출력이 중간에 멈췄어요 · 완료 확인된 파일만 목록에 남겼어요”

Export:

- waitingForSave: “최신 편집을 먼저 저장하고 있어요”
- generating: “결과 파일을 정리하고 있어요”
- validating: “백업 파일을 다시 열 수 있는지 확인해요”
- completed + browserDownloadRequested: “다운로드를 시작했어요”
- completed + savedConfirmed: “결과 파일을 저장했어요”

### 19.10 암묵적 변화 피드백

반드시 지속 표시:

- WebGPU에서 WASM·signals-only로 실행 tier 하락
- source permission 상실
- 채팅 gap 또는 정렬 revision 변경
- 저장 blocked
- 미분석 interval
- 다른 탭이 writer임
- 렌더 incomplete 파일

짧은 toast로 충분:

- 장면 commit 완료
- 실행 취소 완료
- 제목 저장 완료
- 클립 URL 붙이기 완료

조용히 처리:

- 중복 stale event 폐기
- 이미 처리한 eventId 재수신
- 사용자 결과에 영향 없는 임시 cache 청소

진단 로그에는 남기되 초심자에게 내부 경합을 오류처럼 보여 주지 않는다.

## 20. 새로고침·중단 복구 절차

새 AppSession은 화면을 먼저 복원하지 않고 다음 순서로 audit한다.

1. app sessionId 생성
2. writer lock 또는 read-only 역할 결정
3. IndexedDB schema와 MigrationRun journal 확인
4. 완료되지 않은 migration 복구
5. 이전 AppSession end marker와 heartbeat 확인
6. 비종료 job/run별 실제 resource 존재 여부 확인
7. terminal commit marker가 있는 작업은 재검증
8. marker가 없고 실행 주체가 사라진 작업은 interrupted로 확정
9. orphan temp cache·OPFS·Object URL cleanup 예약
10. project의 committedRevision을 읽어 UI 복원
11. 미완료 RangeCapture, 분석 checkpoint, 실패 저장을 회복 카드로 표시

### 20.1 persisted 상태별 복구

| 발견한 이전 상태 | 복구 결과 |
|---|---|
| SourceCheck checking/committing | interrupted, 새 검사 제안 |
| ChatImport parsing~committing | commit marker 검증; 없으면 interrupted, 임시 자료 삭제 또는 새 import |
| ModelDownload downloading~committing | hash·cache index 검증; 불완전하면 interrupted와 temp 삭제 |
| AnalysisRun starting/running/pausing/paused/resuming/awaitingGapDecision/finalizing/completing | final commit 검증; 없으면 interrupted, checkpoint에서 새 run |
| RangeCapture capturing/ending | interrupted, startMs를 보여 주고 계속/끝 입력/취소 |
| SaveCommit writing | IndexedDB transaction은 commit 또는 rollback이므로 generation 재읽기; 미확정 편집이 없으면 clean, 있으면 dirty |
| MigrationRun 비종료 | migration journal 규칙에 따라 완료 검증 또는 rollback |
| RenderItem rendering~validating | verified manifest 없으면 interrupted; 불완전 파일 cleanup 안내 |
| ExportJob generating~writing | delivery 확인이 없으면 interrupted; 새 export 제안 |
| AppSession closing | end marker가 없으면 interrupted |

### 20.2 복구 화면 우선순위

1. migration failedLocked
2. 저장 blocked와 긴급 백업
3. 다른 탭 writer
4. source permission 재연결
5. interrupted analysis 이어 하기
6. incomplete render cleanup
7. unfinished RangeCapture
8. 일반 최근 프로젝트 계속하기

복구 선택을 여러 modal로 연속 질문하지 않는다. 하나의 복구 요약 화면에서 권장 행동 하나를 강조하고 고급 항목을 접는다.

## 21. 전역 불변식

다음 규칙은 reducer, repository, Worker adapter, E2E 테스트에서 중복 방어한다.

### 21.1 소유·동시성

1. 프로젝트당 writable AppSession은 최대 하나다.
2. 프로젝트당 writable AnalysisRun은 최대 하나다.
3. 프로젝트당 비종료 RangeCapture는 최대 하나다.
4. RenderBatch당 active RenderItem은 최대 하나다.
5. ModelArtifact당 active ModelDownload는 최대 하나다.
6. MigrationRun 중 일반 project write는 0개다.

### 21.2 식별자·이벤트

7. 정상 pause의 같은-session 재개만 같은 runId를 유지하고 workerEpoch·taskId를 새로 만든다. 그 밖의 재시도·재개는 새 runId 또는 jobId다.
8. terminal 상태가 된 대상은 같은 식별자로 nonterminal이 되지 않는다.
9. eventId 하나는 최대 한 번만 부작용을 만든다.
10. 현재 sessionId, writerEpoch, runId와 다른 event는 영구 결과를 바꾸지 못한다.
11. current보다 낮은 chunkAttempt 결과는 폐기한다.
12. 정의되지 않은 현재 상태 + 이벤트 전이는 reducer에서 예외 또는 명시적 rejection이다.

### 21.3 사람 편집 보호

13. AI는 Segment.reviewState를 바꾸지 못한다.
14. fieldOwner가 user인 range와 title은 AI가 덮어쓰지 못한다.
15. approvedRevision은 사용자 event로만 생성된다.
16. rejected·trashed Segment는 AI proposal로 자동 복원되지 않는다.
17. 현재 검토 중 ranking은 background event로 자동 재정렬되지 않는다.

### 21.4 완료·내구성

18. 완료 UI는 terminal commit과 재검증 뒤에만 나타난다.
19. 분석 progress는 commit된 coverage만 포함한다.
20. Save “저장됨”은 committedGeneration >= editGeneration일 때만 표시한다.
21. RenderItem completed는 outputSafety verified를 요구한다.
22. ExportJob completed는 deliveryConfirmation을 요구한다.
23. MigrationRun completed는 새 schema 재열기 검증을 요구한다.
24. 취소 완료는 실행 주체가 더 이상 쓸 수 없는 fence를 요구한다.

### 21.5 데이터와 시간

25. 모든 저장 시간은 정수 ms이며 startMs <= endMs다.
26. source duration이 있으면 range는 0..durationMs 안이다.
27. 분석·렌더 결과는 사용한 sourceTimelineRevision을 가진다.
28. 채팅 gap을 0건 정상 구간으로 변환하지 않는다.
29. 원본 File, 전체 영상 Blob, Blob URL은 Project JSON에 들어가지 않는다.
30. 기본 설정에서 닉네임·senderChannelId 원문을 영속 저장하지 않는다.

### 21.6 종료와 청소

31. completed, cancelled, failed, interrupted 의미는 서로 바꾸지 않는다.
32. cleanup 실패는 성공 결과를 지우지 않고 cleanupState로 분리한다.
33. project purge 전 모든 writer fence가 확정된다.
34. 모델·OPFS 임시 자료는 owning job가 terminal인 뒤만 삭제한다.
35. service worker는 active job를 끊는 자동 reload를 하지 않는다.

### 21.7 canonical 불변식 요약

구현과 코드 리뷰에서 먼저 확인할 canonical 집합은 다음과 같다. 다른 설명과 충돌하면 이 표와 각 생애주기 전이표를 우선한다.

| 키 | 절대 규칙 |
|---|---|
| C-01 | 프로젝트의 commit 가능한 writerEpoch는 한 시점에 하나다. |
| C-02 | AnalysisRun의 inputSignature는 run 생애주기 동안 바뀌지 않는다. |
| C-03 | 정상 pause 같은-session 재개만 runId를 유지하며 workerEpoch와 taskId는 반드시 새로 만든다. |
| C-04 | session/Worker 소실, 실패, 입력·설정·모델 변경 뒤 재개는 새 runId와 resumedFromRunId를 쓴다. |
| C-05 | 현재 sessionId·writerEpoch·runId·workerEpoch·taskId와 다른 event는 결과를 쓰지 못한다. |
| C-06 | user-owned Segment field와 reviewState는 AI가 덮어쓰지 못한다. |
| C-07 | completed는 planned 범위 전체의 정상 coverage를 요구한다. |
| C-08 | completedWithGaps는 planned 범위 전체가 covered + 명시 승인 gap으로 완전히 설명되어야 한다. |
| C-09 | pause·cancel·stop·save·render·export의 성공 UI는 담당 시스템 ACK와 commit 뒤에만 나타난다. |
| C-10 | SourceDefinition만 portable하며 SourceBinding의 handle·permission은 export하지 않는다. |
| C-11 | LocalLiveCaptureRun의 중지 완료는 flush·checksum·GAP·file close·credential cleanup을 요구한다. |
| C-12 | terminal 대상은 같은 식별자로 nonterminal 상태로 되돌아가지 않는다. |

## 22. 전이 중심 테스트 매트릭스

### 22.1 테스트 기반

필수 test utility:

- 결정적 UUID와 가상 시계
- Worker 이벤트를 순서 변경·지연·중복할 수 있는 controllable fake
- transaction별 quota, abort, versionchange 오류를 주입하는 IndexedDB adapter
- Web Lock과 lease 경합 fake
- source permission revoke와 fingerprint mismatch fake
- FileSystem writable close·remove 실패 fake
- Cache Storage hash mismatch·eviction fake
- 브라우저 reload를 흉내 내는 session journal 재부팅 harness

각 상태 machine은 pure reducer와 effect runner를 분리한다. reducer 테스트는 네트워크·Worker 없이 전이를 검증하고, integration 테스트는 effect 확인 이벤트만 reducer에 되돌려 준다.

### 22.2 생애주기별 최소 매트릭스

| 대상 | 정상 | 사용자 취소 | 처리 실패 | 새로고침 | 늦은 이벤트 | 중복 이벤트 |
|---|---|---|---|---|---|---|
| SourceCheck | ready/degraded/blocked 모두 completed | probe abort 후 cancelled | timeout·decoder 오류 | interrupted 후 새 검사 | 과거 job 결과 폐기 | snapshot 1회 |
| ChatImport | parse→preview→commit | preview 취소와 temp 삭제 | malformed·quota | committing 중 commit marker 판별 | 과거 preview 폐기 | 같은 seq best-effort dedupe |
| LocalLiveCaptureRun | connect→capture→STOP_COMMITTED | stoppedByUser | safe flush 뒤 failed | 강제 종료는 interrupted | stop fence 뒤 socket event 폐기 | local seq·hash best-effort |
| ModelDownload | download→hash→cache | temp cache 삭제 | hash mismatch·offline | incomplete cache sweep | 이전 job progress 폐기 | artifact 한 active |
| AnalysisRun | fast→deep→completed 및 gap 승인→completedWithGaps | running·pausing·finalizing 취소 | Worker OOM·decode 오류 | 각 stage에서 checkpoint 복구 | 이전 run/worker/task/chunk 폐기 | eventId 1회 |
| RangeCapture | instant·long 완료 | 시작 후 취소 | source time 실패 | startMs 복원 | 이전 player callback 폐기 | 연타 1 Segment |
| SaveCommit | dirty→commit→clean | 해당 없음 | quota·versionchange | commit/rollback 판별 | 낮은 revision 거부 | 같은 commit 1회 |
| MigrationRun | backup→migrate→validate | 시작 전만 취소 | transform·validation·rollback 실패 | journal 분기 | 과거 app write 거부 | step 멱등 |
| RenderBatch | all success·partial success | active item fence | item 오류·batch 권한 상실 | incomplete output audit | 이전 Worker frame 폐기 | 파일 manifest 1개 |
| ExportJob | save→snapshot→download | destination 취소 | ZIP·write 실패 | delivery 미확정 | 이전 job 완료 폐기 | download handoff 1회 |
| AppSession | writer·observer 정상 | close | storage blocked | 이전 session interrupted | 이전 epoch write 폐기 | takeover 1 writer |

### 22.3 AnalysisRun 상세 전이 테스트

반드시 자동화한다.

1. created에서 CHUNK_RESULT_READY는 거부
2. starting에서 RUN_MANIFEST_COMMITTED 뒤만 running
3. running에서 PAUSE_REQUESTED 뒤 새 청크 배정 0개
4. Worker pause ACK 전 paused 표시 금지
5. checkpoint commit 실패 시 paused 금지
6. 같은 AppSession의 정상 paused에서 RESUME_REQUESTED_SAME_SESSION 시 같은 runId, 더 큰 workerEpoch
7. 정상 재개 뒤 이전 workerEpoch·taskId의 결과 폐기
8. paused 뒤 session 종료·새로고침 재개는 새 runId와 resumedFromRunId
9. paused 뒤 model/config 변경 재개는 기존 run cancel fence 후 새 AnalysisSpec·runId
10. 이전 run의 DEEP_RESULT가 새 run 중 도착해도 proposal 0개 변경
11. chunkAttempt 1 뒤 attempt 0 결과 폐기
12. 같은 CHUNK_COMMIT event 두 번에 coverage 중복 없음
13. finalizing 중 active chunk 결과 거부
14. FINAL_RESULT_COMMITTED 전 completed·completedWithGaps 금지
15. gap 미승인 상태에서 completedWithGaps 금지
16. accepted gap의 reason·approver가 없으면 final commit 거부
17. covered + acceptedSkipped + acceptedFailed 합집합이 planned와 다르면 완료 거부
18. completing 중 재열기 검증 실패 시 failing
19. 취소 뒤 Worker 결과 영구 쓰기 0개
20. interrupted run의 compatible checkpoint만 새 run이 재사용
21. inputSignature가 다른 checkpoint 재사용 거부
22. failed interval과 covered interval 겹침 거부

### 22.4 LocalLiveCaptureRun 상세 전이 테스트

1. starting에서 manifest·파일 open 전 connecting 금지
2. connecting에서 구독 ACK 전 running 금지
3. running event의 local seq 단조 증가
4. flush ACK 전 event를 durable coverage에 포함하지 않음
5. disconnect에서 run은 running 유지, connectionState reconnecting, GAP open
6. reconnect에서 기존 GAP close와 새 event seq 연속
7. STOP_REQUESTED 직후 stoppedByUser 표시 금지
8. STOP_COMMITTED 필수 조건 하나씩 누락한 fault injection에서 terminal 확정 금지
9. stop fence 뒤 늦은 socket event 저장 0개
10. 자연 방송 종료는 completed, 사용자 중지는 stoppedByUser
11. 안전 flush가 가능한 fatal은 failed, process kill은 interrupted
12. interrupted partial file recovery가 원래 run status를 바꾸지 않음
13. credential pattern이 JSONL·진단·checksum META에 0건
14. Pages 앱이 capture credential 또는 socket session을 읽지 않음

### 22.5 AI와 사용자 revision 경합 테스트

| 순서 | 기대 결과 |
|---|---|
| P1 → 사용자 range 수정 → P2 | 사용자 range 유지, P2 비교 제안 |
| P1 → P2 → 사용자 승인 | P2를 고정한 approvedRevision |
| P1 → 사용자 승인 → P2 | 승인값 유지, evidence 대안만 |
| P1 → 사용자 rejected → P2 | rejected 유지 |
| P1 → 사용자가 제목 입력 중 → P2 제목 | 입력값 유지, 대안 제목 표시 |
| 사용자가 “AI 제안 적용” 연타 | userRevision 한 번 증가 |
| ranking R1 검토 중 R2 도착 | 현재 순서 유지 |
| 검토 카드 닫고 R2 적용 | 동일 segmentId와 focus 보존 |
| userRevision base 2 저장 중 base 1 AI event | AI auto-apply 거부 |
| project trash 중 proposal 도착 | proposal commit 거부 |

### 22.6 다중 탭·writer 경합 테스트

1. 두 탭 동시 lock 요청에서 writer 한 개
2. observer mutation command 전부 거부
3. BroadcastChannel 메시지 손실 뒤 DB revision 재읽기로 복구
4. 메시지 역순 수신에도 revision 역행 없음
5. writer 강제 종료 뒤 lock release와 새 writerEpoch
6. 이전 tab Worker가 뒤늦게 보낸 event 폐기
7. IDB lease 만료 직전 두 takeover 경쟁에서 epoch 하나만 commit
8. system clock 뒤로 이동해도 lease 판단이 단조 시계 또는 보수적 정책 사용
9. writer dirty 상태에서 정상 takeover 요청 시 저장 완료 뒤 권한 이동
10. migration 중 observer가 writer를 빼앗지 못함

### 22.7 저장·migration 장애 테스트

- 매 object store write 직전에 transaction abort 주입
- quota 초과 시 committedGeneration 불변
- 저장 중 새 편집이 생기면 두 번째 commit 예약
- save verify read mismatch에서 저장됨 표시 금지
- backup 용량 부족이면 migration 시작 금지
- 각 migration step 중 reload 뒤 journal 분기
- transform은 성공했지만 schema pointer 전 commit 전 중단
- pointer commit 뒤 UI 표시 전 중단
- rollback 중 중단 뒤 재진입 멱등
- 최신 schema를 구버전 app이 read-only로 안전 실패
- unknown future field 왕복 보존

### 22.8 렌더·내보내기 장애 테스트

- 각 RenderItem 단계에서 취소
- stream close 실패
- 0 byte 출력
- duration 오차 초과
- A/V sync 초과
- completed 3개 뒤 네 번째 실패와 batch partialSuccess
- 현재 item 취소 뒤 queued item 전부 cancelled
- cleanup remove 실패와 정확한 파일명 안내
- 렌더 snapshot 뒤 Segment 수정이 현재 파일에 섞이지 않음
- export snapshot 뒤 편집에 “포함되지 않음” 안내
- 일반 다운로드를 savedConfirmed로 오표시하지 않음
- CSV formula, 한글, 이모지, Windows 금지 문자
- 손상 JSON backup 검증 실패 시 다운로드 전 경고

### 22.9 UI E2E 상태 투영

다음은 Playwright 실제 브라우저에서 확인한다.

- 요청 버튼 직후 완료 체크가 나오지 않음
- 분석 pause 중 버튼 중복 입력 차단
- 첫 후보 검토 중 background proposal이 input focus를 빼앗지 않음
- save blocked 배너가 toast처럼 사라지지 않음
- source permissionLost에서 “기록은 안전함” 표시
- cancelled와 failed 문구·행동이 다름
- failed interval이 완료 progress 색과 다름
- read-only observer에서 편집 CTA 비활성 및 이유 제공
- 200%·400% 확대에서도 상태·다음 행동 순서 유지
- 스크린리더 live region이 progress 매 tick마다 과도하게 읽지 않음
- prefers-reduced-motion에서 결과 공개 animation 없이 같은 확정 상태 표시
- 키보드 focus가 새 ranking으로 이동하지 않음

### 22.10 property·fuzz 테스트

- 임의 이벤트 순서를 reducer에 넣어 금지 전이가 state를 바꾸지 않는지 확인
- completed, completedWithGaps, cancelled, failed, interrupted, stoppedByUser 등 terminal 상태 뒤 임의 이벤트에도 terminal 유지
- 임의 중복 event에서 부작용 횟수 1 이하
- 임의 Segment 편집·AI proposal 순서에서 user-owned field 불변
- 임의 save 실패·성공 순서에서 committedGeneration 단조 증가
- 임의 multi-tab epoch에서 최대 writer 1
- 임의 time range에서 저장 뒤 start <= end

### 22.11 출시 gate

상태 모델 구현은 다음을 모두 만족해야 UI 기능 구현 완료로 본다.

- 명시된 허용 전이마다 자동 테스트 최소 한 개
- 각 status의 정상 진입과 terminal 진입 테스트
- 주요 금지 전이 100% 테스트
- 전역 불변식 property test
- fast/deep pass 각 지점 reload 복원
- 사용자 revision 경합 매트릭스 전부 통과
- 다중 탭 writer race 전부 통과
- 렌더·migration fault injection 전부 통과
- 실제 GitHub Pages의 repo 하위 경로에서 E2E 통과

## 23. 구현 구조와 계약

권장 파일 구조:

    src/core/lifecycle/
    ├─ event-envelope.ts
    ├─ transition-error.ts
    ├─ invariants.ts
    ├─ project-machine.ts
    ├─ source-check-machine.ts
    ├─ chat-import-machine.ts
    ├─ model-download-machine.ts
    ├─ analysis-run-machine.ts
    ├─ range-capture-machine.ts
    ├─ save-machine.ts
    ├─ migration-machine.ts
    ├─ render-machine.ts
    ├─ export-machine.ts
    └─ app-session-machine.ts

    src/core/revisions/
    ├─ candidate-proposal.ts
    ├─ segment-revision.ts
    ├─ proposal-merge-policy.ts
    └─ ranking-revision.ts

    src/storage/
    ├─ writer-fence.ts
    ├─ processed-events.ts
    ├─ transaction-runner.ts
    ├─ journals/
    └─ recovery-audit.ts

    companion/chzzk-capture/src/
    ├─ local-live-capture-machine.ts
    ├─ session-client.ts
    ├─ jsonl-writer.ts
    ├─ credential-redactor.ts
    └─ capture-recovery-audit.ts

### 23.1 command와 event 분리

- command: 사용자의 의도 또는 orchestrator 요청
- effect: Worker 시작, DB transaction, 파일 쓰기 같은 외부 동작
- event: effect의 실제 진행·확인·실패 결과

reducer는 command를 받으면 곧바로 성공 state를 만들지 않는다. 전이 중 state와 effect description을 반환한다. effect runner가 실제 작업을 하고 확인 event를 돌려 준다.

예:

    running + PAUSE_REQUESTED
      → state pausing
      → effect STOP_ASSIGNING_CHUNKS
      → effect REQUEST_WORKER_PAUSE
      → ALL_WORKERS_PAUSED_ACK
      → effect COMMIT_PAUSE_RECORD
      → PAUSE_RECORD_COMMITTED
      → state paused

### 23.2 TypeScript 규칙

- status는 string이 아니라 discriminated union으로 정의한다.
- status별로 존재 가능한 필드를 union branch에 제한한다.
- switch는 never exhaustive check를 사용한다.
- reasonCode와 사용자 문구를 분리한다.
- Date, Error, File, Worker 객체를 영속 domain state에 넣지 않는다.
- reducer는 순수 함수로 유지하고 현재 시간·UUID는 dependency로 주입한다.
- effect 결과는 반드시 DomainEventEnvelope schema를 통과한다.
- repository는 writerEpoch와 baseRevision 검증 없는 write API를 노출하지 않는다.

### 23.3 reasonCode 최소 집합

내부 진단용 예시:

- source_permission_lost
- source_fingerprint_mismatch
- source_samples_unreadable
- chat_schema_invalid
- chat_alignment_unknown
- storage_quota_exceeded
- storage_transaction_aborted
- model_network_failed
- model_hash_mismatch
- webgpu_device_lost
- worker_heartbeat_lost
- analysis_chunk_decode_failed
- render_codec_unsupported
- render_stream_close_failed
- render_output_validation_failed
- migration_backup_failed
- migration_validation_failed
- stale_event_ignored
- writer_epoch_mismatch

사용자 문구는 reasonCode를 그대로 번역하지 않는다. 무슨 일, 기록 안전성, 추천 행동 세 요소로 mapping한다.

### 23.4 현재 구현된 완료 분석 복구 슬라이스

현재 앱 `0.2.1`은 `0.2.0`에서 추가한 완료 AI 분석 복구 경로를 유지한다. 이는 전체 Project·SaveCommit 복구에 앞선 좁은 복구 경로다.

1. `analysisTerminalDispositions`를 목록의 유일한 기준으로 열거한다. 별도 recent-project index는 만들지 않는다.
   terminal은 run별 write-once다. 같은 모든 필드가 정확히 일치하는 멱등 재시도만 허용하며, 완료 뒤 실패·취소 등 다른 disposition으로 교체할 수 없다. IndexedDB의 존재 확인·비교·최초 add는 하나의 `readwrite` transaction에서 수행한다.
2. `completed`·`completedWithGaps` terminal만 후보로 삼고, manifest와 final artifact가 모두 있어야 한다.
3. terminal·manifest·final의 `runId`, schema, input signature, model manifest를 맞추고 terminal의 `resultArtifactId`가 실제 final `artifactId`를 직접 가리켜야 한다.
4. final payload의 source·summary·coverage·후보 exact allowlist, 후보 수·중복 ID·시간 범위·coverage·gap approval 불변식을 read-time에 다시 검증한다.
5. 손상된 terminal 행과 고아 final은 사용자 결과로 노출하지 않는다. 손상된 최신 포인터가 있어도 더 오래된 정상 완료 결과의 검증은 계속한다.
6. 복원 화면은 과거 run을 현재 AppSession의 `AnalysisRunState`로 되살리지 않고 별도 read-only recovery 상태로 연다.
7. 원본 File은 저장하지 않는다. 다시 선택한 파일의 `local-file-sampled-sha256-v1` 지문, 크기, 길이, media kind가 맞은 뒤에만 현재 session의 preview binding을 만든다.
8. 지문은 기본 9개 구간·최대 576KiB를 읽는 강한 재연결 신호이지 전체 파일 바이트 동일성 증명은 아니다.
9. 승인·제외 판단은 아직 SaveCommit으로 영속하지 않으므로 복원 후보는 모두 `검토 전`으로 시작한다. 이 단계는 `프로젝트 전체 복원`으로 표시하지 않는다.
10. IndexedDB에는 후보의 임의 설명 문장을 저장하지 않는다. `signalKinds`와 숫자 근거만 저장하고 화면 문구를 다시 생성한다.
11. 복구 원본 재연결은 임시 검사 뒤 일치가 확정될 때만 기존 binding을 교체한다. 이미 확인된 원본이 있으면 잘못된 재선택·검사 실패에도 preview를 유지한다.
12. 복구 결과 전환은 진행 중인 source·chat epoch를 모두 폐기한다. 분석 버튼 클릭과 첫 await 사이에는 별도 start-pending fence를 두고 원본·채팅·offset·중복 시작을 즉시 잠근다. 저장되지 않은 review 판단을 버리는 내부 이동과 페이지 이탈은 사용자 확인을 거친다.
13. 종료 readback과 durable recovery audit가 연달아 실패해도 `failing`·`cancelling` busy 상태에 사용자를 가두지 않는다. terminal write-once 경계는 유지하고 현재 입력을 잠금 해제한 뒤 recovery catalog 재확인 행동을 제공한다.

비종료 run의 interrupted 확정, checkpoint 재개, 검토 revision 복원, writer lease, migration audit는 이 슬라이스에 포함되지 않는다.

### 23.5 현재 구현된 초심자 결과 받기 슬라이스

앱 `0.2.1`은 분석 결과를 기술용 JSON으로만 내보내던 경계를 확장해, 승인한 후보를 개인 편집에 바로 쓸 수 있는 시간표로 만든다.

1. Export 입력은 현재 메모리에서 `approved`인 후보만 사용하며 시작 시각 오름차순으로 정렬한다.
2. 화면과 복사 목록은 시·분·초가 항상 있는 `HH:MM:SS–HH:MM:SS` 형식을 사용한다.
3. CSV는 UTF-8 BOM과 CRLF를 사용하고, 모든 cell을 quote/escape하며 `=`, `+`, `-`, `@`로 시작하는 문자열은 spreadsheet formula로 실행되지 않게 앞에 apostrophe를 붙인다.
4. Markdown은 사람이 읽는 이유·신호·근거와 함께 이 파일이 실제 영상 클립을 포함하지 않는다고 명시한다.
5. JSON은 기존 privacy-safe 목적을 유지한다. 원본 파일명·경로·File·Blob URL·채팅 원문·닉네임은 포함하지 않는다.
6. 브라우저 download 요청과 실제 디스크 영속 성공을 같은 완료 상태로 과장하지 않는다. UI는 `다운로드를 요청했어요`라고 표시한다.
7. 승인·제외 판단은 아직 SaveCommit이 아니므로 결과 파일을 받은 뒤에도 dirty review 안내와 이동 확인을 유지한다.

실제 MP4·WebM 클립 생성과 후보 시작·끝 경계 보정은 별도 RenderJob·Segment revision 슬라이스에서 구현한다.

### 23.6 반응 우선 fast-pass와 근거 설명 슬라이스

앱 `0.3.0`의 fast-pass는 화면 변화 중심 기준선에서 **스트리머 반응 중심 후보 생성**으로 책임을 바꾼다. 기존 `AnalysisRun` 중심 상태와 terminal 의미는 유지하되, 한 run 안의 독립 작업과 확정 근거를 다음처럼 확장한다.

1. run manifest가 확정된 뒤 `visual`, `audio`, 선택적 `chat` 작업을 병렬 시작한다. 세 작업은 같은 immutable source·chat sync·engine snapshot을 사용하고, 각 callback은 현재 App operation epoch와 AbortSignal을 모두 통과해야 UI를 바꿀 수 있다.
2. audio 작업은 로컬 `File`을 range 기반으로 읽고 짧은 decoded sample만 순차 처리한다. 전체 파일 ArrayBuffer나 전체 PCM을 만들지 않으며, sample은 처리 직후 닫고 최종적으로 input decoder를 정확히 한 번 dispose한다.
3. audio 작업의 영속 산출물은 1초 특징의 전체 배열이나 PCM이 아니라 계획/처리 bucket 수, decode coverage, gap reason, 그리고 최종 후보에 포함된 제한된 숫자 근거뿐이다. 원본 음성·대사·화자 식별값은 저장하지 않는다.
4. audio 작업 결과는 `complete`, `noAudioTrack`, `decoderUnavailable`, `failed`를 구분한다. `noAudioTrack`·`decoderUnavailable`은 입력 능력 gap으로 문서화하고 chat 기반 후보를 허용한다. 예기치 않은 worker 실패는 사용자가 오디오를 분석했다고 오해하지 않도록 gap 없이 조용히 성공 처리하지 않는다.
5. 후보 seed의 우선순위는 `audio reaction`과 `chat reaction`이다. visual scene change는 사건 전후 맥락·경계 보조 신호이며 단독으로 높은 신뢰 후보를 만들지 않는다. audio와 chat이 모두 없을 때만 소수의 visual 탐색 후보를 낮은 신뢰로 허용하고, 이를 반응 검출로 표현하지 않는다.
6. clip window는 반응 peak를 중앙에 고정하지 않고 원인 맥락을 더 많이 남긴다. 기본 45초에서 대략 60~65%를 peak 이전에, 나머지를 반응 이후에 배치하고 원본 0·끝 경계에서 30~60초 범위로 보정한다.
7. 후보 설명은 `사건 전조 → 스트리머 반응 → 시청자 반응 → 추천 이유`의 presentation projection이다. 임의 설명 문자열은 IndexedDB에 넣지 않고 `signalKinds`와 allowlist 숫자 근거로 다시 만든다.
8. 음성인식·자막이 없는 fast-pass는 특정 게임 사건, 승패, 인물, 발언을 단정하지 않는다. 이 경우 설명을 `신호 기반 추정`으로 표시하고, 화면 변화는 “사건이 있었을 가능성”, 오디오 envelope는 “큰 반응으로 들릴 가능성”, 채팅 burst는 “시청자 반응이 이어짐”처럼 관측과 추정을 분리한다.
9. 향후 candidate-only 로컬 STT가 붙으면 transcript span과 model revision을 별도 근거로 확정한 뒤에만 `자막 근거 해석`으로 승격한다. 늦은 의미 설명 revision은 사용자의 승인·제외·메모·경계를 덮어쓰지 않는다.
10. final result는 visual·audio·chat 작업이 모두 settle되고 각 계획 대비 coverage 또는 명시적 gap evidence가 맞으며 `activeTaskCountAtCommit === 0`일 때만 commit한다. reload recovery도 같은 불변식을 read-time에 재검증한다.

이 변경은 durable schema `0.3.0`을 사용한다. 앱은 `0.2.x` 완료 결과의 visual/chat 필드를 계속 읽을 수 있지만, 구버전 앱은 audio signal을 포함한 `0.3.0` 결과를 읽는 대상으로 두지 않는다. raw feature checkpoint·candidate-only STT·장문 의미 요약은 이 슬라이스 밖이다.

### 23.7 현재 구현하는 세션 구간 다듬기 슬라이스

앱 `0.3.2`는 실제 영상 렌더 전에, AI가 제안한 후보의 시작·끝을 사용자가 안전하게 다듬는 첫 Segment revision 경로를 제공한다. 아직 전체 Project·SaveCommit 영속화를 붙이지 않는 좁은 세션 기능이며 다음 규칙을 고정한다.

1. `UnifiedHighlightCandidate.startMs/endMs`는 AI `CandidateProposal`의 immutable 원본이다. 사용자 조작은 후보 객체를 덮어쓰지 않고 별도 `CandidateBoundaryRevision`에 `proposalRange`와 `effectiveRange`를 함께 기록한다.
2. 구간 편집 세션은 새 분석 결과나 복구 결과를 열 때마다 새 `boundarySessionId`를 받는다. 모든 command는 `boundarySessionId`, `candidateId`, `expectedRevision`이 현재 값과 정확히 일치할 때만 적용된다.
3. 초기 revision은 0이며 AI 제안 범위를 표시한다. 실제 사용자 명령이 적용될 때만 revision이 1씩 증가한다. “AI 제안으로 되돌리기”도 사용자의 명시적 채택이므로 새 revision과 `userResetToAi` provenance를 만들며 AI 자동 소유권으로 되돌리지 않는다. 이미 같은 범위에서 반복해서 누른 명령은 revision을 증가시키지 않는다.
4. 유효 범위는 정수 ms, `0 <= startMs < endMs <= sourceDurationMs`, `startMs <= peakMs <= endMs`를 만족한다. 길이는 원본이 30초 이상이면 30~60초, 더 짧으면 원본 길이에 맞춘다.
5. ±5초 명령은 원본 끝·길이·반응 정점 경계에서 가능한 일부만 움직일 수 있지만, 이 경우 UI가 실제 이동량과 제한 이유를 알리고 조용히 clamp하지 않는다. 재생 위치로 지정하는 명령은 정확히 적용하거나 이유 코드와 함께 거부한다.
6. 사용자가 승인 뒤 범위를 바꿔도 기본 `reviewState=approved`를 유지하고 “승인 유지 · 수정 구간 반영”을 표시한다. 별도 재승인을 기다려 최신 구간을 숨기지 않으며, 승인 취소 뒤 다시 승인하면 당시 boundary revision을 새 승인 기준으로 고정한다.
7. 미리보기 seek·자동 정지, 카드 시간, 승인 시간표, clipboard, CSV·Markdown·JSON은 모두 `effectiveRange` projection을 사용한다. 후보 ID·peak·점수·근거는 원래 AI proposal identity를 계속 사용하며 구간 변경으로 ID를 다시 계산하지 않는다.
8. JSON export는 proposal과 effective range를 구분하는 `0.4.0` 계약을 사용한다. 원본 파일·채팅 원문·닉네임을 포함하지 않는 기존 개인정보 경계는 그대로다.
9. 이번 revision은 메모리 세션에만 존재한다. 새 결과 열기·새 분석·새로고침에서는 폐기되며, beforeunload와 내부 이동 확인은 승인·제외뿐 아니라 구간 변경도 dirty 작업으로 취급한다. durable 후보 결과와 recovery payload에는 AI 제안만 남는다.

실제 Segment/SaveCommit 영속화, 제목·메모 편집, MP4·WebM RenderBatch는 다음 슬라이스다.

### 23.8 현재 구현하는 후보 전용 Pass B 전사 슬라이스

앱 `0.3.3`은 구조적 저장 구멍보다 사용자가 체감하는 AI 기능을 먼저 완성한다는 우선순위에 따라, fast-pass 후보를 바꾸지 않는 후보 전용 한국어 전사 overlay를 추가한다.

1. `CandidatePassBRun`은 한 번의 버튼 요청으로 새 `passBRunId`, `workerEpoch`, `taskId`를 받으며 중심 상태는 `idle → preparing → loadingModel → transcribing → finalizing → completed | completedWithGaps | cancelled | failed`다. 마지막 후보 결과는 성공이 아니라 `finalizing`까지만 허용한다.
2. 입력 snapshot은 현재 source binding, 분석 run ID, 후보 ID·proposal range·peak, 모델 ID·immutable revision, runtime device다. 실행 중 후보 구간이나 모델 설정이 바뀌어도 현재 run 입력은 바꾸지 않는다.
3. fast-pass 완료 결과와 검토 화면은 Pass B를 기다리지 않는다. 후보별 전사가 끝나면 fenced event로 해당 `candidateId`의 overlay만 추가한다.
4. 모든 Worker event는 `sessionId + writerEpoch + analysisRunId + passBRunId + workerEpoch + workerInstanceId + taskId + eventId`가 현재 값과 일치해야 한다. 늦은·중복·역순 결과는 무시하거나 run을 안전 실패시킨다.
5. overlay는 timestamp가 있는 짧은 자동 전사 추정과 품질 상태만 가진다. confidence와 VAD/no-speech처럼 서로 다른 품질 신호가 모두 확인된 경우에만 `grounded-transcript`로 승격할 수 있다. 현재 Worker처럼 timestamp·text만 제공하면 `provisional-transcript`로 남기고 사건·원인 설명은 fast-pass projection 그대로 유지한다. CandidateProposal의 점수·순위·경계와 `CandidateBoundaryRevision`, reviewState, approved revision을 자동 변경하지 않는다.
6. 후보 하나가 무음·낮은 신뢰·decode 실패여도 다른 후보를 계속 처리한다. 전체는 성공 후보와 명시적 gap의 합으로 완료하며, fast-pass 후보는 항상 보존한다.
7. 취소 요청 뒤 새 후보 전사를 시작하지 않고 현재 디코더·모델 작업을 정리한 뒤 ACK를 보낸다. 정상 ACK는 `workerAcknowledged`, 제한 시간 뒤 client가 Worker를 실제 terminate한 경우는 로컬 `CLIENT_FORCE_TERMINATED`의 `clientForceTerminated`로 구분한다. 둘 중 하나가 확인돼야 UI가 `취소됨`으로 확정되며 `cancelling`에 남지 않는다.
8. PCM, 전체 전사, File, Blob URL은 Worker 종료 뒤 폐기한다. `0.3.3`에서는 Pass B overlay도 세션 메모리에만 두고 기존 persistence schema `0.3.0`을 바꾸지 않는다. 새로고침 시 사라지고 현재 CSV·Markdown·JSON·clipboard에도 들어가지 않는다는 사실을 결과 패널과 dirty 안내에 표시한다.
9. 모델 다운로드와 캐시는 분석 실행과 다른 준비 단계다. UI는 다운로드 전 크기 범위와 이어질 분석 단계를 설명한다.
10. 무음·낮은 품질·모델 실패는 기존 `buildHighlightNarrative(candidate)`로 결정적으로 폴백하며 후보 검토·내보내기를 막지 않는다. 재시도는 후보별 같거나 더 높은 품질의 새 전사 cue가 생긴 경우에만 기존 overlay를 교체하고, 무음·실패·품질 하락 결과로 이미 찾은 cue를 지우지 않는다.

Worker가 오디오 트랙 부재나 미지원 컨테이너·코덱을 모델 로드 전에 확인하면 후보별 fenced gap을 보낸다. Client가 검증한 첫 gap을 받은 App는 `MODEL_BYPASSED(reasonCode)`를 reducer에 적용한다. 이는 모델이 준비됐다고 가장하는 전이가 아니라, `loadingModel → transcribing`에서 각 후보를 명시적 처리 gap으로 종결할 수 있게 하는 파생 전이다. 첫 gap 직전에 한 번만 허용하며 이후 후보 순서와 event fence는 일반 경로와 동일하다.

모든 후보가 terminal outcome을 가져도 Worker 완료 envelope가 오기 전에는 `finalizing`이다. Client가 terminal candidate ID와 `requestedCount/completedCount/gapCount`를 검증한 뒤 App가 identity-fenced `RUN_COMPLETED`를 보내며, reducer가 snapshot과 후보별 `workerDisposition=result|gap` 집계를 다시 맞춘 경우에만 최종 완료한다. 누락·중복·개수 불일치는 성공 UI로 투영하지 않고 `RUN_FAILED(protocol_error)`로 종결한다.

이번 슬라이스에서는 생성형 사건 요약, 음향 사건 분류, 자동 재랭킹·자동 경계 변경, Pass B 영속화, SaveCommit, 다중 탭 writer lease를 구현하지 않는다.

### 23.9 현재 구현하는 후보 전용 오디오 사건 분류 슬라이스

앱 `0.3.4`는 `CandidatePassBRun`을 확장하지 않고 독립 `CandidateAudioEventRun`을 둔다. 전사 성공을 음향 사건 성공으로 오인하거나 한 모델의 실패가 다른 근거를 지우지 않게 하기 위해서다.

1. run snapshot은 source binding, fast-pass `analysisRunId`, 후보 ID·proposal range·reaction peak, 모델 ID·immutable revision·dtype, audio-event protocol version을 고정한다.
2. 중심 상태는 `idle → preparing → loadingModel → classifying → finalizing → completed | completedWithGaps | cancelled | failed`다. 후보별 상태는 `pending → classifying → detected | noClearEvent | failed`이며 terminal에서 역행하지 않는다.
3. 모든 Worker event는 `protocolVersion + sessionId + writerEpoch + analysisRunId + audioEventRunId + workerEpoch + workerInstanceId + taskId + eventId`가 현재 snapshot과 일치하고, event ID가 처음이며, 예상 후보 순서를 지켜야 한다.
4. 마지막 후보 event는 `finalizing`까지만 이동한다. Client가 requested candidate ID 집합, result/gap 집합, `requestedCount/completedCount/gapCount`가 정확히 맞는 완료 envelope를 검증한 뒤에만 `RUN_COMPLETED`를 적용한다.
5. overlay는 allowlist 반응 종류, `strong | possible`의 정성 강도, 근거 10초 범위와 `provisional-audio-event` 품질만 가진다. raw PCM·전체 527 라벨 배열·임의 생성 설명은 App으로 보내거나 저장하지 않는다.
6. overlay merge는 같은 `candidateId`의 기존 `strong` 근거를 `possible`, no-clear, gap으로 낮추거나 지우지 않는다. 늦은 event는 CandidateProposal, 후보 순서·점수, `CandidateBoundaryRevision`, reviewState, 전사 overlay를 변경할 수 없다.
7. source separation이 없으므로 `스트리머가 웃었다`처럼 주체를 확정하지 않는다. `오디오에서 웃음으로 들리는 반응`과 확인 위치만 표시하고, 사람의 재생 확인 뒤에도 자동으로 사건 원인·승패·감정 필드로 승격하지 않는다.
8. 취소는 협력적 ACK 뒤 `workerAcknowledged`, 제한 시간 뒤 실제 terminate는 `clientForceTerminated`로 종결한다. 취소 뒤 새 후보를 시작하지 않고 File/Input/PCM/model 참조를 폐기한다.
9. 이 overlay는 세션 메모리 전용이며 persistence schema `0.3.0`, export schema `0.4.0`을 바꾸지 않는다. 새 분석·복구 결과로 이동할 때 폐기하고 dirty 안내와 내보내기 제외 문구에 포함한다.
10. 오디오 사건 run 실패는 fast-pass·전사·검토·내보내기의 성공 여부를 바꾸지 않는다. 재시도는 새 run identity를 사용하고 이미 찾은 같거나 더 높은 품질 근거를 보존한다.

후속 `CandidateRankingProposal`은 별도 `rankingRevision`과 제안 순서를 가지며 현재 검토 배열을 직접 정렬하지 않는다. 사용자가 `새 추천 순서 적용`을 누르기 전까지 카드 위치와 초점, 승인·제외·구간 revision은 그대로 유지한다.

### 23.10 현재 구현하는 후보 검토 우선순위 제안 슬라이스

앱 `0.3.5`는 fast-pass canonical 후보 배열과 화면에 보이는 검토 순서를 분리한다. 중심 상태는 `CandidateRankingViewState` 하나이며 `canonicalOrderIds`, `activeOrderIds`, `viewOrderRevision`, `latestProposal`, `undoOrderIds`를 함께 소유한다. 서로 독립된 여러 boolean을 조합해 적용 여부를 추정하지 않는다.

1. `CANDIDATE_SET_REPLACED`는 새 `rankingSessionId`와 후보 ID의 중복 없는 canonical 순서를 받고 `activeOrderIds=canonicalOrderIds`, `viewOrderRevision=0`, proposal·undo 없음으로 초기화한다. 새 분석·복구 결과 열기·결과 비우기는 반드시 이 전이를 지난다.
2. `PROPOSAL_READY`는 현재 session, 후보 집합 지문, 근거 지문, `expectedViewOrderRevision`, 제안 전 전체 순서가 모두 맞고 `orderedCandidateIds`가 현재 후보의 완전한 permutation일 때만 채택한다. 이 전이는 `activeOrderIds`를 절대 바꾸지 않는다.
3. `APPLY_PROPOSAL`은 latest proposal이 fresh이고 현재 session·후보·근거·화면 revision이 proposal snapshot과 일치할 때만 허용한다. 기존 `activeOrderIds`를 한 단계 `undoOrderIds`로 보존하고 제안 permutation을 active로 만든 뒤 `viewOrderRevision`을 증가시킨다.
4. `UNDO_APPLIED_ORDER`는 보존된 전체 순서를 active로 복원하고 revision을 증가시킨다. 후보 객체, reviewState, approved boundary revision, preview candidate ID, 전사·오디오 사건 overlay는 ID로 연결된 그대로다. 반복 undo는 멱등적으로 무시한다.
5. `EVIDENCE_CHANGED`는 proposal의 근거 지문과 새 지문이 다를 때 `fresh → stale`로만 이동한다. stale proposal은 적용할 수 없다. 이미 적용한 `activeOrderIds`와 undo는 그대로 보존해 화면을 몰래 재정렬하지 않는다.
6. 적용 상태에서 새 제안을 바로 덮어쓰지 않는다. 사용자는 먼저 `이전 순서로 되돌리기`를 눌러 명시적으로 현재 보기 순서를 정리한 뒤 새 proposal을 만든다. 이 제약은 새 제안 생성이 암묵적 undo가 되는 일을 막는다.
7. 카드 projection은 `activeOrderIds`로 candidate ID를 조회해 만든 `orderedCandidates`만 사용한다. 카드 번호, aria-label, preview candidate number, “보던 곳으로 돌아가기” anchor도 같은 projection을 사용한다. 가능하면 DOM anchor는 배열 index가 아니라 안정적인 candidate ID를 사용한다.
8. review update와 boundary revision은 계속 candidate ID 기준이다. Pass B와 audio-event target selection은 canonical candidate score 기준이며 화면 순서에 의존하지 않는다. 승인 시간표와 모든 export는 effective start time 순이라는 기존 계약을 유지한다.
9. 제안 지문은 전사 원문·채팅 원문·파일명 없이 결정적으로 만든다. candidate-set 지문은 ID·fast-pass score·signal kinds와 랭킹이 실제 읽는 normalized evidence를, evidence 지문은 후보별 전사 품질 상태, audio-event 전체 coverage 여부와 정성 kind/strength·고정 model revision·후보 범위만 포함한다. overlay가 source run ID를 보존하지 않는 현재 계약에서는 특정 현재 run의 결과라고 귀속하지 않는다. text·raw model score·PCM은 상태 machine 경계에 들어가지 않는다.
10. ranking proposal의 수명은 현재 탭뿐이다. proposal 생성이나 적용이 시작되면 beforeunload·내부 이동 경고의 session-only 작업에 포함하되 IndexedDB final result와 현재 export schema에는 넣지 않는다.

금지 전이는 오래된 proposal 적용, 일부 후보만 든 permutation 적용, 중복 ID 적용, stale proposal 적용, proposal 생성만으로 active order 변경, 적용·undo로 후보 객체나 사용자 판단 변경, ranking order를 export 순서로 재사용하는 것이다.

### 23.11 현재 구현하는 근거 기반 후보 설명 projection

앱 `0.3.6`의 `CandidateEvidenceExplanation`은 새 비동기 run이나 저장 entity가 아니다. 현재 candidate와 세션 전용 refinement evidence를 읽어 화면에 투영하는 순수 값이며, 근거가 바뀔 때 다시 계산되지만 후보·review·boundary·ranking state를 변경하지 않는다.

1. 입력 binding은 candidate ID, AI proposal range·peak, 현재 effective range다. Pass B의 candidate ID 또는 audio-event의 candidate ID·proposal range·reaction peak가 다르거나 effective range가 유한한 정방향 구간이 아니면 typed error로 거부한다. App은 그 카드의 정밀 overlay를 모두 격리하고 검증된 fast-pass evidence와 AI 원래 구간으로 설명을 다시 만들어 전체 후보 목록을 보존한다.
2. 출력은 version, candidate ID, 안전한 headline, basis code가 있는 사건 단서·반응 단서·검토 이유, 정해진 순서의 관측 목록, 모르는 점, primary replay focus다. `semanticEvent`, actor, cause, outcome 같은 확정 필드는 만들지 않는다.
3. provisional transcript는 인용과 replay cue만 추가한다. 문구가 승리·실패·인물·감정을 말해도 사실 필드나 clip-worth로 복사하지 않는다. audio-event는 혼합 방송 오디오의 정성 종류 cue만 추가하고 주체를 지정하지 않는다.
4. primary focus는 `strong audio-event → possible audio-event → near-peak transcript → before/after transcript → reaction peak` 순으로 고른다. 동일 등급은 peak 거리·시각·enum 순이며 입력 배열 순서에 영향을 받지 않는다.
5. effective boundary 밖 cue는 없애거나 새 경계에 맞춘 척하지 않는다. `insideEffectiveRange=false`와 `현재 구간 밖`을 표시한다. 카드의 기본 재생은 사건 전 문맥을 위해 항상 현재 구간 시작에서 재생하고, 상세 설명의 AI 확인 위치 버튼만 현재 구간의 reaction peak, 그것도 밖이면 현재 구간 시작으로 안전하게 fallback한다. 경계 revision이 있으면 상세 설명이 AI 최초 후보 근거라는 안내를 표시한다.
6. 후보 0개는 정밀 기능·랭킹을 모두 숨긴다. 후보 1개는 Pass B·audio-event·후보 검토를 허용하되 ranking comparison을 숨긴다. 후보 2~12개만 ranking panel을 표시한다.
7. ranking disposition이 stale이면 생성 당시 reason code와 현재 evidence map을 다시 조합하지 않는다. 후보별 이유 상세를 숨기고 최신 근거로 새 제안을 만드는 경로만 안내한다. 적용 상태는 자동 undo하지 않는다.
8. 설명 projection은 현재 탭 전용이며 dirty 상태를 새로 만들지 않는다. 기존 Pass B/audio-event가 dirty 의미를 소유하고 새 분석·복구·새로고침에서 함께 사라진다. persistence `0.3.0`, export `0.4.0`은 그대로다. 기존 export 문장은 안전한 fast narrative만 사용하되 사용자-facing 열 이름과 문구를 `혼합 방송 오디오 반응 단서`, `채팅 반응 단서`, `사건 단서`로 낮춘다.

금지 전이는 provisional transcript로 headline·clip-worth 변경, audio-event를 스트리머 반응으로 귀속, chat author key를 실제 사람 수·합의로 표현, visual change를 사건 원인으로 표현, boundary 밖 cue를 현재 구간 안처럼 재생, stale ranking 이유와 최신 evidence 혼합이다.

### 23.12 `0.3.7` Gemini 후보 정밀 분석 전이

기존 `CandidatePassBRun`의 identity, 후보 순서, terminal envelope 계약은 유지하되 실행 주체를 Whisper tiny에서 기본 Gemini 요청으로 바꾼다. 상태 이름 `loadingModel`은 하위 호환을 위해 이번 patch에서 유지하지만 UI 의미는 `Gemini 연결 준비`이며 모델 다운로드를 뜻하지 않는다. snapshot의 runtime은 `remote`, 운영 후보 지각 모델은 `gemini-3.5-flash` 고정 manifest 값이다. 별도의 전체 문맥·재판정 단계가 추가되더라도 기존 Pass B snapshot을 다른 모델 결과로 덮어쓰지 않고 독립 revision으로 저장한다.

1. `START_REQUESTED` 전 guard는 현재 source binding·analysis run·후보 snapshot, 정밀 분석 runtime 가용성을 요구한다. API key와 동의 필드는 App state, durable snapshot, Worker protocol 어디에도 두지 않는다.
2. App가 `WORKER_PREPARED`를 수용한 뒤 Worker의 즉시 `MODEL_READY`를 받아 `loadingModel → transcribing(firstCandidateId)`로 이동한다. 이는 API 성공이나 키 유효성 성공을 뜻하지 않고 요청 실행기가 준비됐다는 의미뿐이다.
3. Worker는 active candidate 하나만 디코드하고 WAV로 만든 뒤 고정 중계 계약을 호출한다. 응답이 와도 실행 snapshot의 candidate ID·range를 다시 주입하고 client exact-key·timeline fence와 reducer의 active candidate·expected proposal revision을 모두 통과하기 전에는 화면 evidence map을 갱신하지 않는다.
4. 구조화 결과가 유효하고 표시할 대사가 있으면 `CANDIDATE_CLUE_FOUND`, 대사가 없지만 유효한 오디오 해석만 있으면 해석 존재를 별도 key-free session map에 보존하되 후보 outcome은 명시 계약에 따라 clue 또는 no-clear 중 하나로 정확히 종결한다. 아무 근거도 없으면 `CANDIDATE_NO_CLEAR_SPEECH`다.
5. 중계 설정 오류, 할당량, 네트워크·서비스 실패는 run-level redacted failure로 종결해 남은 후보 요청을 계속 보내지 않는다. 한 후보의 로컬 decode·무음·구조 오류는 candidate gap으로 격리하고 다음 후보를 계속한다. 중계는 `5xx/408`에만 짧은 지수 backoff로 최대 두 번 재시도하며, 앱 run이나 400·401·403·429는 자동 반복하지 않는다.
6. `CANCEL_REQUESTED`는 Worker의 현재 fetch AbortController와 media Input을 취소한다. 올바른 identity의 ACK만 `cancelled(workerAcknowledged)`로 만들고 제한 시간 뒤 실제 terminate만 `clientForceTerminated`다. abort 뒤 Gemini 응답, 이전 run 응답, 중복 event는 모두 무변경 거부한다.
7. 마지막 후보 결과는 계속 `finalizing`까지만 이동한다. Client가 terminal candidate ID와 requested/result/gap 수를 검증한 completion envelope를 보낸 뒤 reducer가 다시 합계를 맞춘 경우에만 `completed | completedWithGaps`다.
8. Gemini key, WAV, PCM, Base64 request, API 오류 원문은 state, React diagnostic, persistence, export에 들어가지 않는다. transcript와 interpretation도 이번 단계에서는 현재 탭 session projection이며 새 source·새 analysis·recovery·reload에서 사라진다.
9. 재시도는 새 `passBRunId/workerEpoch/workerInstanceId/taskId`를 만든다. 새 run의 후보별 유효 결과만 기존 같은 후보의 단서를 교체하고, 인증·무음·실패·낮은 품질로 기존의 더 좋은 단서를 지우지 않는다.
10. Gemini 해석은 canonical 후보, fast score, ranking evidence, effective boundary, review state의 input이 아니다. 사람이 재생해 확인하기 전에도 후에도 자동으로 사실 필드나 승인 상태로 승격하지 않는다.

금지 전이는 운영 키를 durable snapshot에 저장, model 응답 candidate ID 신뢰, reducer 수용 전 evidence 기록, API 오류 원문 표시, 429 자동 반복, Gemini 문장으로 점수·순위·경계·승인 변경이다.

### 23.13 `0.3.26` 편집자 작업공간의 후보 포커스 projection

후보 검토 화면은 목록의 모든 상세 카드를 동시에 펼치지 않고, 타임라인에서 고른 후보 하나를
재생·판단하는 편집자 작업공간으로 투영한다. 이를 위한 `CandidateReviewFocus`는 영구 entity나
분석 결과가 아닌 현재 탭의 표현 상태다.

| 현재 상태 | 이벤트 | 다음 상태 | 데이터 영향 |
|---|---|---|---|
| `null` | 후보 집합 공개 | 화면 순서의 첫 후보 ID | 없음 |
| 유효한 후보 ID | 타임라인·이전·다음 후보 선택 | 선택한 후보 ID | 없음 |
| 유효한 후보 ID | ranking 화면 순서 변경 | 같은 후보 ID 유지 | 없음 |
| 없어진 후보 ID | 후보 집합 교체 | 새 화면 순서의 첫 후보 ID 또는 `null` | 없음 |
| 임의 상태 | 새 분석·결과 비우기 | `null` | 없음 |

불변식은 다음과 같다.

- 포커스 변경은 후보 점수·canonical 순서·추천 순서·구간·승인·제외·export 순서를 바꾸지 않는다.
- 포커스는 dirty 작업으로 취급하지 않고 IndexedDB·프로젝트 백업·분석 결과에 저장하지 않는다.
- 원본이 연결되지 않아 재생할 수 없어도 후보 포커스와 시간표·AI 설명 검토는 가능하다.
- 재생 상태는 포커스와 별도다. 포커스가 바뀌면 해당 후보 시작점을 정지 상태로 준비할 수 있지만,
  사용자가 재생을 요청한 뒤에만 재생하며 후보를 표시했다는 사실만으로 자동 승인하지 않는다.
- 후보 집합이나 화면 순서가 바뀌어도 현재 ID가 존재하면 같은 후보를 계속 보여 준다.

## 24. 구현 전 최종 체크리스트

- [ ] PRODUCT_PLAN 8.4와 이 문서의 대상별 machine을 코드 reducer로 구현
- [ ] SourceDefinition portable data와 기기 로컬 SourceBinding을 별도 store·schema로 분리
- [ ] AnalysisSpec과 AnalysisRun attempt를 데이터 모델에서 분리
- [ ] Segment revision과 CandidateProposal revision을 분리
- [ ] 모든 Worker message에 sessionId, writerEpoch, runId, chunkId, eventId 포함
- [ ] SourceCheck resultKind와 lifecycle status 분리
- [ ] partial result를 terminal status 대신 보조 결과로 표현
- [ ] pause·cancel·complete의 ACK와 commit 조건 구현
- [ ] Web Locks writer와 IndexedDB epoch fence 구현
- [ ] BroadcastChannel을 알림 전용으로 제한
- [ ] IndexedDB transaction별 fault injection adapter 구현
- [ ] migration journal과 backup 검증 구현
- [ ] render outputSafety 재검증 구현
- [ ] 일반 다운로드와 실제 저장 확인 문구 분리
- [x] 완료 terminal의 manifest·final·artifact·coverage를 재검증하는 첫 화면 recovery catalog 구현
- [ ] 비종료 run·checkpoint·검토 revision까지 포함한 전체 새로고침 recovery audit 구현
- [ ] 상태별 초심자 문구와 허용 action을 machine에서 파생
- [ ] 전이표·금지 전이·불변식 자동 테스트를 CI gate로 고정
- [ ] 선택형 CHZZK 로컬 수집기의 STOP_COMMITTED·JSONL recovery·credential redaction 테스트 구현

## 25. 최종 결정

ExClipper는 개인 편집 어시스턴트이므로 계정·공유·원격 동기화를 설계하지 않는다. 대신 한 사람의 로컬 작업도 수시간 분석과 대용량 파일을 다루는 만큼 다음을 제품 품질의 필수 조건으로 본다.

- AI 실행과 사람 편집의 소유권 분리
- 요청과 실제 확정의 구분
- 늦은 Worker 이벤트 차단
- 원자 저장과 새로고침 복구
- 다중 탭 단일 writer
- 안전한 migration과 출력 검증
- 상태별 정직한 초심자 UI

구현은 화면 컴포넌트보다 이 문서의 reducer, 식별자, transaction fence, 전이 테스트를 먼저 작성한 뒤 진행한다.

## 26. `0.3.25` provider 선택과 전체 맥락 계약

1. `CANDIDATE_INSIGHT_PROVIDER`가 없으면 `gemini`로 해석한다. 알 수 없는 값, 빈 credential, 제어 문자가 포함된 credential은 Worker가 upstream 호출 전에 fail-closed 한다.
2. `qwen`은 catalog와 `QWEN_API_KEY`·`QWEN_WORKSPACE_ID`·허용 region 연결 해석까지만 준비한다. 구현 상태가 `prepared`인 동안 후보 endpoint는 `PROVIDER_NOT_ACTIVE`로 끝나며 Gemini나 임의 endpoint로 조용히 fallback하지 않는다.
3. `BROADCAST_CONTEXT_PROVIDER`가 없으면 `disabled`다. `deepseek`를 선택해도 별도 context reducer가 구현되기 전에는 현재 Candidate Pass B run을 시작하거나 변경하지 않는다.
4. provider readiness는 credential 원문, Workspace ID, endpoint를 포함하지 않는다. 상태·React diagnostic·IndexedDB·export·오류 본문에도 이 값들을 기록하지 않는다.
5. 전체 맥락 request는 `schemaVersion/sourceDurationMs/chapters/candidates`만 가진다. chapter는 시간순·비중첩이며, candidate는 현재 run의 기존 ID와 범위·전사·사건/반응 요약만 snapshot한다.
6. 전체 맥락 result는 기존 candidate ID에 대한 설명·분류 projection이다. score, rank, range, boundary revision, review state, approval을 소유하지 않으며 해당 상태로 가는 reducer transition도 없다.
7. 미래 context reducer는 현재 session·analysis run·provider manifest·candidate set fingerprint를 모두 검사한 뒤에만 annotation을 수용해야 한다. mismatch, 중복 event, 늦게 도착한 응답은 무변경 폐기한다.
8. provider 전환은 새로운 model manifest revision과 새 run에서만 가능하다. 이미 저장된 Gemini 결과의 model identity를 Qwen이나 DeepSeek로 다시 쓰지 않는다.

## 27. `0.3.28` 방송 문맥 세션과 의미 후보

1. 빠른 분석이 terminal이면 후보 AV 검증과 방송 transcript를 독립 phase로 시작한다. 어느 한 phase의 실패가 빠른 후보나 다른 phase의 성공 결과를 지우지 않는다.
2. transcript session은 `idle | running | completed | completedWithGaps | failed | cancelled`로 전이한다. chunk 결과는 현재 source/session/operation identity와 순서를 모두 통과해야 chapter 집계에 들어간다.
3. context는 transcript가 사용 가능한 terminal이고 후보 Pass B가 terminal일 때 시작한다. 입력 서명은 source duration, 시간순 chapter, gap, 후보 ID·범위·허용 요약, provider/model revision을 포함한다.
4. context result는 기존 후보의 `selected | review | rejected` projection과 chapter에 근거한 discovered lead를 가진다. 기존 후보의 점수·경계·사람 판단을 수정하지 않으며, 화면 목록은 projection으로 rejected 후보를 숨길 수 있다.
5. 의미 lead refinement는 최대 4개·총 예상비 `$0.03`·구간당 70초를 넘지 않는다. chapter 핵심어와 재전사 문구가 맞고 range가 30~60초일 때만 `semantic` 후보를 만든다. 60% 이상 겹친 기존 후보가 있으면 기존 후보를 유지한다.
6. transcript의 source-fenced partial chapter는 남은 청크를 gap으로 표시한 checkpoint로 write/readback하며, 다음 실행은 uncovered range만 이어 받는다. context/refinement의 성공 payload는 각각 입력 서명과 함께 `broadcastContextSessions` store에 write/readback 검증한다. failed·cancelled payload는 호환되는 complete 결과를 덮어쓰지 않는다.
7. 복구 시 원래 fast 후보를 먼저 열고 context session에서 의미 후보를 재구성한다. `semantic-` ID의 저장된 Pass B evidence·Gemini insight·thumbnail도 먼저 보존해 의미 후보가 나타난 뒤 같은 유료 검증을 다시 예약하지 않는다.
8. 새 source 선택, 분석 초기화, recovery 교체, component unmount는 transcript/context/refinement AbortController와 operation epoch를 모두 폐기한다. 뒤늦은 응답은 저장·화면·후보 목록을 변경할 수 없다.
## Candidate participant attribution (schema 1.2.0)

Candidate Pass B may persist `identifiedParticipants` inside each paid insight. This is
an evidence-bound attribution, not open-world face or voice recognition. A participant
is emitted only when the candidate contains an on-screen name, an audible self/name
call, or a match against the fixed `chzzk-video-13996057-v1` virtual-avatar roster.

- `displayName`: normalized observed or registered name. A roster match requires at
  least two distinct same-frame visual traits and confidence `>= 0.88`; hair color or
  voice resemblance alone is rejected.
- `role`: `streamer`, `guest`, or `unknown`.
- `evidenceBasis`: `on-screen-name`, `spoken-name`, or `provided-cast-reference`.
- `evidenceKo`: short Korean statement of the evidence the editor can verify.
- `confidence`: finite value in `[0, 1]` and `relativeTimestampMs`: a bounded point in
  the candidate used to inspect the attribution.

The field is optional while reopening schema 1.0.0/1.1.0 sessions. New schema 1.2.0
results always write an array, including an empty array when the model has no grounded
name. Candidate identity never changes score, eligibility, approval, or clip bounds.
It is display evidence only. The fixed roster ID is expanded server-side, and arbitrary
browser-supplied roster text is rejected. Repeated names may be grouped in presentation,
but the original per-candidate evidence, relative timestamp, and uncertainty remain.
