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

### 2026-11-05 — one professional document layout; Preview and Download PDF

On the owner's decisions of 2026-11-05: every printable document uses one server-rendered layout
(`apps/documents/printing.py`, templates under `apps/documents/templates/documents/print/`):
A4, letterhead with the organisation's logo, the branch's
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

### 2026-11-05 — clinical dashboard: "My work" is the clinician's own

On the owner's decisions of 2026-11-05: the dashboard opens with **My work** — only what is the
signed-in clinician's — and below it, clearly labelled, **Shared with the branch**.

- **My clients** = the caseload (`client_registry.views.caseload_patients`: registered doctor,
  care-team membership, or consultant on the current admission) — one definition for the
  caseload page, My tasks and the dashboard.
- **My tasks** (`attention.my_tasks`) = items for my clients, CareTasks assigned to me by name,
  CareTasks given to a team whose role I hold and not yet taken, and decisions waiting on me; each
  says why it is mine, and a task already listed for my client is not repeated. (It used to list
  every client in care, up to 200 in no particular order.)
- **My appointments today** = where I am the clinician (`provider`).
- **RED / ORANGE among my clients** by latest triage priority.
- Branch figures are labelled as shared. **Outpatients in care** = an open episode and not
  admitted (it was "everyone ever registered minus inpatients"), and "new today" counts the same
  group. Cancelled appointments are left out of every list.

Not clinical data capture — no FHIR change. Reversibility: cheap (read-only views).

### 2026-11-06 — one note store; v3 encounter screens retired; HIE/FHIR R4 tightening

On the owner's decisions of 2026-11-06 (mapping for the note copy confirmed before building, §7):

1. **Clinical notes: one store.** This closes the open §5 item from 2026-10-21. Every v3
   `clinical_encounter.SoapNote` is copied once into `care_pathway.ProgressNote` (migration
   `care_pathway 0053`, logic in `soap_archive.py`). The copy keeps the note's patient, encounter,
   episode, author, times and status (signed stays signed, an unsigned note becomes a draft). Its
   text is the Subjective / Objective / Assessment / Plan sections under headings. Its type is
   `SOAP_V3`, an inactive `note-type` code, so it labels these copies but can never be used for a
   new note. `source_soap_note` links each copy to its original. SoapNote rows are a read-only
   archive and are never edited. A correction is an addendum of an ordinary type. ProgressNote is
   branch-scoped by its episode *and* its encounter, so a copy with no episode stays in its
   encounter's branch. R4: DocumentReference (not emitted yet). Reversibility: cheap. The copy
   is additive, and reversing removes only copies that have no addendum.
2. **v3 screens retired.** The Triage & MSE and Clinical Encounter (SOAP) pages are gone, along
   with their encounter endpoints (vitals, MSE, SOAP, orders, prescriptions, referrals) and the
   `offline_sync` push/pull API. Their old routes redirect. The in-memory offline queue from the
   2026-09-29 amendment went with them, because those screens were its only users.
   `offline_sync` rows stay as an archive. Pharmacy prescribes through the same structured
   prescribing module as the client record. Signed v3/v4 triages are unchanged.
3. **Encounter.** Opened through the API only as `OUTPATIENT` (the other types are opened by
   their own workflows), joins the client's open `EpisodeOfCare`, and its subject, type and
   episode never change. `encounter_type` is a coded choice. A diagnosis's encounter and ICD-11
   code are fixed once it is recorded, and `recorded_by` (`Condition.recorder`) is kept.
4. **What leaves the facility.** The SHR shares encounters by allow-list (`SHR_ENCOUNTER_TYPES`
   = triage, intake, psychiatry, inpatient, outpatient), never by deny-list, so psychotherapy and
   untyped encounters stay in the facility. The referral document bundle and its "transmit" path
   were removed (DHA has no destination for them, per 2026-10-23). The admission bundle is the
   Encounter (class IMP, in its episode) plus a RiskAssessment only when a risk was recorded. It
   carries nothing that reveals the legal basis, and no treatment Consent (that is the visit's
   VisitConsent). The substance-use Observation is category `social-history` with a text-only
   code. VERIFY: a LOINC code for it, before any is emitted.
5. **SHR send queue.** The bundle id follows the content, so a corrected diagnosis is a new
   bundle and the same content is not sent twice. A person may resend a FAILED bundle (same id,
   so not a blind retry). Consent is checked again at delivery, so a bundle queued while the HIE
   was down is not sent after the client withdraws (closing the visit is not a withdrawal).
   HIE_DISCLOSURE is audited when the SHR accepts the bundle, not when it is queued. A diagnosis
   with no stated certainty is never sent as "provisional"; it is listed as omitted.
6. **Kenya Core identifier slices** (nationalId, shaNumber, …, read from the vendored package)
   are `use=official`, and only the current one is carried; a superseded one is withheld.
7. **SHA claims are scoped to the visit.** Only the diagnoses on the visit's episode (or, with no
   episode, encounters since it opened) are sent, and a charge from outside the visit is refused
   by name. Each diagnosis send is an HIE_DISCLOSURE (codes only); so is each Client Registry
   lookup (identifier type, never the number).
8. **Entered in error** (R4 `entered-in-error`) is the correction for an encounter or diagnosis
   whose subject or code is fixed: a reason, audited, and an encounter takes its diagnoses with
   it. Not a certainty in `intake-dx-status`. Such records are never shared, billed or counted.
   Task `PENDING` is R4 `in-progress`; a finished episode carries `period.end`.
9. **Every read of the client record is audited.** One VIEW entry per successful GET of a
   `care/clients/<id>/…` URL (route named, never content), plus the inpatient, registry and
   attachment detail/list reads; a free-text search term is recorded as "(search)", never what
   was typed. Every client-record table is classified (mental health, financial, administrative
   or general clinical) and a test fails if a new one is not; encounters, diagnoses, prescriptions,
   admissions and episodes are now mental-health records for retention and audit labelling.
