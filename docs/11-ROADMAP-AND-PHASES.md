# 11 — Build Roadmap: Environment Setup to Production

Copilot must follow this order. Each phase should end with a working, tested, demo-able increment — not partially-wired code. Do not start a phase before the previous phase's exit criteria are met.

## Phase 0 — Environment & repo bootstrap
**Goal:** a clean local dev environment any contributor can stand up in minutes.
- Scaffold the repository layout from `02-TECH-STACK-AND-ARCHITECTURE.md` §2.5.
- `infra/docker-compose.yml`: Postgres, Redis, Django (with hot reload), React dev server, Celery worker, Celery beat, Mailhog (local email/OTP capture for dev).
- Django project with split settings (`base/dev/staging/production`), `.env.example` documented, `django-environ` for config.
- Pre-commit hooks: `black`, `isort`, `flake8`/`ruff`, `bandit`, `detect-secrets`; frontend `eslint` + `prettier`.
- CI skeleton (GitHub Actions): lint + test on every PR, no deploy yet.
- **Exit criteria:** `docker compose up` gives a running Django admin + React "hello" shell + Postgres + Redis, CI green on an empty test.

## Phase 1 — Tenancy, Identity & Auth
- Implement `Organization`, `Branch`, `Role`, `Permission`, `User` models + migrations (`04-MULTI-TENANCY.md`, `06-DATA-MODEL.md` §6.1).
- `TenantMiddleware` + `TenantScopedQuerySet`, Postgres RLS policies, negative-path isolation tests.
- Full authentication flow exactly per `05-AUTHENTICATION-FLOW.md` (identify → email confirm → OTP → password → login redirect), OTP dispatch via Celery + Mailhog in dev.
- RBAC scaffolding + seed default roles (`09-SECURITY-COMPLIANCE.md` §9.3).
- Immutable `AuditLogEntry` model + middleware wired to every write.
- **Exit criteria:** a Super Admin can create an Organization, invite an Org Admin, the Org Admin can complete the full activation flow and log in, RLS isolation test passes in CI, every action appears in the audit log.

## Phase 2 — Design system & shell UI
- Build `frontend/src/theme/tokens.css` and Tailwind config exactly per `03-DESIGN-SYSTEM.md`.
- Build the three shells: `SuperAdminShell`, `OrgAdminShell`, `ClinicalWorkspaceShell` with sidebar/topbar per the mockups, role-based route guarding, and the "Soon" badge pattern for unbuilt modules.
- Wire the auth flow UI (`AuthFlowController` + steps) to the Phase 1 backend endpoints.
- **Exit criteria:** logging in as each of the three role tiers lands on the correct shell, visually matching the mockups, with working navigation between (initially empty/placeholder) module pages.

## Phase 3 — Core clinical path (Modules 1–3 + CCP core)
- Client Registry (Module 1) with IPRS stub + SHA coverage stub (real SHA sandbox wiring comes in Phase 6).
- Triage (Module 2) + Mental Status Exam (§7.14.2) with BMI/BSA calculators and ESI acuity.
- Clinical Encounter/EHR (Module 3): SOAP notes, ICD-11-coded diagnosis (local mirrored index), CPOE stub, e-prescribing stub.
- CCP core: Biopsychosocial Assessment, Individual/Family/Group Psychotherapy session logging.
- **Exit criteria:** a full outpatient mental-health encounter can be recorded end-to-end for a demo patient, matching the Client Registry table layout from the AppSheet reference screenshot.

## Phase 4 — Billing & Insurance foundation
- Billing engine (Module 10) with the POS validation gate (`07-CLINICAL-MODULES-SPEC.md` §7.10).
- Insurance/Claims (Module 11) domestic model + SHA gateway service skeleton (`08-DHA-SHA-INTEGRATION.md`) pointed at SHA's sandbox.
- **Exit criteria:** an encounter cannot progress to a billable clinical order without a validated payment method; a mock SHA member-verification call round-trips against the sandbox.

## Phase 5 — Remaining clinical modules (as needed per tenant type)
- LIMS (Module 4), Pharmacy (Module 6), IPD/Ward (Module 7) for general facilities; SUD Rehab Workflows + Supervision Requests + CCP Team + NACADA NDO Report for CCP tenants.
- RIS/PACS (Module 5), Theatre (Module 8), MCH (Module 9), Mortuary (Module 12) — only for `GENERAL_HOSPITAL` tenants, deprioritized relative to CAfRIC's needs.
- **Exit criteria:** module bundle toggling (`04-MULTI-TENANCY.md` §4.4) correctly shows/hides these per tenant facility type.

## Phase 6 — Full DHA/SHA interoperability
- HL7 FHIR resource mapping + HIE transmission for E-Referrals.
- ICD-11/LOINC/National Drug Index live sync jobs (replacing Phase 3–5 stub mirrors).
- Full pre-authorization and e-claims flow against SHA's real API (behind a feature flag until certified).
- Offline mode: local-first clinical entry + sync endpoints (`08-DHA-SHA-INTEGRATION.md` §8.5).
- **Exit criteria:** a complete pre-auth → e-claim → remittance cycle succeeds against SHA's test gateway; offline entry + reconnect sync demoed.

## Phase 7 — Hardening & DHA certification readiness
- Full security checklist (`09-SECURITY-COMPLIANCE.md` §9.7) closed out.
- DPIA completed, consent flows finalized, right-to-erasure workflow built.
- Load testing (including the "noisy neighbor" multi-tenant scenario), backup/restore drill executed and documented.
- `/sandbox` environment seeded and demo script written for DHA evaluators (§8.6).
- **Exit criteria:** ready to submit DHA Self-Assessment & Documentation (certification lifecycle step 2, `01-OVERVIEW-AND-STANDARDS.md` §1.4).

## Phase 8 — Kubernetes, Terraform & production deployment
- Dockerize frontend/backend/worker images, push to a registry, scan with Trivy.
- Author Kubernetes manifests/Helm chart (`12-DEVOPS-DEPLOYMENT.md`), Kustomize overlays for `dev/staging/production`.
- Author Terraform modules for VPC, managed Kubernetes, managed Postgres, object storage; separate state per environment.
- CI/CD: build → test → scan → deploy to staging automatically on `main`; production deploy gated on manual approval.
- **Exit criteria:** a fresh `terraform apply` in a clean cloud account stands up the full stack; a `git push` to `main` deploys to staging automatically; production deploy is a one-click gated promotion.

## Phase 9 — Go-live & post-launch
- Onboard CAfRIC Centre as the first production tenant end-to-end (Org creation → activation → module bundle → staff onboarding).
- Monitoring/alerting live (`12-DEVOPS-DEPLOYMENT.md` §12.5), on-call runbook published.
- Submit for DHA Sandbox Integration & Testing (step 3) and Technical Demonstration & Audit (step 4).
- **Exit criteria:** DHA certification obtained and platform listed on the national registry (step 5); CAfRIC actively using the system in production.
