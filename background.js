// Background Service Worker

// 확장프로그램 설치 시
chrome.runtime.onInstalled.addListener(() => {
  console.log('웹페이지 번역기가 설치되었습니다.');

  // 아이콘 클릭 시 사이드 패널이 자동으로 열리고 토글되도록 설정
  // 이렇게 하면 Chrome이 자동으로 패널 열기/닫기를 처리하여 user gesture 문제가 발생하지 않음
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Error setting panel behavior:', error));
});
