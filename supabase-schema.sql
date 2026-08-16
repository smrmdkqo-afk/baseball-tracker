-- Baseball Tracker Pro V4 — Multi Athlete
-- Supabase Dashboard > SQL Editor 에서 전체를 한 번 실행하세요.
-- V3의 tracker_days 테이블은 호환/이전 데이터 보존을 위해 삭제하지 않습니다.

create table if not exists public.athletes (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  number text,
  birth_date date,
  team text,
  position text,
  throws text not null default 'R' check (throws in ('R','L','S')),
  bats text not null default 'R' check (bats in ('R','L','S')),
  client_updated_at bigint not null default 0,
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table if not exists public.athlete_days (
  owner_id uuid not null references auth.users(id) on delete cascade,
  athlete_id uuid not null,
  day date not null,
  data jsonb not null default '{}'::jsonb,
  client_updated_at bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (owner_id, athlete_id, day),
  constraint athlete_days_athlete_owner_fk
    foreign key (athlete_id, owner_id)
    references public.athletes(id, owner_id)
    on delete cascade
);

alter table public.athletes enable row level security;
alter table public.athlete_days enable row level security;

-- 재실행 가능하도록 기존 정책 제거
 drop policy if exists "athletes_select_own" on public.athletes;
 drop policy if exists "athletes_insert_own" on public.athletes;
 drop policy if exists "athletes_update_own" on public.athletes;
 drop policy if exists "athletes_delete_own" on public.athletes;
 drop policy if exists "athlete_days_select_own" on public.athlete_days;
 drop policy if exists "athlete_days_insert_own" on public.athlete_days;
 drop policy if exists "athlete_days_update_own" on public.athlete_days;
 drop policy if exists "athlete_days_delete_own" on public.athlete_days;

create policy "athletes_select_own" on public.athletes
for select to authenticated using ((select auth.uid()) = owner_id);
create policy "athletes_insert_own" on public.athletes
for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "athletes_update_own" on public.athletes
for update to authenticated using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);
create policy "athletes_delete_own" on public.athletes
for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "athlete_days_select_own" on public.athlete_days
for select to authenticated using ((select auth.uid()) = owner_id);
create policy "athlete_days_insert_own" on public.athlete_days
for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "athlete_days_update_own" on public.athlete_days
for update to authenticated using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);
create policy "athlete_days_delete_own" on public.athlete_days
for delete to authenticated using ((select auth.uid()) = owner_id);

grant select, insert, update, delete on table public.athletes to authenticated;
grant select, insert, update, delete on table public.athlete_days to authenticated;
revoke all on table public.athletes from anon;
revoke all on table public.athlete_days from anon;

-- V3를 이미 사용했다면 기존 tracker_days는 그대로 남습니다.
-- V4는 새 구조인 athletes / athlete_days를 사용합니다.
