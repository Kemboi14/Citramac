"""Psychotherapy Session note — master prompt §7 (PSY-*), AT-14…AT-18, X-09, X-13."""

import uuid

from django.test import SimpleTestCase
from django.urls import reverse

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.models import Patient
from apps.tenancy.context import platform_admin_context

from . import psy_organizer as org
from .test_records import RecordsTestCase

FORBIDDEN_DENIALS = (
    "denies",
    "denied",
    "no new or changed",
    "no suicidal",
    "no risk",
    "not suicidal",
)


class PsyNoteTestCase(RecordsTestCase):
    def setUp(self):
        super().setUp()
        eid = self.post("care-client-therapy", {"modality": "CBT", "planned_sessions": 8}).data[
            "id"
        ]
        self.post("care-therapy-confidentiality", {}, eid)
        self.eid = eid

    def start(self, auth=None, session_type=None):
        body = {"episode": self.eid}
        if session_type:
            body["session_type"] = session_type
        return self.client.post(
            reverse("care-client-psy-notes", args=[self.pid]),
            body,
            format="json",
            **(auth or self.auth),
        )

    def patch(self, nid, body, auth=None):
        return self.client.patch(
            reverse("care-psy-note", args=[nid]), body, format="json", **(auth or self.auth)
        )

    def act(self, name, nid, body=None):
        return self.client.post(reverse(name, args=[nid]), body or {}, format="json", **self.auth)

    def answers(self, **texts):
        return {"answers": {k: {"text": v, "mode": "TYPE"} for k, v in texts.items()}}

    def ready(self, nid, **body):
        """Save, organise and confirm accuracy — the steps before signing."""
        if body:
            self.assertEqual(self.patch(nid, body).status_code, 200)
        self.assertEqual(self.act("care-psy-note-generate", nid).status_code, 200)
        return self.patch(nid, {"accuracy_confirmed": True})

    def blocker_codes(self, data):
        return {b["code"] for b in data["blockers"]}

    def alerts(self, code):
        from .models import ClinicalAlert

        with platform_admin_context():
            return list(
                ClinicalAlert.objects.filter(patient_id=self.pid, alert_code=code).values_list(
                    "status", flat=True
                )
            )


class DraftAndResumeTests(PsyNoteTestCase):
    def test_resuming_a_draft_keeps_the_session_details_just_entered(self):
        first = self.start()
        self.assertEqual(first.status_code, 201)
        resumed = self.client.post(
            reverse("care-client-psy-notes", args=[self.pid]),
            {
                "episode": self.eid,
                "session_objective": "Process the accident memory",
                "primary_goal": "",
            },
            format="json",
            **self.auth,
        )
        self.assertEqual((resumed.status_code, resumed.data["id"]), (200, first.data["id"]))
        self.assertEqual(
            resumed.data["session"]["session_objective"], "Process the accident memory"
        )

    def test_draft_resumes_server_side_and_stays_out_of_session_lists_until_signed(self):
        first = self.start()
        self.assertEqual(first.status_code, 201)
        self.assertEqual(first.data["watermark"], "DRAFT — CLINICIAN REVIEW REQUIRED")
        again = self.start()
        self.assertEqual(
            (again.status_code, again.data["id"]), (200, first.data["id"])
        )  # X-09 resume
        self.patch(first.data["id"], self.answers(q1="Wanted to talk about sleep."))
        self.assertEqual(self.get("care-client-psy-notes").data["results"][0]["status"], "DRAFT")
        self.assertEqual(
            self.get("care-client-psy-notes").data["results"][0]["draft_saved_at"] is not None, True
        )
        resumed = self.client.get(
            reverse("care-psy-note", args=[first.data["id"]]), **self.auth
        ).data
        self.assertEqual(resumed["answers"]["q1"]["text"], "Wanted to talk about sleep.")
        overview = self.get("care-client-therapy").data["results"][0]
        self.assertEqual(overview["sessions"], [])
        mhp = self.client.get(
            reverse("psychotherapy-session-list"), {"patient": self.pid}, **self.auth
        )
        if mhp.status_code == 200:
            rows = mhp.data["results"] if isinstance(mhp.data, dict) else mhp.data
            self.assertEqual(rows, [])

    def test_context_panel_carries_goals_previous_note_risk_and_safety_plan(self):
        ctx = self.start().data["context"]
        self.assertEqual(set(ctx), {"goals", "previous_note", "risk", "safety_plan", "diagnoses"})

    def test_a_new_session_waits_until_the_unsigned_one_is_finished(self):
        first = self.start()
        self.assertEqual(first.status_code, 201, first.data)
        # The same clinician resumes their unsigned session rather than opening a second.
        again = self.start()
        self.assertEqual(again.data["id"], first.data["id"])
        # Another clinician cannot start a new one while it is unsigned.
        other = self.start(auth=self.psych_auth)
        self.assertEqual(other.status_code, 400, other.data)
        self.assertIn("not signed yet", str(other.data))

    def test_other_staff_without_care_team_access_cannot_read_or_change_the_note(self):
        nid = self.start().data["id"]
        self.assertEqual(
            self.client.get(reverse("care-psy-note", args=[nid]), **self.psych_auth).status_code,
            403,
        )
        self.assertEqual(
            self.patch(nid, self.answers(q1="x"), auth=self.psych_auth).status_code, 403
        )
        listed = self.client.get(
            reverse("care-client-psy-notes", args=[self.pid]), **self.psych_auth
        ).data["results"]
        self.assertTrue(listed[0]["restricted"])
        self.assertNotIn("safety_answer", listed[0])


