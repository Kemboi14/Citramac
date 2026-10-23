# Start Visit Process Overview
## Start Visit Process Overview: Initiating a Valid Patient Encounter
### 1. Introduction: Understanding the Start Visit Process
This comprehensive guide provides a clear overview of how our system manages the initiation of a patient's visit at a healthcare facility. This process is crucial for establishing a valid patient encounter, ensuring all necessary information is captured from the beginning.
The Start Visit Process involves:
- Obtaining explicit patient consent via a One-Time Password (OTP) or a biometrics fingerprint match to confirm their presence and agreement to receive services.
- (Optionally, on the OTP path) retrieving a specific beneficiary contact to which the OTP should be sent.
This series of interconnected steps is designed to ensure a valid healthcare visit is formally initiated, serving as the foundation for all subsequent services a patient receives. It confirms the patient's physical presence for treatment and captures vital information, enabling the facility to accurately claim compensation from the Social Health Authority (SHA) for services provided. This critical process comes after the successful confirmation of a patient's eligibility for the necessary interventions.
1.1. Why This Full Process Matters
An accurate Start Visit Process is important for creating a valid patient visit claim that complies with Social Health Authority (SHA) guidelines. It's not just a formality; it's fundamental for smooth operations and financial integrity. Its importance can be summarised as follows:
- Validates Patient Presence: Ensures that a patient has physically arrived at the healthcare facility and is actively seeking services, preventing fraudulent claims.
- Secures Payment Claims: With verified patient consent via OTP or biometrics, the healthcare facility gains a solid basis for accurately claiming payments from SHA for services rendered.
- Formalises Visit Initiation: Allows the healthcare facility to formally commence a valid visit, gathering all preliminary information required by SHA for proper documentation and subsequent processes.
- Ensures Compliance: Guarantees that every patient encounter begins in adherence to national standards and regulatory requirements.
## 2. The Full Start Visit Process Journey: Step-by-Step Encounter Creation
The complete Start Visit Process is a multi-step journey, centred around ensuring a healthcare facility accurately initiates a valid visit with a patient. Each workflow builds upon the results of the previous one, creating a seamless and verified encounter.
Here are the key workflows in their sequential order:
### 2.1. Step 1: Obtain Patient Consent (OTP or Biometrics)
This step obtains the patient's explicit consent. There are two parallel paths - choose the one your facility is set up for. The eligibility response flags (whitelistedForOTP and facilityBiometricsEnforced) tell you which path applies to a given patient and facility.
OTP Path
Generate and send a One-Time Password (OTP) to the beneficiary's validated contact number. The OTP verifies the patient's presence at the specific healthcare facility and their approval for seeking medical services. The OTP is then submitted as part of the Start Visit request in Step 2. See Send OTP.
Biometrics Path
Call POST /api/v1/claims/authorize with biometrics-specific fields (including a work_station_id from your Hardware Server and the biometrics agent's National ID). The system creates an authorization record in PENDING status and returns an iframe link. Render the iframe in your UI so the patient can place their finger on the connected device. On a successful fingerprint match, the authorization transitions from PENDING to AUTHORIZED, and its authorization is then submitted in Step 2 instead of an OTP. See the Biometrics Integration Guide.
Both paths lead to the same outcome: a verified patient authorization that can be used to formally start the visit.
### Getting a beneficiary contact is optional and OTP-only
On the OTP path you may first retrieve a specific beneficiary contact to receive the OTP - see Get Beneficiary Valid Contact. This step is optional: if you do not supply a contact, the beneficiary's default contact is used. It does not apply to the biometrics path.
For end-to-end scenario walkthroughs, see:
- Scenario 1: SHIF IP Per Diem
- Scenario 2: SHIF IP FFS Normal Preauth
- Scenario 5: SHIF OP FFS Normal Preauth
### 2.2. Step 2: Start Visit Workflow
This is the concluding step where the actual visit claim is created in the system. It validates that all previously required information (the complete "payload," including a verified OTP or the biometrics authorization) is present and correct. Upon successful creation, it responds with essential patient visit details and an authorization_code.
### The authorization_code IS the consent_token
The authorization_code returned by the Start Visit response is the consent_token used by subsequent steps (for example when adding diagnoses, line items, or creating a preauth). Store it securely and reuse it.
### Attaching the doctor (optional here)
The treating practitioner may be attached at start visit, but this is optional. Only one doctor is required on the claim, and that doctor can be added via any one of start visit, add diagnosis, or add line item. See Adding a Claim Doctor.
This workflow is important as it officially marks the commencement of a patient's encounter with a health facility within our system. Successfully creating this visit's claim is foundational, leading directly to subsequent processes like detailed intervention recording and financial billing workflows.
## 3. How Workflows Connect
While each workflow in the Start Visit Process has a specific task, they are deeply interconnected. Data flows seamlessly from one step to the next:
- Cascading Dependencies: Each subsequent workflow critically depends on the successful completion and accurate output of the preceding steps. For example, the OTP path requires a valid contact number (either the default contact or an optionally retrieved one); the biometrics path requires the workstation and agent details to be ready before calling the authorize endpoint.
- Consistent Identifiers: Patient identifiers are consistently used, ensuring that all checks and actions pertain to the correct individual.
- Dynamic Rule Application: Information gathered in earlier steps (e.g., beneficiary status, facility type) directly influences the rules applied in later stages, ensuring compliance and accurate visit initiation.
## 4. Key Success Factors for Overall Start Visit Integration
For your integration with the entire Start Visit Process to be successful and efficient, keep these overarching principles in mind:
- Complete and Accurate Inputs: Ensure the required patient and facility details are accurate. Incomplete or incorrect data will hamper the process.
- Choose the Right Consent Path: Determine whether your facility will use OTP-based or biometrics-based patient authorization. Both paths are supported; the biometrics path requires an active Hardware Server (fingerprint device) and a biometrics agent National ID. Ensure your integration handles both success and failure scenarios for whichever path you use.
- Design for All Outcomes: Be prepared to handle all possible responses from our workflows (e.g., "Beneficiary's Contacts Not Found," "OTP Not Verified," "Biometrics Authorization Pending/Failed," "Visit Creation Error"). Design your system to clearly communicate these outcomes to end-users.
By understanding and adhering to these principles, you can ensure a smooth, accurate, and effective integration with the Start Visit Process, ultimately contributing to successful patient encounters and compliant claims with SHA.
Last modified on September 28, 2026
