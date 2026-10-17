# CITRAMAC™ — Master Build & Verification Prompt

> Paste this entire file into Claude (Claude Code recommended, run from the repo root) together with access to the mockup repository. Set the two variables below before running.

```
MOCKUP_REPO      = <GitHub URL or local path of the HTML mockup>
RUN_MODE         = VERIFY | BUILD | VERIFY_THEN_BUILD
```

---

## 0. Your Role and Operating Contract

You are acting as the lead engineer and clinical-informatics reviewer for **CITRAMAC™**, a multi-tenant mental health & addiction EMR (clinic, hospital, detox, rehabilitation/residential, emergency). You have two jobs, executed in this order:

1. **VERIFY** — Audit the existing HTML mockup in `MOCKUP_REPO` against every requirement in this prompt and produce a traceability report (Section 10).
2. **BUILD** — Bring the mockup to full conformance, implementing every missing or incorrect requirement, without breaking what already conforms.

Operating rules:

- **Inspect before you change anything.** Read the repo structure, framework, build tooling, CSS approach, routing, and any existing data/state layer. Keep the existing stack unless it makes a requirement impossible; if so, stop and explain why with a concrete alternative.
- **Requirements are identified by ID** (e.g. `TRI-D-03`, `RULE-07`, `AT-04`). Every finding, commit, and code comment that implements a requirement must reference its ID.
- **Never invent clinical meaning.** If a requirement is ambiguous, implement the most conservative interpretation, mark it `ASSUMPTION` in the report, and list it in the open-questions section. Do not silently resolve clinical ambiguity.
- **Synthetic data only.** All seed/demo data must be clearly fictitious. No real patient identifiers.
- **No placeholders, no `TODO`s, no partial components.** Every screen you touch must be complete and functional against the mock data layer.
- **A static mockup cannot enforce backend rules** (audit, RBAC, consent blocking). Implement them in a client-side domain layer (typed models + services + an in-memory/`localStorage`-backed repository) designed so it can later be swapped for a real API without UI rewrites. Clearly separate `domain/`, `services/`, `ui/`.

---

## 1. System-Wide Principles (apply to every module)

**Core pipeline:** `COLLECT ONCE → CARRY FORWARD → TRIGGER → CONFIRM → ACT → MONITOR`

| ID | Rule | Meaning for the build |
|---|---|---|
| RULE-01 | Enter once, use many times | Structured data stored centrally and reused across Registration, Triage, Intake, Risk, Care Plan, Interventions, Outcomes, Documents, Psychotherapy. |
| RULE-02 | Update, do not re-enter | A change updates the **same clinical object**; prior values preserved in audit history. Never overwrite silently. |
| RULE-03 | Show source | Every important finding displays its source: `CLIENT_REPORT`, `THIRD_PARTY_REPORT`, `CLINICIAN_OBSERVATION`, `MEASUREMENT`, `ASSESSMENT_RESULT`, `PREVIOUS_RECORD`. |
| RULE-04 | Show date/time | Every finding shows when it was recorded/last confirmed so clinicians can judge currency. |
| RULE-05 | Trigger, do not force blindly | The system recommends assessments/actions; the clinician confirms, modifies, or declines (decline is recorded). |
| RULE-06 | Alerts follow the client | Active allergies and critical risks remain visible in the persistent banner until resolved/updated per policy. |
| RULE-07 | One priority language | RED Emergency / ORANGE Urgent / YELLOW Priority / GREEN Routine mean the same across all tenants. |
| RULE-08 | Configure operations, not clinical meanings | Tenants may configure queues, staffing, response times, services, section visibility/order, assessment tools and thresholds — **never** redefine priority meanings or shared object semantics. |
| RULE-09 | Maintain an audit trail | Record who entered, confirmed, changed, overrode, signed, released — and when. |
| RULE-10 | Workflow continues across staff | The next clinician immediately sees what is known, what is pending, what must happen next, and who owns it. |
| RULE-11 | Clinical control | CITRAMAC may recommend priority/actions; a qualified clinician confirms or overrides. Overrides require a reason. |
| RULE-12 | Structured over free text | Use structured fields wherever data drives alerts, assessments, care-plan recommendations, outcomes, reporting, or billing. Free text adds context; it never replaces structured data. |
| RULE-13 | No AI-invented clinical content | Any generated text (notes, documents, summaries) organizes clinician/record data only. Drafts require human review and signature. |

---

## 2. Shared Data Architecture (DATA)

### DATA-01 — One clinical object per domain, many views
Do **not** create stage-specific duplicates (no `triageSuicide` and `intakeSuicide`). Create one `SuicideSelfHarmFinding` object that every stage reads and extends:

| View | What it shows of the same object |
|---|---|
| Triage | Immediate safety fields |
| Comprehensive Intake | Same findings + deeper history/assessment fields |
| Risk Assessment | Same findings + structured risk formulation |
| Care Plan | Same findings + triggered recommended actions |
| Interventions | Actions taken in response |
| Outcomes / Follow-up | Status and change over time |

Apply the same pattern to: Presenting Concern, Allergies, Medications, Substance Use, Risk to Others, Acute Mental State / MSE, Medical/Vitals, Safeguarding, Functional Safety, Priority, Alerts, Tasks.

### DATA-02 — Minimum envelope for every important finding
```ts
type Source = 'CLIENT_REPORT' | 'THIRD_PARTY_REPORT' | 'CLINICIAN_OBSERVATION'
            | 'MEASUREMENT' | 'ASSESSMENT_RESULT' | 'PREVIOUS_RECORD';
type FindingStatus = 'ACTIVE' | 'RESOLVED' | 'UNKNOWN';

interface ClinicalFinding<T> {
  id: string;
  clientId: string;
  episodeId: string;
  tenantId: string;
  domain: FindingDomain;           // e.g. 'SUICIDE_SELF_HARM'
  value: T;                        // domain-specific structured payload
  source: Source;
  sourceDetail?: string;           // e.g. informant name/relationship
  status: FindingStatus;
  recordedAt: string;              // ISO-8601
  recordedBy: UserRef;
  lastConfirmedAt?: string;
  lastConfirmedBy?: UserRef;
  workflowStage: 'REGISTRATION' | 'TRIAGE' | 'INTAKE' | 'RISK' | 'CARE_PLAN'
               | 'PSYCHOTHERAPY' | 'OUTCOMES';
  history: AuditEntry[];           // prior values, never deleted
}

interface AuditEntry {
  at: string; by: UserRef;
  action: 'CREATE' | 'CONFIRM' | 'UPDATE' | 'ADD_DETAIL' | 'RESOLVE'
        | 'OVERRIDE' | 'SIGN' | 'AMEND' | 'RELEASE' | 'DECLINE_TRIGGER';
  previousValue?: unknown; newValue?: unknown; reason?: string;
}
```

### DATA-03 — Carry-forward interaction
Wherever a previously captured finding appears in a later stage, render it read-only with a source/date/time chip and offer exactly: **☐ Confirm unchanged ☐ Update ☐ Add information**. Each choice writes an `AuditEntry` against the same object.

### DATA-04 — Central allergy object
One allergy record per client. States: `KNOWN` (list of `{substance, reaction, severity, status, lastConfirmed}`), `NKA` (“No known allergies”), `UNKNOWN` (“ALLERGY STATUS UNKNOWN”). Registration, Triage, Intake, Documents, and the banner all read/write this one object.

### DATA-05 — Shared medication list
Fields: medication, dose, route, frequency, indication, adherence, effect/side effects. Flags: no current medication; medication reconciliation completed; list unavailable — follow-up required. Confirm/update, never re-enter.

### DATA-06 — Tasks/orders/referrals
Every selected action becomes a `Task { id, type, priority, owner (person/team), status: INITIATED|PENDING|COMPLETED, createdAt, createdBy, linkedFindingIds[], dueAt? }`. Never free text buried in a note.

### DATA-07 — Alerts
`Alert { code, label, severity, sourceFindingId, raisedAt, raisedBy, status: ACTIVE|RESOLVED, resolvedAt?, resolvedBy?, resolutionReason? }`. Alert codes used in this spec: `SUICIDE_SELF_HARM_RISK`, `RISK_OF_HARM_TO_OTHERS`, `ACUTE_MENTAL_STATE_CHANGE`, `PSYCHOSIS_SEVERE_AGITATION`, `ALTERED_CONSCIOUSNESS`, `WITHDRAWAL_RISK`, `ACUTE_MEDICAL_CONCERN`, `SAFEGUARDING_CONCERN`, `ALLERGY`, `ALLERGY_STATUS_UNKNOWN`, `PSYCHOTHERAPY_SAFETY_CONCERN`, `SAFETY_NOT_ASSESSED`, plus legal-status alerts from LGL-WF-06.

### DATA-08 — Assessment results
Stored once: `{ tool, reasonTriggered, triggeredByFindingIds[], status: RECOMMENDED|ACCEPTED|DECLINED|IN_PROGRESS|COMPLETED, score, interpretation, completedAt, completedBy }`. Care Plan reads results automatically and shows *why* an action was recommended (AT-04).

### DATA-09 — Assessment tool registry (tenant-configurable)
Seed with: Suicide Risk Assessment, Safety Plan, PAWSS (or tenant-configured withdrawal predictor), CIWA-Ar, COWS, PHQ-9, GAD-7, MDQ, Trauma assessment (tenant-approved), CRI / CORI / other tenant tool. Tools are data, not hard-coded components.

---

## 3. Persistent Client Safety Banner (BAN)

Always visible at the top of the client record regardless of open section, tab, or scroll position (sticky).

| ID | Element |
|---|---|
| BAN-01 | Client name or temporary identifier |
| BAN-02 | CITRAMAC ID |
| BAN-03 | Age/DOB and sex |
| BAN-04 | Current setting/status |
| BAN-05 | Current triage/risk priority (colour-coded RED/ORANGE/YELLOW/GREEN, with label text — never colour alone) |
| BAN-06 | ALLERGIES — known: prominently show allergen + reaction; NKA: “No known allergies”; not assessed: “ALLERGY STATUS UNKNOWN” (visually flagged) |
| BAN-07 | Critical clinical alerts (active alerts from DATA-07) |
| BAN-08 | Responsible clinician/team |
| BAN-09 | Updates live: risk/priority changes made in any form (including unsigned Intake) reflect immediately (INT-DEV-06) |
| BAN-10 | Legal admission status (Voluntary / Involuntary + expiry, active 72-hour discharge notice countdown), see LGL-DATA-01 |

