from django.apps import apps
from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from apps.dha_interop import icd11_import


class Command(BaseCommand):
    help = (
        "Load a WHO ICD-11 MMS release from WHO's simple tabulation file "
        "(SimpleTabulation-ICD-11-MMS-en.zip, from icdcdn.who.int/static/releasefiles/<release>/). "
        "Diagnoses recorded from the old unverified list whose code means something else "
        "are flagged for re-coding."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "path",
            nargs="?",
            help="The WHO .zip (or its .txt). Default: the vendored "
            f"{icd11_import.VENDORED_RELEASE} release.",
        )
        parser.add_argument("--release", help="WHO's release id, e.g. 2026-01.")
        parser.add_argument(
            "--sha256",
            help="The file's expected SHA-256, as recorded when it was downloaded from WHO.",
        )
        parser.add_argument("--actor", default="", help="Who ran the import, for the record.")

    def handle(self, *args, **options):
        path = options["path"] or icd11_import.VENDORED_FILE
        release = options["release"] or (
            icd11_import.VENDORED_RELEASE if not options["path"] else None
        )
        expected = options["sha256"] or (
            icd11_import.VENDORED_SHA256 if not options["path"] else None
        )
        if not release:
            raise CommandError(
                "--release is required with a file (WHO's release id, e.g. 2026-01)."
            )
        if not expected:
            raise CommandError(
                "--sha256 is required with a file: record the hash of the file as downloaded from WHO."
            )
        with connection.cursor() as cursor:
            # Platform-wide terminology; flagging reads every organisation's diagnoses.
            cursor.execute("SELECT set_config('app.is_platform_admin', 'true', false)")
        try:
            summary = icd11_import.import_release(
                apps.get_model("dha_interop", "IcdCodeIndex"),
                apps.get_model("clinical_encounter", "DiagnosisCode"),
                apps.get_model("dha_interop", "TerminologySyncRun"),
                path,
                release,
                expected_sha256=expected,
                actor=options["actor"],
            )
        except (icd11_import.Icd11ImportError, OSError) as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write(
            f"WHO ICD-11 MMS {summary['release']} ({summary['version']}), sha256 {summary['sha256']}\n"
            f"{summary['codes']} codes: {summary['added']} added, {summary['updated']} updated, "
            f"{summary['retired']} retired."
        )
        flagged = summary["flagged_diagnoses"]
        self.stdout.write(f"{len(flagged)} diagnosis(es) flagged for re-coding.")
        for pk, code, recorded, who in flagged:
            self.stdout.write(f"  {pk}  {code}: recorded “{recorded}”, WHO “{who or 'not a code'}”")
