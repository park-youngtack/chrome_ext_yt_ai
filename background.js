// Background Service Worker

// ===== 인라인 로거 (service worker용) =====
const LEVEL_MAP = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
let currentLogLevel = 'INFO';

// 초기화
(async () => {
  try {
    const result = await chrome.storage.local.get(['debugLog']);
    currentLogLevel = result.debugLog ? 'DEBUG' : 'INFO';
  } catch (error) {
    // 기본값 유지
  }
})();

// 설정 변경 감지
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.debugLog) {
    currentLogLevel = changes.debugLog.newValue ? 'DEBUG' : 'INFO';
  }
});

// 로그 함수
function log(level, evt, msg = '', data = {}, err = null) {
  if (level === 'DEBUG' && LEVEL_MAP[level] < LEVEL_MAP[currentLogLevel]) return;

  const record = { ts: new Date().toISOString(), level, ns: 'background', evt, msg, ...data };

  if (err) {
    if (err instanceof Error) {
      record.err = err.message;
      record.stack = err.stack;
    } else {
      record.err = String(err);
    }
  }

  const prefix = `[WPT][${level}][background]`;
  const consoleMethod = level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log';

  // 객체를 제대로 출력하도록 개선
  console[consoleMethod]('%s %s %o', prefix, evt, msg || '', record);
}

const logDebug = (evt, msg, data, err) => log('DEBUG', evt, msg, data, err);
const logInfo = (evt, msg, data, err) => log('INFO', evt, msg, data, err);
const logWarn = (evt, msg, data, err) => log('WARN', evt, msg, data, err);
const logError = (evt, msg, data, err) => log('ERROR', evt, msg, data, err);

// 확장프로그램 설치 시
chrome.runtime.onInstalled.addListener(async () => {
  logInfo('EXTENSION_INSTALLED', '웹페이지 번역기가 설치되었습니다');

  // Content script 상시 등록 (안정적인 주입 보장)
  try {
    await chrome.scripting.registerContentScripts([{
      id: 'content-script',
      js: ['content.js'],
      matches: ['https://*/*', 'http://*/*'],
      runAt: 'document_start',
      persistAcrossSessions: true,
    }]);
    logInfo('CONTENT_SCRIPT_REGISTERED', 'Content script 등록 완료');
  } catch (error) {
    // 이미 등록된 경우 무시
    if (error.message.includes('duplicate')) {
      logDebug('CONTENT_SCRIPT_ALREADY_REGISTERED', 'Content script 이미 등록됨');
    } else {
      logWarn('CONTENT_SCRIPT_REGISTER_FAILED', 'Content script 등록 실패', {}, error);
    }
  }
});

// ===== Content script 준비 확인 및 주입 =====
async function ensureContentScript(tabId) {
  // 1) PING으로 content script 존재 확인
  const ping = () =>
    chrome.tabs.sendMessage(tabId, { type: 'PING' })
      .then(() => {
        logDebug('CONTENT_PING_SUCCESS', 'Content script 이미 준비됨', { tabId });
        return true;
      })
      .catch(() => {
        logDebug('CONTENT_PING_FAILED', 'Content script 미주입', { tabId });
        return false;
      });

  if (await ping()) {
    return; // 이미 준비됨
  }

  // 2) 없으면 주입
  logInfo('CONTENT_INJECT_START', 'Content script 수동 주입 시작', { tabId });
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    logInfo('CONTENT_INJECT_DONE', 'Content script 수동 주입 완료', { tabId });
  } catch (error) {
    logError('CONTENT_INJECT_FAILED', 'Content script 주입 실패', { tabId }, error);
    throw error;
  }

  // 3) CONTENT_READY 메시지 대기 (최대 1.5초)
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error('Content script 준비 타임아웃'));
    }, 1500);

    const listener = (msg, sender) => {
      if (sender.tab?.id === tabId && msg?.type === 'CONTENT_READY') {
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(listener);
        logInfo('CONTENT_READY_RECEIVED', 'Content script 준비 완료', { tabId });
        resolve();
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    // 주입 직후 PING 재시도 (일부 페이지는 즉시 응답 가능)
    setTimeout(async () => {
      if (await ping()) {
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(listener);
        resolve();
      }
    }, 100);
  });
}

