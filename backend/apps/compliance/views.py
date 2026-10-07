"""Compliance API — docs/16-DATA-PROTECTION-COMPLIANCE.md."""

from datetime import timedelta

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.client_registry.models import Patient
from apps.notifications.dispatch import notify, org_admins, platform_admins
from apps.notifications.models import Notification
from apps.sysadmin_audit.audit import write_entry
from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import platform_admin_context
from apps.tenancy.models import Organization

from .export import build_patient_export
from .models import (
    BreachIncident,
    BreachNotification,
    DataSubjectRequest,
    PlatformComplianceSettings,
    SupportAccessGrant,
    TenantComplianceProfile,
    breach_tracks,
)


def _clean(instance, **kwargs):
    """Model validation surfaced as a 400 with field messages, never a 500."""
    try:
        instance.full_clean(**kwargs)
    except DjangoValidationError as exc:
        raise ValidationError(exc.message_dict) from None


def _iso(value):
    return value.isoformat() if value else None


def _name(user):
    if not user:
        return ""
    return f"{user.first_name} {user.last_name}".strip() or user.email


def _is_org_admin(user):
    return user.roles.filter(name="Org Admin").exists()


def _require_org_admin(user):
    if user.is_superuser or not _is_org_admin(user):
        raise PermissionDenied("Only the facility's Org Admin can do this.")


def _require_superuser(user):
    if not user.is_superuser:
        raise PermissionDenied("Only platform staff can do this.")


# ── Breach incidents (legal opinion §10) ──


def _track_payload(track):
    return {
        "id": str(track.id),
        "track": track.track,
        "track_label": track.get_track_display(),
        "required": track.required,
        "due_at": _iso(track.due_at),
        "without_delay": track.track == "DATA_SUBJECTS",
        "notified_at": _iso(track.notified_at),
        "notified_by": _name(track.notified_by),
        "method": track.method,
        "reference": track.reference,
        "notes": track.notes,
        "is_overdue": track.is_overdue,
    }


def _incident_payload(incident, detail=False):
    data = {
        "id": str(incident.id),
        "organization_id": str(incident.organization_id),
        "organization_name": incident.organization.name,
        "reference": incident.reference,
        "title": incident.title,
        "reported_role": incident.reported_role,
        "reported_role_label": incident.get_reported_role_display(),
        "became_aware_at": _iso(incident.became_aware_at),
        "risk_level": incident.risk_level,
        "risk_level_label": incident.get_risk_level_display(),
        "status": incident.status,
        "overdue_tracks": sum(1 for t in incident.notifications.all() if t.is_overdue),
        "pending_tracks": sum(
            1 for t in incident.notifications.all() if t.required and not t.notified_at
        ),
    }
    if detail:
        data.update(
            {
                "description": incident.description,
                "occurred_at": _iso(incident.occurred_at),
                "involves_health_data": incident.involves_health_data,
                "data_categories": incident.data_categories,
                "subjects_affected": incident.subjects_affected,
                "containment_actions": incident.containment_actions,
                "reported_by": _name(incident.reported_by),
                "closed_at": _iso(incident.closed_at),
                "tracks": [_track_payload(t) for t in incident.notifications.all()],
            }
        )
    return data


def _sync_tracks(incident):
    """Create/update tracks from the incident's facts. A track already notified
    is never changed."""
    for track, (required, due_at) in breach_tracks(incident).items():
        existing = incident.notifications.filter(track=track).first()
        if existing is None:
            BreachNotification.objects.create(
                organization_id=incident.organization_id,
                incident=incident,
                track=track,
                required=required,
                due_at=due_at,
            )
        elif existing.notified_at is None:
            existing.required = required
            existing.due_at = due_at
            existing.save(update_fields=["required", "due_at", "updated_at"])


