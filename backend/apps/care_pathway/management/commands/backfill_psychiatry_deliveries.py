"""One-off: assessments signed before 2026-11-20 recorded no Psychiatry delivery,
so their "Psychiatric review" care-plan action stayed open. This records the
delivery for each such signed (non-amendment) assessment, completes the open
action (and closes its older unlinked Section N tasks), and raises NO charge (owner's decision, 2026-11-20: past visits may
already be billed). Safe to re-run: an assessment with a delivery is skipped.

    python manage.py backfill_psychiatry_deliveries --dry-run
    python manage.py backfill_psychiatry_deliveries
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.care_pathway import psychiatry_module
from apps.care_pathway.models import ProgressNote
from apps.tenancy.context import platform_admin_context


class Command(BaseCommand):
    help = "Record the missing Psychiatry delivery for assessments signed before 2026-11-20."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="List, change nothing.")

    def handle(self, *args, dry_run=False, **options):
        with platform_admin_context():
            notes = (
                ProgressNote.objects.filter(
                    note_type=psychiatry_module.NOTE_TYPE,
                    status="SIGNED",
                    amends__isnull=True,
                )
                .select_related("patient", "author")
                .order_by("signed_at")
            )
            todo = [n for n in notes if not (n.data or {}).get("intervention_record_id")]
            self.stdout.write(f"{len(todo)} signed assessment(s) without a recorded delivery.")
            if dry_run:
                for note in todo:
                    self.stdout.write(f"  would record: {note.patient_id} signed {note.signed_at}")
                self.stdout.write("Tasks of completed actions are closed on a real run.")
                return
            done = 0
            for note in todo:
                if note.author is None:
                    self.stdout.write(f"  skipped (no author): {note.pk}")
                    continue
                with transaction.atomic():
                    psychiatry_module._record_delivery(
                        note.patient, note, note.author, charge=False
                    )
                done += 1
            self.stdout.write(self.style.SUCCESS(f"Recorded {done} delivery(ies); no charges."))
            # Section N tasks registered before tasks were linked to actions stay
            # open after their action completes; close them (never a task that
            # needs a coded outcome).
            from apps.care_pathway.triage_care_plan import close_unlinked_for_completed

            closed = 0
            seen = set()
            for note in notes:
                if note.patient_id in seen or note.author is None:
                    continue
                seen.add(note.patient_id)
                with transaction.atomic():
                    closed += close_unlinked_for_completed(note.patient, note.author)
                    closed += psychiatry_module.complete_triage_reviews(note.patient, note.author)
            self.stdout.write(self.style.SUCCESS(f"Closed {closed} task(s) of completed actions."))
