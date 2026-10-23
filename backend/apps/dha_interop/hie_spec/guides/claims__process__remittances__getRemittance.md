# Remittance Process Guide: Get Remittances Workflow
## 1. Overview: Retrieving High-Level Remittance Information
This guide provides an overview of the Get Remittances workflow, which is the crucial first step in the larger Remittance Process. It reviews incoming payments from the Social Health Authority (SHA). The main function of this workflow is to gather a summary of all remittances (payments) received by a specific healthcare facility.
### 1.1. What This Workflow Does
The Get Remittances workflow provides a high-level list of payment batches (remittances) sent by SHA to a facility. It does this by taking the facility's identification details and querying the system for all matching remittance records.
### 1.2. Why This Workflow Is Critical (The "Why It Matters")
Getting a clear overview of received remittances is essential for starting the reconciliation process. Without this step:
- Delayed Reconciliation: Payment-to-claim matching is delayed, causing slower financial closure.
- Missed Payments: Payments may go unnoticed, leading to financial discrepancies.
- Inefficient Tracking: Manual tracking is error-prone and time-consuming.
This workflow is the gateway to payment reconciliation. All other steps depend on the accurate, complete list it provides.
## 2. Workflow Details: Get Remittances
### 2.1. Workflow Description: Step-by-Step System Behavior
Input Reception: The system receives facility_id and facility_id_type.
Facility Validation: The system validates that the ID and ID type correspond to a registered and recognised facility.
Remittance Data Retrieval: After validation, the system queries financial records for all remittances linked to that facility.
Data Compilation: It compiles key information including:
- bank_reference
- payment amounts
- payment dates
Output Delivery: The system returns a list of high-level remittances.
### 2.2. Key Validations: Our System’s Essential Checks
- Valid Facility Identification
- facility_id must be a legitimate facility identifier.
- facility_id_type must be a supported type:
- fr-code,
- registration-number,
- fid.
These ensure the system retrieves data for the correct, authorised facility - preventing data leakage or mismatch.
### 2.3. Workflow Data Dictionary: What Information We Work With
 | Field Name | Description | Data Type | Required | Purpose
 | facility_id | Unique identifier for the healthcare facility | string | Yes | Primary key for identifying the target facility for remittance lookup
 | facility_id_type | Type of identifier (e.g., fr-code, fid, etc.) | string | Yes | Helps the system correctly interpret and locate the facility
### 2.4. Expected Outcomes from this Workflow
Success: Remittances Retrieved
A valid list of remittances for the facility is returned.
Failure: Invalid Facility Identification
The facility_id or facility_id_type is incorrect or unrecognised.
Failure: No Remittances Found
The facility is valid, but no remittance records exist.
Failure: Missing Required Data
Required fields (facility_id, facility_id_type) are missing or malformed.
Last modified on September 28, 2026
