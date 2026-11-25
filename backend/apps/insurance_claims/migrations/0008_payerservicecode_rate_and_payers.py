from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("insurance_claims", "0007_sha_hie_claims_rls"),
    ]

    operations = [
        migrations.AddField(
            model_name="servicepayercode",
            name="rate",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True),
        ),
        migrations.AlterField(
            model_name="servicepayercode",
            name="payer",
            field=models.CharField(
                choices=[
                    ("SHA", "SHA"),
                    ("PRIVATE", "Private insurer"),
                    ("EMPLOYER", "Employer scheme"),
                    ("CIC", "CIC"),
                    ("AAR", "AAR"),
                ],
                max_length=12,
            ),
        ),
        migrations.AlterField(
            model_name="servicepayercode",
            name="payer_code",
            field=models.CharField(blank=True, default="", max_length=64),
            preserve_default=False,
        ),
    ]
