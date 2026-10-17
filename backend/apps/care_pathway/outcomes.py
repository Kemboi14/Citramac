"""
Outcomes stage (mockup v4 stage 6): which measures fit this client, every score
recorded (from intake, therapy, withdrawal charts and here — one store), the
discharge-measures prompt and the client's previous episodes of care.

Nothing here scores or interprets: bands and change text come from the
instrument registry (care_pathway.instruments), labelled with its approval.
"""

from . import instruments, tools, withdrawal
from .intake_schema import _code
from .models import CarePlan, EpisodeOfCare, EpisodeOutcome, OutcomeScore

# Offered to everyone (mockup `stageOutcomes` opts); the rest depend on the client.
GENERAL_MEASURES = ["PHQ9", "GAD7", "PCL5", "CRI", "PAWSS", "AUDITC", "MDQ", "COG"]
DISCHARGE_TIMEPOINT = _code("Discharge")


def measure_options(patient):
    """[{code, name, why}] — PHQ-A under 18, EPDS when pregnant or postpartum,
    CIWA-Ar for alcohol and COWS for opioids, as the mockup offers them."""
    sections = tools._record_view(patient)
    age = patient.age_years
    pregnancy = (sections.get("medical") or {}).get("preg_status")
    options = []
    if age is not None and age < 18:
        options.append(("PHQA", "Client is under 18"))
    if pregnancy in (_code("Pregnant"), _code("Postpartum")):
        options.append(("EPDS", "Pregnant or postpartum"))
    options += [(code, "") for code in GENERAL_MEASURES]
    substance = withdrawal.main_substance(patient)
    if substance == _code("Alcohol"):
        options.append(("CIWA", "Alcohol recorded as the main substance"))
    if substance == _code("Opioids"):
        options.append(("COWS", "Opioids recorded as the main substance"))
    return [
        {"code": code, "name": instruments.INSTRUMENTS[code]["name"], "why": why}
        for code, why in options
    ]


def _name(user):
    return (user.get_full_name() or str(user)) if user else ""


def score_rows(patient):
    rows = OutcomeScore.objects.filter(patient=patient).select_related("recorded_by").order_by("-recorded_at")
    out = []
    for r in rows:
        spec = instruments.INSTRUMENTS.get(r.instrument)
        if spec is None:
            continue
        out.append({
            "id": str(r.id), "instrument": r.instrument, "name": spec["name"], "score": r.score,
            "max": spec["max"], "band": instruments.band_for(r.instrument, r.score),
            "timepoint": r.timepoint, "context": r.context, "note": r.note, "flags": r.flags,
            "recorded_at": r.recorded_at, "recorded_by": _name(r.recorded_by),
        })
    return out


def discharge_measures_due(patient):
    """The last episode has ended and no measure was recorded at the "Discharge"
    timepoint during it — prompt the clinician (never record one for them)."""
    episode = EpisodeOfCare.objects.filter(patient=patient).order_by("-period_start").first()
    if episode is None or episode.status in EpisodeOfCare.OPEN_STATUSES:
        return False
    if not EpisodeOutcome.objects.filter(episode=episode).exists():
        return False
    return not OutcomeScore.objects.filter(
        patient=patient, timepoint=DISCHARGE_TIMEPOINT, recorded_at__gte=episode.period_start
    ).exists()


def previous_episodes(patient):
    """Earlier finished episodes (not the current or most recent one, which the
    Discharge tab shows), newest first, with how each ended and the signed plan."""
    all_episodes = list(EpisodeOfCare.objects.filter(patient=patient).order_by("period_start"))
    numbers = {e.id: n for n, e in enumerate(all_episodes, start=1)}
    episodes = [e for e in all_episodes[:-1] if e.status not in EpisodeOfCare.OPEN_STATUSES]
    outcomes = {o.episode_id: o for o in EpisodeOutcome.objects.filter(episode__in=episodes)}
    plans = {p.episode_id: p for p in CarePlan.objects.filter(episode__in=episodes).prefetch_related("activities")}
    rows = []
    for episode in episodes:
        outcome = outcomes.get(episode.id)
        plan = plans.get(episode.id)
        rows.append({
            "id": str(episode.id),
            "number": numbers[episode.id],
            "period_start": episode.period_start,
            "period_end": episode.period_end,
            "status": episode.status,
            "outcome": outcome.outcome if outcome else "",
            "destination": outcome.destination if outcome else "",
            "reason": outcome.reason if outcome else "",
            "plan_version": plan.version if plan else 0,
            "plan_actions": [
                a.title for a in plan.activities.all() if a.decision and a.decision != "DECLINED"
            ] if plan and plan.version else [],
        })
    return list(reversed(rows))


def overview(patient):
    from . import services

    episode = services.open_episode_for(patient)
    latest = EpisodeOfCare.objects.filter(patient=patient).order_by("-period_start").first()
    outcome = EpisodeOutcome.objects.filter(episode=latest).first() if latest else None
    return {
        "summary": tools.outcome_summary(patient),
        "scores": score_rows(patient),
        "measure_options": measure_options(patient),
        "discharge_measures_due": discharge_measures_due(patient),
        "episode": {
            "open": episode is not None,
            "outcome": (
                {"outcome": outcome.outcome, "destination": outcome.destination, "reason": outcome.reason,
                 "recorded_at": outcome.recorded_at, "recorded_by": _name(outcome.recorded_by)}
                if outcome else None
            ),
        },
        "previous_episodes": previous_episodes(patient),
    }
