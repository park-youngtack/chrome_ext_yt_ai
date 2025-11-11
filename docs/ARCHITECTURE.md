# 아키텍처 개요

본 확장은 3계층으로 구성됩니다.

- Background(Service Worker): 설치/초기화, content script 등록, 전역 캐시 조회 등 브라우저 수명주기 관리
- Content Script: 페이지 내 DOM 수집/번역/캐시/진행 상태 푸시(Port)
- Side Panel: UI, 설정/히스토리/검색, 탭 전환/권한 체크, 상태 렌더링

주요 흐름
- 사용자가 패널에서 번역 시작 → sidepanel → content.js로 메시지 전송 → content.js가 배치 번역 및 Port로 진행 상황 푸시 → sidepanel이 활성 탭일 때만 UI 반영 → 완료 시 히스토리 저장

상태 관리
- 탭별 상태: `translationStateByTab: Map<number, TranslationState>`
- 활성 탭 상태: `translationState` (렌더링용 뷰 모델)
- Port: `portsByTab: Map<number, chrome.runtime.Port>` (탭별 유지)

메시지 채널
- Request/Response: `chrome.tabs.sendMessage` (액션 기반)
- Realtime: `Port`(name: `panel`)로 content → sidepanel 진행 상황 푸시

캐시
- IndexedDB `TranslationCache.translations`
- 키: `sha1(text.trim().toLowerCase())`, 값: `{ translation, ts, model }`

가드/원칙
- 번역 중 포트 끊지 않기, 활성 탭만 UI 반영, 지원 불가 URL에서 조용한 처리

모듈 구성(요약)
- content/bootstrap.js: WPT 네임스페이스/상수 정의
- content/api.js: OpenRouter API 호출/재시도 (WPT.Api)
- content/cache.js: IndexedDB 캐시 유틸 (WPT.Cache)
- content/industry.js: 산업군 추론/지시문 (WPT.Industry)
- content/dom.js: 텍스트 수집/DOM 적용 (WPT.Dom, setEnv로 상태 주입)
- content/title.js: 제목 번역/적용 (WPT.Title)
- content/progress.js: 진행/타이머/푸시 (WPT.Progress)
- content.js: 오케스트레이터(파이프라인 본체)

주입 순서
1. content/bootstrap.js
2. content/api.js
3. content/cache.js
4. content/industry.js
5. content/dom.js
6. content/title.js
7. content/progress.js
8. content.js (메인)
