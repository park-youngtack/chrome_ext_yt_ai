/**
 * Side Panel 히스토리 관리
 *
 * 역할:
 * - 히스토리 CRUD 작업
 * - 번역 완료 시 자동 저장
 * - URL별 중복 제거
 * - 히스토리 탭 UI 관리
 */

import { logInfo, logWarn, logError, logDebug } from '../logger.js';
import {
  currentTabId,
  lastHistoryCompletionMeta,
  lastTranslateMode,
  translateModeByTab,
  setLastHistoryCompletionMeta,
  setLastTranslateMode
} from './state.js';
import { showToast, switchTab } from './ui-utils.js';

// ===== 상수 =====
const HISTORY_STORAGE_KEY = 'translationHistory';
const HISTORY_MAX_ITEMS = 100;

// ===== 히스토리 중복 제거 =====

/**
 * 최신순으로 정렬된 히스토리 목록에서 URL 기준 중복을 제거한다.
 * @param {Array<object>} entries - 정렬된 히스토리 배열
 * @returns {Array<object>} URL별로 마지막 번역만 남긴 배열
 */
export function deduplicateHistoryByUrl(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  const seen = new Set();
  const uniqueEntries = [];

  for (const entry of entries) {
    if (!entry || typeof entry.url !== 'string') {
      uniqueEntries.push(entry);
      continue;
    }

    // 동일 URL은 가장 최근 항목만 유지하기 위해 최초 발견된 항목만 추가한다.
    if (seen.has(entry.url)) {
      continue;
    }

    seen.add(entry.url);
    uniqueEntries.push(entry);
  }

  return uniqueEntries;
}

// ===== 히스토리 탭 관리 =====

/**
 * 히스토리 탭 초기화
 * 버튼 이벤트를 연결하고 최초 렌더링을 수행한다.
 */
export async function initHistoryTab() {
  const clearBtn = document.getElementById('historyClearBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      await clearHistory();
    });
  }

  const emptyActionBtn = document.getElementById('historyEmptyAction');
  if (emptyActionBtn) {
    emptyActionBtn.addEventListener('click', () => {
      switchTab('translate');
    });
  }

  await renderHistoryList();
}

/**
 * 히스토리 항목 목록을 렌더링한다.
 * @param {Array<object>} prefetchedEntries - 이미 조회된 히스토리 배열 (선택 사항)
 */
export async function renderHistoryList(prefetchedEntries) {
  try {
    const listEl = document.getElementById('historyList');
    const emptyEl = document.getElementById('historyEmpty');
    const clearBtn = document.getElementById('historyClearBtn');

    if (!listEl || !emptyEl || !clearBtn) {
      return;
    }

    const entries = Array.isArray(prefetchedEntries) ? prefetchedEntries : await loadHistoryEntries();

    listEl.innerHTML = '';

    if (!entries || entries.length === 0) {
      emptyEl.style.display = 'flex';
      clearBtn.disabled = true;
      return;
    }

    emptyEl.style.display = 'none';
    clearBtn.disabled = false;

    const fragment = document.createDocumentFragment();
    entries.forEach((entry) => {
      fragment.appendChild(createHistoryItemElement(entry));
    });

    listEl.appendChild(fragment);
  } catch (error) {
    logError('sidepanel', 'HISTORY_RENDER_ERROR', '히스토리 목록 렌더링 실패', {}, error);
  }
}

/**
 * 히스토리 데이터를 storage에서 불러온다.
 * @returns {Promise<Array<object>>} 최신순으로 정렬된 히스토리 배열
 */
