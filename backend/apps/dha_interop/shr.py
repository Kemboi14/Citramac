"""
The national Shared Health Record (SHR) through the DHA HIE
(hie_spec/openapi/sharedhealthrecord.openapi.json; guide
sharedHealthRecord__gettingStarted__intro.md).

Consent → visit → write → read → close:
- request_consent: POST /shr/consents; DHA sends the patient (or their
  representative) an OTP. An emergency consent for an incapacitated patient
  is approved on the spot.
- verify_consent: POST /shr/consents/{id}/verify with the OTP — approve, or
  record the patient's refusal (a refusal is recorded, never dropped).
- send_visit: POST /shr/bundles with a FHIR R4 collection Bundle conforming
  to Kenya Core 1.0.0 (fhir_validation/kenya_core).
- read_records: GET /shr/patient-records with the per-visit X-Consent-Token.
- close_visit: POST /shr/visits/{visit_id}/close (usually a two-step OTP).

Resource mapping (stated in the plan the project owner approved — CLAUDE.md §7):
| Ours                         | R4 resource   | Profile                    | Binding                         |
| care_pathway.EpisodeOfCare   | EpisodeOfCare | kenya-core-episodeofcare   | status: episode-of-care-status  |
| clinical_encounter.Encounter | Encounter     | kenya-core-encounter       | encounter-status-vs, -type-vs   |
| clinical_encounter.Diagnosis | Condition     | kenya-core-condition       | ICD-11 MMS; Kenya Core statuses |

Sending is irreversible — once in the national record it cannot be recalled
(CLAUDE.md §3 item 7: P0). So a bundle leaves only when every gate passes:
- the SHR consent for this visit is APPROVED;
- the client's own HIE consent is an explicit YES for general AND mental-health
  sharing, and for substance-use sharing whenever the content touches SUD;
- the SHR label catalogue offers R (restricted) and PSY (and SUD when needed) —
  every resource carries them in meta.security;
- every resource passes base R4 4.0.1 and its Kenya Core profile.

Never sent: psychotherapy encounters and every note (therapy, progress,
process), trauma history, risk assessments, group-session content, legal
status. Omitted until a national code is verified, with the reason shown:
observations (no verified LOINC for vitals/scores), medications (drug codes
are a local index, not the Kenya Core product list), allergies (free-text
substances; Kenya Core requires coded active ingredients), referrals (no
destination FR code recorded).
"""

import uuid

from django.core.cache import cache
from django.db import transaction
from django.utils import timezone

from apps.client_registry.consent import (
    HIE_GENERAL,
    HIE_MENTAL_HEALTH,
    HIE_SUBSTANCE_USE,
    may_send_to_hie,
)
from apps.tenancy.crypto import decrypt_value, encrypt_value

from . import hie_api, hie_client
from .fhir_mapper import _CLINICAL_STATUS as HL7_CLINICAL_STATUS
from .fhir_mapper import CONDITION_CLINICAL_SYSTEM, CONDITION_VER_STATUS_SYSTEM
from .fhir_validation import kenya_core, validate_resource
from .models import FhirResourceCache, ShrConsent
from .registries import client_registry_id

ICD11_SYSTEM = "http://id.who.int/icd/release/11/mms"  # Kenya Core Condition.code binding
ACT_CODE_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-ActCode"  # Kenya Core Encounter.class
LABEL_CACHE_SECONDS = 24 * 3600
# Bundle ids are derived, so the same visit content always has the same id.
BUNDLE_NAMESPACE = uuid.UUID("6f1f6f0e-5a11-4c6b-9b8e-2f6b0e0c51a7")
NEVER_SENT_ENCOUNTER_TYPES = ("PSYCHOTHERAPY",)

EPISODE_TYPE_VS = "https://fhir.dha.go.ke/terminology/ValueSet/episode-of-care-type-vs"
ENCOUNTER_STATUS_VS = "https://fhir.dha.go.ke/terminology/ValueSet/encounter-status-vs"
ENCOUNTER_TYPE_VS = "https://fhir.dha.go.ke/terminology/ValueSet/encounter-type-vs"
CONDITION_CLINICAL_VS = "https://fhir.dha.go.ke/terminology/ValueSet/condition-clinical-status-vs"
CONDITION_VERIFICATION_VS = (
    "https://fhir.dha.go.ke/terminology/ValueSet/condition-verification-status-vs"
)
CONDITION_CATEGORY_VS = "https://fhir.dha.go.ke/terminology/ValueSet/condition-category-vs"

