"""get_client_ip trusts only the X-Forwarded-For entries our own proxies appended."""

from django.test import RequestFactory, SimpleTestCase, override_settings

from .middleware import get_client_ip


class ClientIpTests(SimpleTestCase):
    def ip(self, xff=None):
        meta = {"REMOTE_ADDR": "10.0.0.9"}
        if xff is not None:
            meta["HTTP_X_FORWARDED_FOR"] = xff
        return get_client_ip(RequestFactory().get("/", **meta))

    @override_settings(TRUSTED_PROXY_COUNT=1)
    def test_a_client_supplied_entry_is_ignored(self):
        self.assertEqual(self.ip("6.6.6.6, 41.90.1.2"), "41.90.1.2")

    @override_settings(TRUSTED_PROXY_COUNT=2)
    def test_two_proxies_take_the_second_entry_from_the_right(self):
        self.assertEqual(self.ip("6.6.6.6, 41.90.1.2, 10.0.0.5"), "41.90.1.2")

    @override_settings(TRUSTED_PROXY_COUNT=2)
    def test_fewer_entries_than_proxies_uses_the_leftmost(self):
        self.assertEqual(self.ip("41.90.1.2"), "41.90.1.2")

    def test_no_header_falls_back_to_remote_addr(self):
        self.assertEqual(self.ip(), "10.0.0.9")
