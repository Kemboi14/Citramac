"""
Professional profile API (apps.accounts.practitioner_profile).

The staff member, under /me/professional-profile/:
    GET, PUT                 read / edit their own profile
    POST submit/             submit it for verification
    POST documents/<kind>/   add files to registration / nacada / indemnity
                             (multipart, one or more `files`)
    POST items/              add a registration, licence, degree, diploma or
                             certificate (multipart, its files as `files`, optional)
    PATCH, DELETE items/<id>/           edit / remove an entry
    POST items/<id>/documents/          add files to an entry
    GET, DELETE files/<document_id>/    download / remove one file
    POST signature/          record a new specimen signature ({"image": PNG data URL});
                             it replaces the one in use, which is kept (2026-11-26)

A reviewer (Org Admin or staff.credentials.verify), under
/staff-credentials/<user_id>/:
    GET                      the staff member's profile
    GET files/<document_id>/ one file (every download is audited)
    POST verify/             verify a submitted profile
    POST return/             return it with what needs changing ({"reason"})
"""

from django.http import FileResponse
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import practitioner_profile as profile


def _staff_only(user):
    if not user.organization_id or user.is_superuser:
        raise PermissionDenied("Only an organisation's staff have a professional profile.")


def _file_response(cred, target, field, document, filename=None):
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
        field.open("rb"),
        as_attachment=False,
        filename=filename or field.name.rsplit("/", 1)[-1],
    )


def _uploads(request):
    """Every file sent, whether as `files` (many) or `file` (one)."""
    return request.FILES.getlist("files") + request.FILES.getlist("file")


def _document_file_response(target, document_id):
    document = profile.document_for(target, document_id)
    where = f"item:{document.item_id}" if document.item_id else document.slot.lower()
    return _file_response(
        document.credential,
        target,
        document.file,
        f"{where}:file:{document.pk}",
        document.original_name or None,
    )


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


class MySignatureSpecimenView(APIView):
    """The staff member's own specimen signature, printed on documents they sign
    (apps.accounts.signature_specimen). Append-only: a new one replaces it."""

    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]

    def post(self, request):
        from . import signature_specimen

        _staff_only(request.user)
        signature_specimen.record(request.user, (request.data or {}).get("image"))
        return Response(profile.detail(request.user), status=201)


class MyProfessionalProfileSubmitView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        _staff_only(request.user)
        profile.submit(request.user)
        return Response(profile.detail(request.user))


class MyProfessionalDocumentView(APIView):
    """Add one or more files to one of the profile's own document slots."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, kind):
        _staff_only(request.user)
        profile.store_document(request.user, kind, _uploads(request))
        return Response(profile.detail(request.user))


class MyProfessionalFileView(APIView):
    """One uploaded file: download it, or take it off the profile."""

    permission_classes = [IsAuthenticated]

    def get(self, request, document_id):
        _staff_only(request.user)
        return _document_file_response(request.user, document_id)

    def delete(self, request, document_id):
        _staff_only(request.user)
        profile.remove_document(request.user, document_id)
        return Response(profile.detail(request.user))


class MyCredentialItemsView(APIView):
    """Add a licence or qualification; its document may come in the same request."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request):
        _staff_only(request.user)
        profile.add_item(request.user, request.data, _uploads(request))
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
    """Add one or more files to an entry."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, item_id):
        _staff_only(request.user)
        profile.store_item_document(request.user, item_id, _uploads(request))
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


class StaffCredentialFileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, user_id, document_id):
        return _document_file_response(_target(request, user_id), document_id)


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
