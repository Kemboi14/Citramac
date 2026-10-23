# Emergency Case Claims Process Overview: Capturing Emergency Care Under ECCIF
## 1. Introduction: Understanding Emergency Case Claims
Welcome to the Emergency Case Claims process. This guide provides a high-level overview of how the HIE manages claims for patients who present for emergency care, from the moment a visit is initiated through to claim submission.
Emergency case claims are a distinct claim type. They are not handled like the usual capitation, outpatient, or inpatient claims. Emergencies are time-critical and often begin before a patient can be fully identified, so the flow is purpose-built to let providers start care first and reconcile the administrative detail as the case unfolds. These claims are funded by SHA's Emergency, Chronic and Critical Illness Fund (ECCIF), a dedicated fund that caters specifically for emergency interventions.
At its core, the process moves a provider from an emergency presenting at the facility to a fully documented, billed, and submitted claim under ECCIF - even when the patient's identity is unknown at the start.
### One intervention per emergency claim
An emergency case claim is restricted to a single intervention. Each emergency claim covers exactly one intervention (and its protocols); you cannot bundle multiple interventions onto one emergency claim.
### 1.1. Why This Full Process Matters
A reliable emergency claims process is fundamental to ensuring patients receive immediate care without administrative delay, while still allowing the facility to be reimbursed correctly. It is crucial because it:
- Prioritises Care Over Paperwork: It lets a facility initiate an emergency visit and begin treatment even when the patient cannot yet be identified, then identify them later.
- Bills Care Accurately Under ECCIF: Emergency interventions are reimbursed against approved protocols, each with its own SHA-approved amount, ensuring the facility claims the correct value for the care given.
- Supports Both Identified and Unidentified Patients: It provides a clear path for the common emergency reality where a patient arrives unconscious, alone, or without documents.
- Enforces Timely Submission: It builds in SHA's emergency claim rules, including the requirement to submit the claim within 24 hours, protecting the facility's ability to be paid.
## 2. The Full Emergency Case Claims Journey: Step-by-Step Emergency Reimbursement
The emergency process is a multi-step journey. Unlike a standard visit, it can begin without a confirmed patient identity and resolve that identity later. Here are the key workflows in their typical order:
### 2.1. Step 1: Create an Emergency Case Claim
- What it does: This is the foundational first step. It initiates the emergency visit by creating the claim, capturing the single intervention being treated, the mode of arrival, who brought the patient, and the attending practitioner's details. It supports two scenarios - an identified patient (where beneficiary_cr_id and patient otp are supplied) and an unidentified patient (where they are not).
- Why it's crucial here: It is what allows care to be initiated and recorded under ECCIF from the very first moment, regardless of whether the patient is known.
- Output: An authorization_code (used as the consent_token) that anchors every subsequent step of the claim.
### Practitioner details trigger a doctor consent request
The attending practitioner details you provide at creation cause a doctor consent request to be sent to that doctor via OTP (request_type: EMERGENCY_CLAIM_DOCTOR_APPROVAL_REQUEST). If the doctor does not see the request, the provider can re-send it using the Resend Doctor Consent workflow.
### 2.2. Step 2: Get Emergency Case Protocols
- What it does: Retrieves the approved protocols for a given emergency intervention. Emergency interventions are billed by protocol, not by free-form line items. Each protocol carries its own code and its own SHA-approved amount.
- Why it's crucial here: It tells the provider exactly which actions are reimbursable for an intervention, and at what value, before anything is billed.
- Output: A list of protocols (for example, for intervention SHA-01-005 - Shock states - protocols such as Chest X-Ray, Electrocardiogram, and Resuscitation), each with its protocol code and applicable tariff.
### 2.3. Step 3: Add Emergency Case Protocols
- What it does: Adds the protocols actually performed to the claim. You can add just the protocol (the billable line) or add combined protocol details - the protocol together with its billing detail (diagnoses, attachments, and amounts).
- Why it's crucial here: This is where the care delivered is turned into reimbursable value on the claim. Attachments are required at the intervention level and must use the document types declared in the intervention's applicableDocumentTypes.
- Output: Billed protocol lines on the emergency claim.
### 2.4. Step 4: Manage Attending Doctors
- What it does: Manages the doctors on the claim before submission. If a doctor added at creation rejected or no longer wants to be on the claim, you can remove them, then add a new doctor. You can also resend the doctor consent request if the doctor did not see the original OTP request. These actions can happen at any point before submission.
- Why it's crucial here: A valid attending doctor with consent is needed for the emergency claim, so being able to swap doctors and re-send consent keeps the claim progressing.
- Output: The emergency claim with the correct attending doctor(s) and their consent request(s) sent.
### 2.5. Step 5: Identify an Unknown Emergency Patient
- What it does: For claims created for an unidentified patient, this resolves the patient's identity once they have been recognised. It re-uses the create-emergency-claim call with the patient's beneficiary_cr_id and otp added, plus the consent_token of the originally-unknown claim.
- Why it's crucial here: It moves the claim from an unknown patient to a known patient with their details, which is required for full reimbursement.
- Output: The same emergency claim, now linked to a confirmed patient.
### 2.6. Step 6: Submit the Emergency Case Claim
- What it does: Submits the completed emergency claim to SHA, whether the patient ended up identified or remains unidentified. An unidentified submission carries a reason_for_unknown_patient.
- Why it's crucial here: It is the final, time-sensitive step. SHA requires emergency claims to be submitted within 24 hours.
- Output: A submitted emergency claim under ECCIF.
## 3. How Workflows Connect: The Power of Interdependency
While each workflow has a distinct role, they form one continuous emergency case. Data flows from one step to the next:
- Single Anchoring Token: Creating the claim returns an authorization_code that is used as the consent_token for adding protocols, identifying the patient, and submitting. Every later action depends on it.
- Protocol-Driven Billing: The protocols you can add (Step 3) are exactly those returned by the protocol lookup (Step 2) for the intervention chosen at creation (Step 1). Billing amounts are validated against each protocol's approved tariff.
- Identity Resolved In-Flight: A claim created as unidentified (Step 1) can be carried through billing and only later linked to a real patient (Step 4), or submitted as unidentified (Step 5) - the same consent_token follows the case throughout.
- Doctor Consent via OTP: Providing the attending practitioner's details sends a doctor consent request to that doctor by OTP. Doctors can be added or removed, and the consent request re-sent, all against the same consent_token before submission.
- OTP-Only Consent: Emergency consent is handled through OTP. There is no biometrics step and no discharge OTP in the emergency flow, which keeps the path short and fast for time-critical care.
## 4. Key Success Factors for Overall Emergency Case Claims Integration
For your integration with the Emergency Case Claims process to be successful, keep these principles in mind:
- Carry the consent_token Throughout: Capture the authorization_code from claim creation and re-use it as the consent_token for every subsequent call.
- Resolve Protocols Before Billing: Always fetch the approved protocols and their tariffs for the intervention before adding protocol lines, and bill within the approved amount.
- Attach at the Intervention Level: Provide attachments using the document types listed in the intervention's applicableDocumentTypes.
- Plan for Both Identity Paths: Build for the unidentified case from the start - create without beneficiary_cr_id, then identify the patient later when possible.
- Submit Within 24 Hours: Treat the 24-hour SHA submission window as a hard requirement to avoid losing reimbursement.
By understanding and adhering to these principles, you can ensure a smooth, accurate, and timely integration with the Emergency Case Claims process under ECCIF.
## 5. Related Resources
- Create an Emergency Case Claim
- Get Emergency Case Protocols
- Add Emergency Case Protocols
- Add a Doctor to an Emergency Case Claim
- Remove a Doctor from an Emergency Case Claim
- Resend Doctor Consent
- Identify an Unknown Emergency Patient
- Submit an Emergency Case Claim
- Claims & Preauths API Reference
Last modified on September 28, 2026
