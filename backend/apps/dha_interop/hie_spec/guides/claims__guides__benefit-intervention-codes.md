# Benefits & Intervention Codes
The Social Health Authority (SHA) uses a standardized coding system to represent healthcare services. Understanding this hierarchy is essential for checking eligibility and submitting valid claims.
## The Code Hierarchy
SHA codes follow a hierarchical structure. You cannot submit a claim using only a high-level "Benefit" code; you must always be specific and use an "Intervention" code.
- Benefit Package (SHA-XX): Broad categories of care (e.g., Inpatient, Dental).
- Intervention (SHA-XX-YYY): The specific billable service (e.g., Appendectomy, Consultation).
### Code Relationship
An Intervention code usually starts with the prefix of its parent Benefit Package.
Example: SHA-07-001 (Management of Medical Cases) belongs to SHA-07 (Inpatient Services).
## List of Benefit Packages
Below are the high-level benefit packages available in the SHA ecosystem.
 | Benefit Code | Name of Package
 | SHA-01 | Ambulance and Emergency Services
 | SHA-03 | Critical Care Services
 | SHA-05 | Optical Health Services
 | SHA-06 | Haematology and Oncology Services
 | SHA-07 | Inpatient Services
 | SHA-08 | Maternity and Child Health Services
 | SHA-09 | Medical Imaging & Other Investigations
 | SHA-10 | Mental Wellness Services
 | SHA-12 | Outpatient Services
 | SHA-13 | Palliative Care Services
 | SHA-16 | Renal Care Services
 | SHA-18 | Essential Diagnostic Laboratory Listing for NCDs
 | SHA-19 | Surgical Services
## Finding Intervention Codes
While the table above lists the categories, you need specific Intervention Codes to build a claim.
You can retrieve the full list of valid interventions for a specific patient and facility by using the Interventions Coverage Endpoint.
### How it fits in with claims and preauths
When working with claims and preauths, you will need to use the Intervention Code to represent the provided healthcare service. This is the intervention_code used in most of the APIs in their request body.
## Related resources
Some packages carry rules that decide whether a code may be added to a visit at all, and how many days of care
that code can be billed for.
- Special Benefit Rules - the per-package rules for maternity, imaging, surgical, critical care, inpatient and substance-abuse rehabilitation.
- SHA Combination Rules - which packages may share a single visit.
- Benefit Matrix - funds, schemes and payment mechanisms.
- Intervention Coverage - retrieving the codes, tariffs and preauth flags for a patient.
Last modified on September 28, 2026
