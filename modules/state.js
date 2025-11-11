/**
 * Side Panel 전역 상태 관리
 *
 * 역할:
 * - 현재 탭 정보 (currentTabId)
 * - 탭별 Port 맵 (portsByTab)
 * - 권한 상태 (permissionGranted)
 * - 번역 진행 상태 (translationState)
 * - 탭별 독립 상태 추적 (translationStateByTab, translateModeByTab)
 * - 설정 변경 추적 (settingsChanged, originalSettings)
 */

// ===== 전역 상태 변수 =====

/**
 * 현재 활성 탭 ID
 * @type {number | null}
 */
export let currentTabId = null;

/**
 * Content Script와의 통신 Port
 * @type {chrome.runtime.Port | null}
 */
// 탭별 Port 맵: Map<tabId, chrome.runtime.Port>
export const portsByTab = new Map();

/**
 * 현재 탭의 권한 상태 (http/https/file:// 지원)
 * @type {boolean}
 */
export let permissionGranted = false;

/**
 * 설정 변경 여부 (저장 바 표시용)
 * @type {boolean}
 */
export let settingsChanged = false;

/**
 * 원본 설정 (취소 시 복원용)
 * @type {object}
 */
export let originalSettings = {};

/**
 * 마지막 번역 모드 ('cache' | 'full')
 * @type {string}
 */
export let lastTranslateMode = 'cache';

/**
 * 직전 히스토리 저장 메타 정보 (중복 저장 방지)
 * @type {object}
 */
export let lastHistoryCompletionMeta = { signature: null, ts: 0 };

/**
 * 탭별 마지막 번역 모드 추적
 * Map<tabId, mode>
 * @type {Map<number, string>}
 */
export const translateModeByTab = new Map();

/**
 * 탭별 번역 상태 추적
 * Map<tabId, translationState>
 * @type {Map<number, object>}
 */
export const translationStateByTab = new Map();

/**
 * 현재 탭의 번역 진행 상태
 * @type {object}
 */
export let translationState = {
  state: 'inactive',              // 번역 상태: 'inactive' | 'translating' | 'completed' | 'restored'
  totalTexts: 0,                  // 전체 텍스트 수
  translatedCount: 0,             // 번역 완료 수
  cachedCount: 0,                 // 캐시 사용 수
  batchCount: 0,                  // 전체 배치 수
  batchesDone: 0,                 // 완료 배치 수
  batches: [],                    // 배치 상세 정보
  activeMs: 0,                    // 경과 시간 (ms)
  originalTitle: '',              // 번역 전 제목
  translatedTitle: '',            // 번역 후 제목
  previewText: ''                 // 번역 프리뷰 텍스트
};

// ===== Setter 함수 =====

/**
 * 현재 탭 ID 설정
 * @param {number} tabId - 탭 ID
 */
export function setCurrentTabId(tabId) {
  currentTabId = tabId;
}

/**
 * Port 설정
 * @param {chrome.runtime.Port | null} newPort - Port 객체
 */
// Port 헬퍼
export function getPortForTab(tabId) {
  return portsByTab.get(tabId) || null;
}

export function setPortForTab(tabId, newPort) {
  if (typeof tabId !== 'number') return;
  if (newPort) {
    portsByTab.set(tabId, newPort);
  } else {
    portsByTab.delete(tabId);
  }
}

export function removePortForTab(tabId, { disconnect = true } = {}) {
  const p = portsByTab.get(tabId);
  if (p && disconnect) {
    try { p.disconnect(); } catch (e) { /* noop */ }
  }
  portsByTab.delete(tabId);
}

/**
 * 권한 상태 설정
 * @param {boolean} value - 권한 여부
 */
export function setPermissionGranted(value) {
  permissionGranted = value;
}

/**
 * 설정 변경 여부 설정
 * @param {boolean} value - 변경 여부
 */
export function setSettingsChanged(value) {
  settingsChanged = value;
}

/**
 * 원본 설정 저장
 * @param {object} settings - 설정 객체
 */
export function setOriginalSettings(settings) {
  originalSettings = settings;
}

/**
 * 마지막 번역 모드 설정
 * @param {string} mode - 'cache' | 'full'
 */
export function setLastTranslateMode(mode) {
  lastTranslateMode = mode;
}

/**
 * 히스토리 완료 메타 설정
 * @param {object} meta - { signature, ts }
 */
export function setLastHistoryCompletionMeta(meta) {
  lastHistoryCompletionMeta = meta;
}

/**
 * 번역 상태 전체 설정
 * @param {object} newState - 새로운 상태 객체
 */
export function setTranslationState(newState) {
  translationState = newState;
}

// ===== 상태 생성 함수 =====

/**
 * 기본 번역 상태 객체 생성
 * @returns {object} 기본 상태
 */
export function createDefaultTranslationState() {
  return {
    state: 'inactive',
    totalTexts: 0,
    translatedCount: 0,
    cachedCount: 0,
    batchCount: 0,
    batchesDone: 0,
    batches: [],
    activeMs: 0,
    originalTitle: '',
    translatedTitle: '',
    previewText: ''
  };
}
