# Eligibility Process Guide: Benefits Coverage Workflow
## Eligibility Process Guide: Benefits Coverage Workflow
### 1. Overview: Understanding Patient Entitlements
This guide outlines the Benefits Coverage workflow (GET /patients/benefits), an essential part of the Eligibility Process. Once a patient has been accurately identified and confirmed eligible, this stage retrieves the top-level benefits (parent packages) the patient is entitled to at the facility. This determination is based on the patient's biodata, their SHA coverage, whether they are a civil servant, and the facility context. All of this information is cross-checked against the rules established by the Social Health Authority (SHA).
1.1. The Benefit Hierarchy
SHA coverage is structured as a three-level hierarchy. This workflow returns the parent level; you drill down from there:
- Benefit (parent): The highest-level package, e.g., inpatient or outpatient. Returned by this endpoint, GET /patients/benefits.
- Sub-benefit: A breakdown of a benefit by common characteristics, e.g., emergency services. See Sub-Benefits Coverage (GET /patients/sub-benefits).
- Intervention: The specific covered healthcare service, each with its own limits and tariffs. See Intervention Coverage.
1.2. What This Workflow Does
The Benefits Coverage workflow dynamically cross-checks information on the patient and facility against the eligibility rules and then retrieves the parent benefits a patient is eligible for. It does this by taking several key pieces of information:
- Patient Details: Crucial information like their age, gender, and especially their coverage status with SHA.
- Facility Context: Information about the healthcare facility where the service is to be provided, such as its ownership (e.g., public, private), its KEPH level, licensure, and SHA contract status.
The system applies a set of rules from the SHA benefit matrix - essentially a rulebook that dictates which packages are covered under various patient and facility conditions.
### Where facility context comes from
You do not pass the facility as an ordinary request field. The facility context is taken from the X-Facility-Id and X-Facility-Id-Type request headers (or from the JWT when it carries facility claims). See Facility Identification for how to supply facility context.
1.3. Why This Workflow Is Critical
- Risk of Uncovered Services: Prevents patients from incurring unexpected costs.
- Financial Loss for Providers: Avoids services for which facilities won't be reimbursed.
- Regulatory Non-Compliance: Ensures adherence to SHA policies.
- Improved Patient Experience: Patients know what they are entitled to upfront.
### 2. Benefit Matrix Overview
SHA coverage is organised into funds (PHC, SHIF, ECCIF), schemes (UHC, POMSF), and payment mechanisms (capitation, per diem, fee for service, fixed fee for service, case-based). The full overview - including the benefit packages, their SHA-NN / PMF-NN codes, and the code-combination rules - lives in the Benefit Matrix guide, which is the single source for this reference.
### 3. Workflow Details: Benefits Coverage
3.1. Workflow Description
- Input Reception: Takes the Client Registry ID (CR ID) of the patient. Facility context is read from the X-Facility-Id / X-Facility-Id-Type headers (or the JWT).
- Internal Data Retrieval: Fetches full patient profile and facility details.
- Rule Application: Applies the SHA benefit matrix:
- Patient vs benefit categories.
- Facility vs licensed services.
- Benefit Determination: System compiles the eligible parent benefits.
- Outcome Delivery: Returns the list of benefits, each of which can be expanded into sub-benefits and interventions.
3.2. Key Validations
- CR ID is Mandatory: Identifies the patient and their eligibility.
- Facility Context Must Be Present and Recognised: Supplied via the X-Facility-Id / X-Facility-Id-Type headers or the JWT; the facility identifier type must be a known value (e.g., fr-code, registration-number).
- Valid Age and Gender: Needed for SHA age- and gender-based rules.
- CR Only Source for Patient Data: Ensures single source of truth.
- Facility Must Meet SHA Criteria: Includes KEPH level, ownership, contract status.
3.3. Workflow Data Dictionary
 | Field Name | Description | Data Type | Required | Purpose
 | Beneficiary Client Registry ID | Unique patient identifier from Patient Search | String | Yes | Used to retrieve profile and apply rules
 | X-Facility-Id (header) | Unique ID for the health facility, supplied as a request header (or via the JWT) | String | Yes | Required to determine eligible benefits
 | X-Facility-Id-Type (header) | e.g., fr-code, registration-number, supplied as a request header (or via the JWT) | String | Yes | Helps the system interpret the facility ID
3.4. Expected Outcomes
- Successful Retrieval of Benefits: Patient is eligible, list of parent benefits returned.
- No Benefits Found: Valid patient/facility but no matched benefits.
- Input Error: Invalid or missing data prevented execution.
### 4. Reading the Response
4.1. Sample Response
Each result is a parent benefit package the patient is entitled to at this facility. A typical response
carries around a dozen of them:
Code 
{
  "count": 11,
  "next": null,
  "previous": null,
  "pageSize": 10000,
  "currentPage": 1,
  "totalPages": 1,
  "startIndex": 1,
  "endIndex": 11,
  "results": [
    { "parentBenefit": "Ambulance & Emergency services", "parentBenefitCode": "SHA-01" },
    { "parentBenefit": "Critical Care Services", "parentBenefitCode": "SHA-03" },
    { "parentBenefit": "Inpatient Services", "parentBenefitCode": "SHA-07" },
    { "parentBenefit": "Surgical Services", "parentBenefitCode": "SHA-19" }
  ]
}
4.2. Response Fields
 | Field | What it means
 | parentBenefit | The human-readable name of the benefit package. Safe to display to end users.
 | parentBenefitCode | The SHA benefit code, e.g. SHA-19. This is the value you carry into the next call.
The response is wrapped in the standard pagination envelope used across the API: count, pageSize,
currentPage, totalPages, startIndex, endIndex, next and previous. This endpoint returns a
small list, so a single page is normal.
4.3. What to Do With It
### This list is the boundary of what is billable
Nothing outside the benefits returned here is billable for this patient at this facility. Treat the
response as the authoritative universe for the rest of the visit rather than filtering a local copy of
the benefit matrix.
parentBenefitCode is the key that unlocks the next level. Pass it as the parent_benefit_code query
parameter on Sub-Benefits Coverage:
Code 
GET /patients/sub-benefits?patient_id={crId}&parent_benefit_code=SHA-19
That call returns the sub-packages under the benefit, and each of those in turn leads to the billable
interventions. The full walk is set out in
Eligibility Process.
### 5. Critical Success Factors for Benefits Coverage Integration
- Supply Facility Context Correctly: Ensure the X-Facility-Id / X-Facility-Id-Type headers (or JWT facility claims) are present and accurate on every request. See Facility Identification.
- Keep the CR ID Current: Use the latest beneficiary CR ID from Patient Search.
- Drill Down as Needed: Use the returned benefits to query Sub-Benefits Coverage and then Intervention Coverage.
- Handle "No Benefits Found" Gracefully: Design for fallback messaging or user alerts.
## 6. Related Resources
- Benefit Matrix
- Special Benefit Rules
- Sub-Benefits Coverage
- Intervention Coverage
- Eligibility Check Workflow
- Facility Identification
Last modified on September 28, 2026
