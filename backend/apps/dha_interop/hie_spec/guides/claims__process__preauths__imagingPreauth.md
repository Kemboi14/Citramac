# Preauths Process Guide: Imaging Preauth Workflow
## 1. Overview: Authorising Specialised Diagnostic Imaging Services
This guide details the Imaging Preauth Workflow, a specialised preauth form which is part of the broader Preauths Process. This workflow is specifically designed to facilitate the submission of pre-authorisation requests for Imaging interventions (such as MRI, CT scans, advanced X-rays, and ultrasounds) that require prior approval from the Social Health Authority (SHA) for payment.
Every imaging intervention is elective. The approval is obtained before the visit, so the patient's visit is then created against an approval that already exists - see Elective Preauthorizations for the pre-visit consent and visit-day steps.
Even so, branch your logic on the needsManualPreauthApproval flag from Intervention Coverage rather than on the intervention being an SHA-09 code. The flag is live data and this page is not: if SHA reclassifies an intervention, code that reads the flag keeps working.
Because the approval comes first, it can sit unused - and an approved imaging preauth expires 7 days after approval if no visit has been created against it. Cancel one you will not use rather than letting it lapse: see Approved preauths expire in 7 days and Cancel Preauthorization.
## 2. Workflow Details: Submitting an Imaging Preauth
This section details the step-by-step process for submitting an imaging pre-authorisation request.
### 2.1. Step-by-Step System Behavior
Input Reception:
The system receives the consent_token for the patient's active visit, the intervention_code for the imaging procedure, clinical_indications, and arrays of items, diagnoses, doctors, and attachments.
Authorisation and Visit Context Check:
The system uses the provided consent_token to validate that the patient has a valid, active visit and that consent is still active. This also includes confirming the patient is in an active state.
Imaging Preauth Request Validation:
The system performs comprehensive and specific checks on the incoming data and the context of the request, as per SHA's rules for imaging procedures and general elective preauthorization rules. Therefore, elective preauth validations are considered. However, Imaging Specific Mandatory Field checks are done for the presence and validity of the clinical_indications field.
Submit Imaging Preauth Request to SHA:
If all validations pass, the system compiles the complete imaging pre-authorisation request payload and submits it to SHA's preauth service.
Receive SHA Response:
The system receives and processes the response from SHA, which indicates the submission status (e.g., success, failure, pending review).
### 2.2. Key Validations
These are the critical checks performed during this workflow to ensure the accurate and compliant submission of an imaging pre-authorisation request. Imaging preauths align with the validation rules for elective procedures, hence the validations remain the same.
### 2.3. Workflow Data Dictionary
This table outlines the key information used and produced by this workflow for an Imaging preauth.
 | Field Name | Info | Options (if applicable) | Is required? | Type
 | consent_token | The consent token for the patient visit. |  | True | string
 | intervention_code | This should be the unique identifier for the intervention we want to do a preauth request for. Only select an intervention whose needsPreauth flag is true on the intervention coverage response. |  | True | string
 | clinical_indications | The clinical indications. |  | True | string
 | doctors | The Attending Doctors/Clinical Officers' consent. This is an array of the doctors you need approval from. |  | True | array
 | items | This will be an array of items in the preauth request. |  | True | array
 | diagnoses | This will be an array of diagnoses in the preauth request. |  | True | array
 | attachments | This will be an array of attachments in the request. |  | False | array
Some items in the general workflow dictionary have their own specific workflow dictionaries. Below is the list that applies to this particular preauthorization.
2.3.1. Preauth Doctor
This component represents the details of a doctor or clinical officer whose consent is required for a pre-authorisation.
 | Field Name | Info | Options (if applicable) | Is required? | Type
 | identification_number | The unique ID for the doctor. |  | True | string
 | identification_type | The type of ID being used. | registration_number, National ID, Alien ID, Refugee ID | True | string
 | regulation_body | The licensing body. Defaults to KMPDC. | KMPDC, COC, NCK, PPB | True | string
 | is_primary | Whether this is the primary doctor for the preauth. |  | False | boolean
2.3.2. Preauth Items
This component represents the individual billable items or sub-services included within a pre-authorisation request.
 | Field Name | Info | Options (if applicable) | Is required? | Type
 | name | The item or service name. |  | False | string
 | unit_price | The unit price charged for this item. |  | True | float (up-to 2dp)
 | quantity | The quantity of the item. |  | False | float (up-to 2dp)
 | charge_date | The charge date for the item. Defaults to today. |  | False | ISO 8601 timestamp
2.3.3. Preauth Diagnosis
This component represents the diagnostic information associated with a pre-authorization request.
 | Field Name | Info | Options (if applicable) | Is required? | Type
 | icd_code | The ICD-11 code. |  | True | string
2.3.4. Preauth Attachments
This component represents the supporting documents or files that are attached to a pre-authorisation request.
Attachments are uploaded as binary multipart parts (not base64); each entry's file_field_name names the binary part it links to. See Adding Attachments for the full mechanics.
Which documents this preauth must carry comes from the intervention, not from the list below. Read requiredPreauthDocumentTypes on Intervention Coverage for the study you are requesting; the document_type values below are the full set of allowed classifications to choose from.
 | Field Name | Info | Options (if applicable) | Is required? | Type
 | file_field_name | Names the multipart part that carries this file's binary. Can be any name, as long as it matches the part. |  | True | string
 | document_title | Title of the document. |  | True | string
 | document_type | The document classification. | BIOPSY_RESULT, CASE_NOTES_JUSTIFYING_ADMISSION, CASE_NOTES_INDICATING_NEED_FOR_DEVICE, CASE_SUMMARY, CLINICAL_DOCUMENTATION, CRITICAL_CARE_UNIT_CASE_NOTES, CONSULTANT_REPORT, DIAGNOSTIC_REQUESTS, DIALYSIS_CHART, DISCHARGE_SUMMARY, FINAL_BILL, INTERIM_BILL, HISTOPATHOLOGY_RESULTS, IMAGING_ORDER, IMAGING_RESULT, KMPDC_FORM, LOU, LAB_ORDER, LAB_RESULTS, LAB_TESTS, MEDICAL_REPORT, PRESCRIPTION, PRIOR_BASIC_DIAGNOSTIC_IMAGES, PROFORMA_INVOICE, RADIOLOGICAL_EXAM, RADIOLOGY_REQUEST, REFERRAL_LETTER, RHESUS_FACTOR, SHA_REFERRAL_FOR_OVERSEAS_TREATMENT_FORM, STAGING_RESULTS, TREATMENT_PLAN, THEATRE_LIST, ULTRASOUND, PREAUTH_FORM, OTHER | True | string
 | file_blob | The binary file part. Uploaded as raw binary multipart (not base64). |  | True | file
## Related resources
- Medical Imaging Rules - the full rule set for SHA-09.
- Approved preauths expire in 7 days - the expiry clock and what to do instead of letting it lapse.
- Who may request imaging - the POMSF credentialed-specialist requirement.
- Elective Preauthorizations - the pre-visit consent and visit-day flow.
- Cancel Preauthorization - releasing an approval that will not be used.
- Intervention Coverage - preauth flags and required document types.
- Adding Attachments - reading required documents off the intervention.
- Special Benefit Rules - all six rule sets.
Last modified on September 28, 2026
