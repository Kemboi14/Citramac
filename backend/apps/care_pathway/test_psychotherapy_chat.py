"""Psychotherapy session chat workspace — answer metadata, AI assistance (mocked;
no network), the eight safety concerns and actions checklist, one-click review of
flagged language, suggested therapy models, the four goal decisions, section
edits kept apart from the generated text, the sign-off checklist and the
Individual Psychotherapy client list."""

import json
from types import SimpleNamespace
from unittest import mock

import anthropic
import httpx2
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone

from apps.client_registry.models import Patient
from apps.mhp_program.models import CareTeamMembership
from apps.tenancy.context import platform_admin_context

from . import psy_organizer as org
from .test_psychotherapy_note import PsyNoteTestCase

AI_ON = {"PSYCHOTHERAPY_AI_ENABLED": True, "ANTHROPIC_API_KEY": "test-key-not-real"}

SAMPLE = {
    "q1": "She came in saying the week was rough. Had a big argument with her partner on Saturday "
    "about money "
    "and she left the house for a few hours instead of shouting, which she said was different "
    "from usual.",
    "q2": "She reported sleeping about 5 hours a night. I noticed she was tearful when talking "
    "about her partner "
    "but was able to settle. She said at one point that sometimes she wishes she could just "
    "disappear.",
    "q3": "We used CBT, looked at the thought 'he's going to leave me' and did a thought record. "
    "Also did some MI "
    "around the drinking, explored her ambivalence and she gave some change talk about not "
    "wanting to drink.",
    "q4": "She was able to come up with a more balanced thought. Some resistance to cutting down "
    "drinking.",
    "q5": "Thought record twice this week. Review the safety plan next session.",
}


def _response(payload, model="claude-opus-5-5"):
    return SimpleNamespace(
        stop_reason="end_turn",
        model=model,
        content=[SimpleNamespace(type="text", text=json.dumps(payload))],
    )


def fake_create(**kwargs):
    """Stands in for the Anthropic Messages API: translation → fixed English;
    rewording → a marker naming the section's instruction."""
    if "translate psychotherapy session notes" in kwargs["system"]:
        return _response({"english": "I feel tired and I have not slept for two days."})
    section = kwargs["messages"][0]["content"].split(".")[0]
    return _response({"text": f"- Reworded ({section})"})


class ChatTestCase(PsyNoteTestCase):
    def setUp(self):
        super().setUp()
        # AI tests run with the organisation switches on and the client's consent
        # recorded; the platform switch / key come from @override_settings(**AI_ON).
        self.set_org(psy_ai_allowed=True, psy_ai_enabled=True)
        self.ai_consent(True)

    def set_org(self, **fields):
        with platform_admin_context():
            org = self.nurse.organization
            for key, value in fields.items():
                setattr(org, key, value)
            org.save()

    def ai_consent(self, granted):
        from .models import ConsentTemplate

        with platform_admin_context():
            if not ConsentTemplate.all_objects.filter(
                organization=self.org, consent_type="AI_NOTE_PROCESSING", active=True
            ).exists():
                ConsentTemplate.objects.create(
                    organization=self.org,
                    consent_type="AI_NOTE_PROCESSING",
                    version="1",
                    text="Facility wording for AI-assisted note processing.",
                )
        response = self.client.post(
            reverse("care-client-consent", args=[self.pid]),
            {"granted": granted, "consent_type": "AI_NOTE_PROCESSING"},
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 201, response.data)

    def detail(self, nid):
        return self.client.get(reverse("care-psy-note", args=[nid]), **self.auth).data

    def say(self, nid, key, text, **meta):
        return self.patch(nid, {"answers": {key: {"text": text, "mode": "TYPED", **meta}}})

    def ai_client(self, create=fake_create):
        client = mock.MagicMock()
        client.beta.messages.create.side_effect = create
        return mock.patch("apps.care_pathway.psy_ai._client", return_value=client), client

    def set_goals(self, *goals):
        from . import services

        with platform_admin_context():
            plan = services.get_or_create_care_plan(Patient.objects.get(pk=self.pid), self.nurse)
            plan.goal_items = [{"goal": g} for g in goals]
            plan.save()


