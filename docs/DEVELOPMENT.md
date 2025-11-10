# 개발 가이드 (DEVELOPMENT)

## 주요 작업 패턴

### 새 기능 추가 시

1. **메타 정보 업데이트**
   - `meta.js`의 `LAST_EDITED` 날짜 업데이트 (YYYY-MM-DD)

2. **기능별 파일 선택**
   - **번역 관련**: `content.js`에 추가
   - **UI 변경**: `sidepanel.html` + `sidepanel.js`에 추가
   - **백그라운드 작업**: `background.js`에 추가

3. **권한 필요 시**
   - `manifest.json` 업데이트 (permissions, content_scripts)

4. **상태 관리**
   - 상태가 필요하면 `translationState` 또는 `translationStateByTab`에 추가
   - 탭별 독립성 고려 (deep copy 필수)

5. **문서 업데이트**
   - 해당 기능의 docs 파일 업데이트
   - CLAUDE.md의 "기능별 문서" 링크 업데이트 (필요 시)

### 버그 수정 시

1. **문제 재현**
   - 명확한 재현 방법 문서화

2. **원인 분석**
   - 로그 확인 (개발자 도구)
   - 상태 추적 (Port, translationState)

3. **수정**
   - 최소한의 변경 (side effect 최소화)
   - 관련 상태 검증

4. **테스트**
   - 재현 시나리오에서 수정 확인
   - 관련 기능 회귀 테스트

## 디버깅 팁

### 콘솔 에러
- **목표**: 콘솔 에러 0건 유지
- **확인 방법**: F12 > Console 탭
- **흔한 원인**:
  - Port 연결 오류 (`port.onDisconnect`)
  - 권한 없음 (`checkPermissions` 필요)
  - 상태 초기화 실패 (Map 확인)

### Port 연결 상태
```javascript
// Port 디버깅
console.log('Port:', port);
port.onDisconnect.addListener(() => {
  console.warn('Port disconnected');
});
port.onMessage.addListener((msg) => {
  console.log('Message received:', msg.type);
});
```

### 권한 상태 확인
```javascript
// 현재 탭의 권한 상태
console.log('Permission:', permissionGranted);
console.log('Current URL:', await getCurrentTabUrl());
```

### 캐시 동작 확인
- **방법**: F12 > Application > IndexedDB > TranslationCache
- **확인사항**:
  - 저장된 항목 수
  - 해시값 형식
  - TTL 유효성

### 상태 추적
```javascript
// translationState 현재값
console.log('Translation State:', translationState);
console.log('By Tab:', translationStateByTab.get(currentTabId));
```

## 성능 프로파일링

### 번역 속도 측정
```javascript
const start = performance.now();
// 번역 로직...
const elapsed = performance.now() - start;
console.log(`번역 소요 시간: ${elapsed}ms`);
```

### 메모리 사용량
- F12 > Memory > Take snapshot
- 번역 전후 비교 (GC 후)

### 네트워크 요청
- F12 > Network > XHR 필터
- API 응답 시간, 페이로드 크기 확인

## 배포 체크리스트

배포 전 반드시 확인:
- [ ] LAST_EDITED 날짜 업데이트 (`meta.js`)
- [ ] README.md 업데이트 (주요 변경사항)
- [ ] 콘솔 에러 0건 확인
- [ ] 주요 기능 동작 확인
  - [ ] 번역 (캐시 포함)
  - [ ] 원본 보기
  - [ ] 설정 저장/로드
- [ ] 권한 없는 페이지 동작 확인
- [ ] 번역 중 탭 전환 테스트
- [ ] 여러 탭에서 동일 URL 테스트

## 릴리스 절차

1. **버전 업데이트**
   - `manifest.json` version
   - CLAUDE.md 버전 정보

2. **변경사항 문서화**
   - README.md에 "최근 업데이트" 추가
   - 날짜: YYYY-MM-DD 형식

3. **Git 커밋**
   - 의미있는 커밋 메시지
   - 이모지 활용 (🔄, 🐛, ✨ 등)

4. **태그 생성**
   ```bash
   git tag v2.2.0
   git push origin v2.2.0
   ```

5. **Chrome Web Store** (필요 시)
   - 새 버전 업로드
   - 스크린샷 업데이트
   - 설명 업데이트

## 트러블슈팅

### 번역이 시작되지 않음
1. API Key 확인
2. Content Script 주입 확인 (F12 > Sources)
3. 권한 확인 (checkPermissions)
4. Port 연결 확인

### UI가 업데이트되지 않음
1. updateUI() 호출 확인
2. translationState 상태 확인
3. Port 메시지 수신 확인
4. 렌더링 오류 확인 (F12 > Console)

### 캐시가 작동하지 않음
1. IndexedDB 저장소 확인
2. TTL 확인
3. 해시값 일치성 확인
4. 정규화 로직 확인

### 탭 전환 시 문제
1. currentTabId 업데이트 확인
2. translationStateByTab 저장 확인
3. 번역 중 여부 확인 (state === 'translating')
4. Port 상태 확인

## 로깅 가이드

### 적절한 로깅
```javascript
// ✅ 중요한 이벤트만 로깅
logInfo('sidepanel', 'TRANSLATE_START', '번역 시작', { tabId: currentTabId });
logInfo('sidepanel', 'TRANSLATE_COMPLETE', '번역 완료', {
  count: translationState.translatedCount
});
logError('sidepanel', 'API_ERROR', 'API 호출 실패', { code: error.code }, error);
```

### 과도한 로깅 피하기
```javascript
// ❌ 피할 것: 매 메시지마다 로그
port.onMessage.addListener((msg) => {
  console.log('Message:', msg); // 너무 자주 호출됨
});

// ✅ 대신: 중요한 메시지만
if (msg.type === 'progress' && msg.data.batchesDone % 5 === 0) {
  logDebug('sidepanel', 'PROGRESS', '진행 중', { done: msg.data.batchesDone });
}
```