class SafetyQuestionTests(PsyNoteTestCase):
    def test_unanswered_safety_question_blocks_signing(self):  # PSY-S-04
        nid = self.start().data["id"]
        data = self.ready(nid, **self.answers(q1="Talked about work stress.")).data
        self.assertIn("SAFETY_UNANSWERED", self.blocker_codes(data))
        self.assertEqual(self.act("care-psy-note-sign", nid).status_code, 400)

    def test_no_states_no_new_concern_bounded_to_todays_assessment(self):  # PSY-S-02
        nid = self.start().data["id"]
        data = self.ready(
            nid, safety_answer="NO", **self.answers(q1="Talked about work stress.")
        ).data
        self.assertIn("based on today's assessment", data["sections"]["risk_safety"])
        self.assertEqual(self.act("care-psy-note-sign", nid).data["status"], "SIGNED")

    def test_yes_raises_alert_and_queues_register_findings_for_the_clinician(self):  # PSY-S-01
        nid = self.start().data["id"]
        data = self.patch(nid, {"safety_answer": "YES"}).data
        self.assertEqual(self.alerts("PSYCHOTHERAPY_SAFETY_CONCERN"), ["ACTIVE"])
        self.assertIn("SAFETY_DETAIL", self.blocker_codes(data))
        self.patch(
            nid,
            {
                "safety_detail": {
                    "concerns": [
                        {"row": "suicide", "option": "Thoughts"},
                        {"other": "intoxication_withdrawal"},
                    ],
                    "description": "New passive thoughts this week.",
                    "actions": "Safety plan reviewed together.",
                }
            },
        )
        bad = self.patch(
            nid, {"safety_detail": {"concerns": [{"row": "suicide", "option": "Invented"}]}}
        )
        self.assertEqual(bad.status_code, 400)
        proposals = self.get("care-client-proposals").data["results"]
        self.assertEqual(
            [(p["row"], p["option"], p["status"]) for p in proposals],
            [("suicide", "Thoughts", "PROPOSED")],
        )
        self.assertEqual(self.alerts("PSYCHOTHERAPY_SAFETY_CONCERN"), ["ACTIVE"])  # not duplicated
        self.assertIn(
            "RISK_LINK", self.blocker_codes(self.patch(nid, {"accuracy_confirmed": False}).data)
        )
        self.assertEqual(self.patch(nid, {"link_risk_assessment": True}).status_code, 200)
        data = self.ready(nid, **self.answers(q2="Appeared tired.")).data
        risk = data["sections"]["risk_safety"]
        self.assertIn("Suicide / self-harm — Thoughts", risk)
        self.assertIn("Intoxication or withdrawal", risk)
        self.assertIn("No signed safety plan on record.", risk)
        from . import attention

        with platform_admin_context():
            live = attention.active_alerts(Patient.objects.get(pk=self.pid))
        self.assertIn(
            ("high", "Psychotherapy session"), {(a["severity"], a["source"]) for a in live}
        )
        self.assertEqual(self.act("care-psy-note-sign", nid).data["status"], "SIGNED")


