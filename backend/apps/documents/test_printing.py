"""Professional print layout in the organisation's colours: HTML preview and
PDF download for a generated document (owner decisions 2026-11-05, 2026-11-07)."""

import re

from django.urls import reverse

from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import platform_admin_context

from . import printing
from .tests import DocumentFixture


def body_colours(html):
    """Hex colours used by the stylesheet's body text (black on white stays)."""
    return re.search(r"body \{[^}]*color: (#[0-9a-f]{3,6})", html).group(1)


class DocumentPrintTests(DocumentFixture):
    def letter(self):
        self.consent("EMPLOYER_COMMUNICATION", scope=["FUNCTIONAL"])
        response = self.employer_letter(diagnosis_disclosure="NOT_AUTHORIZED")
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def print_url(self, doc_id):
        return reverse("documents-print", args=[doc_id])

    def test_preview_is_the_professional_layout_with_draft_marking(self):
        doc = self.letter()
        response = self.client.get(self.print_url(doc["id"]), **self.auth(self.psychiatrist))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "text/html; charset=utf-8")
        self.assertIn("default-src 'none'", response["Content-Security-Policy"])
        html = response.content.decode()
        self.assertIn("Synthetic Wellness Centre", html)
        self.assertIn(doc["document_number"], html)
        self.assertIn("Draft — clinician review required", html)
        self.assertIn("HR Manager", html)
        self.assertNotIn("CONSENT</p>", html)  # internal legal-basis code isn't printed
        self.assertEqual(body_colours(html), "#111")  # body text stays black
        self.assertIn("--brand: #006e51;", html)  # no theme set: the product default

    def test_download_is_a_pdf_and_is_audited(self):
        doc = self.letter()
        response = self.client.get(
            self.print_url(doc["id"]) + "?output=pdf", **self.auth(self.psychiatrist)
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertIn("attachment;", response["Content-Disposition"])
        self.assertIn(".pdf", response["Content-Disposition"])
        self.assertTrue(response.content.startswith(b"%PDF-"))
        with platform_admin_context():
            outputs = list(
                AuditLogEntry.objects.filter(
                    model="documents.generateddocument", object_id=doc["id"]
                ).values_list("field_diff", flat=True)
            )
        self.assertIn({"output": "PDF download"}, outputs)

    def test_a_remote_logo_is_never_fetched(self):
        self.assertEqual(printing.logo_data_uri("https://evil.example/logo.png"), "")
        self.assertEqual(printing.logo_data_uri("http://x/media/../etc/passwd"), "")

    def test_documents_follow_the_organisation_theme(self):
        self.org.theme_overrides = {"light": {"primary": "#7b2d8e", "primary_dark": "#5a2168"}}
        self.org.save(update_fields=["theme_overrides"])
        doc = self.letter()
        html = self.client.get(
            self.print_url(doc["id"]), **self.auth(self.psychiatrist)
        ).content.decode()
        self.assertIn("--brand: #7b2d8e;", html)
        self.assertIn("--brand-text: #5a2168;", html)

    def test_brand_colours(self):
        class Org:
            theme_overrides = {}
            primary_color = "#1a63c9"

        # No theme: the colour on the organisation's branded login.
        self.assertEqual(printing.brand_colours(Org())["accent"], "#1a63c9")
        # A pale brand still gives headings that read on white paper.
        Org.theme_overrides = {"light": {"primary": "#ffe066", "primary_dark": "#ffd43b"}}
        colours = printing.brand_colours(Org())
        self.assertEqual(colours["accent"], "#ffe066")
        self.assertGreaterEqual(printing._contrast_on_white(colours["text"]), 4.5)
        # Anything that isn't a #rrggbb never reaches the stylesheet.
        Org.theme_overrides = {"light": {"primary": "red;}</style><script>"}}
        Org.primary_color = "#006e51"
        self.assertRegex(printing.brand_colours(Org())["accent"], r"^#[0-9a-f]{6}$")

    def test_filenames_are_safe(self):
        self.assertEqual(printing.safe_filename('DOC/1"; rm', "v2"), "DOC-1---rm-v2")
