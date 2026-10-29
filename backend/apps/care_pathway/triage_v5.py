"""
Triage v5 — the "Comprehensive Triage & Initial Risk Screen" developer
specification, sections A–N, adopted after QA on the owner's confirmation
(2026-10-28). It replaces the v4 mockup's four flag groups with the spec's own
questions and removes what v4 asked twice (collateral informant, distress,
intoxication in two places, a second consciousness field, a second medical list).

Kept from v4 (triage_v4.py), with the same answer keys so the shared stores and
the live queue read them unchanged: the vital-sign entry, range checks and
early-warning score (v_*, nm_*, vconf, v_o2, acvpu), consent / chaperone for
observations, the waiting-area safety instruction (safety_*), trauma-informed
preferences (pref_*), the overdose (od_*), duty-to-protect (duty_*) and GBV
(gbv_*) detail blocks, the telephone call-back (r_disposition, r_callback_*,
r_advice), and the M priority decision / N actions.

The spec questions reuse the v3 answer keys and served value sets
(triage_rules.py / valuesets.py: d_*, e_*, f_*, g_*, h_*, i_*, j_*, k_*), whose
rule priorities the owner approved on 2026-10-07. Rules that are new here are
marked "v5 —". The v5 rule set as a whole, the coded substance "current concern"
list included, was approved for clinical use by the project owner on 2026-10-28.
Any change bumps RULES_VERSION: a signed triage stores the version that produced
its recommendation and is never re-evaluated.

Each signed v5 triage also writes the shared clinical finding store
(findings.py): one finding per domain (spec §17), which Intake and the later
stages confirm or update instead of re-asking.

2026-10-28.2 (approved by the project owner, 2026-10-28, after QA): a critical
measurement (early-warning score at the urgent / emergency threshold, or
hypoglycaemia) raises the "Acute medical concern" alert as well as "Abnormal vital
signs"; an acute medical concern asks for the next step (medical review, psychiatric
review or referral out) and whether the client arrived with a referral from another
facility, whose note is recorded; vital signs carry the time they were measured and
their source; and each alert or tool an answer starts is named per section
(auto_triggers), every raise and clear written to the audit trail.
"""

from datetime import timedelta

from django.utils import timezone

from . import ews, triage_rules
from . import triage_v4 as v4
from .triage_v4 import (  # noqa: F401 — shared with v4, re-exported for callers
    ACVPU_SCORED,
    EWS_LABELS,
    OVERRIDE_REASON_MIN,
    PEP_WINDOW_HOURS,
    PRIORITY_NAME,
    PRIORITY_RANK,
    VITALS,
    VITALS_COMPLETION_MINUTES,
    parse_local_datetime,
    pep_deadline,
    safety_text,
    seen_targets,
    stamp_findings,
    vital_problems,
    vitals_text,
)

RULES_VERSION = "2026-10-28.2"
RULESET_LABEL = "Approved by the project owner, 2026-10-28"
SCHEMA = "v5"

# Section G table rows, in the spec's order; Khat (miraa) kept as its own row
# (owner, 2026-10-28). Codes and labels are the served `triage-v4-substance` set.
SUBSTANCE_ROWS = ["alcohol", "opioids", "sedatives", "stimulants", "cannabis", "khat", "other"]
SUBSTANCE_COLUMNS = ("last", "amount", "concern")

# Spec H flags that imply RED on their own (v3 RED_MEDICAL_FLAGS + head injury,
# which v4 rated RED).
RED_MEDICAL = triage_rules.RED_MEDICAL_FLAGS | {"head_injury"}
UNCERTAIN = triage_rules.UNCERTAIN_VALUES

# The one-question-per-section screens (v3 CORE_SCREENS + G): unanswered is
# never treated as negative.
CORE_PRESENT = [
    ("d_suicidal", "Suicide / self-harm — current thoughts"),
    ("e_thoughts", "Risk to others — current thoughts"),
    ("f_change", "Acute mental state — major change"),
    ("g_use", "Recent alcohol or other substance use"),
    ("h_concern", "Immediate physical / medical concern"),
    ("i_safe", "Feels safe where living / staying"),
    ("j_concern", "Can safely care for basic needs"),
]
CORE_REMOTE = [
    ("k_bring", "Can the person be brought safely"),
    ("k_emergency", "Is emergency assistance required"),
]

VALUESETS = {
    # Section G "Current concern" per substance (owner, 2026-10-28). "withdrawal" on the alcohol or
    # opioid row is what selects CIWA-Ar or COWS.
    "triage-substance-concern": (
        "Current concern",
        [
            ("none", "None"),
            ("intoxication", "Intoxication"),
            ("withdrawal", "Withdrawal"),
            ("other", "Other"),
        ],
    ),
    # Section H — what happens next for an acute medical concern (owner, 2026-10-28).
    "triage-medical-escalation": (
        "Medical concern — next step",
        [
            ("managed_here", "Managed here — no escalation needed"),
            ("urgent_medical_review", "Urgent medical review here"),
            ("psychiatric_review", "Psychiatric review"),
            ("refer_out", "Refer to another facility"),
        ],
    ),
    # Where the recorded vital signs come from (owner, 2026-10-28).
    "triage-vitals-source": (
        "Source of the measurements",
        [
            ("here", "Measured here"),
            ("referring_facility", "Referring facility's record"),
            ("client_record", "Client-held record"),
        ],
    ),
}

# A measured time more than this far ahead of the server clock is a typing error.
MEASURED_AT_SKEW_MINUTES = 5

DEFAULT_ANSWERS = {
    "schema": SCHEMA,
    "b_encounter_type": "walk_in",
    "b_informant": "",
    "b_present": "",
    "f_features": [],
    "g_withdrawal": [],
    "h_flags": [],
    "i_flags": [],
    "j_flags": [],
    "k_flags": [],
    "vconf": [],
}

_PREFIXES = (
    "a_",
    "b_",
    "c_",
    "m_",
    "n_",
    "d_",
    "e_",
    "f_",
    "g_",
    "h_",
    "i_",
    "j_",
    "k_",
    "od_",
    "gbv_",
    "duty_",
    "v_",
    "nm_",
    "safety_",
    "pref_",
)
_KEYS = {"schema", "consent_obs", "chaperone", "vconf", "acvpu"}
_REMOTE_R = {"r_disposition", "r_callback_at", "r_callback_owner", "r_advice"}
_PRESENT_PREFIXES = (
    "d_",
    "e_",
    "f_",
    "g_",
    "h_",
    "i_",
    "j_",
    "od_",
    "gbv_",
    "duty_",
    "v_",
    "nm_",
    "safety_",
    "pref_",
)
_PRESENT_KEYS = {"consent_obs", "chaperone", "vconf", "acvpu"}


def is_v5(answers):
    return isinstance(answers, dict) and answers.get("schema") == SCHEMA


_text, _list, _label = v4._text, v4._list, v4._label
present_of, source_of = v4.present_of, v4.source_of


