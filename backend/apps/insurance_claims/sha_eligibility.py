"""
SHA eligibility and benefits through the DHA HIE
(hie_spec/openapi/eclaims.openapi.json; guides claims__process__eligibility__*).

- check_eligibility: GET /patients/eligibility, by Client Registry ID by
  default ("Use ClientRegistry ID by default … The remaining types are
  fallbacks"). The answer is kept as a ShaEligibilityCheck and mirrored onto
  the client's SHA coverage rows, which the billing clearance gate reads.
- interventions: GET /patients/benefits/interventions for the client, with
  each item cached as a ShaIntervention so claim lines can show its name,
  pre-authorisation flags and required documents. Amounts are never taken
  from the cache — they are resolved live at claim time.
"""

from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from apps.client_registry.models import PatientIdentifier
from apps.dha_interop import hie_api
from apps.dha_interop.registries import CLIENT_REGISTRY_ID_TYPES, client_registry_id

from .models import ShaEligibilityCheck, ShaIntervention

# How long an eligibility answer clears billing before it must be re-checked.
ELIGIBILITY_FRESH_HOURS = 24
# "match POMSF as a prefix … The applicable scheme names are POMSF, TSC and USALAMA."
POMSF_SCHEME_PREFIXES = ("POMSF", "TSC", "USALAMA")


class ShaError(Exception):
    def __init__(self, message, field=None, trace_id=""):
        self.message = message
        self.field = field
        self.trace_id = trace_id
        super().__init__(message)


def raise_from(exc):
    if isinstance(exc, hie_api.HieNotConfigured):
        raise ShaError(str(exc)) from exc
    raise ShaError(exc.describe(), trace_id=exc.trace_id) from exc


def _search_identifier(patient):
    cr_id = client_registry_id(patient)
    if cr_id:
        return "ClientRegistry ID", cr_id
    for kind, id_type in CLIENT_REGISTRY_ID_TYPES.items():
        held = patient.identifiers.filter(kind=kind, superseded_at__isnull=True).first()
        if held:
            return id_type, held.value
    return None, None


def is_pomsf(schemes):
    return any(
        str(s.get("schemeName", "")).upper().startswith(POMSF_SCHEME_PREFIXES) for s in schemes
    )


def _active(schemes):
    active_values = {v.strip().upper() for v in getattr(settings, "SHA_ACTIVE_COVERAGE_STATUSES", [])}
    if not active_values:
        return False
    return any(
        str((s.get("coverage") or {}).get("status", "")).strip().upper() in active_values
        for s in schemes
    )


def check_eligibility(patient, branch, user):
    id_type, number = _search_identifier(patient)
    if not id_type:
        raise ShaError(
            "This client has no identifier SHA can check — look them up in the Client Registry "
            "first, or record their national ID, birth certificate, alien or refugee ID.",
            field="identifier",
        )
    try:
        body = hie_api.call(
            "GET",
            "/patients/eligibility",
            transaction_type="MEMBER_VERIFICATION",
            organization_id=patient.organization_id,
            branch=branch,
            params={"identification_type": id_type, "identification_number": number},
        )
    except (hie_api.HieError, hie_api.HieNotConfigured) as exc:
        if isinstance(exc, hie_api.HieError) and exc.http_status == 404:
            body = {}
        else:
            raise_from(exc)
    body = body if isinstance(body, dict) else {}
    schemes = body.get("schemes") or []
    found = bool(body.get("memberCrNumber"))
    check = ShaEligibilityCheck.objects.create(
        organization=patient.organization,
        patient=patient,
        branch=branch,
        identification_type=id_type,
        found=found,
        active=found and _active(schemes),
        is_alive=body.get("isAlive"),
        member_cr_number=str(body.get("memberCrNumber") or "")[:64],
        whitelisted_for_otp=body.get("whitelistedForOTP"),
        biometrics_enforced=body.get("facilityBiometricsEnforced"),
        pomsf=is_pomsf(schemes),
        schemes=schemes,
        status_code=str(body.get("statusCode") or "")[:16],
        status_desc=str(body.get("statusDesc") or "")[:255],
        checked_by=user,
    )
    member_status = "; ".join(
        f"{s.get('schemeName', '')}: {(s.get('coverage') or {}).get('status', '')}".strip(": ")
        for s in schemes
    )[:100]
    patient.insurance_coverages.filter(scheme_type__startswith="SHA").update(
        sha_verified=found,
        sha_member_status=member_status or check.status_desc[:100],
        sha_premium_compliant=check.active and check.is_alive is not False,
        sha_last_checked_at=timezone.now(),
    )
    return check


def latest_check(patient):
    return patient.sha_eligibility_checks.order_by("-created_at").first()


def fresh_active_check(patient):
    check = latest_check(patient)
    if check is None or not check.active or check.is_alive is False:
        return None
    if timezone.now() - check.created_at > timedelta(hours=ELIGIBILITY_FRESH_HOURS):
        return None
    return check


