// 번역 상태를 저장하는 전역 변수
// 상태: 'inactive' (원본 페이지), 'active' (번역중), 'paused' (번역 중지됨)
let translationState = 'inactive';
let originalTexts = new WeakMap(); // 원본 텍스트 저장 (WeakMap으로 메모리 누수 방지)
let translatedElements = new Set(); // 이미 번역된 요소 추적 (Set으로 순회 가능하게 보관)
let scrollObserver = null; // 스크롤 감지 옵저버
let currentApiKey = null;
let currentModel = null;

// 텍스트 노드 관찰 최적화 관련 전역 변수
const EXCLUDE_TAGS = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'CODE', 'PRE', 'KBD', 'SAMP', 'VAR'];
let textNodeObserverInitialized = false;
let textNodeIntersectionObserver = null;
let textNodeMutationObserver = null;
let parentToTextNodes = new Map();
let visibleTextNodes = new Set();
let textNodeToParent = new WeakMap();

// 확장 전용 UI 식별을 위한 데이터 속성과 값 상수 (재사용 가능)
const TRANSLATOR_UI_ATTRIBUTE = 'data-translator-ui';
const TRANSLATOR_UI_ATTRIBUTE_VALUE = 'true';

// 번역 배치 처리 동시성 제한
const MAX_CONCURRENT_TRANSLATIONS = 3;

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

// 진행 상태 추적 (사이드 패널용)
let progressStatus = {
  state: 'inactive',
  totalTexts: 0,
  translatedCount: 0,
  cachedCount: 0,
  batchCount: 0,
  currentBatch: 0,
  batches: [],
  startTime: null,
  logs: []
};

// 로그 추가 헬퍼
function addProgressLog(message, type = 'info') {
  progressStatus.logs.push({
    timestamp: Date.now(),
    message,
    type // info, success, error, warning
  });

  // 최대 100개까지만 유지
  if (progressStatus.logs.length > 100) {
    progressStatus.logs = progressStatus.logs.slice(-100);
  }
}

// 확장 전용 UI 요소에 식별 표식을 부여하는 헬퍼 (다른 UI 요소에도 재사용 가능)
function markTranslatorUiElement(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) {
    return;
  }

  // 데이터 속성을 통해 확장 UI임을 명시하여 후속 로직에서 손쉽게 구분
  element.setAttribute(TRANSLATOR_UI_ATTRIBUTE, TRANSLATOR_UI_ATTRIBUTE_VALUE);
}

// 지정된 요소가 확장 전용 UI인지 판별하는 헬퍼 (DOM 필터링 로직에서 공통 사용)
function isTranslatorUiElement(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }

  if (element.id === 'translation-notification' || element.id === 'translation-toast') {
    return true;
  }

  return element.getAttribute(TRANSLATOR_UI_ATTRIBUTE) === TRANSLATOR_UI_ATTRIBUTE_VALUE;
}

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
  } else if (request.action === 'getProgressStatus') {
    // 사이드 패널용 진행 상태 반환
    progressStatus.state = translationState;
    sendResponse(progressStatus);
  }
  return true; // 비동기 응답을 위해 필요
});

