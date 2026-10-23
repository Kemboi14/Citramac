# Claim Dispatch / Visit End Process Overview: Finalizing Patient Claims and Encounters
## 1. Introduction: Understanding Claim Dispatch / Visit End
This comprehensive guide provides a high-level overview of how our system manages the crucial final steps of a patient's visit and the associated billing. This process is the formal conclusion of a healthcare encounter.
The Claim Dispatch / Visit End is a series of interconnected steps designed to ensure that all services are accounted for, the patient's record is properly closed, and the claim is ready for submission to the Social Health Authority (SHA). It's about moving from an active, open visit to a finalised, dispatched claim.
### 1.1. Why This Full Process Matters
A robust and accurate Claim Dispatch / Visit End process is fundamental to efficient, fair, and compliant healthcare delivery. It is crucial because it:
- Ensures Financial Accuracy: Verifies that a claim is complete and accurate before it is dispatched, which reduces the risk of payment delays or denials.
- Maintains Record Integrity: Guarantees that a patient's visit record is officially and correctly closed, preventing future administrative confusion and ensuring accurate health records.
- Adheres to Regulatory Compliance: Follows all necessary procedures, such as getting patient confirmation via OTP or biometrics when discharging both inpatient and outpatient encounters, and attaching a death certificate to the claim in deceased-patient scenarios.
- Streamlines Operations: Automates the finalisation of claims, reducing the administrative burden on providers and enabling more efficient payment processing.
## 2. The Full Claim Dispatch / Visit End Journey: Step-by-Step Encounter Closure
The complete Claim Dispatch / Visit End is a multi-step journey, with each workflow building upon the results of the previous one. It consists of a series of workflows, each focused on a different aspect of the claim's finality. The process includes obtaining any necessary consent for discharging both inpatient and outpatient encounters, via OTP or biometrics, and also allows a claim to be closed instead of dispatched.
Here are the dispatch workflows:
### 2.1. Step 1: Outpatient claim dispatch
This workflow verifies the patient's consent before submitting the claim and formally ending the visit. Consent can be obtained via a One-Time Password (OTP) sent to the patient's registered contact, or via a biometrics authorization using fingerprint matching.
This specific step is vital for ensuring that the patient acknowledges and consents to the end of their visit, which is an important validation for the claim's integrity and compliance.
An outpatient visit can also be discharged in two stages, so the patient can leave before the facility has finished assembling clinical documentation. See Partial and Full Discharge.
### 2.2. Step 2: Inpatient claim dispatch
This workflow handles the process of an inpatient's discharge. Discharge consent can be obtained via OTP or via biometrics authorization. It also includes a conditional step to ensure a death certificate is attached to the claim if the patient's discharge reason is "DECEASED".
This specific step is vital for ensuring that all necessary post-visit actions for an inpatient are completed, which includes data collection and, in sensitive cases, attaching the required death certificate to the claim.
### 2.3. Step 3: Close Claim
This workflow terminates a claim that is not scheduled for submission to the payer, changing its status to CLOSED. It is used when a provider decides not to proceed with a claim rather than dispatching it, and records a documented cancellation reason.
## 3. Key Success Factors for Overall Claim Dispatch / Visit End Integration
For your integration with the entire Claim Dispatch / Visit End process to be successful and efficient, keep these points in mind:
Provide Correct consent_token: The consent_token is the key that unlocks all actions in this process. Ensuring its validity and correctness is paramount.
Accurate Patient Contact Data: For outpatient claims, the process critically depends on having valid beneficiary contacts to send the OTP. Without this, the visit cannot be finalised.
Precise discharge_reason: For inpatient claims, the discharge_reason field is not just a label; it is a critical trigger for conditional logic. Correctly populating this field ensures that the appropriate subsequent steps (e.g., attaching a death certificate to the claim when the reason is DECEASED) are completed.
By understanding and adhering to these key points, you can ensure a smooth, accurate, and effective integration with the Claim Dispatch / Visit End process.
## 4. Related Guides and Scenarios
- Inpatient Claim Dispatch Guide
- Outpatient Claim Dispatch Guide
- Close Claim
- Partial and Full Discharge
- The Deceased Patient Workflow
- Scenario 1: SHIF IP Per Diem
- Scenario 2: SHIF IP FFS Normal Preauth
Last modified on September 28, 2026
