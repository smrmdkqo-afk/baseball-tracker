# Baseball Tracker Pro V6.5.0

V6.5.0은 V6.4의 입력·기록 구조를 유지하면서 **분석 엔진과 분석 탭 UI를 전면 개편**한 버전입니다. 새로운 입력 항목은 추가하지 않습니다.

## V6.5.0 핵심 변경

### 분석 화면 구조
- `경기 성과` / `훈련 · 워크로드` 분리
- 경기: `투구 / 타격 / 수비 / 주루`
- 훈련·워크로드: `전체 / 투구 / 타격 / 수비 / 주루`
- 조회 기간: `7일 / 30일 / 90일 / 시즌 / 전체 / 직접 설정`
- 보기 단위
  - 경기: `경기별 / 주간 / 월간 / 연간`
  - 훈련: `일별 / 주간 / 월간 / 연간`
- 조회 기간과 보기 단위를 독립적으로 변경 가능

### KPI Dashboard
- 주요 지표를 여러 카드로 동시에 표시
- 모든 카드에 작은 Sparkline 추이 표시
- 지표명은 영어/약자를 기본으로 표시
- 공간이 충분하면 작은 한글 의미 표시
- 일반 메뉴, 필터, 탭은 한국어 유지
- Hover 설명 및 별도 용어집 없음

### Metric Detail
지표 카드를 터치/클릭하면 팝업이 아니라 같은 화면 아래의 상세 영역이 갱신됩니다.

상세 영역:
- 지표 영어명 / 짧은 한글 의미
- 기간 전체 값
- 최근 구간 값
- 최대값
- 지표 설명
- 계산 정의
- 큰 추이 그래프
- 그래프 포인트 선택 상세값
- 사용된 표본 크기

### 정확한 기간 집계
주간/월간/연간 비율은 경기별 퍼센트의 단순 평균을 사용하지 않습니다.

예: Strike%
- 경기별 Strike%를 평균내지 않음
- 해당 기간의 `총 Strikes / 총 Official Pitches`로 다시 계산

AVG, OBP, CSW%, K%, BB%, Contact%, Whiff% 등도 같은 원칙으로 기간 단위에서 다시 계산합니다.

## 추가된 경기 투구 지표

### 투구량
- Pitches
- Game TLU
- BF

### 제구
- Strike%
- 1st Strike%
- Ball%
- BB%
- P/BF

### 위력
- CSW%
- SwStr%
- Called Strike%
- K%
- K-BB%

### 투구 결과
- Foul%
- In Play%
- HBP%

### 타구 프로필
- GB%
- LD%
- FB%
- 타구 방향 좌/중/우 Breakdown

우투/좌투 및 상대 우타/좌타 필터를 유지합니다.

`내 투구` TLU에는 해당 방향으로 기록된 공식 투구, 견제, 연습투구, 경기 수비 송구가 포함됩니다. `상대 타자 우/좌` 필터에는 타자에게 실제로 던진 공식 투구만 사용합니다.

## 추가된 경기 타격 지표

### 결과
- PA
- H
- AVG
- OBP
- SLG
- OPS
- ISO
- BABIP

### 선구 · 컨택
- P/PA
- Swing%
- Whiff%
- Contact%
- Called Strike%
- K%
- BB%
- BB/K

### 타구 프로필
- GB%
- LD%
- FB%
- 타구 방향 좌/중/우 Breakdown

내 우타/좌타 및 상대 우투/좌투 필터를 유지합니다.

## 수비 분석
- Fielding%
- Throw Accuracy%
- Chances
- Throws
- Throw TLU
- 내야 포구 형태 Breakdown
- 외야 접근 Breakdown
- 송구 목적지별 시도/정상/악송구/성공률
- 포구 형태 후 송구 성공률

## 주루 분석
- SB
- CS
- Attempts
- SB%
- 1B→2B / 2B→3B / 3B→HOME 구간별 성공률

## 훈련 · 워크로드 분석

### 전체
- Total TLU
- Throws
- Swings
- Defense Reps
- Baserunning

### TLU source
- 경기 공식투구
- 견제
- 경기 연습투구
- 경기 수비송구
- 투구 훈련
- 수비 훈련 송구

### 투구 훈련
- Volume
- TLU
- Total TLU
- Light / Medium / Max

### 타격 훈련
- 총 스윙량
- 훈련 종류별 Breakdown
- 우타/좌타 비중

### 수비 훈련
- 총 Reps
- 실제 송구 횟수
- 수비 훈련 TLU
- 훈련 종류별 Breakdown
- 내야/외야 비중

### 주루 훈련
- 총 Reps
- 훈련 종류별 Breakdown

## 데이터 상태
Pitch 기반 과정 지표는 결과 미상/미완료 상태에서도 이미 입력된 pitch를 활용할 수 있습니다.

결과 기반 지표는 정상 완료된 BF/PA만 사용합니다.

예:
- Pitch 기반: Strike%, CSW%, Swing%, Whiff%, Contact%
- 완료 결과 기반: K%, BB%, AVG, OBP, SLG, OPS

## DB / 배포
- V6.5.0은 Supabase 스키마를 변경하지 않습니다.
- V6 migration을 이미 실행했다면 추가 SQL 실행이 필요 없습니다.
- GitHub Pages의 기존 파일을 V6.5.0 파일로 교체하면 됩니다.
- Service Worker cache key는 `baseball-tracker-pro-v6.5.0`입니다.

## 주요 파일
- `index.html`
- `styles.css`
- `js/app.js`
- `js/analytics.js`
- `js/storage.js`
- `sw.js`
- `migration_v6.sql` — 신규 설치용. 기존 V6 사용자는 재실행 불필요
