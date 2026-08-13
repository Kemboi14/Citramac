# CITRAMAC HMIS — Copilot Build Documentation Package

This is the complete specification package for building **CITRAMAC**, a multi-tenant, DHA-certifiable, SHA-integrated Hospital & Mental Health Management Information System, using **GitHub Copilot** (Chat/Agent/Workspace) as the primary build tool.

## How to use this package

1. Copy this entire `docs/` folder plus `.github/copilot-instructions.md` into the root of your new repository.
2. Copy the three mockup HTML files and the AppSheet reference screenshot into a `/mockups` folder at the repo root — Copilot's design instructions (`docs/03-DESIGN-SYSTEM.md`) reference them directly.
3. Open the repo in your Copilot-enabled editor. Copilot will read `.github/copilot-instructions.md` automatically as standing context; point Copilot Agent/Chat at it explicitly at the start of any new session ("read .github/copilot-instructions.md and docs/ before we start").
4. Work strictly in the phase order defined in `docs/11-ROADMAP-AND-PHASES.md`. Do not let Copilot skip ahead to Kubernetes/production concerns before the application itself is functionally correct and tested.

## Document index

| File | Contents |
|---|---|
| `.github/copilot-instructions.md` | Standing instructions Copilot loads every session — the router to everything below |
| `docs/01-OVERVIEW-AND-STANDARDS.md` | UHC, SHA, DHA regulatory context; why the system exists; CAfRIC's special requirements |
| `docs/02-TECH-STACK-AND-ARCHITECTURE.md` | Mandatory tech stack, architecture diagrams, repository layout |
| `docs/03-DESIGN-SYSTEM.md` | Exact colors, fonts, components extracted from the three mockups |
| `docs/04-MULTI-TENANCY.md` | Tenant isolation model, provisioning, feature flags per facility type |
| `docs/05-AUTHENTICATION-FLOW.md` | The exact multi-step identify → email confirm → OTP → password → login flow |
| `docs/06-DATA-MODEL.md` | Core Django models / ERD across all modules |
| `docs/07-CLINICAL-MODULES-SPEC.md` | All 13 DHA-mandated modules + CAfRIC mental-health module extensions |
| `docs/08-DHA-SHA-INTEGRATION.md` | HL7 FHIR, ICD-11/LOINC/drug index, SHA member-verification/pre-auth/e-claims |
| `docs/09-SECURITY-COMPLIANCE.md` | Encryption, RBAC, audit trail, DPA/consent, backup/DR, hardening checklist |
| `docs/10-API-SPECIFICATION.md` | REST endpoint contract outline for every module |
| `docs/11-ROADMAP-AND-PHASES.md` | Step-by-step build phases: environment setup → production go-live |
| `docs/12-DEVOPS-DEPLOYMENT.md` | Docker, Kubernetes, Terraform, CI/CD, backup/restore runbook |
| `docs/13-TESTING-QA-CHECKLIST.md` | Test strategy, CI gates, DHA certification checklist, DPIA template |

## Source materials this package was derived from

- `UHC__1_.docx` — DHA/SHA/UHC technical standards report (the compliance source of truth).
- `citramac_SUPER-ADMIN.html`, `citramac_ORG-admin.html`, `citramac_clinical_workspace.html` — approved UI mockups (design source of truth).
- AppSheet reference screenshot — legacy CITRAMAC Client Registration screen, used to pin exact column layouts.
- Tech-stack diagrams — approved architecture (React/Django/PostgreSQL/Docker/Kubernetes/Terraform), used to pin the mandatory stack.

## A note on scope

This package specifies a large, multi-quarter platform. Treat it as a living reference, not a one-shot prompt — re-read the relevant doc before each new feature, and update the docs if implementation reveals a gap or a necessary deviation, so the spec and the code never drift apart.
