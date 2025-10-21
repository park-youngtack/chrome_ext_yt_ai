// 번역 상태를 저장하는 전역 변수
// 상태: 'inactive' (원본 페이지), 'active' (번역중), 'paused' (번역 중지됨)
let translationState = 'inactive';
let originalTexts = new WeakMap(); // 원본 텍스트 저장 (WeakMap으로 메모리 누수 방지)
let translatedElements = new Set(); // 이미 번역된 요소 추적 (Set으로 순회 가능하게 보관)
let scrollObserver = null; // 스크롤 감지 옵저버
let currentApiKey = null;
let currentModel = null;

// 자동 일시정지 관련
let idleTimer = null;
let idleTimeout = 60000; // 기본 60초
let userActivityListeners = [];

// 번역 캐시 (LRU 방식으로 크기 제한)
const MAX_CACHE_SIZE = 1000; // 최대 1000개 텍스트만 캐시
let translatedTexts = new Map(); // 번역된 텍스트 캐시
let cacheAccessOrder = []; // LRU 추적용

// 페이지 컨텍스트 (한 번만 분석)
let pageContext = null;

// 메시지 리스너
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'toggleTranslation') {
    handleTranslationToggle(request.apiKey, request.model, request.autoPauseEnabled, request.autoPauseTimeout);
    sendResponse({ success: true });
  } else if (request.action === 'resumeTranslation') {
    handleResumeTranslation();
    sendResponse({ success: true });
  } else if (request.action === 'getTranslationState') {
    sendResponse({
      state: translationState,
      // 하위 호환성을 위해 isTranslated도 반환
      isTranslated: translationState === 'active' || translationState === 'paused'
    });
  }
  return true; // 비동기 응답을 위해 필요
});

// 번역 토글 핸들러
async function handleTranslationToggle(apiKey, model, autoPauseEnabled = true, autoPauseTimeout = 60) {
  if (translationState === 'active' || translationState === 'paused') {
    // 번역 상태 -> 원본으로 복원
    restoreOriginalTexts();
    updateTranslationState('inactive');
  } else {
    // API 키와 모델 저장
    currentApiKey = apiKey;
    currentModel = model;

    // 자동 일시정지 설정 저장
    if (autoPauseEnabled) {
      idleTimeout = autoPauseTimeout * 1000; // 초를 밀리초로 변환
    } else {
      idleTimeout = Infinity; // 비활성화
    }

    // 컨텍스트 분석 (LLM 사용, 최초 1회만)
    if (!pageContext) {
      showNotification('페이지 분석 중... (AI가 산업군 판단)', 'info');
      await analyzePageContext(apiKey, model);
    }

    // 번역 시작 (캐시 활용)
    await translateVisibleContent(apiKey, model);
    // 스크롤 감지 시작 (실시간 감시 대신 스크롤 이벤트만 사용)
    setupScrollObserver();
    // 사용자 활동 감지 시작 (자동 일시정지용)
    if (autoPauseEnabled) {
      startIdleDetection();
    }
    updateTranslationState('active');
  }
}

// 번역 재개 핸들러 (paused 상태에서만 사용)
async function handleResumeTranslation() {
  if (translationState !== 'paused') {
    console.log('재개 가능한 상태가 아닙니다.');
    return;
  }

  if (!currentApiKey || !currentModel) {
    showNotification('설정 정보가 없습니다. 번역을 다시 시작해주세요.', 'error');
    return;
  }

  // 스크롤 감지 재시작
  setupScrollObserver();
  // 사용자 활동 감지 재시작
  startIdleDetection();

  updateTranslationState('active');
  showNotification('번역 작업을 재개합니다.', 'info');
}

// 번역 상태를 storage에 저장
function updateTranslationState(state) {
  translationState = state;
  chrome.storage.session.set({ translationState: state }).catch(() => {});
  console.log('번역 상태 변경:', state);
}

