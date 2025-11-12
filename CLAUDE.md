# 프로젝트 개요

## 확장 프로그램 정보
- **이름**: 무조건 한글로 번역해드림
- **버전**: 2.2.0
- **설명**: OpenRouter AI를 사용하여 웹페이지를 한글로 번역하는 크롬 확장 프로그램
- **개발**: 인크로스 AI비즈솔루션팀 박영택
- **최종 수정**: 2025-11-12 (meta.js 참고)

## 파일 구조

```
chrome_ext_yt_ai/
├── manifest.json              # Chrome 확장 메타데이터
├── background.js              # Service Worker - Content Script 관리
├── content.js                 # Content Script - 메인 오케스트레이터 (14섹션)
├── content/                   # Content Script 모듈 (7개 모듈)
│  ├── bootstrap.js            # WPT 네임스페이스 초기화
│  ├── api.js                  # OpenRouter API 호출/재시도
│  ├── cache.js                # IndexedDB 캐시 관리
│  ├── industry.js             # 산업군 추론/지시문
│  ├── dom.js                  # 텍스트 수집/DOM 적용
│  ├── title.js                # 제목 번역/적용
│  └── progress.js             # 타이머/진행/푸시
├── sidepanel.html             # 사이드패널 UI (5개 탭, 스타일 인라인)
├── sidepanel.js               # 사이드패널 메인 로직
├── sidepanel/                 # 사이드패널 부트스트랩
│  └── bootstrap.js
├── modules/                   # 사이드패널 ES6 모듈 (11개 모듈)
│  ├── constants.js            # 메시지 액션/포트/저장소 상수
│  ├── state.js                # 전역 상태 관리 (맵/변수)
│  ├── ui-utils.js             # UI 업데이트, 탭바, 토스트
│  ├── translation.js          # 번역 핵심 로직, 권한 관리
│  ├── history.js              # 번역 히스토리 CRUD
│  ├── settings.js             # 설정 탭 (API, 모델, 배치, 캐시)
│  ├── search.js               # 스마트 검색 탭 (AI 추천)
│  ├── quick-translate.js      # 직접 텍스트 번역 탭
│  ├── recurring.js            # 반복 체크리스트 탭 (카테고리/할일 관리)
│  ├── flags.js                # 런타임 기능 플래그
│  └── types.js                # JSDoc typedef
├── logger.js                  # 공용 로깅 시스템 (ES6 모듈)
├── meta.js                    # 메타 정보 (푸터, 수정 날짜)
├── README.md                  # 사용자 가이드
├── CLAUDE.md                  # 개발 가이드 (현재 파일)
├── AGENTS.md                  # Claude Code 에이전트 설정
├── icons/                     # 확장 아이콘
│  ├── icon16.png
│  ├── icon48.png
│  └── icon128.png
├── create_icons.py            # 아이콘 생성 스크립트 (선택적)
└── .claude/                   # Claude Code 설정
   └── settings.local.json
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

### 번역 탭 (Page Translation)
- **모드**: 캐시 우선 vs 전면 재번역
- **진행 표시**: 실시간 % 진행, 배치 목록, 경과 시간
- **원본 토글**: 번역문/원문 전환 (WeakMap 기반 자동 복원)
- **권한**: http/https/file:// 만 지원 (Chrome 웹스토어 제외)
- **탭별 독립**: 각 탭마다 별도 번역 상태 관리

### 텍스트 번역 탭 (Quick Translate)
- **직접 입력**: 클립보드 텍스트 붙여넣고 즉시 번역
- **단축키**: Ctrl+Enter로 빠른 번역
- **번역 결과**: 원본 보기/숨기기 토글
- **히스토리**: 최근 50개 번역 저장 (개별/전체 삭제)
- **타임스탐프**: 각 항목별 날짜·시간 표시

### 히스토리 탭 (Translation History)
- **자동 저장**: 웹페이지 번역 완료 시 자동 기록
- **URL 중복 제거**: 같은 URL은 최신 번역만 유지
- **빠른 재번역**: 히스토리 선택 → 새 탭 열기 + 동일 설정으로 재번역
- **저장 정보**: 번역된 제목, 원본 제목, 프리뷰, URL, 날짜, 모드
- **관리**: 개별 삭제, 3초 확인 후 전체 삭제

### 검색 탭 (Smart Search)
- **AI 추천**: 검색문 입력 → AI가 3개 최적화 키워드 자동 생성
- **누적 목록**: 최대 10개 검색문 (사용자 입력 1개 + AI 추천 9개)
- **다중 엔진**: Google, Naver, Bing, ChatGPT, Perplexity 동시 검색
- **배경 탭**: 모든 검색 결과는 백그라운드 탭으로 열기
- **개별 검색**: 각 엔진별 버튼으로 따로 검색 가능

### 반복관리 탭 (Recurring Checklist)
- **카테고리 관리**: 카테고리별로 반복 할일 그룹 관리
  - 추가: 인라인 입력으로 새 카테고리 생성 (등록 시 자동 선택)
  - 수정: 카테고리명 클릭 → 인라인 편집
  - 삭제: 버튼 클릭으로 즉시 삭제
- **할일 관리**: 카테고리별 체크리스트 관리
  - 체크/언체크: 완료 여부 토글
  - 추가: 하단 입력창 (Enter 단축키 지원)
  - 수정: 할일 텍스트 클릭 → 인라인 편집
  - 삭제: 아이콘 버튼으로 즉시 삭제
  - 드래그앤드롭: 순서 재정렬
- **초기화**: 현재 카테고리의 모든 체크 해제 (반복 시작)
- **백업/복현**: 전체 데이터 MD 파일로 내보내기/가져오기
- **현황 복사**: 현재 카테고리의 체크 상태를 텍스트로 클립보드 복사 (보고용)
- **저장소**: Chrome Local Storage (번역 기능과 독립)

### GEO 검사 탭 (GEO Audit)
- **목적**: Generative Engine Optimization 검사 - 검색엔진 및 생성형 AI 최적화 점수 측정
- **검사 항목**: 18개 체크리스트 (SEO 6개, AEO 5개, GEO 7개)
  - **SEO (Search Engine Optimization)**: 검색엔진 크롤러가 읽는 기본 메타 정보
  - **AEO (Answer Engine Optimization)**: ChatGPT 등 생성형 AI가 참고하는 구조화 데이터
  - **GEO (Generative Engine Optimization)**: SEO + AEO 통합 최적화
- **점수 체계**:
  - 각 항목의 **존재 여부**만 검증 (글자수 범위는 권장사항)
  - 카테고리별 가중치 기반 점수 계산 (0-100)
  - 총점 = 세 카테고리 평균
- **검사 과정**:
  1. `runAudit()` - 각 항목 selector/validator 실행
  2. `calculateScores()` - 카테고리별 점수 계산
  3. `getImprovement()` - LLM에 상위 3개 개선 사항 요청
- **LLM 개선 의견**:
  - 마크다운 형식으로 정렬된 개선사항 반환
  - 각 항목마다 "구체적인 실행 방법" + "예상 효과" 제시
  - 코드 예시 포함 (HTML/JSON)
- **SSR/CSR 인식**:
  - SSR(Server-Side Rendering): HTML에 직접 포함 → 검색봇 읽음 (✅)
  - CSR(Client-Side Rendering): JavaScript 동적 추가 → 검색봇 못 읽음 (❌)
  - 체크리스트에 SSR/CSR 주의 표시로 사용자 이해도 향상
- **UI 렌더링**:
  - 점수 카드: 4열 그리드, 모두 동일 높이 (80px)
  - 개선 의견: 마크다운 완전 지원 (h2/h3/h4, 리스트, 코드블록, 인라인 코드)
  - 섹션 제목: "제목:" 패턴 자동 감지 → 파란 스타일 적용
- **저장소**: Chrome Local Storage (번역 기능과 독립)
- **파일 구조**:
  - `modules/geo-audit.js` - 검사 엔진 핵심 로직
  - `modules/geo-checklist.js` - 18개 체크리스트 정의
  - `modules/geo-ui.js` - UI 렌더링 및 마크다운 변환
  - `modules/geo-tab.js` - 탭 이벤트 핸들러

### 설정 탭 (Settings)
- **API Key**: 마스킹 (앞 8자 + "***") 및 검증
- **모델**: 드롭다운 선택 (기본: `openai/gpt-4o-mini`)
- **배치 크기**: 10-200 (기본 50), 범위 검증
- **동시 처리**: 1-10 (기본 3), 범위 검증
- **자동 번역**: 캐시된 페이지 자동 번역 토글
- **캐시 관리**: 도메인별 캐시 항목 수/용량 표시 + 삭제
- **캐시 TTL**: 1분-365일 (기본 30일)
- **개발자 모드**: ON(모든 로그) / OFF(로그 차단)
- **에러 로그**: 복사 버튼 (실시간 카운트)

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
9. **번역 메인 로직** - 텍스트 배치 처리, 재시도, 캐시 활용
10. OpenRouter API 통신 - 스트리밍 응답, 에러 처리
11. 원본 복원 - WeakMap 기반 원문 저장
12. DOM 텍스트 노드 수집 - 번역 대상 선택, 필터링
13. IndexedDB 캐시 시스템 - 저장, 조회, TTL 관리
14. 초기화 함수 - 페이지 로드 시 권한 확인

각 섹션 상단의 JSDoc 주석을 참고하세요.

### content/ 모듈 (7개 보조 모듈)
1. **bootstrap.js** - WPT 네임스페이스 초기화
2. **api.js** - OpenRouter API 호출 및 재시도 로직
3. **cache.js** - IndexedDB 캐시 CRUD
4. **industry.js** - 산업군 추론 및 지시문 생성
5. **dom.js** - 텍스트 수집 및 DOM 적용
6. **title.js** - 페이지 제목 번역
7. **progress.js** - 진행 상태 관리 및 Port 통신

### 사이드패널 모듈 구조 (10개 함수형 모듈)

사이드패널은 **책임 분리 원칙(SRP)**으로 각 기능별 모듈로 구성:

**메인 파일:**
- `sidepanel.js` - DOMContentLoaded 초기화, Chrome 탭 리스너
- `sidepanel/bootstrap.js` - 모듈 임포트 및 초기화

**상태 & 유틸리티:**
1. **state.js** - 전역 상태 (탭별 맵, 포트, 권한, 설정)
   - `currentTabId`, `portsByTab`, `permissionGranted`
   - `translationStateByTab`, `translateModeByTab`
   - Setter 함수로 상태 업데이트

2. **constants.js** - 메시지 문자열 중앙화
   - `PORT_NAMES`: 포트명 정의
   - `ACTIONS`: 메시지 액션 타입
   - `STORAGE_KEYS`: 저장소 키

3. **ui-utils.js** - UI 렌더링 & 상호작용
   - 탭 전환, 토스트 표시
   - 번역 진행바, 상태 표시
   - 에러 로그 출력, 개발자 도구
   - Content Script PING + 주입

**기능 모듈:**
4. **translation.js** - 번역 핵심 로직
   - 권한 체크 (http/https/file://)
   - 캐시/전면 번역 모드 선택
   - Port 연결 및 진행 상태 수신
   - 자동 번역 (선택사항)

5. **history.js** - 번역 히스토리 CRUD
   - URL 기반 자동 중복 제거
   - 히스토리 항목 재번역 (새 탭)
   - 개별/전체 삭제 (3초 확인)

6. **quick-translate.js** - 직접 텍스트 번역
   - 입력창 즉시 번역
   - 독립 히스토리 (최대 50개)
   - 원문/번역문 토글

7. **search.js** - 스마트 검색 (AI 추천)
   - AI 검색어 3개 자동 생성
   - 누적 추천 (최대 10개)
   - 5개 엔진 동시 백그라운드 열기

8. **settings.js** - 설정 탭 관리
   - API Key, 모델, 배치, 동시성
   - 자동 번역, 캐시 TTL, 디버그 모드
   - 도메인별 캐시 통계

**문서화 & 확장:**
9. **types.js** - JSDoc typedef
   - `BatchInfo`, `TranslationState`, `ProgressPayload`

10. **flags.js** - 런타임 기능 플래그
   - `searchEnhance`, `domBatchRaf` 등
   - 향후 기능 토글용

**아키텍처 원칙:**
- 상태는 `state.js`에서만 관리
- 모든 상수는 `constants.js` 사용
- UI 변경은 `ui-utils.js`로 통일
- 각 탭 기능은 독립 모듈 (history, search, settings, quick-translate)

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