---

## 4. Module: Comprehensive Triage & Initial Risk Screen (TRI)

**Purpose:** What is happening now? Immediate safety/medical concern? How urgently is assessment needed? What must happen next?
**Target:** ~2–5 minutes. Triage is **not** the full assessment — keep it short and do not duplicate the full suicide/withdrawal assessments.

### TRI-A — Automatic Information (do not ask again)
Retrieve from Registration/current episode on open:

| ID | Information | Display | Behaviour |
|---|---|---|---|
| TRI-A-01 | Client identity / temporary ID | Auto-populate | Read from central record |
| TRI-A-02 | DOB/age and sex | Auto-populate | No second field |
| TRI-A-03 | Contact details | Auto-populate | Update same record if changed |
| TRI-A-04 | Emergency contact / next of kin | Auto-populate | Update allowed; audited |
| TRI-A-05 | Referral source | Auto-populate | Carry forward source/date/time |
| TRI-A-06 | Allergies | Auto-populate + flag | Confirm/update same allergy object |
| TRI-A-07 | Existing critical alerts | Prominent | Follow client until resolved |
| TRI-A-08 | Previous/current priority | Display | Date/time/source + latest active status |

### TRI-B — Triage Encounter
- TRI-B-01 Date/time `[AUTO]`; TRI-B-02 Triage clinician `[AUTO from login]`; TRI-B-03 Tenant/location `[AUTO]`
- TRI-B-04 Encounter type: Walk-in | Appointment | Emergency | Telephone | Referral | Other
- TRI-B-05 Informant: Client | Family/parent | Friend | Police | Ambulance | Healthcare professional | Employer/school | Other
- TRI-B-06 Name/relationship if third party (required when informant ≠ Client; sets `source = THIRD_PARTY_REPORT` + `sourceDetail`)
- TRI-B-07 Is the client physically present? Yes | No
- **TRI-B-08 BRANCHING:** YES → show direct clinical observation/safety screen (Sections D–J incl. clinician observations and vitals). NO → show Telephone/Third-Party screen (Section K) and **hide fields requiring direct observation or measurement** (F clinician observation block, H vitals).

### TRI-C — What Is Happening Right Now?
- TRI-C-01 Main concern in client/informant’s own words (free text)
- TRI-C-02 Onset/worsening: Today | Past 24 hours | Past few days | Past week | Longer | Unknown
- TRI-C-03 Brief description
- TRI-C-04 Stored as the **Presenting Concern object**; Intake shows it with source/date/time + Confirm/Update/Add (DATA-03)

### TRI-D — Immediate Safety: Suicide / Self-Harm
- TRI-D-01 Current thoughts of killing/seriously harming self? No | Yes | Unable to determine
- TRI-D-02 *(only if D-01 = Yes)* Thinking about acting on them now? No | Yes | Unsure
- TRI-D-03 Recent attempt/serious self-harm? No | Yes → TRI-D-04 What happened and when?
- TRI-D-05 Known access to means for serious self-harm? No | Yes | Unknown
- TRI-D-06 Can the client currently maintain their own safety? Yes | No | Uncertain
- **TRI-D-TRIG:** Any positive significant finding → raise `SUICIDE_SELF_HARM_RISK` + recommend Suicide Risk Assessment + Safety Planning workflow. Do not embed the full assessment in Triage.

### TRI-E — Risk of Harm to Others
- TRI-E-01 Current thoughts of seriously harming someone? No | Yes | Unable to determine
- TRI-E-02 Recent threatening/aggressive/violent behaviour? No | Yes | Unknown
- TRI-E-03 Who/what is the concern?
- TRI-E-04 Recent violent act? No | Yes
- TRI-E-05 Access to means capable of serious harm? No | Yes | Unknown
- TRI-E-06 Current behaviour suggests immediate danger? No | Yes | Uncertain
- **TRI-E-TRIG:** → `RISK_OF_HARM_TO_OTHERS` + violence/risk assessment + escalation pathway.

### TRI-F — Acute Mental State
- TRI-F-01 Major change in mental state now? No | Yes | Unable to determine
- TRI-F-02 Multi-select: Severe agitation, Extreme distress, Confusion/disorientation, Psychotic symptoms, Hallucinations, Frightening/command hallucinations, Severe suspiciousness/paranoia, Very elevated/activated behaviour, Markedly disorganised behaviour, Unable to communicate safely/coherently, Marked behavioural change from usual, Other
- Clinician observation *(present only)*:
  - TRI-F-03 Level of consciousness: Alert | Drowsy | Difficult to rouse | Unresponsive | Fluctuating
  - TRI-F-04 Orientation: Appears oriented | Disoriented/confused | Unable to assess
  - TRI-F-05 Behaviour: Calm | Anxious/distressed | Agitated | Aggressive | Disorganised | Withdrawn/unresponsive | Other
- **TRI-F-TRIG:** as applicable → `ACUTE_MENTAL_STATE_CHANGE` | `PSYCHOSIS_SEVERE_AGITATION` | `ALTERED_CONSCIOUSNESS`. These observations later appear in the Intake MSE labelled “Triage finding” (TRI-CF-08).

### TRI-G — Alcohol & Other Substances
- TRI-G-01 Recent use? No | Yes | Unknown
- TRI-G-02 Grid rows: Alcohol, Opioids, Sedatives, Stimulants, Cannabis, Other × columns: Last use, Amount/pattern, Current concern
- TRI-G-03 Current intoxication: None apparent | Mild/suspected | Significant | Severe | Unable to determine
- TRI-G-04 Recently stopped/significantly reduced heavy or frequent use? No | Yes | Unknown
- TRI-G-05 Current withdrawal signs (multi): Tremor, Sweating, Vomiting, Severe anxiety/agitation, Hallucinations, Confusion, Seizure, Other, None (None is mutually exclusive)
- TRI-G-06 Previous withdrawal seizure? No | Yes | Unknown; TRI-G-07 Previous severe withdrawal/DTs? No | Yes | Unknown
- **TRI-G-TRIG:**
  - Alcohol dependence/recent cessation + withdrawal risk → recommend **PAWSS** (or configured predictor)
  - Current alcohol withdrawal → **CIWA-Ar**
  - Current opioid withdrawal → **COWS**
  - Raise `WITHDRAWAL_RISK` alert

### TRI-H — Urgent Medical Screen
- TRI-H-01 Immediate physical/medical concern? No | Yes | Unknown
- TRI-H-02 Multi: Chest pain, Difficulty breathing, Severe pain, Serious injury, Recent seizure, Loss/alteration of consciousness, Severe vomiting/dehydration, Suspected overdose, Head injury, Severe intoxication, Acute medication reaction/concern, Pregnancy-related acute concern, Other
- TRI-H-03 Vitals *(present only, when clinically indicated)*: BP (systolic/diastolic), Pulse, Resp. rate, Temp., SpO₂, Blood glucose — each stored as `MEASUREMENT` with time
- **TRI-H-TRIG:** Tenant-configured abnormal/critical thresholds → `ACUTE_MEDICAL_CONCERN` + prompt medical review/escalation. Thresholds are configuration (RULE-08); seed demo values must be labelled as demo configuration.

### TRI-I — Safeguarding & Vulnerability
- TRI-I-01 Feels safe where living/staying? Yes | No | Unsure | Unable to assess
- TRI-I-02 Multi: Abuse, Neglect, Domestic/IPV, Sexual violence/exploitation, Financial exploitation, Threat/coercion, Child safeguarding, Vulnerable adult, Unsafe living environment, Other, None identified
- TRI-I-03 Safe to return to current environment? Yes | No | Uncertain
- **TRI-I-TRIG:** → `SAFEGUARDING_CONCERN` + tenant safeguarding pathway.

### TRI-J — Immediate Functional Safety (brief only)
- TRI-J-01 Concern that person cannot safely meet basic needs? No | Yes | Uncertain
- TRI-J-02 Multi: Eating/drinking, Medication, Hygiene/basic care, Safe shelter, Severe sleep disruption, Wandering/getting lost, Unable to seek help appropriately, Other
- Detailed functioning belongs to Intake — do not expand here.

### TRI-K — Client Not Physically Present (Telephone / Third-Party)
- TRI-K-01 Where is the client now? · TRI-K-02 Alone? Yes | No | Unknown · TRI-K-03 Who is with them?
- TRI-K-04 When did caller last see/speak with them? · TRI-K-05 What exactly has the client said/done?
- TRI-K-06 Multi: Suicide/self-harm concern, Recent attempt/self-harm, Threat/risk to another person, Access to serious means reported, Severe confusion, Severe agitation/aggression, Psychotic behaviour, Significant intoxication, Possible withdrawal, Seizure, Loss of consciousness, Serious injury/medical concern
- TRI-K-07 Can the person be brought safely for assessment? Yes | No | Uncertain
- TRI-K-08 Emergency assistance required? No | Yes
- K-06 selections must write into the **same** domain objects as D–H (source = `THIRD_PARTY_REPORT`) and fire the same triggers.

### TRI-L — Automatic Triage Summary
- TRI-L-01 Auto-generated from structured findings — clinician does not retype
- TRI-L-02 Table columns: Finding/Alert | Current status | Source | Date/time | Recorded by
- TRI-L-03 Every finding retains its source (RULE-03)

### TRI-M — Triage Priority
| Priority | Clinical meaning | Expected action |
|---|---|---|
| RED — Emergency / Immediate | Immediate or potentially life-threatening safety, medical or behavioural concern | Do not wait for routine intake. Immediate safety/medical action; emergency assessment/transfer where required |
| ORANGE — Urgent | Significant concern that could deteriorate or needs prompt clinician assessment | Ahead of routine work; review ASAP under urgent process |
| YELLOW — Priority | Currently stable but should not wait through routine pathway | Timely assessment; escalate if condition changes |
| GREEN — Routine | Stable; no immediate safety/medical concern | Normal intake/appointment pathway |

