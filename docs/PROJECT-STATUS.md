# CITRAMAC — Project Status

_Snapshot as of 2026-08-14, `master` @ `5f6d5ad`. Generated from the actual
repo state (git log, app/model/migration inventory, settings, CI configs) —
not from the roadmap doc alone. Superseded by newer commits; regenerate
rather than hand-edit stale sections._

## What CITRAMAC is

Multi-tenant, DHA-certifiable, SHA-integrated Hospital & Mental Health
Management Information System for Kenya. Reference tenant: **CAfRIC Centre**
(mental-health/trauma/SUD-rehab facility). This deployment is scoped strictly
to mental-health/CCP facilities — general-hospital-only modules are
deliberately not wired in (see "Excluded modules" below).

Spec docs (read-only source of truth): `docs/01` through `docs/13`. Everything
else in `docs/` (this file included) is an operational doc added after the
fact.

## Phases completed (0–9), all merged to `master`

| Phase | Commit | What shipped |
|---|---|---|
| 0 | `f4bea19` | Repo/tooling scaffold, split settings, pre-commit, CI skeleton |
| 1 | `3186b96` | Tenancy (Postgres RLS + `TenantScopedManager`), Identity & Auth (JWT, 5-step flow), RBAC scaffold, audit log |
| 2 | `f203af7` | Design system + Tailwind tokens, Super Admin / Org Admin / Clinical Workspace shells |
| 3 | `67a802d` | Core clinical path: Client Registry, Triage/MSE, Clinical Encounter (Modules 1–3) + CCP core (Biopsychosocial, Psychotherapy sessions) |
| 4 | `36339f7` | Billing + Insurance/Claims (Modules 10–11), POS validation gate, SHA gateway skeleton |
| 5 | `8317f5f` | LIMS, Pharmacy (FEFO dispensing), IPD/Ward, CCP extensions (SUD Rehab, Supervision Requests, CCP Team, NACADA NDO report) |
| 6 | `872d2c2` | Real FHIR Bundle construction + HIE transmission stub, terminology sync scaffolding, SHA gateway real-vs-stub flag + JWS signing, offline-mode sync (push/pull, last-write-wins) + frontend local-first queue |
| 7 | `d32eac5` | RBAC gap closure, sensitive-record VIEW audit logging, versioned consent capture, two-person right-to-erasure workflow, security headers, backup/restore runbook, DPIA |
| 8 | `731395e` | Kubernetes manifests + Kustomize overlays, Terraform (VPC/EKS/RDS/storage), GitHub Actions CI/CD (build→scan→staging→gated production), django-structlog + Sentry (PHI-stripped) |
| 9 | `5f6d5ad` | `onboard_tenant` + `seed_dha_sandbox_demo` management commands, Prometheus metrics/Alertmanager/Grafana manifests, DHA certification readiness walkthrough |

Full phase-by-phase build notes (bugs found and fixed, honest stubs, what was
explicitly *not* built) are in memory / prior session history — this table is
the index, not the detail.

## Backend — apps actually wired in

`LOCAL_APPS` in `backend/config/settings/base.py`, in load order:

| App | `models.py` | Migrations | Purpose |
|---|---|---|---|
| `tenancy` | 107 lines | 2 | Organization/Branch/Role, RLS |
| `accounts` | 302 lines | 3 | Custom `User` (UUID pk, email/staff_id, no username), JWT auth |
| `client_registry` | 298 lines | 6 | Module 1 — patient registry, IPRS/SHA coverage stubs |
| `triage` | 98 lines | 2 | Module 2 — triage + Mental Status Exam, ESI acuity |
| `clinical_encounter` | 152 lines | 2 | Module 3 — SOAP notes, ICD-11 diagnosis, CPOE/e-prescribing stubs |
| `lims` | 82 lines | 2 | Module 4 — lab orders/results |
| `pharmacy` | 92 lines | 2 | Module 6 — dispensing, FEFO stock logic |
| `ipd_ward` | 112 lines | 2 | Module 7 — inpatient/ward management |
| `billing` | 113 lines | 2 | Module 10 — billing engine, POS validation gate |
| `insurance_claims` | 82 lines | 2 | Module 11 — domestic claims + SHA gateway |
| `sysadmin_audit` | 83 lines | 3 | Immutable audit log, sensitive-record view logging |
| `ccp_program` | 232 lines | 4 | CCP core + extensions: Biopsychosocial, Psychotherapy, SUD Rehab, Supervision Requests, CCP Team, NACADA NDO |
| `dha_interop` | 160 lines | 4 | FHIR mapping, HIE client, SHA gateway (real + stub), terminology sync |
| `notifications` | models stub; `tasks.py` has `send_otp_email`/`send_otp_sms`/`send_invite_email`/risk-alert Celery tasks | 0 | No persisted `Notification` model yet — dispatch-only tasks used by the auth flow |
| `offline_sync` | 64 lines | 3 | Local-first push/pull sync, conflict log |

