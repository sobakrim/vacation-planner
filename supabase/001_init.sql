-- Group Vacation Planner schema
-- Run this whole file once in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.vacation_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  leader_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.vacation_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.vacation_groups(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  email text not null check (char_length(trim(email)) between 3 and 320),
  display_name text not null check (char_length(trim(display_name)) between 1 and 120),
  role text not null check (role in ('leader', 'member')),
  created_at timestamptz not null default now()
);

create unique index if not exists vacation_group_members_email_unique
  on public.vacation_group_members (group_id, lower(email));
create index if not exists vacation_group_members_user_idx
  on public.vacation_group_members (user_id);

create table if not exists public.vacation_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.vacation_groups(id) on delete cascade,
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  requester_email text not null,
  requester_name text not null,
  start_date date not null,
  end_date date not null,
  note text check (note is null or char_length(note) <= 1000),
  status text not null check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  notified_at timestamptz,
  check (end_date >= start_date),
  check (end_date - start_date <= 365)
);

create index if not exists vacation_requests_group_dates_idx
  on public.vacation_requests (group_id, start_date, end_date);
create index if not exists vacation_requests_requester_idx
  on public.vacation_requests (requester_user_id, group_id);
create index if not exists vacation_requests_status_idx
  on public.vacation_requests (group_id, status, created_at);

alter table public.vacation_groups enable row level security;
alter table public.vacation_group_members enable row level security;
alter table public.vacation_requests enable row level security;

-- No direct table access from the browser. All browser operations go through
-- the carefully scoped RPC functions below.
revoke all on table public.vacation_groups from anon, authenticated;
revoke all on table public.vacation_group_members from anon, authenticated;
revoke all on table public.vacation_requests from anon, authenticated;

create or replace function public._vacation_current_email()
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select lower(trim(coalesce(auth.jwt() ->> 'email', '')))
$$;

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
        or lower(trim(m.email)) = public._vacation_current_email()
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
    from public.vacation_groups g
    where g.id = p_group_id
      and g.leader_user_id = auth.uid()
  )
$$;

create or replace function public.claim_memberships()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text := public._vacation_current_email();
  v_count integer;
