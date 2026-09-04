-- v0.4: contract start dates, prorated balances, and half-day vacation.
-- Existing installations: run once after 003_accounts_multi_leaders.sql.

alter table public.vacation_group_members
  add column if not exists contract_start_date date;

alter table public.vacation_requests
  add column if not exists start_part text not null default 'full',
  add column if not exists end_part text not null default 'full';

alter table public.vacation_requests
  drop constraint if exists vacation_requests_start_part_check;
alter table public.vacation_requests
  add constraint vacation_requests_start_part_check
  check (start_part in ('full', 'morning', 'afternoon'));

alter table public.vacation_requests
  drop constraint if exists vacation_requests_end_part_check;
alter table public.vacation_requests
  add constraint vacation_requests_end_part_check
  check (end_part in ('full', 'morning', 'afternoon'));

alter table public.vacation_requests
  drop constraint if exists vacation_requests_parts_shape_check;
alter table public.vacation_requests
  add constraint vacation_requests_parts_shape_check
  check (
    (start_date = end_date and start_part = end_part)
    or
    (start_date < end_date and start_part in ('full', 'afternoon') and end_part in ('full', 'morning'))
  );

create or replace function public._vacation_prorated_allowance(
  p_full_allowance integer,
  p_contract_start date,
  p_year integer
)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  v_year_start date := make_date(p_year, 1, 1);
  v_year_end date := make_date(p_year, 12, 31);
  v_active_days integer;
  v_year_days integer;
  v_value numeric;
begin
  if p_contract_start is null then
    return null;
  end if;
  if p_contract_start > v_year_end then
    return 0::numeric;
  end if;
  if p_contract_start <= v_year_start then
    return p_full_allowance::numeric;
  end if;

  v_active_days := v_year_end - p_contract_start + 1;
  v_year_days := v_year_end - v_year_start + 1;
  v_value := p_full_allowance::numeric * v_active_days::numeric / v_year_days::numeric;

  -- Keep balances practical for half-day booking: round to the nearest 0.5 day.
  return round(v_value * 2) / 2;
end;
$$;