Every app has a `tests.py`; no dedicated `tests/` packages were found, so exact
test-count/coverage wasn't verified in this pass — run `pytest` in `backend/`
for current numbers.

### Excluded modules (scaffolded but never installed)

`ris_pacs`, `theatre`, `mch`, `mortuary` exist as directories under
`backend/apps/` but contain only Django `startapp` boilerplate (empty
`models.py`, placeholder `views.py`/`tests.py`) and are **not** in
`LOCAL_APPS`. This is deliberate, documented in `base.py`: these are
general-hospital-only modules (RIS/PACS, Theatre, MCH, Mortuary — Modules
5/8/9/12 per `docs/07` §7.14) and CAfRIC is not a general hospital.

### Backend stack

Django 5.2, DRF 3.17, SimpleJWT (+ token blacklist), `django-environ` config,
Postgres via `psycopg[binary]` 3.3, Celery 5.6 + Redis 8, Argon2 password
hashing, `fhir.resources` 8.3 for real FHIR Bundle construction,
`django-structlog` + Sentry (DSN-gated, PHI-stripped `before_send`),
`django-prometheus` for metrics, `cryptography` 50 (JWS signing for SHA
gateway).

## Frontend

React 19 + Vite 8 + TypeScript (strict) + Tailwind + React Router 7. Three
role-based shells (`frontend/src/shells/`) for Super Admin / Org Admin /
Clinical Workspace. Built-out clinical pages under
`frontend/src/modules/clinical/`: Client Registry, Triage/MSE, Clinical
Encounter, individual/family/group Psychotherapy, IPD, Pharmacy, LIMS, CCP
Team, Supervision Requests, NACADA report, Clinical Review. One Org Admin
page built (`ErasureRequestsPage.tsx`); unbuilt module slots render via
`PlaceholderPage.tsx` with a "Soon" badge per the design spec. Test tooling:
Vitest + Testing Library + jsdom, ESLint (+ `eslint-plugin-security`),
Prettier.

## Infrastructure

- **`infra/k8s`**: base manifests (backend/frontend/celery-worker/celery-beat
  as separate Deployments+Services, nginx Ingress + cert-manager, HPA,
  default-deny NetworkPolicy, ExternalSecret via AWS Secrets Manager/IRSA)
  plus `dev`/`staging`/`production` Kustomize overlays, and a
  `monitoring/` set (Prometheus, Alertmanager, Grafana — hand-rolled
  manifests, no operator/CRDs). Validated with `kubectl kustomize` only — no
  live cluster has ever been targeted.
- **`infra/terraform`**: `vpc`/`eks`/`rds`/`storage` modules + per-environment
  configs, sized per environment. Validated with `terraform validate`/`fmt
  -check` against no backend and no real AWS credentials — `terraform apply`
  has never been run against a live account.
- **`.github/workflows`**: `build-and-scan.yml` (Trivy CVE gate) →
  `deploy-staging.yml` (auto) → `deploy-production.yml` (manual-approval
  gated), plus `terraform-plan.yml`/`terraform-apply.yml`, all via OIDC (no
  static AWS keys). No container build has actually been run end-to-end in
  this environment (no container runtime available here).

## Compliance / hardening posture

Versioned consent capture, two-person right-to-erasure workflow, sensitive
clinical record VIEW audit logging, security headers middleware (CSP,
Referrer-Policy, Permissions-Policy), backup/restore runbook (drill-tested
against a real local Postgres, dedicated `citramac_backup` role with
BYPASSRLS+CREATEDB), and a DPIA document
(`docs/DPIA-CAFRIC-MENTAL-HEALTH-CCP.md`) specific to CAfRIC's mental-health
data processing.

## Demo / sandbox data

Org `cafric-demo` provisioned via the `onboard_tenant` management command
(module bundle + Org Admin + staff invites). Demo users, all password
`DemoPass123!`, `mfa_enabled=False`:
- `demo.clinician@cafric.test`
- `demo.labtech@cafric.test`
- `demo.orgadmin@cafric.test`

