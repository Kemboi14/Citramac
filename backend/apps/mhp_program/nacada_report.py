"""
The NACADA National Drug Observatory (NDO) report — what it counts and how.

NACADA's own NDO template has not been supplied, so the indicators below are
facility-defined from what the system already records (owner, 2026-11-03) and
the report says so wherever it is shown or sent. Replacing them with NACADA's
list is a change to this module and DEFINITION, not to stored reports: each
report keeps the snapshot and definition it was compiled with.

Only counts leave the system — no names, identifiers or free text. Small
numbers are withheld before the snapshot is stored (owner, 2026-11-03, option
"<5"): a count of 1–4 is shown as "<5"; zeros and totals stay exact. Where a
breakdown's rows add up to its total, withholding one row alone would let it be
worked out by subtraction, so the next-smallest row is withheld too
("secondary"). A median over 1–4 people is withheld for the same reason.

Branch: episode-based indicators count the chosen branch only. OAT and naloxone
records carry no branch (patient-level, not yet branch-scoped — CLAUDE.md
2026-10-26), so those two sections are organisation-wide and labelled as such.
"""

from statistics import median

from django.db.models import Min, Q, Sum

from apps.care_pathway import triage_v4, triage_v5
from apps.care_pathway.models import (
    EpisodeOfCare,
    EpisodeOutcome,
    EpisodeStatusHistory,
    NaloxoneSupply,
    OatEnrolment,
    TriageAssessment,
)
from apps.client_registry.models import Patient
from apps.ipd_ward.models import Admission

DEFINITION = "facility-defined-2026-11-03"
DEFINITION_LABEL = "Facility-defined indicators — not yet matched to NACADA's NDO template"
SMALL_MAX = 4
SMALL_DISPLAY = "<5"
SECONDARY_DISPLAY = "withheld"

AGE_BANDS = [
    ("lt15", "Under 15", None, 14),
    ("15-19", "15–19", 15, 19),
    ("20-24", "20–24", 20, 24),
    ("25-34", "25–34", 25, 34),
    ("35-44", "35–44", 35, 44),
    ("45-54", "45–54", 45, 54),
    ("55plus", "55 and over", 55, None),
]
UNKNOWN = ("unknown", "Not recorded")

SUBSTANCE_LABELS = dict(triage_v4.SUBSTANCES)

NOTES = [
    "Only counts are included — no names, identifiers or free text.",
    "Counts of 1–4 are shown as “<5”. Where that alone would let the number be worked "
    "out from the total, the next-smallest count is also withheld (“withheld”). "
    "Zeros and totals are exact.",
]


# ── Small-number suppression ─────────────────────────────────────────────


def _is_small(value):
    return 1 <= value <= SMALL_MAX


def cell(value):
    """A count as stored and shown: exact, or withheld with no number kept."""
    if _is_small(value):
        return {"value": None, "display": SMALL_DISPLAY, "masked": "small"}
    return {"value": value, "display": str(value), "masked": None}


def _rows(pairs, exclusive):
    """[(code, label, raw count)] → stored rows. `exclusive` rows add up to the
    section total, so one withheld row would be derivable — withhold another."""
    rows = [{"code": code, "label": label, **cell(value)} for code, label, value in pairs]
    if exclusive:
        small = [r for r in rows if r["masked"]]
        if len(small) == 1:
            candidates = [
                (value, i)
                for i, (_, _, value) in enumerate(pairs)
                if value > 0 and not rows[i]["masked"]
            ]
            if candidates:
                _, i = min(candidates)
                rows[i].update(value=None, display=SECONDARY_DISPLAY, masked="secondary")
    return rows


def _breakdown(code, title, pairs, exclusive=True):
    return {"code": code, "title": title, "rows": _rows(pairs, exclusive)}


def _section(code, title, total_label, total, breakdowns=(), scope="branch", notes=()):
    return {
        "code": code,
        "title": title,
        "scope": scope,
        "total_label": total_label,
        "total": cell(total),
        "breakdowns": list(breakdowns),
        "notes": list(notes),
    }


# ── Indicators ───────────────────────────────────────────────────────────


def _in_period(field, start, end):
    return {f"{field}__date__gte": start, f"{field}__date__lte": end}


def _age_at(patient, on):
    if patient.date_of_birth:
        dob = patient.date_of_birth
        return on.year - dob.year - ((on.month, on.day) < (dob.month, dob.day))
    return patient.estimated_age


def _age_band(age):
    if age is None:
        return UNKNOWN[0]
    for code, _, low, high in AGE_BANDS:
        if (low is None or age >= low) and (high is None or age <= high):
            return code
    return UNKNOWN[0]


def _count_by(values, choices):
    counts = {code: 0 for code, _ in choices}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return [(code, label, counts[code]) for code, label in choices]