// 번역 토글 핸들러
async function handleTranslationToggle(apiKey, model, autoPauseEnabled = true, autoPauseTimeout = 60) {
  if (translationState === 'active' || translationState === 'paused') {
    // 번역 상태 -> 원본으로 복원
    restoreOriginalTexts();
    updateTranslationState('inactive');

    // 진행 상태 초기화
    progressStatus = {
      state: 'inactive',
      totalTexts: 0,
      translatedCount: 0,
      cachedCount: 0,
      batchCount: 0,
      currentBatch: 0,
      batches: [],
      startTime: null,
      logs: []
    };
    addProgressLog('번역이 중지되고 원본으로 복원되었습니다.', 'info');
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

    // 진행 상태 초기화
    progressStatus = {
      state: 'active',
      totalTexts: 0,
      translatedCount: 0,
      cachedCount: 0,
      batchCount: 0,
      currentBatch: 0,
      batches: [],
      startTime: Date.now(),
      logs: []
    };
    addProgressLog('번역을 시작합니다...', 'info');

    // 컨텍스트 분석 (LLM 사용, 최초 1회만)
    if (!pageContext) {
      showNotification('페이지 분석 중... (AI가 산업군 판단)', 'info');
      addProgressLog('페이지 컨텍스트를 분석 중...', 'info');
      await analyzePageContext(apiKey, model);
      addProgressLog('페이지 컨텍스트 분석 완료', 'success');
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

// 번역 배치를 병렬 처리하기 위한 헬퍼 함수
async function processTranslationBatch(batch, { batchIndex, totalBatches, apiKey, model }) {
  const displayIndex = batchIndex + 1;
  const batchStartTime = performance.now();

  console.log(`\n[배치 ${displayIndex}/${totalBatches}] 처리 시작 - ${batch.texts.length}개 텍스트`);

  const loadingStartTime = performance.now();
  batch.elements.forEach(element => {
    addLoadingEffect(element);
  });
  console.log(`[배치 ${displayIndex}] 로딩 효과 적용 - ${(performance.now() - loadingStartTime).toFixed(0)}ms`);

  let translations = [];
  let apiMetrics = null;
  const apiStartTime = performance.now();
  let apiTime = 0;

  let apiError = null;

  try {
    // API 호출 결과에는 번역 배열과 단계별 소요 시간이 함께 전달되어 병목을 한눈에 파악할 수 있음
    const apiResult = await translateWithOpenRouter(batch.texts, apiKey, model);
    translations = apiResult.translations;
    apiMetrics = apiResult.metrics;
    apiTime = apiMetrics ? apiMetrics.totalTime : performance.now() - apiStartTime;
  } catch (error) {
    apiTime = performance.now() - apiStartTime;
    const errorDetails = extractApiErrorDetails(error);
    console.error(`[배치 ${displayIndex}] 번역 API 오류 - ${errorDetails}`, error);
    translations = batch.texts.map(() => null);
    apiError = error;
  }

  let successCount = 0;
  let failedCount = 0;

  const domApplyStartTime = performance.now();
  await new Promise(resolve => {
    requestAnimationFrame(() => {
      batch.elements.forEach((element, idx) => {
        const translation = translations[idx];

        if (translation && translation !== null) {
          const originalText = batch.texts[idx];

          if (!originalTexts.has(element)) {
            originalTexts.set(element, element.textContent);
          }

          setCachedTranslation(originalText, translation);
          element.textContent = translation;
          translatedElements.add(element);
          successCount++;
        } else {
          failedCount++;
          if (!apiError) {
            console.warn(`[배치 ${displayIndex}] 번역 실패 [${idx}]: "${batch.texts[idx].substring(0, 50)}..."`);
          }
        }

        removeLoadingEffect(element);
      });
      resolve();
    });
  });
  const domTime = performance.now() - domApplyStartTime;

  const batchTotalTime = performance.now() - batchStartTime;
  // 단계별 시간 정보를 배치 로그에도 노출하여 실제 지연 구간을 바로 확인 가능하도록 구성
  const apiSummary = formatApiMetrics(apiMetrics, apiTime);
  const failureReason = failedCount > 0 ? describeFailureReason(apiError) : '없음';

  console.log(`[배치 ${displayIndex}] 배치 완료 - ${batchTotalTime.toFixed(0)}ms (${apiSummary}, DOM: ${domTime.toFixed(0)}ms, 성공: ${successCount}개, 실패: ${failedCount}개, 실패 원인: ${failureReason})`);

  if (apiError) {
    throw apiError;
  }

  return {
    apiTime,
    domTime,
    successCount,
    failedCount,
    apiMetrics,
    failureReason
  };
}

// API 단계별 계측 정보를 보기 좋은 문자열로 가공하는 헬퍼 함수
function formatApiMetrics(metrics, fallbackTime) {
  // metrics가 없으면 총 소요 시간만 표기하여 최소 정보라도 유지
  if (!metrics) {
    return `API 총 ${fallbackTime.toFixed(0)}ms (세부 계측 정보 없음)`;
  }

  // 측정된 구간을 배열로 정리해 가장 느린 단계가 무엇인지 파악하기 쉽게 함
  const segments = [
    { label: '헤더', value: metrics.headerTime },
    { label: '본문', value: metrics.bodyReadTime },
    { label: 'JSON', value: metrics.jsonParseTime },
    { label: '매핑', value: metrics.mappingTime }
  ].filter(segment => Number.isFinite(segment.value));

  const segmentSummary = segments
    .map(segment => `${segment.label} ${segment.value.toFixed(0)}ms`)
    .join(' | ');
  const summaryText = segmentSummary || '세부 계측 없음';

  const slowestSegment = segments.reduce((slowest, segment) => {
    if (!slowest || segment.value > slowest.value) {
      return segment;
    }
    return slowest;
  }, null);

  const slowestRatio = slowestSegment && fallbackTime > 0
    ? ((slowestSegment.value / fallbackTime) * 100).toFixed(0)
    : null;

  const delaySummary = slowestSegment
    ? `${slowestSegment.label} ${slowestSegment.value.toFixed(0)}ms (${slowestRatio}% 비중)`
    : '측정 구간 부족';

  return `API 총 ${fallbackTime.toFixed(0)}ms (${summaryText} | 지연 구간: ${delaySummary})`;
}

// API 호출 오류의 핵심 정보를 추출해 로그에 요약하기 위한 헬퍼 함수
function extractApiErrorDetails(error) {
  if (!error) {
    return '오류 정보 없음';
  }

  const details = [];

  if (error.name) {
    details.push(`유형 ${error.name}`);
  }

  if (error.status || error.statusCode) {
    details.push(`상태 ${error.status || error.statusCode}`);
  }

  if (error.message) {
    details.push(`메시지 "${error.message}"`);
  }

  if (details.length === 0) {
    return '추가 정보 없음';
  }

  return details.join(' | ');
}

// 배치 처리 실패 사유를 한 줄로 요약해 후속 분석을 돕는 헬퍼 함수
function describeFailureReason(apiError) {
  if (apiError) {
    return extractApiErrorDetails(apiError);
  }
  return '응답 매핑 누락 또는 빈 결과';
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

  // Extension context가 유효한지 확인
  try {
    if (chrome?.runtime?.id) {
      chrome.storage.session.set({ translationState: state }).catch(() => {
        // 에러가 발생해도 무시 (extension이 reload된 경우)
      });
    }
  } catch (error) {
    // Extension context invalidated 에러 무시
    console.log('Storage 저장 실패 (Extension context invalidated)');
  }

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
    // 기존 항목이더라도 최신 번역으로 교체하여 일관성을 유지
    translatedTexts.set(original, translation);
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
  markTranslatorUiElement(toast);

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

  // 텍스트 노드 옵저버 정리
  cleanupTextNodeObservers();

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

  // 텍스트 노드 옵저버 정리
  cleanupTextNodeObservers();

  showNotification('원본으로 복원되었습니다.', 'success');
}

// 텍스트 노드 관찰 초기화 (최초 1회)
function initTextNodeObservers() {
  if (textNodeObserverInitialized) {
    return;
  }

  // 기존 데이터 구조 초기화
  parentToTextNodes = new Map();
  visibleTextNodes = new Set();
  textNodeToParent = new WeakMap();

  // IntersectionObserver를 이용해 뷰포트 내 가시성을 추적
  textNodeIntersectionObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const parent = entry.target;
      const registeredNodes = parentToTextNodes.get(parent);
      if (!registeredNodes) {
        return;
      }

      if (entry.isIntersecting && entry.intersectionRatio > 0) {
        registeredNodes.forEach(node => {
          if (isTextNodeValid(node)) {
            visibleTextNodes.add(node);
          }
        });
      } else {
        registeredNodes.forEach(node => {
          visibleTextNodes.delete(node);
        });
      }
    });
  }, { threshold: 0 });

  // MutationObserver로 DOM 변경 감시 (새로운 텍스트 노드 추가/제거)
  textNodeMutationObserver = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(node => {
          scanNodeForTextNodes(node);
        });
        mutation.removedNodes.forEach(node => {
          removeTextNodesFromTree(node);
        });
      } else if (mutation.type === 'characterData') {
        handleTextNodeContentChange(mutation.target);
      }
    });
  });

  textNodeMutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });

  // 초기 DOM을 한 번만 순회하여 후보 텍스트 노드를 등록
  scanNodeForTextNodes(document.body);

  textNodeObserverInitialized = true;
}

