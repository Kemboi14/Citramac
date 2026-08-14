"""
Seeds the specific data docs/08-DHA-SHA-INTEGRATION.md §8.6 says a `/sandbox`
environment needs so it can be demonstrated live to DHA evaluators:

  - FHIR payload exchange (send + receive) against the DHA sandbox.
  - ICD-11 code search/assignment in a live encounter.
  - BMI/BSA automatic calculation in Triage.
  - A full pre-auth -> e-claim -> remittance cycle against SHA's test gateway.
  - The immutable audit log showing every access/edit/delete for a sample
    patient record.

docs/11-ROADMAP-AND-PHASES.md Phase 7 called for this seeded environment;
it was never actually built (no seed script existed anywhere in the repo
before this command — checked as part of Phase 9). ICD-11 assignment and
BMI/BSA are already demonstrable from ordinary clinical-workflow use of the
demo org (this command doesn't touch them); what was completely missing —
a full pre-auth/e-claim/remittance cycle and any FHIR Bundle ever built for
this org — is what this command creates, reusing the same real service
calls the API views use (apps.insurance_claims.sha_gateway,
apps.dha_interop.fhir_mapper/hie_client) rather than fabricating data that
bypasses that code path.

Idempotent — safe to re-run; it get_or_creates against the org's first
Patient/Encounter rather than creating duplicates each run.
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.clinical_encounter.models import ReferralPacket
from apps.dha_interop.fhir_mapper import build_referral_bundle
from apps.dha_interop.hie_client import transmit_referral
from apps.insurance_claims import sha_gateway
from apps.insurance_claims.models import InsuranceClaim, PreAuthorization, Remittance
from apps.tenancy.context import set_tenant_context
from apps.tenancy.models import Organization

DEMO_CLAIM_AMOUNT = 15000.00
DEMO_REMITTANCE_AMOUNT = 12000.00


class Command(BaseCommand):
    help = (
        "Seed the pre-auth -> e-claim -> remittance cycle and a FHIR referral "
        "Bundle for an existing demo org's first Patient/Encounter, for a live "
        "DHA evaluator walkthrough (docs/08-DHA-SHA-INTEGRATION.md §8.6)."
    )

    def add_arguments(self, parser):
        parser.add_argument("--org-slug", default="cafric-demo")

    def handle(self, *args, **options):
        try:
            organization = Organization.objects.get(slug=options["org_slug"])
        except Organization.DoesNotExist as exc:
            raise CommandError(f"No Organization with slug '{options['org_slug']}'") from exc

        set_tenant_context(organization_id=organization.id)

        from apps.client_registry.models import Patient
        from apps.clinical_encounter.models import Encounter

        patient = Patient.objects.first()
        if patient is None:
            raise CommandError(
                f"Organization '{organization.slug}' has no Patient yet — register one "
                "through the normal clinical workflow first, this command only seeds "
                "the insurance/FHIR demo data on top of an existing patient/encounter."
            )
        encounter = Encounter.objects.filter(patient=patient).first()
        if encounter is None:
            raise CommandError(
                f"Patient '{patient}' has no Encounter yet — open one through the "
                "normal clinical workflow first."
            )

        with transaction.atomic():
            claim = self._seed_pre_auth_and_claim(organization, patient, encounter)
            self._seed_remittance(claim)
            self._seed_fhir_referral(encounter)

        self.stdout.write(self.style.SUCCESS(f"Sandbox demo data ready for '{organization.slug}'."))

    def _seed_pre_auth_and_claim(self, organization, patient, encounter):
        pre_auth, created = PreAuthorization.objects.get_or_create(
            patient=patient,
            encounter=encounter,
            defaults={
                "organization": organization,
                "clinical_notes": "Demo pre-authorization request for DHA evaluator walkthrough.",
                "diagnostic_evidence": "See attached Mental Status Exam and biopsychosocial "
                "assessment.",
            },
        )
        if created or pre_auth.status == "DRAFT":
            log_entry = sha_gateway.submit_pre_authorization(pre_auth)
            pre_auth.status = "SUBMITTED"
            pre_auth.sha_reference = str(log_entry.id)
            pre_auth.submitted_at = timezone.now()
            pre_auth.save(update_fields=["status", "sha_reference", "submitted_at"])
            self.stdout.write(f"Pre-authorization {pre_auth.id} submitted to SHA gateway (stub).")
        else:
            self.stdout.write(f"Pre-authorization {pre_auth.id} already submitted — left as-is.")

        diagnoses_snapshot = [
            {"code": diagnosis.icd11_code_id, "description": str(diagnosis.icd11_code)}
            for diagnosis in encounter.diagnoses.select_related("icd11_code").all()
        ]
        claim, created = InsuranceClaim.objects.get_or_create(
            patient=patient,
            encounter=encounter,
            defaults={
                "organization": organization,
                "diagnoses_snapshot": diagnoses_snapshot,
                "total_claimed_amount": DEMO_CLAIM_AMOUNT,
            },
        )
        if created or claim.status == "DRAFT":
            log_entry = sha_gateway.submit_e_claim(claim)
            claim.status = "SUBMITTED"
            claim.sha_reference = str(log_entry.id)
            claim.submitted_at = timezone.now()
            claim.save(update_fields=["status", "sha_reference", "submitted_at"])
            self.stdout.write(f"E-claim {claim.id} submitted to SHA gateway (stub).")
        else:
            self.stdout.write(f"E-claim {claim.id} already submitted — left as-is.")
        return claim

    def _seed_remittance(self, claim):
        """
        Remittance rows represent SHA's own inbound advice — there is no
        "submit remittance" action anywhere in this codebase
        (RemittanceViewSet is read-only) because the platform never
        originates one. Manually creating this row is standing in for that
        inbound message so the full cycle is demonstrable end-to-end; it is
        not simulating a SHA API call the way the pre-auth/e-claim
        submissions above are.
        """
        if claim.remittances.exists():
            self.stdout.write("Remittance already recorded for this claim — left as-is.")
            return
        remittance = Remittance.objects.create(
            organization=claim.organization,
            claim=claim,
            amount_paid=DEMO_REMITTANCE_AMOUNT,
            reference="DEMO-REMIT-0001",
        )
        self.stdout.write(f"Remittance {remittance.id} recorded for claim {claim.id}.")

    def _seed_fhir_referral(self, encounter):
        referral, created = ReferralPacket.objects.get_or_create(
            encounter=encounter,
            destination_facility="Kenyatta National Hospital (DHA demo referral)",
            defaults={"organization": encounter.organization},
        )
        if not created and referral.fhir_bundle_json:
            self.stdout.write(f"Referral {referral.id} already has a FHIR Bundle — left as-is.")
            return

        referral.fhir_bundle_json = build_referral_bundle(referral)
        referral.save(update_fields=["fhir_bundle_json"])
        cache_entry = transmit_referral(referral, referral.fhir_bundle_json)
        if cache_entry.status == "SENT":
            referral.status = "SENT"
            referral.sent_at = timezone.now()
            referral.save(update_fields=["status", "sent_at"])
        self.stdout.write(
            f"Referral {referral.id}: FHIR Bundle built, transmission status "
            f"'{cache_entry.status}' (see FhirResourceCache {cache_entry.id})."
        )
