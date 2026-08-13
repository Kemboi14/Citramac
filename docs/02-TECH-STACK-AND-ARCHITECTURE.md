# 02 — Tech Stack & Architecture

This is the **mandatory** stack. Do not substitute frameworks or databases. It mirrors the approved reference architecture diagrams supplied with this project.

## 2.1 Layered application stack

```
FRONTEND UI
  React + TypeScript + Tailwind CSS / Shadcn UI / Lucide icons
  - Theme variables for 1-click color palette customization (per tenant branding, within approved palette bounds)
  - Interactive UI for clinic rosters, POS, bed layout, clinical charting
        │
        │  REST / GraphQL API (REST is primary; GraphQL optional for reporting/aggregation)
        ▼
BACKEND APPLICATION
  Django + Django REST Framework
  - Built-in Auth & RBAC (Doctor / Nurse / Admin / Super Admin / Org Admin / Cashier / Lab Tech / Pharmacist roles)
  - Patient records, inventory, and billing modules
  - Celery + Redis for async tasks (OTP emails, PDF generation, SMS reminders, SHA claim submission)
        │
        │  Encrypted SQL Queries (TLS to DB, column-level encryption for sensitive fields)
        ▼
DATABASE LAYER
  PostgreSQL
  - ACID compliance & encryption-at-rest (AES-256)
  - JSONB support for flexible lab results, vitals, and clinical form payloads
  - Row-level isolation per tenant (see 04-MULTI-TENANCY.md)
```

## 2.2 Container & orchestration architecture

```
KUBERNETES CLUSTER
 ├─ Ingress Controller / Nginx (SSL/TLS termination + path routing)
 │     ├──▶ Frontend Pods (React)         — Docker: Nginx + static React build
 │     └──▶ Backend Pods (Django)         — Docker: Django + Gunicorn
 │             │
 │             ▼
 ├─ Worker Pods (Celery)                  — Async tasks: PDFs, SMS, OTP emails, SHA claim dispatch
 └─ Database (PostgreSQL)                 — StatefulSet or managed Postgres (RDS/Cloud SQL)
```

**Design rules:**
- Frontend and backend are **separate Deployments** with independent scaling (frontend is stateless and scales aggressively on traffic spikes; backend scales on CPU/queue depth).
- Celery workers are a **separate Deployment** from the Django web pods — never run Celery in the same process as Gunicorn.
- Use `HorizontalPodAutoscaler` on both frontend and backend based on CPU + custom metrics (request latency, queue depth).
- Readiness/liveness probes required on every pod (`/healthz` on backend, static 200 on frontend).
- Secrets (DB creds, SHA API keys, JWT signing keys, SMTP creds) come from Kubernetes `Secret` objects sourced from a vault (see 09-SECURITY-COMPLIANCE.md), never baked into images.

## 2.3 Infrastructure-as-Code architecture

```
TERRAFORM (Infrastructure as Code)
  Automates & versions cloud infrastructure via HCL (Git Ops)
        │ provisions
        ▼
CLOUD PROVIDER (AWS / GCP / Azure — pick one primary target, design portable)
 ├─ Private VPC & Subnets (encrypted isolation)
 │     └──▶ Managed Kubernetes (EKS/GKE/AKS)
 │              └─ App Pods (Django + React UI)  ── encrypted internal VPC connections ──┐
 └─ Managed PostgreSQL (RDS/Cloud SQL)  (automated backups & KMS-managed encryption keys) ◀┘
```

**Design rules:**
- All infrastructure is defined in Terraform modules under `infra/terraform/` — no manual console changes ("ClickOps") in any environment beyond initial bootstrap.
- Separate Terraform workspaces/state per environment: `dev`, `staging`, `production`.
- Managed Postgres (not self-hosted) in staging/production for automated backups, point-in-time recovery, and KMS-managed encryption at rest.
- S3/GCS/equivalent object storage (versioned, encrypted) for attachments, lab PDFs, imaging references, and DB backups.

## 2.4 Complete stack summary table

| Layer | Technology | Primary Responsibility |
|---|---|---|
| Infrastructure Provisioning | Terraform | Automates network VPCs, K8s clusters, managed DBs, and object storage with version control |
| Containerization | Docker | Standardizes runtime environments for React, Django, and Celery workers |
| Container Orchestration | Kubernetes | Auto-scaling, high availability, rolling updates, self-healing pods |
| Database | PostgreSQL | Patient health records, inventory, billing data with strict ACID compliance |
| Backend API | Django REST Framework | Business logic, patient workflows, authentication, RBAC permissions |
| Frontend UI | React + TypeScript + Tailwind | High-speed interfaces with global color palette and theme customization |
| Async/Background | Celery + Redis | OTP dispatch, PDF/report generation, SMS reminders, SHA claim submission queue |
| Search (optional, phase 3+) | PostgreSQL full-text or OpenSearch | Fast client/record search across large tenants |

## 2.5 Repository layout

```
citramac-hmis/
├── backend/
│   ├── config/                  # Django project settings (split by environment)
│   │   ├── settings/
│   │   │   ├── base.py
│   │   │   ├── dev.py
│   │   │   ├── staging.py
│   │   │   └── production.py
│   │   ├── urls.py
│   │   ├── celery.py
│   │   └── wsgi.py / asgi.py
│   ├── apps/
│   │   ├── tenancy/              # Organization, Branch, tenant middleware
│   │   ├── accounts/             # Users, roles, auth, OTP, sessions
│   │   ├── client_registry/      # Module 1: patient registration/demographics
│   │   ├── triage/                # Module 2
│   │   ├── clinical_encounter/    # Module 3: EHR/SOAP/CPOE/e-prescribing
│   │   ├── lims/                  # Module 4: laboratory
│   │   ├── ris_pacs/               # Module 5: radiology
│   │   ├── pharmacy/               # Module 6
│   │   ├── ipd_ward/                # Module 7
│   │   ├── theatre/                 # Module 8
│   │   ├── mch/                     # Module 9
│   │   ├── billing/                 # Module 10
│   │   ├── insurance_claims/        # Module 11 + SHA gateway
│   │   ├── mortuary/                 # Module 12
│   │   ├── sysadmin_audit/           # Module 13: RBAC, audit trail, backups
│   │   ├── ccp_program/              # CAfRIC-specific: psychotherapy, SUD rehab, supervision
│   │   ├── dha_interop/              # FHIR, ICD-11, LOINC, IPRS integration
│   │   └── notifications/            # Email/SMS/OTP dispatch
│   ├── requirements/
│   ├── manage.py
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── theme/                # design tokens from 03-DESIGN-SYSTEM.md
│   │   ├── modules/               # one folder per clinical/admin module, mirrors backend apps
│   │   ├── shells/                 # SuperAdminShell, OrgAdminShell, ClinicalWorkspaceShell
│   │   ├── auth/                    # multi-step login/OTP flow
│   │   └── lib/
│   ├── package.json
│   └── Dockerfile
├── infra/
│   ├── docker-compose.yml         # local dev
│   ├── k8s/                        # raw manifests or Helm chart
│   │   ├── base/
│   │   └── overlays/{dev,staging,production}/  (Kustomize)
│   └── terraform/
│       ├── modules/{vpc,eks,rds,s3}/
│       └── envs/{dev,staging,production}/
├── docs/                            # this document set
└── .github/
    ├── copilot-instructions.md
    └── workflows/                  # CI/CD pipelines
```
