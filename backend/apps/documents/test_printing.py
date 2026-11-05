"""Professional greyscale print layout: HTML preview and PDF download for a
generated document (owner decision 2026-11-05)."""

import re

from django.urls import reverse

from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import platform_admin_context

from . import printing
from .tests import DocumentFixture


def assert_greyscale(case, html):
    """Every colour in the document is a grey (equal red, green and blue)."""
    for hex_colour in re.findall(r"#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b", html):
        full = hex_colour if len(hex_colour) == 6 else "".join(c * 2 for c in hex_colour)
        r, g, b = full[0:2], full[2:4], full[4:6]
        case.assertTrue(r == g == b, f"#{hex_colour} is not grey")
    for rgb in re.findall(r"rgba?\(([^)]*)\)", html):
        r, g, b = (part.strip() for part in rgb.split(",")[:3])
        case.assertTrue(r == g == b, f"rgb({rgb}) is not grey")
    for named in ("red", "green", "blue", "orange", "amber"):
        case.assertIsNone(re.search(rf"(color|background)\s*:\s*{named}\b", html))


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
        assert_greyscale(self, html)

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

    def test_filenames_are_safe(self):
        self.assertEqual(printing.safe_filename('DOC/1"; rm', "v2"), "DOC-1---rm-v2")
