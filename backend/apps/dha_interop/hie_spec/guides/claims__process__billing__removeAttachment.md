# Billing Workflows Process Guide: Remove Attachment Workflow
## 1. Overview: Deleting Supporting Documents from a Claim
This guide focuses on the Remove Attachment workflow, which provides the mechanism for correcting or retracting a previously uploaded supporting document from a patient's claim. This workflow's key role is to accurately delete an existing attachment from a specific intervention within a claim.
### 1.1. What This Workflow Does
The Remove Attachment workflow's primary function is to remove an existing attachment, identified by its unique ID, from a specified intervention that is already part of a patient's claim. It does this by taking the patient's visit context, the attachment's unique identifier, and the associated intervention code, ensuring that the correct document-intervention pair is targeted for removal.
### 1.2. Why This Workflow Is Critical (The "Why It Matters")
The ability to accurately remove attachments is crucial for maintaining the integrity and accuracy of a patient's claim documentation. Without a precise and compliant attachment removal process, several serious issues can arise:
- Misleading Claim Information: Erroneous or outdated documents remaining on a claim can provide misleading information to payers and auditors.
- Security Risks: Unnecessary documents, especially those containing sensitive information, should not be retained on a claim if they are no longer relevant.
- Audit Complications: The presence of extraneous or incorrect documents can complicate the auditing process and introduce confusion.
- Data Bloat: Storing unnecessary attachments increases data storage requirements and can slow down claim retrieval.
This workflow is important for maintaining clean and accurate claim documentation. It ensures that the claim file contains only the necessary and correct evidence, supporting the overall integrity of the Billing Workflows Process.
## 2. Workflow Details: Remove Attachment
### 2.1. Workflow Description: Step-by-Step System Behavior
When a request to remove an attachment from a claim intervention is made, here's the internal process that unfolds:
- Input Reception: The system first receives the consent_token for the active patient visit, the attachment_id of the document to be removed, and the intervention_code from which the attachment should be detached.
- Visit and Consent Validation: The system immediately validates the provided consent_token to confirm that the patient's visit is still active/open and that the consent is valid.
- Attachment-Intervention Linkage Validation: The system checks if the specified attachment_id is currently linked to the provided intervention_code on the patient's claim.
- Attachment Detachment and Deletion: If the linkage is confirmed and all validations pass, the system proceeds to detach the specified attachment_id from the intervention_code and deletes the attachment file from storage.
### 2.2. Key Validations: Our System's Essential Checks
Active Visit/Consent Validation:
The consent_token must correspond to an open and active patient visit.
Attachment-Intervention Linkage Existence:
The system confirms that the attachment_id is currently linked to the given intervention_code in the patient’s claim.
### 2.3. Workflow Data Dictionary (Conceptual): What Information We Work With
 | Field Name | Description | Data Type | Required | Purpose
 | consent_token | The consent token for the patient visit. | string | Yes | Authorises the attachment removal action for the correct patient/visit.
 | attachment_id | The system-generated UUID of the attachment. | string (uuid4) | Yes | Identifies the exact file to be removed.
 | intervention_code | The intervention to remove this attachment from. | string | Yes | Identifies the service or procedure associated with the attachment.
### 2.4. Expected Outcomes from this Workflow
- Success: Attachment Removed from Intervention – The system detaches the attachment and deletes the file, passing all validations.
- Failure: Invalid Visit/Consent – The consent_token is invalid, expired, or refers to a closed visit.
- Failure: Attachment-Intervention Linkage Not Found – The provided attachment_id is not linked to the specified intervention_code.
- Failure: Missing Required Data – One or more of the required fields (consent_token, attachment_id, intervention_code) is missing or malformed.
Last modified on September 28, 2026
