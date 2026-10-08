"""Discharge planning and follow-up — docs/17-DISCHARGE-AND-FOLLOW-UP.md."""

import uuid
from datetime import timedelta

from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.models import Appointment, Patient
from apps.clinical_encounter.models import (
    DiagnosisCode,
    Encounter,
    Prescription,
    PrescriptionItem,
)
from apps.dha_interop.fhir_validation.validator import validate_bundle
from apps.dha_interop.models import IcdCodeIndex, NationalDrugIndex
from apps.ipd_ward.models import Admission, Bed, Ward
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization

from . import services
from .models import ChargeItem, DischargeMedicationLine, DischargeSummary


class DischargeFixture(APITestCase):
    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Org", slug=f"org-{uuid.uuid4().hex[:6]}", facility_type="MENTAL_HEALTH_MHP"
            )
            self.doctor = self._user("doctor", "Org Admin")
            self.nurse = self._user("nurse", None)
            self.patient = Patient.objects.create(
                organization=self.org,
                first_name="Faith",
                last_name="Mwangi",
                gender="FEMALE",
                date_of_birth="1997-03-14",
            )
            self.episode = services.get_or_open_episode(self.patient, self.doctor)
            self.encounter = Encounter.objects.create(
                organization=self.org,
                patient=self.patient,
                episode=self.episode,
                opened_by=self.doctor,
                encounter_type="INPATIENT",
                status="IN_PROGRESS",
            )
            ward = Ward.objects.create(organization=self.org, name="Stabilization Ward")
            self.bed = Bed.objects.create(
                organization=self.org, ward=ward, bed_number="A1", status="OCCUPIED"
            )
            self.admission = self._admission()
            self.icd = IcdCodeIndex.objects.get_or_create(
                code="6A70", defaults={"description": "Single episode depressive disorder"}
            )[0]
            self.diagnosis = DiagnosisCode.objects.create(
                organization=self.org,
                encounter=self.encounter,
                icd11_code=self.icd,
                is_primary=True,
            )
            self.drug = NationalDrugIndex.objects.get_or_create(
                code="DRUG-FLX20", defaults={"generic_name": "Fluoxetine", "strength": "20 mg"}
            )[0]
            prescription = Prescription.objects.create(
                organization=self.org, encounter=self.encounter, prescribed_by=self.doctor
            )
            self.item = PrescriptionItem.objects.create(
                organization=self.org,
                prescription=prescription,
                drug=self.drug,
                dose="20 mg",
                route="Oral",
                frequency="Once daily",
            )
        self.auth = self._auth(self.doctor)
        self.nurse_auth = self._auth(self.nurse)

    def _user(self, name, role):
        user = User.objects.create_user(
            email=f"{name}-{uuid.uuid4().hex[:5]}@org.test",
            password="Password123!",
            organization=self.org,
            is_active=True,
            first_name=name.title(),
            last_name="Test",
        )
        if role:
            user.roles.add(Role.objects.get(name=role, organization__isnull=True))
        return user

    @staticmethod
    def _auth(user):
        return {"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(user)[0]}"}

    def _admission(self, **extra):
        return Admission.objects.create(
            organization=self.org,
            patient=self.patient,
            bed=self.bed,
            encounter=self.encounter,
            episode=self.episode,
            admitted_by=self.doctor,
            consultant=self.doctor,
            **extra,
        )

    def payload(self, **overrides):
        data = {
            "disposition": "HOME",
            "clinical_status": "Settled, no suicidal ideation, good insight.",
            "treatment_summary": "Fluoxetine started and titrated; attended group therapy.",
            "diagnoses": [str(self.diagnosis.id)],
            "education": ["MED_ADHERENCE", "CRISIS_PLAN"],
            "medications": [
                {
                    "prescription_item": str(self.item.id),
                    "drug": self.drug.code,
                    "dose": "20 mg",
                    "route": "Oral",
                    "frequency": "Once daily",
                    "action": "CONTINUE",
                }
            ],
        }
        data.update(overrides)
        return data

    def sign(self, admission=None, **overrides):
        admission = admission or self.admission
        return self.client.post(
            reverse("care-admission-discharge-sign", args=[admission.id]),
            self.payload(**overrides),
            format="json",
            **self.auth,
        )

    def refresh(self, *objects):
        with platform_admin_context():
            for obj in objects:
                obj.refresh_from_db()


