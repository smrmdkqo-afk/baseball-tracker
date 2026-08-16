# Baseball Tracker Pro V5.1 Quick

모바일·태블릿·PC에서 사용하는 선수 중심 야구 기록 PWA입니다. V5.1은 상세 경기 스코어링을 제거하고 **빠른 투구 기록 + TLU + 타격/훈련 기록**에 집중합니다.

## 이번 버전의 핵심 변경

- 이닝 / 아웃 / 주자 / 승계주자 / 점수 입력 UI 제거
- 상세 경기 모드 없음
- 경기 투구는 타자에게 던진 공만 Official Pitch로 집계
- Official Pitch 1구 = 1.00 TLU
- 견제 정상 = 0 Official Pitch / 0.85 TLU
- 견제 악송구 = 0 Official Pitch / 0.85 TLU
- 경기 중 연습투구 = 0 Official Pitch / 1.00 TLU
- Total Throws에는 Official Pitch + 견제 + 연습투구 + 훈련투구를 모두 포함
- IN PLAY는 결과 선택 후에만 투구로 확정 저장
- IN PLAY 결과: OUT / 1B / 2B / 3B / HR / ROE / SH / SF
- 타구 형태 GB / LD / FB 및 방향 좌 / 중 / 우는 선택 입력
- Strike%에는 루킹 / 헛스윙 / 파울 / IN PLAY를 Strike로 포함
- K / BB / HBP / Batters Faced / Pitches per Batter / First Pitch Strike% 자동 계산
- 상세 이벤트 로그에서 수정 / 삭제 / 5초 Undo 지원

## TLU 정의

### 경기

| 이벤트 | Official Pitch | TLU |
|---|---:|---:|
| 타자에게 던진 공 | +1 | +1.00 |
| 견제 정상 | +0 | +0.85 |
| 견제 악송구 | +0 | +0.85 |
| 연습투구 | +0 | +1.00 |

### 훈련

| 강도 | TLU |
|---|---:|
| 가벼운 <70% | 0.75 |
| 적정 약 80% | 0.85 |
| 전력 | 1.00 |

## Supabase DB

**V5를 이미 사용 중이면 V5.1에서 추가 SQL 변경은 필요 없습니다.** `events` 테이블의 기존 `category` / `event_type` 필드에 새 이벤트를 저장합니다.

- 새 이벤트 category: `game_throw`
- event_type: `pickoff_normal`, `pickoff_error`, `game_warmup`

기존 V5 데이터와 `appearances` 테이블은 호환성을 위해 그대로 둘 수 있습니다. V5.1 UI에서는 등판 상황을 사용하지 않습니다.

V4에서 처음 업데이트하는 경우에만 `migration_v5.sql`을 Supabase SQL Editor에서 실행하세요. 기존 `athlete_days`, `tracker_days`는 삭제하지 마세요.

## Supabase 설정

`supabase-config.js`에서 Project URL만 확인하세요.

```js
window.BASEBALL_SUPABASE_CONFIG = {
  url: 'https://YOUR-PROJECT-REF.supabase.co',
  publishableKey: 'sb_publishable_...'
};
```

브라우저에는 Publishable key만 사용합니다. `service_role` 또는 `sb_secret_...` 키는 넣지 마세요.

## GitHub Pages 업데이트

1. 현재 앱에서 JSON 백업을 하나 내려받습니다.
2. ZIP을 풉니다.
3. GitHub repository의 기존 V5 파일을 V5.1 파일로 교체합니다.
4. `index.html`, `app.js`, `styles.css`, `sw.js` 등이 repository root에 있어야 합니다.
5. Commit changes 합니다.
6. GitHub Pages 주소를 열고 새로고침합니다.
7. PWA가 이전 파일을 캐시하고 있으면 앱을 완전히 종료 후 다시 열거나 브라우저에서 새로고침합니다. V5.1은 service-worker cache 이름이 변경되어 새 파일로 갱신됩니다.

## 권장 테스트

1. 새 경기 시작
2. BALL / 루킹 / 헛스윙 / 파울 기록
3. IN PLAY → 1B 등 결과 선택
4. 필요하면 GB/LD/FB 및 좌/중/우 선택
5. 견제 정상 1회, 견제 악송구 1회, 연습투구 1회 기록
6. Official Pitch Count가 견제/연습 때문에 증가하지 않는지 확인
7. Game TLU에는 0.85 / 0.85 / 1.00이 반영되는지 확인
8. 로그에서 각각 수정/삭제 후 TLU와 통계 재계산 확인
9. 같은 계정으로 휴대폰/태블릿에서 동기화 확인

## 오프라인 / 동기화

입력은 먼저 기기에 저장하고, 온라인이면 Supabase로 동기화합니다. 자동 동기화 성공 때 완료 팝업을 반복 표시하지 않고 상단 상태만 갱신합니다.
