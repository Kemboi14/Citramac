# Eligibility Process Guide: Sub-Benefits Coverage Workflow
## Eligibility Process Guide: Sub-Benefits Coverage Workflow
### 1. Overview: Understanding Patient Entitlements
This guide outlines the Sub-Benefits Coverage workflow (GET /patients/sub-benefits), an essential part of the Eligibility Process. Once a patient has been accurately identified and confirmed eligible, this stage determines the specific sub-benefits (healthcare service categories) they are entitled to receive. This determination is based on the patient's biodata, their SHA coverage, whether they are a civil servant, and the facility context. All of this information is cross-checked against the rules established by the Social Health Authority (SHA).
Sub-benefits sit in the middle of the coverage hierarchy: a benefit (parent) breaks down into sub-benefits, and each sub-benefit contains interventions. To see the parent level, refer to Benefits Coverage; to drill down into the specific procedures, refer to Intervention Coverage.
1.1. What This Workflow Does
The Sub-Benefits Coverage workflow dynamically cross-checks information on the patient and facility against the eligibility rules and then retrieves the specific sub-benefits a patient is eligible for. It does this by taking several key pieces of information:
- Patient Details: Crucial information like their age, gender, and especially their coverage status with SHA.
- Facility Context: Information about the healthcare facility where the service is to be provided, such as its ownership (e.g., public, private), its KEPH level, licensure, and SHA contract status.
The system applies a set of rules from the SHA benefit matrix - essentially a rulebook that dictates which services are covered under various patient and facility conditions.
### Where facility context comes from
You do not pass the facility as an ordinary request field. The facility context is taken from the X-Facility-Id and X-Facility-Id-Type request headers (or from the JWT when it carries facility claims). There is no service_type parameter on the sub-benefit query. See Facility Identification for how to supply facility context.
1.2. Why This Workflow Is Critical
- Risk of Uncovered Services: Prevents patients from incurring unexpected costs.
- Financial Loss for Providers: Avoids services for which facilities won't be reimbursed.
- Regulatory Non-Compliance: Ensures adherence to SHA policies.
- Improved Patient Experience: Patients know what they are entitled to upfront.
### 2. Benefit Matrix Overview
2.1. Overall Benefit Structure
The coverage hierarchy runs from broad to specific:
- Benefits (parent): Highest level, e.g., inpatient/outpatient.
- Sub-benefits: Breakdown by common characteristics, e.g., emergency services.
- Interventions: Specific healthcare services, each with limits and tariffs.
2.2. Funds
- Primary Healthcare Fund (PHC): Covers outpatient services at lower-level facilities, funded by government and grants.
- Social Health Insurance Fund (SHIF): For contributing members, available at hospital level 3 and above.
- Emergency Chronic Critical Illness Fund (ECCIF): For emergency, critical, chronic, and palliative care.
2.3. Schemes
- UHC (Universal Healthcare Coverage): For all citizens using PHC and SHIF.
- POMSF (Public Officers Medical Scheme Fund): For civil servants, extended coverage.
2.4. Payment Mechanisms
- Capitation: For PHC, based on patient numbers at facilities.
- Per Diem: Daily payments, e.g., ICU care.
- Fee for Service: SHA pays full fee if tariff is met.
- Fixed Fee for Service: SHA pays fixed fee; patient covers the rest.
- Case-Based: Depends on treatment scenario; e.g., cesarean after failed normal delivery.
ECCIF and SHIF use all payment mechanisms except capitation.
### 3. Workflow Details: Sub-Benefits Coverage
3.1. Workflow Description
- Input Reception: Takes the Client Registry ID (CR ID) of the patient. Facility context is read from the X-Facility-Id / X-Facility-Id-Type headers (or the JWT).
- Internal Data Retrieval: Fetches full patient profile and facility details.
- Rule Application: Applies the SHA benefit matrix:
- Patient vs benefit categories.
- Facility vs licensed services.
- Sub-Benefit Determination: System compiles eligible sub-benefits.
- Outcome Delivery: Returns the list.
3.2. Key Validations
- CR ID is Mandatory: Identifies the patient and their eligibility.
- Facility Context Must Be Present and Recognised: Supplied via the X-Facility-Id / X-Facility-Id-Type headers or the JWT; the facility identifier type must be a known value (e.g., fr-code, registration-number).
- Valid Age and Gender: Needed for SHA age- and gender-based rules.
- CR Only Source for Patient Data: Ensures single source of truth.
- Facility Must Meet SHA Criteria: Includes KEPH level, ownership, contract status.
3.3. Workflow Data Dictionary
 | Field Name | Description | Data Type | Required | Purpose
 | Beneficiary Client Registry ID | Unique patient identifier from Patient Search | String | Yes | Used to retrieve profile and apply rules
 | X-Facility-Id (header) | Unique ID for the health facility, supplied as a request header (or via the JWT) | String | Yes | Required to determine eligible services
 | X-Facility-Id-Type (header) | e.g., fr-code, registration-number, supplied as a request header (or via the JWT) | String | Yes | Helps the system interpret the facility ID
 | Sub-Benefit Code | Optional code for a specific sub-benefit | String | No | If specified, limits the search to one item
