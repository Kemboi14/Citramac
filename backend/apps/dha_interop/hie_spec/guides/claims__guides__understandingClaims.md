# Understanding Virtual Claims
A virtual claim in the HIE ecosystem is the digital record of a patient encounter. It acts as the container for three distinct types of data:
- Clinical Data: Diagnoses and Interventions (What happened?)
- Financial Data: Invoices and Lines (What does it cost?)
- Administrative Data: Patient IDs, Provider IDs, and Authorizations (Who is involved?)
## The Two Views: Provider vs. Payer
It is critical to understand that a single claim exists in two forms depending what stage in the lifecycle it is in.
### 1. The Provider Claim (Your View)
This is the claim object as it exists in your HMIS. You have full control over this object while it is in DRAFT. And have no control when submitted.
This claim object is created by you via the Create virtual claim endpoint.
- The primary use of this claim is to confirm that correct details have been added to the claim, tracking billing, submitting data, and correcting errors.
- This provider claim contains the "Source of Truth" for clinical and billing data.
### 2. The Payer Claim (The Adjudicator's View)
This is the read-only version of the claim that is what the payer's system actually sees and interacts directly with in terms of feedback.
- It can be retrieved via the Preview Payer Claim endpoint.
- Some of the primary uses of this claim is it helps get feedback on your claim directly from the payer and why, it helps provide more understanding as to why a claim was rejected or returned for changes, checking payment amounts, and reading feedback notes.
## Anatomy of a Claim
A claim is a hierarchical tree. Understanding this hierarchy is essential for proper managing of the claim, and error handling.
### 1. The Root Object (The Claim)
Contains the high-level metadata: claim_auth_status, workflow_state, patient_number, and the authorization_code (mostly referred to as the consent_token).
### 2. The Invoice Object
Every claim has an invoices array (currently limited to 1 invoice per claim). This holds the financial totals.
- Invoice Lines: Nested inside the invoice. These are the specific line items (e.g., "Consultation - 500 KES").
### 3. The Intervention Object
These are the medical services linked to the claim.
- Crucial Rule: Every Invoice Line must correspond to a valid Intervention Code. If you have a line item for "Surgery," you must have an active Surgical Intervention in this array.
## Data Structure Examples
### Provider Claim Payload (Simplified)
This is a simplified structure of a Provider Claim. Notice how invoices and interventions are logically linked. To see the full structure you can check the Create Virtual Claim endpoint documentation.
Code 
{
  "admitted_on": "string",
  "appointment_number": "string",
  "attributes": "string",
  "authorization_code": "string",
  "authorization_guid": "string",
  "beneficiary_guid": "string",
  "beneficiary_id": 5205,
  "beneficiary_is_fuzzy_matched": false,
  "cancel_reason_text": "string",
  "cancel_reason_type": "string",
  "claim_attachments_count": 705,
  "claim_auth_status": "string",
  "claim_diagnoses": [
    {
      "claim": "string",
      "claim_diagnosis_id": 3865,
      "diagnosis": "string",
      "diagnosis_code": "string",
      "diagnosis_name": "string",
      "edi_claim_diagnosis_guid": "string",
      "edi_claim_diagnosis_replicated": "string",
      "intervention_code": "string",
      "is_flagged_diagnosis": false,
      "is_inpatient": true,
      "original_visit_date": "string",
      "patient_number": "string",
      "recorded_on": "string",
      "site_code": "string",
      "site_code_type": "string",
      "visit_number": "string"
    }
  ],
  "claim_id": 3315,
  "created_by_name": "string",
  "currency": "string",
  "diagnoses_count": 770,
  "discharge_cancel_date": "string",
  "discharge_cancel_remarks": "string",
  "discharge_reason": "string",
  "discharged_on": "string",
  "edi_claim_guid": "string",
  "emergency_visit_expiry": "string",
  "estimate_ip_days": 7995,
  "expected_discharge_date": "string",
  "has_reviewed_claim": false,
  "id": "string",
  "initial_intervention": "string",
  "intervention_copay_data": ["string", "string"],
  "interventions": [
    {
      "accrued_per_diem_amount": 4709.152718937875,
      "accrued_per_diem_days": 3493,
      "active_for_uhc": false,
      "bill_from": "string",
      "bill_to": "string",
      "id": "string",
      "intervention_code": "string",
      "intervention_fund": "string",
      "intervention_name": "string",
      "intervention_overall_tariff": 6162.5011110231335,
      "intervention_payment_mechanism": "string",
      "is_switched_intervention": true,
      "keph_level_tarrif": 1330.8115657640074,
      "preauth_exist": true,
      "requires_surgical_preauth": false,
      "sub_benefit_code": "string",
      "supported_scheme": "string",
      "switched_intervention_id": 8469,
      "switched_lines_retained": true,
      "workflow_state": "string"
    }
  ],
  "invoice_attachments_count": 3810,
  "invoice_id": "string",
  "invoice_number": "string",
  "invoices": [
    {
      "created_by_name": "string",
      "department": "string",
      "discount_amount": 1681.6708386995472,
      "dispatch_batch_number": "string",
      "dispatch_status": "string",
      "doctors": [
        {
          "doctor_request_status": "APPROVED",
          "slade_code": "string"
        }
      ],
      "edi_invoice_id": "string",
      "id": "string",
      "invoice_copays": [
        {
          "charge_date": "string",
          "copay_amount": 8374.510627096637,
          "copay_type": "string",
          "description": "string",
          "edi_invoice_copay_guid": "string",
          "edi_invoice_copay_id": 4521,
          "intervention_code": "string",
          "invoice": 1782,
          "provider_copay_no": "string"
        }
      ],
      "invoice_date": "string",
      "invoice_flags": [
        {
          "code": "string",
          "description": "string",
          "edi_flag_guid": "string",
          "edi_flag_id": 3795,
          "existing": "string",
          "flag_type": "string",
          "invoice": "string",
          "is_resolved": true,
          "message": "string",
          "payload": "string",
          "response": "string",
          "timestamp": "string",
          "traceback": "string"
        }
      ],
      "invoice_number": "string",
      "invoice_type": "string",
      "lines": [
        {
          "attributes": "string",
          "bill_from": "string",
          "bill_to": "string",
          "charge_date": "string",
          "discount": 9138.656265712008,
          "discount_reason": "string",
          "doctor_code": "string",
          "doctor_name": "string",
          "id": "string",
          "intervention_code": "string",
          "invoice": "string",
          "is_active": false,
          "is_cancellation": true,
          "is_return": false,
          "item_code": "string",
          "item_name": "string",
          "line_copay": 6632.284995171225,
          "line_net_amount": 7325.581053297044,
          "line_number": "string",
          "line_total_amount": 8277.868168267792,
          "linked_invoice_line": "string",
          "map_request": "string",
          "map_request_description": "string",
          "mapped_slade_code": "string",
          "nhif_rebate_amount": 1399.5708020511534,
          "patient_discount_amount": 1065.155779487701,
          "patient_net_price": 1107.9968117682615,
          "pmf_line_status": "string",
          "quantity": 6204.365663753832,
          "scheme_code": "string",
          "scheme_name": "string",
          "sponsor_net_price": 9690.798672122937,
          "uhc_exceeded": true,
          "unit": "string",
          "unit_price": 7148.383053016953
        }
      ],
      "linked_invoice": "string",
      "linked_invoice_line": "string",
      "member_name": "string",
      "patient_name": "string",
      "patient_number": "string",
      "provider_invoice_ref": "string",
      "provider_name": "string",
      "scheme_code": "string",
      "scheme_name": "string",
      "scu_branch_id": "string",
      "scu_dispatch_timestamp": "string",
      "scu_receipt_signature": "string",
      "service_type": "string",
      "total_inv_amount": 2332.0989140038596,
      "total_inv_copay": 3740.1355676164603,
      "total_inv_discount": 3939.1434464142017,
      "total_inv_net_amount": 5721.417071745256,
      "visit_end": "string",
      "visit_start": "string",
      "workflow_state": "string"
    }
  ],
  "is_charge_master_mapped": true,
  "is_negative": false,
  "is_resubmitted": false,
  "is_zero": false,
  "last_retry": "string",
  "location_code": "string",
  "location_name": "string",
  "member_name": "string",
  "member_number": "string",
  "member_number_has_token": true,
  "mode_of_arrival": "string",
  "nhif_number": "string",
  "notes": "string",
  "number_of_invoices": 5711,
  "patient_name": "string",
  "patient_number": "string",
  "payer_code": "string",
  "payer_name": "string",
  "payer_slade_code": "string",
  "policy_number": "string",
  "policy_valid_from": "string",
  "policy_valid_to": "string",
  "provider_name": "string",
  "provider_slade_code": "string",
  "reason_for_unknown_patient": "string",
  "reference_number": "string",
  "resubmission_workflow_state": "string",
  "retry_count": 8884,
  "scheme_code": "string",
  "scheme_name": "string",
  "service_type": "string",
  "total_claim_amount": 7006.812956886901,
  "total_claim_copay": 1155.9236336068325,
  "total_claim_discount": 747.5162780757105,
  "total_claim_net_amount": 5155.379558342188,
  "total_claim_splits": 1573.3887589863737,
  "updated_by_name": "string",
  "visit_end": "string",
  "visit_number": "string",
  "visit_start": "string",
  "workflow_state": "string"
}
Key Field Reference: Provider Claim
 | Field | Description
 | id | Unique identifier for the claim.
 | claim_id | Internal ID for the claim.
 | claim_auth_status | Shows the authorization status of the claim.
 | authorization_code | Code confirming claim authorization and consent (consent_token).
 | authorization_guid | GUID for the authorization.
 | beneficiary_id | Identifier for the beneficiary (beneficiary_cr_id).
 | beneficiary_guid | GUID for the beneficiary.
 | patient_name / patient_number | Name and identifier of the patient.
 | member_name / member_number | Details about the insured member.
 | provider_name / provider_slade_code | Name and code of the healthcare provider.
 | payer_name / payer_code / payer_slade_code | Details of the insurance payer.
 | scheme_name / scheme_code | Name and code of the SHA scheme.
 | total_claim_amount | The total monetary value being claimed.
 | total_claim_net_amount | Net amount after discounts and copays.
 | total_claim_copay | Total copay amount for the claim.
 | total_claim_discount | Total discount applied to the claim.
 | total_claim_splits | Amount split across payers or schemes.
 | invoices | Array of billing details. Only 1 invoice allowed per claim.
 | invoice_number / invoice_id | Invoice reference and identifier.
 | interventions | Lists the healthcare services or procedures.
 | claim_diagnoses | Diagnoses associated with the claim.
 | workflow_state | Current processing status of the claim (e.g., DRAFT, SUBMITTED).
 | resubmission_workflow_state | Status of the claim during resubmission.
 | service_type | Type of healthcare service (e.g., CAPITATION, INPATIENT).
 | visit_start / visit_end | Start and end timestamps for the patient visit.
 | admitted_on / discharged_on | Admission and discharge dates for inpatient claims.
 | discharge_reason | Reason for patient discharge.
 | emergency_visit_expiry | Expiry date for emergency visits.
 | has_reviewed_claim | Indicates if the claim has been reviewed by the provider.
 | is_resubmitted | Whether the claim has been resubmitted.
 | currency | Currency used for the claim (e.g., KES).
 | notes | Additional comments or notes about the claim.
