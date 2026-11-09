"""
The practitioner's professional profile — what each staff member must fill in
for their role, the submit → verify / return workflow, and the one hard rule
that follows from it: a clinician whose recorded practising licence has
expired cannot sign a clinical record.

Owner decisions of 2026-11-05 (CLAUDE.md amendment of that date):

- Staff fill in their own profile after their first sign-in, and are reminded
  (in-app notice + banner) until it is complete and verified. Existing staff are
  asked too.
- On submission every Org Admin and every holder of `staff.credentials.verify`
  is notified; one of them verifies it or returns it with a reason.
- Nothing is blocked while a profile is incomplete or unverified. Signing is
  blocked only when a practising licence with a recorded expiry date has
  expired (`signing_block_reason`).

A practitioner may hold many practising licences, degrees, diplomas and
certificates (2026-11-09): each is a PractitionerCredentialItem with its own
document, and every document the profile asks for has its upload next to it.

FHIR (not emitted in this pass): each licence and qualification is a
`Practitioner.qualification` (identifier, period, issuer = the regulator or
institution), the role `PractitionerRole.code`.
Workforce data, not patient data — no EpisodeOfCare hook. VERIFY (§6): each
regulator's identifier `system` URI; the regulator for each cadre (below).
"""

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

VERIFY_PERMISSION = "staff.credentials.verify"

# The regulator each built-in role is normally registered with, by
# Role.system_key (never by name — an organisation may rename its roles).
# VERIFY (CLAUDE.md §6): proposed mapping awaiting the owner's confirmation —
# notably the radiologist's regulator and the Counsellors and Psychologists
# Board. It only pre-selects the regulator on the form; the practitioner picks
# the body that actually registered them.
ROLE_REGULATOR = {
    "psychiatrist": "KMPDC",
    "doctor": "KMPDC",
    "clinical_officer": "COC",
    "nurse": "NCK",
    "ward_nurse": "NCK",
    "clinical_psychologist": "CPB",
    "therapist": "CPB",
    "counsellor": "CPB",
    "pharmacist": "PPB",
    "lab_technician": "KMLTTB",
    "radiologist": "",
    "clinical_supervisor": "",
    "supervisor": "",
}
# A role the organisation made itself is a clinical one if it can record care.
CLINICAL_PERMISSIONS = ("clinical.care.record", "clinical.medication.prescribe")

# The profile's single documents. Licences and qualifications carry their own
# (PractitionerCredentialItem.evidence).
DOCUMENT_KINDS = {
    "registration": ("registration_evidence", "Registration certificate"),
    "indemnity": ("indemnity_evidence", "Professional indemnity cover"),
    "nacada": ("nacada_evidence", "NACADA accreditation certificate"),
}
ITEM_TEXT_FIELDS = {"title": 150, "issuer": 150, "number": 64}
ITEM_DATE_FIELDS = ("issued_on", "expires_on")
DOCUMENT_MAX_BYTES = 10 * 1024 * 1024
_SIGNATURES = {
    ".pdf": (b"%PDF-",),
    ".png": (b"\x89PNG\r\n\x1a\n",),
    ".jpg": (b"\xff\xd8\xff",),
    ".jpeg": (b"\xff\xd8\xff",),
}

# Fields the practitioner edits themself. Verification stamps and the Mental
# Health Act approval are never among them.
TEXT_FIELDS = {
    "registration_number": 64,
    "registration_body": 150,
    "indemnity_number": 64,
}
DATE_FIELDS = ("indemnity_expires_on",)


def _name(user):
    if not user:
        return ""
    return f"{user.first_name} {user.last_name}".strip() or user.email


def _iso(value):
    return value.isoformat() if value else None


# ── who needs what ──────────────────────────────────────────────────────────


def _roles(user):
    from apps.tenancy.context import platform_admin_context

    with platform_admin_context():
        return list(user.roles.filter(is_active=True).prefetch_related("permissions"))


