# 15 — Clinical Workspace v3 (approved mockup, 2026-10-07)

Source of truth: `mockups/citramac_clinical_workspace.html` (copied from the approved
`Updated_Citramac_system.html`). This file replaces the 2026-09 clinical mockup. The mockup will
keep changing; update this document in the same commit as any mockup change.

This document has three parts:

1. **Capture** — every screen, field, option, rule and state transition in the mockup.
2. **Conformance conflicts** — places where the mockup, taken literally, would break `CLAUDE.md`.
3. **Resource mapping** — the FHIR R4 mapping per feature. **Confirmed by the project owner on
   2026-10-07** ("this is what is agreed and confirmed"), together with the instruction to rebuild
   the backend as needed and keep every screen the mockup leaves out.

Build status per screen is tracked in §4.

---

## 1. Capture

### 1.1 Shell

**Sidebar** (248px expanded, 76px icon rail; green gradient `#00503a → #003f2e`). Replaced on
2026-10-08 by the grouped navigation of the updated mockup (`Updated_Citramac_system.html`, now
`mockups/citramac_clinical_workspace.html`); the 2026-10-07 flat list and its "Other clinical
modules" group are gone.

- Brand block: square icon, wordmark **CITRAMAC**, sub-label **HMIS v2.0**.
- Nav, in this exact order. Groups marked ▾ start open; every other group starts collapsed and
  **opens itself when the current route is inside it** (a group the user collapsed by hand stays
  collapsed until they navigate to another screen in it):
  1. Dashboard — `/clinical`
  2. My Caseload — `/clinical/caseload`
  3. **Clinical** ▾: Registration · Triage · Psychiatric · Supervision requests
  4. **Psychotherapy** ▾: Individual · Family · Group Psychotherapy
  5. **Inpatient & residential**: Admissions · Ward board · Discharge planning
  6. **Pharmacy & medication**: Medication orders & review · Medication administration
  7. **Laboratory**: Laboratory records
  8. **Appointments & follow-up**: Appointments · Follow-up
  9. **Referrals**: Referral worklist · Referral documents
  10. **Reports & analytics**: Operational overview · NACADA report
  11. Documents
  12. Billing
- Owner decisions, 2026-10-08: NACADA report sits under Reports & analytics and Supervision
  requests under Clinical (both kept); Referral worklist / Referral documents reuse the Psychiatric
  queue and Documents screens on their own routes (`/clinical/referrals`,
  `/clinical/referrals/documents`) so two nav items never light up at once; count badges seen in a
  screenshot are not part of the mockup and are not built.
- **Audit log is not in this sidebar.** It is an Org Admin and Auditor screen on the Org Admin side
  (`/org-admin/audit-log`, Governance). Clinicians never see it and the API refuses them. See
  docs/17.
- Footer: avatar initials, user name, role (e.g. "J. Njoroge, RN / Triage Nurse").
- Rail mode hides labels, section labels, group labels, chevrons and sub-menus.

**Workspace behaviour (added 2026-10-08)**

- *Client search*: the topbar search finds clients by name, phone, ID or CITRAMAC number (debounced;
  Up/Down, Enter, Esc) and opens the client's record. Ctrl+K (⌘K) focuses it from any screen. Results
  show names, numbers and dates of birth only. The Org Admin and Super Admin topbar search boxes are
  still plain, non-working inputs.
- *Selected client*: screens that work on one client (pharmacy, medication administration,
  laboratory, supervision, clinical review, encounter, client history, admission) show a client
  picker when none is chosen — they no longer redirect to the Client Registry — and the safety
  banner with a "Change client" link once one is. The selection is held **in memory only**
  (CLAUDE.md §5; it used to be kept in `sessionStorage`); a reload or sign-out forgets it.
- *Keyboard and focus*: a "Skip to main content" link; dialogs, drawers and the mobile sidebar move
  focus in, keep Tab inside, close on Esc and return focus; a closed off-canvas sidebar is inert.
  In the icon rail, clicking a group expands the sidebar. The sidebar scrolls the current item into
  view and shows a soft edge where more items lie above or below.
- *Forms*: the discharge form autosaves to the server and warns before the tab closes while a change
  is unsaved; server validation appears beside the field it concerns.
- *Lists*: triage worklist, psychiatry queue, caseload, documents, discharge and follow-up lists can
  be filtered and sorted by column; they show skeleton rows while loading and a purposeful empty
  state. The dashboard shows what needs attention (RED / ORANGE clients, triage due, overdue
  follow-ups, discharges with no follow-up), when it was last updated, and a Refresh button.
- Breadcrumbs on the client record, triage encounter and discharge screens.

**Topbar** (56px, dark green `--hdr`, white text, sticky).

- Hamburger (toggles rail), **current page title** (e.g. "Dashboard", "Triage & Queue",
  "Triage encounter"), client search ("Search clients... (Ctrl+K)"), notifications bell,
  light/dark theme toggle.
- Search hidden below 480px.

**Page titles by page**: Dashboard · My Caseload · Appointments · Follow-up · Client registry
(Registration) · Triage & Queue (worklist) / Triage encounter (open encounter) · Psychiatry
Workspace · Inpatient Admissions · Ward Board · Discharge Planning · Outpatient Care (all three
psychotherapy items) · Medication Orders & Review · Medication Administration · Laboratory Records ·
Referral Worklist · Referral Documents · Clinical Documents · Billing · Reports & Analytics · NACADA
Report · Supervision Requests · Client Record.

**Triage focus mode**: when a triage encounter is open, the shell locks to viewport height and the
content area scrolls on its own.

### 1.2 Persistent client safety banner

Shown on every client-scoped screen (triage encounter, re-check, client record). Sticky at the top
of the content. Four cells (collapses to 2 columns under 950px, 1 under 570px):

