"""Care plan: recommendations with provenance, decisions, signing, safety plan, MDT, co-sign."""

import uuid
from datetime import timedelta

from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.tenancy.context import platform_admin_context

from . import care_plan
from .models import CarePlanTask, CarePlanVersion
from .test_intake import IntakeTestCase


class CarePlanTestCase(IntakeTestCase):
    def setUp(self):
        super().setUp()
        with platform_admin_context():
            self.psych = User.objects.create_user(
                email=f"psych-{uuid.uuid4().hex[:6]}@org.test", password="Password123!",
                organization=self.org, is_active=True, first_name="Dr", last_name="Senior",
            )
            role, _ = Role.objects.get_or_create(
                name="Psychiatrist", defaults={"scope": Role.SCOPE_ORG_TEMPLATE}
            )
            self.psych.roles.add(role)
        self.psych_auth = {"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(self.psych)[0]}"}

    def ws(self, auth=None):
        return self.client.get(reverse("care-plan-workspace", args=[self.pid]), **(auth or self.auth))

    def decide(self, key, decision, auth=None, **body):
        return self.client.post(
            reverse("care-plan-action-decide", args=[self.pid, key]),
            {"decision": decision, **body}, format="json", **(auth or self.auth),
        )

    def details(self, **body):
        return self.client.patch(
            reverse("care-plan-details", args=[self.pid]), body, format="json", **self.auth
        )

    def confirm(self):
        return self.client.post(reverse("care-plan-confirm", args=[self.pid]), format="json", **self.auth)

    def risk(self, **rows):
        self.draft()
        self.save(sections={"risk": {"rows": rows}})


class RecommendationTests(CarePlanTestCase):
    def test_suicide_risk_recommends_psychiatry_and_safety_with_provenance(self):
        self.risk(suicide=["Thoughts"])
        recs = {r["key"]: r for r in self.ws().data["recommendations"]}
        self.assertEqual(recs["psych_review"]["priority"], "YELLOW")
        self.assertEqual(recs["safety"]["priority"], "YELLOW")
        self.assertIn("suicide-risk finding: thoughts", recs["safety"]["why"][0])

    def test_priority_escalates_with_intent_or_plan_and_means(self):
        self.risk(suicide=["Plan", "Access to means"])
        self.assertEqual(self.ws().data["suggested_priority"], "RED")
        recs = {r["key"]: r for r in self.ws().data["recommendations"]}
        self.assertEqual(recs["psych_review"]["priority"], "RED")

    def test_no_findings_recommends_routine_outpatient(self):
        data = self.ws().data
        self.assertEqual([(r["key"], r["priority"]) for r in data["recommendations"]], [("outpatient", "GREEN")])

    def test_the_rules_are_labelled_illustrative_and_versioned(self):
        data = self.ws().data
        self.assertEqual(data["rules_approval"], "illustrative")
        self.assertTrue(data["rules_version"])

    def test_the_catalogue_carries_no_tariff_or_preauth_codes(self):
        rows = self.client.get(reverse("care-plan-catalogue"), **self.auth).data["results"]
        self.assertTrue(rows)
        for row in rows:
            self.assertNotIn("sha", row)
            self.assertNotIn("preauth", row)

    def test_a_high_phq9_and_psychotic_features_add_recommendations(self):
        self.assess = lambda **b: self.client.post(
            reverse("care-client-assessments", args=[self.pid]), b, format="json", **self.auth
        )
        self.assertEqual(self.assess(instrument="PHQ9", answers=[3] * 8 + [0]).status_code, 201)  # 24
        self.draft()
        self.save(sections={"mse": {"perception": "Auditory hallucinations"}})
        recs = {r["key"]: r for r in self.ws().data["recommendations"]}
        self.assertEqual(recs["therapy"]["priority"], "YELLOW")
        self.assertEqual(recs["psych_review"]["priority"], "ORANGE")
        self.assertIn("psychotic features", " ".join(recs["psych_review"]["why"]))


