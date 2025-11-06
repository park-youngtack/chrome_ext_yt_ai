// 상태 관리
let currentTabId = null;
let port = null;
let permissionGranted = false;

let translationState = {
  state: 'inactive',
  totalTexts: 0,
  translatedCount: 0,
  cachedCount: 0,
  batchCount: 0,
  batchesDone: 0,
  batches: [],
  activeMs: 0
};

// 초기화
document.addEventListener('DOMContentLoaded', async () => {
  // 현재 탭 가져오기
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    currentTabId = tab.id;
    await checkPermissions(tab);
  }

  // 버튼 이벤트
  document.getElementById('translateAllBtn').addEventListener('click', handleTranslateAll);
  document.getElementById('restoreBtn').addEventListener('click', handleRestore);
  document.getElementById('openSettings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 권한 요청 버튼
  const permBtn = document.getElementById('requestPermissionBtn');
  if (permBtn) {
    permBtn.addEventListener('click', handleRequestPermission);
  }

  // 탭 변경 감지
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      currentTabId = tab.id;
      await checkPermissions(tab);
    }
  });
});

// 권한 확인
async function checkPermissions(tab) {
  if (!tab || !tab.url) {
    showPermissionUI(false, 'Invalid tab');
    return;
  }

  // 특수 페이지 확인
  if (tab.url.startsWith('chrome://') ||
      tab.url.startsWith('about:') ||
      tab.url.startsWith('chrome-extension://') ||
      tab.url.startsWith('edge://') ||
      tab.url.startsWith('devtools://')) {
    showPermissionUI(false, '이 페이지에서는 번역 기능을 사용할 수 없습니다.');
    return;
  }

  try {
    const url = new URL(tab.url);
    const origin = `${url.protocol}//${url.host}/*`;

    // 권한 확인
    const hasPermission = await chrome.permissions.contains({
      origins: [origin]
    });

    if (hasPermission) {
      permissionGranted = true;
      showPermissionUI(true);

      // Content script 주입 확인
      await ensureContentScriptReady(tab.id);

      // Port 연결
      connectToContentScript(tab.id);
    } else {
      permissionGranted = false;
      showPermissionUI(false, '이 사이트에 대한 권한이 필요합니다.');
    }
  } catch (error) {
    console.error('Permission check failed:', error);
    showPermissionUI(false, '권한 확인 중 오류가 발생했습니다.');
  }
}

// 권한 UI 표시
function showPermissionUI(granted, message = '') {
  const permissionSection = document.getElementById('permissionSection');
  const mainSection = document.getElementById('mainSection');
  const permissionMessage = document.getElementById('permissionMessage');

  if (granted) {
    permissionSection.style.display = 'none';
    mainSection.style.display = 'block';
  } else {
    permissionSection.style.display = 'block';
    mainSection.style.display = 'none';
    if (message) {
      permissionMessage.textContent = message;
    }
  }
}

// 권한 요청
async function handleRequestPermission() {
  if (!currentTabId) return;

  try {
    const tab = await chrome.tabs.get(currentTabId);
    const url = new URL(tab.url);
    const origin = `${url.protocol}//${url.host}/*`;

    // 권한 요청
    const granted = await chrome.permissions.request({
      origins: [origin]
    });

    if (granted) {
      // Content script 주입
      await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        files: ['content.js']
      });

      // 잠시 대기
      await new Promise(resolve => setTimeout(resolve, 100));

      // 권한 UI 업데이트
      await checkPermissions(tab);
    } else {
      showPermissionUI(false, '권한이 거부되었습니다.');
    }
  } catch (error) {
    console.error('Permission request failed:', error);
    showPermissionUI(false, '권한 요청 중 오류가 발생했습니다.');
  }
}

// Content script 준비 확인
async function ensureContentScriptReady(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'getTranslationState' });
    return true;
  } catch (error) {
    // Content script가 없으면 주입
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
      await new Promise(resolve => setTimeout(resolve, 100));
      return true;
    } catch (injectError) {
      console.error('Failed to inject content script:', injectError);
      return false;
    }
  }
}