# Our values → Kenya Core codes (each looked up in the package by kenya_core.coding).
ENCOUNTER_STATUS = {"OPEN": "in-progress", "IN_PROGRESS": "in-progress", "CLOSED": "finished"}
CONDITION_CLINICAL = {"ACTIVE": "ACTIVE", "RESOLVED": "RESOLVED", "HISTORICAL": "INACTIVE"}
CONDITION_VERIFICATION = {
    "PROVISIONAL": "UNCONFIRMED",
    "DIFFERENTIAL": "DIFFERENTIAL",
    "CONFIRMED": "CONFIRMED",
}


class ShrError(Exception):
    def __init__(self, message, field=None):
        self.message = message
        self.field = field
        super().__init__(message)


def _raise(exc):
    if isinstance(exc, hie_api.HieNotConfigured):
        raise ShrError(str(exc)) from exc
    raise ShrError(exc.describe()) from exc


def _call(method, path, *, branch, organization_id, transaction_type="SHR_CONSENT", **kwargs):
    try:
        return hie_api.call(
            method,
            path,
            transaction_type=transaction_type,
            organization_id=organization_id,
            branch=branch,
            **kwargs,
        )
    except (hie_api.HieError, hie_api.HieNotConfigured) as exc:
        _raise(exc)


def _puid(user):
    credential = getattr(user, "practitioner_credential", None) if user else None
    return credential.hwr_puid if credential and credential.hwr_puid else ""


def _requested_by(user):
    name = user.get_full_name() if hasattr(user, "get_full_name") else str(user)
    role = user.roles.order_by("name").values_list("name", flat=True).first() if user else ""
    return f"{name} ({role})" if role else name


# ── Consent and the visit ──


def open_visits(patient, branch):
    cr_id = client_registry_id(patient)
    if not cr_id:
        raise ShrError("Look the client up in the Client Registry first.", field="cr_id")
    body = _call(
        "GET",
        "/shr/open-visits",
        branch=branch,
        organization_id=patient.organization_id,
        params={"patient_id": cr_id, "facility_id": branch.sha_fr_code},
    )
    return [v.get("visit_id") for v in (body or {}).get("visits") or [] if v.get("visit_id")]


@transaction.atomic
def request_consent(
    patient, branch, episode, user, visit_type, *, emergency=False, incapacity_reason="",
    representative_cr_id="", representative_relationship="", patient_capable=True,
):
    cr_id = client_registry_id(patient)
    if not cr_id:
        raise ShrError(
            "Look the client up in the Client Registry and confirm the match first — SHR "
            "consent is requested by Client Registry ID.",
            field="cr_id",
        )
    if not branch.sha_fr_code:
        raise ShrError(f"{branch.name} has no FR code.", field="branch")
    if visit_type not in ("OP", "IP"):
        raise ShrError("Choose outpatient or inpatient.", field="visit_type")
    incapacity_reason = (incapacity_reason or "").strip()
    if (emergency or not patient_capable) and not incapacity_reason:
        raise ShrError(
            "Record why the client cannot consent for themselves.", field="incapacity_reason"
        )
    relationships = dict(ShrConsent.RELATIONSHIP_CHOICES)
    if representative_cr_id and representative_relationship not in relationships:
        raise ShrError("Choose how the representative relates to the client.", field="representative_relationship")
    payload = {
        "cr_id": cr_id,
        "facility_id": branch.sha_fr_code,
        "requested_by": _requested_by(user),
        "visit_type": visit_type,
    }
    puid = _puid(user)
    if puid:
        payload["practitioner_id"] = puid
    if emergency:
        payload["emergency"] = 1
    if not patient_capable:
        payload["patient_capable"] = 0
    if incapacity_reason:
        payload["incapacity_reason"] = incapacity_reason[:255]
    if representative_cr_id:
        payload["representative_cr_id"] = representative_cr_id.strip()
        payload["representative_relationship"] = representative_relationship
    body = _call(
        "POST", "/shr/consents", branch=branch, organization_id=patient.organization_id,
        json_body=payload,
    ) or {}
    consent = ShrConsent(
        organization=patient.organization,
        patient=patient,
        branch=branch,
        episode=episode,
        cr_id=cr_id,
        visit_type=visit_type,
        consent_id=str(body.get("consent_id") or "")[:64],
        otp_record=str(body.get("otp_record") or "")[:128],
        emergency=bool(emergency),
        incapacity_reason=incapacity_reason[:255],
        representative_cr_id=(representative_cr_id or "").strip()[:64],
        representative_relationship=representative_relationship if representative_cr_id else "",
        requested_by=user,
        detail=str(body.get("message") or "")[:255],
    )
    if body.get("consent_token"):
        # Emergency: approved on the spot, no OTP.
        consent.status = ShrConsent.STATUS_APPROVED
        consent.consent_token_encrypted = encrypt_value(str(body["consent_token"]))
        consent.visit_id = str(body.get("visit_id") or "")[:64]
        consent.decided_at = timezone.now()
    consent.save()
    return consent