// DOM 트리를 순회하며 텍스트 노드를 등록
function scanNodeForTextNodes(node) {
  if (!node) {
    return;
  }

  if (node.nodeType === Node.TEXT_NODE) {
    registerTextNode(node);
    return;
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    if (shouldSkipElement(node)) {
      return;
    }

    node.childNodes.forEach(child => {
      scanNodeForTextNodes(child);
    });
  }
}

// 텍스트 노드를 구조체에 등록하고 관찰 시작
function registerTextNode(node) {
  if (!node || node.nodeType !== Node.TEXT_NODE) {
    return;
  }

  const parent = node.parentElement;
  if (!parent) {
    if (textNodeToParent.has(node)) {
      unregisterTextNode(node);
    }
    return;
  }

  // 확장 전용 UI 내부의 텍스트는 등록하지 않고, 기존에 등록된 경우에는 전체 트리를 정리하여 누수를 방지
  if (isTranslatorUiElement(parent)) {
    if (textNodeToParent.has(node) || parentToTextNodes.has(parent)) {
      removeTextNodesFromTree(parent);
    }
    return;
  }

  if (shouldSkipElement(parent) || hasExcludedAncestor(parent)) {
    if (textNodeToParent.has(node)) {
      unregisterTextNode(node);
    }
    return;
  }

  if (textNodeToParent.has(node)) {
    return; // 이미 등록된 노드
  }

  const text = (node.textContent || '').trim();
  if (!text) {
    return;
  }

  textNodeToParent.set(node, parent);

  let nodeSet = parentToTextNodes.get(parent);
  if (!nodeSet) {
    nodeSet = new Set();
    parentToTextNodes.set(parent, nodeSet);
    textNodeIntersectionObserver.observe(parent);
  }

  nodeSet.add(node);

  if (checkElementVisibility(parent)) {
    visibleTextNodes.add(node);
  }
}

