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
| `verificationReceiptById` | `storage/candidatePassBInsightStore.ts` | 검증 영수증. current `1.2.0`은 map key와 같은 `candidateId`·source start/end·routing revision·context fingerprint를 exact fence로 저장 |
| `modelByCandidateId` | `storage/candidatePassBInsightStore.ts` | 후보별 사용 모델 |
| `contentFingerprint` | `storage/durableAnalysisPayload.ts` | 콘텐츠 지문. **캐시의 조회 키가 된다** |
| `rankPercentile` | `storage/durableAnalysisPayload.ts` | 내부 계산용. **사용자에게 보이면 안 된다** |
| `refinementTranscriptInputSignature` | `storage/broadcastContextSessionStore.ts` | 자막 없는 의미 refinement 전사 계획의 exact input fence |
| `refinementTranscriptCheckpointJson` | `storage/broadcastContextSessionStore.ts` | 성공 조각·무발화/무오디오 abstention·미해결 gap의 canonical per-fragment checkpoint |
| `job.runIds` | `storage/analysisResultStore.ts` (`analysisJobs`) | 이력용이 아니라 **삭제용**. 없으면 실행 결과가 고아로 남는다 |
| `handle` | `storage/sourceHandleStore.ts` | **별도 DB.** JSON 이 아니라 기존 저장소가 거부한다 |

**저장되지 않는 것** (메모리에만 존재 — 새로고침하면 사라짐):

| 값 | 비고 |
|---|---|
| 통합 타임라인 4컷 프레임 | 저장 예정 (상태 모델 §7) |

### 데이터베이스가 둘인 이유

| DB | 무엇 | 왜 갈렸나 |
|---|---|---|
| `exclipper-analysis-results-v1` | 현재 ExClipper 작업 + 실행 결과 | 구버전 DB를 열거나 마이그레이션하지 않으며, 작업을 지울 때 그 작업의 실행 결과도 **한 트랜잭션**에서 지워야 한다 |
| `exclipper-source-handles-v1` | 현재 ExClipper 파일 핸들만 | 구버전 핸들을 재사용하지 않으며, 핸들은 JSON 이 아니므로 결과 저장소의 JSON 전용 검증에 구멍을 내지 않는다 |

핸들은 경로 참조라 아주 작으므로 고아가 남아도 `deleteOrphans` 로 쓸면 된다.
실행 결과는 그렇지 않다 — 남으면 화면에 안 보이는 채로 용량을 계속 차지한다.

`storage/analysisResultStore.ts` 는 **JSON 만 받는다.** `Blob`·`File`·핸들은 거부한다
(`validateAndClone*`). base64 문자열은 JSON 이므로 통과한다.

---

## 2. 파일명이 개념과 다른 것