export async function loadHistoryEntries() {
  try {
    const result = await chrome.storage.local.get([HISTORY_STORAGE_KEY]);
    const history = Array.isArray(result[HISTORY_STORAGE_KEY]) ? result[HISTORY_STORAGE_KEY] : [];
    const sorted = history
      .map((item) => ({ ...item }))
      .sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));

    const uniqueEntries = deduplicateHistoryByUrl(sorted);

    if (uniqueEntries.length !== sorted.length) {
      await chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: uniqueEntries });
    }

    return uniqueEntries;
  } catch (error) {
    logError('sidepanel', 'HISTORY_LOAD_ERROR', '히스토리 불러오기 실패', {}, error);
    return [];
  }
}

/**
 * 히스토리 항목 DOM 요소를 생성한다.
 * @param {object} entry - 히스토리 데이터
 * @returns {HTMLDivElement} 렌더링된 항목 요소
 */
function createHistoryItemElement(entry) {
  const item = document.createElement('div');
  item.className = 'history-item';
  item.dataset.id = entry.id;
  item.setAttribute('role', 'button');
  item.tabIndex = 0;

  const body = document.createElement('div');
  body.className = 'history-item-body';

  const translatedTitle = (entry.translatedTitle || '').trim();
  const originalTitle = (entry.originalTitle || '').trim();
  const previewText = (entry.previewText || '').trim();

  const title = document.createElement('div');
  title.className = 'history-item-title';
  title.textContent = translatedTitle || originalTitle || entry.url;
  if ((translatedTitle || originalTitle)) {
    title.setAttribute('title', translatedTitle || originalTitle);
  }
  body.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.className = 'history-item-subtitle';
  if (previewText) {
    subtitle.textContent = previewText;
    if (originalTitle && originalTitle !== translatedTitle) {
      subtitle.setAttribute('title', `원본 제목: ${originalTitle}`);
    }
  } else if (originalTitle && originalTitle !== translatedTitle) {
    subtitle.textContent = `원본: ${originalTitle}`;
  } else {
    subtitle.textContent = originalTitle || '원본 제목 없음';
  }
  body.appendChild(subtitle);

  const meta = document.createElement('div');
  meta.className = 'history-item-meta';

  const urlSpan = document.createElement('span');
  urlSpan.textContent = entry.url;
  meta.appendChild(urlSpan);

  const timeSpan = document.createElement('span');
  timeSpan.textContent = formatHistoryTime(entry.completedAt);
  meta.appendChild(timeSpan);

  const modeSpan = document.createElement('span');
  modeSpan.textContent = formatHistoryMode(entry.mode);
  meta.appendChild(modeSpan);

  body.appendChild(meta);
  item.appendChild(body);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'history-item-delete';
  deleteBtn.type = 'button';
  deleteBtn.setAttribute('aria-label', '히스토리 항목 삭제');
  deleteBtn.textContent = '✕';
  deleteBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    deleteHistoryEntry(entry.id);
  });
  item.appendChild(deleteBtn);

  item.addEventListener('click', () => {
    handleHistoryItemOpen(entry);
  });

  item.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleHistoryItemOpen(entry);
    }
  });

  return item;
}

/**
 * 히스토리 항목 저장 헬퍼
 * @param {object} entry - 저장할 히스토리 데이터
 */