class DecisionTests(CarePlanTestCase):
    def test_accept_modify_add_and_decline_are_recorded_with_reasons(self):
        self.risk(suicide=["Plan"])  # psych_review + safety ORANGE
        accepted = self.decide("psych_review", "ACCEPTED")
        self.assertEqual(accepted.status_code, 200, accepted.data)
        actions = {a["key"]: a for a in accepted.data["actions"]}
        self.assertEqual((actions["psych_review"]["decision"], actions["psych_review"]["priority"]), ("ACCEPTED", "ORANGE"))
        # Lowering the priority needs a real reason.
        self.assertEqual(self.decide("safety", "MODIFIED", priority="GREEN", reason="no").status_code, 400)
        modified = self.decide("safety", "MODIFIED", priority="YELLOW", reason="Client engaged, family present")
        self.assertEqual({a["key"]: a["decision"] for a in modified.data["actions"]}["safety"], "MODIFIED")
        # An unrecommended action is "added by clinician".
        added = self.decide("therapy", "ADDED", priority="GREEN")
        self.assertEqual({a["key"]: a["decision"] for a in added.data["actions"]}["therapy"], "ADDED")

    def test_declining_needs_a_recommendation_and_a_reason_and_is_not_a_live_action(self):
        self.risk(suicide=["Thoughts"])
        self.assertEqual(self.decide("safety", "DECLINED", reason="n").status_code, 400)
        self.assertEqual(self.decide("therapy", "DECLINED", reason="Not recommended at all").status_code, 400)
        declined = self.decide("safety", "DECLINED", reason="Handled through the existing crisis plan")
        self.assertEqual(declined.status_code, 200)
        plan = self.client.get(reverse("care-client-care-plan", args=[self.pid]), **self.auth).data
        self.assertNotIn("safety", [a["title"].lower() for a in plan["activities"]])

    def test_unknown_action_and_decision_are_refused(self):
        self.assertEqual(self.decide("nope", "ACCEPTED").status_code, 400)
        self.assertEqual(self.decide("therapy", "MAYBE").status_code, 400)


