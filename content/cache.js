/**
 * Content Cache Module
 * - IndexedDB 캐시 유틸리티
 */
(function cacheModule(){
  try {
    window.WPT = window.WPT || {};
    const WPT = window.WPT;

    const DB_NAME = 'TranslationCache';
    const DB_VERSION = 1;
    const STORE_NAME = 'translations';
    const DEFAULT_TTL_MINUTES = 525600;

    async function openDB(){
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if(!db.objectStoreNames.contains(STORE_NAME)){
            db.createObjectStore(STORE_NAME, { keyPath: 'hash' });
          }
        };
        request.onsuccess = (e)=> resolve(e.target.result);
        request.onerror = ()=> reject(request.error);
      });
    }

    async function sha1Hash(str){
      const encoder = new TextEncoder();
      const data = encoder.encode(str);
      const hashBuffer = await crypto.subtle.digest('SHA-1', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async function getTTL(){
      try{
        const result = await chrome.storage.local.get(['cacheTTL']);
        return (result.cacheTTL || DEFAULT_TTL_MINUTES) * 60 * 1000;
      }catch{
        return DEFAULT_TTL_MINUTES * 60 * 1000;
      }
    }

    async function setCachedTranslation(text, translation, model){
      try{
        const db = await openDB();
        const hash = await sha1Hash(text);
        const ts = Date.now();
        const tx = db.transaction([STORE_NAME], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        await store.put({ hash, translation, ts, model });
        await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = ()=>rej(tx.error); });
        db.close();
      }catch{}
    }

    async function getCachedTranslation(text){
      try{
        const db = await openDB();
        const hash = await sha1Hash(text);
        const ttl = await getTTL();
        const tx = db.transaction([STORE_NAME], 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const result = await new Promise((res, rej)=>{
          const req = store.get(hash);
          req.onsuccess = ()=> res(req.result);
          req.onerror = ()=> rej(req.error);
        });
        db.close();
        if(!result) return null;
        const now = Date.now();
        if(now - result.ts > ttl) return null;
        return result.translation;
      }catch{ return null; }
    }

    async function clearAllCache(){
      try{
        const db = await openDB();
        const tx = db.transaction([STORE_NAME], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        await new Promise((res, rej)=>{ const r = store.clear(); r.onsuccess = res; r.onerror = ()=>rej(r.error); });
        await new Promise((res, rej)=>{ tx.oncomplete = res; tx.onerror = ()=>rej(tx.error); });
        db.close();
        return true;
      }catch{ return false; }
    }

    async function clearPageCache(){ return await clearAllCache(); }

    async function getCacheStatus(){
      try{
        const db = await openDB();
        const tx = db.transaction([STORE_NAME], 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const result = await new Promise((res, rej)=>{
          const r = store.getAll();
          r.onsuccess = ()=>{
            const items = r.result; let totalSize = 0;
            items.forEach(item => totalSize += JSON.stringify(item).length);
            res({ success: true, count: items.length, size: totalSize });
          };
          r.onerror = ()=> rej(r.error);
        });
        db.close();
        return result;
      }catch(error){ return { success: false, count: 0, size: 0, error: error.message }; }
    }

    async function handleClearCacheForDomain(){
      try{
        const success = await clearPageCache();
        return success ? { success: true } : { success: false, error: '캐시 삭제 실패' };
      }catch(error){ return { success: false, error: error.message }; }
    }

    WPT.Cache = { openDB, getTTL, getCachedTranslation, setCachedTranslation, clearAllCache, clearPageCache, getCacheStatus, handleClearCacheForDomain };
  } catch(_) { /* no-op */ }
})();

