export type Role = 'leader' | 'member'
export type VacationStatus = 'pending' | 'approved' | 'rejected'

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
}

export interface VacationRequest {
  request_id: string
  requester_name: string
  requester_email: string
  start_date: string
  end_date: string
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
}
