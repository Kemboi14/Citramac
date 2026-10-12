"""
Intake & Clinical Assessment — the section schema (docs/15 §1.17; mockup v4
stage 3, INTAKE_SECS / SX_LIST / MSE_DOMAINS / RISK_ROWS).

The schema is *served* (GET care/intake/schema/) so the screen is rendered from
it rather than from a compiled list. Every drop-down is a value set id; the
option lists below seed `LocalValueSet` (migration) and are database-owned
afterwards. Codes are local — VERIFY: coding of these lists to SNOMED CT / ICD-11
must come from the terminology server, never from this file (CLAUDE.md §6).

A field is {key, label, type, ...}. Types: text, textarea, number, date,
datetime, select (valueset), multi (valueset), check. `restricted` fields are
returned only to treating-clinician roles (see `visible_to`).
"""

import re


def _code(display):
    return re.sub(r"[^A-Z0-9]+", "_", display.upper()).strip("_")[:48]


# ── option sets (valueset id → (title, [display, …])) ──
_OPTIONS = {
    "intake-presentation-type": (
        "Type of presentation",
        ["New problem", "Worsening existing problem", "Relapse", "Crisis",
         "Planned assessment/treatment", "Post-discharge follow-up", "Other"],
    ),
    "intake-info-source": (
        "Information sources",
        ["Client", "Family/other", "Referral record", "Previous record", "Clinician observation"],
    ),
    "intake-care-setting": (
        "Care setting",
        ["Outpatient", "Inpatient", "Detox", "Rehabilitation/Residential", "Emergency/Other"],
    ),
    "intake-symptoms": (
        "Current symptoms",
        ["Low mood", "Loss of interest/pleasure", "Anxiety/worry", "Panic", "Irritability/anger",
         "Mood swings", "Elevated/expansive mood", "Reduced need for sleep", "Racing thoughts",
         "Impulsivity", "Poor concentration", "Memory concerns", "Confusion/disorientation",
         "Hallucinations", "Delusions/suspiciousness", "Disorganised behaviour/thought",
         "Obsessions/compulsions", "Trauma symptoms", "Grief/loss", "Eating/appetite concern",
         "Sleep disturbance", "Somatic/physical complaints", "Other"],
    ),
    "intake-sleep-quality": ("Sleep quality", ["Good", "Fair", "Poor"]),
    "intake-appetite": ("Appetite / weight", ["No change", "Increased", "Reduced"]),
    "intake-energy": ("Energy", ["Normal", "Low", "Increased/fluctuating"]),
    "intake-concentration": ("Concentration / memory", ["No concern", "Mild", "Moderate", "Severe"]),
    "intake-adl": ("Self-care / ADLs", ["Independent", "Some difficulty", "Requires assistance"]),
    "intake-work-function": (
        "Work / school functioning",
        ["Unaffected", "Mildly affected", "Significantly affected", "Unable currently"],
    ),
    "intake-social-function": (
        "Social / relationship functioning",
        ["Unaffected", "Mildly affected", "Significantly affected", "Isolated/withdrawn"],
    ),
    "intake-sleep-problems": ("Sleep problems", ["Insomnia", "Hypersomnia", "Nightmares", "Other"]),
    "intake-risk-actions": (
        "Risk actions",
        ["Structured risk formulation completed", "Safety plan triggered",
         "Enhanced observation considered/ordered", "Urgent psychiatric review",
         "Emergency/medical escalation", "Safeguarding pathway"],
    ),
    "intake-none-yes-uncertain": ("None / yes / uncertain", ["None known", "Yes", "Uncertain"]),
    "intake-none-yes": ("None / yes", ["None", "Yes"]),
    "intake-medical-conditions": (
        "Medical conditions",
        ["No significant medical history known", "Hypertension", "Diabetes", "Cardiac disease",
         "Respiratory disease", "Liver disease", "Kidney disease", "Neurological disorder",
         "Epilepsy/seizures", "Head injury/TBI", "Chronic pain", "Infectious disease",
         "Pregnancy/postpartum concern", "Other"],
    ),
    "intake-srh": ("Sexual / reproductive health", ["None disclosed", "Yes", "Not assessed / not applicable"]),
    "intake-preg-status": (
        "Pregnancy / postpartum status",
        ["Not pregnant", "Pregnant", "Postpartum", "Not applicable", "Prefer not to say"],
    ),
    "intake-preg-test": ("Pregnancy test", ["Negative", "Positive", "Declined", "Not applicable"]),
    "intake-substance-kind": (
        "Main substance",
        ["None", "Alcohol", "Opioids", "Benzodiazepines", "Stimulants", "Cannabis",
         "Khat (miraa)", "Poly-substance", "Unknown"],
    ),
    "intake-injecting": (
        "Injecting drug use",
        ["No — never injected", "Yes — currently", "Yes — in the past", "Declined to say"],
    ),
    "intake-harm-reduction": (
        "Harm-reduction measures",
        ["Needle & syringe programme information given", "Naloxone kit offered",
         "HIV & hepatitis B/C testing offered", "Hepatitis B vaccination offered",
         "Safer-injecting & vein care discussed", "Wound / abscess check done"],
    ),
    "intake-substance-features": (
        "Substance use features",
        ["Tolerance", "Craving", "Loss of control", "Withdrawal", "Blackouts", "Overdose history",
         "Seizure history", "Substance-related psychosis"],
    ),
    "intake-substance-consequences": (
        "Substance use consequences",
        ["Legal consequences", "Financial consequences", "Relationship consequences",
         "Work/school consequences", "Medical consequences", "Risky use"],
    ),
    "intake-dev-concern": ("Developmental", ["None known", "Yes", "Unknown"]),
    "intake-dev-milestones": ("Milestones", ["Reported typical", "Delay/concern", "Unknown"]),
    "intake-trauma-enquiry": (
        "Trauma enquiry",
        ["Not yet asked", "Offered — client chose to discuss", "Deferred — client not ready", "Declined"],
    ),
    "intake-trauma-types": (
        "Trauma / adversity",
        ["No trauma disclosed", "Childhood adversity", "Physical violence", "Sexual violence",
         "Emotional abuse", "Neglect", "Domestic/intimate partner violence", "Community violence",
         "War/displacement", "Accident/injury", "Medical trauma", "Sudden/traumatic loss",
         "Other significant adversity"],
    ),
    "intake-trauma-flags": (
        "Trauma flags",
        ["Trauma symptoms identified", "Immediate safeguarding concern identified"],
    ),
    "intake-sen": ("Special educational needs", ["None", "Yes", "Unknown"]),
    "intake-employment": (
        "Employment status",
        ["Employed", "Self-employed", "Student", "Unemployed", "Retired", "Other"],
    ),
    "intake-financial": ("Financial stress", ["None", "Mild", "Significant", "Crisis"]),
    "intake-living": (
        "Living situation",
        ["Alone", "Family", "Partner", "Shared", "Residential/institutional",
         "Unhoused/unstable", "Other"],
    ),
    "intake-housing": ("Housing", ["Stable/safe", "Concern", "Immediate problem"]),
    "intake-isolation": ("Social isolation", ["No", "Some", "Significant"]),
    "intake-forensic": (
        "Legal / forensic",
        ["No known legal/forensic concerns", "Current court matter", "Probation/parole",
         "Previous arrest/conviction", "Violence-related matter", "Substance-related matter",
         "Mental Health Act / involuntary care history", "Police involvement in current presentation",
         "Other"],
    ),
    "intake-strengths": (
        "Strengths & protective factors",
        ["Supportive relationships", "Children/family responsibilities", "Future goals",
         "Faith/spirituality", "Employment/education", "Stable housing", "Problem-solving skills",
         "Treatment engagement", "Reasons for living", "Coping skills", "Community connection",
         "Previous recovery/success", "Other"],
    ),
    "intake-barriers": (
        "Barriers to care",
        ["None", "Transport", "Cost", "Work/family", "Stigma", "Motivation",
         "Cognitive/communication", "Other"],
    ),
    "intake-readiness": (
        "Readiness for change",
        ["Not ready", "Unsure/ambivalent", "Ready", "Already taking action"],
    ),
    "intake-care-needs": (
        "Initial care needs",
        ["Psychiatric review", "Medical review", "Detox/withdrawal management",
         "Safety plan/enhanced observation", "Psychological therapy", "Inpatient admission",
         "Residential rehabilitation", "Outpatient care", "Family intervention",
         "Social work/case management", "Nutrition/fitness", "Referral/emergency transfer"],
    ),
    "intake-falls": ("Falls risk", ["Low", "Moderate — tremor / sedation / night-time toileting", "High"]),
    "intake-pressure": ("Pressure areas", ["Low", "At risk", "Damage present"]),
    "intake-continence": ("Continence", ["Continent", "Needs support", "Incontinent"]),
    "intake-nursing-sleep": ("Sleep", ["Good", "Poor", "Very poor"]),
    "intake-hygiene": ("Personal hygiene", ["Independent", "Needs prompting", "Needs assistance"]),
    "intake-reliability": (
        "Reliability of account",
        ["Reliable", "Partly reliable", "Limited — collateral needed", "Unable to assess"],
    ),
    "intake-orientation": ("Orientation", ["Oriented", "Partly oriented", "Disoriented", "Unable to assess"]),
    "intake-status": (
        "Intake status",
        ["Complete", "Partially complete — clinically safe to continue later", "Unable to complete"],
    ),
    "intake-dx-status": ("Diagnosis status", ["Provisional", "Working", "Confirmed", "Ruled out"]),
    "intake-concern-level": ("Level of concern", ["Low", "Moderate", "High"]),
    "intake-marital": (
        "Relationship / marital status",
        ["Single", "Married", "Cohabiting", "Separated / divorced", "Widowed", "Not stated"],
    ),
    "intake-med-status": ("Medication status", ["Taking", "Stopped", "Intermittent", "Unknown"]),
}

