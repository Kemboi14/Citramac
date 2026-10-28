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