10. **Consent wording is the facility's, looked up by the server.** Registration and the patient
    consent endpoint record each decision against the active Consent wording (Org Admin →
    Consent wording; HIE decisions share the data-sharing wording). Text sent by a browser is
    ignored. With no wording set, no decision is recorded, and registration says so. The
    system-written draft text registration used to send (and store as "shown") is gone.
11. **Removed:** the never-installed radiology / theatre / MCH / mortuary scaffolding; the
    terminology "sync" stub and its nightly tasks (it would load any JSON into the code tables);
    the generic invoice create/edit API (invoices are issued and paid in the billing workspace);
    writes to `mhp/psychotherapy-sessions`, `mhp/sud-rehab-plans` and `mhp/urine-drug-screens`
    (read-only archives now) and the v3 session pages (their routes redirect).
12. **Conformance.** Every published example (all 34) passes HL7's validator in CI, not just
    the SHR ones. Document bundles carry `identifier` (`urn:ietf:rfc:3986` + `urn:uuid:`) and
    `timestamp` (bdl-9/10). Collection entries all have a `urn:uuid:` fullUrl, and their
    references resolve inside the bundle. Consent carries the wording version in `policyRule`
    (ppc-1, text only). A discharge summary names its signer rather than linking a Practitioner
    the bundle doesn't contain.

Still open from this programme, each waiting on an owner decision: nursing shift notes into
ProgressNote (they were never signed: copy as drafts, or as a separate unsigned-final status?);
retiring v3/v4 triage signing (the test fixtures sign v3-shaped triages and need rebuilding on
v5); freezing the free-text legal fields of admissions made before 2026-10-22 (current legacy
inpatients still need review dates kept); and drug coding from Kenya Core (prescribe by
`generic-products-cs` product or `active-components-cs` ingredient; allergies coded by
ingredient, which Kenya Core requires); and the ICD-11 code list, which is still the 16-code
"illustrative stub" seeded by `dha_interop 0002` from memory (§6). Replacing it with an import
from WHO's ICD-11 MMS release, and blocking unverified codes, would stop diagnosis recording and
SHA billing until the import is run. The legacy identifier columns on Patient stay: every
save copies them into PatientIdentifier rows, which are what FHIR reads.

Reversibility: cheap. Everything is additive or removes unused write paths. Entered-in-error and
the consent rule change only future records, and no signed record is changed.

### 2026-11-07 — documents in the organisation's colours

On the owner's instruction ("make documents follow org themes, greyscale is boring"), the
2026-11-05 layout is no longer greyscale. Every printed document takes its accent from the
organisation's own theme (`printing.brand_colours`): the light-mode `primary` / `primary_dark`
in `Organization.theme_overrides`, else its branded-login `primary_color`, else the platform
theme, else the product default. The colour goes on the letterhead rule, facility name, title,
section headings and table-heading tints; body text stays black on white, a pale brand is
darkened for headings until it reads on white (4.5:1), and only validated `#rrggbb` values
reach the stylesheet. The logo is embedded in its own colours. Like the logo, the colour comes
from the current theme, so a signed document reprints in today's colours with its content
unchanged. Reversibility: cheap — presentation only, no record changes.

### 2026-11-09 — professional profiles: many licences and qualifications, every document beside its upload

On the owner's instruction ("every document needed … must be next to a place to upload it; a
practitioner can have many licences and degrees or certs"): practising licences, degrees,
diplomas and certificates are entries of their own (`accounts.PractitionerCredentialItem`), as
many as the person holds, each with its own document. Choosing to add one shows its upload slot
at once (a file picked before saving goes with the entry). The registration certificate, NACADA
certificate and indemnity cover sit next to their own fields; there is no separate documents list.

- A profile needs at least one licence and one qualification, and every entry its document.
- The licence in force is the latest-expiring one from each regulator, so a renewal added as a new
  entry supersedes the old one. Signing is blocked when any regulator's licence in force has
  expired (the 2026-11-05 rule, generalised). Each one is reminded separately.
- Editing an entry or its document clears only that entry's verification and returns the profile
  to draft. Verify stamps every entry. Removing an entry hides it (`removed_at`); the row and file
  are kept, and review snapshots list the entries.
- `PractitionerCredential.qualifications` (the line the Mental Health Act forms print) is written
  from the qualification entries and is no longer editable in the Org Admin credential drawer.

FHIR: each entry is a `Practitioner.qualification` (not emitted yet). Workforce data, no
`EpisodeOfCare` hook. VERIFY items unchanged (regulator identifier systems, no qualification code
system invented). Migration `accounts 0025` copies each profile's single licence and its
qualifications line + certificate into entries, keeping the files and verification. Reversible
(checked forward and back). Reversibility: cheap. No signed record changes, and signed MHA forms
keep the qualifications they were signed with.

### 2026-11-10 — ICD-11 from WHO's release; the stub list retired

On the owner's instruction ("pull the icd 11 and do everything"; "I need accurate repo FHIR, ICD-11"),
this closes the open ICD-11 item from 2026-11-06.

1. **Source.** WHO's ICD-11 MMS **2026-01** simple tabulation, vendored unchanged with its SHA-256
   in `apps/dha_interop/icd11_release/` (provenance and the CC BY-ND 3.0 IGO licence are in
   `SOURCE.md`). Migration `dha_interop 0009` loads it on deploy: 35,664 codes, each stamped with
   its release, chapter and leaf flag. Later releases are loaded with `manage.py import_icd11
   <zip> --release <id> --sha256 <hash>`. A code missing from a later release is retired, never
   deleted. Every import is a `TerminologySyncRun`. The admin view of the index is read-only.
