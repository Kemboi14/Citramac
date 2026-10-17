from django.db import migrations, models

CHOICES = [
    ("PROVISIONAL", "Provisional"),
    ("DIFFERENTIAL", "Differential"),
    ("CONFIRMED", "Confirmed"),
    ("RULED_OUT", "Ruled out"),
]


class Migration(migrations.Migration):
    """Diagnostic certainty (Condition.verificationStatus). Existing diagnoses get
    a blank value — their certainty was never recorded and is not guessed; new
    ones default to provisional."""

    dependencies = [
        ("clinical_encounter", "0005_encounter_episode"),
    ]

    operations = [
        migrations.AddField(
            model_name="diagnosiscode",
            name="verification_status",
            field=models.CharField(blank=True, choices=CHOICES, default="", max_length=16),
        ),
        migrations.AlterField(
            model_name="diagnosiscode",
            name="verification_status",
            field=models.CharField(blank=True, choices=CHOICES, default="PROVISIONAL", max_length=16),
        ),
    ]
