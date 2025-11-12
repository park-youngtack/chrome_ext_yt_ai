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
 * @property {Array<CheckResult>} results - 각 체크 항목별 결과
 * @property {Object} scores - { seo, aeo, geo, total }
 * @property {number} passedCount - 통과한 항목 수
 * @property {number} failedCount - 실패한 항목 수
 * @property {Array<string>} failedItems - 실패한 항목 ID 목록
 * @property {string} timestamp - 검사 실행 시간
 */

/**
 * @typedef {Object} CheckResult
 * @property {string} id - 체크 항목 ID
 * @property {string} title - 항목 제목
 * @property {boolean} passed - 통과 여부
 * @property {string} category - 'seo' | 'aeo' | 'geo'
 * @property {number} weight - 가중치
 */

/**
 * 페이지 자동 검사 실행
 * - 체크리스트의 모든 항목을 순회
 * - validator 함수 실행 → pass/fail 결정
 * - 조건문 없음, 단순 loop + 함수 호출
 *
 * @returns {Promise<AuditResult>} 검사 결과
 */
export async function runAudit() {
  const results = [];
  let passedCount = 0;
  let failedCount = 0;

  // 체크리스트 순회 (자동, if 없음)
  for (const checkItem of GEO_CHECKLIST) {
    try {
      // 1. selector 실행 → DOM 요소 또는 데이터 추출
      const selected = checkItem.selector();

      // 2. validator 실행 → pass/fail 결정
      const passed = checkItem.validator(selected);

      // 3. 결과 기록
      results.push({
        id: checkItem.id,
        title: checkItem.title,
        category: checkItem.category,
        weight: checkItem.weight,
        passed,
        hint: checkItem.hint
      });

      // 통계
      if (passed) passedCount++;
      else failedCount++;
    } catch (error) {
      // selector/validator 에러는 fail 처리
      results.push({
        id: checkItem.id,
        title: checkItem.title,
        category: checkItem.category,
        weight: checkItem.weight,
        passed: false,
        hint: checkItem.hint,
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
 * @param {Array<CheckResult>} results - 검사 결과
 * @returns {Object} { seo: number, aeo: number, geo: number, total: number }
 */
function calculateScores(results) {
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
 * LLM에 개선 의견 요청
 *
 * @param {AuditResult} auditResult - 검사 결과
 * @returns {Promise<string>} LLM의 개선 의견
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

  const prompt = `당신은 GEO (Generative Engine Optimization) 전문가입니다.

다음은 웹사이트의 검사 결과입니다:

**검사 결과 요약**
- 총점: ${auditResult.scores.total}/100
- SEO 점수: ${auditResult.scores.seo}/100
- AEO 점수: ${auditResult.scores.aeo}/100
- GEO 점수: ${auditResult.scores.geo}/100

**개선 필요 항목**
${failedItems}

위 결과를 분석하여, 다음을 제공해주세요:
1. 가장 중요한 3가지 개선 사항 (우선순위 순)
2. 각 항목별 구체적인 실행 방법
3. 예상되는 효과 (AI 응답 포함률 증가 등)

단, 한국어로 답변하고, 실용적이고 구체적인 조언을 제공하세요.`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model || 'openai/gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `API 오류: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    throw new Error(`LLM 의견 수집 실패: ${error.message}`);
  }
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
