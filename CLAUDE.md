# Project standing rules — FHIR R4 conformance

### 1. The contract

FHIR R4, version **4.0.1**, is the data contract for this system. It is not an export format
bolted on at the end; it is the definition of what our clinical data *is*. Where an internal
representation and FHIR disagree, FHIR wins unless I explicitly say otherwise in writing.

Pin 4.0.1 everywhere: in the CapabilityStatement, in the validator, in every client library.
Never mix R4, R4B and R5 artefacts in the same codebase. Treat a version bump as a project,
not a dependency upgrade.

This is a mental health / addiction treatment platform. Clinical safety and confidentiality
outrank delivery speed in every trade-off.

### 2. Conformance is a ladder — we are targeting the top rung

1. JSON that merely looks like FHIR — unacceptable
2. Valid R4 that passes the base schema — necessary, nowhere near sufficient
3. Conforms to a StructureDefinition that fixes cardinality and binds ValueSets
4. Conforms to the published implementation guide, proven by an automated validator run

Only rung 4 counts as done. Base R4 makes almost every element optional, so a nearly empty
resource validates. Assume nothing is enforced until we have profiled it.

### 3. Definition of done for any clinical feature

No clinical feature is complete until all eight hold. Refuse to mark work done otherwise,
and say which item is outstanding.

1. **Named resource** — the feature's output maps to a specific R4 resource, written down
2. **Profile written** — a StructureDefinition states cardinality, bound ValueSets, and any
   extension genuinely needed
3. **Every clinical field coded** — no free text where a code system exists; bound via a
   terminology `$expand`, never a hard-coded list
4. **Subject, performer, time, provenance** — every clinical assertion answers: about whom,
   by whom, when, on whose authority
5. **Validator green in CI** — sample payloads pass the FHIR validator against our profiles
   on every build; a profile violation fails the build
6. **Sensitivity decided** — confidentiality label and consent behaviour agreed before the
   first record is captured
7. **Reversibility checked** — state what a later correction would cost; if it means
   re-authoring signed clinical records, it is P0 and must be fixed now
8. **Examples published** — at least three realistic instances in the repo, including one
   edge case and one refusal or omission

### 4. Mandatory architectural patterns

**EpisodeOfCare is the clinical spine.** Every encounter, observation, note, score and
session hangs off an episode via `Encounter.episodeOfCare`. An episode is an organisational
container only — client, service, start date, coordinator, presenting problems, state — and
carries no clinical content. `statusHistory` is populated on every state change, because the
`waitlist → active` timestamp is the only record of waiting time and is unrecoverable later.
Never treat EpisodeOfCare as a synonym for an inpatient admission; an admission is an
`Encounter` with `class=IMP` that happens *inside* an episode.

**One shared resource store, many views.** Modules are views over the same store, not owners
of private tables. Psychiatry, nursing and psychotherapy all write `Observation`,
`Condition`, `MedicationRequest`. Discipline is expressed as `Encounter.participant` and
`Observation.performer` — never as a duplicate schema. If a clinical concept appears in two
places in the UI (the MSE does), it is one profile and one store.

**Per-subject separation of multi-party sessions.** `Encounter.subject` is 1..1. A group or
family session is n encounters sharing an Appointment, a Group and a facilitator, with each
participant's clinical record standing alone. Never a single shared note. This is a
confidentiality requirement, not a modelling preference: a lawful disclosure about one
participant must not disclose the others' therapy, and it is unfixable after the fact.

**Identifiers are sliced, never overwritten.** `Patient.identifier` repeats. Carry the local
UHID, the national ID, the payer number and the registry identifier side by side, each with
its own `system` URI. Generate a local business identifier before the first network call so
records are addressable and idempotent offline. This is a multi-branch deployment: a local
number cannot reconcile a person across sites.

**Terminology is served, not compiled.** Every clinical drop-down is bound to a ValueSet and
populated from a terminology server, cached. Revising a code set must be a configuration
change, not a release.

**Provenance and audit on everything clinical.** `Provenance` on every assertion,
`AuditEvent` on every access to a psychiatric record. In mental health this is the control
that makes the record safe to keep at all.

**Consent and sensitivity before capture.** `Consent` records what was permitted, to whom,
for what purpose, until when. Security labels allow a psychiatric note to be withheld while
the rest of the record flows. Design this before data exists, never after.

