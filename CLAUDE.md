# 프로젝트 개요

## 확장 프로그램 정보
- **이름**: 무조건 한글로 번역해드림
- **버전**: 2.2.0
- **설명**: OpenRouter AI를 사용하여 웹페이지를 한글로 번역하는 크롬 확장 프로그램
- **개발**: 인크로스 AI비즈솔루션팀 박영택
- **최종 수정**: 2025-11-10 (meta.js 참고)

## 파일 구조

```
chrome_ext_yt_ai/
├── manifest.json              # Chrome 확장 메타데이터
├── background.js              # Service Worker - Content Script 관리
├── content.js                 # Content Script - DOM 번역 실행 (14섹션)
├── sidepanel.html             # 사이드패널 UI (4개 탭)
├── sidepanel.js               # 사이드패널 로직 (11섹션)
├── sidepanel.css              # 패널 스타일
├── logger.js                  # 공용 로깅 시스템 (ES6 모듈)
├── meta.js                    # 메타 정보 (푸터 텍스트)
├── README.md                  # 사용자 가이드
├── CLAUDE.md                  # 개발 가이드 (현재 파일)
└── icons/                     # 확장 아이콘
```

## 핵심 원칙 ⚠️ 중요!

### 패널 동작
1. **Window-Level**: 한번 열면 해당 창의 모든 탭에서 보임
2. **탭별 상태 관리**: `translationStateByTab` Map으로 각 탭 번역 상태 독립 관리
3. **번역 중 탭 전환 방지**: `if (state === 'translating') return;` 로직 필수
4. **사용자 액션 시에만 권한 체크**: 탭 전환 시 조용한 업데이트, 버튼 클릭 시 검증
5. **불필요한 로그 방지**: 지원 불가 URL에서도 경고 출력 안 함

### 금지 패턴 ❌
```javascript
// ❌ 탭별 패널 상태(열림/닫힘) 추적 금지!
const panelOpenState = new Map();

// ❌ 탭 변경할 때마다 불필요한 로그 출력 금지!
chrome.tabs.onUpdated.addListener(() => {
  logWarn('UNSUPPORTED_URL', ...); // 조용하게!
});

// ❌ 번역 중에 Port 끊기 금지!
port.disconnect(); // 진행 상태가 꼬임!
```

### 올바른 패턴 ✅
```javascript
// ✅ 탭별 번역 상태는 Map으로 독립 관리
const translationStateByTab = new Map();

// 탭 전환 시
if (translationStateByTab.has(currentTabId)) {
  translationState = {
    ...translationStateByTab.get(currentTabId),
    batches: [...translationStateByTab.get(currentTabId).batches] // 깊은 복사!
  };
}

// ✅ 번역 중이면 탭 전환 무시
if (translationState.state === 'translating') {
  return; // 간단!
}
```

## 주요 기능

