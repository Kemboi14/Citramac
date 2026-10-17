from django.db import migrations

# Served value sets for the document module's drop-downs (CLAUDE.md §4
# "Terminology is served, not compiled"). Local codes only; urgency reuses the
# one priority language (RULE-07).
VALUESETS = {
    "doc-recipient-type": ("Document recipient type", [
        ("EMPLOYER", "Employer"),
        ("SCHOOL", "School / university"),
        ("TREATING_CLINICIAN", "Treating clinician (external)"),
        ("RECEIVING_FACILITY", "Receiving facility"),
        ("INTERNAL_TEAM", "Internal care team"),
        ("DIAGNOSTIC_SERVICE", "Facility diagnostic service"),
        ("PATIENT", "Client (self)"),
        ("FAMILY", "Family / caregiver"),
        ("INSURER", "Insurer / funder"),
        ("EAP", "Employee assistance programme"),
        ("LEGAL", "Court / legal representative"),
        ("STATUTORY_AUTHORITY", "Statutory / safeguarding authority"),
        ("COMMUNITY_SERVICE", "Community / social service"),
    ]),
    "doc-referral-destination": ("Referral destination", [
        ("PSYCHIATRIST", "Psychiatrist"),
        ("PSYCHOLOGIST", "Psychologist"),
        ("PHYSICIAN", "Physician"),
        ("ADDICTION_SPECIALIST", "Addiction Specialist"),
        ("NEUROLOGIST", "Neurologist"),
        ("DIETITIAN", "Dietitian"),
        ("OCCUPATIONAL_THERAPIST", "Occupational Therapist"),
        ("PHYSIOTHERAPIST", "Physiotherapist"),
        ("SOCIAL_WORKER", "Social Worker"),
        ("FAMILY_THERAPIST", "Family Therapist"),
        ("OTHER_SPECIALIST", "Other Specialist"),
    ]),
    "doc-diagnosis-disclosure": ("Diagnosis disclosure", [
        ("NOT_AUTHORIZED", "Not authorized by the client"),
        ("NOT_NECESSARY", "Not necessary for this purpose"),
        ("AUTHORIZED_NECESSARY", "Authorized and necessary"),
    ]),
    "doc-legal-basis": ("Lawful basis for release", [
        ("CONSENT", "Client authorization on record"),
        ("COURT_ORDER", "Court order / legal process"),
        ("STATUTORY_DUTY", "Statutory or safeguarding duty"),
        ("EMERGENCY", "Emergency — immediate risk to life or health"),
    ]),
    "doc-urgency": ("Urgency", [
        ("RED", "RED — Emergency"),
        ("ORANGE", "ORANGE — Urgent"),
        ("YELLOW", "YELLOW — Priority"),
        ("GREEN", "GREEN — Routine"),
    ]),
}


def seed(apps, schema_editor):
    LocalValueSet = apps.get_model("care_pathway", "LocalValueSet")
    LocalConcept = apps.get_model("care_pathway", "LocalConcept")
    for valueset_id, (title, concepts) in VALUESETS.items():
        valueset, created = LocalValueSet.objects.get_or_create(
            id=valueset_id, defaults={"title": title}
        )
        if not created:
            continue
        for order, (code, display) in enumerate(concepts):
            LocalConcept.objects.create(valueset=valueset, code=code, display=display, order=order)


def unseed(apps, schema_editor):
    apps.get_model("care_pathway", "LocalValueSet").objects.filter(id__in=list(VALUESETS)).delete()


class Migration(migrations.Migration):
    dependencies = [("documents", "0002_rls"), ("care_pathway", "0002_rls_and_seed")]

    operations = [migrations.RunPython(seed, unseed)]
