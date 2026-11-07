"""
One printed form for every document the system produces (owner decisions
2026-11-05, colour 2026-11-07): a professional A4 layout with the facility
letterhead, a title block, the document's identifiers, a signature block and
a footer with "page x of y". The layout is the same for every organisation;
its accent colour is the organisation's own theme (`brand_colours()`), and
body text stays black on white so it reads and photocopies cleanly.

- `letterhead()` — the facility as it should appear: name, branch, contacts,
  registration numbers, the organisation's logo in its own colours and its
  brand colours.
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
import re
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


DEFAULT_BRAND = "#006e51"  # the product's default primary (frontend themeTokens)
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def _rgb(hex_colour):
    return tuple(int(hex_colour[i : i + 2], 16) for i in (1, 3, 5))


def _hex(rgb):
    return "#" + "".join(f"{max(0, min(255, round(c))):02x}" for c in rgb)


def _mix(colour, other, weight):
    """`colour` moved `weight` (0–1) of the way towards `other`."""
    a, b = _rgb(colour), _rgb(other)
    return _hex(x + (y - x) * weight for x, y in zip(a, b, strict=True))


def _luminance(colour):
    def channel(c):
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (channel(c) for c in _rgb(colour))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast_on_white(colour):
    return 1.05 / (_luminance(colour) + 0.05)


def _readable(colour, minimum=4.5):
    """`colour`, darkened only as far as needed to read as text on white paper."""
    for step in range(0, 101, 5):
        candidate = _mix(colour, "#000000", step / 100)
        if _contrast_on_white(candidate) >= minimum:
            return candidate
    return "#000000"


def _theme_colour(theme, key):
    value = ((theme or {}).get("light") or {}).get(key) if isinstance(theme, dict) else None
    return value.lower() if isinstance(value, str) and _HEX.match(value) else ""


def brand_colours(organization):
    """
    The organisation's accent for its documents, from the same theme the app
    uses (light palette): its own theme, else the colour on its branded login,
    else the platform theme, else the product default. Every value is a
    validated #rrggbb, so it can go straight into the stylesheet.

    - `accent` — rules and borders (the brand colour as chosen)
    - `text` — headings in the brand colour, darkened if needed to read on white
    - `tint` — a pale wash of it, behind table headings
    """
    theme = getattr(organization, "theme_overrides", None)
    primary = _theme_colour(theme, "primary")
    if not primary:
        login = (getattr(organization, "primary_color", "") or "").lower()
        if _HEX.match(login) and login != DEFAULT_BRAND:
            primary = login
    if not primary:
        try:
            from apps.tenancy.models import PlatformBranding

            primary = _theme_colour(PlatformBranding.get_solo().theme_overrides, "primary")
        except Exception:  # noqa: BLE001 — branding must never stop a document printing
            primary = ""
    primary = primary or DEFAULT_BRAND
    dark = _theme_colour(theme, "primary_dark") or _mix(primary, "#000000", 0.27)
    return {
        "accent": primary,
        "text": _readable(dark),
        "tint": _mix(primary, "#ffffff", 0.9),
    }


@lru_cache(maxsize=64)
def _embedded_logo(path, modified):
    """The stored logo as a data URI in its own colours (cached per file version)."""
    with default_storage.open(path, "rb") as handle:
        raw = handle.read()
    mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
    if mime == "image/svg+xml":
        return f"data:{mime};base64,{base64.b64encode(raw).decode()}"
    from PIL import Image

    with Image.open(io.BytesIO(raw)) as image:
        image.thumbnail((600, 240))
        if image.mode not in ("RGB", "RGBA"):
            image = image.convert(
                "RGBA" if "transparency" in image.info or "A" in image.getbands() else "RGB"
            )
        out = io.BytesIO()
        image.save(out, format="PNG", optimize=True)
    return f"data:image/png;base64,{base64.b64encode(out.getvalue()).decode()}"


def logo_data_uri(logo_url):
    """Our own uploaded logo, embedded — or "" (never fetched remotely)."""
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
        return _embedded_logo(stored, default_storage.get_modified_time(stored).timestamp())
    except Exception:  # noqa: BLE001 — a broken logo must never stop a document printing
        logger.warning("document_logo_unavailable", logo=stored)
        return ""


def letterhead(organization, branch=None, snapshot=None):
    """
    How the facility appears at the top of a document. `snapshot` (the facility
    block frozen into a signed document) wins for names and contacts, so a signed
    document reprints as it was signed; the logo, brand colours and registration
    numbers come from the organisation and branch.
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
        "brand": brand_colours(organization),
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
