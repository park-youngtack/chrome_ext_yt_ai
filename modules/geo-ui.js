/**
 * GEO 검사 탭 UI 렌더링 및 상호작용
 *
 * 책임:
 * - 검사 결과 UI 렌더링 (점수, 체크리스트, LLM 의견)
 * - 사용자 이벤트 처리 (검사 시작, 새로고침)
 * - 로딩/에러 상태 관리
 */

import { runAudit, getImprovement, logAuditResult } from './geo-audit.js';
import { groupChecklistByCategory } from './geo-checklist.js';

/**
 * GEO 탭 초기화
 * - HTML 요소 캐시
 * - 이벤트 리스너 등록
 *
 * @param {Object} config - 설정 객체
 * @param {Function} config.onStartAudit - 검사 시작 콜백
 * @param {Function} config.getLogger - 로거 함수
 */
export function initGeoTab(config = {}) {
  const {
    onStartAudit = () => {},
    getLogger = console.log
  } = config;

  // UI 요소 캐시
  const elements = {
    tab: document.getElementById('geoTab'),
    container: document.getElementById('geoContainer'),
    runButton: document.getElementById('geoRunAuditBtn'),
    resultSection: document.getElementById('geoResultSection'),
    scoreCard: document.getElementById('geoScoreCard'),
    checklistContainer: document.getElementById('geoChecklistContainer'),
    improvementSection: document.getElementById('geoImprovementSection'),
    loadingSpinner: document.getElementById('geoLoadingSpinner'),
    errorMessage: document.getElementById('geoErrorMessage')
  };

  // 이벤트 리스너
  elements.runButton?.addEventListener('click', async () => {
    await handleRunAudit(elements, getLogger, onStartAudit);
  });

  return {
    elements,
    show: () => showGeoTab(elements),
    hide: () => hideGeoTab(elements),
    displayResult: (result) => displayAuditResult(elements, result),
    displayError: (error) => displayError(elements, error),
    displayLoading: (isLoading) => displayLoading(elements, isLoading)
  };
}

/**
 * 검사 시작 핸들러
 *
 * @param {Object} elements - UI 요소 맵
 * @param {Function} getLogger - 로거 함수
 * @param {Function} onStartAudit - 검사 시작 콜백
 */
async function handleRunAudit(elements, getLogger, onStartAudit) {
  displayLoading(elements, true);
  displayError(elements, '');

  try {
    // 콜백 실행 (페이지 새로고침 등)
    await onStartAudit();

    // 짧은 딜레이 후 검사 시작 (페이지 로딩 완료 대기)
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 검사 실행
    getLogger('🔍 GEO 검사 시작...');
    const auditResult = await runAudit();

    // 결과 기록
    logAuditResult(auditResult);

    // LLM 의견 수집
    getLogger('💡 LLM 의견 수집 중...');
    let improvement = '';
    try {
      improvement = await getImprovement(auditResult);
    } catch (error) {
      getLogger('⚠️ LLM 의견 수집 실패: ' + error.message);
      // LLM 실패는 검사 결과는 보여주되, 의견은 생략
    }

    // UI 업데이트
    displayAuditResult(elements, auditResult, improvement);

    getLogger('✅ GEO 검사 완료');
  } catch (error) {
    getLogger('❌ 검사 실패: ' + error.message);
    displayError(elements, error.message);
  } finally {
    displayLoading(elements, false);
  }
}

/**
 * 검사 결과 렌더링
 *
 * @param {Object} elements - UI 요소 맵
 * @param {AuditResult} auditResult - 검사 결과
 * @param {string} improvement - LLM 개선 의견
 */
