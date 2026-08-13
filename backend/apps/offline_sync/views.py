from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.response import Response
from rest_framework.views import APIView

from .sync_service import pull_changes, push_entry


class SyncPushView(APIView):
    """POST /api/v1/sync/push/ — docs/08-DHA-SHA-INTEGRATION.md §8.5."""

    def post(self, request):
        entries = request.data.get("entries", [])
        results = [push_entry(request.user.organization, request.user, entry) for entry in entries]
        return Response({"results": results})


class SyncPullView(APIView):
    """GET /api/v1/sync/pull/?since=<ISO8601> — docs/08-DHA-SHA-INTEGRATION.md §8.5."""

    def get(self, request):
        since_param = request.query_params.get("since")
        since = parse_datetime(since_param) if since_param else None
        if since is None:
            since = timezone.now() - timezone.timedelta(days=1)
        return Response(pull_changes(request.user.organization, since))
