"""
Triage v4 — the client-approved v4 triage model (owner instruction 2026-10-16),
ported from mockups/citramac_patient_workflow_v4.html: FLAGS / FLAG_GROUPS, the
suicidality ladder (SUIC, SUIC_WHEN, PREP), self-harm lethality (SH), DISTRESS,
the telephone / third-party screen (REMOTE_MENTAL, REMOTE_MED, DISPOSITIONS),
the vital-sign range checks (VRANGE, NM_REASONS, ACVPU) and `recommend()`.

DEMO RULESET — REQUIRES CLINICAL GOVERNANCE SIGN-OFF (TRI-M-07). The rules are
data (`RULES`, generated flag rules included): findings → minimum priority +
reason string. Nothing here is approved clinical policy; every threshold taken
from the mockup is labelled "illustrative — from client mockup, VERIFY". Any
change is a clinical decision: bump `RULES_VERSION`, because a signed triage
stores the version that produced its recommendation and is never re-evaluated.

The v3 rule set (`triage_rules.py`, RULES_VERSION "2026-10-07.1") stays as it
is for reading triages signed before v4. A v4 answer set carries
`"schema": "v4"`; anything without it is v3-shaped.

Answers are flat, coded keys (every option list is a served LocalValueSet in
`VALUESETS` below). Keys shared with v3 keep their v3 meaning and value set:
b_encounter_type, b_informant, b_present, b_third_party, c_concern, c_onset,
a_allergy_status, a_allergy_detail, m_* (priority decision) and n_* (actions).
"""

from datetime import datetime, timedelta

from django.utils.dateparse import parse_datetime

from . import ews
from .interventions import NOT_MEASURED_REASONS, OBS_LEVELS, VITAL_RANGES

RULES_VERSION = "v4-demo"
RULESET_LABEL = "DEMO RULESET — REQUIRES CLINICAL GOVERNANCE SIGN-OFF"
SCHEMA = "v4"

PRIORITY_RANK = {"GREEN": 0, "YELLOW": 1, "ORANGE": 2, "RED": 3}
PRIORITY_NAME = {"RED": "Emergency", "ORANGE": "Urgent", "YELLOW": "Priority", "GREEN": "Routine"}

# EWS → minimum priority (mockup recommend(): score ≥ 5 or ACVPU C/V/P/U → Emergency;
# score ≥ 3 or any single parameter scoring 3 → Urgent). The EWS bands themselves
# come from ews.py. Illustrative — from client mockup, VERIFY.
EWS_PRIORITY = {"RED_AT_OR_ABOVE": 5, "ORANGE_AT_OR_ABOVE": 3}
# Minutes after signing before a "Complete vital signs" task is due (mockup
# patientPending: addMin(t.at, 30)). Illustrative — from client mockup, VERIFY.
VITALS_COMPLETION_MINUTES = 30
# Arrival → seen by a clinician, by priority (mockup TARGET). Used only when the
# facility has not set SEEN_BY_CLINICIAN_TARGET_MINUTES. Illustrative — from
# client mockup, VERIFY.
SEEN_TARGET_MINUTES = {"RED": 0, "ORANGE": 15, "YELLOW": 30, "GREEN": 120}
# GBV: HIV PEP / emergency-contraception decision window from the time of
# incident (mockup: 72 h). Illustrative — from client mockup, VERIFY against the
# national GBV guideline.
PEP_WINDOW_HOURS = 72
# Override reason minimum length (mockup confirmTriage: "a full sentence").
OVERRIDE_REASON_MIN = 10

# ── Flags (mockup FLAGS). (code, display, group, level, hint) ──
# level: the minimum priority the flag implies on its own; "" = modifier only
# (access to lethal means works through the suicidality rules).
FLAGS = [
    ("recent_attempt", "Recent suicide attempt", "SELF", "RED", ""),
    (
        "overdose",
        "Overdose / ingestion",
        "SELF",
        "RED",
        "record substance, amount, time, co-ingestants and intent",
    ),
    (
        "lethal_means",
        "Access to lethal means",
        "SELF",
        "",
        "pesticides, firearm, stockpiled medication",
    ),
    ("threatening_others", "Threatening or aggressive towards others", "OTHERS", "ORANGE", ""),
    (
        "homicidal_named",
        "Homicidal ideation — named victim",
        "OTHERS",
        "RED",
        "opens the duty-to-protect steps",
    ),
    ("leaving_care", "Risk of leaving care without agreement", "OTHERS", "ORANGE", ""),
    ("altered_consciousness", "Altered consciousness / delirium", "MEDICAL", "RED", ""),
    ("psychosis_agitation", "Acute psychosis / severe agitation", "MEDICAL", "RED", ""),
    ("head_injury", "Head injury", "MEDICAL", "RED", ""),
    ("seizure", "Seizure", "MEDICAL", "RED", ""),
    ("catatonia", "Catatonia", "MEDICAL", "RED", ""),
    ("nms_serotonin", "Suspected NMS / serotonin syndrome", "MEDICAL", "RED", ""),
    (
        "lithium_toxicity",
        "Lithium toxicity signs",
        "MEDICAL",
        "RED",
        "coarse tremor, vomiting, diarrhoea, confusion, ataxia",
    ),
    (
        "clozapine",
        "Clozapine — fever, chest pain or severe constipation",
        "MEDICAL",
        "ORANGE",
        "myocarditis, neutropenia, ileus",
    ),
    ("postpartum", "Postpartum — psychosis or thoughts of harming the baby", "MEDICAL", "RED", ""),
    ("major_medical", "Major medical concern", "MEDICAL", "RED", ""),
    (
        "severe_withdrawal",
        "Severe intoxication / complicated withdrawal",
        "MEDICAL",
        "ORANGE",
        "alcohol or sedative withdrawal can be life-threatening",
    ),
    ("pregnancy", "Pregnancy / postpartum", "MEDICAL", "YELLOW", ""),
    ("self_care", "Severe difficulty with self-care", "MEDICAL", "YELLOW", ""),
    (
        "gbv_72h",
        "GBV / sexual violence < 72 h",
        "SAFEGUARDING",
        "ORANGE",
        "PEP & emergency-contraception window — record time of incident",
    ),
    ("child_protection", "Child protection concern", "SAFEGUARDING", "ORANGE", ""),
    ("safeguarding", "Safeguarding / vulnerability", "SAFEGUARDING", "YELLOW", ""),
    ("minor", "Minor (under 18)", "SAFEGUARDING", "YELLOW", ""),
    ("police_court", "Police custody / court order", "SAFEGUARDING", "YELLOW", ""),
]
FLAG = {code: {"display": d, "group": g, "level": lvl, "hint": h} for code, d, g, lvl, h in FLAGS}

