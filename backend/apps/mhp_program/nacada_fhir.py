"""
FHIR R4 view of a compiled NACADA NDO report — read-time, built from the stored
snapshot (no second store).

Mapping (owner, 2026-11-03): one summary `MeasureReport`
(hl7.org/fhir/R4/measurereport.html). The branch (facility) is the `reporter`;
`subject` is left out because R4 allows only Patient, Practitioner,
PractitionerRole, Location, Device, RelatedPerson or Group there, never an
Organization. Each report section is one `group`, each breakdown one
`stratifier`. It carries no patient data and hangs off no EpisodeOfCare. A
`Provenance` in the same collection Bundle names who compiled it and when.

A withheld count has no `count`; the element carries the R4 data-absent-reason
extension with code `masked` instead, so a reader can tell "withheld" from
"not reported".

Terminology, verified against hl7.org/fhir/R4 on 2026-11-03:
- MeasurePopulationType: http://terminology.hl7.org/CodeSystem/measure-population
  (initial-population)
- Extension http://hl7.org/fhir/StructureDefinition/data-absent-reason, bound to
  http://terminology.hl7.org/CodeSystem/data-absent-reason (masked)

Local, until NACADA publishes its own: the Measure canonical and the indicator /
breakdown / row code systems below. VERIFY with NACADA: the NDO indicator codes
and any Measure they publish; UCUM is not used for the median wait until its
system URI is vendored, so the unit is text only.
"""

import uuid

MEASURE_CANONICAL = "urn:citramac:measure:nacada-ndo"
INDICATOR_SYSTEM = "urn:citramac:codesystem:nacada-ndo-indicator"
STRATIFIER_SYSTEM = "urn:citramac:codesystem:nacada-ndo-stratifier"
STRATUM_SYSTEM = "urn:citramac:codesystem:nacada-ndo-stratum"
MEASURE_POPULATION_SYSTEM = "http://terminology.hl7.org/CodeSystem/measure-population"
DATA_ABSENT_REASON_URL = "http://hl7.org/fhir/StructureDefinition/data-absent-reason"

INITIAL_POPULATION = {
    "coding": [
        {
            "system": MEASURE_POPULATION_SYSTEM,
            "code": "initial-population",
            "display": "Initial Population",
        }
    ]
}


def _population(stored):
    population = {"code": INITIAL_POPULATION}
    if stored["value"] is None:
        population["_count"] = {
            "extension": [{"url": DATA_ABSENT_REASON_URL, "valueCode": "masked"}]
        }
    else:
        population["count"] = stored["value"]
    return population


def _group(section):
    group = {
        "code": {
            "coding": [
                {"system": INDICATOR_SYSTEM, "code": section["code"], "display": section["title"]}
            ],
            "text": section["total_label"],
        },
        "population": [_population(section["total"])],
    }
    median = section.get("median_days")
    if median and median["value"] is not None:
        group["measureScore"] = {"value": median["value"], "unit": "days (median wait)"}
    stratifiers = []
    for breakdown in section["breakdowns"]:
        stratifiers.append(
            {
                "code": [
                    {
                        "coding": [
                            {
                                "system": STRATIFIER_SYSTEM,
                                "code": f"{section['code']}.{breakdown['code']}",
                                "display": breakdown["title"],
                            }
                        ],
                        "text": breakdown["title"],
                    }
                ],
                "stratum": [
                    {
                        "value": {
                            "coding": [
                                {
                                    "system": STRATUM_SYSTEM,
                                    "code": row["code"],
                                    "display": row["label"],
                                }
                            ],
                            "text": row["label"],
                        },
                        "population": [_population(row)],
                    }
                    for row in breakdown["rows"]
                ],
            }
        )
    if stratifiers:
        group["stratifier"] = stratifiers
    return group


def build_measure_report(report_id, summary, generated_at, branch_id):
    return {
        "resourceType": "MeasureReport",
        "id": str(report_id),
        "status": "complete",
        "type": "summary",
        "measure": f"{MEASURE_CANONICAL}:{summary['definition']}",
        "date": generated_at,
        "reporter": {
            "reference": f"Organization/{branch_id}",
            "display": f"{summary['organization_name']} — {summary['branch_name']}",
        },
        "period": {"start": summary["period_start"], "end": summary["period_end"]},
        "group": [_group(section) for section in summary["sections"]],
    }


# Provenance ids derive from the report id, so the entry is a stable urn:uuid.
PROVENANCE_NAMESPACE = uuid.UUID("9c4e2a7b-3f1d-4b8e-a6c2-7d5e9f1b3a4c")


def build_bundle(report_id, summary, generated_at, branch_id, compiled_by):
    """Collection Bundle: the MeasureReport and the Provenance saying who
    compiled it and when (CLAUDE.md §3 item 4)."""
    measure_report = build_measure_report(report_id, summary, generated_at, branch_id)
    provenance_id = str(uuid.uuid5(PROVENANCE_NAMESPACE, f"compiled:{report_id}"))
    provenance = {
        "resourceType": "Provenance",
        "id": provenance_id,
        "target": [{"reference": f"urn:uuid:{report_id}"}],
        "recorded": generated_at,
        "activity": {"text": "Compiled from the facility's records"},
        "agent": [{"who": {"display": compiled_by or "Unknown user"}}],
    }
    return {
        "resourceType": "Bundle",
        "type": "collection",
        "timestamp": generated_at,
        "entry": [
            {"fullUrl": f"urn:uuid:{report_id}", "resource": measure_report},
            {"fullUrl": f"urn:uuid:{provenance_id}", "resource": provenance},
        ],
    }


def bundle_for(report):
    """The FHIR Bundle for a stored report (new-format reports only)."""
    return build_bundle(
        report.id,
        report.summary_data,
        report.generated_at.isoformat(),
        report.branch_id,
        report.generated_by.get_full_name() if report.generated_by else None,
    )
