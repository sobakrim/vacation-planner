-- v0.5: carry positive and negative approved vacation balances into following years.
-- Existing installations: run once after 004_contract_proration_half_days.sql.
-- Pending requests are shown separately and never become part of a carry-over until approved.

create or replace function public._vacation_approved_days_for_year(
  p_group_id uuid,
  p_email text,
  p_year integer
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(public._vacation_charged_days(
    greatest(r.start_date, make_date(p_year, 1, 1)),
    least(r.end_date, make_date(p_year, 12, 31)),
    case when r.start_date < make_date(p_year, 1, 1) then 'full' else r.start_part end,
    case when r.end_date > make_date(p_year, 12, 31) then 'full' else r.end_part end,
    p_year
  )), 0)::numeric
  from public.vacation_requests r
  where r.group_id = p_group_id
    and lower(trim(r.requester_email)) = lower(trim(p_email))
    and r.status = 'approved'
    and r.start_date <= make_date(p_year, 12, 31)
    and r.end_date >= make_date(p_year, 1, 1)
$$;

create or replace function public._vacation_pending_days_for_year(
  p_group_id uuid,
  p_email text,
  p_year integer
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(public._vacation_charged_days(
    greatest(r.start_date, make_date(p_year, 1, 1)),
    least(r.end_date, make_date(p_year, 12, 31)),
    case when r.start_date < make_date(p_year, 1, 1) then 'full' else r.start_part end,
    case when r.end_date > make_date(p_year, 12, 31) then 'full' else r.end_part end,
    p_year
  )), 0)::numeric
  from public.vacation_requests r
  where r.group_id = p_group_id
    and lower(trim(r.requester_email)) = lower(trim(p_email))
    and r.status = 'pending'
    and r.start_date <= make_date(p_year, 12, 31)
    and r.end_date >= make_date(p_year, 1, 1)
$$;

create or replace function public._vacation_carryover(
  p_group_id uuid,
  p_email text,
  p_full_allowance integer,
  p_contract_start date,
  p_year integer
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_contract_year integer;
  v_year integer;
  v_carry numeric := 0;
begin
  if p_contract_start is null then
    return 0::numeric;
  end if;

  v_contract_year := extract(year from p_contract_start)::integer;
  if p_year <= v_contract_year then
    return 0::numeric;
  end if;

  for v_year in v_contract_year..(p_year - 1) loop
    v_carry := v_carry
      + coalesce(public._vacation_prorated_allowance(p_full_allowance, p_contract_start, v_year), 0)
      - public._vacation_approved_days_for_year(p_group_id, p_email, v_year);
  end loop;

  return v_carry;
end;
$$;

create or replace function public.get_my_vacation_balance_v3(
  p_group_id uuid,
  p_year integer
)
returns table (
  year integer,
  full_year_allowance_days integer,
  allowance_days numeric,
  carryover_days numeric,
  total_available_days numeric,
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
  v_allowance numeric;
  v_carry numeric := 0;
  v_used numeric := 0;
  v_pending numeric := 0;
  v_total numeric;
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

  v_allowance := public._vacation_prorated_allowance(
    v_member.annual_allowance_days,
    v_member.contract_start_date,
    p_year
  );

  if v_member.contract_start_date is not null then
    v_carry := public._vacation_carryover(
      p_group_id,
      v_member.email,
      v_member.annual_allowance_days,
      v_member.contract_start_date,
      p_year
    );
    v_used := public._vacation_approved_days_for_year(p_group_id, v_member.email, p_year);
    v_pending := public._vacation_pending_days_for_year(p_group_id, v_member.email, p_year);
    v_total := coalesce(v_allowance, 0) + v_carry;
  end if;

  return query select
    p_year,
    v_member.annual_allowance_days,
    v_allowance,
    v_carry,
    case when v_member.contract_start_date is null then null else v_total end,
    v_used,
    v_pending,
    case when v_member.contract_start_date is null then null else v_total - v_used end,
    v_member.contract_start_date;
end;
$$;

create or replace function public.get_group_vacation_balances_v3(
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
  carryover_days numeric,
  total_available_days numeric,
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
    public._vacation_prorated_allowance(m.annual_allowance_days, m.contract_start_date, p_year),
    case
      when m.contract_start_date is null then 0::numeric
      else public._vacation_carryover(
        p_group_id,
        m.email,
        m.annual_allowance_days,
        m.contract_start_date,
        p_year
      )
    end,
    case
      when m.contract_start_date is null then null
      else coalesce(public._vacation_prorated_allowance(m.annual_allowance_days, m.contract_start_date, p_year), 0)
        + public._vacation_carryover(
          p_group_id,
          m.email,
          m.annual_allowance_days,
          m.contract_start_date,
          p_year
        )
    end,
    case
      when m.contract_start_date is null then 0::numeric
      else public._vacation_approved_days_for_year(p_group_id, m.email, p_year)
    end,
    case
      when m.contract_start_date is null then 0::numeric
      else public._vacation_pending_days_for_year(p_group_id, m.email, p_year)
    end,
    case
      when m.contract_start_date is null then null
      else coalesce(public._vacation_prorated_allowance(m.annual_allowance_days, m.contract_start_date, p_year), 0)
        + public._vacation_carryover(
          p_group_id,
          m.email,
          m.annual_allowance_days,
          m.contract_start_date,
          p_year
        )
        - public._vacation_approved_days_for_year(p_group_id, m.email, p_year)
    end,
    m.contract_start_date
  from public.vacation_group_members m
  where m.group_id = p_group_id
  order by case when m.role = 'leader' then 0 else 1 end, lower(m.display_name);
end;
$$;

-- Keep accounting helpers private.
revoke all on function public._vacation_approved_days_for_year(uuid, text, integer) from public, anon, authenticated;
revoke all on function public._vacation_pending_days_for_year(uuid, text, integer) from public, anon, authenticated;
revoke all on function public._vacation_carryover(uuid, text, integer, date, integer) from public, anon, authenticated;

-- Browser RPC permissions.
revoke all on function public.get_my_vacation_balance_v3(uuid, integer) from public, anon;
revoke all on function public.get_group_vacation_balances_v3(uuid, integer) from public, anon;
grant execute on function public.get_my_vacation_balance_v3(uuid, integer) to authenticated;
grant execute on function public.get_group_vacation_balances_v3(uuid, integer) to authenticated;
