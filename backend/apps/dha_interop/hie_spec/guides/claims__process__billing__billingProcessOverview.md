# Billing Workflows Process Overview: Streamlining Financial Transactions in Healthcare
## 1. Introduction: Understanding Billing Workflows
Billing workflows overview docs provide a high-level overview of how the financial transactions and associated data related to patient visits and claims are managed.
The Billing Workflows are designed to ensure the accurate and efficient handling of billable items, diagnoses, and supporting documents on a claim. It's about moving from an unbilled or partially billed visit to a fully reconciled and auditable claim ready for processing.
### 1.1. Why This Full Process Matters
A robust and accurate Billing Workflows is key to efficient, fair, and compliant healthcare delivery. It is crucial because it:
- Ensures Financial Accuracy: Prevents incorrect billing by enforcing financial limits and valid scheme allocations.
- Maintains Claim Integrity: Ensures all claims are associated with correct patient visits, interventions, and supporting diagnoses/attachments.
- Improves Auditability: Provides a clear, documented record of all changes to billing items, diagnoses, and attachments, which is important for compliance and dispute resolution.
- Facilitates Seamless Processing: By ensuring data quality and adherence to rules, it enables smoother subsequent steps like claim submission and payment reconciliation.
## 2. The Billing Workflows: Available, Order-Independent Operations
The Billing Workflows are a set of available operations, each enabling a specific modification to a patient's claim. They are not a fixed sequence - you are not required to perform them in a set order. Call whichever workflows your integration needs, in whatever order fits your flow, as long as the visit and consent remain valid. Here are the workflows that make up the Billing Workflows process:
### 2.1. Add New Line
Adds a new billable item (service or product) to a claim for a patient visit.
It allows providers to accurately record all rendered services and associated costs, forming the basis of the claim's financial segment. It includes validations for financial limits and tariff/PMF applicability.
### 2.2. Add Combined Billing Details
Adds a billable line together with its diagnoses and attachments in a single multipart/form-data request.
This bundles the line, its medical justification, and its supporting documents into one call, reducing round trips and keeping related billing data together.
### 2.3. Remove Line
Removes an existing bill item from a claim, mainly used to correct errors or reverse charges.
It ensures only valid and accurate charges remain on a claim, maintaining financial accuracy. There is a specific validation for per diem interventions.
### 2.4. Add Diagnosis
Adds a new ICD-11 diagnosis code to a specific intervention within a claim.
Proper diagnosis linkage validates the medical necessity and supports claim approval. It includes validations for diagnosis acceptance, activity, and weight for capitation.
### 2.5. Remove Diagnosis
Removes an ICD-11 diagnosis code from an existing visit intervention on a claim.
It allows correction of incorrectly attached diagnoses, ensuring the claim accurately reflects the patient's condition and the services provided.
### 2.6. Add Attachment
Adds a new attachment (e.g., medical reports, invoices) to a claim or an existing visit intervention.
Supporting documents are often required for claim substantiation, especially for complex cases or specific interventions.
### 2.7. Remove Attachment
Removes an existing attachment from a visit intervention on a claim.
It enables cleanup of wrongly placed or outdated attachments, ensuring claim documentation stays accurate and relevant.
### 2.8. Edit Claim Line
Adjusts the unit price and quantity of a claim line after a claim has been transitioned to an editable status.
On resubmission, a line amount may only be scaled downward, keeping edits controlled and auditable.
### 2.9. Preview Provider Claim
Shows the claim as the provider sees it, before payer review, so issues can be caught and corrected early.
### 2.10. Preview Payer Claim
Shows how the payer will see and adjudicate the claim, giving visibility into status and payer actions.
### 2.11. Resubmit Claim
Transitions a claim returned by the payer into an editable status so lines, diagnoses and attachments can be corrected and the claim re-submitted.
## 3. How Workflows Connect: The Power of Interdependency
While each workflow has a specific role, they are all interconnected, creating a system for claim management. They show interdependency in the following ways:
- Consistent Patient Context: Every workflow requires a consent_token, ensuring that all billing actions are performed within the context of a valid and active patient visit.
- Intervention-Centric Operations: Diagnoses and attachments are consistently linked to specific intervention_codes within the claim. This ensures that supporting information directly relates to the services provided.
- Claim-Level Integrity: invoice_number and line_id (or line_number) ensure that line item modifications (add/remove lines) accurately target specific entries on a given invoice/claim.
- Cascading Validations: The financial validations checks for "Add new line" workflow influence the allowed financial amounts, ensuring that additions adhere to established financial policies. Similarly, removing lines has specific validations that prevent invalid operations (e.g., removing per diem interventions).
## 4. Key Success Factors for Overall Billing Workflows Integration
For your integration with the entire Billing Workflows process to be successful and efficient, keep these overarching principles in mind:
- Accurate consent_token Usage: Always provide the correct and active consent_token for the patient visit to authorise any billing modification.
- Adherence to Validations: Understand and implement logic to respect the various validations (e.g., financial limits, scheme codes, per diem rules) specified for each workflow. Proactively validating data on your end can reduce rejections.
- Correct Identifier Usage: Ensure accurate use of unique identifiers like invoice_number, line_id, attachment_id, and intervention_code to target the correct entities for modification.
- Understanding Document and Diagnosis Types: For "Add Attachment" and "Add Diagnosis," be aware of the specific types and codes accepted by the system to ensure successful uploads and linkages.
By understanding and adhering to these factors, you can ensure a smooth, accurate, and effective integration with the Billing Workflows.
## 5. Related Resources
- Adding a Claim Doctor
- Adding Attachments
- Claim Resubmission
- PMF Tariffs
- Scenario 1: SHIF IP Per Diem
- Scenario 2: SHIF IP FFS Normal Preauth
- Scenario 3: SHIF IP FFS Elective Preauth
- eClaims API Reference
Last modified on September 28, 2026