class DischargeWorkflowTests(DischargeFixture):
    def test_worklist_shows_current_inpatient_not_started(self):
        response = self.client.get(reverse("care-discharges"), **self.auth)
        self.assertEqual(response.status_code, 200)
        row = response.data["current"][0]
        self.assertEqual(row["admission_id"], str(self.admission.id))
        self.assertEqual(row["state"], "NOT_STARTED")
        self.assertEqual(response.data["recent"], [])

    def test_form_prefills_coded_diagnoses_and_medications(self):
        response = self.client.get(
            reverse("care-admission-discharge", args=[self.admission.id]), **self.auth
        )
        self.assertEqual(response.status_code, 200)
        context = response.data["context"]
        self.assertEqual(context["diagnoses"][0]["code"], "6A70")
        self.assertEqual(context["medications"][0]["drug_name"], "Fluoxetine")
        self.assertFalse(response.data["restricted"])

    def test_draft_is_saved_server_side_and_reported_in_worklist(self):
        response = self.client.put(
            reverse("care-admission-discharge", args=[self.admission.id]),
            self.payload(),
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["summary"]["status"], "IN_PROGRESS")
        worklist = self.client.get(reverse("care-discharges"), **self.auth)
        self.assertEqual(worklist.data["current"][0]["state"], "DRAFT")

    def test_sign_discharges_the_client_and_records_authority(self):
        response = self.sign()
        self.assertEqual(response.status_code, 200, response.data)
        self.refresh(self.admission, self.bed, self.encounter, self.episode)
        self.assertEqual(self.admission.status, "DISCHARGED")
        self.assertIsNotNone(self.admission.discharged_at)
        self.assertEqual(self.bed.status, "AVAILABLE")
        self.assertEqual(self.encounter.status, "CLOSED")
        # The episode stays open: outpatient care normally continues inside it.
        self.assertIn(self.episode.status, ("planned", "waitlist", "active"))
        with platform_admin_context():
            summary = DischargeSummary.objects.get(admission=self.admission)
            self.assertEqual(summary.status, "COMPLETED")
            self.assertEqual(summary.signed_by_id, self.doctor.id)
            self.assertEqual(summary.signed_role, "Org Admin")
            self.assertEqual(summary.medications.count(), 1)
            self.assertTrue(ChargeItem.objects.filter(service__name="Discharge").exists())
        # The legacy free-text column is not written to (no second store).
        self.assertEqual(self.admission.discharge_summary, "")

    def test_second_discharge_is_refused_and_the_record_is_unchanged(self):
        self.assertEqual(self.sign().status_code, 200)
        with platform_admin_context():
            before = DischargeSummary.objects.get(admission=self.admission)
            before_text = before.treatment_summary
        again = self.sign(treatment_summary="Overwritten after the fact")
        self.assertEqual(again.status_code, 409)
        with platform_admin_context():
            self.assertEqual(DischargeSummary.objects.filter(admission=self.admission).count(), 1)
            self.assertEqual(
                DischargeSummary.objects.get(admission=self.admission).treatment_summary,
                before_text,
            )

    def test_required_fields_are_reported(self):
        response = self.sign(disposition="", clinical_status="", treatment_summary="")
        self.assertEqual(response.status_code, 400)
        self.refresh(self.admission)
        self.assertEqual(self.admission.status, "ADMITTED")

    def test_unknown_codes_are_rejected(self):
        self.assertEqual(self.sign(disposition="NOT-A-CODE").status_code, 400)
        self.assertEqual(self.sign(education=["NOT-A-CODE"]).status_code, 400)
        bad_line = self.payload()["medications"][0] | {"action": "MAYBE"}
        self.assertEqual(self.sign(medications=[bad_line]).status_code, 400)

    def test_diagnosis_must_belong_to_the_admissions_encounter(self):
        with platform_admin_context():
            other = Encounter.objects.create(
                organization=self.org, patient=self.patient, opened_by=self.doctor
            )
            foreign = DiagnosisCode.objects.create(
                organization=self.org, encounter=other, icd11_code=self.icd
            )
        self.assertEqual(self.sign(diagnoses=[str(foreign.id)]).status_code, 400)

    def test_involuntary_admission_needs_the_legal_order_addressed(self):
        with platform_admin_context():
            self.admission.admission_type = "INVOLUNTARY"
            self.admission.save(update_fields=["admission_type"])
        refused = self.sign()
        self.assertEqual(refused.status_code, 400)
        self.assertIn("legal_status_at_discharge", str(refused.data))
        accepted = self.sign(legal_status_at_discharge="Order lapsed; reviewed by consultant.")
        self.assertEqual(accepted.status_code, 200, accepted.data)

    def test_left_against_medical_advice_is_a_valid_disposition(self):
        response = self.sign(disposition="AMA", destination="Left with family")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            response.data["summary"]["disposition_label"], "Left against medical advice"
        )


