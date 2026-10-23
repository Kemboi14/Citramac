# Billing Workflows Process Guide: Add Combined Billing Details Workflow
## 1. Overview: Adding a Line with its Diagnoses and Attachments in One Request
This guide focuses on the Add Combined Billing Details workflow, a convenience variant of the Add new line workflow within the broader Billing Workflows Process. Instead of adding a billable line and then separately attaching its diagnoses and supporting documents, this workflow lets you submit all three together in a single multipart/form-data request.
### 1.1. What This Workflow Does
The Add Combined Billing Details workflow appends a new billable line to a patient's claim and, in the same request, associates its diagnoses and uploads its supporting attachments. It receives the same details as a standard add line call, plus a diagnoses array and an attachments array, then applies the same validations before recording everything against the claim.
### 1.2. Why This Workflow Is Critical (The "Why It Matters")
Bundling the line, its diagnoses and its attachments into one call keeps related billing data together and reduces round trips. This matters in the following ways:
- Fewer round trips: The line, its medical justification, and its supporting documents are recorded in one atomic request rather than several separate calls.
- Data consistency: Diagnoses and attachments are captured alongside the line they belong to, reducing the chance of orphaned or mismatched data.
- Claim Acceptance: Complete, well-justified lines with their supporting documents are more likely to be accepted by the payer.
- Audit compliance: Having the line, diagnoses and documents recorded together provides clear, auditable billing records.
### Optional doctor details can be attached here
You may supply the three optional practitioner fields (practitioner_identification_type,
practitioner_identification_number, practitioner_regulation_body) on this call. A standard claim
requires only one doctor, and it can be attached through any one of add line, add diagnosis, or
start visit - not all three. See Adding a Claim Doctor.
## 2. Workflow Details: Add Combined Billing Details
### 2.1. Workflow Description: Step-by-Step System Behavior
When a combined billing request comes into our system, here's the internal process that unfolds:
- Input Reception: The system receives a multipart/form-data request carrying the consent_token, the line fields (intervention_code, unit_price, quantity, optional service_name, service_identifier and the optional practitioner fields), a diagnoses array (each entry an icd_code), and an attachments array of metadata objects, each naming a matching binary part via file_field_name.
- Visit and Consent Validation: The system validates the provided consent_token to confirm that the patient's visit is still active/open and that the consent is valid.
- Financial Validation: The system calculates the total bill amount for the line and checks it against the applicable tariff (and, for POMSF-covered patients, the available PMF balance + ex gratia).
- Diagnosis Association: Each icd_code in the diagnoses array is validated and linked to the intervention on the claim.
- Attachment Upload: For each entry in the attachments array, the system reads the binary part named by its file_field_name, records the metadata, and links the document to the line.
- Item Addition: If all validations pass, the system records the line, its diagnoses and its attachments against the patient's claim.
### 2.2. Key Validations: Our System's Essential Checks
Active Visit/Consent Validation:
The consent_token must correspond to a patient visit that is currently open and active.
Bill Amount vs. Tariff/Balance Validation:
The financial amount must adhere to the maximum allowed tariff or, for POMSF-covered patients, the available PMF balance + ex gratia. See PMF Tariffs.
Diagnosis Validity:
Each icd_code must be a valid, active ICD-11 code accepted for the intervention.
Attachment Part Matching:
Every file_field_name declared in the attachments array must match the name of a binary multipart part present in the request. Attachments are sent as raw binary parts, not base64. See Adding Attachments.
### 2.3. Workflow Data Dictionary: What Information We Work With
 | Field Name | Description | Data Type | Required | Purpose
 | consent_token | The consent token for the patient visit. | string | Yes | Authorises the billing action for the correct patient and active visit.
 | intervention_code | The code for the intervention you are adding. | string | Yes | Specifies the particular service or item being billed.
 | unit_price | The unit price charged for this item. | float (2dp) | Yes | Defines cost per unit of service/item.
 | quantity | Quantity of the item. | float (2dp) | Yes | Number of units provided.
 | service_name | Human-readable name of the service being billed. | string | No | Descriptive label for the line item.
 | service_identifier | Provider-side identifier for the service. | string | No | Cross-references the line to internal service records.
 | diagnoses | Array of diagnoses, each { icd_code }. | array | No | Links medical justification to the billed intervention.
 | attachments | Array of metadata objects, each { document_title, document_type, file_field_name } with a matching binary part. | array | No | Uploads and links supporting documents to the line.
 | practitioner_identification_type | How the attending practitioner is identified. | string | No | Part of the optional doctor details (one doctor per claim).
 | practitioner_identification_number | The practitioner identifier value. | string | No | Part of the optional doctor details.
 | practitioner_regulation_body | The regulator the practitioner is registered with. | string | No | Part of the optional doctor details.
### Attachments use the metadata-array pattern
In the combined request each attachment's binary part can be named anything, as long as the name
matches the file_field_name in its metadata object. This is Pattern A described in
Adding Attachments.
### 2.4. Expected Outcomes from this Workflow
- Success: Line, Diagnoses and Attachments Recorded - the line is added and its diagnoses and documents are linked, after all validations pass.
- Failure: Invalid Visit/Consent - the consent_token is invalid, expired, or the visit is closed.
- Failure: Financial Limit Exceeded - the unit_price or total bill exceeds the allowed tariff or PMF balance + ex gratia.
- Failure: Invalid Diagnosis - an icd_code in the diagnoses array is invalid, inactive, or not accepted for the intervention.
- Failure: Attachment Part Missing - a file_field_name in the attachments array has no matching binary part in the request.
- Failure: Missing Required Data - any required field (consent_token, intervention_code, unit_price, quantity) is missing or malformed.
## Related Resources
- Add New Line
- Add Diagnosis
- Add Attachment
- Adding Attachments
- Adding a Claim Doctor
- PMF Tariffs
Last modified on September 28, 2026
