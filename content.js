/**
 * Content Script - 웹페이지 번역 핵심 로직
 *
 * 주요 기능:
 * - DOM 텍스트 노드 수집 및 번역
 * - IndexedDB 기반 번역 캐시 관리 (기본 TTL 30일)
 * - 배치 처리 (기본 50개 문장, 동시 3개 배치)
 * - WeakMap 기반 원본 텍스트 복원
 * - Port를 통한 실시간 진행 상태 푸시
 *
 * 아키텍처:
 * - 번역 상태: inactive → translating → completed → restored
 * - 캐시: SHA1 해시 기반, TTL 만료 자동 재번역
 * - 대규모 변경: ≥20% 변경 시 자동 전면 재번역
 *
 * 참고: Content script는 ES6 모듈을 사용하지 않으므로 인라인 구현
 */

// ===== 전역 상태 =====
// Content script 중복 주입 방지 (SPA 환경에서 여러 번 실행될 수 있음)
// 이미 초기화되었으면 나머지 코드는 실행하지 않음
if (typeof window.__WPT_INITIALIZED !== 'undefined') {
  // Content script 이미 초기화됨 - 재실행 방지
  console.warn('[WPT] Content script already initialized, skipping reinit');
} else {
  // 초기화 플래그 설정
  window.__WPT_INITIALIZED = true;

// ===== 전역 상태 변수 (IIFE 내부) =====
let translationState = 'inactive'; // 'inactive', 'translating', 'completed', 'restored'
let originalTexts = new WeakMap(); // 원본 텍스트 저장 (GC 안전)
let translatedElements = new Set(); // 번역된 요소 추적

// ===== IndexedDB 캐시 설정 =====
const DB_NAME = 'TranslationCache';
const DB_VERSION = 1;
const STORE_NAME = 'translations';
const DEFAULT_TTL_MINUTES = 525600; // 기본 365일(1년)을 분 단위로 표현
const API_RETRY_MAX_ATTEMPTS = 3;
const API_RETRY_BASE_DELAY_MS = 800;
const API_RETRY_BACKOFF_FACTOR = 2;

// ===== 로깅 시스템 =====
// debugLog OFF: 모든 로그 차단 / ON: 모든 로그 출력
const LEVEL_MAP = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
let currentLogLevel = 'INFO'; // 기본값: 로그 차단

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
 * 민감정보 마스킹
 * - API 키: 앞 8자만 표시
 * - 텍스트: 20자 초과 시 잘라내고 전체 길이 표시
 * @param {object} data - 마스킹할 데이터 객체
 * @returns {object} 마스킹된 데이터
 */
function maskSensitive(data) {
  if (!data || typeof data !== 'object') return data;
  const masked = { ...data };

  if (masked.apiKey) {
    masked.apiKey = masked.apiKey.substring(0, 8) + '***';
  }

  if (masked.text && typeof masked.text === 'string' && masked.text.length > 20) {
    masked.text = masked.text.substring(0, 20) + `...(${masked.text.length}자)`;
  }

  if (masked.texts && Array.isArray(masked.texts)) {
    masked.textCount = masked.texts.length;
    masked.texts = `[${masked.texts.length}개 항목]`;
  }

  if (masked.original && typeof masked.original === 'string' && masked.original.length > 20) {
    masked.original = masked.original.substring(0, 20) + `...(${masked.original.length}자)`;
  }

  return masked;
}

/**
 * 구조화된 로그 출력
 * @param {string} level - DEBUG|INFO|WARN|ERROR
 * @param {string} evt - 이벤트명 (대문자_스네이크_케이스)
 * @param {string} msg - 사람이 읽기 쉬운 요약 메시지
 * @param {object} data - 추가 데이터 (민감정보 자동 마스킹)
 * @param {Error|string} err - 에러 객체 또는 메시지
 */
function log(level, evt, msg = '', data = {}, err = null) {
  // 로그 필터링: debugLog OFF면 모든 로그 차단
  if (currentLogLevel === 'INFO') return;

  const masked = maskSensitive(data);
  const record = { ts: new Date().toISOString(), level, ns: 'content', evt, msg, ...masked };

  if (err) {
    if (err instanceof Error) {
      record.err = err.message;
      record.stack = err.stack;
    } else {
      record.err = String(err);
    }
  }

  const prefix = `[WPT][${level}][content] ${evt}`;
  const consoleMethod = level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log';

  // 구조화된 로그 출력 (객체가 [object Object]로 표시되지 않도록)
  // 데이터 필드만 추출 (ts, level, ns, evt, msg 제외)
  const {ts, level: lvl, ns, evt: evtName, msg: msgText, err: errMsg, stack, ...extraData} = record;
  const dataStr = Object.keys(extraData).length > 0 ? ' ' + JSON.stringify(extraData) : '';

  if (msg) {
    if (errMsg) {
      console[consoleMethod](`${prefix} ${msg}${dataStr}`, `\nError: ${errMsg}${stack ? '\n' + stack : ''}`);
    } else {
      console[consoleMethod](`${prefix} ${msg}${dataStr}`);
    }
  } else {
    if (errMsg) {
      console[consoleMethod](`${prefix}${dataStr}`, `\nError: ${errMsg}${stack ? '\n' + stack : ''}`);
    } else {
      console[consoleMethod](`${prefix}${dataStr}`);
    }
  }
}

// 로깅 편의 함수
const logDebug = (evt, msg, data, err) => log('DEBUG', evt, msg, data, err);
const logInfo = (evt, msg, data, err) => log('INFO', evt, msg, data, err);
const logWarn = (evt, msg, data, err) => log('WARN', evt, msg, data, err);
const logError = (evt, msg, data, err) => log('ERROR', evt, msg, data, err);

// ===== 진행 상태 관리 =====
/**
 * 번역 진행 상태 (sidepanel로 실시간 푸시)
 */
let progressStatus = {
  state: 'inactive',       // 번역 상태
  totalTexts: 0,          // 전체 텍스트 수
  translatedCount: 0,     // 번역 완료 수
  cachedCount: 0,         // 캐시 사용 수
  batchCount: 0,          // 전체 배치 수
  batchesDone: 0,         // 완료 배치 수
  batches: [],            // 배치 상세 정보
  activeMs: 0,            // 경과 시간 (ms)
  originalTitle: '',      // 번역 전 페이지 제목
  translatedTitle: '',    // 번역 후 페이지 제목
  previewText: ''         // 히스토리용 번역 프리뷰
};

// ===== 산업군 컨텍스트 분석 =====

/**
 * @typedef {Object} IndustryContext
 * @property {string} industry - 산업군 이름
 * @property {Array<string>} keywords - 핵심 키워드 목록
 * @property {string} tone - 권장 어조 또는 톤
 * @property {string} rationale - 산업군 판별 근거 요약
 */

/** @type {IndustryContext|null} */
let industryContext = null;

/**
 * 번역 시작 시 산업군 컨텍스트를 초기화한다.
 */
function resetIndustryContext() {
  industryContext = null;
}

/**
 * 산업군 판별에 사용할 샘플 텍스트를 추출한다.
 * @param {Array<string>} texts - 원본 텍스트 배열
 * @param {number} maxSegments - 최대 샘플 개수
 * @param {number} maxChars - 샘플 누적 최대 길이
 * @returns {Array<string>} 정제된 샘플 텍스트 배열
 */
function buildIndustrySampleSegments(texts, maxSegments = 24, maxChars = 2500) {
  if (!Array.isArray(texts) || texts.length === 0) {
    return [];
  }

  const segments = [];
  let totalChars = 0;

  for (const text of texts) {
    if (segments.length >= maxSegments || totalChars >= maxChars) {
      break;
    }

    if (typeof text !== 'string') {
      continue;
    }

    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (!trimmed) {
      continue;
    }

    const limited = trimmed.slice(0, 220);
    segments.push(limited);
    totalChars += limited.length;
  }

  return segments;
}

/**
 * OpenRouter 응답으로부터 산업군 정보를 추출한다.
 * @param {string} responseText - OpenRouter 모델 응답 텍스트
 * @returns {IndustryContext|null} 추출된 산업군 정보
 */
function parseIndustryContext(responseText) {
  if (typeof responseText !== 'string' || responseText.trim().length === 0) {
    return null;
  }

  const startIdx = responseText.indexOf('{');
  const endIdx = responseText.lastIndexOf('}');

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return null;
  }

  try {
    const jsonText = responseText.slice(startIdx, endIdx + 1);
    const parsed = JSON.parse(jsonText);

    const industry = typeof parsed.industry === 'string' ? parsed.industry.trim() : '';
    if (!industry) {
      return null;
    }

    const keywords = Array.isArray(parsed.keywords)
      ? parsed.keywords.map((item) => String(item).trim()).filter(Boolean)
      : [];

    const tone = typeof parsed.tone === 'string' ? parsed.tone.trim() : '';
    const rationale = typeof parsed.summary === 'string'
      ? parsed.summary.trim()
      : (typeof parsed.rationale === 'string' ? parsed.rationale.trim() : '');

    return {
      industry,
      keywords,
      tone,
      rationale
    };
  } catch (error) {
    logWarn('INDUSTRY_PARSE_FAIL', '산업군 분석 응답 파싱 실패', {}, error);
    return null;
  }
}

