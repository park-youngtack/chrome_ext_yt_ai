# 프로젝트 개요

## 확장 프로그램 정보
- **이름**: 무조건 한글로 번역해드림
- **버전**: 2.2.0 (manifest.json: 2.1.0 - 업데이트 필요)
- **설명**: OpenRouter AI를 사용하여 웹페이지를 한글로 번역하는 크롬 확장 프로그램
- **개발**: 인크로스 AI비즈솔루션팀 박영택
- **최종 수정**: 2025-11-10 (meta.js 참고)

## 파일 구조

```
chrome_ext_yt_ai/
├── manifest.json              # Chrome 확장 메타데이터 (v2.1.0)
├── background.js              # Service Worker - Content Script 관리
├── content.js                 # Content Script - DOM 번역 실행 (13섹션, ~1150줄)
├── sidepanel.html             # 사이드패널 UI (번역/히스토리/검색/설정 탭)
├── sidepanel.js               # 사이드패널 로직 (10섹션, 탭 관리 & 상태)
├── sidepanel.css              # 패널 스타일 (다크 테마, 토큰 기반)
├── logger.js                  # 공용 로깅 시스템 (민감정보 마스킹, 버퍼 500개)
├── meta.js                    # 메타 정보 (LAST_EDITED: 2025-11-10, 푸터)
├── README.md                  # 사용자 가이드 (설치/업데이트/기능 설명)
├── CLAUDE.md                  # 개발 가이드 (현재 파일)
├── .gitignore                 # Git 제외 파일
├── .claude/settings.local.json # Claude Code 설정 (git 제외)
├── docs/
│   ├── TRANSLATE.md           # AI 번역 기능 상세 (개념/함수/데이터흐름)
│   ├── HISTORY.md             # 히스토리 기능 상세 (자동 저장/삭제)
│   ├── SEARCH.md              # 검색 기능 상세 (AI 추천/멀티엔진)
│   ├── SETTINGS.md            # 설정 기능 상세 (API/모델/캐시 설정)
│   ├── ARCHITECTURE.md        # 아키텍처 (명세/캐시/성능/데이터흐름)
│   ├── CODE_STYLE.md          # 코드 스타일 (JSDoc/섹션/명명규칙)
│   └── DEVELOPMENT.md         # 개발 가이드 (기능추가/디버깅/배포)
└── icons/
    ├── icon16.png             # 16px 아이콘
    ├── icon48.png             # 48px 아이콘
    └── icon128.png            # 128px 아이콘
```

## 핵심 아키텍처

### 확장 프로그램 구조

#### 통신 계층
```
사이드패널 (sidepanel.js)
  ↕ Port (실시간, 번역 진행 상태)
Content Script (content.js)
  ↕ chrome.tabs.sendMessage (요청-응답)
Background Service Worker (background.js)
```

#### 데이터 계층
```
Chrome Storage (chrome.storage.sync)
  └─ settings: API Key, 모델, 배치 크기, 동시성, 캐시 설정

IndexedDB (TranslationCache)
  └─ 캐시: sha1(정규화(text)) → {translation, ts, model}
```

### 파일별 역할

| 파일 | 역할 | 주요 책임 | 문서 |
|------|------|----------|------|
| **background.js** | Service Worker | Content Script 자동/수동 주입, 메시지 라우팅 | - |
| **content.js** | Content Script | DOM 번역, 캐시, 배치, Port 연결 | [TRANSLATE.md](./docs/TRANSLATE.md) |
| **sidepanel.html** | UI 마크업 | 4개 탭 레이아웃 (좌측 컨텐츠 + 우측 탭바) | - |
| **sidepanel.js** | UI 로직 | 탭 관리, 상태 관리, 기능 조율 | 각 feature docs |
| **logger.js** | 로깅 유틸 | 공용 로거, 민감정보 마스킹, 세션 저장 | - |
| **meta.js** | 메타데이터 | 최종 수정일, 푸터 텍스트 | - |

### 주요 기능 (탭 기반)