@transaction.atomic
def verify_consent(consent, user, *, otp="", approve=True, rejection_reason=""):
    consent = ShrConsent.objects.select_for_update().get(pk=consent.pk)
    closing = consent.status == ShrConsent.STATUS_CLOSING
    if consent.status not in (ShrConsent.STATUS_PENDING, ShrConsent.STATUS_CLOSING):
        raise ShrError("This consent is not awaiting an OTP.")
    payload = {"otp_record": consent.otp_record}
    if approve:
        if not (otp or "").strip():
            raise ShrError("Enter the OTP the client received.", field="otp")
        payload["otp"] = otp.strip()
        payload["consent_decision"] = "Approve"
    else:
        if not (rejection_reason or "").strip():
            raise ShrError("Record why the client refused.", field="rejection_reason")
        payload["consent_decision"] = "Reject"
        payload["rejection_reason"] = rejection_reason.strip()[:255]
        if (otp or "").strip():
            payload["otp"] = otp.strip()
    body = _call(
        "POST",
        f"/shr/consents/{consent.consent_id}/verify",
        branch=consent.branch,
        organization_id=consent.organization_id,
        json_body=payload,
    ) or {}
    consent.detail = str(body.get("message") or "")[:255]
    if closing:
        consent.status = ShrConsent.STATUS_CLOSED
        consent.closed_at = timezone.now()
        consent.consent_token_encrypted = ""
    elif approve:
        token = str(body.get("consent_token") or "")
        if not token:
            raise ShrError(f"DHA did not approve the consent: {consent.detail or 'no token issued'}")
        consent.status = ShrConsent.STATUS_APPROVED
        consent.consent_token_encrypted = encrypt_value(token)
        consent.visit_id = str(body.get("visit_id") or "")[:64]
        consent.decided_at = timezone.now()
    else:
        consent.status = ShrConsent.STATUS_REJECTED
        consent.rejection_reason = rejection_reason.strip()[:255]
        consent.decided_at = timezone.now()
    consent.save()
    return consent


def resend_otp(consent):
    if consent.status not in (ShrConsent.STATUS_PENDING, ShrConsent.STATUS_CLOSING):
        raise ShrError("This consent is not awaiting an OTP.")
    body = _call(
        "POST",
        f"/shr/consents/{consent.consent_id}/resend-otp",
        branch=consent.branch,
        organization_id=consent.organization_id,
    ) or {}
    # "Verify with that one, not the original."
    consent.otp_record = str(body.get("otp_record") or consent.otp_record)[:128]
    consent.save(update_fields=["otp_record", "updated_at"])
    return consent


def refresh_token(consent):
    if consent.status != ShrConsent.STATUS_APPROVED or not consent.visit_id:
        raise ShrError("Only an open SHR visit can be refreshed.")
    body = _call(
        "POST",
        f"/shr/visits/{consent.visit_id}/refresh",
        branch=consent.branch,
        organization_id=consent.organization_id,
    ) or {}
    if body.get("consent_token"):
        consent.consent_token_encrypted = encrypt_value(str(body["consent_token"]))
        consent.save(update_fields=["consent_token_encrypted", "updated_at"])
    return consent


