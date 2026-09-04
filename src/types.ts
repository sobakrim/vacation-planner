export type Role = 'leader' | 'member'
export type VacationStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'
export type DayPart = 'full' | 'morning' | 'afternoon'

export interface GroupSummary {
  group_id: string
  group_name: string
  role: Role
  my_name: string
}

export interface VacationEntry {
  request_id: string
  requester_name: string
  start_date: string
  end_date: string
  start_part: DayPart
  end_part: DayPart
}

export interface VacationRequest {
  request_id: string
  requester_name: string
  requester_email: string
  start_date: string
  end_date: string
  start_part: DayPart
  end_part: DayPart
  note: string | null
  status: VacationStatus
  created_at: string
  decided_at: string | null
}

export interface GroupMember {
  member_id: string
  display_name: string
  email: string
  role: Role
  joined: boolean
  is_owner: boolean
  is_me: boolean
  contract_start_date: string | null
}

export interface VacationBalance {
  year: number
  full_year_allowance_days: number
  allowance_days: number | null
  used_days: number
  pending_days: number
  remaining_days: number | null
  contract_start_date: string | null
}

export interface MemberVacationBalance extends VacationBalance {
  member_id: string
  display_name: string
  email: string
  role: Role
}
