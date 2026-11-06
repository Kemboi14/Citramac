"""v3 SOAP notes copied into the one progress-note store (soap_archive.py)."""

from django.urls import reverse

from apps.clinical_encounter.models import Encounter, SoapNote
from apps.tenancy.context import platform_admin_context, set_branch_scope, set_tenant_context
from apps.tenancy.models import Branch

from . import soap_archive
from .models import LocalConcept, LocalValueSet, ProgressNote
from .test_records import RecordsTestCase


class SoapArchiveTests(RecordsTestCase):
    def setUp(self):
        super().setUp()
        with platform_admin_context():
            soap_archive.ensure_note_type(LocalValueSet, LocalConcept)
            self.encounter = Encounter.objects.create(
                organization=self.org, patient_id=self.pid, opened_by=self.nurse
            )

    def soap(self, **fields):
        with platform_admin_context():
            return SoapNote.objects.create(
                organization=self.org, encounter=self.encounter, author=self.nurse, **fields
            )

    def copy(self):
        with platform_admin_context():
            return soap_archive.copy_soap_notes(SoapNote, ProgressNote)

    def test_a_signed_note_is_copied_signed_with_its_sections_author_and_times(self):
        from django.utils import timezone

        signed_at = timezone.now() - timezone.timedelta(days=30)
        soap = self.soap(
            subjective="Low mood for 3 weeks",
            objective="",
            assessment="Moderate depressive episode",
            plan="Review in 2 weeks",
            is_locked=True,
            signed_at=signed_at,
        )
        self.assertEqual(self.copy(), 1)
        with platform_admin_context():
            note = ProgressNote.objects.get(source_soap_note=soap)
            soap.refresh_from_db()
        self.assertEqual(note.status, "SIGNED")
        self.assertEqual(note.signed_at, signed_at)
        self.assertEqual(note.created_at, soap.created_at)
        self.assertEqual(note.author_id, self.nurse.id)
        self.assertEqual(note.encounter_id, self.encounter.id)
        self.assertEqual(str(note.patient_id), self.pid)
        self.assertEqual(note.note_type, "SOAP_V3")
        self.assertEqual(
            note.text,
            "Subjective:\nLow mood for 3 weeks\n\n"
            "Assessment:\nModerate depressive episode\n\n"
            "Plan:\nReview in 2 weeks",
        )
        # The original is the archive: unchanged and still locked.
        self.assertTrue(soap.is_locked)
        self.assertEqual(soap.subjective, "Low mood for 3 weeks")

    def test_an_unsigned_note_is_a_draft_and_copying_twice_copies_once(self):
        self.soap(subjective="Started, never signed")
        self.assertEqual(self.copy(), 1)
        self.assertEqual(self.copy(), 0)
        with platform_admin_context():
            note = ProgressNote.objects.get()
        self.assertEqual((note.status, note.signed_at), ("DRAFT", None))

    def test_the_record_shows_the_copy_with_its_label_and_the_type_cannot_be_reused(self):
        self.soap(plan="Continue sertraline", is_locked=True)
        self.copy()
        rows = self.get("care-client-notes").data["results"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["note_type_display"], "SOAP note (earlier encounter screen)")
        self.assertEqual(rows[0]["text"], "Plan:\nContinue sertraline")
        # Inactive: not served for a new note, and refused if sent.
        served = self.client.get(reverse("care-valuesets") + "?ids=note-type", **self.auth).data[
            "note-type"
        ]["concepts"]
        self.assertNotIn("SOAP_V3", [c["code"] for c in served])
        new = self.post("care-client-notes", {"note_type": "SOAP_V3", "text": "x"})
        self.assertEqual(new.status_code, 400)
        # A correction is an addendum of an ordinary type.
        addendum = self.post(
            "care-client-notes",
            {"note_type": "PROGRESS", "text": "Correction", "amends": rows[0]["id"]},
        )
        self.assertEqual(addendum.status_code, 201, addendum.data)

    def test_a_copy_without_an_episode_stays_in_its_encounters_branch(self):
        with platform_admin_context():
            thika = Branch.objects.create(organization=self.org, name="Thika", facility_level="L3")
            ruiru = Branch.objects.create(organization=self.org, name="Ruiru", facility_level="L3")
            Encounter.objects.filter(pk=self.encounter.pk).update(branch=thika, episode=None)
        self.soap(plan="Seen at Thika", is_locked=True)
        self.copy()
        set_tenant_context(organization_id=self.org.id)
        set_branch_scope({ruiru.id}, ruiru.id)
        self.assertFalse(ProgressNote.objects.exists())
        set_branch_scope({thika.id}, thika.id)
        self.assertEqual(ProgressNote.objects.count(), 1)

    def test_reversing_removes_only_copies_without_an_addendum(self):
        self.soap(plan="A", is_locked=True)
        self.soap(plan="B", is_locked=True)
        self.copy()
        with platform_admin_context():
            kept = ProgressNote.objects.get(text="Plan:\nB")
        self.post(
            "care-client-notes", {"note_type": "PROGRESS", "text": "Addendum", "amends": kept.id}
        )
        with platform_admin_context():
            soap_archive.remove_copies(ProgressNote)
            remaining = set(ProgressNote.objects.values_list("text", flat=True))
        self.assertEqual(remaining, {"Plan:\nB", "Addendum"})
