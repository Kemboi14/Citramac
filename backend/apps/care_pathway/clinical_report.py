"""
The Clinical Report: what the service did for one branch over one period,
counts only (owner, 2026-11-10 — design confirmed before building, guide.md §7).

It is computed when opened and never stored: nothing here is a second store of
clinical data, and it holds no names, identifiers or free text. Clients are
counted once per row. Small numbers are withheld exactly as in the NACADA NDO
report (`apps.mhp_program.nacada_report`): 1–4 shows as "<5", and where a
breakdown adds up to its total the next-smallest row is withheld too.

Branch: every section counts records of the chosen branch — through the
episode (or, with no episode, the encounter) the record hangs off. Risk alerts
follow the client and carry no branch, so an alert counts for a branch when
the client had an episode open there when it was raised.

FHIR R4: a summary MeasureReport, read-time (clinical_report_fhir below).
"""

from django.db.models import Q

from apps.clinical_encounter.models import DiagnosisCode
from apps.ipd_ward.models import Admission
from apps.mhp_program import nacada_fhir
from apps.mhp_program.nacada_report import (
    _breakdown,
    _count_by,
    _in_period,
    _section,
    admissions,
    episodes_closed,
    new_episodes,
    waiting_time,
)

from . import psychiatric_review
from .models import PRIORITY_ORDER, CareTask, ClinicalAlert, EpisodeOfCare, TriageAssessment

DEFINITION = "clinical-report-2026-11-10"
DEFINITION_LABEL = "Facility clinical report — counts only"
TOP_DIAGNOSES = 10

PRIORITY_LABELS = {
    "RED": "RED — immediate",
    "ORANGE": "ORANGE — very urgent",
    "YELLOW": "YELLOW — urgent",
    "GREEN": "GREEN — standard",
}
REVIEW_STATUS = [
    ("INITIATED", "Not started"),
    ("PENDING", "In progress"),
    ("COMPLETED", "Completed"),
]

NOTES = [
    "Counts only — no names, identifiers or free text. Each client is counted once per row.",
    "Counts of 1–4 are shown as “<5”. Where that alone would let the number be worked "
    "out from the total, the next-smallest count is also withheld (“withheld”). Zeros and "
    "totals are exact.",
    "Computed from the records when the report was opened; it is not stored.",
]


def _branch_q(branch, episode="episode", encounter="encounter"):
    """Records of this branch: through their episode, or their encounter when
    they have no episode."""
    return Q(**{f"{episode}__branch": branch}) | Q(
        **{f"{episode}__isnull": True, f"{encounter}__branch": branch}
    )


def clients_triaged(branch, start, end):
    signed = (
        TriageAssessment.objects.filter(
            status="COMPLETED",
            triage_encounter__episode__branch=branch,
            **_in_period("signed_at", start, end),
        )
        .select_related("triage_encounter")
        .order_by("-signed_at")
    )
    latest = {}
    for assessment in signed:  # each client's latest signed triage in the period
        latest.setdefault(assessment.triage_encounter.patient_id, assessment)
    priorities = [a.final_priority or "" for a in latest.values()]
    choices = [
        (p, PRIORITY_LABELS.get(p, p)) for p in sorted(PRIORITY_ORDER, key=PRIORITY_ORDER.get)
    ]
    if "" in priorities:
        choices.append(("", "Not recorded"))
    return _section(
        "clients-triaged",
        "Clients triaged",
        "Clients with a signed triage in the period",
        len(latest),
        [
            _breakdown(
                "priority",
                "By final priority (their latest triage in the period)",
                _count_by(priorities, choices),
            )
        ],
        notes=["A client triaged more than once in the period is counted once."],
    )


def diagnoses(branch, start, end):
    from apps.dha_interop.models import IcdCodeIndex

    rows = (
        DiagnosisCode.objects.filter(
            _branch_q(branch, "encounter__episode", "encounter"),
            **_in_period("created_at", start, end),
        )
        .exclude(verification_status__in=DiagnosisCode.NOT_ASSERTED)
        .exclude(encounter__status="ENTERED_IN_ERROR")
        .values_list("encounter__patient_id", "icd11_code_id", "code_review_reason")
    )
    clients, by_code, under_review = set(), {}, set()
    for patient_id, code, review in rows:
        clients.add(patient_id)
        if review:
            under_review.add(patient_id)  # the code is withheld until it is corrected
        else:
            by_code.setdefault(code, set()).add(patient_id)
    ranked = sorted(by_code.items(), key=lambda item: (-len(item[1]), item[0]))
    top, rest = ranked[:TOP_DIAGNOSES], ranked[TOP_DIAGNOSES:]
    titles = dict(
        IcdCodeIndex.objects.filter(code__in=[code for code, _ in top]).values_list(
            "code", "description"
        )
    )
    pairs = [(code, f"{code} {titles.get(code, '')}".strip(), len(ids)) for code, ids in top]
    others = set().union(*(ids for _, ids in rest)) if rest else set()
    pairs.append(("other", "All other ICD-11 codes", len(others)))
    pairs.append(("under-review", "Code under review (not shown)", len(under_review)))
    return _section(
        "diagnoses",
        "Diagnoses recorded",
        "Clients with a diagnosis recorded in the period",
        len(clients),
        [
            _breakdown(
                "icd11",
                f"Most frequent ICD-11 codes (top {TOP_DIAGNOSES}), clients",
                pairs,
                exclusive=False,
            )
        ],
        notes=[
            "ICD-11 codes and titles are from WHO's MMS release loaded in the system. Ruled-out "
            "and entered-in-error diagnoses are not counted. A client can have several "
            "diagnoses, so the rows do not add up to the total.",
            "A code under review was recorded from the old stub list with a meaning WHO does "
            "not give it; it is counted but not named until a clinician corrects it.",
        ],
    )


