// 전역 상태
let translationState = 'inactive'; // 'inactive', 'translating', 'completed', 'restored'
let originalTexts = new WeakMap(); // 원본 텍스트 저장
let translatedElements = new Set(); // 번역된 요소 추적

// IndexedDB 캐시 설정
const DB_NAME = 'TranslationCache';
const DB_VERSION = 1;
const STORE_NAME = 'translations';
const DEFAULT_TTL_MINUTES = 60;

// ===== 로깅 시스템 =====
const LEVEL_MAP = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
let currentLogLevel = 'INFO';

// 초기화: storage에서 설정 로드
(async () => {
  try {
    const result = await chrome.storage.local.get(['debugLog']);
    currentLogLevel = result.debugLog ? 'DEBUG' : 'INFO';
  } catch (error) {
    // storage 접근 실패 시 기본값 유지
  }
})();

// 설정 변경 감지
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.debugLog) {
    currentLogLevel = changes.debugLog.newValue ? 'DEBUG' : 'INFO';
  }
});

// 민감정보 마스킹
function maskSensitive(data) {
  if (!data || typeof data !== 'object') return data;
  const masked = { ...data };
  if (masked.apiKey) masked.apiKey = masked.apiKey.substring(0, 8) + '***';
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

// 로그 출력
function log(level, evt, msg = '', data = {}, err = null) {
  if (level === 'DEBUG' && LEVEL_MAP[level] < LEVEL_MAP[currentLogLevel]) return;

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

const logDebug = (evt, msg, data, err) => log('DEBUG', evt, msg, data, err);
const logInfo = (evt, msg, data, err) => log('INFO', evt, msg, data, err);
const logWarn = (evt, msg, data, err) => log('WARN', evt, msg, data, err);
const logError = (evt, msg, data, err) => log('ERROR', evt, msg, data, err);

// 진행 상태
let progressStatus = {
  state: 'inactive',
  totalTexts: 0,
  translatedCount: 0,
  cachedCount: 0,
  batchCount: 0,
  batchesDone: 0,
  batches: [],
  activeMs: 0
};

// 타이머 관련
let activeMs = 0;
let lastTick = null;
let timerId = null;
let inflight = 0;

// Port 연결
let port = null;

// Port 연결 리스너
chrome.runtime.onConnect.addListener((p) => {
  if (p.name === 'panel') {
    port = p;
    log('Side panel connected');

    // 현재 상태 즉시 푸시
    pushProgress();

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
      port = null;
    });
  }
});

// 타이머 시작
function startTimer() {
  if (timerId) return;
  lastTick = performance.now();
  timerId = setInterval(() => {
    const now = performance.now();
    activeMs += (now - lastTick);
    lastTick = now;
    pushProgress(); // 1초마다 푸시
  }, 1000);
  logDebug('TIMER_START', '번역 타이머 시작');
}

// 타이머 정지
function stopTimer() {
  if (!timerId) return;
  clearInterval(timerId);
  if (lastTick) {
    activeMs += performance.now() - lastTick;
  }
  timerId = null;
  lastTick = null;
  pushProgress();
  logDebug('TIMER_STOP', '번역 타이머 정지', { totalMs: Math.round(activeMs) });
}

// 배치 시작
function onBatchStart() {
  inflight++;
  if (inflight === 1) {
    startTimer();
  }
}

// 배치 완료
function onBatchEnd() {
  inflight--;
  if (inflight === 0) {
    stopTimer();
  }
}

// 진행 상태 푸시
function pushProgress() {
  if (!port) return;

  try {
    port.postMessage({
      type: 'progress',
      data: {
        ...progressStatus,
        activeMs
      }
    });
    // chrome.runtime.lastError를 확인하여 에러를 조용히 처리
    if (chrome.runtime.lastError) {
      // Port가 이미 끊어진 경우 조용히 처리
      port = null;
    }
  } catch (error) {
    // Port 연결 끊김 등의 에러는 조용히 처리
    port = null;
    logDebug('PUSH_PROGRESS_ERROR', 'Port 메시지 전송 실패 (연결 끊김)', {
      error: error.message
    });
  }
}

// 메시지 리스너
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // PING: Content script 준비 상태 확인
  if (request.type === 'PING') {
    sendResponse({ ok: true });
    return true;
  }

  if (request.action === 'translateFullPage') {
    handleTranslateFullPage(request.apiKey, request.model, request.batchSize, request.concurrency, request.useCache);
    sendResponse({ success: true });
  } else if (request.action === 'restoreOriginal') {
    handleRestoreOriginal();
    sendResponse({ success: true });
  } else if (request.action === 'getTranslationState') {
    sendResponse({ state: translationState });
  } else if (request.action === 'clearAllCache') {
    clearAllCache().then(() => sendResponse({ success: true }));
    return true;
  } else if (request.action === 'clearPageCache') {
    clearPageCache().then(() => sendResponse({ success: true }));
    return true;
  }
  return true;
});

