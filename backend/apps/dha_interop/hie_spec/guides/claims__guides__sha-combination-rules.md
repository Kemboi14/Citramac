# Intervention Combination Rules
The Social Health Authority (SHA) uses Combination Rules to govern which intervention codes can be added to the same claim.
These rules are essential for ensuring claim integrity, preventing conflicts (e.g., an inpatient and an outpatient service on the same claim), and improving payout times. Adhering to these rules at the point of care will significantly reduce claim rejections.
The rules differ by scheme. The standard SHA covers and Public Officers Medical Scheme Fund (POMSF)
covers publish separate combination sheets, and they do not agree on either the code namespace or the
allowed sets. Read the section that matches the scheme the visit is billed against - use
Set Coverage if the POMSF cover has to be chosen first.
Several cells below point at a rules sheet rather than stating the rule: the maternity global period, the
surgical global period, and the renal sub-codes that may join an inpatient admission. Those rule sets are
documented in Special Benefit Rules, and the links in the tables go
straight to them.
## How to interpret the Combination Rules Table
The logic in the Combination Rules table is based on a Primary Intervention model. The first intervention you add to a visit sets the context for the entire claim.
Important!
The "Code" column below refers to the first intervention added to the visit. The "Allowed Code Combinations" column shows what other benefit packages can (or cannot) be added after that first one.
### Checking Combinations via API
Before you call the Add Intervention endpoint to add an intervention to a claim, check the combination against the table for the scheme the visit is billed against. Enforcing these rules in your own system before the call is what prevents the rejection - the combination is validated on submission, so an invalid pairing surfaces as a failed call rather than a warning.
### Intervention Code Combinations: standard SHA covers
These are the rules published in the SHA Benefits Matrix, and they govern the standard SHA covers -
the packages funded from SHIF, plus ambulance, emergency and critical care from ECCIF. For a POMSF
cover, read the next table instead.
 | Code | Name of Package | Allowed Code Combinations
 | SHA-01 | Ambulance and Emergency Services | None.
 | SHA-03 | Critical Care Services | SHA-07 | SHA-06 | SHA-16 | SHA-09 | SHA-13 | SHA-08 | SHA-19 (refer to surgical rules)
 | SHA-05 | Optical Health Services | ALONE (No other Intervention codes can/should be added)
 | SHA-06 | Haematology and Oncology Services | ALONE (No other Intervention codes can/should be added)
 | SHA-07 | Inpatient Services | SHA-03 | SHA-06 | SHA-16 (001, 002, 004, 007, 008, 011) | SHA-09 | SHA-19 (refer to surgical rules)
 | SHA-08 | Maternity and Child Health Services | SHA-03 | SHA-09 | SHA-07-005 | SHA-07-006 codes after the lapse of the global period as per the maternity rules
 | SHA-09 | Medical Imaging & Other Investigations | ALONE (No other Intervention codes can/should be added)
 | SHA-10 | Mental Wellness Services | ALONE (No other Intervention codes can/should be added)
 | SHA-12 | Outpatient Services | ALONE (No other Intervention codes can/should be added)
 | SHA-13 | Palliative Care services | SHA-03 | SHA-06 | SHA-07 | SHA-09 | SHA-16 | SHA-19
 | SHA-16 | Renal Care Services | Codes to be reported alone are;
SHA-16-001,002,004
Codes to allow combination are;
* SHA-16-003 | SHA-03 | SHA-07
* SHA-16-005 | SHA-03 | SHA-07
* SHA-16-006 | SHA-03 | SHA-07
* SHA-16-007 | SHA-03 | SHA-07
* SHA-16-009 | SHA-03 | SHA-07
 | SHA-18 | Essential Diagnostic Laboratory Listing for NCDs | ALONE (No other Intervention codes can/should be added)
 | SHA-19 | Surgical Services | SHA-07-002 | SHA-09 | SHA-03 & SHA-13 ONLY after the lapse of the surgical global period
