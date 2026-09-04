# Group Vacation Planner

A privacy-conscious vacation calendar for a team or research group.

## v0.3 highlights

- Real **email + password accounts**.
- First visit: choose **Sign in** or **Create account**.
- Account creation is email-first: the user enters an email, receives a verification link, opens it, then chooses a password.
- Password recovery is available from the sign-in screen.
- A group can have **multiple leaders**.
- The person who originally creates the group is the **Original leader / owner**.
- Only that original leader can grant or remove leader rights.
- All group leaders can approve/reject vacation, manage normal members, see group vacation balances, and change annual allowances.
- Vacation-request notification emails are sent to all current group leaders.

## Vacation workflow

- The original leader creates the group and adds each member's exact email address.
- Every person creates their own account with that email.
- Members see the shared calendar of **approved** vacations.
- A normal member submits a vacation request. It stays **pending** and an email is sent to the group leaders.
- Any group leader may approve or reject it.
- An approved request immediately appears in the shared calendar.
- A leader's own vacation is approved immediately.
- A user can cancel their own approved vacation before it starts. Cancellation is immediate, restores the balance, and sends no leader notification.

## Vacation balance

- Each person sees only their own vacation balance in **My vacation**.
- Group leaders can see every member's balance in **Members**.
- New members start with an annual allowance of **25 days**; leaders can change it.
- Saturdays, Sundays, and official Canton of Vaud public holidays are not charged.
- Vaud public holidays for **2026–2031** are bundled and displayed in the shared calendar.

## Stack

- React + TypeScript + Vite
- GitHub Pages for the frontend
- Supabase Auth for account creation, email verification, passwords, and password reset
- Supabase Postgres for groups, memberships, requests, balances, and authorization
- Supabase Edge Function + Resend for leader notification emails

## Existing installation: update from v0.2

If you already have v0.2 deployed and have already run `001_init.sql` and `002_balances_holidays_cancellation.sql`:

1. Replace/update the repository files with v0.3.
2. In Supabase open **SQL Editor → New query**.
3. Run only:

```text
supabase/003_accounts_multi_leaders.sql
```

4. Redeploy the notification function because it now emails all leaders:

```bash
supabase functions deploy notify-vacation-request
```

5. Push the frontend update to `main`.

No new GitHub variables and no new Resend secrets are required.

### Existing users from the old magic-link version

Existing authenticated users do not need a new Supabase user record. The new app detects that their account has not finished password setup and asks them to choose a password. If they are signed out, they can choose **Create account**, enter the same email, open the email link, and set a password.

## New installation

### 1. Create Supabase and run SQL

Run these files in order in **Supabase → SQL Editor**:

```text
supabase/001_init.sql
supabase/002_balances_holidays_cancellation.sql
supabase/003_accounts_multi_leaders.sql
```

### 2. Configure authentication URLs

In **Supabase → Authentication → URL Configuration**, add your frontend URLs, for example:

```text
http://localhost:5173/
https://YOUR_USERNAME.github.io/group-vacation-planner/
```

Use the GitHub Pages URL as the Site URL after deployment. The app uses these URLs for account-verification and password-reset redirects.

### 3. Frontend variables

The frontend needs only:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

For GitHub Pages add them under:

**Settings → Secrets and variables → Actions → Variables**

Never expose a Supabase secret/service-role key in a `VITE_...` variable.

### 4. Install and build

Requires Node 24 or newer.

```bash
npm install
npm run build
```

### 5. Configure leader notification email

The Edge Function uses Resend. Keep these as Supabase Edge Function secrets:

```text
RESEND_API_KEY=re_...
VACATION_EMAIL_FROM=Vacation Planner <vacation@YOUR_VERIFIED_DOMAIN>
APP_URL=https://YOUR_USERNAME.github.io/group-vacation-planner/
```

Deploy:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy notify-vacation-request
```

### 6. Deploy GitHub Pages

Choose:

**Settings → Pages → Build and deployment → Source → GitHub Actions**

The included `.github/workflows/deploy-pages.yml` builds and deploys on pushes to `main`.

## Account flow

### New user

```text
Open app
  → Create account
  → enter email
  → receive verification email
  → open link
  → choose + confirm password
  → account ready
  → matching group memberships appear automatically
```

### Existing user

```text
Open app
  → Sign in
  → email + password
```

### Forgotten password

```text
Sign in
  → Forgot your password?
  → receive reset link
  → choose new password
```

## Multi-leader rules

- The first person to create a group is its permanent **Original leader / owner** in this MVP.
- The original leader can add a new person directly as a **Group leader**, or promote an existing member.
- The original leader can demote an additional leader back to Member.
- Additional leaders cannot promote/demote other leaders.
- All leaders can approve/reject requests, add ordinary members, see all balances, and edit allowances.
- All leaders' own vacation requests are auto-approved.
- Pending-request notification emails are sent to all leader email addresses.

## Current limitations

- Whole-day vacation only; no half-days yet.
- The annual allowance value is the same for every year until changed.
- Public-holiday data is bundled through 2031 and should be updated later.
- No automatic carry-over.
- No approval/rejection notification email to the requester yet.
- No owner-transfer workflow yet. The original leader cannot currently transfer ownership to another account.

## License

MIT

## v0.4 — contract start dates and half-days

Existing v0.3 installations should run this migration once in **Supabase → SQL Editor**:

```text
supabase/004_contract_proration_half_days.sql
```

Then redeploy the notification Edge Function because request emails now describe half-days:

```bash
supabase functions deploy notify-vacation-request
```

### Contract start date and prorating

- Every group membership now has a `contract_start_date`.
- A group leader can enter it when adding the person or edit it later in **Members**.
- A member can also set or correct their own start date in **My vacation**.
- Vacation cannot be requested until the contract start date is set, and vacation cannot start before the contract.
- `annual_allowance_days` remains the person's **full-year entitlement** (for example 25 days).
- In the contract-start year, the effective allowance is prorated using the exact number of calendar days employed in that year and rounded to the nearest 0.5 day.
- Years before the contract start have 0 entitlement; later complete years receive the full-year entitlement.
- Weekends and official Canton of Vaud public holidays continue to be excluded from charged vacation days.

### Half-day vacation

A one-day request can be:

- full day,
- morning only (0.5 day), or
- afternoon only (0.5 day).

For a multi-day request, the first day may start in the afternoon and/or the last day may end after the morning. The shared calendar marks half-days with `AM` or `PM`.

The database overlap check is half-day aware, so a morning vacation and an afternoon vacation on the same date do not conflict.
