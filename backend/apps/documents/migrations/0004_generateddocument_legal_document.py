# LGL-DOC-05: a release of a signed statutory form links the legal module's
# LegalDocument instead of copying the form.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("care_pathway", "0038_legal_status"),
        ("documents", "0003_seed_valuesets"),
    ]

    operations = [
        migrations.AddField(
            model_name="generateddocument",
            name="legal_document",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="release_documents",
                to="care_pathway.legaldocument",
            ),
        ),
    ]
