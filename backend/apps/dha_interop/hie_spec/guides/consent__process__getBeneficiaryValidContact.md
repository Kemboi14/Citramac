# Start Visit Process Guide: Get Beneficiary Valid Contact
## Start Visit Process Guide: Get Beneficiary Valid Contact Workflow
### 1. Overview: Retrieve and Validate the Beneficiaryʼs Contact Details
This guide focuses on the Get Beneficiary's Valid Contact Workflow, a foundational step in our broader Start Visit Process. This workflow's primary role is to retrieve and validate the crucial contact information associated with a patient's beneficiary. It confirms if the beneficiary is an active SHA member and possesses a valid phone number, which is an essential prerequisite for sending consent One-Time Passwords (OTPs). For cases involving deceased beneficiaries, it prioritises displaying next-of-kin contacts, and for minors, it ensures the provision of valid parent or guardian contact details.
1.1. What This Workflow Does
The Get Beneficiary's Valid Contact Workflow's primary function is to securely obtain and validate the accurate contact details of a specific patient. You call GET /api/v1/patients/contacts with the patient_id query parameter, and it returns the patient's valid registered contacts. It achieves this by:
- Identifying the Patient: Using the provided patient_id, it looks up the patient and their registered contacts.
- Determining Relevant Contacts: For patients who are minors or dependents of a deceased beneficiary, it identifies and prioritises the contact information of the designated parent/guardian or next of kin, respectively.
- Returning Valid Contacts: It returns the patient's valid contacts, each with a masked value (for example, "+254714***898") and an id you can pass to the Send OTP workflow.
1.2. Why This Workflow Is Critical
Getting the beneficiary's contact information precisely correct from the start is important for initiating a valid and compliant patient visit claim. This workflow is critical because it:
- Enables Secure Consent: Ensures that consent OTPs, which are vital for verifying a patient's presence and agreement to services, are sent to the correct and authorised individual (the beneficiary, parent/guardian, or next of kin). This prevents unauthorised consent and potential fraud.
- Confirms Valid Membership: Verifies that the beneficiary is a valid, active member registered under SHA. This is a foundational check for all subsequent financial and service-related processes.
- Facilitates Crucial Communication: Provides reliable contact points for any necessary follow-up or emergency communication related to the patient's visit.
- Supports Compliant Claiming: By confirming the accuracy of beneficiary contacts, it strengthens the position for healthcare facilities to make legitimate claims for services provided to SHA.
This workflow ensures that all subsequent steps of the Start Visit Process, especially consent and communication, are built upon accurate and verified information.
## 2. Workflow Details: Get Beneficiary Valid Contact
### 2.1. Workflow Description
When eligibility checks are completed and a patient is ready to receive a medical intervention, triggering the start of a visit, here's the internal process that unfolds for contact retrieval:
Input Received: The system receives the patient_id query parameter identifying the patient whose contacts are being retrieved.
Contact Data Fetching: Using the provided patient_id, it securely fetches the patient's registered contact details.
Phone Number Validation: From the retrieved contact details, it checks for the presence of at least one valid and active phone number associated with the patient. This number is flagged for OTP delivery.
Output: The patient's valid contacts are returned, each with a masked value and an id that can be passed to the Send OTP workflow as contact_id.
### 2.2. Key Validations: Our System's Essential Checks
There are some essential checks our system performs behind the scenes to ensure a successful and accurate execution of this workflow. Understanding these helps you provide the correct information from your end, preventing errors.
Valid Patient Identifier:
- The patient_id provided must be a valid, existing, and correctly formatted identifier recognised by the system.
- This ID is the absolute foundation for accessing any patient contact information. It serves as the single source of truth for accurate and up-to-date data.
- Without a valid patient_id, the system cannot uniquely identify the patient, making it impossible to retrieve their contacts.
Presence of at Least One Valid Phone Number:
- After fetching beneficiary details, the system verifies that at least one functional phone number is registered and available for communication.
- A valid phone number is critical for the subsequent Send OTP Workflow, which relies on sending an OTP to this number for explicit patient/beneficiary consent. Without it, the consent process cannot be completed, preventing the start of a visit.
Correct Contact Identified for Minors/Deceased Dependents:
- For patients identified as minors or dependents of deceased beneficiaries, the system must accurately identify and provide the contact information of their registered parent/guardian or next of kin, respectively.
- This ensures that consent for the visit is sought from the appropriate and authorised individual, which makes it compliant for a valid healthcare encounter.
### 2.3. Workflow Data Dictionary
This table helps you understand the key pieces of information this workflow uses, whether they're required, and the conceptual format our system expects.
 | Field Name (Conceptual) | Description | Data Type (Conceptual) | Required | Purpose / What it Means (to the Business)
 | patient_id | The unique identifier of the patient whose contacts are being retrieved. Passed as a query parameter on GET /api/v1/patients/contacts. | String | Yes | This is the identity key that tells our system which patient we need to retrieve contacts for. It is the only input to this endpoint.
### 2.4. Expected Outcomes from this Workflow
When you query this workflow, here's what you can expect in return:
Success: Patient Found & Valid Contacts Retrieved:
- The system successfully identifies the patient and returns their valid contacts (each with a masked value and an id), including relevant next-of-kin/parent/guardian contacts if applicable. This sets the stage for the next step in the Start Visit Process, where the chosen contact's id is passed to Send OTP.
Failure: Patient Not Found:
- The provided patient_id does not correspond to any valid record in the system. The visit cannot be initiated. The user may need to re-verify the identification details.
Failure: No Valid Phone Number Found:
- The patient record is found, but no valid or active phone number is registered for them (or their next of kin/guardian for minors/deceased dependents). The OTP consent workflow, therefore, cannot proceed.
## 3. Critical Success Factors for Get Beneficiary Valid Contact Integration
For your integration with the Get Beneficiary Valid Contact Workflow to be successful, keep these key points firmly in mind:
- Provide a Valid Patient Identifier: Always ensure you provide a correct and validated patient_id. This is the single most critical input; any error here will halt the process.
- Plan for Missing Contacts: Design your system to handle scenarios where a patient might not have a registered phone number.
## 4. Related Resources
- Send OTP Guide
- Scenario 1: SHIF IP Per Diem
- Scenario 2: SHIF IP FFS Normal Preauth
- Consent API Reference
Last modified on September 28, 2026
