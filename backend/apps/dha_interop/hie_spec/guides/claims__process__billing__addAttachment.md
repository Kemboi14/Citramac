# Billing Workflows Process Guide: Add Attachment Workflow
## 1. Overview: Adding Supporting Documents to a Claim
This guide focuses on the Add Attachment workflow, a crucial stage in the broader Billing Workflows Process. It gives the mechanism for providing proof or additional context for a claim's interventions. This workflow's primary role is to accurately upload and link a new supporting document to an existing intervention within a patient's claim.
### 1.1. What This Workflow Does
The Add Attachment workflow's work is to upload a digital document and associate it with a specific intervention that is already part of a patient's claim. It does this by taking the patient's visit context, the file itself (file_blob), and metadata about the document, then performing the required validations to ensure the attachment is correctly linked to a valid intervention.
### 1.2. Why This Workflow Is Critical (The "Why It Matters")
The ability to accurately add attachments is crucial for the substantiation and justification of claims, particularly for complex cases or specific interventions. Without a precise and compliant attachment process, several serious issues can arise:
- Claim Denials: Payers may deny claims if required supporting documentation (e.g., lab results, a prescription, or an invoice) is missing.
- Audit Scrutiny: Lack of documentation makes claims vulnerable to intense scrutiny and potential penalties during audits.
- Medical Record Incompleteness: The patient's record will be incomplete, lacking the full context of their treatment and the justification for interventions.
- Operational Inefficiency: Manual processes for providing supporting documents are cumbersome and prone to error, leading to delays and increased administrative costs.
This workflow is key to strengthening the validity and verifiability of claims. It ensures that all claims are backed by the necessary evidence, supporting the overall integrity of the Billing Workflows Process.
### Attachments are raw binary, and this endpoint uses a fixed file part
Attachments are uploaded as raw binary multipart parts, not base64. This standalone endpoint
(POST /claims/attachments) uses a fixed file part named file_blob - it does not use the
arbitrary file_field_name metadata-array pattern. See
Adding Attachments for the full mechanics and the two upload
patterns.
## 2. Workflow Details: Add Attachment
### 2.1. Workflow Description: Step-by-Step System Behavior
When a request to add an attachment to a claim intervention is made, here's the internal process that unfolds:
- Input Reception: The system first receives the consent_token for the active patient visit, the file_blob of the document, and metadata including the document_type, document_title, document_description, and an optional intervention_code.
- Visit and Consent Validation: The system immediately validates the provided consent_token to confirm that the patient's visit is still active/open and that the consent is valid.
- Intervention Validation: If an intervention_code is provided, the system validates that the attachment is being tied to a specific intervention that is present on the patient's claim.
- Document Upload and Association: If all validations pass, the system securely uploads the file_blob, records the associated metadata, and links the new attachment to the patient's claim. If intervention_code was provided, the attachment is linked directly to that intervention.
- Confirmation: The system confirms the successful addition of the attachment.
### 2.2. Key Validations: Our System's Essential Checks
There are some essential checks our system performs behind the scenes to ensure a successful and accurate "Add Attachment" operation:
Active Visit/Consent Validation:
The consent_token must correspond to a currently open and active visit.
Intervention Existence:
If intervention_code is provided, the system confirms that this intervention exists on the claim.
### 2.3. Workflow Data Dictionary (Conceptual): What Information We Work With
 | Field Name | Description | Data Type | Required | Purpose
 | consent_token | The consent token for the patient visit. | string | Yes | Authorises the attachment action for the correct patient and visit.
 | file_blob | The file blob (binary data of the file). | file | Yes | Actual file content to be uploaded and stored.
 | document_title | Title of the document. | string | No | Human-readable title for identification.
 | document_type | The type of medical document being uploaded. Must be one of the values the intervention publishes in applicableDocumentTypes. | string | Yes | Categorizes the document (e.g., prescription, invoice).
 | document_description | The document description. | string | No | Free-text details or context about the attachment.
 | intervention_code | The intervention code to link the document to. | string | No | Identifies the specific procedure the document supports.
Which documents a claim must carry
Do not hard-code a document list. Every intervention publishes its own documentation requirements, and
this endpoint attaches documents to a claim, so the field to read is applicableDocumentTypes on
Intervention Coverage. optionalDocumentTypes
carries the ones that may accompany the claim but are not required.
A claim carrying several interventions inherits the union of their requirements, and it is the integrator's
responsibility to validate that everything required has been attached before submitting. For preauthorization
documents the equivalent field is requiredPreauthDocumentTypes.
See Adding Attachments for all four fields, the multipart mechanics,
and the regulator's auto-attach requirement.
### 2.4. Expected Outcomes from this Workflow
When you query this workflow, here's what you can expect in return:
- Success: Attachment Added - The system uploads the file, creates an attachment record, and links it to the claim (and intervention if specified).
- Failure: Invalid Visit/Consent - The consent_token is invalid, expired, or refers to a closed visit.
- Failure: Intervention Not Found - An intervention_code was provided but doesn't exist on the claim.
- Failure: Invalid Document Type - The document_type provided is not supported for this claim. Check it against the intervention's applicableDocumentTypes.
- Failure: Missing Required Data - One or more required fields (consent_token, file_blob, document_type) are missing or malformed.
Last modified on September 28, 2026
