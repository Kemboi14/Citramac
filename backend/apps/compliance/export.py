"""
Patient record export for an approved access / portability request — legal
opinion of 2 Oct 2026 §11 (DPA s.26 access, s.38 portability; Digital Health
Act s.36 copy of personal health information).

Two parts in one JSON document:
- `fhir`: an R4 collection Bundle (machine-readable, interoperable copy),
  built with the same fhir.resources builders as the rest of the system.
  Observations for vital signs and instrument scores are NOT emitted until
  their LOINC codes are verified (CLAUDE.md §6) — that data is in `record`.
- `record`: the full chart as structured sections, which also drives the
  printable copy in the UI.
"""

import json

from django.utils import timezone
from fhir.resources.R4B.allergyintolerance import AllergyIntolerance
from fhir.resources.R4B.bundle import Bundle, BundleEntry
from fhir.resources.R4B.codeableconcept import CodeableConcept
from fhir.resources.R4B.reference import Reference

from apps.dha_interop.fhir_mapper import (
    _urn,
    build_condition_resource,
    build_medication_request_resource,
    build_patient_resource,
)


def _iso(value):
    return value.isoformat() if value else None


def _name(user):
    if not user:
        return ""
    return f"{user.first_name} {user.last_name}".strip() or user.email


def _fhir_bundle(patient):
    from apps.care_pathway.fhir import build_discharge_bundle, build_triage_bundle
    from apps.clinical_encounter.models import DiagnosisCode, PrescriptionItem

    patient_ref = _urn("Patient", patient.id)
    entries = {patient_ref: build_patient_resource(patient)}

    for allergy in patient.allergy_records.exclude(verification_status="REFUTED"):
        url = _urn("AllergyIntolerance", allergy.id)
        entries[url] = AllergyIntolerance(
            id=str(allergy.id),
            patient=Reference(reference=patient_ref),
            code=CodeableConcept(text=allergy.substance),
            recordedDate=allergy.noted_at.isoformat(),
        )
    for diagnosis in DiagnosisCode.objects.filter(encounter__patient=patient).select_related(
        "icd11_code"
    ):
        entries[_urn("Condition", diagnosis.id)] = build_condition_resource(diagnosis, patient_ref)
    for item in PrescriptionItem.objects.filter(
        prescription__encounter__patient=patient
    ).select_related("drug"):
        entries[_urn("MedicationRequest", item.id)] = build_medication_request_resource(
            item, patient_ref
        )

    bundle_entries = [
        BundleEntry(fullUrl=url, resource=resource) for url, resource in entries.items()
    ]
    payload = json.loads(Bundle(type="collection", entry=bundle_entries).json())
    # Triage encounters (EpisodeOfCare, Encounter, QuestionnaireResponse, Flag,
    # Task, RiskAssessment, Provenance) — merged without duplicating the Patient.
    seen = {entry["fullUrl"] for entry in payload["entry"]}
    for te in patient.triage_encounters.all():
        for entry in build_triage_bundle(te)["entry"]:
            if entry["fullUrl"] not in seen:
                seen.add(entry["fullUrl"])
                payload["entry"].append(entry)
    # Signed discharge summaries (Composition, Encounter, Conditions, medications,
    # Provenance), merged the same way; every version is kept.
    from apps.care_pathway.models import DischargeSummary

    for summary in DischargeSummary.objects.filter(patient=patient, status="COMPLETED").order_by(
        "admission_id", "version"
    ):
        for entry in build_discharge_bundle(summary)["entry"]:
            if entry["fullUrl"] not in seen:
                seen.add(entry["fullUrl"])
                payload["entry"].append(entry)
    return payload


