# Benefit Matrix Guide
The SHA benefit matrix is the rulebook the HIE applies when it decides what a patient is entitled to and
how a service is paid for. It defines the benefit packages, the funds and schemes that pay for them, the
payment mechanisms, and the rules for combining interventions within a single visit. Eligibility and
coverage responses (GET /patients/benefits and its drill-downs) are the matrix applied to a specific
patient at a specific facility.
The matrix is maintained in two source workbooks:
- SHA Benefits Matrix - the SHIF / UHC benefit packages, per-package clinical rules, protocols, and
tariffs.
- SHA POMSF Benefits & Tariffs Matrix - the extended packages and tariffs for the Public Officers
Medical Scheme Fund (POMSF).
### Effective date
The current SHA benefit package took effect on 01/10/2024. Benefit balances are checked immediately
after a preauth is approved (where applicable) or as treatment is ongoing for per-diem benefits.
## 1. Funds, schemes, and payment mechanisms
### 1.1. Funds
- Primary Healthcare Fund (PHC): Covers outpatient services at lower-level facilities, funded by
government and grants.
- Social Health Insurance Fund (SHIF): For contributing members, available at hospital level 3 and
above.
- Emergency, Chronic and Critical Illness Fund (ECCIF): For emergency, critical, chronic, and
palliative care.
### 1.2. Schemes
- UHC (Universal Health Coverage): For all citizens, using PHC and SHIF.
- POMSF (Public Officers Medical Scheme Fund): For civil servants; extended coverage on top of UHC.
### 1.3. Payment mechanisms
- Capitation: For PHC, based on patient numbers at facilities.
- Per Diem: Daily payments, e.g. ICU care.
- Fee for Service: SHA pays the full fee if the tariff is met.
- Fixed Fee for Service: SHA pays a fixed fee; the patient covers the rest.
- Case-Based: Depends on the treatment scenario, e.g. a cesarean after a failed normal delivery.
### Capitation scope
ECCIF and SHIF use all payment mechanisms except capitation. Capitation applies to PHC.
## 2. Benefit packages and SHA codes
Every benefit package has an SHA-NN code. Interventions within a package extend the code (for example
SHA-16-003). Use these package codes to interpret eligibility and coverage responses.
 | Code | Package
 | SHA-01 | Ambulance and Emergency Services
 | SHA-02 | Assistive Devices
 | SHA-03 | Critical Care Services
 | SHA-04 | End of Life Services
 | SHA-05 | Optical Health Services
 | SHA-06 | Hematology and Oncology Services
 | SHA-07 | Inpatient Services
 | SHA-08 | Maternity and Child Health Services
 | SHA-09 | Medical Imaging and Other Investigations
 | SHA-10 | Mental Wellness Services
 | SHA-11 | Oral Health Services
 | SHA-12 | Outpatient Services
 | SHA-13 | Palliative Care Services
 | SHA-15 | Rehabilitation Services
 | SHA-16 | Renal Care Services
 | SHA-17 | Screening
 | SHA-18 | Essential Diagnostic Laboratory listing for NCDs
 | SHA-19 | Surgical Services
 | SHA-20 | Overseas Treatment
 | SHA-21 | Assisted Fertility Treatment
 | SHA-22 | Last Expense
### 2.1. POMSF package codes
POMSF reuses the shared SHA-NN package codes above and adds its own tariffs and limits. In addition,
several inpatient-side packages have POMSF-specific entry codes (PMF-NN) in the POMSF matrix, each
mirroring its SHA-NN equivalent:
 | POMSF code | Package | SHA equivalent
 | PMF-03 | Critical Care Services | SHA-03
 | PMF-07 | Inpatient Services | SHA-07
 | PMF-10 | Mental Wellness Services | SHA-10
 | PMF-12 | Outpatient Services | SHA-12
 | PMF-13 | Palliative Care Services | SHA-13
### Reading POMSF codes
Interventions extend these entry codes (for example PMF-12-001 outpatient consultation, PMF-07-002
surgical complications). Packages without a PMF-NN entry code are billed under their shared SHA-NN
code with POMSF tariffs. Consult the POMSF matrix for the full POMSF tariff and limit detail.
## 3. Code-combination rules
Within a single visit, the first intervention added determines which other packages may be combined
with it. Two broad patterns apply:
- Combinable packages can carry additional interventions in the same visit. For example, Inpatient
(SHA-07) combines with Critical Care (SHA-03), Hemato-Oncology (SHA-06), Renal Care (SHA-16),
Medical Imaging (SHA-09), and Surgical (SHA-19).
- Standalone packages must be reported alone. For example Optical (SHA-05), Hemato-Oncology
(SHA-06), Medical Imaging (SHA-09), Mental Wellness (SHA-10), Outpatient (SHA-12), and the NCD
diagnostic laboratory list (SHA-18) allow no other codes. To bill a different package, close the
current one and start a new visit.
### Surgical global period
Surgical Services (SHA-19) combines with Inpatient (SHA-07-002) and Medical Imaging (SHA-09).
Critical Care (SHA-03) and Palliative Care (SHA-13) may be combined only after the
surgical global period has lapsed -
1 night for minor, 3 for major, 7 for specialized surgery.
For the detailed, worked combination rules, see the
SHA Combination Rules guide. The package-by-package rules are
documented in Special Benefit Rules - including
Renal Care's per-intervention exceptions
and the Maternity global period.
## 4. Access rules
- PHC: Outpatient PHC services are accessible upon registration.
- SHIF - formal sector: Policy start date is the date of registration (with effect from 01/10/2024).
- SHIF - informal sector: Policy starts on the date the Authority receives the annual premium and
ends 365 days later.
- Balance checks: Household and individual balances are checked immediately after a preauth is
approved (where applicable), or as treatment is ongoing for per-diem benefits.
## 5. Where the detailed rules and tariffs live
This guide is an orientation to the matrix. The per-package rules for six packages are documented in
Special Benefit Rules, one page per rule set:
 | Rule set | Codes | What it governs
 | Maternity | SHA-08 | The delivery global period and when inpatient per-diem may start
 | Medical Imaging | SHA-09 | Mandatory preauthorisation and the 7-day approval expiry
 | Surgical | SHA-19 | Global periods by complexity and when a separate claim may be raised
 | Critical Care | SHA-03, PMF-03 | The 12-day and 30-day day thresholds and switching to inpatient
 | Inpatient | SHA-07, PMF-07 | The 180-day household cap and adding packages mid-admission
 | Substance Abuse Rehab | SHA-10-005 | The payment decision flow
The remaining protocols - for example the NCCP chemotherapy protocols - and the tariff tables themselves stay
in the two source workbooks. Tariffs are runtime data: resolve them per intervention from
Intervention Coverage, and see the
PMF Tariffs Guide for POMSF resolution.
## See Also
Special Benefit Rules - the per-package rules, and the terms they use.
Benefits Coverage
Sub-Benefits Coverage
Intervention Coverage
PMF Tariffs Guide
Understanding Benefits and Intervention Codes
Last modified on September 28, 2026
