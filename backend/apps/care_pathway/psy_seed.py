"""
Seed data for the Psychotherapy Session note. Seeding only: once loaded, the
registry and lexicons are database-owned and served (PSY-TM-03, PSY-RD), so a
change is a data edit, not a release.

ASSUMPTION / VERIFY: every list here is a synthetic demo starting point and
needs clinical-governance sign-off before go-live. None of it is a coded
clinical concept (no SNOMED CT / LOINC / ICD codes are used or implied).
"""

# PSY-TM — the eight seed models; concepts verbatim from master prompt §7.
# Aliases are the ways a clinician may name the model in Q3.
THERAPY_MODELS = [
    ("cbt", "CBT", ["CBT", "cognitive behavioural therapy", "cognitive behavioral therapy"],
     ["Thoughts", "emotions", "behaviours", "cognitive patterns", "restructuring",
      "behavioural strategies", "coping skills"]),
    ("dbt", "DBT", ["DBT", "dialectical behaviour therapy", "dialectical behavior therapy"],
     ["Emotion regulation", "distress tolerance", "mindfulness", "interpersonal effectiveness",
      "validation", "skills practice"]),
    ("motivational_interviewing", "Motivational Interviewing", ["motivational interviewing"],
     ["Ambivalence", "change talk", "sustain talk", "readiness", "values", "autonomy", "OARS"]),
    ("seeking_safety", "Seeking Safety", ["Seeking Safety"],
     ["Safety", "coping skills", "trauma/substance connection", "grounding", "healthy relationships"]),
    ("tf_cbt", "Trauma-Focused CBT", ["TF-CBT", "trauma-focused CBT", "trauma focused CBT",
                                      "trauma-focused cognitive behavioural therapy"],
     ["Psychoeducation", "coping skills", "gradual trauma processing", "cognitive coping",
      "caregiver involvement"]),
    ("schema_therapy", "Schema Therapy", ["schema therapy"],
     ["Schemas", "modes", "unmet emotional needs", "triggers", "coping responses",
      "healthy-adult responses"]),
    ("grief_focused", "Grief-Focused Therapy", ["grief-focused therapy", "grief focused therapy",
                                                "grief therapy"],
     ["Loss", "grief responses", "meaning", "adjustment", "continuing bonds", "restoration"]),
    ("supportive", "Supportive Psychotherapy", ["supportive psychotherapy", "supportive therapy"],
     ["Validation", "emotional processing", "coping", "strengths", "problem solving", "support"]),
]

# PSY-RD — possible safety language, by the categories the master prompt lists.
RISK_TERMS = {
    "suicide": ["suicide", "suicidal", "kill myself", "end my life", "ending it", "end it all",
                "want to die", "wants to die", "better off dead", "no reason to live",
                "take my own life", "took an overdose", "overdose"],
    "self_harm": ["self-harm", "self harm", "self-harming", "harm myself", "hurt myself",
                  "cutting", "cut myself", "burned myself"],
    "harm_to_others": ["kill him", "kill her", "kill them", "hurt someone", "hurt him", "hurt her",
                       "threatened", "threatening", "weapon"],
    "abuse_exploitation": ["abuse", "abused", "abusive", "assaulted", "hit me", "beats me",
                           "exploited", "exploitation", "forced me"],
    "unsafe_home": ["unsafe at home", "not safe at home", "afraid to go home", "scared to go home"],
    "severe_deterioration": ["can't get out of bed", "cannot get out of bed", "stopped eating",
                             "not eating", "not slept", "hearing voices"],
    "intoxication_withdrawal": ["intoxicated", "drunk", "withdrawal", "withdrawing", "the shakes",
                                "seizure", "blackout", "blacked out"],
    "self_care": ["not washing", "can't look after myself", "cannot look after myself",
                  "unable to care for", "neglecting myself"],
}