def substance_cell(code, column):
    return f"g_{code}_{column}"


def used_substances(a):
    """Table rows with anything entered, in table order."""
    return [
        code
        for code in SUBSTANCE_ROWS
        if any(_text(a, substance_cell(code, c)) for c in SUBSTANCE_COLUMNS)
    ]


def withdrawal_symptoms(a):
    return [w for w in _list(a, "g_withdrawal") if w != "none"]


def concern_of(a, code):
    return _text(a, substance_cell(code, "concern"))


def concern_other_key(code):
    """The description a "Current concern" of "Other" asks for."""
    return substance_cell(code, "concern_other")


REFER_OUT_KEYS = ("h_refer_fr", "h_refer_facility", "h_refer_reason")
REFERRAL_IN_KEYS = ("h_ref_fr", "h_ref_facility", "h_ref_note")


def vitals_entered(a):
    return any(_text(a, key) for key in VITALS)


def critical_vitals(a):
    """A measurement at the early-warning urgent / emergency threshold, or hypoglycaemia."""
    if present_of(a) != "yes":
        return False
    facts = _facts(a)
    return facts["ews_urgent"] or facts["ews_emergency"] or facts["glucose_low"]


def escalation_needed(a):
    """An acute medical concern: one reported in H, or a critical measurement."""
    return present_of(a) == "yes" and (_text(a, "h_concern") == "yes" or critical_vitals(a))


def referral_in_asked(a):
    return escalation_needed(a) or (
        present_of(a) == "yes" and _text(a, "v_source") == "referring_facility"
    )


# ── Hidden fields are not submitted (X-08) ──


def clean_answers(answers):
    a = {**DEFAULT_ANSWERS, **(answers or {})}
    # Keys outside the v5 form (e.g. v4 fields left in a draft started on v4)
    # are never stored with a v5 signature.
    a = {
        k: v
        for k, v in a.items()
        if k in _KEYS or k in _REMOTE_R or (k.startswith(_PREFIXES) and not k.startswith("r_"))
    }
    a["schema"] = SCHEMA
    drop = set()
    if _text(a, "b_informant") in ("", "client"):
        drop.add("b_third_party")
    if _text(a, "b_encounter_type") != "other":
        drop.add("b_encounter_type_other")
    present = present_of(a)
    present_keys = {k for k in a if k.startswith(_PRESENT_PREFIXES)} | (_PRESENT_KEYS & set(a))
    remote_keys = {k for k in a if k.startswith("k_")} | (_REMOTE_R & set(a))
    if present == "no":
        drop |= present_keys
        if _text(a, "k_emergency") == "yes" or _text(a, "k_bring") == "yes":
            drop |= {"r_disposition", "r_callback_at", "r_callback_owner"}
        elif _text(a, "r_disposition") != "callback":
            drop |= {"r_callback_at", "r_callback_owner"}
    elif present == "yes":
        drop |= remote_keys
        if _text(a, "d_suicidal") != "yes":
            drop.add("d_act_now")
        if _text(a, "d_attempt") != "yes":
            drop.add("d_what_happened")
        if _text(a, "e_thoughts") != "yes":
            drop.add("e_named")
        if _text(a, "e_named") != "yes" or _text(a, "e_thoughts") != "yes":
            drop |= {k for k in a if k.startswith("duty_")}
        if _text(a, "f_change") != "yes":
            drop |= {"f_features", "f_features_other"}
        elif "other" not in _list(a, "f_features"):
            drop.add("f_features_other")
        if _text(a, "f_behaviour") != "other":
            drop.add("f_behaviour_other")
        if _text(a, "g_use") != "yes":
            drop |= (
                {substance_cell(code, col) for code in SUBSTANCE_ROWS for col in SUBSTANCE_COLUMNS}
                | {concern_other_key(code) for code in SUBSTANCE_ROWS}
                | {"g_other_name"}
            )
        drop |= {concern_other_key(c) for c in SUBSTANCE_ROWS if concern_of(a, c) != "other"}
        if _text(a, "g_use") not in ("yes", "unknown"):
            drop.add("g_intoxication")
        if _text(a, "h_concern") != "yes":
            drop |= {"h_flags", "h_flags_other"}
        elif "other" not in _list(a, "h_flags"):
            drop.add("h_flags_other")
        if "suspected_overdose" not in _list(a, "h_flags") or _text(a, "h_concern") != "yes":
            drop |= {k for k in a if k.startswith("od_")}
        if "other" not in _list(a, "i_flags"):
            drop.add("i_flags_other")
        if "sexual_violence" not in _list(a, "i_flags"):
            drop.add("i_sv_recent")
        if "sexual_violence" not in _list(a, "i_flags") or _text(a, "i_sv_recent") != "yes":
            drop |= {k for k in a if k.startswith("gbv_")}
        if _text(a, "j_concern") != "yes":
            drop |= {"j_flags", "j_flags_other"}
        elif "other" not in _list(a, "j_flags"):
            drop.add("j_flags_other")
        if _text(a, "safety_items_checked") != "yes":
            drop |= {"safety_removed", "safety_stored"}
        for key in VITALS:
            if _text(a, key):
                drop.add("nm_" + key[2:])
        if not vitals_entered(a):
            drop |= {"v_measured_at", "v_source"}
        if not escalation_needed(a):
            drop |= {"h_next", *REFER_OUT_KEYS}
        elif _text(a, "h_next") != "refer_out":
            drop |= set(REFER_OUT_KEYS)
        if not referral_in_asked(a):
            drop |= {"h_referred_in", *REFERRAL_IN_KEYS}
        elif _text(a, "h_referred_in") != "yes":
            drop |= set(REFERRAL_IN_KEYS)
    else:
        drop |= present_keys | remote_keys
    return {k: v for k, v in a.items() if k not in drop}


# ── What blocks signing ──


def core_unanswered(a):
    keys = [
        ("b_informant", "Who is giving the information"),
        ("b_present", "Physically present"),
        ("c_concern", "Main concern"),
    ]
    present = present_of(a)
    if present == "yes":
        keys += CORE_PRESENT
    elif present == "no":
        keys += CORE_REMOTE
    return [(key, title) for key, title in keys if not _text(a, key)]


def core_unresolved(a):
    keys = CORE_PRESENT if present_of(a) == "yes" else CORE_REMOTE
    return [title for key, title in keys if _text(a, key) in UNCERTAIN]