**Fail safely.** Idempotent writes via stable business identifiers plus conditional create.
Parse `OperationOutcome` and surface `issue.expression` to whoever can fix it. A durable
local outbox queue so clinical work never blocks on the network. Explicit, logged degradation
when a dependency is unreachable — never silent success.

### 5. Forbidden without my explicit written approval

- Inventing an extension before searching the base spec, the relevant IGs and the registry
- Repurposing an unrelated element because the one we want is missing
- `modifierExtension` where a plain `extension` is meant
- Storing a coded clinical concept as free text "for now"
- Clinical content on `EpisodeOfCare`, or care-plan content on it
- A second store for the same clinical concept
- Blind retries on timeout without a stable identifier
- `localStorage` or any browser storage for clinical data
- A new resource type for a concept FHIR has no analogue for — keep it local and document why
  (clinical supervision is the known example: it is workforce management, not patient data)

### 6. Verification discipline — this one is absolute

Do not invent, guess or reconstruct from memory any of the following. If you need one and do
not have it from a source in this repository or one I have given you, stop and mark it
`VERIFY:` with what you need and where to get it.

- LOINC, SNOMED CT, ICD-11 or ICD-10 codes
- Canonical URLs for profiles, extensions, ValueSets or CodeSystems
- Identifier `system` URIs
- Implementation-guide version numbers or publication status
- National programme endpoints, payload requirements, tariff or fund codes
- Statutory citations, Act numbers or regulatory deadlines

A plausible-looking wrong code is worse than a blocked task: it validates, ships, and fails
silently in a clinical setting. Never pad a gap with something that looks right.

### 7. How to work with me

- Challenge a design that violates these rules, even mid-task. Say which rule and why.
- If a request cannot be done conformantly, say so and propose the conformant alternative
  rather than shipping rung-2 work quietly.
- Before implementing any clinical feature, state the resource mapping and wait for my
  confirmation. One line is enough: resource, profile, terminology binding, where it hangs.
- Flag reversibility explicitly. "This is cheap to change later" and "this requires
  re-authoring signed records" are the two answers I need to hear.
- Prefer adopting a published implementation guide over authoring our own profile. Tell me
  which guide and which part of it.
- No partial implementations, no `// TODO` placeholders, no scaffolding I did not ask for.

### 8. Reference sources

Resolve every specification detail against the publisher, not against recall:

- FHIR R4 base spec — `hl7.org/fhir/R4/`
- RESTful API — `hl7.org/fhir/R4/http.html`
- Search — `hl7.org/fhir/R4/search.html`
- Bundles and transactions — `hl7.org/fhir/R4/bundle.html`
- Profiling and conformance — `hl7.org/fhir/R4/profiling.html`
- Terminology module — `hl7.org/fhir/R4/terminology-module.html`
- Structured Data Capture (assessments) — `hl7.org/fhir/uv/sdc/`
- Data Segmentation for Privacy (sensitivity) — `hl7.org/fhir/uv/security-label-ds4p/`
- International Patient Summary — `hl7.org/fhir/uv/ips/`
- SMART App Launch (auth) — `hl7.org/fhir/smart-app-launch/`
- Terminology browsers — `icd.who.int/browse11`, `browser.ihtsdotools.org`, `loinc.org`
- The national implementation guide supplied by the regulator — the only binding source here

Canonical URLs and version numbers change between ballots. Confirm before citing.

## Amendments

### 2026-09-18 — documented exception to §1: `fhir.resources.R4B` for construction

§1 says: "Never mix R4, R4B and R5 artefacts in the same codebase." At the time this file was
written, `apps/dha_interop/fhir_mapper.py` already constructed every FHIR resource via
`fhir.resources.R4B` — a real, pre-existing violation, not a new one introduced here.

Verified (not assumed) before resolving this: no maintained release of the `fhir.resources`
library has a true-R4-4.0.1 default namespace to switch to. Its default namespace is R4B as
of 6.2.x+ and R5 as of 7.x+; only `fhir.resources<=5.1.1` (a ~5-year-old release, `Release:
R4, Version: 4.0.1`) still defaults to real R4, and no version at or after 6.2 ships an `R4`
subpackage at all — R4B/R5/STU3/DSTU2 are the only namespaces available in anything current.

