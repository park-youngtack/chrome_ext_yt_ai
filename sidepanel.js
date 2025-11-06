/**
 * Side Panel Script - UI 및 상태 관리
 *
 * 주요 기능:
 * - 우측 세로 탭바 UI (번역|설정|닫기)
 * - 실시간 번역 진행 상태 표시
 * - 설정 관리 (API Key, 모델, 배치, 캐시)
 * - 권한 관리 (http/https/file:// 스킴별 처리)
 * - Port를 통한 content script와 양방향 통신
 *
 * 아키텍처:
 * - 탭 전환: 패널 내부에서 처리, 새 탭/창 열지 않음
 * - 딥링크: #translate, #settings 지원
 * - 세션 복원: 마지막 탭 상태 저장/복원
 * - 권한 체크: 번역 버튼 클릭 시 최종 검증
 *
 * 참고: ES6 모듈 사용 (logger.js, meta.js import)
 */

import { FOOTER_TEXT } from './meta.js';
import { log, logInfo, logWarn, logError, logDebug, getLogs } from './logger.js';

// ===== 설정 상수 =====
const DEFAULT_MODEL = 'openai/gpt-4o-mini';
const SESSION_KEY = 'lastActiveTab';
const HISTORY_STORAGE_KEY = 'translationHistory';
const HISTORY_MAX_ITEMS = 100;

// ===== 전역 상태 =====
let currentTabId = null;          // 현재 활성 탭 ID
let port = null;                  // content script와의 통신 port
let permissionGranted = false;    // 현재 탭의 권한 상태
let settingsChanged = false;      // 설정 변경 여부 (저장 바 표시용)
let originalSettings = {};        // 원본 설정 (취소 시 복원용)
let lastTranslateMode = 'cache';  // 마지막 번역 모드 기록
let lastHistoryCompletionMeta = { signature: null, ts: 0 }; // 직전 히스토리 저장 메타
const translateModeByTab = new Map(); // 탭별 마지막 번역 모드 추적

/**
 * 번역 진행 상태 (content script에서 port로 수신)
 */
let translationState = {
  state: 'inactive',       // 번역 상태
  totalTexts: 0,          // 전체 텍스트 수
  translatedCount: 0,     // 번역 완료 수
  cachedCount: 0,         // 캐시 사용 수
  batchCount: 0,          // 전체 배치 수
  batchesDone: 0,         // 완료 배치 수
  batches: [],            // 배치 상세 정보
  activeMs: 0,            // 경과 시간 (ms)
  originalTitle: '',      // 번역 전 제목
  translatedTitle: '',    // 번역 후 제목
  previewText: ''         // 번역 프리뷰 텍스트
};

// ===== 초기화 =====

/**
 * DOMContentLoaded 이벤트 핸들러
 * 패널 초기화 및 이벤트 리스너 등록
 */
document.addEventListener('DOMContentLoaded', async () => {
  // 푸터 텍스트 설정
  const footerEl = document.getElementById('footerText');
  if (footerEl) {
    footerEl.textContent = FOOTER_TEXT;
  }

  // 현재 탭 가져오기
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    currentTabId = tab.id;
    await checkPermissions(tab);
  }

  // 세션 복원 (마지막 탭)
  await restoreSession();

  // 딥링크 처리
  handleDeepLink();

  // 초기 API key UI 업데이트
  await updateApiKeyUI();

  // 탭바 이벤트 (세로 탭)
  initTabbar();

  // 번역 탭 버튼 이벤트
  document.getElementById('translateAllBtn')?.addEventListener('click', () => handleTranslateAll(true));
  document.getElementById('translateFreshBtn')?.addEventListener('click', () => handleTranslateAll(false));
  document.getElementById('restoreBtn')?.addEventListener('click', handleRestore);

  // 권한 요청 버튼
  const permBtn = document.getElementById('requestPermissionBtn');
  if (permBtn) {
    permBtn.addEventListener('click', handleRequestPermission);
  }

  // 설정 열기 버튼 (file:// 전용)
  const settingsBtn = document.getElementById('openSettingsBtn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      switchTab('settings');
    });
  }

  // 설정으로 이동 버튼 (API key 없을 때)
  const goToSettingsBtn = document.getElementById('goToSettingsBtn');
  if (goToSettingsBtn) {
    goToSettingsBtn.addEventListener('click', () => {
      switchTab('settings');
    });
  }

  // 히스토리 탭 초기화
  await initHistoryTab();

  // 설정 탭 이벤트
  initSettingsTab();

  // 탭 변경 감지
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      currentTabId = tab.id;
      await checkPermissions(tab);
    }
  });
});

