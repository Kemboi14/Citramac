"""Document generation API (master prompt §6). Mounted at /api/v1/documents/."""

from datetime import datetime, time

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.client_registry.models import ConsentRecord, Patient
from apps.sysadmin_audit.audit import log_view, write_event

from . import catalogue, workflow
from .models import DisclosureRecord, DocumentEvent, GeneratedDocument


def _iso(value):
    return value.isoformat() if value else None


def _user(user):
    if not user:
        return ""
    return f"{user.first_name} {user.last_name}".strip() or user.email


def _spec_or_404(template_id):
    spec = catalogue.get(template_id)
    if spec is None:
        raise ValidationError({"template_id": "Unknown document type."})
    return spec


def _summary(spec, user):
    return {
        "documentId": spec["documentId"],
        "name": spec["name"],
        "category": spec["category"],
        "categoryName": spec["categoryName"],
        "tags": spec["tags"],
        "trigger": spec["trigger"],
        "highRisk": spec["highRisk"],
        "contentStatus": (
            "READY"
            if workflow.content_ready(spec, organization=getattr(user, "organization", None))
            else "VERIFY"
        ),
        "recipientTypes": spec["disclosureRules"]["recipientTypes"],
        "can_generate": workflow.can(user, spec, "generate"),
    }


class CatalogueView(APIView):
    """GET ?q=&category= — DOC-UX categories, documents and search."""

    def get(self, request):
        q = request.query_params.get("q", "")
        category = request.query_params.get("category", "")
        results = catalogue.search(q, category)
        all_specs = catalogue.templates().values()
        return Response(
            {
                "version": catalogue.CATALOGUE_VERSION,
                "total": len(catalogue.templates()),
                "categories": [
                    {
                        "code": code,
                        "name": name,
                        "count": sum(1 for s in all_specs if s["category"] == code),
                    }
                    for code, name in catalogue.CATEGORIES
                ],
                "results": [_summary(spec, request.user) for spec in results],
                "data_classes": [
                    {"code": c, "name": n}
                    for c, n in catalogue.DATA_CLASSES
                    if c not in catalogue.NEVER_DISCLOSED
                ],
                "recipient_types": {k: v["label"] for k, v in catalogue.RECIPIENT_TYPES.items()},
                "referral_destinations": catalogue.REFERRAL_DESTINATIONS,
            }
        )


class TemplateDetailView(APIView):
    """GET the full DOC-SPEC (all 10 fields) plus this user's permissions."""

    def get(self, request, template_id):
        spec = _spec_or_404(template_id)
        return Response(
            {
                **{k: v for k, v in spec.items()},
                "permissions": {
                    a: workflow.can(request.user, spec, a)
                    for a in ("generate", "review", "approve", "sign", "release")
                },
            }
        )


def _patient(pk):
    return get_object_or_404(Patient, pk=pk)


