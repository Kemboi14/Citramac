# Data Protection Impact Assessment — CAfRIC Centre (MENTAL_HEALTH_CCP)

Filled in per the template at `13-TESTING-QA-CHECKLIST.md` §13.4, required
for DHA certification lifecycle step 2 (`01-OVERVIEW-AND-STANDARDS.md` §1.4,
`09-SECURITY-COMPLIANCE.md` §9.5). Scoped to CAfRIC Centre as the reference
`MENTAL_HEALTH_CCP` tenant — re-run this assessment for any other facility
type before its go-live, per the review-cadence trigger in §6 below.

**Status: draft for Org Admin + Data Protection Officer sign-off.** This
document describes the system as implemented at the time of writing; it is
not itself the sign-off.

## 1. Description of processing

| Data category | Collected | Why | By whom | Retained |
|---|---|---|---|---|
| Demographics (name, DOB, gender, national ID, contact, address) | Registration (Module 1, `apps.client_registry.Patient`) | Identify the patient, enable care coordination, required for DHA-facing records | Front-desk/records staff | Statutory clinical-record minimum (`settings.CLINICAL_RECORD_MINIMUM_RETENTION_YEARS`, default 7y) from last encounter; anonymized (not deleted) on an approved Right-to-Erasure request thereafter |
| Vitals, MSE, SOAP notes, diagnoses (ICD-11-coded) | Clinical encounter (Modules 2–3) | Direct clinical care | Doctors/Nurses | Same as above |
| Biopsychosocial assessment, psychotherapy session notes, SUD rehab plan, urine drug screen results | CCP program (§7.14) | Direct mental-health/SUD treatment — this is the most sensitive category the system holds | Assigned care team only (see §4) | Same as above |
| Lab orders/results, prescriptions/dispensing | LIMS/Pharmacy (Modules 4, 6) | Direct clinical care | Lab techs, pharmacists, ordering clinicians | Same as above |
| Billing/insurance (invoices, SHA coverage, pre-auths, claims) | Billing/Insurance (Modules 10–11) | Payment, statutory SHA reporting | Cashiers, insurance staff | Financial-record retention (separate from clinical; not yet independently configured — see §5 residual risk) |
| Consent records (`ConsentRecord`) | Explicit capture (§9.5) | Legal basis for national HIE data sharing | Records staff, at registration/any time | Indefinite (the consent *history* itself, including revocations, is the audit trail — never deleted) |
| Audit trail (`AuditLogEntry`) | Automatic, every create/update/delete/view of the above | DHA/DPA "who accessed my file" accountability (§9.4) | System (no direct staff authorship) | Indefinite (append-only) |

Not yet collected in this build: HL7 FHIR resources are constructed
on-demand for E-Referral transmission (§8.1) and cached in
`FhirResourceCache`, not stored as a separate long-lived record store.

## 2. Necessity & proportionality

Each field above traces to a specific clinical, administrative, or legal
need already itemized in column 3 of the table. Fields scrutinized and
their justification:

- **National ID / passport number**: required for IPRS/SHA member
  verification (stubbed pending Phase 6+ live credentials) and DHA
  identity assurance — not collected for any secondary purpose.
- **Psychiatric/SUD content** (`BiopsychosocialAssessment`,
  `PsychotherapySession`, `SudRehabPlan`, `UrineDrugScreen`): the
  system's single most sensitive category. Necessity is direct — this
  *is* the clinical record for a mental-health/SUD facility — but
  proportionality is enforced structurally, not just by policy: these four
  models are the only ones gated by the elevated `CareTeamMembership` tier
  (§7.14.7, §9.3), on top of (not instead of) ordinary role-based access.
  A user without a care-team relationship to the patient sees only that an
  active episode exists, never content.
- **NACADA NDO Report** (`apps.ccp_program.NacadaNdoReport`): aggregates
  counts (rehab plans by phase, screens conducted) for a statutory report,
  not row-level patient data — re-identification risk in this aggregate is
  low given typical facility caseload sizes, but has not been formally
  k-anonymity-tested; flagged as a residual risk (§5) if CAfRIC's monthly
  cohort ever becomes small enough that phase-level counts could identify
  an individual.

## 3. Risk identification

1. **Unauthorized access to psychiatric/SUD content** by staff without a
   clinical need — the highest-impact risk given the stigma and legal
   sensitivity of this data category.
2. **Cross-tenant data leakage** — CAfRIC's data becoming visible to, or
   modifiable by, another Organization on the shared platform.
3. **Data loss** — clinical records destroyed or corrupted with no
   recoverable backup.
4. **Re-identification risk in aggregate reporting** — the NACADA NDO
   Report (see §2).
5. **Insider misuse** — a legitimately-authorized user (e.g. an assigned
   therapist) viewing or exporting records outside their genuine care
   responsibilities, or an Org Admin using their compliance-oversight
   access as a backdoor for casual browsing.
6. **Irrecoverable/incomplete erasure** — an erasure request either
   silently failing to remove identifying data, or wrongly proceeding
   against a record still under statutory retention.
7. **Consent state ambiguity** — no verifiable record of what a patient
   actually agreed to, or when, if the consent text changes over time.
8. **Audit trail tampering or the trail itself leaking the data it's
   meant to protect** (e.g. an "erasure" audit entry that still contains
   the erased PII).

## 4. Mitigations mapped to risks

