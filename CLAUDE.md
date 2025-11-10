# 프로젝트 개요

## 확장 프로그램 정보
- **이름**: 무조건 한글로 번역해드림
- **버전**: 2.2.0
- **설명**: OpenRouter AI를 사용하여 웹페이지를 한글로 번역하는 크롬 확장 프로그램
- **개발**: 인크로스 AI비즈솔루션팀 박영택

## 파일 구조

```
chrome_ext_yt_ai/
├── manifest.json              # Chrome 확장 메타데이터
├── background.js              # Service Worker (Content Script 관리)
├── content.js                 # Content Script (DOM 번역 로직)
├── sidepanel.html             # 패널 UI (HTML)
├── sidepanel.js               # 패널 로직 (번역/히스토리/검색/설정)
├── sidepanel.css              # 패널 스타일
├── logger.js                  # 공용 로깅 시스템 (ES6 모듈)
├── meta.js                    # 메타 정보 (최종 수정일)
├── docs/
│   ├── TRANSLATE.md           # AI 번역 기능 상세
│   ├── HISTORY.md             # 히스토리 기능 상세
│   ├── SEARCH.md              # 검색 기능 상세
│   └── SETTINGS.md            # 설정 기능 상세
└── icons/                     # 확장 아이콘
```

## 핵심 아키텍처

### 파일별 역할

| 파일 | 역할 | 상세 문서 |
|------|------|----------|
| `background.js` | Service Worker, Content Script 관리 | - |
| `content.js` | DOM 번역, 캐시, 배치 처리 | [TRANSLATE.md](./docs/TRANSLATE.md) |
| `sidepanel.html` | UI 마크업 (번역/히스토리/검색/설정 탭) | - |
| `sidepanel.js` | 탭 관리, 상태 관리, 기능 통합 | 각 docs 파일 참고 |
| `logger.js` | 로깅 시스템 | - |
| `meta.js` | 메타 정보 (최종 수정일) | - |

## 패널 동작 원칙 ⚠️ 중요!

### 핵심 원칙

1. **패널은 Window-Level로 동작**
   - 한번 열면 해당 창의 모든 탭에서 보임
   - Chrome이 자동으로 관리 (manifest.json: `default_open_panel_on_action_click: true`)
   - background.js는 패널 상태를 추적하지 않음

2. **탭별 번역 상태는 독립적으로 관리**
   - ✅ `translationStateByTab` Map으로 각 탭의 번역 상태 저장
   - ✅ 탭 전환 시 저장된 상태 복구 또는 초기화
   - ✅ 동일한 URL도 다른 탭 ID면 독립적으로 관리
   - ❌ **하지만 패널 자체의 열림/닫힘 상태는 추적 금지** (Window-level)

