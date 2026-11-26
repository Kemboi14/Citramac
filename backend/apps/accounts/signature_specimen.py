"""
A clinician's specimen signature (owner decisions 2026-11-26) — drawn once on
their professional profile (My profile) and printed in the signature block of
every document they sign by authenticated click, as "Signed electronically by
… at …" beside the drawing.

- Append-only versions (accounts.SignatureSpecimen): recording a new drawing
  replaces the one in use; nothing is edited or deleted.
- The specimen printed on a document is the one in use when it was signed
  (`created_at <= signed_at`). A document signed before the clinician had a
  specimen, or by someone who never records one, prints the name only.
- Signing is never blocked for want of a specimen.
- Every recording is audited by the trail's save signal, with the image only
  as a fingerprint (`image_png` is in CLINICAL_CONTENT_FIELDS).
"""

import base64
import hashlib

from django.db import transaction

from .models import SignatureSpecimen


def in_use(user, at=None):
    """The specimen `user` had in use at `at` (now when omitted), or None."""
    if user is None or not getattr(user, "pk", None):
        return None
    rows = SignatureSpecimen.all_objects.filter(
        user_id=user.pk, organization_id=user.organization_id
    )
    if at is not None:
        rows = rows.filter(created_at__lte=at)
    return rows.order_by("-created_at").first()


def data_url(specimen):
    if specimen is None:
        return ""
    return "data:image/png;base64," + base64.b64encode(bytes(specimen.image_png)).decode("ascii")


def summary(user):
    """For My profile: the specimen in use (with its image) and how many there were."""
    current = in_use(user)
    return {
        "current": (
            {
                "id": str(current.pk),
                "recorded_at": current.created_at.isoformat(),
                "image": data_url(current),
            }
            if current
            else None
        ),
        "versions": SignatureSpecimen.all_objects.filter(
            user_id=user.pk, organization_id=user.organization_id
        ).count(),
    }


@transaction.atomic
def record(user, image):
    """A new specimen for `user` (their own, drawn by them), replacing the one in
    use. `image` is a `data:image/png;base64,` URL with something drawn on it."""
    from apps.documents.signatures import decode_png

    data = decode_png(image)
    return SignatureSpecimen.objects.create(
        organization_id=user.organization_id,
        user=user,
        image_png=data,
        image_sha256=hashlib.sha256(data).hexdigest(),
    )


def signed_by(user, signed_at, name=""):
    """The signature block of a document `user` signed at `signed_at`: their
    name, when, and the specimen in use then ("" image when there was none)."""
    from apps.care_pathway import facility_time

    if user is not None and not name:
        name = f"{user.first_name} {user.last_name}".strip() or user.email
    specimen = in_use(user, signed_at) if signed_at else None
    return {
        "name": name,
        "image": data_url(specimen),
        "when": facility_time.local_format(signed_at, "%d %b %Y %H:%M") if signed_at else "",
    }
