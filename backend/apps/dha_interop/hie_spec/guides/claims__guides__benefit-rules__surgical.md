# Surgical Rules
Surgical Services (SHA-19) pays a case rate per procedure. That single amount covers the procedure and
a set number of post-operative nights in hospital - the global period. Almost every surgical billing
question reduces to one variable: which post-operative day are you on, and has the global period lapsed?
## Surgical interventions require doctor approval
Every surgical intervention requires the attending doctor's approval before the request proceeds. On the SHA
Benefits Matrix this is recorded in the doctor's authorisation column, and it reads YES for all 547
surgical interventions (surgical rules 1.1.1, identical on both workbooks).
### needsDoctorAuthorization
Intervention Coverage returns a boolean
needsDoctorAuthorization on each intervention. Branch on it before you create the preauthorisation
rather than on the intervention being an SHA-19 code - the flag is live data and this page is not, so code
that reads it keeps working if SHA reclassifies a procedure.
When needsDoctorAuthorization is true, creating the preauthorisation sends the doctor request
automatically. You do not call anything extra. On POST /api/v1/preauths the request goes out to the
doctor or doctors named on that preauth, and the preauth waits in PENDING_DOCTOR_APPROVAL until one of them
responds. The request reaches the doctor as:
- a two-way SMS they can reply to,
- a request in the Practice360 app, or
- an email.
When the flag is false, no request is sent and the preauthorisation is submitted straight to the payer.
### The doctor-consent endpoint only resends
POST /api/v1/claims/doctor-consent is not a step in the flow. The first request is already sent for you.
That endpoint exists for one case: the doctor says they never received it and needs it delivered again. See
Preauth Doctor Consent.
See Surgical Preauthorization for the request itself.
## Surgical global periods
The case rate covers a number of nights that depends on the complexity of the procedure. Those nights are
the post-operative recovery the case rate is costed to include.
 | Complexity | Nights covered by the case rate | Beyond that
 | Minor surgery | 1 night | Additional nights at the hospital's gazetted rebate rate
 | Major surgery | up to 3 nights | Additional nights at the hospital's gazetted rebate rate
 | Specialized surgery | up to 7 nights | Additional nights at the hospital's gazetted rebate rate
The three global periods are stated identically on both workbooks, so they apply on SHIF and POMSF covers
alike (surgical rules 1.3.1.1 to 1.3.1.3).
Complexity is a column on the benefit matrix, carried against each surgical intervention code, so you can
see which of the three applies to any procedure by looking it up there. It also comes back per intervention
from Intervention Coverage, which is the source to
build against - it stays current, and a transcribed copy does not.
## No per-diem inside the global period
### Four per-diem rebates must not run during the global period
During the surgical global period the medical inpatient, critical care, mental health and palliative care
rebates must not be running, and no per-diem intervention may be added to the episode (surgical rules
1.3.1.5).
The case rate already covers those nights. Adding a per-diem line inside the window double-bills them.
If more nights are needed once the global period is exhausted, the facility updates the inpatient admission
notification to either surgical complication (SHA-07-002 on SHIF, PMF-07-002 on POMSF) or medical
admission (rule 1.3.1.4). That switch is what starts the per-diem rebate legitimately.
The SHA Benefits Matrix states the prohibition twice, adding that no per-diem intervention may be added to a
surgical episode running inside its global period. The POMSF sheet states the first sentence only. Treat the
rule as applying on both.
## Three dates must be captured separately
The system must record the admission date, the procedure date and the discharge date as three
distinct values (rule 1.3.1.6). They are not interchangeable: the global period runs from the procedure, while
the admission may have started earlier.
If the captured procedure and discharge dates contradict the global-period rule - a discharge that cannot
be reconciled with the procedure date and the nights the case rate covers - the payer holds the claim for
clinical review before paying it (rule 1.3.1.7). This applies on both schemes.
Getting the three dates right therefore matters at capture time: the claim still transmits, and a
contradiction between them only surfaces once the payer has looked at it.
## What to bill on a given post-operative day
## Multiple procedures in one theatre visit
This rule is stated in the SHIF matrix only. Where several surgeries happen within one operating theatre
visit on a SHIF cover (SHA surgical rules 1.2):
- the primary procedure is reimbursed at the full gazetted tariff,
- the secondary procedure is reimbursed at 50 percent of its gazetted tariff,
- the treating doctor indicates which procedure is primary.
The POMSF surgical rules sheet carries no equivalent rule. On a POMSF cover, bill the primary procedure and
resolve the secondary amount from PMF Tariffs rather than applying the
50 percent reduction yourself.
## When a separate claim may be raised
Five situations justify a claim separate from the original surgical claim, even inside the global period.
 | # | Scenario | Reviewed by the payer
 | 1 | A repeat surgical procedure on the same day as the original surgery, requiring a return to the operating theatre | Yes
 | 2 | A procedure related to the original surgery requiring an unplanned return to theatre for post-operative complications | Yes - Clavien classification and a practitioner case summary are required
 | 3 | A surgical procedure or care, such as critical care, entirely unrelated to the original surgery and not treating its complications | No
 | 4 | A staged procedure, defined and planned as part of the primary procedure, performed inside the post-operative global period | No
 | 5 | Specialised diagnostic tests such as medical imaging during the surgery | No
