# Preauths Process Overview: Obtaining Prior Authorisation for Healthcare Services
## 1. Introduction: Understanding Pre-Authorisation
Welcome to the Preauths Process! This comprehensive guide provides a high-level overview of how our system facilitates the important step of obtaining prior authorisation for specific healthcare services.
Pre-authorisation is a key requirement for certain medical interventions, ensuring that the Social Health Authority (SHA) reviews and approves payment for a service before it is rendered to a patient.
The Preauthorisation Process is a series of workflows designed to facilitate the submission, review, and approval of requests for specialised or high-cost healthcare services. It involves submitting detailed medical information to the SHA for their assessment and decision, ultimately determining whether a patient's planned treatment will be covered.
### 1.1. Why This Full Process Matters
An accurate and thorough Pre-Auth process helps ensure financial coverage, compliance, and appropriate utilisation of healthcare services. It is crucial because it:
Ensures Financial Coverage: Guarantees that high-cost, specialised, or planned interventions receive prior approval from SHA, providing financial assurance for both the patient and the healthcare facility.
Prevents Claim Rejections: By obtaining pre-authorisation upfront, it significantly reduces the likelihood of claims being rejected by SHA due to a lack of prior approval, protecting the facility's revenue.
Efficient use of medical funds: SHA's review process helps ensure that services are medically necessary and appropriate, contributing to the efficient use of healthcare funds and preventing unnecessary expenditures.
Promotes Clinical Compliance: The requirement for detailed clinical information and the doctor's consent facilitates a review of the medical necessity of the proposed intervention, enhancing the quality of care.
Streamlines Service Delivery: With pre-authorisation in place, facilities can proceed with planned treatments with confidence, minimising administrative delays and patient uncertainty regarding coverage.
## 2. The Preauths Process: Available Workflows
The Preauths Process is made up of several workflows, each designed to handle a different scenario for obtaining SHA approval. These workflows are independent and available on demand - they are not steps that must be performed in a fixed order. You choose the workflow that matches the intervention and the timing of the request (for example, a standard same-day request versus a planned pre-visit request).
Here are the key types of preauthorization requests and the associated workflows:
### 2.1. Normal Preauths
This workflow handles the submission of a standard general preauthorization request for a single intervention or a set of related interventions that require prior approval from SHA.
It's the most common pathway for obtaining approval for a wide range of services, ensuring compliance with routine pre-authorised care.
### 2.2. Elective Preauthorization
This workflow manages the submission of preauthorization requests for elective procedures, which are planned and scheduled in advance. These preauthorizations involve obtaining approval before the patient's actual visit, ensuring that the procedures receive the necessary prior authorisation. This process allows patients and facilities to confirm financial coverage, enabling them to schedule and prepare accordingly.
### 2.3. Specialised Preauth Forms
Beyond the general request types, certain types of preauths have specific workflows for creating detailed records for specialised medical areas. These forms capture the unique clinical and service details required for SHA's review. These include:
- Surgical Preauth: For planned surgical procedures.
- Renal Preauth: For kidney-related treatments, often involving dialysis sessions.
- Oncology Preauth: For cancer diagnosis and treatment plans.
- Imaging Preauth: For specialised diagnostic imaging services (e.g., MRI, CT scans).
- Optical Preauth: For eye-related services, including consultations and optical items.
Note: Each of these specialised preauth forms serves as the detailed input for one of the various preauthorization request types (Normal or Elective), depending on the nature of the service.
### 2.4. Identifying Special Preauths
Most interventions use the general Normal or Elective preauth payload. Some interventions, however, require a special preauth form that captures extra clinical fields specific to a medical area - surgical, renal, oncology, optical, and imaging.
An integrator does not guess which form applies. The intervention coverage response returned when looking up the patient's benefits and interventions (via GET /api/v1/patients/benefits/interventions) carries the flags that answer all three questions:
 | Question | Field
 | Does this intervention need a preauth at all? | needsPreauth
 | Is it normal or elective? | needsManualPreauthApproval - true means elective, approved before the visit
 | Does the doctor have to approve it? | needsDoctorAuthorization - true means the consent request is sent automatically when the preauth is created
The same response also indicates the specialised category the intervention falls under, and that category tells you which special form to use:
- A surgical intervention uses the Surgical Preauth form.
- A renal intervention (for example dialysis) uses the Renal Preauth form.
- An oncology intervention uses the Oncology Preauth form.
- An optical intervention uses the Optical Preauth form.
- An imaging intervention uses the Imaging Preauth form.
If the intervention does not fall into any of these specialised categories, use the general Normal or Elective preauth payload.
## 3. How Workflows Connect
While each workflow within the Preauths Process has a distinct role, they are deeply interconnected:
Foundation from Eligibility & Intervention Coverage: The decision to initiate a preauth request typically stems from the Eligibility Process (identifying a patient's general coverage) and the Intervention Coverage Process (identifying specific services that require pre-authorisation).
Authorisation Token: The token used depends on the preauth type:
- For normal preauths: the consent_token comes from an active patient visit, created via POST /api/v1/claims/visit.
- For elective preauths: the token comes from a pre-visit authorization object, created via POST /api/v1/claims/authorize before any visit exists. See Pre-Visit Authorization for how this authorization is obtained.
Detailed Clinical Data: Preauth workflows require comprehensive clinical information, diagnoses, and proposed items/interventions. This data is often prepared by clinical staff and forms the core of the preauthorization request.
Doctor's Consent: Many interventions explicitly require approval from the attending doctor or clinical officer, ensuring medical oversight and accountability. Whether yours does is the intervention's needsDoctorAuthorization flag, and when it is true the request is sent automatically as the preauth is created - see Preauth Doctor Consent.
Attachments: The ability to include supporting documents (attachments) is common across various preauth types, providing necessary evidence for SHA's review. Which documents are required is a property of the intervention - read requiredPreauthDocumentTypes from intervention coverage, and see Adding Attachments.
Elective approvals expire: An elective preauthorization approved but never used expires 7 days after approval. Cancel one you will not use rather than letting it lapse - see Elective Preauthorizations.
Outcome Dictates Service Delivery: The outcome of a preauthorization (approved, rejected, or more info requested) directly dictates whether the proposed service can proceed and be covered by SHA. This outcome then influences subsequent steps in the patient's care journey and the facility's claiming process.
## 4. Related Resources
- Intervention Coverage - the flags that decide which preauth path applies.
- Special Benefit Rules - whether a preauthorization is required at all is a per-package rule, and it differs between SHIF and POMSF covers.
- Preauth Doctor Consent - resending a doctor request that did not arrive.
- Adding Attachments - reading required documents off the intervention.
- Cancel Preauthorization - releasing an approval that will not be used.
## 5. Related Scenarios
- Scenario 2: SHIF IP FFS Normal Preauth
- Scenario 3: SHIF IP FFS Elective Preauth
- Scenario 4: SHIF OP FFS Elective Preauth
- Scenario 5: SHIF OP FFS Normal Preauth
Last modified on September 28, 2026
