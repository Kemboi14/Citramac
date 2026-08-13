from django.db import migrations

from apps.tenancy.rls import enable_rls_for_tables

FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables(
    "client_registry_patient",
    "client_registry_emergencycontact",
    "client_registry_allergyrecord",
    "client_registry_insurancecoverage",
    "client_registry_appointment",
    "client_registry_attachment",
)


class Migration(migrations.Migration):
    dependencies = [
        ("client_registry", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL),
    ]
