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

