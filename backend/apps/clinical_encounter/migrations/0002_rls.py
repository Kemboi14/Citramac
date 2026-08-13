from django.db import migrations

from apps.tenancy.rls import enable_rls_for_tables

FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables(
    "clinical_encounter_encounter",
    "clinical_encounter_soapnote",
    "clinical_encounter_diagnosiscode",
    "clinical_encounter_clinicalorder",
    "clinical_encounter_prescription",
    "clinical_encounter_prescriptionitem",
    "clinical_encounter_referralpacket",
)


class Migration(migrations.Migration):
    dependencies = [
        ("clinical_encounter", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL),
    ]