| Cell | Content |
|---|---|
| Identity | Avatar initials (grey "temporary" style when identity not confirmed); full name or "Temporary client (unnamed)"; identity label tag when not identified; **CITRAMAC ID** · **MRN**; demographic chips: age "N yrs", sex, "DOB yyyy-mm-dd", payer |
| Allergy | Three states. **known** — red, title "ALLERGIES", one chip per allergen (split on `,` / `;`) or "Details not recorded". **none** — green, "No known allergies", note "Confirmed at triage". **unknown** — amber striped, "ALLERGIES UNKNOWN", note "Confirm at triage". `aria-live="polite"`; updates live when triage changes the allergy fields |
| Setting / priority | "Current setting": inpatient = "Ward · Bed N · status" (green dot), outpatient = "Outpatient · status" (teal dot). "Triage / risk priority": badge `RED · Emergency` / `ORANGE · Urgent` / `YELLOW · Priority` / `GREEN · Routine`, or tag "Assigned after triage" |
| Alerts / team | "Critical clinical alerts": one warning chip per active alert, or "No critical alerts". "Responsible clinician / team": clinician name, team on a second line |

### 1.3 Dashboard

- Header: "Dashboard", subtitle "System overview — {weekday, month day, year}", button
  **+ New Registration** → Registration.
- Four stat cards: Total Clients; Inpatients (+ "N beds available"); Outpatients; RED / ORANGE
  ("Requires attention").
  - The mockup's "↑ 12 this week" and "↑ 8 from yesterday" are hard-coded demo text. They will
    only be shown once they are computed from real data.
- **Quick access** ("Jump to the work that needs your attention."), five tiles with a count pill.
  The pill is amber ("attention") when the count is above 0 for the first two tiles:
  - Triage queue — "Arrivals and re-checks due" — "N due"
  - Psychiatry review — "Signed referrals · priority order" — "N queued"
  - My caseload — "Clients assigned to you" — "N clients"
  - Appointments — "Today's scheduled visits" — "N today"
  - Inpatient admissions — "Current stays and bed allocation" — "N beds free"
- **CITRAMAC care pathway** card: "One connected journey from first contact through ongoing care."
  Horizontal stepper: Registration → Triage → Intake → Care Plan → Interventions → Outcomes →
  Billing → Follow-up. First and last steps are highlighted.
- Two cards:
  - **Recent Activity**: a timeline of the latest events, each with time, title and detail.
  - **Triage arrivals**: the top five queue entries, showing Client, Setting, and "N min · status".

### 1.4 Registration (Client registry → "New arrival")

**Identity mode tabs** (segmented control):

1. **Tier 1 registration** (identified)
   - Hint: "Identified arrival. Search first to avoid creating a duplicate record."
   - Full name required.
   - Submit button: "Register & send to triage".
2. **Unidentified person**
   - Hint: "The person is present but their name has not been confirmed. Add a brief description
     or alias so they can be safely identified later."
   - "Observed description / temporary alias" is required.
   - Submit button: "Register unidentified person & send to triage".
3. **Emergency — identity unknown**
   - Hint: "Emergency — identity unknown. Capture only what is available; registration must never
     delay urgent care."
   - Description is optional.
   - Submit button: "Create emergency record & send to triage".

Switching from a selected identified client to a non-identified mode clears the selection.

**Find an existing client**
- Note: "Search by name, phone, national ID or CITRAMAC ID. Front Desk sees registration details
  only — never clinical notes or medical records."
- Live search, up to 6 results. Each result shows: name; CITRAMAC ID · phone · DOB · identity
  label; and a "Load details" action.
- No match: "No matching client found. Check the details or continue with a new registration."
- **Selecting a client** loads their saved registration details. It also:
  - shows a notice: "{name} · {CITRAMAC ID} — Saved registration details loaded. Sending to triage
    creates a new encounter; it does not reopen an earlier one."
  - shows a **Clear selection** button;
  - changes the submit button to "Register & send new encounter to triage";
  - clears Referral and Reason, and moves focus to Reason.

**Fields** (3-column grid; 2 columns under 900px; 1 under 560px):

