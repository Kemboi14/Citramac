import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    """Admission links to the episode's LegalStatus — the single legal-status store (§7A)."""

    dependencies = [("ipd_ward", "0008_mar_prn_max_override"), ("care_pathway", "0038_legal_status")]

    operations = [
        migrations.AddField(
            model_name="admission",
            name="legal_status_record",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                related_name="admissions", to="care_pathway.legalstatus",
            ),
        ),
    ]
