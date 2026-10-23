# Consent Services Process Guide: Create OTP Whitelisting Workflow
## 1. Overview: Enabling the Use of OTP in Specific Scenarios
This guide details the OTP Whitelisting workflow, which is a crucial stage in our broader Consent Services Process. It serves as an alternative method to ensure that consent is still provided for patients who cannot use biometrics, the default option for consent with specific healthcare providers. The primary role of this workflow is to ensure that One-Time Passwords (OTPs) are only utilized in approved scenarios, thereby enhancing security and compliance.
To use OTP as a consent method, a patient must first be whitelisted through this workflow. This process assists in validating and approving specific situations for OTP usage before proceeding to the Send OTP Workflow.
### 1.1. What This Workflow Does
The principal function of the OTP Whitelisting workflow is to validate and approve specific use cases for OTP usage. It does this by assessing the context and reasons for each OTP request against a predefined set of criteria.
### 1.2. Why This Workflow Is Critical (The "Why It Matters")
Getting OTP usage right from the beginning is vital for maintaining security and compliance. Without a precise whitelisting process, several serious issues can arise:
- Unauthorized Access: Using OTPs in unapproved scenarios may lead to unauthorized access to sensitive patient information.
- Compliance Risks: Failing to adhere to consent requirements can result in non-compliance with healthcare regulations.
- Fraud Risks: Misuse of OTPs may open avenues for fraudulent activities, compromising the security of patient data.
In summary, this workflow is the foundation of secure OTP usage. It ensures that every subsequent step of the Consent Services Process is built on the principle of approved and validated OTP scenarios.
## 2. Workflow Details: OTP Whitelisting
### 2.1. Workflow Description: Step-by-Step System Behavior
When a request for OTP Whitelisting is made (after failed attempts to use biometrics), here's how the internal process unfolds:
- Failed Biometric Attempts: The system receives the patient's request for OTP usage after unsuccessful biometric consent attempts. Biometrics are enforced for all hospital levels, except for levels 2 and 3.
- Make an OTP Whitelist Request: The user submits a request to whitelist the patient for OTP usage by providing necessary details such as the reason for using OTP and patient identifiers.
- Confirm if the Patient is Already Whitelisted: The system checks if the patient is already whitelisted for OTP usage. If they are, the system informs the provider that the patient is already permitted to use OTPs.
- Create OTP Whitelist Request: If the patient is not already whitelisted, the system creates a new OTP Whitelist Request with the provided details, such as beneficiary CR ID, reason for whitelisting, any attachments, and the number of failed biometric attempts.
- Submit OTP Whitelist Request: The system submits the OTP Whitelist Request to authorized personnel for approval, triggering any necessary workflows or notifications.
- Review of the OTP Whitelist Request: Social Health Authority officers log into an admin panel to review the OTP Whitelist Request, ensuring all information is accurate and complete. They assess the validity of the reason provided for OTP usage and all attachments before making a decision.
- Receive Approval Decision: The system waits for a decision on the OTP Whitelist Request. This may involve manual review by authorized personnel or an automated review. If approved, the system updates the patient's status to allow OTP usage. If denied, the system notifies the requester with the reasons for denial.
### 2.2. Key Validations: Essential Checks by Our System
Several essential checks are performed by our system to ensure successful and accurate OTP Whitelisting. Understanding these checks helps you provide the correct information, preventing errors.
- Valid Beneficiary CR ID:
- What it Means: The system verifies that the provided beneficiary CR ID is valid and exists in the Client Registry.
- Why It's Important: This ensures that the OTP Whitelisting request is associated with a legitimate patient record, preventing unauthorized access.
- Failed Biometric Attempts:
- What it Means: The system requires evidence of failed biometric attempts and checks the number recorded for the patient.
- Why It's Important: This helps establish a pattern of failed attempts, justifying the need for OTP Whitelisting as an alternative consent method.
- Patient OTP Whitelist Status:
- What it Means: The system checks if the patient is already whitelisted for OTP usage. If the patient is already whitelisted, no new request can be made.
- Why It's Important: This prevents redundant requests and ensures the workflow remains efficient.
- Pending OTP whitelist requests:
- What it means: The system checks if there are any pending OTP whitelist requests for the patient. If there are pending requests, new requests cannot be made until the existing ones are resolved.
- Why it's important: This helps to avoid processing new requests while existing ones are still under review.
### 2.3. Workflow Data Dictionary: Key Information Utilized
This table outlines the essential pieces of information involved in this workflow, indicating which fields are required and the expected data format.
 | Field Name (Conceptual) | Description | Data Type (Conceptual) | Required | Purpose / Significance to the Business
 | reason_type | Specifies the reason for requesting the whitelist. Allowed values include: OLD, AMPUTEE, MEDICAL_CONDITION, MENTALLY_UNSTABLE, ONCOLOGY_TREATMENT, DIALYSIS_TREATMENT, CONSTRUCTION_WORKER, OTHER, EXPIRED, BIOMETRIC_FAILURE, CHILD_BELOW_7_YEARS, PRIVACY_CONCERNS, TECHNICAL_ISSUES. | String | Yes | Identifies the main reason for the OTP whitelisting request, serving to categorize and justify the request for evaluation and compliance purposes.
 | reason | A detailed explanation for the whitelist request. | String | Yes | Offers additional context to support the selected reason_type for the whitelisting request.
 | biometric_attempts | The number of unsuccessful attempts using biometrics. | Integer | Yes | Indicates the number of failed biometric attempts, validating the necessity for OTP as an alternative method.
 | beneficiary_cr_id | A unique identifier for the beneficiary within the coverage system. | String | Yes | Connects the OTP whitelist request to a specific patient in the Client Registry.
 | attachments | A list of metadata for attachments. Each attachment description includes the title, document type, and the related file field for upload. | Array of Objects | Yes | Supplies supporting documents for the whitelist request, such as medical reports or other evidence.
 | file_field_name | The actual file to be uploaded as part of the whitelist request. Rename this field to match the file_field_name specified in the attachments array (e.g., attachments_file_blob). | String (binary) | No | Enables the upload of the actual file(s) referenced in the attachments metadata.