class AnswerMetadataTests(ChatTestCase):
    def test_answer_keeps_mode_time_language_and_legacy_mode_is_normalised(self):
        nid = self.start().data["id"]
        data = self.say(nid, "q1", "Talked about the move.", language="en-KE").data
        self.assertEqual(data["answers"]["q1"]["mode"], "TYPED")
        self.assertEqual(data["answers"]["q1"]["language"], "en-KE")
        self.assertIsNotNone(data["answers"]["q1"]["answered_at"])
        self.assertNotIn("translation", data["answers"]["q1"])
        data = self.patch(nid, {"answers": {"q2": {"text": "Calm.", "mode": "SPEAK"}}}).data
        self.assertEqual(data["answers"]["q2"]["mode"], "DICTATED")
        self.assertEqual(self.say(nid, "q3", "x", language="fr-FR").status_code, 400)
        row = next(t for t in data["transcript"] if t["question"] == "q1")
        self.assertEqual(
            (row["text"], row["mode"], row["language"]),
            ("Talked about the move.", "TYPED", "en-KE"),
        )
        self.assertIn("ANSWER", [h["action"] for h in data["history"]])


class TranslationTests(ChatTestCase):
    def test_ai_off_marks_not_translated_and_never_calls_the_api(self):
        patcher, client = self.ai_client()
        with patcher, self.captureOnCommitCallbacks(execute=True):
            nid = self.start().data["id"]
            data = self.say(nid, "q1", "Sijalala siku mbili.", language="sw-KE").data
        self.assertEqual(data["answers"]["q1"]["translation"]["status"], "unavailable")
        self.assertFalse(
            self.client.get(reverse("care-psy-config"), **self.auth).data["ai_enabled"]
        )
        data = self.act("care-psy-note-generate", nid).data
        self.assertEqual(data["processing"]["label"], "Organised from your words (rule-based)")
        self.assertIn(
            "Sijalala siku mbili.", data["sections"]["presenting_focus"]
        )  # original words used
        client.beta.messages.create.assert_not_called()

    @override_settings(**AI_ON)
    def test_ai_on_translates_beside_the_original_and_the_note_uses_the_english(self):
        patcher, client = self.ai_client()
        nid = self.start().data["id"]
        with patcher, self.captureOnCommitCallbacks(execute=True):
            pending = self.say(nid, "q1", "Niko tired, sijalala siku mbili.", language="sheng").data
        self.assertEqual(pending["answers"]["q1"]["translation"]["status"], "pending")
        data = self.detail(nid)
        answer = data["answers"]["q1"]
        self.assertEqual(
            answer["text"], "Niko tired, sijalala siku mbili."
        )  # the clinician's words kept
        self.assertEqual(answer["translation"]["status"], "done")
        self.assertEqual(
            answer["translation"]["text"], "I feel tired and I have not slept for two days."
        )
        self.assertEqual(answer["translation"]["model"], "claude-opus-5-5")
        self.assertIsNotNone(answer["translation"]["at"])
        kwargs = client.beta.messages.create.call_args.kwargs
        self.assertEqual(kwargs["model"], "claude-opus-5-5")
        self.assertIn("<session_text>", kwargs["messages"][0]["content"])
        self.assertEqual(kwargs["output_config"]["format"]["type"], "json_schema")
        self.assertIn("TRANSLATE", [h["action"] for h in data["history"]])
        with patcher, self.captureOnCommitCallbacks(execute=True):
            data = self.act("care-psy-note-generate", nid).data
        data = self.detail(nid)
        self.assertEqual(
            data["processing"]["label"], "Processed with Claude · trauma-informed language"
        )
        self.assertEqual(
            data["sections"]["presenting_focus"],
            "- Reworded (Section: Presenting focus / client report)",
        )

    @override_settings(**AI_ON)
    def test_ai_error_degrades_to_original_words_and_rule_based_with_a_log(self):
        def down(**kwargs):
            raise anthropic.APIConnectionError(
                request=httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
            )

        patcher, _ = self.ai_client(down)
        nid = self.start().data["id"]
        with patcher, self.assertLogs("apps.care_pathway.psychotherapy", "WARNING"):
            with self.captureOnCommitCallbacks(execute=True):
                self.say(nid, "q1", "Sijalala siku mbili.", language="sw-KE")
        data = self.detail(nid)
        self.assertEqual(data["answers"]["q1"]["translation"]["status"], "error")
        self.assertNotIn("TRANSLATION_PENDING", self.blocker_codes(data))
        with patcher, self.assertLogs("apps.care_pathway.psychotherapy", "WARNING"):
            with self.captureOnCommitCallbacks(execute=True):
                self.act("care-psy-note-generate", nid)
        data = self.detail(nid)
        self.assertEqual(data["processing"]["status"], "error")
        self.assertEqual(data["processing"]["label"], "Organised from your words (rule-based)")
        self.assertIn("Sijalala siku mbili.", data["sections"]["presenting_focus"])
        self.assertIn("REWORD_FAILED", [h["action"] for h in data["history"]])