export async function saveHistoryEntry(entry) {
  try {
    const result = await chrome.storage.local.get([HISTORY_STORAGE_KEY]);
    const history = Array.isArray(result[HISTORY_STORAGE_KEY]) ? result[HISTORY_STORAGE_KEY] : [];

    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `history-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const normalized = {
      id,
      url: entry.url,
      originalTitle: entry.originalTitle,
      translatedTitle: entry.translatedTitle,
      previewText: entry.previewText || '',
      completedAt: entry.completedAt,
      mode: entry.mode
    };

    const withoutSameUrl = history.filter((item) => item && item.url !== normalized.url);
    const candidateList = [normalized, ...withoutSameUrl];
    const next = deduplicateHistoryByUrl(candidateList).slice(0, HISTORY_MAX_ITEMS);
    await chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: next });

    logInfo('sidepanel', 'HISTORY_SAVED', '번역 히스토리 저장', {
      url: normalized.url,
      mode: normalized.mode
    });

    if (isHistoryTabActive()) {
      await renderHistoryList(next);
    }
  } catch (error) {
    logError('sidepanel', 'HISTORY_SAVE_ERROR', '히스토리 저장 실패', { url: entry.url }, error);
  }
}

/**
 * 단일 히스토리 항목을 삭제한다.
 * @param {string} entryId - 삭제할 항목 ID
 */
async function deleteHistoryEntry(entryId) {
  try {
    const entries = await loadHistoryEntries();
    const filtered = entries.filter((item) => item.id !== entryId);
    await chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: filtered });

    if (isHistoryTabActive()) {
      await renderHistoryList(filtered);
    }

    showToast('선택한 기록을 삭제했습니다.');
  } catch (error) {
    logError('sidepanel', 'HISTORY_DELETE_ERROR', '히스토리 항목 삭제 실패', { entryId }, error);
    showToast('히스토리 삭제 중 오류가 발생했습니다.', 'error');
  }
}

/**
 * 전체 히스토리를 초기화한다.
 */
async function clearHistory() {
  try {
    await chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: [] });
    await renderHistoryList([]);
    showToast('모든 번역 기록을 삭제했습니다.');
  } catch (error) {
    logError('sidepanel', 'HISTORY_CLEAR_ERROR', '히스토리 전체 삭제 실패', {}, error);
    showToast('히스토리를 초기화하는 중 문제가 발생했습니다.', 'error');
  }
}

/**
 * 히스토리 탭 활성 여부를 확인한다.
 * @returns {boolean} 히스토리 탭 활성 상태
 */
function isHistoryTabActive() {
  const historyTab = document.getElementById('historyTab');
  return historyTab ? historyTab.classList.contains('active') : false;
}

/**
 * 히스토리 항목을 클릭했을 때 페이지를 열고 번역을 재실행한다.
 * @param {object} entry - 실행할 히스토리 데이터
 */
export async function handleHistoryItemOpen(entry) {
  try {
    const { handleTabChange, handleTranslateAll } = await import('./translation.js');

    logInfo('sidepanel', 'HISTORY_OPEN', '히스토리 항목 실행', {
      url: entry.url,
      mode: entry.mode
    });

    // 항상 새 탭에서 열기
    const newTab = await chrome.tabs.create({ url: entry.url, active: true });
    // 이 부분에서 State를 직접 수정하는 대신 handleTabChange에서 관리하도록 변경 필요
    // 임시: global scope에서 처리 (sidepanel.js의 State.setCurrentTabId 호출)

    // 탭 로딩 대기 (URL이 제대로 설정될 때까지)
    try {
      await waitForTabLoad(newTab.id).catch(() => {
        // 로딩 상태를 감지하지 못해도 계속 진행
      });
    } catch (error) {
      logDebug('sidepanel', 'HISTORY_WAIT_TIMEOUT', '탭 로딩 타임아웃', {
        tabId: newTab.id,
        url: entry.url
      });
    }

    // 탭 변경 처리 (초기화 → 권한확인 → 상태조회 → UI업데이트)
    try {
      const latestTab = await chrome.tabs.get(newTab.id);
      if (latestTab) {
        // handleTabChange 호출하지만 현재 탭 업데이트는 sidepanel.js에서 처리
        await handleTabChange(latestTab);
      }
    } catch (error) {
      logDebug('sidepanel', 'HISTORY_GET_TAB_FAILED', '탭 정보 조회 실패', {
        tabId: newTab.id,
        reason: error?.message || '알 수 없음'
      });
    }

    setLastTranslateMode(entry.mode === 'fresh' ? 'fresh' : 'cache');
    // 탭별 모드도 설정 (완료 후 히스토리 저장 시 올바른 모드 사용)
    translateModeByTab.set(newTab.id, lastTranslateMode);

    // 번역 탭으로 자동 전환
    await switchTab('translate');

    await handleTranslateAll(entry.mode !== 'fresh');
  } catch (error) {
    logError('sidepanel', 'HISTORY_OPEN_ERROR', '히스토리 항목 실행 실패', { url: entry.url }, error);
    showToast('히스토리 항목을 여는 중 문제가 발생했습니다.', 'error');
  }
}

/**
 * 탭 로딩 완료를 대기하는 헬퍼
 * @param {number} tabId - 대상 탭 ID
 * @param {number} timeoutMs - 최대 대기 시간 (기본 20000ms)
 * @returns {Promise<void>} 로딩 완료 시 resolve
 */
function waitForTabLoad(tabId, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timeoutId = setTimeout(() => {
      if (!finished) {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error('TAB_LOAD_TIMEOUT'));
      }
    }, timeoutMs);

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        finished = true;
        clearTimeout(timeoutId);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

/**
 * 완료 시각을 사용자 친화적인 문자열로 변환한다.
 * @param {string} isoString - ISO 포맷 문자열
 * @returns {string} 포맷된 시각 텍스트
 */
function formatHistoryTime(isoString) {
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return '시간 정보 없음';
    }
    return new Intl.DateTimeFormat('ko-KR', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  } catch (error) {
    return '시간 정보 없음';
  }
}

/**
 * 모드 값을 사용자에게 친숙한 표현으로 변환한다.
 * @param {string} mode - 'cache' 또는 'fresh'
 * @returns {string} 한글 라벨
 */
function formatHistoryMode(mode) {
  if (mode === 'fresh') {
    return '새로 번역';
  }
  return '빠른 모드';
}

/**
 * 번역 완료 이벤트를 히스토리에 반영한다.
 * @param {number} tabId - 번역이 완료된 탭 ID
 * @param {object} data - content script 진행 데이터
 */
export async function handleTranslationCompletedForHistory(tabId, data) {
  try {
    const signature = `${tabId}-${data.totalTexts}-${data.translatedCount}-${data.activeMs}`;
    const now = Date.now();

    if (lastHistoryCompletionMeta.signature === signature && now - lastHistoryCompletionMeta.ts < 2000) {
      return;
    }

    setLastHistoryCompletionMeta({ signature, ts: now });

    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.url) {
      return;
    }

    const progressOriginal = typeof data.originalTitle === 'string' ? data.originalTitle.trim() : '';
    const progressTranslated = typeof data.translatedTitle === 'string' ? data.translatedTitle.trim() : '';
    const progressPreview = typeof data.previewText === 'string' ? data.previewText.trim() : '';

    const fallbackTitle = tab.title || '제목 없음';
    const originalTitle = progressOriginal || fallbackTitle || '제목 없음';
    let translatedTitle = progressTranslated;

    if (!translatedTitle) {
      try {
        const response = await chrome.tabs.sendMessage(tabId, { action: 'getTranslatedTitle' });
        if (response && typeof response.title === 'string' && response.title.trim().length > 0) {
          translatedTitle = response.title.trim();
        }
      } catch (error) {
        logDebug('sidepanel', 'HISTORY_TITLE_FALLBACK', '번역 제목 요청 실패, 진행 데이터 사용', {
          tabId,
          reason: error?.message || '알 수 없음'
        });
      }
    }

    if (!translatedTitle) {
      translatedTitle = fallbackTitle || originalTitle;
    }

    const previewText = progressPreview ? progressPreview.slice(0, 120) : '';
    const mode = translateModeByTab.get(tabId) || lastTranslateMode;

    await saveHistoryEntry({
      url: tab.url,
      originalTitle,
      translatedTitle,
      previewText,
      completedAt: new Date().toISOString(),
      mode
    });

    translateModeByTab.delete(tabId);
  } catch (error) {
    logError('sidepanel', 'HISTORY_CAPTURE_ERROR', '번역 완료 히스토리 기록 실패', { tabId }, error);
  }
}
