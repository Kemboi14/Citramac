from django.db import migrations

from apps.tenancy.rls import enable_rls_for_tables

FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables(
    "mhp_program_biopsychosocialassessment",
    "mhp_program_psychotherapysession",
    "mhp_program_careteammembership",
)


class Migration(migrations.Migration):
    dependencies = [
        ("mhp_program", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL),
    ]
