/**
 * Content Script Bootstrap
 * - 전역 네임스페이스(WPT) 및 공용 상수 정의
 * - content.js 등 후속 스크립트들이 의존
 */

(function bootstrap() {
  try {
    window.WPT = window.WPT || {};
    const WPT = window.WPT;

    // 공용 상수 (content 환경용)
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
    // 네임스페이스 초기화 실패는 무시
  }
})();

