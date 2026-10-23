# Preview Provider Claim Workflow Guide
## Preview Provider Claim Workflow: Reviewing Claim Details Before Payer Submission
### 1. Overview
This guide explains the Preview Provider Claim workflow, which allows providers to view the details and status of a claim before it is reviewed and updated by the payer. This workflow provides visibility into the claim’s contents, status, and any internal checks performed after submission but before payer review.
1.1. What This Workflow Does
The Preview Provider Claim workflow enables providers to:
- Review Claim Details: See all claim data, including invoices, interventions, diagnoses, and attachments.
- Check Claim Status: View the current status of the claim (e.g., DRAFT, SUBMISSION_READY, AUTHORIZED, CLOSED, FAILED_TO_SUBMIT).
- Perform Internal Validation: Ensure all required information is present and correct before the claim is sent to the payer.
- Identify Issues Early: Spot missing data, errors, or incomplete sections that could delay payer processing.
1.2. Why This Workflow Is Critical
- Reduces Errors: Providers can catch and fix issues before payer review.
- Improves Transparency: Providers have full visibility into what will be sent to the payer.
- Speeds Up Processing: Well-prepared claims are less likely to be rejected or delayed by the payer.
### 2. Workflow Details: Preview Provider Claim
2.1. Workflow Description
When a provider requests to preview a claim, the following steps occur:
- Input Reception: The provider submits a request with the claim’s consent token and facility identifiers.
- Claim Lookup: The system retrieves the claim details from the provider’s internal records.
- Internal Checks: The system validates the claim for completeness, required fields, and business rules.
- Status Reporting: The system returns the claim’s current status and all associated data.
- Outcome Delivery: The provider reviews the claim and makes any necessary corrections before final submission to the payer.
2.2. Key Validations: System Checks
- Consent Token Must Be Provided:
The consent token uniquely identifies the claim to preview.
- Facility Identifiers:
Facility ID and type may be required for multi-facility providers.
- Required Fields:
All mandatory claim fields (e.g., interventions, invoices, diagnoses) must be present.
2.3. Workflow Data Dictionary
 | Field Name | Description | Data Type | Required | Purpose
 | consent_token | Unique code for the claim | String | Yes | Identifies which claim to preview
 | facility_id | Facility identifier | String | No | Specifies the facility for the claim
 | facility_id_type | Type of facility identifier | String | No | Indicates the identifier type
Returned Data Includes:
- Claim status (claim_auth_status)
- Total claim amounts
- Invoices and invoice lines
- Interventions
- Diagnoses
- Attachments
- Workflow state
2.4. Expected Outcomes from this workflow
- Successful Preview: Claim details are returned for provider review.
- Claim Not Found: No claim matches the provided consent token; input may need verification.
- Input Error: Provided identifiers are invalid or missing.
2.5. Handling the FAILED_TO_SUBMIT Status
The preview may show a claim in the FAILED_TO_SUBMIT status. This occurs when the HIE hits a technical glitch while transmitting the claim to the payer, meaning the payer never received it.
### Recover a FAILED_TO_SUBMIT claim by re-submitting, not resubmitting
Recovery is not done through the /resubmit endpoint. Instead, re-call the normal
Submit outpatient / Discharge inpatient endpoint directly. Because the HIE treats this as a
resubmission, the consent fields and discharge reasons captured on the first attempt are not
required again.
### 3. How Preview Provider Claim Connects to Other Workflows
- Billing: Ensures all billing lines and invoices are correct before payer submission.
- Interventions: Validates interventions linked to the claim.
- Attachments & Diagnoses: Confirms all supporting documents and diagnoses are present.
### 4. Key Success Factors for Provider Claim Preview
- Use Valid Consent Tokens: Always provide the correct consent token for the claim.
- Review All Data: Check every section of the claim for completeness and accuracy.
- Fix Issues Early: Address any errors or missing data before submitting to the payer.
- Follow Compliance: Ensure all claim data meets regulatory and payer requirements.
Last modified on September 28, 2026
