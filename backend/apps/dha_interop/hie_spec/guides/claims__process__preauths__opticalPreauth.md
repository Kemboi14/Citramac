# Preauths Process Guide: Optical Preauth Workflow
## 1. Overview: Authorising Optical Interventions and Items
This guide details the Optical Preauth Workflow, a specialised preauth form which is part of the broader Preauths Process. This workflow is specifically designed to facilitate the submission of pre-authorisation requests for Optical interventions (such as eye examinations, corrective lenses, frames, and other optical aids) that require prior approval from the Social Health Authority (SHA) for payment.
An optical preauth can be elective or not, but as a preauthorization it is always based on seeking prior approval before the service is rendered. This workflow ensures that patients needing optical services receive necessary prior approval, providing financial assurance and enabling the appropriate and compliant utilisation of these services.
## 2. Workflow Details: Submitting an Optical Preauth
This section details the step-by-step process for submitting an optical pre-authorisation request.
### 2.1. Step-by-Step System Behavior
Input Reception:
The system receives the consent_token for the patient's active visit, the intervention_code for the optical procedure, clinical_indications, new_or_replacement, lens_prescription, eye_examination_amount, frame_amount, lens_amount, necessity_of_service, arrays of doctors, items, diagnoses, and attachments.
Authorization and Visit Context Check:
The system uses the provided consent_token to validate that the patient has a valid, active visit and that consent is still active. This also includes confirming the patient is in an active state.
Optical Preauth Request Validation:
The system performs comprehensive and specific checks on the incoming data and the context of the request, as per SHA's rules for optical procedures (which fall under Elective Preauths). Therefore, elective preauth validations are considered. However, Optical Specific Mandatory Fields are checked, such as clinical_indications and necessity_of_service.
Submit Optical Preauth Request to SHA:
If all validations pass, the system compiles the complete optical pre-authorisation request payload and submits it to SHA's preauth service.
Receive SHA Response:
The system receives and processes the response from SHA, which indicates the submission status (e.g., success, failure, pending review).
### 2.2. Key Validations
These are the critical checks performed during this workflow to ensure the accurate and compliant submission of a surgical pre-authorisation request. Optical preauths align with the validation rules for elective procedures, hence the validations remain the same.
### 2.3. Workflow Data Dictionary
This table outlines the key information used and produced by this workflow for an Optical preauth.
 | Field Name | Info | Options (if applicable) | Is required? | Type
 | consent_token | The consent token for the patient visit. |  | True | string
 | intervention_code | This should be the unique identifier for the intervention we want to do a preauth request for. You should only select the intervention that needs_a_preauth. You can know this from the previous intervention coverage response. |  | True | string
 | clinical_indications | The clinical indications. |  | True | string
 | new_or_replacement | Confirms if this is a new request or a replacement request | New, Replacement | False | string
 | lens_prescription |  | Framed, Contact | False | string
 | eye_examination_amount |  |  | False | string
 | frame_amount |  |  | False | string
 | lens_amount |  |  | False | string
 | necessity_of_service | Brief Description of necessity for service. |  | True | string
 | doctors | The Attending Doctors/Clinical Officers' consent. This is an array of the doctors you need approval from. |  | True | array
 | items | This will be an array of items in the preauth request. |  | True | array
 | diagnoses | This will be an array of diagnoses in the preauth request. |  | True | array
 | attachments | This will be an array of attachments in the request. |  | False | array
 | status | The outcome of the preauth submission (e.g., "Success", "Failed"). |  | Output | Indicates whether the optical preauth request was successfully submitted to SHA.
 | message | A descriptive message about the outcome, including any error details. |  | Output | Provides detailed feedback, especially in case of failure, to aid in troubleshooting.
 | preauth_id | A unique identifier for the submitted preauthorization request (if successful). |  | Output | A reference ID for tracking the optical preauthorization request within SHA's system.
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
This component represents the diagnostic information associated with a pre-authorisation request.
 | Field Name | Info | Options (if applicable) | Is required? | Type
 | icd_code | The ICD-11 code. |  | True | string
2.3.4. Preauth Attachments
This component represents the supporting documents or files that are attached to a pre-authorisation request.
Attachments are uploaded as binary multipart parts (not base64); each entry's file_field_name names the binary part it links to. See Adding Attachments for the full mechanics.
 | Field Name | Info | Options (if applicable) | Is required? | Type
 | file_field_name | Names the multipart part that carries this file's binary. Can be any name, as long as it matches the part. |  | True | string
 | document_title | Title of the document. |  | True | string
 | document_type | The document classification. | BIOPSY_RESULT, CASE_NOTES_JUSTIFYING_ADMISSION, CASE_NOTES_INDICATING_NEED_FOR_DEVICE, CASE_SUMMARY, CLINICAL_DOCUMENTATION, CRITICAL_CARE_UNIT_CASE_NOTES, CONSULTANT_REPORT, DIAGNOSTIC_REQUESTS, DIALYSIS_CHART, DISCHARGE_SUMMARY, FINAL_BILL, INTERIM_BILL, HISTOPATHOLOGY_RESULTS, IMAGING_ORDER, IMAGING_RESULT, KMPDC_FORM, LOU, LAB_ORDER, LAB_RESULTS, LAB_TESTS, MEDICAL_REPORT, PRESCRIPTION, PRIOR_BASIC_DIAGNOSTIC_IMAGES, PROFORMA_INVOICE, RADIOLOGICAL_EXAM, RADIOLOGY_REQUEST, REFERRAL_LETTER, RHESUS_FACTOR, SHA_REFERRAL_FOR_OVERSEAS_TREATMENT_FORM, STAGING_RESULTS, TREATMENT_PLAN, THEATRE_LIST, ULTRASOUND, PREAUTH_FORM, OTHER | True | string
 | file_blob | The binary file part. Uploaded as raw binary multipart (not base64). |  | True | file
Last modified on September 28, 2026