def required_problems(a):
    out = [(f"{title}", key) for key, title in core_unanswered(a)]
    informant = _text(a, "b_informant")
    if informant and informant != "client" and not _text(a, "b_third_party"):
        out.append(("Name / relationship of the third party", "b_third_party"))
    if _text(a, "b_encounter_type") == "other" and not _text(a, "b_encounter_type_other"):
        out.append(("Encounter type — describe “Other”", "b_encounter_type_other"))
    present = present_of(a)
    if present == "yes":
        if _text(a, "d_suicidal") == "yes" and not _text(a, "d_act_now"):
            out.append(("Thinking about acting on these thoughts now?", "d_act_now"))
        if _text(a, "d_attempt") == "yes" and not _text(a, "d_what_happened"):
            out.append(("Recent attempt: what happened and when", "d_what_happened"))
        if _text(a, "f_behaviour") == "other" and not _text(a, "f_behaviour_other"):
            out.append(("Behaviour — describe “Other”", "f_behaviour_other"))
        for key, other in (
            ("f_features", "f_features_other"),
            ("h_flags", "h_flags_other"),
            ("i_flags", "i_flags_other"),
            ("j_flags", "j_flags_other"),
        ):
            if "other" in _list(a, key) and not _text(a, other):
                out.append(("Describe “Other”", other))
        if _text(a, "g_use") == "yes":
            if not used_substances(a):
                out.append(("Substances: fill the row for each substance used", "g_alcohol_last"))
            if "other" in used_substances(a) and not _text(a, "g_other_name"):
                out.append(("Substances: name the “Other” substance", "g_other_name"))
            for code in used_substances(a):
                if concern_of(a, code) == "other" and not _text(a, concern_other_key(code)):
                    out.append(
                        (
                            "Substances: describe the “Other” current concern",
                            concern_other_key(code),
                        )
                    )
        if "suspected_overdose" in _list(a, "h_flags") and any(
            not _text(a, k)
            for k in ("od_substance", "od_amount", "od_time", "od_coingest", "od_intent")
        ):
            out.append(
                ("Overdose: substance, amount, time, co-ingestants and intent", "od_substance")
            )
        if _text(a, "i_sv_recent") == "yes" and not parse_local_datetime(
            _text(a, "gbv_incident_at")
        ):
            out.append(
                ("Sexual violence: time of incident (starts the PEP clock)", "gbv_incident_at")
            )
        if _text(a, "e_named") == "yes" and not (
            _text(a, "duty_victim") and _text(a, "duty_informed")
        ):
            out.append(("Duty to protect: named person and who has been informed", "duty_victim"))
        out += vital_problems(a)
        if vitals_entered(a):
            measured = parse_local_datetime(_text(a, "v_measured_at"))
            if not measured:
                out.append(("Vital signs: time measured", "v_measured_at"))
            elif measured > timezone.now() + timedelta(minutes=MEASURED_AT_SKEW_MINUTES):
                out.append(("Vital signs: time measured is in the future", "v_measured_at"))
            if not _text(a, "v_source"):
                out.append(("Vital signs: source of the measurements", "v_source"))
        if escalation_needed(a):
            if not _text(a, "h_next"):
                out.append(("Medical concern: next step", "h_next"))
            elif _text(a, "h_next") == "refer_out":
                if not _text(a, "h_refer_facility"):
                    out.append(("Referral: facility referred to", "h_refer_facility"))
                if not _text(a, "h_refer_reason"):
                    out.append(("Referral: reason for referral", "h_refer_reason"))
        if referral_in_asked(a):
            if not _text(a, "h_referred_in"):
                out.append(("Did the client arrive with a referral?", "h_referred_in"))
            elif _text(a, "h_referred_in") == "yes":
                if not _text(a, "h_ref_facility"):
                    out.append(("Referral received: referring facility", "h_ref_facility"))
                if not _text(a, "h_ref_note"):
                    out.append(("Referral received: the referral note", "h_ref_note"))
            if _text(a, "v_source") == "referring_facility" and _text(a, "h_referred_in") == "no":
                out.append(
                    (
                        "Vital signs come from the referring facility — record the referral",
                        "h_referred_in",
                    )
                )
    elif present == "no":
        needs_next = _text(a, "k_emergency") == "no" and _text(a, "k_bring") in ("no", "uncertain")
        if needs_next and not _text(a, "r_disposition"):
            out.append(("Next step — call-back or home visit", "r_disposition"))
        if _text(a, "r_disposition") == "callback":
            if not parse_local_datetime(_text(a, "r_callback_at")):
                out.append(("Call-back time (creates a timed task)", "r_callback_at"))
            if not _text(a, "r_callback_owner"):
                out.append(("Who will call back", "r_callback_owner"))
    return out


safety_problems = v4.safety_problems


# ── The declarative rule set (same condition language as triage_v4) ──


def _eq(key, value):
    return {"eq": [key, value]}


def _has(key, code):
    return {"has": [key, code]}


_YES = lambda key: _eq(key, "yes")  # noqa: E731

