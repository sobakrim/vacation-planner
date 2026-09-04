# Security notes

## Authentication

The frontend uses Supabase Auth. Normal sign-in is email + password. New-account setup first verifies control of the email address through a Supabase email link, then the authenticated user chooses a password with `updateUser()`.

Passwords are handled by Supabase Auth. The vacation application's public tables never store password hashes or password-reset tokens.

The **Create account** email link is itself a valid email-possession authentication factor. A person with access to the mailbox can therefore complete account setup/reset; protect the mailbox accordingly.

## Group membership

A leader pre-registers the exact email address for each group member. After authentication, `claim_memberships()` binds an unclaimed membership row to `auth.uid()` only when the authenticated email matches. v0.3 tightens membership/leader helpers so a row already bound to another user ID is not accepted solely because an email string matches.

## Multiple leaders

- `vacation_groups.leader_user_id` remains the immutable original owner/founder identity in v0.3.
- Additional leaders use `vacation_group_members.role = 'leader'`.
- `_vacation_is_leader()` authorizes every valid leader membership.
- `_vacation_is_owner()` authorizes only the original creator.
- Only `_vacation_is_owner()` may call `promote_group_leader()` or `demote_group_leader()`.
- Additional leaders receive normal leader powers but cannot create more leaders.

The UI is not the security boundary; every privileged operation checks the caller again inside PostgreSQL.

## Database boundary

The browser has no direct CRUD permissions on the application tables. It calls scoped security-definer RPC functions instead.

Vacation balance privacy remains database-enforced:

- `get_my_vacation_balance` returns only the caller's balance.
- `get_group_vacation_balances` requires leader status.
- `set_member_allowance` requires leader status.
- `cancel_vacation` requires that the request belongs to `auth.uid()`, is approved, and has not started.

## Notification email

The Resend API key and Supabase secret/service-role key remain only in the Supabase Edge Function environment. The v0.3 notification function reads current leader email addresses server-side and sends pending-request notifications to those leaders. No secret key belongs in GitHub Pages or in a `VITE_...` variable.

## Vacation cancellation

Future approved vacation is marked `cancelled` rather than deleted. This preserves history while removing the vacation from the shared calendar and balance. No leader notification is sent for the user's own cancellation.

## Public holidays and balance calculation

The database is authoritative for balance calculations. It counts weekdays and excludes dates present in `vacation_public_holidays`. The React frontend contains the same holiday data for display and previews.

## Deployment note

This is still an MVP rather than a formally audited HR system. Before institutional/high-volume deployment, add rate limiting, audit logging, backup/restore procedures, stronger email-delivery monitoring, and an independent security review.

## v0.4 contract and half-day notes

Contract start dates are visible only to the member concerned and group leaders through authenticated RPCs. Members may edit their own contract start date because this is an explicit product requirement; group leaders can also correct it. For a formal HR deployment, consider adding an audit trail or leader approval for contract-date changes.

Half-day validation, overlap detection, contract-date requirements, and charged-day calculations are enforced server-side in the v0.4 RPCs; the legacy vacation-request RPC is revoked from authenticated browser users so those checks cannot be bypassed by calling the old endpoint directly.
