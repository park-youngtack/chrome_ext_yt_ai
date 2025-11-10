# 아키텍처 및 명세 (ARCHITECTURE)

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

### 배치 처리
- 배치 크기/동시성 설정 가능 (기본: 50개, 동시 3개)
- 429 에러 시 동시성 자동 하향 (옵션)

### DOM 업데이트
- `requestAnimationFrame` 일괄 처리로 리플로우/리페인트 최소화

### 패널 성능
- 패널 1클릭 오픈 (`openPanelOnActionClick: true`)
- 메모리 효율적 렌더링 (가상 스크롤)

### 캐시 성능
- 정규화된 텍스트 기반 해시로 중복 캐시 방지
- WeakMap 사용으로 자동 메모리 관리

## 데이터 흐름

### 번역 요청
```
Sidepanel → Content Script
{
  action: "translatePage",
  texts: [],
  translateMode: "cache" | "nocache",
  model: "...",
  batchSize: 50,
  concurrency: 3
}
```

### 진행 상태 응답
```
Content Script → Sidepanel (Port로 실시간)
{
  type: "progress",
  data: {
    state: "translating" | "completed",
    totalTexts: 100,
    translatedCount: 50,
    cachedCount: 25,
    batchCount: 2,
    batchesDone: 1,
    activeMs: 15000
  }
}
```

## 파일별 책임

| 파일 | 책임 | 상세 |
|------|------|------|
| `background.js` | Content Script 관리 | 자동/수동 주입, 오류 처리 |
| `content.js` | 번역 실행 | 캐시, 배치, API 호출 |
| `sidepanel.html` | UI 마크업 | 4개 탭 레이아웃 |
| `sidepanel.js` | UI 로직 | 상태 관리, 기능 조율 |
| `logger.js` | 로깅 | 공용 로거 (민감정보 마스킹) |
| `meta.js` | 메타정보 | 최종 수정일, 푸터 텍스트 |

## 통신 메커니즘

### Port 통신 (실시간)
- **목적**: Content Script의 번역 진행 상태 실시간 전송
- **방향**: Content Script → Sidepanel (단방향)
- **주기**: 1초마다 (설정 가능)
- **수명**: 번역 진행 중만 유지

### Message 통신 (요청-응답)
- **목적**: 특정 작업 수행 (권한 확인, 상태 조회 등)
- **방향**: 양방향
- **타입**: One-time 메시지

## 상태 관리

### Sidepanel 상태
```javascript
let translationState = {
  state: 'inactive' | 'translating' | 'completed' | 'restored',
  totalTexts: 0,
  translatedCount: 0,
  cachedCount: 0,
  batchCount: 0,
  batchesDone: 0,
  batches: [],
  activeMs: 0
};

const translationStateByTab = new Map(); // 탭별 독립 저장
```

### Content Script 상태
- 현재 페이지의 번역 상태 유지
- Port를 통해 실시간 업데이트 전송

## 에러 처리 전략

### 네트워크 에러
- 자동 재시도 (최대 3회, 지수 백오프)
- 최종 실패 시 사용자 안내

### API 에러
- **401**: API Key 무효 → "키 확인" 메시지
- **402**: 크레딧 부족 → "충전 필요" 메시지
- **429**: Rate limit → 동시성 자동 하향

### 권한 에러
- 지원되지 않는 URL → "번역 불가" UI
- file:// 권한 없음 → "권한 허용" 유도

## 보안 고려사항

### API Key 관리
- Chrome Storage (encrypted)로 저장
- 로그에는 앞 8자만 표시
- 네트워크 전송 시 HTTPS 강제

### 캐시 민감도
- 텍스트는 정규화 후 해시 저장 (원본 보관 X)
- IndexedDB는 로컬 저장 (클라우드 X)

### 권한 처리
- 사용자 액션 시에만 권한 체크
- 불필요한 권한 요청 제거