### Intervention Code Combinations: POMSF
These are the rules for Public Officers Medical Scheme Fund (POMSF) covers. They are published on a
separate sheet from the standard SHA rules and they are not the same rules - read this table, not
the one above, whenever the visit is billed against a POMSF cover.
 | Code | Name of Package | Allowed Code Combinations
 | PMF-03 | Critical Care Services | SHA-06 | SHA-09 | PMF-07 | PMF-10 | PMF-13 | SHA-16 | SHA-19 | SHA-08
 | SHA-05 | Optical Health Services | ALONE. For any other code, close SHA-05 and start a new visit.
 | SHA-06 | Haemato-Oncology Services | ALONE. For any other code, close SHA-06 and start a new visit.
 | SHA-08 | Maternity and Child Health Services | PMF-07 | SHA-19 | SHA-16 | PMF-03 | SHA-06 | SHA-09
 | SHA-09 | Medical Imaging & Other Investigations | ALONE. For any other code, close SHA-09 and start a new visit.
 | SHA-11 | Oral Health | ALONE. For any other code, close SHA-11 and start a new visit.
 | PMF-10 | Inpatient Services (see the note below) | PMF-03 | SHA-06 | SHA-09 | PMF-13 | SHA-15 | SHA-16 | SHA-19 | SHA-08
 | PMF-12 | Outpatient Services | None. For any other code, close PMF-12 and start a new visit.
 | PMF-07 | Inpatient Services | PMF-03 | SHA-06 | SHA-09 | PMF-13 | SHA-15 | SHA-16 | SHA-19 | SHA-08
 | PMF-13 | Palliative Care Services | PMF-03 | SHA-06 | SHA-09 | SHA-16 | SHA-19 | SHA-08
 | SHA-16 | Renal Care Services | Codes to be reported alone are;
SHA-16-001,002,004 - for any other code, close them and start a new visit
Codes to allow combination are;
* SHA-16-003 | PMF-03 | PMF-07
* SHA-16-005 | PMF-03 | PMF-07
* SHA-16-006 | PMF-03 | PMF-07
* SHA-16-007 | PMF-03 | PMF-07
* SHA-16-009 | PMF-03 | PMF-07
 | SHA-19 | Surgical Services | PMF-07 | SHA-09 | SHA-16 | PMF-03 & PMF-13 ONLY after the lapse of the surgical global period
Both sheets record the same starting assumption: the first benefit accessed at entry is the first
intervention added. That first intervention is the one whose row you read.
How POMSF differs from the standard SHA rules
- A separate code namespace. POMSF replaces five standard SHA packages with PMF- codes:
SHA-03 becomes PMF-03 (Critical Care), SHA-07 becomes PMF-07 (Inpatient), SHA-10 becomes
PMF-10, SHA-12 becomes PMF-12 (Outpatient) and SHA-13 becomes PMF-13 (Palliative Care).
Codes that keep the SHA- prefix - SHA-05, SHA-06, SHA-08, SHA-09, SHA-11, SHA-16,
SHA-19 - are shared across both schemes.
- "ALONE" carries a remedy. On the SHA Benefits Matrix sheet, "ALONE" is a bare prohibition. On the POMSF
sheet, every "ALONE" row states the way forward: close the intervention and start a new visit.
- SHA-16 pairs with the PMF codes. The combinable renal sub-codes pair with PMF-03 and
PMF-07, where the SHA Benefits Matrix sheet pairs them with SHA-03 and SHA-07.
- SHA-19 additionally allows SHA-16. The SHA Benefits Matrix sheet does not list renal care against
surgical services.
- SHA-08 is broader. POMSF allows PMF-07, SHA-19, SHA-16, PMF-03, SHA-06 and SHA-09
with no sub-code restriction, where the SHA Benefits Matrix sheet restricts the inpatient pairing to
SHA-07-005 and SHA-07-006 after the maternity global period.
- Inpatient is less restricted. PMF-07 carries no SHA-16 sub-code restriction and adds
SHA-15 and SHA-08, neither of which appears against SHA-07 on the SHA Benefits Matrix sheet.
### Note on PMF-10
The POMSF Code Combination sheet labels PMF-10 as "Inpatient Services", with the same allowed set as
PMF-07. Elsewhere in the same POMSF matrix the Mental Wellness sheet uses PMF-10 for Mental Wellness
Services (PMF-10-002 to PMF-10-005).
The table above reproduces the sheet as published. Resolve the package a code belongs to from
Intervention Coverage rather than writing a
combination rule against PMF-10 from this table alone.
## Related resources
- Special Benefit Rules - the per-package rules these tables refer to.
- Maternity Benefit Rules - the global period that gates the SHA-08 pairings.
- Surgical Rules - the global periods that gate the SHA-19 pairings.
- Inpatient Benefit Rules - the SHA-16 sub-codes that may join an admission.
- Critical Care Rules - the day thresholds behind SHA-03 and PMF-03.
- Benefit Matrix - funds, schemes, and the full package code list.
- Add Intervention - adding a second intervention to a visit.
- Set Coverage - choosing the cover the visit is billed against.
Last modified on September 28, 2026