class AssistGatingTests(ChatTestCase):
    @override_settings(**AI_ON)
    def test_org_switches_and_client_consent_both_gate_ai(self):
        patcher, client = self.ai_client()
        self.set_org(psy_ai_enabled=False)
        self.assertFalse(
            self.client.get(reverse("care-psy-config"), **self.auth).data["ai_enabled"]
        )
        nid = self.start().data["id"]
        with patcher, self.captureOnCommitCallbacks(execute=True):
            data = self.say(nid, "q1", "Sijalala siku mbili.", language="sw-KE").data
        self.assertEqual(data["answers"]["q1"]["translation"]["status"], "unavailable")
        self.set_org(psy_ai_enabled=True)
        self.ai_consent(False)
        with patcher, self.captureOnCommitCallbacks(execute=True):
            data = self.say(nid, "q1", "Sijalala siku tatu.", language="sw-KE").data
        self.assertEqual(data["answers"]["q1"]["translation"]["status"], "unavailable")
        generated = self.act("care-psy-note-generate", nid).data
        self.assertIn("has not agreed", generated["processing"]["reason"])
        client.beta.messages.create.assert_not_called()
        self.ai_consent(True)
        with patcher, self.captureOnCommitCallbacks(execute=True):
            data = self.say(nid, "q1", "Sijalala siku nne.", language="sw-KE").data
        self.assertEqual(self.detail(nid)["answers"]["q1"]["translation"]["status"], "done")

    def test_org_admin_turns_on_only_what_super_admin_allowed_with_attestation(self):
        from apps.accounts.models import Role

        url = reverse("care-psy-assist-settings")
        self.set_org(psy_ai_allowed=False, psy_ai_enabled=False)
        self.assertEqual(
            self.client.put(
                url, {"ai_enabled": True, "attest": True}, format="json", **self.auth
            ).status_code,
            403,
        )
        with platform_admin_context():
            role, _ = Role.objects.get_or_create(
                organization=None, name="Org Admin", defaults={"scope": Role.SCOPE_ORG_TEMPLATE}
            )
            self.nurse.roles.add(role)
        self.assertEqual(
            self.client.put(
                url, {"ai_enabled": True, "attest": True}, format="json", **self.auth
            ).status_code,
            400,
        )  # not allowed by Super Admin
        self.set_org(psy_ai_allowed=True, psy_dictation_allowed=True)
        self.assertEqual(
            self.client.put(url, {"ai_enabled": True}, format="json", **self.auth).status_code, 400
        )
        data = self.client.put(
            url,
            {"ai_enabled": True, "dictation_enabled": True, "attest": True},
            format="json",
            **self.auth,
        ).data
        self.assertTrue(data["ai_enabled"] and data["dictation_enabled"])
        self.assertIn("(Org Admin)", data["changed_by"])
        config = self.client.get(reverse("care-psy-config"), **self.auth).data
        self.assertTrue(config["dictation_enabled"])
        # Turning off needs no attestation.
        self.assertFalse(
            self.client.put(url, {"dictation_enabled": False}, format="json", **self.auth).data[
                "dictation_enabled"
            ]
        )

    def test_super_admin_withdrawing_permission_switches_it_off(self):
        from apps.tenancy.serializers import OrganizationSerializer

        self.set_org(psy_ai_allowed=True, psy_ai_enabled=True)
        with platform_admin_context():
            org = self.nurse.organization
            serializer = OrganizationSerializer(org, data={"psy_ai_allowed": False}, partial=True)
            self.assertTrue(serializer.is_valid(), serializer.errors)
            serializer.save()
            org.refresh_from_db()
        self.assertFalse(org.psy_ai_enabled)
        self.assertTrue(org.psy_assist_changed_at)