def _notify_incident(incident, title, body, dedupe_suffix):
    # Content rule (apps.notifications.dispatch): reference and deadlines only,
    # never a client's name or clinical detail.
    recipients = org_admins(incident.organization_id) + platform_admins()
    notify(
        recipients,
        category=Notification.CATEGORY_SYSTEM,
        severity=Notification.SEVERITY_CRITICAL,
        title=title,
        body=body,
        dedupe_key=f"breach:{incident.id}:{dedupe_suffix}",
        organization_id=incident.organization_id,
        link="/org-admin/breach-incidents",
    )


_INCIDENT_FIELDS = (
    "title",
    "description",
    "occurred_at",
    "involves_health_data",
    "data_categories",
    "subjects_affected",
    "risk_level",
    "containment_actions",
)


def _apply_incident_fields(incident, data):
    for field in _INCIDENT_FIELDS:
        if field in data:
            value = data[field]
            if field == "occurred_at":
                value = parse_datetime(value) if value else None
            if field == "subjects_affected":
                value = int(value) if value not in (None, "") else None
            setattr(incident, field, value)
    if incident.risk_level not in dict(BreachIncident.RISK_CHOICES):
        raise ValidationError({"risk_level": "Choose a risk level."})
    if not incident.title or not incident.description:
        raise ValidationError({"title": "Title and description are required."})


class BreachIncidentsView(APIView):
    def get(self, request):
        user = request.user
        if user.is_superuser:
            with platform_admin_context():
                incidents = list(
                    BreachIncident.all_objects.select_related("organization").prefetch_related(
                        "notifications"
                    )
                )
        else:
            _require_org_admin(user)
            incidents = list(
                BreachIncident.objects.select_related("organization").prefetch_related(
                    "notifications"
                )
            )
        return Response({"results": [_incident_payload(i) for i in incidents]})

    def post(self, request):
        user = request.user
        data = request.data
        if user.is_superuser:
            organization = get_object_or_404(Organization, pk=data.get("organization"))
            role = "PROCESSOR"
        else:
            _require_org_admin(user)
            organization = user.organization
            role = "CONTROLLER"
        became_aware_at = parse_datetime(data.get("became_aware_at") or "") or timezone.now()
        if became_aware_at > timezone.now():
            raise ValidationError({"became_aware_at": "Cannot be in the future."})
        with transaction.atomic(), platform_admin_context():
            count = BreachIncident.all_objects.filter(organization=organization).count() + 1
            incident = BreachIncident(
                organization=organization,
                reference=f"INC-{timezone.localdate():%Y%m%d}-{count:03d}",
                reported_role=role,
                became_aware_at=became_aware_at,
                reported_by=user,
            )
            _apply_incident_fields(incident, data)
            incident.save()
            _sync_tracks(incident)
            _notify_incident(
                incident,
                f"Data breach incident {incident.reference} recorded",
                "Notification deadlines are running. Open the incident to record each "
                "notification as it is made.",
                "created",
            )
        return Response(_incident_payload(incident, detail=True), status=status.HTTP_201_CREATED)


def _incident_for(user, pk):
    if user.is_superuser:
        with platform_admin_context():
            return get_object_or_404(BreachIncident.all_objects, pk=pk)
    _require_org_admin(user)
    return get_object_or_404(BreachIncident, pk=pk)


class BreachIncidentView(APIView):
    def get(self, request, pk):
        incident = _incident_for(request.user, pk)
        with platform_admin_context():
            return Response(_incident_payload(incident, detail=True))

    def patch(self, request, pk):
        incident = _incident_for(request.user, pk)
        with transaction.atomic(), platform_admin_context():
            _apply_incident_fields(incident, request.data)
            new_status = request.data.get("status")
            if new_status:
                if new_status not in dict(BreachIncident.STATUS_CHOICES):
                    raise ValidationError({"status": "Unknown status."})
                if new_status == "CLOSED" and any(
                    t.required and not t.notified_at for t in incident.notifications.all()
                ):
                    raise ValidationError(
                        {"status": "Record every required notification before closing."}
                    )
                incident.status = new_status
                incident.closed_at = timezone.now() if new_status == "CLOSED" else None
            incident.save()
            _sync_tracks(incident)
            return Response(_incident_payload(incident, detail=True))


