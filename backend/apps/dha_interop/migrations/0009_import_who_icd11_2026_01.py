from django.db import migrations

# Loads WHO's ICD-11 MMS 2026-01 release, vendored unchanged in
# apps/dha_interop/icd11_release/ (SOURCE.md), replacing the 16-code
# illustrative stub from 0002 as the source of truth. Five of those stub codes
# carried titles that are not what WHO's code means; diagnoses recorded with
# them are flagged for re-coding, never rewritten. Same code as
# `manage.py import_icd11`.


def _platform_admin(schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT set_config('app.is_platform_admin', 'true', true)")


def load(apps, schema_editor):
    from apps.dha_interop import icd11_import

    _platform_admin(schema_editor)
    icd11_import.import_release(
        apps.get_model("dha_interop", "IcdCodeIndex"),
        apps.get_model("clinical_encounter", "DiagnosisCode"),
        apps.get_model("dha_interop", "TerminologySyncRun"),
        icd11_import.VENDORED_FILE,
        icd11_import.VENDORED_RELEASE,
        expected_sha256=icd11_import.VENDORED_SHA256,
        actor="migration dha_interop 0009",
    )


def unload(apps, schema_editor):
    """Back to the pre-release state: codes no diagnosis uses are removed, the
    rest lose their release stamp, and the re-coding flags are cleared. Stub
    titles that WHO's replaced are not restored (they were wrong)."""
    _platform_admin(schema_editor)
    IcdCodeIndex = apps.get_model("dha_interop", "IcdCodeIndex")
    DiagnosisCode = apps.get_model("clinical_encounter", "DiagnosisCode")
    used = set(DiagnosisCode.objects.values_list("icd11_code_id", flat=True))
    IcdCodeIndex.objects.exclude(code__in=used).filter(release="2026-01").delete()
    IcdCodeIndex.objects.update(release="", retired_release="")
    DiagnosisCode.objects.filter(icd11_release="").update(code_review_reason="")
    apps.get_model("dha_interop", "TerminologySyncRun").objects.filter(
        source="ICD11", release="2026-01"
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("dha_interop", "0008_icd11_release_fields"),
        ("clinical_encounter", "0011_backfill_icd11_display"),
    ]

    operations = [migrations.RunPython(load, unload)]
