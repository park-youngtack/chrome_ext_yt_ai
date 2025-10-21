// 번역 상태를 저장하는 전역 변수
let isTranslated = false;
let originalTexts = new Map(); // 원본 텍스트 저장
let translatedElements = new Set(); // 이미 번역된 요소 추적
let scrollObserver = null; // 스크롤 감지 옵저버
let currentApiKey = null;
let currentModel = null;

// 메시지 리스너
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'toggleTranslation') {
    handleTranslationToggle(request.apiKey, request.model);
  }
});

// 번역 토글 핸들러
async function handleTranslationToggle(apiKey, model) {
  if (isTranslated) {
    // 이미 번역된 상태 -> 원본으로 복원
    restoreOriginalTexts();
  } else {
    // API 키와 모델 저장
    currentApiKey = apiKey;
    currentModel = model;
    // 번역 시작
    await translateVisibleContent(apiKey, model);
    // 스크롤 감지 시작
    setupScrollObserver();
  }
}

// 원본 텍스트로 복원
function restoreOriginalTexts() {
  // 스크롤 옵저버 중지
  if (scrollObserver) {
    scrollObserver.disconnect();
    scrollObserver = null;
  }

  originalTexts.forEach((originalText, element) => {
    if (element && element.isConnected) {
      element.textContent = originalText;
      // 로딩 효과 제거
      removeLoadingEffect(element);
    }
  });

  originalTexts.clear();
  translatedElements.clear();
  isTranslated = false;
  currentApiKey = null;
  currentModel = null;

  showNotification('원본으로 복원되었습니다.', 'success');
}

// 화면에 보이는 텍스트 요소 수집
function getVisibleTextElements() {
  const textNodes = [];
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

        // 요소가 화면에 보이는지 확인
        const rect = parent.getBoundingClientRect();
        const isVisible = rect.top < window.innerHeight &&
                         rect.bottom > 0 &&
                         rect.left < window.innerWidth &&
                         rect.right > 0;

        if (!isVisible) {
          return NodeFilter.FILTER_REJECT;
        }

        // display: none이나 visibility: hidden인지 확인
        const style = window.getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') {
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
  const prompt = `다음 텍스트들을 한국어로 번역해주세요. 각 줄을 번역하여 같은 순서로 반환해주세요. 원본의 형식과 구조를 최대한 유지하되, 내용만 한국어로 번역해주세요.

번역할 텍스트:
${texts.map((text, idx) => `[${idx}] ${text}`).join('\n')}

중요:
- 각 줄을 [0], [1], [2] ... 형식으로 번호를 붙여서 번역 결과를 반환해주세요.
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
    if (!silentMode) {
      showNotification('번역 중...', 'info');
    }

    // 화면에 보이는 텍스트 노드 수집
    const textNodes = getVisibleTextElements();
    const { texts, elements } = extractTextsForTranslation(textNodes);

    // 이미 번역된 요소는 제외
    const newTexts = [];
    const newElements = [];

    elements.forEach((element, idx) => {
      if (!translatedElements.has(element)) {
        newTexts.push(texts[idx]);
        newElements.push(element);
      }
    });

    if (newTexts.length === 0) {
      if (!silentMode) {
        showNotification('번역할 새로운 텍스트가 없습니다.', 'warning');
      }
      return;
    }

    console.log(`번역할 텍스트 ${newTexts.length}개 발견`);

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

      // 번역 결과 적용
      batch.elements.forEach((element, idx) => {
        if (translations[idx]) {
          // 원본 저장
          if (!originalTexts.has(element)) {
            originalTexts.set(element, element.textContent);
          }
          // 번역 적용
          element.textContent = translations[idx];
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

    isTranslated = true;
    if (!silentMode) {
      showNotification('번역 완료!', 'success');
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

// 스크롤 감지 설정
function setupScrollObserver() {
  // 기존 옵저버가 있으면 제거
  if (scrollObserver) {
    scrollObserver.disconnect();
  }

  // IntersectionObserver로 새로 보이는 요소 감지
  scrollObserver = new IntersectionObserver(
    async (entries) => {
      // 번역 모드가 아니면 무시
      if (!isTranslated || !currentApiKey || !currentModel) return;

      // 새로 보이는 요소가 있는지 확인
      const hasNewVisible = entries.some(entry => entry.isIntersecting);

      if (hasNewVisible) {
        // 디바운스를 위해 타이머 사용
        clearTimeout(scrollObserver.timer);
        scrollObserver.timer = setTimeout(async () => {
          await translateVisibleContent(currentApiKey, currentModel, true);
        }, 500);
      }
    },
    {
      root: null,
      rootMargin: '100px', // 화면 경계에서 100px 전에 감지
      threshold: 0.1
    }
  );

  // 모든 주요 컨테이너 요소들을 관찰
  const observeElements = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, th, span, div, a, button');
  observeElements.forEach(el => {
    scrollObserver.observe(el);
  });

  console.log('스크롤 감지 시작:', observeElements.length, '개 요소 관찰');
}

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
