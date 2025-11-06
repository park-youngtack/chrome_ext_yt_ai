// 전역 상태
let translationState = 'inactive'; // 'inactive', 'translating', 'completed', 'restored'
let originalTexts = new WeakMap(); // 원본 텍스트 저장
let translatedElements = new Set(); // 번역된 요소 추적

// IndexedDB 캐시 설정
const DB_NAME = 'TranslationCache';
const DB_VERSION = 1;
const STORE_NAME = 'translations';
const DEFAULT_TTL_MINUTES = 60;

// 로거 함수 (설정에 따라 로그 출력)
async function log(...args) {
  try {
    const result = await chrome.storage.local.get(['enableConsoleLog']);
    if (result.enableConsoleLog) {
      console.log('[번역 확장]', ...args);
    }
  } catch (error) {
    // 설정 로드 실패 시 로그 출력 안 함
  }
}

async function logError(...args) {
  // 에러는 항상 출력
  console.error('[번역 확장 오류]', ...args);
}

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
      port = null;
      log('Side panel disconnected');
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
  } catch (error) {
    console.error('Failed to push progress:', error);
  }
}

// 메시지 리스너
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
  log('Starting full page translation...', {
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

    progressStatus.totalTexts = texts.length;
    pushProgress();

    // 캐시 확인 및 분류
    const cachedItems = [];
    const newTexts = [];
    const newElements = [];

    if (useCache) {
      for (let i = 0; i < texts.length; i++) {
        const text = texts[i];
        const element = elements[i];

        if (translatedElements.has(element)) {
          progressStatus.translatedCount++;
          continue;
        }

        const cached = getCachedTranslation(text);
        if (cached) {
          cachedItems.push({ element, text, translation: cached });
        } else {
          newTexts.push(text);
          newElements.push(element);
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

    // 대규모 변경 확인 (≥20% 변경 시 자동 전면 재번역)
    if (useCache && texts.length > 0) {
      const changeRate = newTexts.length / texts.length;
      if (changeRate >= 0.20) {
        log(`Large page change detected (${Math.round(changeRate * 100)}%), forcing full retranslation`);
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

    // 캐시 검증 및 적용
    if (cachedItems.length > 0) {
      const verifiedItems = [];
      const invalidItems = [];

      // 캐시 검증
      for (const item of cachedItems) {
        const isValid = await verifyCachedTranslation(item.text, item.translation);
        if (isValid) {
          verifiedItems.push(item);
        } else {
          log('Cache verification failed, re-translating:', item.text.substring(0, 50));
          invalidItems.push(item);
        }
      }

      // 검증된 캐시 적용
      if (verifiedItems.length > 0) {
        await new Promise(resolve => {
          requestAnimationFrame(() => {
            verifiedItems.forEach(({ element, text, translation }) => {
              if (!originalTexts.has(element)) {
                originalTexts.set(element, element.textContent);
              }
              element.textContent = translation;
              translatedElements.add(element);
              progressStatus.translatedCount++;
            });
            pushProgress();
            resolve();
          });
        });
      }

      // 검증 실패 항목은 재번역 대상으로 추가
      if (invalidItems.length > 0) {
        invalidItems.forEach(({ element, text }) => {
          newTexts.push(text);
          newElements.push(element);
        });
        log(`${invalidItems.length} cached items failed verification, added to retranslation queue`);
      }
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

      progressStatus.batchCount = batches.length;
      progressStatus.batches = batches.map((b, i) => ({
        index: i,
        size: b.size,
        status: 'pending'
      }));
      pushProgress();

      // 병렬 배치 처리
      const processQueue = async () => {
        let index = 0;

        const worker = async () => {
          while (index < batches.length) {
            const batchIndex = index++;
            const batch = batches[batchIndex];

            // 배치 상태 업데이트
            progressStatus.batches[batchIndex].status = 'processing';
            pushProgress();

            onBatchStart();

            try {
              await processBatch(batch, apiKey, model, useCache);
              progressStatus.batches[batchIndex].status = 'completed';
              progressStatus.batchesDone++;
            } catch (error) {
              console.error(`Batch ${batchIndex + 1} failed:`, error);
              progressStatus.batches[batchIndex].status = 'failed';
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
    }

    // 완료
    translationState = 'completed';
    progressStatus.state = 'completed';
    pushProgress();

    log('Translation completed:', {
      total: progressStatus.totalTexts,
      translated: progressStatus.translatedCount,
      cached: progressStatus.cachedCount,
      time: Math.round(activeMs / 1000) + 's'
    });

  } catch (error) {
    logError('Translation failed:', error);
    translationState = 'inactive';
    progressStatus.state = 'error';
    pushProgress();
  }
}

// 배치 처리
async function processBatch(batch, apiKey, model, useCache) {
  log(`Processing batch: ${batch.texts.length} texts`);

  try {
    // API 호출
    const translations = await translateWithOpenRouter(batch.texts, apiKey, model);

    // DOM 적용
    await new Promise(resolve => {
      requestAnimationFrame(() => {
        batch.elements.forEach((element, idx) => {
          const translation = translations[idx];
          if (translation && translation !== null) {
            const originalText = batch.texts[idx];

            if (!originalTexts.has(element)) {
              originalTexts.set(element, element.textContent);
            }

            element.textContent = translation;
            translatedElements.add(element);
            progressStatus.translatedCount++;

            // 캐시에 저장
            if (useCache) {
              setCachedTranslation(originalText, translation, model);
            }
          }
        });
        resolve();
      });
    });

  } catch (error) {
    logError('Batch processing failed:', error);
    throw error;
  }
}

// OpenRouter API 번역
async function translateWithOpenRouter(texts, apiKey, model) {
  const prompt = `다음 텍스트들을 한국어로 번역해주세요.

번역할 텍스트:
${texts.map((text, idx) => `[${idx}] ${text}`).join('\n')}

중요:
- 각 줄을 [0], [1], [2] ... 형식으로 번호를 붙여서 번역 결과를 반환해주세요.
- 원본의 형식과 구조를 최대한 유지하되, 내용만 한국어로 번역해주세요.
- 번역만 제공하고 다른 설명은 추가하지 마세요.
- HTML 태그가 있다면 그대로 유지해주세요.`;

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

  if (!response.ok) {
    throw new Error(`API error: ${response.statusText}`);
  }

  const data = await response.json();
  const translatedText = data.choices?.[0]?.message?.content || '';

  return parseTranslationResult(translatedText, texts.length);
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

// 캐시 검증
async function verifyCachedTranslation(text, translation) {
  try {
    const hash = await sha1Hash(text);
    const db = await openDB();

    const tx = db.transaction([STORE_NAME], 'readonly');
    const store = tx.objectStore(STORE_NAME);

    const result = await new Promise((resolve, reject) => {
      const request = store.get(hash);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    db.close();

    if (!result) {
      return false;
    }

    return result.translation === translation;
  } catch (error) {
    console.error('Failed to verify cache:', error);
    return false;
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

log('Content script loaded');