// 제거된 노드를 구조체에서 정리
function removeTextNodesFromTree(node) {
  if (!node) {
    return;
  }

  if (node.nodeType === Node.TEXT_NODE) {
    unregisterTextNode(node);
    return;
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    const parentSet = parentToTextNodes.get(node);
    if (parentSet) {
      parentSet.forEach(textNode => {
        unregisterTextNode(textNode);
      });
    }

    node.childNodes.forEach(child => {
      removeTextNodesFromTree(child);
    });
  }
}

// 등록된 텍스트 노드 해제
function unregisterTextNode(node) {
  if (!textNodeToParent.has(node)) {
    return;
  }

  const parent = textNodeToParent.get(node);
  textNodeToParent.delete(node);

  visibleTextNodes.delete(node);

  if (parent && parentToTextNodes.has(parent)) {
    const nodeSet = parentToTextNodes.get(parent);
    nodeSet.delete(node);

    if (nodeSet.size === 0) {
      parentToTextNodes.delete(parent);
      if (textNodeIntersectionObserver) {
        textNodeIntersectionObserver.unobserve(parent);
      }
    }
  }
}

// 텍스트 노드의 내용이 변할 때 가시성 갱신
function handleTextNodeContentChange(node) {
  if (!node || node.nodeType !== Node.TEXT_NODE) {
    return;
  }

  if (!textNodeToParent.has(node)) {
    // 기존에 관리하지 않던 노드라면 새로 등록 시도
    registerTextNode(node);
    return;
  }

  const parent = textNodeToParent.get(node);
  if (!parent) {
    unregisterTextNode(node);
    return;
  }

  const text = (node.textContent || '').trim();

  if (!text) {
    visibleTextNodes.delete(node);
    return;
  }

  if (checkElementVisibility(parent)) {
    visibleTextNodes.add(node);
  } else {
    visibleTextNodes.delete(node);
  }
}