The same five scenarios apply on both schemes. They are numbered 1.3.2.1 to 1.3.2.5 in the SHIF matrix and
1.3.3.1 to 1.3.3.5 in the POMSF matrix, renumbered because POMSF inserts an extra rule above them.
### Clavien classification
The source spells this "Claiven". The intended reference is the Clavien-Dindo classification of surgical
complications. Scenario 2 will not pass review without both the classification and the case summary.
## Combining surgical care with other packages
The combination rules allow SHA-19 to carry inpatient surgical
complications and medical imaging. Critical care and palliative care may be added only after the surgical
global period has lapsed - which is the same boundary this page is built around.
The POMSF row additionally permits renal care (SHA-16), which the SHIF row does not list.
## Amounts and the catalogue
The surgical catalogue is the largest in the matrix, and the two schemes price the same code differently. No
part of it is reproduced here: resolve the amount per intervention from
Intervention Coverage and, for a POMSF cover, from
PMF Tariffs.
## Required documentation
Do not hard-code a document list from this page or from the matrix. Every intervention publishes its own
documentation requirements, and they differ per procedure and per scheme.
Read them from Intervention Coverage for the
intervention you are billing:
 | You need | Read this field
 | Documents required for the claim | applicableDocumentTypes
 | Documents required for the preauthorisation | requiredPreauthDocumentTypes
See Adding Attachments for those fields in full, the optional
counterparts, and how to attach a document once you know its type.
Figures on this page are the non-tariff limits recorded in the SHA Benefits Matrix (05.06.25) and the SHA
POMSF Benefits & Tariffs Matrix (10.03.2026). Resolve amounts at claim time from
Intervention Coverage.
## Related resources
- Special Benefit Rules - the other five rule sets, and the terms used here.
- Surgical Preauthorization - raising the request.
- Preauth Doctor Consent - resending the doctor request if it did not arrive.
- Intervention Coverage - complexity, tariffs, needsDoctorAuthorization and document requirements.
- Inpatient Benefit Rules - the per-diem rules that take over after the global period.
- Critical Care Rules - transitioning to critical care post-surgery.
- Switch Intervention - moving between packages mid-admission.
- Add a claim line - where the primary and secondary amounts are billed.
- Preview Payer Claim - where the payer's review outcome and final status appear.
- Adding Attachments - reading required documents off the intervention.
- Intervention Combination Rules - what SHA-19 may share a visit with.
- PMF Tariffs - resolving POMSF amounts.
Last modified on September 28, 2026