# (code, title, screening question, answer key)
FLAG_GROUPS = [
    ("SELF", "Self-harm & suicide", "Any concerns about suicide or self-harm?", "screen_self"),
    ("OTHERS", "Risk to others", "Any concerns about risk to other people?", "screen_others"),
    ("MEDICAL", "Medical & physical", "Any medical or physical concerns?", "screen_medical"),
    (
        "SAFEGUARDING",
        "Safeguarding & legal",
        "Any safeguarding or legal concerns — or does the client not feel safe?",
        "screen_safeguarding",
    ),
]
GROUP_KEY = {code: key for code, _t, _q, key in FLAG_GROUPS}

# Remote (telephone / third-party) medical and mental-state reports, by the
# minimum priority each implies (mockup recommend(), present === "No").
REMOTE_MEDICAL = [
    ("seizures", "Seizures", "RED"),
    ("severe_shaking", "Severe shaking", "ORANGE"),
    ("hallucinations", "Hallucinations", "ORANGE"),
    ("confusion", "Confusion", "ORANGE"),
    ("loss_consciousness", "Loss of consciousness", "RED"),
    ("serious_injury", "Serious injury", "RED"),
    ("acute_medical", "Acute medical concern", "ORANGE"),
]
REMOTE_MENTAL = [
    ("extremely_confused", "Extremely confused", "ORANGE"),
    ("agitated", "Agitated", "YELLOW"),
    ("verbally_threatening", "Verbally threatening", "YELLOW"),
    ("physically_aggressive", "Physically aggressive to others", "ORANGE"),
    ("psychotic", "Psychotic", "ORANGE"),
    ("intoxicated", "Intoxicated", "YELLOW"),
    ("very_different", "Very different from usual", "YELLOW"),
]
SUBSTANCES = [
    ("alcohol", "Alcohol"),
    ("opioids", "Opioids"),
    ("cannabis", "Cannabis"),
    ("stimulants", "Stimulants"),
    ("sedatives", "Sedatives"),
    ("khat", "Khat (miraa)"),
    ("other", "Other"),
]
# Withdrawal from these alone is "distressing, rarely life-threatening" (mockup);
# alcohol, sedatives, "other" or an unknown mix is treated as potentially
# life-threatening.
NON_LIFE_THREATENING_WITHDRAWAL = {"opioids", "cannabis", "stimulants", "khat"}

# ── Served value sets (seeded by migration; the database is then the source) ──
VALUESETS = {
    "triage-v4-flag": ("Triage risk flags (v4)", [(c, d) for c, d, _g, _l, _h in FLAGS]),
    "triage-v4-flag-group": (
        "Triage screening areas (v4)",
        [(c, t) for c, t, _q, _k in FLAG_GROUPS],
    ),
    "triage-v4-suicidality": (
        "Suicidal thoughts",
        [
            ("none", "None reported"),
            ("passive", "Passive — wish to be dead"),
            ("active", "Active thoughts, no plan"),
            ("plan", "Active, with a plan"),
            ("intent", "Plan with intent"),
        ],
    ),
    "triage-v4-suicidality-when": (
        "When",
        [
            ("today", "Today / right now"),
            ("past_month", "In the past month, not today"),
            ("longer", "Longer ago than a month"),
        ],
    ),
    "triage-v4-preparatory": (
        "Any preparatory behaviour?",
        [
            ("no", "No"),
            ("yes", "Yes — e.g. gathered means, wrote a note, researched a method"),
            ("unknown", "Unknown"),
        ],
    ),
    "triage-v4-self-harm": (
        "Recent self-harm / attempt (this episode)",
        [
            ("none", "None"),
            ("low", "Superficial / low lethality"),
            ("high", "High lethality — deep wound, ingestion, ligature"),
        ],
    ),
    "triage-v4-distress": (
        "Distress / behaviour",
        [
            ("LOW", "Low — calm, engages easily"),
            ("MODERATE", "Moderate — worried or tearful, settles with reassurance"),
            ("HIGH", "High — very distressed or restless, hard to settle"),
            ("SEVERE", "Severe — cannot settle, shouting, or behaviour unsafe"),
        ],
    ),
    "triage-v4-acvpu": (
        "Consciousness (ACVPU)",
        [
            ("A", "A — alert"),
            ("C", "C — new confusion"),
            ("V", "V — responds to voice"),
            ("P", "P — responds to pain"),
            ("U", "U — unresponsive"),
            ("NA", "Not assessed"),
            ("UNABLE", "Unable — declined / too agitated"),
        ],
    ),
    "triage-v4-not-measured": (
        "Not measured — reason",
        [
            ("DECLINED", NOT_MEASURED_REASONS[0]),
            ("TOO_AGITATED", NOT_MEASURED_REASONS[1]),
            ("EQUIPMENT", NOT_MEASURED_REASONS[2]),
            ("NOT_INDICATED", NOT_MEASURED_REASONS[3]),
        ],
    ),
    "triage-v4-oxygen": ("Oxygen", [("room_air", "Room air"), ("supplemental", "Supplemental O₂")]),
    "triage-v4-observation-level": (
        "Observation level",
        [(code, display) for code, (display, _m) in OBS_LEVELS.items()],
    ),
    "triage-v4-location": (
        "Where the person waits",
        [
            ("MAIN_WAITING", "Main waiting area"),
            ("QUIET_ROOM", "Quiet room"),
            ("SAFE_ROOM", "Safe (low-stimulus) room"),
            ("MEDICAL_BAY", "Medical bay / resus"),
            ("WARD_BED", "Ward bed"),
        ],
    ),
    "triage-v4-observer-gender": (
        "Observer gender",
        [("female", "Female"), ("male", "Male"), ("no_preference", "No preference expressed")],
    ),
    "triage-v4-substance": ("Substances", SUBSTANCES),
    "triage-v4-remote-mental": (
        "Caller-described mental state",
        [(c, d) for c, d, _l in REMOTE_MENTAL],
    ),
    "triage-v4-remote-medical": (
        "Caller-described medical concerns",
        [(c, d) for c, d, _l in REMOTE_MEDICAL],
    ),
    "triage-v4-remote-suicide": (
        "Spoken about suicide / self-harm, or a recent attempt?",
        [
            ("no", "No"),
            ("talked", "Talked about it"),
            ("recent_attempt", "Recent attempt"),
            ("unknown", "Unknown"),
        ],
    ),
    "triage-v4-remote-harm-others": (
        "Threatened or attempted to harm another person?",
        [
            ("no", "No"),
            ("threatened", "Threatened"),
            ("attempted", "Attempted"),
            ("unknown", "Unknown"),
        ],
    ),
    "triage-v4-disposition": (
        "Disposition",
        [
            ("brought", "Client being brought for assessment"),
            ("emergency", "Emergency assistance required — ambulance / police dispatched"),
            ("callback", "Advice given — call-back arranged"),
            ("home_visit", "Community / home visit arranged"),
        ],
    ),
    "triage-v4-callback-owner": (
        "Who will call back",
        [
            ("triage_nurse", "Triage nurse"),
            ("clinical_officer", "Clinical officer"),
            ("psychiatrist", "Psychiatrist"),
        ],
    ),
    "triage-v4-orientation": (
        "Orientation",
        [("oriented", "Oriented"), ("disoriented", "Disoriented"), ("unable", "Unable to assess")],
    ),
    "triage-v4-behaviour": (
        "Behaviour",
        [
            ("calm", "Calm"),
            ("anxious", "Anxious"),
            ("restless", "Restless"),
            ("agitated", "Agitated"),
            ("withdrawn", "Withdrawn"),
            ("verbally_threatening", "Verbally threatening"),
            ("physically_aggressive", "Physically aggressive to others"),
            ("disinhibited", "Disinhibited"),
        ],
    ),
    "triage-v4-intox-signs": (
        "Intoxication / withdrawal signs",
        [
            ("none", "None evident"),
            ("intoxication", "Intoxication signs"),
            ("withdrawal", "Withdrawal signs"),
        ],
    ),
    "triage-v4-visible-injury": ("Visible injury", [("none", "None"), ("yes", "Yes")]),
    "triage-v4-communication": (
        "Ability to communicate",
        [("able", "Able"), ("limited", "Limited"), ("unable", "Unable")],
    ),
    "triage-v4-consent-obs": (
        "Consent to physical observations",
        [
            ("consented", "Consented"),
            ("declined", "Declined"),
            ("best_interests", "Unable to consent — measured in best interests"),
        ],
    ),
    "triage-v4-chaperone": (
        "Chaperone",
        [
            ("accepted", "Offered — accepted"),
            ("declined", "Offered — declined"),
            ("not_offered", "Not yet offered"),
        ],
    ),
    "triage-v4-clinician-gender": (
        "Preferred clinician gender",
        [
            ("no_preference", "No preference"),
            ("female", "Female preferred"),
            ("male", "Male preferred"),
            ("declined", "Declined to say"),
        ],
    ),
    "triage-v4-feel-safe": (
        "Does the client feel safe where they live / are staying?",
        [("yes", "Yes"), ("no", "No"), ("unable", "Unable to say")],
    ),
    "triage-v4-od-intent": (
        "Overdose intent",
        [
            ("self_harm", "Intended self-harm / suicide"),
            ("accidental", "Accidental"),
            ("recreational", "Recreational"),
            ("unclear", "Unclear"),
        ],
    ),
    "triage-v4-duty-police": (
        "Police informed?",
        [
            ("not_yet", "Not yet — senior decision"),
            ("yes", "Yes"),
            ("not_required", "Not required (senior decision)"),
        ],
    ),
    "triage-v4-duty-warned": (
        "Named person warned?",
        [
            ("not_yet", "Not yet — senior decision"),
            ("yes", "Yes"),
            ("not_reachable", "Not reachable"),
        ],
    ),
}