/**
 * 번역 프롬프트에 추가할 산업군 설명을 생성한다.
 * @param {IndustryContext|null} context - 판별된 산업군 정보
 * @returns {string} 프롬프트에 삽입할 지침 문자열
 */
function buildIndustryInstruction(context) {
  if (!context) {
    return '- 페이지의 내용을 고려하여 자연스럽고 정확한 한국어로 번역해주세요.';
  }

  const keywordLine = context.keywords.length > 0
    ? `- 핵심 용어: ${context.keywords.slice(0, 8).join(', ')}.`
    : '';
  const toneLine = context.tone ? `- 권장 어조: ${context.tone}.` : '';
  const rationaleLine = context.rationale ? `- 산업군 참고 설명: ${context.rationale}.` : '';

  return [
    `- 이 페이지는 "${context.industry}" 산업군의 콘텐츠입니다.`,
    keywordLine,
    toneLine,
    rationaleLine,
    '- 산업군 특유의 전문 용어와 뉘앙스를 유지하면서 자연스럽게 번역해주세요.'
  ].filter(Boolean).join('\n');
}

/**
 * 산업군 정보를 추론하여 전역 컨텍스트로 저장한다.
 * @param {Array<string>} texts - 페이지에서 수집한 텍스트 배열
 * @param {string} apiKey - OpenRouter API Key
 * @param {string} model - 사용할 모델 이름
 * @returns {Promise<void>} 분석 완료 시 resolve되는 Promise
 */
async function ensureIndustryContext(texts, apiKey, model) {
  const samples = buildIndustrySampleSegments(texts);

  if (samples.length === 0) {
    logDebug('INDUSTRY_SKIP', '산업군 분석을 생략합니다', { reason: 'empty_sample' });
    industryContext = null;
    return;
  }

  try {
    const prompt = `다음은 웹페이지에서 발췌한 텍스트 일부입니다. 콘텐츠가 속한 산업군을 분석하고, 번역 시 참고할 핵심 정보를 JSON으로 제공해주세요.\n\n샘플 텍스트:\n${samples.map((segment, idx) => `[${idx}] ${segment}`).join('\n')}\n\n응답 형식 (JSON만 반환): {"industry": "산업군 이름", "keywords": ["용어1", ...], "tone": "권장 어조", "summary": "두 문장 이내 근거"}`;

    const response = await requestOpenRouter(prompt, apiKey, model, {
      purpose: 'industry-detect',
      itemCount: samples.length
    });

    const parsed = parseIndustryContext(response);

    if (parsed) {
      industryContext = parsed;
      logInfo('INDUSTRY_DETECTED', '산업군 분석 완료', {
        industry: parsed.industry,
        keywords: parsed.keywords.slice(0, 5),
        tone: parsed.tone || null
      });
    } else {
      industryContext = null;
      logWarn('INDUSTRY_DETECTED', '산업군 분석 결과가 유효하지 않습니다', {
        sampleCount: samples.length
      });
    }
  } catch (error) {
    industryContext = null;
    logWarn('INDUSTRY_DETECT_FAIL', '산업군 분석에 실패했습니다', {
      sampleCount: samples.length
    }, error);
  }
}

// ===== 타이머 관리 =====
/**
 * 타이머 관련 변수
 * - activeMs: 누적 경과 시간 (ms)
 * - lastTick: 마지막 tick 시간 (performance.now)
 * - timerId: setInterval ID
 * - inflight: 현재 진행 중인 배치 수 (0이 되면 타이머 정지)
 */
// 진행/타이머 관리는 WPT.Progress로 이관

// ===== Port 연결 관리 =====
/**
 * sidepanel과의 양방향 통신 채널
 * - 진행 상태를 실시간으로 푸시 (1초마다)
 * - 연결 끊김 시 자동으로 null 처리 (에러 방지)
 */