3.4. Expected Outcomes
- Successful Retrieval of Sub-Benefits: Patient is eligible, list of sub-benefits returned.
- No Sub-Benefits Found: Valid patient/facility but no matched sub-benefits.
- Input Error: Invalid or missing data prevented execution.
### 4. Reading the Response
4.1. Sample Response
Filtered to one parent benefit with parent_benefit_code=SHA-19. Three of the twelve sub-benefits under
Surgical Services are shown:
Code 
{
  "count": 12,
  "pageSize": 10000,
  "currentPage": 1,
  "totalPages": 1,
  "startIndex": 1,
  "endIndex": 12,
  "results": [
    {
      "id": 37,
      "code": "SHA-19-SC-04",
      "name": "Cardiology",
      "accessPoint": "IP",
      "fund": "",
      "parentBenefit": "Surgical Services",
      "parentBenefitCode": "SHA-19"
    },
    {
      "id": 41,
      "code": "SHA-19-SC-05",
      "name": "Cardiothoracic and Vascular Surgery",
      "accessPoint": "IP",
      "fund": "",
      "parentBenefit": "Surgical Services",
      "parentBenefitCode": "SHA-19"
    },
    {
      "id": 47,
      "code": "SHA-19-SC-13",
      "name": "Orthopaedic",
      "accessPoint": "IP",
      "fund": "",
      "parentBenefit": "Surgical Services",
      "parentBenefitCode": "SHA-19"
    }
  ]
}
4.2. Response Fields
 | Field | What it means
 | code | The sub-benefit code, e.g. SHA-19-SC-13. This is the value you carry into the intervention call.
 | name | Human-readable sub-benefit name. Safe to display to end users.
 | accessPoint | Whether the sub-benefit is offered on an inpatient visit, an outpatient visit, or both. See below.
 | parentBenefit, parentBenefitCode | Echo which parent this sub-benefit sits under. Useful when you did not pre-filter the list.
 | id | The internal numeric identifier. Do not use it as a business key - code is the stable identifier across environments.
 | fund | The fund the sub-benefit is drawn from. It can come back empty, as it does throughout the sample above; when it is empty, read the fund from the intervention instead.
 | status, active | Whether the sub-benefit is currently in force.
Some sub-benefits also return allowedInterventions, standaloneInterventions, interventionCombination
and packageCombination. These describe which interventions may be claimed together, or must be claimed
alone, within the sub-benefit. The rules that govern them are documented in
SHA Combination Rules.
4.3. accessPoint Decides Whether a Sub-Benefit Applies at All
This is the field that gates the sub-benefit against the visit you are actually in:
 | Value | Meaning
 | IP | Inpatient only. Cannot be billed on an outpatient visit.
 | OP | Outpatient only. Cannot be billed on an inpatient visit.
 | OP and IP | Offered on either visit type.
 | MR | A fourth value the API can return. It is neither inpatient nor outpatient.
### Filter on access point before you show the list
An OP-only sub-benefit cannot be billed on an inpatient visit, and an IP-only sub-benefit cannot be
billed on an outpatient one. Filter the returned list against the current visit type before presenting
it to a clinical user, or they will select a sub-benefit whose interventions cannot be claimed.
Compare the value case-insensitively rather than matching an exact string, and treat any value you do
not recognise as not selectable in the current visit context rather than defaulting it to OP or IP.
4.4. What to Do With It
Take the code of the sub-benefit the clinical user selected and pass it as sub_benefit_code to
Intervention Coverage:
Code 
GET /patients/benefits/interventions?patient_id={crId}&sub_benefit_code=SHA-19-SC-13
That call returns the billable interventions, which is where the tariff, preauthorization and attachment
requirements live. The full walk is set out in
Eligibility Process.
### 5. Critical Success Factors for Sub-Benefits Coverage Integration
- Supply Facility Context Correctly: Ensure the X-Facility-Id / X-Facility-Id-Type headers (or JWT facility claims) are present and accurate on every request. See Facility Identification.
- Keep the CR ID Current: Use the latest beneficiary CR ID from Patient Search.
- Understand SHA Rules: Know how demographics and facility affect results.
- Handle "No Sub-Benefits Found" Gracefully: Design for fallback messaging or user alerts.
## 6. Related Resources
- Benefits Coverage
- Special Benefit Rules
- Intervention Coverage
- Eligibility Check Workflow
- Facility Identification
Last modified on September 28, 2026