DEFAULT_ANSWERS = {
    "schema": SCHEMA,
    "b_encounter_type": "walk_in",
    "b_informant": "",
    "b_present": "",
    "flags": [],
    "suic": "none",
    "selfharm": "none",
    "subst_which": [],
    "r_mental": [],
    "r_medical": [],
    "r_substances": [],
    "vconf": [],
}

# Vital-sign answer key → (VitalSigns field, EWS key). Ranges are
# interventions.VITAL_RANGES (identical to the mockup VRANGE).
VITALS = {
    "v_hr": ("heart_rate", "hr"),
    "v_sbp": ("systolic_bp", "sbp"),
    "v_dbp": ("diastolic_bp", "dbp"),
    "v_rr": ("respiratory_rate", "rr"),
    "v_temp": ("temperature_c", "temp"),
    "v_spo2": ("spo2", "spo2"),
    "v_glucose": ("blood_glucose_mmol", "glucose"),
}
EWS_LABELS = {
    "rr": "RR",
    "spo2": "SpO₂",
    "sbp": "systolic BP",
    "hr": "HR",
    "temp": "temperature",
    "acvpu": "ACVPU",
}
ACVPU_SCORED = ("A", "C", "V", "P", "U")


def is_v4(answers):
    return isinstance(answers, dict) and answers.get("schema") == SCHEMA


def is_v4_version(rules_version):
    return str(rules_version or "").startswith("v4")


# ── The declarative rule set ──
# A rule: {"id", "scope": "any" | "present" | "remote", "phase": "main" | "post",
#          "when": condition, "priority", "reason"}.
# Conditions: {"eq": [key, value]}, {"in": [key, [values]]}, {"has": [key, code]},
# {"fact": name}, {"level": priority accumulated so far (post phase only)},
# {"all": [...]}, {"any": [...]}, {"not": condition}.
# Reasons may use {when} (suicidality timing) and {ews} / {acvpu} / {any3}.

_NOT_LETHAL = {"not": {"has": ["flags", "lethal_means"]}}

