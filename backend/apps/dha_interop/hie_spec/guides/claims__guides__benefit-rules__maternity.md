# Maternity Benefit Rules
Maternity and Child Health Services (SHA-08) is paid on a case-based mechanism: one amount for the
delivery, which already covers the immediate post-delivery stay. The rules below decide when that case rate
stops being the whole story and an inpatient per-diem rebate may begin, how multiple births are counted, and
which patients are ineligible or will have their claim reviewed by the payer.
## The maternity global period
The case rate is the amount costed for that delivery as a whole. It is not a payment for the delivery
alone - it is calculated to cover the delivery plus the days the mother normally spends recovering in
hospital afterwards. Those recovery days are the maternity global period, and how many there are depends
on the mode of delivery.
 | Delivery mode | Code | Global period | Facility levels (SHIF) | Facility levels (POMSF)
 | Vaginal delivery | SHA-08-005 | 48 hours | Level 2 to Level 6 | Level 3 to Level 6
 | Caesarean section | SHA-08-006 | 72 hours | Level 3 to Level 6 | Level 3 to Level 6
Both workbooks state the same 48-hour and 72-hour windows, so this rule is the same on SHIF and POMSF
covers (SHA Maternity rules 1.2; POMSF Maternity rules 1).
Where peripartum or postnatal complications run beyond that window, the inpatient per-diem tariff takes
effect for the days outside it.
### No per-diem inside the global period
Those first 48 or 72 hours are already paid for inside the delivery case rate. Billing a per-diem
intervention for one of them charges a second time for a day that has been paid once, which is why it is not
allowed - and it is the most common way to get a maternity claim rejected.
Per-diem interventions can only be added after the global period has lapsed. Every claim that crosses
into per-diem territory is held for clinical review by the payer before it is paid.
## Inpatient per-diem after the global period
Once the global period lapses, the complication is billed under an inpatient sub-code, not under
SHA-08. The two schemes differ here, in the code numbers and in the combination rule, so read the row
for the cover you are billing.
### On a SHIF cover
 | Complication | Code
 | Post-partum complications | SHA-07-005
 | Neonatal complications | SHA-07-006
The combination rules permit SHA-08 to carry only those two
sub-codes, and only after the global period has lapsed. No other inpatient sub-code may join a
maternity visit.
### On a POMSF cover
 | Complication | Code
 | Post-partum complications | PMF-07-003
 | Neonatal complications | PMF-07-004
The POMSF combination sheet lists the inpatient package as PMF-07 with no sub-code restriction, and it
does not repeat the global-period condition on that row. The global period itself still applies - it is
stated on the POMSF maternity rules sheet - so treat the restriction as being on when per-diem may start
rather than on which sub-code carries it.
### The same service, two different code numbers
Post-partum and neonatal complications are the same two services under both schemes, but they are numbered
-005 and -006 on SHIF and -003 and -004 on POMSF. A rule or claim line keyed on SHA-07-005 will
not resolve on a POMSF cover.
Resolve the sub-code from
Intervention Coverage for the scheme in play
rather than hard-coding either set.
## Multiple births
The two schemes handle multiple births in completely different ways. SHIF states rules against the
ordinary delivery codes; POMSF adds dedicated codes instead.
### On a SHIF cover: two rules, no extra codes
- Different modes of delivery - for example one twin delivered vaginally and the other by caesarean - are
covered independently (SHA Maternity rules 1.1).
- The same mode of delivery for all births is reimbursed as a single claim under the ordinary
delivery code (SHA Maternity rules 1.3).
### On a POMSF cover: dedicated multiple-birth codes
The POMSF maternity rules sheet carries neither of the rules above. Instead the POMSF matrix adds two
intervention codes that do not exist under SHIF at all:
 | Intervention | Code | Preauthorisation
 | Multiple births - vaginal delivery | SHA-08-007 | Yes, manual
 | Multiple births - caesarean section | SHA-08-008 | Yes, manual
Both rows are marked POMSF-only. Both require manual preauthorisation, and the payer reviews every claim
against them.
Bill the scheme's own path: check whether SHA-08-007 or SHA-08-008 comes back as covered from
Intervention Coverage before falling back on the
single-claim rule, and read the preauthorisation documents each one requires from
requiredPreauthDocumentTypes on the same response.
## Eligibility and clinical-review gates
 | Gate | Rule | Effect
 | Sex | The patient must be female | Not payable
 | Recent delivery | The patient must not have delivered in the preceding 10 months | Not payable
 | Age | Over 55 years | Payer review, not a refusal
 | Caesarean section | Every SHA-08-006 claim | Payer review
 | Anti-D | Every SHA-08-004 claim | Payer review
 | Global period | The captured procedure and discharge dates contradict the global-period rule - for example a discharge inside the window billed as though it fell outside, or a procedure date that cannot be reconciled with the admission and discharge dates | Payer review
These gates are recorded identically on both workbooks, so they apply on SHIF and POMSF covers alike.
The review outcomes above happen at the payer, after the claim is transmitted - the HIE does not adjudicate
claims. So a maternity claim that trips one of these gates submits successfully and its outcome appears later;
watch for it on Preview Payer Claim.
SHA-08-004 (Anti-D) is the third intervention on the maternity sheet alongside the two delivery codes. It
is available from Level 2 to Level 6, and it is the only maternity intervention that requires
preauthorisation on a SHIF cover.
### Intervention codes are not sequential
Do not expect the sub-codes within a package to run from -001 upwards without gaps. The maternity
interventions begin at SHA-08-004; there is no -001, -002 or -003. That is how the package is
defined, not an omission.
Whatever the benefit matrix lists is the final set of intervention codes. Resolve codes from
Intervention Coverage rather than deriving them
from a number sequence.
## Where the maternity limit sits
Under POMSF, whether maternity draws on its own allowance or on the inpatient allowance depends on the
scheme the member belongs to:
- Mwalimu Cover and Nairobi City County Government - maternity is a standalone cover,
independent of the inpatient cover.
- All other POMSF schemes - the maternity benefit limit sits within the inpatient limit.
This matters because on most POMSF schemes a long maternity admission and a later inpatient admission
compete for the same pool, and on the two named schemes they do not.
Read the member's remaining POMSF cover from
POMSF Balance before billing rather than working out which
pool applies. That endpoint returns the available cover for the policy year for the scheme the member is
actually on, so it answers the question directly. Resolve POMSF amounts through
PMF Tariffs.
## Required documentation
Do not hard-code a document list from this page or from the matrix. Every intervention publishes its own
documentation requirements, and they can change without the guide changing.
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
- Inpatient Benefit Rules - the per-diem rules that take over after the global period.
- Intervention Combination Rules - what SHA-08 may share a visit with.
- Intervention Coverage - codes, tariffs, preauth flags and document requirements.
- Add Intervention - adding the per-diem code once the period lapses.
- Normal Preauthorizations - raising the Anti-D preauthorisation.
- Adding Attachments - reading required documents off the intervention.
- Inpatient Claim Dispatch - discharging and submitting the claim.
- Preview Payer Claim - where the payer's review outcome and final status appear.
- POMSF Balance - whether maternity draws on its own limit.
- PMF Tariffs - resolving POMSF amounts.
Last modified on September 28, 2026
