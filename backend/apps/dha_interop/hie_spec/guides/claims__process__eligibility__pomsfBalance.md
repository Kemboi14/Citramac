# Eligibility Process Guide: POMSF Balance Workflow
## Eligibility Process Guide: POMSF Balance Workflow
### 1. Overview: Remaining POMSF Balances
This guide covers the POMSF Balance workflow (GET /patients/pomsf-balances), a lookup within the Eligibility Process. POMSF (Public Officers Medical Scheme Fund) is the scheme that extends medical cover to public officers (civil servants) and their families. This workflow returns the member's POMSF policies and the remaining balances available under them.
Where a service is funded through POMSF, this lookup lets a facility confirm how much cover is still available for the member and their dependents before delivering and billing the service.
1.1. What This Workflow Does
The POMSF Balance workflow retrieves, for a given patient:
- Member policies: the POMSF policy or policies the patient is covered under, tied to a principal member.
- Dependents / family members: the family members covered under the principal member's policy.
- Remaining balances: the balance still available under the policy for the relevant policy year.
The principal member holds the policy; dependents draw against the same policy. You can scope the lookup to a specific principal member and policy year.
1.2. Why This Workflow Is Critical
- Confirms Available Cover: Ensures a POMSF-funded service is within the remaining balance before it is delivered.
- Handles Families Correctly: Reflects that dependents share a principal member's policy and balance.
- Reduces Financial Risk: Prevents billing against a policy whose balance is exhausted.
### 2. Workflow Details: POMSF Balance
2.1. Workflow Description
- Input Reception: The system receives the patient identifier and, optionally, a principal member number and a policy year as query parameters.
- Policy Retrieval: It resolves the patient's POMSF membership, the principal member's policy, and the dependents covered by it.
- Balance Calculation: It computes the remaining balance for the relevant policy year.
- Outcome Delivery: It returns the member's policies, family members, and remaining balances.
2.2. Key Validations
- Patient Must Be Identified: A valid patient_id is required.
- POMSF Membership Must Exist: The patient must be covered under POMSF for balances to be returned.
- Principal Member / Policy Year Scoping (optional): When supplied, principal_member_number and policy_year narrow the lookup to a specific policy and year.
2.3. Workflow Data Dictionary
All fields are supplied as query parameters.
 | Field Name | Description | Data Type | Required | Purpose
 | patient_id | The patient's identifier. | String | Yes | Identifies the patient whose POMSF balance is being checked.
 | principal_member_number | The principal member number that holds the POMSF policy. | String | No | Scopes the lookup to a specific principal member's policy (useful for dependents).
 | policy_year | The policy year to report balances for. | String | No | Scopes the balance to a specific policy year.
2.4. Expected Outcomes
- Balances Returned: The response includes the member's POMSF policies, dependents/family members, and remaining balances.
- No POMSF Cover: The patient is not a POMSF member, so no balances are returned.
- Input Error: A missing or invalid patient_id prevented the lookup.
2.5. Detecting a POMSF beneficiary
Before calling this endpoint, confirm the beneficiary is on POMSF at all. Read schemeName on the
schemes returned by the eligibility check. The
applicable scheme names are POMSF, TSC and USALAMA.
POMSF has suffixed variants - for example POMSF-047, POMSF-SHA - so match POMSF as a prefix,
never as an exact string equality. An equality check silently misses every suffixed member.
Where the household holds more than one POMSF cover, the balances you read here are usually what
decides which cover to bill - apply that choice with
Set Coverage.
### 3. Critical Success Factors for POMSF Balance Integration
- Always Pass patient_id: It is the only required parameter.
- Use Scoping for Families: Pass principal_member_number (and policy_year where relevant) when you need the balance for a specific policy shared across dependents.
- Respect POMSF Tariffs: POMSF balances are consumed according to POMSF tariff rules - see the POMSF Tariffs Guide.
## 4. Related Resources
- POMSF Tariffs Guide
- Special Benefit Rules - where the POMSF rules diverge from general SHA
- Critical Care Rules - POMSF pays fee for service over and above the per diem, within the member's inpatient limit
- Patient Utilization
- Benefits Coverage
- Eligibility Check Workflow
- Set Coverage
Last modified on September 28, 2026
