"""
Professional profile API (apps.accounts.practitioner_profile).

The staff member, under /me/professional-profile/:
    GET, PUT                 read / edit their own profile
    POST submit/             submit it for verification
    GET, POST documents/<kind>/   download / upload a document
    POST items/              add a licence, degree, diploma or certificate
                             (multipart, its document as `file`, optional)
    PATCH, DELETE items/<id>/          edit / remove an entry
    GET, POST items/<id>/document/     download / upload an entry's document

A reviewer (Org Admin or staff.credentials.verify), under
/staff-credentials/<user_id>/:
    GET                      the staff member's profile
    GET documents/<kind>/    a document (every download is audited)
    GET items/<id>/document/ an entry's document (audited)
    POST verify/             verify a submitted profile
    POST return/             return it with what needs changing ({"reason"})
"""

from django.http import FileResponse
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import practitioner_profile as profile


def _staff_only(user):
    if not user.organization_id or user.is_superuser:
        raise PermissionDenied("Only an organisation's staff have a professional profile.")


def _file_response(cred, target, field, document):
    from apps.sysadmin_audit.audit import write_event
    from apps.sysadmin_audit.models import AuditLogEntry

    write_event(
        cred.organization_id,
        AuditLogEntry.ACTION_VIEW,
        "accounts.practitionercredential",
        cred.pk,
        {"document": document, "practitioner": str(target.pk)},
    )
    return FileResponse(
        field.open("rb"), as_attachment=False, filename=field.name.rsplit("/", 1)[-1]
    )


def _document_response(request, target, kind):
    if kind not in profile.DOCUMENT_KINDS:
        raise NotFound("Unknown document.")
    cred = profile.credential_for(target)
    attr = profile.DOCUMENT_KINDS[kind][0]
    if cred is None or not getattr(cred, attr):
        raise NotFound("No document uploaded.")
    return _file_response(cred, target, getattr(cred, attr), kind)


def _item_document_response(request, target, item_id):
    entry = profile.item_for(target, item_id)
    if not entry.evidence:
        raise NotFound("No document uploaded.")
    return _file_response(entry.credential, target, entry.evidence, f"item:{entry.pk}")


class MyProfessionalProfileView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]

    def get(self, request):
        _staff_only(request.user)
        return Response(profile.detail(request.user))

    def put(self, request):
        _staff_only(request.user)
        if not isinstance(request.data, dict):
            raise ValidationError({"detail": "Send the profile fields as an object."})
        profile.update_own(request.user, request.data)
        return Response(profile.detail(request.user))


class MyProfessionalProfileSubmitView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        _staff_only(request.user)
        profile.submit(request.user)
        return Response(profile.detail(request.user))


class MyProfessionalDocumentView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request, kind):
        _staff_only(request.user)
        return _document_response(request, request.user, kind)

    def post(self, request, kind):
        _staff_only(request.user)
        profile.store_document(request.user, kind, request.FILES.get("file"))
        return Response(profile.detail(request.user))


class MyCredentialItemsView(APIView):
    """Add a licence or qualification; its document may come in the same request."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request):
        _staff_only(request.user)
        profile.add_item(request.user, request.data, request.FILES.get("file"))
        return Response(profile.detail(request.user), status=201)


class MyCredentialItemView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]

    def patch(self, request, item_id):
        _staff_only(request.user)
        if not isinstance(request.data, dict):
            raise ValidationError({"detail": "Send the entry's fields as an object."})
        profile.update_item(request.user, item_id, request.data)
        return Response(profile.detail(request.user))

    def delete(self, request, item_id):
        _staff_only(request.user)
        profile.remove_item(request.user, item_id)
        return Response(profile.detail(request.user))


class MyCredentialItemDocumentView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request, item_id):
        _staff_only(request.user)
        return _item_document_response(request, request.user, item_id)

    def post(self, request, item_id):
        _staff_only(request.user)
        profile.store_item_document(request.user, item_id, request.FILES.get("file"))
        return Response(profile.detail(request.user))


def _target(request, user_id):
    from .models import User

    if not profile.may_review(request.user):
        raise PermissionDenied(
            "Only an Org Admin or someone allowed to verify staff credentials can see this."
        )
    target = get_object_or_404(User, pk=user_id)
    if target.organization_id != request.user.organization_id:
        raise PermissionDenied("Not in your organisation.")
    return target


class StaffCredentialView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, user_id):
        target = _target(request, user_id)
        out = profile.detail(target)
        out["can_review"] = target.pk != request.user.pk
        return Response(out)


class StaffCredentialDocumentView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, user_id, kind):
        return _document_response(request, _target(request, user_id), kind)


class StaffCredentialItemDocumentView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, user_id, item_id):
        return _item_document_response(request, _target(request, user_id), item_id)


class StaffCredentialVerifyView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, user_id):
        target = _target(request, user_id)
        profile.verify(request.user, target)
        return Response(profile.detail(target))


class StaffCredentialReturnView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, user_id):
        target = _target(request, user_id)
        profile.return_for_changes(request.user, target, request.data.get("reason"))
        return Response(profile.detail(target))
