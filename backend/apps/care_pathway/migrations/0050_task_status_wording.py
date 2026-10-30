"""Task statuses read as what is left to do, so a task registered at triage is
never mistaken for an assessment that has been done (QA 2026-10-30). Only
displays still at their seeded wording are changed."""

from django.db import migrations

WORDING = [
    ("INITIATED", "Initiated", "Not started"),
    ("PENDING", "Pending", "In progress"),
    ("COMPLETED", "Completed", "Done"),
]


def reword(apps, schema_editor):
    LocalConcept = apps.get_model("care_pathway", "LocalConcept")
    for code, old, new in WORDING:
        LocalConcept.objects.filter(valueset_id="task-status", code=code, display=old).update(display=new)


def unreword(apps, schema_editor):
    LocalConcept = apps.get_model("care_pathway", "LocalConcept")
    for code, old, new in WORDING:
        LocalConcept.objects.filter(valueset_id="task-status", code=code, display=new).update(display=old)


class Migration(migrations.Migration):

    dependencies = [
        ("care_pathway", "0049_approved_assessments_withdrawal_review"),
    ]

    operations = [migrations.RunPython(reword, unreword)]