// Content script에 연결
function connectToContentScript(tabId) {
  try {
    // 기존 port 종료
    if (port) {
      port.disconnect();
      port = null;
    }

    // 새 port 연결
    port = chrome.tabs.connect(tabId, { name: 'panel' });

    port.onMessage.addListener((msg) => {
      if (msg.type === 'progress') {
        translationState = { ...translationState, ...msg.data };
        updateUI();
      }
    });

    port.onDisconnect.addListener(() => {
      console.log('Port disconnected');
      port = null;
    });

    console.log('Port connected to tab:', tabId);
  } catch (error) {
    console.error('Failed to connect port:', error);
  }
}

// 전체 번역
async function handleTranslateAll() {
  if (!currentTabId || !permissionGranted) {
    alert('권한을 먼저 허용해주세요.');
    return;
  }

  try {
    // 설정 가져오기
    const settings = await chrome.storage.local.get([
      'apiKey',
      'model',
      'batchSize',
      'concurrency',
      'useCache'
    ]);

    if (!settings.apiKey) {
      alert('먼저 설정에서 API Key를 입력해주세요.');
      chrome.runtime.openOptionsPage();
      return;
    }

    // 번역 시작
    await chrome.tabs.sendMessage(currentTabId, {
      action: 'translateFullPage',
      apiKey: settings.apiKey,
      model: settings.model || 'openai/gpt-4o-mini',
      batchSize: settings.batchSize || 50,
      concurrency: settings.concurrency || 3,
      useCache: settings.useCache !== false
    });

  } catch (error) {
    console.error('Translation failed:', error);
    alert('번역 중 오류가 발생했습니다: ' + error.message);
  }
}

// 원본 복원
async function handleRestore() {
  if (!currentTabId) return;

  try {
    await chrome.tabs.sendMessage(currentTabId, {
      action: 'restoreOriginal'
    });
  } catch (error) {
    console.error('Restore failed:', error);
    alert('원본 복원 중 오류가 발생했습니다: ' + error.message);
  }
}

// UI 업데이트
function updateUI() {
  const { state, totalTexts, translatedCount, cachedCount, batchCount, batchesDone, batches, activeMs } = translationState;

  // 상태 뱃지
  const statusBadge = document.getElementById('statusBadge');
  const translateAllBtn = document.getElementById('translateAllBtn');
  const restoreBtn = document.getElementById('restoreBtn');

  if (state === 'translating') {
    statusBadge.textContent = '번역 중';
    statusBadge.className = 'status-badge active pulse';
    translateAllBtn.disabled = true;
    restoreBtn.disabled = false;
  } else if (state === 'completed') {
    statusBadge.textContent = '번역 완료';
    statusBadge.className = 'status-badge active';
    translateAllBtn.disabled = false;
    restoreBtn.disabled = false;
  } else if (state === 'restored') {
    statusBadge.textContent = '원본 보기';
    statusBadge.className = 'status-badge restored';
    translateAllBtn.disabled = false;
    restoreBtn.disabled = true;
  } else {
    statusBadge.textContent = '대기 중';
    statusBadge.className = 'status-badge';
    translateAllBtn.disabled = false;
    restoreBtn.disabled = true;
  }

  // 진행률 텍스트
  if (totalTexts > 0) {
    const progress = Math.round((translatedCount / totalTexts) * 100);
    document.getElementById('progressText').textContent =
      `완료 ${translatedCount}/${totalTexts} (${progress}%)`;
  } else {
    document.getElementById('progressText').textContent = '번역 대기 중';
  }

  // 통계
  document.getElementById('translatedCount').textContent = translatedCount.toLocaleString();
  document.getElementById('cachedCount').textContent = cachedCount.toLocaleString();

  // 배치 정보
  if (batchCount > 0) {
    document.getElementById('batchCountText').textContent = `${batchesDone}/${batchCount}`;
  } else {
    document.getElementById('batchCountText').textContent = '0';
  }

  // 진행 시간
  if (activeMs > 0) {
    const seconds = Math.floor(activeMs / 1000);
    document.getElementById('elapsedTime').textContent = formatTime(seconds);
  } else {
    document.getElementById('elapsedTime').textContent = '0s';
  }

  // 배치 목록
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

// 배치 상태 텍스트
function getBatchStatusText(status) {
  const statusMap = {
    'pending': '대기',
    'processing': '진행',
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
