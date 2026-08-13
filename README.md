# CITRAMAC HMIS

Multi-tenant, DHA-certifiable, SHA-integrated Hospital & Mental Health
Management Information System. Reference tenant: CAfRIC Centre.

**Full specification:** [`docs/`](docs/) — read `.github/copilot-instructions.md`
first, then the numbered docs in order. Design source of truth: [`mockups/`](mockups/).

## Current status

**Phase 0 — Environment & repo bootstrap: complete.**
See `docs/11-ROADMAP-AND-PHASES.md` for the full phase plan. Next up: **Phase 1
— Tenancy, Identity & Auth**.

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

### Pre-commit hooks

```bash
pip install -r backend/requirements/dev.txt   # includes pre-commit
pre-commit install
pre-commit run --all-files                    # backend: black/isort/ruff/bandit; frontend: eslint/prettier; detect-secrets
```

## Repository layout

See `docs/02-TECH-STACK-AND-ARCHITECTURE.md` §2.5 for the authoritative layout.
Standing build rules (mandatory stack, phase order, design fidelity, tenancy,
auth flow) live in `.github/copilot-instructions.md` — read it before touching
any area of this codebase.