Resolution, chosen by the project owner over the alternative of downgrading the dependency:

- `fhir_mapper.py` keeps constructing resources via `fhir.resources.R4B` — the only
  maintained option — for the resource types/fields it actually populates (Patient,
  Condition, MedicationRequest, Observation, Composition, Encounter, Consent,
  RiskAssessment, Bundle/BundleEntry).
- The pinned contract itself is unchanged: **R4 4.0.1**, not R4B. Conformance is verified
  independently of the construction library by `apps/dha_interop/fhir_validation/`, which
  checks the constructed JSON against HL7's own vendored R4 4.0.1 JSON Schema
  (`fhir_validation/schemas/fhir.schema.json`, provenance in `schemas/SOURCE.md`) — not
  against `fhir.resources`' own R4B schema. That schema's `additionalProperties: false`
  means an R4B-only shape the mapper might someday produce fails this check even though
  `fhir.resources.R4B` itself would happily construct it.
- This check is wired into CI as a named, non-skippable step ("FHIR R4 4.0.1 conformance
  validator") in `.github/workflows/ci.yml`, backed by
  `apps/dha_interop/tests.py::FhirR4ConformanceTests`.
- Scope of this pass was CI validator gate only (rung 2 — base R4 4.0.1 schema validity), not
  the full rung-3/4 build-out (StructureDefinition profiles, ValueSet bindings, a published
  implementation guide) — no real national IG exists yet for this system to conform to. See
  `apps/dha_interop/fhir_validation/validator.py`'s module docstring.

If `fhir_mapper.py` ever needs a field/shape that only exists in R4B and not R4, that is the
trigger to revisit this exception — it will show up as a CI failure, not silently.

### 2026-09-29 — §4 "durable local outbox" vs §5 "no browser storage for clinical data"

These two rules can't both be met by a browser client: the only durable storage a web page
has is browser storage. The offline clinical queue (`frontend/src/lib/offlineQueue.ts`,
Triage vitals and SOAP notes) previously used `localStorage` — a live §5 violation.

Resolution, chosen by the project owner over encrypted IndexedDB (which would have needed a
§5 exception): **§5 wins**. The queue is held in page memory only. It survives a network drop
but not closing or reloading the tab; the browser warns before unload while entries are
pending, the offline banner tells the clinician to keep the tab open, and each entry records
its author so a later sign-in on the same tab can't push someone else's notes. Anything the old
version left in `localStorage` is moved into memory once and the keys are removed.

§4's durable outbox therefore holds on the server side only (e.g. notification deliveries,
`apps/notifications` `NotificationDelivery`), not in the browser. Revisit if a native/desktop
client is ever built, where durable encrypted local storage outside the browser is possible.

### 2026-10-21 — spec documents and mockups removed; strict R4 for incoming designs

On the project owner's instruction, `docs/` (the numbered specification, the master prompt,
the DPIA, the DHA certification readiness notes, the on-call runbook), `mockups/` and
`SPEC-README.md` were deleted. Updated mockups will replace them. Everything removed is still
in git at `f80b45b`; code comments that cite `docs/NN-…` sections can be read with
`git show f80b45b:docs/<file>`. This file is now the only standing specification in the repo.

How new mockups are to be built — this applies the rules above, it does not relax them:

1. "v4", "V4" or any revision label on a mockup is a design version. The data contract is
   and stays **FHIR R4 4.0.1** (§1).