// 캐시에 번역 저장 (LRU 방식)
function setCachedTranslation(original, translation) {
  // 이미 있으면 접근 순서만 업데이트
  if (translatedTexts.has(original)) {
    const index = cacheAccessOrder.indexOf(original);
    if (index > -1) {
      cacheAccessOrder.splice(index, 1);
    }
    cacheAccessOrder.push(original);
    return;
  }

  // 캐시 크기 초과 시 가장 오래된 항목 제거
  if (translatedTexts.size >= MAX_CACHE_SIZE) {
    const oldest = cacheAccessOrder.shift();
    if (oldest) {
      translatedTexts.delete(oldest);
    }
  }

  // 새 번역 추가
  translatedTexts.set(original, translation);
  cacheAccessOrder.push(original);
}

// 캐시에서 번역 가져오기
function getCachedTranslation(original) {
  if (translatedTexts.has(original)) {
    // 접근 순서 업데이트 (LRU)
    const index = cacheAccessOrder.indexOf(original);
    if (index > -1) {
      cacheAccessOrder.splice(index, 1);
      cacheAccessOrder.push(original);
    }
    return translatedTexts.get(original);
  }
  return null;
}

// 사용자 활동 감지 시작
function startIdleDetection() {
  // 기존 리스너 제거
  stopIdleDetection();

  // 사용자 활동 감지 함수
  const resetIdleTimer = () => {
    clearTimeout(idleTimer);

    // 번역 활성 상태에서만 타이머 재설정
    if (translationState === 'active' && idleTimeout !== Infinity) {
      idleTimer = setTimeout(() => {
        handleIdlePause();
      }, idleTimeout);
    }
  };

  // 이벤트 리스너 등록
  const events = ['scroll', 'mousemove', 'keydown', 'click', 'touchstart'];
  events.forEach(event => {
    const listener = resetIdleTimer;
    window.addEventListener(event, listener, { passive: true });
    userActivityListeners.push({ event, listener });
  });

  // 초기 타이머 시작
  resetIdleTimer();

  console.log(`사용자 활동 감지 시작 (${idleTimeout / 1000}초)`);
}

// 사용자 활동 감지 중지
function stopIdleDetection() {
  // 타이머 클리어
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  // 이벤트 리스너 제거
  userActivityListeners.forEach(({ event, listener }) => {
    window.removeEventListener(event, listener);
  });
  userActivityListeners = [];
}

// 자동 일시정지 처리
function handleIdlePause() {
  console.log('사용자 활동 없음 - 자동 일시정지');

  // 스크롤 감지 중지
  if (scrollObserver) {
    scrollObserver.disconnect();
    scrollObserver = null;
  }

  // 사용자 활동 감지 중지
  stopIdleDetection();

  // 상태 변경
  updateTranslationState('paused');

  // 사용자에게 안내 토스트 표시
  showToast('활동이 없어 자동 일시정지되었습니다. 팝업에서 번역 작업 시작으로 재개하세요.');
}

// 토스트 메시지 표시 (더 긴 안내 메시지용, 자동 일시정지 전용)
function showToast(message) {
  // 기존 토스트 제거
  const existing = document.getElementById('translation-toast');
  if (existing) {
    existing.remove();
  }

  // 새 토스트 생성
  const toast = document.createElement('div');
  toast.id = 'translation-toast';
  toast.textContent = message;

  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '15px 25px',
    backgroundColor: '#FF9800',
    color: 'white',
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    zIndex: '999999',
    fontSize: '14px',
    fontFamily: 'Arial, sans-serif',
    fontWeight: '500',
    maxWidth: '500px',
    textAlign: 'center',
    lineHeight: '1.5',
    transition: 'opacity 0.3s'
  });

  document.body.appendChild(toast);

  // 5초 후 제거
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 5000);
}

// 메모리 정리 함수
function cleanupMemory() {
  console.log('메모리 정리 시작...');

  // Observer 정리
  if (scrollObserver) {
    scrollObserver.disconnect();
    scrollObserver = null;
  }

  // 사용자 활동 감지 정리
  stopIdleDetection();

  // WeakMap과 Set은 명시적으로 참조를 끊어 메모리 사용을 최소화
  originalTexts = new WeakMap();
  translatedElements.clear();
  translatedElements = new Set();

  // 캐시 정리 (Map은 수동 정리 필요)
  translatedTexts.clear();
  cacheAccessOrder = [];

  // API 정보 정리
  currentApiKey = null;
  currentModel = null;

  // 페이지 컨텍스트는 유지 (페이지가 바뀌지 않는 한)

  console.log('메모리 정리 완료');
}