def discharges(branch, start, end):
    count = Admission.objects.filter(
        _branch_q(branch), **_in_period("discharged_at", start, end)
    ).count()
    return _section("discharges", "Inpatient discharges", "Discharges in the period", count)


def risk_alerts(branch, start, end):
    alerts = list(
        ClinicalAlert.objects.filter(**_in_period("raised_at", start, end)).values_list(
            "patient_id", "alert_code", "label", "raised_at"
        )
    )
    episodes = {}
    for patient_id, opened, closed in EpisodeOfCare.objects.filter(
        branch=branch, patient_id__in={a[0] for a in alerts}
    ).values_list("patient_id", "period_start", "period_end"):
        episodes.setdefault(patient_id, []).append((opened, closed))

    def at_branch(patient_id, when):
        return any(
            opened <= when and (closed is None or closed >= when)
            for opened, closed in episodes.get(patient_id, ())
        )

    clients, by_type, labels = set(), {}, {}
    for patient_id, code, label, raised in alerts:
        if not at_branch(patient_id, raised):
            continue
        clients.add(patient_id)
        by_type.setdefault(code, set()).add(patient_id)
        labels.setdefault(code, label)
    pairs = [
        (code, labels[code], len(ids))
        for code, ids in sorted(by_type.items(), key=lambda item: (-len(item[1]), item[0]))
    ]
    return _section(
        "risk-alerts",
        "Risk alerts raised",
        "Clients with an alert raised in the period",
        len(clients),
        [_breakdown("type", "By alert, clients", pairs, exclusive=False)] if pairs else [],
        notes=[
            "Alerts follow the client, so an alert counts here when the client had an episode "
            "open at this branch when it was raised. A client can have several alerts."
        ],
    )


def psychiatric_reviews(branch, start, end):
    reviews = CareTask.objects.filter(
        focus_type=psychiatric_review.FOCUS, triage_encounter__episode__branch=branch
    )
    raised = list(
        reviews.filter(**_in_period("created_at", start, end)).values_list("status", flat=True)
    )
    outcomes = list(
        reviews.filter(status="COMPLETED", **_in_period("completed_at", start, end)).values_list(
            "outcome", flat=True
        )
    )
    outcome_choices = list(psychiatric_review.OUTCOMES.items())
    return _section(
        "psychiatric-reviews",
        "Psychiatric reviews for withdrawal",
        "Reviews raised in the period",
        len(raised),
        [
            _breakdown(
                "status",
                "Raised in the period, by current status",
                _count_by(raised, REVIEW_STATUS),
            ),
            _breakdown(
                "outcome",
                "Completed in the period, by outcome",
                _count_by(outcomes, outcome_choices),
            ),
        ],
        notes=[
            "Raised when a triage or intake identifies withdrawal (guide.md 2026-10-29). A "
            "review raised before the period can be completed in it."
        ],
    )


def compile_report(organization, branch, start, end):
    """Runs inside the request's tenant and branch scope, so it can only count
    what the requester may see."""
    return {
        "definition": DEFINITION,
        "definition_label": DEFINITION_LABEL,
        "organization_name": organization.name,
        "branch_name": branch.name,
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "sections": [
            new_episodes(branch, start, end),
            clients_triaged(branch, start, end),
            diagnoses(branch, start, end),
            admissions(branch, start, end),
            discharges(branch, start, end),
            risk_alerts(branch, start, end),
            psychiatric_reviews(branch, start, end),
            waiting_time(branch, start, end),
            episodes_closed(branch, start, end),
        ],
        "notes": NOTES,
    }


# ── FHIR R4 (read-time) ──────────────────────────────────────────────────
# Same mapping as the NACADA report (nacada_fhir): one summary MeasureReport,
# reporter = the branch, one group per section, one stratifier per breakdown,
# withheld counts carry data-absent-reason "masked", and a Provenance names who
# compiled it. Local codes until a published Measure exists — VERIFY with DHA
# whether one is expected for facility clinical reporting.

MEASURE_CANONICAL = "urn:citramac:measure:clinical-report"
SYSTEMS = (
    "urn:citramac:codesystem:clinical-report-indicator",
    "urn:citramac:codesystem:clinical-report-stratifier",
    "urn:citramac:codesystem:clinical-report-stratum",
)


def bundle(report_id, summary, generated_at, branch_id, compiled_by):
    return nacada_fhir.build_bundle(
        report_id,
        summary,
        generated_at,
        branch_id,
        compiled_by,
        measure=MEASURE_CANONICAL,
        systems=SYSTEMS,
    )
