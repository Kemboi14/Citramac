from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("triage", "0006_vitalsigns_consciousness_vitalsigns_supplemental_o2")]

    operations = [
        migrations.AddField(
            model_name="vitalsigns",
            name="source",
            field=models.CharField(blank=True, max_length=30),
        ),
    ]