def _doc_payload(doc, spec, user, full=True):
    base = {
        "id": str(doc.id),
        "document_number": doc.document_number,
        "series_id": str(doc.series_id),
        "template_id": doc.template_id,
        "name": spec["name"],
        "category": spec["category"],
        "categoryName": spec["categoryName"],
        "version": doc.version,
        "status": doc.status,
        "status_label": doc.get_status_display(),
        "patient_id": str(doc.patient_id),
        "patient_name": doc.patient.get_full_name(),
        "recipient_type": doc.recipient_type,
        "recipient_name": doc.recipient_name,
        "recipient_organization": doc.recipient_organization,
        "purpose": doc.purpose,
        "author": _user(doc.author),
        "generated_at": _iso(doc.generated_at),
        "signed_by": _user(doc.signed_by),
        "signed_at": _iso(doc.signed_at),
        "high_risk": spec["highRisk"],
        "content_status": "READY" if workflow.content_ready(spec, doc) else "VERIFY",
        "source": spec.get("source", ""),
        # LGL-DOC-05: the signed statutory form this release record points at;
        # its content and print come from the legal module.
        "legal_document_id": str(doc.legal_document_id) if doc.legal_document_id else None,
    }
    if not full:
        return base
    events = DocumentEvent.objects.filter(document=doc).select_related("actor")
    disclosures = DisclosureRecord.objects.filter(document=doc).select_related("released_by")
    versions = GeneratedDocument.objects.filter(series_id=doc.series_id).order_by("version")
    base.update(
        {
            "episode_id": str(doc.episode_id) if doc.episode_id else None,
            "inputs": doc.inputs,
            "content": doc.content,
            "rule_trace": doc.rule_trace,
            "included_classes": doc.included_classes,
            "excluded_classes": doc.excluded_classes,
            "security_labels": doc.security_labels,
            "block": doc.block_detail,
            "blocked_from": doc.blocked_from,
            "consent_record_id": str(doc.consent_record_id) if doc.consent_record_id else None,
            "reviewed_by": _user(doc.reviewed_by),
            "reviewed_at": _iso(doc.reviewed_at),
            "signer_credentials": doc.signer_credentials,
            "content_hash": doc.content_hash,
            "filed_at": _iso(doc.filed_at),
            "correction_reason": doc.correction_reason,
            "supersedes_id": str(doc.supersedes_id) if doc.supersedes_id else None,
            "watermark": (
                ""
                if doc.status in ("SIGNED", "RELEASED", "FILED")
                else "DRAFT — CLINICIAN REVIEW REQUIRED"
            ),
            "allowed_actions": workflow.allowed_actions(doc, spec, user),
            "user_fields": spec["userEntered"],
            "disclosure_rules": spec["disclosureRules"]["perRecipient"],
            "outputs": spec["outputs"],
            "verify_note": spec["verifyNote"],
            "versions": [
                {
                    "id": str(v.id),
                    "version": v.version,
                    "status": v.status,
                    "status_label": v.get_status_display(),
                }
                for v in versions
            ],
            "events": [
                {
                    "id": str(e.id),
                    "action": e.action,
                    "from": e.from_status,
                    "to": e.to_status,
                    "actor": _user(e.actor),
                    "roles": e.actor_roles,
                    "at": _iso(e.at),
                    "reason": e.reason,
                }
                for e in events
            ],
            "disclosures": [_disclosure_payload(d) for d in disclosures],
            **_signature_payload(doc, spec),
        }
    )
    return base


def _signature_payload(doc, spec):
    """A consent document's party signatures (images only on the print view)."""
    from apps.client_registry.models import EmergencyContact

    from . import signatures

    if not signatures.is_consent_document(spec):
        return {"signature_requirements": [], "party_signatures": [], "signature_roles": []}
    current = signatures.content_sha256(doc.content)
    return {
        "signature_requirements": signatures.document_requirements(doc, spec),
        "party_signatures": [
            signatures.signature_row(row, current) for row in doc.party_signatures.all()
        ],
        "signature_roles": [
            {"code": r, "label": signatures.ROLE_LABELS[r]}
            for r in signatures.allowed_roles(doc, spec)
            if r != "WITNESS"
        ],
        "client_is_minor": signatures._is_minor(doc.patient),
        "contacts": [
            {
                "id": str(c.pk),
                "name": c.name,
                "relationship": c.relationship,
                "is_guardian": c.is_guardian,
            }
            for c in EmergencyContact.objects.filter(patient=doc.patient)
        ],
        "wording": (doc.content or {}).get("wording"),
    }


def _disclosure_payload(d):
    return {
        "id": str(d.id),
        "document_number": d.document_number,
        "version": d.document_version,
        "template_id": d.template_id,
        "recipient_type": d.recipient_type,
        "recipient_name": d.recipient_name,
        "recipient_organization": d.recipient_organization,
        "purpose": d.purpose,
        "channel": d.get_channel_display(),
        "legal_basis": d.legal_basis,
        "legal_basis_reference": d.legal_basis_reference,
        "consent_record_id": str(d.consent_record_id) if d.consent_record_id else None,
        "classes_disclosed": d.classes_disclosed,
        "released_by": _user(d.released_by),
        "released_by_roles": d.released_by_roles,
        "released_at": _iso(d.released_at),
        "content_hash": d.content_hash,
    }


