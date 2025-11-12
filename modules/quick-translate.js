/**
 * Side Panel 텍스트 번역 기능
 *
 * 역할:
 * - 텍스트 붙여넣기 후 즉시 번역
 * - 번역 히스토리 저장 및 표시
 * - 원본 보기 토글
 * - OpenRouter API 호출
 */

import { logInfo, logError } from '../logger.js';
import { showToast } from './ui-utils.js';

// ===== 상수 =====
const DEFAULT_MODEL = 'openai/gpt-4o-mini';
const MAX_HISTORY_COUNT = 50; // 최대 히스토리 저장 개수
const STORAGE_KEY = 'quickTranslationHistory';

// ===== 텍스트 번역 탭 초기화 =====

/**
 * 텍스트 번역 탭 초기화
 */
export async function initQuickTranslateTab() {
  const translateBtn = document.getElementById('quickTranslateBtn');
  const clearHistoryBtn = document.getElementById('quickClearHistoryBtn');
  const textInput = document.getElementById('quickTextInput');

  // 이전 리스너 제거 후 다시 등록 (중복 방지)
  if (translateBtn) {
    translateBtn.removeEventListener('click', handleTranslateText);
    translateBtn.addEventListener('click', handleTranslateText);
  }

  if (clearHistoryBtn) {
    clearHistoryBtn.removeEventListener('click', handleClearHistory);
    clearHistoryBtn.addEventListener('click', handleClearHistory);
  }

  // 입력창 키다운 핸들러 (Ctrl+Enter로 번역)
  if (textInput) {
    textInput.removeEventListener('keydown', handleTextInputKeydown);
    textInput.addEventListener('keydown', handleTextInputKeydown);
  }

  // 히스토리 로드
  await loadTranslationHistory();

  logInfo('quickTranslate', 'INIT', '텍스트 번역 탭 초기화 완료');
}

/**
 * 입력창 키다운 핸들러 (Ctrl+Enter로 번역)
 */
function handleTextInputKeydown(event) {
  if (event.ctrlKey && event.key === 'Enter') {
    event.preventDefault();
    handleTranslateText();
  }
}

/**
 * 번역 버튼 클릭 핸들러
 */
async function handleTranslateText() {
  const textInput = document.getElementById('quickTextInput');
  const resultContainer = document.getElementById('quickTranslationResult');
  const translateBtn = document.getElementById('quickTranslateBtn');

  const text = textInput.value.trim();

  if (!text) {
    showToast('번역할 텍스트를 입력해주세요.', 'error');
    return;
  }

  // API Key 확인
  const result = await chrome.storage.local.get(['apiKey']);
  const apiKey = result.apiKey;

  if (!apiKey) {
    showToast('API Key가 설정되지 않았습니다. 설정 탭에서 설정해주세요.', 'error');
    return;
  }

  // 번역 시작
  translateBtn.disabled = true;
  translateBtn.textContent = '번역 중...';
  resultContainer.innerHTML = '<div class="quick-loading"><div class="spinner"></div><span>번역 중...</span></div>';
  resultContainer.style.display = 'block';

  try {
    const translation = await callOpenRouterTranslate(text, apiKey);

    // 결과 표시
    displayTranslationResult(text, translation);

    // 히스토리 저장
    await saveTranslationHistory(text, translation);

    // 히스토리 다시 로드
    await loadTranslationHistory();

    // 입력 영역 비우기 (다음 번역을 위해)
    textInput.value = '';

    showToast('번역이 완료되었습니다!');
    logInfo('quickTranslate', 'TRANSLATE_SUCCESS', '번역 성공', {
      originalLength: text.length,
      translationLength: translation.length
    });
  } catch (error) {
    logError('quickTranslate', 'TRANSLATE_ERROR', '번역 실패', {}, error);
    resultContainer.innerHTML = `<div class="quick-error">❌ 번역 중 오류가 발생했습니다: ${error.message}</div>`;
    showToast('번역 중 오류가 발생했습니다: ' + error.message, 'error');
  } finally {
    translateBtn.disabled = false;
    translateBtn.textContent = '번역';
  }
}

/**
 * OpenRouter API로 번역하기
 * @param {string} text - 원문 텍스트
 * @param {string} apiKey - API Key
 * @returns {Promise<string>} 번역된 텍스트
 */
