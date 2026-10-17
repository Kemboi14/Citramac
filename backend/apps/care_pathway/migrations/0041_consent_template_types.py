# Facility consent wording for the release authorizations the documents module
# checks (DOC-CI-06): employer, school / university, release to a third party.

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("care_pathway", "0040_triage_v4"),
    ]

    operations = [
        migrations.AlterField(
            model_name="consenttemplate",
            name="consent_type",
            field=models.CharField(
                choices=[
                    ("DATA_SHARING_HIE", "Data sharing (health information exchange)"),
                    ("EMPLOYER_COMMUNICATION", "Communicating with the client's employer"),
                    ("SCHOOL_COMMUNICATION", "Communicating with the client's school / university"),
                    ("RELEASE_OF_INFORMATION", "Releasing health information to a named third party"),
                ],
                max_length=32,
            ),
        ),
    ]