class AT14NotAssessedTests(PsyNoteTestCase):
    def test_not_assessed_never_yields_a_denial_and_blocks_sign_until_acknowledged(self):
        nid = self.start().data["id"]
        data = self.ready(
            nid,
            safety_answer="NOT_ASSESSED",
            **self.answers(q1="Wanted to discuss her relationship.", q2="Tearful at times."),
        ).data
        self.assertEqual(self.alerts("SAFETY_NOT_ASSESSED"), ["ACTIVE"])
        self.assertIn("SAFETY_NOT_ASSESSED", self.blocker_codes(data))
        text = data["rendered"].lower()
        for phrase in FORBIDDEN_DENIALS:
            self.assertNotIn(phrase, text)
        self.assertIn("Safety was not assessed in this session.", data["sections"]["risk_safety"])
        self.assertEqual(self.act("care-psy-note-sign", nid).status_code, 400)
        self.assertEqual(
            self.patch(nid, {"acknowledge_not_assessed": {"reason": ""}}).status_code, 400
        )
        self.patch(
            nid,
            {
                "acknowledge_not_assessed": {
                    "reason": "Session ended early — client left for childcare.",
                    "acknowledged": True,
                }
            },
        )
        self.assertEqual(self.alerts("SAFETY_NOT_ASSESSED"), ["RESOLVED"])
        data = self.ready(nid).data
        self.assertEqual(data["blockers"], [])
        self.assertIn("client left for childcare", data["sections"]["risk_safety"])
        for phrase in FORBIDDEN_DENIALS:
            self.assertNotIn(phrase, data["rendered"].lower())
        self.assertEqual(self.act("care-psy-note-sign", nid).data["status"], "SIGNED")


class AT15RiskDetectionTests(PsyNoteTestCase):
    def test_detection_prompts_only_and_mismatch_with_no_must_be_resolved(self):
        nid = self.start().data["id"]
        q2 = "Mood low. Client said she has had thoughts of ending it since the argument."
        data = self.ready(nid, safety_answer="NO", **self.answers(q2=q2)).data
        hit = next(d for d in data["detections"] if d["matched"].lower() == "ending it")
        self.assertEqual(
            hit["prompt"],
            "Potential safety concern detected. Please review and complete the "
            "appropriate risk assessment.",
        )
        self.assertEqual(q2[hit["start"] : hit["end"]], "ending it")
        self.assertIn("thoughts of ending it", hit["passage"])
        self.assertIn("DETECTION_UNREVIEWED", self.blocker_codes(data))
        self.assertEqual(self.act("care-psy-note-sign", nid).status_code, 400)
        # No automatic risk label: nothing written to the alerts or the risk register.
        self.assertEqual(self.alerts("PSYCHOTHERAPY_SAFETY_CONCERN"), [])
        self.assertEqual(self.get("care-client-proposals").data["results"], [])
        self.assertNotIn("high risk", data["rendered"].lower())
        for d in data["detections"]:
            self.patch(
                nid,
                {
                    "resolve_detection": {
                        "key": d["key"],
                        "reason": "Reviewed with client: past thoughts, "
                        "already on the risk register.",
                    }
                },
            )
        data = self.ready(nid).data
        self.assertEqual(data["blockers"], [])
        self.assertIn("reviewed by the clinician", data["sections"]["risk_safety"])
        self.assertEqual(self.act("care-psy-note-sign", nid).data["status"], "SIGNED")

    def test_lexicon_is_served_data(self):
        from .models import ClinicalLexiconTerm

        nid = self.start().data["id"]
        with platform_admin_context():
            ClinicalLexiconTerm.objects.create(
                lexicon="PSY_RISK", category="other", phrase="purple elephant"
            )
        data = self.patch(nid, self.answers(q1="Mentioned a purple elephant.")).data
        self.assertTrue(any(d["matched"] == "purple elephant" for d in data["detections"]))

    def test_third_person_and_kiswahili_phrases_are_prompted(self):
        nid = self.start().data["id"]
        data = self.patch(
            nid,
            self.answers(
                q1="She said sometimes she wishes she could just disappear for a while.",
                q2="Her partner said she wants to kill herself.",
                q4="Alisema anataka kufa.",
            ),
        ).data
        matched = {d["question"]: d["matched"].lower() for d in data["detections"]}
        self.assertEqual(matched.get("q1"), "just disappear")
        self.assertEqual(matched.get("q2"), "kill herself")
        self.assertEqual(matched.get("q4"), "anataka kufa")
        # Ordinary language stays quiet.
        quiet = self.patch(
            nid, self.answers(q1="The panic symptoms began to ease by the end.", q2="", q4="")
        ).data
        self.assertEqual(quiet["detections"], [])


