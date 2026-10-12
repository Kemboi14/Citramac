"""
Early warning score from a set of observations (mockup v4 ews / ewsResponse).

Scores the six parameters it can — respiratory rate, SpO₂, systolic BP, heart
rate, temperature and consciousness (ACVPU) — plus 2 for supplemental oxygen.
An unmeasured parameter is *not* scored as normal: the result says how many of
the six were measured, and an incomplete set is labelled incomplete.

VERIFY: these bands and responses are the owner's mockup, which calls them
"illustrative NEWS2-style thresholds". A named clinician must approve them
before the score drives any escalation; `APPROVAL` is served to the UI, which
shows the label. Changing a band is a clinical decision — bump `VERSION`.
"""

VERSION = "mockup-2026-10-illustrative"
APPROVAL = "illustrative"
PARAMS = ["rr", "spo2", "sbp", "hr", "temp", "acvpu"]

# (upper bound inclusive, points); the last row is the catch-all.
_BANDS = {
    "rr": [(8, 3), (11, 1), (20, 0), (24, 2), (None, 3)],
    "spo2": [(91, 3), (93, 2), (95, 1), (None, 0)],
    "sbp": [(90, 3), (100, 2), (110, 1), (219, 0), (None, 3)],
    "hr": [(40, 3), (50, 1), (90, 0), (110, 1), (130, 2), (None, 3)],
    "temp": [(35, 3), (36, 1), (38, 0), (39, 1), (None, 2)],
}


def _band(param, value):
    if value is None:
        return None
    for upper, points in _BANDS[param]:
        if upper is None or value <= upper:
            return points
    return None


def _num(value):
    try:
        return None if value in (None, "") else float(value)
    except (TypeError, ValueError):
        return None


def score(obs):
    """obs: dict with rr, spo2, sbp, hr, temp, consciousness, supplemental_o2,
    glucose, dbp. Returns the full result."""
    parts = {
        "rr": _band("rr", _num(obs.get("rr"))),
        "spo2": _band("spo2", _num(obs.get("spo2"))),
        "sbp": _band("sbp", _num(obs.get("sbp"))),
        "hr": _band("hr", _num(obs.get("hr"))),
        "temp": _band("temp", _num(obs.get("temp"))),
    }
    consciousness = obs.get("consciousness") or ""
    parts["acvpu"] = 0 if consciousness == "A" else 3 if consciousness in ("C", "V", "P", "U") else None
    values = [parts[k] for k in PARAMS if parts[k] is not None]
    o2 = 2 if obs.get("supplemental_o2") else 0
    glucose, dbp = _num(obs.get("glucose")), _num(obs.get("dbp"))
    total = sum(values) + (o2 if values else 0)
    return {
        "score": total,
        "parts": parts,
        "supplemental_o2_points": o2,
        "single_parameter_3": 3 in values,
        "measured": len(values),
        "total_parameters": len(PARAMS),
        "complete": len(values) == len(PARAMS),
        "glucose_low": glucose is not None and glucose < 4,
        "glucose_high": glucose is not None and glucose > 11,
        "diastolic_high": dbp is not None and dbp >= 90,
        "label": label_for(total, len(values)),
        "response": response_for(total, len(values), 3 in values),
        "version": VERSION,
        "approval": APPROVAL,
    }


def label_for(total, measured):
    if not measured:
        return f"EWS incomplete (0/{len(PARAMS)})"
    if measured == len(PARAMS):
        return f"EWS {total}"
    return f"EWS {total} · incomplete ({measured}/{len(PARAMS)})"


def response_for(total, measured, any_three):
    if not measured:
        return {"tone": "warn", "text": "No score — record a full set of observations."}
    if total >= 7:
        return {"tone": "bad", "text": "EWS ≥ 7 — emergency response: senior medical review now; continuous monitoring."}
    if total >= 5 or any_three:
        what = "EWS 5–6" if total >= 5 else "A single parameter scores 3"
        return {"tone": "bad", "text": f"{what} — urgent medical review within 1 hour; observations at least hourly."}
    if total >= 1:
        return {"tone": "warn", "text": "EWS 1–4 — inform the nurse in charge; observations 4–6 hourly."}
    return {"tone": "ok", "text": "EWS 0 — routine observations (at least 12-hourly)."}


def from_vital(v):
    return score(
        {
            "rr": v.respiratory_rate,
            "spo2": v.spo2,
            "sbp": v.systolic_bp,
            "hr": v.heart_rate,
            "temp": v.temperature_c,
            "consciousness": v.consciousness,
            "supplemental_o2": v.supplemental_o2,
            "glucose": v.blood_glucose_mmol,
            "dbp": v.diastolic_bp,
        }
    )
