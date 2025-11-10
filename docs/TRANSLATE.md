# AI 번역 기능 (TRANSLATE)

## 개념적 설계

```
사용자가 "번역" 버튼 클릭
  ↓
1. 현재 탭 권한 확인 (http/https/file://)
  ↓
2. Content Script에 번역 요청 전송
  ↓
3. Content Script:
  - DOM 텍스트 노드 수집
  - 캐시 확인 (기존 번역 있으면 사용)
  - 새 문장 → OpenRouter API 요청
  - Port를 통해 진행률 실시간 전송
  ↓
4. Sidepanel:
  - Port 메시지 수신
  - UI 업데이트 (진행률, 배치, 시간)
  - 완료 시 상태 저장
```

## 주요 함수

### Sidepanel (`sidepanel.js`)

#### `handleTranslateAll(button)`
- **위치**: sidepanel.js
- **역할**: "현재 페이지 모두 번역" 버튼 클릭 처리
- **동작**:
  1. API Key 확인
  2. Content Script 준비 확인
  3. 번역 모드 결정 (캐시 우선 vs 캐시 무시)
  4. Content Script에 번역 요청
  5. Port 연결 및 진행 상태 리스닝

#### `connectToContentScript(tabId)`
- **위치**: sidepanel.js
- **역할**: Content Script와 통신 채널(Port) 연결
- **동작**:
  1. 기존 Port 종료
  2. 새 Port 생성
  3. Port.onMessage 리스너 등록
  4. 진행 상태 메시지 처리

#### `updateUI(hasPermission)`
- **위치**: sidepanel.js
- **역할**: 번역 상태에 따라 UI 업데이트
- **매개변수**: `hasPermission` - 현재 탭 권한 여부
- **업데이트 대상**:
  - 상태 뱃지 (번역 중/완료/대기)
  - 버튼 활성/비활성
  - 진행률 텍스트
  - 배치 정보
  - 경과 시간

### Content Script (`content.js`)

#### `translateDomTexts(texts, translateMode)`
- **위치**: content.js
- **역할**: DOM 텍스트 번역 (메인 로직)
- **매개변수**:
  - `texts`: 번역할 텍스트 배열
  - `translateMode`: 'cache' (캐시 우선) | 'nocache' (캐시 무시)
- **동작**:
  1. 텍스트 배치 생성 (기본 50개)
  2. 동시 처리 (기본 3개 배치)
  3. 캐시 체크 및 조회
  4. API 번역 요청
  5. 결과 저장 및 DOM 업데이트
  6. Port를 통해 진행 상태 전송

#### `queryCache(hash)`
- **위치**: content.js
- **역할**: IndexedDB에서 번역 결과 조회
- **반환값**: 캐시된 번역 또는 null
- **캐시 조건**:
  - 해시 일치
  - TTL 유효 (기본 30일)

#### `saveCache(hash, translation, model)`
- **위치**: content.js
- **역할**: IndexedDB에 번역 결과 저장
- **저장 정보**:
  - 해시값 (정규화된 텍스트의 SHA1)
  - 번역 결과
  - 저장 시간
  - 사용 모델

## 데이터 흐름

### 요청 (Sidepanel → Content Script)
```json
{
  "action": "translatePage",
  "texts": ["Hello", "World"],
  "translateMode": "cache" | "nocache",
  "model": "openai/gpt-4o-mini",
  "batchSize": 50,
  "concurrency": 3
}
```

### 응답 (Content Script → Sidepanel)
```json
{
  "type": "progress",
  "data": {
    "state": "translating" | "completed",
    "totalTexts": 100,
    "translatedCount": 50,
    "cachedCount": 25,
    "batchCount": 2,
    "batchesDone": 1,
    "batches": [
      { "size": 50, "status": "completed" },
      { "size": 50, "status": "pending" }
    ],
    "activeMs": 15000
  }
}
```

## 중요한 설계 원칙

### 1. 탭별 독립 상태 관리
- **translationStateByTab Map**: 각 탭의 번역 상태를 독립적으로 저장
- **깊은 복사**: batches 배열도 독립 복사 (참조 공유 방지)
- **결과**: 동일 URL도 다른 탭에서 독립적으로 번역 관리

### 2. 번역 중 탭 전환 보호
```javascript
// handleTabChange에서
if (translationState.state === 'translating') {
  return; // 번역 중이면 탭 전환 무시
}
```
- **목적**: 진행 중인 번역 중단 방지
- **Port 유지**: 진행 상태 UI 업데이트 계속
- **안정성**: 데이터 섞임 현상 완전 해결

### 3. 권한 기반 UI 제어
```javascript
updateUI(hasPermission);
```
- **권한 없음**: 모든 버튼 비활성, "번역 불가" 표시
- **권한 있음**: 번역 상태에 따라 동적 제어
- **명확성**: 단순 bool 파라미터로 모든 UI 상태 결정

## 캐시 시스템

### 저장소
- **DB**: IndexedDB (`TranslationCache`)
- **키**: SHA1(정규화된 텍스트)
- **값**: `{ translation, ts, model }`

### TTL 처리
- **기본값**: 30일
- **최대값**: 365일
- **검증**: 쿼리 시점에 TTL 체크

### 캐시 무시 (nocache 모드)
- 기존 캐시 조회하지 않음
- 모든 텍스트 재번역
- 새 결과 저장

## 에러 처리

### 네트워크 에러
- 자동 재시도 (지수 백오프)
- 최대 3회 시도

### 429 (Rate Limit)
- 동시성 자동 하향
- 다음 요청부터 적용

### 권한 오류
- UI에 명확한 안내 메시지
- "권한 허용" 버튼 제공

## 성능 최적화

### 배치 처리
- **배치 크기**: 기본 50개 (설정 가능)
- **동시 처리**: 기본 3개 (설정 가능)
- **목적**: API 요청 최소화 + 병렬 처리

### DOM 업데이트
- **requestAnimationFrame**: 배치 업데이트
- **성능**: 리플로우/리페인트 최소화

### 메모리 관리
- **WeakMap**: 원본 텍스트 저장 (자동 GC)
- **목적**: 메모리 누수 방지

## 테스트 시나리오

### 기본 번역
1. https 페이지 → "번역" 클릭 → 완료 ✅

### 캐시 확인
1. 첫 번역 (원본 번역)
2. 다시 번역 (캐시 사용) - 빠름
3. "캐시 무시" 모드 (재번역)

### 탭 독립성
1. 탭 A: 페이지 X 번역
2. 탭 B: 같은 페이지 X 번역 (다른 상태)
3. 각 탭의 상태 독립 관리 확인

### 번역 중 탭 전환
1. 번역 진행 중 탭 B로 이동
2. 번역은 계속 진행, UI 업데이트 유지
3. 완료 후 탭 전환 가능

### 권한 없는 페이지
1. chrome:// 페이지 → "번역 불가" 표시
2. 버튼 비활성
3. 캐시 섹션 숨김
