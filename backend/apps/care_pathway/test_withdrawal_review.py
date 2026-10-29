"""Organisation-approved assessments (trauma, benzodiazepine withdrawal) and the
psychiatric review on withdrawal — triage spec items 9 and 10, spec 6.1
(rules 2026-10-29.1)."""

from django.test import SimpleTestCase
from django.urls import reverse

from apps.accounts.models import Role
from apps.dha_interop.fhir_validation.validator import validate_bundle
from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import platform_admin_context

from . import psychiatric_review
from . import triage_v5 as v5
from .intake_schema import _code
from .models import CareTask
from .test_intake import IntakeTestCase
from .test_triage_v5 import BASE, OPIOID_WD, SAFETY, FindingStoreApiTests

BENZO_WD = {
    "g_use": "yes",
    "g_sedatives_last": "two days ago",
    "g_sedatives_amount": "diazepam 30 mg daily for a year",
    "g_sedatives_concern": "withdrawal",
}


def triggers(answers, approved=None):
    result = v5.evaluate({**BASE, **answers}, None, approved)
    return {t["code"]: t for t in result["auto_triggers"]}


class WithdrawalRulesTests(SimpleTestCase):
    def test_benzodiazepine_withdrawal_names_the_approved_assessment_never_ciwa_by_default(self):
        none = triggers(BENZO_WD)
        self.assertIn(
            "No benzodiazepine withdrawal assessment approved", none["TOOL:benzo"]["pathway"]
        )
        self.assertNotIn("TOOL:ciwa_ar", none)
        approved = triggers(BENZO_WD, {"BENZO_WITHDRAWAL": "CIWA-Ar"})
        self.assertEqual(
            approved["TOOL:benzo"]["pathway"], "CIWA-Ar (approved by this organisation)"
        )

    def test_any_withdrawal_flags_a_psychiatric_review(self):
        self.assertEqual(v5.withdrawal_reasons({**BASE, **OPIOID_WD}), ["Opioids withdrawal"])
        self.assertIn("PSYCHIATRIC_REVIEW", triggers(OPIOID_WD))
        self.assertEqual(
            v5.withdrawal_reasons({**BASE, **BENZO_WD}),
            ["Benzodiazepines / sedatives withdrawal"],
        )
        stopped = {**BASE, "g_use": "unknown", "g_stopped": "yes"}
        self.assertEqual(v5.withdrawal_reasons(stopped), ["recently stopped heavy use"])
        self.assertEqual(v5.withdrawal_reasons(BASE), [])
        self.assertNotIn("PSYCHIATRIC_REVIEW", triggers({}))
        # Not for a caller's report on someone who is not here.
        self.assertEqual(v5.withdrawal_reasons({**OPIOID_WD, "b_present": "no"}), [])


def as_org_admin(test):
    with platform_admin_context():
        role, _ = Role.objects.get_or_create(
            name="Org Admin", defaults={"scope": Role.SCOPE_ORG_TEMPLATE}
        )
        test.nurse.roles.add(role)


class ApprovedAssessmentApiTests(IntakeTestCase):
    url = "care-approved-assessments"

    def put(self, **body):
        return self.client.put(reverse(self.url), body, format="json", **self.auth)

    def current(self):
        data = self.client.get(reverse(self.url), **self.auth).data
        return {p["purpose"]: p for p in data["purposes"]}

    def tools(self):
        data = self.client.get(reverse("care-client-tools", args=[self.pid]), **self.auth).data
        return {t["key"]: t for t in data["results"]}

    def test_only_an_org_admin_approves_with_the_lead_named_and_attested(self):
        self.assertEqual(self.current()["TRAUMA"]["instrument"], "")  # none by default
        trauma = {"purpose": "TRAUMA", "instrument": "PCL5"}
        self.assertEqual(
            self.put(**trauma, clinical_lead="Dr Otieno", attest=True).status_code, 403
        )
        as_org_admin(self)
        self.assertEqual(self.put(**trauma, attest=True).status_code, 400)  # no lead named
        self.assertEqual(self.put(**trauma, clinical_lead="Dr Otieno").status_code, 400)
        self.assertEqual(
            self.put(**trauma, clinical_lead="Dr Otieno", attest=True).status_code, 200
        )
        self.assertEqual(self.current()["TRAUMA"]["clinical_lead"], "Dr Otieno")
        # CIWA-Ar for benzodiazepines needs the explicit off-label confirmation too.
        benzo = {
            "purpose": "BENZO_WITHDRAWAL",
            "instrument": "CIWA",
            "clinical_lead": "Dr Otieno",
            "attest": True,
        }
        self.assertEqual(self.put(**benzo).status_code, 400)
        self.assertEqual(self.put(**benzo, confirm=True).status_code, 200)
        self.assertEqual(self.put(purpose="BENZO_WITHDRAWAL", instrument="COWS").status_code, 400)
        # Withdrawing needs no attestation; every change is audited.
        self.assertEqual(self.put(purpose="TRAUMA", instrument="").status_code, 200)
        self.assertEqual(self.current()["TRAUMA"]["instrument"], "")
        with platform_admin_context():
            self.assertEqual(
                AuditLogEntry.objects.filter(model="care_pathway.approvedassessment").count(), 3
            )

    def test_trauma_symptoms_recommend_pcl5_only_once_approved(self):
        self.draft()
        self.save(sections={"sx": {"list": [_code("Trauma symptoms")]}})
        pcl = self.tools()["PCL5"]
        self.assertEqual(pcl["status"], "Not approved")
        self.assertTrue(pcl["why"] and pcl["note"])
        decide = reverse("care-client-tool-decision", args=[self.pid, "PCL5"])
        self.assertEqual(
            self.client.post(
                decide, {"status": "ACCEPTED"}, format="json", **self.auth
            ).status_code,
            400,
        )
        as_org_admin(self)
        self.put(purpose="TRAUMA", instrument="PCL5", clinical_lead="Dr Otieno", attest=True)
        self.assertEqual(self.tools()["PCL5"]["status"], "Recommended")

    def test_the_withdrawal_chart_suggests_only_the_approved_benzodiazepine_scale(self):
        self.draft()
        self.save(sections={"subs": {"kind": _code("Benzodiazepines")}})
        url = reverse("care-client-withdrawal", args=[self.pid])
        data = self.client.get(url, **self.auth).data
        self.assertTrue(data["benzodiazepine"])
        self.assertIsNone(data["recommended"])
        as_org_admin(self)
        self.put(
            purpose="BENZO_WITHDRAWAL",
            instrument="CIWA",
            clinical_lead="Dr Otieno",
            attest=True,
            confirm=True,
        )
        self.assertEqual(self.client.get(url, **self.auth).data["recommended"], "CIWA")


