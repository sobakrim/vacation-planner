import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  addGroupMember,
  cancelVacation,
  claimMemberships,
  createGroup,
  demoteGroupLeader,
  getCalendar,
  getGroupMembers,
  getGroupVacationBalances,
  getMyGroups,
  getMyRequests,
  getMyVacationBalance,
  getPendingRequests,
  promoteGroupLeader,
  removeGroupMember,
  requestVacation,
  reviewVacation,
  setMemberAllowance,
  setMemberContractStart,
  setMyContractStart,
  withdrawVacation,
} from './api'
import {
  addDays,
  endOfCalendarMonth,
  dayPartShort,
  entriesForDate,
  entryPartForDate,
  formatVacationRange,
  isoDate,
  startOfCalendarMonth,
  vacationDaysCharged,
} from './calendar'
import { supabase } from './supabase'
import type { DayPart, GroupMember, GroupSummary, MemberVacationBalance, VacationBalance, VacationEntry, VacationRequest } from './types'
import { getVaudPublicHoliday } from './vaudHolidays'

type Tab = 'calendar' | 'mine' | 'approvals' | 'members'
type Notice = { type: 'success' | 'warning' | 'error'; text: string } | null

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [passwordReadyOverride, setPasswordReadyOverride] = useState(false)

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

  const params = new URLSearchParams(window.location.search)
  const passwordFlow = params.get('setup') === '1' || params.get('reset') === '1'
  const passwordSet = session.user.user_metadata?.password_set === true
  if (!passwordReadyOverride && (passwordFlow || !passwordSet)) {
    return (
      <SetPasswordScreen
        email={session.user.email ?? ''}
        recovery={params.get('reset') === '1'}
        onDone={() => {
          setPasswordReadyOverride(true)
          window.history.replaceState({}, '', window.location.pathname)
        }}
      />
    )
  }

  return <AuthenticatedApp session={session} />
}

type AuthMode = 'signin' | 'signup' | 'reset'

function LoginScreen() {
  const [mode, setMode] = useState<AuthMode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function switchMode(next: AuthMode) {
    setMode(next)
    setSent(false)
    setError('')
    setPassword('')
  }

  function appRedirect(flag: 'setup' | 'reset') {
    const url = new URL(`${window.location.origin}${import.meta.env.BASE_URL}`)
    url.searchParams.set(flag, '1')
    return url.toString()
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')

    if (mode === 'signin') {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      setBusy(false)
      if (authError) setError(authError.message)
      return
    }

    if (mode === 'signup') {
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: true,
          emailRedirectTo: appRedirect('setup'),
          data: { password_set: false },
        },
      })
      setBusy(false)
      if (authError) {
        setError(authError.message)
        return
      }
      setSent(true)
      return
    }

    const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: appRedirect('reset'),
    })
    setBusy(false)
    if (authError) {
      setError(authError.message)
      return
    }
    setSent(true)
  }

  const title = mode === 'signin' ? 'Connect to your profile' : mode === 'signup' ? 'Create your account' : 'Reset your password'
  const copy = mode === 'signin'
    ? 'Use the email and password attached to your vacation profile.'
    : mode === 'signup'
      ? 'Enter your email first. We will send a verification link; after opening it, you choose your password.'
      : 'Enter your account email and we will send a secure password-reset link.'

  return (
    <main className="auth-shell">
      <section className="auth-card auth-card-wide">
        <div className="brand-mark">V</div>
        <p className="eyebrow">GROUP VACATION</p>
        <h1>{title}</h1>
        <p className="lead">{copy}</p>

        <div className="auth-tabs" role="tablist" aria-label="Account access">
          <button type="button" className={mode === 'signin' ? 'active' : ''} onClick={() => switchMode('signin')}>Sign in</button>
          <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => switchMode('signup')}>Create account</button>
        </div>

        {sent ? (
          <div className="message success">
            <strong>Check your inbox.</strong>
            <span>
              {mode === 'signup'
                ? `Open the verification link sent to ${email}. You will then choose your password.`
                : `Open the password-reset link sent to ${email}.`}
            </span>
          </div>
        ) : (
          <form onSubmit={submit} className="stack-form">
            <label>
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.org"
                autoComplete="email"
              />
            </label>
            {mode === 'signin' && (
              <label>
                Password
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </label>
            )}
            <button className="primary" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Send verification email' : 'Send reset email'}
            </button>
            {mode === 'signin' && (
              <button type="button" className="auth-link" onClick={() => switchMode('reset')}>Forgot your password?</button>
            )}
            {mode === 'reset' && (
              <button type="button" className="auth-link" onClick={() => switchMode('signin')}>Back to sign in</button>
            )}
            {error && <p className="form-error">{error}</p>}
          </form>
        )}
        <p className="microcopy">Group access is still controlled by the email address that a group leader added to the team.</p>
      </section>
    </main>
  )
}

