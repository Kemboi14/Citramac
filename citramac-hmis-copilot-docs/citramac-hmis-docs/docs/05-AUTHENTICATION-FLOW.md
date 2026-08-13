# 05 — Authentication & Login Flow (exact specification)

This flow is **mandatory and specific** — do not simplify to a single email+password form. It applies to both **first-time account activation** and **returning-user login**, with slightly different branches described below. All screens use the design tokens in `03-DESIGN-SYSTEM.md` (green-dark sidebar/hero, Lexend headings, Inter body, `--radius-md` cards, `--green` primary buttons).

## 5.1 Guiding principle

Identity is confirmed **progressively**, one fact at a time, before any password is ever touched:

```
Step 1: Confirm identity (name lookup against DB)
Step 2: Confirm email (matched to that identity)
Step 3: Email verification via OTP (prove ownership of the email)
Step 4: Set / enter password
Step 5: Redirect to standard login page
```

This is deliberately different from a typical "type username+password" flow because staff accounts are **pre-provisioned by an Org Admin** (see `04-MULTI-TENANCY.md` §4.5) — the user did not choose their own username, so we walk them from "who are you" → "verify you own this inbox" → "set your credential" → "now log in normally going forward."

## 5.2 First-time activation flow (new staff member)

**Screen A — Identify yourself**
- Input: full name (or staff ID / UHID-style identifier depending on role).
- On submit: `POST /api/v1/auth/identify/` with `{ "name": "..." }` (or identifier).
- Backend looks up a matching, **pending-activation** `User` record scoped by invite token/organization context (the invite link already encodes `organization_id` + a one-time `activation_token`, so this is not an open name-guessing oracle — see security note in §5.5). If the name matches the record tied to the token: proceed. If not: generic "We couldn't confirm those details" error (no information disclosure about which field was wrong).

**Screen B — Confirm your email**
- The system displays the **partially masked** email on file (e.g. `n***@cafric.org`) and asks the user to confirm/type it to prove they know it, or simply asks "Is this your email?" with Yes/Edit-request-admin options.
- On submit: `POST /api/v1/auth/confirm-email/` with `{ "activation_token": "...", "email": "..." }`.
- If it matches the record: system immediately dispatches a 6-digit OTP to that email (via Celery task, `notifications` app) and advances to Screen C. OTPs expire in 10 minutes, are single-use, and are rate-limited (max 5 requests / 30 minutes per identity).

**Screen C — Enter the OTP**
- 6-digit code input (auto-advancing boxes), "Resend code" link (disabled/cooldown for 60s), countdown timer.
- On submit: `POST /api/v1/auth/verify-otp/` with `{ "activation_token": "...", "otp": "123456" }`.
- On success: mark `User.email_verified_at = now()`, issue a short-lived **`password_setup_token`**, advance to Screen D.
- On failure: show inline error, decrement remaining attempts (lock after 5 failed attempts, require new OTP request).

**Screen D — Create your password**
- Password + confirm-password fields, live strength meter, requirements checklist (≥12 chars, upper+lower+digit+symbol — see `09-SECURITY-COMPLIANCE.md` for the exact policy).
- On submit: `POST /api/v1/auth/set-password/` with `{ "password_setup_token": "...", "password": "..." }`.
- Backend hashes with Argon2 (Django's `Argon2PasswordHasher`), sets `User.is_active = True`, invalidates the activation token.

**Screen E — Redirect to standard login**
- Success toast: "Account activated. Please sign in." → hard redirect to `/login`.
- The user now logs in like any returning user (§5.3). We deliberately do **not** auto-log-them-in at the end of activation — this guarantees the password they just set actually works end-to-end and matches the requirement "must verify the email then take you to the next page of password... then redirect to login page."

## 5.3 Returning-user login flow

**Screen: Standard login**
- Fields: Email (or Staff ID) + Password, "Forgot password?" link, tenant/branch is inferred from the account (a user belongs to one Organization; if multi-branch, branch selection happens post-login in the topbar).
- On submit: `POST /api/v1/auth/login/`.
- Backend validates credentials → if valid **and** the account has 2FA/OTP-on-login enabled (recommended default ON for Admin and clinical roles handling PHI, per `09-SECURITY-COMPLIANCE.md`), dispatch a fresh login OTP and show the OTP screen (reusing the Screen C component) before issuing the session.
- On success: issue **JWT access token (short-lived, 15 min) + refresh token (httpOnly secure cookie, 7 days, rotated on use)**. Redirect to the correct shell (Super Admin / Org Admin / Clinical Workspace) based on the user's highest role.

**Forgot password flow** reuses the same primitive building blocks: identify (by email) → OTP verification → set new password → redirect to login. This keeps one shared component set (`<IdentifyStep>`, `<EmailConfirmStep>`, `<OtpStep>`, `<PasswordSetStep>`) reused for both activation and reset, configured by a `flow_type` prop/state (`ACTIVATION | RESET | LOGIN_2FA`).

## 5.4 Frontend component/state design

```
frontend/src/auth/
  AuthFlowController.tsx      # orchestrates step state machine, holds activation_token / password_setup_token
  steps/
    IdentifyStep.tsx
    EmailConfirmStep.tsx
    OtpStep.tsx
    PasswordSetStep.tsx
  LoginPage.tsx                # standard returning-user login (§5.3)
  ForgotPasswordFlow.tsx       # reuses steps above with flow_type=RESET
```

State machine (finite states, no skipping forward without backend confirmation of the previous step):

```
IDENTIFY → EMAIL_CONFIRM → OTP_PENDING → OTP_VERIFIED → PASSWORD_SET → DONE (redirect /login)
```

Each transition is server-validated (frontend never locally "decides" a step passed) — the backend returns the opaque token needed for the next step, and each endpoint re-validates that token server-side.

## 5.5 Security notes specific to this flow

- The activation link (containing `organization_id` + one-time `activation_token`) is what makes Screen A safe — without a valid, unexpired token the identify endpoint returns 404-equivalent generic errors and does not allow arbitrary name enumeration across the whole platform.
- Rate limit every step (`identify`, `confirm-email`, `verify-otp`, `set-password`) per IP and per token to prevent brute forcing.
- OTPs are generated with a CSPRNG, stored hashed (never plaintext) server-side, compared in constant time.
- All auth endpoints are TLS-only, CSRF-protected where cookie-based, and logged to the immutable audit trail (`09-SECURITY-COMPLIANCE.md`) including failed attempts (without logging the OTP/password values themselves).
- Session/JWT claims embed `organization_id`, `branch_ids[]`, and `role` so the `TenantMiddleware` (`04-MULTI-TENANCY.md`) can scope every subsequent request without an extra DB hop.

## 5.6 API endpoint summary

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/v1/auth/identify/` | POST | Step 1 — confirm name/identifier against invite token |
| `/api/v1/auth/confirm-email/` | POST | Step 2 — confirm email, triggers OTP dispatch |
| `/api/v1/auth/verify-otp/` | POST | Step 3 — verify OTP, issue password_setup_token |
| `/api/v1/auth/resend-otp/` | POST | Resend OTP (rate-limited) |
| `/api/v1/auth/set-password/` | POST | Step 4 — set password, activates account |
| `/api/v1/auth/login/` | POST | Standard login (email/staff-id + password) |
| `/api/v1/auth/login/verify-otp/` | POST | Login-time 2FA OTP verification |
| `/api/v1/auth/refresh/` | POST | Rotate refresh token → new access token |
| `/api/v1/auth/logout/` | POST | Revoke refresh token |
| `/api/v1/auth/forgot-password/` | POST | Start reset flow (reuses identify+email+OTP steps) |
