/**
 * Side Panel 검색 기능
 *
 * 역할:
 * - AI 기반 검색 키워드 추천
 * - 검색 엔진 열기 (Google, Naver, Bing, ChatGPT, Perplexity)
 * - OpenRouter API 호출
 */

import { logInfo, logError } from '../logger.js';
import { showToast } from './ui-utils.js';

// ===== 상수 =====
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

// ===== 검색 엔진 아이콘 =====

/**
 * Google 파비콘
 */
export function getGoogleIcon() {
  return `<img class="search-engine-icon" alt="Google" width="24" height="24" src="https://www.google.com/s2/favicons?sz=128&domain=google.com" style="width: 20px; height: 20px;">`;
}

/**
 * Naver 파비콘
 */
export function getNaverIcon() {
  return `<img class="search-engine-icon" alt="Naver" width="24" height="24" src="https://www.google.com/s2/favicons?sz=128&domain=naver.com" style="width: 20px; height: 20px;">`;
}

/**
 * Bing 파비콘
 */
export function getBingIcon() {
  return `<img class="search-engine-icon" alt="Bing" width="24" height="24" src="https://www.google.com/s2/favicons?sz=128&domain=bing.com" style="width: 20px; height: 20px;">`;
}

/**
 * ChatGPT 파비콘
 */
export function getChatGPTIcon() {
  return `<img class="search-engine-icon" alt="ChatGPT" width="24" height="24" src="https://www.google.com/s2/favicons?sz=128&domain=chatgpt.com" style="width: 20px; height: 20px;">`;
}

/**
 * Perplexity 파비콘
 */
export function getPerplexityIcon() {
  return `<img class="search-engine-icon" alt="Perplexity" width="24" height="24" src="https://www.google.com/s2/favicons?sz=128&domain=perplexity.ai" style="width: 20px; height: 20px;">`;
}

// ===== 검색 탭 초기화 =====

/**
 * 검색 탭 초기화
 */
export function initializeSearchTab() {
  const searchInput = document.getElementById('searchInput');
  const getRecommendationsBtn = document.getElementById('getRecommendationsBtn');

  // 이전 리스너 제거 후 다시 등록 (중복 방지)
  getRecommendationsBtn.removeEventListener('click', handleGetRecommendations);
  getRecommendationsBtn.addEventListener('click', handleGetRecommendations);

  // 입력 내용 변경 시 추천 초기화
  searchInput.removeEventListener('input', resetSearchRecommendations);
  searchInput.addEventListener('input', resetSearchRecommendations);

  // 엔터 키로 추천 받기
  searchInput.removeEventListener('keydown', handleSearchKeydown);
  searchInput.addEventListener('keydown', handleSearchKeydown);
}

/**
 * 검색 입력창 키다운 핸들러 (Enter로 추천)
 */
function handleSearchKeydown(event) {
  // Enter 키일 때 추천 받기 (줄바꿈 방지)
  if (event.key === 'Enter') {
    event.preventDefault();
    handleGetRecommendations();
  }
}

/**
 * 추천 받기 버튼 클릭 핸들러
 */
async function handleGetRecommendations() {
  const searchInput = document.getElementById('searchInput');
  const query = searchInput.value.trim();

  if (!query) {
    showToast('검색 내용을 입력해주세요.', 'error');
    return;
  }

  // API Key 확인
  const result = await chrome.storage.local.get(['apiKey']);
  const apiKey = result.apiKey;

  if (!apiKey) {
    showToast('API Key가 설정되지 않았습니다. 설정 탭에서 설정해주세요.', 'error');
    return;
  }

  // 로딩 상태 표시
  const loadingEl = document.getElementById('searchLoadingState');
  loadingEl.style.display = 'flex';

  try {
    const container = document.getElementById('searchRecommendations');
    const currentCount = container.children.length;

    // 최대 10개까지만 표시 (사용자 입력 1개 + AI 추천 9개)
    if (currentCount >= 10) {
      showToast('최대 10개의 검색 추천을 표시할 수 있습니다.', 'error');
      return;
    }

    let recommendations = [];

    // 첫 번째 추천일 때만 사용자 입력값을 첫 번째 항목으로 추가
    if (currentCount === 0) {
      recommendations.push(query);
    }

    // AI 추천 3개 추가 (하지만 전체 10개를 넘지 않도록)
    const aiRecommendations = await callOpenRouterSearch(query, apiKey);
    const remainingSlots = 10 - currentCount - (currentCount === 0 ? 1 : 0);
    recommendations.push(...aiRecommendations.slice(0, Math.min(3, remainingSlots)));

    renderSearchRecommendations(recommendations);
    logInfo('sidepanel', 'SEARCH_SUCCESS', '검색 추천 완료', { count: recommendations.length });
  } catch (error) {
    logError('sidepanel', 'SEARCH_ERROR', '검색 실패', {}, error);
    showToast('검색 생성 중 오류가 발생했습니다: ' + error.message, 'error');
  } finally {
    loadingEl.style.display = 'none';
  }
}

/**
 * OpenRouter API로 검색문 추천 받기
 */
