# On-Call Runbook

Operational doc (not one of the numbered `01`-`13` spec docs) — companion to
`12-DEVOPS-DEPLOYMENT.md` §12.5 and `11-ROADMAP-AND-PHASES.md` Phase 9
("Monitoring/alerting live ... on-call runbook published").

## Accessing the dashboards

Grafana is deliberately not exposed on the public Ingress (see
`infra/k8s/base/monitoring/grafana-service.yaml`) — reach it via:

```
kubectl port-forward -n citramac-<env> svc/grafana 3000:3000
```

then open `http://localhost:3000` (admin / the `GRAFANA_ADMIN_PASSWORD`
value from that environment's `citramac/<env>/monitoring` Secrets Manager
entry). The **CITRAMAC Overview** dashboard covers request rate, 5xx rate,
DB query latency (p50/p95), DB connections, Celery queue depth, and SHA
failed-transaction counts.

Prometheus itself (`svc/prometheus:9090`) and Alertmanager
(`svc/alertmanager:9093`) are reachable the same way for raw query/alert
inspection.

## Alert: High 5xx Rate

**Fires when:** backend 5xx responses exceed 5% of total requests for 5
minutes (`HighHttp5xxRate`, `infra/k8s/base/monitoring/prometheus-configmap.yaml`).

1. Check the Grafana overview dashboard's error-rate panel to confirm this
   isn't a single noisy endpoint vs. a platform-wide failure.
2. `kubectl logs -n citramac-<env> deploy/citramac-backend --tail=200` —
   structured JSON logs (`django-structlog`, see `backend/config/settings/base.py`)
   include `request_id`/`code`/`request` on every `request_finished` line;
   grep for `"code": 5` to isolate the failing requests.
3. If Sentry is configured for this environment (`SENTRY_DSN` set), check
   it for grouped stack traces — PHI is stripped from the payload
   (`backend/config/observability.py`'s `_scrub_phi`) but the stack trace
   and URL path are enough to identify the failing code path.
4. Check `kubectl rollout history deploy/citramac-backend` — if the alert
   started right after a deploy, `kubectl rollout undo deploy/citramac-backend`
   (the same rollback step `deploy-production.yml` runs automatically on a
   failed rollout) is the fastest mitigation while root-causing.
5. Check DB connectivity (`/healthz`) and RDS status in the AWS console —
   a database outage surfaces here as a 5xx spike too.

## Alert: Celery Queue Backlog

**Fires when:** the default Celery queue depth exceeds 500 tasks for 10
minutes (`CeleryQueueBacklog`), or the depth metric itself can't be read
(`CeleryQueueDepthUnavailable`, `citramac_celery_queue_depth < 0` —
`backend/config/metrics.py`'s `CeleryQueueDepthCollector` returns `-1` on a
Redis connection failure rather than silently reporting `0`).

1. `CeleryQueueDepthUnavailable` first: confirm Redis/ElastiCache is
   reachable from the backend pods before worrying about backlog size —
   check the managed Redis instance's health in the AWS console and the
   `allow-backend-tier-egress` NetworkPolicy (port 6379) is intact.
2. `CeleryQueueBacklog`: check `kubectl get deploy citramac-celery-worker`
   replica count and `kubectl top pods -l app=citramac-celery-worker` — a
   backlog usually means either a burst of work (batch SHA sync, offline
   client reconnect flush — `docs/08-DHA-SHA-INTEGRATION.md` §8.5) or a
   stuck/crash-looping worker.
3. `kubectl logs deploy/citramac-celery-worker --tail=200` for repeated
   task failures/retries eating worker capacity.
4. Scale the worker Deployment manually if it's a genuine load spike
   (`kubectl scale deploy/citramac-celery-worker --replicas=N`) — there is
   no HPA on the worker Deployment yet (see `infra/k8s/base/hpa-*.yaml`,
   backend/frontend only), a disclosed gap for a future pass.

## Alert: SHA Claim Failures

**Fires when:** more than 5 SHA e-claim submissions failed in the last 15
minutes (`ShaClaimFailuresHigh`, reading
`apps.dha_interop.models.ShaTransactionLog` via
`backend/config/metrics.py`'s `ShaFailureRateCollector`).

1. Every failure is already logged with the request/response payload in
   `ShaTransactionLog` — query the most recent `FAILED` rows for
   `transaction_type="E_CLAIM"` via Django admin or shell to see the actual
   SHA gateway error response.
2. Common causes: SHA sandbox/production API outage (check SHA's own
   status channel), an expired/misconfigured signing certificate
   (`docs/08-DHA-SHA-INTEGRATION.md` §8.4's JWS signing requirement), or a
   claim missing a field SHA now requires (a contract/schema change on
   their end).
3. If SHA's API is down, claims stay queued for retry
   (`apps.insurance_claims.sha_gateway`'s Celery-based retry/backoff) —
   this alert is informational until failures persist past SHA's outage
   window; escalate to a person only if failures continue after SHA
   confirms recovery.
4. Never route this alert to a generic on-call rotation without also
   notifying whoever owns the SHA integration relationship — some failures
   need SHA-side account/certificate action, not a code fix.

## Alert: DB Replica Lag

**Status: inert.** `DbReplicaLagHigh` references the metric
`pg_replication_lag_seconds`, which nothing currently exports — RDS is
provisioned with `multi_az` for synchronous failover
(`infra/terraform/modules/rds`), not a separate asynchronous read replica,
and no `postgres_exporter` is deployed. The rule is kept in
`infra/k8s/base/monitoring/prometheus-configmap.yaml` (rather than omitted)
so it activates automatically the moment both exist, matching
`12-DEVOPS-DEPLOYMENT.md` §12.5's required alert list — but as of this
Phase 9 pass, it will never fire. If a read replica is added later, deploy
a `postgres_exporter` pointed at it and this alert becomes live with no
further changes needed.

## Escalation

Alertmanager's receiver is an intentional stub
(`infra/k8s/base/monitoring/alertmanager-configmap.yaml`) — alerts are
visible in Prometheus/Alertmanager's own UI but **nothing pages anyone
yet**. Before this environment goes live with real patient data flowing
through it, wire a real receiver (PagerDuty/Slack/email — whichever the
team actually uses for on-call) via an `ExternalSecret`-backed
`alertmanager.yml`, the same pattern already used for the backend's own
secrets (`infra/k8s/base/external-secret.yaml`). Until then, on-call needs
to check the Grafana dashboard / Alertmanager UI proactively rather than
waiting to be paged.

## Known gaps in this monitoring pass (disclosed, not hidden)

- No real paging integration (see Escalation above).
- `DbReplicaLagHigh` is inert (see above).
- No HPA on `citramac-celery-worker` — scaling under backlog is manual.
- Prometheus uses `emptyDir` for TSDB storage (`prometheus-deployment.yaml`)
  — metrics history is lost on pod restart/reschedule; a
  `PersistentVolumeClaim` needs a live cluster's `StorageClass` to validate
  against, which this build environment never had.
- All of the above were never live-cluster-tested (no real Kubernetes
  cluster or AWS account available while building this) — validated only
  via `kubectl kustomize` build success and `terraform validate`/`fmt`, per
  the same disclosed limitation as Phase 8's infrastructure work.
