"""
Triage recommendation rules — docs/15-CLINICAL-WORKSPACE-V3.md §1.6, a
line-for-line port of the approved mockup's `recompute()`.

Authoritative on the server: the browser shows the result of `evaluate()`
(via the draft/evaluate endpoints), and signing re-runs it and stores
`RULES_VERSION` with the signed record, so every signed triage says exactly
which rule set produced its recommendation.

Approved by the project owner on 2026-10-07 (docs/15 §4): the vital-sign
thresholds, the 10-minute triage target and the re-check intervals below
(YELLOW 60 / GREEN 120 from the mockup; RED 15 / ORANGE 30 as recommended).
Changing any of them is a clinical decision: bump RULES_VERSION so signed
records keep pointing at the rule set they were produced by.
"""

from datetime import timedelta

RULES_VERSION = "2026-10-07.1"

TRIAGE_TARGET_MINUTES = 10

# Minutes after signing until a re-check is due, by final priority.
# Approved 2026-10-07.
RECHECK_INTERVAL_MINUTES = {"RED": 15, "ORANGE": 30, "YELLOW": 60, "GREEN": 120}

VITAL_THRESHOLDS = {
    "systolic_above": 160,
    "pulse_above": 120,
    "pulse_below": 50,
    "spo2_below": 92,
    "temperature_above": 38.5,
}

PRIORITY_RANK = {"GREEN": 0, "YELLOW": 1, "ORANGE": 2, "RED": 3}

# The six core safety screens: unanswered is never treated as negative.
CORE_SCREENS = [
    ("d_suicidal", "Suicide / self-harm"),
    ("e_thoughts", "Risk of harm to others"),
    ("f_change", "Acute mental state"),
    ("h_concern", "Urgent medical concern"),
    ("i_safe", "Safeguarding / current safety"),
    ("j_concern", "Immediate functional safety"),
]
UNCERTAIN_VALUES = {"unable", "unknown", "unsure", "uncertain"}

RED_MEDICAL_FLAGS = {
    "chest_pain",
    "recent_seizure",
    "suspected_overdose",
    "difficulty_breathing",
    "loss_consciousness",
}

# Clinical alert codes (`clinical-alert` value set) and their banner labels.
ALERT_LABELS = {
    "SUICIDE_RISK": "Suicide risk",
    "AGGRESSION_RISK": "Aggression / violence risk",
    "WITHDRAWAL_RISK": "Withdrawal risk",
    "ALTERED_CONSCIOUSNESS": "Altered consciousness",
    "ABNORMAL_VITALS": "Abnormal vital signs",
    "SAFEGUARDING": "Safeguarding concern",
    "TELEPHONE_EMERGENCY": "Telephone screen: emergency assistance required",
}

# Defaults match the mockup's pre-selected options. The core screens start
# unanswered on purpose.
DEFAULT_ANSWERS = {
    "b_encounter_type": "walk_in",
    "b_informant": "client",
    "b_present": "yes",
    "c_onset": "today",
    "d_suicidal": "",
    "d_act_now": "no",
    "d_attempt": "no",
    "d_means": "no",
    "d_safety": "yes",
    "e_thoughts": "",
    "e_behaviour": "no",
    "e_act": "no",
    "e_means": "no",
    "e_danger": "no",
    "f_change": "",
    "f_features": [],
    "f_consciousness": "alert",
    "f_orientation": "oriented",
    "f_behaviour": "calm",
    "g_use": "no",
    "g_intoxication": "none",
    "g_stopped": "no",
    "g_seizure": "no",
    "g_withdrawal": [],
    "h_concern": "",
    "h_flags": [],
    "i_safe": "",
    "i_flags": [],
    "i_return": "yes",
    "j_concern": "",
    "j_flags": [],
    "k_alone": "yes",
    "k_bring": "yes",
    "k_emergency": "no",
    "k_flags": [],
}


def _number(value, cast=int):
    """Parse a typed measurement; blank or malformed input is "not recorded"."""
    text = "" if value is None else str(value).strip()
    if not text:
        return None
    try:
        return cast(text)
    except (TypeError, ValueError, ArithmeticError):
        return None


def parse_blood_pressure(value):
    """ "128/82" → (128, 82); missing parts are None."""
    if not value:
        return None, None
    parts = str(value).split("/")
    systolic = _number(parts[0])
    diastolic = _number(parts[1]) if len(parts) > 1 else None
    return systolic, diastolic


