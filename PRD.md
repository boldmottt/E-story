# E-Story — 기획서 (PRD) v1.5

> **목표:** "이야기는 계속 읽고, 막히는 영어만 AI와 함께 공부하는 원서 리더"
> **슬로건:** Story-first, Study-on-demand
> **위치:** `./E-Story/`
> **버전:** v1.5 (2026-05-25)

---

## 1. 제품 개요

### 1.1 한 줄 설명
> **"재미는 끊지 않고, 어려운 문장만 똑똑하게 공부하는 원서 앱"**

### 1.2 타겟 사용자
- 영어 원서 읽기에 도전하는 중급자
- "읽고 싶은데 모르는 게 자꾸 나와서 포기"한 경험이 있는 사람
- 수동적인 단어 암기가 아닌 **스토리와 함께 영어 실력이 느는 경험**을 원하는 사람

### 1.3 핵심 가치
1. **Story-first** — 사용자가 문제를 푸는 느낌보다 이야기를 읽는 느낌을 우선한다
2. **Study-on-demand** — 공부는 강제하지 않고, 사용자가 막히거나 궁금할 때 시작된다
3. **No Spoiler** — AI는 현재 읽은 위치 이후의 내용을 절대 말하지 않는다
4. **한 번에 하나씩** — AI 피드백을 한 포인트씩 교정
5. **Local-first** — 모든 데이터는 브라우저 IndexedDB에 저장
6. **몰입 보호** — 학습 기능이 독서 경험을 방해하지 않도록 설계

---

## 2. 읽기 모드 (3가지)

### 2.1 Story Mode (기본, 몰입 독서)
- 우측 학습 패널 숨김
- 문장/단어 클릭 시 **작은 팝업**으로 빠른 힌트만 제공
- 공부는 사용자가 원할 때만 시작

**문장 클릭 팝업 — 힌트 사다리:**
```
[📖 단어 뜻] [🔍 구문 힌트] [📋 문장 요지] [✍️ 해석해보기] [⏰ 나중에 공부]
```

| 단계 | 기능 | 목적 |
|:----:|------|------|
| 1 | 단어 뜻 팝업 | 몰입을 거의 안 끊고 이해 보조 |
| 2 | 구문 힌트 | 문장 구조만 살짝 알려줌 |
| 3 | 문장 요지 | 전체 번역 대신 핵심 의미만 |
| 4 | ✍️ 해석해보기 | Study Mode 진입 |
| ⏰ | 나중에 공부 | Study Queue에 저장 후 계속 읽기 |

### 2.2 Study Mode (집중 학습)
- 선택한 문장을 직접 해석
- AI one-point 피드백 루프 실행
- 추천 해석(구조/자연)은 루프 종료 후 공개
- 이 모드는 사용자가 **명시적으로 선택할 때만** 진입

### 2.3 Review Mode (복습)
- Study Queue에 저장한 문장/단어를 모아서 복습
- 피드백 이력 기반 약점 포인트 복습
- "오늘 저장한 N개 공부하기"

---

## 3. 핵심 기능

### 3.1 텍스트 업로드 및 관리
- `.txt` 파일 업로드 (인코딩 자동 감지)
- 챕터/페이지 단위 분할
- Bookshelf: 책 목록, 진행률, 이어 읽기
- 재방문 시 읽던 위치 자동 복원
- **"Previously on..."** 이어 읽기 기능 (챕터 복귀 시 지난 이야기 요약)

### 3.2 TTS (Text-to-Speech)
- Web Speech API (브라우저 내장, 무료)
- 단어 발음: 팝업의 🔊 버튼
- 문장 발음: 문장 아래 🔊 버튼
- 낭독 모드: 재생/일시정지/속도 조절, 문장 클릭 → 해당 위치부터 재생
- macOS Samantha 음성 우선

### 3.3 AI 힌트 사다리 & 피드백

