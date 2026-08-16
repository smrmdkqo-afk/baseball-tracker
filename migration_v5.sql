-- Baseball Tracker Pro V5 migration
-- V4의 athletes / athlete_days / tracker_days 테이블은 삭제하지 않습니다.
-- Supabase SQL Editor에서 전체를 한 번 실행하세요. 재실행해도 안전하도록 작성했습니다.

create extension if not exists pgcrypto;

-- 1) V4 athletes 확장
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
  deleted_at timestamptz,
  unique (id, owner_id)
);
alter table public.athletes add column if not exists deleted_at timestamptz;

-- 2) V5 session/event tables
create table if not exists public.games (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  game_date date not null,
  opponent text not null default '',
  venue text,
  competition text,
  our_score integer,
  opponent_score integer,
  status text not null default 'completed' check (status in ('live','completed')),
  started_at timestamptz,
  ended_at timestamptz,
  client_updated_at bigint not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legacy_source text,
  unique (owner_id, legacy_source)
);

create table if not exists public.training_sessions (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  session_date date not null,
  title text not null default '훈련',
  status text not null default 'completed' check (status in ('live','completed')),
  started_at timestamptz,
  ended_at timestamptz,
  client_updated_at bigint not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legacy_source text,
  unique (owner_id, legacy_source)
);

create table if not exists public.appearances (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  type text not null default 'pitching',
  inning integer not null default 1 check (inning >= 1),
  half text not null default 'top' check (half in ('top','bottom')),
  outs integer not null default 0 check (outs between 0 and 2),
  runner_1 boolean not null default false,
  runner_2 boolean not null default false,
  runner_3 boolean not null default false,
  our_score integer not null default 0,
  opponent_score integer not null default 0,
  status text not null default 'completed' check (status in ('live','completed')),
  started_at timestamptz,
  ended_at timestamptz,
  client_updated_at bigint not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legacy_source text,
  unique (owner_id, legacy_source)
);

create table if not exists public.events (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  game_id uuid references public.games(id) on delete cascade,
  training_session_id uuid references public.training_sessions(id) on delete cascade,
  appearance_id uuid references public.appearances(id) on delete cascade,
  category text not null,
  event_type text not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  client_updated_at bigint not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  legacy_source text,
  unique (owner_id, legacy_source),
  constraint event_parent_check check (
    not (game_id is not null and training_session_id is not null)
  )
);

create index if not exists games_athlete_date_idx on public.games(athlete_id, game_date desc);
create index if not exists training_sessions_athlete_date_idx on public.training_sessions(athlete_id, session_date desc);
create index if not exists appearances_game_idx on public.appearances(game_id, started_at);
create index if not exists events_athlete_time_idx on public.events(athlete_id, occurred_at desc);
create index if not exists events_game_idx on public.events(game_id, occurred_at);
create index if not exists events_training_idx on public.events(training_session_id, occurred_at);
create index if not exists events_appearance_idx on public.events(appearance_id, occurred_at);

-- 3) RLS: 로그인 사용자는 자신의 데이터만 접근
alter table public.athletes enable row level security;
alter table public.games enable row level security;
alter table public.training_sessions enable row level security;
alter table public.appearances enable row level security;
alter table public.events enable row level security;

do $$
declare t text;
begin
  foreach t in array array['athletes','games','training_sessions','appearances','events'] loop
    execute format('drop policy if exists %I on public.%I', t||'_select_own', t);
    execute format('drop policy if exists %I on public.%I', t||'_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t||'_update_own', t);
    execute format('drop policy if exists %I on public.%I', t||'_delete_own', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = owner_id)', t||'_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = owner_id)', t||'_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id)', t||'_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = owner_id)', t||'_delete_own', t);
  end loop;
end $$;

grant select, insert, update, delete on public.athletes, public.games, public.training_sessions, public.appearances, public.events to authenticated;
revoke all on public.athletes, public.games, public.training_sessions, public.appearances, public.events from anon;

