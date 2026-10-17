from django.db import migrations, models


class Migration(migrations.Migration):
    """Release authorizations in the one consent store (master prompt DOC-CI-06,
    DOC-GOV-04): employer / school / named-third-party consent types, plus the
    recipient and the data classes the authorization covers."""

    dependencies = [("client_registry", "0020_legal_related_person")]

    operations = [
        migrations.AlterField(
            model_name="consentrecord",
            name="consent_type",
            field=models.CharField(
                choices=[
                    ("DATA_SHARING_HIE", "Data Sharing via National HIE"),
                    ("MENTAL_HEALTH_HIE", "Sharing mental-health information on the HIE"),
                    ("SUBSTANCE_USE_HIE", "Sharing substance-use information on the HIE"),
                    ("FAMILY_INVOLVEMENT", "Involving family / next of kin in care"),
                    ("EMPLOYER_COMMUNICATION", "Communicating with the client's employer"),
                    (
                        "SCHOOL_COMMUNICATION",
                        "Communicating with the client's school / university",
                    ),
                    (
                        "RELEASE_OF_INFORMATION",
                        "Releasing health information to a named third party",
                    ),
                ],
                default="DATA_SHARING_HIE",
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name="consentrecord",
            name="recipient",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="consentrecord",
            name="disclosure_scope",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
