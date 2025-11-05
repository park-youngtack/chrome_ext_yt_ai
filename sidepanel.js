// 상태 관리
let currentTabId = null;
let translationState = {
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

let updateInterval = null;

// 현재 탭 정보 업데이트
async function updateCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    currentTabId = tab.id;
    document.getElementById('pageUrl').textContent = tab.url;
    await updateStatus();
  }
}

// 초기화
document.addEventListener('DOMContentLoaded', async () => {
  // 패널이 열렸음을 표시
  await chrome.storage.local.set({ sidePanelOpen: true });

  // 현재 활성 탭 가져오기
  await updateCurrentTab();

  // 버튼 이벤트
  document.getElementById('toggleBtn').addEventListener('click', handleToggle);

  // 탭 변경 감지 (사용자가 다른 탭으로 전환할 때)
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    await updateCurrentTab();
  });

  // 탭 URL 변경 감지 (현재 탭에서 다른 페이지로 이동할 때)
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (tabId === currentTabId && changeInfo.url) {
      document.getElementById('pageUrl').textContent = changeInfo.url;
    }
  });

  // 주기적으로 상태 업데이트 (1초마다)
  updateInterval = setInterval(updateStatus, 1000);
});

// 상태 업데이트
async function updateStatus() {
  if (!currentTabId) return;

  try {
    // content script에서 상태 가져오기
    const response = await chrome.tabs.sendMessage(currentTabId, {
      action: 'getProgressStatus'
    });

    if (response) {
      translationState = { ...translationState, ...response };
      updateUI();
    }
  } catch (error) {
    // content script가 로드되지 않은 경우
    console.log('상태 확인 불가:', error.message);
  }
}

// UI 업데이트
function updateUI() {
  const { state, totalTexts, translatedCount, cachedCount, batchCount, currentBatch, batches, startTime, logs } = translationState;

  // 상태 뱃지 업데이트
  const statusBadge = document.getElementById('statusBadge');
  if (state === 'active') {
    statusBadge.textContent = '번역 중';
    statusBadge.className = 'status-badge active pulse';
  } else if (state === 'paused') {
    statusBadge.textContent = '일시정지';
    statusBadge.className = 'status-badge paused';
  } else {
    statusBadge.textContent = '대기 중';
    statusBadge.className = 'status-badge inactive';
  }

  // 진행률 업데이트
  const progress = totalTexts > 0 ? Math.round((translatedCount / totalTexts) * 100) : 0;
  document.getElementById('progressBar').style.width = `${progress}%`;
  document.getElementById('progressText').textContent = `${translatedCount} / ${totalTexts} 번역 완료`;

  // 통계 업데이트
  document.getElementById('translatedCount').textContent = translatedCount.toLocaleString();
  document.getElementById('cachedCount').textContent = cachedCount.toLocaleString();
  document.getElementById('batchCount').textContent = batchCount.toLocaleString();

  // 경과 시간 업데이트
  if (startTime) {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    document.getElementById('elapsedTime').textContent = formatTime(elapsed);
  } else {
    document.getElementById('elapsedTime').textContent = '0s';
  }

  // 배치 정보 업데이트
  if (batches && batches.length > 0) {
    document.getElementById('batchInfo').style.display = 'block';
    const batchList = document.getElementById('batchList');
    batchList.innerHTML = batches.map((batch, index) => `
      <div class="batch-item">
        <span class="batch-name">배치 ${index + 1} (${batch.size}개)</span>
        <span class="batch-status ${batch.status}">${getBatchStatusText(batch.status)}</span>
      </div>
    `).join('');
  } else {
    document.getElementById('batchInfo').style.display = 'none';
  }

  // 버튼 텍스트 업데이트
  const toggleBtn = document.getElementById('toggleBtn');
  if (state === 'active') {
    toggleBtn.textContent = '⏸️ 번역 중지';
    toggleBtn.style.background = 'linear-gradient(135deg, #f59e0b, #ef4444)';
  } else if (state === 'paused') {
    toggleBtn.textContent = '▶️ 번역 재개';
    toggleBtn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
  } else {
    toggleBtn.textContent = '▶️ 번역 시작';
    toggleBtn.style.background = 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))';
  }
}

// 토글 버튼 핸들러
async function handleToggle() {
  if (!currentTabId) return;

  const { state } = translationState;

  try {
    if (state === 'active' || state === 'paused') {
      // 번역 중지 (원본으로 복원)
      await chrome.tabs.sendMessage(currentTabId, {
        action: 'toggleTranslation'
      });
    } else {
      // 번역 시작
      const settings = await chrome.storage.local.get(['apiKey', 'model', 'autoPauseEnabled', 'autoPauseTimeout']);

      if (!settings.apiKey) {
        alert('먼저 설정에서 API Key를 입력해주세요.');
        chrome.runtime.openOptionsPage();
        return;
      }

      await chrome.tabs.sendMessage(currentTabId, {
        action: 'toggleTranslation',
        apiKey: settings.apiKey,
        model: settings.model || 'openai/gpt-4o-mini',
        autoPauseEnabled: settings.autoPauseEnabled !== false,
        autoPauseTimeout: settings.autoPauseTimeout || 60
      });
    }

    // 즉시 상태 업데이트
    setTimeout(updateStatus, 500);
  } catch (error) {
    console.error('번역 토글 오류:', error);
    alert('오류가 발생했습니다: ' + error.message);
  }
}

// 배치 상태 텍스트
function getBatchStatusText(status) {
  const statusMap = {
    'pending': '대기 중',
    'processing': '처리 중',
    'completed': '완료',
    'failed': '실패'
  };
  return statusMap[status] || status;
}

// 시간 포맷
function formatTime(seconds) {
  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
}

// 정리
window.addEventListener('beforeunload', async () => {
  if (updateInterval) {
    clearInterval(updateInterval);
  }
  // 패널이 닫혔음을 표시
  await chrome.storage.local.set({ sidePanelOpen: false });
});