class BreachNotificationView(APIView):
    """POST — record that a notification on this track was made."""

    def post(self, request, pk):
        user = request.user
        with platform_admin_context():
            track = get_object_or_404(BreachNotification.all_objects, pk=pk)
            incident = track.incident
        if user.is_superuser:
            if track.track != "TENANT_CONTROLLER" and incident.reported_role != "PROCESSOR":
                raise PermissionDenied("The facility records its own regulator notifications.")
        else:
            _require_org_admin(user)
            if incident.organization_id != user.organization_id:
                raise PermissionDenied()
            if track.track == "TENANT_CONTROLLER":
                raise PermissionDenied(
                    "The platform records its own notification to your facility."
                )
        if track.notified_at:
            raise ValidationError({"detail": "This notification is already recorded."})
        notified_at = parse_datetime(request.data.get("notified_at") or "") or timezone.now()
        method = (request.data.get("method") or "").strip()
        if not method:
            raise ValidationError({"method": "Say how the notification was made."})
        with platform_admin_context():
            track.notified_at = notified_at
            track.notified_by = user
            track.method = method
            track.reference = (request.data.get("reference") or "").strip()
            track.notes = (request.data.get("notes") or "").strip()
            track.save()
            return Response(_track_payload(track))


# ── Data subject requests (legal opinion §11) ──


def _request_payload(dsr):
    return {
        "id": str(dsr.id),
        "patient_id": str(dsr.patient_id),
        "patient_name": dsr.patient.get_full_name(),
        "citramac_number": dsr.patient.citramac_number,
        "request_type": dsr.request_type,
        "request_type_label": dsr.get_request_type_display(),
        "received_at": _iso(dsr.received_at),
        "received_in_writing": dsr.received_in_writing,
        "requester": dsr.requester,
        "requester_name": dsr.requester_name,
        "details": dsr.details,
        "logged_by": _name(dsr.logged_by),
        "status": dsr.status,
        "status_label": dsr.get_status_display(),
        "identity_verification": dsr.identity_verification,
        "decided_by": _name(dsr.decided_by),
        "decided_at": _iso(dsr.decided_at),
        "decision_notes": dsr.decision_notes,
        "fulfilled_at": _iso(dsr.fulfilled_at),
        "fulfilled_by": _name(dsr.fulfilled_by),
        "exportable": dsr.request_type in DataSubjectRequest.EXPORTABLE,
    }


class SubjectRequestsView(APIView):
    def get(self, request):
        requests_ = DataSubjectRequest.objects.select_related(
            "patient", "logged_by", "decided_by", "fulfilled_by"
        )
        patient = request.query_params.get("patient")
        if patient:
            requests_ = requests_.filter(patient_id=patient)
        elif not _is_org_admin(request.user):
            raise PermissionDenied("Only the Org Admin can list every data request.")
        return Response({"results": [_request_payload(r) for r in requests_]})

    def post(self, request):
        data = request.data
        patient = get_object_or_404(Patient, pk=data.get("patient"))
        request_type = data.get("request_type")
        if request_type not in dict(DataSubjectRequest.TYPE_CHOICES):
            raise ValidationError({"request_type": "Choose the type of request."})
        requester = data.get("requester") or "SELF"
        if requester == "REPRESENTATIVE" and not (data.get("requester_name") or "").strip():
            raise ValidationError({"requester_name": "Name the authorised representative."})
        received_at = parse_datetime(data.get("received_at") or "") or timezone.now()
        dsr = DataSubjectRequest.objects.create(
            organization=request.user.organization,
            patient=patient,
            request_type=request_type,
            received_at=received_at,
            received_in_writing=bool(data.get("received_in_writing", True)),
            requester=requester,
            requester_name=(data.get("requester_name") or "").strip(),
            details=(data.get("details") or "").strip(),
            logged_by=request.user,
        )
        return Response(_request_payload(dsr), status=status.HTTP_201_CREATED)


