# CITRAMAC HMIS

Multi-tenant mental health and addiction treatment information system, built on
**FHIR R4 (4.0.1)** as its data contract. Reference tenant: CAfRIC Centre.

**Standing rules:** [`CLAUDE.md`](CLAUDE.md) is the binding specification for this
codebase — FHIR R4 conformance, the definition of done for clinical features,
the mandatory architecture and what is forbidden. Read it before changing
anything clinical.

## Current status

- Built: tenancy and RLS isolation, auth (identify → OTP → MFA), Super Admin /
  Org Admin / Clinical Workspace shells, and the v4 clinical workspace —
  registration, triage, psychiatry review, intake, care plan, notes,
  psychotherapy, legal status, discharge and follow-up, documents, billing and
  SHA claims.
- FHIR: resources are built with `fhir.resources.R4B` (documented exception,
  CLAUDE.md 2026-09-18) and every build checks them against HL7's R4 4.0.1
  schema. That is rung 2 of the conformance ladder; rungs 3–4 (profiles and a
  published implementation guide) wait on the national IG.
- Published examples (routine, edge case, refusal/omission) live next to the
  code that builds them, in each app's `fhir_examples/`.
- Open `VERIFY:` items (codes, canonical URLs, statutes) are marked in code and
  must be resolved against the publisher, never filled from memory.
- Design: the previous spec documents and mockups were removed on 2026-10-21;
  updated mockups are pending. They remain in git history (commit `f80b45b`).

## FHIR endpoints

| Endpoint | Resource |
|---|---|
| `GET /api/v1/care/triage/<id>/fhir/` | Triage Bundle (Patient, EpisodeOfCare, Encounter, QuestionnaireResponse, RiskAssessment, Provenance, Flag, Task) |
| `GET /api/v1/care/discharges/<id>/fhir/` | Discharge summary document Bundle |
| `GET /api/v1/fhir/AuditEvent/?patient=<id>` | A client's access and change history as AuditEvents (Org Admin / Auditor) |

## Local development

```bash
cp .env.example .env   # fill in real values
cd infra
docker compose up
```

- Backend (Django admin): http://localhost:8000/admin/
- API schema / docs: http://localhost:8000/api/v1/docs/
- Health check: http://localhost:8000/healthz
- Frontend (Vite dev server): http://localhost:5173
- Mailhog (captures OTP/auth emails in dev): http://localhost:8025

### Without Docker

```bash
# Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements/dev.txt
python manage.py migrate
python manage.py runserver

# Frontend
cd frontend
npm install
npm run dev
```

### FHIR conformance check

The same check CI runs on every build (needs Postgres):

```bash
cd backend
pytest apps/dha_interop/tests.py apps/care_pathway/test_fhir_examples.py \
  apps/care_pathway/test_registration_hie.py apps/sysadmin_audit/tests.py -k FhirR4Conformance
```

### Pre-commit hooks

```bash
pip install -r backend/requirements/dev.txt   # includes pre-commit
pre-commit install
pre-commit run --all-files                    # backend: black/isort/ruff/bandit; frontend: eslint/prettier; detect-secrets
```

## Repository layout

| Path | Contents |
|---|---|
| `backend/` | Django 5 / DRF API, one app per domain under `apps/` |
| `frontend/` | React + TypeScript + Vite; role shells in `src/shells/`, screens in `src/modules/` |
| `infra/` | Docker Compose, Kubernetes (Kustomize overlays incl. the k3s demo VPS), Terraform |
| `.github/` | CI (lint, tests, tenant-isolation and FHIR conformance gates), image build/scan, deploys |
