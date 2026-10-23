from django.db import migrations

from apps.tenancy.rls import enable_rls_for_tables

FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables(
    "insurance_claims_shavisit",
    "insurance_claims_shaeligibilitycheck",
)


class Migration(migrations.Migration):
    dependencies = [
        ("insurance_claims", "0006_sha_hie_claims"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL),
    ]
