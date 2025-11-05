// Background Service Worker

// 확장프로그램 설치 시
chrome.runtime.onInstalled.addListener(() => {
  console.log('웹페이지 번역기가 설치되었습니다.');
});

// 아이콘 클릭 시 해당 탭에서만 side panel 토글
// 각 탭마다 독립적으로 패널을 열고 닫을 수 있음
chrome.action.onClicked.addListener(async (tab) => {
  try {
    // 현재 탭의 side panel 상태 확인
    const panelOptions = await chrome.sidePanel.getOptions({ tabId: tab.id });

    if (panelOptions.enabled) {
      // 이미 활성화되어 있으면 비활성화 (자동으로 닫힘)
      await chrome.sidePanel.setOptions({
        tabId: tab.id,
        enabled: false
      });
      console.log(`Side panel disabled for tab ${tab.id}`);
    } else {
      // 비활성화되어 있으면 활성화 및 열기
      await chrome.sidePanel.setOptions({
        tabId: tab.id,
        path: 'sidepanel.html',
        enabled: true
      });

      // Side panel 열기
      await chrome.sidePanel.open({ tabId: tab.id });
      console.log(`Side panel opened for tab ${tab.id}`);
    }
  } catch (error) {
    console.error('Side panel toggle error:', error);
  }
});
