// 전역 상태
let translationState = 'inactive'; // 'inactive', 'translating', 'completed', 'restored'
let originalTexts = new WeakMap(); // 원본 텍스트 저장
let translatedElements = new Set(); // 번역된 요소 추적

// 캐시 설정
const MAX_CACHE_SIZE = 1000;
let translationCache = new Map();
let cacheAccessOrder = [];

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
    console.log('Side panel connected');

    // 현재 상태 즉시 푸시
    pushProgress();

    port.onDisconnect.addListener(() => {
      port = null;
      console.log('Side panel disconnected');
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
  }
  return true;
});

// 전체 페이지 번역
async function handleTranslateFullPage(apiKey, model, batchSize = 50, concurrency = 3, useCache = true) {
  console.log('Starting full page translation...');

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

    // 캐시된 번역 즉시 적용
    if (cachedItems.length > 0) {
      await new Promise(resolve => {
        requestAnimationFrame(() => {
          cachedItems.forEach(({ element, text, translation }) => {
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

    console.log('Translation completed:', {
      total: progressStatus.totalTexts,
      translated: progressStatus.translatedCount,
      cached: progressStatus.cachedCount,
      time: Math.round(activeMs / 1000) + 's'
    });

  } catch (error) {
    console.error('Translation failed:', error);
    translationState = 'inactive';
    progressStatus.state = 'error';
    pushProgress();
  }
}

// 배치 처리
async function processBatch(batch, apiKey, model, useCache) {
  console.log(`Processing batch: ${batch.texts.length} texts`);

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
              setCachedTranslation(originalText, translation);
            }
          }
        });
        resolve();
      });
    });

  } catch (error) {
    console.error('Batch processing failed:', error);
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
    console.warn(`Translation mapping failed (${mappedCount}/${expectedCount}), using fallback`);
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
  console.log('Restoring original texts...');

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

// 캐시 저장 (LRU)
function setCachedTranslation(original, translation) {
  if (translationCache.has(original)) {
    const index = cacheAccessOrder.indexOf(original);
    if (index > -1) {
      cacheAccessOrder.splice(index, 1);
    }
    cacheAccessOrder.push(original);
    translationCache.set(original, translation);
    return;
  }

  if (translationCache.size >= MAX_CACHE_SIZE) {
    const oldest = cacheAccessOrder.shift();
    if (oldest) {
      translationCache.delete(oldest);
    }
  }

  translationCache.set(original, translation);
  cacheAccessOrder.push(original);
}

// 캐시 가져오기
function getCachedTranslation(original) {
  if (translationCache.has(original)) {
    const index = cacheAccessOrder.indexOf(original);
    if (index > -1) {
      cacheAccessOrder.splice(index, 1);
      cacheAccessOrder.push(original);
    }
    return translationCache.get(original);
  }
  return null;
}

console.log('Content script loaded');
