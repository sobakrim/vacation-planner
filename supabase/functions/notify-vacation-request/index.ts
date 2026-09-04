import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function getDefaultKey(envName: string, legacyName: string) {
  const modern = Deno.env.get(envName)
  if (modern) {
    try {
      const parsed = JSON.parse(modern)
      if (parsed.default) return parsed.default as string
    } catch {
      // Fall back to the legacy key below.
    }
  }
  return Deno.env.get(legacyName) ?? ''
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]!)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const publishableKey = getDefaultKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
  const secretKey = getDefaultKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
  const resendKey = Deno.env.get('RESEND_API_KEY') ?? ''
  const from = Deno.env.get('VACATION_EMAIL_FROM') ?? ''
  const appUrl = Deno.env.get('APP_URL') ?? ''
  const authHeader = request.headers.get('Authorization') ?? ''

  if (!supabaseUrl || !publishableKey || !secretKey) return json({ error: 'Supabase function environment is incomplete' }, 500)
  if (!resendKey || !from) return json({ error: 'Email is not configured. Set RESEND_API_KEY and VACATION_EMAIL_FROM.' }, 500)
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Authentication required' }, 401)

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const token = authHeader.slice('Bearer '.length)
  const { data: userData, error: userError } = await userClient.auth.getUser(token)
  if (userError || !userData.user) return json({ error: 'Invalid user session' }, 401)

  let requestId = ''
  try {
    const body = await request.json()
    requestId = String(body?.requestId ?? '')
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  if (!requestId) return json({ error: 'requestId is required' }, 400)

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: vacation, error: vacationError } = await admin
    .from('vacation_requests')
    .select('id, group_id, requester_user_id, requester_name, requester_email, start_date, end_date, note, status, notified_at')
    .eq('id', requestId)
    .maybeSingle()

  if (vacationError || !vacation) return json({ error: 'Vacation request not found' }, 404)
  if (vacation.requester_user_id !== userData.user.id) return json({ error: 'You cannot notify for another user' }, 403)
  if (vacation.status !== 'pending') return json({ sent: false, reason: 'not-pending' })
  if (vacation.notified_at) return json({ sent: false, reason: 'already-notified' })

  // Claim the notification before sending so repeated button clicks do not spam the leader.
  const claimTime = new Date().toISOString()
  const { data: claimed, error: claimError } = await admin
    .from('vacation_requests')
    .update({ notified_at: claimTime })
    .eq('id', requestId)
    .is('notified_at', null)
    .select('id')
    .maybeSingle()

  if (claimError) return json({ error: 'Could not claim notification' }, 500)
  if (!claimed) return json({ sent: false, reason: 'already-notified' })

  const { data: group, error: groupError } = await admin
    .from('vacation_groups')
    .select('id, name')
    .eq('id', vacation.group_id)
    .single()

  if (groupError || !group) {
    await admin.from('vacation_requests').update({ notified_at: null }).eq('id', requestId).eq('notified_at', claimTime)
    return json({ error: 'Group not found' }, 500)
  }

  const { data: leaderRows, error: leaderError } = await admin
    .from('vacation_group_members')
    .select('email')
    .eq('group_id', vacation.group_id)
    .eq('role', 'leader')

  const leaderEmails = Array.from(new Set((leaderRows ?? []).map((row) => String(row.email ?? '').trim().toLowerCase()).filter(Boolean)))
  if (leaderError || leaderEmails.length === 0) {
    await admin.from('vacation_requests').update({ notified_at: null }).eq('id', requestId).eq('notified_at', claimTime)
    return json({ error: 'No group leader email was found' }, 500)
  }

  const subject = `${vacation.requester_name} requested vacation`
  const noteHtml = vacation.note
    ? `<p style="margin:16px 0 0;color:#536159"><strong>Note:</strong> ${escapeHtml(vacation.note)}</p>`
    : ''
  const actionHtml = appUrl
    ? `<p style="margin:24px 0 0"><a href="${escapeHtml(appUrl)}" style="display:inline-block;background:#285b48;color:white;text-decoration:none;padding:11px 16px;border-radius:8px;font-weight:700">Review request</a></p>`
    : ''

  const emailResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: leaderEmails,
      subject,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1e2a24;line-height:1.5">
          <p style="font-size:12px;letter-spacing:.12em;color:#708077;font-weight:700">${escapeHtml(group.name.toUpperCase())}</p>
          <h2 style="margin:0 0 16px">New vacation request</h2>
          <p><strong>${escapeHtml(vacation.requester_name)}</strong> requested vacation from <strong>${escapeHtml(vacation.start_date)}</strong> to <strong>${escapeHtml(vacation.end_date)}</strong>.</p>
          ${noteHtml}
          ${actionHtml}
          <p style="margin-top:28px;color:#87908a;font-size:12px">The vacation will appear in the shared calendar only after a group leader approves it.</p>
        </div>
      `,
    }),
  })

  if (!emailResponse.ok) {
    const details = await emailResponse.text()
    await admin.from('vacation_requests').update({ notified_at: null }).eq('id', requestId).eq('notified_at', claimTime)
    return json({ error: 'Email provider rejected the message', details }, 502)
  }

  return json({ sent: true })
})
