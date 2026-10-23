# Eligibility Process Guide: Intervention Coverage Workflow
## 1. Overview: Determining Specific Services
This guide focuses on the Intervention Coverage workflow, an important stage within the broader Eligibility Process. Building upon the patient identification and general sub-benefits determination, this workflow's primary role is to pinpoint the exact, granular healthcare interventions (e.g., specific medical procedures, medications, or diagnostic tests) a patient is eligible to receive at a particular health facility.
### 1.1. What This Workflow Does
The Intervention Coverage workflow retrieves a list of precise healthcare interventions available to a patient. It achieves this by combining:
- Verified Patient Details: The patient's comprehensive profile from the Client Registry, linked via their CR ID.
- Specific Facility Details: In-depth information about the health facility where the intervention would occur.
- Benefits coverage: A list of sub-benefits that the specific patient is eligible for.
Our system then applies the rules established by the Social Health Authority (SHA). These rules determine which interventions are covered based on the patient's eligibility (from previous workflows) and the facility's licensed capacity and contractual agreements with SHA.
### 1.2. Why This Workflow Is Critical
This workflow is paramount for precise and compliant healthcare delivery, preventing misinterpretations of general benefits. Its importance lies in:
- Preventing Unauthorised Services: Ensures that patients only receive interventions that are specifically covered and permissible for a given facility, avoiding non-compliance and potential fraud.
- Accurate Costing and Claims: Provides the exact codes for covered interventions, which are vital for accurate billing, claims submission, and financial reconciliation.
- Accurate tariff allocation: Given that tariffs are tied to the interventions, providing the right interventions ensures that the correct tariffs for the interventions are used.
- Optimising Patient Journey: Allows healthcare providers to immediately know what specific treatments they can offer, streamlining the patient's pathway and reducing administrative delays.
- Resource Allocation: Helps facilities manage their services efficiently by knowing what interventions are eligible for coverage through SHA.
In essence, this workflow moves from general "sub-benefits" to specific "interventions," acting as the final gate to confirm what can truly be performed and covered by SHA.
## 2. Workflow Details: Intervention Coverage
### 2.1. Workflow Description
When a request for intervention coverage is received, our system executes an internal sequence:
Input Reception: The system receives the patient's unique Client Registry ID and the specific identification details for the health facility. It may also receive a broad service_type (e.g., "INPATIENT") or an optional sub_benefit_code if a more detailed check is needed.
Dependent Data Retrieval: Our system first ensures that comprehensive patient details are available (using the Client Registry ID) and then retrieves the complete profile of the specified facility (including its KEPH level, ownership, and contracted status). This relies on successful outcomes from previous workflows like Patient Search and facility data validation.
Rule Application (SHA Intervention Matrix): The system performs a multi-layered evaluation:
- It considers the patient's overall eligibility and specific sub-benefits determined in previous steps.
- It cross-references this with the facility's capabilities and its contractual agreements with SHA for specific interventions.
- It applies the Social Health Authority's detailed rules for benefits coverage, which might vary based on patient demographics, facility details and the services requested.
Intervention Determination: Based on the application of these rules, and the selected sub-benefit from the previous workflow, the system compiles a list of individual, covered interventions (e.g., "Appendectomy," "Malaria Test," "Specific Drug Prescription Code") that the patient is eligible for at that exact facility.
Outcome Delivery: The determined list of eligible interventions is prepared for use by the integrating system.
### 2.2. Key Validations: Our System's Essential Checks
These are the critical validations our internal system performs to ensure an accurate and successful intervention coverage determination. Understanding why these are in place helps you provide the correct information from your end.
Valid Facility Information (ID and Type) Must Be Provided:
- The system requires both a correct facility_id (the unique identifier for the health facility) and its facility_id_type (e.g., fr-code, registration-number).
- This is important as interventions are highly dependent on the facility's capabilities and authorisations. Our system needs precise facility identification to apply the correct rules about what specific procedures, tests, or treatments it is licensed and contracted to provide under SHA. Inaccurate facility data will lead to incorrect intervention lists.
Beneficiary Client Registry ID (CR ID) Is Mandatory:
- The patient's beneficiary_cr_id, obtained from the Patient Search workflow, must be provided.
- This ID is important as it is the primary link to the patient's full medical and eligibility profile. Without it, the system cannot access the patient's entitlements and apply the granular rules for specific interventions.
Facility ID Type Must Be a Valid Option:
- The facility_id_type must be one of the supported types recognised by our Facility Registry (e.g., fr-code, registration-number, fid).
- This is essential as it ensures the system correctly interprets and queries the Facility Registry for essential details needed to determine facility-specific intervention eligibility.
Patient Must Have a Valid Age and Gender:
- The patient's details retrieved via their CR ID must include a specified and valid age and gender.
- This is important as many interventions have age- or gender-specific eligibility criteria defined by SHA. For example, certain screenings are only for specific age groups. Missing or invalid demographic data will prevent accurate rule application for interventions.
Patient Records Fetched from CR only (not locally):
- The patient's data should only be from the Client Registry (CR) and not from any local database.
- This is important as it ensures that the Client Registry remains the ultimate "single source of truth" for patient biodata. It guarantees that our system always uses the most accurate and up-to-date patient information for benefit determination.
Facility Must Meet SHA Criteria (KEPH, Ownership, Contracted):
- The retrieved facility details must explicitly define its Kenya Essential Package for Health (KEPH) level, clearly indicate its ownership (e.g., government, private, faith-based), and confirm that it is formally contracted by SHA to offer services. These are essential in validating that the facility is allowed to offer services and be paid by SHA.
- These three attributes are absolutely important for applying SHA's rules. The KEPH level defines the scope of services a facility is equipped for, ownership can influence certain benefits, and being "contracted" confirms its legal standing to provide SHA-covered services. Without these, the system cannot accurately determine what interventions are valid at that specific location.
### 2.3. Workflow Data Dictionary
This helps show you the information we work with, whether it is required or not and in what format the system expects it in.
 | Field Name | Description | Data Type | Required | Purpose
 | Beneficiary Client Registry ID | The patient's unique identifier was obtained from a successful Patient Search. | String | Yes | This is the patient's identity key. It ensures we are determining interventions for the correct individual and can access their full eligibility profile established in prior steps.
 | Facility Identifier | The unique identification number for the health facility where services are being considered. | String | Yes | This identifies the specific facility for the intervention. The facility's capabilities and SHA contracts are directly linked to this ID, fundamentally impacting which interventions are deemed eligible at that site.
 | Facility Identifier Type | The category or type of the Facility Identifier (e.g., fr-code, registration-number). | String | Yes | This tells our system how to interpret the Facility Identifier, allowing it to correctly query our Facility Registry and retrieve essential details needed for granular intervention determination.
 | Service Type | The broad classification of the healthcare service being considered (e.g., INPATIENT, OUTPATIENT). | String | Yes | This provides a broad context for the intervention check. While interventions are specific, their eligibility can still be influenced by whether they occur during an inpatient stay, an outpatient visit, or an emergency, guiding the application of certain SHA rules.
 | Sub-Benefit Code | (Optional) A specific code for a sub-benefit (e.g., "Dental Care"). If provided, the system will narrow its intervention search to within this sub-benefit. | String | No | This field allows for a more focused query. If you know the general sub-benefit category of the intervention you're looking for, providing this code can help the system return a more relevant and streamlined list of specific interventions, making the output more manageable.
