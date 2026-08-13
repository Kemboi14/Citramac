from django.db import migrations

from apps.tenancy.rls import enable_rls_for_tables

FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables(
    "ccp_program_biopsychosocialassessment",
    "ccp_program_psychotherapysession",
    "ccp_program_careteammembership",
)


class Migration(migrations.Migration):
    dependencies = [
        ("ccp_program", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL),
    ]