// 아이콘 클릭 시 해당 탭에서만 side panel 열기
// 각 탭마다 독립적으로 패널을 열고 닫을 수 있음
// 중복 호출 방지를 위한 디바운스
let opening = false;

// 탭별 패널 열림 상태 추적 (tabId -> boolean)
const panelOpenState = new Map();

chrome.action.onClicked.addListener(async (tab) => {
  // 디바운스: 이미 처리 중이면 무시
  if (opening) {
    logDebug('PANEL_CLICK_DEBOUNCED', 'Side panel 처리 중, 중복 클릭 무시', { tabId: tab.id });
    return;
  }

  opening = true;

  try {
    // 권한 가능 여부 확인 (chrome://, edge://, Web Store 등은 주입 불가)
    if (!tab?.id || !/^https?:/.test(tab.url ?? '')) {
      logWarn('PANEL_UNSUPPORTED_URL', '주입 불가능한 URL', { tabId: tab.id, url: tab.url });
      await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false });
      return;
    }

    const isOpen = panelOpenState.get(tab.id) || false;

    if (isOpen) {
      // 패널이 열려있으면 닫기 메시지 전송
      try {
        await chrome.runtime.sendMessage({ type: 'CLOSE_PANEL_REQUEST', tabId: tab.id });
        logInfo('PANEL_CLOSE_REQUESTED', 'Side panel 닫기 요청', { tabId: tab.id });
      } catch (error) {
        // 패널이 이미 닫혀있거나 응답 없는 경우 상태만 업데이트
        logDebug('PANEL_CLOSE_NO_RESPONSE', '패널 응답 없음, 상태 업데이트', { tabId: tab.id });
        panelOpenState.set(tab.id, false);
      }
    } else {
      // 패널이 닫혀있으면 열기
      chrome.sidePanel.setOptions({
        tabId: tab.id,
        path: 'sidepanel.html',
        enabled: true
      });

      await chrome.sidePanel.open({ tabId: tab.id });
      logInfo('PANEL_OPENED', 'Side panel 열림', { tabId: tab.id, url: tab.url });
      // 상태는 sidepanel.js에서 PANEL_OPENED 메시지를 받으면 업데이트됨
    }
  } catch (error) {
    logError('PANEL_TOGGLE_ERROR', 'Side panel 토글 실패', { tabId: tab.id }, error);
  } finally {
    // 300ms 후 디바운스 해제
    setTimeout(() => {
      opening = false;
    }, 300);
  }
});

// 패널 상태 및 닫기 메시지 핸들러
chrome.runtime.onMessage.addListener(async (message, sender) => {
  if (message.type === 'PANEL_OPENED') {
    // 패널이 열렸을 때 상태 업데이트
    const tabId = message.tabId;
    if (tabId) {
      panelOpenState.set(tabId, true);
      logInfo('PANEL_STATE_OPENED', 'Panel 상태: 열림', { tabId });
    }
  } else if (message.type === 'PANEL_CLOSED') {
    // 패널이 닫혔을 때 상태 업데이트
    const tabId = message.tabId;
    if (tabId) {
      panelOpenState.set(tabId, false);
      logInfo('PANEL_STATE_CLOSED', 'Panel 상태: 닫힘', { tabId });
    }
  } else if (message.type === 'closeSidePanel') {
    // 레거시 호환: 기존 닫기 메시지 지원
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        panelOpenState.set(tab.id, false);
        logInfo('PANEL_CLOSED_LEGACY', 'Side panel 닫힘 (레거시)', { tabId: tab.id });
      }
    } catch (error) {
      logError('PANEL_CLOSE_ERROR', 'Side panel 닫기 실패', {}, error);
    }
  }
});

// 탭이 닫히면 상태 정리
chrome.tabs.onRemoved.addListener((tabId) => {
  if (panelOpenState.has(tabId)) {
    panelOpenState.delete(tabId);
    logDebug('PANEL_STATE_CLEANUP', 'Panel 상태 정리', { tabId });
  }
});
