// Background Service Worker

// 확장프로그램 설치 시
chrome.runtime.onInstalled.addListener(() => {
  console.log('웹페이지 번역기가 설치되었습니다.');
});

// 아이콘 클릭 시 사이드 패널 토글
chrome.action.onClicked.addListener(async (tab) => {
  console.log('Extension icon clicked for tab:', tab.id);

  try {
    // 패널이 열려있는지 확인
    const { sidePanelOpen } = await chrome.storage.local.get(['sidePanelOpen']);

    if (sidePanelOpen) {
      // 패널이 열려있으면 닫기 요청
      await chrome.storage.local.set({ closePanelRequest: Date.now() });
      console.log('Side panel close requested');
    } else {
      // 패널이 닫혀있으면 열기
      await chrome.sidePanel.open({ windowId: tab.windowId });
      await chrome.storage.local.set({ sidePanelOpen: true });
      console.log('Side panel opened successfully');
    }
  } catch (error) {
    console.error('Error toggling side panel:', error);
  }
});