def new_episodes(branch, start, end):
    episodes = (
        EpisodeOfCare.objects.filter(branch=branch, **_in_period("period_start", start, end))
        .exclude(status="cancelled")
        .select_related("patient")
    )
    sexes, bands = [], []
    for episode in episodes:
        sexes.append(episode.patient.gender or UNKNOWN[0])
        bands.append(_age_band(_age_at(episode.patient, episode.period_start.date())))
    sex_choices = list(Patient.GENDER_CHOICES) + [UNKNOWN]
    band_choices = [(code, label) for code, label, _, _ in AGE_BANDS] + [UNKNOWN]
    return _section(
        "new-episodes",
        "New treatment episodes",
        "Episodes started in the period",
        len(sexes),
        [
            _breakdown("sex", "By sex", _count_by(sexes, sex_choices)),
            _breakdown("age", "By age when the episode started", _count_by(bands, band_choices)),
        ],
        notes=[
            "Cancelled episodes are not counted. Age is from the date of birth, or the "
            "estimated age where no date of birth was recorded."
        ],
    )


def _substances_of(answers):
    """(substances used, substances with withdrawal as the current concern) from
    one signed triage. v5 records both per substance; v4 records which
    substances but not a per-substance concern; v3 records neither."""
    if triage_v5.is_v5(answers):
        used = set(triage_v5.used_substances(answers))
        withdrawal = {c for c in used if triage_v5.concern_of(answers, c) == "withdrawal"}
        return used, withdrawal, "v5"
    if triage_v4.is_v4(answers):
        if triage_v4._text(answers, "subst_recent") == "yes":
            return set(triage_v4._list(answers, "subst_which")), set(), "v4"
        return set(), set(), "v4"
    return set(), set(), "v3"


def substances(branch, start, end):
    signed = (
        TriageAssessment.objects.filter(
            status="COMPLETED",
            triage_encounter__episode__branch=branch,
            **_in_period("signed_at", start, end),
        )
        .select_related("triage_encounter")
        .order_by("triage_encounter_id", "-version")
    )
    latest = {}
    for assessment in signed:  # the latest signed version of each triage
        latest.setdefault(assessment.triage_encounter_id, assessment)
    clients, users, withdrawing = set(), {}, {}
    v3_triages = 0
    for assessment in latest.values():
        patient_id = assessment.triage_encounter.patient_id
        clients.add(patient_id)
        used, withdrawal, form = _substances_of(assessment.answers)
        if form == "v3":
            v3_triages += 1
        for code in used:
            users.setdefault(code, set()).add(patient_id)
        for code in withdrawal:
            withdrawing.setdefault(code, set()).add(patient_id)
    codes = triage_v5.SUBSTANCE_ROWS
    notes = [
        "A client is counted once per substance however many triages they had. One client "
        "can report several substances, so the rows do not add up to the total.",
        "Withdrawal is counted from the current triage form only; earlier forms did not "
        "record a concern per substance.",
    ]
    if v3_triages:
        notes.append(
            f"{v3_triages} triage(s) signed on the oldest form, which did not record which "
            "substance was used, are counted in the total only."
        )
    return _section(
        "substances",
        "Substances reported at triage",
        "Clients with a signed triage in the period",
        len(clients),
        [
            _breakdown(
                "use",
                "Clients reporting use, by substance",
                [(c, SUBSTANCE_LABELS[c], len(users.get(c, ()))) for c in codes],
                exclusive=False,
            ),
            _breakdown(
                "withdrawal",
                "Of those, withdrawal is the current concern",
                [(c, SUBSTANCE_LABELS[c], len(withdrawing.get(c, ()))) for c in codes],
                exclusive=False,
            ),
        ],
        notes=notes,
    )


def admissions(branch, start, end):
    rows = Admission.objects.filter(
        Q(episode__branch=branch) | Q(encounter__branch=branch),
        **_in_period("admitted_at", start, end),
    ).values_list("admission_type", flat=True)
    types = list(rows)
    return _section(
        "admissions",
        "Inpatient admissions",
        "Admissions in the period",
        len(types),
        [_breakdown("type", "By type", _count_by(types, Admission.ADMISSION_TYPE_CHOICES))],
    )


def episodes_closed(branch, start, end):
    outcomes = list(
        EpisodeOutcome.objects.filter(
            episode__branch=branch, **_in_period("recorded_at", start, end)
        ).values_list("outcome", flat=True)
    )
    return _section(
        "episodes-closed",
        "Treatment episodes closed",
        "Episodes closed in the period",
        len(outcomes),
        [_breakdown("outcome", "By outcome", _count_by(outcomes, EpisodeOutcome.OUTCOME_CHOICES))],
    )


