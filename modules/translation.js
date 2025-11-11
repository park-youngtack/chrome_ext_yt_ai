/**
 * Side Panel 번역 핵심 로직
 *
 * 역할:
 * - 번역 실행 (캐시 모드 / 전면 재번역)
 * - 권한 관리 (http/https/file:// 지원 확인)
 * - Content Script 통신 (Port)
 * - 탭별 상태 관리
 * - 원본 복원
 */

import { logInfo, logWarn, logError, logDebug } from '../logger.js';
import {
  currentTabId,
  translationState,
  translationStateByTab,
  translateModeByTab,
  permissionGranted,
  setCurrentTabId,
  setPermissionGranted,
  setTranslationState,
  createDefaultTranslationState,
  getPortForTab,
  setPortForTab,
  removePortForTab
} from './state.js';
import { updateUI, resetTranslateUI, showToast, updateErrorLogCount } from './ui-utils.js';
import { handleTranslationCompletedForHistory } from './history.js';

// ===== 상수 =====
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

// ===== URL 지원 확인 =====

/**
 * URL 지원 타입 확인
 * @param {string} url - 확인할 URL
 * @returns {'requestable' | 'file' | 'unsupported'}
 */
export function getSupportType(url) {
  try {
    const u = new URL(url);
    // Chrome에서 강제 차단되는 특수 도메인(웹스토어 등)은 예외 처리
    const denied = (
      u.hostname === 'chromewebstore.google.com' ||
      (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore'))
    );
    if ((u.protocol === 'http:' || u.protocol === 'https:') && !denied) {
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
 * 번역 상태 초기화 (권한 없거나 번역 미완료 페이지)
 */
export function initializeTranslationState() {
  translationState.state = 'inactive';
  translationState.totalTexts = 0;
  translationState.translatedCount = 0;
  translationState.cachedCount = 0;
  translationState.batchCount = 0;
  translationState.batchesDone = 0;
  translationState.batches = [];
  translationState.activeMs = 0;
}

// ===== 탭 변경 처리 =====

/**
 * 탭 변경 시 처리 (이동, 새로고침 등 모든 경우)
 * @param {object} tab - 탭 객체
 */
export async function handleTabChange(tab) {
  const fromId = currentTabId;
  // 번역 중이고 탭 ID가 같으면 무시 (같은 탭에서 계속 진행)
  if (translationState.state === 'translating' && tab && tab.id === currentTabId) {
    return;
  }

  // 이전 탭의 번역 상태 저장 (다른 탭으로 이동할 때)
  if (translationState.state === 'translating') {
    translationStateByTab.set(currentTabId, { ...translationState, batches: [...translationState.batches] });
  }

  // 0단계: 현재 탭 ID 업데이트
  const previousTabId = currentTabId;
  if (tab && tab.id) {
    setCurrentTabId(tab.id);
  }

  // 1단계: 포트 관리
  // - 이전 탭이 번역 중이 아니면 포트 정리 (노이즈 감소)
  // - 번역 중이면 유지 (CLAUDE.md 권고)
  if (fromId && fromId !== currentTabId && translationState.state !== 'translating') {
    removePortForTab(fromId, { disconnect: true });
  }

  // 2단계: 새 탭의 저장된 상태 복구 정책
  // - translating 또는 completed 상태는 복구
  // - restored 등 기타 상태는 초기 UI 유지
  if (currentTabId && translationStateByTab.has(currentTabId)) {
    const savedState = translationStateByTab.get(currentTabId);
    if (savedState && (savedState.state === 'translating' || savedState.state === 'completed')) {
      setTranslationState({
        ...savedState,
        batches: savedState.batches ? [...savedState.batches] : []
      });
    } else {
      initializeTranslationState();
    }
  } else {
    // 저장된 상태가 없으면 초기화
    initializeTranslationState();
  }

  // 3단계: 권한 확인만 (번역 상태 조회 안 함 - URL 기반 복구 방지)
  if (tab) {
    await checkPermissions(tab);
  }

  // 4단계: 번역 탭이 활성화되어 있으면 UI 업데이트
  updateUIByPermission();

  logDebug('sidepanel', 'TAB_SWITCH', '탭 전환 처리', { from: fromId, to: currentTabId, state: translationState.state });

  // 5단계: 새 탭이 번역 중 상태라면 포트 보장 (업데이트 수신)
  if (translationState.state === 'translating' && !getPortForTab(currentTabId)) {
    connectToContentScript(currentTabId);
  }
}

/**
 * 권한 상태에 따라 UI 업데이트 (탭 이동 시 호출)
 */
function updateUIByPermission() {
  const activeTab = document.querySelector('.tab-content.active');
  const isTranslateTabActive = activeTab && activeTab.id === 'translateTab';

  // 번역 탭이 활성화되어 있을 때만 UI 업데이트
  if (!isTranslateTabActive) {
    return;
  }

  // 권한 없으면 상태를 초기화
  if (!permissionGranted) {
    translationState.state = 'inactive';
    translationState.totalTexts = 0;
    translationState.translatedCount = 0;
    translationState.cachedCount = 0;
    translationState.batchCount = 0;
    translationState.batchesDone = 0;
    translationState.batches = [];
    translationState.activeMs = 0;

    // 캐시 정보 섹션 숨기기
    const cacheManagement = document.getElementById('cacheManagement');
    if (cacheManagement) {
      cacheManagement.style.display = 'none';
    }
  } else {
    // 권한 있으면 캐시 정보 섹션 표시
    const cacheManagement = document.getElementById('cacheManagement');
    if (cacheManagement) {
      cacheManagement.style.display = 'block';
    }
  }

  // 상태에 따라 UI 렌더링 (권한 상태도 포함)
  updateUI(permissionGranted);
}

/**
 * 권한 확인 (탭 전환/새 탭 시 호출)
 * @param {object} tab - 탭 객체
 */
export async function checkPermissions(tab) {
  if (!tab || !tab.url) {
    setPermissionGranted(false);
    return;
  }

  const supportType = getSupportType(tab.url);

  // 지원 불가 스킴 - 권한 없음
  if (supportType === 'unsupported') {
    setPermissionGranted(false);
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
      setPermissionGranted(hasPermission);
    } catch (error) {
      setPermissionGranted(false);
    }
    return;
  }

  // http/https 스킴 - 권한 있음
  setPermissionGranted(true);

  // 번역 탭에서는 캐시 상태도 업데이트
  const { updatePageCacheStatus } = await import('./settings.js');
  const activeTab = document.querySelector('.tab-content.active');
  if (activeTab && activeTab.id === 'translateTab') {
    try {
      await updatePageCacheStatus();
    } catch (error) {
      // 캐시 상태 조회 실패는 무시
    }
  }
}

/**
 * 권한 요청 핸들러 (file:// URL 전용)
 */
export async function handleRequestPermission() {
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
    if (error.message && error.message.includes('Receiving end does not exist')) {
      logDebug('sidepanel', 'CONTENT_NOT_READY', 'Content script 미주입', { tabId, hasContent: false });
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
        const waitTime = Math.min(100 * Math.pow(2, attempt - 1), 1000);

        logDebug('sidepanel', 'CONTENT_READY_RETRY', `재시도 ${attempt}/${maxRetries}`, {
          tabId,
          waitMs: waitTime
        });

        await new Promise(resolve => setTimeout(resolve, waitTime));

        try {
          await chrome.tabs.sendMessage(tabId, { action: 'getTranslationState' });
          logInfo('sidepanel', 'CONTENT_READY_SUCCESS', `준비 완료 (${attempt}번째 시도)`, {
            tabId,
            attempt
          });
          return true;
        } catch (retryError) {
          if (attempt === maxRetries) {
            logError('sidepanel', 'CONTENT_READY_TIMEOUT', '준비 시간 초과', {
              tabId,
              attempts: maxRetries
            }, retryError);
            return false;
          }
        }
      }

      return false;

    } catch (injectError) {
      logError('sidepanel', 'INJECT_CONTENT', 'Content script 재주입 실패', { tabId }, injectError);
      return false;
    }
  }
}

/**
 * Content script에 port 연결
 * @param {number} tabId - 대상 탭 ID
 */
function connectToContentScript(tabId) {
  try {
    // 이미 연결된 포트가 있으면 재사용 (중복 연결 방지)
    const existing = getPortForTab(tabId);
    if (existing) {
      return;
    }

    // 새 port 연결 (탭별 관리)
    const newPort = chrome.tabs.connect(tabId, { name: 'panel' });
    setPortForTab(tabId, newPort);
    logInfo('sidepanel', 'PORT_CONNECT', 'Content script와 포트 연결', { tabId });

    newPort.onMessage.addListener((msg) => {
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

        // 탭별 상태 저장
        translationStateByTab.set(tabId, { ...msg.data });

        // 활성 탭일 때만 UI에 반영
        if (tabId === currentTabId) {
          setTranslationState({ ...msg.data });
          updateUI();
        } else {
          logDebug('sidepanel', 'PROGRESS_IGNORED', '활성 탭이 아니어서 UI 업데이트 생략', { fromTab: tabId, currentTabId });
        }

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

    newPort.onDisconnect.addListener(() => {
      if (chrome.runtime.lastError) {
        logDebug('sidepanel', 'PORT_DISCONNECT', '포트 연결 끊김 (back/forward cache)', {
          tabId,
          error: chrome.runtime.lastError.message
        });
      } else {
        logInfo('sidepanel', 'PORT_DISCONNECT', '포트 연결 끊김', { tabId });
      }
      removePortForTab(tabId, { disconnect: false });
    });

  } catch (error) {
    logError('sidepanel', 'PORT_CONNECT_ERROR', '포트 연결 실패', { tabId }, error);
  }
}

/**
 * 전체 번역 핸들러
 * @param {boolean} useCache - 캐시 사용 여부 (true: 빠른 모드, false: 새로 번역)
 */
export async function handleTranslateAll(useCache = true) {
  const button = useCache ? 'fast-translate' : 'full-translate';

  if (!currentTabId) {
    showToast('활성 탭을 찾을 수 없습니다.', 'error');
    return;
  }

  translateModeByTab.set(currentTabId, useCache ? 'cache' : 'fresh');

  // 현재 탭 정보 가져오기
  try {
    const tab = await chrome.tabs.get(currentTabId);
    const supportType = getSupportType(tab.url);

    // 권한 상태 갱신
    await checkPermissions(tab);

    // 지원하지 않는 URL 체크 (사용자 액션 시에만!)
    if (supportType === 'unsupported') {
      logInfo('sidepanel', 'UI_CLICK_BLOCKED', '지원하지 않는 URL', {
        button,
        tabId: currentTabId,
        url: tab.url
      });
      showToast('이 페이지는 브라우저 정책상 번역을 지원하지 않습니다.', 'error');
      return;
    }

    // file:// URL 권한 체크
    if (supportType === 'file' && !permissionGranted) {
      logInfo('sidepanel', 'UI_CLICK_BLOCKED', 'file:// 권한 없음', { button, tabId: currentTabId });
      showToast('파일 URL 접근 권한을 허용해야 번역할 수 있습니다.', 'error');
      return;
    }

    // http/https URL 권한 체크
    if (supportType === 'requestable' && !permissionGranted) {
      logInfo('sidepanel', 'UI_CLICK_BLOCKED', '권한 미허용', {
        button,
        tabId: currentTabId,
        permissionGranted
      });
      showToast('이 사이트를 번역하려면 접근 권한이 필요합니다.', 'error');
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
      const { switchTab } = await import('./ui-utils.js');
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

    // Content script 준비 확인
    logDebug('sidepanel', 'CONTENT_READY_CHECK', 'Content script 준비 확인 시작', { tabId: currentTabId });
    const isReady = await ensureContentScriptReady(currentTabId);

    if (!isReady) {
      logError('sidepanel', 'CONTENT_NOT_READY', 'Content script 준비 실패', { tabId: currentTabId });
      showToast('페이지 준비 중 오류가 발생했습니다. 다시 시도해주세요.', 'error');
      return;
    }

    // 포트 연결 (진행 상태 수신을 위해 필수) - 탭별로 보유
    if (!getPortForTab(currentTabId)) {
      connectToContentScript(currentTabId);
    }

    // DISPATCH_TO_CONTENT (전)
    logDebug('sidepanel', 'DISPATCH_TO_CONTENT', 'content script에 메시지 전송', {
      action: 'translateFullPage',
      tabId: currentTabId
    });

    // 번역 시작
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
export async function handleRestore() {
  if (!currentTabId) return;

  logInfo('sidepanel', 'UI_CLICK', '원본 복원 버튼 클릭', { button: 'restore', tabId: currentTabId });

  // URL 체크 (지원하지 않는 페이지에서는 원본 보기 불가)
  try {
    const tab = await chrome.tabs.get(currentTabId);
    const supportType = getSupportType(tab.url);

    // 권한 상태를 동기화
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
    const _port = getPortForTab(currentTabId);
    if (translationState.state === 'translating' && _port) {
      _port.postMessage({
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

/**
 * 번역 초기화 버튼 클릭 핸들러
 */
export async function handleResetTranslate() {
  logInfo('sidepanel', 'RESET_TRANSLATE', '번역 상태 초기화 버튼 클릭', {
    currentState: translationState.state
  });

  if (!currentTabId) {
    showToast('탭 정보를 가져올 수 없습니다.', 'error');
    return;
  }

  try {
    // 번역 중이면 번역 작업 취소
    const _p = getPortForTab(currentTabId);
    if (translationState.state === 'translating' && _p) {
      _p.postMessage({
        type: 'CANCEL_TRANSLATION',
        reason: 'user_reset'
      });
      logInfo('sidepanel', 'CANCEL_ON_RESET', '초기화로 인한 번역 취소', {
        tabId: currentTabId,
        translatedCount: translationState.translatedCount
      });
    }

    // 원본 복원 (번역된 페이지도 초기화)
    await chrome.tabs.sendMessage(currentTabId, {
      action: 'restoreOriginal'
    });
    logInfo('sidepanel', 'RESET_WITH_RESTORE', '초기화 + 원본 복원 완료', { tabId: currentTabId });
  } catch (error) {
    logInfo('sidepanel', 'RESET_NO_CONTENT_SCRIPT', '초기화: Content script 없음', { tabId: currentTabId });
  }

  // UI 초기화
  resetTranslateUI();
  // 이 탭의 저장 상태도 초기화하여 재진입 시 '완료' 잔상 방지
  try {
    translationStateByTab.set(currentTabId, createDefaultTranslationState());
  } catch (_) {}
  showToast('번역이 초기화되었습니다.');
}
