-- v0.3: password accounts + multiple group leaders
-- Run after 001_init.sql and 002_balances_holidays_cancellation.sql.

-- The original creator remains the group owner/founder through
-- vacation_groups.leader_user_id. Other leaders are represented by the
-- existing membership role = 'leader'.

create or replace function public._vacation_is_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.vacation_group_members m
    where m.group_id = p_group_id
      and (
        m.user_id = auth.uid()
        or (
          m.user_id is null
          and lower(trim(m.email)) = public._vacation_current_email()
        )
      )
  )
$$;

create or replace function public._vacation_is_leader(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.vacation_group_members m
    where m.group_id = p_group_id
      and m.role = 'leader'
      and (
        m.user_id = auth.uid()
        or (
          m.user_id is null
          and lower(trim(m.email)) = public._vacation_current_email()
        )
      )
  )
$$;

create or replace function public._vacation_is_owner(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.vacation_groups g
    where g.id = p_group_id
      and g.leader_user_id = auth.uid()
  )
$$;

-- Stricter group lookup: a membership already bound to a user cannot be
-- accessed merely by presenting the same email claim from another account.
create or replace function public.get_my_groups()
returns table (
  group_id uuid,
  group_name text,
  role text,
  my_name text
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select g.id, g.name, m.role, m.display_name
  from public.vacation_group_members m
  join public.vacation_groups g on g.id = m.group_id
  where m.user_id = auth.uid()
     or (
       m.user_id is null
       and lower(trim(m.email)) = public._vacation_current_email()
     )
  order by g.name, g.created_at
$$;

-- v2 member listing adds flags needed by the UI to distinguish the founder
-- from additional leaders and to identify the signed-in member row.
create or replace function public.get_group_members_v2(p_group_id uuid)
returns table (
  member_id uuid,
  display_name text,
  email text,
  role text,
  joined boolean,
  is_owner boolean,
  is_me boolean
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public._vacation_is_leader(p_group_id) then
    raise exception 'Only a group leader can manage members';
  end if;

  return query
  select
    m.id,
    m.display_name,
    m.email,
    m.role,
    (m.user_id is not null),
    (m.user_id = g.leader_user_id),
    (
      m.user_id = auth.uid()
      or (m.user_id is null and lower(trim(m.email)) = public._vacation_current_email())
    )
  from public.vacation_group_members m
  join public.vacation_groups g on g.id = m.group_id
  where m.group_id = p_group_id
  order by
    case when m.user_id = g.leader_user_id then 0 when m.role = 'leader' then 1 else 2 end,
    lower(m.display_name);
end;
$$;

-- All leaders may add normal members. Only the original owner/founder may
-- add somebody directly as another leader.
create or replace function public.add_group_member_v2(
  p_group_id uuid,
  p_email text,
  p_display_name text,
  p_role text default 'member'
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := trim(coalesce(p_display_name, ''));
  v_role text := lower(trim(coalesce(p_role, 'member')));
  v_user_id uuid;
  v_member_id uuid;
begin
  if not public._vacation_is_leader(p_group_id) then
    raise exception 'Only a group leader can add members';
  end if;
  if v_role not in ('member', 'leader') then
    raise exception 'Role must be member or leader';
  end if;
  if v_role = 'leader' and not public._vacation_is_owner(p_group_id) then
    raise exception 'Only the original group leader can add another leader';
  end if;
  if v_email = '' or position('@' in v_email) <= 1 or char_length(v_email) > 320 then
    raise exception 'Enter a valid email address';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'Display name must contain 1 to 120 characters';
  end if;
  if exists (
    select 1 from public.vacation_group_members
    where group_id = p_group_id and lower(trim(email)) = v_email
  ) then
    raise exception 'That email address is already in this group';
  end if;

  select u.id into v_user_id
  from auth.users u
  where lower(trim(u.email)) = v_email
  order by u.created_at asc
  limit 1;

  insert into public.vacation_group_members(group_id, user_id, email, display_name, role)
  values (p_group_id, v_user_id, v_email, v_name, v_role)
  returning id into v_member_id;

  return v_member_id;
end;
$$;

create or replace function public.promote_group_leader(
  p_group_id uuid,
  p_member_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public._vacation_is_owner(p_group_id) then
    raise exception 'Only the original group leader can grant leader rights';
  end if;

  update public.vacation_group_members
  set role = 'leader'
  where id = p_member_id
    and group_id = p_group_id;

  if not found then
    raise exception 'Group member not found';
  end if;
end;
$$;

create or replace function public.demote_group_leader(
  p_group_id uuid,
  p_member_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_owner_user_id uuid;
  v_target_user_id uuid;
  v_target_role text;
begin
  if not public._vacation_is_owner(p_group_id) then
    raise exception 'Only the original group leader can remove leader rights';
  end if;

  select g.leader_user_id into v_owner_user_id
  from public.vacation_groups g
  where g.id = p_group_id;

  select m.user_id, m.role into v_target_user_id, v_target_role
  from public.vacation_group_members m
  where m.id = p_member_id and m.group_id = p_group_id;

  if v_target_role is null then
    raise exception 'Group member not found';
  end if;
  if v_target_user_id = v_owner_user_id then
    raise exception 'The original group leader cannot be demoted';
  end if;

  update public.vacation_group_members
  set role = 'member'
  where id = p_member_id and group_id = p_group_id and role = 'leader';
end;
$$;

-- Keep private helpers inaccessible from the browser.
revoke all on function public._vacation_is_member(uuid) from public, anon, authenticated;
revoke all on function public._vacation_is_leader(uuid) from public, anon, authenticated;
revoke all on function public._vacation_is_owner(uuid) from public, anon, authenticated;

-- New v0.3 RPCs.
revoke all on function public.get_group_members_v2(uuid) from public, anon;
revoke all on function public.add_group_member_v2(uuid, text, text, text) from public, anon;
revoke all on function public.promote_group_leader(uuid, uuid) from public, anon;
revoke all on function public.demote_group_leader(uuid, uuid) from public, anon;

grant execute on function public.get_group_members_v2(uuid) to authenticated;
grant execute on function public.add_group_member_v2(uuid, text, text, text) to authenticated;
grant execute on function public.promote_group_leader(uuid, uuid) to authenticated;
grant execute on function public.demote_group_leader(uuid, uuid) to authenticated;