class PsychiatricReviewApiTests(FindingStoreApiTests):
    def review(self):
        with platform_admin_context():
            return CareTask.objects.filter(
                triage_encounter_id=self.te_id, focus_type=psychiatric_review.FOCUS
            ).first()

    def queue_row(self):
        rows = self.client.get(reverse("care-psych-queue"), **self.auth).data["results"]
        return next(r for r in rows if r["id"] == self.te_id)

    def complete(self, **body):
        return self.client.patch(
            reverse("care-task", args=[self.review().id]), body, format="json", **self.auth
        )

    def test_withdrawal_raises_a_review_that_is_started_then_completed_with_an_outcome(self):
        response = self.sign_v5({**BASE, **OPIOID_WD, **SAFETY})
        self.assertEqual(response.status_code, 201, response.data)
        urgent = response.data["final_priority"] in ("RED", "ORANGE")
        task = self.review()
        self.assertEqual(
            (task.status, task.priority), ("INITIATED", "urgent" if urgent else "routine")
        )
        self.assertIn("Opioids withdrawal", task.action_label)
        self.assertEqual(self.queue_row()["withdrawal_review"]["status"], "INITIATED")

        self.client.post(reverse("care-open-review", args=[self.te_id]), **self.auth)
        self.assertEqual(self.review().status, "PENDING")

        self.assertEqual(self.complete(status="COMPLETED").status_code, 400)  # no outcome
        self.assertEqual(self.complete(status="PENDING").status_code, 400)
        done = self.complete(
            status="COMPLETED", outcome="managed_here", outcome_note="COWS 8, symptomatic care"
        )
        self.assertEqual(done.status_code, 200, done.data)
        row = self.queue_row()["withdrawal_review"]
        self.assertEqual(
            (row["status"], row["outcome_label"]), ("COMPLETED", "Reviewed — managed here")
        )
        with platform_admin_context():
            events = [
                e.field_diff["event"]
                for e in AuditLogEntry.objects.filter(
                    model="care_pathway.caretask", object_id=str(task.id)
                ).order_by("timestamp")
            ]
        self.assertEqual(events, ["RAISED", "STARTED", "COMPLETED"])

        bundle = self.client.get(reverse("care-triage-fhir", args=[self.te_id]), **self.auth).data
        self.assertEqual(validate_bundle(bundle), {})
        fhir_task = next(
            e["resource"]
            for e in bundle["entry"]
            if e["resource"]["resourceType"] == "Task"
            and e["resource"]["code"]["coding"][0]["code"] == "psychiatric_review_withdrawal"
        )
        self.assertEqual((fhir_task["status"], fhir_task["priority"]), ("completed", task.priority))
        self.assertEqual(
            fhir_task["output"][0]["valueCodeableConcept"]["coding"][0]["code"], "managed_here"
        )
        self.assertEqual(fhir_task["note"][0]["text"], "COWS 8, symptomatic care")
        provenance = next(
            e["resource"]
            for e in bundle["entry"]
            if e["resource"]["resourceType"] == "Provenance"
            and e["resource"]["target"][0]["reference"].endswith(str(task.id))
        )
        self.assertTrue(provenance["agent"][0]["who"]["display"])

    def test_no_withdrawal_no_review(self):
        self.assertEqual(self.sign_v5(BASE).status_code, 201)
        self.assertIsNone(self.review())
        self.assertIsNone(self.queue_row()["withdrawal_review"])


class IntakeWithdrawalReviewTests(IntakeTestCase):
    def test_withdrawal_first_found_at_intake_raises_one_review(self):
        self.sign_triage()
        self.draft()
        self.save(
            sections={
                "subs": {"features": [_code("Withdrawal")]},
                "close": {"reason_incomplete": "Client tired", "message": "Continue tomorrow"},
            }
        )
        self.assertEqual(self.sign_intake("PARTIAL").status_code, 200)
        with platform_admin_context():
            reviews = CareTask.objects.filter(
                triage_encounter_id=self.te_id, focus_type=psychiatric_review.FOCUS
            )
            self.assertEqual(reviews.count(), 1)
            self.assertEqual(reviews.get().priority, "urgent")  # the triage was ORANGE
