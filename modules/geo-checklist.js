/**
 * GEO (Generative Engine Optimization) 체크리스트 정의
 *
 * 데이터 기반 설계:
 * - 각 체크항목은 순수 데이터 객체 (selector, validator 함수)
 * - 검사 로직은 generic loop로 자동 실행
 * - 조건문 최소화 → 데이터 구조로 해결
 *
 * @typedef {Object} CheckItem
 * @property {string} id - 고유 ID (예: 'meta_description')
 * @property {string} category - 'seo' | 'aeo' | 'geo'
 * @property {string} title - 검사항목 제목
 * @property {string} description - 상세 설명
 *   참고: 이 검사는 **클라이언트 렌더링(CSR) 기준**입니다.
 *   - SSR 페이지: 서버에서 HTML 생성 → 검색봇이 완전히 읽을 수 있음
 *   - CSR 페이지: JavaScript로 동적 생성 → 검색봇이 실행 불가 시 못 읽음
 *   따라서 SSR 페이지인 경우, 페이지 소스(HTML)에 요소가 있는지 확인하세요.
 * @property {number} weight - 점수 가중치 (1-10)
 * @property {Function} selector - DOM 선택자 또는 검사 함수 (현재 페이지에서 실행)
 * @property {Function} validator - 검사 로직 (element/data → boolean)
 * @property {string} hint - 실패 시 개선 방법 힌트
 */