def credentials_required(user):
    """Whether the user's roles call for a professional registration and licence."""
    if not (user and user.organization_id) or user.is_superuser:
        return False
    cached = getattr(user, "_credentials_required", None)
    if cached is not None:
        return cached
    required = any(
        role.system_key in ROLE_REGULATOR
        or any(p.codename in CLINICAL_PERMISSIONS for p in role.permissions.all())
        for role in _roles(user)
    )
    # Per-object cache: summary() asks several times for the same user.
    user._credentials_required = required
    return required


def suggested_regulators(user):
    found = []
    for role in _roles(user):
        code = ROLE_REGULATOR.get(role.system_key)
        if code and code not in found:
            found.append(code)
    return found


def credential_for(user, create=False):
    from .models import PractitionerCredential

    cred = PractitionerCredential.objects.filter(user=user).first()
    if cred is None and create:
        cred = PractitionerCredential.objects.create(
            user=user, organization_id=user.organization_id
        )
    return cred


def missing_items(user, cred=None):
    """What is still needed before the profile can be submitted, as [{key, label}]."""
    items = []
    if not (user.phone or "").strip():
        items.append({"key": "phone", "label": "Mobile phone number"})
    if not credentials_required(user):
        return items
    cred = cred if cred is not None else credential_for(user)

    def blank(attr):
        return cred is None or not str(getattr(cred, attr) or "").strip()

    def no_file(attr):
        return cred is None or not getattr(cred, attr)

    if blank("regulator"):
        items.append({"key": "regulator", "label": "Regulatory body"})
    elif cred.regulator == "OTHER" and blank("registration_body"):
        items.append({"key": "registration_body", "label": "Name of the regulatory body"})
    if blank("registration_number"):
        items.append({"key": "registration_number", "label": "Registration number"})
    if no_file("registration_evidence"):
        items.append({"key": "registration_evidence", "label": "Registration certificate (upload)"})

    entries = list(cred.active_items()) if cred is not None else []
    licences = [i for i in entries if i.is_licence]
    if not licences:
        items.append({"key": "licence", "label": "A practising licence"})
    if not [i for i in entries if not i.is_licence]:
        items.append(
            {"key": "qualification", "label": "A qualification (degree, diploma or certificate)"}
        )
    for entry in entries:
        name = item_label(entry)
        key = f"item:{entry.pk}"
        if entry.is_licence:
            if not entry.issuer.strip():
                items.append({"key": f"{key}:issuer", "label": f"{name}: who issued it"})
            if not entry.number.strip():
                items.append({"key": f"{key}:number", "label": f"{name}: licence number"})
            if entry.expires_on is None:
                items.append({"key": f"{key}:expires_on", "label": f"{name}: expiry date"})
        elif not entry.title.strip():
            items.append({"key": f"{key}:title", "label": f"{name}: its name"})
        if not entry.evidence:
            items.append({"key": f"{key}:evidence", "label": f"{name} (upload)"})
    today = timezone.localdate()
    for entry in cred.current_licences() if cred is not None else []:
        if entry.expires_on and entry.expires_on < today:
            items.append(
                {
                    "key": f"item:{entry.pk}:current",
                    "label": f"A current practising licence (the one from "
                    f"{entry.issuer or 'your regulator'} expired on {entry.expires_on:%d %b %Y})",
                }
            )
    return items


def item_label(entry):
    """How an entry is named to the person and their reviewers."""
    kind = dict(entry.KIND_CHOICES)[entry.kind]
    if entry.is_licence:
        detail = entry.number.strip() or entry.issuer.strip()
        return f"{kind} {detail}".strip()
    return entry.title.strip() or kind


