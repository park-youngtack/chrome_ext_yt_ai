# 프로젝트 개요

## 확장 프로그램 정보
- **이름**: 무조건 한글로 번역해드림
- **버전**: 2.1.0
- **설명**: OpenRouter AI를 사용하여 웹페이지를 한글로 번역하는 크롬 확장 프로그램
- **개발**: 인크로스 AI비즈솔루션팀 박영택

## 핵심 아키텍처

### 파일 구조
```
chrome_ext_yt_ai/
├── manifest.json         # 확장 프로그램 메타데이터
├── background.js         # Service Worker (사이드패널 관리, 메시지 라우팅)
├── content.js           # 콘텐츠 스크립트 (DOM 번역 로직)
├── sidepanel.html       # 사이드패널 UI (우측 세로 탭바 레이아웃)
├── sidepanel.js         # 사이드패널 로직 (탭 전환, 상태 관리)
├── logger.js            # 공용 로깅 시스템 (ES6 모듈)
├── meta.js              # 메타 정보 (푸터 텍스트, 최종 수정일)
└── icons/               # 확장 아이콘
```

### 주요 컴포넌트

#### 1. Background Service Worker (`background.js`)
- **Content script 자동 등록** (persistAcrossSessions)
- **Content script 수동 주입** (필요 시 ensureContentScript)
- **패널은 Chrome이 자동 관리** (manifest.json의 default_open_panel_on_action_click: true)
- ❌ **탭별 패널 상태 추적 안 함** (window-level로 동작)
- ❌ **URL 변경 감지 안 함** (불필요한 로그 방지)

#### 2. Content Script (`content.js`)
- DOM 텍스트 노드 수집 및 번역
- IndexedDB 기반 캐시 시스템 (TTL 60분 기본)
- 배치 처리 (기본 50개 문장, 동시 3개 배치)
- WeakMap 기반 원본 텍스트 복원
- Port를 통한 실시간 진행 상태 푸시
- 해시 재검증 및 대규모 변경(≥20%) 감지

#### 3. Side Panel (`sidepanel.html` + `sidepanel.js`)
- **레이아웃**: 우측 세로 탭바 (번역|설정|닫기)
- **탭 전환**: 패널 내부에서 처리, 새 탭/창 열지 않음
- **딥링크**: `#translate`, `#settings` 지원
- **세션 복원**: 마지막 탭 상태 저장/복원
- **실시간 UI**: Port를 통한 진행률/시간 업데이트 (1초마다)
- **권한 체크**: 탭 변경 시 UI 업데이트 (조용한 체크), 번역 버튼 클릭 시 최종 검증
- **ES6 모듈**: logger.js, meta.js import 사용

#### 4. Logger (`logger.js`)
- **공용 로거**: sidepanel.js에서 사용 (background.js와 content.js는 인라인 로거 사용)
- **로그 레벨**: DEBUG, INFO, WARN, ERROR
- **민감정보 마스킹**: API Key (앞 8자만), 텍스트 (20자 제한)
- **로그 버퍼**: session storage에 최근 500개 저장
- **개발자 도구**: 로그 복사 기능 (이슈 리포트용)

## 패널 동작 원칙 ⚠️ 중요!

### 핵심 원칙
1. **패널은 Window-Level로 동작**
   - 한번 열면 해당 창의 모든 탭에서 보임
   - Chrome이 자동으로 관리 (manifest.json: `default_open_panel_on_action_click: true`)
   - background.js는 패널 상태를 추적하지 않음

2. **탭별 상태 관리 금지**
   - ❌ `panelOpenState` Map 같은 탭별 추적 코드 작성 금지
   - ❌ `chrome.tabs.onUpdated`로 URL 변경 감지하여 경고 출력 금지
   - ❌ 탭 이동 시마다 권한 체크하여 로그 출력 금지

3. **URL/권한 체크는 사용자 액션 시에만**
   - ✅ 번역 버튼 클릭 시 `checkPermissions()` 호출
   - ✅ 지원하지 않는 URL(chrome://, edge://)은 UI로 안내
   - ✅ sidepanel.js의 `handleTranslateAll()`에서 최종 검증

4. **불필요한 로그 방지**
   - `chrome://newtab/` 같은 URL에서 패널이 보여도 경고 출력 안 함
   - 탭 이동 시 조용한 UI 업데이트만 수행
   - 사용자가 번역 시도할 때만 에러 메시지 표시

### 금지 패턴
```javascript
// ❌ 절대 이런 코드 작성 금지!
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!/^https?:/.test(tab.url)) {
    logWarn('UNSUPPORTED_URL', ...); // 불필요한 경고!
  }
});

// ❌ 탭별 패널 상태 추적 금지!
const panelOpenState = new Map();
chrome.action.onClicked.addListener(() => {
  if (panelOpenState.get(tabId)) { ... }
});
```

### 올바른 패턴
```javascript
// ✅ 사용자 액션 시에만 체크
async function handleTranslateAll() {
  if (!permissionGranted) {
    showToast('권한을 먼저 허용해주세요.', 'error');
    return;
  }
  // 번역 진행...
}

// ✅ 탭 변경 시 조용한 UI 업데이트
chrome.tabs.onActivated.addListener(async () => {
  currentTabId = tab.id;
  await checkPermissions(tab); // UI만 업데이트, 로그 최소화
});
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
  - 캐시 만료 시간(분) (기본 60, 범위 5-1440)
  - 이 페이지 캐시 비우기 / 전역 캐시 비우기
- **저장 바**: 하단 고정, 변경 시에만 활성화, 성공 시 2초 토스트

### 캐시 시스템
- **저장소**: IndexedDB (`TranslationCache`)
- **키**: `sha1(normalize(text))`
- **값**: `{translation, ts, model}`
- **TTL**: 기본 60분 (설정 변경 가능)
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

## 참고 사항
- 페이지 오버레이 문구는 전면 제거
- 설정 페이지는 패널 내부에서만 표시 (새 탭 금지)
- 푸터 문구: "인크로스 AI비즈솔루션팀 박영택 · 최종 수정: YYYY-MM-DD"
- manifest.json의 확장 이름: "무조건 한글로 번역해드림"
- 패널 내부 타이틀: "AI 번역"

## 코드 유지보수 가이드

### 리팩토링 이력
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