// 번역된 요소 중 DOM에서 사라진 항목 정리 (스크롤 기반 감시에 맞춰 주기적으로 호출)
function pruneTranslatedElements() {
  if (translatedElements.size === 0) {
    return;
  }

  const staleElements = [];

  translatedElements.forEach(element => {
    // 요소가 더 이상 문서에 없거나 접근할 수 없으면 제거 대상에 추가
    if (!element || !document.contains(element)) {
      staleElements.push(element);
    }
  });

  if (staleElements.length === 0) {
    return;
  }

  staleElements.forEach(element => {
    translatedElements.delete(element);
    if (element && originalTexts.has(element)) {
      originalTexts.delete(element);
    }
  });

  console.log(`번역 요소 정리: ${staleElements.length}개 제거`);
}

// 페이지 컨텍스트 분석 (LLM 기반 산업군 판단)
async function analyzePageContext(apiKey, model) {
  if (pageContext) {
    return pageContext; // 이미 분석됨
  }

  console.log('페이지 컨텍스트를 LLM으로 분석 중...');

  // 페이지 정보 수집
  const pageInfo = {
    url: window.location.href,
    domain: window.location.hostname,
    title: document.title,
    description: '',
    mainTopics: []
  };

  // 메타 태그에서 정보 추출
  const metaDescription = document.querySelector('meta[name="description"]');
  if (metaDescription) {
    pageInfo.description = metaDescription.getAttribute('content') || '';
  }

  // 헤딩 태그에서 주요 주제 추출 (h1, h2)
  const headings = Array.from(document.querySelectorAll('h1, h2'))
    .map(h => h.textContent.trim())
    .filter(t => t && t.length > 0 && t.length < 100)
    .slice(0, 5); // 최대 5개
  pageInfo.mainTopics = headings;

  // 본문 일부 추출 (첫 500자)
  const bodyText = document.body.innerText
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 500);

  // LLM에게 산업군 판단 요청
  const analysisPrompt = `다음 웹페이지 정보를 분석하여 산업군/카테고리를 판단하고, 한국어 번역 시 주의할 점을 제공해주세요.

웹페이지 정보:
- URL: ${pageInfo.url}
- 도메인: ${pageInfo.domain}
- 제목: ${pageInfo.title}
- 설명: ${pageInfo.description}
- 주요 헤딩: ${pageInfo.mainTopics.join(', ')}
- 본문 일부: ${bodyText}

다음 JSON 형식으로만 응답해주세요 (다른 설명 없이):
{
  "industry": "산업군 (예: 블록체인/암호화폐, AI/머신러닝, 의료/건강 등)",
  "category": "세부 카테고리",
  "translationGuidelines": "이 분야의 한국어 번역 시 주의사항 (전문 용어, 일반적인 번역 관행 등)"
}`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': window.location.href,
        'X-Title': 'Web Page Translator - Context Analysis'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'user',
            content: analysisPrompt
          }
        ],
        temperature: 0.3 // 일관된 분석을 위해 낮은 temperature
      })
    });

    if (!response.ok) {
      throw new Error(`LLM API 오류: ${response.statusText}`);
    }

    const data = await response.json();
    const analysisText = data.choices[0].message.content;

    // JSON 파싱
    let analysisResult;
    try {
      // JSON만 추출 (마크다운 코드 블록이 있을 수 있음)
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      } else {
        analysisResult = JSON.parse(analysisText);
      }
    } catch (parseError) {
      console.warn('LLM 응답 JSON 파싱 실패, 기본값 사용:', parseError);
      analysisResult = {
        industry: 'general',
        category: 'general',
        translationGuidelines: '일반적인 번역 가이드라인을 따릅니다.'
      };
    }

    // 컨텍스트 생성
    pageContext = {
      url: pageInfo.url,
      domain: pageInfo.domain,
      title: pageInfo.title,
      description: pageInfo.description,
      mainTopics: pageInfo.mainTopics,
      industry: analysisResult.industry || 'general',
      category: analysisResult.category || 'general',
      translationGuidelines: analysisResult.translationGuidelines || ''
    };

    console.log('LLM 컨텍스트 분석 완료:', {
      industry: pageContext.industry,
      category: pageContext.category,
      guidelines: pageContext.translationGuidelines.substring(0, 100) + '...'
    });

    return pageContext;

  } catch (error) {
    console.error('LLM 컨텍스트 분석 실패:', error);

    // 실패 시 기본 컨텍스트 사용
    pageContext = {
      url: pageInfo.url,
      domain: pageInfo.domain,
      title: pageInfo.title,
      description: pageInfo.description,
      mainTopics: pageInfo.mainTopics,
      industry: 'general',
      category: 'general',
      translationGuidelines: '일반적인 번역 가이드라인을 따릅니다.'
    };

    return pageContext;
  }
}