2. Before building any screen from a mockup, state for each piece of clinical data it shows:
   R4 resource, profile (a published IG's where one fits, §7), ValueSet binding, and where it
   hangs off `EpisodeOfCare` — then wait for confirmation (§3, §7).
3. A mockup field with no R4 home is raised, never stored in a repurposed element, an
   invented extension or a private table (§5).
4. A mockup that changes how already-signed records are captured or shown must state its
   reversibility cost (§3 item 7).

The CI conformance step now runs every `FhirR4Conformance*` test in
`apps/dha_interop/tests.py`, `apps/care_pathway/test_fhir_examples.py`,
`apps/care_pathway/test_registration_hie.py` and `apps/sysadmin_audit/tests.py` — including
the published examples for registration, triage, referral, admission, client history,
discharge and AuditEvent. AuditEvent is a read-time view of the append-only
`sysadmin_audit.AuditLogEntry` trail, not a second store.

Open §5 item, awaiting the owner's decision: clinical notes have two stores —
`clinical_encounter.SoapNote` (written by the offline queue and v3 encounter screen) and
`care_pathway.ProgressNote` (v4). Consolidating them means migrating signed notes, so it is a
§3 item 7 question, not a refactor.

### 2026-10-23 — DHA HIE integration; the national IG now exists

Built on the project owner's instruction ("build everything"): one transport for DHA's Health
Information Exchange middleware (`apps/dha_interop/hie_api.py`), serving the registries, SHA
eligibility and e-claims, claim consent, status callbacks and the national Shared Health
Record. Every path, field and enum it uses is from DHA's published specifications, vendored
with hashes in `apps/dha_interop/hie_spec/` (`SOURCE.md` lists what DHA has *not* published —
production URL, remittance endpoints, the eligibility coverage-status vocabulary, the PUID
field — each left as configuration or `VERIFY:`, never guessed). Super Admin holds the
service-account credentials (DHA / SHA Integration, encrypted); every branch is named to the HIE
by its SHA FR code.

What this changes in the rules above:

1. **§8 — the regulator's IG exists.** Kenya Core 1.0.0 (`ke.fhir.core`, R4 4.0.1,
   canonical `https://fhir.dha.go.ke/core`) is vendored at
   `apps/dha_interop/fhir_validation/kenya_core/`. The 2026-09-18 amendment's "no real national
   IG exists yet" no longer holds. The SHR exporter (`apps/dha_interop/shr.py`) conforms to its
   Encounter / EpisodeOfCare / Condition profiles, and CI now runs HL7's official validator
   against them (rung 4) — see `.github/workflows/ci.yml` and `scripts/hl7_validator_gate.py`,
   which accepts exactly one documented defect *in the IG itself* (Condition.code bound to a
   CodeSystem URL). Patient identifier systems for National ID and SHA number now default to
   the Kenya Core slices; a test pins them to the package.
2. **The HIE outbox targets the SHR only.** DHA publishes no endpoint for pushing a Patient or a
   referral document; registration no longer queues a Patient (identity is reconciled by a
   Client Registry lookup the clerk confirms — an added, verified identifier slice), and a
   referral packet is recorded as not transmittable (no destination FR code is captured).
3. **SHA claims are billed against a consented visit.** The old signed-JSON `sha_gateway` /
   `signing` stub and the fabricated `seed_dha_sandbox_demo` cycle were removed. SHA's own
   decisions arrive by status callback (durably stored, de-duplicated, applied after the 2xx)
   or a status refresh; they are never typed in. Other payers have no connection and say so.
4. **Sending to the SHR is P0-irreversible (§3 item 7)** and is gated: an approved SHR consent
   for the visit, the client's explicit YES for general *and* mental-health sharing (and
   substance-use sharing whenever SUD content is involved), R + PSY (+ SUD) labels from DHA's
   catalogue on every resource, and conformance — or nothing is sent. Notes, trauma history,
   risk assessments, group content, legal status and psychotherapy encounters are never sent;
   observations, medications, allergies and referrals are omitted until a national code or
   destination is verified. Each send writes an `HIE_DISCLOSURE` audit entry.

Open items for the owner: confirm the VERIFY list in `hie_spec/SOURCE.md` against UAT (run
`python manage.py dha_uat_probe`); report the Kenya Core Condition binding defect to DHA; raise
with DHA that its public FHIR server reports 4.3.0 (R4B) while Kenya Core is R4; decide whether
referrals should capture a destination FR code; complete Form HMIS 4 certification (Digital
Health (HIM Procedures) Regulations 2025, regs 37–42).

### 2026-10-28 — Triage v5 (the triage developer specification) and the shared finding store

