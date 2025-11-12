/**
 * GEO 검사 탭 UI 렌더링 및 상호작용
 *
 * 책임:
 * - 검사 결과 UI 렌더링 (점수, 체크리스트, LLM 의견)
 * - 사용자 이벤트 처리 (검사 시작, 새로고침)
 * - 로딩/에러 상태 관리
 */

import { runAudit, getImprovement, logAuditResult } from './geo-audit.js';
import { groupChecklistByCategory, GEO_CHECKLIST } from './geo-checklist.js';

/**
 * Content Script에 메시지 전송
 * @param {string} action - 메시지 액션
 * @param {Object} data - 메시지 데이터
 * @returns {Promise} 응답 데이터
 */
function sendMessageToContent(action, data = {}) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) {
        reject(new Error('활성 탭을 찾을 수 없습니다'));
        return;
      }

      chrome.tabs.sendMessage(
        tabs[0].id,
        { action, ...data },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response?.error) {
            reject(new Error(response.error));
          } else {
            resolve(response?.data);
          }
        }
      );
    });
  });
}

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
    displayDualResult: (dualResult, improvement) => displayDualAuditResult(elements, dualResult, improvement),
    displayError: (error) => displayError(elements, error),
    displayLoading: (isLoading) => displayLoading(elements, isLoading)
  };
}

/**
 * 검사 시작 핸들러 (Dual Audit 실행)
 *
 * @param {Object} elements - UI 요소 맵
 * @param {Function} getLogger - 로거 함수
 * @param {Function} onStartAudit - 검사 시작 콜백
 */
async function handleRunAudit(elements, getLogger, onStartAudit) {
  displayLoading(elements, true);
  displayError(elements, '');

  try {
    // 현재 탭 URL 가져오기
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];
    const currentUrl = currentTab?.url;

    if (!currentUrl) {
      throw new Error('현재 탭 URL을 찾을 수 없습니다');
    }

    // http/https만 지원
    if (!currentUrl.startsWith('http://') && !currentUrl.startsWith('https://')) {
      throw new Error('http/https URL만 지원합니다 (현재: ' + currentUrl.split(':')[0] + ')');
    }

    // 콜백 실행 (페이지 새로고침 등)
    await onStartAudit();

    // 짧은 딜레이 후 검사 시작 (페이지 로딩 완료 대기)
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Dual Audit 실행
    getLogger('🔍 GEO Dual Audit 시작...');
    const { runDualAudit, getImprovement, logAuditResult } = await import('./geo-audit.js');

    const dualResult = await runDualAudit(currentUrl);

    // 결과 기록 (봇 기준)
    getLogger('🤖 봇 검사 결과:');
    logAuditResult(dualResult.botResult);
    getLogger('👤 브라우저 검사 결과:');
    logAuditResult(dualResult.clientResult);
    getLogger(`⚠️ 차이점: ${dualResult.differences.length}개`);

    // LLM 의견 수집 (봇 검사 기준)
    getLogger('💡 LLM 의견 수집 중 (봇 관점)...');
    let improvement = '';
    try {
      improvement = await getImprovement(dualResult.botResult);
    } catch (error) {
      getLogger('⚠️ LLM 의견 수집 실패: ' + error.message);
      // LLM 실패는 검사 결과는 보여주되, 의견은 생략
    }

    // UI 업데이트 (Dual Audit 결과)
    displayDualAuditResult(elements, dualResult, improvement);

    getLogger('✅ GEO Dual Audit 완료');
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
  if (improvement && elements.improvementSection) {
    const formattedHtml = formatImprovement(improvement);
    elements.improvementSection.innerHTML = `
      <div class="geo-improvement">
        <h3>💡 AI 개선 의견</h3>
        ${formattedHtml}
      </div>
    `;
  } else if (elements.improvementSection) {
    elements.improvementSection.innerHTML = '';
  }

  // 결과 섹션 표시
  elements.resultSection.style.display = 'block';
}

/**
 * Dual Audit 결과 렌더링 (봇 vs 브라우저)
 *
 * @param {Object} elements - UI 요소 맵
 * @param {Object} dualResult - runDualAudit()의 결과
 * @param {string} improvement - LLM 개선 의견 (선택)
 */
