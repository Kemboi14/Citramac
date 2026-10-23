"""Test helper: a scripted stand-in for the DHA HIE middleware.

    with FakeHie() as hie:
        hie.on("GET", "/patients", {"id": "CR…"})
        …
        hie.calls  # [(method, path, kwargs), …]

It patches the HTTP layer of apps.dha_interop.hie_api (token POST and every
request), so services run their real code path end to end.
"""

import json
from contextlib import ExitStack
from unittest.mock import Mock, patch

from django.core.cache import cache
from django.test import override_settings

BASE_URL = "https://hie.example.test/api/v1"


def _response(status, body):
    response = Mock(status_code=status, ok=200 <= status < 300)
    response.content = b"" if body is None else json.dumps(body).encode()
    response.text = response.content.decode()
    response.json.return_value = body if body is not None else {}
    if body is None:
        response.json.side_effect = ValueError("no body")
    return response


class FakeHie:
    def __init__(self, *, configured=True):
        self.routes = {}
        self.calls = []
        self.token_calls = 0
        self.configured = configured
        self._stack = ExitStack()

    def on(self, method, path, body=None, status=200):
        """Script the answer to METHOD path; `body` may be an Exception to raise."""
        self.routes[(method, path)] = [(status, body)]
        return self

    def sequence(self, method, path, *answers):
        """Successive (status, body) answers for repeated calls."""
        self.routes[(method, path)] = list(answers)
        return self

    def _request(self, method, url, **kwargs):
        path = url[len(BASE_URL):] if url.startswith(BASE_URL) else url
        self.calls.append((method, path, kwargs))
        answers = self.routes.get((method, path))
        if not answers:
            return _response(404, {"error": "Not Found", "message": f"no route {method} {path}"})
        status, body = answers[0] if len(answers) == 1 else answers.pop(0)
        if isinstance(body, Exception):
            raise body
        return _response(status, body)

    def _token(self, url, **kwargs):
        self.token_calls += 1
        return _response(200, {"access_token": f"tok-{self.token_calls}", "expires_in": 3600})

    def call(self, method, path):
        return [c for c in self.calls if c[0] == method and c[1] == path]

    def __enter__(self):
        cache.clear()
        settings = (
            {
                "HIE_API_BASE_URL": BASE_URL,
                "HIE_API_CLIENT_ID": "test-client",
                "HIE_API_CLIENT_SECRET": "test-secret",  # pragma: allowlist secret
            }
            if self.configured
            else {"HIE_API_BASE_URL": "", "HIE_API_CLIENT_ID": "", "HIE_API_CLIENT_SECRET": ""}
        )
        self._stack.enter_context(override_settings(**settings))
        self._stack.enter_context(
            patch("apps.dha_interop.hie_api.requests.post", side_effect=self._token)
        )
        self._stack.enter_context(
            patch("apps.dha_interop.hie_api.requests.request", side_effect=self._request)
        )
        return self

    def __exit__(self, *exc):
        self._stack.close()
        cache.clear()
        return False
