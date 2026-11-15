"""Record when a supervision session is scheduled (2026-11-16).

Taking a request used to flip it to SCHEDULED with no time attached. A real
schedule needs the slot the supervisor committed to, so the detail view can
show it and the agenda can be built from it.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("mhp_program", "0010_care_team_membership_period_roles")]

    operations = [
        migrations.AddField(
            model_name="supervisionrequest",
            name="scheduled_for",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