class SignedRecordProtectionTests(DischargeFixture):
    def test_signed_summary_and_its_medication_lines_are_frozen(self):
        self.sign()
        with platform_admin_context():
            summary = DischargeSummary.objects.get(admission=self.admission)
            summary.treatment_summary = "edited"
            with self.assertRaises(PermissionError):
                summary.save()
            line = DischargeMedicationLine.objects.get(summary=summary)
            line.dose = "999 mg"
            with self.assertRaises(PermissionError):
                line.save()
            with self.assertRaises(PermissionError):
                line.delete()

    def test_amendment_is_a_new_version_and_the_original_stays_intact(self):
        self.sign()
        with platform_admin_context():
            first = DischargeSummary.objects.get(admission=self.admission)
        amend = self.client.post(reverse("care-discharge-amend", args=[first.id]), **self.auth)
        self.assertEqual(amend.status_code, 201, amend.data)
        self.assertEqual(amend.data["summary"]["version"], 2)
        corrected = self.sign(treatment_summary="Corrected: also received brief CBT.")
        self.assertEqual(corrected.status_code, 200, corrected.data)
        with platform_admin_context():
            versions = list(
                DischargeSummary.objects.filter(admission=self.admission).order_by("version")
            )
            self.assertEqual([v.status for v in versions], ["COMPLETED", "COMPLETED"])
            self.assertEqual(versions[1].supersedes_id, versions[0].id)
            self.assertEqual(
                versions[0].treatment_summary,
                "Fluoxetine started and titrated; attended group therapy.",
            )
            self.assertEqual(versions[1].medications.count(), 1)
            # An amendment does not discharge or charge a second time.
            self.assertEqual(ChargeItem.objects.filter(service__name="Discharge").count(), 1)
        self.refresh(self.admission)
        self.assertEqual(self.admission.status, "DISCHARGED")

    def test_only_the_latest_signed_version_can_be_amended(self):
        self.sign()
        with platform_admin_context():
            first = DischargeSummary.objects.get(admission=self.admission)
        self.client.post(reverse("care-discharge-amend", args=[first.id]), **self.auth)
        self.sign()
        again = self.client.post(reverse("care-discharge-amend", args=[first.id]), **self.auth)
        self.assertEqual(again.status_code, 409)

    def test_a_draft_cannot_be_amended(self):
        self.client.put(
            reverse("care-admission-discharge", args=[self.admission.id]),
            self.payload(),
            format="json",
            **self.auth,
        )
        with platform_admin_context():
            draft = DischargeSummary.objects.get(admission=self.admission)
        response = self.client.post(reverse("care-discharge-amend", args=[draft.id]), **self.auth)
        self.assertEqual(response.status_code, 409)


