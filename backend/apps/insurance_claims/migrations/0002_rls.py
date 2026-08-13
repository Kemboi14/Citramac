from django.db import migrations

from apps.tenancy.rls import enable_rls_for_tables

FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables(
    "insurance_claims_preauthorization",
    "insurance_claims_insuranceclaim",
    "insurance_claims_remittance",
)


class Migration(migrations.Migration):
    dependencies = [
        ("insurance_claims", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL),
    ]
