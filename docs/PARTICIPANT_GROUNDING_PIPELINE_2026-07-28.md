# 방송 등장인물 근거화 파이프라인

## 목표

전체 방송 맥락 AI가 후보를 해석하기 전에 다음 세 사실을 구분해서 받는다.

1. 제품이 알고 있는 6인 카탈로그
2. 원본 채널로부터 얻은 가능성 prior
3. 실제 대사·화면·목소리에서 관측한 근거

카탈로그나 채널 주인 정보는 실제 등장 또는 발화 증거가 아니다. 인물을 찾지
못한 정상 결과와 디코딩·API 실패도 서로 다른 상태다.

## 현재 반영된 순서

```text
원본 선택
  → 소스별 6인 카탈로그 prior 결정
  → 전체 대사 지도 완성·봉인
  → 대사 이름 언급 근거화
  → participant grounding 패킷 봉인·IndexedDB 저장·readback
  → 방송 전체 맥락 분석
  → 의미 후보 위치 보강
  → 후보별 화면 4장·오디오·전체 맥락 최종 검증
```

현재 패킷의 `sealed`는 “인물을 식별했다”가 아니라 “이번 버전에서 계획한
근거 수집이 정상 terminal 상태에 도달했다”는 뜻이다. 이름이 없거나 인물을
확정하지 못해도 정상적으로 봉인된다.

## 6인 카탈로그와 출처 prior

| 원본               | likely host    | possible guest                                     | 제외        |
| ------------------ | -------------- | -------------------------------------------------- | ----------- |
| 교환학생 메인 채널 | 세라 교수님    | 아모레또, 유레카, 세나 아르벨, 토로리 코코, 망징이 | 없음        |
| 각 개인 채널       | 해당 채널 주인 | 세라를 제외한 나머지 네 멤버                       | 세라 교수님 |
| 출처 불명          | 없음           | prior 없음인 6인 카탈로그만 유지                   | 없음        |

개인 채널이라고 채널 주인만 명단에 남기지 않는다. 합방 게스트를 식별할 수
있어야 하므로 세라만 제외하고 다섯 명을 닫힌 후보군으로 유지한다.

## 현재 근거 계약

`BroadcastParticipantGrounding`은 다음만 저장한다.

- 안정적인 participant ID와 canonical 이름
- source role prior
- 대사 챕터에서 발견된 canonical 이름 또는 고정 호칭
- 각 근거의 source-time 범위와 chapter ID
- transcript/visual/voice 어댑터 영수증

원본 대사 전체, JPEG, WAV, Base64, 음성 임베딩은 저장하지 않는다. 이름
언급은 `name-mentioned`일 뿐 화면 등장이나 발화자 증거로 승격하지 않는다.

현재 visual/voice 어댑터는 `unavailable /
no-verified-reference-manifest`로 봉인된다. 다만 패킷과 validator는
`on-screen-name | visual-reference-match | spoken-self-identification |
voice-reference-match` 및 명시적인 미확인·인물 없음·무발화 결과를 보존하도록
준비되어 있다. 저장소에는 다섯 명의 UI 초상 이미지가
있지만 AI 식별용으로 검증된 reference manifest가 아니고, 세라 이미지와 6인
음성 enrollment 자료가 없기 때문이다. 따라서 현재 전체 맥락의 진행자 이름은
source prior만으로 확정하지 않는다.

## 저장·복구 불변 조건

- session schema `1.7.0`은
  `participantGroundingInputSignature + participantGroundingCheckpointJson`
  쌍과 source roster, transcript seal, 전체 맥락의 exact input snapshot을 저장한다.
- 둘은 동시에 null이거나 동시에 값이어야 한다.
- 체크포인트는 현재 source duration, 압축된 대사 지도, roster와 정확히
  일치해야 한다.
- 저장 직후 exact readback이 성공해야 전체 맥락 API 호출을 시작한다. 맥락
  결과와 refinement commit은 직전에 읽은 session과 여전히 같은 경우에만
  한 IndexedDB transaction에서 교체하는 compare-and-swap이다.
- 대사 지도를 새로 만들면 participant/context/refinement 체크포인트를 함께
  무효화한다.
- 기존 `1.2`~`1.6` session은 유료 대사·맥락 결과를 삭제하지 않고 현재
  schema로 마이그레이션한다. 다만 grounding이 없던 과거 맥락을 새 근거가 있는
  결과처럼 표시하지 않는다.