### 2.4. What each returned intervention tells you
This is the endpoint that carries the per-intervention flags the rest of the claim flow branches on. Read
them off the intervention rather than hard-coding behaviour per code, because they change without notice and
they differ between schemes.
Field names arrive camelCase on this response. Some claims payloads carry the snake_case equivalents, so
read whichever form the endpoint you actually called returned rather than assuming one convention across the
API.
A single intervention, in full
Filtered to one intervention with code=SHA-19-152. Fields not shown here are covered in the tables that
follow:
Code 
{
  "count": 1,
  "pageSize": 10000,
  "currentPage": 1,
  "totalPages": 1,
  "results": [
    {
      "id": 144,
      "accessPoint": "IP",
      "name": "Nerve release and decompression",
      "code": "SHA-19-152",
      "paymentMechanism": "FEE FOR SERVICE",
      "needsPreauth": true,
      "needsManualPreauthApproval": false,
      "needsDoctorAuthorization": true,
      "overallTariff": "44800",
      "kephLevelTarriff": "0",
      "fund": "ALL",
      "fallBackOverallTariff": "0",
      "numberOfDoctorsRequired": 0,
      "level2Tariff": "0",
      "level3Tariff": "0",
      "level4Tariff": "0",
      "level5Tariff": "0",
      "level6Tariff": "0",
      "requiresSurgicalPreauth": true,
      "requiresRenalPreauth": false,
      "requiresOncologyPreauth": false,
      "requiresRadiologyPreauth": false,
      "requiresOpticalPreauth": false,
      "applicableSchemes": ["PMF", "UHC"],
      "applicableDocumentTypes": [
        "CLAIM_FORM",
        "DISCHARGE_SUMMARY",
        "FINAL_BILL",
        "THEATRE_NOTES",
        "MEDICAL_REPORT"
      ],
      "requiredPreauthDocumentTypes": [
        "IMAGING_RESULT",
        "LAB_RESULTS",
        "MEDICAL_REPORT",
        "PREAUTH_FORM"
      ],
      "requiredClaimDocuments": [
        { "key": "CLAIM_FORM", "label": "Claim Form", "anyOf": ["CLAIM_FORM"] },
        { "key": "THEATRE_NOTES", "label": "Theatre Notes", "anyOf": ["THEATRE_NOTES"] }
      ]
    }
  ]
}
### Amounts are illustrative and must be read live
The figures above are what this one intervention returned at the time of writing. Tariffs change, and
they differ by scheme and by facility. Always read the amount from the response at the point of billing.
Never cache it, and never hard-code it against an intervention code.
Read the identity fields first: code is the value carried into every downstream call - Create Virtual
Claim, Add Diagnosis, Add Line and Create Preauth all take it - while name is what you display and
accessPoint says whether the intervention is billable in the current visit context.
Amounts
 | Field | What it means
 | KEPH-level tariff fields | The amount payable at each facility level, level2Tariff through level6Tariff. Use the one matching the treating facility's KEPH level.
 | Overall tariff | Some interventions carry a single amount for every level instead of a per-level ladder. Read whichever the intervention returns - do not assume the ladder is always present.
 | Fallback tariffs | fallBackOverallTariff and fallBackLevel2Tariff through fallBackLevel6Tariff take over after numberOfDaysToFallback days, where the intervention defines one.
 | paymentMechanism | Case-based, per diem, fee for service, fixed fee for service or capitation. It decides whether the amount is per episode or per day.
