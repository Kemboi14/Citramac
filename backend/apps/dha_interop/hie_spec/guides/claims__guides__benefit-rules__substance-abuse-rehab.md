# Rehabilitation for Drug and Substance Abuse
Rehabilitation for Drug and Substance Abuse is SHA-10-005 on SHIF covers and PMF-10-005 on POMSF
covers. It sits inside the Mental Wellness package but it is governed differently from every other member of
that package, and whether a claim pays the case rate or a per diem depends on two facts about the admission
that only the provider knows: how long the patient stayed, and whether they completed the treatment plan.
## Where the code sits
 | Property | SHA-10-005 | The rest of SHA-10
 | Facility levels | Level 3 to 6 | Level 4 to 6
 | Payment mechanism | Case-based | Per diem
 | Limit basis | Individual | Household
 | Quantity | 1 per year | 180 days within the inpatient allowance
 | Access path | Inpatient | Inpatient
So it is the only intervention in the package available at Level 3, the only case-based one, and the only one
metered per individual per year rather than against the shared household day allowance. SHA-10-001 through
SHA-10-004 (behavioural, neuro-developmental, affective and psychoactive disorders) are ordinary per-diem
codes drawing on the
180-day household cap.
## The decision flow
## The two payable outcomes
 | Scenario | Length of stay | Treatment plan | Rate | Mechanism
 | Programme completed | 45 days or more | Completed | KES 67,200 | Case-based, 1 per year
 | Programme not completed | Any | Not completed | KES 1,000 per day | Per diem, capped at 10 days
Two amounts appear on this page even though these guides otherwise omit tariffs, because here the amounts
are the rule: the whole decision flow exists to choose between them. Resolve the authoritative figures
from Intervention Coverage before billing.
The facility check is a hard gate, not a review trigger: a claim from a facility outside Levels 3 to 6 is not
payable at all, rather than held for review.
## An incomplete stay
Where the patient does not finish the treatment plan, the Fund is liable for up to 10 days at the per-diem
rate.
The 10-day cap applies to every incomplete stay, regardless of how long the patient was actually admitted.
A 60-day admission that did not complete the plan pays the same 10 days as a 20-day admission that did not.
That is what makes the 10 days or fewer? test in the flow above decorative - both of its branches produce
the same answer.
Only a stay of 45 days or more that completed the treatment plan pays the case rate.
## On a POMSF cover
The decision flow and the two amounts above are the SHIF rules. POMSF prices PMF-10-005 differently and
structures the programme around a 90-day course rather than the 45-day threshold alone.
Resolve the POMSF amount from PMF Tariffs rather than deriving it, and
confirm the member's remaining cover with
POMSF Balance. The POMSF resolver reflects the rate that
applies to your facility, including any negotiated rate, which is not something a transcribed figure can do.
## Preauthorisation
### The preauthorisation requirement differs by scheme
On SHIF covers, SHA-10-005 requires no preauthorisation. On POMSF covers, PMF-10-005 requires
preauthorisation and it is handled manually, not automatically - so build for a human turnaround rather
than a synchronous decision.
Branch your logic on needsPreauth, and on needsManualPreauthApproval for whether it is manual, from
Intervention Coverage for the scheme in play rather
than on the scheme names above. The flags are live data and this page is not.
## Required documentation
Do not hard-code a document list from this page or from the matrix. Every intervention publishes its own
documentation requirements. Read them from
Intervention Coverage for the intervention you are
billing:
 | You need | Read this field
 | Documents required for the claim | applicableDocumentTypes
 | Documents required for the preauthorisation | requiredPreauthDocumentTypes
This matters more here than on most pages: the decision flow names a detox incidence summary among the
required claim documents, and the document types this intervention actually accepts are what tell you how to
label it. Check them before submitting rather than assuming.
See Adding Attachments for those fields in full, the optional
counterparts, and how to attach a document once you know its type.
Figures on this page are the limits and decision thresholds recorded in the SHA Benefits Matrix (05.06.25),
its SHA_10_005 flow diagram, and the SHA POMSF Benefits & Tariffs Matrix (10.03.2026). Resolve amounts at
claim time from Intervention Coverage.
## Related resources
- Special Benefit Rules - the other five rule sets, and the terms used here.
- Inpatient Benefit Rules - the 180-day allowance the rest of SHA-10 draws on.
- Intervention Combination Rules - why SHA-10 is reported alone.
- Intervention Coverage - preauth flags and document requirements.
- Normal Preauthorizations - raising the POMSF preauthorisation.
- Adding Attachments - reading required documents off the intervention.
- PMF Tariffs - resolving the POMSF amount.
- POMSF Balance - the member's remaining POMSF cover.
- Adding Attachments - attaching the discharge and detox summaries.
- Inpatient Claim Dispatch - discharge and submission.
Last modified on September 28, 2026