let port = null;

// 부트스트랩에서 WPT 네임스페이스를 노출한다. 부트스트랩 미주입 시에도 기존 동작 유지되도록 안전하게 접근한다.
window.WPT = window.WPT || {};
const WPT = window.WPT;
// 진행 모듈이 아직 없다면 안전한 no-op 셈
if (!WPT.Progress) {
  WPT.Progress = {
    setPort: function() {},
    clearPort: function() {},
    setStatusGetter: function() {},
    startTimer: function() {},
    stopTimer: function() {},
    onBatchStart: function() {},
    onBatchEnd: function() {},
    pushProgress: function() {},
    getActiveMs: function() { return 0; }
  };
}

/**
 * Port 연결 리스너
 * sidepanel이 열릴 때마다 연결되며, 현재 상태를 즉시 푸시
 */
chrome.runtime.onConnect.addListener((p) => {
  if (p.name === WPT.Constants.PORT_NAMES.PANEL) {
    port = p;
    log('Side panel connected');

    // 현재 상태 즉시 푸시
    WPT.Progress.pushProgress();

    // Port로부터 메시지 수신 (원본 복원 시 번역 작업 중단)
    WPT.Progress.setPort(port);
    port.onMessage.addListener((msg) => {
      if (msg.type === WPT.Constants.PORT_MESSAGES.CANCEL_TRANSLATION) {
        logInfo('CANCEL_TRANSLATION', '번역 취소 요청 수신', {
          reason: msg.reason
        });

        // 현재 진행 중인 번역 작업 중단
        if (translationState.state === 'translating') {
          translationState.state = 'cancelled';
          logInfo('TRANSLATION_CANCELLED', '번역 작업 취소됨', {
            cancelReason: msg.reason,
            translatedCount: translationState.translatedCount,
            totalTexts: translationState.totalTexts
          });
        }
      }
    });

    port.onDisconnect.addListener(() => {
      // chrome.runtime.lastError를 확인하여 에러 처리
      if (chrome.runtime.lastError) {
        // Back/forward cache로 이동 등의 에러는 정상 시나리오로 조용히 처리
        logDebug('PORT_DISCONNECT', 'Port 연결 끊김 (back/forward cache)', {
          error: chrome.runtime.lastError.message
        });
      } else {
        log('Side panel disconnected');
      }
      WPT.Progress.clearPort();
      port = null;
    });
  }
});

/**
 * 타이머 시작
 * 첫 번째 배치 시작 시 자동 호출
 */
// 진행 상태 getter를 Progress 모듈에 연결
WPT.Progress && WPT.Progress.setStatusGetter && WPT.Progress.setStatusGetter(() => progressStatus);

// ===== 메시지 리스너 =====
/**
 * sidepanel 및 background로부터 메시지 수신
 *
 * 지원 액션:
 * - PING: 준비 상태 확인
 * - translateFullPage: 전체 페이지 번역 시작
 * - restoreOriginal: 원본 텍스트 복원
 * - getTranslationState: 현재 번역 상태 조회
 * - getTranslatedTitle: 번역된 제목 조회
 * - clearAllCache: 전역 캐시 비우기
 * - clearPageCache: 페이지 캐시 비우기
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // PING: Content script 준비 상태 확인
  if (request.type === WPT.Constants.ACTIONS.PING) {
    sendResponse({ ok: true });
    return true;
  }

  if (request.action === WPT.Constants.ACTIONS.TRANSLATE_FULL_PAGE) {
    handleTranslateFullPage(request.apiKey, request.model, request.batchSize, request.concurrency, request.useCache);
    sendResponse({ success: true });
  } else if (request.action === WPT.Constants.ACTIONS.RESTORE_ORIGINAL) {
    handleRestoreOriginal();
    sendResponse({ success: true });
  } else if (request.action === WPT.Constants.ACTIONS.GET_TRANSLATION_STATE) {
    sendResponse({ state: progressStatus });
  } else if (request.action === WPT.Constants.ACTIONS.GET_TRANSLATED_TITLE) {
    sendResponse({ title: document.title });
  } else if (request.action === WPT.Constants.ACTIONS.GET_CACHE_STATUS) {
    // Sidepanel에서 현재 도메인의 캐시 상태 요청
    getCacheStatus().then(result => {
      sendResponse(result);
    }).catch(error => {
      sendResponse({ success: false, count: 0, size: 0, error: error.message });
    });
    return true; // 비동기 응답
  } else if (request.action === WPT.Constants.ACTIONS.CLEAR_CACHE_FOR_DOMAIN) {
    // Sidepanel에서 현재 도메인의 캐시 삭제 요청
    handleClearCacheForDomain().then(result => {
      sendResponse(result);
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true; // 비동기 응답
  }
  return true;
});

// ===== 번역 메인 로직 =====

/**
 * 전체 페이지 번역 핸들러
 *
 * 동작 흐름:
 * 1. 텍스트 노드 수집
 * 2. 캐시 확인 및 분류 (캐시 hit / miss)
 * 3. 대규모 변경 감지 (≥20% 변경 시 전면 재번역)
 * 4. 캐시 적용 (배치 단위로 DOM 업데이트)
 * 5. 신규 번역 처리 (병렬 API 호출 → 순차 DOM 적용)
 * 6. 완료 상태 업데이트
 *
 * @param {string} apiKey - OpenRouter API Key
 * @param {string} model - AI 모델 (예: openai/gpt-4o-mini)
 * @param {number} batchSize - 배치 크기 (기본 50)
 * @param {number} concurrency - 동시 처리 개수 (기본 3)
 * @param {boolean} useCache - 캐시 사용 여부 (기본 true)
 */
