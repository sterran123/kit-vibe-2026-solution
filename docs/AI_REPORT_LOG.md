# TutorBridge AI Report Log

> KIT 바이브코딩 공모전 - 실시간 AI 전략 및 토큰 절약 기법 기록

---

## 2026-04-11

**[2026-04-13 18:24 | classroom 유튜브/텍스트 강의 진행률 구현 | Partial Patch + 모듈 분리(classroom-progress.js) + 캐시버스팅 | 기존 completed 미연결 해결]**
- **전략**: `classroom.js`는 최소 변경, 진행률 로직은 `public/js/classroom-progress.js`로 분리해 `courseProgress` + `courseEnrollments.progress` 동기화, YouTube IFrame API pause/pagehide 저장 적용
- **산출물**: 영상 시청시간 서버 저장, 소감문 완료 기반 100% 처리, 텍스트 체크포인트 삽입/검증/수료 버튼, 파일 확인 완료 버튼, 우측 총 진행률 집계 반영

**[2026-04-13 19:12 | dashboard/classroom 진행률 리포트 확장 | Partial Patch + 단일 HTML 삽입 스크립트 + 캐시버스팅 | dashboard inline const redeclare 및 강사용 리포트 부재 해결]**
- **전략**: `courseEnrollments.progress/completedLessons/totalLessons`를 PC·모바일 dashboard 카드에 일원화하고, `courseProgress`를 강사용 classroom에서 구독해 학생별 강의 진행/체크포인트/소감문 리포트 카드 구성
- **검증**: `node --check --input-type=module`로 `classroom-progress.js`, `classroom.js`, `dashboard.js`, `dashboard-mobile.js` 구문 확인 완료

**[2026-04-11 22:30-23:30 | 커뮤니티 게시판 고급 기능 구현 | Partial Patch + Anti-Hallucination Search | 8+ 버그 해결]**
- **프롬프트 의도**: 게시판 공지사항 시스템, 스태프 권한 관리, 게시판 설정 기능 구현
- **AI 도구 전략**: 
  - `community.js` 변경된 함수만 부분 패치 (init, goToPost, initQuillEditor)
  - `admin-app.js` 스태프/게시판 설정 메서드 추가
  - `firebase-init.js` increment export 추가
- **토큰 절약 기법**:
  - 기존 working version 기반 수정 (롤백 후 수정)
  - HTML onmouseout → Alpine.js @mouseleave 마이그레이션
  - Firestore 쿼리 where('role', 'in', [...])로 단일 쿼리 최적화
- **해결된 에러/버그**:
  - `activeTopic is not defined` - Alpine.js 네이티브 이벤트 → 지시문 전환
  - `increment is not exported` - firebase-init.js에 Firestore increment 추가
  - Quill Editor 중복 초기화 버그 - DOM 완전 초기화 + ql-toolbar 제거
  - admin/staff 강사 목록 표시 누락 - 필터 조건에 role 체크 추가
  - 스태프 지정 시 admin 권한 손실 방지 로직 추가
- **산출물**: 
  - 공지사항 상단 고정 로직 (전체공지 + 게시판별 공지)
  - 강사 대시보드 AI 튜터 버튼 제거
  - 게시판 설정 UI (순서 변경, 추가/삭제)
  - favicon.svg 생성 및 적용
  - **Cache-Busting 전략**: `firebase-init.js?v=2` 로 브라우저 캐시 우회

---

## 로그 포맷
```
[Timestamp | 프롬프트 의도 | 적용된 AI 도구 전략 및 토큰 절약 기법 | 해결된 에러]
```

---

## 2026-04-06

**[2026-04-06 10:44 | Phase 1 - HLD 아키텍처 설계 | Partial Patch + Markdown 최적화 | N/A]**
- **전략**: Mermaid 다이어그램 표준 문법 준수, HTML 태그 미혼용
- **토큰 절약**: 시스템 다이어그램 1개로 Client→Worker→Firebase→AI 흐름 통합 표현
- **산출물**: `architecture-hld.md` (시스템 아키텍처, 기술 스택 선정 근거, ERD)

---

