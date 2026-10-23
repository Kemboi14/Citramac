# Emergency Case Claims Process Guide: Add Emergency Case Protocols Workflow
## 1. Overview: Billing the Protocols Performed
This guide focuses on the Add Emergency Case Protocols workflow. At this point you have created the emergency case claim with its intervention(s) and seen the available protocols. Now it is time to add the protocols actually performed to the claim. This workflow turns the care delivered into reimbursable value under ECCIF.
### 1.1. What This Workflow Does
The Add Emergency Case Protocols workflow adds protocol lines to the emergency claim via POST /api/v1/claims/emergency/protocols. It supports two modes:
- Protocol only: add just the protocol as a billable line - protocol_code, intervention_code, unit_price, and quantity against the claim's consent_token.
- Combined protocol details: add the protocol together with its billing detail - the same fields plus diagnoses, attachments, and amounts, submitted as multipart/form-data so the supporting files can be uploaded with the request.
### 1.2. Why This Workflow Is Critical (The "Why It Matters")
Adding protocols correctly is what makes the emergency claim payable:
- Accurate Reimbursement: The protocols and amounts you add determine what the facility will be reimbursed under ECCIF.
- Approved Amounts Only: Each protocol has an approved tariff; billing within it is what gets the line accepted.
- Complete Documentation: Combined details (diagnoses and attachments) provide the clinical justification SHA needs for the protocol.
### 1.3. Attachments Are at the Intervention Level
### Attachments use the intervention's applicableDocumentTypes
Attachments are required at the intervention level, not the protocol level. Each attachment's document_type must be one of the values declared in the intervention's applicableDocumentTypes (the same list returned by Get Emergency Case Protocols). Using a document type outside that list will be rejected.
## 2. Workflow Details: Add Emergency Case Protocols
### 2.1. Workflow Description: Step-by-Step System Behavior
When a request to add a protocol comes into the system, here is what unfolds:
- Input Reception: The system receives the claim's consent_token, the protocol_code, the intervention_code, the unit_price, and the quantity. For combined details it also receives diagnoses, attachments metadata, and the attached file part(s).
- Claim and Protocol Validation: The system confirms the consent_token belongs to an active emergency claim and that the protocol_code is approved for the intervention_code.
- Amount Validation: The system checks the unit_price against the protocol's approved tariff.
- Attachment Validation (combined mode): Each attachment's document_type is checked against the intervention's applicableDocumentTypes, and each file_field_name must map to a binary part in the request.
- Line Addition: If all validations pass, the protocol is added as a billable line on the claim.
### 2.2. Key Validations: Our System's Essential Checks
- Active Claim Token:
- What it means: The consent_token must belong to an open emergency claim.
- Why it's important: Protocols can only be added to an active emergency case.
- Protocol Approved for Intervention:
- What it means: The protocol_code must be in the approved protocol list for the intervention_code.
- Why it's important: Only approved protocols are reimbursable.
- Amount Within Tariff:
- What it means: The unit_price must not exceed the protocol's approved amount.
- Why it's important: Lines above the approved tariff are rejected.
- Valid Attachment Document Types (combined mode):
- What it means: Each document_type must be one of the intervention's applicableDocumentTypes.
- Why it's important: Ensures supporting documents are of an accepted kind for the intervention.
### 2.3. Workflow Data Dictionary: What Information We Work With
 | Field Name | Description | Data Type | Required | Purpose
 | consent_token | The token returned when the emergency claim was created. | string | Yes | Authorises the action against the correct emergency claim.
 | protocol_code | The code of the protocol being billed. | string | Yes | Identifies the approved protocol performed.
 | intervention_code | The intervention the protocol belongs to. | string | Yes | Links the protocol to its emergency intervention.
 | unit_price | The amount charged per unit for the protocol. | number | Yes | The billed value, validated against the approved tariff.
 | quantity | The number of units performed. | integer | Yes | Multiplies the unit price for the line total.
 | diagnoses | A JSON-encoded array of ICD-11 diagnosis codes (combined mode). | string (JSON array) | Combined only | Provides clinical justification for the protocol.
 | attachments | A JSON-encoded array of attachment metadata objects (combined mode). | string (JSON array) | Combined only | Describes the supporting files being uploaded.
 | attachments[].document_title | A title for the attached document. | string | Combined only | Human-readable label for the document.
 | attachments[].document_type | The document type - must be one of the intervention's applicableDocumentTypes. | string | Combined only | Classifies the document for SHA review.
 | attachments[].file_field_name | The name of the multipart form part carrying the binary file. | string | Combined only | Maps the metadata entry to its uploaded file.
### 2.4. Expected Outcomes from this Workflow
- Success: The protocol is added as a billable line on the emergency claim.
- Failure: Invalid claim token - the consent_token is invalid or the claim is closed.
- Failure: Protocol not approved - the protocol_code is not approved for the intervention_code.
- Failure: Amount exceeds tariff - the unit_price is above the protocol's approved amount.
- Failure: Invalid attachment type - a document_type is outside the intervention's applicableDocumentTypes, or a file_field_name has no matching binary part.
## 3. Critical Success Factors for Add Emergency Case Protocols Integration
- Bill Approved Protocols Within Tariff: Use the protocol codes and approved amounts from the protocol lookup.
- Attach at the Intervention Level: Use only document types listed in the intervention's applicableDocumentTypes.
- Match Metadata to Files: In combined mode, ensure every file_field_name maps to an uploaded binary part.
- Re-use the consent_token: Add all protocols against the same token returned at claim creation.
## 4. Related Resources
- Emergency Case Claims Process Overview
- Get Emergency Case Protocols
- Add a Doctor to an Emergency Case Claim
- Submit an Emergency Case Claim
- Claims & Preauths API Reference
Last modified on September 28, 2026
