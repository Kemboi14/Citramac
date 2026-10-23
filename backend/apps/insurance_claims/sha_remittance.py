"""
SHA remittances (hie_spec/guides/claims__process__remittances__*.md): "Get
Remittances" takes facility_id + facility_id_type and returns the payment
batches; "Get Claims Paid by Remittance" adds a bank_reference from the first.

VERIFY (hie_spec/SOURCE.md gap 2): neither request path nor any response
field is published. The paths are Super Admin configuration and each answer
is stored verbatim as a ShaRemittanceStatement for finance to read. Nothing
is matched to claims automatically — finance posts each remittance against
its claim (workspace.record_payment, method INSURANCE) as before.
"""

from apps.dha_interop import hie_api
from apps.dha_interop.models import ShaRemittanceStatement

from .sha_eligibility import ShaError, raise_from


def _path(attribute, label):
    path = (getattr(hie_api.platform_settings(), attribute, "") or "").strip()
    if not path:
        raise ShaError(
            f"The {label} path is not configured — DHA has not published it. A Super Admin "
            "enters it under DHA / SHA Integration once DHA supplies it.",
            field=attribute,
        )
    return "/" + path.lstrip("/")


def fetch_remittances(branch, user):
    path = _path("remittance_path", "remittances")
    try:
        body = hie_api.call(
            "GET",
            path,
            transaction_type="REMITTANCE",
            organization_id=branch.organization_id,
            branch=branch,
            params={"facility_id": branch.sha_fr_code, "facility_id_type": "fr-code"},
        )
    except (hie_api.HieError, hie_api.HieNotConfigured) as exc:
        raise_from(exc)
    return ShaRemittanceStatement.objects.create(
        organization_id=branch.organization_id,
        branch_id=branch.id,
        kind="REMITTANCES",
        body=body if isinstance(body, dict) else {"items": body},
        fetched_by_id=getattr(user, "id", None),
    )


def fetch_paid_claims(branch, user, bank_reference):
    bank_reference = (bank_reference or "").strip()
    if not bank_reference:
        raise ShaError("Enter the remittance's bank reference.", field="bank_reference")
    path = _path("remittance_claims_path", "claims-paid-by-remittance")
    try:
        body = hie_api.call(
            "GET",
            path,
            transaction_type="REMITTANCE",
            organization_id=branch.organization_id,
            branch=branch,
            params={
                "facility_id": branch.sha_fr_code,
                "facility_id_type": "fr-code",
                "bank_reference": bank_reference,
            },
        )
    except (hie_api.HieError, hie_api.HieNotConfigured) as exc:
        raise_from(exc)
    return ShaRemittanceStatement.objects.create(
        organization_id=branch.organization_id,
        branch_id=branch.id,
        kind="PAID_CLAIMS",
        bank_reference=bank_reference[:100],
        body=body if isinstance(body, dict) else {"items": body},
        fetched_by_id=getattr(user, "id", None),
    )


def statement_data(statement):
    return {
        "id": str(statement.id),
        "kind": statement.kind,
        "kind_label": statement.get_kind_display(),
        "bank_reference": statement.bank_reference,
        "fetched_at": statement.fetched_at.isoformat(),
        "body": statement.body,
    }