- TRI-M-01 System recommendation (computed) · TRI-M-02 Reason(s) generated from findings (list the specific findings)
- TRI-M-03 Clinician decision: Confirm recommendation | Override
- TRI-M-04 Final selected priority
- TRI-M-05 Override reason — **required** if overridden; save blocked without it
- TRI-M-06 Clinician `[AUTO]`, Date/time `[AUTO]`; override writes an `OVERRIDE` audit entry (AT-05)
- TRI-M-07 Priority engine is a declarative, versioned rule set (findings → minimum priority + reason string). The source documents do **not** define the mapping; seed a conservative demo rule set (e.g. acting-on-thoughts-now, immediate danger to others, unresponsive/difficult to rouse, suspected overdose, seizure, emergency assistance required → RED), label it `DEMO RULESET — REQUIRES CLINICAL GOVERNANCE SIGN-OFF`, and list it as an open question.

### TRI-N — Immediate Action / Disposition
- TRI-N-01 Multi: Immediate emergency intervention, Emergency transfer, Urgent medical review, Urgent psychiatric review, Priority psychiatric review, Routine psychiatric review, Suicide Risk Assessment, Safety Plan, Enhanced observation, Withdrawal assessment/monitoring, Detox assessment, Safeguarding intervention, Proceed to Comprehensive Intake, Outpatient appointment, Admission assessment, Other
- TRI-N-02 Responsible person/team · TRI-N-03 Task status: Initiated | Pending | Completed
- **TRI-N-04:** Each selected action becomes a trackable Task (DATA-06) with owner, priority, status, date/time. Pre-select actions implied by triggers as *recommended*, never auto-confirmed.

### TRI-CF — Carry-Forward into Comprehensive Intake
| ID | Domain | Captured in | Intake displays | Provider does |
|---|---|---|---|---|
| TRI-CF-01 | Presenting concern | Triage narrative + onset | Existing concern w/ source/date/time | Confirm/update/add |
| TRI-CF-02 | Allergies | Registration/Triage | Central allergy record | Confirm/update same record |
| TRI-CF-03 | Suicide/self-harm | Triage | Findings + alerts + completed/pending tools | Confirm status; deeper formulation if indicated |
| TRI-CF-04 | Risk to others | Triage | Existing findings | Confirm/update, expand as needed |
| TRI-CF-05 | Substance use | Recent/last use/withdrawal | Structured substance data | Add longitudinal history without retyping acute data |
| TRI-CF-06 | Medical/vitals | Acute concerns + measurements | Latest measurements w/ time/source | Confirm/update; add history |
| TRI-CF-07 | Safeguarding | Current concern | Existing alert/finding | Confirm status, expand |
| TRI-CF-08 | Mental state | Triage observations | Labelled “Triage findings” | Complete full MSE without re-entering identical observations |

---

## 5. Module: Comprehensive Mental Health & Addiction Intake (INT)

**Core rule:** Pre-populate everything from Registration/Triage. Clinician confirms, updates, or adds. Never ask the client to repeat allergies, medications, substance use, risk, vitals, or other structured data. Intake **deepens** history; it does not repeat it.

### INT-H — Header
| ID | Field | Behaviour |
|---|---|---|
| INT-H-01 | Client name / temporary ID | From central record |
| INT-H-02 | CITRAMAC ID | From central record |
| INT-H-03 | Date/time intake started | AUTO on open |
| INT-H-04 | Date/time completed | AUTO on completion |
| INT-H-05 | Care setting | Outpatient \| Inpatient \| Detox \| Rehabilitation/Residential \| Emergency/Other |
| INT-H-06 | Clinician completing intake | AUTO from login |
| INT-H-07 | Current triage priority | **Read from the Priority object** (not a second checkbox set); editable only through the priority workflow |
| INT-H-08 | Information sources | Multi: Client \| Family/other \| Referral record \| Previous record \| Clinician observation |

### INT-01 — Presenting Concern & Reason for Care
- 01-01 Client’s own description (“What brings you here / what would you like help with?”) — shows Triage Presenting Concern with Confirm/Update/Add (TRI-CF-01)
- 01-02 Referral/family/other-source concern
- 01-03 Onset/duration (pre-filled from TRI-C-02)
- 01-04 What changed recently / why seek care now
- 01-05 Type: New problem | Worsening existing | Relapse | Crisis | Planned assessment/treatment | Post-discharge follow-up | Other
- 01-06 Client goals/expectations (“What would you like to be different?”)

### INT-02 — Current Symptoms & Functioning
- 02-01 Multi: Low mood, Loss of interest/pleasure, Anxiety/worry, Panic, Irritability/anger, Mood swings, Elevated/expansive mood, Reduced need for sleep, Racing thoughts, Impulsivity, Poor concentration, Memory concerns, Confusion/disorientation, Hallucinations, Delusions/suspiciousness, Disorganised behaviour/thought, Obsessions/compulsions, Trauma symptoms, Grief/loss, Eating/appetite concern, Sleep disturbance, Somatic/physical complaints, Other
- 02-02 Narrative: severity, frequency, triggers, impact
- 02-03 Sleep: hours/night, quality, Insomnia | Hypersomnia | Nightmares | Other
- 02-04 Appetite/weight: No change | Increased | Reduced + recent weight change
- 02-05 Energy: Normal | Low | Increased/fluctuating
- 02-06 Concentration/memory: No concern | Mild | Moderate | Severe
- 02-07 Self-care/ADLs: Independent | Some difficulty | Requires assistance
- 02-08 Work/school: Unaffected | Mildly | Significantly affected | Unable currently
- 02-09 Social/relationship: Unaffected | Mildly | Significantly affected | Isolated/withdrawn
- Triage functional safety (TRI-J) shown as carried-forward context.

### INT-03 — Immediate & Clinical Risk Assessment
Any positive/changed finding updates the **active risk record** immediately and triggers the relevant workflow. Do not duplicate Triage risk history — display it (TRI-CF-03/04/07).
- 03-01 Suicide/self-harm: None identified | Thoughts | Intent | Plan | Access to means | Recent attempt/self-harm | Past history
- 03-02 Harm to others/violence: None identified | Thoughts | Threats | Intent | Plan | Access to means | Recent violence | Past history
- 03-03 Self-neglect/vulnerability: None | Poor self-care | Unable to meet basic needs | Exploitation/vulnerability concern
- 03-04 Safeguarding: None identified | Abuse | Neglect | Sexual violence/exploitation | Child concern | Elder/vulnerable adult concern
- 03-05 Absconding/leaving-care risk: None | Possible | Significant
- 03-06 Falls/medical safety: None | Concern identified
- 03-07 Other acute risk (text)
- 03-08 Narrative: risk details, protective factors, immediate actions already taken
- 03-09 Triggered actions (become Tasks): Detailed suicide risk assessment | Safety plan | Enhanced observation considered/ordered | Urgent psychiatric review | Emergency/medical escalation | Safeguarding pathway
- “None identified” is mutually exclusive with positive options in each row.

### INT-04 — Mental Health History
- 04-01 Previous diagnosis/diagnoses: None known | Yes | Uncertain
- 04-02 Age/period at first difficulty
- 04-03 Previous psychiatric admissions: None | Yes — number/approx. dates
- 04-04 Previous emergency/crisis presentations: None | Yes
- 04-05 Previous therapy/counselling: None | Yes
- 04-06 Previous psychiatric treatment: None | Yes
- 04-07 Past suicide attempts/self-harm: None | Yes — **linked to the risk history object**, not separate text
- 04-08 Past aggression/violence related to illness: None | Yes
- 04-09 Narrative: diagnoses, episodes, admissions, significant history
- 04-10 Previous treatments and response (what helped / did not)
- 04-11 Previous clinician/facility and records available

### INT-05 — Medications & Adherence
- 05-01 Shared medication list (DATA-05) grid: Medication | Dose | Route | Frequency | Indication | Adherence | Effect/side effects
- 05-02 Flags: No current medication | Medication reconciliation completed | List unavailable — follow-up required (creates Task)
- 05-03 Reasons for non-adherence/discontinuation

### INT-06 — Allergies & Adverse Reactions
- 06-01 Carry forward central allergy object (DATA-04): No known allergies | Allergy status unknown | Known allergy/reaction — confirm/update
- 06-02 Grid: Substance/medicine | Reaction | Severity | Status/last confirmed
- Writing here updates the banner instantly (AT-01).

### INT-07 — Medical & Neurological History
- 07-01 Multi: No significant history known, Hypertension, Diabetes, Cardiac, Respiratory, Liver, Kidney, Neurological disorder, Epilepsy/seizures, Head injury/TBI, Chronic pain, Infectious disease, Pregnancy/postpartum concern, Other
- 07-02 Conditions, surgeries, hospitalisations · 07-03 Current physical symptoms/concerns
- 07-04 Primary care/medical provider · 07-05 Last medical review · 07-06 Relevant investigations/labs
- 07-07 Sexual/reproductive health concerns relevant to care: None disclosed | Yes | Not assessed/not applicable
- Show latest Triage vitals with time/source (TRI-CF-06).

### INT-08 — Substance Use & Addiction History
- 08-01 Grid rows: Alcohol, Cannabis, Opioids, Stimulants, Sedatives, **Nicotine**, Other × columns: Current?, Amount/pattern, Route, Age first use, Last use, Longest abstinence, Problems/withdrawal. Triage’s last use / pattern pre-fill the same row objects (TRI-CF-05); Nicotine is Intake-only.
- 08-02 Multi (dependence features): Tolerance, Craving, Loss of control, Withdrawal, Blackouts, Overdose history, Seizure history, Substance-related psychosis
- 08-03 Multi (consequences): Legal, Financial, Relationship, Work/school, Medical, Risky use
- 08-04 Previous detox, rehab, mutual-help/peer support, medication-assisted treatment, response
- 08-05 Motivation/readiness and current substance-use goal
- 08-06 Triggers: Withdrawal risk → PAWSS/configured predictor | Alcohol withdrawal → CIWA-Ar | Opioid withdrawal → COWS (same engine as TRI-G-TRIG; do not double-recommend a tool already recommended/completed)

### INT-09 — Family History
- 09-01 Family history of mental illness, suicide/self-harm, substance use, significant medical/neurological conditions
- 09-02 Family relationships and current involvement in care

