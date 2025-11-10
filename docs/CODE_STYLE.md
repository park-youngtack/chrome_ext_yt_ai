# 코드 스타일 및 문서화 (CODE_STYLE)

## 코드 스타일

### JSDoc 주석
모든 주요 함수에 다음을 명시해야 합니다:
```javascript
/**
 * 함수의 목적을 설명합니다
 * @param {type} paramName - 매개변수 설명
 * @returns {type} 반환값 설명
 */
function myFunction(paramName) {
  // 구현
}
```

### 섹션 구분
각 파일을 논리적 섹션으로 구분하고 명확한 헤더를 추가합니다:
```javascript
// ===== 섹션명 =====
// 섹션 설명 (필요 시)

// 관련 코드...
```

### 파일 헤더
각 파일 상단에 파일의 목적과 주요 기능을 설명합니다:
```javascript
/**
 * 파일 목적: 간결한 설명
 *
 * 주요 기능:
 * - 기능 1
 * - 기능 2
 * - 기능 3
 */
```

### 인라인 주석
복잡한 로직에는 "왜"를 설명하는 주석을 추가합니다:
```javascript
// ✅ 좋은 예
// 번역 중이면 탭 전환을 무시합니다 (진행 중단 방지)
if (translationState.state === 'translating') {
  return;
}

// ❌ 나쁜 예
if (translationState.state === 'translating') { // state 확인
  return; // 반환
}
```

## 파일별 섹션 구성

### background.js
```
1. 파일 헤더
2. 로깅 시스템 정의
3. Extension 설치 및 초기화
4. Content Script 관리
```

### content.js
```
1. 파일 헤더
2. 전역 상태 정의
3. IndexedDB 설정
4. 로깅 시스템
5. 진행 상태 관리
6. 타이머 관리
7. Port 연결 관리
8. 메시지 리스너
9. 번역 메인 로직
10. OpenRouter API 통신
11. 원본 복원
12. DOM 텍스트 노드 수집
13. IndexedDB 캐시 시스템
14. 초기화 함수
```

### sidepanel.js
```
1. 파일 헤더
2. 설정 상수
3. 전역 상태
4. 초기화 (DOMContentLoaded)
5. 탭바 관리 (switchTab, handleTabChange)
6. API Key UI 관리 (showApiKeyInput, hideApiKeyInput)
7. 설정 관리 (loadSettings, saveSettings)
8. 번역 기능 (handleTranslateAll, handleRestoreOriginal)
9. UI 업데이트 (updateUI, updateUIByPermission)
10. 개발자 도구 (exportLogs, copyLogs)
```

## 주석 스타일 가이드

### ✅ 권장
```javascript
/**
 * 현재 탭의 번역 상태를 저장합니다
 * @param {Object} state - 저장할 상태 객체
 * @returns {void}
 */
function saveTranslationState(state) {
  translationStateByTab.set(currentTabId, { ...state });
}

// 번역 완료 후 UI를 업데이트합니다
updateUI();
```

### ❌ 피할 것
```javascript
// save state
function saveState(s) {
  // set map
  map.set(id, s);
}

// update
updateUI(); // 이게 뭐하는 건지 불명확
```

## 명명 규칙

### 변수
- **상수**: `UPPER_SNAKE_CASE` (예: `DEFAULT_BATCH_SIZE = 50`)
- **boolean**: `is` 또는 `has` 접두사 (예: `isTranslating`, `hasPermission`)
- **Map/배열**: 복수형 (예: `translationStateByTab`, `batches`)

### 함수
- **이벤트 핸들러**: `handle` + 액션 (예: `handleTranslateAll`, `handleTabChange`)
- **쿼리/확인**: `get`, `check`, `is` (예: `getTranslationState`, `checkPermissions`)
- **변경**: `update`, `set`, `save` (예: `updateUI`, `saveSettings`)

### 파일/모듈
- **소문자 + 아래줄 또는 camelCase** (예: `logger.js`, `meta.js`, `sidepanel.js`)

## 에러 처리

### try-catch 구조
```javascript
try {
  // 주 로직
  const result = await someAsyncFunction();
  return result;
} catch (error) {
  // 에러 로그
  logError('MODULE', 'ERROR_CODE', '사용자 친화적 메시지', context, error);
  // 재시도 또는 폴백
  return fallbackValue;
}
```

### 로깅 레벨
- **DEBUG**: 개발 중 상세 정보 (변수값 등)
- **INFO**: 중요한 이벤트 (시작, 완료, 상태 변화)
- **WARN**: 경고 수준 (재시도, 폴백)
- **ERROR**: 실패 (사용자에게 영향)

## 테스트 가능한 코드 작성

### ✅ 테스트 가능
```javascript
/**
 * 텍스트를 정규화합니다
 * @param {string} text - 입력 텍스트
 * @returns {string} 정규화된 텍스트
 */
function normalizeText(text) {
  return text.trim().toLowerCase();
}

// 단위 테스트 가능: assert(normalizeText("  Hello  ") === "hello")
```

### ❌ 테스트 불가
```javascript
function doSomething() {
  fetch('/api/...'); // 외부 의존성
  updateDOM(); // DOM 의존성
  console.log('done'); // 부수 효과
}
```

## 성능 고려 사항

### 메모리 관리
```javascript
// ✅ WeakMap 사용 (자동 GC)
const originalText = new WeakMap();
originalText.set(node, text);

// ❌ 일반 Map (메모리 누수 위험)
const textMap = new Map();
```

### DOM 업데이트
```javascript
// ✅ 배치 업데이트
requestAnimationFrame(() => {
  elements.forEach(el => el.textContent = data[el.id]);
});

// ❌ 루프 내 즉시 업데이트
for (let el of elements) {
  el.textContent = data[el.id]; // 리플로우 반복
}
```

## 정리 체크리스트

코드 작성 후 체크할 사항:
- [ ] JSDoc 주석 추가 (모든 주요 함수)
- [ ] 섹션 헤더 추가 (새 섹션)
- [ ] 복잡한 로직에 인라인 주석 추가
- [ ] 의미있는 변수명 사용
- [ ] 에러 처리 추가
- [ ] 로그 추가 (중요 이벤트)
- [ ] 임시 코드/주석 제거
- [ ] 콘솔 에러 0건 확인
