from django.db import migrations

# Illustrative stub seed — common lab tests relevant to a mental-health/SUD
# facility. Real LOINC sync is a Phase 6 item, same caveat as the ICD-11 seed
# in 0002_seed_icd11_mental_health.py.
CODES = [
    ("58410-2", "Complete blood count (CBC) panel"),
    ("2345-7", "Glucose [Mass/volume] in Serum or Plasma"),
    ("1920-8", "Aspartate aminotransferase [Enzymatic activity/volume] in Serum or Plasma"),
    ("1742-6", "Alanine aminotransferase [Enzymatic activity/volume] in Serum or Plasma"),
    ("3016-3", "Thyrotropin [Units/volume] in Serum or Plasma"),
    ("80271-4", "Toxicology panel"),
    ("3400-2", "Amphetamine [Presence] in Urine"),
    ("3428-3", "Cannabinoids [Presence] in Urine"),
    ("3457-2", "Opiates [Presence] in Urine"),
    ("35659-6", "Alcohol [Presence] in Urine"),
]


def seed(apps, schema_editor):
    LoincCodeIndex = apps.get_model("dha_interop", "LoincCodeIndex")
    for code, description in CODES:
        LoincCodeIndex.objects.get_or_create(code=code, defaults={"description": description})


def unseed(apps, schema_editor):
    LoincCodeIndex = apps.get_model("dha_interop", "LoincCodeIndex")
    LoincCodeIndex.objects.filter(code__in=[c for c, _ in CODES]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("dha_interop", "0002_seed_icd11_mental_health"),
    ]

    operations = [
        migrations.RunPython(seed, reverse_code=unseed),
    ]
