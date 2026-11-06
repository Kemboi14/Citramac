from django.db import migrations

# Data step: v3 SOAP notes → ProgressNote (owner decision 2026-11-06). The logic
# lives in apps.care_pathway.soap_archive so tests run exactly what this runs.


def _platform_admin(schema_editor):
    # Row-level security is forced on tenant tables: without this the copy would
    # see no SOAP notes and silently copy nothing (as accounts 0020 does).
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT set_config('app.is_platform_admin', 'true', true)")


def copy_forward(apps, schema_editor):
    from apps.care_pathway import soap_archive

    _platform_admin(schema_editor)

    soap_archive.ensure_note_type(
        apps.get_model("care_pathway", "LocalValueSet"),
        apps.get_model("care_pathway", "LocalConcept"),
    )
    soap_archive.copy_soap_notes(
        apps.get_model("clinical_encounter", "SoapNote"),
        apps.get_model("care_pathway", "ProgressNote"),
    )


def copy_backward(apps, schema_editor):
    from apps.care_pathway import soap_archive

    _platform_admin(schema_editor)

    soap_archive.remove_copies(apps.get_model("care_pathway", "ProgressNote"))


class Migration(migrations.Migration):
    """Its own migration (own transaction): Postgres won't ALTER a table with
    pending row changes, which reversing 0052 alongside this would need."""

    dependencies = [
        ("care_pathway", "0052_progress_note_soap_copies"),
        ("clinical_encounter", "0008_encounter_type_choices_diagnosis_recorder"),
    ]

    operations = [migrations.RunPython(copy_forward, copy_backward)]