#### 1️⃣ 번역 탭 (`#translate`)
- **"현재 페이지 모두 번역 (빠른 모드)"** - 캐시 우선 사용
- **"현재 페이지 모두 새로 번역 (캐시 무시)"** - 전면 재번역
- **"원본 보기"** - WeakMap 기반 원본 복원 (번역 1건 이상 시 활성)
- **상태 표시**:
  - 완료 n/m (p%) - 진행률
  - 번역된 텍스트 샘플 - 결과 미리보기
  - 배치 수 - 처리된 배치 수
  - 진행 시간 - 경과 시간 (실시간)
  - 캐시 사용 여부 - 캐시 사용률
- **권한 가드**: http/https/file:// 스킴만 지원, 불가 URL은 안내

#### 2️⃣ 히스토리 탭 (`#history`)
- **자동 저장**: 번역 완료 시 자동으로 Chrome Storage에 저장
- **목록 표시**: 최근 항목부터 최대 50개 저장
- **재번역**: 목록 선택 → 동일한 설정으로 바로 재번역
- **삭제**: 휴지통 아이콘으로 개별 삭제
- **중복 방지**: 동일 URL은 최신 번역으로만 유지

#### 3️⃣ 검색 탭 (`#search`)
- **AI 추천**: OpenRouter AI가 검색문 3개 자동 생성
- **멀티 엔진**: Google, Naver, Bing, ChatGPT, Perplexity 동시 검색
- **엔진별 최적화**:
  - Google: 키워드 중심
  - Naver: 한국어 자연어
  - Bing: 의도 기반
  - ChatGPT: 질문형
  - Perplexity: 상세 쿼리
- **누적 관리**: 최대 10개 (사용자 입력 1개 + AI 추천 9개)
- **빠른 실행**: Enter 키로 추천받기

#### 4️⃣ 설정 탭 (`#settings`)
**API 설정**
- OpenRouter API Key (마스킹: 앞 8자 + "...")
- 모델 선택 (기본: `openai/gpt-4o-mini`)
  - OpenAI: gpt-4o-mini, gpt-4-turbo, gpt-3.5-turbo
  - Claude: claude-3-haiku, claude-3-sonnet
  - 기타: llama-2-70b 등
- 키 테스트 버튼 (실제 API 호출)

**번역 설정**
- 배치 크기: 10-200개 (기본: 50)
- 동시 처리: 1-10개 (기본: 3)

**캐시 설정**
- 캐시 사용 토글 (ON/OFF)
- 캐시 유지 기간: 1분~365일 (기본: 30일)
- 이 페이지 캐시 비우기
- 전역 캐시 비우기 (확인 다이얼로그)

**저장 바**: 하단 고정, 변경 시만 활성화, 성공 시 2초 토스트

### 패널 동작 원칙 ⚠️ 중요!

#### 핵심 원칙

1. **패널은 Window-Level로 동작**
   - 한번 열면 해당 창의 모든 탭에서 보임
   - Chrome이 자동으로 관리 (manifest.json: `default_open_panel_on_action_click: true`)
   - background.js는 패널 상태를 추적하지 않음

2. **탭별 번역 상태는 독립적으로 관리** ✅
   - `translationStateByTab` Map으로 각 탭의 번역 상태 저장
   - 탭 전환 시 저장된 상태 복구 또는 초기화
   - 동일한 URL도 다른 탭 ID면 독립적으로 관리
   - 깊은 복사 필수 (batches 배열 등)

