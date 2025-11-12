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
 * 표시 내용:
 * - 체크 결과 (✅/❌)
 * - 항목 제목
 * - 가중치
 * - 상세 설명 (description) - SSR/CSR 주의사항 포함
 * - 실패 항목: 개선 방법 (hint)
 *
 * @param {CheckResult} result - 체크 결과
 * @returns {string} HTML 문자열
 */
function renderCheckItem(result) {
  const icon = result.passed ? '✅' : '❌';
  const status = result.passed ? 'passed' : 'failed';

  // description의 \n을 <br>로 변환하여 줄바꿈 표시
  const formattedDescription = result.description
    ? result.description.split('\n').map(line => {
        // 불릿 항목 (- 로 시작)을 보기 좋게 포맷팅
        if (line.trim().startsWith('-')) {
          return `<div class="geo-item-bullet">${line}</div>`;
        }
        // 화살표 (→) 로 시작하는 행동 유도 텍스트
        if (line.trim().startsWith('→')) {
          return `<div class="geo-item-action">${line}</div>`;
        }
        // 일반 텍스트
        if (line.trim()) {
          return `<div>${line}</div>`;
        }
        // 빈 줄 (단락 구분)
        return '<div style="height: 8px;"></div>';
      }).join('')
    : '';

  return `
    <div class="geo-item ${status}">
      <div class="geo-item-header">
        <span class="geo-item-icon">${icon}</span>
        <span class="geo-item-title">${result.title}</span>
        <span class="geo-item-weight">${result.weight}pt</span>
      </div>

      <!-- 상세 설명 (SSR/CSR 주의사항 포함) -->
      ${formattedDescription ? `<div class="geo-item-description">${formattedDescription}</div>` : ''}

      <!-- 실패 항목: 개선 방법 -->
      ${!result.passed ? `<div class="geo-item-hint">💡 ${result.hint}</div>` : ''}
    </div>
  `;
}

/**
 * HTML 문자를 엔터티로 이스케이프
 * 브라우저가 < > & 등을 태그로 해석하지 않도록 보호
 *
 * @param {string} text - 원본 텍스트
 * @returns {string} 이스케이프된 텍스트
 *
 * @example
 * escapeHtml('<meta name="description">')
 * // "&lt;meta name=&quot;description&quot;&gt;"
 */
function escapeHtml(text) {
  if (!text) return text;
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

/**
 * HTML 엔터티를 실제 문자로 디코딩 (이미 &lt;&gt;로 인코딩된 코드 표시용)
 * LLM이 보낸 &lt;meta&gt;를 <meta>로 변환하여 pre/code에 표시
 *
 * @param {string} text - HTML 엔터티로 인코딩된 텍스트
 * @returns {string} 디코딩된 텍스트
 *
 * @example
 * decodeHtmlEntities('&lt;meta name=&quot;description&quot;&gt;')
 * // '<meta name="description">'
 */
function decodeHtmlEntities(text) {
  if (!text) return text;
  const map = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#039;': "'"
  };
  // 역순으로 처리 (& 먼저 처리하면 &lt;가 꼬임)
  let result = text;
  result = result.replace(/&quot;/g, '"');
  result = result.replace(/&#039;/g, "'");
  result = result.replace(/&lt;/g, '<');
  result = result.replace(/&gt;/g, '>');
  result = result.replace(/&amp;/g, '&');
  return result;
}

/**
 * LLM 개선 의견 포맷팅 (JSON 구조화 데이터 → HTML)
 *
 * LLM이 반환하는 JSON 구조:
 * {
 *   "improvements": [
 *     {
 *       "title": "제목",
 *       "methods": ["방법 1", "방법 2", ...],
 *       "codeExample": "&lt;meta ...&gt;",  // HTML 엔터티로 인코딩됨
 *       "effects": ["효과 1", "효과 2", ...]
 *     },
 *     ...
 *   ],
 *   "summary": "종합 효과"
 * }
 *
 * 장점:
 * - 구조화된 데이터이므로 파싱 오류 없음
 * - HTML 엔터티로 이미 인코딩되어 안전함
 * - 마크다운 파싱 불필요 (정규식 오류 제거)
 * - 타입 안전성 확보
 *
 * @param {Object} improvement - LLM이 반환한 JSON 객체
 * @returns {string} HTML 문자열 (렌더링 가능)
 *
 * @example
 * // LLM이 실제로 보내는 형식:
 * const response = `### 1. 제목 최적화
 * 구체적인 실행 방법:
 * - 30-60자 사이로 조정
 * - 주요 키워드 포함
 *
 * 예상 효과:
 * - CTR 증가
 * - AI 응답 포함 가능성 증대`;
 *
 * // 결과:
 * const html = formatImprovement(response);
 * // <h4>1. 제목 최적화</h4>
 * // <p>구체적인 실행 방법:</p>
 * // <ul><li>30-60자 사이로 조정</li><li>주요 키워드 포함</li></ul>
 * // <p>예상 효과:</p>
 * // <ul><li>CTR 증가</li><li>AI 응답 포함 가능성 증대</li></ul>
 */
function formatImprovement(improvement) {
  // JSON 객체가 아닌 경우 처리 (하위호환성)
  if (!improvement || typeof improvement !== 'object') return '';

  const { improvements = [], summary = '' } = improvement;

  if (!Array.isArray(improvements) || improvements.length === 0) return '';

  let html = '<div class="geo-improvements-list">';

  // 각 개선 항목 렌더링
  improvements.forEach((item, idx) => {
    const { title = '', methods = [], codeExample = '', effects = [] } = item;

    html += `<div class="geo-improvement-item">
      <h4 class="geo-improvement-h4">${idx + 1}. ${escapeHtml(title)}</h4>

      <div class="geo-improvement-section">
        <strong class="geo-section-title">구체적인 실행 방법:</strong>
        <ul class="geo-unordered-list">
          ${methods.map(m => `<li>${escapeHtml(m)}</li>`).join('')}
        </ul>
      </div>`;

    // 코드 예시 (이미 HTML 엔터티로 인코딩됨)
    if (codeExample) {
      html += `<div class="geo-improvement-section">
        <strong class="geo-section-title">실제 코드 예시:</strong>
        <pre><code>${decodeHtmlEntities(codeExample)}</code></pre>
      </div>`;
    }

    html += `<div class="geo-improvement-section">
        <strong class="geo-section-title">예상 효과:</strong>
        <ul class="geo-unordered-list">
          ${effects.map(e => `<li>${escapeHtml(e)}</li>`).join('')}
        </ul>
      </div>
    </div>`;
  });

  // 종합 기대 효과
  if (summary) {
    html += `<div class="geo-improvement-summary">
      <h4 class="geo-improvement-h4">종합 기대 효과</h4>
      <p>${escapeHtml(summary)}</p>
    </div>`;
  }

  html += '</div>';
  return html;
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
