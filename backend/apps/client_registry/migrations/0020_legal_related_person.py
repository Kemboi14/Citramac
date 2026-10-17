from django.db import migrations, models


class Migration(migrations.Migration):
    """Statutory applicant details on the RelatedPerson (master prompt LGL-I-B-02/05)."""

    dependencies = [("client_registry", "0019_allergy_type_status_confirmation")]

    operations = [
        migrations.AddField(
            model_name="emergencycontact",
            name="id_number",
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name="emergencycontact",
            name="relationship_detail",
            field=models.CharField(blank=True, max_length=150),
        ),
    ]
