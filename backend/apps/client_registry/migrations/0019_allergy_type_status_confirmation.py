import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    """INT-06 / DATA-04: allergy type (hard stop only for a true allergy),
    clinical status, and whole-record source + "Confirm — unchanged"."""

    dependencies = [
        ("client_registry", "0018_therapy_oat_missed"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="allergyrecord",
            name="allergy_type",
            field=models.CharField(
                choices=[
                    ("ALLERGY", "Allergy"),
                    ("INTOLERANCE", "Intolerance"),
                    ("ADR", "Adverse drug reaction (ADR)"),
                ],
                default="ALLERGY",
                max_length=12,
            ),
        ),
        migrations.AddField(
            model_name="allergyrecord",
            name="clinical_status",
            field=models.CharField(
                choices=[("ACTIVE", "Active"), ("RESOLVED", "Resolved")], default="ACTIVE", max_length=10
            ),
        ),
        migrations.AddField(
            model_name="patient",
            name="allergy_info_source",
            field=models.CharField(blank=True, max_length=48),
        ),
        migrations.AddField(
            model_name="patient",
            name="allergy_confirmed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="patient",
            name="allergy_confirmed_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