2. **Only WHO codes can be recorded.** A new diagnosis needs a code from the loaded release that is
   not retired and is in chapters 01–25. Chapters V, 26 and X are supplementary or extension codes
   and are never recorded on their own. Search offers only those codes, matches on every word typed,
   and marks codes that have more specific codes below them.
3. **The stub list was wrong.** Five of its 16 codes (6C4B, 6C45, 6A25, 6D10, QA02) meant something
   other than their shown title (table in `SOURCE.md`). Each diagnosis now keeps the display text it
   was recorded with (`DiagnosisCode.icd11_display`, backfilled by `clinical_encounter 0011` before
   the titles changed) and the release it came from. A stub-era diagnosis whose code means something
   else in WHO is flagged (`code_review_reason`), not rewritten. It shows the recorded text marked
   "ICD-11 code under review", without the code. It is not sent to the SHR (listed as omitted),
   billed to SHA, or emitted as a FHIR coding (only `Condition.code.text`). A clinician corrects it
   with entered in error plus a new diagnosis. Reversibility: cheap. No signed text changes. **Not
   reversible:** any wrong code already sent to SHA or the SHR before today. The owner should check
   the SHA and HIE disclosure audit for the five codes.
4. **Examples.** Published examples use WHO leaf codes (6A70.1, 6C40.20) with WHO's titles. CI's
   conformance step now includes `test_icd11.py::FhirR4ConformanceIcd11ExamplesTests`, which fails
   on any example ICD-11 coding that is not a WHO leaf code with WHO's display. HL7's validator still
   passes all 34 examples.

### 2026-11-10 — every triage task has a named assignee

On the owner's instruction ("on triage, every task must have an assignee from drop down"; chosen:
a named person, per task, including the tasks a signature raises):

