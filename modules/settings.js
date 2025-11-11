/**
 * Side Panel 설정 관리
 *
 * 역할:
 * - API Key 관리
 * - 설정 로드/저장
 * - 유효성 검사
 * - 캐시 상태 조회
 */

import { logInfo, logError, logDebug, logWarn } from '../logger.js';
import {
  currentTabId,
  originalSettings,
  settingsChanged,
  setSettingsChanged,
  setOriginalSettings
} from './state.js';
import { showToast, ensurePageContentScript, handleCopyLogs } from './ui-utils.js';

// ===== 상수 =====
const DEFAULT_MODEL = 'openai/gpt-4o-mini';
const DEFAULT_CACHE_TTL_MINUTES = 43200; // 기본 30일
const CACHE_TTL_MIN_MINUTES = 5;
const CACHE_TTL_MAX_MINUTES = 525600; // 365일

// ===== API Key UI 관리 =====

/**
 * API Key UI 업데이트
 * API Key 유무에 따라 번역 섹션 또는 안내 메시지 표시
 */
export async function updateApiKeyUI() {
  try {
    const result = await chrome.storage.local.get(['apiKey']);
    const hasApiKey = result.apiKey && result.apiKey.trim().length > 0;

    const noApiKeyMessage = document.getElementById('noApiKeyMessage');
    const translateSection = document.getElementById('translateSection');

    if (hasApiKey) {
      // API key가 있으면 번역 섹션 표시
      if (noApiKeyMessage) noApiKeyMessage.style.display = 'none';
      if (translateSection) translateSection.style.display = 'block';
    } else {
      // API key가 없으면 안내 메시지 표시
      if (noApiKeyMessage) noApiKeyMessage.style.display = 'block';
      if (translateSection) translateSection.style.display = 'none';
    }
  } catch (error) {
    logError('sidepanel', 'API_KEY_CHECK_ERROR', 'API Key 확인 실패', {}, error);
  }
}

// ===== 설정 관리 =====

/**
 * 설정 탭 초기화
 * 입력 필드 변경 감지 및 버튼 이벤트 등록
 */
export function initSettingsTab() {
  // 입력 필드 변경 감지 (select 포함)
  const inputs = document.querySelectorAll('#settingsTab input, #settingsTab select');
  inputs.forEach(input => {
    input.addEventListener('input', () => {
      setSettingsChanged(true);
      showSaveBar();
    });

    input.addEventListener('change', () => {
      setSettingsChanged(true);
      showSaveBar();
    });
  });

  // 저장 버튼
  document.getElementById('saveBtn')?.addEventListener('click', handleSaveSettings);

  // 취소 버튼
  document.getElementById('cancelBtn')?.addEventListener('click', () => {
    loadSettings(); // 원래 설정 복원
    hideSaveBar();
  });

  // 로그 복사 버튼
  document.getElementById('copyAllLogsBtn')?.addEventListener('click', () => {
    handleCopyLogs('all');
  });
  document.getElementById('copyErrorLogsBtn')?.addEventListener('click', () => {
    handleCopyLogs('errors');
  });
}

/**
 * 설정 로드
 * storage에서 설정을 로드하여 폼에 적용
 */
export async function loadSettings() {
  try {
    const result = await chrome.storage.local.get([
      'apiKey',
      'model',
      'batchSize',
      'concurrency',
      'autoTranslate',
      'debugLog'
    ]);

    // 원본 설정 저장
    setOriginalSettings({ ...result });

    // API 설정
    document.getElementById('apiKey').value = result.apiKey || '';
    document.getElementById('model').value = result.model || '';

    // 번역 설정
    document.getElementById('batchSize').value = result.batchSize || 50;
    document.getElementById('concurrency').value = result.concurrency || 3;
    document.getElementById('autoTranslate').checked = result.autoTranslate !== undefined ? result.autoTranslate : true;

    // 디버그 설정
    document.getElementById('debugLog').checked = result.debugLog || false;

    // 변경 플래그 초기화
    setSettingsChanged(false);
    hideSaveBar();
  } catch (error) {
    logError('sidepanel', 'SETTINGS_LOAD_ERROR', '설정 로드 실패', {}, error);
  }
}