async function handleTranslateFullPage(apiKey, model, batchSize = 50, concurrency = 3, useCache = true) {
  // CONTENT_INIT 로깅
  const url = window.location.href;
  logInfo('CONTENT_INIT', '번역 시작', {
    url,
    batchSize,
    concurrency,
    useCache,
    model
  });

  // 상태 초기화
  translationState = 'translating';
  activeMs = 0;
  inflight = 0;

  resetIndustryContext();

  progressStatus = {
    state: 'translating',
    totalTexts: 0,
    translatedCount: 0,
    cachedCount: 0,
    batchCount: 0,
    batchesDone: 0,
    batches: [],
    activeMs: 0,
    originalTitle: (document.title || '').trim(),
    translatedTitle: (document.title || '').trim(),
    previewText: ''
  };

  pushProgress();

  let titlePromise = Promise.resolve();

  try {
    // 텍스트 노드 수집
    const textNodes = getAllTextNodes();
    const { texts, elements } = extractTexts(textNodes);

    logDebug('TEXT_NODES_COLLECTED', '텍스트 노드 수집 완료', {
      textNodes: textNodes.length,
      texts: texts.length
    });

    progressStatus.totalTexts = texts.length;
    pushProgress();

    await ensureIndustryContext(texts, apiKey, model);

    titlePromise = translateDocumentTitle(apiKey, model, useCache, progressStatus.originalTitle);

    // 캐시 확인 및 분류
    const cachedItems = [];
    const newTexts = [];
    const newElements = [];

    if (useCache) {
      // 병렬로 캐시 조회
      const cachePromises = texts.map((text, i) => {
        const element = elements[i];

        if (translatedElements.has(element)) {
          progressStatus.translatedCount++;
          return null;
        }

        return getCachedTranslation(text).then(cached => ({
          index: i,
          element,
          text,
          cached
        }));
      });

      const cacheResults = await Promise.all(cachePromises);

      for (const result of cacheResults) {
        if (!result) continue; // 이미 번역된 요소

        if (result.cached) {
          cachedItems.push({
            element: result.element,
            text: result.text,
            translation: result.cached
          });
        } else {
          newTexts.push(result.text);
          newElements.push(result.element);
        }
      }
    } else {
      for (let i = 0; i < texts.length; i++) {
        if (!translatedElements.has(elements[i])) {
          newTexts.push(texts[i]);
          newElements.push(elements[i]);
        } else {
          progressStatus.translatedCount++;
        }
      }
    }

    progressStatus.cachedCount = cachedItems.length;
    pushProgress();

    // CACHE_STATS 로깅
    logInfo('CACHE_STATS', '캐시 조회 완료', {
      hits: cachedItems.length,
      misses: newTexts.length,
      total: texts.length,
      ttlMin: await getTTL()
    });

    // 대규모 변경 확인 (≥20% 변경 시 자동 전면 재번역)
    if (useCache && texts.length > 0) {
      const changeRate = newTexts.length / texts.length;
      if (changeRate >= 0.20) {
        logInfo('AUTO_FULL_RETRANSLATE', '대규모 페이지 변경 감지, 전면 재번역', {
          changeRate: Math.round(changeRate * 100) / 100,
          threshold: 0.2
        });

        // 전면 재번역으로 전환
        newTexts.length = 0;
        newElements.length = 0;
        cachedItems.length = 0;

        for (let i = 0; i < texts.length; i++) {
          if (!translatedElements.has(elements[i])) {
            newTexts.push(texts[i]);
            newElements.push(elements[i]);
          }
        }

        progressStatus.cachedCount = 0;
        pushProgress();
      }
    }

    // 캐시 적용 (배치로 나눠서 진행 상황 표시)
    if (cachedItems.length > 0) {
      // 캐시도 배치로 분할
      const cacheBatches = [];
      for (let i = 0; i < cachedItems.length; i += batchSize) {
        cacheBatches.push({
          items: cachedItems.slice(i, i + batchSize),
          status: 'pending',
          size: Math.min(batchSize, cachedItems.length - i)
        });
      }

      // 전체 배치 계획에 추가
      const totalBatches = cacheBatches.length + Math.ceil(newTexts.length / batchSize);
      progressStatus.batchCount = totalBatches;
      progressStatus.batches = cacheBatches.map((b, i) => ({
        index: i,
        size: b.size,
        status: 'pending'
      }));

      // 캐시 배치 적용
      for (let i = 0; i < cacheBatches.length; i++) {
        // 번역 취소 상태 체크
        if (translationState.state === 'cancelled') {
          logInfo('CACHE_APPLY_CANCELLED', '번역 취소로 인해 캐시 적용 중단', {
            completedBatches: i,
            totalCacheBatches: cacheBatches.length
          });
          break;
        }

        progressStatus.batches[i].status = 'processing';
        pushProgress();

        await new Promise(resolve => {
          requestAnimationFrame(() => {
            cacheBatches[i].items.forEach(({ element, text, translation }) => {
              if (!originalTexts.has(element)) {
                originalTexts.set(element, element.textContent);
              }
              element.textContent = translation;
              capturePreviewFromTranslation(translation);
              translatedElements.add(element);
              progressStatus.translatedCount++;
            });

            progressStatus.batches[i].status = 'completed';
            progressStatus.batchesDone++;
            WPT.Progress.pushProgress();
            resolve();
          });
        });
      }

      logInfo('CACHE_APPLY', '캐시 적용 완료', {
        batches: cacheBatches.length,
        items: cachedItems.length
      });
    }

    // 신규 번역 처리
    if (newTexts.length > 0) {
      // 배치 생성
      const batches = [];
      for (let i = 0; i < newTexts.length; i += batchSize) {
        batches.push({
          texts: newTexts.slice(i, i + batchSize),
          elements: newElements.slice(i, i + batchSize),
          status: 'pending',
          size: Math.min(batchSize, newTexts.length - i)
        });
      }

      // 캐시 배치 인덱스 오프셋 계산
      const cacheOffset = progressStatus.batches.length;

      // 전체 배치 수 업데이트
      progressStatus.batchCount = cacheOffset + batches.length;

      // 신규 번역 배치를 기존 배치 배열에 추가
      const newBatchInfo = batches.map((b, i) => ({
        index: cacheOffset + i,
        size: b.size,
        status: 'pending'
      }));
      progressStatus.batches.push(...newBatchInfo);
      pushProgress();

      // BATCH_PLAN 로깅
      logInfo('BATCH_PLAN', '배치 계획 생성', {
        totalTexts: newTexts.length,
        batchSize,
        concurrency,
        batches: batches.length
      });

      // DOM 적용 순서를 보장하면서도 준비된 배치는 즉시 반영하기 위한 포인터
      let nextDomIndex = 0;
      let isFlushing = false;
      let flushRequested = false;

      /**
       * 준비가 완료된 배치를 순차적으로 DOM에 적용하는 헬퍼
       * - batch.translations === undefined: 아직 번역 대기 → 대기
       * - batch.translations === null: 번역 실패 → 건너뛰고 다음 배치로 진행
       */
      const flushReadyBatches = async () => {
        if (isFlushing) {
          flushRequested = true;
          return;
        }

        isFlushing = true;
        flushRequested = false;

        try {
          while (nextDomIndex < batches.length) {
            const targetBatch = batches[nextDomIndex];

            if (targetBatch.applied) {
              nextDomIndex++;
              continue;
            }

            // 번역 결과가 아직 없는 경우 즉시 종료하고 다음 완료 시점에 재시도
            if (typeof targetBatch.translations === 'undefined') {
              break;
            }

            // 번역 실패 배치 → DOM 적용 없이 건너뜀
            if (targetBatch.translations === null) {
              targetBatch.applied = true;
              nextDomIndex++;
              continue;
            }

            await applyTranslationsToDom(targetBatch, useCache, cacheOffset + nextDomIndex, model);
            targetBatch.applied = true;
            nextDomIndex++;
          }
        } finally {
          isFlushing = false;
          if (flushRequested) {
            await flushReadyBatches();
          }
        }
      };

      // 병렬 배치 처리 (API 호출)
      const processQueue = async () => {
        let index = 0;

        const worker = async () => {
          while (index < batches.length) {
            // 번역 취소 상태 체크
            if (translationState.state === 'cancelled') {
              logInfo('BATCH_CANCELLED', '번역 취소로 인해 배치 처리 중단', {
                remainingBatches: batches.length - index
              });
              break;
            }

            const localIndex = index++;
            const batch = batches[localIndex];
            const globalIndex = cacheOffset + localIndex; // 전역 배치 인덱스

            // 배치 상태 업데이트
            progressStatus.batches[globalIndex].status = 'processing';
            WPT.Progress.pushProgress();

            WPT.Progress.onBatchStart();

            try {
              // API 호출 실행 후 즉시 결과 저장
              const translations = await translateBatch(batch, apiKey, model);
              batch.translations = translations;
              progressStatus.batches[globalIndex].status = 'completed';
              progressStatus.batchesDone++;
            } catch (error) {
              console.error(`Batch ${globalIndex + 1} failed:`, error);
              batch.translations = null; // 실패 표시
              progressStatus.batches[globalIndex].status = 'failed';
              progressStatus.batchesDone++;
            }

            WPT.Progress.onBatchEnd();
            pushProgress();
            await flushReadyBatches();
          }
        };

        const workers = Array.from({ length: Math.min(concurrency, batches.length) }, () => worker());
        await Promise.all(workers);
      };

      await processQueue();
      await flushReadyBatches();
    }

    // 완료
    await titlePromise.catch((error) => {
      logWarn('TITLE_TRANSLATE_DEFER_FAIL', '제목 번역 비동기 처리 실패', {}, error);
    });

    // 번역 취소 상태라면 완료 상태로 업데이트 하지 않음
    if (translationState.state !== 'cancelled') {
      translationState = 'completed';
      progressStatus.state = 'completed';
      pushProgress();
    }

    // 완료 요약 로깅
    logInfo('TRANSLATION_COMPLETED', '번역 완료', {
      totalTexts: progressStatus.totalTexts,
      translated: progressStatus.translatedCount,
      cacheHits: progressStatus.cachedCount,
      elapsedMs: Math.round(WPT.Progress.getActiveMs ? WPT.Progress.getActiveMs() : 0),
      batches: progressStatus.batchCount
    });

  } catch (error) {
    logError('TRANSLATION_ERROR', '번역 실패', {
      totalTexts: progressStatus.totalTexts,
      translated: progressStatus.translatedCount
    }, error);

    translationState = 'inactive';
    progressStatus.state = 'error';
    pushProgress();
  }
}

