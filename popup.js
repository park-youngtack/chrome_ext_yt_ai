// 설정 로드
document.addEventListener('DOMContentLoaded', async () => {
  const result = await chrome.storage.local.get(['apiKey', 'model']);

  if (result.apiKey) {
    document.getElementById('apiKey').value = result.apiKey;
  }

  if (result.model) {
    document.getElementById('model').value = result.model;
  } else {
    document.getElementById('model').value = 'anthropic/claude-3.5-sonnet';
  }
});

// 설정 저장
document.getElementById('saveBtn').addEventListener('click', async () => {
  const apiKey = document.getElementById('apiKey').value.trim();
  const model = document.getElementById('model').value;

  if (!apiKey) {
    showStatus('API Key를 입력해주세요.', 'error');
    return;
  }

  try {
    await chrome.storage.local.set({ apiKey, model });
    showStatus('설정이 저장되었습니다!', 'success');
  } catch (error) {
    showStatus('저장 중 오류가 발생했습니다: ' + error.message, 'error');
  }
});

// 번역 버튼
document.getElementById('translateBtn').addEventListener('click', async () => {
  const result = await chrome.storage.local.get(['apiKey', 'model']);

  if (!result.apiKey) {
    showStatus('먼저 API Key를 설정해주세요.', 'error');
    return;
  }

  try {
    // 현재 활성 탭 가져오기
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // content script에 번역 메시지 전송
    await chrome.tabs.sendMessage(tab.id, {
      action: 'toggleTranslation',
      apiKey: result.apiKey,
      model: result.model
    });

    showStatus('번역을 시작합니다...', 'success');

    // 3초 후 팝업 닫기
    setTimeout(() => {
      window.close();
    }, 1500);

  } catch (error) {
    showStatus('번역 중 오류: ' + error.message, 'error');
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