class AT16TherapyModelTests(PsyNoteTestCase):
    def test_two_named_models_each_used_only_for_supported_content(self):
        nid = self.start().data["id"]
        q3 = (
            "Used CBT to work on restructuring catastrophic thoughts. "
            "Practised DBT distress tolerance skills for urges."
        )
        data = self.ready(nid, safety_answer="NO", **self.answers(q3=q3)).data
        self.assertEqual({m["code"] for m in data["models_applied"]}, {"cbt", "dbt"})
        section = data["sections"]["interventions"]
        self.assertIn("Approach(es) identified by clinician: CBT, DBT", section)
        self.assertIn("- CBT: Thoughts, restructuring", section)
        self.assertIn("- DBT: distress tolerance", section)
        self.assertNotIn("mindfulness", section.lower())
        self.assertNotIn("Motivational", section)

    def test_no_model_language_when_no_model_is_named(self):
        nid = self.start().data["id"]
        data = self.ready(
            nid, safety_answer="NO", **self.answers(q3="Explored her thoughts about work.")
        ).data
        self.assertEqual(data["models_applied"], [])
        self.assertNotIn("model", data["sections"]["interventions"].lower())

    def test_tf_cbt_is_not_also_read_as_cbt(self):
        nid = self.start().data["id"]
        data = self.ready(
            nid, safety_answer="NO", **self.answers(q3="TF-CBT psychoeducation.")
        ).data
        self.assertEqual([m["code"] for m in data["models_applied"]], ["tf_cbt"])


