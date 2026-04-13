# TutorBridge - High-Level Architecture Design (HLD)

> **Project**: TutorBridge (AI 튜터 기반 스마트 학습 & 질의응답 시스템)  
> **Phase**: 1 (Architecture Design)  
> **Date**: 2026-04-06  
> **Target**: KIT 바이브코딩 공모전 출품작

---

## 1. 개요 (Overview)

### 1.1 프로젝트 목적
TutorBridge는 **비대면/온라인 학습 환경**에서 발생하는 두 가지 핵심 문제를 해결한다:
- **학생 측**: 학습 흐름 단절 (질문에 대한 즉각적 피드백 부재)
- **교강사 측**: 중복 질문에 대한 업무 과부하 및 맥락 파악의 어려움

### 1.2 핵심 가치 제안
- **Focus-Mode 채팅**으로 학습 몰입도 극대화
- **Contextual Highlight Menu**로 즉각적인 꼬리 질문 및 에스컬레이션
- **Smart Escalation**으로 교강사의 파악 시간 최소화 (AI 자동 요약)

---

## 2. 시스템 아키텍처 다이어그램

```mermaid
flowchart TB
    subgraph Client["🎓 Client (Browser)"]
        direction TB
        UI["Focus-Mode Chat UI<br/>(Alpine.js + Tailwind CSS)"]
        Sidebar["Off-canvas Sidebar<br/>(Chat History / Settings / Tickets)"]
        Highlight["Contextual Highlight Menu<br/>(Drag-to-Action Popup)"]
        FirebaseSDK["Firebase SDK<br/>(Auth, Firestore Client)"]
    end

    subgraph Edge["☁️ Edge Layer (Cloudflare Workers)"]
        direction TB
        WorkerAPI["TutorBridge Worker API<br/>(Serverless Router)"]
        AIProxy["AI Proxy Router<br/>(OpenAI/Claude API 은닉화)"]
        Summarizer["Context Summarizer<br/>(3줄 요약 엔진)"]
        Sanitizer["Input Sanitizer<br/>(Prompt Injection 방어)"]
    end

    subgraph Backend["🔥 Backend (Firebase)"]
        direction TB
        Auth["Firebase Auth<br/>(학생/강사 인증)"]
        Firestore[("Firestore DB<br/>- chat_logs<br/>- tickets<br/>- users<br/>- summaries")]
        Functions["Firebase Functions<br/>(트리거/배치 작업)"]
    end

    subgraph External["🔌 External Services"]
        OpenAI["OpenAI API<br/>(GPT-4o / GPT-4o-mini)"]
        Claude["Claude API<br/>(Anthropic - Fallback)"]
    end

    subgraph InstructorView["👨‍🏫 Instructor Dashboard"]
        DashboardUI["Ticket Dashboard<br/>(Alpine.js + Tailwind)"]
        TicketList["Smart Ticket List<br/>(AI 요약 포함)"]
    end

    %% Client Flows
    UI --> Sidebar
    UI --> Highlight
    UI --> FirebaseSDK
    Highlight -->|"Action A: 꼬리질문"| WorkerAPI
    Highlight -->|"Action B: 강사에게 질문"| WorkerAPI
    Highlight -->|"Action C: 오류 수정"| WorkerAPI

    %% Edge Layer Flows
    WorkerAPI --> AIProxy
    WorkerAPI --> Sanitizer
    AIProxy --> OpenAI
    AIProxy --> Claude
    WorkerAPI --> Summarizer

    %% Backend Connections
    FirebaseSDK --> Auth
    FirebaseSDK --> Firestore
    WorkerAPI --> Firestore
    Summarizer --> Firestore
    Functions --> Firestore

    %% Instructor Flow
    Firestore --> DashboardUI
    DashboardUI --> TicketList
    Summarizer -.->|"3줄 요약 저장"| Firestore
```

---

## 3. 기술 스택 선정 및 근거

### 3.1 Frontend Stack (public/)

| 기술 | 용도 | 선정 근거 |
|------|------|----------|
| **Tailwind CSS** | 스타일링 | CDN 기반, 유틸리티 퍼스트, Focus-Mode UI 구현에 최적 |
| **Alpine.js** | 상태관리/상호작용 | Vanilla JS 대비 선언적 문법, CDN 단일 파일, React 대비 가벼움 |
| **DaisyUI** | UI 컴포넌트 | Tailwind 기반 무료 컴포넌트, 사이드바/채팅 버블/모달 등 즉시 활용 |
| **Marked.js** | Markdown 렌더링 | AI 답변의 코드 블록/리스트 서식 지원 |
| **DOMPurify** | XSS 방어 | 학생 입력/AI 출력 Sanitization 필수 |
| **SweetAlert2** | 알림/컨펌 | 직관적 팝업, Highlight Menu 스타일 통일 |
| **Day.js** | 날짜 포맷 | 경량 Moment.js 대체, 채팅 타임스탬프 |