// 컨텍스트 기반 번역 프롬프트 생성 (LLM 가이드라인 활용)
function buildContextualPrompt(texts, context) {
  let contextInfo = '';

  if (context.industry && context.industry !== 'general') {
    contextInfo = `
이 페이지는 "${context.industry}" 분야의 콘텐츠입니다.`;

    if (context.category && context.category !== context.industry) {
      contextInfo += `
세부 카테고리: ${context.category}`;
    }
  }

  if (context.mainTopics && context.mainTopics.length > 0) {
    contextInfo += `
주요 주제: ${context.mainTopics.slice(0, 3).join(', ')}`;
  }

  if (context.translationGuidelines) {
    contextInfo += `

번역 가이드라인: ${context.translationGuidelines}`;
  }

  const prompt = `다음 텍스트들을 한국어로 번역해주세요.${contextInfo}

번역할 텍스트:
${texts.map((text, idx) => `[${idx}] ${text}`).join('\n')}

중요:
- 각 줄을 [0], [1], [2] ... 형식으로 번호를 붙여서 번역 결과를 반환해주세요.
- 위의 번역 가이드라인을 엄격히 따라주세요.
- 원본의 형식과 구조를 최대한 유지하되, 내용만 한국어로 번역해주세요.
- 번역만 제공하고 다른 설명은 추가하지 마세요.
- HTML 태그가 있다면 그대로 유지해주세요.`;

  return prompt;
}

// 원본 텍스트로 복원
function restoreOriginalTexts() {
  // 스크롤 옵저버 중지
  if (scrollObserver) {
    scrollObserver.disconnect();
    scrollObserver = null;
  }

  // 모든 번역된 요소를 순회하며 원문으로 복구
  // Set을 사용하므로 화면 밖 요소도 빠짐없이 복구 가능
  translatedElements.forEach(element => {
    // 요소가 이미 제거되었거나 원문이 없다면 건너뜀
    if (!element || !originalTexts.has(element)) {
      return;
    }

    const originalText = originalTexts.get(element);
    element.textContent = originalText;
    removeLoadingEffect(element);
  });

  // WeakMap은 새로 생성하여 원문 참조 정리
  originalTexts = new WeakMap();
  // Set은 clear로 모든 요소를 정리하고 새 인스턴스로 교체하여 GC 유도
  translatedElements.clear();
  translatedElements = new Set();

  // 캐시는 유지 (다음 번역 시 재사용)

  showNotification('원본으로 복원되었습니다.', 'success');
}

