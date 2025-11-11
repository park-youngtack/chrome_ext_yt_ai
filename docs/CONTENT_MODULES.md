# Content 모듈 구조

이 디렉터리 구조는 사람이 봐도 역할이 명확하도록 설계했습니다. 핵심은 "주입 순서"와 "WPT 네임스페이스" 일관성입니다.

주요 파일
- content/bootstrap.js
  - WPT 네임스페이스와 공용 상수(ACTIONS, PORT_NAMES, PORT_MESSAGES) 정의
  - 모든 content 로직보다 먼저 주입됨
- content.js (메인 오케스트레이터)
  - 기존 번역 파이프라인 전체 로직
  - 내부 헬퍼(WPT.Api/Cache/Progress/Industry) 노출

향후 분할(권장 단계)
1) content/api.js → WPT.Api (executeWithRetry, requestOpenRouter)
2) content/progress.js → WPT.Progress (타이머, pushProgress)
3) content/cache.js → WPT.Cache (openDB, get/setCachedTranslation 등)
4) content/industry.js → WPT.Industry (분야 분석)
5) content/main.js → 메인(현재 content.js 역할)

주입 순서 예시(등록/수동 주입 동일)
1. 'content/bootstrap.js'
2. 'content/api.js' (선택)
3. 'content/progress.js' (선택)
4. 'content/cache.js' (선택)
5. 'content/industry.js' (선택)
6. 'content.js' 또는 'content/main.js'

가이드라인
- content 스크립트는 ES 모듈 import를 사용하지 않음 → window.WPT로 연결
- background.js와 sidepanel의 executeScript에서도 동일 순서로 파일 배열을 전달
- 파일 개수가 늘어나면 background의 registerContentScripts를 업데이트

