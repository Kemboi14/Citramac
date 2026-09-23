"""
Shared `{"error": {code, message, fields?}}` response shape — originally
local to apps.accounts.auth_views, promoted here once a second app
(apps.accounts.views) needed the same convention. This is the shape
config.exceptions.custom_exception_handler normalizes every *raised*
DRF/library exception into; call this directly for error paths that build
a Response by hand instead of raising (e.g. a plain validation branch in a
ModelViewSet action).
"""

from rest_framework.response import Response
from rest_framework import status


def error_response(code, message, http_status=status.HTTP_400_BAD_REQUEST, fields=None):
    body = {"error": {"code": code, "message": message}}
    if fields:
        body["error"]["fields"] = fields
    return Response(body, status=http_status)