### INT-10 — Developmental & Childhood History
- 10-01 Pregnancy/birth/developmental concerns: None known | Yes | Unknown
- 10-02 Milestones: Reported typical | Delay/concern | Unknown
- 10-03 Childhood learning/attention difficulties: None known | Yes
- 10-04 Childhood behavioural/emotional difficulties: None known | Yes
- 10-05 Primary caregivers/upbringing · 10-06 Narrative

### INT-11 — Trauma, Adversity, Grief & Loss (trauma-informed)
Ask only what is clinically necessary; do not require detailed recounting. Show inline guidance text to that effect.
- 11-01 Multi: No trauma disclosed, Childhood adversity, Physical violence, Sexual violence, Emotional abuse, Neglect, Domestic/IPV, Community violence, War/displacement, Accident/injury, Medical trauma, Sudden/traumatic loss, Other significant adversity
- 11-02 Brief, non-graphic history and current impact · 11-03 Grief/bereavement/unresolved losses
- 11-04 Triggers: Trauma symptoms identified → tenant-approved trauma assessment considered | Immediate safeguarding concern → safeguarding pathway

### INT-12 — Education, Employment & Financial
- 12-01 Highest education/current study · 12-02 Learning difficulties/SEN: None | Yes | Unknown
- 12-03 Current employment/occupation · 12-04 Status: Employed | Self-employed | Student | Unemployed | Retired | Other
- 12-05 Work/school impact · 12-06 Financial stress/debt/basic needs: None | Mild | Significant | Crisis
- 12-07 Narrative incl. strengths

### INT-13 — Relationships, Social Circumstances & Supports
- 13-01 Relationship/marital status · 13-02 Children/dependants
- 13-03 Living situation: Alone | Family | Partner | Shared | Residential/institutional | Unhoused/unstable | Other
- 13-04 Housing stability/safety: Stable/safe | Concern | Immediate problem
- 13-05 Main support people · 13-06 Social isolation: No | Some | Significant · 13-07 Caregiving responsibilities
- 13-08 Narrative

### INT-14 — Cultural, Spiritual, Identity & Communication
- 14-01 Preferred language · 14-02 Interpreter required: No | Yes · 14-03 Communication/literacy needs
- 14-04 Cultural considerations · 14-05 Spiritual/faith beliefs/practices · 14-06 Gender/identity considerations the client wants respected
- 14-07 What the team should understand about values, beliefs, identity, community

### INT-15 — Legal / Forensic
- 15-01 Multi: No known concerns, Current court matter, Probation/parole, Previous arrest/conviction, Violence-related matter, Substance-related matter, Mental Health Act/involuntary care history, Police involvement in current presentation, Other
- 15-02 Narrative and current obligations

### INT-16 — Mental Status Examination
Triage observations (TRI-F-03..05) pre-fill relevant domains labelled “Triage finding” with time/source.
| ID | Domain | Structured options |
|---|---|---|
| 16-01 | Appearance & self-care | Appropriate / Dishevelled / Unusual / Other |
| 16-02 | Behaviour & engagement | Calm/cooperative / Guarded / Withdrawn / Agitated / Disinhibited / Other |
| 16-03 | Psychomotor | Normal / Slowed / Increased / Restless / Abnormal movements |
| 16-04 | Speech | Normal / Reduced / Pressured / Rapid / Slow / Loud / Soft / Incoherent / Other |
| 16-05 | Mood (subjective) | Client’s description (text) |
| 16-06 | Affect (observed) | Appropriate / Restricted / Blunted / Flat / Labile / Anxious / Irritable / Elevated / Other |
| 16-07 | Thought form | Linear/goal-directed / Circumstantial / Tangential / Flight of ideas / Disorganised / Thought blocking / Other |
| 16-08 | Thought content | No abnormality / Hopelessness / Guilt / Preoccupation / Delusions / Obsessions / Suicidal / Homicidal / Other |
| 16-09 | Perception | No disturbance / Auditory / Visual / Other hallucinations / Illusions / Dissociation |
| 16-10 | Cognition | Alertness, orientation, attention, concentration, memory |
| 16-11 | Insight | Good / Partial / Limited / Absent |
| 16-12 | Judgement | Intact / Impaired / Difficult to assess |
| 16-13 | Impulse control | Intact / Reduced / Significantly impaired |
Each row has clinical notes. 16-14 MSE summary. **Thought content “Suicidal”/“Homicidal” must write into the risk objects and fire the INT-03 triggers.**

### INT-17 — Strengths, Protective Factors & Resources
- 17-01 Multi: Supportive relationships, Children/family responsibilities, Future goals, Faith/spirituality, Employment/education, Stable housing, Problem-solving skills, Treatment engagement, Reasons for living, Coping skills, Community connection, Previous recovery/success, Other
- 17-02 Client-identified strengths (“What has helped you get through difficult times before?”) · 17-03 Protective factors available now

### INT-18 — Client Perspective, Readiness & Shared Understanding
- 18-01 Client’s understanding of the problem
- 18-02 Readiness: Not ready | Unsure/ambivalent | Ready | Already taking action
- 18-03 Preferred approach/preferences
- 18-04 Barriers: None, Transport, Cost, Work/family, Stigma, Motivation, Cognitive/communication, Other
- 18-05 Consent for family/support involvement: Yes | No | Limited — specify (**feeds the consent model used by Documents, DOC-CI**)
- 18-06 What matters most to the client right now

### INT-19 — Clinical Formulation / Integrated Summary
- Not a repeat of history. Guide the clinician to connect: presenting problems, predisposing, precipitating, perpetuating, protective factors, risks, strengths (5P structure helper).
- 19-01 Integrated summary/formulation · 19-02 Working diagnosis (tenant-configured coding, e.g. ICD-11) · 19-03 Differential diagnoses/rule-outs
- The system must **not** auto-suggest diagnoses from symptom keywords.

### INT-20 — Assessment Tools Triggered / Completed
- Table: Assessment | Reason triggered | Status | Score/result | Date/time, rows from DATA-09 registry, populated automatically by triggers.
- **Developer rule:** no manual searching of a long library — findings recommend the tool; clinician confirms, modifies, or declines (decline audited).

### INT-21 — Clinical Impression & Initial Care Needs
- 21-01 Multi: Psychiatric review, Medical review, Detox/withdrawal management, Safety plan/enhanced observation, Psychological therapy, Inpatient admission, Residential rehabilitation, Outpatient care, Family intervention, Social work/case management, Nutrition/fitness, Referral/emergency transfer
- 21-02 Immediate priorities and rationale · 21-03 Recommended setting/level of care and rationale
- Selections feed Care Plan recommendations and pending-action queues (INT-DEV-10).

### INT-22 — Completion & Handover
- 22-01 Status: Complete | Partially complete — clinically safe to continue later | Unable to complete
- 22-02 Reason incomplete (required unless Complete)
- 22-03 Priority after intake — writes through the Priority object (override rules TRI-M-05 apply if changing a system recommendation)
- 22-04 Responsible clinician/team · 22-05 Pending assessments/actions (live from Tasks) · 22-06 Next review/handover
- 22-07 Key handover message — what the next clinician must know immediately
- 22-08 Clinician name/signature · 22-09 Date/time

### INT-DEV — Intake Implementation Rules
| ID | Rule |
|---|---|
| INT-DEV-01 | Pre-populate all Registration/Triage data; show source + date/time beside carried-forward findings |
| INT-DEV-02 | Structured fields wherever data drives alerts, assessments, care plans, outcomes, reporting, billing |
| INT-DEV-03 | Every important finding supports source, status (active/resolved/unknown), date/time, author/observer, audit history |
| INT-DEV-04 | Positive findings trigger assessment suggestions and care-plan recommendations without forcing tools |
| INT-DEV-05 | Allergies and critical alerts stay in the persistent banner |
| INT-DEV-06 | Risk changes update the active priority/risk display **immediately**, not on sign |
| INT-DEV-07 | Save-and-resume; a crisis must never be delayed by an exhaustive Intake (provide an always-available “Escalate now” action) |
| INT-DEV-08 | Sections collapsible/expandable and tenant-configurable; underlying meaning and shared objects unchanged |
| INT-DEV-09 | Multi-author: per-section status (Not started / In progress / Complete), author, completion time; supports single-clinician full completion too |
| INT-DEV-10 | Completion feeds Care Plan recommendations and pending-action queues |

---

## 6. Module: Document Generation (DOC)

**Objective:** an intelligent clinical documentation and communication system, not a collection of static Word templates. Reuse data safely, minimise duplicate entry, make disclosure purpose-specific, keep every output traceable to source data, author, authorization, and release event.

### DOC-UX — Navigation
`Documents → Select Category → Select Document → CITRAMAC Generates Draft`
- DOC-UX-01 Each document lives in **exactly one** primary category; tags/search may surface it elsewhere without duplicate templates.
- DOC-UX-02 Search across all documents by name and tag.
- DOC-UX-03 Example to implement end-to-end as the reference flow: *School & University → Academic Extension Request* — auto-retrieve demographics, institution, treatment dates, documented functional impact, clinician and facility details; ask only for recipient, extension period, whether diagnosis disclosure is authorized/necessary, optional clinician comment.

### DOC-WF — Generation Workflow (state machine)
`Clinical record → Trigger → Required data → Consent/disclosure check → Auto-populate → Clinician-specific input → AI draft → Human review/edit → E-signature/authorization → PDF/Print/Send → Copy filed in chart → Disclosure/audit log`

States: `DRAFT → IN_REVIEW → AUTHORIZED/SIGNED → RELEASED → FILED`, plus `BLOCKED_CONSENT`. Every transition is audited.

