# 10 — API Specification (contract outline)

Base URL: `/api/v1/`. All responses JSON. All list endpoints paginated (`?page=`, `?page_size=`), filterable, and org-scoped automatically by `TenantMiddleware` (`04-MULTI-TENANCY.md`). Document the final contract with **drf-spectacular** (OpenAPI 3) served at `/api/v1/schema/` and `/api/v1/docs/` (Swagger UI) — treat this file as the seed for that generated schema, not a replacement for it.

## 10.1 Auth (full detail in `05-AUTHENTICATION-FLOW.md` §5.6)
`POST /auth/identify/` · `POST /auth/confirm-email/` · `POST /auth/verify-otp/` · `POST /auth/resend-otp/` · `POST /auth/set-password/` · `POST /auth/login/` · `POST /auth/login/verify-otp/` · `POST /auth/refresh/` · `POST /auth/logout/` · `POST /auth/forgot-password/`

## 10.2 Platform (Super Admin)
```
GET/POST   /platform/organizations/
GET/PATCH  /platform/organizations/{id}/
POST       /platform/organizations/{id}/suspend/
GET/POST   /platform/subscription-plans/
GET        /platform/audit-log/                 (cross-tenant, Super Admin only)
GET/POST   /platform/roles/                      (template roles)
```

## 10.3 Org Admin
```
GET/POST   /orgs/{org_id}/branches/
GET/PATCH  /orgs/{org_id}/branches/{id}/
GET/POST   /orgs/{org_id}/staff/
GET/POST   /orgs/{org_id}/roles/
GET/PATCH  /orgs/{org_id}/settings/
GET        /orgs/{org_id}/audit-log/             (org-scoped)
GET/POST   /orgs/{org_id}/wards/
GET/POST   /orgs/{org_id}/beds/
```

## 10.4 Client Registry / Module 1
```
GET/POST   /patients/
GET/PATCH  /patients/{id}/
POST       /patients/{id}/verify-iprs/
GET/POST   /patients/{id}/emergency-contacts/
GET/POST   /patients/{id}/insurance-coverage/
POST       /patients/{id}/insurance-coverage/verify-sha/
GET/POST   /appointments/
```

## 10.5 Triage & Clinical Encounter / Modules 2–3
```
POST       /encounters/
GET/PATCH  /encounters/{id}/
POST       /encounters/{id}/vitals/
POST       /encounters/{id}/mse/                        (mental status exam)
POST       /encounters/{id}/soap-notes/
POST       /encounters/{id}/soap-notes/{note_id}/sign/
POST       /encounters/{id}/diagnoses/
GET        /terminology/icd11/search/?q=
POST       /encounters/{id}/orders/                       (CPOE)
POST       /encounters/{id}/prescriptions/
POST       /encounters/{id}/referrals/                     (generates FHIR bundle)
```

## 10.6 LIMS / Module 4
```
POST       /lab/orders/
POST       /lab/specimens/                                (barcode generation)
POST       /lab/results/
POST       /lab/results/{id}/validate/                     (senior review gate)
GET        /terminology/loinc/search/?q=
```

## 10.7 Radiology / Module 5
```
POST       /radiology/orders/
POST       /radiology/reports/
GET        /radiology/pacs/{study_id}/                     (DICOM viewer proxy)
```

## 10.8 Pharmacy / Module 6
```
GET/POST   /pharmacy/stock-items/
POST       /pharmacy/stock-movements/
POST       /pharmacy/dispense/{prescription_item_id}/
GET        /terminology/drug-index/search/?q=
```

## 10.9 IPD & Ward / Module 7
```
POST       /ipd/admissions/
POST       /ipd/admissions/{id}/transfer/
POST       /ipd/admissions/{id}/discharge/
POST       /ipd/mar/                                       (medication administration record entries)
GET/POST   /ipd/nursing-notes/
```

## 10.10 Theatre / Module 8, MCH / Module 9, Mortuary / Module 12
```
POST       /theatre/surgical-cases/
POST       /theatre/anesthesia-records/
POST       /mch/anc-visits/  /mch/pnc-visits/
POST       /mch/immunizations/
POST       /mortuary/intakes/
POST       /mortuary/releases/
```

## 10.11 Billing & Insurance / Modules 10–11
```
GET/POST   /billing/invoices/
POST       /billing/invoices/{id}/payments/
GET        /billing/cost-centers/report/
POST       /claims/pre-authorizations/
POST       /claims/pre-authorizations/{id}/submit-to-sha/
POST       /claims/e-claims/
POST       /claims/e-claims/{id}/submit-to-sha/
GET        /claims/remittances/
```

## 10.12 CCP Program / §7.14
```
POST       /ccp/biopsychosocial-assessments/
POST       /ccp/psychotherapy-sessions/                   (session_type: INDIVIDUAL|FAMILY|GROUP)
POST       /ccp/sud-rehab-plans/
POST       /ccp/sud-rehab-plans/{id}/urine-screens/
POST       /ccp/supervision-requests/
GET/POST   /ccp/team/
GET        /ccp/nacada-ndo-report/?period=
```

## 10.13 System Admin / Module 13
```
GET        /admin/audit-log/
GET/POST   /admin/backup-jobs/
GET        /admin/health/                                   (liveness/readiness detail, internal only)
```

## 10.14 Sync (offline mode, `08-DHA-SHA-INTEGRATION.md` §8.5)
```
POST       /sync/push/         (batched offline-queued writes, idempotency-keyed)
GET        /sync/pull/?since=  (incremental changes since a client-tracked cursor)
```

## 10.15 Conventions

- Auth: `Authorization: Bearer <jwt>`; refresh via httpOnly cookie flow.
- All mutating endpoints require and validate an `Idempotency-Key` header where safe retries matter (payments, SHA submissions, sync push).
- Errors follow a consistent envelope: `{ "error": { "code": "...", "message": "...", "fields": {...} } }`.
- Every endpoint that touches a patient record is wrapped by the audit-logging middleware (`09-SECURITY-COMPLIANCE.md` §9.4) automatically — do not add manual audit calls in views.