// 화면에 보이는 텍스트 요소 수집
function getVisibleTextElements() {
  const textNodes = [];
  const visibilityCache = new Map(); // 부모 요소별 가시성 정보를 저장해 레이아웃 계산 최소화
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        // 부모 요소가 화면에 보이는지 확인
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        // script, style, noscript, 코드 관련 태그는 제외
        const excludeTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'CODE', 'PRE', 'KBD', 'SAMP', 'VAR'];
        if (excludeTags.includes(parent.tagName)) {
          return NodeFilter.FILTER_REJECT;
        }

        // 부모 중에 코드 블록이 있는지 확인
        let ancestor = parent;
        while (ancestor && ancestor !== document.body) {
          if (excludeTags.includes(ancestor.tagName)) {
            return NodeFilter.FILTER_REJECT;
          }
          ancestor = ancestor.parentElement;
        }

        // 텍스트가 비어있거나 공백만 있으면 제외
        const text = node.textContent.trim();
        if (!text || text.length === 0) {
          return NodeFilter.FILTER_REJECT;
        }

        // 부모 요소의 가시성 정보를 캐시해 중복 계산을 줄임
        let cachedVisibility = visibilityCache.get(parent);

        if (!cachedVisibility) {
          const rect = parent.getBoundingClientRect();
          const style = window.getComputedStyle(parent);
          const isInsideViewport = rect.top < window.innerHeight &&
                                   rect.bottom > 0 &&
                                   rect.left < window.innerWidth &&
                                   rect.right > 0;
          const isHidden = style.display === 'none' ||
                           style.visibility === 'hidden' ||
                           parseFloat(style.opacity || '1') === 0;

          cachedVisibility = {
            visible: isInsideViewport && !isHidden
          };

          visibilityCache.set(parent, cachedVisibility);
        }

        if (!cachedVisibility.visible) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let node;
  while (node = walker.nextNode()) {
    textNodes.push(node);
  }

  return textNodes;
}

// 텍스트 노드들을 그룹화하여 텍스트 추출
function extractTextsForTranslation(textNodes) {
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

// OpenRouter API를 사용한 번역
async function translateWithOpenRouter(texts, apiKey, model) {
  // 페이지 컨텍스트는 이미 분석됨 (handleTranslationToggle에서)
  const context = pageContext || {
    industry: 'general',
    category: 'general',
    translationGuidelines: ''
  };

  // 컨텍스트 기반 프롬프트 생성
  const prompt = buildContextualPrompt(texts, context);

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
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API 오류: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const translatedText = data.choices[0].message.content;

    // 번역 결과 파싱
    return parseTranslationResult(translatedText, texts.length);

  } catch (error) {
    console.error('Translation error:', error);
    throw error;
  }
}

// 번역 결과 파싱
function parseTranslationResult(translatedText, expectedCount) {
  const lines = translatedText.split('\n').filter(line => line.trim());
  const translations = [];

  // [0], [1] 형식으로 파싱 시도
  lines.forEach(line => {
    const match = line.match(/^\[(\d+)\]\s*(.+)$/);
    if (match) {
      const index = parseInt(match[1]);
      const translation = match[2].trim();
      translations[index] = translation;
    }
  });

  // 파싱이 잘 안되었으면 줄바꿈으로 분리
  if (translations.length < expectedCount) {
    return translatedText.split('\n').filter(line => line.trim() && !line.match(/^\[\d+\]/));
  }

  return translations.filter(t => t); // undefined 제거
}

