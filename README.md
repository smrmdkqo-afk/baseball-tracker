# Baseball Tracker Pro V4

모바일/태블릿/PC에서 사용하는 PWA 야구 기록 앱입니다.

## V4 핵심
- 한 로그인 계정에서 여러 선수 관리
- 상단 선수 전환: 선수별 투구/타격/도루/통계 완전 분리
- 선수 추가 / 수정 / 삭제
- Supabase 로그인 상태 유지
- 휴대폰/태블릿/PC 간 선수별 클라우드 동기화
- 오프라인 우선 저장 후 온라인 복귀 시 자동 동기화
- V1~V3 단일 선수 localStorage 기록 자동 마이그레이션 → `선수 1`
- 경기 투구는 모두 1.00 TLU
- 훈련 투구 0.75 / 0.85 / 1.00 TLU
- 경기 Ball/Strike/HBP/WP/PB/Balk/SB/CS 등 기존 기능 유지

## 1. Supabase DB 준비
Supabase 프로젝트 > SQL Editor에서 `supabase-schema.sql` 전체를 실행합니다.

V4는 아래 테이블을 사용합니다.
- `athletes`: 선수 프로필
- `athlete_days`: 선수별 날짜 기록

RLS 정책으로 로그인 사용자는 자기 계정의 선수/기록만 읽고 수정할 수 있습니다.

## 2. Supabase Project URL 입력
`supabase-config.js`를 엽니다.

Publishable key는 이미 입력되어 있습니다.

```js
window.BASEBALL_SUPABASE_CONFIG = {
  url: 'https://YOUR-PROJECT-REF.supabase.co',
  publishableKey: 'sb_publishable_GFqlqPz_g6lgtobd9Yr9kw_H8XlJlTP'
};
```

`url` 한 줄만 본인의 Project URL로 바꾸세요.
Project URL은 Supabase 프로젝트의 **Connect** 화면에서 확인할 수 있습니다.

> `sb_secret_...` 또는 `service_role` 키는 절대 이 파일에 넣지 마세요.

## 3. GitHub 업로드
새 Public repository(예: `baseball-tracker`)를 만든 뒤, **이 폴더 안의 파일들을 repository 최상위(root)에 업로드**합니다.

정상 예:
```
index.html
app.js
styles.css
sw.js
manifest.webmanifest
supabase-config.js
supabase-schema.sql
.nojekyll
...
```

`baseball_tracker_pro_v4/index.html`처럼 폴더가 한 단계 더 들어가면 안 됩니다.

## 4. GitHub Pages 켜기
Repository > Settings > Pages
- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/(root)`
- Save

배포 후 `https://사용자명.github.io/baseball-tracker/` 같은 주소가 생성됩니다.

## 5. Supabase Auth URL
Supabase > Authentication > URL Configuration에서 Site URL을 GitHub Pages 주소로 지정하는 것을 권장합니다.

예:
```
https://사용자명.github.io/baseball-tracker/
```

## 6. 테스트 순서
1. PC에서 GitHub Pages 주소 접속
2. 설정 > 클라우드 동기화 > 새 계정 만들기 또는 로그인
3. 설정 > 선수 관리 > 선수 이름 수정
4. `+ 선수 추가`로 두 번째 선수 생성
5. 상단 선수 이름을 눌러 선수 전환
6. 선수 A에 투구 1회 기록
7. 선수 B로 전환해 기록이 섞이지 않는지 확인
8. 휴대폰/태블릿에서 같은 주소 접속 및 같은 계정 로그인
9. `지금 동기화` 후 두 선수와 기록이 나타나는지 확인
10. 홈 화면에 앱 설치

## 동시 입력 주의
V4는 같은 선수/같은 날짜의 기록을 여러 기기에서 동시에 수정할 때 최신 수정 데이터가 우선합니다. 실제 경기 입력은 한 기기를 메인 기록기로 사용하는 것을 권장합니다.

## 로컬 저장
Supabase가 설정되지 않아도 앱 자체는 로컬 모드로 사용할 수 있습니다. 클라우드 설정 후 로그인하면 선수/기록을 서버와 동기화합니다.
