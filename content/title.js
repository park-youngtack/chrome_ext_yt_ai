/**
 * Content Title Module
 * - 제목 번역/적용 및 진행 갱신
 */
(function titleModule(){
  try {
    window.WPT = window.WPT || {};
    const WPT = window.WPT;

    function applyTranslatedTitleToDocument(titleText, getProgressStatus){
      if (typeof titleText !== 'string') return;
      const normalized = titleText.trim();
      const status = typeof getProgressStatus === 'function' ? getProgressStatus() : null;
      if (status) status.translatedTitle = normalized;
      if (!normalized) return;
      if (document.title !== normalized) document.title = normalized;
      const titleElement = document.querySelector('title');
      if (titleElement && titleElement.textContent !== normalized){ titleElement.textContent = normalized; }
    }

    async function translateDocumentTitle(apiKey, model, useCache, originalTitle, getProgressStatus){
      try{
        const status = typeof getProgressStatus === 'function' ? getProgressStatus() : null;
        if (!originalTitle){ if (status){ status.originalTitle=''; status.translatedTitle=''; } return; }
        if (status){ status.originalTitle = originalTitle; status.translatedTitle = originalTitle; }

        if (useCache && WPT.Cache && WPT.Cache.getCachedTranslation){
          const cached = await WPT.Cache.getCachedTranslation(originalTitle);
          if (cached && cached.trim().length > 0){
            applyTranslatedTitleToDocument(cached.trim(), getProgressStatus);
            if (WPT.Progress && WPT.Progress.pushProgress) WPT.Progress.pushProgress();
            return;
          }
        }

        const arr = WPT.Api && WPT.Api.requestOpenRouter ? await WPT.Api.requestOpenRouter(`제목을 한국어로 번역: ${originalTitle}`, apiKey, model, { purpose:'title' }) : '';
        const translated = (Array.isArray(arr) ? arr[0] : arr) || '';
        const finalTitle = (typeof translated === 'string' && translated.trim().length>0) ? translated.trim() : originalTitle;
        applyTranslatedTitleToDocument(finalTitle, getProgressStatus);
        if (useCache && WPT.Cache && WPT.Cache.setCachedTranslation && finalTitle !== originalTitle){
          await WPT.Cache.setCachedTranslation(originalTitle, finalTitle, model);
        }
        if (WPT.Progress && WPT.Progress.pushProgress) WPT.Progress.pushProgress();
      }catch(error){
        const status = typeof getProgressStatus === 'function' ? getProgressStatus() : null;
        if (status) applyTranslatedTitleToDocument(status.originalTitle || document.title || '', getProgressStatus);
        if (WPT.Progress && WPT.Progress.pushProgress) WPT.Progress.pushProgress();
      }
    }

    WPT.Title = { translateDocumentTitle, applyTranslatedTitleToDocument };
  } catch(_) { /* no-op */ }
})();