async function callOpenRouterTranslate(text, apiKey) {
  const model = (await chrome.storage.local.get(['model'])).model || DEFAULT_MODEL;

  const prompt = `다음 텍스트를 한글로 번역해주세요. 자연스럽고 정확하게 번역하되, 원문의 의미를 최대한 유지해주세요.

원문:
${text}

번역:`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.href,
      'X-Title': 'Quick Translate'
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: prompt
      }],
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || `API error: ${response.statusText}`);
  }

  const data = await response.json();
  const translation = data.choices[0]?.message?.content?.trim() || '';

  if (!translation) {
    throw new Error('번역 결과가 비어있습니다.');
  }

  return translation;
}

/**
 * 번역 결과 표시
 * @param {string} original - 원문
 * @param {string} translation - 번역문
 */
function displayTranslationResult(original, translation) {
  const resultContainer = document.getElementById('quickTranslationResult');

  const html = `
    <div class="quick-result-card">
      <div class="quick-result-header">
        <span class="quick-result-label">번역 결과</span>
        <button class="quick-toggle-original" data-original="${escapeHtml(original)}">원문 보기</button>
      </div>
      <div class="quick-result-text">${escapeHtml(translation)}</div>
    </div>
  `;

  resultContainer.innerHTML = html;
  resultContainer.style.display = 'block';

  // 원문 보기 토글 버튼
  const toggleBtn = resultContainer.querySelector('.quick-toggle-original');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', handleToggleOriginal);
  }
}

/**
 * 원문 보기 토글
 */
function handleToggleOriginal(event) {
  const btn = event.target;
  const textEl = btn.closest('.quick-result-card').querySelector('.quick-result-text');
  const original = btn.dataset.original;
  const currentText = textEl.textContent;

  if (btn.textContent === '원문 보기') {
    // 현재 번역문을 저장하고 원문 표시
    btn.dataset.translation = currentText;
    textEl.textContent = original;
    btn.textContent = '번역문 보기';
  } else {
    // 번역문으로 복원
    textEl.textContent = btn.dataset.translation;
    btn.textContent = '원문 보기';
  }
}

/**
 * HTML 이스케이프
 * @param {string} str - 이스케이프할 문자열
 * @returns {string} 이스케이프된 문자열
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ===== 히스토리 관리 =====

/**
 * 번역 히스토리 저장
 * @param {string} original - 원문
 * @param {string} translation - 번역문
 */
async function saveTranslationHistory(original, translation) {
  try {
    // 기존 히스토리 로드
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    let history = result[STORAGE_KEY] || [];

    // 새 항목 추가 (최신이 맨 앞)
    const newItem = {
      id: Date.now(),
      original,
      translation,
      timestamp: Date.now()
    };

    history.unshift(newItem);

    // 최대 개수 제한
    if (history.length > MAX_HISTORY_COUNT) {
      history = history.slice(0, MAX_HISTORY_COUNT);
    }

    // 저장
    await chrome.storage.local.set({ [STORAGE_KEY]: history });

    logInfo('quickTranslate', 'HISTORY_SAVED', '히스토리 저장 완료', { count: history.length });
  } catch (error) {
    logError('quickTranslate', 'HISTORY_SAVE_ERROR', '히스토리 저장 실패', {}, error);
  }
}

/**
 * 번역 히스토리 로드 및 렌더링
 */
export async function loadTranslationHistory() {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    const history = result[STORAGE_KEY] || [];

    renderTranslationHistory(history);

    logInfo('quickTranslate', 'HISTORY_LOADED', '히스토리 로드 완료', { count: history.length });
  } catch (error) {
    logError('quickTranslate', 'HISTORY_LOAD_ERROR', '히스토리 로드 실패', {}, error);
  }
}

/**
 * 번역 히스토리 렌더링
 * @param {Array} history - 히스토리 배열
 */
