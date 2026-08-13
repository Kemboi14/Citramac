from django.db import migrations

# Illustrative stub seed — mental-health/SUD-relevant ICD-11 codes for the
# CAfRIC reference tenant, per docs/07-CLINICAL-MODULES-SPEC.md §7.14. Real
# WHO ICD-11 sync is a Phase 6 item (docs/08-DHA-SHA-INTEGRATION.md §8.2) —
# do not treat this list as certified/complete.
CODES = [
    ("6A70", "Single episode depressive disorder"),
    ("6A71", "Recurrent depressive disorder"),
    ("6A60", "Bipolar type I disorder"),
    ("6A61", "Bipolar type II disorder"),
    ("6B00", "Generalised anxiety disorder"),
    ("6B01", "Panic disorder"),
    ("6B40", "Post traumatic stress disorder"),
    ("6B41", "Complex post traumatic stress disorder"),
    ("6C40", "Disorders due to use of alcohol"),
    ("6C41", "Disorders due to use of cannabis"),
    ("6C4B", "Disorders due to use of other specified psychoactive substances"),
    ("6C45", "Disorders due to use of sedatives, hypnotics or anxiolytics"),
    ("6A25", "Schizophrenia"),
    ("6B20", "Obsessive-compulsive disorder"),
    ("6D10", "Disorders of intellectual development"),
    ("QA02", "Problems associated with education and literacy"),
]


def seed(apps, schema_editor):
    IcdCodeIndex = apps.get_model("dha_interop", "IcdCodeIndex")
    for code, description in CODES:
        IcdCodeIndex.objects.get_or_create(code=code, defaults={"description": description})


def unseed(apps, schema_editor):
    IcdCodeIndex = apps.get_model("dha_interop", "IcdCodeIndex")
    IcdCodeIndex.objects.filter(code__in=[c for c, _ in CODES]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("dha_interop", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed, reverse_code=unseed),
    ]
