/**
 * GEO (Generative Engine Optimization) 검사 엔진
 *
 * 책임:
 * - 체크리스트 기반 페이지 자동 검사
 * - 카테고리별 점수 계산
 * - LLM에 검사 결과 전송 → 개선 의견 수집
 *
 * 데이터 흐름:
 * 1. runAudit() → 체크리스트 순회 (자동)
 * 2. calculateScores() → 점수 계산 (if 없음, 수식만)
 * 3. getImprovement() → LLM 의견 수집
 */

import { GEO_CHECKLIST, groupChecklistByCategory, calculateTotalWeights } from './geo-checklist.js';
import { getApiKey, getModel } from './settings.js';

/**
 * @typedef {Object} AuditResult
 * GEO 검사의 최종 결과 객체
 *
 * @property {Array<CheckResult>} results - 각 체크 항목별 상세 결과
 * @property {Object} scores - 카테고리별 점수 ({ seo: 0-100, aeo: 0-100, geo: 0-100, total: 0-100 })
 * @property {number} passedCount - 통과한 항목 수 (예: 15)
 * @property {number} failedCount - 실패한 항목 수 (예: 5)
 * @property {Array<string>} failedItems - 실패한 항목 ID 목록 (UI 강조용)
 * @property {string} timestamp - 검사 실행 시간 (ISO 8601 형식)
 *
 * @example
 * // geo-tab.js에서 사용:
 * const auditResult = await runAudit();
 * console.log(auditResult);
 * // {
 * //   results: [ { id: 'title_length', title: '제목 길이', ... }, ... ],
 * //   scores: { seo: 85, aeo: 90, geo: 78, total: 84 },
 * //   passedCount: 15,
 * //   failedCount: 5,
 * //   failedItems: ['title_length', 'meta_description'],
 * //   timestamp: '2025-11-12T10:30:45.123Z'
 * // }
 */

/**
 * @typedef {Object} CheckResult
 * 개별 체크 항목의 검사 결과
 *
 * @property {string} id - 체크 항목 고유 ID (예: 'title_length', 'meta_description')
 * @property {string} title - 항목 제목 (사용자에게 표시할 텍스트)
 * @property {boolean} passed - 통과 여부 (true=✅, false=❌)
 * @property {string} category - 체크 카테고리 ('seo' | 'aeo' | 'geo')
 * @property {number} weight - 점수 가중치 (예: 10, 5, 2)
 * @property {string} hint - 실패 시 개선 팁 (사용자가 읽을 텍스트)
 *
 * @example
 * // geo-checklist.js에서 정의된 항목:
 * {
 *   id: 'title_length',
 *   title: '페이지 제목 길이',
 *   category: 'seo',
 *   weight: 10,
 *   hint: '30-60자 사이의 제목을 사용하세요',
 *   selector: () => document.title,
 *   validator: (title) => title.length >= 30 && title.length <= 60
 * }
 */

/**
 * 페이지 자동 검사 실행
 *
 * 검사 흐름:
 * 1. GEO_CHECKLIST의 각 항목을 순회
 * 2. selector() 실행 → DOM에서 데이터 추출
 * 3. validator() 실행 → 추출한 데이터 검증
 * 4. 점수 계산 → 카테고리별 평점 산출
 *
 * @param {Document} doc - 검사할 DOM 문서 (기본: 현재 document)
 * @returns {Promise<AuditResult>} 검사 완료 결과
 *
 * @example
 * // geo-ui.js에서 호출:
 * const auditResult = await runAudit();
 * console.log(`점수: ${auditResult.scores.total}/100`);
 * console.log(`통과: ${auditResult.passedCount}/${auditResult.results.length}`);
 *
 * // 각 카테고리별 점수 확인:
 * console.log(`SEO: ${auditResult.scores.seo}`);
 * console.log(`AEO: ${auditResult.scores.aeo}`);
 * console.log(`GEO: ${auditResult.scores.geo}`);
 */
