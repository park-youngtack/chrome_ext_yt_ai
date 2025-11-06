// 공용 로거 - 개발자 디버깅용 구조화된 로깅 시스템
// 요구사항: 한 줄 JSON + 사람이 읽기 쉬운 프리픽스
// 민감정보(API 키, 원문 전체 텍스트) 마스킹

const LEVEL_MAP = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const MAX_LOGS = 500; // ring-buffer 크기

// 로그 ring-buffer (session storage에 저장)
let logBuffer = [];
let currentLogLevel = 'INFO'; // 기본값

// 초기화: storage에서 설정 로드
async function initLogger() {
  try {
    const result = await chrome.storage.local.get(['debugLog']);
    currentLogLevel = result.debugLog ? 'DEBUG' : 'INFO';
  } catch (error) {
    // storage 접근 실패 시 기본값 유지
  }
}

// 설정 변경 감지
if (typeof chrome !== 'undefined' && chrome.storage) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.debugLog) {
      currentLogLevel = changes.debugLog.newValue ? 'DEBUG' : 'INFO';
    }
  });
  initLogger();
}

/**
 * 민감정보 마스킹
 * - API 키: 앞 8자만 표시
 * - 텍스트: 길이, 카운트, 해시, 앞 20자만
 */
function maskSensitive(data) {
  if (!data || typeof data !== 'object') return data;

  const masked = { ...data };

  // API 키 마스킹
  if (masked.apiKey) {
    masked.apiKey = masked.apiKey.substring(0, 8) + '***';
  }

  // 텍스트 마스킹 (긴 텍스트는 앞 20자만)
  if (masked.text && typeof masked.text === 'string' && masked.text.length > 20) {
    masked.text = masked.text.substring(0, 20) + `...(${masked.text.length}자)`;
  }

  // 배열 텍스트 마스킹
  if (masked.texts && Array.isArray(masked.texts)) {
    masked.textCount = masked.texts.length;
    masked.texts = `[${masked.texts.length}개 항목]`;
  }

  // 원문 텍스트 마스킹
  if (masked.original && typeof masked.original === 'string' && masked.original.length > 20) {
    masked.original = masked.original.substring(0, 20) + `...(${masked.original.length}자)`;
  }

  return masked;
}

/**
 * 로그 출력 (공용)
 * @param {string} level - DEBUG|INFO|WARN|ERROR
 * @param {string} ns - background|sidepanel|content
 * @param {string} evt - 이벤트명
 * @param {string} msg - 요약 메시지
 * @param {object} data - 세부 데이터 객체
 * @param {Error|string} err - 에러 객체 또는 메시지
 */
export function log(level, ns, evt, msg = '', data = {}, err = null) {
  // 레벨 필터링 (DEBUG만 토글, INFO/WARN/ERROR는 항상 출력)
  if (level === 'DEBUG' && LEVEL_MAP[level] < LEVEL_MAP[currentLogLevel]) {
    return;
  }

  // 민감정보 마스킹
  const maskedData = maskSensitive(data);

  // 로그 레코드 생성
  const record = {
    ts: new Date().toISOString(),
    level,
    ns,
    evt,
    msg,
    ...maskedData
  };

  // 에러 정보 추가
  if (err) {
    if (err instanceof Error) {
      record.err = err.message;
      record.stack = err.stack;
    } else {
      record.err = String(err);
    }
  }

  // 콘솔 출력 (스타일링)
  const prefix = `%c[WPT]%c ${ns} %c${level}%c ${evt}`;
  const css = [
    'color:#8ab4f8;font-weight:bold',
    'color:#9aa0a6',
    `color:${level === 'ERROR' ? '#f28b82' : level === 'WARN' ? '#fbbc05' : level === 'DEBUG' ? '#81c995' : '#e8eaed'};font-weight:bold`,
    'color:#e8eaed'
  ];

  const consoleMethod = level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log';
  console[consoleMethod](prefix, ...css, record);

  // ring-buffer에 저장 (JSON 문자열로)
  logBuffer.push(JSON.stringify(record));
  if (logBuffer.length > MAX_LOGS) {
    logBuffer.shift();
  }

  // session storage에 저장 (비동기, 실패해도 무시)
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
    chrome.storage.session.set({ wptLogs: logBuffer }).catch(() => {});
  }
}

/**
 * 로그 버퍼 가져오기
 */
export async function getLogs() {
  try {
    const result = await chrome.storage.session.get(['wptLogs']);
    return result.wptLogs || logBuffer;
  } catch (error) {
    return logBuffer;
  }
}

/**
 * 로그 버퍼 초기화
 */
export async function clearLogs() {
  logBuffer = [];
  try {
    await chrome.storage.session.remove(['wptLogs']);
  } catch (error) {
    // 무시
  }
}

/**
 * 편의 함수들
 */
export const logDebug = (ns, evt, msg, data, err) => log('DEBUG', ns, evt, msg, data, err);
export const logInfo = (ns, evt, msg, data, err) => log('INFO', ns, evt, msg, data, err);
export const logWarn = (ns, evt, msg, data, err) => log('WARN', ns, evt, msg, data, err);
export const logError = (ns, evt, msg, data, err) => log('ERROR', ns, evt, msg, data, err);

// 전역 에러 핸들러 (자동 등록)
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => {
    const ns = window.location.pathname.includes('sidepanel') ? 'sidepanel' : 'content';
    logError(ns, 'ONERROR', '전역 에러 발생', {}, e.error || e.message);
  });

  window.addEventListener('unhandledrejection', (e) => {
    const ns = window.location.pathname.includes('sidepanel') ? 'sidepanel' : 'content';
    logError(ns, 'UNHANDLED_REJECTION', '처리되지 않은 Promise 거부', {}, e.reason);
  });
}
