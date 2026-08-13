# CITRAMAC HMIS — GitHub Copilot Master Build Instructions

> **Read this file first, every session.** This is the standing system prompt for GitHub Copilot (Chat / Agent / Workspace) while building **CITRAMAC**, a multi-tenant, DHA-certifiable, SHA-integrated Hospital & Mental Health Management Information System for CAfRIC Centre and similar facilities.
>
> This file is the router. The full specification lives in the numbered documents in `/docs`. Copilot must load and obey the relevant doc before generating code for that area, and must never contradict `03-DESIGN-SYSTEM.md` or `09-SECURITY-COMPLIANCE.md` under any circumstances — these two are non-negotiable.

## 0. What you are building

**CITRAMAC** is a cloud-native, multi-tenant HMIS. A single deployment serves many organizations (hospitals, clinics, rehab/CCP centres), each fully data-isolated, each with their own branches, staff, patients, and billing — on shared infrastructure. It must be certifiable against Kenya's **Digital Health Agency (DHA)** standards and integrate natively with the **Social Health Authority (SHA)**.

It ships with three UI tiers, matching the reference mockups in `/mockups`:

1. **Super Admin** (`citramac_SUPER-ADMIN.html`) — platform owner: manages Organizations (tenants), Branches, Subscriptions, cross-tenant Governance, Roles & Permissions, Global Audit Log.
2. **Org Admin** (`citramac_ORG-admin.html`) — a tenant's facility admin: Org Dashboard, Ward & Bed Management, Staff/CCP Team, Branch Settings, Roles & Permissions (scoped to their org).
3. **Clinical Workspace** (`citramac_clinical_workspace.html`) — the frontline EHR used by clinicians: Client Registry, Attachments, Triage & MSE, Clinical Review, Clinical Encounter, LIMS, Pharmacy, Inpatient & Ward, plus the **CCP Program** modules unique to mental-health/rehab facilities (Individual Psychotherapy, Family Therapy, Group Psychotherapy, Supervision Requests, NACADA NDO Report, CCP Team).

Read the full module list and clinical rationale in `docs/07-CLINICAL-MODULES-SPEC.md` before scaffolding any clinical screen.

## 1. Non-negotiable ground rules

1. **Multi-tenancy is structural, not cosmetic.** Every table, query, cache key, Celery task, file path, and audit entry carries a `tenant_id` (organization). No cross-tenant data leakage is acceptable at any layer. See `docs/04-MULTI-TENANCY.md`.
2. **DHA compliance is a hard requirement, not a stretch goal.** HL7 FHIR interoperability, ICD-11 diagnostic coding, LOINC lab mapping, AES-256 at rest, TLS 1.3 in transit, immutable audit trails, RBAC, offline-capable sync. See `docs/09-SECURITY-COMPLIANCE.md` and `docs/08-DHA-SHA-INTEGRATION.md`.
3. **SHA integration is API-native, not a web-portal workaround.** Member verification, pre-authorization, and e-claims must be pushed from CITRAMAC directly to SHA's gateway — never manual portal entry. See `docs/08-DHA-SHA-INTEGRATION.md`.
4. **Design fidelity to the mockups is mandatory.** Use the exact CSS custom properties, fonts, spacing, and component patterns defined in `docs/03-DESIGN-SYSTEM.md`. Do not invent a new palette or swap fonts.
5. **The authentication flow is a specific multi-step sequence** (name/identity confirm → email confirm → email OTP verification → password creation/entry → redirect to login). It is fully specified in `docs/05-AUTHENTICATION-FLOW.md`. Do not collapse it into a single-page login form.
6. **Follow the build order.** Do not jump to Kubernetes manifests before the Django/DRF backend has passing tests, and do not build clinical modules before tenancy, auth, and RBAC exist. The phase order is in `docs/11-ROADMAP-AND-PHASES.md`.
7. **Every PR must be production-mindset**: migrations reversible, secrets never hardcoded, settings split by environment, tests included, docstrings present.

## 2. Reading order for Copilot Agent sessions

When starting a new agent session or a new feature branch, load documents in this order and summarize your understanding back before writing code:

| Order | Doc | Purpose |
|---|---|---|
| 1 | `docs/01-OVERVIEW-AND-STANDARDS.md` | Domain context: UHC, SHA, DHA, why this system exists |
| 2 | `docs/02-TECH-STACK-AND-ARCHITECTURE.md` | Exact stack, service boundaries, infra diagrams |
| 3 | `docs/03-DESIGN-SYSTEM.md` | Colors, type, spacing, components — pixel-accurate to mockups |
| 4 | `docs/04-MULTI-TENANCY.md` | Tenancy model, isolation strategy, provisioning |
| 5 | `docs/05-AUTHENTICATION-FLOW.md` | The exact login/OTP/password sequence |
| 6 | `docs/06-DATA-MODEL.md` | Core Django app/model layout, ERD |
| 7 | `docs/07-CLINICAL-MODULES-SPEC.md` | All 13 DHA modules + CCP mental-health modules |
| 8 | `docs/08-DHA-SHA-INTEGRATION.md` | FHIR, ICD-11, LOINC, e-claims, pre-auth, IPRS |
| 9 | `docs/09-SECURITY-COMPLIANCE.md` | RBAC, encryption, audit, DPIA, offline sync |
| 10 | `docs/10-API-SPECIFICATION.md` | REST endpoint contracts |
| 11 | `docs/11-ROADMAP-AND-PHASES.md` | Step-by-step build order, environment setup to production |
| 12 | `docs/12-DEVOPS-DEPLOYMENT.md` | Docker, Kubernetes, Terraform, CI/CD |
| 13 | `docs/13-TESTING-QA-CHECKLIST.md` | Test strategy and DHA certification checklist |

## 3. How Copilot should behave in this repo

- When asked to "scaffold module X," first check `docs/07-CLINICAL-MODULES-SPEC.md` for its fields, workflow, and DHA coding requirements, then check `docs/03-DESIGN-SYSTEM.md` for the matching mockup screen, then check `docs/06-DATA-MODEL.md` for where it fits in the schema.
- Never generate a login/registration screen without opening `docs/05-AUTHENTICATION-FLOW.md` first — the flow is unusual and must be followed exactly.
- Never hardcode a tenant assumption ("the hospital") — always parametrize by `Organization`.
- Prefer small, reviewable PRs mapped to the phases in `docs/11-ROADMAP-AND-PHASES.md`.
- Ask for the human's confirmation before running destructive database operations, before rotating secrets, and before applying Terraform to a real cloud account.
