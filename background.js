// Background Service Worker

// 확장프로그램 설치 시
chrome.runtime.onInstalled.addListener(() => {
  console.log('웹페이지 번역기가 설치되었습니다.');
});

// 아이콘 클릭 시 (추가 기능이 필요한 경우 여기에 구현)
chrome.action.onClicked.addListener((tab) => {
  // popup이 있으므로 여기서는 특별한 동작 불필요
  console.log('Extension icon clicked for tab:', tab.id);
});
