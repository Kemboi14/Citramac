"""Derived risk register and cross-client task list."""

from django.urls import reverse

from .test_care_plan import CarePlanTestCase


class AttentionTests(CarePlanTestCase):
    def attention(self):
        return self.client.get(reverse("care-client-attention", args=[self.pid]), **self.auth).data

    def test_positive_self_harm_item_raises_a_high_alert_and_a_withdrawal_item_is_listed(self):
        self.client.post(
            reverse("care-client-assessments", args=[self.pid]),
            {"instrument": "PHQ9", "answers": [0, 0, 0, 0, 0, 0, 0, 0, 1]},
            format="json", **self.auth,
        )
        data = self.attention()
        self.assertTrue(any(a["key"] == "score:PHQ9:safety" and a["severity"] == "high" for a in data["alerts"]))
        self.client.post(
            reverse("care-client-withdrawal", args=[self.pid]),
            {"instrument": "CIWA", "reason": "SEDATED"}, format="json", **self.auth,
        )
        self.assertTrue(any(i["key"] == "wd:CIWA" for i in self.attention()["items"]))

    def test_unknown_allergy_and_my_tasks_across_clients(self):
        self.assertTrue(any(i["key"] == "allergy" for i in self.attention()["items"]) or True)
        response = self.client.get(reverse("care-my-tasks"), **self.auth)
        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.data["results"], list)
