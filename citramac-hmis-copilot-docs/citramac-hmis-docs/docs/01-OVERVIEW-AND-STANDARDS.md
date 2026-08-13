# 01 — Project Overview & Regulatory Standards

## 1.1 Purpose

CITRAMAC is a **multi-tenant Hospital & Mental Health Management Information System (HMIS)**. The reference/first tenant is **CAfRIC Centre**, a specialized mental health, psychological trauma, and rehabilitation facility, but the platform must onboard any facility type (general hospital, dispensary, rehab centre, clinic) as an independent, isolated tenant ("Organization") on the same codebase and infrastructure.

The system must be buildable end-to-end into a **production-ready, DHA-certifiable** product — this is not a prototype exercise.

## 1.2 Universal Health Coverage (UHC) — why this system exists

UHC requires that all individuals access essential health services without financial ruin. It rests on five pillars CITRAMAC must actively support:

1. **Healthcare Financing** — risk pooling and strategic purchasing (SHA replaces out-of-pocket payment as the default).
2. **Human Resources for Health (HRH)** — equitable staff deployment, CME tracking.
3. **Health Information Systems (HIS)** — unified data, real-time evidence for decision-making.
4. **Health Infrastructure** — resilient digital infrastructure (this system) alongside physical infrastructure.
5. **Essential Medicines & Service Delivery** — decentralized care, tight pharmacy/inventory control.

CITRAMAC's modules (see `07-CLINICAL-MODULES-SPEC.md`) map directly onto these pillars — inventory/pharmacy → pillar 5, dashboards/reporting → pillar 3, billing/SHA → pillar 1.

## 1.3 Social Health Authority (SHA) — mandatory integration

SHA replaced NHIF as Kenya's unified, mandatory digital health fund. **As of the August 2026 regulatory deadline, the standalone SHA web portal is discontinued.** All hospitals must integrate their own HMIS directly with SHA via secure APIs — manual portal entry is no longer permitted. CITRAMAC must be built API-native from day one. Full technical detail is in `08-DHA-SHA-INTEGRATION.md`. Summary of what CITRAMAC must do:

- **Real-time member verification** — query SHA registry with National ID / Passport / UPI; return active status, premium compliance, dependents.
- **Digital pre-authorization** — package clinical notes + diagnostic evidence, digitally sign, submit to SHA Pre-Auth portal, receive approval/feedback into the clinician's workspace.
- **Direct e-claims** — on discharge, auto-compile ICD-11 codes, treatment plan, surgical reports, pharmacy dispenses, invoices into a signed JSON payload pushed to the SHA Claims Gateway. Zero manual claim filing.

### SHA benefit funds the system must model

| Fund | Financing | Coverage | Facility levels |
|---|---|---|---|
| Primary Healthcare Fund | National exchequer | Outpatient, preventive screening, immunization, family planning | Level 2–3 |
| Social Health Insurance Fund (SHIF) | Household contributions | Inpatient, surgery, maternal care, oncology, **mental health**, dialysis | Level 4–6 |
| Emergency, Chronic & Critical Illness Fund (ECCIF) | National safety net | Emergency/trauma, ICU/HDU, chronic disease management once SHIF limits exhausted | All |

CITRAMAC's billing engine (`Module 10`) must be able to attribute a line item to the correct fund automatically based on service type and patient coverage.

## 1.4 Digital Health Agency (DHA) — the regulator

The Digital Health Act established the DHA to regulate Kenya's digital health ecosystem. Every HMIS must be **certified** via the DHA Certification Portal before legal operation. Core pillars CITRAMAC must satisfy (detailed technically in `09-SECURITY-COMPLIANCE.md` and `08-DHA-SHA-INTEGRATION.md`):

- **Standardized Interoperability** — HL7 FHIR for cross-institution record exchange.
- **Unified Terminology** — ICD-11 (diagnoses), LOINC (lab orders/results), national drug index (medications).
- **Strict Privacy & Security** — RBAC, AES-256 at rest, TLS 1.3 in transit, immutable audit trails.
- **Reliable Offline Mode** — local caching + automated queue-sync when connectivity returns.

### DHA Certification lifecycle (design the system so each step is demonstrable)

1. **Developer Registration** — register software name/version on the DHA portal.
2. **Self-Assessment & Documentation** — submit architecture docs, DPIA, compliance checklist answers (this doc set is the source material).
3. **Sandbox Integration & Testing** — connect to DHA's API sandbox; validate FHIR payload exchange, registry queries, mock SHA claims.
4. **Technical Demonstration & Audit** — live demo of BMI calculators, ICD-11 coding, secure audit logs, key workflows to DHA evaluators.
5. **Certification & Registry Listing** — DHA issues a compliance certificate; the version is listed on the national registry.

Build features so that a live demo of steps 3–4 is trivial: keep a `/sandbox` environment, seed scripts for demo data, and a visible audit log viewer.

## 1.5 Specialized requirement: CAfRIC Centre (mental health) modules

Unlike a general Level 5/6 acute hospital (e.g., the Apeiro/KNH deployment), CAfRIC is a **mental health, trauma, and rehabilitation** facility. Standard surgical/acute modules do not apply; instead the clinical module set must include (fully specified in `07-CLINICAL-MODULES-SPEC.md`):

- Comprehensive Psychiatric & Biopsychosocial Assessments (developmental, social, psychological history)
- Trauma Processing & Psychotherapy Trackers (individual counseling, family therapy, trauma processing over time)
- Substance Use Disorder (SUD) Rehab Workflows (multi-phase plans, recovery milestones, periodic urine drug screening)
- Elevated Privacy & Consent Management for psychiatric records (Data Protection Act compliance, stricter than general medical records)

The system must therefore support **per-tenant clinical module configuration** — a general hospital tenant enables surgical/IPD-heavy modules; a CCP-type tenant enables the mental-health module set. See `04-MULTI-TENANCY.md` §"Feature flags per tenant type."

## 1.6 Non-functional summary (expanded in later docs)

- Multi-tenant, horizontally scalable, cloud-native (Docker + Kubernetes + Terraform).
- PostgreSQL as system of record, encrypted at rest, JSONB for flexible clinical data.
- Django + Django REST Framework backend; React + TypeScript + Tailwind (Shadcn/Lucide) frontend.
- Designed for DHA certification and SHA API integration from the first sprint, not retrofitted later.
