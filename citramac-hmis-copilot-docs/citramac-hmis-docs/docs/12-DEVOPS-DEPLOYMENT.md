# 12 — DevOps: Docker, Kubernetes, Terraform, CI/CD

## 12.1 Local development (Docker Compose)

`infra/docker-compose.yml` services: `postgres`, `redis`, `backend` (Django, hot-reload volume mount), `celery_worker`, `celery_beat`, `frontend` (Vite/CRA dev server), `mailhog` (SMTP capture for OTP emails in dev). Use a `.env` file (gitignored) sourced from `.env.example`.

```yaml
# excerpt
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: citramac
      POSTGRES_USER: citramac
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes: [pgdata:/var/lib/postgresql/data]
  redis:
    image: redis:7
  backend:
    build: ../backend
    command: python manage.py runserver 0.0.0.0:8000
    env_file: ../.env
    depends_on: [postgres, redis]
  celery_worker:
    build: ../backend
    command: celery -A config worker -l info
    env_file: ../.env
    depends_on: [postgres, redis]
  celery_beat:
    build: ../backend
    command: celery -A config beat -l info
    env_file: ../.env
  mailhog:
    image: mailhog/mailhog
    ports: ["8025:8025"]
  frontend:
    build: ../frontend
    command: npm run dev -- --host
    ports: ["5173:5173"]
volumes:
  pgdata:
```

## 12.2 Dockerfiles

**Backend** — multi-stage, non-root user, Gunicorn as the production entrypoint:
```dockerfile
FROM python:3.12-slim AS base
WORKDIR /app
RUN adduser --disabled-password appuser
COPY requirements/production.txt .
RUN pip install --no-cache-dir -r production.txt
COPY . .
RUN python manage.py collectstatic --noinput
USER appuser
EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "4"]
```

**Frontend** — build stage + Nginx serve stage:
```dockerfile
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

Scan both images with Trivy in CI before push; fail the build on high/critical CVEs without an accepted exception.

## 12.3 Kubernetes

Structure: base manifests (or Helm chart templates) + Kustomize overlays per environment.

```
infra/k8s/base/
  backend-deployment.yaml
  backend-service.yaml
  frontend-deployment.yaml
  frontend-service.yaml
  celery-worker-deployment.yaml
  celery-beat-deployment.yaml
  ingress.yaml
  hpa-backend.yaml
  hpa-frontend.yaml
  networkpolicy.yaml
  configmap.yaml
infra/k8s/overlays/{dev,staging,production}/
  kustomization.yaml       # patches: replica counts, resource limits, env-specific secrets refs, domain names
```

Key rules:
- Backend and Celery worker are **separate Deployments** (never combined) per `02-TECH-STACK-AND-ARCHITECTURE.md` §2.2.
- Liveness/readiness probes on backend hit `/healthz` (checks DB + Redis connectivity); frontend probe hits `/` for a static 200.
- Resource `requests`/`limits` set on every container; `HorizontalPodAutoscaler` on backend (CPU + optional custom queue-depth metric) and frontend (CPU).
- `NetworkPolicy`: deny-by-default, explicit allow rules (frontend→backend, backend→postgres, backend→redis, backend→celery via broker only).
- Secrets referenced via `envFrom.secretRef`, sourced from the cloud secrets manager through an operator (e.g. External Secrets Operator) — not committed manifests with inline values.
- Ingress: Nginx ingress controller, TLS via cert-manager + Let's Encrypt (or managed cert), path routing `/api/*` → backend service, `/*` → frontend service.

## 12.4 Terraform

```
infra/terraform/
  modules/
    vpc/          # private subnets, NAT, security groups
    eks/          # managed Kubernetes cluster + node groups
    rds/          # managed Postgres, multi-AZ, automated backups, KMS
    storage/      # S3/GCS bucket for attachments/backups, versioned + encrypted
  envs/
    dev/main.tf         # wires modules together per environment, own remote state backend
    staging/main.tf
    production/main.tf
```

Rules:
- Remote state (S3+DynamoDB lock, or GCS+locking) per environment — never local state for anything beyond a first local experiment.
- No manual console changes in staging/production; all changes go through a `terraform plan` reviewed in PR, then `terraform apply` in CI on merge (production apply gated on manual approval).
- Tag/label every resource with `environment`, `project=citramac`, `managed-by=terraform` for cost tracking and cleanup safety.

## 12.5 CI/CD pipeline (GitHub Actions)

```
.github/workflows/
  ci.yml            # on every PR: lint, unit tests, integration tests, SAST, dependency scan
  build-and-scan.yml # on merge to main: build Docker images, scan with Trivy, push to registry
  deploy-staging.yml # on merge to main: kubectl/kustomize apply to staging automatically
  deploy-production.yml # manual workflow_dispatch, requires approval environment, promotes staging image tag to production
  terraform-plan.yml # on PR touching infra/terraform: post plan output as PR comment
  terraform-apply.yml # on merge, per-environment, with production requiring approval
```

Monitoring/observability to wire in this phase:
- Structured JSON logging from Django (`django-structlog` or similar) shipped to a log aggregator.
- Metrics: Prometheus + Grafana (or managed equivalent) — track request latency, error rate, Celery queue depth, DB connection pool saturation, SHA API call success/failure rate.
- Alerting: page on-call for elevated 5xx rate, Celery queue backlog, failed SHA claim submissions above threshold, and DB replica lag.
- Error tracking: Sentry (or equivalent) for both frontend and backend, scrubbing PHI from error payloads before send (critical — never let patient data leak into an error-tracking SaaS).

## 12.6 Backup & restore runbook (must be tested, not just written)

1. Confirm automated snapshot schedule active on managed Postgres.
2. Quarterly: restore the latest snapshot into an isolated scratch environment.
3. Run a data-integrity smoke test script against the restored copy (row counts, referential integrity spot checks, a sample patient record round-trip).
4. Document restore time achieved vs. RTO/RPO targets; adjust backup frequency if targets are missed.
5. Tear down the scratch environment via Terraform (never leave a lingering copy of PHI around).
