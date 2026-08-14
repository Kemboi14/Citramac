# DHA Certification Submission Readiness

Operational doc (not one of the numbered `01`-`13` spec docs) — an honest,
item-by-item status check against `13-TESTING-QA-CHECKLIST.md` §13.3 and
`01-OVERVIEW-AND-STANDARDS.md` §1.4's five-step certification lifecycle,
written for `11-ROADMAP-AND-PHASES.md` Phase 9 ("Submit for DHA Sandbox
Integration & Testing (step 3) and Technical Demonstration & Audit (step
4)").

## What this doc is and isn't

This is a **readiness assessment**, not a submission. Steps 1-2 of the
lifecycle (Developer Registration; Self-Assessment & Documentation) and
steps 3-5 (Sandbox Integration & Testing; Technical Demonstration & Audit;
Certification & Registry Listing) all require a real DHA Certification
Portal account, real facility credentials, and organizational sign-off from
CAfRIC Centre — none of which exist in this build environment. No AI agent
can complete those steps; they are listed here so a human owner knows
exactly what's outstanding, matching this project's standing rule of never
claiming untested/unavailable external integrations work.

## §13.3 checklist, item by item

- [x] **HL7 FHIR payload exchange** — real Bundle construction
  (`apps.dha_interop.fhir_mapper.build_referral_bundle`) is demonstrable
  live via `seed_dha_sandbox_demo` (see
  `docs/TENANT-ONBOARDING-AND-SANDBOX-DEMO.md`). **Not done:** exchange
  against DHA's *actual* sandbox — `HIE_ENDPOINT_URL` is unconfigured, so
  transmission honestly reports `FAILED`, not a live round trip.
- [x] **ICD-11 coding enforced, live search-and-assign demoed** — `DiagnosisCode.icd11_code`
  is a mandatory FK (`apps/clinical_encounter/models.py`), already exercised
  in the `cafric-demo` org's existing encounters.
- [x] **LOINC mapping enforced on lab orders/results** — `LabOrder.loinc_code`
  is a mandatory FK to `LoincCodeIndex` (`apps/lims/models.py`), verified
  while writing this doc rather than assumed from the terminology table's
  existence alone.
- [x] **National Drug Index mapping enforced on prescriptions** —
  `PrescriptionItem.drug` FK to `NationalDrugIndex`
  (`apps/clinical_encounter/models.py`), non-nullable.
- [x] **RBAC across Doctor/Nurse/Admin/Auditor** — all exist as platform
  template Roles (`apps/accounts/models.py`'s seed migration), exercised
  throughout the test suite's permission tests.
- [ ] **AES-256 at rest, TLS 1.3 in transit — verified** — RDS is
  `storage_encrypted` via a KMS key (AES-256 is KMS's default, per
  `infra/terraform/modules/rds`) and S3 has KMS SSE
  (`infra/terraform/modules/storage`) — at-rest encryption is real.
  **TLS 1.3 in transit is not verified**: enforcing a minimum TLS version
  is a cluster-wide ingress-nginx controller setting, and this repo
  deliberately doesn't manage that controller's own install/config (same
  boundary as the External Secrets Operator — see
  `infra/k8s/base/external-secret.yaml`'s comment). No network capture spot
  check has been done because there is no live cluster to capture traffic
  from.
- [x] **Immutable audit trail: create → edit → attempted delete demoed** —
  `apps/sysadmin_audit`'s signal-based `AuditLogEntry` writes are exercised
  throughout the test suite and confirmed live against the `cafric-demo`
  patient record while building this doc.
- [x] **Offline mode demonstrated** — `apps/offline_sync` has 6 passing
  tests covering push/pull + last-write-wins conflict logging
  (`08-DHA-SHA-INTEGRATION.md` §8.5). Not independently re-verified as part
  of this Phase 9 pass beyond confirming the existing suite still passes.
- [x] **BMI/BSA/ESI calculators demonstrated live in Triage** — already
  computed on 3 existing `VitalSigns` rows in the `cafric-demo` org
  (confirmed while building `seed_dha_sandbox_demo`, no new seeding needed).
- [x] **SHA member verification/pre-auth/e-claims full cycle demonstrated** —
  `seed_dha_sandbox_demo` now creates a real pre-auth → e-claim → remittance
  cycle (see `docs/TENANT-ONBOARDING-AND-SANDBOX-DEMO.md`). **Not done:**
  against SHA's *actual* test gateway — `SHA_GATEWAY_MODE` defaults to
  `stub`; going live needs `SHA_GATEWAY_MODE=sandbox` plus a real signing
  certificate (`08-DHA-SHA-INTEGRATION.md` §8.4), neither configured here.
- [x] **DPIA completed and on file** — `docs/DPIA-CAFRIC-MENTAL-HEALTH-CCP.md`
  (Phase 7).
- [x] **Backup/restore drill completed, RTO/RPO documented** — Phase 7,
  drill-tested for real against the local dev Postgres cluster (see
  `backend/scripts/README.md`). Note: that drill ran against dev, not a
  managed RDS instance, because no managed database has ever existed in
  this build (Phase 8's Terraform was never `apply`'d) — re-run the drill
  against the real RDS instance once one exists, don't assume the dev-drill
  RTO/RPO numbers transfer unchanged to managed Postgres.

## Load testing — a real, previously undisclosed gap

`11-ROADMAP-AND-PHASES.md` Phase 7's own exit criteria called for "load
testing (including the noisy neighbor multi-tenant scenario)" — checking
the repo while writing this doc found **no k6/Locust artifacts, scripts,
or results anywhere**. This was never actually done in Phase 7 despite
being listed as that phase's exit criterion; it surfaced only now while
compiling this checklist. This is outstanding work, not a Phase 9 scope
item — flagging it here rather than silently leaving it off this readiness
assessment.

## Recommended order of remaining work before a real submission

1. Build and run the noisy-neighbor load test Phase 7 was supposed to
   deliver.
2. Stand up real infrastructure (Phase 8's Terraform has never been
   `apply`'d against a live AWS account) so TLS/network-level claims can
   actually be verified rather than reasoned about from config alone.
3. Get real DHA sandbox and SHA sandbox credentials, flip
   `SHA_GATEWAY_MODE`/`HIE_ENDPOINT_URL` on, and re-run
   `seed_dha_sandbox_demo` against them for a genuine (not stubbed) dry run
   before the live evaluator session.
4. Only then: Developer Registration → Self-Assessment submission → book
   the Sandbox Integration & Technical Demonstration sessions.
