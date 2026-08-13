from django.test import Client, TestCase


class HealthzTests(TestCase):
    def test_healthz_returns_ok(self):
        response = Client().get("/healthz")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
