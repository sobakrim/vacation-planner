# Security notes

## Membership access

Group membership is controlled by the email address stored by a group administrator. When an authenticated user opens the app, the database `claim_memberships()` function links any unclaimed membership whose normalized email matches the authenticated Supabase Auth email.

The frontend does not decide access by itself. Group RPCs continue to verify the authenticated user server-side.

## No invitation service

v0.6.1 does not send custom invitation emails and does not require a member-invitation Edge Function, Resend API key, or service-role key in the frontend.

New users independently create their account with the exact address pre-added by the group administrator. Standard account-verification and password-reset emails are handled by Supabase Auth.

## Frontend secrets

GitHub Pages should contain only:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

Never put a Supabase service-role/secret key in a `VITE_...` variable or in browser code.
