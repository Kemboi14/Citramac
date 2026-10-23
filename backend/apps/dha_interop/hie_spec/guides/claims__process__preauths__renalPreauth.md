# Preauths Process Guide: Renal Preauth Workflow
## 1. Overview: Authorising Renal Treatments and Dialysis Sessions
This guide details the Renal Preauth Workflow, a specialised preauth form which is part of the broader Preauths Process. This workflow is specifically designed to facilitate the submission of pre-authorisation requests for renal interventions, which often involve a series of sessions, such as dialysis, that require prior approval from the Social Health Authority (SHA) for payment.
A renal preauth covers renal treatments that, given their nature, often involve multiple sessions such as dialysis. At its core, this workflow ensures that patients requiring ongoing renal treatments receive necessary prior approval, providing financial assurance and enabling continuous, compliant care.
## 2. Workflow Details: Submitting a Renal Preauth
This section details the step-by-step process for submitting a renal pre-authorisation request.
### 2.1. Step-by-Step System Behavior
Input Reception:
The system receives the consent_token for the patient's active visit, the intervention_code for the renal procedure, start_date, number_of_sessions_required, frequency_of_sessions, clinical_indications, is_co_insured, and arrays of items, diagnoses, doctors, and attachments. The preauth_type will be "Renal Preauthorization".
Authorisation and Visit Context Check:
The system uses the provided consent_token to validate that the patient has a valid, active visit and that consent is still active. This also includes confirming the patient is in an active state.
Renal Preauth Request Validation:
The system performs comprehensive and specific checks on the incoming data and the context of the request, as per SHA's rules for renal procedures.
Submit Renal Preauth Request to SHA:
If all validations pass, the system compiles the complete renal pre-authorisation request payload and submits it to SHA's preauth service.
Receive SHA Response:
The system receives and processes the response from SHA, which indicates the submission status (e.g., success, failure, pending review).
### 2.2. Key Validations
These are the critical checks performed during this workflow to ensure the accurate and compliant submission of a renal pre-authorisation request.
### 2.3. Workflow Data Dictionary
This table outlines the key information used and produced by this workflow:
 | Field Name | Description | Required (Input) | Type | Options (if applicable)
 | consent_token | The consent token for the patient visit. | Yes | string | 
 | intervention_code | The unique identifier for the renal intervention you want to do a preauth request. You should only select the intervention that needs_a_preauth. You can know this from the previous intervention coverage response. | Yes | string | 
 | start_date | Expected Date of 1st Session. | Yes | An ISO 8601 timestamp of the date for the | 
 | number_of_sessions_required | Number of Sessions Required. | Yes | integer | 
 | frequency_of_sessions | Frequency of sessions. | True | string | Twice a week, Once a week, One time every 2 weeks, One time every 3 weeks, One a month
 | clinical_indications | The clinical indications. | True | string | End-Stage renal disease, Acute kidney failure, Other
 | is_co_insured | Is the patient co-insured? | False | boolean | 
 | doctors | The Attending Doctors/Clinical Officers consent. This is an array of the doctors you need approval from. | Yes | array | 
 | items | This will be an array of items in the preauth request. | Yes | array | 
 | diagnoses | This will be an array of diagnoses in the preauth request. | Yes | array | 
 | attachments | This will be an array of attachments in the request. | False | array | 
Some items in the general workflow dictionary have their specific workflow dictionaries. Below is the list that applies to this particular preauthorization.
2.3.1. Preauth Doctor
This defines the structure for doctors associated with a preauth request.
 | Field Name | Info | Options (if applicable) | Is required? | Type
 | identification_number | The unique ID for the doctor. |  | True | string
 | identification_type | The type of ID being used. | registration_number, National ID, Alien ID, Refugee ID | True | string
 | regulation_body | The licensing body. Defaults to KMPDC. | KMPDC, COC, NCK, PPB | True | string
 | is_primary | Whether this is the primary doctor for the preauth. |  | False | boolean
2.3.2. Preauth Items
This defines the structure for individual items included in a preauth request.
 | Field Name | Info | Options (if applicable) | Is required? | Type
 | name | The item or service name. |  | False | string
 | unit_price | The unit price charged for this item. |  | True | float (up-to 2dp)
 | quantity | The quantity of the item. |  | False | float (up-to 2dp)
 | charge_date | The charge date for the item. Defaults to today. |  | False | ISO 8601 timestamp
2.3.3. Preauth Diagnosis
This defines the structure for diagnoses associated with a preauth request.
 | Field Name | Info | Options (if applicable) | Is required? | Type
 | icd_code | The ICD-11 code. |  | True | string
2.3.4. Preauth Attachments
This defines the structure for attachments included in a preauth request.
Attachments are uploaded as binary multipart parts (not base64); each entry's file_field_name names the binary part it links to. See Adding Attachments for the full mechanics.
 | Field Name | Info | Options (if applicable) | Is required? | Type
 | file_field_name | Names the multipart part that carries this file's binary. Can be any name, as long as it matches the part. |  | True | string
 | document_title | Title of the document. |  | True | string
 | document_type | The document classification. | BIOPSY_RESULT, CASE_NOTES_JUSTIFYING_ADMISSION, CASE_NOTES_INDICATING_NEED_FOR_DEVICE, CASE_SUMMARY, CLINICAL_DOCUMENTATION, CRITICAL_CARE_UNIT_CASE_NOTES, CONSULTANT_REPORT, DIAGNOSTIC_REQUESTS, DIALYSIS_CHART, DISCHARGE_SUMMARY, FINAL_BILL, INTERIM_BILL, HISTOPATHOLOGY_RESULTS, IMAGING_ORDER, IMAGING_RESULT, KMPDC_FORM, LOU, LAB_ORDER, LAB_RESULTS, LAB_TESTS, MEDICAL_REPORT, PRESCRIPTION, PRIOR_BASIC_DIAGNOSTIC_IMAGES, PROFORMA_INVOICE, RADIOLOGICAL_EXAM, RADIOLOGY_REQUEST, REFERRAL_LETTER, RHESUS_FACTOR, SHA_REFERRAL_FOR_OVERSEAS_TREATMENT_FORM, STAGING_RESULTS, TREATMENT_PLAN, THEATRE_LIST, ULTRASOUND, PREAUTH_FORM, OTHER | True | string
 | file_blob | The binary file part. Uploaded as raw binary multipart (not base64). |  | True | file
Last modified on September 28, 2026