function displayAuditResult(elements, auditResult, improvement = '') {
  if (!elements.resultSection) return;

  const { scores, results, passedCount, failedCount } = auditResult;

  // 1. 점수 카드 렌더링
  elements.scoreCard.innerHTML = `
    <div class="geo-scores">
      <div class="geo-score-item total">
        <div class="score-value">${scores.total}</div>
        <div class="score-label">총점</div>
      </div>
      <div class="geo-score-item seo">
        <div class="score-value">${scores.seo}</div>
        <div class="score-label">SEO</div>
      </div>
      <div class="geo-score-item aeo">
        <div class="score-value">${scores.aeo}</div>
        <div class="score-label">AEO</div>
      </div>
      <div class="geo-score-item geo">
        <div class="score-value">${scores.geo}</div>
        <div class="score-label">GEO</div>
      </div>
    </div>
    <div class="geo-score-summary">
      <span>✅ 통과: ${passedCount}개</span>
      <span>❌ 실패: ${failedCount}개</span>
    </div>
  `;

  // 2. 체크리스트 렌더링 (카테고리별)
  const grouped = groupChecklistByCategory();
  let checklistHtml = '';

  Object.entries(grouped).forEach(([category, items]) => {
    const categoryResults = results.filter(r => r.category === category);
    const categoryLabel = { seo: 'SEO', aeo: 'AEO', geo: 'GEO' }[category];

    checklistHtml += `<div class="geo-category">
      <h3 class="geo-category-title">${categoryLabel}</h3>
      <div class="geo-items">
        ${categoryResults.map(result => renderCheckItem(result)).join('')}
      </div>
    </div>`;
  });

  elements.checklistContainer.innerHTML = checklistHtml;

  // 3. LLM 의견 렌더링
  if (improvement) {
    elements.improvementSection.innerHTML = `
      <div class="geo-improvement">
        <h3>💡 AI 개선 의견</h3>
        <div class="geo-improvement-content">${formatImprovement(improvement)}</div>
      </div>
    `;
  } else {
    elements.improvementSection.innerHTML = '';
  }

  // 결과 섹션 표시
  elements.resultSection.style.display = 'block';
}

/**
 * 개별 체크 항목 렌더링
 *
 * @param {CheckResult} result - 체크 결과
 * @returns {string} HTML 문자열
 */
function renderCheckItem(result) {
  const icon = result.passed ? '✅' : '❌';
  const status = result.passed ? 'passed' : 'failed';

  return `
    <div class="geo-item ${status}">
      <div class="geo-item-header">
        <span class="geo-item-icon">${icon}</span>
        <span class="geo-item-title">${result.title}</span>
        <span class="geo-item-weight">${result.weight}pt</span>
      </div>
      ${!result.passed ? `<div class="geo-item-hint">💡 ${result.hint}</div>` : ''}
    </div>
  `;
}

/**
 * LLM 개선 의견 포맷팅 (마크다운 → HTML)
 *
 * @param {string} text - LLM 응답 텍스트
 * @returns {string} HTML 문자열
 */
function formatImprovement(text) {
  return text
    .replace(/\n\n/g, '</p><p>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\d\.\s/g, '<br><strong>$&</strong>')
    .replace(/^(.+)$/gm, (match) => {
      if (match.startsWith('<')) return match;
      return `<p>${match}</p>`;
    });
}

/**
 * 로딩 상태 표시
 *
 * @param {Object} elements - UI 요소 맵
 * @param {boolean} isLoading - 로딩 중 여부
 */
function displayLoading(elements, isLoading) {
  if (!elements.loadingSpinner) return;

  if (isLoading) {
    elements.loadingSpinner.style.display = 'flex';
    elements.resultSection.style.display = 'none';
    elements.runButton.disabled = true;
  } else {
    elements.loadingSpinner.style.display = 'none';
    elements.runButton.disabled = false;
  }
}

/**
 * 에러 메시지 표시
 *
 * @param {Object} elements - UI 요소 맵
 * @param {string} message - 에러 메시지
 */
function displayError(elements, message) {
  if (!elements.errorMessage) return;

  if (message) {
    elements.errorMessage.textContent = `❌ ${message}`;
    elements.errorMessage.style.display = 'block';
  } else {
    elements.errorMessage.style.display = 'none';
  }
}

/**
 * GEO 탭 표시
 *
 * @param {Object} elements - UI 요소 맵
 */
function showGeoTab(elements) {
  if (elements.tab) elements.tab.style.display = 'block';
}

/**
 * GEO 탭 숨김
 *
 * @param {Object} elements - UI 요소 맵
 */
function hideGeoTab(elements) {
  if (elements.tab) elements.tab.style.display = 'none';
}