// 제외 대상 요소 여부 검사
function shouldSkipElement(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) {
    return true;
  }

  // 확장 전용 UI는 번역 대상에서 제외하여 사용자 인터페이스가 오염되지 않도록 함
  if (isTranslatorUiElement(element)) {
    return true;
  }

  if (EXCLUDE_TAGS.includes(element.tagName)) {
    return true;
  }

  return false;
}

// 상위 요소 중 제외 대상이 있는지 검사
function hasExcludedAncestor(element) {
  let current = element;
  while (current && current !== document.body) {
    if (EXCLUDE_TAGS.includes(current.tagName) || isTranslatorUiElement(current)) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

// 텍스트 노드가 여전히 유효한지 검사
function isTextNodeValid(node) {
  if (!node || node.nodeType !== Node.TEXT_NODE) {
    return false;
  }

  if (!node.isConnected) {
    return false;
  }

  const parent = node.parentElement;
  if (!parent || shouldSkipElement(parent) || hasExcludedAncestor(parent)) {
    return false;
  }

  const text = (node.textContent || '').trim();
  return text.length > 0;
}

// 요소의 가시성 계산 (초기 등록 시 1회만 사용)
function checkElementVisibility(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  const isInsideViewport = rect.top < window.innerHeight &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.right > 0;

  const isHidden = style.display === 'none' ||
    style.visibility === 'hidden' ||
    parseFloat(style.opacity || '1') === 0;

  return isInsideViewport && !isHidden;
}

// 화면에 보이는 텍스트 요소 수집 (옵저버가 유지하는 집합을 즉시 반환)
function getVisibleTextElements() {
  initTextNodeObservers();

  const nodes = [];
  visibleTextNodes.forEach(node => {
    if (isTextNodeValid(node)) {
      nodes.push(node);
    }
  });

  return nodes;
}

// 옵저버 및 관련 자료구조 정리
function cleanupTextNodeObservers() {
  if (textNodeIntersectionObserver) {
    textNodeIntersectionObserver.disconnect();
    textNodeIntersectionObserver = null;
  }

  if (textNodeMutationObserver) {
    textNodeMutationObserver.disconnect();
    textNodeMutationObserver = null;
  }

  parentToTextNodes = new Map();
  visibleTextNodes = new Set();
  textNodeToParent = new WeakMap();
  textNodeObserverInitialized = false;
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
  const startTime = performance.now();

  // 페이지 컨텍스트는 이미 분석됨 (handleTranslationToggle에서)
  const context = pageContext || {
    industry: 'general',
    category: 'general',
    translationGuidelines: ''
  };

  // 컨텍스트 기반 프롬프트 생성
  const prompt = buildContextualPrompt(texts, context);

  console.log(`[API] 번역 요청 시작 - ${texts.length}개 텍스트, 모델: ${model}`);

  try {
    const fetchStartTime = performance.now();
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

    const fetchEndTime = performance.now();
    const headerTime = fetchEndTime - fetchStartTime;
    console.log(`[API] 네트워크 요청 완료 - ${headerTime.toFixed(0)}ms`);

    const bodyReadStartTime = performance.now();
    const rawBody = await response.text();
    const bodyReadEndTime = performance.now();
    const bodyReadTime = bodyReadEndTime - bodyReadStartTime;
    console.log(`[API] 응답 본문 수신 완료 - ${bodyReadTime.toFixed(0)}ms`);

    if (!response.ok) {
      let errorMessage = response.statusText;
      try {
        const errorData = JSON.parse(rawBody);
        errorMessage = errorData.error?.message || errorMessage;
      } catch (errorParse) {
        console.warn('API 오류 응답 JSON 파싱 실패:', errorParse);
      }
      throw new Error(`API 오류: ${errorMessage}`);
    }

    // JSON 파싱 구간 시간을 분리해 병목을 쉽게 파악
    const jsonParseStartTime = performance.now();
    let data;
    try {
      data = JSON.parse(rawBody);
    } catch (jsonError) {
      const jsonParseFailTime = performance.now() - jsonParseStartTime;
      console.error(`[API] JSON 파싱 실패 (${jsonParseFailTime.toFixed(0)}ms):`, jsonError);
      throw new Error('번역 응답 JSON 파싱 실패');
    }
    const jsonParseEndTime = performance.now();
    const jsonParseTime = jsonParseEndTime - jsonParseStartTime;
    console.log(`[API] JSON 파싱 완료 - ${jsonParseTime.toFixed(0)}ms`);

    const translatedText = data.choices?.[0]?.message?.content || '';

    // 번역 결과 매핑 구간 시간을 별도로 계측
    const mappingStartTime = performance.now();
    const result = parseTranslationResult(translatedText, texts.length);
    const mappingEndTime = performance.now();
    const mappingTime = mappingEndTime - mappingStartTime;

    const totalTime = mappingEndTime - startTime;
    const averageTime = texts.length > 0 ? totalTime / texts.length : 0;

    console.log(`[API] 번역 매핑 완료 - ${mappingTime.toFixed(0)}ms`);
    console.log(`[API] 전체 API 호출 시간 - ${totalTime.toFixed(0)}ms (평균 ${averageTime.toFixed(0)}ms/개)`);
    console.log(`[API] 단계별 시간 요약 - 헤더: ${headerTime.toFixed(0)}ms, 본문: ${bodyReadTime.toFixed(0)}ms, JSON: ${jsonParseTime.toFixed(0)}ms, 매핑: ${mappingTime.toFixed(0)}ms`);

    // 번역 결과와 함께 측정된 단계별 시간 정보를 반환해 후속 로깅 및 모니터링에 활용
    return {
      translations: result,
      metrics: {
        headerTime,
        bodyReadTime,
        jsonParseTime,
        mappingTime,
        totalTime,
        averageTime
      }
    };

  } catch (error) {
    const errorTime = performance.now() - startTime;
    console.error(`[API] 번역 실패 (${errorTime.toFixed(0)}ms):`, error);
    throw error;
  }
}

// 번역 결과 파싱
function parseTranslationResult(translatedText, expectedCount) {
  const lines = translatedText.split('\n').filter(line => line.trim());
  const translationMap = new Map(); // index -> translation 매핑

  // [0], [1] 형식으로 파싱 시도
  lines.forEach(line => {
    const match = line.match(/^\[(\d+)\]\s*(.+)$/);
    if (match) {
      const index = parseInt(match[1]);
      const translation = match[2].trim();
      translationMap.set(index, translation);
    }
  });

  // Map을 배열로 변환 (순서 유지)
  const translations = [];
  for (let i = 0; i < expectedCount; i++) {
    translations[i] = translationMap.get(i) || null; // 없으면 null
  }

  // 매핑된 번역이 50% 미만이면 fallback (줄바꿈 기준)
  const mappedCount = translations.filter(t => t !== null).length;
  if (mappedCount < expectedCount * 0.5) {
    console.warn(`[파싱] 인덱스 매핑 실패 (${mappedCount}/${expectedCount}), fallback 사용`);
    const fallbackLines = translatedText.split('\n')
      .map(line => line.replace(/^\[\d+\]\s*/, '').trim()) // [0] 제거
      .filter(line => line.length > 0);

    // fallback도 expectedCount에 맞춰 반환
    return fallbackLines.slice(0, expectedCount).concat(
      Array(Math.max(0, expectedCount - fallbackLines.length)).fill(null)
    );
  }

  console.log(`[파싱] 성공: ${mappedCount}/${expectedCount}개 매핑됨`);
  return translations;
}

// 화면에 보이는 콘텐츠 번역
async function translateVisibleContent(apiKey, model, silentMode = false) {
  const totalStartTime = performance.now();
  console.log(`\n========== [번역 시작] ==========`);

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
    const scanStartTime = performance.now();
    const textNodes = getVisibleTextElements();
    const { texts, elements } = extractTextsForTranslation(textNodes);
    const scanEndTime = performance.now();
    console.log(`[스캔] 텍스트 노드 수집 완료 - ${textNodes.length}개 노드, ${texts.length}개 텍스트, ${(scanEndTime - scanStartTime).toFixed(0)}ms`);

    // 이미 번역된 요소는 제외
    const cacheCheckStartTime = performance.now();
    const cachedElements = []; // 캐시에서 가져올 요소
    const newTexts = []; // API 호출이 필요한 텍스트
    const newElements = []; // API 호출이 필요한 요소
    let alreadyTranslatedCount = 0;

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
      } else {
        alreadyTranslatedCount++;
      }
    });

    // 진행 상태 업데이트
    progressStatus.totalTexts = texts.length;
    progressStatus.translatedCount = alreadyTranslatedCount;
    progressStatus.cachedCount = cachedElements.length;

    const cacheCheckEndTime = performance.now();
    console.log(`[캐시] 체크 완료 - 이미 번역됨: ${alreadyTranslatedCount}개, 캐시 히트: ${cachedElements.length}개, 신규: ${newTexts.length}개, ${(cacheCheckEndTime - cacheCheckStartTime).toFixed(0)}ms`);

    // 캐시된 번역 즉시 적용 (requestAnimationFrame으로 최적화)
    const domUpdateStartTime = performance.now();
    let cachedCount = 0;

    if (cachedElements.length > 0) {
      await new Promise(resolve => {
        requestAnimationFrame(() => {
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
          resolve();
        });
      });
    }

    const domUpdateEndTime = performance.now();
    if (cachedCount > 0) {
      console.log(`[DOM] 캐시 번역 적용 - ${cachedCount}개, ${(domUpdateEndTime - domUpdateStartTime).toFixed(0)}ms`);
    }

    // API 호출이 필요한 텍스트가 없으면 종료
    if (newTexts.length === 0) {
      const totalTime = performance.now() - totalStartTime;
      console.log(`[완료] 번역할 새 텍스트 없음 - 전체 ${totalTime.toFixed(0)}ms`);
      console.log(`========== [번역 종료] ==========\n`);

      if (!silentMode && cachedCount > 0) {
        showNotification(`번역 완료! (캐시 사용: ${cachedCount}개)`, 'success');
      } else if (!silentMode) {
        showNotification('번역할 새로운 텍스트가 없습니다.', 'warning');
      }
      return;
    }

    console.log(`[배치] 신규 번역 필요 - ${newTexts.length}개 텍스트`);
    addProgressLog(`신규 번역 필요: ${newTexts.length}개 텍스트`, 'info');

    // 배치 크기로 나누어 번역 (한 번에 너무 많이 보내지 않도록)
    const batchSize = 50;
    const batches = [];

    for (let i = 0; i < newTexts.length; i += batchSize) {
      batches.push({
        texts: newTexts.slice(i, i + batchSize),
        elements: newElements.slice(i, i + batchSize)
      });
    }

    console.log(`[배치] ${batches.length}개 배치로 분할 (배치당 최대 ${batchSize}개)`);
    addProgressLog(`${batches.length}개 배치로 분할하여 처리`, 'info');

    // 진행 상태에 배치 정보 추가
    progressStatus.batchCount = batches.length;
    progressStatus.batches = batches.map((batch, index) => ({
      index,
      size: batch.texts.length,
      status: 'pending'
    }));

    let totalApiTime = 0;
    let totalDomTime = 0;
    let totalSuccessCount = 0;
    let totalFailedCount = 0;
    let slowestBatchByApi = { index: -1, apiTime: 0, domTime: 0, metrics: null, failureReason: '없음' };

    const concurrency = Math.max(1, Math.min(MAX_CONCURRENT_TRANSLATIONS, batches.length));
    console.log(`[배치] 최대 동시 처리 수: ${concurrency}개`);

    let nextBatchIndex = 0;
    let completedBatches = 0;

    const worker = async () => {
      while (true) {
        const batchIndex = nextBatchIndex;
        nextBatchIndex += 1;

        if (batchIndex >= batches.length) {
          break;
        }

        // 배치 상태 업데이트: processing
        if (progressStatus.batches[batchIndex]) {
          progressStatus.batches[batchIndex].status = 'processing';
        }
        progressStatus.currentBatch = batchIndex + 1;
        addProgressLog(`배치 ${batchIndex + 1}/${batches.length} 처리 시작`, 'info');

        const result = await processTranslationBatch(batches[batchIndex], {
          batchIndex,
          totalBatches: batches.length,
          apiKey,
          model
        });

        totalApiTime += result.apiTime;
        totalDomTime += result.domTime;
        totalSuccessCount += result.successCount;
        totalFailedCount += result.failedCount;

        // 배치 상태 업데이트: completed or failed
        if (progressStatus.batches[batchIndex]) {
          progressStatus.batches[batchIndex].status = result.failedCount > 0 ? 'failed' : 'completed';
        }

        // 번역 카운트 업데이트
        progressStatus.translatedCount = alreadyTranslatedCount + totalSuccessCount;

        if (result.failedCount > 0) {
          addProgressLog(`배치 ${batchIndex + 1} 완료 (성공: ${result.successCount}, 실패: ${result.failedCount})`, 'warning');
        } else {
          addProgressLog(`배치 ${batchIndex + 1} 완료 (${result.successCount}개 번역)`, 'success');
        }

        if (result.apiTime >= slowestBatchByApi.apiTime) {
          slowestBatchByApi = {
            index: batchIndex,
            apiTime: result.apiTime,
            domTime: result.domTime,
            metrics: result.apiMetrics,
            failureReason: result.failureReason
          };
        }

        completedBatches += 1;

        if (!silentMode) {
          showNotification(`번역 중... (완료 ${completedBatches}/${batches.length})`, 'info');
        }
      }
    };

    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);

    const totalEndTime = performance.now();
    const totalTime = totalEndTime - totalStartTime;

    console.log(`\n[요약] 전체 번역 완료:`);
    console.log(`  - 총 텍스트: ${texts.length}개 (신규: ${newTexts.length}개, 캐시: ${cachedCount}개, 이미번역: ${alreadyTranslatedCount}개)`);
    console.log(`  - 배치 수: ${batches.length}개`);
    console.log(`  - API 시간: ${totalApiTime.toFixed(0)}ms (${(totalApiTime / batches.length).toFixed(0)}ms/배치)`);
    console.log(`  - DOM 업데이트: ${totalDomTime.toFixed(0)}ms`);
    console.log(`  - 성공: ${totalSuccessCount}개, 실패: ${totalFailedCount}개`);
    console.log(`  - 전체 시간: ${totalTime.toFixed(0)}ms`);
    if (slowestBatchByApi.index >= 0) {
      const slowestBatchSummary = formatApiMetrics(slowestBatchByApi.metrics, slowestBatchByApi.apiTime);
      console.log(`  - 가장 느린 배치: #${slowestBatchByApi.index + 1} (${slowestBatchSummary}, DOM: ${slowestBatchByApi.domTime.toFixed(0)}ms, 실패 원인: ${slowestBatchByApi.failureReason})`);
    }
    console.log(`========== [번역 종료] ==========\n`);

    // 진행 상태 최종 업데이트
    progressStatus.translatedCount = alreadyTranslatedCount + totalSuccessCount + cachedCount;
    addProgressLog(`번역 완료! 총 ${progressStatus.translatedCount}개 (신규: ${totalSuccessCount}, 캐시: ${cachedCount}, 실패: ${totalFailedCount})`, 'success');

    if (!silentMode) {
      const totalMsg = cachedCount > 0
        ? `번역 완료! (새로 번역: ${newTexts.length}개, 캐시: ${cachedCount}개)`
        : `번역 완료! (${newTexts.length}개)`;
      showNotification(totalMsg, 'success');
    }

  } catch (error) {
    const totalTime = performance.now() - totalStartTime;
    console.error(`[오류] 번역 실패 (${totalTime.toFixed(0)}ms):`, error);
    console.log(`========== [번역 종료 (오류)] ==========\n`);
    addProgressLog(`번역 실패: ${error.message}`, 'error');
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
  markTranslatorUiElement(notification);

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