class AT17RegistryTests(PsyNoteTestCase):
    def test_new_model_added_to_registry_is_used_without_workflow_change(self):
        with platform_admin_context():
            admin = User.objects.create_user(
                email=f"admin-{uuid.uuid4().hex[:6]}@org.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
            role, _ = Role.objects.get_or_create(
                organization=None, name="Org Admin", defaults={"scope": Role.SCOPE_ORG_TEMPLATE}
            )
            admin.roles.add(role)
        admin_auth = {"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(admin)[0]}"}
        body = {
            "name": "Acceptance and Commitment Therapy",
            "aliases": ["ACT"],
            "concepts": ["acceptance", "defusion", "values", "committed action"],
        }
        self.assertEqual(
            self.client.post(
                reverse("care-psy-models"), body, format="json", **self.auth
            ).status_code,
            403,
        )
        created = self.client.post(reverse("care-psy-models"), body, format="json", **admin_auth)
        self.assertEqual(created.status_code, 201)
        config = self.client.get(reverse("care-psy-config"), **self.auth).data
        self.assertEqual(len(config["therapy_models"]), 9)
        self.assertEqual([q["key"] for q in config["questions"]], ["q1", "q2", "q3", "q4", "q5"])
        nid = self.start().data["id"]
        data = self.ready(
            nid,
            safety_answer="NO",
            **self.answers(q3="ACT: worked on defusion from the thought 'I am a failure'."),
        ).data
        self.assertIn(
            "- Acceptance and Commitment Therapy: defusion", data["sections"]["interventions"]
        )
        # Disabled per tenant → no longer offered or applied; the version is kept on revision.
        code = created.data["code"]
        revised = self.client.patch(
            reverse("care-psy-model", args=[code]),
            {"concepts": ["defusion"]},
            format="json",
            **admin_auth,
        )
        self.assertEqual(revised.data["version"], "2")
        self.client.patch(
            reverse("care-psy-model", args=[code]), {"enabled": False}, format="json", **admin_auth
        )
        config = self.client.get(reverse("care-psy-config"), **self.auth).data
        self.assertNotIn(code, [m["code"] for m in config["therapy_models"]])


class AT18SignAndAmendTests(PsyNoteTestCase):
    def test_draft_watermark_seven_sections_editable_then_immutable_with_amendment_trail(self):
        nid = self.start().data["id"]
        data = self.ready(
            nid,
            safety_answer="NO",
            **self.answers(
                q1="Client reported a difficult week at home.",
                q2="Appeared tired; engaged well.",
                q3="Problem solving around the morning routine.",
                q4="Client said the plan felt doable.",
                q5="Try the new routine for one week. Review next session.",
            ),
        ).data
        self.assertEqual(list(data["sections"]), list(org.SECTION_KEYS))
        self.assertTrue(data["rendered"].startswith("DRAFT — CLINICIAN REVIEW REQUIRED"))
        edited = self.patch(
            nid, {"sections": {"plan": "Next steps:\n- Try the new routine for one week."}}
        ).data
        self.assertTrue(edited["sections_edited"])
        self.assertIn("ACCURACY", self.blocker_codes(edited))  # editing needs a fresh confirmation
        self.patch(nid, {"accuracy_confirmed": True})
        signed = self.act("care-psy-note-sign", nid).data
        self.assertEqual((signed["status"], signed["watermark"]), ("SIGNED", None))
        self.assertFalse(signed["rendered"].startswith("DRAFT"))
        self.assertEqual(self.patch(nid, self.answers(q1="changed")).status_code, 400)
        self.assertEqual(self.act("care-psy-note-generate", nid).status_code, 400)
        session_id = signed["session"]["id"]
        mhp = self.client.patch(
            reverse("psychotherapy-session-detail", args=[session_id]),
            {"session_notes": "x"},
            format="json",
            **self.auth,
        )
        self.assertIn(mhp.status_code, (403, 404, 405))
        self.assertEqual(
            self.act(
                "care-psy-note-amend", nid, {"section": "plan", "text": "y", "reason": ""}
            ).status_code,
            400,
        )
        amended = self.act(
            "care-psy-note-amend",
            nid,
            {
                "section": "plan",
                "text": "Next steps:\n- Routine for two weeks.",
                "reason": "Agreed duration was two weeks.",
            },
        )
        self.assertEqual(amended.status_code, 201)
        self.assertEqual(amended.data["sections"]["plan"], "Next steps:\n- Routine for two weeks.")
        trail = amended.data["amendments"][0]
        self.assertEqual(
            (trail["previous_text"], trail["reason"]),
            ("Next steps:\n- Try the new routine for one week.", "Agreed duration was two weeks."),
        )
        from .models import PsychotherapyNote

        with platform_admin_context():
            stored = PsychotherapyNote.objects.get(pk=nid)
            self.assertEqual(
                stored.sections["plan"], "Next steps:\n- Try the new routine for one week."
            )
            self.assertIn("SIGN", [h["action"] for h in stored.history])
            self.assertIn("Try the new routine", stored.session.session_notes)
        overview = self.get("care-client-therapy").data["results"][0]["sessions"]
        self.assertEqual((len(overview), overview[0]["note_id"]), (1, nid))

    def test_client_report_and_clinician_observation_are_separated(self):  # PSY-GEN-3
        nid = self.start().data["id"]
        data = self.ready(
            nid,
            safety_answer="NO",
            **self.answers(
                q2="She said she has not been sleeping. Appeared restless and distracted."
            ),
        ).data
        section = data["sections"]["assessment"]
        self.assertIn(
            "Clinician observation / assessment:\n- Appeared restless and distracted.", section
        )
        self.assertIn("Client report:\n- She said she has not been sleeping.", section)

    def test_stigmatizing_terms_are_flagged_with_a_rewrite_not_replaced(self):  # PSY-GEN-11
        nid = self.start().data["id"]
        data = self.ready(
            nid, safety_answer="NO", **self.answers(q2="Client was manipulative about the plan.")
        ).data
        flag = next(f for f in data["flags"] if f["where"] == "q2")
        self.assertEqual(flag["term"], "manipulative")
        self.assertIn("repeatedly requested a change", flag["suggestion"])
        self.assertIn(
            "manipulative", data["sections"]["assessment"]
        )  # flagged, never silently rewritten


class GoalLinkTests(PsyNoteTestCase):
    def test_progress_toward_a_named_goal_is_suggested_and_only_used_once_confirmed(
        self,
    ):  # PSY-LINK
        from . import services

        with platform_admin_context():
            patient = Patient.objects.get(pk=self.pid)
            plan = services.get_or_create_care_plan(patient, self.nurse)
            plan.goal_items = [
                {"goal": "Handle arguments with my partner more calmly"},
                {"goal": "Sleep through the night"},
            ]
            plan.save()
        nid = self.start().data["id"]
        data = self.ready(
            nid,
            safety_answer="NO",
            **self.answers(
                q4="Client reported walking away to calm down during an argument with her partner."
            ),
        ).data
        suggestion = data["goal_suggestions"][0]
        self.assertEqual(suggestion["goal_index"], 0)
        self.assertNotIn("Progress toward", data["sections"]["response"])
        self.patch(
            nid,
            {
                "goal_link": {
                    "goal_index": 0,
                    "decision": "CONFIRMED",
                    "statement": "Used a healthier coping strategy during relationship conflict.",
                }
            },
        )
        data = self.ready(nid).data
        self.assertIn("Used a healthier coping strategy", data["sections"]["response"])
        self.assertEqual(data["goal_suggestions"], [])


class OrganizerUnitTests(SimpleTestCase):
    def test_empty_answers_are_not_recorded_never_negative(self):
        result = org.organize({}, {"answer": "NOT_ASSESSED"}, {}, [], [])
        self.assertEqual(result["sections"]["presenting_focus"], org.NOT_RECORDED)
        joined = org.render(result["sections"]).lower()
        for phrase in FORBIDDEN_DENIALS:
            self.assertNotIn(phrase, joined)

    def test_every_sentence_comes_from_the_clinician(self):
        answers = {"q1": {"text": "Worried about exams. Sleeping badly."}}
        sections = org.organize(answers, {"answer": "NO"}, {}, [], [])["sections"]
        self.assertEqual(
            sections["presenting_focus"],
            "Client report:\n- Worried about exams.\n- Sleeping badly.",
        )


class SignRecordsDeliveryTests(PsyNoteTestCase):
    def test_signing_records_one_psychotherapy_delivery_without_therapy_content(self):
        from .models import InterventionRecord

        nid = self.start().data["id"]
        self.ready(
            nid, safety_answer="NO", **self.answers(q1="Talked about grief after the funeral.")
        )
        self.assertEqual(self.act("care-psy-note-sign", nid).data["status"], "SIGNED")
        with platform_admin_context():
            records = list(
                InterventionRecord.objects.filter(patient_id=self.pid, module="psychotherapy")
            )
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].intervention, "Individual")
        self.assertNotIn("grief", records[0].note)  # the fact of the session only (§4)
        modules = self.get("care-client-interventions-workspace").data["modules"]
        psy = next(m for m in modules if m["code"] == "psychotherapy")
        self.assertEqual(psy["delivered"], 1)
        self.assertEqual(self.act("care-psy-note-sign", nid).status_code, 400)  # signed once
        with platform_admin_context():
            self.assertEqual(
                InterventionRecord.objects.filter(
                    patient_id=self.pid, module="psychotherapy"
                ).count(),
                1,
            )


