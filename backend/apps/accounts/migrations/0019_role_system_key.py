from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("accounts", "0018_reports_nacada_send")]

    operations = [
        migrations.AddField(
            model_name="role",
            name="system_key",
            field=models.CharField(blank=True, default="", max_length=40),
        ),
        migrations.AddField(
            model_name="role",
            name="is_active",
            field=models.BooleanField(default=True),
        ),
        migrations.AlterField(
            model_name="role",
            name="scope",
            field=models.CharField(
                choices=[("PLATFORM", "Platform team role"), ("ORG_TEMPLATE", "Organisation role")],
                default="ORG_TEMPLATE",
                max_length=16,
            ),
        ),
        migrations.AddConstraint(
            model_name="role",
            constraint=models.UniqueConstraint(
                condition=~models.Q(system_key=""),
                fields=("organization", "system_key"),
                name="unique_role_system_key_per_org",
            ),
        ),
        migrations.AddConstraint(
            model_name="role",
            constraint=models.UniqueConstraint(
                condition=~models.Q(system_key="") & models.Q(organization__isnull=True),
                fields=("system_key",),
                name="unique_role_system_key_definition",
            ),
        ),
    ]
