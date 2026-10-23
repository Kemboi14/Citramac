# Set Coverage Workflow Guide
## Set Coverage Workflow: Choosing Which POMSF Cover a Visit Is Billed Against
### 1. Overview
This guide explains the Set Coverage workflow, which tells the HIE which POMSF cover a visit
should be billed against when the patient could legitimately be billed under more than one.
It calls POST /api/v1/authorizations/covers with three values: the principal member's CR ID, the
visit's consent token, and the policy number of the cover to use. The response echoes back the
selection that was applied.
### POMSF covers only
Set Coverage applies to Public Officers Medical Scheme Fund (POMSF) covers only. It is not
available for general SHA or UHC covers, where a beneficiary has a single applicable cover and there
is nothing to choose between.
1.1. What This Workflow Does
A POMSF household can hold more than one cover. Where several covers could pay for the same visit, the
HIE needs to know which one to use before the claim or preauthorization is built. This workflow:
- Names the principal: identifies whose POMSF cover is being applied, by the principal's CR ID.
- Binds it to the visit: ties that choice to the visit through its consent token.
- Names the exact cover: the policy_number picks out the specific policy, since a principal can
hold more than one.
1.2. Why This Workflow Is Critical
Consider a family of five: two parents who are both POMSF principals in their own right, plus
three children.
- On any given visit, the wife may bill against her own principal cover, or against her husband's.
- The husband likewise may bill against his own cover, or against his wife's.
- Each of the three children may be billed under either parent's cover.
Without an explicit choice, the visit may be billed against a cover the provider did not intend. The
most common reason to switch is balances: if the father's optical limit for the year is exhausted,
the same visit can be billed to the mother's cover instead and paid. Any other business reason is
equally valid - the endpoint does not police the motive, it records the decision.
### 2. Workflow Details: Set Coverage
2.1. Workflow Description
- Run the eligibility check: call the eligibility endpoint for the patient. The response returns
the patient's schemes[].
- Confirm the patient is POMSF: check the schemeName values. POMSF schemes are matched as a
prefix (POMSF, and suffixed variants such as POMSF-047), alongside TSC and USALAMA.
- Pick the cover: choose the scheme object the visit should be billed against, typically after
comparing balances across the household's covers.
- Read the policy number: take policy.number from that scheme object.
- Set the coverage: call POST /api/v1/authorizations/covers with the principal's CR ID, the
visit's consent token, and that policy number.
- Proceed with billing: build the claim or the preauthorization as normal. It is billed against
the cover you selected.
2.2. Where policy_number comes from
policy_number is not a value you compose. Read it from the eligibility response: pick the scheme
in schemes[] whose schemeName is the POMSF cover you want, then take policy.number from that
scheme object.
Code 
{
  "schemes": [
    {
      "schemeName": "POMSF-047",
      "schemeId": "9021",
      "memberType": "PRINCIPAL",
      "policy": {
        "number": "POL-POMSF-0098231",
        "startDate": "2026-01-01",
        "endDate": "2026-12-31"
      }
    }
  ]
}
Here the value to send is POL-POMSF-0098231.
### Set coverage before you bill
Call Set Coverage after the eligibility check and before you start adding lines, interventions or
preauthorization details. It decides which cover the visit draws down, so it belongs at the front of
billing, not the end.
2.3. Workflow Data Dictionary
 | Field Name | Description | Data Type | Required | Purpose
 | principal_cr_id | Client Registry number of the POMSF principal whose cover is being applied. | String | Yes | Identifies whose cover pays. This is the principal member, who is not necessarily the patient - a child's visit carries the parent's CR ID here.
 | consent_token | Consent token for the visit being billed. | String | Yes | Binds the coverage choice to one specific visit.
 | policy_number | Policy number of the cover to bill against, read from schemes[].policy.number in the eligibility response. | String | Yes | Picks out the exact policy, since a principal may hold more than one.
 | X-Facility-Id | Facility Registry (FR) code of the facility. | Header | Conditional | Required when authenticating with a service-account token.
 | X-Facility-Id-Type | Type of identifier in X-Facility-Id. Currently only fr-code. | Header | Conditional | Tells the HIE how to interpret the facility identifier.
2.4. Expected Outcomes from this workflow
- Coverage applied: the response echoes back principal_cr_id, consent_token and
policy_number. Compare the echo against what you sent to confirm the intended cover was applied.
- Validation failure: a missing principal_cr_id, consent_token or policy_number is rejected
with a 400.
- Wrong scheme type: covers that are not POMSF cannot be set this way - there is nothing to choose
between on a general SHA or UHC cover.
### 3. Workflow Diagram
### 4. How Set Coverage Connects to Other Workflows
- Eligibility Check: returns the schemes[]
the cover is chosen from, and is where you confirm the beneficiary is POMSF at all.
- POMSF Balance: the balances that usually decide
which of the household's covers to use.
- PMF Tariffs Guide: how POMSF tariffs are resolved once the
cover is set.
- Benefit Matrix Guide: what each cover pays for.
### 5. Key Success Factors for Set Coverage
- Detect POMSF properly: match schemeName on POMSF as a prefix, never as exact equality -
real values include suffixed variants such as POMSF-047.
- Send the principal, not the patient: principal_cr_id is the cover holder's CR ID. For a
dependant's visit that is the parent's, not the child's.
- Copy the policy number: take policy.number verbatim from the chosen scheme object rather than
composing or storing it locally.
- Check the echo: the response repeats the applied selection. Treat a mismatch as a failure to
apply, not a formatting quirk.
Last modified on September 28, 2026
