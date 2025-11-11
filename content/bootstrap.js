/**
 * Content Script Bootstrap (foldered)
 * - 전역 네임스페이스(WPT) 및 공용 상수 정의
 * - 이후 로직 스크립트(content.js 등)가 의존
 */
(function bootstrap() {
  try {
    window.WPT = window.WPT || {};
    const WPT = window.WPT;

    if (!WPT.Constants) {
      WPT.Constants = {
        PORT_NAMES: { PANEL: 'panel' },
        PORT_MESSAGES: { PROGRESS: 'progress', CANCEL_TRANSLATION: 'CANCEL_TRANSLATION' },
        ACTIONS: {
          PING: 'PING',
          TRANSLATE_FULL_PAGE: 'translateFullPage',
          RESTORE_ORIGINAL: 'restoreOriginal',
          GET_TRANSLATION_STATE: 'getTranslationState',
          GET_TRANSLATED_TITLE: 'getTranslatedTitle',
          GET_CACHE_STATUS: 'getCacheStatus',
          CLEAR_CACHE_FOR_DOMAIN: 'clearCacheForDomain'
        }
      };
    }
  } catch (_) {
    // 부트스트랩 실패는 런타임에서 content.js가 자체 보호로 동작
  }
})();

