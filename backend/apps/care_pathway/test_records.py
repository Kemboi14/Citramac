"""Risk proposals, capacity, visit consent, progress notes, episode outcome."""

from django.urls import reverse

from apps.tenancy.context import platform_admin_context

from .models import EpisodeOfCare, EpisodeStatusHistory
from .test_care_plan import CarePlanTestCase


class RecordsTestCase(CarePlanTestCase):
    def post(self, name, body, *args):
        return self.client.post(reverse(name, args=args or [self.pid]), body, format="json", **self.auth)

    def get(self, name, *args):
        return self.client.get(reverse(name, args=args or [self.pid]), **self.auth)


class ProposalTests(RecordsTestCase):
    def test_positive_item_proposes_without_touching_risk_until_a_clinician_adds_it(self):
        self.post("care-client-assessments", {"instrument": "PHQ9", "answers": [0] * 8 + [2]}, self.pid)
        proposals = self.get("care-client-proposals").data["results"]
        self.assertEqual((proposals[0]["row"], proposals[0]["status"]), ("suicide", "PROPOSED"))
        from . import intake_schema  # noqa: F401

        self.assertEqual(self.post("care-proposal-decision", {"action": "DISMISS"}, proposals[0]["id"]).status_code, 400)
        added = self.post("care-proposal-decision", {"action": "ADD"}, proposals[0]["id"])
        self.assertEqual(added.data["status"], "ADDED")
        draft = self.get("care-client-intake-draft").data["sections"]["risk"]["rows"]
        self.assertIn("Thoughts", draft["suicide"])
        self.assertEqual(self.post("care-proposal-decision", {"action": "ADD"}, proposals[0]["id"]).status_code, 400)

    def test_negative_item_proposes_nothing_and_resubmit_does_not_duplicate(self):
        self.post("care-client-assessments", {"instrument": "PHQ9", "answers": [1] * 8 + [0]}, self.pid)
        self.assertEqual(self.get("care-client-proposals").data["results"], [])


class CapacityConsentTests(RecordsTestCase):
    def capacity(self, **over):
        body = {"decision": "MEDICATION", "understand": "Yes", "retain": "Yes", "weigh": "Yes", "communicate": "Yes"}
        return self.post("care-client-capacity", {**body, **over})

    def test_outcome_is_derived_and_per_decision_and_history_is_kept(self):
        self.assertEqual(self.capacity().data["outcome"], "Has capacity")
        self.assertEqual(self.capacity(weigh="No").data["outcome"], "Lacks capacity")
        self.assertEqual(self.capacity(decision="ADMISSION", retain="Unsure").data["outcome"], "Unclear — reassess")
        data = self.get("care-client-capacity").data
        self.assertEqual(len(data["history"]), 3)
        current = {c["decision"]: c["outcome"] for c in data["current"]}
        self.assertEqual(current["MEDICATION"], "Lacks capacity")
        self.assertEqual(self.capacity(decision="NOPE").status_code, 400)
        self.assertEqual(self.capacity(decision="OTHER").status_code, 400)

    def test_consent_warns_when_patient_lacks_capacity_and_deferred_stays_open_until_completed(self):
        self.capacity(weigh="No")
        c = self.post("care-client-visit-consents", {"scope": "MEDICATION", "party": "PATIENT"})
        self.assertTrue(any("lacking" in w for w in c.data["warnings"]))
        self.assertEqual(self.post("care-client-visit-consents", {"scope": "x", "party": "GUARDIAN"}).status_code, 400)
        d = self.post("care-client-visit-consents", {"scope": "Emergency sedation", "party": "DEFERRED"})
        self.assertTrue(d.data["open_deferred"])
        done = self.post("care-visit-consent-complete", {}, d.data["id"])
        self.assertFalse(done.data["open_deferred"])
        self.assertEqual(self.post("care-visit-consent-complete", {}, d.data["id"]).status_code, 400)


class NoteAndEpisodeTests(RecordsTestCase):
    def test_note_signs_once_and_correction_is_an_addendum(self):
        n = self.post("care-client-notes", {"note_type": "WARD_ROUND", "text": "Settled overnight"})
        self.assertEqual(n.status_code, 201)
        self.assertEqual(self.post("care-client-notes", {"note_type": "BAD"}).status_code, 400)
        signed = self.post("care-note", {}, n.data["id"])
        self.assertEqual(signed.data["status"], "SIGNED")
        edit = self.client.put(reverse("care-note", args=[n.data["id"]]), {"text": "x"}, format="json", **self.auth)
        self.assertEqual(edit.status_code, 400)
        add = self.post("care-client-notes", {"note_type": "WARD_ROUND", "text": "Correction: …", "amends": n.data["id"]})
        self.assertEqual(add.data["amends"], n.data["id"])
        empty = self.post("care-client-notes", {"note_type": "PHONE", "text": " "})
        self.assertEqual(self.post("care-note", {}, empty.data["id"]).status_code, 400)

    def test_closing_an_episode_needs_a_reason_when_unplanned_and_writes_status_history(self):
        self.assertEqual(self.post("care-client-episode-outcome", {"outcome": "LOST"}).status_code, 400)
        ok = self.post("care-client-episode-outcome", {"outcome": "LOST", "reason": "No contact after three attempts"})
        self.assertEqual(ok.status_code, 201, ok.data)
        with platform_admin_context():
            ep = EpisodeOfCare.objects.get(pk=ok.data["episode"])
            self.assertEqual(ep.status, "finished")
            self.assertTrue(EpisodeStatusHistory.objects.filter(episode=ep, status="finished").exists())
        self.assertEqual(self.post("care-client-episode-outcome", {"outcome": "PLANNED"}).status_code, 400)  # none open
        new = self.post("care-client-new-episode", {})
        self.assertEqual(new.status_code, 201)
        self.assertEqual(self.post("care-client-new-episode", {}).status_code, 400)