ORG_WIDE_NOTE = (
    "Organisation-wide: these records are not tied to a branch, so every branch of the "
    "organisation is included."
)


def oat(start, end):
    statuses = list(
        OatEnrolment.objects.filter(**_in_period("created_at", start, end)).values_list(
            "status", flat=True
        )
    )
    return _section(
        "oat",
        "Opioid agonist therapy (OAT)",
        "Referrals recorded in the period",
        len(statuses),
        [
            _breakdown(
                "status", "By current status", _count_by(statuses, OatEnrolment.STATUS_CHOICES)
            )
        ],
        scope="organization",
        notes=[ORG_WIDE_NOTE],
    )


def naloxone(start, end):
    records = NaloxoneSupply.objects.filter(**_in_period("given_at", start, end))
    outcomes = list(records.values_list("outcome", flat=True))
    supplied = records.filter(outcome="SUPPLIED")
    kits = supplied.aggregate(total=Sum("quantity"))["total"] or 0
    return _section(
        "naloxone",
        "Naloxone",
        "Times naloxone was offered",
        len(outcomes),
        [
            _breakdown(
                "outcome", "By outcome", _count_by(outcomes, NaloxoneSupply.OUTCOME_CHOICES)
            ),
            _breakdown(
                "supply",
                "When supplied",
                [
                    ("kits", "Kits supplied (where the quantity was recorded)", kits),
                    (
                        "training",
                        "Overdose training given",
                        supplied.filter(training_given=True).count(),
                    ),
                ],
                exclusive=False,
            ),
        ],
        scope="organization",
        notes=[ORG_WIDE_NOTE],
    )


def waiting_time(branch, start, end):
    """Days from joining the waitlist to treatment starting, for episodes whose
    treatment started in the period — from the episode status history, the only
    record of waiting time (CLAUDE.md §4)."""
    started = (
        EpisodeStatusHistory.objects.filter(episode__branch=branch, status="active")
        .values("episode_id")
        .annotate(first_active=Min("period_start"))
        .filter(first_active__date__gte=start, first_active__date__lte=end)
    )
    first_active = {row["episode_id"]: row["first_active"] for row in started}
    waits = {}
    for row in (
        EpisodeStatusHistory.objects.filter(episode_id__in=first_active, status="waitlist")
        .values("episode_id")
        .annotate(joined=Min("period_start"))
    ):
        activated = first_active[row["episode_id"]]
        if row["joined"] <= activated:
            waits[row["episode_id"]] = (activated - row["joined"]).total_seconds() / 86400
    count = len(waits)
    section = _section(
        "waiting-time",
        "Waiting time",
        "Clients who started treatment from the waitlist in the period",
        count,
        notes=["Measured from joining the waitlist to the episode becoming active."],
    )
    if count and not _is_small(count):
        days = round(median(waits.values()), 1)
        section["median_days"] = {"value": days, "display": f"{days} days", "masked": None}
    elif count:
        section["median_days"] = {"value": None, "display": SECONDARY_DISPLAY, "masked": "small"}
    else:
        section["median_days"] = {"value": None, "display": "—", "masked": None}
    return section


def compile_report(organization, branch, start, end):
    """The stored snapshot for one branch and period. Runs inside the request's
    tenant and branch scope, so it can only count what the requester may see."""
    return {
        "definition": DEFINITION,
        "definition_label": DEFINITION_LABEL,
        "organization_name": organization.name,
        "branch_name": branch.name,
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "sections": [
            new_episodes(branch, start, end),
            substances(branch, start, end),
            admissions(branch, start, end),
            episodes_closed(branch, start, end),
            oat(start, end),
            naloxone(start, end),
            waiting_time(branch, start, end),
        ],
        "notes": NOTES,
    }


# ── Plain-text rendering (the email's text part) ─────────────────────────


def render_text(summary):
    lines = [
        f"NACADA NDO report — {summary['organization_name']}, {summary['branch_name']}",
        f"Period: {summary['period_start']} to {summary['period_end']}",
        summary["definition_label"],
        "",
    ]
    for section in summary["sections"]:
        lines.append(section["title"].upper())
        if section["scope"] == "organization":
            lines.append("(organisation-wide)")
        lines.append(f"  {section['total_label']}: {section['total']['display']}")
        if "median_days" in section:
            lines.append(f"  Median wait: {section['median_days']['display']}")
        for breakdown in section["breakdowns"]:
            lines.append(f"  {breakdown['title']}:")
            for row in breakdown["rows"]:
                lines.append(f"    {row['label']}: {row['display']}")
        for note in section["notes"]:
            lines.append(f"  Note: {note}")
        lines.append("")
    lines.extend(summary["notes"])
    return "\n".join(lines)
