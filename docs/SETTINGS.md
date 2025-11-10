# 설정 기능 (SETTINGS)

## 개념적 설계

```
사용자가 설정 탭 오픈
  ↓
현재 설정값 로드 (Chrome Storage)
  ↓
UI에 설정 요소 표시
  ├─ API Key 입력
  ├─ 모델 선택
  ├─ 배치 크기
  ├─ 동시 처리 수
  ├─ 캐시 토글
  ├─ 캐시 유지 기간
  └─ 캐시 관리 버튼
  ↓
사용자가 값 변경
  ↓
"저장" 버튼 활성화
  ↓
사용자 "저장" 클릭
  ↓
변경사항 검증 → Chrome Storage에 저장
  ↓
성공 토스트 메시지 표시
```

## 주요 함수

### Sidepanel (`sidepanel.js`)

#### `loadSettings()`
- **위치**: sidepanel.js
- **역할**: Chrome Storage에서 설정값 로드
- **반환값**:
  ```javascript
  {
    apiKey: "sk-...",
    model: "openai/gpt-4o-mini",
    batchSize: 50,
    concurrency: 3,
    cacheEnabled: true,
    cacheTTLDays: 30
  }
  ```

#### `saveSettings(settings)`
- **위치**: sidepanel.js
- **역할**: 변경된 설정값 저장
- **매개변수**: 설정 객체
- **검증**:
  1. API Key 형식 확인
  2. 배치 크기 범위 (10-200)
  3. 동시 처리 수 범위 (1-10)
  4. 캐시 TTL 범위 (1-365일)
- **저장**: Chrome Storage (encrypted)
- **피드백**: 성공 토스트 (2초)

#### `validateApiKey(key)`
- **위치**: sidepanel.js
- **역할**: API Key 유효성 검증
- **검증 내용**:
  - 형식: `sk-...` 또는 `sk_...`
  - 최소 길이: 20자
  - 문자 범위: alphanumeric + 하이픈/언더스코어
- **반환값**: `{ valid: boolean, message: string }`

#### `testApiKey(key)`
- **위치**: sidepanel.js
- **역할**: API Key 실제 동작 확인
- **동작**:
  1. OpenRouter API에 간단한 요청
  2. 성공 → "키가 유효합니다" 메시지
  3. 실패 → 구체적인 오류 메시지
- **타임아웃**: 5초

#### `handleClearPageCache()`
- **위치**: sidepanel.js
- **역할**: 현재 페이지의 캐시만 삭제
- **동작**:
  1. 현재 탭 URL 기반 캐시 검색
  2. 해당 캐시 항목만 삭제
  3. "캐시 삭제 완료" 메시지

#### `handleClearAllCache()`
- **위치**: sidepanel.js
- **역할**: 전체 캐시 삭제
- **동작**:
  1. 확인 다이얼로그
  2. IndexedDB 전체 비우기
  3. "전역 캐시 삭제 완료" 메시지
  4. 캐시 통계 초기화

## 설정 항목 상세

### 1. API Key 설정
- **필드**: 텍스트 입력 (마스킹)
- **표시**: 앞 8자 + "..."
- **예**: `sk-abc12345...`
- **필수**: 번역 기능 사용 필수
- **테스트 버튼**: "키 테스트" (API 호출)

### 2. 모델 선택
- **필드**: 드롭다운
- **기본값**: `openai/gpt-4o-mini`
- **옵션**:
  ```
  OpenAI:
  - gpt-4o-mini (빠름, 저비용)
  - gpt-4-turbo (정확함, 고비용)
  - gpt-3.5-turbo (더 빠름, 더 저비용)

  Claude:
  - claude-3-haiku (매우 빠름)
  - claude-3-sonnet (균형)

  기타:
  - llama-2-70b (오픈소스)
  ```
- **권장**: gpt-4o-mini

### 3. 배치 크기
- **필드**: 스핀 박스 (10-200)
- **기본값**: 50
- **설명**: 한 번에 번역할 문장 수
- **용도**:
  - 적을수록: 정확하지만 느림
  - 많을수록: 빠르지만 메모리 사용

### 4. 동시 처리
- **필드**: 스핀 박스 (1-10)
- **기본값**: 3
- **설명**: 동시에 처리할 배치 수
- **용도**:
  - 적을수록: 안정적
  - 많을수록: 빠르지만 네트워크 부하

### 5. 캐시 사용 토글
- **필드**: 토글 스위치 (44×24px)
- **기본값**: ON (true)
- **동작**:
  - OFF → 캐시 사용 안 함
  - ON → 캐시 우선 사용

