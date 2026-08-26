# 14 — Tenant-Branded Login UX

Operational doc, added after `docs/01`–`13` (the numbered specs are treated
as read-only source-of-truth and are never hand-edited — see
`docs/PROJECT-STATUS.md`'s header note). This doc records a deliberate,
explicit product decision that **supersedes `docs/05-AUTHENTICATION-FLOW.md`
§5.3** ("Standard login" — plain email+password, no tenant branding) for
returning-user login specifically. Everything else in `docs/05` — activation
(§5.2) and forgot-password (§5.3's second half) — is unchanged.

## 14.1 Why

A set of five HTML mockups (`citramac-tenant-discovery.html`,
`citramac-tenant-discovery-error.html`, `citramac-welcome.html`,
`citramac-tenant-login.html`, `citramac-mfa.html`) specified that returning
staff should see their **own organization's** logo, tagline, and brand color
on the login screen before touching a password, plus a choice of SMS or
email for 2FA — not a generic CITRAMAC page. This doc is the spec for that,
in the same shape `docs/05` uses for the flows it covers.

## 14.2 Flow

```
Step 1: Tenant discovery  — work email -> resolve organization by email domain
Step 2: Tenant login      — branded password screen (that org's logo/color/tagline)
Step 3: 2FA (optional)    — SMS or email OTP, masked contact, channel switch
Step 4: Redirect to the user's shell (Super Admin / Org Admin / Clinical Workspace)
```

**Screen 1 — Tenant discovery** (`TenantDiscoveryStep.tsx`)
- Input: work email.
- `POST /api/v1/auth/tenant-discovery/` with `{ "email": "..." }`.
- Resolves by **email domain** against `Organization.email_domains`
  (a JSON list, e.g. `["cafric.org"]`), not by looking up a specific user —
  this is the load-bearing anti-enumeration property (see §14.4). On match:
  returns that org's branding. On no match: `404` with a generic
  `TENANT_NOT_FOUND` error ("We couldn't continue with the information
  provided. Please contact your organisation administrator.") — same copy,
  same component, just a different visual state (this is
  `citramac-tenant-discovery-error.html` folded into the same screen rather
  than a separate route, since it's the same form with a different result).
- Rate-limited per IP (20 attempts / 10 minutes) — same
  `enforce_rate_limit` helper as every other auth-flow step.

**Screen 2 — Tenant login** (`TenantLoginStep.tsx`)
- Split-panel card: a colored panel showing the org's `logo_url` (falls back
  to a generic building glyph + the org name/tagline as text if no logo is
  configured — the static mockup always had a logo, so this fallback is a
  real-system addition, not in the mockup), and a password form scoped with
  the org's `primary_color` via a `--tenant-primary` CSS variable local to
  that card only (never touches the app-wide `--green` brand token).
- Email is carried over from Screen 1 (read-only, with a "Change" link back
  to Screen 1) rather than re-typed.
- `POST /api/v1/auth/login/` with `{ email, password, remember }` — same
  endpoint `docs/05` §5.3 already specifies, extended with `remember`
  (§14.3) and a richer 2FA response shape (§14.3).
- "Forgot password?" links to the app's real `/forgot-password` self-service
  flow (`docs/05` §5.3), not a support mailto — the mockup used a mailto
  placeholder since it had no backend to wire up; keeping the working
  in-app flow is strictly better UX and loses nothing the mockup intended.
  A mailto to the org's `support_email` (falling back to
  `support@citramac.com`) is offered separately as a "Need help?" link.

**Screen 3 — 2FA** (`LoginMfaStep.tsx`)
- Shown only if `User.mfa_enabled` (unchanged from `docs/05` §5.3).
- If the user has a `phone` on file, they can pick SMS or email; otherwise
  only email is offered. Each option shows a masked contact
  (`_mask_email`/`_mask_phone` in `apps/accounts/auth_views.py`).
- Switching the selected channel triggers a real resend via
  `POST /api/v1/auth/resend-otp/` with `{ otp_token, channel }` — the
  previous OTP is invalidated and a new one dispatched on the newly chosen
  channel, same 60s-cooldown discipline as every other resend in the app.
- 6-digit boxes with auto-advance, backspace-to-previous, and paste-fill —
  same interaction pattern as the shared `<OtpStep>`, reimplemented here
  (not shared) because this screen's channel-selection and masked-contact
  concepts don't apply to activation/reset, and threading conditional props
  for a login-only concept through the shared component would have made it
  harder to reason about for the flows that already use it correctly.
- Verifies via the existing `POST /api/v1/auth/login/verify-otp/` — no
  backend change needed here, `LoginMfaStep` calls the same
  `loginVerifyOtp` the old single-page login used.

## 14.3 Backend additions

- `Organization` (`apps/tenancy/models.py`): `email_domains` (JSON list),
  `logo_url`, `login_image_url`, `tagline`, `primary_color` (hex, default
  `#006e51` — the existing brand green, so an unconfigured tenant still
  looks correct), `support_email`, `support_phone`, `website`. Configured
  via Django admin (`OrganizationAdmin`'s new fieldset) or
  `onboard_tenant`'s new `--email-domain` (repeatable)
  `--logo-url`/`--tagline`/`--primary-color`/`--support-email`/
  `--support-phone`/`--website` flags.
- `User.preferred_mfa_channel` (`EMAIL` | `SMS`, default `EMAIL`).
- `POST /api/v1/auth/tenant-discovery/` (`TenantDiscoveryView`) — see §14.2.
- `LoginView` response, when `mfa_enabled`, now includes `channel` (which
  channel the OTP actually went out on) and `delivery_methods` (the list of
  `{channel, masked_contact}` the user can choose from) alongside the
  existing `requires_otp`/`otp_token`.
- `LoginSerializer` gained `remember` (bool, default `false`) — controls
  only whether the `refresh_token` cookie persists across browser restarts
  (`max_age` set vs. omitted, i.e. session cookie). It does **not** change
  `SIMPLE_JWT.REFRESH_TOKEN_LIFETIME` (still 7 days) — a browser that closes
  without "remember me" simply stops offering the cookie back; the token
  itself isn't shortened or lengthened.
- `ResendOtpSerializer` gained an optional `channel` — only meaningful for
  `LOGIN_2FA` purpose OTPs (activation/reset resends ignore it and keep
  using email, unchanged).
- `apps/notifications/tasks.py` gained `send_otp_sms` — an honest stub (logs
  a structured, code-free event; no SMS gateway is wired up yet), same
  pattern as the Sentry-DSN-empty stub already established in
  `config/settings`. Swapping in a real gateway (e.g. Africa's Talking)
  later doesn't require any caller change.

## 14.4 Security notes

- Tenant discovery matches on **email domain**, never on whether a specific
  email address has an account. The worst it discloses is "some CITRAMAC
  tenant uses this domain" — no more sensitive than a company's own public
  domain name — so the anti-enumeration principle `docs/05` §5.5 establishes
  for the rest of the auth flow still holds here. This was a deliberate
  design choice over the more literal "look up this exact email" reading of
  the mockups, which would have reopened the exact oracle §5.5 was written
  to close.
- `remember` only affects cookie persistence, not token lifetime or the
  account-lockout/rate-limit behavior already in place for `/auth/login/`.
- Every new endpoint follows the existing `_error`/`_generic_error` shape
  and is rate-limited the same way as the rest of the flow (§5.5).