function SetPasswordScreen({
  email,
  recovery,
  onDone,
}: {
  email: string
  recovery: boolean
  onDone: () => void
}) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }
    setBusy(true)
    const { error: authError } = await supabase.auth.updateUser({
      password,
      data: { password_set: true },
    })
    setBusy(false)
    if (authError) {
      setError(authError.message)
      return
    }
    onDone()
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand-mark">V</div>
        <p className="eyebrow">{recovery ? 'PASSWORD RESET' : 'ACCOUNT SETUP'}</p>
        <h1>{recovery ? 'Choose a new password' : 'Finish creating your account'}</h1>
        <p className="lead">Your email has been verified as <strong>{email}</strong>. Choose the password you will use to sign in from now on.</p>
        <form onSubmit={submit} className="stack-form">
          <label>
            Password
            <input type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </label>
          <label>
            Confirm password
            <input type="password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </label>
          <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save password and continue'}</button>
          {error && <p className="form-error">{error}</p>}
        </form>
        <p className="microcopy">Use at least 8 characters. Your password is handled by Supabase Auth and is not stored in the vacation tables.</p>
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
            <input required value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Team or department" />
          </label>
          <label>
            Your display name
            <input required value={leaderName} onChange={(e) => setLeaderName(e.target.value)} placeholder="Your name" />
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
          <p>Approved vacation and official Vaud public holidays are shown here.</p>
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
            const holiday = getVaudPublicHoliday(dayIso)
            const outside = day.getMonth() !== month.getMonth()
            const today = dayIso === isoDate(new Date())
            const weekend = day.getDay() === 0 || day.getDay() === 6
            return (
              <div className={`calendar-day ${outside ? 'outside' : ''} ${today ? 'today' : ''} ${weekend ? 'weekend' : ''} ${holiday ? 'public-holiday' : ''}`} key={dayIso}>
                <span className="day-number">{day.getDate()}</span>
                <div className="day-events">
                  {holiday && <span className="holiday-chip" title="Official Canton of Vaud public holiday">{holiday.name}</span>}
                  {dayEntries.slice(0, holiday ? 2 : 3).map((entry) => {
                    const part = entryPartForDate(entry, dayIso)
                    return (
                      <span className={`vacation-chip ${part !== 'full' ? 'half-day' : ''}`} key={entry.request_id} title={part === 'full' ? 'Full day' : part}>
                        {entry.requester_name}{part !== 'full' ? ` · ${dayPartShort(part)}` : ''}
                      </span>
                    )
                  })}
                  {dayEntries.length > (holiday ? 2 : 3) && <span className="more-chip">+{dayEntries.length - (holiday ? 2 : 3)} more</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div className="calendar-legend">
        <span><i className="legend-swatch vacation" /> Approved vacation</span>
        <span><i className="legend-swatch holiday" /> Vaud public holiday</span>
        <span className="legend-note">Weekends and public holidays do not reduce the vacation balance.</span>
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
  const [singleDayPart, setSingleDayPart] = useState<DayPart>('full')
  const [startPart, setStartPart] = useState<'full' | 'afternoon'>('full')
  const [endPart, setEndPart] = useState<'full' | 'morning'>('full')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const isSingleDay = startDate === endDate
  const effectiveStartPart: DayPart = isSingleDay ? singleDayPart : startPart
  const effectiveEndPart: DayPart = isSingleDay ? singleDayPart : endPart
  const chargedDays = vacationDaysCharged(startDate, endDate, effectiveStartPart, effectiveEndPart)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    if (endDate < startDate) {
      setError('End date must be on or after the start date.')
      return
    }
    if (chargedDays <= 0) {
      setError('This selection contains no chargeable working time.')
      return
    }
    setBusy(true)
    try {
      const result = await requestVacation(
        group.group_id,
        startDate,
        endDate,
        effectiveStartPart,
        effectiveEndPart,
        note,
      )
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
            : 'A group leader will receive an email and can approve or reject this request.'}
        </p>
        <form className="stack-form" onSubmit={submit}>
          <div className="date-row">
            <label>From<input type="date" required value={startDate} onChange={(e) => { setStartDate(e.target.value); if (e.target.value > endDate) setEndDate(e.target.value) }} /></label>
            <label>To<input type="date" required value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} /></label>
          </div>
          {isSingleDay ? (
            <label>Day length
              <select value={singleDayPart} onChange={(e) => setSingleDayPart(e.target.value as DayPart)}>
                <option value="full">Full day</option>
                <option value="morning">Morning only (½ day)</option>
                <option value="afternoon">Afternoon only (½ day)</option>
              </select>
            </label>
          ) : (
            <div className="date-row">
              <label>First day
                <select value={startPart} onChange={(e) => setStartPart(e.target.value as 'full' | 'afternoon')}>
                  <option value="full">Full day</option>
                  <option value="afternoon">Start in afternoon (½ first day)</option>
                </select>
              </label>
              <label>Last day
                <select value={endPart} onChange={(e) => setEndPart(e.target.value as 'full' | 'morning')}>
                  <option value="full">Full day</option>
                  <option value="morning">End after morning (½ last day)</option>
                </select>
              </label>
            </div>
          )}
          <div className="duration-preview"><strong>{chargedDays} vacation day{chargedDays === 1 ? '' : 's'}</strong> charged · weekends and official Vaud public holidays excluded</div>
          <label>
            Note <span className="optional">optional</span>
            <textarea value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="Anything the leaders should know?" rows={4} />
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
  const currentYear = new Date().getFullYear()
  const [requests, setRequests] = useState<VacationRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [balanceYear, setBalanceYear] = useState(currentYear)
  const [balance, setBalance] = useState<VacationBalance | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(true)
  const [contractDraft, setContractDraft] = useState('')
  const [savingContract, setSavingContract] = useState(false)

  async function loadRequests() {
    setLoading(true)
    try {
      setRequests(await getMyRequests(group.group_id))
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not load your requests.' })
    } finally {
      setLoading(false)
    }
  }

  async function loadBalance() {
    setBalanceLoading(true)
    try {
      const next = await getMyVacationBalance(group.group_id, balanceYear)
      setBalance(next)
      setContractDraft(next.contract_start_date ?? '')
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not load your vacation balance.' })
    } finally {
      setBalanceLoading(false)
    }
  }

  async function saveContractStart() {
    if (!contractDraft) {
      setNotice({ type: 'error', text: 'Choose your contract start date.' })
      return
    }
    setSavingContract(true)
    try {
      await setMyContractStart(group.group_id, contractDraft)
      await loadBalance()
      await onChanged()
      setNotice({ type: 'success', text: 'Contract start date saved. Your annual allowance has been recalculated.' })
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not save the contract start date.' })
    } finally {
      setSavingContract(false)
    }
  }

  async function reloadAll() {
    await Promise.all([loadRequests(), loadBalance()])
  }

  useEffect(() => { loadRequests() }, [group.group_id])
  useEffect(() => { loadBalance() }, [group.group_id, balanceYear])

  const canRequest = Boolean(balance?.contract_start_date)

  return (
    <>
      <div className="content-header">
        <div>
          <p className="eyebrow">PERSONAL</p>
          <h1>My vacation</h1>
          <p>Your balance and contract date are private. Only you and group leaders can see them.</p>
        </div>
        <button className="primary" disabled={!canRequest} title={!canRequest ? 'Set your contract start date first' : undefined} onClick={() => setShowForm(true)}>+ {group.role === 'leader' ? 'Add vacation' : 'New request'}</button>
      </div>

      <section className="contract-card">
        <div>
          <p className="eyebrow">CONTRACT</p>
          <h3>Contract start date</h3>
          <p>This date prorates your vacation entitlement for the year you joined. You can set or correct it yourself; a group leader can also update it.</p>
        </div>
        <div className="contract-editor">
          <input type="date" value={contractDraft} onChange={(e) => setContractDraft(e.target.value)} />
          <button className="ghost" disabled={savingContract || !contractDraft} onClick={saveContractStart}>{savingContract ? 'Saving…' : 'Save date'}</button>
        </div>
      </section>

      <section className="balance-card">
        <div className="balance-card-heading">
          <div>
            <p className="eyebrow">VACATION BALANCE</p>
            <h2>{balanceYear}</h2>
          </div>
          <select className="year-select" value={balanceYear} onChange={(e) => setBalanceYear(Number(e.target.value))}>
            {[currentYear, currentYear + 1, currentYear + 2].map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </div>
        {balanceLoading || !balance ? <InlineLoading /> : balance.contract_start_date == null ? (
          <div className="balance-missing">Set your contract start date above to calculate your prorated allowance.</div>
        ) : (
          <div className="balance-stats balance-stats-six">
            <div className="balance-primary"><strong>{balance.remaining_days}</strong><span>days left</span></div>
            <div><strong>{balance.allowance_days}</strong><span>current-year entitlement</span></div>
            <div><strong>{balance.carryover_days > 0 ? '+' : ''}{balance.carryover_days}</strong><span>carried from previous years</span></div>
            <div><strong>{balance.full_year_allowance_days}</strong><span>full-year entitlement</span></div>
            <div><strong>{balance.used_days}</strong><span>approved / booked</span></div>
            <div><strong>{balance.pending_days}</strong><span>pending</span></div>
          </div>
        )}
        <p className="balance-note">The joining year is prorated by the exact contract start date and rounded to the nearest half day. Positive and negative approved balances carry automatically into every following year. Pending requests are shown separately and are not carried until approved. Charged days exclude Saturdays, Sundays, and official Canton of Vaud public holidays.</p>
      </section>

      <div className="list-card request-list-card">
        {loading ? <InlineLoading /> : requests.length === 0 ? (
          <EmptyState title="No vacation yet" text="Your requests will appear here." />
        ) : requests.map((request) => {
          const chargedDays = vacationDaysCharged(request.start_date, request.end_date, request.start_part, request.end_part)
          const canCancel = request.status === 'approved' && request.start_date >= isoDate(new Date())
          return (
            <div className="request-row" key={request.request_id}>
              <div className={`status-dot ${request.status}`} />
              <div className="request-main">
                <strong>{formatVacationRange(request.start_date, request.end_date, request.start_part, request.end_part)}</strong>
                <span>{chargedDays} vacation day{chargedDays === 1 ? '' : 's'} charged{request.note ? ` · ${request.note}` : ''}</span>
              </div>
              <span className={`status-pill ${request.status}`}>{request.status}</span>
              {request.status === 'pending' && (
                <button className="text-button danger-text" onClick={async () => {
                  try {
                    await withdrawVacation(request.request_id)
                    await reloadAll()
                    await onChanged()
                    setNotice({ type: 'success', text: 'Pending request withdrawn.' })
                  } catch (error) {
                    setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not withdraw the request.' })
                  }
                }}>Withdraw</button>
              )}
              {canCancel && (
                <button className="text-button danger-text" onClick={async () => {
                  if (!window.confirm(`Cancel your vacation ${formatVacationRange(request.start_date, request.end_date, request.start_part, request.end_part)}? It will disappear from the group calendar immediately.`)) return
                  try {
                    await cancelVacation(request.request_id)
                    await reloadAll()
                    await onChanged()
                    setNotice({ type: 'success', text: 'Vacation cancelled. No leader approval or notification was required.' })
                  } catch (error) {
                    setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not cancel the vacation.' })
                  }
                }}>Cancel vacation</button>
              )}
            </div>
          )
        })}
      </div>
      {showForm && (
        <VacationModal
          group={group}
          onClose={() => setShowForm(false)}
          onSaved={async (status) => {
            setShowForm(false)
            await reloadAll()
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
              <h3>{formatVacationRange(request.start_date, request.end_date, request.start_part, request.end_part)}</h3>
              <p className="days-label">{vacationDaysCharged(request.start_date, request.end_date, request.start_part, request.end_part)} vacation day{vacationDaysCharged(request.start_date, request.end_date, request.start_part, request.end_part) === 1 ? '' : 's'} charged · weekends and Vaud public holidays excluded</p>
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
  const currentYear = new Date().getFullYear()
  const [members, setMembers] = useState<GroupMember[]>([])
  const [balances, setBalances] = useState<MemberVacationBalance[]>([])
  const [balanceYear, setBalanceYear] = useState(currentYear)
  const [allowanceDrafts, setAllowanceDrafts] = useState<Record<string, string>>({})
  const [contractDrafts, setContractDrafts] = useState<Record<string, string>>({})
  const [savingAllowanceId, setSavingAllowanceId] = useState('')
  const [savingContractId, setSavingContractId] = useState('')
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [contractStart, setContractStart] = useState('')
  const [newRole, setNewRole] = useState<'member' | 'leader'>('member')
  const [busy, setBusy] = useState(false)
  const [roleWorkingId, setRoleWorkingId] = useState('')

  async function load() {
    setLoading(true)
    try {
      const [nextMembers, nextBalances] = await Promise.all([
        getGroupMembers(group.group_id),
        getGroupVacationBalances(group.group_id, balanceYear),
      ])
      setMembers(nextMembers)
      setBalances(nextBalances)
      setAllowanceDrafts(Object.fromEntries(nextBalances.map((balance) => [balance.member_id, String(balance.full_year_allowance_days)])))
      setContractDrafts(Object.fromEntries(nextMembers.map((member) => [member.member_id, member.contract_start_date ?? ''])))
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not load members.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [group.group_id, balanceYear])

  async function add(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      await addGroupMember(group.group_id, email, name, newRole, contractStart || null)
      setEmail('')
      setName('')
      setContractStart('')
      setNewRole('member')
      await load()
      setNotice({
        type: 'success',
        text: newRole === 'leader'
          ? 'Group leader added.'
          : contractStart
            ? 'Member added. Their allowance will be prorated from the contract start date.'
            : 'Member added. They can set their contract start date when they sign in.',
      })
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not add the member.' })
    } finally {
      setBusy(false)
    }
  }

  async function saveAllowance(memberId: string) {
    const value = Number(allowanceDrafts[memberId])
    if (!Number.isInteger(value) || value < 0 || value > 366) {
      setNotice({ type: 'error', text: 'Annual allowance must be a whole number between 0 and 366.' })
      return
    }
    setSavingAllowanceId(memberId)
    try {
      await setMemberAllowance(group.group_id, memberId, value)
      await load()
      setNotice({ type: 'success', text: 'Full-year vacation entitlement updated. The prorated balance was recalculated.' })
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not update the allowance.' })
    } finally {
      setSavingAllowanceId('')
    }
  }

  async function saveContract(memberId: string) {
    const value = contractDrafts[memberId]
    if (!value) {
      setNotice({ type: 'error', text: 'Choose a contract start date.' })
      return
    }
    setSavingContractId(memberId)
    try {
      await setMemberContractStart(group.group_id, memberId, value)
      await load()
      setNotice({ type: 'success', text: 'Contract start date updated and the vacation allowance recalculated.' })
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not update the contract start date.' })
    } finally {
      setSavingContractId('')
    }
  }

  const canManageLeaders = members.some((member) => member.is_owner && member.is_me)

  async function changeLeaderRole(member: GroupMember, makeLeader: boolean) {
    const action = makeLeader ? 'make this person a group leader' : 'remove this person’s leader rights'
    if (!window.confirm(`${makeLeader ? 'Make' : 'Change'} ${member.display_name}: ${action}?`)) return
    setRoleWorkingId(member.member_id)
    try {
      if (makeLeader) await promoteGroupLeader(group.group_id, member.member_id)
      else await demoteGroupLeader(group.group_id, member.member_id)
      await load()
      setNotice({ type: 'success', text: makeLeader ? `${member.display_name} is now a group leader.` : `${member.display_name} is now a regular member.` })
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not change leader rights.' })
    } finally {
      setRoleWorkingId('')
    }
  }

  return (
    <>
      <div className="content-header">
        <div>
          <p className="eyebrow">LEADER</p>
          <h1>Group members</h1>
          <p>Group leaders can manage contract dates, vacation balances and approvals. Only the original group leader can grant or remove leader rights.</p>
        </div>
        <label className="year-filter">Balance year
          <select value={balanceYear} onChange={(e) => setBalanceYear(Number(e.target.value))}>
            {[currentYear, currentYear + 1, currentYear + 2].map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </label>
      </div>
      <div className="members-layout">
        <section className="list-card member-balance-list">
          {loading ? <InlineLoading /> : members.map((member) => {
            const balance = balances.find((item) => item.member_id === member.member_id)
            return (
              <div className="member-row member-balance-row" key={member.member_id}>
                <div className="avatar">{initials(member.display_name)}</div>
                <div className="member-main">
                  <strong>{member.display_name}</strong>
                  <span>{member.email}</span>
                  {balance && balance.contract_start_date ? (
                    <div className="leader-balance-summary">
                      <strong>{balance.remaining_days} left</strong>
                      <span>{balance.carryover_days > 0 ? '+' : ''}{balance.carryover_days} carry-over · {balance.used_days} approved · {balance.pending_days} pending · {balance.allowance_days} current-year / {balance.full_year_allowance_days} full-year</span>
                    </div>
                  ) : (
                    <div className="leader-balance-summary missing-contract">
                      <strong>Contract date needed</strong>
                      <span>No prorated allowance is calculated until a start date is set.</span>
                    </div>
                  )}
                </div>
                <div className="member-role-stack">
                  <span className={`role-pill ${member.role}`}>{member.is_owner ? 'Original leader' : member.role === 'leader' ? 'Group leader' : 'Member'}</span>
                  {member.is_me && <span className="you-pill">You</span>}
                </div>
                <span className={`joined-pill ${member.joined ? 'yes' : ''}`}>{member.joined ? 'Account created' : 'No account yet'}</span>
                <div className="member-settings">
                  <div className="allowance-editor">
                    <label>Full-year days
                      <input
                        type="number"
                        min="0"
                        max="366"
                        step="1"
                        value={allowanceDrafts[member.member_id] ?? balance?.full_year_allowance_days ?? 25}
                        onChange={(e) => setAllowanceDrafts((current) => ({ ...current, [member.member_id]: e.target.value }))}
                      />
                    </label>
                    <button className="ghost compact-button" disabled={savingAllowanceId === member.member_id} onClick={() => saveAllowance(member.member_id)}>
                      {savingAllowanceId === member.member_id ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                  <div className="contract-member-editor">
                    <label>Contract start
                      <input
                        type="date"
                        value={contractDrafts[member.member_id] ?? ''}
                        onChange={(e) => setContractDrafts((current) => ({ ...current, [member.member_id]: e.target.value }))}
                      />
                    </label>
                    <button className="ghost compact-button" disabled={savingContractId === member.member_id || !contractDrafts[member.member_id]} onClick={() => saveContract(member.member_id)}>
                      {savingContractId === member.member_id ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
                {canManageLeaders && !member.is_owner && (
                  <button
                    className="ghost compact-button leader-toggle"
                    disabled={roleWorkingId === member.member_id}
                    onClick={() => changeLeaderRole(member, member.role !== 'leader')}
                  >
                    {roleWorkingId === member.member_id ? 'Saving…' : member.role === 'leader' ? 'Remove leader rights' : 'Make leader'}
                  </button>
                )}
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
            )
          })}
        </section>
        <aside className="add-member-card">
          <p className="eyebrow">ADD PERSON</p>
          <h3>Give someone access</h3>
          <p>Enter the exact email address they will use to create their account. You can enter their contract start date now, or leave it blank and let them set it after signing in.</p>
          <form className="stack-form" onSubmit={add}>
            <label>Name<input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Team member" /></label>
            <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="member@example.org" /></label>
            <label>Contract start date <span className="optional">optional</span>
              <input type="date" value={contractStart} onChange={(e) => setContractStart(e.target.value)} />
            </label>
            {canManageLeaders && (
              <label>Role
                <select value={newRole} onChange={(e) => setNewRole(e.target.value as 'member' | 'leader')}>
                  <option value="member">Member</option>
                  <option value="leader">Group leader</option>
                </select>
              </label>
            )}
            <button className="primary" disabled={busy}>{busy ? 'Adding…' : newRole === 'leader' ? 'Add group leader' : 'Add member'}</button>
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
