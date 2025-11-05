// 기본 모델
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

// 설정 로드 및 상태 업데이트
document.addEventListener('DOMContentLoaded', async () => {
  await updateTranslationStatus();
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
    const statusBadge = document.getElementById('statusBadge');
    const state = response?.state || 'inactive';

    if (state === 'active') {
      // 번역 중
      translateBtn.textContent = '⏸️ 번역 중지';
      translateBtn.style.background = 'linear-gradient(135deg, #f59e0b, #ef4444)';
      statusBadge.textContent = '번역 중';
      statusBadge.className = 'status-badge active pulse';
    } else if (state === 'paused') {
      // 번역 중지됨 (자동 일시정지)
      translateBtn.textContent = '▶️ 번역 재개';
      translateBtn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
      statusBadge.textContent = '일시정지';
      statusBadge.className = 'status-badge paused';
    } else {
      // 원본 페이지
      translateBtn.textContent = '▶️ 번역 시작';
      translateBtn.style.background = 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))';
      statusBadge.textContent = '대기 중';
      statusBadge.className = 'status-badge inactive';
    }
  } catch (error) {
    // content script가 로드되지 않은 경우 기본 텍스트 사용
    console.log('번역 상태 확인 불가:', error.message);
    document.getElementById('translateBtn').textContent = '▶️ 번역 시작';
    document.getElementById('statusBadge').textContent = '대기 중';
    document.getElementById('statusBadge').className = 'status-badge inactive';
  }
}

// 번역 버튼
document.getElementById('translateBtn').addEventListener('click', async () => {
  const result = await chrome.storage.local.get(['apiKey', 'model', 'autoPauseEnabled', 'autoPauseTimeout']);

  if (!result.apiKey) {
    showStatus('먼저 설정에서 API Key를 입력해주세요.', 'error');
    setTimeout(() => {
      chrome.runtime.openOptionsPage();
    }, 1500);
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

    // 1초 후 팝업 닫기
    setTimeout(() => {
      window.close();
    }, 1000);

  } catch (error) {
    showStatus('오류: ' + error.message, 'error');
  }
});

// 사이드 패널 열기
document.getElementById('openSidePanel').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Chrome의 사이드 패널 열기
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (error) {
    // 구버전 브라우저에서는 사이드 패널을 지원하지 않을 수 있음
    showStatus('사이드 패널을 지원하지 않는 브라우저입니다.', 'error');
  }
});

// 설정 페이지 열기
document.getElementById('openSettings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
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
