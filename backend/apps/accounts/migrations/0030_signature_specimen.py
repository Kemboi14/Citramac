"""
Clinician specimen signatures (owner decisions 2026-11-26,
apps.accounts.signature_specimen): tenant isolation (RLS) and append-only at the
database level — the same trigger as 0022 — so a specimen printed on a signed
document can never be rewritten. TRUNCATE stays allowed (TransactionTestCase
flushes with it).
"""

import django.db.models.deletion
import django.db.models.manager
import uuid
from django.conf import settings
from django.db import migrations, models

from apps.tenancy.rls import enable_rls

RLS_FORWARD, RLS_REVERSE = enable_rls("accounts_signaturespecimen")

APPEND_ONLY_FORWARD = """
CREATE OR REPLACE FUNCTION accounts_signaturespecimen_reject_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'accounts_signaturespecimen is append-only: % is not permitted',
        TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER signaturespecimen_append_only
    BEFORE UPDATE OR DELETE ON accounts_signaturespecimen
    FOR EACH ROW EXECUTE FUNCTION accounts_signaturespecimen_reject_mutation();
"""

APPEND_ONLY_REVERSE = """
DROP TRIGGER IF EXISTS signaturespecimen_append_only ON accounts_signaturespecimen;
DROP FUNCTION IF EXISTS accounts_signaturespecimen_reject_mutation();
"""


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0029_clinical_psychotherapy_deliver'),
        ('tenancy', '0026_organization_icon'),
    ]

    operations = [
        migrations.CreateModel(
            name='SignatureSpecimen',
            fields=[
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('image_png', models.BinaryField()),
                ('image_sha256', models.CharField(max_length=64)),
                ('organization', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='tenancy.organization')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='signature_specimens', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-created_at'],
                'abstract': False,
                'base_manager_name': 'all_objects',
            },
            managers=[
                ('objects', django.db.models.manager.Manager()),
                ('all_objects', django.db.models.manager.Manager()),
            ],
        ),
        migrations.RunSQL(RLS_FORWARD, RLS_REVERSE),
        migrations.RunSQL(APPEND_ONLY_FORWARD, APPEND_ONLY_REVERSE),
    ]
