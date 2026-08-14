# Tenant Onboarding & DHA Sandbox Demo

Operational doc (not one of the numbered `01`-`13` spec docs) — companion to
`04-MULTI-TENANCY.md` §4.5, `08-DHA-SHA-INTEGRATION.md` §8.6, and
`11-ROADMAP-AND-PHASES.md` Phase 9 ("Onboard CAfRIC Centre as the first
production tenant end-to-end").

## Onboarding a tenant

`onboard_tenant` (`backend/apps/tenancy/management/commands/onboard_tenant.py`)
runs the provisioning flow from `04-MULTI-TENANCY.md` §4.5 — Organization
creation, module bundle assignment, Org Admin invite, and optional bulk
staff invites — from the command line rather than only through the Super
Admin API, so it can be scripted and re-run idempotently.

This deployment only ever onboards `MENTAL_HEALTH_CCP` facilities (see
`config/settings/base.py`'s `LOCAL_APPS` comment) — the command assigns the
`MENTAL_HEALTH_CCP` module bundle unconditionally, restricted to apps
actually installed in this build.

```bash
python manage.py onboard_tenant \
  --name "CAfRIC Centre" --slug cafric \
  --admin-email admin@cafric.example --admin-first-name Jane --admin-last-name Doe \
  --branch-name "Nairobi Main" --branch-level L4 --county Nairobi \
  --staff-file staff.json \
  --dry-run   # drop this once the plan looks right
```

`staff.json` — a list of initial staff to bulk-invite, `role` must match an
existing platform template Role name (`Doctor`, `Nurse`,
`Clinical Psychologist/Therapist`, `Lab Technician`, `Pharmacist`,
`Cashier/Billing Clerk`, `Records Officer`, `Supervisor`, `Auditor`):

```json
[
  {"email": "clinician@cafric.example", "first_name": "...", "last_name": "...", "role": "Doctor", "staff_id": "D-001"}
]
```

Idempotent by `--slug`/email — re-running updates the module bundle and
leaves existing users' activation state untouched rather than duplicating
or re-inviting them. Each newly-created user gets a real `ActivationInvite`
dispatched by the same Celery task (`apps.notifications.tasks.send_invite_email`)
the API view uses; they complete the normal activation flow
(`05-AUTHENTICATION-FLOW.md`) themselves — this command never sets a
password on anyone's behalf.

**What this does not do:** stand up real infrastructure for the tenant to
run on. There is no live Kubernetes cluster or AWS account in this build
environment to actually deploy into (see `11-ROADMAP-AND-PHASES.md` Phase
8's disclosed limitation) — this command is the onboarding *procedure*,
ready to run against a real environment once one exists.

**Applied so far:** run against the existing `cafric-demo` Organization in
this dev database on 2026-08-14 to backfill its `enabled_modules` field,
which had been empty since it was first created in an earlier phase (that
gap was found while building this command — `enabled_modules` was written
by the model from day one but nothing had ever populated it for the
reference tenant).

## Seeding the DHA sandbox demo

`08-DHA-SHA-INTEGRATION.md` §8.6 calls for a `/sandbox` environment seeded
so this can be demonstrated live to DHA evaluators:

- FHIR payload exchange (send + receive) against the DHA sandbox.
- ICD-11 code search/assignment in a live encounter.
- BMI/BSA automatic calculation in Triage.
- A full pre-auth → e-claim → remittance cycle against SHA's test gateway.
- The immutable audit log showing every access/edit/delete for a sample
  patient record.

`11-ROADMAP-AND-PHASES.md` Phase 7 called for this seeded environment to
exist already; checking the repo while building Phase 9 found no seed
script anywhere — this had never actually been built, only demonstrated
ad hoc during earlier phases' manual testing. Two of the five checklist
items were already trivially demonstrable from existing demo data (the
`cafric-demo` org's one Patient has 3 `VitalSigns` rows with BMI/BSA
already computed, and 2 `DiagnosisCode` assignments), and the audit log
already captures every write automatically (signal-based, per
`apps/sysadmin_audit/signals.py`) — nothing to seed there either. The
pre-auth/e-claim/remittance cycle and any FHIR Bundle for this org were
genuinely missing (zero rows), so `seed_dha_sandbox_demo`
(`backend/apps/dha_interop/management/commands/seed_dha_sandbox_demo.py`)
fills exactly that gap:

```bash
python manage.py seed_dha_sandbox_demo --org-slug cafric-demo
```

It reuses the real service calls the API views use
(`apps.insurance_claims.sha_gateway.submit_pre_authorization`/`submit_e_claim`,
`apps.dha_interop.fhir_mapper.build_referral_bundle`,
`apps.dha_interop.hie_client.transmit_referral`) against the org's existing
Patient/Encounter, rather than fabricating data that bypasses that code
path — so what an evaluator sees walking through the demo is exactly what
the platform's real request/response flow produces, not a hand-written
fixture. Idempotent; safe to re-run.

**What this honestly does not do:**

- SHA gateway calls run in `stub` mode by default (`SHA_GATEWAY_MODE`) — no
  real SHA sandbox endpoint or facility signing certificate is configured
  in this environment, so `PreAuthorization`/`InsuranceClaim` submissions
  log as `PENDING` against a stub, not a real SHA test-gateway round trip.
  Before a live DHA evaluator session, `SHA_GATEWAY_MODE=sandbox` plus a
  real signing certificate (`08-DHA-SHA-INTEGRATION.md` §8.4) need to be
  configured against SHA's actual sandbox.
- The FHIR referral Bundle is built and cached, but `HIE_ENDPOINT_URL` is
  unconfigured, so transmission honestly reports `FAILED` (see
  `apps.dha_interop.hie_client`) rather than a fabricated `SENT`. The
  Bundle itself is real, schema-shaped FHIR JSON — what's missing is a
  live HIE endpoint + mutual-TLS client certificate to actually send it to.
- The `Remittance` row this command creates is manually entered, standing
  in for SHA's own inbound remittance advice — there is no "submit
  remittance" API anywhere in this codebase (`RemittanceViewSet` is
  read-only) because the platform never originates one; a real SHA
  integration would receive this via whatever channel SHA delivers
  remittance advices through, which isn't modeled yet.

## What's out of scope here entirely

Submitting for **DHA Sandbox Integration & Testing** (certification
lifecycle step 3) and **Technical Demonstration & Audit** (step 4), and
obtaining **certification + national registry listing** (step 5), are real
submissions to a government regulator requiring an actual DHA sandbox
account, real facility credentials, and organizational sign-off — none of
which exist in this build environment. See
`docs/DHA-CERTIFICATION-SUBMISSION-READINESS.md` for what evidence this
codebase can already offer toward that submission, and what's still
outstanding.
