# Start Visit Process Guide: Send OTP Workflow
## Start Visit Process Guide: Send OTP Workflow
### 1. Overview: Securing Patient Consent
This guide details the Send OTP Workflow, a critical step within the broader Start Visit Process. This workflow manages the entire patient consent mechanism by using One-Time Passwords (OTPs) to gain explicit authorisation for a patient's visit and related health record access under the Social Health Authority (SHA).
1.1. Why This Workflow Is Critical
This workflow is vital because it represents the point at which patient engagement and explicit consent must be obtained before a visit can be formally initiated. It's critical as it helps in:
- Ensuring Patient Consent: It is the primary mechanism for obtaining the patient's direct and verifiable approval.
- Enabling Formal Visit Initiation: A successful OTP process is a non-negotiable prerequisite for the final Start Visit Workflow.
- Preventing Unauthorised Access: By requiring OTP verification, it adds a layer of security, ensuring only the authorised patient consents to the visit and any associated access to their health records.
In short, this workflow ensures every patient encounter respects privacy by obtaining explicit consent, a fundamental requirement for valid healthcare service delivery under SHA.
## 2. Workflow Details: Send OTP
This part of the workflow manages sending the One-Time Password (OTP) to the patient's registered phone number to initiate the consent process.
### 2.1. What This Workflow Does
The Send OTP Workflow prepares and sends an OTP to the beneficiaryʼs phone number. It handles:
- Receiving Patient Identifiers: This process involves obtaining the patient's unique identifier (patient_id), the intervention_codes for the services being consented to, and, optionally, the specific contact to send the OTP to (contact_id).
- Preparing Consent Request: Using these inputs, the system internally gathers all necessary patient information (like phone number), facility details, and the specific permissions required for this consent service.
- Requesting OTP Dispatch: The system sends this prepared request to generate and send an OTP.
- Obtaining Consent Reference: If successful, it receives a unique reference ID for this consent request, essential for later verification.
- Providing Status: It communicates whether the OTP was successfully requested and sent.
### 2.2. Step-by-Step System Behavior
Pre-step: Retrieve Patient Contacts
Before sending an OTP, call GET /api/v1/patients/contacts to retrieve the patient's registered contacts. The response returns a list of contacts with masked values (for example, "+254714***898") and their IDs. Show the patient the masked number to confirm which contact to use, then pass the id from that contacts record as contact_id in step 1 below. If contact_id is not provided, the system sends the OTP to the patient's default contact.
Input Reception: The system receives the patient's patient_id, the intervention_codes for the services being consented to, and, optionally, a contact_id.
Internal Patient Data Lookup: Using these inputs, the system looks up the patient's registered phone number, the facility's identifier, and the required consent permissions (e.g. access to the patient's record).
Request OTP: The system securely sends this prepared patient, facility, and permission information to the consent service.
Processing & Dispatch of OTP: The system generates a unique OTP and sends it via SMS to the patient's phone.
Receive Response: The system gives a response indicating if the OTP was sent and providing a unique consent_request_id.
Outcome Processing: The system stores the consent_request_id for the next step.
### 2.4. Workflow Data Dictionary (Conceptual)
This table outlines the key information used and produced by this workflow:
 | Field Name (Conceptual) | Description | Data Type (Conceptual) | Required | Purpose
 | intervention_codes | The intervention codes for the services the patient is consenting to. | Array of Strings | Yes | Tells the consent service which services and permissions the OTP is authorising.
 | patient_id | The patient's unique identifier. | String | Yes | Identity key used to find all patient and contact details for the SHA consent request.
 | contact_id | An optional identifier for a specific patient contact to send the OTP to. Obtain this by calling GET /api/v1/patients/contacts, selecting the desired contact from the masked list, and using its id. | Integer | No | Ensures the OTP is sent to a specific phone number. If not provided, the system sends to the patient's default contact.
### 2.5. Expected Outcomes
Success: OTP Successfully Dispatched
- The system successfully requested, and SHA confirmed the OTP was sent to the patient. A consent_request_id is provided. The workflow can proceed to Start Visit Workflow.
Failure: Invalid Patient/Contact Data
- The provided patient ID or contact ID was invalid or could not be found internally. OTP dispatch failed. The user needs to correct the input before re-attempting.
## 3. Critical Success Factors for Consent OTP Integration
For your integration with the Consent OTP Workflows to be successful, keep these key points firmly in mind:
- Ensure Accurate Patient Identification: The patient_id must be accurate and valid. This allows the system to correctly retrieve all necessary patient and contact details for OTP dispatch by SHA.
- Implement OTP Input Interface: Design your user interface to prompt the patient for the OTP and make it easy to enter. Include options for re-sending OTPs if the initial one expires or isn't received, while respecting any rate limits.
- Design for Comprehensive Error Handling: Be prepared to handle all documented failure scenarios from both the Send and Verify OTP workflows (e.g., invalid input, expired OTPs, network issues). Clear, user-friendly error messages should guide staff and patients on corrective actions.
Last modified on September 28, 2026