- 복구 시 당시 context input JSON과 transcript seal, catalog version,
  participant checkpoint를 다시 지문화한다. 하나라도 다르면 과거 유료 결과는
  보존하되 현재 실행의 완료 결과로 표시하지 않는다.

## 다음 단계: 실제 화면 근거 어댑터

1. 6인 모두에 대해 권리와 출처가 확인된 reference image manifest를 만든다.
   한 장짜리 프로필이 아니라 표정·의상·크롭 변화가 있는 복수 기준 이미지를
   participant ID와 콘텐츠 해시로 묶는다.
2. `broadcastContextCandidateCohort`의 화면 추출을 전체 맥락 앞으로 옮긴다.
   후보마다 서로 다른 4장이 모두 준비된 뒤에만 식별 큐에 넣는다.
3. 화면 식별은 별도 목적의 경량 멀티모달 요청으로 실행한다. 최종 후보 해석
   결과를 앞 단계에서 재사용하지 않는다.
4. 같은 인물이 두 장 이상에서 반복되고 서로 다른 고유 특징 두 개 이상이 맞는
   경우만 `visual-reference-match`를 만든다. 그 외에는
   `visible-participant-unidentified`가 정상 결과다.
5. 프레임 bundle은 소스 fingerprint·구간·focus 시각으로 메모리 캐시하고 최종
   Candidate Pass B가 정확히 같은 bundle을 재사용한다.

## 다음 단계: 실제 목소리 근거 어댑터

1. VAD로 발화 구간과 비발화 구간을 먼저 나눈다.
2. 발화 구간을 speaker diarization으로 화자 cluster에 묶는다.
3. 각 6인의 검증된 깨끗한 음성 enrollment 구간에서 speaker embedding을 만든다.
   개인 채널의 단독 방송은 다섯 멤버의 후보 자료가 될 수 있고, 세라는 메인
   채널에서 사람이 확인한 단독 발화 구간이 필요하다.
4. cluster와 enrollment를 검증 모델로 비교한다. 임계값 미달·두 사람 점수가
   비슷한 경우에는 강제로 이름을 붙이지 않고 `unknown-speaker`로 남긴다.
5. ASR 텍스트에는 검증된 speaker ID만 연결한다. Qwen ASR이나 Omni가
   “목소리 느낌”으로 만든 이름은 voice identity 근거로 인정하지 않는다.

## 실제 매체 어댑터의 완료 게이트

- 모든 계획 cell은 adapter에 맞는 정상 terminal이어야 한다. transcript-name은
  `identified | none`, visual은 `identified | none | unidentified`, voice는
  `identified | unidentified | no-speech`만 허용한다.
- 디코딩 실패, 모델 실패, rate limit은 다음 phase 전에 해당 cell만 재시도한다.
- retryable gap이 하나라도 있으면 패킷을 `sealed`로 만들지 않는다.
- visual/voice 참조 자료가 제품에 아직 등록되지 않은 것은 일시 실패가 아니라
  명시적인 `unavailable` terminal이다. 이 상태에서는 전체 맥락이 진행되지만
  인물 이름을 확정하지 않는다.
- 실제 visual/voice 어댑터가 추가되면 source fingerprint, 후보 구간 집합,
  catalog/reference manifest/model revision을 input signature에 모두 포함한다.

## 2026-07-29 보완: 맥락 전 근거화와 후보별 재확인의 분리

현재 앱에서 `BroadcastParticipantGrounding`을 만드는 시점은 전체 대사 지도
seal 뒤, 방송 맥락 AI 전이다. 그러나 실제 화면 기반 인물 판정은 맥락 AI 뒤의
Candidate Pass B에서만 실행된다. 따라서 지금의 맥락 전 패킷에는 채널 prior와
대사 속 이름 언급만 있고, visual/voice adapter는 `unavailable`이다. 후보별
화면 판정을 앞선 방송 맥락이 이미 보았다고 간주해서는 안 된다.

이 순환을 다음 두 계층으로 끊는다.

1. **방송 단위 grounding pass**는 빠른 탐색·전사 준비와 병렬로 source-time
   화면 묶음과 speech turn을 준비한다. 검증된 참조가 있는 adapter만 실행하고,
   모든 계획 cell이 정상 terminal이 된 뒤 결과를 저장·readback한다.