# MSE domains: key → (label, valueset id or None for free text). Stored in
# triage.MentalStatusExam (one store — CLAUDE.md §4); the options are served.
MSE_DOMAINS = [
    ("appearance", "Appearance & self-care", ["Appropriate", "Dishevelled", "Unusual", "Other"]),
    ("behavior", "Behaviour", ["Calm/cooperative", "Guarded", "Withdrawn", "Agitated", "Disinhibited", "Other"]),
    ("rapport", "Rapport & engagement", ["Good", "Fair", "Limited", "Unable to establish"]),
    ("psychomotor", "Psychomotor activity", ["Normal", "Slowed", "Increased", "Restless", "Abnormal movements"]),
    ("speech", "Speech", ["Normal", "Reduced", "Pressured", "Rapid", "Slow", "Loud", "Soft", "Incoherent", "Other"]),
    ("mood", "Mood (subjective — client’s words)", None),
    ("affect", "Affect (observed)", ["Appropriate", "Restricted", "Blunted", "Flat", "Labile", "Anxious", "Irritable", "Elevated", "Other"]),
    ("thought_process", "Thought form", ["Linear/goal-directed", "Circumstantial", "Tangential", "Flight of ideas", "Disorganised", "Thought blocking", "Other"]),
    ("thought_content", "Thought content", ["No abnormality", "Hopelessness", "Guilt", "Preoccupation", "Delusions", "Obsessions", "Suicidal", "Homicidal", "Other"]),
    ("perception", "Perception", ["No disturbance", "Auditory hallucinations", "Visual hallucinations", "Other hallucinations", "Illusions", "Dissociation"]),
    ("cognition", "Alertness & memory", ["Alert", "Drowsy", "Memory impaired"]),
    ("insight", "Insight", ["Good", "Partial", "Limited", "Absent"]),
    ("judgment", "Judgement", ["Intact", "Impaired", "Difficult to assess"]),
    ("impulse_control", "Impulse control", ["Intact", "Reduced", "Significantly impaired"]),
]
# Quick-fill for a normal examination (mockup MSE_NORMAL) — clinician edits after.
MSE_NORMAL = {
    "appearance": "Appropriately dressed, good self-care",
    "behavior": "Calm and cooperative",
    "rapport": "Good rapport",
    "psychomotor": "Normal",
    "speech": "Normal rate, volume and tone",
    "affect": "Reactive, congruent",
    "thought_process": "Linear and goal-directed",
    "thought_content": "No suicidal or homicidal ideation; no delusions",
    "perception": "No perceptual disturbance",
    "cognition": "Alert; memory grossly intact",
    "insight": "Good",
    "judgment": "Intact",
    "impulse_control": "Intact",
    "orientation": "Oriented to time, place and person",
    "attention": "Intact (months backwards)",
    "reliability": "Reliable",
}
for _key, _label, _opts in MSE_DOMAINS:
    if _opts:
        _OPTIONS[f"mse-{_key.replace('_', '-')}"] = (_label, _opts)