// ===== 탭바 관리 =====

/**
 * 탭바 초기화
 * 버튼 클릭 이벤트 및 키보드 내비게이션 설정
 */
function initTabbar() {
  const tabButtons = document.querySelectorAll('.vertical-tabbar button[role="tab"]');

  tabButtons.forEach(btn => {
    // 클릭 이벤트
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      if (tabName) {
        switchTab(tabName);
      }
    });

    // 키보드 내비게이션
    btn.addEventListener('keydown', handleTabKeydown);
  });
}

/**
 * 키보드 내비게이션 핸들러
 * 화살표(←→↑↓), Enter, Space 지원
 * @param {KeyboardEvent} e - 키보드 이벤트
 */
function handleTabKeydown(e) {
  const tabButtons = Array.from(document.querySelectorAll('.vertical-tabbar button[role="tab"]'));
  const currentIndex = tabButtons.indexOf(e.target);

  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
    e.preventDefault();
    const nextIndex = (currentIndex + 1) % tabButtons.length;
    tabButtons[nextIndex].focus();
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
    e.preventDefault();
    const prevIndex = (currentIndex - 1 + tabButtons.length) % tabButtons.length;
    tabButtons[prevIndex].focus();
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    const tabName = e.target.dataset.tab;
    if (tabName) {
      switchTab(tabName);
    }
  }
}

/**
 * 탭 전환
 * 탭 버튼 상태 업데이트 및 컨텐츠 전환
 * @param {string} tabName - 'translate' | 'history' | 'settings'
 */
