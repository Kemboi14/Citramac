from django.db import migrations

from apps.tenancy.rls import enable_rls_for_tables

FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables(
    "ccp_program_sudrehabplan",
    "ccp_program_rehabmilestone",
    "ccp_program_urinedrugscreen",
    "ccp_program_clinicalreview",
    "ccp_program_supervisionrequest",
    "ccp_program_nacadandoreport",
)


class Migration(migrations.Migration):
    dependencies = [
        ("ccp_program", "0003_clinicalreview_nacadandoreport_sudrehabplan_and_more"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL),
    ]
