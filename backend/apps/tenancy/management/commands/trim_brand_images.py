"""
Trim the empty border from logos and icons uploaded before uploads were
trimmed automatically (apps.tenancy.images), so they fill the sidebar tile,
sign-in card and letterhead like new uploads do.

Each trimmed image is saved as a new file beside the original, which is kept,
and the record is pointed at it. Images hosted elsewhere, SVGs and images with
nothing to trim are left as they are. Safe to run more than once.

    python manage.py trim_brand_images [--dry-run]
"""

import os
from urllib.parse import urlparse

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.management.base import BaseCommand

from apps.tenancy.context import platform_admin_context
from apps.tenancy.images import trim_margins
from apps.tenancy.models import Organization, PlatformBranding


def _stored_path(url):
    """The storage path of one of our own media URLs, or None."""
    path = urlparse(url or "").path
    prefix = urlparse(settings.MEDIA_URL).path
    if not path.startswith(prefix):
        return None
    return path[len(prefix) :]


def _trimmed_copy(path):
    """Save a trimmed copy of `path`; return its storage path, or None."""
    if not path or not default_storage.exists(path):
        return None
    with default_storage.open(path, "rb") as handle:
        raw = handle.read()
    data, extension = trim_margins(raw, path)
    if extension is None:
        return None
    stem = os.path.splitext(path)[0]
    return default_storage.save(f"{stem}-trimmed.{extension}", ContentFile(data))


class Command(BaseCommand):
    help = "Trim the empty border from logos and icons uploaded before trimming existed."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Report only; change nothing.")

    def handle(self, *args, dry_run=False, **options):
        changed = 0
        with platform_admin_context():
            branding = PlatformBranding.get_solo()
            for field in ("logo", "icon"):
                current = getattr(branding, field)
                if not current or "-trimmed." in current.name:
                    continue
                if dry_run:
                    self.stdout.write(f"would trim platform {field}: {current.name}")
                    continue
                new_path = _trimmed_copy(current.name)
                if new_path:
                    setattr(branding, field, new_path)
                    branding.save(update_fields=[field, "updated_at"])
                    changed += 1
                    self.stdout.write(f"platform {field}: {current.name} -> {new_path}")

            for org in Organization.objects.all():
                for url_field in ("logo_url", "icon_url"):
                    url = getattr(org, url_field)
                    path = _stored_path(url)
                    if not path or "-trimmed." in path:
                        continue
                    if dry_run:
                        self.stdout.write(f"would trim {org.slug} {url_field}: {path}")
                        continue
                    new_path = _trimmed_copy(path)
                    if new_path:
                        new_url = url[: url.index(path)] + new_path
                        setattr(org, url_field, new_url)
                        org.save(update_fields=[url_field])
                        changed += 1
                        self.stdout.write(f"{org.slug} {url_field}: {path} -> {new_path}")
        self.stdout.write(self.style.SUCCESS(f"Trimmed {changed} image(s)."))
