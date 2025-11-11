# 메시징 스펙

포트 메시지(실시간)
- name: `panel`
- type: `progress`
- payload: `{ state, totalTexts, translatedCount, cachedCount, batchCount, batchesDone, batches, activeMs, originalTitle, translatedTitle, previewText }`

요청/응답 메시지(액션)
- `PING` → `{ ok: true }`
- `translateFullPage` → `{ success: true }`
- `restoreOriginal` → `{ success: true }`
- `getTranslationState` → `{ state: ProgressStatus }`
- `getTranslatedTitle` → `{ title: string }`
- `getCacheStatus` → `{ success, count, size }`
- `clearCacheForDomain` → `{ success }`

취소 통지(포트)
- `{ type: 'CANCEL_TRANSLATION', reason }`

가이드라인
- 액션/타입은 상수로 관리 (`modules/constants.js`)
- 응답은 항상 `{ success?: boolean, ... }` 형태로 일관 유지
- 민감 데이터(API Key)는 로깅 시 마스킹