Choosing the amount. Check the level tariff for your facility's KEPH level first. If it is zero or does
not apply, fall back to the overall tariff. Two cases sit outside this rule entirely:
- POMSF covers resolve through the POMSF endpoints instead - see
PMF Tariffs, which is also what accounts for a rate negotiated for your
specific facility.
- Capitation services have no per-line tariff at all. Billing is capitated, so there is no amount to
read off the intervention.
### The field name is misspelled in the API
The single-level tariff field comes back as kephLevelTarriff, with the doubled r. It is spelled that
way in the response, so your integration has to match it exactly. Reading kephLevelTariff returns
nothing and silently bills zero.
paymentMechanism decides which flow to run
Two values change the shape of the whole visit, not just the amount:
 | Value | What it means for the flow
 | CAPITATION | A Primary Health Care service. There is no fee-for-service billing beyond the capitated rate. See Scenario 6: UHC OP Capitation.
 | PER DIEM | An inpatient service paid at a daily rebate for as long as the patient is admitted. Distinct billing rules apply - the day of admission counts as Day 1, and same-day discharge is not billable. See Scenario 1: SHIF IP Per Diem.
 | FEE FOR SERVICE | The standard billing path.
Fixed fee for service and case-based are also returned. Both bill per episode; see the
Benefit Matrix for how each is settled.
Preauthorization flags
 | Field | Type | What it means
 | needsPreauth | boolean | The intervention cannot be billed without an approved preauthorization.
 | needsManualPreauthApproval | boolean | true means the preauth is elective: SHA reviews it manually and it must be approved before the visit. false means the standard same-day flow. See Elective Preauthorizations and Normal Preauths.
 | needsDoctorAuthorization | boolean | true means the attending doctor must approve the request. When it is true, creating the preauthorization sends the doctor request automatically - by two-way SMS, Practice360 or email - and the preauth waits for their response. You do not call anything extra; the doctor-consent endpoint only resends a request that did not arrive.
Which preauthorization form to render
Five further flags on the same object tell you which of the purpose-built preauth forms applies. Each
variant asks for its own extra clinical fields, so this is what decides the form your user sees:
 | Flag | Variant | Extra clinical fields it asks for
 | requiresSurgicalPreauth | Surgical | Chief complaint, surgery date, anaesthesia type, vitals, history of presenting illness, physical examination, investigation report
 | requiresRenalPreauth | Renal | Sessions required, cost per session, frequency, start date, clinical indications
 | requiresOncologyPreauth | Oncology | Carcinoma staging, metastases, treatment setting, sessions required, cost per session
 | requiresRadiologyPreauth | Imaging | Clinical indications
 | requiresOpticalPreauth | Optical | Lens prescription, lens, frame and examination amounts, new versus replacement
