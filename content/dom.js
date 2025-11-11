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

    function getAllTextNodes(){
      const EXCLUDE_TAGS = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG', 'CANVAS', 'CODE', 'PRE'];
      const nodes = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        { acceptNode: function(node){
            if (!node.parentElement) return NodeFilter.FILTER_REJECT;
            const tagName = node.parentElement.tagName;
            if (EXCLUDE_TAGS.includes(tagName)) return NodeFilter.FILTER_REJECT;
            let current = node.parentElement;
            while (current && current !== document.body){
              if (EXCLUDE_TAGS.includes(current.tagName)) return NodeFilter.FILTER_REJECT;
              current = current.parentElement;
            }
            const text = (node.textContent || '').trim();
            if (!text || text.length === 0) return NodeFilter.FILTER_REJECT;
            if (text.length > 2000) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );
      let currentNode;
      while (currentNode = walker.nextNode()) nodes.push(currentNode);
      return nodes;
    }

    function extractTexts(textNodes){
      const texts = []; const elements = [];
      textNodes.forEach(node => {
        const text = (node.textContent || '').trim();
        if (text) { texts.push(text); elements.push(node); }
      });
      return { texts, elements };
    }

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
              if (originalTexts && !originalTexts.has(element)){
                originalTexts.set(element, element.textContent);
              }
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

