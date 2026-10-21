"""
Psychotherapy session chat workspace: section edits kept apart from the
generated text, how the sections were produced (rule-based / AI provenance),
and the clinician's include/exclude decision per detected therapy model.

Seeds (idempotent, served value sets — local codes, not SNOMED CT): the eight
safety-concern categories (`psy-safety-concern`), the actions-taken checklist
(`psy-safety-action`) and the added stigmatising-language terms. Existing notes
are not changed — signed notes keep exactly what was signed.
"""

from django.db import migrations, models


def seed(apps, schema_editor):
    from apps.care_pathway import psy_seed

    ClinicalLexiconTerm = apps.get_model("care_pathway", "ClinicalLexiconTerm")
    LocalValueSet = apps.get_model("care_pathway", "LocalValueSet")
    LocalConcept = apps.get_model("care_pathway", "LocalConcept")
    suggestions = dict(psy_seed.STIGMA_TERMS)
    for phrase in psy_seed.STIGMA_TERMS_V2:
        ClinicalLexiconTerm.objects.get_or_create(
            lexicon="PSY_STIGMA", phrase=phrase, defaults={"category": "", "suggestion": suggestions[phrase]}
        )
    valuesets = {
        "psy-safety-concern": ("Psychotherapy safety concern categories", psy_seed.SAFETY_CONCERNS),
        "psy-safety-action": ("Psychotherapy safety actions taken", psy_seed.SAFETY_ACTIONS),
    }
    for valueset_id, (title, concepts) in valuesets.items():
        valueset, _ = LocalValueSet.objects.get_or_create(id=valueset_id, defaults={"title": title})
        for i, (code, display) in enumerate(concepts):
            LocalConcept.objects.get_or_create(
                valueset=valueset, code=code, defaults={"display": display, "order": i}
            )


class Migration(migrations.Migration):

    dependencies = [
        ('care_pathway', '0041_consent_template_types'),
    ]

    operations = [
        migrations.AddField(
            model_name='psychotherapynote',
            name='generated_sections',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='psychotherapynote',
            name='model_decisions',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='psychotherapynote',
            name='processing',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='psychotherapynote',
            name='section_edits',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]
