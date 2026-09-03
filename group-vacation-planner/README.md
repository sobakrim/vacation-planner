# Group Vacation Planner

A small, privacy-conscious vacation calendar for a team or research group.

## Workflow

- The group leader creates the group and adds each member's email address.
- Everyone signs in with a magic link sent to their email.
- Every group member can see the shared calendar of **approved** vacations.
- A normal member submits a vacation request. It stays **pending** and an email is sent to the leader.
- The leader approves or rejects the request inside the app.
- An approved request immediately appears in the shared calendar.
- The leader's own vacation is approved immediately and does not require another person to validate it.

## Stack

- React + TypeScript + Vite
- GitHub Pages for the frontend
- Supabase Auth (email magic-link login)
- Supabase Postgres for groups, members, requests, and approvals
- Supabase Edge Function + Resend for the leader notification email

## Security model

- Users must authenticate by email before any app RPC can be called.
- The leader explicitly whitelists member email addresses for each group.
- The browser has no direct SELECT/INSERT/UPDATE/DELETE permission on the application tables.
- All browser data access is through security-definer RPC functions that validate `auth.uid()` and the authenticated email.
- The Resend API key and Supabase secret key are never placed in the frontend or GitHub Pages build.
- The email Edge Function verifies the calling user's JWT and checks that the caller created the pending request before sending the leader an email.
- Only approved vacations are returned by the shared-calendar RPC.

This is an MVP, not a formally audited HR system. For sensitive institutional deployment, have your IT/security team review the schema and email setup first.

## 1. Create a Supabase project

Create a new Supabase project, then open **SQL Editor → New query** and run the complete contents of:

```text
supabase/001_init.sql
```

You do not need to create any tables manually.

## 2. Configure email login in Supabase

In Supabase go to **Authentication → URL Configuration**.

For local development, add:

```text
http://localhost:5173/
```

For GitHub Pages add your final URL, for example:

```text
https://YOUR_USERNAME.github.io/group-vacation-planner/
```

Use that GitHub Pages address as the Site URL once the app is deployed.

The frontend uses `supabase.auth.signInWithOtp()`, which sends a magic link by email.

## 3. Frontend environment variables

Copy the project URL and the **publishable key** from Supabase.

For local development:

```bash
cp .env.example .env.local
```

Then fill:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Never put a Supabase secret/service-role key in a `VITE_...` variable.

## 4. Install and test locally

Requires Node 24 or newer.

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

## 5. Configure the leader notification email

The included Supabase Edge Function uses Resend.

Create a Resend account and API key. For production email delivery, verify a sending domain in Resend.

Set these three **Supabase Edge Function secrets**:

```text
RESEND_API_KEY=re_...
VACATION_EMAIL_FROM=Vacation Planner <vacation@YOUR_VERIFIED_DOMAIN>
APP_URL=https://YOUR_USERNAME.github.io/group-vacation-planner/
```

You can set them in the Supabase dashboard under Edge Functions / Secrets, or with the Supabase CLI:

```bash
supabase secrets set RESEND_API_KEY=re_...
supabase secrets set 'VACATION_EMAIL_FROM=Vacation Planner <vacation@YOUR_VERIFIED_DOMAIN>'
supabase secrets set APP_URL=https://YOUR_USERNAME.github.io/group-vacation-planner/
```

Supabase provides its own project URL and server-side API keys to hosted Edge Functions; do not copy those into the repository.

## 6. Deploy the Edge Function

Install/login to the Supabase CLI, link the project, and deploy:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy notify-vacation-request
```

The function source is:

```text
supabase/functions/notify-vacation-request/index.ts
```

If the email service is temporarily unavailable, the vacation request is still saved in the database and remains visible to the leader in the **Approvals** tab. The frontend displays a warning that only the notification failed.

## 7. Deploy the website to GitHub Pages

Create a GitHub repository and put the project files at the repository root.

In GitHub create these repository **Actions variables**:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

Path:

**Settings → Secrets and variables → Actions → Variables**

Then go to:

**Settings → Pages → Build and deployment → Source → GitHub Actions**

The included workflow:

```text
.github/workflows/deploy-pages.yml
```

runs `npm install`, builds the Vite app, and deploys `dist/` to Pages on every push to `main`.

The URL will normally be:

```text
https://YOUR_USERNAME.github.io/YOUR_REPOSITORY/
```

## 8. First use

1. Open the website.
2. Enter your email and click the magic link you receive.
3. Create the group. You become its leader.
4. Open **Members** and add each person's name and exact login email.
5. Send the website URL to the group.
6. A member signs in with the email you added.
7. The group appears automatically for that member.
8. The member submits vacation dates.
9. The leader receives an email and opens **Approvals**.
10. After approval, the vacation appears for everybody in **Calendar**.

## Current behavior

- One account can belong to more than one group.
- Only the leader sees member email addresses and pending requests.
- All group members see names and approved vacation dates in the shared calendar.
- Pending/rejected requests are visible to the requester and the leader, not the rest of the group.
- A member can withdraw their own pending request.
- The leader's requests are automatically approved.
- Overlapping pending/approved requests by the same person are blocked.
- Vacation duration is calendar days, not business days.

## Possible next improvements

- Email the requester when a request is approved/rejected.
- Add half-days.
- Count business days and local public holidays.
- Add yearly entitlement / remaining vacation balance.
- Add team-wide absence limits (for example no more than 2 people away at once).
- Add an Outlook/Google Calendar export for approved vacation.
- Add a leader dashboard with yearly statistics.