@transaction.atomic
def close_visit(consent, user, *, patient_incapable=False, incapacity_reason=""):
    consent = ShrConsent.objects.select_for_update().get(pk=consent.pk)
    if consent.status != ShrConsent.STATUS_APPROVED or not consent.visit_id:
        raise ShrError("Only an open SHR visit can be closed.")
    payload = {}
    if patient_incapable:
        if not (incapacity_reason or "").strip():
            raise ShrError("Record why the client cannot consent to closing.", field="incapacity_reason")
        payload = {"patient_incapable": 1, "incapacity_reason": incapacity_reason.strip()[:255]}
    body = _call(
        "POST",
        f"/shr/visits/{consent.visit_id}/close",
        branch=consent.branch,
        organization_id=consent.organization_id,
        json_body=payload or None,
    ) or {}
    consent.detail = str(body.get("message") or "")[:255]
    if body.get("otp_record") and not body.get("end_date"):
        consent.status = ShrConsent.STATUS_CLOSING
        consent.otp_record = str(body["otp_record"])[:128]
        consent.consent_id = str(body.get("consent_id") or consent.consent_id)[:64]
    else:
        consent.status = ShrConsent.STATUS_CLOSED
        consent.closed_at = timezone.now()
        consent.consent_token_encrypted = ""
    consent.save()
    return consent


# ── Security labels ──


def label_catalogue(branch, organization_id):
    """{label code: {system, code, display}} from GET /shr/security-labels, cached a day."""
    cached = cache.get("shr-security-labels")
    if cached:
        return cached
    body = _call(
        "GET",
        "/shr/security-labels",
        branch=branch,
        organization_id=organization_id,
        transaction_type="SHR_LABELS",
    ) or {}
    catalogue = {}
    for item in body.get("data") or []:
        if not (item.get("label") and item.get("system")):
            continue
        coding = {"system": item["system"], "code": str(item["label"])}
        if item.get("display"):  # FHIR strings may not be empty
            coding["display"] = item["display"]
        catalogue[coding["code"]] = coding
    if catalogue:
        cache.set("shr-security-labels", catalogue, LABEL_CACHE_SECONDS)
    return catalogue


def condition_labels(branch, organization_id, code):
    """Labels DHA applies to a Condition with this ICD-11 code (GET /shr/resource-labels)."""
    key = f"shr-resource-labels:Condition:{code}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    body = _call(
        "GET",
        "/shr/resource-labels",
        branch=branch,
        organization_id=organization_id,
        transaction_type="SHR_LABELS",
        params={"resource_name": "Condition", "code": code},
    ) or {}
    labels = sorted(
        {
            str(item.get("label"))
            for item in ((body.get("data") or {}).get("labels") or [])
            if item.get("label")
        }
    )
    cache.set(key, labels, LABEL_CACHE_SECONDS)
    return labels


# ── The bundle ──


def _shared_encounters(consent):
    from apps.clinical_encounter.models import Encounter

    since = consent.created_at.date() if consent.created_at else timezone.localdate()
    return list(
        Encounter.objects.filter(
            patient=consent.patient, episode=consent.episode, opened_at__date__gte=since
        )
        .exclude(encounter_type__in=NEVER_SENT_ENCOUNTER_TYPES)
        .select_related("opened_by__practitioner_credential")
        .order_by("opened_at")
    )


def _sud_programme(patient):
    from apps.care_pathway.models import OatEnrolment
    from apps.mhp_program.models import SudRehabPlan

    return (
        SudRehabPlan.objects.filter(patient=patient).exists()
        or OatEnrolment.objects.filter(patient=patient).exists()
    )


def _meta(profile, security):
    return {"profile": [profile], "security": security}


def _episode_resource(consent, security):
    episode = consent.episode
    period = {"start": episode.period_start.isoformat()} if episode.period_start else {}
    if episode.period_end:
        period["end"] = episode.period_end.isoformat()
    resource = {
        "resourceType": "EpisodeOfCare",
        "id": str(episode.id),
        "meta": _meta(kenya_core.episode_profile(), security),
        "status": episode.status,
        "patient": {"reference": f"Patient/{consent.cr_id}"},
    }
    if period:
        resource["period"] = period
    return resource


