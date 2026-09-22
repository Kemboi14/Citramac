from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        # apps.security's AppConfig.label is "platform_security", not
        # "security" — migration dependency tuples key on the app_label,
        # not the Python module path.
        ("platform_security", "0001_initial"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="securitypolicy",
            name="password_complexity",
        ),
        migrations.AddField(
            model_name="securitypolicy",
            name="require_uppercase",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="securitypolicy",
            name="require_lowercase",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="securitypolicy",
            name="require_number",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="securitypolicy",
            name="require_symbol",
            field=models.BooleanField(default=True),
        ),
    ]
