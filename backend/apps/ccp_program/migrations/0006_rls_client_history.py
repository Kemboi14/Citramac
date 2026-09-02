from django.db import migrations

from apps.tenancy.rls import enable_rls_for_tables

FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables(
    "ccp_program_substanceuseentry",
    "ccp_program_reviewofsystementry",
)


class Migration(migrations.Migration):
    dependencies = [
        ("ccp_program", "0005_alter_biopsychosocialassessment_options_and_more"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL),
    ]