class SectionEditTests(ChatTestCase):
    def test_edit_is_kept_apart_survives_regenerate_and_revert_restores_generated(self):
        nid = self.start().data["id"]
        self.patch(
            nid,
            {
                "safety_answer": "NO",
                **self.answers(q1="Talked about work.", q5="Review next week."),
            },
        )
        self.act("care-psy-note-generate", nid)
        edited = self.patch(nid, {"sections": {"plan": "Next steps:\n- My own wording."}}).data
        self.assertEqual(edited["edited_sections"], ["plan"])
        self.say(nid, "q5", "Review in two weeks.")
        data = self.act("care-psy-note-generate", nid).data
        self.assertEqual(
            data["sections"]["plan"], "Next steps:\n- My own wording."
        )  # not overwritten
        self.assertIn("Talked about work.", data["sections"]["presenting_focus"])
        data = self.patch(nid, {"revert_section": "plan"}).data
        self.assertEqual(data["sections"]["plan"], "Next steps:\n- Review in two weeks.")
        self.assertEqual(data["edited_sections"], [])
        self.assertEqual(self.patch(nid, {"revert_section": "plan"}).status_code, 400)

    @override_settings(**AI_ON)
    def test_rewording_never_touches_a_clinician_edited_section(self):
        patcher, _ = self.ai_client()
        nid = self.start().data["id"]
        self.patch(
            nid,
            {
                "safety_answer": "NO",
                **self.answers(q1="Talked about work.", q5="Review next week."),
            },
        )
        with patcher, self.captureOnCommitCallbacks(execute=True):
            self.act("care-psy-note-generate", nid)
        self.patch(nid, {"sections": {"plan": "My plan wording."}})
        with patcher, self.captureOnCommitCallbacks(execute=True):
            self.act("care-psy-note-generate", nid)
        data = self.detail(nid)
        self.assertEqual(data["sections"]["plan"], "My plan wording.")
        self.assertTrue(data["sections"]["presenting_focus"].startswith("- Reworded"))
        self.assertEqual(data["processing"]["sections"]["presenting_focus"]["source"], "ai")


