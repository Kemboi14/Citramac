"""RLS on the insurer table, and the CIC / AAR rates of 2026-11-24 moved onto
each organisation's own insurers (guide.md 2026-11-26). An organisation that
had a CIC or AAR rate gets an insurer of that name; its rate rows point at it."""

from django.db import migrations

from apps.tenancy.rls import enable_rls_for_tables

FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables("insurance_claims_insurer")
LEGACY = ("CIC", "AAR")


def to_named_insurers(apps, schema_editor):
    Insurer = apps.get_model("insurance_claims", "Insurer")
    ServicePayerCode = apps.get_model("insurance_claims", "ServicePayerCode")
    for row in ServicePayerCode.objects.filter(payer__in=LEGACY):
        insurer, _ = Insurer.objects.get_or_create(
            organization_id=row.organization_id, name=row.payer
        )
        row.insurer = insurer
        row.payer = "INSURER"
        row.save(update_fields=["insurer", "payer"])


def back_to_codes(apps, schema_editor):
    ServicePayerCode = apps.get_model("insurance_claims", "ServicePayerCode")
    for row in ServicePayerCode.objects.filter(payer="INSURER").select_related("insurer"):
        if row.insurer.name in LEGACY:
            row.payer = row.insurer.name
            row.insurer = None
            row.save(update_fields=["insurer", "payer"])


class Migration(migrations.Migration):
    dependencies = [
        ("insurance_claims", "0009_insurer"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL),
        migrations.RunPython(to_named_insurers, back_to_codes),
    ]
