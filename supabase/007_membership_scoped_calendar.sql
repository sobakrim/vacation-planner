-- v0.6.2: keep the shared calendar strictly scoped to current group members.
-- Run after 006_no_approval_member_invites.sql.
--
-- This migration also makes member deletion clean up that person's active
-- vacation entries in the group, and removes already-orphaned legacy entries
-- left behind by members who were deleted before this migration existed.

-- Clean up old approved vacation rows whose requester is no longer a current
-- member of that group. Keep the row for history, but mark it cancelled so it
-- no longer contributes to balances or the shared calendar.
update public.vacation_requests r
set status = 'cancelled',
    cancelled_at = coalesce(r.cancelled_at, now())
where r.status in ('approved', 'pending')
  and not exists (
    select 1
    from public.vacation_group_members m
    where m.group_id = r.group_id
      and (
        (m.user_id is not null and m.user_id = r.requester_user_id)
        or lower(trim(m.email)) = lower(trim(r.requester_email))
      )
  );

-- The group calendar now requires both:
--   1. the vacation belongs to the selected group, and
--   2. the requester is still a current member of that same group.
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
  select
    r.id,
    r.requester_name,
    r.start_date,
    r.end_date,
    r.start_part,
    r.end_part
  from public.vacation_requests r
  where r.group_id = p_group_id
    and r.status = 'approved'
    and r.start_date <= p_to
    and r.end_date >= p_from
    and exists (
      select 1
      from public.vacation_group_members m
      where m.group_id = r.group_id
        and (
          (m.user_id is not null and m.user_id = r.requester_user_id)
          or lower(trim(m.email)) = lower(trim(r.requester_email))
        )
    )
  order by r.start_date, r.requester_name;
end;
$$;

-- Group administrators can delete ordinary members. The original group owner
-- may also delete a promoted administrator. A promoted administrator cannot
-- delete another administrator, and the original owner cannot be deleted.
-- Active vacation rows for the deleted person are cancelled at the same time.
create or replace function public.remove_group_member(
  p_group_id uuid,
  p_member_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_member public.vacation_group_members%rowtype;
  v_owner_user_id uuid;
begin
  if not public._vacation_is_leader(p_group_id) then
    raise exception 'Only a group administrator can delete members';
  end if;

  select m.*
  into v_member
  from public.vacation_group_members m
  where m.id = p_member_id
    and m.group_id = p_group_id;

  if v_member.id is null then
    raise exception 'Member not found';
  end if;

  select g.leader_user_id
  into v_owner_user_id
  from public.vacation_groups g
  where g.id = p_group_id;

  if v_member.user_id is not null and v_member.user_id = v_owner_user_id then
    raise exception 'The original group administrator cannot be deleted';
  end if;

  if v_member.role = 'leader' and not public._vacation_is_owner(p_group_id) then
    raise exception 'Only the original group administrator can delete another administrator';
  end if;

  update public.vacation_requests r
  set status = 'cancelled',
      cancelled_at = coalesce(r.cancelled_at, now())
  where r.group_id = p_group_id
    and r.status in ('approved', 'pending')
    and (
      (v_member.user_id is not null and r.requester_user_id = v_member.user_id)
      or lower(trim(r.requester_email)) = lower(trim(v_member.email))
    );

  delete from public.vacation_group_members
  where id = p_member_id
    and group_id = p_group_id;
end;
$$;

revoke all on function public.get_group_calendar_v2(uuid, date, date) from public, anon;
revoke all on function public.remove_group_member(uuid, uuid) from public, anon;
grant execute on function public.get_group_calendar_v2(uuid, date, date) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