`seed_dha_sandbox_demo` populates a full pre-auth → e-claim → remittance
cycle and a FHIR referral Bundle against `cafric-demo`, for DHA-evaluator
walkthroughs per `docs/08` §8.6.

## Known, disclosed gaps (not silently deferred)

- **DHA certification lifecycle steps 3–5** (sandbox integration testing,
  live evaluator technical demo, certification + national registry listing)
  are genuinely external/administrative — they need a real DHA Portal
  account, real SHA sandbox credentials, and live infrastructure. None of
  those exist in this build environment; no amount of further local coding
  closes this gap.
- **"Noisy neighbor" multi-tenant load testing** — called for as a Phase 7
  exit criterion, never actually executed. No k6/Locust artifacts exist
  anywhere in the repo.
- **TLS 1.3 enforcement** — not independently verified against a live
  ingress/load balancer (no live cluster exists to verify against).
- **No live-cluster or live-AWS-account validation** for either the K8s
  manifests or the Terraform modules — both are validated only via
  local/offline tooling (`kubectl kustomize`, `terraform validate`).
- **`notifications` app** is a stub (`models.py` is 1 line) — scaffolded per
  the repo layout but not built out.
- **README.md's "Current status" section is stale** — it still says "Phase 0
  complete, next up Phase 1," dated from before Phase 1 was built. Worth a
  quick update if this doc is being kept current.

## Established build methodology (for any future phase)

`models → migrations → RLS migration → serializers → views → urls → admin →
tests`, then backend verification (`black`, `isort`, `ruff`, `bandit`,
`pip-audit`, `pytest`), then frontend (`tsc`, `eslint`, `prettier`, `npm
audit`), then a real Playwright browser walkthrough against local
Postgres + Django + Vite dev servers. This last step has caught real bugs
every phase that unit tests alone missed (missing POS gates, tenant-scoping
bugs from class-level `queryset =` bindings, PII leaking into audit diffs,
`pg_dump` failing against RLS-forced tables).

## Routes & links, by role

Local dev only — no deployed URL exists yet (see "Known, disclosed gaps").
Base URLs from `README.md`: frontend `http://localhost:5173`, backend API
`http://localhost:8000`.

Login (`/login`) → after auth, `RootRedirect` sends each user to their shell
based on JWT `role` claim (`frontend/src/lib/roleRouting.ts`). Route guarding
is UX-only (`ProtectedRoute`) — real authorization is enforced server-side on
every request regardless.

### Super Admin — `/super-admin` (role: `SUPER_ADMIN`)

| Page | Path | Status |
|---|---|---|
| Platform Dashboard | `/super-admin` | Placeholder |
| Organizations | `/super-admin/organizations` | Placeholder |
| Branches | `/super-admin/branches` | Placeholder |
| Subscriptions & Billing | `/super-admin/subscriptions` | Placeholder |
| Global Roles & Permissions | `/super-admin/roles` | Placeholder |
| Audit Log | `/super-admin/audit-log` | Placeholder |

### Org Admin — `/org-admin` (role: `Org Admin`)

| Page | Path | Status |
|---|---|---|
| Org Dashboard | `/org-admin` | Placeholder |
| Ward & Bed Management | `/org-admin/wards` | Placeholder |
| Staff / CCP Team | `/org-admin/staff` | Placeholder |
| Branch Settings | `/org-admin/branch-settings` | Placeholder |
| Roles & Permissions | `/org-admin/roles` | Placeholder |
| Data Requests (right-to-erasure) | `/org-admin/data-requests` | **Built** |

### Clinical Workspace — `/clinical` (everyone else: Doctor, Nurse, Therapist, etc.)

| Page | Path | Status |
|---|---|---|
| Client Registry | `/clinical` | **Built** |
| New Client | `/clinical/registry-new` | **Built** (linked from Client Registry, not in sidebar) |
| Attachments | `/clinical/attachments` | Placeholder |
| Triage & MSE | `/clinical/triage` | **Built** |
| Clinical Review | `/clinical/review` | **Built** |
| Clinical Encounter | `/clinical/encounter` | **Built** |
| Laboratory (LIMS) | `/clinical/lims` | **Built** |
| Pharmacy | `/clinical/pharmacy` | **Built** |
| Inpatient & Ward | `/clinical/ipd` | **Built** |
| Individual Psychotherapy | `/clinical/ccp/individual` | **Built** |
| Family Therapy | `/clinical/ccp/family` | **Built** |
| Group Psychotherapy | `/clinical/ccp/group` | **Built** |
| Supervision Requests | `/clinical/ccp/supervision` | **Built** |
| NACADA NDO Report | `/clinical/ccp/nacada` | **Built** |
| CCP Team | `/clinical/ccp/team` | **Built** |
| About | `/clinical/about` | In sidebar nav (`soon: true`) but **no route exists** — currently 404s to `/` |