class GeneratedListView(APIView):
    """GET ?patient= — documents this user may see; POST — generate a draft."""

    def get(self, request):
        qs = GeneratedDocument.objects.select_related("patient", "author", "signed_by")
        patient_id = request.query_params.get("patient")
        if patient_id:
            qs = qs.filter(patient_id=patient_id)
        rows = []
        for doc in qs[:200]:
            spec = catalogue.get(doc.template_id)
            if spec and workflow.can(request.user, spec, "view"):
                rows.append(_doc_payload(doc, spec, request.user, full=False))
        return Response({"results": rows})

    def post(self, request):
        spec = _spec_or_404(request.data.get("template_id"))
        patient = _patient(request.data.get("patient_id"))
        doc = workflow.generate(spec, patient, request.user, request.data)
        log_view(doc)
        return Response(_doc_payload(doc, spec, request.user), status=status.HTTP_201_CREATED)


def _doc(pk, user, action="view"):
    doc = get_object_or_404(
        GeneratedDocument.objects.select_related("patient", "author", "signed_by", "reviewed_by"),
        pk=pk,
    )
    spec = catalogue.get(doc.template_id)
    if not workflow.can(user, spec, "view"):
        raise PermissionDenied("Your role may not open this document.")
    return doc, spec


class GeneratedDetailView(APIView):
    def get(self, request, pk):
        doc, spec = _doc(pk, request.user)
        log_view(doc)  # AuditEvent on every access to psychiatric content (guide.md §4)
        return Response(_doc_payload(doc, spec, request.user))

    def patch(self, request, pk):
        doc, spec = _doc(pk, request.user)
        doc = workflow.edit(doc, spec, request.user, request.data)
        return Response(_doc_payload(doc, spec, request.user))


class GeneratedTransitionView(APIView):
    def post(self, request, pk):
        doc, spec = _doc(pk, request.user)
        action = request.data.get("action") or ""
        doc = workflow.transition(doc, spec, request.user, action, request.data)
        code = status.HTTP_201_CREATED if action == "amend" else status.HTTP_200_OK
        if doc.status == "BLOCKED_CONSENT" and action == "release":
            code = status.HTTP_409_CONFLICT
        return Response(_doc_payload(doc, spec, request.user), status=code)


class GeneratedSignatureView(APIView):
    """POST one party's signature, with the staff witness's, on a consent document."""

    def post(self, request, pk):
        from . import signatures

        doc, spec = _doc(pk, request.user)
        signatures.sign_document(doc, spec, request.user, request.data)
        doc.refresh_from_db()
        return Response(_doc_payload(doc, spec, request.user), status=status.HTTP_201_CREATED)


class GeneratedConsentFhirView(APIView):
    """GET a signed consent document as FHIR R4 (Consent + signature Provenance)."""

    def get(self, request, pk):
        from . import consent_fhir, signatures

        doc, spec = _doc(pk, request.user)
        if not signatures.is_consent_document(spec):
            raise ValidationError({"detail": "Only consent documents are exported as a Consent."})
        try:
            bundle = consent_fhir.build_document_consent_bundle(doc)
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)}) from None
        write_event(
            doc.organization_id,
            "VIEW",
            "documents.generateddocument",
            doc.pk,
            {"output": "fhir"},
        )
        return Response(bundle)


class DisclosureListView(APIView):
    """GET ?patient= — the chart's disclosure log (DOC-GOV-06)."""

    def get(self, request):
        patient_id = request.query_params.get("patient")
        if not patient_id:
            raise ValidationError({"patient": "Required."})
        rows = DisclosureRecord.objects.filter(patient_id=patient_id).select_related("released_by")
        visible = []
        for d in rows:
            spec = catalogue.get(d.template_id)
            if spec and workflow.can(request.user, spec, "view"):
                visible.append(_disclosure_payload(d))
        write_event(
            request.user.organization_id,
            "VIEW",
            "documents.disclosurerecord",
            patient_id,
            {"count": len(visible)},
        )
        return Response({"results": visible})


RELEASE_CONSENT_TYPES = [
    "EMPLOYER_COMMUNICATION",
    "SCHOOL_COMMUNICATION",
    "RELEASE_OF_INFORMATION",
    "FAMILY_INVOLVEMENT",
]
AUTHORIZATION_RECORDERS = ["CLINICAL_STAFF", "RELEASE_OFFICERS", "ADMIN_STAFF"]


