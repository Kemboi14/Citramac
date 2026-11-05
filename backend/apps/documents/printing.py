"""
One printed form for every document the system produces (owner decision
2026-11-05): a professional, greyscale A4 layout with the facility
letterhead, a title block, the document's identifiers, a signature block and
a footer with "page x of y" — the same for every organisation, so a document
from any facility looks like it came from a health service, not an app.

- `letterhead()` — the facility as it should appear: name, branch, contacts,
  registration numbers and the organisation's logo converted to greyscale.
- `render()` — Django template → HTML, for the on-screen preview.
- `pdf()` — the same HTML → PDF (WeasyPrint), for Download, for attaching to
  claims, and as the attachment of a FHIR DocumentReference (Kenya Core's
  example uses application/pdf).
- `respond()` — `?output=pdf` downloads the PDF; otherwise the HTML preview,
  served with a CSP that allows no script and no remote fetch.

Nothing is fetched over the network while rendering: the logo is read from our
own media storage and embedded, and the PDF engine refuses every other URL.
"""

import base64
import io
import mimetypes
from functools import lru_cache
from urllib.parse import urlparse

import structlog
from django.conf import settings
from django.core.files.storage import default_storage
from django.http import HttpResponse
from django.template.loader import render_to_string
from django.utils import timezone

logger = structlog.get_logger(__name__)

PREVIEW_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'self'"


# ── letterhead ──────────────────────────────────────────────────────────────


@lru_cache(maxsize=64)
def _greyscale_logo(path, modified):
    """The stored logo as a greyscale data URI (cached per file version)."""
    with default_storage.open(path, "rb") as handle:
        raw = handle.read()
    mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
    if mime == "image/svg+xml":
        # Vector logos are embedded as they are; CSS can't grey them in the PDF engine.
        return f"data:{mime};base64,{base64.b64encode(raw).decode()}"
    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(raw)) as image:
        image.thumbnail((600, 240))
        alpha = image.getchannel("A") if "A" in image.getbands() else None
        grey = ImageOps.grayscale(image.convert("RGB"))
        if alpha is not None:
            grey = Image.merge("LA", (grey, alpha))
        out = io.BytesIO()
        grey.save(out, format="PNG", optimize=True)
    return f"data:image/png;base64,{base64.b64encode(out.getvalue()).decode()}"


def logo_data_uri(logo_url):
    """Our own uploaded logo, greyscale and embedded — or "" (never fetched remotely)."""
    if not logo_url:
        return ""
    media = "/" + settings.MEDIA_URL.strip("/") + "/"
    path = urlparse(logo_url).path
    if not path.startswith(media):
        return ""  # a logo hosted elsewhere is not fetched while rendering
    stored = path[len(media) :]
    try:
        if ".." in stored.split("/") or not default_storage.exists(stored):
            return ""
        return _greyscale_logo(stored, default_storage.get_modified_time(stored).timestamp())
    except Exception:  # noqa: BLE001 — a broken logo must never stop a document printing
        logger.warning("document_logo_unavailable", logo=stored)
        return ""


def letterhead(organization, branch=None, snapshot=None):
    """
    How the facility appears at the top of a document. `snapshot` (the facility
    block frozen into a signed document) wins for names and contacts, so a signed
    document reprints as it was signed; the logo and registration numbers come
    from the organisation and branch.
    """
    snapshot = snapshot or {}
    org_name = organization.name if organization else ""
    name = snapshot.get("organization") or org_name
    # Two snapshot shapes: {"name": org, "branch": ...} (documents) and
    # {"organization": org, "name": branch} (legal_status.facility_profile).
    snapshot_branch = snapshot.get("branch") or (
        snapshot.get("name") if snapshot.get("organization") else ""
    )
    if not snapshot.get("organization") and snapshot.get("name"):
        name = snapshot["name"]
    branch_name = snapshot_branch or (branch.name if branch else "")
    if branch_name == name:
        branch_name = ""
    address = snapshot.get("address") or (branch.address if branch else "")
    contacts = [
        snapshot.get("phone")
        or (branch.phone if branch else "")
        or getattr(organization, "support_phone", ""),
        snapshot.get("email")
        or (branch.email if branch else "")
        or getattr(organization, "support_email", ""),
        snapshot.get("website") or getattr(organization, "website", ""),
    ]
    identifiers = []
    if branch is not None:
        for label, attr in (
            ("KMPDC reg. no.", "kmpdc_registration_number"),
            ("Facility licence", "facility_license_number"),
            ("SHA facility code", "sha_fr_code"),
        ):
            value = getattr(branch, attr, "")
            if value:
                identifiers.append({"label": label, "value": value})
    return {
        "name": name or snapshot.get("name") or "",
        "branch": branch_name,
        "address": address,
        "contacts": [c for c in contacts if c],
        "identifiers": identifiers,
        "logo": logo_data_uri(getattr(organization, "logo_url", "")),
    }


def default_branch(organization):
    from apps.tenancy.models import Branch

    if organization is None:
        return None
    return (
        Branch.all_objects.filter(organization=organization, is_active=True)
        .order_by("created_at")
        .first()
    )


# ── rendering ───────────────────────────────────────────────────────────────


def render(template, context):
    """A document template (extending documents/print/base.html) → HTML."""
    from apps.care_pathway import facility_time

    base = {
        "printed_at": facility_time.local_format(timezone.now(), "%d %b %Y %H:%M"),
    }
    return render_to_string(template, {**base, **context})


def pdf(html):
    """The HTML as a PDF (A4, page size and margins from the template's @page).
    Only embedded data: images load — no file, http or any other URL."""
    from weasyprint import HTML, URLFetcher

    fetcher = URLFetcher(allowed_protocols={"data"}, allow_redirects=False, timeout=1)
    return HTML(string=html, url_fetcher=fetcher).write_pdf()


def safe_filename(*parts):
    stem = "-".join(str(p) for p in parts if p)
    cleaned = "".join(ch if ch.isalnum() or ch in "-_." else "-" for ch in stem)
    return (cleaned.strip("-") or "document")[:120]


def wants_pdf(request):
    return request.query_params.get("output") == "pdf"


def respond(request, html, filename):
    """`?output=pdf` → the PDF as a download; anything else → the HTML preview.
    (Not `?format=`: the REST framework reserves that for its own renderers.)"""
    if wants_pdf(request):
        response = HttpResponse(pdf(html), content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="{safe_filename(filename)}.pdf"'
    else:
        response = HttpResponse(html, content_type="text/html; charset=utf-8")
        response["Content-Security-Policy"] = PREVIEW_CSP
    response["Cache-Control"] = "no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response