def signing_block_reason(user):
    """
    Why this user may not sign a clinical record now, or None. Only an expired
    practising licence blocks (owner decision 2026-11-05) — an incomplete or
    unverified profile never does. With several licences, the one in force
    from each regulator counts (a renewal supersedes the licence it replaced);
    any of those having expired blocks.
    """
    if not credentials_required(user):
        return None
    cred = credential_for(user)
    if cred is None:
        return None
    today = timezone.localdate()
    for entry in cred.current_licences():
        if entry.expires_on and entry.expires_on < today:
            source = f" from {entry.issuer}" if entry.issuer.strip() else ""
            return (
                f"Your practising licence{source} expired on {entry.expires_on:%d %b %Y}. "
                "Record your renewed licence in My Profile → Professional profile before signing "
                "clinical records."
            )
    return None


def require_current_licence(user):
    """Raise PermissionDenied when an expired licence bars this user from signing."""
    reason = signing_block_reason(user)
    if reason:
        raise PermissionDenied(reason)


def needs_action(user, cred=None):
    """Whether the user still has something to do on their profile."""
    cred = cred if cred is not None else credential_for(user)
    if missing_items(user, cred):
        return True
    if not credentials_required(user):
        return False
    return cred is None or cred.profile_status in (cred.STATUS_DRAFT, cred.STATUS_RETURNED)


def summary(user):
    """The compact status the banner, My Profile and the staff list read."""
    required = credentials_required(user)
    cred = credential_for(user)
    missing = missing_items(user, cred)
    in_force = cred.current_licences() if cred else []
    return {
        "credentials_required": required,
        "suggested_regulators": suggested_regulators(user) if required else [],
        "status": (cred.profile_status if cred else "DRAFT") if required else None,
        "submitted_at": _iso(cred.submitted_at) if cred else None,
        "returned_reason": cred.returned_reason if cred else "",
        "missing_items": missing,
        "needs_action": needs_action(user, cred),
        # The soonest expiry among the licences in force.
        "licence_expires_on": _iso(in_force[0].expires_on) if in_force else None,
        "licence_status": cred.licence_status if cred else None,
        "nacada_status": cred.nacada_status if cred else None,
        "signing_block": signing_block_reason(user) or "",
    }


def detail(user):
    """Everything on the profile, for the practitioner and their reviewers."""
    from .models import PractitionerCredential, PractitionerCredentialItem

    cred = credential_for(user)
    out = summary(user)
    out["name"] = _name(user)
    out["phone"] = user.phone or ""
    out["regulator_choices"] = [
        {"value": v, "label": label} for v, label in PractitionerCredential.REGULATOR_CHOICES
    ]
    fields = {
        "regulator": "",
        "registration_body": "",
        "registration_number": "",
        "indemnity_number": "",
        "indemnity_expires_on": None,
        "nacada_number": "",
        "nacada_category": "",
        "nacada_issued_on": None,
        "nacada_expires_on": None,
    }
    if cred is not None:
        for key in fields:
            value = getattr(cred, key)
            fields[key] = _iso(value) if hasattr(value, "isoformat") else value
    out["fields"] = fields
    out["verified"] = {
        "registration_at": _iso(cred.registration_verified_at) if cred else None,
        "registration_by": _name(cred.registration_verified_by) if cred else "",
        "nacada_at": _iso(cred.nacada_verified_at) if cred else None,
        "nacada_by": _name(cred.nacada_verified_by) if cred else "",
    }
    out["documents"] = {
        kind: {"label": label, "uploaded": bool(cred and getattr(cred, attr))}
        for kind, (attr, label) in DOCUMENT_KINDS.items()
    }
    out["item_kinds"] = [
        {"value": v, "label": label} for v, label in PractitionerCredentialItem.KIND_CHOICES
    ]
    in_force = {i.pk for i in cred.current_licences()} if cred else set()
    out["items"] = (
        [_item_out(i, i.pk in in_force) for i in cred.active_items().select_related("verified_by")]
        if cred
        else []
    )
    out["reviews"] = (
        [
            {
                "action": r.action,
                "actor": _name(r.actor),
                "at": _iso(r.created_at),
                "reason": r.reason,
            }
            for r in cred.reviews.select_related("actor")[:20]
        ]
        if cred
        else []
    )
    return out


