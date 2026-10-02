# Group Vacation Planner v0.6.2

A privacy-conscious group vacation calendar built with React, GitHub Pages and Supabase.

## Current workflow

1. A user creates an account and signs in.
2. If they have no group yet, they can create one and become its administrator.
3. An administrator adds people by **name + exact email address** and, when relevant, their contract start date for the current year.
4. **No invitation email is sent.** The administrator simply tells the person to open the Vacation Planner and create an account using that exact email address.
5. On sign-in, `claim_memberships()` links any pre-added membership with the authenticated account email, and the group appears automatically.
6. Members add vacation directly. There is no approval workflow.
7. Members can cancel their own vacation, including historical entries.

## Existing features

- Shared group vacation calendar.
- Direct vacation booking without manager approval.
- Past vacation entries allowed, provided they are not before the contract start date.
- Full days and half-days.
- Vaud public holidays and weekends excluded from charged vacation days.
- First-year entitlement prorated from contract start date.
- Positive and negative year-end balances carry forward automatically.
- Private vacation balance for each member; administrators can see the group balances.
- Multiple group administrators; only the original administrator can grant/remove administrator rights.
- Email + password accounts handled by Supabase Auth.

## Supabase migrations

For a fresh installation, run the migrations in order:

```text
supabase/001_init.sql
supabase/002_balances_holidays_cancellation.sql
supabase/003_accounts_multi_leaders.sql
supabase/004_contract_proration_half_days.sql
supabase/005_balance_carryover.sql
supabase/006_no_approval_member_invites.sql
supabase/007_membership_scoped_calendar.sql
```

Despite the historical filename of migration 006, v0.6.1 does **not** send invitations. The useful database behavior from that migration remains: direct booking, past entries/cancellation, and email-based membership claiming.

For v0.6.2, run `supabase/007_membership_scoped_calendar.sql` after migration 006. It removes legacy orphaned vacation entries from the shared calendar and ensures only current group members are shown.

## Authentication setup

In Supabase, configure **Authentication → URL Configuration**:

```text
Site URL: https://YOUR_USERNAME.github.io/YOUR_REPOSITORY/
Redirect URL: https://YOUR_USERNAME.github.io/YOUR_REPOSITORY/**
```

A new member uses **Create account**, enters the same email address the administrator added, opens the normal Supabase verification email, chooses a password, and then signs in. Their pre-added group appears automatically.

The only email in this workflow is Supabase's normal account verification/reset email. There is no custom member-invitation email and no Resend integration required.

## GitHub Pages variables

Create these repository Actions variables:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

Then enable **Settings → Pages → Source → GitHub Actions**.

## Upgrade from v0.6.1

Replace the frontend files with v0.6.2, run `supabase/007_membership_scoped_calendar.sql`, and redeploy GitHub Pages. No Edge Function deployment is needed.

If `invite-group-member` is still deployed in Supabase, it can be deleted because the application no longer calls it.

## Local build

```bash
npm install
npm run build
```