# Risk register rows (mockup RISK_ROWS). `active` options make the row a live risk.
RISK_ROWS = [
    {"key": "suicide", "label": "Suicide / self-harm",
     "options": ["None identified", "Thoughts", "Intent", "Plan", "Access to means",
                 "Recent attempt/self-harm", "Past history"],
     "none": ["None identified"],
     "active": ["Thoughts", "Intent", "Plan", "Access to means", "Recent attempt/self-harm"]},
    {"key": "violence", "label": "Harm to others / violence",
     "options": ["None identified", "Thoughts", "Threats", "Intent", "Plan", "Access to means",
                 "Recent violence", "Past history"],
     "none": ["None identified"],
     "active": ["Thoughts", "Threats", "Intent", "Plan", "Access to means", "Recent violence"]},
    {"key": "neglect", "label": "Difficulty with self-care / vulnerability",
     "options": ["None", "Difficulty with self-care", "Unable to meet basic needs",
                 "Exploitation/vulnerability concern"],
     "none": ["None"],
     "active": ["Difficulty with self-care", "Unable to meet basic needs",
                "Exploitation/vulnerability concern"]},
    {"key": "safeguarding", "label": "Safeguarding",
     "options": ["None identified", "Abuse", "Neglect", "Sexual violence/exploitation",
                 "Child concern", "Elder/vulnerable adult concern"],
     "none": ["None identified"],
     "active": ["Abuse", "Neglect", "Sexual violence/exploitation", "Child concern",
                "Elder/vulnerable adult concern"]},
    {"key": "absconding", "label": "Leaving care without agreement",
     "options": ["None", "Possible", "Significant"], "none": ["None"], "single": True,
     "active": ["Possible", "Significant"]},
    {"key": "medical", "label": "Falls / medical safety",
     "options": ["None", "Concern identified"], "none": ["None"], "single": True,
     "active": ["Concern identified"]},
]

