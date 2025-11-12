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
 * @param {Array<CheckResult>} results - 검사 결과 (runAudit()의 출력)
 * @returns {Object} { seo: number, aeo: number, geo: number, total: number }
 *
 * @example
 * // runAudit()에서 받은 results 사용:
 * const auditResult = await runAudit();
 * const scores = calculateScores(auditResult.results);
 * console.log(scores); // { seo: 85, aeo: 90, geo: 78, total: 84 }
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
 * 동작:
 * 1. 검사 결과에서 실패 항목만 추출
 * 2. 프롬프트 구성 (점수, 실패 항목 정보 포함)
 * 3. OpenRouter API 호출 (설정된 모델 사용)
 * 4. 마크다운 형식의 응답 반환
 *
 * 응답 형식:
 * - ## 제목 형식의 섹션
 * - 1. 항목 형식의 번호 목록
 * - **굵은 텍스트**로 강조
 *
 * @param {AuditResult} auditResult - runAudit()의 검사 결과
 * @returns {Promise<string>} LLM 응답 (마크다운 형식, geo-ui.js의 formatImprovement로 HTML 변환됨)
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

  const prompt = `당신은 GEO (Generative Engine Optimization) 전문가입니다.

다음은 웹사이트의 검사 결과입니다:

**검사 결과 요약**
- 총점: ${auditResult.scores.total}/100
- SEO 점수: ${auditResult.scores.seo}/100
- AEO 점수: ${auditResult.scores.aeo}/100
- GEO 점수: ${auditResult.scores.geo}/100

**개선 필요 항목**
${failedItems}

위 결과를 분석하여, 다음과 같은 마크다운 형식으로 정확히 답변해주세요:

## 가장 중요한 3가지 개선 사항

### 1. [첫 번째 항목 제목]
**구체적인 실행 방법:**
- [구체적인 방법 1]
- [구체적인 방법 2]
- [구체적인 방법 3]

**실제 코드 예시:**
\`&lt;meta name="description" content="여기에 155-160자의 설명을 넣으세요"&gt;\`

또는 (JSON-LD의 경우):
\`{"@context": "https://schema.org", "@type": "Article", "headline": "제목", "description": "설명"}\`

**예상 효과:**
- [기대 효과 1]
- [기대 효과 2]

### 2. [두 번째 항목 제목]
**구체적인 실행 방법:**
- [방법 1]
- [방법 2]
- [방법 3]

**실제 코드 예시:**
\`[여기에 실제 HTML 또는 JSON-LD 코드를 구체적으로 작성하세요]\`

**예상 효과:**
- [효과 1]
- [효과 2]

### 3. [세 번째 항목 제목]
**구체적인 실행 방법:**
- [방법 1]
- [방법 2]
- [방법 3]

**실제 코드 예시:**
\`[여기에 실제 HTML 또는 JSON-LD 코드를 구체적으로 작성하세요]\`

**예상 효과:**
- [효과 1]
- [효과 2]

## 종합 기대 효과

[최종 기대 효과 설명 - 3-4문장으로 요약]

**주의 사항:**
1. 한국어로만 답변하세요
2. "구체적인 실행 방법:", "예상 효과:" 등 소제목 뒤에 **반드시 콜론(:)을 붙이세요**
3. 각 항목마다 "### 번호. 제목" 형식을 사용하세요
4. **"실제 코드 예시:" 섹션은 반드시 포함하세요** (이 섹션이 없으면 안 됨!)
   - 각 개선 항목마다 구체적인 HTML 또는 JSON-LD 코드를 작성해야 함
   - 단순 설명만으로는 부족, 개발자가 복사-붙여넣기 할 수 있는 수준의 코드여야 함
5. **HTML 코드는 반드시 HTML 엔터티로 변환해서 백틱 안에 넣으세요:**
   - &lt; 는 < 를 의미
   - &gt; 는 > 를 의미
   - 예: \`&lt;meta name="description" content="..."&gt;\` (절대 \`<meta>\` 금지!)
   - 불완전한 예시는 안 됨 (예: \`&lt;meta&gt;\` 같은 건 안 됨, 구체적인 속성까지 포함)
6. JSON은 그대로 백틱으로 감싸세요: \`{"name": "value", "description": "..."}\`
7. 각 소제목 아래 "-" 불릿 목록으로 작성하세요
8. 실용적이고 구체적인 조언을 제공하세요`;

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