RULES = [
    # D — suicide / self-harm
    {
        "id": "D-THOUGHTS",
        "scope": "present",
        "when": _YES("d_suicidal"),
        "priority": "ORANGE",
        "reason": "Current thoughts of suicide / serious self-harm",
    },
    {
        "id": "D-ACT-NOW",
        "scope": "present",
        "when": _YES("d_act_now"),
        "priority": "RED",
        "reason": "Thinking about acting on suicidal thoughts now",
    },
    {
        "id": "D-ATTEMPT",
        "scope": "present",
        "when": _YES("d_attempt"),
        "priority": "RED",
        "reason": "Recent attempt to kill or seriously harm self",
    },
    {
        "id": "D-MEANS",
        "scope": "present",
        "when": {"all": [_YES("d_means"), _YES("d_suicidal")]},
        "priority": "ORANGE",
        "reason": "Suicidal thoughts + access to means of serious self-harm",
    },
    {
        "id": "D-MEANS-ONLY",
        "scope": "present",
        "when": {"all": [_YES("d_means"), {"not": _YES("d_suicidal")}]},
        "priority": "YELLOW",
        "reason": "Access to means of serious self-harm",
    },
    # v5 — the spec's "Can the client currently maintain their own safety?"
    {
        "id": "D-UNSAFE",
        "scope": "present",
        "when": _eq("d_safety", "no"),
        "priority": "RED",
        "reason": "Cannot currently maintain own safety",
    },
    {
        "id": "D-SAFETY-UNCERTAIN",
        "scope": "present",
        "when": _eq("d_safety", "uncertain"),
        "priority": "ORANGE",
        "reason": "Uncertain whether the client can maintain own safety",
    },
    # E — risk of harm to others
    {
        "id": "E-THOUGHTS",
        "scope": "present",
        "when": _YES("e_thoughts"),
        "priority": "ORANGE",
        "reason": "Current thoughts of seriously harming someone else",
    },
    {
        "id": "E-BEHAVIOUR",
        "scope": "present",
        "when": _YES("e_behaviour"),
        "priority": "ORANGE",
        "reason": "Recent threatening, aggressive or violent behaviour",
    },
    {
        "id": "E-ACT",
        "scope": "present",
        "when": _YES("e_act"),
        "priority": "ORANGE",
        "reason": "Recent violent act",
    },
    # v5 — v4's "threatened + access to means" rule, on the spec's questions.
    {
        "id": "E-MEANS",
        "scope": "present",
        "when": {"all": [_YES("e_means"), {"any": [_YES("e_thoughts"), _YES("e_behaviour")]}]},
        "priority": "RED",
        "reason": "Risk to others + access to means capable of serious harm",
    },
    {
        "id": "E-DANGER",
        "scope": "present",
        "when": _YES("e_danger"),
        "priority": "RED",
        "reason": "Current behaviour suggests immediate danger",
    },
    {
        "id": "E-DANGER-UNCERTAIN",
        "scope": "present",
        "when": _eq("e_danger", "uncertain"),
        "priority": "ORANGE",
        "reason": "Uncertain whether behaviour suggests immediate danger",
    },
    # v5 — v4 "homicidal ideation, named victim" (RED, duty to protect).
    {
        "id": "E-NAMED",
        "scope": "present",
        "when": _YES("e_named"),
        "priority": "RED",
        "reason": "Thoughts of seriously harming an identifiable person — duty to protect",
    },
    # F — acute mental state
    {
        "id": "F-CHANGE",
        "scope": "present",
        "when": _YES("f_change"),
        "priority": "ORANGE",
        "reason": "Major change in mental state",
    },
    {
        "id": "F-DISORIENTED",
        "scope": "present",
        "when": _eq("f_orientation", "disoriented"),
        "priority": "ORANGE",
        "reason": "Disoriented / confused (observed)",
    },
    {
        "id": "F-AGGRESSIVE",
        "scope": "present",
        "when": _eq("f_behaviour", "aggressive"),
        "priority": "ORANGE",
        "reason": "Aggressive (observed)",
    },
    # G — alcohol & other substances
    {
        "id": "G-INTOX",
        "scope": "present",
        "when": {"in": ["g_intoxication", ["significant", "severe"]]},
        "priority": "ORANGE",
        "reason": "Significant / severe intoxication",
    },
    {
        "id": "G-WD-SEIZURE",
        "scope": "present",
        "when": _has("g_withdrawal", "seizure"),
        "priority": "RED",
        "reason": "Seizure with current withdrawal",
    },
    {
        "id": "G-WD-OPIOID",
        "scope": "present",
        "when": {"all": [{"fact": "withdrawal"}, {"fact": "opioid_only"}]},
        "priority": "YELLOW",
        "reason": "Opioid withdrawal — distressing, rarely life-threatening",
    },
    {
        "id": "G-WD",
        "scope": "present",
        "when": {"all": [{"fact": "withdrawal"}, {"not": {"fact": "opioid_only"}}]},
        "priority": "ORANGE",
        "reason": "Alcohol / sedative (or unknown) withdrawal — can be life-threatening",
    },
    {
        "id": "G-STOPPED",
        "scope": "present",
        "when": {
            "all": [
                _YES("g_stopped"),
                {"not": {"fact": "withdrawal"}},
                {"not": {"fact": "opioid_only"}},
            ]
        },
        "priority": "YELLOW",
        "reason": "Recently stopped heavy / frequent use — withdrawal risk",
    },
    {
        "id": "G-HISTORY",
        "scope": "present",
        "when": {
            "all": [
                {"any": [_YES("g_seizure_hx"), _YES("g_dts_hx")]},
                {"any": [{"fact": "withdrawal"}, _YES("g_stopped")]},
            ]
        },
        "priority": "ORANGE",
        "reason": "Previous withdrawal seizure / DTs with current withdrawal risk",
    },
    # H — urgent medical screen
    {
        "id": "H-CONCERN",
        "scope": "present",
        "when": _YES("h_concern"),
        "priority": "ORANGE",
        "reason": "Immediate physical / medical concern",
    },
    *[
        {
            "id": f"H-{code}",
            "scope": "present",
            "when": _has("h_flags", code),
            "priority": "RED",
            "reason": "{h:" + code + "}",
        }
        for code in sorted(RED_MEDICAL)
    ],
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
    # I — safeguarding
    {
        "id": "I-CONCERN",
        "scope": "present",
        "when": {"fact": "safeguarding"},
        "priority": "ORANGE",
        "reason": "Safeguarding / vulnerability concern",
    },
    # J — immediate functional safety
    {
        "id": "J-CONCERN",
        "scope": "present",
        "when": _YES("j_concern"),
        "priority": "YELLOW",
        "reason": "Cannot safely care for basic needs",
    },
    # K — telephone / third party (source: third-party report, or client by phone)
    {
        "id": "K-EMERGENCY",
        "scope": "remote",
        "when": _YES("k_emergency"),
        "priority": "RED",
        "reason": "Emergency assistance required",
    },
    {
        "id": "K-ATTEMPT",
        "scope": "remote",
        "when": _has("k_flags", "recent_attempt"),
        "priority": "RED",
        "reason": "Recent attempt / self-harm reported",
    },
    {
        "id": "K-SUICIDE-MEANS",
        "scope": "remote",
        "when": {"all": [_has("k_flags", "suicide_concern"), _has("k_flags", "access_to_means")]},
        "priority": "RED",
        "reason": "Suicide / self-harm concern + access to serious means",
    },
    {
        "id": "K-SUICIDE",
        "scope": "remote",
        "when": _has("k_flags", "suicide_concern"),
        "priority": "ORANGE",
        "reason": "Suicide / self-harm concern reported",
    },
    {
        "id": "K-OTHER-MEANS",
        "scope": "remote",
        "when": {"all": [_has("k_flags", "risk_to_other"), _has("k_flags", "access_to_means")]},
        "priority": "RED",
        "reason": "Threat to another person + access to serious means",
    },
    {
        "id": "K-OTHER",
        "scope": "remote",
        "when": _has("k_flags", "risk_to_other"),
        "priority": "ORANGE",
        "reason": "Threat / risk to another person reported",
    },
    {
        "id": "K-MEANS-ONLY",
        "scope": "remote",
        "when": {
            "all": [
                _has("k_flags", "access_to_means"),
                {"not": _has("k_flags", "suicide_concern")},
                {"not": _has("k_flags", "risk_to_other")},
            ]
        },
        "priority": "YELLOW",
        "reason": "Access to serious means reported",
    },
    *[
        {
            "id": f"K-{code}",
            "scope": "remote",
            "when": _has("k_flags", code),
            "priority": level,
            "reason": "{k:" + code + "}",
        }
        for code, level in (
            ("seizure", "RED"),
            ("loss_consciousness", "RED"),
            ("serious_injury", "RED"),
            ("severe_confusion", "ORANGE"),
            ("severe_agitation", "ORANGE"),
            ("psychotic_behaviour", "ORANGE"),
            ("possible_withdrawal", "ORANGE"),
            ("significant_intoxication", "YELLOW"),
        )
    ],
    # v5 — mirrors v4's "no responsible person" step-up.
    {
        "id": "K-CANNOT-BRING",
        "scope": "remote",
        "phase": "post",
        "when": {"all": [_eq("k_bring", "no"), {"level": "YELLOW"}]},
        "priority": "ORANGE",
        "reason": "Cannot be brought safely, with a reported concern",
    },
    {
        "id": "K-ALONE",
        "scope": "remote",
        "phase": "post",
        "when": {"all": [_YES("k_alone"), {"level": "YELLOW"}]},
        "priority": "ORANGE",
        "reason": "Alone, with a reported concern",
    },
]


