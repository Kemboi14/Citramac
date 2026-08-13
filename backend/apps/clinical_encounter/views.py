from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.dha_interop.fhir_mapper import build_referral_bundle
from apps.dha_interop.hie_client import transmit_referral
from apps.triage.serializers import MentalStatusExamSerializer, VitalSignsSerializer

from .models import Encounter, SoapNote
from .serializers import (
    ClinicalOrderSerializer,
    DiagnosisCodeSerializer,
    EncounterSerializer,
    PrescriptionSerializer,
    ReferralPacketSerializer,
    SoapNoteSerializer,
)


class EncounterViewSet(viewsets.ModelViewSet):
    """docs/10-API-SPECIFICATION.md §10.5 — Modules 2-3."""

    serializer_class = EncounterSerializer

    def get_queryset(self):
        return Encounter.objects.select_related("patient").order_by("-opened_at")

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization, opened_by=self.request.user)

    @action(detail=True, methods=["get", "post"])
    def vitals(self, request, pk=None):
        encounter = self.get_object()
        if request.method == "POST":
            serializer = VitalSignsSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            serializer.save(
                encounter=encounter, organization=encounter.organization, recorded_by=request.user
            )
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(VitalSignsSerializer(encounter.vital_signs.all(), many=True).data)

    @action(detail=True, methods=["get", "post"])
    def mse(self, request, pk=None):
        encounter = self.get_object()
        if request.method == "POST":
            serializer = MentalStatusExamSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            mse = serializer.save(
                encounter=encounter, organization=encounter.organization, recorded_by=request.user
            )
            if mse.risk_escalated_to_supervisor:
                from apps.notifications.tasks import notify_supervisors_of_risk

                notify_supervisors_of_risk.delay(
                    str(encounter.organization_id),
                    str(encounter.id),
                    encounter.patient.get_full_name(),
                )
            return Response(MentalStatusExamSerializer(mse).data, status=status.HTTP_201_CREATED)
        return Response(
            MentalStatusExamSerializer(encounter.mental_status_exams.all(), many=True).data
        )

    @action(detail=True, methods=["get", "post"], url_path="soap-notes")
    def soap_notes(self, request, pk=None):
        encounter = self.get_object()
        if request.method == "POST":
            serializer = SoapNoteSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            serializer.save(
                encounter=encounter, organization=encounter.organization, author=request.user
            )
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(SoapNoteSerializer(encounter.soap_notes.all(), many=True).data)

    @action(detail=True, methods=["post"], url_path="soap-notes/(?P<note_id>[^/.]+)/sign")
    def sign_soap_note(self, request, pk=None, note_id=None):
        note = SoapNote.objects.get(pk=note_id, encounter_id=pk)
        note.is_locked = True
        note.signed_at = timezone.now()
        note.save(update_fields=["is_locked", "signed_at"])
        return Response(SoapNoteSerializer(note).data)

    @action(detail=True, methods=["get", "post"])
    def diagnoses(self, request, pk=None):
        encounter = self.get_object()
        if request.method == "POST":
            serializer = DiagnosisCodeSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            serializer.save(encounter=encounter, organization=encounter.organization)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(DiagnosisCodeSerializer(encounter.diagnoses.all(), many=True).data)

    @action(detail=True, methods=["get", "post"])
    def orders(self, request, pk=None):
        """POS validation gate applies here — docs/07-CLINICAL-MODULES-SPEC.md §7.10."""
        encounter = self.get_object()
        if request.method == "POST":
            from apps.billing.gate import BillingNotCleared, check_billing_clearance

            try:
                check_billing_clearance(encounter)
            except BillingNotCleared as exc:
                return Response(
                    {"error": {"code": "BILLING_NOT_CLEARED", "message": str(exc)}}, status=402
                )

            serializer = ClinicalOrderSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            serializer.save(
                encounter=encounter, organization=encounter.organization, ordered_by=request.user
            )
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(ClinicalOrderSerializer(encounter.orders.all(), many=True).data)

    @action(detail=True, methods=["get", "post"])
    def prescriptions(self, request, pk=None):
        """POS validation gate applies here too — same doc reference as orders() above."""
        encounter = self.get_object()
        if request.method == "POST":
            from apps.billing.gate import BillingNotCleared, check_billing_clearance

            try:
                check_billing_clearance(encounter)
            except BillingNotCleared as exc:
                return Response(
                    {"error": {"code": "BILLING_NOT_CLEARED", "message": str(exc)}}, status=402
                )

            serializer = PrescriptionSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            serializer.save(
                encounter=encounter, organization=encounter.organization, prescribed_by=request.user
            )
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(PrescriptionSerializer(encounter.prescriptions.all(), many=True).data)

    @action(detail=True, methods=["get", "post"])
    def referrals(self, request, pk=None):
        """
        E-Referral — docs/07-CLINICAL-MODULES-SPEC.md §7.3. Builds a real,
        schema-validated FHIR Bundle (docs/08-DHA-SHA-INTEGRATION.md §8.1) at
        creation time; transmission to the HIE happens via the `send` action.
        """
        encounter = self.get_object()
        if request.method == "POST":
            serializer = ReferralPacketSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            referral = serializer.save(encounter=encounter, organization=encounter.organization)
            referral.fhir_bundle_json = build_referral_bundle(referral)
            referral.save(update_fields=["fhir_bundle_json"])
            return Response(ReferralPacketSerializer(referral).data, status=status.HTTP_201_CREATED)
        return Response(ReferralPacketSerializer(encounter.referrals.all(), many=True).data)

    @action(detail=True, methods=["post"], url_path="referrals/(?P<referral_id>[^/.]+)/send")
    def send_referral(self, request, pk=None, referral_id=None):
        """
        Transmits the cached FHIR Bundle to the HIE — docs/08-DHA-SHA-INTEGRATION.md
        §8.1. Honestly reports a failed/skipped transmission when no HIE
        endpoint is configured (see apps.dha_interop.hie_client), never a
        fabricated success.
        """
        encounter = self.get_object()
        referral = encounter.referrals.get(pk=referral_id)
        cache_entry = transmit_referral(referral, referral.fhir_bundle_json)
        if cache_entry.status == "SENT":
            referral.status = "SENT"
            referral.sent_at = timezone.now()
            referral.save(update_fields=["status", "sent_at"])
        return Response(
            {
                "referral": ReferralPacketSerializer(referral).data,
                "transmission_status": cache_entry.status,
                "transmission_detail": cache_entry.transmission_detail,
            }
        )
