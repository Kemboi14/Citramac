import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    """v4 Interventions drawer: unlinked records, module code, outcome,
    completes-action, and void/correction trail (records are never deleted)."""

    dependencies = [("care_pathway", "0030_seed_pregnancy_status")]

    operations = [
        migrations.AlterField(
            model_name="interventionrecord",
            name="activity",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="interventions",
                to="care_pathway.careplanactivity",
            ),
        ),
        migrations.AddField(
            model_name="interventionrecord",
            name="module",
            field=models.CharField(blank=True, max_length=40),
        ),
        migrations.AddField(
            model_name="interventionrecord", name="note", field=models.TextField(blank=True)
        ),
        migrations.AddField(
            model_name="interventionrecord", name="outcome", field=models.TextField(blank=True)
        ),
        migrations.AddField(
            model_name="interventionrecord",
            name="completes_activity",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="interventionrecord",
            name="voided_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="interventionrecord", name="void_reason", field=models.TextField(blank=True)
        ),
        migrations.AddField(
            model_name="interventionrecord",
            name="corrections",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="chargeitem",
            name="voided_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