#### 3.3.1 힌트 사다리 (Story Mode)
사용자가 문장을 클릭하면 5단계 힌트 제공:
1. **단어 힌트:** 클릭한 단어의 뜻 (Free Dictionary API + AI)
2. **구문 힌트:** 문장 구조 간략 설명
3. **문장 요지:** 전체 번역 대신 핵심 의미 (스포일러 없이)
4. **해석해보기:** Study Mode 진입
5. **나중에 공부:** Study Queue 저장

#### 3.3.2 AI 피드백 루프 (Study Mode)
```
원문 표시 → 사용자 해석 입력 → AI가 한 포인트만 지적 → 수정 → 반복 → 종료
```

**AI 피드백 원칙:**
1. 한 번에 **하나의 포인트만** 지적
2. 의미 → 뉘앙스/말투 → 문법 → 자연스러운 표현 순서로 우선순위
3. L1 간섭 코멘트 자연스럽게 포함
4. 죽음의 스포일러 금지 (No-spoiler 규칙)
5. 종료 시에만 추천 해석 공개

#### 3.3.3 Story Buddy (AI 독서 친구)
문장/문단 선택 후 질문 가능:
```
[지금 무슨 상황이야?]
[누가 말하는 중이야?]
[이 표현이 왜 중요해?]
[분위기가 어때?]
[문화/시대 배경 설명]
[영어 표현만 설명]
```

**No-spoiler 규칙 (필수):**
```
Use only the provided text and the user's current reading progress.
Never mention events, relationships, or outcomes that occur after the user's current position.
Even if you know the book, do not use outside knowledge.
If the answer requires future context, say: "현재까지의 내용만으로는 확실하지 않아요."
```

### 3.4 Study Queue (나중에 공부하기)
- 문장/단어를 1클릭으로 Queue에 저장
- 저장 후 즉시 리더로 복귀 (몰입 유지)
- 챕터/세션 종료 시 "오늘 저장한 N개 공부하기" 알림
- 저장된 문장으로 AI 피드백 루프 복습 가능

### 3.5 단어장
- 단어 + 뜻 + 원문 문장 + **장면 설명 + 등장인물 + 말투**
- 학습 상태: New / Learning / Known
- SRS 복습 (3-Box Leitner)
- 단어 발음 TTS
- **장면 기반 복습:** 단어가 나온 장면을 함께 떠올리게 설계

### 3.6 피드백 이력 및 약점 요약
- 모든 피드백을 날짜순 저장
- "최근 피드백 요약해줘" AI 명령
- 추후 데이터 기반 정형 대시보드 (Post-MVP)

### 3.7 챕터 종료 요약 (Post-MVP)
```
1. 이번 챕터 3줄 요약 (No-spoiler)
2. 주요 등장인물 변화
3. 중요한 장면 1~2개
4. 오늘의 표현 3개
5. 공부하면 좋은 문장 1개
```

---

## 4. 기술 설계

### 4.1 배포 방식
```
로컬(AI 포함): export OPENCODE_API_KEY=sk-... && python3 serve.py 8000
정적 호스팅:   GitHub Pages 등 (AI는 설정에서 BYOK 키 입력 필요)
⚠ file:// 실행 시 브라우저별 제약 있음
```
- `serve.py`는 정적 앱 서빙 + `/api/zen/*` → `opencode.ai/zen/*` 프록시(키 서버 주입).
  opencode.ai가 CORS 헤더를 주지 않아 브라우저 직접 호출 불가 → 프록시 필요.
- AI 기본값은 호스트로 자동 분기: `localhost`/`127.0.0.1`이면 프록시
  (`/api/zen/go/v1`, `deepseek-v4-flash`), 그 외는 OpenAI 호환 BYOK 기본값.

### 4.2 AI 응답 JSON 형식 (Study Mode)