Typically exactly one of these is true. When all five are false, use the base form - see
Normal Preauths and
Preauths Process Overview. The full request shape
for each variant is in the POST /preauths reference.
Required documentation
Which documents a claim or preauthorization must carry is a property of the intervention, not a fixed list
you can hard-code:
 | Field | What it means
 | applicableDocumentTypes | Documents required for the claim.
 | optionalDocumentTypes | Documents that may accompany the claim but are not required.
 | requiredPreauthDocumentTypes | Documents required for the preauthorization.
 | optionalPreauthDocumentTypes | Documents that may accompany the preauth but are not required.
A claim carrying several interventions inherits the union of their requirements. See
Adding Attachments for how to attach them and the regulator's
auto-attach requirement.
requiredClaimDocuments is the structured form of the same requirement, and it is the one to build
your document checklist from where it is present. Each entry carries a key, a display label and an
anyOf array:
Code 
{ "key": "MEDICAL_REPORT", "label": "Comprehensive Medical Report", "anyOf": ["MEDICAL_REPORT"] }
### anyOf means any one of them satisfies the requirement
A requirement is not necessarily a single mandated document type. Supplying one of the types listed
in anyOf is enough to satisfy that entry. The types are the same vocabulary the claim attachment
upload accepts as its document_type, and label is written for display to the person collecting the
documents.
Other fields worth reading
 | Field | What it means
 | numberOfDoctorsRequired | When non-zero, this many doctors must be attached to the claim or preauthorization. See Adding a Claim Doctor.
 | tariffPerAdditionalKilometer | Used by ambulance and emergency medical transport interventions, where distance travelled is billable on top of the base amount.
 | applicableSchemes | Which schemes the intervention is available under, e.g. PMF and UHC.
 | fund | The fund the intervention is paid from, e.g. ALL. Where the sub-benefit returned an empty fund, this is the value to read.
 | needsMemberAuthorization | The member must authorise the service in addition to any preauthorization.
 | needApprovalBeforeClaimSubmission | Approval must be in hand before the claim is submitted, not merely requested.
Access and eligibility
accessPoint, facility-level range, gender and age limits, and the limit basis (individual or household) all
come back per intervention. The day and session limits that decide how much of a covered intervention is
payable - global periods, the 180-day household cap, the 12-day critical care threshold - are rules rather
than fields; see Special Benefit Rules. Read consumption so far from
Patient Utilization.
See the Claims and Preauths API reference for the complete response schema.
### 2.5. Expected Outcomes
- Successful Retrieval of Interventions: The system successfully identifies and returns a list of specific interventions (e.g., procedure codes, medication codes) that the patient is eligible to access at the given health facility, according to SHA rules and the facility's scope.
- No Interventions Found: The system indicates that, while the patient and facility are valid, no specific interventions could be found for the given criteria (e.g., the patient not covered for any service at that specific facility's level, or the requested service type has no corresponding interventions).
- Input Error: The system identifies that the provided input (patient ID, facility ID, etc.) did not meet our validation rules, preventing the intervention check from executing properly.
## 3. Critical Success Factors for Intervention Coverage Integration
For your integration with the Intervention Coverage workflow to be successful, keep these key points in mind:
- Accurate Input from Previous Steps: Ensure the beneficiary_cr_id and facility_id you're providing are correct and consistently validated from the Patient Search and Facility Registry, respectively. Errors in upstream data will cascade.
- Understanding SHA Rules for Interventions: While our system applies the complex rules, a conceptual grasp of how patient status and facility type influence specific intervention eligibility will aid in interpreting results and troubleshooting.
- Handling "No Interventions Found" Scenarios: Be prepared for situations where, even if a patient is generally eligible, no specific interventions are covered at a given facility or for a given service type. Design your system to clearly communicate such outcomes to end-users.
## 4. Related Resources
This endpoint is the authoritative source for per-intervention tariffs, preauthorization flags and payment
mechanisms. The rules that decide how many days or sessions of a covered intervention are payable live in the
benefit rules guides.
- Special Benefit Rules - maternity, imaging, surgical, critical care, inpatient and substance-abuse rehabilitation rules.
- Understanding Benefits and Intervention Codes - how the code hierarchy works.
- SHA Combination Rules - which returned interventions may share one visit.
- Adding Attachments - the four document-type fields and how to attach documents.
- Elective Preauthorizations - what needsManualPreauthApproval: true puts you into.
- Preauth Doctor Consent - resending a doctor request when needsDoctorAuthorization is true.
- Preauths Process Overview - choosing the preauth path from these flags.
- Patient Utilization - days and amounts already consumed.
- Scenario 1: SHIF IP Per Diem - how the per-KEPH-level tariff fields are used when billing.
- PMF Tariffs - POMSF tariff resolution.
Last modified on September 28, 2026