// 전체 페이지 번역
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

  progressStatus = {
    state: 'translating',
    totalTexts: 0,
    translatedCount: 0,
    cachedCount: 0,
    batchCount: 0,
    batchesDone: 0,
    batches: [],
    activeMs: 0
  };

  pushProgress();

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
        progressStatus.batches[i].status = 'processing';
        pushProgress();

        await new Promise(resolve => {
          requestAnimationFrame(() => {
            cacheBatches[i].items.forEach(({ element, text, translation }) => {
              if (!originalTexts.has(element)) {
                originalTexts.set(element, element.textContent);
              }
              element.textContent = translation;
              translatedElements.add(element);
              progressStatus.translatedCount++;
            });

            progressStatus.batches[i].status = 'completed';
            progressStatus.batchesDone++;
            pushProgress();
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

      // 병렬 배치 처리 (API 호출만)
      const processQueue = async () => {
        let index = 0;

        const worker = async () => {
          while (index < batches.length) {
            const localIndex = index++;
            const batch = batches[localIndex];
            const globalIndex = cacheOffset + localIndex; // 전역 배치 인덱스

            // 배치 상태 업데이트
            progressStatus.batches[globalIndex].status = 'processing';
            pushProgress();

            onBatchStart();

            try {
              // API 호출만 수행, DOM 적용은 나중에
              const translations = await translateBatch(batch, apiKey, model);
              batch.translations = translations; // 결과 저장
              progressStatus.batches[globalIndex].status = 'completed';
              progressStatus.batchesDone++;
            } catch (error) {
              console.error(`Batch ${globalIndex + 1} failed:`, error);
              batch.translations = null; // 실패 표시
              progressStatus.batches[globalIndex].status = 'failed';
              progressStatus.batchesDone++;
            }

            onBatchEnd();
            pushProgress();
          }
        };

        const workers = Array.from({ length: Math.min(concurrency, batches.length) }, () => worker());
        await Promise.all(workers);
      };

      await processQueue();

      // 순차적으로 DOM 적용 (위에서 아래로)
      for (let localIndex = 0; localIndex < batches.length; localIndex++) {
        const batch = batches[localIndex];
        const globalIndex = cacheOffset + localIndex;

        if (batch.translations) {
          await applyTranslationsToDom(batch, useCache, globalIndex, model);
        }
      }
    }

    // 완료
    translationState = 'completed';
    progressStatus.state = 'completed';
    pushProgress();

    // 완료 요약 로깅
    logInfo('TRANSLATION_COMPLETED', '번역 완료', {
      totalTexts: progressStatus.totalTexts,
      translated: progressStatus.translatedCount,
      cacheHits: progressStatus.cachedCount,
      elapsedMs: Math.round(activeMs),
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

// 배치 번역 (API 호출만)
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

// DOM 적용 (순서 보장)
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

// OpenRouter API 번역
async function translateWithOpenRouter(texts, apiKey, model) {
  const reqId = Math.random().toString(36).substring(7);
  const batchIdx = progressStatus.batchesDone;
  const tokenEstimate = texts.join(' ').length / 4; // 대략적인 토큰 추정

  // API_REQUEST_START 로깅
  const startTime = performance.now();
  logInfo('API_REQUEST_START', 'API 요청 시작', {
    reqId,
    batchIdx,
    count: texts.length,
    tokenEstimate: Math.round(tokenEstimate),
    model
  });

  const prompt = `다음 텍스트들을 한국어로 번역해주세요.

번역할 텍스트:
${texts.map((text, idx) => `[${idx}] ${text}`).join('\n')}

중요:
- 각 줄을 [0], [1], [2] ... 형식으로 번호를 붙여서 번역 결과를 반환해주세요.
- 원본의 형식과 구조를 최대한 유지하되, 내용만 한국어로 번역해주세요.
- 번역만 제공하고 다른 설명은 추가하지 마세요.
- HTML 태그가 있다면 그대로 유지해주세요.`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': window.location.href,
        'X-Title': 'Web Page Translator'
      },
      body: JSON.stringify({
        model: model,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    });

    const durationMs = Math.round(performance.now() - startTime);

    if (!response.ok) {
      // API_REQUEST_END (실패)
      logError('API_REQUEST_END', 'API 요청 실패', {
        reqId,
        batchIdx,
        status: response.status,
        durationMs
      }, new Error(`API error: ${response.statusText}`));

      throw new Error(`API error: ${response.statusText}`);
    }

    const data = await response.json();
    const translatedText = data.choices?.[0]?.message?.content || '';

    // API_REQUEST_END (성공)
    logInfo('API_REQUEST_END', 'API 요청 완료', {
      reqId,
      batchIdx,
      status: 200,
      durationMs
    });

    return parseTranslationResult(translatedText, texts.length);

  } catch (error) {
    const durationMs = Math.round(performance.now() - startTime);

    // API_REQUEST_END (에러)
    logError('API_REQUEST_END', 'API 요청 에러', {
      reqId,
      batchIdx,
      durationMs
    }, error);

    throw error;
  }
}

// 번역 결과 파싱
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

// 원본 복원
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

  translationState = 'restored';
  progressStatus.state = 'restored';
  progressStatus.translatedCount = 0;

  pushProgress();
}

// 텍스트 노드 수집
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

// 텍스트 추출
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

// ==================== IndexedDB 캐시 함수 ====================

// IndexedDB 열기
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

// SHA1 해시 생성
async function sha1Hash(text) {
  const normalized = normalizeText(text);
  const msgBuffer = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-1', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 텍스트 정규화
function normalizeText(text) {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

// TTL 가져오기
async function getTTL() {
  try {
    const result = await chrome.storage.local.get(['cacheTTL']);
    return (result.cacheTTL || DEFAULT_TTL_MINUTES) * 60 * 1000;
  } catch (error) {
    console.error('Failed to get TTL:', error);
    return DEFAULT_TTL_MINUTES * 60 * 1000;
  }
}

// 캐시 저장
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

// 캐시 가져오기
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

// 전역 캐시 비우기
async function clearAllCache() {
  try {
    const db = await openDB();
    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    await store.clear();

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

// 페이지 캐시 비우기 (현재는 전체 비우기와 동일)
async function clearPageCache() {
  return await clearAllCache();
}

logDebug('CONTENT_LOADED', 'Content script 로드 완료');

// Background에 준비 완료 알림
chrome.runtime.sendMessage({ type: 'CONTENT_READY' }).catch(() => {
  // Background가 아직 준비되지 않았을 수 있음 (무시)
});