def _item_out(entry, in_force=False):
    return {
        "id": str(entry.pk),
        "kind": entry.kind,
        "label": item_label(entry),
        "title": entry.title,
        "issuer": entry.issuer,
        "number": entry.number,
        "issued_on": _iso(entry.issued_on),
        "expires_on": _iso(entry.expires_on),
        "document_uploaded": bool(entry.evidence),
        "verified_at": _iso(entry.verified_at),
        "verified_by": _name(entry.verified_by),
        # A licence: whether it is the one in force from its regulator, and its state.
        "in_force": in_force if entry.is_licence else None,
        "licence_status": entry.licence_status if entry.is_licence else None,
    }


# ── editing ────────────────────────────────────────────────────────────────


def _parse_date(raw, key):
    from django.utils.dateparse import parse_date

    if raw in (None, ""):
        return None
    value = parse_date(str(raw))
    if value is None:
        raise ValidationError({key: "Use a date (YYYY-MM-DD)."})
    return value


def _back_to_draft(cred):
    if cred.profile_status != cred.STATUS_DRAFT:
        cred.profile_status = cred.STATUS_DRAFT


@transaction.atomic
def update_own(user, data):
    """The practitioner edits their own profile. Changing a number or expiry
    that was verified clears that verification; any change after submission
    sends the profile back to draft, to be submitted again."""
    from .models import PractitionerCredential

    cred = credential_for(user, create=True)
    changed = False
    if "phone" in data:
        phone = str(data.get("phone") or "").strip()[:32]
        if phone != (user.phone or ""):
            user.phone = phone
            user.save(update_fields=["phone"])
    if "regulator" in data:
        regulator = str(data.get("regulator") or "").strip()
        if regulator and regulator not in dict(PractitionerCredential.REGULATOR_CHOICES):
            raise ValidationError({"regulator": "Choose a regulatory body from the list."})
        if regulator != cred.regulator:
            cred.regulator = regulator
            if regulator and regulator != "OTHER":
                cred.registration_body = dict(PractitionerCredential.REGULATOR_CHOICES)[regulator]
            elif regulator == "OTHER":
                cred.registration_body = ""
            cred.registration_verified_at = cred.registration_verified_by = None
            changed = True
    for key, size in TEXT_FIELDS.items():
        if key not in data:
            continue
        if key == "registration_body" and cred.regulator != "OTHER":
            continue  # named by the regulator choice
        value = str(data.get(key) or "").strip()[:size]
        if value == getattr(cred, key):
            continue
        setattr(cred, key, value)
        changed = True
        if key == "registration_number":
            cred.registration_verified_at = cred.registration_verified_by = None
            cred.hwr_record, cred.hwr_checked_at = {}, None
    for key in DATE_FIELDS:
        if key not in data:
            continue
        value = _parse_date(data.get(key), key)
        if value == getattr(cred, key):
            continue
        setattr(cred, key, value)
        changed = True
    nacada = data.get("nacada")
    if isinstance(nacada, dict):
        before = (
            cred.nacada_number,
            cred.nacada_category,
            cred.nacada_issued_on,
            cred.nacada_expires_on,
        )
        nacada = {k: v for k, v in nacada.items() if k != "verified"}
        from apps.care_pathway.legal_views import _apply_nacada

        _apply_nacada(cred, {"nacada": nacada}, user, timezone.now())
        if before != (
            cred.nacada_number,
            cred.nacada_category,
            cred.nacada_issued_on,
            cred.nacada_expires_on,
        ):
            changed = True
            if before[3] != cred.nacada_expires_on:
                cred.nacada_verified_at = cred.nacada_verified_by = None
    if changed:
        _back_to_draft(cred)
    cred.save()
    return cred


