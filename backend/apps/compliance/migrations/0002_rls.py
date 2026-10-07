from django.db import migrations

from apps.tenancy.rls import enable_rls_for_tables

FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables(
    "compliance_tenantcomplianceprofile",
    "compliance_supportaccessgrant",
    "compliance_breachincident",
    "compliance_breachnotification",
    "compliance_datasubjectrequest",
)


class Migration(migrations.Migration):
    dependencies = [("compliance", "0001_initial")]

    operations = [migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL)]