class SignPlanTests(CarePlanTestCase):
    def ready(self):
        self.decide("outpatient", "ACCEPTED")
        self.details(client_agreement="AGREES")

    def test_cannot_sign_until_every_recommendation_is_decided_and_agreement_is_recorded(self):
        blocked = self.confirm()
        self.assertEqual(blocked.status_code, 400)
        items = blocked.data["outstanding"]
        self.assertIn("At least one action", items)
        self.assertIn("Client agreement status", items)
        self.assertTrue(any("Accept or decline the recommendation: Outpatient" in i for i in items))

    def test_signing_creates_an_immutable_version_opens_tasks_and_due_times(self):
        self.ready()
        signed = self.confirm()
        self.assertEqual(signed.status_code, 200, signed.data)
        self.assertEqual(signed.data["version"], 1)
        action = signed.data["actions"][0]
        self.assertTrue(action["tasks"])
        self.assertIsNotNone(action["due_at"])
        with platform_admin_context():
            version = CarePlanVersion.objects.get(care_plan__patient_id=self.pid)
            self.assertEqual(version.snapshot["actions"][0]["key"], "outpatient")
            self.assertEqual(version.snapshot["rules_version"], care_plan.RULES_VERSION)
        # A re-sign is a new version, and tasks are not duplicated.
        again = self.confirm()
        self.assertEqual(again.data["version"], 2)
        with platform_admin_context():
            self.assertEqual(CarePlanVersion.objects.filter(care_plan__patient_id=self.pid).count(), 2)
            self.assertEqual(
                CarePlanTask.objects.filter(activity__care_plan__patient_id=self.pid).count(),
                len(action["tasks"]),
            )

    def test_tasks_can_be_ticked_and_unticked(self):
        self.ready()
        self.confirm()
        task = self.ws().data["actions"][0]["tasks"][0]
        url = reverse("care-plan-task", args=[task["id"]])
        done = self.client.patch(url, {"done": True}, format="json", **self.auth)
        self.assertIsNotNone(done.data["tasks"][0]["done_at"])
        undone = self.client.patch(url, {"done": False}, format="json", **self.auth)
        self.assertIsNone(undone.data["tasks"][0]["done_at"])
        self.assertEqual(self.client.patch(url, {}, format="json", **self.auth).status_code, 400)

    def test_a_plan_of_only_lower_intensity_actions_for_an_urgent_client_must_be_explained(self):
        self.sign_triage()  # ORANGE
        self.decide("outpatient", "ACCEPTED")
        self.details(client_agreement="AGREES")
        data = self.ws().data
        self.assertTrue(any("lower-intensity" in c for c in data["conflicts"]))
        items = self.confirm().data["outstanding"]
        self.assertIn("Clinical rationale for the conflicting plan", items)
        self.assertIn("Senior review", items)

    def test_conflict_plan_signs_with_rationale_and_senior_and_raises_a_cosign_request(self):
        self.sign_triage()
        self.decide("outpatient", "ACCEPTED")
        seniors = self.client.get(reverse("care-seniors"), **self.auth).data["results"]
        self.assertEqual([s["name"] for s in seniors], ["Dr Senior"])
        self.details(
            client_agreement="AGREES",
            rationale="Client declines escalation and has strong supports at home",
            senior_reviewer=seniors[0]["id"],
        )
        self.assertEqual(self.confirm().status_code, 200)
        requests = self.client.get(reverse("care-client-cosign", args=[self.pid]), **self.auth).data["results"]
        self.assertEqual(requests[0]["kind"], "CARE_PLAN_CONFLICT")
        self.assertEqual(requests[0]["status"], "REQUESTED")

    def test_only_a_cosign_capable_user_can_be_chosen_as_senior(self):
        bad = self.details(senior_reviewer=str(self.nurse.pk))
        self.assertEqual(bad.status_code, 400)

    def test_suicide_risk_requires_a_signed_safety_plan_72h_contact_and_a_named_clinician(self):
        self.risk(suicide=["Thoughts"])
        self.decide("psych_review", "ACCEPTED")
        self.decide("safety", "ACCEPTED")
        self.details(client_agreement="AGREES")
        items = self.confirm().data["outstanding"]
        self.assertTrue(any("Safety plan" in i for i in items))
        self.assertIn("Contact within 72 hours", items)
        self.assertIn("Named follow-up clinician", items)
        sp = reverse("care-safety-plan", args=[self.pid])
        self.client.get(sp, **self.auth)
        self.client.put(sp, {"warning_signs": "Not sleeping", "people_to_ask": "My sister"}, format="json", **self.auth)
        self.assertEqual(self.client.post(reverse("care-safety-plan-sign", args=[self.pid]), **self.auth).status_code, 200)
        self.details(
            contact_72h_at=(timezone.now() + timedelta(days=3)).isoformat(),
            follow_up_clinician="J. Njoroge",
        )
        self.assertEqual(self.confirm().status_code, 200)


class SafetyPlanTests(CarePlanTestCase):
    def test_signed_plan_is_never_edited_a_revision_is_a_new_version(self):
        url = reverse("care-safety-plan", args=[self.pid])
        self.assertEqual(self.client.get(url, **self.auth).data["version"], 1)
        self.assertEqual(self.client.post(reverse("care-safety-plan-sign", args=[self.pid]), **self.auth).status_code, 400)
        self.client.put(url, {"warning_signs": "Isolating", "reasons_for_living": "My children"}, format="json", **self.auth)
        signed = self.client.post(reverse("care-safety-plan-sign", args=[self.pid]), **self.auth)
        self.assertEqual(signed.data["signed_by"], "Jane Njoroge")
        # No draft left: editing is refused.
        self.assertEqual(self.client.put(url, {"coping": "x"}, format="json", **self.auth).status_code, 400)
        copy = self.client.post(reverse("care-safety-plan-copy", args=[self.pid]), **self.auth)
        self.assertIsNotNone(copy.data["copy_given_at"])
        revision = self.client.get(url, **self.auth).data
        self.assertEqual(revision["version"], 2)
        self.assertEqual(revision["reasons_for_living"], "My children")  # carried, not re-asked
        self.assertIsNone(revision["signed_at"])

    def test_a_copy_needs_a_signed_plan_and_language_is_validated(self):
        url = reverse("care-safety-plan", args=[self.pid])
        self.client.get(url, **self.auth)
        self.assertEqual(self.client.post(reverse("care-safety-plan-copy", args=[self.pid]), **self.auth).status_code, 400)
        self.assertEqual(self.client.put(url, {"language": "fr"}, format="json", **self.auth).status_code, 400)
        self.assertEqual(self.client.put(url, {"language": "sw"}, format="json", **self.auth).status_code, 200)


