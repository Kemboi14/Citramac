# Registration v4: emergency-arrival details on TriageEncounter, the social &
# personal details / emergency value sets, and "Prefer not to say" on `sex`.

from django.db import migrations, models

NEW_VALUESETS = (
    "disability-status",
    "employment-status",
    "marital-status",
    "apparent-sex",
    "brought-by-relationship",
    "emergency-allergy-status",
)
ADDED_CONCEPTS = {"sex": ["NOT_SAID"]}


def seed(apps, schema_editor):
    # Idempotent; existing concepts are left as the database holds them.
    from apps.care_pathway.valuesets import VALUESETS

    LocalValueSet = apps.get_model("care_pathway", "LocalValueSet")
    LocalConcept = apps.get_model("care_pathway", "LocalConcept")
    for valueset_id in NEW_VALUESETS:
        title, concepts = VALUESETS[valueset_id]
        valueset, _ = LocalValueSet.objects.get_or_create(id=valueset_id, defaults={"title": title})
        for order, (code, display) in enumerate(concepts):
            LocalConcept.objects.get_or_create(
                valueset=valueset, code=code, defaults={"display": display, "order": order}
            )
    for valueset_id, codes in ADDED_CONCEPTS.items():
        valueset = LocalValueSet.objects.filter(id=valueset_id).first()
        if valueset is None:
            continue
        displays = dict(VALUESETS[valueset_id][1])
        last = LocalConcept.objects.filter(valueset=valueset).count()
        for offset, code in enumerate(codes):
            LocalConcept.objects.get_or_create(
                valueset=valueset,
                code=code,
                defaults={"display": displays[code], "order": last + offset},
            )


class Migration(migrations.Migration):
    dependencies = [("care_pathway", "0042_psychotherapy_chat")]

    operations = [
        migrations.AddField(
            model_name="triageencounter",
            name="apparent_sex",
            field=models.CharField(blank=True, max_length=20),
        ),
        migrations.AddField(
            model_name="triageencounter",
            name="arrival_referral_info",
            field=models.TextField(
                blank=True, verbose_name="Police / ambulance / referral information"
            ),
        ),
        migrations.AddField(
            model_name="triageencounter",
            name="found_location",
            field=models.CharField(
                blank=True,
                max_length=255,
                verbose_name="Where the person was found or brought from",
            ),
        ),
        migrations.AddField(
            model_name="triageencounter",
            name="identification_notes",
            field=models.TextField(
                blank=True, verbose_name="How the person can currently be identified"
            ),
        ),
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]
