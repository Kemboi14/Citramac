import uuid

import django.db.models.deletion
from django.db import migrations, models

from apps.tenancy.rls import enable_rls


class Migration(migrations.Migration):
    dependencies = [
        ("tenancy", "0003_organization_login_branding"),
    ]

    operations = [
        # --- SubscriptionPlan ---
        # No default/backfill needed: no SubscriptionPlan rows exist yet in
        # any environment this migration will ever run against (the catalog
        # has never had an API to create one until this phase).
        migrations.AddField(
            model_name="subscriptionplan",
            name="code",
            field=models.SlugField(max_length=32, unique=True, default="unset"),
            preserve_default=False,
        ),
        migrations.AlterField(
            model_name="subscriptionplan",
            name="max_staff_seats",
            field=models.IntegerField(
                null=True, blank=True, help_text="Blank = unlimited."
            ),
        ),
        migrations.AddField(
            model_name="subscriptionplan",
            name="is_active",
            field=models.BooleanField(default=True),
        ),
        migrations.AlterModelOptions(
            name="subscriptionplan",
            options={"ordering": ["price_monthly"]},
        ),
        # --- Organization ---
        migrations.AddField(
            model_name="organization",
            name="org_type",
            field=models.CharField(
                max_length=16,
                default="HOSPITAL",
                choices=[
                    ("HOSPITAL", "Hospital / Healthcare Provider"),
                    ("SCHOOL", "School"),
                    ("UNIVERSITY", "University"),
                    ("CORPORATE", "Corporate"),
                    ("INDIVIDUAL", "Individual Practitioner"),
                ],
            ),
        ),
        migrations.AddField(
            model_name="organization",
            name="ownership_type",
            field=models.CharField(
                max_length=16,
                default="PRIVATE",
                choices=[
                    ("PRIVATE", "Private"),
                    ("PUBLIC", "Public"),
                    ("FAITH_BASED", "Faith-Based"),
                    ("NGO", "NGO / Not-for-profit"),
                    ("PARTNERSHIP", "Partnership"),
                    ("OTHER", "Other"),
                ],
            ),
        ),
        migrations.AddField(
            model_name="organization",
            name="county",
            field=models.CharField(max_length=100, blank=True, default=""),
        ),
        migrations.AddField(
            model_name="organization",
            name="sub_county",
            field=models.CharField(max_length=100, blank=True, default=""),
        ),
        migrations.AddField(
            model_name="organization",
            name="status",
            field=models.CharField(
                max_length=24,
                default="ACTIVE",
                choices=[
                    ("PENDING_VERIFICATION", "Pending Verification"),
                    ("ACTIVE", "Active"),
                    ("SUSPENDED", "Suspended"),
                ],
            ),
        ),
        migrations.AddField(
            model_name="organization",
            name="mfl_verified_at",
            field=models.DateTimeField(null=True, blank=True),
        ),
        # --- Branch ---
        migrations.AddField(
            model_name="branch",
            name="sub_county",
            field=models.CharField(max_length=100, blank=True, default=""),
        ),
        migrations.AddField(
            model_name="branch",
            name="mfl_code",
            field=models.CharField(max_length=64, blank=True, default=""),
        ),
        migrations.AddField(
            model_name="branch",
            name="phone",
            field=models.CharField(max_length=32, blank=True, default=""),
        ),
        migrations.AddField(
            model_name="branch",
            name="email",
            field=models.EmailField(max_length=254, blank=True, default=""),
        ),
        migrations.AddField(
            model_name="branch",
            name="outpatient_capacity_per_day",
            field=models.PositiveIntegerField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="branch",
            name="ccp_registration_status",
            field=models.CharField(
                max_length=10,
                default="OPEN",
                choices=[
                    ("OPEN", "Open"),
                    ("WAITLIST", "Waitlist Only"),
                    ("CLOSED", "Closed"),
                ],
            ),
        ),
        migrations.AddField(
            model_name="branch",
            name="sha_claims_enabled",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="branch",
            name="mpesa_paybill_enabled",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="branch",
            name="sms_reminders_enabled",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="branch",
            name="sha_api_credentials_encrypted",
            field=models.TextField(blank=True, default=""),
        ),
        # --- Subscription ---
        migrations.CreateModel(
            name="Subscription",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                (
                    "billing_cycle",
                    models.CharField(
                        max_length=8,
                        default="ANNUAL",
                        choices=[("MONTHLY", "Monthly"), ("ANNUAL", "Annual")],
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        max_length=10,
                        default="ACTIVE",
                        choices=[
                            ("ACTIVE", "Active"),
                            ("PAST_DUE", "Past Due"),
                            ("CANCELED", "Canceled"),
                        ],
                    ),
                ),
                ("seats_used", models.PositiveIntegerField(default=0)),
                ("current_period_end", models.DateField()),
                (
                    "organization",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, to="tenancy.organization"
                    ),
                ),
                (
                    "plan",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="tenancy.subscriptionplan",
                    ),
                ),
            ],
            options={
                "abstract": False,
                "base_manager_name": "all_objects",
            },
        ),
        migrations.AddConstraint(
            model_name="subscription",
            constraint=models.UniqueConstraint(
                fields=["organization"], name="unique_subscription_per_org"
            ),
        ),
        migrations.RunSQL(*enable_rls("tenancy_subscription")),
    ]
