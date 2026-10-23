# Eligibility Process
## Eligibility Process
### Understanding the Eligibility Process
1. Introduction
The Eligibility Process is a multi-step journey aimed at determining exactly which healthcare services and interventions a patient is eligible for. This comprehensive guide offers a high-level overview of how these specific healthcare services, benefits, and treatments to which a patient is entitled are determined.
The Eligibility Process is a series of interconnected steps designed to ensure that the right patient receives the right care, at the right facility, and that this care is properly covered according to the rules set by the Social Health Authority (SHA). It's about moving from simply identifying a patient to confirming their precise healthcare entitlements.
1.1. Why This Full Process Matters
An accurate Eligibility Process is key to efficient, fair, and compliant healthcare delivery. It is crucial because it:
- Ensures Fair Access: Guarantees that patients receive services aligned with their entitlements and contributions.
- Prevents Financial Surprises: Provides clarity to patients and providers upfront, avoiding unexpected costs and disputes at the health care facility.
- Protects the various Health Funds: Safeguards the financial sustainability of the Social Health Authority and its constituent funds by ensuring proper claims and preventing unauthorised services.
- Promotes Compliance: Adheres strictly to national healthcare regulations and policies.
- Streamlines Care Delivery: Equips healthcare providers with immediate, accurate information, enabling quicker and more informed treatment decisions.
- Maintains Data Integrity: Creates a reliable, single source of truth for patient eligibility, reducing errors and duplication.
### 2. The Eligibility Journey: Step-by-Step Process
The complete Eligibility Process is a multi-step journey, with a number of workflows, each building up to the next. The eligibility check comes first - if the patient is not eligible, you stop early and avoid the downstream benefit, intervention, and balance lookups. Here are the key workflows in order:
2.1. Step 1: Patient Search
This is the foundational first step. It's all about accurately identifying the patient. Our system looks up a patientʼs details from a central database for patient identities using unique identifiers (like National Identity Number) to retrieve the patient's verified information.
This is important as, without having accurate data on the patient, all subsequent checks are impossible or unreliable. It ensures we're building the entire eligibility determination on the correct individual's foundation.
2.2. Step 2: Eligibility Check
Once the patient is identified, this workflow immediately confirms whether the patient is currently covered by SHA. It returns the patient's coverage status, their covered schemes, and key flags (such as whether the patient is alive, whether OTP consent is permitted, and whether the facility must enforce biometrics).
This step comes first because it is the decision gate for everything that follows. If the patient is not eligible, stop here - there is no need to query benefits, interventions, or balances. See the Eligibility Check Workflow for full details.
2.3. Step 3: Benefits and Sub-Benefits Coverage
For an eligible patient, this workflow determines the healthcare packages the patient is entitled to at the facility. Coverage is structured as a hierarchy: a benefit (parent) breaks down into sub-benefits, which in turn contain interventions. It cross-references the patient's details with the facility context supplied through the request headers or JWT.
This step is important as it establishes the scope of services the patient can access. See Benefits Coverage and Sub-Benefits Coverage.
2.4. Step 4: Intervention Coverage
Building on the sub-benefits, this workflow refines the eligibility further to pinpoint the exact healthcare interventions (specific medical procedures) a patient is eligible to receive. It applies the Social Health Authority's (SHA) detailed rules, considering the patient's eligibility and the specific facility's licensed capabilities and contractual agreements with SHA for those interventions.
This is important as it is the level of detail needed for actual clinical decisions and accurate billing. It informs what specific treatments a patient can receive at a facility. It prevents unauthorised procedures and ensures accurate tariff enforcement. See Intervention Coverage.
2.5. Step 5: Utilization and Balances (as needed)
Where you need to know how much of a benefit has already been consumed or what balance remains, two further lookups are available:
- Patient Utilization: shows the utilised-versus-remaining limits for a specific intervention.
- POMSF Balance: shows remaining balances for members of the POMSF (Public Officers Medical Scheme Fund).
2.6. The Chain in Practice: What to Carry From Each Response
Each step hands a value to the next. These are the actual parameters, in order:
1. Confirm the patient is covered.
Code 
GET /patients/eligibility
Returns coverage status and the schemes the patient holds. If the patient is not eligible, stop here.
2. List the benefit packages.
Code 
GET /patients/benefits?patient_id={crId}
Read parentBenefitCode off each result, e.g. SHA-19. Nothing outside this list is billable. See
Benefits Coverage.
3. Drill into one benefit.
Code 
GET /patients/sub-benefits?patient_id={crId}&parent_benefit_code=SHA-19
Filter the results by accessPoint against the visit type you are in, then read code off the
sub-benefit the clinical user selected, e.g. SHA-19-SC-13. See
Sub-Benefits Coverage.
4. Find the intervention.
Code 
GET /patients/benefits/interventions?patient_id={crId}&sub_benefit_code=SHA-19-SC-13
This is the atomic unit of what gets claimed, and the record you branch on. See
Intervention Coverage.
5. Start the visit, create the claim or create the preauthorization, carrying the intervention code
forward into every downstream call.
Five decisions you read off the intervention
The intervention record is not just a code and a price. Every field on it drives downstream behaviour:
- Which flow to run - paymentMechanism. Capitation and per diem are distinct flows, not just
different amounts. See Scenario 6 and
Scenario 1.
- Whether a preauthorization is needed - needsPreauth, and needsManualPreauthApproval for whether
it is elective. See Preauths Process Overview.
- Which preauthorization form to render - the five requiresXPreauth flags, each with its own extra
clinical fields.
- Which tariff applies - the KEPH-level ladder for your facility, or the overall tariff, or the POMSF
endpoints. See PMF Tariffs.
- Which attachments to collect - applicableDocumentTypes and requiredPreauthDocumentTypes. See
Adding Attachments.
Read these off the response rather than hard-coding behaviour per intervention code. They change without
notice and they differ between schemes.
### 3. How Workflows Connect
While each workflow has a specific job, they are deeply interconnected. Data flows seamlessly from one step to the next, with crucial cross-workflow validations ensuring integrity:
- Single Source of Truth: Core patient data is always sourced from a central database via Patient Search, ensuring a consistent patient data across all subsequent checks. Similarly, facility data is validated against a central Facility Registry database.
- Cascading Dependencies: Each subsequent workflow depends on the successful completion and accurate output of the preceding steps. For example, if a patient cannot be found, no further eligibility checks can proceed.
- Consistent Identifiers: The patient and facility identifiers must be consistently passed and remain valid across all relevant workflows to ensure that all checks are performed for the correct individual and facility visited.
- Dynamic Rule Application: Information gathered from earlier workflows, like patient details, facility details, and coverage status, dynamically informs the SHA rules applied in later stages to determine precise eligibility.
### 4. Key Success Factors for Overall Eligibility Integration
For your integration with the entire Eligibility Process to be successful and efficient:
- Accurate Patient Identification: Ensure accurate patient details are obtained from a successful Patient Search. This is the foundation of the entire process.
- Validate Facility Data: Consistently provide correct and verified facility identifiers, as facility capabilities and contracts are central to benefits and interventions.
- Understand Interdependencies: Recognise that errors or missing data in an earlier workflow will inevitably cascade and cause failures or incorrect outcomes in later steps.
- Understand SHA Rules: Having a minimal understanding of how patient status, facility type, and coverage status influence eligibility will help you interpret results and troubleshoot effectively.
- Design for All Outcomes: Be prepared to handle all possible responses from our workflows (e.g., "Patient Not Found," "Not Eligible," "No Benefits Found," "Input Error") and design your system to clearly communicate these to end-users.
## 5. Related Resources
See how the eligibility process fits into end-to-end integration flows:
- Scenario 1: SHIF IP Per Diem
- Scenario 2: SHIF IP FFS Normal Preauth
- Scenario 3: SHIF IP FFS Elective Preauth
- Scenario 4: SHIF OP FFS Elective Preauth
- Scenario 5: SHIF OP FFS Normal Preauth
- Scenario 6: UHC OP Capitation
- HIE Registries API Reference
Last modified on September 28, 2026