function renderTranslationHistory(history) {
  const listContainer = document.getElementById('quickHistoryList');
  const emptyEl = document.getElementById('quickHistoryEmpty');

  if (!listContainer || !emptyEl) return;

  if (history.length === 0) {
    listContainer.style.display = 'none';
    emptyEl.style.display = 'flex';
    return;
  }

  listContainer.style.display = 'flex';
  emptyEl.style.display = 'none';

  // 히스토리 아이템 렌더링 (최신순)
  const html = history.map(item => {
    const date = new Date(item.timestamp);
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

    return `
      <div class="quick-history-item" data-id="${item.id}">
        <div class="quick-history-body">
          <div class="quick-history-translation">${escapeHtml(item.translation)}</div>
          <div class="quick-history-original collapsed">${escapeHtml(item.original)}</div>
          <div class="quick-history-meta">
            <span>${dateStr}</span>
            <button class="quick-history-toggle" data-id="${item.id}">원문 보기</button>
          </div>
        </div>
        <button class="quick-history-delete" data-id="${item.id}" title="삭제">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
        </button>
      </div>
    `;
  }).join('');

  listContainer.innerHTML = html;

  // 이벤트 리스너 등록
  listContainer.querySelectorAll('.quick-history-toggle').forEach(btn => {
    btn.addEventListener('click', handleToggleHistoryOriginal);
  });

  listContainer.querySelectorAll('.quick-history-delete').forEach(btn => {
    btn.addEventListener('click', handleDeleteHistoryItem);
  });
}

/**
 * 히스토리 아이템 원문 토글
 */
function handleToggleHistoryOriginal(event) {
  const btn = event.target;
  const item = btn.closest('.quick-history-item');
  const originalEl = item.querySelector('.quick-history-original');
  const translationEl = item.querySelector('.quick-history-translation');

  if (originalEl.classList.contains('collapsed')) {
    // 원문 표시
    originalEl.classList.remove('collapsed');
    translationEl.classList.add('collapsed');
    btn.textContent = '번역문 보기';
  } else {
    // 번역문 표시
    originalEl.classList.add('collapsed');
    translationEl.classList.remove('collapsed');
    btn.textContent = '원문 보기';
  }
}

/**
 * 히스토리 아이템 삭제
 */
async function handleDeleteHistoryItem(event) {
  const btn = event.target.closest('.quick-history-delete');
  const id = parseInt(btn.dataset.id);

  try {
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    let history = result[STORAGE_KEY] || [];

    // 해당 아이템 제거
    history = history.filter(item => item.id !== id);

    // 저장
    await chrome.storage.local.set({ [STORAGE_KEY]: history });

    // 다시 렌더링
    await loadTranslationHistory();

    showToast('삭제되었습니다.');
    logInfo('quickTranslate', 'HISTORY_ITEM_DELETED', '히스토리 아이템 삭제', { id });
  } catch (error) {
    logError('quickTranslate', 'HISTORY_DELETE_ERROR', '히스토리 삭제 실패', {}, error);
    showToast('삭제 중 오류가 발생했습니다.', 'error');
  }
}

// 전체 삭제 확인 상태 관리
let clearHistoryConfirmTimer = null;

/**
 * 히스토리 전체 삭제
 */
async function handleClearHistory(event) {
  const btn = event.target;

  // 이미 확인 모드인 경우 → 실제 삭제 실행
  if (btn.classList.contains('confirm-mode')) {
    // 타이머 취소
    if (clearHistoryConfirmTimer) {
      clearTimeout(clearHistoryConfirmTimer);
      clearHistoryConfirmTimer = null;
    }

    // 원래 상태로 복원
    btn.classList.remove('confirm-mode');
    btn.textContent = '전체 삭제';

    // 실제 삭제 실행
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: [] });
      await loadTranslationHistory();
      showToast('모든 기록이 삭제되었습니다.');
      logInfo('quickTranslate', 'HISTORY_CLEARED', '히스토리 전체 삭제');
    } catch (error) {
      logError('quickTranslate', 'HISTORY_CLEAR_ERROR', '히스토리 삭제 실패', {}, error);
      showToast('삭제 중 오류가 발생했습니다.', 'error');
    }
  } else {
    // 첫 클릭 → 확인 모드로 전환
    btn.classList.add('confirm-mode');
    btn.textContent = '정말 삭제하시겠습니까?';

    // 3초 후 자동으로 원래 상태로 복원
    clearHistoryConfirmTimer = setTimeout(() => {
      btn.classList.remove('confirm-mode');
      btn.textContent = '전체 삭제';
      clearHistoryConfirmTimer = null;
    }, 3000);
  }
}