// 화면에 보이는 콘텐츠 번역
async function translateVisibleContent(apiKey, model, silentMode = false) {
  try {
    // 기존에 번역되었다가 화면에서 사라진 노드를 먼저 정리해 메모리 누수를 줄임
    pruneTranslatedElements();

    // 컨텍스트는 이미 분석됨
    const context = pageContext || { industry: 'general' };

    if (!silentMode) {
      const contextMsg = context.industry && context.industry !== 'general'
        ? `번역 중... (${context.industry} 분야)`
        : '번역 중...';
      showNotification(contextMsg, 'info');
    }

    // 화면에 보이는 텍스트 노드 수집
    const textNodes = getVisibleTextElements();
    const { texts, elements } = extractTextsForTranslation(textNodes);

    // 이미 번역된 요소는 제외
    const cachedElements = []; // 캐시에서 가져올 요소
    const newTexts = []; // API 호출이 필요한 텍스트
    const newElements = []; // API 호출이 필요한 요소

    elements.forEach((element, idx) => {
      if (!translatedElements.has(element)) {
        const originalText = texts[idx];

        // 캐시에 번역이 있는지 확인
        const cachedTranslation = getCachedTranslation(originalText);
        if (cachedTranslation) {
          cachedElements.push({ element, originalText, translation: cachedTranslation });
        } else {
          newTexts.push(originalText);
          newElements.push(element);
        }
      }
    });

    // 캐시된 번역 즉시 적용
    let cachedCount = 0;
    cachedElements.forEach(({ element, originalText, translation }) => {
      if (translation) {
        if (!originalTexts.has(element)) {
          originalTexts.set(element, element.textContent);
        }
        element.textContent = translation;
        translatedElements.add(element);
        cachedCount++;
      }
    });

    if (cachedCount > 0) {
      console.log(`캐시에서 ${cachedCount}개 번역 적용`);
    }

    // API 호출이 필요한 텍스트가 없으면 종료
    if (newTexts.length === 0) {
      if (!silentMode && cachedCount > 0) {
        showNotification(`번역 완료! (캐시 사용: ${cachedCount}개)`, 'success');
      } else if (!silentMode) {
        showNotification('번역할 새로운 텍스트가 없습니다.', 'warning');
      }
      return;
    }

    console.log(`새로 번역할 텍스트 ${newTexts.length}개 발견 (캐시: ${cachedCount}개)`);

    // 배치 크기로 나누어 번역 (한 번에 너무 많이 보내지 않도록)
    const batchSize = 50;
    const batches = [];

    for (let i = 0; i < newTexts.length; i += batchSize) {
      batches.push({
        texts: newTexts.slice(i, i + batchSize),
        elements: newElements.slice(i, i + batchSize)
      });
    }

    // 각 배치를 순차적으로 번역
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      if (!silentMode) {
        showNotification(`번역 중... (${i + 1}/${batches.length})`, 'info');
      }

      // 로딩 효과 추가
      batch.elements.forEach(element => {
        addLoadingEffect(element);
      });

      const translations = await translateWithOpenRouter(batch.texts, apiKey, model);

      // 번역 결과 적용 및 캐시에 저장
      batch.elements.forEach((element, idx) => {
        if (translations[idx]) {
          const originalText = batch.texts[idx];
          const translation = translations[idx];

          // 원본 저장
          if (!originalTexts.has(element)) {
            originalTexts.set(element, element.textContent);
          }

          // 캐시에 저장 (LRU 방식)
          setCachedTranslation(originalText, translation);

          // 번역 적용
          element.textContent = translation;

          // 번역 완료 표시
          translatedElements.add(element);

          // 로딩 효과 제거
          removeLoadingEffect(element);
        }
      });

      // API 레이트 리밋을 고려하여 약간의 딜레이
      if (i < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (!silentMode) {
      const totalMsg = cachedCount > 0
        ? `번역 완료! (새로 번역: ${newTexts.length}개, 캐시: ${cachedCount}개)`
        : `번역 완료! (${newTexts.length}개)`;
      showNotification(totalMsg, 'success');
    }

  } catch (error) {
    console.error('Translation error:', error);
    showNotification(`번역 실패: ${error.message}`, 'error');
  }
}

// 로딩 효과 추가
function addLoadingEffect(element) {
  if (!element || !element.parentElement) return;

  const parent = element.parentElement;

  // 이미 로딩 효과가 있으면 스킵
  if (parent.classList.contains('translating')) return;

  parent.classList.add('translating');

  // 기존 스타일 저장
  const originalTransition = parent.style.transition;
  const originalBackground = parent.style.background;

  parent.setAttribute('data-original-transition', originalTransition);
  parent.setAttribute('data-original-background', originalBackground);

  // 로딩 애니메이션 추가
  parent.style.transition = 'background-position 1.5s ease-in-out infinite';
  parent.style.background = 'linear-gradient(90deg, transparent 0%, rgba(33, 150, 243, 0.1) 50%, transparent 100%)';
  parent.style.backgroundSize = '200% 100%';
  parent.style.animation = 'translateLoading 1.5s ease-in-out infinite';

  // CSS 애니메이션 추가 (한 번만)
  if (!document.getElementById('translation-loading-styles')) {
    const style = document.createElement('style');
    style.id = 'translation-loading-styles';
    style.textContent = `
      @keyframes translateLoading {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
      .translating {
        position: relative;
      }
    `;
    document.head.appendChild(style);
  }
}

// 로딩 효과 제거
function removeLoadingEffect(element) {
  if (!element || !element.parentElement) return;

  const parent = element.parentElement;
  parent.classList.remove('translating');

  // 원래 스타일 복원
  const originalTransition = parent.getAttribute('data-original-transition');
  const originalBackground = parent.getAttribute('data-original-background');

  if (originalTransition !== null) {
    parent.style.transition = originalTransition;
    parent.removeAttribute('data-original-transition');
  }

  if (originalBackground !== null) {
    parent.style.background = originalBackground;
    parent.removeAttribute('data-original-background');
  }

  parent.style.animation = '';
  parent.style.backgroundSize = '';
}

// 스크롤 감지 설정 (최적화: 스크롤 이벤트 기반)
function setupScrollObserver() {
  // 기존 리스너 제거
  if (scrollObserver && scrollObserver.handler) {
    window.removeEventListener('scroll', scrollObserver.handler);
  }

  let scrollTimeout = null;

  // 스크롤 이벤트 핸들러 (디바운스 적용)
  const handleScroll = () => {
    if (translationState !== 'active' || !currentApiKey || !currentModel) return;

    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(async () => {
      await translateVisibleContent(currentApiKey, currentModel, true);
    }, 800); // 800ms 디바운스
  };

  // 스크롤 리스너 등록 (passive로 성능 최적화)
  window.addEventListener('scroll', handleScroll, { passive: true });

  // 핸들러 참조 저장 (cleanup용)
  scrollObserver = {
    handler: handleScroll,
    disconnect: () => {
      window.removeEventListener('scroll', handleScroll);
      clearTimeout(scrollTimeout);
    }
  };

  console.log('스크롤 감지 시작 (이벤트 기반)');
}

// 페이지 언로드 시 메모리 정리
window.addEventListener('beforeunload', () => {
  cleanupMemory();
  console.log('페이지 언로드: 메모리 정리');
});

// 페이지 visibility 변경 시 메모리 정리 (탭 전환 등)
document.addEventListener('visibilitychange', () => {
  if (document.hidden && translationState === 'inactive') {
    // 번역 모드가 아니고 페이지가 숨겨진 경우 메모리 정리
    cleanupMemory();
    console.log('페이지 숨김: 메모리 정리');
  }
});

// 주기적 메모리 체크 (5분마다)
setInterval(() => {
  if (translationState === 'inactive') {
    // 번역 모드가 아닐 때만 정리
    if (translatedTexts.size > 0 || cacheAccessOrder.length > 0) {
      console.log('주기적 캐시 정리 (비활성 상태)');
      translatedTexts.clear();
      cacheAccessOrder = [];
    }
  } else {
    // 번역 모드일 때는 캐시 크기와 상태 로그
    console.log(`상태: ${translationState}, 캐시 크기: ${translatedTexts.size}/${MAX_CACHE_SIZE}`);
  }
}, 5 * 60 * 1000); // 5분

// 알림 표시
function showNotification(message, type) {
  // 기존 알림 제거
  const existing = document.getElementById('translation-notification');
  if (existing) {
    existing.remove();
  }

  // 새 알림 생성
  const notification = document.createElement('div');
  notification.id = 'translation-notification';
  notification.textContent = message;

  const colors = {
    info: '#2196F3',
    success: '#4CAF50',
    warning: '#FF9800',
    error: '#F44336'
  };

  Object.assign(notification.style, {
    position: 'fixed',
    top: '20px',
    right: '20px',
    padding: '15px 25px',
    backgroundColor: colors[type] || colors.info,
    color: 'white',
    borderRadius: '4px',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
    zIndex: '999999',
    fontSize: '14px',
    fontFamily: 'Arial, sans-serif',
    fontWeight: '500',
    transition: 'opacity 0.3s'
  });

  document.body.appendChild(notification);

  // 3초 후 제거
  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => {
      notification.remove();
    }, 300);
  }, 3000);
}