/**
 * 배치 번역 (API 호출만, DOM 적용은 별도)
 * @param {object} batch - 배치 객체 { texts, elements }
 * @param {string} apiKey - OpenRouter API Key
 * @param {string} model - AI 모델
 * @returns {Promise<Array<string>>} 번역 결과 배열
 */
async function translateBatch(batch, apiKey, model) {
  const batchIdx = progressStatus.batchesDone;

  logDebug('BATCH_START', '배치 번역 시작', {
    batchIdx,
    count: batch.texts.length
  });

  try {
    // API 호출
    const translations = await translateWithOpenRouter(batch.texts, apiKey, model);
    return translations;

  } catch (error) {
    logError('BATCH_ERROR', '배치 번역 실패', { batchIdx }, error);
    throw error;
  }
}

/**
 * DOM 적용 (순서 보장)
 * requestAnimationFrame을 사용하여 위에서 아래로 순차 적용
 * @param {object} batch - 배치 객체 { texts, elements, translations }
 * @param {boolean} useCache - 캐시 저장 여부
 * @param {number} batchIdx - 배치 인덱스 (로깅용)
 * @param {string} model - AI 모델 (캐시 저장용)
 */
async function applyTranslationsToDom(batch, useCache, batchIdx, model) {
  let applied = 0;
  let skipped = 0;

  await new Promise(resolve => {
    requestAnimationFrame(() => {
      batch.elements.forEach((element, idx) => {
        const translation = batch.translations[idx];
        if (translation && translation !== null) {
          const originalText = batch.texts[idx];

          if (!originalTexts.has(element)) {
            originalTexts.set(element, element.textContent);
          }

          element.textContent = translation;
          capturePreviewFromTranslation(translation);
          applied++;
          translatedElements.add(element);
          progressStatus.translatedCount++;

          // 캐시에 저장
          if (useCache) {
            setCachedTranslation(originalText, translation, model);
          }
        } else {
          skipped++;
        }
      });

      // DOM_APPLY 로깅
      logDebug('DOM_APPLY', '번역 DOM 적용 완료', {
        batchIdx,
        applied,
        skipped,
        mode: useCache ? 'fast' : 'fresh'
      });

      pushProgress();
      resolve();
    });
  });
}

/**
 * 번역된 텍스트에서 히스토리 프리뷰를 한 번만 포착한다.
 * @param {string} translation - 적용된 번역 텍스트
 */
function capturePreviewFromTranslation(translation) {
  if (progressStatus.previewText && progressStatus.previewText.length > 0) {
    return;
  }

  if (typeof translation !== 'string') {
    return;
  }

  const normalized = translation.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return;
  }

  progressStatus.previewText = normalized.slice(0, 120);
}

/**
 * 페이지 제목을 별도로 번역하여 히스토리 정보에 활용한다.
 * @param {string} apiKey - OpenRouter API Key
 * @param {string} model - 번역에 사용할 모델
 * @param {boolean} useCache - 캐시 활용 여부 (빠른 모드 여부)
 * @param {string} originalTitle - 번역 전 페이지 제목
 * @returns {Promise<void>} 제목 번역 완료 시 resolve되는 Promise
 */
