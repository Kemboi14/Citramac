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