def _encounter_resource(consent, encounter, security, omissions):
    resource = {
        "resourceType": "Encounter",
        "id": str(encounter.id),
        "meta": _meta(kenya_core.encounter_profile(), security),
        "status": kenya_core.coding(ENCOUNTER_STATUS_VS, ENCOUNTER_STATUS[encounter.status])["code"],
        "class": {
            "system": ACT_CODE_SYSTEM,
            "code": "IMP" if encounter.encounter_type == "INPATIENT" else "AMB",
            "display": "inpatient encounter" if encounter.encounter_type == "INPATIENT" else "ambulatory",
        },
        "type": [
            {
                "coding": [
                    kenya_core.coding(
                        ENCOUNTER_TYPE_VS,
                        "INPATIENT-VISIT"
                        if encounter.encounter_type == "INPATIENT"
                        else "OUTPATIENT-VISIT",
                    )
                ]
            }
        ],
        "subject": {"reference": f"Patient/{consent.cr_id}"},
        "episodeOfCare": [{"reference": f"EpisodeOfCare/{consent.episode_id}"}],
        "period": {"start": encounter.opened_at.isoformat()},
    }
    if encounter.closed_at:
        resource["period"]["end"] = encounter.closed_at.isoformat()
    puid = _puid(encounter.opened_by)
    if puid:
        resource["participant"] = [{"individual": {"reference": f"Practitioner/{puid}"}}]
    else:
        omissions.append(
            f"Encounter {encounter.id}: the clinician has no Health Worker Registry PUID on "
            "file, so no participant is named."
        )
    return resource


def _condition_resource(consent, diagnosis, security):
    """Both status elements carry two codings: base R4 binds them (required) to
    HL7's condition-clinical / condition-ver-status, which a profile cannot
    loosen, and Kenya Core binds them (required) to its own code systems — one
    coding from each satisfies both."""
    verification = diagnosis.verification_status or "PROVISIONAL"
    resource = {
        "resourceType": "Condition",
        "id": str(diagnosis.id),
        "meta": _meta(kenya_core.condition_profile(), security),
        "clinicalStatus": {
            "coding": [
                {"system": CONDITION_CLINICAL_SYSTEM, "code": HL7_CLINICAL_STATUS[diagnosis.status]},
                kenya_core.coding(CONDITION_CLINICAL_VS, CONDITION_CLINICAL[diagnosis.status]),
            ]
        },
        "verificationStatus": {
            "coding": [
                {
                    "system": CONDITION_VER_STATUS_SYSTEM,
                    "code": diagnosis.FHIR_VERIFICATION[verification],
                },
                kenya_core.coding(CONDITION_VERIFICATION_VS, CONDITION_VERIFICATION[verification]),
            ]
        },
        "category": [
            {"coding": [kenya_core.coding(CONDITION_CATEGORY_VS, "ENCOUNTER-DIAGNOSIS")]}
        ],
        "code": {
            "coding": [
                {
                    "system": ICD11_SYSTEM,
                    "code": diagnosis.icd11_code_id,
                    "display": diagnosis.icd11_code.description,
                }
            ]
        },
        "subject": {"reference": f"Patient/{consent.cr_id}"},
        "encounter": {"reference": f"Encounter/{diagnosis.encounter_id}"},
        "recordedDate": diagnosis.noted_at.isoformat(),
    }
    return resource


STANDING_OMISSIONS = [
    "Observations (vital signs, scores): no LOINC code for them is verified yet.",
    "Medications: drug codes are the local National Drug Index, not the Kenya Core product list.",
    "Allergies: substances are free text; Kenya Core requires a coded active ingredient.",
    "Referrals: the destination facility's FR code is not recorded.",
    "Never shared: therapy, progress and process notes, trauma history, risk assessments, "
    "group-session content, legal status and psychotherapy encounters.",
]


