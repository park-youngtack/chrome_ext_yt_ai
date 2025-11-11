/**
 * 기능 플래그 헬퍼
 * - chrome.storage.local.featureFlags 에서 런타임 토글
 */

const DEFAULT_FLAGS = {
  // 예시: 검색 강화, DOM raf 플러시 토글 등
  searchEnhance: false,
  domBatchRaf: true
};

let cached = null;

export async function loadFlags() {
  try {
    const { featureFlags } = await chrome.storage.local.get(['featureFlags']);
    cached = { ...DEFAULT_FLAGS, ...(featureFlags || {}) };
  } catch (_) {
    cached = { ...DEFAULT_FLAGS };
  }
  return cached;
}

export function getFlag(name) {
  if (!cached) return DEFAULT_FLAGS[name];
  return cached[name];
}

export function isEnabled(name) {
  return !!getFlag(name);
}

