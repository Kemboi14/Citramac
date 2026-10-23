# Eligibility Process Guide: Patient Utilization Workflow
## Eligibility Process Guide: Patient Utilization Workflow
### 1. Overview: How Much of a Benefit Has Been Used
This guide covers the Patient Utilization workflow (GET /patients/benefits/utilization), a lookup within the Eligibility Process. Once you know a patient is eligible and which interventions they are covered for, this workflow tells you how much of a specific intervention's limit has already been consumed and how much remains.
It answers the practical question a facility asks before delivering a service: "Given this patient's coverage, is there still room under the limit for this intervention?"
1.1. What This Workflow Does
The Patient Utilization workflow reports usage against limits for a single intervention. It typically distinguishes between:
- Individual utilization: what the patient themselves has used and what remains for them.
- Household utilization: what the household/family has used and what remains where a limit is shared across a household.
- Fund limits: the applicable limit for the intervention under the relevant fund.
By comparing utilised-versus-remaining values, your integration can warn staff before a limit is exhausted and avoid claims that would exceed coverage.
1.2. Why This Workflow Is Critical
- Prevents Rejected Claims: Knowing the remaining limit up front avoids submitting services that exceed coverage.
- Financial Transparency: Patients and facilities can see how much of a benefit is still available.
- Better Care Planning: Providers can plan treatment within the bounds of available coverage.
### 2. Workflow Details: Patient Utilization
2.1. Workflow Description
- Input Reception: The system receives the patient identifier and the intervention code as query parameters.
- Data Retrieval: It looks up the patient's coverage and the accumulated usage recorded against the specified intervention.
- Limit Calculation: It computes utilised-versus-remaining amounts at the individual and household levels, and returns the applicable fund limit for the intervention.
- Outcome Delivery: It returns the usage-so-far and remaining limits for the intervention.
2.2. Key Validations
- Patient Must Be Identified: A valid patient_id is required.
- Intervention Must Be Specified: A valid intervention_code is required; utilization is always reported per intervention.
- Coverage Must Exist: The patient must have coverage that includes the requested intervention for meaningful limits to be returned.
2.3. Workflow Data Dictionary
Both fields are supplied as query parameters.
 | Field Name | Description | Data Type | Required | Purpose
 | patient_id | The patient's identifier. | String | Yes | Identifies the patient whose utilization is being checked.
 | intervention_code | The code of the intervention whose utilization is being checked. | String | Yes | Scopes the usage/limit lookup to a single intervention.
2.4. Expected Outcomes
- Utilization Returned: The response includes the amount used so far and the remaining limits (individual, household, and fund) for the intervention.
- No Utilization Recorded: The patient is covered but has not yet used the intervention, so the full limit remains.
- Input Error: A missing or invalid patient_id or intervention_code prevented the lookup.
### 3. Critical Success Factors for Patient Utilization Integration
- Always Pass Both Parameters: patient_id and intervention_code are both required.
- Check Before Delivering Service: Query utilization before a service so staff can see whether the limit still allows it.
- Interpret Individual vs Household Limits: Where a limit is shared across a household, take the household remaining value into account, not only the individual one.
## 4. Related Resources
- The 180-day cumulative household cap - why inpatient, critical care, palliative care and mental wellness share one day counter
- Special Benefit Rules
- Intervention Coverage
- POMSF Balance
- Benefits Coverage
- Eligibility Check Workflow
Last modified on September 28, 2026
