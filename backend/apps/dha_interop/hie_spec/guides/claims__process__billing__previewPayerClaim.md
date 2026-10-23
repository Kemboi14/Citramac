# Preview Payer Claim Workflow Guide
## Preview Payer Claim Workflow: Tracking Claim Status After Submission to Payer
### 1. Overview
This guide explains the Preview Payer Claim workflow, which allows providers and beneficiaries to view the details and status of a claim after it has been submitted to the payer. This workflow provides visibility into the claim’s progress, status, and any updates or actions taken by the payer.
1.1. What This Workflow Does
The Preview Payer Claim workflow enables users to:
- Track Claim Status: View the current status of the claim as seen by the payer (e.g., AUTHORIZED, CLOSED, REJECTED).
- Review Claim Details: See all claim data, including invoices, interventions, diagnoses, and attachments as processed by the payer.
- Monitor Updates: Stay informed about any changes, approvals, or rejections made by the payer.
- Facilitate Communication: Understand what the payer sees, helping resolve issues or follow up on pending claims.
1.2. Why This Workflow Is Critical
- Transparency: Users can track the claim’s journey and status after submission.
- Accountability: Ensures both provider and beneficiary are aware of payer actions.
- Faster Resolution: Helps identify and address issues or delays in claim processing.
### 2. Workflow Details: Preview Payer Claim
### Supply exactly one identifier
Identify the claim by either guid or provider_claim_no - one of the two, not both. Both are
optional in the schema precisely because they are alternatives to each other.
### Only after the claim has reached the payer
This endpoint reads the payer's copy of the claim, so it is only usable once the claim has actually
reached the payer. Check with
Preview Provider Claim first: until that reports
the claim as SUBMITTED, there is nothing at the payer to preview.
2.1. Workflow Description
When a user requests to preview a payer claim, the following steps occur:
- Input Reception: The user submits a request identifying the claim by one of its guid or its provider_claim_no, together with the facility headers.
- Claim Lookup: The system queries the payer’s records for the claim.
- Status & Data Retrieval: The payer returns the claim’s current status and all associated data.
- Outcome Delivery: The user reviews the claim as seen by the payer, including any updates or actions taken.
2.2. Key Validations: System Checks
- Exactly One Identifier:
Either guid or provider_claim_no must be supplied. They are alternatives, not a pair.
- Claim Must Have Reached the Payer:
The claim must be SUBMITTED - confirm through Preview Provider Claim before calling this endpoint.
- Facility Identifiers:
X-Facility-Id and X-Facility-Id-Type are required when authenticating with a service-account token.
2.3. Workflow Data Dictionary
 | Field Name | Description | Data Type | Required | Purpose
 | guid | Claim invoice GUID (query parameter) | String | One-of | Identifies the claim to preview. Supply this or provider_claim_no.
 | provider_claim_no | The invoice number you supplied when submitting the claim (query parameter) | String | One-of | The alternative identifier when you hold the invoice number rather than the GUID.
 | X-Facility-Id | Facility Registry (FR) code of the facility (header) | String | Conditional | Required when authenticating with a service-account token.
 | X-Facility-Id-Type | Type of identifier in X-Facility-Id. Currently only fr-code (header) | String | Conditional | Tells the HIE how to interpret the facility identifier.
Returned Data Includes:
- Claim status (claim_auth_status)
- Total claim amounts
- Invoices and invoice lines
- Interventions
- Diagnoses
- Attachments
- Workflow state
2.4. Expected Outcomes from this workflow
- Successful Preview: Claim details and status are returned as seen by the payer.
- Claim Not Found: No claim matches the identifier supplied, or the claim has not yet reached the payer. Verify the identifier, then confirm the claim is SUBMITTED.
- Input Error: Neither identifier was supplied, or the value provided is invalid.
### 3. How Preview Payer Claim Connects to Other Workflows
- Preview Provider Claim: the step before this one. It tells you whether the claim has reached the payer yet.
- Understanding Claim Statuses: what SUBMITTED and the payer-side statuses mean.
- Billing: Confirms the payer’s view of billing lines and invoices.
- Interventions: Validates interventions as processed by the payer.
- Attachments & Diagnoses: Shows all supporting documents and diagnoses as received by the payer.
### 4. Key Success Factors for Payer Claim Preview
- Supply One Identifier: Send either the guid or the provider_claim_no, never both.
- Wait for SUBMITTED: Preview the provider claim first - calling too early returns nothing useful.
- Review All Data: Check every section of the claim for completeness and accuracy.
- Follow Up Promptly: Address any issues or discrepancies with the payer as soon as possible.
- Maintain Compliance: Ensure all claim data meets regulatory and payer requirements.
Last modified on September 28, 2026