def check_data(check):
    if check is None:
        return None
    return {
        "id": str(check.id),
        "checked_at": check.created_at.isoformat(),
        "identification_type": check.identification_type,
        "found": check.found,
        "active": check.active,
        "active_rule_configured": bool(getattr(settings, "SHA_ACTIVE_COVERAGE_STATUSES", [])),
        "is_alive": check.is_alive,
        "member_cr_number": check.member_cr_number,
        "whitelisted_for_otp": check.whitelisted_for_otp,
        "biometrics_enforced": check.biometrics_enforced,
        "pomsf": check.pomsf,
        "status_code": check.status_code,
        "status_desc": check.status_desc,
        "schemes": [
            {
                "name": s.get("schemeName", ""),
                "member_type": s.get("memberType", ""),
                "coverage_status": (s.get("coverage") or {}).get("status", ""),
                "coverage_message": (s.get("coverage") or {}).get("message", ""),
                "coverage_reason": (s.get("coverage") or {}).get("reason", ""),
                "possible_solution": (s.get("coverage") or {}).get("possibleSolution", ""),
                "coverage_end": (s.get("coverage") or {}).get("endDate", ""),
                "policy_number": (s.get("policy") or {}).get("number", ""),
            }
            for s in check.schemes or []
        ],
    }


# ── Benefits and interventions ──


def _cache_intervention(item):
    code = str(item.get("code") or "").strip()
    if not code:
        return None
    obj, _ = ShaIntervention.objects.update_or_create(
        code=code[:32],
        defaults={
            "name": str(item.get("name") or "")[:255],
            "benefit_code": str(item.get("benefitCode") or "")[:32],
            "parent_benefit_code": str(item.get("parentBenefitCode") or "")[:32],
            "access_point": str(item.get("accessPoint") or "")[:32],
            "payment_mechanism": str(item.get("paymentMechanism") or "")[:64],
            "fund": str(item.get("fund") or "")[:64],
            "needs_preauth": bool(item.get("needsPreauth")),
            "needs_manual_preauth_approval": bool(item.get("needsManualPreauthApproval")),
            "applicable_document_types": list(item.get("applicableDocumentTypes") or []),
            "required_preauth_document_types": list(item.get("requiredPreauthDocumentTypes") or []),
            "levels_applicable": list(item.get("levelsApplicable") or []),
            "raw": item,
        },
    )
    return obj


def intervention_data(item):
    return {
        "code": item.get("code", ""),
        "name": item.get("name", ""),
        "benefit_code": item.get("benefitCode", ""),
        "parent_benefit_code": item.get("parentBenefitCode", ""),
        "parent_benefit_name": item.get("parentBenefitName", ""),
        "access_point": item.get("accessPoint", ""),
        "payment_mechanism": item.get("paymentMechanism", ""),
        "fund": item.get("fund", ""),
        "needs_preauth": bool(item.get("needsPreauth")),
        "needs_manual_preauth_approval": bool(item.get("needsManualPreauthApproval")),
        "applicable_document_types": item.get("applicableDocumentTypes") or [],
        "required_preauth_document_types": item.get("requiredPreauthDocumentTypes") or [],
        "levels_applicable": item.get("levelsApplicable") or [],
        "overall_tariff": item.get("overallTariff"),
        "active": item.get("active"),
    }


def list_interventions(patient, branch, *, search="", code="", sub_benefit_code="", page=1):
    cr_id = client_registry_id(patient)
    if not cr_id:
        raise ShaError(
            "Look the client up in the Client Registry first — SHA benefits are read by CR ID.",
            field="cr_id",
        )
    params = {"patient_id": cr_id, "page": str(page), "page_size": "50"}
    if search:
        params["search"] = search
    if code:
        params["code"] = code
    if sub_benefit_code:
        params["sub_benefit_code"] = sub_benefit_code
    try:
        body = hie_api.call(
            "GET",
            "/patients/benefits/interventions",
            transaction_type="BENEFITS_LOOKUP",
            organization_id=patient.organization_id,
            branch=branch,
            params=params,
        )
    except (hie_api.HieError, hie_api.HieNotConfigured) as exc:
        raise_from(exc)
    body = body if isinstance(body, dict) else {}
    results = body.get("results") or []
    for item in results:
        _cache_intervention(item)
    return {
        "count": body.get("count", len(results)),
        "page": body.get("currentPage", page),
        "total_pages": body.get("totalPages", 1),
        "results": [intervention_data(i) for i in results],
    }


def resolve_interventions(patient, branch, codes):
    """{code: ShaIntervention} for each code, fetched live for this client so the
    flags are the ones SHA applies to them now. Unknown codes are absent."""
    found = {}
    for code in {c for c in codes if c}:
        listing = list_interventions(patient, branch, code=code)
        for item in listing["results"]:
            if item["code"] == code:
                found[code] = ShaIntervention.objects.get(pk=code)
    return found


def identifier_kinds_searchable():
    return [
        {"kind": kind, "label": dict(PatientIdentifier.KIND_CHOICES)[kind], "type": id_type}
        for kind, id_type in CLIENT_REGISTRY_ID_TYPES.items()
    ]