Note: The document_types field is key for claim attachments: all required document types listed here must be uploaded for each intervention before the claim can be submitted. If any required document is missing, the claim submission will be blocked. For a complete structure, refer to the relevant API reference documentation and see the actual response payload.
### Payer Claim Payload (Simplified)
This is a simplified structure of a Payer Claim. Notice how claimNotes and claimTransitions. This is data added by the Payer after automated or payer user reviews. To see the full structure you can check the Preview Payer Claim endpoint documentation.
Code 
{
  "attachments_count": 8159,
  "claim_attachments": [
    {
      "attachment": "string",
      "attachment_type": "string",
      "claim": "string",
      "data": "string",
      "debug_data": "string",
      "description": "string",
      "id": "string",
      "intervention_code": "string",
      "last_retry": "string",
      "retry_count": 6599,
      "title": "string"
    }
  ],
  "claim_diagnoses": [
    {
      "claim": "string",
      "claim_diagnosis_id": 1737,
      "diagnosis": "string",
      "diagnosis_code": "string",
      "diagnosis_name": "string",
      "edi_claim_diagnosis_guid": "string",
      "edi_claim_diagnosis_replicated": "string",
      "intervention_code": "string",
      "is_flagged_diagnosis": true,
      "is_inpatient": true,
      "original_visit_date": "string",
      "patient_number": "string",
      "recorded_on": "string",
      "site_code": "string",
      "site_code_type": "string",
      "visit_number": "string"
    }
  ],
  "claim_number": "string",
  "copay_amount": 537.101349514999,
  "diagnoses_count": 2580,
  "discount_amount": 3214.5500929632285,
  "estimated_processing_time": "string",
  "id": "string",
  "interventions": [
    {
      "accrued_per_diem_amount": 7339.765853242024,
      "accrued_per_diem_days": 2046,
      "active_for_uhc": true,
      "bill_from": "string",
      "bill_to": "string",
      "id": "string",
      "intervention_code": "string",
      "intervention_fund": "string",
      "intervention_name": "string",
      "intervention_overall_tariff": 6702.36724029738,
      "intervention_payment_mechanism": "string",
      "is_switched_intervention": false,
      "keph_level_tarrif": 5927.742541068468,
      "preauth_exist": true,
      "requires_surgical_preauth": false,
      "sub_benefit_code": "string",
      "supported_scheme": "string",
      "switched_intervention_id": 3081,
      "switched_lines_retained": false,
      "workflow_state": "string"
    }
  ],
  "invoices": [
    {
      "created_by_name": "string",
      "department": "string",
      "discount_amount": 4956.066249831641,
      "dispatch_batch_number": "string",
      "dispatch_status": "string",
      "doctors": [
        {
          "doctor_request_status": "APPROVED",
          "slade_code": "string"
        }
      ],
      "edi_invoice_id": "string",
      "id": "string",
      "invoice_copays": [
        {
          "charge_date": "string",
          "copay_amount": 6210.702181039925,
          "copay_type": "string",
          "description": "string",
          "edi_invoice_copay_guid": "string",
          "edi_invoice_copay_id": 5380,
          "intervention_code": "string",
          "invoice": 6036,
          "provider_copay_no": "string"
        }
      ],
      "invoice_date": "string",
      "invoice_flags": [
        {
          "code": "string",
          "description": "string",
          "edi_flag_guid": "string",
          "edi_flag_id": 2896,
          "existing": "string",
          "flag_type": "string",
          "invoice": "string",
          "is_resolved": true,
          "message": "string",
          "payload": "string",
          "response": "string",
          "timestamp": "string",
          "traceback": "string"
        }
      ],
      "invoice_number": "string",
      "invoice_type": "string",
      "lines": [
        {
          "attributes": "string",
          "bill_from": "string",
          "bill_to": "string",
          "charge_date": "string",
          "discount": 7969.099805558973,
          "discount_reason": "string",
          "doctor_code": "string",
          "doctor_name": "string",
          "id": "string",
          "intervention_code": "string",
          "invoice": "string",
          "is_active": false,
          "is_cancellation": true,
          "is_return": false,
          "item_code": "string",
          "item_name": "string",
          "line_copay": 6286.828709544115,
          "line_net_amount": 5415.312992009897,
          "line_number": "string",
          "line_total_amount": 95.08355621054676,
          "linked_invoice_line": "string",
          "map_request": "string",
          "map_request_description": "string",
          "mapped_slade_code": "string",
          "nhif_rebate_amount": 9768.505450343619,
          "patient_discount_amount": 5052.602332524425,
          "patient_net_price": 1295.9196543846008,
          "pmf_line_status": "string",
          "quantity": 9055.222778253114,
          "scheme_code": "string",
          "scheme_name": "string",
          "sponsor_net_price": 8166.429674629485,
          "uhc_exceeded": true,
          "unit": "string",
          "unit_price": 2598.675619029447
        }
      ],
      "linked_invoice": "string",
      "linked_invoice_line": "string",
      "member_name": "string",
      "patient_name": "string",
      "patient_number": "string",
      "provider_invoice_ref": "string",
      "provider_name": "string",
      "scheme_code": "string",
      "scheme_name": "string",
      "scu_branch_id": "string",
      "scu_dispatch_timestamp": "string",
      "scu_receipt_signature": "string",
      "service_type": "string",
      "total_inv_amount": 6278.949082592125,
      "total_inv_copay": 5508.40995614728,
      "total_inv_discount": 1889.5562200735694,
      "total_inv_net_amount": 1602.2825305865563,
      "visit_end": "string",
      "visit_start": "string",
      "workflow_state": "string"
    }
  ],
  "member_number": "string",
  "net_amount": 3171.675575686503,
  "number_of_invoices": 6813,
  "patient_name": "string",
  "patient_number": "string",
  "payer_claim_status": "string",
  "payer_processing_notes": "string",
  "provider_name": "string",
  "scheme_code": "string",
  "scheme_name": "string",
  "service_type": "string",
  "total_amount": 9481.243191838284,
  "visit_end": "string",
  "visit_start": "string"
}
Key Field Reference: Payer Claim
| Field                                                  | Description                                        |
| ------------------------------------------------------ | -------------------------------------------------- | --- |
| id                                                     | Unique identifier for the payer claim.             |
| claim_number                                           | The claim number assigned by the payer.            |
| payer_claim_status                                     | Current status of the claim in the payer's system. |
| payer_processing_notes                                 | Notes or feedback from the payer's processing.     |
| member_number                                          | Identifier for the insured member.                 |
| patient_name / patient_number                          | Name and identifier of the patient.                |
| provider_name                                          | Name of the healthcare provider.                   |
| scheme_name / scheme_code                              | Name and code of the insurance scheme.             |
| total_amount                                           | The total amount of the claim.                     |
| net_amount                                             | The net amount after adjustments.                  |
| copay_amount                                           | Total copay amount.                                |
| discount_amount                                        | Total discount amount.                             |
| interventions                                          | Lists the healthcare services or procedures.       |
| interventions[n].intervention_name / intervention_code | Name and code of the medical service.              |
| interventions[n].intervention_overall_tariff           | Overall tariff for the intervention.               |
| invoices                                               | Array of billing details and adjudicated lines.    |
| invoices[n].lines                                      | Specific line items within the invoice.            |
| invoices[n].lines[n].item_name / item_code             | Name and code of the line item.                    |
| invoices[n].lines[n].line_total_amount                 | Total amount for the specific line.                |
| claim_diagnoses                                        | Diagnoses associated with the claim.               |
| claim_attachments                                      | Supporting documents attached to the claim.        |
| attachments_count                                      | Total number of attachments.                       |
| diagnoses_count                                        | Total number of diagnoses.                         |
| number_of_invoices                                     | Total number of invoices.                          |
| estimated_processing_time                              | Estimated time for claim processing.               |
| visit_start / visit_end                                | Start and end timestamps for the patient visit.    |     |
Note: This claim object contains more additional fields but has been simplified to cover the most commonly used and relevant fields for understanding and processing claims. For a complete structure, refer to the relevant API reference documentation and see the the actual response payload.
Last modified on September 28, 2026