class SafetyChecklistTests(ChatTestCase):
    def test_eight_served_concern_categories(self):
        config = self.client.get(reverse("care-psy-config"), **self.auth).data
        self.assertEqual(
            [c["label"] for c in config["concerns"]["categories"]],
            [
                "Suicide",
                "Self-harm",
                "Harm to others",
                "Abuse or exploitation",
                "Severe deterioration",
                "Intoxication or withdrawal",
                "Inability to care for self",
                "Other immediate safety concern",
            ],
        )
        suicide = config["concerns"]["categories"][0]
        self.assertEqual(suicide["register_row"], "suicide")
        self.assertIn("Thoughts", suicide["options"])
        self.assertEqual(len(config["safety_actions"]), 6)

    def test_yes_categories_actions_and_linked_risk_record_on_the_note(self):
        from .models import SafetyPlan

        nid = self.start().data["id"]
        data = self.patch(nid, {"safety_answer": "YES"}).data
        self.assertNotIn("safety_plan_reviewed", [a["code"] for a in data["safety_action_options"]])
        detail = {
            "concerns": [
                {"category": "suicide", "options": ["Thoughts"]},
                {"category": "severe_deterioration"},
            ],
            "description": "Passive wish to disappear.",
            "action_codes": ["safety_plan_reviewed"],
        }
        self.assertEqual(
            self.patch(nid, {"safety_detail": detail}).status_code, 400
        )  # no active plan
        with platform_admin_context():
            plan = SafetyPlan.objects.create(
                organization=self.org, patient_id=self.pid, signed_at=timezone.now()
            )
        detail["action_codes"] = ["safety_plan_reviewed", "supervisor_consulted"]
        self.assertEqual(self.patch(nid, {"safety_detail": detail}).status_code, 200)
        bad = {**detail, "concerns": [{"category": "suicide", "options": ["Invented"]}]}
        self.assertEqual(self.patch(nid, {"safety_detail": bad}).status_code, 400)
        self.assertEqual(
            [(p["row"], p["option"]) for p in self.get("care-client-proposals").data["results"]],
            [("suicide", "Thoughts")],
        )
        data = self.ready(nid, **self.answers(q1="Hard week.")).data
        self.assertIn("RISK_LINK", self.blocker_codes(data))
        data = self.patch(nid, {"link_risk_assessment": True}).data
        link = data["safety_detail"]["risk_link"]
        data = self.ready(nid).data
        risk = data["sections"]["risk_safety"]
        self.assertIn(
            f"Linked risk assessment: {link['display_id']} (opened {link['opened']})", risk
        )
        self.assertIn(
            f"- Safety plan {plan.pk.hex[:8].upper()} (version 1) reviewed with client", risk
        )
        self.assertIn("- Supervisor / senior clinician consulted", risk)
        self.assertIn("Suicide — Thoughts; Severe deterioration", risk)
        item = next(i for i in data["checklist"]["items"] if i["key"] == "safety_yes")
        self.assertTrue(item["done"])
        self.assertEqual(self.act("care-psy-note-sign", nid).data["status"], "SIGNED")

    def test_not_assessed_needs_reason_and_acknowledgement_tick(self):
        nid = self.start().data["id"]
        self.patch(nid, {"safety_answer": "NOT_ASSESSED", **self.answers(q1="Short session.")})
        self.patch(nid, {"not_assessed_reason": "Client arrived late and left early."})
        self.assertEqual(
            self.patch(nid, {"acknowledge_not_assessed": {}}).status_code, 400
        )  # no tick
        data = self.patch(nid, {"acknowledge_not_assessed": {"acknowledged": True}}).data
        self.assertEqual(data["safety_ack"]["reason"], "Client arrived late and left early.")
        data = self.ready(nid).data
        self.assertTrue(
            next(i for i in data["checklist"]["items"] if i["key"] == "safety_na")["done"]
        )
        self.assertEqual(data["blockers"], [])

    def test_flagged_language_blocks_sign_whatever_the_answer_until_marked_reviewed(self):
        nid = self.start().data["id"]
        data = self.ready(
            nid,
            safety_answer="NOT_ASSESSED",
            not_assessed_reason="Ran out of time.",
            **self.answers(q2="Said she wants to die sometimes."),
        ).data
        self.patch(nid, {"acknowledge_not_assessed": {"acknowledged": True}})
        data = self.ready(nid).data
        self.assertIn("DETECTION_UNREVIEWED", self.blocker_codes(data))
        flags = next(i for i in data["checklist"]["items"] if i["key"] == "flags")
        self.assertEqual((flags["done"], flags["detail"]), (False, "0/1"))
        for d in data["detections"]:
            self.patch(nid, {"resolve_detection": {"key": d["key"]}})  # one click, no reason needed
        data = self.ready(nid).data
        self.assertEqual(data["blockers"], [])
        self.assertEqual(data["detections"][0]["resolution"]["by"], "Jane Njoroge")
        self.assertIn("REVIEW_DETECTION", [h["action"] for h in data["history"]])


