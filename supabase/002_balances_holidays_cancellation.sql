-- Vacation balances, Vaud public holidays, and self-cancellation.
-- Existing installations: run this file once after 001_init.sql.

-- Annual entitlement. The leader can change this per member. The default is
-- deliberately configurable in the UI; 25 is only the initial value.
alter table public.vacation_group_members
  add column if not exists annual_allowance_days integer not null default 25;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'vacation_group_members_allowance_check'
  ) then
    alter table public.vacation_group_members
      add constraint vacation_group_members_allowance_check
      check (annual_allowance_days between 0 and 366);
  end if;
end $$;

-- Preserve approved-request history when a user cancels future vacation.
alter table public.vacation_requests
  add column if not exists cancelled_at timestamptz;

alter table public.vacation_requests
  drop constraint if exists vacation_requests_status_check;
alter table public.vacation_requests
  add constraint vacation_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'cancelled'));

-- Official public holidays for the Canton of Vaud. These dates are seeded
-- through 2031 from the official Canton of Vaud holiday calendar.
create table if not exists public.vacation_public_holidays (
  holiday_date date primary key,
  name text not null check (char_length(trim(name)) between 1 and 160)
);

insert into public.vacation_public_holidays(holiday_date, name) values
  ('2026-01-01', 'New Year''s Day'),
  ('2026-01-02', '2 January public holiday'),
  ('2026-04-03', 'Good Friday'),
  ('2026-04-06', 'Easter Monday'),
  ('2026-05-14', 'Ascension Day'),
  ('2026-05-25', 'Whit Monday'),
  ('2026-08-01', 'Swiss National Day'),
  ('2026-09-21', 'Monday after Federal Fast'),
  ('2026-12-25', 'Christmas Day'),
  ('2027-01-01', 'New Year''s Day'),
  ('2027-01-02', '2 January public holiday'),
  ('2027-03-26', 'Good Friday'),
  ('2027-03-29', 'Easter Monday'),
  ('2027-05-06', 'Ascension Day'),
  ('2027-05-17', 'Whit Monday'),
  ('2027-08-01', 'Swiss National Day'),
  ('2027-09-20', 'Monday after Federal Fast'),
  ('2027-12-25', 'Christmas Day'),
  ('2028-01-01', 'New Year''s Day'),
  ('2028-01-02', '2 January public holiday'),
  ('2028-04-14', 'Good Friday'),
  ('2028-04-17', 'Easter Monday'),
  ('2028-05-25', 'Ascension Day'),
  ('2028-06-05', 'Whit Monday'),
  ('2028-08-01', 'Swiss National Day'),
  ('2028-09-18', 'Monday after Federal Fast'),
  ('2028-12-25', 'Christmas Day'),
  ('2029-01-01', 'New Year''s Day'),
  ('2029-01-02', '2 January public holiday'),
  ('2029-03-30', 'Good Friday'),
  ('2029-04-02', 'Easter Monday'),
  ('2029-05-10', 'Ascension Day'),
  ('2029-05-21', 'Whit Monday'),
  ('2029-08-01', 'Swiss National Day'),
  ('2029-09-17', 'Monday after Federal Fast'),
  ('2029-12-25', 'Christmas Day'),
  ('2030-01-01', 'New Year''s Day'),
  ('2030-01-02', '2 January public holiday'),
  ('2030-04-19', 'Good Friday'),
  ('2030-04-22', 'Easter Monday'),
  ('2030-05-30', 'Ascension Day'),
  ('2030-06-10', 'Whit Monday'),
  ('2030-08-01', 'Swiss National Day'),
  ('2030-09-16', 'Monday after Federal Fast'),
  ('2030-12-25', 'Christmas Day'),
  ('2031-01-01', 'New Year''s Day'),
  ('2031-01-02', '2 January public holiday'),
  ('2031-04-11', 'Good Friday'),
  ('2031-04-14', 'Easter Monday'),
  ('2031-05-22', 'Ascension Day'),
  ('2031-06-02', 'Whit Monday'),
  ('2031-08-01', 'Swiss National Day'),
  ('2031-09-22', 'Monday after Federal Fast'),
  ('2031-12-25', 'Christmas Day')
on conflict (holiday_date) do update set name = excluded.name;

alter table public.vacation_public_holidays enable row level security;
revoke all on table public.vacation_public_holidays from anon, authenticated;

