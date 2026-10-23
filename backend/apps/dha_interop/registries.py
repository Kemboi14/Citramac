"""
DHA HIE registries (hie_spec/openapi/registries.openapi.json):

- Facility Registry  GET /facilities/search?identifier=&identifier-type=fr-code
- Client Registry    GET /patients?identification_type=&identification_number=
- Health Worker Reg. GET /professionals?identification_type=&identification_number=&regulator=

A registry answer is evidence, not an instruction: a Client Registry match is
shown to the clerk, who confirms it is the same person before anything is
recorded, and what is recorded is an *added*, verified identifier slice — the
local UHID and CITRAMAC number are never overwritten (CLAUDE.md §4). Names,
date of birth and dependants returned by the registry are displayed, never
copied over what the client told us.
"""

from django.utils import timezone

from apps.client_registry.identity import record_identifier
from apps.client_registry.models import PatientIdentifier

from . import hie_api

CLIENT_REGISTRY_SOURCE = "DHA Client Registry"
HEALTH_WORKER_REGISTRY_SOURCE = "DHA Health Worker Registry"

# Our identifier kinds → the published `identification_type` enum of
# GET /patients (registries.openapi.json). Passport, UNHCR and IPRS UPI have
# no value in that enum and cannot be searched.
CLIENT_REGISTRY_ID_TYPES = {
    PatientIdentifier.KIND_NATIONAL_ID: "National ID",
    PatientIdentifier.KIND_CLIENT_REGISTRY: "ClientRegistry ID",
    PatientIdentifier.KIND_BIRTH_CERT: "Birth Certificate",
    PatientIdentifier.KIND_ALIEN: "Alien ID",
    PatientIdentifier.KIND_REFUGEE: "Refugee ID",
}
# The other published values, which have no PatientIdentifier kind of ours.
EXTRA_CLIENT_ID_TYPES = ("Birth Notification", "Mandate Number")
CLIENT_ID_TYPE_VALUES = tuple(CLIENT_REGISTRY_ID_TYPES.values()) + EXTRA_CLIENT_ID_TYPES
# registries.openapi.json GET /professionals `regulator` enum.
REGULATORS = ("KMPDC", "COC", "NCK", "PPB")


class RegistryError(Exception):
    def __init__(self, message, field=None):
        self.message = message
        self.field = field
        super().__init__(message)


def _fail(exc):
    if isinstance(exc, hie_api.HieNotConfigured):
        raise RegistryError(str(exc)) from exc
    raise RegistryError(exc.describe()) from exc


# ── Facility Registry ──


def verify_branch_facility(branch):
    """Look the branch's FR code up and record the registry's answer on the branch."""
    from apps.tenancy.models import Branch

    if not branch.sha_fr_code:
        raise RegistryError(
            f"{branch.name} has no SHA FR code to look up — add it in Branch Settings.",
            field="sha_fr_code",
        )
    try:
        record = hie_api.call(
            "GET",
            "/facilities/search",
            transaction_type="FACILITY_LOOKUP",
            organization_id=branch.organization_id,
            platform=True,
            params={"identifier": branch.sha_fr_code, "identifier-type": "fr-code"},
        )
    except hie_api.HieError as exc:
        if exc.http_status == 404:
            record = {}
        else:
            _fail(exc)
    except hie_api.HieNotConfigured as exc:
        _fail(exc)

    found = isinstance(record, dict) and record.get("frCode") == branch.sha_fr_code
    branch.registry_record = record if found else {}
    branch.registry_checked_at = timezone.now()
    if found:
        branch.registry_status = Branch.REGISTRY_VERIFIED
        branch.registry_problem = ""
    else:
        branch.registry_status = Branch.REGISTRY_NOT_FOUND
        branch.registry_problem = (
            f"FR code {branch.sha_fr_code} was not found in the DHA Facility Registry — check "
            "the code against the facility's SHA contract."
        )
    branch.save(
        update_fields=[
            "registry_record",
            "registry_checked_at",
            "registry_status",
            "registry_problem",
            "updated_at",
        ]
    )
    return branch


