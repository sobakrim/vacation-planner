import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  addGroupMember,
  claimMemberships,
  createGroup,
  getCalendar,
  getGroupMembers,
  getMyGroups,
  getMyRequests,
  getPendingRequests,
  removeGroupMember,
  requestVacation,
  reviewVacation,
  withdrawVacation,
} from './api'
import {
  addDays,
  daysInclusive,
  endOfCalendarMonth,
  entriesForDate,
  formatRange,
  isoDate,
  startOfCalendarMonth,
} from './calendar'
import { supabase } from './supabase'
import type { GroupMember, GroupSummary, VacationEntry, VacationRequest } from './types'

type Tab = 'calendar' | 'mine' | 'approvals' | 'members'
type Notice = { type: 'success' | 'warning' | 'error'; text: string } | null

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthReady(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  if (!authReady) return <LoadingScreen label="Opening vacation planner…" />
  if (!session) return <LoginScreen />
  return <AuthenticatedApp session={session} />
}

function LoginScreen() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function signIn(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}`
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo },
    })
    setBusy(false)
    if (authError) {
      setError(authError.message)
      return
    }
    setSent(true)
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand-mark">V</div>
        <p className="eyebrow">GROUP VACATION</p>
        <h1>One calendar for the whole team.</h1>
        <p className="lead">
          Sign in by email, request time off, and keep approved vacations visible to everyone in the group.
        </p>
        {sent ? (
          <div className="message success">
            <strong>Check your inbox.</strong>
            <span>We sent a secure sign-in link to {email}.</span>
          </div>
        ) : (
          <form onSubmit={signIn} className="stack-form">
            <label>
              Work email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.org"
                autoComplete="email"
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? 'Sending…' : 'Email me a sign-in link'}
            </button>
            {error && <p className="form-error">{error}</p>}
          </form>
        )}
        <p className="microcopy">No password. Access is tied to the email address registered in your group.</p>
      </section>
    </main>
  )
}

function AuthenticatedApp({ session }: { session: Session }) {
  const [groups, setGroups] = useState<GroupSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice>(null)

  async function refreshGroups(preferId?: string) {
    await claimMemberships()
    const nextGroups = await getMyGroups()
    setGroups(nextGroups)
    setSelectedId((current) => {
      const candidate = preferId ?? current
      if (candidate && nextGroups.some((g) => g.group_id === candidate)) return candidate
      return nextGroups[0]?.group_id ?? null
    })
  }

  useEffect(() => {
    refreshGroups()
      .catch((error) => setNotice({ type: 'error', text: error.message }))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingScreen label="Loading your groups…" />

  const selected = groups.find((group) => group.group_id === selectedId) ?? null

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <div className="brand-mark small">V</div>
          <div>
            <strong>Group Vacation</strong>
            <span>{session.user.email}</span>
          </div>
        </div>
        <div className="topbar-actions">
          {groups.length > 1 && (
            <select value={selectedId ?? ''} onChange={(e) => setSelectedId(e.target.value)}>
              {groups.map((group) => (
                <option value={group.group_id} key={group.group_id}>
                  {group.group_name}
                </option>
              ))}
            </select>
          )}
          <button className="ghost" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </header>

      {notice && <Toast notice={notice} onClose={() => setNotice(null)} />}

      {!selected ? (
        <CreateGroupScreen
          email={session.user.email ?? ''}
          onCreated={async (groupId) => {
            await refreshGroups(groupId)
            setNotice({ type: 'success', text: 'Group created. Add the team members next.' })
          }}
        />
      ) : (
        <GroupDashboard
          key={selected.group_id}
          group={selected}
          onCreateAnother={async () => {
            setSelectedId(null)
            setGroups([])
          }}
          setNotice={setNotice}
        />
      )}
    </div>
  )
}

function CreateGroupScreen({
  email,
  onCreated,
}: {
  email: string
  onCreated: (groupId: string) => Promise<void>
}) {
  const [groupName, setGroupName] = useState('')
  const [leaderName, setLeaderName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const id = await createGroup(groupName, leaderName)
      await onCreated(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the group.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="empty-shell">
      <section className="create-card">
        <p className="eyebrow">FIRST SETUP</p>
        <h1>Create your vacation group</h1>
        <p className="lead compact">
          You will be the group leader. Members you add will see this group automatically when they sign in with the same email address.
        </p>
        <form onSubmit={submit} className="stack-form two-column-form">
          <label>
            Group name
            <input required value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="ECCE team" />
          </label>
          <label>
            Your display name
            <input required value={leaderName} onChange={(e) => setLeaderName(e.target.value)} placeholder="Said" />
          </label>
          <div className="identity-line">Leader account: <strong>{email}</strong></div>
          <button className="primary" disabled={busy}>{busy ? 'Creating…' : 'Create group'}</button>
          {error && <p className="form-error">{error}</p>}
        </form>
      </section>
    </main>
  )
}

function GroupDashboard({
  group,
  setNotice,
}: {
  group: GroupSummary
  onCreateAnother: () => Promise<void>
  setNotice: (notice: Notice) => void
}) {
  const [tab, setTab] = useState<Tab>('calendar')
  const [pendingCount, setPendingCount] = useState(0)

  async function updatePendingCount() {
    if (group.role !== 'leader') return
    try {
      const pending = await getPendingRequests(group.group_id)
      setPendingCount(pending.length)
    } catch {
      // The active tab will surface a detailed error if needed.
    }
  }

  useEffect(() => {
    updatePendingCount()
  }, [group.group_id])

  return (
    <main className="dashboard">
      <aside className="sidebar">
        <div className="group-heading">
          <p className="eyebrow">YOUR GROUP</p>
          <h2>{group.group_name}</h2>
          <span className={`role-pill ${group.role}`}>{group.role === 'leader' ? 'Group leader' : 'Member'}</span>
        </div>
        <nav>
          <NavButton active={tab === 'calendar'} onClick={() => setTab('calendar')} icon="▦">Calendar</NavButton>
          <NavButton active={tab === 'mine'} onClick={() => setTab('mine')} icon="○">My vacation</NavButton>
          {group.role === 'leader' && (
            <NavButton active={tab === 'approvals'} onClick={() => setTab('approvals')} icon="✓" badge={pendingCount}>
              Approvals
            </NavButton>
          )}
          {group.role === 'leader' && (
            <NavButton active={tab === 'members'} onClick={() => setTab('members')} icon="＋">Members</NavButton>
          )}
        </nav>
        <div className="sidebar-note">
          <strong>{group.my_name}</strong>
          <span>{group.role === 'leader' ? 'Your own vacation is approved immediately.' : 'Your requests need leader approval.'}</span>
        </div>
      </aside>

      <section className="content">
        {tab === 'calendar' && <CalendarView group={group} setNotice={setNotice} onRequestSaved={updatePendingCount} />}
        {tab === 'mine' && <MyVacationView group={group} setNotice={setNotice} onChanged={updatePendingCount} />}
        {tab === 'approvals' && group.role === 'leader' && (
          <ApprovalsView group={group} setNotice={setNotice} onChanged={updatePendingCount} />
        )}
        {tab === 'members' && group.role === 'leader' && <MembersView group={group} setNotice={setNotice} />}
      </section>
    </main>
  )
}

function NavButton({
  active,
  onClick,
  icon,
  badge,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: string
  badge?: number
  children: React.ReactNode
}) {
  return (
    <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="nav-icon">{icon}</span>
      <span>{children}</span>
      {!!badge && <span className="badge">{badge}</span>}
    </button>
  )
}

function CalendarView({
  group,
  setNotice,
  onRequestSaved,
}: {
  group: GroupSummary
  setNotice: (notice: Notice) => void
  onRequestSaved: () => Promise<void>
}) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [entries, setEntries] = useState<VacationEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const from = isoDate(startOfCalendarMonth(month))
  const to = isoDate(endOfCalendarMonth(month))

  async function load() {
    setLoading(true)
    try {
      setEntries(await getCalendar(group.group_id, from, to))
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not load the calendar.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [group.group_id, from, to])

  const days = useMemo(() => {
    const first = startOfCalendarMonth(month)
    return Array.from({ length: 42 }, (_, index) => addDays(first, index))
  }, [month])

  return (
    <>
      <div className="content-header">
        <div>
          <p className="eyebrow">TEAM AGENDA</p>
          <h1>Vacation calendar</h1>
          <p>Only approved vacation is shown here.</p>
        </div>
        <button className="primary" onClick={() => setShowForm(true)}>+ Request vacation</button>
      </div>

      <div className="calendar-card">
        <div className="calendar-toolbar">
          <button className="icon-button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>←</button>
          <h2>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
          <button className="icon-button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>→</button>
          <button className="text-button" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Today</button>
        </div>
        <div className="calendar-weekdays">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className={`calendar-grid ${loading ? 'loading' : ''}`}>
          {days.map((day) => {
            const dayIso = isoDate(day)
            const dayEntries = entriesForDate(entries, dayIso)
            const outside = day.getMonth() !== month.getMonth()
            const today = dayIso === isoDate(new Date())
            return (
              <div className={`calendar-day ${outside ? 'outside' : ''} ${today ? 'today' : ''}`} key={dayIso}>
                <span className="day-number">{day.getDate()}</span>
                <div className="day-events">
                  {dayEntries.slice(0, 3).map((entry) => (
                    <span className="vacation-chip" key={entry.request_id}>{entry.requester_name}</span>
                  ))}
                  {dayEntries.length > 3 && <span className="more-chip">+{dayEntries.length - 3} more</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {showForm && (
        <VacationModal
          group={group}
          onClose={() => setShowForm(false)}
          onSaved={async (status) => {
            setShowForm(false)
            await load()
            await onRequestSaved()
            setNotice({
              type: status === 'approved' ? 'success' : 'success',
              text: status === 'approved'
                ? 'Vacation added to the group calendar.'
                : 'Request sent to the group leader for approval.',
            })
          }}
          onEmailWarning={(text) => setNotice({ type: 'warning', text })}
        />
      )}
    </>
  )
}

function VacationModal({
  group,
  onClose,
  onSaved,
  onEmailWarning,
}: {
  group: GroupSummary
  onClose: () => void
  onSaved: (status: 'pending' | 'approved' | 'rejected') => Promise<void>
  onEmailWarning: (text: string) => void
}) {
  const today = isoDate(new Date())
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    if (endDate < startDate) {
      setError('End date must be on or after the start date.')
      return
    }
    setBusy(true)
    try {
      const result = await requestVacation(group.group_id, startDate, endDate, note)
      if (result.status === 'pending') {
        const { error: mailError } = await supabase.functions.invoke('notify-vacation-request', {
          body: { requestId: result.request_id },
        })
        if (mailError) {
          onEmailWarning('The request was saved, but the leader email could not be sent. The request is still visible in Approvals.')
        }
      }
      await onSaved(result.status)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the request.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Request vacation">
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <p className="eyebrow">TIME OFF</p>
        <h2>{group.role === 'leader' ? 'Add your vacation' : 'Request vacation'}</h2>
        <p className="modal-copy">
          {group.role === 'leader'
            ? 'As group leader, your vacation is added directly to the shared calendar.'
            : 'The group leader will receive an email and can approve or reject this request.'}
        </p>
        <form className="stack-form" onSubmit={submit}>
          <div className="date-row">
            <label>From<input type="date" required value={startDate} onChange={(e) => { setStartDate(e.target.value); if (e.target.value > endDate) setEndDate(e.target.value) }} /></label>
            <label>To<input type="date" required value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} /></label>
          </div>
          <div className="duration-preview">{daysInclusive(startDate, endDate)} calendar day{daysInclusive(startDate, endDate) === 1 ? '' : 's'}</div>
          <label>
            Note <span className="optional">optional</span>
            <textarea value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="Anything the leader should know?" rows={4} />
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="ghost" onClick={onClose}>Cancel</button>
            <button className="primary" disabled={busy}>{busy ? 'Saving…' : group.role === 'leader' ? 'Add vacation' : 'Send request'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function MyVacationView({
  group,
  setNotice,
  onChanged,
}: {
  group: GroupSummary
  setNotice: (notice: Notice) => void
  onChanged: () => Promise<void>
}) {
  const [requests, setRequests] = useState<VacationRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  async function load() {
    setLoading(true)
    try {
      setRequests(await getMyRequests(group.group_id))
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not load your requests.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [group.group_id])

  return (
    <>
      <div className="content-header">
        <div>
          <p className="eyebrow">PERSONAL</p>
          <h1>My vacation</h1>
          <p>Track your approved, pending, and rejected requests.</p>
        </div>
        <button className="primary" onClick={() => setShowForm(true)}>+ {group.role === 'leader' ? 'Add vacation' : 'New request'}</button>
      </div>
      <div className="list-card">
        {loading ? <InlineLoading /> : requests.length === 0 ? (
          <EmptyState title="No vacation yet" text="Your requests will appear here." />
        ) : requests.map((request) => (
          <div className="request-row" key={request.request_id}>
            <div className={`status-dot ${request.status}`} />
            <div className="request-main">
              <strong>{formatRange(request.start_date, request.end_date)}</strong>
              <span>{daysInclusive(request.start_date, request.end_date)} day{daysInclusive(request.start_date, request.end_date) === 1 ? '' : 's'}{request.note ? ` · ${request.note}` : ''}</span>
            </div>
            <span className={`status-pill ${request.status}`}>{request.status}</span>
            {request.status === 'pending' && (
              <button className="text-button danger-text" onClick={async () => {
                try {
                  await withdrawVacation(request.request_id)
                  await load()
                  await onChanged()
                  setNotice({ type: 'success', text: 'Pending request withdrawn.' })
                } catch (error) {
                  setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not withdraw the request.' })
                }
              }}>Withdraw</button>
            )}
          </div>
        ))}
      </div>
      {showForm && (
        <VacationModal
          group={group}
          onClose={() => setShowForm(false)}
          onSaved={async (status) => {
            setShowForm(false)
            await load()
            await onChanged()
            setNotice({ type: 'success', text: status === 'approved' ? 'Vacation added.' : 'Request sent for approval.' })
          }}
          onEmailWarning={(text) => setNotice({ type: 'warning', text })}
        />
      )}
    </>
  )
}

function ApprovalsView({
  group,
  setNotice,
  onChanged,
}: {
  group: GroupSummary
  setNotice: (notice: Notice) => void
  onChanged: () => Promise<void>
}) {
  const [requests, setRequests] = useState<VacationRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [workingId, setWorkingId] = useState('')

  async function load() {
    setLoading(true)
    try {
      setRequests(await getPendingRequests(group.group_id))
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not load approvals.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [group.group_id])

  async function decide(requestId: string, decision: 'approved' | 'rejected') {
    setWorkingId(requestId)
    try {
      await reviewVacation(requestId, decision)
      await load()
      await onChanged()
      setNotice({ type: 'success', text: decision === 'approved' ? 'Vacation approved and added to the calendar.' : 'Vacation request rejected.' })
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not review the request.' })
    } finally {
      setWorkingId('')
    }
  }

  return (
    <>
      <div className="content-header">
        <div>
          <p className="eyebrow">LEADER</p>
          <h1>Vacation approvals</h1>
          <p>Approve a request to make it visible in the group calendar.</p>
        </div>
      </div>
      <div className="approval-grid">
        {loading ? <InlineLoading /> : requests.length === 0 ? (
          <EmptyState title="All caught up" text="There are no pending vacation requests." />
        ) : requests.map((request) => (
          <article className="approval-card" key={request.request_id}>
            <div className="avatar">{initials(request.requester_name)}</div>
            <div className="approval-body">
              <div className="approval-title">
                <div>
                  <strong>{request.requester_name}</strong>
                  <span>{request.requester_email}</span>
                </div>
                <span className="status-pill pending">pending</span>
              </div>
              <h3>{formatRange(request.start_date, request.end_date)}</h3>
              <p className="days-label">{daysInclusive(request.start_date, request.end_date)} calendar day{daysInclusive(request.start_date, request.end_date) === 1 ? '' : 's'}</p>
              {request.note && <blockquote>{request.note}</blockquote>}
              <div className="approval-actions">
                <button className="reject" disabled={workingId === request.request_id} onClick={() => decide(request.request_id, 'rejected')}>Reject</button>
                <button className="approve" disabled={workingId === request.request_id} onClick={() => decide(request.request_id, 'approved')}>✓ Approve</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </>
  )
}

function MembersView({ group, setNotice }: { group: GroupSummary; setNotice: (notice: Notice) => void }) {
  const [members, setMembers] = useState<GroupMember[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    try {
      setMembers(await getGroupMembers(group.group_id))
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not load members.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [group.group_id])

  async function add(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      await addGroupMember(group.group_id, email, name)
      setEmail('')
      setName('')
      await load()
      setNotice({ type: 'success', text: 'Member added. They can now sign in with that exact email address.' })
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not add the member.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="content-header">
        <div>
          <p className="eyebrow">LEADER</p>
          <h1>Group members</h1>
          <p>Add the email addresses that are allowed to see this group's agenda.</p>
        </div>
      </div>
      <div className="members-layout">
        <section className="list-card">
          {loading ? <InlineLoading /> : members.map((member) => (
            <div className="member-row" key={member.member_id}>
              <div className="avatar">{initials(member.display_name)}</div>
              <div className="member-main">
                <strong>{member.display_name}</strong>
                <span>{member.email}</span>
              </div>
              <span className={`role-pill ${member.role}`}>{member.role}</span>
              <span className={`joined-pill ${member.joined ? 'yes' : ''}`}>{member.joined ? 'Signed in' : 'Not yet signed in'}</span>
              {member.role !== 'leader' && (
                <button className="icon-button danger" title="Remove member" onClick={async () => {
                  if (!window.confirm(`Remove ${member.display_name} from this group?`)) return
                  try {
                    await removeGroupMember(group.group_id, member.member_id)
                    await load()
                    setNotice({ type: 'success', text: 'Member removed.' })
                  } catch (error) {
                    setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not remove the member.' })
                  }
                }}>×</button>
              )}
            </div>
          ))}
        </section>
        <aside className="add-member-card">
          <p className="eyebrow">ADD PERSON</p>
          <h3>Give someone access</h3>
          <p>Enter the exact email address they will use to sign in.</p>
          <form className="stack-form" onSubmit={add}>
            <label>Name<input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Lena Wilhelm" /></label>
            <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="lena@example.org" /></label>
            <button className="primary" disabled={busy}>{busy ? 'Adding…' : 'Add member'}</button>
          </form>
        </aside>
      </div>
    </>
  )
}

function LoadingScreen({ label }: { label: string }) {
  return <main className="loading-screen"><div className="spinner" /><p>{label}</p></main>
}

function InlineLoading() {
  return <div className="inline-loading"><div className="spinner small-spinner" /> Loading…</div>
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="empty-state"><div className="empty-icon">○</div><strong>{title}</strong><span>{text}</span></div>
}

function Toast({ notice, onClose }: { notice: NonNullable<Notice>; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 6000)
    return () => window.clearTimeout(timer)
  }, [notice.text])
  return <div className={`toast ${notice.type}`}><span>{notice.text}</span><button onClick={onClose}>×</button></div>
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?'
}

export default App
