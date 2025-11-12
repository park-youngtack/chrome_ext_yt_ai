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

    // 검사 실행 - Content Script에 메시지로 요청
    getLogger('🔍 GEO 검사 시작...');

    // Content Script에 selector 정의 목록 전송 (각 항목별로 어떤 selector를 사용할지)
    const selectorMap = GEO_CHECKLIST.map((item, idx) => ({
      idx,
      id: item.id,
      selectorCode: item.selector.toString() // 함수를 문자열로 변환
    }));

    // Content Script가 selector 결과를 반환
    const selectorResults = await sendMessageToContent('GEO_GET_SELECTORS', { selectors: selectorMap });

    // Sidepanel에서 validator 실행
    const results = [];
    let passedCount = 0;
    let failedCount = 0;

    for (const checkItem of GEO_CHECKLIST) {
      try {
        // Content Script에서 반환한 선택 결과 찾기
        const selectorResult = selectorResults.find(r => r.id === checkItem.id);
        const selected = selectorResult?.value;

        // validator 실행
        const passed = checkItem.validator(selected);

        // hint 실행 (함수인 경우)
        const hint = typeof checkItem.hint === 'function' ? checkItem.hint() : checkItem.hint;

        results.push({
          id: checkItem.id,
          title: checkItem.title,
          category: checkItem.category,
          weight: checkItem.weight,
          passed,
          hint
        });

        if (passed) passedCount++;
        else failedCount++;
      } catch (error) {
        const hint = typeof checkItem.hint === 'function' ? checkItem.hint() : checkItem.hint;
        results.push({
          id: checkItem.id,
          title: checkItem.title,
          category: checkItem.category,
          weight: checkItem.weight,
          passed: false,
          hint,
          error: error.message
        });
        failedCount++;
      }
    }

    // 점수 계산 (geo-audit.js의 로직 복사)
    const { calculateScores } = await import('./geo-audit.js');
    const scores = calculateScores(results);

    const auditResult = {
      results,
      scores,
      passedCount,
      failedCount,
      failedItems: results.filter(r => !r.passed).map(r => r.id),
      timestamp: new Date().toISOString()
    };

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