begin
  if auth.uid() is null or v_email = '' then
    raise exception 'Authentication required';
  end if;

  update public.vacation_group_members
  set user_id = auth.uid()
  where user_id is null
    and lower(trim(email)) = v_email;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.create_group(p_name text, p_leader_name text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_group_id uuid;
  v_email text := public._vacation_current_email();
  v_name text := trim(coalesce(p_name, ''));
  v_leader_name text := trim(coalesce(p_leader_name, ''));
begin
  if auth.uid() is null or v_email = '' then
    raise exception 'Authentication required';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'Group name must contain 1 to 120 characters';
  end if;
  if char_length(v_leader_name) < 1 or char_length(v_leader_name) > 120 then
    raise exception 'Display name must contain 1 to 120 characters';
  end if;

  insert into public.vacation_groups(name, leader_user_id)
  values (v_name, auth.uid())
  returning id into v_group_id;

  insert into public.vacation_group_members(group_id, user_id, email, display_name, role)
  values (v_group_id, auth.uid(), v_email, v_leader_name, 'leader');

  return v_group_id;
end;
$$;

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
     or lower(trim(m.email)) = public._vacation_current_email()
  order by g.name, g.created_at
$$;

create or replace function public.get_group_calendar(
  p_group_id uuid,
  p_from date,
  p_to date
)
returns table (
  request_id uuid,
  requester_name text,
  start_date date,
  end_date date
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public._vacation_is_member(p_group_id) then
    raise exception 'You are not a member of this group';
  end if;
  if p_to < p_from then
    raise exception 'Invalid calendar range';
  end if;

  return query
  select r.id, r.requester_name, r.start_date, r.end_date
  from public.vacation_requests r
  where r.group_id = p_group_id
    and r.status = 'approved'
    and r.start_date <= p_to
    and r.end_date >= p_from
  order by r.start_date, r.requester_name;
end;
$$;

create or replace function public.get_my_vacation_requests(p_group_id uuid)
returns table (
  request_id uuid,
  requester_name text,
  requester_email text,
  start_date date,
  end_date date,
  note text,
  status text,
  created_at timestamptz,
  decided_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public._vacation_is_member(p_group_id) then
    raise exception 'You are not a member of this group';
  end if;

  return query
  select r.id, r.requester_name, r.requester_email, r.start_date, r.end_date,
         r.note, r.status, r.created_at, r.decided_at
  from public.vacation_requests r
  where r.group_id = p_group_id
    and r.requester_user_id = auth.uid()
  order by r.start_date desc, r.created_at desc;
end;
$$;

create or replace function public.get_pending_vacation_requests(p_group_id uuid)
returns table (
  request_id uuid,
  requester_name text,
  requester_email text,
  start_date date,
  end_date date,
  note text,
  status text,
  created_at timestamptz,
  decided_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public._vacation_is_leader(p_group_id) then
    raise exception 'Only the group leader can see pending requests';
  end if;

  return query
  select r.id, r.requester_name, r.requester_email, r.start_date, r.end_date,
         r.note, r.status, r.created_at, r.decided_at
  from public.vacation_requests r
  where r.group_id = p_group_id
    and r.status = 'pending'
  order by r.created_at asc;
end;
$$;

create or replace function public.get_group_members(p_group_id uuid)
returns table (
  member_id uuid,
  display_name text,
  email text,
  role text,
  joined boolean
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public._vacation_is_leader(p_group_id) then
    raise exception 'Only the group leader can manage members';
  end if;

  return query
  select m.id, m.display_name, m.email, m.role, (m.user_id is not null)
  from public.vacation_group_members m
  where m.group_id = p_group_id
  order by case when m.role = 'leader' then 0 else 1 end, lower(m.display_name);
end;
$$;

create or replace function public.add_group_member(
  p_group_id uuid,
  p_email text,
  p_display_name text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := trim(coalesce(p_display_name, ''));
  v_user_id uuid;
  v_member_id uuid;
begin
  if not public._vacation_is_leader(p_group_id) then
    raise exception 'Only the group leader can add members';
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
  values (p_group_id, v_user_id, v_email, v_name, 'member')
  returning id into v_member_id;

  return v_member_id;
end;
$$;

create or replace function public.remove_group_member(p_group_id uuid, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public._vacation_is_leader(p_group_id) then
    raise exception 'Only the group leader can remove members';
  end if;
  if exists (
    select 1 from public.vacation_group_members
    where id = p_member_id and group_id = p_group_id and role = 'leader'
  ) then
    raise exception 'The group leader cannot be removed';
  end if;

  delete from public.vacation_group_members
  where id = p_member_id and group_id = p_group_id and role = 'member';
end;
$$;

create or replace function public.request_vacation(
  p_group_id uuid,
  p_start_date date,
  p_end_date date,
  p_note text default null
)
returns table (
  request_id uuid,
  status text
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_member public.vacation_group_members%rowtype;
  v_status text;
  v_request_id uuid;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'Invalid vacation dates';
  end if;
  if p_end_date - p_start_date > 365 then
    raise exception 'A single vacation request cannot exceed 366 calendar days';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'Note is too long';
  end if;

  select m.* into v_member
  from public.vacation_group_members m
  where m.group_id = p_group_id
    and (
      m.user_id = auth.uid()
      or lower(trim(m.email)) = public._vacation_current_email()
    )
  limit 1;

  if v_member.id is null then
    raise exception 'You are not a member of this group';
  end if;

  if v_member.user_id is null then
    update public.vacation_group_members
    set user_id = auth.uid()
    where id = v_member.id;
  elsif v_member.user_id <> auth.uid() then
    raise exception 'This group membership belongs to another account';
  end if;

  if exists (
    select 1
    from public.vacation_requests r
    where r.group_id = p_group_id
      and r.requester_user_id = auth.uid()
      and r.status in ('pending', 'approved')
      and r.start_date <= p_end_date
      and r.end_date >= p_start_date
  ) then
    raise exception 'You already have a pending or approved vacation overlapping these dates';
  end if;

  v_status := case when public._vacation_is_leader(p_group_id) then 'approved' else 'pending' end;

  insert into public.vacation_requests(
    group_id, requester_user_id, requester_email, requester_name,
    start_date, end_date, note, status, decided_at, decided_by
  ) values (
    p_group_id, auth.uid(), v_member.email, v_member.display_name,
    p_start_date, p_end_date, v_note, v_status,
    case when v_status = 'approved' then now() else null end,
    case when v_status = 'approved' then auth.uid() else null end
  ) returning id into v_request_id;

  return query select v_request_id, v_status;
end;
$$;

create or replace function public.review_vacation(
  p_request_id uuid,
  p_decision text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_group_id uuid;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;

  select r.group_id into v_group_id
  from public.vacation_requests r
  where r.id = p_request_id;

  if v_group_id is null then
    raise exception 'Vacation request not found';
  end if;
  if not public._vacation_is_leader(v_group_id) then
    raise exception 'Only the group leader can review requests';
  end if;

  update public.vacation_requests
  set status = p_decision,
      decided_at = now(),
      decided_by = auth.uid()
  where id = p_request_id
    and status = 'pending';

  if not found then
    raise exception 'This request has already been reviewed';
  end if;
end;
$$;

create or replace function public.withdraw_vacation(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  delete from public.vacation_requests
  where id = p_request_id
    and requester_user_id = auth.uid()
    and status = 'pending';

  if not found then
    raise exception 'Only your own pending request can be withdrawn';
  end if;
end;
$$;

-- Keep internal helper functions private from browser callers.
revoke all on function public._vacation_current_email() from public, anon, authenticated;
revoke all on function public._vacation_is_member(uuid) from public, anon, authenticated;
revoke all on function public._vacation_is_leader(uuid) from public, anon, authenticated;

-- Authenticated users can call only the public application RPCs.
revoke all on function public.claim_memberships() from public, anon;
revoke all on function public.create_group(text, text) from public, anon;
revoke all on function public.get_my_groups() from public, anon;
revoke all on function public.get_group_calendar(uuid, date, date) from public, anon;
revoke all on function public.get_my_vacation_requests(uuid) from public, anon;
revoke all on function public.get_pending_vacation_requests(uuid) from public, anon;
revoke all on function public.get_group_members(uuid) from public, anon;
revoke all on function public.add_group_member(uuid, text, text) from public, anon;
revoke all on function public.remove_group_member(uuid, uuid) from public, anon;
revoke all on function public.request_vacation(uuid, date, date, text) from public, anon;
revoke all on function public.review_vacation(uuid, text) from public, anon;
revoke all on function public.withdraw_vacation(uuid) from public, anon;

grant execute on function public.claim_memberships() to authenticated;
grant execute on function public.create_group(text, text) to authenticated;
grant execute on function public.get_my_groups() to authenticated;
grant execute on function public.get_group_calendar(uuid, date, date) to authenticated;
grant execute on function public.get_my_vacation_requests(uuid) to authenticated;
grant execute on function public.get_pending_vacation_requests(uuid) to authenticated;
grant execute on function public.get_group_members(uuid) to authenticated;
grant execute on function public.add_group_member(uuid, text, text) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
grant execute on function public.request_vacation(uuid, date, date, text) to authenticated;
grant execute on function public.review_vacation(uuid, text) to authenticated;
grant execute on function public.withdraw_vacation(uuid) to authenticated;
