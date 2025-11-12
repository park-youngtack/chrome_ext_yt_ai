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
 * LLM 개선 의견 포맷팅 (마크다운 → HTML)
 *
 * 지원하는 마크다운 형식:
 * - ### 세 번째 제목  → <h4>제목</h4>
 * - ## 두 번째 제목   → <h3>제목</h3>
 * - # 첫 번째 제목    → <h2>제목</h2>
 * - **굵은텍스트**    → <strong>굵은텍스트</strong>
 * - 1. 번호 항목      → <ol><li>번호 항목</li></ol>
 * - - 불릿 항목      → <ul><li>불릿 항목</li></ul>
 * - ```code```        → <pre><code>code</code></pre>
 * - 빈 줄            → <p> 단락 구분
 *
 * @param {string} text - LLM 응답 텍스트 (마크다운 형식)
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
function formatImprovement(text) {
  if (!text) return '';

  let html = text
    // 마크다운 제목 변환 (### → h4, ## → h3, # → h2)
    .replace(/^### (.+)$/gm, '<h4 class="geo-improvement-h4">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="geo-improvement-h3">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 class="geo-improvement-h2">$1</h2>');

  // 코드블록 변환 (```code``` → <pre><code>)
  html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // 인라인 코드 변환 (`code` → <code class="inline-code">)
  html = html.replace(/`([^`]+)`/g, '<code class="geo-inline-code">$1</code>');

  // 굵은 텍스트 (**text**)
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // 이탤릭 (*text*) - 주의: ** 이미 처리됨
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

  // 소제목 패턴 강화: "제목:" 형식을 <strong> 태그로 변환
  // 예: "구체적인 실행 방법:" → <strong class="geo-section-title">구체적인 실행 방법:</strong>
  html = html.replace(/^(.+?):(\s*)$/gm, (match, title, space) => {
    // h1-h4 제목이 아닌 경우만 변환
    if (!title.startsWith('<')) {
      return `<strong class="geo-section-title">${title}:</strong>${space}`;
    }
    return match;
  });

  // 줄 단위 처리 (번호 목록, 불릿 처리)
  const lines = html.split('\n');
  let inOrderedList = false;
  let inUnorderedList = false;
  let inOrderedSection = null; // 현재 섹션 제목 저장 (들여쓰기용)
  let listBuffer = '';
  const result = [];

  lines.forEach((line, idx) => {
    const trimmed = line.trim();

    // 빈 줄 처리
    if (trimmed === '') {
      if (inOrderedList) {
        result.push(`<ol class="geo-ordered-list">${listBuffer}</ol>`);
        inOrderedList = false;
        listBuffer = '';
      }
      if (inUnorderedList) {
        result.push(`<ul class="geo-unordered-list">${listBuffer}</ul>`);
        inUnorderedList = false;
        listBuffer = '';
      }
      result.push('');
      return;
    }

    // 번호 목록 (1. 2. 3. ...)
    const orderedMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (orderedMatch) {
      if (inUnorderedList) {
        result.push(`<ul class="geo-unordered-list">${listBuffer}</ul>`);
        inUnorderedList = false;
        listBuffer = '';
      }
      inOrderedList = true;
      listBuffer += `<li>${orderedMatch[2]}</li>`;
      return;
    }

    // 불릿 목록 (- •)
    const bulletMatch = trimmed.match(/^[-•]\s+(.+)$/);
    if (bulletMatch) {
      if (inOrderedList) {
        result.push(`<ol class="geo-ordered-list">${listBuffer}</ol>`);
        inOrderedList = false;
        listBuffer = '';
      }
      inUnorderedList = true;
      listBuffer += `<li>${bulletMatch[1]}</li>`;
      return;
    }

    // 목록 종료, 일반 텍스트 또는 소제목
    if (inOrderedList) {
      result.push(`<ol class="geo-ordered-list">${listBuffer}</ol>`);
      inOrderedList = false;
      listBuffer = '';
    }
    if (inUnorderedList) {
      result.push(`<ul class="geo-unordered-list">${listBuffer}</ul>`);
      inUnorderedList = false;
      listBuffer = '';
    }

    // 제목, 코드블록, 강조(strong) 처리된 소제목이면 그대로, 아니면 단락으로 감싸기
    if (trimmed.startsWith('<')) {
      result.push(line);
    } else if (trimmed.length > 0) {
      result.push(`<p>${line}</p>`);
    } else {
      result.push(line);
    }
  });

  // 남은 목록 처리
  if (inOrderedList) {
    result.push(`<ol class="geo-ordered-list">${listBuffer}</ol>`);
  }
  if (inUnorderedList) {
    result.push(`<ul class="geo-unordered-list">${listBuffer}</ul>`);
  }

  // 빈 줄 기준으로 최종 정리
  html = result
    .join('\n')
    .split('\n\n')
    .filter(s => s.trim() !== '')
    .join('\n');

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
