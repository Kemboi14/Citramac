# Special Benefit Rules
Some SHA benefit packages carry rules that go beyond "is this patient covered for this code". They decide
whether an intervention may be added to a visit at all, how many days of care are payable, when a claim
splits into two, and when the payer will hold a claim for review rather than pay it. SHA publishes these as
per-package rules sheets inside the benefit matrix workbooks.
These pages document six of those rule sets. They are the rules referenced from the
Intervention Combination Rules table and from
Benefit Matrix.
### Why this guide exists, and what you do with it
These pages exist to give you the information. They carry the rules and limits SHA publishes for
each package: global periods, day counts, session and quantity caps, facility levels, age gates, and the
conditions that lead the payer to review a claim rather than pay it straight through.
Some of these rules are checked as you build the claim, and some are not. Where the HIE validates a rule,
breaking it fails the call, so you find out immediately. Where it does not, nothing stops the submission -
the claim transmits successfully and the consequence only appears once the payer has adjudicated it.
That matters because the HIE does not adjudicate claims. It helps you build a claim and transmits it to
the payer. The payer is what reviews it, decides its outcome and moves its status; you read that outcome back
with Preview Payer Claim. So a rule the HIE does not check
is not a rule without consequences - it is a rule whose consequence arrives late, after the patient has been
treated and discharged.
So you have a choice on each rule, and it is yours to make: build the validation into your own system, or
make sure your users know the rule and can see what they are about to do. Either way the rule has to be
somewhere in your product, which is why it is documented here rather than left in a spreadsheet.
These pages do not carry tariffs. Amounts are runtime data - see
How amounts are resolved below.
Source: SHA Benefits Matrix (05.06.25) and SHA POMSF Benefits & Tariffs Matrix (10.03.2026).
## Terms used across these pages
 | Term | What it means
 | Global period | A window after a procedure or delivery whose care is already paid for by the case rate. No per-diem intervention may be billed inside it. Length depends on the delivery mode or the surgical complexity.
 | Case rate | One amount for the whole episode, not per day. Case-based interventions pay the same whether the patient stays the minimum or longer, and the amount already includes the global-period days.
 | Per diem (also rebate) | An amount per calendar day of admission, calculated automatically from the admission and discharge dates. Requires an overnight stay.
 | KEPH level | The Kenya Essential Package for Health facility tier, Level 2 to Level 6. Many interventions are only payable in a range of levels, and many tariffs differ by level.
 | Tariff | The amount payable for an intervention. Depending on the intervention this is either a KEPH-level tariff (a different amount per level) or a single overall tariff that applies at every level.
 | Complexity | For surgical interventions only: Minor, Major or Specialized. It is a column on the benefit matrix and it determines the global period.
 | Limit basis | Whether an allowance belongs to the individual member or is shared across the whole household. A household allowance means one member's care reduces what is left for the others.
 | Cumulative cap | A counter that runs across a policy year and, where the basis is household, across every member. The 180-day admission cap is the main one.
 | Clinical review | A manual adjudication step carried out by the payer, not by the HIE. A claim under review is not rejected - the payer holds it for a reviewer, and it pays later, or not at all, on their decision. You see the outcome through Preview Payer Claim.
 | Adjudication | Everything the payer does with a claim after it is transmitted: reviewing it, deciding what is payable, moving its status, paying or rejecting it. The HIE builds and transmits the claim; it does not adjudicate.
 | Preauthorisation | Approval obtained before the service is claimed. Normal preauths are raised during the visit; elective preauths are raised before the visit and gate whether it may go ahead. Which one applies is a property of the intervention.
 | Lapse | A global period lapsing means it has run its course, so per-diem may now start. An approval lapsing means it expired unused and can no longer be claimed against.
 | Utilisation / balance | How much of an allowance a member or household has already consumed, and how much remains. Always read back from the API rather than tracked locally.
 | Fund | Which pot pays: PHC for primary care, SHIF for the main benefit package, ECCIF for emergency, chronic and critical illness.
 | Scheme | UHC (the standard SHA cover) or POMSF, the Public Officers Medical Scheme Fund, which tops up SHIF for civil servants and publishes its own rules.
## The six rule sets
 | Rule set | SHIF / ECCIF code | POMSF code | What the rules govern
 | Maternity | SHA-08 | SHA-08 | The delivery global period, when per-diem may start, multiple births
 | Medical Imaging | SHA-09 | SHA-09 | Mandatory preauthorisation, the 7-day approval expiry, who may request imaging
 | Surgical | SHA-19 | SHA-19 | Global periods by complexity, per-diem suppression, when a separate claim may be raised
 | Critical Care | SHA-03 | PMF-03 | The 12-day and 30-day thresholds, switching to and from inpatient
 | Inpatient | SHA-07 | PMF-07 | The overnight-stay rule, the 180-day household cap, adding packages mid-admission
 | Substance Abuse Rehab | SHA-10-005 | PMF-10-005 | The payment decision flow: case rate versus per diem