class DischargeConfidentialityTests(DischargeFixture):
    def test_clinician_outside_the_care_team_cannot_read_or_write_content(self):
        read = self.client.get(
            reverse("care-admission-discharge", args=[self.admission.id]), **self.nurse_auth
        )
        self.assertEqual(read.status_code, 200)
        self.assertTrue(read.data["restricted"])
        self.assertIsNone(read.data["context"])
        write = self.client.put(
            reverse("care-admission-discharge", args=[self.admission.id]),
            self.payload(),
            format="json",
            **self.nurse_auth,
        )
        self.assertEqual(write.status_code, 403)
        sign = self.client.post(
            reverse("care-admission-discharge-sign", args=[self.admission.id]),
            self.payload(),
            format="json",
            **self.nurse_auth,
        )
        self.assertEqual(sign.status_code, 403)

    def test_signed_content_is_hidden_from_a_clinician_outside_the_care_team(self):
        self.sign()
        read = self.client.get(
            reverse("care-admission-discharge", args=[self.admission.id]), **self.nurse_auth
        )
        self.assertTrue(read.data["restricted"])
        self.assertNotIn("treatment_summary", read.data["summary"])
        self.assertNotIn("Fluoxetine", str(read.data))
        with platform_admin_context():
            summary = DischargeSummary.objects.get(admission=self.admission)
        fhir = self.client.get(reverse("care-discharge-fhir", args=[summary.id]), **self.nurse_auth)
        self.assertEqual(fhir.status_code, 403)

    def test_timeline_shows_the_disposition_but_not_the_narrative(self):
        self.sign()
        timeline = self.client.get(
            reverse("care-client-timeline", args=[self.patient.id]), **self.nurse_auth
        )
        self.assertEqual(timeline.status_code, 200)
        self.assertIn("Home / community care", str(timeline.data))
        self.assertNotIn("titrated", str(timeline.data))

    def test_viewing_a_signed_summary_is_audit_logged(self):
        from apps.sysadmin_audit.models import AuditLogEntry

        self.sign()
        self.client.get(reverse("care-admission-discharge", args=[self.admission.id]), **self.auth)
        with platform_admin_context():
            self.assertTrue(
                AuditLogEntry.objects.filter(
                    model="care_pathway.dischargesummary", action=AuditLogEntry.ACTION_VIEW
                ).exists()
            )


