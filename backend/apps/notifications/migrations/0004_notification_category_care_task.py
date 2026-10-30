from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("notifications", "0003_notification_category_facility_licence"),
    ]

    operations = [
        migrations.AlterField(
            model_name="notification",
            name="category",
            field=models.CharField(
                choices=[
                    ("RISK_ALERT", "Risk Alert"),
                    ("SYSTEM", "System"),
                    ("SUBSCRIPTION", "Subscription"),
                    ("RETENTION", "Records Retention"),
                    ("FACILITY_LICENCE", "Facility Licence"),
                    ("CARE_TASK", "Task assigned"),
                ],
                max_length=32,
            ),
        ),
    ]
