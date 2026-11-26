"""The platform service catalogue's starting list (guide.md 2026-11-26), from
`service_catalogue.json`: the services on a facility's price schedule, by name,
category and (for a medicine) name and strength. No prices, codes or remarks —
each organisation prices what it adds. Lines naming a particular partner
facility were left out. Existing names are kept as they are."""

import json
from pathlib import Path

from django.db import migrations

SOURCE = Path(__file__).resolve().parent.parent / "service_catalogue.json"


def seed(apps, schema_editor):
    Item = apps.get_model("care_pathway", "ServiceCatalogueItem")
    for entry in json.loads(SOURCE.read_text(encoding="utf-8"))["items"]:
        Item.objects.get_or_create(
            name=entry["name"],
            defaults={
                "category": entry["category"],
                "description": entry["description"],
                "medicine_name": entry["medicine_name"],
                "mass": entry["mass"],
            },
        )


class Migration(migrations.Migration):
    dependencies = [
        ("care_pathway", "0070_chargeitem_priced_for_catalogue_link"),
    ]

    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
