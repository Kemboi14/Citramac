"""
Seed content for the served value sets — every option list in the approved
mockup (docs/15-CLINICAL-WORKSPACE-V3.md §1), transcribed exactly. Loaded into
LocalValueSet/LocalConcept by migration 0002; after that the database is the
source of truth (edit a display or retire a concept there, not here).

Codes are local (FHIR CodeSystem `urn:citramac:codesystem:<valueset id>`).
VERIFY: our canonical base URL for local CodeSystems once the national IG
publishes one — the urn: form follows the project's existing identifiers.
"""

from .triage_rules import ALERT_LABELS

NO_YES = [("no", "No"), ("yes", "Yes")]
NO_YES_UNKNOWN = [("no", "No"), ("yes", "Yes"), ("unknown", "Unknown")]
NO_YES_UNCERTAIN = [("no", "No"), ("yes", "Yes"), ("uncertain", "Uncertain")]
YES_NO_UNCERTAIN = [("yes", "Yes"), ("no", "No"), ("uncertain", "Uncertain")]

VALUESETS = {
    # ── Registration (§1.4) ──
    "pronouns": (
        "Pronouns",
        [
            ("SHE_HER", "she/her"),
            ("HE_HIM", "he/him"),
            ("THEY_THEM", "they/them"),
            ("NOT_SAID", "Prefer not to say"),
            ("OTHER", "Other"),
        ],
    ),
    "sex": (
        "Sex",
        [
            ("FEMALE", "F"),
            ("MALE", "M"),
            ("OTHER", "Intersex / other"),
            ("NOT_STATED", "Not stated"),
        ],
    ),
    "id-document-type": (
        "ID / passport",
        [
            ("NATIONAL_ID", "National ID"),
            ("PASSPORT", "Passport (foreign national)"),
            ("REFUGEE_ID", "Refugee / asylum-seeker ID"),
            ("ALIEN_ID", "Alien ID"),
            ("BIRTH_CERTIFICATE", "Birth certificate (minor)"),
            ("NONE", "None / unknown"),
        ],
    ),
    "interpreter": (
        "Interpreter",
        [
            ("NO", "No"),
            ("KISWAHILI", "Yes — Kiswahili"),
            ("OTHER_LOCAL", "Yes — other local language"),
            ("SIGN", "Yes — sign language"),
        ],
    ),
    "registration-allergy-status": (
        "Allergies & reaction, if known",
        [
            ("UNKNOWN", "Not asked / unknown"),
            ("NONE", "Client reports none"),
            ("ACTIVE_ALLERGIES", "Client reports an allergy"),
        ],
    ),
    "payer": (
        "Payer / insurance",
        [
            ("SHA", "SHA"),
            ("SHA_PRIVATE", "SHA + private insurer"),
            ("PRIVATE", "Private insurance"),
            ("EMPLOYER", "Employer scheme"),
            ("SELF_PAY", "Self-pay"),
            ("WAIVER", "Waiver / charity"),
            ("UNKNOWN", "Unknown"),
        ],
    ),
    # ── Triage (§1.6) ──
    "triage-allergy-status": (
        "Allergy status",
        [("known", "Known"), ("none", "No known allergies"), ("unknown", "Unknown")],
    ),
    "triage-encounter-type": (
        "Encounter type",
        [
            ("walk_in", "Walk-in"),
            ("appointment", "Appointment"),
            ("emergency", "Emergency"),
            ("telephone", "Telephone"),
            ("referral", "Referral"),
            ("other", "Other"),
        ],
    ),
    "triage-informant": (
        "Who is providing the information?",
        [
            ("client", "Client"),
            ("family", "Family/parent"),
            ("friend", "Friend"),
            ("police", "Police"),
            ("ambulance", "Ambulance"),
            ("healthcare_professional", "Healthcare professional"),
            ("employer_school", "Employer/school"),
            ("other", "Other"),
        ],
    ),
    "yes-no": ("Yes / No", [("yes", "Yes"), ("no", "No")]),
    "no-yes": ("No / Yes", NO_YES),
    "no-yes-unknown": ("No / Yes / Unknown", NO_YES_UNKNOWN),
    "no-yes-uncertain": ("No / Yes / Uncertain", NO_YES_UNCERTAIN),
    "yes-no-uncertain": ("Yes / No / Uncertain", YES_NO_UNCERTAIN),
    "yes-no-unknown": (
        "Yes / No / Unknown",
        [("yes", "Yes"), ("no", "No"), ("unknown", "Unknown")],
    ),
    "no-yes-unsure": ("No / Yes / Unsure", [("no", "No"), ("yes", "Yes"), ("unsure", "Unsure")]),
    "no-yes-unable": (
        "No / Yes / Unable to determine",
        [("no", "No"), ("yes", "Yes"), ("unable", "Unable to determine")],
    ),
    "triage-onset": (
        "When did this begin or become worse?",
        [
            ("today", "Today"),
            ("past_24h", "Past 24 hours"),
            ("past_few_days", "Past few days"),
            ("past_week", "Past week"),
            ("longer", "Longer"),
            ("unknown", "Unknown"),
        ],
    ),
    "triage-mental-state-feature": (
        "Observed features",
        [
            ("severe_agitation", "Severe agitation"),
            ("extreme_distress", "Extreme distress"),
            ("confusion", "Confusion/disorientation"),
            ("psychotic_symptoms", "Psychotic symptoms"),
            ("hallucinations", "Hallucinations"),
            ("command_hallucinations", "Frightening/command hallucinations"),
            ("paranoia", "Severe suspiciousness/paranoia"),
            ("elevated", "Very elevated/activated behaviour"),
            ("disorganised", "Markedly disorganised behaviour"),
            ("cannot_communicate", "Unable to communicate safely/coherently"),
            ("behaviour_change", "Marked behavioural change from usual"),
            ("other", "Other"),
        ],
    ),
    "triage-consciousness": (
        "Level of consciousness",
        [
            ("alert", "Alert"),
            ("drowsy", "Drowsy"),
            ("difficult_to_rouse", "Difficult to rouse"),
            ("unresponsive", "Unresponsive"),
            ("fluctuating", "Fluctuating"),
        ],
    ),
    "triage-orientation": (
        "Orientation",
        [
            ("oriented", "Appears oriented"),
            ("disoriented", "Disoriented/confused"),
            ("unable", "Unable to assess"),
        ],
    ),
    "triage-behaviour": (
        "Behaviour",
        [
            ("calm", "Calm"),
            ("anxious", "Anxious/distressed"),
            ("agitated", "Agitated"),
            ("aggressive", "Aggressive"),
            ("disorganised", "Disorganised"),
            ("withdrawn", "Withdrawn/unresponsive"),
            ("other", "Other"),
        ],
    ),
    "triage-intoxication": (
        "Current intoxication",
        [
            ("none", "None apparent"),
            ("mild", "Mild/suspected"),
            ("significant", "Significant"),
            ("severe", "Severe"),
            ("unable", "Unable to determine"),
        ],
    ),
    "triage-withdrawal-symptom": (
        "Current withdrawal symptoms",
        [
            ("tremor", "Tremor"),
            ("sweating", "Sweating"),
            ("vomiting", "Vomiting"),
            ("anxiety_agitation", "Severe anxiety/agitation"),
            ("hallucinations", "Hallucinations"),
            ("confusion", "Confusion"),
            ("seizure", "Seizure"),
            ("other", "Other"),
            ("none", "None"),
        ],
    ),
    "triage-medical-concern": (
        "Immediate concerns",
        [
            ("chest_pain", "Chest pain"),
            ("difficulty_breathing", "Difficulty breathing"),
            ("severe_pain", "Severe pain"),
            ("serious_injury", "Serious injury"),
            ("recent_seizure", "Recent seizure"),
            ("loss_consciousness", "Loss/alteration of consciousness"),
            ("vomiting_dehydration", "Severe vomiting/dehydration"),
            ("suspected_overdose", "Suspected overdose"),
            ("head_injury", "Head injury"),
            ("severe_intoxication", "Severe intoxication"),
            ("medication_reaction", "Acute medication reaction/concern"),
            ("pregnancy", "Pregnancy-related acute concern"),
            ("other", "Other"),
        ],
    ),
    "triage-feels-safe": (
        "Do you feel safe where you currently live/stay?",
        [("yes", "Yes"), ("no", "No"), ("unsure", "Unsure"), ("unable", "Unable to assess")],
    ),
    "triage-safeguarding-concern": (
        "Safeguarding concerns",
        [
            ("abuse", "Abuse"),
            ("neglect", "Neglect"),
            ("domestic_violence", "Domestic/intimate partner violence"),
            ("sexual_violence", "Sexual violence/exploitation"),
            ("financial_exploitation", "Financial exploitation"),
            ("threat_coercion", "Threat/coercion"),
            ("child_safeguarding", "Child safeguarding"),
            ("vulnerable_adult", "Vulnerable adult"),
            ("unsafe_environment", "Unsafe living environment"),
            ("other", "Other"),
            ("none_identified", "None identified"),
        ],
    ),
    "triage-functional-area": (
        "Immediate functional safety",
        [
            ("eating_drinking", "Eating/drinking"),
            ("medication", "Medication"),
            ("hygiene", "Hygiene/basic care"),
            ("shelter", "Safe shelter"),
            ("sleep", "Severe sleep disruption"),
            ("wandering", "Wandering/getting lost"),
            ("seek_help", "Unable to seek help appropriately"),
            ("other", "Other"),
        ],
    ),
    "triage-telephone-concern": (
        "Concern reported",
        [
            ("suicide_concern", "Suicide/self-harm concern"),
            ("recent_attempt", "Recent attempt/self-harm"),
            ("risk_to_other", "Threat/risk to another person"),
            ("access_to_means", "Access to serious means reported"),
            ("severe_confusion", "Severe confusion"),
            ("severe_agitation", "Severe agitation/aggression"),
            ("psychotic_behaviour", "Psychotic behaviour"),
            ("significant_intoxication", "Significant intoxication"),
            ("possible_withdrawal", "Possible withdrawal"),
            ("seizure", "Seizure"),
            ("loss_consciousness", "Loss of consciousness"),
            ("serious_injury", "Serious injury/medical concern"),
        ],
    ),
    "triage-priority": (
        "Triage priority",
        [("RED", "RED"), ("ORANGE", "ORANGE"), ("YELLOW", "YELLOW"), ("GREEN", "GREEN")],
    ),
    "triage-decision": (
        "Clinician decision",
        [("CONFIRM", "Confirm recommendation"), ("OVERRIDE", "Override")],
    ),
    "triage-action": (
        "Immediate action / disposition",
        [
            ("emergency_intervention", "Immediate emergency intervention"),
            ("emergency_transfer", "Emergency transfer"),
            ("urgent_medical_review", "Urgent medical review"),
            ("urgent_psychiatric_review", "Urgent psychiatric review"),
            ("priority_psychiatric_review", "Priority psychiatric review"),
            ("routine_psychiatric_review", "Routine psychiatric review"),
            ("suicide_risk_assessment", "Suicide Risk Assessment"),
            ("safety_plan", "Safety Plan"),
            ("enhanced_observation", "Enhanced observation"),
            ("withdrawal_monitoring", "Withdrawal assessment/monitoring"),
            ("detox_assessment", "Detox assessment"),
            ("safeguarding_intervention", "Safeguarding intervention"),
            ("comprehensive_intake", "Proceed to Comprehensive Intake"),
            ("outpatient_appointment", "Outpatient appointment"),
            ("admission_assessment", "Admission assessment"),
            ("other", "Other"),
        ],
    ),
    "task-status": (
        "Status",
        [("INITIATED", "Initiated"), ("PENDING", "Pending"), ("COMPLETED", "Completed")],
    ),
    "clinical-alert": ("Critical clinical alerts", list(ALERT_LABELS.items())),
    # ── Re-check (§1.7) ──
    "recheck-change": (
        "Any change since the last check?",
        [
            ("NO_CHANGE", "No change"),
            ("CHANGE", "Yes — change reported"),
            ("UNABLE", "Unable to determine"),
        ],
    ),
    "recheck-distress": (
        "Distress / behaviour now",
        [
            ("LOW", "Low — calm, engages easily"),
            ("MODERATE", "Moderate"),
            ("HIGH", "High"),
            ("UNABLE", "Unable to assess"),
        ],
    ),
    "recheck-observation-status": (
        "Measurement status",
        [
            ("NOT_REPEATED", "Not repeated — previous set carries forward"),
            ("MEASURED", "Measured now"),
            ("NOT_MEASURED", "Not measured"),
        ],
    ),
    # ── Journey: intake, care plan, interventions (§1.17) and outpatient (§1.11) ──
    "intake-symptom": (
        "Current Symptoms",
        [
            ("excessive_worry", "Excessive worry"),
            ("sleep_disturbance", "Sleep disturbance"),
            ("poor_concentration", "Poor concentration"),
            ("irritability", "Irritability"),
        ],
    ),
    "intake-risk-level": (
        "Risk Assessment",
        [("LOW", "Low Risk"), ("MODERATE", "Moderate Risk"), ("HIGH", "High Risk")],
    ),
    "intake-decision": (
        "Decision",
        [
            ("CONTINUE_OUTPATIENT", "Continue Outpatient Care"),
            ("REFER_SPECIALIST", "Refer to Specialist"),
            ("ESCALATE_INPATIENT", "Escalate to Inpatient"),
        ],
    ),
    "intake-care-need": (
        "Identified Care Needs",
        [
            ("psychological_therapy", "Psychological therapy"),
            ("medication_review", "Medication review"),
            ("family_session", "Family session"),
            ("social_work_referral", "Social work referral"),
        ],
    ),
    "care-plan-type": (
        "Plan Type",
        [
            ("STANDARD", "Standard Outpatient Care"),
            ("INTENSIVE", "Intensive Outpatient Program"),
            ("DAY", "Day Program"),
        ],
    ),
    "care-plan-intervention": (
        "Interventions",
        [
            ("medication_management", "Medication management"),
            ("cbt_weekly", "CBT — Weekly sessions"),
            ("family_monthly", "Family therapy — Monthly"),
            ("group_therapy", "Group therapy"),
            ("psychoeducation", "Psychoeducation"),
        ],
    ),
    "care-activity-status": (
        "Status",
        [
            ("PLANNED", "Planned"),
            ("SCHEDULED", "Scheduled"),
            ("ACTIVE", "Active"),
            ("COMPLETED", "Completed"),
        ],
    ),
    "care-module": (
        "Module",
        [
            ("ADMISSION", "Admission Module"),
            ("PSYCHIATRY", "Psychiatry Module"),
            ("NURSING", "Nursing Module"),
            ("MEDICATION", "Medication / MAR"),
            ("THERAPY", "Therapy Workspace"),
            ("ASSESSMENT", "Assessment / Monitoring"),
        ],
    ),
    "appointment-type": (
        "Appointment type",
        [
            ("Psychiatry review", "Psychiatry review"),
            ("Individual psychotherapy", "Individual psychotherapy"),
            ("Family psychotherapy", "Family psychotherapy"),
            ("Group psychotherapy", "Group psychotherapy"),
            ("Medication review", "Medication review"),
            ("Outpatient follow-up", "Outpatient follow-up"),
        ],
    ),
    "admission-consent-status": (
        "Consent status",
        [
            ("PENDING", "Consent Pending"),
            ("OBTAINED", "Consent Obtained"),
            ("DECLINED", "Consent Declined"),
        ],
    ),
    "capacity-assessed": (
        "Capacity assessed",
        [("NOT_ASSESSED", "Not assessed"), ("YES", "Yes"), ("NO", "No")],
    ),
    "nok-notification": (
        "Next-of-kin notification",
        [
            ("NOT_NOTIFIED", "Not Yet Notified"),
            ("NOTIFIED", "Notified"),
            ("NOT_APPLICABLE", "Notification Not Applicable"),
            ("UNABLE_TO_REACH", "Unable to Reach"),
        ],
    ),
    "admission-type": (
        "Admission Type",
        [("VOLUNTARY", "Voluntary"), ("INVOLUNTARY", "Involuntary")],
    ),
    # ── Discharge planning and follow-up (docs/17-DISCHARGE-AND-FOLLOW-UP.md) ──
    # Local concepts only. VERIFY: the national IG's discharge-disposition code
    # system, and map these to it when it is supplied — no standard code is
    # asserted here.
    "discharge-disposition": (
        "Discharge disposition",
        [
            ("HOME", "Home / community care"),
            ("TRANSFER", "Transfer to another facility"),
            ("AMA", "Left against medical advice"),
            ("ABSCONDED", "Absconded"),
            ("DECEASED", "Deceased"),
        ],
    ),
    "discharge-medication-action": (
        "Discharge medication action",
        [("CONTINUE", "Continue"), ("STOP", "Stop"), ("CHANGE", "Change"), ("NEW", "New")],
    ),
    # The mockup's "Patient Education" checklist (docs/15 §1.17), verbatim.
    "discharge-education": (
        "Discharge education",
        [
            ("MED_ADHERENCE", "Medication adherence education provided"),
            ("CRISIS_PLAN", "Crisis plan reviewed"),
            ("WARNING_SIGNS", "Warning signs discussed"),
            ("FOLLOW_UP_ARRANGED", "Follow-up appointment scheduled"),
        ],
    ),
    "follow-up-reason": (
        "Follow-up reason",
        [
            ("POST_DISCHARGE", "Post-discharge review"),
            ("MEDICATION_REVIEW", "Medication review"),
            ("THERAPY", "Psychotherapy continuation"),
            ("AFTERCARE", "After-care / relapse prevention"),
            ("CARE_PLAN_REVIEW", "Care-plan review"),
            ("OUTREACH", "Missed-appointment outreach"),
            ("OTHER", "Other"),
        ],
    ),
}

# Facility service list from the mockup's billing module (§1.15). Names only:
# rates are configured per facility, never seeded (doc 15 C3).
BILLING_SERVICE_NAMES = [
    "Emergency Care",
    "Blood Work",
    "Medical Review",
    "Appointments",
    "Psychiatry",
    "Admission",
    "Withdrawal Management (Detox)",
    "Opioid Agonist Therapy",
    "Psychiatric Nursing",
    "Psychotherapy",
    "Psychosocial Support",
    "Nutrition & Fitness",
    "Discharge",
    "Follow-up & After-care",
]


def seed_valuesets(LocalValueSet, LocalConcept):
    for valueset_id, (title, concepts) in VALUESETS.items():
        valueset, _ = LocalValueSet.objects.update_or_create(
            id=valueset_id, defaults={"title": title}
        )
        for order, (code, display) in enumerate(concepts):
            LocalConcept.objects.update_or_create(
                valueset=valueset,
                code=code,
                defaults={"display": display, "order": order, "active": True},
            )


def seed_billing_services(BillingService, organization_id):
    for name in BILLING_SERVICE_NAMES:
        BillingService.all_objects.get_or_create(organization_id=organization_id, name=name)