def build_bundle(consent, labels):
    """
    (bundle, omissions, sud) for this SHR visit. `labels` is the label
    catalogue ({code: coding}); every resource carries R + PSY, and SUD when
    the content touches substance use.
    """
    from apps.clinical_encounter.models import DiagnosisCode

    omissions = list(STANDING_OMISSIONS)
    encounters = _shared_encounters(consent)
    diagnoses = list(
        DiagnosisCode.objects.filter(encounter__in=encounters)
        .select_related("icd11_code")
        .order_by("-is_primary", "noted_at")
    )
    refuted = [d for d in diagnoses if d.verification_status == "RULED_OUT"]
    diagnoses = [d for d in diagnoses if d.verification_status != "RULED_OUT"]
    if refuted:
        omissions.append(f"{len(refuted)} ruled-out diagnosis(es) not shared.")
    sud = _sud_programme(consent.patient) or any(
        "SUD" in condition_labels(consent.branch, consent.organization_id, d.icd11_code_id)
        for d in diagnoses
    )
    security = [labels["R"], labels["PSY"]] + ([labels["SUD"]] if sud else [])
    entries = [_episode_resource(consent, security)]
    for encounter in encounters:
        entries.append(_encounter_resource(consent, encounter, security, omissions))
    for diagnosis in diagnoses:
        entries.append(_condition_resource(consent, diagnosis, security))
    key = "|".join([str(consent.id)] + [e["resourceType"] + "/" + e["id"] for e in entries])
    bundle = {
        "resourceType": "Bundle",
        "id": str(uuid.uuid5(BUNDLE_NAMESPACE, key)),
        "type": "collection",
        # fullUrl is required on a collection entry and must be absolute; every
        # resource id here is one of our UUIDs, so urn:uuid is its identity.
        # References stay the relative Type/id form the SHR's own example uses.
        "entry": [{"fullUrl": f"urn:uuid:{e['id']}", "resource": e} for e in entries],
    }
    return bundle, omissions, sud, len(encounters)


def conformance_problems(bundle):
    """Base R4 4.0.1 schema + Kenya Core profile problems, per resource."""
    profiles = {
        "EpisodeOfCare": kenya_core.episode_profile(),
        "Encounter": kenya_core.encounter_profile(),
        "Condition": kenya_core.condition_profile(),
    }
    problems = list(validate_resource(bundle))
    for entry in bundle.get("entry", []):
        resource = entry["resource"]
        label = f"{resource['resourceType']}/{resource['id']}"
        problems += [f"{label}: {p}" for p in validate_resource(resource)]
        profile = profiles.get(resource["resourceType"])
        if profile:
            problems += [f"{label}: {p}" for p in kenya_core.check(resource, profile)]
    return problems


def gate(consent, labels, sud, encounter_count):
    """Why this visit's bundle may not be sent (empty = may send)."""
    patient = consent.patient
    problems = []
    if consent.status != ShrConsent.STATUS_APPROVED:
        problems.append("The client has not approved this SHR visit.")
    if not may_send_to_hie(patient, HIE_GENERAL):
        problems.append("The client has not said YES to sharing with the national exchange.")
    if not may_send_to_hie(patient, HIE_MENTAL_HEALTH):
        problems.append("The client has not said YES to sharing mental-health information.")
    if sud and not may_send_to_hie(patient, HIE_SUBSTANCE_USE):
        problems.append(
            "This visit involves substance-use care and the client has not said YES to sharing "
            "substance-use information — nothing is sent."
        )
    for code in ("R", "PSY") + (("SUD",) if sud else ()):
        if code not in labels:
            problems.append(f"The SHR label catalogue offers no {code} label — nothing is sent.")
    if encounter_count == 0:
        problems.append("No encounter in this episode since the SHR visit opened.")
    return problems


def prepare(consent):
    labels = label_catalogue(consent.branch, consent.organization_id)
    have = {code for code in ("R", "PSY", "SUD") if code in labels}
    if {"R", "PSY"} - have:
        sud = _sud_programme(consent.patient)
        return None, list(STANDING_OMISSIONS), gate(consent, labels, sud, 1), sud
    bundle, omissions, sud, count = build_bundle(consent, labels)
    problems = gate(consent, labels, sud, count)
    if not problems:
        problems = conformance_problems(bundle)
    return bundle, omissions, problems, sud


def preview(consent):
    bundle, omissions, problems, sud = prepare(consent)
    return {
        "bundle": bundle,
        "omissions": omissions,
        "problems": problems,
        "substance_use": sud,
        "resources": [
            {"type": e["resource"]["resourceType"], "id": e["resource"]["id"]}
            for e in (bundle or {}).get("entry", [])
        ],
    }