### 6. 캐시 유지 기간
- **필드**: 숫자 입력 + 단위 선택
- **단위**: 분 / 시간 / 일
- **범위**: 1분 ~ 365일
- **기본값**: 30일
- **설명**: 캐시가 유효한 기간

### 7. 캐시 관리 버튼
```
[이 페이지 캐시 비우기]  [전역 캐시 비우기]
```

## 저장 및 검증

### 실시간 변경 감지
```javascript
// 입력 필드에 change/input 이벤트 리스너
addEventListener('input', () => {
  settingsChanged = true;
  enableSaveButton();
});
```

### 저장 버튼 상태
- **비활성**: 변경사항 없음
- **활성**: 변경사항 있음
- **로딩**: 저장 중

### 검증 순서
```
1. 빈 필드 확인 (API Key 필수)
2. 형식 검증 (API Key)
3. 범위 검증 (배치 크기, 동시 처리)
4. API Key 테스트 (선택)
5. 저장
```

## 데이터 저장

### Chrome Storage
```javascript
chrome.storage.sync.set({
  'settings': {
    apiKey: "sk-...",
    model: "openai/gpt-4o-mini",
    batchSize: 50,
    concurrency: 3,
    cacheEnabled: true,
    cacheTTLDays: 30
  }
});
```

### 암호화
- API Key는 Chrome이 자동 암호화 (sync)
- 내용: 암호화되지 않음 (고의, 로컬 동기화 용도)

## 중요한 설계 원칙

### 1. 즉시 저장 방지
```javascript
// ❌ 틀린 방식: 매 입력마다 저장
addEventListener('input', saveSettings);

// ✅ 올바른 방식: 명시적 저장 버튼
saveButton.addEventListener('click', saveSettings);
```
- **목적**: 입력 중 불필요한 저장 방지
- **UX**: "저장" 버튼 하나로 명확

### 2. 변경 감지 플래그
```javascript
let settingsChanged = false;

addEventListener('input', () => {
  settingsChanged = true;
  saveButton.disabled = false;
});

addEventListener('save', () => {
  settingsChanged = false;
  saveButton.disabled = true;
});
```

### 3. 검증 수준
- **UI 검증**: 클라이언트 사이드 (즉시 피드백)
- **API 검증**: 실제 API 호출 (API Key 테스트)

### 4. 롤백 기능
```javascript
// 저장 실패 시 이전 값으로 복원
cancelButton.addEventListener('click', () => {
  loadSettings(); // 다시 로드
  settingsChanged = false;
});
```

## 에러 처리

### API Key 오류
```
❌ 형식이 잘못되었습니다 (sk-로 시작해야 함)
❌ API Key가 유효하지 않습니다 (401)
❌ API 크레딧이 부족합니다 (402)
```

### 범위 오류
```
❌ 배치 크기는 10-200 사이여야 합니다
❌ 동시 처리 수는 1-10 사이여야 합니다
❌ 캐시 유지 기간은 1-365일 사이여야 합니다
```

## 성능 고려사항

### 저장 비용
- **소요 시간**: 100-500ms (sync)
- **네트워크**: 필요 (Google 계정 동기화)

### 캐시 삭제 성능
- **이 페이지**: 빠름 (1-10ms, 수십 개 항목)
- **전역**: 느림 (100-1000ms, 수천 개 항목)
  - **해결**: 비동기 처리, 진행률 표시

## 테스트 시나리오

### 기본 설정 저장
1. API Key 입력 → "저장" 클릭 ✅
2. 저장 완료 메시지 ✅
3. 페이지 새로고침 후 값 유지 ✅

### API Key 테스트
1. 유효한 Key → "테스트" → "유효합니다" ✅
2. 무효한 Key → "테스트" → 오류 메시지 ✅
3. 타임아웃 → 오류 메시지 ✅

### 캐시 관리
1. "이 페이지 캐시 비우기" → 현재 페이지 캐시만 삭제 ✅
2. "전역 캐시 비우기" → 확인 후 전체 삭제 ✅

### 변경 감지
1. 설정 변경 → "저장" 버튼 활성화 ✅
2. "취소" → 이전 값으로 복원 ✅
3. 변경 없음 → "저장" 버튼 비활성 ✅

### 모델 선택
1. 드롭다운 열기 → 모델 선택 ✅
2. 다른 모델로 번역 → 선택된 모델 사용 ✅

### 배치 및 동시성
1. 배치 크기 변경 (50 → 100)
2. 번역 실행 → 변경된 크기로 처리 ✅