### DOC-CAT — De-duplicated Catalogue (assign IDs `DOC-<cat>-<nn>`)
1. **Work & Employment (WRK):** Medical certificate/sick-off note; Medical leave recommendation; Medical leave extension; Return-to-work letter; Graduated return-to-work plan; Workplace accommodation recommendation; Functional limitations report; Fitness-for-duty assessment/referral; Treatment/appointment attendance confirmation
2. **School & University (EDU):** Medical absence letter; Academic extension request; Examination deferment request; Medical leave from studies; Return-to-school/university letter; Academic accommodation recommendation; Reduced academic-load recommendation; Temporary withdrawal recommendation; Student reintegration/support plan; Referral to school/university counselling/support
3. **Referrals & Consultations (REF):** Intelligent clinical/specialist referral (destination dropdown: Psychiatrist, Psychologist, Physician, Addiction Specialist, Neurologist, Dietitian, Occupational Therapist, Physiotherapist, Social Worker, Family Therapist, Other Specialist); Emergency referral; Second-opinion request; Community/social-service referral; Higher-level-of-care referral
4. **Investigations & Diagnostics (INV):** Laboratory requisition; Toxicology/drug-screen requisition; Medication-monitoring investigations (dynamic by medication/indication); ECG request; Imaging/radiology request; Diagnostic results summary; Abnormal/critical result notification
5. **Medication (MED):** Prescription/e-prescription (where legally permitted and authorized); Current medication list; Medication reconciliation report; Medication administration record; Patient medication instructions; Medication change/discontinuation summary
6. **Admission & Treatment (ADM):** Admission confirmation; Admission/initial clinical summary; Treatment plan; Treatment-plan review; Treatment progress report; Multidisciplinary case summary; Programme/treatment participation confirmation; Treatment completion letter/certificate
7. **Transfer & Continuity (TRF):** Inter-facility transfer; Internal transfer/handover; Emergency transfer; Transfer to higher/lower level of care; Continuity-of-care clinical summary
8. **Discharge & Aftercare (DIS):** Discharge summary; Discharge instructions; Discharge medication list; Against-medical-advice discharge documentation; Follow-up/continuing-care plan; Relapse-prevention plan; Safety/crisis plan; Aftercare plan
9. **Consent & Information Sharing (CON):** General consent for treatment; Telemedicine consent; Specific procedure/testing consent; Consent to involve family/caregiver; Authorization to release medical information; Request/authorization to obtain medical information; Reciprocal exchange-of-information authorization; Consent to communicate with employer; Consent to communicate with school/university; Electronic communication consent; Withdrawal/revocation of consent
10. **Family & Caregiver (FAM):** Request for collateral information; Family meeting invitation; Family treatment/update communication; Family education/support letter; Caregiver/home-care instructions; Family reintegration plan
11. **Clinical Reports & Summaries (RPT):** Comprehensive clinical summary; Psychiatric/mental-health assessment report; Substance-use assessment report; Risk assessment report; Diagnostic summary; Progress summary; Outcome/ROM report; Chronological episode-of-care report
12. **Insurance, EAP & Funding (INS):** Preauthorization request; Medical-necessity/treatment justification; Continued-stay authorization request; Insurer clinical report; Claim-supporting clinical summary; Discharge notification; EAP participation/attendance report; Invoice/pro-forma/statement of services
13. **Legal, Statutory & Safeguarding (LEG):** Formal medical/clinical report; Court-requested report; Response to authorized legal information request; Safeguarding/protection report; Capacity assessment report; Statutory mental-health documentation; Serious incident/adverse-event report; Injury/accident report; Death-related clinical documentation
14. **Patient Communications (PAT):** Appointment confirmation/instructions; Welcome/orientation letter; Patient rights and responsibilities; Individual treatment schedule; Follow-up reminder; Missed-appointment communication; Lost-to-follow-up/re-engagement letter; Patient-requested record/summary cover letter

Implement the catalogue as **data** (JSON/TS registry), not as one component per document. Total: 14 categories, 108 document types — verify the count in the mockup.

### DOC-SPEC — Template Definition Schema (every template must carry all 10)
| # | Field | Requirement |
|---|---|---|
| 1 | `documentId` | Unique CITRAMAC code |
| 2 | `category` | Single primary category |
| 3 | `trigger` | When generated and purpose |
| 4 | `autoPopulated` | Field bindings to client record, assessments, treatment record, clinician profile, facility profile |
| 5 | `userEntered` | Only what cannot be safely/reliably derived |
| 6 | `conditionalRules` | IF/THEN rules controlling content, prompts, warnings, fields |
| 7 | `disclosureRules` | What may be disclosed, what needs authorization, when release is blocked |
| 8 | `authorization` | Roles allowed to generate / review / approve / sign |
| 9 | `outputs` | PDF, print, secure send/share, other approved |
| 10 | `filingAudit` | Storage location, version, author, approver, recipient, release date/time, disclosure log |

### DOC-CI — Conditional Intelligence (must be implemented as rule-engine cases)
- DOC-CI-01 Client currently admitted → admission dates/current episode populate where relevant
- DOC-CI-02 Diagnosis disclosure not authorized or not necessary → diagnosis excluded from external document
- DOC-CI-03 Risk relevant to clinical transfer → include current risk summary + immediate safety requirements
- DOC-CI-04 Recipient = employer → default to necessary functional information; exclude psychotherapy details and unnecessary diagnoses
- DOC-CI-05 Recipient = treating clinician → offer diagnoses, medications, allergies, investigations, recent assessments, risk — per clinical need and authorization
- DOC-CI-06 Required consent absent → **block external release** and prompt to obtain/document authorization
- DOC-CI-07 Medication-monitoring investigation → fields adapt to medication + indication (no static per-drug templates)
- DOC-CI-08 Referral destination selected → content and recommended fields adapt to receiving discipline

### DOC-GOV — Governance & Safety
- DOC-GOV-01 Generated documents remain drafts until reviewed and authorized by a credentialed user
- DOC-GOV-02 RBAC controls generate / edit / approve / sign / release per document type
- DOC-GOV-03 Sensitive MH and substance-use information is never disclosed merely because it exists in the EMR
- DOC-GOV-04 Consent status and disclosure scope checked before every external release
- DOC-GOV-05 Every final document carries: document ID/version, generation date/time, author, author credentials, facility, intended recipient/purpose, signature/authorization status
- DOC-GOV-06 Every release creates an auditable disclosure record in the chart
- DOC-GOV-07 Legal, statutory, safeguarding and other high-risk outputs require mandatory human review + any extra configured authorization
- DOC-GOV-08 Prescribing outputs restricted to credentialed prescribers and legal/organizational requirements

---

## 7. Module: Psychotherapy Session (PSY)

**Core principle:** reduce documentation burden without replacing clinical judgment. Organize, summarize, clarify — **never invent clinical information.**

### PSY-WF — Workflow
- PSY-WF-01 Clinician opens Psychotherapy Session
- PSY-WF-02 Context available to the generator: current treatment plan (goals), previous psychotherapy note, current risk status, active safety plan
- PSY-WF-03 Input mode: Speak (dictation) | Type — switchable per question
- PSY-WF-04 Five questions presented **one at a time** (stepper), answered naturally — no headings or formal language required
- PSY-WF-05 Mandatory safety question always completed
- PSY-WF-06 System organizes answers into structured note → clinician reviews, edits, confirms, signs

### PSY-Q — The Five Questions (fixed, model-independent)
1. **What did the client bring to the session today?** Since last session; struggles, concerns, what they want to work on.
2. **What did you notice or assess?** Emotions, thoughts, behaviour, functioning, relationships, symptoms, substance use, strengths, changes.
3. **What did you work on therapeutically?** Focus, interventions, therapy approach/model where relevant.
4. **How did the client respond?** Response, insight, difficulties, strengths, changes, progress toward goals.
5. **What happens next?** Next steps, between-session practice, treatment-plan changes, referrals/consultations, follow-up.

### PSY-S — Mandatory Safety Question (every session)
> “Was there any new or changed concern today regarding suicide, self-harm, harm to others, abuse or exploitation, severe deterioration, intoxication or withdrawal, inability to care for self, or another immediate safety concern?”

Options: **YES | NO | NOT ASSESSED**
- PSY-S-01 YES → raise `PSYCHOTHERAPY_SAFETY_CONCERN`, open/link appropriate risk assessment/safety workflow; updates the shared risk objects
- PSY-S-02 NO → note states no new or changed safety concern identified **based on today’s assessment**
- PSY-S-03 NOT ASSESSED → raise `SAFETY_NOT_ASSESSED` for clinician review before signing (sign requires explicit acknowledgement; see open questions)
- PSY-S-04 Unanswered → cannot proceed to sign

### PSY-RD — Automatic Risk Detection
- Scan spoken/typed answers for possible safety language (suicidal thoughts, self-harm, threats, abuse, unsafe at home, severe deterioration, significant intoxication/withdrawal, inability to self-care).
- Output is a **prompt only**: “Potential safety concern detected. Please review and complete the appropriate risk assessment.” Never label the client high-risk, never diagnose.
- If detection fires while safety answer = NO, surface the mismatch for clinician resolution before signing.
- Highlight the triggering passage. Detection lexicon is configurable data.

### PSY-TM — Therapy-Model Intelligence (configurable knowledge layer)
Seed models and concepts:
| Model | Concepts |
|---|---|
| CBT | Thoughts, emotions, behaviours, cognitive patterns, restructuring, behavioural strategies, coping skills |
| DBT | Emotion regulation, distress tolerance, mindfulness, interpersonal effectiveness, validation, skills practice |
| Motivational Interviewing | Ambivalence, change talk, sustain talk, readiness, values, autonomy, OARS |
| Seeking Safety | Safety, coping skills, trauma/substance connection, grounding, healthy relationships |
| Trauma-Focused CBT | Psychoeducation, coping skills, gradual trauma processing, cognitive coping, caregiver involvement |
| Schema Therapy | Schemas, modes, unmet emotional needs, triggers, coping responses, healthy-adult responses |
| Grief-Focused Therapy | Loss, grief responses, meaning, adjustment, continuing bonds, restoration |
| Supportive Psychotherapy | Validation, emotional processing, coping, strengths, problem solving, support |
- PSY-TM-01 Apply model language only when the clinician names/clearly describes the model and input supports it
- PSY-TM-02 Multiple models per session allowed; never force a single model
- PSY-TM-03 **Not hard-coded:** models are a registry (id, name, concepts, version, enabled per tenant) that can be extended without changing the workflow or the five questions

