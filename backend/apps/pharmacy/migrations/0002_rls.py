from django.db import migrations

from apps.tenancy.rls import enable_rls_for_tables

FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables(
    "pharmacy_store",
    "pharmacy_drugstockitem",
    "pharmacy_stockmovement",
    "pharmacy_dispenserecord",
)


class Migration(migrations.Migration):
    dependencies = [
        ("pharmacy", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL),
    ]
