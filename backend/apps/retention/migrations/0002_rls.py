from django.db import migrations

from apps.tenancy.rls import enable_rls_for_tables

FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables(
    "retention_organizationretentionpolicy",
    "retention_archivebatch",
    "retention_archivebatchitem",
    "retention_retentionscanrun",
)


class Migration(migrations.Migration):
    dependencies = [
        ("retention", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL),
    ]