def _facts(a):
    score = ews.score(v4.ews_input(a))
    acvpu = _text(a, "acvpu")
    withdrawing = [c for c in used_substances(a) if concern_of(a, c) == "withdrawal"]
    basis = set(withdrawing or used_substances(a))
    safeguarding = [f for f in _list(a, "i_flags") if f != "none_identified"]
    return {
        "ews": score,
        "ews_emergency": bool(score["measured"])
        and (score["score"] >= v4.EWS_PRIORITY["RED_AT_OR_ABOVE"] or acvpu in ("C", "V", "P", "U")),
        "ews_urgent": bool(score["measured"])
        and (
            score["score"] >= v4.EWS_PRIORITY["ORANGE_AT_OR_ABOVE"] or score["single_parameter_3"]
        ),
        "glucose_low": score["glucose_low"],
        "withdrawal": bool(withdrawal_symptoms(a) or withdrawing),
        "opioid_only": bool(basis)
        and basis <= v4.NON_LIFE_THREATENING_WITHDRAWAL
        and "opioids" in basis,
        "safeguarding": bool(safeguarding)
        or _text(a, "i_safe") == "no"
        or _text(a, "i_return") == "no",
    }


def evaluate(answers, labels=None):
    labels = labels or {}
    a = clean_answers(answers)
    present = present_of(a)
    facts = _facts(a) if present == "yes" else _facts({})
    score = facts["ews"]
    fmt = {
        "ews": score["label"],
        "acvpu": (
            f" · ACVPU {_text(a, 'acvpu')}" if _text(a, "acvpu") in ("C", "V", "P", "U") else ""
        ),
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
            if v4._test(rule["when"], a, facts, level):
                fired.append(
                    {
                        "priority": rule["priority"],
                        "reason": _reason(rule["reason"], fmt, labels),
                        "rule": rule["id"],
                    }
                )
                if PRIORITY_RANK[rule["priority"]] > PRIORITY_RANK[level]:
                    level = rule["priority"]
    fired.sort(key=lambda r: -PRIORITY_RANK[r["priority"]])

    items, alerts = _findings(a, labels, score), _alerts(a, facts)
    unanswered = [title for _k, title in core_unanswered(a)]
    unresolved = core_unresolved(a) if present else []
    ready = not unanswered and not unresolved
    if ready:
        recommendation = level
    elif fired:
        recommendation = f"{level} — preliminary"
    else:
        recommendation = "Review required"
    reasons = " · ".join(r["reason"] for r in fired)
    if unresolved:
        reasons = " · ".join(
            filter(None, [reasons, "Unable to determine: " + ", ".join(unresolved)])
        )
    if not reasons:
        reasons = (
            "No immediate safety / medical concern identified in the completed screen."
            if ready
            else "Complete the first questions and each section's screening question. "
            "Unanswered items are not treated as negative findings."
        )
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
        "alerts": [{"code": c, "label": triage_rules.ALERT_LABELS[c]} for c in alerts],
        "findings": [[i["finding"], i["status"], i["source"]] for i in items],
        "finding_items": items,
        "triggers": sorted(_triggers(alerts)),
        "unanswered": unanswered,
        "unresolved": unresolved,
        "ews": score if present == "yes" else None,
        "recommended_actions": _recommended_actions(level, alerts, a),
        "safety_required": present == "yes" and level in ("RED", "ORANGE"),
        "medical_escalation": escalation_needed(a),
        "referral_in_asked": referral_in_asked(a),
        "auto_triggers": auto_triggers(a, alerts, labels),
    }


def _reason(template, fmt, labels):
    if template.startswith("{h:"):
        return _label(labels, "triage-medical-concern", template[3:-1])
    if template.startswith("{k:"):
        return _label(labels, "triage-telephone-concern", template[3:-1]) + " reported"
    return template.format(**fmt)


def _alerts(a, facts):
    out = []

    def add(code):
        if code not in out:
            out.append(code)

    present = present_of(a)
    if present == "yes":
        if (
            any(_text(a, k) == "yes" for k in ("d_suicidal", "d_act_now", "d_attempt"))
            or _text(a, "d_safety") == "no"
        ):
            add("SUICIDE_RISK")
        if (
            any(
                _text(a, k) == "yes"
                for k in ("e_thoughts", "e_behaviour", "e_act", "e_danger", "e_named")
            )
            or _text(a, "f_behaviour") == "aggressive"
        ):
            add("AGGRESSION_RISK")
        features = set(_list(a, "f_features"))
        if _text(a, "f_change") == "yes":
            add("MENTAL_STATE_CHANGE")
        if features & {"psychotic_symptoms", "command_hallucinations", "severe_agitation"}:
            add("PSYCHOSIS_AGITATION")
        if (
            _text(a, "acvpu") in ("C", "V", "P", "U")
            or "loss_consciousness" in _list(a, "h_flags")
            or _text(a, "f_orientation") == "disoriented"
        ):
            add("ALTERED_CONSCIOUSNESS")
        if facts["withdrawal"] or _text(a, "g_stopped") == "yes":
            add("WITHDRAWAL_RISK")
        critical = facts["ews_urgent"] or facts["ews_emergency"] or facts["glucose_low"]
        # 2026-10-28.2 — a critical measurement is an acute medical concern too.
        if _text(a, "h_concern") == "yes" or critical:
            add("MEDICAL_CONCERN")
        if critical:
            add("ABNORMAL_VITALS")
        if facts["safeguarding"]:
            add("SAFEGUARDING")
    elif present == "no":
        reported = set(_list(a, "k_flags"))
        if reported & {"suicide_concern", "recent_attempt"}:
            add("SUICIDE_RISK")
        if reported & {"risk_to_other", "severe_agitation"}:
            add("AGGRESSION_RISK")
        if "psychotic_behaviour" in reported:
            add("PSYCHOSIS_AGITATION")
        if reported & {"severe_confusion", "loss_consciousness"}:
            add("ALTERED_CONSCIOUSNESS")
        if "possible_withdrawal" in reported:
            add("WITHDRAWAL_RISK")
        if reported & {"seizure", "serious_injury"}:
            add("MEDICAL_CONCERN")
        if _text(a, "k_emergency") == "yes":
            add("TELEPHONE_EMERGENCY")
    return out


def _triggers(alerts):
    letters = {
        "SUICIDE_RISK": "d",
        "AGGRESSION_RISK": "e",
        "MENTAL_STATE_CHANGE": "f",
        "PSYCHOSIS_AGITATION": "f",
        "ALTERED_CONSCIOUSNESS": "f",
        "WITHDRAWAL_RISK": "g",
        "MEDICAL_CONCERN": "h",
        "ABNORMAL_VITALS": "h",
        "SAFEGUARDING": "i",
    }
    return {letters[c] for c in alerts if c in letters}


