import uuid

import django.db.models.deletion
import django.db.models.manager
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models

from apps.tenancy.rls import enable_rls_for_tables

RLS_FORWARD, RLS_REVERSE = enable_rls_for_tables(
    "care_pathway_legalstatus",
    "care_pathway_legalstatusevent",
    "care_pathway_legaldocument",
    "care_pathway_dischargenotice",
)

_MANAGERS = [
    ("objects", django.db.models.manager.Manager()),
    ("all_objects", django.db.models.manager.Manager()),
]
_OPTIONS = {"abstract": False, "base_manager_name": "all_objects"}


def _user_fk(**extra):
    return models.ForeignKey(
        blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+",
        to=settings.AUTH_USER_MODEL, **extra,
    )


def seed_legal_alert_codes(apps, schema_editor):
    """LGL-WF-06: the four legal-status alert codes join the served `clinical-alert` value set."""
    from apps.care_pathway.legal_config import LEGAL_ALERT_LABELS

    LocalValueSet = apps.get_model("care_pathway", "LocalValueSet")
    LocalConcept = apps.get_model("care_pathway", "LocalConcept")
    valueset, _ = LocalValueSet.objects.get_or_create(
        id="clinical-alert", defaults={"title": "Critical clinical alerts"}
    )
    start = LocalConcept.objects.filter(valueset=valueset).count()
    for offset, (code, display) in enumerate(LEGAL_ALERT_LABELS.items()):
        LocalConcept.objects.get_or_create(
            valueset=valueset, code=code, defaults={"display": display, "order": start + offset}
        )