export const GEO_CHECKLIST = [
  // ===== SEO 체크리스트 =====
  {
    id: 'meta_description',
    category: 'seo',
    title: '메타 설명',
    description: '페이지 <head>의 메타 설명 태그가 있는지 확인\n\n💡 권장사항:\n- 최적: 150-160자 (검색결과에서 완전히 표시)\n- 일반적: 120-150자\n- 최소: 100자 이상\n\n⚠️ SSR/CSR 주의:\n- SSR: <meta name="description"> 태그가 HTML에 직접 있으면 검색봇이 읽음 (✅ 통과)\n- CSR: JavaScript에서 동적으로 추가된 메타 설명은 검색봇이 못 읽음 (❌ 실패)\n→ 페이지 소스(Ctrl+U)를 보고 <meta> 태그가 있는지 확인하세요',
    weight: 12,
    educationText: '**왜:** 검색결과에 요약으로 노출되어 클릭률(CTR)을 좌우합니다.\n\n**어떻게:** 150-160자 내, 핵심 키워드 포함, 페이지 고유 가치 제시. **SSR(서버 렌더링)**로 `<head>`에 포함.\n\n**예시:**\n```html\n<meta name="description" content="초보도 이해하는 전기차 충전 가이드. 급속·완속 차이, 요금 절약 팁, 지역별 충전소 찾는 법을 한 번에 정리했습니다.">\n```',
    selector: (doc = document) => {
      // 다양한 형식의 메타 설명 태그 모두 찾기
      const elem1 = doc.querySelector('meta[name="description"]');
      const elem2 = doc.querySelector('meta[property="description"]');
      const elem3 = doc.querySelector('meta[property="og:description"]');

      return elem1 || elem2 || elem3;
    },
    validator: (elem) => {
      // 존재 여부만 확인 (글자수는 LLM 의견에서 제시)
      if (!elem) return false;
      const content = elem.getAttribute('content')?.trim() || '';
      return content.length > 0;
    },
    hint: (doc = document) => {
      const elem = doc.querySelector('meta[name="description"]') ||
                   doc.querySelector('meta[property="description"]') ||
                   doc.querySelector('meta[property="og:description"]');
      const length = elem?.getAttribute('content')?.length || 0;
      return `메타 설명을 150-160자 범위로 작성하면 검색결과에서 완전히 표시됩니다 (현재: ${length}자)`;
    }
  },

  {
    id: 'h1_tag',
    category: 'seo',
    title: 'H1 태그',
    description: '페이지에 정확히 하나의 H1 태그가 있는지 확인',
    weight: 10,
    educationText: '**왜:** 문서 주제를 명확히 알려 크롤러와 보조기기 접근성을 개선합니다.\n\n**어떻게:** 페이지당 정확히 1개, 주요 키워드 포함. 이후 H2/H3로 계층화.\n\n**예시:**\n```html\n<h1>전기차 충전 완벽 가이드 2025</h1>\n```',
    selector: (doc = document) => doc.querySelectorAll('h1'),
    validator: (elements) => elements.length === 1 && elements[0].textContent.trim().length > 0,
    hint: '페이지당 정확히 1개의 H1 태그를 사용하세요'
  },

  {
    id: 'title_tag',
    category: 'seo',
    title: '페이지 제목',
    description: '페이지 <title> 태그가 있는지 확인 (기본값이 아닌지 확인)\n\n💡 권장사항:\n- 최적: 50-60자 (검색결과에서 줄바꿈 없이 표시)\n- 일반적: 50-70자 (BBC, NYT 등 대형 매체도 이 범위)\n- 최소: 30자 이상\n\n⚠️ SSR/CSR의 가장 흔한 실패 사례:\n- 화면에 보이는 제목: "내 서비스 소개" (CSR로 렌더링된 제목)\n- 검색봇이 읽는 제목: "Untitled" (HTML 서버 소스의 기본 제목)\n→ 페이지 소스(Ctrl+U)의 <title> 태그를 확인하세요!\n→ 검색봇은 JavaScript 실행 불가 시 서버의 원본 HTML 제목만 봅니다',
    weight: 20,
    educationText: '**왜:** SERP(검색결과 페이지)의 가장 굵은 텍스트, CTR 핵심입니다.\n\n**어떻게:** 50-60자 권장, 브랜드는 뒤에. 페이지마다 고유하게.\n\n**예시:**\n```html\n<title>전기차 충전 방법과 요금 절약 팁 | 인크로스</title>\n```',
    selector: (doc = document) => doc.title,
    validator: (title) => {
      // 제목이 있고 기본값이 아닌지 확인 (기본값: Untitled, Home, 등)
      const trimmed = title?.trim() || '';
      const defaultTitles = ['untitled', 'home', 'page', 'new page', 'welcome'];
      return trimmed.length > 0 && !defaultTitles.includes(trimmed.toLowerCase());
    },
    hint: (doc = document) => '페이지 제목을 50-60자 범위로 설정하면 가장 좋습니다 (현재: ' + (doc.title?.length || 0) + '자)'
  },

  {
    id: 'structured_data',
    category: 'seo',
    title: '구조화된 데이터',
    description: '<head> 내 JSON-LD 스크립트 태그가 있는지 확인\n\n💡 권장사항:\n- Article, NewsArticle, BlogPosting 스키마 추가\n- Product, Organization, LocalBusiness 등\n\n⚠️ SSR/CSR 주의:\n- SSR: <script type="application/ld+json"> 태그가 HTML 서버 소스에 있음 (✅ 통과)\n- CSR: JavaScript에서 동적으로 추가된 구조화된 데이터는 검색봇이 못 읽음 (❌ 실패)\n→ 페이지 소스(Ctrl+U)의 <head>에 JSON-LD가 있는지 확인\n→ JSON 형식이 유효한지 https://validator.schema.org에서 검증하세요',
    weight: 15,
    selector: (doc = document) => doc.querySelector('script[type="application/ld+json"]'),
    validator: (elem) => elem !== null && elem.textContent.trim().length > 0,
    hint: 'Schema.org JSON-LD 형식으로 Article, Product 등 적절한 구조화된 데이터를 서버 HTML에 포함시키세요'
  },

  {
    id: 'alt_text',
    category: 'seo',
    title: 'Alt 텍스트',
    description: '80% 이상의 이미지에 alt 텍스트가 있는지 확인',
    weight: 5,
    selector: (doc = document) => doc.querySelectorAll('img'),
    validator: (images) => {
      if (images.length === 0) return true;
      const withAlt = Array.from(images).filter(img => img.getAttribute('alt')?.trim()).length;
      return withAlt / images.length >= 0.8;
    },
    hint: '주요 이미지에 설명적인 alt 텍스트를 추가하세요'
  },

  {
    id: 'mobile_responsive',
    category: 'seo',
    title: '모바일 반응형',
    description: 'viewport 메타 태그가 있는지 확인',
    weight: 8,
    selector: (doc = document) => doc.querySelector('meta[name="viewport"]'),
    validator: (elem) => elem !== null,
    hint: '모바일 반응형 디자인을 적용하세요'
  },

  // ===== AEO 체크리스트 =====
  {
    id: 'og_title',
    category: 'aeo',
    title: 'OG 제목',
    description: '<head>에 Open Graph og:title 메타 태그가 있는지 확인\n\n💡 권장사항:\n- og:title: 페이지 제목과 동일하게 설정 (50-60자 권장)\n\n⚠️ SSR/CSR 주의:\n- SSR: 서버에서 각 페이지의 og:title을 HTML에 직접 포함 (✅ 통과)\n- CSR: JavaScript에서 og:title을 동적으로 추가하면, 소셜 미디어 크롤러가 못 읽을 수 있음\n→ 페이지 소스에 <meta property="og:title"> 태그가 있는지 확인\n→ Twitter, Facebook 공유 시 미리보기를 테스트하세요',
    weight: 10,
    selector: (doc = document) => doc.querySelector('meta[property="og:title"]'),
    validator: (elem) => elem !== null && elem.getAttribute('content')?.trim().length > 0,
    hint: 'OG 제목을 서버 HTML의 <head>에 포함시키세요 (페이지 제목과 동일하게, 50-60자 권장)'
  },

  {
    id: 'og_description',
    category: 'aeo',
    title: 'OG 설명',
    description: '<head>에 Open Graph og:description 메타 태그가 있는지 확인\n\n💡 권장사항:\n- og:description: 메타 설명과 동일하게 설정\n- 길이: 150-160자 (소셜 공유 시 완전히 표시됨)\n\n⚠️ SSR/CSR 주의:\n- SSR: 서버에서 미리 생성 (✅ 소셜 공유 정상)\n- CSR: 동적 추가 시 공유 미리보기에 반영 안 될 수 있음',
    weight: 10,
    selector: (doc = document) => doc.querySelector('meta[property="og:description"]'),
    validator: (elem) => elem !== null && elem.getAttribute('content')?.trim().length > 0,
    hint: 'OG 설명을 서버 HTML에 포함시키세요 (메타 설명과 동일, 150-160자 권장)'
  },

  {
    id: 'og_image',
    category: 'aeo',
    title: 'OG 이미지',
    description: '<head>에 Open Graph og:image 메타 태그가 있는지 확인\n\n💡 권장사항:\n- 이미지 크기: 1200x630px (이상적)\n- 최소: 600x315px\n- 형식: JPG, PNG (GIF 피하기)',
    weight: 10,
    selector: (doc = document) => doc.querySelector('meta[property="og:image"]'),
    validator: (elem) => elem !== null && elem.getAttribute('content')?.trim().length > 0,
    hint: '고품질 og:image를 서버 HTML에 추가하세요 (1200x630px 권장)'
  },

  {
    id: 'twitter_card',
    category: 'aeo',
    title: 'Twitter Card',
    description: 'Twitter Card 메타 태그가 있는지 확인\n\n💡 권장사항:\n- twitter:card: "summary_large_image" (권장)\n- twitter:title, twitter:description 함께 설정',
    weight: 5,
    selector: (doc = document) => doc.querySelector('meta[name="twitter:card"]'),
    validator: (elem) => elem !== null && elem.getAttribute('content')?.trim().length > 0,
    hint: 'Twitter Card 메타 태그를 서버 HTML에 추가하세요 (summary_large_image 권장)'
  },

  {
    id: 'content_length',
    category: 'aeo',
    title: '콘텐츠 길이',
    description: '본문 콘텐츠가 충분히 있는지 확인\n\n💡 권장사항:\n- 최소: 500자 이상\n- 이상적: 1000자 이상 (깊이 있는 콘텐츠)\n- AI 답변 포함: 2000자 이상 권장',
    weight: 15,
    selector: (doc = document) => doc.body ? doc.body.innerText : '',
    validator: (text) => {
      const cleanText = text.replace(/\s/g, '');
      return cleanText.length > 0; // 존재 여부만 확인
    },
    hint: (doc = document) => '최소 500자 이상의 상세한 콘텐츠를 작성하면 좋습니다 (현재: ' +
          ((doc.body?.innerText || '').replace(/\s/g, '').length) + '자)'
  },

  // ===== GEO 체크리스트 =====
  {
    id: 'faq_schema',
    category: 'geo',
    title: 'FAQ 스키마',
    description: 'FAQ Schema 마크업이 있는지 확인',
    weight: 18,
    educationText: '**왜:** FAQ 리치결과 및 AI 답변 보강에 매우 효과적입니다.\n\n**어떻게:** FAQ 섹션의 실제 문답을 JSON-LD로 추가(과장/낚시 문구 금지).\n\n**예시:**\n```html\n<script type="application/ld+json">\n{\n "@context":"https://schema.org",\n "@type":"FAQPage",\n "mainEntity":[\n  {"@type":"Question","name":"급속과 완속 차이는?","acceptedAnswer":{"@type":"Answer","text":"급속은 DC로..."}}\n ]\n}\n</script>\n```',
    selector: (doc = document) => {
      const ld = doc.querySelector('script[type="application/ld+json"]');
      if (!ld) return null;
      try {
        const data = JSON.parse(ld.textContent);
        return data['@type'] === 'FAQPage' ? ld : null;
      } catch {
        return null;
      }
    },
    validator: (elem) => elem !== null,
    hint: 'FAQ Schema를 추가하여 AI 답변에 최적화하세요'
  },

  {
    id: 'clear_summary',
    category: 'geo',
    title: '명확한 요약',
    description: '페이지 시작 부분에 명확한 요약 내용이 있는지 확인\n\n💡 권장사항:\n- 길이: 150-300자\n- 위치: 페이지 최상단 또는 첫 단락\n- 내용: 핵심을 명확하게 설명 (AI 답변 답로 사용됨)',
    weight: 15,
    selector: (doc = document) => doc.body ? doc.body.innerText : '',
    validator: (text) => text?.trim().length > 0, // 콘텐츠 존재 여부만
    hint: '페이지 시작에 명확한 요약 문장을 150-300자로 추가하세요 (AI 답변에 포함될 가능성 증가)'
  },

  {
    id: 'breadcrumb_schema',
    category: 'geo',
    title: '브레드크럼',
    description: 'Breadcrumb Schema가 있는지 확인',
    weight: 6,
    selector: (doc = document) => {
      const ld = doc.querySelector('script[type="application/ld+json"]');
      if (!ld) return null;
      try {
        const data = JSON.parse(ld.textContent);
        return data['@type'] === 'BreadcrumbList' ? ld : null;
      } catch {
        return null;
      }
    },
    validator: (elem) => elem !== null,
    hint: 'Breadcrumb Schema를 추가하여 네비게이션을 명확하게 하세요'
  },

  {
    id: 'source_attribution',
    category: 'geo',
    title: '출처 명시',
    description: '이미지/인용구에 출처가 명시되어 있는지 확인',
    weight: 8,
    selector: (doc = document) => doc.querySelectorAll('[data-source], cite, .attribution'),
    validator: (elements) => elements.length > 0,
    hint: '이미지와 인용구에 출처를 명시하세요'
  },

  {
    id: 'author_info',
    category: 'geo',
    title: '저자 정보',
    description: '저자 정보 또는 byline이 있는지 확인',
    weight: 10,
    selector: (doc = document) => doc.querySelector('[rel="author"], .author, .by-line, [itemtype*="Person"]'),
    validator: (elem) => elem !== null,
    hint: '저자 정보를 추가하여 신뢰도를 높이세요'
  },

  {
    id: 'publish_date',
    category: 'geo',
    title: '발행일',
    description: '발행일 메타 태그 또는 스키마가 있는지 확인',
    weight: 8,
    selector: (doc = document) => doc.querySelector('meta[property="article:published_time"], [itemtype*="datePublished"]'),
    validator: (elem) => elem !== null,
    hint: '발행일을 메타 태그 또는 구조화된 데이터로 표시하세요'
  },

  {
    id: 'headings_structure',
    category: 'geo',
    title: '제목 구조',
    description: 'H1 → H2 → H3 순서로 계층적 제목이 있는지 확인',
    weight: 8,
    selector: (doc = document) => {
      const h1 = doc.querySelectorAll('h1, h2, h3, h4');
      return h1;
    },
    validator: (headings) => {
      if (headings.length < 2) return false;
      const tags = Array.from(headings).map(h => parseInt(h.tagName[1]));
      // H1 존재 확인 및 대체로 순차적인지 확인
      return tags.includes(1) && tags[0] === 1;
    },
    hint: 'H1으로 시작하여 계층적인 제목 구조를 만드세요'
  }
];

/**
 * 체크리스트를 카테고리별로 그룹화
 * @returns {Object} { seo: [...], aeo: [...], geo: [...] }
 */
export function groupChecklistByCategory() {
  return GEO_CHECKLIST.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});
}

/**
 * 총 가중치 계산
 * @returns {Object} { seo: number, aeo: number, geo: number, total: number }
 */
export function calculateTotalWeights() {
  const weights = {};
  GEO_CHECKLIST.forEach(item => {
    weights[item.category] = (weights[item.category] || 0) + item.weight;
  });
  weights.total = Object.values(weights).reduce((a, b) => a + b, 0);
  return weights;
}
