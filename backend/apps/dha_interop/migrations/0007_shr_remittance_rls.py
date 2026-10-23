from django.db import migrations

from apps.tenancy.rls import enable_rls_for_tables

# ShaTransactionLog and ShaCallbackEvent stay without RLS, like the rest of
# this app's logs: platform-level calls and not-yet-attributed callbacks carry
# no organisation.
FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables(
    "dha_interop_shrconsent",
    "dha_interop_sharemittancestatement",
)


class Migration(migrations.Migration):
    dependencies = [
        ("dha_interop", "0006_hie_transactions_callbacks_shr"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL),
    ]