class ModelAndGoalTests(ChatTestCase):
    def test_named_included_suggested_excluded_until_the_clinician_decides(self):
        nid = self.start().data["id"]
        data = self.patch(nid, self.answers(q3=SAMPLE["q3"], q4=SAMPLE["q4"])).data
        found = {m["code"]: m for m in data["models_detected"]}
        self.assertEqual((found["cbt"]["how"], found["cbt"]["included"]), ("named", True))
        mi = found["motivational_interviewing"]
        self.assertEqual((mi["how"], mi["included"]), ("suggested", False))
        stigma = next(
            f for f in data["flags"] if f["term"].lower() == "resistance"
        )  # advisory only
        self.assertIn("expressed reservations about", stigma["suggestion"])
        self.assertEqual(
            self.ready(nid, safety_answer="NO").data["models_applied"],
            [{"code": "cbt", "name": "CBT", "version": "1"}],
        )
        self.patch(
            nid, {"model_decision": {"code": "motivational_interviewing", "decision": "INCLUDE"}}
        )
        self.patch(nid, {"model_decision": {"code": "cbt", "decision": "EXCLUDE"}})
        data = self.ready(nid).data
        self.assertEqual([m["code"] for m in data["models_applied"]], ["motivational_interviewing"])
        self.assertIn(
            "Approach(es) identified by clinician: Motivational Interviewing",
            data["sections"]["interventions"],
        )
        self.assertEqual(
            self.patch(nid, {"model_decision": {"code": "dbt", "decision": "INCLUDE"}}).status_code,
            400,
        )

    def test_four_goal_decisions_and_sign_waits_for_every_suggestion(self):
        self.set_goals(
            "Handle arguments with my partner calmly",
            "Reduce drinking after arguments",
            "Sleep through the night",
            "Walk with my partner daily",
        )
        nid = self.start().data["id"]
        q4 = (
            "Walked away during an argument with her partner. Drinking after arguments continued. "
            "Sleep was still broken. Partner walks were enjoyable."
        )
        data = self.ready(nid, safety_answer="NO", **self.answers(q4=q4)).data
        self.assertEqual(len(data["goal_suggestions"]), 4)
        self.assertIn("GOALS_UNRESOLVED", self.blocker_codes(data))
        self.assertNotIn(
            "Treatment-plan goals", data["sections"]["response"]
        )  # nothing until decided
        for index, decision in enumerate(["PROGRESS", "BARRIER", "NO_CHANGE", "NOT_RELEVANT"]):
            self.assertEqual(
                self.patch(
                    nid, {"goal_link": {"goal_index": index, "decision": decision}}
                ).status_code,
                200,
            )
        data = self.ready(nid).data
        response = data["sections"]["response"]
        self.assertIn("Treatment-plan goals (clinician confirmed):", response)
        self.assertIn(
            "- G1 Handle arguments with my partner calmly: progress noted. Session detail: Walked "
            "away "
            "during an argument with her partner.",
            response,
        )
        self.assertIn("- G2 Reduce drinking after arguments: barrier or setback noted.", response)
        self.assertIn("- G3 Sleep through the night: no clear change noted.", response)
        self.assertNotIn("G4", response)
        self.assertEqual(data["blockers"], [])
        goals = next(i for i in data["checklist"]["items"] if i["key"] == "goals")
        self.assertEqual(goals["detail"], "4/4")

    def test_legacy_confirmed_links_on_a_signed_note_are_left_as_signed(self):
        from .models import PsychotherapyNote

        nid = self.start().data["id"]
        self.ready(nid, safety_answer="NO", **self.answers(q1="Talked."))
        self.act("care-psy-note-sign", nid)
        legacy = [
            {
                "goal_index": 0,
                "goal": "Sleep",
                "statement": "Slept better.",
                "status": "CONFIRMED",
                "by": "Jane Njoroge",
                "at": "2026-01-01T00:00:00+00:00",
            }
        ]
        with platform_admin_context():
            PsychotherapyNote.objects.filter(pk=nid).update(goal_links=legacy)
        data = self.detail(nid)
        self.assertEqual(data["goal_links"], legacy)
        self.assertEqual(data["goal_suggestions"], [])
        self.assertIsNone(data["checklist"])


class ClientListTests(ChatTestCase):
    def test_list_shows_counts_only_with_full_access_and_is_audit_logged(self):
        from apps.sysadmin_audit.models import AuditLogEntry

        nid = self.start().data["id"]
        self.ready(nid, safety_answer="NO", **self.answers(q1="Talked."))
        self.act("care-psy-note-sign", nid)
        url = reverse("care-psy-clients")
        row = next(
            r
            for r in self.client.get(url, **self.psych_auth).data["results"]
            if r["patient_id"] == self.pid
        )
        self.assertTrue(row["restricted"])
        self.assertNotIn("sessions_recorded", row)
        self.assertEqual(row["episode_id"], self.eid)
        with platform_admin_context():
            CareTeamMembership.objects.create(
                organization=self.org, patient_id=self.pid, user=self.nurse, role="THERAPIST"
            )
        data = self.client.get(url, **self.auth).data
        row = next(r for r in data["results"] if r["patient_id"] == self.pid)
        self.assertEqual(row["sessions_recorded"], 1)
        self.assertIsNotNone(row["last_session"])
        self.assertIsNone(row["next_appointment"])
        with platform_admin_context():
            entry = AuditLogEntry.objects.filter(
                model="care_pathway.psychotherapynote", object_id="client-list"
            ).first()  # newest first
        self.assertIn(self.pid, entry.field_diff["patients"])