# ── fields ──


def F(key, label, type="text", **extra):
    return {"key": key, "label": label, "type": type, **extra}


def sel(key, label, vs, **extra):
    return F(key, label, "select", valueset=vs, **extra)


def multi(key, label, vs, **extra):
    return F(key, label, "multi", valueset=vs, **extra)


SECTIONS = [
    {"key": "hdr", "n": "0", "title": "Encounter details", "core": False, "fields": [
        sel("care_setting", "Care setting", "intake-care-setting"),
        F("clinician", "Clinician completing intake"),
        multi("sources", "Information sources", "intake-info-source"),
    ]},
    {"key": "pres", "n": "1", "title": "Presenting concern & reason for care", "core": True,
     "required": True, "fields": [
        F("own", "Client’s own description — “What brings you here / what would you like help with?”",
          "textarea", rows=3, full=True, required=True),
        F("referral", "Referral concern / concern described by family or other source",
          "textarea", rows=2, full=True),
        F("onset", "Onset / duration"),
        F("why_now", "What has changed recently? What made the client seek care now?", "textarea", rows=2),
        multi("type", "Type of presentation", "intake-presentation-type"),
        F("goals", "Client’s goals and expectations — “What would you like to be different?”",
          "textarea", rows=2, full=True, hint="Carried into the Care Plan goals"),
    ]},
    {"key": "sx", "n": "2", "title": "Current symptoms & functioning", "core": True, "fields": [
        multi("list", "Current symptoms", "intake-symptoms",
              highlight=["Hallucinations", "Delusions/suspiciousness", "Confusion/disorientation"]),
        F("hpi", "Describe current symptoms, severity, frequency, triggers and impact",
          "textarea", rows=4, full=True),
        F("sleep_hours", "Sleep — hours / night", "number", unit="h"),
        sel("sleep_quality", "Sleep quality", "intake-sleep-quality"),
        sel("appetite", "Appetite / weight", "intake-appetite"),
        F("weight_change", "Recent weight change"),
        sel("energy", "Energy", "intake-energy"),
        sel("concentration", "Concentration / memory", "intake-concentration"),
        sel("adl", "Self-care / ADLs", "intake-adl"),
        sel("work", "Work / school functioning", "intake-work-function"),
        sel("social", "Social / relationship functioning", "intake-social-function"),
        multi("sleep_problems", "Sleep problems", "intake-sleep-problems"),
    ]},
    {"key": "risk", "n": "3", "title": "Immediate & clinical risk", "core": True, "required": True,
     "kind": "risk", "fields": [
        F("other", "Other acute risk", full=True),
        F("details", "Immediate actions already taken", "textarea", rows=2, full=True),
        multi("actions", "Actions", "intake-risk-actions"),
        F("static", "Static factors (history — do not change)", "textarea"),
        F("dynamic", "Dynamic factors (current — can change)", "textarea"),
        F("protective", "Protective factors", "textarea"),
        F("change_72h", "What could change in the next 24–72 hours?", "textarea"),
        F("summary", "Formulation — how these fit together, and what would make things safer",
          "textarea", rows=3, full=True),
        F("plan", "Risk management plan", "textarea", full=True),
        F("review_by", "Review by", "date"),
        sel("concern_level", "Level of concern (optional — does not set priority)", "intake-concern-level"),
    ]},
    {"key": "mh", "n": "4", "title": "Mental health history", "core": False, "fields": [
        sel("prev_dx", "Previous mental health diagnosis/diagnoses", "intake-none-yes-uncertain"),
        F("first_age", "Age / period at first mental health difficulty"),
        sel("admissions", "Previous psychiatric admissions", "intake-none-yes"),
        F("admissions_detail", "Number / approximate dates"),
        sel("crisis", "Previous emergency / crisis presentations", "intake-none-yes"),
        sel("therapy", "Previous therapy / counselling", "intake-none-yes"),
        sel("psych_tx", "Previous psychiatric treatment", "intake-none-yes"),
        sel("past_attempts", "Past suicide attempts / self-harm", "intake-none-yes",
            hint="‘Yes’ is linked to the risk history in Section 3"),
        sel("past_violence", "Past aggression / violence related to illness", "intake-none-yes"),
        F("past_psych", "Previous diagnoses, episodes, admissions and significant clinical history",
          "textarea", rows=3, full=True),
        F("response", "Previous treatments / interventions and response (what helped / did not help)",
          "textarea", rows=3, full=True),
        F("prev_clinician", "Previous clinician / facility and relevant records available",
          "textarea", full=True),
    ]},
    {"key": "meds", "n": "5", "title": "Medications", "core": True, "required": True,
     "kind": "meds", "fields": [
        F("none", "No current medication", "check"),
        F("reconciled", "Medication reconciliation completed", "check"),
        F("unavailable", "Prescription / medication list unavailable — follow-up required", "check", full=True),
        F("non_adherence", "Reasons for non-adherence or treatment discontinuation, if applicable",
          "textarea", full=True),
    ]},
    {"key": "allergy", "n": "6", "title": "Allergies & adverse reactions", "core": True,
     "required": True, "kind": "allergy", "fields": []},
    {"key": "medical", "n": "7", "title": "Medical history, examination & physical baseline",
     "core": False, "fields": [
        multi("conditions", "Medical conditions", "intake-medical-conditions"),
        F("history", "Medical conditions, surgeries, hospitalisations", "textarea", rows=3, full=True),
        F("current", "Current physical symptoms / medical concerns", "textarea", full=True),
        F("provider", "Primary care / medical provider"),
        F("last_review", "Last medical review", "date"),
        sel("srh", "Sexual / reproductive health concerns relevant to care", "intake-srh"),
        F("weight", "Weight", "number", unit="kg", group="Physical-health baseline"),
        F("height", "Height", "number", unit="cm", group="Physical-health baseline"),
        F("waist", "Waist", "number", unit="cm", group="Physical-health baseline"),
        F("lipids", "Lipids (total / LDL)", group="Physical-health baseline"),
        F("hba1c", "HbA1c", unit="%", group="Physical-health baseline"),
        F("prolactin", "Prolactin", group="Physical-health baseline"),
        F("qtc", "ECG — QTc", "number", unit="ms", group="Physical-health baseline",
          hint="Required before QTc-prolonging drugs"),
        F("egfr", "Renal — eGFR", "number", unit="mL/min", group="Physical-health baseline",
          hint="Before lithium"),
        F("tsh", "Thyroid — TSH", group="Physical-health baseline", hint="Before lithium"),
        sel("preg_status", "Pregnancy / postpartum status", "intake-preg-status", group="Physical-health baseline",
            hint="Opens the perinatal depression screen (EPDS)"),
        sel("preg_test", "Pregnancy test", "intake-preg-test", group="Physical-health baseline",
            hint="Before valproate"),
        F("pe_general", "General (hydration, injuries, nutrition)", "textarea", group="Examination"),
        F("pe_cvs", "Cardiorespiratory", "textarea", group="Examination"),
        F("pe_neuro", "Neurological (pupils, focal signs, tremor, gait)", "textarea", group="Examination"),
        F("pe_other", "Other findings", "textarea", group="Examination"),
        F("pe_poc", "Point-of-care results (glucose, malaria RDT, HIV rapid test, pregnancy test, breath alcohol)",
          "textarea", full=True, group="Examination"),
    ]},
    {"key": "subs", "n": "8", "title": "Substance use", "core": True, "fields": [
        sel("kind", "Main substance", "intake-substance-kind",
            hint="Opens the right withdrawal chart in Interventions"),
        F("screen", "Other screening results (ASSIST / DUDIT / urine drug screen)"),
        multi("features", "Features", "intake-substance-features"),
        multi("consequences", "Consequences", "intake-substance-consequences"),
        sel("injecting", "Injecting drug use", "intake-injecting"),
        multi("harm_reduction", "Harm reduction", "intake-harm-reduction"),
        F("complications", "Past seizures, delirium tremens, overdoses (detail)", full=True),
        F("prev_tx", "Previous detox, rehabilitation, mutual-help / peer support, medication-assisted treatment and response",
          "textarea", rows=3, full=True),
        F("motivation", "Readiness to change and the client’s own substance-use goal",
          "textarea", rows=2, full=True),
    ], "list": "substances"},
    {"key": "family", "n": "9", "title": "Family history", "core": False, "fields": [
        F("history", "Family history of mental illness, suicide/self-harm, substance use/addiction or significant medical/neurological conditions",
          "textarea", rows=4, full=True),
        F("involvement", "Family relationships and current family involvement in care",
          "textarea", rows=3, full=True),
    ]},
    {"key": "dev", "n": "10", "title": "Developmental & childhood", "core": False, "fields": [
        sel("pregnancy_birth", "Pregnancy / birth / developmental concerns", "intake-dev-concern"),
        sel("milestones", "Developmental milestones", "intake-dev-milestones"),
        sel("learning", "Childhood learning / attention difficulties", "intake-none-yes"),
        sel("behaviour", "Childhood behavioural / emotional difficulties", "intake-none-yes"),
        F("caregivers", "Primary caregivers / upbringing", full=True),
        F("personal", "Significant childhood experiences, caregiving environment and developmental concerns",
          "textarea", rows=3, full=True),
    ]},
    {"key": "trauma", "n": "11", "title": "Trauma, adversity, grief & loss", "core": False, "fields": [
        sel("enquiry", "Trauma enquiry", "intake-trauma-enquiry"),
        multi("types", "Types of trauma / adversity disclosed", "intake-trauma-types", restricted=True),
        F("detail", "Relevant history and current impact — brief, non-graphic (restricted access)",
          "textarea", rows=3, full=True, restricted=True,
          hint="Restricted: visible only to treating clinicians; never written to the trail and never attached to payer claims."),
        F("grief", "Significant grief, bereavement or unresolved losses", "textarea", full=True),
        multi("flags", "Flags", "intake-trauma-flags"),
    ]},
    {"key": "edu", "n": "12", "title": "Education, employment & finances", "core": False, "fields": [
        F("education", "Highest education / current study"),
        sel("sen", "Learning difficulties / special educational needs", "intake-sen"),
        F("occupation", "Current employment / occupation"),
        sel("status", "Employment status", "intake-employment"),
        F("impact", "Work / school impact of current condition"),
        sel("financial", "Financial stress / debt / basic-needs concern", "intake-financial"),
        F("detail", "Relevant education / employment history, strengths and current concerns",
          "textarea", rows=3, full=True),
    ]},
    {"key": "social", "n": "13", "title": "Relationships & social supports", "core": False, "fields": [
        sel("marital", "Relationship / marital status", "intake-marital"),
        F("children", "Children / dependants"),
        sel("living", "Living situation", "intake-living"),
        sel("housing", "Housing stability / safety", "intake-housing"),
        F("supports", "Main support people"),
        sel("isolation", "Social isolation / loneliness", "intake-isolation"),
        F("caregiving", "Caregiving responsibilities", full=True),
        F("detail", "Relationship dynamics, social stressors and available support",
          "textarea", rows=3, full=True),
    ]},
    {"key": "culture", "n": "14", "title": "Culture, spirituality & communication", "core": False, "fields": [
        F("language", "Preferred language"),
        F("interpreter", "Interpreter required"),
        F("communication", "Communication / literacy needs"),
        F("cultural", "Cultural considerations important to care"),
        F("faith", "Spiritual / faith beliefs or practices relevant to coping / care"),
        F("identity", "Gender / identity considerations the client wants respected in care"),
        F("values", "What should the team understand about the client’s values, beliefs, identity or community to provide respectful care?",
          "textarea", rows=3, full=True),
    ]},
    {"key": "forensic", "n": "15", "title": "Legal / forensic history", "core": False, "fields": [
        multi("items", "Legal / forensic", "intake-forensic"),
        F("detail", "Relevant legal / forensic history and current obligations",
          "textarea", rows=3, full=True),
    ]},
    {"key": "mse", "n": "16", "title": "Mental state examination", "core": True, "required": True,
     "kind": "mse", "fields": []},
    {"key": "strengths", "n": "17", "title": "Strengths & protective factors", "core": False, "fields": [
        multi("items", "Strengths and protective factors", "intake-strengths"),
        F("client", "Client-identified strengths: “What has helped you get through difficult times before?”",
          "textarea", rows=3, full=True),
        F("available", "Protective factors and resources available now", "textarea", rows=2, full=True),
        multi("barriers", "Barriers to care", "intake-barriers"),
    ]},
    {"key": "persp", "n": "18", "title": "Client perspective & what matters", "core": False, "fields": [
        F("understanding", "Client’s understanding of the problem", "textarea", full=True),
        sel("readiness", "Readiness for treatment / change", "intake-readiness"),
        F("prefs", "Preferred treatment approach / preferences"),
        F("matters", "What matters most to the client right now?", "textarea", rows=2, full=True,
          hint="Carried into the Care Plan (‘What matters to me’)"),
    ]},
    {"key": "form", "n": "19", "title": "Formulation & diagnosis", "core": True, "required": True,
     "kind": "formulation", "fields": [
        F("summary", "Integrated clinical summary / formulation", "textarea", rows=5, full=True),
        F("differential", "Differential diagnoses / conditions to rule out", "textarea", rows=2, full=True),
    ]},
    {"key": "tools", "n": "20", "title": "Assessment tools", "core": True, "kind": "tools", "fields": []},
    {"key": "impr", "n": "21", "title": "Clinical impression & care needs", "core": True, "fields": [
        multi("needs", "Initial care needs", "intake-care-needs",
              hint="Feeds the Care Plan recommendations"),
        F("priorities", "Immediate clinical priorities and rationale", "textarea", rows=3, full=True),
        F("setting", "Recommended setting / level of care and rationale", "textarea", rows=2, full=True),
    ]},
    {"key": "nurs", "n": "N", "title": "Nursing admission assessment", "core": False, "fields": [
        sel("falls", "Falls risk", "intake-falls"),
        sel("pressure", "Pressure areas", "intake-pressure"),
        F("nutrition", "Nutrition (screen score / concerns)"),
        sel("continence", "Continence", "intake-continence"),
        sel("sleep", "Sleep", "intake-nursing-sleep"),
        sel("hygiene", "Personal hygiene", "intake-hygiene"),
        F("property", "Property / belongings (where stored)"),
        F("orientation", "Orientation to ward (call bell, routines, rights)"),
        F("notes", "Nursing notes", "textarea", full=True),
    ]},
    {"key": "close", "n": "22", "title": "Completion & handover", "core": True, "kind": "close", "fields": [
        sel("status", "Intake status", "intake-status", required=True),
        F("reason_incomplete", "Reason incomplete"),
        F("pending", "Other pending items", full=True),
        F("next_review", "Next review / handover", "datetime"),
        F("message", "Key handover message — what must the next clinician know immediately?",
          "textarea", rows=3, full=True),
    ]},
]

