"""
Signed triage assessment, printed in the shared document layout.

The question wording and value sets below are the same table the signed
triage page uses (frontend/src/modules/care/SignedTriageDocumentPage.tsx,
ITEMS / SECTION_TITLES), generated from it on 2026-11-05 so the printed and
on-screen wording match. Coded answers are translated through the served
labels (services.concept_labels) — nothing here hard-codes a display for a code.
"""

SECTION_TITLES = [
    ("a", "A — Automatic Information"),
    ("b", "B — Triage Encounter"),
    ("c", "C — What Is Happening Right Now?"),
    ("d", "D — Immediate Safety: Suicide / Self-Harm"),
    ("e", "E — Risk of Harm to Others"),
    ("f", "F — Acute Mental State"),
    ("g", "G — Alcohol & Other Substances"),
    ("h", "H — Urgent Medical Screen"),
    ("i", "I — Safeguarding & Vulnerability"),
    ("j", "J — Immediate Functional Safety"),
    ("k", "K — Client Not Physically Present: Telephone / Third-Party Screen"),
    ("l", "L — Automatic Triage Summary"),
    ("m", "M — Triage Priority"),
    ("n", "N — Immediate Action / Disposition"),
]

YES_NO_FAMILY = [
    "no-yes-unable",
    "no-yes-unknown",
    "no-yes-uncertain",
    "yes-no-uncertain",
    "yes-no-unknown",
    "no-yes-unsure",
    "no-yes",
    "yes-no",
]

# key -> (question wording, value sets the answer is coded in or None)
ITEMS = {
    "a_allergy_status": ("Allergy status", ["triage-allergy-status"]),
    "a_allergy_detail": ("Allergy detail", None),
    "b_third_party": ("Name / relationship if third party", None),
    "b_encounter_type": ("Encounter type", ["triage-encounter-type"]),
    "b_informant": ("Who is providing the information?", ["triage-informant"]),
    "b_present": ("Is the client physically present?", YES_NO_FAMILY),
    "c_concern": ("Main concern in the client's or informant's own words", None),
    "c_onset": ("When did this begin or become worse?", ["triage-onset"]),
    "c_description": ("Brief description", None),
    "d_suicidal": (
        "Currently having thoughts of killing or seriously harming yourself?",
        YES_NO_FAMILY,
    ),
    "d_act_now": ("Thinking about acting on these thoughts now?", YES_NO_FAMILY),
    "d_attempt": ("Anything recently done to kill or seriously harm yourself?", YES_NO_FAMILY),
    "d_means": ("Known access to means of serious self-harm?", YES_NO_FAMILY),
    "d_safety": ("Can the client currently maintain their own safety?", YES_NO_FAMILY),
    "d_what_happened": ("What happened and when?", None),
    "e_thoughts": ("Current thoughts of seriously harming someone else?", YES_NO_FAMILY),
    "e_behaviour": ("Recent threatening, aggressive or violent behaviour?", YES_NO_FAMILY),
    "e_act": ("Recent violent act?", YES_NO_FAMILY),
    "e_means": ("Known access to means of serious harm?", YES_NO_FAMILY),
    "e_danger": ("Current behaviour suggests immediate danger?", YES_NO_FAMILY),
    "e_concern": ("Who/what is the concern?", None),
    "f_change": ("Major change in mental state now?", YES_NO_FAMILY),
    "f_features": ("Observed features", ["triage-mental-state-feature"]),
    "f_consciousness": ("Level of consciousness", ["triage-consciousness"]),
    "f_orientation": ("Orientation", ["triage-orientation"]),
    "f_behaviour": ("Behaviour", ["triage-behaviour"]),
    "f_observation": ("Clinician observation", None),
    "g_use": ("Recent alcohol or other substance use?", YES_NO_FAMILY),
    "g_intoxication": ("Current intoxication", ["triage-intoxication"]),
    "g_stopped": ("Recently stopped or reduced heavy use?", YES_NO_FAMILY),
    "g_seizure": ("Previous withdrawal seizure?", YES_NO_FAMILY),
    "g_withdrawal": ("Current withdrawal symptoms", ["triage-withdrawal-symptom"]),
    "h_concern": ("Immediate physical/medical concern?", YES_NO_FAMILY),
    "h_flags": ("Immediate concerns", ["triage-medical-concern"]),
    "h_bp": ("BP", None),
    "h_pulse": ("Pulse", None),
    "h_rr": ("Resp. rate", None),
    "h_temp": ("Temp", None),
    "h_spo2": ("SpO₂", None),
    "h_glucose": ("Blood glucose", None),
    "i_safe": ("Do you feel safe where you currently live or stay?", ["triage-feels-safe"]),
    "i_flags": ("Concerns", ["triage-safeguarding-concern"]),
    "i_return": ("Safe to return to current environment?", YES_NO_FAMILY),
    "j_concern": (
        "Immediate concern that the person cannot safely care for basic needs?",
        YES_NO_FAMILY,
    ),
    "j_flags": ("Areas", ["triage-functional-area"]),
    "k_where": ("Where is the client now?", None),
    "k_alone": ("Are they alone?", YES_NO_FAMILY),
    "k_with": ("Who is physically with them?", None),
    "k_last_seen": ("When did the caller last see or speak with them?", None),
    "k_cause": ("What exactly is causing concern?", None),
    "k_bring": ("Can the person be brought safely for assessment?", YES_NO_FAMILY),
    "k_emergency": ("Is emergency assistance required?", YES_NO_FAMILY),
    "k_flags": ("Concern reported", ["triage-telephone-concern"]),
    "n_actions": ("Actions", ["triage-action"]),
    "n_owner": ("Responsible person/team", None),
    "n_status": ("Status", ["task-status"]),
}