class DischargeFhirTests(DischargeFixture):
    def _bundle(self, summary):
        response = self.client.get(reverse("care-discharge-fhir", args=[summary.id]), **self.auth)
        self.assertEqual(response.status_code, 200, response.data)
        return response.json()

    def test_signed_summary_is_a_valid_r4_document_bundle(self):
        self.sign(follow_up=self._follow_up())
        with platform_admin_context():
            summary = DischargeSummary.objects.get(admission=self.admission)
        bundle = self._bundle(summary)
        self.assertEqual(validate_bundle(bundle), {})
        self.assertEqual(bundle["type"], "document")
        types = [entry["resource"]["resourceType"] for entry in bundle["entry"]]
        self.assertEqual(types[0], "Composition")
        for expected in ("Patient", "Encounter", "Condition", "MedicationRequest", "Provenance"):
            self.assertIn(expected, types)
        composition = bundle["entry"][0]["resource"]
        self.assertEqual(composition["status"], "final")
        self.assertEqual(composition["attester"][0]["mode"], "legal")
        encounter = next(
            e["resource"] for e in bundle["entry"] if e["resource"]["resourceType"] == "Encounter"
        )
        self.assertEqual(encounter["class"]["code"], "IMP")
        self.assertEqual(
            encounter["hospitalization"]["dischargeDisposition"]["coding"][0]["code"], "HOME"
        )
        provenance = bundle["entry"][-1]["resource"]
        self.assertEqual(provenance["agent"][0]["role"][0]["text"], "Org Admin")

    def test_amendment_replaces_the_earlier_composition_and_validates(self):
        self.sign()
        with platform_admin_context():
            first = DischargeSummary.objects.get(admission=self.admission)
        self.client.post(reverse("care-discharge-amend", args=[first.id]), **self.auth)
        self.sign(treatment_summary="Corrected narrative.")
        with platform_admin_context():
            second = DischargeSummary.objects.get(admission=self.admission, version=2)
        bundle = self._bundle(second)
        self.assertEqual(validate_bundle(bundle), {})
        composition = bundle["entry"][0]["resource"]
        self.assertEqual(composition["status"], "amended")
        self.assertEqual(composition["relatesTo"][0]["code"], "replaces")
        self.assertIn(str(first.id), composition["relatesTo"][0]["targetReference"]["reference"])

    def test_stopped_medication_is_exported_as_stopped(self):
        stopped = self.payload()["medications"][0] | {"action": "STOP"}
        self.sign(medications=[stopped])
        with platform_admin_context():
            summary = DischargeSummary.objects.get(admission=self.admission)
        bundle = self._bundle(summary)
        self.assertEqual(validate_bundle(bundle), {})
        med = next(
            e["resource"]
            for e in bundle["entry"]
            if e["resource"]["resourceType"] == "MedicationRequest"
        )
        self.assertEqual(med["status"], "stopped")

    def test_unsigned_draft_cannot_be_exported(self):
        self.client.put(
            reverse("care-admission-discharge", args=[self.admission.id]),
            self.payload(),
            format="json",
            **self.auth,
        )
        with platform_admin_context():
            draft = DischargeSummary.objects.get(admission=self.admission)
        response = self.client.get(reverse("care-discharge-fhir", args=[draft.id]), **self.auth)
        self.assertEqual(response.status_code, 409)

    def _follow_up(self, **extra):
        return {
            "scheduled_for": (timezone.now() + timedelta(days=7)).isoformat(),
            "reason": "POST_DISCHARGE",
            "client_request_id": str(uuid.uuid4()),
            **extra,
        }


