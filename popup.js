// 기본 모델
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

// 설정 로드
document.addEventListener('DOMContentLoaded', async () => {
  const result = await chrome.storage.local.get(['apiKey', 'model']);

  if (result.apiKey) {
    document.getElementById('apiKey').value = result.apiKey;
  }

  if (result.model) {
    document.getElementById('model').value = result.model;
  }

  // 번역 버튼 텍스트 업데이트
  await updateTranslateButtonText();
});

// 설정 저장
document.getElementById('saveBtn').addEventListener('click', async () => {
  const apiKey = document.getElementById('apiKey').value.trim();
  const modelInput = document.getElementById('model').value.trim();

  // 모델이 비어있으면 기본 모델 사용
  const model = modelInput || DEFAULT_MODEL;

  if (!apiKey) {
    showStatus('API Key를 입력해주세요.', 'error');
    return;
  }

  try {
    await chrome.storage.local.set({ apiKey, model });
    showStatus(`설정이 저장되었습니다! (모델: ${model})`, 'success');
  } catch (error) {
    showStatus('저장 중 오류가 발생했습니다: ' + error.message, 'error');
  }
});

// 번역 버튼 텍스트 업데이트
async function updateTranslateButtonText() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // content script에서 번역 상태 가져오기
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'getTranslationState'
    });

    const translateBtn = document.getElementById('translateBtn');
    if (response && response.isTranslated) {
      translateBtn.textContent = '원본 페이지 보기';
      translateBtn.style.backgroundColor = '#FF9800'; // 주황색
    } else {
      translateBtn.textContent = '이 페이지 번역하기';
      translateBtn.style.backgroundColor = '#2196F3'; // 파란색
    }
  } catch (error) {
    // content script가 로드되지 않은 경우 기본 텍스트 사용
    console.log('번역 상태 확인 불가:', error.message);
  }
}

// 번역 버튼
document.getElementById('translateBtn').addEventListener('click', async () => {
  const result = await chrome.storage.local.get(['apiKey', 'model']);

  if (!result.apiKey) {
    showStatus('먼저 API Key를 설정해주세요.', 'error');
    return;
  }

  // 모델이 없으면 기본 모델 사용
  const model = result.model || DEFAULT_MODEL;

  try {
    // 현재 활성 탭 가져오기
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // content script에 번역 메시지 전송
    await chrome.tabs.sendMessage(tab.id, {
      action: 'toggleTranslation',
      apiKey: result.apiKey,
      model: model
    });

    showStatus('처리 중...', 'success');

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