async function callOpenRouterSearch(query, apiKey) {
  const model = (await chrome.storage.local.get(['model'])).model || DEFAULT_MODEL;

  const prompt = `사용자가 다음과 같은 내용을 검색하려고 합니다. 최적의 검색 키워드 3개를 생성해주세요.

사용자의 검색 목적: "${query}"

요구사항:
1. 각 검색 키워드는 실제로 검색 엔진에서 잘 작동하도록 최적화되어야 합니다.
2. 원문의 의도를 유지하면서 가장 효과적인 검색문을 만들어야 합니다.
3. 한국어나 영문 또는 섞여서 사용 가능합니다.
4. 각 검색문은 1줄씩 출력하고, 번호를 붙이지 마세요.

검색 키워드:`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.href,
      'X-Title': 'Smart Search'
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: prompt
      }],
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || `API error: ${response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content || '';

  // 응답에서 검색문들 파싱
  const lines = content.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  return lines.slice(0, 3);
}

/**
 * 검색 추천 리스트 렌더링 (누적)
 */
export function renderSearchRecommendations(newRecommendations) {
  const container = document.getElementById('searchRecommendations');
  const emptyEl = document.getElementById('searchEmpty');

  // 기존 리스트에 새 추천 누적
  if (newRecommendations && newRecommendations.length > 0) {
    newRecommendations.forEach(query => {
      const itemEl = document.createElement('div');
      itemEl.className = 'search-item';

      const textEl = document.createElement('div');
      textEl.className = 'search-item-text';
      textEl.textContent = query;

      const enginesEl = document.createElement('div');
      enginesEl.className = 'search-item-engines';

      // 검색 엔진 버튼들 추가
      const engines = [
        { name: 'google', label: 'Google', svg: getGoogleIcon() },
        { name: 'naver', label: 'Naver', svg: getNaverIcon() },
        { name: 'bing', label: 'Bing', svg: getBingIcon() },
        { name: 'chatgpt', label: 'ChatGPT', svg: getChatGPTIcon() },
        { name: 'perplexity', label: 'Perplexity', svg: getPerplexityIcon() }
      ];

      engines.forEach(engine => {
        const btn = document.createElement('button');
        btn.className = 'search-engine-btn';
        btn.innerHTML = engine.svg;
        btn.title = engine.label;
        btn.setAttribute('data-engine', engine.name);
        btn.onclick = () => openSearchResults(engine.name, query);
        enginesEl.appendChild(btn);
      });

      // All 버튼
      const allBtn = document.createElement('button');
      allBtn.className = 'search-engine-btn all';
      allBtn.textContent = 'All';
      allBtn.title = '모든 검색 엔진에서 검색';
      allBtn.onclick = () => openAllSearchEngines(query);
      enginesEl.appendChild(allBtn);

      itemEl.appendChild(textEl);
      itemEl.appendChild(enginesEl);
      container.appendChild(itemEl);
    });

    // 빈 상태 숨기기
    emptyEl.classList.add('hidden');
  }
}

/**
 * 검색 추천 초기화 (입력 내용 변경 시)
 */
export function resetSearchRecommendations() {
  const container = document.getElementById('searchRecommendations');
  const emptyEl = document.getElementById('searchEmpty');

  // 입력값이 변경되면 기존 추천 초기화
  container.innerHTML = '';
  emptyEl.classList.remove('hidden');
}

/**
 * 특정 검색 엔진에서 검색
 */
function openSearchResults(engine, query) {
  const encodedQuery = encodeURIComponent(query);
  let url;

  switch (engine) {
    case 'google':
      url = `https://www.google.com/search?q=${encodedQuery}`;
      break;
    case 'naver':
      url = `https://search.naver.com/search.naver?query=${encodedQuery}`;
      break;
    case 'bing':
      url = `https://www.bing.com/search?q=${encodedQuery}`;
      break;
    case 'chatgpt':
      url = `https://chat.openai.com/?q=${encodedQuery}`;
      break;
    case 'perplexity':
      url = `https://www.perplexity.ai/search?q=${encodedQuery}`;
      break;
    default:
      return;
  }

  chrome.tabs.create({ url, active: false });
  logInfo('sidepanel', 'SEARCH_OPENED', '검색 탭 열음', { engine, query });
}

/**
 * 모든 검색 엔진에서 동시 검색
 */
export function openAllSearchEngines(query) {
  const encodedQuery = encodeURIComponent(query);

  // 5개 엔진에서 모두 검색
  const urls = [
    `https://www.google.com/search?q=${encodedQuery}`,
    `https://search.naver.com/search.naver?query=${encodedQuery}`,
    `https://www.bing.com/search?q=${encodedQuery}`,
    `https://chat.openai.com/?q=${encodedQuery}`,
    `https://www.perplexity.ai/search?q=${encodedQuery}`
  ];

  urls.forEach(url => {
    chrome.tabs.create({ url, active: false });
  });

  logInfo('sidepanel', 'SEARCH_ALL_OPENED', '모든 검색 엔진에서 검색', { query });
  showToast(`"${query}"를 5개 검색 엔진에서 열었습니다!`);
}