async function translateDocumentTitle(apiKey, model, useCache, originalTitle) {
  try {
    if (!originalTitle) {
      progressStatus.originalTitle = '';
      progressStatus.translatedTitle = '';
      return;
    }

    progressStatus.originalTitle = originalTitle;
    progressStatus.translatedTitle = originalTitle;

    if (useCache) {
      const cached = await getCachedTranslation(originalTitle);
      if (cached && cached.trim().length > 0) {
        applyTranslatedTitleToDocument(cached.trim());
        pushProgress();
        return;
      }
    }

    const translations = await translateWithOpenRouter([originalTitle], apiKey, model);
    const translated = translations && translations[0] ? translations[0].trim() : '';
    const finalTitle = translated.length > 0 ? translated : originalTitle;

    applyTranslatedTitleToDocument(finalTitle);

    if (useCache && finalTitle !== originalTitle) {
      await setCachedTranslation(originalTitle, finalTitle, model);
    }

    pushProgress();
  } catch (error) {
    logWarn('TITLE_TRANSLATE_FAIL', '페이지 제목 번역 실패', { length: originalTitle?.length || 0 }, error);
    applyTranslatedTitleToDocument(originalTitle || document.title || '');
    pushProgress();
  }
}

// ===== OpenRouter API 통신 =====

/**
 * OpenRouter API 호출을 공통 처리하는 헬퍼
 * @param {string} prompt - 모델에 전달할 프롬프트
 * @param {string} apiKey - OpenRouter API Key
 * @param {string} model - 사용할 모델 이름
 * @param {object} meta - 로깅을 위한 부가 정보
 * @param {string} meta.purpose - 호출 목적 식별자
 * @param {number} [meta.batchIdx] - 번역 배치 인덱스
 * @param {number} [meta.itemCount] - 처리 대상 텍스트 개수
 * @returns {Promise<string>} 모델 응답 텍스트
 */
async function requestOpenRouter(prompt, apiKey, model, meta = {}) {
  const reqId = Math.random().toString(36).substring(7);
  const purpose = meta.purpose || 'translation';
  const batchIdx = typeof meta.batchIdx === 'number' ? meta.batchIdx : null;
  const itemCount = typeof meta.itemCount === 'number' ? meta.itemCount : null;
  const tokenEstimate = Math.round(prompt.length / 4);

  const startTime = performance.now();
  let attempts = 0;

  logInfo('API_REQUEST_START', 'API 요청 시작', {
    reqId,
    purpose,
    batchIdx,
    model,
    itemCount,
    tokenEstimate,
    maxAttempts: API_RETRY_MAX_ATTEMPTS
  });

  try {
    const responseText = await executeWithRetry(async (attempt) => {
      attempts = attempt;
      const attemptStart = performance.now();

      logDebug('API_REQUEST_ATTEMPT', 'API 요청 실행', {
        reqId,
        purpose,
        batchIdx,
        attempt
      });

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': window.location.href,
          'X-Title': 'Web Page Translator'
        },
        body: JSON.stringify({
          model,
          messages: [{
            role: 'user',
            content: prompt
          }]
        })
      });

      const attemptDurationMs = Math.round(performance.now() - attemptStart);

      if (!response.ok) {
        const error = new Error(`API error: ${response.statusText}`);
        error.status = response.status;
        error.retryable = response.status >= 500 || response.status === 429;

        logWarn('API_REQUEST_ATTEMPT', 'API 응답 오류', {
          reqId,
          purpose,
          batchIdx,
          attempt,
          status: response.status,
          durationMs: attemptDurationMs
        }, error);

        throw error;
      }

      const data = await response.json();

      logDebug('API_REQUEST_ATTEMPT', 'API 요청 성공', {
        reqId,
        purpose,
        batchIdx,
        attempt,
        durationMs: attemptDurationMs
      });

      return data.choices?.[0]?.message?.content || '';
    }, {
      maxAttempts: API_RETRY_MAX_ATTEMPTS,
      baseDelayMs: API_RETRY_BASE_DELAY_MS,
      backoffFactor: API_RETRY_BACKOFF_FACTOR
    });

    const durationMs = Math.round(performance.now() - startTime);

    logInfo('API_REQUEST_END', 'API 요청 완료', {
      reqId,
      purpose,
      batchIdx,
      durationMs,
      attempts
    });

    return responseText;
  } catch (error) {
    const durationMs = Math.round(performance.now() - startTime);

    logError('API_REQUEST_END', 'API 요청 에러', {
      reqId,
      purpose,
      batchIdx,
      durationMs,
      attempts
    }, error);

    throw error;
  }
}

/**
 * 번역된 제목을 document.title과 progressStatus에 반영한다.
 * @param {string} titleText - 최종 적용할 제목 텍스트
 */
function applyTranslatedTitleToDocument(titleText) {
  if (typeof titleText !== 'string') {
    return;
  }

  const normalized = titleText.trim();
  progressStatus.translatedTitle = normalized;

  if (!normalized) {
    return;
  }

  if (document.title !== normalized) {
    document.title = normalized;
  }

  const titleElement = document.querySelector('title');
  if (titleElement && titleElement.textContent !== normalized) {
    titleElement.textContent = normalized;
  }
}

/**
 * 지연을 통해 재시도 간격을 구현하기 위한 Promise 래퍼
 * @param {number} delayMs - 대기할 시간(ms)
 * @returns {Promise<void>} 지정 시간 이후 resolve되는 Promise
 */
function wait(delayMs) {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

/**
 * 네트워크 요청 재시도를 일관되게 처리하는 헬퍼
 * @param {(attempt: number) => Promise<any>} asyncTask - 시도 횟수를 입력받아 실행되는 비동기 함수
 * @param {object} [options={}] - 재시도 동작 설정
 * @param {number} [options.maxAttempts=API_RETRY_MAX_ATTEMPTS] - 최대 시도 횟수
 * @param {number} [options.baseDelayMs=API_RETRY_BASE_DELAY_MS] - 첫 번째 재시도 대기 시간(ms)
 * @param {number} [options.backoffFactor=API_RETRY_BACKOFF_FACTOR] - 재시도마다 곱해지는 지수 백오프 계수
 * @returns {Promise<any>} asyncTask에서 반환된 값
 */
async function executeWithRetry(asyncTask, {
  maxAttempts = API_RETRY_MAX_ATTEMPTS,
  baseDelayMs = API_RETRY_BASE_DELAY_MS,
  backoffFactor = API_RETRY_BACKOFF_FACTOR
} = {}) {
  let attempt = 0;
  let lastError = null;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      return await asyncTask(attempt);
    } catch (error) {
      lastError = error;

      const isNetworkError = error instanceof TypeError || (typeof error?.message === 'string' && error.message.includes('Failed to fetch'));
      const isExplicitRetryable = error?.retryable === true;
      const isExplicitNonRetryable = error?.retryable === false;
      const shouldRetry = attempt < maxAttempts && !isExplicitNonRetryable && (isExplicitRetryable || isNetworkError);

      if (!shouldRetry) {
        throw error;
      }

      const delayMs = baseDelayMs * Math.pow(backoffFactor, attempt - 1);

      logWarn('API_REQUEST_RETRY', 'API 요청 재시도', {
        attempt,
        maxAttempts,
        delayMs
      }, error);

      await wait(delayMs);
    }
  }

  throw lastError;
}