export async function runAudit(doc = document) {
  const results = [];
  let passedCount = 0;
  let failedCount = 0;

  // 체크리스트 순회 (자동, if 없음)
  for (const checkItem of GEO_CHECKLIST) {
    try {
      // 1. selector 실행 → DOM 요소 또는 데이터 추출
      const selected = checkItem.selector(doc);

      // 2. validator 실행 → pass/fail 결정
      const passed = checkItem.validator(selected);

      // 3. 결과 기록
      // hint가 함수이면 실행, 문자열이면 그대로 사용
      const hint = typeof checkItem.hint === 'function' ? checkItem.hint(doc) : checkItem.hint;

      results.push({
        id: checkItem.id,
        title: checkItem.title,
        category: checkItem.category,
        weight: checkItem.weight,
        passed,
        hint
      });

      // 통계
      if (passed) passedCount++;
      else failedCount++;
    } catch (error) {
      // selector/validator 에러는 fail 처리
      // hint가 함수이면 실행, 문자열이면 그대로 사용
      const hint = typeof checkItem.hint === 'function' ? checkItem.hint(doc) : checkItem.hint;

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

  // 점수 계산
  const scores = calculateScores(results);

  return {
    results,
    scores,
    passedCount,
    failedCount,
    failedItems: results.filter(r => !r.passed).map(r => r.id),
    timestamp: new Date().toISOString()
  };
}

/**
 * 카테고리별 점수 계산 (수식 기반, if 없음)
 *
 * 점수 계산 로직:
 * - 각 항목: (통과 ? 가중치 : 0) / 총 가중치 * 100
 * - 카테고리별: 해당 카테고리 점수만 합산
 * - 총점: 전체 카테고리 평균
 *
 * @param {Array<CheckResult>} results - 검사 결과 (runAudit()의 출력)
 * @returns {Object} { seo: number, aeo: number, geo: number, total: number }
 *
 * @example
 * // runAudit()에서 받은 results 사용:
 * const auditResult = await runAudit();
 * const scores = calculateScores(auditResult.results);
 * console.log(scores); // { seo: 85, aeo: 90, geo: 78, total: 84 }
 */
export function calculateScores(results) {
  const weights = calculateTotalWeights();
  const grouped = groupChecklistByCategory();

  // 카테고리별 획득 점수 계산
  const categoryScores = {};
  Object.keys(grouped).forEach(category => {
    const categoryItems = results.filter(r => r.category === category);
    const earnedWeight = categoryItems
      .filter(r => r.passed)
      .reduce((sum, r) => sum + r.weight, 0);
    const totalWeight = weights[category];
    categoryScores[category] = Math.round((earnedWeight / totalWeight) * 100);
  });

  // 총점 = 모든 카테고리 평균
  const categories = Object.keys(categoryScores);
  const totalScore = Math.round(
    categories.reduce((sum, cat) => sum + categoryScores[cat], 0) / categories.length
  );

  return {
    seo: categoryScores.seo || 0,
    aeo: categoryScores.aeo || 0,
    geo: categoryScores.geo || 0,
    total: totalScore
  };
}

/**
 * LLM에 개선 의견 요청 (Claude Haiku 고정 사용)
 *
 * 동작:
 * 1. 검사 결과에서 실패 항목만 추출
 * 2. JSON 스키마 프롬프트 구성 (점수, 실패 항목 정보 포함)
 * 3. OpenRouter API 호출 (anthropic/claude-haiku-4.5 강제)
 * 4. JSON 형식의 응답 반환
 *
 * 응답 형식:
 * {
 *   "improvements": [
 *     {"title": "...", "methods": [...], "codeExample": "...", "effects": [...]},
 *     ...
 *   ],
 *   "summary": "..."
 * }
 *
 * 모델 선택:
 * - GEO 검사: Claude Haiku (지시문 준수율 높음, 저렴)
 * - 번역: 사용자가 설정한 모델
 *
 * @param {AuditResult} auditResult - runAudit()의 검사 결과
 * @returns {Promise<Object>} LLM 응답 (JSON 객체, geo-ui.js의 formatImprovement로 HTML 변환됨)
 *
 * @example
 * // geo-ui.js에서 호출:
 * const auditResult = await runAudit();
 * const improvement = await getImprovement(auditResult);
 * console.log(improvement);
 * // "## 가장 중요한 3가지 개선사항
 * //  1. 제목 최적화 - 30-60자로 조정하세요
 * //  2. **메타 설명** 추가 - 155-160자 권장
 * //  ..."
 *
 * // HTML로 변환되어 UI에 표시됨:
 * const html = formatImprovement(improvement);
 * elements.improvementSection.innerHTML = html;
 */
export async function getImprovement(auditResult) {
  const apiKey = await getApiKey();
  const model = await getModel();

  if (!apiKey) {
    throw new Error('API Key가 설정되지 않았습니다');
  }

  // 실패한 항목만 정리
  const failedItems = auditResult.results
    .filter(r => !r.passed)
    .map(r => `- ${r.title}: ${r.hint}`)
    .join('\n');

  const prompt = `당신은 웹사이트 SEO/GEO 전문가입니다. 다음 검사 결과를 바탕으로 개선 의견을 제시해주세요.

## 검사 결과
총점: ${auditResult.scores.total}/100 (SEO: ${auditResult.scores.seo}, AEO: ${auditResult.scores.aeo}, GEO: ${auditResult.scores.geo})

## 개선 필요 항목
${failedItems}

## 요청
위 항목 중 **상위 3가지**를 선택하여 **마크다운 형식**으로 개선 의견을 작성해주세요.

### 응답 형식
각 개선 항목마다:
1. 항목명 (명확한 제목)
2. "왜 필요한가?" (배경 설명)
3. "어떻게 개선할까?" (실행 방법, 3-4개 단계)
4. "기대 효과" (개선 시 얻을 수 있는 결과, 2-3개)

예시:
## 1. 메타 설명 추가
**왜 필요한가?** 메타 설명은 검색 결과에 표시되는 미리보기 텍스트로, 사용자 클릭률을 크게 높입니다.
**어떻게 개선할까?**
- 150-160자 범위로 작성
- 주요 키워드 포함
- 행동 유도 문구 추가 (예: "지금 확인해보세요")
**기대 효과**
- CTR(클릭률) 15-20% 증가
- 검색 결과에서 완전한 설명 표시

## 2. ...

## 필수 규칙
- 마크다운 형식만 사용 (코드 예시 불필요)
- 정확히 3개 항목
- 한국어로 작성
- 실행 가능한 구체적인 방법 설명`;

  try {
    // GEO 검사는 OpenAI gpt-4o-mini로 사용 (JSON 응답 형식 안정적)
    // 번역 작업은 사용자가 선택한 모델 사용
    const geoModel = 'openai/gpt-4o-mini';

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: geoModel,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `API 오류: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;

    // 마크다운 응답을 그대로 반환
    return content.trim();
  } catch (error) {
    throw new Error(`LLM 의견 수집 실패: ${error.message}`);
  }
}

/**
 * 봇 vs 브라우저 Dual Audit 실행
 *
 * 동작:
 * 1. background.js를 통해 초기 HTML fetch (봇 시뮬레이션)
 * 2. DOMParser로 파싱하여 botDoc 생성
 * 3. runAudit(botDoc) - 봇이 보는 검사
 * 4. runAudit(document) - 브라우저가 보는 검사
 * 5. 두 결과 비교 및 반환
 *
 * @param {string} url - 검사할 페이지 URL (http/https만)
 * @returns {Promise<{botResult: AuditResult, clientResult: AuditResult, differences: Array}>}
 *
 * @example
 * // geo-tab.js에서 호출:
 * const dualResult = await runDualAudit('https://example.com');
 * console.log('봇 점수:', dualResult.botResult.scores.total);
 * console.log('브라우저 점수:', dualResult.clientResult.scores.total);
 * console.log('차이점:', dualResult.differences.length);
 */
export async function runDualAudit(url) {
  // 1. URL 검증
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    throw new Error('http/https URL만 지원합니다');
  }

  // 2. background.js를 통해 HTML fetch
  const response = await chrome.runtime.sendMessage({
    action: 'FETCH_HTML_FOR_BOT_AUDIT',
    url
  });

  if (!response.success) {
    throw new Error(response.error || 'HTML 가져오기 실패');
  }

  // 3. DOMParser로 파싱 (봇이 보는 HTML)
  const parser = new DOMParser();
  const botDoc = parser.parseFromString(response.html, 'text/html');

  // 4. 봇 검사 (서버 HTML)
  const botResult = await runAudit(botDoc);

  // 5. 브라우저 검사 (현재 탭의 document에서 실행)
  // Content Script에서 현재 HTML을 받아서 파싱
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;

  if (!tabId) {
    throw new Error('활성 탭을 찾을 수 없습니다');
  }

  // Content Script에서 현재 HTML 가져오기
  const clientResponse = await chrome.tabs.sendMessage(tabId, {
    action: 'GET_CURRENT_HTML'
  });

  if (!clientResponse || clientResponse.error) {
    throw new Error(clientResponse?.error || '브라우저 HTML 가져오기 실패');
  }

  // DOMParser로 파싱 (JavaScript 실행된 후의 HTML)
  const clientDoc = parser.parseFromString(clientResponse.html, 'text/html');
  const clientResult = await runAudit(clientDoc);

  // 5. 차이점 계산
  const differences = [];
  botResult.results.forEach((botItem, idx) => {
    const clientItem = clientResult.results[idx];
    if (botItem.passed !== clientItem.passed) {
      differences.push({
        id: botItem.id,
        title: botItem.title,
        category: botItem.category,
        botPassed: botItem.passed,
        clientPassed: clientItem.passed
      });
    }
  });

  return {
    botResult,
    clientResult,
    differences,
    url,
    timestamp: new Date().toISOString()
  };
}

/**
 * 검사 결과를 로깅 (디버그용)
 *
 * @param {AuditResult} auditResult - 검사 결과
 */
export function logAuditResult(auditResult) {
  console.group('🔍 GEO 검사 결과');
  console.log(`총점: ${auditResult.scores.total}/100`);
  console.log(`SEO: ${auditResult.scores.seo}/100, AEO: ${auditResult.scores.aeo}/100, GEO: ${auditResult.scores.geo}/100`);
  console.log(`통과: ${auditResult.passedCount}/${auditResult.results.length}`);

  console.group('실패 항목');
  auditResult.results
    .filter(r => !r.passed)
    .forEach(r => {
      console.log(`❌ ${r.title} (${r.category.toUpperCase()}): ${r.hint}`);
    });
  console.groupEnd();

  console.log('전체 결과:', auditResult.results);
  console.groupEnd();
}