create or replace function public._vacation_working_days(
  p_start_date date,
  p_end_date date,
  p_year integer default null
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_start_date is null or p_end_date is null or p_end_date < p_start_date then 0
    else coalesce((
      select count(*)::integer
      from generate_series(p_start_date::timestamp, p_end_date::timestamp, interval '1 day') d
      where extract(isodow from d) between 1 and 5
        and (p_year is null or extract(year from d)::integer = p_year)
        and not exists (
          select 1
          from public.vacation_public_holidays h
          where h.holiday_date = d::date
        )
    ), 0)
  end
$$;

create or replace function public.get_my_vacation_balance(
  p_group_id uuid,
  p_year integer
)
returns table (
  year integer,
  allowance_days integer,
  used_days integer,
  pending_days integer,
  remaining_days integer
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_member public.vacation_group_members%rowtype;
  v_used integer := 0;
  v_pending integer := 0;
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
      or lower(trim(m.email)) = public._vacation_current_email()
    )
  limit 1;

  if v_member.id is null then
    raise exception 'You are not a member of this group';
  end if;

  v_year_start := make_date(p_year, 1, 1);
  v_year_end := make_date(p_year, 12, 31);

  select coalesce(sum(public._vacation_working_days(
    greatest(r.start_date, v_year_start),
    least(r.end_date, v_year_end),
    p_year
  )), 0)::integer into v_used
  from public.vacation_requests r
  where r.group_id = p_group_id
    and lower(trim(r.requester_email)) = lower(trim(v_member.email))
    and r.status = 'approved'
    and r.start_date <= v_year_end
    and r.end_date >= v_year_start;

  select coalesce(sum(public._vacation_working_days(
    greatest(r.start_date, v_year_start),
    least(r.end_date, v_year_end),
    p_year
  )), 0)::integer into v_pending
  from public.vacation_requests r
  where r.group_id = p_group_id
    and lower(trim(r.requester_email)) = lower(trim(v_member.email))
    and r.status = 'pending'
    and r.start_date <= v_year_end
    and r.end_date >= v_year_start;

  return query select
    p_year,
    v_member.annual_allowance_days,
    v_used,
    v_pending,
    v_member.annual_allowance_days - v_used;
end;
$$;

create or replace function public.get_group_vacation_balances(
  p_group_id uuid,
  p_year integer
)
returns table (
  member_id uuid,
  display_name text,
  email text,
  role text,
  year integer,
  allowance_days integer,
  used_days integer,
  pending_days integer,
  remaining_days integer
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public._vacation_is_leader(p_group_id) then
    raise exception 'Only the group leader can see everyone''s vacation balances';
  end if;
  if p_year < 2000 or p_year > 2100 then
    raise exception 'Invalid balance year';
  end if;

  return query
  with member_days as (
    select
      m.id as member_id,
      m.display_name,
      m.email,
      m.role,
      m.annual_allowance_days as allowance_days,
      coalesce((
        select sum(public._vacation_working_days(
          greatest(r.start_date, make_date(p_year, 1, 1)),
          least(r.end_date, make_date(p_year, 12, 31)),
          p_year
        ))
        from public.vacation_requests r
        where r.group_id = p_group_id
          and lower(trim(r.requester_email)) = lower(trim(m.email))
          and r.status = 'approved'
          and r.start_date <= make_date(p_year, 12, 31)
          and r.end_date >= make_date(p_year, 1, 1)
      ), 0)::integer as used_days,
      coalesce((
        select sum(public._vacation_working_days(
          greatest(r.start_date, make_date(p_year, 1, 1)),
          least(r.end_date, make_date(p_year, 12, 31)),
          p_year
        ))
        from public.vacation_requests r
        where r.group_id = p_group_id
          and lower(trim(r.requester_email)) = lower(trim(m.email))
          and r.status = 'pending'
          and r.start_date <= make_date(p_year, 12, 31)
          and r.end_date >= make_date(p_year, 1, 1)
      ), 0)::integer as pending_days
    from public.vacation_group_members m
    where m.group_id = p_group_id
  )
  select
    d.member_id,
    d.display_name,
    d.email,
    d.role,
    p_year,
    d.allowance_days,
    d.used_days,
    d.pending_days,
    d.allowance_days - d.used_days
  from member_days d
  order by case when d.role = 'leader' then 0 else 1 end, lower(d.display_name);
end;
$$;

create or replace function public.set_member_allowance(
  p_group_id uuid,
  p_member_id uuid,
  p_days integer
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public._vacation_is_leader(p_group_id) then
    raise exception 'Only the group leader can change vacation allowances';
  end if;
  if p_days < 0 or p_days > 366 then
    raise exception 'Annual allowance must be between 0 and 366 days';
  end if;

  update public.vacation_group_members
  set annual_allowance_days = p_days
  where id = p_member_id and group_id = p_group_id;

  if not found then
    raise exception 'Group member not found';
  end if;
end;
$$;

create or replace function public.cancel_vacation(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  update public.vacation_requests
  set status = 'cancelled',
      cancelled_at = now()
  where id = p_request_id
    and requester_user_id = auth.uid()
    and status = 'approved'
    and start_date >= current_date;

  if not found then
    raise exception 'Only your own approved vacation that has not started can be cancelled';
  end if;
end;
$$;

-- Keep calculation helper private.
revoke all on function public._vacation_working_days(date, date, integer) from public, anon, authenticated;

-- New authenticated RPCs. The leader-only functions enforce the role again
-- inside the database, so hiding the UI is not the security boundary.
revoke all on function public.get_my_vacation_balance(uuid, integer) from public, anon;
revoke all on function public.get_group_vacation_balances(uuid, integer) from public, anon;
revoke all on function public.set_member_allowance(uuid, uuid, integer) from public, anon;
revoke all on function public.cancel_vacation(uuid) from public, anon;

grant execute on function public.get_my_vacation_balance(uuid, integer) to authenticated;
grant execute on function public.get_group_vacation_balances(uuid, integer) to authenticated;
grant execute on function public.set_member_allowance(uuid, uuid, integer) to authenticated;
grant execute on function public.cancel_vacation(uuid) to authenticated;