### 2.4. Expected Outcomes from the Workflow
When querying this workflow, you can anticipate the following outcomes:
- Success: OTP whitelist request successfully created for the patient.
- Failure: Pending OTP Whitelist request detected, preventing the creation of a new OTP request.
- Failure: The patient is already whitelisted for OTP, hence no new OTP whitelist request will be created.
## Approval and Rejection Logic
### Automatic Review
Requests with certain reason_type values are automatically reviewed by a scheduled job (every 10 minutes). Possible statuses: CLOSED, REJECTED, or APPROVED.
Eligible for Automatic Review:
OLD, AMPUTEE, MEDICAL_CONDITION, MENTALLY_UNSTABLE, ONCOLOGY_TREATMENT, DIALYSIS_TREATMENT, CONSTRUCTION_WORKER
Automatic Status Checks:
- CLOSED: Already whitelisted and period is valid.
- APPROVED:
- AMPUTEE with attachments
- OLD, age ≥ 60, and failed biometric attempt in last 24h
- DIALYSIS_TREATMENT, failed biometric attempt in last 24h, previous dialysis intervention
- ONCOLOGY_TREATMENT, failed biometric attempt in last 24h, previous oncology intervention
- MEDICAL_CONDITION or MENTALLY_UNSTABLE, failed biometric attempt in last 24h, with attachments
- REJECTED:
- AMPUTEE without attachments
- OLD and age < 60
- DIALYSIS without previous dialysis intervention
- ONCOLOGY without previous oncology intervention
- MEDICAL_CONDITION or MENTALLY_UNSTABLE without attachments
### Manual Review
Requests with these types require manual review:
OTHER, EXPIRED, BIOMETRIC_FAILURE, CHILD_BELOW_7_YEARS, PRIVACY_CONCERNS, TECHNICAL_ISSUES.
## 3. Critical Success Factors for OTP Whitelist Workflow Integration
To ensure successful integration with the OTP Whitelist workflow, consider the following key points:
- Provide the correct beneficiary CR ID: Accurate submission of the beneficiary_cr_id is crucial for retrieving precise patient details, including their OTP whitelist status.
- Set up a callback URL: Implement a callback URL to receive notifications regarding the status of the OTP whitelist request.
- Provide a valid reason type: Familiarize yourself with the available reason types in the system (e.g., OLD, AMPUTEE, MEDICAL_CONDITION) to ensure correctness.
- Plan for potential failure scenarios: Implement error handling for conditions like patient not being found, existing pending requests, or technical issues.
Last modified on September 28, 2026
