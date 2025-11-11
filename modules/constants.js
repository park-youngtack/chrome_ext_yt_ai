/**
 * 공용 상수 모듈
 * - 메시지 액션/포트 명/스토리지 키 등 문자열 상수를 중앙화
 */

export const PORT_NAMES = {
  PANEL: 'panel'
};

export const ACTIONS = {
  PING: 'PING',
  TRANSLATE_FULL_PAGE: 'translateFullPage',
  RESTORE_ORIGINAL: 'restoreOriginal',
  GET_TRANSLATION_STATE: 'getTranslationState',
  GET_TRANSLATED_TITLE: 'getTranslatedTitle',
  GET_CACHE_STATUS: 'getCacheStatus',
  CLEAR_CACHE_FOR_DOMAIN: 'clearCacheForDomain'
};

export const PORT_MESSAGES = {
  PROGRESS: 'progress',
  CANCEL_TRANSLATION: 'CANCEL_TRANSLATION'
};

export const STORAGE_KEYS = {
  DEBUG_LOG: 'debugLog',
  CACHE_TTL: 'cacheTTL',
  FEATURE_FLAGS: 'featureFlags'
};

