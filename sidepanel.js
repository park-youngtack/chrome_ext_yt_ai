// 상태 관리
let currentTabId = null;
let translationState = {
  state: 'inactive',
  mode: null, // 'viewport' or 'fullpage'
  totalTexts: 0,
  translatedCount: 0,
  cachedCount: 0,
  batchCount: 0,
  currentBatch: 0,
  batches: [],
  startTime: null,
  activeTime: 0, // 실제 번역 작업 중인 시간 (밀리초)
  logs: []
};

let updateInterval = null;

// 현재 탭 정보 업데이트
async function updateCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    currentTabId = tab.id;
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
  document.getElementById('startViewportBtn').addEventListener('click', handleStartViewport);
  document.getElementById('translateAllBtn').addEventListener('click', handleTranslateAll);
  document.getElementById('restoreBtn').addEventListener('click', handleRestore);
  document.getElementById('openSettings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 탭 변경 감지 (사용자가 다른 탭으로 전환할 때)
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    await updateCurrentTab();
  });

  // 탭 URL 변경 감지 (현재 탭에서 다른 페이지로 이동할 때)
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (tabId === currentTabId && changeInfo.url) {
      // URL이 변경되면 상태 리셋
      await updateStatus();
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
  const { state, mode, totalTexts, translatedCount, cachedCount, batchCount, currentBatch, batches, startTime, activeTime, logs } = translationState;

  // 상태 뱃지 업데이트
  const statusBadge = document.getElementById('statusBadge');
  const startViewportBtn = document.getElementById('startViewportBtn');
  const translateAllBtn = document.getElementById('translateAllBtn');
  const restoreBtn = document.getElementById('restoreBtn');

  if (state === 'active') {
    statusBadge.textContent = mode === 'fullpage' ? '전체 번역 중' : '번역 중';
    statusBadge.className = 'status-badge active pulse';

    // 뷰포트 모드 중에는 전체 번역 비활성화
    startViewportBtn.style.display = 'none';
    translateAllBtn.style.display = mode === 'viewport' ? 'block' : 'none';
    translateAllBtn.disabled = mode === 'fullpage';
    restoreBtn.style.display = 'block';
  } else if (state === 'paused') {
    statusBadge.textContent = '일시정지';
    statusBadge.className = 'status-badge paused';

    startViewportBtn.style.display = 'none';
    translateAllBtn.style.display = 'block';
    translateAllBtn.disabled = false;
    restoreBtn.style.display = 'block';
  } else if (state === 'restored') {
    statusBadge.textContent = '원본 보기';
    statusBadge.className = 'status-badge restored';

    startViewportBtn.style.display = 'block';
    translateAllBtn.style.display = 'none';
    restoreBtn.style.display = 'none';
  } else {
    // inactive
    statusBadge.textContent = '대기 중';
    statusBadge.className = 'status-badge';

    startViewportBtn.style.display = 'block';
    translateAllBtn.style.display = 'none';
    restoreBtn.style.display = 'none';
  }

  // 진행률 텍스트 업데이트
  if (totalTexts > 0) {
    const progress = Math.round((translatedCount / totalTexts) * 100);
    document.getElementById('progressText').textContent = `${translatedCount} / ${totalTexts} 번역 완료 (${progress}%)`;
  } else if (state === 'active') {
    document.getElementById('progressText').textContent = '번역 준비 중...';
  } else {
    document.getElementById('progressText').textContent = '번역 대기 중';
  }

  // 통계 업데이트
  document.getElementById('translatedCount').textContent = translatedCount.toLocaleString();
  document.getElementById('cachedCount').textContent = cachedCount.toLocaleString();
  document.getElementById('batchCount').textContent = batchCount.toLocaleString();

  // 경과 시간 업데이트 (activeTime 사용 - 실제 번역 중인 시간만)
  if (activeTime > 0) {
    const elapsed = Math.floor(activeTime / 1000);
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
}

// Content script가 준비되었는지 확인하고 필요시 주입
async function ensureContentScriptReady(tabId) {
  try {
    // 먼저 content script가 응답하는지 확인
    const response = await chrome.tabs.sendMessage(tabId, {
      action: 'getTranslationState'
    });
    return true;
  } catch (error) {
    // Content script가 없으면 주입 시도
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      });
      // 주입 후 잠시 대기
      await new Promise(resolve => setTimeout(resolve, 100));
      return true;
    } catch (injectError) {
      // 주입할 수 없는 페이지 (chrome://, about: 등)
      return false;
    }
  }
}

// 뷰포트 번역 시작
async function handleStartViewport() {
  if (!currentTabId) return;

  try {
    // 현재 탭 정보 확인
    const tab = await chrome.tabs.get(currentTabId);

    // 특수 페이지 확인
    if (tab.url.startsWith('chrome://') ||
        tab.url.startsWith('about:') ||
        tab.url.startsWith('chrome-extension://') ||
        tab.url.startsWith('edge://') ||
        tab.url.startsWith('devtools://')) {
      alert('이 페이지에서는 번역 기능을 사용할 수 없습니다.\n일반 웹페이지에서 사용해주세요.');
      return;
    }

    // Content script 준비 확인
    const isReady = await ensureContentScriptReady(currentTabId);
    if (!isReady) {
      alert('이 페이지에서는 번역 기능을 사용할 수 없습니다.\n일반 웹페이지에서 사용해주세요.');
      return;
    }

    // API 키 확인
    const settings = await chrome.storage.local.get(['apiKey', 'model', 'autoPauseEnabled', 'autoPauseTimeout']);

    if (!settings.apiKey) {
      alert('먼저 설정에서 API Key를 입력해주세요.');
      chrome.runtime.openOptionsPage();
      return;
    }

    // 뷰포트 번역 시작
    await chrome.tabs.sendMessage(currentTabId, {
      action: 'startViewportTranslation',
      apiKey: settings.apiKey,
      model: settings.model || 'openai/gpt-4o-mini',
      autoPauseEnabled: settings.autoPauseEnabled !== false,
      autoPauseTimeout: settings.autoPauseTimeout || 60
    });

    // 즉시 상태 업데이트
    setTimeout(updateStatus, 500);
  } catch (error) {
    console.error('번역 시작 오류:', error);
    alert('오류가 발생했습니다: ' + error.message + '\n페이지를 새로고침 한 후 다시 시도해주세요.');
  }
}

// 전체 페이지 번역
async function handleTranslateAll() {
  if (!currentTabId) return;

  try {
    // API 키 확인
    const settings = await chrome.storage.local.get(['apiKey', 'model']);

    if (!settings.apiKey) {
      alert('먼저 설정에서 API Key를 입력해주세요.');
      chrome.runtime.openOptionsPage();
      return;
    }

    // 전체 페이지 번역 시작
    await chrome.tabs.sendMessage(currentTabId, {
      action: 'translateFullPage',
      apiKey: settings.apiKey,
      model: settings.model || 'openai/gpt-4o-mini'
    });

    // 즉시 상태 업데이트
    setTimeout(updateStatus, 500);
  } catch (error) {
    console.error('전체 번역 오류:', error);
    alert('오류가 발생했습니다: ' + error.message);
  }
}

// 원본 복원
async function handleRestore() {
  if (!currentTabId) return;

  try {
    await chrome.tabs.sendMessage(currentTabId, {
      action: 'restoreOriginal'
    });

    // 즉시 상태 업데이트
    setTimeout(updateStatus, 500);
  } catch (error) {
    console.error('원본 복원 오류:', error);
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