### PSY-GEN — Note Generation Rules (also the system prompt for the generator)
1. Organize and summarize only what the clinician provides.
2. Clear, professional, respectful, non-stigmatizing language.
3. Separate client-reported content from clinician-observed/assessed content.
4. Connect interventions to treatment goals only when supported by the record.
5. Recognize progress, deterioration, barriers, meaningful change across sessions.
6. Never invent symptoms, observations, risk findings, diagnoses, MSE findings, or interventions.
7. Never turn omission into a negative finding (risk not assessed ≠ “client denies suicidal ideation”).
8. Never diagnose from keywords.
9. Keep clinically relevant; omit unnecessary personal detail.
10. Output fully editable before signing.
11. Trauma-informed, behavioural descriptions over labels — e.g. not “manipulative” but “repeatedly requested a change to the agreed plan and expressed frustration when this was not possible”; not “non-compliant” but “reported difficulty following the agreed plan and identified transportation and cost as barriers.” Flag stigmatizing terms in clinician input with a suggested rewrite.

### PSY-OUT — Required Note Sections (in order)
1. Session Information — date, time, duration, clinician, session type, in-person/virtual, other encounter details
2. Presenting Focus / Client Report
3. Clinical Assessment / Observations
4. Therapeutic Focus & Interventions (model(s) where supported)
5. Client Response & Progress
6. Risk & Safety — findings, actions, links to risk assessment/safety plan
7. Plan — actions, between-session practice, plan changes, referrals, follow-up

### PSY-LINK — Clinical Journey
`Assessment → Treatment Plan → Psychotherapy Session → Progress/Outcomes → Updated Plan`. The system may *suggest* that a session finding represents progress toward a named goal (e.g. healthier coping during relationship conflict); the clinician must confirm or edit.

### PSY-SIGN — Review & Sign-Off
- Every generated note initially watermarked **DRAFT — CLINICIAN REVIEW REQUIRED**
- Clinician edits, confirms accuracy, signs; signed note is immutable — later changes are audited amendments

## 7A. Module: Legal Admission Status — Voluntary & Involuntary Admission (LGL)

**Source forms:** CAfRIC *Application for Voluntary Admission* and CAfRIC *Involuntary Admission Form* + *Recommendation for Involuntary Treatment Form* (Republic of Kenya). These are the first jurisdiction-specific statutory documents. They belong to DOC category 13 (*Statutory mental-health documentation*) as concrete templates, **and** they drive a structured `LegalStatus` object on the episode. They are not static PDFs to be filled.

**Tenant/jurisdiction context:** tenant `CAfRIC International`, jurisdiction `KE`. Seed the facility profile from the form footers. The two forms carry **different addresses**: *Lake Bogoria Avenue, Golf-View Estate, Murang’a County* (involuntary) vs *Githingiri Estate, Murang’a County* (voluntary). Both use P.O. Box 31502-00600 Nairobi, info@cafric.org, www.cafric.org. Phones: +254 793 888 475, +254 768 489 345, +254 768 665 921. Model the facility profile with one canonical address and log the discrepancy as OQ-13. Logo and letterhead come from the tenant asset store, never hard-coded.

### LGL-DATA — Legal Status Object (one per episode, shared)
```ts
type AdmissionLegalCategory = 'VOLUNTARY' | 'INVOLUNTARY';
type AdmissionDecision = 'PENDING' | 'ADMITTED' | 'REJECTED';

interface LegalStatus {
  id: string; clientId: string; episodeId: string; tenantId: string;
  jurisdiction: 'KE';
  category: AdmissionLegalCategory;
  statutoryBasis: StatuteRef[];        // from jurisdiction config, never free text
  applicationDocumentId: string;       // DOC record of the signed application
  recommendationDocumentIds: string[]; // involuntary only
  decision: AdmissionDecision;
  decisionBy?: UserRef;                // admitting officer
  decisionAt?: string;
  decisionReason?: string;             // required when REJECTED
  effectiveFrom?: string;
  maxExpiryAt?: string;                // involuntary: recommendation date + configured max (form: ≤ 6 months)
  dischargeNotice?: DischargeNotice;   // voluntary only
  status: 'ACTIVE' | 'EXPIRED' | 'DISCHARGED' | 'CONVERTED' | 'REVOKED';
  history: AuditEntry[];
}

interface DischargeNotice {             // voluntary 72-hour written notice
  givenAt: string;
  givenTo: UserRef;                    // "person in charge"
  writtenNoticeDocumentId: string;
  noticePeriodHours: number;           // jurisdiction config; form text = 72
  earliestDepartureAt: string;         // givenAt + noticePeriodHours
  withdrawnAt?: string;
}

interface StatuteRef { act: string; section: string; versionLabel: string; }
```
- LGL-DATA-01 Legal status is displayed in the banner next to BAN-04 (e.g. “INPATIENT — VOLUNTARY” / “INPATIENT — INVOLUNTARY, expires 2027-04-14”). It is never colour-only.
- LGL-DATA-02 Any change to category, decision, notice, or expiry is an audited event on the same object (RULE-02, RULE-09).
- LGL-DATA-03 Statute citations, section numbers, notice periods and maximum durations live in versioned **jurisdiction config**. The form wording cites these, and the UI renders them verbatim from config.

### LGL-V — Application for Voluntary Admission
Header as printed: *THE MENTAL HEALTH ACT 1989 (NO. 10 OF 1989, SECTION 10 (1)) — APPLICATION FOR VOLUNTARY ADMISSION*

| ID | Element | Behaviour |
|---|---|---|
| LGL-V-01 | Explanatory text: every person who wants inpatient treatment signs this form to show admission is at their own will or request | Static text from jurisdiction config |
| LGL-V-02 | Section 10(3) notice, quoted: “Any person received as a voluntary patient under this section may leave the mental hospital upon giving to the person in charge a seventy-two-hour notice in writing of his/her intention to leave.” | Shown prominently. The applicant must acknowledge it (checkbox + timestamp) before signing. The form says it is there “to avoid any misconception at later stages” |
| LGL-V-03 | “I [Full Names] of [Address]” | Auto-populate from central client record (RULE-01). Editable only by updating the client record, which is audited |
| LGL-V-04 | Declaration: desire voluntarily to submit myself for treatment as an inpatient at **CAfRIC Centre** and agree to conform to all existing and future rules and regulations for the conduct of the hospital | Facility name from tenant facility profile |
| LGL-V-05 | Signature of the Applicant | E-signature, or captured wet signature (scan upload). Records signer identity, method, timestamp |
| LGL-V-06 | **Applicant signature date** | Not on the paper form. Add AUTO timestamp (ASSUMPTION, OQ-14) |
| LGL-V-07 | Official use: Admitted / Rejected | Writes `LegalStatus.decision`. Rejected requires a reason (ASSUMPTION, mirrors TRI-M-05) |
| LGL-V-08 | Name of the Admitting Officer | AUTO from login; role must hold `ADMITTING_OFFICER` permission |
| LGL-V-09 | Admitting Officer Signature | E-signature |
| LGL-V-10 | Date | AUTO |
| LGL-V-11 | Capacity gate | The form presumes the client can consent voluntarily. If an active finding exists (TRI-F altered consciousness, severe intoxication, disorientation; INT-16 cognition/insight impaired), show “Capacity to consent to voluntary admission — clinician confirmation required” and record the confirmation. Do **not** auto-block (RULE-05) |
| LGL-V-12 | Minor client | If age < 18, block self-application and route to guardian/consent workflow (ASSUMPTION, OQ-15) |

**LGL-V-WF — 72-hour discharge notice workflow**
1. Patient gives written notice → create `DischargeNotice` with the uploaded or e-signed written notice (it must be in writing, per the quoted provision).
2. System computes `earliestDepartureAt = givenAt + noticePeriodHours` and shows a live countdown in the banner.
3. Tasks are created (DATA-06): psychiatric review before departure; discharge planning (DIS documents: discharge summary, discharge medication list, follow-up/continuing-care plan, safety/crisis plan where risk active).
4. If an active risk alert exists at notice time or appears during the notice period, prompt “Clinical review of legal status required.” **No automatic conversion to involuntary.** Conversion is a clinician-initiated LGL-I workflow (OQ-16).
5. Notice withdrawn → `withdrawnAt` recorded, countdown cleared, audit entry written.
6. Departure before notice expiry against advice → route to *Against-medical-advice discharge documentation* (DOC-DIS).

### LGL-I — Involuntary Admission Form (applicant-initiated)
Header as printed: *INVOLUNTARY ADMISSION FORM — Republic Of Kenya Mental Health Act (Cap 248)*

**Part A — Details of the Client**
| ID | Field | Behaviour |
|---|---|---|
| LGL-I-A-01 | Full Name | Auto-populate from client record |
| LGL-I-A-02 | National ID/Passport No | Auto-populate. If missing, capture into the **central** identity record, never a form-local field |
| LGL-I-A-03 | Gender: Male / Female / Other (specify) | Auto-populate from the central sex/gender fields. Do not create a duplicate (RULE-01). Map form options to the central model |
| LGL-I-A-04 | Client is (multi): A danger to self / A danger to others / Unable to care for self / Incapable of making rational decisions regarding treatment / Other (Describe) | Applicant’s assertion, stored as `THIRD_PARTY_REPORT` (sourceDetail = applicant). Beside each option, show linked existing findings as **evidence context**: danger to self → Suicide/Self-Harm finding (TRI-D, INT-03-01); danger to others → TRI-E, INT-03-02; unable to care for self → TRI-J, INT-03-03; incapable of rational decisions → MSE insight/judgement (INT-16-11/12). Do not auto-tick from findings. The applicant’s statement and the clinical findings stay separate |
| LGL-I-A-05 | Other (Describe) | Required free text if Other ticked |

**Part B — Details of the Applicant**
| ID | Field | Behaviour |
|---|---|---|
| LGL-I-B-01 | Full Name | Applicant is a `RelatedPerson` linked to the client. If the applicant is already the emergency contact/NOK (TRI-A-04), pre-fill from that record |
| LGL-I-B-02 | National ID/Passport No | Stored on the RelatedPerson |
| LGL-I-B-03 | Address | Stored on the RelatedPerson |
| LGL-I-B-04 | Phone Number | Stored on the RelatedPerson; validate E.164 (+254…) |
| LGL-I-B-05 | Relationship to Client | Coded value + free-text detail |

