"""
Structured mental state examination (INT-16; mockup v4 secMse / MSE_DOMAINS).

Shape of IntakeAssessment.sections["mse"] since v4:
- "findings": {domain key: [concept code, …]} — the structured chips, codes from
  the served value set `mse-<domain>`. These drive tool triggers, attention items
  and risk proposals (INT-DEV-02).
- <domain key>: the clinician's notes for that domain — context, never parsed.
- "orient_time" / "orient_place" / "orient_person": codes from `intake-orientation`.
- "reliability": a code from `intake-reliability`; "attention", "summary": text.

A section without "findings" is in the legacy shape (before v4: one free-text
value per domain, often a picked option's display). Signed intakes are immutable
(CLAUDE.md §3 item 7), so legacy records are read as they are — each consumer
keeps its old text check for them — and nothing here rewrites a stored intake.
"""

from . import intake_schema as schema

ORIENTATION_SPHERES = [("orient_time", "Time"), ("orient_place", "Place"), ("orient_person", "Person")]
# INT-16 rule: thought content "Suicidal" / "Homicidal" feeds the INT-03 risk register.
RISK_SIGNALS = [("Suicidal", "suicide", "Thoughts"), ("Homicidal", "violence", "Thoughts")]
HALLUCINATIONS = ["Auditory hallucinations", "Visual hallucinations", "Other hallucinations"]
_CODED_DOMAINS = {key for key, _label, opts in schema.MSE_DOMAINS if opts}


def valueset_for(domain):
    return f"mse-{domain.replace('_', '-')}"


def is_structured(mse):
    return isinstance((mse or {}).get("findings"), dict)


def codes(mse, domain):
    """Structured codes for a domain, in the order the clinician picked them."""
    findings = (mse or {}).get("findings")
    value = findings.get(domain) if isinstance(findings, dict) else None
    return [c for c in value if isinstance(c, str)] if isinstance(value, list) else []


def has(mse, domain, display):
    return schema._code(display) in codes(mse, domain)


def notes(mse, domain):
    value = (mse or {}).get(domain)
    return value if isinstance(value, str) else ""


def recorded(mse, domain):
    """A domain is recorded when it has a structured finding or notes (legacy text counts)."""
    return bool(codes(mse, domain)) or bool(notes(mse, domain).strip())


def risk_signals(mse, legacy_thought_content=""):
    """[(label, row, option)] the thought content raises. Legacy records keep the
    pre-v4 check: the label as a substring of the stored thought-content text."""
    if is_structured(mse):
        return [s for s in RISK_SIGNALS if has(mse, "thought_content", s[0])]
    return [s for s in RISK_SIGNALS if s[0] in (legacy_thought_content or "")]


def psychotic_features(mse):
    """Structured perception / thought-content findings that suggest psychosis."""
    return any(has(mse, "perception", h) for h in HALLUCINATIONS) or has(mse, "thought_content", "Delusions")


def _display_lookup():
    from .models import LocalConcept

    ids = [valueset_for(k) for k in _CODED_DOMAINS] + ["intake-orientation", "intake-reliability"]
    table = {
        (c.valueset_id, c.code): c.display
        for c in LocalConcept.objects.filter(valueset_id__in=ids)
    }
    return lambda valueset, code: table.get((valueset, code), code)


def exam_text(mse):
    """{MentalStatusExam field: text} — the readable form kept in the one MSE
    store (triage.MentalStatusExam) and used in handovers. Structured findings
    are written as their displays followed by the notes; legacy text passes
    through unchanged."""
    mse = mse or {}
    if not is_structured(mse):
        return {key: notes(mse, key) for key in _exam_fields()}
    label = _display_lookup()
    out = {}
    for key, _label, _opts in schema.MSE_DOMAINS:
        picked = [label(valueset_for(key), c) for c in codes(mse, key)] if key in _CODED_DOMAINS else []
        out[key] = " — ".join(part for part in (", ".join(picked), notes(mse, key).strip()) if part)
    spheres = [
        f"{sphere}: {label('intake-orientation', mse[field])}"
        for field, sphere in ORIENTATION_SPHERES
        if isinstance(mse.get(field), str) and mse[field]
    ]
    # A draft cloned from a legacy intake keeps its free-text orientation until
    # the three spheres are recorded.
    out["orientation"] = "; ".join(spheres) or notes(mse, "orientation")
    reliability = notes(mse, "reliability")
    out["reliability"] = label("intake-reliability", reliability) if reliability else ""
    out["attention"] = notes(mse, "attention")
    out["summary"] = notes(mse, "summary")
    return out


def _exam_fields():
    return [key for key, _label, _opts in schema.MSE_DOMAINS] + [
        "orientation",
        "attention",
        "reliability",
        "summary",
    ]