| Risk | Mitigation | Where |
|---|---|---|
| 1. Unauthorized access to psychiatric/SUD content | `CareTeamRestrictedMixin` + `has_full_ccp_access()` gate `BiopsychosocialAssessment`, `PsychotherapySession`, `SudRehabPlan`, `UrineDrugScreen` beyond ordinary role checks; restricted serializers return existence-only fields to non-care-team staff | `apps/ccp_program/views.py`, `permissions.py` |
| 1. (view accountability) | Every full-content view of the four models above writes an explicit `AuditLogEntry` (`ACTION_VIEW`), not just edits | `apps/sysadmin_audit/audit.py`, `CareTeamRestrictedMixin._serializer_for` |
| 2. Cross-tenant leakage | Three-layer isolation: `TenantScopedManager` (app layer) + Postgres RLS with `FORCE ROW LEVEL SECURITY` (DB layer, survives a raw-SQL bug or a compromised app credential) + namespaced object storage paths | `apps/tenancy/managers.py`, `apps/tenancy/rls.py`, every app's `NNNN_rls.py` migration |
| 3. Data loss | Documented, **drill-tested** backup/restore runbook using a dedicated `BYPASSRLS` role (a real gap the first drill attempt caught and fixed — see the drill log) | `backend/scripts/README.md` |
| 4. NDO Report re-identification | Aggregated counts only, no row-level export; flagged as residual risk pending formal small-cohort review | `apps/ccp_program/views.py` (`NacadaNdoReportViewSet.perform_create`) |
| 5. Insider misuse | RBAC enforced at the API layer (DRF permission checks) *and* mirrored at the DB layer (RLS), never frontend-only; Org Admin's elevated CCP access is itself logged like any other full-content view (risk 1's mitigation applies equally to Org Admins) | Same as risk 1 |
| 6. Erasure correctness | `ErasureRequest` workflow requires Org Admin **and** compliance-officer (Auditor role) sign-off before `execute_erasure()` runs; a statutory-retention check (`check_retention_conflict`) blocks execution and surfaces the conflict rather than silently proceeding or silently refusing, with an explicit, role-gated override path | `apps/client_registry/erasure.py`, `views.py` |
| 6. (audit correctness) | Erasure anonymizes via `.update()`, not `.save()`, specifically so the generic write-audit signal never fires and never records the pre-erasure PII in `field_diff`; a dedicated `ACTION_ERASURE` entry records *which fields* were erased, never their prior values — verified by a dedicated regression test | `apps/client_registry/erasure.py`, `apps/client_registry/tests.py::test_execute_anonymizes_patient_without_leaking_pii_into_generic_audit_diff` |
| 7. Consent ambiguity | `ConsentRecord` is an append-only history (grant *and* revoke both write new rows, exact `consent_text_version`/`consent_text_snapshot` captured at the time), not a single mutable boolean; `Patient.consent_data_sharing` remains only as a denormalized "current state" convenience cache | `apps/client_registry/consent.py`, `models.py` |
| 8. Audit trail integrity | Append-only at the application layer (`AppendOnlyQuerySet` blocks `.update()`/`.delete()` via the ORM) | `apps/sysadmin_audit/models.py` |

## 5. Residual risk assessment & sign-off

Residual risks not fully closed by the mitigations above, in order of
priority:

1. **Audit trail is application-layer append-only, not DB-role
   append-only.** A compromised application DB credential could still
   issue a raw `UPDATE`/`DELETE` against `sysadmin_audit_auditlogentry`
   directly. True tamper-evidence (a DB role without `UPDATE`/`DELETE`
   grants on that table, or hash-chained entries) is a documented,
   not-yet-built hardening item.
2. **Financial-record retention** is not independently configured from
   clinical-record retention (§1) — both currently key off the same
   `CLINICAL_RECORD_MINIMUM_RETENTION_YEARS` setting via the erasure
   workflow's conflict check, which is a simplification, not a deliberate
   financial-compliance decision.
3. **NACADA NDO Report small-cohort re-identification** (§2, §3.4) has not
   been formally tested against CAfRIC's actual monthly volumes.
4. **No automated continuous point-in-time-recovery** — the backup drill
   (§4) exercises the mechanism against a single manual snapshot; WAL-based
   continuous backup is a Phase 8 (managed Postgres) item.
5. **No HSM/KMS-backed signing key** for SHA gateway payloads yet — a
   local PEM file path (`SHA_GATEWAY_SIGNING_KEY_PATH`) stands in until a
   real facility certificate is provisioned (docs/08 §8.4).

**Sign-off required from:** CAfRIC's Org Admin (accepts residual risk on
behalf of the facility) **and** a named Data Protection Officer/compliance
lead (accepts risk 1 and 3 specifically, given their direct bearing on
patient-identifiable psychiatric/SUD data). *Signatures/dates to be
recorded here once reviewed — not yet obtained as of this draft.*

## 6. Review cadence

Re-assess this DPIA on any of:

- A material change to `Organization.enabled_modules` for CAfRIC (a newly
  enabled module processing a new data category).
- A new data-flow to a sub-processor (e.g. an SMS/email vendor, a new
  cloud storage provider for attachments).
- The SHA/HIE integrations moving out of stub mode (`SHA_GATEWAY_MODE`
  leaving `"stub"`, or `HIE_ENDPOINT_URL` being set) — real data leaving
  the system to a third party materially changes the risk picture assessed
  here.
- At minimum, annually.