-- 4) V4 athlete_days -> V5 migration
-- 기존 테이블이 있으면 날짜별 JSON을 새 세션/이벤트 구조로 복사합니다.
do $$
begin
  if to_regclass('public.athlete_days') is not null then
    -- training session
    insert into public.training_sessions
      (id,owner_id,athlete_id,session_date,title,status,started_at,ended_at,client_updated_at,legacy_source)
    select gen_random_uuid(), d.owner_id, d.athlete_id, d.day, 'V4 가져오기', 'completed',
           d.day::timestamp + interval '9 hours', d.day::timestamp + interval '20 hours',
           d.client_updated_at, 'v4:'||d.athlete_id::text||':'||d.day::text||':training'
    from public.athlete_days d
    where jsonb_array_length(coalesce(d.data->'trainingThrows','[]'::jsonb))
        + jsonb_array_length(coalesce(d.data->'trainingSwings','[]'::jsonb)) > 0
    on conflict (owner_id, legacy_source) do nothing;

    -- game
    insert into public.games
      (id,owner_id,athlete_id,game_date,opponent,status,started_at,ended_at,client_updated_at,legacy_source)
    select gen_random_uuid(), d.owner_id, d.athlete_id, d.day, '상대팀 미입력', 'completed',
           d.day::timestamp + interval '13 hours', d.day::timestamp + interval '21 hours',
           d.client_updated_at, 'v4:'||d.athlete_id::text||':'||d.day::text||':game'
    from public.athlete_days d
    where jsonb_array_length(coalesce(d.data#>'{gamePitching,pitches}','[]'::jsonb))
        + jsonb_array_length(coalesce(d.data#>'{gamePitching,events}','[]'::jsonb))
        + jsonb_array_length(coalesce(d.data->'gameHitting','[]'::jsonb))
        + jsonb_array_length(coalesce(d.data->'baserunning','[]'::jsonb)) > 0
    on conflict (owner_id, legacy_source) do nothing;

    -- pitching appearance: V4에는 등판 시작 상황이 없으므로 1회 0아웃 주자 없음으로 이관
    insert into public.appearances
      (id,owner_id,athlete_id,game_id,type,inning,half,outs,runner_1,runner_2,runner_3,status,started_at,ended_at,client_updated_at,legacy_source)
    select gen_random_uuid(), d.owner_id, d.athlete_id, g.id, 'pitching', 1, 'top', 0, false,false,false,'completed',
           d.day::timestamp + interval '13 hours', d.day::timestamp + interval '16 hours', d.client_updated_at,
           'v4:'||d.athlete_id::text||':'||d.day::text||':appearance'
    from public.athlete_days d
    join public.games g on g.owner_id=d.owner_id and g.legacy_source='v4:'||d.athlete_id::text||':'||d.day::text||':game'
    where jsonb_array_length(coalesce(d.data#>'{gamePitching,pitches}','[]'::jsonb))
        + jsonb_array_length(coalesce(d.data#>'{gamePitching,events}','[]'::jsonb)) > 0
    on conflict (owner_id, legacy_source) do nothing;

    -- training throws
    insert into public.events
      (id,owner_id,athlete_id,training_session_id,category,event_type,occurred_at,metadata,client_updated_at,legacy_source)
    select gen_random_uuid(), d.owner_id,d.athlete_id,s.id,'training_throw',coalesce(x.v->>'intensity','light'),
           case when coalesce(x.v->>'ts','') ~ '^[0-9]+$' then to_timestamp((x.v->>'ts')::double precision/1000.0) else d.day::timestamp + interval '9 hours' end,
           jsonb_build_object('intensity',coalesce(x.v->>'intensity','light'),'context',coalesce(x.v->>'context','other'),'legacy',true),
           d.client_updated_at,'v4:'||d.athlete_id::text||':'||d.day::text||':training_throw:'||x.ord::text
    from public.athlete_days d
    join public.training_sessions s on s.owner_id=d.owner_id and s.legacy_source='v4:'||d.athlete_id::text||':'||d.day::text||':training'
    cross join lateral jsonb_array_elements(coalesce(d.data->'trainingThrows','[]'::jsonb)) with ordinality x(v,ord)
    on conflict (owner_id, legacy_source) do nothing;

    -- training swings
    insert into public.events
      (id,owner_id,athlete_id,training_session_id,category,event_type,occurred_at,metadata,client_updated_at,legacy_source)
    select gen_random_uuid(),d.owner_id,d.athlete_id,s.id,'training_hit',coalesce(x.v->>'quality','medium'),
           case when coalesce(x.v->>'ts','') ~ '^[0-9]+$' then to_timestamp((x.v->>'ts')::double precision/1000.0) else d.day::timestamp + interval '11 hours' end,
           jsonb_build_object('quality',coalesce(x.v->>'quality','medium'),'type',coalesce(x.v->>'type','other'),'legacy',true),
           d.client_updated_at,'v4:'||d.athlete_id::text||':'||d.day::text||':training_hit:'||x.ord::text
    from public.athlete_days d
    join public.training_sessions s on s.owner_id=d.owner_id and s.legacy_source='v4:'||d.athlete_id::text||':'||d.day::text||':training'
    cross join lateral jsonb_array_elements(coalesce(d.data->'trainingSwings','[]'::jsonb)) with ordinality x(v,ord)
    on conflict (owner_id, legacy_source) do nothing;

    -- game pitches
    insert into public.events
      (id,owner_id,athlete_id,game_id,appearance_id,category,event_type,occurred_at,metadata,client_updated_at,legacy_source)
    select gen_random_uuid(),d.owner_id,d.athlete_id,g.id,a.id,'pitch',coalesce(p.v->>'result','ball'),
           case when coalesce(p.v->>'ts','') ~ '^[0-9]+$' then to_timestamp((p.v->>'ts')::double precision/1000.0) else d.day::timestamp + interval '13 hours' end,
           jsonb_build_object('inplayResult',(coalesce(d.data#>'{gamePitching,inplayResults}','{}'::jsonb)->>(p.v->>'id')),'legacy',true),
           d.client_updated_at,'v4:'||d.athlete_id::text||':'||d.day::text||':pitch:'||p.ord::text
    from public.athlete_days d
    join public.games g on g.owner_id=d.owner_id and g.legacy_source='v4:'||d.athlete_id::text||':'||d.day::text||':game'
    left join public.appearances a on a.owner_id=d.owner_id and a.legacy_source='v4:'||d.athlete_id::text||':'||d.day::text||':appearance'
    cross join lateral jsonb_array_elements(coalesce(d.data#>'{gamePitching,pitches}','[]'::jsonb)) with ordinality p(v,ord)
    on conflict (owner_id, legacy_source) do nothing;

    -- pitch tags WP/PB/낫아웃
    insert into public.events
      (id,owner_id,athlete_id,game_id,appearance_id,category,event_type,occurred_at,metadata,client_updated_at,legacy_source)
    select gen_random_uuid(),d.owner_id,d.athlete_id,g.id,a.id,'pitch_tag',tag.v #>> '{}',pe.occurred_at + (tag.ord::text||' milliseconds')::interval,
           jsonb_build_object('pitchEventId',pe.id,'legacy',true),d.client_updated_at,
           'v4:'||d.athlete_id::text||':'||d.day::text||':pitch_tag:'||p.ord::text||':'||tag.ord::text
    from public.athlete_days d
    join public.games g on g.owner_id=d.owner_id and g.legacy_source='v4:'||d.athlete_id::text||':'||d.day::text||':game'
    left join public.appearances a on a.owner_id=d.owner_id and a.legacy_source='v4:'||d.athlete_id::text||':'||d.day::text||':appearance'
    cross join lateral jsonb_array_elements(coalesce(d.data#>'{gamePitching,pitches}','[]'::jsonb)) with ordinality p(v,ord)
    cross join lateral jsonb_array_elements(coalesce(p.v->'secondary','[]'::jsonb)) with ordinality tag(v,ord)
    join public.events pe on pe.owner_id=d.owner_id and pe.legacy_source='v4:'||d.athlete_id::text||':'||d.day::text||':pitch:'||p.ord::text
    on conflict (owner_id, legacy_source) do nothing;

    -- game pitching exceptions
    insert into public.events
      (id,owner_id,athlete_id,game_id,appearance_id,category,event_type,occurred_at,metadata,client_updated_at,legacy_source)
    select gen_random_uuid(),d.owner_id,d.athlete_id,g.id,a.id,
           case when coalesce(x.v->>'type','') in ('SB','CS') then 'baserunning' else 'game_event' end,
           case when coalesce(x.v->>'type','OTHER')='PO' then 'PICKOFF' else coalesce(x.v->>'type','OTHER') end,
           case when coalesce(x.v->>'ts','') ~ '^[0-9]+$' then to_timestamp((x.v->>'ts')::double precision/1000.0) else d.day::timestamp + interval '16 hours' end,
           jsonb_build_object('legacy',true),d.client_updated_at,'v4:'||d.athlete_id::text||':'||d.day::text||':game_event:'||x.ord::text
    from public.athlete_days d
    join public.games g on g.owner_id=d.owner_id and g.legacy_source='v4:'||d.athlete_id::text||':'||d.day::text||':game'
    left join public.appearances a on a.owner_id=d.owner_id and a.legacy_source='v4:'||d.athlete_id::text||':'||d.day::text||':appearance'
    cross join lateral jsonb_array_elements(coalesce(d.data#>'{gamePitching,events}','[]'::jsonb)) with ordinality x(v,ord)
    on conflict (owner_id, legacy_source) do nothing;

    -- batting
    insert into public.events
      (id,owner_id,athlete_id,game_id,category,event_type,occurred_at,metadata,client_updated_at,legacy_source)
    select gen_random_uuid(),d.owner_id,d.athlete_id,g.id,'batting',coalesce(x.v->>'result','OUT'),
           case when coalesce(x.v->>'ts','') ~ '^[0-9]+$' then to_timestamp((x.v->>'ts')::double precision/1000.0) else d.day::timestamp + interval '17 hours' end,
           jsonb_build_object('legacy',true),d.client_updated_at,'v4:'||d.athlete_id::text||':'||d.day::text||':batting:'||x.ord::text
    from public.athlete_days d
    join public.games g on g.owner_id=d.owner_id and g.legacy_source='v4:'||d.athlete_id::text||':'||d.day::text||':game'
    cross join lateral jsonb_array_elements(coalesce(d.data->'gameHitting','[]'::jsonb)) with ordinality x(v,ord)
    on conflict (owner_id, legacy_source) do nothing;

    -- baserunning
    insert into public.events
      (id,owner_id,athlete_id,game_id,category,event_type,occurred_at,metadata,client_updated_at,legacy_source)
    select gen_random_uuid(),d.owner_id,d.athlete_id,g.id,'baserunning',coalesce(x.v->>'type','SB'),
           case when coalesce(x.v->>'ts','') ~ '^[0-9]+$' then to_timestamp((x.v->>'ts')::double precision/1000.0) else d.day::timestamp + interval '18 hours' end,
           jsonb_build_object('legacy',true),d.client_updated_at,'v4:'||d.athlete_id::text||':'||d.day::text||':baserunning:'||x.ord::text
    from public.athlete_days d
    join public.games g on g.owner_id=d.owner_id and g.legacy_source='v4:'||d.athlete_id::text||':'||d.day::text||':game'
    cross join lateral jsonb_array_elements(coalesce(d.data->'baserunning','[]'::jsonb)) with ordinality x(v,ord)
    on conflict (owner_id, legacy_source) do nothing;
  end if;
end $$;

-- PostgREST schema cache refresh
notify pgrst, 'reload schema';
