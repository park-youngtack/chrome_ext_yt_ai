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
 * @property {number} weight - 점수 가중치 (1-10)
 * @property {Function} selector - DOM 선택자 또는 검사 함수
 * @property {Function} validator - 검사 로직 (element/data → boolean)
 * @property {string} hint - 실패 시 개선 방법 힌트
 */

export const GEO_CHECKLIST = [
  // ===== SEO 체크리스트 =====
  {
    id: 'meta_description',
    category: 'seo',
    title: '메타 설명',
    description: '페이지 메타 설명 태그가 120-160자 범위인지 확인',
    weight: 8,
    selector: () => document.querySelector('meta[name="description"]'),
    validator: (elem) => {
      if (!elem) return false;
      const length = elem.getAttribute('content')?.length || 0;
      return length >= 120 && length <= 160;
    },
    hint: '메타 설명을 120-160자 범위로 작성하세요'
  },

  {
    id: 'h1_tag',
    category: 'seo',
    title: 'H1 태그',
    description: '페이지에 정확히 하나의 H1 태그가 있는지 확인',
    weight: 9,
    selector: () => document.querySelectorAll('h1'),
    validator: (elements) => elements.length === 1 && elements[0].textContent.trim().length > 0,
    hint: '페이지당 정확히 1개의 H1 태그를 사용하세요'
  },

  {
    id: 'title_tag',
    category: 'seo',
    title: '페이지 제목',
    description: '페이지 제목이 50-60자 범위인지 확인',
    weight: 9,
    selector: () => document.title,
    validator: (title) => title.length >= 50 && title.length <= 60,
    hint: '페이지 제목을 50-60자 범위로 설정하세요'
  },

  {
    id: 'structured_data',
    category: 'seo',
    title: '구조화된 데이터',
    description: 'JSON-LD 또는 Schema.org 마크업이 있는지 확인',
    weight: 7,
    selector: () => document.querySelector('script[type="application/ld+json"]'),
    validator: (elem) => elem !== null && elem.textContent.trim().length > 0,
    hint: 'Schema.org JSON-LD 구조화된 데이터를 추가하세요'
  },

  {
    id: 'alt_text',
    category: 'seo',
    title: 'Alt 텍스트',
    description: '80% 이상의 이미지에 alt 텍스트가 있는지 확인',
    weight: 6,
    selector: () => document.querySelectorAll('img'),
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
    selector: () => document.querySelector('meta[name="viewport"]'),
    validator: (elem) => elem !== null,
    hint: '모바일 반응형 디자인을 적용하세요'
  },

  // ===== AEO 체크리스트 =====
  {
    id: 'og_title',
    category: 'aeo',
    title: 'OG 제목',
    description: 'Open Graph og:title이 설정되어 있는지 확인',
    weight: 7,
    selector: () => document.querySelector('meta[property="og:title"]'),
    validator: (elem) => elem !== null && elem.getAttribute('content')?.trim().length > 0,
    hint: 'OG 메타 태그를 추가하여 소셜 미디어 공유를 최적화하세요'
  },

  {
    id: 'og_description',
    category: 'aeo',
    title: 'OG 설명',
    description: 'Open Graph og:description이 설정되어 있는지 확인',
    weight: 7,
    selector: () => document.querySelector('meta[property="og:description"]'),
    validator: (elem) => elem !== null && elem.getAttribute('content')?.trim().length > 0,
    hint: 'OG 설명을 추가하세요'
  },

  {
    id: 'og_image',
    category: 'aeo',
    title: 'OG 이미지',
    description: 'Open Graph og:image가 설정되어 있는지 확인',
    weight: 7,
    selector: () => document.querySelector('meta[property="og:image"]'),
    validator: (elem) => elem !== null && elem.getAttribute('content')?.trim().length > 0,
    hint: '고품질 og:image를 추가하세요 (1200x630px 권장)'
  },

  {
    id: 'twitter_card',
    category: 'aeo',
    title: 'Twitter Card',
    description: 'Twitter Card 메타 태그가 설정되어 있는지 확인',
    weight: 6,
    selector: () => document.querySelector('meta[name="twitter:card"]'),
    validator: (elem) => elem !== null && elem.getAttribute('content')?.trim().length > 0,
    hint: 'Twitter Card 메타 태그를 추가하세요'
  },

  {
    id: 'content_length',
    category: 'aeo',
    title: '콘텐츠 길이',
    description: '본문 콘텐츠가 500자 이상인지 확인',
    weight: 8,
    selector: () => document.body.innerText,
    validator: (text) => text.replace(/\s/g, '').length >= 500,
    hint: '최소 500자 이상의 상세한 콘텐츠를 작성하세요'
  },

  // ===== GEO 체크리스트 =====
  {
    id: 'faq_schema',
    category: 'geo',
    title: 'FAQ 스키마',
    description: 'FAQ Schema 마크업이 있는지 확인',
    weight: 9,
    selector: () => {
      const ld = document.querySelector('script[type="application/ld+json"]');
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
    description: '페이지 시작 부분에 150자 이상의 명확한 요약이 있는지 확인',
    weight: 8,
    selector: () => document.body.innerText.split('\n')[0],
    validator: (text) => text?.trim().length >= 150,
    hint: '페이지 시작에 명확한 요약 문장을 추가하세요 (AI 답변에 포함될 가능성 증가)'
  },

  {
    id: 'breadcrumb_schema',
    category: 'geo',
    title: '브레드크럼',
    description: 'Breadcrumb Schema가 있는지 확인',
    weight: 6,
    selector: () => {
      const ld = document.querySelector('script[type="application/ld+json"]');
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
    weight: 7,
    selector: () => document.querySelectorAll('[data-source], cite, .attribution'),
    validator: (elements) => elements.length > 0,
    hint: '이미지와 인용구에 출처를 명시하세요'
  },

  {
    id: 'author_info',
    category: 'geo',
    title: '저자 정보',
    description: '저자 정보 또는 byline이 있는지 확인',
    weight: 6,
    selector: () => document.querySelector('[rel="author"], .author, .by-line, [itemtype*="Person"]'),
    validator: (elem) => elem !== null,
    hint: '저자 정보를 추가하여 신뢰도를 높이세요'
  },

  {
    id: 'publish_date',
    category: 'geo',
    title: '발행일',
    description: '발행일 메타 태그 또는 스키마가 있는지 확인',
    weight: 7,
    selector: () => document.querySelector('meta[property="article:published_time"], [itemtype*="datePublished"]'),
    validator: (elem) => elem !== null,
    hint: '발행일을 메타 태그 또는 구조화된 데이터로 표시하세요'
  },

  {
    id: 'headings_structure',
    category: 'geo',
    title: '제목 구조',
    description: 'H1 → H2 → H3 순서로 계층적 제목이 있는지 확인',
    weight: 8,
    selector: () => {
      const h1 = document.querySelectorAll('h1, h2, h3, h4');
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
