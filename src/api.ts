import { supabase } from './supabase'
import type {
  DayPart,
  GroupMember,
  GroupSummary,
  MemberVacationBalance,
  VacationBalance,
  VacationEntry,
  VacationRequest,
} from './types'

function unwrap<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message)
  if (data == null) throw new Error('The server returned no data.')
  return data
}

export async function claimMemberships() {
  const { error } = await supabase.rpc('claim_memberships')
  if (error) throw new Error(error.message)
}

export async function getMyGroups(): Promise<GroupSummary[]> {
  const { data, error } = await supabase.rpc('get_my_groups')
  if (error) throw new Error(error.message)
  return (data ?? []) as GroupSummary[]
}

export async function createGroup(name: string, leaderName: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_group', {
    p_name: name,
    p_leader_name: leaderName,
  })
  return unwrap(data as string | null, error)
}

export async function getCalendar(
  groupId: string,
  fromDate: string,
  toDate: string,
): Promise<VacationEntry[]> {
  const { data, error } = await supabase.rpc('get_group_calendar_v2', {
    p_group_id: groupId,
    p_from: fromDate,
    p_to: toDate,
  })
  if (error) throw new Error(error.message)
  return (data ?? []) as VacationEntry[]
}

export async function getMyRequests(groupId: string): Promise<VacationRequest[]> {
  const { data, error } = await supabase.rpc('get_my_vacation_requests_v2', {
    p_group_id: groupId,
  })
  if (error) throw new Error(error.message)
  return (data ?? []) as VacationRequest[]
}

export async function getPendingRequests(groupId: string): Promise<VacationRequest[]> {
  const { data, error } = await supabase.rpc('get_pending_vacation_requests_v2', {
    p_group_id: groupId,
  })
  if (error) throw new Error(error.message)
  return (data ?? []) as VacationRequest[]
}

export async function getGroupMembers(groupId: string): Promise<GroupMember[]> {
  const { data, error } = await supabase.rpc('get_group_members_v3', {
    p_group_id: groupId,
  })
  if (error) throw new Error(error.message)
  return (data ?? []) as GroupMember[]
}

export async function getMyVacationBalance(groupId: string, year: number): Promise<VacationBalance> {
  const { data, error } = await supabase.rpc('get_my_vacation_balance_v2', {
    p_group_id: groupId,
    p_year: year,
  })
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('The server returned no vacation balance.')
  return row as VacationBalance
}

export async function getGroupVacationBalances(groupId: string, year: number): Promise<MemberVacationBalance[]> {
  const { data, error } = await supabase.rpc('get_group_vacation_balances_v2', {
    p_group_id: groupId,
    p_year: year,
  })
  if (error) throw new Error(error.message)
  return (data ?? []) as MemberVacationBalance[]
}

export async function setMemberAllowance(groupId: string, memberId: string, days: number) {
  const { error } = await supabase.rpc('set_member_allowance', {
    p_group_id: groupId,
    p_member_id: memberId,
    p_days: days,
  })
  if (error) throw new Error(error.message)
}

export async function setMemberContractStart(groupId: string, memberId: string, contractStartDate: string) {
  const { error } = await supabase.rpc('set_member_contract_start', {
    p_group_id: groupId,
    p_member_id: memberId,
    p_contract_start_date: contractStartDate,
  })
  if (error) throw new Error(error.message)
}

export async function setMyContractStart(groupId: string, contractStartDate: string) {
  const { error } = await supabase.rpc('set_my_contract_start', {
    p_group_id: groupId,
    p_contract_start_date: contractStartDate,
  })
  if (error) throw new Error(error.message)
}

export async function addGroupMember(
  groupId: string,
  email: string,
  name: string,
  role: 'member' | 'leader' = 'member',
  contractStartDate: string | null = null,
) {
  const { error } = await supabase.rpc('add_group_member_v3', {
    p_group_id: groupId,
    p_email: email,
    p_display_name: name,
    p_role: role,
    p_contract_start_date: contractStartDate || null,
  })
  if (error) throw new Error(error.message)
}

export async function promoteGroupLeader(groupId: string, memberId: string) {
  const { error } = await supabase.rpc('promote_group_leader', {
    p_group_id: groupId,
    p_member_id: memberId,
  })
  if (error) throw new Error(error.message)
}

export async function demoteGroupLeader(groupId: string, memberId: string) {
  const { error } = await supabase.rpc('demote_group_leader', {
    p_group_id: groupId,
    p_member_id: memberId,
  })
  if (error) throw new Error(error.message)
}

export async function removeGroupMember(groupId: string, memberId: string) {
  const { error } = await supabase.rpc('remove_group_member', {
    p_group_id: groupId,
    p_member_id: memberId,
  })
  if (error) throw new Error(error.message)
}

export async function requestVacation(
  groupId: string,
  startDate: string,
  endDate: string,
  startPart: DayPart,
  endPart: DayPart,
  note: string,
): Promise<{ request_id: string; status: 'pending' | 'approved' | 'rejected' }> {
  const { data, error } = await supabase.rpc('request_vacation_v2', {
    p_group_id: groupId,
    p_start_date: startDate,
    p_end_date: endDate,
    p_start_part: startPart,
    p_end_part: endPart,
    p_note: note || null,
  })
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('The server returned no vacation request.')
  return row as { request_id: string; status: 'pending' | 'approved' | 'rejected' }
}

export async function reviewVacation(requestId: string, decision: 'approved' | 'rejected') {
  const { error } = await supabase.rpc('review_vacation', {
    p_request_id: requestId,
    p_decision: decision,
  })
  if (error) throw new Error(error.message)
}

export async function withdrawVacation(requestId: string) {
  const { error } = await supabase.rpc('withdraw_vacation', {
    p_request_id: requestId,
  })
  if (error) throw new Error(error.message)
}

export async function cancelVacation(requestId: string) {
  const { error } = await supabase.rpc('cancel_vacation', {
    p_request_id: requestId,
  })
  if (error) throw new Error(error.message)
}
