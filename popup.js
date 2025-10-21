// 기본 모델
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

// 설정 로드
document.addEventListener('DOMContentLoaded', async () => {
  const result = await chrome.storage.local.get(['apiKey', 'model', 'autoPauseEnabled', 'autoPauseTimeout']);

  if (result.apiKey) {
    document.getElementById('apiKey').value = result.apiKey;
  }

  if (result.model) {
    document.getElementById('model').value = result.model;
  }

  // 자동 일시정지 설정 로드
  if (result.autoPauseEnabled !== undefined) {
    document.getElementById('autoPauseEnabled').checked = result.autoPauseEnabled;
  }

  if (result.autoPauseTimeout) {
    document.getElementById('autoPauseTimeout').value = result.autoPauseTimeout;
  }

  // 번역 상태 및 버튼 텍스트 업데이트
  await updateTranslationStatus();
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
    await chrome.storage.local.set({ apiKey, model, autoPauseEnabled, autoPauseTimeout });
    showStatus(`설정이 저장되었습니다! (모델: ${model})`, 'success');
  } catch (error) {
    showStatus('저장 중 오류가 발생했습니다: ' + error.message, 'error');
  }
});

// 번역 상태 및 버튼 텍스트 업데이트
async function updateTranslationStatus() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // content script에서 번역 상태 가져오기
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'getTranslationState'
    });

    const translateBtn = document.getElementById('translateBtn');
    const statusValue = document.getElementById('statusValue');
    const state = response?.state || 'inactive';

    if (state === 'active') {
      // 번역 중
      translateBtn.textContent = '원본 페이지 보기(번역 중지)';
      translateBtn.style.backgroundColor = '#FF9800'; // 주황색
      statusValue.textContent = '번역중';
      statusValue.style.color = '#FF9800';
    } else if (state === 'paused') {
      // 번역 중지됨 (자동 일시정지)
      translateBtn.textContent = '번역 작업 시작';
      translateBtn.style.backgroundColor = '#4CAF50'; // 녹색
      statusValue.textContent = '번역 중지됨';
      statusValue.style.color = '#F44336';
    } else {
      // 원본 페이지
      translateBtn.textContent = '이 페이지 번역하기';
      translateBtn.style.backgroundColor = '#2196F3'; // 파란색
      statusValue.textContent = '원본 페이지';
      statusValue.style.color = '#1565c0';
    }
  } catch (error) {
    // content script가 로드되지 않은 경우 기본 텍스트 사용
    console.log('번역 상태 확인 불가:', error.message);
    document.getElementById('translateBtn').textContent = '이 페이지 번역하기';
    document.getElementById('statusValue').textContent = '원본 페이지';
  }
}

// 번역 버튼
document.getElementById('translateBtn').addEventListener('click', async () => {
  const result = await chrome.storage.local.get(['apiKey', 'model', 'autoPauseEnabled', 'autoPauseTimeout']);

  if (!result.apiKey) {
    showStatus('먼저 API Key를 설정해주세요.', 'error');
    return;
  }

  // 모델이 없으면 기본 모델 사용
  const model = result.model || DEFAULT_MODEL;
  const autoPauseEnabled = result.autoPauseEnabled !== false; // 기본값 true
  const autoPauseTimeout = result.autoPauseTimeout || 60;

  try {
    // 현재 활성 탭 가져오기
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // 현재 상태 확인
    const stateResponse = await chrome.tabs.sendMessage(tab.id, {
      action: 'getTranslationState'
    });
    const currentState = stateResponse?.state || 'inactive';

    // paused 상태면 재개, 그 외에는 토글
    if (currentState === 'paused') {
      // 번역 재개
      await chrome.tabs.sendMessage(tab.id, {
        action: 'resumeTranslation'
      });
      showStatus('번역을 재개합니다...', 'success');
    } else {
      // 번역 토글
      await chrome.tabs.sendMessage(tab.id, {
        action: 'toggleTranslation',
        apiKey: result.apiKey,
        model: model,
        autoPauseEnabled: autoPauseEnabled,
        autoPauseTimeout: autoPauseTimeout
      });
      showStatus('처리 중...', 'success');
    }

    // 1.5초 후 팝업 닫기
    setTimeout(() => {
      window.close();
    }, 1500);

  } catch (error) {
    showStatus('오류: ' + error.message, 'error');
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
