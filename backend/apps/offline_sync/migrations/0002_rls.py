from django.db import migrations

from apps.tenancy.rls import enable_rls_for_tables

FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables(
    "offline_sync_syncablerecord",
    "offline_sync_syncconflictlog",
)


class Migration(migrations.Migration):
    dependencies = [
        ("offline_sync", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL),
    ]