function displayDualAuditResult(elements, dualResult, improvement = '') {
  if (!elements.resultSection) return;

  const { botResult, clientResult, differences } = dualResult;

  // 차이점 경고
  const diffWarning = differences.length > 0
    ? `<div class="geo-diff-warning">⚠️ <strong>차이점 ${differences.length}개 발견</strong>: 봇은 못 보지만 브라우저는 보는 요소가 있습니다</div>`
    : `<div class="geo-diff-success">✅ 봇과 브라우저 결과가 일치합니다</div>`;

  // 점수 비교
  const scoreComparison = `
    <div class="geo-score-comparison">
      <h3>📊 점수 비교</h3>
      <div class="geo-score-row">
        <div class="geo-score-col">
          <div class="geo-score-label">🤖 봇 (초기 HTML)</div>
          <div class="geo-score-value ${botResult.scores.total < 50 ? 'low' : ''}">
            ${botResult.scores.total}/100
          </div>
          <div class="geo-score-detail">
            SEO: ${botResult.scores.seo} | AEO: ${botResult.scores.aeo} | GEO: ${botResult.scores.geo}
          </div>
        </div>
        <div class="geo-score-col">
          <div class="geo-score-label">👤 브라우저 (JS 실행 후)</div>
          <div class="geo-score-value ${clientResult.scores.total < 50 ? 'low' : ''}">
            ${clientResult.scores.total}/100
          </div>
          <div class="geo-score-detail">
            SEO: ${clientResult.scores.seo} | AEO: ${clientResult.scores.aeo} | GEO: ${clientResult.scores.geo}
          </div>
        </div>
      </div>
      ${differences.length > 0 ? `<div class="geo-score-gap">
        <span class="geo-gap-icon">📉</span>
        <span class="geo-gap-text">${Math.abs(clientResult.scores.total - botResult.scores.total)}점 차이</span>
        <span class="geo-gap-hint">→ CSR 의존도가 높습니다. 검색봇이 제대로 읽지 못할 수 있습니다.</span>
      </div>` : ''}
    </div>
  `;

  // 항목별 나란히 비교
  const grouped = groupChecklistByCategory();
  let comparisonHtml = '<div class="geo-dual-comparison">';

  Object.entries(grouped).forEach(([category, items]) => {
    const categoryLabel = { seo: 'SEO', aeo: 'AEO', geo: 'GEO' }[category];
    comparisonHtml += `<div class="geo-category">
      <h3 class="geo-category-title">${categoryLabel}</h3>
      <div class="geo-items">`;

    // 각 항목별로 봇/브라우저 나란히 표시
    items.forEach(item => {
      const botItem = botResult.results.find(r => r.id === item.id);
      const clientItem = clientResult.results.find(r => r.id === item.id);
      const isDifferent = differences.some(d => d.id === item.id);

      comparisonHtml += renderDualCheckItem(botItem, clientItem, isDifferent);
    });

    comparisonHtml += `</div></div>`;
  });

  comparisonHtml += '</div>';

  // LLM 의견 (botResult 기준으로 생성)
  let improvementHtml = '';
  if (improvement && elements.improvementSection) {
    const formattedHtml = formatImprovement(improvement);
    improvementHtml = `
      <div class="geo-improvement">
        <h3>💡 AI 개선 의견 (봇이 보는 관점)</h3>
        ${formattedHtml}
      </div>
    `;
  }

  // 전체 조합
  elements.scoreCard.innerHTML = diffWarning + scoreComparison;
  elements.checklistContainer.innerHTML = comparisonHtml;
  if (elements.improvementSection) {
    elements.improvementSection.innerHTML = improvementHtml;
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
 * @param {Array} differences - 차이점 목록 (선택, Dual Audit 시)
 * @returns {string} HTML 문자열
 */
function renderCheckItem(result, differences = []) {
  const icon = result.passed ? '✅' : '❌';
  const status = result.passed ? 'passed' : 'failed';

  // 차이점 강조 (빨간색)
  const isDifferent = differences.some(d => d.id === result.id);
  const diffClass = isDifferent ? 'geo-item-diff' : '';
  const diffBadge = isDifferent ? '<span class="geo-diff-badge">⚠️ 차이</span>' : '';

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
    <div class="geo-item ${status} ${diffClass}">
      <div class="geo-item-header">
        <span class="geo-item-icon">${icon}</span>
        <span class="geo-item-title">${result.title}</span>
        ${diffBadge}
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
 * Dual Audit용 항목별 비교 렌더링 (봇 vs 브라우저)
 *
 * @param {CheckResult} botItem - 봇 검사 결과
 * @param {CheckResult} clientItem - 브라우저 검사 결과
 * @param {boolean} isDifferent - 차이점 여부
 * @returns {string} HTML 문자열
 */
function renderDualCheckItem(botItem, clientItem, isDifferent) {
  const diffClass = isDifferent ? 'geo-item-diff' : '';
  const diffBadge = isDifferent ? '<span class="geo-diff-badge">⚠️ 차이</span>' : '';

  const botIcon = botItem.passed ? '✅' : '❌';
  const clientIcon = clientItem.passed ? '✅' : '❌';

  return `
    <div class="geo-dual-item ${diffClass}">
      <div class="geo-dual-header">
        <span class="geo-item-title">${botItem.title}</span>
        ${diffBadge}
        <span class="geo-item-weight">${botItem.weight}pt</span>
      </div>

      <div class="geo-dual-results">
        <div class="geo-dual-col bot-col">
          <div class="geo-dual-label">🤖 봇</div>
          <div class="geo-dual-status ${botItem.passed ? 'passed' : 'failed'}">
            ${botIcon} ${botItem.passed ? '통과' : '실패'} (${botItem.weight}pt)
          </div>
          ${!botItem.passed ? `<div class="geo-item-hint">💡 ${botItem.hint}</div>` : ''}
        </div>

        <div class="geo-dual-col client-col">
          <div class="geo-dual-label">👤 브라우저</div>
          <div class="geo-dual-status ${clientItem.passed ? 'passed' : 'failed'}">
            ${clientIcon} ${clientItem.passed ? '통과' : '실패'} (${clientItem.weight}pt)
          </div>
          ${!clientItem.passed ? `<div class="geo-item-hint">💡 ${clientItem.hint}</div>` : ''}
        </div>
      </div>
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
 * LLM 개선 의견 포맷팅 (마크다운 → HTML)
 *
 * LLM이 마크다운 형식으로 반환한 개선 의견을 HTML로 변환합니다.
 *
 * 입력 형식:
 * ```
 * ## 1. 메타 설명 추가
 * **왜 필요한가?** 메타 설명은...
 * **어떻게 개선할까?**
 * - 150-160자 범위로 작성
 * - 주요 키워드 포함
 * **기대 효과**
 * - CTR 증가
 * - 검색 결과에서 완전한 설명 표시
 * ```
 *
 * @param {string} markdown - LLM이 반환한 마크다운 문자열
 * @returns {string} HTML 문자열 (렌더링 가능)
 */
function formatImprovement(markdown) {
  if (!markdown || typeof markdown !== 'string') {
    return '';
  }

  // 간단한 마크다운 → HTML 변환
  let html = markdown
    // ## 제목 → <h3>
    .replace(/^## (.+)$/gm, '<h3 class="geo-improvement-h3">$1</h3>')
    // **굵은 글씨** → <strong>
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // *이탤릭* → <em>
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // 줄바꿈을 <p>로 분리
    .split('\n\n')
    .map(para => {
      para = para.trim();
      if (!para) return '';

      // 불릿 리스트 처리 (- 로 시작하는 줄)
      if (para.includes('\n- ')) {
        const lines = para.split('\n');
        const title = lines[0];
        const items = lines.slice(1).filter(l => l.trim().startsWith('-'));

        let html = '';
        if (title && !title.startsWith('-')) {
          html += `<p>${title}</p>`;
        }

        if (items.length > 0) {
          html += '<ul class="geo-improvement-list">\n';
          items.forEach(item => {
            const text = item.replace(/^-\s*/, '');
            html += `<li>${text}</li>\n`;
          });
          html += '</ul>';
        }

        return html;
      }

      // 일반 문장
      return `<p>${para}</p>`;
    })
    .join('\n');

  return `<div class="geo-improvement-content">${html}</div>`;
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