After QA, on the owner's confirmation: new triages use **v5** (`apps/care_pathway/triage_v5.py`,
`frontend/src/modules/care/triage/TriageFormV5.tsx`) — the "Comprehensive Triage & Initial Risk
Screen" specification's sections A–N on the v3 answer keys and value sets, keeping v4's vital signs /
EWS, waiting-area safety, overdose / duty-to-protect / GBV blocks and telephone call-back. Questions
v4 asked twice were removed. Signed v3 and v4 triages stay on the form and rules they were signed
with. The v5 rule set (`RULES_VERSION` "2026-10-28.1"), the coded per-substance "current
concern" list included, was approved for clinical use by the project owner on 2026-10-28.

§4 "one shared store" for findings: `ClinicalFinding` (`apps/care_pathway/findings.py`) holds one
versioned finding per client per domain. A signed v5 triage records it. Intake confirms it — in the
Section 3 risk register for carried risk items (written back when the intake is signed), in the
findings panel for the rest. Every change is a new version; nothing is overwritten. FHIR: each finding
is an `Observation` (local `urn:citramac:codesystem:clinical-finding` codes — VERIFY LOINC/SNOMED CT
before any are emitted), `derivedFrom` the triage QuestionnaireResponse, with `performer` = the source
(client / third party / clinician), and covered by the signature's Provenance. Reversibility: cheap.
The store is additive, and signed triage and intake records are unchanged. Like `ClinicalAlert`, a
finding follows the client and is not branch-scoped.

Rules 2026-10-28.2, approved by the owner the same day after a second QA pass: a critical
measurement (early-warning score at the urgent / emergency threshold, or hypoglycaemia) also
raises "Acute medical concern". An acute medical concern asks for the next step (managed here,
urgent medical review, psychiatric review, refer out) and whether the client arrived with a
referral. FHIR: the referral received is a `ServiceRequest` (requester = the referring facility)
with its note as a `DocumentReference`, and a referral out is a `ServiceRequest` plus a `Task`.
Both hang off the triage `Encounter` and are covered by the signature's `Provenance`. They are
never sent to the SHR. VERIFY: the FR-code identifier system and the referral-note LOINC type.
Until they are confirmed, both are carried as display text. Vital signs record when they were
measured and their source (`VitalSigns.recorded_at`, `.source`). Each section shows the alerts
and tools its answers have started (AUTO-TRIGGER); every raise and clear is a `TriageAutoTrigger`
audit entry. Reversibility: cheap. Everything is additive, and signed triages keep the rules
version they were signed under.

### 2026-10-29 — organisation-approved assessments; psychiatric review on withdrawal

On the project owner's instruction ("do as you recommend") after QA, rules `2026-10-29.1`:

1. **Approved assessments** (`apps/care_pathway/approved_assessments.py`, Org Admin → Clinical
   Assessments). Per organisation, append-only, audited. Approving names the clinical lead and needs
   the attestation. None is approved by default. *Trauma* (spec 6.1): trauma symptoms recommend PCL-5
   only once it is approved. Otherwise the tool shows "Not approved" and cannot be started or scored.
   *Benzodiazepine withdrawal* (spec item 9): the triage row "Sedatives" is now labelled
   "Benzodiazepines / sedatives" (code unchanged). Its withdrawal concern names the approved
   assessment, or says none is approved, and the withdrawal chart suggests only that one. CIWA-Ar can
   be approved for this use only behind an explicit confirmation, and is never the default.
   Configuration, not patient data, so it has no FHIR resource.
2. **Psychiatric review on withdrawal** (spec item 10, `psychiatric_review.py`). Withdrawal from any
   substance (a "withdrawal" concern, withdrawal symptoms, or recently stopped heavy use) at a signed
   v5 triage, or first at a signed intake, raises one review per triage encounter. It is a `CareTask`
   → FHIR `Task`, urgent for RED/ORANGE and routine otherwise. Opening the psychiatry review puts it
   in progress. It is completed only with a coded outcome (`psychiatric-review-outcome`), which goes
   in `Task.output`, with a `Provenance` for who recorded it. Every raise, start and outcome is
   audited. Examples: `fhir_examples/psychiatric-review-*.json`. VERIFY: a SNOMED CT code for the
   review. The Task code stays local until one is confirmed.

Reversibility: cheap. Everything is additive. Signed triages keep the rules version they were signed
under, and no signed record changes.

### 2026-11-02 — temporary record identified: merge, never a second record

From QA (George Langat): when an unidentified or unknown client's identity becomes known, update or
merge the temporary record; never leave a second, disconnected clinical record. Upgrade-in-place and
merge already existed. On the owner's instruction ("continue and deploy everything"), merges are now
safe to make:

1. **Permitted and reasoned.** A merge needs `records.identity.merge` (Front Desk, Records Officer and
   clinical staff by default, because anyone could merge before this; Org Admin always can) and a
   stated reason ("how do you know this is the same person?").
2. **Ledgered and reversible.** `client_registry.PatientMerge` (append-only) records who merged, when,
   why, and every row and identifier the merge moved, with each one's prior state. An Org Admin can
   reverse a merge (`PatientMergeReversal`, reason required). Every row the merge moved goes back;
   rows written on the client after the merge stay. Both actions write `IDENTITY_MERGE` /
   `IDENTITY_UNMERGE` audit entries on both records, mapped to AuditEvent action U.
3. **Signed records move with the merge.** Their content is unchanged; who they are about changes.
   That is the §3 item 7 case, so the ledger is what makes it reversible. Merges made before
   2026-11-02 have no ledger and cannot be reversed automatically.
4. **One record afterwards.** The merged stub is hidden from the registry list. Opening its id opens
   the client. A verified national identifier the client lacks (a Client Registry ID, say) stays
   active on them; everything else from the stub is kept as `use=old`.

FHIR: the stub is `Patient.active=false` with `link` replaced-by, and the client has `link` replaces.
A `Provenance` targets both, with the reason. VERIFY: a coded `Provenance.activity` for a merge;
until one is confirmed it stays text. Example: `dha_interop/fhir_examples/registration-merged-temporary-record.json`.
The ledger is identity administration, not clinical content, so it is not a second clinical store.

### 2026-11-03 — NACADA NDO report: counts only, emailed, MeasureReport

On the owner's decisions of 2026-11-03: the NACADA National Drug Observatory report is compiled per
branch (facility) and period by `apps/mhp_program/nacada_report.py`. NACADA's NDO template has not
been supplied, so the indicators are **facility-defined** from records the system already holds
(episodes, triage substances, admissions, closures, OAT, naloxone, waiting time), and the report says
so wherever it is shown or sent. Each report stores the snapshot and the `definition` it was compiled
with; it is never edited, and replacing the indicators with NACADA's list does not touch stored reports.

1. **Counts only, small numbers withheld.** No names, identifiers or free text. A count of 1–4 is
   stored and shown as "<5"; where a breakdown adds up to its total, the next-smallest row is
   withheld too; a median over 1–4 people is withheld. Suppression happens before the snapshot is
   stored, so nothing more identifying than what is shown can be sent.
2. **Sent by email, not an API.** NACADA publishes no submission endpoint. "Send to NACADA" emails
   the organisation's NACADA reporting address (set by an Org Admin), copying the sender as reply-to;
   "Send to myself" is a test copy. Both go through the `NotificationDelivery` outbox, so whether it
   went is the delivery's status, never assumed. Permission `reports.nacada.send` (Org Admin always),
   confirmation required, every send a `REPORT_SENT` audit entry and an append-only `NacadaReportSend`.
   OAT and naloxone records carry no branch, so those two sections are organisation-wide and labelled.
3. **FHIR.** A summary `MeasureReport`, read-time from the snapshot (`nacada_fhir.py`): `reporter` =
   the branch, one `group` per section, one `stratifier` per breakdown, withheld counts carry the
   `data-absent-reason` extension (`masked`), with a `Provenance` for who compiled it. No patient data,
   so no `EpisodeOfCare` hook. Examples in `mhp_program/fhir_examples/` (routine month, small-numbers
   edge case, no-activity omission) are checked by the CI conformance step. VERIFY with NACADA: the NDO
   indicator codes and any Measure canonical they publish. Until then they are local `urn:citramac:` systems.

Reversibility: cheap. Old-format reports (SudRehabPlan counts, "Mark exported") are kept as they were
and cannot be sent. An email cannot be recalled once it has gone, which is why the send is confirmed.

### 2026-11-03 — roles: platform roles on the platform, organisation roles in each organisation

On the owner's instruction ("platform roles should remain platform, organisational roles on
organisations … clean … up to 100 personnel"):