| 파일 | 실제 책임 |
|---|---|
| `analysis/broadcastTranscriptQwen.ts` | 이름과 달리 방송 전사의 provider-neutral 계약이다. Qwen·Gemini·Groq 요청/응답 검증, model ID/revision, 공통 `BroadcastTranscriptQwenResult`를 소유한다. Groq는 서버가 만든 URL 또는 bounded WAV만 받고 한국어·segment timestamp를 검증한다. |
| `analysis/youtubeCaptionSandbox.ts` | opaque iframe의 수명·nonce/request ID·postMessage source fence와 JSON3 재검증을 소유한다. 자막 transport의 순서는 이 모듈 뒤 `youtubeCaptionClient.ts`의 Worker fallback으로 이어진다. |
| `public/youtube-caption-sandbox.html` | source file·저장소·credential에 접근하지 않는 `allow-scripts` 전용 iframe 실행부다. Android player와 timedtext만 fixed-host로 읽고 bounded 원문을 부모 검증기로 돌려준다. |
| `analysis/channelPreanalysisSources.ts` | 네 YouTube 선분석 source의 canonical channel ID·handle·playlist·storage namespace와 single/combined replay 정책을 소유한다. |
| `analysis/channelPreanalysisCatalog.ts` | configured YouTube playlist feed, 원격 영상 생애주기, exact/probable 로컬 identity 매칭 규칙을 소유한다. sampled SHA는 등록된 동일 파일끼리만 비교한다. |
| `analysis/channelPreanalysisBundle.ts` | 공개 자막·연속 챕터·선분석 맥락을 담는 provider-neutral bundle 스키마와 transcript SHA-256 검증을 소유한다. 예약 맥락의 자막 전용 evidence scope, 로컬 visual 검증 필요 여부와 proxy contract·routing·실제 model ID/revision의 bounded `contextReceipt`도 보존한다. |
| `analysis/channelPreanalysisClient.ts` | raw catalog branch → Pages fallback, 네 source의 manifest-only 병렬 목록 조회, revision별 immutable bundle·시각 지문·review artifact의 bounded fetch와 manifest-bound SHA-256 readback을 소유한다. `review-ready`는 exact identity와 transcript/context/review closure가 모두 일치할 때만 반환한다. |
| `analysis/channelPreanalysisReviewBundle.ts` | 최대 12개 최종 후보의 전체 맥락, participant grounding, 후보별 context/evidence/AI receipt, 서로 다른 JPEG 4장, 대표 thumbnail과 `review-ready | verified-empty` certificate를 4MiB 안에서 봉인한다. |
| `analysis/channelPreanalysisVisualFingerprint.ts` | 원격 12-anchor 화면 지문 schema, 32×18 luma에서의 dHash/blockHash·밝기·edge 비교, 3등분 coverage, 유일 합의와 단일 후보 bounded offset 복구를 소유한다. 오디오 landmark는 이 모듈의 현재 계약이 아니다. |
| `analysis/channelPreanalysisBundleBinding.ts` | 현재 로컬 source 지문, 실제로 검증해 읽은 bundle bytes, manifest의 exact artifact ID·SHA-256을 하나의 원자적 receipt로 묶는다. manifest가 바뀌거나 병렬 lookup 자료가 섞이면 자막·맥락 seed 사용을 거부한다. |
| `analysis/channelPreanalysisLocalBinding.ts` | 편집자가 확인한 로컬 sampled-file 지문과 configured source/channel/video의 브라우저 내 exact 연결을 소유한다. source pair가 다르거나 손상된 자료는 신뢰하지 않으며 최근 256개만 유지한다. |
| `analysis/channelPreanalysisTrust.ts` | 명시 URL, 등록 로컬 지문, 편집자 확인, `visual-fingerprint-consensus`, 파일명 단서의 우선순위와 원격/로컬 시간축 compatibility를 분리해 roster·caption·bundle 사용 권한을 결정한다. |
| `analysis/channelPreanalysisContextSeed.ts` | 검증된 자막 기반 전체 맥락을 현재 로컬 챕터 시간축에 재매핑한다. exact source identity와 provenance가 없거나 coverage gap을 건너면 거부하며 후보 annotation은 가져오지 않는다. |
| `app/channelPreanalysisVisualIdentity.ts` | App의 로컬 영상 화면 검증 orchestration이다. 단일 probable 후보 또는 이름이 완전히 바뀐 duration cohort의 공통 sampling plan을 한 번 실행하고, 유일한 합의일 때만 snapshot-bound exact lookup을 반환한다. |
| `media/localVideoVisualAnalysis.ts` | 로컬 파일의 지정 source 시각을 seek·decode하고 원본 pixel buffer를 남기지 않는 고정 32×18 luma 표본으로 축소한다. 표본은 지문 비교 직후 명시적으로 지운다. |
| `../scripts/channel-preanalysis-visual-fingerprint.mjs` | bounded YouTube storyboard metadata·sheet를 받아 12개 분산 anchor의 manifest-bound 시각 지문 artifact를 생성한다. sheet host·개수·bytes와 이미지 decode를 제한한다. |
| `../scripts/channel-preanalysis-upload-preflight.mjs` | 네 Atom feed를 bounded fetch해 게시 후 7일 이내 due transcript/context/review 작업만 판정하는 무과금 스캔을 소유한다. |
| `../scripts/sync-amoretto-preanalysis.mjs` | 네 공식 playlist feed reconciliation, 게시 후 7일 자동 선택, 전역 최대 2개 fair scheduling, pinned `yt-dlp` 한국어 자막 gate, 수동 exact 영상만의 예약 ASR fallback, source별 immutable bundle-first commit과 단계별 retry checkpoint를 수행한다. |
| `../scripts/lib/channel-preanalysis-media.mjs` | 정확한 YouTube 분석 사본의 bounded 다운로드·12시간/16GiB probe·전체 1초 오디오 특징 스트림·후보별 JPEG 4장과 16kHz WAV 추출을 소유한다. |
| `../scripts/lib/channel-preanalysis-scheduled-asr.mjs` | 특정 video ID로 명시한 자막 없는 VOD의 수동 복구에서 audio-only 다운로드, 90초 canonical WAV, private R2 stage/resolve, Groq timestamp·보수적 no-speech와 range별 atomic resume를 소유한다. 자동 7일 queue는 이 경로를 호출하지 않는다. |
| `../scripts/lib/channel-preanalysis-review-runner.mjs` | 전체 오디오 신호와 의미 lead를 최대 12개로 융합하고, 화면이 모두 준비된 후보만 AI에 보내 최종 검증 certificate를 만든다. |
| `../scripts/lib/channel-preanalysis-review-checkpoint.mjs` | source/video/context/revision/pipeline에 봉인된 후보별 완료·제외·재시도 결과를 4MiB 안에서 원자 보존하고 게시 성공 뒤에만 삭제한다. |
| `../scripts/lib/channel-preanalysis-review-candidate-client.mjs` | 후보 WAV·JPEG를 private R2에 stage하고 맥락을 전용 Worker로 보낸다. 만료 가능한 transport ticket과 고정 semantic operation을 분리해 409·429·5xx를 복구하며 실제 model receipt를 runner 계약으로 봉인한다. |
| `../scripts/lib/channel-preanalysis-review-publisher.mjs` | 완전한 review bundle을 immutable write/readback한 뒤에만 catalog를 `review-ready`로 바꾸며 partial 결과는 `retryable(review)`로 남긴다. |
| `../scripts/sync-channel-preanalysis-reviews.mjs` | 네 source의 전역 최대 2개 review queue, 안전한 yt-dlp 환경, 임시 media cleanup, 후보 Worker adapter와 최종 catalog closure 검증을 연결한다. |
| `../scripts/activate-channel-preanalysis.ps1` | Groq·Qwen key를 보안 입력으로 받아 전용 Worker의 네 필수 secret과 코드를 원자 배포하고, GitHub Actions secret 연결 및 무과금 인증 probe를 수행한다. |
| `app/PreparedReviewExperience.tsx` | exact `review-ready` artifact를 기존 검토 UI에 즉시 투영하고 편집자의 선택·경계 조정만 artifact digest별로 로컬 저장한다. |
| `app/preparedAnalysisLibrary.ts` | 검증된 manifest의 `review-ready` 영상만 configured source 순서와 최신 게시 시각으로 묶는 순수 projection이다. |
| `app/PreparedAnalysisEntry.tsx` | 첫 화면의 YouTube 링크 입력, 스트리머별 준비본 탭·영상 목록, partial/failed 재시도 상태를 표시하고 선택을 기존 exact lookup에 전달한다. |
| `cloudflare/preanalysisContextProxy.worker.ts` | 예약 context·candidate·transcript 전용 Bearer/source fence와 operation Durable Object checkpoint를 소유한다. 무료 후보·전사 media는 Worker JS가 큰 본문을 읽지 않고 private R2 native checksum과 bounded header만 검증하며 provider key는 Worker Secret 밖으로 내보내지 않는다. |
| `../wrangler.preanalysis-context.jsonc` | 전경 5인 Worker와 분리된 예약 Worker, Durable Object, context 4회/분·transcript 20회/분 limiter, free-R2 transport와 전용 secret 이름을 정의한다. |
| `cloudflare/aiProviderConfiguration.ts` | 후보·전체 맥락·전사의 provider 선택, secret readiness, endpoint와 bounded fallback 정책을 소유한다. Groq secret이 있어도 기본 Qwen route를 자동 변경하지 않는다. |
| `cloudflare/aiProxy.worker.ts` | `free-r2` ticket을 provider URL 요청으로 해소하고, `paid-direct` WAV를 multipart file로 변환하며, credential과 upstream 오류를 브라우저에서 차단한다. |
| `analysis/speakerEmbeddingWorkerProtocol.ts` | WavLM 모델·revision·입력 PCM 상한과 source/preparation fingerprint를 고정하는 화자 임베딩 Worker 계약이다. |
| `analysis/speakerEmbedding.worker.ts` | 브라우저 WASM에서 한 발화씩 WavLM x-vector를 만들고 PCM을 폐기하는 실행부다. |
| `analysis/speakerEmbeddingWorkerClient.ts` | 모델을 유지하는 Worker 수명, 취소·stale identity·진행률·결과 검증을 소유한다. |
| `analysis/speakerEmbeddingMath.ts` | prototype 평균, cosine score, 부분 coverage와 open-set `unknown` 투영을 소유한다. |
| `scripts/evaluate-speaker-enrollment-candidates.mjs` | repository 밖의 pending FLAC을 고정 모델로 교차검증하고 점수만 출력하는 개발 도구다. |

