# Critical Care Rules
Critical Care Services is SHA-03 on SHIF covers and PMF-03 on POMSF covers. It is a per-diem
package reimbursed from the Emergency, Chronic and Critical Illness Fund (ECCIF), and its day counting is
the most intricate in the matrix: there is a preauthorisation threshold, a per-code ceiling, and a shared
household allowance, and all three apply at once.
## The critical care interventions
 | Intervention | SHIF | POMSF | Facility levels | Age limit
 | ICU care | SHA-03-001 | PMF-03-001 | Level 4 to 6 | None
 | HDU care | SHA-03-002 | PMF-03-002 | Level 4 to 6 | None
 | NICU care | SHA-03-003 | PMF-03-003 | Level 4 to 6 | Up to 28 days old
 | PICU care | SHA-03-004 | PMF-03-004 | Level 4 to 6 | Up to 12 years old
 | Intensive care burns unit | SHA-03-005 | PMF-03-005 | Level 4 to 6 | None
### The burns unit does not follow the critical care day rules
SHA-03-005 sits in the same table as the four codes above but behaves like an inpatient code. Its limit is
180 days within the inpatient limit, not the 12-day threshold, and it is priced on the inpatient
per-KEPH-level ladder rather than the flat critical-care rate.
This is easy to miss precisely because it shares the table. Treat it as an inpatient-style per-diem code that
happens to be delivered in a critical care unit.
## Standard and special critical care codes
Not all five codes are governed the same way. SHA's per-diem rule model splits the per-diem catalogue into
standard and special codes, and three of the critical care interventions are special. The
classification is the same on both schemes.
 | Class | Codes | Rules that apply
 | Special | SHA-03-001 (ICU), SHA-03-003 (NICU), SHA-03-004 (PICU) | The 180-day household cap, plus a 30-day ceiling per code and a preauthorisation threshold
 | Standard | SHA-03-002 (HDU), SHA-03-005 (burns), and the inpatient, mental wellness, palliative and rehabilitation per-diem codes | The 180-day household cap only
## The 12-day and 30-day thresholds
For a special critical care code:
- The first 12 days are payable without preauthorisation, counted per household.
- Days 13 to 30 require preauthorisation.
- 30 days is the ceiling per special code, within the overall 180-day household allowance.
- Days requested beyond the 30-day ceiling are approved on the normal standard code instead, not refused
outright.
A request that straddles a threshold is split automatically rather than rejected. A 20-day ICU request
becomes 12 days without preauthorisation plus 8 days requiring it. A 40-day request becomes 12 without
preauthorisation, 18 with it, and the remaining 10 on the standard code.
Both matrices describe the day-12 boundary as the point at which the normal rebate takes effect. On a
POMSF cover the matrix goes further: the system should automatically switch the patient to inpatient, or
prompt the provider to switch the package. Either way, day 12 is where the preauthorisation requirement
begins and where the tariff falls back toward the inpatient rate.
## Switching between inpatient and critical care
The system must let the hospital switch the intervention from inpatient to critical care and from critical
care back to inpatient (critical care rules 1.1, stated on both sheets, so it applies on SHIF and POMSF
alike). Tariffs follow the benefit matrix and the admission days are calculated automatically.
This is a genuine two-way switch, unlike the inpatient-to-palliative-care transition, which the source
describes in one direction only. Use
Switch Intervention rather than adding a second
per-diem intervention alongside the first, because a claim may not carry two active per-diem interventions at
once.
## Critical care after surgery
Patients receiving surgical care transition to the critical care package only after the surgical global
admission period has been exhausted. Inside the surgical global period, the critical care per-diem rebate
must not run at all.
See Surgical global periods for the
1, 3 and 7-night windows, and note that an entirely unrelated episode of critical care is one of the five
situations in which a separate claim may be raised.
## Which packages may be billed with critical care
The combination rules let critical care share a visit with inpatient, haemato-oncology, renal care, medical
imaging, palliative care, maternity and surgical services. The POMSF row is broadly the same with the PMF-
codes substituted.
Read the combination rules table for the scheme the visit is
billed against - it is the authoritative statement of what may share a critical care visit.
## Individual, household and the 180-day cap
Critical care days count against the 180-day allowance shared with inpatient care, palliative care and
mental wellness, cumulatively across every beneficiary in the household. See
the 180-day cumulative household cap.
The 12-day threshold is recorded per admission episode on POMSF covers.
### Read the remaining allowance, do not track it
Whose allowance is decremented depends on the scheme and on how the household's other admissions have run.
Read the authoritative remaining allowance from
Patient Utilization before every admission rather than
maintaining a day counter of your own. On a household basis one member's long ICU stay reduces what is left
for the others, so a locally held count goes wrong quietly.
## Funding and second-payer behaviour
- SHIF covers - reimbursement is made from ECCIF, not from SHIF.
- POMSF covers - SHA pays the per-diem up to the 12-day threshold from ECCIF. Beyond that, POMSF acts as
second payer, fee for service, over and above the per diem, within the principal member's inpatient
limit.
Check the member's remaining POMSF cover with
POMSF Balance before a long critical care admission, and
resolve amounts with PMF Tariffs.
## Preauthorisation and documentation
### The preauthorisation requirement differs by scheme
On SHIF covers, the critical care data sheet records preauthorisation as not required. On POMSF
covers it is required, at discharge.
Branch your logic on needsPreauth from
Intervention Coverage for the scheme in play rather
than on the scheme names above. The flag is live data and this page is not, so code that reads it keeps
working if SHA changes the requirement.
Note also that a preauthorisation requirement kicks in from day 13 on the special codes regardless of scheme,
so "not required" applies to the opening days of the admission only.
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
- Inpatient Benefit Rules - the shared 180-day allowance and the standard per-diem codes.
- Intervention Coverage - tariffs, preauth flags and document requirements.
- Adding Attachments - reading required documents off the intervention.
- PMF Tariffs - resolving POMSF second-payer amounts.
- Surgical Rules - why critical care cannot start inside the surgical global period.
- Switch Intervention - moving between inpatient and critical care.
- Patient Utilization - the authoritative remaining day allowance.
- POMSF Balance - the member's cover beyond the per-diem days.
- Intervention Combination Rules - what critical care may share a visit with.
Last modified on September 28, 2026