2. **후보 단위 confirmation pass**는 방송 맥락이 후보를 정한 뒤 동일한
   source-fenced frame/audio bundle을 재사용해 해당 후보의 등장인물과 화자를
   다시 확인한다. 방송 단위 결과는 prior가 아니라 근거이며, 후보 구간의 직접
   증거와 충돌하면 후보를 `unidentified`로 남긴다.

의존 순서는 다음과 같다.

```text
source fence + 닫힌 6인 catalog
  ├─ 공유 frame producer ──> 방송 단위 visual evidence ─┐
  └─ 16 kHz mono decode                              │
       └─ 10초 speech segmentation                   │
            ├─ no-speech receipt                     │
            ├─ ASR ──> transcript seal ──────────────┤
            └─ clean non-overlap speech turn         │
                 └─ diarization/embedding match ─────┘
                                                      ↓
                                  participant grounding seal/readback
                                                      ↓
                                            방송 전체 맥락 AI
                                                      ↓
                                  후보별 4-frame/audio 재확인
                                                      ↓
                                             최종 후보 publication
```

### 6인 목소리 판정 계약

- pyannote segmentation의 `SPEAKER_1/2/3`은 10초 창 안의 local slot일 뿐
  참가자 ID가 아니다. 창이 바뀌면 slot 순서가 달라질 수 있으므로 embedding으로
  시간 창 사이를 연결해야 한다.
- overlap, 음악, 너무 짧은 turn은 identity embedding에서 제외한다. 이들은
  `speaker-unidentified` 또는 `no-speech`가 아니라 각각 overlap/검토 불가
  상태로 유지하며, ASR 필요 여부와 사람 식별 가능 여부를 혼동하지 않는다.
- 검증된 enrollment prototype과의 cosine top-1 점수가 개인별 절대 임계값을
  넘고, top-1과 top-2 사이 margin도 넘을 때만 `voice-reference-match`를 만든다.
  둘 중 하나라도 부족하면 6명 중 하나를 억지로 고르지 않는다.
- Qwen3-ASR/Qwen Omni의 이름 추측은 대사·맥락 보조 자료일 뿐 speaker identity
  근거가 아니다. closed-set 화자 판정은 별도 acoustic embedding adapter가
  소유한다.
- 현재 추출한 FLAC 후보는 전원 등장 방송 6개와 개인 채널 12개, 총 18개다.
  모두 `consent=unknown`, `humanVerification=pending`,
  `containsOverlappingSpeech=true`, `containsMusic=true`인 검토 후보다. 사람이
  각 파일의 화자·단독 발화·음악 여부와 사용 근거를 확인해 manifest가 eligible이
  되기 전에는 production prototype이나 자동 판정에 사용하지 않는다.
- 고정 WavLM revision으로 실행한 교차검증에서 개인 채널 내부 일관성은
  0.879~0.908이었지만, 전원 방송 30초 표본은 망징이만 같은 사람 prototype과
  명확히 일치했다. 유레카·코코 표본은 다른 사람 prototype이 top-1이었고 세나는
  같은 사람 top-1이지만 절대 점수가 낮았다. 따라서 “전원이 나오는 영상에서
  이름별 30초를 한 번 뽑으면 충분하다”는 가정은 기각한다. 먼저 VAD와 overlap
  분리로 3~10초 단독 발화 turn을 만든 뒤 독립 source와 교차검증해야 한다.

### 캐시·재실행 경계

- grounding signature에는 source fingerprint, transcript seal, roster/catalog
  revision, visual reference manifest hash, voice enrollment manifest hash,
  segmentation/embedding model revision, sampling-plan revision을 포함한다.
- 참조 manifest나 모델 revision이 바뀌면 transcript는 보존하고 participant
  grounding과 그에 의존하는 context/refinement만 무효화한다.
- 화면과 PCM 디코딩은 source-time bundle cache가 한 번만 수행한다. visual
  grounding, voice grounding, Candidate Pass B는 같은 immutable bundle을
  읽되 각자의 receipt를 별도로 발급한다.
- adapter의 디코딩·모델 오류는 다음 phase 전에 해당 cell만 재시도한다.
  `인물 없음`, `보이지만 미식별`, `무발화`, `화자 미식별`은 성공적으로 끝난
  증거 상태이며 실패 복구 대상으로 돌리지 않는다.