RULES = [
    # Both routes: distress as described.
    {
        "id": "DISTRESS-SEVERE",
        "scope": "any",
        "when": {"eq": ["distress", "SEVERE"]},
        "priority": "ORANGE",
        "reason": "Severe distress / behavioural disturbance",
    },
    {
        "id": "DISTRESS-HIGH",
        "scope": "any",
        "when": {"eq": ["distress", "HIGH"]},
        "priority": "YELLOW",
        "reason": "High distress",
    },
    # Telephone / third-party (TRI-K; same triggers, source THIRD_PARTY_REPORT — AT-08).
    {
        "id": "R-SUIC-ATTEMPT",
        "scope": "remote",
        "when": {"eq": ["r_suicide", "recent_attempt"]},
        "priority": "RED",
        "reason": "Recent suicide attempt / self-harm reported",
    },
    {
        "id": "R-SUIC-TALK-MEANS",
        "scope": "remote",
        "when": {"all": [{"eq": ["r_suicide", "talked"]}, {"eq": ["r_means", "yes"]}]},
        "priority": "RED",
        "reason": "Talk of suicide + access to means",
    },
    {
        "id": "R-SUIC-TALK",
        "scope": "remote",
        "when": {"all": [{"eq": ["r_suicide", "talked"]}, {"not": {"eq": ["r_means", "yes"]}}]},
        "priority": "ORANGE",
        "reason": "Has spoken about suicide / self-harm",
    },
    {
        "id": "R-SUIC-UNKNOWN",
        "scope": "remote",
        "when": {"eq": ["r_suicide", "unknown"]},
        "priority": "YELLOW",
        "reason": "Suicide risk not known to caller",
    },
    {
        "id": "R-HARM-ATTEMPTED",
        "scope": "remote",
        "when": {"eq": ["r_harm_others", "attempted"]},
        "priority": "RED",
        "reason": "Has attempted to harm another person",
    },
    {
        "id": "R-HARM-THREAT-MEANS",
        "scope": "remote",
        "when": {"all": [{"eq": ["r_harm_others", "threatened"]}, {"eq": ["r_means", "yes"]}]},
        "priority": "RED",
        "reason": "Has threatened to harm another person + access to means",
    },
    {
        "id": "R-HARM-THREAT",
        "scope": "remote",
        "when": {
            "all": [{"eq": ["r_harm_others", "threatened"]}, {"not": {"eq": ["r_means", "yes"]}}]
        },
        "priority": "ORANGE",
        "reason": "Has threatened to harm another person",
    },
    {
        "id": "R-MEANS-ONLY",
        "scope": "remote",
        "when": {
            "all": [
                {"eq": ["r_means", "yes"]},
                {"not": {"in": ["r_suicide", ["talked", "recent_attempt"]]}},
                {"not": {"in": ["r_harm_others", ["threatened", "attempted"]]}},
            ]
        },
        "priority": "YELLOW",
        "reason": "Known access to means of serious harm",
    },
    *[
        {
            "id": f"R-MED-{code}",
            "scope": "remote",
            "when": {"has": ["r_medical", code]},
            "priority": level,
            "reason": f"{label} reported",
        }
        for code, label, level in REMOTE_MEDICAL
    ],
    *[
        {
            "id": f"R-MENTAL-{code}",
            "scope": "remote",
            "when": {"has": ["r_mental", code]},
            "priority": level,
            "reason": f"{label} (caller report)",
        }
        for code, label, level in REMOTE_MENTAL
    ],
    {
        "id": "R-STOPPED-OPIOID",
        "scope": "remote",
        "when": {"all": [{"eq": ["r_stopped_heavy", "yes"]}, {"fact": "remote_opioid_only"}]},
        "priority": "YELLOW",
        "reason": "Recently stopped heavy opioid use — distressing, rarely life-threatening",
    },
    {
        "id": "R-STOPPED-OTHER",
        "scope": "remote",
        "when": {
            "all": [{"eq": ["r_stopped_heavy", "yes"]}, {"not": {"fact": "remote_opioid_only"}}]
        },
        "priority": "ORANGE",
        "reason": "Recently stopped heavy alcohol / sedative (or unknown) use — "
        "withdrawal can be life-threatening",
    },
    {
        "id": "R-NO-RESPONSIBLE",
        "scope": "remote",
        "phase": "post",
        "when": {"all": [{"eq": ["r_responsible", "no"]}, {"level": "YELLOW"}]},
        "priority": "ORANGE",
        "reason": "No responsible person physically with the client",
    },
    {
        "id": "R-DISPOSITION-EMERGENCY",
        "scope": "remote",
        "phase": "post",
        "when": {"eq": ["r_disposition", "emergency"]},
        "priority": "RED",
        "reason": "Cannot be brought safely — emergency assistance required",
    },
    # In person: grouped flags (each implies its own minimum priority).
    *[
        {
            "id": f"FLAG-{code}",
            "scope": "present",
            "when": {"has": ["flags", code]},
            "priority": level,
            "reason": display,
        }
        for code, display, _g, level, _h in FLAGS
        if level
    ],
    # Suicidality ladder (SUIC) and preparatory behaviour (PREP).
    {
        "id": "SUIC-INTENT",
        "scope": "present",
        "when": {"eq": ["suic", "intent"]},
        "priority": "RED",
        "reason": "Suicidal plan with intent{when}",
    },
    {
        "id": "SUIC-PLAN-MEANS",
        "scope": "present",
        "when": {"all": [{"eq": ["suic", "plan"]}, {"has": ["flags", "lethal_means"]}]},
        "priority": "RED",
        "reason": "Suicidal plan + access to lethal means{when}",
    },
    {
        "id": "SUIC-PLAN",
        "scope": "present",
        "when": {"all": [{"eq": ["suic", "plan"]}, _NOT_LETHAL]},
        "priority": "ORANGE",
        "reason": "Suicidal ideation with a plan{when}",
    },
    {
        "id": "SUIC-ACTIVE",
        "scope": "present",
        "when": {"eq": ["suic", "active"]},
        "priority": "ORANGE",
        "reason": "Active suicidal ideation (no plan){when}",
    },
    {
        "id": "SUIC-PASSIVE",
        "scope": "present",
        "when": {"eq": ["suic", "passive"]},
        "priority": "YELLOW",
        "reason": "Passive suicidal ideation{when}",
    },
    {
        "id": "SUIC-PREP",
        "scope": "present",
        "when": {"eq": ["prep", "yes"]},
        "priority": "RED",
        "reason": "Preparatory behaviour for suicide",
    },
    {
        "id": "MEANS-ONLY",
        "scope": "present",
        "when": {"all": [{"has": ["flags", "lethal_means"]}, {"in": ["suic", ["", "none"]]}]},
        "priority": "YELLOW",
        "reason": "Access to lethal means",
    },
    # Self-harm lethality (SH).
    {
        "id": "SH-HIGH",
        "scope": "present",
        "when": {"eq": ["selfharm", "high"]},
        "priority": "RED",
        "reason": "High-lethality self-harm",
    },
    {
        "id": "SH-LOW",
        "scope": "present",
        "when": {"eq": ["selfharm", "low"]},
        "priority": "ORANGE",
        "reason": "Self-harm (low lethality)",
    },
    # Clinician observation.
    {
        "id": "OBS-DISORIENTED",
        "scope": "present",
        "when": {"eq": ["obsn_orientation", "disoriented"]},
        "priority": "ORANGE",
        "reason": "Disoriented / confused (observed)",
    },
    {
        "id": "OBS-CANNOT-COMMUNICATE",
        "scope": "present",
        "when": {"eq": ["obsn_communicate", "unable"]},
        "priority": "ORANGE",
        "reason": "Unable to communicate safely",
    },
    {
        "id": "OBS-AGGRESSIVE",
        "scope": "present",
        "when": {"eq": ["obsn_behaviour", "physically_aggressive"]},
        "priority": "ORANGE",
        "reason": "Physically aggressive to others (observed)",
    },
    {
        "id": "OBS-THREATENING",
        "scope": "present",
        "when": {"eq": ["obsn_behaviour", "verbally_threatening"]},
        "priority": "YELLOW",
        "reason": "Verbally threatening (observed)",
    },
    {
        "id": "OBS-INJURY",
        "scope": "present",
        "when": {"eq": ["obsn_injury", "yes"]},
        "priority": "YELLOW",
        "reason": "Visible injury",
    },
    # Substances.
    {
        "id": "WD-OPIOID-ONLY",
        "scope": "present",
        "when": {
            "all": [{"eq": ["subst_withdrawal_signs", "yes"]}, {"fact": "opioid_only_withdrawal"}]
        },
        "priority": "YELLOW",
        "reason": "Opioid withdrawal signs — distressing, rarely life-threatening",
    },
    {
        "id": "WD-SEIZURE-HX",
        "scope": "present",
        "when": {
            "all": [
                {"eq": ["subst_withdrawal_signs", "yes"]},
                {"not": {"fact": "opioid_only_withdrawal"}},
                {"eq": ["subst_seizure_hx", "yes"]},
            ]
        },
        "priority": "ORANGE",
        "reason": "Withdrawal signs with a seizure history — can be life-threatening",
    },
    {
        "id": "WD-OTHER",
        "scope": "present",
        "when": {
            "all": [
                {"eq": ["subst_withdrawal_signs", "yes"]},
                {"not": {"fact": "opioid_only_withdrawal"}},
                {"not": {"eq": ["subst_seizure_hx", "yes"]}},
            ]
        },
        "priority": "ORANGE",
        "reason": "Alcohol / sedative (or unknown) withdrawal signs — can be life-threatening",
    },
    # Safeguarding.
    {
        "id": "NOT-SAFE",
        "scope": "present",
        "when": {"eq": ["feel_safe", "no"]},
        "priority": "YELLOW",
        "reason": "Client does not feel safe — safeguarding",
    },
    # Vital signs (EWS from ews.py; thresholds above are illustrative).
    {
        "id": "EWS-EMERGENCY",
        "scope": "present",
        "when": {"fact": "ews_emergency"},
        "priority": "RED",
        "reason": "{ews}{acvpu}",
    },
    {
        "id": "EWS-URGENT",
        "scope": "present",
        "when": {"all": [{"fact": "ews_urgent"}, {"not": {"fact": "ews_emergency"}}]},
        "priority": "ORANGE",
        "reason": "{ews}{any3}",
    },
    {
        "id": "GLUCOSE-LOW",
        "scope": "present",
        "when": {"fact": "glucose_low"},
        "priority": "RED",
        "reason": "Hypoglycaemia (glucose < 4 mmol/L) — treat now; never delay glucose",
    },
]


