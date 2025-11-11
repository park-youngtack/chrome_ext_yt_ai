/**
 * Background Service Worker
 *
 * 주요 역할:
 * - Content script 자동 등록 및 수동 주입
 * - Side Panel 동작 설정
 * - Extension 생명주기 관리
 *
 * 참고: Service Worker는 ES6 모듈 import를 지원하지 않으므로 인라인 로거 사용
 */

// ===== 로깅 시스템 =====
// DEBUG 레벨은 설정에서 토글 가능, INFO/WARN/ERROR는 항상 출력
const LEVEL_MAP = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
let currentLogLevel = 'INFO';

/**
 * 로거 초기화 - storage에서 디버그 설정 로드
 */
(async () => {
  try {
    const result = await chrome.storage.local.get(['debugLog']);
    currentLogLevel = result.debugLog ? 'DEBUG' : 'INFO';
  } catch (error) {
    // storage 접근 실패 시 기본값(INFO) 유지
  }
})();

/**
 * 디버그 설정 변경 감지
 */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.debugLog) {
    currentLogLevel = changes.debugLog.newValue ? 'DEBUG' : 'INFO';
  }
});

/**
 * 구조화된 로그 출력
 * @param {string} level - DEBUG|INFO|WARN|ERROR
 * @param {string} evt - 이벤트명 (대문자_스네이크_케이스)
 * @param {string} msg - 사람이 읽기 쉬운 요약 메시지
 * @param {object} data - 추가 데이터 (자동으로 JSON 직렬화)
 * @param {Error|string} err - 에러 객체 또는 메시지
 */
function log(level, evt, msg = '', data = {}, err = null) {
  // DEBUG 레벨 필터링 (다른 레벨은 항상 출력)
  if (level === 'DEBUG' && LEVEL_MAP[level] < LEVEL_MAP[currentLogLevel]) return;

  const record = { ts: new Date().toISOString(), level, ns: 'background', evt, msg, ...data };

  // 에러 정보 추가
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

  // 구조화된 출력: prefix + evt + msg + data
  console[consoleMethod]('%s %s %o', prefix, evt, msg || '', record);
}

const logDebug = (evt, msg, data, err) => log('DEBUG', evt, msg, data, err);
const logInfo = (evt, msg, data, err) => log('INFO', evt, msg, data, err);
const logWarn = (evt, msg, data, err) => log('WARN', evt, msg, data, err);
const logError = (evt, msg, data, err) => log('ERROR', evt, msg, data, err);

// ===== Extension 설치 및 초기화 =====

/**
 * Extension 설치/업데이트 시 초기 설정
 */
chrome.runtime.onInstalled.addListener(async () => {
  logInfo('EXTENSION_INSTALLED', '웹페이지 번역기가 설치되었습니다');

  // Side Panel 동작 설정: 아이콘 클릭 시 패널 자동 오픈
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    logInfo('SIDE_PANEL_BEHAVIOR_SET', 'Side Panel 동작 설정 완료');
  } catch (error) {
    logInfo('SIDE_PANEL_BEHAVIOR_FAILED', 'Side Panel 동작 설정 실패 (수동 오픈 사용)', {}, error);
  }

  // Content script 상시 등록 (페이지 로드 시 자동 주입)
  try {
    await chrome.scripting.registerContentScripts([{
      id: 'content-script',
      js: ['content/bootstrap.js', 'content/progress.js', 'content.js'],
      matches: ['https://*/*', 'http://*/*'],
      runAt: 'document_start',
      persistAcrossSessions: true, // 브라우저 재시작 후에도 유지
    }]);
    logInfo('CONTENT_SCRIPT_REGISTERED', 'Content script 등록 완료');
  } catch (error) {
    // 이미 등록된 경우 무시 (에러가 아님)
    if (error.message.includes('duplicate')) {
      logDebug('CONTENT_SCRIPT_ALREADY_REGISTERED', 'Content script 이미 등록됨');
    } else {
      logInfo('CONTENT_SCRIPT_REGISTER_FAILED', 'Content script 등록 실패 (수동 주입 사용)', {}, error);
    }
  }
});

// ===== Content Script 관리 =====

