from django.db import migrations

from apps.tenancy.rls import enable_rls_for_tables

FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables(
    "ipd_ward_ward",
    "ipd_ward_bed",
    "ipd_ward_admission",
    "ipd_ward_medicationadministration",
    "ipd_ward_nursingnote",
)


class Migration(migrations.Migration):
    dependencies = [
        ("ipd_ward", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL),
    ]
