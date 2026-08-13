from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import User
from apps.accounts.tokens import issue_tokens
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization


class TerminologySearchTests(APITestCase):
    """
    docs/10-API-SPECIFICATION.md §10.5-10.8 — these are autocomplete
    endpoints and must return a plain list, not the paginated
    {count, next, previous, results} envelope (caught by a real browser
    walkthrough during Phase 3: the frontend expected an array and silently
    rendered nothing when it got the envelope object instead).
    """

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            org = Organization.objects.create(
                name="Org", slug="org", facility_type="MENTAL_HEALTH_CCP"
            )
            self.user = User.objects.create_user(
                email="clinician@org.test",
                password="Password123!",
                organization=org,
                is_active=True,
            )
        self.access, _ = issue_tokens(self.user)

    def test_icd11_search_returns_plain_list(self):
        response = self.client.get(
            reverse("terminology-icd11-search") + "?q=depress",
            HTTP_AUTHORIZATION=f"Bearer {self.access}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.data, list)
        self.assertIn("6A70", [row["code"] for row in response.data])

    def test_icd11_search_empty_query_still_returns_a_list(self):
        response = self.client.get(
            reverse("terminology-icd11-search"), HTTP_AUTHORIZATION=f"Bearer {self.access}"
        )
        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.data, list)