def check_upload(upload):
    """A PDF, PNG or JPEG of at most 10 MB whose content is what its name says."""
    if upload is None:
        raise ValidationError({"file": "Choose the document to upload."})
    if upload.size > DOCUMENT_MAX_BYTES:
        raise ValidationError({"file": "The document must be 10 MB or smaller."})
    name = upload.name.lower()
    extension = next((ext for ext in _SIGNATURES if name.endswith(ext)), None)
    if extension is None:
        raise ValidationError({"file": "Upload a PDF, PNG or JPEG."})
    head = upload.read(16)
    upload.seek(0)
    if not head.startswith(_SIGNATURES[extension]):
        raise ValidationError(
            {"file": "The file's content is not a valid " + extension.lstrip(".").upper() + "."}
        )


@transaction.atomic
def store_document(user, kind, upload):
    if kind not in DOCUMENT_KINDS:
        raise ValidationError({"kind": "Unknown document."})
    check_upload(upload)
    cred = credential_for(user, create=True)
    attr = DOCUMENT_KINDS[kind][0]
    setattr(cred, attr, upload)
    if kind == "registration":
        cred.registration_verified_at = cred.registration_verified_by = None
    elif kind == "nacada":
        cred.nacada_verified_at = cred.nacada_verified_by = None
    _back_to_draft(cred)
    cred.save()
    return cred


# ── licences and qualifications (many of each) ─────────────────────────────


def _own_item(user, item_id, cred=None):
    from django.core.exceptions import ValidationError as DjangoValidationError

    cred = cred or credential_for(user)
    if cred is None:
        raise NotFound("No such entry.")
    try:
        return cred.active_items().get(pk=item_id)
    except (cred.items.model.DoesNotExist, DjangoValidationError, ValueError):
        raise NotFound("No such entry.") from None


def _apply_item(entry, data):
    """Copy the editable fields from `data`; True when something changed."""
    changed = False
    for key, size in ITEM_TEXT_FIELDS.items():
        if key in data:
            value = str(data.get(key) or "").strip()[:size]
            if value != getattr(entry, key):
                setattr(entry, key, value)
                changed = True
    for key in ITEM_DATE_FIELDS:
        if key in data:
            value = _parse_date(data.get(key), key)
            if value != getattr(entry, key):
                setattr(entry, key, value)
                changed = True
    if entry.issued_on and entry.issued_on > timezone.localdate():
        raise ValidationError({"issued_on": "Can't be in the future."})
    if entry.issued_on and entry.expires_on and entry.expires_on <= entry.issued_on:
        raise ValidationError({"expires_on": "Must be after the issue date."})
    return changed


def _qualifications_line(cred):
    """`PractitionerCredential.qualifications` — the line the Mental Health Act
    forms print — is written from the qualification entries, never typed
    separately, so the two can't disagree."""
    titles = [
        e.title.strip()
        for e in cred.active_items().exclude(kind=cred.items.model.KIND_LICENCE)
        if e.title.strip()
    ]
    line = ", ".join(dict.fromkeys(titles))[:255]
    if line != cred.qualifications:
        cred.qualifications = line
        cred.save(update_fields=["qualifications", "updated_at"])


@transaction.atomic
def add_item(user, data, upload=None):
    """Add a licence, degree, diploma or certificate — optionally with its document."""
    from .models import PractitionerCredentialItem

    kind = str(data.get("kind") or "").strip()
    if kind not in dict(PractitionerCredentialItem.KIND_CHOICES):
        raise ValidationError({"kind": "Choose a licence, degree, diploma or certificate."})
    if upload is not None:
        check_upload(upload)
    cred = credential_for(user, create=True)
    entry = PractitionerCredentialItem(
        credential=cred, organization_id=cred.organization_id, kind=kind
    )
    _apply_item(entry, data)
    if upload is not None:
        entry.evidence = upload
    entry.save()
    _back_to_draft(cred)
    cred.save()
    _qualifications_line(cred)
    return entry


@transaction.atomic
def update_item(user, item_id, data):
    """Edit an entry. Any change clears its verification and sends the
    profile back to draft, to be submitted again."""
    cred = credential_for(user)
    entry = _own_item(user, item_id, cred)
    if _apply_item(entry, data):
        entry.verified_at = entry.verified_by = None
        entry.save()
        _back_to_draft(cred)
        cred.save()
        _qualifications_line(cred)
    return entry


