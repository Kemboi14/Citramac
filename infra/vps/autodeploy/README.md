# VPS auto-deploy

The k3s VPS (`demo.citramac.com`) deploys itself: every 3 minutes a systemd timer
runs `citramac-autodeploy`, which looks for the newest `master` commit whose
**CI** workflow passed and deploys it.

## How it works

The server asks GitHub for the latest green commit (`git ls-remote`, then
one unauthenticated API call when `master` has moved). The repository is
public, so no credential is involved. GitHub holds no key to the server, and nothing
outside can trigger a deploy. A commit that has not passed CI (lint, bandit,
dependency audit, migrations check, the full test suite, the FHIR R4 and
Kenya Core validators, the frontend build and tests) is never deployed.

For each new green commit:

1. Fast-forward `/opt/citramac/app` to it. It never goes backwards, and it refuses if
   history was rewritten or the checkout has local changes.
2. Build only what changed (`backend/`, `frontend/`) as `:candidate` and import
   it into k3s.
3. Backend: a one-off pod runs `migrate --check` on the candidate. If the database
   is behind, `pg_dump` it to `/opt/citramac/backup-autodeploy-<time>-<sha>.sql`
   (mode 600; the newest 14 of these are kept, hand-made backups are never
   touched), then migrate with `MIGRATION_DATABASE_URL`. A failed backup or
   migration stops the deploy. The running pods are not touched.
4. The old `:latest` becomes `:previous` and the candidate becomes `:latest`. Then
   `kubectl apply -k infra/k8s/overlays/vps` runs and the changed deployments
   (backend + celery worker + beat, and/or frontend) restart and roll out.
5. `/healthz` must answer. If the rollout or health check fails, the images go back to
   `:previous`. **Migrations already applied stay applied.** The log and
   `status` say so, with the backup path.

A commit that fails is not retried. The next green commit is tried.

One-off pods are labelled `app=citramac-celery-worker`. The DB network policy
admits that label, and no Service routes traffic to it. A pod labelled
`app=citramac-backend` would receive live requests from the backend Service.

## Operating it

```
citramac-autodeploy status      # deployed commit, last result, paused?
citramac-autodeploy pause       # before a manual deploy or maintenance
citramac-autodeploy resume
journalctl -u citramac-autodeploy -n 100     # full log of recent runs
cat /var/lib/citramac-autodeploy/history     # one line per deploy attempt
```

Pause it before deploying by hand, so the two cannot interleave. To retry a
failed commit after fixing the cause on the server, remove
`/var/lib/citramac-autodeploy/failed`.

## Installing or updating

As root on the VPS, after reviewing the change:

```
bash /opt/citramac/app/infra/vps/autodeploy/install.sh
```

The script is copied to `/usr/local/sbin`, not run from the checkout. A push
can change the application, but it cannot change the root-run deployer until
someone installs it. Settings (`APP_DIR`, `API_BASE_URL`, `HEALTH_URL`,
`KEEP_BACKUPS`, …) can be overridden in `/etc/citramac-autodeploy.env`.