class SubjectRequestDecisionView(APIView):
    """POST {decision: APPROVE|DECLINE|FULFIL, identity_verification, notes}."""

    def post(self, request, pk):
        _require_org_admin(request.user)
        dsr = get_object_or_404(DataSubjectRequest.objects.select_related("patient"), pk=pk)
        decision = request.data.get("decision")
        notes = (request.data.get("notes") or "").strip()
        now = timezone.now()
        if decision == "APPROVE":
            verification = (request.data.get("identity_verification") or "").strip()
            if not verification:
                raise ValidationError(
                    {"identity_verification": "Record how the requester's identity was verified."}
                )
            if dsr.status != "RECEIVED":
                raise ValidationError({"detail": "Only a newly received request can be approved."})
            dsr.status = "APPROVED"
            dsr.identity_verification = verification
            dsr.decided_by, dsr.decided_at, dsr.decision_notes = request.user, now, notes
        elif decision == "DECLINE":
            if not notes:
                raise ValidationError({"notes": "Give the reason for declining."})
            if dsr.status in ("FULFILLED", "DECLINED"):
                raise ValidationError({"detail": "This request is already closed."})
            dsr.status = "DECLINED"
            dsr.decided_by, dsr.decided_at, dsr.decision_notes = request.user, now, notes
        elif decision == "FULFIL":
            if dsr.status != "APPROVED":
                raise ValidationError({"detail": "Approve the request before fulfilling it."})
            if dsr.request_type in DataSubjectRequest.EXPORTABLE:
                raise ValidationError(
                    {"detail": "Access and portability requests are fulfilled by the export."}
                )
            if not notes:
                raise ValidationError({"notes": "Describe what was done."})
            dsr.status = "FULFILLED"
            dsr.fulfilled_by, dsr.fulfilled_at = request.user, now
            dsr.decision_notes = "\n".join(filter(None, [dsr.decision_notes, notes]))
        else:
            raise ValidationError({"decision": "Choose APPROVE, DECLINE or FULFIL."})
        dsr.save()
        return Response(_request_payload(dsr))


class SubjectRequestExportView(APIView):
    """GET — the patient's record for an approved access/portability request.
    Marks the request fulfilled and writes an EXPORT audit entry."""

    def get(self, request, pk):
        _require_org_admin(request.user)
        dsr = get_object_or_404(
            DataSubjectRequest.objects.select_related("patient__organization"), pk=pk
        )
        if dsr.request_type not in DataSubjectRequest.EXPORTABLE:
            raise ValidationError({"detail": "Only access and portability requests export."})
        if dsr.status not in ("APPROVED", "FULFILLED"):
            raise ValidationError({"detail": "Approve the request before exporting the record."})
        payload = build_patient_export(dsr)
        write_entry(dsr.patient, AuditLogEntry.ACTION_EXPORT, {"data_subject_request": str(dsr.id)})
        if dsr.status == "APPROVED":
            dsr.status = "FULFILLED"
            dsr.fulfilled_by, dsr.fulfilled_at = request.user, timezone.now()
            dsr.save(update_fields=["status", "fulfilled_by", "fulfilled_at", "updated_at"])
        return Response(payload)


# ── Platform support access (legal opinion §4.2, §6) ──


def _grant_payload(grant):
    return {
        "id": str(grant.id),
        "organization_id": str(grant.organization_id),
        "organization_name": grant.organization.name,
        "requested_by": _name(grant.requested_by),
        "requested_by_email": grant.requested_by.email,
        "requested_at": _iso(grant.created_at),
        "reason": grant.reason,
        "reference": grant.reference,
        "duration_hours": grant.duration_hours,
        "status": grant.display_status,
        "decided_by": _name(grant.decided_by),
        "decided_at": _iso(grant.decided_at),
        "decision_note": grant.decision_note,
        "expires_at": _iso(grant.expires_at),
        "revoked_at": _iso(grant.revoked_at),
        "is_active": grant.is_active,
    }


