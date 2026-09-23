from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("platform_security", "0002_password_complexity_toggles"),
    ]

    operations = [
        migrations.AddField(
            model_name="securitypolicy",
            name="tenant_discovery_max_attempts",
            field=models.PositiveSmallIntegerField(default=20),
        ),
        migrations.AddField(
            model_name="securitypolicy",
            name="tenant_discovery_window_minutes",
            field=models.PositiveSmallIntegerField(default=10),
        ),
        migrations.AddField(
            model_name="securitypolicy",
            name="otp_dispatch_max_attempts",
            field=models.PositiveSmallIntegerField(default=5),
        ),
        migrations.AddField(
            model_name="securitypolicy",
            name="otp_dispatch_window_minutes",
            field=models.PositiveSmallIntegerField(default=30),
        ),
    ]
