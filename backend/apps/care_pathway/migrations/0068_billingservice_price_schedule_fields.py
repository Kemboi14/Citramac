from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("care_pathway", "0067_intake_edit_reason"),
    ]

    operations = [
        migrations.AddField(
            model_name="billingservice",
            name="code",
            field=models.CharField(blank=True, db_index=True, default="", max_length=40),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="billingservice",
            name="category",
            field=models.CharField(blank=True, default="", max_length=120),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="billingservice",
            name="description",
            field=models.CharField(blank=True, default="", max_length=255),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="billingservice",
            name="medicine_name",
            field=models.CharField(blank=True, default="", max_length=150),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="billingservice",
            name="mass",
            field=models.CharField(blank=True, default="", max_length=80),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="billingservice",
            name="cost",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True),
        ),
        migrations.AddField(
            model_name="billingservice",
            name="markup_percent",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=7, null=True),
        ),
        migrations.AddField(
            model_name="billingservice",
            name="tax_percent",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=7, null=True),
        ),
        migrations.AddField(
            model_name="billingservice",
            name="remarks",
            field=models.TextField(blank=True, default=""),
            preserve_default=False,
        ),
        migrations.AlterModelOptions(
            name="billingservice",
            options={"ordering": ["category", "name"]},
        ),
        migrations.AddConstraint(
            model_name="billingservice",
            constraint=models.UniqueConstraint(
                condition=models.Q(("code__gt", "")),
                fields=("organization", "code"),
                name="unique_billing_service_code_per_org",
            ),
        ),
    ]
