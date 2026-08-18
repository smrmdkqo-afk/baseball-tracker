-- 야구일기 V7.2 강판 이벤트 허용
-- 기존 테이블이나 기록은 변경하지 않습니다.
-- V7.1을 사용 중인 프로젝트에서는 이 파일을 Supabase SQL Editor에서 한 번 실행하세요.
-- 신규 설치는 migration_v6.sql, migration_v7.sql 실행 후 이 파일을 실행하세요.

begin;

create or replace function public.bt_v7_validate_account_links()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  linked_owner uuid;
  linked_athlete uuid;
  linked_game_day uuid;
  linked_date date;
begin
  if tg_table_name='game_days_v6' then
    select a.owner_id into linked_owner
      from public.athletes a where a.id=new.athlete_id;
    if not found then raise exception 'athlete does not exist' using errcode='23503'; end if;
    if linked_owner<>new.owner_id then raise exception 'game day owner does not match athlete owner' using errcode='23514'; end if;

  elsif tg_table_name in ('batter_faced_v6','plate_appearances_v6') then
    select g.owner_id,g.athlete_id,g.activity_date
      into linked_owner,linked_athlete,linked_date
      from public.game_days_v6 g where g.id=new.game_day_id;
    if not found then raise exception 'game day does not exist' using errcode='23503'; end if;
    if linked_owner<>new.owner_id or linked_athlete<>new.athlete_id then
      raise exception 'BF/PA owner or athlete does not match game day' using errcode='23514';
    end if;
    if linked_date<>new.activity_date then raise exception 'BF/PA activity date does not match game day' using errcode='23514'; end if;

  elsif tg_table_name='game_events_v6' then
    select g.owner_id,g.athlete_id,g.activity_date
      into linked_owner,linked_athlete,linked_date
      from public.game_days_v6 g where g.id=new.game_day_id;
    if not found then raise exception 'game day does not exist' using errcode='23503'; end if;
    if linked_owner<>new.owner_id or linked_athlete<>new.athlete_id then
      raise exception 'event owner or athlete does not match game day' using errcode='23514';
    end if;
    if linked_date<>new.activity_date then raise exception 'event activity date does not match game day' using errcode='23514'; end if;

    if new.deleted_at is null then
      if (new.parent_type is null) <> (new.parent_id is null) then
        raise exception 'parent_type and parent_id must both be set or both be null' using errcode='23514';
      end if;
      if new.parent_type='batter_faced' then
        if new.domain<>'pitching' then raise exception 'batter_faced parent requires pitching domain' using errcode='23514'; end if;
        select b.owner_id,b.athlete_id,b.game_day_id
          into linked_owner,linked_athlete,linked_game_day
          from public.batter_faced_v6 b where b.id=new.parent_id and b.deleted_at is null;
        if not found then raise exception 'active batter_faced parent does not exist' using errcode='23503'; end if;
        if linked_owner<>new.owner_id or linked_athlete<>new.athlete_id or linked_game_day<>new.game_day_id then
          raise exception 'pitch event does not match its batter_faced parent' using errcode='23514';
        end if;
      elsif new.parent_type='plate_appearance' then
        if new.domain<>'hitting' then raise exception 'plate_appearance parent requires hitting domain' using errcode='23514'; end if;
        select p.owner_id,p.athlete_id,p.game_day_id
          into linked_owner,linked_athlete,linked_game_day
          from public.plate_appearances_v6 p where p.id=new.parent_id and p.deleted_at is null;
        if not found then raise exception 'active plate_appearance parent does not exist' using errcode='23503'; end if;
        if linked_owner<>new.owner_id or linked_athlete<>new.athlete_id or linked_game_day<>new.game_day_id then
          raise exception 'hitting event does not match its plate_appearance parent' using errcode='23514';
        end if;
      elsif new.parent_type is null then
        if new.domain='pitching' and new.event_type not in ('pickoff_normal','pickoff_error','game_warmup','pitching_exit') then
          raise exception 'parentless pitching event must be pickoff, warmup, or pitching exit' using errcode='23514';
        end if;
        if new.domain='hitting' then raise exception 'hitting event requires plate_appearance parent' using errcode='23514'; end if;
      end if;
    end if;

  elsif tg_table_name='training_sets_v6' then
    select a.owner_id into linked_owner
      from public.athletes a where a.id=new.athlete_id;
    if not found then raise exception 'athlete does not exist' using errcode='23503'; end if;
    if linked_owner<>new.owner_id then raise exception 'training set owner does not match athlete owner' using errcode='23514'; end if;
  end if;
  return new;
end;
$$;

revoke all on function public.bt_v7_validate_account_links() from public;
grant execute on function public.bt_v7_validate_account_links() to authenticated;

notify pgrst,'reload schema';
commit;
