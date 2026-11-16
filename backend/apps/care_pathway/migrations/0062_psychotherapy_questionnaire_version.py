from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("care_pathway", "0061_triage_psychiatric_review_action_detail"),
    ]

    operations = [
        migrations.AddField(
            model_name="psychotherapynote",
            name="questionnaire_version",
            field=models.CharField(default="INDIVIDUAL_V1", max_length=32),
        ),
    ]
