# 13 — Testing, QA & DHA Certification Checklist

## 13.1 Test pyramid

- **Unit tests** (`pytest` + `pytest-django`): every model method, serializer, permission class, and business-rule function (e.g. BMI calculation, POS validation gate, RBAC checks). Target ≥85% coverage on `apps/*` business logic.
- **Integration tests**: full request/response cycle per endpoint in `10-API-SPECIFICATION.md`, including negative-path tenant-isolation tests (user from Org A cannot read/write Org B data) and RBAC negative-path tests (a Nurse cannot approve a claim write-off, etc.).
- **Contract tests**: FHIR payload validation against the FHIR schema; SHA gateway request/response shape tests against recorded sandbox fixtures.
- **End-to-end tests** (Playwright/Cypress): the full auth flow (`05-AUTHENTICATION-FLOW.md`) start to finish across all five screens; a full outpatient mental-health encounter (register → triage/MSE → SOAP note → prescription → invoice); a full pre-auth → e-claim cycle in sandbox mode.
- **Load/performance tests** (k6/Locust): concurrent multi-tenant load, "noisy neighbor" scenario (`04-MULTI-TENANCY.md` §4.6).
- **Accessibility tests**: automated axe-core scan on every shell + core clinical screens; keyboard-navigation smoke test on the auth flow and Client Registry.

## 13.2 CI gates (nothing merges to `main` unless all pass)

- [ ] Lint (backend + frontend)
- [ ] Unit + integration tests, coverage threshold met
- [ ] SAST (`bandit`, `eslint-plugin-security`)
- [ ] Dependency vulnerability scan
- [ ] Container image scan (Trivy) — build-and-scan workflow
- [ ] Tenant-isolation negative-path test suite (explicitly named, cannot be skipped)
- [ ] Terraform plan reviewed (for infra PRs)

## 13.3 DHA certification readiness checklist (map directly to `01-OVERVIEW-AND-STANDARDS.md` §1.4)

- [ ] HL7 FHIR payload exchange demonstrated against DHA sandbox (Patient, Encounter, Condition, MedicationRequest, Composition/referral bundle)
- [ ] ICD-11 coding enforced on all finalized diagnoses; live search-and-assign demoed
- [ ] LOINC mapping enforced on all lab orders/results
- [ ] National Drug Index mapping enforced on prescriptions/dispensing
- [ ] RBAC demonstrated across at least Doctor / Nurse / Admin / Auditor roles
- [ ] AES-256 at rest and TLS 1.3 in transit verified (config review + a network capture spot check)
- [ ] Immutable audit trail demonstrated: create → edit → attempted delete on a sample record, log entries shown
- [ ] Offline mode demonstrated: disconnect, continue charting, reconnect, confirm sync with no data loss
- [ ] BMI/BSA/ESI calculators demonstrated live in Triage
- [ ] SHA member verification, pre-authorization, and e-claims full cycle demonstrated against SHA's test gateway
- [ ] DPIA completed and on file (see §13.4)
- [ ] Backup/restore drill completed within the last quarter with documented RTO/RPO results

## 13.4 Data Protection Impact Assessment (DPIA) — template to fill per tenant/facility type

1. **Description of processing**: what patient data is collected, why, by whom, retained how long.
2. **Necessity & proportionality**: is each data field justified by a specific clinical/administrative/legal need? (Particularly scrutinize psychiatric/SUD fields — §7.14.7.)
3. **Risk identification**: unauthorized access, data loss, re-identification risk in aggregate reporting (e.g. NACADA NDO Report), insider misuse, cross-tenant leakage.
4. **Mitigations mapped to risks**: RBAC tiering, RLS isolation, encryption, audit trail, care-team scoping, consent capture — cite the specific control from `09-SECURITY-COMPLIANCE.md`.
5. **Residual risk assessment & sign-off**: who accepts remaining risk (Org Admin + a named Data Protection Officer / compliance lead).
6. **Review cadence**: re-assess on any material change to modules enabled, data flows, or sub-processors (e.g., adding a new SMS/email vendor).

## 13.5 Definition of "production-ready" for this project

A phase/feature is not "done" until:
- Automated tests exist and pass in CI.
- It is reachable through the actual UI matching `03-DESIGN-SYSTEM.md` (no unstyled/placeholder screens shipped to staging).
- It is audit-logged if it touches patient or financial data.
- It is tenant-isolated and RBAC-checked.
- It has a rollback plan (reversible migration, feature flag, or documented manual rollback step).
- Relevant docs in `/docs` are updated if the implementation diverged from the spec (keep this document set living, not a one-time artifact).
