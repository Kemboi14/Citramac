# Remittance Process Guide: Get Claims Paid by Remittance Workflow
## 1. Overview: Accessing a Detailed Claim Breakdown for a Specific Payment
This guide focuses on the Get claims paid by remittance workflow, which is part of the larger Remittance Process. It examines a specific payment to determine which claims were covered by that payment. The primary purpose of this workflow is to provide a detailed, claim-by-claim breakdown of a specific remittance, enabling accurate financial reconciliation.
### 1.1. What This Workflow Does
This workflow retrieves a list of all claims that were paid under a given remittance. It uses the unique bank_reference and the facility's ID to return individual claim-level payment information.
### 1.2. Why This Workflow Is Critical (The "Why It Matters")
A claim-by-claim breakdown is essential to proper reconciliation. Without this:
- Unreconciled Claims: The facility won't know which specific claims were paid.
- Billing Discrepancies: Partial, full, or denied claims go untracked, causing accounting errors.
- Inefficient Follow-up: Outstanding claims can't be pursued without clarity.
- Audit Deficiencies: Missing links between payments and claims create audit trail gaps.
This workflow ensures every payment is mapped to its respective claims for clean accounting and tracking.
## 2. Workflow Details: Get Claims Paid by Remittance
### 2.1. Workflow Description: Step-by-Step System Behavior
Input Reception
Receives:
- facility_id
- facility_id_type
- bank_reference
Validation
- Confirms the facility is valid.
- Confirms the bank_reference is valid for that facility.
Claim Data Retrieval
Queries the system for all claims associated with the given bank_reference.
Data Compilation
Gathers claim details:
- Claim ID
- Payment amount
- Payment status
Output Delivery
Returns the complete claim list for that remittance.
### 2.2. Key Validations: Our System’s Essential Checks
Valid Remittance Identifier
bank_reference must exist and be linked to the specified facility.
Valid Facility Identification
facility_id must be valid, and facility_id_type must be one of:
- fr-code
- registration-number
- fid
### 2.3. Workflow Data Dictionary: What Information We Work With
 | Field Name | Description | Data Type | Required | Purpose
 | facility_id | Unique identifier of the healthcare facility | string | Yes | Primary key used to locate remittance and claim data
 | facility_id_type | Format/type of facility_id (e.g., fr-code, fid) | string | Yes | Informs the system how to interpret and validate the facility
 | bank_reference | Unique identifier for a specific remittance payment | string | Yes | Connects the request to a specific remittance for claim lookup
### 2.4. Expected Outcomes from this Workflow
Success: Claims Breakdown Retrieved
A detailed list of claims paid under the specified remittance is returned.
Failure: Invalid Remittance Reference
The bank_reference is not valid for the specified facility.
Failure: Invalid Facility Identification
The facility_id or facility_id_type is incorrect or not recognised.
Failure: No Claims Found
The remittance exists, but no claims are linked to it.
Failure: Missing Required Data
One or more required fields (facility_id, bank_reference) is missing or malformed.
Last modified on September 28, 2026
