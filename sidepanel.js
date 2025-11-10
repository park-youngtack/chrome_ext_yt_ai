/**
 * Side Panel Script - 메인 진입점
 *
 * 역할:
 * - DOMContentLoaded 초기화
 * - 모듈 import 및 초기화
 * - Chrome 탭 리스너
 */

import { FOOTER_TEXT } from './meta.js';
import { logInfo, logError, initLogger } from './logger.js';
import * as State from './modules/state.js';
import {
  initTabbar,
  restoreSession,
  handleDeepLink,
  initExternalLinks,
  updateErrorLogCount
} from './modules/ui-utils.js';
import { initHistoryTab } from './modules/history.js';
import { initSettingsTab, loadSettings } from './modules/settings.js';
import { initializeSearchTab } from './modules/search.js';
import { handleTabChange } from './modules/translation.js';

// ===== 초기화 =====

/**
 * DOMContentLoaded 이벤트 핸들러
 * 패널 초기화 및 이벤트 리스너 등록
 */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // 로거 초기화
    await initLogger();

    // 푸터 텍스트 설정
    const footerEl = document.getElementById('footerText');
    if (footerEl) {
      footerEl.textContent = FOOTER_TEXT;
    }

    // 탭바 초기화
    initTabbar();
    initExternalLinks();

    // GitHub 링크 버튼
    const githubBtn = document.getElementById('githubLinkBtn');
    if (githubBtn) {
      githubBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: 'https://github.com/park-youngtack/chrome_ext_yt_ai' });
      });
    }

    // 설정 탭 초기화
    initSettingsTab();
    await loadSettings();

    // 히스토리 탭 초기화
    await initHistoryTab();

    // 검색 탭 초기화
    initializeSearchTab();

    // 현재 탭 정보 가져오기
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      State.setCurrentTabId(tab.id);
      await handleTabChange(tab);
    }

    // 번역 탭 버튼 이벤트
    const { handleTranslateAll, handleRestore, handleResetTranslate } = await import('./modules/translation.js');
    document.getElementById('translateAllBtn')?.addEventListener('click', () => handleTranslateAll(true));
    document.getElementById('restoreBtn')?.addEventListener('click', handleRestore);
    document.getElementById('resetTranslateBtn')?.addEventListener('click', handleResetTranslate);

    // 권한 요청 버튼
    const { handleRequestPermission } = await import('./modules/translation.js');
    const permBtn = document.getElementById('requestPermissionBtn');
    if (permBtn) {
      permBtn.addEventListener('click', handleRequestPermission);
    }

    // 설정 열기 버튼 (file:// 전용)
    const { switchTab } = await import('./modules/ui-utils.js');
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

    // 캐시 관리 버튼
    const { handleClearPageCache } = await import('./modules/settings.js');
    const clearCacheBtn = document.getElementById('clearPageCacheBtn');
    if (clearCacheBtn) {
      clearCacheBtn.addEventListener('click', handleClearPageCache);
    }

    // 로그 복사 버튼
    const { handleCopyLogs } = await import('./modules/ui-utils.js');
    document.getElementById('copyAllLogsBtn')?.addEventListener('click', () => handleCopyLogs('all'));
    document.getElementById('copyErrorLogsBtn')?.addEventListener('click', () => handleCopyLogs('errors'));

    // 오류 로그 개수 업데이트
    await updateErrorLogCount();

    // 세션 복원 (마지막 탭)
    await restoreSession();

    // 딥링크 처리
    handleDeepLink();

    logInfo('sidepanel', 'INIT', '사이드패널 초기화 완료');
  } catch (error) {
    logError('sidepanel', 'INIT_ERROR', '초기화 중 오류', {}, error);
  }
});

// ===== Chrome 탭 리스너 =====

/**
 * 탭 활성화 감지
 */
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab) {
      State.setCurrentTabId(tab.id);
      await handleTabChange(tab);
    }
  } catch (error) {
    logError('sidepanel', 'TAB_ACTIVATED_ERROR', '탭 활성화 처리 중 오류', {}, error);
  }
});

/**
 * 탭 업데이트 감지 (새로고침, 로딩 완료)
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (State.currentTabId === tabId && changeInfo.status === 'complete') {
    await handleTabChange(tab);
    const { updatePageCacheStatus } = await import('./modules/settings.js');
    await updatePageCacheStatus();
  }
});

/**
 * 탭 닫힘 감지 (메모리 정리)
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  State.translationStateByTab.delete(tabId);
  State.translateModeByTab.delete(tabId);
});
