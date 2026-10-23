# Preauths Process Guide: Oncology Preauth Workflow
## 1. Overview: Authorising Cancer Diagnosis and Treatment Plans
This guide details the Oncology Preauth Workflow, a specialised preauth form which is part of the broader Preauths Process. This workflow is specifically designed to facilitate the submission of pre-authorisation requests for oncology interventions (i.e., services related to cancer diagnosis and treatment) that require prior approval from the Social Health Authority (SHA) for payment.
An oncology preauth covers cancer diagnosis and treatment, which by its nature often involves multiple sessions of care. This workflow ensures that patients undergoing cancer treatments receive necessary prior approval, providing crucial financial assurance and enabling continuous, compliant care.
## 2. Workflow Details: Submitting an Oncology Preauth
This section details the step-by-step process for submitting an oncology pre-authorisation request.
### 2.1. Step-by-Step System Behavior
Input Reception:
The system receives the consent_token for the patient's active visit, the intervention_code for the oncology procedure, is_co_insured, carcinoma_staging, comorbidity, metastases, progress_report, treatment_setting, start_date, number_of_sessions, cost_per_session, and arrays of items, diagnoses, doctors, and attachments.
Authorisation and Visit Context Check:
The system uses the provided consent_token to validate that the patient has a valid, active visit and that consent is still active. This also includes confirming the patient is in an active state.
Oncology Preauth Request Validation:
The system performs comprehensive and specific checks on the incoming data and the context of the request, as per SHA's rules for oncology procedures.
Submit Oncology Preauth Request to SHA:
If all validations pass, the system compiles the complete oncology pre-authorisation request payload and submits it to SHA's preauth service.
Receive SHA Response:
The system receives and processes the response from SHA, which indicates the submission status (e.g., success, failure, pending review).
### 2.2. Key Validations
These are the critical checks performed during this workflow to ensure the accurate and compliant submission of an oncology pre-authorisation request.
### 2.3. Workflow Data Dictionary
This table outlines the key information used and produced by this workflow:
 | Field Name | Description | Required (Input) | Type | Options (if applicable) | Purpose
 | consent_token | The consent token for the patient visit. | Yes | string |  | Authorizes the preauth request for the correct patient and active visit.
 | intervention_code | The unique identifier for the oncology intervention you want to do a preauth request for. You should only select the intervention that needs a preauth. You can know this from the previous interventions coverage response. | Yes | string |  | Specifies the particular oncology procedure or treatment for which pre-authorization is being sought.
 | is_co_insured | Is the patient co-insured? | No | boolean |  | Indicates if the patient has co-insurance.
 | carcinoma_staging | The Carcinoma staging. | Yes | string | Stage 1, Stage 2, Stage 3, Stage 4 | Provides details on the stage of carcinoma, essential for oncology treatment planning.
 | comorbidity | The comorbidity. | Yes | string |  | Describes any co-existing medical conditions.
 | metastases | The metastases. | Yes | string | Lung, Brain, Liver, Other (specify missing option) | Indicates the location of cancer spread.
 | progress_report | The patient's progress report. | No | string |  | Provides an update on the patient's condition and treatment progress.
 | treatment_setting | The treatment setting. | Yes | string | Day ward, Reclining chair, Side room (Specify your option) | Specifies where the treatment will take place.
 | start_date | The expected start date. | Yes | An ISO 8601 timestamp of the date for the |  | Marks the beginning of the authorized treatment period.
 | number_of_sessions | The number of sessions. | Yes | integer |  | Defines the extent of the oncology treatment plan (e.g., number of chemotherapy cycles).
 | cost_per_session | The cost per session. | Yes | float (up-to 2dp) |  | Specifies the cost for each individual session.
 | doctors | The Attending Doctors/Clinical Officers consent. This is an array of the doctors you need approval from. | Yes | array |  | Captures the medical professional(s) providing consent and oversight for the requested oncology service.
 | items | This will be an array of items in the preauth request. | Yes | array |  | Details the specific components of the oncology service being requested for authorization, crucial for financial assessment.
 | diagnoses | This will be an array of diagnoses in the preauth request. | Yes | array |  | Provides the medical justification for the requested oncology intervention, a fundamental requirement for SHA's review.
 | attachments | This will be an array of attachments in the request. | No | array |  | Provides essential clinical evidence or justification for SHA's detailed review of oncology procedures.
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
