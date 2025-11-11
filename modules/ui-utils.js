/**
 * Side Panel UI 유틸리티
 *
 * 역할:
 * - 탭 관리 (전환, 키보드 네비게이션)
 * - 토스트 메시지
 * - UI 업데이트
 * - Content Script 준비 확인
 * - 세션 복원
 * - 디버깅 도구
 */

import { logInfo, logWarn, logDebug, logError, getLogs } from '../logger.js';
import {
  currentTabId,
  translationState,
  setCurrentTabId
} from './state.js';

// ===== 상수 =====
const SESSION_KEY = 'lastActiveTab';
const GITHUB_REPO_URL = 'https://github.com/park-youngtack/chrome_ext_yt_ai';

// ===== 탭바 관리 =====

/**
 * 탭바 초기화
 * 버튼 클릭 이벤트 및 키보드 내비게이션 설정
 */
export function initTabbar() {
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
export function initExternalLinks() {
  const githubLinkBtn = document.getElementById('githubLinkBtn');

  if (!githubLinkBtn) {
    return;
  }

  /**
   * GitHub 저장소를 새 탭으로 여는 헬퍼 함수
   */
  const openGithubRepository = async () => {
    try {
      await chrome.tabs.create({ url: GITHUB_REPO_URL, active: true });
      logInfo('sidepanel', 'GITHUB_REPO_OPENED', 'GitHub 저장소 열기', { url: GITHUB_REPO_URL });
    } catch (error) {
      logWarn('sidepanel', 'GITHUB_REPO_OPEN_FAILED', 'GitHub 저장소 열기 실패', { message: error?.message ?? String(error) }, error);
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
 * @param {string} tabName - 'translate' | 'history' | 'search' | 'settings'
 */
export async function switchTab(tabName) {
  const { loadSettings } = await import('./settings.js');
  const { renderHistoryList } = await import('./history.js');
  const { initializeSearchTab } = await import('./search.js');

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
    const { updateApiKeyUI, updatePageCacheStatus } = await import('./settings.js');
    await updateApiKeyUI();
    try {
      await updatePageCacheStatus();
    } catch (error) {
      logDebug('sidepanel', 'CACHE_STATUS_UPDATE_FAILED', '캐시 상태 업데이트 실패', {
        tabId: currentTabId,
        reason: error?.message || '알 수 없음'
      });
    }
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
export async function restoreSession() {
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
 * 지원: #translate, #settings, #history, #search
 */
export function handleDeepLink() {
  const hash = window.location.hash.slice(1); // # 제거
  if (hash === 'translate' || hash === 'settings' || hash === 'history' || hash === 'search') {
    switchTab(hash);
  }
}

// ===== UI 상태 관리 =====

/**
 * 토스트 메시지 표시 (2초)
 * @param {string} message - 표시할 메시지
 * @param {string} type - 'success' | 'error'
 */
export function showToast(message, type = 'success') {
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
export async function ensurePageContentScript(tabId) {
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
      files: ['content/bootstrap.js', 'content/progress.js', 'content.js']
    });
    logDebug('sidepanel', 'CONTENT_INJECT_SUCCESS', 'Content script 주입 완료', { tabId });
  } catch (error) {
    logError('sidepanel', 'CONTENT_INJECT_FAILED', 'Content script 주입 실패', { tabId }, error);
    throw error;
  }
}

/**
 * 번역 UI만 초기화 (검색, 히스토리, 설정은 유지)
 */
export function resetTranslateUI() {
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

/**
 * UI 업데이트 (번역 상태에 따라)
 * @param {boolean} hasPermission - 권한 여부
 */
export function updateUI(hasPermission = true) {
  const { state, totalTexts, translatedCount, cachedCount, batchCount, batchesDone, batches, activeMs } = translationState;

  // 상태 뱃지와 버튼 제어
  const statusBadge = document.getElementById('statusBadge');
  const translateAllBtn = document.getElementById('translateAllBtn');
  const restoreBtn = document.getElementById('restoreBtn');

  // 권한이 없으면 모든 버튼 비활성화
  if (!hasPermission) {
    statusBadge.textContent = '번역 불가';
    statusBadge.className = 'status-badge';
    translateAllBtn.disabled = true;
    restoreBtn.disabled = true;
  } else if (state === 'translating') {
    // 번역 중: 번역 버튼 비활성화, 원본 보기 활성화
    statusBadge.textContent = '번역 중';
    statusBadge.className = 'status-badge active pulse';
    translateAllBtn.disabled = true;
    restoreBtn.disabled = false;
  } else if (state === 'completed') {
    // 번역 완료: 모든 버튼 활성화
    statusBadge.textContent = '번역 완료';
    statusBadge.className = 'status-badge active';
    translateAllBtn.disabled = false;
    restoreBtn.disabled = false;
  } else if (state === 'restored') {
    // 원본 보기: 번역 버튼 활성화, 원본 보기 비활성화
    statusBadge.textContent = '원본 보기';
    statusBadge.className = 'status-badge restored';
    translateAllBtn.disabled = false;
    restoreBtn.disabled = true;
  } else {
    // 대기 중: 번역 버튼 활성화, 원본 보기 비활성화
    statusBadge.textContent = '대기 중';
    statusBadge.className = 'status-badge';
    translateAllBtn.disabled = false;
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
export function getBatchStatusText(status) {
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
export function formatTime(seconds) {
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
 * 오류 로그 개수를 버튼에 표시
 */
export async function updateErrorLogCount() {
  try {
    const allLogs = await getLogs();
    if (!allLogs || allLogs.length === 0) {
      return;
    }

    // 오류 로그 필터링
    const errorLogs = allLogs.filter(logLine => {
      return /\["ERROR"\]|\["WARN"\]|"level":"ERROR"|"level":"WARN"/.test(logLine);
    });

    // 버튼에 개수 표시
    const errorBtn = document.getElementById('copyErrorLogsBtn');
    if (errorBtn) {
      if (errorLogs.length > 0) {
        errorBtn.textContent = `오류 로그만 복사 (${errorLogs.length})`;
        errorBtn.style.borderColor = '#ef4444';
        errorBtn.style.color = '#ef4444';
      } else {
        errorBtn.textContent = '오류 로그만 복사 (0)';
      }
    }
  } catch (error) {
    logDebug('sidepanel', 'UPDATE_ERROR_LOG_COUNT_ERROR', '오류 로그 개수 업데이트 실패', {}, error);
  }
}

/**
 * 로그 복사 핸들러
 * @param {string} mode - 'all' (전체) 또는 'errors' (오류만)
 */
export async function handleCopyLogs(mode = 'all') {
  try {
    const buttonName = mode === 'errors' ? 'copy-error-logs' : 'copy-all-logs';
    logInfo('sidepanel', 'UI_CLICK', `로그 복사 버튼 클릭 (${mode})`, { button: buttonName });

    const allLogs = await getLogs();

    if (!allLogs || allLogs.length === 0) {
      showToast('복사할 로그가 없습니다.', 'error');
      return;
    }

    // 오류 로그만 필터링
    let logsToCopy = allLogs;
    if (mode === 'errors') {
      logsToCopy = allLogs.filter(logLine => {
        // ERROR 또는 WARN이 포함된 로그만 선택
        return /\["ERROR"\]|\["WARN"\]|"level":"ERROR"|"level":"WARN"/.test(logLine);
      });

      if (logsToCopy.length === 0) {
        showToast('오류 로그가 없습니다.', 'info');
        return;
      }
    }

    // 로그를 읽기 쉬운 형식으로 변환
    const logsText = logsToCopy.join('\n');

    // 클립보드에 복사
    await navigator.clipboard.writeText(logsText);

    const modeLabel = mode === 'errors' ? '오류' : '전체';
    logInfo('sidepanel', 'LOGS_COPIED', '로그 복사 완료', {
      mode,
      count: logsToCopy.length
    });
    showToast(`${logsToCopy.length}개의 ${modeLabel} 로그를 복사했습니다!`);

    // 오류 로그 개수 업데이트
    await updateErrorLogCount();

  } catch (error) {
    logError('sidepanel', 'LOGS_COPY_ERROR', '로그 복사 실패', {}, error);
    showToast('로그 복사 중 오류가 발생했습니다: ' + error.message, 'error');
  }
}
