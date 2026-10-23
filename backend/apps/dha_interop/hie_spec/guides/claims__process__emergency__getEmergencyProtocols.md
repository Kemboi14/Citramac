# Emergency Case Claims Process Guide: Get Emergency Case Protocols Workflow
## 1. Overview: Discovering What Can Be Billed for an Emergency Intervention
This guide focuses on the Get Emergency Case Protocols workflow, a key lookup step in the Emergency Case Claims Process. In emergency care, billing works differently from other SHA interventions: emergency interventions are billed by protocol. This workflow retrieves the approved protocols for an intervention, so you know exactly what may be billed and at what value before adding anything to the claim.
### 1.1. What This Workflow Does
The Get Emergency Case Protocols workflow fetches the approved protocols for a given emergency intervention from GET /api/v1/claims/emergency/protocols. Each emergency intervention has its own approved list of protocols - the different actions that may be offered to the patient - and each protocol carries its own protocol code and its own SHA-approved amount (tariff).
For example, the intervention SHA-01-005 (Shock states) may offer protocols such as Chest X-Ray, Electrocardiogram, and Resuscitation, each with its own protocol code and the amount SHA will pay for it.
### 1.2. Why This Workflow Is Critical (The "Why It Matters")
Knowing the approved protocols before billing prevents rejected lines and incorrect claims:
- Protocol-Based Billing: Emergency interventions are reimbursed per protocol, not by free-form line items. You can only bill protocols that are approved for the intervention.
- Correct Amounts: Each protocol has an approved tariff. Knowing it up front lets you bill within the approved value.
- Valid Attachments: The intervention attached to a protocol declares the document types it accepts (applicableDocumentTypes), which you will need when adding combined protocol details.
In short, this workflow is the reference step that makes the Add Emergency Case Protocols step accurate.
## 2. Workflow Details: Get Emergency Case Protocols
### 2.1. Workflow Description: Step-by-Step System Behavior
When a request for emergency protocols comes into the system, here is what unfolds:
- Input Reception: The system receives the intervention_code to look up and the active filter.
- Protocol Lookup: The system finds the protocols approved for that intervention.
- Response Assembly: The system returns the matching protocols, each with its protocol code, name, and applicable tariff, along with the intervention details (including the accepted document types for attachments).
### 2.2. Key Validations: Our System's Essential Checks
- Valid Intervention Code:
- What it means: The intervention_code query parameter must be a recognised emergency intervention.
- Why it's important: Protocols are defined per intervention; an unknown code returns no protocols.
- Active Filter:
- What it means: The active parameter controls whether only currently-active protocols are returned.
- Why it's important: Billing should use protocols that are currently approved and active.
### 2.3. Workflow Data Dictionary: What Information We Work With
Query parameters
 | Field Name | Description | Data Type | Required | Purpose
 | intervention_code | The emergency intervention to fetch protocols for. | string | Yes | Specifies which intervention's approved protocols to return.
 | active | Whether to return only active protocols. | boolean | Yes | Limits results to currently-approved protocols.
Key response fields (per protocol)
 | Field Name | Description | Purpose
 | protocolCode | The unique code for the protocol. | Used as protocol_code when adding the protocol to the claim.
 | name | The human-readable protocol name (for example, Chest X-Ray). | Identifies the action offered to the patient.
 | applicableTariff | The SHA-approved amount for the protocol. | The value you may bill for this protocol.
 | intervention.applicableDocumentTypes | The document types accepted for this intervention. | The allowed document_type values when attaching supporting files.
### 2.4. Expected Outcomes from this Workflow
- Success: A list of approved protocols for the intervention is returned, each with its protocol code and applicable tariff.
- Outcome: No protocols returned - the intervention_code is unknown, or no active protocols exist for it.
### Resolve protocols before you bill
Always fetch the approved protocols and their applicableTariff for the intervention before calling Add Emergency Case Protocols. Billing a protocol that is not approved for the intervention, or above its approved amount, will be rejected.
## 3. Worked Example: Intervention SHA-01-005 (Shock states)
 | Protocol (name) | Protocol Code | Approved Amount
 | Chest X-Ray | {{protocol_code}} | as per applicableTariff
 | Electrocardiogram | {{protocol_code}} | as per applicableTariff
 | Resuscitation | {{protocol_code}} | as per applicableTariff
Each intervention exposes its own protocol list. Use the protocol code and approved amount from the response when adding protocols to the claim.
## 4. Critical Success Factors for Get Emergency Case Protocols Integration
- Look Up Before Billing: Always retrieve protocols for the intervention before adding protocol lines.
- Use the Returned Codes and Tariffs: Bill using the exact protocolCode and within the applicableTariff returned.
- Read the Accepted Document Types: Note the intervention's applicableDocumentTypes for use when attaching supporting documents.
## 5. Related Resources
- Emergency Case Claims Process Overview
- Create an Emergency Case Claim
- Add Emergency Case Protocols
- Claims & Preauths API Reference
Last modified on September 28, 2026
