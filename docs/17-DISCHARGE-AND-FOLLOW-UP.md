# 17 — Discharge planning, Follow-up, Referrals and the Audit log

Built 2026-10-08 with the grouped clinical sidebar (docs/15 §1.1). Conformance contract:
CLAUDE.md (FHIR R4 4.0.1). Mappings below were stated in the approved plan; the owner's decisions
are recorded at the end.

## 1. Discharge planning

### Resource mapping (CLAUDE.md §3 item 1)

| Concept | FHIR R4 | Local model |
|---|---|---|
| Signed discharge summary | `Composition` in a `document` `Bundle` | `care_pathway.DischargeSummary` |
| The inpatient stay | `Encounter` (class IMP), `hospitalization.dischargeDisposition`, `period.end` | `ipd_ward.Admission` + `clinical_encounter.Encounter` |
| Discharge diagnoses | `Condition` (ICD-11, from the encounter's coded diagnoses) | `clinical_encounter.DiagnosisCode` |
| Medication reconciliation | `MedicationRequest` (`status` active or stopped, `category` = action) | `care_pathway.DischargeMedicationLine` |
| Who signed, when, in what role | `Composition.author`, `Composition.attester` (mode legal), `Provenance` (`agent.role`) | `signed_by`, `signed_at`, `signed_role` |
| A correction | a new `Composition` that `relatesTo` (replaces) the earlier one | `supersedes` |

It hangs off the admission's Encounter inside the client's `EpisodeOfCare`. **Nothing clinical is
put on the episode.** Discharge does not finish the episode: outpatient follow-up normally continues
inside it, and closing the episode is a separate explicit step (owner to confirm this policy).

Builder: `care_pathway/fhir.py::build_discharge_bundle`; endpoint
`GET /care/discharges/<id>/fhir/` (signed summaries only). Constructed with `fhir.resources.R4B`
under the 2026-09-18 amendment and validated against the vendored R4 4.0.1 schema.

### Behaviour

- **Draft** is saved on the server (`PUT /care/admissions/<id>/discharge/`), never in the browser.
- **Sign** (`POST .../discharge/sign/`) is one transaction: the summary is signed, the admission is
  marked discharged, the bed freed, the admission encounter closed, a "Discharge" charge recorded
  (priced from the facility tariff, unpriced if no rate), and any requested follow-up booked.
  If the follow-up cannot be booked the whole discharge rolls back and nothing is half-done.
- **Refusals**: a second discharge of the same admission is a 409 and changes nothing; missing
  disposition / clinical status / treatment summary is a 400; an involuntary admission needs
  `legal_status_at_discharge` (what became of the order); diagnoses must be ones recorded on this
  admission's encounter; every code must come from the served value sets.
- **Reversibility (CLAUDE.md §3 item 7)**: a signed summary is immutable
  (`SignedRecordMixin`, medication lines frozen with it). Correcting it costs one new version; the
  original stays recoverable. This replaces the old behaviour, where the discharge summary was free
  text on the admission that could be overwritten by a repeat discharge or a PATCH (a P0 under that
  rule). The old `discharge_summary` / `follow_up_date` columns are now read-only and shown as
  "Legacy summary (unsigned)"; no data was migrated. The old discharge endpoint is retired.
- **Sensitivity (CLAUDE.md §3 item 6)**: psychiatric and confidential. Full content is returned and
  accepted only for the client's care team, the admitting consultant, an Org Admin, or whoever wrote
  or signed the summary (`care_pathway.services.can_view_discharge_in_full`, built on
  `mhp_program.permissions.has_full_mhp_access`). Everyone else gets a restricted view with the
  narrative, diagnoses and medicines omitted, and a 403 on write and on the FHIR export. Every full
  read is audit-logged. The client timeline shows only the disposition, never the narrative.
- Signed summaries are in the subject-access export (record and FHIR bundle) and in the retention
  registry (mental-health retention class).

### Terminology (CLAUDE.md §3 item 3)

Served value sets, seeded by migration 0008, edited in the database not in code. Local codes under
`urn:citramac:codesystem:<value set id>`:

- `discharge-disposition`: HOME, TRANSFER, AMA, ABSCONDED, DECEASED
- `discharge-medication-action`: CONTINUE, STOP, CHANGE, NEW
- `discharge-education`: the mockup's four patient-education items
- `follow-up-reason`: POST_DISCHARGE, MEDICATION_REVIEW, THERAPY, AFTERCARE, CARE_PLAN_REVIEW,
  OUTREACH, OTHER

The narrative (clinical status, treatment summary, legal status) is free text by nature and is
carried as Composition section text, not as coded data.

### Examples (CLAUDE.md §3 item 8)

`backend/apps/care_pathway/fhir_examples/`, generated from the real builder and validated on every
build by the CI step "FHIR R4 4.0.1 conformance validator": a routine discharge home; an edge case
(involuntary admission, left against medical advice, medicine stopped, legal status recorded); an
amendment (version 2 replaces version 1); and an omission (no diagnosis, medicine or education —
the sections are left out, not padded). The refusal cases (409 on repeat discharge, 400 on missing
fields, 403 outside the care team) are covered in `care_pathway/test_discharge.py`.

### Definition-of-done status — NOT complete (CLAUDE.md §3)

Outstanding, and said plainly rather than marked done:

- **Item 2, profile written** — no StructureDefinition exists. No published implementation guide
  applies; the national IG supplied by the regulator is the binding source.
- **Item 5, validator green against our profiles** — the gate is rung 2 (base R4 4.0.1 schema)
  only; there is no profile to validate against yet.
- Items 1, 3, 4, 6, 7 and 8 are addressed as described above.

### VERIFY (CLAUDE.md §6) — not guessed, not filled

- `VERIFY:` the LOINC document code for the discharge-summary `Composition.type` (loinc.org). It is
  carried as text only. The repo's referral bundle uses 57133-1, which is the *referral note* code
  and must not be reused here.
- `VERIFY:` which national IG / profile applies, and its canonical URLs.
- `VERIFY:` the national discharge-disposition code system; the local codes map to it once supplied.
- `VERIFY:` canonical base URL for local CodeSystems (existing item, docs/15 §4).
- Follow-up is not yet exported in the discharge bundle; see §2.

## 2. Follow-up

Follow-up = an appointment that has a `reason`, or was booked from a discharge or the care plan.

| Concept | FHIR R4 (target) | Local |
|---|---|---|
| Follow-up booking | `Appointment` based on a `ServiceRequest` | `client_registry.Appointment` + new columns |

New columns on `Appointment`: `episode` (the clinical spine), `admission`, `reason` (served
`follow-up-reason` code), `origin` (MANUAL / DISCHARGE / CARE_PLAN), `booked_by`, and
`client_request_id` (unique per organisation, so a retried booking returns the first one instead of
double-booking — CLAUDE.md "fail safely").

`GET /care/follow-ups/?bucket=` returns counts for all four lists and the rows of one:
**upcoming**; **overdue** (scheduled in the past, not checked in); **missed** (no-show, 90 days);
**unbooked** (discharged within 30 days with no live appointment on or after discharge; a death
expects none). `POST /care/follow-ups/` books one, for a client or for a discharged admission.

- `VERIFY:` which R4 element anchors an `Appointment` / `ServiceRequest` to an `EpisodeOfCare`
  (R4 `Appointment` has no `episodeOfCare` element; check hl7.org/fhir/R4/appointment.html and
  servicerequest.html). No extension is invented without that search (CLAUDE.md §5). The local
  store has a real foreign key regardless. Until this is verified, follow-up is **not** exported as
  FHIR and this feature is not marked done against §3.
- Reversibility: cheap. Nullable columns and mutable scheduling data; no signed record.
- Scope: appointments are organisation-scoped (row-level security); they are not further limited by
  branch or care team, as before. The lists show names and dates only, never clinical content.

## 3. Referrals

The two Referral entries follow the approved mockup: **Referral worklist** is the Psychiatric
queue (signed triage referrals in priority order) and **Referral documents** is the Documents
screen, each on its own route (`/clinical/referrals`, `/clinical/referrals/documents`) so the sidebar
highlights one item. No new clinical feature. The outbound e-referral model
(`clinical_encounter.ReferralPacket`, a FHIR document Bundle sent to the national exchange) still
has no screen; it needs its own resource mapping, a link to the client and episode, and owner
confirmation before it is built.

## 4. Audit log

Org Admin side only (`/org-admin/audit-log`, Governance). Allowed: Super Admin, and an Org Admin or
Auditor belonging to an organisation. An Auditor has no portal of its own and lands on this screen.

What was wrong: the endpoint allowed any logged-in user, so any clinician could read the whole
organisation's trail; and each row's `field_diff` stores old and new values of every changed field,
including psychiatric free text (session notes, SOAP, formulation, risk notes) and patient
identifiers, so the trail was a second, unrestricted copy of confidential notes.

Now:

- Authorisation is checked server-side from `user.roles` (`accounts.permissions.IsAuditLogReader`);
  the JWT `role` claim is only the first role of a multi-role user and is used for routing only. A
  user with no organisation is refused so a scoped query cannot match platform-level rows.
- The API returns `changed_fields` (names only) and **never `field_diff` values**.
- Every read of the log writes an audit row (filters and page, no content).
- Filters: action, free text, from / to dates; pages of 25.

### Not done — flagged against CLAUDE.md §4

- No FHIR `AuditEvent` is produced or exported anywhere in the repo. `AuditLogEntry` is a local
  model. Mapping it to `AuditEvent` needs its own profile, terminology binding and security labels
  (all `VERIFY:`).
- `field_diff` is still written with clinical text. Write-time redaction is a separate decision
  (rows already written are append-only and keep their text).
- VIEW logging covers only a few record reads (`log_view` is called in `care_pathway` triage,
  assessment, banner and intake, and the MHP restricted serializers); most reads of psychiatric
  records leave no trace. Discharge reads are logged.
- The audit table has no hash chain; the table owner could still truncate it
  (docs/09-SECURITY-COMPLIANCE.md §9.4).
- A multi-role Auditor may be routed by whichever role the token carries first; a `roles` claim is a
  separate authentication change.

## 5. Owner decisions recorded 2026-10-08

- Audit log: Org Admin and Auditor, Org Admin side only.
- NACADA report under Reports & analytics; Supervision requests under Clinical.
- Referrals follow the mockup.
- Screenshot badges and labels not built (not in the mockup).
- Still to confirm: that discharge leaves the episode open; the proposed local concept lists above.