async function switchTab(tabName) {
  // 탭 버튼 상태 업데이트
  const tabButtons = document.querySelectorAll('.vertical-tabbar button[role="tab"]');
  tabButtons.forEach(btn => {
    if (btn.dataset.tab === tabName) {
      btn.setAttribute('aria-selected', 'true');
    } else {
      btn.setAttribute('aria-selected', 'false');
    }
  });

  // 탭 컨텐츠 전환
  const tabContents = document.querySelectorAll('.tab-content');
  tabContents.forEach(content => {
    if (content.id === `${tabName}Tab`) {
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });

  // 세션 저장 (마지막 탭 상태)
  await chrome.storage.session.set({ [SESSION_KEY]: tabName });

  // 번역 탭으로 전환 시 API key 확인
  if (tabName === 'translate') {
    await updateApiKeyUI();
  }

  // 설정 탭으로 전환 시 설정 로드
  if (tabName === 'settings') {
    await loadSettings();
  }

  // 히스토리 탭으로 전환 시 목록 새로고침
  if (tabName === 'history') {
    await renderHistoryList();
  }
}

/**
 * 세션 복원
 * 마지막 활성 탭 상태를 session storage에서 복원
 */
async function restoreSession() {
  try {
    const result = await chrome.storage.session.get(SESSION_KEY);
    const lastTab = result[SESSION_KEY];

    if (lastTab && (lastTab === 'translate' || lastTab === 'settings' || lastTab === 'history')) {
      switchTab(lastTab);
    }
  } catch (error) {
    console.error('Failed to restore session:', error);
  }
}

/**
 * 딥링크 처리
 * URL 해시를 읽어서 해당 탭으로 전환
 * 지원: #translate, #settings
 */
function handleDeepLink() {
  const hash = window.location.hash.slice(1); // # 제거
  if (hash === 'translate' || hash === 'settings' || hash === 'history') {
    switchTab(hash);
  }
}

// ===== API Key UI 관리 =====

/**
 * API Key UI 업데이트
 * API Key 유무에 따라 번역 섹션 또는 안내 메시지 표시
 */
async function updateApiKeyUI() {
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

// ===== 히스토리 관리 =====

/**
 * 히스토리 탭 초기화
 * 버튼 이벤트를 연결하고 최초 렌더링을 수행한다.
 */
async function initHistoryTab() {
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
async function renderHistoryList(prefetchedEntries) {
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
async function loadHistoryEntries() {
  try {
    const result = await chrome.storage.local.get([HISTORY_STORAGE_KEY]);
    const history = Array.isArray(result[HISTORY_STORAGE_KEY]) ? result[HISTORY_STORAGE_KEY] : [];
    return history
      .map((item) => ({ ...item }))
      .sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));
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
async function saveHistoryEntry(entry) {
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

    const next = [normalized, ...history].slice(0, HISTORY_MAX_ITEMS);
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
async function handleHistoryItemOpen(entry) {
  try {
    logInfo('sidepanel', 'HISTORY_OPEN', '히스토리 항목 실행', {
      url: entry.url,
      mode: entry.mode
    });

    let targetTabId = currentTabId;

    if (!targetTabId) {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab) {
        targetTabId = activeTab.id;
      }
    }

    let updatedTab;
    if (targetTabId) {
      updatedTab = await chrome.tabs.update(targetTabId, { url: entry.url, active: true });
    } else {
      updatedTab = await chrome.tabs.create({ url: entry.url, active: true });
      targetTabId = updatedTab.id;
    }

    currentTabId = updatedTab.id;
    await checkPermissions(updatedTab);

    try {
      const tabInfo = await chrome.tabs.get(updatedTab.id);
      if (!tabInfo || tabInfo.status !== 'complete') {
        await waitForTabLoad(updatedTab.id).catch(() => {
          // 로딩 상태를 감지하지 못하면 바로 진행 (일부 사이트는 status 이벤트가 제한됨)
        });
      }
    } catch (error) {
      logDebug('sidepanel', 'HISTORY_WAIT_FALLBACK', '탭 상태 확인 실패, 바로 번역 실행', {
        tabId: updatedTab.id,
        reason: error?.message || '알 수 없음'
      });
    }

    try {
      const latestTab = await chrome.tabs.get(updatedTab.id);
      await checkPermissions(latestTab);
    } catch (error) {
      logDebug('sidepanel', 'HISTORY_PERMISSION_REFRESH_FAIL', '탭 권한 재확인 실패', {
        tabId: updatedTab.id,
        reason: error?.message || '알 수 없음'
      });
    }

    lastTranslateMode = entry.mode === 'fresh' ? 'fresh' : 'cache';
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
async function handleTranslationCompletedForHistory(tabId, data) {
  try {
    const signature = `${tabId}-${data.totalTexts}-${data.translatedCount}-${data.activeMs}`;
    const now = Date.now();

    if (lastHistoryCompletionMeta.signature === signature && now - lastHistoryCompletionMeta.ts < 2000) {
      return;
    }

    lastHistoryCompletionMeta = { signature, ts: now };

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

// ===== 설정 관리 =====

/**
 * 설정 탭 초기화
 * 입력 필드 변경 감지 및 버튼 이벤트 등록
 */
function initSettingsTab() {
  // 입력 필드 변경 감지
  const inputs = document.querySelectorAll('#settingsTab input');
  inputs.forEach(input => {
    input.addEventListener('input', () => {
      settingsChanged = true;
      showSaveBar();
    });

    input.addEventListener('change', () => {
      settingsChanged = true;
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

  // 캐시 관리 버튼
  document.getElementById('clearAllCacheBtn')?.addEventListener('click', handleClearAllCache);

  // 로그 복사 버튼
  document.getElementById('copyLogsBtn')?.addEventListener('click', handleCopyLogs);
}

/**
 * 설정 로드
 * storage에서 설정을 로드하여 폼에 적용
 */
async function loadSettings() {
  try {
    const result = await chrome.storage.local.get([
      'apiKey',
      'model',
      'batchSize',
      'concurrency',
      'cacheTTL',
      'debugLog'
    ]);

    // 원본 설정 저장
    originalSettings = { ...result };

    // API 설정
    document.getElementById('apiKey').value = result.apiKey || '';
    document.getElementById('model').value = result.model || '';

    // 번역 설정
    document.getElementById('batchSize').value = result.batchSize || 50;
    document.getElementById('concurrency').value = result.concurrency || 3;

    // 캐시 설정 (항상 활성화)
    document.getElementById('cacheTTL').value = result.cacheTTL || 60;

    // 디버그 설정
    document.getElementById('debugLog').checked = result.debugLog || false;

    // 변경 플래그 초기화
    settingsChanged = false;
    hideSaveBar();
  } catch (error) {
    logError('sidepanel', 'SETTINGS_LOAD_ERROR', '설정 로드 실패', {}, error);
  }
}

/**
 * 설정 저장 핸들러
 * 유효성 검사 후 storage에 저장
 */
async function handleSaveSettings() {
  const apiKey = document.getElementById('apiKey').value.trim();
  const modelInput = document.getElementById('model').value.trim();
  const batchSize = parseInt(document.getElementById('batchSize').value) || 50;
  const concurrency = parseInt(document.getElementById('concurrency').value) || 3;
  const cacheTTL = parseInt(document.getElementById('cacheTTL').value) || 60;
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

  if (cacheTTL < 5 || cacheTTL > 1440) {
    showToast('캐시 만료 시간은 5~1440분 사이여야 합니다.', 'error');
    return;
  }

  try {
    await chrome.storage.local.set({
      apiKey,
      model,
      batchSize,
      concurrency,
      cacheTTL,
      debugLog
    });

    logInfo('sidepanel', 'SETTINGS_SAVED', '설정 저장 완료', {
      model,
      batchSize,
      concurrency,
      cacheTTL,
      debugLog
    });

    // 원본 설정 업데이트
    originalSettings = {
      apiKey,
      model,
      batchSize,
      concurrency,
      cacheTTL,
      debugLog
    };

    settingsChanged = false;
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

/**
 * 토스트 메시지 표시 (2초)
 * @param {string} message - 표시할 메시지
 * @param {string} type - 'success' | 'error'
 */
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = message;
  toast.className = 'toast show';

  if (type === 'error') {
    toast.classList.add('error');
  }

  setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
}

/**
 * 전역 캐시 비우기 핸들러
 */
async function handleClearAllCache() {
  if (!currentTabId) {
    showToast('활성 탭을 찾을 수 없습니다.', 'error');
    return;
  }

  try {
    await chrome.tabs.sendMessage(currentTabId, { action: 'clearAllCache' });
    showToast('모든 캐시가 삭제되었습니다.');
  } catch (error) {
    console.error('Failed to clear all cache:', error);
    showToast('캐시 삭제 중 오류가 발생했습니다.', 'error');
  }
}

// ===== 번역 기능 =====

/**
 * URL 지원 타입 확인
 * @param {string} url - 확인할 URL
 * @returns {'requestable' | 'file' | 'unsupported'}
 */
function getSupportType(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return 'requestable';
    }
    if (u.protocol === 'file:') {
      return 'file';
    }
    return 'unsupported';
  } catch (e) {
    return 'unsupported';
  }
}

/**
 * 권한 확인 (조용히 체크만, UI 자동 변경 안 함)
 * @param {object} tab - 탭 객체
 */
async function checkPermissions(tab) {
  if (!tab || !tab.url) {
    permissionGranted = false;
    return;
  }

  const supportType = getSupportType(tab.url);

  // 지원 불가 스킴 - 권한 없음으로 저장만
  if (supportType === 'unsupported') {
    permissionGranted = false;
    return;
  }

  // file:// 스킴
  if (supportType === 'file') {
    try {
      const url = new URL(tab.url);
      const origin = `${url.protocol}//${url.host}/*`;

      const hasPermission = await chrome.permissions.contains({
        origins: [origin]
      });

      permissionGranted = hasPermission;
    } catch (error) {
      console.error('File permission check failed:', error);
      permissionGranted = false;
    }
    return;
  }

  // http/https 스킴
  // host_permissions에 이미 선언되어 있으므로 항상 권한이 있음
  permissionGranted = true;
}

/**
 * 권한 요청 핸들러 (file:// URL 전용)
 */
async function handleRequestPermission() {
  if (!currentTabId) return;

  try {
    const tab = await chrome.tabs.get(currentTabId);
    const url = new URL(tab.url);
    const origin = `${url.protocol}//${url.host}/*`;

    // 권한 요청
    const granted = await chrome.permissions.request({
      origins: [origin]
    });

    if (granted) {
      // Content script 주입
      await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        files: ['content.js']
      });

      // 잠시 대기
      await new Promise(resolve => setTimeout(resolve, 100));

      // 권한 UI 업데이트
      await checkPermissions(tab);
      showToast('권한이 허용되었습니다!');
    } else {
      showToast('권한이 거부되었습니다.', 'error');
    }
  } catch (error) {
    console.error('Permission request failed:', error);
    showToast('권한 요청 중 오류가 발생했습니다.', 'error');
  }
}

/**
 * Content script 준비 확인 (재시도 로직 강화)
 * 탭 전환 후 번역 시도 시 content script가 준비되지 않은 경우 재주입
 *
 * @param {number} tabId - 대상 탭 ID
 * @param {number} maxRetries - 최대 재시도 횟수 (기본 5)
 * @returns {Promise<boolean>} 준비 완료 여부
 */
async function ensureContentScriptReady(tabId, maxRetries = 5) {
  // 1단계: 이미 준비되어 있는지 확인
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'getTranslationState' });
    logDebug('sidepanel', 'CONTENT_READY_CHECK', 'Content script 이미 준비됨', { tabId });
    return true;
  } catch (error) {
    // "Receiving end does not exist" 에러 탐지 (정상 시나리오 - 탭 전환 시 발생 가능)
    if (error.message && error.message.includes('Receiving end does not exist')) {
      logDebug('sidepanel', 'CONTENT_NOT_READY', 'Content script 미주입 (정상, 자동 주입 예정)', {
        tabId,
        hasContent: false
      });
    } else {
      logInfo('sidepanel', 'CONTENT_READY_CHECK_FAILED', 'Content script 상태 확인 실패', { tabId }, error);
    }

    // 2단계: Content script 재주입
    try {
      logInfo('sidepanel', 'INJECT_CONTENT', 'Content script 재주입 시도', { tabId, files: ['content.js'] });

      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });

      logInfo('sidepanel', 'INJECT_CONTENT', 'Content script 재주입 완료', { tabId });

      // 3단계: 준비될 때까지 재시도 (최대 5번, 지수 백오프)
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const waitTime = Math.min(100 * Math.pow(2, attempt - 1), 1000); // 100ms, 200ms, 400ms, 800ms, 1000ms

        logDebug('sidepanel', 'CONTENT_READY_RETRY', `Content script 준비 확인 재시도 ${attempt}/${maxRetries}`, {
          tabId,
          waitMs: waitTime
        });

        await new Promise(resolve => setTimeout(resolve, waitTime));

        try {
          await chrome.tabs.sendMessage(tabId, { action: 'getTranslationState' });
          logInfo('sidepanel', 'CONTENT_READY_SUCCESS', `Content script 준비 완료 (${attempt}번째 시도)`, {
            tabId,
            attempt,
            totalWaitMs: waitTime
          });
          return true;
        } catch (retryError) {
          if (attempt === maxRetries) {
            logError('sidepanel', 'CONTENT_READY_TIMEOUT', 'Content script 준비 시간 초과', {
              tabId,
              attempts: maxRetries
            }, retryError);
            return false;
          }
          // 계속 재시도
        }
      }

      return false;

    } catch (injectError) {
      logError('sidepanel', 'INJECT_CONTENT', 'Content script 재주입 실패', { tabId, result: 'failed' }, injectError);
      return false;
    }
  }
}

/**
 * Content script에 port 연결
 * 진행 상태를 실시간으로 수신하기 위해 port 사용
 *
 * @param {number} tabId - 대상 탭 ID
 */
function connectToContentScript(tabId) {
  try {
    // 기존 port 종료
    if (port) {
      logDebug('sidepanel', 'PORT_DISCONNECT', '기존 포트 종료', { tabId });
      port.disconnect();
      port = null;
    }

    // 새 port 연결
    port = chrome.tabs.connect(tabId, { name: 'panel' });
    logInfo('sidepanel', 'PORT_CONNECT', 'Content script와 포트 연결', { tabId });

    port.onMessage.addListener((msg) => {
      if (msg.type === 'progress') {
        // PROGRESS_UPDATE 로깅
        logDebug('sidepanel', 'PROGRESS_UPDATE', '번역 진행 상태 수신', {
          tabId,
          done: msg.data.translatedCount,
          total: msg.data.totalTexts,
          percent: msg.data.totalTexts > 0 ? Math.round((msg.data.translatedCount / msg.data.totalTexts) * 100) : 0,
          activeMs: msg.data.activeMs,
          cacheHits: msg.data.cachedCount,
          batches: msg.data.batchesDone + '/' + msg.data.batchCount
        });

        translationState = { ...translationState, ...msg.data };
        updateUI();

        // 번역 완료 시 SUMMARY 로깅
        if (msg.data.state === 'completed') {
          logInfo('sidepanel', 'SUMMARY', '번역 완료 요약', {
            tabId,
            totalTexts: msg.data.totalTexts,
            translated: msg.data.translatedCount,
            cacheHits: msg.data.cachedCount,
            elapsedMs: msg.data.activeMs,
            batches: msg.data.batchCount
          });

          void handleTranslationCompletedForHistory(tabId, msg.data);
        }
      }
    });

    port.onDisconnect.addListener(() => {
      // chrome.runtime.lastError를 확인하여 에러 처리
      if (chrome.runtime.lastError) {
        // Back/forward cache로 이동 등의 에러는 조용히 처리
        logDebug('sidepanel', 'PORT_DISCONNECT', '포트 연결 끊김 (back/forward cache)', {
          tabId,
          error: chrome.runtime.lastError.message
        });
      } else {
        logInfo('sidepanel', 'PORT_DISCONNECT', '포트 연결 끊김', { tabId });
      }
      port = null;
    });

  } catch (error) {
    logError('sidepanel', 'PORT_CONNECT_ERROR', '포트 연결 실패', { tabId }, error);
  }
}

/**
 * 전체 번역 핸들러
 * @param {boolean} useCache - 캐시 사용 여부 (true: 빠른 모드, false: 새로 번역)
 */
async function handleTranslateAll(useCache = true) {
  const button = useCache ? 'fast-translate' : 'full-translate';

  // 마지막 번역 모드를 기록하여 히스토리에 활용
  lastTranslateMode = useCache ? 'cache' : 'fresh';

  if (!currentTabId) {
    showToast('활성 탭을 찾을 수 없습니다.', 'error');
    return;
  }

  translateModeByTab.set(currentTabId, lastTranslateMode);

  // 현재 탭 정보 가져오기
  try {
    const tab = await chrome.tabs.get(currentTabId);
    const supportType = getSupportType(tab.url);

    // 지원하지 않는 URL 체크 (사용자 액션 시에만!)
    if (supportType === 'unsupported') {
      logInfo('sidepanel', 'UI_CLICK_BLOCKED', '지원하지 않는 URL', {
        button,
        tabId: currentTabId,
        url: tab.url
      });
      showToast('이 페이지는 브라우저 정책상 번역을 지원하지 않습니다. 일반 웹페이지에서 사용해주세요.', 'error');
      return;
    }

    // file:// URL 권한 체크
    if (supportType === 'file' && !permissionGranted) {
      logInfo('sidepanel', 'UI_CLICK_BLOCKED', 'file:// 권한 없음', {
        button,
        tabId: currentTabId
      });
      showToast('파일 URL 접근 권한을 허용해야 번역할 수 있습니다. Chrome 확장 프로그램 설정에서 "파일 URL에 대한 액세스 허용"을 켜주세요.', 'error');
      return;
    }

    // http/https URL 권한 체크
    if (supportType === 'requestable' && !permissionGranted) {
      logInfo('sidepanel', 'UI_CLICK_BLOCKED', '권한 미허용', {
        button,
        tabId: currentTabId,
        permissionGranted
      });
      showToast('이 사이트를 번역하려면 접근 권한이 필요합니다. 권한 허용 후 다시 시도해주세요.', 'error');
      return;
    }
  } catch (error) {
    logError('sidepanel', 'TAB_INFO_ERROR', '탭 정보 가져오기 실패', { tabId: currentTabId }, error);
    showToast('탭 정보를 가져올 수 없습니다.', 'error');
    return;
  }

  try {
    // 설정 가져오기
    const settings = await chrome.storage.local.get([
      'apiKey',
      'model',
      'batchSize',
      'concurrency'
    ]);

    if (!settings.apiKey) {
      logInfo('sidepanel', 'UI_CLICK_BLOCKED', 'API Key 미설정', { button, tabId: currentTabId });
      showToast('먼저 설정에서 API Key를 입력해주세요.', 'error');
      switchTab('settings');
      return;
    }

    // UI_CLICK 로깅
    logInfo('sidepanel', 'UI_CLICK', '번역 버튼 클릭', {
      button,
      tabId: currentTabId,
      model: settings.model || DEFAULT_MODEL,
      batch: settings.batchSize || 50,
      concurrency: settings.concurrency || 3,
      useCache
    });

    // Content script 준비 확인 (새로고침 후 에러 방지)
    logDebug('sidepanel', 'CONTENT_READY_CHECK', 'Content script 준비 확인 시작', { tabId: currentTabId });
    const isReady = await ensureContentScriptReady(currentTabId);

    if (!isReady) {
      logError('sidepanel', 'CONTENT_NOT_READY', 'Content script 준비 실패', { tabId: currentTabId });
      showToast('페이지 준비 중 오류가 발생했습니다. 다시 시도해주세요.', 'error');
      return;
    }

    // 포트 재연결 (진행 상태 수신을 위해 필수)
    if (!port) {
      connectToContentScript(currentTabId);
    }

    // DISPATCH_TO_CONTENT (전)
    logDebug('sidepanel', 'DISPATCH_TO_CONTENT', 'content script에 메시지 전송', {
      action: 'translateFullPage',
      tabId: currentTabId
    });

    // 번역 시작 (캐시는 항상 활성화, useCache 파라미터로 빠른 모드/새로 번역 구분)
    await chrome.tabs.sendMessage(currentTabId, {
      action: 'translateFullPage',
      apiKey: settings.apiKey,
      model: settings.model || DEFAULT_MODEL,
      batchSize: settings.batchSize || 50,
      concurrency: settings.concurrency || 3,
      useCache: useCache
    });

    // DISPATCH_TO_CONTENT (후 성공)
    logDebug('sidepanel', 'DISPATCH_TO_CONTENT', '메시지 전송 성공', {
      action: 'translateFullPage',
      tabId: currentTabId,
      ok: true
    });

  } catch (error) {
    // DISPATCH_TO_CONTENT (후 실패)
    logError('sidepanel', 'DISPATCH_TO_CONTENT', '메시지 전송 실패', {
      action: 'translateFullPage',
      tabId: currentTabId,
      ok: false
    }, error);

    showToast('번역 중 오류가 발생했습니다: ' + error.message, 'error');
  }
}

/**
 * 원본 복원 핸들러
 */
async function handleRestore() {
  if (!currentTabId) return;

  logInfo('sidepanel', 'UI_CLICK', '원본 복원 버튼 클릭', { button: 'restore', tabId: currentTabId });

  // URL 체크 (지원하지 않는 페이지에서는 원본 보기 불가)
  try {
    const tab = await chrome.tabs.get(currentTabId);
    const supportType = getSupportType(tab.url);

    if (supportType === 'unsupported') {
      logInfo('sidepanel', 'UI_CLICK_BLOCKED', '지원하지 않는 URL에서 원본 보기 시도', {
        button: 'restore',
        tabId: currentTabId,
        url: tab.url
      });
      showToast('이 페이지는 브라우저 정책상 원본 보기를 지원하지 않습니다.', 'error');
      return;
    }

    if (supportType === 'file' && !permissionGranted) {
      logInfo('sidepanel', 'UI_CLICK_BLOCKED', 'file:// 권한 없음 (원본 보기)', {
        button: 'restore',
        tabId: currentTabId
      });
      showToast('파일 URL 접근 권한이 필요합니다.', 'error');
      return;
    }

    if (supportType === 'requestable' && !permissionGranted) {
      logInfo('sidepanel', 'UI_CLICK_BLOCKED', '권한 미허용 (원본 보기)', {
        button: 'restore',
        tabId: currentTabId
      });
      showToast('이 사이트에 대한 접근 권한이 필요합니다.', 'error');
      return;
    }
  } catch (error) {
    logError('sidepanel', 'TAB_INFO_ERROR', '탭 정보 가져오기 실패 (원본 보기)', { tabId: currentTabId }, error);
    showToast('탭 정보를 가져올 수 없습니다.', 'error');
    return;
  }

  try {
    // Content script 준비 확인
    const isReady = await ensureContentScriptReady(currentTabId);
    if (!isReady) {
      logInfo('sidepanel', 'CONTENT_NOT_READY', 'Content script 준비 실패 (원본 보기)', { tabId: currentTabId });
      showToast('페이지 준비 중 문제가 발생했습니다. 페이지를 새로고침 후 다시 시도해주세요.', 'error');
      return;
    }

    await chrome.tabs.sendMessage(currentTabId, {
      action: 'restoreOriginal'
    });
    logInfo('sidepanel', 'RESTORE_SUCCESS', '원본 복원 완료', { tabId: currentTabId });
  } catch (error) {
    logError('sidepanel', 'RESTORE_ERROR', '원본 복원 실패', { tabId: currentTabId }, error);
    showToast('원본 복원 중 오류가 발생했습니다: ' + error.message, 'error');
  }
}

// ===== UI 업데이트 =====

/**
 * UI 업데이트 (번역 상태에 따라서만 버튼 제어, 권한 체크 안 함)
 * Port로 수신한 진행 상태를 UI에 반영
 */
function updateUI() {
  const { state, totalTexts, translatedCount, cachedCount, batchCount, batchesDone, batches, activeMs } = translationState;

  // 상태 뱃지와 버튼 제어 (권한과 무관하게 번역 상태에 따라서만 제어)
  const statusBadge = document.getElementById('statusBadge');
  const translateAllBtn = document.getElementById('translateAllBtn');
  const translateFreshBtn = document.getElementById('translateFreshBtn');
  const restoreBtn = document.getElementById('restoreBtn');

  if (state === 'translating') {
    // 번역 중: 번역 버튼 비활성화, 원본 보기 활성화
    statusBadge.textContent = '번역 중';
    statusBadge.className = 'status-badge active pulse';
    translateAllBtn.disabled = true;
    translateFreshBtn.disabled = true;
    restoreBtn.disabled = false;
  } else if (state === 'completed') {
    // 번역 완료: 모든 버튼 활성화
    statusBadge.textContent = '번역 완료';
    statusBadge.className = 'status-badge active';
    translateAllBtn.disabled = false;
    translateFreshBtn.disabled = false;
    restoreBtn.disabled = false;
  } else if (state === 'restored') {
    // 원본 보기: 번역 버튼 활성화, 원본 보기 비활성화
    statusBadge.textContent = '원본 보기';
    statusBadge.className = 'status-badge restored';
    translateAllBtn.disabled = false;
    translateFreshBtn.disabled = false;
    restoreBtn.disabled = true;
  } else {
    // 대기 중: 번역 버튼 활성화, 원본 보기 비활성화
    statusBadge.textContent = '대기 중';
    statusBadge.className = 'status-badge';
    translateAllBtn.disabled = false;
    translateFreshBtn.disabled = false;
    restoreBtn.disabled = true;
  }

  // 진행률 텍스트
  if (totalTexts > 0) {
    const progress = Math.round((translatedCount / totalTexts) * 100);
    document.getElementById('progressText').textContent =
      `완료 ${translatedCount}/${totalTexts} (${progress}%)`;
  } else {
    document.getElementById('progressText').textContent = '번역 대기 중';
  }

  // 통계
  document.getElementById('translatedCount').textContent = translatedCount.toLocaleString();
  document.getElementById('cachedCount').textContent = cachedCount.toLocaleString();

  // 배치 정보
  if (batchCount > 0) {
    document.getElementById('batchCountText').textContent = `${batchesDone}/${batchCount}`;
  } else {
    document.getElementById('batchCountText').textContent = '0';
  }

  // 진행 시간
  if (activeMs > 0) {
    const seconds = Math.floor(activeMs / 1000);
    document.getElementById('elapsedTime').textContent = formatTime(seconds);
  } else {
    document.getElementById('elapsedTime').textContent = '0s';
  }

  // 배치 목록
  if (batches && batches.length > 0) {
    document.getElementById('batchInfo').style.display = 'block';
    const batchList = document.getElementById('batchList');
    batchList.innerHTML = batches.map((batch, index) => `
      <div class="batch-item">
        <span class="batch-name">배치 ${index + 1} (${batch.size}개)</span>
        <span class="batch-status ${batch.status}">${getBatchStatusText(batch.status)}</span>
      </div>
    `).join('');
  } else {
    document.getElementById('batchInfo').style.display = 'none';
  }
}

/**
 * 배치 상태 텍스트 변환
 * @param {string} status - 'pending' | 'processing' | 'completed' | 'failed'
 * @returns {string} 한글 상태 텍스트
 */
function getBatchStatusText(status) {
  const statusMap = {
    'pending': '대기',
    'processing': '진행',
    'completed': '완료',
    'failed': '실패'
  };
  return statusMap[status] || status;
}

/**
 * 시간 포맷 (초 → 읽기 쉬운 형식)
 * @param {number} seconds - 초
 * @returns {string} 포맷된 시간 (예: "2m 30s")
 */
function formatTime(seconds) {
  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
}

// ===== 개발자 도구 =====

/**
 * 로그 복사 핸들러
 * 최근 500개 로그를 클립보드에 복사 (이슈 리포트용)
 */
async function handleCopyLogs() {
  try {
    logInfo('sidepanel', 'UI_CLICK', '로그 복사 버튼 클릭', { button: 'copy-logs' });

    const logs = await getLogs();

    if (!logs || logs.length === 0) {
      showToast('복사할 로그가 없습니다.', 'error');
      return;
    }

    // 로그를 읽기 쉬운 형식으로 변환
    const logsText = logs.join('\n');

    // 클립보드에 복사
    await navigator.clipboard.writeText(logsText);

    logInfo('sidepanel', 'LOGS_COPIED', '로그 복사 완료', { count: logs.length });
    showToast(`${logs.length}개의 로그를 복사했습니다!`);

  } catch (error) {
    logError('sidepanel', 'LOGS_COPY_ERROR', '로그 복사 실패', {}, error);
    showToast('로그 복사 중 오류가 발생했습니다: ' + error.message, 'error');
  }
}
