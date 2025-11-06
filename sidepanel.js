import { FOOTER_TEXT } from './meta.js';

// 기본 설정
const DEFAULT_MODEL = 'openai/gpt-4o-mini';
const SESSION_KEY = 'lastActiveTab';

// 상태 관리
let currentTabId = null;
let port = null;
let permissionGranted = false;
let settingsChanged = false;
let originalSettings = {};

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

  // 세션 복원 (마지막 탭)
  await restoreSession();

  // 딥링크 처리
  handleDeepLink();

  // 탭바 이벤트 (세로 탭)
  initTabbar();

  // 번역 탭 버튼 이벤트
  document.getElementById('translateAllBtn')?.addEventListener('click', () => handleTranslateAll(true));
  document.getElementById('translateFreshBtn')?.addEventListener('click', () => handleTranslateAll(false));
  document.getElementById('restoreBtn')?.addEventListener('click', handleRestore);

  // 권한 요청 버튼
  const permBtn = document.getElementById('requestPermissionBtn');
  if (permBtn) {
    permBtn.addEventListener('click', handleRequestPermission);
  }

  // 설정 열기 버튼 (file:// 전용)
  const settingsBtn = document.getElementById('openSettingsBtn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      switchTab('settings');
    });
  }

  // 설정 탭 이벤트
  initSettingsTab();

  // 닫기 버튼
  document.getElementById('closeBtn')?.addEventListener('click', handleClose);

  // 탭 변경 감지
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      currentTabId = tab.id;
      await checkPermissions(tab);
    }
  });
});

// ===== 탭바 초기화 =====
function initTabbar() {
  const tabButtons = document.querySelectorAll('.vertical-tabbar button[role="tab"]');

  tabButtons.forEach(btn => {
    // 클릭 이벤트
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      if (tabName) {
        switchTab(tabName);
      }
    });

    // 키보드 내비게이션
    btn.addEventListener('keydown', handleTabKeydown);
  });
}

// 키보드 내비게이션 (화살표, Enter, Space)
function handleTabKeydown(e) {
  const tabButtons = Array.from(document.querySelectorAll('.vertical-tabbar button[role="tab"]'));
  const currentIndex = tabButtons.indexOf(e.target);

  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
    e.preventDefault();
    const nextIndex = (currentIndex + 1) % tabButtons.length;
    tabButtons[nextIndex].focus();
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
    e.preventDefault();
    const prevIndex = (currentIndex - 1 + tabButtons.length) % tabButtons.length;
    tabButtons[prevIndex].focus();
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    const tabName = e.target.dataset.tab;
    if (tabName) {
      switchTab(tabName);
    }
  }
}