1. **Two catalogues, never mixed** (`apps/accounts/catalogue.py` "Roles"). Platform-team roles
   (Super Admin, Support Agent, Billing Admin, MFL Verifier, Platform Auditor) are held only by
   platform accounts and carry only platform permissions; Super Admin → Platform Roles & Team shows
   nothing else. Organisation roles are held only by that organisation's staff and carry only
   organisation permissions. Auditor is an organisation role (it had been filed under the platform).
2. **Each organisation owns its roles** (`apps/accounts/roles.py`). A new organisation gets its own
   copy of each standard role; its Org Admin may rename a copy, change its permissions, copy a role
   and add custom ones, and nothing reaches another organisation. The `organization=None` rows are
   only the starting definitions; nobody is given them. Legacy duplicates (Therapist, Supervisor,
   Billing Clerk) are kept only where someone holds them.
3. **Built-in roles are recognised by `Role.system_key`, never by name.** Org Admin and Auditor are
   locked (name and access fixed); their names, and Super Admin's, are reserved, so a custom role
   can't look like an administrator. Roles are retired, never deleted, and only once nobody holds
   one. Permission changes on a role are written to the audit trail.
4. MSE risk alerts go to holders of `clinical.risk_alerts.receive` (was: roles named "Supervisor").

Migration `accounts 0020` moved everyone onto their organisation's copies with identical
permissions and admin status (checked per person before/after); it removed only roles on the wrong
side, which granted nothing. Not clinical data, so no FHIR resource. Reversibility: cheap — the
migration's reverse sends holders back to the shared definitions.

Open for the owner: platform-team roles other than Super Admin still can't open the console (that
needs a scoped cross-tenant read path, a security project of its own); `LEGAL_FORM_CATALOGUE`
`signer_roles` are still role names (empty by default).

### 2026-11-05 — professional profiles, Org Admin setup checklist, NACADA email in Branch Settings

On the owner's decisions of 2026-11-05:

1. **NACADA reporting email** is set in Org Admin → Branch Settings → NACADA reporting (it was
   only on the clinical report page, which Org Admins never reach). Changes to `Organization`
   fields are now audited under that organisation (`sysadmin_audit.audit.write_entry`), so they
   appear in its own audit log; `*_encrypted` fields go into any audit diff only as a short hash.
2. **Organisation setup checklist** (`apps/tenancy/setup_checklist.py`) on the Org Admin
   dashboard: NACADA email, branch registration/licence, SMTP (recommended), the admin's own
   profile, staff profiles awaiting verification or not submitted. One in-app notice at sign-in
   per distinct set of outstanding items.
3. **Professional profiles** (`apps/accounts/practitioner_profile.py`). Staff whose roles need a
   registration (by `Role.system_key`, or any role carrying `clinical.care.record` /
   `clinical.medication.prescribe`) fill in their own: regulator, registration number +
   certificate, current practising licence number/dates + document, qualifications + certificate;
   NACADA accreditation and indemnity cover if held. Everyone needs a mobile number. Submitting
   notifies every Org Admin and holder of the new `staff.credentials.verify` (default: Clinical
   Supervisor), in-app and by email; one of them verifies or returns it with a reason (never their
   own). History is the append-only `PractitionerCredentialReview`; submit/verify/return are
   `CREDENTIAL_*` audit entries; every document download is audited. Existing staff are reminded at
   their next sign-in, and a banner shows until the profile is complete and verified.
4. **Only an expired practising licence blocks signing** (`require_current_licence`, at every
   clinical signing point). An incomplete or unverified profile never blocks. Daily reminders at
   `PRACTITIONER_LICENCE_REMINDER_DAYS` (60/30/7/0) and once expired, for the licence, NACADA
   accreditation and indemnity, to the person and the reviewers.