1. **Section N.** Each ticked action has its own drop-down of the organisation's clinical staff
   (`clinical.care.record` holders who can open the triage's branch, `task_assignees.py`). "Register
   as tasks" needs a person for every ticked action. A team or free text is refused. Each person is
   told in-app (`task_notify`).
2. **Tasks raised by signing** (call-back, PEP / emergency-contraception decision, urgent medical or
   psychiatric review, referral out, duty to protect, psychiatric review on withdrawal) are listed
   before signing (`triage_sign_v4.signing_tasks`, in the evaluation as `signing_tasks`). Each needs
   a named person, or the triage cannot be signed (`missing_keys` `task_assignee_<focus>`). A
   psychiatric review raised by an intake (not a triage) still goes to Psychiatry with no assignee.
3. FHIR: `Task.owner` is the person's name as display text, as before. Nothing else changes.

Reversibility: cheap. Tasks already registered keep their owner text, and no signed triage changes.

### 2026-11-10 — Clinical Report; Operational overview corrected

On the owner's decisions of 2026-11-10 (design and mapping confirmed before building, §7):

1. **Clinical Report** (`apps/care_pathway/clinical_report.py`, Reports & analytics → Clinical Report).
   It covers one branch and a period, opening on last month at the working branch. Sections: new
   episodes (by sex and age), clients triaged (by their latest final priority in the period), the
   top 10 ICD-11 codes by client (WHO titles; ruled-out and entered-in-error not counted; a code
   under review is counted but not named), admissions, discharges, risk alerts (an alert counts for a
   branch when the client had an episode open there when it was raised), psychiatric reviews for
   withdrawal (raised, current status, outcome), waiting time, and episodes closed. It reuses the
   NACADA report's counting and its small-number rule (1–4 → "<5", plus the secondary withholding).
2. **Computed when opened, never stored.** Counts only, with no names, identifiers or free text. It
   is open to clinical staff (`clinical.care.record`) and Org Admin, for their own branches. Every
   screen view, preview, PDF and FHIR read is a VIEW audit entry (`care_pathway.clinicalreport`, with
   the period and output). Preview and Download PDF use the shared document layout.
3. **FHIR.** A summary `MeasureReport`, read-time, on the NACADA mapping (`nacada_fhir`, now taking
   its measure and code systems as parameters): reporter = the branch, one group per section,
   withheld counts carry `data-absent-reason` `masked`, plus a `Provenance`. Local
   `urn:citramac:…clinical-report…` codes. VERIFY with DHA whether a published Measure is expected
   for facility clinical reporting. Examples in `care_pathway/fhir_examples/clinical-report-*.json`
   (routine month, small-numbers edge case, no-activity omission). CI's conformance step runs
   `test_clinical_report.py`, and HL7's validator passes all 37 examples.
4. **Operational overview** (`care/reports/`) shows how things stand now. "Registered clients"
   (everyone ever registered) is now **Clients in care** (an open episode). "Signed triage
   assessments" (all time) is now **Triages signed today**. The priority table counts each client in
   care once, by their latest triage, instead of every triage ever signed.

Reversibility: cheap. Both reports are read-only, nothing is stored, and no signed record changes.

### 2026-11-12 — psychotherapy note: changes across sessions; FHIR document with our own profiles

On the owner's instruction ("do all") after a gap review of the psychotherapy module guidance against
what was built (mapping confirmed before building, §7). The five questions, safety question, risk-language
prompt, therapy-model registry, output sections, goal links and sign-off were already in place.

1. **Changes across sessions (PSY-CHANGE), from recorded data only.**
   - When the session is linked to an outcome score, it is compared with the client's previous score on the
     same instrument, worded by that instrument's own change rule (`instruments.change_text`). The clinician
     decides: improvement, no clear change, deterioration or not relevant (`PsychotherapyNote.change_links`,
     migration `care_pathway 0056`). Until they decide, nothing is added to the note, and the note cannot be
     signed (`CHANGES_UNRESOLVED`).
   - A goal decided in the previous signed note shows that earlier decision beside today's.
   - The previous session's safety answer is named only when today's answer differs. "Not assessed" today
     after a previous "no" adds nothing, so an earlier no-concern statement is never read as today's.
   - Nothing is inferred from the narrative. History lines appear only when the author may read the previous
     note.
2. **FHIR R4 document** (`psychotherapy_fhir.py`, GET `care/psychotherapy-notes/<id>/fhir/`, signed notes
   only, same access as reading the note, a VIEW audit entry marked `output: fhir`).
   - The Bundle holds a Composition (7 coded sections, legal attester, `confidentiality` R), the
     Patient, EpisodeOfCare and Encounter, the safety-screen Observation (Risk & Safety section entry), and a
     Provenance for the signature plus one per amendment (an amended note is `status=amended`).
   - Every resource except Patient carries R + PSY, the codes DHA's SHR label catalogue offers.
   - Correction to the mapping first proposed: R4 `Observation.derivedFrom` cannot point at a Composition, so
     the Composition references the Observation instead.
   - The Composition is never sent to the SHR (2026-10-23).
3. **Profiles.** Kenya Core has no Composition profile, so ours are in `care_pathway/fhir_profiles/`:
   `psychotherapy-note` and `psychotherapy-safety-screen`, plus the CodeSystems / ValueSets they bind
   (`urn:citramac:`).
   - HL7's validator loads them in CI (`-ig apps/care_pathway/fhir_profiles`) and enforces cardinality,
     bindings and invariants (labels, the seven sections once each, the risk entry). It was checked to fail
     a copy with a label or section removed.
   - Three examples (`psychotherapy-note-*.json`: routine, edge with an amendment, safety not assessed) and
     `test_psychotherapy_fhir.py` run in the conformance step. HL7's validator passes all 40 examples.
4. **VERIFY:** the LOINC document type for a psychotherapy note; a LOINC / SNOMED CT code for the session
   safety screen; the DS4P psychotherapy-note sensitivity code; the Encounter.class code for an outpatient
   or virtual session; our canonical base for local profiles.

Reversibility: cheap. Additive. No signed note changes; the export is read-time.

### 2026-11-12 — group programme: programmes, session eligibility, admitted-first list; per-client FHIR

On the owner's decisions of 2026-11-12, after a gap review of the Group Programme Documentation
requirement against `group_programme.py`. One session, a separate entry per client, attendance,
optional observations, risk screening with follow-up tasks, corrections with an audit trail,
configurable categories and utilisation were already in place.

1. **Programme on the episode.**
   - `EpisodeOfCare.programme` → R4 `EpisodeOfCare.type`, one of the organisation's own
     `CareProgramme`s (local `care-programme` codes).
   - Org Admin adds, renames or retires programmes (Group programme → Programmes and session
     eligibility). None is seeded; a client without one is "Not assigned".
   - Clinical staff set it on the client's episode card (PUT `care/clients/<id>/programme/`). It is
     organisational data, not clinical content, and audited like every episode change.
2. **Session eligibility.** A category can be limited to programmes
   (`GroupProgrammeCategory.programmes`). A category with none is open to every client in care.
   Confirming a session refuses a client the category is not open to, and names them.
3. **Client list.** Admitted clients are shown by default; "Include outpatients in care" adds the
   rest of the open episodes. A client with no open episode never appears.
4. **FHIR, per client** (`group_fhir.py`, GET `care/group-programme/entries/<id>/fhir/`, audited
   VIEW with `output: fhir`).
   - The collection Bundle holds the Encounter (profile `group-session-entry`: this client only,
     `appointment` → the session, `episodeOfCare`; finished if present, cancelled otherwise) and the
     attendance Observation (profile `group-session-attendance`: coded attendance, the client's own
     observation as a note).
   - It also holds an Appointment that lists the facilitator only, a Procedure when present, the
     follow-up Task, the risk Flag, and a Provenance for the confirmation plus one per correction.
   - **No Group and no other attendee.** The cohort is never exported in a client's record (§4).
   - Attendance is not mapped to `Appointment.participant.status` (that binding has no verified
     mapping for absent or excused).
   - Three examples (`group-session-*.json`) and `test_group_fhir.py` are in CI's conformance step.
     HL7's validator passes all 43 examples.
   - VERIFY: an Encounter.class code for a group session; LOINC / SNOMED CT codes for the attendance
     observation and the follow-up task.

Reversibility: cheap. Additive (migration `care_pathway 0057`); no signed or confirmed record changes.
An eligibility limit affects only sessions confirmed afterwards.

### 2026-11-12 — psychiatric review requests originate in Psychiatric Nursing

On the owner's instruction, a nurse requests psychiatrist review from the
Psychiatric Nursing module, never from the shared Psychiatry/Pharmacy/Interventions prescribing
panel. The request creates one shared `CareTask` (FHIR R4 `Task`) for an active admission.
The Task hangs off the admission's R4 `Encounter` and `EpisodeOfCare`; its server-generated SBAR
is frozen on the request. The Kenya Core 1.0.0 `kenya-core-task` profile applies. Task.code uses
HL7 R4's `task-code` `fulfill`; the review result comes from the already-served local
`psychiatric-review-outcome` ValueSet and is recorded in `Task.output`.

Only staff with clinical-record and senior-review permissions see requests in “Needs my decision”.
The reviewing psychiatrist starts the Task and completes it with an active served outcome; a bare
status update is refused. The request and its SBAR are facility-internal and are not added to SHR
or SHA payloads. SBAR reads and Task transitions are audited; the audit trail fingerprints, but
does not copy, the SBAR text. The Task carries the configured restricted confidentiality label.
Published examples cover routine request, urgent/in-progress review, and a client-left outcome.

Reversibility: cheap — requests are additive and can be superseded with another request; no signed
clinical record is changed. The SBAR is a point-in-time snapshot and is never regenerated after
the request, so the psychiatrist sees the same handover that was raised.

### 2026-11-12 — client banner: care coordinator, care team, open tasks; banner kept in sync

On the owner's instruction ("do all", after a read of why the banner showed "Unassigned" and went
stale): the banner read only `Patient.doctor` (never set by any screen), the admission consultant and
`EpisodeOfCare.care_manager` (never set), so nearly every client showed "Unassigned"; and it loaded
once, refreshing only after some saves on the same page.

