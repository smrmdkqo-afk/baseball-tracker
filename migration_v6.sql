-- Baseball Tracker Pro V6 schema
-- 기존 V4/V5 테이블(athlete_days, games, training_sessions, appearances, events)은 삭제하지 않습니다.
-- V6는 새 테이블을 추가하여 롤백과 데이터 보존이 가능하게 합니다.
-- Supabase SQL Editor에서 전체 실행하세요. 재실행해도 안전합니다.

create extension if not exists pgcrypto;

create table if not exists public.athletes (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  number text,
  birth_date date,
  team text,
  position text,
  throws text not null default 'R',
  bats text not null default 'R',
  client_updated_at bigint not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.game_days_v6 (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  activity_date date not null,
  client_updated_at bigint not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.batter_faced_v6 (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  game_day_id uuid not null references public.game_days_v6(id) on delete cascade,
  activity_date date not null,
  sequence_no integer not null default 1,
  pitcher_side text check (pitcher_side in ('R','L') or pitcher_side is null),
  batter_side text check (batter_side in ('R','L') or batter_side is null),
  result text,
  completed boolean not null default false,
  recorded_at timestamptz not null default now(),
  client_updated_at bigint not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.plate_appearances_v6 (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  game_day_id uuid not null references public.game_days_v6(id) on delete cascade,
  activity_date date not null,
  sequence_no integer not null default 1,
  batter_side text check (batter_side in ('R','L') or batter_side is null),
  pitcher_side text check (pitcher_side in ('R','L') or pitcher_side is null),
  result text,
  completed boolean not null default false,
  recorded_at timestamptz not null default now(),
  client_updated_at bigint not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.game_events_v6 (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  game_day_id uuid not null references public.game_days_v6(id) on delete cascade,
  activity_date date not null,
  domain text not null check (domain in ('pitching','hitting','defense','baserunning')),
  parent_type text check (parent_type in ('batter_faced','plate_appearance') or parent_type is null),
  parent_id uuid,
  event_type text not null,
  recorded_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  client_updated_at bigint not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.training_sets_v6 (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  activity_date date not null,
  domain text not null check (domain in ('pitching','hitting','defense','baserunning')),
  training_type text not null,
  side text check (side in ('R','L') or side is null),
  quantity numeric not null default 0,
  unit text not null default 'reps',
  intensity text,
  tlu_per_rep numeric not null default 0,
  tlu_total numeric not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  client_updated_at bigint not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists game_days_v6_athlete_date_idx on public.game_days_v6(athlete_id,activity_date desc);
create index if not exists batter_faced_v6_athlete_date_idx on public.batter_faced_v6(athlete_id,activity_date desc,sequence_no);
create index if not exists plate_appearances_v6_athlete_date_idx on public.plate_appearances_v6(athlete_id,activity_date desc,sequence_no);
create index if not exists game_events_v6_athlete_date_idx on public.game_events_v6(athlete_id,activity_date desc,recorded_at);
create index if not exists game_events_v6_parent_idx on public.game_events_v6(parent_type,parent_id);
create index if not exists training_sets_v6_athlete_date_idx on public.training_sets_v6(athlete_id,activity_date desc,domain);

-- updated_at trigger
create or replace function public.bt_v6_set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['game_days_v6','batter_faced_v6','plate_appearances_v6','game_events_v6','training_sets_v6'] loop
    execute format('drop trigger if exists %I on public.%I','bt_v6_updated_'||t,t);
    execute format('create trigger %I before update on public.%I for each row execute function public.bt_v6_set_updated_at()','bt_v6_updated_'||t,t);
  end loop;
end $$;

-- RLS: 로그인 사용자는 자신의 행만 접근
do $$
declare t text;
begin
  foreach t in array array['athletes','game_days_v6','batter_faced_v6','plate_appearances_v6','game_events_v6','training_sets_v6'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I',t||'_select_own',t);
    execute format('drop policy if exists %I on public.%I',t||'_insert_own',t);
    execute format('drop policy if exists %I on public.%I',t||'_update_own',t);
    execute format('drop policy if exists %I on public.%I',t||'_delete_own',t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid())=owner_id)',t||'_select_own',t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid())=owner_id)',t||'_insert_own',t);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id)',t||'_update_own',t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid())=owner_id)',t||'_delete_own',t);
  end loop;
end $$;

grant select,insert,update,delete on public.athletes,public.game_days_v6,public.batter_faced_v6,public.plate_appearances_v6,public.game_events_v6,public.training_sets_v6 to authenticated;
revoke all on public.game_days_v6,public.batter_faced_v6,public.plate_appearances_v6,public.game_events_v6,public.training_sets_v6 from anon;

-- V5 테이블은 의도적으로 유지합니다. V6 앱은 같은 브라우저의 V5 로컬 데이터를 최초 실행 시 IndexedDB V6 모델로 복사합니다.
-- 복사 후 V6 데이터가 Supabase V6 테이블로 동기화되므로 기존 테이블을 삭제할 필요가 없습니다.

notify pgrst,'reload schema';