// 탭 전환
async function switchTab(tabName) {
  // 탭 버튼 상태 업데이트
  const tabButtons = document.querySelectorAll('.vertical-tabbar button[role="tab"]');
  tabButtons.forEach(btn => {
    if (btn.dataset.tab === tabName) {
      btn.setAttribute('aria-selected', 'true');
    } else {
      btn.setAttribute('aria-selected', 'false');
    }
  });

  // 탭 컨텐츠 전환
  const tabContents = document.querySelectorAll('.tab-content');
  tabContents.forEach(content => {
    if (content.id === `${tabName}Tab`) {
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });

  // 세션 저장 (마지막 탭 상태)
  await chrome.storage.session.set({ [SESSION_KEY]: tabName });

  // 설정 탭으로 전환 시 설정 로드
  if (tabName === 'settings') {
    await loadSettings();
  }
}

// 세션 복원
async function restoreSession() {
  try {
    const result = await chrome.storage.session.get(SESSION_KEY);
    const lastTab = result[SESSION_KEY];

    if (lastTab && (lastTab === 'translate' || lastTab === 'settings')) {
      switchTab(lastTab);
    }
  } catch (error) {
    console.error('Failed to restore session:', error);
  }
}

// 딥링크 처리 (#translate, #settings)
function handleDeepLink() {
  const hash = window.location.hash.slice(1); // # 제거
  if (hash === 'translate' || hash === 'settings') {
    switchTab(hash);
  }
}

// 닫기 버튼
async function handleClose() {
  try {
    if (!currentTabId) return;

    // background.js에 닫기 메시지 전송
    await chrome.runtime.sendMessage({
      action: 'closeSidePanel',
      tabId: currentTabId
    });
  } catch (error) {
    console.error('Failed to close side panel:', error);
  }
}

// ===== 설정 탭 초기화 =====
function initSettingsTab() {
  // 입력 필드 변경 감지
  const inputs = document.querySelectorAll('#settingsTab input');
  inputs.forEach(input => {
    input.addEventListener('input', () => {
      settingsChanged = true;
      showSaveBar();
    });

    input.addEventListener('change', () => {
      settingsChanged = true;
      showSaveBar();
    });
  });

  // 저장 버튼
  document.getElementById('saveBtn')?.addEventListener('click', handleSaveSettings);

  // 취소 버튼
  document.getElementById('cancelBtn')?.addEventListener('click', () => {
    loadSettings(); // 원래 설정 복원
    hideSaveBar();
  });

  // 캐시 관리 버튼
  document.getElementById('clearPageCacheBtn')?.addEventListener('click', handleClearPageCache);
  document.getElementById('clearAllCacheBtn')?.addEventListener('click', handleClearAllCache);
}

// 설정 로드
async function loadSettings() {
  try {
    const result = await chrome.storage.local.get([
      'apiKey',
      'model',
      'batchSize',
      'concurrency',
      'cacheEnabled',
      'cacheTTL'
    ]);

    // 원본 설정 저장
    originalSettings = { ...result };

    // API 설정
    document.getElementById('apiKey').value = result.apiKey || '';
    document.getElementById('model').value = result.model || '';

    // 번역 설정
    document.getElementById('batchSize').value = result.batchSize || 50;
    document.getElementById('concurrency').value = result.concurrency || 3;

    // 캐시 설정
    document.getElementById('cacheToggle').checked = result.cacheEnabled !== false;
    document.getElementById('cacheTTL').value = result.cacheTTL || 60;

    // 변경 플래그 초기화
    settingsChanged = false;
    hideSaveBar();
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

// 설정 저장
async function handleSaveSettings() {
  const apiKey = document.getElementById('apiKey').value.trim();
  const modelInput = document.getElementById('model').value.trim();
  const batchSize = parseInt(document.getElementById('batchSize').value) || 50;
  const concurrency = parseInt(document.getElementById('concurrency').value) || 3;
  const cacheEnabled = document.getElementById('cacheToggle').checked;
  const cacheTTL = parseInt(document.getElementById('cacheTTL').value) || 60;

  const model = modelInput || DEFAULT_MODEL;

  // 유효성 검사
  if (!apiKey) {
    showToast('API Key를 입력해주세요.', 'error');
    return;
  }

  if (batchSize < 10 || batchSize > 100) {
    showToast('배치 크기는 10~100 사이여야 합니다.', 'error');
    return;
  }

  if (concurrency < 1 || concurrency > 10) {
    showToast('동시 처리 개수는 1~10 사이여야 합니다.', 'error');
    return;
  }

  if (cacheTTL < 5 || cacheTTL > 1440) {
    showToast('캐시 만료 시간은 5~1440분 사이여야 합니다.', 'error');
    return;
  }

  try {
    await chrome.storage.local.set({
      apiKey,
      model,
      batchSize,
      concurrency,
      cacheEnabled,
      cacheTTL
    });

    // 원본 설정 업데이트
    originalSettings = {
      apiKey,
      model,
      batchSize,
      concurrency,
      cacheEnabled,
      cacheTTL
    };

    settingsChanged = false;
    hideSaveBar();
    showToast('설정이 저장되었습니다!');
  } catch (error) {
    console.error('Failed to save settings:', error);
    showToast('저장 중 오류가 발생했습니다: ' + error.message, 'error');
  }
}

// 저장 바 표시
function showSaveBar() {
  const saveBar = document.getElementById('saveBar');
  if (saveBar) {
    saveBar.classList.add('active');
  }
}

// 저장 바 숨김
function hideSaveBar() {
  const saveBar = document.getElementById('saveBar');
  if (saveBar) {
    saveBar.classList.remove('active');
  }
}

// 토스트 표시 (2초)
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = message;
  toast.className = 'toast show';

  if (type === 'error') {
    toast.classList.add('error');
  }

  setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
}

// 페이지 캐시 비우기
async function handleClearPageCache() {
  if (!currentTabId) {
    showToast('활성 탭을 찾을 수 없습니다.', 'error');
    return;
  }

  try {
    await chrome.tabs.sendMessage(currentTabId, { action: 'clearPageCache' });
    showToast('이 페이지의 캐시가 삭제되었습니다.');
  } catch (error) {
    console.error('Failed to clear page cache:', error);
    showToast('캐시 삭제 중 오류가 발생했습니다.', 'error');
  }
}

// 전역 캐시 비우기
async function handleClearAllCache() {
  if (!currentTabId) {
    showToast('활성 탭을 찾을 수 없습니다.', 'error');
    return;
  }

  try {
    await chrome.tabs.sendMessage(currentTabId, { action: 'clearAllCache' });
    showToast('모든 캐시가 삭제되었습니다.');
  } catch (error) {
    console.error('Failed to clear all cache:', error);
    showToast('캐시 삭제 중 오류가 발생했습니다.', 'error');
  }
}

// ===== 번역 기능 (기존 코드 유지) =====

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
    showToast('권한을 먼저 허용해주세요.', 'error');
    return;
  }

  try {
    // 설정 가져오기
    const settings = await chrome.storage.local.get([
      'apiKey',
      'model',
      'batchSize',
      'concurrency',
      'cacheEnabled'
    ]);

    if (!settings.apiKey) {
      showToast('먼저 설정에서 API Key를 입력해주세요.', 'error');
      switchTab('settings');
      return;
    }

    // 캐시 사용 여부 결정
    const finalUseCache = useCache && settings.cacheEnabled !== false;

    // 번역 시작
    await chrome.tabs.sendMessage(currentTabId, {
      action: 'translateFullPage',
      apiKey: settings.apiKey,
      model: settings.model || DEFAULT_MODEL,
      batchSize: settings.batchSize || 50,
      concurrency: settings.concurrency || 3,
      useCache: finalUseCache
    });

  } catch (error) {
    console.error('Translation failed:', error);
    showToast('번역 중 오류가 발생했습니다: ' + error.message, 'error');
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
    showToast('원본 복원 중 오류가 발생했습니다: ' + error.message, 'error');
  }
}

