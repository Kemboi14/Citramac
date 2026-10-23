# Preauths Process Guide: Surgical Preauth Workflow
## 1. Overview: Obtaining Prior Authorization for Surgical Procedures
This guide details the Surgical Preauth Workflow, a specialized preauth form which is part of the broader Preauths Process. This workflow is specifically designed to facilitate the submission of pre-authorization requests for surgical interventions that require prior approval from the Social Health Authority (SHA) for payment.
A surgical preauth can be a normal OR an elective preauth, since a surgical procedure may be elective or not. Which one applies is a property of the intervention: check needsManualPreauthApproval on Intervention Coverage - true puts you into the elective pre-visit flow, false into the normal same-day flow.
Every surgical intervention requires doctor approval. needsDoctorAuthorization is true for all of them, which means creating the preauth automatically sends a consent request to the doctors named in the doctors array - by two-way SMS, Practice360 or email - and the preauth waits in PENDING_DOCTOR_APPROVAL until one responds. You do not call anything extra; the doctor-consent endpoint only resends a request that did not arrive. See Surgical Rules.
## 2. Workflow Details: Submitting a Surgical Preauth
This section details the step-by-step process for submitting a surgical pre-authorization request.
### 2.1. Step-by-Step System Behavior
Input Reception:
The system receives the consent_token for the patient's active visit, the intervention_code for the surgical procedure, arrays of items, diagnoses, doctors, attachments, and specific surgical details like surgery_date, chief_complaint, vital_signs, history_of_present_illness, physical_examination, investigation_report_details, type_of_anaesthesia, is_condition_related_to_employment, is_condition_related_to_auto_or_other_accident, is_co_insured, and co_insurance_details.
Authorization and Visit Context Check:
The system uses the provided consent_token to validate that the patient has a valid, active visit and that consent is still active. This also includes confirming the patient is in an active state.
Surgical Preauth Request Validation:
The system performs comprehensive and specific checks on the incoming data and the context of the request, as per SHA's rules for surgical procedures. A surgical preauth can be normal or elective, so the applicable normal or elective preauth validations are considered depending on the intervention. On top of these, specific Surgical Form Field Validations are checked such as surgery_date, chief_complaint, vital_signs, history_of_present_illness, physical_examination, investigation_report_details, and type_of_anaesthesia.
Submit Surgical Preauth Request to SHA:
If all validations pass, the system compiles the complete surgical pre-authorization request payload and submits it to SHA's preauth service.
Receive SHA Response:
The system receives and processes the response from SHA, which indicates the submission status (e.g., success, failure, pending review).
### 2.2. Key Validations
These are the critical checks performed during this workflow to ensure the accurate and compliant submission of a surgical pre-authorisation request. Because a surgical preauth can be either a normal or an elective preauth, it inherits the validation rules of whichever type applies to the intervention - the normal preauth validations when the surgery is not elective, and the elective preauth validations when it is - in addition to the surgical form field checks above.
### 2.3. Workflow Data Dictionary
This table outlines the key information used and produced by this workflow, specifically for Surgical Preauths. This form represents the required items on a surgical preauth.
 | Field Name | Info | Options (if applicable) | Is required? | Type
 | consent_token | The consent token for the patient visit |  | True | string
 | intervention_code | Unique identifier to the intervention. Must be one whose needsPreauth flag is true on the intervention coverage response. |  | True | string
 | surgery_date | The expected surgery date. |  | True | An ISO 8601 timestamp of the date
 | chief_complaint | The complaint that caused the patient to seek medical care. |  | True | string
 | vital_signs | Patient's vital signs eg. Heart rate, Blood pressure, Respiratory rate, Temperature and Oxygen saturation. |  | True | string
 | history_of_present_illness | History of present illness. |  | True | string
 | physical_examination | Description of findings from physical examination. |  | True | string
 | investigation_report_details | Investigations. |  | True | string
 | type_of_anaesthesia | Type of anaesthesia. | General Anaesthesia, Local Anaesthesia, Spinal Anaesthesia, Sedation | True | string
 | is_condition_related_to_employment | Is the patient's condition related to employment?. |  | False | boolean
 | is_condition_related_to_auto_or_other_accident | Is the patient's condition related to auto/other accident?. |  | False | boolean
 | is_co_insured | Is the patient co-insured?. |  | False | boolean
 | co_insurance_details | Co-insurance Details if the patient is co-insured. |  | False | string (should be string, boolean from image is likely error)
 | doctors | Array of Attending Doctors/Clinical Officers consent. |  | True | array
 | items | Array of items in the preauth request. |  | True | array
 | diagnoses | Array of diagnoses in the preauth request. |  | True | array
 | attachments | Array of attachments in the request. |  | False | array
Some items in the general workflow dictionary have their own specific workflow dictionaries. Below is the list that applies to this particular preauthorization.
2.3.1. Preauth Doctor
This component represents the details of a doctor or clinical officer whose consent is required for a pre-authorization.
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
This component represents the supporting documents or files that are attached to a pre-authorization request.
Attachments are uploaded as binary multipart parts (not base64); each entry's file_field_name names the binary part it links to. See Adding Attachments for the full mechanics.
Which documents this preauth must carry comes from the intervention, not from the list below. Read requiredPreauthDocumentTypes on Intervention Coverage for the intervention you are requesting; the document_type values below are the full set of allowed classifications to choose from.
 | Field Name | Info | Options (if applicable) | Is required? | Type
 | file_field_name | Names the multipart part that carries this file's binary. Can be any name, as long as it matches the part. |  | True | string
 | document_title | Title of the document. |  | True | string
 | document_type | The document classification. | BIOPSY_RESULT, CASE_NOTES_JUSTIFYING_ADMISSION, CASE_NOTES_INDICATING_NEED_FOR_DEVICE, CASE_SUMMARY, CLINICAL_DOCUMENTATION, CRITICAL_CARE_UNIT_CASE_NOTES, CONSULTANT_REPORT, DIAGNOSTIC_REQUESTS, DIALYSIS_CHART, DISCHARGE_SUMMARY, FINAL_BILL, INTERIM_BILL, HISTOPATHOLOGY_RESULTS, IMAGING_ORDER, IMAGING_RESULT, KMPDC_FORM, LOU, LAB_ORDER, LAB_RESULTS, LAB_TESTS, MEDICAL_REPORT, PRESCRIPTION, PRIOR_BASIC_DIAGNOSTIC_IMAGES, PROFORMA_INVOICE, RADIOLOGICAL_EXAM, RADIOLOGY_REQUEST, REFERRAL_LETTER, RHESUS_FACTOR, SHA_REFERRAL_FOR_OVERSEAS_TREATMENT_FORM, STAGING_RESULTS, TREATMENT_PLAN, THEATRE_LIST, ULTRASOUND, PREAUTH_FORM, OTHER | True | string
 | file_blob | The binary file part. Uploaded as raw binary multipart (not base64). |  | True | file
## Related resources
- Surgical Rules - global periods by complexity, per-diem suppression, and when a separate claim may be raised.
- Surgical interventions require doctor approval - needsDoctorAuthorization, and what creating the preauth sends automatically.
- Three dates must be captured separately - admission, procedure and discharge dates, and what happens when they conflict with the global period.
- Intervention Coverage - complexity, preauth flags and required document types.
- Preauth Doctor Consent - resending the doctor request if it did not arrive.
- Adding Attachments - reading required documents off the intervention.
- Special Benefit Rules - all six rule sets.
- SHA Combination Rules - what SHA-19 may share a visit with.
Last modified on September 28, 2026
