# Baseball Tracker Pro V6

V6는 V5.2에 화면만 덧붙인 버전이 아니라 기록 모델을 재구성한 버전입니다.

## V6 핵심 구조

- 하단: **홈 / 입력 / 기록 / 분석 / 설정**
- 입력: **활동 날짜 → 경기/훈련 → 투구/타격/수비/주루** (항상 한 줄)
- 경기 = 개별 Event 중심
  - 투구: Batter Faced(BF) 아래에 매 pitch 저장
  - 타격: Plate Appearance(PA) 아래에 매 pitch 반응 저장
  - 수비: 수비 플레이 1개 = event 1개
  - 주루: 도루 시도/추가 진루 1개 = event 1개
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
- 송구 목적지와 병살 기회/결과 선택 가능

### 주루
- 도루는 베이스 하나 단위 attempt
- `1B→2B 성공`, 이후 별도 `2B→3B 실패`이면 SB 1 / CS 1
- 악송구 등을 보고 추가 진루한 것은 `추가 진루`로 저장하여 SB/CS에서 제외

### 훈련
- 투구: 가벼운 0.75 / 중간 0.85 / 전력 1.00
- 타격: 우/좌 + 빈스윙/티/토스/BP/머신/라이브 + 선택 구속 + 횟수
- 수비: 내야/외야 + 훈련 종류 + reps + 실제 송구 수 + 송구 부하
- 주루: 도루 스타트/리드/베이스러닝/슬라이딩/스프린트 등

## 오프라인

기록은 IndexedDB에 먼저 저장됩니다. 인터넷이 없어도 입력할 수 있고, 로그인 상태에서 인터넷이 복구되면 Supabase로 자동 동기화됩니다.
