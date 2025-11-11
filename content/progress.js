/**
 * Content Progress Module
 * - 타이머/진행 푸시/배치 카운팅 관리
 * - content.js로부터 port와 상태 getter를 주입받아 동작
 */
(function progressModule(){
  try {
    window.WPT = window.WPT || {};
    const WPT = window.WPT;
    const C = (WPT.Constants && WPT.Constants.PORT_MESSAGES) || { PROGRESS: 'progress' };

    // 내부 상태
    let activeMs = 0;
    let lastTick = null;
    let timerId = null;
    let inflight = 0;
    let portRef = null;
    let getStatus = null;

    function setPort(port) { portRef = port || null; }
    function clearPort() { portRef = null; }
    function setStatusGetter(fn) { getStatus = typeof fn === 'function' ? fn : null; }
    function getActiveMs() { return activeMs; }

    function startTimer() {
      if (timerId) return;
      lastTick = performance.now();
      timerId = setInterval(() => {
        const now = performance.now();
        activeMs += (now - lastTick);
        lastTick = now;
        pushProgress();
      }, 1000);
    }

    function stopTimer() {
      if (!timerId) return;
      clearInterval(timerId);
      if (lastTick) {
        activeMs += performance.now() - lastTick;
      }
      timerId = null;
      lastTick = null;
      pushProgress();
    }

    function onBatchStart() {
      inflight++;
      if (inflight === 1) startTimer();
    }

    function onBatchEnd() {
      inflight--;
      if (inflight === 0) stopTimer();
    }

    function pushProgress() {
      if (!portRef || !getStatus) return;
      try {
        const status = getStatus();
        portRef.postMessage({
          type: C.PROGRESS,
          data: { ...status, activeMs }
        });
        if (chrome.runtime.lastError) {
          portRef = null;
        }
      } catch (_) {
        portRef = null;
      }
    }

    WPT.Progress = {
      setPort, clearPort, setStatusGetter,
      startTimer, stopTimer, onBatchStart, onBatchEnd,
      pushProgress, getActiveMs
    };
  } catch (_) {
    // no-op
  }
})();

