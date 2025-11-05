// Background Service Worker

// 확장프로그램 설치 시
chrome.runtime.onInstalled.addListener(() => {
  console.log('웹페이지 번역기가 설치되었습니다.');
});

// 아이콘 클릭 시 사이드 패널 열기
chrome.action.onClicked.addListener(async (tab) => {
  console.log('Extension icon clicked for tab:', tab.id);

  // 사이드 패널 열기
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
    console.log('Side panel opened successfully');
  } catch (error) {
    console.error('Error opening side panel:', error);
  }
});