/**
 * 설정 저장 핸들러
 * 유효성 검사 후 storage에 저장
 */
export async function handleSaveSettings() {
  const apiKey = document.getElementById('apiKey').value.trim();
  const modelInput = document.getElementById('model').value.trim();
  const batchSize = parseInt(document.getElementById('batchSize').value) || 50;
  const concurrency = parseInt(document.getElementById('concurrency').value) || 3;
  const autoTranslate = document.getElementById('autoTranslate').checked;
  const debugLog = document.getElementById('debugLog').checked;

  const model = modelInput || DEFAULT_MODEL;

  // 유효성 검사
  if (!apiKey) {
    showToast('API Key를 입력해주세요.', 'error');
    return;
  }

  if (batchSize < 10 || batchSize > 100) {
    showToast('배치 크기는 10~100 사이여야 합니다.', 'error');
    return;
  }

  if (concurrency < 1 || concurrency > 10) {
    showToast('동시 처리 개수는 1~10 사이여야 합니다.', 'error');
    return;
  }

  try {
    await chrome.storage.local.set({
      apiKey,
      model,
      batchSize,
      concurrency,
      autoTranslate,
      debugLog
    });

    logInfo('sidepanel', 'SETTINGS_SAVED', '설정 저장 완료', {
      model,
      batchSize,
      concurrency,
      autoTranslate,
      debugLog
    });

    // 원본 설정 업데이트
    setOriginalSettings({
      apiKey,
      model,
      batchSize,
      concurrency,
      autoTranslate,
      debugLog
    });

    setSettingsChanged(false);
    hideSaveBar();
    showToast('설정이 저장되었습니다!');

    // API key UI 업데이트 (번역 탭에서 버튼 표시/숨김)
    await updateApiKeyUI();
  } catch (error) {
    logError('sidepanel', 'SETTINGS_SAVE_ERROR', '설정 저장 실패', {}, error);
    showToast('저장 중 오류가 발생했습니다: ' + error.message, 'error');
  }
}

/**
 * 저장 바 표시 (설정 변경 시)
 */
function showSaveBar() {
  const saveBar = document.getElementById('saveBar');
  if (saveBar) {
    saveBar.classList.add('active');
  }
}

/**
 * 저장 바 숨김
 */
function hideSaveBar() {
  const saveBar = document.getElementById('saveBar');
  if (saveBar) {
    saveBar.classList.remove('active');
  }
}

// ===== 캐시 관리 =====

/**
 * 현재 페이지(도메인)의 IndexedDB 캐시 상태 조회
 * @returns {Promise<{count: number, size: number}>} 캐시 항목 수와 총 용량(바이트)
 */
export async function getPageCacheStatus() {
  try {
    return new Promise((resolve, reject) => {
      if (!currentTabId) {
        logDebug('sidepanel', 'PAGE_CACHE_NO_TAB', 'CurrentTabId가 없음, 캐시 조회 스킵');
        resolve({ count: 0, size: 0 });
        return;
      }

      chrome.tabs.sendMessage(
        currentTabId,
        { action: 'getCacheStatus' },
        (response) => {
          if (chrome.runtime.lastError) {
            logDebug('sidepanel', 'PAGE_CACHE_SEND_MSG_ERROR', 'Content script와 통신 실패', {
              error: chrome.runtime.lastError.message
            });
            resolve({ count: 0, size: 0 });
            return;
          }

          if (response && response.success) {
            logDebug('sidepanel', 'PAGE_CACHE_STATUS_SUCCESS', '캐시 상태 조회 성공', {
              count: response.count,
              size: formatBytes(response.size)
            });
            resolve({ count: response.count, size: response.size });
          } else {
            const errorMsg = response?.error || '알 수 없는 오류';
            logDebug('sidepanel', 'PAGE_CACHE_STATUS_ERROR', '캐시 조회 실패', {
              error: errorMsg
            });
            resolve({ count: 0, size: 0 });
          }
        }
      );
    });
  } catch (error) {
    logError('sidepanel', 'PAGE_CACHE_STATUS_ERROR', '캐시 조회 실패', {}, error);
    return { count: 0, size: 0 };
  }
}

