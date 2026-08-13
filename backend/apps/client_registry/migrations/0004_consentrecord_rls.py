from django.db import migrations

from apps.tenancy.rls import enable_rls_for_tables

FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables(
    "client_registry_consentrecord",
)


class Migration(migrations.Migration):
    dependencies = [
        ("client_registry", "0003_consentrecord"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL),
    ]