1. **Care coordinator** — R4 `EpisodeOfCare.careManager` on the open episode
   (`EpisodeOfCare.care_manager`), set on the client's episode card by clinical staff
   (`clinical.care.record`) from the organisation's clinical staff for the episode's branch. It opens
   no extra access; it puts the client on the coordinator's caseload ("My clients").
2. **Care team** — R4 `CareTeam.participant` (member, role, period), the episode's
   `EpisodeOfCare.team`, stored as `mhp_program.CareTeamMembership`. A member sees the client's full
   MHP content, so only the Org Admin or a holder of the new `clinical.care_team.assign` (default:
   Clinical Supervisor, `accounts 0027`) adds or ends one, never for themselves. A member is ended
   (`ended_at`, `ended_by`), never deleted (`mhp_program 0010`); only active members open content or
   count for a caseload. Roles are local codes (psychiatrist, doctor / clinical officer, nurse,
   therapist / counsellor, social worker, supervisor). VERIFY: SNOMED CT codes for
   `CareTeam.participant.role`. Not emitted to FHIR yet. Every change is a `CARE_COORDINATOR_SET` /
   `CARE_TEAM_MEMBER_ADDED` / `CARE_TEAM_MEMBER_ENDED` audit event (`care_pathway/care_team.py`).
3. **Banner.** Responsible clinician = the admitting consultant, else the care coordinator, else the
   registered doctor, with which one it is. The team line lists the active care team (else an
   admission's team name). An open-task count (initiated / in progress) is shown. Triage task
   assignees own tasks, not the client, so they are not named as responsible.
4. **Sync.** The banner reloads after any save in the client record, in every banner open for the
   client on the page and in the user's other tabs (`notifyClientChanged`, BroadcastChannel with the
   client id only — nothing stored, §5). Every 30 s while visible, and on focus, the page asks
   `care/clients/<id>/banner/version/` for an opaque fingerprint and reloads when it changes. The
   version route returns no record content and is the one `care/clients/<id>/…` route not written as
   a VIEW (`sysadmin_audit.middleware.NOT_RECORD_READS`); the reload it triggers is audited as usual.

Reversibility: cheap. Additive; no signed record changes. Ending a membership keeps its row.

### 2026-11-13 — e-signatures on consents; prescription confirmation fixed

On the owner's decisions of 2026-11-13 (method, signers and scope chosen; mapping stated before building, §7):

1. **Who signs, how.** Drawn on screen (finger, stylus or mouse) and witnessed by the staff member present,
   who signs as themselves every time. The client signs their own consent; a parent / guardian signs for a
   minor and a substitute decision-maker when they decide; on a family-involvement consent document (CON-04)
   the named family member / caregiver signs too, chosen from the client's contacts. A party who cannot sign
   has the reason recorded instead (still witnessed); the witness can never be "unable".
2. **Where.** Decision consents (`VisitConsent`): signed when recorded; a deferred (emergency) consent is
   signed when it is completed. Their scope is now a `capacity-decision` code (+ detail for Other), not free
   text; rows recorded earlier keep their text. Recording or completing one needs `clinical.care.record`
   (there was no check). Consent documents (catalogue CON-01..11): the parties sign the draft, and the
   clinician's "Authorize & sign" is refused until every required signature is on the current content.
   Mental Health Act forms are unchanged (not chosen).
3. **Facility wording for consent documents.** CON-01..11 were permanently blocked (VERIFY: no approved
   wording). Org Admin → Consent wording now sets each one's wording (`ConsentTemplate` types `DOC-CON-nn`);
   it is frozen into the document's content, printed above the signatures, and a document without it stays a
   structured draft. The system writes no consent text (§6).
4. **Store.** `documents.PartySignature`, append-only, RLS: role, name, relationship / contact, method, the
   PNG (in the database, never browser storage), its SHA-256, and the SHA-256 of the content signed. A
   document edited after signing no longer matches, and its signatures stop counting. The audit trail keeps
   the image only as a fingerprint (`image_png` joins `CLINICAL_CONTENT_FIELDS`). Every signature prints on
   the document's Preview / PDF.
5. **FHIR.** `Consent` (profile `signed-consent`: R + PSY, performer when active, policyRule) + `Provenance`
   (profile `consent-signature-provenance`: one `signature` per drawn signature, sigFormat image/png, the
   witness always present, signer-role codes from local `signature-role`) + Patient. Read-time:
   GET `care/visit-consents/<id>/fhir/`, GET `documents/generated/<id>/fhir/` (signed consent documents),
   each a VIEW audit entry. Three examples in `documents/fhir_examples/consent-*.json` (routine client, minor
   with guardian + family member, unable to sign); `test_consent_signatures.py` is in CI's conformance step,
   and HL7's validator passes all 49 examples (checked to fail with the witness or a label removed).
   Never sent to the SHR.
6. **VERIFY:** ISO-ASTM E1762 signature-type codes (Signature.type is local until then); with legal counsel,
   that a drawn, witnessed signature meets Kenyan e-signature and data-protection consent requirements for
   each consent — no statute is cited.
7. **Prescription confirmation (fixes 4fd930c).** A telephone / PRN order is confirmed only through its
   co-sign request: `clinical.cosign`, never the person who placed it, current licence, audited. Signing the
   request in "Needs my decision" confirms the order; declining leaves it permanently not administerable with
   the reason shown. One request per order. A PRN order always gets the PRN checks. Order type is the served
   `medication-order-type` value set.