def withdrawal_tools(a):
    """Spec G system triggers: alcohol use with recent cessation or withdrawal
    risk → PAWSS; current alcohol withdrawal → CIWA-Ar; current opioid
    withdrawal → COWS. Codes from the `triage-action` value set."""
    if present_of(a) != "yes":
        return []
    out = []
    used = set(used_substances(a))
    alcohol_wd = concern_of(a, "alcohol") == "withdrawal"
    if "alcohol" in used and (
        alcohol_wd
        or _text(a, "g_stopped") == "yes"
        or withdrawal_symptoms(a)
        or _text(a, "g_seizure_hx") == "yes"
        or _text(a, "g_dts_hx") == "yes"
    ):
        out.append("pawss")
    if alcohol_wd:
        out.append("ciwa_ar")
    if concern_of(a, "opioids") == "withdrawal":
        out.append("cows")
    return out


TOOL_ALERTS = {
    "pawss": "Alcohol withdrawal risk",
    "ciwa_ar": "Alcohol withdrawal",
    "cows": "Opioid withdrawal",
}


def auto_triggers(a, alerts, labels=None):
    """The AUTO-TRIGGER banner under each section: [{code, section, alert,
    pathway}] for every tool or pathway the answers have started. Only what the
    rules above already raise or recommend; nothing is decided here. An alert
    that starts nothing (it only goes on the client record) is not listed (QA,
    2026-10-29). `a` is the cleaned answer set."""
    labels = labels or {}

    def act(code):
        return _label(labels, "triage-action", code).split(" — ")[0]

    out = []

    def add(code, section, alert, *pathway):
        out.append(
            {
                "code": code,
                "section": section,
                "alert": alert,
                "pathway": " + ".join(pathway),
            }
        )

    def alert(code):
        return triage_rules.ALERT_LABELS[code]

    present = present_of(a)
    if present == "no":
        if _text(a, "r_disposition") == "callback":
            add("TRIAGE_CALLBACK", "k", "Telephone triage", "Timed call-back task")
        return out
    if present != "yes":
        return out
    if "SUICIDE_RISK" in alerts:
        add(
            "SUICIDE_RISK",
            "d",
            alert("SUICIDE_RISK"),
            act("suicide_risk_assessment"),
            act("safety_plan"),
        )
    if _text(a, "e_named") == "yes":
        add(
            "DUTY_TO_PROTECT",
            "e",
            "Identifiable person at risk",
            "Duty to protect — senior decision",
        )
    if "WITHDRAWAL_RISK" in alerts:
        add("WITHDRAWAL_RISK", "g", alert("WITHDRAWAL_RISK"), act("withdrawal_monitoring"))
    for tool in withdrawal_tools(a):
        add(f"TOOL:{tool}", "g", TOOL_ALERTS[tool], act(tool))
    if "suspected_overdose" in _list(a, "h_flags"):
        add("OVERDOSE", "h", "Suspected overdose", "Medical emergency first")
    if "MEDICAL_CONCERN" in alerts:
        add("MEDICAL_CONCERN", "h", alert("MEDICAL_CONCERN"), act("urgent_medical_review"))
    if "ABNORMAL_VITALS" in alerts:
        add("ABNORMAL_VITALS", "h", alert("ABNORMAL_VITALS"), act("urgent_medical_review"))
    if "SAFEGUARDING" in alerts:
        add("SAFEGUARDING", "i", alert("SAFEGUARDING"), act("safeguarding_intervention"))
    if _text(a, "i_sv_recent") == "yes":
        add(
            "PEP_EC",
            "i",
            "Sexual violence in the last 72 hours",
            "PEP & emergency-contraception decision",
        )
    return out


def trigger_texts(answers, labels=None):
    """{code: "alert → pathway"} for the audit trail of raises and clears."""
    result = evaluate(answers, labels)
    return {t["code"]: f"{t['alert']} → {t['pathway']}" for t in result["auto_triggers"]}


def _recommended_actions(level, alerts, a):
    """Suggestions only — pre-marked "recommended", never auto-confirmed."""
    out = []
    if level == "RED":
        out.append("emergency_intervention")
    out.append(
        {
            "RED": "urgent_psychiatric_review",
            "ORANGE": "urgent_psychiatric_review",
            "YELLOW": "priority_psychiatric_review",
            "GREEN": "routine_psychiatric_review",
        }[level]
    )
    if "SUICIDE_RISK" in alerts:
        out += ["suicide_risk_assessment", "safety_plan"]
    red_medical = set(_list(a, "h_flags")) & RED_MEDICAL or set(_list(a, "k_flags")) & {
        "seizure",
        "loss_consciousness",
        "serious_injury",
    }
    if red_medical or "ABNORMAL_VITALS" in alerts or "MEDICAL_CONCERN" in alerts:
        out.append("urgent_medical_review")
    if "WITHDRAWAL_RISK" in alerts:
        out.append("withdrawal_monitoring")
    out += withdrawal_tools(a)
    if "SAFEGUARDING" in alerts:
        out.append("safeguarding_intervention")
    if _text(a, "safety_obs") in ("INTERMITTENT_15", "EYESIGHT", "ARMS_LENGTH"):
        out.append("enhanced_observation")
    if level in ("GREEN", "YELLOW") and present_of(a) == "yes":
        out.append("comprehensive_intake")
    return out


# ── L — the automatic summary, each row with its source (spec §13) ──


