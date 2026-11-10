from django.db import migrations

# Each existing diagnosis keeps the display text the clinician chose it by —
# the (unverified) stub title at the time — before dha_interop 0009 replaces
# the index's titles with WHO's. Without this, loading the WHO release would
# silently change what signed diagnoses say (CLAUDE.md §3 item 7).


def _platform_admin(schema_editor):
    # Row-level security is forced on tenant tables; without this the backfill
    # would see no diagnoses and silently do nothing.
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT set_config('app.is_platform_admin', 'true', true)")


def backfill(apps, schema_editor):
    _platform_admin(schema_editor)
    DiagnosisCode = apps.get_model("clinical_encounter", "DiagnosisCode")
    rows = []
    for diagnosis in DiagnosisCode.objects.filter(icd11_display="").select_related("icd11_code"):
        diagnosis.icd11_display = diagnosis.icd11_code.description
        rows.append(diagnosis)
    DiagnosisCode.objects.bulk_update(rows, ["icd11_display"], batch_size=500)


class Migration(migrations.Migration):
    dependencies = [
        ("clinical_encounter", "0010_diagnosis_icd11_display_release_review"),
    ]

    # Reversing leaves the column to 0010's reverse, which drops it.
    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
