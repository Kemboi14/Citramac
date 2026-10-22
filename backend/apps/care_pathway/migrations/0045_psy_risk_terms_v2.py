"""
More psychotherapy risk-language prompts (served lexicon PSY_RISK): third-person
forms ("wants to kill herself"), passive wishes to disappear, and the Kiswahili
phrases from the v4 mockup's risk screen. A prompt only — no label, no score.
Idempotent; existing notes are not re-screened. VERIFY: clinical-governance
sign-off of the lexicon before go-live, as for the first seed (psy_seed).
"""

from django.db import migrations


def seed(apps, schema_editor):
    from apps.care_pathway import psy_seed

    ClinicalLexiconTerm = apps.get_model("care_pathway", "ClinicalLexiconTerm")
    for category, phrases in psy_seed.RISK_TERMS_V2.items():
        for phrase in phrases:
            ClinicalLexiconTerm.objects.get_or_create(
                lexicon="PSY_RISK", phrase=phrase, defaults={"category": category, "suggestion": ""}
            )


class Migration(migrations.Migration):
    dependencies = [("care_pathway", "0044_group_risk_psy_delivery")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