## How amounts are resolved
No page here publishes a tariff. Amounts are runtime data, and the rules are what decide whether a
correctly resolved amount is payable at all.
Call GET /api/v1/patients/benefits/interventions and read the amount off the intervention you are
billing - see Intervention Coverage. What you get
back depends on the intervention:
- Some interventions are priced per KEPH level. The response carries a tariff field per level, and the
one that applies is the level of the facility treating the patient.
- Others carry a single overall tariff that applies at every level the intervention is available at.
Read whichever the intervention actually returns rather than assuming a KEPH ladder is always there.
For a POMSF cover, resolve the amount through the POMSF tariff endpoints instead - see
PMF Tariffs. The POMSF resolver is what accounts for a rate
negotiated for your specific facility, and it returns the applicable rate whether or not one has been
negotiated. Confirm the remaining POMSF cover with
POMSF Balance before billing.
## Patterns that recur across the rule sets
Learning these five once makes the individual pages much shorter to read.
A case rate already pays for the first days of admission, so per-diem cannot. Maternity and surgical
interventions are paid as a case rate, and that single amount is calculated to cover the procedure or
delivery plus the days the patient normally needs to recover in hospital afterwards. Those recovery
days are the global period:
 | Benefit | Global period paid inside the case rate
 | Normal delivery | 48 hours after delivery
 | Caesarean section | 72 hours after delivery
 | Minor surgery | 1 night
 | Major surgery | 3 nights
 | Specialized surgery | 7 nights
Billing a per-diem intervention for a day inside that window charges twice for a day already paid, so it
is not allowed. Once the window lapses, the inpatient per-diem starts and covers each further day.
Per-diem needs a night. Per-diem rebates are auto-calculated per calendar day and require an overnight
stay - the admission and discharge dates must differ.
One counter, four packages. Inpatient, critical care, palliative care and mental wellness all draw
down the same 180-day household allowance, cumulatively, across every beneficiary in the household.
Approval starts a clock. Where preauthorisation applies, the member's balance is checked and
committed as soon as the approval lands, and the approval itself expires if the service is not delivered
in time. Cancel an approval you will not use rather than letting it lapse - see
the 7-day imaging expiry
for the worked case.
Thresholds usually mean review, not rejection. Crossing a limit typically means the payer holds the
claim for a reviewer rather than refusing it outright. Long level-3 admissions, out-of-range maternity ages
and global-period violations all behave this way. This happens at the payer, after submission, so watch for
it on Preview Payer Claim rather than expecting the
submission itself to fail.
## Which scheme's rules apply
SHA publishes two workbooks, and they are not the same rules. The SHA Benefits Matrix carries the
rules for the standard cover - the packages funded from SHIF, and critical care from ECCIF. The
POMSF Benefits & Tariffs Matrix carries the rules for POMSF covers. They diverge on facility levels,
preauthorisation requirements, limit basis, sub-code numbering and, in a few places, on whether a rule
exists at all.
Every page below states which scheme each rule belongs to. Read the rules for the cover the visit is
actually billed against.
- Choosing the cover: Set Coverage
- POMSF cover remaining: POMSF Balance
- POMSF scheme detection and tariff resolution: PMF Tariffs
- Which fund and scheme a patient falls under:
Benefits Coverage
## Resolve at runtime rather than hard-coding
Two things on these pages are safe to build into your product, and two are not.
Safe to implement from these pages - the day counts, hour windows, night counts and ordering rules. A
48-hour maternity window and a 3-night major-surgery global period are stable structural rules, and your
system needs them to warn a user before they bill.
Resolve from the API instead - amounts, per-intervention flags, facility-level ranges, document
requirements and remaining balances. These are per-intervention and per-member, they change without a
document change, and the API is authoritative:
 | What you need | Where to read it
 | Tariff, complexity, facility levels, payment mechanism | Intervention Coverage
 | Whether an intervention needs a preauth, and whether it is elective | needsPreauth and needsManualPreauthApproval on the same response
 | Whether an intervention needs doctor authorisation | needsDoctorAuthorization on the same response
 | Required claim and preauth documents | applicableDocumentTypes and requiredPreauthDocumentTypes - see Adding Attachments
 | Days and amounts already consumed | Patient Utilization
 | POMSF cover remaining | POMSF Balance
### Where a page states a fact and a flag carries it, branch on the flag
Several pages tell you a whole package behaves one way - every imaging intervention is elective, every
surgical intervention needs doctor authorisation, inpatient needs no preauthorisation on SHIF. Those
statements are accurate, and they are there so you understand the shape of the package.
Do not turn them into conditions on the package code. Branch on the flag the intervention carries instead.
The flags are live data and these pages are not: if SHA reclassifies an intervention, code reading the flag
keeps working, while code testing "is this an SHA-09 code" silently does the wrong thing until someone
notices.
## Related resources
- Intervention Combination Rules - which packages may share a visit.
- Benefit Matrix - funds, schemes, payment mechanisms and package codes.
- Understanding Benefits and Intervention Codes - how the code hierarchy works.
- PMF Tariffs - resolving POMSF amounts at claim time.
- Intervention Coverage - where tariffs, preauth flags and document requirements come from.
- Adding Attachments - reading the required documents off each intervention.
- Patient Utilization - days and amounts already consumed.
- Preview Payer Claim - where the payer's review outcome and final status appear.
- Set Coverage - choosing the cover a visit is billed against.
- Preauths Process Overview - normal, elective and specialised preauthorisation paths.
Last modified on September 28, 2026
