from django.db import migrations

from apps.tenancy.rls import enable_rls_for_tables

FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables(
    "mhp_program_sudrehabplan",
    "mhp_program_rehabmilestone",
    "mhp_program_urinedrugscreen",
    "mhp_program_clinicalreview",
    "mhp_program_supervisionrequest",
    "mhp_program_nacadandoreport",
)


class Migration(migrations.Migration):
    dependencies = [
        ("mhp_program", "0003_clinicalreview_nacadandoreport_sudrehabplan_and_more"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL),
    ]
