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

    /**
     * OpenRouter API 스트리밍 요청
     * @param {string} prompt - 프롬프트
     * @param {string} apiKey - API 키
     * @param {string} model - 모델명
     * @param {Function} onChunk - 청크 수신 콜백 (text) => void
     * @param {Object} options - 추가 옵션
     * @returns {Promise<string>} 전체 응답 텍스트
     */
    async function requestOpenRouterStreaming(prompt, apiKey, model, onChunk, options = {}){
      const url = 'https://openrouter.ai/api/v1/chat/completions';
      const { temperature = 0.7, maxTokens = 2000 } = options;

      try {
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
            messages: [{ role: 'user', content: prompt }],
            stream: true,
            temperature,
            max_tokens: maxTokens
          })
        });

        if (!response.ok) {
          const error = new Error(`API error: ${response.statusText}`);
          error.status = response.status;
          throw error;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // 마지막 불완전한 줄은 버퍼에 보관

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === 'data: [DONE]') continue;
            if (!trimmed.startsWith('data: ')) continue;

            try {
              const jsonStr = trimmed.slice(6); // 'data: ' 제거
              const data = JSON.parse(jsonStr);
              const content = data.choices?.[0]?.delta?.content;

              if (content) {
                fullText += content;
                if (onChunk) {
                  onChunk(content);
                }
              }
            } catch (parseError) {
              // JSON 파싱 에러 무시 (불완전한 청크)
            }
          }
        }

        return fullText;
      } catch (error) {
        throw new Error(`스트리밍 실패: ${error.message}`);
      }
    }

    WPT.Api = { wait, executeWithRetry, requestOpenRouter, requestOpenRouterStreaming };
  } catch(_) { /* no-op */ }
})();

