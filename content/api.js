/**
 * Content API Module
 * - OpenRouter API 호출과 재시도 유틸리티
 */
(function apiModule(){
  try {
    window.WPT = window.WPT || {};
    const WPT = window.WPT;

    const DEFAULTS = {
      MAX_ATTEMPTS: 3,
      BASE_DELAY_MS: 800,
      BACKOFF: 2
    };

    function wait(delayMs){ return new Promise(r=>setTimeout(r, delayMs)); }

    async function executeWithRetry(asyncTask, {
      maxAttempts = DEFAULTS.MAX_ATTEMPTS,
      baseDelayMs = DEFAULTS.BASE_DELAY_MS,
      backoffFactor = DEFAULTS.BACKOFF
    } = {}){
      let attempt = 0; let lastError = null;
      while(attempt < maxAttempts){
        attempt++;
        try{ return await asyncTask(attempt); }
        catch(error){
          lastError = error;
          const isNetworkError = error instanceof TypeError || (typeof error?.message === 'string' && error.message.includes('Failed to fetch'));
          const isExplicitRetryable = error?.retryable === true;
          const isExplicitNonRetryable = error?.retryable === false;
          const shouldRetry = attempt < maxAttempts && !isExplicitNonRetryable && (isExplicitRetryable || isNetworkError);
          if(!shouldRetry) throw error;
          const delayMs = baseDelayMs * Math.pow(backoffFactor, attempt - 1);
          await wait(delayMs);
        }
      }
      throw lastError;
    }

    async function requestOpenRouter(prompt, apiKey, model, meta = {}){
      const url = 'https://openrouter.ai/api/v1/chat/completions';
      const reqId = Math.random().toString(36).slice(2);
      const startTime = performance.now();
      let attempts = 0;

      try{
        const responseText = await executeWithRetry(async (attempt) => {
          attempts = attempt;
          const attemptStart = performance.now();
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': window.location.href,
              'X-Title': 'Web Page Translator'
            },
            body: JSON.stringify({
              model,
              messages: [{ role: 'user', content: prompt }]
            })
          });

          const attemptDurationMs = Math.round(performance.now() - attemptStart);
          if(!response.ok){
            const error = new Error(`API error: ${response.statusText}`);
            error.status = response.status;
            error.retryable = response.status >= 500 || response.status === 429;
            throw error;
          }
          const data = await response.json();
          return data.choices?.[0]?.message?.content || '';
        });

        return responseText;
      } finally {
        void attempts; void reqId; void startTime; void meta; // no-op to avoid eslint noise
      }
    }

    WPT.Api = { wait, executeWithRetry, requestOpenRouter };
  } catch(_) { /* no-op */ }
})();