**Declaration by Applicant**
| ID | Element | Behaviour |
|---|---|---|
| LGL-I-D-01 | “I, the undersigned, declare that the information provided above is true and accurate to the best of my knowledge and belief. I hereby apply for the involuntary admission of [client] (the above-named client) under the provisions of the Mental Health Act (Cap 248).” | Static text from config; client name auto-inserted |
| LGL-I-D-02 | Applicant’s Signature | E-sign or captured wet signature |
| LGL-I-D-03 | Date | AUTO |

**For Official Use Only**
| ID | Element | Behaviour |
|---|---|---|
| LGL-I-O-01 | Admitted / Rejected | Writes `LegalStatus.decision`. **Cannot be set to ADMITTED until LGL-R is signed** (ASSUMPTION, OQ-17). Rejected requires a reason |
| LGL-I-O-02 | Name of the Admitting Officer | AUTO from login, `ADMITTING_OFFICER` role |
| LGL-I-O-03 | Signature of Admitting Officer | E-signature |
| LGL-I-O-04 | **Decision date/time** | Not on the paper form. Add AUTO (ASSUMPTION, OQ-14) |

### LGL-R — Recommendation for Involuntary Treatment (medical practitioner)
| ID | Element | Behaviour |
|---|---|---|
| LGL-R-01 | “I, [practitioner name]” | AUTO from the logged-in practitioner profile |
| LGL-R-02 | Declaration 1: I am a registered medical practitioner approved by the Medical Regulatory Body for the purpose of making recommendations under the Mental Health (Amendment) Act, 2022 | **Credential gate.** Only users whose profile has a verified registration number **and** the `MHA_RECOMMENDATION_APPROVED` flag can open/sign. Show registration number and verification date on the output |
| LGL-R-03 | Declaration 2: I examined the said [client] on the [day] day of [month], 20[yy] | Client auto-inserted. Examination date is required, cannot be in the future, and should link to an existing clinical encounter (MSE/Intake/psychiatric review) for the same client |
| LGL-R-04 | Declaration 3 grounds: (a) the said [client] is suffering from a mental illness as defined under Section 2 of the Mental Health (Amendment) Act, 2022; (b) the individual is incapable of expressing willingness or unwillingness to receive treatment as per Section 18; (c) the individual is likely to benefit from involuntary admission as per Section 19 | Each ground is an **individually affirmed** checkbox. All three are required to sign. Add a required **clinical grounds narrative** per ground. The printed form has no space for the factual basis; flag this as OQ-18 and implement the narrative as an ASSUMPTION |
| LGL-R-05 | Declaration 4 (further declare): the said [client] is suffering from a mental illness (Section 2); is likely to benefit from involuntary admission (Section 19); is incapable of making informed decisions regarding their treatment (Section 18) | Rendered verbatim. It restates Declaration 3 with **different Section 18 wording** (“expressing willingness or unwillingness” vs “making informed decisions”). Keep both texts as printed. Do not merge them. Log as OQ-19 |
| LGL-R-06 | Declaration 5: it is expedient for the recovery of the said [client] that he/she should be received in a mental health facility for a period not exceeding six months, in accordance with the Mental Health Act | Client auto-inserted; pronoun from the client record or neutral “they” (OQ-20). The system sets `LegalStatus.maxExpiryAt = effectiveFrom + configured max (6 months)` and schedules review Tasks before expiry (review cadence is configurable) |
| LGL-R-07 | Signature | E-signature of the credentialed practitioner |
| LGL-R-08 | Medical Qualifications | AUTO from the practitioner profile |
| LGL-R-09 | Date | AUTO |
| LGL-R-10 | Admitted / Rejected (as printed on this form) | Render it as a **read-only mirror** of `LegalStatus.decision` set by the admitting officer (LGL-I-O-01). The practitioner must not set the admission decision here. Log as OQ-21 |
| LGL-R-11 | Clinical evidence panel | Beside the declarations, show the current Suicide/Self-Harm, Risk to Others, Functional Safety, MSE and working diagnosis findings with source/date/time (RULE-03/04). Read-only context; nothing is auto-asserted |
| LGL-R-12 | Single vs multiple recommendations | The form supports one practitioner. Model `recommendationDocumentIds[]` as an array and make the required count a jurisdiction config value (default 1, OQ-22) |

### LGL-WF — Involuntary Admission State Machine
`APPLICATION_DRAFT → APPLICATION_SIGNED (LGL-I) → RECOMMENDATION_SIGNED (LGL-R ×N) → DECISION (ADMITTED | REJECTED) → ACTIVE → REVIEW_DUE → (RENEWED | DISCHARGED | CONVERTED_TO_VOLUNTARY | EXPIRED)`
- LGL-WF-01 Every transition is audited, with actor, role and timestamp.
- LGL-WF-02 ADMITTED creates the `LegalStatus`, updates the banner, and sets the priority review Task.
- LGL-WF-03 Approaching `maxExpiryAt` (configurable lead time) creates a high-priority Task for the responsible psychiatrist. Expiry without a recorded decision raises a `LEGAL_STATUS_EXPIRED` alert.
- LGL-WF-04 Conversion involuntary → voluntary requires a new signed LGL-V application.
- LGL-WF-05 Rights information: the form states that the Act “safeguards the rights of persons experiencing mental illness.” Add a Task “Patient informed of rights and legal status” with completion timestamp (ASSUMPTION, OQ-23). Do not invent rights text; render it from jurisdiction config.
- LGL-WF-06 Add alert codes to DATA-07: `INVOLUNTARY_STATUS`, `LEGAL_STATUS_EXPIRING`, `LEGAL_STATUS_EXPIRED`, `DISCHARGE_NOTICE_ACTIVE`.

### LGL-DOC — Document Governance for These Forms
- LGL-DOC-01 Register three templates in DOC-CAT category 13: `DOC-LEG-STAT-VOL-KE`, `DOC-LEG-STAT-INV-APP-KE`, `DOC-LEG-STAT-INV-REC-KE`. Each carries the full 10-field DOC-SPEC.
- LGL-DOC-02 They are legal/statutory high-risk outputs, so mandatory human review applies (DOC-GOV-07). Signing permissions: applicant = client or RelatedPerson; recommendation = credentialed practitioner only; decision = admitting officer only.
- LGL-DOC-03 PDF output reproduces the printed layout: letterhead logo, title block, statute line, numbered parts, dotted-line field rendering (filled), “FOR OFFICIAL USE ONLY” rule, footer from the facility profile. Add a document ID/version and generation timestamp in the footer (DOC-GOV-05).
- LGL-DOC-04 Signed versions are immutable. Corrections are amendments with reason. Superseded versions are retained.
- LGL-DOC-05 Release of these documents (e.g. to court, a receiving facility, the family) follows DOC-CI-06 consent/authorization checks and creates a disclosure record (DOC-GOV-06).
- LGL-DOC-06 Data protection: identity numbers (National ID/Passport) are masked in the UI except for authorized roles. Log every unmasked view (jurisdiction privacy rules as config, OQ-24).

---

## 8. Cross-Cutting Requirements (X)

| ID | Requirement |
|---|---|
| X-01 | **Multi-tenancy:** tenant config object controls section visibility/order, enabled assessment tools, vital-sign thresholds, safeguarding pathway, queues/response times, document templates enabled, therapy models enabled, diagnosis coding system. Clinical meanings and shared objects are not configurable (RULE-08). Include a tenant switcher in the mockup to prove it. |
| X-02 | **RBAC (demo roles):** Reception/Registration, Nurse, Triage clinician, Psychiatrist (prescriber, `MHA_RECOMMENDATION_APPROVED`), Medical officer (non-approved, for negative tests), Admitting officer, Psychologist/Therapist, Social worker, Admin, Records/Release officer. Enforce generate/edit/approve/sign/release permissions and prescribing restrictions. Include a role switcher. |
| X-03 | **Audit viewer:** per finding and per document, a history panel showing every `AuditEntry` (who/what/when/previous → new/reason). |
| X-04 | **Pending-work view:** per client and per team — open Tasks, recommended-but-unconfirmed assessments, unsigned drafts, `SAFETY_NOT_ASSESSED` flags, owner, priority, age. Satisfies RULE-10 / AT-06. |
| X-05 | **Priority queue:** tenant-level list sorted by priority then wait time; colours + text labels. |
| X-06 | **Accessibility:** WCAG 2.2 AA — keyboard operable, visible focus, semantic form controls with labels, priority never conveyed by colour alone, sufficient contrast, ARIA live region for new alerts. |
| X-07 | **Mutually exclusive options** (“None”, “No known”, “None identified”) clear and disable positive options in the same group, and vice versa. |
| X-08 | **Conditional rendering** follows branching rules exactly (TRI-B-08, TRI-D-02, TRI-B-06, INT-22-02); hidden fields are not submitted. |
| X-09 | **Save-and-resume** with explicit draft state and timestamp for Triage, Intake, Psychotherapy, Documents. |
| X-10 | **Escalate now:** always-available action from any form that opens TRI-N emergency actions without completing the form. |
| X-11 | **No PHI in logs/console;** demo data visibly marked synthetic. |
| X-12 | **Speech input:** use the Web Speech API where available with graceful fallback to typing; dictated text is editable before submission. |
| X-13 | **AI generation in mockup:** if the mockup calls an LLM, the generator prompt must embed PSY-GEN / DOC-CI / DOC-GOV verbatim and return structured JSON per section; otherwise implement a deterministic template-based organizer behind the same interface. |

---

## 9. Acceptance Tests (AT) — build is not accepted unless all pass with zero duplicate data entry