@transaction.atomic
def store_item_document(user, item_id, upload):
    check_upload(upload)
    cred = credential_for(user)
    entry = _own_item(user, item_id, cred)
    entry.evidence = upload
    entry.verified_at = entry.verified_by = None
    entry.save()
    _back_to_draft(cred)
    cred.save()
    return entry


@transaction.atomic
def remove_item(user, item_id):
    """Take an entry off the profile. The row and its document are kept."""
    cred = credential_for(user)
    entry = _own_item(user, item_id, cred)
    entry.removed_at, entry.removed_by = timezone.now(), user
    entry.save(update_fields=["removed_at", "removed_by", "updated_at"])
    _back_to_draft(cred)
    cred.save()
    _qualifications_line(cred)


def item_for(target, item_id):
    """An entry on `target`'s profile, for download."""
    return _own_item(target, item_id)


# ── workflow ───────────────────────────────────────────────────────────────


def _snapshot(cred):
    return {
        "regulator": cred.regulator,
        "registration_body": cred.registration_body,
        "registration_number": cred.registration_number,
        "qualifications": cred.qualifications,
        "items": [
            {
                "id": str(e.pk),
                "kind": e.kind,
                "title": e.title,
                "issuer": e.issuer,
                "number": e.number,
                "issued_on": _iso(e.issued_on),
                "expires_on": _iso(e.expires_on),
                "document": bool(e.evidence),
            }
            for e in cred.active_items()
        ],
        "indemnity_number": cred.indemnity_number,
        "indemnity_expires_on": _iso(cred.indemnity_expires_on),
        "nacada_number": cred.nacada_number,
        "nacada_expires_on": _iso(cred.nacada_expires_on),
        "documents": sorted(k for k, (a, _) in DOCUMENT_KINDS.items() if getattr(cred, a)),
    }


def _review(cred, action, actor, reason=""):
    from apps.sysadmin_audit.audit import write_event
    from apps.sysadmin_audit.models import AuditLogEntry

    from .models import PractitionerCredentialReview

    review = PractitionerCredentialReview.objects.create(
        organization_id=cred.organization_id,
        credential=cred,
        user=cred.user,
        action=action,
        actor=actor,
        reason=reason,
        snapshot=_snapshot(cred),
    )
    audit_action = {
        PractitionerCredentialReview.ACTION_SUBMITTED: AuditLogEntry.ACTION_CREDENTIAL_SUBMIT,
        PractitionerCredentialReview.ACTION_VERIFIED: AuditLogEntry.ACTION_CREDENTIAL_VERIFY,
        PractitionerCredentialReview.ACTION_RETURNED: AuditLogEntry.ACTION_CREDENTIAL_RETURN,
    }[action]
    write_event(
        cred.organization_id,
        audit_action,
        "accounts.practitionercredential",
        cred.pk,
        {"practitioner": str(cred.user_id), "reason": reason},
    )
    return review


@transaction.atomic
def submit(user):
    from .models import PractitionerCredentialReview

    if not credentials_required(user):
        raise ValidationError(
            {
                "detail": "Your roles don't need a professional registration, so there is "
                "nothing to submit."
            }
        )
    cred = credential_for(user, create=True)
    missing = missing_items(user, cred)
    if missing:
        raise ValidationError(
            {
                "detail": "Complete these before submitting: "
                + "; ".join(item["label"] for item in missing)
                + "."
            }
        )
    if cred.profile_status == cred.STATUS_SUBMITTED:
        raise ValidationError({"detail": "Your profile is already awaiting verification."})
    if cred.profile_status == cred.STATUS_VERIFIED:
        raise ValidationError({"detail": "Your profile is verified. Change it to submit again."})
    cred.profile_status = cred.STATUS_SUBMITTED
    cred.submitted_at = timezone.now()
    cred.returned_reason = ""
    cred.save(update_fields=["profile_status", "submitted_at", "returned_reason", "updated_at"])
    review = _review(cred, PractitionerCredentialReview.ACTION_SUBMITTED, user)
    from .practitioner_notify import profile_submitted

    profile_submitted(cred, review)
    return cred


