# Sidepanel 모듈 구조

사이드패널 로직은 ES 모듈 기반으로 이미 `modules/` 아래에 분리되어 있습니다. 사람이 보기에도 명확하도록 엔트리 파일을 폴더로 정리했습니다.

주요 파일
- sidepanel/bootstrap.js
  - 엔트리 포인트(폴더) 역할. 실제 초기화는 기존 `sidepanel.js`를 import
- sidepanel.js (루트)
  - DOMContentLoaded에서 초기화, 모듈 임포트 및 이벤트 바인딩
- modules/*.js
  - state.js, translation.js, ui-utils.js, settings.js, history.js, search.js 등 기능별 분리

규칙
- HTML에서는 `sidepanel/bootstrap.js`만 로드합니다.
- 로직은 기존대로 유지하되, 기능 추가는 `modules/`에 파일을 추가하고 sidepanel.js에서 import만 늘립니다.
- 문서/스펙 변경 시 docs/ 하위 문서를 업데이트합니다.