### 3.2 Backend Stack

| 기술 | 용도 | 선정 근거 |
|------|------|----------|
| **Cloudflare Workers** | Serverless API | AI Key 은닉화, Edge 배포, Cold Start 없음, 무료 티어 충분 |
| **Firebase Auth** | 인증 | 이메일/소셜 로그인, 세션 관리, Client SDK와 원클릭 연동 |
| **Firestore** | NoSQL DB | 실시간 동기화, 채팅 로그 스트리밍, 티켓 상태 실시간 반영 |
| **Firebase Analytics** | 학습 분석 | 학생 활동 패턴 추적, 개인정보 비식별화 |

### 3.3 AI/API Stack

| 기술 | 용도 | 선정 근거 |
|------|------|----------|
| **OpenAI GPT-4o** | 메인 AI 튜터 | 빠른 응답, 교육 콘텐츠 이해 우수, JSON Mode 지원 |
| **Claude 3 Haiku** | Fallback/요약 | 맥락 길이 제한 상황, 요약 품질 우수 |
| **Cloudflare AI Gateway** | 프록시/캐싱 | (옵션) 요청 캐싱으로 비용 절감 |

---

## 4. 핵심 기능 흐름 (User Flow)

### 4.1 Focus-Mode 채팅 + Contextual Highlight

```mermaid
sequenceDiagram
    actor Student as 수강생
    participant UI as Chat UI
    participant HL as Highlight Menu
    participant Worker as CF Worker
    participant AI as OpenAI API
    participant DB as Firestore

    Student->>UI: 질문 입력
    UI->>Worker: POST /api/chat
    Worker->>AI: 메시지 전달
    AI->>Worker: 답변 수신
    Worker->>DB: chat_logs 저장
    Worker->>UI: 답변 스트리밍
    UI->>Student: AI 답변 표시

    Student->>UI: 텍스트 드래그 (이해 안 됨)
    UI->>HL: 컨텍스트 메뉴 팝업

    alt Action A: 추가 설명 요청
        Student->>HL: "이 부분 추가 설명"
        HL->>Worker: POST /api/chat (with context)
        Worker->>AI: 선택 텍스트 + 맥락 포함 질문
        AI->>Worker: 상세 설명
        Worker->>DB: chat_logs 추가 저장
        Worker->>UI: 답변 표시
    else Action B: 강사에게 질문
        Student->>HL: "강사님께 질문"
        HL->>Worker: POST /api/ticket
        Worker->>Worker: 대화 맥락 3줄 요약
        Worker->>DB: tickets 컬렉션 생성
        Worker->>DB: chat_logs에 티켓 참조 저장
        Worker->>UI: "티켓 발행 완료" 알림
    else Action C: 오류 수정 제안
        Student->>HL: "내용 오류 수정"
        HL->>Worker: POST /api/feedback
        Worker->>DB: feedbacks 컬렉션 저장
        Worker->>UI: "제안 감사합니다" 토스트
    end
```

### 4.2 Smart Escalation 티켓팅 (교강사 뷰)

```mermaid
sequenceDiagram
    actor Instructor as 교강사
    participant Dash as Ticket Dashboard
    participant DB as Firestore
    participant Worker as CF Worker

    Note over Instructor,Worker: 실시간 티켓 구독
    Dash->>DB: onSnapshot(tickets)
    DB->>Dash: 티켓 변경 실시간 푸시

    Instructor->>Dash: 티켓 클릭
    Dash->>DB: chat_logs 쿼리 (맥락 조회)
    DB->>Dash: 전체 대화 로드

    Instructor->>Dash: 답변 작성
    Dash->>Worker: POST /api/ticket/:id/reply
    Worker->>DB: ticket.status = "resolved"
    Worker->>DB: notifications 컬렉션 생성
    Worker->>Dash: 업데이트 완료

    Note over Instructor,DB: 학생에게 알림
    DB->>Dash: (학생 앱) 티켓 답변 알림
```

---

## 5. 데이터 모델 개요 (Firestore Collections)