# ── Helpers ──


def _text(a, key):
    value = a.get(key)
    return value.strip() if isinstance(value, str) else ("" if value is None else str(value))


def _list(a, key):
    value = a.get(key)
    return [v for v in value if v] if isinstance(value, list) else []


def present_of(a):
    """ "yes", "no" or "" (not yet answered) — TRI-B-07."""
    return _text(a, "b_present")


def ews_input(a):
    o2 = _text(a, "v_o2")
    return {
        "rr": _text(a, "v_rr"),
        "spo2": _text(a, "v_spo2"),
        "sbp": _text(a, "v_sbp"),
        "hr": _text(a, "v_hr"),
        "temp": _text(a, "v_temp"),
        "glucose": _text(a, "v_glucose"),
        "dbp": _text(a, "v_dbp"),
        "consciousness": _text(a, "acvpu"),
        "supplemental_o2": o2 == "supplemental",
    }


def _facts(a):
    score = ews.score(ews_input(a))
    acvpu = _text(a, "acvpu")
    which = set(_list(a, "subst_which"))
    remote = set(_list(a, "r_substances"))
    return {
        "ews": score,
        "ews_emergency": bool(score["measured"])
        and (score["score"] >= EWS_PRIORITY["RED_AT_OR_ABOVE"] or acvpu in ("C", "V", "P", "U")),
        "ews_urgent": bool(score["measured"])
        and (score["score"] >= EWS_PRIORITY["ORANGE_AT_OR_ABOVE"] or score["single_parameter_3"]),
        "glucose_low": score["glucose_low"],
        "opioid_only_withdrawal": bool(which)
        and which <= NON_LIFE_THREATENING_WITHDRAWAL
        and "opioids" in which,
        "remote_opioid_only": bool(remote)
        and remote <= NON_LIFE_THREATENING_WITHDRAWAL
        and "opioids" in remote,
    }


def _test(cond, a, facts, level):
    if "all" in cond:
        return all(_test(c, a, facts, level) for c in cond["all"])
    if "any" in cond:
        return any(_test(c, a, facts, level) for c in cond["any"])
    if "not" in cond:
        return not _test(cond["not"], a, facts, level)
    if "eq" in cond:
        key, value = cond["eq"]
        return _text(a, key) == value
    if "in" in cond:
        key, values = cond["in"]
        return _text(a, key) in values
    if "has" in cond:
        key, code = cond["has"]
        return code in _list(a, key)
    if "fact" in cond:
        return bool(facts.get(cond["fact"]))
    if "level" in cond:
        return level == cond["level"]
    raise ValueError(f"Unknown rule condition: {cond}")


def _label(labels, valueset, code):
    return labels.get((valueset, code), code)


def source_of(a):
    """RULE-03 source for what was reported at this triage: (code, display, detail)."""
    informant = _text(a, "b_informant") or "client"
    if informant == "client":
        return (
            "CLIENT_REPORT",
            "Client report (telephone)" if present_of(a) == "no" else "Client report",
            "",
        )
    detail = _text(a, "b_third_party")
    return ("THIRD_PARTY_REPORT", f"Third-party report ({informant.replace('_', ' ')})", detail)


def clean_answers(answers):
    """X-08: fields the branching rules hide are not submitted (TRI-B-08,
    TRI-B-06, the suicidality ladder, flag detail blocks)."""
    a = {**DEFAULT_ANSWERS, **(answers or {})}
    drop = set()
    if _text(a, "b_informant") in ("", "client"):
        drop.add("b_third_party")
    present = present_of(a)
    remote_keys = {k for k in a if k.startswith("r_")}
    present_prefixes = (
        "screen_",
        "suic",
        "prep",
        "selfharm",
        "od_",
        "gbv_",
        "duty_",
        "subst_",
        "obsn_",
        "v_",
        "nm_",
        "safety_",
        "pref_",
    )
    present_keys = {k for k in a if k.startswith(present_prefixes)} | {
        "flags",
        "feel_safe",
        "safeguard_note",
        "consent_obs",
        "chaperone",
        "vconf",
        "acvpu",
        "pupils",
        "collateral",
    }
    if present == "no":
        drop |= present_keys
    elif present == "yes":
        drop |= remote_keys
        flags = _list(a, "flags")
        for group, key in GROUP_KEY.items():
            if _text(a, key) != "yes":
                flags = [f for f in flags if FLAG.get(f, {}).get("group") != group]
        flags = [f for f in flags if f in FLAG]
        a["flags"] = flags
        if _text(a, "screen_self") != "yes":
            drop |= {"suic", "suic_when", "prep", "selfharm"}
        elif _text(a, "suic") in ("", "none"):
            drop |= {"suic_when", "prep"}
        if "overdose" not in flags:
            drop |= {k for k in a if k.startswith("od_")}
        if "homicidal_named" not in flags:
            drop |= {k for k in a if k.startswith("duty_")}
        if _text(a, "screen_safeguarding") != "yes":
            drop |= {"feel_safe", "safeguard_note"}
        if "gbv_72h" not in flags:
            drop |= {k for k in a if k.startswith("gbv_")}
        if _text(a, "subst_recent") != "yes":
            drop |= {"subst_which", "subst_last_use", "subst_seizure_hx", "subst_withdrawal_signs"}
        if _text(a, "obsn_injury") != "yes":
            drop.add("obsn_injury_desc")
        if _text(a, "safety_items_checked") != "yes":
            drop |= {"safety_removed", "safety_stored"}
        for key in VITALS:
            if _text(a, key):  # a measured value supersedes a "not measured" reason
                drop.add("nm_" + key[2:])
    else:
        drop |= remote_keys | present_keys
    return {k: v for k, v in a.items() if k not in drop}


