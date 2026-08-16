# Baseball Tracker Pro V5

선수 중심 야구 기록 PWA입니다. 모바일, 태블릿, PC에서 동일한 GitHub Pages 주소로 사용하며 Supabase 로그인 시 여러 기기 간 동기화됩니다.

## V5 핵심 구조

- 선수(Athlete)
  - 경기(Game)
    - 등판(Pitching Appearance)
    - 투구 / 타격 / 수비 / 주루 / 예외 이벤트
  - 훈련(Training Session)
    - 투구 / 타격 / 수비 이벤트
- 모든 입력은 `events` 원본 로그로 저장됩니다.
- 통계는 이벤트 로그에서 다시 계산합니다.
- 개별 이벤트 수정 / soft-delete / 5초 Undo를 지원합니다.
- 경기 투구는 모두 1.00 TLU입니다.
- 훈련 투구: 가벼운 0.75 / 적정 0.85 / 전력 1.00 TLU.

## V4에서 업데이트하는 순서

1. 현재 V4 앱에서 JSON 백업을 한 번 내려받습니다.
2. Supabase Dashboard > SQL Editor에서 `migration_v5.sql` 전체를 실행합니다.
3. **기존 `athlete_days`, `tracker_days` 테이블은 삭제하지 마세요.** Migration은 V5 테이블을 추가하고 V4 데이터를 복사합니다.
4. `supabase-config.js`에 기존 Project URL이 들어 있는지 확인합니다.
5. 이 폴더의 파일을 GitHub repository 최상위에 업로드합니다.
6. GitHub Pages 주소를 새로고침합니다.
7. 같은 계정으로 로그인 후 `설정 > 지금 동기화`를 한 번 실행합니다.

`migration_v5.sql`은 `legacy_source`를 사용해 V4 데이터 복사를 중복 방지하도록 구성했습니다. 같은 SQL을 다시 실행해도 같은 V4 기록을 다시 만들지 않습니다.

### 주의: V4 등판 시작 상황

V4에는 이닝/아웃/승계주자 시작 정보가 없었습니다. V5로 가져온 기존 경기 투구는 자동 변환되지만 등판 시작 상황은 `1회초 · 0아웃 · 주자 없음`으로 표시됩니다. V5 이후 신규 등판부터 정확히 저장됩니다.

## Supabase 설정

`supabase-config.js`:

```js
window.BASEBALL_SUPABASE_CONFIG = {
  url: 'https://YOUR-PROJECT-REF.supabase.co',
  publishableKey: 'sb_publishable_...'
};
```

- `sb_publishable_...` 키는 브라우저용입니다.
- `service_role`, `sb_secret_...` 키는 절대 GitHub에 올리지 마세요.
- 현재 배포본에는 사용자가 제공한 publishable key가 이미 들어 있습니다. **Project URL만 확인하세요.**

## GitHub Pages

1. GitHub에 Public repository 생성 (예: `baseball-tracker`)
2. ZIP 자체가 아니라 압축을 푼 파일을 repository root에 업로드
3. `index.html`이 repository 첫 화면에 보여야 함
4. Settings > Pages
5. Source: `Deploy from a branch`
6. Branch: `main`
7. Folder: `/(root)`
8. Save

## 테스트 순서

1. PC에서 GitHub Pages URL 접속
2. 설정 > 로그인
3. 선수 2명 추가 후 상단 선수 전환 확인
4. 경기 생성
5. 투구 시작: 중간 등판 상황(예: 4회초, 2아웃, 1·2루) 입력
6. BALL / 스트라이크 / 인플레이 / HBP 기록
7. WP / PB / 보크 / IBB / 승계주자 득점 입력
8. 경기 타격 / 수비 / 주루 입력
9. 훈련 세션에서 투구 / 타격 / 수비 입력
10. 로그에서 개별 이벤트 수정 / 삭제 / Undo 확인
11. 분석 화면 통계가 즉시 재계산되는지 확인
12. 휴대폰/태블릿에서 같은 계정 로그인 후 `지금 동기화`
13. 오프라인 상태에서 입력 후 인터넷 복구 시 자동 동기화 확인

## 동기화 UX

자동 동기화 성공 시 팝업을 반복해서 띄우지 않습니다. 상단 상태만 `동기화 중` -> `☁ 동기화됨`으로 바뀝니다. 사용자가 `지금 동기화`를 직접 누른 경우에만 완료 toast가 표시됩니다.

## 데이터 백업

설정 > JSON 백업 내보내기를 사용하면 선수, 경기, 훈련, 등판, 이벤트 전체가 포함됩니다. V4 JSON 백업을 V5에서 불러오면 로컬에서 자동 변환합니다.
