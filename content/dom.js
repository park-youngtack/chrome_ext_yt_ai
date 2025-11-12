/**
 * Content DOM Module
 * - 텍스트 수집/DOM 적용/프리뷰 포착
 */
(function domModule(){
  try {
    window.WPT = window.WPT || {};
    const WPT = window.WPT;

    // 외부에서 주입되는 환경 참조
    let env = {
      getProgressStatus: null,
      originalTextsRef: null,
      translatedElementsRef: null,
      capturePreview: null,
      setCachedTranslation: null,
      progressPush: null,
      logDebug: null
    };

    function setEnv(newEnv){ env = Object.assign({}, env, newEnv || {}); }

    /**
     * 블록 요소 단위로 번역 대상 수집 (Semantic Chunking)
     * - HTML 태그로 쪼개진 텍스트를 논리적 단위로 병합
     * - 예: <p>The <strong>quick</strong> fox</p> → "The quick fox" (하나의 항목)
     * - 중복 방지: 리프 블록 요소만 수집 (자식에 블록이 없는 최하위 요소)
     */
    function getAllTextNodes(){
      const BLOCK_TAGS = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TD', 'TH', 'BUTTON', 'A', 'SPAN', 'DIV', 'LABEL', 'FIGCAPTION', 'CAPTION', 'SUMMARY', 'BLOCKQUOTE'];
      const EXCLUDE_TAGS = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG', 'CANVAS', 'CODE', 'PRE'];
      const elements = [];
      const processed = new WeakSet(); // 중복 방지

      /**
       * 자식 중에 블록 요소가 있는지 확인
       */
      function hasBlockChild(element) {
        for (const child of element.children) {
          if (BLOCK_TAGS.includes(child.tagName)) {
            return true;
          }
        }
        return false;
      }

      /**
       * 재귀적으로 리프 블록 요소 수집
       */
      function traverse(node) {
        // 제외 태그 체크
        if (EXCLUDE_TAGS.includes(node.tagName)) {
          return;
        }

        // 이미 처리된 요소는 스킵
        if (processed.has(node)) {
          return;
        }

        // 블록 요소이면서 자식에 블록이 없으면 (리프 블록)
        if (BLOCK_TAGS.includes(node.tagName) && !hasBlockChild(node)) {
          const text = (node.textContent || '').trim();
          // 텍스트가 있고 길이 제한 내에 있으면 수집
          if (text && text.length > 0 && text.length <= 2000) {
            elements.push(node);
            processed.add(node);
          }
          return; // 자식 탐색 중단 (리프 블록이므로)
        }

        // 자식 요소 탐색
        for (const child of node.children) {
          traverse(child);
        }
      }

      if (document.body) {
        traverse(document.body);
      }

      return elements;
    }

    /**
     * 블록 요소에서 textContent 추출
     * - 이제 textNodes가 아니라 block elements 배열
     * - 각 요소의 전체 textContent를 하나의 번역 단위로 처리
     */
    function extractTexts(blockElements){
      const texts = []; const elements = [];
      blockElements.forEach(element => {
        const text = (element.textContent || '').trim();
        if (text) {
          texts.push(text);
          elements.push(element);
        }
      });
      return { texts, elements };
    }

    /**
     * 번역 결과를 DOM에 적용 (블록 요소 단위)
     * - 블록 요소의 textContent를 번역 결과로 교체
     * - 내부 HTML 태그는 사라지지만 번역 품질이 크게 향상됨
     * - 예: <p>The <strong>quick</strong> fox</p> → <p>빠른 여우</p>
     */
    async function applyTranslationsToDom(batch, { useCache, batchIdx, model }){
      let applied = 0; let skipped = 0;
      const getStatus = env.getProgressStatus || (()=>({}));
      const originalTexts = env.originalTextsRef;
      const translatedElements = env.translatedElementsRef;

      await new Promise(resolve => {
        requestAnimationFrame(() => {
          batch.elements.forEach((element, idx) => {
            const translation = batch.translations[idx];
            if (translation && translation !== null){
              const originalText = batch.texts[idx];
              // 원본 저장 (복원용)
              if (originalTexts && !originalTexts.has(element)){
                originalTexts.set(element, element.textContent);
              }
              // 블록 요소 전체를 번역 결과로 교체
              element.textContent = translation;
              if (typeof env.capturePreview === 'function') env.capturePreview(translation);
              applied++;
              if (translatedElements) translatedElements.add(element);
              const status = getStatus();
              if (status && typeof status.translatedCount === 'number') status.translatedCount++;
              if (useCache && typeof env.setCachedTranslation === 'function'){
                env.setCachedTranslation(originalText, translation, model);
              }
            } else {
              skipped++;
            }
          });

          if (typeof env.logDebug === 'function'){
            env.logDebug('DOM_APPLY', '번역 DOM 적용 완료', { batchIdx, applied, skipped, mode: useCache ? 'fast':'fresh' });
          }
          if (typeof env.progressPush === 'function') env.progressPush();
          resolve();
        });
      });
    }

    WPT.Dom = { setEnv, getAllTextNodes, extractTexts, applyTranslationsToDom };
  } catch(_) { /* no-op */ }
})();