def may_review(user):
    from .access import has_permission, is_org_admin

    return bool(user and user.organization_id) and (
        is_org_admin(user) or has_permission(user, VERIFY_PERMISSION)
    )


def reviewers(organization_id, exclude=None):
    """Org Admins plus holders of staff.credentials.verify — who is told of a submission."""
    from apps.notifications.dispatch import org_admins

    from .access import users_with_permission

    people = {u.pk: u for u in org_admins(organization_id)}
    for u in users_with_permission([VERIFY_PERMISSION], organization_id):
        people.setdefault(u.pk, u)
    if exclude is not None:
        people.pop(exclude.pk, None)
    return list(people.values())


def _check_reviewer(reviewer, target):
    if not may_review(reviewer):
        raise PermissionDenied(
            "Only an Org Admin or someone allowed to verify staff credentials can do this."
        )
    if target.organization_id != reviewer.organization_id:
        raise PermissionDenied("Not in your organisation.")
    if target.pk == reviewer.pk:
        raise PermissionDenied("Someone else must verify your own professional profile.")


@transaction.atomic
def verify(reviewer, target):
    from .models import PractitionerCredentialReview

    _check_reviewer(reviewer, target)
    cred = credential_for(target)
    if cred is None or cred.profile_status != cred.STATUS_SUBMITTED:
        raise ValidationError({"detail": "Only a submitted profile can be verified."})
    missing = missing_items(target, cred)
    if missing:
        raise ValidationError(
            {"detail": "The profile is missing: " + "; ".join(i["label"] for i in missing) + "."}
        )
    now = timezone.now()
    cred.registration_verified_at, cred.registration_verified_by = now, reviewer
    cred.active_items().filter(verified_at__isnull=True).update(
        verified_at=now, verified_by=reviewer, updated_at=now
    )
    if cred.nacada_number.strip():
        cred.nacada_verified_at, cred.nacada_verified_by = now, reviewer
    cred.profile_status = cred.STATUS_VERIFIED
    cred.returned_reason = ""
    cred.save()
    review = _review(cred, PractitionerCredentialReview.ACTION_VERIFIED, reviewer)
    from .practitioner_notify import profile_reviewed

    profile_reviewed(cred, review)
    return cred


@transaction.atomic
def return_for_changes(reviewer, target, reason):
    from .models import PractitionerCredentialReview

    _check_reviewer(reviewer, target)
    reason = (reason or "").strip()
    if len(reason) < 5:
        raise ValidationError({"reason": "Say what needs changing."})
    cred = credential_for(target)
    if cred is None or cred.profile_status != cred.STATUS_SUBMITTED:
        raise ValidationError({"detail": "Only a submitted profile can be returned."})
    cred.profile_status = cred.STATUS_RETURNED
    cred.returned_reason = reason[:2000]
    cred.save(update_fields=["profile_status", "returned_reason", "updated_at"])
    review = _review(cred, PractitionerCredentialReview.ACTION_RETURNED, reviewer, reason)
    from .practitioner_notify import profile_reviewed

    profile_reviewed(cred, review)
    return cred


def awaiting_verification(organization_id):
    from .models import PractitionerCredential

    return PractitionerCredential.objects.filter(
        organization_id=organization_id,
        profile_status=PractitionerCredential.STATUS_SUBMITTED,
        user__is_active=True,
    )


def clinical_staff_without_submission(organization_id):
    """Active staff whose roles need a registration and who have never submitted."""
    from .models import PractitionerCredential, User

    submitted = PractitionerCredential.objects.filter(
        organization_id=organization_id, submitted_at__isnull=False
    )
    users = User.objects.filter(organization_id=organization_id, is_active=True).exclude(
        pk__in=submitted.values("user_id")
    )
    return [u for u in users if credentials_required(u)]
