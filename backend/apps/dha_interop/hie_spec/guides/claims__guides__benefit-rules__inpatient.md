# Inpatient Benefit Rules
Inpatient Services is SHA-07 on SHIF covers and PMF-07 on POMSF covers. It is a per-diem
package available from Level 3 to Level 6, and it is the anchor most other packages attach to: critical
care, haemato-oncology, imaging, renal care and palliative care all interact with an open inpatient admission.
## How the per-diem amount is determined
Inpatient care uses a Hospital Level Tariff. SHA sets a separate rate for each KEPH level, and the
applicable rate is the one for the facility's own level as determined by KMPDC.
Do not hard-code the ladder. GET /api/v1/patients/benefits/interventions returns the rate per level on the
intervention itself, in the level2Tariff through level6Tariff fields, and the per-diem line is
auto-generated from the accrued days rather than billed by hand. For the full walkthrough, including how
unit_price is used purely to validate against your facility's level, see
Scenario 1: SHIF Inpatient Per Diem and
Intervention Coverage.
## The overnight-stay requirement
The per-diem rebate applies to an overnight stay. The date of admission and the date of discharge must be
different, giving at least one night.
Rates are auto-calculated per calendar day, so a same-day admission and discharge earns no per-diem rebate at
all. Check ward availability with Bed Occupancy and see
Inpatient Claim Dispatch for how the discharge
submits the claim.
## The 180-day cumulative household cap
### One counter, four packages, every member of the household
Admission days are limited to 180 days per household, cumulatively, and the counter is shared by every
benefit reimbursed through per diem: inpatient care, critical care, palliative care and mental wellness.
It is not 180 days each. It is not 180 days per beneficiary. One member's long admission reduces what is
available to the rest of the household, across all four packages.
Two consequences worth designing for:
- Balance tracking runs while the episode is open, not at discharge. A long admission draws the allowance
down as it goes.
- A request that exceeds the remainder is partially approved, not refused. If 30 days are requested and 20
remain, 20 are approved so the household lands exactly on the limit. Once the allowance is exhausted, no
further per-diem intervention is available to any beneficiary in that household.
Read the authoritative figure from
Patient Utilization rather than tracking it locally.
The cap is recorded identically on both workbooks, so it applies on SHIF and POMSF covers alike.
## Standard per-diem codes
The per-diem catalogue is split into standard codes, governed by the 180-day household cap alone, and
special codes, which carry additional per-code ceilings and preauthorisation thresholds. All the inpatient
codes are standard. The special codes are the ICU, NICU and PICU critical care interventions - see
Standard and special critical care codes.
The standard per-diem set spans inpatient care, HDU and burns critical care, mental wellness, palliative care
and rehabilitation services, which is why they all share the one household counter.
## Clinical review triggers
Long admissions at lower-level facilities are held for clinical review by the payer before the claim is
paid. This happens after the claim is transmitted - the HIE does not adjudicate claims - so the submission
itself succeeds and the outcome appears on
Preview Payer Claim.
### The threshold differs by scheme
On SHIF covers, admissions exceeding 4 days at KEPH level 3 hospitals are pushed for clinical review.
On POMSF covers, the same rule applies to KEPH levels 3 and 4.
So a 5-day level-4 admission goes to payer review on POMSF and pays straight through on SHIF. Expect review
rather than rejection in either case: the payer holds the claim for a reviewer, it does not refuse it.
## Switching to critical care or palliative care
The system must let the hospital switch the intervention between packages, with admission days calculated
automatically (inpatient rules 1.2 and 1.3):
- Inpatient to critical care, and critical care back to inpatient - the source describes this as a
two-way switch.
- Inpatient to palliative care - the source describes this in one direction only. No rule provides for
switching back.
Use Switch Intervention rather than adding a second
per-diem intervention, because a claim cannot carry more than one active per-diem intervention at a time.
## Adding a package during the admission
For three groups of services the provider may add a package during the admission (inpatient rules 1.4).
The effect is additive: at the end of the admission the patient earns the inpatient per-diem rebate for all
days, plus the rate for each added package.
 | Addable during an admission | Rule
 | Haematology and oncology | 1.4.1
 | Medical imaging and other investigations | 1.4.2
 | Renal care services, but only the interventions listed below | 1.4.3
The renal care interventions named in rule 1.4.3, identically in both workbooks:
 | Renal intervention | Code
 | Haemodialysis | SHA-16-001
 | Haemodiafiltration | SHA-16-002
 | Peritoneal dialysis | SHA-16-004
 | Dialysis for acute kidney injury | SHA-16-007
 | Pre-transplant recipient evaluation | SHA-16-008
 | Post renal replacement therapy | SHA-16-011
This is also the answer to why medical imaging can be reported "alone" and still appear on an inpatient
claim - see
Imaging is standalone at entry but addable during an admission.
### Validate the renal pairing before you rely on it
The SHA-16 row of the combination sheet is more restrictive than rule 1.4.3 for some sub-codes. Before you
add a renal intervention to an open admission, confirm the pairing is permitted for the scheme in play by
checking the intervention against
Intervention Coverage and the
combination rules - rather than assuming the rule 1.4.3 list
above resolves in every case.
SHA-16-007 (dialysis for acute kidney injury) is the one sub-code that every part of the matrix agrees may
be combined with an admission.
## Inpatient sub-codes across the two schemes
 | Service | SHIF | POMSF | Sub-benefit label on the POMSF sheet
 | Management of medical cases | SHA-07-001 | PMF-07-001 | Inpatient
 | Surgical complications | SHA-07-002 | PMF-07-002 | Surgical Complications
 | Post-partum complications | SHA-07-005 | PMF-07-003 | Maternal and New born Complications
 | Neonatal complications | SHA-07-006 | PMF-07-004 | Inpatient Critical Care
### POMSF numbers the last two differently
Post-partum and neonatal complications are the same two services on both schemes, but they are -005 and
-006 on SHIF and -003 and -004 on POMSF. A combination rule or claim line keyed on SHA-07-005 will not
resolve on a POMSF cover, which matters because the
maternity rules name
those exact codes as the post-global-period targets.
Resolve sub-codes from
Intervention Coverage for the scheme in play rather
than mapping them yourself.
## Preauthorisation and documentation
### The preauthorisation requirement differs by scheme
On SHIF covers, inpatient care requires no preauthorisation. On POMSF covers it is required and
handled automatically.
Branch your logic on needsPreauth from
Intervention Coverage for the scheme in play rather
than on the scheme names above. The flag is live data and this page is not, so code that reads it keeps
working if SHA changes the requirement.
Do not hard-code a document list from this page or from the matrix. Every intervention publishes its own
documentation requirements. Read them from
Intervention Coverage for the intervention you are
billing:
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
- Critical Care Rules - the special codes and the 12-day and 30-day thresholds.
- Intervention Coverage - per-level tariffs, preauth flags and document requirements.
- Intervention Combination Rules - which packages may join an admission.
- Adding Attachments - reading required documents off the intervention.
- Surgical Rules - why the per-diem rebate cannot run inside a surgical global period.
- Maternity Benefit Rules - the codes maternity switches into after its global period.
- Scenario 1: SHIF Inpatient Per Diem - the end-to-end per-diem claim, including tariff validation.
- Switch Intervention - moving between per-diem packages.
- Patient Utilization - the authoritative remaining day allowance.
- Bed Occupancy - ward availability before admission.
- Inpatient Claim Dispatch - discharge and submission.
- Preview Payer Claim - where the payer's review outcome and final status appear.
Last modified on September 28, 2026
