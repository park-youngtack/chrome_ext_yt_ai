# 히스토리 기능 (HISTORY)

## 개념적 설계

```
번역 완료
  ↓
자동으로 히스토리에 저장
  ├─ URL
  ├─ 페이지 제목
  ├─ 완료 시간
  ├─ 사용 모델
  ├─ 번역 통계
  └─ 최종 캐시 상태
  ↓
히스토리 탭에서 목록 표시
  ↓
사용자 선택 시:
  - 해당 URL로 이동
  - 자동 재번역 (같은 설정으로)
```

## 주요 함수

### Sidepanel (`sidepanel.js`)

#### `saveToHistory(meta)`
- **위치**: sidepanel.js
- **역할**: 번역 완료 후 히스토리 저장
- **매개변수**: 번역 메타정보
  ```javascript
  {
    url,
    title,
    completedAt,
    model,
    totalTexts,
    translatedCount,
    cachedCount,
    elapsedMs
  }
  ```
- **저장소**: Chrome Storage API (sync)

#### `loadHistoryList()`
- **위치**: sidepanel.js
- **역할**: 히스토리 목록 로드 및 표시
- **정렬**: 최근순 (최신 먼저)

#### `deleteHistoryItem(historyId)`
- **위치**: sidepanel.js
- **역할**: 특정 히스토리 항목 삭제
- **UI**: 휴지통 아이콘 클릭

#### `retranslateFromHistory(historyItem)`
- **위치**: sidepanel.js
- **역할**: 히스토리에서 재번역
- **동작**:
  1. 저장된 URL로 이동
  2. 자동으로 재번역 시작
  3. 이전과 동일한 모델/설정 사용

## 데이터 구조

### 히스토리 항목
```javascript
{
  id: "history_1731231456789",
  url: "https://example.com",
  title: "Example Page Title",
  completedAt: 1731231456789,
  model: "openai/gpt-4o-mini",

  // 번역 통계
  totalTexts: 250,
  translatedCount: 245,
  cachedCount: 100,

  // 진행 시간
  elapsedMs: 45000,

  // 메타정보
  favicon: "data:image/png;base64,..."
}
```

### 저장소
- **API**: Chrome Storage API (chrome.storage.sync)
- **용량**: 기기당 10MB
- **동기화**: 구글 계정으로 자동 동기화

## UI/UX

### 히스토리 목록 표시
```
[파비콘] Example Page Title
                          최종 수정: 2025-11-10 15:30
번역 완료: 245/250 (98%)   [🗑️]
```

### 인터랙션
- **항목 클릭**: 해당 페이지로 이동 + 재번역 요청
- **휴지통 클릭**: 히스토리에서 삭제
- **스와이프** (모바일): 삭제

### 상태 표시
- **파비콘**: 페이지 ID 시각화
- **진행률**: 번역된 텍스트 비율
- **시간**: 최종 수정 시각
- **캐시 통계**: 캐시된 비율

## 중요한 설계 원칙

### 1. 자동 저장
- 번역 완료 직후 자동 저장
- 사용자 액션 불필요
- 실패해도 무시 (번역 자체는 완료)

### 2. 중복 제거
```javascript
// 같은 URL이 이미 있으면 최신 항목으로 업데이트
const existingIndex = history.findIndex(h => h.url === newUrl);
if (existingIndex !== -1) {
  history[existingIndex] = newItem; // 덮어쓰기
}
```

### 3. 재번역 설정 복원
- 저장된 모델 사용
- 저장된 배치 크기 사용
- 기존 캐시 활용

### 4. 최대 항목 수 제한
- **최대 100개**: 저장소 용량 관리
- **초과 시**: 오래된 항목부터 삭제

## 기술 구현

### Storage API 사용
```javascript
// 저장
chrome.storage.sync.set({
  'history': [
    { id: "1", url: "...", ... }
  ]
});

// 로드
chrome.storage.sync.get('history', (result) => {
  const history = result.history || [];
});
```

### 동기화 고려사항
- **지연**: 저장 후 1-3초 후 동기화
- **오프라인**: 로컬에 저장, 온라인 시 동기화
- **충돌**: 최신 타임스탐프 우선

## 에러 처리

### 저장 실패
- 로컬 상태는 유지
- 사용자 경험 방해 없음
- 백그라운드에서 재시도

### 로드 실패
- 빈 목록 표시
- 에러 메시지 표시 안 함
- 사용자가 새로 번역 가능

## 성능 최적화

### 렌더링 최적화
- **가상 스크롤**: 항목이 많을 때 필요한 것만 렌더링
- **썸네일**: 파비콘만 표시 (가벼움)

### 저장소 쿼리
- **캐싱**: 로드 후 메모리에 유지
- **배치 저장**: 변경사항 일괄 처리

## 테스트 시나리오

### 기본 히스토리
1. 페이지 번역 → 히스토리 자동 저장 ✅
2. 히스토리 탭에서 목록 표시 ✅
3. 항목 클릭 → URL 이동 + 재번역 ✅

### 중복 처리
1. 같은 URL 여러 번 번역
2. 최신 항목만 남음 (중복 없음) ✅

### 삭제
1. 휴지통 버튼 클릭
2. 항목 제거 + 저장소 업데이트 ✅

### 동기화
1. 여러 기기에서 로그인
2. 한 기기에서 히스토리 추가
3. 다른 기기에서 자동 동기화 ✅

### 용량 제한
1. 100개 이상 저장
2. 오래된 항목부터 자동 삭제 ✅