def vital_problems(a):
    """Hard-range errors and unconfirmed soft-range values (mockup vcheck /
    vitalsProblems; ranges from interventions.VITAL_RANGES): [(message, key)]."""
    out = []
    confirmed = set(_list(a, "vconf"))
    for key, (field, _e) in VITALS.items():
        raw = _text(a, key)
        if not raw:
            continue
        label, unit, hmin, hmax, smin, smax = VITAL_RANGES[field]
        try:
            number = float(raw)
        except ValueError:
            out.append((f"{label}: enter a number only", key))
            continue
        if not hmin <= number <= hmax:
            out.append((f"{label}: not a possible value — check ({hmin:g}–{hmax:g} {unit})", key))
        elif not smin <= number <= smax and key not in confirmed:
            out.append((f"{label} {raw} is unusual — confirm or correct it", key))
    if bool(_text(a, "v_sbp")) != bool(_text(a, "v_dbp")):
        out.append(("Blood pressure: enter both systolic and diastolic", "v_sbp"))
    for key, reason in a.items():
        if (
            key.startswith("nm_")
            and reason
            and reason not in dict(VALUESETS["triage-v4-not-measured"][1])
        ):
            out.append((f"Unknown not-measured reason for {key[3:]}", key))
    return out


def required_problems(a):
    """Items that block signing regardless of the chosen priority: [(message, key)]."""
    out = []
    if not _text(a, "b_informant"):
        out.append(("Who is giving the information", "b_informant"))
    elif _text(a, "b_informant") != "client" and not _text(a, "b_third_party"):
        out.append(("Name / relationship of the third party (TRI-B-06)", "b_third_party"))
    present = present_of(a)
    if not present:
        out.append(("Is the client physically present", "b_present"))
    if not _text(a, "c_concern"):
        out.append(("Main concern", "c_concern"))
    if not _text(a, "distress"):
        out.append(("Distress / behaviour", "distress"))
    if present == "no":
        if not _text(a, "r_suicide"):
            out.append(("Suicide / self-harm question", "r_suicide"))
        if not _text(a, "r_disposition"):
            out.append(("Disposition", "r_disposition"))
        if _text(a, "r_disposition") == "callback":
            if not parse_local_datetime(_text(a, "r_callback_at")):
                out.append(("Call-back time (creates a timed task)", "r_callback_at"))
            if not _text(a, "r_callback_owner"):
                out.append(("Who will call back", "r_callback_owner"))
    if present == "yes":
        for _code, _title, question, key in FLAG_GROUPS:
            if not _text(a, key):
                out.append((f"Screening question: “{question}”", key))
        flags = _list(a, "flags")
        if "overdose" in flags and any(
            not _text(a, k)
            for k in ("od_substance", "od_amount", "od_time", "od_coingest", "od_intent")
        ):
            out.append(
                ("Overdose: substance, amount, time, co-ingestants and intent", "od_substance")
            )
        if "gbv_72h" in flags and not parse_local_datetime(_text(a, "gbv_incident_at")):
            out.append(("GBV: time of incident (starts the PEP clock)", "gbv_incident_at"))
        if "homicidal_named" in flags and not (
            _text(a, "duty_victim") and _text(a, "duty_informed")
        ):
            out.append(("Duty to protect: named person and who has been informed", "duty_victim"))
        out += vital_problems(a)
    return out


def safety_problems(a, final_priority):
    """RED / ORANGE in person: observation level, where the person waits and a
    named observer are required (mockup confirmTriage)."""
    if present_of(a) != "yes" or final_priority not in ("RED", "ORANGE"):
        return []
    out = []
    if not _text(a, "safety_obs"):
        out.append(("Observation level", "safety_obs"))
    if not _text(a, "safety_location"):
        out.append(("Where the person waits", "safety_location"))
    if not _text(a, "safety_observer"):
        out.append(("Named observer", "safety_observer"))
    return out


def core_unanswered(a):
    keys = [
        ("b_informant", "Who is giving the information"),
        ("b_present", "Physically present"),
        ("c_concern", "Main concern"),
        ("distress", "Distress / behaviour"),
    ]
    present = present_of(a)
    if present == "yes":
        keys += [(key, title) for _c, title, _q, key in FLAG_GROUPS]
    elif present == "no":
        keys += [("r_suicide", "Suicide / self-harm (caller)"), ("r_disposition", "Disposition")]
    return [(key, title) for key, title in keys if not _text(a, key)]


# ── Evaluation ──


def evaluate(answers, labels=None):
    """The live recommendation for a v4 answer set (same shape as
    triage_rules.evaluate, plus the reason list, EWS and ruleset label)."""
    labels = labels or {}
    a = clean_answers(answers)
    present = present_of(a)
    facts = (
        _facts(a)
        if present == "yes"
        else {**_facts({}), "remote_opioid_only": _facts(a)["remote_opioid_only"]}
    )
    score = facts["ews"]
    when = _text(a, "suic_when")
    fmt = {
        "when": f" ({_label(labels, 'triage-v4-suicidality-when', when).lower()})" if when else "",
        "ews": score["label"],
        "acvpu": f" · ACVPU {_text(a, 'acvpu')}"
        if _text(a, "acvpu") in ("C", "V", "P", "U")
        else "",
        "any3": " (a single parameter scores 3)" if score["single_parameter_3"] else "",
    }
    scope_ok = {"any"} | (
        {"present"} if present == "yes" else {"remote"} if present == "no" else set()
    )
    level, fired = "GREEN", []
    for phase in ("main", "post"):
        for rule in RULES:
            if rule.get("phase", "main") != phase or rule["scope"] not in scope_ok:
                continue
            if _test(rule["when"], a, facts, level):
                fired.append(
                    {
                        "priority": rule["priority"],
                        "reason": rule["reason"].format(**fmt),
                        "rule": rule["id"],
                    }
                )
                if PRIORITY_RANK[rule["priority"]] > PRIORITY_RANK[level]:
                    level = rule["priority"]
    fired.sort(key=lambda r: -PRIORITY_RANK[r["priority"]])

    items, alerts = _findings(a, labels, score), _alerts(a, facts)
    unanswered = [title for _k, title in core_unanswered(a)]
    ready = not unanswered
    if ready:
        recommendation = level
    elif fired:
        recommendation = f"{level} — preliminary"
    else:
        recommendation = "Review required"
    reasons = " · ".join(r["reason"] for r in fired)
    if not reasons:
        reasons = (
            "No risk, distress or vital-sign triggers."
            if ready
            else "Complete the first questions and the screening areas. Unanswered items are not "
            "treated as negative findings."
        )
    from .triage_rules import ALERT_LABELS

    return {
        "schema": SCHEMA,
        "rules_version": RULES_VERSION,
        "ruleset_label": RULESET_LABEL,
        "priority": level,
        "ready": ready,
        "recommendation": recommendation,
        "summary_priority": level if ready or fired else "pending",
        "reasons": reasons,
        "reason_list": fired,
        "alerts": [{"code": c, "label": ALERT_LABELS[c]} for c in alerts],
        "findings": [[i["finding"], i["status"], i["source"]] for i in items],
        "finding_items": items,
        "triggers": sorted(_triggers(alerts)),
        "unanswered": unanswered,
        "unresolved": [],
        "ews": score if present == "yes" else None,
        "recommended_actions": _recommended_actions(level, alerts, a, facts),
        "safety_required": present == "yes" and level in ("RED", "ORANGE"),
    }