### Auth (unauthenticated)

| Page | Path |
|---|---|
| Login | `/login` |
| Activate account | `/activate` |
| Forgot password | `/forgot-password` |

### Backend API — all under `http://localhost:8000/api/v1/`

| Area | Base path | App |
|---|---|---|
| Auth | `auth/tenant-discovery/`, `identify/`, `confirm-email/`, `verify-otp/`, `resend-otp/`, `set-password/`, `login/`, `login/verify-otp/`, `refresh/`, `logout/`, `forgot-password/` | `accounts` |
| Platform | `platform/organizations/` | `tenancy` |
| Patients | `patients/`, `appointments/`, `erasure-requests/` (DRF router) | `client_registry` |
| Clinical encounters | `encounters/` (DRF router) | `clinical_encounter` |
| CCP program | `ccp/biopsychosocial-assessments/`, `ccp/psychotherapy-sessions/`, `ccp/care-team/`, `ccp/sud-rehab-plans/`, `ccp/urine-drug-screens/`, `ccp/clinical-reviews/`, `ccp/supervision-requests/`, `ccp/nacada-ndo-reports/`, `ccp/team-roster/` | `ccp_program` |
| Billing | `billing/invoices/`, `billing/cost-centers/`, `billing/cost-centers/report/` | `billing` |
| Insurance claims | `claims/pre-authorizations/`, `claims/e-claims/`, `claims/remittances/` | `insurance_claims` |
| LIMS | `lab/orders/`, `lab/specimens/`, `lab/results/` | `lims` |
| Pharmacy | `pharmacy/stores/`, `pharmacy/stock-items/`, `pharmacy/stock-movements/`, `pharmacy/dispense/` | `pharmacy` |
| IPD/Ward | `ipd/wards/`, `ipd/beds/`, `ipd/admissions/`, `ipd/mar/`, `ipd/nursing-notes/` | `ipd_ward` |
| Terminology (DHA) | `terminology/icd11/search/`, `terminology/loinc/search/`, `terminology/drug-index/search/` | `dha_interop` |
| Offline sync | `sync/push/`, `sync/pull/` | `offline_sync` |

### Other backend endpoints (outside `/api/v1/`)

| Purpose | Path |
|---|---|
| Django admin | `/admin/` |
| Health check (Docker/K8s probe) | `/healthz` |
| Prometheus scrape target | `/` (django-prometheus default) |
| OpenAPI schema | `/api/v1/schema/` |
| Swagger UI | `/api/v1/docs/` |

### Local dev infra endpoints (from `README.md`, via `docker compose up`)

| Service | URL |
|---|---|
| Django admin | http://localhost:8000/admin/ |
| API docs (Swagger) | http://localhost:8000/api/v1/docs/ |
| Health check | http://localhost:8000/healthz |
| Frontend (Vite) | http://localhost:5173 |
| Mailhog (dev OTP/email capture) | http://localhost:8025 |

## Phase 10: tenant-branded login UX (post-Phase-9, not yet in the phase table above)

Returning-user login (`/login`) was rebuilt as a 3-step, tenant-branded flow
per `docs/14-TENANT-BRANDED-LOGIN-UX.md` — email-domain tenant discovery →
branded password screen (logo/tagline/color pulled from `Organization`) →
SMS-or-email 2FA with masked contact and channel switching. This supersedes
§5.3's plain single-form login description in `docs/05` (that doc is left
unedited per the read-only-spec convention; docs/14 documents the delta).
Adds `Organization.email_domains/logo_url/login_image_url/tagline/
primary_color/support_email/support_phone/website`, `User.
preferred_mfa_channel`, and `POST /api/v1/auth/tenant-discovery/`. Activation
and forgot-password (`docs/05` §5.2/§5.3) are unchanged. `cafric-demo` was
re-provisioned via `onboard_tenant`'s new `--email-domain`/branding flags.

## What's actually left

Per `docs/11-ROADMAP-AND-PHASES.md`, Phase 9 is the last purely-code phase,
and it's substantially built out. What remains is either genuinely external
(DHA certification steps 3–5, needing real accounts/infra this environment
doesn't have) or a disclosed gap the user can choose to close first (noisy-
neighbor load testing, TLS 1.3 verification, building out `notifications`).
