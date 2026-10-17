import uuid

import django.db.models.deletion
import django.db.models.manager
from django.conf import settings
from django.db import migrations, models

from apps.tenancy.rls import enable_rls

RLS_FORWARD, RLS_REVERSE = enable_rls("accounts_practitionercredential")

# Master prompt §7A: the admitting officer's authority (LGL-V-08, LGL-I-O-02) and
# who may see identity numbers unmasked (LGL-DOC-06). Org Admin assigns them to
# roles from Roles & Permissions; no role receives them by default.
PERMISSIONS = [
    ("clinical.admitting_officer", "ADMITTING_OFFICER — may record the official-use admission decision on statutory admission forms"),
    ("clinical.identity_numbers.unmask", "May view National ID/Passport numbers unmasked on legal forms (every view is logged)"),
]


def seed_permissions(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    for codename, description in PERMISSIONS:
        Permission.objects.get_or_create(codename=codename, defaults={"description": description})


def unseed_permissions(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(codename__in=[c for c, _ in PERMISSIONS]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0011_password_history_and_changed_at"),
        ("tenancy", "0015_theme_overrides_light_dark"),
    ]

    operations = [
        migrations.CreateModel(
            name="PractitionerCredential",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("registration_number", models.CharField(blank=True, max_length=64)),
                ("registration_body", models.CharField(blank=True, max_length=150)),
                ("registration_verified_at", models.DateTimeField(blank=True, null=True)),
                ("qualifications", models.CharField(blank=True, max_length=255)),
                ("mha_recommendation_approved", models.BooleanField(default=False)),
                ("mha_approved_at", models.DateTimeField(blank=True, null=True)),
                ("mha_approved_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to=settings.AUTH_USER_MODEL)),
                ("organization", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="tenancy.organization")),
                ("registration_verified_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to=settings.AUTH_USER_MODEL)),
                ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="practitioner_credential", to=settings.AUTH_USER_MODEL)),
            ],
            options={"abstract": False, "base_manager_name": "all_objects"},
            managers=[
                ("objects", django.db.models.manager.Manager()),
                ("all_objects", django.db.models.manager.Manager()),
            ],
        ),
        migrations.RunSQL(RLS_FORWARD, reverse_sql=RLS_REVERSE),
        migrations.RunPython(seed_permissions, unseed_permissions),
    ]
