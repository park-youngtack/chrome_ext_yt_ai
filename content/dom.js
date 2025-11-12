/**
 * Content DOM Module
 * - 안전한 Semantic Chunking 구현
 * - 모든 텍스트 노드를 정확히 수집 → 블록별 그룹화 → 문맥 기반 번역
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
     * 안전한 텍스트 노드 수집 (TreeWalker 기반)
     * - 모든 텍스트 노드를 정확히 수집 (누락 없음)
     * - 빈 텍스트, 제외 태그 필터링
     * @returns {Array<Node>} 텍스트 노드 배열
     */
    function getAllTextNodes(){
      const EXCLUDE_TAGS = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG', 'CANVAS', 'CODE', 'PRE'];
      const nodes = [];

      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: function(node) {
            if (!node.parentElement) {
              return NodeFilter.FILTER_REJECT;
            }

            // 제외할 태그
            const tagName = node.parentElement.tagName;
            if (EXCLUDE_TAGS.includes(tagName)) {
              return NodeFilter.FILTER_REJECT;
            }

            // 상위 요소 확인
            let current = node.parentElement;
            while (current && current !== document.body) {
              if (EXCLUDE_TAGS.includes(current.tagName)) {
                return NodeFilter.FILTER_REJECT;
              }
              current = current.parentElement;
            }

            const text = (node.textContent || '').trim();
            if (!text || text.length === 0) {
              return NodeFilter.FILTER_REJECT;
            }

            // 최대 텍스트 길이 제한
            if (text.length > 2000) {
              return NodeFilter.FILTER_REJECT;
            }

            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );

      let currentNode;
      while (currentNode = walker.nextNode()) {
        nodes.push(currentNode);
      }

      return nodes;
    }

    /**
     * 부모 블록 요소 찾기
     * - 텍스트 노드가 속한 가장 가까운 블록 요소를 찾음
     * - 같은 블록에 속한 텍스트끼리 그룹화하기 위함
     * @param {Node} textNode - 텍스트 노드
     * @returns {Element} 부모 블록 요소
     */
    function findParentBlock(textNode) {
      const BLOCK_TAGS = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TD', 'TH', 'BUTTON', 'A', 'LABEL', 'FIGCAPTION', 'CAPTION', 'SUMMARY', 'BLOCKQUOTE', 'DIV', 'SPAN', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'NAV', 'ASIDE', 'MAIN'];

      let current = textNode.parentElement;
      while (current && current !== document.body) {
        if (BLOCK_TAGS.includes(current.tagName)) {
          return current;
        }
        current = current.parentElement;
      }

      // fallback: 직계 부모
      return textNode.parentElement || textNode;
    }

    /**
     * 텍스트 노드를 블록별로 그룹화 (Semantic Chunking)
     * - 같은 블록 내 텍스트는 문맥을 공유하므로 함께 번역
     * - 예: <p>The <strong>quick</strong> fox</p> → "The quick fox" (하나로 합침)
     * @param {Array<Node>} textNodes - 텍스트 노드 배열
     * @returns {Array<Object>} 그룹 배열 { block, nodes: [node1, node2, ...], texts: ["text1", "text2", ...] }
     */
    function groupByBlock(textNodes) {
      const blockMap = new Map(); // blockElement -> group
      const groups = [];

      textNodes.forEach(node => {
        const block = findParentBlock(node);

        if (!blockMap.has(block)) {
          const group = {
            block: block,
            nodes: [],
            texts: []
          };
          blockMap.set(block, group);
          groups.push(group);
        }

        const group = blockMap.get(block);
        group.nodes.push(node);
        group.texts.push(node.textContent.trim());
      });

      return groups;
    }

    /**
     * 그룹별로 텍스트 추출 (번역 API 호출용)
     * - 각 그룹의 텍스트를 공백으로 합쳐서 하나의 번역 단위로 만듦
     * @param {Array<Node>} textNodes - 텍스트 노드 배열
     * @returns {{texts: Array<string>, elements: Array<Object>}}
     *          texts: 그룹별 합친 텍스트 배열
     *          elements: 그룹 객체 배열 (DOM 적용 시 사용)
     */
    function extractTexts(textNodes){
      const groups = groupByBlock(textNodes);
      const texts = [];
      const elements = [];

      groups.forEach(group => {
        // 그룹 내 모든 텍스트를 공백으로 연결
        const combinedText = group.texts.join(' ');
        if (combinedText.trim()) {
          texts.push(combinedText);
          elements.push(group); // 그룹 전체를 저장
        }
      });

      return { texts, elements };
    }

    /**
     * 번역 결과를 DOM에 적용 (그룹 단위)
     * - 그룹의 첫 번째 텍스트 노드에 전체 번역 적용
     * - 나머지 노드는 빈 문자열로 설정 (중복 방지)
     * - 안전하고 예측 가능한 매핑 보장
     *
     * 예시:
     * <p>The <strong>quick</strong> fox</p>
     * nodes: ["The ", "quick", " fox"]
     * translation: "빠른 여우"
     * → node[0] = "빠른 여우", node[1] = "", node[2] = ""
     * 결과: <p>빠른 여우<strong></strong></p>
     */
    async function applyTranslationsToDom(batch, { useCache, batchIdx, model }){
      let applied = 0; let skipped = 0;
      const getStatus = env.getProgressStatus || (()=>({}));
      const originalTexts = env.originalTextsRef;
      const translatedElements = env.translatedElementsRef;

      await new Promise(resolve => {
        requestAnimationFrame(() => {
          batch.elements.forEach((group, idx) => {
            const translation = batch.translations[idx];
            if (translation && translation !== null){
              const originalText = batch.texts[idx];

              // 그룹 내 모든 노드 처리
              group.nodes.forEach((node, nodeIdx) => {
                // 원본 저장 (복원용)
                if (originalTexts && !originalTexts.has(node)){
                  originalTexts.set(node, node.textContent);
                }

                // 첫 번째 노드에만 전체 번역 적용, 나머지는 비움
                if (nodeIdx === 0) {
                  node.textContent = translation;
                } else {
                  node.textContent = '';
                }

                if (translatedElements) translatedElements.add(node);
              });

              if (typeof env.capturePreview === 'function') env.capturePreview(translation);
              applied++;

              const status = getStatus();
              if (status && typeof status.translatedCount === 'number') {
                status.translatedCount += group.nodes.length; // 모든 노드 카운트
              }

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

