"""Status and period mappings the FHIR builders share."""

from django.test import SimpleTestCase
from django.utils import timezone

from . import fhir
from .models import EpisodeOfCare


class FhirStatusMappingTests(SimpleTestCase):
    def test_a_started_review_task_is_in_progress_not_ready(self):
        # R4 `ready` means not started; PENDING is set when the review is opened.
        self.assertEqual(fhir._TASK_STATUS["PENDING"], "in-progress")

    def test_a_finished_episode_carries_its_end(self):
        start = timezone.now() - timezone.timedelta(days=10)
        end = timezone.now()
        open_episode = EpisodeOfCare(status="active", period_start=start)
        finished = EpisodeOfCare(status="finished", period_start=start, period_end=end)
        self.assertIsNone(fhir._episode_period(open_episode).end)
        self.assertEqual(fhir._episode_period(finished).end.isoformat(), end.isoformat())
