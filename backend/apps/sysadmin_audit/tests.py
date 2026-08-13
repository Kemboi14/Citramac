from django.test import Client, TestCase


class HealthzTests(TestCase):
    def test_healthz_returns_ok(self):
        response = Client().get("/healthz")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")


class SecurityHeadersTests(TestCase):
    """docs/09-SECURITY-COMPLIANCE.md §9.7 — headers set on all HTTP responses."""

    def test_response_carries_hardening_headers(self):
        response = Client().get("/healthz")
        self.assertIn("Content-Security-Policy", response)
        self.assertEqual(response["Referrer-Policy"], "strict-origin-when-cross-origin")
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response["X-Frame-Options"], "DENY")