/**
 * Content script 준비 확인 및 주입
 *
 * 동작 흐름:
 * 1. PING 메시지로 준비 상태 확인
 * 2. 준비되지 않았으면 수동 주입
 * 3. CONTENT_READY 메시지 대기 (최대 1.5초)
 *
 * @param {number} tabId - 대상 탭 ID
 * @returns {Promise<void>}
 * @throws {Error} 준비 시간 초과 시
 */
async function ensureContentScript(tabId) {
  // 1단계: PING으로 content script 존재 확인
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

  // 2단계: Content script 수동 주입
  logInfo('CONTENT_INJECT_START', 'Content script 수동 주입 시작', { tabId });
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/bootstrap.js', 'content/progress.js', 'content.js'],
    });
    logInfo('CONTENT_INJECT_DONE', 'Content script 수동 주입 완료', { tabId });
  } catch (error) {
    logError('CONTENT_INJECT_FAILED', 'Content script 주입 실패', { tabId }, error);
    throw error;
  }

  // 3단계: CONTENT_READY 메시지 대기 (최대 1.5초)
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

// ===== 메시지 핸들러 =====

/**
 * sidepanel에서 전체 IndexedDB 캐시 상태 조회 요청을 받음
 * background는 확장 프로그램 레벨에서 전체 캐시에 접근 가능
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getTotalCacheStatus') {
    getTotalCacheStatusFromDB().then((result) => {
      sendResponse({ success: true, count: result.count, size: result.size });
    }).catch((error) => {
      logError('TOTAL_CACHE_STATUS_ERROR', '전체 캐시 상태 조회 실패', {}, error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // 비동기 응답
  }
});

/**
 * IndexedDB에서 전체 캐시 상태 조회
 * @returns {Promise<{count: number, size: number}>}
 */
async function getTotalCacheStatusFromDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('TranslationCache', 1);

    request.onsuccess = (event) => {
      const db = event.target.result;

      try {
        // Object store 존재 여부 확인
        if (!db.objectStoreNames.contains('translations')) {
          db.close();
          logDebug('TOTAL_CACHE_NOT_FOUND', 'Object store "translations"가 없음 (캐시 미생성)');
          resolve({ count: 0, size: 0 });
          return;
        }

        const transaction = db.transaction(['translations'], 'readonly');
        const store = transaction.objectStore('translations');
        const getAllRequest = store.getAll();

        getAllRequest.onsuccess = () => {
          const items = getAllRequest.result;
          let totalSize = 0;

          items.forEach(item => {
            totalSize += JSON.stringify(item).length;
          });

          db.close();
          logDebug('TOTAL_CACHE_STATUS_SUCCESS', '전체 IndexedDB 캐시 상태 조회 성공', {
            count: items.length,
            sizeBytes: totalSize
          });
          resolve({ count: items.length, size: totalSize });
        };

        getAllRequest.onerror = () => {
          db.close();
          const errorMsg = getAllRequest.error?.message || '캐시 조회 실패';
          reject(new Error(errorMsg));
        };
      } catch (error) {
        db.close();
        reject(error);
      }
    };

    request.onerror = () => {
      const errorMsg = request.error?.message || 'IndexedDB 열기 실패';
      reject(new Error(errorMsg));
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      logDebug('TOTAL_CACHE_UPGRADE', 'IndexedDB 업그레이드');

      // Object store가 없으면 생성
      if (!db.objectStoreNames.contains('translations')) {
        db.createObjectStore('translations', { keyPath: 'hash' });
        logDebug('TOTAL_CACHE_STORE_CREATED', 'Object store "translations" 생성');
      }
    };
  });
}

// ===== Side Panel 관리 =====

/**
 * Side Panel은 Chrome이 자동으로 관리 (Window-level 동작)
 *
 * manifest.json의 openPanelOnActionClick: true 설정으로
 * 아이콘 클릭 시 자동으로 패널이 열림
 *
 * 패널 상태 추적이나 URL 변경 감지는 하지 않음
 * (불필요한 로그 방지 - CLAUDE.md 참고)
 *
 * 권한 체크는 sidepanel.js에서 사용자 액션(번역 버튼 클릭) 시에만 수행
 */
