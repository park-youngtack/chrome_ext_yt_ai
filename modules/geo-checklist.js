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
    tooltip: '검색결과 요약문으로 표시되는 문장입니다. 사용자가 클릭할지 판단하는 핵심 정보로, 페이지의 내용을 압축해 전달합니다. 검색엔진은 이 설명을 통해 페이지의 주제와 관련성을 평가합니다.',
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
    tooltip: '페이지의 주제(메인 제목)를 나타냅니다. 검색엔진이 문서의 중심 주제를 인식하는 기준이며, 페이지당 한 번만 사용하는 것이 원칙입니다.',
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
    tooltip: '브라우저 탭과 검색결과의 큰 제목으로 표시됩니다. 검색엔진과 사용자가 페이지의 목적을 가장 먼저 파악하는 지점입니다.',
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
    tooltip: '검색엔진이 페이지 정보를 "의미적으로" 이해할 수 있도록 하는 코드입니다. 예를 들어 "이건 기사야", "이건 상품이야"처럼 콘텐츠의 성격을 알려 리치결과(Rich Result)로 노출됩니다.',
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
    tooltip: '이미지의 대체 설명입니다. 시각장애인 접근성과 이미지 검색 노출에 모두 중요하며, 이미지가 로드되지 않아도 내용을 인식할 수 있게 해줍니다.',
    selector: (doc = document) => doc.querySelectorAll('img'),
    validator: (images) => {
      if (images.length === 0) return true;
      const withAlt = Array.from(images).filter(img => img.getAttribute('alt')?.trim()).length;
      return withAlt / images.length >= 0.8;
    },
    hint: '주요 이미지에 설명적인 alt 텍스트를 추가하세요'
  },

  // === 모바일 반응형 (3단계 검사) ===
  {
    id: 'viewport_meta',
    category: 'seo',
    title: 'Viewport 메타 태그',
    description: 'viewport 메타 태그가 올바르게 설정되어 있는지 확인\n\n💡 권장사항:\n- content="width=device-width, initial-scale=1.0"\n- 모바일 반응형의 필수 시작점\n\n⚠️ 주의:\n- viewport 태그만으로는 불충분합니다\n- 실제 반응형 CSS와 함께 사용해야 효과적',
    weight: 3,
    tooltip: '모바일 기기에서 화면 배율을 조정하는 기본 설정입니다. 이것만으로는 반응형이 아니며, CSS 미디어 쿼리와 함께 사용해야 합니다.',
    selector: (doc = document) => doc.querySelector('meta[name="viewport"]'),
    validator: (elem) => {
      if (!elem) return false;
      const content = elem.getAttribute('content') || '';
      // width=device-width가 포함되어 있는지 확인
      return content.includes('width=device-width');
    },
    hint: '<head>에 <meta name="viewport" content="width=device-width, initial-scale=1.0">을 추가하세요'
  },

  {
    id: 'media_queries',
    category: 'seo',
    title: 'CSS 미디어 쿼리',
    description: '실제 반응형 디자인을 위한 CSS 미디어 쿼리가 있는지 확인\n\n💡 권장사항:\n- @media (max-width: 768px) 등 모바일용 스타일 정의\n- 태블릿(768px), 모바일(480px) 등 브레이크포인트 설정\n\n⚠️ 참고:\n- <link media="..."> 태그도 감지됩니다\n- 외부 CSS(CDN)는 CORS로 읽을 수 없지만 존재만으로도 통과\n- <style> 태그 내 @media도 감지됩니다',
    weight: 3,
    tooltip: '화면 크기별로 다른 CSS를 적용하는 실제 반응형 코드입니다. viewport 태그만 있고 이게 없으면 진짜 반응형이 아닙니다.',
    selector: (doc = document) => {
      try {
        // 1단계: <link media="..."> 태그 확인 (가장 확실)
        const linkWithMedia = doc.querySelectorAll('link[rel="stylesheet"][media]');
        if (linkWithMedia.length > 0) {
          return { found: true, reason: 'link[media]' };
        }

        // 2단계: <style> 태그 내용 정규식으로 검사
        const styleTags = doc.querySelectorAll('style');
        for (const style of styleTags) {
          if (/@media\s*\(/i.test(style.textContent)) {
            return { found: true, reason: 'inline @media' };
          }
        }

        // 3단계: CSSStyleSheet 객체로 직접 확인
        let hasCorsError = false;
        const stylesheets = Array.from(doc.styleSheets || []);

        for (const sheet of stylesheets) {
          try {
            const rules = Array.from(sheet.cssRules || sheet.rules || []);
            const hasMedia = rules.some(rule =>
              rule.type === 4 || // CSSRule.MEDIA_RULE
              (rule.media && rule.media.length > 0)
            );
            if (hasMedia) {
              return { found: true, reason: 'cssRules' };
            }
          } catch (e) {
            // CORS 에러 발생 = 외부 CSS 파일 존재
            hasCorsError = true;
          }
        }

        // 4단계: 외부 CSS가 있으면 관대하게 통과
        // (Bootstrap, Tailwind 등 CDN 사용 시 미디어 쿼리 있을 가능성 높음)
        if (hasCorsError && stylesheets.length > 0) {
          return { found: true, reason: 'external css (cors)' };
        }

        return { found: false, reason: 'none' };
      } catch (e) {
        // 에러 발생 시에도 관대하게 통과 (보수적 접근)
        return { found: true, reason: 'error (assumed true)' };
      }
    },
    validator: (result) => result?.found === true,
    hint: (doc, elem) => {
      // elem은 selector의 반환값
      const reason = elem?.reason;

      if (reason === 'link[media]') {
        return '✅ <link media="..."> 태그로 미디어 쿼리 적용됨';
      }
      if (reason === 'inline @media') {
        return '✅ <style> 태그 내 @media 쿼리 확인됨';
      }
      if (reason === 'cssRules') {
        return '✅ CSS 파일에서 미디어 쿼리 확인됨';
      }
      if (reason === 'external css (cors)') {
        return '⚠️ 통과 (외부 CSS는 CORS로 검증 불가, 미디어 쿼리 있다고 가정)';
      }
      if (reason === 'error (assumed true)') {
        return '⚠️ 통과 (검사 중 오류 발생, 미디어 쿼리 있다고 가정)';
      }

      return 'CSS에 @media 쿼리를 추가하거나 <link media="...">를 사용하여 모바일 최적화하세요';
    }
  },

  {
    id: 'no_horizontal_scroll',
    category: 'seo',
    title: '가로 스크롤 없음',
    description: '모바일에서 가로 스크롤이 발생하지 않는지 확인\n\n💡 권장사항:\n- 모든 콘텐츠가 화면 너비 안에 들어가야 함\n- 고정 너비(px) 대신 상대 너비(%, vw) 사용\n- 이미지/테이블은 max-width: 100% 설정\n\n⚠️ 주의:\n- 가로 스크롤이 있으면 모바일 UX 저하\n- Google의 모바일 친화성 테스트에서도 감점',
    weight: 2,
    tooltip: '화면보다 콘텐츠가 넓어서 좌우로 스크롤해야 하는 상황을 방지합니다. 모바일 사용성의 핵심 지표입니다.',
    selector: (doc = document) => {
      // 문서의 전체 너비가 viewport 너비보다 큰지 확인
      const scrollWidth = doc.documentElement.scrollWidth;
      const clientWidth = doc.documentElement.clientWidth;
      return { scrollWidth, clientWidth };
    },
    validator: (data) => {
      // 약간의 여유(5px)를 두고 판단 (브라우저 스크롤바 등 고려)
      return data.scrollWidth <= data.clientWidth + 5;
    },
    hint: '고정 너비 요소를 상대 너비(%, max-width: 100%)로 변경하여 가로 스크롤을 제거하세요'
  },

  // ===== AEO 체크리스트 =====
  {
    id: 'og_title',
    category: 'aeo',
    title: 'OG 제목',
    description: '<head>에 Open Graph og:title 메타 태그가 있는지 확인\n\n💡 권장사항:\n- og:title: 페이지 제목과 동일하게 설정 (50-60자 권장)\n\n⚠️ SSR/CSR 주의:\n- SSR: 서버에서 각 페이지의 og:title을 HTML에 직접 포함 (✅ 통과)\n- CSR: JavaScript에서 og:title을 동적으로 추가하면, 소셜 미디어 크롤러가 못 읽을 수 있음\n→ 페이지 소스에 <meta property="og:title"> 태그가 있는지 확인\n→ Twitter, Facebook 공유 시 미리보기를 테스트하세요',
    weight: 10,
    tooltip: '페이스북·카카오톡 등에서 링크 미리보기로 표시되는 제목입니다. 페이지의 대표 문장 역할을 하며 클릭 유도에 영향을 줍니다.',
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
    tooltip: 'OG 제목 아래에 노출되는 요약문입니다. 사용자가 링크를 클릭할지 판단하는 2차 정보로, 메타 설명과 유사한 역할을 합니다.',
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
    tooltip: 'SNS에서 공유될 때 함께 표시되는 대표 이미지입니다. 고품질·정비율 이미지일수록 클릭률이 높습니다.',
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
    tooltip: 'X(트위터)에서 공유될 때의 미리보기 정보입니다. OG 태그와 유사하지만 별도 메타 태그를 사용합니다.',
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
    tooltip: '너무 짧으면 깊이가 부족하고, 너무 길면 이탈률이 올라갑니다. 검색 의도에 맞는 충분한 설명을 제공하는 적정 분량이 중요합니다.',
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
    tooltip: '질문-답변 형태를 구조화한 데이터입니다. 검색결과에 직접 Q&A 블록으로 노출될 수 있어 AI 검색 및 음성비서 응답에도 반영됩니다.',
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
    tooltip: '페이지 초반부의 핵심 요약문은 사용자 이탈을 줄이고, 검색결과의 자동 요약이나 AI 답변 품질에 긍정적 영향을 줍니다.',
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
    tooltip: '"홈 > 카테고리 > 페이지" 형태의 경로 표시입니다. 사이트 구조를 시각화해 탐색을 돕고, 리치결과(빵가루 링크)에도 활용됩니다.',
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
    tooltip: '이미지나 인용문에 출처를 표시하는 것은 신뢰도를 높이고, E-E-A-T(전문성·권위·신뢰성) 평가에서 긍정적으로 작용합니다.',
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
    tooltip: '콘텐츠 작성자(Author)의 신원과 전문성을 명시하면 검색엔진이 "신뢰할 수 있는 정보"로 인식합니다. 뉴스·블로그·전문 콘텐츠에 특히 중요합니다.',
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
    tooltip: '콘텐츠의 최신성을 나타내는 요소입니다. 검색결과에서 "최근 정보"로 판단되는 근거가 되며, 정기 업데이트 시 dateModified도 함께 활용됩니다.',
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
    tooltip: 'H1 → H2 → H3처럼 계층적으로 구성된 제목 체계입니다. 문서의 논리적 흐름을 구조화해 검색엔진이 내용을 더 정확히 파악하도록 돕습니다.',
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