**[2026-04-06 10:47 | Phase 2 - LLD 상세 설계 | 단일 파일 완결성 + JSDoc 타입 힌트 | N/A]**
- **전략**: API 엔드포인트 8개 + Firestore 6개 컬렉션 상세 스키마를 단일 문서에 통합
- **토큰 절약**: 코드 예시는 핵심 로직(3줄 요약, Prompt Injection 방어)만 선별 포함
- **산출물**: `architecture-lld.md` (API 명세, DB 스키마, Worker 라우팅)

---

**[2026-04-06 10:47 | Phase 2 - 화면 설계 | CSS 변수 시스템 + 컴포넌트 스펙 | N/A]**
- **전략**: Tailwind CSS 커스텀 변수 체계화, 반응형 breakpoint 정의
- **토큰 절약**: ASCII Art 레이아웃 대신 실제 CSS 코드 스니펫으로 정확도 향상
- **핵심 UI**: Focus-Mode 채팅 + Contextual Highlight Menu + Off-canvas Sidebar
- **산출물**: `screen-design.md` (디자인 시스템, 레이아웃, 애니메이션)

---

**[2026-04-06 10:51 | Phase 3 - 구현 완료 | CDN 라이브러리 활용 + 모듈형 구조 | N/A]**
- **전략**: Tailwind CDN + Alpine.js CDN + Firebase ES Modules로 npm 의존성 제거
- **토큰 절약**: Component별 CSS/JS 분리로 중복 코드 최소화, Worker 라우트별 파일 분리
- **구현 완료**: 
  - `public/index.html` - Focus-Mode 채팅 UI (Contextual Highlight Menu 포함)
  - `public/login.html` - Firebase 인증 연동
  - `public/js/app.js` - Alpine.js 상태관리 + Firestore 실시간 동기화
  - `worker/src/` - Cloudflare Worker API 프록시 (OpenAI Streaming + 3줄 요약)
- **보안 구현**: Prompt Injection 패턴 20개 필터링, DOMPurify XSS 방어

---

**[2026-04-06 11:07 | OpenAI → Gemini API 전환 | Multi-provider 지원 구조 | N/A]**
- **전략**: Google Gemini 1.5 Flash로 AI 백엔드 전환 (무료 티어 15 RPM 지원)
- **변경 파일**: 
  - `worker/src/routes/chat.js` - SSE 스트리밍 방식 Gemini에 맞게 재구현
  - `worker/src/services/summarizer.js` - 3줄 요약 Gemini generateContent API 사용
  - `worker/src/routes/feedback.js` - 피드백 평가 Gemini로 전환
- **Gemini API 특성 반영**: 
  - `user`/`model` 역할 구조 (OpenAI의 system/user/assistant 대체)
  - NDJSON 스트리밍 응답 파싱
  - URL 파라미터 키 인증 방식

---

**[2026-04-06 11:43 | Phase 4 - Worker 배포 완료 | Cloudflare Workers + Gemini API 연동 | N/A]**
- **전략**: Wrangler CLI로 Cloudflare Workers 배포, Gemini API Secret 설정
- **배포 URL**: `https://tutorbridge-worker.the-unemployed-trio-kit.workers.dev`
- **설정 완료**: 
  - GEMINI_API_KEY Secret 등록
  - Firestore 콘솔 활성화 (asia-northeast3 서울 리전)
  - 프론트엔드 WORKER_BASE_URL 업데이트
- **CORS 허용 도메인**: Firebase Hosting 배포 후 추가 필요

---

| 항목 | 수치 |
|------|------|
| **완료 문서** | 3개 (HLD, LLD, Screen Design) |
| **생성 파일** | 20+개 (HTML/CSS/JS/Worker) |
| **설계된 API 엔드포인트** | 8개 |
| **Firestore 컬렉션** | 6개 |
| **Worker 라우트** | 4개 (chat, tickets, feedback, health) |
| **배포된 Worker** | `tutorbridge-worker.the-unemployed-trio-kit.workers.dev` |
| **핵심 UI 컴포넌트** | 5개 (Chat, Sidebar, Highlight, Dashboard, Login) |

---

## 적용된 핵심 전략 요약

1. **Partial Patch 방식**: 파일별 변경된 함수/클래스 단위만 수정, 전체 재작성 금지
2. **Mermaid 표준 문법**: VSCode 'Markdown Preview Enhanced' 호환성 확보
3. **public/ 분리 원칙**: HTML/CSS/JS 분리된 모듈형 아키텍처 준수
4. **AI API 은닉화**: Cloudflare Worker 경유 설계 반영
5. **Smart Escalation**: 티켓 발행 시 3줄 자동 요약으로 강사 시간 절약