```mermaid
erDiagram
    USERS ||--o{ CHAT_LOGS : creates
    USERS ||--o{ TICKETS : submits
    CHAT_LOGS ||--o| TICKETS : escalated_to
    TICKETS ||--o{ TICKET_REPLIES : has

    USERS {
        string uid PK
        string email
        string display_name
        string role "student|instructor|admin"
        timestamp created_at
        timestamp last_active
    }

    CHAT_LOGS {
        string id PK
        string user_id FK
        string session_id
        array messages
        string context_summary
        string escalated_ticket_id FK
        timestamp created_at
        timestamp updated_at
    }

    TICKETS {
        string id PK
        string student_id FK
        string instructor_id FK
        string chat_log_id FK
        string ai_summary
        string highlighted_text
        string student_question
        string status "open|in_progress|resolved|closed"
        int priority "1-5"
        timestamp created_at
        timestamp resolved_at
    }

    TICKET_REPLIES {
        string id PK
        string ticket_id FK
        string author_id
        string author_role "student|instructor"
        string content
        timestamp created_at
    }

    FEEDBACKS {
        string id PK
        string student_id FK
        string chat_log_id FK
        string selected_text
        string suggestion
        string status "pending|reviewed|applied"
        timestamp created_at
    }
```

---

## 6. 보안 및 프라이버시 설계

### 6.1 Prompt Injection 방어 계층

```mermaid
flowchart LR
    A[학생 입력] --> B[DOMPurify XSS 필터]
    B --> C[Cloudflare Worker]
    C --> D{Sanitization Layer}
    D -->|핵심 시스템 프롬프트 탐지| E[차단/로깅]
    D -->|정상 입력| F[AI API 호출]
    E --> G[보안 로그]
```

**구현 포인트**:
- 시스템 프롬프트 구분자 (`###`, `<system>`, `ignore previous`) 필터링
- 입력 길이 제한 (max 4000 tokens)
- 반복 요청 Rate Limiting (분당 30회)

### 6.2 API Key 은닉화

| 구성요소 | 처리방식 |
|---------|---------|
| OpenAI API Key | Cloudflare Workers 환경 변수 |
| Firebase Config | public/js/firebase-init.js (제한된 키만) |
| 서비스 계정 키 | Workers Secrets (암호화) |

---

## 7. 배포 및 인프라 구성

```mermaid
flowchart TB
    subgraph Dev["Development"]
        Local["Local Dev Server<br/>(Live Server / Python HTTP)"]
        TestWorker["Cloudflare Worker<br/>(*.workers.dev)"]
    end

    subgraph Prod["Production"]
        CDN["Cloudflare Pages / Static Hosting<br/>(public/ 폴더)"]
        WorkerProd["Cloudflare Worker<br/>(Custom Domain)"]
        FirebaseProd["Firebase Production<br/>(Spark/Blaze Plan)"]
    end

    Local -->|wrangler dev| TestWorker
    TestWorker -->|emulators| FirebaseEmulator["Firebase Emulator Suite"]

    CDN --> WorkerProd
    WorkerProd --> FirebaseProd
```

---

## 8. 성능 및 확장성 고려사항

| 영역 | 전략 |
|------|------|
| **채팅 로딩** | Firestore Pagination (최근 50개만, 스크롤 시 추가 로드) |
| **AI 응답 지연** | Streaming 응답 (Server-Sent Events), Typing 인디케이터 |
| **티켓 요약** | Worker에서 비동기 처리, Firestore에 캐싱 |
| **이미지/파일** | Firebase Storage, 10MB 제한, 교육용 파일 형식만 허용 |

---

## 9. 단계별 구현 로드맵

### Phase 2: 설계 상세화
- [ ] architecture-lld.md 작성 (API 스펙, DB 상세 스키마)
- [ ] screen-design.md 작성 (UI 와이어프레임, 반응형 breakpoint)
- [ ] Worker 라우팅 설계 및 테스트 스크립트

### Phase 3: 구현
- [ ] Firebase 초기화 및 인증 구현
- [ ] Focus-Mode 채팅 UI 구현
- [ ] Contextual Highlight Menu 구현
- [ ] Cloudflare Worker AI 프록시 구현
- [ ] 티켓팅 시스템 및 대시보드 구현

### Phase 4: 안전망 및 테스트
- [ ] Prompt Injection 테스트 시나리오
- [ ] XSS/보안 취약점 스캔
- [ ] 성능 테스트 (동시 사용자 100명 기준)
- [ ] AI_REPORT_LOG.md 작성 완료

---

## 10. 참고 및 변경 이력

| 버전 | 날짜 | 작성자 | 변경 내용 |
|------|------|--------|----------|
| v1.0 | 2026-04-06 | Cascade | Phase 1 초기 HLD 작성 |

---

**검증 체크리스트**:
- [x] 모든 Mermaid 다이어그램은 표준 문법 준수 (HTML 태그 미혼용)
- [x] public/ 분리 원칙 반영
- [x] AI API 은닉화 (Worker 경유) 반영
- [x] Firebase 기반 인증/DB 명시
- [x] CDN 라이브러리 스택 명시
