# 검색 기능 (SEARCH)

## 개념적 설계

```
사용자가 검색어 입력 → "추천 받기" 클릭
  ↓
OpenRouter AI에 최적의 검색문 3개 요청
  (Google, Naver, Bing, ChatGPT, Perplexity 최적화)
  ↓
AI 응답: 검색문 3개
  ├─ Google 최적화 검색문
  ├─ Naver 최적화 검색문
  └─ Bing 최적화 검색문
  ↓
UI에 검색문 표시
  ↓
사용자 선택:
  - 개별 엔진 아이콘 클릭 → 해당 엔진에서 새 탭 검색
  - "All" 버튼 → 5개 엔진 모두에서 동시 검색
```

## 주요 함수

### Sidepanel (`sidepanel.js`)

#### `getSearchRecommendations(userQuery)`
- **위치**: sidepanel.js
- **역할**: OpenRouter AI에서 검색문 추천 받기
- **매개변수**: 사용자 입력 검색어
- **반환값**:
  ```javascript
  {
    google: "최적화된 구글 검색문",
    naver: "최적화된 네이버 검색문",
    bing: "최적화된 빙 검색문",
    chatgpt: "최적화된 ChatGPT 프롬프트",
    perplexity: "최적화된 Perplexity 쿼리"
  }
  ```

#### `displaySearchRecommendation(recommendation)`
- **위치**: sidepanel.js
- **역할**: 추천받은 검색문을 UI에 표시
- **동작**:
  1. 기존 검색문 목록에 추가
  2. 각 검색문마다 5개 엔진 아이콘 표시
  3. "All" 버튼 활성화
  4. 최대 10개 검색문 표시 (스크롤 가능)

#### `searchWithEngine(query, engine)`
- **위치**: sidepanel.js
- **역할**: 특정 엔진에서 검색
- **매개변수**:
  - `query`: 검색문
  - `engine`: 'google' | 'naver' | 'bing' | 'chatgpt' | 'perplexity'
- **동작**:
  1. 적절한 URL 생성
  2. 새 탭에서 열기
  3. 검색 실행

#### `searchAllEngines(query)`
- **위치**: sidepanel.js
- **역할**: 모든 엔진에서 동시 검색
- **동작**:
  1. 5개 엔진 URL 생성
  2. 모두 새 탭에서 열기

## 검색 엔진 URL 매핑

### Google
```
https://www.google.com/search?q={encoded_query}
```

### Naver
```
https://search.naver.com/search.naver?query={encoded_query}
```

### Bing
```
https://www.bing.com/search?q={encoded_query}
```

### ChatGPT
```
https://chatgpt.com/?q={encoded_query}
```

### Perplexity
```
https://www.perplexity.ai/?q={encoded_query}
```

## AI 프롬프트 설계

### 요청 프롬프트
```
사용자 검색어: "{userQuery}"

다음 5개 검색 엔진에 최적화된 검색문을 각각 생성해줘:
1. Google Search
2. Naver Search
3. Bing Search
4. ChatGPT
5. Perplexity AI

각 엔진의 특성을 고려해서 최적화된 검색문을 만들어줘:
- Google: 키워드 중심
- Naver: 한국어 자연어 최적화
- Bing: 의도 기반
- ChatGPT: 질문형 프롬프트
- Perplexity: 상세한 쿼리

JSON 형식으로 반환해줘:
{
  "google": "검색문",
  "naver": "검색문",
  "bing": "검색문",
  "chatgpt": "검색문",
  "perplexity": "검색문"
}
```

## 데이터 구조

### 검색문 항목
```javascript
{
  id: "search_1731231456789",
  query: "사용자 입력 또는 AI 추천 검색문",
  source: "user" | "ai", // 사용자 직접 입력 vs AI 추천
  createdAt: 1731231456789,
  engines: {
    google: "...",
    naver: "...",
    bing: "...",
    chatgpt: "...",
    perplexity: "..."
  }
}
```

## 중요한 설계 원칙

### 1. 누적 검색문 관리
- **최대 10개**: 사용자 입력 1개 + AI 추천 9개
- **누적 방식**: "추천 받기" 버튼을 계속 누르면 쌓임
- **초과 시**: 가장 오래된 항목 제거

### 2. 엔진별 최적화
```
Google   → 간단한 키워드 중심
Naver    → 자연어 긴 문장
Bing     → 연산자 활용 (+, -, 따옴표)
ChatGPT → 질문형 프롬프트
Perplexity → 상세한 쿼리
```

### 3. 엔인코딩 처리
```javascript
const encoded = encodeURIComponent(query);
```
- **목적**: URL 안전성
- **적용**: 모든 검색 URL에 필수

### 4. 새 탭 열기
```javascript
chrome.tabs.create({ url: searchUrl });
```
- **목적**: 현재 탭 유지
- **배경**: 검색 결과를 새 탭에서 확인

## 에러 처리

### AI 응답 파싱 오류
- 폴백: 사용자 입력 검색어 사용
- 메시지: "AI 추천을 가져올 수 없어 기본 검색문으로 진행합니다"

### API 오류
- 재시도: 최대 2회
- 타임아웃: 10초

### 네트워크 오류
- 오프라인: 기존 검색문으로만 검색 가능
- 재시도 불가: 사용자에게 안내

## 성능 최적화

### 요청 최적화
- **캐싱**: 같은 검색어 재요청 시 캐시 사용 (1시간)
- **스로틀**: 너무 자주 "추천 받기" 클릭 방지 (1초 간격)

### UI 성능
- **렌더링**: 검색문 목록 가상 스크롤
- **아이콘**: SVG 아이콘 (가벼움)

## 테스트 시나리오

### 기본 검색
1. 검색어 입력 → "추천 받기" 클릭 ✅
2. AI 추천 검색문 3개 받음 ✅
3. 각 엔진별 아이콘 표시 ✅

### 개별 엔진 검색
1. Google 아이콘 클릭 → Google에서 새 탭 검색 ✅
2. Naver 아이콘 클릭 → Naver에서 새 탭 검색 ✅
3. 다른 엔진도 동작 ✅

### 동시 검색
1. "All" 버튼 클릭
2. 5개 탭 동시 열림 ✅

### 누적 검색문
1. "추천 받기" 3회 클릭
2. 3개 검색문 누적 ✅
3. 10개 초과 시 오래된 것부터 삭제 ✅

### 오류 처리
1. API 오류 시 → 폴백 메시지 ✅
2. 오프라인 → 새로운 추천 불가, 기존 검색만 가능 ✅

## UI/UX

### 검색문 표시
```
[입력창] "검색어 입력..."

AI 추천 검색문:
1. 최적화된 검색문 1
   [🔍] [🔍] [🔍] [🔍] [🔍] [All]

2. 최적화된 검색문 2
   [🔍] [🔍] [🔍] [🔍] [🔍] [All]

3. 최적화된 검색문 3
   [🔍] [🔍] [🔍] [🔍] [🔍] [All]

[추천 받기 버튼]
```

### 아이콘 표시
- 🔍 Google
- 🔍 Naver
- 🔍 Bing
- 🤖 ChatGPT
- 🧠 Perplexity
- 🌐 All (5개 엔진 동시)

### 인터랙션 피드백
- 클릭 시 로딩 스피너 표시
- 완료 시 토스트 메시지
- 오류 시 에러 메시지