3. **URL/권한 체크는 사용자 액션 시에만**
   - 번역 버튼 클릭 시 `checkPermissions()` 호출
   - 지원하지 않는 URL(chrome://, edge://)은 UI로 안내
   - sidepanel.js의 `handleTranslateAll()`에서 최종 검증

4. **불필요한 로그 방지**
   - `chrome://newtab/` 같은 URL에서 패널이 보여도 경고 출력 안 함
   - 탭 이동 시 조용한 UI 업데이트만 수행
   - 사용자가 번역 시도할 때만 에러 메시지 표시

5. **번역 중 탭 전환 방지** ✅
   - 번역 중(state='translating')이면 탭 전환 무시
   - Port 유지하여 진행 상태 UI 업데이트 계속
   - 완료 후에야 탭 전환 허용

#### 금지 패턴 ❌

```javascript
// ❌ 탭별 패널 상태(열림/닫힘) 추적 금지!
const panelOpenState = new Map();
chrome.action.onClicked.addListener(() => {
  if (panelOpenState.get(tabId)) { ... }
});

// ❌ 탭 변경할 때마다 불필요한 로그 출력 금지!
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!/^https?:/.test(tab.url)) {
    logWarn('UNSUPPORTED_URL', ...);
  }
});

// ❌ 번역 중에 Port 끊기 금지!
if (port) {
  port.disconnect(); // 번역 중이면 절대 금지!
}
```

#### 올바른 패턴 ✅

```javascript
// ✅ 탭별 번역 상태는 Map으로 독립 관리
const translationStateByTab = new Map();

// 탭 전환 시
if (translationStateByTab.has(currentTabId)) {
  const savedState = translationStateByTab.get(currentTabId);
  translationState = {
    ...savedState,
    batches: savedState.batches ? [...savedState.batches] : [] // 깊은 복사!
  };
} else {
  initializeTranslationState(); // 새 탭 또는 처음
}

// ✅ 번역 중이면 탭 전환 무시
if (translationState.state === 'translating') {
  return; // 조건 1개로 모든 문제 해결!
}

// ✅ 사용자 액션 시에만 권한 체크
async function handleTranslateAll() {
  if (!permissionGranted) {
    showToast('권한을 먼저 허용해주세요.', 'error');
    return;
  }
  // 번역 진행...
}
```

## UI/UX 스펙

### 디자인 토큰

| 요소 | 값 | 설명 |
|------|-----|------|
| **패널 배경** | `#0B0B0F` | 진짜 검정에 가까운 다크 배경 |
| **탭바 배경** | `#121418` | 약간 더 밝은 진회색 |
| **카드 배경** | `#16181C` | 컨텐츠 섹션 배경 |
| **텍스트 (주)** | `#EDEEF0` | 기본 텍스트 (밝음) |
| **텍스트 (부)** | `#A9AFB8` | 보조 텍스트 (어두움) |
| **텍스트 (비활성)** | `#6B7280` | 비활성 텍스트 |
| **기본 버튼** | `#2A6CF0` | 파란색 (주 액션) |
| **호버 상태** | `#245ED2` | 더 어두운 파란색 |
| **성공** | `#10b981` | 초록색 (완료) |
| **경고** | `#f59e0b` | 주황색 (경고) |
| **에러** | `#ef4444` | 빨간색 (에러) |
| **활성 인디케이터** | `#2A6CF0` | 탭바 좌측 2px 라인 |
| **테두리** | `rgba(255, 255, 255, 0.08)` | 섹션 구분선 |

### 레이아웃 구조

```
패널 (sidePanel - Chrome 자동 관리)
├─ 좌측 (컨텐츠 영역)
│  ├─ 헤더 (고정)
│  │  └─ "AI 번역" 타이틀
│  └─ 메인 (스크롤)
│     └─ 탭별 컨텐츠
│        ├─ 번역 탭 (초기 표시)
│        ├─ 히스토리 탭
│        ├─ 검색 탭
│        └─ 설정 탭
└─ 우측 (탭바 - 고정, 60px)
   ├─ 번역 탭 아이콘
   ├─ 히스토리 탭 아이콘
   ├─ 검색 탭 아이콘
   └─ 설정 탭 아이콘
```

### 접근성 (WCAG 2.1 AA)

- **ARIA**: `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`
- **키보드**: 화살표(←→↑↓) 탭 이동, Enter/Space 선택
- **포커스 링**: `outline: 2px solid rgba(42,108,240,0.6)`
- **색상 대비**: 모든 텍스트 4.5:1 이상 (WCAG AA)

## 캐시 시스템 (IndexedDB)

### 저장소 구조
```javascript
// Database: TranslationCache
// Store: translations
{
  key: "sha1(정규화(text))",  // 예: "abc123def456..."
  value: {
    translation: "번역된 텍스트",
    ts: 1731234567890,        // 타임스탬프 (저장 시간)
    model: "openai/gpt-4o-mini", // 사용된 모델
    url: "https://example.com"  // 출처 (참고용)
  }
}
```

### 정규화 및 해싱
- **정규화**: `text.trim().toLowerCase()`
- **해싱**: SHA1 (중복 방지)
- **재검증**: 적용 직전 해시 비교, 불일치 시 재번역

### TTL (Time To Live)
- **기본값**: 30일
- **설정 가능**: 1분~365일
- **확인**: 매번 캐시 사용 전 TTL 검증

### 대규모 변경 감지
- **임계값**: 페이지 변경률 ≥20%
- **동작**: 자동 전면 재번역
- **계산**: (새로운 텍스트 수 - 캐시 히트 수) / 전체 텍스트 수

## 상태 관리

### Sidepanel 상태 (translationState)
```javascript
{
  state: 'inactive' | 'translating' | 'completed' | 'restored',
  totalTexts: 0,           // 전체 텍스트 노드 수
  translatedCount: 0,      // 번역된 수
  cachedCount: 0,          // 캐시 사용 수
  batchCount: 0,           // 전체 배치 수
  batchesDone: 0,          // 완료된 배치 수
  batches: [],             // 배치 상세 정보
  activeMs: 0              // 경과 시간 (ms)
}
```

### 탭별 상태 저장 (translationStateByTab)
```javascript
const translationStateByTab = new Map(); // tabId → translationState
```

### Content Script 상태
- 현재 페이지의 번역 진행 상황
- Port를 통해 실시간 업데이트 전송 (1초마다)

## 성능 최적화

### 배치 처리
- 기본 배치 크기: 50개 텍스트
- 기본 동시성: 3개 배치
- 설정 범위: 배치 10-200, 동시성 1-10
- **429 에러 시**: 동시성 자동 하향 (옵션)

### DOM 업데이트
- `requestAnimationFrame` 일괄 처리로 리플로우/리페인트 최소화
- WeakMap 기반 원본 복원 (자동 가비지 컬렉션)

### 패널 성능
- 1클릭 오픈 (`openPanelOnActionClick: true`)
- 메모리 효율적 렌더링

### 캐시 성능
- 정규화된 텍스트 기반 해시로 중복 캐시 방지
- TTL 검증으로 불필요한 재번역 방지

## 통신 메커니즘

### Port (단방향, 실시간)
**목적**: Content Script의 번역 진행 상태 실시간 전송
```
Content Script → Sidepanel
타입: "progress"
데이터: { state, totalTexts, translatedCount, cachedCount, ... }
주기: 1초마다 (또는 완료 시)
```

### Message (양방향, 요청-응답)
**목적**: 특정 작업 수행
```
Sidepanel → Content Script → Sidepanel
타입: "translatePage", "queryCache", "checkPermission" 등
응답: 완료 시 또는 에러 반환
```

## 에러 처리 전략

### 네트워크 에러
- 자동 재시도: 최대 3회, 지수 백오프
- 최종 실패: 사용자 안내 메시지

### API 에러
- **401 Unauthorized**: "API Key 확인 필요" 메시지
- **402 Payment Required**: "크레딧 충전 필요" 메시지
- **429 Too Many Requests**: 동시성 자동 하향

### 권한 에러
- 지원되지 않는 URL: "번역 불가" UI
- file:// 권한 없음: "권한 허용" 유도

## 보안 고려사항

### API Key 관리
- Chrome Storage (encrypted by Chrome)
- 로그에는 앞 8자만 표시
- 네트워크 전송 시 HTTPS 강제

### 캐시 민감도
- 텍스트는 정규화 후 해시 저장 (원본 보관 X)
- IndexedDB는 로컬 저장 (클라우드 X)

### 권한 처리
- 사용자 액션 시에만 권한 체크
- 불필요한 권한 요청 제거

## 데이터 흐름 (개념)

### 번역 요청
```
사용자: "번역" 버튼 클릭
  ↓
Sidepanel: handleTranslateAll() 호출
  ↓
Content Script: translatePage() 실행
  ├─ 1. DOM 텍스트 노드 수집
  ├─ 2. 배치 분할 (기본 50개씩)
  ├─ 3. 캐시 조회 (enableCache=true면)
  ├─ 4. OpenRouter API 호출 (캐시 미스만)
  ├─ 5. 캐시 저장 (새로 번역한 것만)
  └─ 6. DOM 업데이트 (requestAnimationFrame)
  ↓
Sidepanel: Port 수신 → UI 업데이트 (진행률, 시간, 캐시 사용)
```

### 원본 복원
```
WeakMap: textNode → originalText 저장
  ↓
"원본 보기" 클릭
  ↓
Content Script: restoreOriginal()
  ├─ WeakMap에서 모든 원본 텍스트 복원
  └─ state = 'restored'
  ↓
"번역 보기" 클릭
  ↓
Content Script: retranslate()
  └─ 다시 번역된 텍스트로 변경
```

## 주요 작업 패턴

### 새 기능 추가 시
1. `meta.js`의 `LAST_EDITED` 날짜 업데이트 (YYYY-MM-DD)
2. 기능 타입에 따라:
   - **번역 관련**: `content.js`에 추가
   - **UI 변경**: `sidepanel.html` + `sidepanel.js`에 추가
   - **백그라운드 작업**: `background.js`에 추가
3. 권한 필요 시 `manifest.json` 업데이트
4. 상태 필요 시 `translationState` 또는 `translationStateByTab`에 추가
5. 해당 docs 파일 업데이트
6. README.md 업데이트 (주요 변경사항)

### 버그 수정 시
1. 문제 재현 및 명확한 재현 방법 문서화
2. 원인 분석 (로그, 상태, Port 연결 확인)
3. 최소한의 변경으로 수정 (side effect 최소화)
4. 관련 상태 검증
5. 재현 시나리오에서 수정 확인
6. 관련 기능 회귀 테스트

## 코드 구조 및 섹션 구성

### background.js (간결함 우선)
1. 로깅 시스템
2. Extension 설치 및 초기화
3. Content Script 관리
4. Side Panel 관리 (주석만)

### content.js (명확한 13개 섹션)
1. 파일 헤더 및 전역 상태
2. IndexedDB 캐시 설정
3. 로깅 시스템
4. 진행 상태 관리
5. 타이머 관리
6. Port 연결 관리
7. 메시지 리스너
8. 번역 메인 로직
9. OpenRouter API 통신
10. 원본 복원
11. DOM 텍스트 노드 수집
12. IndexedDB 캐시 시스템
13. 초기화 함수

### sidepanel.js (명확한 10개 섹션)
1. 파일 헤더 및 설정 상수
2. 전역 상태
3. DOMContentLoaded 초기화
4. 탭바 관리 (switchTab, handleTabChange)
5. API Key UI 관리
6. 설정 관리
7. 번역 기능
8. UI 업데이트
9. 개발자 도구
10. (필요 시 추가)

### 코드 스타일 원칙

**JSDoc 주석**
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

**섹션 헤더**
```javascript
// ===== 섹션명 =====
// 섹션 설명 (필요 시)

// 관련 코드...
```

**파일 헤더**
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

**명명 규칙**
- **상수**: `UPPER_SNAKE_CASE` (예: `DEFAULT_BATCH_SIZE = 50`)
- **boolean**: `is` 또는 `has` 접두사 (예: `isTranslating`, `hasPermission`)
- **Map/배열**: 복수형 (예: `translationStateByTab`, `batches`)
- **함수**: `handle` (이벤트), `get`/`check`/`is` (조회), `update`/`set`/`save` (변경)

## 기능별 상세 문서

각 기능의 개념적 설계, 함수 목록, 데이터 흐름은 다음 문서를 참고하세요:

### 기능 문서
- **[AI 번역 (TRANSLATE.md)](./docs/TRANSLATE.md)** - 번역 메인 기능, 캐시, 배치 처리
- **[히스토리 (HISTORY.md)](./docs/HISTORY.md)** - 번역 히스토리 저장/관리
- **[검색 (SEARCH.md)](./docs/SEARCH.md)** - AI 검색 추천, 멀티 엔진 검색
- **[설정 (SETTINGS.md)](./docs/SETTINGS.md)** - API Key, 모델, 캐시 설정

### 아키텍처 & 개발 문서
- **[아키텍처 (ARCHITECTURE.md)](./docs/ARCHITECTURE.md)** - 기능 명세, 캐시 시스템, 데이터 흐름, 에러 처리, 보안
- **[코드 스타일 (CODE_STYLE.md)](./docs/CODE_STYLE.md)** - JSDoc, 섹션 구성, 파일별 구조, 명명 규칙, 메모리 관리
- **[개발 가이드 (DEVELOPMENT.md)](./docs/DEVELOPMENT.md)** - 기능 추가/수정 방법, 디버깅 팁, 배포 절차, 트러블슈팅

## 참고 사항

### 고정 원칙
- 페이지 오버레이 문구: **전면 제거** (주입 금지)
- 설정 페이지: **패널 내부에서만 표시** (새 탭 금지)
- 확장 이름: **"무조건 한글로 번역해드림"** (manifest.json)
- 패널 타이틀: **"AI 번역"** (sidepanel.html)
- 푸터 문구: **"인크로스 AI비즈솔루션팀 박영택 · 최종 수정: YYYY-MM-DD"**

### 지원 사항
- **브라우저**: Chrome, Edge, Whale, Perplexity Comet (Manifest V3 호환)
- **페이지**: http://, https://, file:// (권한 필요)
- **언어**: Korean (한글)

## 코드 유지보수 가이드

### ⚠️ 중요한 교훈 (2025-11-10)

#### 🚫 "if if if if"를 피하는 법

**잘못된 접근:**
```javascript
// ❌ 문제: 각 요구사항마다 if 조건을 추가하면 복잡도 증가
if (condition1) { /* UI 초기화 */ }
if (condition2) { /* Port 정리 */ }
if (condition3) { /* 상태 복구 */ }
if (condition4) { /* 버튼 제어 */ }
// 계속 추가되면서 관리 불가능해짐!
```

**올바른 접근:**
```javascript
// ✅ 해결: 근본적인 데이터 구조와 상태 흐름으로 해결
// 1. 탭별 상태를 Map으로 관리 (translationStateByTab)
// 2. 상태가 있으면 복구, 없으면 초기화 (단순 로직)
// 3. 번역 중이면 탭 전환 무시 (조건 최소화)

if (translationStateByTab.has(currentTabId)) {
  translationState = { ...translationStateByTab.get(currentTabId) };
} else {
  initializeTranslationState();
}

if (translationState.state === 'translating') {
  return; // 조건이 명확함
}
```

**핵심 원칙:**
1. **데이터 구조부터 설계** - if 조건이 필요 없도록
2. **상태 관리 명확화** - 상태가 모든 결정의 근거
3. **조건은 최소화** - 필수 조건만 사용
4. **개념적 설계 우선** - 코드 작성 전에 개념 정리

#### 탭별 독립 상태 관리 (2025-11-10)

**개념적 설계:**
```
각 탭은 고유한 ID를 가짐 (browser tab ID)
  ↓
탭별로 번역 상태를 독립적으로 저장 (translationStateByTab Map)
  ↓
탭 전환 시:
  - 저장된 상태 있음 → 복구
  - 없음 → 초기화
  (새 탭 vs 탭 전환 구분 필요 없음!)
  ↓
동일한 URL도 다른 탭 ID면 독립적으로 관리
```

**구현 핵심:**
1. **translationStateByTab Map**: 탭 ID → 상태 매핑
2. **깊은 복사 필수**: `batches` 배열도 `[...savedState.batches]`로 복사
3. **Port 관리**: 번역 중일 때만 유지, 완료 후 정리
4. **UI 권한 통합**: `updateUI(hasPermission)` 파라미터로 권한 상태 전달

#### 번역 중 탭 전환 보호 (2025-11-10)

**문제 상황:**
```
탭 A: 번역 중 (Port 연결, 데이터 계속 옴)
  ↓
탭 B로 이동 (Port 정리)
  ↓
UI 초기화 + Port 데이터 계속 들어옴
  ↓
탭 B의 UI에 탭 A 데이터 섞임 (UI 꼬임!)
```

**해결책:**
```javascript
// handleTabChange 함수 시작부
if (translationState.state === 'translating') {
  return; // 조건 1개로 모든 문제 해결!
}
// 나머지 로직 (안전함)
```

**결과:**
- 번역 중: UI 멈춤 없음, Port 유지
- 번역 완료: 탭 전환 정상 작동
- 안정성 극대화

### 리팩토링 이력

**2025-11-10: 탭별 독립 상태 관리 & 번역 중 탭 전환 보호**
- ✅ 탭별 UI 초기화 및 복구 로직 재설계
- ✅ `previousTabId` 제거 (불필요한 상태)
- ✅ `translationStateByTab`만으로 모든 로직 처리
- ✅ 번역 중 탭 전환 방지 (early return)
- ✅ Port 유지 조건 명확화
- ✅ `updateUI(hasPermission)` 파라미터화
- ✅ 깊은 복사로 상태 독립성 보장
- ✅ 7개 docs 파일로 문서화 체계화

**2025-11-07: 스마트 검색 탭 추가 (v2.2.0)**
- ✅ OpenRouter AI 기반 검색문 추천
- ✅ Google, Naver, Bing, ChatGPT, Perplexity 동시 검색
- ✅ 최대 10개 검색문 누적 관리
- ✅ Enter 키로 빠른 추천받기

**2025-11-06: 확장성 개선 리팩토링**
- ✅ 사용하지 않는 파일 제거 (popup.html/js, options.html/js)
- ✅ background.js 정리 및 JSDoc 주석 추가
- ✅ content.js 섹션화 및 주석 개선 (1150줄 → 명확한 13개 섹션)
- ✅ sidepanel.js JSDoc 주석 추가 및 구조화
- ✅ 모든 주요 함수에 매개변수/반환값 문서화

### 향후 확장 시 고려사항

1. **모듈화**: 향후 content.js가 더 커지면 캐시 시스템을 별도 파일로 분리 고려
2. **타입 안전성**: TypeScript 도입 검토 (JSDoc으로 현재는 충분)
3. **테스트**: 주요 함수에 단위 테스트 추가 고려
4. **성능**: 대용량 페이지(10,000+ 텍스트 노드) 테스트 및 최적화
5. **에러 처리**: 글로벌 에러 핸들러 강화 (현재는 try-catch 위주)

## 디버깅 팁

### 콘솔 에러
- **목표**: 콘솔 에러 0건 유지
- **확인 방법**: F12 > Console 탭
- **흔한 원인**:
  - Port 연결 오류 (`port.onDisconnect`)
  - 권한 없음 (`checkPermissions` 필요)
  - 상태 초기화 실패 (Map 확인)

### Port 연결 상태
```javascript
console.log('Port:', port);
port.onDisconnect.addListener(() => {
  console.warn('Port disconnected');
});
port.onMessage.addListener((msg) => {
  console.log('Message received:', msg.type);
});
```

### 권한 상태 확인
```javascript
console.log('Permission:', permissionGranted);
console.log('Current URL:', await getCurrentTabUrl());
```

### 캐시 동작 확인
- F12 > Application > IndexedDB > TranslationCache
- 확인사항: 저장된 항목 수, 해시값 형식, TTL 유효성

### 상태 추적
```javascript
console.log('Translation State:', translationState);
console.log('By Tab:', translationStateByTab.get(currentTabId));
```

## 배포 체크리스트

배포 전 반드시 확인:
- [ ] `meta.js` LAST_EDITED 날짜 업데이트 (YYYY-MM-DD)
- [ ] `manifest.json` version 업데이트 (필요 시)
- [ ] README.md 업데이트 (주요 변경사항)
- [ ] 콘솔 에러 0건 확인
- [ ] 주요 기능 동작 확인
  - [ ] 번역 (캐시 포함)
  - [ ] 원본 보기
  - [ ] 설정 저장/로드
  - [ ] 히스토리 저장/로드
  - [ ] 검색 추천/검색
- [ ] 권한 없는 페이지 동작 확인
- [ ] 번역 중 탭 전환 테스트
- [ ] 여러 탭에서 동일 URL 테스트
- [ ] CLAUDE.md 업데이트 (변경사항 반영)

## 릴리스 절차

1. **버전 업데이트**
   - `manifest.json` version (2.1.0 → 2.2.0 등)
   - README.md 버전 정보
   - `meta.js` LAST_EDITED 날짜

2. **변경사항 문서화**
   - README.md에 "최근 업데이트" 추가
   - CLAUDE.md 리팩토링 이력 추가
   - 날짜: YYYY-MM-DD 형식

3. **Git 커밋**
   - 의미있는 커밋 메시지
   - 이모지 활용 (🔄, 🐛, ✨, 📚 등)
   - 예: `🔄 탭별 독립 상태 관리 구현`

4. **GitHub 푸시**
   ```bash
   git push origin master
   ```

5. **태그 생성** (선택)
   ```bash
   git tag v2.2.0
   git push origin v2.2.0
   ```

6. **Chrome Web Store** (필요 시)
   - 새 버전 업로드
   - 스크린샷 업데이트
   - 설명 업데이트
