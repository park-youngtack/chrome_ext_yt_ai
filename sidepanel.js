import { FOOTER_TEXT } from './meta.js';

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
  // 푸터 텍스트 설정
  const footerEl = document.getElementById('footerText');
  if (footerEl) {
    footerEl.textContent = FOOTER_TEXT;
  }

  // 현재 탭 가져오기
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    currentTabId = tab.id;
    await checkPermissions(tab);
  }

  // 버튼 이벤트
  document.getElementById('translateAllBtn').addEventListener('click', () => handleTranslateAll(true));
  document.getElementById('translateFreshBtn').addEventListener('click', () => handleTranslateAll(false));
  document.getElementById('restoreBtn').addEventListener('click', handleRestore);
  document.getElementById('openSettings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 권한 요청 버튼
  const permBtn = document.getElementById('requestPermissionBtn');
  if (permBtn) {
    permBtn.addEventListener('click', handleRequestPermission);
  }

  // 설정 열기 버튼 (file:// 전용)
  const settingsBtn = document.getElementById('openSettingsBtn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
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

// 지원 스킴 확인
function getSupportType(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return 'requestable';
    }
    if (u.protocol === 'file:') {
      return 'file';
    }
    return 'unsupported';
  } catch (e) {
    return 'unsupported';
  }
}

// 권한 확인
async function checkPermissions(tab) {
  if (!tab || !tab.url) {
    showPermissionUI('unsupported', '유효하지 않은 탭입니다.');
    return;
  }

  const supportType = getSupportType(tab.url);

  // 지원 불가 스킴
  if (supportType === 'unsupported') {
    showPermissionUI('unsupported', '이 페이지는 브라우저 정책상 번역을 지원하지 않습니다. 일반 웹페이지에서 사용해주세요.');
    return;
  }

  // file:// 스킴
  if (supportType === 'file') {
    try {
      const url = new URL(tab.url);
      const origin = `${url.protocol}//${url.host}/*`;

      const hasPermission = await chrome.permissions.contains({
        origins: [origin]
      });

      if (hasPermission) {
        permissionGranted = true;
        showPermissionUI('granted');
        await ensureContentScriptReady(tab.id);
        connectToContentScript(tab.id);
      } else {
        permissionGranted = false;
        showPermissionUI('file', '파일 URL 접근 허용을 켜야 번역할 수 있습니다.');
      }
    } catch (error) {
      console.error('File permission check failed:', error);
      showPermissionUI('file', '파일 URL 접근 허용을 켜야 번역할 수 있습니다.');
    }
    return;
  }

  // http/https 스킴
  try {
    const url = new URL(tab.url);
    const origin = `${url.protocol}//${url.host}/*`;

    // 권한 확인
    const hasPermission = await chrome.permissions.contains({
      origins: [origin]
    });

    if (hasPermission) {
      permissionGranted = true;
      showPermissionUI('granted');

      // Content script 주입 확인
      await ensureContentScriptReady(tab.id);

      // Port 연결
      connectToContentScript(tab.id);
    } else {
      permissionGranted = false;
      showPermissionUI('requestable', '이 사이트를 번역하려면 접근 권한이 필요합니다.');
    }
  } catch (error) {
    console.error('Permission check failed:', error);
    showPermissionUI('requestable', '권한 확인 중 오류가 발생했습니다.');
  }
}

// 권한 UI 표시
function showPermissionUI(type, message = '') {
  const permissionSection = document.getElementById('permissionSection');
  const mainSection = document.getElementById('mainSection');
  const permissionMessage = document.getElementById('permissionMessage');
  const permissionBtn = document.getElementById('requestPermissionBtn');
  const settingsBtn = document.getElementById('openSettingsBtn');

  if (type === 'granted') {
    // 권한 있음 - 메인 섹션 표시
    permissionSection.style.display = 'none';
    mainSection.style.display = 'block';
  } else if (type === 'unsupported') {
    // 지원 불가 스킴 - 권한 버튼 숨김, 안내만 표시
    permissionSection.style.display = 'block';
    mainSection.style.display = 'none';
    permissionMessage.textContent = message;
    permissionBtn.style.display = 'none';
    if (settingsBtn) settingsBtn.style.display = 'none';
  } else if (type === 'file') {
    // file:// - 설정 열기 버튼 표시
    permissionSection.style.display = 'block';
    mainSection.style.display = 'none';
    permissionMessage.textContent = message;
    permissionBtn.style.display = 'none';
    if (settingsBtn) {
      settingsBtn.style.display = 'block';
      settingsBtn.textContent = '설정 열기';
    }
  } else if (type === 'requestable') {
    // http/https 권한 없음 - 권한 허용 버튼 표시
    permissionSection.style.display = 'block';
    mainSection.style.display = 'none';
    permissionMessage.textContent = message;
    permissionBtn.style.display = 'block';
    permissionBtn.textContent = '권한 허용';
    if (settingsBtn) settingsBtn.style.display = 'none';
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
async function handleTranslateAll(useCache = true) {
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
      'concurrency'
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
      useCache: useCache
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
