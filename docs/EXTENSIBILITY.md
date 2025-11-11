# 확장 가이드

목표
- 기능 추가 시 공통 패턴/경계 유지, 회귀 최소화, 메시징/상태 일관성 확보

확장 포인트
- Side Panel 탭 추가: `sidepanel.html`에 탭/컨텐츠 추가 → 로직은 `modules/<feature>.js`에 분리 → `sidepanel.js` 초기화 지점에 한 줄 등록
- Content 확장(전처리/후처리): `content.js`의 섹션 구조를 유지하고, 기능 플래그로 토글(예: 도메인별 규칙, 추가 필터링)
- 메시지 추가: `modules/constants.js`에 액션 추가 → content/sidepanel 각각 리스너/발신부에 추가 → `docs/MESSAGING.md`에 문서화
- 캐시 전략: TTL/변경률 정책 확장 → `content.js` 캐시 섹션에 함수 단위로 추가, 기존 인터페이스 유지

코드 원칙
- 상수/타입 중앙화: `modules/constants.js`, `modules/types.js`
- 상태는 Map에 보관 후 활성 탭만 렌더
- 포트는 탭별로 유지, 번역 중에는 끊지 않음

기능 플래그(권장)
- `modules/flags.js`에서 로컬 스토리지 `featureFlags`를 읽어 런타임 토글
- 예: `{ searchEnhance: true, domBatchRaf: true }`

체크리스트
- CLAUDE.md, docs/ 업데이트
- 메시지/상수/타입 반영 여부 확인
- 지원 불가 URL에서 조용한 처리 유지