한국어로 떠올린 개념과 영어 파일명이 멀어 검색이 빗나가는 것들. 개념어가 아니라
**영어 식별자로 찾아야 한다**(`AGENTS.md` §9.1).

| 찾으려던 것 | 실제 위치 |
|---|---|
| 검토 화면 키보드 단축키 | `app/useReviewShortcuts.ts` — **키맵의 유일한 소유자** |
| 단축키 도움말 오버레이 | `app/components/ShortcutHelpOverlay.tsx` |
| 되돌리기 토스트 | `app/components/ReviewUndoToast.tsx` |
| 남은 시간 추정 | `app/progressEstimate.ts` — 패딩·단조 감소 포함 |
| 분석 진행 막대 비율 | `app/analysisProgressAxis.ts` — 스테이지 시간 가중·단조 증가·남은 시간 하나 |
| 입력·분석 앞단 표시 계약 | `app/frontSurfaceModel.ts` — source identity·대사/챕터·전체 맥락·복구·검증된 0개를 후보 데이터 없이 투영하는 순수 view model |
| 입력·분석 앞단 화면 | `app/FrontSurface.tsx` + `app/PreparedAnalysisEntry.tsx` + `styles/front-surface.css` — A안 단일 surface, 링크 단독 준비본 진입, 스트리머별 준비 목록, source ribbon, 주제 timeline, 자료/이력/detail sheet |
| 후보 이동 규칙 | `app/reviewNavigation.ts` |
| 후보 위치 스트립 좌표 | `app/positionStrip.ts` |
| 분석 실행 상태 기계 | `domain/analysisRun.ts` — **16 상태 전이표** |
| 영상 단위 작업(재개·캐시) | `domain/analysisJob.ts` — Run 위의 층 |
| 보존 기간·용량 상한 판단 | `domain/storageRetention.ts` — 순수 함수 |
| `persist()` · `estimate()` | `storage/storageQuota.ts` |
| 새로고침 후 원본 되찾기 | `storage/reconnectSource.ts` — 권한·지문 재대조 |
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