// UI 업데이트
function updateUI() {
  const { state, totalTexts, translatedCount, cachedCount, batchCount, batchesDone, batches, activeMs } = translationState;

  // 상태 뱃지
  const statusBadge = document.getElementById('statusBadge');
  const translateAllBtn = document.getElementById('translateAllBtn');
  const translateFreshBtn = document.getElementById('translateFreshBtn');
  const restoreBtn = document.getElementById('restoreBtn');

  if (state === 'translating') {
    statusBadge.textContent = '번역 중';
    statusBadge.className = 'status-badge active pulse';
    translateAllBtn.disabled = true;
    translateFreshBtn.disabled = true;
    restoreBtn.disabled = false;
  } else if (state === 'completed') {
    statusBadge.textContent = '번역 완료';
    statusBadge.className = 'status-badge active';
    translateAllBtn.disabled = false;
    translateFreshBtn.disabled = false;
    restoreBtn.disabled = false;
  } else if (state === 'restored') {
    statusBadge.textContent = '원본 보기';
    statusBadge.className = 'status-badge restored';
    translateAllBtn.disabled = false;
    translateFreshBtn.disabled = false;
    restoreBtn.disabled = true;
  } else {
    statusBadge.textContent = '대기 중';
    statusBadge.className = 'status-badge';
    translateAllBtn.disabled = false;
    translateFreshBtn.disabled = false;
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
