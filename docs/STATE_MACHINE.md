# 상태 머신

TranslationState
- state: `inactive | translating | completed | restored | error | cancelled`
- totalTexts, translatedCount, cachedCount
- batchCount, batchesDone, batches
- activeMs, originalTitle, translatedTitle, previewText

전이 규칙
- idle → translate 클릭 → translating
- translating → 완료 → completed
- translating → 사용자 취소 → cancelled
- any → 원본 보기 → restored
- error 발생 → error

탭 전환 정책
- translating/completed만 복구, 그 외는 기본 상태로 렌더
- 활성 탭만 UI 반영, 비활성 탭 업데이트는 Map에만 저장

