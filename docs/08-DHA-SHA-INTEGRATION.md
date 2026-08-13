# 08 — DHA & SHA Technical Integration

## 8.1 HL7 FHIR interoperability layer

- Stand up a dedicated `dha_interop` Django app exposing/consuming FHIR R4 resources: `Patient`, `Encounter`, `Condition`, `Observation`, `MedicationRequest`, `DiagnosticReport`, `Composition` (for referral summaries).
- Use a FHIR library (e.g. `fhir.resources` for Python models + custom serializers) to convert internal ORM models to/from FHIR JSON — do not hand-roll FHIR JSON without schema validation.
- Every **E-Referral** (`07-CLINICAL-MODULES-SPEC.md` §7.3) builds a FHIR `Bundle` (Composition + Patient + Condition + MedicationRequest + DiagnosticReport references) and transmits it to the National Health Information Exchange (HIE) endpoint over mutual-TLS.
- Cache inbound/outbound FHIR resources in `FhirResourceCache` (`06-DATA-MODEL.md` §6.6) for offline resilience and audit.

## 8.2 Terminology services

| Standard | Applies to | Implementation |
|---|---|---|
| **ICD-11** | Diagnoses (Module 3) | Mirror WHO ICD-11 API into `IcdCodeIndex` (nightly sync job), expose fast local search endpoint `/api/v1/terminology/icd11/search/`; diagnosis field is a required, validated FK — no free-text diagnosis without a code. |
| **LOINC** | Lab orders/results (Module 4) | Mirror LOINC subset into `LoincCodeIndex`; every `LabOrder`/`LabResult` requires a LOINC code. |
| **National Drug Index** | Prescriptions/Pharmacy (Modules 3, 6) | Mirror the national drug registry into `NationalDrugIndex`; `Prescription`/`DrugStockItem` reference it, not free text. |

Build a generic `TerminologySyncJob` Celery task pattern reused for all three mirrors, each configurable with its own source endpoint and refresh cadence.

## 8.3 SHA API integration (the core compliance deliverable)

Build a dedicated `sha_gateway` service module inside `insurance_claims` handling all three touchpoints described in `01-OVERVIEW-AND-STANDARDS.md` §1.3. **All calls are logged to `ShaTransactionLog`** with request payload, response, status, and retry count for audit and troubleshooting — SHA transactions are financial + medical, so nothing is fire-and-forget.

### 8.3.1 Real-time member verification
- Trigger point: Module 1 registration / Module 10 billing pre-check.
- Input: National ID / Passport / UPI.
- `POST` to SHA member-verification endpoint (mutual TLS + API key/cert per facility, stored encrypted — see `09-SECURITY-COMPLIANCE.md`).
- Response cached on `InsuranceCoverage` (member status, premium compliance, dependents) with a short TTL — re-verify at each new encounter, not just once.

### 8.3.2 Digital pre-authorization
- Trigger point: Module 3/8 when a clinician orders a specialized surgery, oncology treatment, or complex imaging.
- Clinician compiles clinical notes + diagnostic evidence in-app → system builds a pre-auth packet → digitally signs (facility's PKI certificate — see §8.4) → submits to SHA Pre-Authorization endpoint.
- Poll/webhook for approval/feedback; surface status directly in the clinician's workspace as a badge/notification (uses the same amber/green/red status token language from `03-DESIGN-SYSTEM.md`).

### 8.3.3 Direct e-claims
- Trigger point: patient discharge (Module 7 discharge planning) or outpatient encounter close.
- Auto-compile the full encounter payload: ICD-11 diagnoses, treatment plan, surgical reports (if any), pharmacy dispenses, invoice line items.
- Package as a signed JSON payload, transmit to the **SHA Claims Gateway** — this replaces the discontinued manual web-portal upload entirely, per the August 2026 directive. There is no manual-entry fallback UI in production; sandbox/dev mode may allow a manual "replay claim" debug action for developers only.
- Handle async responses: `SUBMITTED → UNDER_REVIEW → APPROVED/PARTIALLY_APPROVED/REJECTED`, reconciled against `Remittance` records (Module 11).

### 8.3.4 IPRS / Client Registry / Facility & Practitioner Registry checks
- Before any automated claim submission, validate the patient against the central **Client Registry** (national ID verification) and confirm the **Facility Registry**/**Practitioner Registry** entries for the submitting facility/clinician are current — cache these checks but re-validate periodically (e.g. daily) since practitioner licensing can lapse.

## 8.4 Signing & trust

- Facilities hold a digital certificate (issued through DHA/SHA onboarding) used to sign pre-auth and e-claims payloads (e.g., JWS/detached signature over the JSON body).
- Store private keys in a secrets manager / HSM-backed KMS — never in the application database or source control. Rotate per DHA/SHA policy.

## 8.5 Offline mode & sync (DHA requirement)

- Frontend uses a local-first data layer (IndexedDB via a sync library, or a service-worker-backed queue) for core clinical entry screens (Triage, SOAP notes, Prescriptions) so clinicians can keep working through a connectivity drop.
- Backend exposes idempotent, timestamp/version-aware sync endpoints (`/api/v1/sync/push/`, `/api/v1/sync/pull/`) using a last-write-wins-with-conflict-log strategy; conflicts are surfaced to an Org Admin/records officer for manual resolution rather than silently overwritten.
- SHA/FHIR outbound calls are queued (Celery + Redis, with retry/backoff) so they auto-flush once connectivity returns — never blocking the clinician's local save.

## 8.6 DHA certification demo readiness

Keep a `/sandbox` environment seeded with demo organizations/patients so the following can be demonstrated live to DHA evaluators without touching production data:
- FHIR payload exchange (send + receive) against the DHA sandbox.
- ICD-11 code search/assignment in a live encounter.
- BMI/BSA automatic calculation in Triage.
- A full pre-auth → e-claim → remittance cycle against SHA's test gateway.
- The immutable audit log showing every access/edit/delete for a sample patient record.
