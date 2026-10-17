"""
Withdrawal charting (CIWA-Ar, COWS): scores are recorded through the shared
`tools.record_assessment` into OutcomeScore; this module adds what is specific
to a serial chart — the latest band, protocol flags and when the next score is
due, plus "unable to score" attempts so a missed chart is visible.

No dosing and no default thresholds live here. Thresholds and re-score
intervals come from `settings.WITHDRAWAL_PROTOCOL` (VERIFY: the facility's
protocol); when unset, no banner and no due time are produced.
"""

from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from . import instruments
from .models import AssessmentAttempt, OutcomeScore
from .intake_schema import _code

CODES = [code for code, spec in instruments.INSTRUMENTS.items() if spec.get("withdrawal")]
# How soon after an unscorable attempt to try again (clinical-neutral nudge, not a dose rule).
RETRY_MINUTES = 60
# Points on the serial chart and rows in the history table.
SERIES_LENGTH = 20
HISTORY_LENGTH = 6


def protocol(code):
    return {
        "prn_threshold": None,
        "severe_threshold": None,
        "rescore_minutes_high": None,
        "rescore_minutes_low": None,
        **getattr(settings, "WITHDRAWAL_PROTOCOL", {}).get(code, {}),
    }


def record_attempt(patient, user, instrument, reason):
    if instrument not in CODES:
        raise ValidationError({"instrument": "Not a withdrawal scale."})
    if reason not in dict(AssessmentAttempt.REASON_CHOICES):
        raise ValidationError({"reason": "Choose why the scale could not be scored."})
    return AssessmentAttempt.objects.create(
        organization_id=patient.organization_id,
        patient=patient,
        instrument=instrument,
        reason=reason,
        recorded_by=user,
    )


def status(patient, code, now=None):
    now = now or timezone.now()
    cfg = protocol(code)
    last = OutcomeScore.objects.filter(patient=patient, instrument=code).order_by("-recorded_at").first()
    attempt = AssessmentAttempt.objects.filter(patient=patient, instrument=code).order_by("-recorded_at").first()
    out = {
        "instrument": code,
        "name": instruments.INSTRUMENTS[code]["name"],
        "protocolConfigured": any(v is not None for v in cfg.values()),
        "latest": None,
        "flags": [],
        "nextDueAt": None,
        "lastAttempt": None,
        # Facility thresholds for the chart's reference line — None when unset.
        "prnThreshold": cfg["prn_threshold"],
        "severeThreshold": cfg["severe_threshold"],
        "series": _series(patient, code),
        "history": _history(patient, code),
    }
    if last:
        out["latest"] = {
            "score": last.score,
            "band": instruments.band_for(code, last.score),
            "at": last.recorded_at,
        }
        high = cfg["prn_threshold"] is not None and last.score >= cfg["prn_threshold"]
        if high:
            out["flags"].append("At or above the facility PRN threshold — follow the withdrawal protocol")
        if cfg["severe_threshold"] is not None and last.score >= cfg["severe_threshold"]:
            out["flags"].append("At or above the facility severe threshold — request urgent medical review")
        minutes = cfg["rescore_minutes_high"] if high else cfg["rescore_minutes_low"]
        if minutes:
            out["nextDueAt"] = last.recorded_at + timedelta(minutes=minutes)
    if attempt and (not last or attempt.recorded_at > last.recorded_at):
        out["lastAttempt"] = {"reason": attempt.reason, "at": attempt.recorded_at}
        out["nextDueAt"] = attempt.recorded_at + timedelta(minutes=RETRY_MINUTES)
        out["flags"].append("Last attempt could not be scored — try again")
    out["overdue"] = bool(out["nextDueAt"] and out["nextDueAt"] < now)
    return out


def _by(user):
    return (user.get_full_name() or str(user)) if user else ""


def _series(patient, code):
    rows = OutcomeScore.objects.filter(patient=patient, instrument=code).order_by("-recorded_at")[:SERIES_LENGTH]
    return [{"score": r.score, "at": r.recorded_at} for r in reversed(rows)]


def _history(patient, code):
    """The latest scores and unable-to-score attempts, newest first."""
    scores = OutcomeScore.objects.filter(patient=patient, instrument=code).select_related("recorded_by")
    attempts = AssessmentAttempt.objects.filter(patient=patient, instrument=code).select_related("recorded_by")
    rows = [
        {"at": s.recorded_at, "score": s.score, "band": instruments.band_for(code, s.score),
         "unable": "", "by": _by(s.recorded_by)}
        for s in scores.order_by("-recorded_at")[:HISTORY_LENGTH]
    ] + [
        {"at": a.recorded_at, "score": None, "band": "", "unable": a.get_reason_display(), "by": _by(a.recorded_by)}
        for a in attempts.order_by("-recorded_at")[:HISTORY_LENGTH]
    ]
    return sorted(rows, key=lambda r: r["at"], reverse=True)[:HISTORY_LENGTH]


def overview(patient):  # scales with any chart activity
    return [status(patient, code) for code in CODES if OutcomeScore.objects.filter(patient=patient, instrument=code).exists()
            or AssessmentAttempt.objects.filter(patient=patient, instrument=code).exists()]


def main_substance(patient):
    from . import intake

    row = intake.current_draft(patient) or intake.latest_signed(patient)
    return ((row.sections.get("subs") or {}).get("kind") if row else "") or ""


def is_opioid(patient):
    # The intake stores the value-set code (e.g. "OPIOIDS"), not the display label.
    return main_substance(patient) == _code("Opioids")


def substance_display(patient):
    """The intake's main-substance answer as the clinician saw it ('' when unset)."""
    from .models import LocalConcept

    code = main_substance(patient)
    concept = LocalConcept.objects.filter(valueset_id="intake-substance-kind", code=code).first() if code else None
    return concept.display if concept else code


def recommended_scale(patient):
    """CIWA-Ar for alcohol, COWS for opioids — a suggestion; the clinician chooses."""
    return {_code("Alcohol"): "CIWA", _code("Opioids"): "COWS"}.get(main_substance(patient))
