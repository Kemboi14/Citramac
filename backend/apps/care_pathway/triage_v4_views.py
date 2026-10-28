"""Triage v4 endpoints — the rule metadata the triage screen needs and the live
queue (triage_v4.py, triage_queue.py)."""

from rest_framework.response import Response
from rest_framework.views import APIView

from . import triage_queue, triage_v5


class TriageV4ConfigView(APIView):
    def get(self, request):
        # New triages are v5; its config is v4's plus the v5 table and screens.
        return Response(triage_v5.served_config())


class LiveQueueView(APIView):
    def get(self, request):
        return Response(triage_queue.live_queue())