class MdtTests(CarePlanTestCase):
    def test_schedule_then_record_a_review_and_the_next_one_is_scheduled(self):
        url = reverse("care-plan-mdt", args=[self.pid])
        day = (timezone.now() + timedelta(days=7)).date().isoformat()
        self.assertEqual(self.client.post(url, {}, format="json", **self.auth).status_code, 400)
        review = self.client.post(url, {"scheduled_for": day}, format="json", **self.auth)
        self.assertEqual(review.status_code, 201)
        record = reverse("care-mdt-record", args=[review.data["id"]])
        self.assertEqual(self.client.post(record, {}, format="json", **self.auth).status_code, 400)
        nxt = (timezone.now() + timedelta(days=21)).date().isoformat()
        done = self.client.post(record, {"notes": "Reviewed goals", "attendees": "Team", "next_review": nxt}, format="json", **self.auth)
        self.assertIsNotNone(done.data["held_at"])
        self.assertEqual(len(self.client.get(url, **self.auth).data["results"]), 2)
        self.assertEqual(self.client.post(record, {"notes": "again"}, format="json", **self.auth).status_code, 400)


class CosignTests(CarePlanTestCase):
    def request(self, what="Plan for an urgent client"):
        return self.client.post(
            reverse("care-client-cosign", args=[self.pid]), {"what": what, "kind": "GENERAL"}, format="json", **self.auth
        )

    def decide_cosign(self, rid, action, note="", auth=None):
        return self.client.post(
            reverse("care-cosign-decide", args=[rid]), {"action": action, "note": note},
            format="json", **(auth or self.psych_auth),
        )

    def test_a_request_is_idempotent_and_a_senior_signs_it(self):
        first = self.request()
        again = self.request()
        self.assertEqual(first.data["id"], again.data["id"])
        inbox = self.client.get(reverse("care-decisions"), **self.psych_auth).data["results"]
        self.assertEqual([i["inbox_kind"] for i in inbox], ["cosign"])
        signed = self.decide_cosign(first.data["id"], "SIGN")
        self.assertEqual((signed.data["status"], signed.data["decided_by"]), ("SIGNED", "Dr Senior"))
        self.assertEqual(self.decide_cosign(first.data["id"], "SIGN").status_code, 400)

    def test_requester_and_non_seniors_cannot_decide(self):
        rid = self.request().data["id"]
        self.assertEqual(self.decide_cosign(rid, "SIGN", auth=self.auth).status_code, 403)
        self.assertEqual(self.client.get(reverse("care-decisions"), **self.auth).data["results"], [])

    def test_decline_needs_a_reason_and_returns_to_the_requester_who_acknowledges(self):
        rid = self.request().data["id"]
        self.assertEqual(self.decide_cosign(rid, "DECLINE", "no").status_code, 400)
        self.assertEqual(self.decide_cosign(rid, "DECLINE", "Needs an admission assessment").data["status"], "DECLINED")
        inbox = self.client.get(reverse("care-decisions"), **self.auth).data["results"]
        self.assertEqual([i["inbox_kind"] for i in inbox], ["returned"])
        self.assertEqual(self.client.post(reverse("care-cosign-acknowledge", args=[rid]), **self.psych_auth).status_code, 403)
        ack = self.client.post(reverse("care-cosign-acknowledge", args=[rid]), **self.auth)
        self.assertEqual(ack.data["status"], "ACKNOWLEDGED")
        self.assertEqual(self.client.get(reverse("care-decisions"), **self.auth).data["results"], [])

    def test_a_discussion_keeps_the_request_open_and_surfaces_for_the_requester(self):
        rid = self.request().data["id"]
        thread = self.decide_cosign(rid, "DISCUSS", "Can we talk about the observation level?")
        self.assertEqual((thread.data["status"], len(thread.data["thread"])), ("REQUESTED", 1))
        inbox = self.client.get(reverse("care-decisions"), **self.auth).data["results"]
        self.assertEqual([i["inbox_kind"] for i in inbox], ["discuss"])
        self.assertEqual(self.decide_cosign(rid, "NOPE").status_code, 400)