```json
{
  "status": "needs_revision" | "good_enough" | "finished",
  "issueType": "meaning" | "grammar" | "tense" | "article" | "preposition" | 
               "word_choice" | "structure" | "naturalness" | "idiom" | "nuance" | 
               "tone" | "cultural_context" | "implied_meaning" | "none",
  "feedbackKo": "한국어 피드백 (2~3문장, 한 번에 하나만)",
  "hintKo": "짧은 힌트",
  "l1InterferenceKo": null,
  "shouldShowModelTranslation": false,
  "literalTranslationKo": null,
  "naturalTranslationKo": null,
  "storyNoteKo": null
}
```

종료 시:
```json
{
  "status": "finished",
  "literalTranslationKo": "구조를 살린 직역...",
  "naturalTranslationKo": "스토리처럼 읽히는 의역...",
  "storyNoteKo": "이 문장의 뉘앙스/재미/장면상 의미..."
}
```

### 4.3 BYOK (Bring Your Own Key)
- API 키 세션 전용 저장 기본값 (안전)
- AI 피드백 + 사전 검색에 사용
- No-spoiler 규칙 프롬프트에 포함
- 로컬 프록시(serve.py) 사용 시 키는 서버 `OPENCODE_API_KEY`가 들고 브라우저엔 미노출

### 4.4 동기화 (현재 비활성)
- Supabase 동기화는 현재 **비활성**(`js/sync.config.js`의 `ENABLED:false`, `sync.js`는 no-op).
- 모든 데이터는 브라우저 IndexedDB에 로컬 저장(Local-first). 백업은 JSON 내보내기/가져오기.

---

## 5. 데이터 모델

```javascript
{
  books: { id, title, fileName, sourceHash, encoding,
    totalChunks, currentChunk, currentOffset, createdAt, updatedAt },

  chunks: { id, bookId, index, title, content, startOffset, endOffset },

  sentences: { id, bookId, chunkId, index, text, startOffset, endOffset },

  feedbackSessions: { id, bookId, sentenceId, originalSentence,
    status, finalUserTranslation, literalTranslation, naturalTranslation,
    storyNote, createdAt, updatedAt },

  translationAttempts: { id, sessionId, attemptNo, userTranslation,
    aiStatus, issueType, feedbackKo, hintKo, l1InterferenceKo, createdAt },

  vocabulary: { id, word, lemma, meaningKo, definitionEn,
    partOfSpeech, pronunciation, audioUrl,
    contextSentence, sceneNote, characterNames, tone,
    sentenceId, bookId, status, reviewBox, nextReview, addedAt, updatedAt },

  studyQueue: { id, bookId, sentenceId, text,
    reason: "word"|"sentence"|"grammar"|"story"|"unknown",
    status: "pending"|"reviewed"|"dismissed", createdAt, reviewedAt },

  highlights: { id, bookId, sentenceId, text, userTranslation,
    note, tags: [], createdAt, updatedAt },

  storyMemories: { id, bookId, upToChunk, summaryKo,
    characters: [{ name, description, lastKnownState }],
    openQuestions: [], createdAt, updatedAt },

  readingSessions: { id, bookId, startedAt, endedAt,
    startChunk, endChunk, mode, savedToQueueCount },

  settings: { id, theme, fontSize, lineHeight, ttsRate, aiProvider, apiKeyStorageMode }
}
```

---

## 6. MVP 범위 (v1)

### P0 — 반드시 포함
| 기능 | 설명 |
|------|------|
| txt 업로드 + Bookshelf | 파일 업로드, 책 목록, 진행률 |
| 리더 뷰 | Story Mode 기본, 다크모드/폰트 조절 |
| TTS (기본) | 단어/문장 발음 듣기 |
| 문장 클릭 → 힌트 사다리 | 단어힌트 → 구문힌트 → 요지 → 해석 → 저장 |
| AI one-point 피드백 루프 | Study Mode 핵심 |
| 추천 해석 (구조 + 자연) | 루프 종료 후 비교 |
| 나중에 공부하기 (Study Queue) | 1클릭 저장 + 세션 종료 후 알림 |
| 단어장 + SRS 기본 | 저장/검색/3-Box 복습 |
| No-spoiler AI 규칙 | 프롬프트에 포함 |
| 피드백 이력 저장 | 모든 시도 저장 |
| 백업/복원 | JSON 내보내기/가져오기 |