8. **Registry.** The Clients page has search and opens newest-registered first (by surname on request).

   A telephone order names the prescriber who gave it (`PrescriptionItem.authorised_by`, any holder of
   `clinical.medication.prescribe` other than the person placing it), and only that prescriber can confirm or
   decline it; it waits in their "Needs my decision", not every senior's. A PRN order is confirmed by a
   senior clinician as above.

Reversibility: cheap. Everything is additive; no signed record changes. Consents and documents recorded
before today show no signatures; a telephone order placed before today names no prescriber,
so a senior clinician confirms it as before.

### 2026-11-13 — new triages are signed on v5 only

On the owner's decision of 2026-11-13, this closes the open "retiring v3/v4 triage signing" item from
2026-11-06. `services.sign_triage` signs only a v5 answer set (`triage_v5`). A v3- or v4-shaped draft
is refused with a message to reload, and reloading opens it on the v5 form (an editable triage always
opens on v5, keeping what the forms share). Triages already signed on v3 or v4 keep their record and
rule set: they still open and print on the form they were signed with. The test fixtures were rebuilt
on v5 (`care_pathway/tests.py` `v5_answers`). A test asking for a priority v5 does not recommend signs
it as the clinician's override with a reason, as the form does. FHIR: unchanged; a v5 signature emits
the vital-signs `Observation` it always did.

Reversibility: cheap. No signed record changes. Only future signatures are affected.

### 2026-11-16 — Triage v5 Section N: one psychiatric review action; described Other

On the project owner's instruction, editable v5 triages show one Section N action,
**Psychiatric review**, instead of routine / priority / urgent variants. The action is
available at every triage priority; RED / ORANGE remains urgent and YELLOW / GREEN remains
routine on the FHIR Task, while the exact priority remains on the linked Encounter. If acute
medical escalation calls for psychiatric review, it reuses this same task rather than raising a
second general review. Withdrawal rules and trigger conditions are unchanged, but their
recommendation and auto-trigger pathway now point to **Psychiatric review**; the separate
withdrawal-triggered task retains its coded-outcome workflow. Signed v3/v4 triages are unchanged.

**Other** is last. Selecting it opens a required description field; registering it as a task
requires the description, which is stored in `CareTask.action_detail`. The audit trail keeps
only a fingerprint of that free text. Task assignees remain named people.

FHIR: R4 `Task` uses the served local `triage-action` code; Other's description maps to
`Task.description`. The Task references the triage Encounter, whose `EpisodeOfCare` link
provides the episode connection. Task resources are not on the SHR export allow-list.
VERIFY: a profile and bound ValueSet for the general triage-action Task; this change adds no
canonical URL or new code system.

Reversibility: cheap. The task detail field and action are additive; signed triage answers and
legacy form behavior are not rewritten.

### 2026-11-16 — registration: required details for an identified client

On the owner's decision of 2026-11-16, an identified client needs, besides first and last name:
sex, date of birth (or an estimated age when it is not known), a mobile phone, and a next of kin /
emergency contact with a phone. `services._require_core_details` enforces it on a registration
submit, an identity resolution (upgrade in place, not a merge into a client who already has them)
and a details edit; the registration form marks the fields with a red asterisk and checks them
before sending. Unidentified and emergency (identity unknown) records still need none of them. A
value already on file counts, so a returning client is not asked again; an edit cannot clear one.
Identity resolution now also saves the next of kin it is given. FHIR: unchanged (`Patient.gender`,
`birthDate`, `telecom`, `contact`). Reversibility: cheap — validation only, no record changes.

### 2026-11-16 — client registry actions; the full client report connected

On the owner's instruction, each row in Clients has a ⋮ menu: **View registration details** (a
read-only drawer of the record as currently saved — the registration endpoint, audited as any
client read), **Full client report**, and **Open client record**.

The full client report (`care_pathway/client_report.py`, written 2026-11-12 but never routed) is now
served at `care/clients/<id>/report/` and `…/report/print/` (Preview / Download PDF, template
`documents/print/client_report.html`) and shown at `/clinical/clients/<id>/report`. It covers every
triage (with re-checks) and every intake first to latest, the care plan, admissions, interventions
with their delivery records and psychotherapy sessions, group sessions, outcomes, discharges, signed
notes and follow-up. Clinical staff only (`clinical.care.record`); every opening is a VIEW and every
PDF an EXPORT audit entry. Read-time, nothing stored, so it always reflects the record.

Access: the module's docstring said the owner had decided psychotherapy session notes were for all
clinicians; no such decision is recorded here, so the report applies the same rules as each record's
own screen — psychotherapy content for the note's author or the client's care team
(`psychotherapy.can_read`), process notes and restricted intake fields for
`clinical.restricted_content.view`, a discharge summary in full for `can_view_discharge_in_full`.
Withheld content is marked as withheld, never silently dropped. **Owner to confirm** if all
clinicians should see psychotherapy content in this report. FHIR: no new resource (a read-time view
over existing records). Reversibility: cheap — read-only.

### 2026-11-17 — Individual and Family Psychotherapy as separate Interventions modules

On the owner's decisions of 2026-11-17 (mapping confirmed before building, §7):

1. **Two modules.** The Interventions module `psychotherapy` is shown as **Individual Psychotherapy**
   (code unchanged, so past individual deliveries, care-plan links and the "Psychotherapy" tariff keep
   working) and a new `family_psychotherapy`, **Family Psychotherapy**, delivers the care plan's
   "Family intervention" (`ACTION_MODULES["family"]`). "Psychological therapy" stays on Individual.
   Each module starts and lists only its own session type. The served `intervention-module` value set
   carries both (migration `care_pathway 0063`).