class SupportGrantsView(APIView):
    def get(self, request):
        user = request.user
        if user.is_superuser:
            with platform_admin_context():
                grants = list(
                    SupportAccessGrant.all_objects.filter(requested_by=user).select_related(
                        "organization", "requested_by", "decided_by"
                    )
                )
                return Response({"results": [_grant_payload(g) for g in grants]})
        _require_org_admin(user)
        # Platform staff rows belong to no tenant, so names are read in
        # platform context — filtered explicitly to this facility's grants.
        with platform_admin_context():
            grants = list(
                SupportAccessGrant.all_objects.filter(
                    organization_id=user.organization_id
                ).select_related("organization", "requested_by", "decided_by")
            )
            return Response({"results": [_grant_payload(g) for g in grants]})

    def post(self, request):
        _require_superuser(request.user)
        data = request.data
        reason = (data.get("reason") or "").strip()
        if not reason:
            raise ValidationError({"reason": "State why access is needed."})
        try:
            hours = int(data.get("duration_hours") or 4)
        except (TypeError, ValueError):
            raise ValidationError({"duration_hours": "Enter a number of hours."}) from None
        if not 1 <= hours <= SupportAccessGrant.MAX_HOURS:
            raise ValidationError(
                {"duration_hours": f"Between 1 and {SupportAccessGrant.MAX_HOURS} hours."}
            )
        with platform_admin_context():
            organization = get_object_or_404(Organization, pk=data.get("organization"))
            grant = SupportAccessGrant.objects.create(
                organization=organization,
                requested_by=request.user,
                reason=reason,
                reference=(data.get("reference") or "").strip(),
                duration_hours=hours,
            )
            notify(
                org_admins(organization.id),
                category=Notification.CATEGORY_SYSTEM,
                severity=Notification.SEVERITY_WARNING,
                title="Platform support is requesting access to your clinical records",
                body="Review the request and approve or decline it.",
                dedupe_key=f"support-grant:{grant.id}:requested",
                organization_id=organization.id,
                link="/org-admin/support-access",
            )
            return Response(_grant_payload(grant), status=status.HTTP_201_CREATED)


class SupportGrantDecisionView(APIView):
    """POST {decision: APPROVE|DECLINE|REVOKE, note} — the facility's Org Admin."""

    def post(self, request, pk):
        _require_org_admin(request.user)
        with platform_admin_context():
            grant = get_object_or_404(
                SupportAccessGrant.all_objects.select_related("organization", "requested_by"),
                pk=pk,
                organization_id=request.user.organization_id,
            )
        decision = request.data.get("decision")
        note = (request.data.get("note") or "").strip()
        now = timezone.now()
        if decision in ("APPROVE", "DECLINE"):
            if grant.status != SupportAccessGrant.STATUS_REQUESTED:
                raise ValidationError({"detail": "This request has already been decided."})
            grant.status = (
                SupportAccessGrant.STATUS_APPROVED
                if decision == "APPROVE"
                else SupportAccessGrant.STATUS_DECLINED
            )
            grant.decided_by, grant.decided_at, grant.decision_note = request.user, now, note
            if decision == "APPROVE":
                grant.expires_at = now + timedelta(hours=grant.duration_hours)
        elif decision == "REVOKE":
            if not grant.is_active:
                raise ValidationError({"detail": "Only an active grant can be revoked."})
            grant.status = SupportAccessGrant.STATUS_REVOKED
            grant.revoked_at, grant.revoked_by = now, request.user
            grant.decision_note = "\n".join(filter(None, [grant.decision_note, note]))
        else:
            raise ValidationError({"decision": "Choose APPROVE, DECLINE or REVOKE."})
        with platform_admin_context():
            grant.save()
            return Response(_grant_payload(grant))


# ── Tenant compliance profile & platform settings (legal opinion §4.3, §5, §6) ──


def _profile_for(organization):
    with platform_admin_context():
        profile, _ = TenantComplianceProfile.all_objects.select_related(
            "organization", "odpc_verified_by", "warranty_accepted_by"
        ).get_or_create(organization=organization)
    return profile


