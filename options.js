// 기본 모델
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

// 설정 로드
document.addEventListener('DOMContentLoaded', async () => {
  const result = await chrome.storage.local.get([
    'apiKey',
    'model',
    'autoPauseEnabled',
    'autoPauseTimeout'
  ]);

  // API 설정
  if (result.apiKey) {
    document.getElementById('apiKey').value = result.apiKey;
  }

  if (result.model) {
    document.getElementById('model').value = result.model;
  }

  // 자동 일시정지 설정
  if (result.autoPauseEnabled !== undefined) {
    document.getElementById('autoPauseEnabled').checked = result.autoPauseEnabled;
  } else {
    document.getElementById('autoPauseEnabled').checked = true; // 기본값 true
  }

  if (result.autoPauseTimeout) {
    document.getElementById('autoPauseTimeout').value = result.autoPauseTimeout;
  }
});

// 설정 저장
document.getElementById('saveBtn').addEventListener('click', async () => {
  const apiKey = document.getElementById('apiKey').value.trim();
  const modelInput = document.getElementById('model').value.trim();
  const autoPauseEnabled = document.getElementById('autoPauseEnabled').checked;
  const autoPauseTimeout = parseInt(document.getElementById('autoPauseTimeout').value) || 60;

  // 모델이 비어있으면 기본 모델 사용
  const model = modelInput || DEFAULT_MODEL;

  if (!apiKey) {
    showStatus('API Key를 입력해주세요.', 'error');
    return;
  }

  // 자동 일시정지 시간 유효성 검사
  if (autoPauseTimeout < 10 || autoPauseTimeout > 600) {
    showStatus('자동 일시정지 시간은 10~600초 사이여야 합니다.', 'error');
    return;
  }

  try {
    await chrome.storage.local.set({
      apiKey,
      model,
      autoPauseEnabled,
      autoPauseTimeout
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