| ID | Scenario | Pass criteria |
|---|---|---|
| AT-01 | Reception records an allergy at Registration | Immediately visible in banner, Triage (TRI-A-06), Intake (INT-06); same object ID |
| AT-02 | Triage records current suicidal thoughts | Intake INT-03 shows the same finding with source/date/time and offers Confirm/Update/Add — no re-entry field |
| AT-03 | Triage identifies alcohol withdrawal risk | PAWSS (or configured predictor) recommended automatically; CIWA-Ar if current alcohol withdrawal; COWS if opioid withdrawal; visible in INT-20 |
| AT-04 | Assessment score stored once | Care Plan receives result automatically and displays why the action was recommended |
| AT-05 | Clinician overrides system priority | Override blocked without reason; reason, clinician, date/time recorded in audit |
| AT-06 | Different clinician opens record | Current risk, priority, alerts, pending actions and ownership understandable without opening any form |
| AT-07 | A finding is updated | Previous value preserved in audit trail, viewable in X-03 |
| AT-08 | Client not present | Observation/vitals fields hidden; Section K shown; third-party findings fire the same triggers with `THIRD_PARTY_REPORT` source |
| AT-09 | Risk changed mid-Intake, unsigned | Banner priority/alerts update immediately |
| AT-10 | Employer letter generated without employer-communication consent | External release blocked (DOC-CI-06); prompt to obtain consent |
| AT-11 | Employer letter with consent, diagnosis disclosure not authorized | Only functional information; no diagnosis, no psychotherapy content |
| AT-12 | Non-prescriber attempts prescription | Action unavailable (DOC-GOV-08) |
| AT-13 | Document released | Disclosure record created with document ID/version, recipient, purpose, releaser, timestamp |
| AT-14 | Psychotherapy note, safety = NOT ASSESSED | Note does **not** contain any denial statement; `SAFETY_NOT_ASSESSED` flag blocks sign until acknowledged |
| AT-15 | Psychotherapy input mentions “thoughts of ending it” with safety = NO | Risk-detection prompt fires; mismatch must be resolved before signing; no auto-risk label |
| AT-16 | Clinician names CBT and DBT in Q3 | Both models’ language used only for supported content; note not forced into one model |
| AT-17 | New therapy model added to registry | Available in module with no change to workflow code or questions |
| AT-18 | Generated psychotherapy note | Marked DRAFT — CLINICIAN REVIEW REQUIRED; all 7 sections; editable; signed version immutable with amendment trail |
| AT-19 | Tenant B disables a section/tool | Section/tool hidden for Tenant B only; shared objects and priority meanings unchanged |
| AT-20 | Triage summary | TRI-L table generated with no retyping; every row has source, status, time, recorder |
| AT-21 | Voluntary admission signed without acknowledging the 72-hour notice | Sign blocked until LGL-V-02 acknowledgement is recorded |
| AT-22 | Voluntary patient gives written notice | Countdown in banner = 72h from notice; psychiatric review + discharge planning Tasks created; no automatic status conversion |
| AT-23 | Involuntary application Part A “danger to self” with an existing Triage suicide finding | Finding shown as evidence context; tick stored as THIRD_PARTY_REPORT from applicant; finding not altered |
| AT-24 | Non-approved medical officer opens LGL-R | Signing unavailable; reason shown |
| AT-25 | Admitting officer tries to set ADMITTED before LGL-R is signed | Blocked |
| AT-26 | Involuntary admission ADMITTED | LegalStatus created, banner shows INVOLUNTARY + expiry ≤ 6 months, expiry-review Task scheduled |
| AT-27 | Rejection on any admission form | Reason required; audited |
| AT-28 | Applicant is the existing NOK | Part B pre-filled from the RelatedPerson record; no duplicate person created |
| AT-29 | Generated statutory PDF | Matches printed layout, carries document ID/version, footer from facility profile, immutable after signing |
| AT-30 | Minor attempts voluntary self-application | Routed to guardian/consent workflow |

---

## 10. VERIFY Phase — Procedure and Output

1. Inventory the mockup: pages/routes, components, forms, fields (with labels and option sets), state handling, data models, scripts, styling, any LLM calls.
2. Map each mockup element to requirement IDs. Map each requirement ID to mockup evidence (file + line/selector).
3. Classify every requirement:
   - `PASS` — present and behaves as specified
   - `PARTIAL` — present but missing options/behaviour/source/audit
   - `FAIL` — present but contradicts spec (e.g. duplicate field for a shared object, colour-only priority, auto-confirmed actions)
   - `MISSING` — absent
   - `N/A-STATIC` — cannot be demonstrated in current static form; state what layer is required
4. Specifically hunt for **anti-patterns**: duplicate fields for the same clinical concept across stages; priority captured as free checkboxes instead of a single object; actions as free text; missing source/time chips; diagnosis keyword suggestion; omission rendered as denial; hard-coded therapy models or document templates; per-medication static templates; release without consent check.
5. Produce `VERIFICATION_REPORT.md` at repo root containing:
   - Executive status: counts per classification per module (BAN, TRI, INT, DOC, PSY, LGL, DATA, RULE, X, AT)
   - Full traceability matrix: `ID | Requirement (short) | Status | Evidence (file:line / selector) | Gap | Fix plan`
   - Option-set diff: for every enumerated field, list missing/extra/mislabelled options vs. this spec
   - Anti-pattern findings with severity (Critical = patient-safety or disclosure risk; High = data integrity; Medium = workflow; Low = cosmetic)
   - Acceptance test dry-run: AT-01…AT-30 result against current mockup
   - Open questions and assumptions
6. In `RUN_MODE = VERIFY`, stop after the report. Do not modify source files.

## 11. BUILD Phase — Procedure

1. Fix order: Critical → High → Medium → Low. Within that: DATA layer → BAN → TRI → INT → LGL → PSY → DOC → X.
2. Build the domain layer first (DATA-01…09, alert/trigger engine, priority engine, consent engine, audit service, task service, tenant config, RBAC), then wire UI to it.
3. All registries are data files: option sets, assessment tools, trigger rules, priority rules, document catalogue + template specs, therapy models, risk-detection lexicon, tenant configs.
4. Seed a synthetic scenario covering every AT (include a CAfRIC/KE tenant with one voluntary inpatient who gives 72-hour notice, and one involuntary admission with family applicant, approved psychiatrist recommendation, and admitting-officer decision): e.g. client registered with penicillin allergy → telephone triage by family member → in-person re-triage with suicidal thoughts + recent heavy alcohol cessation → Intake by second clinician → psychotherapy session → employer letter (blocked, then consented) → transfer summary with risk.
5. Add automated tests (use the repo’s test tooling; if none, add a lightweight runner such as Vitest + Testing Library or Playwright for E2E) implementing AT-01…AT-30 by ID.
6. Commit in small, ID-referenced commits. Re-run the VERIFY procedure at the end and update `VERIFICATION_REPORT.md` to show final status; every non-PASS item must have a justification.

## 12. Known Gaps in the Source Specifications — Raise as Open Questions, Do Not Silently Decide

| ID | Gap | Default you implement until answered |
|---|---|---|
| OQ-01 | No mapping from findings to RED/ORANGE/YELLOW/GREEN | Conservative demo ruleset, labelled as requiring clinical governance sign-off (TRI-M-07) |
| OQ-02 | Vital-sign abnormal/critical thresholds not defined | Tenant config with clearly labelled demo values |
| OQ-03 | “Positive significant finding” for TRI-D not precisely defined | Any Yes/Unsure/Unable-to-determine on D-01, D-02, D-03, D-05=Yes, D-06≠Yes fires the trigger |
| OQ-04 | Withdrawal-sign checklist in source mixes “Current withdrawal” header with options | Implemented as a multi-select with “None” exclusive |
| OQ-05 | Triage substance grid lacks Nicotine; Intake includes it | Nicotine row is Intake-only, same substance object model |
| OQ-06 | PSY NOT ASSESSED: “flag for review before signing” — block or warn? | Block until explicit acknowledgement with reason |
| OQ-07 | Alert resolution policy (“according to policy”) undefined | Manual resolution by authorized role with mandatory reason |
| OQ-08 | Assessment tool content (PHQ-9, CIWA-Ar, COWS, PAWSS, etc.) — licensing and item sets not supplied | Render as tool shells (name, status, score entry, interpretation); do not reproduce copyrighted instruments without confirmed licence |
| OQ-09 | Registration module referenced but not specified | Minimal Registration screen covering fields Triage consumes (TRI-A-01…08) |
| OQ-10 | Care Plan, Risk Assessment, Safety Plan, Interventions, Outcomes views referenced but not specified | Read-only views proving data flows (AT-04, DATA-01); full specs pending |
| OQ-11 | Jurisdiction (consent law, statutory MH documentation, e-prescribing legality) | Rules modelled as tenant/jurisdiction config, no jurisdiction-specific legal text invented beyond the verbatim text of supplied forms |
| OQ-12 | **Statute citation inconsistency.** The voluntary form cites *Mental Health Act 1989 (No. 10 of 1989) s.10(1)/(3)*. The involuntary forms cite *Mental Health Act (Cap 248)* and *Mental Health (Amendment) Act, 2022* ss.2, 18, 19. The voluntary form may predate the 2022 amendment | Render each form’s citations exactly as printed, from versioned config; flag for Kenyan legal counsel to confirm current sections, terminology and notice period before go-live |
| OQ-13 | Facility address differs between the two forms (Golf-View Estate vs Githingiri Estate) | One canonical facility profile; ask which is current |
| OQ-14 | Paper forms lack applicant-signature date (voluntary) and decision date/time (both) | AUTO timestamps added |
| OQ-15 | No minor/guardian pathway on the voluntary form | Block self-application under 18; route to guardian consent |
| OQ-16 | No defined pathway when a voluntary patient at risk gives notice | Clinician review prompt only; conversion is a manual LGL-I workflow |
| OQ-17 | Order of operations (application → recommendation → decision) not stated | Decision requires a signed recommendation |
| OQ-18 | Recommendation form has no space for the factual clinical basis of each ground | Required narrative per ground |
| OQ-19 | Declarations 3 and 4 duplicate each other with differing Section 18 wording | Render both verbatim |
| OQ-20 | “he/she” wording | Pronoun from client record, else “they” |
| OQ-21 | “Admitted/Rejected” on the practitioner’s recommendation form | Read-only mirror of admitting officer’s decision |
| OQ-22 | Number of medical recommendations required | Config, default 1 |
| OQ-23 | Patient rights notification not on forms | Task added; rights text from config only |
| OQ-24 | Kenyan data-protection obligations for ID numbers and MH records | Masking + access logging; confirm requirements with counsel |

---

## 13. Response Format for This Run

- Start with a one-paragraph statement of what you found in the repo (stack, structure, size).
- Then deliver according to `RUN_MODE`: the verification report, or the build with a change log grouped by requirement ID, or both in sequence.
- End with the open-questions table updated with anything new you discovered.
- Do not summarise this prompt back to me.