def _findings(a, labels, score):
    items = []
    src_code, src_label, src_detail = source_of(a)
    L = lambda vs, code: _label(labels, vs, code)  # noqa: E731

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

    def observed(finding, status):
        add(finding, status, "CLINICIAN_OBSERVATION", "Clinician observation", "")

    present = present_of(a)
    if present == "no":
        where = [
            f"where: {_text(a, 'k_where')}" if _text(a, "k_where") else "",
            (
                f"alone: {L('yes-no-unknown', _text(a, 'k_alone')).lower()}"
                if _text(a, "k_alone")
                else ""
            ),
            f"with: {_text(a, 'k_with')}" if _text(a, "k_with") else "",
            f"last seen / spoken to: {_text(a, 'k_last_seen')}" if _text(a, "k_last_seen") else "",
        ]
        if any(where):
            add("Where and with whom", " · ".join(w for w in where if w))
        reported = _list(a, "k_flags")
        add(
            "Concern reported",
            ", ".join(L("triage-telephone-concern", c) for c in reported) or "No concerns reported",
        )
        if _text(a, "k_bring"):
            add("Can be brought safely", L("yes-no-uncertain", _text(a, "k_bring")))
        if _text(a, "k_emergency"):
            add("Emergency assistance required", L("no-yes", _text(a, "k_emergency")))
        if _text(a, "r_disposition"):
            add(
                "Next step",
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

    for domain in domain_findings(a, labels):
        if domain["key"] == "PRESENTING_CONCERN":
            continue
        if domain["source_code"] == "CLINICIAN_OBSERVATION":
            observed(domain["title"], domain["summary"])
        else:
            add(domain["title"], domain["summary"])
    if "suspected_overdose" in _list(a, "h_flags"):
        intent = _text(a, "od_intent")
        add(
            "Overdose details",
            f"{_text(a, 'od_substance') or '—'} · amount {_text(a, 'od_amount') or '—'} · time "
            f"{_text(a, 'od_time') or '—'} · co-ingestants {_text(a, 'od_coingest') or '—'} · "
            f"intent {L('triage-v4-od-intent', intent) if intent else '—'}",
        )
    if _text(a, "i_sv_recent") == "yes":
        add(
            "Sexual violence — time of incident",
            (_text(a, "gbv_incident_at") or "—") + " · PEP / EC decision task",
        )
    if _text(a, "e_named") == "yes":
        add(
            "Duty to protect",
            f"Person at risk: {_text(a, 'duty_victim') or '—'} · informed: "
            f"{_text(a, 'duty_informed') or '—'} · senior decision requested",
            "CLINICIAN_OBSERVATION",
            "Triage decision",
            "",
        )
    vitals = vitals_text(a, labels, score)
    measured = parse_local_datetime(_text(a, "v_measured_at"))
    if measured:
        vitals += f" · measured {timezone.localtime(measured).strftime('%Y-%m-%d %H:%M')}"
    vitals_source = _text(a, "v_source")
    add(
        "Vital signs",
        vitals,
        "MEASUREMENT",
        (
            f"Measurement — {L('triage-vitals-source', vitals_source).lower()}"
            if vitals_source and vitals_source != "here"
            else "Measurement"
        ),
        "",
    )
    if _text(a, "h_next"):
        step = L("triage-medical-escalation", _text(a, "h_next"))
        if _text(a, "h_next") == "refer_out":
            step += f" → {_facility(a, 'h_refer')} · reason: {_text(a, 'h_refer_reason') or '—'}"
        add("Medical concern — next step", step, "CLINICIAN_OBSERVATION", "Triage decision", "")
    if _text(a, "h_referred_in") == "yes":
        add(
            "Referral received",
            f"{_facility(a, 'h_ref')} · {_text(a, 'h_ref_note') or '—'}",
            "REFERRAL",
            "Referral note",
            "",
        )
    if _text(a, "safety_obs") or _text(a, "safety_location"):
        observed("Waiting-room safety", safety_text(a, labels))
    return items


def _facility(a, prefix):
    name = _text(a, f"{prefix}_facility") or "—"
    fr = _text(a, f"{prefix}_fr")
    return f"{name} (FR {fr})" if fr else name


# ── The shared finding store (spec §17): one finding per domain ──

DOMAIN_TITLES = {
    "PRESENTING_CONCERN": "Presenting concern",
    "SUICIDE_SELF_HARM": "Suicide / self-harm",
    "HARM_TO_OTHERS": "Risk of harm to others",
    "MENTAL_STATE": "Acute mental state",
    "SUBSTANCE_USE": "Alcohol & other substances",
    "SUBSTANCE": "Substance",
    "MEDICAL": "Urgent medical concern",
    "SAFEGUARDING": "Safeguarding & vulnerability",
    "FUNCTIONAL": "Immediate functional safety",
}


def _status(answer, *, yes=("yes",), unknown=UNCERTAIN):
    if answer in yes:
        return "PRESENT"
    if answer in unknown:
        return "UNKNOWN"
    return "ABSENT" if answer else ""


def domain_findings(a, labels=None):
    """[{key, domain, title, status, summary, values, source_*}] — what this
    triage found per domain. In person, a negative answer is a finding too (a
    denial of suicidal thoughts is recorded, not left blank); by telephone only
    what the caller reported is recorded."""
    labels = labels or {}
    a = clean_answers(a)
    L = lambda vs, code: _label(labels, vs, code)  # noqa: E731
    src_code, src_label, src_detail = source_of(a)
    out = []

    def add(key, domain, status, summary, values, code=None, label=None, title=None):
        if not status:
            return
        out.append(
            {
                "key": key,
                "domain": domain,
                "title": title or DOMAIN_TITLES[domain],
                "status": status,
                "summary": summary,
                "values": values,
                "source_code": code or src_code,
                "source_label": label or src_label,
                "source_detail": "" if code else src_detail,
            }
        )

    def pick(*keys):
        return {k: a[k] for k in keys if k in a and a[k] not in ("", [], None)}

    def yn(vs, key, prefix):
        return f"{prefix}: {L(vs, _text(a, key)).lower()}" if _text(a, key) else ""

    def join(*parts):
        return " · ".join(p for p in parts if p)

    concern = _text(a, "c_concern")
    if concern:
        add(
            "PRESENTING_CONCERN",
            "PRESENTING_CONCERN",
            "PRESENT",
            join(concern, yn("triage-onset", "c_onset", "began / worse")),
            pick("c_concern", "c_onset", "c_description"),
        )
    present = present_of(a)
    if present == "no":

        def remote(key, domain, codes):
            hit = [c for c in _list(a, "k_flags") if c in codes]
            if hit:
                add(
                    key,
                    domain,
                    "PRESENT",
                    ", ".join(L("triage-telephone-concern", c) for c in hit),
                    {"k_flags": hit},
                )

        suicide = {"suicide_concern", "recent_attempt"}
        if suicide & set(_list(a, "k_flags")):
            suicide.add("access_to_means")
        remote("SUICIDE_SELF_HARM", "SUICIDE_SELF_HARM", suicide)
        remote("HARM_TO_OTHERS", "HARM_TO_OTHERS", {"risk_to_other", "severe_agitation"})
        remote("MENTAL_STATE", "MENTAL_STATE", {"severe_confusion", "psychotic_behaviour"})
        remote(
            "SUBSTANCE_USE", "SUBSTANCE_USE", {"significant_intoxication", "possible_withdrawal"}
        )
        remote("MEDICAL", "MEDICAL", {"seizure", "loss_consciousness", "serious_injury"})
        return out
    if present != "yes":
        return out

    d = (
        "yes"
        if any(_text(a, k) == "yes" for k in ("d_suicidal", "d_attempt"))
        else _text(a, "d_suicidal")
    )
    add(
        "SUICIDE_SELF_HARM",
        "SUICIDE_SELF_HARM",
        _status(d),
        join(
            yn("no-yes-unable", "d_suicidal", "current thoughts"),
            yn("no-yes-unsure", "d_act_now", "acting now"),
            yn("no-yes", "d_attempt", "recent attempt")
            + (f" ({_text(a, 'd_what_happened')})" if _text(a, "d_what_happened") else ""),
            yn("no-yes-unknown", "d_means", "access to means"),
            yn("yes-no-uncertain", "d_safety", "can maintain own safety"),
        ),
        pick("d_suicidal", "d_act_now", "d_attempt", "d_what_happened", "d_means", "d_safety"),
    )

    e_keys = ("e_thoughts", "e_behaviour", "e_act", "e_danger", "e_named")
    e = "yes" if any(_text(a, k) == "yes" for k in e_keys) else _text(a, "e_thoughts")
    add(
        "HARM_TO_OTHERS",
        "HARM_TO_OTHERS",
        _status(e),
        join(
            yn("no-yes-unable", "e_thoughts", "current thoughts"),
            yn("no-yes-unknown", "e_behaviour", "recent threatening / aggressive behaviour"),
            f"concern: {_text(a, 'e_concern')}" if _text(a, "e_concern") else "",
            yn("no-yes", "e_act", "recent violent act"),
            yn("no-yes-unknown", "e_means", "access to means"),
            yn("no-yes-uncertain", "e_danger", "immediate danger"),
            "identifiable person at risk" if _text(a, "e_named") == "yes" else "",
        ),
        pick("e_thoughts", "e_behaviour", "e_concern", "e_act", "e_means", "e_danger", "e_named"),
    )

    features = [L("triage-mental-state-feature", f) for f in _list(a, "f_features") if f != "other"]
    if _text(a, "f_features_other"):
        features.append(_text(a, "f_features_other"))
    add(
        "MENTAL_STATE",
        "MENTAL_STATE",
        _status(_text(a, "f_change")),
        join(yn("no-yes-unable", "f_change", "major change"), ", ".join(features)),
        pick("f_change", "f_features", "f_features_other"),
    )
    behaviour = (
        _text(a, "f_behaviour_other")
        if _text(a, "f_behaviour") == "other"
        else L("triage-behaviour", _text(a, "f_behaviour")) if _text(a, "f_behaviour") else ""
    )
    observation = join(
        f"ACVPU {_text(a, 'acvpu')}" if _text(a, "acvpu") else "",
        yn("triage-orientation", "f_orientation", "orientation"),
        f"behaviour: {behaviour.lower()}" if behaviour else "",
    )
    if observation:
        abnormal = (
            _text(a, "acvpu") in ("C", "V", "P", "U")
            or _text(a, "f_orientation") in ("disoriented", "unable")
            or _text(a, "f_behaviour") not in ("", "calm")
        )
        add(
            "MENTAL_STATE_OBSERVATION",
            "MENTAL_STATE",
            "PRESENT" if abnormal else "ABSENT",
            observation,
            pick("acvpu", "f_orientation", "f_behaviour", "f_behaviour_other"),
            "CLINICIAN_OBSERVATION",
            "Clinician observation",
            title="Mental state — observation",
        )

    symptoms = withdrawal_symptoms(a)
    add(
        "SUBSTANCE_USE",
        "SUBSTANCE_USE",
        _status(_text(a, "g_use"), unknown=("unknown",)),
        join(
            yn("no-yes-unknown", "g_use", "recent use"),
            yn("triage-intoxication", "g_intoxication", "intoxication"),
            yn("no-yes-unknown", "g_stopped", "recently stopped heavy use"),
            (
                (
                    "withdrawal: "
                    + ", ".join(L("triage-withdrawal-symptom", w) for w in symptoms).lower()
                )
                if symptoms
                else ("withdrawal: none" if "none" in _list(a, "g_withdrawal") else "")
            ),
            yn("no-yes-unknown", "g_seizure_hx", "previous withdrawal seizure"),
            yn("no-yes-unknown", "g_dts_hx", "previous severe withdrawal / DTs"),
        ),
        pick("g_use", "g_intoxication", "g_stopped", "g_withdrawal", "g_seizure_hx", "g_dts_hx"),
    )
    for code in used_substances(a):
        name = (
            _text(a, "g_other_name") or "Other"
            if code == "other"
            else L("triage-v4-substance", code)
        )
        cells = {col: _text(a, substance_cell(code, col)) for col in SUBSTANCE_COLUMNS}
        concern = (
            _text(a, concern_other_key(code)) or "other"
            if cells["concern"] == "other"
            else L("triage-substance-concern", cells["concern"]).lower()
        )
        add(
            f"SUBSTANCE:{code}",
            "SUBSTANCE",
            "PRESENT",
            join(
                f"last use {cells['last']}" if cells["last"] else "",
                cells["amount"],
                f"concern: {concern}" if cells["concern"] else "",
            ),
            pick(
                *(substance_cell(code, c) for c in SUBSTANCE_COLUMNS),
                concern_other_key(code),
                *(("g_other_name",) if code == "other" else ()),
            ),
            title=f"Substance — {name}",
        )

    medical = [L("triage-medical-concern", f) for f in _list(a, "h_flags") if f != "other"]
    if _text(a, "h_flags_other"):
        medical.append(_text(a, "h_flags_other"))
    add(
        "MEDICAL",
        "MEDICAL",
        _status(_text(a, "h_concern"), unknown=("unknown",)),
        join(
            yn("no-yes-unknown", "h_concern", "immediate concern"),
            ", ".join(medical),
            yn("triage-medical-escalation", "h_next", "next step"),
        ),
        pick("h_concern", "h_flags", "h_flags_other", "h_next"),
    )

    concerns = [L("triage-safeguarding-concern", f) for f in _list(a, "i_flags") if f != "other"]
    if _text(a, "i_flags_other"):
        concerns.append(_text(a, "i_flags_other"))
    safeguarding = (
        "PRESENT"
        if [f for f in _list(a, "i_flags") if f != "none_identified"]
        or "no" in (_text(a, "i_safe"), _text(a, "i_return"))
        else _status(_text(a, "i_safe"), yes=(), unknown=("unsure", "unable"))
    )
    add(
        "SAFEGUARDING",
        "SAFEGUARDING",
        safeguarding,
        join(
            yn("triage-feels-safe", "i_safe", "feels safe"),
            ", ".join(concerns),
            yn("yes-no-uncertain", "i_return", "safe to return"),
        ),
        pick("i_safe", "i_flags", "i_flags_other", "i_return", "i_sv_recent"),
    )

    areas = [L("triage-functional-area", f) for f in _list(a, "j_flags") if f != "other"]
    if _text(a, "j_flags_other"):
        areas.append(_text(a, "j_flags_other"))
    add(
        "FUNCTIONAL",
        "FUNCTIONAL",
        _status(_text(a, "j_concern")),
        join(yn("no-yes-uncertain", "j_concern", "cannot meet basic needs"), ", ".join(areas)),
        pick("j_concern", "j_flags", "j_flags_other"),
    )
    return out


def served_config():
    base = v4.served_config()
    return {
        **base,
        "schema": SCHEMA,
        "rules_version": RULES_VERSION,
        "ruleset_label": RULESET_LABEL,
        "substances": SUBSTANCE_ROWS,
        "core_present": [{"key": k, "title": t} for k, t in CORE_PRESENT],
        "core_remote": [{"key": k, "title": t} for k, t in CORE_REMOTE],
    }
