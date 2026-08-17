# Baseball Tracker Pro V6.2

V6는 V5.2에 화면만 덧붙인 버전이 아니라 기록 모델을 재구성한 버전입니다.

## V6 핵심 구조

- 하단: **홈 / 입력 / 기록 / 분석 / 설정**
- 입력: **활동 날짜 → 경기/훈련 → 투구/타격/수비/주루** (항상 한 줄)
- 경기 = 개별 Event 중심
  - 투구: Batter Faced(BF) 아래에 매 pitch 저장
  - 타격: Plate Appearance(PA) 아래에 매 pitch 반응 저장
  - 수비: 수비 플레이 1개 = event 1개
  - 주루: 도루 시도 1개 = event 1개
- 훈련 = Training Set 중심
  - +1로 세거나 총량을 직접 입력한 뒤 세트 저장
- 모든 통계는 `activityDate` 기준
- 실제 입력 시각은 `recordedAt`으로 별도 보존
- 로컬 저장은 IndexedDB, Supabase는 클라우드 동기화용

## 먼저 Supabase 업데이트

V5 DB를 사용 중이어도 V6 새 테이블이 필요합니다.

1. Supabase Dashboard → SQL Editor
2. `migration_v6.sql` 전체 실행
3. Table Editor에서 아래 테이블 확인
   - `game_days_v6`
   - `batter_faced_v6`
   - `plate_appearances_v6`
   - `game_events_v6`
   - `training_sets_v6`
4. 기존 `athletes`, `events`, `games` 등 V5 테이블은 삭제하지 마세요.

## Supabase 설정

`supabase-config.js`에서 Project URL만 실제 프로젝트 주소로 바꾸세요.

```js
window.BASEBALL_SUPABASE_CONFIG = {
  url: 'https://YOUR-PROJECT-REF.supabase.co',
  publishableKey: 'sb_publishable_...'
};
```

브라우저에는 Publishable key만 사용합니다. Secret/service_role 키를 넣으면 안 됩니다.

## GitHub Pages 업데이트

ZIP을 풀어 **폴더 안의 파일 전체**를 GitHub repository 최상위에 올립니다.
`index.html`이 repository root에 바로 보여야 합니다.

GitHub → Settings → Pages:

- Source: Deploy from a branch
- Branch: main
- Folder: / (root)

## V5 데이터

- V6는 같은 브라우저에 남아 있는 V5 localStorage 데이터를 최초 실행 시 V6 IndexedDB 모델로 복사합니다.
- V5 localStorage 및 V5 Supabase 테이블은 삭제하지 않습니다.
- 업그레이드할 때는 **V5 기록이 남아 있는 기존 기기에서 V6를 한 번 실행하고 로그인하여 동기화**하는 것을 권장합니다. 그러면 변환된 V6 데이터가 새 V6 클라우드 테이블로 업로드됩니다.

## 주요 기록 규칙

### 경기 투구
- Official pitch: +1 official pitch / +1.00 TLU
- 견제 정상: +0 official pitch / +0.85 TLU
- 견제 악송구: +0 official pitch / +0.85 TLU
- 연습투구: +0 official pitch / +1.00 TLU
- Strike%: 루킹 + 헛스윙 + 파울 + IN PLAY 포함

### 타격
- PA 아래에 `볼 지켜봄 / 스트라이크 지켜봄 / 헛스윙 / 파울 / IN PLAY / HBP`를 구별하여 저장
- IN PLAY 후 OUT/1B/2B/3B/HR/ROE/SH/SF
- 타구 형태와 방향은 선택
- 로그 수정에서 구종/구속/위치/메모를 사후 추가 가능

### 수비
- 내야: 정면/포핸드/백핸드/전진 선택 가능
- 외야: 앞으로/정면/좌우/뒤로 선택 가능
- 포구 결과와 송구 결과를 별도로 기록
- 포지션 그룹 입력 없이 포지션에서 내야/외야를 자동 판별
- 송구 목적지, 정상/악송구, 송구 부하(0.75/0.85/1.00) 기록
- 병살 기회/결과 및 송구 판단 항목은 사용하지 않음
- 분석: 목적지별 송구 성공률, 포구 형태 후 송구 성공률

### 주루
- 도루는 베이스 하나 단위 attempt
- `1B→2B 성공`, 이후 별도 `2B→3B 실패`이면 SB 1 / CS 1
- 추가 진루 입력은 V6.2부터 제거. SB/CS는 실제 도루 시도만 집계

### 훈련
- 투구: 가벼운 0.75 / 중간 0.85 / 전력 1.00
- 타격: 우/좌 + 빈스윙/티/토스/BP/머신/라이브 + 선택 구속 + 횟수
- 수비: 내야/외야 + 훈련 종류 + reps + 실제 송구 수 + 송구 부하
- 주루: 도루 스타트/리드/베이스러닝/슬라이딩/스프린트 등

## 오프라인

기록은 IndexedDB에 먼저 저장됩니다. 인터넷이 없어도 입력할 수 있고, 로그인 상태에서 인터넷이 복구되면 Supabase로 자동 동기화됩니다.


## V6.1 hotfix
- Fixed startup bug where elements with the HTML `hidden` attribute were still rendered because component CSS declared `display:grid`/`display:flex`.
- Added `[hidden]{display:none!important}` globally.
- Bumped the service-worker cache to `baseball-tracker-pro-v6.1.0` so GitHub Pages/PWA clients receive the corrected stylesheet.


## V6.2 changes
- 경기 투구의 견제/연습투구에 `throwSide`를 저장하고, **내 우투/좌투 Game TLU** 필터에 포함합니다. 상대 타자 우/좌 필터에서는 제외합니다.
- 경기 수비 송구도 선택한 부하만큼 TLU에 포함되고, 홈의 Game TLU / Total TLU / Total Throws에 반영합니다.
- 경기 수비의 포지션 그룹 입력과 병살 기회/결과를 제거했습니다.
- 수비 분석에 **송구 목적지별 시도/정상/악송구/성공률**과 **포구 형태 후 송구 성공률**을 추가했습니다.
- 경기 주루의 추가 진루 입력/분석을 제거했습니다. 기존 레거시 기록은 삭제하지 않습니다.
- 타격 분석 버그 수정: V6 이벤트의 canonical domain인 `hitting`과 분석 코드의 `batting` 불일치를 수정했습니다.
- 타격 차트는 데이터가 없는 날짜를 0으로 연결하지 않고 실제 타석이 있는 날짜만 그립니다. AVG/OBP/SLG/OPS 축도 소수 야구 표기 형태로 표시합니다.

V6/V6.1에서 이미 `migration_v6.sql`을 실행했다면 **V6.2용 추가 SQL은 없습니다.**
