/**
 * GEO 검사 탭 초기화 및 이벤트 처리
 *
 * 책임:
 * - GEO 탭 UI 초기화
 * - "검사 시작" 버튼 이벤트 연결
 * - Content Script와 통신
 */

import { initGeoTab as initGeoUI } from './geo-ui.js';
import { logInfo, logError } from '../logger.js';
import * as State from './state.js';

/**
 * GEO 탭 초기화
 * - UI 요소 캐시 및 초기화
 * - "검사 시작" 버튼 이벤트 연결
 */
export function initGeoTab() {
  const runBtn = document.getElementById('geoRunAuditBtn');
  if (!runBtn) return;

  // UI 초기화
  const geoUI = initGeoUI({
    onStartAudit: handleStartAudit,
    getLogger: logInfo
  });

  // "검사 시작" 버튼 이벤트
  runBtn.addEventListener('click', async () => {
    await handleStartAudit();
  });

  logInfo('GEO_TAB_INIT', 'GEO 검사 탭 초기화 완료');
}

/**
 * 검사 시작 핸들러
 * - 현재 탭의 페이지 새로고침
 * - Content Script에 검사 요청 전송
 */
async function handleStartAudit() {
  try {
    const tabId = State.getCurrentTabId();
    if (!tabId) {
      logError('GEO_AUDIT_ERROR', '현재 탭 ID를 찾을 수 없습니다');
      return;
    }

    logInfo('GEO_AUDIT_START', '검사 시작');
  } catch (error) {
    logError('GEO_AUDIT_ERROR', '검사 시작 실패', {}, error);
    throw error;
  }
}
