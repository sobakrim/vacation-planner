# Security notes

## Frontend keys

Only these values belong in the public GitHub Pages build:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

The Supabase publishable key is meant for public clients when database access is protected. Do not put `SUPABASE_SECRET_KEYS`, a service-role key, or `RESEND_API_KEY` in a Vite variable.

## Database access

The three application tables have Row Level Security enabled and direct privileges are revoked for `anon` and `authenticated` roles. Browser operations use explicit RPC functions that validate the authenticated user.

The internal helper RPCs begin with `_vacation_` and execution is revoked from browser roles.

## Email notification

`notify-vacation-request` runs server-side as a Supabase Edge Function. It:

1. requires an authenticated bearer token,
2. resolves the authenticated Supabase user,
3. checks that the supplied request ID belongs to that user,
4. checks that the request is still pending,
5. atomically marks the notification as claimed to reduce duplicate sends,
6. resolves the leader email using the server-side Supabase client,
7. sends through Resend,
8. clears the claim if the email provider rejects the message.

The frontend never receives the leader's auth record or any server secret.

## Membership

Group access is tied to the normalized authenticated email and then claimed by `auth.uid()`. A leader must add the exact member email before that account can see the group.

## Before institutional production

Recommended additions:

- use a verified institutional sending domain,
- configure custom SMTP for Supabase Auth magic-link delivery,
- add rate limiting / abuse monitoring,
- review Supabase Auth session lifetime and MFA requirements,
- add audit logging for approvals and member changes,
- back up the database,
- conduct an independent security/privacy review,
- document retention and deletion policies.
