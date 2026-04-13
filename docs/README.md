# TutorBridge

> **AI 튜터 기반 스마트 학습 & 질의응답 플랫폼**  
> KIT 바이브코딩 공모전 출품작 (2026)

---

## 🎯 프로젝트 개요

TutorBridge는 **비대면/온라인 학습 환경**에서 발생하는 두 가지 핵심 문제를 해결합니다:

- **학생 측**: 학습 흐름 단절 (질문에 대한 즉각적 피드백 부재)
- **교강사 측**: 중복 질문에 대한 업무 과부하 및 맥락 파악의 어려움

### 핵심 가치 제안

- **Focus-Mode 채팅**으로 학습 몰입도 극대화
- **Contextual Highlight Menu**로 즉각적인 꼬리 질문 및 에스컬레이션
- **Smart Escalation**으로 교강사의 파악 시간 최소화 (AI 자동 요약)

---

## 🏗️ 기술 스택

### Frontend (public/)
| 기술 | 용도 |
|------|------|
| **Tailwind CSS** | 스타일링 (CDN 기반) |
| **Alpine.js** | 상태관리/상호작용 |
| **DaisyUI** | UI 컴포넌트 |
| **Marked.js** | Markdown 렌더링 |
| **DOMPurify** | XSS 방어 |
| **Day.js** | 날짜 포맷 |

### Backend
| 기술 | 용도 |
|------|------|
| **Firebase Auth** | 사용자 인증 |
| **Firestore** | 실시간 NoSQL 데이터베이스 |
| **Firebase Storage** | 파일 저장 |
| **Firebase Functions** | 서버리스 함수 |
| **Cloudflare Workers** | AI API 프록시/은닉화 |

### AI/API
| 기술 | 용도 |
|------|------|
| **OpenAI GPT-4o** | 메인 AI 튜터 |
| **Claude 3 Haiku** | Fallback/요약 |

---

## 📁 프로젝트 구조

```
공모전 출품작/
├── public/                    # 프론트엔드 정적 파일
│   ├── index.html            # 랜딩 페이지
│   ├── login.html            # 로그인/회원가입
│   ├── dashboard.html        # 학생 대시보드 (PC)
│   ├── dashboard-mobile.html # 학생 대시보드 (모바일)
│   ├── classroom.html        # 강의실 (PC)
│   ├── chat.html             # AI 채팅
│   ├── admin.html            # 관리자 페이지
│   ├── instructor-mobile.html# 강사 대시보드
│   ├── community.html        # 커뮤니티
│   ├── css/                  # 스타일시트
│   └── js/                   # JavaScript 모듈
├── functions/                # Firebase Functions
│   └── index.js
├── docs/                     # 문서
│   ├── design/
│   │   ├── architecture-hld.md
│   │   ├── architecture-lld.md
│   │   └── screen-design.md
│   └── AI_REPORT_LOG.md
├── firebase.json             # Firebase 설정
├── firestore.rules           # Firestore 보안 규칙
└── storage.rules             # Storage 보안 규칙
```

---

## ✨ 주요 기능

### 1. Focus-Mode AI 채팅
- 실시간 AI 튜터와의 1:1 대화
- Streaming 응답으로 자연스러운 UX
- 대화 맥락 기억 및 개인화된 설명

### 2. Contextual Highlight Menu
- 텍스트 드래그 시 팝업 메뉴
- **추가 설명 요청**: 선택 텍스트에 대한 AI 설명
- **강사에게 질문**: 티켓 발행 및 에스컬레이션
- **오류 수정 제안**: 콘텐츠 피드백

### 3. Smart Escalation 티켓팅
- AI가 대화 맥락을 3줄 요약
- 강사 대시보드에서 실시간 확인
- 티켓 상태 관리 (open → in_progress → resolved)

### 4. 강의실 & 진행률 추적
- YouTube 강의: 시청 시간 자동 저장
- 텍스트 강의: Quill 에디터 + 체크포인트
- 파일 강의: 다운로드 확인
- **courseProgress/{courseId}_{userId}** 문서에 진행상황 저장

### 5. 반응형 UI
- PC/모바일 별 최적화된 인터페이스
- Alpine.js 기반 상태 관리

---

## 🚀 시작하기

### 사전 요구사항
- Firebase 프로젝트 (Spark/Blaze Plan)
- Cloudflare Workers 계정
- OpenAI API Key

### Firebase 설정

```bash
# Firebase CLI 설치
npm install -g firebase-tools

# 로그인
firebase login

# 프로젝트 초기화
firebase init
```

### Firebase 콘솔 설정

1. [Firebase Console](https://console.firebase.google.com) 접속
2. **Authentication** → 이메일/비밀번호 로그인 활성화
3. **Firestore Database** → 데이터베이스 생성
4. **Storage** → 스토리지 활성화

### 로컬 개발

```bash
# Firebase 에뮬레이터 시작
firebase emulators:start

# 또는 로컬 서버
npx serve public/
```

### 배포

```bash
# Firebase Hosting 배포
firebase deploy --only hosting

# Functions 배포
firebase deploy --only functions
```

---

## 🔒 보안

### Prompt Injection 방어
- DOMPurify로 XSS 필터링
- 시스템 프롬프트 구분자 필터링 (`###`, `<system>`)
- 입력 길이 제한 (max 4000 tokens)
- Rate Limiting (분당 30회)

### API Key 은닉화
- OpenAI API Key는 **Cloudflare Workers 환경 변수**로 관리
- 클라이언트에서 직접 API 호출 금지
- Worker를 통한 프록시만 허용

---

## 📝 Firestore 데이터 모델

### 주요 컬렉션

| 컬렉션 | 설명 |
|--------|------|
| `users` | 사용자 정보 (학생/강사/관리자) |
| `chat_logs` | AI 대화 기록 |
| `tickets` | 강사 에스컬레이션 티켓 |
| `ticket_replies` | 티켓 답변 |
| `courseRequests` | 강의 목록 |
| `courseEnrollments` | 수강 신청 및 진행률 |
| `courseProgress` | 상세 진행 데이터 |
| `posts` | 커뮤니티 게시글 |
| `announcements` | 공지사항 |
| `feedbacks` | 오류 수정 제안 |

---

## 👥 팀원

| 이름 | 역할 |
|------|------|
| Joo Han-tae | 개발 |
| Kim Min-gi | 개발 |
| Son Jun-hyuk | 개발 |

---

## 📄 라이선스

© 2026 TutorBridge. All Rights Reserved.

---

## 🔗 문서

- [High-Level Architecture](./design/architecture-hld.md)
- [Low-Level Design](./design/architecture-lld.md)
- [Screen Design](./design/screen-design.md)
- [AI 개발 로그](./AI_REPORT_LOG.md)