class FollowUpTests(DischargeFixture):
    def _book(self, **extra):
        data = {
            "patient": str(self.patient.id),
            "scheduled_for": (timezone.now() + timedelta(days=3)).isoformat(),
            "reason": "MEDICATION_REVIEW",
            "client_request_id": str(uuid.uuid4()),
            **extra,
        }
        return self.client.post(reverse("care-follow-ups"), data, format="json", **self.auth)

    def _buckets(self):
        return {
            bucket: self.client.get(
                reverse("care-follow-ups") + f"?bucket={bucket}", **self.auth
            ).data
            for bucket in services.FOLLOW_UP_BUCKETS
        }

    def test_booking_links_the_episode_and_records_who_booked(self):
        response = self._book()
        self.assertEqual(response.status_code, 201, response.data)
        with platform_admin_context():
            appointment = Appointment.objects.get(pk=response.data["id"])
        self.assertEqual(appointment.episode_id, self.episode.id)
        self.assertEqual(appointment.booked_by_id, self.doctor.id)
        self.assertEqual(appointment.origin, "MANUAL")
        self.assertEqual(appointment.appointment_type, "Medication review")

    def test_retried_booking_is_idempotent(self):
        request_id = str(uuid.uuid4())
        first = self._book(client_request_id=request_id)
        second = self._book(client_request_id=request_id)
        self.assertEqual(first.data["id"], second.data["id"])
        with platform_admin_context():
            self.assertEqual(Appointment.objects.filter(client_request_id=request_id).count(), 1)

    def test_reason_must_come_from_the_served_value_set(self):
        self.assertEqual(self._book(reason="MADE-UP").status_code, 400)
        self.assertEqual(self._book(reason="").status_code, 400)

    def test_buckets_split_upcoming_overdue_and_missed(self):
        self._book()
        with platform_admin_context():
            Appointment.objects.create(
                organization=self.org,
                patient=self.patient,
                scheduled_for=timezone.now() - timedelta(days=2),
                reason="THERAPY",
            )
            Appointment.objects.create(
                organization=self.org,
                patient=self.patient,
                scheduled_for=timezone.now() - timedelta(days=5),
                reason="AFTERCARE",
                status="NO_SHOW",
            )
            # A plain manual appointment is not a follow-up.
            Appointment.objects.create(
                organization=self.org,
                patient=self.patient,
                scheduled_for=timezone.now() + timedelta(days=1),
            )
        buckets = self._buckets()
        self.assertEqual(buckets["upcoming"]["counts"]["upcoming"], 1)
        self.assertEqual(buckets["overdue"]["counts"]["overdue"], 1)
        self.assertEqual(buckets["missed"]["counts"]["missed"], 1)
        self.assertEqual(
            buckets["overdue"]["results"][0]["reason_label"], "Psychotherapy continuation"
        )

    def test_discharge_without_follow_up_appears_as_unbooked_until_one_is_booked(self):
        self.sign()
        self.assertEqual(self._buckets()["unbooked"]["counts"]["unbooked"], 1)
        row = self._buckets()["unbooked"]["results"][0]
        self.assertEqual(row["admission_id"], str(self.admission.id))
        booked = self.client.post(
            reverse("care-follow-ups"),
            {
                "admission": str(self.admission.id),
                "scheduled_for": (timezone.now() + timedelta(days=10)).isoformat(),
                "reason": "POST_DISCHARGE",
                "client_request_id": str(uuid.uuid4()),
            },
            format="json",
            **self.auth,
        )
        self.assertEqual(booked.status_code, 201, booked.data)
        self.assertEqual(booked.data["origin"], "DISCHARGE")
        self.assertEqual(self._buckets()["unbooked"]["counts"]["unbooked"], 0)

    def test_deceased_discharge_expects_no_follow_up(self):
        self.sign(disposition="DECEASED")
        self.assertEqual(self._buckets()["unbooked"]["counts"]["unbooked"], 0)

    def test_follow_up_booked_at_discharge_is_linked_and_idempotent(self):
        request_id = str(uuid.uuid4())
        follow_up = {
            "scheduled_for": (timezone.now() + timedelta(days=7)).isoformat(),
            "reason": "POST_DISCHARGE",
            "client_request_id": request_id,
        }
        response = self.sign(follow_up=follow_up)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["summary"]["follow_up"]["reason"], "POST_DISCHARGE")
        with platform_admin_context():
            appointment = Appointment.objects.get(client_request_id=request_id)
            self.assertEqual(appointment.origin, "DISCHARGE")
            self.assertEqual(appointment.admission_id, self.admission.id)
        self.assertEqual(self._buckets()["unbooked"]["counts"]["unbooked"], 0)

    def test_a_failed_booking_rolls_the_whole_discharge_back(self):
        bad = {"scheduled_for": "not-a-date", "reason": "POST_DISCHARGE"}
        response = self.sign(follow_up=bad)
        self.assertEqual(response.status_code, 400)
        self.refresh(self.admission, self.bed)
        self.assertEqual(self.admission.status, "ADMITTED")
        self.assertEqual(self.bed.status, "OCCUPIED")
        with platform_admin_context():
            self.assertFalse(
                DischargeSummary.objects.filter(
                    admission=self.admission, status="COMPLETED"
                ).exists()
            )

    def test_dashboard_counts_overdue_follow_ups_and_discharges_without_one(self):
        with platform_admin_context():
            Appointment.objects.create(
                organization=self.org,
                patient=self.patient,
                scheduled_for=timezone.now() - timedelta(days=1),
                reason="THERAPY",
            )
        self.sign()
        # The overdue appointment pre-dates the discharge, so it does not count as booked.
        data = self.client.get(reverse("care-dashboard"), **self.auth).data
        self.assertEqual(data["follow_ups_overdue"], 1)
        self.assertEqual(data["discharged_without_follow_up"], 1)