def _record(patient):
    from apps.care_pathway.models import (
        DischargeSummary,
        EpisodeOfCare,
        IntakeAssessment,
        InterventionRecord,
        OutcomeScore,
        TriageAssessment,
        TriageRecheck,
    )
    from apps.client_registry.models import Appointment, ConsentRecord
    from apps.clinical_encounter.models import DiagnosisCode, PrescriptionItem
    from apps.ipd_ward.models import Admission
    from apps.lims.models import LabResult
    from apps.mhp_program.models import PsychotherapySession
    from apps.triage.models import MentalStatusExam, VitalSigns

    return {
        "demographics": {
            "name": patient.get_full_name(),
            "preferred_name": patient.preferred_name,
            "citramac_number": patient.citramac_number,
            "uhid_number": patient.uhid_number,
            "date_of_birth": _iso(patient.date_of_birth),
            "sex": patient.get_gender_display() if patient.gender else "",
            "phone": patient.contact_phone,
            "email": patient.contact_email,
            "address": patient.address,
            "national_id": patient.national_id,
            "preferred_language": patient.preferred_language,
            "next_of_kin": patient.next_of_kin.name if patient.next_of_kin else "",
            "registered_at": _iso(patient.registered_at),
        },
        "allergies": [
            {
                "substance": a.substance,
                "reaction": a.reaction,
                "verification": a.get_verification_status_display(),
                "noted_at": _iso(a.noted_at),
            }
            for a in patient.allergy_records.all()
        ],
        "episodes": [
            {
                "status": e.get_status_display(),
                "started": _iso(e.period_start),
                "ended": _iso(e.period_end),
                "history": [
                    {"status": h.get_status_display(), "from": _iso(h.period_start)}
                    for h in e.status_history.all()
                ],
            }
            for e in EpisodeOfCare.objects.filter(patient=patient)
        ],
        "triage_assessments": [
            {
                "signed_at": _iso(a.signed_at),
                "signed_by": _name(a.signed_by),
                "priority": a.final_priority,
                "recommendation": a.recommendation,
                "reasons": a.recommendation_reasons,
                "decision": a.get_decision_display() if a.decision else "",
                "override_reason": a.override_reason,
                "findings": a.findings,
            }
            for a in TriageAssessment.objects.filter(
                triage_encounter__patient=patient, status="COMPLETED"
            ).select_related("signed_by")
        ],
        "triage_rechecks": [
            {
                "signed_at": _iso(r.signed_at),
                "signed_by": _name(r.signed_by),
                "change_since_last_check": r.change_since_last_check,
                "distress_behaviour": r.distress_behaviour,
                "observations": r.observations,
                "note": r.note,
            }
            for r in TriageRecheck.objects.filter(
                triage_encounter__patient=patient, status="COMPLETED"
            ).select_related("signed_by")
        ],
        "vital_signs": [
            {
                "recorded_at": _iso(v.recorded_at),
                "blood_pressure": (f"{v.systolic_bp}/{v.diastolic_bp}" if v.systolic_bp else None),
                "heart_rate": v.heart_rate,
                "respiratory_rate": v.respiratory_rate,
                "temperature_c": str(v.temperature_c) if v.temperature_c is not None else None,
                "spo2": v.spo2,
                "blood_glucose_mmol": (
                    str(v.blood_glucose_mmol) if v.blood_glucose_mmol is not None else None
                ),
            }
            for v in VitalSigns.objects.filter(encounter__patient=patient)
        ],
        "mental_status_exams": [
            {
                "recorded_at": _iso(m.recorded_at),
                "recorded_by": _name(m.recorded_by),
                **{
                    field: getattr(m, field)
                    for field in (
                        "appearance",
                        "behavior",
                        "speech",
                        "mood",
                        "affect",
                        "thought_process",
                        "thought_content",
                        "perception",
                        "cognition",
                        "insight",
                        "judgment",
                        "plan",
                    )
                },
            }
            for m in MentalStatusExam.objects.filter(encounter__patient=patient).select_related(
                "recorded_by"
            )
        ],
        "diagnoses": [
            {
                "code": d.icd11_code_id,
                "description": d.icd11_code.description,
                "status": d.get_status_display(),
                "primary": d.is_primary,
                "noted_at": _iso(d.noted_at),
            }
            for d in DiagnosisCode.objects.filter(encounter__patient=patient).select_related(
                "icd11_code"
            )
        ],
        "prescriptions": [
            {
                "drug": i.drug.generic_name,
                "dose": i.dose,
                "route": i.route,
                "frequency": i.frequency,
                "duration": i.duration,
                "prescribed_at": _iso(i.prescription.prescribed_at),
            }
            for i in PrescriptionItem.objects.filter(
                prescription__encounter__patient=patient
            ).select_related("drug", "prescription")
        ],
        "lab_results": [
            {
                "test": r.lab_order.loinc_code.description,
                "result": r.result_value,
                "unit": r.unit,
                "reference_range": r.reference_range,
                "abnormal": r.is_abnormal,
                "validated_at": _iso(r.validated_at),
            }
            for r in LabResult.objects.filter(
                lab_order__encounter__patient=patient, is_validated=True
            ).select_related("lab_order__loinc_code")
        ],
        "admissions": [
            {
                "admitted_at": _iso(a.admitted_at),
                "discharged_at": _iso(a.discharged_at),
                "type": a.get_admission_type_display(),
                "status": a.get_status_display(),
                "reason": a.reason_for_admission,
                "legal_status": a.legal_status,
                "discharge_summary": a.discharge_summary,
            }
            for a in Admission.objects.filter(patient=patient)
        ],
        "discharge_summaries": [
            {
                "version": d.version,
                "signed_at": _iso(d.signed_at),
                "signed_by": _name(d.signed_by),
                "signed_role": d.signed_role,
                "disposition": d.disposition,
                "discharged_at": _iso(d.discharged_at),
                "destination": d.destination,
                "clinical_status": d.clinical_status,
                "treatment_summary": d.treatment_summary,
                "legal_status_at_discharge": d.legal_status_at_discharge,
                "diagnoses": [x.icd11_code_id for x in d.diagnoses.all()],
                "medications": [
                    {
                        "drug": m.drug.generic_name,
                        "dose": m.dose,
                        "route": m.route,
                        "frequency": m.frequency,
                        "duration": m.duration,
                        "action": m.action,
                    }
                    for m in d.medications.select_related("drug")
                ],
            }
            for d in DischargeSummary.objects.filter(patient=patient, status="COMPLETED")
            .select_related("signed_by")
            .order_by("admission_id", "version")
        ],
        "intake_assessments": [
            {
                "saved_at": _iso(i.created_at),
                "author": _name(i.author),
                "presenting_concern": i.presenting_concern,
                "history": i.history,
                "risk_level": i.get_risk_level_display() if i.risk_level else "",
                "formulation": i.formulation,
                "clinical_decision": i.clinical_decision,
            }
            for i in IntakeAssessment.objects.filter(patient=patient).select_related("author")
        ],
        "outcome_scores": [
            {
                "instrument": s.get_instrument_display(),
                "score": s.score,
                "recorded_at": _iso(s.recorded_at),
            }
            for s in OutcomeScore.objects.filter(patient=patient)
        ],
        "psychotherapy_sessions": [
            {
                "date": _iso(s.session_date),
                "type": s.get_session_type_display(),
                "therapist": _name(s.therapist),
                "modality": s.modality,
                "goals": s.goals,
                "notes": s.session_notes,
            }
            for s in PsychotherapySession.objects.filter(patient=patient).select_related(
                "therapist"
            )
        ],
        "interventions": [
            {
                "performed_at": _iso(r.performed_at),
                "intervention": r.intervention,
                "response": r.response,
                "next_action": r.next_action,
            }
            for r in InterventionRecord.objects.filter(patient=patient)
        ],
        "appointments": [
            {
                "scheduled_for": _iso(a.scheduled_for),
                "type": a.appointment_type,
                "status": a.get_status_display(),
            }
            for a in Appointment.objects.filter(patient=patient)
        ],
        "data_sharing_consent": [
            {
                "granted": c.granted,
                "wording_version": c.consent_text_version,
                "captured_at": _iso(c.captured_at),
            }
            for c in ConsentRecord.objects.filter(patient=patient)
        ],
    }


def build_patient_export(data_request):
    patient = data_request.patient
    return {
        "generated_at": timezone.now().isoformat(),
        "facility": patient.organization.name,
        "request": {
            "id": str(data_request.id),
            "type": data_request.get_request_type_display(),
            "received_at": _iso(data_request.received_at),
        },
        "fhir": _fhir_bundle(patient),
        "record": _record(patient),
    }