def _alerts(a, facts):
    out = []

    def add(code):
        if code not in out:
            out.append(code)

    flags = set(_list(a, "flags"))
    present = present_of(a)
    if present == "yes":
        if (
            _text(a, "suic") not in ("", "none")
            or _text(a, "selfharm") not in ("", "none")
            or flags & {"recent_attempt", "overdose"}
            or _text(a, "prep") == "yes"
        ):
            add("SUICIDE_RISK")
        if flags & {"threatening_others", "homicidal_named"} or _text(a, "obsn_behaviour") in (
            "physically_aggressive",
            "verbally_threatening",
        ):
            add("AGGRESSION_RISK")
        if "severe_withdrawal" in flags or _text(a, "subst_withdrawal_signs") == "yes":
            add("WITHDRAWAL_RISK")
        if "altered_consciousness" in flags or _text(a, "acvpu") in ("C", "V", "P", "U"):
            add("ALTERED_CONSCIOUSNESS")
        if facts["ews_urgent"] or facts["ews_emergency"] or facts["glucose_low"]:
            add("ABNORMAL_VITALS")
        if flags & {"gbv_72h", "child_protection", "safeguarding"} or _text(a, "feel_safe") == "no":
            add("SAFEGUARDING")
    elif present == "no":
        if _text(a, "r_suicide") in ("talked", "recent_attempt"):
            add("SUICIDE_RISK")
        mental = set(_list(a, "r_mental"))
        if _text(a, "r_harm_others") in ("threatened", "attempted") or mental & {
            "physically_aggressive",
            "verbally_threatening",
        }:
            add("AGGRESSION_RISK")
        if _text(a, "r_stopped_heavy") == "yes":
            add("WITHDRAWAL_RISK")
        if "loss_consciousness" in _list(a, "r_medical"):
            add("ALTERED_CONSCIOUSNESS")
        if _text(a, "r_disposition") == "emergency":
            add("TELEPHONE_EMERGENCY")
    return out


def _triggers(alerts):
    letters = {
        "SUICIDE_RISK": "d",
        "AGGRESSION_RISK": "e",
        "ALTERED_CONSCIOUSNESS": "f",
        "WITHDRAWAL_RISK": "g",
        "ABNORMAL_VITALS": "h",
        "SAFEGUARDING": "i",
    }
    return {letters[c] for c in alerts if c in letters}


def _recommended_actions(level, alerts, a, facts):
    """TRI-N-04: actions implied by the triggers — pre-selected as *recommended*,
    never auto-confirmed (codes from the `triage-action` value set)."""
    out = []
    if level == "RED":
        out.append("emergency_intervention")
    review = {
        "RED": "urgent_psychiatric_review",
        "ORANGE": "urgent_psychiatric_review",
        "YELLOW": "priority_psychiatric_review",
        "GREEN": "routine_psychiatric_review",
    }[level]
    out.append(review)
    if "SUICIDE_RISK" in alerts:
        out += ["suicide_risk_assessment", "safety_plan"]
    flags = set(_list(a, "flags"))
    medical_red = {f for f in flags if FLAG[f]["group"] == "MEDICAL" and FLAG[f]["level"] == "RED"}
    if (
        medical_red
        or "ABNORMAL_VITALS" in alerts
        or set(_list(a, "r_medical")) & {"seizures", "loss_consciousness", "serious_injury"}
    ):
        out.append("urgent_medical_review")
    if "WITHDRAWAL_RISK" in alerts:
        out.append("withdrawal_monitoring")
    if "SAFEGUARDING" in alerts:
        out.append("safeguarding_intervention")
    if _text(a, "safety_obs") in ("INTERMITTENT_15", "EYESIGHT", "ARMS_LENGTH"):
        out.append("enhanced_observation")
    return out