def _profile_payload(profile, platform, evidence_path=None):
    return {
        "organization_id": str(profile.organization_id),
        "organization_name": profile.organization.name,
        "odpc_registration_number": profile.odpc_registration_number,
        "odpc_registration_expires_on": _iso(profile.odpc_registration_expires_on),
        # An authenticated API path, never a public media URL — compliance
        # evidence is downloaded with the caller's token.
        "odpc_evidence_url": (
            evidence_path or f"/compliance/tenants/{profile.organization_id}/evidence/"
            if profile.odpc_evidence
            else None
        ),
        "odpc_verified_by": _name(profile.odpc_verified_by),
        "odpc_verified_at": _iso(profile.odpc_verified_at),
        "dpa_version": profile.dpa_version,
        "dpa_signed_on": _iso(profile.dpa_signed_on),
        "warranty_version": profile.warranty_version,
        "warranty_accepted_at": _iso(profile.warranty_accepted_at),
        "warranty_accepted_by": _name(profile.warranty_accepted_by),
        "current_warranty_version": platform.warranty_version,
        "current_warranty_text": platform.warranty_text,
        "dpo_name": profile.dpo_name,
        "dpo_email": profile.dpo_email,
        "dpo_phone": profile.dpo_phone,
        "gaps": profile.gaps(platform),
    }


OWN_EVIDENCE = "/compliance/profile/evidence/"
EVIDENCE_MAX_BYTES = 10 * 1024 * 1024
EVIDENCE_EXTENSIONS = {"pdf", "png", "jpg", "jpeg"}


class ComplianceProfileView(APIView):
    """The signed-in Org Admin's own facility profile."""

    def get(self, request):
        _require_org_admin(request.user)
        profile = _profile_for(request.user.organization)
        with platform_admin_context():
            return Response(
                _profile_payload(profile, PlatformComplianceSettings.get_solo(), OWN_EVIDENCE)
            )

    def patch(self, request):
        _require_org_admin(request.user)
        profile = _profile_for(request.user.organization)
        for field in ("dpo_name", "dpo_email", "dpo_phone"):
            if field in request.data:
                setattr(profile, field, (request.data.get(field) or "").strip())
        evidence = request.FILES.get("odpc_evidence")
        if evidence is not None:
            if evidence.size > EVIDENCE_MAX_BYTES:
                raise ValidationError({"odpc_evidence": "Evidence must be 10 MB or smaller."})
            if evidence.name.rsplit(".", 1)[-1].lower() not in EVIDENCE_EXTENSIONS:
                raise ValidationError(
                    {"odpc_evidence": "Upload the registration certificate as PDF, PNG or JPEG."}
                )
            profile.odpc_evidence = evidence
            # New evidence must be re-verified by platform staff.
            profile.odpc_verified_at = None
            profile.odpc_verified_by = None
        if "odpc_registration_number" in request.data and not profile.odpc_verified_at:
            profile.odpc_registration_number = (
                request.data.get("odpc_registration_number") or ""
            ).strip()
        with platform_admin_context():
            _clean(profile, exclude=["organization", "odpc_evidence"])
            profile.save()
            return Response(
                _profile_payload(profile, PlatformComplianceSettings.get_solo(), OWN_EVIDENCE)
            )


class AcceptWarrantyView(APIView):
    def post(self, request):
        _require_org_admin(request.user)
        platform = PlatformComplianceSettings.get_solo()
        if not platform.warranty_version:
            raise ValidationError({"detail": "The platform has not published the warranty yet."})
        if request.data.get("version") != platform.warranty_version:
            raise ValidationError({"version": "Accept the current version of the warranty."})
        profile = _profile_for(request.user.organization)
        profile.warranty_version = platform.warranty_version
        profile.warranty_accepted_at = timezone.now()
        profile.warranty_accepted_by = request.user
        with platform_admin_context():
            profile.save()
            return Response(_profile_payload(profile, platform, OWN_EVIDENCE))


class TenantComplianceListView(APIView):
    """Platform staff: every facility's compliance status."""

    def get(self, request):
        _require_superuser(request.user)
        platform = PlatformComplianceSettings.get_solo()
        with platform_admin_context():
            rows = []
            for organization in Organization.objects.order_by("name"):
                rows.append(_profile_payload(_profile_for(organization), platform))
        return Response({"results": rows})


