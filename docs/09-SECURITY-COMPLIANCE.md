# 09 — Security, Privacy & Compliance

This document is **non-negotiable**. Every PR touching auth, data access, or infrastructure must be checked against it before merge.

## 9.1 Encryption

- **At rest**: PostgreSQL storage-level encryption via managed DB (RDS/Cloud SQL) KMS keys (AES-256). Additionally, column-level encryption (`django-cryptography`/`pgcrypto`) for the most sensitive fields: national ID numbers, psychiatric session notes content, SUD screening results, SHA policy numbers.
- **In transit**: TLS 1.3 everywhere — ingress termination, service-to-service, and DB connections (`sslmode=verify-full`). No plaintext HTTP anywhere, including internal cluster traffic where feasible (mTLS via service mesh is a phase-3 stretch goal).
- **Secrets**: Kubernetes `Secret` objects sourced from a managed secrets manager (AWS Secrets Manager / GCP Secret Manager / HashiCorp Vault) — never committed to Git, never baked into images. Enforce with a pre-commit secret-scanner (`gitleaks` or `detect-secrets`) in CI.

## 9.2 Authentication & password policy

- Argon2 password hashing (Django `Argon2PasswordHasher` as the primary hasher).
- Password policy: minimum 12 characters, at least one upper, one lower, one digit, one symbol; checked against a common-password/breach list (e.g. HaveIBeenPwned range API or a bundled blocklist) at set-password time.
- MFA/OTP required by default for Super Admin, Org Admin, and all clinical roles with PHI access (see `05-AUTHENTICATION-FLOW.md`); optional-but-encouraged for lower-risk roles (e.g., pure billing/reception), controlled per-role by Org Admin.
- JWT access tokens short-lived (15 min); refresh tokens httpOnly secure cookies, rotated on every use, revocable (server-side denylist on logout/security event).
- Account lockout after 5 failed login attempts within 15 minutes; unlock via admin action or timed cooldown.

## 9.3 Role-Based Access Control (RBAC)

- Roles are **per-organization** assignable (a global `Role` template library Super Admin curates, then Org Admin assigns/customizes permission subsets within their org — Org Admin cannot grant permissions the platform template doesn't allow).
- Permission checks are enforced at the **API layer** (DRF permission classes) and mirrored at the **DB layer** via RLS org scoping (`04-MULTI-TENANCY.md`) — never rely on frontend hiding of a button as the only control.
- **Elevated tier for mental-health/SUD records** (`07-CLINICAL-MODULES-SPEC.md` §7.14.7): a `CareTeamMembership` join table gates access to `PsychotherapySession`, `SudRehabPlan`, `UrineDrugScreen`, and `BiopsychosocialAssessment` content beyond the base role check — only the assigned care team, their supervisor chain, and the patient's registered Org Admin (for compliance/audit purposes only, itself logged) can view full content.
- Standard roles ship pre-configured: Super Admin, Org Admin, Doctor, Nurse, Clinical Psychologist/Therapist, Lab Technician, Radiologist, Pharmacist, Cashier/Billing Clerk, Records Officer, Supervisor, Auditor (read-only, cross-module, for compliance reviews).

## 9.4 Immutable audit trail

- Every read, create, update, and delete on a patient-linked record writes an `AuditLogEntry`: `organization_id`, `branch_id`, `actor_user_id`, `actor_role`, `action`, `model`, `object_id`, `field_diff` (for updates), `timestamp`, `source_ip`, `request_id`.
- Audit entries are **append-only**: enforce via a DB trigger or a dedicated write-only role/table permissions so even a compromised application credential cannot rewrite history. Consider hash-chaining entries (each entry's hash includes the previous entry's hash) for tamper-evidence, reviewable at DHA audit time.
- Provide an Audit Log viewer (Super Admin: cross-tenant; Org Admin/Auditor role: scoped to their org) with filter/search — this is the screen DHA evaluators will want to see live (`08-DHA-SHA-INTEGRATION.md` §8.6).
- Sensitive record **views** (not just edits) must also be logged for psychiatric/SUD records specifically, per Data Protection Act "who accessed my file" accountability.

## 9.5 Data Protection Act / consent compliance

- Explicit, timestamped, revocable consent capture for data sharing across the national health exchange (`Patient.consent_data_sharing`), stored with the exact consent text version shown at capture time (for legal defensibility if the consent language changes later).
- Support a **Right-to-Erasure request workflow**: distinct from routine soft-delete, requires Org Admin + a compliance officer sign-off, produces an audit record of the erasure itself, and enforces any legal retention minimums (e.g., certain clinical records may have statutory minimum retention periods that override an erasure request — flag this conflict to the requester rather than silently refusing or silently complying).
- Data Protection Impact Assessment (DPIA) template lives in `13-TESTING-QA-CHECKLIST.md` §13.4 — fill it in per-tenant facility type before go-live, required for DHA certification step 2.

## 9.6 Backup & disaster recovery

- Automated daily full + continuous WAL-based point-in-time-recovery backups on managed Postgres, encrypted, retained per policy (minimum 35 days rolling, plus monthly archives to cold storage for 7 years to satisfy medical-record retention norms — confirm exact figure with legal/DHA guidance before production go-live).
- Documented, **tested** restore runbook (`12-DEVOPS-DEPLOYMENT.md` §12.6) — a backup that has never been restored in a drill is not a backup.
- Multi-AZ database deployment in production; automated failover.

## 9.7 Infrastructure/application hardening checklist

- [ ] Dependency vulnerability scanning in CI (`pip-audit`, `npm audit`, or Snyk/Dependabot).
- [ ] Static analysis / SAST on every PR (`bandit` for Python, `eslint-plugin-security` for TS).
- [ ] Container image scanning (Trivy) before pushing to registry.
- [ ] Rate limiting and WAF rules at the ingress layer for auth and public-facing endpoints.
- [ ] Content Security Policy headers, `X-Frame-Options`, `Strict-Transport-Security`, `X-Content-Type-Options` set on all HTTP responses.
- [ ] Network policies in Kubernetes restricting pod-to-pod traffic to declared dependencies only (deny-by-default).
- [ ] Least-privilege IAM roles per Terraform-managed cloud resource.
- [ ] Quarterly access review: unused accounts, stale role assignments, orphaned API keys.

## 9.8 Offline mode security

- Locally cached data on clinical devices (for the offline mode required by DHA, `08-DHA-SHA-INTEGRATION.md` §8.5) must itself be encrypted at rest on the device (e.g. encrypted IndexedDB wrapper) and purged after a configurable inactivity period, since a lost/stolen device with a cached offline queue is a real PHI exposure risk.
