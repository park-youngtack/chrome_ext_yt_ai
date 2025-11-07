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
const DEFAULT_CACHE_TTL_MINUTES = 43200; // 기본 30일 유지 시간을 분 단위로 표현
const CACHE_TTL_MIN_MINUTES = 5;         // 최소 5분
const CACHE_TTL_MAX_MINUTES = 525600;    // 최대 365일
// 최신 확장 버전을 확인할 때 사용할 GitHub 저장소 주소
const GITHUB_REPO_URL = 'https://github.com/park-youngtack/chrome_ext_yt_ai';

/**
 * 최신순으로 정렬된 히스토리 목록에서 URL 기준 중복을 제거한다.
 * @param {Array<object>} entries - 정렬된 히스토리 배열
 * @returns {Array<object>} URL별로 마지막 번역만 남긴 배열
 */
function deduplicateHistoryByUrl(entries) {
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

  // 외부 링크(최신버전 버튼) 초기화
  initExternalLinks();

  // 번역 탭 버튼 이벤트
  document.getElementById('translateAllBtn')?.addEventListener('click', () => handleTranslateAll(true));
  document.getElementById('translateFreshBtn')?.addEventListener('click', () => handleTranslateAll(false));
  document.getElementById('restoreBtn')?.addEventListener('click', handleRestore);
  document.getElementById('resetTranslateBtn')?.addEventListener('click', handleResetTranslate);

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

  // 설정 탭 이벤트 초기화
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
 * 외부 링크 버튼 초기화
 * GitHub 저장소를 새 탭으로 열어 최신 버전을 안내한다.
 */
function initExternalLinks() {
  const githubLinkBtn = document.getElementById('githubLinkBtn');

  if (!githubLinkBtn) {
    return;
  }

  /**
   * GitHub 저장소를 새 탭으로 여는 헬퍼 함수
   * chrome.tabs.create는 MV3 환경에서 Promise를 반환한다.
   */
  const openGithubRepository = async () => {
    try {
      await chrome.tabs.create({ url: GITHUB_REPO_URL, active: true });
      logInfo('GITHUB_REPO_OPENED', { url: GITHUB_REPO_URL });
    } catch (error) {
      logWarn('GITHUB_REPO_OPEN_FAILED', { message: error?.message ?? String(error) });
    }
  };

  githubLinkBtn.addEventListener('click', () => {
    openGithubRepository();
  });

  githubLinkBtn.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      openGithubRepository();
    }
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

  // 헤더 제목 업데이트
  const panelTitle = document.getElementById('panelTitle');
  const titleMap = {
    'translate': 'AI 번역',
    'history': '번역 히스토리',
    'search': '스마트 검색',
    'settings': '설정'
  };
  panelTitle.textContent = titleMap[tabName] || 'AI 번역';

  // 세션 저장 (마지막 탭 상태)
  await chrome.storage.session.set({ [SESSION_KEY]: tabName });

  // 번역 탭으로 전환 시 API key 확인 및 캐시 상태 업데이트
  if (tabName === 'translate') {
    await updateApiKeyUI();
    await updatePageCacheStatus();
  }

  // 설정 탭으로 전환 시 설정 로드
  if (tabName === 'settings') {
    await loadSettings();
  }

  // 히스토리 탭으로 전환 시 목록 새로고침
  if (tabName === 'history') {
    await renderHistoryList();
  }

  // 검색 탭으로 전환 시 초기화
  if (tabName === 'search') {
    initializeSearchTab();
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

    if (lastTab && (lastTab === 'translate' || lastTab === 'settings' || lastTab === 'history' || lastTab === 'search')) {
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
  // 입력 필드 변경 감지 (select 포함)
  const inputs = document.querySelectorAll('#settingsTab input, #settingsTab select');
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

  // 이 페이지 캐시 비우기 버튼
  document.getElementById('clearPageCacheBtn')?.addEventListener('click', handleClearPageCache);

  // 로그 복사 버튼
  document.getElementById('copyLogsBtn')?.addEventListener('click', handleCopyLogs);
}

/**
 * 캐시 TTL 분 값을 사용자 입력용 값과 단위로 변환한다.
 * @param {number} minutes - 저장된 TTL (분)
 * @param {string} preferredUnit - 사용자가 이전에 선택한 단위 (minute|hour|day)
 * @returns {{ value: number, unit: 'minute'|'hour'|'day' }} 사용자 입력용 값과 단위
 */
function resolveTTLDisplay(minutes, preferredUnit) {
  // 기본값 보정 (NaN 또는 0일 경우 기본 TTL 사용)
  let ttlMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_CACHE_TTL_MINUTES;

  // 이전에 선택한 단위가 유효하면 그대로 사용한다.
  if (preferredUnit === 'minute' || preferredUnit === 'hour' || preferredUnit === 'day') {
    const multiplier = preferredUnit === 'day' ? 1440 : preferredUnit === 'hour' ? 60 : 1;
    return {
      unit: preferredUnit,
      value: Math.max(1, Math.round(ttlMinutes / multiplier))
    };
  }

  // 24시간(1440분)으로 나누어 떨어지면 일 단위로 표현
  if (ttlMinutes % 1440 === 0) {
    return { unit: 'day', value: ttlMinutes / 1440 };
  }

  // 1시간(60분)으로 나누어 떨어지면 시간 단위 사용
  if (ttlMinutes % 60 === 0) {
    return { unit: 'hour', value: ttlMinutes / 60 };
  }

  // 그 외에는 분 단위로 표현
  return { unit: 'minute', value: ttlMinutes };
}

/**
 * 사용자 입력 값을 분 단위 TTL로 변환한다.
 * @param {number} value - 사용자 입력 값
 * @param {'minute'|'hour'|'day'} unit - 사용자 선택 단위
 * @returns {number} 분 단위 TTL
 */
function convertTTLToMinutes(value, unit) {
  const numericValue = Number.isFinite(value) && value > 0 ? value : 0;
  if (unit === 'day') {
    return numericValue * 1440;
  }
  if (unit === 'hour') {
    return numericValue * 60;
  }
  return numericValue;
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
      'cacheTTLUnit',
      'debugLog'
    ]);

    // 원본 설정 저장
    const resolvedTTL = resolveTTLDisplay(result.cacheTTL, result.cacheTTLUnit);
    originalSettings = {
      ...result,
      cacheTTL: Number.isFinite(result.cacheTTL) && result.cacheTTL > 0 ? result.cacheTTL : DEFAULT_CACHE_TTL_MINUTES,
      cacheTTLUnit: resolvedTTL.unit
    };

    // API 설정
    document.getElementById('apiKey').value = result.apiKey || '';
    document.getElementById('model').value = result.model || '';

    // 번역 설정
    document.getElementById('batchSize').value = result.batchSize || 50;
    document.getElementById('concurrency').value = result.concurrency || 3;

    // 캐시 설정 (분 값을 적절한 단위로 변환하여 표시)
    document.getElementById('cacheTTLValue').value = resolvedTTL.value;
    document.getElementById('cacheTTLUnit').value = resolvedTTL.unit;

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
  const cacheTTLValue = parseInt(document.getElementById('cacheTTLValue').value) || 30;
  const selectedUnit = document.getElementById('cacheTTLUnit').value;
  const cacheTTLUnit = (selectedUnit === 'minute' || selectedUnit === 'hour' || selectedUnit === 'day') ? selectedUnit : 'day';
  const cacheTTL = convertTTLToMinutes(cacheTTLValue, cacheTTLUnit);
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

  if (cacheTTL < CACHE_TTL_MIN_MINUTES || cacheTTL > CACHE_TTL_MAX_MINUTES) {
    showToast('캐시 유지 기간은 5분 이상 365일 이하로 설정해주세요.', 'error');
    return;
  }

  try {
    await chrome.storage.local.set({
      apiKey,
      model,
      batchSize,
      concurrency,
      cacheTTL,
      cacheTTLUnit,
      debugLog
    });

    logInfo('sidepanel', 'SETTINGS_SAVED', '설정 저장 완료', {
      model,
      batchSize,
      concurrency,
      cacheTTL,
      cacheTTLUnit,
      debugLog
    });

    // 원본 설정 업데이트
    originalSettings = {
      apiKey,
      model,
      batchSize,
      concurrency,
      cacheTTL,
      cacheTTLUnit,
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
 * Content script가 준비되어 있는지 확인 (필요시 주입)
 * @param {number} tabId - 대상 탭 ID
 * @returns {Promise<void>}
 */
async function ensurePageContentScript(tabId) {
  try {
    // PING으로 content script 존재 확인
    const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (response && response.ok) {
      logDebug('sidepanel', 'CONTENT_PING_SUCCESS', 'Content script 이미 준비됨', { tabId });
      return;
    }
  } catch (error) {
    // PING 실패 → content script 미주입
    logDebug('sidepanel', 'CONTENT_PING_FAILED', 'Content script 미주입, 주입 시작', { tabId });
  }

  // Content script 주입
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    logDebug('sidepanel', 'CONTENT_INJECT_SUCCESS', 'Content script 주입 완료', { tabId });
  } catch (error) {
    logError('sidepanel', 'CONTENT_INJECT_FAILED', 'Content script 주입 실패', { tabId }, error);
    throw error;
  }
}

/**
 * 현재 페이지(도메인)의 IndexedDB 캐시 상태 조회
 * content script를 통해 현재 도메인의 캐시만 조회
 * @returns {Promise<{count: number, size: number}>} 캐시 항목 수와 총 용량(바이트)
 */
async function getPageCacheStatus() {
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
            logDebug('sidepanel', 'PAGE_CACHE_SEND_MSG_ERROR', 'Content script와 통신 실패 (권한 없음 또는 준비 안됨)', {
              error: chrome.runtime.lastError.message
            });
            resolve({ count: 0, size: 0 });
            return;
          }

          if (response && response.success) {
            logDebug('sidepanel', 'PAGE_CACHE_STATUS_SUCCESS', '현재 페이지 캐시 상태 조회 성공', {
              count: response.count,
              size: formatBytes(response.size)
            });
            resolve({ count: response.count, size: response.size });
          } else {
            const errorMsg = response?.error || '알 수 없는 오류';
            logDebug('sidepanel', 'PAGE_CACHE_STATUS_ERROR', 'Content script에서 캐시 조회 실패', {
              error: errorMsg
            });
            resolve({ count: 0, size: 0 });
          }
        }
      );
    });
  } catch (error) {
    logError('sidepanel', 'PAGE_CACHE_STATUS_ERROR', '현재 페이지 캐시 상태 조회 실패', {}, error);
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
 * 동시에 캐시 UI의 표시 여부를 결정
 */
async function updatePageCacheStatus() {
  try {
    const cacheManagementEl = document.getElementById('cacheManagement');

    // 현재 탭이 지원되는 URL인 경우에만 캐시 UI 표시
    if (permissionGranted) {
      // Content script가 준비되어 있는지 확인 (필요시 주입)
      try {
        await ensurePageContentScript(currentTabId);
      } catch (error) {
        logDebug('sidepanel', 'ENSURE_CONTENT_SCRIPT_FAILED', 'Content script 준비 실패', {
          error: error.message
        });
        // Content script 준비 실패해도 캐시 조회는 시도
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

      logDebug('sidepanel', 'PAGE_CACHE_STATUS_UPDATED', '현재 페이지 캐시 상태 업데이트', {
        count,
        size: formatBytes(size)
      });
    } else {
      // 지원되지 않는 URL이면 캐시 UI 숨김
      if (cacheManagementEl) {
        cacheManagementEl.style.display = 'none';
      }
      logDebug('sidepanel', 'PAGE_CACHE_HIDDEN', '지원되지 않는 URL이므로 캐시 UI 숨김');
    }
  } catch (error) {
    logError('sidepanel', 'PAGE_CACHE_STATUS_UPDATE_ERROR', '현재 페이지 캐시 상태 업데이트 실패', {}, error);
  }
}

/**
 * 현재 페이지의 캐시 비우기 핸들러
 * Content script에 메시지를 보내 해당 도메인의 캐시만 삭제
 */
async function handleClearPageCache() {
  try {
    if (!currentTabId) {
      logWarn('sidepanel', 'PAGE_CACHE_CLEAR_NO_TAB', 'CurrentTabId가 없음');
      showToast('현재 탭을 확인할 수 없습니다.', 'error');
      return;
    }

    logInfo('sidepanel', 'PAGE_CACHE_CLEAR_START', '현재 페이지 캐시 삭제 시작');

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
          logInfo('sidepanel', 'PAGE_CACHE_CLEARED', '현재 페이지 캐시 삭제 완료');

          // 캐시 삭제 후 UI 업데이트
          updatePageCacheStatus();
        } else {
          const errorMsg = response?.error || '알 수 없는 오류';
          logWarn('sidepanel', 'PAGE_CACHE_CLEAR_FAILED', 'Content script에서 캐시 삭제 실패', {
            error: errorMsg
          });
          showToast('캐시 삭제 중 오류가 발생했습니다: ' + errorMsg, 'error');
        }
      }
    );
  } catch (error) {
    logError('sidepanel', 'PAGE_CACHE_CLEAR_ERROR', '현재 페이지 캐시 삭제 실패', {}, error);
    showToast('캐시 삭제 중 오류가 발생했습니다: ' + error.message, 'error');
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

  // 현재 탭에서 번역 탭을 보고 있으면 캐시 상태도 업데이트
  const activeTab = document.querySelector('.tab-content.active');
  if (activeTab && activeTab.id === 'translateTab') {
    await updatePageCacheStatus();
  }
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

    // 새 탭 진입 직후 about:blank, chrome://newtab 등으로 판별되던 권한 상태를
    // 실제 URL 기준으로 즉시 갱신하여 불필요한 권한 오류를 예방한다.
    await checkPermissions(tab);

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

    // 탭 로딩 완료 후 실제 URL 기준으로 권한 상태를 동기화한다.
    await checkPermissions(tab);

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

    // 번역 중이면 번역 작업 취소
    if (translationState.state === 'translating' && port) {
      port.postMessage({
        type: 'CANCEL_TRANSLATION',
        reason: 'user_restore'
      });
      logInfo('sidepanel', 'CANCEL_ON_RESTORE', '원본 보기로 인한 번역 취소', {
        tabId: currentTabId,
        translatedCount: translationState.translatedCount
      });
    }

    await chrome.tabs.sendMessage(currentTabId, {
      action: 'restoreOriginal'
    });
    logInfo('sidepanel', 'RESTORE_SUCCESS', '원본 복원 완료', { tabId: currentTabId });

    // UI 초기화
    resetTranslateUI();
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
/**
 * 번역 초기화 버튼 클릭 핸들러
 */
function handleResetTranslate() {
  logInfo('sidepanel', 'RESET_TRANSLATE', '번역 상태 초기화 버튼 클릭', {
    currentState: translationState.state
  });

  resetTranslateUI();
  showToast('번역 상태가 초기화되었습니다.');
}

/**
 * 번역 UI만 초기화 (검색, 히스토리, 설정은 유지)
 */
function resetTranslateUI() {
  // 번역 진행 상황만 초기화
  translationState.state = 'inactive';
  translationState.totalTexts = 0;
  translationState.translatedCount = 0;
  translationState.cachedCount = 0;
  translationState.batchCount = 0;
  translationState.batchesDone = 0;
  translationState.batches = [];
  translationState.activeMs = 0;

  // UI 업데이트
  updateUI();
}

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

// ===== 검색 탭 기능 =====

/**
 * Google 파비콘
 */
function getGoogleIcon() {
  return `<img class="search-engine-icon" alt="Google" width="24" height="24" src="https://www.google.com/s2/favicons?sz=128&domain=google.com" style="width: 20px; height: 20px;">`;
}

/**
 * Naver 파비콘
 */
function getNaverIcon() {
  return `<img class="search-engine-icon" alt="Naver" width="24" height="24" src="https://www.google.com/s2/favicons?sz=128&domain=naver.com" style="width: 20px; height: 20px;">`;
}

/**
 * Bing 파비콘
 */
function getBingIcon() {
  return `<img class="search-engine-icon" alt="Bing" width="24" height="24" src="https://www.google.com/s2/favicons?sz=128&domain=bing.com" style="width: 20px; height: 20px;">`;
}

/**
 * ChatGPT 파비콘
 */
function getChatGPTIcon() {
  return `<img class="search-engine-icon" alt="ChatGPT" width="24" height="24" src="https://www.google.com/s2/favicons?sz=128&domain=chatgpt.com" style="width: 20px; height: 20px;">`;
}

/**
 * Perplexity 파비콘
 */
function getPerplexityIcon() {
  return `<img class="search-engine-icon" alt="Perplexity" width="24" height="24" src="https://www.google.com/s2/favicons?sz=128&domain=perplexity.ai" style="width: 20px; height: 20px;">`;
}

/**
 * 검색 탭 초기화
 */
function initializeSearchTab() {
  const searchInput = document.getElementById('searchInput');
  const getRecommendationsBtn = document.getElementById('getRecommendationsBtn');

  // 이전 리스너 제거 후 다시 등록 (중복 방지)
  getRecommendationsBtn.removeEventListener('click', handleGetRecommendations);
  getRecommendationsBtn.addEventListener('click', handleGetRecommendations);

  // 입력 내용 변경 시 추천 초기화
  searchInput.removeEventListener('input', resetSearchRecommendations);
  searchInput.addEventListener('input', resetSearchRecommendations);

  // 엔터 키로 추천 받기
  searchInput.removeEventListener('keydown', handleSearchKeydown);
  searchInput.addEventListener('keydown', handleSearchKeydown);
}

/**
 * 검색 입력창 키다운 핸들러 (Enter로 추천)
 */
function handleSearchKeydown(event) {
  // Enter 키일 때 추천 받기 (줄바꿈 방지)
  if (event.key === 'Enter') {
    event.preventDefault();
    handleGetRecommendations();
  }
}

/**
 * 추천 받기 버튼 클릭 핸들러
 */
async function handleGetRecommendations() {
  const searchInput = document.getElementById('searchInput');
  const query = searchInput.value.trim();

  if (!query) {
    showToast('검색 내용을 입력해주세요.', 'error');
    return;
  }

  // API Key 확인
  const result = await chrome.storage.local.get(['apiKey']);
  const apiKey = result.apiKey;

  if (!apiKey) {
    showToast('API Key가 설정되지 않았습니다. 설정 탭에서 설정해주세요.', 'error');
    return;
  }

  // 로딩 상태 표시
  const loadingEl = document.getElementById('searchLoadingState');
  loadingEl.style.display = 'flex';

  try {
    const container = document.getElementById('searchRecommendations');
    const currentCount = container.children.length;

    // 최대 10개까지만 표시 (사용자 입력 1개 + AI 추천 9개)
    if (currentCount >= 10) {
      showToast('최대 10개의 검색 추천을 표시할 수 있습니다.', 'error');
      return;
    }

    let recommendations = [];

    // 첫 번째 추천일 때만 사용자 입력값을 첫 번째 항목으로 추가
    if (currentCount === 0) {
      recommendations.push(query);
    }

    // AI 추천 3개 추가 (하지만 전체 10개를 넘지 않도록)
    const aiRecommendations = await callOpenRouterSearch(query, apiKey);
    const remainingSlots = 10 - currentCount - (currentCount === 0 ? 1 : 0);
    recommendations.push(...aiRecommendations.slice(0, Math.min(3, remainingSlots)));

    renderSearchRecommendations(recommendations);
    logInfo('sidepanel', 'SEARCH_SUCCESS', '검색 추천 완료', { count: recommendations.length });
  } catch (error) {
    logError('sidepanel', 'SEARCH_ERROR', '검색 실패', {}, error);
    showToast('검색 생성 중 오류가 발생했습니다: ' + error.message, 'error');
  } finally {
    loadingEl.style.display = 'none';
  }
}

/**
 * OpenRouter API로 검색문 추천 받기
 */
async function callOpenRouterSearch(query, apiKey) {
  const model = (await chrome.storage.local.get(['model'])).model || DEFAULT_MODEL;

  const prompt = `사용자가 다음과 같은 내용을 검색하려고 합니다. 최적의 검색 키워드 3개를 생성해주세요.

사용자의 검색 목적: "${query}"

요구사항:
1. 각 검색 키워드는 실제로 검색 엔진에서 잘 작동하도록 최적화되어야 합니다.
2. 원문의 의도를 유지하면서 가장 효과적인 검색문을 만들어야 합니다.
3. 한국어나 영문 또는 섞여서 사용 가능합니다.
4. 각 검색문은 1줄씩 출력하고, 번호를 붙이지 마세요.

검색 키워드:`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.href,
      'X-Title': 'Smart Search'
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: prompt
      }],
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || `API error: ${response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content || '';

  // 응답에서 검색문들 파싱
  const lines = content.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  return lines.slice(0, 3);
}

/**
 * 검색 추천 리스트 렌더링 (누적)
 */
function renderSearchRecommendations(newRecommendations) {
  const container = document.getElementById('searchRecommendations');
  const emptyEl = document.getElementById('searchEmpty');

  // 기존 리스트에 새 추천 누적
  if (newRecommendations && newRecommendations.length > 0) {
    newRecommendations.forEach(query => {
      const itemEl = document.createElement('div');
      itemEl.className = 'search-item';

      const textEl = document.createElement('div');
      textEl.className = 'search-item-text';
      textEl.textContent = query;

      const enginesEl = document.createElement('div');
      enginesEl.className = 'search-item-engines';

      // 검색 엔진 버튼들 추가
      const engines = [
        { name: 'google', label: 'Google', svg: getGoogleIcon() },
        { name: 'naver', label: 'Naver', svg: getNaverIcon() },
        { name: 'bing', label: 'Bing', svg: getBingIcon() },
        { name: 'chatgpt', label: 'ChatGPT', svg: getChatGPTIcon() },
        { name: 'perplexity', label: 'Perplexity', svg: getPerplexityIcon() }
      ];

      engines.forEach(engine => {
        const btn = document.createElement('button');
        btn.className = 'search-engine-btn';
        btn.innerHTML = engine.svg;
        btn.title = engine.label;
        btn.setAttribute('data-engine', engine.name);
        btn.onclick = () => openSearchResults(engine.name, query);
        enginesEl.appendChild(btn);
      });

      // All 버튼
      const allBtn = document.createElement('button');
      allBtn.className = 'search-engine-btn all';
      allBtn.textContent = 'All';
      allBtn.title = '모든 검색 엔진에서 검색';
      allBtn.onclick = () => openAllSearchEngines(query);
      enginesEl.appendChild(allBtn);

      itemEl.appendChild(textEl);
      itemEl.appendChild(enginesEl);
      container.appendChild(itemEl);
    });

    // 빈 상태 숨기기
    emptyEl.classList.add('hidden');
  }
}

/**
 * 검색 추천 초기화 (입력 내용 변경 시)
 */
function resetSearchRecommendations() {
  const container = document.getElementById('searchRecommendations');
  const emptyEl = document.getElementById('searchEmpty');

  // 입력값이 변경되면 기존 추천 초기화
  container.innerHTML = '';
  emptyEl.classList.remove('hidden');
}

/**
 * 특정 검색 엔진에서 검색
 */
function openSearchResults(engine, query) {
  const encodedQuery = encodeURIComponent(query);
  let url;

  switch (engine) {
    case 'google':
      url = `https://www.google.com/search?q=${encodedQuery}`;
      break;
    case 'naver':
      url = `https://search.naver.com/search.naver?query=${encodedQuery}`;
      break;
    case 'bing':
      url = `https://www.bing.com/search?q=${encodedQuery}`;
      break;
    case 'chatgpt':
      url = `https://chat.openai.com/?q=${encodedQuery}`;
      break;
    case 'perplexity':
      url = `https://www.perplexity.ai/search?q=${encodedQuery}`;
      break;
    default:
      return;
  }

  chrome.tabs.create({ url, active: false });
  logInfo('sidepanel', 'SEARCH_OPENED', '검색 탭 열음', { engine, query });
}

/**
 * 모든 검색 엔진에서 동시 검색
 */
function openAllSearchEngines(query) {
  const encodedQuery = encodeURIComponent(query);

  // 5개 엔진에서 모두 검색
  const urls = [
    `https://www.google.com/search?q=${encodedQuery}`,
    `https://search.naver.com/search.naver?query=${encodedQuery}`,
    `https://www.bing.com/search?q=${encodedQuery}`,
    `https://chat.openai.com/?q=${encodedQuery}`,
    `https://www.perplexity.ai/search?q=${encodedQuery}`
  ];

  urls.forEach(url => {
    chrome.tabs.create({ url, active: false });
  });

  logInfo('sidepanel', 'SEARCH_ALL_OPENED', '모든 검색 엔진에서 검색', { query });
  showToast(`"${query}"를 5개 검색 엔진에서 열었습니다!`);
}