def facility_summary(branch):
    """What Branch Settings shows: the registry's own words, uninterpreted."""
    record = branch.registry_record or {}
    sha_operation = record.get("SHAOperationStatus") or {}
    return {
        "status": branch.registry_status,
        "status_label": branch.get_registry_status_display() if branch.registry_status else "",
        "checked_at": branch.registry_checked_at.isoformat() if branch.registry_checked_at else None,
        "problem": branch.registry_problem,
        "official_name": record.get("officialName", ""),
        "fr_code": record.get("frCode", ""),
        "fid_code": record.get("fidCode", ""),
        "keph_level": record.get("kephLevel", ""),
        "facility_type": record.get("facilityType", ""),
        "regulatory_body": record.get("regulatoryBody", ""),
        "registration_number": record.get("registrationNumber", ""),
        "license_number": record.get("licenseNumber", ""),
        "license_status": record.get("facilityLicenseStatus", ""),
        "license_end": record.get("facilityLicenseEndDate", ""),
        "sha_contract_status": record.get("shaContractStatus", ""),
        "sha_contract_end": record.get("shaConstractEndDate", ""),
        "sha_contracted_services": record.get("shaContractedServices") or [],
        "sha_operational_status": sha_operation.get("operationalStatus", ""),
        "sha_operational_status_reason": sha_operation.get("operationalStatusReason", ""),
        "sha_suspension_reason": sha_operation.get("suspensionReason", ""),
    }


# ── Client Registry ──


def search_client(organization_id, identification_type, identification_number):
    """The registry's record for one identifier, or None when there is no match."""
    identification_number = (identification_number or "").strip()
    if identification_type not in CLIENT_ID_TYPE_VALUES:
        raise RegistryError(
            "Choose an identifier type the Client Registry accepts.", field="identification_type"
        )
    if not identification_number:
        raise RegistryError("Enter the identifier number.", field="identification_number")
    try:
        record = hie_api.call(
            "GET",
            "/patients",
            transaction_type="CLIENT_LOOKUP",
            organization_id=organization_id,
            platform=True,
            params={
                "identification_type": identification_type,
                "identification_number": identification_number,
            },
        )
    except hie_api.HieError as exc:
        if exc.http_status == 404:
            return None
        _fail(exc)
    except hie_api.HieNotConfigured as exc:
        _fail(exc)
    if not isinstance(record, dict) or not record.get("id"):
        return None
    return record


def client_summary(record):
    """The fields shown to the clerk to decide whether it is the same person."""
    return {
        "cr_id": record.get("id", ""),
        "first_name": record.get("first_name", ""),
        "middle_name": record.get("middle_name", ""),
        "last_name": record.get("last_name", ""),
        "date_of_birth": record.get("date_of_birth", ""),
        "gender": record.get("gender", ""),
        "deceased_datetime": record.get("deceased_datetime", ""),
        "identification_type": record.get("identification_type", ""),
        "identification_number": record.get("identification_number", ""),
        "other_identifications": [
            {
                "identification_type": i.get("identification_type", ""),
                "identification_number": i.get("identification_number", ""),
            }
            for i in (record.get("other_identifications") or [])
        ],
        "dependants": len(record.get("dependants") or []),
        "county": record.get("county", ""),
        "sub_county": record.get("sub_county", ""),
    }


def patient_search_identifier(patient):
    """(identification_type, number) to search the registry with: the CR ID when
    we hold one, else the first searchable document identifier."""
    held = {
        i.kind: i.value
        for i in patient.identifiers.filter(superseded_at__isnull=True).order_by("created_at")
    }
    if held.get(PatientIdentifier.KIND_CLIENT_REGISTRY):
        return "ClientRegistry ID", held[PatientIdentifier.KIND_CLIENT_REGISTRY]
    for kind, id_type in CLIENT_REGISTRY_ID_TYPES.items():
        if held.get(kind):
            return id_type, held[kind]
    return None, None