class Migration(migrations.Migration):
    """Legal admission status (master prompt §7A, LGL-*): LegalStatus + append-only
    history, statutory LegalDocument versions, DischargeNotice; scheduling fields on
    CareTask (FHIR Task priority/executionPeriod/focus); legal alert codes."""

    dependencies = [
        ("care_pathway", "0037_modules_v4"),
        ("client_registry", "0019_allergy_type_status_confirmation"),
        ("clinical_encounter", "0007_prescription_item_prn_checks"),
        ("tenancy", "0015_theme_overrides_light_dark"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(model_name="caretask", name="assignee", field=_user_fk()),
        migrations.AddField(model_name="caretask", name="completed_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="caretask", name="completed_by", field=_user_fk()),
        migrations.AddField(model_name="caretask", name="due_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="caretask", name="focus_id", field=models.CharField(blank=True, max_length=64)),
        migrations.AddField(model_name="caretask", name="focus_type", field=models.CharField(blank=True, max_length=40)),
        migrations.AddField(
            model_name="caretask",
            name="priority",
            field=models.CharField(
                blank=True, choices=[("routine", "Routine"), ("urgent", "Urgent"), ("asap", "ASAP")], max_length=8
            ),
        ),
        migrations.CreateModel(
            name="LegalDocument",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("template_id", models.CharField(choices=[("DOC-LEG-STAT-VOL-KE", "Application for Voluntary Admission"), ("DOC-LEG-STAT-INV-APP-KE", "Involuntary Admission Form"), ("DOC-LEG-STAT-INV-REC-KE", "Recommendation for Involuntary Treatment"), ("LGL-NOTICE-KE", "Written notice of intention to leave")], max_length=32)),
                ("config_version", models.CharField(max_length=40)),
                ("version", models.PositiveIntegerField(default=1)),
                ("amendment_reason", models.TextField(blank=True)),
                ("status", models.CharField(choices=[("DRAFT", "Draft"), ("SIGNED", "Signed")], default="DRAFT", max_length=8)),
                ("content", models.JSONField(blank=True, default=dict)),
                ("rendered", models.JSONField(blank=True, default=dict)),
                ("signer_kind", models.CharField(blank=True, choices=[("CLIENT", "Client"), ("GUARDIAN", "Parent / guardian"), ("RELATED_PERSON", "Applicant (related person)"), ("PRACTITIONER", "Medical practitioner")], max_length=16)),
                ("signer_name", models.CharField(blank=True, max_length=255)),
                ("signature_method", models.CharField(blank=True, choices=[("ELECTRONIC", "Electronic signature (witnessed)"), ("WET_SCAN", "Captured wet signature (scan upload)")], max_length=12)),
                ("signed_at", models.DateTimeField(blank=True, null=True)),
                ("application", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="recommendations", to="care_pathway.legaldocument")),
                ("captured_by", _user_fk()),
                ("created_by", _user_fk()),
                ("examination_encounter", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="clinical_encounter.encounter")),
                ("organization", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="tenancy.organization")),
                ("patient", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="+", to="client_registry.patient")),
                ("signature_attachment", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="client_registry.attachment")),
                ("signer_related_person", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="client_registry.emergencycontact")),
                ("signer_user", _user_fk()),
                ("supersedes", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="superseded_by", to="care_pathway.legaldocument")),
            ],
            options={"ordering": ["created_at"], **_OPTIONS},
            managers=_MANAGERS,
        ),
        migrations.CreateModel(
            name="LegalStatus",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("jurisdiction", models.CharField(default="KE", max_length=8)),
                ("config_version", models.CharField(max_length=40)),
                ("category", models.CharField(choices=[("VOLUNTARY", "Voluntary"), ("INVOLUNTARY", "Involuntary")], max_length=12)),
                ("statutory_basis", models.JSONField(blank=True, default=list)),
                ("decision", models.CharField(choices=[("PENDING", "Pending"), ("ADMITTED", "Admitted"), ("REJECTED", "Rejected")], default="PENDING", max_length=10)),
                ("decision_role", models.CharField(blank=True, max_length=100)),
                ("decision_at", models.DateTimeField(blank=True, null=True)),
                ("decision_reason", models.TextField(blank=True)),
                ("effective_from", models.DateTimeField(blank=True, null=True)),
                ("max_expiry_at", models.DateTimeField(blank=True, null=True)),
                ("status", models.CharField(choices=[("PENDING", "Pending decision"), ("NOT_ADMITTED", "Not admitted"), ("ACTIVE", "Active"), ("EXPIRED", "Expired"), ("DISCHARGED", "Discharged"), ("CONVERTED", "Converted"), ("REVOKED", "Revoked")], default="PENDING", max_length=14)),
                ("workflow_state", models.CharField(choices=[("APPLICATION_DRAFT", "Application draft"), ("APPLICATION_SIGNED", "Application signed"), ("RECOMMENDATION_SIGNED", "Recommendation signed"), ("ADMITTED", "Admitted"), ("REJECTED", "Rejected"), ("ACTIVE", "Active"), ("REVIEW_DUE", "Review due"), ("RENEWED", "Renewed"), ("DISCHARGED", "Discharged"), ("CONVERTED_TO_VOLUNTARY", "Converted to voluntary"), ("EXPIRED", "Expired")], default="APPLICATION_DRAFT", max_length=24)),
                ("application_document", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="care_pathway.legaldocument")),
                ("pending_application", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="care_pathway.legaldocument")),
                ("created_by", _user_fk()),
                ("decision_by", _user_fk()),
                ("episode", models.OneToOneField(on_delete=django.db.models.deletion.PROTECT, related_name="legal_status", to="care_pathway.episodeofcare")),
                ("organization", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="tenancy.organization")),
                ("patient", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="legal_statuses", to="client_registry.patient")),
            ],
            options={"ordering": ["-created_at"], **_OPTIONS},
            managers=_MANAGERS,
        ),
        migrations.AddField(
            model_name="legaldocument",
            name="legal_status",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="documents", to="care_pathway.legalstatus"),
        ),
        migrations.CreateModel(
            name="DischargeNotice",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("given_at", models.DateTimeField()),
                ("notice_period_hours", models.PositiveIntegerField()),
                ("earliest_departure_at", models.DateTimeField()),
                ("withdrawn_at", models.DateTimeField(blank=True, null=True)),
                ("departed_at", models.DateTimeField(blank=True, null=True)),
                ("departure_against_advice", models.BooleanField(default=False)),
                ("risk_review_prompted_at", models.DateTimeField(blank=True, null=True)),
                ("created_by", _user_fk()),
                ("given_to", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to=settings.AUTH_USER_MODEL)),
                ("organization", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="tenancy.organization")),
                ("withdrawn_by", _user_fk()),
                ("written_notice_document", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="+", to="care_pathway.legaldocument")),
                ("legal_status", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="discharge_notices", to="care_pathway.legalstatus")),
            ],
            options={"ordering": ["-given_at"], **_OPTIONS},
            managers=_MANAGERS,
        ),
        migrations.CreateModel(
            name="LegalStatusEvent",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("event", models.CharField(max_length=40)),
                ("from_state", models.CharField(blank=True, max_length=24)),
                ("to_state", models.CharField(blank=True, max_length=24)),
                ("actor_role", models.CharField(blank=True, max_length=100)),
                ("at", models.DateTimeField(default=django.utils.timezone.now)),
                ("detail", models.JSONField(blank=True, default=dict)),
                ("actor", _user_fk()),
                ("legal_status", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="history", to="care_pathway.legalstatus")),
                ("organization", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="tenancy.organization")),
            ],
            options={"ordering": ["at", "created_at"], **_OPTIONS},
            managers=_MANAGERS,
        ),
        migrations.RunSQL(RLS_FORWARD, reverse_sql=RLS_REVERSE),
        migrations.RunPython(seed_legal_alert_codes, migrations.RunPython.noop),
    ]
