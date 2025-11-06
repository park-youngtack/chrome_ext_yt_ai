import { FOOTER_TEXT } from './meta.js';

// 기본 모델
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

// 설정 로드
document.addEventListener('DOMContentLoaded', async () => {
  // 푸터 텍스트 설정
  const footerEl = document.getElementById('footerText');
  if (footerEl) {
    footerEl.textContent = FOOTER_TEXT;
  }

  const result = await chrome.storage.local.get([
    'apiKey',
    'model',
    'batchSize',
    'concurrency',
    'useCache'
  ]);

  // API 설정
  if (result.apiKey) {
    document.getElementById('apiKey').value = result.apiKey;
  }

  if (result.model) {
    document.getElementById('model').value = result.model;
  }

  // 번역 설정
  if (result.batchSize) {
    document.getElementById('batchSize').value = result.batchSize;
  } else {
    document.getElementById('batchSize').value = 50;
  }

  if (result.concurrency) {
    document.getElementById('concurrency').value = result.concurrency;
  } else {
    document.getElementById('concurrency').value = 3;
  }

  if (result.useCache !== undefined) {
    document.getElementById('useCache').checked = result.useCache;
  } else {
    document.getElementById('useCache').checked = true; // 기본값 true
  }
});

// 설정 저장
document.getElementById('saveBtn').addEventListener('click', async () => {
  const apiKey = document.getElementById('apiKey').value.trim();
  const modelInput = document.getElementById('model').value.trim();
  const batchSize = parseInt(document.getElementById('batchSize').value) || 50;
  const concurrency = parseInt(document.getElementById('concurrency').value) || 3;
  const useCache = document.getElementById('useCache').checked;

  // 모델이 비어있으면 기본 모델 사용
  const model = modelInput || DEFAULT_MODEL;

  if (!apiKey) {
    showStatus('API Key를 입력해주세요.', 'error');
    return;
  }

  // 배치 크기 유효성 검사
  if (batchSize < 10 || batchSize > 100) {
    showStatus('배치 크기는 10~100 사이여야 합니다.', 'error');
    return;
  }

  // 동시 처리 개수 유효성 검사
  if (concurrency < 1 || concurrency > 10) {
    showStatus('동시 처리 개수는 1~10 사이여야 합니다.', 'error');
    return;
  }

  try {
    await chrome.storage.local.set({
      apiKey,
      model,
      batchSize,
      concurrency,
      useCache
    });

    showStatus(`✅ 설정이 저장되었습니다! (모델: ${model})`, 'success');
  } catch (error) {
    showStatus('❌ 저장 중 오류가 발생했습니다: ' + error.message, 'error');
  }
});

function showStatus(message, type) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = message;
  statusEl.className = 'status ' + type;

  if (type === 'success') {
    setTimeout(() => {
      statusEl.style.display = 'none';
    }, 3000);
  }
}