# PSY-GEN-11 — stigmatizing terms with a suggested behavioural rewrite.
_DESCRIBE = "Describe the behaviour and what the client said, rather than a label."
STIGMA_TERMS = [
    ("manipulative", "Describe the behaviour, e.g. \"repeatedly requested a change to the agreed plan "
                     "and expressed frustration when this was not possible\"."),
    ("non-compliant", "Describe what happened, e.g. \"reported difficulty following the agreed plan and "
                      "identified transportation and cost as barriers\"."),
    ("noncompliant", "Describe what happened, e.g. \"reported difficulty following the agreed plan and "
                     "identified transportation and cost as barriers\"."),
    ("non compliant", "Describe what happened, e.g. \"reported difficulty following the agreed plan and "
                      "identified transportation and cost as barriers\"."),
    ("attention-seeking", _DESCRIBE),
    ("attention seeking", _DESCRIBE),
    ("drug-seeking", "Describe the request and the context, e.g. \"asked for an increase in medication "
                     "for pain\"."),
    ("addict", "Person-first language, e.g. \"person who uses substances\"."),
    ("junkie", "Person-first language, e.g. \"person who uses substances\"."),
    ("alcoholic", "Person-first language, e.g. \"person who uses alcohol\"."),
    ("abuser", "Person-first language, e.g. \"person who uses substances\"."),
    ("refused", "\"Declined\" — and the reason the client gave, if known."),
    ("in denial", "Describe the client's own view in their words."),
    ("unmotivated", "Describe what the client said about change (readiness, ambivalence, barriers)."),
    ("lazy", _DESCRIBE),
    ("difficult client", _DESCRIBE),
    ("difficult patient", _DESCRIBE),
    ("frequent flyer", "Describe the attendance pattern factually."),
    ("resistant", "Describe what the client said or did, e.g. \"expressed reservations about…\"."),
    ("resistance", "Describe what the client said or did, e.g. \"expressed reservations about…\"."),
    ("committed suicide", "Use \"died by suicide\"."),
]
# Added after the first seeding (migration 0042 loads only these).
STIGMA_TERMS_V2 = ("resistant", "resistance", "committed suicide", "unmotivated")

# PSY-GEN-3 — a sentence carrying one of these is the client's report.
REPORT_CUES = ["reported", "reports", "said", "says", "stated", "states", "told", "tells",
               "described", "describes", "shared", "shares", "explained", "explains",
               "mentioned", "disclosed", "discloses", "complained", "complains", "expressed",
               "expresses", "according to the client", "in their words"]


def lexicon_rows():
    """(lexicon, category, phrase, suggestion) for every seed term."""
    rows = [("PSY_RISK", cat, p, "") for cat, phrases in RISK_TERMS.items() for p in phrases]
    rows += [("PSY_STIGMA", "", p, s) for p, s in STIGMA_TERMS]
    rows += [("PSY_REPORT_CUE", "", p, "") for p in REPORT_CUES]
    return rows


# Safety-concern choices beyond the risk-register rows (YES answers).
OTHER_CONCERNS = [
    ("severe_deterioration", "Severe deterioration"),
    ("intoxication_withdrawal", "Intoxication or withdrawal"),
    ("other_immediate", "Another immediate safety concern"),
]
ATTENDANCE_MODES = [("IN_PERSON", "In person"), ("VIRTUAL", "Virtual (video)"), ("TELEPHONE", "Telephone")]

# PSY-S YES: the eight concern categories the safety question names (served
# value set `psy-safety-concern`). Local codes — not SNOMED CT.
SAFETY_CONCERNS = [
    ("suicide", "Suicide"),
    ("self_harm", "Self-harm"),
    ("harm_to_others", "Harm to others"),
    ("abuse_exploitation", "Abuse or exploitation"),
    ("severe_deterioration", "Severe deterioration"),
    ("intoxication_withdrawal", "Intoxication or withdrawal"),
    ("self_care", "Inability to care for self"),
    ("other_immediate", "Other immediate safety concern"),
]
# Concern category → the risk-register row it maps to (intake_schema.RISK_ROWS),
# where one exists. A category with no register row raises the alert only.
CONCERN_REGISTER_ROW = {
    "suicide": "suicide",
    "self_harm": "suicide",
    "harm_to_others": "violence",
    "abuse_exploitation": "safeguarding",
    "self_care": "neglect",
}
# PSY-S YES: actions taken (served value set `psy-safety-action`). The safety-plan
# action is offered only when the client has an active signed safety plan.
SAFETY_ACTIONS = [
    ("safety_plan_reviewed", "Safety plan reviewed with client"),
    ("risk_assessment_completed", "Risk assessment completed in session"),
    ("supervisor_consulted", "Supervisor / senior clinician consulted"),
    ("support_person_involved", "Emergency contact or support person involved"),
    ("emergency_services_contacted", "Crisis or emergency services contacted"),
    ("frequency_increased", "Session frequency increased"),
]

# DATA-07 alert codes raised by this module (added to the `clinical-alert` value set).
ALERTS = [
    ("PSYCHOTHERAPY_SAFETY_CONCERN", "Psychotherapy session: new or changed safety concern"),
    ("SAFETY_NOT_ASSESSED", "Psychotherapy session: safety not assessed — review before signing"),
]
