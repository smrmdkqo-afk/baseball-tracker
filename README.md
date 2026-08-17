# Baseball Tracker Pro V5.2 — Date First

V5.2는 UI와 날짜 처리 방식을 정리한 버전입니다. DB 스키마는 V5와 동일합니다.

## 핵심 변경

- 하단 메뉴: **홈 / 입력 / 기록 / 분석 / 설정**
- 사용자에게 보이는 세션 이름과 세션 생성 UI 제거
- 입력 화면: **날짜 → 경기/훈련 → 투구/타격/주루/수비** 순서
- 경기 선택 시: 투구 / 타격 / 주루 / 수비
- 훈련 선택 시: 투구 / 타격 / 수비
- 홈은 실제 오늘 날짜의 활동만 표시
- 분석은 7일 / 30일 / 시즌 / 전체 기간 통계와 TLU 추세 표시
- 기록은 activityDate 기준으로 날짜별 상세 로그 제공
- 이벤트 수정 시 활동 날짜 자체를 이동 가능

## 날짜 처리

각 이벤트는 두 시간 개념을 분리합니다.

- `metadata.activityDate`: 실제 경기/훈련 날짜. **홈, 기록, 분석의 집계 기준**
- `occurredAt` / `metadata.recordedAt`: 앱에 실제 입력한 시각. 감사/로그용

예: 8/17에 8/15 경기 영상을 보며 입력하면 기록은 8/15에 추가되고 8/17 홈 수치는 변하지 않습니다. 8/15가 포함되는 분석 기간에는 소급 반영됩니다.

## TLU 규칙

### 경기
- Official Pitch: +1 official pitch / +1.00 TLU
- 견제 정상: +0 official pitch / +0.85 TLU
- 견제 악송구: +0 official pitch / +0.85 TLU
- 연습투구: +0 official pitch / +1.00 TLU

### 훈련
- 가벼운: 0.75 TLU
- 적정(약 80%): 0.85 TLU
- 전력: 1.00 TLU

## Supabase

V5에서 이미 `migration_v5.sql`을 실행했다면 **V5.2용 새 SQL은 필요 없습니다.** `activityDate`는 기존 `events.metadata` JSON에 저장되므로 DB 컬럼 추가가 없습니다.

V4에서 바로 올리는 경우에는 먼저 `migration_v5.sql`을 실행하세요. 기존 V4 테이블은 삭제하지 않습니다.

## GitHub Pages 업데이트

1. 이 폴더의 파일을 기존 repository 최상위에 업로드/교체
2. `supabase-config.js`의 Project URL 확인
3. Commit
4. GitHub Pages가 새 버전을 배포한 뒤 브라우저를 새로고침
5. 설치형 PWA에서 이전 화면이 보이면 앱을 완전히 종료 후 다시 실행

서비스워커 캐시 버전은 `5.2.0`으로 갱신되어 있습니다.
