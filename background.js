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

  const prefix = `[WPT][${level}][background] ${evt}`;
  const consoleMethod = level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log';

  if (msg) {
    console[consoleMethod](prefix, msg, record);
  } else {
    console[consoleMethod](prefix, record);
  }
}

const logDebug = (evt, msg, data, err) => log('DEBUG', evt, msg, data, err);
const logInfo = (evt, msg, data, err) => log('INFO', evt, msg, data, err);
const logWarn = (evt, msg, data, err) => log('WARN', evt, msg, data, err);
const logError = (evt, msg, data, err) => log('ERROR', evt, msg, data, err);

// 확장프로그램 설치 시
chrome.runtime.onInstalled.addListener(() => {
  logInfo('EXTENSION_INSTALLED', '웹페이지 번역기가 설치되었습니다');
});

// 아이콘 클릭 시 해당 탭에서만 side panel 열기
// 각 탭마다 독립적으로 패널을 열고 닫을 수 있음
// 중복 호출 방지를 위한 디바운스
let opening = false;

chrome.action.onClicked.addListener(async (tab) => {
  // 디바운스: 이미 처리 중이면 무시
  if (opening) {
    logDebug('PANEL_CLICK_DEBOUNCED', 'Side panel 처리 중, 중복 클릭 무시', { tabId: tab.id });
    return;
  }

  opening = true;

  try {
    // 해당 탭에서만 사이드패널 설정 및 활성화
    await chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: 'sidepanel.html',
      enabled: true
    });

    // 해당 탭에서만 사이드패널 열기
    await chrome.sidePanel.open({ tabId: tab.id });
    logInfo('PANEL_OPENED', 'Side panel 열림', { tabId: tab.id, url: tab.url });
  } catch (error) {
    logError('PANEL_OPEN_ERROR', 'Side panel 열기 실패', { tabId: tab.id }, error);
  } finally {
    // 300ms 후 디바운스 해제
    setTimeout(() => {
      opening = false;
    }, 300);
  }
});

// 패널 닫기 메시지 핸들러
chrome.runtime.onMessage.addListener(async (message, sender) => {
  if (message.type === 'closeSidePanel') {
    try {
      // 현재 활성 탭 가져오기
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.sidePanel.setOptions({
          tabId: tab.id,
          enabled: false
        });
        logInfo('PANEL_CLOSED', 'Side panel 닫힘', { tabId: tab.id });
      }
    } catch (error) {
      logError('PANEL_CLOSE_ERROR', 'Side panel 닫기 실패', {}, error);
    }
  }
});