class FamilyQuestionnaireTests(ChatTestCase):
    def test_new_family_draft_uses_its_own_questions_and_requires_consent_for_contacts(self):
        response = self.start(session_type="FAMILY")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["questionnaire_version"], org.FAMILY_QUESTIONNAIRE)
        configured = self.client.get(reverse("care-psy-config"), **self.auth)
        self.assertEqual(configured.status_code, 200)
        self.assertEqual(
            [
                question["key"]
                for question in configured.data["questionnaires"][org.FAMILY_QUESTIONNAIRE]
            ],
            list(org.FAMILY_QUESTION_KEYS),
        )
        self.assertEqual(
            [
                question["title"]
                for question in configured.data["questionnaires"][org.FAMILY_QUESTIONNAIRE]
            ],
            [
                "Clinicians in the session",
                "Family present",
                "Key issues discussed",
                "Family dynamics observed",
                "Interventions used",
                "Progress made toward the goals",
                "Areas needing attention",
                "Recommendations",
            ],
        )
        options = self.detail(response.data["id"])["participant_options"]
        self.assertTrue(options["family_consent_required"])
        self.assertEqual(options["family"], [])

    def test_family_attendees_and_custom_answers_are_saved_and_organised(self):
        response = self.start(session_type="FAMILY")
        self.assertEqual(response.status_code, 201, response.data)
        note_id = response.data["id"]
        answers = {
            "family_clinicians": {
                "participant_ids": [str(self.nurse.pk)],
                "none_present": False,
            },
            "family_present": {"participant_ids": [], "none_present": True},
            "family_issues": {
                "text": "The family discussed communication at home.",
                "mode": "TYPED",
            },
            "family_dynamics": {"text": "Members took turns speaking.", "mode": "TYPED"},
            "family_interventions": {"text": "Practised reflective listening.", "mode": "TYPED"},
            "family_progress": {"text": "They agreed on a weekly check-in.", "mode": "TYPED"},
            "family_attention": {"text": "Review conflict escalation.", "mode": "TYPED"},
            "family_recommendations": {"text": "Continue family sessions.", "mode": "TYPED"},
        }
        saved = self.patch(note_id, {"answers": answers})
        self.assertEqual(saved.status_code, 200, saved.data)
        self.assertEqual(
            saved.data["answers"]["family_clinicians"]["participants"][0]["resource_type"],
            "Practitioner",
        )
        self.assertEqual(
            saved.data["answers"]["family_present"]["text"], "No family members were present."
        )
        generated = self.act("care-psy-note-generate", note_id)
        self.assertEqual(generated.status_code, 200, generated.data)
        self.assertIn(
            "The family discussed communication at home.",
            generated.data["sections"]["presenting_focus"],
        )
        self.assertEqual(generated.data["sections"]["assessment"], "- Members took turns speaking.")
        for section in (
            generated.data["sections"]["presenting_focus"],
            generated.data["sections"]["assessment"],
            generated.data["sections"]["interventions"],
            generated.data["sections"]["response"],
        ):
            self.assertNotIn("Client report:", section)
            self.assertNotIn("Clinician observation / assessment:", section)
            self.assertNotIn("Session work and interventions:", section)
            self.assertNotIn("Client response as observed:", section)
        self.assertIn("Continue family sessions.", generated.data["sections"]["plan"])

    def test_family_draft_coexists_without_reclassifying_an_individual_draft(self):
        individual = self.start()
        self.assertEqual(individual.status_code, 201)
        family = self.start(session_type="FAMILY")
        self.assertEqual(family.status_code, 201, family.data)
        self.assertNotEqual(family.data["id"], individual.data["id"])
        self.assertEqual(family.data["questionnaire_version"], org.FAMILY_QUESTIONNAIRE)
        self.assertEqual(family.data["session_type"], "FAMILY")
        resumed_family = self.start(session_type="FAMILY")
        self.assertEqual(
            (resumed_family.status_code, resumed_family.data["id"]), (200, family.data["id"])
        )
        existing_individual = self.detail(individual.data["id"])
        self.assertEqual(existing_individual["questionnaire_version"], org.INDIVIDUAL_QUESTIONNAIRE)
        self.assertEqual(existing_individual["session_type"], "INDIVIDUAL")