### P1 — MVP 범위 (시간 허용 시)
| 기능 | 설명 |
|------|------|
| Story Buddy | 문장 선택 후 맥락/분위기 질문 |
| 챕터 3줄 요약 | 챕터 완료 시 자동 요약 |
| Previously on | 재방문 시 지난 이야기 요약 |
| 장면 기반 단어장 | 단어 + 장면/인물 정보 |
| 하이라이트/내 번역 저장 | 마음에 드는 문장 저장 |

### Post-MVP
- 문법 분석 모드 (선택 문장만)
- 챕터 복습 퀴즈
- 약점 요약 대시보드
- 통계
- PDF/EPUB
- 클라우드 동기화

---

## 7. UX 흐름

### 읽는 중 (Story Mode)
```
영어 원서 읽는 중
  → 어려운 문장 클릭
  → 작은 팝업: [단어힌트][구문힌트][요지][해석해보기][⏰나중에]
```

### 몰입 유지
```
[요지만 보기] 클릭
  → "이 문장은 OOO을 의미합니다"
  → 계속 읽기
```

### 공부하고 싶을 때
```
[해석해보기] 클릭
  → Study Mode 패널 열림
  → 직접 해석 입력
  → AI가 한 포인트만 피드백
  → 수정 → 반복 → 종료 → 구조해석/자연해석/story note 비교
```

### 나중에 공부
```
⏰ 클릭 → Study Queue에 저장 → 바로 리더 복귀
세션 종료 → "오늘 저장한 5개 문장 공부할까요?"
```

---

## 8. Non-goals (MVP에서 하지 않을 것)
- PDF/EPUB 지원
- 클라우드 동기화
- 사용자 계정
- 페이지 전체 문법 분석
- 통계 대시보드
- 등장인물 관계도
- 자동 타임라인
- 챕터 퀴즈 (Post-MVP)

---

## 9. 일정 (8일)

| Day | 작업 |
|:---:|------|
| 1 | 앱 구조, IndexedDB, 파일 업로드, Bookshelf |
| 2 | 리더 뷰, chunk/sentence 분할, Story Mode 기본 |
| 3 | 문장 클릭 → Quick Menu (힌트 사다리) + TTS |
| 4 | AI Provider 설정, one-point 피드백 루프 |
| 5 | 추천 해석 비교 (구조/자연/story note) |
| 6 | Study Queue + 단어장 + SRS |
| 7 | No-spoiler 적용 + 피드백 이력 + UI 마감 |
| 8 | JSON 백업/복원 + 테스트 |

---

## 10. 변경 이력

| 버전 | 날짜 | 변경 내용 |
|:----:|:----:|-----------|
| v1.0 | 2026-05-25 | 초안 |
| v1.1 | 2026-05-25 | MVP 축소, Local-first 정정, JSON 형식, 데이터 모델 통합 |
| v1.2 | 2026-05-25 | **Story-first 방향 전환**. Story/Study/Review 모드 분리. 힌트 사다리. Study Queue. No-spoiler 규칙. 구조+자연 해석 분리. Story Buddy. 장면 기반 단어장. Previously on. |
| v1.5 | 2026-05-25 | serve.py AI 프록시(CORS 해결)+호스트별 baseUrl 분기. 에디토리얼 페이퍼 UI(Literata serif, 문단 보존 리더). 책 삭제. URL 임포트+CORS 안내. Supabase 동기화 비활성. Dexie 로컬 호스팅. quick-menu 리스너 누수 수정. |