| Field | Control / options |
|---|---|
| Full name | text, REQUIRED in Tier 1, hidden in other modes |
| Observed description / temporary alias | text, shown in non-identified modes, required in Unidentified |
| Preferred name | text |
| Pronouns | she/her · he/him · they/them · Prefer not to say · Other |
| Date of birth | date |
| Or estimated age | number 0–125, "yrs" |
| Sex | F · M · Intersex / other · Not stated |
| Mobile phone | tel |
| Next of kin / emergency contact — name & phone | text |
| Address / location | text, placeholder "No fixed abode is a valid answer" |
| ID / passport (where available) | National ID · Passport (foreign national) · Refugee / asylum-seeker ID · Alien ID · Birth certificate (minor) · None / unknown |
| Document number | text |
| Referral source | text, placeholder "e.g. self, GP, family, police, court"; defaults to "Self-presented" |
| Preferred language | text, default "English" |
| Interpreter | No · Yes — Kiswahili · Yes — other local language · Yes — sign language |
| Allergies & reaction, if known | Not asked / unknown · Client reports none · Client reports an allergy |
| Allergy & reaction details | text, shown only for "Client reports an allergy" |
| Payer / insurance (optional — never blocks care) | SHA · SHA + private insurer · Private insurance · Employer scheme · Self-pay · Waiver / charity · Unknown |
| Reason for attending (in the client's words) | textarea, full width |

- Footer: **Cancel** (→ Dashboard), submit.
- Note: "⚠ Allergies recorded here are client-reported; a clinician confirms them at intake before
  any prescribing."

**On submit:**
- **Validation**:
  - identified with no name → "Enter the client's full name, or change Identity status to
    Unidentified or Unknown to register without one."
  - unidentified with no description → "Add a brief description or reported temporary alias so
    this unidentified arrival can be distinguished safely."
- **Client record**: created, or updated if a client was selected.
  - Non-identified clients get a generated name: "Unidentified person (…)" / "Unknown person (…)".
  - Identity label: Identified / "Unidentified — provisional record" / "Unknown — minimum details
    only".
  - Registration mode label: "Tier 1 registration" / "Tier 1 registration — identity confirmed" /
    "Tier 1 emergency — temporary identity".
  - `identityConfirmedAt` is set when a temporary record is resolved to an identified one.
- **New triage encounter**:
  - status **Awaiting triage**;
  - arrival = now; **due = arrival + 10 minutes**;
  - presenting = reason, or "Not yet recorded — ask client or informant";
  - label "Visit N", where N counts this client's encounters.
- Then navigate to the Triage worklist.

**Identity resolution**: for a temporary record, Registration is reopened on that record in
Tier 1 mode with the name field empty and focused.

### 1.5 Triage worklist ("Triage — awaiting and re-checks due")

- Eyebrow "Clinical workflow".
- Count line: "N items · M overdue" (also shown as a tag in the card header).
- Rule line: "Overdue first, then due time. Priority is assigned after triage."
- **Included statuses**:
  - Awaiting triage, Waiting, Re-check due;
  - In triage, if it is a new encounter or has been started, drafted, or sent for full re-triage.
- **Sort**: overdue first, then due time ascending.
  - Overdue = not a re-check, and past its due time.
  - Overdue rows are tinted, with a red left edge and an "OVERDUE" label.
- **Columns**:
  - Client: "name · id", CITRAMAC ID beneath.
  - Setting / status: Inpatient or Outpatient, plus status.
  - Detail:
    - re-check: "Re-check due · last triage vN HH:MM";
    - otherwise: "N min · triage target".
  - Due: yyyy-mm-dd HH:MM.
  - An **Open** action.
- Empty state: "No arrivals or re-checks are currently due."
- **Open** behaviour: a "Re-check due" encounter opens the quick re-check; anything else opens
  full triage.

### 1.6 Triage encounter ("Initial triage")

**Layout:**
- Safety banner.
- Context strip:
  - Encounter: status · arrival · "N min waiting";
  - Reason for attending;
  - Referral source;
  - Contact / next of kin, shown only if present.
- Heading "Initial triage", subtitle "Safety screen and immediate disposition · Not the full
  assessment", and a **Back to queue** button.

**Opening an encounter:** the status becomes "In triage" and the start time is recorded.

**Live safety summary** (left border coloured by priority, `aria-live`):
- Title "Live safety summary" plus the recommendation label.
- Recommendation label:
  - "Screen in progress" before any input;
  - then "Review required", "{P} — preliminary", or the final {P}.
- Reasons, joined with " · ", followed by "Alerts: …".

**Sections**: each is a collapsible panel. B and C are open by default.

**A — Automatic Information (retrieved, not re-asked)** — read-only fields:
- Client identity / temporary ID (name — identity label — CITRAMAC ID (MRN)).
- Identity / distinguishing description, only for non-identified clients.
- DOB / Age / Sex.
- Contact details.
- Emergency contact / NOK ("Not recorded — confirm").
- Referral source.
- Previous signed triage priority, if any.

Editable fields:
- **Allergy status** (Known / No known allergies / Unknown).
- **Allergy detail — updates the central allergy record**. Changing either field updates the
  banner live.

Callout: "Existing critical alerts: … Alerts follow the client until resolved or updated."

**B — Triage Encounter**
- Read-only: Date / time, Triage clinician (the signed-in user), Tenant / location.
- "Name / relationship if third party" (text).
- Encounter type: Walk-in · Appointment · Emergency · Telephone · Referral · Other.
- Who is providing the information?: Client · Family/parent · Friend · Police · Ambulance ·
  Healthcare professional · Employer/school · Other.
- Is the client physically present?: Yes / No.
  - Branching rule: YES → direct observation and safety screen. NO → telephone / third-party
    screen (Section K); the direct-observation fields are hidden.

**C — What Is Happening Right Now?**
- Main concern in the client's or informant's own words (pre-filled from registration).
- When did this begin or become worse?: Today · Past 24 hours · Past few days · Past week ·
  Longer · Unknown.
- Brief description.

**D — Immediate Safety: Suicide / Self-Harm**
- Currently having thoughts of killing or seriously harming yourself? **(core screen, required)**:
  not assessed / No / Yes / Unable to determine.
- Thinking about acting on these thoughts now? No / Yes / Unsure.
- Anything recently done to kill or seriously harm yourself? No / Yes.
- Known access to means of serious self-harm? No / Yes / Unknown.
- Can the client currently maintain their own safety? Yes / No / Uncertain.
- What happened and when? (text)
- Trigger callout: "SUICIDE/SELF-HARM RISK alert → Suicide Risk Assessment + Safety Planning
  workflow. Triage does not duplicate the full assessment."

**E — Risk of Harm to Others**
- Current thoughts of seriously harming someone else? **(core screen)**: not assessed / No / Yes /
  Unable to determine.
- Recent threatening, aggressive or violent behaviour? No / Yes / Unknown.
- Recent violent act? No / Yes.
- Known access to means of serious harm? No / Yes / Unknown.
- Current behaviour suggests immediate danger? No / Yes / Uncertain.
- Who/what is the concern? (text)
- Trigger callout: "RISK OF HARM TO OTHERS → violence/risk assessment and escalation pathway."

**F — Acute Mental State**
- Major change in mental state now? **(core screen)**: not assessed / No / Yes / Unable to
  determine.
- Observed features (multi-select): Severe agitation · Extreme distress · Confusion/disorientation ·
  Psychotic symptoms · Hallucinations · Frightening/command hallucinations · Severe
  suspiciousness/paranoia · Very elevated/activated behaviour · Markedly disorganised behaviour ·
  Unable to communicate safely/coherently · Marked behavioural change from usual · Other.
- Direct observation only (hidden when the client is not present):
  - Level of consciousness: Alert · Drowsy · Difficult to rouse · Unresponsive · Fluctuating.
  - Orientation: Appears oriented · Disoriented/confused · Unable to assess.
  - Behaviour: Calm · Anxious/distressed · Agitated · Aggressive · Disorganised ·
    Withdrawn/unresponsive · Other.
  - Clinician observation (text).
- Trigger callout: "ACUTE MENTAL STATE CHANGE / PSYCHOSIS / ALTERED CONSCIOUSNESS as applicable."

**G — Alcohol & Other Substances**
- Recent alcohol or other substance use? No / Yes / Unknown.
- Current intoxication: None apparent · Mild/suspected · Significant · Severe · Unable to
  determine.
- Recently stopped or reduced heavy use? No / Yes / Unknown.
- Previous withdrawal seizure? No / Yes / Unknown.
- Current withdrawal symptoms (multi-select): Tremor · Sweating · Vomiting · Severe
  anxiety/agitation · Hallucinations · Confusion · Seizure · Other · None.
- Trigger callout: "Alcohol dependence / recent cessation + withdrawal risk → PAWSS. Current
  alcohol withdrawal → CIWA-Ar. Current opioid withdrawal → COWS."

**H — Urgent Medical Screen**
- Immediate physical/medical concern? **(core screen)**: not assessed / No / Yes / Unknown.
- Immediate concerns (multi-select): Chest pain · Difficulty breathing · Severe pain · Serious
  injury · Recent seizure · Loss/alteration of consciousness · Severe vomiting/dehydration ·
  Suspected overdose · Head injury · Severe intoxication · Acute medication reaction/concern ·
  Pregnancy-related acute concern · Other.
- Vital signs when clinically indicated: BP, Pulse, Resp. rate, Temp, SpO₂, Blood glucose.
- Behaviour callout: "Configured abnormal/critical measurements create an ACUTE MEDICAL CONCERN
  alert and prompt medical review / escalation."

**I — Safeguarding & Vulnerability**
- Do you feel safe where you currently live or stay? **(core screen)**: not assessed / Yes / No /
  Unsure / Unable to assess.
- Concerns (multi-select): Abuse · Neglect · Domestic/intimate partner violence · Sexual
  violence/exploitation · Financial exploitation · Threat/coercion · Child safeguarding ·
  Vulnerable adult · Unsafe living environment · Other · None identified.
- Safe to return to current environment? Yes / No / Uncertain.
- Trigger callout: "SAFEGUARDING CONCERN → tenant safeguarding pathway."

**J — Immediate Functional Safety**
- Immediate concern that the person cannot safely care for basic needs? **(core screen)**:
  not assessed / No / Yes / Uncertain.
- Areas (multi-select): Eating/drinking · Medication · Hygiene/basic care · Safe shelter · Severe
  sleep disruption · Wandering/getting lost · Unable to seek help appropriately · Other.
- Scope note: "Brief at Triage. Detailed functioning belongs in Comprehensive Intake."

**K — Client Not Physically Present: Telephone / Third-Party Screen** (shown only when B = No)
- Where is the client now?
- Are they alone? Yes / No / Unknown.
- Who is physically with them?
- When did the caller last see or speak with them?
- What exactly is causing concern?
- Can the person be brought safely for assessment? Yes / No / Uncertain.
- Is emergency assistance required? No / Yes.
- Concern reported (multi-select): Suicide/self-harm concern · Recent attempt/self-harm ·
  Threat/risk to another person · Access to serious means reported · Severe confusion · Severe
  agitation/aggression · Psychotic behaviour · Significant intoxication · Possible withdrawal ·
  Seizure · Loss of consciousness · Serious injury/medical concern.

**L — Automatic Triage Summary (generated, not retyped)**: table of Finding / Alert, Current
status, and Source (Client report / Clinician observation / Measured result / Third-party report /
Triage screen), each stamped with the time. Empty state: "No structured findings yet — complete
the sections above."

**M — Triage Priority**
- Callout about confirming or overriding the system recommendation.
- Clinician decision: Confirm recommendation / Override.
- Final selected priority: RED / ORANGE / YELLOW / GREEN. Required.
- Reason for override: enabled and required only when Override is chosen.
- Read-only: clinician, date and time.
- Priority guide, four cards:
  - **RED — Emergency / Immediate.** Immediate or potentially life-threatening safety, medical or
    behavioural concern. → Do not wait for routine intake; begin immediate safety/medical action
    and emergency assessment or transfer where required.
  - **ORANGE — Urgent.** Significant concern that could deteriorate or requires prompt clinician
    assessment. → Place ahead of routine work; review as soon as possible under the urgent
    process.
  - **YELLOW — Priority.** Currently stable but should not simply wait through the normal routine
    pathway. → Arrange timely assessment; escalate if the condition changes.
  - **GREEN — Routine.** Stable; no immediate safety or medical concern identified. → Proceed
    through the normal intake or appointment pathway.

**N — Immediate Action / Disposition**
- Actions (multi-select): Immediate emergency intervention · Emergency transfer · Urgent medical
  review · Urgent psychiatric review · Priority psychiatric review · Routine psychiatric review ·
  Suicide Risk Assessment · Safety Plan · Enhanced observation · Withdrawal assessment/monitoring
  · Detox assessment · Safeguarding intervention · Proceed to Comprehensive Intake · Outpatient
  appointment · Admission assessment · Other.
- Responsible person/team: default "Psychiatry / Nursing".
- Status: Initiated / Pending / Completed.
- **Register as trackable tasks** adds one row per ticked action to a task table (Action, Owner,
  Status, Date / time).

**Action bar** (sticky bottom):
- Draft status: "Draft not saved" / "Draft saved HH:MM".
- Buttons: Back · Save draft · **Sign triage**.
- Every input autosaves the draft.

**Recommendation rules** (start at GREEN; each rule can only raise the priority):

| Trigger | Priority | Alert | Reason |
|---|---|---|---|
| D suicidal = Yes | ORANGE | Suicide risk | suicidal thoughts present |
| …and acting now = Yes | RED | | |
| …and recent attempt = Yes | RED | | |
| …and access to means = Yes | ORANGE | | |
| E thoughts, behaviour or act = Yes | ORANGE | Aggression / violence risk | risk of harm to others present |
| …and immediate danger = Yes | RED | | |
| F change = Yes, or any feature ticked | ORANGE | | acute mental state change |
| F consciousness ≠ Alert | RED | Altered consciousness | altered consciousness |
| G withdrawal symptoms present (excluding None), or use = Yes with Significant/Severe intoxication, or stopped = Yes with symptoms | ORANGE | Withdrawal risk | withdrawal risk (prior seizure noted) |
| H concern = Yes, or any concern ticked | ORANGE | | acute medical concern |
| …and any of: chest pain, recent seizure, suspected overdose, difficulty breathing, loss/alteration of consciousness | RED | | |
| Vitals: SBP > 160, pulse > 120 or < 50, SpO₂ < 92, temp > 38.5 | RED | Abnormal vital signs | abnormal vital signs |
| I concern ticked (excluding None identified), feels safe = No, or safe to return = No | ORANGE | Safeguarding concern | safeguarding concern |
| J concern = Yes | YELLOW | | immediate functional safety concern |
| K (not present) and emergency assistance = Yes | RED | Telephone screen: emergency assistance required | |
| K suicide concern | ORANGE | Suicide risk | suicide concern via third party |

- **Core screens** are D, E, F, H, I and J.
  - An unanswered core screen adds the summary row "Safety screen incomplete — Not assessed: …".
  - An answer of unable / unknown / unsure / uncertain adds "Clinical review required — Unable to
    determine: …".
  - **Unanswered is never treated as negative.**
- **Recommendation readiness**:
  - It is final only when every core screen is answered with a definite value.
  - Otherwise it shows "{P} — preliminary" if something has already raised the priority, or
    "Review required".
  - When the recommendation is final and the clinician has chosen Confirm, the final priority is
    filled in automatically.

**Signing:**
- **Blocked** until every required field is complete. Message: "Complete the required safety
  screens and select a final priority before signing." The panel holding the first missing field
  opens.
- Override requires a reason.
- **The signed record holds:**
  - every field value and a structured list of the fields;
  - the recommendation and its reasons;
  - the findings table;
  - the priority, the decision and the override reason;
  - the signing time and the signer.
- **On signing:**
  - the encounter priority and presenting concern are set;
  - the triage version is incremented and the status becomes **Triage completed**;
  - the draft is cleared;
  - the client's priority is updated.
- **Confirmation**: "Triage signed. {name} has been added to the Psychiatry queue with {P}
  priority…". The form then becomes read-only.

### 1.7 Triage re-check ("Quick re-check")

- Opened for encounters with status "Re-check due".
- Banner and context strip as in §1.6.
- Heading "Triage re-check", subtitle "Record what has changed and repeat observations only when
  taken".
- Intro:
  - eyebrow "{Visit N} · Is anything different since the last check?";
  - "Last signed: triage vN at HH:MM by X — P label.";
  - "A re-check takes about 30 seconds; open a full re-triage if anything has changed."

**Fields:**
- Any change since the last check (client, family or staff report)? **REQUIRED**: No change /
  Yes — change reported / Unable to determine.
- Distress / behaviour now: Low — calm, engages easily / Moderate / High / Unable to assess.
- **Repeat observations** ("Leave blank if not repeated — the previous set carries forward."):
  - Heart rate (bpm), Blood pressure systolic/diastolic (mmHg, one paired card), Respiratory rate
    (/min), Temperature (°C), SpO₂ (%), Blood glucose (mmol/L).
  - Each has a status: "Not repeated — previous set carries forward" / "Measured now" /
    "Not measured".
  - Typing a value sets the status to Measured.
  - Moving the status away from Measured clears the value.
  - Measured makes the value required.
- Note (optional).

**Actions:**
- Draft autosaves on every change.
- Back.
- **Open full re-triage**: status → In triage; records the request time; opens full triage.
- **Sign re-check**: appends a versioned re-check (signer, time) and sets the status to
  **Re-check completed**.

### 1.8 Psychiatric (priority queue)

- Eyebrow "Clinical workflow", title "Psychiatry — priority queue", subtitle "Signed triage
  referrals · highest priority first".
- Table header: "Clients queued for psychiatric review · RED → ORANGE → YELLOW → GREEN", with
  "N clients".
- Rows: every encounter with a signed triage, sorted by priority, then most recently signed first.
  Each row has a left edge coloured by priority.
- Columns:
  - Client, with CITRAMAC ID · id;
  - Triage priority pill: "P · Emergency / Immediate | Urgent | Priority | Routine";
  - Presenting concern;
  - Triage signed: time, and signer beneath;
  - **Open review** action.
- Empty state: "Signed triage assessments will appear here for psychiatric review."
- **Open review** needs a signed triage, and opens the Client Record.

### 1.9 Client Record (psychiatric review)

- Safety banner, then two tab rows.
- **Record views**: Snapshot · Timeline · Charts · Legal & consent · Journey.
- **Journey stages** (shown only under Journey; the active stage is filled green): Capture ·
  Intake · Care Plan · Interventions · Outcomes · Billing · Follow-up.
  - Capture opens Snapshot.
  - Follow-up maps to stage 5 with a follow-up focus.
- The body is the **CITRAMAC v4 patient workflow** (`CITRAMAC-Workflow-v4 (1).html`), which the
  mockup embeds in an iframe. It receives the client, the signed triage (priority, recommendation,
  override reason, findings, structured fields, signer) and the theme.
  - **This file was not supplied with the mockup.** The content of Snapshot, Timeline, Charts,
    Legal & consent and the seven journey stages is therefore not yet captured. It is needed
    before any of it can be built.
- A signed triage is required. Otherwise: "A signed triage record is required before opening the
  Psychiatry workflow."

### 1.10 Inpatient Admissions

- Header actions: Bed Management, + New Admission.
- **New Admission Record**:
  - Client (read-only);
  - Admission Type: Voluntary / Involuntary;
  - Admission Date;
  - **Clinical Priority**: RED / ORANGE / YELLOW / GREEN;
  - Reason;
  - **Responsible Team** (team — consultant);
  - **Bed Assignment**: available beds only, shown as "Ward — Bed N (Available)";
  - Cancel / **Approve Admission**.
- **Current Inpatients (N)**: Bed (ward — bed), Client (name + id), Type, Priority pill, Admitted,
  Diagnosis, Status.

### 1.11 Psychotherapy → "Outpatient Care"

All three Psychotherapy items open this page and highlight their own nav entry.

- Header actions: Treatment Plan, Schedule Follow-up.
- **Active Outpatients (N)**: Client + id, Diagnosis, Priority pill (or "Pending triage"), Last
  Visit, Next Appointment, Status.
- **Treatment Plan — {client}**:
  - Plan Type: Standard Outpatient Care · Intensive Outpatient Program · Day Program.
  - Interventions (checkboxes): Medication management · CBT — Weekly sessions · Family therapy —
    Monthly · Group therapy · Psychoeducation.
  - Goals (text).
  - Review Date.
  - Care Coordinator.
- **Upcoming Appointments**: Date, Type, Provider.
- **Progress Notes**: author, timestamp, text.

### 1.12 My Caseload

- Subtitle "Clients assigned to {user}"; button View Appointments.
- Four stats: Assigned Clients, Inpatients, Outpatients, RED / ORANGE Priority.
- Card "Assigned Clients", with a "N clients" tag and search ("Search by name, ID, diagnosis, or
  status...").
- Table:
  - Client + id;
  - Diagnosis;
  - Care Setting tag (red for inpatient: "Ward · Bed N", otherwise "Outpatient");
  - Priority pill or "Pending triage";
  - Status;
  - Next Appointment ("Not scheduled");
  - **Open record**.

### 1.13 Appointments

- Subtitle "Review upcoming visits and schedule client appointments"; button My Caseload.
- Three stats: Scheduled Appointments, Today, Clients Scheduled.
- **Upcoming Schedule**:
  - search ("Search client, type, provider, or status...");
  - table sorted by date and time: Date & Time, Client, Appointment, Provider, Status.
- **Schedule an Appointment**:
  - Client (active clients only), Date (minimum today, default today), Time.
  - Appointment type: Psychiatry review · Individual psychotherapy · Family psychotherapy · Group
    psychotherapy · Medication review · Outpatient follow-up.
  - Provider.
  - **Add Appointment**.

### 1.14 Documents

- Eyebrow "Clinical records", title "Documents", subtitle "Signed clinical documents linked to
  client records".
- Card "Signed triage assessments", with an "N documents" tag.
- Table: Document ("Signed triage assessment"), Client + ids, Priority pill, Signed, Clinician,
  **Open record**.
- Empty state: "No signed triage documents are available yet."

### 1.15 Billing

- Eyebrow "Finance overview · {date}", subtitle "A live view of delivered services, outstanding
  claims, and payments".
- **Four summary cards** (each with a coloured left edge):
  - Services: total, "N delivered events";
  - Unbilled: "N events with a balance";
  - Claimed: "N events with a balance";
  - Paid: "N events settled".
  - Amounts are in Ksh, with no decimals.
  - Card values show "—" when billing data is unavailable.
- **Billing events** ("Charges generated from documented delivered services"):
  - Columns: Client + id, Service, Payer, Date, Amount (right-aligned), Status.
  - Status values: unbilled · claimed · paid · Part paid · Part claimed.
  - Sorted newest first.
- **Event source**: one event per delivered service record. Amount = quantity × the service rate.
- **Claim allocation**:
  - Each service's claimed quantity comes from the submitted claim lines. If no lines were
    submitted, all delivered quantity counts as claimed.
  - Claim value is allocated oldest first, capped by the submitted claim amount.
- **Payment allocation**: total payments go to claimed balances first, then to unbilled balances.
- **Unpriced services** are excluded, with this notice: "Some delivered services were not included
  because their rates are not configured: …".
- **Service list**: Emergency Care, Blood Work, Medical Review, Appointments, Psychiatry,
  Admission, Withdrawal Management (Detox), Opioid Agonist Therapy, Psychiatric Nursing,
  Psychotherapy, Psychosocial Support, Nutrition & Fitness, Discharge, Follow-up & After-care.
  - The mockup's rates are **illustrative**. It says so itself: "Confirm the facility tariff before
    operational claims."
- Empty states: "No billable events yet — Delivered services recorded in the Psychiatry module
  will appear here." / "Billing data unavailable".

### 1.16 Reports

- Eyebrow "Service overview · {date}", subtitle "Live operational summaries from the current
  client, triage, bed, and appointment records".
- **Operational overview** table: Registered clients · Awaiting triage · Triage re-checks due ·
  Signed triage assessments · Inpatients · Occupied beds (N / total) · Appointments today.
- **Signed triage priority distribution**: RED, ORANGE, YELLOW, GREEN → client count.

### 1.17 Screens present in the mockup code but not reachable from its navigation

The following screens are defined in the mockup but are superseded by the v4 workflow iframe, or
are only reachable from "Open record" in My Caseload. They are recorded here so nothing is lost.
They are **not** treated as approved layouts until the owner says so.

- **Intake & Clinical Assessment** (reached from My Caseload → Open record):
  - Tabs: Assessment · MSE · Risk · Diagnosis · Formulation · Care Plan.
  - Assessment fields: presenting concern, history, current symptoms, risk level, MSE (appearance,
    behaviour, mood, affect), GAD-7 and PHQ-9 scores.
  - Clinical decision: Continue outpatient / Refer to specialist / Escalate to inpatient.
  - Identified care needs.
  - "Information Trail" side panel: "Every item shows where it was first captured. Nothing is
    entered twice."
- **Care Plan**: documented actions with goals and status; a system recommendation callout.
- **Intervention Engine**: Care Plan action → module mapping; intervention record (goal, time,
  provider, intervention, response, next action). Billing link: "a completed intervention marked
  billable automatically creates the relevant billing event".
- **Nursing Workspace**: Clinical Review · MAR · Observations · MSE · Telephone / PRN Orders.
- **Ward Board**: bed grid; nursing notes; observations table.
- **Medications**: active medications, today's administration, allergies and interactions.
- **Discharge Planning**: status, diagnosis, treatment summary and date; discharge medication plan;
  follow-up plan and referrals; patient education checklist.
- **Outcomes**: PHQ-9 and GAD-7 trends; care plan review.
- **Follow-up**: the client's appointment schedule.

### 1.18 Existing screens and where they sit now (updated 2026-10-08)

Homed in the grouped navigation: Nursing / MAR (Medication administration), Laboratory (LIMS),
Pharmacy (Medication orders & review), Supervision (Supervision requests), Clinical Reports
(NACADA report), Discharge (Discharge planning, built — docs/17) and Follow-up (built — docs/17).

No longer in the sidebar, still reachable by URL, nothing deleted: Client Registry list,
Client History, Assessments, Clinical Encounter (SOAP), Triage & MSE (old), Clinical Review,
Attachments, MHP session screens, and the old Admissions & Ward Workflow screen (`/clinical/ipd`,
whose free-text discharge box was replaced by a link to Discharge planning).

---

## 2. Conformance conflicts in the mockup (CLAUDE.md)

These are **not** carried into the build. Each one needs the owner's decision only if they want
the mockup's behaviour anyway.

| # | Mockup behaviour | Rule | What we build instead |
|---|---|---|---|
| C1 | Registrations, triage encounters, drafts and billing are stored in `localStorage` | §5 "no browser storage for clinical data"; 2026-09-29 amendment | Everything persists server-side. Drafts are server-side `in-progress` records |
| C2 | Every clinical drop-down list (triage options, actions, interventions, plan types, appointment types, payer, ID types) is hard-coded | §3.3 and §4 "Terminology is served, not compiled" | Each list becomes a ValueSet served by the backend and cached by the client; option text as captured in §1 |
| C3 | Billing rates are hard-coded and illustrative | §6 "tariff or fund codes" must not be invented | Rates come from a facility tariff table configured per organization. **VERIFY:** facility tariff and SHA fund codes, from the facility / SHA |
| C4 | Demo text carries diagnosis codes ("6C40.2", "F32.1", the latter ICD-10) | §6 and §3.3 | No codes in the UI. Diagnosis only through the ICD-11 search already in place |
| C5 | Triage priority thresholds (SBP > 160, pulse > 120 / < 50, SpO₂ < 92, temp > 38.5) and escalation rules are in page script | §1 clinical safety | Implemented exactly as captured, but held as server-side configuration, versioned, and recorded with each signed triage. **Needs clinical sign-off** before go-live |
| C6 | Signer is a hard-coded string ("J. Njoroge, RN") | §3.4 provenance | The signed-in user, stamped server-side, plus `Provenance` |
| C7 | Client Record body is an iframe to an external file, messaged with `postMessage(…, '*')` | Security (wildcard target origin) | Built natively in the React app; no iframe |
| C8 | Withdrawal-scale triggers (PAWSS, CIWA-Ar, COWS) | §6 LOINC codes | Triggers create Tasks by name only. **VERIFY:** instrument codes (LOINC), from loinc.org, before any score is stored as an Observation |
| C9 | The new triage/episode flow has no `EpisodeOfCare` | §4 "EpisodeOfCare is the clinical spine"; the waitlist → active time is unrecoverable later | Registration "send to triage" opens or joins an EpisodeOfCare, with `statusHistory` from the first record |

---

## 3. Resource mapping (confirmed 2026-10-07)

One line per feature: resource · profile · terminology binding · where it hangs. Rung-4 profiles
need an implementation guide we do not have yet. Until the national IG exists, each one starts as
a local StructureDefinition validated in CI (CLAUDE.md §2, and the rung-2 amendment).

**M1 — Registration (3 identity tiers)**
- **Patient**: names, preferred name as `name.use=usual`, `communication` (language + preferred),
  `contact` for NOK.
  - Identifiers are sliced one per ID type. **VERIFY:** the `system` URI for each national ID,
    passport, refugee and alien ID type, from the national IG.
  - Interpreter needed. **VERIFY:** the R4 core extension URL, from hl7.org/fhir/R4 extensions.
  - Pronouns have no base R4 element. **VERIFY:** an extension in a published IG.
  - Unidentified / unknown persons use the absent-name pattern. **VERIFY:** the data-absent-reason
    extension URL.
  - Later identity resolution uses `Patient.link` (`replaced-by` / `replaces`).
- **AllergyIntolerance** with `verificationStatus=unconfirmed` for client-reported allergies.
  "Reports none" needs a coded no-known-allergy concept. **VERIFY:** SNOMED CT code, from the
  terminology browser.
- **Coverage**: the payer, optional. **VERIFY:** SHA scheme identifiers.
- **EpisodeOfCare**: status `waitlist` with `statusHistory`.
- **Encounter**: triage, `status=arrived`, `reasonCode.text` holding the client's own words,
  `period.start` = arrival. The due time (+10 minutes) is set by configuration.
- Hangs from: new episode → encounter.

**M2 — Triage**
- **Encounter**: the triage encounter, with `priority` bound to a local CitraMac triage-priority
  ValueSet (RED / ORANGE / YELLOW / GREEN). **VERIFY:** our own canonical base URL for local
  CodeSystems.
- **QuestionnaireResponse** against a triage **Questionnaire**, sections A–N, following the SDC
  pattern. The draft is `in-progress`; signing makes it `completed`.
- **Observation**: one per measured vital, using the vital-signs profile. **VERIFY:** LOINC code
  for each vital.
- **Flag**: one per alert raised (suicide risk, aggression / violence, withdrawal, safeguarding,
  abnormal vitals, altered consciousness, telephone emergency). Flags drive the banner's alert
  chips.
- **RiskAssessment**: the screen's outcome, with the recommendation, final priority and override
  reason.
- **Task**: one per disposition action, with owner and status.
- **Provenance**: the signature (who, when, on whose authority).
- **AuditEvent**: every read of the record (§4).
- Hangs from: the triage Encounter → EpisodeOfCare.

**M3 — Triage re-check**
- A new QuestionnaireResponse (re-check Questionnaire), versioned.
- An Observation only for each "Measured now" value. "Not measured" is recorded as an item answer,
  not as an Observation.
- Provenance.
- Hangs from: the same triage Encounter.

**M4 — Psychiatry queue**
- A read view over triage Encounters whose QuestionnaireResponse is `completed`, ordered by
  `Encounter.priority`.
- Opening a review creates a psychiatry **Encounter** in the same EpisodeOfCare.
- The content of the review itself waits for the v4 workflow file (§1.9).

**M5 — Inpatient admission**
- **Encounter** with `class=IMP` inside the EpisodeOfCare, extending the existing Admission
  mapping.
- Clinical priority = `Encounter.priority`, from the same ValueSet as M2.
- Responsible team = **CareTeam**, referenced from the Encounter and the EpisodeOfCare.

**M6 — Outpatient treatment plan**
- **CarePlan**: `category` is a local ValueSet; plan type and interventions are a served ValueSet
  of `activity` kinds.
- **Goal** per goal.
- Review date = `CarePlan.period` / next review.
- Care coordinator = `EpisodeOfCare.careManager`.
- Progress notes reuse the existing PsychotherapySession records, linked to an Encounter. Group
  and family sessions stay one Encounter per participant (§4).

**M7 — Documents**
- A **Composition** / **DocumentReference** for each signed triage, generated on signing.
- Read-only list.

**M8 — Billing**
- **ChargeItem** per delivered service, priced from a ChargeItemDefinition / tariff table.
  **VERIFY:** the tariff.
- **Claim** for submitted lines.
- Payments recorded against the existing billing app. Allocation follows §1.15.

**M9 — Caseload**
- A read view: clients where the user is `Patient.doctor`, or holds a CareTeam membership, or is
  the EpisodeOfCare care manager.

**M10 — Banner**
- A read view: Patient, AllergyIntolerance, active Flags, latest signed triage priority, current
  Encounter / bed, and CareTeam.

**Reversibility:**
- **P0 — must be right before the first record.** M1, M2, M3 and M5 create signed clinical
  records. Getting EpisodeOfCare, the triage QuestionnaireResponse shape, and the priority
  ValueSet wrong later would mean re-authoring signed records.
- **Cheap to change later.** M4, M7, M9 and M10 are views over stored data. M6 and M8 are
  versioned but unsigned.

---

## 4. Build status (2026-10-07)

Every screen in §1.1–§1.17 is built, against the backend app `apps/care_pathway` (models,
served value sets, triage rules, FHIR triage bundle) and frontend `src/modules/care/`.

| Screen | Route | Notes |
|---|---|---|
| Shell (sidebar, topbar title, theme toggle) | — | Grouped sidebar exactly as the 2026-10-08 mockup; active group opens itself |
| Dashboard | `/clinical` | All counts live; trend lines computed (new this week / new today) |
| My Caseload | `/clinical/caseload` | Priority column and RED / ORANGE tile from the latest signed triage |
| Appointments | `/clinical/appointments` | Check in / Cancel kept as row actions |
| Registration (3 identity tiers) | `/clinical/registration` | Idempotent submit; identity resolution at `?resolve=<patientId>` confirms a temporary record without opening a new encounter |
| Triage worklist / encounter / re-check | `/clinical/triage`, `/clinical/triage/:id` | Server-side drafts (every control); recommendation computed by `triage_rules.py`, version stored with each signed record |
| Psychiatric queue | `/clinical/psychiatry` | Opening a review moves the episode waitlist → active |
| Client Record (Snapshot, Timeline, Charts, Legal & consent, Journey stages) | `/clinical/clients/:id/:view` | Snapshot/Timeline/Charts/Legal are built from real data: the v4 workflow file that defined them was never supplied |
| Inpatient / Ward Board | `/clinical/inpatient`, `/clinical/inpatient/ward` | Admission joins the episode, records an Admission charge |
| Outpatient Care (3 psychotherapy items) | `/clinical/psychotherapy/:kind` | Treatment plan = episode CarePlan |
| Documents + signed triage view | `/clinical/documents`, `/clinical/documents/:id` | |
| Billing (+ Journey billing stage) | `/clinical/billing` | Rates from the facility tariff (`/org-admin/service-tariff`); unpriced services excluded with a notice |
| Reports | `/clinical/reports` | |
| Discharge planning | `/clinical/discharge` | Signed, versioned discharge (docs/17); replaces the free-text discharge |
| Follow-up | `/clinical/follow-up` | Upcoming, overdue, missed and "discharged, no follow-up booked" (docs/17) |
| Referral worklist / documents | `/clinical/referrals`, `/clinical/referrals/documents` | Reuse the Psychiatric queue and Documents screens |
| Audit log | `/org-admin/audit-log` | Org Admin and Auditor only; values never shown (docs/17) |

**Owner decisions recorded 2026-10-07**

- Triage vital-sign thresholds, the 10-minute triage target and the re-check intervals
  (RED 15, ORANGE 30, YELLOW 60, GREEN 120 minutes) are approved as implemented in
  `triage_rules.py` (rules version `2026-10-07.1`).
- PHQ-9 / GAD-7 severity bands are approved as implemented in `record/severity.ts`.
- Admissions capture their legal basis at creation: an involuntary admission requires legal
  status, order reference, order date and authorising professional; a voluntary admission
  requires a consent status. Enforced by the API and captured on the v3 admission form.
- Data-sharing consent is recorded against facility-approved wording set by an Org Admin
  (`/org-admin/consent-wording`); every consent record keeps a copy of the exact version shown.
- Snapshot, Timeline, Charts and Legal & consent are built as working views from the record
  (episode and waiting time, alert resolution, filtered timeline, threshold-marked charts,
  consent capture and admission legal-status updates).

**Still open — cannot be settled by confirmation (CLAUDE.md §6)**

These need the actual value from the named source; a confirmed-but-invented code would
validate and fail silently.

- VERIFY: canonical base URL for local CodeSystems (national IG).
- VERIFY: Encounter.class code for an outpatient triage encounter (v3 ActCode, hl7.org).
- VERIFY: LOINC codes for each vital sign and for PHQ-9 / GAD-7 totals (loinc.org) before
  these are exported as FHIR Observations.
- Facility tariff rates are entered by the facility on the Service Tariff page.
- Care-plan action titles/goals and intervention text are free text, as in the mockup; a
  value set for them is a future decision.
