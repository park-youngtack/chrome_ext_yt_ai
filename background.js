// Background Service Worker

// 로거 함수 (설정에 따라 로그 출력)
async function log(...args) {
  try {
    const result = await chrome.storage.local.get(['enableConsoleLog']);
    if (result.enableConsoleLog) {
      console.log('[번역 확장 배경]', ...args);
    }
  } catch (error) {
    // 설정 로드 실패 시 로그 출력 안 함
  }
}

async function logError(...args) {
  // 에러는 항상 출력
  console.error('[번역 확장 배경 오류]', ...args);
}

// 확장프로그램 설치 시
chrome.runtime.onInstalled.addListener(() => {
  log('웹페이지 번역기가 설치되었습니다.');
});

// 아이콘 클릭 시 해당 탭에서만 side panel 열기
// 각 탭마다 독립적으로 패널을 열고 닫을 수 있음
// 중복 호출 방지를 위한 디바운스
let opening = false;

chrome.action.onClicked.addListener(async (tab) => {
  // 디바운스: 이미 처리 중이면 무시
  if (opening) {
    log('Side panel 처리 중, 중복 클릭 무시');
    return;
  }

  opening = true;

  try {
    // 해당 탭에서만 사이드패널 설정 및 활성화
    await chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: 'sidepanel.html',
      enabled: true
    });

    // 해당 탭에서만 사이드패널 열기
    await chrome.sidePanel.open({ tabId: tab.id });
    log(`Side panel opened for tab ${tab.id}`);
  } catch (error) {
    logError('Side panel open error:', error);
  } finally {
    // 300ms 후 디바운스 해제
    setTimeout(() => {
      opening = false;
    }, 300);
  }
});

// 패널 닫기 메시지 핸들러
chrome.runtime.onMessage.addListener(async (message, sender) => {
  if (message.type === 'closeSidePanel') {
    try {
      // 현재 활성 탭 가져오기
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.sidePanel.setOptions({
          tabId: tab.id,
          enabled: false
        });
        log(`Side panel closed for tab ${tab.id}`);
      }
    } catch (error) {
      logError('Failed to close side panel:', error);
    }
  }
});
