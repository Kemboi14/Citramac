"""Triage v4 endpoints — the rule metadata the triage screen needs and the live
queue (triage_v4.py, triage_queue.py)."""

from rest_framework.response import Response
from rest_framework.views import APIView

from . import triage_queue, triage_v4


class TriageV4ConfigView(APIView):
    def get(self, request):
        return Response(triage_v4.served_config())


class LiveQueueView(APIView):
    def get(self, request):
        return Response(triage_queue.live_queue())
