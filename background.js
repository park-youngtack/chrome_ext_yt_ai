// Background Service Worker

// 확장프로그램 설치 시
chrome.runtime.onInstalled.addListener(() => {
  console.log('웹페이지 번역기가 설치되었습니다.');

  // 사이드패널 자동 오픈 설정 (액션 클릭 시 자동으로 열림)
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch(error => console.error('사이드패널 동작 설정 오류:', error));
});

// 아이콘 클릭 시 해당 탭에서만 side panel 토글
// 각 탭마다 독립적으로 패널을 열고 닫을 수 있음
// 중복 호출 방지를 위한 디바운스
let opening = false;

chrome.action.onClicked.addListener(async (tab) => {
  // 디바운스: 이미 처리 중이면 무시
  if (opening) {
    console.log('Side panel 처리 중, 중복 클릭 무시');
    return;
  }

  opening = true;

  try {
    // setOptions만 설정 (open()은 호출하지 않음 - 자동 오픈이 처리)
    await chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: 'sidepanel.html',
      enabled: true
    });

    console.log(`Side panel options set for tab ${tab.id}`);
  } catch (error) {
    console.error('Side panel toggle error:', error);
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
        console.log(`Side panel closed for tab ${tab.id}`);
      }
    } catch (error) {
      console.error('Failed to close side panel:', error);
    }
  }
});