/**
 * OpenRouter API를 사용한 배치 번역
 *
 * 프롬프트 형식:
 * - 입력: [0] text1\n[1] text2\n...
 * - 출력: [0] 번역1\n[1] 번역2\n...
 *
 * @param {Array<string>} texts - 번역할 텍스트 배열
 * @param {string} apiKey - OpenRouter API Key
 * @param {string} model - AI 모델 (예: openai/gpt-4o-mini)
 * @returns {Promise<Array<string>>} 번역 결과 배열
 */
async function translateWithOpenRouter(texts, apiKey, model) {
  const batchIdx = progressStatus.batchesDone;
  const instruction = buildIndustryInstruction(industryContext);

  const prompt = `다음 텍스트들을 한국어로 번역해주세요.

번역할 텍스트:
${texts.map((text, idx) => `[${idx}] ${text}`).join('\n')}

산업군 컨텍스트:
${instruction}

중요:
- 각 줄을 [0], [1], [2] ... 형식으로 번호를 붙여서 번역 결과를 반환해주세요.
- 원본의 형식과 구조를 최대한 유지하되, 내용만 한국어로 번역해주세요.
- 번역만 제공하고 다른 설명은 추가하지 마세요.
- HTML 태그가 있다면 그대로 유지해주세요.`;

  const translatedText = await requestOpenRouter(prompt, apiKey, model, {
    purpose: 'translation',
    batchIdx,
    itemCount: texts.length
  });

  return parseTranslationResult(translatedText, texts.length);
}

/**
 * 번역 결과 파싱
 * [0], [1] 형식의 출력을 배열로 변환
 * 매핑 실패 시 fallback 적용 (50% 미만 매핑 시)
 *
 * @param {string} translatedText - API 응답 텍스트
 * @param {number} expectedCount - 예상 결과 개수
 * @returns {Array<string>} 번역 결과 배열 (실패 시 null 포함)
 */
function parseTranslationResult(translatedText, expectedCount) {
  const lines = translatedText.split('\n').filter(line => line.trim());
  const translationMap = new Map();

  // [0], [1] 형식 파싱
  lines.forEach(line => {
    const match = line.match(/^\[(\d+)\]\s*(.+)$/);
    if (match) {
      const index = parseInt(match[1]);
      const translation = match[2].trim();
      translationMap.set(index, translation);
    }
  });

  // 배열로 변환
  const translations = [];
  for (let i = 0; i < expectedCount; i++) {
    translations[i] = translationMap.get(i) || null;
  }

  // 매핑 실패 시 fallback
  const mappedCount = translations.filter(t => t !== null).length;
  if (mappedCount < expectedCount * 0.5) {
    log(`Translation mapping failed (${mappedCount}/${expectedCount}), using fallback`);
    const fallbackLines = translatedText.split('\n')
      .map(line => line.replace(/^\[\d+\]\s*/, '').trim())
      .filter(line => line.length > 0);

    return fallbackLines.slice(0, expectedCount).concat(
      Array(Math.max(0, expectedCount - fallbackLines.length)).fill(null)
    );
  }

  return translations;
}

// ===== 원본 복원 =====

/**
 * 원본 텍스트 복원
 * WeakMap에 저장된 원본 텍스트를 모든 번역 요소에 적용
 */
function handleRestoreOriginal() {
  log('Restoring original texts...');

  translatedElements.forEach(element => {
    if (element && originalTexts.has(element)) {
      const originalText = originalTexts.get(element);
      element.textContent = originalText;
    }
  });

  originalTexts = new WeakMap();
  translatedElements.clear();

  if (progressStatus.originalTitle) {
    applyTranslatedTitleToDocument(progressStatus.originalTitle);
  }

  translationState = 'restored';
  progressStatus.state = 'restored';
  progressStatus.translatedCount = 0;
  progressStatus.previewText = '';
  progressStatus.translatedTitle = progressStatus.originalTitle;

  pushProgress();
}

// ===== DOM 텍스트 노드 수집 =====

/**
 * 페이지의 모든 번역 가능한 텍스트 노드 수집
 *
 * 제외 태그: SCRIPT, STYLE, NOSCRIPT, IFRAME, SVG, CANVAS, CODE, PRE
 * 필터링: 빈 텍스트, 2000자 초과 텍스트
 *
 * @returns {Array<Node>} 텍스트 노드 배열
 */
function getAllTextNodes() {
  const EXCLUDE_TAGS = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG', 'CANVAS', 'CODE', 'PRE'];
  const nodes = [];

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        if (!node.parentElement) {
          return NodeFilter.FILTER_REJECT;
        }

        // 제외할 태그
        const tagName = node.parentElement.tagName;
        if (EXCLUDE_TAGS.includes(tagName)) {
          return NodeFilter.FILTER_REJECT;
        }

        // 상위 요소 확인
        let current = node.parentElement;
        while (current && current !== document.body) {
          if (EXCLUDE_TAGS.includes(current.tagName)) {
            return NodeFilter.FILTER_REJECT;
          }
          current = current.parentElement;
        }

        const text = (node.textContent || '').trim();
        if (!text || text.length === 0) {
          return NodeFilter.FILTER_REJECT;
        }

        // 최대 텍스트 길이 제한
        if (text.length > 2000) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let currentNode;
  while (currentNode = walker.nextNode()) {
    nodes.push(currentNode);
  }

  return nodes;
}

/**
 * 텍스트 노드에서 텍스트 및 요소 추출
 * @param {Array<Node>} textNodes - 텍스트 노드 배열
 * @returns {{texts: Array<string>, elements: Array<Node>}}
 */