class TenantComplianceView(APIView):
    """Platform staff record the verified registration and agreement facts."""

    def patch(self, request, organization_id):
        _require_superuser(request.user)
        with platform_admin_context():
            organization = get_object_or_404(Organization, pk=organization_id)
            profile = _profile_for(organization)
            data = request.data
            number = (data.get("odpc_registration_number") or "").strip()
            if (
                "odpc_registration_number" in data
                and number != profile.odpc_registration_number
                and not data.get("verify_odpc")
            ):
                # A changed number has not been checked: the old verification
                # no longer applies.
                profile.odpc_verified_at = None
                profile.odpc_verified_by = None
            for field in ("odpc_registration_number", "dpa_version"):
                if field in data:
                    setattr(profile, field, (data.get(field) or "").strip())
            for field in ("odpc_registration_expires_on", "dpa_signed_on"):
                if field in data:
                    setattr(profile, field, data.get(field) or None)
            if data.get("verify_odpc"):
                if not profile.odpc_registration_number:
                    raise ValidationError(
                        {"odpc_registration_number": "Enter the registration number first."}
                    )
                profile.odpc_verified_at = timezone.now()
                profile.odpc_verified_by = request.user
            _clean(profile, exclude=["organization", "odpc_evidence"])
            profile.save()
            return Response(_profile_payload(profile, PlatformComplianceSettings.get_solo()))


class PlatformComplianceSettingsView(APIView):
    def get(self, request):
        _require_superuser(request.user)
        settings_ = PlatformComplianceSettings.get_solo()
        return Response(_platform_payload(settings_))

    def put(self, request):
        _require_superuser(request.user)
        settings_ = PlatformComplianceSettings.get_solo()
        for field in ("dpo_name", "dpo_email", "dpo_phone"):
            if field in request.data:
                setattr(settings_, field, (request.data.get(field) or "").strip())
        version = (request.data.get("warranty_version") or "").strip()
        text = (request.data.get("warranty_text") or "").strip()
        if version or text:
            if not (version and text):
                raise ValidationError({"warranty_version": "Give both a version and the wording."})
            if version == settings_.warranty_version and text != settings_.warranty_text:
                raise ValidationError(
                    {"warranty_version": "Changed wording needs a new version label."}
                )
            settings_.warranty_version, settings_.warranty_text = version, text
        settings_.updated_by = request.user
        _clean(settings_)
        settings_.save()
        return Response(_platform_payload(settings_))


def _platform_payload(settings_):
    return {
        "dpo_name": settings_.dpo_name,
        "dpo_email": settings_.dpo_email,
        "dpo_phone": settings_.dpo_phone,
        "warranty_version": settings_.warranty_version,
        "warranty_text": settings_.warranty_text,
        "updated_at": _iso(settings_.updated_at),
    }


class PublicDpoView(APIView):
    """Public — the platform DPO's contact details (legal opinion §5)."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        settings_ = PlatformComplianceSettings.get_solo()
        return Response(
            {
                "dpo_name": settings_.dpo_name,
                "dpo_email": settings_.dpo_email,
                "dpo_phone": settings_.dpo_phone,
            }
        )


def _evidence_response(profile):
    if not profile.odpc_evidence:
        raise ValidationError({"detail": "No evidence has been uploaded."})
    return FileResponse(
        profile.odpc_evidence.open("rb"),
        as_attachment=True,
        filename=profile.odpc_evidence.name.rsplit("/", 1)[-1],
    )


class OwnEvidenceView(APIView):
    def get(self, request):
        _require_org_admin(request.user)
        return _evidence_response(_profile_for(request.user.organization))


class TenantEvidenceView(APIView):
    def get(self, request, organization_id):
        _require_superuser(request.user)
        with platform_admin_context():
            organization = get_object_or_404(Organization, pk=organization_id)
            return _evidence_response(_profile_for(organization))
