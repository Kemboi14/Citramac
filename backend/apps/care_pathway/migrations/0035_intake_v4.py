from django.db import migrations, models

# Value sets whose concept list changed in v4: missing concepts are added, every
# listed one is re-ordered, and any concept no longer listed is retired (active=False),
# never deleted — stored drafts and signed intakes may still carry its code.
RECONCILED = ("intake-orientation", "intake-dx-status")


def forwards(apps, schema_editor):
    from apps.care_pathway.intake_schema import option_valuesets

    LocalValueSet = apps.get_model("care_pathway", "LocalValueSet")
    LocalConcept = apps.get_model("care_pathway", "LocalConcept")
    for valueset_id, (title, concepts) in option_valuesets().items():
        valueset, created = LocalValueSet.objects.get_or_create(
            id=valueset_id, defaults={"title": title}
        )
        if not created and valueset_id not in RECONCILED:
            continue
        listed = []
        for order, (code, display) in enumerate(concepts):
            LocalConcept.objects.update_or_create(
                valueset=valueset, code=code,
                defaults={"display": display, "order": order, "active": True},
            )
            listed.append(code)
        LocalConcept.objects.filter(valueset=valueset).exclude(code__in=listed).update(active=False)


class Migration(migrations.Migration):
    """Intake v4: supplementary instrument answers and timepoint on scores (INT-20),
    and the v4 value sets (orientation spheres, diagnosis certainty, allergy type /
    severity / source, substance cards, assessment timepoint)."""

    dependencies = [
        ("care_pathway", "0034_intervention_module_valueset"),
    ]

    operations = [
        migrations.AddField(
            model_name="outcomescore",
            name="detail",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="outcomescore",
            name="timepoint",
            field=models.CharField(blank=True, max_length=16),
        ),
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
