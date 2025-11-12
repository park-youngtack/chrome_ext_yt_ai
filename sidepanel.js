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
import { initQuickTranslateTab } from './modules/quick-translate.js';
import { handleTabChange, getSupportType } from './modules/translation.js';

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

    // GitHub 링크 버튼은 initExternalLinks에서 바인딩됨 (중복 방지)

    // 설정 탭 초기화
    initSettingsTab();
    await loadSettings();

    // 히스토리 탭 초기화
    await initHistoryTab();

    // 검색 탭 초기화
    initializeSearchTab();

    // 텍스트 번역 탭 초기화
    await initQuickTranslateTab();

    // 현재 탭 정보 가져오기
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      State.setCurrentTabId(tab.id);
      await handleTabChange(tab);
    }

    // 번역 탭 버튼 이벤트
    const { handleTranslateAll, handleRestore } = await import('./modules/translation.js');
    document.getElementById('translateAllBtn')?.addEventListener('click', () => handleTranslateAll(true));
    document.getElementById('restoreBtn')?.addEventListener('click', handleRestore);

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
      // 즉시 UI를 현재 탭의 저장 상태 또는 기본 상태로 리셋해 '번역 중' 잔상 제거
      const saved = State.translationStateByTab.get(tab.id);
      if (saved && (saved.state === 'translating' || saved.state === 'completed')) {
        State.setTranslationState({
          ...saved,
          batches: saved.batches ? [...saved.batches] : []
        });
      } else {
        // 기본 상태로 초기화
        State.setTranslationState(State.createDefaultTranslationState());
      }
      // 권한 확인 전 잠깐 동안이라도 현재 탭 상태 기준으로 UI 반영
      // (버튼은 즉시 사용 가능하게 두고, 권한 체크 후 최종 확정됨)
      const { updateUI } = await import('./modules/ui-utils.js');
      const type = getSupportType(tab.url || '');
      if (type === 'unsupported') {
        updateUI(false);
      } else {
        updateUI();
      }
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
    // 새로고침/네비게이션 시 이 탭의 저장 상태는 초기화하여 '완료' 잔상 방지
    State.translationStateByTab.delete(tabId);
    // 자동 번역 플래그도 초기화 (새로고침 시 다시 자동 번역 가능하도록)
    State.autoTranslateTriggeredByTab.delete(tabId);
    await handleTabChange(tab);
    // 지원 불가 URL에서는 캐시 상태 업데이트/주입 시도를 생략
    const type = getSupportType(tab?.url || '');
    if (type !== 'unsupported') {
      const { updatePageCacheStatus } = await import('./modules/settings.js');
      await updatePageCacheStatus();
    }
  }
});

/**
 * 탭 닫힘 감지 (메모리 정리)
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  State.translationStateByTab.delete(tabId);
  State.translateModeByTab.delete(tabId);
  State.autoTranslateTriggeredByTab.delete(tabId);
  // 탭 포트 정리 (연결 끊김 안전 처리)
  try {
    State.removePortForTab?.(tabId, { disconnect: true });
  } catch (e) {
    // noop
  }
});
