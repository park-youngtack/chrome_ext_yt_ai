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

  const prompt = `당신은 웹사이트 SEO 및 GEO(Generative Engine Optimization) 전문가입니다.
현재 사이트의 검사 결과를 바탕으로, 가장 중요한 3가지 개선 사항을 JSON 형식으로 제안해주세요.

## 검사 결과
- **총점**: ${auditResult.scores.total}/100
- **SEO**: ${auditResult.scores.seo}/100
- **AEO**: ${auditResult.scores.aeo}/100
- **GEO**: ${auditResult.scores.geo}/100

## 개선 필요 항목 (우선순위 순)
${failedItems}

## 요청사항
위 개선 필요 항목 중에서 **가장 영향력 있는 상위 3가지**를 선택하여 다음 JSON 형식으로 답변해주세요.
각 항목마다 구체적인 구현 방법과 실제 코드 예시, 기대 효과를 포함해주세요.

## JSON 응답 형식 (반드시 정확히 따르세요)
\`\`\`json
{
  "improvements": [
    {
      "title": "개선 항목 제목 (명확하고 구체적으로)",
      "methods": [
        "첫 번째 구현 방법 (실행 가능한 구체적 단계)",
        "두 번째 구현 방법",
        "세 번째 구현 방법",
        "네 번째 구현 방법 (선택 사항)"
      ],
      "codeExample": "&lt;meta name=&quot;description&quot; content=&quot;155-160자 범위의 구체적인 설명을 여기에 작성하세요. SEO 키워드를 포함하고 사용자 클릭을 유도하는 문구를 넣으세요.&quot;&gt;",
      "effects": [
        "기대 효과 1 (구체적인 수치 또는 결과 포함 권장)",
        "기대 효과 2",
        "기대 효과 3"
      ]
    },
    {
      "title": "두 번째 개선 항목",
      "methods": ["방법 1", "방법 2", "방법 3"],
      "codeExample": "&lt;meta property=&quot;og:title&quot; content=&quot;소셜 미디어용 제목&quot;&gt;",
      "effects": ["효과 1", "효과 2"]
    },
    {
      "title": "세 번째 개선 항목",
      "methods": ["방법 1", "방법 2", "방법 3"],
      "codeExample": "&lt;script type=&quot;application/ld+json&quot;&gt;{\n  &quot;@context&quot;: &quot;https://schema.org&quot;,\n  &quot;@type&quot;: &quot;Article&quot;,\n  &quot;headline&quot;: &quot;제목&quot;,\n  &quot;description&quot;: &quot;설명&quot;,\n  &quot;author&quot;: {\n    &quot;@type&quot;: &quot;Person&quot;,\n    &quot;name&quot;: &quot;저자명&quot;\n  }\n}&lt;/script&gt;",
      "effects": ["효과 1", "효과 2"]
    }
  ],
  "summary": "3가지 개선 사항을 함께 적용하면, 검색 엔진과 AI 생성형 검색 엔진(생성형 AI) 모두에서 사이트의 가시성이 크게 향상됩니다. 메타 정보와 구조화된 데이터는 검색봇과 AI가 콘텐츠를 정확하게 이해하도록 돕습니다."
}
\`\`\`

## 필수 지침
1. **JSON만 출력**: 마크다운, 설명, 추가 텍스트 절대 금지
2. **항목 정확히 3개**: improvements 배열은 반드시 3개 항목
3. **코드 예시 필수**: 각 항목의 codeExample은 비워두면 안 됨
4. **HTML 엔터티 변환 필수**:
   - \`<\` → \`&lt;\`
   - \`>\` → \`&gt;\`
   - \`"\` → \`&quot;\`
   - \`&\` → \`&amp;\`
5. **methods 배열**: 최소 3개 항목 (구체적이고 실행 가능한 단계)
6. **effects 배열**: 최소 2개 항목 (구체적인 결과)
7. **summary**: 3-4문장으로 3가지 개선 사항의 종합 효과 설명`;

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
        model: geoModel,  // GEO 검사는 무조건 Haiku 사용
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 2000,
        // JSON 응답 강제 (LLM이 반드시 유효한 JSON으로만 응답)
        response_format: {
          type: 'json_object'
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `API 오류: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;

    try {
      // 마크다운 코드블록 제거 (Anthropic 모델이 ```json으로 감싸서 보낼 수 있음)
      let jsonStr = content.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      const parsed = JSON.parse(jsonStr);

      // 유효한 JSON 구조 확인
      if (!parsed.improvements || !Array.isArray(parsed.improvements) || parsed.improvements.length !== 3) {
        throw new Error('잘못된 JSON 구조: improvements 배열이 3개여야 합니다');
      }

      // 각 항목이 필수 필드를 가지고 있는지 확인
      let hasEmptyCodeExample = false;
      parsed.improvements.forEach((item, idx) => {
        if (!item.title || !item.methods || !item.effects) {
          throw new Error(`항목 ${idx + 1}: title, methods, effects가 모두 필요합니다`);
        }

        // [DEBUG] 실제 codeExample 값 확인
        console.log(`[DETAIL] 항목 ${idx + 1}: "${item.title}"`);
        console.log(`[DETAIL]   codeExample 길이: ${item.codeExample ? item.codeExample.length : 0}`);
        console.log(`[DETAIL]   codeExample 값: "${item.codeExample}"`);
        console.log(`[DETAIL]   codeExample trim 길이: ${item.codeExample ? item.codeExample.trim().length : 0}`);

        // codeExample이 비어있거나 플레이스홀더만 있는 경우 체크 (경고만 함)
        if (!item.codeExample || item.codeExample.trim() === '' ||
            item.codeExample.includes('[여기에') || (item.codeExample.includes('...') && item.codeExample.length < 10)) {
          hasEmptyCodeExample = true;
          console.warn(`⚠️ 경고: 항목 ${idx + 1}의 codeExample이 구체적이지 않습니다`);
          // codeExample은 그대로 둠 (UI에서 판단)
        }
      });

      // codeExample이 비어있는 항목이 있으면 경고하지만 계속 진행
      if (hasEmptyCodeExample) {
        console.warn('⚠️ 일부 항목에 코드 예시가 없습니다. LLM이 규격을 제대로 따르지 않았을 수 있습니다.');
      }

      return parsed; // 구조화된 JSON 객체 반환
    } catch (parseError) {
      throw new Error(`LLM JSON 파싱 실패: ${parseError.message}`);
    }
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
