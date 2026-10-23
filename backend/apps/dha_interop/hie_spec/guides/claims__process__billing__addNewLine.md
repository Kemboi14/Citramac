# Billing Workflows Process Guide: Add new line Workflow
## 1. Overview: Adding Billable Items to a Claim
This guide focuses on the Add new line workflow, which is an essential step in the broader Billing Workflows Process. Think of it as the mechanism for ensuring all services and items provided during a patient's visit are accurately recorded and billed. This workflow's main work is to incorporate new, valid billable items into an existing patient claim.
### 1.1. What This Workflow Does
The Add new line workflow's main function is to append a new invoice line item, representing a billable service or product, to a patient's current claim. It receives specific details about the item, its cost and quantity, then applies a series of validations to append it.
### 1.2. Why This Workflow Is Critical (The "Why It Matters")
Getting billable items added right from the beginning is important for accurate financial management and claim processing. The workflow is therefore essential in the following ways:
- Accurate billing and revenue collection: It ensures that services or items are properly added with the right information, making sure that the facility will be properly reimbursed for care provided to a patient.
- Claim Acceptance: Correct and compliant line items (for example, not exceeding tariffs) lead to the claim being accepted by the payer.
- Financial Accuracy: Accurate billing leads to matches between services rendered and payments received, leading to easy reconciliation and correct financial records.
- Audit compliance: Having the proper documentation for each billable item makes claims easily audited and provides transparency and visibility.
In short, this workflow is the foundation for accurate claim amounts. It ensures that every subsequent step of the Billing Workflows Process is built on the right financial information.
### Optional doctor details can be attached here
You may supply the three optional practitioner fields (practitioner_identification_type,
practitioner_identification_number, practitioner_regulation_body) on this call. A standard claim
requires only one doctor, and it can be attached through any one of add line, add diagnosis, or
start visit - not all three. See Adding a Claim Doctor.
## 2. Workflow Details: Add new line
### 2.1. Workflow Description: Step-by-Step System Behavior
When a request to add a new bill item to a claim comes into our system, here's the internal process that unfolds:
Input Reception: The system first receives the consent_token for the active patient visit, along with details of the new line item: intervention_code, unit_price and quantity, plus optional diagnoses, service_name, service_identifier, attachments, and the optional practitioner fields.
Visit and Consent Validation: The system immediately validates the provided consent_token to confirm that the patient's visit is still active/open and that the consent is valid.
Financial and Scheme Validation:
- The system calculates the total bill amount for the new line item (and the cumulative claim).
- It checks that the bill amount is within the keph level tariff or the overall tariff.
- If the patient is covered under the POMSF (PMF) scheme, it verifies that the bill amount is within the PMF balance + ex gratia. POMSF applicability is determined from the patient's eligibility, not from a scheme code you send. See PMF Tariffs for how POMSF tariffs are resolved.
- If the intervention_code is a 'per diem' intervention, the endpoint does not add a line - the per-diem line is added automatically. Instead it verifies the amount you input against the tariff, factoring in the number of days stayed.
Item Addition: If all validations pass, the system proceeds to add the new line item to the patient's claim, associating it with the specified intervention_code.
### 2.2. Key Validations: Our System's Essential Checks
There are some essential checks our system performs behind the scenes to ensure a successful and accurate "Add new line" operation. Understanding these helps you provide the correct information from your end, preventing errors.
Active Visit/Consent Validation:
The consent_token provided must correspond to a patient visit that is currently open and active.
Bill Amount vs. Tariff/Balance Validation:
The financial amount must adhere to the maximum allowed tariffs or, for POMSF-covered patients, the available PMF balance + ex gratia.
POMSF (PMF) Applicability:
Whether PMF validation applies is determined by whether the patient is covered under the POMSF scheme, as returned by eligibility - not by a scheme code you send. See PMF Tariffs.
Per Diem Intervention Handling:
If the intervention_code indicates a 'per diem' service, this endpoint does not add a line (the per-diem line is added automatically). It instead verifies the amount you input against the tariff, factoring in the number of days stayed.
### 2.3. Workflow Data Dictionary: What Information We Work With
 | Field Name | Description | Data Type | Required | Purpose
 | consent_token | The consent token for the patient visit. | string | Yes | Authorises the billing action for the correct patient and active visit.
 | intervention_code | The code for the intervention you are trying to add. | string | Yes | Specifies the particular service or item being billed.
 | unit_price | The unit price charged for this item. | float (2dp) | Yes | Defines cost per unit of service/item.
 | quantity | Quantity of the item. | float (2dp) | Yes | Number of units provided.
 | diagnoses | Diagnoses to associate with the line. | array | No | Links medical justification to the billed intervention.
 | service_name | Human-readable name of the service being billed. | string | No | Descriptive label for the line item.
 | service_identifier | Provider-side identifier for the service. | string | No | Cross-references the line to internal service records.
 | attachments | Supporting documents to attach to the line. | array | No | Substantiates the billed intervention (see below).
 | practitioner_identification_type | How the attending practitioner is identified. | string | No | Part of the optional doctor details (one doctor per claim).
 | practitioner_identification_number | The practitioner identifier value. | string | No | Part of the optional doctor details.
 | practitioner_regulation_body | The regulator the practitioner is registered with. | string | No | Part of the optional doctor details.
### Lines can carry attachments
This line can carry attachments, uploaded as raw binary multipart parts. See
Adding Attachments for the full mechanics and the two upload
patterns.
### 2.4. Expected Outcomes from this Workflow
When you query this workflow, here's what you can expect in return:
- Success: Line Item Added to Claim - the system adds the item and passes all validations.
- Failure: Invalid Visit/Consent - the consent_token is invalid, expired, or visit is closed.
- Failure: Financial Limit Exceeded - the unit_price or total bill exceeds the allowed tariffs or, for POMSF-covered patients, the available PMF balance + ex gratia.
- Failure: Per Diem Amount Mismatch - for a per-diem intervention the amount you input does not match the tariff for the number of days stayed.
- Failure: Missing Required Data - any required field (consent_token, intervention_code, unit_price, quantity) is missing or malformed.
## Related resources
- Multiple procedures in one theatre visit - the primary procedure bills at the full tariff and the secondary at 50 percent.
- Inpatient Benefit Rules - per-diem lines are auto-generated from the accrued days rather than billed by hand.
- Special Benefit Rules - the rules behind the financial-limit and per-diem validations above.
- PMF Tariffs - resolving the amount before you bill it.
Last modified on September 28, 2026