class TherapistSelfAssessmentTests(PsyNoteTestCase):
    """The therapist's reflection after signing, and the supervision request it
    can raise. Workforce data, kept with the session — no FHIR resource."""

    def signed(self):
        nid = self.start().data["id"]
        self.ready(nid, safety_answer="NO", **self.answers(q1="Talked about a difficult week."))
        self.assertEqual(self.act("care-psy-note-sign", nid).data["status"], "SIGNED")
        return nid

    def reflection(self, **overrides):
        body = {
            "readiness": "YES",
            "countertransference": "NO",
            "pacing": "YES",
            "client_regulated": "YES",
            "unsure": "NO",
            "confident_skill": "Reflective listening",
            "struggle_skill": "",
        }
        body.update(overrides)
        return body

    def assess(self, nid, body=None, auth=None):
        payload = {"answers": body or self.reflection(), "supervision": "NO"}
        return self.client.post(
            reverse("care-psy-note-self-assessment", args=[nid]),
            payload,
            format="json",
            **(auth or self.auth),
        )

    def test_opens_only_after_the_note_is_signed_and_only_for_its_author(self):
        nid = self.start().data["id"]
        self.ready(nid, safety_answer="NO", **self.answers(q1="Talked about sleep."))
        self.assertEqual(self.assess(nid).status_code, 400)
        self.act("care-psy-note-sign", nid)
        self.assertEqual(self.assess(nid, auth=self.psych_auth).status_code, 403)

    def test_hidden_questions_are_dropped_and_every_shown_one_is_required(self):
        nid = self.signed()
        self.assertEqual(self.assess(nid, {"readiness": "YES"}).status_code, 400)
        self.assertEqual(self.assess(nid, self.reflection(readiness="NO")).status_code, 400)
        self.assertEqual(self.assess(nid, self.reflection(client_regulated="NO")).status_code, 400)
        hidden = self.assess(nid, self.reflection(countertransference_detail="dropped"))
        self.assertEqual(hidden.status_code, 200)
        answers = hidden.data["session"]["therapist_self_assessment"]["answers"]
        self.assertNotIn("countertransference_detail", answers)
        self.assertNotIn("grounding_used", answers)  # only shown when the client was not
        shown = self.assess(
            nid,
            self.reflection(client_regulated="NO", grounding_used="YES"),
        )
        self.assertEqual(
            shown.data["session"]["therapist_self_assessment"]["answers"]["grounding_used"], "YES"
        )

    def test_the_reflection_is_returned_to_its_author_only(self):
        nid = self.signed()
        saved = self.assess(
            nid, self.reflection(readiness="SOMEWHAT", readiness_impact="Poor sleep")
        )
        self.assertEqual(saved.status_code, 200)
        record = saved.data["session"]["therapist_self_assessment"]
        self.assertTrue(record["completed_at"])
        self.assertEqual(record["answers"]["readiness_impact"], "Poor sleep")
        self.assertEqual(record["supervision"]["decision"], "NO")

    def test_supervision_request_is_raised_once_with_a_readable_note(self):
        from apps.mhp_program.models import SupervisionRequest

        nid = self.signed()
        payload = {
            "answers": self.reflection(
                unsure="YES", unsure_detail="Froze when the disclosure came."
            ),
            "supervision": "YES",
            "supervision_focus": "How to respond to a disclosure without steering it.",
            "request_supervision": True,
        }
        first = self.client.post(
            reverse("care-psy-note-self-assessment", args=[nid]),
            payload,
            format="json",
            **self.auth,
        )
        self.assertEqual(first.status_code, 200)
        record = first.data["session"]["therapist_self_assessment"]
        self.assertTrue(record["supervision"]["request_id"])
        self.assertEqual(record["supervision"]["request_status"], "OPEN")
        with platform_admin_context():
            rows = list(SupervisionRequest.objects.filter(patient_id=self.pid))
        self.assertEqual(len(rows), 1)
        self.assertIn("Clinical decisions: Yes", rows[0].notes)
        self.assertIn("Supervision focus: How to respond", rows[0].notes)
        self.assertNotIn("{", rows[0].notes)  # readable text, never the stored JSON
        self.assertIn("self-assessment", rows[0].topic.lower())
        # The request names the note it came from; its author may open it.
        opened = self.client.get(
            reverse("supervision-request-detail", args=[rows[0].pk]), **self.auth
        )
        self.assertEqual(opened.status_code, 200)
        self.assertEqual(opened.data["psychotherapy_note"], str(nid))
        self.assertTrue(opened.data["can_read_note"])
        self.assertNotIn("sections", opened.data)  # the id only, never the content
        self.client.post(
            reverse("care-psy-note-self-assessment", args=[nid]),
            payload,
            format="json",
            **self.auth,
        )
        with platform_admin_context():
            self.assertEqual(SupervisionRequest.objects.filter(patient_id=self.pid).count(), 1)
        # A second save refreshes the open request's readable note, never duplicates it.
        self.client.post(
            reverse("care-psy-note-self-assessment", args=[nid]),
            {**payload, "supervision_focus": "How to stay with the feeling without steering."},
            format="json",
            **self.auth,
        )
        with platform_admin_context():
            rows = list(SupervisionRequest.objects.filter(patient_id=self.pid))
        self.assertEqual(len(rows), 1)
        self.assertIn("How to stay with the feeling", rows[0].notes)
        # The open request is never withdrawn from the reflection screen.
        refused = self.client.post(
            reverse("care-psy-note-self-assessment", args=[nid]),
            {**payload, "supervision": "NO", "request_supervision": False},
            format="json",
            **self.auth,
        )
        self.assertEqual(refused.status_code, 400)

    def test_a_reflection_can_be_saved_before_supervision_is_requested(self):
        nid = self.signed()
        saved = self.client.post(
            reverse("care-psy-note-self-assessment", args=[nid]),
            {"answers": self.reflection(), "supervision": ""},
            format="json",
            **self.auth,
        )
        self.assertEqual(saved.status_code, 200)
        record = saved.data["session"]["therapist_self_assessment"]
        self.assertFalse(record["supervision"]["request_id"])
        self.assertIsNone(record["supervision"]["request_status"])
        # The dedicated supervision step then raises it and reports its status.
        raised = self.client.post(
            reverse("care-psy-note-self-assessment", args=[nid]),
            {
                "answers": self.reflection(),
                "supervision": "YES",
                "supervision_focus": "How to stay with the disclosure without steering it.",
                "request_supervision": True,
            },
            format="json",
            **self.auth,
        )
        self.assertEqual(raised.status_code, 200)
        record = raised.data["session"]["therapist_self_assessment"]
        self.assertEqual(record["supervision"]["request_status"], "OPEN")

    def test_editing_after_the_request_completes_does_not_raise_another(self):
        from apps.mhp_program.models import SupervisionRequest

        nid = self.signed()
        self.client.post(
            reverse("care-psy-note-self-assessment", args=[nid]),
            {
                "answers": self.reflection(),
                "supervision": "YES",
                "supervision_focus": "How to respond to the disclosure.",
                "request_supervision": True,
            },
            format="json",
            **self.auth,
        )
        with platform_admin_context():
            SupervisionRequest.objects.filter(patient_id=self.pid).update(status="COMPLETED")
        # Editing the reflection keeps the completed request's history and never
        # silently raises a second one.
        edited = self.client.post(
            reverse("care-psy-note-self-assessment", args=[nid]),
            {
                "answers": self.reflection(confident_skill="Staying quiet"),
                "supervision": "YES",
                "supervision_focus": "How to respond to the disclosure.",
                "request_supervision": False,
            },
            format="json",
            **self.auth,
        )
        self.assertEqual(edited.status_code, 200)
        record = edited.data["session"]["therapist_self_assessment"]
        self.assertEqual(record["supervision"]["request_status"], "COMPLETED")
        with platform_admin_context():
            self.assertEqual(SupervisionRequest.objects.filter(patient_id=self.pid).count(), 1)
