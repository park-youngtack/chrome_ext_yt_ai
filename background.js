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

  // Side Panel 동작 설정: 아이콘 클릭 시 패널 열기
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    logInfo('SIDE_PANEL_BEHAVIOR_SET', 'Side Panel 동작 설정 완료');
  } catch (error) {
    logInfo('SIDE_PANEL_BEHAVIOR_FAILED', 'Side Panel 동작 설정 실패 (수동 오픈 사용)', {}, error);
  }

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
      logInfo('CONTENT_SCRIPT_REGISTER_FAILED', 'Content script 등록 실패 (수동 주입 사용)', {}, error);
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

// ===== Side Panel 관리 =====
// manifest.json의 default_open_panel_on_action_click: true 설정으로
// Chrome이 자동으로 패널을 관리합니다 (window-level).
//
// URL 체크 및 권한 확인은 sidepanel.js에서 사용자 액션(번역 버튼 클릭) 시에만 수행합니다.