def evaluate(answers, labels=None):
    """Return the live safety summary for a set of triage answers.

    `labels` maps (valueset_id, code) → display text, used for the finding
    rows; codes are shown when no label is known.
    """
    labels = labels or {}
    a = {**DEFAULT_ANSWERS, **(answers or {})}

    def v(key):
        value = a.get(key)
        return value if value is not None else ""

    def many(key):
        value = a.get(key) or []
        return [item for item in value if item] if isinstance(value, list) else []

    def label(valueset, code):
        return labels.get((valueset, code), code)

    rows, reasons, alerts, triggers = [], [], [], set()
    state = {"rec": "GREEN"}

    def bump(priority):
        if PRIORITY_RANK[priority] > PRIORITY_RANK[state["rec"]]:
            state["rec"] = priority

    def alert(code):
        if code not in alerts:
            alerts.append(code)

    present = v("b_present") != "no"

    # D — suicide / self-harm
    if v("d_suicidal") == "yes":
        alert("SUICIDE_RISK")
        bump("ORANGE")
        reasons.append("suicidal thoughts present")
        rows.append(
            [
                "Suicide risk",
                (
                    "Thoughts of acting now — YES"
                    if v("d_act_now") == "yes"
                    else "Suicidal thoughts documented"
                ),
                "Client report",
            ]
        )
        if v("d_act_now") == "yes":
            bump("RED")
            rows.append(["Acting now", "Intent to act on thoughts now", "Client report"])
        if v("d_attempt") == "yes":
            bump("RED")
            rows.append(["Recent self-harm / attempt", "Reported", "Client report"])
        if v("d_means") == "yes":
            bump("ORANGE")
            rows.append(["Access to means", "Known access", "Client report"])
        triggers.add("d")

    # E — risk of harm to others
    if "yes" in (v("e_thoughts"), v("e_behaviour"), v("e_act")):
        alert("AGGRESSION_RISK")
        bump("ORANGE")
        reasons.append("risk of harm to others present")
        rows.append(["Risk to others", "Thoughts/behaviour/act documented", "Client report"])
        if v("e_danger") == "yes":
            bump("RED")
            rows.append(
                ["Immediate danger", "Behaviour suggests immediate danger", "Clinician observation"]
            )
        triggers.add("e")

    # F — acute mental state
    features = many("f_features")
    if v("f_change") == "yes" or features:
        bump("ORANGE")
        reasons.append("acute mental state change")
        rows.append(
            [
                "Acute mental state change",
                ", ".join(label("triage-mental-state-feature", f) for f in features)
                or "Change reported",
                "Clinician observation",
            ]
        )
        triggers.add("f")
    consciousness = v("f_consciousness")
    if present and consciousness and consciousness != "alert":
        alert("ALTERED_CONSCIOUSNESS")
        bump("RED")
        reasons.append("altered consciousness")
        rows.append(
            [
                "Altered consciousness",
                label("triage-consciousness", consciousness),
                "Clinician observation",
            ]
        )

    # G — alcohol & other substances
    withdrawal = [w for w in many("g_withdrawal") if w != "none"]
    if (
        (v("g_use") == "yes" and v("g_intoxication") in ("significant", "severe"))
        or (v("g_stopped") == "yes" and withdrawal)
        or withdrawal
    ):
        alert("WITHDRAWAL_RISK")
        bump("ORANGE")
        reasons.append("withdrawal risk")
        detail = (
            "Symptoms: " + ", ".join(label("triage-withdrawal-symptom", w) for w in withdrawal)
            if withdrawal
            else "Recent heavy use / stopped"
        )
        if v("g_seizure") == "yes":
            detail += " · prior seizure"
        rows.append(["Withdrawal risk", detail, "Client report"])
        triggers.add("g")

    # H — urgent medical screen
    medical = many("h_flags")
    systolic, _ = parse_blood_pressure(v("h_bp"))
    pulse = _number(v("h_pulse"))
    spo2 = _number(v("h_spo2"))
    temperature = _number(v("h_temp"), float)
    if medical or v("h_concern") == "yes":
        bump("ORANGE")
        reasons.append("acute medical concern")
        rows.append(
            [
                "Medical concern",
                ", ".join(label("triage-medical-concern", m) for m in medical)
                or "Concern reported",
                "Client report",
            ]
        )
        if RED_MEDICAL_FLAGS.intersection(medical):
            bump("RED")
        triggers.add("h")
    elif v("h_bp") or pulse or spo2 or temperature:
        triggers.add("h")
    t = VITAL_THRESHOLDS
    if (
        (systolic and systolic > t["systolic_above"])
        or (pulse and (pulse > t["pulse_above"] or pulse < t["pulse_below"]))
        or (spo2 and spo2 < t["spo2_below"])
        or (temperature and temperature > t["temperature_above"])
    ):
        alert("ABNORMAL_VITALS")
        bump("RED")
        reasons.append("abnormal vital signs")
        parts = [
            v("h_bp") and f"BP {v('h_bp')}",
            pulse and f"Pulse {pulse}",
            spo2 and f"SpO2 {spo2}%",
            temperature and f"Temp {temperature:g}",
        ]
        rows.append(["Abnormal vital signs", " · ".join(p for p in parts if p), "Measured result"])

    # I — safeguarding
    safeguarding = [f for f in many("i_flags") if f != "none_identified"]
    if safeguarding or v("i_safe") == "no" or v("i_return") == "no":
        alert("SAFEGUARDING")
        bump("ORANGE")
        reasons.append("safeguarding concern")
        rows.append(
            [
                "Safeguarding concern",
                ", ".join(label("triage-safeguarding-concern", f) for f in safeguarding)
                or "Client does not feel safe",
                "Client report",
            ]
        )
        triggers.add("i")

    # J — immediate functional safety
    if v("j_concern") == "yes":
        bump("YELLOW")
        reasons.append("immediate functional safety concern")
        rows.append(["Functional safety concern", "Unable to meet basic needs", "Client report"])

    # K — telephone / third-party screen (only when not present)
    if not present:
        reported = many("k_flags")
        rows.append(
            [
                "Telephone / third-party screen",
                ", ".join(label("triage-telephone-concern", f) for f in reported)
                or "No concerns reported",
                "Third-party report",
            ]
        )
        if v("k_emergency") == "yes":
            bump("RED")
            alert("TELEPHONE_EMERGENCY")
            reasons.append("emergency assistance required (third-party report)")
        if "suicide_concern" in reported:
            alert("SUICIDE_RISK")
            bump("ORANGE")
            reasons.append("suicide concern via third party")

    unanswered = [name for key, name in CORE_SCREENS if v(key) == ""]
    unresolved = [name for key, name in CORE_SCREENS if v(key) in UNCERTAIN_VALUES]
    if unanswered:
        rows.append(
            ["Safety screen incomplete", f"Not assessed: {', '.join(unanswered)}", "Triage screen"]
        )
    if unresolved:
        rows.append(
            [
                "Clinical review required",
                f"Unable to determine: {', '.join(unresolved)}",
                "Triage screen",
            ]
        )

    rec = state["rec"]
    ready = not unanswered and not unresolved
    triggered = rec != "GREEN" and bool(reasons)
    if ready:
        recommendation = rec
    elif triggered:
        recommendation = f"{rec} — preliminary"
    else:
        recommendation = "Review required"

    if reasons:
        summary = " · ".join(reasons)
    elif ready:
        summary = "No immediate safety/medical concern identified in the completed screen."
    else:
        summary = (
            "Complete the immediate safety and urgent medical questions. "
            "Unanswered items are not treated as negative findings."
        )
    alert_labels = [ALERT_LABELS[code] for code in alerts]
    if alert_labels:
        summary = f"{summary} · Alerts: {', '.join(alert_labels)}"

    return {
        "rules_version": RULES_VERSION,
        "priority": rec,
        "ready": ready,
        "recommendation": recommendation,
        "summary_priority": rec if ready or triggered else "pending",
        "reasons": summary,
        "alerts": [{"code": code, "label": ALERT_LABELS[code]} for code in alerts],
        "findings": rows,
        "triggers": sorted(triggers),
        "unanswered": unanswered,
        "unresolved": unresolved,
    }


def recheck_due_after(priority, signed_at):
    minutes = RECHECK_INTERVAL_MINUTES.get(priority)
    return signed_at + timedelta(minutes=minutes) if minutes else None


def triage_due_at(arrival_at):
    return arrival_at + timedelta(minutes=TRIAGE_TARGET_MINUTES)