function extractTexts(textNodes) {
  const texts = [];
  const elements = [];

  textNodes.forEach(node => {
    const text = node.textContent.trim();
    if (text && text.length > 0) {
      texts.push(text);
      elements.push(node);
    }
  });

  return { texts, elements };
}

// ===== IndexedDB 캐시 시스템 =====
/**
 * 번역 캐시 시스템 (IndexedDB 기반)
 *
 * 구조:
 * - 키: SHA1(normalize(text))
 * - 값: { translation, ts, model }
 * - TTL: 기본 30일 (설정 변경 가능)
 *
 * 특징:
 * - 해시 재검증으로 DOM 변경 감지
 * - 대규모 변경(≥20%) 시 자동 전면 재번역
 * - 만료된 캐시는 자동 무시
 */

/**
 * IndexedDB 열기
 * @returns {Promise<IDBDatabase>}
 */
async function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'hash' });
      }
    };
  });
}

/**
 * SHA1 해시 생성 (캐시 키로 사용)
 * @param {string} text - 원본 텍스트
 * @returns {Promise<string>} SHA1 해시 (hex)
 */
async function sha1Hash(text) {
  const normalized = normalizeText(text);
  const msgBuffer = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-1', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 텍스트 정규화 (공백 및 줄바꿈 처리)
 * @param {string} text - 원본 텍스트
 * @returns {string} 정규화된 텍스트
 */
function normalizeText(text) {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

/**
 * TTL 가져오기 (storage에서 설정 로드)
 * @returns {Promise<number>} TTL (밀리초)
 */
async function getTTL() {
  try {
    const result = await chrome.storage.local.get(['cacheTTL']);
    return (result.cacheTTL || DEFAULT_TTL_MINUTES) * 60 * 1000;
  } catch (error) {
    console.error('Failed to get TTL:', error);
    return DEFAULT_TTL_MINUTES * 60 * 1000;
  }
}

/**
 * 캐시 저장
 * @param {string} text - 원본 텍스트
 * @param {string} translation - 번역 텍스트
 * @param {string} model - AI 모델
 */
async function setCachedTranslation(text, translation, model) {
  try {
    const db = await openDB();
    const hash = await sha1Hash(text);
    const ts = Date.now();

    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    await store.put({
      hash,
      translation,
      ts,
      model
    });

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });

    db.close();
  } catch (error) {
    console.error('Failed to set cache:', error);
  }
}

/**
 * 캐시 가져오기 (TTL 검증 포함)
 * @param {string} text - 원본 텍스트
 * @returns {Promise<string|null>} 번역 텍스트 (캐시 없거나 만료 시 null)
 */
async function getCachedTranslation(text) {
  try {
    const db = await openDB();
    const hash = await sha1Hash(text);
    const ttl = await getTTL();

    const tx = db.transaction([STORE_NAME], 'readonly');
    const store = tx.objectStore(STORE_NAME);

    const result = await new Promise((resolve, reject) => {
      const request = store.get(hash);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    db.close();

    if (!result) {
      return null;
    }

    const now = Date.now();
    if (now - result.ts > ttl) {
      return null; // 만료
    }

    return result.translation;
  } catch (error) {
    console.error('Failed to get cache:', error);
    return null;
  }
}

/**
 * 전역 캐시 비우기
 * @returns {Promise<boolean>}
 */
async function clearAllCache() {
  try {
    const db = await openDB();
    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    // store.clear()는 IDBRequest를 반환하므로 Promise로 래핑
    await new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });

    // 트랜잭션 완료 대기
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });

    db.close();
    log('All cache cleared');
    return true;
  } catch (error) {
    logError('Failed to clear cache:', error);
    return false;
  }
}

/**
 * 페이지 캐시 비우기
 * @returns {Promise<boolean>}
 */
async function clearPageCache() {
  return await clearAllCache();
}

/**
 * 현재 페이지(도메인)의 캐시 상태 조회
 * Sidepanel에서 요청할 때 사용
 * @returns {Promise<{success: boolean, count: number, size: number, error?: string}>}
 */
async function getCacheStatus() {
  try {
    const db = await openDB();
    const tx = db.transaction([STORE_NAME], 'readonly');
    const store = tx.objectStore(STORE_NAME);

    // 모든 캐시 항목 조회
    const result = await new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const items = request.result;
        let totalSize = 0;

        items.forEach(item => {
          totalSize += JSON.stringify(item).length;
        });

        resolve({ success: true, count: items.length, size: totalSize });
      };
      request.onerror = () => reject(request.error);
    });

    db.close();
    return result;
  } catch (error) {
    logError('CACHE_STATUS_ERROR', '캐시 상태 조회 실패', {}, error);
    return { success: false, count: 0, size: 0, error: error.message };
  }
}

/**
 * 현재 페이지(도메인)의 캐시 비우기 핸들러
 * Sidepanel의 "이 페이지 캐시 비우기" 버튼에서 호출
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function handleClearCacheForDomain() {
  try {
    const success = await clearPageCache();
    if (success) {
      logInfo('CACHE_CLEARED', '현재 도메인 캐시 삭제 완료');
      return { success: true };
    } else {
      return { success: false, error: '캐시 삭제 실패' };
    }
  } catch (error) {
    logError('CACHE_CLEAR_ERROR', '캐시 삭제 중 오류 발생', {}, error);
    return { success: false, error: error.message };
  }
}

// ===== 내부 모듈 노출 (네임스페이스) =====
try {
  WPT.Api = Object.assign({}, WPT.Api || {}, {
    executeWithRetry,
    requestOpenRouter,
    wait
  });

  WPT.Cache = Object.assign({}, WPT.Cache || {}, {
    openDB,
    getTTL,
    getCachedTranslation,
    setCachedTranslation,
    clearAllCache,
    clearPageCache,
    getCacheStatus,
    handleClearCacheForDomain
  });

  WPT.Progress = Object.assign({}, WPT.Progress || {}, {
    pushProgress
  });

  WPT.Industry = Object.assign({}, WPT.Industry || {}, {
    ensureIndustryContext
  });
} catch (_) {
  // 네임스페이스 노출 실패는 동작에 영향 없음
}

// ===== 초기화 =====

logDebug('CONTENT_LOADED', 'Content script 로드 완료');

// Background에 준비 완료 알림
chrome.runtime.sendMessage({ type: 'CONTENT_READY' }).catch(() => {
  // Background가 아직 준비되지 않았을 수 있음 (무시)
});

} // 중복 주입 방지 if 블록 종료