---

**다음 단계**: Phase 4 안전망 - Firebase 콘솔 활성화 확인, Worker 배포, Prompt Injection 테스트

---

## 2026-04-11

**[2026-04-11 12:00 | CSS/JS 모듈화 리팩토링 (6개 HTML 파일) | Partial Patch + External File 분리 | N/A]**
- **전략**: inline `<style>` 및 `<script>` 태그를 외부 파일로 분리하여 코드 재사용성 및 유지보수성 향상
- **토큰 절약 기법**:
  - **부분 패치(Partial Patch)**: HTML에서 CSS/JS 추출 시 변경된 섹션만 분리, 전체 재작성 금지
  - **모듈형 구조**: 각 페이지별 `.css` + `.js` 파일 분리 (classroom.css → classroom.html 등)
  - **중복 제거 방지**: 공통 함수(validateDate, formatDate 등)는 utils/ 분리 보류 (기간 부족으로 리스크 관리)
  - **CDN 활용 유지**: Alpine.js, Tailwind CSS CDN 방식 유지하여 npm 의존성 없음
- **분리 완료 파일 목록**:
  | 파일 | CSS | JS | 상태 |
  |------|-----|-----|------|
  | `classroom.html` | `css/classroom.css` (369줄) | `js/classroom.js` (681줄) | 생성 |
  | `dashboard.html` | `css/dashboard.css` (179줄) | `js/dashboard.js` (756줄) | 생성 |
  | `login.html` | `css/login.css` (232줄) | `js/login.js` (710줄) | 생성 |
  | `instructor.html` | `css/instructor.css` (395줄) | `js/instructor-app.js` (기존) | CSS만 분리 |
  | `admin.html` | `css/admin.css` (95줄) | `js/admin-app.js` (기존) | CSS만 분리 |
  | `mypage.html` | `css/mypage.css` (235줄) | `js/mypage.js` (380줄) | 생성 |
- **총 생성**: 6개 CSS 파일 (1,505줄), 4개 JS 파일 (2,527줄)
- **아키텍처 준수**: `public/` 폴더 내 모듈형 분리 (KIT 바이브코딩 공모전 규칙 준수)
- **보안 유지**: API Key 노출 없음, Firebase init은 `firebase-init.js`에서 통합 관리

---

## 적용된 토큰 절약 기법 상세

| 기법 | 적용 위치 | 효과 |
|------|-----------|------|
| **Partial Patch** | 모든 HTML/CSS/JS 분리 작업 | 변경된 함수/클래스 단위만 수정, 불필요한 재탐색 금지 |
| **파일 분리 전략** | `public/css/`, `public/js/` | 유지보수성 향상 + 캐싱 효율 증가 |
| **CDN 유지** | Alpine.js, Tailwind, SweetAlert2 | npm install 시간/용량 절약 |
| **중복 코드 리스크 관리** | utils/ 분리 보류 | 배포 임박 시 버그 방지 (안정성 우선) |
| **단일 모듈 import** | `firebase-init.js` | Firebase SDK 중복 로드 방지 |
| 2026-04-13 20:14 KST | 학생 소감문 강사 조회 및 수강신청/승인 알림 직행 구현 | Partial Patch로 `classroom`/`dashboard`/`instructor-app` 중심 연결, 알림 딥링크와 식별자만 보강해 토큰 절약 | `handleNotification` 경로 누락, 승인 알림 비직행, 강사 소감문 미조회 해결 |
| 2026-04-13 21:18 KST | 커뮤니티 내 글 필터/권한별 바로가기 및 강사 모바일 강의개설 버튼 구현 | `community`/`instructor-mobile`만 핀포인트 수정하고 기존 `instructor.html` 신청 폼 구조와 딥링크를 재사용해 중복 구현 최소화 | 내 글 미구현, 게시판 바로가기 부재, 모바일 강의개설 진입 부재 해결 |

---
 
**다음 단계**: GitHub Public 레포지토리 푸시 → Firebase Hosting 배포 → 기능 테스트