2. **Billing.** Signing a family session note records the delivery on Family Psychotherapy and charges
   the facility's **"Family Psychotherapy"** tariff line. It is seeded for every organisation with no
   rate; until the Org Admin prices it, the module shows "No rate configured" and nothing is charged.
   No price is invented.
3. **Past records.** Earlier family-session deliveries move to the new module (module label only; the
   signed note, dates, provider, signature and any charge already raised are unchanged).
4. **Opening a psychotherapy module goes straight to its session page.** The "Start a therapy episode"
   card is gone. For a client's first session the page asks only what the server requires: the therapy
   approach (coded, `therapy-modality`; Family pre-selects "Family therapy" for the clinician to
   confirm) and that the limits of confidentiality were explained and agreed, plus an optional number of
   sessions. Frequency, trauma phase, care-plan goal and the two supervision checkboxes are no longer
   asked for new courses of therapy; existing values are kept.
5. **Number of sessions** can be set or changed on the session page (PATCH `care/therapy/<id>/plan/`,
   1–100 or blank).

FHIR: unchanged — the note, its Encounter and Provenance, and the InterventionRecord (Procedure) mapping
are as before; only the local module code of a family delivery differs. Reversibility: cheap. No signed
record changes. Reversing `0063` moves the deliveries back, restores the value set and removes the
tariff line while it is unpriced and unused.

### 2026-11-18 — care plan: decide actions only; safety planning delivered in Interventions

On the owner's decision of 2026-11-18 ("the care plan is the suggested actions to be worked on in
Interventions"; client agreement removed):

1. **Care Plan is one screen.** Accept, modify or decline each recommended action. When the plan conflicts with the client's risk (`care_plan.conflicts`), it also asks
   for the rationale and a senior reviewer. The "With the client", "Tasks & reviews" and
   "Documented actions" tabs are gone. Interventions tracks delivery. The nursing care plan moved to
   Psychiatric Nursing → Nursing care.
2. **Signing no longer needs** client agreement or disagreements, a signed safety plan, the
   72-hour contact or a named follow-up clinician (`care_plan.outstanding`). The safety control is
   the decision. A suicide-risk finding recommends "Safety plan / enhanced observation", which must
   be accepted, or declined with a written reason. A recorded plan or intent with no safety action
   is still a conflict that needs a rationale and a senior co-signature. "What matters", client
   agreement and disagreements and the client-acknowledgement view are no longer captured (the API
   ignores them, and the acknowledge endpoint is removed). Signed plan versions keep what they
   recorded.
3. **Safety planning** (Interventions → Observation & safety, `SafetyPlanModule`): the client-held
   safety plan (same `SafetyPlan` store and versioning), the crisis & relapse plan, lethal-means
   counselling and the 72-hour contact. The contact is booked as a follow-up appointment when it is
   saved, not at plan signing. The follow-up clinician is the episode's care coordinator
   (`EpisodeOfCare.careManager`), never a typed name. `GET …/safety-plan/?peek=1` reads the latest
   version without creating a draft, so viewing never starts a revision. Saving plan details now
   needs the clinical permission signing uses.
4. **Family involvement and advance statement** are recorded in Legal & consent, beside the consents
   they depend on (same care-plan fields). Naloxone and OAT are recorded only in Interventions →
   Opioid Agonist Therapy. The opioid conflict points there.

5. **Goals are no longer captured on the care plan** (owner, same day: a goal linked to an action
   was shown nowhere but psychotherapy). Goals already saved stay on the plan and in signed
   versions, and psychotherapy sessions still show them. New plans have none, so new sessions have
   no plan goals to record progress against (psychotherapy guidance §8) until goals are given a home
   that the delivering module reads.

FHIR: unchanged. Same stores, no new resource or code. Reversibility: cheap. No signed care plan,
safety plan or record changes; only plans signed from today are signed under the new rule.

### 2026-11-18 — admission: one guided path, voluntary or involuntary

On the owner's decision of 2026-11-18 (flow and mapping confirmed before building, §7):

1. **One place to start.** Inpatient Admissions is the only place an admission is started:
   1 client & reason → 2 Voluntary or Involuntary, then that type's legal steps as a checklist →
   3 bed & admit. Voluntary: capacity assessment, the client's or guardian's application, the
   admitting officer's decision. Involuntary: the related person's application, the signed medical
   recommendation(s), the decision. Bed & admit unlocks only once the legal status is Active.
2. **Legal & consent and Interventions → Admission** show the status and what happens after
   admission (notice to leave, conversion, ending, rights, tasks, documents). They no longer start
   a first application. They link to "Start an admission" or "Continue admission" instead.
3. **The admitting officer may decide in the same flow.** Someone holding
   `clinical.admitting_officer` who is admitting records the decision there. Otherwise the signed
   application waits in the admitting officer's My tasks ("Admission decision", `kind`
   `admission_decision`, `legal_status.awaiting_decision`). An involuntary one waits only once its
   required recommendations are signed, and opens on the admission page.
4. **Capacity is recorded once.** New admissions no longer ask the free-text "Capacity assessed"
   and consent notes. The formal capacity assessment the voluntary application requires is the
   record. Admissions made earlier keep their values.

FHIR: unchanged. The admission is an `Encounter` (class IMP) in its `EpisodeOfCare`. Guardian
consent is the existing `Consent`. The legal status stays local, with no verified R4 home (VERIFY,
unchanged), and is never sent to the SHR. Reversibility: cheap. Same stores, forms, signatures and
statutory checks; no signed legal form or admission changes. Still open: renewal of involuntary
status, the rights text, and the seven legacy free-text legal fields on earlier admissions.

### 2026-11-18 — CITRAMAC brand colours; platform and organisation icons

On the owner's instruction, the product defaults (used until an organisation sets its own theme)
are the CITRAMAC brand: Green `#2E705F` and Deep Amber `#d07428`. The defaults live in
`frontend/src/theme/tokens.css`. The token names (`--green`, `--green-dark`) are historical.