def send_visit(consent, user):
    """Gate, then queue durably and attempt delivery. Returns the outbox row."""
    from apps.sysadmin_audit.audit import write_event
    from apps.sysadmin_audit.models import AuditLogEntry

    bundle, omissions, problems, sud = prepare(consent)
    if problems:
        raise ShrError("Not sent: " + " ".join(problems))
    already = FhirResourceCache.objects.filter(
        organization_id=consent.organization_id, idempotency_key=f"shr:{bundle['id']}"
    ).first()
    if already is not None and already.status in ("SENT", "RECEIVED"):
        return already  # this exact content is already in the national record
    with transaction.atomic():
        entry = hie_client.enqueue(
            consent.organization_id,
            hie_client.SHR_BUNDLE,
            bundle,
            f"shr:{bundle['id']}",
            related=("ShrConsent", consent.id),
            retry_safe=False,
        )
        write_event(
            consent.organization_id,
            AuditLogEntry.ACTION_HIE_DISCLOSURE,
            "client_registry.patient",
            consent.patient_id,
            {
                "bundle_id": bundle["id"],
                "resources": [
                    f"{e['resource']['resourceType']}/{e['resource']['id']}" for e in bundle["entry"]
                ],
                "labels": ["R", "PSY"] + (["SUD"] if sud else []),
                "facility": consent.branch.sha_fr_code,
            },
        )
    if entry.status in ("CACHED", "RETRY", "REJECTED"):
        hie_client.deliver(entry)
        entry.refresh_from_db()
    return entry


def read_records(consent, user, resources):
    """The national record for this client, as DHA returns it (FHIR searchset)."""
    from apps.sysadmin_audit.audit import write_event
    from apps.sysadmin_audit.models import AuditLogEntry

    if consent.status != ShrConsent.STATUS_APPROVED:
        raise ShrError("Reading the national record needs an approved, open SHR visit.")
    puid = _puid(user)
    if not puid:
        raise ShrError(
            "Your Health Worker Registry PUID is not on file — DHA attributes every read to a "
            "practitioner. An Org Admin records it on your practitioner credential.",
            field="puid",
        )
    allowed = (
        "Encounter", "EpisodeOfCare", "Observation", "Condition", "Procedure", "Medication",
        "MedicationRequest", "MedicationDispense", "MedicationAdministration", "Immunization",
        "ServiceRequest", "AllergyIntolerance",
    )
    wanted = [r for r in resources if r in allowed] or ["Condition", "Encounter"]
    body = _call(
        "GET",
        "/shr/patient-records",
        branch=consent.branch,
        organization_id=consent.organization_id,
        params={"cr_id": consent.cr_id, "practitioner_id": puid, "resources": ",".join(wanted)},
        headers={"X-Consent-Token": decrypt_value(consent.consent_token_encrypted)},
        log_response=False,
    )
    write_event(
        consent.organization_id,
        AuditLogEntry.ACTION_VIEW,
        "client_registry.patient",
        consent.patient_id,
        {"shared_health_record": wanted, "facility": consent.branch.sha_fr_code},
    )
    return body or {}


def consent_data(consent):
    sent = FhirResourceCache.objects.filter(
        related_object_type="ShrConsent", related_object_id=consent.id
    ).order_by("-created_at")
    return {
        "id": str(consent.id),
        "branch": {"id": str(consent.branch_id), "name": consent.branch.name},
        "episode": str(consent.episode_id),
        "visit_type": consent.visit_type,
        "status": consent.status,
        "status_label": consent.get_status_display(),
        "emergency": consent.emergency,
        "representative_cr_id": consent.representative_cr_id,
        "rejection_reason": consent.rejection_reason,
        "visit_id": consent.visit_id,
        "detail": consent.detail,
        "requested_at": consent.created_at.isoformat(),
        "decided_at": consent.decided_at.isoformat() if consent.decided_at else None,
        "closed_at": consent.closed_at.isoformat() if consent.closed_at else None,
        "sends": [
            {
                "id": str(s.id),
                "status": s.status,
                "status_label": s.get_status_display(),
                "detail": s.transmission_detail,
                "issues": s.issues,
                "at": s.updated_at.isoformat(),
            }
            for s in sent
        ],
    }
