from django.db import migrations

from apps.tenancy.rls import enable_rls_for_tables

FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables(
    "mhp_program_substanceuseentry",
    "mhp_program_reviewofsystementry",
)


class Migration(migrations.Migration):
    dependencies = [
        ("mhp_program", "0005_alter_biopsychosocialassessment_options_and_more"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL),
    ]