3. **URL/권한 체크는 사용자 액션 시에만**
   - ✅ 번역 버튼 클릭 시 `checkPermissions()` 호출
   - ✅ 지원하지 않는 URL(chrome://, edge://)은 UI로 안내
   - ✅ sidepanel.js의 `handleTranslateAll()`에서 최종 검증
   - ❌ 탭 이동 시 자동으로 권한 체크 로그 출력 금지

4. **불필요한 로그 방지**
   - `chrome://newtab/` 같은 URL에서 패널이 보여도 경고 출력 안 함
   - 탭 이동 시 조용한 UI 업데이트만 수행 (권한 확인)
   - 사용자가 번역 시도할 때만 에러 메시지 표시

5. **번역 중 탭 전환 방지**
   - ✅ 번역 중(state='translating')이면 탭 전환 무시
   - ✅ Port 유지하여 진행 상태 UI 업데이트 계속
   - ✅ 완료 후에야 탭 전환 허용

### 금지 패턴
```javascript
// ❌ 탭별 패널 상태(열림/닫힘) 추적 금지!
const panelOpenState = new Map();
chrome.action.onClicked.addListener(() => {
  if (panelOpenState.get(tabId)) { ... }
});

// ❌ 탭 변경할 때마다 불필요한 로그 출력 금지!
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!/^https?:/.test(tab.url)) {
    logWarn('UNSUPPORTED_URL', ...); // 불필요한 경고!
  }
});

// ❌ 번역 중에 Port 끊기 금지!
if (port) {
  port.disconnect(); // 번역 중이면 절대 금지!
}
```

### 올바른 패턴
```javascript
// ✅ 탭별 번역 상태는 Map으로 독립 관리
const translationStateByTab = new Map();
if (translationStateByTab.has(currentTabId)) {
  translationState = { ...translationStateByTab.get(currentTabId) };
}

// ✅ 번역 중이면 탭 전환 무시
if (translationState.state === 'translating') {
  return; // 탭 전환 무시, Port 유지
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
- **패널 배경**: `#0B0B0F`
- **탭바 배경**: `#121418`
- **텍스트 (주)**: `#EDEEF0`
- **텍스트 (부)**: `#A9AFB8`
- **활성 인디케이터**: 좌측 2px `#2A6CF0`
- **아이콘**: 20-24px
- **라벨**: 11-12px, 중앙 정렬
- **탭바 폭**: 56-64px

### 접근성
- **ARIA**: `role="tablist"`, `role="tab"`, `aria-selected`
- **키보드**: 화살표(←→↑↓) 탭 이동, Enter/Space 선택
- **포커스 링**: `outline: 2px solid rgba(42,108,240,0.6)`

## 기능 명세

### 번역 탭
- **버튼 1**: "현재 페이지 모두 번역 (빠른 모드)" → 캐시 우선
- **버튼 2**: "현재 페이지 모두 새로 번역 (캐시 무시)" → 전면 재번역
- **원본 보기**: 번역 1건 이상 시 활성화, WeakMap 복원
- **상태 표시**: 완료 n/m (p%), 번역된 텍스트, 배치 수, 진행 시간, 캐시 사용
- **권한 가드**: http/https/file:// 스킴만 지원, 불가 스킴은 안내 메시지

### 설정 탭
- **API 설정**: OpenRouter Key, 모델 선택 (기본: `openai/gpt-4o-mini`)
- **번역 설정**: 배치 크기(기본 50), 동시 처리(기본 3)
- **캐시 설정**:
  - 캐시 사용 토글 (44×24px)
  - 캐시 유지 기간 (분/시간/일 단위 선택, 기본 30일, 최대 365일)
  - 이 페이지 캐시 비우기 / 전역 캐시 비우기
- **저장 바**: 하단 고정, 변경 시에만 활성화, 성공 시 2초 토스트

### 캐시 시스템
- **저장소**: IndexedDB (`TranslationCache`)
- **키**: `sha1(normalize(text))`
- **값**: `{translation, ts, model}`
- **TTL**: 기본 30일 (설정 변경 가능, 최대 365일)
- **재검증**: 적용 직전 해시 비교, 불일치 시 재번역
- **대규모 변경**: 페이지 변경률 ≥20% 시 자동 전면 재번역

## 성능 최적화
- 배치 크기/동시성 설정 가능
- 429 에러 시 동시성 자동 하향 (옵션)
- DOM 업데이트는 `requestAnimationFrame` 일괄 처리
- 패널 1클릭 오픈 (`openPanelOnActionClick: true`)

## 주요 작업 패턴

### 새 기능 추가 시
1. `meta.js`의 `LAST_EDITED` 날짜 업데이트
2. 번역 관련 로직은 `content.js`에 추가
3. UI 변경은 `sidepanel.html` + `sidepanel.js`
4. 백그라운드 작업은 `background.js`
5. 권한 필요 시 `manifest.json` 업데이트

### 디버깅 팁
- 콘솔 에러 0건 유지 필수
- Port 연결 상태 확인 (`port.onDisconnect`)
- 권한 상태 체크 (`checkPermissions`)
- 캐시 동작 확인 (IndexedDB 개발자 도구)

## 코드 구조 및 문서화

### 코드 스타일
- **JSDoc 주석**: 모든 주요 함수에 매개변수, 반환값, 설명 추가
- **섹션 구분**: 각 파일에 명확한 섹션 주석 (`// ===== 섹션명 =====`)
- **파일 헤더**: 각 파일 상단에 파일 목적 및 주요 기능 설명
- **인라인 주석**: 복잡한 로직에 설명 추가

### 주요 섹션 구성
#### background.js
1. 로깅 시스템
2. Extension 설치 및 초기화
3. Content Script 관리
4. Side Panel 관리 (주석만, 실제 코드 없음)

#### content.js
1. 전역 상태
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
13. 초기화

#### sidepanel.js
1. 설정 상수
2. 전역 상태
3. 초기화
4. 탭바 관리
5. API Key UI 관리
6. 설정 관리
7. 번역 기능
8. UI 업데이트
9. 개발자 도구

## 기능별 문서

각 기능의 상세한 개념, 함수, 데이터 흐름은 다음 문서를 참고하세요:

### 기능 문서
- **[AI 번역 (TRANSLATE.md)](./docs/TRANSLATE.md)** - 번역 메인 기능, 캐시, 배치 처리
- **[히스토리 (HISTORY.md)](./docs/HISTORY.md)** - 번역 히스토리 저장/관리
- **[검색 (SEARCH.md)](./docs/SEARCH.md)** - AI 검색 추천, 멀티 엔진 검색
- **[설정 (SETTINGS.md)](./docs/SETTINGS.md)** - API Key, 모델, 캐시 설정

### 아키텍처 & 개발 문서
- **[아키텍처 (ARCHITECTURE.md)](./docs/ARCHITECTURE.md)** - 기능 명세, 캐시 시스템, 데이터 흐름, 에러 처리
- **[코드 스타일 (CODE_STYLE.md)](./docs/CODE_STYLE.md)** - JSDoc, 섹션 구성, 파일별 구조, 명명 규칙
- **[개발 가이드 (DEVELOPMENT.md)](./docs/DEVELOPMENT.md)** - 기능 추가/수정 방법, 디버깅 팁, 배포 절차

## 참고 사항
- 페이지 오버레이 문구는 전면 제거
- 설정 페이지는 패널 내부에서만 표시 (새 탭 금지)
- 푸터 문구: "인크로스 AI비즈솔루션팀 박영택 · 최종 수정: YYYY-MM-DD"
- manifest.json의 확장 이름: "무조건 한글로 번역해드림"
- 패널 내부 타이틀: "AI 번역"

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
  // 상태 복구
} else {
  // 초기화
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

**구현 포인트:**
1. **translationStateByTab Map**: 탭 ID → 상태 매핑
2. **깊은 복사 필수**: batches 배열 등도 독립 복사
3. **Port 관리**: 번역 중일 때만 유지, 완료 후 정리
4. **UI 권한 통합**: updateUI(hasPermission) 파라미터로 권한 상태 전달

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
// 번역 중이면 탭 전환 무시
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
**2025-11-10: 탭별 독립 상태 관리 & 번역 중 보호**
- ✅ 탭별 UI 초기화 및 복구 로직 재설계
- ✅ previousTabId 제거 (불필요한 상태)
- ✅ translationStateByTab만으로 모든 로직 처리
- ✅ 번역 중 탭 전환 방지 (early return)
- ✅ Port 유지 조건 명확화
- ✅ updateUI(hasPermission) 파라미터화
- ✅ 깊은 복사로 상태 독립성 보장

**2025-11-06: 확장성 개선 리팩토링**
- ✅ 사용하지 않는 파일 제거 (popup.html/js, options.html/js)
- ✅ background.js 정리 및 JSDoc 주석 추가
- ✅ content.js 섹션화 및 주석 개선 (1150줄 → 명확한 13개 섹션)
- ✅ sidepanel.js JSDoc 주석 추가 및 구조화
- ✅ 모든 주요 함수에 매개변수/반환값 문서화
- ✅ CLAUDE.md 업데이트 (코드 구조 및 섹션 설명 추가)

### 향후 확장 시 고려사항
1. **모듈화**: 향후 content.js가 더 커지면 캐시 시스템을 별도 파일로 분리 고려
2. **타입 안전성**: TypeScript 도입 검토 (JSDoc으로 현재는 충분)
3. **테스트**: 주요 함수에 단위 테스트 추가 고려
4. **성능**: 대용량 페이지(10,000+ 텍스트 노드) 테스트 및 최적화
5. **에러 처리**: 글로벌 에러 핸들러 강화 (현재는 try-catch 위주)