5. **New standard roles** Clinical Officer (starts with Doctor's permissions) and Counsellor
   (Clinical Psychologist's), copied into every organisation by `accounts 0022`.

FHIR: workforce data, not patient data — `Practitioner.qualification` / `PractitionerRole.code`,
not emitted yet, no `EpisodeOfCare` hook. Reversibility: cheap. Everything is additive and no
signed record changes; the signing block only affects future signatures.

VERIFY (owner, before go-live): the regulator for each role (`ROLE_REGULATOR`) — especially the
radiologist and the Counsellors and Psychologists Board; whether each regulator issues a separate
practising licence; each regulator's identifier `system` URI; whether NACADA accreditation should
be required for any role (it is optional today).

### 2026-11-05 — appointment messages by SMS / email; clinical dashboard

On the owner's decisions of 2026-11-05 (mapping confirmed before building, §7):

1. **Consent first.** Two new consent types, `APPOINTMENT_SMS` and `APPOINTMENT_EMAIL`, in the
   existing append-only `ConsentRecord` store (FHIR `Consent` on the Patient — about contact, not
   care, so not on `EpisodeOfCare`). Recorded at registration or on the client's Legal & consent
   view, each against the facility's own `APPOINTMENT_MESSAGES` wording (Org Admin → Consent
   wording; the system never writes consent text). Only an explicit YES sends on a channel; no
   wording means nothing can be recorded and nothing is sent. VERIFY: a coded Consent category.
2. **What is sent** (`apps/client_registry/appointment_messages.py`): when booked, when moved, and
   the reminder `APPOINTMENT_REMINDER_HOURS_BEFORE` ahead (not sent if the booking message for that
   time went inside the window). Not on cancellation. **Discreet**: organisation, branch, date and
   time only — never type, clinician, service or anything clinical. A branch with SMS reminders
   off sends no SMS.
3. **Through the outbox.** Every message is a `NotificationDelivery` (dedupe key
   `appointment:<id>:<kind>:<time>`), so its outcome is recorded and shown on the appointment and
   the dashboard — the old reminder sent directly and marked itself sent whatever happened (§4
   "never silent success"). FHIR: a `Communication` per message (not emitted yet).
4. **Behaviour change:** existing clients get no reminders until their answer is recorded.

Clinical dashboard: the triage card uses the same rows as the triage queue
(`shared/TriageWorklistRow.tsx`) with priority, overdue, re-check detail and due time, plus the
true overdue count; My tasks is collapsed with paging (10 a page); today's appointments with what
was sent; recent activity paged; the static pathway strip is collapsible. Reversibility: cheap —
additive, no signed record changes.

### 2026-11-05 — one professional greyscale document layout; Preview and Download PDF

On the owner's decisions of 2026-11-05: every printable document uses one server-rendered layout
(`apps/documents/printing.py`, templates under `apps/documents/templates/documents/print/`):
greyscale A4, letterhead with the organisation's logo converted to greyscale, the branch's
contacts and registration numbers (KMPDC, facility licence, SHA facility code), a title and
reference block, consistent sections, a signature block, and on every page the document
reference, "Confidential" and "Page x of y". The same HTML is the on-screen Preview and, through
WeasyPrint (`weasyprint==70.0`; Pango + fonts in the image and CI), the downloaded PDF
(`?output=pdf`). Rendering never fetches anything remote — the logo is read from our own media
and embedded; the PDF engine accepts only `data:` URLs. Previews are served with a no-script CSP.
Every preview and download is audited.

Covered: the catalogue documents (`documents/generated/<id>/print/`, including every referral
letter), the statutory legal forms (`care/legal/documents/<id>/print/`), the invoice and statement
(`claims/clients/<id>/billing/{invoice,statement}/print/`), the signed discharge summary
(`care/discharges/<id>/print/`), the signed triage assessment (`care/assessments/<id>/print/`,
question wording in `care_pathway/triage_print_items.py`, generated from the signed-triage page's
table), the breach notices and register (landscape), the record copy for an access request
(`compliance/subject-requests/<id>/print/` — downloading the PDF releases the copy: EXPORT entry,
request fulfilled; a preview is only a VIEW), the staff list (Org Admin only, landscape) and the
NACADA NDO report. Not covered: the v3 encounter screen's `ReferralPacket`, which holds only a
destination and FHIR data.

FHIR / HIE: layout is ours — neither FHIR nor the HIE specifies how a document looks. What the
PDF enables: Kenya Core's DocumentReference example carries `application/pdf`, and SHA claim
attachments are PDF files. Attaching the PDF to a `DocumentReference` (type code VERIFY) and to SHA
claims is a later step, not done here. A signed document reprints from its frozen content; the
letterhead's logo and registration numbers come from the current organisation and branch.
Reversibility: cheap — presentation only, no record changes.