class FamilySessionListTests(PsyNoteTestCase):
    def test_list_includes_family_drafts_and_signed_notes_but_not_individual_notes(self):
        family = self.start().data["id"]
        self.patch(family, {"session_type": "FAMILY"})
        response = self.client.get(reverse("care-psy-family-sessions"), **self.auth)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [(row["id"], row["status"]) for row in response.data["results"]],
            [(family, "DRAFT")],
        )

        self.ready(family, safety_answer="NO", **self.answers(q1="Family session."))
        self.assertEqual(self.act("care-psy-note-sign", family).data["status"], "SIGNED")

        individual = self.start().data["id"]
        self.patch(individual, {"session_type": "INDIVIDUAL"})
        response = self.client.get(reverse("care-psy-family-sessions"), **self.auth)
        self.assertEqual(
            [(row["id"], row["status"]) for row in response.data["results"]],
            [(family, "SIGNED")],
        )
        self.assertTrue(all(row["patient_id"] == self.pid for row in response.data["results"]))

    def test_list_does_not_disclose_a_non_care_team_clinicians_family_note(self):
        note = self.start().data["id"]
        self.patch(note, {"session_type": "FAMILY"})
        response = self.client.get(reverse("care-psy-family-sessions"), **self.psych_auth)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["results"], [])

    def test_list_access_is_audited(self):
        from apps.sysadmin_audit.models import AuditLogEntry

        note = self.start().data["id"]
        self.patch(note, {"session_type": "FAMILY"})
        self.client.get(reverse("care-psy-family-sessions"), **self.auth)
        with platform_admin_context():
            entry = AuditLogEntry.objects.filter(
                model="care_pathway.psychotherapynote", object_id="family-session-list"
            ).first()
        self.assertIn(note, entry.field_diff["notes"])


class OrganizerChatUnitTests(PsyNoteTestCase):
    def test_translation_is_screened_for_risk_language_too(self):
        answers = {
            "q2": {
                "text": "Anasema anataka kufa.",
                "translation": {"status": "done", "text": "She says she wants to die."},
            }
        }
        found = org.detect_risk_language(
            answers, [{"id": 1, "category": "suicide", "phrase": "wants to die"}]
        )
        self.assertEqual([(d["key"], d["source"]) for d in found], [("q2~en:1", "translation")])

    def test_cutting_down_is_a_reduction_goal_but_cutting_alone_still_flags(self):
        terms = [{"id": 1, "category": "self_harm", "phrase": "cutting"}]

        def flagged(text):
            return [d["matched"] for d in org.detect_risk_language({"q2": {"text": text}}, terms)]

        self.assertEqual(flagged("Working on cutting down drinking and cutting back on khat."), [])
        self.assertEqual(flagged("He has been cutting again."), ["cutting"])
        self.assertEqual(flagged("Cutting out beer, but still cutting at night."), ["cutting"])

    def test_reworded_sections_keep_the_deterministic_parts(self):
        fixed = {
            "interventions": "Approach(es) identified by clinician: CBT",
            "response": "Measurement:\n- PHQ-9 total 9",
        }
        self.assertEqual(
            org.compose_reworded("q3", "- Thought record.", fixed),
            "Approach(es) identified by clinician: CBT\n\nSession work and interventions:\n- "
            "Thought record.",
        )
        self.assertTrue(
            org.compose_reworded("q4", "Client felt calmer.", fixed).endswith("PHQ-9 total 9")
        )