def _consent_payload(r):
    return {
        "id": str(r.id),
        "consent_type": r.consent_type,
        "consent_type_label": r.get_consent_type_display(),
        "decision": r.decision,
        "decision_label": r.get_decision_display(),
        "recipient": r.recipient,
        "purpose": r.purpose,
        "disclosure_scope": r.disclosure_scope,
        "valid_until": _iso(r.valid_until),
        "captured_at": _iso(r.captured_at),
        "captured_by": _user(r.captured_by),
        "consent_text_version": r.consent_text_version,
    }


def _facility_wording(consent_type):
    from apps.care_pathway.models import ConsentTemplate

    return ConsentTemplate.objects.filter(consent_type=consent_type, active=True).first()


class ReleaseAuthorizationView(APIView):
    """GET ?patient= / POST — record the client's authorization for release
    (the prompt raised by DOC-CI-06). Written to the one consent store
    (client_registry.ConsentRecord)."""

    def get(self, request):
        patient = _patient(request.query_params.get("patient"))
        rows = ConsentRecord.objects.filter(
            patient=patient, consent_type__in=RELEASE_CONSENT_TYPES
        ).select_related("captured_by")
        # The client is named in the query string, so the per-client read audit
        # (which keys on the URL) doesn't see this read; record it here.
        log_view(patient)
        return Response(
            {
                "results": [_consent_payload(r) for r in rows],
                # The facility's own wording per type, where an Org Admin has
                # published one — shown to the client before recording.
                "wording": {
                    t: {"version": tpl.version, "text": tpl.text}
                    for t in RELEASE_CONSENT_TYPES
                    if (tpl := _facility_wording(t)) is not None
                },
            }
        )

    def post(self, request):
        from apps.client_registry.consent import capture_consent

        if not workflow.in_groups(request.user, AUTHORIZATION_RECORDERS):
            raise PermissionDenied("Your role may not record release authorizations.")
        data = request.data
        patient = _patient(data.get("patient_id"))
        errors = {}
        consent_type = data.get("consent_type")
        if consent_type not in RELEASE_CONSENT_TYPES:
            errors["consent_type"] = "Choose the type of authorization."
        decision = data.get("decision") or "YES"
        if decision not in ("YES", "NO"):
            errors["decision"] = "Record YES or NO."
        scope = data.get("disclosure_scope") or []
        valid = {c for c, _ in catalogue.DATA_CLASSES} - set(catalogue.NEVER_DISCLOSED)
        if not isinstance(scope, list) or any(c not in valid for c in scope):
            errors["disclosure_scope"] = "Unknown information class."
        evidence = (data.get("evidence") or "").strip()
        if not evidence:
            errors["evidence"] = (
                "Say how the authorization was obtained (e.g. the signed form's reference)."
            )
        valid_until = None
        if data.get("valid_until"):
            try:
                day = datetime.fromisoformat(str(data["valid_until"])).date()
            except ValueError:
                errors["valid_until"] = "Use YYYY-MM-DD."
            else:
                valid_until = timezone.make_aware(datetime.combine(day, time.max))
        if errors:
            raise ValidationError(errors)
        recipient = (data.get("recipient") or "").strip()
        purpose = (data.get("purpose") or "").strip()
        structured = (
            f"Structured authorization record. Type: {consent_type}. Decision: {decision}. "
            f"Recipient: {recipient or 'any recipient of this type'}. Purpose: {purpose or '-'}. "
            f"Information: {', '.join(scope) or 'none beyond the default'}. "
            f"Valid until: {valid_until.date().isoformat() if valid_until else 'not stated'}. "
            f"Evidence: {evidence}."
        )
        template = _facility_wording(consent_type)
        if template is not None:
            # The facility's published wording is what the client was shown;
            # the record snapshots it with its version (plus the structured
            # scope, so both what was read and what was chosen are kept).
            text_version, snapshot = template.version, f"{template.text}\n\n{structured}"
        else:
            # No facility wording for this type: the snapshot is the structured
            # scope that was authorized — never invented legal text.
            text_version, snapshot = "STRUCTURED-SCOPE-1", structured
        record = capture_consent(
            patient,
            request.user,
            decision == "YES",
            text_version,
            snapshot,
            consent_type=consent_type,
            decision=decision,
            purpose=purpose[:255],
            valid_until=valid_until,
            recipient=recipient[:255],
            disclosure_scope=scope,
        )
        return Response(_consent_payload(record), status=status.HTTP_201_CREATED)