SECTION_KEYS = [s["key"] for s in SECTIONS]
REQUIRED_SECTIONS = [s["key"] for s in SECTIONS if s.get("required")]
SECTION_STATES = ("Not started", "In progress", "Complete", "Not applicable")
RESTRICTED_FIELDS = {
    (s["key"], f["key"]) for s in SECTIONS for f in s["fields"] if f.get("restricted")
}


def option_valuesets():
    """{valueset id: (title, [(code, display), …])} — seeds LocalValueSet."""
    return {
        vs_id: (title, [(_code(d), d) for d in displays])
        for vs_id, (title, displays) in _OPTIONS.items()
    }


def risk_rows_served():
    return [
        {**row, "valueset": None, "optionCodes": {o: _code(o) for o in row["options"]}}
        for row in RISK_ROWS
    ]


def served_schema():
    return {
        "version": "1",
        "sections": SECTIONS,
        "required": REQUIRED_SECTIONS,
        "riskRows": risk_rows_served(),
        "mseDomains": [
            {"key": k, "label": label, "valueset": f"mse-{k.replace('_', '-')}" if opts else None}
            for k, label, opts in MSE_DOMAINS
        ],
        "mseNormal": MSE_NORMAL,
        "sectionStates": list(SECTION_STATES),
    }


def strip_restricted(sections, can_view):
    """Remove restricted field values unless the viewer may see them."""
    if can_view:
        return sections
    cleaned = {}
    for key, payload in (sections or {}).items():
        if isinstance(payload, dict):
            cleaned[key] = {
                f: v for f, v in payload.items() if (key, f) not in RESTRICTED_FIELDS
            }
        else:
            cleaned[key] = payload
    return cleaned