- **Light mode.**
  - Primary (buttons, links, focus rings, active states, active tab underline) is `#d07428`.
  - Secondary (button hover, heading accents, KPI numbers) is `#2e705f`.
  - The sidebar is `#2e705f`, and the current page's link is `#d07428` with white text.
  - Sign-in screens reverse this: green buttons that turn amber on hover. A branded sign-in page
    falls back to green when the organisation has no login colour.
- **Dark mode.**
  - Fills (buttons, sidebar) are `#2e705f`.
  - Green used as text, links, icons and focus outlines is lifted (`--brand-green-text`, 55%
    mixed with white) so it reads on the dark background.
- **Status colours** (danger, warning, triage priorities) are unchanged and never take a brand
  colour.
- **Readability:** white on `#d07428` is 3.4:1, below 4.5:1 for normal-size text. This was
  accepted by the owner.
- **Printed documents and system emails** default to `#2e705f`. Migration `tenancy 0024` moves
  organisations still on the old default login colour (`#006e51`) to it, and leaves any chosen
  colour as it is.
- **Icons** are shown white on a green 44 px tile in the sidebar.
  - The platform has an icon (Super Admin → Platform Branding, `PlatformBranding.icon`,
    `tenancy 0025`), used only in the platform console.
  - Each organisation has an icon (Org Admin → Branch Settings, `Organization.icon_url`,
    `tenancy 0026`), used only in its own sidebar.
  - The logos stay for the sign-in screens.

Not clinical data, so no FHIR change. Reversibility: cheap. These are presentation defaults and
additive fields; no record changes.

### 2026-11-18 — Section N, the care plan and Interventions as one piece of work

On the owner's decisions of 2026-11-18 (mapping confirmed before building, §7): a ticked Section N
action, registered as a named person's task, is added to the episode's care plan as an accepted
action, marked "Started at triage by …" (`apps/care_pathway/triage_care_plan.py`). That opens its
Interventions module, and the triage task is the action's task (`CareTask.care_plan_activity`,
migration `care_pathway 0064`). It is not a second store.

1. **Mapping.** Safety Plan and Enhanced observation → Safety plan / enhanced observation;
   psychiatric review → Psychiatric review; urgent medical review → Medical review; withdrawal
   monitoring, detox assessment, PAWSS, CIWA-Ar and COWS → Detox / withdrawal management; admission
   assessment → Inpatient admission; outpatient appointment → Outpatient care; emergency transfer and
   referral out → Referral / emergency transfer; safeguarding intervention → the new care-plan action
   **Safeguarding**, delivered under Psychosocial support. Several ticks for one action become one
   action carrying every task. Suicide Risk Assessment, Comprehensive Intake, Immediate emergency
   intervention and Other stay named tasks only.
2. **Decisions.** A recommended action is accepted at its recommended priority; one with no
   recommendation is added at the triage's final priority. An action the plan had declined is
   accepted again, and the decline stays in the signed version. A signed plan is never changed: the
   action is an accepted addition that the care-plan clinician signs into the next version. Its
   checklist steps go to the person the triage task was assigned to.
3. **Opening and closing.** The notification and My tasks open the screen where the work is done
   (the Interventions module, Inpatient Admissions, the intake, or the triage). A delivery recorded
   against the action puts its tasks in progress, and one that completes the action completes them.
   Signing the safety plan completes the client's open Safety Plan tasks. A psychiatric review is
   only ever completed with its coded outcome.
4. **FHIR.** The task stays an R4 `Task`, with `basedOn` naming the care-plan action (display only;
   the CarePlan is not in the triage bundle). The action is a `CarePlan.activity` on the episode's
   `CarePlan`. No new code system.

Reversibility: cheap. A link and new actions on draft plans are added. Signed triages and signed
care-plan versions do not change; reversing `0064` removes only the link.

### 2026-11-19 — admission: print, sign on paper, upload; change of admission type

On the owner's decisions of 2026-11-19 (mapping stated before building, §7), in Inpatient Admissions
step 2:

1. **Print → sign → upload.** A voluntary or involuntary application is printed for the applicant to
   sign. Uploading the signed copy (PDF, PNG or JPEG, ≤ 10 MB, content checked) records it as signed
   by the applicant (method `WET_SCAN`, the uploader as the person who captured it), in one
   transaction: an incomplete form is not signed and the upload is not kept. The witnessed electronic
   signature stays available. The medical recommendation is still signed in the system by the doctor.
2. **Signed copies of any statutory form** can be uploaded beside it (evidence only; a copy never signs
   a form) by clinical staff. They are stored in the one attachment store (`Attachment.legal_document`,
   and the admission when there is one), opened through the app, and removed only by the uploader or an
   Org Admin with a reason (archived, never deleted). Uploads, downloads and removals are audited with
   the file's SHA-256 and size, never its content (`legal_copies.py`).
3. **Change of type.** Until a status is in force, the application can be switched between voluntary
   and involuntary: an unsigned draft in one click, a signed one with a reason. The application and its
   recommendations are marked Withdrawn (`VOID`, with who, when and why); a signed form's content and
   signature never change. Once admitted, conversion applies instead.
4. **Print.** "For official use only" is printed only once the admitting officer has decided, so the
   copy the applicant signs carries no blank Admitted / Rejected boxes. A withdrawn form prints marked
   Withdrawn, as signed.

FHIR: the scan is a `DocumentReference` (the file as content) on the admission `Encounter` in its
`EpisodeOfCare`, R + PSY, with a `Provenance` for the signature; never sent to the SHR; not emitted
yet. VERIFY: a LOINC document type for a statutory admission form. Reversibility: cheap. Migrations
`client_registry 0027` and `care_pathway 0065` add a link and withdrawal fields; no signed form changes.