/**
 * 바이트를 읽기 쉬운 형식으로 변환
 * @param {number} bytes - 바이트 수
 * @returns {string} 포맷된 용량 텍스트
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * 현재 페이지의 캐시 상태 UI 업데이트
 */
export async function updatePageCacheStatus() {
  try {
    const cacheManagementEl = document.getElementById('cacheManagement');
    const { permissionGranted } = await import('./state.js');

    // 현재 탭이 지원되는 URL인 경우에만 캐시 UI 표시
    if (permissionGranted) {
      // Content script가 준비되어 있는지 확인 (필요시 주입)
      try {
        await ensurePageContentScript(currentTabId);
      } catch (error) {
        logDebug('sidepanel', 'ENSURE_CONTENT_SCRIPT_FAILED', 'Content script 준비 실패', {
          error: error.message
        });
      }

      const { count, size } = await getPageCacheStatus();

      const itemCountEl = document.getElementById('pageItemCount');
      const sizeDisplayEl = document.getElementById('pageSizeDisplay');

      if (itemCountEl) {
        itemCountEl.textContent = count.toLocaleString();
      }

      if (sizeDisplayEl) {
        sizeDisplayEl.textContent = formatBytes(size);
      }

      // 캐시 UI 표시
      if (cacheManagementEl) {
        cacheManagementEl.style.display = 'block';
      }

      logDebug('sidepanel', 'PAGE_CACHE_STATUS_UPDATED', '캐시 상태 업데이트', {
        count,
        size: formatBytes(size)
      });
    } else {
      // 지원되지 않는 URL이면 캐시 UI 숨김
      if (cacheManagementEl) {
        cacheManagementEl.style.display = 'none';
      }
      logDebug('sidepanel', 'PAGE_CACHE_HIDDEN', '캐시 UI 숨김');
    }
  } catch (error) {
    logError('sidepanel', 'PAGE_CACHE_STATUS_UPDATE_ERROR', '캐시 상태 업데이트 실패', {}, error);
  }
}

/**
 * 현재 페이지의 캐시 비우기 핸들러
 */
export async function handleClearPageCache() {
  try {
    if (!currentTabId) {
      logWarn('sidepanel', 'PAGE_CACHE_CLEAR_NO_TAB', 'CurrentTabId가 없음');
      showToast('현재 탭을 확인할 수 없습니다.', 'error');
      return;
    }

    logInfo('sidepanel', 'PAGE_CACHE_CLEAR_START', '캐시 삭제 시작');

    // Content script가 준비되어 있는지 확인 (필요시 주입)
    try {
      await ensurePageContentScript(currentTabId);
    } catch (error) {
      logDebug('sidepanel', 'ENSURE_CONTENT_SCRIPT_FAILED', 'Content script 준비 실패', {
        error: error.message
      });
      showToast('캐시 삭제 준비 중 오류가 발생했습니다.', 'error');
      return;
    }

    chrome.tabs.sendMessage(
      currentTabId,
      { action: 'clearCacheForDomain' },
      (response) => {
        if (chrome.runtime.lastError) {
          logWarn('sidepanel', 'PAGE_CACHE_CLEAR_MSG_ERROR', 'Content script와 통신 실패', {
            error: chrome.runtime.lastError.message
          });
          showToast('캐시 삭제 중 오류가 발생했습니다.', 'error');
          return;
        }

        if (response && response.success) {
          showToast('이 페이지의 캐시가 삭제되었습니다.');
          logInfo('sidepanel', 'PAGE_CACHE_CLEARED', '캐시 삭제 완료');

          // 캐시 삭제 후 UI 업데이트
          updatePageCacheStatus();
        } else {
          const errorMsg = response?.error || '알 수 없는 오류';
          logWarn('sidepanel', 'PAGE_CACHE_CLEAR_FAILED', '캐시 삭제 실패', {
            error: errorMsg
          });
          showToast('캐시 삭제 중 오류가 발생했습니다: ' + errorMsg, 'error');
        }
      }
    );
  } catch (error) {
    logError('sidepanel', 'PAGE_CACHE_CLEAR_ERROR', '캐시 삭제 실패', {}, error);
    showToast('캐시 삭제 중 오류가 발생했습니다: ' + error.message, 'error');
  }
}
