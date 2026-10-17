from django.db import migrations

from apps.tenancy.rls import enable_rls_for_tables

FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables(
    "insurance_claims_servicepayercode",
    "insurance_claims_claimline",
    "insurance_claims_claimattachment",
)


class Migration(migrations.Migration):
    dependencies = [
        ("insurance_claims", "0004_claim_lines_attachments_payer_codes"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL),
    ]