### 번역 탭
- 캐시 우선 번역 & 전면 재번역 모드
- 실시간 진행률 표시 (완료/배치/시간/캐시)
- 원본 보기 토글 (WeakMap 기반 복원)
- 권한 가드 (http/https/file:// 스킴만 지원)

### 히스토리 탭
- 번역 완료 시 자동 저장
- URL별 중복 제거 (최신만 유지)
- 목록에서 선택 → 동일 설정으로 재번역
- 개별/전체 삭제

### 검색 탭
- AI가 검색문 3개 자동 생성
- Google, Naver, Bing, ChatGPT, Perplexity 동시 검색
- 최대 10개 검색문 누적 (사용자 입력 1개 + AI 추천 9개)

### 설정 탭
- API Key 관리 (마스킹: 앞 8자 + "***")
- 모델 선택 (기본: `openai/gpt-4o-mini`)
- 배치 크기 (10-200, 기본 50)
- 동시 처리 (1-10, 기본 3)
- 캐시 설정 (ON/OFF, TTL 1분-365일)
- 개발자 모드 (ON: 모든 로그 출력 | OFF: 모든 로그 차단)

## 캐시 시스템

```javascript
// IndexedDB 저장소 구조
{
  key: "sha1(text.trim().toLowerCase())",  // 해시 기반 중복 방지
  value: {
    translation: "번역된 텍스트",
    ts: 1731234567890,                    // 저장 시간
    model: "openai/gpt-4o-mini"          // 사용 모델
  }
}
```

- **TTL**: 기본 30일, 설정 가능 (1분-365일)
- **대규모 변경 감지**: 페이지 변경률 ≥20% 시 자동 전면 재번역
- **재검증**: 적용 전 해시 비교, 불일치 시 재번역

## 상태 관리

```javascript
// 번역 상태 (각 탭별로 독립 관리)
translationState = {
  state: 'inactive' | 'translating' | 'completed' | 'restored',
  totalTexts: 0,
  translatedCount: 0,
  cachedCount: 0,
  batchCount: 0,
  batchesDone: 0,
  batches: [],
  activeMs: 0
}

// 탭별 상태 저장
const translationStateByTab = new Map(); // tabId → translationState
```

## 통신

### Port (실시간)
- **용도**: Content Script의 번역 진행 상태 실시간 전송
- **주기**: 1초마다 또는 완료 시
- **데이터**: `{ state, totalTexts, translatedCount, ... }`

### Message (요청-응답)
- **용도**: 특정 작업 수행 (translate, queryCache 등)
- **방향**: Sidepanel ↔ Content Script

## 코드 구조

### background.js
1. 로깅 시스템
2. Extension 설치/초기화
3. Content Script 관리

### content.js (14개 섹션)
1. 파일 헤더 & 전역 상태
2. IndexedDB 캐시 설정
3. 로깅 시스템
4. 진행 상태 관리
5. 산업군 컨텍스트 분석
6. 타이머 관리
7. Port 연결 관리
8. 메시지 리스너
9. **번역 메인 로직**
10. OpenRouter API 통신
11. 원본 복원
12. DOM 텍스트 노드 수집
13. IndexedDB 캐시 시스템
14. 초기화 함수

각 섹션 상단의 JSDoc 주석을 참고하세요.

### sidepanel.js (11개 섹션)
1. 파일 헤더 & 설정 상수
2. 전역 상태
3. DOMContentLoaded 초기화
4. 탭바 관리
5. API Key UI 관리
6. 히스토리 관리
7. 설정 관리
8. 번역 기능
9. UI 업데이트
10. 개발자 도구
11. 검색 탭 기능

각 섹션의 JSDoc 주석을 참고하세요.

### logger.js (ES6 모듈)
- **레벨**: DEBUG, INFO, WARN, ERROR
- **필터링**: debugLog OFF → 모든 로그 차단 | ON → 모든 로그 출력
- **마스킹**: API Key (앞 8자), 텍스트 (20자 제한)
- **버퍼**: session storage에 최근 500개 저장

## UI/UX 스펙

### 디자인 토큰
| 요소 | 값 | 용도 |
|------|-----|------|
| 패널 배경 | `#0B0B0F` | 다크 배경 |
| 탭바 배경 | `#121418` | 탭바 |
| 텍스트 주 | `#EDEEF0` | 기본 텍스트 |
| 텍스트 부 | `#A9AFB8` | 보조 텍스트 |
| 버튼 | `#2A6CF0` | 주 액션 (파란색) |
| 성공 | `#10b981` | 완료 (초록색) |
| 경고 | `#f59e0b` | 경고 (주황색) |
| 에러 | `#ef4444` | 에러 (빨간색) |

### 레이아웃
```
패널
├─ 좌측 (컨텐츠)
│  ├─ 헤더: "AI 번역" (고정)
│  └─ 메인: 4개 탭 컨텐츠 (스크롤)
└─ 우측 (탭바 60px, 고정)
   ├─ 번역 탭
   ├─ 히스토리 탭
   ├─ 검색 탭
   └─ 설정 탭
```

## 성능 최적화

- **배치 처리**: 기본 50개씩, 동시 3개
- **DOM 업데이트**: `requestAnimationFrame` 일괄 처리
- **메모리**: WeakMap 기반 자동 가비지 컬렉션
- **패널**: 1클릭 오픈 (`openPanelOnActionClick: true`)

## 에러 처리

### 네트워크 에러
- 자동 재시도: 최대 3회, 지수 백오프
- 최종 실패: 사용자 안내

### API 에러
- **401 Unauthorized**: "API Key 확인 필요"
- **402 Payment Required**: "크레딧 충전 필요"
- **429 Too Many Requests**: 동시성 자동 하향

### 권한 에러
- 지원 불가 URL: UI로 안내
- file:// 권한 없음: 권한 허용 유도

## 보안

- **API Key**: Chrome Storage (Chrome 암호화) + 로그에는 앞 8자만
- **캐시**: SHA1 해시 저장 (원본 X) + 로컬 IndexedDB
- **권한**: 사용자 액션 시에만 체크

## 코드 스타일

### JSDoc 주석 (모든 주요 함수)
```javascript
/**
 * 함수의 목적
 * @param {type} paramName - 매개변수 설명
 * @returns {type} 반환값 설명
 */
function myFunction(paramName) {
  // 구현
}
```

### 섹션 헤더
```javascript
// ===== 섹션명 =====
// 섹션 설명 (필요 시)
```

### 명명 규칙
- **상수**: `UPPER_SNAKE_CASE` (예: `DEFAULT_BATCH_SIZE`)
- **boolean**: `is`/`has` 접두사 (예: `isTranslating`, `hasPermission`)
- **함수**: `handle` (이벤트), `get`/`check`/`is` (조회), `update`/`set`/`save` (변경)

## 새 기능 추가 시

1. `meta.js` LAST_EDITED 날짜 업데이트 (YYYY-MM-DD)
2. **기능 타입별로:**
   - 번역 관련 → `content.js`
   - UI 변경 → `sidepanel.html` + `sidepanel.js`
   - 백그라운드 작업 → `background.js`
3. 권한 필요 시 `manifest.json` 업데이트
4. **코드의 JSDoc 주석을 충분히 작성** (최우선!)
5. README.md 업데이트

## 주요 교훈 (2025-11-10)

### "if if if"를 피하는 법
- ❌ 각 요구사항마다 if 조건 추가 → 복잡도 폭증
- ✅ 근본적인 데이터 구조 설계 → 조건 최소화

**핵심**: 데이터 구조부터 설계하면 if 조건이 거의 필요 없습니다.

### 탭별 독립 상태 관리
- `translationStateByTab` Map으로 각 탭 상태 독립 관리
- 깊은 복사 필수 (batches 배열)
- 번역 중일 때만 Port 유지

### 번역 중 탭 전환 보호
```javascript
if (translationState.state === 'translating') {
  return; // 조건 1개로 모든 문제 해결!
}
```

## 디버깅 팁

### 콘솔 에러 0건 유지
- F12 > Console 탭에서 에러 확인
- Port 연결 상태 확인 (`port.onDisconnect`)
- 권한 상태 확인 (`checkPermissions`)

### 캐시 동작 확인
- F12 > Application > IndexedDB > TranslationCache
- 저장된 항목 수, 해시값, TTL 확인

### 상태 추적
```javascript
console.log('Translation State:', translationState);
console.log('By Tab:', translationStateByTab.get(currentTabId));
console.log('Permission:', permissionGranted);
```

## 배포 체크리스트

배포 전 확인:
- [ ] `meta.js` LAST_EDITED 날짜 업데이트
- [ ] `manifest.json` version 업데이트
- [ ] README.md 업데이트
- [ ] git commit & push

## 고정 원칙

- 페이지 오버레이 문구: **전면 제거**
- 설정 페이지: **패널 내부에서만 표시**
- 확장 이름: **"무조건 한글로 번역해드림"**
- 패널 타이틀: **"AI 번역"**
- 푸터 문구: **"인크로스 AI비즈솔루션팀 박영택 · 최종 수정: YYYY-MM-DD"**

## 참고 사항

- 각 JS 파일의 JSDoc 주석을 먼저 읽으세요 (가장 정확한 정보)
- 기능별 상세는 코드 내 섹션 주석을 참고하세요
- git log를 source of truth로 사용하세요 (변경 이력)
