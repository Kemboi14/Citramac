"""Errors staff see are written for staff, not copied from a library."""

from django.urls import reverse
from rest_framework.test import APITestCase

from config.exceptions import SESSION_ENDED_MESSAGE


class FriendlyErrorMessageTests(APITestCase):
    def test_expired_or_invalid_token_says_sign_in_again(self):
        response = self.client.get(
            reverse("ipd-ward-list"), HTTP_AUTHORIZATION="Bearer not-a-real-token"
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data["error"]["code"], "TOKEN_NOT_VALID")
        self.assertEqual(response.data["error"]["message"], SESSION_ENDED_MESSAGE)
        self.assertNotIn("token type", response.data["error"]["message"])

    def test_no_token_says_sign_in_again(self):
        response = self.client.get(reverse("ipd-ward-list"))
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data["error"]["message"], SESSION_ENDED_MESSAGE)