def confirm_client_match(patient, user, record):
    """
    The clerk has confirmed `record` is this client. Record the CR ID as a
    verified identifier slice and mark the identifier we searched with as
    registry-verified. Raises ValidationError (from record_identifier) when the
    CR ID already belongs to another client record — a duplicate to resolve,
    never silently re-pointed.
    """
    now = timezone.now()
    cr_id = record.get("id", "")
    if not cr_id:
        raise RegistryError("The registry record carries no Client Registry ID.")
    identifier, created = record_identifier(
        patient,
        PatientIdentifier.KIND_CLIENT_REGISTRY,
        cr_id,
        verified_source=CLIENT_REGISTRY_SOURCE,
        verified_at=now,
    )
    if not created and identifier.verified_at is None:
        identifier.verified_at = now
        identifier.verified_by_source = CLIENT_REGISTRY_SOURCE
        identifier.save(update_fields=["verified_at", "verified_by_source", "updated_at"])
    searched = {
        (i.get("identification_type"), i.get("identification_number"))
        for i in [record] + list(record.get("other_identifications") or [])
    }
    for kind, id_type in CLIENT_REGISTRY_ID_TYPES.items():
        if kind == PatientIdentifier.KIND_CLIENT_REGISTRY:
            continue
        for held in patient.identifiers.filter(
            kind=kind, superseded_at__isnull=True, verified_at__isnull=True
        ):
            if (id_type, held.value) in searched:
                held.verified_at = now
                held.verified_by_source = CLIENT_REGISTRY_SOURCE
                held.save(update_fields=["verified_at", "verified_by_source", "updated_at"])
    return identifier


def client_registry_id(patient):
    identifier = (
        patient.identifiers.filter(
            kind=PatientIdentifier.KIND_CLIENT_REGISTRY, superseded_at__isnull=True
        )
        .exclude(verified_at__isnull=True)
        .first()
    )
    return identifier.value if identifier else ""


# ── Health Worker Registry ──


def verify_practitioner(credential):
    """Look a practitioner's registration number up and keep the registry's record."""
    if not credential.registration_number.strip():
        raise RegistryError("Record the registration number first.", field="registration_number")
    if credential.hwr_regulator not in REGULATORS:
        raise RegistryError(
            "Choose the regulator: the Health Worker Registry accepts KMPDC, COC, NCK or PPB.",
            field="hwr_regulator",
        )
    try:
        body = hie_api.call(
            "GET",
            "/professionals",
            transaction_type="PRACTITIONER_LOOKUP",
            organization_id=credential.organization_id,
            platform=True,
            params={
                "identification_type": "registration_number",
                "identification_number": credential.registration_number.strip(),
                "regulator": credential.hwr_regulator,
            },
        )
    except hie_api.HieError as exc:
        if exc.http_status == 404:
            body = {}
        else:
            _fail(exc)
    except hie_api.HieNotConfigured as exc:
        _fail(exc)
    message = body.get("message") if isinstance(body, dict) else None
    credential.hwr_record = message if isinstance(message, dict) else {}
    credential.hwr_checked_at = timezone.now()
    credential.save(update_fields=["hwr_record", "hwr_checked_at", "updated_at"])
    return credential


def practitioner_summary(credential):
    record = credential.hwr_record or {}
    membership = record.get("membership") or {}
    details = record.get("professional_details") or {}
    return {
        "found": bool(record),
        "checked_at": credential.hwr_checked_at.isoformat() if credential.hwr_checked_at else None,
        "full_name": membership.get("full_name", ""),
        "registration_id": membership.get("registration_id", ""),
        "licensing_body": membership.get("licensing_body", ""),
        "is_active": membership.get("is_active"),
        "cadre": details.get("professional_cadre", ""),
        "specialty": details.get("specialty", "") or membership.get("specialty", ""),
        "licenses": [
            {
                "type": lic.get("license_type", ""),
                "start": lic.get("license_start", ""),
                "end": lic.get("license_end", ""),
            }
            for lic in (record.get("licenses") or [])
        ],
        "puid": credential.hwr_puid,
    }


def claim_practitioner_fields(user):
    """The optional practitioner triple SHA claim calls accept, when the treating
    practitioner's registration has been checked against the registry."""
    credential = getattr(user, "practitioner_credential", None) if user else None
    if (
        credential is None
        or not credential.registration_number.strip()
        or credential.hwr_regulator not in REGULATORS
        or not credential.hwr_record
    ):
        return {}
    return {
        "practitioner_identification_type": "registration_number",
        "practitioner_identification_number": credential.registration_number.strip(),
        "practitioner_regulation_body": credential.hwr_regulator,
    }