create or replace function public._vacation_charged_days(
  p_start_date date,
  p_end_date date,
  p_start_part text default 'full',
  p_end_part text default 'full',
  p_year integer default null
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_start_date is null or p_end_date is null or p_end_date < p_start_date then 0::numeric
    else coalesce((
      select sum(
        case
          when extract(isodow from d) not between 1 and 5 then 0::numeric
          when exists (
            select 1 from public.vacation_public_holidays h where h.holiday_date = d::date
          ) then 0::numeric
          when p_year is not null and extract(year from d)::integer <> p_year then 0::numeric
          when p_start_date = p_end_date and p_start_part in ('morning', 'afternoon') then 0.5::numeric
          when d::date = p_start_date and p_start_part = 'afternoon' then 0.5::numeric
          when d::date = p_end_date and p_end_part = 'morning' then 0.5::numeric
          else 1::numeric
        end
      )
      from generate_series(p_start_date::timestamp, p_end_date::timestamp, interval '1 day') d
    ), 0::numeric)
  end
$$;

create or replace function public._vacation_interval_start(p_date date, p_part text)
returns timestamp
language sql
immutable
set search_path = public
as $$
  select p_date::timestamp + case when p_part = 'afternoon' then interval '12 hours' else interval '0 hours' end
$$;

create or replace function public._vacation_interval_end(
  p_start_date date,
  p_end_date date,
  p_start_part text,
  p_end_part text
)
returns timestamp
language sql
immutable
set search_path = public
as $$
  select case
    when p_start_date = p_end_date and p_start_part = 'morning'
      then p_end_date::timestamp + interval '12 hours'
    when p_end_date > p_start_date and p_end_part = 'morning'
      then p_end_date::timestamp + interval '12 hours'
    else p_end_date::timestamp + interval '1 day'
  end
$$;

create or replace function public.get_my_vacation_balance_v2(
  p_group_id uuid,
  p_year integer
)
returns table (
  year integer,
  full_year_allowance_days integer,
  allowance_days numeric,
  used_days numeric,
  pending_days numeric,
  remaining_days numeric,
  contract_start_date date
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_member public.vacation_group_members%rowtype;
  v_used numeric := 0;
  v_pending numeric := 0;
  v_allowance numeric;
  v_year_start date;
  v_year_end date;
begin
  if p_year < 2000 or p_year > 2100 then
    raise exception 'Invalid balance year';
  end if;

  select m.* into v_member
  from public.vacation_group_members m
  where m.group_id = p_group_id
    and (
      m.user_id = auth.uid()
      or (m.user_id is null and lower(trim(m.email)) = public._vacation_current_email())
    )
  limit 1;

  if v_member.id is null then
    raise exception 'You are not a member of this group';
  end if;

  v_year_start := make_date(p_year, 1, 1);
  v_year_end := make_date(p_year, 12, 31);
  v_allowance := public._vacation_prorated_allowance(v_member.annual_allowance_days, v_member.contract_start_date, p_year);

  select coalesce(sum(public._vacation_charged_days(
    greatest(r.start_date, v_year_start),
    least(r.end_date, v_year_end),
    case when r.start_date < v_year_start then 'full' else r.start_part end,
    case when r.end_date > v_year_end then 'full' else r.end_part end,
    p_year
  )), 0)::numeric into v_used
  from public.vacation_requests r
  where r.group_id = p_group_id
    and lower(trim(r.requester_email)) = lower(trim(v_member.email))
    and r.status = 'approved'
    and r.start_date <= v_year_end
    and r.end_date >= v_year_start;

  select coalesce(sum(public._vacation_charged_days(
    greatest(r.start_date, v_year_start),
    least(r.end_date, v_year_end),
    case when r.start_date < v_year_start then 'full' else r.start_part end,
    case when r.end_date > v_year_end then 'full' else r.end_part end,
    p_year
  )), 0)::numeric into v_pending
  from public.vacation_requests r
  where r.group_id = p_group_id
    and lower(trim(r.requester_email)) = lower(trim(v_member.email))
    and r.status = 'pending'
    and r.start_date <= v_year_end
    and r.end_date >= v_year_start;

  return query select
    p_year,
    v_member.annual_allowance_days,
    v_allowance,
    v_used,
    v_pending,
    case when v_allowance is null then null else v_allowance - v_used end,
    v_member.contract_start_date;
end;
$$;

create or replace function public.get_group_vacation_balances_v2(
  p_group_id uuid,
  p_year integer
)
returns table (
  member_id uuid,
  display_name text,
  email text,
  role text,
  year integer,
  full_year_allowance_days integer,
  allowance_days numeric,
  used_days numeric,
  pending_days numeric,
  remaining_days numeric,
  contract_start_date date
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public._vacation_is_leader(p_group_id) then
    raise exception 'Only a group leader can see everyone''s vacation balances';
  end if;
  if p_year < 2000 or p_year > 2100 then
    raise exception 'Invalid balance year';
  end if;

  return query
  select
    m.id,
    m.display_name,
    m.email,
    m.role,
    p_year,
    m.annual_allowance_days,
    public._vacation_prorated_allowance(m.annual_allowance_days, m.contract_start_date, p_year) as allowance_days,
    coalesce((
      select sum(public._vacation_charged_days(
        greatest(r.start_date, make_date(p_year, 1, 1)),
        least(r.end_date, make_date(p_year, 12, 31)),
        case when r.start_date < make_date(p_year, 1, 1) then 'full' else r.start_part end,
        case when r.end_date > make_date(p_year, 12, 31) then 'full' else r.end_part end,
        p_year
      ))
      from public.vacation_requests r
      where r.group_id = p_group_id
        and lower(trim(r.requester_email)) = lower(trim(m.email))
        and r.status = 'approved'
        and r.start_date <= make_date(p_year, 12, 31)
        and r.end_date >= make_date(p_year, 1, 1)
    ), 0)::numeric as used_days,
    coalesce((
      select sum(public._vacation_charged_days(
        greatest(r.start_date, make_date(p_year, 1, 1)),
        least(r.end_date, make_date(p_year, 12, 31)),
        case when r.start_date < make_date(p_year, 1, 1) then 'full' else r.start_part end,
        case when r.end_date > make_date(p_year, 12, 31) then 'full' else r.end_part end,
        p_year
      ))
      from public.vacation_requests r
      where r.group_id = p_group_id
        and lower(trim(r.requester_email)) = lower(trim(m.email))
        and r.status = 'pending'
        and r.start_date <= make_date(p_year, 12, 31)
        and r.end_date >= make_date(p_year, 1, 1)
    ), 0)::numeric as pending_days,
    case
      when m.contract_start_date is null then null
      else public._vacation_prorated_allowance(m.annual_allowance_days, m.contract_start_date, p_year)
        - coalesce((
          select sum(public._vacation_charged_days(
            greatest(r.start_date, make_date(p_year, 1, 1)),
            least(r.end_date, make_date(p_year, 12, 31)),
            case when r.start_date < make_date(p_year, 1, 1) then 'full' else r.start_part end,
            case when r.end_date > make_date(p_year, 12, 31) then 'full' else r.end_part end,
            p_year
          ))
          from public.vacation_requests r
          where r.group_id = p_group_id
            and lower(trim(r.requester_email)) = lower(trim(m.email))
            and r.status = 'approved'
            and r.start_date <= make_date(p_year, 12, 31)
            and r.end_date >= make_date(p_year, 1, 1)
        ), 0)::numeric
    end as remaining_days,
    m.contract_start_date
  from public.vacation_group_members m
  where m.group_id = p_group_id
  order by case when m.role = 'leader' then 0 else 1 end, lower(m.display_name);
end;
$$;

create or replace function public.get_group_members_v3(p_group_id uuid)
returns table (
  member_id uuid,
  display_name text,
  email text,
  role text,
  joined boolean,
  is_owner boolean,
  is_me boolean,
  contract_start_date date
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
    ),
    m.contract_start_date
  from public.vacation_group_members m
  join public.vacation_groups g on g.id = m.group_id
  where m.group_id = p_group_id
  order by case when m.user_id = g.leader_user_id then 0 when m.role = 'leader' then 1 else 2 end, lower(m.display_name);
end;
$$;

create or replace function public.add_group_member_v3(
  p_group_id uuid,
  p_email text,
  p_display_name text,
  p_role text default 'member',
  p_contract_start_date date default null
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
  if p_contract_start_date is not null and (p_contract_start_date < date '1900-01-01' or p_contract_start_date > date '2100-12-31') then
    raise exception 'Invalid contract start date';
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

  insert into public.vacation_group_members(group_id, user_id, email, display_name, role, contract_start_date)
  values (p_group_id, v_user_id, v_email, v_name, v_role, p_contract_start_date)
  returning id into v_member_id;

  return v_member_id;
end;
$$;

create or replace function public.set_member_contract_start(
  p_group_id uuid,
  p_member_id uuid,
  p_contract_start_date date
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public._vacation_is_leader(p_group_id) then
    raise exception 'Only a group leader can change another member''s contract start date';
  end if;
  if p_contract_start_date is null or p_contract_start_date < date '1900-01-01' or p_contract_start_date > date '2100-12-31' then
    raise exception 'Enter a valid contract start date';
  end if;

  update public.vacation_group_members
  set contract_start_date = p_contract_start_date
  where id = p_member_id and group_id = p_group_id;

  if not found then
    raise exception 'Group member not found';
  end if;
end;
$$;

create or replace function public.set_my_contract_start(
  p_group_id uuid,
  p_contract_start_date date
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_contract_start_date is null or p_contract_start_date < date '1900-01-01' or p_contract_start_date > date '2100-12-31' then
    raise exception 'Enter a valid contract start date';
  end if;

  update public.vacation_group_members
  set contract_start_date = p_contract_start_date,
      user_id = coalesce(user_id, auth.uid())
  where group_id = p_group_id
    and (
      user_id = auth.uid()
      or (user_id is null and lower(trim(email)) = public._vacation_current_email())
    );

  if not found then
    raise exception 'You are not a member of this group';
  end if;
end;
$$;

create or replace function public.get_group_calendar_v2(
  p_group_id uuid,
  p_from date,
  p_to date
)
returns table (
  request_id uuid,
  requester_name text,
  start_date date,
  end_date date,
  start_part text,
  end_part text
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
  select r.id, r.requester_name, r.start_date, r.end_date, r.start_part, r.end_part
  from public.vacation_requests r
  where r.group_id = p_group_id
    and r.status = 'approved'
    and r.start_date <= p_to
    and r.end_date >= p_from
  order by r.start_date, r.requester_name;
end;
$$;

create or replace function public.get_my_vacation_requests_v2(p_group_id uuid)
returns table (
  request_id uuid,
  requester_name text,
  requester_email text,
  start_date date,
  end_date date,
  start_part text,
  end_part text,
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
         r.start_part, r.end_part, r.note, r.status, r.created_at, r.decided_at
  from public.vacation_requests r
  where r.group_id = p_group_id
    and r.requester_user_id = auth.uid()
  order by r.start_date desc, r.created_at desc;
end;
$$;

create or replace function public.get_pending_vacation_requests_v2(p_group_id uuid)
returns table (
  request_id uuid,
  requester_name text,
  requester_email text,
  start_date date,
  end_date date,
  start_part text,
  end_part text,
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
    raise exception 'Only a group leader can see pending requests';
  end if;

  return query
  select r.id, r.requester_name, r.requester_email, r.start_date, r.end_date,
         r.start_part, r.end_part, r.note, r.status, r.created_at, r.decided_at
  from public.vacation_requests r
  where r.group_id = p_group_id
    and r.status = 'pending'
  order by r.created_at asc;
end;
$$;

create or replace function public.request_vacation_v2(
  p_group_id uuid,
  p_start_date date,
  p_end_date date,
  p_start_part text default 'full',
  p_end_part text default 'full',
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
  v_start_part text := lower(trim(coalesce(p_start_part, 'full')));
  v_end_part text := lower(trim(coalesce(p_end_part, 'full')));
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
  if v_start_part not in ('full', 'morning', 'afternoon') or v_end_part not in ('full', 'morning', 'afternoon') then
    raise exception 'Invalid half-day selection';
  end if;
  if p_start_date = p_end_date and v_start_part <> v_end_part then
    raise exception 'For a one-day request, choose the same day part for start and end';
  end if;
  if p_start_date < p_end_date and (v_start_part not in ('full', 'afternoon') or v_end_part not in ('full', 'morning')) then
    raise exception 'A multi-day request may start in the afternoon and/or end in the morning';
  end if;
  if public._vacation_charged_days(p_start_date, p_end_date, v_start_part, v_end_part, null) <= 0 then
    raise exception 'This request contains no chargeable working time';
  end if;

  select m.* into v_member
  from public.vacation_group_members m
  where m.group_id = p_group_id
    and (
      m.user_id = auth.uid()
      or (m.user_id is null and lower(trim(m.email)) = public._vacation_current_email())
    )
  limit 1;

  if v_member.id is null then
    raise exception 'You are not a member of this group';
  end if;
  if v_member.contract_start_date is null then
    raise exception 'Set your contract start date before requesting vacation';
  end if;
  if p_start_date < v_member.contract_start_date then
    raise exception 'Vacation cannot start before your contract start date';
  end if;

  if v_member.user_id is null then
    update public.vacation_group_members set user_id = auth.uid() where id = v_member.id;
  elsif v_member.user_id <> auth.uid() then
    raise exception 'This group membership belongs to another account';
  end if;

  if exists (
    select 1
    from public.vacation_requests r
    where r.group_id = p_group_id
      and r.requester_user_id = auth.uid()
      and r.status in ('pending', 'approved')
      and public._vacation_interval_start(r.start_date, r.start_part)
          < public._vacation_interval_end(p_start_date, p_end_date, v_start_part, v_end_part)
      and public._vacation_interval_start(p_start_date, v_start_part)
          < public._vacation_interval_end(r.start_date, r.end_date, r.start_part, r.end_part)
  ) then
    raise exception 'You already have a pending or approved vacation overlapping this time';
  end if;

  v_status := case when public._vacation_is_leader(p_group_id) then 'approved' else 'pending' end;

  insert into public.vacation_requests(
    group_id, requester_user_id, requester_email, requester_name,
    start_date, end_date, start_part, end_part, note, status, decided_at, decided_by
  ) values (
    p_group_id, auth.uid(), v_member.email, v_member.display_name,
    p_start_date, p_end_date, v_start_part, v_end_part, v_note, v_status,
    case when v_status = 'approved' then now() else null end,
    case when v_status = 'approved' then auth.uid() else null end
  ) returning id into v_request_id;

  return query select v_request_id, v_status;
end;
$$;

-- Old request RPC is revoked so contract-date and half-day validation cannot be bypassed.
revoke execute on function public.request_vacation(uuid, date, date, text) from authenticated;

-- Keep helpers private.
revoke all on function public._vacation_prorated_allowance(integer, date, integer) from public, anon, authenticated;
revoke all on function public._vacation_charged_days(date, date, text, text, integer) from public, anon, authenticated;
revoke all on function public._vacation_interval_start(date, text) from public, anon, authenticated;
revoke all on function public._vacation_interval_end(date, date, text, text) from public, anon, authenticated;

-- Browser RPC permissions.
revoke all on function public.get_my_vacation_balance_v2(uuid, integer) from public, anon;
revoke all on function public.get_group_vacation_balances_v2(uuid, integer) from public, anon;
revoke all on function public.get_group_members_v3(uuid) from public, anon;
revoke all on function public.add_group_member_v3(uuid, text, text, text, date) from public, anon;
revoke all on function public.set_member_contract_start(uuid, uuid, date) from public, anon;
revoke all on function public.set_my_contract_start(uuid, date) from public, anon;
revoke all on function public.get_group_calendar_v2(uuid, date, date) from public, anon;
revoke all on function public.get_my_vacation_requests_v2(uuid) from public, anon;
revoke all on function public.get_pending_vacation_requests_v2(uuid) from public, anon;
revoke all on function public.request_vacation_v2(uuid, date, date, text, text, text) from public, anon;

grant execute on function public.get_my_vacation_balance_v2(uuid, integer) to authenticated;
grant execute on function public.get_group_vacation_balances_v2(uuid, integer) to authenticated;
grant execute on function public.get_group_members_v3(uuid) to authenticated;
grant execute on function public.add_group_member_v3(uuid, text, text, text, date) to authenticated;
grant execute on function public.set_member_contract_start(uuid, uuid, date) to authenticated;
grant execute on function public.set_my_contract_start(uuid, date) to authenticated;
grant execute on function public.get_group_calendar_v2(uuid, date, date) to authenticated;
grant execute on function public.get_my_vacation_requests_v2(uuid) to authenticated;
grant execute on function public.get_pending_vacation_requests_v2(uuid) to authenticated;
grant execute on function public.request_vacation_v2(uuid, date, date, text, text, text) to authenticated;
