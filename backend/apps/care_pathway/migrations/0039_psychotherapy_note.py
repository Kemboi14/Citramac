"""
Psychotherapy Session note (master prompt §7): the structured note on each
PsychotherapySession, its audited amendments, the per-organisation therapy-model
registry (PSY-TM-03) and the served lexicons (PSY-RD, PSY-GEN-11, PSY-GEN-3).
Also seeds the two DATA-07 alert codes into the `clinical-alert` value set and
the safety-concern / attendance-mode value sets. Seed lists: psy_seed.py.
"""


import uuid

import django.db.models.deletion
import django.db.models.manager
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models

from apps.tenancy.rls import enable_rls_for_tables

RLS_FORWARD, RLS_REVERSE = enable_rls_for_tables(
    "care_pathway_psychotherapynote",
    "care_pathway_psychotherapynoteamendment",
    "care_pathway_therapymodel",
)


def seed(apps, schema_editor):
    # Idempotent; lists are database-owned once seeded (served, configurable).
    from apps.care_pathway import psy_seed

    ClinicalLexiconTerm = apps.get_model("care_pathway", "ClinicalLexiconTerm")
    LocalValueSet = apps.get_model("care_pathway", "LocalValueSet")
    LocalConcept = apps.get_model("care_pathway", "LocalConcept")
    for lexicon, category, phrase, suggestion in psy_seed.lexicon_rows():
        ClinicalLexiconTerm.objects.get_or_create(
            lexicon=lexicon, phrase=phrase, defaults={"category": category, "suggestion": suggestion}
        )
    valuesets = {
        "psy-safety-concern-other": ("Other immediate safety concerns", psy_seed.OTHER_CONCERNS),
        "psy-attendance-mode": ("Session attendance mode", psy_seed.ATTENDANCE_MODES),
        "clinical-alert": ("Critical clinical alerts", psy_seed.ALERTS),
    }
    for valueset_id, (title, concepts) in valuesets.items():
        valueset, _ = LocalValueSet.objects.get_or_create(id=valueset_id, defaults={"title": title})
        start = LocalConcept.objects.filter(valueset=valueset).count()
        for i, (code, display) in enumerate(concepts):
            LocalConcept.objects.get_or_create(
                valueset=valueset, code=code, defaults={"display": display, "order": start + i}
            )


class Migration(migrations.Migration):

    dependencies = [
        ('care_pathway', '0038_legal_status'),
        ('client_registry', '0018_therapy_oat_missed'),
        ('clinical_encounter', '0005_encounter_episode'),
        ('mhp_program', '0007_alter_biopsychosocialassessment_patient_and_more'),
        ('tenancy', '0015_theme_overrides_light_dark'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='ClinicalLexiconTerm',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('lexicon', models.CharField(choices=[('PSY_RISK', 'Psychotherapy risk-language prompt'), ('PSY_STIGMA', 'Stigmatizing language'), ('PSY_REPORT_CUE', 'Client-report attribution cue')], max_length=16)),
                ('category', models.CharField(blank=True, max_length=40)),
                ('phrase', models.CharField(max_length=120)),
                ('suggestion', models.TextField(blank=True)),
                ('active', models.BooleanField(default=True)),
                ('version', models.CharField(default='1', max_length=16)),
            ],
            options={
                'ordering': ['lexicon', 'category', 'phrase'],
                'constraints': [models.UniqueConstraint(fields=('lexicon', 'phrase'), name='unique_lexicon_phrase')],
            },
        ),
        migrations.CreateModel(
            name='PsychotherapyNote',
            fields=[
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('status', models.CharField(choices=[('DRAFT', 'Draft'), ('SIGNED', 'Signed')], default='DRAFT', max_length=6)),
                ('answers', models.JSONField(blank=True, default=dict)),
                ('selected_models', models.JSONField(blank=True, default=list)),
                ('safety_answer', models.CharField(blank=True, choices=[('YES', 'Yes'), ('NO', 'No'), ('NOT_ASSESSED', 'Not assessed')], max_length=12)),
                ('safety_detail', models.JSONField(blank=True, default=dict)),
                ('safety_ack_reason', models.TextField(blank=True)),
                ('safety_ack_at', models.DateTimeField(blank=True, null=True)),
                ('detection_resolutions', models.JSONField(blank=True, default=dict)),
                ('goal_links', models.JSONField(blank=True, default=list)),
                ('sections', models.JSONField(blank=True, default=dict)),
                ('models_applied', models.JSONField(blank=True, default=list)),
                ('generated_at', models.DateTimeField(blank=True, null=True)),
                ('sections_edited', models.BooleanField(default=False)),
                ('accuracy_confirmed', models.BooleanField(default=False)),
                ('draft_saved_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('signed_at', models.DateTimeField(blank=True, null=True)),
                ('history', models.JSONField(blank=True, default=list)),
                ('author', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL)),
                ('encounter', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='+', to='clinical_encounter.encounter')),
                ('episode', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='+', to='care_pathway.episodeofcare')),
                ('not_assessed_alert', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='+', to='care_pathway.clinicalalert')),
                ('organization', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='tenancy.organization')),
                ('patient', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='psychotherapy_notes', to='client_registry.patient')),
                ('safety_ack_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL)),
                ('safety_alert', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='+', to='care_pathway.clinicalalert')),
                ('session', models.OneToOneField(on_delete=django.db.models.deletion.PROTECT, related_name='psy_note', to='mhp_program.psychotherapysession')),
                ('signed_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL)),
                ('therapy_episode', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='notes', to='care_pathway.therapyepisode')),
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
        migrations.CreateModel(
            name='PsychotherapyNoteAmendment',
            fields=[
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('section', models.CharField(max_length=24)),
                ('previous_text', models.TextField()),
                ('new_text', models.TextField()),
                ('reason', models.TextField()),
                ('amended_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('amended_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL)),
                ('note', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='amendments', to='care_pathway.psychotherapynote')),
                ('organization', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='tenancy.organization')),
                ('patient', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='+', to='client_registry.patient')),
            ],
            options={
                'ordering': ['amended_at'],
                'abstract': False,
                'base_manager_name': 'all_objects',
            },
            managers=[
                ('objects', django.db.models.manager.Manager()),
                ('all_objects', django.db.models.manager.Manager()),
            ],
        ),
        migrations.CreateModel(
            name='TherapyModel',
            fields=[
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('code', models.SlugField(max_length=64)),
                ('name', models.CharField(max_length=120)),
                ('aliases', models.JSONField(blank=True, default=list)),
                ('concepts', models.JSONField(blank=True, default=list)),
                ('version', models.CharField(default='1', max_length=16)),
                ('enabled', models.BooleanField(default=True)),
                ('order', models.PositiveSmallIntegerField(default=0)),
                ('organization', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='tenancy.organization')),
            ],
            options={
                'ordering': ['order', 'name'],
                'abstract': False,
                'base_manager_name': 'all_objects',
                'constraints': [models.UniqueConstraint(fields=('organization', 'code'), name='unique_therapy_model_per_org')],
            },
            managers=[
                ('objects', django.db.models.manager.Manager()),
                ('all_objects', django.db.models.manager.Manager()),
            ],
        ),
        migrations.RunSQL(RLS_FORWARD, reverse_sql=RLS_REVERSE),
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]
