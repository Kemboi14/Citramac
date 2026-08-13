from django.db import migrations

from apps.tenancy.rls import enable_rls_for_tables

FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables(
    "lims_laborder",
    "lims_labspecimen",
    "lims_labresult",
)


class Migration(migrations.Migration):
    dependencies = [
        ("lims", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL),
    ]
