# Registration v4 (client mockup, owner-approved 2026-10-21): coded social &
# personal details, "Prefer not to say" sex, the brought-by contact role, and
# the CIT-ER temporary number series.
#
# The column conversions are ALTER COLUMN ... TYPE ... USING, not a RunPython
# loop: a table rewrite is not subject to the row-level security policy on
# client_registry_patient, so every organisation's rows are converted whatever
# role runs the migration.

from django.db import migrations, models

# living_with_disability Boolean → coded: True → YES, False → NO, null → blank.
DISABILITY_USING = (
    "CASE WHEN living_with_disability IS TRUE THEN 'YES' "
    "WHEN living_with_disability IS FALSE THEN 'NO' ELSE '' END"
)
DISABILITY_FORWARD = f"""
ALTER TABLE client_registry_patient ALTER COLUMN living_with_disability DROP DEFAULT;
ALTER TABLE client_registry_patient
    ALTER COLUMN living_with_disability TYPE varchar(10) USING {DISABILITY_USING};
"""
DISABILITY_REVERSE = """
ALTER TABLE client_registry_patient
    ALTER COLUMN living_with_disability TYPE boolean USING (living_with_disability = 'YES');
"""

# Free-text employment status from the client-registry modal → the coded list.
# A value with no matching code (e.g. "Other") is left as entered.
EMPLOYMENT_USING = """CASE lower(trim(employment_status))
    WHEN 'employed' THEN 'EMPLOYED'
    WHEN 'self-employed' THEN 'SELF_EMPLOYED'
    WHEN 'unemployed' THEN 'UNEMPLOYED'
    WHEN 'student' THEN 'STUDENT'
    WHEN 'retired' THEN 'RETIRED'
    ELSE employment_status END"""
EMPLOYMENT_FORWARD = f"""
ALTER TABLE client_registry_patient
    ALTER COLUMN employment_status TYPE varchar(32) USING {EMPLOYMENT_USING};
"""

MARITAL_STATUS_CHOICES = [
    ("SINGLE", "Single"),
    ("MARRIED", "Married"),
    ("SEPARATED", "Separated"),
    ("DIVORCED", "Divorced"),
    ("WIDOWED", "Widowed"),
    ("PARTNERED", "Partnered"),
    ("NOT_STATED", "Not stated"),
    ("NOT_SAID", "Prefer not to say"),
]
EMPLOYMENT_STATUS_CHOICES = [
    ("EMPLOYED", "Employed"),
    ("SELF_EMPLOYED", "Self-employed"),
    ("UNEMPLOYED", "Unemployed"),
    ("STUDENT", "Student"),
    ("RETIRED", "Retired"),
    ("UNABLE_TO_WORK", "Unable to work"),
    ("NOT_STATED", "Not stated"),
    ("NOT_SAID", "Prefer not to say"),
]
DISABILITY_CHOICES = [
    ("NO", "No"),
    ("YES", "Yes"),
    ("NOT_SAID", "Prefer not to say"),
    ("NOT_KNOWN", "Not known"),
]


class Migration(migrations.Migration):
    dependencies = [("client_registry", "0021_consent_release_authorization")]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunSQL(DISABILITY_FORWARD, reverse_sql=DISABILITY_REVERSE),
            ],
            state_operations=[
                migrations.AlterField(
                    model_name="patient",
                    name="living_with_disability",
                    field=models.CharField(blank=True, choices=DISABILITY_CHOICES, max_length=10),
                ),
            ],
        ),
        migrations.RunSQL(EMPLOYMENT_FORWARD, reverse_sql=migrations.RunSQL.noop),
        migrations.AlterField(
            model_name="patient",
            name="employment_status",
            field=models.CharField(blank=True, choices=EMPLOYMENT_STATUS_CHOICES, max_length=32),
        ),
        migrations.AddField(
            model_name="patient",
            name="disability_details",
            field=models.TextField(blank=True, verbose_name="Disability / support needs"),
        ),
        migrations.AlterField(
            model_name="patient",
            name="marital_status",
            field=models.CharField(blank=True, choices=MARITAL_STATUS_CHOICES, max_length=10),
        ),
        migrations.AlterField(
            model_name="patient",
            name="gender",
            field=models.CharField(
                blank=True,
                choices=[
                    ("MALE", "Male"),
                    ("FEMALE", "Female"),
                    ("OTHER", "Intersex / other"),
                    ("NOT_STATED", "Not stated"),
                    ("NOT_SAID", "Prefer not to say"),
                ],
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name="emergencycontact",
            name="contact_role",
            field=models.CharField(
                choices=[
                    ("CONTACT", "Next of kin / contact"),
                    ("BROUGHT_BY", "Brought or referred the client"),
                ],
                default="CONTACT",
                max_length=12,
            ),
        ),
        migrations.CreateModel(
            name="IdentifierSequence",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("name", models.CharField(max_length=32, unique=True)),
                ("last_value", models.PositiveBigIntegerField(default=0)),
            ],
        ),
    ]