def _findings(a, labels, score):
    """TRI-L: structured findings with their source (RULE-03). Time and recorder
    are added when the triage is signed (AT-20)."""
    items = []
    src_code, src_label, src_detail = source_of(a)

    def add(finding, status, code=None, label=None, detail=None):
        items.append(
            {
                "finding": finding,
                "status": status,
                "source": label or src_label,
                "source_code": code or src_code,
                "source_detail": src_detail if detail is None else detail,
            }
        )

    L = lambda vs, code: _label(labels, vs, code)  # noqa: E731
    distress = _text(a, "distress")
    if distress:
        add("Distress / behaviour", L("triage-v4-distress", distress))
    present = present_of(a)
    if present == "no":
        r_suicide = _text(a, "r_suicide")
        if r_suicide:
            add("Suicide / self-harm (caller)", L("triage-v4-remote-suicide", r_suicide))
        if _text(a, "r_harm_others"):
            add(
                "Harm to others (caller)",
                L("triage-v4-remote-harm-others", _text(a, "r_harm_others")),
            )
        if _text(a, "r_means") == "yes":
            add("Access to means", "Known access reported")
        for key, vs, title in (
            ("r_mental", "triage-v4-remote-mental", "Mental state (caller)"),
            ("r_medical", "triage-v4-remote-medical", "Medical concern (caller)"),
        ):
            chosen = _list(a, key)
            if chosen:
                add(title, ", ".join(L(vs, c) for c in chosen))
        if _text(a, "r_stopped_heavy") == "yes":
            subs = ", ".join(L("triage-v4-substance", c) for c in _list(a, "r_substances"))
            add("Recently stopped heavy use", subs or "Substance not known")
        if _text(a, "r_responsible"):
            add(
                "Responsible person with the client", L("yes-no-unknown", _text(a, "r_responsible"))
            )
        if _text(a, "r_disposition"):
            add(
                "Disposition",
                L("triage-v4-disposition", _text(a, "r_disposition")),
                "CLINICIAN_OBSERVATION",
                "Triage decision",
                "",
            )
        add(
            "Vital signs",
            "Not measured — client not present (telephone / third-party triage)",
            "MEASUREMENT",
            "Not measured",
            "",
        )
        return items
    if present != "yes":
        return items
    suic = _text(a, "suic")
    if suic and suic != "none":
        status = L("triage-v4-suicidality", suic)
        if _text(a, "suic_when"):
            status += " · " + L("triage-v4-suicidality-when", _text(a, "suic_when"))
        if _text(a, "prep"):
            status += " · preparatory behaviour: " + L("triage-v4-preparatory", _text(a, "prep"))
        add("Suicidality", status)
    if _text(a, "selfharm") not in ("", "none"):
        add("Self-harm", L("triage-v4-self-harm", _text(a, "selfharm")))
    for code in _list(a, "flags"):
        add("Risk flag", L("triage-v4-flag", code))
    if "overdose" in _list(a, "flags"):
        add(
            "Overdose details",
            (
                f"{_text(a, 'od_substance') or '—'} · amount {_text(a, 'od_amount') or '—'} · time "
                f"{_text(a, 'od_time') or '—'} · "
                f"co-ingestants {_text(a, 'od_coingest') or '—'} · intent "
                f"{L('triage-v4-od-intent', _text(a, 'od_intent')) or '—'}"
            ),
        )
    if "gbv_72h" in _list(a, "flags"):
        add(
            "GBV — time of incident",
            (_text(a, "gbv_incident_at") or "—") + " · PEP / EC decision task",
        )
    if "homicidal_named" in _list(a, "flags"):
        add(
            "Duty to protect",
            (
                f"Potential victim: {_text(a, 'duty_victim') or '—'} · "
                f"informed: {_text(a, 'duty_informed') or '—'}"
                " · senior decision requested"
            ),
            "CLINICIAN_OBSERVATION",
            "Triage decision",
            "",
        )
    if _text(a, "feel_safe"):
        add("Feels safe where living", L("triage-v4-feel-safe", _text(a, "feel_safe")))
    if _text(a, "subst_recent") == "yes":
        which = ", ".join(L("triage-v4-substance", c) for c in _list(a, "subst_which")) or "—"
        status = f"{which} · last use {_text(a, 'subst_last_use') or '—'}"
        if _text(a, "subst_withdrawal_signs") == "yes":
            status += " · withdrawal signs"
        add("Recent substance use", status)
    obs = [
        ("Orientation", "triage-v4-orientation", "obsn_orientation"),
        ("Behaviour", "triage-v4-behaviour", "obsn_behaviour"),
        ("Intoxication / withdrawal signs", "triage-v4-intox-signs", "obsn_intox"),
        ("Ability to communicate", "triage-v4-communication", "obsn_communicate"),
    ]
    parts = [f"{t.lower()}: {L(vs, _text(a, k))}" for t, vs, k in obs if _text(a, k)]
    if _text(a, "obsn_injury") == "yes":
        parts.append(
            "visible injury"
            + (f" ({_text(a, 'obsn_injury_desc')})" if _text(a, "obsn_injury_desc") else "")
        )
    if parts:
        add("Observation", " · ".join(parts), "CLINICIAN_OBSERVATION", "Clinician observation", "")
    add("Vital signs", vitals_text(a, labels, score), "MEASUREMENT", "Measurement", "")
    if _text(a, "safety_obs") or _text(a, "safety_location"):
        add(
            "Waiting-room safety",
            safety_text(a, labels),
            "CLINICIAN_OBSERVATION",
            "Clinician observation",
            "",
        )
    return items


def vitals_text(a, labels, score=None):
    score = score or ews.score(ews_input(a))
    parts = []
    for key, title in (("v_hr", "HR"), ("v_rr", "RR"), ("v_temp", "T"), ("v_spo2", "SpO₂")):
        nm = _text(a, "nm_" + key[2:])
        parts.append(
            f"{title} {_text(a, key)}"
            if _text(a, key)
            else f"{title} not measured ({_label(labels, 'triage-v4-not-measured', nm).lower()})"
            if nm
            else f"{title} –"
        )
    bp = (
        f"BP {_text(a, 'v_sbp')}/{_text(a, 'v_dbp')}"
        if _text(a, "v_sbp")
        else (
            "BP not measured "
            f"({_label(labels, 'triage-v4-not-measured', _text(a, 'nm_sbp')).lower()})"
            if _text(a, "nm_sbp")
            else "BP –"
        )
    )
    parts.insert(1, bp)
    if _text(a, "v_o2") == "supplemental":
        parts.append("supplemental O₂")
    if _text(a, "v_glucose"):
        parts.append(f"Glu {_text(a, 'v_glucose')}")
    parts.append(f"ACVPU {_text(a, 'acvpu') or 'not recorded'}")
    parts.append(score["label"])
    return " · ".join(parts)


def safety_text(a, labels):
    level = (
        _label(labels, "triage-v4-observation-level", _text(a, "safety_obs"))
        if _text(a, "safety_obs")
        else "–"
    )
    where = (
        _label(labels, "triage-v4-location", _text(a, "safety_location"))
        if _text(a, "safety_location")
        else "–"
    )
    out = f"{level} · {where}"
    if _text(a, "safety_observer"):
        out += f" · observer {_text(a, 'safety_observer')}"
    if _text(a, "safety_removed"):
        out += f" · removed: {_text(a, 'safety_removed')}"
        if _text(a, "safety_stored"):
            out += f" → {_text(a, 'safety_stored')}"
    return out


def stamp_findings(items, at, by):
    """AT-20: every summary row carries source, status, time and recorder."""
    return [[i["finding"], i["status"], i["source"], at, by] for i in items]


def served_config():
    """Rule metadata the triage screen needs (the option lists themselves are the
    served value sets above)."""
    return {
        "rules_version": RULES_VERSION,
        "ruleset_label": RULESET_LABEL,
        "flags": [{"code": c, "group": g, "level": lvl, "hint": h} for c, _d, g, lvl, h in FLAGS],
        "groups": [{"code": c, "title": t, "question": q, "key": k} for c, t, q, k in FLAG_GROUPS],
        "vital_ranges": {
            key: dict(
                zip(
                    ("label", "unit", "hard_min", "hard_max", "soft_min", "soft_max"),
                    VITAL_RANGES[field],
                    strict=True,
                )
            )
            for key, (field, _e) in VITALS.items()
        },
        "ews_priority": EWS_PRIORITY,
        "ews_version": ews.VERSION,
        "ews_approval": ews.APPROVAL,
        "seen_target_minutes": seen_targets(),
        "pep_window_hours": PEP_WINDOW_HOURS,
        "override_reason_min": OVERRIDE_REASON_MIN,
        "approval": "illustrative — from client mockup, VERIFY",
    }


def seen_targets():
    from django.conf import settings

    return getattr(settings, "SEEN_BY_CLINICIAN_TARGET_MINUTES", None) or SEEN_TARGET_MINUTES


def parse_local_datetime(value):
    """A datetime-local value ("2026-10-16T09:30") or ISO string → aware datetime."""
    if not value:
        return None
    try:
        parsed = parse_datetime(str(value))
    except ValueError:
        return None
    if parsed is None:
        return None
    from . import facility_time

    return facility_time.make_local_aware(parsed)


def pep_deadline(answers):
    at = parse_local_datetime(_text(answers, "gbv_incident_at"))
    return at + timedelta(hours=PEP_WINDOW_HOURS) if isinstance(at, datetime) else None
