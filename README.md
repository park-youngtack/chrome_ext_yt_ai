# 웹페이지 번역기 - Chrome Extension

OpenRouter AI를 사용하여 웹페이지를 한글로 번역하는 크롬 확장프로그램입니다.

## 주요 기능

- 현재 화면에 보이는 텍스트를 한글로 번역
- 토글 기능: 번역 상태와 원본 상태를 쉽게 전환
- OpenRouter.ai API 활용 (다양한 AI 모델 선택 가능)
- API 키 로컬 저장으로 안전한 관리
- 수동 설치로 개인용 사용

## 사전 준비

1. **OpenRouter API Key 발급**
   - [OpenRouter](https://openrouter.ai/) 가입
   - [API Keys 페이지](https://openrouter.ai/keys)에서 API Key 발급
   - 크레딧 충전 필요

## 설치 방법

### 1. 저장소 클론 또는 다운로드

```bash
git clone <repository-url>
cd chrome_ext_yt_ai
```

### 2. Chrome에 확장프로그램 로드

1. Chrome 브라우저를 엽니다
2. 주소창에 `chrome://extensions/` 입력
3. 우측 상단의 **개발자 모드** 토글을 활성화
4. **압축해제된 확장 프로그램을 로드합니다** 버튼 클릭
5. 이 프로젝트 폴더 (`chrome_ext_yt_ai`) 선택

### 3. 확장프로그램 확인

- Chrome 우측 상단에 파란색 "한" 아이콘이 표시됩니다
- 아이콘이 안 보이면 퍼즐 아이콘을 클릭하여 확장프로그램 목록에서 핀으로 고정하세요

## 사용 방법

### 초기 설정

1. 확장프로그램 아이콘 (파란색 "한") 클릭
2. **OpenRouter API Key** 입력
3. 원하는 **AI 모델** 선택
   - **Claude 3 Haiku**: 빠르고 저렴 (권장 시작)
   - **Claude 3.5 Sonnet**: 고품질 번역 (권장)
   - **GPT-4o Mini**: 빠르고 저렴
   - **GPT-4o**: 최고 품질
   - **Gemini Flash 1.5**: 빠른 번역
   - **Gemini Pro 1.5**: 고품질
4. **설정 저장** 버튼 클릭

### 웹페이지 번역

1. 번역하고 싶은 웹페이지로 이동
2. 확장프로그램 아이콘 클릭
3. **이 페이지 번역하기** 버튼 클릭
4. 화면에 보이는 텍스트가 한글로 번역됩니다

### 원본으로 복원

1. 다시 확장프로그램 아이콘 클릭
2. **이 페이지 번역하기** 버튼을 다시 클릭
3. 원본 텍스트로 복원됩니다

## 파일 구조

```
chrome_ext_yt_ai/
├── manifest.json          # 확장프로그램 설정 파일
├── popup.html            # 설정 UI
├── popup.js              # 설정 로직
├── content.js            # 번역 기능 (웹페이지에 주입)
├── background.js         # 백그라운드 서비스 워커
├── icons/                # 확장프로그램 아이콘
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── create_icons.py       # 아이콘 생성 스크립트
└── README.md            # 이 파일
```

## 작동 원리

1. **content.js**가 웹페이지에 주입됩니다
2. 사용자가 번역 버튼을 클릭하면:
   - 화면에 보이는 모든 텍스트 노드를 수집
   - OpenRouter API를 호출하여 번역 요청
   - 원본 텍스트를 저장하고 번역된 텍스트로 교체
3. 다시 클릭하면 저장된 원본 텍스트로 복원

## 주의사항

- **API 비용**: OpenRouter 사용량에 따라 과금됩니다
- **배치 번역**: 한 번에 50개씩 텍스트를 나누어 번역합니다
- **레이트 리밋**: API 호출 간 1초 대기 시간이 있습니다
- **화면 영역만**: 현재 화면에 보이는 텍스트만 번역됩니다 (스크롤 영역 제외)

## 문제 해결

### 번역이 안 될 때

1. API Key가 올바르게 입력되었는지 확인
2. OpenRouter 계정에 크레딧이 있는지 확인
3. 개발자 도구 (F12) 콘솔에서 오류 메시지 확인
4. 확장프로그램을 비활성화 후 다시 활성화

### API 오류가 발생할 때

- `401 Unauthorized`: API Key가 잘못됨
- `402 Payment Required`: 크레딧 부족
- `429 Too Many Requests`: 너무 많은 요청, 잠시 대기 후 재시도

## 커스터마이징

### 아이콘 변경

`icons/` 폴더의 PNG 파일을 원하는 이미지로 교체하세요.
- icon16.png (16x16)
- icon48.png (48x48)
- icon128.png (128x128)

### 번역 대상 언어 변경

`content.js` 파일의 `translateWithOpenRouter` 함수에서 프롬프트를 수정하세요.

```javascript
const prompt = `다음 텍스트들을 영어로 번역해주세요...`; // 한국어 -> 영어로 변경
```

### 지원 모델 추가/변경

`popup.html` 파일에서 `<select id="model">` 섹션을 수정하세요.

## 개발 모드

코드를 수정한 후:
1. `chrome://extensions/` 페이지에서 확장프로그램 새로고침 버튼 클릭
2. 웹페이지도 새로고침하여 변경사항 반영

## 보안

- API Key는 Chrome의 `chrome.storage.local`에 저장됩니다
- 로컬 기기에만 저장되며 외부로 전송되지 않습니다
- HTTPS를 통해 OpenRouter API와만 통신합니다

## 라이선스

개인 사용을 위한 프로젝트입니다.

## 기여

버그 리포트나 기능 제안은 이슈로 등록해주세요.

## 지원

문제가 있거나 질문이 있으시면 이슈를 생성해주세요.
